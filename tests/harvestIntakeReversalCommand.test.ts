import { describe, expect, it } from 'vitest';
import { buildAuditHashChain } from '../lib/auditHash';
import {
  applyHarvestIntakeCommand,
  type HarvestIntakeCommandPayload,
  type HarvestIntakeCommandState,
} from '../lib/commands/harvestIntake';
import {
  applyHarvestIntakeReversalCommand,
  parseHarvestIntakeReversalCommandPayload,
  type HarvestIntakeReversalCommandState,
} from '../lib/commands/harvestIntakeReversal';
import type { HarvestRecord, Vessel, VineyardBlock } from '../lib/wineryState';

const block: VineyardBlock = {
  id: 'BLOCK-A', name: 'Mukuzani', vineyardName: 'Estate', locationName: 'Mukuzani',
  cadastralCode: 'CAD-1', municipality: 'Gurjaani', village: 'Mukuzani', microzone: 'Mukuzani',
  latitude: 41.8, longitude: 45.7, area: 2, elevation: 430, slope: '5%', aspect: 'South',
  soilType: 'Clay', grapeVariety: 'Saperavi', plantingYear: 2014, spacing: '2x1', rowsCount: 20,
  vinesCount: 2_000, trainingSystem: 'Guyot', pruningSystem: 'Cane', irrigationEnabled: false,
  farmingStatus: 'conventional', currentPhenology: 'Ripening', estimatedHarvestDate: '2026-09-15', notes: '',
};
const harvest: HarvestRecord = {
  id: 'HARVEST-A', blockId: block.id, variety: 'Saperavi', estimatedHarvestDate: '2026-09-15',
  estimatedTons: 1, pickingMethod: 'hand', grapeCondition: 'good', sentToGvino: false, notes: '',
};
const vessel: Vessel = {
  id: 'T-1', type: 'stainless_steel', shape: 'vertical', capacity: 1_000, currentVolume: 0,
  assignedLotId: null, cleaningStatus: 'clean', lastCleaned: '2026-09-14', temperature: 16,
  coolingJacketActive: false, targetTemperature: null, lastOperation: 'Sanitized',
};
const intakePayload: HarvestIntakeCommandPayload = {
  intakeId: 'intake-a', lotId: 'lot-a', auditId: 'audit-a',
  intake: {
    date: '2026-09-15', source: 'own', blockId: block.id, variety: 'Saperavi', vintage: 2026,
    grossWeightKg: 1_100, tareWeightKg: 100, brix: 23, ph: 3.4, titratableAcidity: 6,
    temperatureC: 18, condition: 'good', pickingMethod: 'hand', wineClass: 'red', juiceYieldPct: 70,
    costPerKg: 2.5, totalCost: 2_500, paymentStatus: 'unpaid', destinationVesselId: vessel.id,
    harvestRecordId: harvest.id, operator: 'Nino', notes: '',
  },
};
const intakeContext = {
  commandId: 'cmd-intake-a', actorUsername: 'nino', currency: 'GEL', region: 'Kakheti',
  performedAt: new Date('2026-09-15T09:00:00.000Z'),
};
const reversalPayload = {
  reversalIntakeId: 'intake-reversal-a', auditId: 'audit-reversal-a',
  costReversalId: 'cost-reversal-a', originalCommandId: intakeContext.commandId,
  reason: 'Duplicate weighbridge receipt',
};
const reversalContext = {
  commandId: 'cmd-intake-reversal-a', actorUsername: 'owner',
  performedAt: new Date('2026-09-16T10:00:00.000Z'),
};

function postedState(): HarvestIntakeReversalCommandState {
  const base: HarvestIntakeCommandState = {
    blocks: [block], harvests: [harvest], lots: [], vessels: [vessel], grapeIntakes: [],
    costEntries: [], auditLogs: [],
  };
  const posted = applyHarvestIntakeCommand(base, intakePayload, intakeContext).state;
  return {
    harvests: posted.harvests, lots: posted.lots, vessels: posted.vessels,
    grapeIntakes: posted.grapeIntakes, costEntries: posted.costEntries, auditLogs: posted.auditLogs,
    cellarOps: [], fermLogs: [], labLogs: [], transfers: [], bottlingRuns: [],
    certificationRecords: [], stockMovements: [], salesOrders: [], salesDispatches: [], attachments: [],
  };
}

