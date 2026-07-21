import { computeStock, type StockMovement, type StorageLocation } from '../storage';
import type {
  SalesDispatchRecord,
  SalesOrderRecord,
  WineLot,
} from '../wineryState';
import {
  REVERSAL_REASON_MAX_LENGTH,
  type CommandReversalReceipt,
  type CommandReversalReferencePayload,
} from './reversal';

export const SALES_STOCK_REVERSAL_COMMAND_TYPE = 'sales.stock.reverse' as const;

export interface SalesStockReversalCommandPayload extends CommandReversalReferencePayload {
  reversalDispatchId: string;
  returnMovementId: string;
}

export interface SalesStockReversalCommandState {
  lots: WineLot[];
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
  salesDispatches: SalesDispatchRecord[];
  salesOrders: SalesOrderRecord[];
}

export interface SalesStockReversalCommandContext {
  commandId: string;
  actorUsername: string;
  performedAt: Date;
}

export interface SalesStockReversalCommandResult {
  originalDispatch: SalesDispatchRecord;
  reversalDispatch: SalesDispatchRecord;
  returnMovement: StockMovement;
  changedOrder?: SalesOrderRecord;
  stateVersion?: number;
  receipt: CommandReversalReceipt & {
    kind: 'sales_stock_reversal';
    originalDispatchId: string;
    reversalDispatchId: string;
    returnMovementId: string;
    orderId?: string;
  };
}

export interface AppliedSalesStockReversalCommand {
  state: SalesStockReversalCommandState;
  result: SalesStockReversalCommandResult;
}

export type SalesStockReversalCommandErrorCode =
  | 'invalid_sales_stock_reversal_payload'
  | 'organization_state_not_found'
  | 'sales_dispatch_not_found'
  | 'sales_dispatch_not_command_created'
  | 'sales_dispatch_already_reversed'
  | 'sales_stock_reversal_dependency_conflict'
  | 'sales_stock_reversal_resource_missing'
  | 'sales_stock_reversal_capacity_exceeded'
  | 'sales_stock_reversal_id_conflict';

