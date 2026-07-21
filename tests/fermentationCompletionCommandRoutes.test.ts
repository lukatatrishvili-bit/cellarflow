import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const organizationId = 'org-fermentation-completion-route';
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
      id: 'LOT-FERM-1', name: 'Route Saperavi', vintage: 2026, variety: 'Saperavi',
      vineyardBlock: 'Block A', region: 'Kakheti', initialVolume: 1_000, currentVolume: 920,
      wineClass: 'red', stage: 'fermenting', createdAt: '2026-09-01', history: [],
    }],
    vessels: [{
      id: 'TANK-FERM-1', type: 'stainless_steel', shape: 'vertical', capacity: 1_200,
      currentVolume: 920, assignedLotId: 'LOT-FERM-1', cleaningStatus: 'clean',
      lastCleaned: '2026-08-31', temperature: 20.5, coolingJacketActive: true,
      targetTemperature: 20, lastOperation: 'Final reading recorded',
    }],
    fermlogs: [{
      id: 'FLOG-FINAL-1', tankId: 'TANK-FERM-1', lotId: 'LOT-FERM-1', date: '2026-09-14',
      temperature: 20.5, density: 0.996, sugar: 2, ph: 3.48,
      tastingNotes: 'Dry and clean', capManagement: 'None', additives: 'None',
    }],
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
    username: 'fermentation-owner', email: 'fermentation-owner@example.test',
    fullName: 'Fermentation Owner', role, activeOrganizationId: organizationId,
    accountEnabled: true, sessionVersion: 1,
  }];
  db.organizations = [{ id: organizationId, name: 'Fermentation Route Estate' }];
  db.memberships = [{
    id: 'membership-fermentation-owner', userId: 'fermentation-owner', organizationId, role,
  }];
  db.invitations = [];
  db.orgData = { [organizationId]: initialState() };
}

function sessionCookie(): string {
  const token = authModule.createSessionToken({
    username: 'fermentation-owner', role: 'Owner/Admin', sessionVersion: 1,
  });
  return `maranios_session=${token}`;
}

const payload = {
  lotId: 'LOT-FERM-1',
  vesselId: 'TANK-FERM-1',
  finalLogId: 'FLOG-FINAL-1',
  auditId: 'AUDIT-FERM-FINAL-1',
  operator: 'Route Winemaker',
};

async function postCommand(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/cellar.fermentation-complete`, {
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
  return fetch(`${baseUrl}/api/commands/cellar.fermentation-complete.reverse`, {
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-fermentation-completion-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'fermentation-completion-route-secret-32-bytes',
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
    createdAt: new Date('2026-09-14T00:00:00.000Z'),
    updatedAt: new Date('2026-09-14T00:00:00.000Z'),
  };
  resetDb();
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env = { ...originalEnv };
  vi.doUnmock('../server/db');
  vi.resetModules();
});

describe.sequential('cellar.fermentation-complete command route', () => {
  it('commits all completion evidence and returns authoritative collections', async () => {
    const response = await postCommand({ commandId: 'cmd-route-fermentation-0001', payload });
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      disposition: 'executed',
      result: {
        lot: { id: payload.lotId, stage: 'stabilization' },
        vessel: { id: payload.vesselId, lastCommandId: 'cmd-route-fermentation-0001' },
        finalLog: { id: payload.finalLogId, isCompletion: true },
        auditLog: { id: payload.auditId },
        stateVersion: 2,
      },
      collections: { fermlogs: [expect.objectContaining({ id: payload.finalLogId, isCompletion: true })] },
    });
    expect(storedState.data.lots[0].stage).toBe('stabilization');
    expect(storedState.data.vessels[0]).toMatchObject({ coolingJacketActive: true, targetTemperature: 20 });
    expect(storedState.data.auditLogs[0].chainHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('replays one durable result without duplicating history or audit evidence', async () => {
    const request = { commandId: 'cmd-route-fermentation-0002', payload };
    expect((await postCommand(request)).status).toBe(201);
    const replay = await postCommand(request);

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(2);
    expect(storedState.data.lots[0].history).toHaveLength(1);
    expect(storedState.data.auditLogs).toHaveLength(1);
  });

  it('reopens completion atomically and replays the same correction without duplicates', async () => {
    const originalCommandId = 'cmd-route-fermentation-original-0001';
    expect((await postCommand({ commandId: originalCommandId, payload })).status).toBe(201);
    const request = {
      commandId: 'cmd-route-fermentation-reversal-0001',
      payload: {
        reversalLogId: 'FLOG-REVERSAL-ROUTE-1',
        auditId: 'AUDIT-FERM-REVERSAL-ROUTE-1',
        originalCommandId,
        reason: 'Completion was recorded too early.',
      },
    };
    const response = await postReversal(request);
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      disposition: 'executed',
      result: {
        lot: { id: payload.lotId, stage: 'fermenting' },
        vessel: { id: payload.vesselId, lastOperation: 'Final reading recorded' },
        originalLog: { id: payload.finalLogId, reversedByCommandId: request.commandId },
        reversalLog: { id: request.payload.reversalLogId, recordKind: 'reversal' },
        auditLog: { id: request.payload.auditId },
        stateVersion: 3,
      },
      collections: { fermlogs: expect.arrayContaining([
        expect.objectContaining({ id: request.payload.reversalLogId, recordKind: 'reversal' }),
      ]) },
    });
    const replay = await postReversal(request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(3);
    expect(storedState.data.fermlogs).toHaveLength(2);
    expect(storedState.data.auditLogs).toHaveLength(2);
  });

  it('denies completion reversal without owner-level deletion authority', async () => {
    resetDb('Winemaker');
    const response = await postReversal({
      commandId: 'cmd-route-fermentation-reversal-denied',
      payload: {
        reversalLogId: 'FLOG-REVERSAL-DENIED', auditId: 'AUDIT-FERM-REVERSAL-DENIED',
        originalCommandId: 'cmd-route-fermentation-original-denied', reason: 'Incorrect close.',
      },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'forbidden_fermentation_completion_reversal' },
    });
    expect(storedCommands.size).toBe(0);
  });

  it('rolls back the command claim and every effect on a vessel mismatch', async () => {
    storedState.data.vessels[0].assignedLotId = 'LOT-OTHER';
    const response = await postCommand({ commandId: 'cmd-route-fermentation-0003', payload });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'fermentation_vessel_mismatch' } });
    expect(storedState.version).toBe(1);
    expect(storedState.data.lots[0].stage).toBe('fermenting');
    expect(storedState.data.auditLogs).toEqual([]);
    expect(storedCommands.size).toBe(0);
  });

  it('denies incomplete workflow authority before claiming a command', async () => {
    resetDb('Cellar Worker');
    const response = await postCommand({ commandId: 'cmd-route-fermentation-0004', payload });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_fermentation_completion' } });
    expect(storedState.version).toBe(1);
    expect(storedCommands.size).toBe(0);
  });

  it('fails retryably before mutation when durable storage is unavailable', async () => {
    storeAvailable = false;
    const response = await postCommand({ commandId: 'cmd-route-fermentation-0005', payload });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'command_store_unavailable', retryable: true },
    });
    expect(storedState.version).toBe(1);
  });
});
