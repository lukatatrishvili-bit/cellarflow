import { describe, expect, it } from 'vitest';
import type { WineLot } from '../lib/wineryState';
import {
  applySalesStockCommand,
  parseSalesStockCommandPayload,
  type ReserveSalesStockPayload,
  type SalesStockCommandState,
} from '../lib/commands/salesStock';

function lot(): WineLot {
  return {
    id: 'LOT-A',
    name: 'Estate Saperavi',
    vintage: 2025,
    variety: 'Saperavi',
    vineyardBlock: 'Block A',
    region: 'Kakheti',
    initialVolume: 100,
    currentVolume: 0,
    wineClass: 'red',
    stage: 'bottled',
    createdAt: '2025-10-01',
    history: [],
  };
}

function state(overrides: Partial<SalesStockCommandState> = {}): SalesStockCommandState {
  return {
    lots: [lot()],
    bottlingRuns: [{
      id: 'BOT-A',
      lotId: 'LOT-A',
      lotName: 'Estate Saperavi',
      date: '2026-07-01',
      lotNumber: 'BOT-A',
      operator: 'Nino',
      formats: { '0.75': 100 },
      totalBottles: 100,
      totalCeramic: 0,
      volumeBottledL: 75,
    }],
    costEntries: [{
      id: 'COST-A',
      date: '2026-07-01',
      lotId: 'LOT-A',
      category: 'packaging',
      description: 'Bottling cost',
      amount: 400,
      currency: 'GEL',
    }],
    storageLocations: [{ id: 'STORE-A', name: 'Main warehouse', type: 'warehouse' }],
    stockMovements: [{
      id: 'IN-A',
      date: '2026-07-01',
      lotId: 'LOT-A',
      locationId: 'STORE-A',
      direction: 'in',
      bottles: 100,
    }],
    salesDispatches: [],
    salesOrders: [],
    ...overrides,
  };
}

const reservePayload: ReserveSalesStockPayload = {
  action: 'reserve',
  orderId: 'so-test-0001',
  orderNumber: 'SO-20260720-0001',
  orderDate: '2026-07-20',
  requestedDispatchDate: '2026-07-22',
  reservedUntil: '2026-07-25',
  customerName: 'Tbilisi Wine Bar',
  marketChannel: 'export',
  lotId: 'LOT-A',
  locationId: 'STORE-A',
  bottles: 40,
  pricePerBottle: 20,
  operator: 'Nino',
  notes: 'Handle carefully',
};

const context = {
  commandId: 'cmd-sales-test-0001',
  actorUsername: 'nino',
  currency: 'GEL',
  performedAt: new Date('2026-07-20T10:00:00.000Z'),
};

