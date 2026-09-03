export const MAX_OPERATIONAL_TELEMETRY_SAMPLES = 500;
export const MAX_REPORTED_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface SyncOperationalMetric {
  at: string;
  payloadBytes: number;
  recordCount: number;
  tombstoneCount: number;
  durationMs: number;
  mergeMs: number;
  retryCount: number;
  conflict: boolean;
  statusCode: number;
  outcome: 'success' | 'conflict' | 'rejected';
}

/**
 * Per-record merge outcomes for one sync that was actually acted on.
 *
 * Answers two open design questions with measurement rather than intuition
 * (`docs/scale-out-and-delta-sync-design-2026-08-13.md`):
 *
 *   - `baselineUnavailable` vs `fieldMergeApplied` decides whether the
 *     process-memory baselines behind three-way merge are worth persisting.
 *     They are the one piece of state that makes a second server instance
 *     change user-visible behaviour, so this ratio gates the scale-out plan.
 *   - `unchanged` measures how much of each payload the client did not need to
 *     send, which is the size of the prize for per-record delta sync.
 *
 * Counts only — no ids, collections, field names, or tenant data.
 */
export interface SyncMergeOutcomeMetric {
  at: string;
  newRecord: number;
  unchanged: number;
  cleanFastForward: number;
  fieldMergeApplied: number;
  sameFieldConflict: number;
  baselineUnavailable: number;
  legacyLastWriteWins: number;
}

export interface CommandOperationalMetric {
  at: string;
  commandType: string;
  durationMs: number;
  queueAgeMs: number;
  statusCode: number;
  outcome: 'executed' | 'replayed' | 'failed';
}

export type ClientPerformanceMetricName = 'LCP' | 'INP' | 'CLS' | 'route_load' | 'offline_start';
export type ClientPerformanceRating = 'good' | 'needs_improvement' | 'poor';
export type ClientDeviceClass = 'mobile' | 'tablet' | 'desktop';
export type ClientNetworkClass = 'offline' | 'slow' | 'standard' | 'unknown';
export type ClientRouteClass = 'landing' | 'auth' | 'tasks' | 'billing' | 'public' | 'workspace';

export interface ClientPerformanceMetric {
  at: string;
  name: ClientPerformanceMetricName;
  value: number;
  rating: ClientPerformanceRating;
  deviceClass: ClientDeviceClass;
  networkClass: ClientNetworkClass;
  routeClass: ClientRouteClass;
}

const syncSamples: SyncOperationalMetric[] = [];
const mergeOutcomeSamples: SyncMergeOutcomeMetric[] = [];
const commandSamples: CommandOperationalMetric[] = [];
const clientPerformanceSamples: ClientPerformanceMetric[] = [];

const finite = (value: unknown, max = Number.MAX_SAFE_INTEGER): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(0, number));
};

const appendBounded = <T>(samples: T[], metric: T): void => {
  samples.push(metric);
  if (samples.length > MAX_OPERATIONAL_TELEMETRY_SAMPLES) samples.shift();
};

function emit(
  metric: SyncOperationalMetric | SyncMergeOutcomeMetric | CommandOperationalMetric | ClientPerformanceMetric,
): void {
  if (process.env.NODE_ENV === 'test') return;
  // Cloud runtimes retain stdout; metrics contain only bounded numeric values
  // and a known command type, never tenant ids, command ids, or payload data.
  console.info(JSON.stringify({ event: 'cellarflow_operational_metric', ...metric }));
}

const performanceNames = new Set<ClientPerformanceMetricName>([
  'LCP',
  'INP',
  'CLS',
  'route_load',
  'offline_start',
]);
const performanceRatings = new Set<ClientPerformanceRating>(['good', 'needs_improvement', 'poor']);
const deviceClasses = new Set<ClientDeviceClass>(['mobile', 'tablet', 'desktop']);
const networkClasses = new Set<ClientNetworkClass>(['offline', 'slow', 'standard', 'unknown']);
const routeClasses = new Set<ClientRouteClass>(['landing', 'auth', 'tasks', 'billing', 'public', 'workspace']);

