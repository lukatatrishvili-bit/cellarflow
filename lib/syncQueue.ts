const DB_NAME = 'VineaOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'offline_mutations';

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
  static openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not supported in this environment'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }

  static async addMutation(mutation: Omit<OfflineMutation, 'id' | 'timestamp'>): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const item: OfflineMutation = {
          ...mutation,
          id: `${mutation.collection}-${mutation.recordId}-${Date.now()}`,
          timestamp: new Date().toISOString()
        };
        const request = store.put(item);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (err) {
      console.warn('IndexedDB write warning:', err);
    }
  }

  static async getMutations(): Promise<OfflineMutation[]> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    } catch {
      return [];
    }
  }

  static async clearMutations(): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (err) {
      console.warn('IndexedDB clear warning:', err);
    }
  }
}

export class SyncQueueManager {
  private static DIRTY_KEY = 'vinea_dirty_collections';

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

    // 2. We are online. Check if we have queued offline mutations in IndexedDB
    const offlineMutations = await IndexedDBQueue.getMutations();
    if (offlineMutations.length > 0) {
      try {
        // Fetch server state to compare for conflict detection
        const serverRes = await fetch('/api/db');
        if (serverRes.ok) {
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
    
    if (dirty.size > 0) {
      dirty.forEach(col => {
        let serverKey = col;
        if (col === 'notesList') serverKey = 'notes';
        if (col === 'fermLogs') serverKey = 'fermlogs';
        if (col === 'labLogs') serverKey = 'lablogs';
        
        if (currentState[col]) {
          payload[serverKey] = currentState[col];
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
        headers: { 'Content-Type': 'application/json' }
      };
      
      if (method === 'POST') {
        options.body = JSON.stringify(payload);
      }

      const res = await fetch(endpoint, options);
      if (res.ok) {
        this.clearDirty();
        localStorage.removeItem('vinea_deleted_ids');
        await IndexedDBQueue.clearMutations();
        const data = await res.json();
        return data;
      }
    } catch (err) {
      console.error('ERP Sync failed:', err);
    }
    return null;
  }
}
