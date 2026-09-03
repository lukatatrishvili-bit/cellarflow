import { signAuditEntries } from '../auditHash';
import { nextStageForWineClass, stagesForCurrentLot } from '../winemakingWorkflow';
import type { MaraniOSAuditLog, WineLot, WinemakingStage } from '../wineryState';

export const LOT_STAGE_TRANSITION_COMMAND_TYPE = 'lot.stage.transition' as const;

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STAGES: WinemakingStage[] = [
  'crushing', 'fermenting', 'maceration', 'pressing', 'aging',
  'stabilization', 'filtration', 'bottled', 'sold',
];

export interface LotStageTransitionCommandPayload {
  transitionId: string;
  auditId: string;
  lotId: string;
  expectedStage: WinemakingStage;
  targetStage: WinemakingStage;
  date: string;
  operator: string;
  notes: string;
}

export interface LotStageTransitionCommandState {
  lots: WineLot[];
  auditLogs: MaraniOSAuditLog[];
}

export interface LotStageTransitionCommandContext {
  commandId: string;
  actorUsername: string;
  performedAt: Date;
}

export interface LotStageTransitionCommandResult {
  updatedLot: WineLot;
  auditLog: MaraniOSAuditLog;
  transition: {
    id: string;
    lotId: string;
    previousStage: WinemakingStage;
    targetStage: WinemakingStage;
    correction: boolean;
    date: string;
    operator: string;
    notes: string;
  };
  stateVersion?: number;
}

export interface AppliedLotStageTransitionCommand {
  state: LotStageTransitionCommandState;
  result: LotStageTransitionCommandResult;
}

export type LotStageTransitionCommandErrorCode =
  | 'invalid_lot_stage_transition_payload'
  | 'organization_state_not_found'
  | 'lot_stage_transition_lot_not_found'
  | 'lot_stage_transition_lot_inactive'
  | 'lot_stage_transition_conflict'
  | 'lot_stage_transition_not_allowed'
  | 'lot_stage_transition_audit_id_conflict'
  | 'lot_stage_transition_state_inconsistent';

export class LotStageTransitionCommandError extends Error {
  constructor(
    public readonly code: LotStageTransitionCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'LotStageTransitionCommandError';
  }
}

function recordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new LotStageTransitionCommandError(
      'invalid_lot_stage_transition_payload',
      `${field} must be a valid 1-128 character record id.`,
      400,
    );
  }
  return normalized;
}

function text(value: unknown, field: string, maxLength: number, minimumLength = 1): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length < minimumLength || normalized.length > maxLength) {
    throw new LotStageTransitionCommandError(
      'invalid_lot_stage_transition_payload',
      `${field} must contain ${minimumLength}-${maxLength} characters.`,
      400,
    );
  }
  return normalized;
}

function stage(value: unknown, field: string): WinemakingStage {
  if (typeof value !== 'string' || !STAGES.includes(value as WinemakingStage)) {
    throw new LotStageTransitionCommandError(
      'invalid_lot_stage_transition_payload',
      `${field} is not a supported winemaking stage.`,
      400,
    );
  }
  return value as WinemakingStage;
}

function date(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(normalized) || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new LotStageTransitionCommandError(
      'invalid_lot_stage_transition_payload',
      'date must be a valid calendar date in YYYY-MM-DD format.',
      400,
    );
  }
  return normalized;
}

export function parseLotStageTransitionCommandPayload(value: unknown): LotStageTransitionCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LotStageTransitionCommandError(
      'invalid_lot_stage_transition_payload',
      'Lot stage transition payload must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  return {
    transitionId: recordId(input.transitionId, 'transitionId'),
    auditId: recordId(input.auditId, 'auditId'),
    lotId: recordId(input.lotId, 'lotId'),
    expectedStage: stage(input.expectedStage, 'expectedStage'),
    targetStage: stage(input.targetStage, 'targetStage'),
    date: date(input.date),
    operator: text(input.operator, 'operator', 120),
    notes: text(input.notes, 'notes', 2_000, 5),
  };
}

