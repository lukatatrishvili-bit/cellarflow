import type {
  CellarTransferRecord,
  TransferLotReversalSnapshot,
  TransferVesselReversalSnapshot,
  Vessel,
  WineLot,
} from '../wineryState';
import type { CostEntry } from '../costing';
import {
  REVERSAL_REASON_MAX_LENGTH,
  type CommandReversalReceipt,
  type CommandReversalReferencePayload,
} from './reversal';

export const TRANSFER_REVERSAL_COMMAND_TYPE = 'cellar.transfer.reverse' as const;

export interface TransferReversalCommandPayload extends CommandReversalReferencePayload {
  reversalId: string;
}

export interface TransferReversalCommandState {
  vessels: Vessel[];
  lots: WineLot[];
  transfers: CellarTransferRecord[];
  costEntries: CostEntry[];
}

export interface TransferReversalCommandContext {
  commandId: string;
  actorUsername: string;
  performedAt: Date;
}

export interface TransferReversalCommandResult {
  originalTransfer: CellarTransferRecord;
  reversalTransfer: CellarTransferRecord;
  changedVessels: Vessel[];
  changedLots: WineLot[];
  changedCostEntries: CostEntry[];
  stateVersion?: number;
  receipt: CommandReversalReceipt & {
    kind: 'transfer_reversal';
    originalTransferId: string;
    reversalTransferId: string;
  };
}

export interface AppliedTransferReversalCommand {
  state: TransferReversalCommandState;
  result: TransferReversalCommandResult;
}

export type TransferReversalCommandErrorCode =
  | 'invalid_transfer_reversal_payload'
  | 'organization_state_not_found'
  | 'transfer_not_found'
  | 'transfer_not_command_created'
  | 'transfer_already_reversed'
  | 'transfer_reversal_snapshot_missing'
  | 'transfer_reversal_dependency_conflict'
  | 'transfer_reversal_resource_missing'
  | 'transfer_reversal_id_conflict'
  | 'transfer_reversal_cost_conflict';

