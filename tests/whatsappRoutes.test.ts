import crypto from 'crypto';
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
  db.whatsappDeliveries = [];
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
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'whatsapp-route-verify-token',
    WHATSAPP_APP_SECRET: 'whatsapp-route-app-secret',
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
  app.use(
    '/api/notifications/whatsapp/webhook',
    express.raw({ type: 'application/json', limit: '256kb' }),
    notifications.whatsappWebhookRouter,
  );
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
        task: {
          id: 'task-1',
          title: 'Check qvevri',
          priority: 'high',
          dueDate: '2026-07-24',
          assignedUserId: 'nino',
        },
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
          assignedUserId: 'nino',
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

    const replay = await request('/api/notifications/whatsapp/tasks', token, {
      method: 'POST',
      body: JSON.stringify({
        assigneeUsername: 'nino',
        task: {
          id: 'task-2',
          title: 'ქვევრის შემოწმება',
          priority: 'medium',
          dueDate: '2026-07-25',
          description: 'ტემპერატურა',
          assignedUserId: 'nino',
        },
      }),
    });
    expect(replay.status).toBe(200);
    expect(whatsappModule.sendWhatsAppTaskAssignment).toHaveBeenCalledTimes(1);
  });

  it('verifies Meta webhooks and exposes delivered state without phone numbers', async () => {
    const { owner, recipient } = seedWorkspace();
    recipient.whatsappOptIn = true;
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));
    const accepted = await request('/api/notifications/whatsapp/tasks', token, {
      method: 'POST',
      body: JSON.stringify({
        assigneeUsername: 'nino',
        task: {
          id: 'task-webhook',
          title: 'Check qvevri',
          priority: 'high',
          dueDate: '2026-07-26',
          assignedUserId: 'nino',
        },
      }),
    });
    expect(accepted.status).toBe(202);

    const verification = await fetch(
      `${baseUrl}/api/notifications/whatsapp/webhook?hub.mode=subscribe`
      + '&hub.verify_token=whatsapp-route-verify-token&hub.challenge=verified-123',
    );
    expect(verification.status).toBe(200);
    expect(await verification.text()).toBe('verified-123');

    const webhookBody = Buffer.from(JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            statuses: [{
              id: 'wamid.route-test',
              status: 'delivered',
              timestamp: String(Math.floor(Date.now() / 1_000)),
            }],
          },
        }],
      }],
    }));
    const signature = `sha256=${crypto
      .createHmac('sha256', process.env.WHATSAPP_APP_SECRET!)
      .update(webhookBody)
      .digest('hex')}`;
    const webhook = await fetch(`${baseUrl}/api/notifications/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      body: webhookBody,
    });
    expect(webhook.status).toBe(200);
    expect(await webhook.json()).toEqual({ ok: true, received: 1, matched: 1 });

    const status = await request('/api/notifications/whatsapp/task-statuses', token, {
      method: 'POST',
      body: JSON.stringify({ taskIds: ['task-webhook'] }),
    });
    expect(status.status).toBe(200);
    const payload = await status.json();
    expect(payload.deliveries).toEqual([
      expect.objectContaining({
        taskId: 'task-webhook',
        status: 'delivered',
        messageId: 'wamid.route-test',
        language: 'ka',
      }),
    ]);
    expect(JSON.stringify(payload)).not.toContain('+995');
  });

  it('records a provider failure and permits one durable retry', async () => {
    const { owner, recipient } = seedWorkspace();
    recipient.whatsappOptIn = true;
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));
    vi.mocked(whatsappModule.sendWhatsAppTaskAssignment)
      .mockRejectedValueOnce(new whatsappModule.WhatsAppDeliveryError('Provider unavailable', 503, 2))
      .mockResolvedValueOnce({ messageId: 'wamid.retry-success' });
    const body = JSON.stringify({
      assigneeUsername: 'nino',
      task: {
        id: 'task-retry',
        title: 'Retry delivery',
        priority: 'medium',
        dueDate: '2026-07-26',
        assignedUserId: 'nino',
      },
    });

    const failed = await request('/api/notifications/whatsapp/tasks', token, { method: 'POST', body });
    expect(failed.status).toBe(502);
    const failedStatus = await request('/api/notifications/whatsapp/task-statuses', token, {
      method: 'POST',
      body: JSON.stringify({ taskIds: ['task-retry'] }),
    });
    expect(await failedStatus.json()).toEqual({
      deliveries: [expect.objectContaining({ taskId: 'task-retry', status: 'failed' })],
    });

    const retried = await request('/api/notifications/whatsapp/tasks', token, { method: 'POST', body });
    expect(retried.status).toBe(202);
    expect(await retried.json()).toEqual(expect.objectContaining({
      status: 'accepted',
      messageId: 'wamid.retry-success',
    }));

    const replay = await request('/api/notifications/whatsapp/tasks', token, { method: 'POST', body });
    expect(replay.status).toBe(200);
    expect(whatsappModule.sendWhatsAppTaskAssignment).toHaveBeenCalledTimes(2);
  });

  it('rejects webhook bodies with an invalid signature', async () => {
    seedWorkspace();
    const response = await fetch(`${baseUrl}/api/notifications/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
      },
      body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
    });
    expect(response.status).toBe(401);
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
        task: {
          id: 'task-3',
          title: 'Check tank',
          priority: 'low',
          dueDate: '2026-07-26',
          assignedUserId: 'outsider',
        },
      }),
    });

    expect(response.status).toBe(404);
    expect(whatsappModule.sendWhatsAppTaskAssignment).not.toHaveBeenCalled();
  });
});
