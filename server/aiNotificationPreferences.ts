import { getDB, getPrismaClientForAdmin } from './db';
import {
  isFindingRoutedToRole,
  severityRank,
  type AiFindingRecord,
  type AiSeverity,
  type UserRole,
} from '../lib/ai';
import { normalizeWhatsAppPhone } from './whatsapp';
import {
  aiWebPushConfigured,
  aiWebPushPublicKey,
  listAiPushSubscriptions,
} from './aiPushSubscriptions';
import { aiWhatsAppConfigured } from './aiNotificationWhatsApp';

const SEVERITIES: AiSeverity[] = ['info', 'attention', 'warning', 'critical'];

export interface AiNotificationPreference {
  organizationId: string;
  username: string;
  emailEnabled: boolean;
  emailEnabledAt?: string;
  pushEnabled: boolean;
  pushEnabledAt?: string;
  whatsappEnabled: boolean;
  whatsappEnabledAt?: string;
  minimumSeverity: AiSeverity;
  inAppMinimumSeverity: AiSeverity;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiEmailRecipient {
  username: string;
  role: UserRole;
}

export type AiExternalNotificationChannel = 'email' | 'push' | 'whatsapp';

export interface AiNotificationRecipient extends AiEmailRecipient {
  channel: AiExternalNotificationChannel;
}

export async function getAiEmailAccountStatus(username: string): Promise<{
  emailVerified: boolean;
  hasEmail: boolean;
}> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const user = await (prisma as any).user.findUnique({
      where: { username },
      select: { email: true, emailVerified: true, accountEnabled: true },
    });
    return {
      emailVerified: user?.accountEnabled === true && user?.emailVerified === true,
      hasEmail: typeof user?.email === 'string' && user.email.length > 0,
    };
  }
  const user = (getDB().users || []).find((candidate: any) => candidate?.username === username);
  return {
    emailVerified: user?.accountEnabled !== false && user?.emailVerified === true,
    hasEmail: typeof user?.email === 'string' && user.email.length > 0,
  };
}

export async function getAiNotificationAccountStatus(
  organizationId: string,
  username: string,
): Promise<AiNotificationAccountStatus> {
  const [email, subscriptions] = await Promise.all([
    getAiEmailAccountStatus(username),
    listAiPushSubscriptions(organizationId, username),
  ]);
  const prisma = await getPrismaClientForAdmin();
  let user: any;
  if (prisma) {
    user = await (prisma as any).user.findUnique({
      where: { username },
      select: { phone: true, whatsappOptIn: true, accountEnabled: true },
    });
  } else {
    user = (getDB().users || []).find((candidate: any) => candidate?.username === username);
  }
  const publicKey = aiWebPushPublicKey();
  return {
    ...email,
    pushConfigured: aiWebPushConfigured(),
    ...(publicKey ? { pushPublicKey: publicKey } : {}),
    pushSubscriptionCount: subscriptions.length,
    whatsappConfigured: aiWhatsAppConfigured(),
    whatsappReady: user?.accountEnabled !== false
      && user?.whatsappOptIn === true
      && Boolean(normalizeWhatsAppPhone(user?.phone)),
  };
}

export type AiEmailDeliveryEligibility =
  | {
    eligible: true;
    email: string;
    language: 'en' | 'ka';
    wineryName: string;
  }
  | { eligible: false; reason: string };

export type AiPushDeliveryEligibility =
  | {
    eligible: true;
    language: 'en' | 'ka';
    wineryName: string;
  }
  | { eligible: false; reason: string };

export type AiWhatsAppDeliveryEligibility =
  | {
    eligible: true;
    phone: string;
    language: 'en' | 'ka';
    wineryName: string;
  }
  | { eligible: false; reason: string };

export interface AiNotificationAccountStatus {
  emailVerified: boolean;
  hasEmail: boolean;
  pushConfigured: boolean;
  pushPublicKey?: string;
  pushSubscriptionCount: number;
  whatsappConfigured: boolean;
  whatsappReady: boolean;
}

