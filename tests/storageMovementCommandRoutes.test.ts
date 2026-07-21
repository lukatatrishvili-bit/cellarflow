import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const organizationId = 'org-storage-movement-route';
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');
let storeAvailable = true;
let storedState: any;
let storedCommands = new Map<string, any>();

function initialState() {
  return {
    lots: [{
      id: 'LOT-A', name: 'Route Saperavi', vintage: 2026, variety: 'Saperavi',
      vineyardBlock: 'Block A', region: 'Kakheti', initialVolume: 75, currentVolume: 0,
      wineClass: 'red', stage: 'bottled', createdAt: '2026-09-01', history: [],
    }],
    bottlingRuns: [{
      id: 'RUN-A', lotId: 'LOT-A', lotName: 'Route Saperavi', date: '2026-10-01',
      lotNumber: 'SAP-26', operator: 'Nino', formats: { '0.75': 100 },
      totalBottles: 100, totalCeramic: 0, volumeBottledL: 75,
    }],
    storageLocations: [{ id: 'STORE-A', name: 'Main warehouse', type: 'warehouse', capacityBottles: 100 }],
    stockMovements: [],
    salesOrders: [],
  };
}

function commandKey(orgId: string, commandId: string): string {
  return `${orgId}\u0000${commandId}`;
}

function fakePrismaClient(): PrismaClient {
  return {
    $transaction: async (callback: (transaction: any) => Promise<any>) => {
      let transactionState = structuredClone(storedState);
      const transactionCommands = new Map(
        [...storedCommands.entries()].map(([key, value]) => [key, structuredClone(value)]),
      );
      const transaction = {
        $queryRaw: async () => transactionState ? [{ organizationId }] : [],
        organizationState: {
          findUniqueOrThrow: async () => {
            if (!transactionState) throw new Error('missing organization state');
            return transactionState;
          },
          update: async ({ data }: any) => {
            transactionState = {
              ...transactionState,
              data: data.data,
              version: transactionState.version + Number(data.version?.increment || 0),
              updatedBy: data.updatedBy,
              updatedAt: new Date(),
            };
            return transactionState;
          },
        },
        commandExecution: {
          createMany: async ({ data }: any) => {
            const key = commandKey(data.organizationId, data.commandId);
            if (transactionCommands.has(key)) return { count: 0 };
            const now = new Date();
            transactionCommands.set(key, {
              ...data, result: null, createdAt: now, updatedAt: now, completedAt: null,
            });
            return { count: 1 };
          },
          findUnique: async ({ where }: any) => {
            const value = where.organizationId_commandId;
            return transactionCommands.get(commandKey(value.organizationId, value.commandId)) || null;
          },
          update: async ({ where, data }: any) => {
            const value = where.organizationId_commandId;
            const key = commandKey(value.organizationId, value.commandId);
            const current = transactionCommands.get(key);
            if (!current) throw new Error('missing command');
            const updated = { ...current, ...data, updatedAt: new Date() };
            transactionCommands.set(key, updated);
            return updated;
          },
        },
      };

      const result = await callback(transaction);
      storedState = transactionState;
      storedCommands = transactionCommands;
      return result;
    },
    commandExecution: {
      findUnique: async ({ where }: any) => {
        const value = where.organizationId_commandId;
        return storedCommands.get(commandKey(value.organizationId, value.commandId)) || null;
      },
    },
  } as unknown as PrismaClient;
}

const prisma = fakePrismaClient();

function resetDb(role = 'Owner/Admin') {
  const db = dbModule.getDB();
  db.users = [{
    username: 'storage-owner', email: 'storage-owner@example.test', fullName: 'Storage Owner',
    role, activeOrganizationId: organizationId, accountEnabled: true, sessionVersion: 1,
  }];
  db.organizations = [{ id: organizationId, name: 'Storage Route Estate' }];
  db.memberships = [{
    id: 'membership-storage-owner', userId: 'storage-owner', organizationId, role,
  }];
  db.invitations = [];
  db.orgData = { [organizationId]: initialState() };
}

function sessionCookie(): string {
  const token = authModule.createSessionToken({
    username: 'storage-owner', role: 'Owner/Admin', sessionVersion: 1,
  });
  return `maranios_session=${token}`;
}

