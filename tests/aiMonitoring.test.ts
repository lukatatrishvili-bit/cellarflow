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
import { buildDailyBriefing } from '../lib/ai';
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

  /** A winery with something for the detectors to find, so a pass has work to persist. */
  function organizationWithFinding(): any {
    const data = organizationData();
    data.tasks = [{
      id: 'task-overdue',
      title: 'Confirm bottling plan',
      status: 'pending',
      priority: 'high',
      dueDate: '2020-01-01',
    }];
    return data;
  }

  it('awaits an organization-scoped durable save for every monitored winery', async () => {
    mocks.db.orgData['org-1'] = organizationWithFinding();
    const result = await runMonitoringPass('daily');

    expect(result.organizations).toHaveLength(1);
    expect(mocks.save).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ aiFindings: expect.any(Array) }),
      expect.objectContaining({ updatedBy: 'ai-monitor:daily' }),
    );
  });

  it('does not write when a pass observed no change', async () => {
    // An hourly sweep over a quiet winery has nothing to say. Writing anyway
    // costs a full organization-blob save and bumps the state version, which
    // makes a winemaker's own sync retry against a job that found nothing.
    mocks.db.orgData['org-quiet'] = organizationData();
    const result = await runMonitoringPass('daily');

    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0].created).toBe(0);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('leaves the shared in-memory blob untouched when it skips the write', async () => {
    // `data` can be the shared getDB() object. Mutating it without persisting
    // would diverge memory from Postgres for every later reader.
    const data = organizationData();
    mocks.db.orgData['org-quiet'] = data;
    await runMonitoringPass('daily');

    expect(mocks.save).not.toHaveBeenCalled();
    expect(data.aiFindings).toEqual([]);
  });

  it('writes a persistent condition once, not once per cadence window', async () => {
    const data = organizationWithFinding();
    mocks.db.orgData['org-persistent'] = data;

    await runMonitoringPass('daily');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(data.aiFindings.length).toBeGreaterThan(0);

    // A later window over identical state moves only lastSeenAt/occurrences.
    // Re-detecting an unchanged condition must not cost another blob write.
    __resetInMemoryAiMonitoringRuns();
    mocks.reload.mockResolvedValue({ data, meta: { version: 1 } });
    await runMonitoringPass('daily');
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('writes again when a finding genuinely changes', async () => {
    const data = organizationWithFinding();
    mocks.db.orgData['org-changing'] = data;
    await runMonitoringPass('daily');
    expect(mocks.save).toHaveBeenCalledTimes(1);

    // Escalate the same task from high priority to a longer overdue window so the
    // finding's own content moves. Skipping *this* write would lose real signal.
    data.tasks.push({
      id: 'task-second',
      title: 'Top up barrels',
      status: 'pending',
      priority: 'high',
      dueDate: '2019-01-01',
    });
    __resetInMemoryAiMonitoringRuns();
    mocks.reload.mockResolvedValue({ data, meta: { version: 1 } });
    await runMonitoringPass('daily');
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it('does not rewrite organizations that disabled monitoring', async () => {
    mocks.db.orgData['org-off'] = organizationData(false);
    const result = await runMonitoringPass('hourly');

    expect(result.skipped).toBe(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('deduplicates overlapping passes in the same cadence window', async () => {
    mocks.db.orgData['org-1'] = organizationWithFinding();
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

  it('produces an owner-scoped daily briefing, not an unfiltered org digest', async () => {
    const data = organizationData();
    // A lab-gated finding: overdue analysis on an aging batch.
    data.lots = [{
      id: 'L1', name: 'Saperavi', vintage: 2026, variety: 'Saperavi', vineyardBlock: 'B1',
      region: 'Kakheti', initialVolume: 900, currentVolume: 900, wineClass: 'red',
      stage: 'aging', createdAt: '2026-01-01', history: [],
    }];
    // …and an operations finding any cellar role may see.
    data.tasks = [{
      id: 'task-overdue',
      title: 'Confirm bottling plan',
      status: 'pending',
      priority: 'high',
      dueDate: '2020-01-01',
    }];
    mocks.db.orgData['org-briefing'] = data;

    const result = await runMonitoringPass('daily');
    const briefing = result.organizations[0].briefing;

    expect(briefing).toBeTruthy();
    // The owner's briefing spans laboratory and operations. What matters is that
    // it is built for a specific role at all: an unscoped digest must never be
    // the thing a delivery adapter picks up and emails to a specialist.
    expect(buildDailyBriefing(data.aiFindings, { role: 'Owner/Admin' }).openCount).toBe(2);
    expect(
      buildDailyBriefing(data.aiFindings, { role: 'Viticulturist' }).openCount,
      'a viticulturist must not inherit the owner briefing',
    ).toBe(0);
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
