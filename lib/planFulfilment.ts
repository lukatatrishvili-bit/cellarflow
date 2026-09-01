import type { ProductionPlanItem, ProductionPlanStatus } from './operationsControl';
import type { Task } from './wineryState';

/**
 * Closing the loop between planned work and recorded work.
 *
 * The planner could already send an operator to the right recorder with the
 * lot, vessel and operation type filled in — but the plan item's id was
 * dropped on the way, so nothing came back. One piece of cellar work cost
 * three manual status flips (plan item, task, and the recording itself), and
 * the recording was the only one of the three that was optional.
 *
 * So the planner now remembers what it sent someone off to do, and the save
 * paths ask this module whether the record they just wrote settles it. The
 * recorded fact is what completes the work; the statuses follow it rather than
 * being maintained alongside it.
 */

/**
 * Which recorder can settle a plan item. Deliberately coarser than
 * `ProductionPlanKind`: several kinds route to the same recorder, and kinds
 * that only navigate somewhere (harvest, procurement, dispatch) can settle
 * nothing, so they have no member here.
 */
export type PlanFulfilmentKind = 'operation' | 'transfer' | 'lab' | 'intake' | 'sanitation';

/** The task, if any, that was raised from this plan item. */
export function linkedTaskForProductionPlan(tasks: Task[], planId: string): Task | undefined {
  return tasks.find(task => task.source?.type === 'production_plan' && task.source.id === planId);
}

export interface PendingPlanFulfilment {
  planItemId: string;
  kind: PlanFulfilmentKind;
  /** When the operator was sent to the recorder, for staleness checks. */
  openedAt: string;
}

const SETTLED_STATUSES: ProductionPlanStatus[] = ['completed', 'cancelled'];

export interface PlanFulfilmentResult {
  items: ProductionPlanItem[];
  tasks: Task[];
  /** The item this record settled, or null when it settled nothing. */
  closed: ProductionPlanItem | null;
}

/**
 * Settle a pending fulfilment against a record that was just written.
 *
 * Conservative on purpose: a record only settles the item the operator was
 * actually sent to do, and only through the recorder that item was routed to.
 * Anything else — a different recorder, a stale id, an item someone already
 * completed or cancelled in the meantime — leaves both collections untouched
 * and reports `closed: null`, so the caller can leave the pending fulfilment
 * in place rather than silently discarding the operator's intent.
 */
export function fulfilProductionPlanItem(input: {
  fulfilment: PendingPlanFulfilment | null;
  kind: PlanFulfilmentKind;
  items: ProductionPlanItem[];
  tasks: Task[];
  completedAt: string;
}): PlanFulfilmentResult {
  const { fulfilment, kind, items, tasks, completedAt } = input;
  const unchanged: PlanFulfilmentResult = { items, tasks, closed: null };

  if (!fulfilment || fulfilment.kind !== kind) return unchanged;

  const target = items.find(item => item.id === fulfilment.planItemId);
  if (!target || SETTLED_STATUSES.includes(target.status)) return unchanged;

  const closed: ProductionPlanItem = {
    ...target,
    status: 'completed',
    lastModified: completedAt,
  };

  const linkedTask = linkedTaskForProductionPlan(tasks, closed.id);
  const shouldCloseTask = Boolean(linkedTask && linkedTask.status !== 'completed');

  return {
    items: items.map(item => (item.id === closed.id ? closed : item)),
    tasks: shouldCloseTask
      ? tasks.map(task => (task.id === linkedTask!.id ? { ...task, status: 'completed' as const } : task))
      : tasks,
    closed,
  };
}

/**
 * The confirmation an operator sees when a recording settled planned work.
 * Worth saying out loud: the whole point is that they did not have to go back
 * to the planner, so the app has to tell them it happened.
 */
export function planFulfilmentMessage(item: ProductionPlanItem, lang: 'en' | 'ka'): string {
  return lang === 'ka'
    ? `დაფიქსირდა — გეგმის პუნქტი „${item.title}" დასრულებულია.`
    : `Recorded — plan item “${item.title}” is now complete.`;
}
