import type { ExchangeRateQuote, SupportedInvoiceCurrency } from '../currency';
import { isSupportedInvoiceCurrency } from '../currency';
import type { InvoiceHeaderDraft, InvoiceSourceReference } from '../invoiceAnalysis';
import type { InventoryItem } from '../wineryState';

export const INVOICE_RECEIPT_COMMAND_TYPE = 'invoice.receipt' as const;
export const INVOICE_RECEIPT_REVERSAL_COMMAND_TYPE = 'invoice.receipt.reverse' as const;

const RECORD_ID_PATTERN = /^[\p{L}\p{N}._:-]{1,128}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 1_000_000_000_000;
const MAX_QUANTITY = 1_000_000_000;

export type InvoiceCostBasis = 'net' | 'gross';

export interface InvoiceReceiptLineInput {
  lineId: string;
  movementId: string;
  mode: 'create' | 'receive';
  inventoryItemId?: string;
  productName: string;
  category: string;
  supplierName: string;
  sku?: string;
  brandName?: string;
  manufacturerName?: string;
  invoiceDescription: string;
  invoiceQuantity: number;
  invoiceUnit: string;
  stockQuantity: number;
  stockUnit: string;
  conversionFactor: number;
  conversionConfirmed: boolean;
  packageSize?: number;
  packageUnit?: string;
  sourceCostPerStockUnit: number;
  lineNetAmount?: number;
  taxRatePct?: number;
  taxAmount?: number;
  lineTotal?: number;
  lotNumber?: string;
  expiryDate?: string;
  activeIngredients: string[];
  recommendedDosage?: string;
  usageInstructions?: string;
  safetyNotes?: string;
  sourceIds: string[];
}

export interface InvoiceReceiptCommandPayload {
  receiptId: string;
  analysisId: string;
  documentChecksum?: string;
  invoice: InvoiceHeaderDraft & { currency: SupportedInvoiceCurrency };
  accountingCurrency: SupportedInvoiceCurrency;
  exchangeRate: ExchangeRateQuote;
  costBasis: InvoiceCostBasis;
  additionalCostsSource: number;
  lines: InvoiceReceiptLineInput[];
  sources: InvoiceSourceReference[];
}

export interface InvoiceReceiptReversalCommandPayload {
  receiptId: string;
  reason: string;
}

export interface InventoryMovementRecord {
  id: string;
  commandId: string;
  kind: 'invoice_receipt' | 'invoice_receipt_reversal';
  direction: 'in' | 'out';
  occurredAt: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unit: string;
  accountingUnitCost: number;
  accountingAmount: number;
  accountingCurrency: SupportedInvoiceCurrency;
  sourceAmount: number;
  sourceCurrency: SupportedInvoiceCurrency;
  invoiceReceiptId: string;
  invoiceLineId: string;
  reversalOfMovementId?: string;
  stockBefore: number;
  stockAfter: number;
  weightedCostBefore: number;
  weightedCostAfter: number;
}

export interface InvoiceReceiptLineRecord extends InvoiceReceiptLineInput {
  inventoryItemId: string;
  inventoryItemName: string;
  allocatedAdditionalCostSource: number;
  sourceCostAmount: number;
  accountingCostAmount: number;
  accountingUnitCost: number;
  movementId: string;
}

export interface InvoiceReceiptRecord {
  id: string;
  commandId: string;
  status: 'posted' | 'reversed';
  analysisId: string;
  documentChecksum?: string;
  duplicateFingerprint: string;
  invoice: InvoiceHeaderDraft & { currency: SupportedInvoiceCurrency };
  accountingCurrency: SupportedInvoiceCurrency;
  exchangeRate: ExchangeRateQuote;
  costBasis: InvoiceCostBasis;
  additionalCostsSource: number;
  selectedLinesSourceAmount: number;
  selectedLinesAccountingAmount: number;
  lines: InvoiceReceiptLineRecord[];
  sources: InvoiceSourceReference[];
  postedAt: string;
  postedBy: string;
  reversedAt?: string;
  reversedBy?: string;
  reversedByCommandId?: string;
  reversalReason?: string;
  reversalMovementIds?: string[];
}

export interface InvoiceReceiptCommandState {
  inventory: InventoryItem[];
  invoiceReceipts: InvoiceReceiptRecord[];
  inventoryMovements: InventoryMovementRecord[];
}

