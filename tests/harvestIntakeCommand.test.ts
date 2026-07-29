import { describe, expect, it } from 'vitest';
import {
  applyHarvestIntakeCommand,
  parseHarvestIntakeCommandPayload,
  type HarvestIntakeCommandPayload,
  type HarvestIntakeCommandState,
} from '../lib/commands/harvestIntake';
import type { HarvestRecord, Vessel, VineyardBlock } from '../lib/wineryState';

const block: VineyardBlock = {
  id: 'BLOCK-A',
  name: 'Mukuzani Block A',
  vineyardName: 'Estate vineyard',
  locationName: 'Mukuzani',
  cadastralCode: 'CAD-001',
  municipality: 'Gurjaani',
  village: 'Mukuzani',
  microzone: 'Mukuzani',
  latitude: 41.81,
  longitude: 45.75,
  area: 2.4,
  elevation: 430,
  slope: '5%',
  aspect: 'South',
  soilType: 'Clay loam',
  grapeVariety: 'Saperavi',
  plantingYear: 2014,
  spacing: '2.2 x 1.2 m',
  rowsCount: 42,
  vinesCount: 3_200,
  trainingSystem: 'Double Guyot',
  pruningSystem: 'Cane pruned',
  irrigationEnabled: false,
  farmingStatus: 'conventional',
  currentPhenology: 'Ripening',
  estimatedHarvestDate: '2026-09-15',
  notes: '',
};

function harvest(overrides: Partial<HarvestRecord> = {}): HarvestRecord {
  return {
    id: 'HARVEST-A',
    blockId: block.id,
    variety: 'Saperavi',
    estimatedHarvestDate: '2026-09-15',
    estimatedTons: 1,
    pickingMethod: 'hand',
    grapeCondition: 'good',
    temperatureAtHarvest: 18,
    sentToGvino: false,
    notes: '',
    ...overrides,
  };
}

function vessel(overrides: Partial<Vessel> = {}): Vessel {
  return {
    id: 'T-1',
    type: 'stainless_steel',
    shape: 'vertical',
    capacity: 1_000,
    currentVolume: 0,
    assignedLotId: null,
    cleaningStatus: 'clean',
    lastCleaned: '2026-09-14',
    temperature: 18,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: 'Sanitized',
    ...overrides,
  };
}

function state(overrides: Partial<HarvestIntakeCommandState> = {}): HarvestIntakeCommandState {
  return {
    blocks: [block],
    harvests: [harvest()],
    lots: [],
    vessels: [vessel()],
    grapeIntakes: [],
    costEntries: [],
    auditLogs: [],
    ...overrides,
  };
}

const payload: HarvestIntakeCommandPayload = {
  intakeId: 'intake-test-0001',
  lotId: 'lot-test-0001',
  auditId: 'audit-intake-test-0001',
  intake: {
    date: '2026-09-15',
    source: 'own',
    blockId: block.id,
    blockName: 'Untrusted stale name',
    variety: 'Saperavi',
    vintage: 2026,
    grossWeightKg: 1_100,
    tareWeightKg: 100,
    brix: 23.5,
    ph: 3.45,
    titratableAcidity: 6.1,
    temperatureC: 18,
    condition: 'good',
    pickingMethod: 'hand',
    wineClass: 'red',
    juiceYieldPct: 70,
    costPerKg: 2.5,
    totalCost: 2_500,
    grapePrice: 2.5,
    paymentStatus: 'unpaid',
    destinationVesselId: 'T-1',
    harvestRecordId: 'HARVEST-A',
    operator: 'Nino',
    notes: 'Healthy fruit',
  },
};

const context = {
  commandId: 'cmd-intake-test-0001',
  actorUsername: 'nino',
  currency: 'USD',
  region: 'Kakheti',
  performedAt: new Date('2026-09-15T09:30:00.000Z'),
};

