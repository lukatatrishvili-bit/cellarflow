import type { InventoryItem } from './wineryState';

export type InvoiceAnalysisConfidence = 'high' | 'medium' | 'low';

export interface InvoiceSourceReference {
  id: string;
  title: string;
  url: string;
  domain?: string;
  official: boolean;
}

export interface InvoiceHeaderDraft {
  supplierName: string;
  supplierCompanyId?: string;
  supplierAddress?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency: string;
  subtotal?: number;
  taxAmount?: number;
  total?: number;
  paymentTerms?: string;
}

export interface InvoiceInventoryMatch {
  inventoryItemId: string;
  inventoryItemName: string;
  confidence: number;
  reason: string;
}

export interface InvoiceLineDraft {
  id: string;
  lineNumber: number;
  invoiceDescription: string;
  productName: string;
  brandName?: string;
  manufacturerName?: string;
  supplierName: string;
  sku?: string;
  category: string;
  invoiceQuantity: number;
  invoiceUnit: string;
  stockQuantity: number;
  stockUnit: string;
  packageSize?: number;
  packageUnit?: string;
  unitCost: number;
  lineNetAmount?: number;
  taxRatePct?: number;
  taxAmount?: number;
  lineTotal?: number;
  currency: string;
  lotNumber?: string;
  expiryDate?: string;
  activeIngredients: string[];
  recommendedDosage?: string;
  usageInstructions?: string;
  safetyNotes?: string;
  sourceIds: string[];
  sourceStatus: 'official' | 'grounded' | 'not_found' | 'not_applicable';
  confidence: number;
  confidenceLabel: InvoiceAnalysisConfidence;
  warnings: string[];
  match?: InvoiceInventoryMatch;
}

export interface InvoiceAnalysisDraft {
  analysisId: string;
  analyzedAt: string;
  invoice: InvoiceHeaderDraft;
  lines: InvoiceLineDraft[];
  sources: InvoiceSourceReference[];
  warnings: string[];
  budget?: { used: number; remaining: number };
}

export interface InvoiceImportSelection {
  line: InvoiceLineDraft;
  mode: 'create' | 'receive';
  inventoryItemId?: string;
}

export interface InvoiceImportSummary {
  inventory: InventoryItem[];
  created: number;
  updated: number;
  skipped: number;
}

export type InvoiceReviewStatus = 'ready' | 'needs_review' | 'excluded';

export type InvoiceReviewIssueCode =
  | 'missing_product'
  | 'missing_quantity'
  | 'missing_unit'
  | 'missing_cost'
  | 'missing_target'
  | 'target_unit_mismatch'
  | 'conversion_unconfirmed'
  | 'low_confidence'
  | 'line_warning'
  | 'amount_mismatch'
  | 'unverified_enrichment';

export interface InvoiceLineReviewContext {
  mode: 'create' | 'receive';
  targetSelected?: boolean;
  targetUnitCompatible?: boolean;
  conversionConfirmed?: boolean;
}

export interface InvoiceLineReviewAssessment {
  status: InvoiceReviewStatus;
  blockers: InvoiceReviewIssueCode[];
  cautions: InvoiceReviewIssueCode[];
  postable: boolean;
}

export interface InvoiceTotalsReconciliation {
  calculatedSubtotal: number;
  calculatedTax: number;
  calculatedTotal: number;
  subtotalDifference?: number;
  taxDifference?: number;
  totalDifference?: number;
  balanced: boolean;
  comparedFields: number;
}

function words(value: string | undefined): string[] {
  return (value || '')
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 2);
}

function normalized(value: string | undefined): string {
  return words(value).join(' ');
}

function compact(value: string | undefined): string {
  return normalized(value).replace(/\s+/g, '');
}

export function normalizeInvoiceUnit(value: string | undefined): string {
  const raw = (value || '')
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const aliases: Record<string, string> = {
    unit: 'units', units: 'units', pc: 'units', pcs: 'units', piece: 'units', pieces: 'units', ea: 'units',
    kilogram: 'kg', kilograms: 'kg', kgs: 'kg', kg: 'kg',
    gram: 'g', grams: 'g', gr: 'g', g: 'g',
    litre: 'liters', litres: 'liters', liter: 'liters', liters: 'liters', l: 'liters',
    milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', ml: 'ml',
    bag: 'bags', bags: 'bags', box: 'boxes', boxes: 'boxes', pack: 'packs', packs: 'packs',
    roll: 'rolls', rolls: 'rolls', bottle: 'bottles', bottles: 'bottles',
    კგ: 'kg', გ: 'g', გრ: 'g', ლ: 'liters', ლიტრი: 'liters', ლიტრები: 'liters', მლ: 'ml',
    ც: 'units', ცალი: 'units', ცალები: 'units', კოლოფი: 'boxes', კოლოფები: 'boxes',
    პაკეტი: 'packs', პაკეტები: 'packs', ტომარა: 'bags', ტომრები: 'bags', ბოთლი: 'bottles', ბოთლები: 'bottles',
  };
  return aliases[raw] || raw;
}

