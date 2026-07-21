import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SalesDispatchTab, {
  canFulfillSalesOrder,
  canRecordSalesDispatch,
  canReverseSalesDispatch,
  type SalesDispatchActionPermissions,
} from '../components/SalesDispatchTab';
import type { SalesDispatchRecord, SalesOrderRecord, WineLot } from '../lib/wineryState';
import type { StockMovement, StorageLocation } from '../lib/storage';

const lot: WineLot = {
  id: 'LOT-SAP-2026',
  name: 'Saperavi Reserve',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Mukuzani Block 1',
  region: 'Kakheti',
  initialVolume: 1_000,
  currentVolume: 0,
  wineClass: 'red',
  stage: 'bottled',
  createdAt: '2026-09-01',
  history: [],
};

const location: StorageLocation = {
  id: 'loc-main',
  name: 'Main Warehouse',
  type: 'warehouse',
  capacityBottles: 2_000,
};

const receipt: StockMovement = {
  id: 'mov-receive',
  date: '2026-09-10',
  lotId: lot.id,
  locationId: location.id,
  direction: 'in',
  bottles: 120,
  reason: 'receive',
};

const dispatchMovement: StockMovement = {
  id: 'mov-dispatch',
  date: '2026-09-16',
  lotId: lot.id,
  locationId: location.id,
  direction: 'out',
  bottles: 20,
  commandId: 'cmd-sale-1',
  lastModified: '2026-09-16T10:00:00.000Z',
  reason: 'sale',
  sourceRef: 'sale-1',
};

const order: SalesOrderRecord = {
  id: 'so-1',
  orderNumber: 'SO-2026-001',
  orderDate: '2026-09-15',
  createdAt: '2026-09-15T09:00:00.000Z',
  reservedUntil: '2099-12-31',
  customerName: 'Tbilisi Wine Bar',
  lotId: lot.id,
  lotName: lot.name,
  locationId: location.id,
  locationName: location.name,
  bottles: 24,
  pricePerBottle: 22,
  currency: 'GEL',
  revenue: 528,
  costPerBottle: 8,
  cogs: 192,
  grossProfit: 336,
  marginPct: 63.64,
  status: 'reserved',
  operator: 'Nino',
};

const dispatch: SalesDispatchRecord = {
  id: 'sale-1',
  commandId: 'cmd-sale-1',
  recordKind: 'dispatch',
  lastModified: '2026-09-16T10:00:00.000Z',
  date: '2026-09-16',
  customerName: 'Kakheti Distribution',
  lotId: lot.id,
  lotName: lot.name,
  locationId: location.id,
  locationName: location.name,
  bottles: 20,
  pricePerBottle: 22,
  currency: 'GEL',
  revenue: 440,
  costPerBottle: 8,
  cogs: 160,
  grossProfit: 280,
  marginPct: 63.64,
  stockMovementId: dispatchMovement.id,
  operator: 'Nino',
};

const allActions: SalesDispatchActionPermissions = {
  canCreateOrder: true,
  canUpdateOrder: true,
  canCreateDispatch: true,
  canReverseDispatch: true,
  canCreateStockMovement: true,
};

function props(overrides: Partial<ComponentProps<typeof SalesDispatchTab>> = {}): ComponentProps<typeof SalesDispatchTab> {
  return {
    lang: 'en',
    lots: [lot],
    bottlingRuns: [],
    costEntries: [{
      id: 'cost-1',
      date: '2026-09-01',
      lotId: lot.id,
      category: 'labor',
      description: 'Cellar labor',
      amount: 800,
      currency: 'GEL',
    }],
    pricing: { [lot.id]: 22 },
    locations: [location],
    movements: [dispatchMovement, receipt],
    dispatches: [dispatch],
    orders: [order],
    onUpdateMovements: vi.fn(),
    onUpdateDispatches: vi.fn(),
    onUpdateOrders: vi.fn(),
    currency: 'GEL',
    currentUserName: 'Nino',
    ...overrides,
  };
}

function renderSales(overrides: Partial<ComponentProps<typeof SalesDispatchTab>> = {}): string {
  return renderToStaticMarkup(React.createElement(SalesDispatchTab, props(overrides)));
}

