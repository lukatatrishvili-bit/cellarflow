import { rollupLots, type CostEntry } from '../costing';
import { availableToSell, computeDispatchFinancials, isActiveReservation } from '../sales';
import {
  computeStock,
  stockMovementFromDispatch,
  type StockMovement,
  type StorageLocation,
} from '../storage';
import type {
  BottlingRunRecord,
  SalesDispatchRecord,
  SalesOrderRecord,
  WineLot,
} from '../wineryState';
import { isActiveBottlingRun } from '../bottlingIntegrity';

export const SALES_STOCK_COMMAND_TYPE = 'sales.stock' as const;
export const SALES_STOCK_ACTIONS = ['reserve', 'dispatch', 'fulfill', 'cancel'] as const;
export type SalesStockAction = typeof SALES_STOCK_ACTIONS[number];

interface SalesRecordInput {
  customerName: string;
  marketChannel?: 'domestic' | 'export';
  lotId: string;
  locationId: string;
  bottles: number;
  pricePerBottle: number;
  operator: string;
  notes: string;
}

export interface ReserveSalesStockPayload extends SalesRecordInput {
  action: 'reserve';
  orderId: string;
  orderNumber: string;
  orderDate: string;
  requestedDispatchDate: string;
  reservedUntil: string;
}

export interface DispatchSalesStockPayload extends SalesRecordInput {
  action: 'dispatch';
  dispatchId: string;
  date: string;
}

export interface FulfillSalesStockPayload {
  action: 'fulfill';
  orderId: string;
  dispatchId: string;
  date: string;
  operator: string;
}

export interface CancelSalesStockPayload {
  action: 'cancel';
  orderId: string;
}

export type SalesStockCommandPayload =
  | ReserveSalesStockPayload
  | DispatchSalesStockPayload
  | FulfillSalesStockPayload
  | CancelSalesStockPayload;

export interface SalesStockCommandState {
  lots: WineLot[];
  bottlingRuns: BottlingRunRecord[];
  costEntries: CostEntry[];
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
  salesDispatches: SalesDispatchRecord[];
  salesOrders: SalesOrderRecord[];
}

export interface SalesStockCommandContext {
  commandId: string;
  actorUsername: string;
  currency: string;
  performedAt: Date;
}

export interface SalesStockCommandResult {
  action: SalesStockAction;
  order?: SalesOrderRecord;
  dispatch?: SalesDispatchRecord;
  stockMovement?: StockMovement;
  stateVersion?: number;
  receipt: {
    action: SalesStockAction;
    lotId: string;
    locationId: string;
    bottles: number;
    customerName: string;
    orderId?: string;
    dispatchId?: string;
  };
}

export interface AppliedSalesStockCommand {
  state: SalesStockCommandState;
  result: SalesStockCommandResult;
}

export type SalesStockCommandErrorCode =
  | 'invalid_sales_stock_payload'
  | 'organization_state_not_found'
  | 'sales_lot_not_found'
  | 'sales_location_not_found'
  | 'sales_order_not_found'
  | 'sales_order_not_reserved'
  | 'sales_order_expired'
  | 'sales_order_id_conflict'
  | 'sales_dispatch_id_conflict'
  | 'sales_stock_movement_id_conflict'
  | 'insufficient_sellable_stock'
  | 'sales_stock_state_inconsistent';