export function invoiceUnitsCompatible(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeInvoiceUnit(left);
  return Boolean(normalizedLeft) && normalizedLeft === normalizeInvoiceUnit(right);
}

function tokenSimilarity(left: string | undefined, right: string | undefined): number {
  const a = new Set(words(left));
  const b = new Set(words(right));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((token) => {
    if (b.has(token)) overlap += 1;
  });
  return overlap / Math.max(a.size, b.size);
}

function hasSharedProductCode(left: string | undefined, right: string | undefined): boolean {
  const codes = (value: string | undefined) => new Set(words(value).filter((token) => (
    /\p{L}/u.test(token) && /\p{N}/u.test(token)
  )));
  const leftCodes = codes(left);
  return [...codes(right)].some((code) => leftCodes.has(code));
}

export function invoiceConfidenceLabel(score: number): InvoiceAnalysisConfidence {
  if (score >= 0.85) return 'high';
  if (score >= 0.65) return 'medium';
  return 'low';
}

export function findBestInvoiceInventoryMatch(
  line: Pick<InvoiceLineDraft, 'productName' | 'invoiceDescription' | 'sku' | 'brandName' | 'manufacturerName' | 'category' | 'stockUnit'>,
  inventory: InventoryItem[],
): InvoiceInventoryMatch | undefined {
  const exactSku = compact(line.sku);
  if (exactSku) {
    const match = inventory.find((item) => compact(item.sku) === exactSku);
    if (match) {
      const compatibleUnit = invoiceUnitsCompatible(line.stockUnit, match.unit);
      return {
        inventoryItemId: match.id,
        inventoryItemName: match.name,
        confidence: compatibleUnit ? 1 : 0.94,
        reason: compatibleUnit ? 'Exact SKU and unit match' : 'Exact SKU match; unit needs review',
      };
    }
  }

  const ranked: Array<{ item: InventoryItem; score: number; reason: string }> = [];
  for (const item of inventory) {
    const productNameSimilarity = tokenSimilarity(line.productName, item.name);
    const descriptionSimilarity = tokenSimilarity(line.invoiceDescription, item.name) * 0.9;
    const name = Math.max(productNameSimilarity, descriptionSimilarity);
    const productCode = hasSharedProductCode(`${line.productName} ${line.invoiceDescription}`, item.name);
    if (name < 0.34 && !productCode) continue;
    const maker = line.manufacturerName && item.manufacturerName
      ? tokenSimilarity(line.manufacturerName, item.manufacturerName)
      : 0;
    const brand = line.brandName && item.brandName
      ? tokenSimilarity(line.brandName, item.brandName)
      : 0;
    const category = normalized(line.category) && normalized(line.category) === normalized(item.category) ? 0.05 : 0;
    const unitCompatible = invoiceUnitsCompatible(line.stockUnit, item.unit);
    const exactName = normalized(line.productName) && normalized(line.productName) === normalized(item.name) ? 0.12 : 0;
    const score = Math.max(0, Math.min(0.98,
      name * 0.74 + maker * 0.08 + brand * 0.06 + category + (unitCompatible ? 0.07 : -0.08) + exactName
        + (productCode ? 0.46 : 0),
    ));
    const reason = productCode && unitCompatible
      ? 'Product code and unit match'
      : maker >= 0.75 && unitCompatible
      ? 'Product, manufacturer, and unit match'
      : unitCompatible
        ? 'Product name and unit match'
        : 'Possible product-name match; unit needs review';
    ranked.push({ item, score, reason });
  }

  ranked.sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || best.score < 0.74) return undefined;
  if (runnerUp && best.score - runnerUp.score < 0.07) return undefined;
  return {
    inventoryItemId: best.item.id,
    inventoryItemName: best.item.name,
    confidence: best.score,
    reason: best.reason,
  };
}

function differenceExceedsTolerance(actual: number, expected: number): boolean {
  const tolerance = Math.max(0.05, Math.abs(expected) * 0.005);
  return Math.abs(actual - expected) > tolerance;
}

