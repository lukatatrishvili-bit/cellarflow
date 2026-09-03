import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistDeletionTombstone, persistDeletionTombstones } from '../lib/deletionTombstones';
import {
  IndexedDBQueue,
  MAX_PENDING_COMMAND_INTENT_CHARS,
  MAX_PENDING_COMMAND_INTENTS,
  PENDING_CHANGES_SWITCH_CODE,
  PENDING_COMMANDS_BASE_KEY,
  SyncQueueManager,
  WORKSPACE_TRANSITION_STORAGE_KEY,
} from '../lib/syncQueue';

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

describe('SyncQueueManager organization-state recovery', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('navigator', { onLine: true });
    vi.spyOn(IndexedDBQueue, 'getMutations').mockResolvedValue([]);
    vi.spyOn(IndexedDBQueue, 'clearMutations').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries once when PostgreSQL JSONB organization state changed mid-save', async () => {
    localStorage.setItem('vinea_dirty_collections', JSON.stringify(['tasks']));
    localStorage.setItem('cellarflow_org_state_version', '5');
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(
        {
          code: 'org_state_conflict',
          error: 'Organization data changed while saving.',
          serverDb: { tasks: [{ id: 'server-task', title: 'Server task' }] },
        },
        {
          status: 409,
          headers: {
            'X-CellarFlow-Org-State-Version': '6',
            'X-CellarFlow-Org-Id': 'org-1',
          },
        }
      ))
      .mockResolvedValueOnce(jsonResponse(
        { tasks: [{ id: 'client-task', title: 'Client task' }] },
        {
          status: 200,
          headers: {
            'X-CellarFlow-Org-State-Version': '7',
            'X-CellarFlow-Org-Id': 'org-1',
          },
        }
      ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await SyncQueueManager.sync({
      tasks: [{ id: 'client-task', title: 'Client task' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'X-CellarFlow-Org-State-Version': '5',
      }),
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'X-CellarFlow-Org-State-Version': '6',
      }),
    });
    expect(result).toMatchObject({
      recoveredOrgStateConflict: true,
      tasks: [{ id: 'client-task', title: 'Client task' }],
    });
    expect(localStorage.getItem('vinea_dirty_collections')).toBeNull();
    expect(localStorage.getItem('cellarflow_org_state_version')).toBe('7');
    expect(IndexedDBQueue.clearMutations).toHaveBeenCalledTimes(1);
  });

  it('returns a recoverable org-state conflict if the retry also fails', async () => {
    localStorage.setItem('vinea_dirty_collections', JSON.stringify(['tasks']));

    const firstServerDb = { tasks: [{ id: 'server-v1', title: 'Server v1' }] };
    const secondServerDb = { tasks: [{ id: 'server-v2', title: 'Server v2' }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(
        { code: 'org_state_conflict', error: 'First conflict', serverDb: firstServerDb },
        { status: 409 }
      ))
      .mockResolvedValueOnce(jsonResponse(
        { code: 'org_state_conflict', error: 'Second conflict', serverDb: secondServerDb },
        { status: 409 }
      ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await SyncQueueManager.sync({
      tasks: [{ id: 'client-task', title: 'Client task' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      orgStateConflict: true,
      syncError: 'Second conflict',
      serverDb: secondServerDb,
    });
    expect(localStorage.getItem('vinea_dirty_collections')).toBe(JSON.stringify(['tasks']));
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
  });

  it('keeps organization tombstones separated and consumes the captured organization key', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    persistDeletionTombstone('org-1-delete', localStorage, 'tasks');
    localStorage.setItem('cellarflow_org_state_org_id', 'org-2');
    persistDeletionTombstone('org-2-delete', localStorage, 'tasks');
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { tasks: [] },
      {
        headers: {
          'X-CellarFlow-Org-Id': 'org-2',
        },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await SyncQueueManager.sync({});

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      deletedRecords: [{ collection: 'tasks', id: 'org-1-delete' }],
    });
    expect(localStorage.getItem('vinea_deleted_ids:org-1')).toBeNull();
    expect(localStorage.getItem('vinea_deleted_ids:org-2')).toBe(JSON.stringify([{ collection: 'tasks', id: 'org-2-delete' }]));
    expect(localStorage.getItem('cellarflow_org_state_org_id')).toBe('org-2');
  });

  it('does not erase a deletion added while an empty-snapshot sync is in flight', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    let resolveFetch!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pendingResponse);
    vi.stubGlobal('fetch', fetchMock);

    const syncPromise = SyncQueueManager.sync({});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    persistDeletionTombstone('created-in-flight', localStorage, 'tasks');
    resolveFetch(jsonResponse({ tasks: [] }));
    await syncPromise;

    expect(fetchMock.mock.calls[0][0]).toBe('/api/db');
    expect(localStorage.getItem('vinea_deleted_ids:org-1')).toBe(
      JSON.stringify([{ collection: 'tasks', id: 'created-in-flight' }]),
    );
  });

  it('keeps a same-collection edit dirty when it is marked again during a POST', async () => {
    SyncQueueManager.markDirty('tasks');
    let resolveFetch!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(jsonResponse({ tasks: [{ id: 'task-1', title: 'newer' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const firstSync = SyncQueueManager.sync({ tasks: [{ id: 'task-1', title: 'first' }] });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    SyncQueueManager.markDirty('tasks');
    resolveFetch(jsonResponse({ tasks: [{ id: 'task-1', title: 'first' }] }));
    await firstSync;

    expect(SyncQueueManager.getDirtyCollections()).toEqual(new Set(['tasks']));

    await SyncQueueManager.sync({ tasks: [{ id: 'task-1', title: 'newer' }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      tasks: [{ id: 'task-1', title: 'newer' }],
    });
    expect(SyncQueueManager.getDirtyCollections().size).toBe(0);
  });

  it('preserves the exact compound transaction and every durable queue on a 2xx conflict', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    SyncQueueManager.markDirty('lots');
    SyncQueueManager.markDirty('bottlingRuns');
    persistDeletionTombstone('cost-deleted', localStorage, 'costEntries');
    vi.mocked(IndexedDBQueue.getMutations).mockResolvedValue([{
      id: 'mutation-1',
      collection: 'costEntries',
      recordId: 'cost-deleted',
      action: 'delete',
      timestamp: '2026-07-18T10:00:00.000Z',
    }]);

    const conflictBody = {
      hasConflicts: true,
      conflicts: [{ collection: 'lots', recordId: 'lot-1' }],
      serverDb: { lots: [{ id: 'lot-1', currentVolume: 90 }] },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ costEntries: [] }))
      .mockResolvedValueOnce(jsonResponse(conflictBody));
    vi.stubGlobal('fetch', fetchMock);

    const result = await SyncQueueManager.sync({
      lots: [{ id: 'lot-1', currentVolume: 100 }],
      bottlingRuns: [{ id: 'run-1', lotId: 'lot-1' }],
    });

    const expectedPayload = {
      lots: [{ id: 'lot-1', currentVolume: 100 }],
      bottlingRuns: [{ id: 'run-1', lotId: 'lot-1' }],
      deletedRecords: [{ collection: 'costEntries', id: 'cost-deleted' }],
    };
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual(expectedPayload);
    expect(result).toMatchObject({
      ...conflictBody,
      pendingSyncIntent: {
        payload: expectedPayload,
        dirtyCollections: ['lots', 'bottlingRuns'],
        organizationId: 'org-1',
      },
    });
    expect(SyncQueueManager.getDirtyCollections()).toEqual(new Set(['lots', 'bottlingRuns']));
    expect(localStorage.getItem('vinea_dirty_collection_revisions')).not.toBeNull();
    expect(localStorage.getItem('vinea_deleted_ids:org-1')).toBe(
      JSON.stringify([{ collection: 'costEntries', id: 'cost-deleted' }]),
    );
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
    expect(SyncQueueManager.getPendingConflictSyncIntent()).toEqual(result.pendingSyncIntent);

    expect(SyncQueueManager.clearPendingConflictSyncIntent()).toBe(true);
    expect(SyncQueueManager.getPendingConflictSyncIntent()).toBeNull();
    expect(SyncQueueManager.getDirtyCollections()).toEqual(new Set(['lots', 'bottlingRuns']));
    expect(localStorage.getItem('vinea_deleted_ids:org-1')).not.toBeNull();
  });

  it('clears the durable conflict snapshot only after the complete retry succeeds', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    SyncQueueManager.markDirty('salesOrders');
    SyncQueueManager.markDirty('salesDispatches');
    SyncQueueManager.markDirty('stockMovements');

    const attemptedState = {
      salesOrders: [{ id: 'order-1', status: 'fulfilled', dispatchId: 'dispatch-1' }],
      salesDispatches: [{ id: 'dispatch-1', salesOrderId: 'order-1', stockMovementId: 'move-1' }],
      stockMovements: [{ id: 'move-1', sourceRef: 'dispatch-1' }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        hasConflicts: true,
        conflicts: [{ collection: 'salesOrders', recordId: 'order-1' }],
        serverDb: { salesOrders: [{ id: 'order-1', status: 'reserved' }] },
      }))
      .mockResolvedValueOnce(jsonResponse(attemptedState));
    vi.stubGlobal('fetch', fetchMock);

    const conflict = await SyncQueueManager.sync(attemptedState);
    expect(conflict?.pendingSyncIntent?.dirtyCollections).toEqual([
      'salesOrders',
      'salesDispatches',
      'stockMovements',
    ]);
    expect(SyncQueueManager.getPendingConflictSyncIntent()).not.toBeNull();

    const resolved = await SyncQueueManager.sync(attemptedState);

    expect(resolved).toEqual(attemptedState);
    expect(SyncQueueManager.getPendingConflictSyncIntent()).toBeNull();
    expect(SyncQueueManager.getDirtyCollections().size).toBe(0);
    expect(IndexedDBQueue.clearMutations).toHaveBeenCalledOnce();
  });

  it('retires an explicitly rejected deletion while preserving the unresolved sibling transaction', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    SyncQueueManager.markDirty('salesOrders');
    persistDeletionTombstone('dispatch-1', localStorage, 'salesDispatches');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      hasConflicts: true,
      deletionRejected: true,
      deletionError: 'The dispatch gained a linked record.',
      conflicts: [{ collection: 'salesOrders', recordId: 'order-1' }],
      serverDb: {
        salesOrders: [{ id: 'order-1', status: 'fulfilled', dispatchId: 'dispatch-1' }],
        salesDispatches: [{ id: 'dispatch-1' }],
      },
      recoverableCollections: {
        salesOrders: [{ id: 'order-1', status: 'fulfilled', dispatchId: 'dispatch-1' }],
      },
    })));

    const result = await SyncQueueManager.sync({
      salesOrders: [{ id: 'order-1', status: 'reserved' }],
    });

    expect(result).toMatchObject({
      hasConflicts: true,
      deletionRejected: true,
      pendingSyncIntent: {
        payload: {
          salesOrders: [{ id: 'order-1', status: 'fulfilled', dispatchId: 'dispatch-1' }],
        },
      },
    });
    expect(localStorage.getItem('vinea_deleted_ids:org-1')).toBeNull();
    expect(SyncQueueManager.getPendingConflictSyncIntent()?.payload).not.toHaveProperty('deletedRecords');
    expect(SyncQueueManager.getDirtyCollections()).toEqual(new Set(['salesOrders']));
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
  });

  it('discards only deletion tombstones explicitly resolved to the server version', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    persistDeletionTombstone('task-server', localStorage, 'tasks');
    persistDeletionTombstone('task-local', localStorage, 'tasks');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      hasConflicts: true,
      conflicts: [{ collection: 'tasks', recordId: 'task-server' }],
      serverDb: { tasks: [{ id: 'task-server' }, { id: 'task-local' }] },
    })));

    await SyncQueueManager.sync({});
    expect(SyncQueueManager.discardPendingConflictDeletions([
      { collection: 'tasks', id: 'task-server' },
    ])).toBe(true);

    expect(localStorage.getItem('vinea_deleted_ids:org-1')).toBe(
      JSON.stringify([{ collection: 'tasks', id: 'task-local' }]),
    );
    expect(SyncQueueManager.getPendingConflictSyncIntent()?.payload.deletedRecords).toEqual([
      { collection: 'tasks', id: 'task-local' },
    ]);
  });

  it('rebases a local deletion choice in both durable recovery records atomically', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    const original = {
      collection: 'tasks',
      id: 'task-local',
      baselineTimestamp: '2026-07-20T08:00:00.000Z',
      baselineFingerprint: '0123abcd',
      deletedAt: '2026-07-20T08:05:00.000Z',
    };
    expect(persistDeletionTombstones([original], localStorage)).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      hasConflicts: true,
      conflicts: [{ collection: 'tasks', recordId: 'task-local', local: null }],
      serverDb: { tasks: [{ id: 'task-local', title: 'Remote edit' }] },
    })));
    await SyncQueueManager.sync({});
    const rebased = {
      ...original,
      baselineTimestamp: '2026-07-20T09:00:00.000Z',
      baselineFingerprint: 'deadbeef',
    };

    await expect(SyncQueueManager.reconcilePendingConflictDeletionRecords([rebased], [], 'org-1'))
      .resolves.toBe(true);

    expect(JSON.parse(localStorage.getItem('vinea_deleted_ids:org-1') || '[]')).toEqual([rebased]);
    const intent = SyncQueueManager.getPendingConflictSyncIntent('org-1');
    expect(intent?.payload.deletedRecords).toEqual([rebased]);
    expect(await SyncQueueManager.isPendingConflictSyncIntentCurrent(intent!)).toBe(true);
  });

  it('rejects a stale recovery snapshot after a newer local edit is recorded', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    SyncQueueManager.markDirty('tasks');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      hasConflicts: true,
      conflicts: [{ collection: 'tasks', recordId: 'task-1' }],
      serverDb: { tasks: [{ id: 'task-1', title: 'Server' }] },
    })));

    await SyncQueueManager.sync({ tasks: [{ id: 'task-1', title: 'Local' }] });
    const intent = SyncQueueManager.getPendingConflictSyncIntent();
    expect(intent).not.toBeNull();
    expect(await SyncQueueManager.isPendingConflictSyncIntentCurrent(intent!)).toBe(true);

    SyncQueueManager.markDirty('tasks');

    expect(await SyncQueueManager.isPendingConflictSyncIntentCurrent(intent!)).toBe(false);
    expect(SyncQueueManager.getDirtyCollections()).toEqual(new Set(['tasks']));
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
  });

  it('returns and persists the would-be transaction for a pre-sync offline conflict', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    SyncQueueManager.markDirty('tasks');
    const localTask = {
      id: 'task-1',
      title: 'Local title',
      lastModified: '2026-07-18T11:00:00.000Z',
    };
    vi.mocked(IndexedDBQueue.getMutations).mockResolvedValue([{
      id: 'mutation-1',
      collection: 'tasks',
      recordId: 'task-1',
      action: 'put',
      data: localTask,
      timestamp: '2026-07-18T11:00:00.000Z',
      baselineTimestamp: '2026-07-18T09:00:00.000Z',
    }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      tasks: [{
        id: 'task-1',
        title: 'Server title',
        lastModified: '2026-07-18T10:00:00.000Z',
      }],
    })));

    const result = await SyncQueueManager.sync({ tasks: [localTask] });

    expect(result).toMatchObject({
      hasConflicts: true,
      pendingSyncIntent: {
        payload: { tasks: [localTask] },
        dirtyCollections: ['tasks'],
        organizationId: 'org-1',
      },
    });
    expect(SyncQueueManager.getPendingConflictSyncIntent()).toEqual(result.pendingSyncIntent);
    expect(SyncQueueManager.getDirtyCollections()).toEqual(new Set(['tasks']));
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
  });

  it('keeps dirty collections that were not represented in a state-less fetch', async () => {
    SyncQueueManager.markDirty('tasks');
    vi.mocked(IndexedDBQueue.getMutations).mockResolvedValue([{
      id: 'mutation-1',
      collection: 'tasks',
      recordId: 'task-1',
      action: 'put',
      data: { id: 'task-1' },
      timestamp: '2026-07-18T11:00:00.000Z',
    }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ tasks: [] })));

    await SyncQueueManager.sync({});

    expect(SyncQueueManager.getDirtyCollections()).toEqual(new Set(['tasks']));
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
  });

  it('does not split a rejected multi-collection payload when it contains tombstones', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    localStorage.setItem('vinea_dirty_collections', JSON.stringify(['tasks', 'lots']));
    persistDeletionTombstone('task-deleted', localStorage, 'tasks');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { error: 'Atomic deletion rejected' },
      { status: 400 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await SyncQueueManager.sync({
      tasks: [{ id: 'task-1' }],
      lots: [{ id: 'lot-1' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      tasks: [{ id: 'task-1' }],
      lots: [{ id: 'lot-1' }],
      deletedRecords: [{ collection: 'tasks', id: 'task-deleted' }],
    });
    expect(result).toEqual({ syncError: 'Atomic deletion rejected', status: 400 });
    expect(localStorage.getItem('vinea_dirty_collections')).toBe(
      JSON.stringify(['tasks', 'lots']),
    );
    expect(localStorage.getItem('vinea_deleted_ids:org-1')).toBe(
      JSON.stringify([{ collection: 'tasks', id: 'task-deleted' }]),
    );
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
  });

  it('does not split a tombstone-free compound workflow after validation rejection', async () => {
    SyncQueueManager.markDirty('lots');
    SyncQueueManager.markDirty('bottlingRuns');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { error: 'Compound bottling rejected' },
      { status: 400 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await SyncQueueManager.sync({
      lots: [{ id: 'lot-1' }],
      bottlingRuns: [{ id: 'run-1', lotId: 'lot-1' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ syncError: 'Compound bottling rejected', status: 400 });
    expect(SyncQueueManager.getDirtyCollections()).toEqual(new Set(['lots', 'bottlingRuns']));
  });

  it('preserves rejection status and code so live permission downgrades can refresh auth', async () => {
    SyncQueueManager.markDirty('tasks');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
      { code: 'role_downgraded', error: 'Task writes are no longer allowed.' },
      { status: 403 },
    )));

    const result = await SyncQueueManager.sync({ tasks: [{ id: 'task-1' }] });

    expect(result).toEqual({
      syncError: 'Task writes are no longer allowed.',
      status: 403,
      code: 'role_downgraded',
      permissionDenied: true,
    });
    expect(SyncQueueManager.getDirtyCollections()).toEqual(new Set(['tasks']));
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
  });

  it('keeps pending writes when a successful response body is unreadable', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    localStorage.setItem('vinea_dirty_collections', JSON.stringify(['tasks']));
    localStorage.setItem('cellarflow_pending_commands:org-1', JSON.stringify([{
      commandId: 'cmd-transfer-discard-0001',
      commandType: 'cellar.transfer',
      payload: {},
      capturedAt: '2026-07-20T08:00:00.000Z',
    }]));
    persistDeletionTombstone('task-deleted', localStorage, 'tasks');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const result = await SyncQueueManager.sync({ tasks: [{ id: 'task-1' }] });

    expect(result).toEqual({
      syncError: 'Sync returned an unreadable server response. Local changes were kept for retry.',
    });
    expect(localStorage.getItem('vinea_dirty_collections')).toBe(JSON.stringify(['tasks']));
    expect(localStorage.getItem('vinea_deleted_ids:org-1')).toBe(JSON.stringify([{ collection: 'tasks', id: 'task-deleted' }]));
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
  });

  it('discards queued changes and tombstones for the current organization', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    localStorage.setItem('vinea_dirty_collections', JSON.stringify(['tasks']));
    persistDeletionTombstone('task-deleted', localStorage, 'tasks');

    await SyncQueueManager.discardPendingChanges();

    expect(IndexedDBQueue.clearMutations).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('vinea_dirty_collections')).toBeNull();
    expect(localStorage.getItem('vinea_deleted_ids:org-1')).toBeNull();
    expect(localStorage.getItem('cellarflow_pending_commands:org-1')).toBeNull();
  });

  it('persists a command intent before sending and retains organization headers', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { ok: true },
      { headers: { 'X-CellarFlow-Org-State-Version': '12', 'X-CellarFlow-Org-Id': 'org-1' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const intent = {
      commandId: 'cmd-transfer-pending-0001',
      commandType: 'cellar.transfer',
      payload: { transferId: 'xfer-pending-0001' },
      capturedAt: '2026-07-20T08:00:00.000Z',
    };

    await SyncQueueManager.executeCommandRequest('/api/commands/cellar.transfer', intent);

    expect(SyncQueueManager.getPendingCommandIntents()).toEqual([intent]);
    expect(fetchMock).toHaveBeenCalledWith('/api/commands/cellar.transfer', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'X-CellarFlow-Org-Id': 'org-1',
        'X-CellarFlow-Queue-Age-Ms': expect.stringMatching(/^\d+$/),
      }),
      body: JSON.stringify({ commandId: intent.commandId, payload: intent.payload }),
    }));
    expect(localStorage.getItem('cellarflow_org_state_version')).toBe('12');

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    expect(SyncQueueManager.getPendingCommandIntents()).toEqual([]);
  });

  it('rejects a new command when the durable recovery queue is full', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    const queued = Array.from({ length: MAX_PENDING_COMMAND_INTENTS }, (_, index) => ({
      commandId: `cmd-queued-${index}`,
      commandType: 'cellar.transfer',
      payload: { transferId: `transfer-${index}` },
      capturedAt: '2026-07-20T08:00:00.000Z',
    }));
    localStorage.setItem(`${PENDING_COMMANDS_BASE_KEY}:org-1`, JSON.stringify(queued));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.transfer', {
      commandId: 'cmd-one-too-many',
      commandType: 'cellar.transfer',
      payload: { transferId: 'transfer-one-too-many' },
      capturedAt: '2026-07-20T08:01:00.000Z',
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'pending_command_queue_full', retryable: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(SyncQueueManager.getPendingCommandIntents()).toEqual(queued);
  });

  it('rejects an oversized recovery intent before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.transfer', {
      commandId: 'cmd-too-large',
      commandType: 'cellar.transfer',
      payload: { notes: 'x'.repeat(MAX_PENDING_COMMAND_INTENT_CHARS) },
      capturedAt: '2026-07-20T08:01:00.000Z',
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'pending_command_intent_too_large', retryable: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(SyncQueueManager.getPendingCommandIntents()).toEqual([]);
  });

  it('allows an idempotent command replacement when the queue is at capacity', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    const queued = Array.from({ length: MAX_PENDING_COMMAND_INTENTS }, (_, index) => ({
      commandId: `cmd-retry-${index}`,
      commandType: 'cellar.transfer',
      payload: { attempt: 1 },
      capturedAt: '2026-07-20T08:00:00.000Z',
    }));
    localStorage.setItem(`${PENDING_COMMANDS_BASE_KEY}:org-1`, JSON.stringify(queued));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const replacement = {
      ...queued[0],
      payload: { attempt: 2 },
      capturedAt: '2026-07-20T08:05:00.000Z',
    };

    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.transfer', replacement);

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(SyncQueueManager.getPendingCommandIntents()).toHaveLength(MAX_PENDING_COMMAND_INTENTS);
    expect(SyncQueueManager.getPendingCommandIntents()).toContainEqual(replacement);
  });

  it('fails closed when durable browser storage cannot save the intent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.transfer', {
      commandId: 'cmd-no-storage',
      commandType: 'cellar.transfer',
      payload: { transferId: 'transfer-no-storage' },
      capturedAt: '2026-07-20T08:01:00.000Z',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'pending_command_persistence_failed', retryable: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps command intent durable when the network fails after submission starts', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset')));
    const intent = {
      commandId: 'cmd-transfer-pending-0002',
      commandType: 'cellar.transfer',
      payload: { transferId: 'xfer-pending-0002' },
      capturedAt: '2026-07-20T08:01:00.000Z',
    };

    await expect(SyncQueueManager.executeCommandRequest('/api/commands/cellar.transfer', intent))
      .rejects.toThrow('connection reset');
    expect(SyncQueueManager.getPendingCommandIntents()).toEqual([intent]);
  });

  it('keeps every pending change when discard receives a partial 200 snapshot', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    SyncQueueManager.markDirty('tasks');
    persistDeletionTombstone('task-deleted', localStorage, 'tasks');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ tasks: [] })));

    const result = await SyncQueueManager.discardPendingChangesAndFetch((value) => (
      Boolean(value)
      && typeof value === 'object'
      && Array.isArray((value as any).tasks)
      && Array.isArray((value as any).lots)
    ));

    expect(result).toEqual({
      syncError: 'Server state was incomplete. Local changes were kept.',
    });
    expect(SyncQueueManager.getDirtyCollections()).toEqual(new Set(['tasks']));
    expect(localStorage.getItem('vinea_deleted_ids:org-1')).toBe(
      JSON.stringify([{ collection: 'tasks', id: 'task-deleted' }]),
    );
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
  });

  it('clears pending changes only after discard validates the full snapshot', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    SyncQueueManager.markDirty('tasks');
    persistDeletionTombstone('task-deleted', localStorage, 'tasks');
    const snapshot = { tasks: [], lots: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(snapshot)));

    const result = await SyncQueueManager.discardPendingChangesAndFetch((value) => (
      Boolean(value)
      && typeof value === 'object'
      && Array.isArray((value as any).tasks)
      && Array.isArray((value as any).lots)
    ));

    expect(result).toEqual(snapshot);
    expect(SyncQueueManager.getDirtyCollections().size).toBe(0);
    expect(localStorage.getItem('vinea_deleted_ids:org-1')).toBeNull();
    expect(IndexedDBQueue.clearMutations).toHaveBeenCalledOnce();
  });

  it('clears organization request metadata without touching another organization tombstone', () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');
    localStorage.setItem('cellarflow_org_state_version', '9');
    localStorage.setItem('vinea_deleted_ids:org-2', JSON.stringify(['keep-me']));
    localStorage.setItem(WORKSPACE_TRANSITION_STORAGE_KEY, JSON.stringify({
      fromOrganizationId: 'org-1',
      toOrganizationId: 'org-2',
      startedAt: '2026-07-18T12:00:00.000Z',
    }));

    SyncQueueManager.clearOrganizationContext();

    expect(localStorage.getItem('cellarflow_org_state_org_id')).toBeNull();
    expect(localStorage.getItem('cellarflow_org_state_version')).toBeNull();
    expect(localStorage.getItem('vinea_deleted_ids:org-2')).toBe(JSON.stringify(['keep-me']));
    expect(SyncQueueManager.getWorkspaceTransitionMarker()).toBeNull();
  });

  it('refuses an organization switch while dirty changes are pending', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-old');
    SyncQueueManager.markDirty('tasks');
    const switchOperation = vi.fn(async () => jsonResponse({ organizationId: 'org-new' }));

    const result = await SyncQueueManager.switchOrganizationContext(switchOperation);
    const body = await result.json();

    expect(result.status).toBe(409);
    expect(body.code).toBe(PENDING_CHANGES_SWITCH_CODE);
    expect(body.error).toContain('unsynced changes');
    expect(switchOperation).not.toHaveBeenCalled();
    expect(SyncQueueManager.getDirtyCollections()).toEqual(new Set(['tasks']));
    expect(localStorage.getItem('cellarflow_org_state_org_id')).toBe('org-old');
    expect(SyncQueueManager.getWorkspaceTransitionMarker()).toBeNull();
  });

  it('refuses an organization switch while a command result is unacknowledged', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-old');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const intent = {
      commandId: 'cmd-transfer-switch-0001',
      commandType: 'cellar.transfer',
      payload: { transferId: 'xfer-switch-0001' },
      capturedAt: '2026-07-20T08:02:00.000Z',
    };
    await expect(SyncQueueManager.executeCommandRequest('/api/commands/cellar.transfer', intent)).rejects.toThrow();
    const switchOperation = vi.fn(async () => jsonResponse({ organizationId: 'org-new' }));

    const result = await SyncQueueManager.switchOrganizationContext(switchOperation);

    expect(result.status).toBe(409);
    expect(switchOperation).not.toHaveBeenCalled();
    expect(SyncQueueManager.getPendingCommandIntents()).toEqual([intent]);
  });

  it('refuses an organization switch while deletion tombstones are pending', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-old');
    persistDeletionTombstone('old-delete', localStorage, 'tasks');
    const switchOperation = vi.fn(async () => jsonResponse({ organizationId: 'org-new' }));

    const result = await SyncQueueManager.switchOrganizationContext(switchOperation);

    expect(result.status).toBe(409);
    expect(switchOperation).not.toHaveBeenCalled();
    expect(localStorage.getItem('vinea_deleted_ids:org-old')).toBe(
      JSON.stringify([{ collection: 'tasks', id: 'old-delete' }]),
    );
  });

  it('refuses an organization switch while IndexedDB mutations are pending', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-old');
    vi.mocked(IndexedDBQueue.getMutations).mockResolvedValue([{
      id: 'mutation-1',
      collection: 'tasks',
      recordId: 'task-1',
      action: 'put',
      data: { id: 'task-1' },
      timestamp: '2026-07-18T12:00:00.000Z',
    }]);
    const switchOperation = vi.fn(async () => jsonResponse({ organizationId: 'org-new' }));

    const result = await SyncQueueManager.switchOrganizationContext(switchOperation);

    expect(result.status).toBe(409);
    expect(switchOperation).not.toHaveBeenCalled();
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
  });

  it('sets a durable transition marker after a clean organization switch succeeds', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-old');

    const result = await SyncQueueManager.switchOrganizationContext(async () => jsonResponse(
      { organizationId: 'org-new' },
      { headers: { 'X-CellarFlow-Org-Id': 'org-new' } },
    ));

    expect(result.ok).toBe(true);
    expect(localStorage.getItem('cellarflow_org_state_org_id')).toBe('org-new');
    expect(SyncQueueManager.getWorkspaceTransitionMarker()).toMatchObject({
      fromOrganizationId: 'org-old',
      toOrganizationId: 'org-new',
    });
    expect(SyncQueueManager.hasWorkspaceTransitionMarker()).toBe(true);
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
    expect(SyncQueueManager.clearWorkspaceTransitionMarker()).toBe(true);
    expect(SyncQueueManager.hasWorkspaceTransitionMarker()).toBe(false);
  });

  it('waits for an active sync before switching the server organization context', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-old');
    persistDeletionTombstone('old-delete', localStorage, 'tasks');
    let resolveSync!: (response: Response) => void;
    const pendingSyncResponse = new Promise<Response>((resolve) => { resolveSync = resolve; });
    const fetchMock = vi.fn().mockReturnValue(pendingSyncResponse);
    vi.stubGlobal('fetch', fetchMock);

    const activeSync = SyncQueueManager.sync({});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const switchOperation = vi.fn(async () => jsonResponse({
      ok: true,
      activeOrganizationId: 'org-new',
      role: 'Read-Only',
    }));
    const switchPromise = SyncQueueManager.switchOrganizationContext(switchOperation);
    await Promise.resolve();
    expect(switchOperation).not.toHaveBeenCalled();

    resolveSync(jsonResponse({ tasks: [] }, {
      headers: { 'X-CellarFlow-Org-Id': 'org-old' },
    }));
    await activeSync;
    await switchPromise;

    expect(switchOperation).toHaveBeenCalledOnce();
    expect(localStorage.getItem('cellarflow_org_state_org_id')).toBe('org-new');
    expect(localStorage.getItem('vinea_deleted_ids:org-old')).toBeNull();
  });

  it('uses the JSON organization id when the switch response has no state headers', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-old');
    localStorage.setItem('cellarflow_org_state_version', '12');

    await SyncQueueManager.switchOrganizationContext(async () => jsonResponse({
      ok: true,
      activeOrganizationId: 'org-new',
      role: 'Read-Only',
    }));

    expect(localStorage.getItem('cellarflow_org_state_org_id')).toBe('org-new');
    expect(localStorage.getItem('cellarflow_org_state_version')).toBeNull();
    expect(SyncQueueManager.getWorkspaceTransitionMarker()).toMatchObject({
      fromOrganizationId: 'org-old',
      toOrganizationId: 'org-new',
    });
  });

  it('does not set a transition marker when the server rejects a clean switch', async () => {
    localStorage.setItem('cellarflow_org_state_org_id', 'org-old');
    const switchOperation = vi.fn(async () => jsonResponse(
      { error: 'Switch rejected' },
      { status: 409 },
    ));

    const result = await SyncQueueManager.switchOrganizationContext(switchOperation);

    expect(result.ok).toBe(false);
    expect(switchOperation).toHaveBeenCalledOnce();
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
    expect(localStorage.getItem('cellarflow_org_state_org_id')).toBe('org-old');
    expect(SyncQueueManager.getWorkspaceTransitionMarker()).toBeNull();
  });
});
