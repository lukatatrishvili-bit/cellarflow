import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiProviderLimiter,
  AiProviderRateLimitedError,
  __resetAiProviderLimiter,
} from '../server/aiProviderLimiter';
import {
  getAiModelCallOperations,
  withAiModelCallTelemetry,
  __resetInMemoryAiModelTelemetry,
} from '../server/aiModelTelemetry';

/**
 * A deep analysis pass can ask for nine specialist calls, and nothing paced
 * them or retried a rejection. On a rate-limited key that failed the whole pass
 * and recorded it as a provider fault. These cover the pacing, the retry, and
 * the point at which waiting stops being worth it.
 */

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function quotaError(retryDelaySeconds?: number): Error {
  const error = new Error(
    `{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"`
    + (retryDelaySeconds === undefined ? '' : `,"details":[{"retryDelay":"${retryDelaySeconds}s"}]`)
    + '}}',
  );
  (error as any).status = 429;
  return error;
}

describe('provider concurrency', () => {
  it('never lets more calls out than the cap allows', async () => {
    const limiter = new AiProviderLimiter({
      maxConcurrent: 2,
      maxPerMinute: 0,
      maxWaitMs: 5_000,
    });
    let inFlight = 0;
    let peak = 0;
    const gate = deferred();

    const calls = Array.from({ length: 6 }, () => limiter.run(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gate.promise;
      inFlight -= 1;
      return 'ok';
    }));

    // Let the first batch reach the provider before anything is released.
    await Promise.resolve();
    await Promise.resolve();
    gate.release();
    await Promise.all(calls);

    expect(peak).toBe(2);
  });

  it('releases its slot when a call throws', async () => {
    const limiter = new AiProviderLimiter({
      maxConcurrent: 1,
      maxPerMinute: 0,
      maxWaitMs: 5_000,
    });

    await expect(limiter.run(async () => { throw new Error('provider down'); }))
      .rejects.toThrow('provider down');
    // A leaked slot would deadlock every later call at this cap.
    await expect(limiter.run(async () => 'recovered')).resolves.toBe('recovered');
  });

  it('gives up rather than queueing forever', async () => {
    const limiter = new AiProviderLimiter({
      maxConcurrent: 1,
      maxPerMinute: 0,
      maxWaitMs: 20,
    });
    const gate = deferred();
    const holding = limiter.run(async () => { await gate.promise; return 'held'; });

    await expect(limiter.run(async () => 'queued'))
      .rejects.toBeInstanceOf(AiProviderRateLimitedError);

    gate.release();
    await holding;
  });

  it('spaces calls once the per-minute ceiling is reached', async () => {
    const limiter = new AiProviderLimiter({
      maxConcurrent: 5,
      maxPerMinute: 2,
      maxWaitMs: 50,
    });

    expect(await limiter.run(async () => 1)).toBe(1);
    expect(await limiter.run(async () => 2)).toBe(2);
    // The window is full and will not reopen within maxWaitMs.
    await expect(limiter.run(async () => 3))
      .rejects.toBeInstanceOf(AiProviderRateLimitedError);
  });
});

describe('provider retries', () => {
  beforeEach(() => {
    __resetInMemoryAiModelTelemetry();
    __resetAiProviderLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a transient rejection and records one successful call', async () => {
    let attempts = 0;
    const value = await withAiModelCallTelemetry({
      organizationId: 'org-limit',
      purpose: 'analysis',
      model: 'gemini-2.5-flash',
    }, async () => {
      attempts += 1;
      if (attempts < 3) throw quotaError(0.01);
      return { value: 'answered', valid: true };
    });

    expect(value).toBe('answered');
    expect(attempts).toBe(3);
    // Retries are one logical call, not three failures in the console.
    const telemetry = await getAiModelCallOperations(20);
    expect(telemetry.byPurpose.analysis).toEqual(expect.objectContaining({
      total: 1,
      succeeded: 1,
      failed: 0,
    }));
  });

  it('stops retrying when the provider asks for longer than we will wait', async () => {
    let attempts = 0;

    await expect(withAiModelCallTelemetry({
      organizationId: 'org-limit',
      purpose: 'analysis',
      model: 'gemini-2.5-flash',
    }, async () => {
      attempts += 1;
      throw quotaError(55);
    })).rejects.toBeInstanceOf(AiProviderRateLimitedError);

    // Sleeping 55 seconds inside a winemaker's request helps nobody.
    expect(attempts).toBe(1);
    const telemetry = await getAiModelCallOperations(20);
    expect(telemetry.recentFailures[0]).toEqual(expect.objectContaining({
      errorCategory: 'rate_limited',
      status: 'failed',
    }));
  });

  it('does not retry a request the provider will always reject', async () => {
    let attempts = 0;
    const invalid = new Error('invalid argument');
    (invalid as any).status = 400;

    await expect(withAiModelCallTelemetry({
      organizationId: 'org-limit',
      purpose: 'analysis',
      model: 'gemini-2.5-flash',
    }, async () => {
      attempts += 1;
      throw invalid;
    })).rejects.toThrow('invalid argument');

    expect(attempts).toBe(1);
  });

  it('gives up after a bounded number of attempts', async () => {
    let attempts = 0;

    await expect(withAiModelCallTelemetry({
      organizationId: 'org-limit',
      purpose: 'analysis',
      model: 'gemini-2.5-flash',
    }, async () => {
      attempts += 1;
      throw quotaError(0.01);
    })).rejects.toThrow();

    expect(attempts).toBe(3);
  });
});
