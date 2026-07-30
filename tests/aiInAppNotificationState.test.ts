import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AiFindingRecord } from '../lib/ai';
import { aiNotificationEventKey } from '../server/aiInAppNotificationState';

function record(overrides: Partial<AiFindingRecord> = {}): AiFindingRecord {
  return {
    id: 'ai-so2:L1',
    severity: 'warning',
    status: 'new',
    ...overrides,
  } as AiFindingRecord;
}

describe('aiNotificationEventKey', () => {
  it('stays stable across user review lifecycle changes', () => {
    const initial = aiNotificationEventKey(record());
    const reviewed = aiNotificationEventKey(record({
      status: 'reviewed',
      statusChangedAt: '2026-07-30T12:00:00.000Z',
      statusChangedBy: 'nino',
    }));
    const accepted = aiNotificationEventKey(record({
      status: 'accepted',
      statusChangedAt: '2026-07-30T13:00:00.000Z',
      statusChangedBy: 'nino',
    }));

    expect(reviewed).toBe(initial);
    expect(accepted).toBe(initial);
  });

  it('changes for an escalation or a system reopen', () => {
    const initial = aiNotificationEventKey(record());
    const escalated = aiNotificationEventKey(record({ severity: 'critical' }));
    const reopened = aiNotificationEventKey(record({
      status: 'new',
      statusChangedAt: '2026-07-31T08:00:00.000Z',
      statusChangedBy: 'system',
    }));

    expect(escalated).not.toBe(initial);
    expect(reopened).not.toBe(initial);
  });

  it('changes when a persisted model interpretation is replaced', () => {
    const first = aiNotificationEventKey(record({
      source: 'model',
      lastModified: '2026-07-30T08:00:00.000Z',
    }));
    const updated = aiNotificationEventKey(record({
      source: 'model',
      lastModified: '2026-07-30T09:00:00.000Z',
    }));

    expect(updated).not.toBe(first);
  });

  it('ships tenant and user foreign keys with a composite acknowledgement identity', () => {
    const migration = fs.readFileSync(path.resolve(
      'prisma/migrations/20260730230000_ai_in_app_notification_read_state/migration.sql',
    ), 'utf8');

    expect(migration).toContain('CREATE TABLE "AiNotificationReadState"');
    expect(migration).toContain('PRIMARY KEY ("organizationId", "username", "findingId")');
    expect(migration).toContain('REFERENCES "Organization"("id")');
    expect(migration).toContain('REFERENCES "User"("username")');
    expect(migration.match(/ON DELETE CASCADE/g)).toHaveLength(2);
  });

  it('ships a constrained personal in-app severity preference', () => {
    const migration = fs.readFileSync(path.resolve(
      'prisma/migrations/20260730233000_ai_in_app_notification_preferences/migration.sql',
    ), 'utf8');

    expect(migration).toContain('"inAppMinimumSeverity" TEXT NOT NULL DEFAULT \'info\'');
    expect(migration).toContain(
      "CHECK (\"inAppMinimumSeverity\" IN ('info', 'attention', 'warning', 'critical'))",
    );
  });
});
