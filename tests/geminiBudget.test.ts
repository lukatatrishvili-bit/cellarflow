import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/gemini` is the interactive Copilot and the highest-volume model caller,
 * but it was the only one that never reserved against the organization's daily
 * budget — a single authenticated account could spend the Gemini quota without
 * limit. These lock the ceiling in place.
 */

const originalEnv = { ...process.env };
const generateContent = vi.fn(async () => ({ text: 'A tidy answer about malolactic fermentation.' }));

let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');
let budgetModule: typeof import('../server/aiModelBudget');

function seedOrg(maxModelCallsPerDay: number) {
  const db = dbModule.getDB();
  db.users = [];
  db.organizations = [];
  db.memberships = [];
  db.orgData = {};

  const user: any = {
    username: 'copilot-user',
    email: 'copilot@example.com',
    role: 'Winemaker',
    activeOrganizationId: 'org-ai',
    accountEnabled: true,
    sessionVersion: 1,
  };
  db.users.push(user);
  db.organizations.push({ id: 'org-ai', name: 'Copilot Winery' });
  db.memberships.push({ id: 'mem-ai', userId: user.username, organizationId: 'org-ai', role: 'Winemaker' });
  db.orgData['org-ai'] = { companyProfile: { aiConfig: { maxModelCallsPerDay } } } as any;

  return `maranios_session=${authModule.createSessionToken(
    authModule.sessionPayloadForUser(user, 'Winemaker'),
  )}`;
}

const ask = (cookie: string) => fetch(`${baseUrl}/api/gemini`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ prompt: 'Why is my fermentation stuck?' }),
});

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('@google/genai', () => ({
    GoogleGenAI: class {
      models = { generateContent, generateContentStream: vi.fn() };
    },
  }));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-gemini-budget-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'production',
    SESSION_SECRET: 'gemini-budget-test-secret-32-bytes',
    GEMINI_API_KEY: 'test-key',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(root, 'db.json'),
    GCS_BUCKET: '',
  };

  const routes = await import('../server/routes/winemaker');
  dbModule = await import('../server/db');
  authModule = await import('../server/auth');
  budgetModule = await import('../server/aiModelBudget');

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/gemini', routes.default);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  process.env = { ...originalEnv };
  vi.doUnmock('@google/genai');
  vi.resetModules();
});

beforeEach(() => {
  budgetModule.__resetInMemoryAiModelBudget();
  generateContent.mockClear();
});

describe.sequential('gemini copilot budget', () => {
  it('answers while the organization has allowance left', async () => {
    const cookie = seedOrg(3);
    const res = await ask(cookie);

    expect(res.status).toBe(200);
    expect((await res.json()).text).toContain('malolactic');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('refuses once the daily allowance is spent, without calling the model', async () => {
    const cookie = seedOrg(2);

    expect((await ask(cookie)).status).toBe(200);
    expect((await ask(cookie)).status).toBe(200);

    const blocked = await ask(cookie);
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe('ai_budget_exhausted');
    expect(body.budget).toEqual({ used: 2, remaining: 0 });

    // The point of reserving before the call: no spend on the rejected request.
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('reserves before the model call so the ceiling holds under concurrency', async () => {
    const cookie = seedOrg(3);
    const results = await Promise.all([ask(cookie), ask(cookie), ask(cookie), ask(cookie), ask(cookie)]);

    const answered = results.filter(r => r.status === 200).length;
    const refused = results.filter(r => r.status === 429).length;
    expect(answered).toBe(3);
    expect(refused).toBe(2);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('spends nothing when the caller has no active organization', async () => {
    const cookie = seedOrg(5);
    dbModule.getDB().users[0].activeOrganizationId = undefined;

    expect((await ask(cookie)).status).toBe(400);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('still rejects an unauthenticated caller before any budget work', async () => {
    seedOrg(5);
    const res = await fetch(`${baseUrl}/api/gemini`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });

    expect(res.status).toBe(401);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