export interface InvoiceReceiptCommandContext {
  commandId: string;
  actorUsername: string;
  performedAt: Date;
}

export interface InvoiceReceiptCommandResult {
  receipt: InvoiceReceiptRecord;
  movements: InventoryMovementRecord[];
  updatedInventoryItems: InventoryItem[];
  created: number;
  updated: number;
  stateVersion?: number;
}

export interface InvoiceReceiptReversalCommandResult {
  receipt: InvoiceReceiptRecord;
  movements: InventoryMovementRecord[];
  updatedInventoryItems: InventoryItem[];
  stateVersion?: number;
}

export type InvoiceReceiptCommandErrorCode =
  | 'invalid_invoice_receipt_payload'
  | 'organization_state_not_found'
  | 'invoice_receipt_id_conflict'
  | 'duplicate_invoice_receipt'
  | 'inventory_item_not_found'
  | 'inventory_unit_mismatch'
  | 'inventory_currency_mismatch'
  | 'inventory_movement_id_conflict'
  | 'invoice_receipt_not_found'
  | 'invoice_receipt_already_reversed'
  | 'insufficient_inventory_for_reversal'
  | 'inventory_value_would_be_negative';

export class InvoiceReceiptCommandError extends Error {
  constructor(
    public readonly code: InvoiceReceiptCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'InvoiceReceiptCommandError';
  }
}

function fail(message: string): never {
  throw new InvoiceReceiptCommandError('invalid_invoice_receipt_payload', message, 400);
}

function recordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) fail(`${field} must be a valid 1-128 character record id.`);
  return normalized;
}

function text(value: unknown, field: string, maxLength: number, required = false): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if ((required && !normalized) || normalized.length > maxLength) {
    fail(`${field}${required ? ' is required and' : ''} must not exceed ${maxLength} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  const normalized = text(value, field, maxLength);
  return normalized || undefined;
}

function date(value: unknown, field: string, required = false): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized && !required) return undefined;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(normalized) || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== normalized) fail(`${field} must be a valid YYYY-MM-DD date.`);
  return normalized;
}

function number(value: unknown, field: string, options: { positive?: boolean; max?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be a finite number.`);
  if (options.positive ? value <= 0 : value < 0) fail(`${field} must be ${options.positive ? 'greater than' : 'at least'} zero.`);
  if (value > (options.max ?? MAX_AMOUNT)) fail(`${field} is too large.`);
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return number(value, field);
}

function currency(value: unknown, field: string): SupportedInvoiceCurrency {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!isSupportedInvoiceCurrency(normalized)) fail(`${field} must be GEL, EUR, or USD.`);
  return normalized;
}

function stringArray(value: unknown, field: string, maxItems: number, itemMax: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) fail(`${field} must be an array with at most ${maxItems} entries.`);
  return value.map((entry, index) => text(entry, `${field}[${index}]`, itemMax, true));
}

function normalizeUnit(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseInvoice(value: unknown): InvoiceHeaderDraft & { currency: SupportedInvoiceCurrency } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invoice must be an object.');
  const input = value as Record<string, unknown>;
  return {
    supplierName: text(input.supplierName, 'invoice.supplierName', 240, true),
    supplierCompanyId: optionalText(input.supplierCompanyId, 'invoice.supplierCompanyId', 100),
    supplierAddress: optionalText(input.supplierAddress, 'invoice.supplierAddress', 500),
    invoiceNumber: optionalText(input.invoiceNumber, 'invoice.invoiceNumber', 120),
    invoiceDate: date(input.invoiceDate, 'invoice.invoiceDate'),
    dueDate: date(input.dueDate, 'invoice.dueDate'),
    currency: currency(input.currency, 'invoice.currency'),
    subtotal: optionalNumber(input.subtotal, 'invoice.subtotal'),
    taxAmount: optionalNumber(input.taxAmount, 'invoice.taxAmount'),
    total: optionalNumber(input.total, 'invoice.total'),
    paymentTerms: optionalText(input.paymentTerms, 'invoice.paymentTerms', 500),
  };
}