const localPreferences = new Map<string, AiNotificationPreference>();

function preferenceKey(organizationId: string, username: string): string {
  return `${organizationId}:${username}`;
}

function normalizeSeverity(value: unknown, fallback: AiSeverity = 'warning'): AiSeverity {
  return SEVERITIES.includes(value as AiSeverity) ? value as AiSeverity : fallback;
}

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizePreference(
  value: any,
  organizationId: string,
  username: string,
): AiNotificationPreference {
  return {
    organizationId,
    username,
    emailEnabled: value?.emailEnabled === true,
    ...(iso(value?.emailEnabledAt) ? { emailEnabledAt: iso(value.emailEnabledAt) } : {}),
    pushEnabled: value?.pushEnabled === true,
    ...(iso(value?.pushEnabledAt) ? { pushEnabledAt: iso(value.pushEnabledAt) } : {}),
    whatsappEnabled: value?.whatsappEnabled === true,
    ...(iso(value?.whatsappEnabledAt) ? { whatsappEnabledAt: iso(value.whatsappEnabledAt) } : {}),
    minimumSeverity: normalizeSeverity(value?.minimumSeverity),
    inAppMinimumSeverity: normalizeSeverity(value?.inAppMinimumSeverity, 'info'),
    ...(iso(value?.createdAt) ? { createdAt: iso(value.createdAt) } : {}),
    ...(iso(value?.updatedAt) ? { updatedAt: iso(value.updatedAt) } : {}),
  };
}

export async function getAiNotificationPreference(
  organizationId: string,
  username: string,
): Promise<AiNotificationPreference> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiNotificationPreference;
    if (!model) {
      throw new Error('AI notification preference storage is unavailable. Apply the committed database migration.');
    }
    const row = await model.findUnique({
      where: { organizationId_username: { organizationId, username } },
    });
    return normalizePreference(row, organizationId, username);
  }
  return localPreferences.get(preferenceKey(organizationId, username))
    || normalizePreference(null, organizationId, username);
}

export async function setAiNotificationPreference(input: {
  organizationId: string;
  username: string;
  emailEnabled: boolean;
  pushEnabled?: boolean;
  whatsappEnabled?: boolean;
  minimumSeverity: AiSeverity;
  inAppMinimumSeverity?: AiSeverity;
  now?: Date;
}): Promise<AiNotificationPreference> {
  const now = input.now || new Date();
  const minimumSeverity = normalizeSeverity(input.minimumSeverity);
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiNotificationPreference;
    if (!model) {
      throw new Error('AI notification preference storage is unavailable. Apply the committed database migration.');
    }
    const existing = await model.findUnique({
      where: {
        organizationId_username: {
          organizationId: input.organizationId,
          username: input.username,
        },
      },
    });
    const emailEnabledAt = input.emailEnabled
      ? existing?.emailEnabled === true && existing.emailEnabledAt
        ? existing.emailEnabledAt
        : now
      : null;
    const pushEnabled = input.pushEnabled ?? (existing?.pushEnabled === true);
    const pushEnabledAt = pushEnabled
      ? existing?.pushEnabled === true && existing.pushEnabledAt
        ? existing.pushEnabledAt
        : now
      : null;
    const whatsappEnabled = input.whatsappEnabled ?? (existing?.whatsappEnabled === true);
    const whatsappEnabledAt = whatsappEnabled
      ? existing?.whatsappEnabled === true && existing.whatsappEnabledAt
        ? existing.whatsappEnabledAt
        : now
      : null;
    const inAppMinimumSeverity = normalizeSeverity(
      input.inAppMinimumSeverity ?? existing?.inAppMinimumSeverity,
      'info',
    );
    const row = await model.upsert({
      where: {
        organizationId_username: {
          organizationId: input.organizationId,
          username: input.username,
        },
      },
      create: {
        organizationId: input.organizationId,
        username: input.username,
        emailEnabled: input.emailEnabled,
        emailEnabledAt,
        pushEnabled,
        pushEnabledAt,
        whatsappEnabled,
        whatsappEnabledAt,
        minimumSeverity,
        inAppMinimumSeverity,
      },
      update: {
        emailEnabled: input.emailEnabled,
        emailEnabledAt,
        pushEnabled,
        pushEnabledAt,
        whatsappEnabled,
        whatsappEnabledAt,
        minimumSeverity,
        inAppMinimumSeverity,
      },
    });
    return normalizePreference(row, input.organizationId, input.username);
  }

  const key = preferenceKey(input.organizationId, input.username);
  const existing = localPreferences.get(key);
  const inAppMinimumSeverity = normalizeSeverity(
    input.inAppMinimumSeverity ?? existing?.inAppMinimumSeverity,
    'info',
  );
  const timestamp = now.toISOString();
  const pushEnabled = input.pushEnabled ?? (existing?.pushEnabled === true);
  const whatsappEnabled = input.whatsappEnabled ?? (existing?.whatsappEnabled === true);
  const record: AiNotificationPreference = {
    organizationId: input.organizationId,
    username: input.username,
    emailEnabled: input.emailEnabled,
    ...(input.emailEnabled
      ? { emailEnabledAt: existing?.emailEnabled && existing.emailEnabledAt
        ? existing.emailEnabledAt
        : timestamp }
      : {}),
    pushEnabled,
    ...(pushEnabled
      ? { pushEnabledAt: existing?.pushEnabled && existing.pushEnabledAt
        ? existing.pushEnabledAt
        : timestamp }
      : {}),
    whatsappEnabled,
    ...(whatsappEnabled
      ? { whatsappEnabledAt: existing?.whatsappEnabled && existing.whatsappEnabledAt
        ? existing.whatsappEnabledAt
        : timestamp }
      : {}),
    minimumSeverity,
    inAppMinimumSeverity,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  localPreferences.set(key, record);
  return record;
}