export class TransferReversalCommandError extends Error {
  constructor(
    public readonly code: TransferReversalCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'TransferReversalCommandError';
  }
}

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EPSILON = 0.000_001;

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new TransferReversalCommandError(
      'invalid_transfer_reversal_payload',
      `${field} must be 1-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
      400,
    );
  }
  return normalized;
}

function roundedLiters(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function sameVolume(actual: unknown, expected: number): boolean {
  return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= EPSILON;
}

function dependencyConflict(resource: string): never {
  throw new TransferReversalCommandError(
    'transfer_reversal_dependency_conflict',
    `${resource} changed after the original transfer. Reverse later dependent work before retrying this correction.`,
    409,
  );
}

function requireCurrentVessel(
  state: TransferReversalCommandState,
  snapshot: TransferVesselReversalSnapshot,
  expected: {
    volume: number;
    assignedLotId: string | null;
    cleaningStatus: Vessel['cleaningStatus'];
    lastOperation: string;
  },
  original: CellarTransferRecord,
  label: string,
): Vessel {
  const vessel = state.vessels.find(item => item.id === snapshot.id);
  if (!vessel) {
    throw new TransferReversalCommandError(
      'transfer_reversal_resource_missing',
      `${label} vessel ${snapshot.id} no longer exists.`,
      409,
    );
  }
  if (!sameVolume(vessel.currentVolume, expected.volume)
    || vessel.assignedLotId !== expected.assignedLotId
    || vessel.cleaningStatus !== expected.cleaningStatus
    || vessel.lastOperation !== expected.lastOperation
    || vessel.lastCommandId !== original.commandId
    || vessel.lastModified !== original.lastModified) {
    dependencyConflict(`${label} vessel ${snapshot.id}`);
  }
  return vessel;
}

function requireCurrentLot(
  state: TransferReversalCommandState,
  snapshot: TransferLotReversalSnapshot,
  expectedVolume: number,
  original: CellarTransferRecord,
  label: string,
): WineLot {
  const lot = state.lots.find(item => item.id === snapshot.id);
  if (!lot) {
    throw new TransferReversalCommandError(
      'transfer_reversal_resource_missing',
      `${label} lot ${snapshot.id} no longer exists.`,
      409,
    );
  }
  if (!sameVolume(lot.currentVolume, expectedVolume)
    || lot.lastCommandId !== original.commandId
    || lot.lastModified !== original.lastModified
    || lot.history?.[0]?.sourceRef !== original.id) {
    dependencyConflict(`${label} lot ${snapshot.id}`);
  }
  return lot;
}

export function parseTransferReversalCommandPayload(value: unknown): TransferReversalCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TransferReversalCommandError(
      'invalid_transfer_reversal_payload',
      'Transfer reversal payload must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > REVERSAL_REASON_MAX_LENGTH) {
    throw new TransferReversalCommandError(
      'invalid_transfer_reversal_payload',
      `reason is required and must not exceed ${REVERSAL_REASON_MAX_LENGTH} characters.`,
      400,
    );
  }
  return {
    reversalId: requiredRecordId(input.reversalId, 'reversalId'),
    originalCommandId: requiredRecordId(input.originalCommandId, 'originalCommandId'),
    reason,
  };
}

export function applyTransferReversalCommand(
  currentState: TransferReversalCommandState,
  rawPayload: unknown,
  context: TransferReversalCommandContext,
): AppliedTransferReversalCommand {
  const payload = parseTransferReversalCommandPayload(rawPayload);
  if (!currentState || !Array.isArray(currentState.vessels) || !Array.isArray(currentState.lots)
    || !Array.isArray(currentState.transfers) || !Array.isArray(currentState.costEntries)) {
    throw new TransferReversalCommandError(
      'invalid_transfer_reversal_payload',
      'Organization transfer state is unavailable.',
      400,
    );
  }
  if (currentState.transfers.some(item => item.id === payload.reversalId)) {
    throw new TransferReversalCommandError(
      'transfer_reversal_id_conflict',
      'Transfer reversal record id already exists.',
      409,
    );
  }

  const original = currentState.transfers.find(item => (
    item.recordKind !== 'reversal' && item.commandId === payload.originalCommandId
  ));
  if (!original) {
    const nonCommandRecord = currentState.transfers.find(item => item.id === payload.originalCommandId);
    throw new TransferReversalCommandError(
      nonCommandRecord ? 'transfer_not_command_created' : 'transfer_not_found',
      nonCommandRecord
        ? 'Legacy transfers without durable command provenance cannot be reversed safely.'
        : 'The original transfer command was not found in this organization.',
      nonCommandRecord ? 409 : 404,
    );
  }
  if (!original.commandId) {
    throw new TransferReversalCommandError(
      'transfer_not_command_created',
      'Legacy transfers without durable command provenance cannot be reversed safely.',
      409,
    );
  }
  if (original.reversedByCommandId || original.reversedAt) {
    throw new TransferReversalCommandError(
      'transfer_already_reversed',
      'The original transfer has already been reversed.',
      409,
    );
  }
  const snapshot = original.reversalSnapshot;
  if (!snapshot || snapshot.version !== 1 || !original.lastModified) {
    throw new TransferReversalCommandError(
      'transfer_reversal_snapshot_missing',
      'This transfer predates complete reversal snapshots and cannot be compensated safely.',
      409,
    );
  }
  if (original.recordKind === 'reversal'
    || snapshot.sourceVessel.id !== original.sourceId
    || snapshot.destinationVessel.id !== original.destId
    || snapshot.sourceLot.id !== original.sourceLotId) {
    dependencyConflict(`Transfer record ${original.id}`);
  }

  const performedAt = context.performedAt;
  if (!(performedAt instanceof Date) || Number.isNaN(performedAt.getTime())) {
    throw new TransferReversalCommandError(
      'invalid_transfer_reversal_payload',
      'Transfer reversal execution time is invalid.',
      400,
    );
  }
  const timestamp = performedAt.toISOString();
  const operationDate = timestamp.slice(0, 10);
  const arrivalVolume = roundedLiters(original.arrivalVolumeL ?? (original.volume - original.loss));
  const sourceAfterVolume = roundedLiters(snapshot.sourceVessel.currentVolume - original.volume);
  const destinationAfterVolume = roundedLiters(snapshot.destinationVessel.currentVolume + arrivalVolume);
  const sourceAfterAssignedLotId = sourceAfterVolume === 0 ? null : snapshot.sourceVessel.assignedLotId;
  const sourceAfterCleaning = sourceAfterVolume === 0 ? 'dirty' as const : snapshot.sourceVessel.cleaningStatus;

  const sourceVessel = requireCurrentVessel(currentState, snapshot.sourceVessel, {
    volume: sourceAfterVolume,
    assignedLotId: sourceAfterAssignedLotId,
    cleaningStatus: sourceAfterCleaning,
    lastOperation: `Transferred wine to ${original.destId}`,
  }, original, 'Source');
  const destinationVessel = requireCurrentVessel(currentState, snapshot.destinationVessel, {
    volume: destinationAfterVolume,
    assignedLotId: original.resultLotId || original.sourceLotId || null,
    cleaningStatus: snapshot.destinationVessel.cleaningStatus,
    lastOperation: `Received wine transfer from ${original.sourceId}`,
  }, original, 'Destination');

  const isBlend = Boolean(snapshot.createdBlendLotId);
  const sourceLot = requireCurrentLot(
    currentState,
    snapshot.sourceLot,
    roundedLiters(snapshot.sourceLot.currentVolume - (isBlend ? original.volume : original.loss)),
    original,
    'Source',
  );
  let destinationLot: WineLot | undefined;
  let createdBlendLot: WineLot | undefined;
  if (isBlend) {
    if (!snapshot.destinationLot
      || snapshot.destinationLot.id !== original.destinationLotId
      || snapshot.createdBlendLotId !== original.resultLotId) {
      dependencyConflict(`Blend transfer ${original.id}`);
    }
    destinationLot = requireCurrentLot(
      currentState,
      snapshot.destinationLot,
      roundedLiters(snapshot.destinationLot.currentVolume - snapshot.destinationVessel.currentVolume),
      original,
      'Destination',
    );
    createdBlendLot = currentState.lots.find(item => item.id === snapshot.createdBlendLotId);
    if (!createdBlendLot) {
      throw new TransferReversalCommandError(
        'transfer_reversal_resource_missing',
        `Created blend lot ${snapshot.createdBlendLotId} no longer exists.`,
        409,
      );
    }
    if (!sameVolume(createdBlendLot.currentVolume, destinationAfterVolume)
      || !sameVolume(createdBlendLot.initialVolume, destinationAfterVolume)
      || createdBlendLot.commandId !== original.commandId
      || createdBlendLot.lastCommandId !== original.commandId
      || createdBlendLot.lastModified !== original.lastModified
      || createdBlendLot.history?.[0]?.sourceRef !== original.id
      || createdBlendLot.voidedAt
      || createdBlendLot.voidedByCommandId) {
      dependencyConflict(`Created blend lot ${createdBlendLot.id}`);
    }
  }

  const correctionDescription = `Reversed transfer ${original.id}: ${payload.reason}`;
  const correctionHistory = {
    date: operationDate,
    type: 'Transfer Reversal',
    description: correctionDescription,
    operator: context.actorUsername,
    sourceRef: payload.reversalId,
  };
  const restoredSourceVessel: Vessel = {
    ...sourceVessel,
    currentVolume: snapshot.sourceVessel.currentVolume,
    assignedLotId: snapshot.sourceVessel.assignedLotId,
    cleaningStatus: snapshot.sourceVessel.cleaningStatus,
    lastOperation: snapshot.sourceVessel.lastOperation,
    lastCommandId: context.commandId,
    lastModified: timestamp,
  };
  const restoredDestinationVessel: Vessel = {
    ...destinationVessel,
    currentVolume: snapshot.destinationVessel.currentVolume,
    assignedLotId: snapshot.destinationVessel.assignedLotId,
    cleaningStatus: snapshot.destinationVessel.cleaningStatus,
    lastOperation: snapshot.destinationVessel.lastOperation,
    lastCommandId: context.commandId,
    lastModified: timestamp,
  };
  const restoredSourceLot: WineLot = {
    ...sourceLot,
    currentVolume: snapshot.sourceLot.currentVolume,
    history: [correctionHistory, ...(sourceLot.history || [])],
    lastCommandId: context.commandId,
    lastModified: timestamp,
  };
  const changedLots: WineLot[] = [restoredSourceLot];
  if (destinationLot && snapshot.destinationLot) {
    changedLots.push({
      ...destinationLot,
      currentVolume: snapshot.destinationLot.currentVolume,
      history: [correctionHistory, ...(destinationLot.history || [])],
      lastCommandId: context.commandId,
      lastModified: timestamp,
    });
  }
  if (createdBlendLot) {
    changedLots.push({
      ...createdBlendLot,
      currentVolume: 0,
      history: [correctionHistory, ...(createdBlendLot.history || [])],
      lastCommandId: context.commandId,
      lastModified: timestamp,
      voidedAt: timestamp,
      voidedByCommandId: context.commandId,
      voidReason: payload.reason,
    });
  }

  const updatedOriginal: CellarTransferRecord = {
    ...original,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastModified: timestamp,
  };
  const reversalTransfer: CellarTransferRecord = {
    id: payload.reversalId,
    commandId: context.commandId,
    recordKind: 'reversal',
    lastModified: timestamp,
    reversalOfTransferId: original.id,
    reversalOfCommandId: original.commandId,
    reversalReason: payload.reason,
    lineageVersion: 1,
    sourceLotId: original.resultLotId,
    resultLotId: original.sourceLotId,
    sourceContributionL: arrivalVolume,
    arrivalVolumeL: arrivalVolume,
    sourceId: original.destId,
    destId: original.sourceId,
    volume: original.volume,
    loss: 0,
    operator: context.actorUsername,
    category: 'reversal',
    date: operationDate,
    pump: 'Accounting correction',
    details: correctionDescription,
  };
  const changedLotById = new Map(changedLots.map(lot => [lot.id, lot]));
  const originalBlendCosts = currentState.costEntries.filter(entry => (
    entry.commandId === original.commandId
    && entry.sourceRef === original.id
    && (entry.category === 'blend_in' || entry.category === 'blend_out')
  ));
  if (originalBlendCosts.some(entry => entry.reversedByCommandId || entry.reversedAt)) {
    throw new TransferReversalCommandError(
      'transfer_reversal_cost_conflict',
      'One or more blend-cost entries were already compensated.',
      409,
    );
  }
  const updatedOriginalCosts = originalBlendCosts.map(entry => ({
    ...entry,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastModified: timestamp,
  }));
  const reversalCosts = originalBlendCosts.map((entry, index) => ({
    id: `cost-reversal-${payload.reversalId}-${index + 1}`,
    commandId: context.commandId,
    recordKind: 'reversal' as const,
    lastModified: timestamp,
    date: operationDate,
    lotId: entry.lotId,
    category: entry.category,
    description: `Reversal of ${entry.description}: ${payload.reason}`,
    amount: -entry.amount,
    currency: entry.currency,
    quantity: entry.quantity,
    unitCost: entry.unitCost,
    sourceRef: payload.reversalId,
    createdBy: context.actorUsername,
    reversalOfCostEntryId: entry.id,
    reversalOfCommandId: original.commandId,
    reversalReason: payload.reason,
  } satisfies CostEntry));
  if (reversalCosts.some(reversal => currentState.costEntries.some(entry => entry.id === reversal.id))) {
    throw new TransferReversalCommandError(
      'transfer_reversal_cost_conflict',
      'A blend-cost reversal entry id already exists.',
      409,
    );
  }
  const updatedOriginalCostById = new Map(updatedOriginalCosts.map(entry => [entry.id, entry]));

  return {
    state: {
      vessels: currentState.vessels.map(vessel => {
        if (vessel.id === restoredSourceVessel.id) return restoredSourceVessel;
        if (vessel.id === restoredDestinationVessel.id) return restoredDestinationVessel;
        return vessel;
      }),
      lots: currentState.lots.map(lot => changedLotById.get(lot.id) || lot),
      transfers: [
        reversalTransfer,
        updatedOriginal,
        ...currentState.transfers.filter(item => item.id !== original.id),
      ],
      costEntries: [
        ...reversalCosts,
        ...currentState.costEntries.map(entry => updatedOriginalCostById.get(entry.id) || entry),
      ],
    },
    result: {
      originalTransfer: updatedOriginal,
      reversalTransfer,
      changedVessels: [restoredSourceVessel, restoredDestinationVessel],
      changedLots,
      changedCostEntries: [...reversalCosts, ...updatedOriginalCosts],
      receipt: {
        kind: 'transfer_reversal',
        originalCommandId: original.commandId,
        reversalCommandId: context.commandId,
        originalTransferId: original.id,
        reversalTransferId: reversalTransfer.id,
        reason: payload.reason,
        reversedAt: timestamp,
      },
    },
  };
}
