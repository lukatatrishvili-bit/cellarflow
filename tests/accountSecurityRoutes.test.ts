import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');

function resetDb(): ReturnType<typeof dbModule.getDB> {
  const db = dbModule.getDB();
  db.users = [];
  db.organizations = [];
  db.memberships = [];
  db.invitations = [];
  db.securityAuditEvents = [];
  db.orgData = {};
  return db;
}

async function request(
  pathname: string,
  init: RequestInit = {},
  forwardedFor = '198.51.100.10',
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': forwardedFor,
      ...(init.headers || {}),
    },
  });
}

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('../server/mailer', async () => {
    const actual = await vi.importActual<typeof import('../server/mailer')>('../server/mailer');
    return {
      ...actual,
      sendMail: vi.fn(async () => ({ delivered: true, transport: 'smtp' as const })),
    };
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-security-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'production',
    SESSION_SECRET: 'account-security-route-test-secret-32-bytes',
    ADMIN_USERNAME: 'master',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(root, 'db.json'),
    GCS_BUCKET: '',
  };

  const routes = await import('../server/routes/auth');
  const adminRoutes = await import('../server/routes/admin');
  dbModule = await import('../server/db');
  authModule = await import('../server/auth');

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/auth', routes.default);
  app.use('/api/organizations', routes.orgRouter);
  app.use('/api/admin', adminRoutes.default);
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
  vi.doUnmock('../server/mailer');
  vi.resetModules();
});

