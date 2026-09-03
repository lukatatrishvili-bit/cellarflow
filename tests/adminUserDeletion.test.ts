import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Deleting a master-admin account used to remove the login and its memberships
 * and stop there. The winery's organization and its entire operational record
 * stayed in the database with nobody able to reach them — so "remove this
 * account" neither removed the data nor kept it usable, and the confirmation
 * dialog said only that memberships and access keys would be revoked.
 *
 * The route now refuses any deletion that would strand a workspace until the
 * caller names the workspaces it accepts destroying. These tests pin that
 * behaviour: an accidental click cannot reach the destructive path, because the
 * ids it would have to send are ones the caller has not been shown yet.
 */

const originalEnv = { ...process.env };
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');

function resetDb() {
  const db = dbModule.getDB();
  db.users = [];
  db.organizations = [];
  db.memberships = [];
  db.invitations = [];
  db.securityAuditEvents = [];
  db.orgData = {};
  return db;
}

function masterCookie(): string {
  return `maranios_session=${authModule.createSessionToken({ username: 'master', role: 'Owner/Admin' })}`;
}

async function deleteUser(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/users/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: masterCookie() },
    body: JSON.stringify(body),
  });
}

/** One winemaker, one winery, with records worth losing. */
function seedSoleOwner() {
  const db = resetDb();
  db.users.push({ username: 'nino', email: 'nino@example.test', role: 'Owner/Admin', activeOrganizationId: 'org-kvareli' } as any);
  db.organizations.push({ id: 'org-kvareli', name: 'ყვარლის მარანი' } as any);
  db.memberships.push({ id: 'mem-1', userId: 'nino', organizationId: 'org-kvareli', role: 'Owner/Admin' } as any);
  db.orgData['org-kvareli'] = {
    vessels: [{ id: 'Q-01' }, { id: 'T-101' }],
    lots: [{ id: 'SAP-25' }, { id: 'RK-25' }, { id: 'KIS-25' }],
  } as any;
  return db;
}

beforeAll(async () => {
  vi.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-admin-delete-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'production',
    SESSION_SECRET: 'admin-user-deletion-test-secret-at-least-32-bytes',
    ADMIN_USERNAME: 'master',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(root, 'db.json'),
    GCS_BUCKET: '',
  };

  const adminRoutes = await import('../server/routes/admin');
  dbModule = await import('../server/db');
  authModule = await import('../server/auth');

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/admin', adminRoutes.default);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe.sequential('deleting a master-admin user', () => {
  it('refuses when the account is the last member of a winery', async () => {
    const db = seedSoleOwner();

    const response = await deleteUser({ username: 'nino' });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('orphaned_organizations_require_confirmation');

    // Nothing may be touched by the refused attempt.
    expect(db.users.some(u => u.username === 'nino')).toBe(true);
    expect(db.orgData['org-kvareli']).toBeDefined();
    expect(db.organizations).toHaveLength(1);
  });

  it('reports what would be lost, so the decision can be informed', async () => {
    seedSoleOwner();

    const body = await (await deleteUser({ username: 'nino' })).json();

    expect(body.organizations).toHaveLength(1);
    const [org] = body.organizations;
    expect(org.id).toBe('org-kvareli');
    expect(org.name).toBe('ყვარლის მარანი');
    // The counts are the point: "3 lots, 2 vessels" is what makes this real.
    expect(org.lotsCount).toBe(3);
    expect(org.tanksCount).toBe(2);
  });

  it('deletes the account and the stranded winery once confirmed', async () => {
    const db = seedSoleOwner();

    const response = await deleteUser({
      username: 'nino',
      confirmOrphanedOrganizations: ['org-kvareli'],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      deletedOrganizations: ['org-kvareli'],
    });

    expect(db.users.some(u => u.username === 'nino')).toBe(false);
    expect(db.memberships).toHaveLength(0);
    // The workspace goes with the account rather than lingering unreachable.
    expect(db.orgData['org-kvareli']).toBeUndefined();
    expect(db.organizations).toHaveLength(0);
  });

  it('ignores an acknowledgement that names the wrong winery', async () => {
    const db = seedSoleOwner();

    const response = await deleteUser({
      username: 'nino',
      confirmOrphanedOrganizations: ['org-somewhere-else'],
    });

    // Confirming a different id must not authorise destroying this one.
    expect(response.status).toBe(409);
    expect(db.orgData['org-kvareli']).toBeDefined();
  });

  it('deletes in one step when the winery keeps another member', async () => {
    const db = seedSoleOwner();
    db.users.push({ username: 'giorgi', email: 'giorgi@example.test', role: 'Winemaker', activeOrganizationId: 'org-kvareli' } as any);
    db.memberships.push({ id: 'mem-2', userId: 'giorgi', organizationId: 'org-kvareli', role: 'Winemaker' } as any);

    const response = await deleteUser({ username: 'nino' });

    // No records are at risk, so the extra confirmation would only be noise.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ deletedOrganizations: [] });
    expect(db.users.some(u => u.username === 'nino')).toBe(false);
    expect(db.orgData['org-kvareli']).toBeDefined();
    expect(db.memberships.map(m => m.userId)).toEqual(['giorgi']);
  });

  it('still refuses to delete the environment master administrator', async () => {
    resetDb();
    const response = await deleteUser({ username: 'master' });
    expect(response.status).toBe(400);
  });
});
