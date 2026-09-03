import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The authenticated request path used to rebuild the entire platform directory
 * — every user, organization, membership, and invitation — to authorise one
 * person. These tests pin the replacement: the same decisions, still resolved
 * against PostgreSQL on every request, from a keyed read.
 *
 * They matter more than most: the normal suite runs without PostgreSQL, so the
 * keyed branch is never taken there. Without a mocked client this code would
 * ship unexercised.
 */

const originalEnv = { ...process.env };

function userRow(overrides: Record<string, any> = {}) {
  return {
    id: 'user-1',
    username: 'nino',
    email: 'nino@example.test',
    fullName: 'Nino',
    role: 'Winemaker',
    language: 'ka',
    phone: '',
    whatsappOptIn: false,
    passwordHash: 'hash',
    emailVerified: true,
    isDemo: false,
    activeOrganizationId: 'org-1',
    registrationComplete: true,
    accountEnabled: true,
    approvalStatus: 'approved',
    sessionVersion: 1,
    memberships: [
      { id: 'm-1', userId: 'nino', organizationId: 'org-1', role: 'Cellar Worker' },
    ],
    ...overrides,
  };
}

function mockPrisma(row: any) {
  const findUnique = vi.fn(async () => row);
  const findMany = vi.fn(async () => []);
  const updateMany = vi.fn(async () => ({ count: 1 }));
  return {
    client: {
      user: { findUnique, findMany, updateMany },
      organization: { findMany },
      membership: { findMany },
      invitation: { findMany },
      organizationState: { findMany, findUnique: vi.fn(async () => null) },
    },
    findUnique,
    findMany,
  };
}

async function loadDbWithPrisma(prisma: any) {
  vi.resetModules();
  vi.doMock('@prisma/client', () => ({
    PrismaClient: vi.fn(function PrismaClientMock() { return prisma; }),
  }));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-principal-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    DATABASE_PATH: path.join(root, 'db.json'),
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cellarflow',
    GCS_BUCKET: '',
  };
  return import('../server/db');
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
  vi.doUnmock('@prisma/client');
});

describe('session principal lookup', () => {
  it('reads one user by key instead of scanning the platform directory', async () => {
    const prisma = mockPrisma(userRow());
    const db = await loadDbWithPrisma(prisma.client);

    const principal = await db.loadSessionPrincipal('nino');

    expect(principal?.user.username).toBe('nino');
    expect(prisma.findUnique).toHaveBeenCalledWith({
      where: { username: 'nino' },
      include: { memberships: true },
    });
    // The point of the change: no unfiltered table reads on the request path.
    expect(prisma.findMany).not.toHaveBeenCalled();
  });

  it('maps the fields authorisation depends on', async () => {
    const prisma = mockPrisma(userRow({
      accountEnabled: false,
      approvalStatus: 'pending',
      sessionVersion: 7,
    }));
    const db = await loadDbWithPrisma(prisma.client);

    const principal = await db.loadSessionPrincipal('nino');

    expect(principal?.user.accountEnabled).toBe(false);
    expect(principal?.user.approvalStatus).toBe('pending');
    expect(principal?.user.sessionVersion).toBe(7);
    expect(principal?.memberships).toEqual([
      expect.objectContaining({ userId: 'nino', organizationId: 'org-1', role: 'Cellar Worker' }),
    ]);
  });

  it('refreshes the process directory for the requesting user', async () => {
    // Code elsewhere still reads getDB().users for the current user; the keyed
    // read has to keep that entry current now that nothing else refreshes it.
    const prisma = mockPrisma(userRow({ role: 'Owner/Admin' }));
    const db = await loadDbWithPrisma(prisma.client);
    db.getDB().users.push({ username: 'nino', role: 'Read-Only' } as any);

    await db.loadSessionPrincipal('nino');

    const cached = db.getDB().users.filter((u: any) => u.username === 'nino');
    expect(cached).toHaveLength(1);
    expect(cached[0].role).toBe('Owner/Admin');
  });

  it('replaces the user memberships rather than accumulating them', async () => {
    const prisma = mockPrisma(userRow());
    const db = await loadDbWithPrisma(prisma.client);

    await db.loadSessionPrincipal('nino');
    await db.loadSessionPrincipal('nino');

    const memberships = db.getDB().memberships.filter((m: any) => m.userId === 'nino');
    expect(memberships).toHaveLength(1);
  });

  it('leaves other users in the directory untouched', async () => {
    const prisma = mockPrisma(userRow());
    const db = await loadDbWithPrisma(prisma.client);
    db.getDB().users.push({ username: 'giorgi', role: 'Winemaker' } as any);
    db.getDB().memberships.push({ id: 'm-9', userId: 'giorgi', organizationId: 'org-2', role: 'Winemaker' } as any);

    await db.loadSessionPrincipal('nino');

    expect(db.getDB().users.some((u: any) => u.username === 'giorgi')).toBe(true);
    expect(db.getDB().memberships.some((m: any) => m.userId === 'giorgi')).toBe(true);
  });

  it('evicts a user deleted between requests', async () => {
    // A cached row must not keep authorising an account that no longer exists.
    const prisma = mockPrisma(null);
    const db = await loadDbWithPrisma(prisma.client);
    db.getDB().users.push({ username: 'nino', role: 'Owner/Admin' } as any);
    db.getDB().memberships.push({ id: 'm-1', userId: 'nino', organizationId: 'org-1', role: 'Owner/Admin' } as any);

    const principal = await db.loadSessionPrincipal('nino');

    expect(principal).toBeNull();
    expect(db.getDB().users.some((u: any) => u.username === 'nino')).toBe(false);
    expect(db.getDB().memberships.some((m: any) => m.userId === 'nino')).toBe(false);
  });

  it('falls back to the in-memory directory when the query fails', async () => {
    const failing = mockPrisma(null);
    failing.client.user.findUnique = vi.fn(async () => { throw new Error('connection reset'); });
    const db = await loadDbWithPrisma(failing.client);
    db.getDB().users.push({ username: 'nino', role: 'Winemaker' } as any);

    const principal = await db.loadSessionPrincipal('nino');

    expect(principal).toBeNull();
    // A transient database error must not silently evict the cached user.
    expect(db.getDB().users.some((u: any) => u.username === 'nino')).toBe(true);
  });

  it('resolves an unauthenticated request without touching the database', async () => {
    const prisma = mockPrisma(userRow());
    const db = await loadDbWithPrisma(prisma.client);
    const { liveSessionRole } = await import('../server/middleware/auth');
    void db;

    expect(await liveSessionRole({ headers: {} } as any)).toBeNull();
    expect(prisma.findUnique).not.toHaveBeenCalled();
  });

  it('returns null without querying when PostgreSQL is not configured', async () => {
    const prisma = mockPrisma(userRow());
    vi.resetModules();
    vi.doMock('@prisma/client', () => ({
      PrismaClient: vi.fn(function PrismaClientMock() { return prisma.client; }),
    }));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-principal-nopg-'));
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      DATABASE_PATH: path.join(root, 'db.json'),
      DATABASE_URL: '',
      GCS_BUCKET: '',
    };
    const db = await import('../server/db');

    expect(await db.loadSessionPrincipal('nino')).toBeNull();
    expect(prisma.findUnique).not.toHaveBeenCalled();
  });
});