export function recordClientPerformanceMetric(metric: Omit<ClientPerformanceMetric, 'at'>): void {
  if (!performanceNames.has(metric.name)) return;
  const normalized: ClientPerformanceMetric = {
    at: new Date().toISOString(),
    name: metric.name,
    value: Math.round(finite(metric.value, 10 * 60_000) * 1_000) / 1_000,
    rating: performanceRatings.has(metric.rating) ? metric.rating : 'poor',
    deviceClass: deviceClasses.has(metric.deviceClass) ? metric.deviceClass : 'desktop',
    networkClass: networkClasses.has(metric.networkClass) ? metric.networkClass : 'unknown',
    routeClass: routeClasses.has(metric.routeClass) ? metric.routeClass : 'workspace',
  };
  appendBounded(clientPerformanceSamples, normalized);
  emit(normalized);
}

export function recordSyncOperationalMetric(metric: Omit<SyncOperationalMetric, 'at'>): void {
  const normalized: SyncOperationalMetric = {
    at: new Date().toISOString(),
    payloadBytes: finite(metric.payloadBytes, 10_000_000),
    recordCount: finite(metric.recordCount, 100_000),
    tombstoneCount: finite(metric.tombstoneCount, 100_000),
    durationMs: finite(metric.durationMs, 10 * 60_000),
    mergeMs: finite(metric.mergeMs, 10 * 60_000),
    retryCount: finite(metric.retryCount, 10),
    conflict: Boolean(metric.conflict),
    statusCode: Math.round(finite(metric.statusCode, 599)),
    outcome: metric.outcome,
  };
  appendBounded(syncSamples, normalized);
  emit(normalized);
}

export function recordSyncMergeOutcomeMetric(metric: Omit<SyncMergeOutcomeMetric, 'at'>): void {
  const normalized: SyncMergeOutcomeMetric = {
    at: new Date().toISOString(),
    newRecord: finite(metric.newRecord, 100_000),
    unchanged: finite(metric.unchanged, 100_000),
    cleanFastForward: finite(metric.cleanFastForward, 100_000),
    fieldMergeApplied: finite(metric.fieldMergeApplied, 100_000),
    sameFieldConflict: finite(metric.sameFieldConflict, 100_000),
    baselineUnavailable: finite(metric.baselineUnavailable, 100_000),
    legacyLastWriteWins: finite(metric.legacyLastWriteWins, 100_000),
  };
  // A sync that merged nothing (an empty or new-records-only payload) carries no
  // signal for either question and would dilute the sample window.
  const merged = normalized.cleanFastForward
    + normalized.fieldMergeApplied
    + normalized.sameFieldConflict
    + normalized.baselineUnavailable
    + normalized.legacyLastWriteWins
    + normalized.unchanged;
  if (merged === 0) return;

  appendBounded(mergeOutcomeSamples, normalized);
  emit(normalized);
}

export function recordCommandOperationalMetric(metric: Omit<CommandOperationalMetric, 'at'>): void {
  const normalized: CommandOperationalMetric = {
    at: new Date().toISOString(),
    commandType: /^[a-z][a-z0-9_.-]{2,63}$/.test(metric.commandType) ? metric.commandType : 'unknown',
    durationMs: finite(metric.durationMs, 10 * 60_000),
    queueAgeMs: finite(metric.queueAgeMs, MAX_REPORTED_QUEUE_AGE_MS),
    statusCode: Math.round(finite(metric.statusCode, 599)),
    outcome: metric.outcome,
  };
  appendBounded(commandSamples, normalized);
  emit(normalized);
}

const average = (values: number[]): number => values.length === 0
  ? 0
  : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;

const percentile95 = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

const percentile75 = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1)];
};

const rate = (count: number, total: number): number => total === 0
  ? 0
  : Math.round((count / total) * 10_000) / 10_000;

