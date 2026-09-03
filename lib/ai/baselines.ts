import { isPhysicalFermentationReading } from '../fermentationIntegrity';
import type { DailyFermLog } from '../wineryState';
import { daysBetween, isLiveRecord, type WineryIntelligenceSnapshot } from './snapshot';

/**
 * Winery-specific memory. Everything here is derived from the winery's own
 * history — never from global assumptions — so a finding can say "18% slower
 * than your last three Saperavi fermentations" instead of "fermentation is slow".
 *
 * All statistics are medians, not means: a single stuck or runaway campaign
 * must not move the baseline the next campaign is judged against.
 */

export interface FermentationRateBaseline {
  /** Grape variety, or `*` for the winery-wide fallback. */
  variety: string;
  /** Median specific-gravity drop per day across comparable historical lots. */
  medianDropPerDay: number;
  /** Number of historical lots behind the median. Below 3, confidence is low. */
  sampleSize: number;
  lotIds: string[];
  medianPeakTempC: number | null;
  /** Median days from first reading to the campaign finishing below 1.000. */
  medianDurationDays: number | null;
}

export interface InventoryConsumptionBaseline {
  itemId: string;
  /** Stock units consumed per day over the observation window. */
  dailyUsage: number;
  windowDays: number;
  /** How many separate consumption events fed the estimate. */
  observations: number;
}

export interface HarvestTimingBaseline {
  variety: string;
  /** Median day-of-year the winery historically received this variety. */
  medianDayOfYear: number;
  sampleSize: number;
}

export interface WineryBaselines {
  /** Days of history considered for consumption/loss statistics. */
  windowDays: number;
  fermentationByVariety: Record<string, FermentationRateBaseline>;
  fermentationOverall: FermentationRateBaseline | null;
  inventoryConsumption: Record<string, InventoryConsumptionBaseline>;
  /** Median transfer loss as a share of moved volume, or null when unknown. */
  medianTransferLossPct: number | null;
  /** Median free SO₂ the winery actually maintains, by winemaking stage. */
  freeSo2MedianByStage: Record<string, number>;
  harvestTimingByVariety: Record<string, HarvestTimingBaseline>;
  /** Median gap between consecutive lab analyses on the same lot. */
  medianLabIntervalDays: number | null;
}

const DEFAULT_WINDOW_DAYS = 180;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function normalizeVariety(value: string | undefined): string {
  return (value || '').trim().toLowerCase() || 'unknown';
}

function dayOfYear(iso: string): number | null {
  const time = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.round((time - start) / 86_400_000) + 1;
}

/** Mean SG drop per day across a single lot's active phase, or null if unusable. */
function lotDropPerDay(logs: DailyFermLog[]): { rate: number; durationDays: number } | null {
  const readings = logs
    .filter((log) => isPhysicalFermentationReading(log) && Number.isFinite(log.density) && log.density > 0)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (readings.length < 2) return null;

  const first = readings[0];
  const last = readings[readings.length - 1];
  const span = daysBetween(first.date, last.date);
  const drop = first.density - last.density;
  // A campaign that never dropped, or spans a single day, tells us nothing
  // about pace — including it would drag the winery baseline toward zero.
  if (span < 1 || drop <= 0) return null;
  return { rate: drop / span, durationDays: span };
}

function buildFermentationBaseline(
  variety: string,
  entries: Array<{ lotId: string; rate: number; durationDays: number; peakTemp: number | null }>,
): FermentationRateBaseline | null {
  if (entries.length === 0) return null;
  const rate = median(entries.map((e) => e.rate));
  if (rate === null) return null;
  const peaks = entries.map((e) => e.peakTemp).filter((v): v is number => v !== null);
  return {
    variety,
    medianDropPerDay: rate,
    sampleSize: entries.length,
    lotIds: entries.map((e) => e.lotId),
    medianPeakTempC: median(peaks),
    medianDurationDays: median(entries.map((e) => e.durationDays)),
  };
}

