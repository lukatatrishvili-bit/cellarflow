import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_MIGRATION = '20260719000000_baseline';
export const BASELINE_SCHEMA = 'prisma/baseline.prisma';

export interface PrismaCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type PrismaRunner = (args: string[]) => PrismaCommandResult;

function commandOutput(result: PrismaCommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function requireSuccess(result: PrismaCommandResult, operation: string): void {
  if (result.status === 0) return;
  const output = commandOutput(result);
  throw new Error(`${operation} failed.${output ? `\n${output}` : ''}`);
}

/**
 * Apply committed migrations. For the one-time transition from `prisma db push`,
 * a P3005 database may be baselined only when Prisma reports zero drift from
 * the reviewed schema snapshot represented by the baseline migration.
 */
export function deployMigrations(
  runPrisma: PrismaRunner,
  allowMatchingSchemaBaseline: boolean,
): 'deployed' | 'baselined' {
  const initialDeploy = runPrisma(['migrate', 'deploy']);
  if (initialDeploy.status === 0) return 'deployed';

  const initialOutput = commandOutput(initialDeploy);
  if (!/P3005/.test(initialOutput)) {
    throw new Error(`Prisma migration deploy failed.\n${initialOutput}`);
  }
  if (!allowMatchingSchemaBaseline) {
    throw new Error(
      'The database is non-empty and has no migration history. Set '
      + 'PRISMA_BASELINE_EXISTING_SCHEMA=true only for the reviewed baseline rollout.',
    );
  }

  const driftCheck = runPrisma([
    'migrate',
    'diff',
    '--from-schema-datasource',
    'prisma/schema.prisma',
    '--to-schema-datamodel',
    BASELINE_SCHEMA,
    '--exit-code',
  ]);
  if (driftCheck.status === 2) {
    throw new Error(
      `The live database differs from the reviewed baseline schema; refusing to baseline.\n${commandOutput(driftCheck)}`,
    );
  }
  requireSuccess(driftCheck, 'Prisma baseline drift check');

  requireSuccess(
    runPrisma(['migrate', 'resolve', '--applied', BASELINE_MIGRATION]),
    'Prisma baseline registration',
  );
  requireSuccess(runPrisma(['migrate', 'deploy']), 'Prisma migration deploy after baselining');
  return 'baselined';
}

function defaultPrismaRunner(args: string[]): PrismaCommandResult {
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    env: process.env,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  };
}

function main(): void {
  try {
    const outcome = deployMigrations(
      defaultPrismaRunner,
      process.env.PRISMA_BASELINE_EXISTING_SCHEMA === 'true',
    );
    console.log(outcome === 'baselined'
      ? `Registered ${BASELINE_MIGRATION} against the matching existing schema and deployed pending migrations.`
      : 'Prisma migrations deployed successfully.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
