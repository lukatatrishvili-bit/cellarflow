import { signAuditEntries } from '../auditHash';
import type { CostEntry } from '../costing';
import type {
  CellarOperation,
  CellarOperationReversalSnapshot,
  InventoryItem,
  MaraniOSAuditLog,
  Vessel,
  WineLot,
} from '../wineryState';
import {
  REVERSAL_REASON_MAX_LENGTH,
  type CommandReversalReceipt,
  type CommandReversalReferencePayload,
} from './reversal';

export const CELLAR_OPERATION_REVERSAL_COMMAND_TYPE = 'cellar.operation.reverse' as const;

export interface CellarOperationReversalCommandPayload extends CommandReversalReferencePayload {
  reversalOperationId: string;
  auditId: string;
  costReversalId: string;
}

export interface CellarOperationReversalCommandState {
  lots: WineLot[];
  vessels: Vessel[];
  inventory: InventoryItem[];
  cellarOps: CellarOperation[];
  costEntries: CostEntry[];
  auditLogs: MaraniOSAuditLog[];
}

export interface CellarOperationReversalCommandContext {
  commandId: string;
  actorUsername: string;
  performedAt: Date;
}

export interface CellarOperationReversalCommandResult {
  originalOperation: CellarOperation;
  reversalOperation: CellarOperation;
  updatedLot: WineLot;
  updatedVessel?: Vessel;
  updatedInventoryItems: InventoryItem[];
  updatedInventoryItem?: InventoryItem;
  reversalCostEntries: CostEntry[];
  reversalCostEntry?: CostEntry;
  updatedOriginalCostEntries: CostEntry[];
  updatedOriginalCostEntry?: CostEntry;
  auditLog: MaraniOSAuditLog;
  stateVersion?: number;
  receipt: CommandReversalReceipt & {
    kind: 'cellar_operation_reversal';
    originalOperationId: string;
    reversalOperationId: string;
    restoredVolumeL: number;
    restoredMaterialQuantity: number;
    reversedCostAmount: number;
  };
}

export interface AppliedCellarOperationReversalCommand {
  state: CellarOperationReversalCommandState;
  result: CellarOperationReversalCommandResult;
}

export type CellarOperationReversalCommandErrorCode =
  | 'invalid_cellar_operation_reversal_payload'
  | 'organization_state_not_found'
  | 'cellar_operation_not_found'
  | 'cellar_operation_not_command_created'
  | 'cellar_operation_already_reversed'
  | 'cellar_operation_reversal_snapshot_missing'
  | 'cellar_operation_reversal_unsupported'
  | 'cellar_operation_reversal_dependency_conflict'
  | 'cellar_operation_reversal_resource_missing'
  | 'cellar_operation_reversal_id_conflict';

