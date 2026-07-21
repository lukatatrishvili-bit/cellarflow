import { beforeEach, describe, expect, it } from 'vitest';
import {
  getOperationalTelemetrySnapshot,
  MAX_OPERATIONAL_TELEMETRY_SAMPLES,
  MAX_REPORTED_QUEUE_AGE_MS,
  recordCommandOperationalMetric,
  recordSyncOperationalMetric,
  resetOperationalTelemetryForTests,
} from '../server/operationalTelemetry';

describe('privacy-safe operational telemetry', () => {
  beforeEach(() => resetOperationalTelemetryForTests());

  it('aggregates sync conflict, retry, payload, record, and latency signals', () => {
    recordSyncOperationalMetric({
      payloadBytes: 1_000,
      recordCount: 10,
      tombstoneCount: 1,
      durationMs: 20,
      mergeMs: 8,
      retryCount: 0,
      conflict: false,
      statusCode: 200,
      outcome: 'success',
    });
    recordSyncOperationalMetric({
      payloadBytes: 3_000,
      recordCount: 30,
      tombstoneCount: 3,
      durationMs: 60,
      mergeMs: 12,
      retryCount: 2,
      conflict: true,
      statusCode: 200,
      outcome: 'conflict',
    });

    expect(getOperationalTelemetrySnapshot().sync).toMatchObject({
      samples: 2,
      conflicts: 1,
      conflictRate: 0.5,
      totalRetries: 2,
      averagePayloadBytes: 2_000,
      maximumPayloadBytes: 3_000,
      averageRecordCount: 20,
      averageTombstoneCount: 2,
      averageMergeMs: 10,
      p95DurationMs: 60,
    });
  });

  it('aggregates command replay, failure, queue-age, type, and latency signals', () => {
    recordCommandOperationalMetric({
      commandType: 'cellar.transfer', durationMs: 40, queueAgeMs: 100,
      statusCode: 201, outcome: 'executed',
    });
    recordCommandOperationalMetric({
      commandType: 'cellar.transfer', durationMs: 20, queueAgeMs: 200,
      statusCode: 200, outcome: 'replayed',
    });
    recordCommandOperationalMetric({
      commandType: 'unsafe/type', durationMs: 10, queueAgeMs: Number.POSITIVE_INFINITY,
      statusCode: 500, outcome: 'failed',
    });

    const snapshot = getOperationalTelemetrySnapshot();
    expect(snapshot.commands).toMatchObject({
      samples: 3,
      replayRate: 0.3333,
      failureRate: 0.3333,
      averageQueueAgeMs: 100,
      maximumQueueAgeMs: 200,
      p95LatencyMs: 40,
      byType: {
        'cellar.transfer': { samples: 2, failures: 0, replays: 1, p95LatencyMs: 40 },
        unknown: { samples: 1, failures: 1, replays: 0, p95LatencyMs: 10 },
      },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/"organizationId"|"commandId"|"payload":/i);
  });

  it('bounds samples and untrusted numeric values', () => {
    for (let index = 0; index <= MAX_OPERATIONAL_TELEMETRY_SAMPLES; index++) {
      recordCommandOperationalMetric({
        commandType: 'cellar.transfer',
        durationMs: -1,
        queueAgeMs: MAX_REPORTED_QUEUE_AGE_MS * 2,
        statusCode: 999,
        outcome: 'failed',
      });
    }

    expect(getOperationalTelemetrySnapshot().commands).toMatchObject({
      samples: MAX_OPERATIONAL_TELEMETRY_SAMPLES,
      averageQueueAgeMs: MAX_REPORTED_QUEUE_AGE_MS,
      maximumQueueAgeMs: MAX_REPORTED_QUEUE_AGE_MS,
      p95LatencyMs: 0,
    });
  });
});
