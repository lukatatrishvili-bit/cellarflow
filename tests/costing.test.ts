import { describe, it, expect } from 'vitest';
import {
  summarizeLot, perUnit, marginPct, valuation, rollupLots, computeBlendTransfers, totalLedger,
  type CostEntry,
} from '../lib/costing';

const E = (over: Partial<CostEntry>): CostEntry => ({
  id: Math.random().toString(36).slice(2),
  date: '2026-10-01', lotId: 'L1', category: 'other', description: '',
  amount: 0, currency: 'GEL', ...over,
});

describe('summarizeLot', () => {
  it('sums a lot’s entries by category and total', () => {
    const entries = [
      E({ lotId: 'L1', category: 'grape', amount: 1000 }),
      E({ lotId: 'L1', category: 'additive', amount: 120.5 }),
      E({ lotId: 'L1', category: 'additive', amount: 30.25 }),
      E({ lotId: 'L2', category: 'grape', amount: 999 }), // other lot, ignored
    ];
    const s = summarizeLot('L1', entries);
    expect(s.byCategory.grape).toBe(1000);
    expect(s.byCategory.additive).toBe(150.75);
    expect(s.total).toBe(1150.75);
  });

  it('handles negative blend_out amounts', () => {
    const s = summarizeLot('L1', [
      E({ category: 'grape', amount: 500 }),
      E({ category: 'blend_out', amount: -200 }),
    ]);
    expect(s.total).toBe(300);
  });
});

describe('derived metrics', () => {
  it('perUnit returns cost/litre and null on zero denominator', () => {
    expect(perUnit(1000, 500)).toBe(2);
    expect(perUnit(1000, 0)).toBeNull();
    expect(perUnit(1000, undefined)).toBeNull();
  });

  it('marginPct = (price − cost) / price', () => {
    expect(marginPct(10, 4)).toBe(60);
    expect(marginPct(0, 4)).toBeNull();
  });

  it('valuation = bottles × unit cost', () => {
    expect(valuation(1200, 3.25)).toBe(3900);
    expect(valuation(0, 3.25)).toBe(0);
  });
});

describe('rollupLots', () => {
  it('derives per-litre and per-bottle per lot', () => {
    const entries = [
      E({ lotId: 'L1', category: 'grape', amount: 2000 }),
      E({ lotId: 'L1', category: 'packaging', amount: 1000 }),
    ];
    const map = rollupLots(
      [{ id: 'L1', volumeLitres: 1500, bottles: 2000 }],
      entries,
    );
    const s = map.get('L1')!;
    expect(s.total).toBe(3000);
    expect(s.perLitre).toBe(2);     // 3000 / 1500
    expect(s.perBottle).toBe(1.5);  // 3000 / 2000
  });

  it('bottlesByLot overrides the lot’s own bottle count', () => {
    const map = rollupLots(
      [{ id: 'L1', volumeLitres: 1000, bottles: 999 }],
      [E({ lotId: 'L1', category: 'grape', amount: 900 })],
      { L1: 1200 },
    );
    expect(map.get('L1')!.perBottle).toBe(0.75); // 900 / 1200
  });
});

describe('computeBlendTransfers (weighted-average cost)', () => {
  it('moves cost from sources to the destination proportional to volume', () => {
    // L1: 1000 L cost 3000 (3/L), move 400 L -> contributes 1200
    // L2: 500 L cost 1000 (2/L), move 500 L -> contributes 1000
    const entries = computeBlendTransfers({
      destLotId: 'BLEND',
      date: '2026-11-01',
      currency: 'GEL',
      components: [
        { lotId: 'L1', volumeMoved: 400, lotTotalCost: 3000, lotVolume: 1000 },
        { lotId: 'L2', volumeMoved: 500, lotTotalCost: 1000, lotVolume: 500 },
      ],
    });
    const outL1 = entries.find(e => e.lotId === 'L1')!;
    const outL2 = entries.find(e => e.lotId === 'L2')!;
    const inBlend = entries.find(e => e.lotId === 'BLEND')!;
    expect(outL1.amount).toBe(-1200);
    expect(outL2.amount).toBe(-1000);
    expect(inBlend.amount).toBe(2200);
    expect(inBlend.category).toBe('blend_in');
  });

  it('conserves cost: out + in nets to zero', () => {
    const entries = computeBlendTransfers({
      destLotId: 'B', date: '2026-11-01', currency: 'EUR',
      components: [
        { lotId: 'A1', volumeMoved: 250, lotTotalCost: 800, lotVolume: 1000 },
        { lotId: 'A2', volumeMoved: 100, lotTotalCost: 333.33, lotVolume: 200 },
      ],
    });
    expect(totalLedger(entries)).toBe(0);
  });

  it('ignores a self-component and clamps over-moves to available volume', () => {
    const entries = computeBlendTransfers({
      destLotId: 'B', date: '2026-11-01', currency: 'GEL',
      components: [
        { lotId: 'B', volumeMoved: 100, lotTotalCost: 500, lotVolume: 1000 }, // self → ignored
        { lotId: 'S', volumeMoved: 9999, lotTotalCost: 600, lotVolume: 300 }, // over-move → clamp to full 600
      ],
    });
    expect(entries.find(e => e.lotId === 'B' && e.category === 'blend_out')).toBeUndefined();
    expect(entries.find(e => e.lotId === 'S')!.amount).toBe(-600);
    expect(entries.find(e => e.category === 'blend_in')!.amount).toBe(600);
  });
});
