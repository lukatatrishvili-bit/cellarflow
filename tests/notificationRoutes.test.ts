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
let preferenceModule: typeof import('../server/aiNotificationPreferences');
let pushSubscriptionModule: typeof import('../server/aiPushSubscriptions');
let deliveryStoreModule: typeof import('../server/taskNotificationStore');
let notificationModule: typeof import('../server/taskNotifications');

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
  db.organizations = [{ id: 'org-notifications', name: 'VinOS Winery' }];
  db.memberships = [];
  db.invitations = [];
  db.securityAuditEvents = [];
  db.orgData = { 'org-notifications': dbModule.createEmptyUserData() };

  const owner = {
    username: 'owner',
    email: 'owner@example.test',
    emailVerified: true,
    fullName: 'Owner Sender',
    role: 'Owner/Admin',
    language: 'en',
    activeOrganizationId: 'org-notifications',
    accountEnabled: true,
    sessionVersion: 1,
  };
  const recipient = {
    username: 'nino',
    email: 'nino@example.test',
    emailVerified: true,
    fullName: 'ნინო',
    role: 'Cellar Worker',
    language: 'ka',
    activeOrganizationId: 'org-notifications',
    accountEnabled: true,
    sessionVersion: 1,
  };
  db.users.push(owner, recipient);
  db.memberships.push(
    { id: 'member-owner', userId: owner.username, organizationId: 'org-notifications', role: 'Owner/Admin' },
    { id: 'member-nino', userId: recipient.username, organizationId: 'org-notifications', role: 'Cellar Worker' },
  );
  return { owner, recipient };
}

function task(id: string) {
  return {
    id,
    title: 'ქვევრის შემოწმება',
    priority: 'high',
    dueDate: '2026-08-06',
    description: 'შეამოწმეთ ტემპერატურა',
    assignedUserId: 'nino',
  };
}

async function optRecipientIntoBothChannels() {
  await pushSubscriptionModule.registerAiPushSubscription({
    organizationId: 'org-notifications',
    username: 'nino',
    subscription: {
      endpoint: 'https://push.example.test/subscription/nino',
      keys: { p256dh: 'abcdefgh12345678', auth: 'abcdefgh12345678' },
    },
  });
  await preferenceModule.setAiNotificationPreference({
    organizationId: 'org-notifications',
    username: 'nino',
    emailEnabled: true,
    pushEnabled: true,
    minimumSeverity: 'warning',
    inAppMinimumSeverity: 'info',
  });
}

beforeAll(async () => {
  vi.resetModules();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vinos-notification-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SESSION_SECRET: 'notification-route-test-secret-at-least-32-bytes',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(temp, 'db.json'),
    GCS_BUCKET: '',
    SMTP_HOST: 'smtp.example.test',
    WEB_PUSH_VAPID_PUBLIC_KEY: 'test-public-key',
    WEB_PUSH_VAPID_PRIVATE_KEY: 'test-private-key',
    WEB_PUSH_VAPID_SUBJECT: 'mailto:notifications@example.test',
  };
  vi.doMock('../server/taskNotifications', async () => {
    const actual = await vi.importActual<typeof import('../server/taskNotifications')>(
      '../server/taskNotifications',
    );
    return {
      ...actual,
      sendTaskAssignmentEmail: vi.fn(async () => undefined),
      sendTaskAssignmentPush: vi.fn(async () => undefined),
    };
  });

  const notifications = await import('../server/routes/notifications');
  dbModule = await import('../server/db');
  authModule = await import('../server/auth');
  preferenceModule = await import('../server/aiNotificationPreferences');
  pushSubscriptionModule = await import('../server/aiPushSubscriptions');
  deliveryStoreModule = await import('../server/taskNotificationStore');
  notificationModule = await import('../server/taskNotifications');

  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notifications.default);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  preferenceModule.__resetInMemoryAiNotificationPreferences();
  pushSubscriptionModule.__resetInMemoryAiPushSubscriptions();
  deliveryStoreModule.__resetInMemoryTaskNotificationDeliveries();
  vi.mocked(notificationModule.sendTaskAssignmentEmail).mockReset().mockResolvedValue(undefined);
  vi.mocked(notificationModule.sendTaskAssignmentPush).mockReset().mockResolvedValue(undefined);
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env = { ...originalEnv };
  vi.doUnmock('../server/taskNotifications');
  vi.resetModules();
});

