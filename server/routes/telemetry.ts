import express from 'express';
import { liveSessionRole, parseCookies, requireMasterAdmin } from '../middleware/auth';
import { verifySessionToken } from '../auth';
import { getUserData, createEmptyUserData } from '../db';
import {
  recordClientPerformanceMetric,
  type ClientPerformanceMetric,
} from '../operationalTelemetry';

const router = express.Router();

interface TelemetryReading {
  lotId: string;
  tankId: string;
  timestamp: string;
  density: number; // Specific Gravity (SG)
  temperature: number; // °C
  ph: number;
  dissolvedOxygen: number; // mg/L
  dailySlope: number; // SG drop per day
  status: 'active' | 'slow' | 'stuck' | 'finished';
}

const simulatedTelemetry: Record<string, Record<string, TelemetryReading>> = {};

// ── Client error telemetry ─────────────────────────────────────────────────
// In-memory ring buffer of the most recent client-side crashes (ErrorBoundary
// renders, lazy-chunk give-ups). Diagnostic data only — deliberately not
// persisted: it resets on instance recycle, which is fine for "what broke
// recently" and avoids growing the durable store from a public endpoint.

export interface ClientErrorReport {
  at: string;
  source: string;   // 'render-error' | 'chunk-load' | ...
  message: string;
  stack: string;
  url: string;
  userAgent: string;
  appVersion: string;
  username: string | null;
}

const MAX_CLIENT_ERRORS = 100;
const clientErrors: ClientErrorReport[] = [];
// Public endpoint → aggressive per-IP throttle so it cannot be used to spam.
const clientErrorHits = new Map<string, { count: number; windowStart: number }>();
const CLIENT_ERROR_WINDOW_MS = 60_000;
const CLIENT_ERROR_MAX_PER_WINDOW = 5;
const performanceHits = new Map<string, { count: number; windowStart: number }>();
const PERFORMANCE_MAX_PER_WINDOW = 12;
const cspReportHits = new Map<string, { count: number; windowStart: number }>();
const CSP_REPORT_MAX_PER_WINDOW = 20;
/** Bounds each throttle map so an IP flood cannot become a memory leak. */
const THROTTLE_MAX_TRACKED_IPS = 1_000;

/**
 * Per-IP window for the public telemetry endpoints. Returns true when the
 * caller is over its ceiling for this window.
 *
 * Expired entries are swept rather than the map being cleared wholesale. The
 * previous `clear()` reset every tracked IP at once, so ordinary traffic from
 * unrelated clients could hand a spamming IP a fresh allowance — the throttle
 * was weakest exactly when the endpoint was busiest.
 *
 * These windows are per instance. Running N instances permits N × the ceiling
 * per IP, which is accepted for the same reason as `requestCeiling`: these are
 * spam guards on endpoints whose stored output is separately bounded, not
 * security limits. See `server/middleware/requestCeiling.ts` for the decision.
 */
function overThrottle(
  hits: Map<string, { count: number; windowStart: number }>,
  ip: string,
  maxPerWindow: number,
  now: number = Date.now(),
): boolean {
  const hit = hits.get(ip);
  if (hit && now - hit.windowStart <= CLIENT_ERROR_WINDOW_MS) {
    return ++hit.count > maxPerWindow;
  }

  if (!hit && hits.size >= THROTTLE_MAX_TRACKED_IPS) {
    for (const [key, tracked] of hits) {
      if (now - tracked.windowStart > CLIENT_ERROR_WINDOW_MS) hits.delete(key);
    }
    if (hits.size >= THROTTLE_MAX_TRACKED_IPS) {
      let oldestKey: string | null = null;
      let oldestStart = Infinity;
      for (const [key, tracked] of hits) {
        if (tracked.windowStart < oldestStart) {
          oldestStart = tracked.windowStart;
          oldestKey = key;
        }
      }
      if (oldestKey !== null) hits.delete(oldestKey);
    }
  }

  hits.set(ip, { count: 1, windowStart: now });
  return false;
}

const clip = (v: unknown, max: number) => String(v ?? '').slice(0, max);
const safeRoute = (value: unknown): string => {
  const raw = clip(value, 300);
  try {
    const pathname = new URL(raw, 'https://telemetry.invalid').pathname;
    const firstSegment = pathname.split('/').filter(Boolean)[0];
    return firstSegment ? `/${firstSegment.slice(0, 80)}` : '/';
  } catch {
    return '';
  }
};

export function getRecentClientErrors(): ClientErrorReport[] {
  return [...clientErrors].reverse(); // newest first
}

