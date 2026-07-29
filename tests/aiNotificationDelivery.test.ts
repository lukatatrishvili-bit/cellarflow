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
import { deliverAiNotificationBatch } from '../server/aiNotificationDelivery';
import { buildAiFindingEmail } from '../server/aiNotificationEmail';
import {
  __resetInMemoryAiNotificationOutbox,
  enqueueAiFindingNotifications,
} from '../server/aiNotificationOutbox';
import {
  __resetInMemoryAiNotificationPreferences,
  setAiNotificationPreference,
} from '../server/aiNotificationPreferences';

function finding(overrides: Partial<AiFindingRecord> = {}): AiFindingRecord {
  return {
    id: 'ai-critical-lab-l1',
    createdAt: '2026-07-29T10:00:00.000Z',
    source: 'rule',
    agent: 'laboratory',
    area: 'laboratory',
    findingType: 'lab_gap',
    severity: 'critical',
    entityType: 'lot',
    entityId: 'L1',
    entityLabel: 'Saperavi (L1)',
    relatedEntities: [],
    title: { en: 'Analysis overdue', ka: 'ანალიზი დაგვიანებულია' },
    observation: { en: 'No current analysis is recorded.', ka: 'მიმდინარე ანალიზი არ არის ჩაწერილი.' },
    whyItMatters: { en: 'A release decision needs current chemistry.', ka: 'გაშვების გადაწყვეტილებას მიმდინარე ქიმია სჭირდება.' },
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
    lastNotificationAt: '2026-07-29T10:00:00.000Z',
    occurrences: 1,
    ...overrides,
  };
}

describe('AI notification email delivery', () => {
  beforeEach(async () => {
    __resetInMemoryAiNotificationOutbox();
    __resetInMemoryAiNotificationPreferences();
    mocks.db.users = [{
      username: 'owner',
      email: 'owner@example.com',
      emailVerified: true,
      accountEnabled: true,
      language: 'ka',
    }];
    mocks.db.organizations = [{ id: 'org-1', name: 'Kakheti Cellar' }];
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

  it('delivers a localized alert only after explicit opt-in', async () => {
    expect(await enqueueAiFindingNotifications(
      'org-1',
      [finding()],
      new Date('2026-07-29T10:00:00.000Z'),
    )).toBe(1);
    const mailer = vi.fn(async () => ({ delivered: true as const, transport: 'smtp' as const }));

    const result = await deliverAiNotificationBatch({
      now: new Date('2026-07-29T10:01:00.000Z'),
      appUrl: 'https://cellar.example',
      mailer,
    });

    expect(result).toEqual({
      claimed: 1,
      delivered: 1,
      cancelled: 0,
      retried: 0,
      failed: 0,
    });
    expect(mailer).toHaveBeenCalledWith(expect.objectContaining({
      to: 'owner@example.com',
      subject: expect.stringContaining('კრიტიკული'),
      text: expect.stringContaining('https://cellar.example/'),
    }));
  });

  it('cancels a queued event when the user opts out before delivery', async () => {
    await enqueueAiFindingNotifications('org-1', [finding()]);
    await setAiNotificationPreference({
      organizationId: 'org-1',
      username: 'owner',
      emailEnabled: false,
      minimumSeverity: 'warning',
    });
    const mailer = vi.fn(async () => ({ delivered: true as const, transport: 'smtp' as const }));

    const result = await deliverAiNotificationBatch({ mailer });
    expect(result.cancelled).toBe(1);
    expect(mailer).not.toHaveBeenCalled();
  });

  it('returns transient transport failures to the outbox retry schedule', async () => {
    await enqueueAiFindingNotifications('org-1', [finding()]);
    const result = await deliverAiNotificationBatch({
      mailer: vi.fn(async () => {
        throw new Error('SMTP unavailable');
      }),
    });
    expect(result.retried).toBe(1);
    expect(result.delivered).toBe(0);
  });

  it('escapes model-authored content in HTML and strips subject newlines', () => {
    const message = buildAiFindingEmail({
      to: 'owner@example.com',
      language: 'en',
      wineryName: 'Cellar\r\nBcc: attacker@example.com',
      payload: {
        version: 1,
        findingId: 'F1',
        dedupeKey: 'test:L1',
        source: 'model',
        severity: 'warning',
        area: 'laboratory',
        entityType: 'lot',
        entityId: 'L1',
        entityLabel: '<img src=x onerror=alert(1)>',
        title: { en: 'Review <script>alert(1)</script>', ka: 'ტესტი' },
        observation: { en: '<b>unsafe</b>', ka: 'ტესტი' },
        whyItMatters: { en: 'Check & confirm', ka: 'ტესტი' },
        createdAt: '2026-07-29T10:00:00.000Z',
        lastSeenAt: '2026-07-29T10:00:00.000Z',
        occurrences: 1,
      },
    });
    expect(message.subject).not.toContain('\n');
    expect(message.html).not.toContain('<script>');
    expect(message.html).not.toContain('<img src=x');
    expect(message.html).toContain('&lt;script&gt;');
  });
});
