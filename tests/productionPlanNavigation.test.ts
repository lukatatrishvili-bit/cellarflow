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
});
