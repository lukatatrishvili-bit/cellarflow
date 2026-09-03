import {
  identityExchangeRateQuote,
  type ExchangeRateQuote,
  type SupportedInvoiceCurrency,
} from '../lib/currency';

const NBG_CURRENCY_API = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/';
export const NBG_CURRENCY_PAGE = 'https://nbg.gov.ge/en/monetary-policy/currency';
const MAX_LOOKBACK_DAYS = 7;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface NbgCurrencyRow {
  code?: unknown;
  quantity?: unknown;
  rate?: unknown;
  validFromDate?: unknown;
}

interface CachedQuote {
  expiresAt: number;
  quote: ExchangeRateQuote;
}

const quoteCache = new Map<string, CachedQuote>();

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractUtcDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return isoDate(date);
}

function validPositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseRows(payload: unknown): NbgCurrencyRow[] {
  if (!Array.isArray(payload)) return [];
  const rows: NbgCurrencyRow[] = [];
  for (const day of payload) {
    if (!day || typeof day !== 'object') continue;
    const currencies = (day as { currencies?: unknown }).currencies;
    if (Array.isArray(currencies)) rows.push(...currencies as NbgCurrencyRow[]);
  }
  return rows;
}

async function nbgGelRatesForDate(
  currencies: SupportedInvoiceCurrency[],
  requestedDate: string,
  fetchImpl: typeof fetch,
): Promise<{ rateDate: string; gelPerUnit: Map<SupportedInvoiceCurrency, number> }> {
  const requestedCodes = currencies.filter(currency => currency !== 'GEL');
  if (requestedCodes.length === 0) {
    return { rateDate: requestedDate, gelPerUnit: new Map([['GEL', 1]]) };
  }

  for (let offset = 0; offset <= MAX_LOOKBACK_DAYS; offset += 1) {
    const rateDate = subtractUtcDays(requestedDate, offset);
    const url = new URL(NBG_CURRENCY_API);
    url.searchParams.set('currencies', requestedCodes.join(','));
    url.searchParams.set('date', rateDate);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const rows = parseRows(await response.json());
      const rates = new Map<SupportedInvoiceCurrency, number>([['GEL', 1]]);
      for (const row of rows) {
        const code = typeof row.code === 'string' ? row.code.toUpperCase() : '';
        if (code !== 'EUR' && code !== 'USD') continue;
        const rate = validPositive(row.rate);
        const quantity = validPositive(row.quantity);
        if (rate && quantity) rates.set(code, rate / quantity);
      }
      if (requestedCodes.every(code => rates.has(code))) return { rateDate, gelPerUnit: rates };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`No official NBG rate was available on or before ${requestedDate}.`);
}

export async function getOfficialExchangeRate(
  fromCurrency: SupportedInvoiceCurrency,
  toCurrency: SupportedInvoiceCurrency,
  requestedDate: string,
  options: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<ExchangeRateQuote> {
  const now = options.now || new Date();
  if (fromCurrency === toCurrency) {
    return identityExchangeRateQuote(fromCurrency, requestedDate, now.toISOString());
  }

  const cacheKey = `${fromCurrency}:${toCurrency}:${requestedDate}`;
  const cached = quoteCache.get(cacheKey);
  if (cached && cached.expiresAt > now.getTime()) return cached.quote;

  const { rateDate, gelPerUnit } = await nbgGelRatesForDate(
    [fromCurrency, toCurrency],
    requestedDate,
    options.fetchImpl || fetch,
  );
  const fromGel = gelPerUnit.get(fromCurrency);
  const toGel = gelPerUnit.get(toCurrency);
  if (!fromGel || !toGel) throw new Error('The official rate response was incomplete.');

  const quote: ExchangeRateQuote = {
    fromCurrency,
    toCurrency,
    rate: fromGel / toGel,
    requestedDate,
    rateDate,
    source: 'nbg_official',
    sourceLabel: 'National Bank of Georgia official exchange rate',
    sourceUrl: NBG_CURRENCY_PAGE,
    retrievedAt: now.toISOString(),
  };
  quoteCache.set(cacheKey, { quote, expiresAt: now.getTime() + CACHE_TTL_MS });
  return quote;
}

export function clearExchangeRateCacheForTests(): void {
  quoteCache.clear();
}
