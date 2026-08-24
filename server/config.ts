import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { readDemoAccountConfig } from './demoAccount';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Default generative model. Every surface used this one constant: the query
 * planner, the answer explainer, invoice extraction, the copilot, and a
 * multi-specialist diagnostic pass alike.
 */
export const GEMINI_MODEL = (process.env.AI_MODEL || '').trim() || "gemini-2.5-flash";

/**
 * Deep analysis is the rarest call the layer makes — several specialists on one
 * situation, gated behind severity, finding type and a cooldown — and the one
 * where interpretation quality is the entire product. It gets a stronger model;
 * the daily budget still caps how many of them a winery can buy.
 */
export const GEMINI_DEEP_MODEL = (process.env.AI_MODEL_DEEP || '').trim() || "gemini-2.5-pro";

/**
 * Choosing a query kind from a fixed list is a classification task, not a
 * reasoning one. Split out so an operator can point it at a cheaper model
 * without touching anything that writes prose for a winemaker.
 */
export const GEMINI_PLANNER_MODEL = (process.env.AI_MODEL_PLANNER || '').trim() || GEMINI_MODEL;

export type AiModelSlot = 'default' | 'deep' | 'planner';

export function aiModelFor(slot: AiModelSlot): string {
  if (slot === 'deep') return GEMINI_DEEP_MODEL;
  if (slot === 'planner') return GEMINI_PLANNER_MODEL;
  return GEMINI_MODEL;
}
export const COOKIE_SECURE = process.env.NODE_ENV === 'production';
export const demoAccountConfig = readDemoAccountConfig();

export function cleanEnv(val: string | undefined): string {
  if (!val) return '';
  return val.replace(/^\uFEFF/, '').trim();
}

/**
 * Google OAuth credentials, resolved as a pair: environment (Secret Manager /
 * Cloud Run / .env) first, runtime `db.googleConfig` only as a fallback. The
 * pair is never mixed — an ID from one client with a secret from another fails
 * the token exchange in a way that is very hard to read from the outside.
 *
 * Never hardcode a client here. A credential baked into the source outlives the
 * client itself: once it is deleted in Cloud Console every deployment keeps
 * redirecting to it and users land on Google's "Error 401: deleted_client"
 * page instead of this app's OAuth setup screen.
 */
export function getGoogleOAuthCreds(db: any): { clientId: string; clientSecret: string } {
  const envId = cleanEnv(process.env.GOOGLE_CLIENT_ID);
  const envSecret = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret };

  const dbId = cleanEnv(db?.googleConfig?.clientId);
  const dbSecret = cleanEnv(db?.googleConfig?.clientSecret);
  if (dbId && dbSecret) return { clientId: dbId, clientSecret: dbSecret };

  // Partial config: report what is set so the caller shows the setup screen.
  return { clientId: envId || dbId, clientSecret: envSecret || dbSecret };
}

export function updateEnvFile(updates: Record<string, string>) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('Refusing to update .env at runtime in production. Use Secret Manager or Cloud Run environment variables instead.');
    return;
  }
  try {
    const envPath = path.resolve(__dirname, '../.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    const lines = envContent.split('\n');
    const newLines: string[] = [];
    const keysHandled = new Set<string>();

    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const firstEqual = trimmed.indexOf('=');
        if (firstEqual !== -1) {
          const key = trimmed.slice(0, firstEqual).trim();
          if (updates[key] !== undefined) {
            newLines.push(`${key}="${updates[key]}"`);
            keysHandled.add(key);
            return;
          }
        }
      }
      newLines.push(line);
    });

    // Add keys not present in original file
    Object.keys(updates).forEach(key => {
      if (!keysHandled.has(key)) {
        newLines.push(`${key}="${updates[key]}"`);
      }
    });

    fs.writeFileSync(envPath, newLines.join('\n'), 'utf8');

    // Update process.env immediately
    Object.keys(updates).forEach(key => {
      process.env[key] = updates[key];
    });
  } catch (err) {
    console.error("Failed to update .env file manually:", err);
  }
}

export function appBaseUrl(req: express.Request): string {
  const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

export function clientIp(req: any): string {
  // With `trust proxy` set to the real hop count, Express computes req.ip as the
  // right-most untrusted address, so a spoofed X-Forwarded-For header cannot be
  // used to mint a fresh rate-limit identity. Do NOT read the raw header here.
  if (typeof req.ip === 'string' && req.ip.length) return req.ip;
  return req.socket?.remoteAddress || 'unknown';
}
