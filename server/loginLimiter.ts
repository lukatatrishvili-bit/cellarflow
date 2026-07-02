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

/** One tracked identifier, for the admin lockouts view. */
export interface LimiterEntry {
  key: string;              // "<ip>:<identifier>"
  count: number;
  lockedUntil: string | null; // ISO when locked, null while only counting
  remainingSeconds: number;   // 0 when not locked
}

export interface LoginLimiter {
  /** Remaining lockout in seconds (0 if not locked). */
  lockRemainingSeconds(key: string): number;
  recordFailure(key: string): void;
  clear(key: string): void;
  /** Currently tracked identifiers (recent failures and active lockouts). */
  list(): LimiterEntry[];
}

export interface SharedLoginLimiter {
  /** Remaining lockout in seconds (0 if not locked). */
  lockRemainingSeconds(key: string): Promise<number>;
  recordFailure(key: string): Promise<void>;
  clear(key: string): Promise<void>;
  list(): Promise<LimiterEntry[]>;
  backend(): 'postgres' | 'memory';
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
    list() {
      const t = now();
      const entries: LimiterEntry[] = [];
      for (const [key, rec] of attempts) {
        // Drop stale windows so the admin view only shows live state.
        if (rec.lockedUntil <= t && t - rec.first > windowMs) continue;
        const remainingMs = rec.lockedUntil - t;
        entries.push({
          key,
          count: rec.count,
          lockedUntil: rec.lockedUntil > t ? new Date(rec.lockedUntil).toISOString() : null,
          remainingSeconds: remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0,
        });
      }
      return entries.sort((a, b) => b.remainingSeconds - a.remainingSeconds);
    },
  };
}

export function createSharedLoginLimiter(
  opts: LoginLimiterOptions,
  getPrisma: () => Promise<any | null>
): SharedLoginLimiter {
  const memory = createLoginLimiter(opts);
  const { maxAttempts, windowMs, lockoutMs } = opts;
  const now = opts.now || (() => Date.now());
  let lastBackend: 'postgres' | 'memory' = 'memory';

  async function loginAttemptStore(): Promise<any | null> {
    try {
      const prisma = await getPrisma();
      if (prisma && (prisma as any).loginAttempt) {
        lastBackend = 'postgres';
        return (prisma as any).loginAttempt;
      }
    } catch {
      // Fall back to the in-process limiter below.
    }
    lastBackend = 'memory';
    return null;
  }

  return {
    async lockRemainingSeconds(key: string): Promise<number> {
      const store = await loginAttemptStore();
      if (!store) return memory.lockRemainingSeconds(key);

      const rec = await store.findUnique({ where: { key } });
      const lockedUntilMs = rec?.lockedUntil ? new Date(rec.lockedUntil).getTime() : 0;
      const remainingMs = lockedUntilMs - now();
      return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
    },

    async recordFailure(key: string): Promise<void> {
      const store = await loginAttemptStore();
      if (!store) {
        memory.recordFailure(key);
        return;
      }

      const current = await store.findUnique({ where: { key } });
      const t = now();
      const firstAtMs = current?.firstAt ? new Date(current.firstAt).getTime() : 0;
      const lockedUntilMs = current?.lockedUntil ? new Date(current.lockedUntil).getTime() : 0;

      if (!current || t - firstAtMs > windowMs) {
        await store.upsert({
          where: { key },
          update: { count: 1, firstAt: new Date(t), lockedUntil: null },
          create: { key, count: 1, firstAt: new Date(t), lockedUntil: null },
        });
        return;
      }

      if (lockedUntilMs > t) return;

      const count = current.count + 1;
      await store.update({
        where: { key },
        data: {
          count,
          lockedUntil: count >= maxAttempts ? new Date(t + lockoutMs) : null,
        },
      });
    },

    async clear(key: string): Promise<void> {
      const store = await loginAttemptStore();
      if (!store) {
        memory.clear(key);
        return;
      }
      await store.deleteMany({ where: { key } });
    },

    async list(): Promise<LimiterEntry[]> {
      const store = await loginAttemptStore();
      if (!store) return memory.list();

      const t = now();
      const rows = await store.findMany();
      return (rows || [])
        .filter((r: any) => {
          const lockedUntilMs = r.lockedUntil ? new Date(r.lockedUntil).getTime() : 0;
          const firstAtMs = r.firstAt ? new Date(r.firstAt).getTime() : 0;
          return lockedUntilMs > t || t - firstAtMs <= windowMs;
        })
        .map((r: any): LimiterEntry => {
          const lockedUntilMs = r.lockedUntil ? new Date(r.lockedUntil).getTime() : 0;
          const remainingMs = lockedUntilMs - t;
          return {
            key: r.key,
            count: r.count,
            lockedUntil: lockedUntilMs > t ? new Date(lockedUntilMs).toISOString() : null,
            remainingSeconds: remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0,
          };
        })
        .sort((a: LimiterEntry, b: LimiterEntry) => b.remainingSeconds - a.remainingSeconds);
    },

    backend(): 'postgres' | 'memory' {
      return lastBackend;
    },
  };
}
