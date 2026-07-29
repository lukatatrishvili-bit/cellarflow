import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    users: [] as any[],
    organizations: [] as any[],
    memberships: [] as any[],
    orgData: {} as Record<string, any>,
  },
}));

vi.mock('../server/db', () => ({
  getDB: () => mocks.db,
  getPrismaClientForAdmin: async () => null,
}));

import type { AiFindingRecord } from '../lib/ai';
import { getAiOperationsSnapshot } from '../server/aiOperations';
import {
  __resetInMemoryAiMonitoringRuns,
  failAiMonitoringRun,
  reserveAiMonitoringRun,
} from '../server/aiMonitoringStore';
import {
  __resetInMemoryAiNotificationOutbox,
  claimAiNotificationBatch,
  enqueueAiFindingNotifications,
  failAiNotification,
  getAiNotificationOutboxOperations,
  retryFailedAiNotification,
} from '../server/aiNotificationOutbox';
import {
  __resetInMemoryAiNotificationPreferences,
  setAiNotificationPreference,
} from '../server/aiNotificationPreferences';

function finding(): AiFindingRecord {
  return {
    id: 'ai-ops-finding',
    createdAt: '2026-07-29T10:00:00.000Z',
    source: 'rule',
    agent: 'laboratory',
    area: 'laboratory',
    findingType: 'lab_gap',
    severity: 'warning',
    entityType: 'lot',
    entityId: 'L1',
    entityLabel: 'Saperavi (L1)',
    relatedEntities: [],
    title: { en: 'Analysis overdue', ka: 'ანალიზი დაგვიანებულია' },
    observation: { en: 'No recent analysis.', ka: 'ბოლო ანალიზი არ არის.' },
    whyItMatters: { en: 'Review is needed.', ka: 'საჭიროა გადახედვა.' },
    possibleCauses: [],
    recommendedActions: [],
    evidence: [],
    confidence: { level: 'high', score: 1, reasons: [] },
    missingInformation: [],
    requiresHumanConfirmation: true,
    roles: [],
    cooldownHours: 24,
    dedupeKey: 'lab_gap:L1',
    status: 'new',
    lastSeenAt: '2026-07-29T10:00:00.000Z',
    occurrences: 1,
    lastModified: '2026-07-29T10:00:00.000Z',
  };
}

async function createTerminalFailure(): Promise<string> {
  await enqueueAiFindingNotifications(
    'org-1',
    [finding()],
    new Date('2026-07-29T10:00:00.000Z'),
  );
  let claimAt = new Date('2026-07-29T10:01:00.000Z');
  let id = '';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const claimed = await claimAiNotificationBatch(1, claimAt);
    expect(claimed).toHaveLength(1);
    id = claimed[0].id;
    const failAt = new Date(claimAt.getTime() + 1_000);
    expect(await failAiNotification(id, claimed[0].claimToken!, new Error('SMTP unavailable'), failAt)).toBe(true);
    const retryDelayMinutes = Math.min(60, 2 ** Math.max(0, attempt - 1));
    claimAt = new Date(failAt.getTime() + retryDelayMinutes * 60_000 + 1_000);
  }
  return id;
}

describe('AI operations health and recovery', () => {
  beforeEach(async () => {
    __resetInMemoryAiMonitoringRuns();
    __resetInMemoryAiNotificationOutbox();
    __resetInMemoryAiNotificationPreferences();
    mocks.db.users = [{
      username: 'owner',
      email: 'owner@example.com',
      emailVerified: true,
      accountEnabled: true,
      language: 'en',
    }];
    mocks.db.organizations = [{ id: 'org-1', name: 'Operations Winery' }];
    mocks.db.memberships = [{
      organizationId: 'org-1',
      userId: 'owner',
      role: 'Owner/Admin',
    }];
    await setAiNotificationPreference({
      organizationId: 'org-1',
      username: 'owner',
      emailEnabled: true,
      minimumSeverity: 'warning',
      now: new Date('2026-07-29T09:00:00.000Z'),
    });
  });

  it('reports stale leases as critical without exposing message payloads', async () => {
    const claim = await reserveAiMonitoringRun({
      organizationId: 'org-1',
      cadence: 'hourly',
      windowStart: '2026-07-29T10:00:00.000Z',
      now: new Date('2026-07-29T10:01:00.000Z'),
    });
    expect(claim.outcome).toBe('claimed');
    const snapshot = await getAiOperationsSnapshot(
      20,
      new Date('2026-07-29T10:20:00.000Z'),
    );

    expect(snapshot.health).toBe('critical');
    expect(snapshot.monitoring.staleRunning).toBe(1);
    expect(snapshot.organizations['org-1']).toBe('Operations Winery');
  });

  it('requeues a terminal failure only while the recipient remains eligible', async () => {
    const id = await createTerminalFailure();
    const failed = await getAiNotificationOutboxOperations(
      20,
      new Date('2026-07-29T11:00:00.000Z'),
    );
    expect(failed.counts.failed).toBe(1);
    expect(failed.recentFailures[0]).not.toHaveProperty('payload');
    expect(failed.recentFailures[0]).not.toHaveProperty('claimToken');

    const retried = await retryFailedAiNotification(
      id,
      new Date('2026-07-29T11:01:00.000Z'),
    );
    expect(retried).toEqual(expect.objectContaining({ outcome: 'queued' }));
    if (retried.outcome !== 'queued') throw new Error('expected queued retry');
    expect(retried.record.attemptCount).toBe(0);

    const queued = await getAiNotificationOutboxOperations(
      20,
      new Date('2026-07-29T11:01:00.000Z'),
    );
    expect(queued.counts.failed).toBe(0);
    expect(queued.readyToDeliver).toBe(1);
  });

  it('rejects manual retry after the recipient opts out', async () => {
    const id = await createTerminalFailure();
    await setAiNotificationPreference({
      organizationId: 'org-1',
      username: 'owner',
      emailEnabled: false,
      minimumSeverity: 'warning',
      now: new Date('2026-07-29T11:00:00.000Z'),
    });
    await expect(retryFailedAiNotification(id)).resolves.toEqual({
      outcome: 'ineligible',
      reason: 'Email alerts are not enabled for this winery.',
    });
  });

  it('reports failed monitoring passes as requiring attention', async () => {
    const claim = await reserveAiMonitoringRun({
      organizationId: 'org-1',
      cadence: 'daily',
      windowStart: '2026-07-29T00:00:00.000Z',
      now: new Date('2026-07-29T03:00:00.000Z'),
    });
    if (claim.outcome !== 'claimed') throw new Error('expected monitoring claim');
    await failAiMonitoringRun(
      claim.record.id,
      claim.claimToken,
      new Error('persistence unavailable'),
      new Date('2026-07-29T03:01:00.000Z'),
    );
    expect((await getAiOperationsSnapshot(
      20,
      new Date('2026-07-29T03:02:00.000Z'),
    )).health).toBe('attention');
  });
});
