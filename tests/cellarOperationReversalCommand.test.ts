import { describe, expect, it } from 'vitest';
import {
  applyCellarOperationCommand,
  type CellarOperationCommandState,
} from '../lib/commands/cellarOperation';
import {
  applyCellarOperationReversalCommand,
  parseCellarOperationReversalCommandPayload,
} from '../lib/commands/cellarOperationReversal';
import type { InventoryItem, Vessel, WineLot } from '../lib/wineryState';

function lot(): WineLot {
  return {
    id: 'LOT-OP-REV', name: 'Reversible Saperavi', vintage: 2026, variety: 'Saperavi',
    vineyardBlock: 'A', region: 'Kakheti', initialVolume: 1_000, currentVolume: 920,
    wineClass: 'red', stage: 'aging', createdAt: '2026-09-01', history: [],
  };
}

function vessel(): Vessel {
  return {
    id: 'TANK-OP-REV', type: 'stainless_steel', shape: 'vertical', capacity: 1_200,
    currentVolume: 920, assignedLotId: 'LOT-OP-REV', cleaningStatus: 'clean',
    lastCleaned: '2026-09-01', temperature: 16, coolingJacketActive: false,
    targetTemperature: null, lastOperation: 'Filled before treatment',
  };
}

function material(): InventoryItem {
  return {
    id: 'INV-OP-REV', name: 'Bentonite', category: 'additives', stock: 12,
    minThreshold: 2, unit: 'kg', costPerUnit: 8, supplierName: 'Enology QA',
  };
}

function postedState(): CellarOperationCommandState {
  return applyCellarOperationCommand({
    lots: [lot()], vessels: [vessel()], inventory: [material()],
    cellarOps: [], costEntries: [], auditLogs: [],
  }, {
    operationId: 'OP-ORIGINAL',
    auditId: 'AUDIT-ORIGINAL',
    operation: {
      date: '2026-09-10', type: 'fining', lotId: 'LOT-OP-REV',
      vesselId: 'TANK-OP-REV', vesselToId: null,
      materialId: 'INV-OP-REV', dose: 1.5,
      operator: 'Nino', notes: 'Bench trial confirmed.',
    },
  }, {
    commandId: 'cmd-operation-original',
    actorUsername: 'nino', currency: 'GEL',
    performedAt: new Date('2026-09-10T10:00:00.000Z'),
  }).state;
}

const payload = {
  reversalOperationId: 'OP-REVERSAL',
  auditId: 'AUDIT-REVERSAL',
  costReversalId: 'COST-REVERSAL',
  originalCommandId: 'cmd-operation-original',
  reason: 'Wrong lot was selected.',
};

const context = {
  commandId: 'cmd-operation-reversal',
  actorUsername: 'owner',
  performedAt: new Date('2026-09-11T09:00:00.000Z'),
};

