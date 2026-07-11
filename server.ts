import './server/loadEnv'; // must stay the FIRST import — fills process.env from .env in dev
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDB, flushPendingGcsBackup } from './server/db';
import authRouter, { orgRouter } from './server/routes/auth';
import syncRouter from './server/routes/sync';
import integrationsRouter from './server/routes/integrations';
import attachmentsRouter from './server/routes/attachments';
import telemetryRouter from './server/routes/telemetry';
import adminRouter, { seedTestUserHandler } from './server/routes/admin';
import winemakerRouter from './server/routes/winemaker';
import { securityHeaders } from './server/middleware/securityHeaders';
import { demoAccountConfig } from './server/config';


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
app.use(securityHeaders());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Mount routes
app.use('/api/auth', authRouter);
app.use('/api/org', orgRouter);
app.use('/api', syncRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/telemetry', telemetryRouter);
app.use('/api/admin', adminRouter);
app.use('/api/gemini', winemakerRouter);

// Dev seeder endpoint
app.get('/api/dev/seed-testuser1', seedTestUserHandler);

// Public liveness probe — intentionally minimal (no config/infra details).
app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

// Public config endpoint for frontend hydration
app.get('/api/config', (_req, res) => {
  res.json({
    demoLoginEnabled: demoAccountConfig.enabled
  });
});


// Serve frontend
const isProd = process.env.NODE_ENV === 'production';
const server = http.createServer(app);

if (isProd) {
  // Serve production build static files
  app.use(express.static(path.resolve(__dirname, 'dist'), {
    maxAge: '1y',
    immutable: true,
    index: false // Do not serve index.html with aggressive caching
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
      hmr: { server }
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

const PORT = parseInt(process.env.PORT || '3000', 10);

// Hydrate the database from durable storage (GCS) before accepting traffic.
if (process.env.VITEST !== 'true') {
  initDB()
    .catch((err) => console.error('[db] initialisation failed, continuing with local state:', err))
    .finally(() => {
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is running in ${isProd ? 'production' : 'development'} on http://0.0.0.0:${PORT}`);
      });
    });

  // Cloud Run sends SIGTERM with a 10s grace period before reaping an idle
  // instance. CPU is throttled between requests, so a debounced GCS backup may
  // still be pending — this is the last guaranteed chance to persist it.
  let shuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, flushing pending backup before exit...`);
    server.close();
    const timeout = setTimeout(() => {
      console.error('[server] shutdown flush timed out, exiting.');
      process.exit(1);
    }, 8000);
    flushPendingGcsBackup()
      .then(() => {
        console.log('[server] shutdown flush complete.');
        clearTimeout(timeout);
        process.exit(0);
      })
      .catch((err) => {
        console.error('[server] shutdown flush failed:', err);
        clearTimeout(timeout);
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Re-export for test compatibility
export { getHistoricalContext } from './server/routes/winemaker';
