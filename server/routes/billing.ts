import crypto from 'crypto';
import express from 'express';
import { PLAN_CATALOG, isBillingInterval, isPlanId } from '../../lib/billing/planCatalog';
import { changeDirection, type SubscriptionStatus } from '../../lib/billing/subscription';
import { appBaseUrl, cleanEnv, clientIp } from '../config';
import { checkWineryScope, requireMasterAdmin } from '../middleware/auth';
import { getBillingProvider } from '../billing/providers';
import { BillingProviderError } from '../billing/provider';
import {
  BillingStorageError,
  adminAssignSubscription,
  createCheckout,
  createSubscriptionRequest,
  getOrganizationBillingSnapshot,
  getOrganizationPayment,
  listAdminBilling,
  listSubscriptionAudit,
  processDueRenewals,
  reconcileProviderPayment,
  reconcileOrganizationPayment,
  resolveSubscriptionRequest,
  scheduleCancellation,
} from '../billing/service';

const router = express.Router();

function errorResponse(res: express.Response, error: unknown) {
  if (error instanceof BillingProviderError) {
    return res.status(error.statusCode).json({
      code: error.providerCode || 'billing_provider_error',
      error: error.message,
    });
  }
  if (error instanceof BillingStorageError) {
    return res.status(503).json({ code: 'billing_storage_unavailable', error: error.message });
  }
  const message = error instanceof Error ? error.message : 'Billing request failed.';
  return res.status(400).json({ error: message });
}

function safeSecretEquals(expected: string, supplied: string): boolean {
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

router.get('/catalog', (_req, res) => {
  const provider = getBillingProvider();
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    currency: 'GEL',
    annualDefault: true,
    plans: PLAN_CATALOG,
    vatLabel: {
      en: cleanEnv(process.env.BILLING_VAT_LABEL_EN),
      ka: cleanEnv(process.env.BILLING_VAT_LABEL_KA),
    },
    checkout: {
      provider: provider.id,
      configured: provider.configured,
      recurringEnabled: provider.supportsRecurring,
    },
  });
});

