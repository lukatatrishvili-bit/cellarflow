import { describe, it, expect } from 'vitest';
import { computeAlerts, molecularSO2, Alert } from '../lib/alerts';

const TODAY = '2026-06-11';

const baseInputs = () => ({
  vessels: [] as any[],
  lots: [] as any[],
  fermLogs: [] as any[],
  labLogs: [] as any[],
  inventory: [] as any[],
  tasks: [] as any[],
  today: TODAY,
});

const lab = (fields: Record<string, any>) =>
  ({ id: 'lab1', lotId: 'L1', tankId: 'T1', date: '2026-06-10', volatileAcid: 0.3, freeSo2: 35, ph: 3.3, ...fields }) as any;

describe('molecularSO2', () => {
  it('computes the bisulfite equilibrium (pKa 1.81)', () => {
    // 25 mg/L free at pH 3.4 → 25 / (1 + 10^1.59) ≈ 0.63 mg/L molecular
    expect(molecularSO2(25, 3.4)).toBeCloseTo(0.63, 2);
  });

  it('drops as pH rises for the same free SO2', () => {
    expect(molecularSO2(30, 3.6)).toBeLessThan(molecularSO2(30, 3.2));
  });
});

describe('computeAlerts', () => {
  it('returns nothing for a healthy cellar', () => {
    expect(computeAlerts(baseInputs())).toEqual([]);
  });

  it('flags low molecular SO2, critical below 0.35 mg/L', () => {
    const warning = computeAlerts({ ...baseInputs(), labLogs: [lab({ freeSo2: 25, ph: 3.6 })] }); // ≈0.40
    expect(warning).toHaveLength(1);
    expect(warning[0]).toMatchObject({ category: 'so2', severity: 'warning', relatedLotId: 'L1' });

    const critical = computeAlerts({ ...baseInputs(), labLogs: [lab({ freeSo2: 10, ph: 3.6 })] }); // ≈0.16
    expect(critical[0]).toMatchObject({ category: 'so2', severity: 'critical' });
  });

  it('flags volatile acidity above 0.8 g/L, critical above 1.2', () => {
    const warning = computeAlerts({ ...baseInputs(), labLogs: [lab({ volatileAcid: 0.9 })] });
    expect(warning.find((a) => a.category === 'va')?.severity).toBe('warning');

    const critical = computeAlerts({ ...baseInputs(), labLogs: [lab({ volatileAcid: 1.3 })] });
    expect(critical.find((a) => a.category === 'va')?.severity).toBe('critical');
  });

  it('only evaluates the latest lab analysis per lot', () => {
    const alerts = computeAlerts({
      ...baseInputs(),
      labLogs: [
        lab({ id: 'old', date: '2026-06-01', volatileAcid: 1.5 }), // bad but superseded
        lab({ id: 'new', date: '2026-06-10', volatileAcid: 0.3 }),
      ],
    });
    expect(alerts.filter((a) => a.category === 'va')).toEqual([]);
  });

  it('detects stuck fermentation when density stops dropping', () => {
    const alerts = computeAlerts({
      ...baseInputs(),
      lots: [{ id: 'L1', name: 'Saperavi', stage: 'fermenting' } as any],
      fermLogs: [
        { id: 'f1', lotId: 'L1', tankId: 'T1', date: '2026-06-09', density: 1.061, sugar: 150 } as any,
        { id: 'f2', lotId: 'L1', tankId: 'T1', date: '2026-06-10', density: 1.0605, sugar: 148 } as any,
      ],
    });
    expect(alerts[0]).toMatchObject({ category: 'fermentation', severity: 'critical', relatedLotId: 'L1' });
  });

  it('flags overdue tasks as critical and due-today as warning, skipping completed ones', () => {
    const alerts = computeAlerts({
      ...baseInputs(),
      tasks: [
        { id: 't1', title: 'Rack T1', status: 'pending', dueDate: '2026-06-01', assignedTo: 'Nino' } as any,
        { id: 't2', title: 'CIP T2', status: 'pending', dueDate: TODAY, assignedTo: 'Luka' } as any,
        { id: 't3', title: 'Done', status: 'completed', dueDate: '2026-06-01', assignedTo: 'Luka' } as any,
      ],
    });
    expect(alerts.map((a) => [a.id, a.severity])).toEqual([
      ['task-t1', 'critical'],
      ['task-t2', 'warning'],
    ]);
  });

  it('sorts results critical first', () => {
    const alerts = computeAlerts({
      ...baseInputs(),
      inventory: [
        { id: 'i1', name: 'SO2', stock: 2, minThreshold: 5, unit: 'kg', supplierName: 'Enartis' } as any, // warning
        { id: 'i2', name: 'Yeast', stock: 0, minThreshold: 3, unit: 'kg', supplierName: 'Lallemand' } as any, // critical
      ],
    });
    const severities = alerts.map((a: Alert) => a.severity);
    expect(severities).toEqual([...severities].sort((a, b) => (a === 'critical' ? -1 : 1)));
    expect(severities[0]).toBe('critical');
  });
});