export class SalesStockCommandError extends Error {
  constructor(
    public readonly code: SalesStockCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SalesStockCommandError';
  }
}

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BOTTLES = 100_000_000;
const MAX_AMOUNT = 1_000_000_000;

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new SalesStockCommandError(
      'invalid_sales_stock_payload',
      `${field} must be 1-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
      400,
    );
  }
  return normalized;
}

function boundedText(value: unknown, field: string, maxLength: number, required = true): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if ((required && !normalized) || normalized.length > maxLength) {
    throw new SalesStockCommandError(
      'invalid_sales_stock_payload',
      `${field} ${required ? 'is required and ' : ''}must not exceed ${maxLength} characters.`,
      400,
    );
  }
  return normalized;
}

function calendarDate(value: unknown, field: string, required = true): string {
  if (!required && (value === undefined || value === null || value === '')) return '';
  const date = typeof value === 'string' ? value.trim() : '';
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new SalesStockCommandError(
      'invalid_sales_stock_payload',
      `${field} must be a valid calendar date in YYYY-MM-DD format.`,
      400,
    );
  }
  return date;
}

function wholeBottles(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > MAX_BOTTLES) {
    throw new SalesStockCommandError(
      'invalid_sales_stock_payload',
      `bottles must be a positive whole number no greater than ${MAX_BOTTLES}.`,
      400,
    );
  }
  return value;
}

function positiveAmount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) {
    throw new SalesStockCommandError(
      'invalid_sales_stock_payload',
      `${field} must be a positive finite number no greater than ${MAX_AMOUNT}.`,
      400,
    );
  }
  return value;
}

function salesRecordInput(input: Record<string, unknown>): SalesRecordInput {
  const marketChannel = input.marketChannel === undefined || input.marketChannel === ''
    ? undefined
    : input.marketChannel === 'domestic' || input.marketChannel === 'export'
      ? input.marketChannel
      : null;
  if (marketChannel === null) {
    throw new SalesStockCommandError(
      'invalid_sales_stock_payload',
      'marketChannel must be domestic or export.',
      400,
    );
  }
  return {
    customerName: boundedText(input.customerName, 'customerName', 200),
    ...(marketChannel ? { marketChannel } : {}),
    lotId: requiredRecordId(input.lotId, 'lotId'),
    locationId: requiredRecordId(input.locationId, 'locationId'),
    bottles: wholeBottles(input.bottles),
    pricePerBottle: positiveAmount(input.pricePerBottle, 'pricePerBottle'),
    operator: boundedText(input.operator, 'operator', 120),
    notes: boundedText(input.notes, 'notes', 2_000, false),
  };
}

export function parseSalesStockCommandPayload(value: unknown): SalesStockCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SalesStockCommandError('invalid_sales_stock_payload', 'Sales stock payload must be an object.', 400);
  }
  const input = value as Record<string, unknown>;
  const action = typeof input.action === 'string' ? input.action : '';
  if (!SALES_STOCK_ACTIONS.includes(action as SalesStockAction)) {
    throw new SalesStockCommandError('invalid_sales_stock_payload', 'Sales stock action is not supported.', 400);
  }

  if (action === 'cancel') {
    return { action, orderId: requiredRecordId(input.orderId, 'orderId') };
  }
  if (action === 'fulfill') {
    return {
      action,
      orderId: requiredRecordId(input.orderId, 'orderId'),
      dispatchId: requiredRecordId(input.dispatchId, 'dispatchId'),
      date: calendarDate(input.date, 'date'),
      operator: boundedText(input.operator, 'operator', 120),
    };
  }

  const record = salesRecordInput(input);
  if (action === 'dispatch') {
    return {
      action,
      dispatchId: requiredRecordId(input.dispatchId, 'dispatchId'),
      date: calendarDate(input.date, 'date'),
      ...record,
    };
  }

  const orderDate = calendarDate(input.orderDate, 'orderDate');
  const requestedDispatchDate = calendarDate(input.requestedDispatchDate, 'requestedDispatchDate', false);
  const reservedUntil = calendarDate(input.reservedUntil, 'reservedUntil', false);
  if (requestedDispatchDate && requestedDispatchDate < orderDate) {
    throw new SalesStockCommandError(
      'invalid_sales_stock_payload',
      'requestedDispatchDate cannot be earlier than orderDate.',
      400,
    );
  }
  return {
    action: 'reserve',
    orderId: requiredRecordId(input.orderId, 'orderId'),
    orderNumber: boundedText(input.orderNumber, 'orderNumber', 120),
    orderDate,
    requestedDispatchDate,
    reservedUntil,
    ...record,
  };
}

function stamped<T extends object>(record: T, timestamp: string): T {
  return { ...record, lastModified: timestamp };
}

function assertState(state: SalesStockCommandState): void {
  if (!state || !Array.isArray(state.lots) || !Array.isArray(state.bottlingRuns)
    || !Array.isArray(state.costEntries) || !Array.isArray(state.storageLocations)
    || !Array.isArray(state.stockMovements) || !Array.isArray(state.salesDispatches)
    || !Array.isArray(state.salesOrders)) {
    throw new SalesStockCommandError('sales_stock_state_inconsistent', 'Organization sales stock state is unavailable.', 400);
  }
}

function lotCostPerBottle(state: SalesStockCommandState, lotId: string): number | null {
  const bottlesByLot: Record<string, number> = {};
  for (const run of state.bottlingRuns) {
    if (!isActiveBottlingRun(run)) continue;
    bottlesByLot[run.lotId] = (bottlesByLot[run.lotId] || 0)
      + Math.max(0, Math.floor(run.totalBottles || 0))
      + Math.max(0, Math.floor(run.totalCeramic || 0));
  }
  return rollupLots(
    state.lots.map(lot => ({
      id: lot.id,
      volumeLitres: lot.currentVolume || lot.initialVolume || 0,
    })),
    state.costEntries,
    bottlesByLot,
  ).get(lotId)?.perBottle ?? null;
}

function stockPosition(
  state: SalesStockCommandState,
  locationId: string,
  lotId: string,
  asOfDate: string,
  excludeOrderId?: string,
): { onHand: number; available: number } {
  const onHand = computeStock(state.stockMovements).get(locationId)?.byLot[lotId] || 0;
  if (!Number.isFinite(onHand) || onHand < 0) {
    throw new SalesStockCommandError(
      'sales_stock_state_inconsistent',
      `Stored balance for ${lotId} at ${locationId} is invalid.`,
      409,
    );
  }
  return {
    onHand,
    available: availableToSell({
      onHandBottles: onHand,
      orders: state.salesOrders,
      locationId,
      lotId,
      asOfDate,
      excludeOrderId,
    }),
  };
}

function assertReferences(state: SalesStockCommandState, lotId: string, locationId: string): {
  lot: WineLot;
  location: StorageLocation;
} {
  const lot = state.lots.find(item => item.id === lotId);
  if (!lot) throw new SalesStockCommandError('sales_lot_not_found', 'The sales lot was not found.', 404);
  const location = state.storageLocations.find(item => item.id === locationId);
  if (!location) throw new SalesStockCommandError('sales_location_not_found', 'The storage location was not found.', 404);
  return { lot, location };
}

function createDispatchRecords(input: {
  state: SalesStockCommandState;
  dispatchId: string;
  date: string;
  customerName: string;
  marketChannel?: 'domestic' | 'export';
  lot: WineLot;
  location: StorageLocation;
  bottles: number;
  pricePerBottle: number;
  costPerBottle: number | null;
  operator: string;
  notes: string;
  currency: string;
  timestamp: string;
  commandId: string;
  salesOrderId?: string;
}): { dispatch: SalesDispatchRecord; movement: StockMovement } {
  if (input.state.salesDispatches.some(item => item.id === input.dispatchId)) {
    throw new SalesStockCommandError('sales_dispatch_id_conflict', 'Sales dispatch id already exists.', 409);
  }
  const generated = stockMovementFromDispatch({
    dispatchId: input.dispatchId,
    date: input.date,
    lotId: input.lot.id,
    locationId: input.location.id,
    bottles: input.bottles,
    customerName: input.customerName,
  });
  if (!generated) {
    throw new SalesStockCommandError('sales_stock_state_inconsistent', 'The sales stock movement could not be created.', 409);
  }
  if (input.state.stockMovements.some(item => item.id === generated.id)) {
    throw new SalesStockCommandError('sales_stock_movement_id_conflict', 'Sales stock movement id already exists.', 409);
  }
  const movement = stamped({ ...generated, commandId: input.commandId }, input.timestamp);
  const financials = computeDispatchFinancials({
    bottles: input.bottles,
    pricePerBottle: input.pricePerBottle,
    costPerBottle: input.costPerBottle,
  });
  const dispatch = stamped<SalesDispatchRecord>({
    id: input.dispatchId,
    commandId: input.commandId,
    recordKind: 'dispatch',
    date: input.date,
    customerName: input.customerName,
    ...(input.marketChannel ? { marketChannel: input.marketChannel } : {}),
    lotId: input.lot.id,
    lotName: input.lot.name,
    locationId: input.location.id,
    locationName: input.location.name,
    bottles: input.bottles,
    pricePerBottle: input.pricePerBottle,
    currency: input.currency,
    revenue: financials.revenue,
    costPerBottle: input.costPerBottle,
    cogs: financials.cogs,
    grossProfit: financials.grossProfit,
    marginPct: financials.marginPct,
    stockMovementId: movement.id,
    ...(input.salesOrderId ? { salesOrderId: input.salesOrderId } : {}),
    operator: input.operator,
    ...(input.notes ? { notes: input.notes } : {}),
  }, input.timestamp);
  return { dispatch, movement };
}

export function applySalesStockCommand(
  currentState: SalesStockCommandState,
  rawPayload: unknown,
  context: SalesStockCommandContext,
): AppliedSalesStockCommand {
  const payload = parseSalesStockCommandPayload(rawPayload);
  assertState(currentState);
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new SalesStockCommandError('invalid_sales_stock_payload', 'Sales stock execution time is invalid.', 400);
  }
  const timestamp = context.performedAt.toISOString();
  const asOfDate = timestamp.slice(0, 10);

  if (payload.action === 'cancel') {
    const order = currentState.salesOrders.find(item => item.id === payload.orderId);
    if (!order) throw new SalesStockCommandError('sales_order_not_found', 'The sales order was not found.', 404);
    if (order.status !== 'reserved') {
      throw new SalesStockCommandError('sales_order_not_reserved', 'Only a reserved sales order can be cancelled.', 409);
    }
    const updatedOrder = stamped<SalesOrderRecord>({
      ...order,
      status: 'cancelled',
      cancelledAt: timestamp,
      cancelledBy: context.actorUsername,
      lastCommandId: context.commandId,
    }, timestamp);
    return {
      state: {
        ...currentState,
        salesOrders: currentState.salesOrders.map(item => item.id === updatedOrder.id ? updatedOrder : item),
      },
      result: {
        action: payload.action,
        order: updatedOrder,
        receipt: {
          action: payload.action,
          lotId: order.lotId,
          locationId: order.locationId,
          bottles: order.bottles,
          customerName: order.customerName,
          orderId: order.id,
        },
      },
    };
  }

  if (payload.action === 'fulfill') {
    const order = currentState.salesOrders.find(item => item.id === payload.orderId);
    if (!order) throw new SalesStockCommandError('sales_order_not_found', 'The sales order was not found.', 404);
    if (order.status !== 'reserved') {
      throw new SalesStockCommandError('sales_order_not_reserved', 'Only a reserved sales order can be fulfilled.', 409);
    }
    if (!isActiveReservation(order, asOfDate)) {
      throw new SalesStockCommandError('sales_order_expired', 'The sales reservation has expired.', 409);
    }
    if (!Number.isSafeInteger(order.bottles) || order.bottles <= 0 || order.bottles > MAX_BOTTLES
      || typeof order.pricePerBottle !== 'number' || !Number.isFinite(order.pricePerBottle)
      || order.pricePerBottle <= 0 || order.pricePerBottle > MAX_AMOUNT) {
      throw new SalesStockCommandError(
        'sales_stock_state_inconsistent',
        'The reserved sales order has an invalid quantity or price.',
        409,
      );
    }
    const { lot, location } = assertReferences(currentState, order.lotId, order.locationId);
    const position = stockPosition(currentState, order.locationId, order.lotId, asOfDate, order.id);
    if (order.bottles > position.available) {
      throw new SalesStockCommandError(
        'insufficient_sellable_stock',
        `Only ${position.available} bottles are available to fulfill this order.`,
        409,
      );
    }
    const storedCost = typeof order.costPerBottle === 'number' && Number.isFinite(order.costPerBottle)
      && order.costPerBottle >= 0 ? order.costPerBottle : null;
    const records = createDispatchRecords({
      state: currentState,
      dispatchId: payload.dispatchId,
      date: payload.date,
      customerName: order.customerName,
      marketChannel: order.marketChannel,
      lot,
      location,
      bottles: order.bottles,
      pricePerBottle: order.pricePerBottle,
      costPerBottle: storedCost ?? lotCostPerBottle(currentState, order.lotId),
      operator: payload.operator,
      notes: `Fulfilled order ${order.orderNumber || order.id}${order.notes ? `. ${order.notes}` : ''}`,
      currency: context.currency,
      timestamp,
      commandId: context.commandId,
      salesOrderId: order.id,
    });
    const updatedOrder = stamped<SalesOrderRecord>({
      ...order,
      status: 'fulfilled',
      dispatchId: records.dispatch.id,
      fulfilledAt: timestamp,
      lastCommandId: context.commandId,
    }, timestamp);
    return {
      state: {
        ...currentState,
        stockMovements: [records.movement, ...currentState.stockMovements],
        salesDispatches: [records.dispatch, ...currentState.salesDispatches],
        salesOrders: currentState.salesOrders.map(item => item.id === updatedOrder.id ? updatedOrder : item),
      },
      result: {
        action: payload.action,
        order: updatedOrder,
        dispatch: records.dispatch,
        stockMovement: records.movement,
        receipt: {
          action: payload.action,
          lotId: order.lotId,
          locationId: order.locationId,
          bottles: order.bottles,
          customerName: order.customerName,
          orderId: order.id,
          dispatchId: records.dispatch.id,
        },
      },
    };
  }

  const { lot, location } = assertReferences(currentState, payload.lotId, payload.locationId);
  const position = stockPosition(currentState, payload.locationId, payload.lotId, asOfDate);
  if (payload.bottles > position.available) {
    throw new SalesStockCommandError(
      'insufficient_sellable_stock',
      `Only ${position.available} unreserved bottles are available.`,
      409,
    );
  }
  const costPerBottle = lotCostPerBottle(currentState, payload.lotId);
  const financials = computeDispatchFinancials({
    bottles: payload.bottles,
    pricePerBottle: payload.pricePerBottle,
    costPerBottle,
  });

  if (payload.action === 'reserve') {
    if (payload.reservedUntil && payload.reservedUntil < asOfDate) {
      throw new SalesStockCommandError(
        'invalid_sales_stock_payload',
        'reservedUntil cannot be earlier than the execution date.',
        400,
      );
    }
    if (currentState.salesOrders.some(item => item.id === payload.orderId)) {
      throw new SalesStockCommandError('sales_order_id_conflict', 'Sales order id already exists.', 409);
    }
    const order = stamped<SalesOrderRecord>({
      id: payload.orderId,
      commandId: context.commandId,
      orderNumber: payload.orderNumber,
      orderDate: payload.orderDate,
      createdAt: timestamp,
      ...(payload.requestedDispatchDate ? { requestedDispatchDate: payload.requestedDispatchDate } : {}),
      ...(payload.reservedUntil ? { reservedUntil: payload.reservedUntil } : {}),
      customerName: payload.customerName,
      ...(payload.marketChannel ? { marketChannel: payload.marketChannel } : {}),
      lotId: lot.id,
      lotName: lot.name,
      locationId: location.id,
      locationName: location.name,
      bottles: payload.bottles,
      pricePerBottle: payload.pricePerBottle,
      currency: context.currency,
      revenue: financials.revenue,
      costPerBottle,
      cogs: financials.cogs,
      grossProfit: financials.grossProfit,
      marginPct: financials.marginPct,
      status: 'reserved',
      operator: payload.operator,
      ...(payload.notes ? { notes: payload.notes } : {}),
    }, timestamp);
    return {
      state: { ...currentState, salesOrders: [order, ...currentState.salesOrders] },
      result: {
        action: payload.action,
        order,
        receipt: {
          action: payload.action,
          lotId: lot.id,
          locationId: location.id,
          bottles: payload.bottles,
          customerName: payload.customerName,
          orderId: order.id,
        },
      },
    };
  }

  const records = createDispatchRecords({
    state: currentState,
    dispatchId: payload.dispatchId,
    date: payload.date,
    customerName: payload.customerName,
    marketChannel: payload.marketChannel,
    lot,
    location,
    bottles: payload.bottles,
    pricePerBottle: payload.pricePerBottle,
    costPerBottle,
    operator: payload.operator,
    notes: payload.notes,
    currency: context.currency,
    timestamp,
    commandId: context.commandId,
  });
  return {
    state: {
      ...currentState,
      stockMovements: [records.movement, ...currentState.stockMovements],
      salesDispatches: [records.dispatch, ...currentState.salesDispatches],
    },
    result: {
      action: payload.action,
      dispatch: records.dispatch,
      stockMovement: records.movement,
      receipt: {
        action: payload.action,
        lotId: lot.id,
        locationId: location.id,
        bottles: payload.bottles,
        customerName: payload.customerName,
        dispatchId: records.dispatch.id,
      },
    },
  };
}