function transitionOccurredAt(finding: AiFindingRecord): number {
  const timestamp = finding.lastNotificationAt || finding.lastSeenAt;
  const time = new Date(timestamp).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function channelEnabledAt(
  preference: AiNotificationPreference,
  channel: AiExternalNotificationChannel,
): string | undefined {
  if (channel === 'push') return preference.pushEnabled ? preference.pushEnabledAt : undefined;
  if (channel === 'whatsapp') {
    return preference.whatsappEnabled ? preference.whatsappEnabledAt : undefined;
  }
  return preference.emailEnabled ? preference.emailEnabledAt : undefined;
}

function preferenceAllowsFinding(
  preference: AiNotificationPreference,
  finding: AiFindingRecord,
  channel: AiExternalNotificationChannel = 'email',
): boolean {
  const enabledAt = channelEnabledAt(preference, channel);
  if (!enabledAt) return false;
  if (severityRank(finding.severity) < severityRank(preference.minimumSeverity)) return false;
  return transitionOccurredAt(finding) >= new Date(enabledAt).getTime();
}

/** Resolves only users who explicitly opted in before this finding transition. */
export async function eligibleAiEmailRecipients(
  organizationId: string,
  finding: AiFindingRecord,
): Promise<AiEmailRecipient[]> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const preferenceModel = (prisma as any).aiNotificationPreference;
    if (!preferenceModel) throw new Error('AI notification preference storage is unavailable.');
    const preferences = await preferenceModel.findMany({
      where: {
        organizationId,
        emailEnabled: true,
        user: { accountEnabled: true, emailVerified: true },
      },
      select: {
        username: true,
        emailEnabled: true,
        emailEnabledAt: true,
        minimumSeverity: true,
      },
    });
    if (preferences.length === 0) return [];
    const memberships = await (prisma as any).membership.findMany({
      where: {
        organizationId,
        userId: { in: preferences.map((preference: any) => preference.username) },
      },
      select: { userId: true, role: true },
    });
    const preferenceByUsername = new Map<string, AiNotificationPreference>(
      preferences.map((preference: any) => [
        String(preference.username),
        normalizePreference(preference, organizationId, String(preference.username)),
      ]),
    );
    return memberships
      .filter((membership: any) => {
        const preference = preferenceByUsername.get(String(membership.userId));
        return preference
          && preferenceAllowsFinding(preference, finding)
          && isFindingRoutedToRole(membership.role as UserRole, finding);
      })
      .map((membership: any) => ({
        username: String(membership.userId),
        role: membership.role as UserRole,
      }));
  }

  const db = getDB();
  const userByUsername = new Map(
    (db.users || []).map((user: any) => [String(user.username), user]),
  );
  return (db.memberships || [])
    .filter((membership: any) => membership?.organizationId === organizationId)
    .filter((membership: any) => {
      const username = String(membership.userId || '');
      const user: any = userByUsername.get(username);
      const preference = localPreferences.get(preferenceKey(organizationId, username));
      return user?.accountEnabled !== false
        && user?.emailVerified === true
        && Boolean(preference && preferenceAllowsFinding(preference, finding))
        && isFindingRoutedToRole(membership.role as UserRole, finding);
    })
    .map((membership: any) => ({
      username: String(membership.userId),
      role: membership.role as UserRole,
    }));
}