describe('sales.stock domain command', () => {
  it('creates a reservation from authoritative unreserved stock and cost data', () => {
    const applied = applySalesStockCommand(state(), reservePayload, context);

    expect(applied.state.salesOrders[0]).toMatchObject({
      id: 'so-test-0001',
      commandId: 'cmd-sales-test-0001',
      status: 'reserved',
      revenue: 800,
      costPerBottle: 4,
      cogs: 160,
      grossProfit: 640,
      marginPct: 80,
      marketChannel: 'export',
      currency: 'GEL',
    });
    expect(applied.state.stockMovements).toHaveLength(1);
    expect(applied.result.receipt).toMatchObject({ action: 'reserve', bottles: 40, orderId: 'so-test-0001' });
  });

  it('creates a direct dispatch and linked outbound movement without touching orders', () => {
    const applied = applySalesStockCommand(state(), {
      action: 'dispatch',
      dispatchId: 'sale-test-0001',
      date: '2026-07-20',
      customerName: 'Kakheti Distribution',
      marketChannel: 'domestic',
      lotId: 'LOT-A',
      locationId: 'STORE-A',
      bottles: 30,
      pricePerBottle: 20,
      operator: 'Nino',
      notes: '',
    }, context);

    expect(applied.state.salesDispatches[0]).toMatchObject({
      id: 'sale-test-0001',
      commandId: 'cmd-sales-test-0001',
      stockMovementId: 'mov-dispatch-sale-test-0001',
      revenue: 600,
      cogs: 120,
      marketChannel: 'domestic',
    });
    expect(applied.state.stockMovements[0]).toMatchObject({
      id: 'mov-dispatch-sale-test-0001',
      direction: 'out',
      bottles: 30,
      sourceRef: 'sale-test-0001',
    });
    expect(applied.state.salesOrders).toEqual([]);
  });

  it('fulfills one active reservation while preserving stock reserved by other orders', () => {
    const reserved = applySalesStockCommand(state(), reservePayload, context).state;
    const withSecondReservation = applySalesStockCommand(reserved, {
      ...reservePayload,
      orderId: 'so-test-0002',
      orderNumber: 'SO-20260720-0002',
      bottles: 20,
    }, { ...context, commandId: 'cmd-sales-test-0002' }).state;
    const applied = applySalesStockCommand(withSecondReservation, {
      action: 'fulfill',
      orderId: 'so-test-0001',
      dispatchId: 'sale-test-fulfill-0001',
      date: '2026-07-20',
      operator: 'Nino',
    }, { ...context, commandId: 'cmd-sales-test-fulfill-0001' });

    expect(applied.result.order).toMatchObject({
      id: 'so-test-0001',
      status: 'fulfilled',
      dispatchId: 'sale-test-fulfill-0001',
      lastCommandId: 'cmd-sales-test-fulfill-0001',
    });
    expect(applied.result.dispatch).toMatchObject({
      id: 'sale-test-fulfill-0001',
      salesOrderId: 'so-test-0001',
      bottles: 40,
    });
    expect(applied.state.salesOrders.find(order => order.id === 'so-test-0002')).toMatchObject({ status: 'reserved' });
  });

  it('cancels only a reserved order and records who released it', () => {
    const reserved = applySalesStockCommand(state(), reservePayload, context).state;
    const applied = applySalesStockCommand(reserved, {
      action: 'cancel',
      orderId: 'so-test-0001',
    }, { ...context, commandId: 'cmd-sales-cancel-0001', actorUsername: 'owner' });

    expect(applied.result.order).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'owner',
      lastCommandId: 'cmd-sales-cancel-0001',
    });
    expect(() => applySalesStockCommand(applied.state, {
      action: 'cancel',
      orderId: 'so-test-0001',
    }, context)).toThrowError(expect.objectContaining({ code: 'sales_order_not_reserved', statusCode: 409 }));
  });

  it('prevents reservations and direct dispatches from oversubscribing the same balance', () => {
    const withReservation = applySalesStockCommand(state(), {
      ...reservePayload,
      bottles: 70,
    }, context).state;

    expect(() => applySalesStockCommand(withReservation, {
      ...reservePayload,
      orderId: 'so-test-overbook',
      orderNumber: 'SO-OVERBOOK',
      bottles: 31,
    }, { ...context, commandId: 'cmd-sales-overbook' }))
      .toThrowError(expect.objectContaining({ code: 'insufficient_sellable_stock', statusCode: 409 }));
    expect(() => applySalesStockCommand(withReservation, {
      action: 'dispatch',
      dispatchId: 'sale-test-overbook',
      date: '2026-07-20',
      customerName: 'Walk-in Buyer',
      lotId: 'LOT-A',
      locationId: 'STORE-A',
      bottles: 31,
      pricePerBottle: 20,
      operator: 'Nino',
      notes: '',
    }, { ...context, commandId: 'cmd-sales-dispatch-overbook' }))
      .toThrowError(expect.objectContaining({ code: 'insufficient_sellable_stock' }));
  });

  it('rejects expired fulfillment and deterministic record collisions', () => {
    const expired = applySalesStockCommand(state(), {
      ...reservePayload,
      reservedUntil: '2026-07-20',
    }, context).state;
    expect(() => applySalesStockCommand(expired, {
      action: 'fulfill',
      orderId: 'so-test-0001',
      dispatchId: 'sale-expired',
      date: '2026-07-21',
      operator: 'Nino',
    }, { ...context, performedAt: new Date('2026-07-21T10:00:00.000Z') }))
      .toThrowError(expect.objectContaining({ code: 'sales_order_expired' }));

    expect(() => applySalesStockCommand(state({
      salesDispatches: [{
        id: 'sale-test-0001',
        date: '2026-07-19',
        customerName: 'Existing',
        lotId: 'LOT-A',
        lotName: 'Estate Saperavi',
        locationId: 'STORE-A',
        locationName: 'Main warehouse',
        bottles: 1,
        pricePerBottle: 20,
        currency: 'GEL',
        revenue: 20,
        stockMovementId: 'move-existing',
        operator: 'Nino',
      }],
    }), {
      action: 'dispatch',
      dispatchId: 'sale-test-0001',
      date: '2026-07-20',
      customerName: 'Buyer',
      lotId: 'LOT-A',
      locationId: 'STORE-A',
      bottles: 1,
      pricePerBottle: 20,
      operator: 'Nino',
      notes: '',
    }, context)).toThrowError(expect.objectContaining({ code: 'sales_dispatch_id_conflict' }));
  });

  it('validates dates, whole bottles, positive pricing, and supported actions', () => {
    expect(() => parseSalesStockCommandPayload({ ...reservePayload, bottles: 1.5 }))
      .toThrowError(expect.objectContaining({ code: 'invalid_sales_stock_payload' }));
    expect(() => parseSalesStockCommandPayload({ ...reservePayload, pricePerBottle: 0 }))
      .toThrowError(expect.objectContaining({ code: 'invalid_sales_stock_payload' }));
    expect(() => parseSalesStockCommandPayload({ ...reservePayload, reservedUntil: '2026-02-30' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_sales_stock_payload' }));
    expect(() => parseSalesStockCommandPayload({ ...reservePayload, action: 'refund' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_sales_stock_payload' }));
  });
});
