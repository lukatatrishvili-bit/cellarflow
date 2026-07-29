import crypto from 'crypto';
import { getPrismaClientForAdmin } from './db';

export type AiMonitoringCadence = 'hourly' | 'daily' | 'weekly';
export type AiMonitoringRunStatus = 'running' | 'completed' | 'failed';

const RUN_LEASE_MS = 15 * 60 * 1_000;

export interface AiMonitoringRunRecord {
  id: string;
  organizationId: string;
  cadence: AiMonitoringCadence;
  windowStart: string;
  status: AiMonitoringRunStatus;
  claimToken: string;
  attemptCount: number;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  evaluated: number;
  created: number;
  escalated: number;
  autoResolved: number;
  outboxQueued: number;
  wineryStatus?: string;
  briefing?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiMonitoringRunSummary {
  evaluated: number;
  created: number;
  escalated: number;
  autoResolved: number;
  outboxQueued: number;
  wineryStatus: string;
  briefing?: string;
}

export interface AiMonitoringOperationsSnapshot {
  backend: 'postgresql' | 'memory';
  counts: Record<AiMonitoringRunStatus, number>;
  staleRunning: number;
  latestCompletedAt?: string;
  recentRuns: AiMonitoringRunRecord[];
}

export type AiMonitoringRunClaim =
  | { outcome: 'claimed'; record: AiMonitoringRunRecord; claimToken: string }
  | { outcome: 'replay' | 'in_progress'; record: AiMonitoringRunRecord };

const localRuns = new Map<string, AiMonitoringRunRecord>();

function runKey(organizationId: string, cadence: AiMonitoringCadence, windowStart: string): string {
  return `${organizationId}:${cadence}:${windowStart}`;
}

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeRun(value: any): AiMonitoringRunRecord {
  return {
    id: String(value.id),
    organizationId: String(value.organizationId),
    cadence: value.cadence as AiMonitoringCadence,
    windowStart: iso(value.windowStart) || new Date(0).toISOString(),
    status: ['running', 'completed', 'failed'].includes(value.status) ? value.status : 'failed',
    claimToken: String(value.claimToken || ''),
    attemptCount: Math.max(1, Number(value.attemptCount) || 1),
    startedAt: iso(value.startedAt) || new Date().toISOString(),
    ...(iso(value.completedAt) ? { completedAt: iso(value.completedAt) } : {}),
    ...(iso(value.failedAt) ? { failedAt: iso(value.failedAt) } : {}),
    evaluated: Math.max(0, Number(value.evaluated) || 0),
    created: Math.max(0, Number(value.created) || 0),
    escalated: Math.max(0, Number(value.escalated) || 0),
    autoResolved: Math.max(0, Number(value.autoResolved) || 0),
    outboxQueued: Math.max(0, Number(value.outboxQueued) || 0),
    ...(typeof value.wineryStatus === 'string' && value.wineryStatus
      ? { wineryStatus: value.wineryStatus }
      : {}),
    ...(typeof value.briefing === 'string' && value.briefing ? { briefing: value.briefing } : {}),
    ...(typeof value.errorMessage === 'string' && value.errorMessage
      ? { errorMessage: value.errorMessage }
      : {}),
    createdAt: iso(value.createdAt) || new Date().toISOString(),
    updatedAt: iso(value.updatedAt) || new Date().toISOString(),
  };
}

/** UTC cadence bucket used as the stable idempotency identity for a scheduled pass. */
export function monitoringWindowStart(
  cadence: AiMonitoringCadence,
  now: Date = new Date(),
): string {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  if (cadence === 'daily' || cadence === 'weekly') start.setUTCHours(0, 0, 0, 0);
  if (cadence === 'weekly') {
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  }
  return start.toISOString();
}

function hasActiveLease(record: AiMonitoringRunRecord, now: Date): boolean {
  return record.status === 'running'
    && now.getTime() - new Date(record.updatedAt).getTime() < RUN_LEASE_MS;
}

async function reserveWithPrisma(
  model: any,
  input: { organizationId: string; cadence: AiMonitoringCadence; windowStart: string },
  now: Date,
  remainingAttempts = 3,
): Promise<AiMonitoringRunClaim> {
  const claimToken = crypto.randomUUID();
  try {
    const created = await model.create({
      data: {
        organizationId: input.organizationId,
        cadence: input.cadence,
        windowStart: new Date(input.windowStart),
        status: 'running',
        claimToken,
        startedAt: now,
      },
    });
    return { outcome: 'claimed', record: normalizeRun(created), claimToken };
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
  }

  const existingValue = await model.findUnique({
    where: {
      organizationId_cadence_windowStart: {
        organizationId: input.organizationId,
        cadence: input.cadence,
        windowStart: new Date(input.windowStart),
      },
    },
  });
  if (!existingValue) {
    if (remainingAttempts <= 0) throw new Error('Could not claim AI monitoring run.');
    return reserveWithPrisma(model, input, now, remainingAttempts - 1);
  }
  const existing = normalizeRun(existingValue);
  if (existing.status === 'completed') return { outcome: 'replay', record: existing };
  if (hasActiveLease(existing, now)) return { outcome: 'in_progress', record: existing };

  const claimed = await model.updateMany({
    where: {
      id: existing.id,
      updatedAt: existingValue.updatedAt,
      status: { in: ['running', 'failed'] },
    },
    data: {
      status: 'running',
      claimToken,
      attemptCount: { increment: 1 },
      startedAt: now,
      completedAt: null,
      failedAt: null,
      errorMessage: null,
      updatedAt: now,
    },
  });
  if (claimed.count !== 1) {
    if (remainingAttempts <= 0) throw new Error('Could not claim AI monitoring run.');
    return reserveWithPrisma(model, input, now, remainingAttempts - 1);
  }
  const record = await model.findUnique({ where: { id: existing.id } });
  return { outcome: 'claimed', record: normalizeRun(record), claimToken };
}

export async function reserveAiMonitoringRun(input: {
  organizationId: string;
  cadence: AiMonitoringCadence;
  windowStart: string;
  now?: Date;
}): Promise<AiMonitoringRunClaim> {
  const now = input.now || new Date();
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiMonitoringRun;
    if (!model) {
      throw new Error('AI monitoring run storage is unavailable. Apply the committed database migration.');
    }
    return reserveWithPrisma(model, input, now);
  }

