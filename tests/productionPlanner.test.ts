import { describe, expect, it } from 'vitest';
import {
  alignPlanAfterDependencies,
  buildProductionPlanSuggestions,
  forecastProductionPlan,
  linkedTaskForProductionPlan,
  taskDraftForProductionPlan,
} from '../lib/productionPlanner';
import type { ProductionPlanItem } from '../lib/operationsControl';
import type { DailyFermLog, LabAnalysis, Task, Vessel, WineLot } from '../lib/wineryState';

const lot = (patch: Partial<WineLot> = {}): WineLot => ({
  id: 'LOT-1',
  name: 'Rkatsiteli 2026',
  vintage: 2026,
  variety: 'Rkatsiteli',
  vineyardBlock: 'B-1',
  region: 'Kakheti',
  initialVolume: 5_000,
  currentVolume: 5_000,
  wineClass: 'white',
  stage: 'fermenting',
  createdAt: '2026-08-20',
  history: [],
  ...patch,
});

const vessel = (patch: Partial<Vessel> = {}): Vessel => ({
  id: 'T-1',
  type: 'stainless_steel',
  shape: 'vertical',
  capacity: 10_000,
  currentVolume: 5_000,
  assignedLotId: 'LOT-1',
  cleaningStatus: 'clean',
  lastCleaned: '2026-08-20',
  temperature: 18,
  coolingJacketActive: false,
  targetTemperature: null,
  lastOperation: 'Filled',
  ...patch,
});

const plan = (patch: Partial<ProductionPlanItem> = {}): ProductionPlanItem => ({
  id: 'P-1',
  title: 'Work',
  kind: 'lab',
  status: 'planned',
  startDate: '2026-08-28',
  endDate: '2026-08-28',
  assignedTo: 'winemaker',
  vesselIds: [],
  notes: '',
  dependencyIds: [],
  createdAt: '2026-08-28T08:00:00.000Z',
  createdBy: 'winemaker',
  ...patch,
});

const fermentationLog = (patch: Partial<DailyFermLog> = {}): DailyFermLog => ({
  id: 'F-1',
  tankId: 'T-1',
  lotId: 'LOT-1',
  date: '2026-08-27',
  temperature: 20,
  density: 1.04,
  sugar: 80,
  ph: 3.3,
  tastingNotes: '',
  capManagement: '',
  additives: '',
  ...patch,
});

const labLog = (patch: Partial<LabAnalysis> = {}): LabAnalysis => ({
  id: 'LAB-1',
  lotId: 'LOT-1',
  tankId: 'T-1',
  date: '2026-07-01',
  alcoholPct: 12,
  volatileAcid: 0.4,
  freeSo2: 25,
  totalSo2: 70,
  residualSugar: 2,
  ph: 3.4,
  malicAcid: 0.1,
  lacticAcid: 0.7,
  turbidity: 2,
  technician: 'Nino',
  titratableAcidity: 6,
  ...patch,
});

