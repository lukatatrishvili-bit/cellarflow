/**
 * Pure merge logic for /api/sync, extracted for testability.
 *
 * Conflict model (optimistic concurrency):
 * - Items the client actually edited carry `baselineTimestamp` — the
 *   `lastModified` of the server version the edit was based on.
 * - If that baseline matches the server's current `lastModified`, the edit is
 *   a clean fast-forward and is applied.
 * - If it doesn't match, someone else changed the record in between: the edit
 *   is NOT applied and a conflict is reported for the user to resolve.
 * - Items without a baseline (new records, or stale copies the client never
 *   touched) fall back to last-write-wins by `lastModified`, silently — a
 *   stale untouched copy losing to a newer server version is not a conflict.
 */

export interface SyncConflict {
  collection: string; // client-side collection key (e.g. 'fermLogs', 'notesList')
  recordId: string;
  local: any;
  server: any;
}

/**
 * Counts of what actually happened to each record in a merge.
 *
 * This exists to answer two questions with evidence instead of intuition,
 * recorded in `docs/scale-out-and-delta-sync-design-2026-08-13.md`:
 *
 *   1. Is three-way field merge worth keeping? Its baselines live in the
 *      process-memory `documentHistory` map, which is the one piece of state
 *      that makes running a second instance change user-visible behaviour: an
 *      instance without the baseline reports a conflict where the merge would
 *      have succeeded. Persisting those baselines is real work, and deleting
 *      the merge is real regression — the ratio below decides which is right.
 *      `baselineUnavailable` is the decisive number: it is how often the merge
 *      ALREADY fails for want of history on a single instance, and it is what
 *      every stale-baseline merge would become at N>1.
 *
 *   2. How much of a sync payload is redundant? `unchanged` counts records the
 *      client sent that the server already had byte-identical. Sync ships whole
 *      collections, so this is the size of the prize for per-record deltas.
 *
 * Counts only; no ids, no field names, no tenant data.
 */
export interface MergeOutcomeTally {
  /** Record did not exist server-side. */
  newRecord: number;
  /** Client sent a record the server already had, unchanged. */
  unchanged: number;
  /** Client's baseline matched the server: applied as-is. */
  cleanFastForward: number;
  /** Stale baseline, history found, edits touched different fields: merged. */
  fieldMergeApplied: number;
  /** Stale baseline, history found, both edited the same field: conflict. */
  sameFieldConflict: number;
  /** Stale baseline, no baseline in history: conflict the merge could not judge. */
  baselineUnavailable: number;
  /** No baseline on the wire: last-write-wins, never reported as a conflict. */
  legacyLastWriteWins: number;
}

export function createMergeOutcomeTally(): MergeOutcomeTally {
  return {
    newRecord: 0,
    unchanged: 0,
    cleanFastForward: 0,
    fieldMergeApplied: 0,
    sameFieldConflict: 0,
    baselineUnavailable: 0,
    legacyLastWriteWins: 0,
  };
}

// The client state hook and the DB disagree on some collection names.
const SERVER_TO_CLIENT_KEY: Record<string, string> = {
  notes: 'notesList',
  fermlogs: 'fermLogs',
  lablogs: 'labLogs',
};

export function toClientKey(serverKey: string): string {
  return SERVER_TO_CLIENT_KEY[serverKey] || serverKey;
}

/**
 * Validates a record id. Allows Unicode letters/numbers — Georgian vessel and
 * lot names (e.g. "ქვევრი 1") are legitimate ids — plus space, underscore and
 * hyphen. Rejects control characters and path/query separators so ids stay safe
 * in URLs and filenames.
 */
export function isValidId(id: any): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[\p{L}\p{N}_\- ]+$/u.test(id);
}

export interface DeletedRecordRef {
  id: string;
  collection: string;
  baselineTimestamp?: string;
  baselineFingerprint?: string;
  deletedAt?: string;
}

export interface DeletionMatcher {
  hasDeletions: boolean;
  isDeleted: (collection: string, id: unknown) => boolean;
}

/**
 * Collection-aware tombstones prevent a record ID reused by another
 * collection from being deleted accidentally. Legacy deletedIds remain
 * wildcard tombstones for backwards compatibility with older clients.
 */
export function createDeletionMatcher(
  deletedIds: unknown,
  deletedRecords?: unknown,
): DeletionMatcher {
  const wildcardIds = new Set<string>(Array.isArray(deletedIds) ? deletedIds.filter(isValidId) : []);
  const scoped = new Map<string, Set<string>>();
  if (Array.isArray(deletedRecords)) {
    for (const record of deletedRecords) {
      if (!record || typeof record !== 'object') continue;
      const { collection, id } = record as any;
      if (typeof collection !== 'string' || !isValidId(id)) continue;
      const ids = scoped.get(collection) || new Set<string>();
      ids.add(id);
      scoped.set(collection, ids);
    }
  }
  return {
    hasDeletions: wildcardIds.size > 0 || scoped.size > 0,
    isDeleted: (collection, id) => (
      typeof id === 'string'
      && (wildcardIds.has(id) || Boolean(scoped.get(collection)?.has(id)))
    ),
  };
}