async function eligibleAiRecipientsForChannel(
  organizationId: string,
  finding: AiFindingRecord,
  channel: 'push' | 'whatsapp',
): Promise<AiEmailRecipient[]> {
  if (channel === 'push' && !aiWebPushConfigured()) return [];
  if (channel === 'whatsapp' && !aiWhatsAppConfigured()) return [];
  const enabledField = channel === 'push' ? 'pushEnabled' : 'whatsappEnabled';
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const preferenceModel = (prisma as any).aiNotificationPreference;
    if (!preferenceModel) throw new Error('AI notification preference storage is unavailable.');
    const preferences = await preferenceModel.findMany({
      where: {
        organizationId,
        [enabledField]: true,
        user: { accountEnabled: true },
      },
      include: {
        user: {
          select: {
            phone: true,
            whatsappOptIn: true,
            accountEnabled: true,
          },
        },
      },
    });
    if (preferences.length === 0) return [];
    const usernames = preferences.map((preference: any) => String(preference.username));
    const [memberships, pushRows] = await Promise.all([
      (prisma as any).membership.findMany({
        where: { organizationId, userId: { in: usernames } },
        select: { userId: true, role: true },
      }),
      channel === 'push'
        ? (prisma as any).aiPushSubscription.findMany({
          where: { organizationId, username: { in: usernames } },
          select: { username: true },
        })
        : Promise.resolve([]),
    ]);
    const pushUsernames = new Set(pushRows.map((row: any) => String(row.username)));
    const preferenceByUsername = new Map(
      preferences.map((value: any) => [
        String(value.username),
        {
          preference: normalizePreference(value, organizationId, String(value.username)),
          user: value.user,
        },
      ]),
    );
    return memberships
      .filter((membership: any) => {
        const entry = preferenceByUsername.get(String(membership.userId)) as {
          preference: AiNotificationPreference;
          user: any;
        } | undefined;
        if (
          !entry
          || !preferenceAllowsFinding(entry.preference, finding, channel)
          || !isFindingRoutedToRole(membership.role as UserRole, finding)
        ) {
          return false;
        }
        if (channel === 'push') return pushUsernames.has(String(membership.userId));
        return entry.user?.whatsappOptIn === true
          && Boolean(normalizeWhatsAppPhone(entry.user?.phone));
      })
      .map((membership: any) => ({
        username: String(membership.userId),
        role: membership.role as UserRole,
      }));
  }

  const db = getDB();
  const userByUsername = new Map(
    (db.users || []).map((user: any) => [String(user.username), user]),
  );
  const pushUsers = channel === 'push'
    ? new Set(
      (await Promise.all(
        (db.memberships || [])
          .filter((membership: any) => membership?.organizationId === organizationId)
          .map(async (membership: any) => ({
            username: String(membership.userId || ''),
            subscriptions: await listAiPushSubscriptions(
              organizationId,
              String(membership.userId || ''),
            ),
          })),
      ))
        .filter((entry) => entry.subscriptions.length > 0)
        .map((entry) => entry.username),
    )
    : new Set<string>();
  return (db.memberships || [])
    .filter((membership: any) => membership?.organizationId === organizationId)
    .filter((membership: any) => {
      const username = String(membership.userId || '');
      const user: any = userByUsername.get(username);
      const preference = localPreferences.get(preferenceKey(organizationId, username));
      if (
        !user
        || user.accountEnabled === false
        || !preference
        || !preferenceAllowsFinding(preference, finding, channel)
        || !isFindingRoutedToRole(membership.role as UserRole, finding)
      ) {
        return false;
      }
      if (channel === 'push') return pushUsers.has(username);
      return user.whatsappOptIn === true && Boolean(normalizeWhatsAppPhone(user.phone));
    })
    .map((membership: any) => ({
      username: String(membership.userId),
      role: membership.role as UserRole,
    }));
}

