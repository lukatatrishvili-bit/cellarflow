import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestCeiling } from '../server/middleware/requestCeiling';
import { createSessionToken } from '../server/auth';

/**
 * The ceiling exists to stop a runaway client, so the properties that matter
 * are: it bills each account separately, it refuses before the handler runs,
 * and it tells the caller when to come back.
 */

let server: Server;
let baseUrl = '';
const handler = vi.fn((_req: express.Request, res: express.Response) => res.json({ ok: true }));

beforeAll(async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/cheap', requestCeiling({ name: 'test-cheap', max: 3, windowMs: 60_000 }), handler);
  // A second mount with its own name must not share the first one's counter.
  app.use('/other', requestCeiling({ name: 'test-other', max: 3, windowMs: 60_000 }), handler);
  app.use('/brief', requestCeiling({ name: 'test-brief', max: 1, windowMs: 150 }), handler);
  // A deliberately tiny caller table so the eviction path runs for real.
  app.use('/crowded', requestCeiling({
    name: 'test-crowded', max: 3, windowMs: 60_000, maxTrackedCallers: 8,
  }), handler);

  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});

afterEach(() => handler.mockClear());

const cookieFor = (username: string) =>
  `maranios_session=${createSessionToken({ username, role: 'Winemaker' })}`;

const call = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${path}`, { headers });

describe('requestCeiling', () => {
  it('admits traffic up to the ceiling and refuses past it', async () => {
    const cookie = cookieFor('steady-user');
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await call('/cheap', { cookie })).status);

    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    // Refused before the handler: the point is to avoid the work, not log it.
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('tells a refused caller when to retry', async () => {
    const cookie = cookieFor('retry-user');
    for (let i = 0; i < 3; i += 1) await call('/cheap', { cookie });

    const refused = await call('/cheap', { cookie });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);

    const body = await refused.json();
    expect(body.code).toBe('rate_limited');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('bills each account separately, so one busy tablet cannot lock out a colleague', async () => {
    const busy = cookieFor('busy-tablet');
    for (let i = 0; i < 4; i += 1) await call('/cheap', { cookie: busy });
    expect((await call('/cheap', { cookie: busy })).status).toBe(429);

    // Same winery, same NAT, different account — must be unaffected.
    expect((await call('/cheap', { cookie: cookieFor('colleague') })).status).toBe(200);
  });

  it('keeps separate buckets per mount', async () => {
    const cookie = cookieFor('two-route-user');
    for (let i = 0; i < 4; i += 1) await call('/cheap', { cookie });
    expect((await call('/cheap', { cookie })).status).toBe(429);

    expect((await call('/other', { cookie })).status).toBe(200);
  });

  it('falls back to the client address when there is no session', async () => {
    const anon = { 'x-forwarded-for': '203.0.113.77' };
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await call('/cheap', anon)).status);

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it('ignores a forged session cookie rather than granting it a fresh bucket', async () => {
    const anon = { 'x-forwarded-for': '203.0.113.78' };
    await call('/cheap', anon);
    await call('/cheap', anon);
    await call('/cheap', anon);
    expect((await call('/cheap', anon)).status).toBe(429);

    // An unsigned token fails verification, so the caller stays on its IP
    // bucket instead of minting a new identity to reset the counter.
    const forged = { ...anon, cookie: 'maranios_session=not.a.valid.token' };
    expect((await call('/cheap', forged)).status).toBe(429);
  });

  it('lets the window lapse', async () => {
    const cookie = cookieFor('patient-user');
    expect((await call('/brief', { cookie })).status).toBe(200);
    expect((await call('/brief', { cookie })).status).toBe(429);

    await new Promise(resolve => setTimeout(resolve, 200));
    expect((await call('/brief', { cookie })).status).toBe(200);
  });

  it('does not hand a throttled caller a fresh allowance when new callers arrive', async () => {
    // The map is bounded, and it used to be bounded by clearing it outright —
    // which reset every tracked caller at once. That made the ceiling weakest
    // exactly when the service was busiest, and it was reachable without any
    // privilege: keep arriving as new callers until the throttled one is wiped.
    // Expired windows are swept instead, so a live counter survives.
    const throttled = cookieFor('throttled-user');
    for (let i = 0; i < 4; i += 1) await call('/crowded', { cookie: throttled });
    expect((await call('/crowded', { cookie: throttled })).status).toBe(429);

    // Well past the 8-caller table, so eviction runs repeatedly.
    for (let i = 0; i < 40; i += 1) {
      await call('/crowded', { cookie: cookieFor(`transient-${i}`) });
    }

    expect((await call('/crowded', { cookie: throttled })).status).toBe(429);
  });
});
