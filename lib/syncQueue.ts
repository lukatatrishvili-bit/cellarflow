import type { RxDatabase } from 'rxdb';

const DB_NAME = 'vinea_rx_offline_db';

let dbPromise: Promise<RxDatabase> | null = null;

export async function getRxDB(): Promise<RxDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const [{ createRxDatabase }, { getRxStorageDexie }] = await Promise.all([
      import('rxdb'),
      import('rxdb/plugins/storage-dexie')
    ]);

    const db = await createRxDatabase({
      name: DB_NAME,
      storage: getRxStorageDexie()
    });

    await db.addCollections({
      mutations: {
        schema: {
          title: 'mutation schema',
          version: 0,
          primaryKey: 'id',
          type: 'object',
          properties: {
            id: { type: 'string', maxLength: 150 },
            collection: { type: 'string' },
            recordId: { type: 'string' },
            action: { type: 'string' },
            data: { type: 'object' },
            timestamp: { type: 'string' },
            baselineTimestamp: { type: 'string' }
          },
          required: ['id', 'collection', 'recordId', 'action', 'timestamp']
        }
      }
    });

    return db;
  })();

  return dbPromise;
}

export interface OfflineMutation {
  id: string; // Unique queue item ID
  collection: string; // e.g. 'vessels', 'lots', etc.
  recordId: string; // The ID of the record being mutated
  action: 'put' | 'delete';
  data?: any;
  timestamp: string;
  baselineTimestamp?: string; // Timestamp of record before offline modifications
}

export class IndexedDBQueue {
  static async addMutation(mutation: Omit<OfflineMutation, 'id' | 'timestamp'>): Promise<void> {
    try {
      const db = await getRxDB();
      const id = `${mutation.collection}-${mutation.recordId}-${Date.now()}`;
      const item: OfflineMutation = {
        ...mutation,
        id,
        timestamp: new Date().toISOString()
      };
      await db.collections.mutations.insert(item);
    } catch (err) {
      console.warn('RxDB write warning:', err);
    }
  }

  static async getMutations(): Promise<OfflineMutation[]> {
    try {
      const db = await getRxDB();
      const docs = await db.collections.mutations.find().exec();
      return docs.map(doc => doc.toJSON() as OfflineMutation);
    } catch (err) {
      console.warn('RxDB read warning:', err);
      return [];
    }
  }

  static async clearMutations(): Promise<void> {
    try {
      const db = await getRxDB();
      const docs = await db.collections.mutations.find().exec();
      await Promise.all(docs.map(doc => doc.remove()));
    } catch (err) {
      console.warn('RxDB clear warning:', err);
    }
  }
}

export class SyncQueueManager {
  private static DIRTY_KEY = 'vinea_dirty_collections';
  private static ORG_STATE_KEYS = {
    orgId: 'cellarflow_org_state_org_id',
    source: 'cellarflow_org_state_source',
    version: 'cellarflow_org_state_version',
    updatedAt: 'cellarflow_org_state_updated_at',
    updatedBy: 'cellarflow_org_state_updated_by',
  };

  private static hasLocalStorage(): boolean {
    return typeof localStorage !== 'undefined';
  }