export async function eligibleAiNotificationRecipients(
  organizationId: string,
  finding: AiFindingRecord,
): Promise<AiNotificationRecipient[]> {
  const [email, push, whatsapp] = await Promise.all([
    eligibleAiEmailRecipients(organizationId, finding),
    eligibleAiRecipientsForChannel(organizationId, finding, 'push'),
    eligibleAiRecipientsForChannel(organizationId, finding, 'whatsapp'),
  ]);
  return [
    ...email.map((recipient) => ({ ...recipient, channel: 'email' as const })),
    ...push.map((recipient) => ({ ...recipient, channel: 'push' as const })),
    ...whatsapp.map((recipient) => ({ ...recipient, channel: 'whatsapp' as const })),
  ];
}

export async function aiEmailDeliveryEligibility(input: {
  organizationId: string;
  username: string;
  recipientRole: UserRole;
  severity: AiSeverity;
  eventOccurredAt: string;
}): Promise<AiEmailDeliveryEligibility> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const preferenceModel = (prisma as any).aiNotificationPreference;
    if (!preferenceModel) throw new Error('AI notification preference storage is unavailable.');
    const [preferenceValue, membership] = await Promise.all([
      preferenceModel.findUnique({
        where: {
          organizationId_username: {
            organizationId: input.organizationId,
            username: input.username,
          },
        },
        include: {
          user: { select: { email: true, emailVerified: true, accountEnabled: true, language: true } },
          organization: { select: { name: true } },
        },
      }),
      (prisma as any).membership.findUnique({
        where: {
          userId_organizationId: {
            userId: input.username,
            organizationId: input.organizationId,
          },
        },
        select: { role: true },
      }),
    ]);
    const preference = normalizePreference(preferenceValue, input.organizationId, input.username);
    if (!preferenceValue || !preference.emailEnabled || !preference.emailEnabledAt) {
      return { eligible: false, reason: 'Email alerts are not enabled for this winery.' };
    }
    if (membership?.role !== input.recipientRole) {
      return { eligible: false, reason: 'Recipient role changed before delivery.' };
    }
    if (!preferenceValue.user?.accountEnabled || !preferenceValue.user?.emailVerified) {
      return { eligible: false, reason: 'Recipient account or verified email is unavailable.' };
    }
    if (severityRank(input.severity) < severityRank(preference.minimumSeverity)) {
      return { eligible: false, reason: 'Finding is below the recipient severity threshold.' };
    }
    if (new Date(input.eventOccurredAt) < new Date(preference.emailEnabledAt)) {
      return { eligible: false, reason: 'Finding predates the recipient email opt-in.' };
    }
    return {
      eligible: true,
      email: String(preferenceValue.user.email),
      language: preferenceValue.user.language === 'ka' ? 'ka' : 'en',
      wineryName: String(preferenceValue.organization?.name || 'Winery'),
    };
  }

  const preference = localPreferences.get(preferenceKey(input.organizationId, input.username));
  const db = getDB();
  const user = (db.users || []).find((candidate: any) => candidate?.username === input.username);
  const membership = (db.memberships || []).find((candidate: any) => (
    candidate?.organizationId === input.organizationId && candidate?.userId === input.username
  ));
  const organization = (db.organizations || []).find((candidate: any) => candidate?.id === input.organizationId);
  if (!preference?.emailEnabled || !preference.emailEnabledAt) {
    return { eligible: false, reason: 'Email alerts are not enabled for this winery.' };
  }
  if (membership?.role !== input.recipientRole) {
    return { eligible: false, reason: 'Recipient role changed before delivery.' };
  }
  if (!user || user.accountEnabled === false || user.emailVerified !== true || !user.email) {
    return { eligible: false, reason: 'Recipient account or verified email is unavailable.' };
  }
  if (severityRank(input.severity) < severityRank(preference.minimumSeverity)) {
    return { eligible: false, reason: 'Finding is below the recipient severity threshold.' };
  }
  if (new Date(input.eventOccurredAt) < new Date(preference.emailEnabledAt)) {
    return { eligible: false, reason: 'Finding predates the recipient email opt-in.' };
  }
  return {
    eligible: true,
    email: String(user.email),
    language: user.language === 'ka' ? 'ka' : 'en',
    wineryName: String(organization?.name || 'Winery'),
  };
}