describe('SalesDispatchTab action permissions', () => {
  it('keeps availability, orders, dispatches, and revenue useful in read-only mode', () => {
    const markup = renderSales({
      canCreateOrder: false,
      canUpdateOrder: false,
      canCreateDispatch: false,
      canReverseDispatch: false,
      canCreateStockMovement: false,
    });

    expect(markup).toContain('Sales data is read-only');
    expect(markup).toContain('Sellable stock availability');
    expect(markup).toContain('Saperavi Reserve');
    expect(markup).toContain('Tbilisi Wine Bar');
    expect(markup).toContain('Kakheti Distribution');
    expect(markup).toContain('Revenue');
    expect(markup).not.toContain('Reserve stock / sales order');
    expect(markup).not.toContain('Record dispatch now');
    expect(markup).not.toContain('Fulfill into dispatch');
    expect(markup).not.toContain('Cancel reservation');
    expect(markup).not.toContain('Correct and return stock');
  });

  it('preserves every existing workflow control by default', () => {
    const markup = renderSales();

    expect(markup).toContain('Reserve stock / sales order');
    expect(markup).toContain('Record dispatch now');
    expect(markup).toContain('Create reservation');
    expect(markup).toContain('Record dispatch');
    expect(markup).toContain('Fulfill into dispatch');
    expect(markup).toContain('Cancel reservation');
    expect(markup).toContain('Correct and return stock');
    expect(markup).not.toContain('Delete dispatch');
    expect(markup).not.toContain('Some sales actions or finance details are unavailable');
  });

  it('supports partial order creation without exposing compound dispatch actions', () => {
    const markup = renderSales({
      canUpdateOrder: false,
      canCreateDispatch: true,
      canCreateStockMovement: false,
      canReverseDispatch: false,
    });

    expect(markup).toContain('Some sales actions or finance details are unavailable for your role');
    expect(markup).toContain('Reserve stock / sales order');
    expect(markup).not.toContain('Record dispatch now');
    expect(markup).not.toContain('Fulfill into dispatch');
    expect(markup).not.toContain('Cancel reservation');
    expect(markup).not.toContain('Correct and return stock');
  });

  it('hides cost-derived metrics when cost visibility is unavailable', () => {
    const markup = renderSales({ canViewCosts: false });

    expect(markup).toContain('Cost and profit metrics are hidden');
    expect(markup).not.toContain('Gross profit');
    expect(markup).not.toContain('Estimated margin');
    expect(markup).not.toContain('Cost / bottle');
    expect(markup).not.toContain('>Margin<');
  });

  it('localizes read-only guidance in Georgian', () => {
    const markup = renderSales({
      lang: 'ka',
      canCreateOrder: false,
      canUpdateOrder: false,
      canCreateDispatch: false,
      canReverseDispatch: false,
      canCreateStockMovement: false,
    });

    expect(markup).toContain('გაყიდვების მონაცემები მხოლოდ სანახავია');
    expect(markup).toContain('გასაყიდი მარაგის ხელმისაწვდომობა');
    expect(markup).not.toContain('Sales data is read-only');
  });
});

describe('sales compound-write permission helpers', () => {
  it('requires both sales creation and storage movement creation for dispatch', () => {
    expect(canRecordSalesDispatch(allActions)).toBe(true);
    expect(canRecordSalesDispatch({ ...allActions, canCreateStockMovement: false })).toBe(false);
    expect(canRecordSalesDispatch({ ...allActions, canCreateDispatch: false })).toBe(false);
  });

  it('also requires order update permission when fulfilling a reservation', () => {
    expect(canFulfillSalesOrder(allActions)).toBe(true);
    expect(canFulfillSalesOrder({ ...allActions, canUpdateOrder: false })).toBe(false);
  });

  it('offers correction only for active command-created dispatches with the compound permission', () => {
    expect(canReverseSalesDispatch(dispatch, allActions)).toBe(true);
    expect(canReverseSalesDispatch(dispatch, { ...allActions, canReverseDispatch: false })).toBe(false);
    expect(canReverseSalesDispatch({ ...dispatch, commandId: undefined }, allActions)).toBe(false);
    expect(canReverseSalesDispatch({ ...dispatch, recordKind: 'reversal' }, allActions)).toBe(false);
    expect(canReverseSalesDispatch({ ...dispatch, reversedByCommandId: 'cmd-reversal' }, allActions)).toBe(false);
  });
});
