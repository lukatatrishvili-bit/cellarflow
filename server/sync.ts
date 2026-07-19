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
    if (Array.isArray(db[key])) {
      db[key] = db[key].filter((item: any) => !item || !item.id || !matcher.isDeleted(key, item.id));
    }
  }
}

const documentHistory = new Map<string, Array<{ data: any; lastModified: string }>>();

function recordDocumentHistory(collection: string, recordId: string, data: any, lastModified: string) {
  const key = `${collection}:${recordId}`;
  let list = documentHistory.get(key);
  if (!list) {
    list = [];
    documentHistory.set(key, list);
  }
  if (list.some(entry => entry.lastModified === lastModified)) return;
  list.push({ data: JSON.parse(JSON.stringify(data)), lastModified });
  if (list.length > 20) {
    list.shift();
  }
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
export function mergeCollections(db: any, collections: Record<string, any>, historyScope = ''): SyncConflict[] {
  const conflicts: SyncConflict[] = [];

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
        existingList.push(incoming);
        existingMap.set(clientItem.id, incoming);
        continue;
      }
      if (sameContent(incoming, existing)) {
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
              recordDocumentHistory(historyCollection, existing.id, existing, existing.lastModified);
              Object.assign(existing, mergedRecord);
              existing.lastModified = incoming.lastModified;
              merged = true;
            }
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
