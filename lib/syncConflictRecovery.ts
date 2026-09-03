export type SyncConflictResolutionChoice = 'local' | 'server';

export interface SyncConflictRecordLike {
  collection: string;
  recordId: string;
  local?: Record<string, unknown> | null;
  server?: Record<string, unknown> | null;
}

export interface BuildResolvedSyncStateInput {
  serverDb: Record<string, any>;
  attemptedPayload: Record<string, any>;
  conflicts: SyncConflictRecordLike[];
  resolutions: Record<string, SyncConflictResolutionChoice>;
  resolvedAt?: string;
}

export interface ResolvedDeletionIntent {
  retainedRecords: DeletionTombstone[];
  discardedRecords: DeletionTombstone[];
  retainedLegacyIds: string[];
  discardedLegacyIds: string[];
}

const CLIENT_TO_SERVER_COLLECTION: Record<string, string> = {
  notesList: 'notes',
  fermLogs: 'fermlogs',
  labLogs: 'lablogs',
};

const SYNC_METADATA_KEYS = new Set(['deletedIds', 'deletedRecords']);

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function serverSyncCollectionKey(collection: string): string {
  return CLIENT_TO_SERVER_COLLECTION[collection] || collection;
}

export function syncConflictResolutionKey(conflict: Pick<SyncConflictRecordLike, 'collection' | 'recordId'>): string {
  return `${conflict.collection}-${conflict.recordId}`;
}

function resolvedConflictRecord(
  conflict: SyncConflictRecordLike,
  choice: SyncConflictResolutionChoice,
  resolvedAt: string,
): Record<string, unknown> | null {
  if (choice === 'server') {
    if (!conflict.server) return null;
    const serverRecord = clone(conflict.server);
    delete serverRecord.baselineTimestamp;
    return serverRecord;
  }

  if (!conflict.local) return null;
  const localRecord = clone(conflict.local);
  localRecord.lastModified = resolvedAt;
  if (typeof conflict.server?.lastModified === 'string') {
    localRecord.baselineTimestamp = conflict.server.lastModified;
  } else {
    delete localRecord.baselineTimestamp;
  }
  return localRecord;
}

function upsertById(records: any[], record: Record<string, unknown> | null, fallbackId: string): void {
  if (!record) return;
  const id = typeof record.id === 'string' ? record.id : fallbackId;
  const next = typeof record.id === 'string' ? record : { ...record, id };
  const index = records.findIndex(item => item?.id === id);
  if (index >= 0) records[index] = clone(next);
  else records.push(clone(next));
}

function requireExplicitConflictChoices(
  conflicts: SyncConflictRecordLike[],
  resolutions: Record<string, SyncConflictResolutionChoice>,
): void {
  const unresolved = conflicts.filter(conflict => !Object.prototype.hasOwnProperty.call(
    resolutions,
    syncConflictResolutionKey(conflict),
  ));
  if (unresolved.length > 0) {
    throw new Error(`Choose a local or server version for all ${unresolved.length} unresolved sync conflict(s).`);
  }
}

export function resolveDeletionIntent(
  attemptedPayload: Record<string, any>,
  conflicts: SyncConflictRecordLike[],
  resolutions: Record<string, SyncConflictResolutionChoice>,
): ResolvedDeletionIntent {
  requireExplicitConflictChoices(conflicts, resolutions);
  const conflictChoice = (collection: string, id: string): SyncConflictResolutionChoice | null => {
    const conflict = conflicts.find(item => (
      serverSyncCollectionKey(item.collection) === serverSyncCollectionKey(collection)
      && item.recordId === id
    ));
    return conflict ? resolutions[syncConflictResolutionKey(conflict)] : null;
  };

  const retainedRecords: ResolvedDeletionIntent['retainedRecords'] = [];
  const discardedRecords: ResolvedDeletionIntent['discardedRecords'] = [];
  for (const tombstone of Array.isArray(attemptedPayload?.deletedRecords) ? attemptedPayload.deletedRecords : []) {
    if (!tombstone || typeof tombstone !== 'object' || typeof tombstone.id !== 'string' || typeof tombstone.collection !== 'string') continue;
    const conflict = conflicts.find(item => (
      serverSyncCollectionKey(item.collection) === serverSyncCollectionKey(tombstone.collection)
      && item.recordId === tombstone.id
    ));
    const normalized: DeletionTombstone = {
      id: tombstone.id,
      collection: tombstone.collection,
      ...(typeof tombstone.baselineTimestamp === 'string'
        ? { baselineTimestamp: tombstone.baselineTimestamp }
        : {}),
      ...(typeof tombstone.baselineFingerprint === 'string'
        ? { baselineFingerprint: tombstone.baselineFingerprint }
        : {}),
      ...(typeof tombstone.deletedAt === 'string' ? { deletedAt: tombstone.deletedAt } : {}),
    };
    if (conflictChoice(tombstone.collection, tombstone.id) === 'server') {
      discardedRecords.push(normalized);
    } else {
      retainedRecords.push(conflict?.server ? {
        ...normalized,
        ...(typeof conflict.server.lastModified === 'string'
          ? { baselineTimestamp: conflict.server.lastModified }
          : {}),
        baselineFingerprint: syncRecordFingerprint(conflict.server),
      } : normalized);
    }
  }

  const retainedLegacyIds: string[] = [];
  const discardedLegacyIds: string[] = [];
  for (const id of Array.isArray(attemptedPayload?.deletedIds) ? attemptedPayload.deletedIds : []) {
    if (typeof id !== 'string') continue;
    const matchingConflicts = conflicts.filter(conflict => conflict.recordId === id);
    const keep = matchingConflicts.length === 0 || matchingConflicts.every(conflict => (
      resolutions[syncConflictResolutionKey(conflict)] === 'local'
    ));
    (keep ? retainedLegacyIds : discardedLegacyIds).push(id);
  }

  return { retainedRecords, discardedRecords, retainedLegacyIds, discardedLegacyIds };
}

