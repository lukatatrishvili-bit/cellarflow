import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');
let commandStoreAvailable = true;
let storedOrganizationId = 'org-command-a';
const findUnique = vi.fn(async ({ where }: any) => {
  if (where.organizationId_commandId.organizationId !== storedOrganizationId) return null;
  if (where.organizationId_commandId.commandId !== 'cmd-route-0001') return null;
  return {
    commandId: 'cmd-route-0001',
    commandType: 'cellar.transfer',
    status: 'completed',
    result: { transferId: 'TR-001', stateVersion: 2 },
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    completedAt: new Date('2026-07-20T00:00:01.000Z'),
  };
});

function resetDb() {
  const db = dbModule.getDB();
  db.users = [{
    username: 'command-reader',
    email: 'command-reader@example.test',
    fullName: 'Command Reader',
    role: 'Read-Only',
    activeOrganizationId: 'org-command-a',
    accountEnabled: true,
    sessionVersion: 1,
  }];
  db.organizations = [
    { id: 'org-command-a', name: 'Command Estate A' },
    { id: 'org-command-b', name: 'Command Estate B' },
  ];
  db.memberships = [{
    id: 'membership-command-reader',
    userId: 'command-reader',
    organizationId: 'org-command-a',
    role: 'Read-Only',
  }];
  db.invitations = [];
  db.orgData = {};
}

function sessionCookie(): string {
  const token = authModule.createSessionToken({
    username: 'command-reader',
    role: 'Read-Only',
    sessionVersion: 1,
  });
  return `maranios_session=${token}`;
}

async function request(commandId: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/api/commands/${commandId}`, {
    headers: {
      cookie: sessionCookie(),
      'x-cellarflow-org-id': 'org-command-a',
      ...headers,
    },
  });
}

beforeAll(async () => {
  vi.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-command-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'command-route-test-secret-at-least-32-bytes',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(root, 'db.json'),
    GCS_BUCKET: '',
  };

  vi.doMock('../server/db', async () => {
    const actual = await vi.importActual<typeof import('../server/db')>('../server/db');
    return {
      ...actual,
      getPrismaClientForAdmin: vi.fn(async () => commandStoreAvailable
        ? { commandExecution: { findUnique } }
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
  commandStoreAvailable = true;
  storedOrganizationId = 'org-command-a';
  findUnique.mockClear();
  resetDb();
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env = { ...originalEnv };
  vi.doUnmock('../server/db');
  vi.resetModules();
});

describe.sequential('command status route', () => {
  it('returns a replayable result scoped to the active organization', async () => {
    const response = await request('cmd-route-0001');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      command: {
        commandId: 'cmd-route-0001',
        commandType: 'cellar.transfer',
        status: 'completed',
        result: { transferId: 'TR-001', stateVersion: 2 },
      },
    });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_commandId: { organizationId: 'org-command-a', commandId: 'cmd-route-0001' } },
    }));
  });

  it('does not reveal a command belonging to another organization', async () => {
    storedOrganizationId = 'org-command-b';
    const response = await request('cmd-route-0001');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'command_not_found', retryable: false } });
  });

  it('returns stable validation errors before accessing storage', async () => {
    const response = await request('short');

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_command_id', retryable: false } });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns a retryable service error when durable storage is unavailable', async () => {
    commandStoreAvailable = false;
    const response = await request('cmd-route-0001');

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'command_store_unavailable', retryable: true },
    });
  });

  it('rejects a stale organization context before looking up the command', async () => {
    const response = await request('cmd-route-0001', { 'x-cellarflow-org-id': 'org-command-b' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'org_context_changed' });
    expect(findUnique).not.toHaveBeenCalled();
  });
});
