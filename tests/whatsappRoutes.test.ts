import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');
let whatsappModule: typeof import('../server/whatsapp');

async function request(pathname: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie: `maranios_session=${token}`,
      ...(init.headers || {}),
    },
  });
}

function seedWorkspace() {
  const db = dbModule.getDB();
  db.users = [];
  db.organizations = [{ id: 'org-whatsapp', name: 'WhatsApp Winery' }];
  db.memberships = [];
  db.invitations = [];
  db.securityAuditEvents = [];
  db.orgData = { 'org-whatsapp': dbModule.createEmptyUserData() };

  const owner = {
    username: 'owner',
    email: 'owner@example.test',
    fullName: 'Owner Sender',
    role: 'Owner/Admin',
    language: 'en',
    activeOrganizationId: 'org-whatsapp',
    accountEnabled: true,
    sessionVersion: 1,
  };
  const recipient = {
    username: 'nino',
    email: 'nino@example.test',
    fullName: 'ნინო',
    role: 'Cellar Worker',
    language: 'ka',
    phone: '+995555123456',
    whatsappOptIn: false,
    activeOrganizationId: 'org-whatsapp',
    accountEnabled: true,
    sessionVersion: 1,
  };
  db.users.push(owner, recipient);
  db.memberships.push(
    { id: 'member-owner', userId: owner.username, organizationId: 'org-whatsapp', role: 'Owner/Admin' },
    { id: 'member-nino', userId: recipient.username, organizationId: 'org-whatsapp', role: 'Cellar Worker' },
  );
  return { db, owner, recipient };
}

beforeAll(async () => {
  vi.resetModules();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-whatsapp-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'whatsapp-route-test-secret-at-least-32-bytes',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(temp, 'db.json'),
    GCS_BUCKET: '',
    WHATSAPP_ACCESS_TOKEN: 'test-token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
    WHATSAPP_GRAPH_API_VERSION: 'v26.0',
  };
  vi.doMock('../server/whatsapp', async () => {
    const actual = await vi.importActual<typeof import('../server/whatsapp')>('../server/whatsapp');
    return {
      ...actual,
      sendWhatsAppTaskAssignment: vi.fn(async () => ({ messageId: 'wamid.route-test' })),
    };
  });

  const notifications = await import('../server/routes/notifications');
  const authRoutes = await import('../server/routes/auth');
  dbModule = await import('../server/db');
  authModule = await import('../server/auth');
  whatsappModule = await import('../server/whatsapp');

  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notifications.default);
  app.use('/api/auth', authRoutes.default);
  app.use('/api/org', authRoutes.orgRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  vi.mocked(whatsappModule.sendWhatsAppTaskAssignment).mockClear();
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env = { ...originalEnv };
  vi.doUnmock('../server/whatsapp');
  vi.resetModules();
});

describe.sequential('WhatsApp notification routes', () => {
  it('validates and stores the signed-in user own opt-in preferences', async () => {
    const { owner } = seedWorkspace();
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));

    const invalid = await request('/api/auth/update_profile', token, {
      method: 'POST',
      body: JSON.stringify({ phone: '0555 123 456', whatsappOptIn: true }),
    });
    expect(invalid.status).toBe(400);

    const valid = await request('/api/auth/update_profile', token, {
      method: 'POST',
      body: JSON.stringify({ phone: '+995 (555) 123-456', whatsappOptIn: true }),
    });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual(expect.objectContaining({
      phone: '+995555123456',
      whatsappOptIn: true,
    }));
  });

  it('does not expose team phone numbers and reports recipient readiness only', async () => {
    const { owner, recipient } = seedWorkspace();
    recipient.whatsappOptIn = true;
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));

    const response = await request('/api/org/members', token);
    expect(response.status).toBe(200);
    const body = await response.json();
    const nino = body.members.find((member: any) => member.username === 'nino');
    expect(nino).toEqual(expect.objectContaining({ language: 'ka', whatsappReady: true }));
    expect(nino).not.toHaveProperty('phone');
  });

  it('requires the assignee to opt in before calling Meta', async () => {
    const { owner } = seedWorkspace();
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));

    const response = await request('/api/notifications/whatsapp/tasks', token, {
      method: 'POST',
      body: JSON.stringify({
        assigneeUsername: 'nino',
        task: { id: 'task-1', title: 'Check qvevri', priority: 'high', dueDate: '2026-07-24' },
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'whatsapp_opt_in_required' }));
    expect(whatsappModule.sendWhatsAppTaskAssignment).not.toHaveBeenCalled();
  });

  it('resolves an opted-in member server-side and sends in their profile language', async () => {
    const { owner, recipient } = seedWorkspace();
    recipient.whatsappOptIn = true;
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));

    const response = await request('/api/notifications/whatsapp/tasks', token, {
      method: 'POST',
      body: JSON.stringify({
        assigneeUsername: 'nino',
        task: {
          id: 'task-2',
          title: 'ქვევრის შემოწმება',
          priority: 'medium',
          dueDate: '2026-07-25',
          description: 'ტემპერატურა',
        },
      }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(expect.objectContaining({
      status: 'accepted',
      messageId: 'wamid.route-test',
      language: 'ka',
    }));
    expect(whatsappModule.sendWhatsAppTaskAssignment).toHaveBeenCalledWith(expect.objectContaining({
      recipient: expect.objectContaining({
        fullName: 'ნინო',
        phone: '+995555123456',
        language: 'ka',
      }),
      assignedBy: 'Owner Sender',
    }));
  });

  it('rejects recipients outside the active workspace', async () => {
    const { db, owner } = seedWorkspace();
    db.users.push({
      username: 'outsider',
      fullName: 'Outsider',
      phone: '+995555999999',
      whatsappOptIn: true,
      language: 'en',
      accountEnabled: true,
      sessionVersion: 1,
    });
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));

    const response = await request('/api/notifications/whatsapp/tasks', token, {
      method: 'POST',
      body: JSON.stringify({
        assigneeUsername: 'outsider',
        task: { id: 'task-3', title: 'Check tank', priority: 'low', dueDate: '2026-07-26' },
      }),
    });

    expect(response.status).toBe(404);
    expect(whatsappModule.sendWhatsAppTaskAssignment).not.toHaveBeenCalled();
  });
});
