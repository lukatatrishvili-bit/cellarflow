import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const organizationId = 'org-transfer-route';
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');
let storeAvailable = true;
let storedState: any;
let storedCommands = new Map<string, any>();

function initialTransferState() {
  const vessel = (id: string, currentVolume: number, assignedLotId: string | null, capacity = 1_000) => ({
    id,
    type: 'stainless_steel',
    shape: 'vertical',
    capacity,
    currentVolume,
    assignedLotId,
    cleaningStatus: 'clean',
    lastCleaned: '2026-07-19',
    temperature: 16,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: '',
  });
  return {
    vessels: [vessel('T-1', 600, 'LOT-A'), vessel('T-2', 0, null, 500)],
    lots: [{
      id: 'LOT-A',
      name: 'Route Saperavi',
      vintage: 2025,
      variety: 'Saperavi',
      vineyardBlock: 'Block A',
      region: 'Kakheti',
      initialVolume: 600,
      currentVolume: 600,
      wineClass: 'red',
      stage: 'aging',
      createdAt: '2025-10-01',
      history: [],
    }],
    transfers: [],
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
    username: 'transfer-owner',
    email: 'transfer-owner@example.test',
    fullName: 'Transfer Owner',
    role,
    activeOrganizationId: organizationId,
    accountEnabled: true,
    sessionVersion: 1,
  }];
  db.organizations = [{ id: organizationId, name: 'Transfer Route Estate' }];
  db.memberships = [{
    id: 'membership-transfer-owner',
    userId: 'transfer-owner',
    organizationId,
    role,
  }];
  db.invitations = [];
  db.orgData = { [organizationId]: initialTransferState() };
}

function sessionCookie(): string {
  const token = authModule.createSessionToken({
    username: 'transfer-owner',
    role: 'Owner/Admin',
    sessionVersion: 1,
  });
  return `maranios_session=${token}`;
}

const basePayload = {
  transferId: 'xfer-route-0001',
  blendLotId: 'blend-route-0001',
  sourceVesselId: 'T-1',
  destinationVesselId: 'T-2',
  volumeLiters: 200,
  lossLiters: 5,
  operator: 'Route Winemaker',
  category: 'racking',
  pump: 'Route Pump',
};

async function postCommand(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/cellar.transfer`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sessionCookie(),
      'x-cellarflow-org-id': organizationId,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function postReversal(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/cellar.transfer.reverse`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sessionCookie(),
      'x-cellarflow-org-id': organizationId,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  vi.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-transfer-command-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'transfer-command-route-test-secret-32-bytes',
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
    data: initialTransferState(),
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

describe.sequential('cellar.transfer command route', () => {
  it('commits the complete transfer and returns authoritative collections', async () => {
    const response = await postCommand({ commandId: 'cmd-route-transfer-0001', payload: basePayload });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      disposition: 'executed',
      result: {
        transfer: { id: 'xfer-route-0001', commandId: 'cmd-route-transfer-0001' },
        stateVersion: 2,
      },
      collections: {
        transfers: [expect.objectContaining({ id: 'xfer-route-0001' })],
      },
    });
    expect(storedState.version).toBe(2);
    expect(storedState.data.vessels.find((item: any) => item.id === 'T-1').currentVolume).toBe(400);
    expect(storedState.data.vessels.find((item: any) => item.id === 'T-2').currentVolume).toBe(195);
  });

  it('replays the original result without applying the transfer twice', async () => {
    const request = { commandId: 'cmd-route-transfer-0002', payload: { ...basePayload, transferId: 'xfer-route-0002' } };
    expect((await postCommand(request)).status).toBe(201);
    const replay = await postCommand(request);
    const body = await replay.json();

    expect(replay.status).toBe(200);
    expect(body.disposition).toBe('replayed');
    expect(storedState.version).toBe(2);
    expect(storedState.data.transfers).toHaveLength(1);
  });

  it('rejects changed payload reuse and rolls back failed invariant claims', async () => {
    const commandId = 'cmd-route-transfer-0003';
    expect((await postCommand({ commandId, payload: basePayload })).status).toBe(201);
    const reused = await postCommand({ commandId, payload: { ...basePayload, volumeLiters: 100 } });
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ error: { code: 'idempotency_key_reused' } });

    storedCommands = new Map();
    storedState = { ...storedState, data: initialTransferState(), version: 1 };
    const rejected = await postCommand({
      commandId: 'cmd-route-transfer-0004',
      payload: { ...basePayload, volumeLiters: 700 },
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ error: { code: 'insufficient_source_volume' } });
    expect(storedState.version).toBe(1);
    expect(storedCommands.size).toBe(0);
  });

  it('enforces the complete workflow permission boundary', async () => {
    resetDb('Cellar Worker');
    const response = await postCommand({ commandId: 'cmd-route-transfer-0005', payload: basePayload });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_transfer' } });
    expect(storedState.version).toBe(1);
    expect(storedCommands.size).toBe(0);
  });

  it('fails retryably before mutation when durable command storage is unavailable', async () => {
    storeAvailable = false;
    const response = await postCommand({ commandId: 'cmd-route-transfer-0006', payload: basePayload });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'command_store_unavailable', retryable: true },
    });
    expect(storedState.version).toBe(1);
  });
});

