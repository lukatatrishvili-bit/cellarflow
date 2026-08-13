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

function seedUser(username: string, activeOrganizationId: string | null = null, role = 'Owner/Admin') {
  const user = {
    id: `user-${username}`,
    username,
    email: `${username}@example.test`,
    fullName: username.toUpperCase(),
    passwordHash: 'test',
    role,
    activeOrganizationId,
    emailVerified: true,
    accountEnabled: true,
    approvalStatus: 'approved',
    sessionVersion: 1,
  } as any;
  dbModule.getDB().users.push(user);
  return user;
}

function masterCookie(): string {
  return `maranios_session=${authModule.createSessionToken({ username: 'master', role: 'Owner/Admin' })}`;
}

async function post(route: string, body: Record<string, unknown>, authenticated = true): Promise<Response> {
  return fetch(`${baseUrl}/api/admin${route}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { cookie: masterCookie() } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function get(route: string, authenticated = true): Promise<Response> {
  return fetch(`${baseUrl}/api/admin${route}`, {
    headers: authenticated ? { cookie: masterCookie() } : {},
  });
}

beforeAll(async () => {
  vi.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-admin-tenants-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'production',
    SESSION_SECRET: 'admin-tenant-management-test-secret-at-least-32-bytes',
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
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe.sequential('master-admin tenant management', () => {
  it('requires the real master administrator for organization changes', async () => {
    resetDb();
    seedUser('nino');
    const response = await post('/orgs/create', { name: 'Kvareli Cellars', ownerUsername: 'nino' }, false);
    expect(response.status).toBe(401);
  });

  it('creates a durable-ready organization with an initial owner and empty winery state', async () => {
    const db = resetDb();
    const owner = seedUser('nino');

    const response = await post('/orgs/create', { name: '  Kvareli   Cellars  ', ownerUsername: 'nino' });
    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.organization.name).toBe('Kvareli Cellars');
    expect(body.membership).toMatchObject({ userId: 'nino', role: 'Owner/Admin' });
    expect(db.organizations).toHaveLength(1);
    expect(db.memberships).toHaveLength(1);
    expect(db.orgData[body.organization.id].companyProfile).toMatchObject({
      companyName: 'Kvareli Cellars',
      wineryName: 'Kvareli Cellars',
    });
    expect(owner.activeOrganizationId).toBe(body.organization.id);
    expect(owner.sessionVersion).toBe(2);
  });

  it('renames an organization and keeps an untouched matching company profile aligned', async () => {
    const db = resetDb();
    seedUser('nino', 'org-a');
    db.organizations.push({ id: 'org-a', name: 'Old Cellar' } as any);
    db.memberships.push({ id: 'mem-a', userId: 'nino', organizationId: 'org-a', role: 'Owner/Admin' } as any);
    db.orgData['org-a'] = dbModule.createEmptyUserData();
    db.orgData['org-a'].companyProfile.companyName = 'Old Cellar';

    const response = await post('/orgs/update', { organizationId: 'org-a', name: 'New Cellar' });
    expect(response.status).toBe(200);
    expect(db.organizations[0].name).toBe('New Cellar');
    expect(db.orgData['org-a'].companyProfile.companyName).toBe('New Cellar');
  });

  it('assigns, changes, activates, and removes a user membership safely', async () => {
    const db = resetDb();
    const nino = seedUser('nino', 'org-a');
    seedUser('giorgi', 'org-b');
    db.organizations.push(
      { id: 'org-a', name: 'Alpha' } as any,
      { id: 'org-b', name: 'Beta' } as any,
    );
    db.memberships.push(
      { id: 'mem-a-nino', userId: 'nino', organizationId: 'org-a', role: 'Owner/Admin' } as any,
      { id: 'mem-b-giorgi', userId: 'giorgi', organizationId: 'org-b', role: 'Owner/Admin' } as any,
    );

    const assigned = await post('/memberships/upsert', {
      username: 'nino', organizationId: 'org-b', role: 'Winemaker', makeActive: true,
    });
    expect(assigned.status).toBe(200);
    expect(nino.activeOrganizationId).toBe('org-b');
    expect(nino.role).toBe('Winemaker');
    expect(nino.sessionVersion).toBe(2);

    const changed = await post('/memberships/upsert', {
      username: 'nino', organizationId: 'org-b', role: 'Read-Only',
    });
    expect(changed.status).toBe(200);
    let currentNino = dbModule.getDB().users.find(user => user.username === 'nino')!;
    expect(currentNino.role).toBe('Read-Only');
    expect(currentNino.sessionVersion).toBe(3);

    const removed = await post('/memberships/remove', { username: 'nino', organizationId: 'org-b' });
    expect(removed.status).toBe(200);
    currentNino = dbModule.getDB().users.find(user => user.username === 'nino')!;
    expect(currentNino.activeOrganizationId).toBe('org-a');
    expect(currentNino.role).toBe('Owner/Admin');
    expect(currentNino.sessionVersion).toBe(4);
    expect(dbModule.getDB().memberships.some(item => item.userId === 'nino' && item.organizationId === 'org-b')).toBe(false);
  });

  it('does not allow a membership removal to strand an organization', async () => {
    const db = resetDb();
    seedUser('nino', 'org-a');
    db.organizations.push({ id: 'org-a', name: 'Alpha' } as any);
    db.memberships.push({ id: 'mem-a', userId: 'nino', organizationId: 'org-a', role: 'Owner/Admin' } as any);

    const response = await post('/memberships/remove', { username: 'nino', organizationId: 'org-a' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'last_organization_member' });
    expect(db.memberships).toHaveLength(1);
  });

  it('requires exact-name confirmation before deleting an organization and rehomes active users', async () => {
    const db = resetDb();
    const nino = seedUser('nino', 'org-a');
    db.organizations.push(
      { id: 'org-a', name: 'Alpha Cellar' } as any,
      { id: 'org-b', name: 'Beta Cellar' } as any,
    );
    db.memberships.push(
      { id: 'mem-a', userId: 'nino', organizationId: 'org-a', role: 'Owner/Admin' } as any,
      { id: 'mem-b', userId: 'nino', organizationId: 'org-b', role: 'Winemaker' } as any,
    );
    db.orgData['org-a'] = { vessels: [{ id: 'T-1' }], lots: [{ id: 'L-1' }] } as any;
    db.orgData['org-b'] = dbModule.createEmptyUserData();

    const refused = await post('/orgs/delete', { organizationId: 'org-a', confirmationName: 'alpha cellar' });
    expect(refused.status).toBe(409);
    expect(db.orgData['org-a']).toBeDefined();

    const deleted = await post('/orgs/delete', { organizationId: 'org-a', confirmationName: 'Alpha Cellar' });
    expect(deleted.status).toBe(200);
    expect(db.organizations.map(org => org.id)).toEqual(['org-b']);
    expect(db.orgData['org-a']).toBeUndefined();
    expect(nino.activeOrganizationId).toBe('org-b');
    expect(nino.role).toBe('Winemaker');
    expect(nino.sessionVersion).toBe(2);
  });

  it('suspends and restores an organization while revoking active tenant sessions', async () => {
    const db = resetDb();
    const nino = seedUser('nino', 'org-a');
    db.organizations.push({ id: 'org-a', name: 'Alpha Cellar', status: 'active' } as any);
    db.memberships.push({ id: 'mem-a', userId: 'nino', organizationId: 'org-a', role: 'Owner/Admin' } as any);

    const suspended = await post('/orgs/lifecycle', { organizationId: 'org-a', status: 'suspended', reason: 'Billing review in progress' });
    expect(suspended.status).toBe(200);
    expect(db.organizations[0]).toMatchObject({ status: 'suspended', archivedAt: null });
    expect(nino.sessionVersion).toBe(2);

    const restored = await post('/orgs/lifecycle', { organizationId: 'org-a', status: 'active', reason: 'Billing review completed' });
    expect(restored.status).toBe(200);
    expect(db.organizations[0]).toMatchObject({ status: 'active', archivedAt: null });
    expect(nino.sessionVersion).toBe(2);
  });

  it('bulk-assigns users to an organization with the selected role', async () => {
    const db = resetDb();
    seedUser('nino');
    seedUser('giorgi');
    db.organizations.push({ id: 'org-a', name: 'Alpha Cellar', status: 'active' } as any);

    const response = await post('/users/bulk', {
      usernames: ['nino', 'giorgi'], action: 'assign', organizationId: 'org-a', role: 'Read-Only',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ matched: 2, changed: 2 });
    expect(db.memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'nino', organizationId: 'org-a', role: 'Read-Only' }),
      expect.objectContaining({ userId: 'giorgi', organizationId: 'org-a', role: 'Read-Only' }),
    ]));
  });

  it('exposes role permissions and records session revocation security actions', async () => {
    const db = resetDb();
    const nino = seedUser('nino');

    const roles = await get('/role-permissions');
    expect(roles.status).toBe(200);
    const rolesBody = await roles.json();
    expect(rolesBody.roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'Owner/Admin' }),
      expect.objectContaining({ role: 'Read-Only' }),
    ]));

    const revoked = await post('/users/security-action', { username: 'nino', action: 'revoke_sessions' });
    expect(revoked.status).toBe(200);
    expect(nino.sessionVersion).toBe(2);
    expect(db.securityAuditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'admin.user_sessions_revoked', username: 'nino', actorUsername: 'master' }),
    ]));
  });

  it('reports live user presence and organization health in registry responses', async () => {
    const db = resetDb();
    const nino = seedUser('nino', 'org-a');
    nino.lastSeenAt = new Date().toISOString();
    db.organizations.push({ id: 'org-a', name: 'Alpha Cellar', status: 'active' } as any);
    db.memberships.push({ id: 'mem-a', userId: 'nino', organizationId: 'org-a', role: 'Owner/Admin' } as any);

    const usersResponse = await get('/users');
    expect(usersResponse.status).toBe(200);
    await expect(usersResponse.json()).resolves.toMatchObject({ users: expect.arrayContaining([
      expect.objectContaining({ username: 'nino', isOnline: true, lastSeenAt: nino.lastSeenAt }),
    ]) });

    const orgsResponse = await get('/orgs');
    expect(orgsResponse.status).toBe(200);
    await expect(orgsResponse.json()).resolves.toMatchObject({ organizations: expect.arrayContaining([
      expect.objectContaining({ id: 'org-a', status: 'active', onlineMembersCount: 1, health: expect.objectContaining({ level: 'warning', issues: ['No operational activity recorded'] }) }),
    ]) });
  });

  it('stores private organization notes and normalized searchable tags', async () => {
    const db = resetDb();
    seedUser('nino', 'org-a');
    db.organizations.push({ id: 'org-a', name: 'Alpha Cellar', status: 'active' } as any);
    db.memberships.push({ id: 'mem-a', userId: 'nino', organizationId: 'org-a', role: 'Owner/Admin' } as any);
    db.orgData['org-a'] = dbModule.createEmptyUserData();

    const response = await post('/orgs/internal-profile', {
      organizationId: 'org-a',
      internalNotes: 'Renewal owner is Nino. Follow up after harvest.',
      internalTags: [' VIP ', 'vip', 'Renewal   risk'],
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      internalNotes: 'Renewal owner is Nino. Follow up after harvest.',
      internalTags: ['VIP', 'Renewal risk'],
    });
    expect(db.organizations[0]).toMatchObject({
      internalNotes: 'Renewal owner is Nino. Follow up after harvest.',
      internalTags: ['VIP', 'Renewal risk'],
    });

    const registry = await get('/orgs');
    await expect(registry.json()).resolves.toMatchObject({ organizations: [
      expect.objectContaining({ id: 'org-a', internalTags: ['VIP', 'Renewal risk'] }),
    ] });

    const inspection = await get('/orgs/inspect?id=org-a');
    await expect(inspection.json()).resolves.toMatchObject({ organization: {
      id: 'org-a',
      internalNotes: 'Renewal owner is Nino. Follow up after harvest.',
      internalTags: ['VIP', 'Renewal risk'],
    } });

    const rejected = await post('/orgs/internal-profile', {
      organizationId: 'org-a', internalNotes: 'x'.repeat(2_001), internalTags: [],
    });
    expect(rejected.status).toBe(400);
  });

  it('exports one organization without credentials or invitation tokens', async () => {
    const db = resetDb();
    seedUser('nino', 'org-a');
    db.organizations.push({ id: 'org-a', name: 'Alpha Cellar', status: 'active' } as any);
    db.memberships.push({ id: 'mem-a', userId: 'nino', organizationId: 'org-a', role: 'Owner/Admin' } as any);
    db.invitations.push({
      id: 'invite-a', email: 'guest@example.test', organizationId: 'org-a', role: 'Read-Only',
      tokenHash: 'must-not-export', expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      acceptedAt: null, revokedAt: null, createdAt: new Date().toISOString(),
    });
    db.orgData['org-a'] = { ...dbModule.createEmptyUserData(), apiToken: 'must-not-export' } as any;

    const response = await get('/orgs/export?id=org-a');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('vinos_organization_org-a');
    const body = await response.json();
    expect(body).toMatchObject({
      scope: 'organization',
      organization: { id: 'org-a', name: 'Alpha Cellar' },
      members: [expect.objectContaining({ username: 'nino', role: 'Owner/Admin' })],
      invitations: [expect.objectContaining({ id: 'invite-a', email: 'guest@example.test' })],
    });
    expect(body.invitations[0].tokenHash).toBeUndefined();
    expect(body.data.apiToken).toBeUndefined();
    expect(db.securityAuditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'admin.organization_exported', organizationId: 'org-a' }),
    ]));
  });

  it('keeps revoked invitations distinct from accepted invitations', async () => {
    const db = resetDb();
    seedUser('nino', 'org-a');
    seedUser('guest');
    db.organizations.push({ id: 'org-a', name: 'Alpha Cellar', status: 'active' } as any);
    db.memberships.push({ id: 'mem-a', userId: 'nino', organizationId: 'org-a', role: 'Owner/Admin' } as any);
    db.invitations.push({
      id: 'invite-a', email: 'guest@example.test', organizationId: 'org-a', role: 'Read-Only',
      tokenHash: 'invite-token-hash', expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      acceptedAt: null, revokedAt: null, createdAt: new Date().toISOString(),
    });

    const revoked = await post('/orgs/invitations/revoke', { invitationId: 'invite-a' });
    expect(revoked.status).toBe(200);
    expect(db.invitations[0].acceptedAt).toBeNull();
    expect(db.invitations[0].revokedAt).toBeTruthy();

    const acceptance = await dbModule.acceptInvitationAtomically('invite-token-hash', 'guest');
    expect(acceptance.status).toBe('revoked');
    expect(db.memberships.some(item => item.userId === 'guest' && item.organizationId === 'org-a')).toBe(false);
  });
});
