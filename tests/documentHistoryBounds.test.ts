import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMergeOutcomeTally,
  documentHistoryStats,
  mergeCollections,
  resetDocumentHistory,
} from '../server/sync';

/**
 * The baseline store behind three-way merge had no bound at all: entries were
 * capped per record, but the map itself had no TTL, no size limit, and nothing
 * removed a key when its record or organization was deleted. It only ever
 * looked healthy because the service scales to zero and the process — with the
 * map inside it — is discarded when idle.
 *
 * These tests pin the bound, and pin that bounding it did not cost the merge.
 */

const stamp = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();

let scopeCounter = 0;
const freshScope = () => `org-${scopeCounter += 1}`;

/** One clean fast-forward, which is what records a baseline. */
function mergeOnce(scope: string, id: string, from: number, to: number) {
  const db: any = { lots: [{ id, name: `v${from}`, lastModified: stamp(from) }] };
  mergeCollections(db, {
    lots: [{ id, name: `v${to}`, lastModified: stamp(to), baselineTimestamp: stamp(from) }],
  }, scope, createMergeOutcomeTally());
  return db;
}

describe('document history bounds', () => {
  beforeEach(() => resetDocumentHistory());

  it('retains a baseline so a concurrent edit can still be merged', () => {
    // The behaviour the store exists for; bounding must not break it.
    const scope = freshScope();
    const db: any = { lots: [{ id: 'LOT-1', name: 'Original', volume: 100, lastModified: stamp(1) }] };

    mergeCollections(db, {
      lots: [{ id: 'LOT-1', name: 'Renamed', volume: 100, lastModified: stamp(2), baselineTimestamp: stamp(1) }],
    }, scope, createMergeOutcomeTally());

    const tally = createMergeOutcomeTally();
    const conflicts = mergeCollections(db, {
      lots: [{ id: 'LOT-1', name: 'Original', volume: 250, lastModified: stamp(3), baselineTimestamp: stamp(1) }],
    }, scope, tally);

    expect(conflicts).toEqual([]);
    expect(tally.fieldMergeApplied).toBe(1);
    expect(documentHistoryStats().records).toBeGreaterThan(0);
  });

  it('grows one record at a time, not one copy per merge', () => {
    const scope = freshScope();
    for (let version = 1; version < 30; version += 1) {
      mergeOnce(scope, 'LOT-1', version, version + 1);
    }

    const stats = documentHistoryStats();
    expect(stats.records).toBe(1);
    // Capped at twenty baselines for the record, not twenty-nine.
    expect(stats.entries).toBeLessThanOrEqual(20);
  });

  it('stays bounded when every record in a large winery is edited', () => {
    // Previously this grew without limit for the life of the process.
    const scope = freshScope();
    for (let i = 0; i < 22_000; i += 1) {
      mergeOnce(scope, `LOT-${i}`, 1, 2);
    }

    expect(documentHistoryStats().records).toBeLessThanOrEqual(20_000);
  });

  it('keeps merging correctly after the store has been pruned', () => {
    // Pruning must not corrupt what survives: a baseline recorded after the
    // sweep still has to resolve a concurrent edit.
    const scope = freshScope();
    for (let i = 0; i < 21_000; i += 1) mergeOnce(scope, `FILLER-${i}`, 1, 2);

    const db: any = { lots: [{ id: 'LOT-LIVE', name: 'Original', volume: 100, lastModified: stamp(1) }] };
    mergeCollections(db, {
      lots: [{ id: 'LOT-LIVE', name: 'Renamed', volume: 100, lastModified: stamp(2), baselineTimestamp: stamp(1) }],
    }, scope, createMergeOutcomeTally());

    const tally = createMergeOutcomeTally();
    const conflicts = mergeCollections(db, {
      lots: [{ id: 'LOT-LIVE', name: 'Original', volume: 250, lastModified: stamp(3), baselineTimestamp: stamp(1) }],
    }, scope, tally);

    expect(conflicts).toEqual([]);
    expect(tally.fieldMergeApplied).toBe(1);
    expect(db.lots[0].name).toBe('Renamed');
    expect(db.lots[0].volume).toBe(250);
  });

  it('separates organizations that reuse the same record id', () => {
    // Seeded vessel ids like "T-101" are identical across estates; a shared
    // baseline would merge one winery's edit against another's data.
    const first = freshScope();
    const second = freshScope();
    mergeOnce(first, 'T-101', 1, 2);
    mergeOnce(second, 'T-101', 1, 2);

    expect(documentHistoryStats().records).toBe(2);
  });

  it('reports an empty store after a cold start', () => {
    mergeOnce(freshScope(), 'LOT-1', 1, 2);
    expect(documentHistoryStats().records).toBeGreaterThan(0);

    // What every scale-to-zero idle period does in production.
    resetDocumentHistory();

    expect(documentHistoryStats()).toEqual({ records: 0, entries: 0 });
  });

  it('reports a conflict rather than a bad merge once a baseline is gone', () => {
    // The consequence of a cold start, stated as a test: without the baseline
    // the merge declines to guess and the edit is surfaced, not silently lost.
    const scope = freshScope();
    const db = mergeOnce(scope, 'LOT-1', 1, 2);
    resetDocumentHistory();

    const tally = createMergeOutcomeTally();
    const conflicts = mergeCollections(db, {
      lots: [{ id: 'LOT-1', name: 'Concurrent edit', lastModified: stamp(3), baselineTimestamp: stamp(1) }],
    }, scope, tally);

    expect(conflicts).toHaveLength(1);
    expect(tally.baselineUnavailable).toBe(1);
    expect(db.lots[0].name).toBe('v2');
  });
});
