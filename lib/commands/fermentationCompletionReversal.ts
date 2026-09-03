import { signAuditEntries } from '../auditHash';
import type {
  BottlingRunRecord,
  CellarOperation,
  CellarTransferRecord,
  CertificationRecord,
  DailyFermLog,
  DocumentAttachment,
  FermentationCompletionReversalSnapshot,
  MaraniOSAuditLog,
  Vessel,
  WineLot,
} from '../wineryState';
import {
  REVERSAL_REASON_MAX_LENGTH,
  type CommandReversalReceipt,
  type CommandReversalReferencePayload,
} from './reversal';

export const FERMENTATION_COMPLETION_REVERSAL_COMMAND_TYPE = 'cellar.fermentation-complete.reverse' as const;

export interface FermentationCompletionReversalCommandPayload extends CommandReversalReferencePayload {
  reversalLogId: string;
  auditId: string;
}

export interface FermentationCompletionReversalCommandState {
  lots: WineLot[];
  vessels: Vessel[];
  fermlogs: DailyFermLog[];
  auditLogs: MaraniOSAuditLog[];
  cellarOps: CellarOperation[];
  transfers: CellarTransferRecord[];
  bottlingRuns: BottlingRunRecord[];
  certificationRecords: CertificationRecord[];
  attachments: DocumentAttachment[];
}

export interface FermentationCompletionReversalCommandContext {
  commandId: string;
  actorUsername: string;
  performedAt: Date;
}

export interface FermentationCompletionReversalCommandResult {
  originalLog: DailyFermLog;
  reversalLog: DailyFermLog;
  lot: WineLot;
  vessel: Vessel;
  auditLog: MaraniOSAuditLog;
  stateVersion?: number;
  receipt: CommandReversalReceipt & {
    kind: 'fermentation_completion_reversal';
    originalLogId: string;
    reversalLogId: string;
    lotId: string;
    vesselId: string;
    fromStage: 'stabilization';
    toStage: 'fermenting';
  };
}

export interface AppliedFermentationCompletionReversalCommand {
  state: FermentationCompletionReversalCommandState;
  result: FermentationCompletionReversalCommandResult;
}

export type FermentationCompletionReversalCommandErrorCode =
  | 'invalid_fermentation_completion_reversal_payload'
  | 'organization_state_not_found'
  | 'fermentation_completion_not_found'
  | 'fermentation_completion_not_command_created'
  | 'fermentation_completion_already_reversed'
  | 'fermentation_completion_reversal_snapshot_missing'
  | 'fermentation_completion_reversal_dependency_conflict'
  | 'fermentation_completion_reversal_resource_missing'
  | 'fermentation_completion_reversal_id_conflict';

export class FermentationCompletionReversalCommandError extends Error {
  constructor(
    public readonly code: FermentationCompletionReversalCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'FermentationCompletionReversalCommandError';
  }
}

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EPSILON = 0.000_001;

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new FermentationCompletionReversalCommandError(
      'invalid_fermentation_completion_reversal_payload',
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
  throw new FermentationCompletionReversalCommandError(
    'fermentation_completion_reversal_dependency_conflict',
    `${resource} changed or gained dependent work after fermentation was completed. Correct later work before retrying this reversal.`,
    409,
  );
}

