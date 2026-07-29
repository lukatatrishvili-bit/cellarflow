import { getPrismaClientForAdmin } from './db';

export interface AiModelBudgetSnapshot {
  used: number;
  remaining: number;
}

export interface AiModelBudgetReservation extends AiModelBudgetSnapshot {
  granted: boolean;
  requested: number;
}

interface InMemoryUsage {
  date: string;
  count: number;
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

function fallbackSnapshot(organizationId: string, limit: number, now: Date): AiModelBudgetSnapshot {
  const date = usageDate(now);
  const entry = inMemoryUsage.get(organizationId);
  const used = entry?.date === date ? entry.count : 0;
  return { used, remaining: Math.max(0, limit - used) };
}

function reserveFallback(
  organizationId: string,
  limit: number,
  requested: number,
  now: Date,
): AiModelBudgetReservation {
  const date = usageDate(now);
  const current = fallbackSnapshot(organizationId, limit, now);
  if (requested === 0) return { ...current, granted: true, requested };
  if (current.used + requested > limit) {
    return { ...current, granted: false, requested };
  }
  const used = current.used + requested;
  inMemoryUsage.set(organizationId, { date, count: used });
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
): Promise<AiModelBudgetSnapshot> {
  const limit = normalizedLimit(configuredLimit);
  const prisma = await getPrismaClientForAdmin();
  if (!prisma) return fallbackSnapshot(organizationId, limit, now);

  const rows = await (prisma as any).$queryRawUnsafe(
    `SELECT "callCount"
       FROM "AiModelCallUsage"
      WHERE "organizationId" = $1
        AND "usageDate" = $2::date`,
    organizationId,
    usageDate(now),
  ) as Array<{ callCount: number }>;
  const used = Number(rows[0]?.callCount || 0);
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
): Promise<AiModelBudgetReservation> {
  const limit = normalizedLimit(configuredLimit);
  const requested = normalizedRequest(requestedCalls);
  if (requested === 0) {
    const snapshot = await getAiModelBudget(organizationId, limit, now);
    return { ...snapshot, granted: true, requested };
  }
  if (requested > limit) {
    const snapshot = await getAiModelBudget(organizationId, limit, now);
    return { ...snapshot, granted: false, requested };
  }

  const prisma = await getPrismaClientForAdmin();
  if (!prisma) return reserveFallback(organizationId, limit, requested, now);

  const date = usageDate(now);
  const rows = await (prisma as any).$queryRawUnsafe(
    `INSERT INTO "AiModelCallUsage"
       ("organizationId", "usageDate", "callCount", "createdAt", "updatedAt")
     VALUES ($1, $2::date, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId", "usageDate")
     DO UPDATE SET
       "callCount" = "AiModelCallUsage"."callCount" + EXCLUDED."callCount",
       "updatedAt" = CURRENT_TIMESTAMP
     WHERE "AiModelCallUsage"."callCount" + EXCLUDED."callCount" <= $4
     RETURNING "callCount"`,
    organizationId,
    date,
    requested,
    limit,
  ) as Array<{ callCount: number }>;

  if (rows.length > 0) {
    const used = Number(rows[0].callCount);
    return { used, remaining: Math.max(0, limit - used), granted: true, requested };
  }

  // The conditional upsert returns no row when another request consumed the
  // remaining capacity first.
  const snapshot = await getAiModelBudget(organizationId, limit, now);
  return { ...snapshot, granted: false, requested };
}

/** Test-only reset for the local/GCS fallback path. */
export function __resetInMemoryAiModelBudget(): void {
  inMemoryUsage.clear();
}
