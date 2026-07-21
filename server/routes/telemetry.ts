import express from 'express';
import { liveSessionRole, parseCookies } from '../middleware/auth';
import { verifySessionToken } from '../auth';
import { getUserData, createEmptyUserData } from '../db';

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

const clip = (v: unknown, max: number) => String(v ?? '').slice(0, max);

export function getRecentClientErrors(): ClientErrorReport[] {
  return [...clientErrors].reverse(); // newest first
}

router.post('/client-error', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const hit = clientErrorHits.get(ip);
  if (!hit || now - hit.windowStart > CLIENT_ERROR_WINDOW_MS) {
    clientErrorHits.set(ip, { count: 1, windowStart: now });
  } else if (++hit.count > CLIENT_ERROR_MAX_PER_WINDOW) {
    return res.status(429).json({ ok: false });
  }
  if (clientErrorHits.size > 1000) clientErrorHits.clear(); // cheap leak guard

  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies['maranios_session']);

  clientErrors.push({
    at: new Date().toISOString(),
    source: clip(req.body?.source, 40) || 'unknown',
    message: clip(req.body?.message, 500),
    stack: clip(req.body?.stack, 4000),
    url: clip(req.body?.url, 300),
    userAgent: clip(req.headers['user-agent'], 200),
    appVersion: clip(req.body?.appVersion, 40),
    username: session?.username ? String(session.username) : null,
  });
  if (clientErrors.length > MAX_CLIENT_ERRORS) clientErrors.shift();

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
