import { describe, expect, it } from 'vitest';
import {
  applyCellarOperationCommand,
  parseCellarOperationCommandPayload,
  type CellarOperationCommandPayload,
  type CellarOperationCommandState,
} from '../lib/commands/cellarOperation';
import type { InventoryItem, Vessel, WineLot } from '../lib/wineryState';

function lot(overrides: Partial<WineLot> = {}): WineLot {
  return {
    id: 'LOT-CELLAR-1', name: 'Saperavi Reserve', vintage: 2026, variety: 'Saperavi',
    vineyardBlock: 'Block A', region: 'Kakheti', initialVolume: 1_000, currentVolume: 920,
    wineClass: 'red', stage: 'aging', createdAt: '2026-09-01', history: [],
    ...overrides,
  };
}

function vessel(overrides: Partial<Vessel> = {}): Vessel {
  return {
    id: 'TANK-CELLAR-1', type: 'stainless_steel', shape: 'vertical', capacity: 1_200,
    currentVolume: 920, assignedLotId: 'LOT-CELLAR-1', cleaningStatus: 'clean',
    lastCleaned: '2026-09-01', temperature: 16, coolingJacketActive: false,
    targetTemperature: null, lastOperation: 'Filled',
    ...overrides,
  };
}

function material(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'INV-SO2', name: 'Potassium metabisulfite', category: 'additives', stock: 5,
    minThreshold: 1, unit: 'kg', costPerUnit: 20, supplierName: 'QA Enology',
    ...overrides,
  };
}

function state(overrides: Partial<CellarOperationCommandState> = {}): CellarOperationCommandState {
  return {
    lots: [lot()],
    vessels: [vessel(), vessel({ id: 'TANK-CELLAR-2', currentVolume: 0, assignedLotId: null })],
    inventory: [material()],
    cellarOps: [],
    costEntries: [],
    auditLogs: [],
    ...overrides,
  };
}

const payload: CellarOperationCommandPayload = {
  operationId: 'OP-CELLAR-1',
  auditId: 'AUDIT-CELLAR-1',
  operation: {
    date: '2026-09-10',
    type: 'sulfitation',
    lotId: 'LOT-CELLAR-1',
    vesselId: 'TANK-CELLAR-1',
    vesselToId: null,
    materialId: 'INV-SO2',
    dose: 0.2,
    operator: 'Nino Winemaker',
    notes: 'Post-fermentation protection.',
  },
};

const context = {
  commandId: 'cmd-cellar-operation-test-0001',
  actorUsername: 'nino',
  currency: 'USD',
  performedAt: new Date('2026-09-10T11:15:00.000Z'),
};

