import { randomUUID } from 'crypto';
import { getPrismaClientForAdmin } from '../db';
import {
  PLAN_CATALOG,
  isBillingInterval,
  isPlanId,
  planById,
  priceFor,
  subscriptionPriceMinor,
  type BillingFeature,
  type BillingInterval,
  type PlanId,
} from '../../lib/billing/planCatalog';
import {
  addBillingInterval,
  capacityState,
  hasEntitlement,
  productionLitersForYear,
  type SubscriptionEntitlementInput,
  type SubscriptionStatus,
} from '../../lib/billing/subscription';
import { getBillingProvider } from './providers';
import {
  BillingProviderError,
  type BillingProvider,
  type ProviderPaymentResult,
} from './provider';
import { openBillingToken, sealBillingToken } from './tokenSeal';

export class BillingStorageError extends Error {
  constructor(message = 'Subscription storage is unavailable. Apply database migrations and configure PostgreSQL.') {
    super(message);
    this.name = 'BillingStorageError';
  }
}

function jsonObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function entitlementInput(row: any | null): SubscriptionEntitlementInput {
  if (!row) {
    return {
      planId: 'professional',
      status: 'active',
      legacyAccess: true,
    };
  }
  return {
    planId: isPlanId(row.planId) ? row.planId : 'micro',
    status: String(row.status || 'expired') as SubscriptionStatus,
    capacityOverrideLiters: typeof row.capacityOverrideLiters === 'number' ? row.capacityOverrideLiters : null,
    featureOverrides: jsonObject(row.featureOverrides),
  };
}

async function billingDb(): Promise<any> {
  const prisma = await getPrismaClientForAdmin();
  if (!prisma
    || !(prisma as any).organizationSubscription
    || !(prisma as any).billingPayment
    || !(prisma as any).subscriptionRequest
    || !(prisma as any).subscriptionAudit
    || !(prisma as any).annualProductionUsage) {
    throw new BillingStorageError();
  }
  return prisma as any;
}

function publicSubscription(row: any | null): any {
  if (!row) {
    return {
      id: null,
      planId: 'professional',
      billingInterval: 'custom',
      status: 'active',
      startsAt: null,
      renewsAt: null,
      trialEndsAt: null,
      capacityOverrideLiters: null,
      featureOverrides: {},
      customPriceMinor: null,
      gracePeriodDays: 30,
      capacityExceededAt: null,
      cancelAtPeriodEnd: false,
      provider: null,
      providerCardMask: null,
      legacyAccess: true,
    };
  }
  return {
    organizationId: row?.organizationId || null,
    id: row.id,
    planId: isPlanId(row.planId) ? row.planId : 'micro',
    billingInterval: isBillingInterval(row.billingInterval) ? row.billingInterval : 'custom',
    status: row.status,
    startsAt: row.startsAt,
    renewsAt: row.renewsAt,
    endsAt: row.endsAt,
    trialEndsAt: row.trialEndsAt,
    capacityOverrideLiters: row.capacityOverrideLiters,
    featureOverrides: jsonObject(row.featureOverrides),
    customPriceMinor: row.customPriceMinor,
    gracePeriodDays: row.gracePeriodDays,
    capacityExceededAt: row.capacityExceededAt,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    provider: row.provider,
    providerCardMask: row.providerCardMask,
    legacyAccess: false,
  };
}

