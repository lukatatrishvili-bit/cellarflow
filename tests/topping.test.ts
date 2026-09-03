import { describe, expect, it } from 'vitest';
import {
  applyTopping,
  planTopping,
  toppingIssueMessage,
  type ToppingIssue,
} from '../lib/topping';
import type { Vessel, WineLot } from '../lib/wineryState';

const vessel = (id: string, patch: Partial<Vessel> = {}): Vessel => ({
  id,
  type: 'oak_barrel',
  shape: 'horizontal',
  capacity: 225,
  currentVolume: 220,
  assignedLotId: 'LOT-1',
  cleaningStatus: 'clean',
  lastCleaned: '2026-09-01',
  temperature: 16,
  coolingJacketActive: false,
  targetTemperature: null,
  lastOperation: 'Filled',
  ...patch,
});

const lot = (id: string, patch: Partial<WineLot> = {}): WineLot => ({
  id,
  name: `Lot ${id}`,
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Block A',
  region: 'Kakheti',
  initialVolume: 900,
  currentVolume: 880,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-09-01T06:00:00.000Z',
  history: [],
  ...patch,
});

const cellar = () => ({
  vessels: [
    vessel('B-01', { currentVolume: 218, assignedLotId: 'LOT-1' }),
    vessel('TOP-1', { capacity: 500, currentVolume: 300, assignedLotId: 'LOT-TOP' }),
    vessel('B-EMPTY', { currentVolume: 0, assignedLotId: null }),
  ],
  lots: [lot('LOT-1', { currentVolume: 880 }), lot('LOT-TOP', { currentVolume: 300 })],
});

const check = (overrides: Partial<Parameters<typeof planTopping>[0]> = {}) => {
  const { vessels, lots } = cellar();
  return planTopping({
    toppedVessel: vessels[0],
    toppedLotId: 'LOT-1',
    sourceVesselId: 'TOP-1',
    vessels,
    lots,
    volumeL: 5,
    ...overrides,
  });
};