function validSnapshot(value: unknown): value is FermentationCompletionReversalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as FermentationCompletionReversalSnapshot;
  return snapshot.version === 1
    && RECORD_ID_PATTERN.test(snapshot.lot?.id || '')
    && snapshot.lot.stage === 'fermenting'
    && Number.isFinite(snapshot.lot.currentVolume) && snapshot.lot.currentVolume > 0
    && typeof snapshot.lot.historyDescription === 'string' && snapshot.lot.historyDescription.length > 0
    && RECORD_ID_PATTERN.test(snapshot.vessel?.id || '')
    && Number.isFinite(snapshot.vessel.currentVolume) && snapshot.vessel.currentVolume > 0
    && typeof snapshot.vessel.lastOperation === 'string'
    && RECORD_ID_PATTERN.test(snapshot.finalLog?.id || '')
    && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.finalLog.date || '')
    && Number.isFinite(snapshot.finalLog.temperature)
    && Number.isFinite(snapshot.finalLog.density)
    && Number.isFinite(snapshot.finalLog.sugar)
    && Number.isFinite(snapshot.finalLog.ph)
    && typeof snapshot.finalLog.tastingNotes === 'string'
    && typeof snapshot.finalLog.capManagement === 'string'
    && typeof snapshot.finalLog.additives === 'string'
    && RECORD_ID_PATTERN.test(snapshot.auditId || '');
}

export function parseFermentationCompletionReversalCommandPayload(
  value: unknown,
): FermentationCompletionReversalCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FermentationCompletionReversalCommandError(
      'invalid_fermentation_completion_reversal_payload',
      'Fermentation-completion reversal payload must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > REVERSAL_REASON_MAX_LENGTH) {
    throw new FermentationCompletionReversalCommandError(
      'invalid_fermentation_completion_reversal_payload',
      `reason is required and must not exceed ${REVERSAL_REASON_MAX_LENGTH} characters.`,
      400,
    );
  }
  return {
    reversalLogId: requiredRecordId(input.reversalLogId, 'reversalLogId'),
    auditId: requiredRecordId(input.auditId, 'auditId'),
    originalCommandId: requiredRecordId(input.originalCommandId, 'originalCommandId'),
    reason,
  };
}

function assertState(state: FermentationCompletionReversalCommandState): void {
  const arrays: Array<keyof FermentationCompletionReversalCommandState> = [
    'lots', 'vessels', 'fermlogs', 'auditLogs', 'cellarOps', 'transfers',
    'bottlingRuns', 'certificationRecords', 'attachments',
  ];
  if (!state || arrays.some(key => !Array.isArray(state[key]))) {
    throw new FermentationCompletionReversalCommandError(
      'invalid_fermentation_completion_reversal_payload',
      'Organization fermentation state is unavailable.',
      400,
    );
  }
}

function hasLaterDependency(
  state: FermentationCompletionReversalCommandState,
  original: DailyFermLog,
  snapshot: FermentationCompletionReversalSnapshot,
): boolean {
  const completedAt = original.completedAt || original.lastModified || '';
  const lotId = snapshot.lot.id;
  return state.cellarOps.some(item => item.lotId === lotId && item.date > completedAt)
    || state.transfers.some(item => (
      item.sourceLotId === lotId || item.destinationLotId === lotId || item.resultLotId === lotId
    ) && (item.lastModified ? item.lastModified > completedAt : item.date > snapshot.finalLog.date))
    || state.bottlingRuns.some(item => item.lotId === lotId && item.recordKind !== 'reversal')
    || state.certificationRecords.some(item => item.lotId === lotId)
    || state.attachments.some(item => (
      item.linkedRecordId === original.id
      || item.linkedRecordId === snapshot.auditId
      || (item.linkedRecordId === lotId && item.uploadedAt > completedAt)
    ));
}

