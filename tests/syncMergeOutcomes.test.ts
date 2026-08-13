import { describe, it, expect, beforeEach } from 'vitest';
import { createMergeOutcomeTally, mergeCollections } from '../server/sync';
import {
  getOperationalTelemetrySnapshot,
  recordSyncMergeOutcomeMetric,
  resetOperationalTelemetryForTests,
} from '../server/operationalTelemetry';

/**
 * These tests calibrate a measurement that a design decision depends on: whether
 * the process-memory baselines behind three-way merge are worth persisting, or
 * whether the merge should be deleted (see
 * `docs/scale-out-and-delta-sync-design-2026-08-13.md`). A miscounted tally
 * would send that decision the wrong way, so each outcome is pinned to the
 * situation that produces it.
 */

const stamp = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();

/** Distinct scopes stop one case's baseline history leaking into the next. */
let scopeCounter = 0;
const freshScope = () => `org-${scopeCounter += 1}`;

describe('merge outcome tally', () => {
  it('counts a record the server has never seen', () => {
    const db: any = { lots: [] };
    const tally = createMergeOutcomeTally();

    mergeCollections(db, { lots: [{ id: 'LOT-1', name: 'Saperavi' }] }, freshScope(), tally);

    expect(tally.newRecord).toBe(1);
    expect(tally.unchanged).toBe(0);
  });

  it('counts a record the client did not need to send', () => {
    // The delta-sync measurement: sync ships whole collections, so most records
    // in a payload are byte-identical to what the server already holds.
    const record = { id: 'LOT-1', name: 'Saperavi', lastModified: stamp(1) };
    const db: any = { lots: [{ ...record }] };
    const tally = createMergeOutcomeTally();

    mergeCollections(db, { lots: [{ ...record }] }, freshScope(), tally);

    expect(tally.unchanged).toBe(1);
    expect(tally.cleanFastForward).toBe(0);
  });

  it('counts an edit whose baseline still matches the server', () => {
    const db: any = { lots: [{ id: 'LOT-1', name: 'Saperavi', lastModified: stamp(1) }] };
    const tally = createMergeOutcomeTally();

    const conflicts = mergeCollections(db, {
      lots: [{ id: 'LOT-1', name: 'Saperavi Reserve', lastModified: stamp(2), baselineTimestamp: stamp(1) }],
    }, freshScope(), tally);

    expect(conflicts).toEqual([]);
    expect(tally.cleanFastForward).toBe(1);
    expect(db.lots[0].name).toBe('Saperavi Reserve');
  });

  it('counts a stale baseline the merge could not judge, separately from a real collision', () => {
    // No history was ever recorded for this record, so the merge declines to
    // guess. This is the single-instance version of what EVERY stale-baseline
    // merge becomes on a second instance, which is why it is counted apart from
    // a genuine same-field conflict.
    const db: any = { lots: [{ id: 'LOT-1', name: 'Server name', lastModified: stamp(5) }] };
    const tally = createMergeOutcomeTally();

    const conflicts = mergeCollections(db, {
      lots: [{ id: 'LOT-1', name: 'Client name', lastModified: stamp(6), baselineTimestamp: stamp(1) }],
    }, freshScope(), tally);

    expect(conflicts).toHaveLength(1);
    expect(tally.baselineUnavailable).toBe(1);
    expect(tally.sameFieldConflict).toBe(0);
    // The conflicted edit is never applied.
    expect(db.lots[0].name).toBe('Server name');
  });

  it('counts a genuine same-field collision when the baseline IS available', () => {
    const scope = freshScope();
    const db: any = { lots: [{ id: 'LOT-1', name: 'Original', volume: 100, lastModified: stamp(1) }] };

    // First merge records the baseline in history as a side effect.
    mergeCollections(db, {
      lots: [{ id: 'LOT-1', name: 'Server name', volume: 100, lastModified: stamp(2), baselineTimestamp: stamp(1) }],
    }, scope, createMergeOutcomeTally());

    // Second client edits the same field from the same baseline.
    const tally = createMergeOutcomeTally();
    const conflicts = mergeCollections(db, {
      lots: [{ id: 'LOT-1', name: 'Client name', volume: 100, lastModified: stamp(3), baselineTimestamp: stamp(1) }],
    }, scope, tally);

    expect(conflicts).toHaveLength(1);
    expect(tally.sameFieldConflict).toBe(1);
    expect(tally.baselineUnavailable).toBe(0);
  });

  it('counts a field merge that three-way resolution actually rescued', () => {
    // The case that justifies keeping the merge: two people edited DIFFERENT
    // fields of one record, and nobody saw a conflict modal.
    const scope = freshScope();
    const db: any = { lots: [{ id: 'LOT-1', name: 'Original', volume: 100, lastModified: stamp(1) }] };

    mergeCollections(db, {
      lots: [{ id: 'LOT-1', name: 'Renamed by A', volume: 100, lastModified: stamp(2), baselineTimestamp: stamp(1) }],
    }, scope, createMergeOutcomeTally());

    const tally = createMergeOutcomeTally();
    const conflicts = mergeCollections(db, {
      lots: [{ id: 'LOT-1', name: 'Original', volume: 250, lastModified: stamp(3), baselineTimestamp: stamp(1) }],
    }, scope, tally);

    expect(conflicts).toEqual([]);
    expect(tally.fieldMergeApplied).toBe(1);
    expect(tally.sameFieldConflict).toBe(0);
    expect(tally.baselineUnavailable).toBe(0);
    // Both edits survived.
    expect(db.lots[0].name).toBe('Renamed by A');
    expect(db.lots[0].volume).toBe(250);
  });

  it('counts a payload with no baseline as legacy last-write-wins', () => {
    const db: any = { lots: [{ id: 'LOT-1', name: 'Server', lastModified: stamp(1) }] };
    const tally = createMergeOutcomeTally();

    const conflicts = mergeCollections(db, {
      lots: [{ id: 'LOT-1', name: 'Client', lastModified: stamp(2) }],
    }, freshScope(), tally);

    expect(conflicts).toEqual([]);
    expect(tally.legacyLastWriteWins).toBe(1);
  });

  it('leaves merge behaviour identical when no tally is passed', () => {
    const withTally: any = { lots: [{ id: 'LOT-1', name: 'Server', lastModified: stamp(1) }] };
    const without: any = { lots: [{ id: 'LOT-1', name: 'Server', lastModified: stamp(1) }] };
    const payload = () => ({
      lots: [{ id: 'LOT-1', name: 'Client', lastModified: stamp(2), baselineTimestamp: stamp(1) }],
    });

    const a = mergeCollections(withTally, payload(), freshScope(), createMergeOutcomeTally());
    const b = mergeCollections(without, payload(), freshScope());

    expect(a).toEqual(b);
    expect(withTally).toEqual(without);
  });
});

