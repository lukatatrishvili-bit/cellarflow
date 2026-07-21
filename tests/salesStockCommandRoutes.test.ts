import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const organizationId = 'org-sales-stock-route';
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');
let storeAvailable = true;
let storedState: any;
let storedCommands = new Map<string, any>();

function initialSalesState() {
  return {
    companyProfile: { currency: 'USD' },
    lots: [{
      id: 'LOT-A',
      name: 'Route Saperavi',
      vintage: 2025,
      variety: 'Saperavi',
      vineyardBlock: 'Block A',
      region: 'Kakheti',
      initialVolume: 100,
      currentVolume: 0,
      wineClass: 'red',
      stage: 'bottled',
      createdAt: '2025-10-01',
      history: [],
    }],
    bottlingRuns: [{
      id: 'BOT-A',
      lotId: 'LOT-A',
      lotName: 'Route Saperavi',
      date: '2026-07-01',
      lotNumber: 'BOT-A',
      operator: 'Route Winemaker',
      formats: { '0.75': 100 },
      totalBottles: 100,
      totalCeramic: 0,
      volumeBottledL: 75,
    }],
    costEntries: [{
      id: 'COST-A',
      date: '2026-07-01',
      lotId: 'LOT-A',
      category: 'packaging',
      description: 'Route cost',
      amount: 400,
      currency: 'USD',
    }],
    storageLocations: [{ id: 'STORE-A', name: 'Route warehouse', type: 'warehouse' }],
    stockMovements: [{
      id: 'IN-A',
      date: '2026-07-01',
      lotId: 'LOT-A',
      locationId: 'STORE-A',
      direction: 'in',
      bottles: 100,
    }],
    salesDispatches: [],
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
    username: 'sales-owner',
    email: 'sales-owner@example.test',
    fullName: 'Sales Owner',
    role,
    activeOrganizationId: organizationId,
    accountEnabled: true,
    sessionVersion: 1,
  }];
  db.organizations = [{ id: organizationId, name: 'Sales Route Estate' }];
  db.memberships = [{
    id: 'membership-sales-owner',
    userId: 'sales-owner',
    organizationId,
    role,
  }];
  db.invitations = [];
  db.orgData = { [organizationId]: initialSalesState() };
}

function sessionCookie(): string {
  const token = authModule.createSessionToken({
    username: 'sales-owner',
    role: 'Owner/Admin',
    sessionVersion: 1,
  });
  return `maranios_session=${token}`;
}

const reservePayload = {
  action: 'reserve',
  orderId: 'so-route-0001',
  orderNumber: 'SO-ROUTE-0001',
  orderDate: '2026-07-20',
  requestedDispatchDate: '2026-07-22',
  reservedUntil: '2099-07-25',
  customerName: 'Route Buyer',
  lotId: 'LOT-A',
  locationId: 'STORE-A',
  bottles: 40,
  pricePerBottle: 20,
  operator: 'Route Owner',
  notes: '',
};

