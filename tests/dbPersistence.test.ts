import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '../server/emailVerification';

const originalEnv = { ...process.env };

async function loadDbModule(dbPath: string) {
  vi.resetModules();
  vi.doUnmock('@prisma/client');
  process.env = {
    ...originalEnv,
    DATABASE_PATH: dbPath,
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

  it('normalizes legacy JSON invitation bearers into hashes without persisting the raw value', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    fs.writeFileSync(dbPath, JSON.stringify({
      users: [],
      organizations: [],
      memberships: [],
      invitations: [{
        id: 'legacy-invite',
        email: 'guest@example.com',
        organizationId: 'org-legacy',
        role: 'Read-Only',
        token: 'raw-legacy-bearer',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }],
      orgData: {},
    }), 'utf8');
    const dbModule = await loadDbModule(dbPath);

    await dbModule.initDB();

    expect(dbModule.getDB().invitations[0]).toMatchObject({
      tokenHash: hashToken('raw-legacy-bearer'),
    });
    expect(dbModule.getDB().invitations[0].token).toBeUndefined();
    expect(fs.readFileSync(dbPath, 'utf8')).not.toContain('raw-legacy-bearer');
  });

  it('claims an invitation only once and applies its membership atomically in JSON fallback mode', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const dbModule = await loadDbModule(dbPath);
    const db = dbModule.getDB();
    const tokenHash = hashToken('single-use-invite');
    db.users.push({
      username: 'guest',
      email: 'guest@example.com',
      emailVerified: true,
      sessionVersion: 1,
    });
    db.organizations.push({ id: 'org-atomic', name: 'Atomic Estate' });
    db.invitations.push({
      id: 'invite-atomic',
      email: 'guest@example.com',
      organizationId: 'org-atomic',
      role: 'Winemaker',
      tokenHash,
      expiresAt: '2030-01-01T00:00:00.000Z',
      acceptedAt: null,
    });

    const results = await Promise.all([
      dbModule.acceptInvitationAtomically(tokenHash, 'guest', new Date('2029-01-01T00:00:00.000Z')),
      dbModule.acceptInvitationAtomically(tokenHash, 'guest', new Date('2029-01-01T00:00:00.000Z')),
    ]);

    expect(results.map(result => result.status).sort()).toEqual(['already_accepted', 'success']);
    expect(db.memberships).toContainEqual(expect.objectContaining({
      userId: 'guest',
      organizationId: 'org-atomic',
      role: 'Winemaker',
    }));
    expect(db.memberships.filter(membership => membership.organizationId === 'org-atomic')).toHaveLength(1);
    expect(db.users[0].activeOrganizationId).toBe('org-atomic');
  });

  it('uses a conditional PostgreSQL transaction as the invitation concurrency gate', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const invite = {
      id: 'invite-postgres',
      email: 'guest@example.com',
      organizationId: 'org-postgres',
      role: 'Read-Only',
      tokenHash: hashToken('postgres-invite'),
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      acceptedAt: null,
      createdAt: new Date('2029-01-01T00:00:00.000Z'),
    };
    const user = {
      username: 'guest', email: 'guest@example.com', fullName: 'Guest', role: 'Read-Only',
      language: 'en', passwordHash: 'hash', emailVerified: true, activeOrganizationId: null,
      enabledModules: [], enabledWidgets: [], registrationComplete: true, sessionVersion: 1,
    };
    const tx = {
      invitation: {
        findUnique: vi.fn(async () => invite),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      user: {
        findUnique: vi.fn(async () => user),
        update: vi.fn(async () => ({})),
      },
      membership: { upsert: vi.fn(async () => ({})) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: any) => callback(tx)),
      user: { findMany: vi.fn(async () => [{ ...user, activeOrganizationId: 'org-postgres' }]) },
      organization: { findMany: vi.fn(async () => [{ id: 'org-postgres', name: 'Postgres Estate' }]) },
      membership: { findMany: vi.fn(async () => [{
        id: 'mem-postgres', userId: 'guest', organizationId: 'org-postgres', role: 'Read-Only',
      }]) },
      invitation: { findMany: vi.fn(async () => [{ ...invite, acceptedAt: new Date('2029-01-01T00:00:00.000Z') }]) },
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);
    const now = new Date('2029-01-01T00:00:00.000Z');

    const result = await dbModule.acceptInvitationAtomically(invite.tokenHash, 'guest', now);

    expect(result).toEqual({ status: 'success', organizationId: 'org-postgres', role: 'Read-Only' });
    expect(tx.invitation.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite-postgres', acceptedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    expect(tx.membership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_organizationId: { userId: 'guest', organizationId: 'org-postgres' } },
    }));
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { username: 'guest' },
      data: { activeOrganizationId: 'org-postgres' },
    });
  });

  it('filters bearer-shaped metadata from security audit events', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const dbModule = await loadDbModule(dbPath);

    await dbModule.recordSecurityAuditEvent({
      eventType: 'invitation.created',
      username: 'owner',
      ipHash: 'hashed-ip',
      metadata: { purpose: 'invitation', token: 'must-not-persist' },
    });

    const saved = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    expect(saved.securityAuditEvents[0]).toMatchObject({
      eventType: 'invitation.created',
      ipHash: 'hashed-ip',
      metadata: { purpose: 'invitation' },
    });
    expect(JSON.stringify(saved.securityAuditEvents[0])).not.toContain('must-not-persist');
    await expect(dbModule.listSecurityAuditEvents(10)).resolves.toEqual([
      expect.objectContaining({ eventType: 'invitation.created' }),
    ]);
  });

  it('fails closed in production when configured PostgreSQL cannot initialize', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const connectionError = new Error('PostgreSQL unavailable');
    const prisma = {
      user: { findMany: vi.fn(async () => { throw connectionError; }) },
      $disconnect: vi.fn(async () => undefined),
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);
    process.env.NODE_ENV = 'production';

    await expect(dbModule.initDB()).rejects.toBe(connectionError);

    expect(prisma.$disconnect).toHaveBeenCalledOnce();
    expect(fs.existsSync(dbPath)).toBe(false);
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
      user: { findMany: vi.fn(async () => [{
        username: 'owner', email: 'owner@example.com', fullName: 'Owner', role: 'Owner/Admin',
        language: 'en', passwordHash: 'hash', emailVerified: true, activeOrganizationId: 'org-core',
        resetTokenHash: 'reset-hash', resetTokenExpires: BigInt(1_800_000_000_000),
      }]) },
      organization: { findMany: vi.fn(async () => [{ id: 'org-core', name: 'Core Estate' }]) },
      membership: { findMany: vi.fn(async () => [{ id: 'mem-core', userId: 'owner', organizationId: 'org-core', role: 'Owner/Admin' }]) },
      invitation: { findMany: vi.fn(async () => []) },
    };
    const dbModule = await loadDbModuleWithMockPrisma(dbPath, prisma);

    const refreshed = await dbModule.refreshCoreMetadataFromPostgres();
    const db = dbModule.getDB();

    expect(refreshed).toBe(true);
    expect(db.users).toContainEqual(expect.objectContaining({
      username: 'owner',
      activeOrganizationId: 'org-core',
      resetTokenHash: 'reset-hash',
      resetTokenExpires: 1_800_000_000_000,
    }));
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
    db.users.push({
      username: 'owner', email: 'owner@example.com', fullName: 'Owner', role: 'Owner/Admin',
      language: 'en', passwordHash: 'hash', emailVerified: true, activeOrganizationId: 'org-core',
      resetTokenHash: 'reset-hash', resetTokenExpires: 1_800_000_000_000,
    });
    db.organizations.push({ id: 'org-core', name: 'Core Estate' });
    db.memberships.push({ id: 'mem-core', userId: 'owner', organizationId: 'org-core', role: 'Owner/Admin' });
    db.invitations.push({ id: 'invite-core', email: 'guest@example.com', organizationId: 'org-core', role: 'Read-Only', token: 'token-core', expiresAt: '2026-07-08T00:00:00.000Z' });

    await dbModule.saveCoreMetadata('test-core-metadata');

    expect(tx.organization.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-core' } }));
    expect(tx.user.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { username: 'owner' },
      update: expect.objectContaining({
        resetTokenHash: 'reset-hash',
        resetTokenExpires: BigInt(1_800_000_000_000),
      }),
    }));
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
    const readableModel = () => ({
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    });
    const prisma = {
      user: readableModel(),
      organization: readableModel(),
      membership: readableModel(),
      invitation: readableModel(),
      organizationState: readableModel(),
      loginAttempt: readableModel(),
      securityAuditEvent: readableModel(),
      organizationSubscription: readableModel(),
      billingPayment: readableModel(),
      subscriptionRequest: readableModel(),
      subscriptionAudit: readableModel(),
      annualProductionUsage: readableModel(),
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
        securityAuditStoreRead: true,
        billingStorageRead: true,
      },
      errors: [],
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({ take: 1 });
    expect(prisma.loginAttempt.findMany).toHaveBeenCalledWith({ take: 1 });
    expect(prisma.securityAuditEvent.findMany).toHaveBeenCalledWith({ take: 1 });
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.loginAttempt.count).not.toHaveBeenCalled();
    expect(prisma.securityAuditEvent.count).not.toHaveBeenCalled();
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
      securityAuditEvent: readableModel(),
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
