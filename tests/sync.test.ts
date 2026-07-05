import { describe, it, expect } from 'vitest';
import { mergeCollections, applyDeletions, toClientKey, isValidId } from '../server/sync';

const item = (id: string, fields: Record<string, any> = {}) => ({ id, ...fields });

describe('toClientKey', () => {
  it('maps server collection names back to client hook keys', () => {
    expect(toClientKey('notes')).toBe('notesList');
    expect(toClientKey('fermlogs')).toBe('fermLogs');
    expect(toClientKey('lablogs')).toBe('labLogs');
    expect(toClientKey('vessels')).toBe('vessels');
  });
});

describe('isValidId', () => {
  it('accepts Georgian (Unicode) ids — the core bug fix', () => {
    expect(isValidId('ქვევრი 1')).toBe(true);       // qvevri named in Georgian
    expect(isValidId('საფერავი-2026')).toBe(true);   // Saperavi lot
    expect(isValidId('მარანი_T-1')).toBe(true);
  });

  it('still accepts ASCII ids', () => {
    expect(isValidId('SAP-2026-01')).toBe(true);
    expect(isValidId('Tank 3')).toBe(true);
  });

  it('rejects empty, oversized, and unsafe ids', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId('a'.repeat(129))).toBe(false);
    expect(isValidId('lot/../etc')).toBe(false);   // path separator
    expect(isValidId('a?b=1')).toBe(false);        // query chars
    expect(isValidId('line\nbreak')).toBe(false);  // control char
    expect(isValidId(42 as any)).toBe(false);
  });
});

describe('applyDeletions', () => {
  it('removes matching ids across all array collections', () => {
    const db: any = {
      lots: [item('a'), item('b')],
      tasks: [item('b'), item('c')],
      companyProfile: { companyName: 'X' },
    };
    applyDeletions(db, ['b']);
    expect(db.lots.map((x: any) => x.id)).toEqual(['a']);
    expect(db.tasks.map((x: any) => x.id)).toEqual(['c']);
    expect(db.companyProfile.companyName).toBe('X');
  });

  it('tolerates missing or empty deletedIds', () => {
    const db: any = { lots: [item('a')] };
    applyDeletions(db, undefined);
    applyDeletions(db, []);
    expect(db.lots).toHaveLength(1);
  });
});

describe('mergeCollections', () => {
  it('appends new items', () => {
    const db: any = { tasks: [] };
    const conflicts = mergeCollections(db, { tasks: [item('t1', { title: 'Punch down' })] });
    expect(conflicts).toEqual([]);
    expect(db.tasks).toHaveLength(1);
  });

  it('keeps identical content conflict-free but adopts the newer sync stamp', () => {
    const db: any = { tasks: [item('t1', { title: 'A', lastModified: '2026-06-01T00:00:00Z' })] };
    const conflicts = mergeCollections(db, {
      tasks: [item('t1', { title: 'A', lastModified: '2026-06-09T00:00:00Z' })],
    });
    expect(conflicts).toEqual([]);
    expect(db.tasks[0].title).toBe('A');
    // Refusing the stamp made the server echo differ from the client's copy,
    // re-marking the collection dirty on every response — an infinite sync loop.
    expect(db.tasks[0].lastModified).toBe('2026-06-09T00:00:00Z');
  });

  it('fast-forwards when the baseline matches the server version, stripping the baseline', () => {
    const db: any = { tasks: [item('t1', { title: 'A', lastModified: 'T0' })] };
    const conflicts = mergeCollections(db, {
      tasks: [item('t1', { title: 'B', lastModified: 'T1', baselineTimestamp: 'T0' })],
    });
    expect(conflicts).toEqual([]);
    expect(db.tasks[0].title).toBe('B');
    expect(db.tasks[0].lastModified).toBe('T1');
    expect(db.tasks[0].baselineTimestamp).toBeUndefined();
  });

  it('reports a conflict and keeps the server version when the baseline is stale', () => {
    const db: any = { fermlogs: [item('f1', { density: 1.05, lastModified: 'T1' })] };
    const conflicts = mergeCollections(db, {
      fermlogs: [item('f1', { density: 1.02, lastModified: 'T2', baselineTimestamp: 'T0' })],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      collection: 'fermLogs', // client-side key
      recordId: 'f1',
      local: { density: 1.02 },
      server: { density: 1.05 },
    });
    expect(db.fermlogs[0].density).toBe(1.05); // untouched
  });

  it('falls back to silent last-write-wins when no baseline is present', () => {
    const db: any = {
      tasks: [
        item('newer-on-server', { title: 'server', lastModified: '2026-06-10T00:00:00Z' }),
        item('newer-on-client', { title: 'server', lastModified: '2026-06-01T00:00:00Z' }),
      ],
    };
    const conflicts = mergeCollections(db, {
      tasks: [
        item('newer-on-server', { title: 'client', lastModified: '2026-06-05T00:00:00Z' }),
        item('newer-on-client', { title: 'client', lastModified: '2026-06-09T00:00:00Z' }),
      ],
    });
    expect(conflicts).toEqual([]); // stale untouched copies are not conflicts
    expect(db.tasks[0].title).toBe('server');
    expect(db.tasks[1].title).toBe('client');
  });

  it('never merges the users collection and replaces companyProfile wholesale', () => {
    const db: any = { users: [item('u1', { passwordHash: 'x' })], companyProfile: { companyName: 'Old' } };
    const conflicts = mergeCollections(db, {
      users: [item('u2')],
      companyProfile: { companyName: 'New' },
    });
    expect(conflicts).toEqual([]);
    expect(db.users.map((u: any) => u.id)).toEqual(['u1']);
    expect(db.companyProfile.companyName).toBe('New');
  });

  it('replaces the wine pricing map as an account-backed object collection', () => {
    const db: any = { winePricing: { L1: 12 } };
    const conflicts = mergeCollections(db, {
      winePricing: { L1: 18, L2: 24 },
    });
    expect(conflicts).toEqual([]);
    expect(db.winePricing).toEqual({ L1: 18, L2: 24 });
  });

  it('merges new ERP ledger collections such as costs, bottling, storage, and transfers', () => {
    const db: any = {
      costEntries: [],
      bottlingRuns: [],
      storageLocations: [],
      stockMovements: [],
      salesDispatches: [],
      salesOrders: [],
      transfers: [],
    };
    const conflicts = mergeCollections(db, {
      costEntries: [item('cost-1', { lotId: 'LOT-1', amount: 100 })],
      bottlingRuns: [item('bot-1', { lotId: 'LOT-1', totalBottles: 120 })],
      storageLocations: [item('loc-1', { name: 'Warehouse A' })],
      stockMovements: [item('mov-1', { lotId: 'LOT-1', locationId: 'loc-1', bottles: 120 })],
      salesDispatches: [item('sale-1', { lotId: 'LOT-1', locationId: 'loc-1', bottles: 12 })],
      salesOrders: [item('so-1', { lotId: 'LOT-1', locationId: 'loc-1', bottles: 24, status: 'reserved' })],
      transfers: [item('xfer-1', { sourceId: 'T1', destId: 'T2', volume: 500 })],
    });
    expect(conflicts).toEqual([]);
    expect(db.costEntries).toHaveLength(1);
    expect(db.bottlingRuns).toHaveLength(1);
    expect(db.storageLocations).toHaveLength(1);
    expect(db.stockMovements).toHaveLength(1);
    expect(db.salesDispatches).toHaveLength(1);
    expect(db.salesOrders).toHaveLength(1);
    expect(db.transfers).toHaveLength(1);
  });

  it('ignores collections the db does not know', () => {
    const db: any = { tasks: [] };
    mergeCollections(db, { exploits: [item('e1')] });
    expect(db.exploits).toBeUndefined();
  });
});

