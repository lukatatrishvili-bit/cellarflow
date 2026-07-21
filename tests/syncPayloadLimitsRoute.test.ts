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
} from '../server/routes/sync';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  const app = express();
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
});
