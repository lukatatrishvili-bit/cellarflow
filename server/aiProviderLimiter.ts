/**
 * Paces outbound provider calls.
 *
 * A single deep-analysis request can ask for nine specialist calls, and nothing
 * stood between them and the provider. On a rate-limited key that is a
 * self-inflicted 429 storm; the layer had no retry either, so the whole pass
 * failed and the operations console recorded it as a provider fault.
 *
 * Two independent guards, because they solve different problems:
 *  - a concurrency cap stops one request bursting every call at once;
 *  - an optional per-minute ceiling matches a known account quota.
 *
 * Both are per process. Several Cloud Run instances can still exceed an account
 * quota between them, which is what the retry path below is for.
 */

export class AiProviderRateLimitedError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'AiProviderRateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

function envInt(name: string, fallback: number): number {
  const raw = Number((process.env[name] || '').trim());
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

export interface AiProviderLimiterOptions {
  /** In-flight provider calls allowed at once. */
  maxConcurrent: number;
  /** Calls allowed per rolling minute. Zero disables the ceiling. */
  maxPerMinute: number;
  /**
   * How long a call may wait for a slot before giving up. An interactive
   * request should fail with something the caller can act on rather than hang.
   */
  maxWaitMs: number;
}

export class AiProviderLimiter {
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly recent: number[] = [];

  constructor(private options: AiProviderLimiterOptions) {}

  configure(options: Partial<AiProviderLimiterOptions>): void {
    this.options = { ...this.options, ...options };
  }

  private pruneWindow(now: number): void {
    const cutoff = now - 60_000;
    while (this.recent.length > 0 && this.recent[0] <= cutoff) this.recent.shift();
  }

  /** Milliseconds until a slot frees up, or 0 when one is available now. */
  private waitFor(now: number): number {
    if (this.inFlight >= this.options.maxConcurrent) return -1;
    if (this.options.maxPerMinute <= 0) return 0;
    this.pruneWindow(now);
    if (this.recent.length < this.options.maxPerMinute) return 0;
    return Math.max(1, this.recent[0] + 60_000 - now);
  }

  private release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.waiting.shift();
    if (next) next();
  }

  /**
   * Runs `operation` once a slot is free. Throws
   * {@link AiProviderRateLimitedError} rather than waiting indefinitely.
   */
  async run<T>(operation: () => Promise<T>, now = () => Date.now()): Promise<T> {
    const deadline = now() + this.options.maxWaitMs;

    for (;;) {
      const wait = this.waitFor(now());
      if (wait === 0) break;

      const remaining = deadline - now();
      if (remaining <= 0) {
        throw new AiProviderRateLimitedError(
          'The AI provider request queue is full. Try again shortly.',
          Math.max(wait, 1_000),
        );
      }
      if (wait > 0) {
        // A known quota window: sleep the shorter of the window and our budget.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, Math.min(wait, remaining));
        });
        continue;
      }
      // Concurrency-bound: wake when a call finishes, or when the budget runs out.
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        this.waiting.push(done);
        setTimeout(done, remaining);
      });
    }

    this.inFlight += 1;
    if (this.options.maxPerMinute > 0) this.recent.push(now());
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  /** Test-only. */
  reset(): void {
    this.inFlight = 0;
    this.waiting.length = 0;
    this.recent.length = 0;
  }
}

/**
 * Concurrency is capped by default because bursting is never useful. The
 * per-minute ceiling is opt-in: the right value is the account's own quota, and
 * guessing one would throttle a deployment that does not need it. A free-tier
 * key wants `AI_PROVIDER_MAX_RPM=5`.
 */
export const aiProviderLimiter = new AiProviderLimiter({
  maxConcurrent: Math.max(1, envInt('AI_PROVIDER_MAX_CONCURRENT', 3)),
  maxPerMinute: envInt('AI_PROVIDER_MAX_RPM', 0),
  maxWaitMs: Math.max(0, envInt('AI_PROVIDER_MAX_WAIT_MS', 15_000)),
});

export function __resetAiProviderLimiter(): void {
  aiProviderLimiter.reset();
  aiProviderLimiter.configure({
    maxConcurrent: Math.max(1, envInt('AI_PROVIDER_MAX_CONCURRENT', 3)),
    maxPerMinute: envInt('AI_PROVIDER_MAX_RPM', 0),
    maxWaitMs: Math.max(0, envInt('AI_PROVIDER_MAX_WAIT_MS', 15_000)),
  });
}
