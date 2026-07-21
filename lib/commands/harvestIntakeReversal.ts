import { signAuditEntries } from '../auditHash';
import type { CostEntry } from '../costing';
import type { StockMovement } from '../storage';
import type {
  BottlingRunRecord,
  CellarOperation,
  CellarTransferRecord,
  CertificationRecord,
  DailyFermLog,
  DocumentAttachment,
  GrapeIntakeRecord,
  HarvestIntakeReversalSnapshot,
  HarvestRecord,
  LabAnalysis,
  MaraniOSAuditLog,
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

export const HARVEST_INTAKE_REVERSAL_COMMAND_TYPE = 'cellar.harvest-intake.reverse' as const;

export interface HarvestIntakeReversalCommandPayload extends CommandReversalReferencePayload {
  reversalIntakeId: string;
  auditId: string;
  costReversalId: string;
}

export interface HarvestIntakeReversalCommandState {
  harvests: HarvestRecord[];
  lots: WineLot[];
  vessels: Vessel[];
  grapeIntakes: GrapeIntakeRecord[];
  costEntries: CostEntry[];
  auditLogs: MaraniOSAuditLog[];
  cellarOps: CellarOperation[];
  fermLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  transfers: CellarTransferRecord[];
  bottlingRuns: BottlingRunRecord[];
  certificationRecords: CertificationRecord[];
  stockMovements: StockMovement[];
  salesOrders: SalesOrderRecord[];
  salesDispatches: SalesDispatchRecord[];
  attachments: DocumentAttachment[];
}

export interface HarvestIntakeReversalCommandContext {
  commandId: string;
  actorUsername: string;
  performedAt: Date;
}

export interface HarvestIntakeReversalCommandResult {
  originalIntake: GrapeIntakeRecord;
  reversalIntake: GrapeIntakeRecord;
  voidedLot: WineLot;
  updatedHarvest?: HarvestRecord;
  updatedVessel?: Vessel;
  reversalCostEntry?: CostEntry;
  updatedOriginalCostEntry?: CostEntry;
  auditLog: MaraniOSAuditLog;
  stateVersion?: number;
  receipt: CommandReversalReceipt & {
    kind: 'harvest_intake_reversal';
    originalIntakeId: string;
    reversalIntakeId: string;
    voidedLotId: string;
    reversedNetWeightKg: number;
    reversedVolumeL: number;
    reversedCostAmount: number;
  };
}

export interface AppliedHarvestIntakeReversalCommand {
  state: HarvestIntakeReversalCommandState;
  result: HarvestIntakeReversalCommandResult;
}

export type HarvestIntakeReversalCommandErrorCode =
  | 'invalid_harvest_intake_reversal_payload'
  | 'organization_state_not_found'
  | 'harvest_intake_not_found'
  | 'harvest_intake_not_command_created'
  | 'harvest_intake_already_reversed'
  | 'harvest_intake_reversal_snapshot_missing'
  | 'harvest_intake_reversal_dependency_conflict'
  | 'harvest_intake_reversal_resource_missing'
  | 'harvest_intake_reversal_id_conflict';

export class HarvestIntakeReversalCommandError extends Error {
  constructor(
    public readonly code: HarvestIntakeReversalCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'HarvestIntakeReversalCommandError';
  }
}

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EPSILON = 0.000_001;

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new HarvestIntakeReversalCommandError(
      'invalid_harvest_intake_reversal_payload',
      `${field} must be 1-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
      400,
    );
  }
  return normalized;
}

function sameNumber(actual: unknown, expected: number): boolean {
  return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= EPSILON;
}

function dependencyConflict(resource: string): never {
  throw new HarvestIntakeReversalCommandError(
    'harvest_intake_reversal_dependency_conflict',
    `${resource} changed or gained dependent work after the original intake. Correct later work before retrying this reversal.`,
    409,
  );
}

function validSnapshot(value: unknown): value is HarvestIntakeReversalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as HarvestIntakeReversalSnapshot;
  return snapshot.version === 1
    && Boolean(snapshot.lot && RECORD_ID_PATTERN.test(snapshot.lot.id || ''))
    && Number.isFinite(snapshot.lot.initialVolume) && snapshot.lot.initialVolume > 0
    && Number.isFinite(snapshot.lot.currentVolume) && snapshot.lot.currentVolume > 0
    && typeof snapshot.lot.stage === 'string'
    && typeof snapshot.lot.historyDescription === 'string' && snapshot.lot.historyDescription.length > 0
    && RECORD_ID_PATTERN.test(snapshot.auditId || '')
    && (!snapshot.harvest || (RECORD_ID_PATTERN.test(snapshot.harvest.id || '')
      && typeof snapshot.harvest.sentToGvino === 'boolean'))
    && (!snapshot.vessel || (RECORD_ID_PATTERN.test(snapshot.vessel.id || '')
      && Number.isFinite(snapshot.vessel.currentVolume)
      && Number.isFinite(snapshot.vessel.temperature)
      && typeof snapshot.vessel.lastOperation === 'string'))
    && (!snapshot.costEntry || (RECORD_ID_PATTERN.test(snapshot.costEntry.id || '')
      && Number.isFinite(snapshot.costEntry.amount) && snapshot.costEntry.amount > 0
      && typeof snapshot.costEntry.currency === 'string' && snapshot.costEntry.currency.length > 0));
}

export function parseHarvestIntakeReversalCommandPayload(value: unknown): HarvestIntakeReversalCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HarvestIntakeReversalCommandError(
      'invalid_harvest_intake_reversal_payload',
      'Harvest intake reversal payload must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > REVERSAL_REASON_MAX_LENGTH) {
    throw new HarvestIntakeReversalCommandError(
      'invalid_harvest_intake_reversal_payload',
      `reason is required and must not exceed ${REVERSAL_REASON_MAX_LENGTH} characters.`,
      400,
    );
  }
  return {
    reversalIntakeId: requiredRecordId(input.reversalIntakeId, 'reversalIntakeId'),
    auditId: requiredRecordId(input.auditId, 'auditId'),
    costReversalId: requiredRecordId(input.costReversalId, 'costReversalId'),
    originalCommandId: requiredRecordId(input.originalCommandId, 'originalCommandId'),
    reason,
  };
}

function assertState(state: HarvestIntakeReversalCommandState): void {
  const arrays: Array<keyof HarvestIntakeReversalCommandState> = [
    'harvests', 'lots', 'vessels', 'grapeIntakes', 'costEntries', 'auditLogs',
    'cellarOps', 'fermLogs', 'labLogs', 'transfers', 'bottlingRuns',
    'certificationRecords', 'stockMovements', 'salesOrders', 'salesDispatches', 'attachments',
  ];
  if (!state || arrays.some(key => !Array.isArray(state[key]))) {
    throw new HarvestIntakeReversalCommandError(
      'invalid_harvest_intake_reversal_payload',
      'Organization harvest-intake state is unavailable.',
      400,
    );
  }
}

function hasLotDependency(state: HarvestIntakeReversalCommandState, lotId: string, intakeId: string, costId?: string): boolean {
  return state.cellarOps.some(item => item.lotId === lotId)
    || state.fermLogs.some(item => item.lotId === lotId)
    || state.labLogs.some(item => item.lotId === lotId)
    || state.transfers.some(item => item.sourceLotId === lotId || item.destinationLotId === lotId || item.resultLotId === lotId)
    || state.bottlingRuns.some(item => item.lotId === lotId)
    || state.certificationRecords.some(item => item.lotId === lotId)
    || state.stockMovements.some(item => item.lotId === lotId)
    || state.salesOrders.some(item => item.lotId === lotId)
    || state.salesDispatches.some(item => item.lotId === lotId)
    || state.costEntries.some(item => item.lotId === lotId && item.id !== costId)
    || state.attachments.some(item => item.linkedRecordId === lotId || item.linkedRecordId === intakeId);
}

function restoredHarvest(current: HarvestRecord, snapshot: NonNullable<HarvestIntakeReversalSnapshot['harvest']>, commandId: string, timestamp: string): HarvestRecord {
  const restored: HarvestRecord = {
    ...current,
    sentToGvino: snapshot.sentToGvino,
    lastCommandId: commandId,
    lastModified: timestamp,
  };
  if (snapshot.actualHarvestedKg === null) delete restored.actualHarvestedKg;
  else restored.actualHarvestedKg = snapshot.actualHarvestedKg;
  if (snapshot.actualHarvestDate === null) delete restored.actualHarvestDate;
  else restored.actualHarvestDate = snapshot.actualHarvestDate;
  if (snapshot.associatedLotId === null) delete restored.associatedLotId;
  else restored.associatedLotId = snapshot.associatedLotId;
  return restored;
}

export function applyHarvestIntakeReversalCommand(
  currentState: HarvestIntakeReversalCommandState,
  rawPayload: unknown,
  context: HarvestIntakeReversalCommandContext,
): AppliedHarvestIntakeReversalCommand {
  const payload = parseHarvestIntakeReversalCommandPayload(rawPayload);
  assertState(currentState);
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new HarvestIntakeReversalCommandError(
      'invalid_harvest_intake_reversal_payload',
      'Harvest intake reversal execution time is invalid.',
      400,
    );
  }
  if (currentState.grapeIntakes.some(item => item.id === payload.reversalIntakeId)
    || currentState.auditLogs.some(item => item.id === payload.auditId)
    || currentState.costEntries.some(item => item.id === payload.costReversalId)) {
    throw new HarvestIntakeReversalCommandError(
      'harvest_intake_reversal_id_conflict',
      'A harvest-intake reversal record id already exists.',
      409,
    );
  }

  const original = currentState.grapeIntakes.find(item => (
    item.recordKind !== 'reversal' && item.commandId === payload.originalCommandId
  ));
  if (!original) {
    const legacy = currentState.grapeIntakes.find(item => item.id === payload.originalCommandId);
    throw new HarvestIntakeReversalCommandError(
      legacy ? 'harvest_intake_not_command_created' : 'harvest_intake_not_found',
      legacy
        ? 'Legacy grape intakes without durable command provenance cannot be reversed safely.'
        : 'The original grape-intake command was not found in this organization.',
      legacy ? 409 : 404,
    );
  }
  if (!original.commandId || !original.lastModified) {
    throw new HarvestIntakeReversalCommandError(
      'harvest_intake_not_command_created',
      'The grape intake does not contain complete durable command provenance.',
      409,
    );
  }
  if (original.reversedByCommandId || original.reversedAt
    || currentState.grapeIntakes.some(item => item.reversalOfIntakeId === original.id)) {
    throw new HarvestIntakeReversalCommandError(
      'harvest_intake_already_reversed',
      'The grape intake has already been reversed.',
      409,
    );
  }
  if (!validSnapshot(original.reversalSnapshot)) {
    throw new HarvestIntakeReversalCommandError(
      'harvest_intake_reversal_snapshot_missing',
      'This grape intake predates complete restoration metadata and cannot be compensated safely.',
      409,
    );
  }
  const snapshot = original.reversalSnapshot;
  const timestamp = context.performedAt.toISOString();
  const correctionDate = timestamp.slice(0, 10);

  const lot = currentState.lots.find(item => item.id === snapshot.lot.id);
  if (!lot) {
    throw new HarvestIntakeReversalCommandError(
      'harvest_intake_reversal_resource_missing',
      `Wine lot ${snapshot.lot.id} no longer exists.`,
      409,
    );
  }
  if (lot.id !== original.createdLotId
    || lot.commandId !== original.commandId
    || lot.lastCommandId !== original.commandId
    || lot.lastModified !== original.lastModified
    || !sameNumber(lot.initialVolume, snapshot.lot.initialVolume)
    || !sameNumber(lot.currentVolume, snapshot.lot.currentVolume)
    || lot.stage !== snapshot.lot.stage
    || lot.history?.length !== 1
    || lot.history[0]?.sourceRef !== original.id
    || lot.history[0]?.description !== snapshot.lot.historyDescription
    || lot.voidedAt || lot.voidedByCommandId) {
    dependencyConflict(`Wine lot ${lot.id}`);
  }
  if (hasLotDependency(currentState, lot.id, original.id, snapshot.costEntry?.id)) {
    dependencyConflict(`Wine lot ${lot.id}`);
  }

  let harvest: HarvestRecord | undefined;
  if (snapshot.harvest) {
    harvest = currentState.harvests.find(item => item.id === snapshot.harvest?.id);
    if (!harvest) {
      throw new HarvestIntakeReversalCommandError(
        'harvest_intake_reversal_resource_missing',
        `Harvest ${snapshot.harvest.id} no longer exists.`,
        409,
      );
    }
    if (original.harvestRecordId !== harvest.id || harvest.sentToGvino !== true
      || harvest.associatedLotId !== lot.id || !sameNumber(harvest.actualHarvestedKg, original.netWeightKg)
      || harvest.actualHarvestDate !== original.date || harvest.lastCommandId !== original.commandId
      || harvest.lastModified !== original.lastModified) {
      dependencyConflict(`Harvest ${harvest.id}`);
    }
  } else if (original.harvestRecordId) {
    dependencyConflict(`Harvest snapshot for intake ${original.id}`);
  }

  let vessel: Vessel | undefined;
  if (snapshot.vessel) {
    vessel = currentState.vessels.find(item => item.id === snapshot.vessel?.id);
    if (!vessel) {
      throw new HarvestIntakeReversalCommandError(
        'harvest_intake_reversal_resource_missing',
        `Vessel ${snapshot.vessel.id} no longer exists.`,
        409,
      );
    }
    if (original.destinationVesselId !== vessel.id || vessel.assignedLotId !== lot.id
      || !sameNumber(vessel.currentVolume, original.estimatedVolumeL)
      || vessel.lastCommandId !== original.commandId || vessel.lastModified !== original.lastModified
      || vessel.lastOperation !== `Grape intake: ${original.variety} (${original.estimatedVolumeL} L must)`) {
      dependencyConflict(`Vessel ${vessel.id}`);
    }
  } else if (original.destinationVesselId) {
    dependencyConflict(`Vessel snapshot for intake ${original.id}`);
  }

  const linkedCosts = currentState.costEntries.filter(entry => entry.sourceRef === original.id && entry.recordKind !== 'reversal');
  let originalCost: CostEntry | undefined;
  if (snapshot.costEntry) {
    originalCost = linkedCosts.find(entry => entry.id === snapshot.costEntry?.id);
    if (!originalCost || linkedCosts.length !== 1 || originalCost.commandId !== original.commandId
      || originalCost.lastModified !== original.lastModified || originalCost.currency !== snapshot.costEntry.currency
      || !sameNumber(originalCost.amount, snapshot.costEntry.amount)
      || originalCost.reversedAt || originalCost.reversedByCommandId) {
      dependencyConflict(`Cost ledger for intake ${original.id}`);
    }
  } else if (linkedCosts.length > 0) {
    dependencyConflict(`Cost ledger for intake ${original.id}`);
  }
  const originalAudit = currentState.auditLogs.find(item => item.id === snapshot.auditId);
  if (!originalAudit || originalAudit.commandId !== original.commandId
    || originalAudit.lastModified !== original.lastModified
    || originalAudit.changedItem !== `WineLot ${lot.id}`) {
    dependencyConflict(`Audit record ${snapshot.auditId}`);
  }

  const correctionDescription = `Reversal of grape intake ${original.id}: ${payload.reason}`;
  const voidedLot: WineLot = {
    ...lot,
    currentVolume: 0,
    history: [{
      date: correctionDate,
      type: 'Grape Intake Reversal',
      description: correctionDescription,
      operator: context.actorUsername,
      sourceRef: payload.reversalIntakeId,
    }, ...(lot.history || [])],
    lastCommandId: context.commandId,
    lastModified: timestamp,
    voidedAt: timestamp,
    voidedByCommandId: context.commandId,
    voidReason: payload.reason,
  };
  const updatedHarvest = harvest && snapshot.harvest
    ? restoredHarvest(harvest, snapshot.harvest, context.commandId, timestamp)
    : undefined;
  const updatedVessel: Vessel | undefined = vessel && snapshot.vessel ? {
    ...vessel,
    currentVolume: snapshot.vessel.currentVolume,
    assignedLotId: snapshot.vessel.assignedLotId,
    temperature: snapshot.vessel.temperature,
    lastOperation: snapshot.vessel.lastOperation,
    lastCommandId: context.commandId,
    lastModified: timestamp,
  } : undefined;
  const updatedOriginal: GrapeIntakeRecord = {
    ...original,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastModified: timestamp,
  };
  const {
    reversalSnapshot: _snapshot,
    reversedByCommandId: _reversedBy,
    reversedAt: _reversedAt,
    ...originalFacts
  } = original;
  const reversalIntake: GrapeIntakeRecord = {
    ...originalFacts,
    id: payload.reversalIntakeId,
    commandId: context.commandId,
    recordKind: 'reversal',
    lastModified: timestamp,
    date: correctionDate,
    operator: context.actorUsername,
    notes: payload.reason,
    reversalOfIntakeId: original.id,
    reversalOfCommandId: original.commandId,
    reversalReason: payload.reason,
  };

  const updatedOriginalCostEntry: CostEntry | undefined = originalCost ? {
    ...originalCost,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastModified: timestamp,
  } : undefined;
  const originalCostFacts = originalCost ? (() => {
    const {
      reversedByCommandId: _reversedByCommandId,
      reversedAt: _reversedAt,
      reversalReason: _reversalReason,
      reversalOfCostEntryId: _reversalOfCostEntryId,
      reversalOfCommandId: _reversalOfCommandId,
      ...facts
    } = originalCost;
    return facts;
  })() : undefined;
  const reversalCostEntry: CostEntry | undefined = originalCost && originalCostFacts ? {
    ...originalCostFacts,
    id: payload.costReversalId,
    commandId: context.commandId,
    recordKind: 'reversal',
    lastModified: timestamp,
    date: correctionDate,
    description: `Reversal: ${originalCost.description}`,
    amount: -Math.abs(originalCost.amount),
    ...(typeof originalCost.quantity === 'number' ? { quantity: -Math.abs(originalCost.quantity) } : {}),
    sourceRef: reversalIntake.id,
    createdBy: context.actorUsername,
    reversalOfCostEntryId: originalCost.id,
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
    actionType: 'Grape Receiving Reversal',
    changedItem: `WineLot ${lot.id}`,
    oldValue: `${original.netWeightKg} kg ${original.variety} → ${original.estimatedVolumeL} L must`,
    newValue: 'Voided; linked harvest and vessel restored',
    notes: correctionDescription,
  };
  const auditLog = signAuditEntries([unsignedAudit], currentState.auditLogs)[0];
  const costUpdates = new Map(updatedOriginalCostEntry ? [[updatedOriginalCostEntry.id, updatedOriginalCostEntry]] : []);

  return {
    state: {
      ...currentState,
      harvests: updatedHarvest
        ? currentState.harvests.map(item => item.id === updatedHarvest.id ? updatedHarvest : item)
        : currentState.harvests,
      lots: currentState.lots.map(item => item.id === voidedLot.id ? voidedLot : item),
      vessels: updatedVessel
        ? currentState.vessels.map(item => item.id === updatedVessel.id ? updatedVessel : item)
        : currentState.vessels,
      grapeIntakes: [
        reversalIntake,
        ...currentState.grapeIntakes.map(item => item.id === updatedOriginal.id ? updatedOriginal : item),
      ],
      costEntries: [
        ...(reversalCostEntry ? [reversalCostEntry] : []),
        ...currentState.costEntries.map(item => costUpdates.get(item.id) || item),
      ],
      auditLogs: [auditLog, ...currentState.auditLogs],
    },
    result: {
      originalIntake: updatedOriginal,
      reversalIntake,
      voidedLot,
      ...(updatedHarvest ? { updatedHarvest } : {}),
      ...(updatedVessel ? { updatedVessel } : {}),
      ...(reversalCostEntry ? { reversalCostEntry } : {}),
      ...(updatedOriginalCostEntry ? { updatedOriginalCostEntry } : {}),
      auditLog,
      receipt: {
        kind: 'harvest_intake_reversal',
        originalCommandId: original.commandId,
        reversalCommandId: context.commandId,
        reason: payload.reason,
        reversedAt: timestamp,
        originalIntakeId: original.id,
        reversalIntakeId: reversalIntake.id,
        voidedLotId: lot.id,
        reversedNetWeightKg: original.netWeightKg,
        reversedVolumeL: original.estimatedVolumeL,
        reversedCostAmount: originalCost?.amount || 0,
      },
    },
  };
}
