export type AcidTreatmentType =
  | 'tartaric'
  | 'malic'
  | 'lactic'
  | 'citric'
  | 'carbonate_deacid'
  | 'bicarbonate_deacid';

export type ProductForm = 'powder' | 'liquid';

const ACIDIFICATION_CAPACITY: Record<Extract<AcidTreatmentType, 'tartaric' | 'malic' | 'lactic' | 'citric'>, number> = {
  tartaric: 1,
  malic: 0.9,
  lactic: 0.83,
  citric: 0.8,
};

export interface AcidTreatmentInput {
  volumeL: number;
  currentTaGL: number;
  targetTaGL: number;
  treatment: AcidTreatmentType;
  purityPct: number;
  productForm: ProductForm;
  densityGPerMl?: number;
}

export interface AcidTreatmentResult {
  activeIngredientGrams: number;
  productGrams: number;
  productGramsPerHl: number;
  productMillilitres?: number;
  taDeltaGL: number;
  purityPct: number;
  exceedsOivFourGramLimit: boolean;
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function calculateAcidTreatment(input: AcidTreatmentInput): AcidTreatmentResult {
  const volumeL = Math.max(0, Number.isFinite(input.volumeL) ? input.volumeL : 0);
  const taDeltaGL = (Number.isFinite(input.targetTaGL) ? input.targetTaGL : 0)
    - (Number.isFinite(input.currentTaGL) ? input.currentTaGL : 0);
  const purityPct = Math.min(100, Math.max(1, positiveFinite(input.purityPct, 100)));
  const isDeacidification = input.treatment === 'carbonate_deacid'
    || input.treatment === 'bicarbonate_deacid';

  let activeIngredientGrams = 0;
  if (isDeacidification && taDeltaGL < 0) {
    activeIngredientGrams = Math.abs(taDeltaGL) * 0.67 * volumeL;
  } else if (!isDeacidification && taDeltaGL > 0) {
    const capacity = ACIDIFICATION_CAPACITY[
      input.treatment as keyof typeof ACIDIFICATION_CAPACITY
    ];
    activeIngredientGrams = (taDeltaGL / capacity) * volumeL;
  }

  const productGrams = activeIngredientGrams / (purityPct / 100);
  const productGramsPerHl = volumeL > 0 ? productGrams / (volumeL / 100) : 0;
  const densityGPerMl = positiveFinite(input.densityGPerMl || 0, 1);

  return {
    activeIngredientGrams,
    productGrams,
    productGramsPerHl,
    ...(input.productForm === 'liquid' ? { productMillilitres: productGrams / densityGPerMl } : {}),
    taDeltaGL,
    purityPct,
    exceedsOivFourGramLimit: taDeltaGL > 4,
  };
}

export interface NutrientDoseInput {
  volumeL: number;
  currentYanMgL: number;
  targetYanMgL: number;
  availableNitrogenPct: number;
}

export function calculateNutrientDose(input: NutrientDoseInput): {
  yanGapMgL: number;
  nutrientGrams: number;
  nutrientGramsPerHl: number;
} {
  const volumeL = Math.max(0, Number.isFinite(input.volumeL) ? input.volumeL : 0);
  const yanGapMgL = Math.max(0, input.targetYanMgL - input.currentYanMgL);
  const availableNitrogenPct = Math.min(100, Math.max(0.1, positiveFinite(input.availableNitrogenPct, 1)));
  const nutrientGrams = (yanGapMgL * volumeL) / (1000 * (availableNitrogenPct / 100));
  return {
    yanGapMgL,
    nutrientGrams,
    nutrientGramsPerHl: volumeL > 0 ? nutrientGrams / (volumeL / 100) : 0,
  };
}

export function scaleCellarDose(input: {
  volumeL: number;
  doseGramsPerHl: number;
  stockSolutionGramsPerL?: number;
}): {
  productGrams: number;
  stockSolutionMillilitres?: number;
} {
  const volumeL = Math.max(0, Number.isFinite(input.volumeL) ? input.volumeL : 0);
  const doseGramsPerHl = Math.max(0, Number.isFinite(input.doseGramsPerHl) ? input.doseGramsPerHl : 0);
  const productGrams = doseGramsPerHl * (volumeL / 100);
  const concentration = input.stockSolutionGramsPerL || 0;
  return {
    productGrams,
    ...(concentration > 0 ? { stockSolutionMillilitres: (productGrams / concentration) * 1000 } : {}),
  };
}