router.post('/client-error', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  if (overThrottle(clientErrorHits, ip, CLIENT_ERROR_MAX_PER_WINDOW, now)) {
    return res.status(429).json({ ok: false });
  }

  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies['maranios_session']);

  clientErrors.push({
    at: new Date().toISOString(),
    source: clip(req.body?.source, 40) || 'unknown',
    message: clip(req.body?.message, 500),
    stack: clip(req.body?.stack, 4000),
    url: safeRoute(req.body?.url),
    userAgent: clip(req.headers['user-agent'], 200),
    appVersion: clip(req.body?.appVersion, 40),
    username: session?.username ? String(session.username) : null,
  });
  if (clientErrors.length > MAX_CLIENT_ERRORS) clientErrors.shift();

  res.status(204).end();
});

// ── CSP violation intake ───────────────────────────────────────────────────
// The Content-Security-Policy ships in Report-Only mode; without a collector
// the browser evaluates it and throws the result away, so promoting it to
// enforcing would be a guess. Violations are **aggregated by directive +
// blocked URI** rather than stored individually: a single broken page emits one
// report per occurrence, which would flood a flat ring buffer and hide the long
// tail. What matters for the promotion decision is the distinct set of things
// the policy would block, and how often each fires.

export interface CspViolationGroup {
  directive: string;
  blockedUri: string;
  documentPath: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

const MAX_CSP_GROUPS = 200;
const cspViolations = new Map<string, CspViolationGroup>();

export function getCspViolations(): CspViolationGroup[] {
  return [...cspViolations.values()].sort((a, b) => b.count - a.count);
}

/** Test seam — the aggregate outlives a request, so suites must reset it. */
export function resetCspViolations(): void {
  cspViolations.clear();
  cspReportHits.clear();
}

/**
 * Strip a blocked URI down to scheme://host. The full URL can embed tenant data
 * (signed attachment links, query strings), and the origin is all that is
 * needed to decide which CSP source expression to add.
 */
function safeBlockedUri(value: unknown): string {
  const raw = clip(value, 300);
  if (!raw) return '';
  // CSP keywords, reported verbatim by browsers instead of a URL.
  if (['inline', 'eval', 'self', 'data', 'blob', 'about', 'wasm-eval'].includes(raw)) return raw;
  try {
    return new URL(raw).origin;
  } catch {
    return clip(raw.split(/[?#]/)[0], 120);
  }
}

function recordCspViolation(directive: unknown, blockedUri: unknown, documentUri: unknown): void {
  const cleanDirective = clip(directive, 60);
  if (!cleanDirective) return;
  const cleanBlocked = safeBlockedUri(blockedUri);
  const key = `${cleanDirective}|${cleanBlocked}`;
  const now = new Date().toISOString();

  const existing = cspViolations.get(key);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = now;
    return;
  }
  // Bounded: once full, stop admitting new groups rather than evicting — the
  // established groups carry the counts that inform the promotion decision.
  if (cspViolations.size >= MAX_CSP_GROUPS) return;
  cspViolations.set(key, {
    directive: cleanDirective,
    blockedUri: cleanBlocked,
    documentPath: safeRoute(documentUri),
    count: 1,
    firstSeen: now,
    lastSeen: now,
  });
}

// Browsers post violation reports as `application/csp-report` (report-uri) or
// `application/reports+json` (the newer Reporting API). Neither content type is
// handled by the global `express.json()`, so this route parses its own body.
const cspReportParser = express.json({
  type: ['application/csp-report', 'application/reports+json', 'application/json'],
  limit: '32kb',
});

router.post('/csp-report', cspReportParser, (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  if (overThrottle(cspReportHits, ip, CSP_REPORT_MAX_PER_WINDOW, now)) {
    return res.status(429).json({ ok: false });
  }

  const body = req.body;
  if (Array.isArray(body)) {
    // Reporting API: a batch of typed reports, only some of them CSP.
    for (const report of body.slice(0, 20)) {
      if (!report || typeof report !== 'object' || report.type !== 'csp-violation') continue;
      const inner = report.body ?? {};
      recordCspViolation(inner.effectiveDirective, inner.blockedURL, inner.documentURL);
    }
  } else if (body && typeof body === 'object') {
    // Legacy report-uri: a single { "csp-report": { ... } } envelope.
    const inner = body['csp-report'];
    if (inner && typeof inner === 'object') {
      recordCspViolation(
        inner['effective-directive'] || inner['violated-directive'],
        inner['blocked-uri'],
        inner['document-uri'],
      );
    }
  }

  res.status(204).end();
});

// Read side for the CSP rollout: what would enforcing actually break?
router.get('/csp-violations', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ groups: getCspViolations() });
});