  private static requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!this.hasLocalStorage()) return headers;

    const version = localStorage.getItem(this.ORG_STATE_KEYS.version);
    const orgId = localStorage.getItem(this.ORG_STATE_KEYS.orgId);
    if (version) headers['X-CellarFlow-Org-State-Version'] = version;
    if (orgId) headers['X-CellarFlow-Org-Id'] = orgId;
    return headers;
  }

  private static rememberOrgStateHeaders(res: Response): void {
    if (!this.hasLocalStorage()) return;

    const pairs: Array<[string, string]> = [
      [this.ORG_STATE_KEYS.orgId, 'X-CellarFlow-Org-Id'],
      [this.ORG_STATE_KEYS.source, 'X-CellarFlow-Org-State-Source'],
      [this.ORG_STATE_KEYS.version, 'X-CellarFlow-Org-State-Version'],
      [this.ORG_STATE_KEYS.updatedAt, 'X-CellarFlow-Org-State-Updated-At'],
      [this.ORG_STATE_KEYS.updatedBy, 'X-CellarFlow-Org-State-Updated-By'],
    ];

    for (const [storageKey, headerName] of pairs) {
      const value = res.headers.get(headerName);
      if (value) localStorage.setItem(storageKey, value);
    }
  }

  static getDirtyCollections(): Set<string> {
    const stored = localStorage.getItem(this.DIRTY_KEY);
    if (!stored) return new Set();
    try {
      return new Set(JSON.parse(stored));
    } catch {
      return new Set();
    }
  }

  static markDirty(collectionName: string): void {
    const dirty = this.getDirtyCollections();
    dirty.add(collectionName);
    localStorage.setItem(this.DIRTY_KEY, JSON.stringify(Array.from(dirty)));
  }

  static clearDirty(): void {
    localStorage.removeItem(this.DIRTY_KEY);
  }

  /**
   * Clear only the given collections. Flags marked while a sync was in
   * flight must survive it, or those changes would never be pushed.
   */
  static clearDirtyKeys(keys: Iterable<string>): void {
    const dirty = this.getDirtyCollections();
    for (const key of keys) dirty.delete(key);
    if (dirty.size === 0) {
      localStorage.removeItem(this.DIRTY_KEY);
    } else {
      localStorage.setItem(this.DIRTY_KEY, JSON.stringify(Array.from(dirty)));
    }
  }

  static isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  static async clearOfflineQueue(): Promise<void> {
    await IndexedDBQueue.clearMutations();
    this.clearDirty();
  }

  static async sync(currentState: any): Promise<any | null> {
    // 1. If offline, exit immediately since mutations are queued directly on write
    if (!this.isOnline()) {
      return null;
    }

    // 2. We are online. Check if we have queued offline mutations in RxDB
    const offlineMutations = await IndexedDBQueue.getMutations();
    if (offlineMutations.length > 0) {
      try {
        // Fetch server state to compare for conflict detection
        const serverRes = await fetch('/api/db', { headers: this.requestHeaders() });
        if (serverRes.ok) {
          this.rememberOrgStateHeaders(serverRes);
          const serverDb = await serverRes.json();
          const conflicts: any[] = [];

          offlineMutations.forEach(mut => {
            if (mut.action === 'put') {
              const serverCol = mut.collection === 'notesList' ? 'notes' : 
                                mut.collection === 'fermLogs' ? 'fermlogs' : 
                                mut.collection === 'labLogs' ? 'lablogs' : mut.collection;
              const serverRecord = serverDb[serverCol]?.find((x: any) => x.id === mut.recordId);
              if (serverRecord) {
                // If server record was modified since client's baseline copy, we flag a conflict
                const baselineTS = mut.baselineTimestamp ? new Date(mut.baselineTimestamp).getTime() : 0;
                const serverTS = serverRecord.lastModified ? new Date(serverRecord.lastModified).getTime() : 0;
                
                if (serverTS > 0 && baselineTS > 0 && serverTS !== baselineTS) {
                  conflicts.push({
                    collection: mut.collection,
                    recordId: mut.recordId,
                    local: mut.data,
                    server: serverRecord
                  });
                }
              }
            }
          });

          if (conflicts.length > 0) {
            // Return conflicts to trigger frontend resolution modal
            return {
              hasConflicts: true,
              conflicts,
              serverDb
            };
          }
        }
      } catch (err) {
        console.error('Pre-sync conflict check failed:', err);
      }
    }

    // 3. Perform standard online synchronization
    const dirty = this.getDirtyCollections();
    const payload: any = {};
    const sentPairs: Array<{ clientKey: string; serverKey: string }> = [];

    if (dirty.size > 0) {
      dirty.forEach(col => {
        let serverKey = col;
        if (col === 'notesList') serverKey = 'notes';
        if (col === 'fermLogs') serverKey = 'fermlogs';
        if (col === 'labLogs') serverKey = 'lablogs';

        if (currentState[col]) {
          payload[serverKey] = currentState[col];
          sentPairs.push({ clientKey: col, serverKey });
        }
      });
    }

    let deletedIds: string[] = [];
    try {
      const stored = localStorage.getItem('vinea_deleted_ids');
      if (stored) deletedIds = JSON.parse(stored);
    } catch { /* ignore */ }

    const hasChanges = Object.keys(payload).length > 0 || deletedIds.length > 0;
    if (deletedIds.length > 0) {
      payload.deletedIds = deletedIds;
    }

    try {
      const endpoint = hasChanges ? '/api/sync' : '/api/db';
      const method = hasChanges ? 'POST' : 'GET';
      const options: RequestInit = {
        method,
        headers: this.requestHeaders()
      };
      
      if (method === 'POST') {
        options.body = JSON.stringify(payload);
      }

      const res = await fetch(endpoint, options);
      if (res.ok) {
        this.rememberOrgStateHeaders(res);
        this.clearDirtyKeys(dirty);
        this.consumeDeletedIds(deletedIds);
        await IndexedDBQueue.clearMutations();
        const data = await res.json();
        return data;
      }
      this.rememberOrgStateHeaders(res);
      let rejectionPayload: any | null = null;

      if (method === 'POST' && res.status === 409) {
        rejectionPayload = await res.json().catch(() => ({} as any));
        if (rejectionPayload?.code === 'org_state_conflict') {
          const retryOptions: RequestInit = {
            method,
            headers: this.requestHeaders(),
            body: JSON.stringify(payload)
          };
          const retryRes = await fetch(endpoint, retryOptions);
          this.rememberOrgStateHeaders(retryRes);

          if (retryRes.ok) {
            this.clearDirtyKeys(dirty);
            this.consumeDeletedIds(deletedIds);
            await IndexedDBQueue.clearMutations();
            const data = await retryRes.json();
            return { ...data, recoveredOrgStateConflict: true };
          }

          const retryPayload = await retryRes.json().catch(() => ({} as any));
          return {
            orgStateConflict: true,
            syncError: retryPayload.error || rejectionPayload.error || `Sync rejected (HTTP ${retryRes.status})`,
            serverDb: retryPayload.serverDb || rejectionPayload.serverDb,
          };
        }
      }

      // Server-side validation rejection: retry each collection separately
      if (method === 'POST' && res.status >= 400 && res.status < 500) {
        const firstErr = rejectionPayload || await res.json().catch(() => ({} as any));
        if (sentPairs.length <= 1) {
          return { syncError: firstErr.error || `Sync rejected (HTTP ${res.status})` };
        }

        let lastGood: any = null;
        const conflicts: any[] = [];
        const syncErrors: string[] = [];

        for (const { clientKey, serverKey } of sentPairs) {
          try {
            const single: any = { [serverKey]: payload[serverKey] };
            if (deletedIds.length > 0) single.deletedIds = deletedIds;
            const r = await fetch('/api/sync', {
              method: 'POST',
              headers: this.requestHeaders(),
              body: JSON.stringify(single)
            });
            if (r.ok) {
              this.rememberOrgStateHeaders(r);
              const data = await r.json();
              if (data.hasConflicts) {
                conflicts.push(...data.conflicts);
                lastGood = data.serverDb;
              } else {
                lastGood = data;
              }
              this.clearDirtyKeys([clientKey]);
            } else {
              this.rememberOrgStateHeaders(r);
              const e = await r.json().catch(() => ({} as any));
              syncErrors.push(`${clientKey}: ${e.error || `HTTP ${r.status}`}`);
            }
          } catch {
            syncErrors.push(`${clientKey}: network error`);
          }
        }

        if (lastGood) {
          this.consumeDeletedIds(deletedIds);
          await IndexedDBQueue.clearMutations();
        }
        if (conflicts.length > 0) {
          return { hasConflicts: true, conflicts, serverDb: lastGood, syncErrors: syncErrors.length ? syncErrors : undefined };
        }
        if (lastGood) {
          return { ...lastGood, syncErrors: syncErrors.length ? syncErrors : undefined };
        }
        return { syncError: syncErrors[0] || firstErr.error || `Sync rejected (HTTP ${res.status})` };
      }
    } catch (err) {
      console.error('ERP Sync failed:', err);
    }
    return null;
  }

  private static consumeDeletedIds(sent: string[]): void {
    if (sent.length === 0) {
      localStorage.removeItem('vinea_deleted_ids');
      return;
    }
    let remaining: string[] = [];
    try {
      const stored = localStorage.getItem('vinea_deleted_ids');
      const current: string[] = stored ? JSON.parse(stored) : [];
      remaining = current.filter((id) => !sent.includes(id));
    } catch { /* ignore */ }
    if (remaining.length > 0) {
      localStorage.setItem('vinea_deleted_ids', JSON.stringify(remaining));
    } else {
      localStorage.removeItem('vinea_deleted_ids');
    }
  }
}
