import './server/loadEnv'; // must stay the FIRST import — fills process.env from .env in dev
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDB, flushPendingGcsBackup } from './server/db';
import authRouter, { orgRouter } from './server/routes/auth';
import syncRouter, { MAX_SYNC_BODY_BYTES, syncBodyLimitErrorHandler } from './server/routes/sync';
import integrationsRouter from './server/routes/integrations';
import attachmentsRouter from './server/routes/attachments';
import commandsRouter from './server/routes/commands';
import exchangeRatesRouter from './server/routes/exchangeRates';
import telemetryRouter from './server/routes/telemetry';
import adminRouter, { seedTestUserHandler } from './server/routes/admin';
import winemakerRouter from './server/routes/winemaker';
import aiRouter from './server/routes/ai';
import billingRouter from './server/routes/billing';
import terroirPulseRouter from './server/routes/terroirPulse';
import notificationsRouter, { whatsappWebhookRouter } from './server/routes/notifications';
import aiOperationsAdminRouter from './server/routes/aiOperationsAdmin';
import { securityHeaders } from './server/middleware/securityHeaders';
import { warnOnAppUrlMismatch } from './server/appUrlMismatch';
import { demoAccountConfig } from './server/config';
import { getServiceReadiness } from './server/readiness';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by'); // Don't advertise the framework/version.
// Behind exactly one reverse proxy (Fly.io / Cloud Run). Trust ONE hop so
// req.ip resolves to the real client and X-Forwarded-* is honoured for cookie
// Secure / OAuth redirects — but a client-supplied X-Forwarded-For cannot be
// spoofed to forge a fresh identity (which would defeat the login limiter).
// If the platform adds more proxy hops, raise this to match the hop count.
app.set('trust proxy', 1);
// Surfaces a mapped custom domain that APP_URL has not caught up with. That
// combination breaks OAuth sign-in and every emailed link while looking
// completely healthy, so the server says so once per host.
app.use(warnOnAppUrlMismatch({ isProduction: process.env.NODE_ENV === 'production' }));
app.use(securityHeaders());
// Meta signs the exact webhook bytes. Mount this narrow raw-body route before
// the general JSON parser so signature verification cannot be affected by
// parsing, whitespace, or key-order normalization.
app.use(
  '/api/notifications/whatsapp/webhook',
  express.raw({ type: 'application/json', limit: '256kb' }),
  whatsappWebhookRouter,
);
// Whole-state sync is the largest body this service accepts. Mount its parser
// (and the matching error handler) before the general one so an over-limit
// payload answers with a structured, actionable 413 instead of the parser's
// default HTML error page. Body-parser marks the request once parsed, so the
// general parser below is a no-op for these requests.
app.use('/api/sync', express.json({ limit: MAX_SYNC_BODY_BYTES }), syncBodyLimitErrorHandler);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Browser-release fixtures are available only in an explicitly isolated,
// non-production process. The module is not even loaded by production.
if (process.env.NODE_ENV !== 'production' && process.env.E2E_TEST_MODE === 'true') {
  const { default: e2eFixturesRouter } = await import('./server/e2eFixtures');
  app.use('/api/e2e', e2eFixturesRouter);
}

