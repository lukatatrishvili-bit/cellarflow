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
  updatedInventoryItem?: InventoryItem;
  reversalCostEntry?: CostEntry;
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
  const inventoryValid = snapshot.inventory === undefined || (
    RECORD_ID_PATTERN.test(snapshot.inventory.id || '')
    && typeof snapshot.inventory.stock === 'number'
    && Number.isFinite(snapshot.inventory.stock)
    && snapshot.inventory.stock >= 0
  );
  const costValid = snapshot.costEntry === undefined || (
    RECORD_ID_PATTERN.test(snapshot.costEntry.id || '')
    && typeof snapshot.costEntry.amount === 'number'
    && Number.isFinite(snapshot.costEntry.amount)
    && snapshot.costEntry.amount > 0
    && typeof snapshot.costEntry.currency === 'string'
    && snapshot.costEntry.currency.length > 0
    && (snapshot.costEntry.quantity === undefined || (
      typeof snapshot.costEntry.quantity === 'number'
      && Number.isFinite(snapshot.costEntry.quantity)
      && snapshot.costEntry.quantity > 0
    ))
  );
  return snapshot.version === 1
    && Boolean(snapshot.lot && RECORD_ID_PATTERN.test(snapshot.lot.id))
    && typeof snapshot.lot.currentVolume === 'number'
    && Number.isFinite(snapshot.lot.currentVolume)
    && snapshot.lot.currentVolume >= 0
    && typeof snapshot.lot.stage === 'string'
    && RECORD_ID_PATTERN.test(snapshot.auditId || '')
    && typeof snapshot.operationDescription === 'string'
    && snapshot.operationDescription.length > 0
    && vesselValid
    && inventoryValid
    && costValid;
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
    const expectedVesselVolume = original.volumeAfterL ?? snapshot.vessel.currentVolume;
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

  let inventoryItem: InventoryItem | undefined;
  if (snapshot.inventory) {
    inventoryItem = currentState.inventory.find(item => item.id === snapshot.inventory?.id);
    if (!inventoryItem) {
      throw new CellarOperationReversalCommandError(
        'cellar_operation_reversal_resource_missing',
        `Inventory material ${snapshot.inventory.id} no longer exists.`,
        409,
      );
    }
    const dose = original.dose || 0;
    const expectedStock = round3(snapshot.inventory.stock - dose);
    if (original.materialId !== inventoryItem.id || !(dose > 0)
      || !sameNumber(inventoryItem.stock, expectedStock)
      || inventoryItem.lastCommandId !== original.commandId
      || inventoryItem.lastModified !== original.lastModified) {
      dependencyConflict(`Inventory material ${inventoryItem.id}`);
    }
  } else if (original.materialId || original.dose) {
    dependencyConflict(`Inventory snapshot for operation ${original.id}`);
  }

  const linkedCosts = currentState.costEntries.filter(entry => (
    entry.sourceRef === original.id && entry.recordKind !== 'reversal'
  ));
  let originalCostEntry: CostEntry | undefined;
  if (snapshot.costEntry) {
    originalCostEntry = linkedCosts.find(entry => entry.id === snapshot.costEntry?.id);
    if (!originalCostEntry || linkedCosts.length !== 1
      || originalCostEntry.commandId !== original.commandId
      || originalCostEntry.lastModified !== original.lastModified
      || !sameNumber(originalCostEntry.amount, snapshot.costEntry.amount)
      || originalCostEntry.currency !== snapshot.costEntry.currency
      || (snapshot.costEntry.quantity !== undefined
        && !sameNumber(originalCostEntry.quantity, snapshot.costEntry.quantity))
      || originalCostEntry.reversedByCommandId || originalCostEntry.reversedAt) {
      dependencyConflict(`Cost ledger for operation ${original.id}`);
    }
  } else if (linkedCosts.length > 0) {
    dependencyConflict(`Cost ledger for operation ${original.id}`);
  }

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
  const updatedInventoryItem: InventoryItem | undefined = inventoryItem && snapshot.inventory ? {
    ...inventoryItem,
    stock: snapshot.inventory.stock,
    lastCommandId: context.commandId,
    lastModified: timestamp,
  } : undefined;

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
    operator: context.actorUsername,
    notes: payload.reason,
    reversalOfOperationId: original.id,
    reversalOfCommandId: original.commandId,
    reversalReason: payload.reason,
  };

  const updatedOriginalCostEntry: CostEntry | undefined = originalCostEntry ? {
    ...originalCostEntry,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastModified: timestamp,
  } : undefined;
  const originalCostFacts = originalCostEntry ? (() => {
    const {
      reversedByCommandId: _reversedByCommandId,
      reversedAt: _reversedAt,
      reversalReason: _reversalReason,
      reversalOfCostEntryId: _reversalOfCostEntryId,
      reversalOfCommandId: _reversalOfCommandId,
      ...facts
    } = originalCostEntry;
    return facts;
  })() : undefined;
  const reversalCostEntry: CostEntry | undefined = originalCostEntry && originalCostFacts ? {
    ...originalCostFacts,
    id: payload.costReversalId,
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
  } : undefined;

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
    updatedOriginalCostEntry ? [[updatedOriginalCostEntry.id, updatedOriginalCostEntry]] : [],
  );

  return {
    state: {
      lots: currentState.lots.map(item => item.id === updatedLot.id ? updatedLot : item),
      vessels: updatedVessel
        ? currentState.vessels.map(item => item.id === updatedVessel.id ? updatedVessel : item)
        : currentState.vessels,
      inventory: updatedInventoryItem
        ? currentState.inventory.map(item => item.id === updatedInventoryItem.id ? updatedInventoryItem : item)
        : currentState.inventory,
      cellarOps: [
        reversalOperation,
        ...currentState.cellarOps.map(item => item.id === updatedOriginal.id ? updatedOriginal : item),
      ],
      costEntries: [
        ...(reversalCostEntry ? [reversalCostEntry] : []),
        ...currentState.costEntries.map(item => updatedCosts.get(item.id) || item),
      ],
      auditLogs: [auditLog, ...currentState.auditLogs],
    },
    result: {
      originalOperation: updatedOriginal,
      reversalOperation,
      updatedLot,
      ...(updatedVessel ? { updatedVessel } : {}),
      ...(updatedInventoryItem ? { updatedInventoryItem } : {}),
      ...(reversalCostEntry ? { reversalCostEntry } : {}),
      ...(updatedOriginalCostEntry ? { updatedOriginalCostEntry } : {}),
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
        restoredMaterialQuantity: original.dose || 0,
        reversedCostAmount: originalCostEntry?.amount || 0,
      },
    },
  };
}
