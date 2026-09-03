import { getPrismaClientForAdmin } from './db';

export interface AiModelBudgetSnapshot {
  used: number;
  remaining: number;
}

export interface AiModelBudgetReservation extends AiModelBudgetSnapshot {
  granted: boolean;
  requested: number;
}

/**
 * Which allowance a call is charged to.
 *
 * A knowledge embedding and a deep multi-agent generation used to cost the same
 * single unit, so a winery with a knowledge base spent its analysis allowance on
 * retrieval. They are metered apart: `maxModelCallsPerDay` still governs
 * generative calls only, and embeddings hold their own, much larger, limit.
 */
export type AiModelBudgetKind = 'generation' | 'embedding';

/**
 * The only source of the column name interpolated into the statements below.
 * A closed union mapped through this constant never carries request input into
 * the SQL string.
 */
const USAGE_COLUMN: Record<AiModelBudgetKind, string> = {
  generation: 'callCount',
  embedding: 'embeddingCount',
};

interface InMemoryUsage {
  date: string;
  counts: Record<AiModelBudgetKind, number>;
}

// Local/GCS development has one process and no relational database. Production
// uses the atomic PostgreSQL path below; this map is deliberately only fallback.
const inMemoryUsage = new Map<string, InMemoryUsage>();

function usageDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function normalizedLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizedRequest(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function fallbackSnapshot(
  organizationId: string,
  limit: number,
  kind: AiModelBudgetKind,
  now: Date,
): AiModelBudgetSnapshot {
  const date = usageDate(now);
  const entry = inMemoryUsage.get(organizationId);
  const used = entry?.date === date ? entry.counts[kind] : 0;
  return { used, remaining: Math.max(0, limit - used) };
}

function reserveFallback(
  organizationId: string,
  limit: number,
  requested: number,
  kind: AiModelBudgetKind,
  now: Date,
): AiModelBudgetReservation {
  const date = usageDate(now);
  const current = fallbackSnapshot(organizationId, limit, kind, now);
  if (requested === 0) return { ...current, granted: true, requested };
  if (current.used + requested > limit) {
    return { ...current, granted: false, requested };
  }
  const used = current.used + requested;
  const entry = inMemoryUsage.get(organizationId);
  const counts = entry?.date === date
    ? { ...entry.counts }
    : { generation: 0, embedding: 0 };
  counts[kind] = used;
  inMemoryUsage.set(organizationId, { date, counts });
  return { used, remaining: Math.max(0, limit - used), granted: true, requested };
}

/**
 * Returns the shared UTC-day usage. PostgreSQL is authoritative whenever it is
 * configured; a database error is allowed to fail closed instead of silently
 * multiplying the budget across application instances.
 */
export async function getAiModelBudget(
  organizationId: string,
  configuredLimit: number,
  now = new Date(),
  kind: AiModelBudgetKind = 'generation',
): Promise<AiModelBudgetSnapshot> {
  const limit = normalizedLimit(configuredLimit);
  const prisma = await getPrismaClientForAdmin();
  if (!prisma) return fallbackSnapshot(organizationId, limit, kind, now);

  const column = USAGE_COLUMN[kind];
  const rows = await (prisma as any).$queryRawUnsafe(
    `SELECT "${column}" AS "used"
       FROM "AiModelCallUsage"
      WHERE "organizationId" = $1
        AND "usageDate" = $2::date`,
    organizationId,
    usageDate(now),
  ) as Array<{ used: number }>;
  const used = Number(rows[0]?.used || 0);
  return { used, remaining: Math.max(0, limit - used) };
}

/**
 * Atomically reserves model calls before sending any request to the provider.
 * Reserving attempts rather than recording successes is conservative: a timed
 * out provider request may still have consumed tokens.
 */
export async function reserveAiModelCalls(
  organizationId: string,
  configuredLimit: number,
  requestedCalls = 1,
  now = new Date(),
  kind: AiModelBudgetKind = 'generation',
): Promise<AiModelBudgetReservation> {
  const limit = normalizedLimit(configuredLimit);
  const requested = normalizedRequest(requestedCalls);
  if (requested === 0) {
    const snapshot = await getAiModelBudget(organizationId, limit, now, kind);
    return { ...snapshot, granted: true, requested };
  }
  if (requested > limit) {
    const snapshot = await getAiModelBudget(organizationId, limit, now, kind);
    return { ...snapshot, granted: false, requested };
  }

  const prisma = await getPrismaClientForAdmin();
  if (!prisma) return reserveFallback(organizationId, limit, requested, kind, now);

  const column = USAGE_COLUMN[kind];
  const date = usageDate(now);
  const rows = await (prisma as any).$queryRawUnsafe(
    `INSERT INTO "AiModelCallUsage"
       ("organizationId", "usageDate", "${column}", "createdAt", "updatedAt")
     VALUES ($1, $2::date, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId", "usageDate")
     DO UPDATE SET
       "${column}" = "AiModelCallUsage"."${column}" + EXCLUDED."${column}",
       "updatedAt" = CURRENT_TIMESTAMP
     WHERE "AiModelCallUsage"."${column}" + EXCLUDED."${column}" <= $4
     RETURNING "${column}" AS "used"`,
    organizationId,
    date,
    requested,
    limit,
  ) as Array<{ used: number }>;

  if (rows.length > 0) {
    const used = Number(rows[0].used);
    return { used, remaining: Math.max(0, limit - used), granted: true, requested };
  }

  // The conditional upsert returns no row when another request consumed the
  // remaining capacity first.
  const snapshot = await getAiModelBudget(organizationId, limit, now, kind);
  return { ...snapshot, granted: false, requested };
}

/** Test-only reset for the local/GCS fallback path. */
export function __resetInMemoryAiModelBudget(): void {
  inMemoryUsage.clear();
}