/**
 * The security contract, exercised through the keyed branch. The existing
 * revocation tests run without PostgreSQL and therefore only cover the
 * in-memory fallback, so these are the ones that would catch a regression in
 * what actually runs in production.
 */
describe('authorisation decisions over the keyed read', () => {
  async function authorise(row: any, sessionOverrides: Record<string, any> = {}) {
    const prisma = mockPrisma(row);
    vi.resetModules();
    vi.doMock('@prisma/client', () => ({
      PrismaClient: vi.fn(function PrismaClientMock() { return prisma.client; }),
    }));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-authz-'));
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      SESSION_SECRET: 'session-principal-test-secret-at-least-32-bytes',
      DATABASE_PATH: path.join(root, 'db.json'),
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cellarflow',
      GCS_BUCKET: '',
    };
    const auth = await import('../server/auth');
    const { liveSessionRole } = await import('../server/middleware/auth');
    const token = auth.createSessionToken({
      username: 'nino',
      role: 'Winemaker',
      sessionVersion: 1,
      ...sessionOverrides,
    });
    const result = await liveSessionRole({
      headers: { cookie: `maranios_session=${token}` },
    } as any);
    return { result, prisma };
  }

  it('authorises a valid session with the role from its membership', async () => {
    const { result, prisma } = await authorise(userRow());

    // Membership role wins over the user's default role.
    expect(result).toEqual({ username: 'nino', role: 'Cellar Worker' });
    // The cost guard, not a stylistic preference: this path previously issued
    // four unfiltered findMany queries (users, organizations, memberships,
    // invitations) per authenticated request. One keyed read replaces them.
    expect(prisma.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.findMany).toHaveBeenCalledTimes(0);
  });

  it('denies a disabled account', async () => {
    const { result } = await authorise(userRow({ accountEnabled: false }));

    expect(result).toBeNull();
  });

  it('denies an account whose approval was withdrawn after the session was issued', async () => {
    const { result } = await authorise(userRow({ approvalStatus: 'pending' }));

    expect(result).toBeNull();
  });

  it('denies a session issued before the user session version advanced', async () => {
    const { result } = await authorise(userRow({ sessionVersion: 3 }), { sessionVersion: 1 });

    expect(result).toBeNull();
  });

  it('denies a user whose membership in the active organization was removed', async () => {
    const { result } = await authorise(userRow({ memberships: [] }));

    expect(result).toBeNull();
  });

  it('picks up a role downgrade on the very next request', async () => {
    const { result } = await authorise(userRow({
      memberships: [{ id: 'm-1', userId: 'nino', organizationId: 'org-1', role: 'Read-Only' }],
    }));

    expect(result).toEqual({ username: 'nino', role: 'Read-Only' });
  });

  it('denies a user deleted between requests', async () => {
    const { result } = await authorise(null);

    expect(result).toBeNull();
  });
});
