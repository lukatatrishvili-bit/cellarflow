import { cleanEnv } from '../../config';
import {
  BillingProviderError,
  type BillingProvider,
  type CheckoutInput,
  type ProviderPaymentResult,
  type ProviderPaymentStatus,
  type RecurringChargeInput,
} from '../provider';

export interface TbcConfig {
  apiKey: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  recurringEnabled: boolean;
}

interface TokenCache {
  value: string;
  expiresAt: number;
}

type FetchLike = typeof fetch;

const FINAL_STATUS_MAP: Record<string, ProviderPaymentStatus> = {
  created: 'created',
  processing: 'processing',
  succeeded: 'succeeded',
  failed: 'failed',
  expired: 'expired',
  waitingconfirm: 'waiting_confirm',
  cancelpaymentprocessing: 'processing',
  paymentcompletionprocessing: 'processing',
  returned: 'returned',
  partialreturned: 'partially_returned',
  canceled: 'canceled',
  cancelled: 'canceled',
};

function amountToMinor(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function normalizedStatus(value: unknown): ProviderPaymentStatus {
  return FINAL_STATUS_MAP[String(value || '').replace(/[_\s-]/g, '').toLowerCase()] || 'unknown';
}

function linkByRel(payload: any, rel: string): string | undefined {
  if (!Array.isArray(payload?.links)) return undefined;
  const link = payload.links.find((candidate: any) => String(candidate?.rel || '').toLowerCase() === rel);
  return typeof link?.uri === 'string' ? link.uri : undefined;
}

function paymentResult(payload: any): ProviderPaymentResult {
  const recurringCard = payload?.recurringCard && typeof payload.recurringCard === 'object'
    ? payload.recurringCard
    : undefined;
  return {
    providerPaymentId: String(payload?.payId || ''),
    status: normalizedStatus(payload?.status),
    amountMinor: amountToMinor(payload?.amount),
    currency: String(payload?.currency || '').toUpperCase(),
    approvalUrl: linkByRel(payload, 'approval_url'),
    recurringId: String(recurringCard?.recId || payload?.recId || '') || undefined,
    cardMask: String(recurringCard?.cardMask || '') || undefined,
    cardExpiry: String(recurringCard?.expiryDate || '') || undefined,
    failureCode: String(payload?.resultCode || payload?.systemCode || '') || undefined,
    failureMessage: String(payload?.userMessage || payload?.developerMessage || '') || undefined,
  };
}

export function readTbcConfig(): TbcConfig {
  return {
    apiKey: cleanEnv(process.env.TBC_API_KEY),
    clientId: cleanEnv(process.env.TBC_CLIENT_ID),
    clientSecret: cleanEnv(process.env.TBC_CLIENT_SECRET),
    baseUrl: cleanEnv(process.env.TBC_API_BASE_URL) || 'https://api.tbcbank.ge',
    recurringEnabled: cleanEnv(process.env.TBC_RECURRING_ENABLED).toLowerCase() === 'true',
  };
}

export class TbcBillingProvider implements BillingProvider {
  readonly id = 'tbc';
  private token: TokenCache | null = null;

  constructor(
    private readonly config: TbcConfig = readTbcConfig(),
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get configured(): boolean {
    return Boolean(this.config.apiKey && this.config.clientId && this.config.clientSecret);
  }

  get supportsRecurring(): boolean {
    return this.config.recurringEnabled;
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new BillingProviderError('TBC checkout is not configured for this deployment.', 503, 'provider_not_configured');
    }
  }

  private async requestJson(path: string, init: RequestInit, authenticated = true): Promise<any> {
    this.assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const headers = new Headers(init.headers);
      headers.set('apikey', this.config.apiKey);
      headers.set('accept', 'application/json');
      if (authenticated) headers.set('authorization', `Bearer ${await this.accessToken()}`);
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, '')}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = String(payload?.systemCode || payload?.resultCode || `http_${response.status}`);
        const message = String(payload?.detail || payload?.title || payload?.userMessage || 'TBC payment request failed.');
        throw new BillingProviderError(message, response.status >= 400 && response.status < 500 ? 400 : 502, code);
      }
      return payload;
    } catch (error) {
      if (error instanceof BillingProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BillingProviderError('TBC payment request timed out.', 504, 'provider_timeout');
      }
      throw new BillingProviderError('TBC payment service is temporarily unavailable.', 502, 'provider_unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const payload = await this.requestJson('/v1/tpay/access-token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }, false);
    const value = String(payload?.access_token || payload?.accessToken || '');
    if (!value) throw new BillingProviderError('TBC did not return an access token.', 502, 'invalid_token_response');
    const expiresInSeconds = Math.max(300, Number(payload?.expires_in || payload?.expiresIn || 86_400));
    this.token = { value, expiresAt: Date.now() + expiresInSeconds * 1000 };
    return value;
  }

  async createCheckout(input: CheckoutInput): Promise<ProviderPaymentResult> {
    const payload = await this.requestJson('/v1/tpay/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: { currency: input.currency, total: input.amountMinor / 100 },
        returnurl: input.returnUrl,
        callbackUrl: input.callbackUrl,
        preAuth: false,
        language: input.language,
        merchantPaymentId: input.merchantPaymentId,
        description: input.description.slice(0, 30),
        expirationMinutes: 12,
        skipInfoMessage: false,
        ...(input.customerIp ? { userIpAddress: input.customerIp } : {}),
        ...(input.saveCard && this.supportsRecurring ? { saveCard: true } : {}),
      }),
    });
    const result = paymentResult(payload);
    if (!result.providerPaymentId || !result.approvalUrl) {
      throw new BillingProviderError('TBC returned an incomplete checkout response.', 502, 'invalid_checkout_response');
    }
    return result;
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPaymentResult> {
    const safeId = encodeURIComponent(providerPaymentId);
    const payload = await this.requestJson(`/v1/tpay/payments/${safeId}`, { method: 'GET' });
    const result = paymentResult(payload);
    if (!result.providerPaymentId) result.providerPaymentId = providerPaymentId;
    return result;
  }

  async chargeRecurring(input: RecurringChargeInput): Promise<ProviderPaymentResult> {
    if (!this.supportsRecurring) {
      throw new BillingProviderError('Recurring TBC payments are not enabled for this merchant.', 503, 'recurring_not_enabled');
    }
    const payload = await this.requestJson('/v1/tpay/payments/execution', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        money: { currency: input.currency, amount: input.amountMinor / 100 },
        recId: input.recurringId,
        initiator: 'merchant',
        merchantPaymentId: input.merchantPaymentId,
        preAuth: false,
      }),
    });
    const result = paymentResult(payload);
    if (!result.providerPaymentId) {
      throw new BillingProviderError('TBC returned an incomplete recurring payment response.', 502, 'invalid_recurring_response');
    }
    return result;
  }

  async deleteRecurring(recurringId: string): Promise<void> {
    await this.requestJson(`/v1/tpay/payments/${encodeURIComponent(recurringId)}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
  }
}