export function getOperationalTelemetrySnapshot() {
  const commandTypes: Record<string, { samples: number; failures: number; replays: number; p95LatencyMs: number }> = {};
  for (const commandType of new Set(commandSamples.map(sample => sample.commandType))) {
    const samples = commandSamples.filter(sample => sample.commandType === commandType);
    commandTypes[commandType] = {
      samples: samples.length,
      failures: samples.filter(sample => sample.outcome === 'failed').length,
      replays: samples.filter(sample => sample.outcome === 'replayed').length,
      p95LatencyMs: percentile95(samples.map(sample => sample.durationMs)),
    };
  }
  const webVitals = Object.fromEntries(
    [...performanceNames].map(name => {
      const samples = clientPerformanceSamples.filter(sample => sample.name === name);
      return [name, {
        samples: samples.length,
        p75: percentile75(samples.map(sample => sample.value)),
        poorRate: rate(samples.filter(sample => sample.rating === 'poor').length, samples.length),
      }];
    }),
  );
  return {
    generatedAt: new Date().toISOString(),
    sampleCapacity: MAX_OPERATIONAL_TELEMETRY_SAMPLES,
    sync: {
      samples: syncSamples.length,
      conflicts: syncSamples.filter(sample => sample.conflict).length,
      conflictRate: rate(syncSamples.filter(sample => sample.conflict).length, syncSamples.length),
      rejectedRate: rate(syncSamples.filter(sample => sample.outcome === 'rejected').length, syncSamples.length),
      totalRetries: syncSamples.reduce((sum, sample) => sum + sample.retryCount, 0),
      averagePayloadBytes: average(syncSamples.map(sample => sample.payloadBytes)),
      maximumPayloadBytes: Math.max(0, ...syncSamples.map(sample => sample.payloadBytes)),
      averageRecordCount: average(syncSamples.map(sample => sample.recordCount)),
      averageTombstoneCount: average(syncSamples.map(sample => sample.tombstoneCount)),
      averageMergeMs: average(syncSamples.map(sample => sample.mergeMs)),
      p95DurationMs: percentile95(syncSamples.map(sample => sample.durationMs)),
    },
    syncMergeOutcomes: (() => {
      const sum = (pick: (sample: SyncMergeOutcomeMetric) => number) =>
        mergeOutcomeSamples.reduce((total, sample) => total + pick(sample), 0);

      const newRecord = sum(sample => sample.newRecord);
      const unchanged = sum(sample => sample.unchanged);
      const cleanFastForward = sum(sample => sample.cleanFastForward);
      const fieldMergeApplied = sum(sample => sample.fieldMergeApplied);
      const sameFieldConflict = sum(sample => sample.sameFieldConflict);
      const baselineUnavailable = sum(sample => sample.baselineUnavailable);
      const legacyLastWriteWins = sum(sample => sample.legacyLastWriteWins);

      // Records that arrived with a baseline the server had already moved past.
      // Only these three exercise three-way merge at all.
      const staleBaseline = fieldMergeApplied + sameFieldConflict + baselineUnavailable;
      const records = newRecord + unchanged + cleanFastForward + staleBaseline + legacyLastWriteWins;

      return {
        samples: mergeOutcomeSamples.length,
        records,
        newRecord,
        unchanged,
        cleanFastForward,
        fieldMergeApplied,
        sameFieldConflict,
        baselineUnavailable,
        legacyLastWriteWins,
        staleBaseline,
        // How often three-way merge earns its keep: a stale baseline that was
        // resolved silently instead of surfacing a conflict.
        fieldMergeSuccessRate: rate(fieldMergeApplied, staleBaseline),
        // How often it already fails for want of in-process history. This is the
        // rate every stale-baseline merge would hit on a second instance, so a
        // number that is already high means the baselines are not worth
        // persisting — deleting the merge would cost little.
        baselineUnavailableRate: rate(baselineUnavailable, staleBaseline),
        // Conflicts no merge strategy could avoid: both sides edited one field.
        unavoidableConflictRate: rate(sameFieldConflict, staleBaseline),
        // Share of merged records the client did not need to send at all — the
        // prize for per-record delta sync.
        redundantRecordRate: rate(unchanged, records),
      };
    })(),
    commands: {
      samples: commandSamples.length,
      replayRate: rate(commandSamples.filter(sample => sample.outcome === 'replayed').length, commandSamples.length),
      failureRate: rate(commandSamples.filter(sample => sample.outcome === 'failed').length, commandSamples.length),
      averageQueueAgeMs: average(commandSamples.map(sample => sample.queueAgeMs)),
      maximumQueueAgeMs: Math.max(0, ...commandSamples.map(sample => sample.queueAgeMs)),
      p95LatencyMs: percentile95(commandSamples.map(sample => sample.durationMs)),
      byType: commandTypes,
    },
    clientPerformance: {
      samples: clientPerformanceSamples.length,
      byMetric: webVitals,
      byDeviceClass: Object.fromEntries(
        [...deviceClasses].map(deviceClass => [
          deviceClass,
          clientPerformanceSamples.filter(sample => sample.deviceClass === deviceClass).length,
        ]),
      ),
    },
  };
}

export function resetOperationalTelemetryForTests(): void {
  syncSamples.length = 0;
  mergeOutcomeSamples.length = 0;
  commandSamples.length = 0;
  clientPerformanceSamples.length = 0;
}
