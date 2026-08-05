import express from 'express';
import { appBaseUrl } from '../config';
import { getDB, refreshCoreMetadataFromPostgres } from '../db';
import { hashToken } from '../emailVerification';
import { checkWineryScope, taskNotificationLimiter } from '../middleware/auth';
import { canAccess } from '../permissions';
import {
  getAiNotificationAccountStatus,
  getAiNotificationPreference,
  setAiNotificationPreference,
} from '../aiNotificationPreferences';
import {
  registerAiPushSubscription,
  removeAiPushSubscription,
} from '../aiPushSubscriptions';
import {
  sendTaskAssignmentEmail,
  sendTaskAssignmentPush,
  type TaskNotificationMessage,
} from '../taskNotifications';
import {
  completeTaskNotificationDelivery,
  failTaskNotificationDelivery,
  projectTaskNotificationDelivery,
  reserveTaskNotificationDelivery,
  type TaskNotificationChannel,
} from '../taskNotificationStore';

const router = express.Router();
const TASK_ID_RE = /^[A-Za-z0-9_.:-]{1,160}$/;
const USERNAME_RE = /^[A-Za-z0-9_.@-]{1,160}$/;

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function parseTask(value: unknown): TaskNotificationMessage | null {
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
    priority: priority as TaskNotificationMessage['priority'],
    dueDate,
    description: cleanText(raw.description, 2_000),
    assignedUserId: cleanText(raw.assignedUserId, 160),
  };
}

async function preferencePayload(organizationId: string, username: string) {
  const [preference, account] = await Promise.all([
    getAiNotificationPreference(organizationId, username),
    getAiNotificationAccountStatus(organizationId, username),
  ]);
  return {
    preference: {
      emailEnabled: preference.emailEnabled,
      pushEnabled: preference.pushEnabled,
    },
    account: {
      ...account,
      emailConfigured: Boolean(process.env.SMTP_HOST?.trim()),
    },
  };
}

router.get('/preferences', checkWineryScope('read'), async (req, res) => {
  const session = (req as any).wineryContext;
  res.setHeader('Cache-Control', 'no-store');
  return res.json(await preferencePayload(session.organizationId, session.username));
});

router.put('/preferences', checkWineryScope('read'), async (req, res) => {
  const session = (req as any).wineryContext;
  const current = await getAiNotificationPreference(session.organizationId, session.username);
  const emailEnabled = typeof req.body?.emailEnabled === 'boolean'
    ? req.body.emailEnabled
    : current.emailEnabled;
  const pushEnabled = typeof req.body?.pushEnabled === 'boolean'
    ? req.body.pushEnabled
    : current.pushEnabled;
  const account = await getAiNotificationAccountStatus(session.organizationId, session.username);
  if (emailEnabled && !process.env.SMTP_HOST?.trim()) {
    return res.status(409).json({ error: 'Email notifications are not configured for this deployment.' });
  }
  if (emailEnabled && (!account.emailVerified || !account.hasEmail)) {
    return res.status(409).json({ error: 'Verify your account email before enabling email notifications.' });
  }
  if (pushEnabled && (!account.pushConfigured || account.pushSubscriptionCount === 0)) {
    return res.status(409).json({
      error: 'Register this browser before enabling browser push notifications.',
    });
  }
  await setAiNotificationPreference({
    organizationId: session.organizationId,
    username: session.username,
    emailEnabled,
    pushEnabled,
    minimumSeverity: current.minimumSeverity,
    inAppMinimumSeverity: current.inAppMinimumSeverity,
  });
  return res.json(await preferencePayload(session.organizationId, session.username));
});

