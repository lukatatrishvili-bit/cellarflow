import type { CostEntry } from '../costing';
import { isActiveBottlingRun, newerBottlingRunFor } from '../bottlingIntegrity';
import { computeStock, type StockMovement, type StorageLocation } from '../storage';
import type {
  BottlingRunRecord,
  CertificationRecord,
  InventoryItem,
  SalesDispatchRecord,
  SalesOrderRecord,
  Vessel,
  WineLot,
} from '../wineryState';
import {
  REVERSAL_REASON_MAX_LENGTH,
  type CommandReversalReceipt,
  type CommandReversalReferencePayload,
} from './reversal';

export const BOTTLING_REVERSAL_COMMAND_TYPE = 'cellar.bottling.reverse' as const;

export interface BottlingReversalCommandPayload extends CommandReversalReferencePayload {
  reversalRunId: string;
  storageReturnMovementId: string;
  packagingCostReversalId: string;
  serviceCostReversalId: string;
}

export interface BottlingReversalCommandState {
  lots: WineLot[];
  vessels: Vessel[];
  bottlingRuns: BottlingRunRecord[];
  inventory: InventoryItem[];
  costEntries: CostEntry[];
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
  salesOrders: SalesOrderRecord[];
  salesDispatches: SalesDispatchRecord[];
  certificationRecords: CertificationRecord[];
}

export interface BottlingReversalCommandContext {
  commandId: string;
  actorUsername: string;
  performedAt: Date;
}

export interface BottlingReversalCommandResult {
  originalRun: BottlingRunRecord;
  reversalRun: BottlingRunRecord;
  updatedLot: WineLot;
  updatedVessel?: Vessel;
  updatedInventoryItems: InventoryItem[];
  reversalCostEntries: CostEntry[];
  updatedOriginalCostEntries: CostEntry[];
  storageReturnMovement?: StockMovement;
  stateVersion?: number;
  receipt: CommandReversalReceipt & {
    kind: 'bottling_reversal';
    originalRunId: string;
    reversalRunId: string;
    restoredVolumeL: number;
    restoredPackagingUnits: number;
    reversedCostAmount: number;
    storageReturnMovementId?: string;
  };
}

export interface AppliedBottlingReversalCommand {
  state: BottlingReversalCommandState;
  result: BottlingReversalCommandResult;
}

export type BottlingReversalCommandErrorCode =
  | 'invalid_bottling_reversal_payload'
  | 'organization_state_not_found'
  | 'bottling_run_not_found'
  | 'bottling_run_not_command_created'
  | 'bottling_run_already_reversed'
  | 'bottling_reversal_snapshot_missing'
  | 'bottling_reversal_dependency_conflict'
  | 'bottling_reversal_resource_missing'
  | 'bottling_reversal_id_conflict';

