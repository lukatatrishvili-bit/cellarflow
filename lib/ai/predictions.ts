import { isPhysicalFermentationReading } from '../fermentationIntegrity';
import type { DailyFermLog, GrapeSamplingRecord } from '../wineryState';
import { addDays, daysBetween } from './snapshot';
import type { FermentationRateBaseline, WineryBaselines } from './baselines';

/**
 * Deterministic forecasting. Every prediction here is arithmetic over the
 * winery's own measurements — the model is only ever asked to explain a
 * prediction, never to produce one. Each result carries the method used and
 * an explicit confidence so the UI can label it honestly.
 */

export type PredictionMethod = 'recent_rate' | 'winery_baseline' | 'insufficient_data';

export interface FermentationForecast {
  method: PredictionMethod;
  /** Estimated date the campaign reaches dryness (SG ≤ 0.996), or null. */
  estimatedDryDate: string | null;
  daysRemaining: number | null;
  /** Observed SG drop per day over the most recent readings. */
  observedRatePerDay: number | null;
  baselineRatePerDay: number | null;
  /** Signed % of baseline pace; −18 means 18% slower than the winery's norm. */
  paceDeviationPct: number | null;
  /** 0–1 heuristic risk that the campaign sticks before reaching dryness. */
  stuckRisk: number;
  confidence: 'low' | 'medium' | 'high';
  /** Named gaps that limit the forecast, as machine keys for bilingual rendering. */
  limitations: Array<'no_readings' | 'single_reading' | 'no_baseline' | 'flat_series' | 'short_history'>;
}

const DRY_DENSITY = 0.996;

