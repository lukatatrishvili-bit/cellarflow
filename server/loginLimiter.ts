/**
 * In-memory brute-force limiter for login: per-key (IP + identifier) sliding
 * window with a temporary lockout after too many failures.
 *
 * Factory form with an injectable clock so it can be unit-tested deterministically.
 * In-memory state is per-process — effective when Cloud Run runs a single
 * instance (see deployment guide `--max-instances=1`); a shared store (Redis)
 * would be needed to limit across instances.
 */

export interface LoginLimiterOptions {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
  now?: () => number;
}

interface Attempt { count: number; first: number; lockedUntil: number; }

export interface LoginLimiter {
  /** Remaining lockout in seconds (0 if not locked). */
  lockRemainingSeconds(key: string): number;
  recordFailure(key: string): void;
  clear(key: string): void;
}

export function createLoginLimiter(opts: LoginLimiterOptions): LoginLimiter {
  const { maxAttempts, windowMs, lockoutMs } = opts;
  const now = opts.now || (() => Date.now());
  const attempts = new Map<string, Attempt>();

  return {
    lockRemainingSeconds(key) {
      const rec = attempts.get(key);
      if (rec && rec.lockedUntil > now()) return Math.ceil((rec.lockedUntil - now()) / 1000);
      return 0;
    },
    recordFailure(key) {
      const t = now();
      const rec = attempts.get(key);
      if (!rec || t - rec.first > windowMs) {
        attempts.set(key, { count: 1, first: t, lockedUntil: 0 });
        return;
      }
      rec.count += 1;
      if (rec.count >= maxAttempts) rec.lockedUntil = t + lockoutMs;
    },
    clear(key) {
      attempts.delete(key);
    },
  };
}