router.post('/push-subscriptions', checkWineryScope('read'), async (req, res) => {
  const session = (req as any).wineryContext;
  const account = await getAiNotificationAccountStatus(session.organizationId, session.username);
  if (!account.pushConfigured) {
    return res.status(409).json({ error: 'Web push is not configured for this deployment.' });
  }
  try {
    const subscription = await registerAiPushSubscription({
      organizationId: session.organizationId,
      username: session.username,
      subscription: req.body?.subscription,
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json({
      subscription: {
        id: subscription.id,
        expirationTime: subscription.expirationTime,
        createdAt: subscription.createdAt,
      },
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Push subscription is invalid.',
    });
  }
});

router.delete('/push-subscriptions', checkWineryScope('read'), async (req, res) => {
  const session = (req as any).wineryContext;
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
  if (!endpoint) return res.status(400).json({ error: 'Push subscription endpoint is required.' });
  const removed = await removeAiPushSubscription({
    organizationId: session.organizationId,
    username: session.username,
    endpoint,
  });
  return res.json({ removed });
});

router.get('/status', checkWineryScope('read'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    emailConfigured: Boolean(process.env.SMTP_HOST?.trim()),
    pushConfigured: Boolean(
      process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim()
      && process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim()
      && process.env.WEB_PUSH_VAPID_SUBJECT?.trim(),
    ),
  });
});

router.post('/tasks', checkWineryScope('write'), async (req, res) => {
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
    return res.status(400).json({ error: 'The task assignment does not match the selected recipient.' });
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

  const [preference, account] = await Promise.all([
    getAiNotificationPreference(session.organizationId, assigneeUsername),
    getAiNotificationAccountStatus(session.organizationId, assigneeUsername),
  ]);
  const channels: TaskNotificationChannel[] = [];
  if (
    preference.emailEnabled
    && process.env.SMTP_HOST?.trim()
    && account.emailVerified
    && account.hasEmail
  ) channels.push('email');
  if (
    preference.pushEnabled
    && account.pushConfigured
    && account.pushSubscriptionCount > 0
  ) channels.push('push');
  if (channels.length === 0) {
    return res.status(409).json({
      code: 'notification_opt_in_required',
      error: 'The selected assignee has not enabled email or browser push notifications.',
    });
  }

  const rateKey = `rate:task-notification:${hashToken(`${session.organizationId}:${session.username}`)}`;
  const retryAfter = await taskNotificationLimiter.lockRemainingSeconds(rateKey);
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many task notifications. Try again later.' });
  }
  await taskNotificationLimiter.recordFailure(rateKey);

  const sender = db.users.find((candidate: any) => candidate.username === session.username);
  const organization = db.organizations?.find((candidate: any) => candidate.id === session.organizationId);
  const common = {
    language: recipient.language === 'ka' ? 'ka' as const : 'en' as const,
    wineryName: String(organization?.name || 'Winery'),
    recipientName: String(recipient.fullName || recipient.username),
    assignedBy: String(sender?.fullName || session.username),
    task,
    appUrl: appBaseUrl(req),
  };

  const deliveries = await Promise.all(channels.map(async (channel) => {
    const reservation = await reserveTaskNotificationDelivery({
      organizationId: session.organizationId,
      taskId: task.id,
      assigneeUsername,
      senderUsername: session.username,
      channel,
    });
    if (reservation.outcome !== 'claimed') {
      return projectTaskNotificationDelivery(reservation.record);
    }
    try {
      if (channel === 'email') {
        await sendTaskAssignmentEmail({
          ...common,
          to: String(recipient.email),
        });
      } else {
        await sendTaskAssignmentPush({
          ...common,
          organizationId: session.organizationId,
          username: assigneeUsername,
        });
      }
      const completed = await completeTaskNotificationDelivery(
        reservation.record.id,
        reservation.record.claimToken,
      );
      return projectTaskNotificationDelivery(completed || reservation.record);
    } catch (error) {
      const failed = await failTaskNotificationDelivery(
        reservation.record.id,
        reservation.record.claimToken,
        error,
      );
      return projectTaskNotificationDelivery(failed || reservation.record);
    }
  }));
  const sentCount = deliveries.filter(delivery => delivery.status === 'sent').length;
  return res.status(sentCount > 0 ? 202 : 502).json({
    ok: sentCount > 0,
    status: sentCount === deliveries.length ? 'sent' : sentCount > 0 ? 'partial' : 'failed',
    deliveries,
    updatedAt: new Date().toISOString(),
    ...(sentCount === 0 ? { error: 'Task notification delivery failed.' } : {}),
  });
});

export default router;
