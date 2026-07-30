import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    users: [{
      username: 'nino',
      email: 'nino@example.com',
      emailVerified: true,
      accountEnabled: true,
      language: 'ka',
      phone: '+995555123456',
      whatsappOptIn: true,
    }] as any[],
    memberships: [{
      organizationId: 'org-a',
      userId: 'nino',
      role: 'Winemaker',
    }] as any[],
    organizations: [{ id: 'org-a', name: 'მარანი ალაზანი' }] as any[],
  },
}));

vi.mock('../server/db', () => ({
  getDB: () => mocks.db,
  getPrismaClientForAdmin: async () => null,
}));

import type { AiFindingRecord } from '../lib/ai';
import {
  __resetInMemoryAiNotificationPreferences,
  eligibleAiNotificationRecipients,
  setAiNotificationPreference,
} from '../server/aiNotificationPreferences';
import {
  __resetInMemoryAiPushSubscriptions,
  listAiPushSubscriptions,
  registerAiPushSubscription,
  validateAiPushSubscription,
} from '../server/aiPushSubscriptions';
import {
  __resetInMemoryAiNotificationOutbox,
  enqueueAiFindingNotifications,
} from '../server/aiNotificationOutbox';
import { deliverAiNotificationBatch } from '../server/aiNotificationDelivery';
import {
  aiWhatsAppConfigFromEnv,
  buildAiWhatsAppTemplatePayload,
} from '../server/aiNotificationWhatsApp';
import { buildAiWebPushPayload } from '../server/aiNotificationPush';

function finding(overrides: Partial<AiFindingRecord> = {}): AiFindingRecord {
  return {
    id: 'ai-fermentation-l1',
    createdAt: '2026-07-31T11:00:00.000Z',
    source: 'rule',
    agent: 'winemaking',
    area: 'fermentation',
    findingType: 'fermentation_slowdown',
    severity: 'warning',
    entityType: 'lot',
    entityId: 'L1',
    entityLabel: 'Saperavi L1',
    relatedEntities: [],
    title: { en: 'Fermentation is slowing', ka: 'დუღილი ნელდება' },
    observation: {
      en: 'Density decline is below the winery baseline.',
      ka: 'სიმკვრივის კლება მარნის საბაზისო მაჩვენებელზე დაბალია.',
    },
    whyItMatters: {
      en: 'The fermentation may stop before dryness.',
      ka: 'დუღილი შეიძლება სიმშრალემდე შეჩერდეს.',
    },
    possibleCauses: [],
    recommendedActions: [],
    evidence: [],
    confidence: { level: 'high', score: 0.9, reasons: [] },
    missingInformation: [],
    requiresHumanConfirmation: true,
    requiredModules: [],
    roles: ['Winemaker'],
    cooldownHours: 24,
    dedupeKey: 'fermentation_slowdown:L1',
    status: 'new',
    lastSeenAt: '2026-07-31T11:00:00.000Z',
    lastNotificationAt: '2026-07-31T11:00:00.000Z',
    lastNotificationEventKey: 'fermentation_slowdown:L1:2026-07-31T11:00:00.000Z:warning',
    occurrences: 1,
    ...overrides,
  };
}

const envKeys = [
  'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
  'WEB_PUSH_VAPID_SUBJECT',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_GRAPH_API_VERSION',
  'WHATSAPP_AI_FINDING_TEMPLATE_NAME',
  'WHATSAPP_AI_FINDING_TEMPLATE_LANGUAGE_EN',
  'WHATSAPP_AI_FINDING_TEMPLATE_LANGUAGE_KA',
] as const;

