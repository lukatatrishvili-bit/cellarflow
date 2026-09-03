/**
 * Growth policy for the append-only collections in the organization state.
 *
 * Every one of these only grows. They are held in memory, mirrored to
 * localStorage, and shipped whole on each sync, so left alone a busy winery
 * walks steadily into the sync ceilings in `server/routes/sync.ts` — and the
 * first symptom is a rejected sync, which is the worst possible moment to
 * discover it.
 *
 * The obvious fix — keep a recent window on the client and fetch history on
 * demand — is NOT uniformly safe here, and this module exists to record exactly
 * why, per collection, so the distinction survives the next optimization pass.
 *
 * The decisive case is `auditLogs`. It is a tamper-evident hash chain:
 * `buildAuditHashChain` recomputes each entry's hash from its predecessor and
 * asserts `chainSequence === index + 1`. Hand it a window starting partway
 * through and the very first entry fails that check, so every record in the
 * chain reads as tampered. Truncating it does not degrade the audit trail — it
 * invalidates it. Anything that reduces what the client holds for `auditLogs`
 * has to move chain verification server-side first.
 *
 * That precondition is now met. `GET /api/audit-trail` verifies the whole
 * stored chain server-side and returns a verified window, so the audit *view*
 * no longer needs the client to hold every record (`server/routes/auditTrail.ts`,
 * `lib/auditTrailPage.ts`). The client still hydrates and syncs the full
 * collection — that has not changed, and the ceiling described above is still
 * the one a busy winery walks into. What changed is that windowing `auditLogs`
 * is now a persistence decision rather than a correctness impossibility.
 */

/** How much freedom we have to drop records from a collection. */
export type RetentionKind =
  /** Hash-chained. Never truncate; a gap invalidates verification. */
  | 'compliance-chain'
  /** Real business history. Not ours to delete; window for display only. */
  | 'business-record'
  /** Superseded UI state with no downstream meaning once terminal. */
  | 'transient';

export interface CollectionRetentionPolicy {
  readonly collection: string;
  readonly kind: RetentionKind;
  /** Field carrying the record's own timestamp. */
  readonly dateField: string;
  /** Statuses after which a `transient` record has served its purpose. */
  readonly terminalStatuses?: readonly string[];
  /** Grace period before an eligible `transient` record may be dropped. */
  readonly pruneAfterDays?: number;
  readonly reason: string;
}

export const RETENTION_POLICIES: readonly CollectionRetentionPolicy[] = [
  {
    collection: 'auditLogs',
    kind: 'compliance-chain',
    dateField: 'timestamp',
    reason:
      'Tamper-evident chain: buildAuditHashChain asserts chainSequence === index + 1, '
      + 'so any truncation makes every entry verify as tampered.',
  },
  {
    collection: 'fermLogs',
    kind: 'business-record',
    dateField: 'date',
    reason: 'Vintage record referenced by lot traceability and passport reports.',
  },
  {
    collection: 'cellarOps',
    kind: 'business-record',
    dateField: 'date',
    reason: 'Operational history backing cost attribution and compliance annexes.',
  },
  {
    collection: 'stockMovements',
    kind: 'business-record',
    dateField: 'date',
    reason: 'Stock ledger; balances are derived by replaying it.',
  },
  {
    collection: 'aiDrafts',
    kind: 'transient',
    dateField: 'createdAt',
    terminalStatuses: ['converted_to_task', 'dismissed'],
    pruneAfterDays: 30,
    reason:
      'AI suggestions. Once converted or dismissed the draft has served its purpose — '
      + 'the resulting task, not the suggestion, is the record worth keeping.',
  },
] as const;

export function retentionPolicyFor(collection: string): CollectionRetentionPolicy | undefined {
  return RETENTION_POLICIES.find(policy => policy.collection === collection);
}

/** Collections that may never be shortened, for any reason. */
export function chainIntegrityCollections(): string[] {
  return RETENTION_POLICIES.filter(p => p.kind === 'compliance-chain').map(p => p.collection);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Records that a `transient` policy allows dropping: terminal status, and older
 * than the grace period. Anything unparsable or without a terminal status is
 * kept — this only ever removes records it can positively justify.
 */
export function prunableTransientRecords(
  collection: string,
  records: ReadonlyArray<Record<string, any>> | undefined,
  now: Date = new Date(),
): Record<string, any>[] {
  const policy = retentionPolicyFor(collection);
  if (!policy || policy.kind !== 'transient') return [];
  if (!Array.isArray(records) || !policy.terminalStatuses || !policy.pruneAfterDays) return [];

  const cutoff = now.getTime() - policy.pruneAfterDays * MS_PER_DAY;
  return records.filter(record => {
    if (!record || typeof record !== 'object') return false;
    if (!policy.terminalStatuses!.includes(record.status)) return false;
    const timestamp = Date.parse(record[policy.dateField]);
    if (!Number.isFinite(timestamp)) return false; // unknown age: keep it
    return timestamp < cutoff;
  });
}

export interface CollectionFootprint {
  readonly collection: string;
  readonly records: number;
  readonly bytes: number;
}

export interface StateFootprint {
  readonly collections: readonly CollectionFootprint[];
  readonly totalRecords: number;
  readonly totalBytes: number;
}

/**
 * Measure what the state actually costs on the wire. Serializing per collection
 * is deliberate: knowing *which* collection is driving growth is the difference
 * between an actionable warning and a number nobody can act on.
 */
export function measureStateFootprint(state: Record<string, any> | null | undefined): StateFootprint {
  const collections: CollectionFootprint[] = [];
  let totalRecords = 0;
  let totalBytes = 0;

  if (state && typeof state === 'object') {
    for (const key of Object.keys(state)) {
      const value = (state as any)[key];
      if (!Array.isArray(value)) continue;
      const bytes = JSON.stringify(value).length;
      collections.push({ collection: key, records: value.length, bytes });
      totalRecords += value.length;
      totalBytes += bytes;
    }
  }

  collections.sort((a, b) => b.bytes - a.bytes);
  return { collections, totalRecords, totalBytes };
}

export type FootprintPressureLevel = 'ok' | 'warn' | 'critical';

export interface FootprintPressure {
  readonly level: FootprintPressureLevel;
  readonly recordsPct: number;
  readonly bytesPct: number;
  /** Collections driving the pressure, largest first. */
  readonly topCollections: readonly CollectionFootprint[];
}

/** Warn well before the wall; a sync rejection is far too late to find out. */
export const FOOTPRINT_WARN_RATIO = 0.6;
export const FOOTPRINT_CRITICAL_RATIO = 0.85;

export function assessFootprintPressure(
  footprint: StateFootprint,
  limits: { maxRecords: number; maxBytes: number },
): FootprintPressure {
  const recordsPct = limits.maxRecords > 0 ? footprint.totalRecords / limits.maxRecords : 0;
  const bytesPct = limits.maxBytes > 0 ? footprint.totalBytes / limits.maxBytes : 0;
  const worst = Math.max(recordsPct, bytesPct);

  const level: FootprintPressureLevel = worst >= FOOTPRINT_CRITICAL_RATIO
    ? 'critical'
    : worst >= FOOTPRINT_WARN_RATIO
      ? 'warn'
      : 'ok';

  return {
    level,
    recordsPct,
    bytesPct,
    topCollections: footprint.collections.slice(0, 3),
  };
}
