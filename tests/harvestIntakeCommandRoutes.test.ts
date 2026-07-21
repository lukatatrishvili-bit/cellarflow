import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const organizationId = 'org-harvest-intake-route';
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');
let storeAvailable = true;
let storedState: any;
let storedCommands = new Map<string, any>();

function initialState() {
  return {
    companyProfile: { currency: 'USD', region: 'Kartli' },
    blocks: [{
      id: 'BLOCK-A', name: 'Route Block', vineyardName: 'Route Estate', cadastralCode: 'CAD-ROUTE',
      municipality: 'Gurjaani', village: 'Mukuzani', microzone: 'Mukuzani', grapeVariety: 'Saperavi',
    }],
    harvests: [{
      id: 'HARVEST-A', blockId: 'BLOCK-A', variety: 'Saperavi', estimatedHarvestDate: '2026-09-15',
      estimatedTons: 1, pickingMethod: 'hand', grapeCondition: 'good', sentToGvino: false, notes: '',
    }],
    lots: [],
    vessels: [{
      id: 'T-1', type: 'stainless_steel', shape: 'vertical', capacity: 1_000, currentVolume: 0,
      assignedLotId: null, cleaningStatus: 'clean', lastCleaned: '2026-09-14', temperature: 18,
      coolingJacketActive: false, targetTemperature: null, lastOperation: 'Sanitized',
    }],
    grapeIntakes: [],
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
            transactionCommands.set(key, { ...data, result: null, createdAt: now, updatedAt: now, completedAt: null });
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
    username: 'intake-owner', email: 'intake-owner@example.test', fullName: 'Intake Owner', role,
    activeOrganizationId: organizationId, accountEnabled: true, sessionVersion: 1,
  }];
  db.organizations = [{ id: organizationId, name: 'Harvest Intake Estate' }];
  db.memberships = [{ id: 'membership-intake-owner', userId: 'intake-owner', organizationId, role }];
  db.invitations = [];
  db.orgData = { [organizationId]: initialState() };
}

function sessionCookie(): string {
  const token = authModule.createSessionToken({ username: 'intake-owner', role: 'Owner/Admin', sessionVersion: 1 });
  return `maranios_session=${token}`;
}

const basePayload = {
  intakeId: 'intake-route-0001',
  lotId: 'lot-route-0001',
  auditId: 'audit-intake-route-0001',
  intake: {
    date: '2026-09-15', source: 'own', blockId: 'BLOCK-A', blockName: 'Stale client block', variety: 'Saperavi',
    vintage: 2026, grossWeightKg: 1_100, tareWeightKg: 100, brix: 23.5, ph: 3.45,
    titratableAcidity: 6.1, temperatureC: 18, condition: 'good', pickingMethod: 'hand', wineClass: 'red',
    juiceYieldPct: 70, costPerKg: 2.5, totalCost: 2_500, grapePrice: 2.5, paymentStatus: 'unpaid',
    destinationVesselId: 'T-1', harvestRecordId: 'HARVEST-A', operator: 'Route Owner', notes: '',
  },
};

async function postCommand(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/cellar.harvest-intake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie(), 'x-cellarflow-org-id': organizationId },
    body: JSON.stringify(body),
  });
}

async function postReversal(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/cellar.harvest-intake.reverse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie(), 'x-cellarflow-org-id': organizationId },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  vi.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-harvest-intake-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'harvest-intake-route-test-secret-32-bytes',
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
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    updatedAt: new Date('2026-09-15T00:00:00.000Z'),
  };
  resetDb();
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env = { ...originalEnv };
  vi.doUnmock('../server/db');
  vi.resetModules();
});

