import { describe, it, expect } from 'vitest';
import { deriveEvents, deriveScheduledEvents } from '../lib/ai/events';
import { normalizeSnapshot, type WineryIntelligenceSnapshotInput } from '../lib/ai/snapshot';

const snap = (input: WineryIntelligenceSnapshotInput) =>
  normalizeSnapshot({ today: '2026-09-20', ...input });

const lot = {
  id: 'L1', name: 'Saperavi Qvevri', vintage: 2026, variety: 'Saperavi', vineyardBlock: 'B1',
  region: 'Kakheti', initialVolume: 1000, currentVolume: 1000, wineClass: 'red',
  stage: 'fermenting', createdAt: '2026-09-01', history: [],
} as any;

const vessel = (fields: Record<string, any> = {}) => ({
  id: 'T1', type: 'qvevri', shape: 'conical', capacity: 1200, currentVolume: 900,
  assignedLotId: 'L1', cleaningStatus: 'clean', lastCleaned: '2026-08-30',
  temperature: 24, coolingJacketActive: false, targetTemperature: 26, lastOperation: 'fill',
  ...fields,
}) as any;

const ferm = (fields: Record<string, any>) => ({
  id: 'f1', tankId: 'T1', lotId: 'L1', date: '2026-09-19', temperature: 24, density: 1.03,
  sugar: 70, ph: 3.4, tastingNotes: '', capManagement: '', additives: '', ...fields,
}) as any;

const lab = (fields: Record<string, any>) => ({
  id: 'lab1', lotId: 'L1', tankId: 'T1', date: '2026-09-19', alcoholPct: 12,
  volatileAcid: 0.4, freeSo2: 30, totalSo2: 90, residualSugar: 2, ph: 3.4,
  malicAcid: 0.4, lacticAcid: 0.1, turbidity: 4, technician: 'QA',
  titratableAcidity: 6, ...fields,
}) as any;

const item = (fields: Record<string, any>) => ({
  id: 'INV1', name: 'Bentonite', category: 'additives', stock: 10, minThreshold: 5,
  unit: 'kg', costPerUnit: 8, supplierName: 'Local', ...fields,
}) as any;

