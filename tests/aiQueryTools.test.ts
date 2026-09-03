import { describe, it, expect } from 'vitest';
import {
  canRoleRunQuery,
  executeQuery,
  validateQueryPlan,
  type QueryPlan,
} from '../lib/ai/queryTools';
import { computeWineryBaselines } from '../lib/ai/baselines';
import { normalizeSnapshot } from '../lib/ai/snapshot';

const lot = (fields: Record<string, any>) => ({
  id: 'L1',
  name: 'Saperavi Qvevri',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'B1',
  region: 'Kakheti',
  initialVolume: 1000,
  currentVolume: 900,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-09-01',
  history: [],
  ...fields,
}) as any;

const lab = (fields: Record<string, any>) => ({
  id: 'lab1',
  lotId: 'L1',
  tankId: 'T1',
  date: '2026-09-15',
  alcoholPct: 13,
  volatileAcid: 0.4,
  freeSo2: 30,
  totalSo2: 90,
  residualSugar: 2,
  ph: 3.5,
  malicAcid: 0.4,
  lacticAcid: 0.2,
  turbidity: 4,
  technician: 'QA',
  titratableAcidity: 6,
  ...fields,
}) as any;

const snapshot = normalizeSnapshot({
  today: '2026-09-20',
  lots: [
    lot({ id: 'L1', name: 'Saperavi A' }),
    lot({ id: 'L2', name: 'Saperavi B' }),
    lot({ id: 'L3', name: 'Rkatsiteli', variety: 'Rkatsiteli', wineClass: 'amber' }),
  ],
  labLogs: [
    lab({ id: 'lab1', lotId: 'L1', ph: 3.72 }),
    lab({ id: 'lab2', lotId: 'L2', ph: 3.31 }),
    // L3 has no analysis at all.
  ],
  inventory: [{
    id: 'INV1', name: 'Bentonite', category: 'additives',
    stock: 1, minThreshold: 5, unit: 'kg', costPerUnit: 8, supplierName: 'Local',
  }],
  tasks: [{
    id: 't1', title: 'Racking', priority: 'high', dueDate: '2026-09-01',
    assignedTo: 'Nino', status: 'pending', description: '',
  }],
  blocks: [{
    id: 'B1', name: 'Mukuzani 4', vineyardName: 'Main', locationName: 'Kakheti',
    latitude: 41, longitude: 45, area: 2, elevation: 400, slope: 'gentle', aspect: 'S',
    soilType: 'clay', grapeVariety: 'Saperavi', plantingYear: 2010, spacing: '2x1',
    rowsCount: 40, vinesCount: 4000, trainingSystem: 'Guyot', pruningSystem: 'cane',
    irrigationEnabled: false, farmingStatus: 'organic', currentPhenology: 'veraison',
    estimatedHarvestDate: '2026-09-28', notes: '',
  }],
  grapeIntakes: [{
    id: 'gi1', date: '2026-09-18', source: 'own', blockId: 'B1', variety: 'Saperavi',
    vintage: 2026, grossWeightKg: 5200, tareWeightKg: 200, netWeightKg: 5000,
    brix: 23, ph: 3.4, titratableAcidity: 6, temperatureC: 22, condition: 'good',
    pickingMethod: 'hand', wineClass: 'red', juiceYieldPct: 65, estimatedVolumeL: 3250,
    destinationVesselId: 'T1', createdLotId: 'L1', operator: 'QA', notes: '',
  }],
} as any);

const baselines = computeWineryBaselines(snapshot);

