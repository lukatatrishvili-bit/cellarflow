import { describe, expect, it } from 'vitest';
import type { WineLot } from '../lib/wineryState';
import { computeStock } from '../lib/storage';
import { isActiveSalesDispatch } from '../lib/sales';
import { applySalesStockCommand, type SalesStockCommandState } from '../lib/commands/salesStock';
import {
  applySalesStockReversalCommand,
  parseSalesStockReversalCommandPayload,
} from '../lib/commands/salesStockReversal';

function lot(): WineLot {
  return {
    id: 'LOT-RETURN',
    name: 'Estate Saperavi',
    vintage: 2025,
    variety: 'Saperavi',
    vineyardBlock: 'Block A',
    region: 'Kakheti',
    initialVolume: 75,
    currentVolume: 0,
    wineClass: 'red',
    stage: 'bottled',
    createdAt: '2025-10-01',
    history: [],
  };
}

function state(capacityBottles = 120): SalesStockCommandState {
  return {
    lots: [lot()],
    bottlingRuns: [{
      id: 'BOT-RETURN', lotId: 'LOT-RETURN', lotName: 'Estate Saperavi', date: '2026-07-01',
      lotNumber: 'BOT-RETURN', operator: 'Nino', formats: { '0.75': 100 }, totalBottles: 100,
      totalCeramic: 0, volumeBottledL: 75,
    }],
    costEntries: [],
    storageLocations: [{ id: 'STORE-RETURN', name: 'Main warehouse', type: 'warehouse', capacityBottles }],
    stockMovements: [{
      id: 'IN-RETURN', date: '2026-07-01', lotId: 'LOT-RETURN', locationId: 'STORE-RETURN',
      direction: 'in', bottles: 100, reason: 'bottling', sourceRef: 'BOT-RETURN',
    }],
    salesDispatches: [],
    salesOrders: [],
  };
}

const dispatchContext = {
  commandId: 'cmd-sales-original-return-0001',
  actorUsername: 'nino',
  currency: 'GEL',
  performedAt: new Date('2026-07-20T08:00:00.000Z'),
};

const reversalPayload = {
  reversalDispatchId: 'sale-reversal-return-0001',
  returnMovementId: 'mov-sale-return-0001',
  originalCommandId: dispatchContext.commandId,
  reason: 'Customer returned the unopened shipment.',
};

const reversalContext = {
  commandId: 'cmd-sales-reversal-return-0001',
  actorUsername: 'owner',
  performedAt: new Date('2026-07-20T09:00:00.000Z'),
};

function directDispatch(initial = state()) {
  return applySalesStockCommand(initial, {
    action: 'dispatch',
    dispatchId: 'sale-original-return-0001',
    date: '2026-07-20',
    customerName: 'Kakheti Distribution',
    lotId: 'LOT-RETURN',
    locationId: 'STORE-RETURN',
    bottles: 30,
    pricePerBottle: 20,
    operator: 'Nino',
    notes: '',
  }, dispatchContext);
}

