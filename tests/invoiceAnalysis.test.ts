import { describe, expect, it } from 'vitest';
import {
  applyInvoiceImport,
  findBestInvoiceInventoryMatch,
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
      reason: 'Exact SKU match',
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
});

