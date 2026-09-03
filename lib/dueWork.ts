import type { ProductionPlanItem, ProductionPlanKind } from './operationsControl';
import { isQuickCellarOperation } from './wineryOperations';

/**
 * What a scanned vessel is owed right now.
 *
 * Kept apart from `lib/workOrders.ts` on purpose: the app shell imports this
 * eagerly to handle a scan, and pulling in template expansion and recurrence
 * generation for that would put the whole planning module on the critical path.
 */

const SETTLED = new Set(['completed', 'cancelled']);

/**
 * Kinds whose planned work opens a recorder that can settle it. Mirrors the
 * routing in `openProductionPlanItem`; `tests/workOrders.test.ts` pins the two
 * together so this cannot quietly fall behind.
 */
const RECORDABLE_KINDS = new Set<ProductionPlanKind>(['transfer', 'lab', 'sanitation', 'intake']);

/**
 * Whether opening this item lands somewhere the work can actually be recorded,
 * rather than in a task draft or another module.
 */
export function isRecordableWork(item: ProductionPlanItem): boolean {
  if (item.operationType && isQuickCellarOperation(item.operationType)) return true;
  return RECORDABLE_KINDS.has(item.kind);
}

/** Statuses in the order a cellar hand should be shown them. */
const URGENCY_RANK: Record<string, number> = {
  in_progress: 0,
  ready: 1,
  blocked: 2,
  planned: 3,
};

/**
 * The work a scanned vessel is actually owed today.
 *
 * Scanning a tank used to open a blank operation recorder with the vessel
 * filled in, which is a fine default and a poor answer when there is a specific
 * job outstanding on it. Returning the plan item lets the caller open the
 * recorder the *planned* way — with the operation type and lot already set, and
 * the fulfilment loop armed so saving settles it.
 *
 * Future work is deliberately excluded. A barrel scheduled for topping next
 * Tuesday should not hijack today's scan.
 */
export function dueWorkForVessel(input: {
  vesselId: string;
  items: ProductionPlanItem[];
  today: string;
}): ProductionPlanItem | undefined {
  const { vesselId, items, today } = input;
  const candidates = items.filter(item => (
    item.vesselIds.includes(vesselId)
    && !SETTLED.has(item.status)
    && item.startDate <= today
  ));

  return candidates.sort((a, b) => {
    // Recordable work leads. A scan asks "what am I doing at this tank right
    // now", and an item that only opens a task draft answers that with a form
    // — the standing-at-the-barrel case is the one this ordering serves.
    const recordable = Number(isRecordableWork(b)) - Number(isRecordableWork(a));
    if (recordable !== 0) return recordable;
    // Then overdue, then whatever is furthest along, then a stable tie break so
    // the same scan does not shuffle between renders.
    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
    const rank = (URGENCY_RANK[a.status] ?? 9) - (URGENCY_RANK[b.status] ?? 9);
    if (rank !== 0) return rank;
    return a.id.localeCompare(b.id);
  })[0];
}
