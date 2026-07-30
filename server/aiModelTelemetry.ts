import crypto from 'crypto';
import { getPrismaClientForAdmin } from './db';

export type AiModelCallPurpose =
  | 'analysis'
  | 'ask_planner'
  | 'ask_explanation'
  | 'knowledge_embedding';
export type AiModelCallStatus = 'running' | 'succeeded' | 'invalid_response' | 'failed';
export type AiModelErrorCategory =
  | 'authentication'
  | 'rate_limited'
  | 'timeout'
  | 'provider'
  | 'unknown';

export interface AiModelCallTelemetryRecord {
  id: string;
  organizationId: string;
  purpose: AiModelCallPurpose;
  agent?: string;
  model: string;
  status: AiModelCallStatus;
  errorCategory?: AiModelErrorCategory;
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
}

export interface AiModelCallPurposeSummary {
  total: number;
  succeeded: number;
  invalidResponse: number;
  failed: number;
}

export interface AiModelCallOperationsSnapshot {
  backend: 'postgresql' | 'memory';
  today: AiModelCallPurposeSummary & {
    successRate: number;
    averageLatencyMs: number;
  };
  byPurpose: Record<AiModelCallPurpose, AiModelCallPurposeSummary>;
  staleRunning: number;
  latestCompletedAt?: string;
  recentFailures: AiModelCallTelemetryRecord[];
}

export interface AiModelCallResult<T> {
  value: T;
  valid: boolean;
}

const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const RUNNING_STALE_MS = 5 * 60 * 1_000;
const localCalls = new Map<string, AiModelCallTelemetryRecord>();
let lastPrunedKey = '';

function emptyPurposeSummary(): AiModelCallPurposeSummary {
  return { total: 0, succeeded: 0, invalidResponse: 0, failed: 0 };
}

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeStatus(value: unknown): AiModelCallStatus {
  return ['running', 'succeeded', 'invalid_response', 'failed'].includes(String(value))
    ? value as AiModelCallStatus
    : 'failed';
}

function normalizeRecord(value: any): AiModelCallTelemetryRecord {
  return {
    id: String(value.id),
    organizationId: String(value.organizationId),
    purpose: value.purpose as AiModelCallPurpose,
    ...(typeof value.agent === 'string' && value.agent ? { agent: value.agent } : {}),
    model: String(value.model),
    status: normalizeStatus(value.status),
    ...(typeof value.errorCategory === 'string' && value.errorCategory
      ? { errorCategory: value.errorCategory as AiModelErrorCategory }
      : {}),
    startedAt: iso(value.startedAt) || new Date(0).toISOString(),
    ...(iso(value.completedAt) ? { completedAt: iso(value.completedAt) } : {}),
    ...(Number.isFinite(Number(value.latencyMs))
      ? { latencyMs: Math.max(0, Math.floor(Number(value.latencyMs))) }
      : {}),
  };
}

function classifyError(error: unknown): AiModelErrorCategory {
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  } | null;
  const name = String(candidate?.name || '').toLowerCase();
  const code = String(candidate?.code || '').toLowerCase();
  const status = Number(candidate?.status || candidate?.statusCode || 0);
  if (status === 401 || status === 403 || code.includes('auth')) return 'authentication';
  if (status === 429 || code.includes('rate')) return 'rate_limited';
  if (
    status === 408
    || name.includes('timeout')
    || code.includes('timeout')
    || code === 'etimedout'
  ) return 'timeout';
  if (status >= 400 || code.startsWith('e')) return 'provider';
  return 'unknown';
}

async function pruneIfNeeded(prisma: any, now: Date): Promise<void> {
  const utcDate = now.toISOString().slice(0, 10);
  const pruneKey = `${prisma ? 'postgresql' : 'memory'}:${utcDate}`;
  if (lastPrunedKey === pruneKey) return;
  const before = new Date(now.getTime() - RETENTION_MS);
  if (prisma) {
    const model = prisma.aiModelCallTelemetry;
    if (!model) {
      throw new Error('AI model telemetry storage is unavailable. Apply the committed database migration.');
    }
    await model.deleteMany({ where: { startedAt: { lt: before } } });
  } else {
    for (const [id, record] of localCalls) {
      if (new Date(record.startedAt) < before) localCalls.delete(id);
    }
  }
  lastPrunedKey = pruneKey;
}

