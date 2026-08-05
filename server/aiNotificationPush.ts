import webPush from 'web-push';
import type { AiNotificationPayload } from './aiNotificationOutbox';
import {
  aiWebPushConfigured,
  listAiPushSubscriptions,
  removeAiPushSubscriptionById,
} from './aiPushSubscriptions';

export class AiPushNoSubscriptionsError extends Error {
  constructor(message = 'No active browser push subscriptions remain.') {
    super(message);
    this.name = 'AiPushNoSubscriptionsError';
  }
}

export interface WebPushPayload {
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  renotify?: boolean;
  requireInteraction?: boolean;
  lang?: 'en' | 'ka';
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
}

function localized(value: { en: string; ka: string }, language: 'en' | 'ka'): string {
  return language === 'ka' ? value.ka : value.en;
}

function compact(value: unknown, max: number): string {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function configureWebPush(): void {
  if (!aiWebPushConfigured()) {
    throw new Error('Web push is not configured.');
  }
  const subject = (process.env.WEB_PUSH_VAPID_SUBJECT || '').trim();
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    throw new Error('WEB_PUSH_VAPID_SUBJECT must be a mailto: or HTTPS URL.');
  }
  webPush.setVapidDetails(
    subject,
    (process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim(),
    (process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim(),
  );
}

export function buildAiWebPushPayload(input: {
  language: 'en' | 'ka';
  wineryName: string;
  payload: AiNotificationPayload;
  appUrl?: string;
}) {
  const ka = input.language === 'ka';
  const severity = {
    critical: { en: 'Critical', ka: 'კრიტიკული' },
    warning: { en: 'Warning', ka: 'გაფრთხილება' },
    attention: { en: 'Attention', ka: 'საყურადღებო' },
    info: { en: 'Information', ka: 'ინფორმაცია' },
  }[input.payload.severity][input.language];
  const configuredUrl = (input.appUrl || '').trim().replace(/\/+$/, '');
  const findingUrl = configuredUrl
    ? `${configuredUrl}/?aiFinding=${encodeURIComponent(input.payload.findingId)}`
    : `/?aiFinding=${encodeURIComponent(input.payload.findingId)}`;
  return {
    title: compact(`${severity}: ${localized(input.payload.title, input.language)}`, 180),
    body: compact(localized(input.payload.observation, input.language), 500),
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: `ai-finding-${input.payload.findingId}`,
    renotify: input.payload.severity === 'critical',
    requireInteraction: input.payload.severity === 'critical',
    lang: input.language,
    data: {
      type: 'ai_finding',
      findingId: input.payload.findingId,
      wineryName: compact(input.wineryName, 100),
      url: findingUrl,
    },
    actions: [{
      action: 'open',
      title: ka ? 'გახსნა' : 'Open',
    }],
  };
}

/** Sends one user-level event to every currently registered browser endpoint. */
export async function sendWebPushNotification(input: {
  organizationId: string;
  username: string;
  payload: WebPushPayload;
  ttlSeconds?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}): Promise<{ delivered: number; expired: number }> {
  configureWebPush();
  const subscriptions = await listAiPushSubscriptions(input.organizationId, input.username);
  if (subscriptions.length === 0) throw new AiPushNoSubscriptionsError();
  const message = JSON.stringify(input.payload);
  let delivered = 0;
  let expired = 0;
  let lastError: unknown;

  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification({
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime ?? null,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      }, message, {
        TTL: input.ttlSeconds ?? 6 * 60 * 60,
        urgency: input.urgency ?? 'normal',
      });
      delivered += 1;
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await removeAiPushSubscriptionById({
          organizationId: input.organizationId,
          username: input.username,
          id: subscription.id,
        }).catch(() => undefined);
        expired += 1;
        continue;
      }
      lastError = error;
    }
  }

  if (delivered > 0) return { delivered, expired };
  if (expired === subscriptions.length) throw new AiPushNoSubscriptionsError();
  throw lastError instanceof Error ? lastError : new Error('Web push delivery failed.');
}

export async function sendAiWebPushNotification(input: {
  organizationId: string;
  username: string;
  language: 'en' | 'ka';
  wineryName: string;
  payload: AiNotificationPayload;
  appUrl?: string;
}): Promise<{ delivered: number; expired: number }> {
  return sendWebPushNotification({
    organizationId: input.organizationId,
    username: input.username,
    payload: buildAiWebPushPayload(input),
    ttlSeconds: input.payload.severity === 'critical' ? 24 * 60 * 60 : 6 * 60 * 60,
    urgency: input.payload.severity === 'critical' ? 'high' : 'normal',
  });
}
