/**
 * Cost & margin report — pure row builder + CSV serializer (no I/O), so it's
 * unit-testable and reusable by any exporter. The XLSX writer lives in
 * reportXlsx.ts (lazy ExcelJS) to keep this file dependency-free.
 */

import type { LotCostSummary } from './types';
import { marginPct, valuation, grossProfit } from './engine';

export interface CostReportRow {
  lotId: string;
  lotName: string;
  totalCost: number;
  perLitre: number | null;
  perBottle: number | null;
  bottles: number;
  pricePerBottle: number | null;
  marginPct: number | null;
  grossProfit: number;     // (price − cost) × bottles
  inventoryValue: number;  // bottles × cost/bottle
  revenue: number;         // bottles × price
}

export interface CostReportLotInput {
  lotId: string;
  lotName: string;
  bottles: number;
  pricePerBottle?: number;
}

/** Build report rows by joining cost summaries with bottle counts and prices. */
export function buildCostReportRows(
  lots: CostReportLotInput[],
  summaries: Map<string, LotCostSummary>,
): CostReportRow[] {
  return lots.map((l) => {
    const s = summaries.get(l.lotId);
    const total = s?.total ?? 0;
    const perBottle = s?.perBottle ?? null;
    const price = l.pricePerBottle && l.pricePerBottle > 0 ? l.pricePerBottle : null;
    return {
      lotId: l.lotId,
      lotName: l.lotName,
      totalCost: total,
      perLitre: s?.perLitre ?? null,
      perBottle,
      bottles: l.bottles,
      pricePerBottle: price,
      marginPct: price != null && perBottle != null ? marginPct(price, perBottle) : null,
      grossProfit: price != null && perBottle != null ? grossProfit(price, perBottle, l.bottles) : 0,
      inventoryValue: perBottle != null ? valuation(l.bottles, perBottle) : 0,
      revenue: price != null ? valuation(l.bottles, price) : 0,
    };
  });
}

export interface CostReportTotals {
  totalCost: number;
  inventoryValue: number;
  revenue: number;
  grossProfit: number;
}

export function sumCostReport(rows: CostReportRow[]): CostReportTotals {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    totalCost: r2(rows.reduce((a, x) => a + x.totalCost, 0)),
    inventoryValue: r2(rows.reduce((a, x) => a + x.inventoryValue, 0)),
    revenue: r2(rows.reduce((a, x) => a + x.revenue, 0)),
    grossProfit: r2(rows.reduce((a, x) => a + x.grossProfit, 0)),
  };
}

function csvCell(v: string | number | null): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Unicode-safe CSV (BOM prefixed so Excel reads Georgian correctly). */
export function costRowsToCSV(rows: CostReportRow[], currency: string): string {
  const header = ['Lot', 'Lot ID', 'Total cost', 'Cost/L', 'Cost/bottle', 'Bottles', 'Price/bottle', 'Margin %', 'Gross profit', `Inventory value (${currency})`, `Revenue (${currency})`];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      csvCell(r.lotName), csvCell(r.lotId), csvCell(r.totalCost), csvCell(r.perLitre), csvCell(r.perBottle),
      csvCell(r.bottles), csvCell(r.pricePerBottle), csvCell(r.marginPct), csvCell(r.grossProfit),
      csvCell(r.inventoryValue), csvCell(r.revenue),
    ].join(','));
  }
  return '﻿' + lines.join('\r\n');
}