const basePayload = {
  action: 'receive',
  movementId: 'mov-route-receive-0001',
  bottlingRunId: 'RUN-A',
  date: '2026-10-02',
  lotId: 'LOT-A',
  locationId: 'STORE-A',
  bottles: 60,
  note: '',
};

async function postCommand(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/storage.movement`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sessionCookie(),
      'x-cellarflow-org-id': organizationId,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  vi.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-storage-command-routes-'));
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'storage-command-route-test-secret-32-bytes';
  process.env.DATABASE_URL = '';
  process.env.DATABASE_PATH = path.join(root, 'db.json');
  process.env.GCS_BUCKET = '';

  vi.doMock('../server/db', async () => {
    const actual = await vi.importActual<typeof import('../server/db')>('../server/db');
    return {
      ...actual,
      getPrismaClientForAdmin: vi.fn(async () => storeAvailable ? prisma : null),
      reloadOrganizationDataFromPostgres: vi.fn(async (orgId: string) => orgId === organizationId && storedState
        ? {
          data: storedState.data,
          meta: {
            organizationId, version: storedState.version, updatedAt: storedState.updatedAt.toISOString(),
            updatedBy: storedState.updatedBy, source: 'postgres' as const,
          },
        }
        : null),
    };
  });

  const routes = await import('../server/routes/commands');
  dbModule = await import('../server/db');
  authModule = await import('../server/auth');
  const app = express();
  app.use(express.json());
  app.use('/api/commands', routes.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  storeAvailable = true;
  storedCommands = new Map();
  storedState = {
    organizationId,
    data: initialState(),
    version: 1,
    updatedBy: null,
    createdAt: new Date('2026-10-02T00:00:00.000Z'),
    updatedAt: new Date('2026-10-02T00:00:00.000Z'),
  };
  resetDb();
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  vi.doUnmock('../server/db');
  vi.resetModules();
});

describe.sequential('storage.movement command route', () => {
  it('commits the movement and linked bottling source together', async () => {
    const response = await postCommand({ commandId: 'cmd-route-storage-0001', payload: basePayload });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      disposition: 'executed',
      commandType: 'storage.movement',
      result: { stateVersion: 2, updatedBottlingRun: { id: 'RUN-A', placedInStorageBottles: 60 } },
      collections: { stockMovements: [expect.objectContaining({ id: 'mov-route-receive-0001' })] },
    });
    expect(storedState.data.bottlingRuns[0].storagePlacements).toHaveLength(1);
    expect(storedState.data.stockMovements).toHaveLength(1);
  });

  it('replays the original result without duplicating either linked effect', async () => {
    const request = { commandId: 'cmd-route-storage-0002', payload: { ...basePayload, movementId: 'mov-route-receive-0002' } };
    expect((await postCommand(request)).status).toBe(201);
    const replay = await postCommand(request);

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(2);
    expect(storedState.data.stockMovements).toHaveLength(1);
    expect(storedState.data.bottlingRuns[0].storagePlacements).toHaveLength(1);
  });

  it('rolls back the command claim and source update when capacity fails', async () => {
    storedState.data.storageLocations[0].capacityBottles = 50;
    const response = await postCommand({ commandId: 'cmd-route-storage-0003', payload: basePayload });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'storage_capacity_exceeded' } });
    expect(storedState.version).toBe(1);
    expect(storedState.data.stockMovements).toEqual([]);
    expect(storedState.data.bottlingRuns[0].storagePlacements).toBeUndefined();
    expect(storedCommands.size).toBe(0);
  });

  it('denies roles without storage creation authority before claiming a command', async () => {
    resetDb('Winemaker');
    const response = await postCommand({ commandId: 'cmd-route-storage-0004', payload: basePayload });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_storage_movement' } });
    expect(storedState.version).toBe(1);
    expect(storedCommands.size).toBe(0);
  });

  it('fails retryably before mutation when durable storage is unavailable', async () => {
    storeAvailable = false;
    const response = await postCommand({ commandId: 'cmd-route-storage-0005', payload: basePayload });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'command_store_unavailable', retryable: true },
    });
    expect(storedState.version).toBe(1);
  });
});