export function applyFermentationCompletionReversalCommand(
  currentState: FermentationCompletionReversalCommandState,
  rawPayload: unknown,
  context: FermentationCompletionReversalCommandContext,
): AppliedFermentationCompletionReversalCommand {
  const payload = parseFermentationCompletionReversalCommandPayload(rawPayload);
  assertState(currentState);
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new FermentationCompletionReversalCommandError(
      'invalid_fermentation_completion_reversal_payload',
      'Fermentation-completion reversal execution time is invalid.',
      400,
    );
  }
  if (currentState.fermlogs.some(item => item.id === payload.reversalLogId)
    || currentState.auditLogs.some(item => item.id === payload.auditId)) {
    throw new FermentationCompletionReversalCommandError(
      'fermentation_completion_reversal_id_conflict',
      'A fermentation-completion reversal record id already exists.',
      409,
    );
  }

  const original = currentState.fermlogs.find(item => (
    item.recordKind !== 'reversal' && item.commandId === payload.originalCommandId && item.isCompletion === true
  ));
  if (!original) {
    const legacy = currentState.fermlogs.find(item => item.id === payload.originalCommandId);
    throw new FermentationCompletionReversalCommandError(
      legacy ? 'fermentation_completion_not_command_created' : 'fermentation_completion_not_found',
      legacy
        ? 'Legacy fermentation completions without durable command provenance cannot be reversed safely.'
        : 'The original fermentation-completion command was not found in this organization.',
      legacy ? 409 : 404,
    );
  }
  if (!original.commandId || !original.lastModified || !original.completedAt) {
    throw new FermentationCompletionReversalCommandError(
      'fermentation_completion_not_command_created',
      'The fermentation completion does not contain complete durable command provenance.',
      409,
    );
  }
  if (original.reversedByCommandId || original.reversedAt
    || currentState.fermlogs.some(item => item.reversalOfLogId === original.id)) {
    throw new FermentationCompletionReversalCommandError(
      'fermentation_completion_already_reversed',
      'The fermentation completion has already been reversed.',
      409,
    );
  }
  if (!validSnapshot(original.completionSnapshot)) {
    throw new FermentationCompletionReversalCommandError(
      'fermentation_completion_reversal_snapshot_missing',
      'This fermentation completion predates complete restoration metadata and cannot be compensated safely.',
      409,
    );
  }
  const snapshot = original.completionSnapshot;

  const lot = currentState.lots.find(item => item.id === snapshot.lot.id);
  if (!lot) {
    throw new FermentationCompletionReversalCommandError(
      'fermentation_completion_reversal_resource_missing',
      `Wine lot ${snapshot.lot.id} no longer exists.`,
      409,
    );
  }
  if (lot.stage !== 'stabilization' || !sameNumber(lot.currentVolume, snapshot.lot.currentVolume)
    || lot.lastCommandId !== original.commandId || lot.lastModified !== original.lastModified
    || lot.history?.[0]?.sourceRef !== original.id
    || lot.history?.[0]?.type !== 'Fermentation Concluded'
    || lot.history?.[0]?.description !== snapshot.lot.historyDescription) {
    dependencyConflict(`Wine lot ${lot.id}`);
  }

  const vessel = currentState.vessels.find(item => item.id === snapshot.vessel.id);
  if (!vessel) {
    throw new FermentationCompletionReversalCommandError(
      'fermentation_completion_reversal_resource_missing',
      `Vessel ${snapshot.vessel.id} no longer exists.`,
      409,
    );
  }
  const expectedOperation = `Fermentation completed for lot ${lot.id}; moved to stabilization`;
  if (vessel.assignedLotId !== snapshot.vessel.assignedLotId
    || !sameNumber(vessel.currentVolume, snapshot.vessel.currentVolume)
    || vessel.lastOperation !== expectedOperation
    || vessel.lastCommandId !== original.commandId || vessel.lastModified !== original.lastModified) {
    dependencyConflict(`Vessel ${vessel.id}`);
  }

  const finalFacts = snapshot.finalLog;
  if (original.id !== finalFacts.id || original.lotId !== lot.id || original.tankId !== vessel.id
    || original.recordKind !== 'completion' || original.lastModified !== original.completedAt
    || original.date !== finalFacts.date || !sameNumber(original.temperature, finalFacts.temperature)
    || !sameNumber(original.density, finalFacts.density) || !sameNumber(original.sugar, finalFacts.sugar)
    || !sameNumber(original.ph, finalFacts.ph) || original.tastingNotes !== finalFacts.tastingNotes
    || original.capManagement !== finalFacts.capManagement || original.additives !== finalFacts.additives) {
    dependencyConflict(`Final fermentation reading ${original.id}`);
  }
  const originalAudit = currentState.auditLogs.find(item => item.id === snapshot.auditId);
  if (!originalAudit || originalAudit.commandId !== original.commandId
    || originalAudit.lastModified !== original.lastModified
    || originalAudit.changedItem !== `WineLot ${lot.id}`) {
    dependencyConflict(`Audit record ${snapshot.auditId}`);
  }
  if (hasLaterDependency(currentState, original, snapshot)) {
    dependencyConflict(`Fermentation completion for lot ${lot.id}`);
  }

  const timestamp = context.performedAt.toISOString();
  const correctionDate = timestamp.slice(0, 10);
  const correctionDescription = `Reversal of fermentation completion ${original.id}: ${payload.reason}`;
  const updatedLot: WineLot = {
    ...lot,
    stage: snapshot.lot.stage,
    lastCommandId: context.commandId,
    lastModified: timestamp,
    history: [{
      date: correctionDate,
      type: 'correction',
      description: correctionDescription,
      operator: context.actorUsername,
      sourceRef: payload.reversalLogId,
    }, ...(lot.history || [])],
  };
  const updatedVessel: Vessel = {
    ...vessel,
    currentVolume: snapshot.vessel.currentVolume,
    assignedLotId: snapshot.vessel.assignedLotId,
    lastOperation: snapshot.vessel.lastOperation,
    lastCommandId: context.commandId,
    lastModified: timestamp,
  };
  const updatedOriginal: DailyFermLog = {
    ...original,
    reversedByCommandId: context.commandId,
    reversedAt: timestamp,
    reversalReason: payload.reason,
    lastModified: timestamp,
  };
  const reversalLog: DailyFermLog = {
    id: payload.reversalLogId,
    commandId: context.commandId,
    recordKind: 'reversal',
    lastModified: timestamp,
    tankId: original.tankId,
    lotId: original.lotId,
    date: correctionDate,
    temperature: original.temperature,
    density: original.density,
    sugar: original.sugar,
    ph: original.ph,
    tastingNotes: correctionDescription,
    capManagement: 'correction',
    additives: '',
    isCompletion: false,
    reversalOfLogId: original.id,
    reversalOfCommandId: original.commandId,
    reversalReason: payload.reason,
  };
  const unsignedAudit: MaraniOSAuditLog = {
    id: payload.auditId,
    commandId: context.commandId,
    lastModified: timestamp,
    timestamp,
    user: context.actorUsername,
    module: 'GVINO',
    actionType: 'Fermentation Completion Reversal',
    changedItem: `WineLot ${lot.id}`,
    oldValue: 'stabilization',
    newValue: 'fermenting',
    notes: `${correctionDescription}. Vessel ${vessel.id} was restored to its pre-completion operation state.`,
  };
  const auditLog = signAuditEntries([unsignedAudit], currentState.auditLogs)[0];

  return {
    state: {
      ...currentState,
      lots: currentState.lots.map(item => item.id === lot.id ? updatedLot : item),
      vessels: currentState.vessels.map(item => item.id === vessel.id ? updatedVessel : item),
      fermlogs: [reversalLog, ...currentState.fermlogs.map(item => item.id === original.id ? updatedOriginal : item)],
      auditLogs: [auditLog, ...currentState.auditLogs],
    },
    result: {
      originalLog: updatedOriginal,
      reversalLog,
      lot: updatedLot,
      vessel: updatedVessel,
      auditLog,
      receipt: {
        kind: 'fermentation_completion_reversal',
        originalCommandId: original.commandId,
        reversalCommandId: context.commandId,
        reason: payload.reason,
        reversedAt: timestamp,
        originalLogId: original.id,
        reversalLogId: reversalLog.id,
        lotId: lot.id,
        vesselId: vessel.id,
        fromStage: 'stabilization',
        toStage: 'fermenting',
      },
    },
  };
}
