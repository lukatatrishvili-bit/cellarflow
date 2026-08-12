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
}

// Bounds the map itself: a rotating-identity flood must not become a memory
// leak. Well above the number of clients a single instance realistically holds.
const MAX_TRACKED_CALLERS = 20_000;

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

  return (req, res, next) => {
    const key = `${options.name}:${callerKey(req)}`;
    const now = Date.now();
    const existing = windows.get(key);

    if (!existing || now - existing.windowStart >= options.windowMs) {
      if (windows.size >= MAX_TRACKED_CALLERS) windows.clear();
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
