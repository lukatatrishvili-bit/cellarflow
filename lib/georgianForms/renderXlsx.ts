/**
 * Renders a RenderedDocument to a real .xlsx workbook (ExcelJS).
 *
 * Imported lazily by the UI so ExcelJS stays out of the main bundle. Handles
 * Georgian (UTF-8) text, two-level merged headers, totals, column widths and a
 * signature line.
 */

import type { RenderedDocument, ColumnDef, Language } from './types';

function header(c: ColumnDef, lang: Language): string {
  return lang === 'ka' ? c.headerKa : (c.headerEn || c.headerKa);
}
function groupHeader(c: ColumnDef, lang: Language): string | undefined {
  if (!c.group) return undefined;
  return lang === 'ka' ? c.group : (c.groupEn || c.group);
}

export async function renderDocumentXlsx(doc: RenderedDocument): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const lang: Language = 'ka';
  const t = doc.template;
  const cols = doc.columns;
  const n = cols.length;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'VinOS';
  wb.created = new Date();
  const ws = wb.addWorksheet(`დანართი ${t.annexNumber}`, {
    pageSetup: {
      orientation: t.orientation,
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  const lastCol = (c: number) => ws.getColumn(c).letter;
  const mergeRow = (row: number) => ws.mergeCells(`A${row}:${lastCol(n)}${row}`);

  let r = 1;

  // Title
  ws.getCell(`A${r}`).value = `დანართი №${t.annexNumber} — ${t.titleKa}`;
  ws.getCell(`A${r}`).font = { bold: true, size: 13, name: 'Sylfaen' };
  ws.getCell(`A${r}`).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  mergeRow(r); ws.getRow(r).height = 28; r++;

  // Company line
  const companyLine = [doc.meta.company.companyName, doc.meta.company.wineryName].filter(Boolean).join(' · ');
  if (companyLine) {
    ws.getCell(`A${r}`).value = companyLine;
    ws.getCell(`A${r}`).alignment = { horizontal: 'center' };
    ws.getCell(`A${r}`).font = { size: 10, color: { argb: 'FF6B625A' }, name: 'Sylfaen' };
    mergeRow(r); r++;
  }

  // Header fields (label: value), one per row, left aligned.
  for (const hf of doc.headerFields) {
    ws.getCell(`A${r}`).value = `${hf.label}: ${hf.value || ''}`;
    ws.getCell(`A${r}`).font = { size: 10, name: 'Sylfaen' };
    mergeRow(r); r++;
  }
  r++; // spacer

  // Table header(s)
  const hasGroups = cols.some(c => c.group);
  const headerStyle = (cell: any) => {
    cell.font = { bold: true, size: 10, name: 'Sylfaen' };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1E7DA' } };
    cell.border = thin();
  };

  if (hasGroups) {
    const topRow = r, subRow = r + 1;
    let ci = 0;
    while (ci < n) {
      const col = cols[ci];
      const g = groupHeader(col, lang);
      const colLetterStart = ws.getColumn(ci + 1).letter;
      if (!g) {
        ws.mergeCells(`${colLetterStart}${topRow}:${colLetterStart}${subRow}`);
        const cell = ws.getCell(`${colLetterStart}${topRow}`);
        cell.value = header(col, lang); headerStyle(cell);
        ci++;
      } else {
        let span = 1;
        while (ci + span < n && groupHeader(cols[ci + span], lang) === g) span++;
        const colLetterEnd = ws.getColumn(ci + span).letter;
        ws.mergeCells(`${colLetterStart}${topRow}:${colLetterEnd}${topRow}`);
        const top = ws.getCell(`${colLetterStart}${topRow}`);
        top.value = g; headerStyle(top);
        for (let k = 0; k < span; k++) {
          const cell = ws.getCell(`${ws.getColumn(ci + 1 + k).letter}${subRow}`);
          cell.value = header(cols[ci + k], lang); headerStyle(cell);
        }
        ci += span;
      }
    }
    r += 2;
  } else {
    cols.forEach((col, idx) => {
      const cell = ws.getCell(`${ws.getColumn(idx + 1).letter}${r}`);
      cell.value = header(col, lang); headerStyle(cell);
    });
    r++;
  }

  // Data rows
  for (const row of doc.rows) {
    cols.forEach((col, idx) => {
      const cell = ws.getCell(`${ws.getColumn(idx + 1).letter}${r}`);
      const v = row[col.key];
      cell.value = v === '' || v == null ? null : (col.numeric && typeof v === 'number' ? v : v);
      cell.alignment = { horizontal: col.numeric ? 'right' : 'left', vertical: 'top', wrapText: true };
      cell.font = { size: 9, name: 'Sylfaen' };
      cell.border = thin();
    });
    r++;
  }

  // Totals row
  if (doc.totalsRow) {
    cols.forEach((col, idx) => {
      const cell = ws.getCell(`${ws.getColumn(idx + 1).letter}${r}`);
      if (idx === 0) cell.value = 'სულ';
      else if (col.key in doc.totalsRow!) cell.value = doc.totalsRow![col.key] as number;
      cell.font = { bold: true, size: 9, name: 'Sylfaen' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9DDCD' } };
      cell.alignment = { horizontal: idx === 0 ? 'right' : 'right' };
      cell.border = thin();
    });
    r++;
  }

  // Signature + meta
  r++;
  ws.getCell(`A${r}`).value = `${t.signatureLabelKa} ____________________`;
  ws.getCell(`A${r}`).font = { size: 10, name: 'Sylfaen' };
  r++;
  ws.getCell(`A${r}`).value = `დანართი №${t.annexNumber} · v${t.version} · ${new Date(doc.meta.generatedAt).toLocaleString('ka-GE')}${doc.meta.mode === 'blank' ? ' · ცარიელი ფორმა' : ''}`;
  ws.getCell(`A${r}`).font = { size: 8, italic: true, color: { argb: 'FF9A9087' }, name: 'Sylfaen' };

  // Column widths
  cols.forEach((col, idx) => {
    ws.getColumn(idx + 1).width = col.width || Math.min(28, Math.max(10, header(col, lang).length * 0.9));
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function thin() {
  const s = { style: 'thin' as const, color: { argb: 'FF8A7D72' } };
  return { top: s, left: s, bottom: s, right: s };
}
