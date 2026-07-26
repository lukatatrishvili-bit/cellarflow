import express from 'express';
import { appBaseUrl } from '../config';
import { getDB, refreshCoreMetadataFromPostgres } from '../db';
import { hashToken } from '../emailVerification';
import { checkWineryScope, whatsappNotificationLimiter } from '../middleware/auth';
import { canAccess } from '../permissions';
import {
  normalizeWhatsAppPhone,
  parseWhatsAppWebhookStatusEvents,
  sendWhatsAppTaskAssignment,
  verifyWhatsAppWebhookSignature,
  verifyWhatsAppWebhookToken,
  whatsappConfigFromEnv,
  whatsappIsConfigured,
  whatsappWebhookConfigFromEnv,
  WhatsAppConfigurationError,
  WhatsAppDeliveryError,
  type WhatsAppTaskMessage,
} from '../whatsapp';
import {
  acceptWhatsAppDelivery,
  applyWhatsAppWebhookStatus,
  failWhatsAppDelivery,
  listWhatsAppDeliveryStatuses,
  projectWhatsAppDelivery,
  reserveWhatsAppDelivery,
} from '../whatsappDeliveryStore';

const router = express.Router();
export const whatsappWebhookRouter = express.Router();
const TASK_ID_RE = /^[A-Za-z0-9_.:-]{1,160}$/;
const USERNAME_RE = /^[A-Za-z0-9_.@-]{1,160}$/;

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function parseTask(value: unknown): WhatsAppTaskMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = cleanText(raw.id, 160);
  const title = cleanText(raw.title, 500);
  const priority = raw.priority;
  const dueDate = cleanText(raw.dueDate, 40);
  if (!TASK_ID_RE.test(id) || !title || !['high', 'medium', 'low'].includes(String(priority))) return null;
  return {
    id,
    title,
    priority: priority as WhatsAppTaskMessage['priority'],
    dueDate,
    description: cleanText(raw.description, 2_000),
    assignedUserId: cleanText(raw.assignedUserId, 160),
  };
}

router.get('/whatsapp/status', checkWineryScope('read'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ configured: whatsappIsConfigured() });
});

router.post('/whatsapp/task-statuses', checkWineryScope('read'), async (req, res) => {
  const session = (req as any).wineryContext;
  if (!canAccess(session.role, 'tasks', 'view')) {
    return res.status(403).json({ error: 'Forbidden: task access required.' });
  }
  const taskIds = Array.isArray(req.body?.taskIds) ? req.body.taskIds : null;
  if (!taskIds || taskIds.length > 100 || taskIds.some((id: unknown) => (
    typeof id !== 'string' || !TASK_ID_RE.test(id)
  ))) {
    return res.status(400).json({ error: 'taskIds must contain at most 100 valid task IDs.' });
  }
  try {
    return res.json({
      deliveries: await listWhatsAppDeliveryStatuses(session.organizationId, taskIds),
    });
  } catch (error) {
    console.error('[whatsapp] delivery status read failed:', error instanceof Error ? error.message : 'unknown error');
    return res.status(503).json({
      code: 'whatsapp_delivery_store_unavailable',
      error: 'WhatsApp delivery status is temporarily unavailable.',
    });
  }
});