export class SalesStockReversalCommandError extends Error {
  constructor(
    public readonly code: SalesStockReversalCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SalesStockReversalCommandError';
  }
}

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new SalesStockReversalCommandError(
      'invalid_sales_stock_reversal_payload',
      `${field} must be 1-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
      400,
    );
  }
  return normalized;
}

function dependencyConflict(resource: string): never {
  throw new SalesStockReversalCommandError(
    'sales_stock_reversal_dependency_conflict',
    `${resource} changed after the original sale. Correct later dependent work before retrying this reversal.`,
    409,
  );
}

export function parseSalesStockReversalCommandPayload(value: unknown): SalesStockReversalCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SalesStockReversalCommandError(
      'invalid_sales_stock_reversal_payload',
      'Sales stock reversal payload must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > REVERSAL_REASON_MAX_LENGTH) {
    throw new SalesStockReversalCommandError(
      'invalid_sales_stock_reversal_payload',
      `reason is required and must not exceed ${REVERSAL_REASON_MAX_LENGTH} characters.`,
      400,
    );
  }
  return {
    reversalDispatchId: requiredRecordId(input.reversalDispatchId, 'reversalDispatchId'),
    returnMovementId: requiredRecordId(input.returnMovementId, 'returnMovementId'),
    originalCommandId: requiredRecordId(input.originalCommandId, 'originalCommandId'),
    reason,
  };
}

function assertState(state: SalesStockReversalCommandState): void {
  if (!state || !Array.isArray(state.lots) || !Array.isArray(state.storageLocations)
    || !Array.isArray(state.stockMovements) || !Array.isArray(state.salesDispatches)
    || !Array.isArray(state.salesOrders)) {
    throw new SalesStockReversalCommandError(
      'invalid_sales_stock_reversal_payload',
      'Organization sales stock state is unavailable.',
      400,
    );
  }
}

function requireOriginalMovement(
  state: SalesStockReversalCommandState,
  original: SalesDispatchRecord,
): StockMovement {
  const movement = state.stockMovements.find(item => item.id === original.stockMovementId);
  if (!movement) {
    throw new SalesStockReversalCommandError(
      'sales_stock_reversal_resource_missing',
      `Outbound movement ${original.stockMovementId} no longer exists.`,
      409,
    );
  }
  if (movement.direction !== 'out'
    || movement.reason !== 'sale'
    || movement.sourceRef !== original.id
    || movement.lotId !== original.lotId
    || movement.locationId !== original.locationId
    || movement.bottles !== original.bottles
    || (movement.commandId !== undefined && movement.commandId !== original.commandId)
    || (movement.lastModified !== undefined && movement.lastModified !== original.lastModified)) {
    dependencyConflict(`Outbound movement ${movement.id}`);
  }
  return movement;
}

function requireFulfilledOrder(
  state: SalesStockReversalCommandState,
  original: SalesDispatchRecord,
): SalesOrderRecord | undefined {
  if (!original.salesOrderId) return undefined;
  const order = state.salesOrders.find(item => item.id === original.salesOrderId);
  if (!order) {
    throw new SalesStockReversalCommandError(
      'sales_stock_reversal_resource_missing',
      `Fulfilled sales order ${original.salesOrderId} no longer exists.`,
      409,
    );
  }
  if (order.status !== 'fulfilled'
    || order.dispatchId !== original.id
    || order.lastCommandId !== original.commandId
    || order.lastModified !== original.lastModified
    || order.lotId !== original.lotId
    || order.locationId !== original.locationId
    || order.bottles !== original.bottles) {
    dependencyConflict(`Fulfilled sales order ${order.id}`);
  }
  return order;
}

export function applySalesStockReversalCommand(
  currentState: SalesStockReversalCommandState,
  rawPayload: unknown,
  context: SalesStockReversalCommandContext,
): AppliedSalesStockReversalCommand {
  const payload = parseSalesStockReversalCommandPayload(rawPayload);
  assertState(currentState);
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new SalesStockReversalCommandError(
      'invalid_sales_stock_reversal_payload',
      'Sales stock reversal execution time is invalid.',
      400,
    );
  }
  if (currentState.salesDispatches.some(item => item.id === payload.reversalDispatchId)
    || currentState.stockMovements.some(item => item.id === payload.returnMovementId)) {
    throw new SalesStockReversalCommandError(
      'sales_stock_reversal_id_conflict',
      'A sales reversal record id already exists.',
      409,
    );
  }

  const original = currentState.salesDispatches.find(item => (
    item.recordKind !== 'reversal' && item.commandId === payload.originalCommandId
  ));
  if (!original) {
    const legacy = currentState.salesDispatches.find(item => item.id === payload.originalCommandId);
    throw new SalesStockReversalCommandError(
      legacy ? 'sales_dispatch_not_command_created' : 'sales_dispatch_not_found',
      legacy
        ? 'Legacy dispatches without durable command provenance cannot be reversed safely.'
        : 'The original sales dispatch command was not found in this organization.',
      legacy ? 409 : 404,
    );
  }
  if (!original.commandId || !original.lastModified) {
    throw new SalesStockReversalCommandError(
      'sales_dispatch_not_command_created',
      'The sales dispatch does not contain complete durable command provenance.',
      409,
    );
  }
  if (original.reversedByCommandId || original.reversedAt
    || currentState.salesDispatches.some(item => item.reversalOfDispatchId === original.id)
    || currentState.stockMovements.some(item => item.reversalOfMovementId === original.stockMovementId)) {
    throw new SalesStockReversalCommandError(
      'sales_dispatch_already_reversed',
      'The original sales dispatch has already been reversed.',
      409,
    );
  }
  if (!Number.isSafeInteger(original.bottles) || original.bottles <= 0) {
    dependencyConflict(`Sales dispatch ${original.id}`);
  }

  const lot = currentState.lots.find(item => item.id === original.lotId);
  const location = currentState.storageLocations.find(item => item.id === original.locationId);
  if (!lot || !location) {
    throw new SalesStockReversalCommandError(
      'sales_stock_reversal_resource_missing',
      `${!lot ? 'Lot' : 'Storage location'} for dispatch ${original.id} no longer exists.`,
      409,
    );
  }
  const originalMovement = requireOriginalMovement(currentState, original);
  const fulfilledOrder = requireFulfilledOrder(currentState, original);
  const locationStock = computeStock(currentState.stockMovements).get(location.id);
  const currentTotal = locationStock?.totalBottles || 0;
  const currentLotStock = locationStock?.byLot[lot.id] || 0;
  if (!Number.isFinite(currentTotal) || currentTotal < 0
    || !Number.isFinite(currentLotStock) || currentLotStock < 0) {
    dependencyConflict(`Storage balance for ${lot.id} at ${location.id}`);
  }
  if (location.capacityBottles && location.capacityBottles > 0
    && currentTotal + original.bottles > location.capacityBottles) {
    throw new SalesStockReversalCommandError(
      'sales_stock_reversal_capacity_exceeded',
      `Returning ${original.bottles} bottles would exceed ${location.name}'s capacity by ${currentTotal + original.bottles - location.capacityBottles}.`,
      409,
    );
  }

  const timestamp = context.performedAt.toISOString();
  const operationDate = timestamp.slice(0, 10);
  const updatedOriginal: SalesDispatchRecord = {
    ...original,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastModified: timestamp,
  };
  const returnMovement: StockMovement = {
    id: payload.returnMovementId,
    commandId: context.commandId,
    lastModified: timestamp,
    date: operationDate,
    lotId: original.lotId,
    locationId: original.locationId,
    direction: 'in',
    bottles: original.bottles,
    reason: 'sale_reversal',
    sourceRef: payload.reversalDispatchId,
    reversalOfMovementId: originalMovement.id,
    reversalOfCommandId: original.commandId,
    note: `Returned stock for reversed dispatch ${original.id}: ${payload.reason}`,
  };
  const {
    id: _originalId,
    commandId: _originalCommandId,
    recordKind: _originalRecordKind,
    lastModified: _originalLastModified,
    date: _originalDate,
    stockMovementId: _originalStockMovementId,
    salesOrderId: _originalSalesOrderId,
    reversalOfDispatchId: _originalReversalOfDispatchId,
    reversalOfCommandId: _originalReversalOfCommandId,
    reversedByCommandId: _originalReversedByCommandId,
    reversedAt: _originalReversedAt,
    reversalReason: _originalReversalReason,
    operator: _originalOperator,
    notes: _originalNotes,
    ...originalDispatchFacts
  } = original;
  const reversalDispatch: SalesDispatchRecord = {
    ...originalDispatchFacts,
    id: payload.reversalDispatchId,
    commandId: context.commandId,
    recordKind: 'reversal',
    lastModified: timestamp,
    date: operationDate,
    stockMovementId: returnMovement.id,
    reversalOfDispatchId: original.id,
    reversalOfCommandId: original.commandId,
    reversalReason: payload.reason,
    operator: context.actorUsername,
    notes: `Reversal of dispatch ${original.id}: ${payload.reason}`,
  };
  const changedOrder = fulfilledOrder ? {
    ...fulfilledOrder,
    status: 'cancelled' as const,
    cancelledAt: timestamp,
    cancelledBy: context.actorUsername,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastCommandId: context.commandId,
    lastModified: timestamp,
  } : undefined;

  return {
    state: {
      ...currentState,
      stockMovements: [returnMovement, ...currentState.stockMovements],
      salesDispatches: [
        reversalDispatch,
        updatedOriginal,
        ...currentState.salesDispatches.filter(item => item.id !== original.id),
      ],
      salesOrders: changedOrder
        ? currentState.salesOrders.map(item => item.id === changedOrder.id ? changedOrder : item)
        : currentState.salesOrders,
    },
    result: {
      originalDispatch: updatedOriginal,
      reversalDispatch,
      returnMovement,
      ...(changedOrder ? { changedOrder } : {}),
      receipt: {
        kind: 'sales_stock_reversal',
        originalCommandId: original.commandId,
        reversalCommandId: context.commandId,
        originalDispatchId: original.id,
        reversalDispatchId: reversalDispatch.id,
        returnMovementId: returnMovement.id,
        ...(changedOrder ? { orderId: changedOrder.id } : {}),
        reason: payload.reason,
        reversedAt: timestamp,
      },
    },
  };
}