async function beginCall(input: {
  organizationId: string;
  purpose: AiModelCallPurpose;
  agent?: string;
  model: string;
  now: Date;
}): Promise<AiModelCallTelemetryRecord> {
  const prisma = await getPrismaClientForAdmin();
  await pruneIfNeeded(prisma, input.now);
  const record: AiModelCallTelemetryRecord = {
    id: `aimc_${crypto.randomUUID()}`,
    organizationId: input.organizationId,
    purpose: input.purpose,
    ...(input.agent ? { agent: input.agent.slice(0, 80) } : {}),
    model: input.model.slice(0, 120),
    status: 'running',
    startedAt: input.now.toISOString(),
  };
  if (prisma) {
    const model = (prisma as any).aiModelCallTelemetry;
    if (!model) throw new Error('AI model telemetry storage is unavailable.');
    return normalizeRecord(await model.create({
      data: {
        ...record,
        startedAt: input.now,
      },
    }));
  }
  localCalls.set(record.id, record);
  return record;
}

async function finishCall(
  record: AiModelCallTelemetryRecord,
  status: Exclude<AiModelCallStatus, 'running'>,
  completedAt: Date,
  errorCategory?: AiModelErrorCategory,
): Promise<void> {
  const latencyMs = Math.max(0, completedAt.getTime() - new Date(record.startedAt).getTime());
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiModelCallTelemetry;
    if (!model) return;
    await model.updateMany({
      where: { id: record.id, status: 'running' },
      data: {
        status,
        completedAt,
        latencyMs,
        errorCategory: errorCategory || null,
      },
    });
    return;
  }
  const current = localCalls.get(record.id);
  if (!current || current.status !== 'running') return;
  Object.assign(current, {
    status,
    completedAt: completedAt.toISOString(),
    latencyMs,
    errorCategory,
  });
}

/**
 * Observes one provider call without retaining its input or output. Telemetry
 * failure never prevents the model call itself; model failure is still rethrown.
 */
