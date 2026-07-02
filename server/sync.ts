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

/** Compare item content ignoring sync metadata. */
function sameContent(a: any, b: any): boolean {
  const { lastModified: _a, baselineTimestamp: _ba, ...restA } = a || {};
  const { lastModified: _b, baselineTimestamp: _bb, ...restB } = b || {};
  return JSON.stringify(restA) === JSON.stringify(restB);
}

export function applyDeletions(db: any, deletedIds: string[] | undefined): void {
  if (!Array.isArray(deletedIds) || deletedIds.length === 0) return;
  const toDelete = new Set(deletedIds);
  for (const key of Object.keys(db)) {
    if (Array.isArray(db[key])) {
      db[key] = db[key].filter((item: any) => !item || !item.id || !toDelete.has(item.id));
    }
  }
}

/**
 * Merge client collections into the db (mutating it) and return any
 * conflicts. Conflicted items are left untouched on the server.
 */
export function mergeCollections(db: any, collections: Record<string, any>): SyncConflict[] {
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

    for (const clientItem of collections[key]) {
      if (!clientItem || !clientItem.id) continue;

      // The baseline travels on the wire but is never stored.
      const { baselineTimestamp, ...incoming } = clientItem;
      const existing = existingMap.get(clientItem.id);

      if (!existing) {
        existingList.push(incoming);
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
          Object.assign(existing, incoming); // clean fast-forward
        } else {
          conflicts.push({
            collection: toClientKey(key),
            recordId: clientItem.id,
            local: incoming,
            server: { ...existing },
          });
        }
        continue;
      }

      // Legacy fallback: last-write-wins, never reported as conflict.
      const clientTS = incoming.lastModified ? new Date(incoming.lastModified).getTime() : 0;
      const serverTS = existing.lastModified ? new Date(existing.lastModified).getTime() : 0;
      if (clientTS >= serverTS) {
        Object.assign(existing, incoming);
      }
    }

    db[key] = existingList;
  }

  return conflicts;
}
