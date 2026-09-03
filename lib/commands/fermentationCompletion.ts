import { signAuditEntries } from '../auditHash';
import type {
  DailyFermLog,
  FermentationCompletionReversalSnapshot,
  MaraniOSAuditLog,
  Vessel,
  WineLot,
} from '../wineryState';

export const FERMENTATION_COMPLETION_COMMAND_TYPE = 'cellar.fermentation-complete' as const;

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface FermentationCompletionCommandPayload {
  lotId: string;
  vesselId: string;
  finalLogId: string;
  auditId: string;
  operator: string;
}

export interface FermentationCompletionCommandState {
  lots: WineLot[];
  vessels: Vessel[];
  fermlogs: DailyFermLog[];
  auditLogs: MaraniOSAuditLog[];
}

export interface FermentationCompletionCommandContext {
  commandId: string;
  actorUsername: string;
  performedAt: Date;
}

export interface FermentationCompletionCommandResult {
  lot: WineLot;
  vessel: Vessel;
  finalLog: DailyFermLog;
  auditLog: MaraniOSAuditLog;
  stateVersion?: number;
  receipt: {
    lotId: string;
    vesselId: string;
    finalLogId: string;
    fromStage: 'fermenting';
    toStage: 'stabilization';
  };
}

export interface AppliedFermentationCompletionCommand {
  state: FermentationCompletionCommandState;
  result: FermentationCompletionCommandResult;
}

export type FermentationCompletionCommandErrorCode =
  | 'invalid_fermentation_completion_payload'
  | 'organization_state_not_found'
  | 'fermentation_lot_not_found'
  | 'fermentation_vessel_not_found'
  | 'fermentation_final_log_not_found'
  | 'fermentation_lot_not_active'
  | 'fermentation_vessel_mismatch'
  | 'fermentation_log_mismatch'
  | 'fermentation_already_completed'
  | 'fermentation_audit_id_conflict'
  | 'fermentation_state_inconsistent';

