import { describe, expect, it } from 'vitest';
import type { InventoryItem, Vessel, WineLot } from '../lib/wineryState';
import {
  applyBottlingCommand,
  parseBottlingCommandPayload,
  type BottlingCommandPayload,
  type BottlingCommandState,
} from '../lib/commands/bottling';

function lot(overrides: Partial<WineLot> = {}): WineLot {
  return {
    id: 'LOT-A',
    name: 'Estate Saperavi',
    vintage: 2025,
    variety: 'Saperavi',
    vineyardBlock: 'Block A',
    region: 'Kakheti',
    initialVolume: 200,
    currentVolume: 200,
    wineClass: 'red',
    stage: 'aging',
    createdAt: '2025-10-01',
    history: [],
    ...overrides,
  };
}

function material(id: string, stock: number, costPerUnit: number): InventoryItem {
  return {
    id,
    name: id,
    category: 'packaging',
    stock,
    minThreshold: 0,
    unit: 'unit',
    costPerUnit,
    supplierName: 'Test Supplier',
  };
}

function vessel(overrides: Partial<Vessel> = {}): Vessel {
  return {
    id: 'TANK-A',
    type: 'stainless_steel',
    shape: 'vertical',
    capacity: 300,
    currentVolume: 200,
    assignedLotId: 'LOT-A',
    cleaningStatus: 'clean',
    lastCleaned: '2026-07-01',
    temperature: 14,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: 'Aging',
    ...overrides,
  };
}

function state(overrides: Partial<BottlingCommandState> = {}): BottlingCommandState {
  return {
    lots: [lot()],
    vessels: [vessel()],
    bottlingRuns: [],
    inventory: [
      material('BOTTLE', 500, 0.6),
      material('CORK', 500, 0.2),
      material('BOX', 100, 1.5),
    ],
    costEntries: [],
    storageLocations: [{ id: 'STORE-A', name: 'Main warehouse', type: 'warehouse', capacityBottles: 200 }],
    stockMovements: [{
      id: 'existing-stock',
      date: '2026-07-19',
      lotId: 'LOT-OLD',
      locationId: 'STORE-A',
      direction: 'in',
      bottles: 20,
    }],
    ...overrides,
  };
}

const payload: BottlingCommandPayload = {
  runId: 'bot-test-0001',
  lotId: 'LOT-A',
  sourceVesselId: 'TANK-A',
  date: '2026-07-20',
  lotNumber: 'L-2026-07',
  operator: 'Nino',
  formats: { '0.75': 100 },
  packagingSelections: { bottle: 'BOTTLE', closure: 'CORK', box: 'BOX' },
  bottlesPerBox: 6,
  bottlingServiceCost: 80,
  storageLocationId: 'STORE-A',
};

const context = {
  commandId: 'cmd-bottling-test-0001',
  actorUsername: 'nino',
  currency: 'GEL',
  performedAt: new Date('2026-07-20T09:30:00.000Z'),
};

