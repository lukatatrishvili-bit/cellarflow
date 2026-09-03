import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaraniOSAuditLog } from '../lib/wineryState';

const originalEnv = { ...process.env };
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');
let auditHashModule: typeof import('../lib/auditHash');
let cacheModule: typeof import('../server/auditChainCache');

async function request(pathname: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    headers: { cookie: `maranios_session=${token}` },
  });
}

function tokenFor(user: any, role: string) {
  return authModule.createSessionToken(authModule.sessionPayloadForUser(user, role));
}

function unsignedEntry(index: number, overrides: Partial<MaraniOSAuditLog> = {}): MaraniOSAuditLog {
  return {
    id: `audit-${String(index).padStart(4, '0')}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    user: 'winemaker@example.test',
    module: 'GVINO',
    actionType: 'Create Lot',
    changedItem: `LOT-${index}`,
    oldValue: '',
    newValue: 'created',
    notes: 'routine',
    ...overrides,
  };
}

function seedWorkspace(auditLogs: MaraniOSAuditLog[]) {
  const db = dbModule.getDB();
  db.users = [];
  db.organizations = [{ id: 'org-audit', name: 'Audit Winery' } as any];
  db.memberships = [];
  db.invitations = [];
  db.securityAuditEvents = [];

  const state = dbModule.createEmptyUserData();
  state.auditLogs = auditLogs;
  db.orgData = { 'org-audit': state };

  const owner = {
    username: 'owner',
    email: 'owner@example.test',
    emailVerified: true,
    fullName: 'Owner',
    role: 'Owner/Admin',
    language: 'en',
    activeOrganizationId: 'org-audit',
    accountEnabled: true,
    sessionVersion: 1,
  };
  db.users.push(owner as any);
  db.memberships.push({
    id: 'member-owner',
    userId: owner.username,
    organizationId: 'org-audit',
    role: 'Owner/Admin',
  } as any);
  return { owner };
}

beforeAll(async () => {
  vi.resetModules();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vinos-audit-trail-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'audit-trail-route-test-secret-at-least-32-bytes',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(temp, 'db.json'),
    GCS_BUCKET: '',
  };

  const auditTrail = await import('../server/routes/auditTrail');
  dbModule = await import('../server/db');
  authModule = await import('../server/auth');
  auditHashModule = await import('../lib/auditHash');
  cacheModule = await import('../server/auditChainCache');

  const app = express();
  app.use(express.json());
  app.use('/api/audit-trail', auditTrail.default);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  cacheModule.clearAuditChainCache();
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe.sequential('audit trail route', () => {
  it('rejects an unauthenticated caller', async () => {
    seedWorkspace([]);

    const res = await fetch(`${baseUrl}/api/audit-trail`);

    expect(res.status).toBe(401);
  });

  it('returns a verified window without shipping the whole chain', async () => {
    const signed = auditHashModule.signAuditEntries(
      Array.from({ length: 240 }, (_, i) => unsignedEntry(i)),
      [],
    );
    const { owner } = seedWorkspace(signed);

    const res = await request('/api/audit-trail?limit=50', tokenFor(owner, 'Owner/Admin'));
    const body = await res.json();

    expect(res.status).toBe(200);
    // The response carries 50 records but reports — and verified — all 240.
    expect(body.entries).toHaveLength(50);
    expect(body.total).toBe(240);
    expect(body.chain.totalEntries).toBe(240);
    expect(body.chain.verifiedCount).toBe(240);
    expect(body.chain.invalidCount).toBe(0);
    expect(body.entries.every((item: any) => item.verification.valid)).toBe(true);
  });

  it('verifies the oldest page against records it does not return', async () => {
    const signed = auditHashModule.signAuditEntries(
      Array.from({ length: 240 }, (_, i) => unsignedEntry(i)),
      [],
    );
    const { owner } = seedWorkspace(signed);

    const res = await request('/api/audit-trail?offset=200&limit=50', tokenFor(owner, 'Owner/Admin'));
    const body = await res.json();

    expect(body.entries).toHaveLength(40);
    expect(body.entries.every((item: any) => item.verification.valid)).toBe(true);
    expect(body.entries.at(-1).verification.sequence).toBe(1);
    expect(body.entries.at(-1).verification.previousHash).toBe(auditHashModule.AUDIT_GENESIS_HASH);
  });

  it('surfaces tampering that a windowed response would otherwise hide', async () => {
    const signed = auditHashModule.signAuditEntries(
      Array.from({ length: 120 }, (_, i) => unsignedEntry(i)),
      [],
    );
    // Edited deep in the chain, far outside the first page.
    signed[10] = { ...signed[10], newValue: 'silently rewritten' };
    const { owner } = seedWorkspace(signed);

    const res = await request('/api/audit-trail?limit=10', tokenFor(owner, 'Owner/Admin'));
    const body = await res.json();

    expect(body.chain.invalidCount).toBeGreaterThan(0);
  });

  it('applies module, search, and time filters server-side', async () => {
    const signed = auditHashModule.signAuditEntries([
      unsignedEntry(0, { module: 'VAZI', user: 'vineyard@example.test' }),
      unsignedEntry(1, { module: 'GVINO' }),
      unsignedEntry(2, { module: 'GVINO' }),
    ], []);
    const { owner } = seedWorkspace(signed);
    const token = tokenFor(owner, 'Owner/Admin');

    const byModule = await (await request('/api/audit-trail?module=VAZI', token)).json();
    expect(byModule.total).toBe(1);
    expect(byModule.moduleCounts).toEqual({ GVINO: 2, VAZI: 1, MARANIOS: 0 });

    const bySearch = await (await request('/api/audit-trail?search=vineyard', token)).json();
    expect(bySearch.total).toBe(1);

    const future = new Date(Date.now() + 60_000).toISOString();
    const bySince = await (await request(`/api/audit-trail?since=${encodeURIComponent(future)}`, token)).json();
    expect(bySince.total).toBe(0);
    // Filtering never hides the chain's own health.
    expect(bySince.chain.totalEntries).toBe(3);
  });

  it('clamps an oversized page request', async () => {
    const signed = auditHashModule.signAuditEntries(
      Array.from({ length: 20 }, (_, i) => unsignedEntry(i)),
      [],
    );
    const { owner } = seedWorkspace(signed);

    const body = await (await request('/api/audit-trail?limit=999999', tokenFor(owner, 'Owner/Admin'))).json();

    expect(body.limit).toBe(body.maxLimit);
    expect(body.entries).toHaveLength(20);
  });

  it('serves each organization only its own chain', async () => {
    const { owner } = seedWorkspace(auditHashModule.signAuditEntries(
      Array.from({ length: 5 }, (_, i) => unsignedEntry(i, { changedItem: `FIRST-${i}` })),
      [],
    ));

    const db = dbModule.getDB();
    const neighbourState = dbModule.createEmptyUserData();
    neighbourState.auditLogs = auditHashModule.signAuditEntries(
      Array.from({ length: 30 }, (_, i) => unsignedEntry(i, { changedItem: `SECOND-${i}` })),
      [],
    );
    db.organizations.push({ id: 'org-neighbour', name: 'Neighbour Winery' } as any);
    db.orgData['org-neighbour'] = neighbourState;
    const neighbour = {
      username: 'neighbour-owner',
      email: 'neighbour@example.test',
      emailVerified: true,
      fullName: 'Neighbour',
      role: 'Owner/Admin',
      language: 'en',
      activeOrganizationId: 'org-neighbour',
      accountEnabled: true,
      sessionVersion: 1,
    };
    db.users.push(neighbour as any);
    db.memberships.push({
      id: 'member-neighbour',
      userId: neighbour.username,
      organizationId: 'org-neighbour',
      role: 'Owner/Admin',
    } as any);

    const mine = await (await request('/api/audit-trail', tokenFor(owner, 'Owner/Admin'))).json();
    const theirs = await (await request('/api/audit-trail', tokenFor(neighbour, 'Owner/Admin'))).json();

    expect(mine.chain.totalEntries).toBe(5);
    expect(theirs.chain.totalEntries).toBe(30);
    // The verification cache is keyed per organization; a shared entry here
    // would hand one winery another's chain.
    expect(mine.entries.every((item: any) => item.log.changedItem.startsWith('FIRST-'))).toBe(true);
    expect(theirs.entries.every((item: any) => item.log.changedItem.startsWith('SECOND-'))).toBe(true);
    expect(mine.chain.rootHash).not.toBe(theirs.chain.rootHash);
  });
});
