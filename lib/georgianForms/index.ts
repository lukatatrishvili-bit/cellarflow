/**
 * Public API for the official Georgian traceability document engine.
 *
 *   listForms()                       → all 20 annex templates
 *   buildDocument(id, ctx)            → RenderedDocument (filled or blank)
 *   buildFilename(template, ctx, ext) → Unicode-safe download filename
 *
 * Renderers (renderHtml, renderXlsx) consume RenderedDocument and are imported
 * lazily by the UI so ExcelJS stays out of the main bundle.
 */

import type {
  FormTemplate, ExportContext, RenderedDocument, DocRow, HeaderFieldDef,
} from './types';
import { FORM_TEMPLATES, getTemplate } from './templates';
import { mapRows } from './mappers';
import { validateDocument } from './validation';
import { toNum, round2 } from './balance';

export * from './types';
export { FORM_TEMPLATES, getTemplate } from './templates';

export function listForms(): FormTemplate[] {
  return [...FORM_TEMPLATES].sort((a, b) => a.annexNumber - b.annexNumber);
}

function resolveHeaderValue(field: HeaderFieldDef, ctx: ExportContext): string {
  const c = ctx.company;
  switch (field.source) {
    case 'companyName': return c.companyName || '';
    case 'wineryName': return c.wineryName || c.companyName || '';
    case 'legalAddress': return c.legalAddress || c.address || '';
    case 'factualAddress': return c.factualAddress || c.address || '';
    case 'idCode': return c.identificationCode || '';
    case 'region': return [c.region, c.country].filter(Boolean).join(', ');
    case 'accountingYear': return ctx.accountingYear || String(new Date(ctx.dateRange.to || Date.now()).getFullYear());
    case 'dateRange': return ctx.dateRange.from && ctx.dateRange.to ? `${ctx.dateRange.from} — ${ctx.dateRange.to}` : '';
    case 'product': return ctx.productName || '';
    case 'input': return '';
    default: return '';
  }
}

/** Pad a filled document up to a minimum row count, or build N blank rows. */
function padRows(template: FormTemplate, rows: DocRow[], count: number): DocRow[] {
  const blank: DocRow = {};
  for (const col of template.columns) blank[col.key] = '';
  const out = [...rows];
  while (out.length < count) out.push({ ...blank });
  return out;
}

function computeTotals(template: FormTemplate, rows: DocRow[]): DocRow | null {
  if (!template.totals.length) return null;
  const totalsRow: DocRow = {};
  for (const key of template.totals) {
    const sum = rows.reduce((acc, r) => acc + toNum(r[key]), 0);
    totalsRow[key] = round2(sum);
  }
  return totalsRow;
}

export function buildDocument(templateId: string, ctx: ExportContext): RenderedDocument {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Unknown form template: ${templateId}`);

  const headerFields = template.headerFields.map(f => ({
    label: ctx.lang === 'ka' ? f.labelKa : (f.labelEn || f.labelKa),
    value: resolveHeaderValue(f, ctx),
  }));

  let rows: DocRow[];
  if (ctx.mode === 'blank') {
    rows = padRows(template, [], Math.max(1, ctx.blankRows || 12));
  } else {
    rows = mapRows(template, ctx);
  }

  const warnings = validateDocument(template, ctx.mode === 'blank' ? [] : rows, ctx);
  const totalsRow = ctx.mode === 'blank' ? null : computeTotals(template, rows);

  return {
    template,
    titleKa: template.titleKa,
    headerFields,
    columns: template.columns,
    rows,
    totalsRow,
    warnings,
    meta: {
      company: ctx.company,
      dateRange: ctx.dateRange,
      generatedAt: new Date().toISOString(),
      generatedBy: ctx.generatedBy,
      mode: ctx.mode,
    },
  };
}

/**
 * Unicode-safe filename. Keeps the annex number + ASCII slug + date span so the
 * file is sortable and portable even when the OS mangles Georgian characters,
 * e.g. annex_04_wine_movement_journal_2026-06-01_2026-06-30.pdf
 */
export function buildFilename(template: FormTemplate, ctx: ExportContext, ext: string): string {
  const n = String(template.annexNumber).padStart(2, '0');
  const span = template.filters.includes('dateRange') && ctx.dateRange.from
    ? `_${ctx.dateRange.from}_${ctx.dateRange.to}`
    : (ctx.accountingYear ? `_${ctx.accountingYear}` : '');
  const mode = ctx.mode === 'blank' ? '_blank' : '';
  return `annex_${n}_${template.filenameSlug}${span}${mode}.${ext}`;
}
