import type { RxDatabase } from 'rxdb';
import {
  clearDeletionTombstones,
  DELETION_TOMBSTONE_BASE_KEY,
  deletionTombstoneKey,
  deletionTombstoneStorageValue,
  readDeletionTombstones,
  type DeletionTombstone,
} from './deletionTombstones';

const DB_NAME = 'vinea_rx_offline_db';

export const PENDING_CHANGES_SWITCH_CODE = 'pending_local_changes';
export const PENDING_CHANGES_SWITCH_ERROR = 'This workspace has unsynced changes. Sync or discard them before switching workspaces.';
export const WORKSPACE_TRANSITION_STORAGE_KEY = 'cellarflow_workspace_transition_pending';
export const PENDING_CONFLICT_SYNC_BASE_KEY = 'vinea_pending_conflict_sync';
export const PENDING_COMMANDS_BASE_KEY = 'cellarflow_pending_commands';
export const MAX_PENDING_COMMAND_INTENTS = 24;
export const MAX_PENDING_COMMAND_INTENT_CHARS = 128_000;

export class PendingCommandIntentLimitError extends Error {
  constructor(
    public readonly code: 'pending_command_queue_full' | 'pending_command_intent_too_large' | 'pending_command_persistence_failed',
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'PendingCommandIntentLimitError';
  }
}

export interface WorkspaceTransitionMarker {
  fromOrganizationId: string | null;
  toOrganizationId: string | null;
  startedAt: string;
}

export interface PendingConflictSyncIntent {
  /** Exact server-key payload that was, or would have been, posted. */
  payload: Record<string, unknown>;
  /** Client collection keys whose revisions are represented by `payload`. */
  dirtyCollections: string[];
  dirtyRevisions: Record<string, number>;
  organizationId: string | null;
  capturedAt: string;
}

export interface PendingCommandIntent<TPayload = unknown> {
  commandId: string;
  commandType: string;
  payload: TPayload;
  capturedAt: string;
}

let dbPromise: Promise<RxDatabase> | null = null;

export async function getRxDB(): Promise<RxDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const [{ createRxDatabase }, { getRxStorageDexie }] = await Promise.all([
      import('rxdb'),
      import('rxdb/plugins/storage-dexie')
    ]);

    const db = await createRxDatabase({
      name: DB_NAME,
      storage: getRxStorageDexie()
    });

    await db.addCollections({
      mutations: {
        schema: {
          title: 'mutation schema',
          version: 0,
          primaryKey: 'id',
          type: 'object',
          properties: {
            id: { type: 'string', maxLength: 150 },
            collection: { type: 'string' },
            recordId: { type: 'string' },
            action: { type: 'string' },
            data: { type: 'object' },
            timestamp: { type: 'string' },
            baselineTimestamp: { type: 'string' }
          },
          required: ['id', 'collection', 'recordId', 'action', 'timestamp']
        }
      }
    });

    return db;
  })();

  return dbPromise;
}

export interface OfflineMutation {
  id: string; // Unique queue item ID
  collection: string; // e.g. 'vessels', 'lots', etc.
  recordId: string; // The ID of the record being mutated
  action: 'put' | 'delete';
  data?: any;
  timestamp: string;
  baselineTimestamp?: string; // Timestamp of record before offline modifications
}

export class IndexedDBQueue {
  static async addMutation(mutation: Omit<OfflineMutation, 'id' | 'timestamp'>): Promise<void> {
    try {
      const db = await getRxDB();
      const id = `${mutation.collection}-${mutation.recordId}-${Date.now()}`;
      const item: OfflineMutation = {
        ...mutation,
        id,
        timestamp: new Date().toISOString()
      };
      await db.collections.mutations.insert(item);
    } catch (err) {
      console.warn('RxDB write warning:', err);
    }
  }

  static async getMutations(): Promise<OfflineMutation[]> {
    try {
      const db = await getRxDB();
      const docs = await db.collections.mutations.find().exec();
      return docs.map(doc => doc.toJSON() as OfflineMutation);
    } catch (err) {
      console.warn('RxDB read warning:', err);
      return [];
    }
  }

  static async clearMutations(): Promise<void> {
    try {
      const db = await getRxDB();
      const docs = await db.collections.mutations.find().exec();
      await Promise.all(docs.map(doc => doc.remove()));
    } catch (err) {
      console.warn('RxDB clear warning:', err);
    }
  }
}

export class SyncQueueManager {
  private static DIRTY_KEY = 'vinea_dirty_collections';
  private static DIRTY_REVISION_KEY = 'vinea_dirty_collection_revisions';
  private static DIRTY_RECORD_KEY = 'vinea_dirty_collection_records';
  private static operationTail: Promise<void> = Promise.resolve();
  private static ORG_STATE_KEYS = {
    orgId: 'cellarflow_org_state_org_id',
    source: 'cellarflow_org_state_source',
    version: 'cellarflow_org_state_version',
    updatedAt: 'cellarflow_org_state_updated_at',
    updatedBy: 'cellarflow_org_state_updated_by',
  };

  private static hasLocalStorage(): boolean {
    return typeof localStorage !== 'undefined';
  }

  private static currentOrganizationId(): string | null {
    if (!this.hasLocalStorage()) return null;
    const organizationId = localStorage.getItem(this.ORG_STATE_KEYS.orgId)?.trim();
    return organizationId || null;
  }

  private static pendingConflictSyncKey(organizationId = this.currentOrganizationId()): string {
    return organizationId
      ? `${PENDING_CONFLICT_SYNC_BASE_KEY}:${organizationId}`
      : PENDING_CONFLICT_SYNC_BASE_KEY;
  }

  private static pendingCommandsKey(organizationId = this.currentOrganizationId()): string {
    return organizationId
      ? `${PENDING_COMMANDS_BASE_KEY}:${organizationId}`
      : PENDING_COMMANDS_BASE_KEY;
  }

