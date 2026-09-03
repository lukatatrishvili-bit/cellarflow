import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncRecordFingerprint } from '../lib/deletionTombstones';

const originalEnv = { ...process.env };
const organizationId = 'org-two-client-matrix';
const initialTask = {
  id: 'task-shared',
  title: 'Initial title',
  description: 'Initial description',
  priority: 'medium',
  status: 'pending',
  lastModified: '2026-07-20T08:00:00.000Z',
};

let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');

function resetDb(role = 'Owner/Admin'): void {
  const db = dbModule.getDB();
  db.users = [{
    username: 'two-client-owner',
    email: 'two-client@example.test',
    fullName: 'Two Client Owner',
    role,
    activeOrganizationId: organizationId,
    accountEnabled: true,
    sessionVersion: 1,
  }];
  db.organizations = [{ id: organizationId, name: 'Two Client Estate' }];
  db.memberships = [{
    id: 'membership-two-client',
    userId: 'two-client-owner',
    organizationId,
    role,
  }];
  db.invitations = [];
  db.orgData = {
    [organizationId]: {
      ...dbModule.createEmptyUserData(),
      tasks: [structuredClone(initialTask)],
    },
  };
}

function sessionCookie(): string {
  const token = authModule.createSessionToken({
    username: 'two-client-owner',
    role: 'Owner/Admin',
    sessionVersion: 1,
  });
  return `maranios_session=${token}`;
}

async function postSync(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: sessionCookie(),
      'X-CellarFlow-Org-Id': organizationId,
    },
    body: JSON.stringify(body),
  });
}

function taskOnServer(): any | undefined {
  return dbModule.getDB().orgData[organizationId].tasks
    .find((task: any) => task.id === initialTask.id);
}

function deletionIntent() {
  return {
    collection: 'tasks',
    id: initialTask.id,
    baselineTimestamp: initialTask.lastModified,
    baselineFingerprint: syncRecordFingerprint(initialTask),
    deletedAt: '2026-07-20T08:05:00.000Z',
  };
}

beforeAll(async () => {
  vi.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-two-client-matrix-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'two-client-matrix-secret-at-least-32-bytes',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(root, 'db.json'),
    GCS_BUCKET: '',
  };

  const routes = await import('../server/routes/sync');
  dbModule = await import('../server/db');
  authModule = await import('../server/auth');
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', routes.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => resetDb());

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe.sequential('deterministic two-client sync matrix', () => {
  it('edit/edit reports a same-field conflict without overwriting client A', async () => {
    const clientA = { ...initialTask, title: 'Client A title', lastModified: '2026-07-20T08:01:00.000Z', baselineTimestamp: initialTask.lastModified };
    expect((await postSync({ tasks: [clientA] })).status).toBe(200);

    const clientB = { ...initialTask, title: 'Client B title', lastModified: '2026-07-20T08:02:00.000Z', baselineTimestamp: initialTask.lastModified };
    const response = await postSync({ tasks: [clientB] });
    const body = await response.json();

    expect(body).toMatchObject({
      hasConflicts: true,
      conflicts: [{ collection: 'tasks', recordId: initialTask.id }],
    });
    expect(taskOnServer()).toMatchObject({ title: 'Client A title', lastModified: clientA.lastModified });
  });

  it('edit/delete reports a versioned deletion conflict and retains the edit', async () => {
    const clientA = { ...initialTask, title: 'Edited before deletion', lastModified: '2026-07-20T08:01:00.000Z', baselineTimestamp: initialTask.lastModified };
    await postSync({ tasks: [clientA] });

    const response = await postSync({ deletedRecords: [deletionIntent()] });
    const body = await response.json();

    expect(body).toMatchObject({
      hasConflicts: true,
      deletionDeferred: true,
      conflicts: [{ collection: 'tasks', recordId: initialTask.id, local: null }],
    });
    expect(taskOnServer()?.title).toBe('Edited before deletion');
  });

  it('delete/edit blocks resurrection while silently dropping an untouched stale copy', async () => {
    const deleted = await postSync({ deletedRecords: [deletionIntent()] });
    expect(deleted.status).toBe(200);
    expect(taskOnServer()).toBeUndefined();

    const staleEdit = {
      ...initialTask,
      title: 'Offline stale edit',
      lastModified: '2026-07-20T08:03:00.000Z',
      baselineTimestamp: initialTask.lastModified,
    };
    const conflictResponse = await postSync({ tasks: [staleEdit] });
    const conflict = await conflictResponse.json();
    expect(conflict).toMatchObject({
      hasConflicts: true,
      conflicts: [{ collection: 'tasks', recordId: initialTask.id, server: null }],
    });
    expect(taskOnServer()).toBeUndefined();

    const untouchedResponse = await postSync({ tasks: [initialTask] });
    expect((await untouchedResponse.json()).tasks).toEqual([]);
    expect(taskOnServer()).toBeUndefined();
  });

  it('delete/delete converges idempotently with one bounded ledger entry', async () => {
    expect((await postSync({ deletedRecords: [deletionIntent()] })).status).toBe(200);
    expect((await postSync({ deletedRecords: [deletionIntent()] })).status).toBe(200);

    const state = dbModule.getDB().orgData[organizationId];
    expect(state.tasks).toEqual([]);
    expect(state.syncDeletionLedger).toHaveLength(1);
    expect(state.syncDeletionLedger[0]).toMatchObject({ collection: 'tasks', id: initialTask.id });
  });

  it('role change after session issuance denies the pending write', async () => {
    resetDb('Read-Only');

    const response = await postSync({
      tasks: [{
        ...initialTask,
        title: 'Should not persist',
        lastModified: '2026-07-20T08:01:00.000Z',
        baselineTimestamp: initialTask.lastModified,
      }],
    });

    expect(response.status).toBe(403);
    expect(taskOnServer()?.title).toBe(initialTask.title);
  });

  it('partial connectivity merges a delayed non-overlapping edit after reconnect', async () => {
    const onlineClient = {
      ...initialTask,
      title: 'Online title',
      lastModified: '2026-07-20T08:01:00.000Z',
      baselineTimestamp: initialTask.lastModified,
    };
    await postSync({ tasks: [onlineClient] });

    // Client B held this mutation offline while client A committed above.
    const delayedClient = {
      ...initialTask,
      description: 'Delayed offline description',
      lastModified: '2026-07-20T08:02:00.000Z',
      baselineTimestamp: initialTask.lastModified,
    };
    const response = await postSync({ tasks: [delayedClient] });
    const body = await response.json();

    expect(body.hasConflicts).toBeUndefined();
    expect(taskOnServer()).toMatchObject({
      title: 'Online title',
      description: 'Delayed offline description',
    });
  });

  it('lost-response retry converges without duplicate records', async () => {
    const edit = {
      ...initialTask,
      title: 'Committed once',
      lastModified: '2026-07-20T08:01:00.000Z',
      baselineTimestamp: initialTask.lastModified,
    };
    const first = await postSync({ tasks: [edit] });
    expect(first.status).toBe(200); // Simulate the client losing this body.

    const retry = await postSync({ tasks: [edit] });
    expect(retry.status).toBe(200);
    expect(dbModule.getDB().orgData[organizationId].tasks).toHaveLength(1);
    expect(taskOnServer()?.title).toBe('Committed once');
  });
});
