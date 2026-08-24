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
  community: { ka: 'თემი', en: 'community' },
  village: { ka: 'სოფელი', en: 'village' },
  parcelName: { ka: 'ნაკვეთის დასახელება', en: 'parcel name' },
  variety: { ka: 'ვაზის ჯიში', en: 'grape variety' },
  areaSqm: { ka: 'ვენახის ფართობი', en: 'vineyard area' },
  areaHa: { ka: 'მოკრეფილი ფართობი', en: 'harvested area' },
  yieldPerHa: { ka: 'საშუალო მოსავალი ჰექტარზე', en: 'yield per hectare' },
  plantingYear: { ka: 'გაშენების წელი', en: 'planting year' },
  rootstock: { ka: 'საძირე', en: 'rootstock' },
  rowDistance: { ka: 'მანძილი რიგთა შორის', en: 'row spacing' },
  vineDistance: { ka: 'მანძილი ვაზთა შორის', en: 'vine spacing' },
  irrigation: { ka: 'რწყვის არსებობა', en: 'irrigation status' },
  condition: { ka: 'ვენახის მდგომარეობა', en: 'vineyard condition' },
  supplier: { ka: 'მომწოდებელი', en: 'supplier' },
  location: { ka: 'ვენახის ადგილმდებარეობა', en: 'vineyard location' },
  transport: { ka: 'ტრანსპორტი', en: 'transport name/number' },
  brutto: { ka: 'ბრუტო წონა', en: 'gross weight' },
  tara: { ka: 'ტარა', en: 'tare weight' },
  analysisNo: { ka: 'ანალიზის ნომერი', en: 'analysis number' },
  netto: { ka: 'ნეტო წონა', en: 'net weight' },
  sugar: { ka: 'შაქრიანობა', en: 'sugar measurement' },
  tons: { ka: 'ყურძნის რაოდენობა', en: 'grape quantity' },
  vesselNo: { ka: 'ჭურჭლის ნომერი', en: 'vessel number' },
  placeQty: { ka: 'ჩაყენებული რაოდენობა', en: 'placed quantity' },
  placeAlc: { ka: 'სპირტშემცველობა', en: 'alcohol measurement' },
  placeSugar: { ka: 'შაქრიანობა', en: 'sugar measurement' },
  placeAcid: { ka: 'ტიტრული მჟავიანობა', en: 'titratable acidity' },
  material: { ka: 'მასალის დასახელება', en: 'material/component name' },
  qty: { ka: 'რაოდენობა', en: 'quantity' },
  alc: { ka: 'სპირტშემცველობა', en: 'alcohol measurement' },
  wineNo: { ka: 'ღვინის ან კუპაჟის ნომერი', en: 'wine/blend number' },
  lotNo: { ka: 'ლოტის ნომერი', en: 'lot number' },
  inDate: { ka: 'წარმოებიდან შემოსვლის თარიღი', en: 'production receipt date' },
  inQty: { ka: 'წარმოებიდან შემოსული რაოდენობა', en: 'quantity received from production' },
  fillDate: { ka: 'ჩამოსხმის თარიღი', en: 'bottling date' },
  fillQty: { ka: 'ჩამოსხმის რაოდენობა', en: 'bottled quantity' },
  fromTo: { ka: 'საიდან / სად', en: 'from/to' },
  grapeTons: { ka: 'ყურძნის რაოდენობა', en: 'grape quantity' },
  avgSugar: { ka: 'საშუალო შაქარი', en: 'average sugar' },
  wineCategory: { ka: 'ღვინის კატეგორია', en: 'wine category' },
  wineTotal: { ka: 'ღვინის საერთო რაოდენობა', en: 'total wine quantity' },
  wineName: { ka: 'ღვინის დასახელება', en: 'wine name' },
  typeColor: { ka: 'ტიპი და ფერი', en: 'type and colour' },
  vintage: { ka: 'მოსავლის წელი', en: 'vintage' },
};

const POSITIVE_NUMERIC_KEYS = new Set([
  'areaSqm', 'areaHa', 'yieldPerHa', 'brutto', 'netto', 'tons', 'placeQty', 'qty',
  'inQty', 'fillQty', 'grapeTons', 'wineTotal',
]);

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
    if (source !== 'input' && !value) {
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
      const zeroNumeric = POSITIVE_NUMERIC_KEYS.has(key) && toNum(v) <= 0;
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

    if (presentKeys.has('incoming') && presentKeys.has('outgoing')
      && toNum(row.incoming) === 0 && toNum(row.outgoing) === 0) {
      warnings.push({
        level: 'warning',
        rowIndex: i,
        messageKa: `სტრიქონი ${i + 1}: შემოსავალი და გასავალი ორივე ნულია.`,
        messageEn: `Row ${i + 1}: both incoming and outgoing are zero.`,
      });
    }
    if (presentKeys.has('bottles') && presentKeys.has('ceramic')
      && toNum(row.bottles) === 0 && toNum(row.ceramic) === 0) {
      warnings.push({
        level: 'warning',
        rowIndex: i,
        messageKa: `სტრიქონი ${i + 1}: ჩამოსხმული ტარის რაოდენობა არ არის მითითებული.`,
        messageEn: `Row ${i + 1}: no bottled-container quantity is recorded.`,
      });
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

  if (template.id === 'annex_18_wine_turnover_notification') {
    const unclassified = ctx.salesDispatches.filter(dispatch => {
      const date = (dispatch.date || '').slice(0, 10);
      return date >= ctx.dateRange.from && date <= ctx.dateRange.to && !dispatch.marketChannel;
    });
    if (unclassified.length > 0) {
      warnings.push({
        level: 'warning',
        messageKa: `${unclassified.length} რეალიზაციას არ აქვს მითითებული ბაზარი (შიდა/ექსპორტი).`,
        messageEn: `${unclassified.length} sales dispatch(es) have no domestic/export market classification.`,
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
