import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const organizationId = 'org-bottling-route';
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');
let storeAvailable = true;
let storedState: any;
let storedCommands = new Map<string, any>();

function initialBottlingState() {
  return {
    companyProfile: { currency: 'USD' },
    lots: [{
      id: 'LOT-A',
      name: 'Route Saperavi',
      vintage: 2025,
      variety: 'Saperavi',
      vineyardBlock: 'Block A',
      region: 'Kakheti',
      initialVolume: 200,
      currentVolume: 200,
      wineClass: 'red',
      stage: 'aging',
      createdAt: '2025-10-01',
      history: [],
    }],
    vessels: [{
      id: 'TANK-A', type: 'stainless_steel', shape: 'vertical', capacity: 300,
      currentVolume: 200, assignedLotId: 'LOT-A', cleaningStatus: 'clean',
      lastCleaned: '2026-07-01', temperature: 14, coolingJacketActive: false,
      targetTemperature: null, lastOperation: 'Aging',
    }],
    bottlingRuns: [],
    inventory: [{
      id: 'BOTTLE',
      name: '750 ml bottle',
      category: 'packaging',
      stock: 150,
      minThreshold: 0,
      unit: 'unit',
      costPerUnit: 0.5,
      supplierName: 'Route Glass',
    }],
    costEntries: [],
    storageLocations: [{ id: 'STORE-A', name: 'Route warehouse', type: 'warehouse', capacityBottles: 500 }],
    stockMovements: [],
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
            if (!transactionState) throw new Error('missing organization state');
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
              ...data,
              result: null,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
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
    username: 'bottling-owner',
    email: 'bottling-owner@example.test',
    fullName: 'Bottling Owner',
    role,
    activeOrganizationId: organizationId,
    accountEnabled: true,
    sessionVersion: 1,
  }];
  db.organizations = [{ id: organizationId, name: 'Bottling Route Estate' }];
  db.memberships = [{
    id: 'membership-bottling-owner',
    userId: 'bottling-owner',
    organizationId,
    role,
  }];
  db.invitations = [];
  db.orgData = { [organizationId]: initialBottlingState() };
}

function sessionCookie(): string {
  const token = authModule.createSessionToken({
    username: 'bottling-owner',
    role: 'Owner/Admin',
    sessionVersion: 1,
  });
  return `maranios_session=${token}`;
}

const basePayload = {
  runId: 'bot-route-0001',
  lotId: 'LOT-A',
  sourceVesselId: 'TANK-A',
  date: '2026-07-20',
  lotNumber: 'ROUTE-01',
  operator: 'Route Winemaker',
  formats: { '0.75': 100 },
  packagingSelections: { bottle: 'BOTTLE' },
  bottlesPerBox: 6,
  bottlingServiceCost: 25,
  storageLocationId: 'STORE-A',
};

async function postCommand(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/cellar.bottling`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sessionCookie(),
      'x-cellarflow-org-id': organizationId,
    },
    body: JSON.stringify(body),
  });
}

async function postReversal(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/cellar.bottling.reverse`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sessionCookie(),
      'x-cellarflow-org-id': organizationId,
    },
    body: JSON.stringify(body),
  });
}

const reversalPayload = {
  reversalRunId: 'bot-route-reversal-0001',
  storageReturnMovementId: 'mov-route-bottling-reversal-0001',
  packagingCostReversalId: 'cost-route-packaging-reversal-0001',
  serviceCostReversalId: 'cost-route-service-reversal-0001',
  originalCommandId: 'cmd-route-bottling-reversible',
  reason: 'Duplicate bottling posting',
};