export function assessInvoiceLineReview(
  line: InvoiceLineDraft,
  context: InvoiceLineReviewContext,
): InvoiceLineReviewAssessment {
  if (['service', 'freight', 'discount', 'non_inventory'].includes(line.category)) {
    return { status: 'excluded', blockers: [], cautions: [], postable: false };
  }

  const blockers: InvoiceReviewIssueCode[] = [];
  const cautions: InvoiceReviewIssueCode[] = [];
  if (!line.productName.trim()) blockers.push('missing_product');
  if (!Number.isFinite(line.stockQuantity) || line.stockQuantity <= 0) blockers.push('missing_quantity');
  if (!normalizeInvoiceUnit(line.stockUnit)) blockers.push('missing_unit');
  if (context.mode === 'receive' && !context.targetSelected) blockers.push('missing_target');
  if (context.mode === 'receive' && context.targetSelected && context.targetUnitCompatible === false) blockers.push('target_unit_mismatch');
  if (!invoiceUnitsCompatible(line.invoiceUnit, line.stockUnit) && !context.conversionConfirmed) blockers.push('conversion_unconfirmed');

  if (!Number.isFinite(line.unitCost) || line.unitCost <= 0) cautions.push('missing_cost');
  if (line.confidence < 0.85) cautions.push('low_confidence');
  if (line.warnings.length > 0) cautions.push('line_warning');
  if (line.sourceStatus === 'grounded') cautions.push('unverified_enrichment');
  const calculatedNet = line.stockQuantity * line.unitCost;
  if (Number.isFinite(line.lineNetAmount) && line.lineNetAmount !== undefined
    && differenceExceedsTolerance(calculatedNet, line.lineNetAmount)) {
    cautions.push('amount_mismatch');
  }

  return {
    status: blockers.length || cautions.length ? 'needs_review' : 'ready',
    blockers: [...new Set(blockers)],
    cautions: [...new Set(cautions)],
    postable: blockers.length === 0,
  };
}

export function reconcileInvoiceTotals(
  invoice: InvoiceHeaderDraft,
  lines: InvoiceLineDraft[],
): InvoiceTotalsReconciliation {
  const calculatedSubtotal = lines.reduce((sum, line) => (
    sum + (Number.isFinite(line.lineNetAmount) ? Number(line.lineNetAmount) : line.stockQuantity * line.unitCost)
  ), 0);
  const hasLineTax = lines.some((line) => Number.isFinite(line.taxAmount));
  const lineTax = lines.reduce((sum, line) => sum + (Number.isFinite(line.taxAmount) ? Number(line.taxAmount) : 0), 0);
  const calculatedTax = hasLineTax ? lineTax : (Number.isFinite(invoice.taxAmount) ? Number(invoice.taxAmount) : 0);
  const lineTotal = lines.reduce((sum, line) => sum + (
    Number.isFinite(line.lineTotal)
      ? Number(line.lineTotal)
      : (Number.isFinite(line.lineNetAmount) ? Number(line.lineNetAmount) : line.stockQuantity * line.unitCost)
        + (Number.isFinite(line.taxAmount) ? Number(line.taxAmount) : 0)
  ), 0);
  const lineTotalsAreNetOnly = !differenceExceedsTolerance(lineTotal, calculatedSubtotal);
  const calculatedTotal = lineTotalsAreNetOnly ? calculatedSubtotal + calculatedTax : lineTotal;
  const subtotalDifference = Number.isFinite(invoice.subtotal) ? calculatedSubtotal - Number(invoice.subtotal) : undefined;
  const taxDifference = hasLineTax && Number.isFinite(invoice.taxAmount) ? calculatedTax - Number(invoice.taxAmount) : undefined;
  const totalDifference = Number.isFinite(invoice.total) ? calculatedTotal - Number(invoice.total) : undefined;
  const comparisons = [
    [calculatedSubtotal, invoice.subtotal],
    ...(hasLineTax ? [[calculatedTax, invoice.taxAmount] as [number, number | undefined]] : []),
    [calculatedTotal, invoice.total],
  ].filter((entry): entry is [number, number] => Number.isFinite(entry[1]));
  return {
    calculatedSubtotal,
    calculatedTax,
    calculatedTotal,
    subtotalDifference,
    taxDifference,
    totalDifference,
    comparedFields: comparisons.length,
    balanced: comparisons.every(([actual, expected]) => !differenceExceedsTolerance(actual, expected)),
  };
}