export function computeWineryBaselines(
  snapshot: WineryIntelligenceSnapshot,
  options: { windowDays?: number } = {},
): WineryBaselines {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;

  // --- Fermentation pace, per variety, from finished campaigns only ---------
  const logsByLot = new Map<string, DailyFermLog[]>();
  for (const log of snapshot.fermLogs) {
    const bucket = logsByLot.get(log.lotId);
    if (bucket) bucket.push(log);
    else logsByLot.set(log.lotId, [log]);
  }

  const entriesByVariety = new Map<string, Array<{ lotId: string; rate: number; durationDays: number; peakTemp: number | null }>>();
  const allEntries: Array<{ lotId: string; rate: number; durationDays: number; peakTemp: number | null }> = [];

  for (const lot of snapshot.lots) {
    // Only completed history teaches pace; an in-flight campaign is the thing
    // being judged, so including it would let a stuck lot excuse itself.
    if (lot.stage === 'fermenting' || lot.stage === 'crushing') continue;
    if (lot.voidedAt) continue;
    const logs = logsByLot.get(lot.id) || [];
    const summary = lotDropPerDay(logs);
    if (!summary) continue;
    const temps = logs
      .filter(isPhysicalFermentationReading)
      .map((log) => log.temperature)
      .filter((value) => Number.isFinite(value));
    const entry = {
      lotId: lot.id,
      rate: summary.rate,
      durationDays: summary.durationDays,
      peakTemp: temps.length > 0 ? Math.max(...temps) : null,
    };
    allEntries.push(entry);
    const key = normalizeVariety(lot.variety);
    const bucket = entriesByVariety.get(key);
    if (bucket) bucket.push(entry);
    else entriesByVariety.set(key, [entry]);
  }

  const fermentationByVariety: Record<string, FermentationRateBaseline> = {};
  for (const [variety, entries] of entriesByVariety) {
    const baseline = buildFermentationBaseline(variety, entries);
    if (baseline) fermentationByVariety[variety] = baseline;
  }

  // --- Inventory consumption, from cellar operations and bottling runs ------
  const windowStart = new Date(Date.parse(`${snapshot.today}T00:00:00Z`) - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const usage = new Map<string, { total: number; observations: number }>();
  const addUsage = (itemId: string, quantity: number) => {
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) return;
    const current = usage.get(itemId) || { total: 0, observations: 0 };
    current.total += quantity;
    current.observations += 1;
    usage.set(itemId, current);
  };

  for (const op of snapshot.cellarOps) {
    if (!isLiveRecord(op)) continue;
    const date = (op.date || '').slice(0, 10);
    if (date < windowStart || date > snapshot.today) continue;
    if (Array.isArray(op.materials) && op.materials.length > 0) {
      for (const material of op.materials) addUsage(material.materialId, material.quantity);
    } else if (op.materialId && typeof op.dose === 'number') {
      addUsage(op.materialId, op.dose);
    }
  }
  for (const run of snapshot.bottlingRuns) {
    if (!isLiveRecord(run)) continue;
    const date = (run.date || '').slice(0, 10);
    if (date < windowStart || date > snapshot.today) continue;
    for (const [itemId, quantity] of Object.entries(run.packagingDeductions || {})) {
      addUsage(itemId, Number(quantity));
    }
  }

  const inventoryConsumption: Record<string, InventoryConsumptionBaseline> = {};
  for (const [itemId, totals] of usage) {
    inventoryConsumption[itemId] = {
      itemId,
      dailyUsage: totals.total / windowDays,
      windowDays,
      observations: totals.observations,
    };
  }

  // --- Typical process loss on transfers ------------------------------------
  const lossPcts: number[] = [];
  for (const transfer of snapshot.transfers) {
    if (!isLiveRecord(transfer)) continue;
    const moved = Number(transfer.volume);
    const loss = Number(transfer.loss);
    if (!Number.isFinite(moved) || moved <= 0 || !Number.isFinite(loss) || loss < 0) continue;
    lossPcts.push((loss / moved) * 100);
  }

  // --- SO₂ practice the winery actually keeps, by stage ---------------------
  const so2ByStage = new Map<string, number[]>();
  const stageByLot = new Map(snapshot.lots.map((lot) => [lot.id, lot.stage]));
  for (const lab of snapshot.labLogs) {
    const stage = stageByLot.get(lab.lotId);
    if (!stage || !Number.isFinite(lab.freeSo2)) continue;
    const bucket = so2ByStage.get(stage);
    if (bucket) bucket.push(lab.freeSo2);
    else so2ByStage.set(stage, [lab.freeSo2]);
  }
  const freeSo2MedianByStage: Record<string, number> = {};
  for (const [stage, values] of so2ByStage) {
    const value = median(values);
    if (value !== null) freeSo2MedianByStage[stage] = value;
  }

  // --- Historical harvest timing, per variety -------------------------------
  const harvestDays = new Map<string, number[]>();
  for (const intake of snapshot.grapeIntakes) {
    if (!isLiveRecord(intake)) continue;
    const doy = dayOfYear(intake.date || '');
    if (doy === null) continue;
    const key = normalizeVariety(intake.variety);
    const bucket = harvestDays.get(key);
    if (bucket) bucket.push(doy);
    else harvestDays.set(key, [doy]);
  }
  const harvestTimingByVariety: Record<string, HarvestTimingBaseline> = {};
  for (const [variety, values] of harvestDays) {
    const value = median(values);
    if (value !== null) {
      harvestTimingByVariety[variety] = { variety, medianDayOfYear: value, sampleSize: values.length };
    }
  }

  // --- Lab cadence ----------------------------------------------------------
  const labsByLot = new Map<string, string[]>();
  for (const lab of snapshot.labLogs) {
    const bucket = labsByLot.get(lab.lotId);
    if (bucket) bucket.push(lab.date);
    else labsByLot.set(lab.lotId, [lab.date]);
  }
  const intervals: number[] = [];
  for (const dates of labsByLot.values()) {
    const sorted = [...dates].sort();
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = daysBetween(sorted[i - 1], sorted[i]);
      if (gap > 0) intervals.push(gap);
    }
  }

  return {
    windowDays,
    fermentationByVariety,
    fermentationOverall: buildFermentationBaseline('*', allEntries),
    inventoryConsumption,
    medianTransferLossPct: median(lossPcts),
    freeSo2MedianByStage,
    harvestTimingByVariety,
    medianLabIntervalDays: median(intervals),
  };
}

