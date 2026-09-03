import { describe, expect, it } from 'vitest';
import {
  applyFermentationCompletionCommand,
  parseFermentationCompletionCommandPayload,
  type FermentationCompletionCommandPayload,
  type FermentationCompletionCommandState,
} from '../lib/commands/fermentationCompletion';
import type { DailyFermLog, Vessel, WineLot } from '../lib/wineryState';

function lot(overrides: Partial<WineLot> = {}): WineLot {
  return {
    id: 'LOT-FERM-1',
    name: 'Saperavi Primary Ferment',
    vintage: 2026,
    variety: 'Saperavi',
    vineyardBlock: 'Block A',
    region: 'Kakheti',
    initialVolume: 1_000,
    currentVolume: 920,
    wineClass: 'red',
    stage: 'fermenting',
    createdAt: '2026-09-01',
    history: [],
    ...overrides,
  };
}

function vessel(overrides: Partial<Vessel> = {}): Vessel {
  return {
    id: 'TANK-FERM-1',
    type: 'stainless_steel',
    shape: 'vertical',
    capacity: 1_200,
    currentVolume: 920,
    assignedLotId: 'LOT-FERM-1',
    cleaningStatus: 'clean',
    lastCleaned: '2026-08-31',
    temperature: 20,
    coolingJacketActive: true,
    targetTemperature: 20,
    lastOperation: 'Fermentation reading recorded',
    ...overrides,
  };
}

function finalLog(overrides: Partial<DailyFermLog> = {}): DailyFermLog {
  return {
    id: 'FLOG-FINAL-1',
    tankId: 'TANK-FERM-1',
    lotId: 'LOT-FERM-1',
    date: '2026-09-14',
    temperature: 20.5,
    density: 0.996,
    sugar: 2,
    ph: 3.48,
    tastingNotes: 'Dry, clean, and ready for stabilization.',
    capManagement: 'None',
    additives: 'None',
    ...overrides,
  };
}

function state(overrides: Partial<FermentationCompletionCommandState> = {}): FermentationCompletionCommandState {
  return {
    lots: [lot()],
    vessels: [vessel()],
    fermlogs: [finalLog()],
    auditLogs: [],
    ...overrides,
  };
}

const payload: FermentationCompletionCommandPayload = {
  lotId: 'LOT-FERM-1',
  vesselId: 'TANK-FERM-1',
  finalLogId: 'FLOG-FINAL-1',
  auditId: 'AUDIT-FERM-FINAL-1',
  operator: 'Nino Winemaker',
};

const context = {
  commandId: 'cmd-fermentation-complete-test-0001',
  actorUsername: 'nino',
  performedAt: new Date('2026-09-14T16:30:00.000Z'),
};

describe('cellar.fermentation-complete domain command', () => {
  it('promotes the final reading and updates lot, vessel, and signed audit together', () => {
    const applied = applyFermentationCompletionCommand(state(), payload, context);

    expect(applied.result.receipt).toEqual({
      lotId: payload.lotId,
      vesselId: payload.vesselId,
      finalLogId: payload.finalLogId,
      fromStage: 'fermenting',
      toStage: 'stabilization',
    });
    expect(applied.result.finalLog).toMatchObject({
      id: payload.finalLogId,
      commandId: context.commandId,
      recordKind: 'completion',
      isCompletion: true,
      completedAt: context.performedAt.toISOString(),
      completedBy: payload.operator,
    });
    expect(applied.result.lot).toMatchObject({
      stage: 'stabilization',
      lastCommandId: context.commandId,
      history: [expect.objectContaining({
        type: 'Fermentation Concluded',
        sourceRef: payload.finalLogId,
        operator: payload.operator,
      })],
    });
    expect(applied.result.vessel).toMatchObject({
      assignedLotId: payload.lotId,
      currentVolume: 920,
      coolingJacketActive: true,
      targetTemperature: 20,
      lastCommandId: context.commandId,
      lastOperation: expect.stringContaining('moved to stabilization'),
    });
    expect(applied.result.auditLog).toMatchObject({
      id: payload.auditId,
      commandId: context.commandId,
      actionType: 'Fermentation Completion',
      oldValue: 'fermenting',
      newValue: 'stabilization',
      chainSequence: 1,
      previousHash: 'GENESIS',
      hashAlgorithm: 'SHA-256',
    });
    expect(applied.result.auditLog.chainHash).toMatch(/^[a-f0-9]{64}$/);
    expect(applied.result.finalLog.completionSnapshot).toMatchObject({
      version: 1,
      lot: { id: payload.lotId, stage: 'fermenting', currentVolume: 920 },
      vessel: { id: payload.vesselId, lastOperation: 'Fermentation reading recorded' },
      finalLog: { id: payload.finalLogId, density: 0.996 },
      auditId: payload.auditId,
    });
  });

  it('requires an actively fermenting lot that is still in its non-empty assigned vessel', () => {
    expect(() => applyFermentationCompletionCommand(state({
      lots: [lot({ stage: 'stabilization' })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'fermentation_lot_not_active', statusCode: 409 }));

    expect(() => applyFermentationCompletionCommand(state({
      vessels: [vessel({ assignedLotId: 'LOT-OTHER' })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'fermentation_vessel_mismatch', statusCode: 409 }));

    expect(() => applyFermentationCompletionCommand(state({
      vessels: [vessel({ currentVolume: 0 })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'fermentation_vessel_mismatch' }));
  });

  it('requires the final reading to belong to the exact lot and vessel', () => {
    expect(() => applyFermentationCompletionCommand(state({
      fermlogs: [finalLog({ tankId: 'TANK-OTHER' })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'fermentation_log_mismatch', statusCode: 409 }));

    expect(() => applyFermentationCompletionCommand(state({ fermlogs: [] }), payload, context))
      .toThrowError(expect.objectContaining({ code: 'fermentation_final_log_not_found', statusCode: 404 }));
  });

  it('rejects invalid stored chemistry and duplicate completion evidence', () => {
    expect(() => applyFermentationCompletionCommand(state({
      fermlogs: [finalLog({ density: Number.NaN })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'fermentation_state_inconsistent' }));

    expect(() => applyFermentationCompletionCommand(state({
      fermlogs: [finalLog({ isCompletion: true, commandId: 'cmd-prior-completion' })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'fermentation_already_completed' }));

    expect(() => applyFermentationCompletionCommand(state({
      auditLogs: [{ id: payload.auditId } as any],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'fermentation_audit_id_conflict' }));
  });

  it('validates all record identifiers and the operator at the command boundary', () => {
    expect(() => parseFermentationCompletionCommandPayload({ ...payload, lotId: '../bad' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_fermentation_completion_payload', statusCode: 400 }));
    expect(() => parseFermentationCompletionCommandPayload({ ...payload, operator: '  ' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_fermentation_completion_payload', statusCode: 400 }));
  });
});