function parseExchangeRate(
  value: unknown,
  fromCurrency: SupportedInvoiceCurrency,
  toCurrency: SupportedInvoiceCurrency,
): ExchangeRateQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('exchangeRate must be an object.');
  const input = value as Record<string, unknown>;
  const source = input.source;
  if (source !== 'nbg_official' && source !== 'manual' && source !== 'identity') {
    fail('exchangeRate.source must be nbg_official, manual, or identity.');
  }
  const parsed: ExchangeRateQuote = {
    fromCurrency: currency(input.fromCurrency, 'exchangeRate.fromCurrency'),
    toCurrency: currency(input.toCurrency, 'exchangeRate.toCurrency'),
    rate: number(input.rate, 'exchangeRate.rate', { positive: true, max: 1_000_000 }),
    requestedDate: date(input.requestedDate, 'exchangeRate.requestedDate', true)!,
    rateDate: date(input.rateDate, 'exchangeRate.rateDate', true)!,
    source,
    sourceLabel: text(input.sourceLabel, 'exchangeRate.sourceLabel', 200, true),
    sourceUrl: optionalText(input.sourceUrl, 'exchangeRate.sourceUrl', 1_000),
    retrievedAt: text(input.retrievedAt, 'exchangeRate.retrievedAt', 50, true),
  };
  if (!Number.isFinite(Date.parse(parsed.retrievedAt))) fail('exchangeRate.retrievedAt must be an ISO timestamp.');
  if (parsed.sourceUrl && !/^https:\/\//i.test(parsed.sourceUrl)) fail('exchangeRate.sourceUrl must use HTTPS.');
  if (parsed.fromCurrency !== fromCurrency || parsed.toCurrency !== toCurrency) {
    fail('exchangeRate currency pair does not match the invoice and accounting currencies.');
  }
  if (fromCurrency === toCurrency && (parsed.rate !== 1 || parsed.source !== 'identity')) {
    fail('Same-currency invoices must use an identity rate of 1.');
  }
  return parsed;
}

function parseSource(value: unknown, index: number): InvoiceSourceReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`sources[${index}] must be an object.`);
  const input = value as Record<string, unknown>;
  const source: InvoiceSourceReference = {
    id: recordId(input.id, `sources[${index}].id`),
    title: text(input.title, `sources[${index}].title`, 300, true),
    url: text(input.url, `sources[${index}].url`, 1_000, true),
    domain: optionalText(input.domain, `sources[${index}].domain`, 240),
    official: input.official === true,
  };
  if (!/^https:\/\//i.test(source.url)) fail(`sources[${index}].url must use HTTPS.`);
  return source;
}