function deliveryPreferenceAllows(input: {
  preference: AiNotificationPreference;
  channel: AiExternalNotificationChannel;
  severity: AiSeverity;
  eventOccurredAt: string;
}): string | null {
  const enabledAt = channelEnabledAt(input.preference, input.channel);
  if (!enabledAt) return `${input.channel} alerts are not enabled for this winery.`;
  if (severityRank(input.severity) < severityRank(input.preference.minimumSeverity)) {
    return 'Finding is below the recipient severity threshold.';
  }
  if (new Date(input.eventOccurredAt) < new Date(enabledAt)) {
    return `Finding predates the recipient ${input.channel} opt-in.`;
  }
  return null;
}

export async function aiPushDeliveryEligibility(input: {
  organizationId: string;
  username: string;
  recipientRole: UserRole;
  severity: AiSeverity;
  eventOccurredAt: string;
}): Promise<AiPushDeliveryEligibility> {
  if (!aiWebPushConfigured()) {
    return { eligible: false, reason: 'Web push is not configured.' };
  }
  const prisma = await getPrismaClientForAdmin();
  let preferenceValue: any;
  let membership: any;
  let language: 'en' | 'ka' = 'en';
  let wineryName = 'Winery';
  if (prisma) {
    const model = (prisma as any).aiNotificationPreference;
    if (!model) throw new Error('AI notification preference storage is unavailable.');
    [preferenceValue, membership] = await Promise.all([
      model.findUnique({
        where: {
          organizationId_username: {
            organizationId: input.organizationId,
            username: input.username,
          },
        },
        include: {
          user: { select: { accountEnabled: true, language: true } },
          organization: { select: { name: true } },
        },
      }),
      (prisma as any).membership.findUnique({
        where: {
          userId_organizationId: {
            userId: input.username,
            organizationId: input.organizationId,
          },
        },
        select: { role: true },
      }),
    ]);
    if (!preferenceValue?.user?.accountEnabled) {
      return { eligible: false, reason: 'Recipient account is unavailable.' };
    }
    language = preferenceValue.user.language === 'ka' ? 'ka' : 'en';
    wineryName = String(preferenceValue.organization?.name || 'Winery');
  } else {
    const db = getDB();
    preferenceValue = localPreferences.get(preferenceKey(input.organizationId, input.username));
    membership = (db.memberships || []).find((candidate: any) => (
      candidate?.organizationId === input.organizationId
      && candidate?.userId === input.username
    ));
    const user = (db.users || []).find((candidate: any) => candidate?.username === input.username);
    if (!user || user.accountEnabled === false) {
      return { eligible: false, reason: 'Recipient account is unavailable.' };
    }
    language = user.language === 'ka' ? 'ka' : 'en';
    wineryName = String(
      (db.organizations || []).find((candidate: any) => (
        candidate?.id === input.organizationId
      ))?.name || 'Winery',
    );
  }
  if (membership?.role !== input.recipientRole) {
    return { eligible: false, reason: 'Recipient role changed before delivery.' };
  }
  const preference = normalizePreference(
    preferenceValue,
    input.organizationId,
    input.username,
  );
  const preferenceReason = deliveryPreferenceAllows({
    preference,
    channel: 'push',
    severity: input.severity,
    eventOccurredAt: input.eventOccurredAt,
  });
  if (preferenceReason) return { eligible: false, reason: preferenceReason };
  if ((await listAiPushSubscriptions(input.organizationId, input.username)).length === 0) {
    return { eligible: false, reason: 'Recipient has no active browser subscription.' };
  }
  return { eligible: true, language, wineryName };
}

