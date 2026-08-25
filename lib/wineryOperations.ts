import type { CellarOperationMeta } from './wineryState';

/** Estimated must/juice volume (L) from net grape weight and a yield %. ~1 kg ≈ 1 L of fruit. */
export function estimateMustVolumeL(netWeightKg: number, juiceYieldPct: number): number {
  if (!(netWeightKg > 0) || !(juiceYieldPct > 0)) return 0;
  return Math.round(netWeightKg * (juiceYieldPct / 100));
}

/** Rough potential alcohol (% vol) from sugar at harvest (°Brix). */
export function brixToPotentialAlcohol(brix: number): number {
  if (!(brix > 0)) return 0;
  return Math.round(brix * 0.59 * 10) / 10;
}

/** Single source of truth for operation types, shared by the handler and the UI. */
export const CELLAR_OPERATIONS: CellarOperationMeta[] = [
  { key: 'crush_destem', en: 'Crush / destem', ka: 'დაჭყლეტა / დაგრეხა' },
  { key: 'pressing', en: 'Pressing', ka: 'დაწურვა', affectsVolume: true },
  { key: 'ferment_start', en: 'Fermentation start', ka: 'დუღილის დაწყება' },
  { key: 'measurement', en: 'Temp / Brix check', ka: 'ტემპ. / შაქრის გაზომვა' },
  { key: 'pumpover', en: 'Pump-over (remontage)', ka: 'რემონტაჟი' },
  { key: 'punchdown', en: 'Punch-down', ka: 'დარევა' },
  { key: 'racking', en: 'Transfer / racking', ka: 'გადატანა', affectsVolume: true, needsVesselTo: true },
  { key: 'blending', en: 'Blending', ka: 'კუპაჟი', affectsVolume: true, needsVesselTo: true },
  { key: 'sulfitation', en: 'Sulfitation (SO₂)', ka: 'სულფიტაცია', needsMaterial: true },
  { key: 'additive', en: 'Additive addition', ka: 'დანამატის დამატება', needsMaterial: true },
  { key: 'fining', en: 'Fining', ka: 'დაწმენდა', needsMaterial: true },
  { key: 'filtration', en: 'Filtration', ka: 'ფილტრაცია', affectsVolume: true },
  { key: 'stabilization', en: 'Stabilization', ka: 'სტაბილიზაცია', needsMaterial: true },
  { key: 'vessel_filling', en: 'Barrel / qvevri filling', ka: 'ჭურჭლის შევსება', needsVesselTo: true },
  { key: 'bottling', en: 'Bottling', ka: 'ჩამოსხმა', affectsVolume: true },
  { key: 'cleaning', en: 'Cleaning / sanitation', ka: 'წმენდა / სანიტარია' },
  { key: 'correction', en: 'Correction', ka: 'კორექცია' },
  { key: 'custom', en: 'Custom operation', ka: 'სხვა ოპერაცია' },
];

/**
 * Operations that are safe to capture as one-lot quick facts. Physical moves,
 * bottling and sanitation use dedicated workflows so balances and evidence
 * cannot diverge behind a generic log entry.
 */
export const DEDICATED_CELLAR_OPERATION_TYPES = new Set<CellarOperationMeta['key']>([
  'racking',
  'blending',
  'vessel_filling',
  'bottling',
  'cleaning',
]);

export const QUICK_CELLAR_OPERATIONS = CELLAR_OPERATIONS.filter(
  operation => !DEDICATED_CELLAR_OPERATION_TYPES.has(operation.key),
);

export function isQuickCellarOperation(type: CellarOperationMeta['key']): boolean {
  return !DEDICATED_CELLAR_OPERATION_TYPES.has(type);
}

/** Deduct an amount from a stock level, clamped at zero and rounded to 3 dp. */
export function deductStock(currentStock: number, amount: number): number {
  const next = (currentStock || 0) - (amount || 0);
  return Math.max(0, Math.round(next * 1000) / 1000);
}
