import type {
  BottlingRunRecord,
  SalesOrderRecord,
  WineLot,
} from '../wineryState';
import {
  computeStock,
  isFinishedGoodsLot,
  lotTotalStored,
  unstored,
  type StockMovement,
  type StorageLocation,
} from '../storage';
import { stockAvailabilityPosition } from '../sales';
import { isActiveBottlingRun } from '../bottlingIntegrity';

export const STORAGE_MOVEMENT_COMMAND_TYPE = 'storage.movement' as const;

const RECORD_ID_PATTERN = /^[\p{L}\p{N}._:-]{1,128}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BOTTLES = 1_000_000_000;

interface StorageMovementBasePayload {
  action: 'receive' | 'relocate' | 'adjust';
  date: string;
  lotId: string;
  bottles: number;
  note: string;
}

export interface ReceiveStorageMovementPayload extends StorageMovementBasePayload {
  action: 'receive';
  movementId: string;
  bottlingRunId: string;
  locationId: string;
}

export interface RelocateStorageMovementPayload extends StorageMovementBasePayload {
  action: 'relocate';
  sourceMovementId: string;
  destinationMovementId: string;
  sourceLocationId: string;
  destinationLocationId: string;
}

export interface AdjustStorageMovementPayload extends StorageMovementBasePayload {
  action: 'adjust';
  movementId: string;
  locationId: string;
  direction: 'in' | 'out';
  adjustmentReason: string;
}

export type StorageMovementCommandPayload =
  | ReceiveStorageMovementPayload
  | RelocateStorageMovementPayload
  | AdjustStorageMovementPayload;

export interface StorageMovementCommandContext {
  commandId: string;
  actorUsername: string;
  performedAt: Date;
}

export interface StorageMovementCommandState {
  lots: WineLot[];
  bottlingRuns: BottlingRunRecord[];
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
  salesOrders: SalesOrderRecord[];
}

export interface StorageMovementCommandResult {
  movements: StockMovement[];
  updatedBottlingRun?: BottlingRunRecord;
  stateVersion?: number;
  receipt: {
    action: StorageMovementCommandPayload['action'];
    lotId: string;
    bottles: number;
    sourceLocationId?: string;
    destinationLocationId?: string;
    sourceOnHandBefore?: number;
    sourceOnHandAfter?: number;
    destinationOnHandBefore?: number;
    destinationOnHandAfter?: number;
    remainingRunUnits?: number;
  };
}

export interface AppliedStorageMovementCommand {
  state: StorageMovementCommandState;
  result: StorageMovementCommandResult;
}

export type StorageMovementCommandErrorCode =
  | 'invalid_storage_movement_payload'
  | 'organization_state_not_found'
  | 'storage_movement_state_inconsistent'
  | 'storage_movement_id_conflict'
  | 'storage_lot_not_found'
  | 'storage_lot_not_finished_goods'
  | 'storage_location_not_found'
  | 'storage_same_location'
  | 'storage_capacity_exceeded'
  | 'storage_bottling_run_not_found'
  | 'storage_bottling_run_mismatch'
  | 'storage_bottling_run_fully_placed'
  | 'storage_production_exceeded'
  | 'insufficient_unreserved_stock';

