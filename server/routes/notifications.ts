import express from 'express';
import { appBaseUrl } from '../config';
import { getDB, refreshCoreMetadataFromPostgres } from '../db';
import { hashToken } from '../emailVerification';
import { checkWineryScope, whatsappNotificationLimiter } from '../middleware/auth';
import { canAccess } from '../permissions';
import {
  normalizeWhatsAppPhone,
  sendWhatsAppTaskAssignment,
  whatsappIsConfigured,
  WhatsAppConfigurationError,
  WhatsAppDeliveryError,
  type WhatsAppTaskMessage,
} from '../whatsapp';

const router = express.Router();
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
  };
}

router.get('/whatsapp/status', checkWineryScope('read'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ configured: whatsappIsConfigured() });
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
    return res.status(202).json({
      ok: true,
      status: 'accepted',
      messageId: result.messageId,
      language: recipient.language === 'ka' ? 'ka' : 'en',
    });
  } catch (error) {
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

export default router;
