import { describe, it, expect } from 'vitest';
import { createLoginLimiter, createSharedLoginLimiter } from '../server/loginLimiter';

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('login limiter', () => {
  it('locks the key after maxAttempts failures', () => {
    const clock = makeClock();
    const lim = createLoginLimiter({ maxAttempts: 3, windowMs: 1000 * 60, lockoutMs: 1000 * 60, now: clock.now });
    const key = '1.2.3.4:luka';

    lim.recordFailure(key);
    lim.recordFailure(key);
    expect(lim.lockRemainingSeconds(key)).toBe(0); // 2 failures, not locked yet
    lim.recordFailure(key);                         // 3rd failure → locked
    expect(lim.lockRemainingSeconds(key)).toBe(60);
  });

  it('unlocks after the lockout window elapses', () => {
    const clock = makeClock();
    const lim = createLoginLimiter({ maxAttempts: 2, windowMs: 1000 * 60, lockoutMs: 1000 * 30, now: clock.now });
    const key = 'k';
    lim.recordFailure(key); lim.recordFailure(key);
    expect(lim.lockRemainingSeconds(key)).toBe(30);
    clock.advance(30_000 + 1);
    expect(lim.lockRemainingSeconds(key)).toBe(0);
  });

  it('resets the counter once the sliding window passes', () => {
    const clock = makeClock();
    const lim = createLoginLimiter({ maxAttempts: 3, windowMs: 1000 * 60, lockoutMs: 1000 * 60, now: clock.now });
    const key = 'k';
    lim.recordFailure(key); lim.recordFailure(key); // 2 within window
    clock.advance(60_000 + 1);                       // window expires
    lim.recordFailure(key);                          // counts as a fresh 1st
    expect(lim.lockRemainingSeconds(key)).toBe(0);
  });

  it('clear() resets attempts (called on successful login)', () => {
    const clock = makeClock();
    const lim = createLoginLimiter({ maxAttempts: 2, windowMs: 1000 * 60, lockoutMs: 1000 * 60, now: clock.now });
    const key = 'k';
    lim.recordFailure(key); lim.recordFailure(key);
    expect(lim.lockRemainingSeconds(key)).toBeGreaterThan(0);
    lim.clear(key);
    expect(lim.lockRemainingSeconds(key)).toBe(0);
  });

  it('tracks keys independently', () => {
    const clock = makeClock();
    const lim = createLoginLimiter({ maxAttempts: 2, windowMs: 1000 * 60, lockoutMs: 1000 * 60, now: clock.now });
    lim.recordFailure('a'); lim.recordFailure('a');
    lim.recordFailure('b');
    expect(lim.lockRemainingSeconds('a')).toBeGreaterThan(0);
    expect(lim.lockRemainingSeconds('b')).toBe(0);
  });

  it('can use a PostgreSQL-backed shared attempt store', async () => {
    const clock = makeClock();
    const rows = new Map<string, any>();
    const loginAttempt = {
      findUnique: async ({ where }: any) => rows.get(where.key) || null,
      upsert: async ({ where, update, create }: any) => {
        const next = rows.has(where.key)
          ? { ...rows.get(where.key), ...update }
          : { ...create, updatedAt: new Date(clock.now()) };
        rows.set(where.key, next);
        return next;
      },
      update: async ({ where, data }: any) => {
        const next = { ...rows.get(where.key), ...data, updatedAt: new Date(clock.now()) };
        rows.set(where.key, next);
        return next;
      },
      deleteMany: async ({ where }: any) => {
        rows.delete(where.key);
        return { count: 1 };
      },
    };
    const lim = createSharedLoginLimiter(
      { maxAttempts: 2, windowMs: 1000 * 60, lockoutMs: 1000 * 30, now: clock.now },
      async () => ({ loginAttempt })
    );

    await lim.recordFailure('k');
    expect(lim.backend()).toBe('postgres');
    expect(await lim.lockRemainingSeconds('k')).toBe(0);

    await lim.recordFailure('k');
    expect(await lim.lockRemainingSeconds('k')).toBe(30);

    await lim.clear('k');
    expect(await lim.lockRemainingSeconds('k')).toBe(0);
  });
});

describe('login limiter — admin lockouts view (list)', () => {
  it('lists locked and counting entries with remaining seconds, locked first', () => {
    const clock = makeClock();
    const lim = createLoginLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 30_000, now: clock.now });
    lim.recordFailure('ip1:luka');                 // counting (1 failure)
    lim.recordFailure('ip2:eve'); lim.recordFailure('ip2:eve'); // locked

    const entries = lim.list();
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe('ip2:eve');        // locked sorts first
    expect(entries[0].remainingSeconds).toBe(30);
    expect(entries[0].lockedUntil).not.toBeNull();
    expect(entries[1].key).toBe('ip1:luka');
    expect(entries[1].remainingSeconds).toBe(0);
    expect(entries[1].lockedUntil).toBeNull();
  });

  it('drops stale windows so the view only shows live state', () => {
    const clock = makeClock();
    const lim = createLoginLimiter({ maxAttempts: 3, windowMs: 60_000, lockoutMs: 30_000, now: clock.now });
    lim.recordFailure('old');
    clock.advance(60_001); // window expired, never locked
    expect(lim.list()).toHaveLength(0);
  });

  it('clear() removes the entry from the view', () => {
    const clock = makeClock();
    const lim = createLoginLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 30_000, now: clock.now });
    lim.recordFailure('k'); lim.recordFailure('k');
    expect(lim.list()).toHaveLength(1);
    lim.clear('k');
    expect(lim.list()).toHaveLength(0);
  });
});