/** Compare item content ignoring sync metadata. */
function sameContent(a: any, b: any): boolean {
  const { lastModified: _a, baselineTimestamp: _ba, ...restA } = a || {};
  const { lastModified: _b, baselineTimestamp: _bb, ...restB } = b || {};
  return JSON.stringify(restA) === JSON.stringify(restB);
}

export function applyDeletions(
  db: any,
  deletedIds: string[] | undefined,
  deletedRecords?: DeletedRecordRef[] | undefined,
): void {
  const matcher = createDeletionMatcher(deletedIds, deletedRecords);
  if (!matcher.hasDeletions) return;
  for (const key of Object.keys(db)) {
    if (key === 'syncDeletionLedger') continue;
    if (Array.isArray(db[key])) {
      db[key] = db[key].filter((item: any) => !item || !item.id || !matcher.isDeleted(key, item.id));
    }
  }
}

interface DocumentHistoryEntry {
  data: any;
  lastModified: string;
  recordedAt: number;
}

/**
 * Baseline copies for three-way merge, keyed `<org>:<collection>:<recordId>`.
 *
 * Bounded, because it previously was not. Entries were capped at 20 per record,
 * but the map itself had no TTL, no size limit, and nothing removed a key when
 * its record — or its whole organization — was deleted. Every record ever
 * merged retained up to twenty deep copies of itself in process memory, for the
 * life of the process.
 *
 * That leak has been invisible for a reason worth writing down: the service
 * deploys without `--min-instances`, so Cloud Run scales it to zero when idle
 * and the map is discarded along with the process. The same cold start that
 * hides the leak also erases every baseline, which is why the value of
 * three-way merge is an open question rather than an assumption (see
 * `docs/scale-out-and-delta-sync-design-2026-08-13.md`).
 */
const documentHistory = new Map<string, DocumentHistoryEntry[]>();

/** One organization at the sync record ceiling; far above a warm working set. */
const MAX_HISTORY_RECORDS = 20_000;
/**
 * A baseline is only useful while some client still holds an edit based on it.
 * Beyond a day that is vanishingly unlikely, and the entry is pure memory cost.
 */
const HISTORY_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * Drop what can no longer be used, then — if still at the cap — the entries
 * least likely to be wanted.
 *
 * Oldest-first is right *here*, unlike the eviction in
 * `server/middleware/requestCeiling.ts`, where evicting the oldest entry would
 * have preferentially discarded the caller being throttled. The two look alike
 * and want opposite policies: a rate limiter's oldest entry is its most
 * valuable, a baseline's oldest entry is its least.
 */
function pruneDocumentHistory(now: number): void {
  for (const [key, list] of documentHistory) {
    const live = list.filter(entry => now - entry.recordedAt < HISTORY_TTL_MS);
    if (live.length === 0) documentHistory.delete(key);
    else if (live.length !== list.length) documentHistory.set(key, live);
  }
  if (documentHistory.size < MAX_HISTORY_RECORDS) return;

  const byAge = [...documentHistory.entries()]
    .map(([key, list]) => ({
      key,
      newest: list.reduce((latest, entry) => Math.max(latest, entry.recordedAt), 0),
    }))
    .sort((left, right) => left.newest - right.newest);

  // Free a tenth rather than a single key, so a saturated map does not re-sort
  // on every subsequent insert.
  const target = Math.max(1, Math.floor(MAX_HISTORY_RECORDS / 10));
  for (const { key } of byAge.slice(0, target)) documentHistory.delete(key);
}

function recordDocumentHistory(
  collection: string,
  recordId: string,
  data: any,
  lastModified: string,
  now: number = Date.now(),
) {
  const key = `${collection}:${recordId}`;
  let list = documentHistory.get(key);
  if (!list) {
    // Only on a new key, so the sweep is amortized rather than per record.
    if (documentHistory.size >= MAX_HISTORY_RECORDS) pruneDocumentHistory(now);
    list = [];
    documentHistory.set(key, list);
  }
  if (list.some(entry => entry.lastModified === lastModified)) return;
  list.push({ data: JSON.parse(JSON.stringify(data)), lastModified, recordedAt: now });
  if (list.length > 20) {
    list.shift();
  }
}

export interface DocumentHistoryStats {
  /** Records holding at least one baseline. */
  records: number;
  /** Baseline copies retained across all records. */
  entries: number;
}

/**
 * Size of the baseline store. Exposed so the growth this map used to hide can
 * be observed rather than inferred from a memory graph.
 */
export function documentHistoryStats(): DocumentHistoryStats {
  let entries = 0;
  for (const list of documentHistory.values()) entries += list.length;
  return { records: documentHistory.size, entries };
}

/** Test seam; also the honest way to simulate the cold start production has. */
export function resetDocumentHistory(): void {
  documentHistory.clear();
}