function finite(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function invoiceReceipt(line: InvoiceLineDraft, invoice: InvoiceHeaderDraft, now: string) {
  return {
    analysisLineId: line.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    receivedAt: now,
    supplierName: line.supplierName || invoice.supplierName,
    quantity: finite(line.stockQuantity),
    unit: line.stockUnit,
    unitCost: finite(line.unitCost),
    lineTotal: line.lineTotal,
    currency: line.currency || invoice.currency,
  };
}

export function applyInvoiceImport(
  currentInventory: InventoryItem[],
  invoice: InvoiceHeaderDraft,
  selections: InvoiceImportSelection[],
  sources: InvoiceSourceReference[] = [],
  now = new Date().toISOString(),
): InvoiceImportSummary {
  const inventory = [...currentInventory];
  const sourceUrlById = new Map(sources.map((source) => [source.id, source.url]));
  const officialSourceIds = new Set(sources.filter((source) => source.official).map((source) => source.id));
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const selection of selections) {
    const { line } = selection;
    const quantity = Math.max(0, finite(line.stockQuantity));
    const productSourceUrls = line.sourceIds
      .map((id) => sourceUrlById.get(id))
      .filter((url): url is string => Boolean(url));
    const officialSourceUrls = line.sourceIds
      .filter((id) => officialSourceIds.has(id))
      .map((id) => sourceUrlById.get(id))
      .filter((url): url is string => Boolean(url));
    if (!line.productName.trim() || quantity <= 0) {
      skipped += 1;
      continue;
    }

    if (selection.mode === 'receive' && selection.inventoryItemId) {
      const index = inventory.findIndex((item) => item.id === selection.inventoryItemId);
      if (index >= 0) {
        const existing = inventory[index];
        // Never silently combine unlike units. The review UI should normally
        // prevent this, and this guard keeps the shared helper safe as well.
        if (normalized(existing.unit) !== normalized(line.stockUnit)) {
          skipped += 1;
          continue;
        }
        const oldStock = Math.max(0, finite(existing.stock));
        const receivedCost = Math.max(0, finite(line.unitCost));
        const combinedStock = oldStock + quantity;
        const weightedCost = combinedStock > 0
          ? ((oldStock * Math.max(0, finite(existing.costPerUnit))) + (quantity * receivedCost)) / combinedStock
          : receivedCost;
        inventory[index] = {
          ...existing,
          stock: Number(combinedStock.toFixed(4)),
          costPerUnit: Number(weightedCost.toFixed(4)),
          supplierName: line.supplierName || existing.supplierName,
          sku: line.sku || existing.sku,
          brandName: line.brandName || existing.brandName,
          manufacturerName: line.manufacturerName || existing.manufacturerName,
          packageSize: line.packageSize ?? existing.packageSize,
          packageUnit: line.packageUnit || existing.packageUnit,
          activeIngredients: line.activeIngredients.length ? line.activeIngredients : existing.activeIngredients,
          recommendedDosage: line.recommendedDosage || existing.recommendedDosage,
          usageInstructions: line.usageInstructions || existing.usageInstructions,
          safetyNotes: line.safetyNotes || existing.safetyNotes,
          productSourceUrls: productSourceUrls.length ? productSourceUrls : existing.productSourceUrls,
          officialSourceUrls: officialSourceUrls.length ? officialSourceUrls : existing.officialSourceUrls,
          lastInvoiceReceipt: invoiceReceipt(line, invoice, now),
          lastModified: now,
        };
        updated += 1;
        continue;
      }
    }

    const idBase = line.sku || line.productName || line.id;
    const idSlug = normalized(idBase).replace(/\s+/g, '-').slice(0, 42) || 'item';
    inventory.push({
      id: `inv-${Date.parse(now) || Date.now()}-${idSlug}-${created + 1}`,
      name: line.productName.trim(),
      category: line.category || 'unassigned',
      stock: Number(quantity.toFixed(4)),
      minThreshold: 0,
      unit: line.stockUnit || 'units',
      costPerUnit: Math.max(0, finite(line.unitCost)),
      supplierName: line.supplierName || invoice.supplierName || 'N/A',
      details: line.invoiceDescription || undefined,
      sku: line.sku,
      brandName: line.brandName,
      manufacturerName: line.manufacturerName,
      packageSize: line.packageSize,
      packageUnit: line.packageUnit,
      activeIngredients: line.activeIngredients,
      recommendedDosage: line.recommendedDosage,
      usageInstructions: line.usageInstructions,
      safetyNotes: line.safetyNotes,
      productSourceUrls,
      officialSourceUrls,
      lastInvoiceReceipt: invoiceReceipt(line, invoice, now),
      lastModified: now,
    });
    created += 1;
  }

  return { inventory, created, updated, skipped };
}
