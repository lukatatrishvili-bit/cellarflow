export const SUPPORTED_INVOICE_CURRENCIES = ['GEL', 'EUR', 'USD'] as const;

export type SupportedInvoiceCurrency = typeof SUPPORTED_INVOICE_CURRENCIES[number];

export type ExchangeRateSource = 'nbg_official' | 'manual' | 'identity';

/**
 * One `fromCurrency` unit expressed in `toCurrency` units. The original quote
 * is retained on the receipt so a later rate refresh never rewrites history.
 */
export interface ExchangeRateQuote {
  fromCurrency: SupportedInvoiceCurrency;
  toCurrency: SupportedInvoiceCurrency;
  rate: number;
  requestedDate: string;
  rateDate: string;
  source: ExchangeRateSource;
  sourceLabel: string;
  sourceUrl?: string;
  retrievedAt: string;
}

export function isSupportedInvoiceCurrency(value: unknown): value is SupportedInvoiceCurrency {
  return typeof value === 'string'
    && (SUPPORTED_INVOICE_CURRENCIES as readonly string[]).includes(value.toUpperCase());
}

export function normalizeInvoiceCurrency(value: unknown): SupportedInvoiceCurrency | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return isSupportedInvoiceCurrency(normalized) ? normalized : null;
}

export function convertCurrency(amount: number, quote: Pick<ExchangeRateQuote, 'rate'>): number {
  if (!Number.isFinite(amount) || !Number.isFinite(quote.rate) || quote.rate <= 0) return 0;
  return amount * quote.rate;
}

export function identityExchangeRateQuote(
  currency: SupportedInvoiceCurrency,
  requestedDate: string,
  retrievedAt = new Date().toISOString(),
): ExchangeRateQuote {
  return {
    fromCurrency: currency,
    toCurrency: currency,
    rate: 1,
    requestedDate,
    rateDate: requestedDate,
    source: 'identity',
    sourceLabel: 'Same currency — no conversion',
    retrievedAt,
  };
}