/** Newest-first physical readings with a usable density. */
export function usableFermentationReadings(logs: readonly DailyFermLog[]): DailyFermLog[] {
  return logs
    .filter((log) => isPhysicalFermentationReading(log) && Number.isFinite(log.density) && log.density > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/**
 * Projects the current campaign forward at its own recent pace, falling back to
 * the winery's historical pace for the variety when the current series is too
 * short to extrapolate from.
 */
export function forecastFermentation(
  // Readonly: callers pass a shared per-evaluation index, so this must copy
  // before sorting rather than reorder someone else's array.
  logs: readonly DailyFermLog[],
  baseline: FermentationRateBaseline | null,
  today: string,
): FermentationForecast {
  const readings = usableFermentationReadings(logs);
  const limitations: FermentationForecast['limitations'] = [];
  const baselineRate = baseline && baseline.medianDropPerDay > 0 ? baseline.medianDropPerDay : null;
  if (!baselineRate) limitations.push('no_baseline');
  else if (baseline && baseline.sampleSize < 3) limitations.push('short_history');

  if (readings.length === 0) {
    limitations.push('no_readings');
    return {
      method: 'insufficient_data',
      estimatedDryDate: null,
      daysRemaining: null,
      observedRatePerDay: null,
      baselineRatePerDay: baselineRate,
      paceDeviationPct: null,
      stuckRisk: 0,
      confidence: 'low',
      limitations,
    };
  }

  const latest = readings[0];
  const remainingDensity = latest.density - DRY_DENSITY;

  // Use up to the last four readings so a single noisy hydrometer reading does
  // not dominate the projected pace.
  const window = readings.slice(0, 4);
  const oldest = window[window.length - 1];
  const span = daysBetween(oldest.date, latest.date);
  const drop = oldest.density - latest.density;
  let observedRate: number | null = null;
  if (readings.length < 2) limitations.push('single_reading');
  else if (span < 1) limitations.push('flat_series');
  else observedRate = drop / span;

  const paceDeviationPct = observedRate !== null && baselineRate
    ? ((observedRate - baselineRate) / baselineRate) * 100
    : null;

  // Already dry: nothing to forecast.
  if (remainingDensity <= 0) {
    return {
      method: observedRate !== null ? 'recent_rate' : 'insufficient_data',
      estimatedDryDate: latest.date.slice(0, 10),
      daysRemaining: 0,
      observedRatePerDay: observedRate,
      baselineRatePerDay: baselineRate,
      paceDeviationPct,
      stuckRisk: 0,
      confidence: 'high',
      limitations,
    };
  }

  const rate = observedRate !== null && observedRate > 0
    ? observedRate
    : (baselineRate ?? null);
  const method: PredictionMethod = observedRate !== null && observedRate > 0
    ? 'recent_rate'
    : rate !== null
      ? 'winery_baseline'
      : 'insufficient_data';

  const daysRemaining = rate && rate > 0 ? Math.ceil(remainingDensity / rate) : null;

  // Stuck risk rises when the recent pace has collapsed relative to the winery's
  // own norm, and when the must is cold or the campaign is already long.
  let stuckRisk = 0;
  if (observedRate !== null && baselineRate) {
    const ratio = observedRate / baselineRate;
    if (ratio <= 0) stuckRisk = 0.9;
    else if (ratio < 0.25) stuckRisk = 0.75;
    else if (ratio < 0.5) stuckRisk = 0.5;
    else if (ratio < 0.75) stuckRisk = 0.25;
  } else if (observedRate !== null && observedRate <= 0) {
    stuckRisk = 0.6;
  }
  if (latest.density > 1.01 && Number.isFinite(latest.temperature) && latest.temperature < 14) {
    stuckRisk = Math.min(1, stuckRisk + 0.15);
  }
  const campaignDays = readings.length > 1
    ? daysBetween(readings[readings.length - 1].date, today)
    : 0;
  if (campaignDays > 21 && latest.density > 1.005) {
    stuckRisk = Math.min(1, stuckRisk + 0.1);
  }

  const confidence: FermentationForecast['confidence'] =
    method === 'recent_rate' && readings.length >= 3 && baselineRate ? 'high'
      : method === 'insufficient_data' ? 'low'
        : 'medium';

  return {
    method,
    estimatedDryDate: daysRemaining !== null ? addDays(today, daysRemaining) : null,
    daysRemaining,
    observedRatePerDay: observedRate,
    baselineRatePerDay: baselineRate,
    paceDeviationPct,
    stuckRisk,
    confidence,
    limitations,
  };
}

export interface DepletionForecast {
  /** Days of cover at the winery's observed consumption rate. */
  coverDays: number | null;
  depletionDate: string | null;
  dailyUsage: number | null;
  observations: number;
}

/** Projects when an inventory item runs out, using this winery's own usage. */
export function forecastInventoryDepletion(
  baselines: WineryBaselines,
  itemId: string,
  stock: number,
  today: string,
): DepletionForecast {
  const consumption = baselines.inventoryConsumption[itemId];
  if (!consumption || consumption.dailyUsage <= 0) {
    return { coverDays: null, depletionDate: null, dailyUsage: null, observations: consumption?.observations ?? 0 };
  }
  const coverDays = stock / consumption.dailyUsage;
  return {
    coverDays,
    depletionDate: addDays(today, Math.floor(Math.max(0, coverDays))),
    dailyUsage: consumption.dailyUsage,
    observations: consumption.observations,
  };
}

export interface HarvestForecast {
  estimatedDate: string | null;
  method: 'sugar_accumulation' | 'block_estimate' | 'winery_history' | 'insufficient_data';
  latestBrix: number | null;
  /** Observed °Brix gained per day across recent samplings. */
  brixPerDay: number | null;
  daysToTarget: number | null;
}

/**
 * Estimates the harvest date for a block from its own sugar accumulation curve,
 * then falls back to the agronomist's stored estimate, then to the winery's
 * historical timing for the variety.
 */
export function forecastHarvestDate(
  samplings: readonly GrapeSamplingRecord[],
  options: {
    today: string;
    targetBrix: number;
    blockEstimate?: string;
    varietyMedianDayOfYear?: number;
    year?: number;
  },
): HarvestForecast {
  const ordered = [...samplings]
    .filter((s) => Number.isFinite(s.brix))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  if (ordered.length >= 2) {
    const latest = ordered[ordered.length - 1];
    const earliest = ordered[Math.max(0, ordered.length - 4)];
    const span = daysBetween(earliest.date, latest.date);
    const gain = latest.brix - earliest.brix;
    if (span >= 3 && gain > 0) {
      const brixPerDay = gain / span;
      const remaining = options.targetBrix - latest.brix;
      const daysToTarget = Math.max(0, Math.ceil(remaining / brixPerDay));
      return {
        estimatedDate: addDays(options.today, daysToTarget),
        method: 'sugar_accumulation',
        latestBrix: latest.brix,
        brixPerDay,
        daysToTarget,
      };
    }
    return {
      estimatedDate: options.blockEstimate || null,
      method: options.blockEstimate ? 'block_estimate' : 'insufficient_data',
      latestBrix: latest.brix,
      brixPerDay: null,
      daysToTarget: options.blockEstimate ? daysBetween(options.today, options.blockEstimate) : null,
    };
  }

  if (options.blockEstimate) {
    return {
      estimatedDate: options.blockEstimate,
      method: 'block_estimate',
      latestBrix: ordered[0]?.brix ?? null,
      brixPerDay: null,
      daysToTarget: daysBetween(options.today, options.blockEstimate),
    };
  }

  if (options.varietyMedianDayOfYear) {
    const year = options.year ?? Number(options.today.slice(0, 4));
    const estimate = addDays(`${year}-01-01`, Math.round(options.varietyMedianDayOfYear) - 1);
    return {
      estimatedDate: estimate,
      method: 'winery_history',
      latestBrix: ordered[0]?.brix ?? null,
      brixPerDay: null,
      daysToTarget: daysBetween(options.today, estimate),
    };
  }

  return { estimatedDate: null, method: 'insufficient_data', latestBrix: ordered[0]?.brix ?? null, brixPerDay: null, daysToTarget: null };
}