describe.sequential('cellar.transfer.reverse command route', () => {
  const reversalPayload = {
    reversalId: 'xfer-route-reversal-0001',
    originalCommandId: 'cmd-route-transfer-original-0001',
    reason: 'Wrong destination vessel was selected.',
  };

  async function createOriginal(): Promise<Response> {
    return postCommand({
      commandId: reversalPayload.originalCommandId,
      payload: { ...basePayload, transferId: 'xfer-route-original-0001' },
    });
  }

  it('restores the authoritative collections and appends one correction ledger record', async () => {
    expect((await createOriginal()).status).toBe(201);
    const response = await postReversal({
      commandId: 'cmd-route-transfer-reversal-0001',
      payload: reversalPayload,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      disposition: 'executed',
      commandType: 'cellar.transfer.reverse',
      result: {
        originalTransfer: {
          id: 'xfer-route-original-0001',
          reversedByCommandId: 'cmd-route-transfer-reversal-0001',
        },
        reversalTransfer: {
          id: reversalPayload.reversalId,
          recordKind: 'reversal',
          reversalOfCommandId: reversalPayload.originalCommandId,
        },
        stateVersion: 3,
      },
      collections: { transfers: expect.arrayContaining([expect.objectContaining({ id: reversalPayload.reversalId })]) },
    });
    expect(storedState.version).toBe(3);
    expect(storedState.data.vessels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'T-1', currentVolume: 600, assignedLotId: 'LOT-A' }),
      expect.objectContaining({ id: 'T-2', currentVolume: 0, assignedLotId: null }),
    ]));
    expect(storedState.data.lots[0]).toMatchObject({ currentVolume: 600 });
    expect(storedState.data.transfers).toHaveLength(2);
  });

  it('replays a racing retry without applying compensation twice', async () => {
    expect((await createOriginal()).status).toBe(201);
    const request = {
      commandId: 'cmd-route-transfer-reversal-0002',
      payload: { ...reversalPayload, reversalId: 'xfer-route-reversal-0002' },
    };
    expect((await postReversal(request)).status).toBe(201);
    const replay = await postReversal(request);

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(3);
    expect(storedState.data.transfers).toHaveLength(2);
  });

  it('rolls back the reversal claim when dependent vessel work makes compensation stale', async () => {
    expect((await createOriginal()).status).toBe(201);
    storedState.data.vessels = storedState.data.vessels.map((item: any) => item.id === 'T-2'
      ? { ...item, lastOperation: 'Sampled after transfer', lastModified: '2026-07-20T12:00:00.000Z' }
      : item);
    const response = await postReversal({
      commandId: 'cmd-route-transfer-reversal-0003',
      payload: { ...reversalPayload, reversalId: 'xfer-route-reversal-0003' },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'transfer_reversal_dependency_conflict', retryable: false },
    });
    expect(storedState.version).toBe(2);
    expect(storedCommands.has(commandKey(organizationId, 'cmd-route-transfer-reversal-0003'))).toBe(false);
  });

  it('enforces reversal permission independently from transfer creation', async () => {
    expect((await createOriginal()).status).toBe(201);
    resetDb('Cellar Worker');
    const response = await postReversal({
      commandId: 'cmd-route-transfer-reversal-0004',
      payload: { ...reversalPayload, reversalId: 'xfer-route-reversal-0004' },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_transfer_reversal' } });
    expect(storedState.version).toBe(2);
  });
});
