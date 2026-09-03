/**
 * Generic anomaly detection used by every module. Deliberately statistical and
 * deterministic: an LLM is never asked whether a number is unusual, only to
 * explain a deviation the code already measured.
 *
 * Median absolute deviation is the default because winery series are short and
 * frequently contain one genuine outlier (a stuck tank, a broken sensor); a
 * mean/σ test would let that single point hide the next one.
 */

export interface AnomalyResult {
  isAnomaly: boolean;
  /** Robust z-score. |score| ≥ 3.5 is the conventional MAD outlier threshold. */
  score: number;
  median: number;
  /** Median absolute deviation, scaled to be σ-comparable for normal data. */
  scaledMad: number;
  direction: 'above' | 'below' | 'none';
  sampleSize: number;
}

const MAD_SCALE = 1.4826;
const DEFAULT_THRESHOLD = 3.5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Tests `value` against a historical series. Needs at least 4 history points;
 * below that it reports "not an anomaly" rather than guessing, and callers are
 * expected to surface the thin history as missing information.
 */
export function detectAnomaly(
  value: number,
  history: number[],
  options: { threshold?: number } = {},
): AnomalyResult {
  const clean = history.filter((v) => Number.isFinite(v));
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  if (clean.length < 4 || !Number.isFinite(value)) {
    return { isAnomaly: false, score: 0, median: clean.length ? median(clean) : 0, scaledMad: 0, direction: 'none', sampleSize: clean.length };
  }
  const med = median(clean);
  const mad = median(clean.map((v) => Math.abs(v - med)));
  const scaledMad = mad * MAD_SCALE;
  if (scaledMad === 0) {
    // A perfectly flat history: any departure at all is the signal.
    const differs = value !== med;
    return {
      isAnomaly: differs,
      score: differs ? Number.POSITIVE_INFINITY : 0,
      median: med,
      scaledMad: 0,
      direction: differs ? (value > med ? 'above' : 'below') : 'none',
      sampleSize: clean.length,
    };
  }
  const score = (value - med) / scaledMad;
  return {
    isAnomaly: Math.abs(score) >= threshold,
    score,
    median: med,
    scaledMad,
    direction: score > 0 ? 'above' : 'below',
    sampleSize: clean.length,
  };
}

export interface TrendResult {
  /** Least-squares slope in units per step. */
  slope: number;
  /** True when every consecutive step moves the same way. */
  monotonic: boolean;
  direction: 'rising' | 'falling' | 'flat';
  first: number;
  last: number;
  sampleSize: number;
}

/** Direction and steepness of an ordered series (oldest → newest). */
export function detectTrend(series: number[]): TrendResult {
  const values = series.filter((v) => Number.isFinite(v));
  if (values.length < 2) {
    const only = values[0] ?? 0;
    return { slope: 0, monotonic: false, direction: 'flat', first: only, last: only, sampleSize: values.length };
  }
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - meanX) * (values[i] - meanY);
    denominator += (i - meanX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  let rising = true;
  let falling = true;
  for (let i = 1; i < n; i += 1) {
    if (values[i] <= values[i - 1]) rising = false;
    if (values[i] >= values[i - 1]) falling = false;
  }
  return {
    slope,
    monotonic: rising || falling,
    direction: slope > 0 ? 'rising' : slope < 0 ? 'falling' : 'flat',
    first: values[0],
    last: values[n - 1],
    sampleSize: n,
  };
}
