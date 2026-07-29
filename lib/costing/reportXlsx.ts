/**
 * Cost & margin report → .xlsx (ExcelJS, lazy-imported so it stays out of the
 * main bundle). Shares the CostReportRow shape with report.ts.
 */

import type { CostReportRow } from './report';
import { sumCostReport } from './report';

export async function renderCostReportXlsx(
  rows: CostReportRow[],
  meta: { company: string; currency: string; generatedAt: string },
): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VinOS';
  const ws = wb.addWorksheet('Cost & Margin', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.mergeCells('A1:K1');
  ws.getCell('A1').value = `Cost & Margin Report — ${meta.company}`;
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.mergeCells('A2:K2');
  ws.getCell('A2').value = `Currency: ${meta.currency} · Generated ${meta.generatedAt}`;
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF6B625A' } };

  const headers = ['Lot', 'Lot ID', 'Total cost', 'Cost/L', 'Cost/bottle', 'Bottles', 'Price/bottle', 'Margin %', 'Gross profit', 'Inventory value', 'Revenue'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((c) => {
    c.font = { bold: true, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1E7DA' } };
    c.alignment = { horizontal: 'center', wrapText: true };
  });

  for (const r of rows) {
    ws.addRow([
      r.lotName, r.lotId, r.totalCost, r.perLitre, r.perBottle, r.bottles,
      r.pricePerBottle, r.marginPct, r.grossProfit, r.inventoryValue, r.revenue,
    ]);
  }

  const t = sumCostReport(rows);
  const totalRow = ws.addRow(['TOTAL', '', t.totalCost, '', '', '', '', '', t.grossProfit, t.inventoryValue, t.revenue]);
  totalRow.eachCell((c) => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9DDCD' } }; });

  ws.columns.forEach((c, i) => { c.width = i < 2 ? 24 : 13; });

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
