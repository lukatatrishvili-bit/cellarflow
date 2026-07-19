import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import GrapeReceivingTab, { restrictOptionalIntakeWrites } from '../components/GrapeReceivingTab';
import type { GrapeIntakeRecord, HarvestRecord, Vessel, VineyardBlock } from '../lib/wineryState';

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
  currentPhenology: 'Veraison',
  estimatedHarvestDate: '2026-09-15',
  notes: '',
};

const harvest: HarvestRecord = {
  id: 'HARVEST-A',
  blockId: block.id,
  variety: 'Saperavi',
  estimatedHarvestDate: '2026-09-15',
  estimatedTons: 3.2,
  pickingMethod: 'hand',
  grapeCondition: 'good',
  temperatureAtHarvest: 18,
  sentToGvino: false,
  notes: '',
};

const vessel: Vessel = {
  id: 'T-1',
  type: 'stainless_steel',
  shape: 'vertical',
  capacity: 5_000,
  currentVolume: 0,
  assignedLotId: null,
  cleaningStatus: 'clean',
  lastCleaned: '2026-09-10',
  temperature: 18,
  coolingJacketActive: false,
  targetTemperature: null,
  lastOperation: 'Sanitized',
};

const intake: GrapeIntakeRecord = {
  id: 'INTAKE-A',
  date: '2026-09-15',
  source: 'own',
  blockId: block.id,
  blockName: block.name,
  variety: 'Saperavi',
  vintage: 2026,
  grossWeightKg: 1_100,
  tareWeightKg: 100,
  netWeightKg: 1_000,
  brix: 23.5,
  ph: 3.45,
  titratableAcidity: 6.1,
  temperatureC: 18,
  condition: 'good',
  pickingMethod: 'hand',
  wineClass: 'red',
  juiceYieldPct: 70,
  estimatedVolumeL: 700,
  destinationVesselId: vessel.id,
  createdLotId: 'LOT-SAP-2026',
  operator: 'Nino',
  notes: '',
};

function props(
  overrides: Partial<ComponentProps<typeof GrapeReceivingTab>> = {},
): ComponentProps<typeof GrapeReceivingTab> {
  return {
    lang: 'en',
    vessels: [vessel],
    blocks: [block],
    harvests: [harvest],
    intakes: [intake],
    currentUserName: 'Nino',
    currency: 'GEL',
    onReceiveGrapes: vi.fn(() => 'LOT-NEW'),
    setActiveTab: vi.fn(),
    setToastMessage: vi.fn(),
    ...overrides,
  };
}

function renderReceiving(
  overrides: Partial<ComponentProps<typeof GrapeReceivingTab>> = {},
): string {
  return renderToStaticMarkup(React.createElement(GrapeReceivingTab, props(overrides)));
}

describe('GrapeReceivingTab compound action permissions', () => {
  it('keeps intake history and batch navigation while hiding every write control in read-only mode', () => {
    const markup = renderReceiving({
      canReceiveGrapes: false,
      canLinkHarvest: false,
      canFillDestinationVessel: false,
      canPostIntakeCost: false,
    });

    expect(markup).toContain('Read-only intake access');
    expect(markup).toContain('Intake log');
    expect(markup).toContain('Saperavi');
    expect(markup).toContain('LOT-SAP-2026');
    expect(markup).not.toContain('Own vineyard</button>');
    expect(markup).not.toContain('Record intake &amp; create batch');
    expect(markup).not.toContain('From planned harvest');
    expect(markup).not.toContain('Fruit cost / kg');
    expect(markup).not.toContain('Destination vessel');
  });

  it('keeps the core intake available while independently hiding optional compound writes', () => {
    const markup = renderReceiving({
      canReceiveGrapes: true,
      canLinkHarvest: false,
      canFillDestinationVessel: false,
      canPostIntakeCost: false,
    });

    expect(markup).toContain('Limited intake actions');
    expect(markup).toContain('planned-harvest linking');
    expect(markup).toContain('destination-vessel filling');
    expect(markup).toContain('cost-ledger posting');
    expect(markup).toContain('Own vineyard</button>');
    expect(markup).toContain('Vineyard block');
    expect(markup).toContain('Record intake &amp; create batch');
    expect(markup).not.toContain('From planned harvest');
    expect(markup).not.toContain('Fruit cost / kg');
    expect(markup).not.toContain('Destination vessel');
  });

  it('retains every existing receiving action by default', () => {
    const markup = renderReceiving();

    expect(markup).not.toContain('Limited intake actions');
    expect(markup).not.toContain('Read-only intake access');
    expect(markup).toContain('From planned harvest (optional)');
    expect(markup).toContain('Fruit cost / kg (GEL)');
    expect(markup).toContain('Destination vessel');
    expect(markup).toContain('Record intake &amp; create batch');
  });

  it('localizes read-only guidance and empty history in Georgian', () => {
    const markup = renderReceiving({
      lang: 'ka',
      intakes: [],
      canReceiveGrapes: false,
      canLinkHarvest: false,
      canFillDestinationVessel: false,
      canPostIntakeCost: false,
    });

    expect(markup).toContain('მიღებებზე მხოლოდ ნახვის წვდომა');
    expect(markup).toContain('არსებული მიღების ჩანაწერები აქ გამოჩნდება');
    expect(markup).not.toContain('Read-only intake access');
    expect(markup).not.toContain('Fill in the receiving form');
  });

  it('strips forbidden optional writes before the receiving callback can persist them', () => {
    const prepared = restrictOptionalIntakeWrites({
      date: '2026-09-15',
      source: 'own',
      blockId: block.id,
      blockName: block.name,
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
      currency: 'GEL',
      grapePrice: 2.5,
      paymentStatus: 'unpaid',
      destinationVesselId: vessel.id,
      harvestRecordId: harvest.id,
      operator: 'Nino',
      notes: '',
    }, {
      canLinkHarvest: false,
      canFillDestinationVessel: false,
      canPostIntakeCost: false,
    });

    expect(prepared).toMatchObject({
      destinationVesselId: null,
      harvestRecordId: undefined,
      costPerKg: undefined,
      totalCost: undefined,
      grapePrice: undefined,
      paymentStatus: 'not_applicable',
    });
  });
});
