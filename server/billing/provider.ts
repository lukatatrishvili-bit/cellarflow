export type ProviderPaymentStatus =
  | 'created'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'waiting_confirm'
  | 'canceled'
  | 'returned'
  | 'partially_returned'
  | 'unknown';

export interface ProviderPaymentResult {
  providerPaymentId: string;
  status: ProviderPaymentStatus;
  amountMinor: number;
  currency: string;
  approvalUrl?: string;
  recurringId?: string;
  cardMask?: string;
  cardExpiry?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface CheckoutInput {
  merchantPaymentId: string;
  amountMinor: number;
  currency: 'GEL';
  returnUrl: string;
  callbackUrl: string;
  language: 'KA' | 'EN';
  description: string;
  customerIp?: string;
  saveCard: boolean;
}

export interface RecurringChargeInput {
  merchantPaymentId: string;
  amountMinor: number;
  currency: 'GEL';
  recurringId: string;
}

export interface BillingProvider {
  readonly id: string;
  readonly configured: boolean;
  readonly supportsRecurring: boolean;
  createCheckout(input: CheckoutInput): Promise<ProviderPaymentResult>;
  getPayment(providerPaymentId: string): Promise<ProviderPaymentResult>;
  chargeRecurring(input: RecurringChargeInput): Promise<ProviderPaymentResult>;
  deleteRecurring(recurringId: string): Promise<void>;
}

export class BillingProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 502,
    public readonly providerCode?: string,
  ) {
    super(message);
    this.name = 'BillingProviderError';
  }
}
