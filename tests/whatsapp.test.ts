import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildWhatsAppTaskTemplatePayload,
  normalizeWhatsAppPhone,
  parseWhatsAppWebhookStatusEvents,
  sendWhatsAppTaskAssignment,
  verifyWhatsAppWebhookSignature,
  whatsappConfigFromEnv,
  whatsappWebhookConfigFromEnv,
  WhatsAppConfigurationError,
  WhatsAppDeliveryError,
  type WhatsAppCloudConfig,
} from '../server/whatsapp';

const config: WhatsAppCloudConfig = {
  accessToken: 'test-secret-token',
  phoneNumberId: '123456789012345',
  graphApiVersion: 'v26.0',
  taskTemplateName: 'cellarflow_task_assignment',
  englishLanguageCode: 'en_US',
  georgianLanguageCode: 'ka',
};

describe('WhatsApp task notifications', () => {
  it('normalizes international numbers without guessing a country code', () => {
    expect(normalizeWhatsAppPhone('+995 (555) 12-34-56')).toBe('+995555123456');
    expect(normalizeWhatsAppPhone('00995555123456')).toBe('+995555123456');
    expect(normalizeWhatsAppPhone('0555123456')).toBeNull();
    expect(normalizeWhatsAppPhone('not-a-phone')).toBeNull();
  });

  it('stays disabled when no Cloud API credentials are present and rejects partial configuration', () => {
    expect(whatsappConfigFromEnv({})).toBeNull();
    expect(() => whatsappConfigFromEnv({ WHATSAPP_ACCESS_TOKEN: 'only-one-value' })).toThrow(WhatsAppConfigurationError);
    expect(whatsappWebhookConfigFromEnv({})).toBeNull();
    expect(() => whatsappWebhookConfigFromEnv({
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'long-enough-verify-token',
    })).toThrow(WhatsAppConfigurationError);
  });

  it('builds the Georgian template variant in the documented parameter order', () => {
    const payload = buildWhatsAppTaskTemplatePayload(
      config,
      { phone: '+995555123456', fullName: 'ნინო', language: 'ka' },
      {
        id: 'task-1',
        title: 'ქვევრის შემოწმება',
        priority: 'high',
        dueDate: '2026-07-24',
        description: 'შეამოწმეთ ტემპერატურა',
      },
      'ლუკა',
      'https://cellarflow.example/',
    );

    expect(payload.to).toBe('995555123456');
    expect(payload.template.language).toEqual({ policy: 'deterministic', code: 'ka' });
    expect(payload.template.components[0].parameters.map(parameter => parameter.text)).toEqual([
      'ნინო',
      'ქვევრის შემოწმება',
      'მაღალი',
      expect.any(String),
      'შეამოწმეთ ტემპერატურა',
      'ლუკა',
      'https://cellarflow.example/tasks?task=task-1',
    ]);
  });

  it('verifies signed webhook bytes and extracts bounded delivery statuses', () => {
    const rawBody = Buffer.from(JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            statuses: [{
              id: 'wamid.test-123',
              status: 'delivered',
              timestamp: '1785000000',
            }, {
              id: 'wamid.test-456',
              status: 'failed',
              timestamp: '1785000001',
              errors: [{ code: 131026, title: 'Message undeliverable' }],
            }],
          },
        }],
      }],
    }));
    const appSecret = 'meta-test-app-secret-value';
    const signature = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;

    expect(verifyWhatsAppWebhookSignature(rawBody, signature, appSecret)).toBe(true);
    expect(verifyWhatsAppWebhookSignature(rawBody, tamperedSignature, appSecret)).toBe(false);
    expect(parseWhatsAppWebhookStatusEvents(JSON.parse(rawBody.toString('utf8')))).toEqual([
      expect.objectContaining({
        providerMessageId: 'wamid.test-123',
        status: 'delivered',
      }),
      expect.objectContaining({
        providerMessageId: 'wamid.test-456',
        status: 'failed',
        errorCode: '131026',
        errorMessage: 'Message undeliverable',
      }),
    ]);
  });

  it('posts only to Meta Graph and returns the accepted message id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      contacts: [{ wa_id: '995555123456' }],
      messages: [{ id: 'wamid.test-123' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await sendWhatsAppTaskAssignment({
      recipient: { phone: '+995555123456', fullName: 'Nino', language: 'en' },
      task: { id: 'task-2', title: 'Check tank', priority: 'medium', dueDate: '2026-07-25' },
      assignedBy: 'Luka',
      appUrl: 'https://cellarflow.example',
    }, {
      env: {
        WHATSAPP_ACCESS_TOKEN: config.accessToken,
        WHATSAPP_PHONE_NUMBER_ID: config.phoneNumberId,
        WHATSAPP_GRAPH_API_VERSION: config.graphApiVersion,
        WHATSAPP_TASK_TEMPLATE_NAME: config.taskTemplateName,
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toEqual({ messageId: 'wamid.test-123', recipientId: '995555123456' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v26.0/123456789012345/messages');
    expect(init.headers.Authorization).toBe('Bearer test-secret-token');
  });

  it('surfaces a bounded provider error without exposing credentials', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 132001, message: 'Template does not exist' },
    }), { status: 400, headers: { 'content-type': 'application/json' } }));

    await expect(sendWhatsAppTaskAssignment({
      recipient: { phone: '+995555123456', fullName: 'Nino', language: 'en' },
      task: { id: 'task-3', title: 'Check tank', priority: 'low', dueDate: '2026-07-25' },
      assignedBy: 'Luka',
      appUrl: 'https://cellarflow.example',
    }, {
      env: {
        WHATSAPP_ACCESS_TOKEN: config.accessToken,
        WHATSAPP_PHONE_NUMBER_ID: config.phoneNumberId,
        WHATSAPP_GRAPH_API_VERSION: config.graphApiVersion,
      },
      fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toEqual(expect.objectContaining<Partial<WhatsAppDeliveryError>>({
      status: 400,
      providerCode: 132001,
      message: expect.not.stringContaining(config.accessToken),
    }));
  });
});
