import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const organizationId = 'org-cellar-operation-route';
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');
let storeAvailable = true;
let storedState: any;
let storedCommands = new Map<string, any>();

function initialState() {
  return {
    companyProfile: { currency: 'USD' },
    lots: [{
      id: 'LOT-CELLAR-1', name: 'Route Saperavi', vintage: 2026, variety: 'Saperavi',
      vineyardBlock: 'Block A', region: 'Kakheti', initialVolume: 1_000, currentVolume: 920,
      wineClass: 'red', stage: 'aging', createdAt: '2026-09-01', history: [],
    }],
    vessels: [{
      id: 'TANK-CELLAR-1', type: 'stainless_steel', shape: 'vertical', capacity: 1_200,
      currentVolume: 920, assignedLotId: 'LOT-CELLAR-1', cleaningStatus: 'clean',
      lastCleaned: '2026-09-01', temperature: 16, coolingJacketActive: false,
      targetTemperature: null, lastOperation: 'Filled',
    }],
    inventory: [{
      id: 'INV-SO2', name: 'Potassium metabisulfite', category: 'additives', stock: 5,
      minThreshold: 1, unit: 'kg', costPerUnit: 20, supplierName: 'Route Enology',
    }],
    cellarOps: [],
    costEntries: [],
    auditLogs: [],
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
    username: 'operation-owner', email: 'operation-owner@example.test', fullName: 'Operation Owner',
    role, activeOrganizationId: organizationId, accountEnabled: true, sessionVersion: 1,
  }];
  db.organizations = [{ id: organizationId, name: 'Cellar Operation Estate' }];
  db.memberships = [{ id: 'membership-operation-owner', userId: 'operation-owner', organizationId, role }];
  db.invitations = [];
  db.orgData = { [organizationId]: initialState() };
}

function sessionCookie(): string {
  const token = authModule.createSessionToken({
    username: 'operation-owner', role: 'Owner/Admin', sessionVersion: 1,
  });
  return `maranios_session=${token}`;
}

const materialPayload = {
  operationId: 'OP-ROUTE-1',
  auditId: 'AUDIT-ROUTE-1',
  operation: {
    date: '2026-09-10', type: 'sulfitation', lotId: 'LOT-CELLAR-1',
    vesselId: 'TANK-CELLAR-1', vesselToId: null, materialId: 'INV-SO2', dose: 0.2,
    operator: 'Route Winemaker', notes: 'Protection dose.',
  },
};

async function postCommand(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/cellar.operation`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', cookie: sessionCookie(), 'x-cellarflow-org-id': organizationId,
    },
    body: JSON.stringify(body),
  });
}

async function postReversal(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/cellar.operation.reverse`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', cookie: sessionCookie(), 'x-cellarflow-org-id': organizationId,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  vi.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-cellar-operation-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'cellar-operation-route-test-secret-32-bytes',
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
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
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
    createdAt: new Date('2026-09-10T00:00:00.000Z'),
    updatedAt: new Date('2026-09-10T00:00:00.000Z'),
  };
  resetDb();
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env = { ...originalEnv };
  vi.doUnmock('../server/db');
  vi.resetModules();
});

