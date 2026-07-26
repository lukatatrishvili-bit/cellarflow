import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { readDemoAccountConfig } from './demoAccount';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const GEMINI_MODEL = "gemini-2.5-flash";
export const COOKIE_SECURE = process.env.NODE_ENV === 'production';
export const demoAccountConfig = readDemoAccountConfig();

export function cleanEnv(val: string | undefined): string {
  if (!val) return '';
  return val.replace(/^\uFEFF/, '').trim();
}

export function getGoogleOAuthCreds(db: any): { clientId: string; clientSecret: string } {
  const envClientId = cleanEnv(process.env.GOOGLE_CLIENT_ID);
  const envClientSecret = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
  const dbClientId = cleanEnv(db?.googleConfig?.clientId);
  const dbClientSecret = cleanEnv(db?.googleConfig?.clientSecret);

  const clientId = envClientId || dbClientId;
  const clientSecret = envClientSecret || dbClientSecret;

  if (db && db.googleConfig && envClientId && envClientSecret) {
    db.googleConfig.clientId = clientId;
    db.googleConfig.clientSecret = clientSecret;
  }

  return { clientId, clientSecret };
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
