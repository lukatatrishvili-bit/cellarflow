import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    users: [] as any[],
    memberships: [] as any[],
    orgData: {} as Record<string, any>,
  },
}));

vi.mock('../server/db', () => ({
  getDB: () => mocks.db,
  getPrismaClientForAdmin: async () => null,
}));

import {
  __resetInMemoryAiMonitoringRuns,
  completeAiMonitoringRun,
  failAiMonitoringRun,
  monitoringWindowStart,
  reserveAiMonitoringRun,
} from '../server/aiMonitoringStore';
import {
  __resetInMemoryAiNotificationOutbox,
  claimAiNotificationBatch,
  completeAiNotification,
  enqueueAiFindingNotifications,
  failAiNotification,
} from '../server/aiNotificationOutbox';
import {
  __resetInMemoryAiNotificationPreferences,
  getAiNotificationPreference,
  setAiNotificationPreference,
} from '../server/aiNotificationPreferences';
import type { AiFindingRecord } from '../lib/ai';

function finding(overrides: Partial<AiFindingRecord> = {}): AiFindingRecord {
  return {
    id: 'ai-lab-gap-l1',
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
    title: { en: 'Analysis is overdue', ka: 'ანალიზი დაგვიანებულია' },
    observation: { en: 'No recent analysis is recorded.', ka: 'ბოლო ანალიზი არ არის ჩაწერილი.' },
    whyItMatters: { en: 'A current result is needed.', ka: 'საჭიროა მიმდინარე შედეგი.' },
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
    ...overrides,
  };
}

describe('AI monitoring run leases', () => {
  beforeEach(() => {
    __resetInMemoryAiMonitoringRuns();
  });

  it('uses stable UTC cadence windows', () => {
    const now = new Date('2026-07-29T13:47:22.000Z');
    expect(monitoringWindowStart('hourly', now)).toBe('2026-07-29T13:00:00.000Z');
    expect(monitoringWindowStart('daily', now)).toBe('2026-07-29T00:00:00.000Z');
    expect(monitoringWindowStart('weekly', now)).toBe('2026-07-27T00:00:00.000Z');
  });

  it('deduplicates active and completed runs for one winery window', async () => {
    const input = {
      organizationId: 'org-1',
      cadence: 'daily' as const,
      windowStart: '2026-07-29T00:00:00.000Z',
      now: new Date('2026-07-29T03:00:00.000Z'),
    };
    const first = await reserveAiMonitoringRun(input);
    expect(first.outcome).toBe('claimed');
    expect((await reserveAiMonitoringRun(input)).outcome).toBe('in_progress');
    if (first.outcome !== 'claimed') throw new Error('expected claim');

    expect(await completeAiMonitoringRun(first.record.id, first.claimToken, {
      evaluated: 2,
      created: 1,
      escalated: 0,
      autoResolved: 0,
      outboxQueued: 2,
      wineryStatus: 'attention',
    }, new Date('2026-07-29T03:01:00.000Z'))).toBe(true);
    expect((await reserveAiMonitoringRun({
      ...input,
      now: new Date('2026-07-29T03:02:00.000Z'),
    })).outcome).toBe('replay');
  });

  it('allows a failed run to be reclaimed and rejects its stale token', async () => {
    const input = {
      organizationId: 'org-1',
      cadence: 'hourly' as const,
      windowStart: '2026-07-29T13:00:00.000Z',
      now: new Date('2026-07-29T13:01:00.000Z'),
    };
    const first = await reserveAiMonitoringRun(input);
    if (first.outcome !== 'claimed') throw new Error('expected claim');
    expect(await failAiMonitoringRun(first.record.id, first.claimToken, new Error('save failed'))).toBe(true);

    const retry = await reserveAiMonitoringRun({
      ...input,
      now: new Date('2026-07-29T13:02:00.000Z'),
    });
    expect(retry.outcome).toBe('claimed');
    expect(await completeAiMonitoringRun(first.record.id, first.claimToken, {
      evaluated: 0,
      created: 0,
      escalated: 0,
      autoResolved: 0,
      outboxQueued: 0,
      wineryStatus: 'normal',
    })).toBe(false);
  });
});