describe('cellar.harvest-intake domain command', () => {
  it('commits the intake, lot, signed audit, harvest, vessel, and fruit cost as one result', () => {
    const applied = applyHarvestIntakeCommand(state(), payload, context);

    expect(applied.result.receipt).toEqual({
      intakeId: payload.intakeId,
      lotId: payload.lotId,
      netWeightKg: 1_000,
      estimatedVolumeL: 700,
      harvestRecordId: 'HARVEST-A',
      destinationVesselId: 'T-1',
      costPosted: 2_500,
    });
    expect(applied.result.intake).toMatchObject({
      id: payload.intakeId,
      commandId: context.commandId,
      recordKind: 'intake',
      blockName: block.name,
      cadastralCode: block.cadastralCode,
      currency: 'USD',
      netWeightKg: 1_000,
      estimatedVolumeL: 700,
      reversalSnapshot: {
        version: 1,
        lot: { id: payload.lotId, currentVolume: 700, stage: 'crushing' },
        harvest: { id: 'HARVEST-A', sentToGvino: false },
        vessel: { id: 'T-1', currentVolume: 0, assignedLotId: null, lastOperation: 'Sanitized' },
        auditId: payload.auditId,
      },
    });
    expect(applied.result.lot).toMatchObject({
      id: payload.lotId,
      commandId: context.commandId,
      lastCommandId: context.commandId,
      initialVolume: 700,
      currentVolume: 700,
      classification: 'PDO',
      originProofStatus: 'partial',
      history: [expect.objectContaining({ sourceRef: payload.intakeId })],
    });
    expect(applied.result.updatedHarvest).toMatchObject({
      sentToGvino: true,
      actualHarvestedKg: 1_000,
      associatedLotId: payload.lotId,
      lastCommandId: context.commandId,
    });
    expect(applied.result.updatedVessel).toMatchObject({
      currentVolume: 700,
      assignedLotId: payload.lotId,
      lastCommandId: context.commandId,
    });
    expect(applied.result.costEntry).toMatchObject({
      id: 'cost-grape-intake-test-0001',
      amount: 2_500,
      currency: 'USD',
      commandId: context.commandId,
    });
    expect(applied.result.auditLog).toMatchObject({
      id: payload.auditId,
      commandId: context.commandId,
      chainSequence: 1,
      previousHash: 'GENESIS',
      hashAlgorithm: 'SHA-256',
    });
    expect(applied.result.auditLog.chainHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses the configured own-grape rate when no explicit fruit cost is entered', () => {
    const { costPerKg: _costPerKg, totalCost: _totalCost, grapePrice: _grapePrice, ...intake } = payload.intake;
    const applied = applyHarvestIntakeCommand(state(), {
      ...payload,
      intakeId: 'intake-auto-grape-1',
      lotId: 'lot-auto-grape-1',
      auditId: 'audit-auto-grape-1',
      intake,
    }, {
      ...context,
      commandId: 'cmd-intake-auto-grape-1',
      costAutomation: {
        enabled: true,
        ownGrapeCostPerKg: 0.8,
      },
    });

    expect(applied.result.intake).toMatchObject({
      costPerKg: 0.8,
      grapePrice: 0.8,
    });
    expect(applied.result.costEntry).toMatchObject({
      category: 'grape',
      quantity: 1_000,
      unitCost: 0.8,
      amount: 800,
    });
    expect(applied.result.receipt.costPosted).toBe(800);
  });

  it('supports a supplier intake without optional harvest, vessel, or cost effects', () => {
    const applied = applyHarvestIntakeCommand(state(), {
      ...payload,
      intakeId: 'intake-supplier-0001',
      lotId: 'lot-supplier-0001',
      auditId: 'audit-supplier-0001',
      intake: {
        ...payload.intake,
        source: 'supplier',
        supplierName: 'Kakheti Growers',
        blockId: undefined,
        blockName: undefined,
        harvestRecordId: undefined,
        destinationVesselId: null,
        costPerKg: undefined,
        totalCost: undefined,
        grapePrice: undefined,
        paymentStatus: 'not_applicable',
      },
    }, context);

    expect(applied.result.updatedHarvest).toBeUndefined();
    expect(applied.result.updatedVessel).toBeUndefined();
    expect(applied.result.costEntry).toBeUndefined();
    expect(applied.state.harvests).toEqual(state().harvests);
    expect(applied.state.vessels).toEqual(state().vessels);
    expect(applied.result.lot.vineyardBlock).toBe('Kakheti Growers');
  });

  it('rejects a duplicate or mismatched harvest before creating any effect', () => {
    expect(() => applyHarvestIntakeCommand(state({
      harvests: [harvest({ sentToGvino: true, associatedLotId: 'LOT-OLD' })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'harvest_already_received', statusCode: 409 }));

    expect(() => applyHarvestIntakeCommand(state({
      harvests: [harvest({ variety: 'Rkatsiteli' })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'harvest_intake_mismatch', statusCode: 409 }));
  });

  it('requires a clean, empty, unassigned vessel with sufficient capacity', () => {
    expect(() => applyHarvestIntakeCommand(state({
      vessels: [vessel({ currentVolume: 10, assignedLotId: 'LOT-OLD' })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'intake_vessel_unavailable' }));
    expect(() => applyHarvestIntakeCommand(state({
      vessels: [vessel({ capacity: 699 })],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'intake_vessel_capacity_exceeded' }));
  });

  it('rejects every generated record collision, including the deterministic cost entry', () => {
    expect(() => applyHarvestIntakeCommand(state({
      grapeIntakes: [{ ...payload.intake, id: payload.intakeId, createdLotId: 'OLD', netWeightKg: 1, estimatedVolumeL: 1, currency: 'USD' }],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'intake_id_conflict' }));
    expect(() => applyHarvestIntakeCommand(state({
      lots: [{ id: payload.lotId } as any],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'intake_lot_id_conflict' }));
    expect(() => applyHarvestIntakeCommand(state({
      auditLogs: [{ id: payload.auditId } as any],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'intake_audit_id_conflict' }));
    expect(() => applyHarvestIntakeCommand(state({
      costEntries: [{ id: 'cost-grape-intake-test-0001' } as any],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'intake_cost_id_conflict' }));
  });

  it('validates calendar dates, positive net weight, chemistry, yield, and identifiers', () => {
    expect(() => parseHarvestIntakeCommandPayload({
      ...payload,
      intake: { ...payload.intake, date: '2026-02-30' },
    })).toThrowError(expect.objectContaining({ code: 'invalid_harvest_intake_payload', statusCode: 400 }));
    expect(() => parseHarvestIntakeCommandPayload({
      ...payload,
      intake: { ...payload.intake, grossWeightKg: 100, tareWeightKg: 100 },
    })).toThrowError(expect.objectContaining({ code: 'invalid_harvest_intake_payload' }));
    expect(() => parseHarvestIntakeCommandPayload({
      ...payload,
      intake: { ...payload.intake, ph: 20 },
    })).toThrowError(expect.objectContaining({ code: 'invalid_harvest_intake_payload' }));
    expect(() => parseHarvestIntakeCommandPayload({
      ...payload,
      intake: { ...payload.intake, juiceYieldPct: 101 },
    })).toThrowError(expect.objectContaining({ code: 'invalid_harvest_intake_payload' }));
    expect(() => parseHarvestIntakeCommandPayload({ ...payload, lotId: '../bad' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_harvest_intake_payload' }));
  });
});
