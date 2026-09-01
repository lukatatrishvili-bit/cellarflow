import type { ProductionPlanItem, ProductionPlanKind } from './operationsControl';
import type { CellarOperationType } from './wineryState';
import { createUniqueRecordId } from './recordIds';

/**
 * Work orders: a named, assigned batch of planned work.
 *
 * The planner already knew how to describe one piece of work and, since the
 * fulfilment loop, how to close it when the recording lands. What it could not
 * do is hand a person a morning. Plan items carry their own `assignedTo`, so a
 * winemaker scheduling six barrels for topping had to assign six separate
 * things, and the cellar hand had six unrelated rows rather than one job.
 *
 * A work order is deliberately thin: a title, an assignee, a due date, and the
 * ids of the items it covers. It stores no status of its own — that is derived
 * from the items, the same way a plan item's completion is derived from the
 * recording. A stored status is a second copy of the truth, and second copies
 * drift; see [workOrderProgress].
 */

export interface WorkOrder {
  id: string;
  title: string;
  assignedTo: string;
  /** ISO date the whole order is due. Items keep their own start/end dates. */
  dueDate: string;
  /** Plan item ids, in the order they should be worked. */
  itemIds: string[];
  notes: string;
  createdAt: string;
  createdBy: string;
  /** Set when the order was raised from a template. */
  templateId?: string;
  lastModified?: string;
}

/**
 * Derived, never stored. `blocked` is not a stage of its own: an order with
 * blocked items is still in whatever stage its progress puts it, and the count
 * is reported alongside so the UI can say so without inventing a status.
 */
export type WorkOrderStatus = 'not_started' | 'in_progress' | 'completed';

export interface WorkOrderProgress {
  status: WorkOrderStatus;
  /** Items settled — completed or cancelled. Cancelled work is not outstanding. */
  done: number;
  total: number;
  blocked: number;
  /** Items the order names that no longer exist, so the UI can say so. */
  missing: number;
}

const SETTLED = new Set(['completed', 'cancelled']);
const STARTED = new Set(['in_progress', 'completed', 'cancelled']);

export function workOrderProgress(order: WorkOrder, items: ProductionPlanItem[]): WorkOrderProgress {
  const byId = new Map(items.map(item => [item.id, item]));
  const present = order.itemIds.map(id => byId.get(id)).filter((item): item is ProductionPlanItem => Boolean(item));
  const total = present.length;
  const done = present.filter(item => SETTLED.has(item.status)).length;
  const blocked = present.filter(item => item.status === 'blocked').length;
  const started = present.some(item => STARTED.has(item.status));

  return {
    status: total > 0 && done === total ? 'completed' : started ? 'in_progress' : 'not_started',
    done,
    total,
    blocked,
    missing: order.itemIds.length - total,
  };
}

/** The order, if any, that covers this plan item. */
export function workOrderForPlanItem(orders: WorkOrder[], planItemId: string): WorkOrder | undefined {
  return orders.find(order => order.itemIds.includes(planItemId));
}

/**
 * The next unsettled item, which is what "carry on" means on the floor. Order
 * matters here: `itemIds` is the sequence the winemaker arranged, not a set.
 */
export function nextWorkOrderItem(order: WorkOrder, items: ProductionPlanItem[]): ProductionPlanItem | undefined {
  const byId = new Map(items.map(item => [item.id, item]));
  for (const id of order.itemIds) {
    const item = byId.get(id);
    if (item && !SETTLED.has(item.status)) return item;
  }
  return undefined;
}

// --- Templates ------------------------------------------------------------

/**
 * A template describes the *shape* of recurring work, never the vessels it
 * applies to. Topping is topping whether it is six barrels this week or four
 * the next, and a template that hardcoded barrel ids would need re-saving every
 * time the cellar changed. Targets are chosen when the order is raised.
 */
export interface WorkOrderTemplateItem {
  title: string;
  kind: ProductionPlanKind;
  operationType?: CellarOperationType;
  /** Days from the order's due date. 0 is the due date itself; negatives are earlier. */
  dayOffset: number;
  notes: string;
}

export interface WorkOrderRecurrence {
  every: number;
  unit: 'day' | 'week';
  /** Last date an occurrence may fall on. Open-ended when absent. */
  until?: string;
}

