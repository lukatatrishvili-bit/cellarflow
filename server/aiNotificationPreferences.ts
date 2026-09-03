import { getDB, getPrismaClientForAdmin } from './db';
import {
  isFindingRoutedToRole,
  severityRank,
  type AiFindingRecord,
  type AiSeverity,
  type UserRole,
} from '../lib/ai';
import {
  aiWebPushConfigured,
  aiWebPushPublicKey,
  listAiPushSubscriptions,
} from './aiPushSubscriptions';

const SEVERITIES: AiSeverity[] = ['info', 'attention', 'warning', 'critical'];

export interface AiNotificationPreference {
  organizationId: string;
  username: string;
  emailEnabled: boolean;
  emailEnabledAt?: string;
  pushEnabled: boolean;
  pushEnabledAt?: string;
  minimumSeverity: AiSeverity;
  inAppMinimumSeverity: AiSeverity;
  notificationsEnabled: boolean;
  notificationsPausedUntil?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiEmailRecipient {
  username: string;
  role: UserRole;
}

export type AiExternalNotificationChannel = 'email' | 'push';

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
  const publicKey = aiWebPushPublicKey();
  return {
    ...email,
    pushConfigured: aiWebPushConfigured(),
    ...(publicKey ? { pushPublicKey: publicKey } : {}),
    pushSubscriptionCount: subscriptions.length,
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

export interface AiNotificationAccountStatus {
  emailVerified: boolean;
  hasEmail: boolean;
  pushConfigured: boolean;
  pushPublicKey?: string;
  pushSubscriptionCount: number;
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
    minimumSeverity: normalizeSeverity(value?.minimumSeverity),
    inAppMinimumSeverity: normalizeSeverity(value?.inAppMinimumSeverity, 'info'),
    notificationsEnabled: value?.notificationsEnabled !== false,
    ...(iso(value?.notificationsPausedUntil)
      ? { notificationsPausedUntil: iso(value.notificationsPausedUntil) }
      : {}),
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
  minimumSeverity: AiSeverity;
  inAppMinimumSeverity?: AiSeverity;
  notificationsEnabled?: boolean;
  notificationsPausedUntil?: string | Date | null;
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
    const inAppMinimumSeverity = normalizeSeverity(
      input.inAppMinimumSeverity ?? existing?.inAppMinimumSeverity,
      'info',
    );
    const notificationsEnabled = input.notificationsEnabled
      ?? (existing?.notificationsEnabled !== false);
    const notificationsPausedUntil = Object.prototype.hasOwnProperty.call(input, 'notificationsPausedUntil')
      ? input.notificationsPausedUntil == null
        ? null
        : new Date(input.notificationsPausedUntil)
      : existing?.notificationsPausedUntil || null;
    if (notificationsPausedUntil instanceof Date && Number.isNaN(notificationsPausedUntil.getTime())) {
      throw new Error('Notification pause end time is invalid.');
    }
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
        whatsappEnabled: false,
        whatsappEnabledAt: null,
        minimumSeverity,
        inAppMinimumSeverity,
        notificationsEnabled,
        notificationsPausedUntil,
      },
      update: {
        emailEnabled: input.emailEnabled,
        emailEnabledAt,
        pushEnabled,
        pushEnabledAt,
        whatsappEnabled: false,
        whatsappEnabledAt: null,
        minimumSeverity,
        inAppMinimumSeverity,
        notificationsEnabled,
        notificationsPausedUntil,
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
  const notificationsEnabled = input.notificationsEnabled
    ?? (existing?.notificationsEnabled !== false);
  const notificationsPausedUntil = Object.prototype.hasOwnProperty.call(input, 'notificationsPausedUntil')
    ? input.notificationsPausedUntil == null
      ? undefined
      : iso(input.notificationsPausedUntil)
    : existing?.notificationsPausedUntil;
  if (input.notificationsPausedUntil != null && !notificationsPausedUntil) {
    throw new Error('Notification pause end time is invalid.');
  }
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
    minimumSeverity,
    inAppMinimumSeverity,
    notificationsEnabled,
    ...(notificationsPausedUntil ? { notificationsPausedUntil } : {}),
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  localPreferences.set(key, record);
  return record;
}

/** A single quiet-mode decision is shared by every notification channel. */
export function notificationPreferenceIsMuted(
  preference: Pick<AiNotificationPreference, 'notificationsEnabled' | 'notificationsPausedUntil'>,
  now: Date = new Date(),
): boolean {
  if (!preference.notificationsEnabled) return true;
  if (!preference.notificationsPausedUntil) return false;
  const pausedUntil = new Date(preference.notificationsPausedUntil).getTime();
  return Number.isFinite(pausedUntil) && pausedUntil > now.getTime();
}

function notificationMuteReason(preference: AiNotificationPreference, now: Date = new Date()): string | null {
  if (!preference.notificationsEnabled) return 'Notifications are disabled by the recipient.';
  if (notificationPreferenceIsMuted(preference, now)) {
    return `Notifications are paused until ${preference.notificationsPausedUntil}.`;
  }
  return null;
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
  return preference.emailEnabled ? preference.emailEnabledAt : undefined;
}

function preferenceAllowsFinding(
  preference: AiNotificationPreference,
  finding: AiFindingRecord,
  channel: AiExternalNotificationChannel = 'email',
): boolean {
  if (notificationPreferenceIsMuted(preference)) return false;
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
        notificationsEnabled: true,
        notificationsPausedUntil: true,
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
): Promise<AiEmailRecipient[]> {
  if (!aiWebPushConfigured()) return [];
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const preferenceModel = (prisma as any).aiNotificationPreference;
    if (!preferenceModel) throw new Error('AI notification preference storage is unavailable.');
    const preferences = await preferenceModel.findMany({
      where: {
        organizationId,
        pushEnabled: true,
        user: { accountEnabled: true },
      },
    });
    if (preferences.length === 0) return [];
    const usernames = preferences.map((preference: any) => String(preference.username));
    const [memberships, pushRows] = await Promise.all([
      (prisma as any).membership.findMany({
        where: { organizationId, userId: { in: usernames } },
        select: { userId: true, role: true },
      }),
      (prisma as any).aiPushSubscription.findMany({
        where: { organizationId, username: { in: usernames } },
        select: { username: true },
      }),
    ]);
    const pushUsernames = new Set(pushRows.map((row: any) => String(row.username)));
    const preferenceByUsername = new Map<string, AiNotificationPreference>(
      preferences.map((value: any): [string, AiNotificationPreference] => [
        String(value.username),
        normalizePreference(value, organizationId, String(value.username)),
      ]),
    );
    return memberships
      .filter((membership: any) => {
        const preference = preferenceByUsername.get(String(membership.userId));
        if (
          !preference
          || !preferenceAllowsFinding(preference, finding, 'push')
          || !isFindingRoutedToRole(membership.role as UserRole, finding)
        ) {
          return false;
        }
        return pushUsernames.has(String(membership.userId));
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
  const pushUsers = new Set(
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
  );
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
        || !preferenceAllowsFinding(preference, finding, 'push')
        || !isFindingRoutedToRole(membership.role as UserRole, finding)
      ) {
        return false;
      }
      return pushUsers.has(username);
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
  const [email, push] = await Promise.all([
    eligibleAiEmailRecipients(organizationId, finding),
    eligibleAiRecipientsForChannel(organizationId, finding),
  ]);
  return [
    ...email.map((recipient) => ({ ...recipient, channel: 'email' as const })),
    ...push.map((recipient) => ({ ...recipient, channel: 'push' as const })),
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
    const muteReason = notificationMuteReason(preference);
    if (muteReason) return { eligible: false, reason: muteReason };
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
  const muteReason = notificationMuteReason(preference);
  if (muteReason) return { eligible: false, reason: muteReason };
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
  const muteReason = notificationMuteReason(input.preference);
  if (muteReason) return muteReason;
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

export function __resetInMemoryAiNotificationPreferences(): void {
  localPreferences.clear();
}
