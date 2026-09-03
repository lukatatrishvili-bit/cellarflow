import { describe, expect, it } from 'vitest';
import {
  applyInvoiceImport,
  assessInvoiceLineReview,
  findBestInvoiceInventoryMatch,
  invoiceUnitsCompatible,
  reconcileInvoiceTotals,
  type InvoiceHeaderDraft,
  type InvoiceLineDraft,
} from '../lib/invoiceAnalysis';
import type { InventoryItem } from '../lib/wineryState';

const inventory: InventoryItem[] = [{
  id: 'inv-yeast-1',
  name: 'Lalvin ICV D254',
  category: 'yeasts',
  stock: 10,
  minThreshold: 2,
  unit: 'kg',
  costPerUnit: 20,
  supplierName: 'Existing Supplier',
  sku: 'D254-1KG',
  manufacturerName: 'Lallemand',
}];

const invoice: InvoiceHeaderDraft = {
  supplierName: 'Wine Supply Georgia',
  invoiceNumber: 'INV-2048',
  invoiceDate: '2026-08-04',
  currency: 'GEL',
  total: 180,
};

function line(overrides: Partial<InvoiceLineDraft> = {}): InvoiceLineDraft {
  return {
    id: 'analysis-line-1',
    lineNumber: 1,
    invoiceDescription: 'Lalvin ICV D254 1 kg',
    productName: 'Lalvin ICV D254',
    manufacturerName: 'Lallemand',
    supplierName: 'Wine Supply Georgia',
    sku: 'D254-1KG',
    category: 'yeasts',
    invoiceQuantity: 5,
    invoiceUnit: 'kg',
    stockQuantity: 5,
    stockUnit: 'kg',
    unitCost: 30,
    lineTotal: 150,
    currency: 'GEL',
    activeIngredients: ['Saccharomyces cerevisiae'],
    recommendedDosage: '20–40 g/hL',
    usageInstructions: 'Rehydrate according to the current technical sheet.',
    sourceIds: ['source-1'],
    sourceStatus: 'official',
    confidence: 0.96,
    confidenceLabel: 'high',
    warnings: [],
    ...overrides,
  };
}

