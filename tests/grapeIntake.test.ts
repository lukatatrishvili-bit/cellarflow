import { describe, it, expect } from 'vitest';
import { estimateMustVolumeL, brixToPotentialAlcohol } from '../lib/wineryOperations';

describe('grape intake — must volume estimate', () => {
  it('applies the juice yield % to net weight (≈1 kg → 1 L of fruit)', () => {
    expect(estimateMustVolumeL(1000, 70)).toBe(700);
    expect(estimateMustVolumeL(12000, 65)).toBe(7800);
  });

  it('guards against zero / negative inputs', () => {
    expect(estimateMustVolumeL(0, 70)).toBe(0);
    expect(estimateMustVolumeL(-500, 70)).toBe(0);
    expect(estimateMustVolumeL(1000, 0)).toBe(0);
  });

  it('rounds to whole litres', () => {
    expect(estimateMustVolumeL(1234, 67)).toBe(Math.round(1234 * 0.67));
  });
});

describe('grape intake — potential alcohol', () => {
  it('estimates potential ABV from °Brix', () => {
    expect(brixToPotentialAlcohol(22)).toBeCloseTo(13.0, 1);
    expect(brixToPotentialAlcohol(24)).toBeCloseTo(14.2, 1);
  });

  it('returns 0 for non-positive Brix', () => {
    expect(brixToPotentialAlcohol(0)).toBe(0);
    expect(brixToPotentialAlcohol(-1)).toBe(0);
  });
});