async function postCommand(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/sales.stock`, {
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
  return fetch(`${baseUrl}/api/commands/sales.stock.reverse`, {
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-sales-stock-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'sales-stock-route-test-secret-32-bytes',
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
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  storeAvailable = true;
  storedCommands = new Map();
  storedState = {
    organizationId,
    data: initialSalesState(),
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

describe.sequential('sales.stock command route', () => {
  it('commits an authoritative reservation and server-derived financials', async () => {
    const response = await postCommand({ commandId: 'cmd-route-sales-0001', payload: reservePayload });
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      disposition: 'executed',
      result: { order: { id: 'so-route-0001', commandId: 'cmd-route-sales-0001' }, stateVersion: 2 },
      collections: { salesOrders: [expect.objectContaining({ id: 'so-route-0001' })] },
    });
    expect(storedState.data.salesOrders[0]).toMatchObject({
      currency: 'USD',
      revenue: 800,
      costPerBottle: 4,
      cogs: 160,
    });
    expect(storedState.data.stockMovements).toHaveLength(1);
  });

  it('replays a reservation without reserving stock twice', async () => {
    const request = { commandId: 'cmd-route-sales-0002', payload: { ...reservePayload, orderId: 'so-route-0002' } };
    expect((await postCommand(request)).status).toBe(201);
    const replay = await postCommand(request);

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(2);
    expect(storedState.data.salesOrders).toHaveLength(1);
  });

  it('fulfills a reservation as one order, dispatch, and movement transaction', async () => {
    expect((await postCommand({ commandId: 'cmd-route-sales-0003a', payload: reservePayload })).status).toBe(201);
    const response = await postCommand({
      commandId: 'cmd-route-sales-0003b',
      payload: {
        action: 'fulfill',
        orderId: reservePayload.orderId,
        dispatchId: 'sale-route-0003',
        date: '2026-07-20',
        operator: 'Route Owner',
      },
    });

    expect(response.status).toBe(201);
    expect(storedState.version).toBe(3);
    expect(storedState.data.salesOrders[0]).toMatchObject({
      status: 'fulfilled',
      dispatchId: 'sale-route-0003',
    });
    expect(storedState.data.salesDispatches[0]).toMatchObject({
      id: 'sale-route-0003',
      salesOrderId: reservePayload.orderId,
    });
    expect(storedState.data.stockMovements[0]).toMatchObject({
      direction: 'out',
      bottles: 40,
      sourceRef: 'sale-route-0003',
    });
  });

  it('cancels a reservation without creating a physical movement', async () => {
    expect((await postCommand({ commandId: 'cmd-route-sales-0004a', payload: reservePayload })).status).toBe(201);
    const response = await postCommand({
      commandId: 'cmd-route-sales-0004b',
      payload: { action: 'cancel', orderId: reservePayload.orderId },
    });

    expect(response.status).toBe(201);
    expect(storedState.data.salesOrders[0]).toMatchObject({ status: 'cancelled', cancelledBy: 'sales-owner' });
    expect(storedState.data.salesDispatches).toEqual([]);
    expect(storedState.data.stockMovements).toHaveLength(1);
  });

  it('rolls back an overbooking command and its durable claim together', async () => {
    expect((await postCommand({ commandId: 'cmd-route-sales-0005a', payload: { ...reservePayload, bottles: 80 } })).status).toBe(201);
    const response = await postCommand({
      commandId: 'cmd-route-sales-0005b',
      payload: { ...reservePayload, orderId: 'so-route-overbook', orderNumber: 'SO-OVERBOOK', bottles: 21 },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'insufficient_sellable_stock' } });
    expect(storedState.version).toBe(2);
    expect(storedState.data.salesOrders).toHaveLength(1);
    expect(storedCommands.size).toBe(1);
  });

  it('enforces the complete sales/storage permission boundary', async () => {
    resetDb('Winemaker');
    const response = await postCommand({ commandId: 'cmd-route-sales-0006', payload: reservePayload });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_sales_stock' } });
    expect(storedState.version).toBe(1);
    expect(storedCommands.size).toBe(0);
  });

  it('fails retryably before mutation when durable storage is unavailable', async () => {
    storeAvailable = false;
    const response = await postCommand({ commandId: 'cmd-route-sales-0007', payload: reservePayload });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'command_store_unavailable', retryable: true } });
    expect(storedState.version).toBe(1);
  });
});

describe.sequential('sales.stock.reverse command route', () => {
  const directPayload = {
    action: 'dispatch',
    dispatchId: 'sale-route-reverse-original',
    date: '2026-07-20',
    customerName: 'Route Buyer',
    lotId: 'LOT-A',
    locationId: 'STORE-A',
    bottles: 30,
    pricePerBottle: 20,
    operator: 'Route Owner',
    notes: '',
  };
  const reversal = {
    reversalDispatchId: 'sale-route-reversal',
    returnMovementId: 'mov-route-sale-return',
    originalCommandId: 'cmd-route-sales-original',
    reason: 'Customer returned the shipment.',
  };

  it('commits and replays one append-only stock return', async () => {
    expect((await postCommand({ commandId: reversal.originalCommandId, payload: directPayload })).status).toBe(201);
    const request = { commandId: 'cmd-route-sales-reversal', payload: reversal };
    const response = await postReversal(request);
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      disposition: 'executed',
      commandType: 'sales.stock.reverse',
      result: {
        originalDispatch: { id: directPayload.dispatchId, reversedByCommandId: request.commandId },
        reversalDispatch: { id: reversal.reversalDispatchId, recordKind: 'reversal' },
        returnMovement: { id: reversal.returnMovementId, direction: 'in', reason: 'sale_reversal' },
        stateVersion: 3,
      },
    });
    expect(storedState.data.salesDispatches).toHaveLength(2);
    expect(storedState.data.stockMovements).toHaveLength(3);

    const replay = await postReversal(request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ disposition: 'replayed' });
    expect(storedState.version).toBe(3);
    expect(storedState.data.salesDispatches).toHaveLength(2);
  });

  it('rejects a second reversal with a different command id', async () => {
    expect((await postCommand({ commandId: reversal.originalCommandId, payload: directPayload })).status).toBe(201);
    expect((await postReversal({ commandId: 'cmd-route-sales-reversal-a', payload: reversal })).status).toBe(201);
    const response = await postReversal({
      commandId: 'cmd-route-sales-reversal-b',
      payload: {
        ...reversal,
        reversalDispatchId: 'sale-route-reversal-b',
        returnMovementId: 'mov-route-sale-return-b',
      },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'sales_dispatch_already_reversed' } });
    expect(storedState.data.salesDispatches).toHaveLength(2);
    expect(storedCommands.size).toBe(2);
  });

  it('enforces the compound correction permission before claiming the command', async () => {
    resetDb('Winemaker');
    const response = await postReversal({ commandId: 'cmd-route-sales-reversal-forbidden', payload: reversal });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_sales_stock_reversal' } });
    expect(storedState.version).toBe(1);
    expect(storedCommands.size).toBe(0);
  });
});
