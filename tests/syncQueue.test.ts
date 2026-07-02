import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBQueue, SyncQueueManager } from '../lib/syncQueue';

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

describe('SyncQueueManager organization-state recovery', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('navigator', { onLine: true });
    vi.spyOn(IndexedDBQueue, 'getMutations').mockResolvedValue([]);
    vi.spyOn(IndexedDBQueue, 'clearMutations').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries once when PostgreSQL JSONB organization state changed mid-save', async () => {
    localStorage.setItem('vinea_dirty_collections', JSON.stringify(['tasks']));
    localStorage.setItem('cellarflow_org_state_version', '5');
    localStorage.setItem('cellarflow_org_state_org_id', 'org-1');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(
        {
          code: 'org_state_conflict',
          error: 'Organization data changed while saving.',
          serverDb: { tasks: [{ id: 'server-task', title: 'Server task' }] },
        },
        {
          status: 409,
          headers: {
            'X-CellarFlow-Org-State-Version': '6',
            'X-CellarFlow-Org-Id': 'org-1',
          },
        }
      ))
      .mockResolvedValueOnce(jsonResponse(
        { tasks: [{ id: 'client-task', title: 'Client task' }] },
        {
          status: 200,
          headers: {
            'X-CellarFlow-Org-State-Version': '7',
            'X-CellarFlow-Org-Id': 'org-1',
          },
        }
      ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await SyncQueueManager.sync({
      tasks: [{ id: 'client-task', title: 'Client task' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'X-CellarFlow-Org-State-Version': '5',
      }),
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'X-CellarFlow-Org-State-Version': '6',
      }),
    });
    expect(result).toMatchObject({
      recoveredOrgStateConflict: true,
      tasks: [{ id: 'client-task', title: 'Client task' }],
    });
    expect(localStorage.getItem('vinea_dirty_collections')).toBeNull();
    expect(localStorage.getItem('cellarflow_org_state_version')).toBe('7');
    expect(IndexedDBQueue.clearMutations).toHaveBeenCalledTimes(1);
  });

  it('returns a recoverable org-state conflict if the retry also fails', async () => {
    localStorage.setItem('vinea_dirty_collections', JSON.stringify(['tasks']));

    const firstServerDb = { tasks: [{ id: 'server-v1', title: 'Server v1' }] };
    const secondServerDb = { tasks: [{ id: 'server-v2', title: 'Server v2' }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(
        { code: 'org_state_conflict', error: 'First conflict', serverDb: firstServerDb },
        { status: 409 }
      ))
      .mockResolvedValueOnce(jsonResponse(
        { code: 'org_state_conflict', error: 'Second conflict', serverDb: secondServerDb },
        { status: 409 }
      ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await SyncQueueManager.sync({
      tasks: [{ id: 'client-task', title: 'Client task' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      orgStateConflict: true,
      syncError: 'Second conflict',
      serverDb: secondServerDb,
    });
    expect(localStorage.getItem('vinea_dirty_collections')).toBe(JSON.stringify(['tasks']));
    expect(IndexedDBQueue.clearMutations).not.toHaveBeenCalled();
  });
});
