import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    users: [] as any[],
    memberships: [] as any[],
    orgData: {} as Record<string, any>,
  },
  reload: vi.fn(),
  save: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock('../server/db', () => ({
  getDB: () => mocks.db,
  getPrismaClientForAdmin: async () => null,
  reloadOrganizationDataFromPostgres: mocks.reload,
  saveOrganizationData: mocks.save,
  OrganizationStateVersionConflictError: class OrganizationStateVersionConflictError extends Error {},
}));

vi.mock('../server/aiNotificationOutbox', () => ({
  aiFindingNotificationEventKey: (finding: any) => (
    `${finding.dedupeKey}:${finding.lastSeenAt}:${finding.severity}`
  ),
  enqueueAiFindingNotifications: mocks.enqueue,
  __resetInMemoryAiNotificationOutbox: () => undefined,
}));

import { runMonitoringPass } from '../server/aiMonitoring';
import { __resetInMemoryAiMonitoringRuns } from '../server/aiMonitoringStore';
import { __resetInMemoryAiNotificationOutbox } from '../server/aiNotificationOutbox';

function organizationData(monitoringEnabled = true): any {
  return {
    vessels: [],
    lots: [],
    fermlogs: [],
    lablogs: [],
    inventory: [],
    tasks: [],
    cellarOps: [],
    transfers: [],
    bottlingRuns: [],
    grapeIntakes: [],
    blocks: [],
    scoutings: [],
    sprays: [],
    samplings: [],
    harvests: [],
    certificationRecords: [],
    salesOrders: [],
    aiFindings: [],
    companyProfile: {
      country: 'Georgia',
      aiConfig: { monitoringEnabled },
    },
  };
}

describe('scheduled AI monitoring persistence', () => {
  beforeEach(() => {
    mocks.db.orgData = {};
    mocks.db.users = [];
    mocks.db.memberships = [];
    mocks.reload.mockReset().mockResolvedValue(null);
    mocks.save.mockReset().mockResolvedValue(undefined);
    mocks.enqueue.mockReset().mockResolvedValue(0);
    __resetInMemoryAiMonitoringRuns();
    __resetInMemoryAiNotificationOutbox();
  });

  it('awaits an organization-scoped durable save for every monitored winery', async () => {
    mocks.db.orgData['org-1'] = organizationData();
    const result = await runMonitoringPass('daily');

    expect(result.organizations).toHaveLength(1);
    expect(mocks.save).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ aiFindings: expect.any(Array) }),
      expect.objectContaining({ updatedBy: 'ai-monitor:daily' }),
    );
  });

  it('does not rewrite organizations that disabled monitoring', async () => {
    mocks.db.orgData['org-off'] = organizationData(false);
    const result = await runMonitoringPass('hourly');

    expect(result.skipped).toBe(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('deduplicates overlapping passes in the same cadence window', async () => {
    mocks.db.orgData['org-1'] = organizationData();
    const first = await runMonitoringPass('daily');
    const replay = await runMonitoringPass('daily');

    expect(first.organizations).toHaveLength(1);
    expect(replay.organizations).toHaveLength(0);
    expect(replay.deduplicated).toBe(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('hands routed finding transitions to the durable outbox', async () => {
    const data = organizationData();
    data.tasks = [{
      id: 'task-overdue',
      title: 'Confirm bottling plan',
      status: 'pending',
      priority: 'high',
      dueDate: '2020-01-01',
    }];
    mocks.db.orgData['org-1'] = data;
    mocks.db.users = [{ username: 'owner', accountEnabled: true }];
    mocks.db.memberships = [{
      organizationId: 'org-1',
      userId: 'owner',
      role: 'Owner/Admin',
    }];
    mocks.enqueue.mockResolvedValue(1);

    const result = await runMonitoringPass('daily');
    expect(result.organizations[0].created).toBeGreaterThan(0);
    expect(result.organizations[0].outboxQueued).toBeGreaterThan(0);
  });

  it('retries a saved notification hand-off without duplicating the finding occurrence', async () => {
    const data = organizationData();
    data.tasks = [{
      id: 'task-overdue',
      title: 'Confirm bottling plan',
      status: 'pending',
      priority: 'high',
      dueDate: '2020-01-01',
    }];
    mocks.db.orgData['org-retry'] = data;
    mocks.enqueue
      .mockRejectedValueOnce(new Error('outbox unavailable'))
      .mockResolvedValueOnce(1);

    await expect(runMonitoringPass('daily')).rejects.toThrow('outbox unavailable');
    const retry = await runMonitoringPass('daily');

    expect(retry.organizations[0].outboxQueued).toBe(1);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(data.aiFindings[0].occurrences).toBe(1);
  });
});