beforeAll(async () => {
  vi.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-bottling-command-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'bottling-command-route-test-secret-32-bytes',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(root, 'db.json'),
    GCS_BUCKET: '',
  };

  vi.doMock('../server/db', async () => {
    const actual = await vi.importActual<typeof import('../server/db')>('../server/db');
    return {
      ...actual,
      getPrismaClientForAdmin: vi.fn(async () => storeAvailable ? prisma : null),
      reloadOrganizationDataFromPostgres: vi.fn(async (orgId: string) => orgId === organizationId && storedState
        ? {
          data: storedState.data,
          meta: {
            organizationId,
            version: storedState.version,
            updatedAt: storedState.updatedAt.toISOString(),
            updatedBy: storedState.updatedBy,
            source: 'postgres' as const,
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
    data: initialBottlingState(),
    version: 1,
    updatedBy: null,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
  };
  resetDb();
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env = { ...originalEnv };
  vi.doUnmock('../server/db');
  vi.resetModules();
});

describe.sequential('cellar.bottling command route', () => {
  it('commits all bottling ledgers and returns authoritative collections', async () => {
    const response = await postCommand({ commandId: 'cmd-route-bottling-0001', payload: basePayload });
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      disposition: 'executed',
      result: {
        run: { id: 'bot-route-0001', commandId: 'cmd-route-bottling-0001' },
        stateVersion: 2,
      },
      collections: {
        bottlingRuns: [expect.objectContaining({ id: 'bot-route-0001' })],
      },
    });
    expect(storedState.data.lots[0]).toMatchObject({ currentVolume: 125, stage: 'aging' });
    expect(storedState.data.vessels[0]).toMatchObject({ currentVolume: 125, assignedLotId: 'LOT-A' });
    expect(storedState.data.inventory[0].stock).toBe(50);
    expect(storedState.data.costEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: 50, currency: 'USD' }),
      expect.objectContaining({ amount: 25, currency: 'USD' }),
    ]));
    expect(storedState.data.stockMovements).toHaveLength(1);
  });

  it('replays the original result without applying any ledger twice', async () => {
    const request = { commandId: 'cmd-route-bottling-0002', payload: { ...basePayload, runId: 'bot-route-0002' } };
    expect((await postCommand(request)).status).toBe(201);
    const replay = await postCommand(request);

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(2);
    expect(storedState.data.bottlingRuns).toHaveLength(1);
    expect(storedState.data.inventory[0].stock).toBe(50);
  });

  it('rolls back the command claim and every ledger when an invariant fails', async () => {
    const response = await postCommand({
      commandId: 'cmd-route-bottling-0003',
      payload: { ...basePayload, formats: { '0.75': 151 } },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'insufficient_packaging_stock' } });
    expect(storedState.version).toBe(1);
    expect(storedState.data.bottlingRuns).toEqual([]);
    expect(storedState.data.inventory[0].stock).toBe(150);
    expect(storedCommands.size).toBe(0);
  });

  it('allows a winemaker core run but rejects owner-only costing and storage side effects', async () => {
    resetDb('Winemaker');
    const core = await postCommand({
      commandId: 'cmd-route-bottling-0004',
      payload: {
        ...basePayload,
        runId: 'bot-route-0004',
        packagingSelections: {},
        bottlingServiceCost: 0,
        storageLocationId: '',
      },
    });
    expect(core.status).toBe(201);

    storedCommands = new Map();
    storedState = { ...storedState, data: initialBottlingState(), version: 1 };
    const restricted = await postCommand({
      commandId: 'cmd-route-bottling-0005',
      payload: { ...basePayload, runId: 'bot-route-0005' },
    });
    expect(restricted.status).toBe(403);
    expect(await restricted.json()).toMatchObject({ error: { code: 'forbidden_bottling_costing' } });
    expect(storedState.version).toBe(1);
  });

  it('denies roles without core bottling authority before claiming a command', async () => {
    resetDb('Cellar Worker');
    const response = await postCommand({ commandId: 'cmd-route-bottling-0006', payload: basePayload });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_bottling' } });
    expect(storedState.version).toBe(1);
    expect(storedCommands.size).toBe(0);
  });

  it('fails retryably before mutation when durable command storage is unavailable', async () => {
    storeAvailable = false;
    const response = await postCommand({ commandId: 'cmd-route-bottling-0007', payload: basePayload });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'command_store_unavailable', retryable: true },
    });
    expect(storedState.version).toBe(1);
  });

  it('compensates a command-created run atomically and replays without duplication', async () => {
    const original = await postCommand({
      commandId: 'cmd-route-bottling-reversible',
      payload: { ...basePayload, runId: 'bot-route-reversible' },
    });
    expect(original.status).toBe(201);

    const request = { commandId: 'cmd-route-bottling-reversal-0001', payload: reversalPayload };
    const response = await postReversal(request);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      disposition: 'executed',
      result: {
        originalRun: { id: 'bot-route-reversible', reversedByCommandId: 'cmd-route-bottling-reversal-0001' },
        reversalRun: { id: 'bot-route-reversal-0001', recordKind: 'reversal' },
        receipt: { kind: 'bottling_reversal', restoredVolumeL: 75 },
        stateVersion: 3,
      },
    });
    expect(storedState.data.lots[0]).toMatchObject({ currentVolume: 200, stage: 'aging' });
    expect(storedState.data.inventory[0].stock).toBe(150);
    expect(storedState.data.bottlingRuns).toHaveLength(2);
    expect(storedState.data.stockMovements).toHaveLength(2);
    expect(storedState.data.costEntries.map((entry: any) => entry.amount)).toEqual([-50, -25, 50, 25]);

    const replay = await postReversal(request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(3);
    expect(storedState.data.bottlingRuns).toHaveLength(2);
  });

  it('rejects unauthorized or dependent reversals before committing a command claim', async () => {
    expect((await postCommand({
      commandId: 'cmd-route-bottling-reversible',
      payload: { ...basePayload, runId: 'bot-route-reversible' },
    })).status).toBe(201);

    resetDb('Winemaker');
    const forbidden = await postReversal({
      commandId: 'cmd-route-bottling-reversal-forbidden',
      payload: reversalPayload,
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error: { code: 'forbidden_bottling_reversal' } });

    resetDb();
    storedState.data.certificationRecords = [{
      id: 'CERT-1', lotId: 'LOT-A', bottlingRunId: 'bot-route-reversible', productType: 'wine',
      samplePrepared: true, labProtocolUploaded: true, applicationStatus: 'submitted',
    }];
    const dependent = await postReversal({
      commandId: 'cmd-route-bottling-reversal-dependent',
      payload: reversalPayload,
    });
    expect(dependent.status).toBe(409);
    expect(await dependent.json()).toMatchObject({
      error: { code: 'bottling_reversal_dependency_conflict' },
    });
    expect(storedCommands.has(commandKey(organizationId, 'cmd-route-bottling-reversal-dependent'))).toBe(false);
  });
});
