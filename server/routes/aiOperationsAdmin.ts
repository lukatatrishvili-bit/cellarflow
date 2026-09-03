import express from 'express';
import { requireMasterAdmin } from '../middleware/auth';
import { getAiOperationsSnapshot } from '../aiOperations';
import { retryFailedAiNotification } from '../aiNotificationOutbox';
import { auditSecurityEvent } from '../securityAudit';
import { clientIp } from '../config';

const router = express.Router();

router.get('/', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
    : 25;
  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(await getAiOperationsSnapshot(limit));
  } catch (error) {
    console.error(
      '[ai-operations] Snapshot unavailable:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return res.status(503).json({
      code: 'ai_operations_unavailable',
      error: 'AI operations status is temporarily unavailable.',
    });
  }
});

router.post('/notifications/:id/retry', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const id = String(req.params.id || '').trim();
  if (!id || id.length > 200) {
    return res.status(400).json({ error: 'A valid notification id is required.' });
  }
  try {
    const result = await retryFailedAiNotification(id);
    if (result.outcome === 'not_found') {
      return res.status(404).json({ error: 'Notification was not found.' });
    }
    if (result.outcome === 'not_retryable') {
      return res.status(409).json({
        error: `Only terminally failed notifications can be retried; current status is ${result.status}.`,
      });
    }
    if (result.outcome === 'ineligible') {
      return res.status(409).json({
        error: 'The recipient is no longer eligible for this notification.',
        reason: result.reason,
      });
    }
    if (result.outcome === 'conflict') {
      return res.status(409).json({
        error: 'Notification state changed while the retry was being requested.',
      });
    }
    await auditSecurityEvent({
      eventType: 'ai.notification_retry_requested',
      actorUsername: auth.username,
      organizationId: result.record.organizationId,
      ip: clientIp(req),
      metadata: {
        notificationId: result.record.id,
        channel: result.record.channel,
      },
    });
    return res.json({ ok: true, notification: result.record });
  } catch (error) {
    console.error(
      '[ai-operations] Retry failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return res.status(503).json({
      code: 'ai_notification_retry_unavailable',
      error: 'The notification could not be safely retried.',
    });
  }
});

export default router;
