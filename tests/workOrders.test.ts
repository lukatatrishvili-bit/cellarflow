import { describe, expect, it } from 'vitest';
import {
  addDays,
  expandWorkOrderTemplate,
  hasOrderForOccurrence,
  nextWorkOrderItem,
  outstandingOccurrences,
  recurrenceOccurrences,
  workOrderForPlanItem,
  workOrderProgress,
  type WorkOrder,
  type WorkOrderTemplate,
} from '../lib/workOrders';
import { dueWorkForVessel, isRecordableWork } from '../lib/dueWork';
import type { ProductionPlanItem, ProductionPlanStatus } from '../lib/operationsControl';

const NOW = '2026-09-01T07:00:00.000Z';

const item = (id: string, status: ProductionPlanStatus = 'planned'): ProductionPlanItem => ({
  id,
  title: `Work ${id}`,
  kind: 'other',
  status,
  startDate: '2026-09-01',
  endDate: '2026-09-01',
  assignedTo: 'ana',
  vesselIds: [],
  notes: '',
  dependencyIds: [],
  createdAt: NOW,
  createdBy: 'ana',
});

const order = (patch: Partial<WorkOrder> = {}): WorkOrder => ({
  id: 'wo-1',
  title: 'Tuesday topping',
  assignedTo: 'ana',
  dueDate: '2026-09-01',
  itemIds: ['p1', 'p2', 'p3'],
  notes: '',
  createdAt: NOW,
  createdBy: 'ana',
  ...patch,
});

const template = (patch: Partial<WorkOrderTemplate> = {}): WorkOrderTemplate => ({
  id: 'tpl-topping',
  title: 'Weekly topping',
  items: [
    { title: 'Top up', kind: 'other', operationType: 'vessel_filling', dayOffset: 0, notes: 'To the bung.' },
  ],
  createdAt: NOW,
  createdBy: 'ana',
  ...patch,
});

describe('workOrderProgress', () => {
  it('is not started until something moves', () => {
    const progress = workOrderProgress(order(), [item('p1'), item('p2'), item('p3')]);

    expect(progress).toMatchObject({ status: 'not_started', done: 0, total: 3, blocked: 0, missing: 0 });
  });

  it('is in progress once any item has been started or settled', () => {
    expect(workOrderProgress(order(), [item('p1', 'in_progress'), item('p2'), item('p3')]).status)
      .toBe('in_progress');
    expect(workOrderProgress(order(), [item('p1', 'completed'), item('p2'), item('p3')]).status)
      .toBe('in_progress');
  });

  it('is complete only when every item is settled', () => {
    const progress = workOrderProgress(order(), [
      item('p1', 'completed'),
      item('p2', 'cancelled'),
      item('p3', 'completed'),
    ]);

    // Cancelled work is settled: it is not outstanding, so it cannot hold an
    // order open for ever.
    expect(progress).toMatchObject({ status: 'completed', done: 3, total: 3 });
  });

  it('reports blocked items without inventing a status for them', () => {
    const progress = workOrderProgress(order(), [item('p1', 'blocked'), item('p2'), item('p3')]);

    expect(progress.status).toBe('not_started');
    expect(progress.blocked).toBe(1);
  });

  it('counts items the order names but that no longer exist', () => {
    const progress = workOrderProgress(order(), [item('p1', 'completed')]);

    expect(progress).toMatchObject({ done: 1, total: 1, missing: 2 });
  });

  it('does not call an empty order complete', () => {
    expect(workOrderProgress(order({ itemIds: [] }), []).status).toBe('not_started');
  });
});

describe('nextWorkOrderItem', () => {
  it('follows the sequence the winemaker arranged, not the array of items', () => {
    const items = [item('p3'), item('p2'), item('p1', 'completed')];

    expect(nextWorkOrderItem(order(), items)?.id).toBe('p2');
  });

  it('returns nothing when everything is settled', () => {
    const items = [item('p1', 'completed'), item('p2', 'cancelled'), item('p3', 'completed')];

    expect(nextWorkOrderItem(order(), items)).toBeUndefined();
  });
});

describe('workOrderForPlanItem', () => {
  it('finds the order covering an item', () => {
    const orders = [order({ id: 'wo-1', itemIds: ['p1'] }), order({ id: 'wo-2', itemIds: ['p2'] })];

    expect(workOrderForPlanItem(orders, 'p2')?.id).toBe('wo-2');
    expect(workOrderForPlanItem(orders, 'p9')).toBeUndefined();
  });
});

