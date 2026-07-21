import { describe, expect, it } from 'vitest';
import type { WineLot } from '../lib/wineryState';
import { computeStock, unstored } from '../lib/storage';
import {
  applyStorageMovementCommand,
  parseStorageMovementCommandPayload,
  type StorageMovementCommandState,
} from '../lib/commands/storageMovement';

function lot(overrides: Partial<WineLot> = {}): WineLot {
  return {
    id: 'LOT-A',
    name: 'Estate Saperavi',
    vintage: 2026,
    variety: 'Saperavi',
    vineyardBlock: 'Block A',
    region: 'Kakheti',
    initialVolume: 75,
    currentVolume: 0,
    wineClass: 'red',
    stage: 'bottled',
    createdAt: '2026-09-01',
    history: [],
    ...overrides,
  };
}

function state(overrides: Partial<StorageMovementCommandState> = {}): StorageMovementCommandState {
  return {
    lots: [lot()],
    bottlingRuns: [{
      id: 'RUN-A',
      lotId: 'LOT-A',
      lotName: 'Estate Saperavi',
      date: '2026-10-01',
      lotNumber: 'SAP-26',
      operator: 'Nino',
      formats: { '0.75': 100 },
      totalBottles: 100,
      totalCeramic: 0,
      volumeBottledL: 75,
    }],
    storageLocations: [
      { id: 'STORE-A', name: 'Main warehouse', type: 'warehouse', capacityBottles: 200 },
      { id: 'STORE-B', name: 'Reserve room', type: 'cellar', capacityBottles: 100 },
    ],
    stockMovements: [],
    salesOrders: [],
    ...overrides,
  };
}

const context = {
  commandId: 'cmd-storage-test-0001',
  actorUsername: 'owner',
  performedAt: new Date('2026-10-02T09:00:00.000Z'),
};

