import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

export const ORGANIZATION_STATE_CHECKSUM_FORMAT = 1;

export interface OrganizationStateChecksumInput {
  organizationId: string;
  data: unknown;
  version: number;
  updatedAt: Date | string;
}

export interface OrganizationStateChecksumEntry {
  organizationKey: string;
  version: number;
  updatedAt: string;
  dataChecksumSha256: string;
}

export interface OrganizationStateChecksumReport {
  formatVersion: typeof ORGANIZATION_STATE_CHECKSUM_FORMAT;
  capturedAt: string;
  organizationCount: number;
  latestStateUpdatedAt: string | null;
  aggregateChecksumSha256: string;
  states: OrganizationStateChecksumEntry[];
}

export interface OrganizationStateChecksumComparison {
  matches: boolean;
  expectedOrganizationCount: number;
  actualOrganizationCount: number;
  changedOrganizationKeys: string[];
  missingOrganizationKeys: string[];
  unexpectedOrganizationKeys: string[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * JSONB object key order is not semantically meaningful. Canonicalizing keys
 * keeps checksums stable across PostgreSQL serialization while preserving
 * array order, primitive types, and every stored value.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Checksum input contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  throw new Error(`Checksum input contains unsupported ${typeof value} data.`);
}

function normalizeTimestamp(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error('OrganizationState has an invalid updatedAt timestamp.');
  return timestamp.toISOString();
}

function pseudonymousOrganizationKey(organizationId: string): string {
  return `org_${sha256(organizationId).slice(0, 20)}`;
}

export function buildOrganizationStateChecksumReport(
  rows: OrganizationStateChecksumInput[],
  capturedAt = new Date().toISOString(),
): OrganizationStateChecksumReport {
  const normalizedCapturedAt = normalizeTimestamp(capturedAt);
  const states = rows.map((row): OrganizationStateChecksumEntry => {
    if (!row.organizationId) throw new Error('OrganizationState is missing organizationId.');
    if (!Number.isSafeInteger(row.version) || row.version < 0) {
      throw new Error('OrganizationState has an invalid version.');
    }
    return {
      organizationKey: pseudonymousOrganizationKey(row.organizationId),
      version: row.version,
      updatedAt: normalizeTimestamp(row.updatedAt),
      dataChecksumSha256: sha256(canonicalJson(row.data)),
    };
  }).sort((left, right) => (
    left.organizationKey < right.organizationKey ? -1 : left.organizationKey > right.organizationKey ? 1 : 0
  ));

  const duplicateKey = states.find((state, index) => (
    index > 0 && state.organizationKey === states[index - 1].organizationKey
  ));
  if (duplicateKey) throw new Error('OrganizationState checksum input contains a duplicate organization.');

  const latestStateUpdatedAt = states.reduce<string | null>((latest, state) => (
    !latest || state.updatedAt > latest ? state.updatedAt : latest
  ), null);

  return {
    formatVersion: ORGANIZATION_STATE_CHECKSUM_FORMAT,
    capturedAt: normalizedCapturedAt,
    organizationCount: states.length,
    latestStateUpdatedAt,
    aggregateChecksumSha256: sha256(canonicalJson(states)),
    states,
  };
}

function assertChecksumReport(value: unknown): asserts value is OrganizationStateChecksumReport {
  const report = value as Partial<OrganizationStateChecksumReport> | null;
  if (
    !report
    || report.formatVersion !== ORGANIZATION_STATE_CHECKSUM_FORMAT
    || typeof report.organizationCount !== 'number'
    || typeof report.aggregateChecksumSha256 !== 'string'
    || !Array.isArray(report.states)
  ) {
    throw new Error('Checksum comparison file has an unsupported format.');
  }
}

export function compareOrganizationStateChecksumReports(
  expected: OrganizationStateChecksumReport,
  actual: OrganizationStateChecksumReport,
): OrganizationStateChecksumComparison {
  assertChecksumReport(expected);
  assertChecksumReport(actual);
  const expectedByKey = new Map(expected.states.map(state => [state.organizationKey, state]));
  const actualByKey = new Map(actual.states.map(state => [state.organizationKey, state]));
  const changedOrganizationKeys: string[] = [];
  const missingOrganizationKeys: string[] = [];
  const unexpectedOrganizationKeys: string[] = [];

  for (const [organizationKey, expectedState] of expectedByKey) {
    const actualState = actualByKey.get(organizationKey);
    if (!actualState) {
      missingOrganizationKeys.push(organizationKey);
    } else if (canonicalJson(expectedState) !== canonicalJson(actualState)) {
      changedOrganizationKeys.push(organizationKey);
    }
  }
  for (const organizationKey of actualByKey.keys()) {
    if (!expectedByKey.has(organizationKey)) unexpectedOrganizationKeys.push(organizationKey);
  }

  changedOrganizationKeys.sort();
  missingOrganizationKeys.sort();
  unexpectedOrganizationKeys.sort();
  const matches = expected.organizationCount === actual.organizationCount
    && expected.aggregateChecksumSha256 === actual.aggregateChecksumSha256
    && changedOrganizationKeys.length === 0
    && missingOrganizationKeys.length === 0
    && unexpectedOrganizationKeys.length === 0;

  return {
    matches,
    expectedOrganizationCount: expected.organizationCount,
    actualOrganizationCount: actual.organizationCount,
    changedOrganizationKeys,
    missingOrganizationKeys,
    unexpectedOrganizationKeys,
  };
}

interface CliOptions {
  outputPath?: string;
  comparePath?: string;
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const next = args[index + 1];
    if (argument === '--output' || argument === '--compare') {
      if (!next || next.startsWith('--')) throw new Error(`${argument} requires a file path.`);
      if (argument === '--output') options.outputPath = next;
      else options.comparePath = next;
      index += 1;
    } else {
      throw new Error(`Unknown checksum option: ${argument}`);
    }
  }
  return options;
}

function readChecksumReport(reportPath: string): OrganizationStateChecksumReport {
  const parsed = JSON.parse(fs.readFileSync(path.resolve(reportPath), 'utf8')) as unknown;
  assertChecksumReport(parsed);
  return parsed;
}

function safeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) message = message.split(databaseUrl).join('[DATABASE_URL redacted]');
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[PostgreSQL URL redacted]');
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required for checksum capture.');

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.organizationState.findMany({
      select: { organizationId: true, data: true, version: true, updatedAt: true },
    });
    const report = buildOrganizationStateChecksumReport(rows);
    if (options.outputPath) {
      fs.writeFileSync(path.resolve(options.outputPath), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8' });
    } else {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    }

    if (options.comparePath) {
      const comparison = compareOrganizationStateChecksumReports(
        readChecksumReport(options.comparePath),
        report,
      );
      process.stdout.write(`${JSON.stringify(comparison)}\n`);
      if (!comparison.matches) process.exitCode = 2;
    }
  } finally {
    await prisma.$disconnect();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
}