function parseLine(value: unknown, index: number): InvoiceReceiptLineInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`lines[${index}] must be an object.`);
  const input = value as Record<string, unknown>;
  const mode = input.mode;
  if (mode !== 'create' && mode !== 'receive') fail(`lines[${index}].mode must be create or receive.`);
  const invoiceQuantity = number(input.invoiceQuantity, `lines[${index}].invoiceQuantity`, { positive: true, max: MAX_QUANTITY });
  const stockQuantity = number(input.stockQuantity, `lines[${index}].stockQuantity`, { positive: true, max: MAX_QUANTITY });
  const conversionFactor = number(input.conversionFactor, `lines[${index}].conversionFactor`, { positive: true, max: MAX_QUANTITY });
  if (Math.abs((invoiceQuantity * conversionFactor) - stockQuantity) > Math.max(0.0001, stockQuantity * 0.000001)) {
    fail(`lines[${index}] conversionFactor does not reproduce stockQuantity.`);
  }
  const invoiceUnit = text(input.invoiceUnit, `lines[${index}].invoiceUnit`, 40, true);
  const stockUnit = text(input.stockUnit, `lines[${index}].stockUnit`, 40, true);
  const conversionConfirmed = input.conversionConfirmed === true;
  if (normalizeUnit(invoiceUnit) !== normalizeUnit(stockUnit) && !conversionConfirmed) {
    fail(`lines[${index}] package/unit conversion must be explicitly confirmed.`);
  }
  return {
    lineId: recordId(input.lineId, `lines[${index}].lineId`),
    movementId: recordId(input.movementId, `lines[${index}].movementId`),
    mode,
    inventoryItemId: mode === 'receive'
      ? recordId(input.inventoryItemId, `lines[${index}].inventoryItemId`)
      : optionalText(input.inventoryItemId, `lines[${index}].inventoryItemId`, 128),
    productName: text(input.productName, `lines[${index}].productName`, 240, true),
    category: text(input.category, `lines[${index}].category`, 100, true),
    supplierName: text(input.supplierName, `lines[${index}].supplierName`, 240),
    sku: optionalText(input.sku, `lines[${index}].sku`, 120),
    brandName: optionalText(input.brandName, `lines[${index}].brandName`, 160),
    manufacturerName: optionalText(input.manufacturerName, `lines[${index}].manufacturerName`, 240),
    invoiceDescription: text(input.invoiceDescription, `lines[${index}].invoiceDescription`, 1_000),
    invoiceQuantity,
    invoiceUnit,
    stockQuantity,
    stockUnit,
    conversionFactor,
    conversionConfirmed,
    packageSize: optionalNumber(input.packageSize, `lines[${index}].packageSize`),
    packageUnit: optionalText(input.packageUnit, `lines[${index}].packageUnit`, 40),
    sourceCostPerStockUnit: number(input.sourceCostPerStockUnit, `lines[${index}].sourceCostPerStockUnit`),
    lineNetAmount: optionalNumber(input.lineNetAmount, `lines[${index}].lineNetAmount`),
    taxRatePct: optionalNumber(input.taxRatePct, `lines[${index}].taxRatePct`),
    taxAmount: optionalNumber(input.taxAmount, `lines[${index}].taxAmount`),
    lineTotal: optionalNumber(input.lineTotal, `lines[${index}].lineTotal`),
    lotNumber: optionalText(input.lotNumber, `lines[${index}].lotNumber`, 120),
    expiryDate: date(input.expiryDate, `lines[${index}].expiryDate`),
    activeIngredients: stringArray(input.activeIngredients, `lines[${index}].activeIngredients`, 50, 200),
    recommendedDosage: optionalText(input.recommendedDosage, `lines[${index}].recommendedDosage`, 1_000),
    usageInstructions: optionalText(input.usageInstructions, `lines[${index}].usageInstructions`, 2_000),
    safetyNotes: optionalText(input.safetyNotes, `lines[${index}].safetyNotes`, 2_000),
    sourceIds: stringArray(input.sourceIds, `lines[${index}].sourceIds`, 50, 128),
  };
}

export function parseInvoiceReceiptCommandPayload(value: unknown): InvoiceReceiptCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invoice receipt payload must be an object.');
  const input = value as Record<string, unknown>;
  const invoice = parseInvoice(input.invoice);
  const accountingCurrency = currency(input.accountingCurrency, 'accountingCurrency');
  const lines = Array.isArray(input.lines) ? input.lines.map(parseLine) : fail('lines must be an array.');
  if (lines.length < 1 || lines.length > 250) fail('lines must contain between 1 and 250 selected products.');
  const movementIds = new Set(lines.map(line => line.movementId));
  if (movementIds.size !== lines.length) fail('Each invoice line must have a unique movementId.');
  const lineIds = new Set(lines.map(line => line.lineId));
  if (lineIds.size !== lines.length) fail('Each selected invoice line must have a unique lineId.');
  const costBasis = input.costBasis;
  if (costBasis !== 'net' && costBasis !== 'gross') fail('costBasis must be net or gross.');
  const sources = Array.isArray(input.sources) ? input.sources.map(parseSource) : fail('sources must be an array.');
  if (sources.length > 200) fail('sources must contain at most 200 entries.');
  const sourceIds = new Set(sources.map(source => source.id));
  if (lines.some(line => line.sourceIds.some(sourceId => !sourceIds.has(sourceId)))) {
    fail('Every line sourceId must reference a supplied source.');
  }
  const documentChecksum = optionalText(input.documentChecksum, 'documentChecksum', 128);
  if (documentChecksum && !/^[a-f0-9]{64}$/i.test(documentChecksum)) {
    fail('documentChecksum must be a SHA-256 hex digest.');
  }
  return {
    receiptId: recordId(input.receiptId, 'receiptId'),
    analysisId: recordId(input.analysisId, 'analysisId'),
    documentChecksum,
    invoice,
    accountingCurrency,
    exchangeRate: parseExchangeRate(input.exchangeRate, invoice.currency, accountingCurrency),
    costBasis,
    additionalCostsSource: number(input.additionalCostsSource, 'additionalCostsSource'),
    lines,
    sources,
  };
}