export class FermentationCompletionCommandError extends Error {
  constructor(
    public readonly code: FermentationCompletionCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'FermentationCompletionCommandError';
  }
}

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new FermentationCompletionCommandError(
      'invalid_fermentation_completion_payload',
      `${field} must be 1-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
      400,
    );
  }
  return normalized;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > maxLength) {
    throw new FermentationCompletionCommandError(
      'invalid_fermentation_completion_payload',
      `${field} is required and must not exceed ${maxLength} characters.`,
      400,
    );
  }
  return normalized;
}

function validReading(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new FermentationCompletionCommandError(
      'fermentation_state_inconsistent',
      `The final fermentation reading has an invalid ${field}.`,
      409,
    );
  }
  return value;
}

function stamped<T extends object>(record: T, timestamp: string): T {
  return { ...record, lastModified: timestamp };
}

export function parseFermentationCompletionCommandPayload(
  value: unknown,
): FermentationCompletionCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FermentationCompletionCommandError(
      'invalid_fermentation_completion_payload',
      'Fermentation completion payload must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  return {
    lotId: requiredRecordId(input.lotId, 'lotId'),
    vesselId: requiredRecordId(input.vesselId, 'vesselId'),
    finalLogId: requiredRecordId(input.finalLogId, 'finalLogId'),
    auditId: requiredRecordId(input.auditId, 'auditId'),
    operator: requiredText(input.operator, 'operator', 120),
  };
}

export function applyFermentationCompletionCommand(
  currentState: FermentationCompletionCommandState,
  rawPayload: unknown,
  context: FermentationCompletionCommandContext,
): AppliedFermentationCompletionCommand {
  const payload = parseFermentationCompletionCommandPayload(rawPayload);
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new FermentationCompletionCommandError(
      'invalid_fermentation_completion_payload',
      'Fermentation completion execution time is invalid.',
      400,
    );
  }
  if (!currentState || !Array.isArray(currentState.lots) || !Array.isArray(currentState.vessels)
    || !Array.isArray(currentState.fermlogs) || !Array.isArray(currentState.auditLogs)) {
    throw new FermentationCompletionCommandError(
      'fermentation_state_inconsistent',
      'Organization fermentation state is unavailable.',
      400,
    );
  }
  if (currentState.auditLogs.some(item => item.id === payload.auditId)) {
    throw new FermentationCompletionCommandError(
      'fermentation_audit_id_conflict',
      'Audit record id already exists.',
      409,
    );
  }

  const lot = currentState.lots.find(item => item.id === payload.lotId);
  if (!lot) {
    throw new FermentationCompletionCommandError(
      'fermentation_lot_not_found',
      'The fermenting wine lot was not found.',
      404,
    );
  }
  if (lot.stage !== 'fermenting') {
    throw new FermentationCompletionCommandError(
      lot.history?.some(entry => entry.sourceRef === payload.finalLogId && entry.type === 'Fermentation Concluded')
        ? 'fermentation_already_completed'
        : 'fermentation_lot_not_active',
      lot.stage === 'stabilization'
        ? 'This fermentation was already completed.'
        : 'Only an actively fermenting lot can be completed.',
      409,
    );
  }

  const vessel = currentState.vessels.find(item => item.id === payload.vesselId);
  if (!vessel) {
    throw new FermentationCompletionCommandError(
      'fermentation_vessel_not_found',
      'The fermentation vessel was not found.',
      404,
    );
  }
  if (vessel.assignedLotId !== lot.id || !(vessel.currentVolume > 0)) {
    throw new FermentationCompletionCommandError(
      'fermentation_vessel_mismatch',
      'The lot must still be assigned to a non-empty vessel when fermentation is completed.',
      409,
    );
  }

  const finalLog = currentState.fermlogs.find(item => item.id === payload.finalLogId);
  if (!finalLog) {
    throw new FermentationCompletionCommandError(
      'fermentation_final_log_not_found',
      'The final fermentation reading was not found.',
      404,
    );
  }
  if (finalLog.lotId !== lot.id || finalLog.tankId !== vessel.id) {
    throw new FermentationCompletionCommandError(
      'fermentation_log_mismatch',
      'The final reading must belong to the selected lot and its assigned vessel.',
      409,
    );
  }
  if (finalLog.isCompletion || finalLog.commandId) {
    throw new FermentationCompletionCommandError(
      'fermentation_already_completed',
      'This fermentation reading already completed a campaign.',
      409,
    );
  }

  validReading(finalLog.temperature, 'temperature', -50, 100);
  validReading(finalLog.density, 'density', 0.5, 2);
  validReading(finalLog.sugar, 'sugar', 0, 1_000);
  validReading(finalLog.ph, 'pH', 0, 14);
  if (typeof finalLog.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(finalLog.date)) {
    throw new FermentationCompletionCommandError(
      'fermentation_state_inconsistent',
      'The final fermentation reading has an invalid date.',
      409,
    );
  }

  const timestamp = context.performedAt.toISOString();
  const date = timestamp.slice(0, 10);
  const operator = payload.operator || context.actorUsername;
  const historyDescription = `Primary fermentation concluded using final reading ${finalLog.id}: density ${finalLog.density} SG, sugar ${finalLog.sugar} g/L, temperature ${finalLog.temperature}°C, pH ${finalLog.ph}.`;
  const completionSnapshot: FermentationCompletionReversalSnapshot = {
    version: 1,
    lot: {
      id: lot.id,
      stage: lot.stage,
      currentVolume: lot.currentVolume,
      historyDescription,
    },
    vessel: {
      id: vessel.id,
      currentVolume: vessel.currentVolume,
      assignedLotId: vessel.assignedLotId,
      lastOperation: vessel.lastOperation,
    },
    finalLog: {
      id: finalLog.id,
      date: finalLog.date,
      temperature: finalLog.temperature,
      density: finalLog.density,
      sugar: finalLog.sugar,
      ph: finalLog.ph,
      tastingNotes: finalLog.tastingNotes,
      capManagement: finalLog.capManagement,
      additives: finalLog.additives,
    },
    auditId: payload.auditId,
  };
  const updatedLot = stamped<WineLot>({
    ...lot,
    stage: 'stabilization',
    lastCommandId: context.commandId,
    history: [{
      date,
      type: 'Fermentation Concluded',
      description: historyDescription,
      operator,
      sourceRef: finalLog.id,
    }, ...(lot.history || [])],
  }, timestamp);
  const updatedVessel = stamped<Vessel>({
    ...vessel,
    lastCommandId: context.commandId,
    lastOperation: `Fermentation completed for lot ${lot.id}; moved to stabilization`,
  }, timestamp);
  const updatedFinalLog = stamped<DailyFermLog>({
    ...finalLog,
    commandId: context.commandId,
    recordKind: 'completion',
    isCompletion: true,
    completedAt: timestamp,
    completedBy: operator,
    completionSnapshot,
  }, timestamp);
  const unsignedAudit = stamped<MaraniOSAuditLog>({
    id: payload.auditId,
    commandId: context.commandId,
    timestamp,
    user: operator,
    module: 'GVINO',
    actionType: 'Fermentation Completion',
    changedItem: `WineLot ${lot.id}`,
    oldValue: 'fermenting',
    newValue: 'stabilization',
    notes: `Final reading ${finalLog.id} in vessel ${vessel.id}: ${finalLog.density} SG, ${finalLog.sugar} g/L sugar, ${finalLog.temperature}°C, pH ${finalLog.ph}.`,
  }, timestamp);
  const auditLog = signAuditEntries([unsignedAudit], currentState.auditLogs)[0];

  return {
    state: {
      lots: currentState.lots.map(item => item.id === updatedLot.id ? updatedLot : item),
      vessels: currentState.vessels.map(item => item.id === updatedVessel.id ? updatedVessel : item),
      fermlogs: currentState.fermlogs.map(item => item.id === updatedFinalLog.id ? updatedFinalLog : item),
      auditLogs: [auditLog, ...currentState.auditLogs],
    },
    result: {
      lot: updatedLot,
      vessel: updatedVessel,
      finalLog: updatedFinalLog,
      auditLog,
      receipt: {
        lotId: lot.id,
        vesselId: vessel.id,
        finalLogId: finalLog.id,
        fromStage: 'fermenting',
        toStage: 'stabilization',
      },
    },
  };
}
