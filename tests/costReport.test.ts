import { describe, it, expect } from 'vitest';
import { buildCostReportRows, sumCostReport, costRowsToCSV } from '../lib/costing/report';
import { rollupLots, type CostEntry } from '../lib/costing';

const E = (over: Partial<CostEntry>): CostEntry => ({
  id: Math.random().toString(36).slice(2), date: '2026-10-01', lotId: 'L1',
  category: 'other', description: '', amount: 0, currency: 'GEL', ...over,
});

describe('cost & margin report', () => {
  // L1: total 3000, 1500 L, 2000 bottles → cost/bottle 1.5; price 5 → margin 70%
  const summaries = rollupLots(
    [{ id: 'L1', volumeLitres: 1500 }],
    [E({ category: 'grape', amount: 2000 }), E({ category: 'packaging', amount: 1000 })],
    { L1: 2000 },
  );
  const rows = buildCostReportRows(
    [{ lotId: 'L1', lotName: 'Saperavi', bottles: 2000, pricePerBottle: 5 }],
    summaries,
  );

  it('computes per-bottle, margin, profit, valuation and revenue', () => {
    const r = rows[0];
    expect(r.perBottle).toBe(1.5);
    expect(r.marginPct).toBe(70);          // (5−1.5)/5
    expect(r.grossProfit).toBe(7000);      // (5−1.5)×2000
    expect(r.inventoryValue).toBe(3000);   // 2000×1.5
    expect(r.revenue).toBe(10000);         // 2000×5
  });

  it('leaves margin/profit null/zero when no price is set', () => {
    const noPrice = buildCostReportRows([{ lotId: 'L1', lotName: 'Saperavi', bottles: 2000 }], summaries);
    expect(noPrice[0].marginPct).toBeNull();
    expect(noPrice[0].grossProfit).toBe(0);
    expect(noPrice[0].revenue).toBe(0);
  });

  it('sums totals across lots', () => {
    const t = sumCostReport(rows);
    expect(t.totalCost).toBe(3000);
    expect(t.inventoryValue).toBe(3000);
    expect(t.revenue).toBe(10000);
    expect(t.grossProfit).toBe(7000);
  });

  it('CSV has a BOM, header, and escapes commas', () => {
    const csv = costRowsToCSV(
      buildCostReportRows([{ lotId: 'L1', lotName: 'Red, Reserve', bottles: 10 }], summaries),
      'GEL',
    );
    expect(csv.charCodeAt(0)).toBe(0xFEFF);          // BOM
    expect(csv).toContain('Margin %');
    expect(csv).toContain('"Red, Reserve"');          // comma-escaped
  });
});
