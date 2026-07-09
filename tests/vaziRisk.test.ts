import { describe, expect, it } from 'vitest';
import { calculateVaziRisk } from '../lib/vaziRisk';
import type { VineyardBlock } from '../lib/wineryState';

const block: VineyardBlock = {
  id: 'BLK-1',
  name: 'Mukuzani block',
  vineyardName: 'Estate',
  locationName: 'Mukuzani',
  latitude: 41.9,
  longitude: 45.8,
  area: 2,
  elevation: 420,
  slope: 'south',
  aspect: 'south',
  soilType: 'loam',
  grapeVariety: 'Saperavi',
  plantingYear: 2015,
  spacing: '2.4 x 1.1',
  rowsCount: 20,
  vinesCount: 3000,
  trainingSystem: 'Guyot',
  pruningSystem: 'cane',
  irrigationEnabled: true,
  farmingStatus: 'organic',
  currentPhenology: 'Veraison',
  estimatedHarvestDate: '2026-07-15',
  notes: '',
};

describe('Vazi risk engine', () => {
  it('raises mildew and botrytis risk under wet humid canopy conditions', () => {
    const summary = calculateVaziRisk({
      block,
      weather: { temp: 22, tempMax: 26, rainMm: 12, humidity: 91 },
      today: new Date('2026-07-08T00:00:00Z'),
    });

    expect(summary.items.downyMildew.level).toMatch(/high|critical/);
    expect(summary.items.botrytis.level).toMatch(/moderate|high|critical/);
    expect(summary.items.downyMildew.reasons).toEqual(expect.arrayContaining(['12 mm rain', '91% humidity']));
  });

  it('detects pre-harvest interval conflicts against planned harvest', () => {
    const summary = calculateVaziRisk({
      block,
      sprays: [{
        id: 'SP-1',
        blockId: block.id,
        date: '2026-07-05',
        targetProblem: 'Downy mildew',
        productName: 'Generic contact product',
        activeIngredient: 'entered by user',
        dosePerHa: 1,
        waterVolumePerHa: 400,
        totalProductUsed: 2,
        totalWaterUsed: 800,
        operator: 'Nino',
        machineryUsed: 'sprayer',
        windSpeed: 5,
        temperature: 22,
        humidity: 70,
        preHarvestIntervalDays: 14,
        reEntryIntervalHours: 24,
        notes: '',
      }],
      today: new Date('2026-07-08T00:00:00Z'),
    });

    expect(summary.items.phiConflict.level).toMatch(/high|critical/);
    expect(summary.items.phiConflict.reasons).toEqual(expect.arrayContaining(['planned harvest before PHI clears']));
  });

  it('reduces water stress when recent irrigation is logged', () => {
    const dryWithoutIrrigation = calculateVaziRisk({
      block,
      weather: { temp: 33, tempMax: 36, rainMm: 0, humidity: 35 },
      today: new Date('2026-07-08T00:00:00Z'),
    });
    const withIrrigation = calculateVaziRisk({
      block,
      weather: { temp: 33, tempMax: 36, rainMm: 0, humidity: 35 },
      irrigationLogs: [{
        id: 'IR-1',
        blockId: block.id,
        date: '2026-07-06',
        durationHours: 4,
        waterVolumeLiters: 12000,
        soilMoistureBeforePct: 18,
        soilMoistureAfterPct: 28,
        weatherConditions: 'dry',
        notes: '',
      }],
      today: new Date('2026-07-08T00:00:00Z'),
    });

    expect(withIrrigation.items.waterStress.score).toBeLessThan(dryWithoutIrrigation.items.waterStress.score);
  });
});