const performanceNames = new Set(['LCP', 'INP', 'CLS', 'route_load', 'offline_start']);
const performanceRatings = new Set(['good', 'needs_improvement', 'poor']);
const deviceClasses = new Set(['mobile', 'tablet', 'desktop']);
const networkClasses = new Set(['offline', 'slow', 'standard', 'unknown']);
const routeClasses = new Set(['landing', 'auth', 'tasks', 'billing', 'public', 'workspace']);

// Public, payload-free browser performance intake. It accepts only bounded
// numbers and fixed categorical values; URLs, tenant IDs, record IDs, and free
// text are neither accepted nor retained.
router.post('/performance', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  if (overThrottle(performanceHits, ip, PERFORMANCE_MAX_PER_WINDOW, now)) {
    return res.status(429).json({ ok: false });
  }

  const metrics = Array.isArray(req.body?.metrics) ? req.body.metrics.slice(0, 8) : [];
  for (const metric of metrics) {
    if (!metric || typeof metric !== 'object') continue;
    const value = Number(metric.value);
    if (
      !performanceNames.has(metric.name)
      || !Number.isFinite(value)
      || value < 0
      || !performanceRatings.has(metric.rating)
      || !deviceClasses.has(metric.deviceClass)
      || !networkClasses.has(metric.networkClass)
      || !routeClasses.has(metric.routeClass)
    ) continue;
    recordClientPerformanceMetric({
      name: metric.name,
      value,
      rating: metric.rating,
      deviceClass: metric.deviceClass,
      networkClass: metric.networkClass,
      routeClass: metric.routeClass,
    } as Omit<ClientPerformanceMetric, 'at'>);
  }

  res.status(204).end();
});

function initTelemetry(username: string, userDb: any) {
  const fermentingLots = userDb.lots.filter((l: any) => l.stage === 'fermenting');
  if (!simulatedTelemetry[username]) {
    simulatedTelemetry[username] = {};
  }
  const userSimulated = simulatedTelemetry[username];
  const newTelemetry: Record<string, TelemetryReading> = {};

  for (const lot of fermentingLots) {
    const vessel = userDb.vessels.find((v: any) => v.assignedLotId === lot.id);
    if (!vessel) continue;

    if (userSimulated[lot.id]) {
      newTelemetry[lot.id] = userSimulated[lot.id];
      newTelemetry[lot.id].tankId = vessel.id;
    } else {
      const isStuck = lot.name.toLowerCase().includes('stuck') || lot.id.toLowerCase().includes('stuck');
      newTelemetry[lot.id] = {
        lotId: lot.id,
        tankId: vessel.id,
        timestamp: new Date().toISOString(),
        density: isStuck ? 1.024 : 1.012,
        temperature: isStuck ? 15.5 : 21.8,
        ph: 3.5,
        dissolvedOxygen: isStuck ? 0.04 : 0.35,
        dailySlope: isStuck ? 0.0008 : 0.012,
        status: isStuck ? 'stuck' : 'active'
      };
    }
  }
  simulatedTelemetry[username] = newTelemetry;
}

// GET /api/telemetry/active
router.get('/active', async (req, res) => {
  const session = await liveSessionRole(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const userDb = await getUserData(session.username) || createEmptyUserData();

  initTelemetry(session.username, userDb);

  const userSimulated = simulatedTelemetry[session.username] || {};
  Object.keys(userSimulated).forEach((lotId) => {
    const t = userSimulated[lotId];
    t.timestamp = new Date().toISOString();

    if (t.status === 'stuck') {
      t.density = parseFloat((t.density - 0.00005 + (Math.random() - 0.5) * 0.0001).toFixed(4));
      t.temperature = parseFloat((15.5 + (Math.random() - 0.5) * 0.3).toFixed(1));
      t.dailySlope = 0.0008;
    } else if (t.status === 'active') {
      t.density = parseFloat((t.density - 0.0012 + (Math.random() - 0.5) * 0.0002).toFixed(4));
      t.temperature = parseFloat((21.8 + (Math.random() - 0.5) * 0.5).toFixed(1));
      t.dailySlope = 0.012;
      if (t.density <= 0.992) {
        t.density = 0.992;
        t.status = 'finished';
        t.dailySlope = 0;
      }
    }
  });

  res.json(Object.values(userSimulated));
});

export default router;
