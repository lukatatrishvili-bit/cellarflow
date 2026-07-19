import type { BottlingRunRecord, InventoryItem } from './wineryState';

const EMBEDDED_TIMESTAMP = /(?:^|[-_])(\d{11,})(?:$|[-_])/;

const parsedTime = (value: string | undefined): number => {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

export function bottlingRunIdTimestamp(run: Pick<BottlingRunRecord, 'id'>): number {
  const match = run.id.match(EMBEDDED_TIMESTAMP);
  if (!match) return 0;
  const timestamp = Number(match[1]);
  return Number.isSafeInteger(timestamp) ? timestamp : 0;
}

/**
 * Canonical bottling chronology used by both display and rollback validation.
 * New records carry `createdAt`; legacy records fall back to a timestamp in the
 * id, then the business date. Returning zero lets a stable sort preserve the
 * original array order as the final deterministic tie-break.
 */
export function bottlingRunChronology(
  run: Pick<BottlingRunRecord, 'id' | 'date' | 'createdAt'>,
): { primary: number; idTimestamp: number } {
  const idTimestamp = bottlingRunIdTimestamp(run);
  return {
    primary: parsedTime(run.createdAt) || idTimestamp || parsedTime(run.date),
    idTimestamp,
  };
}

/** Sort callback: newest bottling run first. The native stable sort is relied on for exact ties. */
export function compareBottlingRunsNewestFirst(
  left: Pick<BottlingRunRecord, 'id' | 'date' | 'createdAt'>,
  right: Pick<BottlingRunRecord, 'id' | 'date' | 'createdAt'>,
): number {
  const a = bottlingRunChronology(left);
  const b = bottlingRunChronology(right);
  return (b.primary - a.primary) || (b.idTimestamp - a.idTimestamp);
}

/**
 * A rollback may only reverse the newest surviving run for a lot; otherwise
 * its saved pre-run volume would overwrite the effects of later runs. Never
 * assume the synced array is already sorted: server merges can append records.
 */
export function newerBottlingRunFor(
  history: BottlingRunRecord[],
  runId: string,
): BottlingRunRecord | null {
  const targetIndex = history.findIndex(run => run.id === runId);
  if (targetIndex < 0) return null;
  const target = history[targetIndex];
  const ordered = history
    .map((run, index) => ({ run, index }))
    .filter(entry => entry.run.lotId === target.lotId)
    .sort((left, right) => (
      compareBottlingRunsNewestFirst(left.run, right.run) || left.index - right.index
    ));
  const orderedTargetIndex = ordered.findIndex(entry => entry.run.id === runId);
  return orderedTargetIndex > 0 ? ordered[0].run : null;
}

export interface PackagingShortfall {
  item: InventoryItem;
  required: number;
  available: number;
}

/** Material shortages must block a reversible bottling posting, not be clamped to zero. */
export function bottlingPackagingShortfalls(
  deductions: Record<string, number>,
  inventory: InventoryItem[],
): PackagingShortfall[] {
  const inventoryById = new Map(inventory.map(item => [item.id, item]));
  return Object.entries(deductions).flatMap(([itemId, required]) => {
    const item = inventoryById.get(itemId);
    if (!item || required <= item.stock) return [];
    return [{ item, required, available: item.stock }];
  });
}