export interface WorkOrderTemplate {
  id: string;
  title: string;
  items: WorkOrderTemplateItem[];
  recurrence?: WorkOrderRecurrence;
  createdAt: string;
  createdBy: string;
  lastModified?: string;
}

/** A vessel the template's work should be carried out on, and what is in it. */
export interface WorkOrderTarget {
  vesselId: string;
  lotId?: string;
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) return date;
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export interface ExpandedWorkOrder {
  order: WorkOrder;
  items: ProductionPlanItem[];
}

/**
 * Raise an order from a template, expanding each template item across every
 * target. Six barrels of topping become six plan items under one assignment —
 * which is the whole reason the container exists.
 *
 * Ids are generated against the caller's existing ids so an offline double-tap
 * cannot collide, following the same rule as every other record here.
 */
export function expandWorkOrderTemplate(input: {
  template: WorkOrderTemplate;
  dueDate: string;
  assignedTo: string;
  targets: WorkOrderTarget[];
  createdBy: string;
  now: string;
  existingPlanIds: Iterable<string>;
  existingOrderIds: Iterable<string>;
  /** Overrides the template's title for this one order. */
  title?: string;
  notes?: string;
}): ExpandedWorkOrder {
  const { template, dueDate, assignedTo, targets, createdBy, now } = input;
  const planIds = new Set(input.existingPlanIds);
  const items: ProductionPlanItem[] = [];

  // Template item is the outer loop so the cellar hand walks one job across
  // every vessel before starting the next, rather than switching task type at
  // each barrel.
  for (const templateItem of template.items) {
    for (const target of targets) {
      const id = createUniqueRecordId('plan', planIds);
      planIds.add(id);
      const date = addDays(dueDate, templateItem.dayOffset);
      items.push({
        id,
        title: `${templateItem.title} — ${target.vesselId}`,
        kind: templateItem.kind,
        ...(templateItem.operationType ? { operationType: templateItem.operationType } : {}),
        status: 'planned',
        startDate: date,
        endDate: date,
        assignedTo,
        ...(target.lotId ? { lotId: target.lotId } : {}),
        vesselIds: [target.vesselId],
        notes: templateItem.notes,
        dependencyIds: [],
        createdAt: now,
        createdBy,
      });
    }
  }

  const orderId = createUniqueRecordId('wo', input.existingOrderIds);
  return {
    order: {
      id: orderId,
      title: input.title?.trim() || template.title,
      assignedTo,
      dueDate,
      itemIds: items.map(item => item.id),
      notes: input.notes || '',
      createdAt: now,
      createdBy,
      templateId: template.id,
      lastModified: now,
    },
    items,
  };
}

/**
 * The occurrence dates a recurring template should produce between `from` and
 * `from + horizonDays`, inclusive. Returns dates only — deciding whether an
 * order already exists for one, and on which vessels, belongs to the caller
 * that can see the orders.
 */
export function recurrenceOccurrences(
  recurrence: WorkOrderRecurrence,
  from: string,
  horizonDays: number,
): string[] {
  const step = recurrence.unit === 'week' ? recurrence.every * 7 : recurrence.every;
  if (!Number.isFinite(step) || step < 1 || horizonDays < 0) return [];

  const horizon = addDays(from, horizonDays);
  const dates: string[] = [];
  // A pathological interval must not spin: the horizon bounds the count, and
  // the loop is capped at one occurrence per day within it.
  for (let date = from, guard = 0; date <= horizon && guard <= horizonDays + 1; date = addDays(date, step), guard += step) {
    if (recurrence.until && date > recurrence.until) break;
    dates.push(date);
  }
  return dates;
}

/** Whether an order already covers this template on this date. */
export function hasOrderForOccurrence(orders: WorkOrder[], templateId: string, date: string): boolean {
  return orders.some(order => order.templateId === templateId && order.dueDate === date);
}

/**
 * Occurrences a recurring template owes that no order covers yet. This is the
 * prompt a winemaker sees — never an automatic write, matching how the planner
 * already treats its suggestions.
 */
export function outstandingOccurrences(input: {
  template: WorkOrderTemplate;
  orders: WorkOrder[];
  from: string;
  horizonDays: number;
}): string[] {
  const { template, orders, from, horizonDays } = input;
  if (!template.recurrence) return [];
  return recurrenceOccurrences(template.recurrence, from, horizonDays)
    .filter(date => !hasOrderForOccurrence(orders, template.id, date));
}
