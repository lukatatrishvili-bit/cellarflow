import { describe, expect, it } from 'vitest';
import {
  applyLotStageTransitionCommand,
  LotStageTransitionCommandError,
  parseLotStageTransitionCommandPayload,
  type LotStageTransitionCommandPayload,
  type LotStageTransitionCommandState,
} from '../lib/commands/lotStageTransition';
import type { WineLot } from '../lib/wineryState';

function lot(overrides: Partial<WineLot> = {}): WineLot {
  return {
    id: 'LOT-STAGE-1',
    name: 'Saperavi Reserve',
    vintage: 2026,
    variety: 'Saperavi',
    vineyardBlock: 'Block A',
    region: 'Kakheti',
    initialVolume: 1_000,
    currentVolume: 920,
    wineClass: 'red',
    stage: 'aging',
    createdAt: '2026-09-01',
    history: [],
    ...overrides,
  };
}

function state(overrides: Partial<LotStageTransitionCommandState> = {}): LotStageTransitionCommandState {
  return { lots: [lot()], auditLogs: [], ...overrides };
}

const payload: LotStageTransitionCommandPayload = {
  transitionId: 'LOT-STAGE-EVENT-1',
  auditId: 'AUDIT-LOT-STAGE-1',
  lotId: 'LOT-STAGE-1',
  expectedStage: 'aging',
  targetStage: 'stabilization',
  date: '2026-09-20',
  operator: 'Nino Winemaker',
  notes: 'Protein and tartrate stability checks completed.',
};

const context = {
  commandId: 'cmd-lot-stage-test-0001',
  actorUsername: 'nino',
  performedAt: new Date('2026-09-20T11:15:00.000Z'),
};

describe('lot.stage.transition domain command', () => {
  it('moves the lot and signs its traceability evidence atomically', () => {
    const applied = applyLotStageTransitionCommand(state(), payload, context);

    expect(applied.result.updatedLot).toMatchObject({
      id: payload.lotId,
      stage: 'stabilization',
      lastCommandId: context.commandId,
    });
    expect(applied.result.transition).toMatchObject({
      previousStage: 'aging',
      targetStage: 'stabilization',
      correction: false,
    });
    expect(applied.result.updatedLot.history[0]).toMatchObject({
      type: 'Stage transition',
      sourceRef: payload.transitionId,
      operator: payload.operator,
    });
    expect(applied.result.auditLog).toMatchObject({
      id: payload.auditId,
      commandId: context.commandId,
      actionType: 'Wine Lot Stage Transition',
      oldValue: 'aging',
      newValue: 'stabilization',
      chainSequence: 1,
      previousHash: 'GENESIS',
      hashAlgorithm: 'SHA-256',
    });
    expect(applied.result.auditLog.chainHash).toMatch(/^[a-f0-9]{64}$/);
    expect(applied.state.lots[0].currentVolume).toBe(920);
  });

  it('marks an intentional non-sequential move as a correction', () => {
    const applied = applyLotStageTransitionCommand(state(), {
      ...payload,
      transitionId: 'LOT-STAGE-CORRECTION-1',
      auditId: 'AUDIT-LOT-STAGE-CORRECTION-1',
      targetStage: 'pressing',
      notes: 'Correcting the stage after cellar record review.',
    }, context);

    expect(applied.result.transition.correction).toBe(true);
    expect(applied.result.updatedLot.history[0].type).toBe('Stage correction');
    expect(applied.result.auditLog.actionType).toBe('Wine Lot Stage Correction');
  });

  it.each(['bottled', 'sold'] as const)('keeps %s behind its dedicated stock workflow', targetStage => {
    expect(() => applyLotStageTransitionCommand(state(), {
      ...payload,
      targetStage,
    }, context)).toThrowError(expect.objectContaining({
      code: 'lot_stage_transition_not_allowed',
      statusCode: 409,
    }));
  });

  it('rejects a stale form instead of overwriting a newer stage', () => {
    expect(() => applyLotStageTransitionCommand(state({
      lots: [lot({ stage: 'stabilization' })],
    }), payload, context)).toThrowError(expect.objectContaining({
      code: 'lot_stage_transition_conflict',
      statusCode: 409,
    }));
  });

  it('rejects inactive lots and malformed evidence', () => {
    expect(() => applyLotStageTransitionCommand(state({
      lots: [lot({ stage: 'sold' })],
    }), { ...payload, expectedStage: 'sold' }, context)).toThrowError(expect.objectContaining({
      code: 'lot_stage_transition_lot_inactive',
    }));

    expect(() => parseLotStageTransitionCommandPayload({
      ...payload,
      notes: 'x',
    })).toThrowError(LotStageTransitionCommandError);
  });
});
