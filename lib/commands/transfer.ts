import type {
  CellarTransferRecord,
  TransferLotReversalSnapshot,
  TransferVesselReversalSnapshot,
  Vessel,
  WineLot,
} from '../wineryState';

export const TRANSFER_COMMAND_TYPE = 'cellar.transfer' as const;
export const TRANSFER_CATEGORIES = ['racking', 'blend', 'filtration', 'bottling'] as const;

export type TransferCategory = typeof TRANSFER_CATEGORIES[number];

export interface TransferCommandPayload {
  transferId: string;
  blendLotId: string;
  sourceVesselId: string;
  destinationVesselId: string;
  volumeLiters: number;
  lossLiters: number;
  operator: string;
  category: TransferCategory;
  pump: string;
}

export interface TransferCommandState {
  vessels: Vessel[];
  lots: WineLot[];
  transfers: CellarTransferRecord[];
}

export interface TransferCommandContext {
  commandId: string;
  actorUsername: string;
  performedAt: Date;
}

export interface TransferCommandResult {
  transfer: CellarTransferRecord;
  sourceVessel: Vessel;
  destinationVessel: Vessel;
  changedLots: WineLot[];
  blendLotId?: string;
  stateVersion?: number;
  receipt: {
    kind: 'transfer' | 'blend';
    sourceVesselId: string;
    destinationVesselId: string;
    volumeLiters: number;
    arrivalLiters: number;
    lossLiters: number;
    destinationLotId: string;
  };
}

export interface AppliedTransferCommand {
  state: TransferCommandState;
  result: TransferCommandResult;
}

export type TransferCommandErrorCode =
  | 'invalid_transfer_payload'
  | 'organization_state_not_found'
  | 'same_transfer_vessel'
  | 'source_vessel_not_found'
  | 'destination_vessel_not_found'
  | 'source_lot_not_found'
  | 'destination_lot_not_found'
  | 'insufficient_source_volume'
  | 'destination_capacity_exceeded'
  | 'destination_not_clean'
  | 'lot_volume_inconsistent'
  | 'transfer_id_conflict'
  | 'blend_lot_id_conflict';