export function parseInvoiceReceiptReversalCommandPayload(value: unknown): InvoiceReceiptReversalCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invoice receipt reversal payload must be an object.');
  const input = value as Record<string, unknown>;
  return {
    receiptId: recordId(input.receiptId, 'receiptId'),
    reason: text(input.reason, 'reason', 500, true),
  };
}

function normalizedFingerprintText(value: string | undefined): string {
  return (value || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
}

export function invoiceDuplicateFingerprint(invoice: InvoiceHeaderDraft): string {
  const supplier = normalizedFingerprintText(invoice.supplierCompanyId || invoice.supplierName);
  const number = normalizedFingerprintText(invoice.invoiceNumber);
  if (supplier && number) return `number:${supplier}:${number}`;
  const total = Number.isFinite(invoice.total) ? Number(invoice.total).toFixed(2) : '';
  if (supplier && invoice.invoiceDate && total) {
    return `facts:${supplier}:${invoice.invoiceDate}:${String(invoice.currency || '').toUpperCase()}:${total}`;
  }
  return `weak:${supplier}:${invoice.invoiceDate || ''}:${String(invoice.currency || '').toUpperCase()}:${total}`;
}

function lineSourceBase(line: InvoiceReceiptLineInput, costBasis: InvoiceCostBasis): number {
  const fallbackNet = line.stockQuantity * line.sourceCostPerStockUnit;
  if (costBasis === 'gross') {
    return Math.max(0, line.lineTotal ?? ((line.lineNetAmount ?? fallbackNet) + (line.taxAmount ?? 0)));
  }
  return Math.max(0, line.lineNetAmount ?? fallbackNet);
}

function enrichedFields(
  line: InvoiceReceiptLineInput,
  sources: InvoiceSourceReference[],
): Partial<InventoryItem> {
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const selectedSources = line.sourceIds.map(id => sourceById.get(id)).filter(Boolean) as InvoiceSourceReference[];
  return {
    supplierName: line.supplierName,
    sku: line.sku,
    brandName: line.brandName,
    manufacturerName: line.manufacturerName,
    packageSize: line.packageSize,
    packageUnit: line.packageUnit,
    activeIngredients: line.activeIngredients,
    recommendedDosage: line.recommendedDosage,
    usageInstructions: line.usageInstructions,
    safetyNotes: line.safetyNotes,
    productSourceUrls: selectedSources.map(source => source.url),
    officialSourceUrls: selectedSources.filter(source => source.official).map(source => source.url),
  };
}

export function applyInvoiceReceiptCommand(
  state: InvoiceReceiptCommandState,
  rawPayload: unknown,
  context: InvoiceReceiptCommandContext,
): { state: InvoiceReceiptCommandState; result: InvoiceReceiptCommandResult } {
  const payload = parseInvoiceReceiptCommandPayload(rawPayload);
  if (state.invoiceReceipts.some(receipt => receipt.id === payload.receiptId)) {
    throw new InvoiceReceiptCommandError('invoice_receipt_id_conflict', 'Invoice receipt id already exists.', 409);
  }
  if (payload.lines.some(line => state.inventoryMovements.some(movement => movement.id === line.movementId))) {
    throw new InvoiceReceiptCommandError('inventory_movement_id_conflict', 'An inventory movement id already exists.', 409);
  }

  const duplicateFingerprint = invoiceDuplicateFingerprint(payload.invoice);
  const duplicate = state.invoiceReceipts.find(receipt => receipt.status === 'posted' && (
    (payload.documentChecksum && receipt.documentChecksum === payload.documentChecksum)
    || (!duplicateFingerprint.startsWith('weak:') && receipt.duplicateFingerprint === duplicateFingerprint)
  ));
  if (duplicate) {
    throw new InvoiceReceiptCommandError(
      'duplicate_invoice_receipt',
      `This invoice appears to have already been posted as receipt ${duplicate.id}.`,
      409,
    );
  }

  const inventory = state.inventory.map(item => ({ ...item }));
  const sourceBases = payload.lines.map(line => lineSourceBase(line, payload.costBasis));
  const baseTotal = sourceBases.reduce((sum, amount) => sum + amount, 0);
  const equalAllocation = payload.lines.length ? payload.additionalCostsSource / payload.lines.length : 0;
  const postedAt = context.performedAt.toISOString();
  const receiptLines: InvoiceReceiptLineRecord[] = [];
  const movements: InventoryMovementRecord[] = [];
  const updatedInventoryItems: InventoryItem[] = [];
  let created = 0;
  let updated = 0;

  payload.lines.forEach((line, index) => {
    const allocatedAdditionalCostSource = payload.additionalCostsSource === 0
      ? 0
      : baseTotal > 0 ? payload.additionalCostsSource * (sourceBases[index] / baseTotal) : equalAllocation;
    const sourceCostAmount = sourceBases[index] + allocatedAdditionalCostSource;
    const accountingCostAmount = sourceCostAmount * payload.exchangeRate.rate;
    const accountingUnitCost = accountingCostAmount / line.stockQuantity;

    let inventoryIndex = line.mode === 'receive'
      ? inventory.findIndex(item => item.id === line.inventoryItemId)
      : -1;
    if (line.mode === 'receive' && inventoryIndex < 0) {
      throw new InvoiceReceiptCommandError('inventory_item_not_found', `Inventory item ${line.inventoryItemId} was not found.`, 404);
    }

    let item: InventoryItem;
    let stockBefore = 0;
    let weightedCostBefore = 0;
    if (inventoryIndex >= 0) {
      const existing = inventory[inventoryIndex];
      if (normalizeUnit(existing.unit) !== normalizeUnit(line.stockUnit)) {
        throw new InvoiceReceiptCommandError(
          'inventory_unit_mismatch',
          `${existing.name} is stocked in ${existing.unit}, not ${line.stockUnit}.`,
          409,
        );
      }
      const existingCurrency = String(existing.costCurrency || payload.accountingCurrency).toUpperCase();
      if (existingCurrency !== payload.accountingCurrency) {
        throw new InvoiceReceiptCommandError(
          'inventory_currency_mismatch',
          `${existing.name} is valued in ${existingCurrency}; convert it before receiving in ${payload.accountingCurrency}.`,
          409,
        );
      }
      stockBefore = Math.max(0, Number(existing.stock) || 0);
      weightedCostBefore = Math.max(0, Number(existing.costPerUnit) || 0);
      const stockAfter = stockBefore + line.stockQuantity;
      const weightedCostAfter = ((stockBefore * weightedCostBefore) + accountingCostAmount) / stockAfter;
      item = {
        ...existing,
        ...enrichedFields(line, payload.sources),
        stock: round(stockAfter, 4),
        costPerUnit: round(weightedCostAfter),
        costCurrency: payload.accountingCurrency,
        lastInvoiceReceipt: {
          analysisLineId: line.lineId,
          invoiceNumber: payload.invoice.invoiceNumber,
          invoiceDate: payload.invoice.invoiceDate,
          receivedAt: postedAt,
          supplierName: line.supplierName || payload.invoice.supplierName,
          quantity: line.stockQuantity,
          unit: line.stockUnit,
          unitCost: round(accountingUnitCost),
          lineTotal: round(accountingCostAmount),
          currency: payload.accountingCurrency,
          sourceUnitCost: line.sourceCostPerStockUnit,
          sourceLineTotal: round(sourceCostAmount),
          sourceCurrency: payload.invoice.currency,
          exchangeRate: payload.exchangeRate.rate,
          invoiceReceiptId: payload.receiptId,
        },
        lastCommandId: context.commandId,
        lastModified: postedAt,
      };
      inventory[inventoryIndex] = item;
      updated += 1;
    } else {
      const requestedId = line.inventoryItemId && !inventory.some(existing => existing.id === line.inventoryItemId)
        ? line.inventoryItemId
        : `inv-${payload.receiptId.slice(0, 100)}-${index + 1}`;
      if (inventory.some(existing => existing.id === requestedId)) {
        throw new InvoiceReceiptCommandError('invoice_receipt_id_conflict', `Inventory item id ${requestedId} already exists.`, 409);
      }
      inventoryIndex = inventory.length;
      item = {
        id: requestedId,
        name: line.productName,
        category: line.category,
        stock: round(line.stockQuantity, 4),
        minThreshold: 0,
        unit: line.stockUnit,
        costPerUnit: round(accountingUnitCost),
        costCurrency: payload.accountingCurrency,
        supplierName: line.supplierName || payload.invoice.supplierName,
        ...enrichedFields(line, payload.sources),
        lastInvoiceReceipt: {
          analysisLineId: line.lineId,
          invoiceNumber: payload.invoice.invoiceNumber,
          invoiceDate: payload.invoice.invoiceDate,
          receivedAt: postedAt,
          supplierName: line.supplierName || payload.invoice.supplierName,
          quantity: line.stockQuantity,
          unit: line.stockUnit,
          unitCost: round(accountingUnitCost),
          lineTotal: round(accountingCostAmount),
          currency: payload.accountingCurrency,
          sourceUnitCost: line.sourceCostPerStockUnit,
          sourceLineTotal: round(sourceCostAmount),
          sourceCurrency: payload.invoice.currency,
          exchangeRate: payload.exchangeRate.rate,
          invoiceReceiptId: payload.receiptId,
        },
        lastCommandId: context.commandId,
        lastModified: postedAt,
      };
      inventory.push(item);
      created += 1;
    }

    const movement: InventoryMovementRecord = {
      id: line.movementId,
      commandId: context.commandId,
      kind: 'invoice_receipt',
      direction: 'in',
      occurredAt: postedAt,
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      quantity: round(line.stockQuantity, 4),
      unit: line.stockUnit,
      accountingUnitCost: round(accountingUnitCost),
      accountingAmount: round(accountingCostAmount),
      accountingCurrency: payload.accountingCurrency,
      sourceAmount: round(sourceCostAmount),
      sourceCurrency: payload.invoice.currency,
      invoiceReceiptId: payload.receiptId,
      invoiceLineId: line.lineId,
      stockBefore: round(stockBefore, 4),
      stockAfter: item.stock,
      weightedCostBefore: round(weightedCostBefore),
      weightedCostAfter: item.costPerUnit,
    };
    movements.push(movement);
    updatedInventoryItems.push(item);
    receiptLines.push({
      ...line,
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      allocatedAdditionalCostSource: round(allocatedAdditionalCostSource),
      sourceCostAmount: round(sourceCostAmount),
      accountingCostAmount: round(accountingCostAmount),
      accountingUnitCost: round(accountingUnitCost),
      movementId: movement.id,
    });
  });

  const selectedLinesSourceAmount = receiptLines.reduce((sum, line) => sum + line.sourceCostAmount, 0);
  const receipt: InvoiceReceiptRecord = {
    id: payload.receiptId,
    commandId: context.commandId,
    status: 'posted',
    analysisId: payload.analysisId,
    documentChecksum: payload.documentChecksum,
    duplicateFingerprint,
    invoice: payload.invoice,
    accountingCurrency: payload.accountingCurrency,
    exchangeRate: payload.exchangeRate,
    costBasis: payload.costBasis,
    additionalCostsSource: round(payload.additionalCostsSource),
    selectedLinesSourceAmount: round(selectedLinesSourceAmount),
    selectedLinesAccountingAmount: round(selectedLinesSourceAmount * payload.exchangeRate.rate),
    lines: receiptLines,
    sources: payload.sources,
    postedAt,
    postedBy: context.actorUsername,
  };

  return {
    state: {
      inventory,
      invoiceReceipts: [receipt, ...state.invoiceReceipts],
      inventoryMovements: [...movements, ...state.inventoryMovements],
    },
    result: { receipt, movements, updatedInventoryItems, created, updated },
  };
}

function reversalMovementId(commandId: string, index: number): string {
  return `imov-reversal-${commandId.replace(/[^\p{L}\p{N}._:-]/gu, '-')}-${index + 1}`.slice(0, 128);
}

export function applyInvoiceReceiptReversalCommand(
  state: InvoiceReceiptCommandState,
  rawPayload: unknown,
  context: InvoiceReceiptCommandContext,
): { state: InvoiceReceiptCommandState; result: InvoiceReceiptReversalCommandResult } {
  const payload = parseInvoiceReceiptReversalCommandPayload(rawPayload);
  const receiptIndex = state.invoiceReceipts.findIndex(receipt => receipt.id === payload.receiptId);
  if (receiptIndex < 0) {
    throw new InvoiceReceiptCommandError('invoice_receipt_not_found', 'Invoice receipt was not found.', 404);
  }
  const original = state.invoiceReceipts[receiptIndex];
  if (original.status === 'reversed') {
    throw new InvoiceReceiptCommandError('invoice_receipt_already_reversed', 'Invoice receipt is already reversed.', 409);
  }

  const inventory = state.inventory.map(item => ({ ...item }));
  const reversedAt = context.performedAt.toISOString();
  const movements: InventoryMovementRecord[] = [];
  const updatedInventoryItems: InventoryItem[] = [];

  original.lines.forEach((line, index) => {
    const itemIndex = inventory.findIndex(item => item.id === line.inventoryItemId);
    if (itemIndex < 0) {
      throw new InvoiceReceiptCommandError('inventory_item_not_found', `Inventory item ${line.inventoryItemId} was not found.`, 404);
    }
    const item = inventory[itemIndex];
    const stockBefore = Math.max(0, Number(item.stock) || 0);
    const weightedCostBefore = Math.max(0, Number(item.costPerUnit) || 0);
    if (stockBefore + 0.000001 < line.stockQuantity) {
      throw new InvoiceReceiptCommandError(
        'insufficient_inventory_for_reversal',
        `${item.name} has ${stockBefore} ${item.unit}; ${line.stockQuantity} is required to reverse this receipt.`,
        409,
      );
    }
    const originalMovement = state.inventoryMovements.find(movement => movement.id === line.movementId);
    const unchangedSinceReceipt = originalMovement
      && Math.abs(stockBefore - originalMovement.stockAfter) <= 0.000001
      && Math.abs(weightedCostBefore - originalMovement.weightedCostAfter) <= 0.000001;
    const stockAfter = unchangedSinceReceipt
      ? originalMovement.stockBefore
      : Math.max(0, stockBefore - line.stockQuantity);
    const remainingValue = unchangedSinceReceipt
      ? originalMovement.stockBefore * originalMovement.weightedCostBefore
      : (stockBefore * weightedCostBefore) - line.accountingCostAmount;
    if (remainingValue < -0.01) {
      throw new InvoiceReceiptCommandError(
        'inventory_value_would_be_negative',
        `Reversing ${item.name} would create a negative inventory value. Reconcile later receipts or adjustments first.`,
        409,
      );
    }
    const weightedCostAfter = unchangedSinceReceipt
      ? originalMovement.weightedCostBefore
      : stockAfter > 0 ? Math.max(0, remainingValue) / stockAfter : 0;
    const updatedItem: InventoryItem = {
      ...item,
      stock: round(stockAfter, 4),
      costPerUnit: round(weightedCostAfter),
      lastCommandId: context.commandId,
      lastModified: reversedAt,
    };
    inventory[itemIndex] = updatedItem;
    updatedInventoryItems.push(updatedItem);
    movements.push({
      id: reversalMovementId(context.commandId, index),
      commandId: context.commandId,
      kind: 'invoice_receipt_reversal',
      direction: 'out',
      occurredAt: reversedAt,
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      quantity: line.stockQuantity,
      unit: line.stockUnit,
      accountingUnitCost: line.accountingUnitCost,
      accountingAmount: -line.accountingCostAmount,
      accountingCurrency: original.accountingCurrency,
      sourceAmount: -line.sourceCostAmount,
      sourceCurrency: original.invoice.currency,
      invoiceReceiptId: original.id,
      invoiceLineId: line.lineId,
      reversalOfMovementId: line.movementId,
      stockBefore: round(stockBefore, 4),
      stockAfter: round(stockAfter, 4),
      weightedCostBefore: round(weightedCostBefore),
      weightedCostAfter: round(weightedCostAfter),
    });
  });

  if (movements.some(movement => state.inventoryMovements.some(existing => existing.id === movement.id))) {
    throw new InvoiceReceiptCommandError('inventory_movement_id_conflict', 'A reversal movement id already exists.', 409);
  }
  const receipt: InvoiceReceiptRecord = {
    ...original,
    status: 'reversed',
    reversedAt,
    reversedBy: context.actorUsername,
    reversedByCommandId: context.commandId,
    reversalReason: payload.reason,
    reversalMovementIds: movements.map(movement => movement.id),
  };
  const invoiceReceipts = [...state.invoiceReceipts];
  invoiceReceipts[receiptIndex] = receipt;

  return {
    state: {
      inventory,
      invoiceReceipts,
      inventoryMovements: [...movements, ...state.inventoryMovements],
    },
    result: { receipt, movements, updatedInventoryItems },
  };
}