describe('storage.movement domain command', () => {
  it('receives unplaced output and links the movement back to its bottling run', () => {
    const applied = applyStorageMovementCommand(state(), {
      action: 'receive',
      movementId: 'mov-receive-0001',
      bottlingRunId: 'RUN-A',
      date: '2026-10-02',
      lotId: 'LOT-A',
      locationId: 'STORE-A',
      bottles: 60,
      note: 'First pallet group',
    }, context);

    expect(applied.result.movements).toEqual([
      expect.objectContaining({
        id: 'mov-receive-0001',
        commandId: context.commandId,
        direction: 'in',
        reason: 'receive',
        sourceRef: 'RUN-A',
        bottles: 60,
      }),
    ]);
    expect(applied.result.updatedBottlingRun).toMatchObject({
      id: 'RUN-A',
      placedInStorageBottles: 60,
      storagePlacements: [{
        movementId: 'mov-receive-0001',
        locationId: 'STORE-A',
        bottles: 60,
        commandId: context.commandId,
      }],
    });
    expect(applied.result.receipt).toMatchObject({ remainingRunUnits: 40, destinationOnHandAfter: 60 });
  });

  it('rejects receipt quantities above source output, lot production, or location capacity', () => {
    const legacyReceipt = {
      id: 'legacy-receipt', date: '2026-10-01', lotId: 'LOT-A', locationId: 'STORE-A',
      direction: 'in' as const, bottles: 80, reason: 'receive',
    };
    const receive = {
      action: 'receive' as const,
      movementId: 'mov-receive-0002',
      bottlingRunId: 'RUN-A',
      date: '2026-10-02',
      lotId: 'LOT-A',
      locationId: 'STORE-A',
      bottles: 30,
      note: '',
    };

    expect(() => applyStorageMovementCommand(state({ stockMovements: [legacyReceipt] }), receive, context))
      .toThrowError(expect.objectContaining({ code: 'storage_production_exceeded', statusCode: 409 }));
    expect(() => applyStorageMovementCommand(state({
      storageLocations: [{ id: 'STORE-A', name: 'Small room', type: 'warehouse', capacityBottles: 20 }],
    }), receive, context)).toThrowError(expect.objectContaining({ code: 'storage_capacity_exceeded' }));
  });

  it('relocates stock as two linked ledger legs without changing lot totals or unplaced production', () => {
    const receipt = {
      id: 'mov-bottling-RUN-A', date: '2026-10-01', lotId: 'LOT-A', locationId: 'STORE-A',
      direction: 'in' as const, bottles: 100, reason: 'bottling', sourceRef: 'RUN-A',
    };
    const applied = applyStorageMovementCommand(state({ stockMovements: [receipt] }), {
      action: 'relocate',
      sourceMovementId: 'mov-relocate-out-0001',
      destinationMovementId: 'mov-relocate-in-0001',
      sourceLocationId: 'STORE-A',
      destinationLocationId: 'STORE-B',
      date: '2026-10-02',
      lotId: 'LOT-A',
      bottles: 30,
      note: 'Move reserve cases',
    }, context);

    expect(applied.result.movements).toEqual([
      expect.objectContaining({ direction: 'out', relatedMovementId: 'mov-relocate-in-0001', reason: 'transfer' }),
      expect.objectContaining({ direction: 'in', relatedMovementId: 'mov-relocate-out-0001', reason: 'transfer' }),
    ]);
    const balances = computeStock(applied.state.stockMovements);
    expect(balances.get('STORE-A')?.byLot['LOT-A']).toBe(70);
    expect(balances.get('STORE-B')?.byLot['LOT-A']).toBe(30);
    expect(unstored({ 'LOT-A': 100 }, applied.state.stockMovements)['LOT-A']).toBeUndefined();
  });

  it('protects reservations and destination capacity during relocation', () => {
    const receipt = {
      id: 'mov-bottling-RUN-A', date: '2026-10-01', lotId: 'LOT-A', locationId: 'STORE-A',
      direction: 'in' as const, bottles: 100, reason: 'bottling', sourceRef: 'RUN-A',
    };
    const relocation = {
      action: 'relocate' as const,
      sourceMovementId: 'mov-relocate-out-0002',
      destinationMovementId: 'mov-relocate-in-0002',
      sourceLocationId: 'STORE-A',
      destinationLocationId: 'STORE-B',
      date: '2026-10-02',
      lotId: 'LOT-A',
      bottles: 30,
      note: '',
    };
    const reservation = {
      id: 'ORDER-A', orderDate: '2026-10-01', createdAt: '2026-10-01T00:00:00.000Z',
      customerName: 'Buyer', lotId: 'LOT-A', lotName: 'Estate Saperavi',
      locationId: 'STORE-A', locationName: 'Main warehouse', bottles: 80,
      pricePerBottle: 20, currency: 'GEL', revenue: 1600, status: 'reserved' as const, operator: 'Owner',
    };

    expect(() => applyStorageMovementCommand(state({
      stockMovements: [receipt], salesOrders: [reservation],
    }), relocation, context)).toThrowError(expect.objectContaining({ code: 'insufficient_unreserved_stock' }));
    expect(() => applyStorageMovementCommand(state({
      stockMovements: [receipt],
      storageLocations: [
        { id: 'STORE-A', name: 'Main warehouse', type: 'warehouse' },
        { id: 'STORE-B', name: 'Full room', type: 'cellar', capacityBottles: 20 },
      ],
    }), relocation, context)).toThrowError(expect.objectContaining({ code: 'storage_capacity_exceeded' }));
  });

  it('requires explicit adjustment evidence and cannot exceed bottled production', () => {
    const adjustment = {
      action: 'adjust' as const,
      movementId: 'mov-adjust-0001',
      locationId: 'STORE-A',
      date: '2026-10-02',
      lotId: 'LOT-A',
      direction: 'in' as const,
      bottles: 1,
      adjustmentReason: 'Cycle count correction',
      note: 'One case was counted twice; net correction verified.',
    };
    const receipt = {
      id: 'mov-bottling-RUN-A', date: '2026-10-01', lotId: 'LOT-A', locationId: 'STORE-A',
      direction: 'in' as const, bottles: 100, reason: 'bottling', sourceRef: 'RUN-A',
    };

    expect(() => applyStorageMovementCommand(state({ stockMovements: [receipt] }), adjustment, context))
      .toThrowError(expect.objectContaining({ code: 'storage_production_exceeded' }));
    expect(() => parseStorageMovementCommandPayload({ ...adjustment, adjustmentReason: '' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_storage_movement_payload', statusCode: 400 }));
  });
});
