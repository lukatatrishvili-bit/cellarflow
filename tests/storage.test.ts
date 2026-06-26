import { describe, it, expect } from 'vitest';
import { computeStock, lotTotalStored, utilization, unstored, type StockMovement } from '../lib/storage';

const M = (over: Partial<StockMovement>): StockMovement => ({
  id: Math.random().toString(36).slice(2), date: '2026-06-15', lotId: 'L1',
  locationId: 'W1', direction: 'in', bottles: 0, ...over,
});

describe('computeStock', () => {
  it('nets in − out per location and lot', () => {
    const stock = computeStock([
      M({ locationId: 'W1', lotId: 'L1', direction: 'in', bottles: 1200 }),
      M({ locationId: 'W1', lotId: 'L1', direction: 'out', bottles: 200 }),
      M({ locationId: 'W1', lotId: 'L2', direction: 'in', bottles: 500 }),
      M({ locationId: 'C1', lotId: 'L1', direction: 'in', bottles: 300 }),
    ]);
    expect(stock.get('W1')!.byLot.L1).toBe(1000);
    expect(stock.get('W1')!.byLot.L2).toBe(500);
    expect(stock.get('W1')!.totalBottles).toBe(1500);
    expect(stock.get('C1')!.byLot.L1).toBe(300);
  });

  it('drops a lot whose balance nets to zero', () => {
    const stock = computeStock([
      M({ locationId: 'W1', lotId: 'L1', direction: 'in', bottles: 100 }),
      M({ locationId: 'W1', lotId: 'L1', direction: 'out', bottles: 100 }),
    ]);
    expect(stock.get('W1')!.byLot.L1).toBeUndefined();
    expect(stock.get('W1')!.totalBottles).toBe(0);
  });
});

describe('lotTotalStored', () => {
  it('sums a lot across all locations', () => {
    const movs = [
      M({ locationId: 'W1', lotId: 'L1', direction: 'in', bottles: 1000 }),
      M({ locationId: 'C1', lotId: 'L1', direction: 'in', bottles: 300 }),
      M({ locationId: 'W1', lotId: 'L1', direction: 'out', bottles: 250 }),
    ];
    expect(lotTotalStored(movs, 'L1')).toBe(1050);
  });
});

describe('utilization', () => {
  it('computes pct and over-capacity flag', () => {
    const u = utilization({ locationId: 'W1', totalBottles: 1100, byLot: {} }, { id: 'W1', name: '', type: 'warehouse', capacityBottles: 1000 });
    expect(u.pct).toBe(110);
    expect(u.over).toBe(true);
  });
  it('returns null pct when no capacity is set', () => {
    const u = utilization({ locationId: 'W1', totalBottles: 50, byLot: {} }, { id: 'W1', name: '', type: 'cellar' });
    expect(u.pct).toBeNull();
    expect(u.over).toBe(false);
  });
});

describe('unstored', () => {
  it('reports bottles produced but not yet placed in storage', () => {
    const res = unstored(
      { L1: 1300, L2: 500 },
      [M({ lotId: 'L1', direction: 'in', bottles: 1000 })],
    );
    expect(res.L1).toBe(300); // 1300 produced − 1000 stored
    expect(res.L2).toBe(500); // none stored yet
  });
});
