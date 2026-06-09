// Scientific Winery Calculators & Enology Formulas

/**
 * Calculates KMBS (Potassium Metabisulfite) addition in grams.
 * KMBS standardly yields ~57.6% active Free SO2.
 * Formula: Addition (g) = (Volume (L) * Target Increase (mg/L or ppm)) / 576
 */
export function calculateSO2Addition(volumeL: number, targetIncreasePpm: number): number {
  if (volumeL <= 0 || targetIncreasePpm <= 0) return 0;
  return Number(((volumeL * targetIncreasePpm) / 576).toFixed(2));
}

/**
 * Estimates Potential Alcohol percentage from sugar measurements.
 * Formula for Brix: Alcohol % = Brix * 0.59
 * Formula for Specific Gravity: Alcohol % = (SG - 1) * 131.25
 * Formula for Sugar (g/L): Alcohol % = (Sugar g/L) / 16.83
 */
export function estimatePotentialAlcohol(value: number, type: 'brix' | 'sg' | 'sugar'): number {
  if (value <= 0) return 0;
  if (type === 'brix') {
    return Number((value * 0.59).toFixed(2));
  } else if (type === 'sg') {
    return Number(((value - 1) * 131.25).toFixed(2));
  } else {
    return Number((value / 16.83).toFixed(2));
  }
}

/**
 * Blends up to three distinct lots and calculates the weighted average parameter.
 * e.g., Blending Alcohol %, pH, or Titratable Acidity.
 */
export interface BlendComponent {
  volume: number;
  parameterValue: number;
}

export function calculateBlendParameter(components: BlendComponent[]): number {
  const activeComponents = components.filter(c => c.volume > 0 && c.parameterValue > 0);
  if (activeComponents.length === 0) return 0;

  const totalVolume = activeComponents.reduce((sum, c) => sum + c.volume, 0);
  if (totalVolume === 0) return 0;

  const weightedSum = activeComponents.reduce((sum, c) => sum + (c.volume * c.parameterValue), 0);
  return Number((weightedSum / totalVolume).toFixed(2));
}

/**
 * Calculates Cylindrical Tank volume capacity or current fill level in Liters.
 * Formula: Volume (L) = Pi * R^2 * Height (m) * 1000
 */
export function calculateCylinderVolume(diameterM: number, liquidHeightM: number): number {
  if (diameterM <= 0 || liquidHeightM <= 0) return 0;
  const radius = diameterM / 2;
  const volumeM3 = Math.PI * Math.pow(radius, 2) * liquidHeightM;
  return Number((volumeM3 * 1000).toFixed(0)); // Round to nearest liter
}

/**
 * Calculates Tartaric Acid addition for total acidity adjustments.
 * Enology Formula: Tartaric Acid Required (g) = Volume (L) * Desired Increase (g/L)
 */
export function calculateTartaricAcidAddition(volumeL: number, acidityIncreaseGL: number): number {
  if (volumeL <= 0 || acidityIncreaseGL <= 0) return 0;
  return Number((volumeL * acidityIncreaseGL).toFixed(1));
}