describe.sequential('cellar.operation command route', () => {
  it('commits every linked ledger using authoritative currency', async () => {
    const response = await postCommand({ commandId: 'cmd-route-operation-0001', payload: materialPayload });
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      disposition: 'executed',
      result: {
        operation: { id: materialPayload.operationId, commandId: 'cmd-route-operation-0001' },
        inventoryItem: { id: 'INV-SO2', stock: 4.8 },
        costEntry: { amount: 4, currency: 'USD' },
        stateVersion: 2,
      },
      collections: { cellarOps: [expect.objectContaining({ id: materialPayload.operationId })] },
    });
    expect(storedState.data.lots[0].history).toHaveLength(1);
    expect(storedState.data.vessels[0].lastOperation).toContain('Potassium metabisulfite');
    expect(storedState.data.auditLogs[0].chainHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('replays one result without duplicating any ledger effect', async () => {
    const request = { commandId: 'cmd-route-operation-0002', payload: materialPayload };
    expect((await postCommand(request)).status).toBe(201);
    const replay = await postCommand(request);

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(2);
    expect(storedState.data.inventory[0].stock).toBe(4.8);
    expect(storedState.data.cellarOps).toHaveLength(1);
    expect(storedState.data.costEntries).toHaveLength(1);
    expect(storedState.data.auditLogs).toHaveLength(1);
  });

  it('reverses every linked ledger and replays the same compensation once', async () => {
    expect((await postCommand({
      commandId: 'cmd-route-operation-for-reversal', payload: materialPayload,
    })).status).toBe(201);
    const request = {
      commandId: 'cmd-route-operation-reversal',
      payload: {
        reversalOperationId: 'OP-ROUTE-REVERSAL',
        auditId: 'AUDIT-ROUTE-REVERSAL',
        costReversalId: 'COST-ROUTE-REVERSAL',
        originalCommandId: 'cmd-route-operation-for-reversal',
        reason: 'Wrong lot selected at posting.',
      },
    };
    const response = await postReversal(request);
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      result: {
        originalOperation: { id: 'OP-ROUTE-1', reversedByCommandId: request.commandId },
        reversalOperation: {
          id: 'OP-ROUTE-REVERSAL', recordKind: 'reversal', reversalOfOperationId: 'OP-ROUTE-1',
        },
        updatedLot: { currentVolume: 920, lastCommandId: request.commandId },
        updatedVessel: { currentVolume: 920, lastOperation: 'Filled' },
        updatedInventoryItem: { stock: 5 },
        reversalCostEntry: { id: 'COST-ROUTE-REVERSAL', amount: -4, recordKind: 'reversal' },
        stateVersion: 3,
      },
    });
    expect(storedState.data.cellarOps).toHaveLength(2);
    expect(storedState.data.costEntries).toHaveLength(2);
    expect(storedState.data.auditLogs).toHaveLength(2);

    const replay = await postReversal(request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(3);
    expect(storedState.data.cellarOps).toHaveLength(2);
  });

  it('denies operation reversal without the full compensation permission set', async () => {
    resetDb('Winemaker');
    const response = await postReversal({
      commandId: 'cmd-route-operation-reversal-forbidden',
      payload: {
        reversalOperationId: 'OP-ROUTE-REVERSAL-FORBIDDEN',
        auditId: 'AUDIT-ROUTE-REVERSAL-FORBIDDEN',
        costReversalId: 'COST-ROUTE-REVERSAL-FORBIDDEN',
        originalCommandId: 'cmd-route-operation-original',
        reason: 'Correction requested.',
      },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'forbidden_cellar_operation_reversal' },
    });
    expect(storedCommands.size).toBe(0);
  });

  it('rolls back the claim and every ledger when material is insufficient', async () => {
    const response = await postCommand({
      commandId: 'cmd-route-operation-0003',
      payload: { ...materialPayload, operation: { ...materialPayload.operation, dose: 5.001 } },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'insufficient_operation_material' } });
    expect(storedState.version).toBe(1);
    expect(storedState.data.inventory[0].stock).toBe(5);
    expect(storedState.data.cellarOps).toEqual([]);
    expect(storedState.data.costEntries).toEqual([]);
    expect(storedState.data.auditLogs).toEqual([]);
    expect(storedCommands.size).toBe(0);
  });

  it('allows a Winemaker to consume material while the linked cost remains system-generated', async () => {
    resetDb('Winemaker');
    const corePayload = {
      operationId: 'OP-ROUTE-CORE',
      auditId: 'AUDIT-ROUTE-CORE',
      operation: {
        date: '2026-09-10', type: 'measurement', lotId: 'LOT-CELLAR-1',
        vesselId: 'TANK-CELLAR-1', vesselToId: null,
        operator: 'Route Winemaker', notes: 'Temperature checked.',
      },
    };
    expect((await postCommand({ commandId: 'cmd-route-operation-0004', payload: corePayload })).status).toBe(201);

    storedCommands = new Map();
    storedState = { ...storedState, data: initialState(), version: 1 };
    const materialOperation = await postCommand({
      commandId: 'cmd-route-operation-0005',
      payload: materialPayload,
    });
    expect(materialOperation.status).toBe(201);
    expect(await materialOperation.json()).toMatchObject({
      ok: true,
      result: {
        operation: { id: materialPayload.operationId, materialId: 'INV-SO2', dose: 0.2 },
        inventoryItem: { id: 'INV-SO2', stock: 4.8 },
        costEntry: { amount: 4, sourceRef: materialPayload.operationId },
      },
    });
    expect(storedState.version).toBe(2);
    expect(storedState.data.inventory[0].stock).toBe(4.8);
    expect(storedState.data.costEntries).toHaveLength(1);
  });

  it('denies roles without core operation authority before claiming a command', async () => {
    resetDb('Cellar Worker');
    const response = await postCommand({ commandId: 'cmd-route-operation-0006', payload: materialPayload });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_cellar_operation' } });
    expect(storedState.version).toBe(1);
    expect(storedCommands.size).toBe(0);
  });

  it('fails retryably before mutation when durable storage is unavailable', async () => {
    storeAvailable = false;
    const response = await postCommand({ commandId: 'cmd-route-operation-0007', payload: materialPayload });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'command_store_unavailable', retryable: true },
    });
    expect(storedState.version).toBe(1);
  });
});
