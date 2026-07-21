import { describe, expect, it } from 'vitest';
import { assertNoMigrationDrift } from '../scripts/checkMigrationDrift';

const databaseUrl = 'postgresql://cellarflow:super-secret@10.0.0.2:5432/cellarflow';

describe('production migration drift guard', () => {
  it('accepts Prisma exit code zero', () => {
    expect(() => assertNoMigrationDrift({ status: 0, stdout: '', stderr: '' }, databaseUrl)).not.toThrow();
  });

  it('classifies Prisma exit code two as schema drift', () => {
    expect(() => assertNoMigrationDrift({ status: 2, stdout: 'drift', stderr: '' }, databaseUrl))
      .toThrow(/schema drift detected/i);
  });

  it('redacts database URLs when the check cannot complete', () => {
    let thrown: Error | undefined;
    try {
      assertNoMigrationDrift({
        status: 1,
        stdout: '',
        stderr: `Could not connect to ${databaseUrl}`,
      }, databaseUrl);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).toContain('[DATABASE_URL redacted]');
    expect(thrown?.message).not.toContain('super-secret');
  });
});
