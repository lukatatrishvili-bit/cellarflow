import { describe, expect, it, vi } from 'vitest';
import {
  openProductionPlanItem,
  type ProductionPlanNavigationActions,
} from '../lib/productionPlanNavigation';
import type { ProductionPlanItem } from '../lib/operationsControl';
import type { HarvestRecord } from '../lib/wineryState';

const plan = (patch: Partial<ProductionPlanItem>): ProductionPlanItem => ({
  id: 'plan-1',
  title: 'Cellar work',
  kind: 'transfer',
  status: 'planned',
  startDate: '2026-08-28',
  endDate: '2026-08-28',
  assignedTo: 'ana',
  vesselIds: [],
  notes: '',
  dependencyIds: [],
  createdAt: '2026-08-28T08:00:00.000Z',
  createdBy: 'ana',
  ...patch,
});

function actionHarness(navigateResult = true) {
  const actions: ProductionPlanNavigationActions = {
    lang: 'en',
    harvests: [],
    navigate: vi.fn(() => navigateResult),
    setIntakeHarvestId: vi.fn(),
    setTransfer: vi.fn(),
    setLab: vi.fn(),
    setSanitation: vi.fn(),
    setOperation: vi.fn(),
    setTaskDraft: vi.fn(),
  };
  return actions;
}

describe('production plan navigation', () => {
  it('opens a transfer with the linked vessels and safe planned volume', () => {
    const actions = actionHarness();
    openProductionPlanItem(plan({
      vesselIds: ['T-101', 'Q-01'],
      quantityLiters: 2500,
    }), actions);

    expect(actions.navigate).toHaveBeenCalledWith('gvino', 'transfers');
    expect(actions.setTransfer).toHaveBeenCalledWith('T-101', 'Q-01', 2500);
  });

  it('does not prefill a destination the user cannot open', () => {
    const actions = actionHarness(false);
    openProductionPlanItem(plan({ vesselIds: ['T-101', 'Q-01'] }), actions);

    expect(actions.setTransfer).not.toHaveBeenCalled();
  });

  it('returns dedicated sanitation work to the winery plan vessel context', () => {
    const actions = actionHarness();
    openProductionPlanItem(plan({ kind: 'sanitation', vesselIds: ['T-105'] }), actions);

    expect(actions.navigate).toHaveBeenCalledWith('gvino', 'winery-plan');
    expect(actions.setSanitation).toHaveBeenCalledWith('T-105');
  });

  it('carries a generated harvest record into grape intake', () => {
    const actions = actionHarness();
    actions.harvests = [{
      id: 'harvest-1',
      blockId: 'block-1',
      variety: 'Saperavi',
      estimatedHarvestDate: '2026-09-10',
      estimatedTons: 4,
      pickingMethod: 'hand',
      grapeCondition: 'excellent',
      sentToGvino: false,
      notes: '',
    } satisfies HarvestRecord];

    openProductionPlanItem(plan({
      kind: 'intake',
      blockId: 'block-1',
      notes: 'Generated from harvest:harvest-1',
    }), actions);

    expect(actions.navigate).toHaveBeenCalledWith('gvino', 'intake');
    expect(actions.setIntakeHarvestId).toHaveBeenCalledWith('harvest-1');
  });

  it('turns other work into a linked task draft', () => {
    const actions = actionHarness();
    openProductionPlanItem(plan({
      title: 'Inspect seals',
      kind: 'other',
      status: 'blocked',
      lotId: 'LOT-1',
      vesselIds: ['Q-02'],
      notes: 'Photograph the seal.',
    }), actions);

    expect(actions.setTaskDraft).toHaveBeenCalledWith(
      'Inspect seals',
      'high',
      'Photograph the seal.\nLot: LOT-1\nVessel: Q-02',
    );
  });

  it('opens a map-assigned cellar operation in the operation recorder with its context', () => {
    const actions = actionHarness();
    openProductionPlanItem(plan({
      kind: 'other',
      operationType: 'sulfitation',
      lotId: 'LOT-1',
      vesselIds: ['T-101'],
    }), actions);

    expect(actions.navigate).toHaveBeenCalledWith('gvino', 'operations');
    expect(actions.setOperation).toHaveBeenCalledWith('LOT-1', 'T-101', 'sulfitation');
    expect(actions.setTaskDraft).not.toHaveBeenCalled();
  });

  // The caller remembers what it sent someone off to do, so the recorder's
  // save can settle the plan item without a second trip to the planner.
  it('names the recorder that can settle each kind of work', () => {
    const cases: Array<[Partial<ProductionPlanItem>, string | null]> = [
      [{ kind: 'transfer', vesselIds: ['T-101', 'Q-01'] }, 'transfer'],
      [{ kind: 'lab', lotId: 'LOT-1' }, 'lab'],
      [{ kind: 'sanitation', vesselIds: ['T-105'] }, 'sanitation'],
      [{ kind: 'intake', blockId: 'block-1' }, 'intake'],
      [{ kind: 'other', operationType: 'sulfitation', lotId: 'LOT-1' }, 'operation'],
    ];

    for (const [patch, expected] of cases) {
      expect(openProductionPlanItem(plan(patch), actionHarness())).toBe(expected);
    }
  });

  it('settles nothing for work that only navigates somewhere', () => {
    for (const kind of ['harvest', 'procurement', 'dispatch', 'fermentation', 'bottling'] as const) {
      expect(openProductionPlanItem(plan({ kind }), actionHarness())).toBeNull();
    }
    expect(openProductionPlanItem(plan({ kind: 'other' }), actionHarness())).toBeNull();
  });

  it('settles nothing when the operator cannot open the recorder', () => {
    const actions = actionHarness(false);

    expect(openProductionPlanItem(plan({ kind: 'transfer' }), actions)).toBeNull();
    expect(openProductionPlanItem(plan({ kind: 'lab' }), actions)).toBeNull();
    expect(openProductionPlanItem(plan({ kind: 'sanitation' }), actions)).toBeNull();
    expect(openProductionPlanItem(plan({ kind: 'intake' }), actions)).toBeNull();
    expect(openProductionPlanItem(plan({ operationType: 'sulfitation' }), actions)).toBeNull();
  });
});
