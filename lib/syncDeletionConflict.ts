import {
  deletionTombstoneStorageValue,
  readDeletionTombstones,
  type DeletionTombstone,
  type DeletionTombstoneStore,
} from './deletionTombstones';

interface WritableDeletionTombstoneStore extends DeletionTombstoneStore {
  removeItem(key: string): void;
}

interface StoredConflictIntent {
  payload: Record<string, any>;
}

export interface ReconcileDeletionConflictInput {
  storage: WritableDeletionTombstoneStore;
  tombstoneKey: string;
  conflictIntentKey: string;
  retained: DeletionTombstone[];
  discarded: DeletionTombstone[];
  readIntent(): StoredConflictIntent | null;
}

/** Atomically rebase retained deletes and remove server-version choices. */
export function reconcileDeletionConflictRecords({
  storage,
  tombstoneKey,
  conflictIntentKey,
  retained,
  discarded,
  readIntent,
}: ReconcileDeletionConflictInput): boolean {
  const valid = [...retained, ...discarded].every(record => (
    record
    && typeof record.id === 'string'
    && record.id.length > 0
    && (record.collection === undefined
      || (typeof record.collection === 'string' && record.collection.length > 0))
  ));
  if (!valid) return false;
  if (retained.length === 0 && discarded.length === 0) return true;

  const identity = (record: DeletionTombstone) => `${record.collection || '*'}\u0000${record.id}`;
  const signature = (record: DeletionTombstone) => JSON.stringify(deletionTombstoneStorageValue(record));
  const discardedIdentities = new Set(discarded.map(identity));
  const retainedByIdentity = new Map(retained.map(record => [identity(record), record]));
  const originalTombstones = storage.getItem(tombstoneKey);
  const originalIntent = storage.getItem(conflictIntentKey);

  try {
    const nextTombstones = readDeletionTombstones(storage, tombstoneKey)
      .filter(record => !discardedIdentities.has(identity(record)))
      .map(record => retainedByIdentity.get(identity(record)) || record);
    const present = new Set(nextTombstones.map(identity));
    for (const record of retained) {
      if (!present.has(identity(record))) nextTombstones.push(record);
    }
    if (nextTombstones.length > 0) {
      storage.setItem(tombstoneKey, JSON.stringify(nextTombstones.map(deletionTombstoneStorageValue)));
    } else {
      storage.removeItem(tombstoneKey);
    }

    const intent = readIntent();
    if (intent) {
      const payload = { ...intent.payload };
      const records = (Array.isArray(payload.deletedRecords) ? payload.deletedRecords : [])
        .filter((record: any) => (
          !record
          || typeof record.id !== 'string'
          || !discardedIdentities.has(identity({ id: record.id, collection: record.collection }))
        ))
        .map((record: any) => (
          record && typeof record.id === 'string'
            ? retainedByIdentity.get(identity({ id: record.id, collection: record.collection })) || record
            : record
        ));
      const recordIdentities = new Set(records
        .filter((record: any) => record && typeof record.id === 'string')
        .map((record: any) => identity({ id: record.id, collection: record.collection })));
      for (const record of retained.filter(item => item.collection)) {
        if (!recordIdentities.has(identity(record))) records.push(record);
      }
      if (records.length > 0) payload.deletedRecords = records;
      else delete payload.deletedRecords;
      if (Array.isArray(payload.deletedIds)) {
        payload.deletedIds = payload.deletedIds.filter((id: unknown) => (
          typeof id !== 'string' || !discardedIdentities.has(identity({ id }))
        ));
        if (payload.deletedIds.length === 0) delete payload.deletedIds;
      }
      storage.setItem(conflictIntentKey, JSON.stringify({ ...intent, payload }));
    }

    const durableTombstones = readDeletionTombstones(storage, tombstoneKey);
    if (durableTombstones.some(record => discardedIdentities.has(identity(record)))) {
      throw new Error('Discarded deletion tombstones remained in storage.');
    }
    for (const record of retained) {
      const durable = durableTombstones.find(item => identity(item) === identity(record));
      if (!durable || signature(durable) !== signature(record)) {
        throw new Error('Retained deletion tombstone was not rebased durably.');
      }
    }
    const durableIntent = readIntent();
    if (durableIntent) {
      const durableRecords = Array.isArray(durableIntent.payload.deletedRecords)
        ? durableIntent.payload.deletedRecords as DeletionTombstone[]
        : [];
      const durableIds = Array.isArray(durableIntent.payload.deletedIds)
        ? durableIntent.payload.deletedIds as string[]
        : [];
      if (durableRecords.some(record => discardedIdentities.has(identity(record)))
        || durableIds.some(id => discardedIdentities.has(identity({ id })))) {
        throw new Error('Discarded deletion intent remained in recovery storage.');
      }
      for (const record of retained.filter(item => item.collection)) {
        const durable = durableRecords.find(item => identity(item) === identity(record));
        if (!durable || signature(durable) !== signature(record)) {
          throw new Error('Retained deletion intent was not rebased durably.');
        }
      }
    }
    return true;
  } catch {
    try {
      if (originalTombstones === null) storage.removeItem(tombstoneKey);
      else storage.setItem(tombstoneKey, originalTombstones);
      if (originalIntent === null) storage.removeItem(conflictIntentKey);
      else storage.setItem(conflictIntentKey, originalIntent);
    } catch {
      // The caller receives false and keeps the conflict unresolved.
    }
    return false;
  }
}
