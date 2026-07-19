import { describe, expect, it } from 'vitest';
import {
  BASELINE_MIGRATION,
  BASELINE_SCHEMA,
  deployMigrations,
  type PrismaCommandResult,
  type PrismaRunner,
} from '../scripts/deployMigrations';

const result = (status: number, stderr = '', stdout = ''): PrismaCommandResult => ({
  status,
  stdout,
  stderr,
});

function queuedRunner(results: PrismaCommandResult[]): {
  run: PrismaRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    run: (args) => {
      calls.push(args);
      const next = results.shift();
      if (!next) throw new Error(`Unexpected Prisma command: ${args.join(' ')}`);
      return next;
    },
  };
}

describe('controlled Prisma migration deployment', () => {
  it('deploys pending migrations without invoking baseline logic', () => {
    const runner = queuedRunner([result(0)]);

    expect(deployMigrations(runner.run, true)).toBe('deployed');
    expect(runner.calls).toEqual([['migrate', 'deploy']]);
  });

  it('does not reinterpret an ordinary migration failure as a baseline case', () => {
    const runner = queuedRunner([result(1, 'P3018 migration failed')]);

    expect(() => deployMigrations(runner.run, true)).toThrow(/P3018/);
    expect(runner.calls).toHaveLength(1);
  });

  it('requires explicit authorization before baselining a non-empty database', () => {
    const runner = queuedRunner([result(1, 'Error: P3005 database schema is not empty')]);

    expect(() => deployMigrations(runner.run, false)).toThrow(/PRISMA_BASELINE_EXISTING_SCHEMA/);
    expect(runner.calls).toHaveLength(1);
  });

  it('refuses to baseline when the live schema has drift', () => {
    const runner = queuedRunner([
      result(1, 'Error: P3005 database schema is not empty'),
      result(2, '', 'Changed table: User'),
    ]);

    expect(() => deployMigrations(runner.run, true)).toThrow(/refusing to baseline/i);
    expect(runner.calls).toHaveLength(2);
  });

  it('registers the reviewed baseline only for an exact schema match', () => {
    const runner = queuedRunner([
      result(1, 'Error: P3005 database schema is not empty'),
      result(0),
      result(0),
      result(0),
    ]);

    expect(deployMigrations(runner.run, true)).toBe('baselined');
    expect(runner.calls).toEqual([
      ['migrate', 'deploy'],
      [
        'migrate',
        'diff',
        '--from-schema-datasource',
        'prisma/schema.prisma',
      '--to-schema-datamodel',
      BASELINE_SCHEMA,
        '--exit-code',
      ],
      ['migrate', 'resolve', '--applied', BASELINE_MIGRATION],
      ['migrate', 'deploy'],
    ]);
  });
});
