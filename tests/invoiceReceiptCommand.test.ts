import { describe, expect, it } from 'vitest';
import {
  applyInvoiceReceiptCommand,
  applyInvoiceReceiptReversalCommand,
  InvoiceReceiptCommandError,
  type InvoiceReceiptCommandPayload,
} from '../lib/commands/invoiceReceipt';

function payload(overrides: Partial<InvoiceReceiptCommandPayload> = {}): InvoiceReceiptCommandPayload {
  return {
    receiptId: 'receipt-1',
    analysisId: 'analysis-1',
    documentChecksum: 'a'.repeat(64),
    invoice: {
      supplierName: 'Enology Supply Europe',
      supplierCompanyId: 'EU-9988',
      invoiceNumber: 'INV-2026-44',
      invoiceDate: '2026-08-01',
      currency: 'EUR',
      subtotal: 100,
      taxAmount: 18,
      total: 118,
    },
    accountingCurrency: 'GEL',
    exchangeRate: {
      fromCurrency: 'EUR',
      toCurrency: 'GEL',
      rate: 3,
      requestedDate: '2026-08-01',
      rateDate: '2026-08-01',
      source: 'manual',
      sourceLabel: 'Manually confirmed exchange rate',
      retrievedAt: '2026-08-04T10:00:00.000Z',
    },
    costBasis: 'net',
    additionalCostsSource: 20,
    sources: [{ id: 'src-1', title: 'Manufacturer label', url: 'https://maker.example/label', official: true }],
    lines: [{
      lineId: 'line-1',
      movementId: 'movement-1',
      mode: 'receive',
      inventoryItemId: 'item-1',
      productName: 'Yeast nutrient',
      category: 'nutritions',
      supplierName: 'Enology Supply Europe',
      manufacturerName: 'Official Maker',
      invoiceDescription: '2 cases nutrient',
      invoiceQuantity: 2,
      invoiceUnit: 'case',
      stockQuantity: 20,
      stockUnit: 'kg',
      conversionFactor: 10,
      conversionConfirmed: true,
      sourceCostPerStockUnit: 5,
      lineNetAmount: 100,
      lineTotal: 118,
      activeIngredients: ['Diammonium phosphate'],
      recommendedDosage: 'Follow current product label',
      sourceIds: ['src-1'],
    }],
    ...overrides,
  };
}

const state = () => ({
  inventory: [{
    id: 'item-1',
    name: 'Yeast nutrient',
    category: 'nutritions',
    stock: 10,
    minThreshold: 2,
    unit: 'kg',
    costPerUnit: 5,
    costCurrency: 'GEL',
    supplierName: 'Old supplier',
  }],
  invoiceReceipts: [],
  inventoryMovements: [],
});

const context = {
  commandId: 'cmd-invoice-1',
  actorUsername: 'owner',
  performedAt: new Date('2026-08-04T10:00:00.000Z'),
};

describe('invoice receipt command', () => {
  it('posts source and accounting values atomically using package conversion and weighted cost', () => {
    const applied = applyInvoiceReceiptCommand(state(), payload(), context);

    expect(applied.result.created).toBe(0);
    expect(applied.result.updated).toBe(1);
    expect(applied.state.inventory[0]).toMatchObject({
      stock: 30,
      costPerUnit: 13.666667,
      costCurrency: 'GEL',
      manufacturerName: 'Official Maker',
    });
    expect(applied.result.receipt).toMatchObject({
      status: 'posted',
      additionalCostsSource: 20,
      selectedLinesSourceAmount: 120,
      selectedLinesAccountingAmount: 360,
      accountingCurrency: 'GEL',
    });
    expect(applied.result.receipt.lines[0]).toMatchObject({
      allocatedAdditionalCostSource: 20,
      sourceCostAmount: 120,
      accountingCostAmount: 360,
      accountingUnitCost: 18,
    });
    expect(applied.result.movements[0]).toMatchObject({
      direction: 'in',
      quantity: 20,
      sourceAmount: 120,
      sourceCurrency: 'EUR',
      accountingAmount: 360,
      accountingCurrency: 'GEL',
      stockBefore: 10,
      stockAfter: 30,
    });
  });

  it('blocks the same active invoice even when a new receipt id is supplied', () => {
    const first = applyInvoiceReceiptCommand(state(), payload(), context);
    expect(() => applyInvoiceReceiptCommand(
      first.state,
      payload({
        receiptId: 'receipt-2',
        documentChecksum: 'b'.repeat(64),
        lines: [{ ...payload().lines[0], movementId: 'movement-2' }],
      }),
      { ...context, commandId: 'cmd-invoice-2' },
    )).toThrowError(expect.objectContaining({ code: 'duplicate_invoice_receipt' }));
  });

  it('requires explicit confirmation when purchase and stock units differ', () => {
    expect(() => applyInvoiceReceiptCommand(
      state(),
      payload({ lines: [{ ...payload().lines[0], conversionConfirmed: false }] }),
      context,
    )).toThrowError(expect.objectContaining({ code: 'invalid_invoice_receipt_payload' }));
  });

  it('reverses with compensating movements and restores quantity and value', () => {
    const posted = applyInvoiceReceiptCommand(state(), payload(), context);
    const reversed = applyInvoiceReceiptReversalCommand(
      posted.state,
      { receiptId: 'receipt-1', reason: 'Supplier credit note' },
      { ...context, commandId: 'cmd-invoice-reversal-1', performedAt: new Date('2026-08-05T09:00:00.000Z') },
    );

    expect(reversed.state.inventory[0]).toMatchObject({ stock: 10, costPerUnit: 5 });
    expect(reversed.result.receipt).toMatchObject({
      status: 'reversed',
      reversalReason: 'Supplier credit note',
      reversedByCommandId: 'cmd-invoice-reversal-1',
    });
    expect(reversed.result.movements[0]).toMatchObject({
      kind: 'invoice_receipt_reversal',
      direction: 'out',
      accountingAmount: -360,
      sourceAmount: -120,
      reversalOfMovementId: 'movement-1',
    });
  });

  it('does not reverse stock that has already been consumed', () => {
    const posted = applyInvoiceReceiptCommand(state(), payload(), context);
    posted.state.inventory[0].stock = 15;
    expect(() => applyInvoiceReceiptReversalCommand(
      posted.state,
      { receiptId: 'receipt-1', reason: 'Credit note' },
      { ...context, commandId: 'cmd-invoice-reversal-2' },
    )).toThrowError(InvoiceReceiptCommandError);
  });
});
