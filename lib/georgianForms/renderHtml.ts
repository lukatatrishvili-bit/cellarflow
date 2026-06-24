/**
 * Renders a RenderedDocument to a self-contained, print-ready HTML string used
 * both for the on-screen preview (iframe srcDoc) and the PDF (window.print()).
 *
 * Mirrors the existing lotPassport.ts approach: one HTML string with embedded
 * @page / print CSS, A4, orientation per template, Georgian web font, two-level
 * table headers, totals row and signature lines.
 */

import type { RenderedDocument, ColumnDef, Language } from './types';

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function header(c: ColumnDef, lang: Language): string {
  return lang === 'ka' ? c.headerKa : (c.headerEn || c.headerKa);
}
function groupHeader(c: ColumnDef, lang: Language): string | undefined {
  if (!c.group) return undefined;
  return lang === 'ka' ? c.group : (c.groupEn || c.group);
}

/** Build a possibly two-row <thead> honouring `group` spans. */
function buildThead(columns: ColumnDef[], lang: Language): string {
  const hasGroups = columns.some(c => c.group);
  if (!hasGroups) {
    return `<tr>${columns.map(c => `<th>${esc(header(c, lang))}</th>`).join('')}</tr>`;
  }
  // Top row: ungrouped cols span both rows; grouped cols collapse into one cell.
  const top: string[] = [];
  const bottom: string[] = [];
  let i = 0;
  while (i < columns.length) {
    const col = columns[i];
    const g = groupHeader(col, lang);
    if (!g) {
      top.push(`<th rowspan="2">${esc(header(col, lang))}</th>`);
      i++;
    } else {
      let span = 1;
      while (i + span < columns.length && groupHeader(columns[i + span], lang) === g) span++;
      top.push(`<th colspan="${span}">${esc(g)}</th>`);
      for (let k = 0; k < span; k++) bottom.push(`<th>${esc(header(columns[i + k], lang))}</th>`);
      i += span;
    }
  }
  return `<tr>${top.join('')}</tr><tr>${bottom.join('')}</tr>`;
}

export function renderDocumentHtml(doc: RenderedDocument): string {
  const lang: Language = 'ka'; // official forms are Georgian
  const t = doc.template;
  const landscape = t.orientation === 'landscape';
  const cols = doc.columns;

  const headerFieldsHtml = doc.headerFields
    .map(f => `<div class="hf"><span class="hf-k">${esc(f.label)}:</span> <span class="hf-v">${esc(f.value) || '&nbsp;'}</span></div>`)
    .join('');

  const bodyRows = doc.rows.map((row, ri) => {
    const tds = cols.map(c => {
      const v = row[c.key];
      const cls = c.numeric ? ' class="num"' : '';
      return `<td${cls}>${v === '' || v == null ? '' : esc(v)}</td>`;
    }).join('');
    return `<tr${ri % 2 ? ' class="alt"' : ''}>${tds}</tr>`;
  }).join('');

  const totalsHtml = doc.totalsRow ? `<tr class="totals">${cols.map((c, idx) => {
    if (idx === 0) return `<td class="tlabel">${lang === 'ka' ? 'სულ' : 'Total'}</td>`;
    const v = doc.totalsRow![c.key];
    return `<td class="num">${v == null ? '' : esc(v)}</td>`;
  }).join('')}</tr>` : '';

  const emptyNote = doc.rows.length === 0
    ? `<tr><td class="empty" colspan="${cols.length}">${lang === 'ka' ? 'მონაცემები არ მოიძებნა' : 'No data'}</td></tr>`
    : '';

  const company = doc.meta.company;
  const generated = new Date(doc.meta.generatedAt).toLocaleString('ka-GE');

  return `<!DOCTYPE html>
<html lang="ka"><head><meta charset="utf-8" />
<title>დანართი №${t.annexNumber} — ${esc(t.titleKa)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Georgian:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans Georgian', 'Sylfaen', 'BPG', sans-serif; color: #1c1816; margin: 0; padding: 18px 20px; font-size: 11px; }
  .annex { text-align: right; font-size: 11px; font-weight: 700; margin-bottom: 2px; }
  .title { text-align: center; font-size: 15px; font-weight: 700; margin: 4px 0 2px; }
  .subtitle { text-align: center; font-size: 10px; color: #6b625a; margin-bottom: 10px; }
  .company { font-size: 10px; color: #3a332e; margin-bottom: 8px; line-height: 1.5; }
  .hfs { margin: 8px 0 10px; display: flex; flex-wrap: wrap; gap: 4px 22px; }
  .hf-k { font-weight: 600; }
  .hf-v { border-bottom: 1px solid #c9beb3; min-width: 120px; display: inline-block; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border: 1px solid #8a7d72; padding: 4px 5px; vertical-align: middle; }
  th { background: #f1e7da; font-weight: 700; text-align: center; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.alt td { background: #faf7f3; }
  tr.totals td { background: #e9ddcd; font-weight: 700; }
  td.tlabel { text-align: right; font-weight: 700; }
  td.empty { text-align: center; color: #9a9087; font-style: italic; padding: 16px; }
  .foot { margin-top: 26px; display: flex; justify-content: space-between; align-items: flex-end; }
  .sig { font-size: 11px; }
  .sig .line { display: inline-block; width: 220px; border-bottom: 1px solid #1c1816; height: 26px; vertical-align: bottom; }
  .meta { font-size: 8px; color: #9a9087; text-align: right; }
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
  @media print { body { padding: 0; } thead { display: table-header-group; } tr { page-break-inside: avoid; } }
</style></head>
<body>
  <div class="annex">დანართი №${t.annexNumber}</div>
  <div class="title">${esc(t.titleKa)}</div>
  <div class="subtitle">${esc(company.companyName || '')}${company.wineryName ? ' · ' + esc(company.wineryName) : ''}</div>
  ${headerFieldsHtml ? `<div class="hfs">${headerFieldsHtml}</div>` : ''}
  <table>
    <thead>${buildThead(cols, lang)}</thead>
    <tbody>${bodyRows}${emptyNote}${totalsHtml}</tbody>
  </table>
  <div class="foot">
    <div class="sig">${esc(t.signatureLabelKa)} <span class="line"></span></div>
    <div class="meta">დანართი №${t.annexNumber} · v${esc(t.version)} · ${esc(generated)}${doc.meta.mode === 'blank' ? ' · ცარიელი ფორმა' : ''}</div>
  </div>
</body></html>`;
}
