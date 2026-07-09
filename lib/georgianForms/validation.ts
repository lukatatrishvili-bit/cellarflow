/**
 * Pre-export validation. Produces non-blocking warnings (and a few errors) the
 * UI shows before generating a FILLED document. Blank forms are never blocked.
 */

import type { FormTemplate, DocRow, ValidationWarning, ExportContext } from './types';
import { findNegativeBalances, toNum } from './balance';

/** Columns that, if a template has them, must not be empty in a filled row. */
const REQUIRED_BY_KEY: Record<string, { ka: string; en: string }> = {
  date: { ka: 'თარიღი', en: 'date' },
  placeDate: { ka: 'ჩაყენების თარიღი', en: 'placement date' },
  parcelCadastral: { ka: 'საკადასტრო კოდი', en: 'cadastral code' },
  municipality: { ka: 'მუნიციპალიტეტი', en: 'municipality' },
  village: { ka: 'სოფელი', en: 'village' },
  variety: { ka: 'ვაზის ჯიში', en: 'grape variety' },
  transport: { ka: 'ტრანსპორტი', en: 'transport name/number' },
  analysisNo: { ka: 'ანალიზის ნომერი', en: 'analysis number' },
  netto: { ka: 'ნეტო წონა', en: 'net weight' },
  tons: { ka: 'ყურძნის რაოდენობა', en: 'grape quantity' },
  fillQty: { ka: 'ჩამოსხმის რაოდენობა', en: 'bottled quantity' },
};

export function validateDocument(
  template: FormTemplate,
  rows: DocRow[],
  ctx: ExportContext,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  if (ctx.mode === 'blank') return warnings;

  // Date range sanity.
  if (template.filters.includes('dateRange')) {
    if (!ctx.dateRange.from || !ctx.dateRange.to) {
      warnings.push({ level: 'warning', messageKa: 'თარიღის პერიოდი არ არის მითითებული.', messageEn: 'Date range is not set.' });
    } else if (ctx.dateRange.from > ctx.dateRange.to) {
      warnings.push({ level: 'error', messageKa: 'პერიოდის დასაწყისი მოგვიანებითაა, ვიდრე დასასრული.', messageEn: 'Date range start is after end.' });
    }
  }

  if (rows.length === 0) {
    warnings.push({
      level: 'warning',
      messageKa: 'მონაცემები ვერ მოიძებნა მითითებული ფილტრებით — დოკუმენტი ცარიელია.',
      messageEn: 'No data found for the chosen filters — the document will be empty.',
    });
    return warnings;
  }

  for (const field of template.headerFields) {
    const source = field.source;
    const label = ctx.lang === 'ka' ? field.labelKa : (field.labelEn || field.labelKa);
    const value =
      source === 'companyName' ? ctx.company.companyName :
      source === 'wineryName' ? (ctx.company.wineryName || ctx.company.companyName) :
      source === 'legalAddress' ? (ctx.company.legalAddress || ctx.company.address) :
      source === 'factualAddress' ? (ctx.company.factualAddress || ctx.company.address) :
      source === 'idCode' ? ctx.company.identificationCode :
      source === 'region' ? (ctx.company.region || ctx.company.country) :
      source === 'accountingYear' ? ctx.accountingYear :
      source === 'dateRange' ? (ctx.dateRange.from && ctx.dateRange.to ? 'set' : '') :
      source === 'product' ? ctx.productName :
      'manual';
    if (source !== 'input' && source !== 'product' && !value) {
      warnings.push({
        level: source === 'idCode' || source === 'legalAddress' ? 'warning' : 'warning',
        messageKa: `ზედა ველი აკლია: ${field.labelKa}.`,
        messageEn: `Header field missing: ${label}.`,
      });
    }
  }

  // Per-row required-field checks for the columns this template actually has.
  const presentKeys = new Set(template.columns.map(c => c.key));
  rows.forEach((row, i) => {
    for (const key of Object.keys(REQUIRED_BY_KEY)) {
      if (!presentKeys.has(key)) continue;
      const v = row[key];
      const missing = v === undefined || v === '' || v === null;
      const zeroNumeric = REQUIRED_BY_KEY[key] && ['netto', 'tons', 'fillQty'].includes(key) && toNum(v) === 0;
      if (missing || zeroNumeric) {
        const label = REQUIRED_BY_KEY[key];
        warnings.push({
          level: 'warning',
          rowIndex: i,
          messageKa: `სტრიქონი ${i + 1}: არ არის შევსებული — ${label.ka}.`,
          messageEn: `Row ${i + 1}: missing ${label.en}.`,
        });
      }
    }
  });

  // Movement journals: outgoing must never drive the balance negative.
  if (template.hasRunningBalance) {
    const bad = findNegativeBalances(rows, { incoming: 'incoming', outgoing: 'outgoing', balance: 'balance' });
    for (const i of bad) {
      warnings.push({
        level: 'error',
        rowIndex: i,
        messageKa: `სტრიქონი ${i + 1}: გასავალი აღემატება ხელმისაწვდომ ნაშთს (უარყოფითი ბალანსი).`,
        messageEn: `Row ${i + 1}: outgoing exceeds available balance (negative balance).`,
      });
    }
  }

  // Forms with no app data source — tell the user it's a structural/blank export.
  if (!template.dataSource) {
    warnings.push({
      level: 'warning',
      messageKa: 'ამ ფორმის მონაცემები აპლიკაციაში ჯერ არ აღირიცხება — შესაძლებელია მხოლოდ ცარიელი ფორმის ან ხელით შევსების ექსპორტი.',
      messageEn: 'This form has no app data source yet — export as a blank/printable form and fill manually.',
    });
  }

  return warnings;
}