export async function aiWhatsAppDeliveryEligibility(input: {
  organizationId: string;
  username: string;
  recipientRole: UserRole;
  severity: AiSeverity;
  eventOccurredAt: string;
}): Promise<AiWhatsAppDeliveryEligibility> {
  if (!aiWhatsAppConfigured()) {
    return { eligible: false, reason: 'AI WhatsApp delivery is not configured.' };
  }
  const prisma = await getPrismaClientForAdmin();
  let preferenceValue: any;
  let membership: any;
  let user: any;
  let wineryName = 'Winery';
  if (prisma) {
    const model = (prisma as any).aiNotificationPreference;
    if (!model) throw new Error('AI notification preference storage is unavailable.');
    [preferenceValue, membership] = await Promise.all([
      model.findUnique({
        where: {
          organizationId_username: {
            organizationId: input.organizationId,
            username: input.username,
          },
        },
        include: {
          user: {
            select: {
              phone: true,
              whatsappOptIn: true,
              accountEnabled: true,
              language: true,
            },
          },
          organization: { select: { name: true } },
        },
      }),
      (prisma as any).membership.findUnique({
        where: {
          userId_organizationId: {
            userId: input.username,
            organizationId: input.organizationId,
          },
        },
        select: { role: true },
      }),
    ]);
    user = preferenceValue?.user;
    wineryName = String(preferenceValue?.organization?.name || 'Winery');
  } else {
    const db = getDB();
    preferenceValue = localPreferences.get(preferenceKey(input.organizationId, input.username));
    membership = (db.memberships || []).find((candidate: any) => (
      candidate?.organizationId === input.organizationId
      && candidate?.userId === input.username
    ));
    user = (db.users || []).find((candidate: any) => candidate?.username === input.username);
    wineryName = String(
      (db.organizations || []).find((candidate: any) => (
        candidate?.id === input.organizationId
      ))?.name || 'Winery',
    );
  }
  if (membership?.role !== input.recipientRole) {
    return { eligible: false, reason: 'Recipient role changed before delivery.' };
  }
  const phone = normalizeWhatsAppPhone(user?.phone);
  if (!user || user.accountEnabled === false || user.whatsappOptIn !== true || !phone) {
    return { eligible: false, reason: 'Recipient WhatsApp opt-in or phone is unavailable.' };
  }
  const preference = normalizePreference(
    preferenceValue,
    input.organizationId,
    input.username,
  );
  const preferenceReason = deliveryPreferenceAllows({
    preference,
    channel: 'whatsapp',
    severity: input.severity,
    eventOccurredAt: input.eventOccurredAt,
  });
  if (preferenceReason) return { eligible: false, reason: preferenceReason };
  return {
    eligible: true,
    phone,
    language: user.language === 'ka' ? 'ka' : 'en',
    wineryName,
  };
}

export function __resetInMemoryAiNotificationPreferences(): void {
  localPreferences.clear();
}