/**
 * Reconstruct the complete client transaction after a server-side merge
 * conflict. The authoritative server snapshot is the base, so records created
 * remotely are retained. Every collection from the exact attempted POST is
 * then overlaid by id, including clean siblings that the server deliberately
 * deferred to preserve transaction atomicity.
 */
export function buildResolvedSyncState({
  serverDb,
  attemptedPayload,
  conflicts,
  resolutions,
  resolvedAt = new Date().toISOString(),
}: BuildResolvedSyncStateInput): Record<string, any> {
  requireExplicitConflictChoices(conflicts, resolutions);
  const resolvedDb = clone(serverDb);
  const conflictsByRecord = new Map<string, SyncConflictRecordLike>();

  for (const conflict of conflicts) {
    conflictsByRecord.set(`${serverSyncCollectionKey(conflict.collection)}\u0000${conflict.recordId}`, conflict);
  }

  for (const [rawCollection, attemptedValue] of Object.entries(attemptedPayload || {})) {
    if (SYNC_METADATA_KEYS.has(rawCollection)) continue;
    const collection = serverSyncCollectionKey(rawCollection);

    if (!Array.isArray(attemptedValue)) {
      resolvedDb[collection] = clone(attemptedValue);
      continue;
    }

    const records = Array.isArray(resolvedDb[collection]) ? clone(resolvedDb[collection]) : [];
    for (const attemptedRecord of attemptedValue) {
      if (!attemptedRecord || typeof attemptedRecord !== 'object' || typeof attemptedRecord.id !== 'string') continue;
      const conflict = conflictsByRecord.get(`${collection}\u0000${attemptedRecord.id}`);
      if (!conflict) {
        upsertById(records, attemptedRecord, attemptedRecord.id);
        continue;
      }
      const choice = resolutions[syncConflictResolutionKey(conflict)];
      upsertById(records, resolvedConflictRecord(conflict, choice, resolvedAt), conflict.recordId);
    }
    resolvedDb[collection] = records;
  }

  // Offline pre-flight conflicts can be discovered before a collection is
  // present in the POST payload. Apply those choices to the server base too.
  for (const conflict of conflicts) {
    const collection = serverSyncCollectionKey(conflict.collection);
    const records = Array.isArray(resolvedDb[collection]) ? resolvedDb[collection] : [];
    const choice = resolutions[syncConflictResolutionKey(conflict)];
    upsertById(records, resolvedConflictRecord(conflict, choice, resolvedAt), conflict.recordId);
    resolvedDb[collection] = records;
  }

  const deletionIntent = resolveDeletionIntent(attemptedPayload, conflicts, resolutions);
  for (const tombstone of deletionIntent.retainedRecords) {
    if (!tombstone.collection) continue;
    const collection = serverSyncCollectionKey(tombstone.collection);
    if (Array.isArray(resolvedDb[collection])) {
      resolvedDb[collection] = resolvedDb[collection].filter((item: any) => item?.id !== tombstone.id);
    }
  }

  const legacyDeletedIds = new Set<string>(
    deletionIntent.retainedLegacyIds,
  );
  if (legacyDeletedIds.size > 0) {
    for (const [collection, records] of Object.entries(resolvedDb)) {
      if (!Array.isArray(records)) continue;
      resolvedDb[collection] = records.filter((item: any) => !legacyDeletedIds.has(item?.id));
    }
  }

  return resolvedDb;
}
import { syncRecordFingerprint, type DeletionTombstone } from './deletionTombstones';
