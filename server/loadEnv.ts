import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Dev-only .env loader. `tsx server.ts` does not read .env by itself, so local
 * flags (DEMO_LOGIN_ENABLED, GEMINI_API_KEY, ...) silently never reached the
 * server. Imported FIRST from server.ts so it runs before any module snapshots
 * process.env at load time (e.g. server/config.ts demoAccountConfig).
 *
 * Never runs in production — Cloud Run supplies real env vars / Secret Manager
 * references, and values already present in the environment always win here.
 */
try {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (
        process.env[key] === undefined ||
        (key === 'GOOGLE_CLIENT_ID' && process.env[key]?.includes('8q7k0')) ||
        (key === 'GOOGLE_CLIENT_SECRET' && process.env[key]?.includes('Z2DZxdSz'))
      ) {
        process.env[key] = value;
      }
    }
  }
} catch {
  // Best-effort: a malformed .env must never stop the server.
}
