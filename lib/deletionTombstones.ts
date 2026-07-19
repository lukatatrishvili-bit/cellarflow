export interface DeletionTombstoneStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface DeletionTombstone {
  id: string;
  /** Missing only for a legacy wildcard tombstone created by an older client. */
  collection?: string;
}

export const DELETION_TOMBSTONE_BASE_KEY = 'vinea_deleted_ids';
export const ORGANIZATION_ID_STORAGE_KEY = 'cellarflow_org_state_org_id';

/**
 * Tombstones belong to the organization that was active when the deletion was
 * made. The legacy unscoped key is used only before an organization id is
 * known; it is deliberately not migrated into a later organization context.
 */
export function deletionTombstoneKey(storage: DeletionTombstoneStore): string {
  try {
    const organizationId = storage.getItem(ORGANIZATION_ID_STORAGE_KEY)?.trim();
    return organizationId
      ? `${DELETION_TOMBSTONE_BASE_KEY}:${organizationId}`
      : DELETION_TOMBSTONE_BASE_KEY;
  } catch {
    return DELETION_TOMBSTONE_BASE_KEY;
  }
}

const tombstoneIdentity = (record: DeletionTombstone): string => (
  `${record.collection || '*'}\u0000${record.id}`
);

export function readDeletionTombstones(
  storage: DeletionTombstoneStore,
  key = deletionTombstoneKey(storage),
): DeletionTombstone[] {
  try {
    const stored = storage.getItem(key);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];

    const records: DeletionTombstone[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const record: DeletionTombstone | null = typeof item === 'string'
        ? (item.length > 0 ? { id: item } : null)
        : item && typeof item === 'object'
          && typeof (item as any).id === 'string'
          && (item as any).id.length > 0
          && typeof (item as any).collection === 'string'
          && (item as any).collection.length > 0
            ? { id: (item as any).id, collection: (item as any).collection }
            : null;
      if (!record) continue;
      const identity = tombstoneIdentity(record);
      if (seen.has(identity)) continue;
      seen.add(identity);
      records.push(record);
    }
    return records;
  } catch {
    return [];
  }
}

export function clearDeletionTombstones(
  storage: DeletionTombstoneStore,
  key = deletionTombstoneKey(storage),
): boolean {
  try {
    if (storage.removeItem) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify([]));
    const remaining = storage.getItem(key);
    if (remaining === null) return true;
    try {
      const parsed = JSON.parse(remaining);
      return Array.isArray(parsed) && parsed.length === 0;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Atomically persist one or more collection-scoped deletions. `true` means the
 * whole batch is durable (including records already present); `false` means UI
 * code must not optimistically remove anything.
 */
export function persistDeletionTombstones(
  records: DeletionTombstone[],
  storage: DeletionTombstoneStore,
): boolean {
  const requested = records.filter(record => (
    record
    && typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.collection === 'string'
    && record.collection.length > 0
  ));
  if (requested.length !== records.length || requested.length === 0) return false;

  const key = deletionTombstoneKey(storage);
  const existing = readDeletionTombstones(storage, key);
  const requestedIds = new Set(requested.map(record => record.id));
  // When a current action reveals the collection for an old wildcard ID,
  // replace that wildcard rather than forwarding its cross-collection scope.
  const combined = existing.filter(record => record.collection || !requestedIds.has(record.id));
  const seen = new Set(combined.map(tombstoneIdentity));
  for (const record of requested) {
    const normalized = { id: record.id, collection: record.collection };
    const identity = tombstoneIdentity(normalized);
    if (!seen.has(identity)) {
      seen.add(identity);
      combined.push(normalized);
    }
  }

  try {
    storage.setItem(key, JSON.stringify(combined.map(record => (
      record.collection ? { collection: record.collection, id: record.id } : record.id
    ))));
    const durable = readDeletionTombstones(storage, key);
    const durableIdentities = new Set(durable.map(tombstoneIdentity));
    return requested.every(record => durableIdentities.has(tombstoneIdentity(record)));
  } catch {
    return false;
  }
}

export function persistDeletionTombstone(
  id: string,
  storage: DeletionTombstoneStore,
  collection: string,
): boolean {
  return persistDeletionTombstones([{ id, collection }], storage);
}
