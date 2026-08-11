import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Session tokens are stateless HMAC blobs, so clearing the cookie only removes
 * the browser's copy. These cover negative-test class 4 in `security_spec.md`:
 * a token captured before logout must not survive it.
 */

const originalEnv = { ...process.env };
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');

function seedUser(username = 'cellar-hand') {
  const db = dbModule.getDB();
  db.users = [];
  db.organizations = [];
  db.memberships = [];
  db.orgData = {};

  const user: any = {
    username,
    email: `${username}@example.com`,
    fullName: 'Cellar Hand',
    role: 'Winemaker',
    language: 'en',
    activeOrganizationId: 'org-logout',
    accountEnabled: true,
    sessionVersion: 1,
  };
  db.users.push(user);
  db.organizations.push({ id: 'org-logout', name: 'Logout Winery' });
  db.memberships.push({
    id: 'mem-logout', userId: username, organizationId: 'org-logout', role: 'Winemaker',
  });
  return user;
}

const me = (cookie: string) => fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
const logout = (cookie: string) => fetch(`${baseUrl}/api/auth/logout`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
});

beforeAll(async () => {
  vi.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-logout-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'production',
    SESSION_SECRET: 'logout-revocation-test-secret-32-bytes',
    ADMIN_USERNAME: 'master',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(root, 'db.json'),
    GCS_BUCKET: '',
  };

  const routes = await import('../server/routes/auth');
  dbModule = await import('../server/db');
  authModule = await import('../server/auth');

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/auth', routes.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe.sequential('logout revocation', () => {
  it('kills a token that was captured before logout', async () => {
    const user = seedUser();
    const token = authModule.createSessionToken(
      authModule.sessionPayloadForUser(user, 'Winemaker'),
    );
    const cookie = `maranios_session=${token}`;

    expect((await me(cookie)).status).toBe(200);

    const out = await logout(cookie);
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');

    // The attacker's copy of the very same token, replayed after logout.
    expect((await me(cookie)).status).toBe(401);
  });

  it('advances the stored session version so every device is signed out', async () => {
    const user = seedUser('multi-device');
    const phone = `maranios_session=${authModule.createSessionToken(authModule.sessionPayloadForUser(user, 'Winemaker'))}`;
    const tablet = `maranios_session=${authModule.createSessionToken(authModule.sessionPayloadForUser(user, 'Winemaker'))}`;

    expect((await me(tablet)).status).toBe(200);
    await logout(phone);

    // Revocation is account-wide: the version is per-user, not per-session.
    expect((await me(tablet)).status).toBe(401);
    expect(dbModule.getDB().users.find(u => u.username === 'multi-device')?.sessionVersion).toBe(2);
  });

  it('still clears the cookie when there is no valid session to revoke', async () => {
    seedUser('bystander');
    const res = await logout('maranios_session=not-a-real-token');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    // A forged or expired token must not disturb a real account's version.
    expect(dbModule.getDB().users.find(u => u.username === 'bystander')?.sessionVersion).toBe(1);
  });

  it('signs out the env master admin even though it has no stored version', async () => {
    seedUser();
    const cookie = `maranios_session=${authModule.createSessionToken({ username: 'master', role: 'Owner/Admin' })}`;
    const res = await logout(cookie);

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    // Documented limitation: no db.users row means no version to bump, so this
    // session expires on its own rather than being revoked. Asserted so the
    // behaviour cannot change silently.
    expect((await me(cookie)).status).toBe(200);
  });
});
