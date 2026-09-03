import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBQueue, SyncQueueManager } from '../lib/syncQueue';
import { buildSyncCandidate } from '../server/routes/sync';

/**
 * Sync used to send every record of a dirty collection: editing one
 * fermentation log uploaded every fermentation log the winery had, and the cost
 * of a sync grew with the history rather than with the change.
 *
 * It is safe to send less because `mergeCollections` merges per record and only
 * ever removes a record through an explicit tombstone — proven independently in
 * `tests/auditHydration.test.ts`. These tests pin the client half: the right
 * records are selected, and the ones left out are not lost.
 */

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

/** Runs a sync and returns the collections the client actually posted. */
async function postedPayload(state: Record<string, any>): Promise<any> {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  await SyncQueueManager.sync(state);
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/sync'));
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
}

const lot = (id: string, name = id) => ({ id, name, lastModified: '2026-01-01T00:00:00.000Z' });

describe('per-record sync payloads', () => {
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

  it('sends only the record that changed', async () => {
    const lots = [lot('LOT-1'), lot('LOT-2'), lot('LOT-3')];
    SyncQueueManager.markDirty('lots', ['LOT-2']);

    const payload = await postedPayload({ lots });

    expect(payload.lots).toHaveLength(1);
    expect(payload.lots[0].id).toBe('LOT-2');
  });

  it('accumulates records edited before the next sync', async () => {
    const lots = [lot('LOT-1'), lot('LOT-2'), lot('LOT-3')];
    SyncQueueManager.markDirty('lots', ['LOT-1']);
    SyncQueueManager.markDirty('lots', ['LOT-3']);

    const payload = await postedPayload({ lots });

    expect(payload.lots.map((item: any) => item.id).sort()).toEqual(['LOT-1', 'LOT-3']);
  });

  it('sends the whole collection when the caller cannot say what changed', async () => {
    // A conflict retry marks a collection dirty without knowing which records
    // moved; "everything" is the only safe reading of that.
    const lots = [lot('LOT-1'), lot('LOT-2')];
    SyncQueueManager.markDirty('lots');

    const payload = await postedPayload({ lots });

    expect(payload.lots).toHaveLength(2);
  });

  it('never narrows a pending whole-collection push', async () => {
    // Ordering matters: the caller that asked for everything knew less than the
    // one that named a record, so the broader request has to win.
    const lots = [lot('LOT-1'), lot('LOT-2'), lot('LOT-3')];
    SyncQueueManager.markDirty('lots');
    SyncQueueManager.markDirty('lots', ['LOT-2']);

    const payload = await postedPayload({ lots });

    expect(payload.lots).toHaveLength(3);
  });

  it('widens to the whole collection when a later caller cannot say what changed', async () => {
    const lots = [lot('LOT-1'), lot('LOT-2'), lot('LOT-3')];
    SyncQueueManager.markDirty('lots', ['LOT-2']);
    SyncQueueManager.markDirty('lots');

    const payload = await postedPayload({ lots });

    expect(payload.lots).toHaveLength(3);
  });

  it('keeps the narrowed payload when a later pass has nothing new to name', async () => {
    // The collection effect re-runs after the local mirror is written, so the
    // second pass over one edit finds no per-record difference. Reading that as
    // "cannot say what changed" widened every edit back to a whole-collection
    // push — the bug this distinction exists to prevent.
    const lots = [lot('LOT-1'), lot('LOT-2'), lot('LOT-3')];
    SyncQueueManager.markDirty('lots', ['LOT-2']);
    SyncQueueManager.markDirty('lots', []);

    const payload = await postedPayload({ lots });

    expect(payload.lots.map((item: any) => item.id)).toEqual(['LOT-2']);
  });

  it('falls back to the whole collection when nothing is pending to send', async () => {
    // Nothing named and nothing already queued: too little information to
    // narrow safely, and sending too much is the harmless failure.
    const lots = [lot('LOT-1'), lot('LOT-2')];
    SyncQueueManager.markDirty('lots', []);

    const payload = await postedPayload({ lots });

    expect(payload.lots).toHaveLength(2);
  });

  it('narrows the payload for the two-pass sequence the app actually uses', async () => {
    // `handleCollectionUpdate` writes the local mirror and returns on the pass
    // that knows which records changed; the effect then re-runs, finds storage
    // already matching, and it is that second pass which marks the collection
    // dirty — with nothing left to name. Every test above drove markDirty with
    // ids directly, which the app never does, so all of them passed while the
    // real path still sent whole collections.
    const lots = [lot('LOT-1'), lot('LOT-2'), lot('LOT-3')];

    SyncQueueManager.noteChangedRecords('lots', ['LOT-2']);   // first pass
    SyncQueueManager.markDirty('lots', []);                    // re-run

    const payload = await postedPayload({ lots });

    expect(payload.lots.map((item: any) => item.id)).toEqual(['LOT-2']);
  });

  it('carries records forward when a sync never lands', async () => {
    // An edit whose sync failed must still be pending alongside the next one.
    SyncQueueManager.noteChangedRecords('lots', ['LOT-1']);
    SyncQueueManager.markDirty('lots', []);
    SyncQueueManager.noteChangedRecords('lots', ['LOT-3']);
    SyncQueueManager.markDirty('lots', []);

    const payload = await postedPayload({ lots: [lot('LOT-1'), lot('LOT-2'), lot('LOT-3')] });

    expect(payload.lots.map((item: any) => item.id).sort()).toEqual(['LOT-1', 'LOT-3']);
  });

  it('does not stage records for a collection already pending as a whole', async () => {
    SyncQueueManager.markDirty('lots');
    SyncQueueManager.noteChangedRecords('lots', ['LOT-2']);

    const payload = await postedPayload({ lots: [lot('LOT-1'), lot('LOT-2')] });

    expect(payload.lots).toHaveLength(2);
  });

  it('sends a non-array collection whole', async () => {
    SyncQueueManager.markDirty('companyProfile', ['ignored']);

    const payload = await postedPayload({ companyProfile: { companyName: 'Kakheti Estate' } });

    expect(payload.companyProfile).toEqual({ companyName: 'Kakheti Estate' });
  });

  it('drops a named record that no longer exists locally', async () => {
    // Deletion travels as a tombstone; a stale id must not become a null entry.
    SyncQueueManager.markDirty('lots', ['LOT-GONE']);

    const payload = await postedPayload({ lots: [lot('LOT-1')] });

    expect(payload.lots).toEqual([]);
  });

  it('forgets the record ids once the collection has been sent', async () => {
    SyncQueueManager.markDirty('lots', ['LOT-2']);
    await postedPayload({ lots: [lot('LOT-1'), lot('LOT-2')] });

    expect(SyncQueueManager.dirtyRecordIdsFor('lots')).toBeNull();
    expect(SyncQueueManager.getDirtyCollections().has('lots')).toBe(false);
  });

  it('keeps records edited while a sync was in flight', async () => {
    // clearDirtyKeys only retires a collection whose revision is unchanged, and
    // the record ids have to follow the same rule or that edit is lost.
    SyncQueueManager.markDirty('lots', ['LOT-1']);
    const sentRevisions = { lots: 1 };
    SyncQueueManager.markDirty('lots', ['LOT-2']);

    SyncQueueManager.clearDirtyKeys(['lots'], sentRevisions);

    expect(SyncQueueManager.getDirtyCollections().has('lots')).toBe(true);
    expect([...(SyncQueueManager.dirtyRecordIdsFor('lots') || [])].sort()).toEqual(['LOT-1', 'LOT-2']);
  });
});