describe.sequential('account security routes', () => {
  it('issues master-console capability only to the real master session', async () => {
    const db = resetDb();
    const user = {
      username: 'support-target',
      email: 'support-target@example.com',
      fullName: 'Support Target',
      role: 'Winemaker',
      language: 'en',
      activeOrganizationId: 'org-support',
      accountEnabled: true,
      sessionVersion: 1,
    };
    db.users.push(user);
    db.organizations.push({ id: 'org-support', name: 'Support Winery' });
    db.memberships.push({
      id: 'mem-support', userId: user.username, organizationId: 'org-support', role: 'Winemaker',
    });

    const masterToken = authModule.createSessionToken({ username: 'master', role: 'Owner/Admin' });
    const masterResponse = await request('/api/auth/me', {
      headers: { cookie: `maranios_session=${masterToken}` },
    }, '198.51.100.9');
    expect(masterResponse.status).toBe(200);
    expect(await masterResponse.json()).toEqual(expect.objectContaining({
      username: 'master',
      isMasterAdmin: true,
    }));

    const supportToken = authModule.createSessionToken(
      authModule.sessionPayloadForUser(user, 'Winemaker', { impersonatedBy: 'master' }),
    );
    const supportResponse = await request('/api/auth/me', {
      headers: { cookie: `maranios_session=${supportToken}` },
    }, '198.51.100.9');
    expect(supportResponse.status).toBe(200);
    expect(await supportResponse.json()).toEqual(expect.objectContaining({
      username: user.username,
      isMasterAdmin: false,
      impersonatedBy: 'master',
    }));
  });

  it('keeps password-recovery responses neutral for existing and absent accounts', async () => {
    const db = resetDb();
    db.users.push({
      username: 'owner',
      email: 'owner@example.com',
      fullName: 'Owner',
      role: 'Owner/Admin',
      language: 'en',
      emailVerified: true,
      passwordHash: 'unused',
      sessionVersion: 1,
    });

    const missing = await request('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'missing@example.com' }),
    }, '198.51.100.11');
    const existing = await request('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.com' }),
    }, '198.51.100.11');

    expect(missing.status).toBe(200);
    expect(existing.status).toBe(200);
    expect(await existing.json()).toEqual(await missing.json());
  });

  it('locks repeated recovery requests after the configured quota', async () => {
    resetDb();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'quota@example.com' }),
      }, '198.51.100.12');
      statuses.push(response.status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('locks OAuth callback failure loops before another provider request can run', async () => {
    resetDb();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await request('/api/auth/google/callback', {}, '198.51.100.13');
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(400));
    expect(statuses[10]).toBe(429);
  });

  it('rejects a signed cookie after the user session version changes', async () => {
    const db = resetDb();
    db.users.push({
      username: 'revoked',
      email: 'revoked@example.com',
      fullName: 'Revoked',
      role: 'Owner/Admin',
      activeOrganizationId: 'org-revoked',
      sessionVersion: 2,
    });
    db.organizations.push({ id: 'org-revoked', name: 'Revoked Estate' });
    db.memberships.push({
      id: 'mem-revoked',
      userId: 'revoked',
      organizationId: 'org-revoked',
      role: 'Owner/Admin',
    });
    const oldToken = authModule.createSessionToken({
      username: 'revoked',
      role: 'Owner/Admin',
      sessionVersion: 1,
    });

    const response = await request('/api/auth/me', {
      headers: { cookie: `maranios_session=${oldToken}` },
    }, '198.51.100.14');

    expect(response.status).toBe(401);
  });

  it('reserves the system database export for the real master administrator', async () => {
    const db = resetDb();
    const owner = {
      username: 'winery-owner',
      email: 'owner@example.com',
      fullName: 'Winery Owner',
      role: 'Owner/Admin',
      language: 'en',
      activeOrganizationId: 'org-owner',
      accountEnabled: true,
      sessionVersion: 1,
      passwordHash: 'must-not-be-exported',
    };
    db.users.push(owner);
    db.organizations.push({ id: 'org-owner', name: 'Owner Estate' });
    db.memberships.push({
      id: 'mem-owner', userId: owner.username, organizationId: 'org-owner', role: 'Owner/Admin',
    });

    const ownerToken = authModule.createSessionToken(
      authModule.sessionPayloadForUser(owner, 'Owner/Admin'),
    );
    const ownerResponse = await request('/api/admin/export', {
      headers: { cookie: `maranios_session=${ownerToken}` },
    }, '198.51.100.18');
    expect(ownerResponse.status).toBe(403);
    expect(await ownerResponse.json()).toEqual({
      error: 'Forbidden: Master Administrator access required.',
    });

    const masterToken = authModule.createSessionToken({ username: 'master', role: 'Owner/Admin' });
    const masterResponse = await request('/api/admin/export', {
      headers: { cookie: `maranios_session=${masterToken}` },
    }, '198.51.100.18');
    expect(masterResponse.status).toBe(200);
    expect(masterResponse.headers.get('content-disposition')).toMatch(
      /^attachment; filename="cellarflow_system_export_.*\.json"$/,
    );
    const exportSnapshot = await masterResponse.json();
    expect(exportSnapshot).toEqual(expect.objectContaining({
      scope: 'system',
      db: expect.any(Object),
    }));
    expect(JSON.stringify(exportSnapshot)).not.toContain('must-not-be-exported');
  });

  it('rejects an otherwise-valid session after active membership removal', async () => {
    const db = resetDb();
    const user = {
      username: 'removed',
      email: 'removed@example.com',
      fullName: 'Removed',
      role: 'Owner/Admin',
      activeOrganizationId: 'org-removed',
      sessionVersion: 1,
    };
    db.users.push(user);
    db.organizations.push({ id: 'org-removed', name: 'Removed Estate' });
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(user, 'Owner/Admin'));

    const response = await request('/api/auth/me', {
      headers: { cookie: `maranios_session=${token}` },
    }, '198.51.100.15');

    expect(response.status).toBe(401);
    const protectedResponse = await request('/api/admin/deployment-status', {
      headers: { cookie: `maranios_session=${token}` },
    }, '198.51.100.15');
    expect(protectedResponse.status).toBe(401);
  });

  it('rejects a current signed session as soon as the account is disabled', async () => {
    const db = resetDb();
    const user = {
      username: 'disabled',
      email: 'disabled@example.com',
      fullName: 'Disabled',
      role: 'Owner/Admin',
      activeOrganizationId: 'org-disabled',
      accountEnabled: false,
      sessionVersion: 2,
    };
    db.users.push(user);
    db.organizations.push({ id: 'org-disabled', name: 'Disabled Estate' });
    db.memberships.push({
      id: 'mem-disabled', userId: 'disabled', organizationId: 'org-disabled', role: 'Owner/Admin',
    });
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(user, 'Owner/Admin'));

    const response = await request('/api/auth/me', {
      headers: { cookie: `maranios_session=${token}` },
    }, '198.51.100.16');

    expect(response.status).toBe(401);
  });

  it('rotates the target session version when a master admin disables the account', async () => {
    const db = resetDb();
    const user = {
      username: 'managed',
      email: 'managed@example.com',
      fullName: 'Managed',
      role: 'Winemaker',
      activeOrganizationId: 'org-managed',
      accountEnabled: true,
      emailVerified: true,
      sessionVersion: 3,
    };
    db.users.push(user);
    db.organizations.push({ id: 'org-managed', name: 'Managed Estate' });
    db.memberships.push({
      id: 'mem-managed', userId: 'managed', organizationId: 'org-managed', role: 'Winemaker',
    });
    const targetToken = authModule.createSessionToken(authModule.sessionPayloadForUser(user, 'Winemaker'));
    const adminToken = authModule.createSessionToken({ username: 'master', role: 'Owner/Admin' });

    const update = await request('/api/admin/users/update', {
      method: 'POST',
      headers: { cookie: `maranios_session=${adminToken}` },
      body: JSON.stringify({ username: 'managed', accountEnabled: false }),
    }, '198.51.100.17');

    expect(update.status).toBe(200);
    expect(user.accountEnabled).toBe(false);
    expect(user.sessionVersion).toBe(4);

    const audit = await request('/api/admin/security-events', {
      headers: { cookie: `maranios_session=${adminToken}` },
    }, '198.51.100.17');
    expect(audit.status).toBe(200);
    expect((await audit.json()).events).toContainEqual(expect.objectContaining({
      eventType: 'admin.user_updated',
      username: 'managed',
    }));

    const oldSession = await request('/api/auth/me', {
      headers: { cookie: `maranios_session=${targetToken}` },
    }, '198.51.100.17');
    expect(oldSession.status).toBe(401);
  });
});
