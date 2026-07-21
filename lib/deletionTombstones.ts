export interface DeletionTombstoneStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface DeletionTombstone {
  id: string;
  /** Missing only for a legacy wildcard tombstone created by an older client. */
  collection?: string;
  /** Server record version the deletion was based on. */
  baselineTimestamp?: string;
  /** Stable content fingerprint protects legacy records without timestamps. */
  baselineFingerprint?: string;
  /** Stable client capture time retained across retries. */
  deletedAt?: string;
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

const optionalTimestamp = (value: unknown): string | undefined => (
  typeof value === 'string' && value.length > 0 && value.length <= 64 && Number.isFinite(Date.parse(value))
    ? value
    : undefined
);

const canonicalRecordValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalRecordValue);
  if (!value || typeof value !== 'object') return value;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (key === 'lastModified' || key === 'baselineTimestamp') continue;
    normalized[key] = canonicalRecordValue((value as Record<string, unknown>)[key]);
  }
  return normalized;
};

export function syncRecordFingerprint(record: unknown): string {
  const text = JSON.stringify(canonicalRecordValue(record));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const optionalFingerprint = (value: unknown): string | undefined => (
  typeof value === 'string' && /^[0-9a-f]{8}$/.test(value) ? value : undefined
);

export function deletionTombstoneStorageValue(record: DeletionTombstone): string | DeletionTombstone {
  if (!record.collection) return record.id;
  return {
    collection: record.collection,
    id: record.id,
    ...(optionalTimestamp(record.baselineTimestamp) ? { baselineTimestamp: record.baselineTimestamp } : {}),
    ...(optionalFingerprint(record.baselineFingerprint) ? { baselineFingerprint: record.baselineFingerprint } : {}),
    ...(optionalTimestamp(record.deletedAt) ? { deletedAt: record.deletedAt } : {}),
  };
}

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
            ? {
              id: (item as any).id,
              collection: (item as any).collection,
              ...(optionalTimestamp((item as any).baselineTimestamp)
                ? { baselineTimestamp: (item as any).baselineTimestamp }
                : {}),
              ...(optionalFingerprint((item as any).baselineFingerprint)
                ? { baselineFingerprint: (item as any).baselineFingerprint }
                : {}),
              ...(optionalTimestamp((item as any).deletedAt)
                ? { deletedAt: (item as any).deletedAt }
                : {}),
            }
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
  const indexByIdentity = new Map(combined.map((record, index) => [tombstoneIdentity(record), index]));
  for (const record of requested) {
    const normalized: DeletionTombstone = {
      id: record.id,
      collection: record.collection,
      ...(optionalTimestamp(record.baselineTimestamp) ? { baselineTimestamp: record.baselineTimestamp } : {}),
      ...(optionalFingerprint(record.baselineFingerprint) ? { baselineFingerprint: record.baselineFingerprint } : {}),
      ...(optionalTimestamp(record.deletedAt) ? { deletedAt: record.deletedAt } : {}),
    };
    const identity = tombstoneIdentity(normalized);
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, combined.length);
      combined.push(normalized);
    } else {
      const existing = combined[existingIndex];
      if ((existing.baselineTimestamp && normalized.baselineTimestamp
          && existing.baselineTimestamp !== normalized.baselineTimestamp)
        || (existing.baselineFingerprint && normalized.baselineFingerprint
          && existing.baselineFingerprint !== normalized.baselineFingerprint)) {
        return false;
      }
      combined[existingIndex] = {
        ...existing,
        ...(existing.baselineTimestamp ? {} : normalized.baselineTimestamp ? { baselineTimestamp: normalized.baselineTimestamp } : {}),
        ...(existing.baselineFingerprint ? {} : normalized.baselineFingerprint ? { baselineFingerprint: normalized.baselineFingerprint } : {}),
        ...(existing.deletedAt ? {} : normalized.deletedAt ? { deletedAt: normalized.deletedAt } : {}),
      };
    }
  }

  try {
    storage.setItem(key, JSON.stringify(combined.map(deletionTombstoneStorageValue)));
    const durable = readDeletionTombstones(storage, key);
    return requested.every(record => {
      const stored = durable.find(item => tombstoneIdentity(item) === tombstoneIdentity(record));
      const expected = combined.find(item => tombstoneIdentity(item) === tombstoneIdentity(record));
      return Boolean(stored && expected)
        && JSON.stringify(deletionTombstoneStorageValue(stored!))
          === JSON.stringify(deletionTombstoneStorageValue(expected!));
    });
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
