import crypto from 'crypto';
import { cleanEnv } from './config';

export type WhatsAppTaskLanguage = 'en' | 'ka';
export type WhatsAppTaskPriority = 'high' | 'medium' | 'low';
export type WhatsAppDeliveryStatus = 'sending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';

export interface WhatsAppTaskMessage {
  id: string;
  title: string;
  priority: WhatsAppTaskPriority;
  dueDate: string;
  description?: string;
  assignedUserId?: string;
}

export interface WhatsAppTaskRecipient {
  phone: string;
  fullName: string;
  language: WhatsAppTaskLanguage;
}

export interface WhatsAppCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  taskTemplateName: string;
  englishLanguageCode: string;
  georgianLanguageCode: string;
}

export interface WhatsAppWebhookConfig {
  verifyToken: string;
  appSecret: string;
}

export interface WhatsAppWebhookStatusEvent {
  providerMessageId: string;
  status: Exclude<WhatsAppDeliveryStatus, 'sending' | 'accepted'>;
  occurredAt: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface WhatsAppSendResult {
  messageId: string;
  recipientId?: string;
}

export class WhatsAppConfigurationError extends Error {}
export class WhatsAppDeliveryError extends Error {
  status: number;
  providerCode?: number;

  constructor(message: string, status: number, providerCode?: number) {
    super(message);
    this.name = 'WhatsAppDeliveryError';
    this.status = status;
    this.providerCode = providerCode;
  }
}

const GRAPH_VERSION_RE = /^v\d{1,3}\.\d{1,2}$/;
const PHONE_NUMBER_ID_RE = /^\d{5,30}$/;
const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_CODE_RE = /^[a-z]{2}(?:_[A-Z]{2,3})?$/;
const WEBHOOK_SIGNATURE_RE = /^sha256=([a-f0-9]{64})$/i;
const PROVIDER_MESSAGE_ID_RE = /^[A-Za-z0-9._:-]{1,500}$/;

/**
 * Normalize a user-entered international phone number to E.164 display form.
 * Local numbers are intentionally rejected: silently guessing a country code
 * could notify the wrong person.
 */
export function normalizeWhatsAppPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let candidate = value.trim();
  if (!candidate) return null;
  if (candidate.startsWith('00')) candidate = `+${candidate.slice(2)}`;
  const digits = candidate.replace(/[\s().-]/g, '').replace(/^\+/, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

export function whatsappConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppCloudConfig | null {
  const config: WhatsAppCloudConfig = {
    accessToken: cleanEnv(env.WHATSAPP_ACCESS_TOKEN),
    phoneNumberId: cleanEnv(env.WHATSAPP_PHONE_NUMBER_ID),
    graphApiVersion: cleanEnv(env.WHATSAPP_GRAPH_API_VERSION),
    taskTemplateName: cleanEnv(env.WHATSAPP_TASK_TEMPLATE_NAME) || 'cellarflow_task_assignment',
    englishLanguageCode: cleanEnv(env.WHATSAPP_TASK_TEMPLATE_LANGUAGE_EN) || 'en_US',
    georgianLanguageCode: cleanEnv(env.WHATSAPP_TASK_TEMPLATE_LANGUAGE_KA) || 'ka',
  };

  if (!config.accessToken && !config.phoneNumberId && !config.graphApiVersion) return null;
  if (!config.accessToken || !config.phoneNumberId || !config.graphApiVersion) {
    throw new WhatsAppConfigurationError(
      'WhatsApp Cloud API configuration is incomplete. Set the access token, phone number ID, and Graph API version.',
    );
  }
  if (!PHONE_NUMBER_ID_RE.test(config.phoneNumberId)) {
    throw new WhatsAppConfigurationError('WHATSAPP_PHONE_NUMBER_ID must be the numeric Meta phone number ID.');
  }
  if (!GRAPH_VERSION_RE.test(config.graphApiVersion)) {
    throw new WhatsAppConfigurationError('WHATSAPP_GRAPH_API_VERSION must use a value such as v26.0.');
  }
  if (!TEMPLATE_NAME_RE.test(config.taskTemplateName)) {
    throw new WhatsAppConfigurationError('WHATSAPP_TASK_TEMPLATE_NAME must contain lowercase letters, numbers, or underscores.');
  }
  if (!LANGUAGE_CODE_RE.test(config.englishLanguageCode) || !LANGUAGE_CODE_RE.test(config.georgianLanguageCode)) {
    throw new WhatsAppConfigurationError('WhatsApp template language codes are invalid.');
  }
  return config;
}

export function whatsappIsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return whatsappConfigFromEnv(env) !== null;
  } catch {
    return false;
  }
}

