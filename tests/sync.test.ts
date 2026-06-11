import { describe, it, expect } from 'vitest';
import { mergeCollections, applyDeletions, toClientKey } from '../server/sync';

const item = (id: string, fields: Record<string, any> = {}) => ({ id, ...fields });

describe('toClientKey', () => {
  it('maps server collection names back to client hook keys', () => {
    expect(toClientKey('notes')).toBe('notesList');
    expect(toClientKey('fermlogs')).toBe('fermLogs');
    expect(toClientKey('lablogs')).toBe('labLogs');
    expect(toClientKey('vessels')).toBe('vessels');
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

  it('ignores items with identical content regardless of timestamps', () => {
    const db: any = { tasks: [item('t1', { title: 'A', lastModified: '2026-06-01T00:00:00Z' })] };
    const conflicts = mergeCollections(db, {
      tasks: [item('t1', { title: 'A', lastModified: '2026-06-09T00:00:00Z' })],
    });
    expect(conflicts).toEqual([]);
    expect(db.tasks[0].lastModified).toBe('2026-06-01T00:00:00Z');
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

  it('ignores collections the db does not know', () => {
    const db: any = { tasks: [] };
    mergeCollections(db, { exploits: [item('e1')] });
    expect(db.exploits).toBeUndefined();
  });
});