/**
 * Best available pace reference for a variety: the variety's own history when
 * the winery has enough of it, otherwise the winery-wide median. Returns null
 * when the winery has no comparable history at all — in which case rules must
 * say so rather than inventing a comparison.
 */
export function fermentationBaselineFor(
  baselines: WineryBaselines,
  variety: string | undefined,
): FermentationRateBaseline | null {
  const key = normalizeVariety(variety);
  const varietyBaseline = baselines.fermentationByVariety[key];
  if (varietyBaseline && varietyBaseline.sampleSize >= 2) return varietyBaseline;
  if (baselines.fermentationOverall && baselines.fermentationOverall.sampleSize >= 2) {
    return baselines.fermentationOverall;
  }
  return varietyBaseline ?? baselines.fermentationOverall;
}

/** Signed percentage difference of `observed` against `baseline` (negative = slower). */
export function deviationPct(observed: number, baseline: number): number | null {
  if (!Number.isFinite(observed) || !Number.isFinite(baseline) || baseline === 0) return null;
  return ((observed - baseline) / Math.abs(baseline)) * 100;
}

/** Days of stock cover at the winery's own observed consumption rate. */
export function stockCoverDays(
  baselines: WineryBaselines,
  itemId: string,
  stock: number,
): number | null {
  const consumption = baselines.inventoryConsumption[itemId];
  if (!consumption || consumption.dailyUsage <= 0) return null;
  return stock / consumption.dailyUsage;
}