export function whatsappWebhookConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppWebhookConfig | null {
  const config: WhatsAppWebhookConfig = {
    verifyToken: cleanEnv(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    appSecret: cleanEnv(env.WHATSAPP_APP_SECRET),
  };
  if (!config.verifyToken && !config.appSecret) return null;
  if (!config.verifyToken || !config.appSecret) {
    throw new WhatsAppConfigurationError(
      'WhatsApp webhook configuration is incomplete. Set the verify token and Meta app secret.',
    );
  }
  if (config.verifyToken.length < 16 || config.verifyToken.length > 512) {
    throw new WhatsAppConfigurationError('WHATSAPP_WEBHOOK_VERIFY_TOKEN must be between 16 and 512 characters.');
  }
  if (config.appSecret.length < 16 || config.appSecret.length > 512) {
    throw new WhatsAppConfigurationError('WHATSAPP_APP_SECRET must be between 16 and 512 characters.');
  }
  return config;
}

export function whatsappWebhookIsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return whatsappWebhookConfigFromEnv(env) !== null;
  } catch {
    return false;
  }
}

export function whatsappIsFullyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return whatsappIsConfigured(env) && whatsappWebhookIsConfigured(env);
}

function safeSecretEquals(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyWhatsAppWebhookToken(expected: string, supplied: unknown): boolean {
  return typeof supplied === 'string' && safeSecretEquals(expected, supplied);
}

export function verifyWhatsAppWebhookSignature(
  rawBody: Buffer,
  signatureHeader: unknown,
  appSecret: string,
): boolean {
  if (!Buffer.isBuffer(rawBody) || typeof signatureHeader !== 'string' || !appSecret) return false;
  const match = WEBHOOK_SIGNATURE_RE.exec(signatureHeader.trim());
  if (!match) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeSecretEquals(expected, match[1].toLowerCase());
}

export function parseWhatsAppWebhookStatusEvents(payload: unknown): WhatsAppWebhookStatusEvent[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const root = payload as Record<string, unknown>;
  if (root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return [];

  const events: WhatsAppWebhookStatusEvent[] = [];
  for (const entry of root.entry.slice(0, 100)) {
    if (!entry || typeof entry !== 'object' || !Array.isArray((entry as any).changes)) continue;
    for (const change of (entry as any).changes.slice(0, 100)) {
      const value = change && typeof change === 'object' ? (change as any).value : null;
      if (!value || !Array.isArray(value.statuses)) continue;
      for (const candidate of value.statuses.slice(0, 100)) {
        if (events.length >= 500 || !candidate || typeof candidate !== 'object') break;
        const providerMessageId = typeof candidate.id === 'string' ? candidate.id.trim() : '';
        const status = candidate.status;
        if (!PROVIDER_MESSAGE_ID_RE.test(providerMessageId)
          || !['sent', 'delivered', 'read', 'failed'].includes(status)) {
          continue;
        }
        const timestamp = typeof candidate.timestamp === 'string' && /^\d{1,14}$/.test(candidate.timestamp)
          ? Number(candidate.timestamp) * 1_000
          : Date.now();
        const occurredAt = Number.isFinite(timestamp)
          ? new Date(timestamp).toISOString()
          : new Date().toISOString();
        const providerError = Array.isArray(candidate.errors) ? candidate.errors[0] : undefined;
        const errorCode = providerError?.code === undefined
          ? undefined
          : compactTemplateText(String(providerError.code), 80, '');
        const errorMessage = providerError
          ? compactTemplateText(
            providerError.title || providerError.message || providerError.error_data?.details,
            300,
            'WhatsApp delivery failed.',
          )
          : undefined;
        events.push({
          providerMessageId,
          status,
          occurredAt,
          ...(errorCode ? { errorCode } : {}),
          ...(errorMessage ? { errorMessage } : {}),
        });
      }
    }
  }
  return events;
}

function compactTemplateText(value: unknown, maxLength: number, fallback = '—'): string {
  const text = typeof value === 'string'
    ? Array.from(value, character => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    }).join('').replace(/\s+/g, ' ').trim()
    : '';
  return (text || fallback).slice(0, maxLength);
}

function priorityLabel(priority: WhatsAppTaskPriority, language: WhatsAppTaskLanguage): string {
  if (language === 'ka') {
    return priority === 'high' ? 'მაღალი' : priority === 'medium' ? 'საშუალო' : 'დაბალი';
  }
  return priority === 'high' ? 'High' : priority === 'medium' ? 'Medium' : 'Low';
}

function dueDateLabel(value: string, language: WhatsAppTaskLanguage): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return compactTemplateText(value, 40);
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'ka' ? 'ka-GE' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function buildWhatsAppTaskTemplatePayload(
  config: WhatsAppCloudConfig,
  recipient: WhatsAppTaskRecipient,
  task: WhatsAppTaskMessage,
  assignedBy: string,
  appUrl: string,
) {
  const phone = normalizeWhatsAppPhone(recipient.phone);
  if (!phone) throw new Error('The assignee does not have a valid international WhatsApp number.');
  const language = recipient.language === 'ka' ? 'ka' : 'en';
  const languageCode = language === 'ka' ? config.georgianLanguageCode : config.englishLanguageCode;
  let taskUrl: string;
  try {
    const url = new URL(appUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported URL protocol.');
    url.pathname = '/tasks';
    url.search = '';
    url.hash = '';
    url.searchParams.set('task', task.id);
    taskUrl = url.toString();
  } catch {
    throw new Error('The application URL for WhatsApp task links is invalid.');
  }
  const parameters = [
    compactTemplateText(recipient.fullName, 60, language === 'ka' ? 'გუნდის წევრო' : 'team member'),
    compactTemplateText(task.title, 120),
    priorityLabel(task.priority, language),
    dueDateLabel(task.dueDate, language),
    compactTemplateText(task.description, 250),
    compactTemplateText(assignedBy, 60),
    compactTemplateText(taskUrl, 200),
  ].map(text => ({ type: 'text' as const, text }));

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone.slice(1),
    type: 'template',
    template: {
      name: config.taskTemplateName,
      language: { policy: 'deterministic', code: languageCode },
      components: [{ type: 'body', parameters }],
    },
  };
}

type FetchLike = typeof fetch;

export async function sendWhatsAppTaskAssignment(
  input: {
    recipient: WhatsAppTaskRecipient;
    task: WhatsAppTaskMessage;
    assignedBy: string;
    appUrl: string;
  },
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<WhatsAppSendResult> {
  const config = whatsappConfigFromEnv(options.env);
  if (!config) throw new WhatsAppConfigurationError('WhatsApp task notifications are not configured.');
  const payload = buildWhatsAppTaskTemplatePayload(
    config,
    input.recipient,
    input.task,
    input.assignedBy,
    input.appUrl,
  );
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
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: controller.signal,
      },
    );
    const body = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      const providerCode = Number(body?.error?.code);
      // Keep provider details useful without ever reflecting request headers or tokens.
      const providerMessage = compactTemplateText(body?.error?.message, 300, `HTTP ${response.status}`);
      throw new WhatsAppDeliveryError(
        `WhatsApp rejected the task notification: ${providerMessage}`,
        response.status,
        Number.isFinite(providerCode) ? providerCode : undefined,
      );
    }
    const messageId = typeof body?.messages?.[0]?.id === 'string' ? body.messages[0].id : '';
    if (!messageId) {
      throw new WhatsAppDeliveryError('WhatsApp accepted the request without returning a message ID.', 502);
    }
    return {
      messageId,
      recipientId: typeof body?.contacts?.[0]?.wa_id === 'string' ? body.contacts[0].wa_id : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new WhatsAppDeliveryError('WhatsApp task notification timed out.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
