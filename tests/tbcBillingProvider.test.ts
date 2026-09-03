import { describe, expect, it, vi } from 'vitest';
import { TbcBillingProvider, type TbcConfig } from '../server/billing/providers/tbc';

const config: TbcConfig = {
  apiKey: 'test-api-key',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  baseUrl: 'https://api.tbcbank.ge',
  recurringEnabled: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TBC billing provider', () => {
  it('gets a token and creates a GEL checkout with recurring-card consent', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/v1/tpay/access-token')) {
        expect(String(init?.body)).toContain('client_id=test-client');
        return jsonResponse({ access_token: 'token-value', expires_in: 86_400 });
      }
      const headers = new Headers(init?.headers);
      expect(headers.get('apikey')).toBe('test-api-key');
      expect(headers.get('authorization')).toBe('Bearer token-value');
      const body = JSON.parse(String(init?.body));
      expect(body.amount).toEqual({ currency: 'GEL', total: 490 });
      expect(body.saveCard).toBe(true);
      expect(body.preAuth).toBe(false);
      return jsonResponse({
        payId: 'tpay-test-1',
        status: 'Created',
        currency: 'GEL',
        amount: 490,
        links: [{ uri: 'https://tpay.tbcbank.ge/checkout/test', method: 'REDIRECT', rel: 'approval_url' }],
        recId: 'rec-test-1',
      });
    });
    const provider = new TbcBillingProvider(config, fetchMock as typeof fetch);

    const result = await provider.createCheckout({
      merchantPaymentId: 'cf-test',
      amountMinor: 49_000,
      currency: 'GEL',
      returnUrl: 'https://cellarflow.example/pricing',
      callbackUrl: 'https://cellarflow.example/api/billing/tbc/callback',
      language: 'EN',
      description: 'Cellarflow Micro',
      saveCard: true,
    });

    expect(result).toEqual(expect.objectContaining({
      providerPaymentId: 'tpay-test-1',
      status: 'created',
      amountMinor: 49_000,
      approvalUrl: 'https://tpay.tbcbank.ge/checkout/test',
      recurringId: 'rec-test-1',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retrieves authoritative success details and saved-card metadata', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/access-token')) return jsonResponse({ access_token: 'token-value' });
      return jsonResponse({
        payId: 'tpay-test-2',
        status: 'Succeeded',
        currency: 'GEL',
        amount: 1490,
        recurringCard: { recId: 'rec-2', cardMask: '411111******1111', expiryDate: '1030' },
      });
    });
    const provider = new TbcBillingProvider(config, fetchMock as typeof fetch);

    await expect(provider.getPayment('tpay-test-2')).resolves.toEqual(expect.objectContaining({
      providerPaymentId: 'tpay-test-2',
      status: 'succeeded',
      amountMinor: 149_000,
      recurringId: 'rec-2',
      cardMask: '411111******1111',
    }));
  });

  it('fails closed when credentials are missing', async () => {
    const provider = new TbcBillingProvider({ ...config, apiKey: '' }, vi.fn() as unknown as typeof fetch);
    expect(provider.configured).toBe(false);
    await expect(provider.getPayment('pay-id')).rejects.toMatchObject({
      providerCode: 'provider_not_configured',
      statusCode: 503,
    });
  });
});
