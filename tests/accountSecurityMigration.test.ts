import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('account security migration', () => {
  const migration = fs.readFileSync(
    path.resolve('prisma/migrations/20260719193000_account_security/migration.sql'),
    'utf8',
  );

  it('hashes legacy invitation bearer values before renaming the unique index', () => {
    expect(migration).toContain('RENAME COLUMN "token" TO "tokenHash"');
    expect(migration).toContain('encode(sha256(convert_to("tokenHash", \'UTF8\')), \'hex\')');
    expect(migration).toContain('RENAME TO "Invitation_tokenHash_key"');
  });

  it('adds session revocation state and durable security audit storage', () => {
    expect(migration).toContain('"accountEnabled" BOOLEAN NOT NULL DEFAULT true');
    expect(migration).toContain('"sessionVersion" INTEGER NOT NULL DEFAULT 1');
    expect(migration).toContain('CREATE TABLE "SecurityAuditEvent"');
    expect(migration).toContain('"ipHash" TEXT');
  });
});
