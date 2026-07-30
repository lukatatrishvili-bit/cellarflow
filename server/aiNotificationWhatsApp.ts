import {
  normalizeWhatsAppPhone,
  WhatsAppConfigurationError,
  WhatsAppDeliveryError,
  type WhatsAppSendResult,
} from './whatsapp';
import type { AiNotificationPayload } from './aiNotificationOutbox';

interface AiWhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  templateName: string;
  englishLanguageCode: string;
  georgianLanguageCode: string;
}

const GRAPH_VERSION_RE = /^v\d{1,3}\.\d{1,2}$/;
const PHONE_NUMBER_ID_RE = /^\d{5,30}$/;
const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_CODE_RE = /^[a-z]{2}(?:_[A-Z]{2,3})?$/;

function clean(value: unknown): string {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function compact(value: unknown, max: number, fallback = '—'): string {
  return clean(value).slice(0, max) || fallback;
}

export function aiWhatsAppConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AiWhatsAppConfig | null {
  const config: AiWhatsAppConfig = {
    accessToken: clean(env.WHATSAPP_ACCESS_TOKEN),
    phoneNumberId: clean(env.WHATSAPP_PHONE_NUMBER_ID),
    graphApiVersion: clean(env.WHATSAPP_GRAPH_API_VERSION),
    templateName: clean(env.WHATSAPP_AI_FINDING_TEMPLATE_NAME),
    englishLanguageCode: clean(env.WHATSAPP_AI_FINDING_TEMPLATE_LANGUAGE_EN || 'en_US'),
    georgianLanguageCode: clean(env.WHATSAPP_AI_FINDING_TEMPLATE_LANGUAGE_KA || 'ka'),
  };
  const core = [
    config.accessToken,
    config.phoneNumberId,
    config.graphApiVersion,
    config.templateName,
  ];
  if (core.every((value) => !value)) return null;
  if (core.some((value) => !value)) {
    throw new WhatsAppConfigurationError(
      'AI WhatsApp configuration is incomplete. Set the access token, phone number ID, Graph API version, and approved AI finding template.',
    );
  }
  if (!PHONE_NUMBER_ID_RE.test(config.phoneNumberId)) {
    throw new WhatsAppConfigurationError('WHATSAPP_PHONE_NUMBER_ID is invalid.');
  }
  if (!GRAPH_VERSION_RE.test(config.graphApiVersion)) {
    throw new WhatsAppConfigurationError('WHATSAPP_GRAPH_API_VERSION is invalid.');
  }
  if (!TEMPLATE_NAME_RE.test(config.templateName)) {
    throw new WhatsAppConfigurationError('WHATSAPP_AI_FINDING_TEMPLATE_NAME is invalid.');
  }
  if (
    !LANGUAGE_CODE_RE.test(config.englishLanguageCode)
    || !LANGUAGE_CODE_RE.test(config.georgianLanguageCode)
  ) {
    throw new WhatsAppConfigurationError('AI WhatsApp template language codes are invalid.');
  }
  return config;
}

export function aiWhatsAppConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return Boolean(aiWhatsAppConfigFromEnv(env));
  } catch {
    return false;
  }
}

export function buildAiWhatsAppTemplatePayload(input: {
  config: AiWhatsAppConfig;
  phone: string;
  language: 'en' | 'ka';
  wineryName: string;
  payload: AiNotificationPayload;
  appUrl?: string;
}) {
  const phone = normalizeWhatsAppPhone(input.phone);
  if (!phone) throw new Error('AI WhatsApp recipient phone number is invalid.');
  const ka = input.language === 'ka';
  const localized = (value: { en: string; ka: string }) => (
    input.language === 'ka' ? value.ka : value.en
  );
  const severityLabels = {
    critical: { en: 'Critical', ka: 'კრიტიკული' },
    warning: { en: 'Warning', ka: 'გაფრთხილება' },
    attention: { en: 'Attention', ka: 'საყურადღებო' },
    info: { en: 'Information', ka: 'ინფორმაცია' },
  } as const;
  const appUrl = clean(input.appUrl).replace(/\/+$/, '');
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone.slice(1),
    type: 'template',
    template: {
      name: input.config.templateName,
      language: {
        code: ka
          ? input.config.georgianLanguageCode
          : input.config.englishLanguageCode,
      },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: compact(input.wineryName, 100, ka ? 'მარანი' : 'Winery') },
          { type: 'text', text: severityLabels[input.payload.severity][input.language] },
          { type: 'text', text: compact(localized(input.payload.title), 180) },
          { type: 'text', text: compact(input.payload.entityLabel || input.payload.entityId, 120) },
          { type: 'text', text: compact(localized(input.payload.observation), 500) },
          { type: 'text', text: compact(appUrl, 500, ka ? 'გახსენით VinOS' : 'Open VinOS') },
        ],
      }],
    },
  };
}

type FetchLike = typeof fetch;

export async function sendAiWhatsAppNotification(
  input: {
    phone: string;
    language: 'en' | 'ka';
    wineryName: string;
    payload: AiNotificationPayload;
    appUrl?: string;
  },
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<WhatsAppSendResult> {
  const config = aiWhatsAppConfigFromEnv(options.env);
  if (!config) {
    throw new WhatsAppConfigurationError('AI WhatsApp notifications are not configured.');
  }
  const body = buildAiWhatsAppTemplatePayload({ ...input, config });
  const request = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await request(
      `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      },
    );
    const responseBody = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      const providerCode = Number(responseBody?.error?.code);
      const providerMessage = compact(
        responseBody?.error?.message,
        300,
        `HTTP ${response.status}`,
      );
      throw new WhatsAppDeliveryError(
        `WhatsApp rejected the AI notification: ${providerMessage}`,
        response.status,
        Number.isFinite(providerCode) ? providerCode : undefined,
      );
    }
    const messageId = typeof responseBody?.messages?.[0]?.id === 'string'
      ? responseBody.messages[0].id
      : '';
    if (!messageId) {
      throw new WhatsAppDeliveryError(
        'WhatsApp accepted the AI notification without returning a message ID.',
        502,
      );
    }
    return {
      messageId,
      recipientId: typeof responseBody?.contacts?.[0]?.wa_id === 'string'
        ? responseBody.contacts[0].wa_id
        : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new WhatsAppDeliveryError('AI WhatsApp notification timed out.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