export class TransferCommandError extends Error {
  constructor(
    public readonly code: TransferCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'TransferCommandError';
  }
}

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EPSILON = 0.000_001;
const MAX_VOLUME_LITERS = 1_000_000_000;

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new TransferCommandError(
      'invalid_transfer_payload',
      `${field} must be 1-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
      400,
    );
  }
  return normalized;
}

function boundedText(value: unknown, field: string, maxLength: number, fallback = ''): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const resolved = normalized || fallback;
  if (!resolved || resolved.length > maxLength) {
    throw new TransferCommandError(
      'invalid_transfer_payload',
      `${field} is required and must not exceed ${maxLength} characters.`,
      400,
    );
  }
  return resolved;
}

function finiteVolume(value: unknown, field: string, allowZero: boolean): number {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(parsed) || parsed > MAX_VOLUME_LITERS || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new TransferCommandError(
      'invalid_transfer_payload',
      `${field} must be a ${allowZero ? 'non-negative' : 'positive'} finite number no greater than ${MAX_VOLUME_LITERS}.`,
      400,
    );
  }
  return parsed;
}

function roundedLiters(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function numericStateVolume(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TransferCommandError('lot_volume_inconsistent', `${label} has an invalid stored volume.`, 409);
  }
  return value;
}

function stamped<T extends object>(record: T, timestamp: string): T {
  return { ...record, lastModified: timestamp };
}

function vesselReversalSnapshot(vessel: Vessel): TransferVesselReversalSnapshot {
  return {
    id: vessel.id,
    currentVolume: vessel.currentVolume,
    assignedLotId: vessel.assignedLotId,
    cleaningStatus: vessel.cleaningStatus,
    lastOperation: vessel.lastOperation,
    ...(vessel.lastCommandId ? { lastCommandId: vessel.lastCommandId } : {}),
    ...(vessel.lastModified ? { lastModified: vessel.lastModified } : {}),
  };
}

function lotReversalSnapshot(lot: WineLot): TransferLotReversalSnapshot {
  return {
    id: lot.id,
    currentVolume: lot.currentVolume,
    ...(lot.lastCommandId ? { lastCommandId: lot.lastCommandId } : {}),
    ...(lot.lastModified ? { lastModified: lot.lastModified } : {}),
  };
}

export function parseTransferCommandPayload(value: unknown): TransferCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TransferCommandError('invalid_transfer_payload', 'Transfer payload must be an object.', 400);
  }
  const input = value as Record<string, unknown>;
  const category = typeof input.category === 'string' ? input.category : '';
  if (!TRANSFER_CATEGORIES.includes(category as TransferCategory)) {
    throw new TransferCommandError('invalid_transfer_payload', 'Transfer category is not supported.', 400);
  }

  const volumeLiters = finiteVolume(input.volumeLiters, 'volumeLiters', false);
  const lossLiters = finiteVolume(input.lossLiters, 'lossLiters', true);
  if (lossLiters + EPSILON >= volumeLiters) {
    throw new TransferCommandError(
      'invalid_transfer_payload',
      'lossLiters must be smaller than volumeLiters so liquid arrives at the destination.',
      400,
    );
  }

  return {
    transferId: requiredRecordId(input.transferId, 'transferId'),
    blendLotId: requiredRecordId(input.blendLotId, 'blendLotId'),
    sourceVesselId: requiredRecordId(input.sourceVesselId, 'sourceVesselId'),
    destinationVesselId: requiredRecordId(input.destinationVesselId, 'destinationVesselId'),
    volumeLiters,
    lossLiters,
    operator: boundedText(input.operator, 'operator', 120),
    category: category as TransferCategory,
    pump: boundedText(input.pump, 'pump', 120),
  };
}

export function applyTransferCommand(
  currentState: TransferCommandState,
  rawPayload: unknown,
  context: TransferCommandContext,
): AppliedTransferCommand {
  const payload = parseTransferCommandPayload(rawPayload);
  if (!currentState || !Array.isArray(currentState.vessels) || !Array.isArray(currentState.lots)
    || !Array.isArray(currentState.transfers)) {
    throw new TransferCommandError('invalid_transfer_payload', 'Organization transfer state is unavailable.', 400);
  }
  if (payload.sourceVesselId === payload.destinationVesselId) {
    throw new TransferCommandError('same_transfer_vessel', 'Source and destination vessels must be different.', 409);
  }
  if (currentState.transfers.some(transfer => transfer.id === payload.transferId)) {
    throw new TransferCommandError('transfer_id_conflict', 'Transfer record id already exists.', 409);
  }

  const source = currentState.vessels.find(vessel => vessel.id === payload.sourceVesselId);
  if (!source) {
    throw new TransferCommandError('source_vessel_not_found', 'Source vessel was not found.', 404);
  }
  const destination = currentState.vessels.find(vessel => vessel.id === payload.destinationVesselId);
  if (!destination) {
    throw new TransferCommandError('destination_vessel_not_found', 'Destination vessel was not found.', 404);
  }

  const sourceVolume = numericStateVolume(source.currentVolume, `Source vessel ${source.id}`);
  const destinationVolume = numericStateVolume(destination.currentVolume, `Destination vessel ${destination.id}`);
  const destinationCapacity = numericStateVolume(destination.capacity, `Destination vessel ${destination.id} capacity`);
  if (sourceVolume + EPSILON < payload.volumeLiters) {
    throw new TransferCommandError(
      'insufficient_source_volume',
      `Source vessel contains ${sourceVolume} L, less than the requested ${payload.volumeLiters} L.`,
      409,
    );
  }
  if (destinationVolume === 0 && destination.cleaningStatus !== 'clean') {
    throw new TransferCommandError(
      'destination_not_clean',
      'An empty destination vessel must be clean before receiving wine.',
      409,
    );
  }

  const arrivalLiters = roundedLiters(payload.volumeLiters - payload.lossLiters);
  if (destinationVolume + arrivalLiters > destinationCapacity + EPSILON) {
    throw new TransferCommandError(
      'destination_capacity_exceeded',
      `Destination vessel has only ${roundedLiters(destinationCapacity - destinationVolume)} L available.`,
      409,
    );
  }

  const sourceLot = currentState.lots.find(lot => lot.id === source.assignedLotId);
  if (!sourceLot) {
    throw new TransferCommandError('source_lot_not_found', 'The source vessel is not assigned to an existing lot.', 409);
  }
  const destinationLot = destinationVolume > 0
    ? currentState.lots.find(lot => lot.id === destination.assignedLotId)
    : undefined;
  if (destinationVolume > 0 && !destinationLot) {
    throw new TransferCommandError(
      'destination_lot_not_found',
      'The occupied destination vessel is not assigned to an existing lot.',
      409,
    );
  }

  const isBlend = Boolean(destinationLot && destinationLot.id !== sourceLot.id);
  if (isBlend && currentState.lots.some(lot => lot.id === payload.blendLotId)) {
    throw new TransferCommandError('blend_lot_id_conflict', 'Blend lot id already exists.', 409);
  }

  const performedAt = context.performedAt;
  if (!(performedAt instanceof Date) || Number.isNaN(performedAt.getTime())) {
    throw new TransferCommandError('invalid_transfer_payload', 'Transfer execution time is invalid.', 400);
  }
  const timestamp = performedAt.toISOString();
  const operationDate = timestamp.slice(0, 10);
  const finalSourceVolume = roundedLiters(sourceVolume - payload.volumeLiters);
  const finalDestinationVolume = roundedLiters(destinationVolume + arrivalLiters);
  const changedLots: WineLot[] = [];
  let finalDestinationLotId = sourceLot.id;
  let details: string;

  if (isBlend && destinationLot) {
    const sourceLotVolume = numericStateVolume(sourceLot.currentVolume, `Source lot ${sourceLot.id}`);
    const destinationLotVolume = numericStateVolume(destinationLot.currentVolume, `Destination lot ${destinationLot.id}`);
    if (sourceLotVolume + EPSILON < payload.volumeLiters || destinationLotVolume + EPSILON < destinationVolume) {
      throw new TransferCommandError(
        'lot_volume_inconsistent',
        'Stored lot volume is smaller than the vessel contribution required for this blend.',
        409,
      );
    }

    const blendTotal = finalDestinationVolume;
    const sourcePercentage = Number(((arrivalLiters / blendTotal) * 100).toFixed(1));
    const destinationPercentage = Number(((destinationVolume / blendTotal) * 100).toFixed(1));
    const sourceContributionText = `Contributed ${payload.volumeLiters} L from ${source.id} to blend ${payload.blendLotId}; ${payload.lossLiters} L process loss.`;
    const destinationContributionText = `Contributed ${destinationVolume} L from ${destination.id} to blend ${payload.blendLotId}.`;

    const updatedSourceLot = stamped({
      ...sourceLot,
      lastCommandId: context.commandId,
      currentVolume: roundedLiters(sourceLotVolume - payload.volumeLiters),
      history: [{
        date: operationDate,
        type: 'Blend Contribution',
        description: sourceContributionText,
        operator: payload.operator,
        sourceRef: payload.transferId,
      }, ...(sourceLot.history || [])],
    }, timestamp);
    const updatedDestinationLot = stamped({
      ...destinationLot,
      lastCommandId: context.commandId,
      currentVolume: roundedLiters(destinationLotVolume - destinationVolume),
      history: [{
        date: operationDate,
        type: 'Blend Contribution',
        description: destinationContributionText,
        operator: payload.operator,
        sourceRef: payload.transferId,
      }, ...(destinationLot.history || [])],
    }, timestamp);
    const blendedLot = stamped<WineLot>({
      id: payload.blendLotId,
      commandId: context.commandId,
      lastCommandId: context.commandId,
      name: `Assembly: ${sourceLot.name} / ${destinationLot.name}`,
      vintage: Math.max(sourceLot.vintage, destinationLot.vintage),
      variety: `${sourceLot.variety} (${sourcePercentage}%) / ${destinationLot.variety} (${destinationPercentage}%)`,
      vineyardBlock: `Combined inside ${destination.id}`,
      region: destinationLot.region,
      initialVolume: blendTotal,
      currentVolume: blendTotal,
      wineClass: destinationLot.wineClass,
      stage: 'aging',
      createdAt: operationDate,
      history: [{
        date: operationDate,
        type: 'Genealogy Merge Blend',
        description: `Combined ${arrivalLiters} L of ${sourceLot.name} with ${destinationVolume} L of ${destinationLot.name}.`,
        operator: payload.operator,
        sourceRef: payload.transferId,
      }],
    }, timestamp);

    changedLots.push(updatedSourceLot, updatedDestinationLot, blendedLot);
    finalDestinationLotId = blendedLot.id;
    details = `Created blend lot ${blendedLot.id}: ${arrivalLiters} L from ${sourceLot.name} combined with ${destinationVolume} L from ${destinationLot.name}.`;
  } else {
    const sourceLotVolume = numericStateVolume(sourceLot.currentVolume, `Source lot ${sourceLot.id}`);
    if (sourceLotVolume + EPSILON < payload.lossLiters) {
      throw new TransferCommandError(
        'lot_volume_inconsistent',
        'Stored source lot volume is smaller than the recorded transfer loss.',
        409,
      );
    }
    const updatedSourceLot = stamped({
      ...sourceLot,
      lastCommandId: context.commandId,
      currentVolume: roundedLiters(sourceLotVolume - payload.lossLiters),
      history: [{
        date: operationDate,
        type: 'Liquid Transfer',
        description: `Pumped ${payload.volumeLiters} L from ${source.id} to ${destination.id}; ${payload.lossLiters} L process loss.`,
        operator: payload.operator,
        sourceRef: payload.transferId,
      }, ...(sourceLot.history || [])],
    }, timestamp);
    changedLots.push(updatedSourceLot);
    details = `Transferred ${payload.volumeLiters} L from ${source.id} to ${destination.id}; ${arrivalLiters} L arrived.`;
  }

  const updatedSource = stamped({
    ...source,
    lastCommandId: context.commandId,
    currentVolume: finalSourceVolume,
    assignedLotId: finalSourceVolume === 0 ? null : source.assignedLotId,
    cleaningStatus: finalSourceVolume === 0 ? 'dirty' as const : source.cleaningStatus,
    lastOperation: `Transferred wine to ${destination.id}`,
  }, timestamp);
  const updatedDestination = stamped({
    ...destination,
    lastCommandId: context.commandId,
    currentVolume: finalDestinationVolume,
    assignedLotId: finalDestinationLotId,
    lastOperation: `Received wine transfer from ${source.id}`,
  }, timestamp);

  const transfer = stamped<CellarTransferRecord>({
    id: payload.transferId,
    commandId: context.commandId,
    recordKind: 'transfer',
    lineageVersion: 1,
    sourceLotId: sourceLot.id,
    resultLotId: finalDestinationLotId,
    sourceContributionL: payload.volumeLiters,
    arrivalVolumeL: arrivalLiters,
    reversalSnapshot: {
      version: 1,
      sourceVessel: vesselReversalSnapshot(source),
      destinationVessel: vesselReversalSnapshot(destination),
      sourceLot: lotReversalSnapshot(sourceLot),
      ...(destinationLot ? { destinationLot: lotReversalSnapshot(destinationLot) } : {}),
      ...(isBlend ? { createdBlendLotId: payload.blendLotId } : {}),
    },
    ...(destinationLot ? { destinationLotId: destinationLot.id } : {}),
    ...(isBlend ? { destinationContributionL: destinationVolume } : {}),
    sourceId: source.id,
    destId: destination.id,
    volume: payload.volumeLiters,
    loss: payload.lossLiters,
    operator: payload.operator || context.actorUsername,
    category: isBlend ? 'blend' : payload.category,
    date: operationDate,
    pump: payload.pump,
    details,
  }, timestamp);

  const changedLotById = new Map(changedLots.map(lot => [lot.id, lot]));
  const nextLots = currentState.lots.map(lot => changedLotById.get(lot.id) || lot);
  for (const lot of changedLots) {
    if (!currentState.lots.some(existing => existing.id === lot.id)) nextLots.push(lot);
  }

  return {
    state: {
      vessels: currentState.vessels.map(vessel => {
        if (vessel.id === updatedSource.id) return updatedSource;
        if (vessel.id === updatedDestination.id) return updatedDestination;
        return vessel;
      }),
      lots: nextLots,
      transfers: [transfer, ...currentState.transfers],
    },
    result: {
      transfer,
      sourceVessel: updatedSource,
      destinationVessel: updatedDestination,
      changedLots,
      ...(isBlend ? { blendLotId: finalDestinationLotId } : {}),
      receipt: {
        kind: isBlend ? 'blend' : 'transfer',
        sourceVesselId: source.id,
        destinationVesselId: destination.id,
        volumeLiters: payload.volumeLiters,
        arrivalLiters,
        lossLiters: payload.lossLiters,
        destinationLotId: finalDestinationLotId,
      },
    },
  };
}
