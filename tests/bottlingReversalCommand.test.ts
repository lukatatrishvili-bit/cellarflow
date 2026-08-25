import { describe, expect, it } from 'vitest';
import { applyBottlingCommand, type BottlingCommandState } from '../lib/commands/bottling';
import {
  applyBottlingReversalCommand,
  BottlingReversalCommandError,
  parseBottlingReversalCommandPayload,
} from '../lib/commands/bottlingReversal';

const performedAt = new Date('2026-07-20T08:00:00.000Z');
const reversedAt = new Date('2026-07-21T09:00:00.000Z');

function baseState(): BottlingCommandState {
  return {
    lots: [{
      id: 'LOT-A',
      name: 'Saperavi 2025',
      vintage: 2025,
      variety: 'Saperavi',
      vineyardBlock: 'B-1',
      region: 'Kakheti',
      initialVolume: 200,
      currentVolume: 200,
      wineClass: 'red',
      stage: 'aging',
      createdAt: '2025-10-01',
      history: [],
    }],
    vessels: [{
      id: 'TANK-A', type: 'stainless_steel', shape: 'vertical', capacity: 300,
      currentVolume: 200, assignedLotId: 'LOT-A', cleaningStatus: 'clean',
      lastCleaned: '2026-07-01', temperature: 14, coolingJacketActive: false,
      targetTemperature: null, lastOperation: 'Aging',
    }],
    bottlingRuns: [],
    inventory: [{
      id: 'BOTTLE-1',
      name: '750 ml bottle',
      category: 'bottles',
      stock: 150,
      minThreshold: 20,
      unit: 'pcs',
      costPerUnit: 1.2,
      supplierName: 'Glass Co',
    }],
    costEntries: [],
    storageLocations: [{ id: 'WH-1', name: 'Main warehouse', type: 'warehouse', capacityBottles: 500 }],
    stockMovements: [],
  };
}

function postedState(options: { storage?: boolean; costing?: boolean } = {}) {
  const state = baseState();
  const applied = applyBottlingCommand(state, {
    runId: 'BOT-1',
    lotId: 'LOT-A',
    sourceVesselId: 'TANK-A',
    date: '2026-07-20',
    lotNumber: 'B-2026-01',
    operator: 'Nino',
    formats: { '0.75': 100 },
    packagingSelections: options.costing === false ? {} : { bottle: 'BOTTLE-1' },
    bottlesPerBox: 6,
    bottlingServiceCost: options.costing === false ? 0 : 25,
    storageLocationId: options.storage === false ? '' : 'WH-1',
  }, {
    commandId: 'cmd-bottling-1',
    actorUsername: 'nino',
    currency: 'GEL',
    performedAt,
  });
  return {
    ...applied.state,
    salesOrders: [],
    salesDispatches: [],
    certificationRecords: [],
  };
}

const payload = {
  reversalRunId: 'BOT-REV-1',
  storageReturnMovementId: 'MOV-BOT-REV-1',
  packagingCostReversalId: 'COST-PACK-REV-1',
  serviceCostReversalId: 'COST-SERVICE-REV-1',
  originalCommandId: 'cmd-bottling-1',
  reason: 'Duplicate production posting',
};