describe('AI notification outbox', () => {
  beforeEach(async () => {
    __resetInMemoryAiNotificationOutbox();
    __resetInMemoryAiNotificationPreferences();
    mocks.db.users = [
      { username: 'owner', email: 'owner@example.com', emailVerified: true, accountEnabled: true },
      { username: 'maker', email: 'maker@example.com', emailVerified: true, accountEnabled: true },
      { username: 'lab', email: 'lab@example.com', emailVerified: true, accountEnabled: true },
      { username: 'vine', email: 'vine@example.com', emailVerified: true, accountEnabled: true },
      { username: 'auditor', email: 'audit@example.com', emailVerified: true, accountEnabled: true },
      { username: 'disabled', email: 'off@example.com', emailVerified: true, accountEnabled: false },
    ];
    mocks.db.memberships = [
      { organizationId: 'org-1', userId: 'owner', role: 'Owner/Admin' },
      { organizationId: 'org-1', userId: 'maker', role: 'Winemaker' },
      { organizationId: 'org-1', userId: 'lab', role: 'Lab Technician' },
      { organizationId: 'org-1', userId: 'vine', role: 'Viticulturist' },
      { organizationId: 'org-1', userId: 'auditor', role: 'Read-Only' },
      { organizationId: 'org-1', userId: 'disabled', role: 'Owner/Admin' },
    ];
    for (const username of ['owner', 'maker', 'lab', 'vine', 'auditor', 'disabled']) {
      await setAiNotificationPreference({
        organizationId: 'org-1',
        username,
        emailEnabled: true,
        minimumSeverity: 'warning',
        now: new Date('2026-07-29T09:00:00.000Z'),
      });
    }
  });

  it('defaults to no email consent and records the opt-in time', async () => {
    __resetInMemoryAiNotificationPreferences();
    expect((await getAiNotificationPreference('org-1', 'owner')).emailEnabled).toBe(false);
    const enabled = await setAiNotificationPreference({
      organizationId: 'org-1',
      username: 'owner',
      emailEnabled: true,
      minimumSeverity: 'critical',
      now: new Date('2026-07-29T11:00:00.000Z'),
    });
    expect(enabled.emailEnabledAt).toBe('2026-07-29T11:00:00.000Z');
    expect(enabled.minimumSeverity).toBe('critical');
    expect(await enqueueAiFindingNotifications('org-1', [finding()])).toBe(0);
  });

  it('fans out only to enabled members responsible for the finding and deduplicates replays', async () => {
    const record = finding();
    expect(await enqueueAiFindingNotifications('org-1', [record])).toBe(3);
    expect(await enqueueAiFindingNotifications('org-1', [record])).toBe(0);

    const claimed = await claimAiNotificationBatch(10);
    expect(claimed.map((row) => row.recipientUsername).sort()).toEqual(['lab', 'maker', 'owner']);
    expect(claimed.every((row) => !('evidence' in row.payload))).toBe(true);
  });

  it('requires the active claim token and retries failures with backoff', async () => {
    mocks.db.memberships = [
      { organizationId: 'org-1', userId: 'owner', role: 'Owner/Admin' },
    ];
    await enqueueAiFindingNotifications(
      'org-1',
      [finding()],
      new Date('2026-07-29T10:00:00.000Z'),
    );
    const claimed = await claimAiNotificationBatch(1, new Date('2026-07-29T10:01:00.000Z'));
    expect(claimed).toHaveLength(1);
    const row = claimed[0];

    expect(await completeAiNotification(row.id, 'wrong-token')).toBe(false);
    expect(await failAiNotification(
      row.id,
      row.claimToken!,
      new Error('provider unavailable'),
      new Date('2026-07-29T10:02:00.000Z'),
    )).toBe(true);
    expect(await claimAiNotificationBatch(1, new Date('2026-07-29T10:02:30.000Z'))).toHaveLength(0);
    const retry = await claimAiNotificationBatch(1, new Date('2026-07-29T10:03:01.000Z'));
    expect(retry).toHaveLength(1);
    expect(retry[0].attemptCount).toBe(2);
    expect(await completeAiNotification(retry[0].id, retry[0].claimToken!)).toBe(true);
  });

  it('prioritizes critical events and cancels a recipient whose role changed before delivery', async () => {
    const now = new Date('2026-07-29T10:00:00.000Z');
    await enqueueAiFindingNotifications('org-1', [
      finding(),
      finding({
        id: 'ai-critical-l1',
        dedupeKey: 'critical_lab_gap:L1',
        severity: 'critical',
      }),
    ], now);
    mocks.db.memberships = mocks.db.memberships.map((membership) => (
      membership.userId === 'lab' ? { ...membership, role: 'Read-Only' } : membership
    ));

    const claimed = await claimAiNotificationBatch(10, new Date('2026-07-29T10:01:00.000Z'));
    expect(claimed.some((row) => row.recipientUsername === 'lab')).toBe(false);
    expect(claimed[0].severity).toBe('critical');
  });
});