export class BottlingReversalCommandError extends Error {
  constructor(
    public readonly code: BottlingReversalCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'BottlingReversalCommandError';
  }
}

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EPSILON = 0.000_001;

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new BottlingReversalCommandError(
      'invalid_bottling_reversal_payload',
      `${field} must be 1-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
      400,
    );
  }
  return normalized;
}

function dependencyConflict(resource: string): never {
  throw new BottlingReversalCommandError(
    'bottling_reversal_dependency_conflict',
    `${resource} changed after the original bottling run. Correct later dependent work before retrying this reversal.`,
    409,
  );
}

function sameNumber(actual: unknown, expected: number): boolean {
  return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= EPSILON;
}

function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function parseBottlingReversalCommandPayload(value: unknown): BottlingReversalCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BottlingReversalCommandError(
      'invalid_bottling_reversal_payload',
      'Bottling reversal payload must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > REVERSAL_REASON_MAX_LENGTH) {
    throw new BottlingReversalCommandError(
      'invalid_bottling_reversal_payload',
      `reason is required and must not exceed ${REVERSAL_REASON_MAX_LENGTH} characters.`,
      400,
    );
  }
  return {
    reversalRunId: requiredRecordId(input.reversalRunId, 'reversalRunId'),
    storageReturnMovementId: requiredRecordId(input.storageReturnMovementId, 'storageReturnMovementId'),
    packagingCostReversalId: requiredRecordId(input.packagingCostReversalId, 'packagingCostReversalId'),
    serviceCostReversalId: requiredRecordId(input.serviceCostReversalId, 'serviceCostReversalId'),
    originalCommandId: requiredRecordId(input.originalCommandId, 'originalCommandId'),
    reason,
  };
}

function assertState(state: BottlingReversalCommandState): void {
  if (!state || !Array.isArray(state.lots) || !Array.isArray(state.vessels) || !Array.isArray(state.bottlingRuns)
    || !Array.isArray(state.inventory) || !Array.isArray(state.costEntries)
    || !Array.isArray(state.storageLocations) || !Array.isArray(state.stockMovements)
    || !Array.isArray(state.salesOrders) || !Array.isArray(state.salesDispatches)
    || !Array.isArray(state.certificationRecords)) {
    throw new BottlingReversalCommandError(
      'invalid_bottling_reversal_payload',
      'Organization bottling state is unavailable.',
      400,
    );
  }
}

function requireOriginalCosts(
  state: BottlingReversalCommandState,
  original: BottlingRunRecord,
): CostEntry[] {
  const linked = state.costEntries.filter(entry => (
    entry.sourceRef === original.id && entry.recordKind !== 'reversal'
  ));
  const expected: Array<{ category: CostEntry['category']; amount: number }> = [];
  if ((original.packagingCostTotal || 0) > 0) {
    expected.push({ category: 'packaging', amount: original.packagingCostTotal || 0 });
  }
  if ((original.bottlingServiceCost || 0) > 0) {
    expected.push({ category: 'bottling', amount: original.bottlingServiceCost || 0 });
  }
  if (linked.length !== expected.length) dependencyConflict(`Cost ledger for run ${original.id}`);
  const matched = expected.map(item => {
    const entries = linked.filter(entry => entry.category === item.category && sameNumber(entry.amount, item.amount));
    if (entries.length !== 1) dependencyConflict(`${item.category} cost for run ${original.id}`);
    const entry = entries[0];
    if (entry.lastModified !== original.createdAt
      || (entry.commandId !== undefined && entry.commandId !== original.commandId)
      || entry.reversedByCommandId || entry.reversedAt) {
      dependencyConflict(`Cost entry ${entry.id}`);
    }
    return entry;
  });
  return matched;
}

function hasLaterMovement(movement: StockMovement, original: BottlingRunRecord): boolean {
  if (movement.id === original.storageMovementId) return false;
  const originalTime = Date.parse(original.createdAt || '');
  const movementTime = Date.parse(movement.lastModified || '');
  if (Number.isFinite(originalTime) && Number.isFinite(movementTime) && movementTime > originalTime) return true;
  return movement.date > original.date;
}

export function applyBottlingReversalCommand(
  currentState: BottlingReversalCommandState,
  rawPayload: unknown,
  context: BottlingReversalCommandContext,
): AppliedBottlingReversalCommand {
  const payload = parseBottlingReversalCommandPayload(rawPayload);
  assertState(currentState);
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new BottlingReversalCommandError(
      'invalid_bottling_reversal_payload',
      'Bottling reversal execution time is invalid.',
      400,
    );
  }
  if (currentState.bottlingRuns.some(run => run.id === payload.reversalRunId)
    || currentState.stockMovements.some(movement => movement.id === payload.storageReturnMovementId)
    || currentState.costEntries.some(entry => (
      entry.id === payload.packagingCostReversalId || entry.id === payload.serviceCostReversalId
    ))) {
    throw new BottlingReversalCommandError(
      'bottling_reversal_id_conflict',
      'A bottling reversal record id already exists.',
      409,
    );
  }

  const original = currentState.bottlingRuns.find(run => (
    run.recordKind !== 'reversal' && run.commandId === payload.originalCommandId
  ));
  if (!original) {
    const legacy = currentState.bottlingRuns.find(run => run.id === payload.originalCommandId);
    throw new BottlingReversalCommandError(
      legacy ? 'bottling_run_not_command_created' : 'bottling_run_not_found',
      legacy
        ? 'Legacy bottling runs without durable command provenance cannot be reversed safely.'
        : 'The original bottling command was not found in this organization.',
      legacy ? 409 : 404,
    );
  }
  if (!original.commandId || !original.createdAt || !original.lastModified) {
    throw new BottlingReversalCommandError(
      'bottling_run_not_command_created',
      'The bottling run does not contain complete durable command provenance.',
      409,
    );
  }
  if (original.reversedByCommandId || original.reversedAt
    || currentState.bottlingRuns.some(run => run.reversalOfRunId === original.id)) {
    throw new BottlingReversalCommandError(
      'bottling_run_already_reversed',
      'The original bottling run has already been reversed.',
      409,
    );
  }
  if (original.previousLotVolumeL === undefined || original.previousLotStage === undefined
    || !Number.isFinite(original.previousLotVolumeL) || original.previousLotVolumeL < 0) {
    throw new BottlingReversalCommandError(
      'bottling_reversal_snapshot_missing',
      'This bottling run predates complete restoration metadata and cannot be compensated safely.',
      409,
    );
  }
  if (original.lastModified !== original.createdAt || !isActiveBottlingRun(original)) {
    dependencyConflict(`Bottling run ${original.id}`);
  }
  const newerRun = newerBottlingRunFor(currentState.bottlingRuns, original.id);
  if (newerRun) dependencyConflict(`Newer bottling run ${newerRun.id}`);
  if (currentState.certificationRecords.some(record => record.bottlingRunId === original.id)) {
    dependencyConflict(`Certification linked to run ${original.id}`);
  }
  if (currentState.salesOrders.some(order => (
    order.lotId === original.lotId && order.status === 'reserved'
  ))) {
    dependencyConflict(`Reserved sales stock for lot ${original.lotId}`);
  }
  if (currentState.salesDispatches.some(dispatch => {
    if (dispatch.lotId !== original.lotId || dispatch.recordKind === 'reversal'
      || dispatch.reversedByCommandId || dispatch.reversedAt) return false;
    const originalTime = Date.parse(original.createdAt || '');
    const dispatchTime = Date.parse(dispatch.lastModified || '');
    return (Number.isFinite(originalTime) && Number.isFinite(dispatchTime) && dispatchTime > originalTime)
      || dispatch.date > original.date;
  })) {
    dependencyConflict(`Sales dispatch for lot ${original.lotId}`);
  }
  if (currentState.stockMovements.some(movement => (
    movement.lotId === original.lotId && hasLaterMovement(movement, original)
  ))) {
    dependencyConflict(`Finished-goods movement for lot ${original.lotId}`);
  }

  const lot = currentState.lots.find(item => item.id === original.lotId);
  if (!lot) {
    throw new BottlingReversalCommandError(
      'bottling_reversal_resource_missing',
      `Wine lot ${original.lotId} no longer exists.`,
      409,
    );
  }
  const expectedVolume = Math.max(0, round1(original.previousLotVolumeL - original.volumeBottledL));
  const expectedStage = expectedVolume <= EPSILON ? 'bottled' : original.previousLotStage;
  if (!sameNumber(lot.currentVolume, expectedVolume) || lot.stage !== expectedStage
    || lot.lastModified !== original.createdAt
    || (lot.lastCommandId !== undefined && lot.lastCommandId !== original.commandId)
    || lot.history?.[0]?.sourceRef !== original.id || lot.history?.[0]?.type !== 'bottling') {
    dependencyConflict(`Wine lot ${lot.id}`);
  }

  let sourceVessel: Vessel | undefined;
  if (original.sourceVesselId) {
    if (original.previousSourceVesselVolumeL === undefined
      || original.previousSourceVesselAssignedLotId === undefined
      || original.previousSourceVesselCleaningStatus === undefined
      || original.previousSourceVesselLastOperation === undefined
      || !Number.isFinite(original.previousSourceVesselVolumeL)
      || original.previousSourceVesselVolumeL < 0) {
      throw new BottlingReversalCommandError(
        'bottling_reversal_snapshot_missing',
        'The bottling run does not contain a complete source-vessel restoration snapshot.',
        409,
      );
    }
    sourceVessel = currentState.vessels.find(vessel => vessel.id === original.sourceVesselId);
    if (!sourceVessel) {
      throw new BottlingReversalCommandError(
        'bottling_reversal_resource_missing',
        `Source vessel ${original.sourceVesselId} no longer exists.`,
        409,
      );
    }
    const expectedVesselVolume = Math.max(0, round1(original.previousSourceVesselVolumeL - original.volumeBottledL));
    const expectedAssignedLotId = expectedVesselVolume <= EPSILON
      ? null
      : original.previousSourceVesselAssignedLotId;
    const expectedCleaningStatus = expectedVesselVolume <= EPSILON
      ? 'cleaning_needed'
      : original.previousSourceVesselCleaningStatus;
    if (!sameNumber(sourceVessel.currentVolume, expectedVesselVolume)
      || sourceVessel.assignedLotId !== expectedAssignedLotId
      || sourceVessel.cleaningStatus !== expectedCleaningStatus
      || sourceVessel.lastModified !== original.createdAt
      || (sourceVessel.lastCommandId !== undefined && sourceVessel.lastCommandId !== original.commandId)) {
      dependencyConflict(`Source vessel ${sourceVessel.id}`);
    }
  }

  const deductions = original.packagingDeductions || {};
  const restoredInventory = new Map<string, InventoryItem>();
  for (const [itemId, quantity] of Object.entries(deductions)) {
    const item = currentState.inventory.find(candidate => candidate.id === itemId);
    if (!item) {
      throw new BottlingReversalCommandError(
        'bottling_reversal_resource_missing',
        `Packaging material ${itemId} no longer exists.`,
        409,
      );
    }
    if (!(quantity > 0) || !Number.isFinite(quantity) || !Number.isFinite(item.stock) || item.stock < 0
      || item.lastModified !== original.createdAt
      || (item.lastCommandId !== undefined && item.lastCommandId !== original.commandId)) {
      dependencyConflict(`Packaging material ${itemId}`);
    }
    restoredInventory.set(itemId, item);
  }

  const originalCosts = requireOriginalCosts(currentState, original);
  const totalUnits = original.totalBottles + original.totalCeramic;
  if (!Number.isSafeInteger(totalUnits) || totalUnits <= 0 || !(original.volumeBottledL > 0)) {
    dependencyConflict(`Bottling quantities for run ${original.id}`);
  }

  let originalMovement: StockMovement | undefined;
  if (original.storageMovementId || original.storageLocationId || (original.placedInStorageBottles || 0) > 0) {
    if (!original.storageMovementId || !original.storageLocationId
      || original.placedInStorageBottles !== totalUnits || (original.storagePlacements?.length || 0) > 0) {
      dependencyConflict(`Storage placement for run ${original.id}`);
    }
    const location = currentState.storageLocations.find(item => item.id === original.storageLocationId);
    originalMovement = currentState.stockMovements.find(item => item.id === original.storageMovementId);
    if (!location || !originalMovement) {
      throw new BottlingReversalCommandError(
        'bottling_reversal_resource_missing',
        `Original storage placement for run ${original.id} no longer exists.`,
        409,
      );
    }
    if (originalMovement.direction !== 'in' || originalMovement.reason !== 'bottling'
      || originalMovement.sourceRef !== original.id || originalMovement.lotId !== original.lotId
      || originalMovement.locationId !== location.id || originalMovement.bottles !== totalUnits
      || originalMovement.lastModified !== original.createdAt
      || (originalMovement.commandId !== undefined && originalMovement.commandId !== original.commandId)) {
      dependencyConflict(`Storage movement ${originalMovement.id}`);
    }
    const locationStock = computeStock(currentState.stockMovements).get(location.id);
    const lotOnHand = locationStock?.byLot[original.lotId] || 0;
    if (!Number.isFinite(lotOnHand) || lotOnHand < totalUnits) {
      dependencyConflict(`On-hand stock for run ${original.id}`);
    }
  } else if (currentState.stockMovements.some(movement => movement.sourceRef === original.id)) {
    dependencyConflict(`Storage placement for run ${original.id}`);
  }

  const timestamp = context.performedAt.toISOString();
  const operationDate = timestamp.slice(0, 10);
  const updatedLot: WineLot = {
    ...lot,
    currentVolume: original.previousLotVolumeL,
    stage: original.previousLotStage,
    lastCommandId: context.commandId,
    lastModified: timestamp,
    history: [{
      date: operationDate,
      type: 'correction',
      description: `Reversal of bottling run ${original.id}: ${payload.reason}`,
      operator: context.actorUsername,
      sourceRef: payload.reversalRunId,
    }, ...(lot.history || [])],
  };
  const updatedVessel: Vessel | undefined = sourceVessel ? {
    ...sourceVessel,
    currentVolume: original.previousSourceVesselVolumeL as number,
    assignedLotId: original.previousSourceVesselAssignedLotId as string | null,
    cleaningStatus: original.previousSourceVesselCleaningStatus as Vessel['cleaningStatus'],
    lastOperation: original.previousSourceVesselLastOperation as string,
    lastCommandId: context.commandId,
    lastModified: timestamp,
  } : undefined;
  const updatedInventoryItems: InventoryItem[] = [];
  const inventory = currentState.inventory.map(item => {
    const quantity = deductions[item.id] || 0;
    if (quantity <= 0) return item;
    const updated: InventoryItem = {
      ...item,
      stock: round3(item.stock + quantity),
      lastCommandId: context.commandId,
      lastModified: timestamp,
    };
    updatedInventoryItems.push(updated);
    return updated;
  });

  const reversalCostEntries = originalCosts.map(entry => {
    const id = entry.category === 'packaging'
      ? payload.packagingCostReversalId
      : payload.serviceCostReversalId;
    const {
      reversedByCommandId: _reversedByCommandId,
      reversedAt: _reversedAt,
      reversalReason: _reversalReason,
      ...entryFacts
    } = entry;
    return {
      ...entryFacts,
      id,
      commandId: context.commandId,
      recordKind: 'reversal' as const,
      lastModified: timestamp,
      date: operationDate,
      description: `Reversal: ${entry.description}`,
      amount: -Math.abs(entry.amount),
      ...(typeof entry.quantity === 'number' ? { quantity: -Math.abs(entry.quantity) } : {}),
      sourceRef: payload.reversalRunId,
      createdBy: context.actorUsername,
      reversalOfCostEntryId: entry.id,
      reversalOfCommandId: original.commandId,
      reversalReason: payload.reason,
    } satisfies CostEntry;
  });
  const updatedOriginalCostEntries = originalCosts.map(entry => ({
    ...entry,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastModified: timestamp,
  } satisfies CostEntry));
  const updatedOriginalCosts = new Map(updatedOriginalCostEntries.map(entry => [entry.id, entry]));
  const nextCostEntries = [
    ...reversalCostEntries,
    ...currentState.costEntries.map(entry => updatedOriginalCosts.get(entry.id) || entry),
  ];

  const storageReturnMovement: StockMovement | undefined = originalMovement ? {
    id: payload.storageReturnMovementId,
    commandId: context.commandId,
    lastModified: timestamp,
    date: operationDate,
    lotId: original.lotId,
    locationId: originalMovement.locationId,
    direction: 'out',
    bottles: totalUnits,
    reason: 'bottling_reversal',
    sourceRef: payload.reversalRunId,
    reversalOfMovementId: originalMovement.id,
    reversalOfCommandId: original.commandId,
    note: `Removed receipt for reversed bottling run ${original.id}: ${payload.reason}`,
  } : undefined;
  const updatedOriginal: BottlingRunRecord = {
    ...original,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastModified: timestamp,
  };
  const reversalRun: BottlingRunRecord = {
    id: payload.reversalRunId,
    commandId: context.commandId,
    recordKind: 'reversal',
    createdAt: timestamp,
    lastModified: timestamp,
    lotId: original.lotId,
    lotName: original.lotName,
    date: operationDate,
    lotNumber: original.lotNumber,
    operator: context.actorUsername,
    formats: { ...original.formats },
    totalBottles: original.totalBottles,
    totalCeramic: original.totalCeramic,
    volumeBottledL: original.volumeBottledL,
    ...(original.sourceVesselId ? {
      sourceVesselId: original.sourceVesselId,
      previousSourceVesselVolumeL: original.previousSourceVesselVolumeL,
      previousSourceVesselAssignedLotId: original.previousSourceVesselAssignedLotId,
      previousSourceVesselCleaningStatus: original.previousSourceVesselCleaningStatus,
      previousSourceVesselLastOperation: original.previousSourceVesselLastOperation,
    } : {}),
    ...(original.packagingMaterialIds ? { packagingMaterialIds: { ...original.packagingMaterialIds } } : {}),
    ...(original.packagingDeductions ? { packagingDeductions: { ...original.packagingDeductions } } : {}),
    ...(original.bottlesPerBox ? { bottlesPerBox: original.bottlesPerBox } : {}),
    ...(original.packagingCostTotal ? { packagingCostTotal: original.packagingCostTotal } : {}),
    ...(original.bottlingServiceCost ? { bottlingServiceCost: original.bottlingServiceCost } : {}),
    ...(storageReturnMovement ? {
      storageLocationId: storageReturnMovement.locationId,
      storageMovementId: storageReturnMovement.id,
      placedInStorageBottles: storageReturnMovement.bottles,
    } : {}),
    reversalOfRunId: original.id,
    reversalOfCommandId: original.commandId,
    reversalReason: payload.reason,
  };
  const restoredPackagingUnits = Object.values(deductions).reduce((sum, quantity) => sum + quantity, 0);
  const reversedCostAmount = originalCosts.reduce((sum, entry) => sum + entry.amount, 0);

  return {
    state: {
      ...currentState,
      lots: currentState.lots.map(item => item.id === updatedLot.id ? updatedLot : item),
      vessels: updatedVessel
        ? currentState.vessels.map(item => item.id === updatedVessel.id ? updatedVessel : item)
        : currentState.vessels,
      bottlingRuns: [
        reversalRun,
        updatedOriginal,
        ...currentState.bottlingRuns.filter(run => run.id !== original.id),
      ],
      inventory,
      costEntries: nextCostEntries,
      stockMovements: storageReturnMovement
        ? [storageReturnMovement, ...currentState.stockMovements]
        : currentState.stockMovements,
    },
    result: {
      originalRun: updatedOriginal,
      reversalRun,
      updatedLot,
      ...(updatedVessel ? { updatedVessel } : {}),
      updatedInventoryItems,
      reversalCostEntries,
      updatedOriginalCostEntries,
      ...(storageReturnMovement ? { storageReturnMovement } : {}),
      receipt: {
        kind: 'bottling_reversal',
        originalCommandId: original.commandId,
        reversalCommandId: context.commandId,
        originalRunId: original.id,
        reversalRunId: reversalRun.id,
        restoredVolumeL: original.volumeBottledL,
        restoredPackagingUnits,
        reversedCostAmount,
        ...(storageReturnMovement ? { storageReturnMovementId: storageReturnMovement.id } : {}),
        reason: payload.reason,
        reversedAt: timestamp,
      },
    },
  };
}
