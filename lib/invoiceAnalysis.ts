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

export function invoiceConfidenceLabel(score: number): InvoiceAnalysisConfidence {
  if (score >= 0.85) return 'high';
  if (score >= 0.65) return 'medium';
  return 'low';
}

export function findBestInvoiceInventoryMatch(
  line: Pick<InvoiceLineDraft, 'productName' | 'invoiceDescription' | 'sku' | 'manufacturerName' | 'stockUnit'>,
  inventory: InventoryItem[],
): InvoiceInventoryMatch | undefined {
  const exactSku = normalized(line.sku);
  if (exactSku) {
    const match = inventory.find((item) => normalized(item.sku) === exactSku);
    if (match) {
      return {
        inventoryItemId: match.id,
        inventoryItemName: match.name,
        confidence: 1,
        reason: 'Exact SKU match',
      };
    }
  }

  let best: { item: InventoryItem; score: number } | undefined;
  for (const item of inventory) {
    const name = tokenSimilarity(line.productName || line.invoiceDescription, item.name);
    if (name === 0) continue;
    const maker = line.manufacturerName && item.manufacturerName
      ? tokenSimilarity(line.manufacturerName, item.manufacturerName)
      : 0;
    const unit = normalized(line.stockUnit) && normalized(line.stockUnit) === normalized(item.unit) ? 0.06 : 0;
    const score = Math.min(0.98, name * 0.88 + maker * 0.06 + unit);
    if (!best || score > best.score) best = { item, score };
  }

  if (!best || best.score < 0.72) return undefined;
  return {
    inventoryItemId: best.item.id,
    inventoryItemName: best.item.name,
    confidence: best.score,
    reason: best.score >= 0.9 ? 'Strong product-name match' : 'Possible product-name match',
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