export async function withAiModelCallTelemetry<T>(
  input: {
    organizationId: string;
    purpose: AiModelCallPurpose;
    agent?: string;
    model: string;
    now?: () => Date;
  },
  operation: () => Promise<AiModelCallResult<T>>,
): Promise<T> {
  const clock = input.now || (() => new Date());
  let record: AiModelCallTelemetryRecord | null = null;
  try {
    record = await beginCall({ ...input, now: clock() });
  } catch (error) {
    console.warn(
      '[ai-model-telemetry] Could not start call telemetry:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }

  try {
    const result = await operation();
    if (record) {
      await finishCall(record, result.valid ? 'succeeded' : 'invalid_response', clock())
        .catch(() => undefined);
    }
    return result.value;
  } catch (error) {
    if (record) {
      await finishCall(record, 'failed', clock(), classifyError(error))
        .catch(() => undefined);
    }
    throw error;
  }
}

/** Bounded, content-free operational view for the master-admin console. */
export async function getAiModelCallOperations(
  limit = 25,
  now: Date = new Date(),
): Promise<AiModelCallOperationsSnapshot> {
  const take = Math.max(1, Math.min(100, Math.floor(limit)));
  const todayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1_000);
  const staleBefore = new Date(now.getTime() - RUNNING_STALE_MS);
  const prisma = await getPrismaClientForAdmin();

  if (prisma) {
    const model = (prisma as any).aiModelCallTelemetry;
    if (!model) throw new Error('AI model telemetry storage is unavailable.');
    const dayWhere = { startedAt: { gte: todayStart, lt: tomorrowStart } };
    const [groups, latency, staleRunning, latestCompleted, recentFailures] = await Promise.all([
      model.groupBy({
        by: ['purpose', 'status'],
        where: dayWhere,
        _count: { _all: true },
      }),
      model.aggregate({
        where: { ...dayWhere, completedAt: { not: null } },
        _avg: { latencyMs: true },
      }),
      model.count({
        where: { ...dayWhere, status: 'running', startedAt: { gte: todayStart, lte: staleBefore } },
      }),
      model.findFirst({
        where: { ...dayWhere, completedAt: { not: null } },
        orderBy: { completedAt: 'desc' },
      }),
      model.findMany({
        where: {
          ...dayWhere,
          status: { in: ['failed', 'invalid_response'] },
        },
        orderBy: { startedAt: 'desc' },
        take,
      }),
    ]);
    const byPurpose: Record<AiModelCallPurpose, AiModelCallPurposeSummary> = {
      analysis: emptyPurposeSummary(),
      ask_planner: emptyPurposeSummary(),
      ask_explanation: emptyPurposeSummary(),
      knowledge_embedding: emptyPurposeSummary(),
    };
    const today = emptyPurposeSummary() as AiModelCallOperationsSnapshot['today'];
    for (const group of groups) {
      const count = Math.max(0, Number(group?._count?._all) || 0);
      const purpose = group.purpose as AiModelCallPurpose;
      const target = byPurpose[purpose] || byPurpose.analysis;
      target.total += count;
      today.total += count;
      if (group.status === 'succeeded') {
        target.succeeded += count;
        today.succeeded += count;
      } else if (group.status === 'invalid_response') {
        target.invalidResponse += count;
        today.invalidResponse += count;
      } else if (group.status === 'failed') {
        target.failed += count;
        today.failed += count;
      }
    }
    const completed = today.succeeded + today.invalidResponse + today.failed;
    today.successRate = completed > 0 ? today.succeeded / completed : 0;
    today.averageLatencyMs = Math.max(0, Math.round(Number(latency?._avg?.latencyMs) || 0));
    return {
      backend: 'postgresql',
      today,
      byPurpose,
      staleRunning: Math.max(0, Number(staleRunning) || 0),
      latestCompletedAt: iso(latestCompleted?.completedAt),
      recentFailures: recentFailures.map(normalizeRecord),
    };
  }

  const records = [...localCalls.values()]
    .filter((record) => {
      const startedAt = new Date(record.startedAt);
      return startedAt >= todayStart && startedAt < tomorrowStart;
    })
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const byPurpose: Record<AiModelCallPurpose, AiModelCallPurposeSummary> = {
    analysis: emptyPurposeSummary(),
    ask_planner: emptyPurposeSummary(),
    ask_explanation: emptyPurposeSummary(),
    knowledge_embedding: emptyPurposeSummary(),
  };
  const today = emptyPurposeSummary() as AiModelCallOperationsSnapshot['today'];
  const completedLatencies: number[] = [];
  for (const record of records) {
    const target = byPurpose[record.purpose] || byPurpose.analysis;
    target.total += 1;
    today.total += 1;
    if (record.status === 'succeeded') {
      target.succeeded += 1;
      today.succeeded += 1;
    } else if (record.status === 'invalid_response') {
      target.invalidResponse += 1;
      today.invalidResponse += 1;
    } else if (record.status === 'failed') {
      target.failed += 1;
      today.failed += 1;
    }
    if (record.latencyMs !== undefined) completedLatencies.push(record.latencyMs);
  }
  const completed = today.succeeded + today.invalidResponse + today.failed;
  today.successRate = completed > 0 ? today.succeeded / completed : 0;
  today.averageLatencyMs = completedLatencies.length > 0
    ? Math.round(completedLatencies.reduce((sum, value) => sum + value, 0) / completedLatencies.length)
    : 0;

  return {
    backend: 'memory',
    today,
    byPurpose,
    staleRunning: records.filter((record) => (
      record.status === 'running' && new Date(record.startedAt) <= staleBefore
    )).length,
    latestCompletedAt: records.find((record) => record.completedAt)?.completedAt,
    recentFailures: records
      .filter((record) => record.status === 'failed' || record.status === 'invalid_response')
      .slice(0, take),
  };
}

export function __resetInMemoryAiModelTelemetry(): void {
  localCalls.clear();
  lastPrunedKey = '';
}
