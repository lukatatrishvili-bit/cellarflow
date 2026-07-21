import { describe, expect, it } from 'vitest';
import {
  applyFermentationCompletionCommand,
  type FermentationCompletionCommandState,
} from '../lib/commands/fermentationCompletion';
import {
  applyFermentationCompletionReversalCommand,
  parseFermentationCompletionReversalCommandPayload,
  type FermentationCompletionReversalCommandState,
} from '../lib/commands/fermentationCompletionReversal';
import type { DailyFermLog, Vessel, WineLot } from '../lib/wineryState';

const completionCommandId = 'cmd-fermentation-complete-original-0001';

function baseState(): FermentationCompletionCommandState {
  const lot: WineLot = {
    id: 'LOT-FERM-REV-1', name: 'Saperavi', vintage: 2026, variety: 'Saperavi',
    vineyardBlock: 'Block A', region: 'Kakheti', initialVolume: 1_000, currentVolume: 920,
    wineClass: 'red', stage: 'fermenting', createdAt: '2026-09-01', history: [],
  };
  const vessel: Vessel = {
    id: 'TANK-FERM-REV-1', type: 'stainless_steel', shape: 'vertical', capacity: 1_200,
    currentVolume: 920, assignedLotId: lot.id, cleaningStatus: 'clean', lastCleaned: '2026-08-31',
    temperature: 20, coolingJacketActive: true, targetTemperature: 20,
    lastOperation: 'Final fermentation reading recorded',
  };
  const log: DailyFermLog = {
    id: 'FLOG-FINAL-REV-1', recordKind: 'reading', tankId: vessel.id, lotId: lot.id,
    date: '2026-09-14', temperature: 20.5, density: 0.996, sugar: 2, ph: 3.48,
    tastingNotes: 'Dry and clean', capManagement: 'None', additives: 'None',
  };
  return { lots: [lot], vessels: [vessel], fermlogs: [log], auditLogs: [] };
}

function completedState(): FermentationCompletionReversalCommandState {
  const completed = applyFermentationCompletionCommand(baseState(), {
    lotId: 'LOT-FERM-REV-1', vesselId: 'TANK-FERM-REV-1', finalLogId: 'FLOG-FINAL-REV-1',
    auditId: 'AUDIT-FERM-COMPLETE-1', operator: 'Nino Winemaker',
  }, {
    commandId: completionCommandId,
    actorUsername: 'nino',
    performedAt: new Date('2026-09-14T16:30:00.000Z'),
  }).state;
  return {
    ...completed,
    cellarOps: [], transfers: [], bottlingRuns: [], certificationRecords: [], attachments: [],
  };
}

const reversalPayload = {
  reversalLogId: 'FLOG-REVERSAL-1', auditId: 'AUDIT-FERM-REVERSAL-1',
  originalCommandId: completionCommandId, reason: 'Completion was recorded prematurely.',
};
const reversalContext = {
  commandId: 'cmd-fermentation-complete-reversal-0001',
  actorUsername: 'owner',
  performedAt: new Date('2026-09-15T09:00:00.000Z'),
};

describe('cellar.fermentation-complete.reverse domain command', () => {
  it('reopens the lot, restores the vessel operation, and appends correction evidence', () => {
    const applied = applyFermentationCompletionReversalCommand(
      completedState(), reversalPayload, reversalContext,
    );

    expect(applied.result.lot).toMatchObject({
      stage: 'fermenting', lastCommandId: reversalContext.commandId,
    });
    expect(applied.result.lot.history[0]).toMatchObject({
      type: 'correction', sourceRef: reversalPayload.reversalLogId,
    });
    expect(applied.result.vessel).toMatchObject({
      currentVolume: 920,
      assignedLotId: 'LOT-FERM-REV-1',
      lastOperation: 'Final fermentation reading recorded',
      lastCommandId: reversalContext.commandId,
    });
    expect(applied.result.originalLog).toMatchObject({
      id: 'FLOG-FINAL-REV-1', recordKind: 'completion', isCompletion: true,
      reversedByCommandId: reversalContext.commandId,
      reversalReason: reversalPayload.reason,
    });
    expect(applied.result.reversalLog).toMatchObject({
      id: reversalPayload.reversalLogId, recordKind: 'reversal', isCompletion: false,
      reversalOfLogId: 'FLOG-FINAL-REV-1', reversalOfCommandId: completionCommandId,
    });
    expect(applied.result.auditLog).toMatchObject({
      actionType: 'Fermentation Completion Reversal', oldValue: 'stabilization', newValue: 'fermenting',
      chainSequence: 2,
    });
    expect(applied.result.receipt).toMatchObject({
      kind: 'fermentation_completion_reversal', fromStage: 'stabilization', toStage: 'fermenting',
      originalCommandId: completionCommandId, reversalCommandId: reversalContext.commandId,
    });
  });

  it('refuses a second correction and legacy completion records without snapshots', () => {
    const first = applyFermentationCompletionReversalCommand(
      completedState(), reversalPayload, reversalContext,
    );
    expect(() => applyFermentationCompletionReversalCommand(first.state, {
      ...reversalPayload, reversalLogId: 'FLOG-REVERSAL-2', auditId: 'AUDIT-FERM-REVERSAL-2',
    }, { ...reversalContext, commandId: 'cmd-fermentation-complete-reversal-0002' }))
      .toThrowError(expect.objectContaining({ code: 'fermentation_completion_already_reversed', statusCode: 409 }));

    const legacy = completedState();
    delete legacy.fermlogs[0].completionSnapshot;
    expect(() => applyFermentationCompletionReversalCommand(legacy, reversalPayload, reversalContext))
      .toThrowError(expect.objectContaining({ code: 'fermentation_completion_reversal_snapshot_missing' }));
  });

  it('blocks stale lifecycle state and later cellar dependencies', () => {
    const stale = completedState();
    stale.lots[0].stage = 'aging';
    expect(() => applyFermentationCompletionReversalCommand(stale, reversalPayload, reversalContext))
      .toThrowError(expect.objectContaining({ code: 'fermentation_completion_reversal_dependency_conflict' }));

    const dependent = completedState();
    dependent.cellarOps.push({
      id: 'OP-AFTER', date: '2026-09-15T08:00:00.000Z', type: 'racking',
      lotId: 'LOT-FERM-REV-1', lotName: 'Saperavi', operator: 'Nino', notes: '',
    });
    expect(() => applyFermentationCompletionReversalCommand(dependent, reversalPayload, reversalContext))
      .toThrowError(expect.objectContaining({ code: 'fermentation_completion_reversal_dependency_conflict' }));
  });

  it('validates reason and identifiers at the command boundary', () => {
    expect(() => parseFermentationCompletionReversalCommandPayload({ ...reversalPayload, reason: ' ' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_fermentation_completion_reversal_payload', statusCode: 400 }));
    expect(() => parseFermentationCompletionReversalCommandPayload({ ...reversalPayload, reversalLogId: '../bad' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_fermentation_completion_reversal_payload' }));
  });
});
