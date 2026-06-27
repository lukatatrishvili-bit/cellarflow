import { describe, it, expect } from 'vitest';
import { deductStock, CELLAR_OPERATIONS } from '../lib/wineryState';

describe('cellar operations — inventory deduction', () => {
  it('subtracts the used amount from stock', () => {
    expect(deductStock(30, 5)).toBe(25);
    expect(deductStock(4.5, 1.25)).toBe(3.25);
  });

  it('clamps at zero when the dose exceeds stock', () => {
    expect(deductStock(2, 5)).toBe(0);
    expect(deductStock(0, 1)).toBe(0);
  });

  it('rounds to 3 decimal places to avoid float drift', () => {
    expect(deductStock(1, 0.1 + 0.2)).toBe(0.7);
  });
});

describe('cellar operations — metadata', () => {
  it('covers all the operation types from the spec with unique keys', () => {
    const keys = CELLAR_OPERATIONS.map(o => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ['sulfitation', 'racking', 'pressing', 'fining', 'bottling', 'custom']) {
      expect(keys).toContain(k as any);
    }
  });

  it('flags material-consuming and volume-affecting ops correctly', () => {
    const so2 = CELLAR_OPERATIONS.find(o => o.key === 'sulfitation')!;
    const racking = CELLAR_OPERATIONS.find(o => o.key === 'racking')!;
    const measure = CELLAR_OPERATIONS.find(o => o.key === 'measurement')!;
    expect(so2.needsMaterial).toBe(true);
    expect(racking.affectsVolume).toBe(true);
    expect(racking.needsVesselTo).toBe(true);
    expect(measure.needsMaterial).toBeFalsy();
    expect(measure.affectsVolume).toBeFalsy();
  });
});