describe.sequential('email and browser push notification routes', () => {
  it('persists a temporary pause, a full disable, and an explicit resume', async () => {
    const { owner } = seedWorkspace();
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));
    const pauseEnd = new Date(Date.now() + 60 * 60 * 1_000).toISOString();

    const paused = await request('/api/notifications/preferences', token, {
      method: 'PUT',
      body: JSON.stringify({ notificationsEnabled: true, notificationsPausedUntil: pauseEnd }),
    });
    expect(paused.status).toBe(200);
    expect((await paused.json()).preference).toEqual(expect.objectContaining({
      notificationsEnabled: true,
      notificationsPausedUntil: pauseEnd,
    }));

    const disabled = await request('/api/notifications/preferences', token, {
      method: 'PUT',
      body: JSON.stringify({ notificationsEnabled: false, notificationsPausedUntil: null }),
    });
    expect((await disabled.json()).preference).toEqual(expect.objectContaining({
      notificationsEnabled: false,
      notificationsPausedUntil: null,
    }));

    const resumed = await request('/api/notifications/preferences', token, {
      method: 'PUT',
      body: JSON.stringify({ notificationsEnabled: true, notificationsPausedUntil: null }),
    });
    expect((await resumed.json()).preference).toEqual(expect.objectContaining({
      notificationsEnabled: true,
      notificationsPausedUntil: null,
    }));
  });

  it('rejects invalid or excessively long temporary pauses', async () => {
    const { owner } = seedWorkspace();
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));
    const response = await request('/api/notifications/preferences', token, {
      method: 'PUT',
      body: JSON.stringify({
        notificationsPausedUntil: new Date(Date.now() + 40 * 24 * 60 * 60 * 1_000).toISOString(),
      }),
    });
    expect(response.status).toBe(400);
  });

  it('suppresses every task-notification channel while the assignee is paused', async () => {
    const { owner } = seedWorkspace();
    await optRecipientIntoBothChannels();
    await preferenceModule.setAiNotificationPreference({
      organizationId: 'org-notifications',
      username: 'nino',
      emailEnabled: true,
      pushEnabled: true,
      minimumSeverity: 'warning',
      notificationsPausedUntil: new Date(Date.now() + 60 * 60 * 1_000),
    });
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));
    const response = await request('/api/notifications/tasks', token, {
      method: 'POST',
      body: JSON.stringify({ assigneeUsername: 'nino', task: task('task-muted') }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'notification_suppressed' }));
    expect(notificationModule.sendTaskAssignmentEmail).not.toHaveBeenCalled();
    expect(notificationModule.sendTaskAssignmentPush).not.toHaveBeenCalled();
  });

  it('requires the assignee to opt in to at least one external channel', async () => {
    const { owner } = seedWorkspace();
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));

    const response = await request('/api/notifications/tasks', token, {
      method: 'POST',
      body: JSON.stringify({ assigneeUsername: 'nino', task: task('task-no-consent') }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'notification_opt_in_required' }));
    expect(notificationModule.sendTaskAssignmentEmail).not.toHaveBeenCalled();
    expect(notificationModule.sendTaskAssignmentPush).not.toHaveBeenCalled();
  });

  it('delivers both opted-in channels once and safely replays the result', async () => {
    const { owner } = seedWorkspace();
    await optRecipientIntoBothChannels();
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));
    const body = JSON.stringify({ assigneeUsername: 'nino', task: task('task-dual-channel') });

    const first = await request('/api/notifications/tasks', token, { method: 'POST', body });
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual(expect.objectContaining({
      status: 'sent',
      deliveries: expect.arrayContaining([
        expect.objectContaining({ channel: 'email', status: 'sent' }),
        expect.objectContaining({ channel: 'push', status: 'sent' }),
      ]),
    }));

    const replay = await request('/api/notifications/tasks', token, { method: 'POST', body });
    expect(replay.status).toBe(202);
    expect((await replay.json()).status).toBe('sent');
    expect(notificationModule.sendTaskAssignmentEmail).toHaveBeenCalledTimes(1);
    expect(notificationModule.sendTaskAssignmentPush).toHaveBeenCalledTimes(1);
    expect(notificationModule.sendTaskAssignmentEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'nino@example.test',
      language: 'ka',
      wineryName: 'VinOS Winery',
    }));
  });

  it('retries only a failed channel after a partial delivery', async () => {
    const { owner } = seedWorkspace();
    await optRecipientIntoBothChannels();
    vi.mocked(notificationModule.sendTaskAssignmentPush)
      .mockRejectedValueOnce(new Error('push unavailable'))
      .mockResolvedValueOnce(undefined);
    const token = authModule.createSessionToken(authModule.sessionPayloadForUser(owner, 'Owner/Admin'));
    const body = JSON.stringify({ assigneeUsername: 'nino', task: task('task-partial-retry') });

    const first = await request('/api/notifications/tasks', token, { method: 'POST', body });
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual(expect.objectContaining({ status: 'partial' }));

    const retry = await request('/api/notifications/tasks', token, { method: 'POST', body });
    expect(retry.status).toBe(202);
    expect(await retry.json()).toEqual(expect.objectContaining({ status: 'sent' }));
    expect(notificationModule.sendTaskAssignmentEmail).toHaveBeenCalledTimes(1);
    expect(notificationModule.sendTaskAssignmentPush).toHaveBeenCalledTimes(2);
  });
});