// Mount routes
app.use('/api/auth', authRouter);
app.use('/api/org', orgRouter);
app.use('/api', syncRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/commands', commandsRouter);
app.use('/api/finance', exchangeRatesRouter);
app.use('/api/telemetry', telemetryRouter);
app.use('/api/admin/ai-operations', aiOperationsAdminRouter);
app.use('/api/admin', adminRouter);
app.use('/api/gemini', winemakerRouter);
app.use('/api/ai', aiRouter);
app.use('/api/billing', billingRouter);
app.use('/api/terroir-pulse', terroirPulseRouter);
app.use('/api/notifications', notificationsRouter);

// Dev seeder endpoint
app.get('/api/dev/seed-testuser1', seedTestUserHandler);

// Public liveness probe — intentionally minimal (no config/infra details).
app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

// Readiness is deliberately stricter than liveness: an instance can stay
// alive for diagnostics while Cloud Run stops routing writes to an unavailable
// or schema-incomplete database. Optional integrations never fail readiness.
app.get('/api/ready', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const readiness = await getServiceReadiness();
    res.status(readiness.ok ? 200 : 503).json(readiness);
  } catch {
    res.status(503).json({
      ok: false,
      checkedAt: new Date().toISOString(),
      database: {
        status: 'not_ready',
        backend: 'local_json',
        schemaReady: false,
        failureClass: 'database_unavailable_or_schema_mismatch',
      },
      optionalIntegrations: {
        status: 'degraded',
        storageBackup: 'degraded',
        aiAssistant: 'degraded',
        email: 'degraded',
        googleOAuth: 'degraded',
        whatsapp: 'degraded',
      },
    });
  }
});

// Public config endpoint for frontend hydration
app.get('/api/config', (_req, res) => {
  res.json({
    demoLoginEnabled: demoAccountConfig.enabled
  });
});

// Unknown API routes must stay API responses. Letting them fall through to the
// SPA would turn a missing endpoint into a misleading 200 HTML response.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});


// Serve frontend
const isProd = process.env.NODE_ENV === 'production';
const server = http.createServer(app);

if (isProd) {
  const distPath = path.resolve(__dirname, 'dist');
  const indexPath = path.resolve(distPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error('Production frontend build is missing. Run `npm run build` before starting the server.');
  }

  // Serve production build static files
  app.use(express.static(distPath, {
    index: false, // Do not serve index.html with aggressive caching
    setHeaders: (res, filePath) => {
      const relative = path.relative(distPath, filePath).replace(/\\/g, '/');
      if (relative.startsWith('assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        // Service workers, manifests, and root icons keep stable URLs and must
        // revalidate so a new deployment can take control promptly.
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  // SPA fallback. Express 5 (path-to-regexp v8) rejects the bare '*' string
  // pattern, so use a RegExp catch-all for all non-API GET requests.
  app.get(/.*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
} else {
  // In development, load Vite middleware dynamically to provide live reload on same port!
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      ws: { server }
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

const PORT = parseInt(process.env.PORT || '3000', 10);

// Hydrate the database from durable storage (GCS) before accepting traffic.
if (process.env.VITEST !== 'true') {
  initDB()
    .then(() => {
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is running in ${isProd ? 'production' : 'development'} on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('[db] initialisation failed; server was not started:', err);
      process.exitCode = 1;
    });

  // Cloud Run sends SIGTERM with a 10s grace period before reaping an idle
  // instance. CPU is throttled between requests, so a debounced GCS backup may
  // still be pending — this is the last guaranteed chance to persist it.
  let shuttingDown = false;
  const flushAndExit = (reason: string, exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${reason}, flushing pending backup before exit...`);
    server.close();
    const timeout = setTimeout(() => {
      console.error('[server] shutdown flush timed out, exiting.');
      process.exit(1);
    }, 8000);
    flushPendingGcsBackup()
      .then(() => {
        console.log('[server] shutdown flush complete.');
        clearTimeout(timeout);
        process.exit(exitCode);
      })
      .catch((err) => {
        console.error('[server] shutdown flush failed:', err);
        clearTimeout(timeout);
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => flushAndExit('SIGTERM received', 0));
  process.on('SIGINT', () => flushAndExit('SIGINT received', 0));

  // A crash never reaches the signal handlers above: Node's default for an
  // uncaught exception or rejection is to print and exit, which would discard
  // every write buffered since the last GCS upload. Express only catches throws
  // inside route handlers — timers and background promises land here instead.
  // The process state is undefined once this fires, so we always exit rather
  // than resume; the flush is a best-effort push of already-serialized bytes.
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaught exception:', err);
    flushAndExit('uncaught exception', 1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled rejection:', reason);
    flushAndExit('unhandled rejection', 1);
  });
}

// Re-export for test compatibility
export { getHistoricalContext } from './server/routes/winemaker';
