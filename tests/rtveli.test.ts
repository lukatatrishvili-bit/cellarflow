import { describe, it, expect } from 'vitest';
import {
  intakeFruitCost, seasonYears, computeSupplierLedger, computeSeasonStats, computeCapacityPlan,
} from '../lib/rtveli';

const intake = (over: any = {}) => ({
  id: 'gi', date: '2026-09-20', source: 'supplier', supplierName: 'გიორგი ბ.',
  variety: 'რქაწითელი', vintage: 2026, grossWeightKg: 1050, tareWeightKg: 50, netWeightKg: 1000,
  brix: 21, ph: 3.2, titratableAcidity: 6, temperatureC: 18, condition: 'good',
  pickingMethod: 'hand', wineClass: 'amber', juiceYieldPct: 70, estimatedVolumeL: 700,
  destinationVesselId: null, createdLotId: 'L1', operator: 'op', notes: '',
  ...over,
}) as any;

const payment = (over: any = {}) => ({
  id: 'p', date: '2026-09-25', supplierName: 'გიორგი ბ.', amount: 500,
  currency: 'GEL', method: 'bank', operator: 'op', ...over,
}) as any;

describe('rtveli — fruit cost', () => {
  it('uses costPerKg × net weight when no explicit total', () => {
    expect(intakeFruitCost({ netWeightKg: 1000, costPerKg: 2.5 })).toBe(2500);
  });
  it('an explicit totalCost overrides the per-kg computation', () => {
    expect(intakeFruitCost({ netWeightKg: 1000, costPerKg: 2.5, totalCost: 2400 })).toBe(2400);
  });
  it('unpriced fruit costs zero (never guessed)', () => {
    expect(intakeFruitCost({ netWeightKg: 1000 })).toBe(0);
  });
});

describe('rtveli — supplier ledger', () => {
  it('aggregates deliveries, owed, paid and balance per supplier', () => {
    const intakes = [
      intake({ id: 'a', costPerKg: 2, netWeightKg: 1000 }),           // 2000 owed
      intake({ id: 'b', costPerKg: 2.5, netWeightKg: 800, variety: 'საფერავი' }), // 2000 owed
    ];
    const ledger = computeSupplierLedger(intakes, [payment({ amount: 1500 })], 2026);
    expect(ledger).toHaveLength(1);
    const row = ledger[0];
    expect(row.deliveries).toBe(2);
    expect(row.totalKg).toBe(1800);
    expect(row.varieties).toEqual(['რქაწითელი', 'საფერავი']);
    expect(row.totalOwed).toBe(4000);
    expect(row.totalPaid).toBe(1500);
    expect(row.balance).toBe(2500);
  });

  it('tracks unpriced kg separately instead of inventing a price', () => {
    const ledger = computeSupplierLedger([intake({ costPerKg: undefined })], [], 2026);
    expect(ledger[0].totalOwed).toBe(0);
    expect(ledger[0].unpricedKg).toBe(1000);
  });

  it('own-vineyard fruit never creates a payable', () => {
    const ledger = computeSupplierLedger([intake({ source: 'own', supplierName: undefined, blockName: 'B1' })], [], 2026);
    expect(ledger).toHaveLength(0);
  });

  it('filters by season and keeps orphan payments visible', () => {
    const intakes = [intake({ date: '2025-09-20', costPerKg: 2 })]; // previous season
    const pays = [payment({ date: '2026-09-01', supplierName: 'უცნობი მომწოდებელი', amount: 300 })];
    const ledger = computeSupplierLedger(intakes, pays, 2026);
    expect(ledger).toHaveLength(1); // only the orphan payment's supplier
    expect(ledger[0].supplierName).toBe('უცნობი მომწოდებელი');
    expect(ledger[0].deliveries).toBe(0);
    expect(ledger[0].balance).toBe(-300); // advance
  });

  it('sorts by outstanding balance (who is waiting for money first)', () => {
    const intakes = [
      intake({ id: 'a', supplierName: 'A', costPerKg: 1 }),   // owed 1000
      intake({ id: 'b', supplierName: 'B', costPerKg: 3 }),   // owed 3000
    ];
    const ledger = computeSupplierLedger(intakes, [], 2026);
    expect(ledger.map(r => r.supplierName)).toEqual(['B', 'A']);
  });

  it('removes reversed receipts and correction rows from the live supplier balance', () => {
    const original = intake({ id: 'original', commandId: 'cmd-intake', costPerKg: 2, reversedByCommandId: 'cmd-reversal' });
    const correction = intake({
      id: 'correction', recordKind: 'reversal', reversalOfIntakeId: original.id,
      reversalOfCommandId: original.commandId,
    });
    expect(computeSupplierLedger([original, correction], [], 2026)).toEqual([]);
  });
});

describe('rtveli — season stats', () => {
  it('splits supplier vs own fruit and weights Brix by kg', () => {
    const intakes = [
      intake({ id: 'a', netWeightKg: 1000, brix: 20 }),
      intake({ id: 'b', source: 'own', supplierName: undefined, netWeightKg: 3000, brix: 24 }),
    ];
    const s = computeSeasonStats(intakes, 2026, '2026-09-20');
    expect(s.totalKg).toBe(4000);
    expect(s.supplierKg).toBe(1000);
    expect(s.ownKg).toBe(3000);
    expect(s.weightedAvgBrix).toBe(23); // (20*1000 + 24*3000) / 4000
    expect(s.todayDeliveries).toBe(2);  // both dated 2026-09-20
  });

  it('excludes other seasons and unmeasured Brix from the average', () => {
    const intakes = [
      intake({ id: 'a', brix: 22 }),
      intake({ id: 'b', date: '2025-09-10', brix: 30 }),   // other season
      intake({ id: 'c', brix: 0, netWeightKg: 500 }),      // unmeasured
    ];
    const s = computeSeasonStats(intakes, 2026, '2026-01-01');
    expect(s.deliveries).toBe(2);
    expect(s.weightedAvgBrix).toBe(22);
    expect(seasonYears(intakes)).toEqual([2026, 2025]);
  });

  it('does not count reversed intake pairs as current season production', () => {
    const original = intake({ id: 'original', commandId: 'cmd-intake', reversedAt: '2026-09-21T00:00:00Z' });
    const correction = intake({ id: 'correction', recordKind: 'reversal', reversalOfIntakeId: original.id });
    const stats = computeSeasonStats([original, correction], 2026);
    expect(stats.totalKg).toBe(0);
    expect(stats.deliveries).toBe(0);
    expect(seasonYears([original, correction])).toEqual([]);
  });
});

describe('rtveli — capacity plan', () => {
  it('reports free litres per vessel, roomiest first', () => {
    const vessels = [
      { id: 'T-1', type: 'stainless_steel', capacity: 5000, currentVolume: 4500 },
      { id: 'Q-1', type: 'qvevri', capacity: 1500, currentVolume: 0 },
      { id: 'T-2', type: 'stainless_steel', capacity: 2000, currentVolume: 2000 }, // full
    ] as any[];
    const plan = computeCapacityPlan(vessels);
    expect(plan.totalCapacityL).toBe(8500);
    expect(plan.freeL).toBe(2000);
    expect(plan.freeVessels.map(v => v.id)).toEqual(['Q-1', 'T-1']);
    expect(plan.freeVessels[0].empty).toBe(true);
  });
});
