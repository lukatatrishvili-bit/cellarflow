import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');

beforeAll(async () => {
  vi.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-demo-login-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'demo-login-route-test-secret-32-bytes',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(root, 'db.json'),
    GCS_BUCKET: '',
    DEMO_LOGIN_ENABLED: 'true',
    DEMO_USERNAME: 'demo',
  };

  const routes = await import('../server/routes/auth');
  dbModule = await import('../server/db');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', routes.default);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  const db = dbModule.getDB();
  db.users = [{
    username: 'demo',
    email: 'demo@example.test',
    fullName: 'Demo Winemaker',
    role: 'Winemaker',
    language: 'en',
    passwordHash: 'unused',
    activeOrganizationId: 'org-demo',
    accountEnabled: true,
    sessionVersion: 1,
  }];
  db.organizations = [{ id: 'org-demo', name: 'Demo Estate' }];
  db.memberships = [{ id: 'membership-demo', userId: 'demo', organizationId: 'org-demo', role: 'Owner/Admin' }];
  db.invitations = [];
  db.orgData = { org_demo: dbModule.createEmptyUserData(), 'org-demo': dbModule.createEmptyUserData() };
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe.sequential('demo login route', () => {
  it('returns the active membership role instead of stale personal-role authority', async () => {
    const response = await fetch(`${baseUrl}/api/auth/demo`, { method: 'POST' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ username: 'demo', role: 'Owner/Admin', isDemo: true });
    expect(response.headers.get('set-cookie')).toContain('maranios_session=');
  });
});