export class StorageMovementCommandError extends Error {
  constructor(
    public readonly code: StorageMovementCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'StorageMovementCommandError';
  }
}

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new StorageMovementCommandError(
      'invalid_storage_movement_payload',
      `${field} must be 1-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
      400,
    );
  }
  return normalized;
}

function boundedText(value: unknown, field: string, maxLength: number, required = false): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if ((required && !normalized) || normalized.length > maxLength) {
    throw new StorageMovementCommandError(
      'invalid_storage_movement_payload',
      `${field}${required ? ' is required and' : ''} must not exceed ${maxLength} characters.`,
      400,
    );
  }
  return normalized;
}

function validDate(value: unknown): string {
  const date = typeof value === 'string' ? value.trim() : '';
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new StorageMovementCommandError(
      'invalid_storage_movement_payload',
      'date must be a valid calendar date in YYYY-MM-DD format.',
      400,
    );
  }
  return date;
}

function wholeBottles(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > MAX_BOTTLES) {
    throw new StorageMovementCommandError(
      'invalid_storage_movement_payload',
      `bottles must be a positive whole number no greater than ${MAX_BOTTLES}.`,
      400,
    );
  }
  return value;
}

export function parseStorageMovementCommandPayload(value: unknown): StorageMovementCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StorageMovementCommandError(
      'invalid_storage_movement_payload',
      'Storage movement payload must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  const action = input.action;
  if (action !== 'receive' && action !== 'relocate' && action !== 'adjust') {
    throw new StorageMovementCommandError(
      'invalid_storage_movement_payload',
      'action must be receive, relocate, or adjust.',
      400,
    );
  }
  const common = {
    action,
    date: validDate(input.date),
    lotId: requiredRecordId(input.lotId, 'lotId'),
    bottles: wholeBottles(input.bottles),
    note: boundedText(input.note, 'note', 500),
  };
  if (action === 'receive') {
    return {
      ...common,
      action,
      movementId: requiredRecordId(input.movementId, 'movementId'),
      bottlingRunId: requiredRecordId(input.bottlingRunId, 'bottlingRunId'),
      locationId: requiredRecordId(input.locationId, 'locationId'),
    };
  }
  if (action === 'relocate') {
    return {
      ...common,
      action,
      sourceMovementId: requiredRecordId(input.sourceMovementId, 'sourceMovementId'),
      destinationMovementId: requiredRecordId(input.destinationMovementId, 'destinationMovementId'),
      sourceLocationId: requiredRecordId(input.sourceLocationId, 'sourceLocationId'),
      destinationLocationId: requiredRecordId(input.destinationLocationId, 'destinationLocationId'),
    };
  }
  const direction = input.direction;
  if (direction !== 'in' && direction !== 'out') {
    throw new StorageMovementCommandError(
      'invalid_storage_movement_payload',
      'direction must be in or out for an adjustment.',
      400,
    );
  }
  return {
    ...common,
    action,
    movementId: requiredRecordId(input.movementId, 'movementId'),
    locationId: requiredRecordId(input.locationId, 'locationId'),
    direction,
    adjustmentReason: boundedText(input.adjustmentReason, 'adjustmentReason', 200, true),
  };
}

function runUnits(run: Pick<BottlingRunRecord, 'totalBottles' | 'totalCeramic'>): number {
  return (run.totalBottles || 0) + (run.totalCeramic || 0);
}

export function bottlingRunPlacedUnits(
  run: Pick<BottlingRunRecord, 'id'>,
  movements: StockMovement[],
): number {
  return movements.reduce((total, movement) => (
    movement.direction === 'in'
      && movement.sourceRef === run.id
      && (movement.reason === 'bottling' || movement.reason === 'receive')
      ? total + movement.bottles
      : total
  ), 0);
}

export function bottlingRunUnplacedUnits(
  run: Pick<BottlingRunRecord,
    'id' | 'totalBottles' | 'totalCeramic' | 'recordKind' | 'reversedByCommandId' | 'reversedAt'>,
  movements: StockMovement[],
): number {
  if (!isActiveBottlingRun(run)) return 0;
  return Math.max(0, runUnits(run) - bottlingRunPlacedUnits(run, movements));
}

function ensureCapacity(
  location: StorageLocation,
  currentStored: number,
  bottles: number,
): void {
  if (!Number.isFinite(currentStored) || currentStored < 0) {
    throw new StorageMovementCommandError(
      'storage_movement_state_inconsistent',
      `${location.name} has an invalid stored balance.`,
      409,
    );
  }
  if (location.capacityBottles !== undefined
    && (!Number.isSafeInteger(location.capacityBottles) || location.capacityBottles <= 0)) {
    throw new StorageMovementCommandError(
      'storage_movement_state_inconsistent',
      `${location.name} has an invalid bottle capacity.`,
      409,
    );
  }
  if (location.capacityBottles && currentStored + bottles > location.capacityBottles) {
    throw new StorageMovementCommandError(
      'storage_capacity_exceeded',
      `${location.name} has only ${Math.max(0, location.capacityBottles - currentStored)} bottle spaces available.`,
      409,
    );
  }
}

function stampMovement(
  movement: Omit<StockMovement, 'commandId' | 'lastModified'>,
  context: StorageMovementCommandContext,
): StockMovement {
  return {
    ...movement,
    commandId: context.commandId,
    lastModified: context.performedAt.toISOString(),
  };
}

export function applyStorageMovementCommand(
  currentState: StorageMovementCommandState,
  rawPayload: unknown,
  context: StorageMovementCommandContext,
): AppliedStorageMovementCommand {
  const payload = parseStorageMovementCommandPayload(rawPayload);
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new StorageMovementCommandError(
      'invalid_storage_movement_payload',
      'Storage movement execution time is invalid.',
      400,
    );
  }
  if (!currentState || !Array.isArray(currentState.lots) || !Array.isArray(currentState.bottlingRuns)
    || !Array.isArray(currentState.storageLocations) || !Array.isArray(currentState.stockMovements)
    || !Array.isArray(currentState.salesOrders)) {
    throw new StorageMovementCommandError(
      'storage_movement_state_inconsistent',
      'Organization storage state is unavailable.',
      400,
    );
  }

  const lot = currentState.lots.find(item => item.id === payload.lotId);
  if (!lot) throw new StorageMovementCommandError('storage_lot_not_found', 'The wine lot was not found.', 404);
  if (!isFinishedGoodsLot(lot, currentState.bottlingRuns)) {
    throw new StorageMovementCommandError(
      'storage_lot_not_finished_goods',
      'Storage movements require bottled wine with bottling provenance.',
      409,
    );
  }

  const locationById = new Map(currentState.storageLocations.map(location => [location.id, location]));
  const stock = computeStock(currentState.stockMovements);
  const movementIds = payload.action === 'relocate'
    ? [payload.sourceMovementId, payload.destinationMovementId]
    : [payload.movementId];
  if (new Set(movementIds).size !== movementIds.length
    || movementIds.some(id => currentState.stockMovements.some(movement => movement.id === id))) {
    throw new StorageMovementCommandError(
      'storage_movement_id_conflict',
      'A generated storage movement id already exists.',
      409,
    );
  }

  const asOfDate = context.performedAt.toISOString().slice(0, 10);
  const timestamp = context.performedAt.toISOString();
  let movements: StockMovement[] = [];
  let updatedBottlingRun: BottlingRunRecord | undefined;
  let receipt: StorageMovementCommandResult['receipt'];

  if (payload.action === 'receive') {
    const location = locationById.get(payload.locationId);
    if (!location) throw new StorageMovementCommandError('storage_location_not_found', 'The storage location was not found.', 404);
    const run = currentState.bottlingRuns.find(item => item.id === payload.bottlingRunId);
    if (!run) {
      throw new StorageMovementCommandError('storage_bottling_run_not_found', 'The bottling run was not found.', 404);
    }
    if (run.lotId !== lot.id) {
      throw new StorageMovementCommandError(
        'storage_bottling_run_mismatch',
        'The bottling run belongs to a different wine lot.',
        409,
      );
    }
    if (!isActiveBottlingRun(run)) {
      throw new StorageMovementCommandError(
        'storage_bottling_run_fully_placed',
        'Reversed bottling runs cannot be received into storage.',
        409,
      );
    }
    const remainingBefore = bottlingRunUnplacedUnits(run, currentState.stockMovements);
    if (remainingBefore <= 0 || payload.bottles > remainingBefore) {
      throw new StorageMovementCommandError(
        'storage_bottling_run_fully_placed',
        `The bottling run has only ${remainingBefore} unplaced units.`,
        409,
      );
    }
    const lotProduced = currentState.bottlingRuns
      .filter(item => item.lotId === lot.id && isActiveBottlingRun(item))
      .reduce((total, item) => total + runUnits(item), 0);
    const lotRemaining = unstored({ [lot.id]: lotProduced }, currentState.stockMovements)[lot.id] || 0;
    if (payload.bottles > lotRemaining) {
      throw new StorageMovementCommandError(
        'storage_production_exceeded',
        `The lot has only ${lotRemaining} unplaced bottled units.`,
        409,
      );
    }
    const destinationBefore = stock.get(location.id)?.byLot[lot.id] || 0;
    ensureCapacity(location, stock.get(location.id)?.totalBottles || 0, payload.bottles);
    const movement = stampMovement({
      id: payload.movementId,
      date: payload.date,
      lotId: lot.id,
      locationId: location.id,
      direction: 'in',
      bottles: payload.bottles,
      reason: 'receive',
      sourceRef: run.id,
      note: payload.note || `Placed from bottling run ${run.id}`,
    }, context);
    movements = [movement];
    const placement = {
      movementId: movement.id,
      locationId: location.id,
      bottles: movement.bottles,
      date: movement.date,
      commandId: context.commandId,
    };
    updatedBottlingRun = {
      ...run,
      lastModified: timestamp,
      storagePlacements: [...(run.storagePlacements || []), placement],
      placedInStorageBottles: bottlingRunPlacedUnits(run, currentState.stockMovements) + movement.bottles,
    };
    receipt = {
      action: payload.action,
      lotId: lot.id,
      bottles: payload.bottles,
      destinationLocationId: location.id,
      destinationOnHandBefore: destinationBefore,
      destinationOnHandAfter: destinationBefore + payload.bottles,
      remainingRunUnits: remainingBefore - payload.bottles,
    };
  } else if (payload.action === 'relocate') {
    const source = locationById.get(payload.sourceLocationId);
    const destination = locationById.get(payload.destinationLocationId);
    if (!source || !destination) {
      throw new StorageMovementCommandError('storage_location_not_found', 'A storage location was not found.', 404);
    }
    if (source.id === destination.id) {
      throw new StorageMovementCommandError(
        'storage_same_location',
        'Source and destination storage locations must be different.',
        409,
      );
    }
    const sourceBefore = stock.get(source.id)?.byLot[lot.id] || 0;
    const position = stockAvailabilityPosition({
      onHandBottles: sourceBefore,
      orders: currentState.salesOrders,
      locationId: source.id,
      lotId: lot.id,
      asOfDate,
    });
    if (payload.bottles > position.availableBottles) {
      throw new StorageMovementCommandError(
        'insufficient_unreserved_stock',
        `${source.name} has only ${position.availableBottles} unreserved bottles available.`,
        409,
      );
    }
    const destinationBefore = stock.get(destination.id)?.byLot[lot.id] || 0;
    ensureCapacity(destination, stock.get(destination.id)?.totalBottles || 0, payload.bottles);
    const sourceMovement = stampMovement({
      id: payload.sourceMovementId,
      date: payload.date,
      lotId: lot.id,
      locationId: source.id,
      direction: 'out',
      bottles: payload.bottles,
      reason: 'transfer',
      sourceRef: context.commandId,
      relatedMovementId: payload.destinationMovementId,
      note: payload.note || `Relocated to ${destination.name}`,
    }, context);
    const destinationMovement = stampMovement({
      id: payload.destinationMovementId,
      date: payload.date,
      lotId: lot.id,
      locationId: destination.id,
      direction: 'in',
      bottles: payload.bottles,
      reason: 'transfer',
      sourceRef: context.commandId,
      relatedMovementId: payload.sourceMovementId,
      note: payload.note || `Relocated from ${source.name}`,
    }, context);
    movements = [sourceMovement, destinationMovement];
    receipt = {
      action: payload.action,
      lotId: lot.id,
      bottles: payload.bottles,
      sourceLocationId: source.id,
      destinationLocationId: destination.id,
      sourceOnHandBefore: sourceBefore,
      sourceOnHandAfter: sourceBefore - payload.bottles,
      destinationOnHandBefore: destinationBefore,
      destinationOnHandAfter: destinationBefore + payload.bottles,
    };
  } else {
    const location = locationById.get(payload.locationId);
    if (!location) throw new StorageMovementCommandError('storage_location_not_found', 'The storage location was not found.', 404);
    const before = stock.get(location.id)?.byLot[lot.id] || 0;
    if (payload.direction === 'out') {
      const position = stockAvailabilityPosition({
        onHandBottles: before,
        orders: currentState.salesOrders,
        locationId: location.id,
        lotId: lot.id,
        asOfDate,
      });
      if (payload.bottles > position.availableBottles) {
        throw new StorageMovementCommandError(
          'insufficient_unreserved_stock',
          `${location.name} has only ${position.availableBottles} unreserved bottles available.`,
          409,
        );
      }
    } else {
      ensureCapacity(location, stock.get(location.id)?.totalBottles || 0, payload.bottles);
      const produced = currentState.bottlingRuns
        .filter(run => run.lotId === lot.id && isActiveBottlingRun(run))
        .reduce((total, run) => total + runUnits(run), 0);
      const onHand = lotTotalStored(currentState.stockMovements, lot.id);
      if (onHand + payload.bottles > produced) {
        throw new StorageMovementCommandError(
          'storage_production_exceeded',
          `The adjustment would exceed the lot's ${produced} bottled units.`,
          409,
        );
      }
    }
    const movement = stampMovement({
      id: payload.movementId,
      date: payload.date,
      lotId: lot.id,
      locationId: location.id,
      direction: payload.direction,
      bottles: payload.bottles,
      reason: 'adjustment',
      note: payload.note
        ? `${payload.adjustmentReason}: ${payload.note}`
        : payload.adjustmentReason,
    }, context);
    movements = [movement];
    const after = before + (payload.direction === 'in' ? payload.bottles : -payload.bottles);
    receipt = {
      action: payload.action,
      lotId: lot.id,
      bottles: payload.bottles,
      ...(payload.direction === 'out'
        ? {
          sourceLocationId: location.id,
          sourceOnHandBefore: before,
          sourceOnHandAfter: after,
        }
        : {
          destinationLocationId: location.id,
          destinationOnHandBefore: before,
          destinationOnHandAfter: after,
        }),
    };
  }

  const nextBottlingRuns = updatedBottlingRun
    ? currentState.bottlingRuns.map(run => run.id === updatedBottlingRun?.id ? updatedBottlingRun : run)
    : currentState.bottlingRuns;
  return {
    state: {
      ...currentState,
      bottlingRuns: nextBottlingRuns,
      stockMovements: [...movements, ...currentState.stockMovements],
    },
    result: {
      movements,
      ...(updatedBottlingRun ? { updatedBottlingRun } : {}),
      receipt,
    },
  };
}
