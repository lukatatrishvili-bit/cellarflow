import { sendMail, type MailResult } from './mailer';
import {
  cancelAiNotification,
  claimAiNotificationBatch,
  completeAiNotification,
  failAiNotification,
} from './aiNotificationOutbox';
import { aiEmailDeliveryEligibility } from './aiNotificationPreferences';
import { buildAiFindingEmail } from './aiNotificationEmail';

export interface AiNotificationDeliveryResult {
  claimed: number;
  delivered: number;
  cancelled: number;
  retried: number;
  failed: number;
}

export async function deliverAiNotificationBatch(options: {
  limit?: number;
  now?: Date;
  appUrl?: string;
  mailer?: (message: ReturnType<typeof buildAiFindingEmail>) => Promise<MailResult>;
} = {}): Promise<AiNotificationDeliveryResult> {
  const now = options.now || new Date();
  const rows = await claimAiNotificationBatch(options.limit || 25, now);
  const result: AiNotificationDeliveryResult = {
    claimed: rows.length,
    delivered: 0,
    cancelled: 0,
    retried: 0,
    failed: 0,
  };
  const mailer = options.mailer || sendMail;

  for (const row of rows) {
    const eligibility = await aiEmailDeliveryEligibility({
      organizationId: row.organizationId,
      username: row.recipientUsername,
      recipientRole: row.recipientRole,
      severity: row.severity,
      eventOccurredAt: row.payload.lastSeenAt,
    });
    if (!eligibility.eligible) {
      const cancelled = await cancelAiNotification(
        row.id,
        row.claimToken!,
        eligibility.reason,
        now,
      );
      if (cancelled) result.cancelled += 1;
      else result.failed += 1;
      continue;
    }

    try {
      const delivery = await mailer(buildAiFindingEmail({
        to: eligibility.email,
        language: eligibility.language,
        wineryName: eligibility.wineryName,
        payload: row.payload,
        appUrl: options.appUrl ?? process.env.APP_URL,
      }));
      if (!delivery.delivered) throw new Error('Email transport did not confirm delivery.');
      if (await completeAiNotification(row.id, row.claimToken!, now)) result.delivered += 1;
      else result.failed += 1;
    } catch (error) {
      const recorded = await failAiNotification(row.id, row.claimToken!, error, now);
      if (!recorded || row.attemptCount >= 5) result.failed += 1;
      else result.retried += 1;
    }
  }
  return result;
}