describe('what the server does with a narrowed payload', () => {
  it('leaves the records the client left out untouched', async () => {
    // The property the whole change rests on, exercised against the real merge.
    const serverState: any = {
      lots: [lot('LOT-1', 'Original one'), lot('LOT-2', 'Original two'), lot('LOT-3', 'Original three')],
      syncDeletionLedger: [],
    };

    const { candidateDb, conflicts } = buildSyncCandidate(
      serverState,
      { lots: [{ ...lot('LOT-2', 'Renamed two'), lastModified: '2026-02-01T00:00:00.000Z', baselineTimestamp: '2026-01-01T00:00:00.000Z' }] },
      undefined,
      'org-delta',
    );

    expect(conflicts).toEqual([]);
    expect(candidateDb.lots).toHaveLength(3);
    expect(candidateDb.lots.find((l: any) => l.id === 'LOT-2').name).toBe('Renamed two');
    expect(candidateDb.lots.find((l: any) => l.id === 'LOT-1').name).toBe('Original one');
    expect(candidateDb.lots.find((l: any) => l.id === 'LOT-3').name).toBe('Original three');
  });

  it('still creates a record the server has never seen', async () => {
    const serverState: any = { lots: [lot('LOT-1')], syncDeletionLedger: [] };

    const { candidateDb } = buildSyncCandidate(
      serverState,
      { lots: [lot('LOT-NEW')] },
      undefined,
      'org-delta',
    );

    expect(candidateDb.lots.map((l: any) => l.id).sort()).toEqual(['LOT-1', 'LOT-NEW']);
  });
});
