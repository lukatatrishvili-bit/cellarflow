import { isPhysicalFermentationReading } from '../fermentationIntegrity';
import type {
  CertificationRecord,
  DailyFermLog,
  GrapeIntakeRecord,
  GrapeSamplingRecord,
  HarvestRecord,
  LabAnalysis,
  ScoutingRecord,
  SprayRecord,
} from '../wineryState';
import { isLiveRecord, type WineryIntelligenceSnapshot } from './snapshot';

/**
 * Per-evaluation lookup tables.
 *
 * Detectors are written per lot and per block, so the obvious implementation
 * filters the whole collection inside each loop. That is O(lots × analyses),
 * and it runs in a client `useMemo` on every state change: a 300-lot cellar
 * measured 48 ms per evaluation, three times the frame budget, on every edit.
 *
 * Grouping each collection once turns that into O(lots + analyses). The cache is
 * a WeakMap keyed on the snapshot, and `evaluateRules` builds a fresh snapshot
 * per call, so an index lives exactly as long as the evaluation that needs it
 * and cannot serve stale data to the next one.
 *
 * Returned arrays are shared between detectors and must be treated as readonly.
 */

export interface SnapshotIndexes {
  /** Newest first. */
  labsByLot: ReadonlyMap<string, readonly LabAnalysis[]>;
  /** Physical readings only; reversal rows are compensating facts, not measurements. */
  fermReadingsByLot: ReadonlyMap<string, readonly DailyFermLog[]>;
  certificationByLot: ReadonlyMap<string, CertificationRecord>;
  /** Live intakes only, keyed by the lot they created. */
  intakeByCreatedLot: ReadonlyMap<string, GrapeIntakeRecord>;
  /** Dated block groups are newest first, so `[0]` is the most recent record. */
  spraysByBlock: ReadonlyMap<string, readonly SprayRecord[]>;
  scoutingsByBlock: ReadonlyMap<string, readonly ScoutingRecord[]>;
  samplingsByBlock: ReadonlyMap<string, readonly GrapeSamplingRecord[]>;
  /** Input order: a harvest has no single `date`, only estimated and actual. */
  harvestsByBlock: ReadonlyMap<string, readonly HarvestRecord[]>;
}

const EMPTY: readonly never[] = Object.freeze([]);
const cache = new WeakMap<WineryIntelligenceSnapshot, SnapshotIndexes>();

function groupBy<T>(rows: readonly T[], key: (row: T) => string | undefined): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    if (!id) continue;
    const bucket = grouped.get(id);
    if (bucket) bucket.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

function sortEachByDateDesc<T extends { date: string }>(grouped: Map<string, T[]>): Map<string, T[]> {
  for (const bucket of grouped.values()) {
    bucket.sort((left, right) => (right.date || '').localeCompare(left.date || ''));
  }
  return grouped;
}

/** Builds (once) and returns the lookup tables for this snapshot. */
export function snapshotIndexes(snapshot: WineryIntelligenceSnapshot): SnapshotIndexes {
  const existing = cache.get(snapshot);
  if (existing) return existing;

  const certificationByLot = new Map<string, CertificationRecord>();
  for (const record of snapshot.certifications) {
    // First match wins, matching the previous `.find` semantics exactly.
    if (record.lotId && !certificationByLot.has(record.lotId)) {
      certificationByLot.set(record.lotId, record);
    }
  }

  const intakeByCreatedLot = new Map<string, GrapeIntakeRecord>();
  for (const record of snapshot.grapeIntakes) {
    if (record.createdLotId && isLiveRecord(record) && !intakeByCreatedLot.has(record.createdLotId)) {
      intakeByCreatedLot.set(record.createdLotId, record);
    }
  }

  const indexes: SnapshotIndexes = {
    labsByLot: sortEachByDateDesc(groupBy(snapshot.labLogs, (lab) => lab.lotId)),
    fermReadingsByLot: groupBy(
      snapshot.fermLogs.filter(isPhysicalFermentationReading),
      (log) => log.lotId,
    ),
    certificationByLot,
    intakeByCreatedLot,
    // `calculateVaziRisk` filters these itself and is order-independent, so
    // sorting here is free and lets callers take the latest with `[0]`.
    spraysByBlock: sortEachByDateDesc(groupBy(snapshot.sprays, (row) => row.blockId)),
    scoutingsByBlock: sortEachByDateDesc(groupBy(snapshot.scoutings, (row) => row.blockId)),
    samplingsByBlock: sortEachByDateDesc(groupBy(snapshot.samplings, (row) => row.blockId)),
    harvestsByBlock: groupBy(snapshot.harvests, (row) => row.blockId),
  };
  cache.set(snapshot, indexes);
  return indexes;
}

export function labsForLot(
  snapshot: WineryIntelligenceSnapshot,
  lotId: string,
): readonly LabAnalysis[] {
  return snapshotIndexes(snapshot).labsByLot.get(lotId) ?? EMPTY;
}

export function fermReadingsForLot(
  snapshot: WineryIntelligenceSnapshot,
  lotId: string,
): readonly DailyFermLog[] {
  return snapshotIndexes(snapshot).fermReadingsByLot.get(lotId) ?? EMPTY;
}

export function blockRecords(snapshot: WineryIntelligenceSnapshot, blockId: string) {
  const indexes = snapshotIndexes(snapshot);
  return {
    sprays: indexes.spraysByBlock.get(blockId) ?? EMPTY,
    scoutings: indexes.scoutingsByBlock.get(blockId) ?? EMPTY,
    samplings: indexes.samplingsByBlock.get(blockId) ?? EMPTY,
    harvests: indexes.harvestsByBlock.get(blockId) ?? EMPTY,
  };
}
