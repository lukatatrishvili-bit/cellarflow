import { describe, expect, it } from 'vitest';
import {
  calculateAcidTreatment,
  calculateNutrientDose,
  scaleCellarDose,
} from '../lib/enologyCalculations';

describe('enology calculations', () => {
  it('adjusts lactic-acid product dose for concentration and liquid density', () => {
    const result = calculateAcidTreatment({
      volumeL: 1_000,
      currentTaGL: 5,
      targetTaGL: 6,
      treatment: 'lactic',
      purityPct: 80,
      productForm: 'liquid',
      densityGPerMl: 1.2,
    });

    expect(result.activeIngredientGrams).toBeCloseTo(1_204.82, 1);
    expect(result.productGrams).toBeCloseTo(1_506.02, 1);
    expect(result.productMillilitres).toBeCloseTo(1_255.02, 1);
    expect(result.productGramsPerHl).toBeCloseTo(150.6, 1);
  });

  it('flags an acidification target above the OIV four-gram tartaric-equivalent limit', () => {
    expect(calculateAcidTreatment({
      volumeL: 100,
      currentTaGL: 3,
      targetTaGL: 7.1,
      treatment: 'tartaric',
      purityPct: 100,
      productForm: 'powder',
    }).exceedsOivFourGramLimit).toBe(true);
  });

  it('calculates nutrient mass from the YAN gap and available nitrogen fraction', () => {
    expect(calculateNutrientDose({
      volumeL: 1_000,
      currentYanMgL: 100,
      targetYanMgL: 180,
      availableNitrogenPct: 20,
    })).toEqual({
      yanGapMgL: 80,
      nutrientGrams: 400,
      nutrientGramsPerHl: 40,
    });
  });

  it('scales a bench dose to cellar volume and a stock solution', () => {
    expect(scaleCellarDose({
      volumeL: 2_500,
      doseGramsPerHl: 12,
      stockSolutionGramsPerL: 100,
    })).toEqual({
      productGrams: 300,
      stockSolutionMillilitres: 3_000,
    });
  });
});