describe('bottling reversal command', () => {
  it('appends a full compensation while preserving the original run', () => {
    const applied = applyBottlingReversalCommand(postedState(), payload, {
      commandId: 'cmd-bottling-reversal-1',
      actorUsername: 'owner',
      performedAt: reversedAt,
    });

    expect(applied.state.lots[0]).toMatchObject({
      currentVolume: 200,
      stage: 'aging',
      lastCommandId: 'cmd-bottling-reversal-1',
      lastModified: reversedAt.toISOString(),
    });
    expect(applied.state.lots[0].history[0]).toMatchObject({
      type: 'correction',
      sourceRef: 'BOT-REV-1',
    });
    expect(applied.state.vessels[0]).toMatchObject({
      currentVolume: 200,
      assignedLotId: 'LOT-A',
      cleaningStatus: 'clean',
      lastOperation: 'Aging',
      lastCommandId: 'cmd-bottling-reversal-1',
    });
    expect(applied.state.inventory[0]).toMatchObject({
      stock: 150,
      lastCommandId: 'cmd-bottling-reversal-1',
    });
    expect(applied.state.bottlingRuns).toHaveLength(2);
    expect(applied.result.originalRun).toMatchObject({
      id: 'BOT-1',
      reversedByCommandId: 'cmd-bottling-reversal-1',
      reversalReason: payload.reason,
    });
    expect(applied.result.reversalRun).toMatchObject({
      id: 'BOT-REV-1',
      recordKind: 'reversal',
      reversalOfRunId: 'BOT-1',
      reversalOfCommandId: 'cmd-bottling-1',
    });
    expect(applied.result.storageReturnMovement).toMatchObject({
      id: 'MOV-BOT-REV-1',
      direction: 'out',
      bottles: 100,
      reason: 'bottling_reversal',
      reversalOfMovementId: 'mov-bottling-BOT-1',
    });
    expect(applied.state.costEntries.map(entry => entry.amount)).toEqual([-120, -25, 120, 25]);
    expect(applied.result.updatedOriginalCostEntries).toHaveLength(2);
    expect(applied.result.receipt).toMatchObject({
      kind: 'bottling_reversal',
      restoredVolumeL: 75,
      restoredPackagingUnits: 100,
      reversedCostAmount: 145,
    });
  });

  it('supports runs without costing or an automatic storage receipt', () => {
    const applied = applyBottlingReversalCommand(postedState({ storage: false, costing: false }), payload, {
      commandId: 'cmd-bottling-reversal-1',
      actorUsername: 'owner',
      performedAt: reversedAt,
    });

    expect(applied.result.storageReturnMovement).toBeUndefined();
    expect(applied.result.reversalCostEntries).toEqual([]);
    expect(applied.state.stockMovements).toEqual([]);
    expect(applied.state.inventory[0].stock).toBe(150);
  });

  it('blocks a second reversal and any later dependent mutation', () => {
    const first = applyBottlingReversalCommand(postedState(), payload, {
      commandId: 'cmd-bottling-reversal-1',
      actorUsername: 'owner',
      performedAt: reversedAt,
    });
    expect(() => applyBottlingReversalCommand(first.state, {
      ...payload,
      reversalRunId: 'BOT-REV-2',
      storageReturnMovementId: 'MOV-BOT-REV-2',
      packagingCostReversalId: 'COST-PACK-REV-2',
      serviceCostReversalId: 'COST-SERVICE-REV-2',
    }, {
      commandId: 'cmd-bottling-reversal-2',
      actorUsername: 'owner',
      performedAt: new Date('2026-07-22T09:00:00.000Z'),
    })).toThrowError(expect.objectContaining({ code: 'bottling_run_already_reversed' }));

    const changed = postedState();
    changed.inventory[0] = { ...changed.inventory[0], stock: 49, lastModified: '2026-07-20T10:00:00.000Z' };
    expect(() => applyBottlingReversalCommand(changed, payload, {
      commandId: 'cmd-bottling-reversal-1',
      actorUsername: 'owner',
      performedAt: reversedAt,
    })).toThrowError(expect.objectContaining({ code: 'bottling_reversal_dependency_conflict' }));
  });

  it('blocks certifications, reservations, and later warehouse work', () => {
    const certified = postedState();
    certified.certificationRecords = [{
      id: 'CERT-1', lotId: 'LOT-A', bottlingRunId: 'BOT-1', productType: 'wine',
      samplePrepared: true, labProtocolUploaded: true, applicationStatus: 'submitted',
    }];
    expect(() => applyBottlingReversalCommand(certified, payload, {
      commandId: 'cmd-bottling-reversal-1', actorUsername: 'owner', performedAt: reversedAt,
    })).toThrowError(expect.objectContaining({ code: 'bottling_reversal_dependency_conflict' }));

    const reserved = postedState();
    reserved.salesOrders = [{
      id: 'SO-1', orderDate: '2026-07-21', createdAt: '2026-07-21T00:00:00.000Z',
      customerName: 'Buyer', lotId: 'LOT-A', lotName: 'Saperavi 2025', locationId: 'WH-1',
      locationName: 'Main warehouse', bottles: 10, pricePerBottle: 20, currency: 'GEL', revenue: 200,
      status: 'reserved', operator: 'owner',
    }];
    expect(() => applyBottlingReversalCommand(reserved, payload, {
      commandId: 'cmd-bottling-reversal-1', actorUsername: 'owner', performedAt: reversedAt,
    })).toThrowError(expect.objectContaining({ code: 'bottling_reversal_dependency_conflict' }));

    const moved = postedState();
    moved.stockMovements.unshift({
      id: 'MOV-LATER', commandId: 'cmd-move', lastModified: '2026-07-20T09:00:00.000Z',
      date: '2026-07-20', lotId: 'LOT-A', locationId: 'WH-1', direction: 'out', bottles: 1,
      reason: 'adjustment',
    });
    expect(() => applyBottlingReversalCommand(moved, payload, {
      commandId: 'cmd-bottling-reversal-1', actorUsername: 'owner', performedAt: reversedAt,
    })).toThrowError(expect.objectContaining({ code: 'bottling_reversal_dependency_conflict' }));
  });

  it('rejects legacy runs and validates payloads', () => {
    const legacy = postedState();
    legacy.bottlingRuns[0] = { ...legacy.bottlingRuns[0], commandId: undefined };
    expect(() => applyBottlingReversalCommand(legacy, { ...payload, originalCommandId: 'BOT-1' }, {
      commandId: 'cmd-bottling-reversal-1', actorUsername: 'owner', performedAt: reversedAt,
    })).toThrowError(expect.objectContaining({ code: 'bottling_run_not_command_created' }));

    expect(() => parseBottlingReversalCommandPayload({ ...payload, reason: '' }))
      .toThrow(BottlingReversalCommandError);
  });
});