describe('invoice inventory analysis helpers', () => {
  it('prefers an exact SKU when reconciling an invoice line', () => {
    expect(findBestInvoiceInventoryMatch(line(), inventory)).toEqual({
      inventoryItemId: 'inv-yeast-1',
      inventoryItemName: 'Lalvin ICV D254',
      confidence: 1,
      reason: 'Exact SKU and unit match',
    });
  });

  it('normalizes punctuation in SKUs and common stock-unit aliases', () => {
    expect(findBestInvoiceInventoryMatch(line({ sku: 'D254 1KG' }), inventory)?.inventoryItemId).toBe('inv-yeast-1');
    expect(invoiceUnitsCompatible('litre', 'L')).toBe(true);
    expect(invoiceUnitsCompatible('pcs', 'units')).toBe(true);
    expect(invoiceUnitsCompatible('კგ', 'kg')).toBe(true);
    expect(invoiceUnitsCompatible('kg', 'g')).toBe(false);
  });

  it('leaves equally plausible duplicate inventory matches for a human to resolve', () => {
    const duplicateInventory: InventoryItem[] = [
      { ...inventory[0], id: 'duplicate-a', sku: undefined },
      { ...inventory[0], id: 'duplicate-b', sku: undefined },
    ];
    expect(findBestInvoiceInventoryMatch(line({ sku: undefined }), duplicateInventory)).toBeUndefined();
  });

  it('matches distinctive product codes across translated inventory names', () => {
    expect(findBestInvoiceInventoryMatch(line({
      productName: 'Lalvin QA23 wine yeast',
      invoiceDescription: 'Lalvin QA23 wine yeast 1 kg',
      sku: undefined,
      manufacturerName: undefined,
    }), [{
      ...inventory[0],
      id: 'translated-qa23',
      name: 'საფუარი QA23',
      sku: undefined,
      unit: 'კგ',
    }])).toMatchObject({
      inventoryItemId: 'translated-qa23',
      reason: 'Product code and unit match',
    });
  });

  it('does not force a weak product-name match', () => {
    expect(findBestInvoiceInventoryMatch(line({
      productName: 'Premium glass bottle 750 ml',
      invoiceDescription: 'Bordeaux bottle pallet',
      sku: undefined,
      manufacturerName: undefined,
      stockUnit: 'units',
    }), inventory)).toBeUndefined();
  });

  it('receives stock with a weighted-average cost and retains source evidence', () => {
    const result = applyInvoiceImport(inventory, invoice, [{
      line: line(),
      mode: 'receive',
      inventoryItemId: 'inv-yeast-1',
    }], [{
      id: 'source-1',
      title: 'Official technical sheet',
      url: 'https://www.lallemandwine.com/technical-sheet',
      domain: 'lallemandwine.com',
      official: true,
    }], '2026-08-04T12:00:00.000Z');

    expect(result).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(result.inventory[0]).toMatchObject({
      stock: 15,
      costPerUnit: 23.3333,
      supplierName: 'Wine Supply Georgia',
      productSourceUrls: ['https://www.lallemandwine.com/technical-sheet'],
      officialSourceUrls: ['https://www.lallemandwine.com/technical-sheet'],
      lastInvoiceReceipt: {
        invoiceNumber: 'INV-2048',
        quantity: 5,
        unit: 'kg',
        unitCost: 30,
      },
    });
  });

  it('creates a fully enriched inventory item from an approved line', () => {
    const result = applyInvoiceImport([], invoice, [{ line: line(), mode: 'create' }], [{
      id: 'source-1',
      title: 'Manufacturer label',
      url: 'https://manufacturer.example/product',
      official: true,
    }], '2026-08-04T12:00:00.000Z');

    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    expect(result.inventory[0]).toMatchObject({
      name: 'Lalvin ICV D254',
      category: 'yeasts',
      stock: 5,
      unit: 'kg',
      costPerUnit: 30,
      manufacturerName: 'Lallemand',
      recommendedDosage: '20–40 g/hL',
    });
  });

  it('refuses to merge incompatible stock units', () => {
    const result = applyInvoiceImport(inventory, invoice, [{
      line: line({ stockUnit: 'units' }),
      mode: 'receive',
      inventoryItemId: 'inv-yeast-1',
    }]);

    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(result.inventory[0].stock).toBe(10);
  });

  it('classifies safe, blocked, and excluded lines for the review queue', () => {
    expect(assessInvoiceLineReview(line(), {
      mode: 'receive',
      targetSelected: true,
      targetUnitCompatible: true,
      conversionConfirmed: true,
    })).toEqual({ status: 'ready', blockers: [], cautions: [], postable: true });

    expect(assessInvoiceLineReview(line({
      stockQuantity: 0,
      invoiceUnit: 'bags',
      stockUnit: 'kg',
      lineNetAmount: 150,
      confidence: 0.7,
      confidenceLabel: 'medium',
    }), {
      mode: 'receive',
      targetSelected: false,
      conversionConfirmed: false,
    })).toMatchObject({
      status: 'needs_review',
      blockers: ['missing_quantity', 'missing_target', 'conversion_unconfirmed'],
      cautions: ['low_confidence', 'amount_mismatch'],
      postable: false,
    });

    expect(assessInvoiceLineReview(line({ category: 'freight' }), {
      mode: 'create',
    })).toEqual({ status: 'excluded', blockers: [], cautions: [], postable: false });
  });

  it('reconciles extracted line arithmetic with the invoice header', () => {
    const balanced = reconcileInvoiceTotals({
      ...invoice,
      subtotal: 150,
      taxAmount: 30,
      total: 180,
    }, [line({ lineNetAmount: 150, taxAmount: 30, lineTotal: 180 })]);
    expect(balanced).toMatchObject({
      calculatedSubtotal: 150,
      calculatedTax: 30,
      calculatedTotal: 180,
      comparedFields: 3,
      balanced: true,
    });

    const mismatched = reconcileInvoiceTotals({ ...invoice, subtotal: 150, taxAmount: 30, total: 200 }, [
      line({ lineNetAmount: 150, taxAmount: 30, lineTotal: 180 }),
    ]);
    expect(mismatched.balanced).toBe(false);
    expect(mismatched.totalDifference).toBe(-20);
  });

  it('uses header-level tax when invoice lines only contain net totals', () => {
    expect(reconcileInvoiceTotals({
      ...invoice,
      subtotal: 150,
      taxAmount: 27,
      total: 177,
    }, [line({ lineNetAmount: 150, taxAmount: undefined, lineTotal: 150 })])).toMatchObject({
      calculatedSubtotal: 150,
      calculatedTax: 27,
      calculatedTotal: 177,
      comparedFields: 2,
      balanced: true,
    });
  });

  it('adds extracted line tax when line-total fields still contain net amounts', () => {
    expect(reconcileInvoiceTotals({
      ...invoice,
      subtotal: 150,
      taxAmount: 27,
      total: 177,
    }, [line({ lineNetAmount: 150, taxAmount: 27, lineTotal: 150 })])).toMatchObject({
      calculatedSubtotal: 150,
      calculatedTax: 27,
      calculatedTotal: 177,
      comparedFields: 3,
      balanced: true,
    });
  });
});
