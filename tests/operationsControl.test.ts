import { describe, expect, it } from 'vitest';
import {
  buildRecallTrace,
  buildTodayQueue,
  completeQualitySop,
  createReorderPurchaseOrder,
  detectProductionPlanConflicts,
  nextSopDueDate,
  purchaseOrderTotal,
  type ProductionPlanItem,
  type QualitySop,
} from '../lib/operationsControl';
import { parseCellarScanValue } from '../components/ScanToAction';
import type { InventoryItem, Vessel, WineLot } from '../lib/wineryState';

const sop = (patch: Partial<QualitySop> = {}): QualitySop => ({
  id: 'sop-1', title: 'ATP check', category: 'sanitation', frequency: 'monthly', owner: 'owner',
  active: true, nextDueDate: '2026-01-31', checklist: ['Rinse', 'Read ATP'], evidenceRequired: true,
  completionHistory: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'owner', ...patch,
});

describe('operations control utilities', () => {
  it('advances recurring SOP dates without skipping short months', () => {
    expect(nextSopDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextSopDueDate('2024-02-29', 'seasonal')).toBe('2025-02-28');
    expect(nextSopDueDate('2026-08-13', 'weekly')).toBe('2026-08-20');
  });

  it('requires the full checklist and evidence, then schedules the next occurrence', () => {
    expect(() => completeQualitySop(sop(), { completedBy: 'ana', completedChecklist: ['Rinse'], evidenceNote: '42' })).toThrow(/Every SOP/);
    expect(() => completeQualitySop(sop(), { completedBy: 'ana', completedChecklist: ['Rinse', 'Read ATP'] })).toThrow(/evidence/);
    const result = completeQualitySop(sop(), {
      completedBy: 'ana', completedAt: '2026-01-31T10:00:00.000Z',
      completedChecklist: ['Rinse', 'Read ATP'], evidenceNote: 'ATP 18 RLU',
    });
    expect(result.nextDueDate).toBe('2026-02-28');
    expect(result.completionHistory[0]).toMatchObject({ completedBy: 'ana', evidenceNote: 'ATP 18 RLU' });
  });

  it('turns supplier reorder points into a priced purchase order', () => {
    const items = [
      { id: 'yeast', name: 'Yeast', category: 'yeast', stock: 1, minThreshold: 5, unit: 'kg', costPerUnit: 20, supplierName: 'BioSup' },
      { id: 'cleaner', name: 'Cleaner', category: 'sanitation', stock: 20, minThreshold: 5, unit: 'L', costPerUnit: 4, supplierName: 'BioSup' },
    ] as InventoryItem[];
    const order = createReorderPurchaseOrder(items, { supplierName: 'BioSup', createdBy: 'ana', orderDate: '2026-08-13', id: '1234' });
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ inventoryItemId: 'yeast', quantity: 9 });
    expect(purchaseOrderTotal(order)).toBe(180);
  });

  it('builds downstream recall exposure and excludes reversed dispatches', () => {
    const lot = { id: 'LOT-1', name: 'Saperavi', variety: 'Saperavi', currentVolume: 500 } as WineLot;
    const trace = buildRecallTrace({
      lotId: lot.id, lots: [lot], grapeIntakes: [], harvests: [], vessels: [], bottlingRuns: [], cellarOps: [], transfers: [],
      storageLocations: [], stockMovements: [], salesOrders: [],
      salesDispatches: [
        { id: 'd1', lotId: lot.id, customerName: 'Customer A', bottles: 24, recordKind: 'dispatch' },
        { id: 'r1', lotId: lot.id, customerName: 'Customer A', bottles: -24, recordKind: 'reversal', reversalOfDispatchId: 'd1' },
        { id: 'd2', lotId: lot.id, customerName: 'Customer B', bottles: 12, recordKind: 'dispatch' },
      ] as any,
    });
    expect(trace?.affectedBottleCount).toBe(12);
    expect(trace?.affectedCustomers).toEqual(['Customer B']);
  });

  it('detects vessel overlap, bad date order, capacity, and missing dependencies', () => {
    const vessels = [{ id: 'T1', capacity: 1000, currentVolume: 900 }] as Vessel[];
    const plans: ProductionPlanItem[] = [
      { id: 'a', title: 'First', kind: 'transfer', status: 'planned', startDate: '2026-08-14', endDate: '2026-08-15', assignedTo: 'ana', vesselIds: ['T1'], quantityLiters: 200, notes: '', dependencyIds: ['gone'], createdAt: '', createdBy: 'ana' },
      { id: 'b', title: 'Second', kind: 'sanitation', status: 'planned', startDate: '2026-08-15', endDate: '2026-08-14', assignedTo: 'ana', vesselIds: ['T1'], notes: '', dependencyIds: [], createdAt: '', createdBy: 'ana' },
    ];
    expect(new Set(detectProductionPlanConflicts(plans, vessels).map(item => item.code))).toEqual(new Set(['date_order', 'vessel_overlap', 'vessel_capacity', 'missing_dependency']));
  });

  it('prioritizes overdue work in the unified queue', () => {
    const queue = buildTodayQueue({
      today: '2026-08-13',
      tasks: [{ id: 'task-1', title: 'Overdue', priority: 'low', dueDate: '2026-08-12', assignedTo: 'Ana', assignedUserId: 'ana', status: 'pending', description: '' }],
      sops: [sop({ nextDueDate: '2026-08-13' })], purchaseOrders: [], productionPlans: [], approvals: [], currentUsername: 'ana',
    });
    expect(queue.map(item => item.source)).toEqual(['task', 'sop']);
    expect(queue[0].priority).toBe('critical');
  });
});

describe('scan to action parsing', () => {
  const vessels = ['T-01'];
  const lots = ['LOT-2026-01'];
  it('accepts QR URLs, typed prefixes, JSON payloads, and direct IDs', () => {
    expect(parseCellarScanValue('https://app.test/?tank=T-01&op=1', vessels, lots)).toEqual({ kind: 'vessel', id: 'T-01' });
    expect(parseCellarScanValue('lot:LOT-2026-01', vessels, lots)).toEqual({ kind: 'lot', id: 'LOT-2026-01' });
    expect(parseCellarScanValue('{"vesselId":"T-01"}', vessels, lots)).toEqual({ kind: 'vessel', id: 'T-01' });
    expect(parseCellarScanValue('lot-2026-01', vessels, lots)).toEqual({ kind: 'lot', id: 'LOT-2026-01' });
    expect(parseCellarScanValue('UNKNOWN', vessels, lots)).toBeNull();
  });
});