  static getPendingCommandIntents<TPayload = unknown>(
    organizationId = this.currentOrganizationId(),
  ): Array<PendingCommandIntent<TPayload>> {
    if (!this.hasLocalStorage()) return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(this.pendingCommandsKey(organizationId)) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((intent): intent is PendingCommandIntent<TPayload> => Boolean(
        intent
        && typeof intent === 'object'
        && typeof intent.commandId === 'string'
        && typeof intent.commandType === 'string'
        && typeof intent.capturedAt === 'string'
        && 'payload' in intent,
      ));
    } catch {
      return [];
    }
  }

  private static persistPendingCommandIntent(intent: PendingCommandIntent): void {
    if (!this.hasLocalStorage()) {
      throw new PendingCommandIntentLimitError(
        'pending_command_persistence_failed',
        'Durable browser storage is unavailable. Enable site storage before retrying; nothing was sent.',
        409,
      );
    }
    const storageKey = this.pendingCommandsKey();
    const current = this.getPendingCommandIntents();
    const withoutSameId = current.filter(item => item.commandId !== intent.commandId);
    if (withoutSameId.length >= MAX_PENDING_COMMAND_INTENTS) {
      throw new PendingCommandIntentLimitError(
        'pending_command_queue_full',
        `The durable command queue already contains ${MAX_PENDING_COMMAND_INTENTS} unacknowledged actions. Recover or discard those actions before creating another command.`,
        429,
      );
    }
    const serializedIntent = JSON.stringify(intent);
    if (serializedIntent.length > MAX_PENDING_COMMAND_INTENT_CHARS) {
      throw new PendingCommandIntentLimitError(
        'pending_command_intent_too_large',
        'This command is too large for safe browser recovery. Reduce attached or free-text data and retry.',
        413,
      );
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify([...withoutSameId, intent]));
    } catch {
      throw new PendingCommandIntentLimitError(
        'pending_command_persistence_failed',
        'The command could not be stored safely in this browser. Free browser storage before retrying; nothing was sent.',
        409,
      );
    }
    const persisted = this.getPendingCommandIntents()
      .find(item => item.commandId === intent.commandId);
    if (!persisted || JSON.stringify(persisted) !== serializedIntent) {
      throw new PendingCommandIntentLimitError(
        'pending_command_persistence_failed',
        'The command could not be verified in durable browser storage. Nothing was sent.',
        409,
      );
    }
  }

  static consumePendingCommandIntent(commandId: string): void {
    if (!this.hasLocalStorage()) return;
    const storageKey = this.pendingCommandsKey();
    const remaining = this.getPendingCommandIntents().filter(intent => intent.commandId !== commandId);
    if (remaining.length > 0) localStorage.setItem(storageKey, JSON.stringify(remaining));
    else localStorage.removeItem(storageKey);
  }

  static getWorkspaceTransitionMarker(): WorkspaceTransitionMarker | null {
    if (!this.hasLocalStorage()) return null;
    const raw = localStorage.getItem(WORKSPACE_TRANSITION_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<WorkspaceTransitionMarker> | null;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.startedAt !== 'string') {
        throw new Error('Invalid workspace transition marker');
      }
      const fromOrganizationId = typeof parsed.fromOrganizationId === 'string'
        ? parsed.fromOrganizationId
        : null;
      const toOrganizationId = typeof parsed.toOrganizationId === 'string'
        ? parsed.toOrganizationId
        : null;
      return { fromOrganizationId, toOrganizationId, startedAt: parsed.startedAt };
    } catch {
      // A present but unreadable marker must fail closed. LocalStorage writes are
      // atomic, but extensions/manual edits should never reopen a half-switched UI.
      return { fromOrganizationId: null, toOrganizationId: null, startedAt: 'unknown' };
    }
  }

  static hasWorkspaceTransitionMarker(): boolean {
    return this.getWorkspaceTransitionMarker() !== null;
  }

  static clearWorkspaceTransitionMarker(): boolean {
    if (!this.hasLocalStorage()) return true;
    try {
      localStorage.removeItem(WORKSPACE_TRANSITION_STORAGE_KEY);
      return localStorage.getItem(WORKSPACE_TRANSITION_STORAGE_KEY) === null;
    } catch {
      return false;
    }
  }

  static getPendingConflictSyncIntent(
    organizationId = this.currentOrganizationId(),
  ): PendingConflictSyncIntent | null {
    if (!this.hasLocalStorage()) return null;
    try {
      const raw = localStorage.getItem(this.pendingConflictSyncKey(organizationId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PendingConflictSyncIntent> | null;
      if (
        !parsed
        || typeof parsed !== 'object'
        || !parsed.payload
        || typeof parsed.payload !== 'object'
        || Array.isArray(parsed.payload)
        || !Array.isArray(parsed.dirtyCollections)
        || !parsed.dirtyCollections.every(key => typeof key === 'string')
        || !parsed.dirtyRevisions
        || typeof parsed.dirtyRevisions !== 'object'
        || Array.isArray(parsed.dirtyRevisions)
        || typeof parsed.capturedAt !== 'string'
      ) return null;
      return parsed as PendingConflictSyncIntent;
    } catch {
      return null;
    }
  }

  static clearPendingConflictSyncIntent(
    organizationId = this.currentOrganizationId(),
  ): boolean {
    if (!this.hasLocalStorage()) return true;
    const key = this.pendingConflictSyncKey(organizationId);
    try {
      localStorage.removeItem(key);
      return localStorage.getItem(key) === null;
    } catch {
      return false;
    }
  }

  static async isPendingConflictSyncIntentCurrent(
    intent: PendingConflictSyncIntent,
  ): Promise<boolean> {
    const activeOrganizationId = this.currentOrganizationId();
    if (intent.organizationId !== activeOrganizationId) return false;

    const dirty = this.getDirtyCollections();
    const revisions = this.getDirtyRevisions();
    const expectedDirty = new Set(intent.dirtyCollections);
    if (
      dirty.size !== expectedDirty.size
      || [...dirty].some(collection => !expectedDirty.has(collection))
      || intent.dirtyCollections.some(collection => (
        (revisions[collection] || 0) !== (intent.dirtyRevisions[collection] || 0)
      ))
    ) return false;

    if (this.hasLocalStorage()) {
      const signature = (record: DeletionTombstone) => JSON.stringify(deletionTombstoneStorageValue(record));
      const currentDeletions = new Set(
        readDeletionTombstones(localStorage, this.currentDeletionTombstoneKey()).map(signature),
      );
      const expectedDeletions = new Set<string>();
      for (const record of Array.isArray(intent.payload.deletedRecords) ? intent.payload.deletedRecords : []) {
        if (
          record
          && typeof record === 'object'
          && typeof (record as any).id === 'string'
          && typeof (record as any).collection === 'string'
        ) {
          expectedDeletions.add(signature({
            id: (record as any).id,
            collection: (record as any).collection,
            baselineTimestamp: (record as any).baselineTimestamp,
            baselineFingerprint: (record as any).baselineFingerprint,
            deletedAt: (record as any).deletedAt,
          }));
        }
      }
      for (const id of Array.isArray(intent.payload.deletedIds) ? intent.payload.deletedIds : []) {
        if (typeof id === 'string') expectedDeletions.add(signature({ id }));
      }
      if (
        currentDeletions.size !== expectedDeletions.size
        || [...currentDeletions].some(record => !expectedDeletions.has(record))
      ) return false;
    }

    const capturedAt = Date.parse(intent.capturedAt);
    if (!Number.isFinite(capturedAt)) return false;
    const mutations = await IndexedDBQueue.getMutations();
    return !mutations.some(mutation => {
      const timestamp = Date.parse(mutation.timestamp);
      return !Number.isFinite(timestamp) || timestamp > capturedAt;
    });
  }

  /** Atomically persist local/server choices for versioned deletion conflicts. */
  static async reconcilePendingConflictDeletionRecords(
    retained: DeletionTombstone[],
    discarded: DeletionTombstone[],
    organizationId?: string | null,
  ): Promise<boolean> {
    if (!this.hasLocalStorage()) return true;
    const targetOrganizationId = organizationId === undefined
      ? this.currentOrganizationId()
      : (organizationId?.trim() || null);
    const tombstoneKey = targetOrganizationId
      ? `${DELETION_TOMBSTONE_BASE_KEY}:${targetOrganizationId}`
      : DELETION_TOMBSTONE_BASE_KEY;
    const conflictIntentKey = this.pendingConflictSyncKey(targetOrganizationId);
    const { reconcileDeletionConflictRecords } = await import('./syncDeletionConflict');
    return reconcileDeletionConflictRecords({
      storage: localStorage,
      tombstoneKey,
      conflictIntentKey,
      retained,
      discarded,
      readIntent: () => this.getPendingConflictSyncIntent(targetOrganizationId),
    });
  }

  /**
   * Persist an explicit "keep server" choice for deletion conflicts without
   * touching collection dirtiness, offline mutations, or unrelated tombstones.
   */
  static discardPendingConflictDeletions(
    discarded: DeletionTombstone[],
    organizationId?: string | null,
  ): boolean {
    const valid = discarded.every(record => (
      record
      && typeof record.id === 'string'
      && record.id.length > 0
      && (record.collection === undefined
        || (typeof record.collection === 'string' && record.collection.length > 0))
    ));
    if (!valid) return false;
    if (discarded.length === 0 || !this.hasLocalStorage()) return true;

    const targetOrganizationId = organizationId === undefined
      ? this.currentOrganizationId()
      : (organizationId?.trim() || null);
    const tombstoneKey = targetOrganizationId
      ? `${DELETION_TOMBSTONE_BASE_KEY}:${targetOrganizationId}`
      : DELETION_TOMBSTONE_BASE_KEY;
    const conflictIntentKey = this.pendingConflictSyncKey(targetOrganizationId);
    const identity = (record: DeletionTombstone) => `${record.collection || '*'}\u0000${record.id}`;
    const discardedIdentities = new Set(discarded.map(identity));

    const originalTombstones = localStorage.getItem(tombstoneKey);
    const originalIntent = localStorage.getItem(conflictIntentKey);
    try {
      const remainingTombstones = readDeletionTombstones(localStorage, tombstoneKey)
        .filter(record => !discardedIdentities.has(identity(record)));
      if (remainingTombstones.length > 0) {
        localStorage.setItem(tombstoneKey, JSON.stringify(remainingTombstones.map(deletionTombstoneStorageValue)));
      } else {
        localStorage.removeItem(tombstoneKey);
      }

      const intent = this.getPendingConflictSyncIntent(targetOrganizationId);
      if (intent) {
        const payload = { ...intent.payload } as Record<string, any>;
        if (Array.isArray(payload.deletedRecords)) {
          payload.deletedRecords = payload.deletedRecords.filter((record: unknown) => (
            !record
            || typeof record !== 'object'
            || typeof (record as any).id !== 'string'
            || !discardedIdentities.has(identity({
              id: (record as any).id,
              collection: typeof (record as any).collection === 'string'
                ? (record as any).collection
                : undefined,
            }))
          ));
          if (payload.deletedRecords.length === 0) delete payload.deletedRecords;
        }
        if (Array.isArray(payload.deletedIds)) {
          payload.deletedIds = payload.deletedIds.filter((id: unknown) => (
            typeof id !== 'string' || !discardedIdentities.has(identity({ id }))
          ));
          if (payload.deletedIds.length === 0) delete payload.deletedIds;
        }
        localStorage.setItem(conflictIntentKey, JSON.stringify({ ...intent, payload }));
      }

      const durableTombstones = readDeletionTombstones(localStorage, tombstoneKey);
      if (durableTombstones.some(record => discardedIdentities.has(identity(record)))) {
        throw new Error('Selected deletion tombstones remained in storage.');
      }
      const durableIntent = this.getPendingConflictSyncIntent(targetOrganizationId);
      const durableRecords = Array.isArray(durableIntent?.payload.deletedRecords)
        ? durableIntent.payload.deletedRecords as DeletionTombstone[]
        : [];
      const durableIds = Array.isArray(durableIntent?.payload.deletedIds)
        ? durableIntent.payload.deletedIds as string[]
        : [];
      if (
        durableRecords.some(record => discardedIdentities.has(identity(record)))
        || durableIds.some(id => discardedIdentities.has(identity({ id })))
      ) {
        throw new Error('Selected deletion intent remained in storage.');
      }
      return true;
    } catch {
      // Best-effort rollback keeps the operation fail-closed if either durable
      // representation cannot be updated.
      try {
        if (originalTombstones === null) localStorage.removeItem(tombstoneKey);
        else localStorage.setItem(tombstoneKey, originalTombstones);
        if (originalIntent === null) localStorage.removeItem(conflictIntentKey);
        else localStorage.setItem(conflictIntentKey, originalIntent);
      } catch {
        // The caller receives false and must keep the resolution UI blocked.
      }
      return false;
    }
  }

  private static persistWorkspaceTransitionMarker(marker: WorkspaceTransitionMarker): void {
    if (!this.hasLocalStorage()) return;
    localStorage.setItem(WORKSPACE_TRANSITION_STORAGE_KEY, JSON.stringify(marker));
    const durable = this.getWorkspaceTransitionMarker();
    if (!durable || durable.startedAt !== marker.startedAt) {
      throw new Error('Workspace changed, but its transition lock could not be saved safely.');
    }
  }

  private static persistPendingConflictSyncIntent(
    intent: PendingConflictSyncIntent,
    storageKey: string,
  ): void {
    if (!this.hasLocalStorage()) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(intent));
    } catch {
      // Dirty revisions, tombstones, and IndexedDB remain authoritative even if
      // this convenience snapshot cannot be persisted (for example, quota full).
    }
  }

  private static runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail.catch(() => undefined);
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(operation).finally(release);
  }

  /** Serialize an organization-bound request with sync and workspace changes. */
  static runInOrganizationContext<T>(operation: () => Promise<T>): Promise<T> {
    return this.runExclusive(operation);
  }

  /** Save command intent before sending and serialize it with sync/switch work. */
  static executeCommandRequest(
    endpoint: string,
    intent: PendingCommandIntent,
  ): Promise<Response> {
    return this.runExclusive(async () => {
      try {
        this.persistPendingCommandIntent(intent);
      } catch (error) {
        const rejected = error instanceof PendingCommandIntentLimitError
          ? error
          : new PendingCommandIntentLimitError(
            'pending_command_persistence_failed',
            'The command could not be stored safely in this browser. Nothing was sent.',
            409,
          );
        return new Response(JSON.stringify({
          ok: false,
          error: { code: rejected.code, message: rejected.message, retryable: false },
        }), {
          status: rejected.statusCode,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const headers = this.requestHeaders();
      const capturedAt = Date.parse(intent.capturedAt);
      if (Number.isFinite(capturedAt)) {
        headers['X-CellarFlow-Queue-Age-Ms'] = String(Math.max(0, Date.now() - capturedAt));
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ commandId: intent.commandId, payload: intent.payload }),
      });
      this.rememberOrgStateHeaders(response);
      return response;
    });
  }

  private static async hasPendingChangesUnlocked(): Promise<boolean> {
    if (this.hasLocalStorage()) {
      if (this.getDirtyCollections().size > 0) return true;
      if (readDeletionTombstones(localStorage, this.currentDeletionTombstoneKey()).length > 0) return true;
      if (this.getPendingConflictSyncIntent()) return true;
      if (this.getPendingCommandIntents().length > 0) return true;
    }
    return (await IndexedDBQueue.getMutations()).length > 0;
  }

  /** Whether the active workspace has durable local intent that must not be abandoned. */
  static async hasPendingChanges(): Promise<boolean> {
    return this.runExclusive(() => this.hasPendingChangesUnlocked());
  }

  private static pendingChangesSwitchResponse(): Response {
    return new Response(JSON.stringify({
      code: PENDING_CHANGES_SWITCH_CODE,
      error: PENDING_CHANGES_SWITCH_ERROR,
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private static requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!this.hasLocalStorage()) return headers;

    const version = localStorage.getItem(this.ORG_STATE_KEYS.version);
    const orgId = localStorage.getItem(this.ORG_STATE_KEYS.orgId);
    if (version) headers['X-CellarFlow-Org-State-Version'] = version;
    if (orgId) headers['X-CellarFlow-Org-Id'] = orgId;
    return headers;
  }

  private static rememberOrgStateHeaders(res: Response): void {
    if (!this.hasLocalStorage()) return;

    const pairs: Array<[string, string]> = [
      [this.ORG_STATE_KEYS.orgId, 'X-CellarFlow-Org-Id'],
      [this.ORG_STATE_KEYS.source, 'X-CellarFlow-Org-State-Source'],
      [this.ORG_STATE_KEYS.version, 'X-CellarFlow-Org-State-Version'],
      [this.ORG_STATE_KEYS.updatedAt, 'X-CellarFlow-Org-State-Updated-At'],
      [this.ORG_STATE_KEYS.updatedBy, 'X-CellarFlow-Org-State-Updated-By'],
    ];

    for (const [storageKey, headerName] of pairs) {
      const value = res.headers.get(headerName);
      if (value) localStorage.setItem(storageKey, value);
    }
  }

  static getDirtyCollections(): Set<string> {
    const stored = localStorage.getItem(this.DIRTY_KEY);
    if (!stored) return new Set();
    try {
      return new Set(JSON.parse(stored));
    } catch {
      return new Set();
    }
  }

  private static getDirtyRevisions(): Record<string, number> {
    if (!this.hasLocalStorage()) return {};
    try {
      const parsed = JSON.parse(localStorage.getItem(this.DIRTY_REVISION_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, value]) => (
        typeof value === 'number' && Number.isFinite(value) && value >= 0
      ))) as Record<string, number>;
    } catch {
      return {};
    }
  }

  /**
   * Which records within a dirty collection actually changed.
   *
   * A collection present in the dirty set but ABSENT here means "send the whole
   * collection": some callers mark a collection dirty without knowing which
   * records moved (a conflict retry, for instance), and sending everything is
   * the safe reading of "something in here changed".
   *
   * Shape: `{ [collection]: string[] }`. A collection is removed from this map
   * — not set to an empty array — when it must be sent whole.
   */
  private static getDirtyRecordIds(): Record<string, string[]> {
    if (!this.hasLocalStorage()) return {};
    try {
      const parsed = JSON.parse(localStorage.getItem(this.DIRTY_RECORD_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed)
          .filter(([, value]) => Array.isArray(value) && value.every(id => typeof id === 'string'))
      ) as Record<string, string[]>;
    } catch {
      return {};
    }
  }

  private static writeDirtyRecordIds(map: Record<string, string[]>): void {
    if (!this.hasLocalStorage()) return;
    if (Object.keys(map).length === 0) localStorage.removeItem(this.DIRTY_RECORD_KEY);
    else localStorage.setItem(this.DIRTY_RECORD_KEY, JSON.stringify(map));
  }

  /**
   * Mark a collection as needing to be pushed.
   *
   * `recordIds` narrows the push to the records that actually changed. Sync
   * previously sent every record of a dirty collection — editing one
   * fermentation log uploaded every fermentation log the winery had — even
   * though the server merges per record and leaves anything absent from the
   * payload untouched (`mergeCollections` in `server/sync.ts`).
   *
   * Omitting `recordIds` means the caller cannot say which records moved, and
   * the whole collection is sent. Once a collection is pending that way it
   * stays that way until it is sent: a caller that knew only "something
   * changed" must not be narrowed by a later caller that knew more.
   *
   * An EMPTY array is different from omitting it, and the distinction is
   * load-bearing. The collection effect in `useWineryState` re-runs after the
   * local mirror has been updated, so a second pass over the same edit finds no
   * per-record difference and legitimately has nothing to add. Treating that as
   * "cannot say" would widen the payload straight back to the whole collection
   * and undo the narrowing on almost every edit — which is exactly what it did
   * before this distinction existed. It only falls back to the whole collection
   * when there is nothing pending to send, where sending too much is the safe
   * failure.
   */
  static markDirty(collectionName: string, recordIds?: readonly string[]): void {
    const dirty = this.getDirtyCollections();
    const records = this.getDirtyRecordIds();
    // Captured before this call joins the set: a collection already pending
    // without a record list is pending as a whole-collection push.
    const pendingWholeCollection = dirty.has(collectionName) && !(collectionName in records);
    const pendingIds = records[collectionName];

    const revisions = this.getDirtyRevisions();
    dirty.add(collectionName);
    revisions[collectionName] = (revisions[collectionName] || 0) + 1;
    localStorage.setItem(this.DIRTY_KEY, JSON.stringify(Array.from(dirty)));
    localStorage.setItem(this.DIRTY_REVISION_KEY, JSON.stringify(revisions));

    const named = (recordIds || []).filter(id => typeof id === 'string' && !!id);
    const cannotName = !recordIds || (named.length === 0 && !pendingIds);

    if (cannotName) {
      delete records[collectionName];
      this.writeDirtyRecordIds(records);
      return;
    }
    // Never narrow a pending whole-collection push: the caller that asked for
    // one knew less than this one, not more.
    if (pendingWholeCollection) return;

    const merged = new Set(pendingIds || []);
    for (const id of named) merged.add(id);
    records[collectionName] = [...merged];
    this.writeDirtyRecordIds(records);
  }

  /**
   * Stage which records changed, without marking the collection dirty.
   *
   * `handleCollectionUpdate` writes the local mirror and returns before
   * marking anything dirty; the effect then re-runs, finds storage already
   * matching, and it is that second pass which calls `markDirty`. So the pass
   * that knows which records moved is never the pass that marks the collection.
   * This carries the ids from the first to the second.
   */
  static noteChangedRecords(collectionName: string, recordIds: readonly string[]): void {
    if (!this.hasLocalStorage()) return;
    const records = this.getDirtyRecordIds();
    // A pending whole-collection push stays whole.
    if (this.getDirtyCollections().has(collectionName) && !(collectionName in records)) return;

    const merged = new Set(records[collectionName] || []);
    for (const id of recordIds) if (typeof id === 'string' && id) merged.add(id);
    if (merged.size === 0) return;
    records[collectionName] = [...merged];
    this.writeDirtyRecordIds(records);
  }

  /**
   * The records to send for a dirty collection, or `null` to send it whole.
   */
  static dirtyRecordIdsFor(collectionName: string): Set<string> | null {
    const records = this.getDirtyRecordIds();
    return collectionName in records ? new Set(records[collectionName]) : null;
  }

  static clearDirty(): void {
    localStorage.removeItem(this.DIRTY_KEY);
    localStorage.removeItem(this.DIRTY_REVISION_KEY);
    localStorage.removeItem(this.DIRTY_RECORD_KEY);
  }

  /**
   * Clear only the given collections. Flags marked while a sync was in
   * flight must survive it, or those changes would never be pushed.
   */
  static clearDirtyKeys(keys: Iterable<string>, sentRevisions?: Record<string, number>): void {
    const dirty = this.getDirtyCollections();
    const currentRevisions = this.getDirtyRevisions();
    const records = this.getDirtyRecordIds();
    for (const key of keys) {
      // A collection edited again while the sync was in flight keeps both its
      // flag and its pending record ids, or that edit would never be pushed.
      if (sentRevisions && (currentRevisions[key] || 0) !== (sentRevisions[key] || 0)) continue;
      dirty.delete(key);
      delete currentRevisions[key];
      delete records[key];
    }
    this.writeDirtyRecordIds(records);
    if (dirty.size === 0) {
      localStorage.removeItem(this.DIRTY_KEY);
      localStorage.removeItem(this.DIRTY_REVISION_KEY);
    } else {
      localStorage.setItem(this.DIRTY_KEY, JSON.stringify(Array.from(dirty)));
      localStorage.setItem(this.DIRTY_REVISION_KEY, JSON.stringify(currentRevisions));
    }
  }

  static isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  static async clearOfflineQueue(): Promise<void> {
    await this.runExclusive(async () => {
      await IndexedDBQueue.clearMutations();
      this.clearDirty();
    });
  }

  /** Discard queued writes and deletion tombstones for the current context. */
  static async discardPendingChanges(): Promise<void> {
    const tombstoneKey = this.currentDeletionTombstoneKey();
    const conflictIntentKey = this.pendingConflictSyncKey();
    const pendingCommandsKey = this.pendingCommandsKey();
    await this.runExclusive(() => this.discardPendingChangesForKey(
      tombstoneKey,
      conflictIntentKey,
      pendingCommandsKey,
    ));
  }

  /** Fetch authoritative state first, then discard local intent atomically. */
  static async discardPendingChangesAndFetch(
    isValidSnapshot?: (value: unknown) => boolean,
  ): Promise<any> {
    return this.runExclusive(async () => {
      const tombstoneKey = this.currentDeletionTombstoneKey();
      const conflictIntentKey = this.pendingConflictSyncKey();
      const pendingCommandsKey = this.pendingCommandsKey();
      const response = await fetch('/api/db', { headers: this.requestHeaders() });
      this.rememberOrgStateHeaders(response);
      if (!response.ok) {
        const error = await response.json().catch(() => ({} as any));
        return { syncError: error.error || `Refresh rejected (HTTP ${response.status})` };
      }
      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') {
        return { syncError: 'Server state could not be read. Local changes were kept.' };
      }
      if (!isValidSnapshot) {
        return { syncError: 'A complete server snapshot could not be verified. Local changes were kept.' };
      }
      let validSnapshot = false;
      try {
        validSnapshot = isValidSnapshot(data);
      } catch {
        validSnapshot = false;
      }
      if (!validSnapshot) {
        return { syncError: 'Server state was incomplete. Local changes were kept.' };
      }
      await this.discardPendingChangesForKey(tombstoneKey, conflictIntentKey, pendingCommandsKey);
      return data;
    });
  }

  /** Remove tenant-scoped request metadata after the current queue is cleared. */
  static clearOrganizationContext(): void {
    if (!this.hasLocalStorage()) return;
    for (const key of Object.values(this.ORG_STATE_KEYS)) {
      localStorage.removeItem(key);
    }
    this.clearWorkspaceTransitionMarker();
  }

  /**
   * Run an organization switch and discard the previous organization's local
   * pending state only after the switch operation succeeds. The operation must
   * reject when the server did not accept the switch.
   */
  static async switchOrganizationContext(
    switchOperation: () => Promise<Response>,
  ): Promise<Response> {
    return this.runExclusive(async () => {
      if (await this.hasPendingChangesUnlocked()) {
        return this.pendingChangesSwitchResponse();
      }

      const previousOrganizationId = this.currentOrganizationId();
      const response = await switchOperation();
      if (response.ok) {
        const responseOrganizationId = response.headers.get('X-CellarFlow-Org-Id')?.trim() || '';
        const body = await response.clone().json().catch(() => ({} as any));
        const activeOrganizationId = responseOrganizationId
          || (typeof body?.activeOrganizationId === 'string' ? body.activeOrganizationId.trim() : '')
          || (typeof body?.organizationId === 'string' ? body.organizationId.trim() : '');

        // Persist before changing request metadata so a reload can never render
        // tenant caches between the server-side switch and authoritative hydrate.
        this.persistWorkspaceTransitionMarker({
          fromOrganizationId: previousOrganizationId,
          toOrganizationId: activeOrganizationId || null,
          startedAt: new Date().toISOString(),
        });
        this.rememberOrgStateHeaders(response);
        if (this.hasLocalStorage() && !responseOrganizationId) {
          if (activeOrganizationId) {
            // The /api/org/switch response carries the new id in JSON rather
            // than organization-state headers. Never reuse the previous
            // organization's version metadata in the new request context.
            localStorage.setItem(this.ORG_STATE_KEYS.orgId, activeOrganizationId);
            localStorage.removeItem(this.ORG_STATE_KEYS.source);
            localStorage.removeItem(this.ORG_STATE_KEYS.version);
            localStorage.removeItem(this.ORG_STATE_KEYS.updatedAt);
            localStorage.removeItem(this.ORG_STATE_KEYS.updatedBy);
          }
        }
      }
      return response;
    });
  }

  static async sync(currentState: any): Promise<any | null> {
    return this.runExclusive(() => this.syncUnlocked(currentState));
  }

  private static serverCollectionKey(clientCollectionKey: string): string {
    if (clientCollectionKey === 'notesList') return 'notes';
    if (clientCollectionKey === 'fermLogs') return 'fermlogs';
    if (clientCollectionKey === 'labLogs') return 'lablogs';
    return clientCollectionKey;
  }

  private static createPendingConflictSyncIntent(
    payload: Record<string, unknown>,
    sentDirtyRevisions: Record<string, number>,
    organizationId: string | null,
  ): PendingConflictSyncIntent {
    let payloadSnapshot: Record<string, unknown> = { ...payload };
    try {
      payloadSnapshot = JSON.parse(JSON.stringify(payload));
    } catch {
      // Sync payloads are JSON API values. Keep a shallow snapshot only as a
      // fallback; the original dirty caches and IndexedDB mutations still live.
    }
    return {
      payload: payloadSnapshot,
      dirtyCollections: Object.keys(sentDirtyRevisions),
      dirtyRevisions: { ...sentDirtyRevisions },
      organizationId,
      capturedAt: new Date().toISOString(),
    };
  }

  private static conflictResult(
    data: Record<string, any>,
    pendingSyncIntent: PendingConflictSyncIntent,
    conflictIntentKey: string,
  ): Record<string, any> {
    this.persistPendingConflictSyncIntent(pendingSyncIntent, conflictIntentKey);
    return { ...data, pendingSyncIntent };
  }

  private static withoutDeletionIntent(
    intent: PendingConflictSyncIntent,
    recoverableCollections?: unknown,
  ): PendingConflictSyncIntent {
    const payload = { ...intent.payload } as Record<string, unknown>;
    delete payload.deletedIds;
    delete payload.deletedRecords;
    if (
      recoverableCollections
      && typeof recoverableCollections === 'object'
      && !Array.isArray(recoverableCollections)
    ) {
      for (const [collection, value] of Object.entries(recoverableCollections)) {
        if (Object.prototype.hasOwnProperty.call(payload, collection)) {
          payload[collection] = value;
        }
      }
    }
    return { ...intent, payload };
  }

  private static consumePendingConflictSyncIntent(
    expected: PendingConflictSyncIntent | null,
    storageKey: string,
  ): void {
    if (!expected || !this.hasLocalStorage()) return;
    const current = this.getPendingConflictSyncIntent(expected.organizationId);
    // Do not let an older in-flight request acknowledge a newer conflict intent
    // created by another tab or a later retry.
    if (!current || current.capturedAt !== expected.capturedAt) return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Leaving an already-acknowledged snapshot behind is safer than deleting
      // a different intent; the user can still discard the stale marker.
    }
  }

  private static async syncUnlocked(currentState: any): Promise<any | null> {
    // Keep this key stable for the whole request. Response headers may update
    // the active organization while a sync is in flight.
    const tombstoneKey = this.currentDeletionTombstoneKey();
    const organizationId = this.currentOrganizationId();
    const conflictIntentKey = this.pendingConflictSyncKey(organizationId);
    const conflictIntentAtRequestStart = this.getPendingConflictSyncIntent(organizationId);

    // 1. If offline, exit immediately since mutations are queued directly on write
    if (!this.isOnline()) {
      return null;
    }

    // 2. Capture the exact transaction before conflict detection. A compound
    // workflow may contain clean siblings alongside the one conflicting record;
    // resolution must be able to retry the whole attempted POST, not just the
    // record displayed in the conflict modal.
    const offlineMutations = await IndexedDBQueue.getMutations();
    const dirty = this.getDirtyCollections();
    const dirtyRevisions = this.getDirtyRevisions();
    const sentDirtyCollections = new Set<string>();
    const sentDirtyRevisions: Record<string, number> = {};
    const payload: Record<string, any> = {};

    dirty.forEach((clientKey) => {
      if (
        !currentState
        || typeof currentState !== 'object'
        || !Object.prototype.hasOwnProperty.call(currentState, clientKey)
        || currentState[clientKey] === undefined
      ) return;

      // Send only the records that changed. The server merges per record and
      // leaves anything absent from the payload untouched — deletion travels
      // separately as an explicit tombstone — so a narrowed payload is the same
      // transaction, minus the records that were never edited.
      const value = currentState[clientKey];
      const changedIds = SyncQueueManager.dirtyRecordIdsFor(clientKey);
      payload[this.serverCollectionKey(clientKey)] = Array.isArray(value) && changedIds
        ? value.filter((record: any) => record?.id && changedIds.has(record.id))
        : value;
      sentDirtyCollections.add(clientKey);
      sentDirtyRevisions[clientKey] = dirtyRevisions[clientKey] || 0;
    });

    const deletionTombstones = this.hasLocalStorage()
      ? readDeletionTombstones(localStorage, tombstoneKey)
      : [];
    const deletedRecords = deletionTombstones.filter(record => record.collection);
    const deletedIds = deletionTombstones
      .filter(record => !record.collection)
      .map(record => record.id);

    if (deletedRecords.length > 0) payload.deletedRecords = deletedRecords;
    if (deletedIds.length > 0) payload.deletedIds = deletedIds;

    const hasChanges = Object.keys(payload).length > 0;
    const pendingSyncIntent = this.createPendingConflictSyncIntent(
      payload,
      sentDirtyRevisions,
      organizationId,
    );

    // Check queued offline mutations against the authoritative snapshot before
    // sending the captured transaction.
    if (offlineMutations.length > 0) {
      try {
        // Fetch server state to compare for conflict detection
        const serverRes = await fetch('/api/db', { headers: this.requestHeaders() });
        if (serverRes.ok) {
          this.rememberOrgStateHeaders(serverRes);
          const serverDb = await serverRes.json();
          const conflicts: any[] = [];

          offlineMutations.forEach(mut => {
            if (mut.action === 'put') {
              const serverCol = mut.collection === 'notesList' ? 'notes' :
                                mut.collection === 'fermLogs' ? 'fermlogs' :
                                mut.collection === 'labLogs' ? 'lablogs' : mut.collection;
              const serverRecord = serverDb[serverCol]?.find((x: any) => x.id === mut.recordId);
              if (serverRecord) {
                // If server record was modified since client's baseline copy, we flag a conflict
                const baselineTS = mut.baselineTimestamp ? new Date(mut.baselineTimestamp).getTime() : 0;
                const serverTS = serverRecord.lastModified ? new Date(serverRecord.lastModified).getTime() : 0;

                if (serverTS > 0 && baselineTS > 0 && serverTS !== baselineTS) {
                  conflicts.push({
                    collection: mut.collection,
                    recordId: mut.recordId,
                    local: mut.data,
                    server: serverRecord
                  });
                }
              }
            }
          });

          if (conflicts.length > 0) {
            // Return conflicts to trigger frontend resolution modal
            return this.conflictResult({
              hasConflicts: true,
              conflicts,
              serverDb
            }, pendingSyncIntent, conflictIntentKey);
          }
        }
      } catch (err) {
        console.error('Pre-sync conflict check failed:', err);
      }
    }

    // 3. Perform standard online synchronization
    try {
      const endpoint = hasChanges ? '/api/sync' : '/api/db';
      const method = hasChanges ? 'POST' : 'GET';
      const options: RequestInit = {
        method,
        headers: this.requestHeaders()
      };

      if (method === 'POST') {
        options.body = JSON.stringify(payload);
      }

      const res = await fetch(endpoint, options);
      if (res.ok) {
        this.rememberOrgStateHeaders(res);
        const data = await res.json().catch(() => null);
        if (!data || typeof data !== 'object') {
          return { syncError: 'Sync returned an unreadable server response. Local changes were kept for retry.' };
        }
        if (data.hasConflicts) {
          // A deletion-rejected response is an explicit server decision, even
          // when another record still needs manual conflict resolution. Retire
          // only the rejected tombstones and keep the rest of the transaction
          // durable for the resolver.
          const recoverableIntent = data.deletionRejected
            ? this.withoutDeletionIntent(pendingSyncIntent, data.recoverableCollections)
            : pendingSyncIntent;
          if (data.deletionRejected) {
            this.consumeDeletionTombstones(deletionTombstones, tombstoneKey);
          }
          return this.conflictResult(data, recoverableIntent, conflictIntentKey);
        }
        const hasUnsentDirtyCollections = [...dirty].some(key => !sentDirtyCollections.has(key));
        this.clearDirtyKeys(sentDirtyCollections, sentDirtyRevisions);
        this.consumeDeletionTombstones(deletionTombstones, tombstoneKey);
        // A state-less fetch (for example initial boot sync({})) must never erase
        // offline mutations for dirty collections it did not actually send.
        if (method === 'POST' && !hasUnsentDirtyCollections) {
          await IndexedDBQueue.clearMutations();
          this.consumePendingConflictSyncIntent(conflictIntentAtRequestStart, conflictIntentKey);
        }
        return data;
      }
      this.rememberOrgStateHeaders(res);
      let rejectionPayload: any | null = null;

      if (method === 'POST' && res.status === 409) {
        rejectionPayload = await res.json().catch(() => ({} as any));
        if (rejectionPayload?.code === 'org_state_conflict') {
          const retryOptions: RequestInit = {
            method,
            headers: this.requestHeaders(),
            body: JSON.stringify(payload)
          };
          const retryRes = await fetch(endpoint, retryOptions);
          this.rememberOrgStateHeaders(retryRes);

          if (retryRes.ok) {
            const data = await retryRes.json().catch(() => null);
            if (!data || typeof data !== 'object') {
              return {
                syncError: 'Sync returned an unreadable server response. Local changes were kept for retry.',
              };
            }
            if (data.hasConflicts) {
              const recoverableIntent = data.deletionRejected
                ? this.withoutDeletionIntent(pendingSyncIntent, data.recoverableCollections)
                : pendingSyncIntent;
              if (data.deletionRejected) {
                this.consumeDeletionTombstones(deletionTombstones, tombstoneKey);
              }
              return this.conflictResult(
                { ...data, recoveredOrgStateConflict: true },
                recoverableIntent,
                conflictIntentKey,
              );
            }
            const hasUnsentDirtyCollections = [...dirty].some(key => !sentDirtyCollections.has(key));
            this.clearDirtyKeys(sentDirtyCollections, sentDirtyRevisions);
            this.consumeDeletionTombstones(deletionTombstones, tombstoneKey);
            if (!hasUnsentDirtyCollections) {
              await IndexedDBQueue.clearMutations();
              this.consumePendingConflictSyncIntent(conflictIntentAtRequestStart, conflictIntentKey);
            }
            return { ...data, recoveredOrgStateConflict: true };
          }

          const retryPayload = await retryRes.json().catch(() => ({} as any));
          this.persistPendingConflictSyncIntent(pendingSyncIntent, conflictIntentKey);
          return {
            orgStateConflict: true,
            syncError: retryPayload.error || rejectionPayload.error || `Sync rejected (HTTP ${retryRes.status})`,
            serverDb: retryPayload.serverDb || rejectionPayload.serverDb,
            status: retryRes.status,
            code: retryPayload.code || rejectionPayload.code,
            ...(retryRes.status === 403 ? { permissionDenied: true } : {}),
            pendingSyncIntent,
          };
        }
      }

      // Every UI workflow may span several ledgers (for example bottling writes
      // lot, inventory, cost, run, and movement records). A 4xx must preserve
      // that transaction boundary; collection-by-collection salvage can commit
      // a permanently partial workflow.
      if (method === 'POST' && res.status >= 400 && res.status < 500) {
        const firstErr = rejectionPayload || await res.json().catch(() => ({} as any));
        return {
          syncError: firstErr.error || `Sync rejected (HTTP ${res.status})`,
          status: res.status,
          ...(typeof firstErr.code === 'string' ? { code: firstErr.code } : {}),
          ...(res.status === 403 ? { permissionDenied: true } : {}),
        };
      }

      const responseError = rejectionPayload || await res.json().catch(() => ({} as any));
      return {
        syncError: responseError.error || `Sync rejected (HTTP ${res.status})`,
        status: res.status,
        ...(typeof responseError.code === 'string' ? { code: responseError.code } : {}),
        ...(res.status === 403 ? { permissionDenied: true } : {}),
      };
    } catch (err) {
      console.error('ERP Sync failed:', err);
    }
    return null;
  }

  private static currentDeletionTombstoneKey(): string {
    return this.hasLocalStorage()
      ? deletionTombstoneKey(localStorage)
      : 'vinea_deleted_ids';
  }

  private static async discardPendingChangesForKey(
    tombstoneKey: string,
    conflictIntentKey = this.pendingConflictSyncKey(),
    pendingCommandsKey = this.pendingCommandsKey(),
  ): Promise<void> {
    if (this.hasLocalStorage() && !clearDeletionTombstones(localStorage, tombstoneKey)) {
      throw new Error('Pending deletions could not be cleared from local storage.');
    }
    if (this.hasLocalStorage()) {
      try {
        localStorage.removeItem(conflictIntentKey);
        if (localStorage.getItem(conflictIntentKey) !== null) {
          throw new Error('Pending conflict intent could not be cleared from local storage.');
        }
        localStorage.removeItem(pendingCommandsKey);
        if (localStorage.getItem(pendingCommandsKey) !== null) {
          throw new Error('Pending command intent could not be cleared from local storage.');
        }
      } catch (error) {
        throw error instanceof Error
          ? error
          : new Error('Pending conflict intent could not be cleared from local storage.');
      }
    }
    await IndexedDBQueue.clearMutations();
    this.clearDirty();
  }

  private static consumeDeletionTombstones(
    sent: Array<{ id: string; collection?: string }>,
    tombstoneKey: string,
  ): void {
    // A request that began with an empty deletion snapshot must not erase a
    // tombstone created while that request was in flight.
    if (sent.length === 0 || !this.hasLocalStorage()) return;

    const identity = (record: { id: string; collection?: string }) => `${record.collection || '*'}\u0000${record.id}`;
    const sentIdentities = new Set(sent.map(identity));
    const current = readDeletionTombstones(localStorage, tombstoneKey);
    const remaining = current.filter(record => !sentIdentities.has(identity(record)));
    if (remaining.length > 0) {
      localStorage.setItem(tombstoneKey, JSON.stringify(remaining.map(deletionTombstoneStorageValue)));
    } else {
      clearDeletionTombstones(localStorage, tombstoneKey);
    }
  }
}