describe('validateQueryPlan', () => {
  it('rejects an unknown query kind', () => {
    const result = validateQueryPlan({ kind: 'drop_tables' });
    expect(result.plan).toBeUndefined();
    expect(result.error!.en).toContain('Unsupported query type');
    expect(result.error!.ka.length).toBeGreaterThan(0);
  });

  it('rejects a filter field outside the whitelist', () => {
    const result = validateQueryPlan({
      kind: 'lots_filter',
      filters: [{ field: 'password', operator: 'eq', value: 'x' }],
    });
    expect(result.plan).toBeUndefined();
    expect(result.error!.en).toContain('is not allowed');
  });

  it('rejects an operator outside the whitelist', () => {
    const result = validateQueryPlan({
      kind: 'lots_filter',
      filters: [{ field: 'ph', operator: 'regex', value: '.*' }],
    });
    expect(result.plan).toBeUndefined();
  });

  it('requires a number for a numeric field', () => {
    const result = validateQueryPlan({
      kind: 'lots_filter',
      filters: [{ field: 'ph', operator: 'gt', value: 'high' }],
    });
    expect(result.error!.en).toContain('needs a number');
  });

  it('coerces a numeric string and clamps limits', () => {
    const result = validateQueryPlan({
      kind: 'lots_filter',
      filters: [{ field: 'ph', operator: 'gt', value: '3.6' }],
      limit: 5000,
      windowDays: 99999,
    });
    expect(result.plan!.filters![0].value).toBe(3.6);
    expect(result.plan!.limit).toBe(50);
    expect(result.plan!.windowDays).toBe(730);
  });

  it('parses a plan supplied as a JSON string', () => {
    const result = validateQueryPlan(JSON.stringify({ kind: 'winery_summary' }));
    expect(result.plan!.kind).toBe('winery_summary');
  });
});

describe('executeQuery', () => {
  const run = (plan: QueryPlan) => executeQuery(plan, snapshot, baselines);

  it('filters lots by a measured field', () => {
    const result = run({ kind: 'lots_filter', filters: [{ field: 'ph', operator: 'gt', value: 3.6 }] });
    expect(result.rows.map((row) => row.lotId)).toEqual(['L1']);
  });

  it('excludes an unmeasured lot rather than treating it as zero', () => {
    const result = run({ kind: 'lots_filter', filters: [{ field: 'ph', operator: 'lt', value: 4 }] });
    // L3 has no analysis, so it cannot satisfy a pH condition either way.
    expect(result.rows.map((row) => row.lotId)).toEqual(['L1', 'L2']);
  });

  it('combines a text filter with a numeric one', () => {
    const result = run({
      kind: 'lots_filter',
      filters: [
        { field: 'variety', operator: 'eq', value: 'Saperavi' },
        { field: 'ph', operator: 'lt', value: 3.4 },
      ],
    });
    expect(result.rows.map((row) => row.lotId)).toEqual(['L2']);
  });

  it('marks an empty result explicitly', () => {
    const result = run({ kind: 'lots_filter', filters: [{ field: 'vintage', operator: 'eq', value: 1999 }] });
    expect(result.empty).toBe(true);
    expect(result.rows).toHaveLength(0);
  });

  it('reports yield per hectare from recorded intakes', () => {
    const result = run({ kind: 'block_yield' });
    expect(result.rows[0]).toMatchObject({ blockId: 'B1', harvestedKg: 5000, yieldKgPerHa: 2500 });
  });

  it('lists low stock with the source records behind it', () => {
    const result = run({ kind: 'inventory_low' });
    expect(result.rows[0]).toMatchObject({ id: 'INV1', stock: 1 });
    expect(result.sourceRefs).toContain('inventory:INV1');
  });

  it('computes overdue days for open tasks', () => {
    const result = run({ kind: 'open_tasks' });
    expect(result.rows[0]).toMatchObject({ id: 't1', overdueDays: 19 });
  });

  it('summarises the winery when nothing more specific fits', () => {
    const result = run({ kind: 'winery_summary' });
    expect(result.rows[0].lots).toBe(3);
    expect(result.rows[0].overdueTasks).toBe(1);
  });

  it('truncates rather than returning an unbounded result', () => {
    const result = run({ kind: 'lots_filter', filters: [], limit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('refuses a comparison without two lots', () => {
    const result = run({ kind: 'lot_comparison', entityId: 'L1' });
    expect(result.rows).toHaveLength(0);
    expect(result.summary.en).toContain('Two lots are needed');
  });
});

describe('canRoleRunQuery', () => {
  it('blocks a role from a module it cannot read', () => {
    expect(canRoleRunQuery('Viticulturist', 'block_yield')).toBe(true);
    expect(canRoleRunQuery('Cellar Worker', 'block_yield')).toBe(false);
  });

  it('allows an owner everything', () => {
    expect(canRoleRunQuery('Owner/Admin', 'lots_filter')).toBe(true);
    expect(canRoleRunQuery('Owner/Admin', 'inventory_low')).toBe(true);
  });
});