export async function getOrganizationBillingSnapshot(organizationId: string, year = new Date().getUTCFullYear()) {
  const prisma = await billingDb();
  const [subscription, usage] = await Promise.all([
    prisma.organizationSubscription.findUnique({ where: { organizationId } }),
    prisma.annualProductionUsage.findUnique({
      where: { organizationId_productionYear: { organizationId, productionYear: year } },
    }),
  ]);
  const input = entitlementInput(subscription);
  const usedLiters = Number(usage?.litersProcessed || 0);
  const productionCapacity = capacityState(usedLiters, input);
  const capacityExceededAt = subscription?.capacityExceededAt
    ? new Date(subscription.capacityExceededAt)
    : null;
  const capacityGraceEndsAt = capacityExceededAt
    ? new Date(capacityExceededAt.getTime() + Math.max(0, subscription?.gracePeriodDays || 0) * 86_400_000)
    : null;
  return {
    subscription: publicSubscription(subscription),
    productionYear: year,
    usage: productionCapacity,
    capacityGrace: {
      exceededAt: capacityExceededAt,
      endsAt: capacityGraceEndsAt,
      active: productionCapacity.level === 'exceeded'
        && capacityGraceEndsAt !== null
        && capacityGraceEndsAt.getTime() > Date.now(),
    },
    entitlements: Object.fromEntries(
      [...new Set(PLAN_CATALOG.flatMap(plan => [...plan.features]))]
        .map(feature => [feature, hasEntitlement(input, feature)]),
    ),
  };
}

export async function organizationHasFeature(organizationId: string, feature: BillingFeature): Promise<boolean> {
  try {
    const prisma = await billingDb();
    const subscription = await prisma.organizationSubscription.findUnique({ where: { organizationId } });
    return hasEntitlement(entitlementInput(subscription), feature);
  } catch (error) {
    // JSON-only installations predate subscriptions and keep legacy access.
    // A configured PostgreSQL outage still throws from the actual query and
    // therefore fails closed in the middleware.
    if (error instanceof BillingStorageError) return true;
    throw error;
  }
}

export async function recordProductionUsage(
  organizationId: string,
  organizationData: unknown,
  year = new Date().getUTCFullYear(),
): Promise<void> {
  let prisma: any;
  try {
    prisma = await billingDb();
  } catch (error) {
    if (error instanceof BillingStorageError) return;
    throw error;
  }
  const litersProcessed = productionLitersForYear(organizationData, year);
  await prisma.annualProductionUsage.upsert({
    where: { organizationId_productionYear: { organizationId, productionYear: year } },
    create: {
      organizationId,
      productionYear: year,
      litersProcessed,
      source: 'derived_lots',
      lastCalculatedAt: new Date(),
    },
    update: {
      litersProcessed,
      source: 'derived_lots',
      lastCalculatedAt: new Date(),
    },
  });
  const subscription = await prisma.organizationSubscription.findUnique({ where: { organizationId } });
  if (!subscription) return;
  const exceeded = capacityState(litersProcessed, entitlementInput(subscription)).level === 'exceeded';
  if (exceeded && !subscription.capacityExceededAt) {
    await prisma.organizationSubscription.update({
      where: { organizationId },
      data: { capacityExceededAt: new Date() },
    });
  } else if (!exceeded && subscription.capacityExceededAt) {
    await prisma.organizationSubscription.update({
      where: { organizationId },
      data: { capacityExceededAt: null },
    });
  }
}