  const key = runKey(input.organizationId, input.cadence, input.windowStart);
  const existing = localRuns.get(key);
  if (existing?.status === 'completed') return { outcome: 'replay', record: existing };
  if (existing && hasActiveLease(existing, now)) return { outcome: 'in_progress', record: existing };

  const claimToken = crypto.randomUUID();
  const timestamp = now.toISOString();
  const record: AiMonitoringRunRecord = existing || {
    id: `aimr_${crypto.randomUUID()}`,
    organizationId: input.organizationId,
    cadence: input.cadence,
    windowStart: input.windowStart,
    status: 'running',
    claimToken,
    attemptCount: 0,
    startedAt: timestamp,
    evaluated: 0,
    created: 0,
    escalated: 0,
    autoResolved: 0,
    outboxQueued: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  Object.assign(record, {
    status: 'running',
    claimToken,
    attemptCount: record.attemptCount + 1,
    startedAt: timestamp,
    completedAt: undefined,
    failedAt: undefined,
    errorMessage: undefined,
    updatedAt: timestamp,
  });
  localRuns.set(key, record);
  return { outcome: 'claimed', record, claimToken };
}

export async function completeAiMonitoringRun(
  id: string,
  claimToken: string,
  summary: AiMonitoringRunSummary,
  now: Date = new Date(),
): Promise<boolean> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiMonitoringRun;
    if (!model) throw new Error('AI monitoring run storage is unavailable.');
    const result = await model.updateMany({
      where: { id, claimToken, status: 'running' },
      data: {
        status: 'completed',
        ...summary,
        briefing: summary.briefing || null,
        completedAt: now,
        failedAt: null,
        errorMessage: null,
      },
    });
    return result.count === 1;
  }
  const record = [...localRuns.values()].find((item) => item.id === id);
  if (!record || record.status !== 'running' || record.claimToken !== claimToken) return false;
  Object.assign(record, summary, {
    status: 'completed',
    completedAt: now.toISOString(),
    failedAt: undefined,
    errorMessage: undefined,
    updatedAt: now.toISOString(),
  });
  return true;
}

export async function failAiMonitoringRun(
  id: string,
  claimToken: string,
  error: unknown,
  now: Date = new Date(),
): Promise<boolean> {
  const errorMessage = (error instanceof Error ? error.message : String(error || 'unknown error')).slice(0, 1_000);
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiMonitoringRun;
    if (!model) throw new Error('AI monitoring run storage is unavailable.');
    const result = await model.updateMany({
      where: { id, claimToken, status: 'running' },
      data: { status: 'failed', failedAt: now, errorMessage },
    });
    return result.count === 1;
  }
  const record = [...localRuns.values()].find((item) => item.id === id);
  if (!record || record.status !== 'running' || record.claimToken !== claimToken) return false;
  Object.assign(record, {
    status: 'failed',
    failedAt: now.toISOString(),
    errorMessage,
    updatedAt: now.toISOString(),
  });
  return true;
}

/** Bounded, payload-light operational view for the master-admin console. */
export async function getAiMonitoringOperations(
  limit = 25,
  now: Date = new Date(),
): Promise<AiMonitoringOperationsSnapshot> {
  const take = Math.max(1, Math.min(100, Math.floor(limit)));
  const staleBefore = new Date(now.getTime() - RUN_LEASE_MS);
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiMonitoringRun;
    if (!model) throw new Error('AI monitoring run storage is unavailable.');
    const [
      running,
      completed,
      failed,
      staleRunning,
      latestCompleted,
      recent,
    ] = await Promise.all([
      model.count({ where: { status: 'running' } }),
      model.count({ where: { status: 'completed' } }),
      model.count({ where: { status: 'failed' } }),
      model.count({ where: { status: 'running', updatedAt: { lte: staleBefore } } }),
      model.findFirst({
        where: { status: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
      model.findMany({ orderBy: { createdAt: 'desc' }, take }),
    ]);
    return {
      backend: 'postgresql',
      counts: { running, completed, failed },
      staleRunning,
      ...(iso(latestCompleted?.completedAt)
        ? { latestCompletedAt: iso(latestCompleted.completedAt) }
        : {}),
      recentRuns: recent.map(normalizeRun),
    };
  }

  const records = [...localRuns.values()];
  const counts: Record<AiMonitoringRunStatus, number> = {
    running: 0,
    completed: 0,
    failed: 0,
  };
  for (const record of records) counts[record.status] += 1;
  const completedAt = records
    .flatMap((record) => record.completedAt ? [record.completedAt] : [])
    .sort()
    .at(-1);
  return {
    backend: 'memory',
    counts,
    staleRunning: records.filter((record) => (
      record.status === 'running' && new Date(record.updatedAt) <= staleBefore
    )).length,
    ...(completedAt ? { latestCompletedAt: completedAt } : {}),
    recentRuns: records
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, take)
      .map((record) => ({ ...record })),
  };
}

export function __resetInMemoryAiMonitoringRuns(): void {
  localRuns.clear();
}