router.post('/whatsapp/tasks', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  if (!canAccess(session.role, 'tasks', 'create')) {
    return res.status(403).json({ error: 'Forbidden: task creation access required.' });
  }

  const assigneeUsername = cleanText(req.body?.assigneeUsername, 160);
  const task = parseTask(req.body?.task);
  if (!USERNAME_RE.test(assigneeUsername) || !task) {
    return res.status(400).json({ error: 'A valid assignee and task are required.' });
  }
  if (task.assignedUserId !== assigneeUsername) {
    return res.status(400).json({ error: 'The task assignment does not match the selected WhatsApp recipient.' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const membership = db.memberships?.find((candidate: any) => (
    candidate.userId === assigneeUsername && candidate.organizationId === session.organizationId
  ));
  const recipient = membership
    ? db.users.find((candidate: any) => candidate.username === assigneeUsername)
    : null;
  if (!membership || !recipient || recipient.accountEnabled === false) {
    return res.status(404).json({ error: 'The selected assignee is not an active member of this workspace.' });
  }
  if (recipient.whatsappOptIn !== true) {
    return res.status(409).json({
      code: 'whatsapp_opt_in_required',
      error: 'The selected assignee has not opted in to WhatsApp task notifications.',
    });
  }
  const phone = normalizeWhatsAppPhone(recipient.phone);
  if (!phone) {
    return res.status(409).json({
      code: 'whatsapp_phone_required',
      error: 'The selected assignee must save a valid international WhatsApp number in their profile.',
    });
  }

  const rateKey = `rate:whatsapp-task:${hashToken(`${session.organizationId}:${session.username}`)}`;
  const retryAfter = await whatsappNotificationLimiter.lockRemainingSeconds(rateKey);
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many WhatsApp task notifications. Try again later.' });
  }
  await whatsappNotificationLimiter.recordFailure(rateKey);

  const sender = db.users.find((candidate: any) => candidate.username === session.username);
  let config;
  try {
    config = whatsappConfigFromEnv();
    if (!config) throw new WhatsAppConfigurationError('WhatsApp task notifications are not configured.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WhatsApp task notifications are not configured.';
    return res.status(503).json({ code: 'whatsapp_not_configured', error: message });
  }

  let claim;
  try {
    claim = await reserveWhatsAppDelivery({
      organizationId: session.organizationId,
      taskId: task.id,
      assigneeUsername,
      senderUsername: session.username,
      templateName: config.taskTemplateName,
      language: recipient.language === 'ka' ? 'ka' : 'en',
    });
  } catch (error) {
    console.error('[whatsapp] delivery claim failed:', error instanceof Error ? error.message : 'unknown error');
    return res.status(503).json({
      code: 'whatsapp_delivery_store_unavailable',
      error: 'WhatsApp delivery could not be recorded safely.',
    });
  }

  if (claim.outcome !== 'claimed') {
    const delivery = projectWhatsAppDelivery(claim.record);
    return res.status(claim.outcome === 'replay' ? 200 : 202).json({
      ok: true,
      ...delivery,
    });
  }

  try {
    const result = await sendWhatsAppTaskAssignment({
      recipient: {
        phone,
        fullName: recipient.fullName || recipient.username,
        language: recipient.language === 'ka' ? 'ka' : 'en',
      },
      task,
      assignedBy: sender?.fullName || session.username,
      appUrl: appBaseUrl(req),
    });
    const accepted = await acceptWhatsAppDelivery(claim.claimToken, result.messageId);
    return res.status(202).json({
      ok: true,
      ...projectWhatsAppDelivery(accepted),
    });
  } catch (error) {
    const deliveryCode = error instanceof WhatsAppDeliveryError
      ? String(error.providerCode || error.status || 'provider_error')
      : error instanceof WhatsAppConfigurationError
        ? 'configuration_error'
        : 'delivery_error';
    const deliveryMessage = error instanceof Error ? error.message : 'WhatsApp task notification failed.';
    await failWhatsAppDelivery(claim.claimToken, deliveryCode, deliveryMessage).catch(storeError => {
      console.error('[whatsapp] failed to persist delivery failure:', storeError instanceof Error ? storeError.message : 'unknown error');
    });
    if (error instanceof WhatsAppConfigurationError) {
      return res.status(503).json({ code: 'whatsapp_not_configured', error: error.message });
    }
    if (error instanceof WhatsAppDeliveryError) {
      const status = error.status === 429 ? 429 : 502;
      return res.status(status).json({
        code: 'whatsapp_delivery_failed',
        error: error.message,
        ...(error.providerCode ? { providerCode: error.providerCode } : {}),
      });
    }
    console.error('[whatsapp] task notification failed:', error instanceof Error ? error.message : 'unknown error');
    return res.status(502).json({ code: 'whatsapp_delivery_failed', error: 'WhatsApp task notification failed.' });
  }
});

whatsappWebhookRouter.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let config;
  try {
    config = whatsappWebhookConfigFromEnv();
  } catch {
    return res.status(503).send('Webhook is not configured.');
  }
  if (!config) return res.status(503).send('Webhook is not configured.');
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode !== 'subscribe' || typeof challenge !== 'string' || challenge.length > 512
    || !verifyWhatsAppWebhookToken(config.verifyToken, token)) {
    return res.status(403).send('Forbidden');
  }
  return res.status(200).type('text/plain').send(challenge);
});

whatsappWebhookRouter.post('/', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let config;
  try {
    config = whatsappWebhookConfigFromEnv();
  } catch {
    return res.status(503).json({ error: 'Webhook is not configured.' });
  }
  if (!config) return res.status(503).json({ error: 'Webhook is not configured.' });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  if (!rawBody || rawBody.length === 0 || rawBody.length > 256 * 1024
    || !verifyWhatsAppWebhookSignature(rawBody, req.headers['x-hub-signature-256'], config.appSecret)) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid webhook JSON.' });
  }

  try {
    const events = parseWhatsAppWebhookStatusEvents(payload);
    let matched = 0;
    for (const event of events) {
      if (await applyWhatsAppWebhookStatus(event)) matched += 1;
    }
    return res.status(200).json({ ok: true, received: events.length, matched });
  } catch (error) {
    console.error('[whatsapp] webhook status persistence failed:', error instanceof Error ? error.message : 'unknown error');
    // A non-2xx response asks Meta to retry instead of losing a signed status.
    return res.status(503).json({ error: 'Webhook status could not be persisted.' });
  }
});

export default router;
