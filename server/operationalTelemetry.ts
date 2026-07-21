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

export interface CommandOperationalMetric {
  at: string;
  commandType: string;
  durationMs: number;
  queueAgeMs: number;
  statusCode: number;
  outcome: 'executed' | 'replayed' | 'failed';
}

const syncSamples: SyncOperationalMetric[] = [];
const commandSamples: CommandOperationalMetric[] = [];

const finite = (value: unknown, max = Number.MAX_SAFE_INTEGER): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(0, number));
};

const appendBounded = <T>(samples: T[], metric: T): void => {
  samples.push(metric);
  if (samples.length > MAX_OPERATIONAL_TELEMETRY_SAMPLES) samples.shift();
};

function emit(metric: SyncOperationalMetric | CommandOperationalMetric): void {
  if (process.env.NODE_ENV === 'test') return;
  // Cloud runtimes retain stdout; metrics contain only bounded numeric values
  // and a known command type, never tenant ids, command ids, or payload data.
  console.info(JSON.stringify({ event: 'cellarflow_operational_metric', ...metric }));
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
    commands: {
      samples: commandSamples.length,
      replayRate: rate(commandSamples.filter(sample => sample.outcome === 'replayed').length, commandSamples.length),
      failureRate: rate(commandSamples.filter(sample => sample.outcome === 'failed').length, commandSamples.length),
      averageQueueAgeMs: average(commandSamples.map(sample => sample.queueAgeMs)),
      maximumQueueAgeMs: Math.max(0, ...commandSamples.map(sample => sample.queueAgeMs)),
      p95LatencyMs: percentile95(commandSamples.map(sample => sample.durationMs)),
      byType: commandTypes,
    },
  };
}

export function resetOperationalTelemetryForTests(): void {
  syncSamples.length = 0;
  commandSamples.length = 0;
}
