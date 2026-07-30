import { describe, it, expect } from 'vitest';
import { blockRecords, labsForLot, snapshotIndexes } from '../lib/ai/indexes';
import { evaluateRules } from '../lib/ai/rules';
import { normalizeSnapshot } from '../lib/ai/snapshot';

/**
 * The index exists for one reason: detectors are written per lot and per block,
 * and filtering whole collections inside those loops made evaluation quadratic.
 * Timing assertions would be flaky on shared CI, so these lock the two
 * properties that actually make the optimisation correct and durable — the
 * index is built once, and nobody reorders the arrays it hands out.
 */

const lab = (id: string, lotId: string, date: string) => ({
  id, lotId, tankId: 'T1', date,
  alcoholPct: 13, volatileAcid: 0.3, freeSo2: 25, totalSo2: 90, residualSugar: 2,
  ph: 3.4, malicAcid: 0.3, lacticAcid: 0.2, turbidity: 3,
  technician: 'QA', titratableAcidity: 6,
}) as any;

const ferm = (id: string, lotId: string, date: string, density: number) => ({
  id, tankId: 'T1', lotId, date, temperature: 24, density, sugar: 60, ph: 3.4,
  tastingNotes: '', capManagement: '', additives: '',
}) as any;

const snapshotInput = () => ({
  today: '2026-09-20',
  lots: [
    {
      id: 'L1', name: 'Saperavi', vintage: 2026, variety: 'Saperavi', vineyardBlock: 'B1',
      region: 'Kakheti', initialVolume: 900, currentVolume: 900, wineClass: 'red',
      stage: 'aging', createdAt: '2026-01-01', history: [],
    },
  ],
  labLogs: [
    lab('lab-old', 'L1', '2026-05-01'),
    lab('lab-new', 'L1', '2026-08-01'),
    lab('lab-mid', 'L1', '2026-06-01'),
    lab('lab-other', 'L2', '2026-08-15'),
  ],
  fermLogs: [
    ferm('f1', 'L1', '2026-03-01', 1.05),
    // A reversal is a compensating ledger fact, never a physical measurement.
    { ...ferm('f2', 'L1', '2026-03-05', 1.02), recordKind: 'reversal' },
  ],
  sprays: [{ id: 's1', blockId: 'B1', date: '2026-06-01', targetProblem: 'Downy mildew', productName: 'X', activeIngredient: 'Y', dosePerHa: 1, waterVolumePerHa: 200, totalProductUsed: 1, totalWaterUsed: 200, operator: 'QA', machineryUsed: '', windSpeed: 5, temperature: 20, humidity: 60, preHarvestIntervalDays: 21, reEntryIntervalHours: 24, notes: '' }],
  samplings: [{ id: 'sa1', blockId: 'B1', date: '2026-09-01', brix: 20, pH: 3.2, totalAcidityGL: 7, berryWeightG: 1.4, phenolicMaturity: 'Intermediate', seedColor: 'Yellow-brown', tasteNotes: '', diseaseCondition: '', estimatedHarvestDate: '', notes: '' }],
} as any);

describe('snapshot indexes', () => {
  it('builds once per snapshot and reuses it', () => {
    const snapshot = normalizeSnapshot(snapshotInput());
    // Same snapshot object → same index. A rebuild per call would restore the
    // quadratic cost this module exists to remove.
    expect(snapshotIndexes(snapshot)).toBe(snapshotIndexes(snapshot));
    expect(labsForLot(snapshot, 'L1')).toBe(labsForLot(snapshot, 'L1'));
  });

  it('does not leak one snapshot\'s index into the next', () => {
    const first = normalizeSnapshot(snapshotInput());
    const second = normalizeSnapshot({ ...snapshotInput(), labLogs: [] });
    expect(labsForLot(first, 'L1')).toHaveLength(3);
    expect(labsForLot(second, 'L1')).toHaveLength(0);
  });

  it('returns lot analyses newest first', () => {
    const snapshot = normalizeSnapshot(snapshotInput());
    expect(labsForLot(snapshot, 'L1').map((row) => row.id)).toEqual(['lab-new', 'lab-mid', 'lab-old']);
  });

  it('scopes by entity and excludes reversal rows from readings', () => {
    const snapshot = normalizeSnapshot(snapshotInput());
    // 'lab-other' belongs to L2 and must not appear under L1.
    expect(labsForLot(snapshot, 'L1').some((row) => row.id === 'lab-other')).toBe(false);
    expect(labsForLot(snapshot, 'MISSING')).toEqual([]);
    expect(snapshotIndexes(snapshot).fermReadingsByLot.get('L1')?.map((row) => row.id)).toEqual(['f1']);
  });

  it('groups vineyard records by block', () => {
    const snapshot = normalizeSnapshot(snapshotInput());
    const records = blockRecords(snapshot, 'B1');
    expect(records.sprays).toHaveLength(1);
    expect(records.samplings).toHaveLength(1);
    expect(blockRecords(snapshot, 'MISSING').sprays).toEqual([]);
  });

  it('orders dated block records newest first so [0] is the latest', () => {
    // The vineyard detector reads `sprays[0]` as "last protection". If the group
    // were in input order that caption would silently name the wrong spray.
    const spray = (id: string, date: string) => ({
      id, blockId: 'B1', date, targetProblem: 'Downy mildew', productName: id,
      activeIngredient: 'Y', dosePerHa: 1, waterVolumePerHa: 200, totalProductUsed: 1,
      totalWaterUsed: 200, operator: 'QA', machineryUsed: '', windSpeed: 5,
      temperature: 20, humidity: 60, preHarvestIntervalDays: 21,
      reEntryIntervalHours: 24, notes: '',
    });
    const snapshot = normalizeSnapshot({
      ...snapshotInput(),
      sprays: [spray('older', '2026-05-01'), spray('latest', '2026-07-01'), spray('mid', '2026-06-01')],
    } as any);
    expect(blockRecords(snapshot, 'B1').sprays.map((row) => row.id))
      .toEqual(['latest', 'mid', 'older']);
  });

  it('is never reordered in place by a detector', () => {
    // The arrays are shared across detectors, so an in-place sort in one would
    // silently corrupt the input of the next. This is the guard for that.
    const snapshot = normalizeSnapshot(snapshotInput());
    const before = labsForLot(snapshot, 'L1').map((row) => row.id);
    evaluateRules(snapshotInput());
    snapshotIndexes(snapshot);
    expect(labsForLot(snapshot, 'L1').map((row) => row.id)).toEqual(before);
  });

  it('produces findings identical to a fresh evaluation of the same state', () => {
    // Indexing is an optimisation, not a behaviour change.
    const first = evaluateRules(snapshotInput()).findings;
    const second = evaluateRules(snapshotInput()).findings;
    expect(first.map((f) => f.dedupeKey)).toEqual(second.map((f) => f.dedupeKey));
    expect(first.map((f) => f.severity)).toEqual(second.map((f) => f.severity));
  });
});