describe('one request, one count', () => {
  it('does not inflate counts when the deletion path builds a second candidate', async () => {
    // buildRecoverableSyncCandidate merges twice when a deletion is rejected:
    // once with the deletion, once without. Each build gets its own tally and
    // the result carries only its own, so the surviving candidate reports what
    // it actually did rather than the sum of both attempts.
    const { buildRecoverableSyncCandidate } = await import('../server/routes/sync');

    const userDb: any = {
      lots: [{ id: 'LOT-1', name: 'Server', lastModified: stamp(1) }],
      syncDeletionLedger: [],
    };
    const collections = {
      lots: [{ id: 'LOT-1', name: 'Client', lastModified: stamp(2), baselineTimestamp: stamp(1) }],
    };

    const result = buildRecoverableSyncCandidate(
      userDb,
      collections,
      ['LOT-1'],
      'deletion refused for this test',
      freshScope(),
    );

    expect(result.deletionRejected).toBe(true);
    // One record in the payload, so exactly one outcome — not two.
    const total = Object.values(result.mergeOutcomes).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(1);
    expect(result.mergeOutcomes.cleanFastForward).toBe(1);
  });
});

describe('merge outcome telemetry', () => {
  beforeEach(() => resetOperationalTelemetryForTests());

  const tallyOf = (overrides: Partial<ReturnType<typeof createMergeOutcomeTally>>) => ({
    ...createMergeOutcomeTally(),
    ...overrides,
  });

  it('reports the ratio that decides whether the baselines are worth persisting', () => {
    recordSyncMergeOutcomeMetric(tallyOf({
      fieldMergeApplied: 6,
      sameFieldConflict: 2,
      baselineUnavailable: 2,
    }));

    const { syncMergeOutcomes } = getOperationalTelemetrySnapshot();

    expect(syncMergeOutcomes.staleBaseline).toBe(10);
    expect(syncMergeOutcomes.fieldMergeSuccessRate).toBe(0.6);
    expect(syncMergeOutcomes.baselineUnavailableRate).toBe(0.2);
    expect(syncMergeOutcomes.unavoidableConflictRate).toBe(0.2);
  });

  it('reports how much of a payload the client never needed to send', () => {
    recordSyncMergeOutcomeMetric(tallyOf({ unchanged: 90, cleanFastForward: 10 }));

    const { syncMergeOutcomes } = getOperationalTelemetrySnapshot();

    expect(syncMergeOutcomes.records).toBe(100);
    expect(syncMergeOutcomes.redundantRecordRate).toBe(0.9);
  });

  it('aggregates across syncs', () => {
    recordSyncMergeOutcomeMetric(tallyOf({ fieldMergeApplied: 1, baselineUnavailable: 1 }));
    recordSyncMergeOutcomeMetric(tallyOf({ fieldMergeApplied: 3, baselineUnavailable: 5 }));

    const { syncMergeOutcomes } = getOperationalTelemetrySnapshot();

    expect(syncMergeOutcomes.samples).toBe(2);
    expect(syncMergeOutcomes.fieldMergeApplied).toBe(4);
    expect(syncMergeOutcomes.baselineUnavailable).toBe(6);
  });

  it('ignores a sync that merged nothing', () => {
    // New-records-only and empty payloads carry no signal for either question
    // and would dilute the bounded sample window.
    recordSyncMergeOutcomeMetric(tallyOf({ newRecord: 12 }));
    recordSyncMergeOutcomeMetric(createMergeOutcomeTally());

    expect(getOperationalTelemetrySnapshot().syncMergeOutcomes.samples).toBe(0);
  });

  it('reports zero rates rather than dividing by zero on an idle deployment', () => {
    const { syncMergeOutcomes } = getOperationalTelemetrySnapshot();

    expect(syncMergeOutcomes.samples).toBe(0);
    expect(syncMergeOutcomes.fieldMergeSuccessRate).toBe(0);
    expect(syncMergeOutcomes.baselineUnavailableRate).toBe(0);
    expect(syncMergeOutcomes.redundantRecordRate).toBe(0);
  });

  it('carries counts only — never ids, collections, or tenant data', () => {
    recordSyncMergeOutcomeMetric(tallyOf({ unchanged: 3, sameFieldConflict: 1 }));

    const { syncMergeOutcomes } = getOperationalTelemetrySnapshot();
    for (const [key, value] of Object.entries(syncMergeOutcomes)) {
      expect(typeof value, `${key} should be numeric`).toBe('number');
    }
  });
});