export async function startOrganizationTrial(organizationId: string, actorUsername: string): Promise<void> {
  let prisma: any;
  try {
    prisma = await billingDb();
  } catch (error) {
    if (error instanceof BillingStorageError) return;
    throw error;
  }
  const existing = await prisma.organizationSubscription.findUnique({ where: { organizationId } });
  if (existing) return;
  const startsAt = new Date();
  const trialEndsAt = new Date(startsAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  await prisma.$transaction(async (tx: any) => {
    await tx.organizationSubscription.create({
      data: {
        organizationId,
        planId: 'professional',
        billingInterval: 'annual',
        status: 'trialing',
        startsAt,
        trialEndsAt,
        endsAt: trialEndsAt,
      },
    });
    await tx.subscriptionAudit.create({
      data: {
        organizationId,
        actorUsername,
        action: 'trial.started',
        nextValue: { planId: 'professional', billingInterval: 'annual', status: 'trialing', trialEndsAt },
      },
    });
  });
}

function merchantPaymentId(): string {
  return `cf-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export async function createCheckout(input: {
  organizationId: string;
  actorUsername: string;
  planId: PlanId;
  billingInterval: 'monthly' | 'annual';
  returnUrl: string;
  callbackUrl: string;
  language: 'KA' | 'EN';
  customerIp?: string;
  provider?: BillingProvider;
}) {
  const plan = planById(input.planId);
  if (plan.id === 'enterprise') {
    throw new BillingProviderError('Enterprise plans require a quotation.', 400, 'quotation_required');
  }
  const priceGel = priceFor(input.planId, input.billingInterval);
  if (priceGel === null) throw new BillingProviderError('This plan cannot be purchased directly.', 400, 'price_unavailable');
  const prisma = await billingDb();
  const provider = input.provider || getBillingProvider();
  if (!provider.configured) {
    throw new BillingProviderError('Online checkout is not configured yet. Contact VinOS sales.', 503, 'provider_not_configured');
  }
  const merchantId = merchantPaymentId();
  const payment = await prisma.billingPayment.create({
    data: {
      organizationId: input.organizationId,
      provider: provider.id,
      merchantPaymentId: merchantId,
      kind: 'checkout',
      planId: input.planId,
      billingInterval: input.billingInterval,
      amountMinor: priceGel * 100,
      currency: 'GEL',
      status: 'initiating',
    },
  });

  try {
    const checkoutReturnUrl = new URL(input.returnUrl);
    checkoutReturnUrl.searchParams.set('payment', payment.id);
    const result = await provider.createCheckout({
      merchantPaymentId: merchantId,
      amountMinor: payment.amountMinor,
      currency: 'GEL',
      returnUrl: checkoutReturnUrl.toString(),
      callbackUrl: input.callbackUrl,
      language: input.language,
      description: `VinOS ${plan.name.en}`,
      customerIp: input.customerIp,
      saveCard: provider.supportsRecurring,
    });
    await prisma.$transaction([
      prisma.billingPayment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId: result.providerPaymentId,
          status: result.status,
        },
      }),
      prisma.subscriptionAudit.create({
        data: {
          organizationId: input.organizationId,
          actorUsername: input.actorUsername,
          action: 'checkout.created',
          nextValue: {
            paymentId: payment.id,
            provider: provider.id,
            planId: input.planId,
            billingInterval: input.billingInterval,
            amountMinor: payment.amountMinor,
          },
        },
      }),
    ]);
    return {
      paymentId: payment.id,
      status: result.status,
      approvalUrl: result.approvalUrl,
      recurringEnabled: provider.supportsRecurring,
    };
  } catch (error) {
    const providerError = error instanceof BillingProviderError ? error : null;
    await prisma.billingPayment.update({
      where: { id: payment.id },
      data: {
        status: 'failed',
        failureCode: providerError?.providerCode || 'provider_error',
        failureMessage: providerError?.message || 'Payment provider request failed.',
      },
    });
    throw error;
  }
}

function verifiedPaymentMatches(payment: any, result: ProviderPaymentResult): boolean {
  return result.providerPaymentId === payment.providerPaymentId
    && result.currency === payment.currency
    && result.amountMinor === payment.amountMinor;
}

async function applyVerifiedPaymentResult(
  paymentId: string,
  result: ProviderPaymentResult,
  actorUsername: string,
): Promise<{ known: true; applied: boolean; status: string }> {
  const prisma = await billingDb();
  return prisma.$transaction(async (tx: any) => {
    const payment = await tx.billingPayment.findUnique({ where: { id: paymentId } });
    if (!payment) return { known: true, applied: false, status: 'unknown' };
    if (payment.status === 'succeeded') return { known: true, applied: false, status: 'succeeded' };

    if (!verifiedPaymentMatches(payment, result)) {
      await tx.billingPayment.update({
        where: { id: payment.id },
        data: {
          status: 'review_required',
          failureCode: 'provider_amount_or_currency_mismatch',
          failureMessage: 'Provider payment details did not match the server-created payment.',
        },
      });
      await tx.subscriptionAudit.create({
        data: {
          organizationId: payment.organizationId,
          actorUsername,
          action: 'payment.verification_failed',
          metadata: { paymentId: payment.id, providerPaymentId: result.providerPaymentId },
        },
      });
      return { known: true, applied: false, status: 'review_required' };
    }

    await tx.billingPayment.update({
      where: { id: payment.id },
      data: {
        status: result.status,
        failureCode: result.failureCode || null,
        failureMessage: result.failureMessage || null,
        paidAt: result.status === 'succeeded' ? new Date() : null,
      },
    });
    if (result.status !== 'succeeded') {
      return { known: true, applied: false, status: result.status };
    }

    const previous = await tx.organizationSubscription.findUnique({
      where: { organizationId: payment.organizationId },
    });
    const now = new Date();
    const interval = payment.billingInterval as BillingInterval;
    const renewalBase = payment.kind === 'renewal' && previous?.renewsAt && previous.renewsAt > now
      ? previous.renewsAt
      : now;
    const renewsAt = addBillingInterval(renewalBase, interval);
    const nextData = {
      planId: payment.planId,
      billingInterval: payment.billingInterval,
      status: 'active',
      startsAt: payment.kind === 'renewal' && previous?.startsAt ? previous.startsAt : now,
      renewsAt,
      endsAt: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      provider: payment.provider,
      providerRecurringId: result.recurringId ? sealBillingToken(result.recurringId) : previous?.providerRecurringId || null,
      providerCardMask: result.cardMask || previous?.providerCardMask || null,
      providerCardExpiry: result.cardExpiry || previous?.providerCardExpiry || null,
    };
    await tx.organizationSubscription.upsert({
      where: { organizationId: payment.organizationId },
      create: { organizationId: payment.organizationId, ...nextData },
      update: nextData,
    });
    await tx.subscriptionAudit.create({
      data: {
        organizationId: payment.organizationId,
        actorUsername,
        action: payment.kind === 'renewal' ? 'subscription.renewed' : 'subscription.activated',
        previousValue: previous ? publicSubscription(previous) : undefined,
        nextValue: { ...nextData, paymentId: payment.id },
      },
    });
    return { known: true, applied: true, status: 'succeeded' };
  });
}

export async function reconcileProviderPayment(
  providerPaymentId: string,
  provider: BillingProvider = getBillingProvider(),
) {
  const prisma = await billingDb();
  const payment = await prisma.billingPayment.findUnique({ where: { providerPaymentId } });
  if (!payment) return { known: false, applied: false, status: 'unknown' } as const;
  const result = await provider.getPayment(providerPaymentId);
  return applyVerifiedPaymentResult(payment.id, result, `provider:${provider.id}`);
}

export async function reconcileOrganizationPayment(
  organizationId: string,
  paymentId: string,
) {
  const prisma = await billingDb();
  const payment = await prisma.billingPayment.findFirst({ where: { id: paymentId, organizationId } });
  if (!payment) return null;
  if (payment.status === 'succeeded' || !payment.providerPaymentId) {
    return { known: true, applied: false, status: payment.status };
  }
  const provider = getBillingProvider(payment.provider);
  const result = await provider.getPayment(payment.providerPaymentId);
  return applyVerifiedPaymentResult(payment.id, result, `customer-return:${organizationId}`);
}

export async function getOrganizationPayment(organizationId: string, paymentId: string) {
  const prisma = await billingDb();
  const payment = await prisma.billingPayment.findFirst({ where: { id: paymentId, organizationId } });
  if (!payment) return null;
  return {
    id: payment.id,
    provider: payment.provider,
    kind: payment.kind,
    planId: payment.planId,
    billingInterval: payment.billingInterval,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    status: payment.status,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
  };
}

export async function createSubscriptionRequest(input: {
  organizationId: string;
  requestedBy: string;
  requestType: 'upgrade' | 'downgrade' | 'quotation';
  requestedPlanId?: PlanId;
  requestedBillingInterval?: BillingInterval;
  message?: string;
}) {
  if (input.requestType !== 'quotation' && !input.requestedPlanId) {
    throw new Error('A requested plan is required.');
  }
  const prisma = await billingDb();
  return prisma.subscriptionRequest.create({
    data: {
      organizationId: input.organizationId,
      requestedBy: input.requestedBy,
      requestType: input.requestType,
      requestedPlanId: input.requestedPlanId || 'enterprise',
      requestedBillingInterval: input.requestedBillingInterval || 'custom',
      message: String(input.message || '').trim().slice(0, 1000) || null,
    },
  });
}

export async function scheduleCancellation(organizationId: string, actorUsername: string) {
  const prisma = await billingDb();
  return prisma.$transaction(async (tx: any) => {
    const previous = await tx.organizationSubscription.findUnique({ where: { organizationId } });
    if (!previous) throw new Error('No subscription exists for this organization.');
    const next = await tx.organizationSubscription.update({
      where: { organizationId },
      data: { cancelAtPeriodEnd: true },
    });
    await tx.subscriptionAudit.create({
      data: {
        organizationId,
        actorUsername,
        action: 'subscription.cancellation_scheduled',
        previousValue: publicSubscription(previous),
        nextValue: publicSubscription(next),
      },
    });
    return publicSubscription(next);
  });
}

export async function listAdminBilling() {
  const prisma = await billingDb();
  const [organizations, subscriptions, requests] = await Promise.all([
    prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 1000 }),
    prisma.organizationSubscription.findMany({ orderBy: { updatedAt: 'desc' }, take: 500 }),
    prisma.subscriptionRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
  ]);
  return { organizations, subscriptions: subscriptions.map(publicSubscription), requests };
}

export async function adminAssignSubscription(input: {
  organizationId: string;
  actorUsername: string;
  planId: PlanId;
  billingInterval: BillingInterval;
  status: SubscriptionStatus;
  renewsAt?: Date | null;
  capacityOverrideLiters?: number | null;
  featureOverrides?: Record<string, boolean>;
  customPriceMinor?: number | null;
}) {
  const prisma = await billingDb();
  return prisma.$transaction(async (tx: any) => {
    const previous = await tx.organizationSubscription.findUnique({ where: { organizationId: input.organizationId } });
    const data = {
      planId: input.planId,
      billingInterval: input.billingInterval,
      status: input.status,
      startsAt: previous?.startsAt || new Date(),
      renewsAt: input.renewsAt || null,
      capacityOverrideLiters: input.capacityOverrideLiters ?? null,
      featureOverrides: input.featureOverrides || {},
      customPriceMinor: input.customPriceMinor ?? null,
    };
    const next = await tx.organizationSubscription.upsert({
      where: { organizationId: input.organizationId },
      create: { organizationId: input.organizationId, ...data },
      update: data,
    });
    await tx.subscriptionAudit.create({
      data: {
        organizationId: input.organizationId,
        actorUsername: input.actorUsername,
        action: 'subscription.admin_changed',
        previousValue: previous ? publicSubscription(previous) : undefined,
        nextValue: publicSubscription(next),
      },
    });
    return publicSubscription(next);
  });
}

export async function resolveSubscriptionRequest(requestId: string, actorUsername: string, status: 'approved' | 'rejected') {
  const prisma = await billingDb();
  const request = await prisma.subscriptionRequest.update({
    where: { id: requestId },
    data: { status, resolvedBy: actorUsername, resolvedAt: new Date() },
  });
  await prisma.subscriptionAudit.create({
    data: {
      organizationId: request.organizationId,
      actorUsername,
      action: `request.${status}`,
      metadata: { requestId },
    },
  });
  return request;
}

export async function listSubscriptionAudit(organizationId: string) {
  const prisma = await billingDb();
  return prisma.subscriptionAudit.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function processDueRenewals(
  provider: BillingProvider = getBillingProvider(),
  now = new Date(),
): Promise<{ processed: number; succeeded: number; failed: number; canceled: number }> {
  const prisma = await billingDb();
  const due = await prisma.organizationSubscription.findMany({
    where: {
      provider: provider.id,
      status: { in: ['active', 'past_due', 'grace_period'] },
      renewsAt: { lte: now },
    },
    take: 100,
  });
  const summary = { processed: 0, succeeded: 0, failed: 0, canceled: 0 };
  const isTerminalFailure = (status: string) => [
    'failed', 'expired', 'canceled', 'returned', 'partially_returned', 'review_required',
  ].includes(status);
  for (const subscription of due) {
    summary.processed += 1;
    if (subscription.cancelAtPeriodEnd) {
      try {
        const recurringId = openBillingToken(subscription.providerRecurringId);
        if (subscription.providerRecurringId && !recurringId) throw new Error('Stored recurring token is unavailable after key rotation.');
        if (recurringId) await provider.deleteRecurring(recurringId);
        await prisma.$transaction([
          prisma.organizationSubscription.update({
            where: { id: subscription.id },
            data: { status: 'canceled', endsAt: now, renewsAt: null, providerRecurringId: null },
          }),
          prisma.subscriptionAudit.create({
            data: {
              organizationId: subscription.organizationId,
              actorUsername: 'billing-renewal-job',
              action: 'subscription.canceled',
            },
          }),
        ]);
        summary.canceled += 1;
      } catch {
        summary.failed += 1;
      }
      continue;
    }
    const recurringId = openBillingToken(subscription.providerRecurringId);
    if (!recurringId || !isPlanId(subscription.planId) || !isBillingInterval(subscription.billingInterval)) {
      await prisma.organizationSubscription.update({
        where: { id: subscription.id },
        data: { status: 'past_due' },
      });
      summary.failed += 1;
      continue;
    }
    const amountMinor = subscriptionPriceMinor(
      subscription.planId,
      subscription.billingInterval,
      subscription.customPriceMinor,
    );
    if (amountMinor === null) {
      summary.failed += 1;
      continue;
    }
    const idempotencyKey = `renewal:${subscription.id}:${subscription.renewsAt.toISOString()}`;
    const existing = await prisma.billingPayment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.status === 'succeeded') continue;
      if (!existing.providerPaymentId || isTerminalFailure(existing.status)) {
        await prisma.organizationSubscription.update({
          where: { id: subscription.id },
          data: { status: 'past_due' },
        });
        summary.failed += 1;
        continue;
      }
      try {
        const result = await provider.getPayment(existing.providerPaymentId);
        const reconciliation = await applyVerifiedPaymentResult(
          existing.id,
          result,
          'billing-renewal-job',
        );
        if (reconciliation.status === 'succeeded') {
          summary.succeeded += 1;
        } else if (isTerminalFailure(reconciliation.status)) {
          await prisma.organizationSubscription.update({
            where: { id: subscription.id },
            data: { status: 'past_due' },
          });
          summary.failed += 1;
        }
      } catch {
        // Keep the idempotent payment pending so a later run can query it
        // again without risking a duplicate merchant-initiated charge.
      }
      continue;
    }
    const merchantId = merchantPaymentId();
    const payment = await prisma.billingPayment.create({
      data: {
        organizationId: subscription.organizationId,
        provider: provider.id,
        merchantPaymentId: merchantId,
        idempotencyKey,
        kind: 'renewal',
        planId: subscription.planId,
        billingInterval: subscription.billingInterval,
        amountMinor,
        currency: 'GEL',
        status: 'initiating',
      },
    });
    try {
      const result = await provider.chargeRecurring({
        merchantPaymentId: merchantId,
        amountMinor,
        currency: 'GEL',
        recurringId,
      });
      await prisma.billingPayment.update({
        where: { id: payment.id },
        data: { providerPaymentId: result.providerPaymentId, status: result.status },
      });
      const reconciliation = await applyVerifiedPaymentResult(payment.id, result, 'billing-renewal-job');
      if (reconciliation.status === 'succeeded') {
        summary.succeeded += 1;
      } else if (isTerminalFailure(reconciliation.status)) {
        await prisma.organizationSubscription.update({
          where: { id: subscription.id },
          data: { status: 'past_due' },
        });
        summary.failed += 1;
      }
    } catch (error) {
      await prisma.billingPayment.update({
        where: { id: payment.id },
        data: {
          status: 'failed',
          failureCode: error instanceof BillingProviderError ? error.providerCode : 'provider_error',
          failureMessage: error instanceof Error ? error.message : 'Recurring charge failed.',
        },
      });
      await prisma.organizationSubscription.update({
        where: { id: subscription.id },
        data: { status: 'past_due' },
      });
      summary.failed += 1;
    }
  }
  return summary;
}