describe('AI notification delivery channels', () => {
  beforeEach(async () => {
    __resetInMemoryAiNotificationPreferences();
    __resetInMemoryAiPushSubscriptions();
    __resetInMemoryAiNotificationOutbox();
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'public-key-for-tests';
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'private-key-for-tests';
    process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:alerts@example.com';
    process.env.WHATSAPP_ACCESS_TOKEN = 'secret-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    process.env.WHATSAPP_GRAPH_API_VERSION = 'v26.0';
    process.env.WHATSAPP_AI_FINDING_TEMPLATE_NAME = 'cellarflow_ai_finding';
    process.env.WHATSAPP_AI_FINDING_TEMPLATE_LANGUAGE_EN = 'en_US';
    process.env.WHATSAPP_AI_FINDING_TEMPLATE_LANGUAGE_KA = 'ka';

    await registerAiPushSubscription({
      organizationId: 'org-a',
      username: 'nino',
      subscription: {
        endpoint: 'https://push.example.com/subscription/abc',
        expirationTime: null,
        keys: {
          p256dh: 'p256dh-test-key',
          auth: 'auth-test-key',
        },
      },
      now: new Date('2026-07-31T10:00:00.000Z'),
    });
    await setAiNotificationPreference({
      organizationId: 'org-a',
      username: 'nino',
      emailEnabled: false,
      pushEnabled: true,
      whatsappEnabled: true,
      minimumSeverity: 'warning',
      now: new Date('2026-07-31T10:00:00.000Z'),
    });
  });

  afterEach(() => {
    for (const key of envKeys) delete process.env[key];
  });

  it('requires HTTPS endpoints and keeps subscriptions tenant scoped', async () => {
    expect(() => validateAiPushSubscription({
      endpoint: 'http://push.example.com/sub',
      keys: { p256dh: 'p256dh-test-key', auth: 'auth-test-key' },
    })).toThrow(/HTTPS/);

    expect(await listAiPushSubscriptions('org-a', 'nino')).toHaveLength(1);
    expect(await listAiPushSubscriptions('org-b', 'nino')).toEqual([]);
  });

  it('routes only opted-in post-consent events to push and WhatsApp', async () => {
    const eligible = await eligibleAiNotificationRecipients('org-a', finding());
    expect(eligible.map((recipient) => recipient.channel).sort()).toEqual([
      'push',
      'whatsapp',
    ]);

    const old = await eligibleAiNotificationRecipients('org-a', finding({
      lastSeenAt: '2026-07-31T09:00:00.000Z',
      lastNotificationAt: '2026-07-31T09:00:00.000Z',
    }));
    expect(old).toEqual([]);
  });

  it('delivers each channel through the durable outbox adapter switch', async () => {
    expect(await enqueueAiFindingNotifications('org-a', [finding()])).toBe(2);
    const pushSender = vi.fn(async () => ({ delivered: 1, expired: 0 }));
    const whatsappSender = vi.fn(async () => ({ messageId: 'wamid.ai-test' }));

    const result = await deliverAiNotificationBatch({
      limit: 10,
      now: new Date('2026-07-31T11:01:00.000Z'),
      appUrl: 'https://vinos.example',
      pushSender,
      whatsappSender,
    });

    expect(result).toEqual({
      claimed: 2,
      delivered: 2,
      cancelled: 0,
      retried: 0,
      failed: 0,
    });
    expect(pushSender).toHaveBeenCalledWith(expect.objectContaining({
      username: 'nino',
      language: 'ka',
      payload: expect.objectContaining({ findingId: 'ai-fermentation-l1' }),
    }));
    expect(whatsappSender).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+995555123456',
      language: 'ka',
    }));
  });

  it('builds localized provider payloads without storing recipient details', () => {
    const config = aiWhatsAppConfigFromEnv();
    expect(config).not.toBeNull();
    const payload = buildAiWhatsAppTemplatePayload({
      config: config!,
      phone: '+995555123456',
      language: 'ka',
      wineryName: 'მარანი ალაზანი',
      payload: {
        version: 1,
        findingId: finding().id,
        dedupeKey: finding().dedupeKey,
        source: 'rule',
        severity: 'warning',
        area: 'fermentation',
        entityType: 'lot',
        entityId: 'L1',
        entityLabel: 'Saperavi L1',
        title: finding().title,
        observation: finding().observation,
        whyItMatters: finding().whyItMatters,
        createdAt: finding().createdAt,
        lastSeenAt: finding().lastSeenAt,
        occurrences: 1,
      },
      appUrl: 'https://vinos.example',
    });
    expect(payload.to).toBe('995555123456');
    expect(payload.template.language.code).toBe('ka');
    expect(JSON.stringify(payload)).toContain('დუღილი ნელდება');
    expect(JSON.stringify(payload)).not.toContain('secret-token');

    const push = buildAiWebPushPayload({
      language: 'en',
      wineryName: 'Alazani',
      payload: {
        version: 1,
        findingId: finding().id,
        dedupeKey: finding().dedupeKey,
        source: 'rule',
        severity: 'warning',
        area: 'fermentation',
        entityType: 'lot',
        entityId: 'L1',
        entityLabel: 'Saperavi L1',
        title: finding().title,
        observation: finding().observation,
        whyItMatters: finding().whyItMatters,
        createdAt: finding().createdAt,
        lastSeenAt: finding().lastSeenAt,
        occurrences: 1,
      },
      appUrl: 'https://vinos.example',
    });
    expect(push.data.url).toBe('https://vinos.example/?aiFinding=ai-fermentation-l1');
    expect(push.tag).toBe('ai-finding-ai-fermentation-l1');
  });

  it('ships explicit opt-in defaults and tenant-scoped push subscriptions', () => {
    const migration = fs.readFileSync(path.resolve(
      'prisma/migrations/20260731004500_ai_notification_channels/migration.sql',
    ), 'utf8');
    expect(migration).toContain('"pushEnabled" BOOLEAN NOT NULL DEFAULT false');
    expect(migration).toContain('"whatsappEnabled" BOOLEAN NOT NULL DEFAULT false');
    expect(migration).toContain(
      '"AiPushSubscription_organizationId_username_endpointHash_key"',
    );
    expect(migration.match(/ON DELETE CASCADE/g)).toHaveLength(2);
  });
});
