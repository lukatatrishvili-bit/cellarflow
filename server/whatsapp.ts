import { cleanEnv } from './config';

export type WhatsAppTaskLanguage = 'en' | 'ka';
export type WhatsAppTaskPriority = 'high' | 'medium' | 'low';

export interface WhatsAppTaskMessage {
  id: string;
  title: string;
  priority: WhatsAppTaskPriority;
  dueDate: string;
  description?: string;
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
  const taskUrl = appUrl.replace(/\/+$/, '');
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
