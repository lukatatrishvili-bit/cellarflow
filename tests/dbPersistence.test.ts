import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

async function loadDbModule(dbPath: string) {
  vi.resetModules();
  vi.doUnmock('@prisma/client');
  process.env = {
    ...originalEnv,
    DATABASE_PATH: dbPath,
    USE_FIRESTORE: 'false',
    GCS_BUCKET: '',
  };
  return import('../server/db');
}

async function loadDbModuleWithMockPrisma(dbPath: string, prisma: any) {
  vi.resetModules();
  vi.doMock('@prisma/client', () => ({ PrismaClient: vi.fn(function PrismaClientMock() { return prisma; }) }));
  process.env = {
    ...originalEnv,
    DATABASE_PATH: dbPath,
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cellarflow',
    USE_FIRESTORE: 'false',
    GCS_BUCKET: '',
  };
  return import('../server/db');
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('database persistence', () => {
  it('creates the database directory and writes a valid JSON cache', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'nested', 'db.json');
    const dbModule = await loadDbModule(dbPath);

    const db = dbModule.getDB();
    db.users.push({ username: 'alice', role: 'Owner/Admin' });
    dbModule.saveDB();

    const saved = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    expect(saved.users).toContainEqual({ username: 'alice', role: 'Owner/Admin' });
  });

  it('does not use the shared legacy db.json.tmp filename', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const dbModule = await loadDbModule(dbPath);

    const db = dbModule.getDB();
    db.users.push({ username: 'bob', role: 'Winemaker' });
    dbModule.saveDB();

    expect(fs.existsSync(`${dbPath}.tmp`)).toBe(false);
    expect(JSON.parse(fs.readFileSync(dbPath, 'utf8')).users).toContainEqual({ username: 'bob', role: 'Winemaker' });
  });

  it('upserts organization data into PostgreSQL JSONB state', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const tx = {
      organization: { upsert: vi.fn(async () => ({})) },
      organizationState: { upsert: vi.fn(async () => ({})) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);

    const db = dbModule.getDB();
    db.users.push({ username: 'alice', email: 'alice@example.com', fullName: 'Alice', role: 'Owner/Admin', activeOrganizationId: 'org-1' });
    db.organizations.push({ id: 'org-1', name: 'Alice Estate' });
    db.memberships.push({ id: 'mem-1', userId: 'alice', organizationId: 'org-1', role: 'Owner/Admin' });

    const data = dbModule.createEmptyUserData();
    data.costEntries.push({ id: 'cost-1', lotId: 'lot-1', amount: 42, category: 'labor', date: '2026-06-30' });

    await dbModule.saveUserData('alice', data);

    expect(tx.organization.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'org-1' },
    }));
    expect(tx.organizationState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1' },
      update: expect.objectContaining({
        data: expect.objectContaining({
          costEntries: expect.arrayContaining([expect.objectContaining({ id: 'cost-1', amount: 42 })]),
        }),
        version: { increment: 1 },
      }),
    }));
  });

  it('migrates legacy JSON state into PostgreSQL organization state on first boot', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    fs.writeFileSync(dbPath, JSON.stringify({
      users: [{ username: 'bob', email: 'bob@example.com', fullName: 'Bob', role: 'Owner/Admin', activeOrganizationId: 'org-2', passwordHash: 'hash' }],
      organizations: [{ id: 'org-2', name: 'Bob Estate' }],
      memberships: [{ id: 'mem-2', userId: 'bob', organizationId: 'org-2', role: 'Owner/Admin' }],
      invitations: [],
      orgData: {
        'org-2': {
          ...({}),
          lots: [{ id: 'lot-2', name: 'Saperavi 2026' }],
          costEntries: [{ id: 'cost-2', amount: 99 }],
        },
      },
    }), 'utf8');

    const tx = {
      user: { upsert: vi.fn(async () => ({})) },
      organization: { upsert: vi.fn(async () => ({})) },
      membership: { upsert: vi.fn(async () => ({})) },
      invitation: { upsert: vi.fn(async () => ({})) },
      organizationState: { upsert: vi.fn(async () => ({})) },
    };
    const prisma = {
      user: { findMany: vi.fn(async () => []) },
      organization: { findMany: vi.fn(async () => []) },
      membership: { findMany: vi.fn(async () => []) },
      invitation: { findMany: vi.fn(async () => []) },
      organizationState: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
      $disconnect: vi.fn(async () => undefined),
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);

    await dbModule.initDB();

    expect(tx.organizationState.upsert).toHaveBeenCalledTimes(1);
    expect(tx.organizationState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-2' },
      create: expect.objectContaining({
        data: expect.objectContaining({
          lots: expect.arrayContaining([expect.objectContaining({ id: 'lot-2' })]),
          costEntries: expect.arrayContaining([expect.objectContaining({ id: 'cost-2' })]),
        }),
        updatedBy: 'gcs-or-local-json',
      }),
    }));
  });

  it('forceSaveDB waits for PostgreSQL JSONB persistence before reporting success', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const tx = {
      user: { upsert: vi.fn(async () => ({})) },
      organization: { upsert: vi.fn(async () => ({})) },
      membership: { upsert: vi.fn(async () => ({})) },
      invitation: { upsert: vi.fn(async () => ({})) },
      organizationState: { upsert: vi.fn(async () => ({})) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);

    const db = dbModule.getDB();
    db.users.push({ username: 'admin', email: 'admin@example.com', fullName: 'Admin', role: 'Owner/Admin', activeOrganizationId: 'org-force' });
    db.organizations.push({ id: 'org-force', name: 'Force Save Estate' });
    db.memberships.push({ id: 'mem-force', userId: 'admin', organizationId: 'org-force', role: 'Owner/Admin' });
    db.orgData['org-force'] = dbModule.createEmptyUserData();
    db.orgData['org-force'].lots.push({ id: 'lot-force', code: 'FS-2026' } as any);

    const status = await dbModule.forceSaveDB();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.organizationState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-force' },
      update: expect.objectContaining({
        updatedBy: 'admin-force-save',
      }),
    }));
    expect(status.postgres.lastSaveAt).toBeTruthy();
    expect(status.postgres.lastSaveError).toBeNull();
    expect(JSON.parse(fs.readFileSync(dbPath, 'utf8')).orgData['org-force'].lots).toContainEqual(expect.objectContaining({ id: 'lot-force' }));
  });

  it('saveUserData can conditionally update the PostgreSQL JSONB state by version', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const tx = {
      organization: { upsert: vi.fn(async () => ({})) },
      organizationState: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = {
      organizationState: {
        findUnique: vi.fn(async () => ({
          organizationId: 'org-versioned',
          version: 8,
          updatedAt: new Date('2026-06-30T12:00:00.000Z'),
          updatedBy: 'api-sync:admin',
        })),
      },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);

    const db = dbModule.getDB();
    db.users.push({ username: 'admin', email: 'admin@example.com', fullName: 'Admin', role: 'Owner/Admin', activeOrganizationId: 'org-versioned' });
    db.organizations.push({ id: 'org-versioned', name: 'Versioned Estate' });
    db.memberships.push({ id: 'mem-versioned', userId: 'admin', organizationId: 'org-versioned', role: 'Owner/Admin' });

    const data = dbModule.createEmptyUserData();
    data.tasks.push({ id: 'task-versioned', title: 'Rack Saperavi' });

    await dbModule.saveUserData('admin', data, { expectedVersion: 7, updatedBy: 'api-sync:admin' });

    expect(tx.organizationState.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-versioned', version: 7 },
      data: expect.objectContaining({
        version: { increment: 1 },
        updatedBy: 'api-sync:admin',
      }),
    }));
    expect(prisma.organizationState.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-versioned' },
    }));
    const runtimeStatus = dbModule.getDbRuntimeStatus();
    expect(runtimeStatus.organizationStates).toMatchObject({
      trackedCount: 1,
      latestOrganizationId: 'org-versioned',
      latestVersion: 8,
    });
    expect(runtimeStatus.organizationStates.states[0]).toMatchObject({
      organizationId: 'org-versioned',
      organizationName: 'Versioned Estate',
      version: 8,
      updatedBy: 'api-sync:admin',
    });
  });

  it('saveUserData rejects stale PostgreSQL JSONB versions without saving the local fallback snapshot', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const tx = {
      organization: { upsert: vi.fn(async () => ({})) },
      organizationState: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const prisma = {
      organizationState: {
        findUnique: vi.fn(async () => null),
      },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);

    const db = dbModule.getDB();
    db.users.push({ username: 'admin', email: 'admin@example.com', fullName: 'Admin', role: 'Owner/Admin', activeOrganizationId: 'org-stale' });
    db.organizations.push({ id: 'org-stale', name: 'Stale Estate' });
    db.memberships.push({ id: 'mem-stale', userId: 'admin', organizationId: 'org-stale', role: 'Owner/Admin' });

    const data = dbModule.createEmptyUserData();
    data.tasks.push({ id: 'task-stale', title: 'Should not hit local snapshot' });

    await expect(dbModule.saveUserData('admin', data, { expectedVersion: 12, updatedBy: 'api-sync:admin' }))
      .rejects
      .toBeInstanceOf(dbModule.OrganizationStateVersionConflictError);

    expect(tx.organizationState.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-stale', version: 12 },
    }));
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('refreshCoreMetadataFromPostgres hydrates normalized auth and organization rows into memory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const prisma = {
      user: { findMany: vi.fn(async () => [{ username: 'owner', email: 'owner@example.com', fullName: 'Owner', role: 'Owner/Admin', language: 'en', passwordHash: 'hash', emailVerified: true, activeOrganizationId: 'org-core' }]) },
      organization: { findMany: vi.fn(async () => [{ id: 'org-core', name: 'Core Estate' }]) },
      membership: { findMany: vi.fn(async () => [{ id: 'mem-core', userId: 'owner', organizationId: 'org-core', role: 'Owner/Admin' }]) },
      invitation: { findMany: vi.fn(async () => []) },
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);

    const refreshed = await dbModule.refreshCoreMetadataFromPostgres();
    const db = dbModule.getDB();

    expect(refreshed).toBe(true);
    expect(db.users).toContainEqual(expect.objectContaining({ username: 'owner', activeOrganizationId: 'org-core' }));
    expect(db.organizations).toContainEqual(expect.objectContaining({ id: 'org-core', name: 'Core Estate' }));
    expect(db.memberships).toContainEqual(expect.objectContaining({ id: 'mem-core', userId: 'owner' }));
    expect(db.orgData['org-core']).toBeTruthy();
  });

  it('saveCoreMetadata waits for normalized auth/org metadata persistence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const tx = {
      organization: { upsert: vi.fn(async () => ({})) },
      user: { upsert: vi.fn(async () => ({})) },
      membership: { upsert: vi.fn(async () => ({})) },
      invitation: { upsert: vi.fn(async () => ({})) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);

    const db = dbModule.getDB();
    db.users.push({ username: 'owner', email: 'owner@example.com', fullName: 'Owner', role: 'Owner/Admin', language: 'en', passwordHash: 'hash', emailVerified: true, activeOrganizationId: 'org-core' });
    db.organizations.push({ id: 'org-core', name: 'Core Estate' });
    db.memberships.push({ id: 'mem-core', userId: 'owner', organizationId: 'org-core', role: 'Owner/Admin' });
    db.invitations.push({ id: 'invite-core', email: 'guest@example.com', organizationId: 'org-core', role: 'Read-Only', token: 'token-core', expiresAt: '2026-07-08T00:00:00.000Z' });

    await dbModule.saveCoreMetadata('test-core-metadata');

    expect(tx.organization.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-core' } }));
    expect(tx.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { username: 'owner' } }));
    expect(tx.membership.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mem-core' } }));
    expect(tx.invitation.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'invite-core' } }));
    expect(JSON.parse(fs.readFileSync(dbPath, 'utf8')).users).toContainEqual(expect.objectContaining({ username: 'owner' }));
  });

  it('deleteUserMetadataFromPostgres removes a user through normalized PostgreSQL metadata', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const prisma = {
      user: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);

    await dbModule.deleteUserMetadataFromPostgres('old-owner');

    expect(prisma.user.deleteMany).toHaveBeenCalledWith({ where: { username: 'old-owner' } });
  });

  it('reports PostgreSQL readiness when required Prisma models are readable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const readableModel = () => ({ count: vi.fn(async () => 0) });
    const prisma = {
      user: readableModel(),
      organization: readableModel(),
      membership: readableModel(),
      invitation: readableModel(),
      organizationState: readableModel(),
      loginAttempt: readableModel(),
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);

    const probe = await dbModule.getPostgresReadinessProbe();

    expect(probe).toMatchObject({
      ok: true,
      configured: true,
      usable: true,
      target: 'postgresql://localhost:5432/cellarflow',
      checks: {
        coreMetadataRead: true,
        organizationStateRead: true,
        loginAttemptStoreRead: true,
      },
      errors: [],
    });
    expect(prisma.user.count).toHaveBeenCalledTimes(1);
    expect(prisma.loginAttempt.count).toHaveBeenCalledTimes(1);
  });

  it('reports PostgreSQL readiness errors when the LoginAttempt model is missing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const readableModel = () => ({ count: vi.fn(async () => 0) });
    const prisma = {
      user: readableModel(),
      organization: readableModel(),
      membership: readableModel(),
      invitation: readableModel(),
      organizationState: readableModel(),
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);

    const probe = await dbModule.getPostgresReadinessProbe();

    expect(probe.ok).toBe(false);
    expect(probe.checks).toMatchObject({
      coreMetadataRead: true,
      organizationStateRead: true,
      loginAttemptStoreRead: false,
    });
    expect(probe.errors.some((error: string) => error.includes('LoginAttempt Prisma model is not available'))).toBe(true);
  });
});
