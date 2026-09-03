import { describe, expect, it } from 'vitest';
import { maxLitresPerVessel, planBatchTopping } from '../lib/batchTopping';
import type { Vessel, WineLot } from '../lib/wineryState';

const barrel = (id: string, patch: Partial<Vessel> = {}): Vessel => ({
  id,
  type: 'barrel',
  shape: 'horizontal',
  capacity: 225,
  currentVolume: 218,
  assignedLotId: 'LOT-A',
  cleaningStatus: 'clean',
  lastCleaned: '2026-09-01',
  temperature: 16,
  coolingJacketActive: false,
  targetTemperature: null,
  lastOperation: 'Filled',
  ...patch,
});

const lot = (id: string, currentVolume: number): WineLot => ({
  id,
  name: `Lot ${id}`,
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'A',
  region: 'Kakheti',
  initialVolume: currentVolume,
  currentVolume,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-09-01T00:00:00.000Z',
  history: [],
});

const cellar = (sourceVolume = 300) => ({
  vessels: [
    barrel('B-01'),
    barrel('B-02'),
    barrel('B-03'),
    barrel('TOP-1', { type: 'stainless_steel', shape: 'vertical', capacity: 500, currentVolume: sourceVolume, assignedLotId: 'LOT-TOP' }),
    barrel('B-EMPTY', { currentVolume: 0, assignedLotId: null }),
  ],
  lots: [lot('LOT-A', 880), lot('LOT-TOP', sourceVolume)],
});

const plan = (targetVesselIds: string[], litresPerVessel: number, sourceVolume = 300) => {
  const { vessels, lots } = cellar(sourceVolume);
  return planBatchTopping({ sourceVesselId: 'TOP-1', targetVesselIds, litresPerVessel, vessels, lots });
};

describe('planBatchTopping', () => {
  it('plans every barrel when the source covers them all', () => {
    const preview = plan(['B-01', 'B-02', 'B-03'], 5);

    expect(preview.toppable).toHaveLength(3);
    expect(preview.skipped).toEqual([]);
    expect(preview.totalDrawL).toBe(15);
    expect(preview.shortfallL).toBe(0);
  });

  it('draws against the running source balance, not the opening one', () => {
    // 12 L of source, 5 L each: two barrels fit, the third does not.
    const preview = plan(['B-01', 'B-02', 'B-03'], 5, 12);

    expect(preview.toppable.map(entry => entry.vesselId)).toEqual(['B-01', 'B-02']);
    expect(preview.skipped.map(entry => entry.issue)).toEqual(['insufficient_source']);
    expect(preview.totalDrawL).toBe(10);
    expect(preview.shortfallL).toBe(5);
  });

  it('keeps the batch in the order the barrels were given', () => {
    const preview = plan(['B-03', 'B-01'], 5);

    expect(preview.entries.map(entry => entry.vesselId)).toEqual(['B-03', 'B-01']);
  });

  it('skips a barrel with no lot rather than inventing one', () => {
    const preview = plan(['B-01', 'B-EMPTY'], 5);

    expect(preview.toppable.map(entry => entry.vesselId)).toEqual(['B-01']);
    expect(preview.skipped[0]).toMatchObject({ vesselId: 'B-EMPTY', issue: 'source_has_no_lot' });
  });

  it('skips the source if it was selected too', () => {
    const preview = plan(['B-01', 'TOP-1'], 5);

    expect(preview.skipped[0]).toMatchObject({ vesselId: 'TOP-1', issue: 'same_vessel' });
    expect(preview.totalDrawL).toBe(5);
  });

  it('skips a barrel that would overflow', () => {
    // 218 L in a 225 L barrel leaves 7 L.
    const preview = plan(['B-01'], 8);

    expect(preview.skipped[0]).toMatchObject({ issue: 'over_capacity' });
    expect(preview.totalDrawL).toBe(0);
  });

  it('reports an unknown vessel instead of silently dropping it', () => {
    const preview = plan(['B-01', 'GONE'], 5);

    expect(preview.skipped.map(entry => entry.vesselId)).toEqual(['GONE']);
  });

  it('carries a usable plan for each toppable barrel', () => {
    const preview = plan(['B-01'], 5);

    expect(preview.toppable[0].plan).toMatchObject({
      toppedVesselId: 'B-01',
      toppedLotId: 'LOT-A',
      sourceVesselId: 'TOP-1',
      sourceLotId: 'LOT-TOP',
      volumeL: 5,
    });
  });

  it('plans nothing from an empty selection', () => {
    const preview = plan([], 5);

    expect(preview).toMatchObject({ entries: [], toppable: [], skipped: [], totalDrawL: 0, shortfallL: 0 });
  });

  it('refuses a nonsense per-barrel amount without throwing', () => {
    for (const litres of [0, -1, Number.NaN]) {
      const preview = plan(['B-01', 'B-02'], litres);
      expect(preview.toppable).toEqual([]);
      expect(preview.skipped.every(entry => entry.issue === 'no_volume')).toBe(true);
    }
  });
});

describe('maxLitresPerVessel', () => {
  const suggest = (targetVesselIds: string[], sourceVolume = 300) =>
    maxLitresPerVessel({ sourceVesselId: 'TOP-1', targetVesselIds, vessels: cellar(sourceVolume).vessels });

  it('divides the source across the barrels', () => {
    // 12 L across three barrels, and each has 7 L of headroom.
    expect(suggest(['B-01', 'B-02', 'B-03'], 12)).toBe(4);
  });

  it('never exceeds the tightest barrel’s headroom', () => {
    // Plenty of source, but the barrels only have 7 L of space each.
    expect(suggest(['B-01', 'B-02'], 900)).toBe(7);
  });

  it('ignores the source and barrels with no lot', () => {
    expect(suggest(['B-01', 'TOP-1', 'B-EMPTY'], 14)).toBe(7);
  });

  it('is zero when nothing can be topped', () => {
    expect(suggest(['B-EMPTY'])).toBe(0);
    expect(suggest([])).toBe(0);
  });

  it('suggests an amount its own planner then accepts', () => {
    const litres = suggest(['B-01', 'B-02', 'B-03'], 12);
    const preview = plan(['B-01', 'B-02', 'B-03'], litres, 12);

    expect(preview.skipped).toEqual([]);
    expect(preview.toppable).toHaveLength(3);
  });
});
