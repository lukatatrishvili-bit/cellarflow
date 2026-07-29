import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorized: true,
  snapshot: vi.fn(),
  retry: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('../server/middleware/auth', () => ({
  requireMasterAdmin: async (_req: express.Request, res: express.Response) => {
    if (!mocks.authorized) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return { username: 'master' };
  },
}));

vi.mock('../server/aiOperations', () => ({
  getAiOperationsSnapshot: mocks.snapshot,
}));

vi.mock('../server/aiNotificationOutbox', () => ({
  retryFailedAiNotification: mocks.retry,
}));

vi.mock('../server/securityAudit', () => ({
  auditSecurityEvent: mocks.audit,
}));

vi.mock('../server/config', () => ({
  clientIp: () => '127.0.0.1',
}));

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  const routes = await import('../server/routes/aiOperationsAdmin');
  const app = express();
  app.use(express.json());
  app.use('/api/admin/ai-operations', routes.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  mocks.authorized = true;
  mocks.snapshot.mockReset().mockResolvedValue({
    checkedAt: '2026-07-29T12:00:00.000Z',
    health: 'healthy',
  });
  mocks.retry.mockReset();
  mocks.audit.mockReset().mockResolvedValue(undefined);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe('master-admin AI operations routes', () => {
  it('requires master-admin access for the operational snapshot', async () => {
    mocks.authorized = false;
    const response = await fetch(`${baseUrl}/api/admin/ai-operations`);
    expect(response.status).toBe(403);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it('returns a bounded no-store snapshot', async () => {
    const response = await fetch(`${baseUrl}/api/admin/ai-operations?limit=500`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.snapshot).toHaveBeenCalledWith(100);
  });

  it('audits a successful terminal-failure retry', async () => {
    mocks.retry.mockResolvedValue({
      outcome: 'queued',
      record: {
        id: 'notification-1',
        organizationId: 'org-1',
        channel: 'email',
      },
    });
    const response = await fetch(
      `${baseUrl}/api/admin/ai-operations/notifications/notification-1/retry`,
      { method: 'POST' },
    );
    expect(response.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'ai.notification_retry_requested',
      actorUsername: 'master',
      organizationId: 'org-1',
    }));
  });

  it('does not requeue a recipient who is no longer eligible', async () => {
    mocks.retry.mockResolvedValue({
      outcome: 'ineligible',
      reason: 'Email alerts are not enabled for this winery.',
    });
    const response = await fetch(
      `${baseUrl}/api/admin/ai-operations/notifications/notification-1/retry`,
      { method: 'POST' },
    );
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.reason).toContain('not enabled');
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
