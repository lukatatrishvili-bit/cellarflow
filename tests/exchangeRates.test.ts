import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearExchangeRateCacheForTests,
  getOfficialExchangeRate,
} from '../server/exchangeRates';

describe('official NBG exchange rates', () => {
  beforeEach(() => clearExchangeRateCacheForTests());

  it('normalizes NBG quantities and cross-converts EUR to USD through GEL', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{
      date: '2026-08-04T00:00:00.000Z',
      currencies: [
        { code: 'EUR', quantity: 1, rate: 3 },
        { code: 'USD', quantity: 10, rate: 25 },
      ],
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

    const quote = await getOfficialExchangeRate('EUR', 'USD', '2026-08-04', {
      fetchImpl,
      now: new Date('2026-08-04T12:00:00.000Z'),
    });

    expect(quote.rate).toBeCloseTo(1.2, 10);
    expect(quote).toMatchObject({
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rateDate: '2026-08-04',
      source: 'nbg_official',
    });
  });

  it('falls back to the latest prior publication for a non-publishing day', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const requested = url.searchParams.get('date');
      const body = requested === '2026-08-02'
        ? []
        : [{ currencies: [{ code: 'EUR', quantity: 1, rate: 3.02 }] }];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;

    const quote = await getOfficialExchangeRate('EUR', 'GEL', '2026-08-02', {
      fetchImpl,
      now: new Date('2026-08-04T12:00:00.000Z'),
    });

    expect(quote.rate).toBe(3.02);
    expect(quote.requestedDate).toBe('2026-08-02');
    expect(quote.rateDate).toBe('2026-08-01');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns an identity quote without calling NBG', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const quote = await getOfficialExchangeRate('GEL', 'GEL', '2026-08-04', { fetchImpl });
    expect(quote.rate).toBe(1);
    expect(quote.source).toBe('identity');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