describe('planTopping', () => {
  it('plans a straightforward top-up', () => {
    const result = check();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({
      toppedVesselId: 'B-01',
      toppedLotId: 'LOT-1',
      sourceVesselId: 'TOP-1',
      sourceLotId: 'LOT-TOP',
      volumeL: 5,
      sourceLotVolumeBefore: 300,
    });
  });

  it('refuses a volume that is missing, zero or nonsense', () => {
    for (const volumeL of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = check({ volumeL });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issue).toBe('no_volume');
    }
  });

  it('refuses to top a vessel from itself', () => {
    const result = check({ sourceVesselId: 'B-01' });

    expect(result).toEqual({ ok: false, issue: 'same_vessel' });
  });

  it('refuses an unknown source vessel', () => {
    expect(check({ sourceVesselId: 'NOPE' })).toEqual({ ok: false, issue: 'unknown_source_vessel' });
  });

  it('refuses a source vessel holding no lot', () => {
    expect(check({ sourceVesselId: 'B-EMPTY' })).toEqual({ ok: false, issue: 'source_has_no_lot' });
  });

  it('refuses to draw more than the source holds', () => {
    expect(check({ volumeL: 301 })).toEqual({ ok: false, issue: 'insufficient_source' });
  });

  it('allows drawing the source down to exactly empty', () => {
    expect(check({ volumeL: 300 }).ok).toBe(false); // 218 + 300 exceeds a 225 L barrel
    const { vessels, lots } = cellar();
    const result = planTopping({
      toppedVessel: vessel('TANK', { capacity: 1000, currentVolume: 100, assignedLotId: 'LOT-1' }),
      toppedLotId: 'LOT-1',
      sourceVesselId: 'TOP-1',
      vessels,
      lots,
      volumeL: 300,
    });

    expect(result.ok).toBe(true);
  });

  it('refuses to overfill the topped vessel', () => {
    // 218 L in a 225 L barrel leaves 7 L of headspace.
    expect(check({ volumeL: 8 })).toEqual({ ok: false, issue: 'over_capacity' });
    expect(check({ volumeL: 7 }).ok).toBe(true);
  });

  it('does not clamp a rejected volume into an accepted one', () => {
    // Refusing rather than silently topping by less is the point: a clamped
    // record and the barrel would disagree.
    const result = check({ volumeL: 99 });

    expect(result.ok).toBe(false);
  });

  it('falls back to the vessel volume when the source lot record is missing', () => {
    const { vessels } = cellar();
    const result = planTopping({
      toppedVessel: vessels[0],
      toppedLotId: 'LOT-1',
      sourceVesselId: 'TOP-1',
      vessels,
      lots: [],
      volumeL: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.sourceLotVolumeBefore).toBe(300);
  });

  it('rounds litres the way the rest of the cellar stores them', () => {
    const result = check({ volumeL: 1.23456 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.volumeL).toBe(1.235);
  });
});

describe('applyTopping', () => {
  const apply = (volumeL = 5) => {
    const { vessels, lots } = cellar();
    const planned = planTopping({
      toppedVessel: vessels[0],
      toppedLotId: 'LOT-1',
      sourceVesselId: 'TOP-1',
      vessels,
      lots,
      volumeL,
    });
    if (!planned.ok) throw new Error('expected a valid plan');
    return applyTopping({
      plan: planned.plan,
      vessels,
      lots,
      date: '2026-09-01',
      operator: 'ana',
      description: 'Topping · TOP-1 → B-01 · 5 L',
    });
  };

  it('moves the litres out of the source and into the topped barrel', () => {
    const { vessels } = apply();

    expect(vessels.find(entry => entry.id === 'TOP-1')?.currentVolume).toBe(295);
    expect(vessels.find(entry => entry.id === 'B-01')?.currentVolume).toBe(223);
  });

  it('moves the same litres between the two lots', () => {
    const { lots } = apply();

    expect(lots.find(entry => entry.id === 'LOT-TOP')?.currentVolume).toBe(295);
    expect(lots.find(entry => entry.id === 'LOT-1')?.currentVolume).toBe(885);
  });

  it('never writes a lot total onto a single barrel', () => {
    // The topped lot holds 880 L across several barrels. Borrowing the generic
    // "set both to one total" path would put 885 L into a 225 L barrel.
    const { vessels } = apply();
    const barrel = vessels.find(entry => entry.id === 'B-01')!;

    expect(barrel.currentVolume).toBeLessThanOrEqual(barrel.capacity);
  });

  it('records the draw on the source lot timeline', () => {
    const { lots } = apply();
    const entry = lots.find(item => item.id === 'LOT-TOP')?.history?.[0];

    expect(entry).toMatchObject({ date: '2026-09-01', type: 'Topping', operator: 'ana' });
    expect(entry?.description).toContain('TOP-1');
  });

  it('leaves the topped lot timeline to the operation handler', () => {
    // Every operation already writes one entry there; a second would duplicate it.
    const { lots } = apply();

    expect(lots.find(item => item.id === 'LOT-1')?.history).toEqual([]);
  });

  it('never drives a volume negative', () => {
    const { vessels, lots } = cellar();
    const effect = applyTopping({
      plan: {
        toppedVesselId: 'B-01',
        toppedLotId: 'LOT-1',
        sourceVesselId: 'TOP-1',
        sourceLotId: 'LOT-TOP',
        volumeL: 9_999,
        sourceLotVolumeBefore: 300,
      },
      vessels,
      lots,
      date: '2026-09-01',
      operator: 'ana',
      description: 'over-draw',
    });

    expect(effect.vessels.find(entry => entry.id === 'TOP-1')?.currentVolume).toBe(0);
    expect(effect.lots.find(entry => entry.id === 'LOT-TOP')?.currentVolume).toBe(0);
  });

  it('touches nothing else in the cellar', () => {
    const { vessels } = apply();

    expect(vessels.find(entry => entry.id === 'B-EMPTY')?.currentVolume).toBe(0);
  });
});

describe('toppingIssueMessage', () => {
  it('says something useful for every refusal, in both languages', () => {
    const issues: ToppingIssue[] = [
      'no_volume', 'same_vessel', 'unknown_source_vessel',
      'source_has_no_lot', 'insufficient_source', 'over_capacity',
    ];

    for (const issue of issues) {
      for (const lang of ['en', 'ka'] as const) {
        expect(toppingIssueMessage(issue, lang).trim().length).toBeGreaterThan(8);
      }
    }
  });
});