/**
 * Merge client collections into the db (mutating it) and return any
 * conflicts. Conflicted items are left untouched on the server.
 *
 * `historyScope` namespaces the field-merge baseline history — pass the
 * organization id. Without it, two organizations using the same record ids
 * (seeded vessels like "T-101" are identical across estates) would read each
 * other's baselines and silently merge against the wrong tenant's data.
 */
export function mergeCollections(
  db: any,
  collections: Record<string, any>,
  historyScope = '',
  tally?: MergeOutcomeTally,
): SyncConflict[] {
  const conflicts: SyncConflict[] = [];
  const count = (outcome: keyof MergeOutcomeTally) => { if (tally) tally[outcome] += 1; };

  for (const key of Object.keys(collections)) {
    if (!(key in db) || key === 'users') continue;

    if (key === 'companyProfile') {
      db.companyProfile = collections[key];
      continue;
    }
    if (key === 'winePricing') {
      db.winePricing = collections[key];
      continue;
    }
    if (!Array.isArray(collections[key])) continue;

    const existingList: any[] = db[key] || [];
    const existingMap = new Map(existingList.map((item: any) => [item.id, item]));
    // Tenant-scoped namespace for the baseline history (see docblock above).
    const historyCollection = historyScope ? `${historyScope}:${key}` : key;

    for (const clientItem of collections[key]) {
      if (!clientItem || !clientItem.id) continue;

      // The baseline travels on the wire but is never stored.
      const { baselineTimestamp, ...incoming } = clientItem;
      const existing = existingMap.get(clientItem.id);

      if (!existing) {
        count('newRecord');
        existingList.push(incoming);
        existingMap.set(clientItem.id, incoming);
        continue;
      }
      if (sameContent(incoming, existing)) {
        count('unchanged');
        // Content is identical, but adopt the client's sync stamp: refusing a
        // lastModified-only update makes the client see "server differs" on
        // every response, re-stamp, and re-sync — an infinite request loop
        // (observed as charts redrawing continuously). Metadata-only adoption
        // converges in one round-trip.
        if (incoming.lastModified && incoming.lastModified !== existing.lastModified) {
          existing.lastModified = incoming.lastModified;
        }
        continue;
      }

      if (baselineTimestamp !== undefined && existing.lastModified !== undefined) {
        if (baselineTimestamp === existing.lastModified) {
          count('cleanFastForward');
          recordDocumentHistory(historyCollection, existing.id, existing, existing.lastModified);
          Object.assign(existing, incoming); // clean fast-forward
        } else {
          // Stale baseline: try field-level merge
          const historyKey = `${historyCollection}:${clientItem.id}`;
          const historyList = documentHistory.get(historyKey) || [];
          const baselineEntry = historyList.find(entry => entry.lastModified === baselineTimestamp);

          let merged = false;
          if (baselineEntry) {
            const baseline = baselineEntry.data;
            const mergedRecord = { ...existing };
            let hasConflict = false;

            const allKeys = new Set([
              ...Object.keys(incoming),
              ...Object.keys(existing),
              ...Object.keys(baseline)
            ]);

            for (const k of allKeys) {
              if (k === 'lastModified' || k === 'baselineTimestamp' || k === 'id') continue;

              const localVal = incoming[k];
              const serverVal = existing[k];
              const baseVal = baseline[k];

              const localChanged = JSON.stringify(localVal) !== JSON.stringify(baseVal);
              const serverChanged = JSON.stringify(serverVal) !== JSON.stringify(baseVal);

              if (localChanged && serverChanged) {
                // Both modified this field
                if (JSON.stringify(localVal) === JSON.stringify(serverVal)) {
                  mergedRecord[k] = localVal;
                } else {
                  // Conflicting modifications to the same field
                  hasConflict = true;
                  break;
                }
              } else if (localChanged) {
                // Only local changed
                mergedRecord[k] = localVal;
              } else {
                // Either only server changed, or neither changed
                mergedRecord[k] = serverVal;
              }
            }

            if (!hasConflict) {
              count('fieldMergeApplied');
              recordDocumentHistory(historyCollection, existing.id, existing, existing.lastModified);
              Object.assign(existing, mergedRecord);
              existing.lastModified = incoming.lastModified;
              merged = true;
            } else {
              count('sameFieldConflict');
            }
          } else {
            // The conflict below is not a judgement that the edits collide —
            // it is the merge declining to guess without the baseline. This is
            // the count that decides whether the baselines are worth persisting.
            count('baselineUnavailable');
          }

          if (!merged) {
            conflicts.push({
              collection: toClientKey(key),
              recordId: clientItem.id,
              local: incoming,
              server: { ...existing },
            });
          }
        }
        continue;
      }

      // Legacy fallback: last-write-wins, never reported as conflict.
      count('legacyLastWriteWins');
      const clientTS = incoming.lastModified ? new Date(incoming.lastModified).getTime() : 0;
      const serverTS = existing.lastModified ? new Date(existing.lastModified).getTime() : 0;
      if (clientTS >= serverTS) {
        recordDocumentHistory(historyCollection, existing.id, existing, existing.lastModified);
        Object.assign(existing, incoming);
      }
    }

    db[key] = existingList;
  }

  return conflicts;
}