export class CellarOperationReversalCommandError extends Error {
  constructor(
    public readonly code: CellarOperationReversalCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CellarOperationReversalCommandError';
  }
}

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EPSILON = 0.000_001;

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new CellarOperationReversalCommandError(
      'invalid_cellar_operation_reversal_payload',
      `${field} must be 1-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
      400,
    );
  }
  return normalized;
}

function dependencyConflict(resource: string): never {
  throw new CellarOperationReversalCommandError(
    'cellar_operation_reversal_dependency_conflict',
    `${resource} changed after the original cellar operation. Correct later dependent work before retrying this reversal.`,
    409,
  );
}

function sameNumber(actual: unknown, expected: number): boolean {
  return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= EPSILON;
}

function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function validSnapshot(value: unknown): value is CellarOperationReversalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as CellarOperationReversalSnapshot;
  const vesselValid = snapshot.vessel === undefined || (
    RECORD_ID_PATTERN.test(snapshot.vessel.id || '')
    && typeof snapshot.vessel.currentVolume === 'number'
    && Number.isFinite(snapshot.vessel.currentVolume)
    && snapshot.vessel.currentVolume >= 0
    && typeof snapshot.vessel.lastOperation === 'string'
  );
  const inventoryFactValid = (item: { id: string; stock: number }) => (
    RECORD_ID_PATTERN.test(item.id || '')
    && typeof item.stock === 'number'
    && Number.isFinite(item.stock)
    && item.stock >= 0
  );
  const costFactValid = (item: { id: string; amount: number; currency: string; quantity?: number }) => (
    RECORD_ID_PATTERN.test(item.id || '')
    && typeof item.amount === 'number'
    && Number.isFinite(item.amount)
    && item.amount > 0
    && typeof item.currency === 'string'
    && item.currency.length > 0
    && (item.quantity === undefined || (
      typeof item.quantity === 'number'
      && Number.isFinite(item.quantity)
      && item.quantity > 0
    ))
  );
  const materialFactsValid = snapshot.version === 1
    ? (snapshot.inventory === undefined || inventoryFactValid(snapshot.inventory))
      && (snapshot.costEntry === undefined || costFactValid(snapshot.costEntry))
    : snapshot.version === 2
      && Array.isArray(snapshot.inventory)
      && snapshot.inventory.length <= 25
      && snapshot.inventory.every(inventoryFactValid)
      && new Set(snapshot.inventory.map(item => item.id)).size === snapshot.inventory.length
      && Array.isArray(snapshot.costEntries)
      && snapshot.costEntries.length <= 25
      && snapshot.costEntries.every(costFactValid)
      && new Set(snapshot.costEntries.map(item => item.id)).size === snapshot.costEntries.length;
  return (snapshot.version === 1 || snapshot.version === 2)
    && Boolean(snapshot.lot && RECORD_ID_PATTERN.test(snapshot.lot.id))
    && typeof snapshot.lot.currentVolume === 'number'
    && Number.isFinite(snapshot.lot.currentVolume)
    && snapshot.lot.currentVolume >= 0
    && typeof snapshot.lot.stage === 'string'
    && RECORD_ID_PATTERN.test(snapshot.auditId || '')
    && typeof snapshot.operationDescription === 'string'
    && snapshot.operationDescription.length > 0
    && vesselValid
    && materialFactsValid;
}

export function parseCellarOperationReversalCommandPayload(
  value: unknown,
): CellarOperationReversalCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CellarOperationReversalCommandError(
      'invalid_cellar_operation_reversal_payload',
      'Cellar operation reversal payload must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > REVERSAL_REASON_MAX_LENGTH) {
    throw new CellarOperationReversalCommandError(
      'invalid_cellar_operation_reversal_payload',
      `reason is required and must not exceed ${REVERSAL_REASON_MAX_LENGTH} characters.`,
      400,
    );
  }
  return {
    reversalOperationId: requiredRecordId(input.reversalOperationId, 'reversalOperationId'),
    auditId: requiredRecordId(input.auditId, 'auditId'),
    costReversalId: requiredRecordId(input.costReversalId, 'costReversalId'),
    originalCommandId: requiredRecordId(input.originalCommandId, 'originalCommandId'),
    reason,
  };
}

function assertState(state: CellarOperationReversalCommandState): void {
  if (!state || !Array.isArray(state.lots) || !Array.isArray(state.vessels)
    || !Array.isArray(state.inventory) || !Array.isArray(state.cellarOps)
    || !Array.isArray(state.costEntries) || !Array.isArray(state.auditLogs)) {
    throw new CellarOperationReversalCommandError(
      'invalid_cellar_operation_reversal_payload',
      'Organization cellar-operation state is unavailable.',
      400,
    );
  }
}

export function applyCellarOperationReversalCommand(
  currentState: CellarOperationReversalCommandState,
  rawPayload: unknown,
  context: CellarOperationReversalCommandContext,
): AppliedCellarOperationReversalCommand {
  const payload = parseCellarOperationReversalCommandPayload(rawPayload);
  assertState(currentState);
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new CellarOperationReversalCommandError(
      'invalid_cellar_operation_reversal_payload',
      'Cellar operation reversal execution time is invalid.',
      400,
    );
  }
  if (currentState.cellarOps.some(item => item.id === payload.reversalOperationId)
    || currentState.auditLogs.some(item => item.id === payload.auditId)
    || currentState.costEntries.some(item => item.id === payload.costReversalId)) {
    throw new CellarOperationReversalCommandError(
      'cellar_operation_reversal_id_conflict',
      'A cellar-operation reversal record id already exists.',
      409,
    );
  }

  const original = currentState.cellarOps.find(item => (
    item.recordKind !== 'reversal' && item.commandId === payload.originalCommandId
  ));
  if (!original) {
    const legacy = currentState.cellarOps.find(item => item.id === payload.originalCommandId);
    throw new CellarOperationReversalCommandError(
      legacy ? 'cellar_operation_not_command_created' : 'cellar_operation_not_found',
      legacy
        ? 'Legacy cellar operations without durable command provenance cannot be reversed safely.'
        : 'The original cellar-operation command was not found in this organization.',
      legacy ? 409 : 404,
    );
  }
  if (!original.commandId || !original.lastModified) {
    throw new CellarOperationReversalCommandError(
      'cellar_operation_not_command_created',
      'The cellar operation does not contain complete durable command provenance.',
      409,
    );
  }
  if (original.reversedByCommandId || original.reversedAt
    || currentState.cellarOps.some(item => item.reversalOfOperationId === original.id)) {
    throw new CellarOperationReversalCommandError(
      'cellar_operation_already_reversed',
      'The original cellar operation has already been reversed.',
      409,
    );
  }
  // Topping moves wine between two lots and two vessels; the restoration
  // snapshot describes one of each, so reversing one would put the topped
  // barrel back and leave the source short. Refused rather than half-applied —
  // and physically, wine already in a barrel is taken back out by recording the
  // move, not by undoing the paperwork.
  if (original.type === 'topping') {
    throw new CellarOperationReversalCommandError(
      'cellar_operation_reversal_unsupported',
      'A topping cannot be reversed. Record the wine coming back out instead.',
      409,
    );
  }
  if (!validSnapshot(original.reversalSnapshot)) {
    throw new CellarOperationReversalCommandError(
      'cellar_operation_reversal_snapshot_missing',
      'This cellar operation predates complete restoration metadata and cannot be compensated safely.',
      409,
    );
  }
  const snapshot = original.reversalSnapshot;
  const timestamp = context.performedAt.toISOString();
  const operationDate = timestamp.slice(0, 10);

  const lot = currentState.lots.find(item => item.id === snapshot.lot.id);
  if (!lot) {
    throw new CellarOperationReversalCommandError(
      'cellar_operation_reversal_resource_missing',
      `Wine lot ${snapshot.lot.id} no longer exists.`,
      409,
    );
  }
  const expectedVolume = original.volumeAfterL ?? snapshot.lot.currentVolume;
  if (original.lotId !== lot.id || !sameNumber(lot.currentVolume, expectedVolume)
    || lot.stage !== snapshot.lot.stage || lot.lastCommandId !== original.commandId
    || lot.lastModified !== original.lastModified
    || lot.history?.[0]?.sourceRef !== original.id
    || lot.history?.[0]?.description !== snapshot.operationDescription) {
    dependencyConflict(`Wine lot ${lot.id}`);
  }

  let vessel: Vessel | undefined;
  if (snapshot.vessel) {
    vessel = currentState.vessels.find(item => item.id === snapshot.vessel?.id);
    if (!vessel) {
      throw new CellarOperationReversalCommandError(
        'cellar_operation_reversal_resource_missing',
        `Vessel ${snapshot.vessel.id} no longer exists.`,
        409,
      );
    }
    const expectedVesselVolume = original.volumeAfterL === undefined
      ? snapshot.vessel.currentVolume
      : snapshot.vessel.currentVolume + (original.volumeAfterL - snapshot.lot.currentVolume);
    if (original.vesselId !== vessel.id || vessel.assignedLotId !== original.lotId
      || !sameNumber(vessel.currentVolume, expectedVesselVolume)
      || vessel.lastOperation !== snapshot.operationDescription
      || vessel.lastCommandId !== original.commandId
      || vessel.lastModified !== original.lastModified) {
      dependencyConflict(`Vessel ${vessel.id}`);
    }
  } else if (original.vesselId) {
    dependencyConflict(`Vessel snapshot for operation ${original.id}`);
  }

  const inventorySnapshots = snapshot.version === 1
    ? (snapshot.inventory ? [snapshot.inventory] : [])
    : snapshot.inventory;
  const originalMaterialUsages = original.materials?.length
    ? original.materials
    : original.materialId && original.dose
      ? [{ materialId: original.materialId, quantity: original.dose }]
      : [];
  if (inventorySnapshots.length !== originalMaterialUsages.length) {
    dependencyConflict(`Inventory snapshots for operation ${original.id}`);
  }
  const inventoryItems = inventorySnapshots.map(inventorySnapshot => {
    const inventoryItem = currentState.inventory.find(item => item.id === inventorySnapshot.id);
    if (!inventoryItem) {
      throw new CellarOperationReversalCommandError(
        'cellar_operation_reversal_resource_missing',
        `Inventory material ${inventorySnapshot.id} no longer exists.`,
        409,
      );
    }
    const usage = originalMaterialUsages.find(item => item.materialId === inventoryItem.id);
    const expectedStock = round3(inventorySnapshot.stock - (usage?.quantity || 0));
    if (!usage || !(usage.quantity > 0)
      || !sameNumber(inventoryItem.stock, expectedStock)
      || inventoryItem.lastCommandId !== original.commandId
      || inventoryItem.lastModified !== original.lastModified) {
      dependencyConflict(`Inventory material ${inventoryItem.id}`);
    }
    return { inventoryItem, inventorySnapshot, usage };
  });

  const linkedCosts = currentState.costEntries.filter(entry => (
    entry.sourceRef === original.id && entry.recordKind !== 'reversal'
  ));
  const costSnapshots = snapshot.version === 1
    ? (snapshot.costEntry ? [snapshot.costEntry] : [])
    : snapshot.costEntries;
  if (linkedCosts.length !== costSnapshots.length) {
    dependencyConflict(`Cost ledger for operation ${original.id}`);
  }
  const originalCostEntries = costSnapshots.map(costSnapshot => {
    const originalCostEntry = linkedCosts.find(entry => entry.id === costSnapshot.id);
    if (!originalCostEntry
      || originalCostEntry.commandId !== original.commandId
      || originalCostEntry.lastModified !== original.lastModified
      || !sameNumber(originalCostEntry.amount, costSnapshot.amount)
      || originalCostEntry.currency !== costSnapshot.currency
      || (costSnapshot.quantity !== undefined
        && !sameNumber(originalCostEntry.quantity, costSnapshot.quantity))
      || originalCostEntry.reversedByCommandId || originalCostEntry.reversedAt) {
      dependencyConflict(`Cost ledger for operation ${original.id}`);
    }
    return originalCostEntry;
  });

  const originalAudit = currentState.auditLogs.find(item => item.id === snapshot.auditId);
  if (!originalAudit || originalAudit.commandId !== original.commandId
    || originalAudit.lastModified !== original.lastModified
    || originalAudit.changedItem !== `Lot ${original.lotId}`) {
    dependencyConflict(`Audit record ${snapshot.auditId}`);
  }

  const updatedLot: WineLot = {
    ...lot,
    currentVolume: snapshot.lot.currentVolume,
    stage: snapshot.lot.stage,
    lastCommandId: context.commandId,
    lastModified: timestamp,
    history: [{
      date: operationDate,
      type: 'correction',
      description: `Reversal of cellar operation ${original.id}: ${payload.reason}`,
      operator: context.actorUsername,
      sourceRef: payload.reversalOperationId,
    }, ...(lot.history || [])],
  };
  const updatedVessel: Vessel | undefined = vessel && snapshot.vessel ? {
    ...vessel,
    currentVolume: snapshot.vessel.currentVolume,
    lastOperation: snapshot.vessel.lastOperation,
    lastCommandId: context.commandId,
    lastModified: timestamp,
  } : undefined;
  const updatedInventoryItems: InventoryItem[] = inventoryItems.map(({
    inventoryItem,
    inventorySnapshot,
  }) => ({
    ...inventoryItem,
    stock: inventorySnapshot.stock,
    lastCommandId: context.commandId,
    lastModified: timestamp,
  }));

  const updatedOriginal: CellarOperation = {
    ...original,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastModified: timestamp,
  };
  const reversalOperation: CellarOperation = {
    id: payload.reversalOperationId,
    commandId: context.commandId,
    recordKind: 'reversal',
    lastModified: timestamp,
    date: operationDate,
    type: 'correction',
    customLabel: `Reversal of ${original.customLabel || original.type.replace(/_/g, ' ')}`,
    lotId: original.lotId,
    lotName: original.lotName,
    ...(original.vesselId !== undefined ? { vesselId: original.vesselId } : {}),
    ...(original.vesselToId !== undefined ? { vesselToId: original.vesselToId } : {}),
    volumeBeforeL: expectedVolume,
    volumeAfterL: snapshot.lot.currentVolume,
    ...(original.materialId ? { materialId: original.materialId } : {}),
    ...(original.materialName ? { materialName: original.materialName } : {}),
    ...(typeof original.dose === 'number' ? { dose: original.dose } : {}),
    ...(original.unit ? { unit: original.unit } : {}),
    ...(original.materials?.length ? { materials: original.materials } : {}),
    operator: context.actorUsername,
    notes: payload.reason,
    reversalOfOperationId: original.id,
    reversalOfCommandId: original.commandId,
    reversalReason: payload.reason,
  };

  const updatedOriginalCostEntries: CostEntry[] = originalCostEntries.map(originalCostEntry => ({
    ...originalCostEntry,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastModified: timestamp,
  }));
  const reversalCostEntries: CostEntry[] = originalCostEntries.map((originalCostEntry, index) => {
    const {
      reversedByCommandId: _reversedByCommandId,
      reversedAt: _reversedAt,
      reversalReason: _reversalReason,
      reversalOfCostEntryId: _reversalOfCostEntryId,
      reversalOfCommandId: _reversalOfCommandId,
      ...facts
    } = originalCostEntry;
    const suffix = index === 0 ? '' : `-${index + 1}`;
    const id = `${payload.costReversalId.slice(0, 128 - suffix.length)}${suffix}`;
    if (currentState.costEntries.some(item => item.id === id)) {
      throw new CellarOperationReversalCommandError(
        'cellar_operation_reversal_id_conflict',
        `Cost reversal record ${id} already exists.`,
        409,
      );
    }
    return {
      ...facts,
      id,
      commandId: context.commandId,
      recordKind: 'reversal',
      lastModified: timestamp,
      date: operationDate,
      description: `Reversal: ${originalCostEntry.description}`,
      amount: -Math.abs(originalCostEntry.amount),
      ...(typeof originalCostEntry.quantity === 'number'
        ? { quantity: -Math.abs(originalCostEntry.quantity) }
        : {}),
      sourceRef: reversalOperation.id,
      createdBy: context.actorUsername,
      reversalOfCostEntryId: originalCostEntry.id,
      reversalOfCommandId: original.commandId,
      reversalReason: payload.reason,
    };
  });

  const unsignedAudit: MaraniOSAuditLog = {
    id: payload.auditId,
    commandId: context.commandId,
    lastModified: timestamp,
    timestamp,
    user: context.actorUsername,
    module: 'GVINO',
    actionType: `Cellar Operation Reversal: ${original.customLabel || original.type.replace(/_/g, ' ')}`,
    changedItem: `Lot ${original.lotId}`,
    oldValue: `${expectedVolume} L`,
    newValue: `${snapshot.lot.currentVolume} L`,
    notes: `Reversed operation ${original.id}: ${payload.reason}`,
  };
  const auditLog = signAuditEntries([unsignedAudit], currentState.auditLogs)[0];
  const updatedCosts = new Map(
    updatedOriginalCostEntries.map(item => [item.id, item]),
  );
  const updatedInventoryById = new Map(
    updatedInventoryItems.map(item => [item.id, item]),
  );

  return {
    state: {
      lots: currentState.lots.map(item => item.id === updatedLot.id ? updatedLot : item),
      vessels: updatedVessel
        ? currentState.vessels.map(item => item.id === updatedVessel.id ? updatedVessel : item)
        : currentState.vessels,
      inventory: currentState.inventory.map(item => updatedInventoryById.get(item.id) || item),
      cellarOps: [
        reversalOperation,
        ...currentState.cellarOps.map(item => item.id === updatedOriginal.id ? updatedOriginal : item),
      ],
      costEntries: [
        ...reversalCostEntries,
        ...currentState.costEntries.map(item => updatedCosts.get(item.id) || item),
      ],
      auditLogs: [auditLog, ...currentState.auditLogs],
    },
    result: {
      originalOperation: updatedOriginal,
      reversalOperation,
      updatedLot,
      ...(updatedVessel ? { updatedVessel } : {}),
      updatedInventoryItems,
      ...(updatedInventoryItems[0] ? { updatedInventoryItem: updatedInventoryItems[0] } : {}),
      reversalCostEntries,
      ...(reversalCostEntries[0] ? { reversalCostEntry: reversalCostEntries[0] } : {}),
      updatedOriginalCostEntries,
      ...(updatedOriginalCostEntries[0] ? { updatedOriginalCostEntry: updatedOriginalCostEntries[0] } : {}),
      auditLog,
      receipt: {
        kind: 'cellar_operation_reversal',
        originalCommandId: original.commandId,
        reversalCommandId: context.commandId,
        reason: payload.reason,
        reversedAt: timestamp,
        originalOperationId: original.id,
        reversalOperationId: reversalOperation.id,
        restoredVolumeL: snapshot.lot.currentVolume,
        restoredMaterialQuantity: originalMaterialUsages.reduce((sum, item) => sum + item.quantity, 0),
        reversedCostAmount: originalCostEntries.reduce((sum, item) => sum + item.amount, 0),
      },
    },
  };
}
