import express from 'express';
import crypto from 'crypto';
import { verifySessionToken } from '../auth';
import { parseCookies } from './auth';
import { clientIp } from '../config';

/**
 * A per-caller ceiling on the expensive endpoints.
 *
 * `/api/sync` accepts bodies up to 5 MB and `/api/commands/*` opens a database
 * transaction per request, yet neither had any rate limit — the targeted
 * limiters all guard authentication flows. The realistic failure is not an
 * attacker but a client stuck in a retry loop (an offline cellar tablet
 * reconnecting, a bad deploy) driving unbounded Cloud Run scale-up and database
 * load for every tenant on the instance. This bounds that.
 *
 * Two deliberate limitations, stated rather than papered over:
 *
 *   1. The window is per instance and in memory. Coordinating through
 *      PostgreSQL would add a round trip to the hot write path, and the
 *      cross-instance guarantee genuinely matters for credential brute force
 *      (which `createSharedLoginLimiter` already provides) far more than for
 *      throttling an authenticated caller's own workload.
 *   2. Ceilings are set well above any legitimate client so this never becomes
 *      an availability problem of its own. It is a runaway guard, not a quota.
 *
 * ## Semantics above one instance — decided, not inherited
 *
 * `max` is a **per-instance** ceiling. Running N instances therefore permits up
 * to N × `max` per caller globally, because a caller's requests are spread
 * across instances by the load balancer. That is accepted deliberately:
 *
 *   - What this guards against is a runaway client, and N × a number already set
 *     well above legitimate use is still bounded and still far below the load
 *     that motivated the guard.
 *   - The limits that must hold globally — credential brute force, account
 *     recovery, invitation and OAuth callback abuse — do NOT rely on this. They
 *     use `createSharedLoginLimiter`, which is backed by the `loginAttempt`
 *     table and is already correct across instances.
 *   - Dividing `max` by the instance count would be worse than useless: HTTP
 *     keep-alive keeps a client's requests on one connection, so a caller can
 *     legitimately send its whole burst to a single instance. A divided ceiling
 *     would refuse real work while the global budget sat unused.
 *
 * So: raising `--max-instances` raises the effective global ceiling
 * proportionally, and that is the intended behaviour. If a limit ever needs to
 * hold globally, it belongs in `createSharedLoginLimiter`, not here.
 */

interface Window {
  count: number;
  windowStart: number;
}

export interface RequestCeilingOptions {
  /** Requests permitted per window, per caller. */
  max: number;
  windowMs: number;
  /** Distinguishes buckets so two mounts cannot share a counter. */
  name: string;
  /**
   * How many callers may be tracked before eviction. Defaults to
   * `MAX_TRACKED_CALLERS`; exposed so the eviction path can be exercised by a
   * test without generating twenty thousand identities.
   */
  maxTrackedCallers?: number;
}

// Bounds the map itself: a rotating-identity flood must not become a memory
// leak. Well above the number of clients a single instance realistically holds.
const MAX_TRACKED_CALLERS = 20_000;

/**
 * Make room for a new caller without discarding the counters that are doing the
 * work.
 *
 * The previous behaviour — `windows.clear()` on reaching the cap — reset every
 * tracked caller at once, so enough unrelated traffic wiped a throttled
 * client's window and handed it a fresh allowance. The ceiling was weakest
 * exactly when the service was busiest, and reaching that state needed no
 * privilege: just keep arriving as new callers.
 *
 * Eviction order matters more than it looks. Expired windows go first, since
 * they carry no information. If everything tracked is still live, the entry
 * with the *lowest count* is dropped — deliberately not the oldest. Oldest
 * sounds right and is wrong here: the longest-tracked caller is typically the
 * one being throttled, so evicting it rebuilds the original hole. A caller
 * below its limit loses nothing by being forgotten; a caller at its limit is
 * the only reason this map exists.
 */
function evictForNewCaller(
  windows: Map<string, Window>,
  now: number,
  windowMs: number,
  cap: number,
): void {
  if (windows.size < cap) return;

  for (const [key, window] of windows) {
    if (now - window.windowStart >= windowMs) windows.delete(key);
  }
  if (windows.size < cap) return;

  let evictKey: string | null = null;
  let lowestCount = Infinity;
  let oldestStart = Infinity;
  for (const [key, window] of windows) {
    // Lowest count wins; among equals, the window closest to expiring.
    if (window.count < lowestCount
      || (window.count === lowestCount && window.windowStart < oldestStart)) {
      lowestCount = window.count;
      oldestStart = window.windowStart;
      evictKey = key;
    }
  }
  if (evictKey !== null) windows.delete(evictKey);
}

/**
 * Identify the caller without touching the database. The session cookie is an
 * HMAC blob we can verify locally, so an authenticated caller is billed to its
 * own username — several cellar tablets behind one winery's NAT must not share
 * a bucket. Unauthenticated requests fall back to the proxy-resolved IP.
 */
function callerKey(req: express.Request): string {
  const session = verifySessionToken(parseCookies(req.headers.cookie)['maranios_session']);
  if (session?.username) return `u:${String(session.username).toLowerCase()}`;
  // Hashed so the bucket keys cannot themselves become a record of who called.
  return `i:${crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 32)}`;
}

export function requestCeiling(options: RequestCeilingOptions): express.RequestHandler {
  const windows = new Map<string, Window>();
  const cap = options.maxTrackedCallers ?? MAX_TRACKED_CALLERS;

  return (req, res, next) => {
    const key = `${options.name}:${callerKey(req)}`;
    const now = Date.now();
    const existing = windows.get(key);

    if (!existing || now - existing.windowStart >= options.windowMs) {
      if (!existing) evictForNewCaller(windows, now, options.windowMs, cap);
      windows.set(key, { count: 1, windowStart: now });
      return next();
    }

    existing.count += 1;
    if (existing.count <= options.max) return next();

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.windowStart + options.windowMs - now) / 1000),
    );
    res.setHeader('Retry-After', String(retryAfterSeconds));
    // The sync client already surfaces `code` from a 4xx body and keeps local
    // changes for the next attempt, so nothing is lost by refusing here.
    return res.status(429).json({
      code: 'rate_limited',
      error: 'Too many requests from this account. Wait a moment and try again.',
      retryAfterSeconds,
    });
  };
}