describe('deriveEvents', () => {
  it('produces nothing for an unchanged snapshot', () => {
    const before = snap({ lots: [lot], vessels: [vessel()] });
    expect(deriveEvents(before, before)).toHaveLength(0);
  });

  it('emits a reading event and a density change for a new fermentation log', () => {
    const before = snap({ lots: [lot], fermLogs: [ferm({ id: 'f1', date: '2026-09-18', density: 1.05 })] });
    const after = snap({
      lots: [lot],
      fermLogs: [
        ferm({ id: 'f1', date: '2026-09-18', density: 1.05 }),
        ferm({ id: 'f2', date: '2026-09-20', density: 1.02 }),
      ],
    });
    const types = deriveEvents(before, after).map((event) => event.eventType);
    expect(types).toContain('fermentation_reading_added');
    expect(types).toContain('density_changed');
  });

  it('emits an SO2 measurement and a VA change from a new analysis', () => {
    const before = snap({ lots: [lot], labLogs: [lab({ id: 'lab1', volatileAcid: 0.4 })] });
    const after = snap({
      lots: [lot],
      labLogs: [lab({ id: 'lab1', volatileAcid: 0.4 }), lab({ id: 'lab2', date: '2026-09-20', volatileAcid: 0.62 })],
    });
    const events = deriveEvents(before, after);
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['lab_analysis_added', 'so2_measured', 'volatile_acidity_changed']),
    );
    const va = events.find((event) => event.eventType === 'volatile_acidity_changed')!;
    expect(va.previousValue).toBe(0.4);
    expect(va.newValue).toBe(0.62);
    expect(va.severityHint).toBe('attention');
  });

  it('ignores measurement noise below the movement thresholds', () => {
    const before = snap({ vessels: [vessel({ temperature: 24 })] });
    const after = snap({ vessels: [vessel({ temperature: 25 })] });
    expect(deriveEvents(before, after)).toHaveLength(0);
  });

  it('emits a temperature change once the movement is meaningful', () => {
    const before = snap({ lots: [lot], vessels: [vessel({ temperature: 24 })] });
    const after = snap({ lots: [lot], vessels: [vessel({ temperature: 29 })] });
    const event = deriveEvents(before, after)[0];
    expect(event.eventType).toBe('temperature_changed');
    expect(event.relatedEntities[0]).toMatchObject({ type: 'lot', id: 'L1' });
  });

  it('distinguishes a vessel being filled from one being emptied', () => {
    const empty = snap({ vessels: [vessel({ currentVolume: 0 })] });
    const full = snap({ vessels: [vessel({ currentVolume: 900 })] });
    expect(deriveEvents(empty, full)[0].eventType).toBe('vessel_filled');
    expect(deriveEvents(full, empty)[0].eventType).toBe('vessel_emptied');
  });

  it('marks stock crossing the reorder point, not every stock movement', () => {
    const before = snap({ inventory: [item({ stock: 10 })] });
    const nudged = snap({ inventory: [item({ stock: 8 })] });
    const crossed = snap({ inventory: [item({ stock: 4 })] });

    expect(deriveEvents(before, nudged)[0].eventType).toBe('inventory_level_changed');
    expect(deriveEvents(before, crossed)[0].eventType).toBe('stock_low');
  });

  it('recognises a blend as distinct from a plain transfer', () => {
    const transfer = (fields: Record<string, any>) => ({
      id: 'tr1', sourceId: 'T1', destId: 'T2', volume: 500, loss: 5, operator: 'QA',
      category: 'racking', date: '2026-09-20', pump: 'p1', details: '', ...fields,
    }) as any;

    const before = snap({});
    const plain = snap({ transfers: [transfer({ sourceLotId: 'L1', resultLotId: 'L1' })] });
    const blend = snap({ transfers: [transfer({ sourceLotId: 'L1', destinationLotId: 'L2', resultLotId: 'L3' })] });

    expect(deriveEvents(before, plain)[0].eventType).toBe('transfer_completed');
    expect(deriveEvents(before, blend)[0].eventType).toBe('blend_created');
  });
});

describe('deriveScheduledEvents', () => {
  it('emits overdue-task events that no state diff could produce', () => {
    const events = deriveScheduledEvents(snap({
      tasks: [
        { id: 't1', title: 'Racking', priority: 'high', dueDate: '2026-09-01', assignedTo: 'Nino', status: 'pending', description: '' },
        { id: 't2', title: 'Topping', priority: 'low', dueDate: '2026-09-30', assignedTo: 'Nino', status: 'pending', description: '' },
        { id: 't3', title: 'Done', priority: 'low', dueDate: '2026-09-01', assignedTo: 'Nino', status: 'completed', description: '' },
      ] as any,
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'task_overdue', entityId: 't1', newValue: 19, severityHint: 'warning' });
  });

  it('announces an approaching harvest window inside the planning horizon', () => {
    const block = (estimatedHarvestDate: string) => ({
      id: 'B1', name: 'Mukuzani 4', vineyardName: 'Main', locationName: 'Kakheti',
      latitude: 41, longitude: 45, area: 2, elevation: 400, slope: 'gentle', aspect: 'S',
      soilType: 'clay', grapeVariety: 'Saperavi', plantingYear: 2010, spacing: '2x1',
      rowsCount: 40, vinesCount: 4000, trainingSystem: 'Guyot', pruningSystem: 'cane',
      irrigationEnabled: false, farmingStatus: 'organic', currentPhenology: 'veraison',
      estimatedHarvestDate, notes: '',
    }) as any;

    expect(deriveScheduledEvents(snap({ blocks: [block('2026-09-25')] }))).toHaveLength(1);
    // Beyond the three-week horizon there is nothing actionable to say yet.
    expect(deriveScheduledEvents(snap({ blocks: [block('2026-11-25')] }))).toHaveLength(0);
  });
});