describe('expandWorkOrderTemplate', () => {
  const expand = (overrides: Partial<Parameters<typeof expandWorkOrderTemplate>[0]> = {}) =>
    expandWorkOrderTemplate({
      template: template(),
      dueDate: '2026-09-08',
      assignedTo: 'gio',
      targets: [
        { vesselId: 'B-01', lotId: 'LOT-1' },
        { vesselId: 'B-02', lotId: 'LOT-1' },
        { vesselId: 'B-03' },
      ],
      createdBy: 'ana',
      now: NOW,
      existingPlanIds: [],
      existingOrderIds: [],
      ...overrides,
    });

  it('expands one template item across every target', () => {
    const { order: raised, items } = expand();

    expect(items).toHaveLength(3);
    expect(items.map(entry => entry.vesselIds)).toEqual([['B-01'], ['B-02'], ['B-03']]);
    expect(raised.itemIds).toEqual(items.map(entry => entry.id));
    expect(raised.templateId).toBe('tpl-topping');
    expect(raised.assignedTo).toBe('gio');
  });

  it('assigns the order once instead of every item separately', () => {
    const { order: raised, items } = expand();

    expect(raised.assignedTo).toBe('gio');
    expect(new Set(items.map(entry => entry.assignedTo))).toEqual(new Set(['gio']));
  });

  it('walks one job across all vessels before starting the next', () => {
    const { items } = expand({
      template: template({
        items: [
          { title: 'Top up', kind: 'other', operationType: 'vessel_filling', dayOffset: 0, notes: '' },
          { title: 'Taste', kind: 'other', dayOffset: 0, notes: '' },
        ],
      }),
    });

    expect(items.map(entry => entry.title)).toEqual([
      'Top up — B-01', 'Top up — B-02', 'Top up — B-03',
      'Taste — B-01', 'Taste — B-02', 'Taste — B-03',
    ]);
  });

  it('places items relative to the due date', () => {
    const { items } = expand({
      template: template({
        items: [
          { title: 'Prep', kind: 'sanitation', dayOffset: -1, notes: '' },
          { title: 'Top up', kind: 'other', dayOffset: 0, notes: '' },
        ],
      }),
      targets: [{ vesselId: 'B-01' }],
    });

    expect(items.map(entry => entry.startDate)).toEqual(['2026-09-07', '2026-09-08']);
    expect(items.every(entry => entry.startDate === entry.endDate)).toBe(true);
  });

  it('carries the executable operation type so the loop can settle each item', () => {
    const { items } = expand({ targets: [{ vesselId: 'B-01', lotId: 'LOT-1' }] });

    expect(items[0].operationType).toBe('vessel_filling');
    expect(items[0].lotId).toBe('LOT-1');
  });

  it('omits lotId for an empty vessel rather than writing an empty string', () => {
    const { items } = expand({ targets: [{ vesselId: 'B-03' }] });

    expect('lotId' in items[0]).toBe(false);
  });

  it('never reuses an id the caller already holds', () => {
    const { order: raised, items } = expand({
      existingPlanIds: ['plan-1', 'plan-2'],
      existingOrderIds: ['wo-1'],
    });

    expect(items.map(entry => entry.id)).not.toContain('plan-1');
    expect(raised.id).not.toBe('wo-1');
    expect(new Set(items.map(entry => entry.id)).size).toBe(items.length);
  });

  it('lets a single order override the template title', () => {
    expect(expand({ title: '  Barrel room only  ' }).order.title).toBe('Barrel room only');
    expect(expand({ title: '   ' }).order.title).toBe('Weekly topping');
  });

  it('produces nothing to work when no targets are chosen', () => {
    const { order: raised, items } = expand({ targets: [] });

    expect(items).toEqual([]);
    expect(raised.itemIds).toEqual([]);
  });
});

describe('recurrenceOccurrences', () => {
  it('steps weekly from the start date', () => {
    expect(recurrenceOccurrences({ every: 1, unit: 'week' }, '2026-09-01', 21)).toEqual([
      '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22',
    ]);
  });

  it('steps by days', () => {
    expect(recurrenceOccurrences({ every: 3, unit: 'day' }, '2026-09-01', 7)).toEqual([
      '2026-09-01', '2026-09-04', '2026-09-07',
    ]);
  });

  it('stops at the recurrence end date', () => {
    expect(recurrenceOccurrences({ every: 1, unit: 'week', until: '2026-09-10' }, '2026-09-01', 30)).toEqual([
      '2026-09-01', '2026-09-08',
    ]);
  });

  it('refuses an interval that would not advance', () => {
    expect(recurrenceOccurrences({ every: 0, unit: 'day' }, '2026-09-01', 30)).toEqual([]);
    expect(recurrenceOccurrences({ every: -2, unit: 'week' }, '2026-09-01', 30)).toEqual([]);
  });

  it('returns nothing for a negative horizon', () => {
    expect(recurrenceOccurrences({ every: 1, unit: 'day' }, '2026-09-01', -1)).toEqual([]);
  });
});