describe.sequential('cellar.harvest-intake command route', () => {
  it('commits every requested ledger and returns authoritative collections', async () => {
    const response = await postCommand({ commandId: 'cmd-route-intake-0001', payload: basePayload });
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      disposition: 'executed',
      result: {
        intake: { id: basePayload.intakeId, commandId: 'cmd-route-intake-0001', currency: 'USD' },
        lot: { id: basePayload.lotId, region: 'Kartli' },
        stateVersion: 2,
      },
      collections: { grapeIntakes: [expect.objectContaining({ id: basePayload.intakeId })] },
    });
    expect(storedState.data.harvests[0]).toMatchObject({ sentToGvino: true, associatedLotId: basePayload.lotId });
    expect(storedState.data.vessels[0]).toMatchObject({ currentVolume: 700, assignedLotId: basePayload.lotId });
    expect(storedState.data.costEntries).toEqual([expect.objectContaining({ amount: 2_500, currency: 'USD' })]);
    expect(storedState.data.auditLogs[0].chainHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('replays one result without duplicating any business effect', async () => {
    const request = { commandId: 'cmd-route-intake-0002', payload: { ...basePayload, intakeId: 'intake-route-0002' } };
    expect((await postCommand(request)).status).toBe(201);
    const replay = await postCommand(request);

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(2);
    expect(storedState.data.grapeIntakes).toHaveLength(1);
    expect(storedState.data.lots).toHaveLength(1);
    expect(storedState.data.auditLogs).toHaveLength(1);
  });

  it('rolls back the claim and all ledgers when the vessel cannot hold the intake', async () => {
    storedState.data.vessels[0].capacity = 699;
    const response = await postCommand({ commandId: 'cmd-route-intake-0003', payload: basePayload });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'intake_vessel_capacity_exceeded' } });
    expect(storedState.version).toBe(1);
    expect(storedState.data.grapeIntakes).toEqual([]);
    expect(storedState.data.lots).toEqual([]);
    expect(storedState.data.harvests[0].sentToGvino).toBe(false);
    expect(storedCommands.size).toBe(0);
  });

  it('allows a winemaker core intake and vessel fill but rejects harvest and cost side effects', async () => {
    resetDb('Winemaker');
    const corePayload = {
      ...basePayload,
      intakeId: 'intake-route-core', lotId: 'lot-route-core', auditId: 'audit-route-core',
      intake: {
        ...basePayload.intake,
        source: 'supplier', supplierName: 'Route Grower', blockId: undefined, blockName: undefined,
        harvestRecordId: undefined, costPerKg: undefined, totalCost: undefined, grapePrice: undefined,
        paymentStatus: 'not_applicable',
      },
    };
    expect((await postCommand({ commandId: 'cmd-route-intake-0004', payload: corePayload })).status).toBe(201);

    storedCommands = new Map();
    storedState = { ...storedState, data: initialState(), version: 1 };
    const linked = await postCommand({ commandId: 'cmd-route-intake-0005', payload: basePayload });
    expect(linked.status).toBe(403);
    expect(await linked.json()).toMatchObject({ error: { code: 'forbidden_harvest_link' } });

    const costOnly = await postCommand({
      commandId: 'cmd-route-intake-0006',
      payload: { ...corePayload, intake: { ...corePayload.intake, costPerKg: 2, paymentStatus: 'unpaid' } },
    });
    expect(costOnly.status).toBe(403);
    expect(await costOnly.json()).toMatchObject({ error: { code: 'forbidden_intake_costing' } });
    expect(storedState.version).toBe(1);
  });

  it('denies roles without core receiving authority before claiming a command', async () => {
    resetDb('Cellar Worker');
    const response = await postCommand({ commandId: 'cmd-route-intake-0007', payload: basePayload });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_harvest_intake' } });
    expect(storedState.version).toBe(1);
    expect(storedCommands.size).toBe(0);
  });

  it('fails retryably before mutation when durable storage is unavailable', async () => {
    storeAvailable = false;
    const response = await postCommand({ commandId: 'cmd-route-intake-0008', payload: basePayload });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'command_store_unavailable', retryable: true } });
    expect(storedState.version).toBe(1);
  });

  it('reverses receiving atomically and replays without duplicating compensation', async () => {
    const originalCommandId = 'cmd-route-intake-original';
    expect((await postCommand({ commandId: originalCommandId, payload: basePayload })).status).toBe(201);
    const reversalRequest = {
      commandId: 'cmd-route-intake-reversal',
      payload: {
        reversalIntakeId: 'intake-route-reversal', auditId: 'audit-route-reversal',
        costReversalId: 'cost-route-reversal', originalCommandId,
        reason: 'Duplicate receipt entered at weighbridge',
      },
    };
    const response = await postReversal(reversalRequest);
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      disposition: 'executed',
      result: {
        reversalIntake: { id: 'intake-route-reversal', recordKind: 'reversal' },
        voidedLot: { id: basePayload.lotId, currentVolume: 0 },
        stateVersion: 3,
      },
    });
    expect(storedState.data.harvests[0]).toMatchObject({ sentToGvino: false });
    expect(storedState.data.harvests[0]).not.toHaveProperty('associatedLotId');
    expect(storedState.data.vessels[0]).toMatchObject({ currentVolume: 0, assignedLotId: null, lastOperation: 'Sanitized' });
    expect(storedState.data.grapeIntakes).toHaveLength(2);
    expect(storedState.data.costEntries).toHaveLength(2);
    expect(storedState.data.costEntries[0]).toMatchObject({ recordKind: 'reversal', amount: -2_500 });
    expect(storedState.data.auditLogs).toHaveLength(2);

    const replay = await postReversal(reversalRequest);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(3);
    expect(storedState.data.grapeIntakes).toHaveLength(2);
  });

  it('denies intake reversal when the role cannot compensate every linked ledger', async () => {
    resetDb('Winemaker');
    const response = await postReversal({
      commandId: 'cmd-route-intake-reversal-forbidden',
      payload: {
        reversalIntakeId: 'intake-reversal-forbidden', auditId: 'audit-reversal-forbidden',
        costReversalId: 'cost-reversal-forbidden', originalCommandId: 'cmd-missing', reason: 'Correction',
      },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_harvest_intake_reversal' } });
    expect(storedCommands.size).toBe(0);
  });
});