describe('cellar.harvest-intake.reverse domain command', () => {
  it('voids the generated lot and restores every linked receiving side effect', () => {
    const applied = applyHarvestIntakeReversalCommand(postedState(), reversalPayload, reversalContext);

    expect(applied.result.voidedLot).toMatchObject({
      id: 'lot-a', currentVolume: 0, voidedByCommandId: reversalContext.commandId,
      voidReason: reversalPayload.reason, lastCommandId: reversalContext.commandId,
    });
    expect(applied.result.voidedLot.history[0]).toMatchObject({
      type: 'Grape Intake Reversal', sourceRef: reversalPayload.reversalIntakeId,
    });
    expect(applied.result.updatedVessel).toMatchObject({
      id: vessel.id, currentVolume: 0, assignedLotId: null, temperature: 16,
      lastOperation: 'Sanitized', lastCommandId: reversalContext.commandId,
    });
    expect(applied.result.updatedHarvest).toMatchObject({
      id: harvest.id, sentToGvino: false, lastCommandId: reversalContext.commandId,
    });
    expect(applied.result.updatedHarvest).not.toHaveProperty('actualHarvestedKg');
    expect(applied.result.updatedHarvest).not.toHaveProperty('actualHarvestDate');
    expect(applied.result.updatedHarvest).not.toHaveProperty('associatedLotId');
    expect(applied.result.originalIntake).toMatchObject({
      id: 'intake-a', reversedByCommandId: reversalContext.commandId, reversalReason: reversalPayload.reason,
    });
    expect(applied.result.reversalIntake).toMatchObject({
      id: reversalPayload.reversalIntakeId, recordKind: 'reversal', reversalOfIntakeId: 'intake-a',
      reversalOfCommandId: intakeContext.commandId, netWeightKg: 1_000, estimatedVolumeL: 700,
    });
    expect(applied.result.updatedOriginalCostEntry).toMatchObject({ reversedByCommandId: reversalContext.commandId });
    expect(applied.result.reversalCostEntry).toMatchObject({
      recordKind: 'reversal', amount: -2_500, reversalOfCommandId: intakeContext.commandId,
      sourceRef: reversalPayload.reversalIntakeId,
    });
    expect(applied.result.auditLog).toMatchObject({
      actionType: 'Grape Receiving Reversal', changedItem: 'WineLot lot-a',
    });
    expect(buildAuditHashChain(applied.state.auditLogs).invalidCount).toBe(0);
    expect(applied.result.receipt).toMatchObject({
      kind: 'harvest_intake_reversal', reversedNetWeightKg: 1_000,
      reversedVolumeL: 700, reversedCostAmount: 2_500,
    });
  });

  it('blocks correction when later lot evidence depends on the intake', () => {
    const state = postedState();
    state.fermLogs.push({
      id: 'ferm-later', tankId: vessel.id, lotId: 'lot-a', date: '2026-09-16',
      temperature: 20, density: 1.08, sugar: 20, ph: 3.4, tastingNotes: '', capManagement: 'none', additives: '',
    });
    expect(() => applyHarvestIntakeReversalCommand(state, reversalPayload, reversalContext))
      .toThrowError(expect.objectContaining({
        code: 'harvest_intake_reversal_dependency_conflict', statusCode: 409,
      }));
  });

  it('blocks a second correction and legacy intakes without snapshots', () => {
    const first = applyHarvestIntakeReversalCommand(postedState(), reversalPayload, reversalContext);
    expect(() => applyHarvestIntakeReversalCommand(first.state, {
      ...reversalPayload, reversalIntakeId: 'intake-reversal-b', auditId: 'audit-reversal-b',
      costReversalId: 'cost-reversal-b',
    }, { ...reversalContext, commandId: 'cmd-intake-reversal-b' }))
      .toThrowError(expect.objectContaining({ code: 'harvest_intake_already_reversed' }));

    const legacy = postedState();
    legacy.grapeIntakes[0] = { ...legacy.grapeIntakes[0], reversalSnapshot: undefined };
    expect(() => applyHarvestIntakeReversalCommand(legacy, reversalPayload, reversalContext))
      .toThrowError(expect.objectContaining({ code: 'harvest_intake_reversal_snapshot_missing' }));
  });

  it('requires safe ids and a bounded reason', () => {
    expect(() => parseHarvestIntakeReversalCommandPayload({ ...reversalPayload, reason: '' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_harvest_intake_reversal_payload' }));
    expect(() => parseHarvestIntakeReversalCommandPayload({ ...reversalPayload, auditId: '../bad' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_harvest_intake_reversal_payload' }));
  });
});
