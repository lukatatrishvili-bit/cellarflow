import { describe, expect, it } from 'vitest';
import {
  fulfilProductionPlanItem,
  type PendingPlanFulfilment,
} from '../lib/planFulfilment';
import type { ProductionPlanItem } from '../lib/operationsControl';
import type { Task } from '../lib/wineryState';

const plan = (patch: Partial<ProductionPlanItem> = {}): ProductionPlanItem => ({
  id: 'plan-1',
  title: 'Rack T-101 to T-204',
  kind: 'transfer',
  status: 'planned',
  startDate: '2026-08-28',
  endDate: '2026-08-28',
  assignedTo: 'ana',
  vesselIds: ['T-101'],
  notes: '',
  dependencyIds: [],
  createdAt: '2026-08-28T08:00:00.000Z',
  createdBy: 'ana',
  ...patch,
});

const task = (patch: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Rack T-101 to T-204',
  priority: 'medium',
  dueDate: '2026-08-28',
  assignedTo: 'ana',
  status: 'pending',
  description: '',
  source: { type: 'production_plan', id: 'plan-1' },
  ...patch,
});

const pending = (patch: Partial<PendingPlanFulfilment> = {}): PendingPlanFulfilment => ({
  planItemId: 'plan-1',
  kind: 'operation',
  openedAt: '2026-08-28T09:00:00.000Z',
  ...patch,
});

const COMPLETED_AT = '2026-08-28T10:15:00.000Z';

describe('fulfilProductionPlanItem', () => {
  it('completes the plan item and its task when the expected recorder saves', () => {
    const result = fulfilProductionPlanItem({
      fulfilment: pending(),
      kind: 'operation',
      items: [plan()],
      tasks: [task()],
      completedAt: COMPLETED_AT,
    });

    expect(result.closed?.id).toBe('plan-1');
    expect(result.items[0].status).toBe('completed');
    expect(result.items[0].lastModified).toBe(COMPLETED_AT);
    expect(result.tasks[0].status).toBe('completed');
  });

  it('settles nothing when a different recorder saves', () => {
    const items = [plan()];
    const tasks = [task()];

    const result = fulfilProductionPlanItem({
      fulfilment: pending({ kind: 'operation' }),
      kind: 'lab',
      items,
      tasks,
      completedAt: COMPLETED_AT,
    });

    expect(result.closed).toBeNull();
    expect(result.items).toBe(items);
    expect(result.tasks).toBe(tasks);
  });

  it('settles nothing when no work is pending', () => {
    const result = fulfilProductionPlanItem({
      fulfilment: null,
      kind: 'operation',
      items: [plan()],
      tasks: [task()],
      completedAt: COMPLETED_AT,
    });

    expect(result.closed).toBeNull();
    expect(result.items[0].status).toBe('planned');
  });

  it('leaves an item someone already settled alone', () => {
    for (const status of ['completed', 'cancelled'] as const) {
      const result = fulfilProductionPlanItem({
        fulfilment: pending(),
        kind: 'operation',
        items: [plan({ status })],
        tasks: [task()],
        completedAt: COMPLETED_AT,
      });

      expect(result.closed).toBeNull();
      expect(result.items[0].status).toBe(status);
      expect(result.tasks[0].status).toBe('pending');
    }
  });

  it('tolerates a plan item that has since been deleted', () => {
    const result = fulfilProductionPlanItem({
      fulfilment: pending({ planItemId: 'plan-gone' }),
      kind: 'operation',
      items: [plan()],
      tasks: [task()],
      completedAt: COMPLETED_AT,
    });

    expect(result.closed).toBeNull();
    expect(result.items[0].status).toBe('planned');
  });

  it('completes the item when no task was ever created from it', () => {
    const result = fulfilProductionPlanItem({
      fulfilment: pending(),
      kind: 'operation',
      items: [plan()],
      tasks: [],
      completedAt: COMPLETED_AT,
    });

    expect(result.closed?.id).toBe('plan-1');
    expect(result.tasks).toEqual([]);
  });

  it('closes only the task linked to this plan item', () => {
    const other = task({ id: 'task-2', source: { type: 'production_plan', id: 'plan-2' } });
    const unlinked = task({ id: 'task-3', source: undefined });

    const result = fulfilProductionPlanItem({
      fulfilment: pending(),
      kind: 'operation',
      items: [plan()],
      tasks: [task(), other, unlinked],
      completedAt: COMPLETED_AT,
    });

    expect(result.tasks.map(entry => entry.status)).toEqual(['completed', 'pending', 'pending']);
  });

  it('does not touch a task that was already completed', () => {
    const tasks = [task({ status: 'completed' })];

    const result = fulfilProductionPlanItem({
      fulfilment: pending(),
      kind: 'operation',
      items: [plan()],
      tasks,
      completedAt: COMPLETED_AT,
    });

    expect(result.closed?.id).toBe('plan-1');
    expect(result.tasks).toBe(tasks);
  });
});
