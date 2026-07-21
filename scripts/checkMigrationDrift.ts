import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface MigrationDriftCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function redactDatabaseUrl(value: string, databaseUrl: string): string {
  let redacted = databaseUrl ? value.split(databaseUrl).join('[DATABASE_URL redacted]') : value;
  redacted = redacted.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[PostgreSQL URL redacted]');
  return redacted;
}

export function assertNoMigrationDrift(
  result: MigrationDriftCommandResult,
  databaseUrl: string,
): void {
  if (result.status === 0) return;
  if (result.status === 2) {
    throw new Error('Production schema drift detected: the database differs from prisma/schema.prisma.');
  }
  const output = redactDatabaseUrl(`${result.stdout}\n${result.stderr}`.trim(), databaseUrl).slice(0, 4_000);
  throw new Error(`Production schema drift check could not complete.${output ? `\n${output}` : ''}`);
}

function main(): void {
  const databaseUrl = process.env.DATABASE_URL?.trim() || '';
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the production schema drift check.');

  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [
    prismaCli,
    'migrate',
    'diff',
    '--from-url',
    databaseUrl,
    '--to-schema-datamodel',
    'prisma/schema.prisma',
    '--exit-code',
  ], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    env: process.env,
    encoding: 'utf8',
  });

  assertNoMigrationDrift({
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  }, databaseUrl);
  console.log('Production schema matches prisma/schema.prisma.');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