describe('outstandingOccurrences', () => {
  it('lists only the dates no order covers yet', () => {
    const orders = [order({ id: 'wo-1', templateId: 'tpl-topping', dueDate: '2026-09-08' })];

    expect(outstandingOccurrences({
      template: template({ recurrence: { every: 1, unit: 'week' } }),
      orders,
      from: '2026-09-01',
      horizonDays: 21,
    })).toEqual(['2026-09-01', '2026-09-15', '2026-09-22']);
  });

  it('ignores orders raised from a different template', () => {
    const orders = [order({ templateId: 'tpl-other', dueDate: '2026-09-01' })];

    expect(outstandingOccurrences({
      template: template({ recurrence: { every: 1, unit: 'week' } }),
      orders,
      from: '2026-09-01',
      horizonDays: 7,
    })).toEqual(['2026-09-01', '2026-09-08']);
  });

  it('owes nothing for a template that does not recur', () => {
    expect(outstandingOccurrences({
      template: template(),
      orders: [],
      from: '2026-09-01',
      horizonDays: 30,
    })).toEqual([]);
  });
});

describe('hasOrderForOccurrence', () => {
  it('matches on template and date together', () => {
    const orders = [order({ templateId: 'tpl-topping', dueDate: '2026-09-08' })];

    expect(hasOrderForOccurrence(orders, 'tpl-topping', '2026-09-08')).toBe(true);
    expect(hasOrderForOccurrence(orders, 'tpl-topping', '2026-09-15')).toBe(false);
    expect(hasOrderForOccurrence(orders, 'tpl-other', '2026-09-08')).toBe(false);
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('returns an unparseable date unchanged rather than NaN', () => {
    expect(addDays('not-a-date', 3)).toBe('not-a-date');
  });
});

describe('dueWorkForVessel', () => {
  const on = (id: string, patch: Partial<ProductionPlanItem>): ProductionPlanItem => ({
    ...item(id),
    vesselIds: ['T-101'],
    startDate: '2026-09-01',
    endDate: '2026-09-01',
    ...patch,
  });

  it('finds open work due on the scanned vessel', () => {
    const found = dueWorkForVessel({
      vesselId: 'T-101',
      items: [on('p1', { status: 'ready' })],
      today: '2026-09-01',
    });

    expect(found?.id).toBe('p1');
  });

  it('ignores work on a different vessel', () => {
    expect(dueWorkForVessel({
      vesselId: 'T-999',
      items: [on('p1', { status: 'ready' })],
      today: '2026-09-01',
    })).toBeUndefined();
  });

  it('does not let next week hijack today', () => {
    expect(dueWorkForVessel({
      vesselId: 'T-101',
      items: [on('p1', { status: 'ready', startDate: '2026-09-08', endDate: '2026-09-08' })],
      today: '2026-09-01',
    })).toBeUndefined();
  });

  it('ignores work that is already settled', () => {
    expect(dueWorkForVessel({
      vesselId: 'T-101',
      items: [on('p1', { status: 'completed' }), on('p2', { status: 'cancelled' })],
      today: '2026-09-01',
    })).toBeUndefined();
  });

  it('leads with the most overdue item', () => {
    const found = dueWorkForVessel({
      vesselId: 'T-101',
      items: [
        on('p1', { status: 'ready' }),
        on('p2', { status: 'planned', startDate: '2026-08-25', endDate: '2026-08-25' }),
      ],
      today: '2026-09-01',
    });

    expect(found?.id).toBe('p2');
  });

  it('prefers work already under way when dates tie', () => {
    const found = dueWorkForVessel({
      vesselId: 'T-101',
      items: [on('p1', { status: 'planned' }), on('p2', { status: 'in_progress' })],
      today: '2026-09-01',
    });

    expect(found?.id).toBe('p2');
  });

  it('is stable when status and date both tie', () => {
    const items = [on('p9', { status: 'ready' }), on('p1', { status: 'ready' })];

    expect(dueWorkForVessel({ vesselId: 'T-101', items, today: '2026-09-01' })?.id).toBe('p1');
    expect(dueWorkForVessel({ vesselId: 'T-101', items: [...items].reverse(), today: '2026-09-01' })?.id).toBe('p1');
  });
});

describe('template operations stay routable', () => {
  it('offers only operations the planner can open in a recorder', async () => {
    const { QUICK_CELLAR_OPERATIONS, isQuickCellarOperation } = await import('../lib/wineryOperations');

    // The work-order template picker is built from this list, and the planner
    // only routes an item to the operation recorder when its type is a quick
    // one. A dedicated type in a template would produce work that opens
    // nowhere and can never be settled by the fulfilment loop.
    expect(QUICK_CELLAR_OPERATIONS.length).toBeGreaterThan(0);
    for (const operation of QUICK_CELLAR_OPERATIONS) {
      expect(isQuickCellarOperation(operation.key)).toBe(true);
    }
  });

  it('expands a template into items carrying a routable operation type', async () => {
    const { QUICK_CELLAR_OPERATIONS, isQuickCellarOperation } = await import('../lib/wineryOperations');
    const operationType = QUICK_CELLAR_OPERATIONS[0].key;

    const { items } = expandWorkOrderTemplate({
      template: template({ items: [{ title: 'Check', kind: 'other', operationType, dayOffset: 0, notes: '' }] }),
      dueDate: '2026-09-08',
      assignedTo: 'gio',
      targets: [{ vesselId: 'B-01' }],
      createdBy: 'ana',
      now: NOW,
      existingPlanIds: [],
      existingOrderIds: [],
    });

    expect(isQuickCellarOperation(items[0].operationType!)).toBe(true);
  });
});

describe('scans prefer work that can actually be recorded', () => {
  const onVessel = (id: string, patch: Partial<ProductionPlanItem>): ProductionPlanItem => ({
    ...item(id),
    vesselIds: ['T-101'],
    startDate: '2026-09-01',
    endDate: '2026-09-01',
    status: 'planned',
    ...patch,
  });

  it('picks the recordable item over an older one that only opens a draft', () => {
    const found = dueWorkForVessel({
      vesselId: 'T-101',
      items: [
        // Older, but `kind: other` with no operation type opens a task draft.
        onVessel('p1', { startDate: '2026-08-20', endDate: '2026-08-20' }),
        onVessel('p2', { operationType: 'sulfitation' }),
      ],
      today: '2026-09-01',
    });

    expect(found?.id).toBe('p2');
  });

  it('still falls back to non-recordable work when that is all there is', () => {
    const found = dueWorkForVessel({
      vesselId: 'T-101',
      items: [onVessel('p1', {})],
      today: '2026-09-01',
    });

    expect(found?.id).toBe('p1');
  });

  it('treats a dedicated operation type as not recordable', () => {
    // Racking, blending, bottling and vessel filling have their own workflows
    // and are excluded from the quick operation recorder.
    expect(isRecordableWork(onVessel('p1', { operationType: 'vessel_filling' }))).toBe(false);
    expect(isRecordableWork(onVessel('p2', { operationType: 'sulfitation' }))).toBe(true);
  });

  it('agrees with the planner about which kinds reach a recorder', async () => {
    const { openProductionPlanItem } = await import('../lib/productionPlanNavigation');
    const harness = () => ({
      lang: 'en' as const,
      harvests: [],
      navigate: () => true,
      setIntakeHarvestId: () => {},
      setTransfer: () => {},
      setLab: () => {},
      setSanitation: () => {},
      setOperation: () => {},
      setTaskDraft: () => {},
    });

    for (const kind of ['transfer', 'lab', 'sanitation', 'intake'] as const) {
      const candidate = onVessel('p1', { kind });
      expect(isRecordableWork(candidate), `${kind} should be recordable`).toBe(true);
      expect(openProductionPlanItem(candidate, harness()), `${kind} should route somewhere settleable`).not.toBeNull();
    }

    for (const kind of ['harvest', 'procurement', 'dispatch', 'other'] as const) {
      const candidate = onVessel('p1', { kind });
      expect(isRecordableWork(candidate), `${kind} should not be recordable`).toBe(false);
      expect(openProductionPlanItem(candidate, harness()), `${kind} should not claim a fulfilment`).toBeNull();
    }
  });
});
