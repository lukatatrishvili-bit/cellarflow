import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../server/middleware/auth', () => ({
  checkWineryScope: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as any).wineryContext = {
      username: 'payload-limit-user',
      role: 'Owner/Admin',
      organizationId: 'org-payload-limit',
    };
    next();
  },
  setOrganizationStateHeaders: vi.fn(),
}));

import syncRouter, {
  MAX_SYNC_RECORDS_PER_COLLECTION,
  MAX_SYNC_TOMBSTONES,
  syncBodyLimitErrorHandler,
} from '../server/routes/sync';

let server: Server;
let baseUrl = '';

// The suite mounts a 1 MB parser rather than the production MAX_SYNC_BODY_BYTES
// so the oversize case can be provoked without building a 5 MB request. What is
// under test is the envelope the handler produces, not the specific ceiling.
const TEST_BODY_LIMIT_BYTES = 1_000_000;

beforeAll(async () => {
  const app = express();
  app.use('/api/sync', express.json({ limit: TEST_BODY_LIMIT_BYTES }), syncBodyLimitErrorHandler);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', syncRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

async function postSync(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('sync payload limit HTTP boundary', () => {
  it('returns a stable 413 envelope for an oversized collection', async () => {
    const response = await postSync({
      lots: new Array(MAX_SYNC_RECORDS_PER_COLLECTION + 1).fill(null),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: 'sync_collection_record_limit_exceeded',
      error: expect.stringContaining('Local changes were kept'),
      limits: {
        recordsPerCollection: MAX_SYNC_RECORDS_PER_COLLECTION,
        tombstones: MAX_SYNC_TOMBSTONES,
      },
    });
  });

  // Without the dedicated handler this case answers with the body parser's HTML
  // error page: `res.json()` then rejects in lib/syncQueue and the user sees a
  // bare "Sync rejected (HTTP 413)" with nothing to act on. The offline tablet
  // accumulating inline attachments is the realistic way to reach it.
  it('returns a readable JSON envelope when the body exceeds the byte ceiling', async () => {
    const response = await postSync({
      attachments: [{ id: 'a1', storage: { kind: 'inline', dataUrl: 'x'.repeat(TEST_BODY_LIMIT_BYTES) } }],
    });

    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/json');

    const body = await response.json();
    expect(body).toMatchObject({ code: 'sync_payload_too_large' });
    // The message has to name a recovery, not just the failure.
    expect(body.error).toContain('external link');
    expect(body.error).toContain('remain on this device');
  });
});