describe('production planner intelligence', () => {
  it('suggests a missing daily fermentation reading and suppresses duplicate open work', () => {
    const input = {
      today: '2026-08-28',
      lots: [lot()],
      vessels: [vessel()],
      fermentationLogs: [fermentationLog()],
      labLogs: [] as LabAnalysis[],
      productionPlans: [] as ProductionPlanItem[],
    };
    expect(buildProductionPlanSuggestions(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'fermentation_reading_due', lotId: 'LOT-1', vesselIds: ['T-1'] }),
    ]));
    expect(buildProductionPlanSuggestions({
      ...input,
      productionPlans: [plan({ kind: 'fermentation', lotId: 'LOT-1', vesselIds: ['T-1'] })],
    })).toHaveLength(0);
  });

  it('suggests stale laboratory work and sanitation only when operational evidence requires it', () => {
    const suggestions = buildProductionPlanSuggestions({
      today: '2026-08-28',
      lots: [lot({ stage: 'aging' })],
      vessels: [
        vessel(),
        vessel({ id: 'T-2', currentVolume: 0, assignedLotId: null, cleaningStatus: 'cleaning_needed' }),
        vessel({ id: 'T-3', currentVolume: 0, assignedLotId: null, cleaningStatus: 'clean' }),
      ],
      fermentationLogs: [],
      labLogs: [labLog()],
      productionPlans: [],
    });
    expect(suggestions.map(item => item.reason)).toEqual(['sanitation_required', 'lab_panel_due']);
    expect(suggestions.find(item => item.reason === 'sanitation_required')?.vesselIds).toEqual(['T-2']);
  });

  it('forecasts readiness, peak load, planned flow and genuinely ready empty capacity', () => {
    const first = plan({ id: 'P-1', quantityLiters: 1_000, startDate: '2026-08-28', endDate: '2026-08-29' });
    const second = plan({ id: 'P-2', quantityLiters: 2_000, startDate: '2026-08-29', endDate: '2026-08-29' });
    const forecast = forecastProductionPlan({
      today: '2026-08-28',
      productionPlans: [first, second, plan({ id: 'P-3', status: 'completed', quantityLiters: 9_000 })],
      vessels: [
        vessel({ id: 'EMPTY-CLEAN', currentVolume: 0, assignedLotId: null, capacity: 8_000 }),
        vessel({ id: 'EMPTY-DIRTY', currentVolume: 0, assignedLotId: null, capacity: 20_000, cleaningStatus: 'dirty' }),
      ],
      attentionItemIds: ['P-2'],
    });
    expect(forecast).toMatchObject({
      openCount: 2,
      readinessPercent: 50,
      plannedFlowLiters: 3_000,
      cleanEmptyCapacityLiters: 8_000,
      peakDate: '2026-08-29',
      peakCount: 2,
    });
  });

  it('moves dependent work without changing its duration', () => {
    const prerequisite = plan({ id: 'P-0', startDate: '2026-08-28', endDate: '2026-08-30' });
    const dependent = plan({ id: 'P-1', startDate: '2026-08-28', endDate: '2026-08-29', dependencyIds: ['P-0'] });
    expect(alignPlanAfterDependencies(dependent, [prerequisite, dependent])).toEqual({
      startDate: '2026-08-30',
      endDate: '2026-08-31',
    });
  });

  it('creates a durable, operationally linked task draft with automatic urgency', () => {
    const item = plan({
      id: 'P-TASK',
      title: 'Rack Saperavi',
      kind: 'transfer',
      status: 'blocked',
      startDate: '2026-08-28',
      endDate: '2026-08-29',
      lotId: 'LOT-1',
      vesselIds: ['T-1', 'T-2'],
      blockId: 'B-1',
      notes: 'Verify receiving vessel sanitation.',
    });
    const draft = taskDraftForProductionPlan(item, 'en', { today: '2026-08-29', dueDate: 'end' });

    expect(draft).toMatchObject({
      title: 'Rack Saperavi',
      priority: 'high',
      dueDate: '2026-08-29',
      assignedTo: 'winemaker',
      source: { type: 'production_plan', id: 'P-TASK', lotId: 'LOT-1', vesselIds: ['T-1', 'T-2'], blockId: 'B-1' },
    });
    expect(draft.description).toContain('Verify receiving vessel sanitation.');
  });

  it('finds the linked task so the planner can prevent duplicate generation', () => {
    const tasks: Task[] = [{
      id: 'TASK-1', title: 'Work', priority: 'medium', dueDate: '2026-08-30',
      assignedTo: 'winemaker', status: 'pending', description: '',
      source: { type: 'production_plan', id: 'P-1' },
    }];
    expect(linkedTaskForProductionPlan(tasks, 'P-1')?.id).toBe('TASK-1');
    expect(linkedTaskForProductionPlan(tasks, 'P-2')).toBeUndefined();
  });
});