describe('sales.stock.reverse domain command', () => {
  it('appends a return, preserves both ledger facts, and removes the sale from active metrics', () => {
    const dispatched = directDispatch();
    expect(dispatched.result.stockMovement).toMatchObject({ commandId: dispatchContext.commandId });

    const reversed = applySalesStockReversalCommand(dispatched.state, reversalPayload, reversalContext);
    expect(reversed.state.salesDispatches).toHaveLength(2);
    expect(reversed.result.originalDispatch).toMatchObject({
      id: 'sale-original-return-0001',
      reversedByCommandId: reversalContext.commandId,
      reversalReason: reversalPayload.reason,
    });
    expect(reversed.result.reversalDispatch).toMatchObject({
      recordKind: 'reversal',
      reversalOfDispatchId: 'sale-original-return-0001',
      reversalOfCommandId: dispatchContext.commandId,
      stockMovementId: reversalPayload.returnMovementId,
    });
    expect(reversed.result.returnMovement).toMatchObject({
      direction: 'in',
      reason: 'sale_reversal',
      bottles: 30,
      reversalOfMovementId: 'mov-dispatch-sale-original-return-0001',
    });
    expect(computeStock(reversed.state.stockMovements).get('STORE-RETURN')?.byLot['LOT-RETURN']).toBe(100);
    expect(reversed.state.salesDispatches.filter(isActiveSalesDispatch)).toEqual([]);
  });

  it('cancels a fulfilled reservation without recreating reserved demand', () => {
    const reserved = applySalesStockCommand(state(), {
      action: 'reserve', orderId: 'so-return-0001', orderNumber: 'SO-RETURN-0001',
      orderDate: '2026-07-20', requestedDispatchDate: '', reservedUntil: '2026-07-25',
      customerName: 'Tbilisi Wine Bar', lotId: 'LOT-RETURN', locationId: 'STORE-RETURN',
      bottles: 40, pricePerBottle: 20, operator: 'Nino', notes: '',
    }, { ...dispatchContext, commandId: 'cmd-sales-reserve-return-0001' });
    const fulfilled = applySalesStockCommand(reserved.state, {
      action: 'fulfill', orderId: 'so-return-0001', dispatchId: 'sale-original-return-0001',
      date: '2026-07-20', operator: 'Nino',
    }, dispatchContext);
    const reversed = applySalesStockReversalCommand(fulfilled.state, reversalPayload, reversalContext);

    expect(reversed.result.changedOrder).toMatchObject({
      id: 'so-return-0001',
      status: 'cancelled',
      dispatchId: 'sale-original-return-0001',
      reversedByCommandId: reversalContext.commandId,
      lastCommandId: reversalContext.commandId,
    });
    expect(reversed.state.salesOrders.filter(order => order.status === 'reserved')).toEqual([]);
    expect(computeStock(reversed.state.stockMovements).get('STORE-RETURN')?.byLot['LOT-RETURN']).toBe(100);
  });

  it('rejects duplicate compensation, changed fulfillment state, and insufficient return capacity', () => {
    const dispatched = directDispatch();
    const reversed = applySalesStockReversalCommand(dispatched.state, reversalPayload, reversalContext);
    expect(() => applySalesStockReversalCommand(reversed.state, {
      ...reversalPayload,
      reversalDispatchId: 'sale-reversal-return-0002',
      returnMovementId: 'mov-sale-return-0002',
    }, { ...reversalContext, commandId: 'cmd-sales-reversal-return-0002' }))
      .toThrowError(expect.objectContaining({ code: 'sales_dispatch_already_reversed', statusCode: 409 }));

    const changed = directDispatch();
    changed.state.stockMovements = changed.state.stockMovements.map(movement => movement.id === changed.result.stockMovement?.id
      ? { ...movement, bottles: 29 }
      : movement);
    expect(() => applySalesStockReversalCommand(changed.state, reversalPayload, reversalContext))
      .toThrowError(expect.objectContaining({ code: 'sales_stock_reversal_dependency_conflict' }));

    const nearlyFull = directDispatch(state(100));
    nearlyFull.state.stockMovements.unshift({
      id: 'IN-LATER', date: '2026-07-20', lotId: 'LOT-RETURN', locationId: 'STORE-RETURN',
      direction: 'in', bottles: 25, reason: 'adjustment',
    });
    expect(() => applySalesStockReversalCommand(nearlyFull.state, reversalPayload, reversalContext))
      .toThrowError(expect.objectContaining({ code: 'sales_stock_reversal_capacity_exceeded' }));
  });

  it('validates deterministic ids and the required correction reason', () => {
    expect(parseSalesStockReversalCommandPayload(reversalPayload)).toEqual(reversalPayload);
    expect(() => parseSalesStockReversalCommandPayload({ ...reversalPayload, reason: ' ' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_sales_stock_reversal_payload', statusCode: 400 }));
  });
});
