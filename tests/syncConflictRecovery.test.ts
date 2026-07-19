import { describe, expect, it } from 'vitest';
import { buildResolvedSyncState } from '../lib/syncConflictRecovery';

describe('compound sync conflict recovery', () => {
  it('overlays every clean fulfillment sibling on the authoritative server snapshot', () => {
    const serverDb = {
      salesOrders: [
        { id: 'order-1', status: 'reserved', customer: 'Server edit', lastModified: 'T2' },
        { id: 'order-server-only', status: 'reserved', lastModified: 'T2' },
      ],
      salesDispatches: [{ id: 'dispatch-server-only', bottles: 5 }],
      stockMovements: [],
    };
    const attemptedPayload = {
      salesOrders: [{
        id: 'order-1',
        status: 'fulfilled',
        customer: 'Original',
        dispatchId: 'dispatch-1',
        lastModified: 'T3',
        baselineTimestamp: 'T1',
      }],
      salesDispatches: [{
        id: 'dispatch-1',
        salesOrderId: 'order-1',
        stockMovementId: 'move-1',
        bottles: 12,
      }],
      stockMovements: [{
        id: 'move-1',
        sourceRef: 'dispatch-1',
        direction: 'out',
        bottles: 12,
      }],
    };
    const conflict = {
      collection: 'salesOrders',
      recordId: 'order-1',
      local: attemptedPayload.salesOrders[0],
      server: serverDb.salesOrders[0],
    };

    const resolved = buildResolvedSyncState({
      serverDb,
      attemptedPayload,
      conflicts: [conflict],
      resolutions: { 'salesOrders-order-1': 'local' },
      resolvedAt: 'T4',
    });

    expect(resolved.salesOrders).toContainEqual(expect.objectContaining({
      id: 'order-1',
      status: 'fulfilled',
      dispatchId: 'dispatch-1',
      lastModified: 'T4',
      baselineTimestamp: 'T2',
    }));
    expect(resolved.salesOrders).toContainEqual(serverDb.salesOrders[1]);
    expect(resolved.salesDispatches).toEqual([
      serverDb.salesDispatches[0],
      attemptedPayload.salesDispatches[0],
    ]);
    expect(resolved.stockMovements).toEqual(attemptedPayload.stockMovements);
    expect(serverDb.salesDispatches).toHaveLength(1);
  });

  it('keeps the chosen server anchor without dropping clean attempted siblings', () => {
    const serverOrder = { id: 'order-1', status: 'reserved', lastModified: 'T2' };
    const resolved = buildResolvedSyncState({
      serverDb: { salesOrders: [serverOrder], salesDispatches: [], stockMovements: [] },
      attemptedPayload: {
        salesOrders: [{ id: 'order-1', status: 'fulfilled', dispatchId: 'dispatch-1', baselineTimestamp: 'T1' }],
        salesDispatches: [{ id: 'dispatch-1', salesOrderId: 'order-1' }],
        stockMovements: [{ id: 'move-1', sourceRef: 'dispatch-1' }],
      },
      conflicts: [{
        collection: 'salesOrders',
        recordId: 'order-1',
        local: { id: 'order-1', status: 'fulfilled', dispatchId: 'dispatch-1' },
        server: serverOrder,
      }],
      resolutions: { 'salesOrders-order-1': 'server' },
    });

    expect(resolved.salesOrders).toEqual([serverOrder]);
    expect(resolved.salesDispatches).toHaveLength(1);
    expect(resolved.stockMovements).toHaveLength(1);
  });

  it('normalizes client aliases and applies typed tombstones only to their collection', () => {
    const resolved = buildResolvedSyncState({
      serverDb: {
        notes: [{ id: 'shared', title: 'server' }],
        tasks: [{ id: 'shared', title: 'keep' }],
        fermlogs: [{ id: 'ferm-1', density: 1.05, lastModified: 'T2' }],
      },
      attemptedPayload: {
        notes: [],
        fermlogs: [{ id: 'ferm-1', density: 1.01, baselineTimestamp: 'T1' }],
        deletedRecords: [{ collection: 'notes', id: 'shared' }],
      },
      conflicts: [{
        collection: 'fermLogs',
        recordId: 'ferm-1',
        local: { id: 'ferm-1', density: 1.01 },
        server: { id: 'ferm-1', density: 1.05, lastModified: 'T2' },
      }],
      resolutions: { 'fermLogs-ferm-1': 'local' },
      resolvedAt: 'T3',
    });

    expect(resolved.notes).toEqual([]);
    expect(resolved.tasks).toEqual([{ id: 'shared', title: 'keep' }]);
    expect(resolved.fermlogs).toEqual([{
      id: 'ferm-1',
      density: 1.01,
      lastModified: 'T3',
      baselineTimestamp: 'T2',
    }]);
  });

  it('retains legacy wildcard deletion semantics during retry reconstruction', () => {
    const resolved = buildResolvedSyncState({
      serverDb: {
        tasks: [{ id: 'legacy-delete' }, { id: 'keep' }],
        notes: [{ id: 'legacy-delete' }],
      },
      attemptedPayload: { deletedIds: ['legacy-delete'] },
      conflicts: [],
      resolutions: {},
    });

    expect(resolved.tasks).toEqual([{ id: 'keep' }]);
    expect(resolved.notes).toEqual([]);
  });

  it('drops a conflicted deletion for a server choice and retains it for a local choice', () => {
    const input = {
      serverDb: { tasks: [{ id: 'task-1', title: 'Server', lastModified: 'T2' }] },
      attemptedPayload: {
        tasks: [{ id: 'task-1', title: 'Local', baselineTimestamp: 'T1' }],
        deletedRecords: [{ collection: 'tasks', id: 'task-1' }],
      },
      conflicts: [{
        collection: 'tasks',
        recordId: 'task-1',
        local: { id: 'task-1', title: 'Local' },
        server: { id: 'task-1', title: 'Server', lastModified: 'T2' },
      }],
      resolvedAt: 'T3',
    };

    const serverChoice = buildResolvedSyncState({
      ...input,
      resolutions: { 'tasks-task-1': 'server' as const },
    });
    const localChoice = buildResolvedSyncState({
      ...input,
      resolutions: { 'tasks-task-1': 'local' as const },
    });

    expect(serverChoice.tasks).toEqual([{ id: 'task-1', title: 'Server', lastModified: 'T2' }]);
    expect(localChoice.tasks).toEqual([]);
  });

  it('requires an explicit choice for every conflict', () => {
    expect(() => buildResolvedSyncState({
      serverDb: { tasks: [{ id: 'task-1', title: 'Server' }] },
      attemptedPayload: { tasks: [{ id: 'task-1', title: 'Local' }] },
      conflicts: [{
        collection: 'tasks',
        recordId: 'task-1',
        local: { id: 'task-1', title: 'Local' },
        server: { id: 'task-1', title: 'Server' },
      }],
      resolutions: {},
    })).toThrow(/choose a local or server version/i);
  });
});
