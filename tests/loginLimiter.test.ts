import { describe, it, expect } from 'vitest';
import { createLoginLimiter } from '../server/loginLimiter';

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
});