describe('mergeCollections — sync-stamp convergence (chart-flashing loop fix)', () => {
  it('adopts the client lastModified when content is identical but the server copy is stamp-less', () => {
    const db: any = { tasks: [{ id: 't1', title: 'Rack T-3' }] }; // seeded without a stamp
    const conflicts = mergeCollections(db, {
      tasks: [{ id: 't1', title: 'Rack T-3', lastModified: '2026-07-02T10:00:00.000Z' }],
    });
    expect(conflicts).toEqual([]);
    // Without adoption the response never matches the client's stamped copy,
    // which re-marks the collection dirty on every pass → infinite sync loop.
    expect(db.tasks[0].lastModified).toBe('2026-07-02T10:00:00.000Z');
  });

  it('does not touch content when only the stamp differs', () => {
    const db: any = { tasks: [{ id: 't1', title: 'Rack T-3', lastModified: '2026-07-01T00:00:00.000Z' }] };
    mergeCollections(db, {
      tasks: [{ id: 't1', title: 'Rack T-3', lastModified: '2026-07-02T00:00:00.000Z' }],
    });
    expect(db.tasks[0].title).toBe('Rack T-3');
    expect(db.tasks[0].lastModified).toBe('2026-07-02T00:00:00.000Z');
  });
});

describe('mergeCollections — field-level merge resolution', () => {
  it('merges non-overlapping modified fields automatically without conflict', () => {
    const db: any = {
      vessels: [item('v1', { temperature: 20, cleaningStatus: 'clean', lastModified: 'T0' })]
    };
    
    // 1. Client B syncs first, modifying cleaningStatus (setting lastModified to T1)
    // Server database state transitions from T0 to T1
    const conflicts1 = mergeCollections(db, {
      vessels: [item('v1', { temperature: 20, cleaningStatus: 'dirty', lastModified: 'T1', baselineTimestamp: 'T0' })]
    });
    expect(conflicts1).toEqual([]);
    expect(db.vessels[0].cleaningStatus).toBe('dirty');
    expect(db.vessels[0].temperature).toBe(20);
    expect(db.vessels[0].lastModified).toBe('T1');
    
    // 2. Client A syncs next, modifying temperature based on T0 (setting lastModified to T2)
    // Client A's baseline is T0, server is now T1.
    // Modified fields do not overlap: Client A edited temperature (20 -> 18), Server/Client B edited cleaningStatus (clean -> dirty).
    const conflicts2 = mergeCollections(db, {
      vessels: [item('v1', { temperature: 18, cleaningStatus: 'clean', lastModified: 'T2', baselineTimestamp: 'T0' })]
    });
    expect(conflicts2).toEqual([]);
    expect(db.vessels[0].temperature).toBe(18);
    expect(db.vessels[0].cleaningStatus).toBe('dirty');
    expect(db.vessels[0].lastModified).toBe('T2');
  });

  it('declares a conflict when the same field is modified to different values', () => {
    const db: any = {
      vessels: [item('v1', { temperature: 20, cleaningStatus: 'clean', lastModified: 'T0' })]
    };
    
    // Client B modifies temperature to 25
    mergeCollections(db, {
      vessels: [item('v1', { temperature: 25, cleaningStatus: 'clean', lastModified: 'T1', baselineTimestamp: 'T0' })]
    });
    
    // Client A modifies temperature to 18 based on T0
    const conflicts = mergeCollections(db, {
      vessels: [item('v1', { temperature: 18, cleaningStatus: 'clean', lastModified: 'T2', baselineTimestamp: 'T0' })]
    });
    
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].recordId).toBe('v1');
    expect(db.vessels[0].temperature).toBe(25); // server version wins, conflict reported
  });
});