export function applyLotStageTransitionCommand(
  currentState: LotStageTransitionCommandState,
  rawPayload: unknown,
  context: LotStageTransitionCommandContext,
): AppliedLotStageTransitionCommand {
  const payload = parseLotStageTransitionCommandPayload(rawPayload);
  if (!currentState || !Array.isArray(currentState.lots) || !Array.isArray(currentState.auditLogs)) {
    throw new LotStageTransitionCommandError(
      'lot_stage_transition_state_inconsistent',
      'Organization lot state is unavailable.',
      400,
    );
  }
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new LotStageTransitionCommandError(
      'invalid_lot_stage_transition_payload',
      'Transition execution time is invalid.',
      400,
    );
  }
  if (currentState.auditLogs.some(entry => entry.id === payload.auditId)) {
    throw new LotStageTransitionCommandError(
      'lot_stage_transition_audit_id_conflict',
      'The stage-transition audit id already exists.',
      409,
    );
  }
  const lot = currentState.lots.find(candidate => candidate.id === payload.lotId);
  if (!lot) {
    throw new LotStageTransitionCommandError('lot_stage_transition_lot_not_found', 'The wine lot was not found.', 404);
  }
  if (lot.voidedAt || lot.stage === 'sold') {
    throw new LotStageTransitionCommandError(
      'lot_stage_transition_lot_inactive',
      'An inactive, voided, or sold wine lot cannot change production stage.',
      409,
    );
  }
  if (lot.stage !== payload.expectedStage) {
    throw new LotStageTransitionCommandError(
      'lot_stage_transition_conflict',
      `Lot ${lot.id} is now at ${lot.stage}, not the expected ${payload.expectedStage}. Refresh before retrying.`,
      409,
    );
  }
  if (payload.targetStage === lot.stage || payload.targetStage === 'bottled' || payload.targetStage === 'sold'
    || !stagesForCurrentLot(lot.wineClass, lot.stage).includes(payload.targetStage)) {
    throw new LotStageTransitionCommandError(
      'lot_stage_transition_not_allowed',
      'Use a valid production stage; bottled and sold are set only by their dedicated workflows.',
      409,
    );
  }

  const expectedNext = nextStageForWineClass(lot.wineClass, lot.stage);
  const correction = payload.targetStage !== expectedNext;
  const timestamp = context.performedAt.toISOString();
  const updatedLot: WineLot = {
    ...lot,
    stage: payload.targetStage,
    lastCommandId: context.commandId,
    lastModified: timestamp,
    history: [{
      date: payload.date,
      type: correction ? 'Stage correction' : 'Stage transition',
      description: `${lot.stage} → ${payload.targetStage} · ${payload.notes}`,
      operator: payload.operator,
      sourceRef: payload.transitionId,
    }, ...(lot.history || [])],
  };
  const auditLog = signAuditEntries([{
    id: payload.auditId,
    commandId: context.commandId,
    lastModified: timestamp,
    timestamp,
    user: payload.operator || context.actorUsername,
    module: 'GVINO',
    actionType: correction ? 'Wine Lot Stage Correction' : 'Wine Lot Stage Transition',
    changedItem: `Lot ${lot.id}`,
    oldValue: lot.stage,
    newValue: payload.targetStage,
    notes: payload.notes,
  }], currentState.auditLogs)[0];

  return {
    state: {
      lots: currentState.lots.map(candidate => candidate.id === lot.id ? updatedLot : candidate),
      auditLogs: [auditLog, ...currentState.auditLogs],
    },
    result: {
      updatedLot,
      auditLog,
      transition: {
        id: payload.transitionId,
        lotId: lot.id,
        previousStage: lot.stage,
        targetStage: payload.targetStage,
        correction,
        date: payload.date,
        operator: payload.operator,
        notes: payload.notes,
      },
    },
  };
}