describe('cellar.operation.reverse domain command', () => {
  it('restores exact business state and appends cost and signed audit compensation', () => {
    const applied = applyCellarOperationReversalCommand(postedState(), payload, context);

    expect(applied.result.updatedLot).toMatchObject({
      currentVolume: 920, stage: 'aging', lastCommandId: context.commandId,
    });
    expect(applied.result.updatedLot.history[0]).toMatchObject({
      type: 'correction', sourceRef: 'OP-REVERSAL',
    });
    expect(applied.result.updatedVessel).toMatchObject({
      currentVolume: 920, lastOperation: 'Filled before treatment', lastCommandId: context.commandId,
    });
    expect(applied.result.updatedInventoryItem).toMatchObject({
      stock: 12, lastCommandId: context.commandId,
    });
    expect(applied.result.originalOperation).toMatchObject({
      id: 'OP-ORIGINAL', reversedByCommandId: context.commandId,
      reversalReason: payload.reason,
    });
    expect(applied.result.reversalOperation).toMatchObject({
      id: 'OP-REVERSAL', commandId: context.commandId, recordKind: 'reversal',
      reversalOfOperationId: 'OP-ORIGINAL', reversalOfCommandId: 'cmd-operation-original',
      volumeBeforeL: 920, volumeAfterL: 920, materialId: 'INV-OP-REV', dose: 1.5,
    });
    expect(applied.result.updatedOriginalCostEntry).toMatchObject({
      id: 'cost-material-OP-ORIGINAL-INV-OP-REV', reversedByCommandId: context.commandId,
    });
    expect(applied.result.reversalCostEntry).toMatchObject({
      id: 'COST-REVERSAL', recordKind: 'reversal', amount: -12, quantity: -1.5,
      sourceRef: 'OP-REVERSAL', reversalOfCommandId: 'cmd-operation-original',
    });
    expect(applied.result.auditLog).toMatchObject({
      id: 'AUDIT-REVERSAL', commandId: context.commandId, chainSequence: 2,
      previousHash: postedState().auditLogs[0].chainHash,
    });
    expect(applied.result.receipt).toMatchObject({
      kind: 'cellar_operation_reversal', restoredVolumeL: 920,
      restoredMaterialQuantity: 1.5, reversedCostAmount: 12,
    });
  });

  it('supports a core operation with no vessel, material, or cost side effects', () => {
    const posted = applyCellarOperationCommand({
      lots: [lot()], vessels: [vessel()], inventory: [material()],
      cellarOps: [], costEntries: [], auditLogs: [],
    }, {
      operationId: 'OP-MEASURE', auditId: 'AUDIT-MEASURE',
      operation: {
        date: '2026-09-10', type: 'measurement', lotId: 'LOT-OP-REV',
        vesselId: null, vesselToId: null, operator: 'Nino', notes: 'Wrong entry.',
      },
    }, {
      commandId: 'cmd-operation-measure', actorUsername: 'nino', currency: 'GEL',
      performedAt: new Date('2026-09-10T10:00:00.000Z'),
    }).state;
    const applied = applyCellarOperationReversalCommand(posted, {
      ...payload, originalCommandId: 'cmd-operation-measure',
    }, context);

    expect(applied.result.updatedVessel).toBeUndefined();
    expect(applied.result.updatedInventoryItem).toBeUndefined();
    expect(applied.result.reversalCostEntry).toBeUndefined();
    expect(applied.state.vessels).toEqual(posted.vessels);
    expect(applied.state.inventory).toEqual(posted.inventory);
  });

  it('restores lot and vessel volume after a loss operation', () => {
    const posted = applyCellarOperationCommand({
      lots: [lot()], vessels: [vessel()], inventory: [material()],
      cellarOps: [], costEntries: [], auditLogs: [],
    }, {
      operationId: 'OP-FILTER', auditId: 'AUDIT-FILTER',
      operation: {
        date: '2026-09-10', type: 'filtration', lotId: 'LOT-OP-REV',
        vesselId: 'TANK-OP-REV', vesselToId: null, volumeAfterL: 900,
        operator: 'Nino', notes: 'Filter loss.',
      },
    }, {
      commandId: 'cmd-operation-filter', actorUsername: 'nino', currency: 'GEL',
      performedAt: new Date('2026-09-10T10:00:00.000Z'),
    }).state;
    const applied = applyCellarOperationReversalCommand(posted, {
      ...payload, originalCommandId: 'cmd-operation-filter',
    }, context);

    expect(applied.result.updatedLot.currentVolume).toBe(920);
    expect(applied.result.updatedVessel?.currentVolume).toBe(920);
    expect(applied.result.reversalOperation).toMatchObject({
      volumeBeforeL: 900, volumeAfterL: 920,
    });
    expect(applied.result.reversalCostEntry).toBeUndefined();
  });

  it('blocks compensation after a dependent lot change', () => {
    const posted = postedState();
    posted.lots[0] = { ...posted.lots[0], currentVolume: 899, lastCommandId: 'cmd-later' };

    expect(() => applyCellarOperationReversalCommand(posted, payload, context))
      .toThrowError(expect.objectContaining({
        code: 'cellar_operation_reversal_dependency_conflict', statusCode: 409,
      }));
  });

  it('blocks a second compensation and legacy records without restoration metadata', () => {
    const first = applyCellarOperationReversalCommand(postedState(), payload, context);
    expect(() => applyCellarOperationReversalCommand(first.state, {
      ...payload, reversalOperationId: 'OP-REVERSAL-2', auditId: 'AUDIT-REVERSAL-2',
      costReversalId: 'COST-REVERSAL-2',
    }, { ...context, commandId: 'cmd-operation-reversal-2' }))
      .toThrowError(expect.objectContaining({ code: 'cellar_operation_already_reversed' }));

    const legacy = postedState();
    legacy.cellarOps[0] = { ...legacy.cellarOps[0], reversalSnapshot: undefined };
    expect(() => applyCellarOperationReversalCommand(legacy, payload, context))
      .toThrowError(expect.objectContaining({ code: 'cellar_operation_reversal_snapshot_missing' }));
  });

  it('validates ids and requires a bounded correction reason', () => {
    expect(() => parseCellarOperationReversalCommandPayload({ ...payload, reason: '' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_cellar_operation_reversal_payload' }));
    expect(() => parseCellarOperationReversalCommandPayload({ ...payload, auditId: '../bad' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_cellar_operation_reversal_payload' }));
  });
});
