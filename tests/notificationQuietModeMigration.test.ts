import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('notification quiet-mode migration', () => {
  it('adds a default-on master switch and a temporary pause timestamp', () => {
    const migration = fs.readFileSync(path.resolve(
      'prisma/migrations/20260824120000_notification_quiet_mode/migration.sql',
    ), 'utf8');
    expect(migration).toContain('"notificationsEnabled" BOOLEAN NOT NULL DEFAULT true');
    expect(migration).toContain('"notificationsPausedUntil" TIMESTAMP(3)');
    expect(migration).toContain('notificationsEnabled_idx');
  });
});