describe('cellar.bottling domain command', () => {
  it('posts lot volume, run history, packaging, costs, and storage atomically', () => {
    const applied = applyBottlingCommand(state(), payload, context);

    expect(applied.result.receipt).toEqual({
      lotId: 'LOT-A',
      totalUnits: 100,
      volumeBottledL: 75,
      remainingLotVolumeL: 125,
      packagingCostTotal: 105.5,
      bottlingServiceCost: 80,
      storageLocationId: 'STORE-A',
    });
    expect(applied.state.lots[0]).toMatchObject({
      currentVolume: 125,
      stage: 'aging',
      history: [expect.objectContaining({ sourceRef: 'bot-test-0001', type: 'bottling' })],
    });
    expect(applied.state.vessels[0]).toMatchObject({
      id: 'TANK-A',
      currentVolume: 125,
      assignedLotId: 'LOT-A',
      lastCommandId: 'cmd-bottling-test-0001',
    });
    expect(applied.state.bottlingRuns[0]).toMatchObject({
      id: 'bot-test-0001',
      commandId: 'cmd-bottling-test-0001',
      packagingDeductions: { BOTTLE: 100, CORK: 100, BOX: 17 },
      storageMovementId: 'mov-bottling-bot-test-0001',
    });
    expect(applied.state.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'BOTTLE', stock: 400 }),
      expect.objectContaining({ id: 'CORK', stock: 400 }),
      expect.objectContaining({ id: 'BOX', stock: 83 }),
    ]));
    expect(applied.state.costEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cost-packaging-bot-test-0001', amount: 105.5, currency: 'GEL' }),
      expect.objectContaining({ id: 'cost-bottling-bot-test-0001', amount: 80, currency: 'GEL' }),
    ]));
    expect(applied.state.stockMovements[0]).toMatchObject({
      id: 'mov-bottling-bot-test-0001',
      direction: 'in',
      bottles: 100,
      sourceRef: 'bot-test-0001',
    });
  });

  it('keeps a residual physical balance active instead of silently treating it as bottled', () => {
    const applied = applyBottlingCommand(state({
      lots: [lot({ currentVolume: 75.4 })],
      vessels: [vessel({ currentVolume: 75.4 })],
    }), {
      ...payload,
      packagingSelections: {},
      bottlingServiceCost: 0,
      storageLocationId: '',
    }, context);

    expect(applied.result.updatedLot).toMatchObject({ currentVolume: 0.4, stage: 'aging' });
    expect(applied.result.updatedVessel).toMatchObject({ currentVolume: 0.4, assignedLotId: 'LOT-A' });
    expect(applied.state.inventory).toEqual(state().inventory);
    expect(applied.state.costEntries).toEqual([]);
    expect(applied.result.storageMovement).toBeUndefined();
  });

  it('empties and releases the source vessel only when the physical balance reaches zero', () => {
    const applied = applyBottlingCommand(state({
      lots: [lot({ currentVolume: 75 })],
      vessels: [vessel({ currentVolume: 75 })],
    }), { ...payload, packagingSelections: {}, bottlingServiceCost: 0, storageLocationId: '' }, context);

    expect(applied.result.updatedLot).toMatchObject({ currentVolume: 0, stage: 'bottled' });
    expect(applied.result.updatedVessel).toMatchObject({
      currentVolume: 0,
      assignedLotId: null,
      cleaningStatus: 'cleaning_needed',
    });
  });

  it('rejects lot volume and packaging double-spends before returning any state', () => {
    expect(() => applyBottlingCommand(state({ lots: [lot({ currentVolume: 50 })] }), payload, context))
      .toThrowError(expect.objectContaining({ code: 'insufficient_lot_volume', statusCode: 409 }));
    expect(() => applyBottlingCommand(state({ vessels: [vessel({ currentVolume: 50 })] }), payload, context))
      .toThrowError(expect.objectContaining({ code: 'insufficient_vessel_volume', statusCode: 409 }));
    expect(() => applyBottlingCommand(state({
      inventory: [material('BOTTLE', 99, 0.6), material('CORK', 500, 0.2), material('BOX', 100, 1.5)],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'insufficient_packaging_stock', statusCode: 409 }));
  });

  it('rejects a product selected for the wrong packaging component', () => {
    expect(() => applyBottlingCommand(state({
      inventory: [
        { ...material('BOTTLE', 500, 0.6), category: 'bottles' },
        { ...material('CORK', 500, 0.2), category: 'additives', name: 'Bentonite' },
        { ...material('BOX', 100, 1.5), category: 'boxes' },
      ],
    }), payload, context)).toThrowError(expect.objectContaining({
      code: 'packaging_category_mismatch',
      statusCode: 409,
    }));
  });

  it('enforces finished-goods warehouse capacity', () => {
    expect(() => applyBottlingCommand(state({
      storageLocations: [{ id: 'STORE-A', name: 'Small warehouse', type: 'warehouse', capacityBottles: 119 }],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'storage_capacity_exceeded', statusCode: 409 }));
  });

  it('rejects missing references and every deterministic record-id collision', () => {
    expect(() => applyBottlingCommand(state(), {
      ...payload,
      packagingSelections: { bottle: 'MISSING' },
    }, context)).toThrowError(expect.objectContaining({ code: 'packaging_material_not_found' }));
    expect(() => applyBottlingCommand(state({
      bottlingRuns: [{
        id: payload.runId,
        lotId: 'LOT-A',
        lotName: 'Existing',
        date: '2026-07-19',
        lotNumber: '',
        operator: 'Existing',
        formats: { '0.75': 1 },
        totalBottles: 1,
        totalCeramic: 0,
        volumeBottledL: 0.75,
      }],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'bottling_run_id_conflict' }));
    expect(() => applyBottlingCommand(state({
      costEntries: [{
        id: 'cost-packaging-bot-test-0001',
        date: '2026-07-19',
        lotId: 'LOT-A',
        category: 'packaging',
        description: 'Collision',
        amount: 1,
        currency: 'GEL',
      }],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'cost_entry_id_conflict' }));
  });

  it('validates supported whole-unit formats and calendar dates at the boundary', () => {
    expect(() => parseBottlingCommandPayload({ ...payload, formats: { gallon: 1 } }))
      .toThrowError(expect.objectContaining({ code: 'invalid_bottling_payload', statusCode: 400 }));
    expect(() => parseBottlingCommandPayload({ ...payload, formats: { '0.75': 1.5 } }))
      .toThrowError(expect.objectContaining({ code: 'invalid_bottling_payload' }));
    expect(parseBottlingCommandPayload({ ...payload, formats: { '0.33': 100 } }).formats)
      .toEqual({ '0.33': 100 });
    expect(() => parseBottlingCommandPayload({ ...payload, date: '2026-02-30' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_bottling_payload' }));
  });
});