describe('cellar.operation domain command', () => {
  it('commits lot, vessel, material, operation, cost, and signed audit as one result', () => {
    const applied = applyCellarOperationCommand(state(), payload, context);

    expect(applied.result.receipt).toEqual({
      operationId: payload.operationId,
      lotId: payload.operation.lotId,
      vesselId: 'TANK-CELLAR-1',
      materialId: 'INV-SO2',
      materialDeducted: 0.2,
      costPosted: 4,
      volumeBeforeL: 920,
    });
    expect(applied.result.operation).toMatchObject({
      id: payload.operationId,
      commandId: context.commandId,
      recordKind: 'operation',
      lotName: 'Saperavi Reserve',
      materialName: 'Potassium metabisulfite',
      unit: 'kg',
      reversalSnapshot: {
        version: 1,
        lot: { id: 'LOT-CELLAR-1', currentVolume: 920, stage: 'aging' },
        vessel: { id: 'TANK-CELLAR-1', currentVolume: 920, lastOperation: 'Filled' },
        inventory: { id: 'INV-SO2', stock: 5 },
        costEntry: { id: 'cost-material-OP-CELLAR-1-INV-SO2', amount: 4, currency: 'USD' },
        auditId: 'AUDIT-CELLAR-1',
      },
    });
    expect(applied.result.lot.history[0]).toMatchObject({
      type: 'Sulfitation (SO₂)',
      sourceRef: payload.operationId,
      operator: payload.operation.operator,
    });
    expect(applied.result.lot.lastCommandId).toBe(context.commandId);
    expect(applied.result.vessel).toMatchObject({
      currentVolume: 920,
      lastCommandId: context.commandId,
      lastOperation: expect.stringContaining('Potassium metabisulfite 0.2kg'),
    });
    expect(applied.result.inventoryItem).toMatchObject({
      id: 'INV-SO2', stock: 4.8, lastCommandId: context.commandId,
    });
    expect(applied.result.costEntry).toMatchObject({
      id: 'cost-material-OP-CELLAR-1-INV-SO2',
      commandId: context.commandId,
      recordKind: 'cost',
      amount: 4,
      currency: 'USD',
      quantity: 0.2,
      unitCost: 20,
    });
    expect(applied.result.auditLog).toMatchObject({
      id: payload.auditId,
      commandId: context.commandId,
      actionType: 'Cellar Operation: Sulfitation (SO₂)',
      chainSequence: 1,
      previousHash: 'GENESIS',
      hashAlgorithm: 'SHA-256',
    });
    expect(applied.result.auditLog.chainHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('supports a core operation without optional vessel, material, or cost effects', () => {
    const applied = applyCellarOperationCommand(state(), {
      operationId: 'OP-MEASURE-1',
      auditId: 'AUDIT-MEASURE-1',
      operation: {
        date: '2026-09-10', type: 'measurement', lotId: 'LOT-CELLAR-1',
        vesselId: null, vesselToId: null, operator: 'Nino', notes: 'Temperature checked.',
      },
    }, context);

    expect(applied.result.vessel).toBeUndefined();
    expect(applied.result.inventoryItem).toBeUndefined();
    expect(applied.result.costEntry).toBeUndefined();
    expect(applied.state.vessels).toEqual(state().vessels);
    expect(applied.state.inventory).toEqual(state().inventory);
    expect(applied.state.costEntries).toEqual([]);
    expect(applied.state.cellarOps).toHaveLength(1);
    expect(applied.state.auditLogs).toHaveLength(1);
  });

  it('deducts several additions from one operation and posts one linked cost per material', () => {
    const multiState = state({
      inventory: [
        material({ id: 'INV-YEAST', name: 'EC-1118 yeast', category: 'yeasts', stock: 2, unit: 'kg', costPerUnit: 50 }),
        material({ id: 'INV-STARTER', name: 'Go-Ferm starter', category: 'nutritions', stock: 4, unit: 'kg', costPerUnit: 30 }),
      ],
    });
    const applied = applyCellarOperationCommand(multiState, {
      operationId: 'OP-FERMENT-START-1',
      auditId: 'AUDIT-FERMENT-START-1',
      operation: {
        date: '2026-09-10',
        type: 'ferment_start',
        lotId: 'LOT-CELLAR-1',
        vesselId: 'TANK-CELLAR-1',
        vesselToId: null,
        materials: [
          { materialId: 'INV-YEAST', quantity: 0.25, purpose: 'yeast' },
          { materialId: 'INV-STARTER', quantity: 0.4, purpose: 'starter' },
        ],
        operator: 'Nino Winemaker',
        notes: 'Inoculation.',
      },
    }, context);

    expect(applied.result.inventoryItems).toEqual([
      expect.objectContaining({ id: 'INV-YEAST', stock: 1.75 }),
      expect.objectContaining({ id: 'INV-STARTER', stock: 3.6 }),
    ]);
    expect(applied.result.costEntries).toEqual([
      expect.objectContaining({ amount: 12.5, quantity: 0.25 }),
      expect.objectContaining({ amount: 12, quantity: 0.4 }),
    ]);
    expect(applied.result.operation.materials).toEqual([
      expect.objectContaining({ materialName: 'EC-1118 yeast', quantity: 0.25, unit: 'kg', purpose: 'yeast' }),
      expect.objectContaining({ materialName: 'Go-Ferm starter', quantity: 0.4, unit: 'kg', purpose: 'starter' }),
    ]);
    expect(applied.result.operation.reversalSnapshot).toMatchObject({
      version: 2,
      inventory: [
        { id: 'INV-YEAST', stock: 2 },
        { id: 'INV-STARTER', stock: 4 },
      ],
    });
    expect(applied.result.receipt.materialDeductions).toEqual([
      { materialId: 'INV-YEAST', materialName: 'EC-1118 yeast', quantity: 0.25, unit: 'kg' },
      { materialId: 'INV-STARTER', materialName: 'Go-Ferm starter', quantity: 0.4, unit: 'kg' },
    ]);
  });

  it('rejects material over-consumption instead of clamping stock', () => {
    expect(() => applyCellarOperationCommand(state(), {
      ...payload,
      operation: { ...payload.operation, dose: 5.001 },
    }, context)).toThrowError(expect.objectContaining({
      code: 'insufficient_operation_material', statusCode: 409,
    }));
  });

  it('requires the operating vessel and lot to agree before changing their state', () => {
    expect(() => applyCellarOperationCommand(state({
      vessels: [vessel({ assignedLotId: 'LOT-OTHER' })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'cellar_operation_vessel_mismatch' }));

    expect(() => applyCellarOperationCommand(state({
      vessels: [vessel({ currentVolume: 900 })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'cellar_operation_volume_inconsistent' }));
  });

  it('validates volume changes against operation semantics and vessel capacity', () => {
    const pressing = {
      ...payload,
      operationId: 'OP-PRESS-1',
      auditId: 'AUDIT-PRESS-1',
      operation: {
        ...payload.operation,
        type: 'pressing' as const,
        materialId: undefined,
        dose: undefined,
        volumeAfterL: 921,
      },
    };
    expect(() => applyCellarOperationCommand(state(), pressing, context))
      .toThrowError(expect.objectContaining({ code: 'cellar_operation_volume_inconsistent' }));

    const blend = {
      ...pressing,
      operation: { ...pressing.operation, type: 'blending' as const, volumeAfterL: 1_201 },
    };
    expect(() => applyCellarOperationCommand(state(), blend, context))
      .toThrowError(expect.objectContaining({ code: 'cellar_operation_vessel_capacity_exceeded' }));
  });

  it('validates dates, type-specific fields, generated ids, and derived-cost collisions', () => {
    expect(() => parseCellarOperationCommandPayload({
      ...payload,
      operation: { ...payload.operation, date: '2026-02-30' },
    })).toThrowError(expect.objectContaining({ code: 'invalid_cellar_operation_payload', statusCode: 400 }));
    expect(parseCellarOperationCommandPayload({
      ...payload,
      operation: { ...payload.operation, type: 'measurement', materialId: 'INV-SO2', dose: 0.2 },
    }).operation.type).toBe('measurement');
    expect(() => parseCellarOperationCommandPayload({
      ...payload,
      operation: {
        ...payload.operation,
        materials: [{ materialId: 'INV-SO2', quantity: 0.2 }],
      },
    })).toThrowError(expect.objectContaining({ code: 'invalid_cellar_operation_payload' }));
    expect(() => parseCellarOperationCommandPayload({ ...payload, operationId: '../bad' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_cellar_operation_payload' }));
    expect(() => applyCellarOperationCommand(state({
      costEntries: [{ id: 'cost-material-OP-CELLAR-1-INV-SO2' } as any],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'cellar_operation_cost_id_conflict' }));
  });
});