router.get('/subscription', checkWineryScope('read'), async (req, res) => {
  const context = (req as any).wineryContext;
  try {
    return res.json(await getOrganizationBillingSnapshot(context.organizationId));
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.post('/checkout', checkWineryScope('admin'), async (req, res) => {
  const context = (req as any).wineryContext;
  const planId = req.body?.planId;
  const billingInterval = req.body?.billingInterval;
  if (!isPlanId(planId)) return res.status(400).json({ error: 'A valid plan is required.' });
  if (billingInterval !== 'monthly' && billingInterval !== 'annual') {
    return res.status(400).json({ error: 'Billing interval must be monthly or annual.' });
  }
  const baseUrl = appBaseUrl(req);
  try {
    const result = await createCheckout({
      organizationId: context.organizationId,
      actorUsername: context.username,
      planId,
      billingInterval,
      returnUrl: `${baseUrl}/pricing?checkout=returned`,
      callbackUrl: `${baseUrl}/api/billing/tbc/callback`,
      language: String(req.body?.language || '').toLowerCase() === 'ka' ? 'KA' : 'EN',
      customerIp: clientIp(req),
    });
    return res.status(201).json(result);
  } catch (error) {
    return errorResponse(res, error);
  }
});

// TBC callbacks are notifications only. The provider API is queried before any
// subscription is activated; callback body fields other than PaymentId are ignored.
router.post('/tbc/callback', async (req, res) => {
  const paymentId = String(req.body?.PaymentId || req.body?.paymentId || '').trim();
  if (!paymentId || paymentId.length > 200) return res.status(400).json({ error: 'PaymentId is required.' });
  try {
    const result = await reconcileProviderPayment(paymentId);
    // Unknown IDs receive a neutral acknowledgement and never trigger a bank lookup.
    return res.status(200).json({ ok: true, known: result.known });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.get('/payments/:paymentId', checkWineryScope('read'), async (req, res) => {
  const context = (req as any).wineryContext;
  try {
    const payment = await getOrganizationPayment(context.organizationId, String(req.params.paymentId));
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });
    return res.json({ payment });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.post('/payments/:paymentId/reconcile', checkWineryScope('admin'), async (req, res) => {
  const context = (req as any).wineryContext;
  try {
    const result = await reconcileOrganizationPayment(context.organizationId, String(req.params.paymentId));
    if (!result) return res.status(404).json({ error: 'Payment not found.' });
    return res.json(result);
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.post('/requests', checkWineryScope('read'), async (req, res) => {
  const context = (req as any).wineryContext;
  const requestedPlanId = req.body?.planId;
  const requestedBillingInterval = req.body?.billingInterval;
  if (!isPlanId(requestedPlanId)) return res.status(400).json({ error: 'A valid requested plan is required.' });
  if (!isBillingInterval(requestedBillingInterval)) return res.status(400).json({ error: 'A valid billing interval is required.' });
  try {
    const current = await getOrganizationBillingSnapshot(context.organizationId);
    const requestType = requestedPlanId === 'enterprise'
      ? 'quotation'
      : changeDirection(current.subscription.planId, requestedPlanId);
    if (requestType === 'same') return res.status(409).json({ error: 'This is already the organization plan.' });
    const request = await createSubscriptionRequest({
      organizationId: context.organizationId,
      requestedBy: context.username,
      requestType,
      requestedPlanId,
      requestedBillingInterval,
      message: req.body?.message,
    });
    return res.status(201).json({ request });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.post('/cancel', checkWineryScope('admin'), async (req, res) => {
  const context = (req as any).wineryContext;
  try {
    const subscription = await scheduleCancellation(context.organizationId, context.username);
    return res.json({ subscription });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.get('/audit', checkWineryScope('admin'), async (req, res) => {
  const context = (req as any).wineryContext;
  try {
    return res.json({ events: await listSubscriptionAudit(context.organizationId) });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.get('/admin/overview', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  try {
    return res.json(await listAdminBilling());
  } catch (error) {
    return errorResponse(res, error);
  }
});

const VALID_STATUSES = new Set<SubscriptionStatus>([
  'trialing', 'active', 'past_due', 'grace_period', 'paused', 'canceled', 'expired',
]);

router.put('/admin/organizations/:organizationId', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const planId = req.body?.planId;
  const billingInterval = req.body?.billingInterval;
  const status = req.body?.status;
  if (!isPlanId(planId) || !isBillingInterval(billingInterval) || !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Valid plan, billing interval, and status are required.' });
  }
  const capacityOverride = req.body?.capacityOverrideLiters;
  if (capacityOverride !== undefined && capacityOverride !== null
    && (!Number.isFinite(Number(capacityOverride)) || Number(capacityOverride) < 0)) {
    return res.status(400).json({ error: 'Capacity override must be a non-negative number.' });
  }
  const customPriceMinor = req.body?.customPriceMinor;
  if (customPriceMinor !== undefined && customPriceMinor !== null
    && (!Number.isInteger(Number(customPriceMinor)) || Number(customPriceMinor) < 0)) {
    return res.status(400).json({ error: 'Custom price must be a non-negative integer in tetri.' });
  }
  try {
    const subscription = await adminAssignSubscription({
      organizationId: String(req.params.organizationId),
      actorUsername: auth.username,
      planId,
      billingInterval,
      status,
      renewsAt: req.body?.renewsAt ? new Date(req.body.renewsAt) : null,
      capacityOverrideLiters: capacityOverride == null ? null : Number(capacityOverride),
      featureOverrides: req.body?.featureOverrides,
      customPriceMinor: customPriceMinor == null ? null : Number(customPriceMinor),
    });
    return res.json({ subscription });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.get('/admin/organizations/:organizationId/audit', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  try {
    return res.json({ events: await listSubscriptionAudit(String(req.params.organizationId)) });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.patch('/admin/requests/:requestId', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  if (req.body?.status !== 'approved' && req.body?.status !== 'rejected') {
    return res.status(400).json({ error: 'Request status must be approved or rejected.' });
  }
  try {
    const request = await resolveSubscriptionRequest(String(req.params.requestId), auth.username, req.body.status);
    return res.json({ request });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.post('/renewals/run', async (req, res) => {
  const expected = cleanEnv(process.env.BILLING_CRON_SECRET);
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!safeSecretEquals(expected, supplied)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(await processDueRenewals());
  } catch (error) {
    return errorResponse(res, error);
  }
});

export default router;
