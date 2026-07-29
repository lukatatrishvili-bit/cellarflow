import { getDB, getPrismaClientForAdmin } from './db';
import {
  isFindingRoutedToRole,
  severityRank,
  type AiFindingRecord,
  type AiSeverity,
  type UserRole,
} from '../lib/ai';

const SEVERITIES: AiSeverity[] = ['info', 'attention', 'warning', 'critical'];

export interface AiNotificationPreference {
  organizationId: string;
  username: string;
  emailEnabled: boolean;
  emailEnabledAt?: string;
  minimumSeverity: AiSeverity;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiEmailRecipient {
  username: string;
  role: UserRole;
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

export type AiEmailDeliveryEligibility =
  | {
    eligible: true;
    email: string;
    language: 'en' | 'ka';
    wineryName: string;
  }
  | { eligible: false; reason: string };

const localPreferences = new Map<string, AiNotificationPreference>();

function preferenceKey(organizationId: string, username: string): string {
  return `${organizationId}:${username}`;
}

function normalizeSeverity(value: unknown): AiSeverity {
  return SEVERITIES.includes(value as AiSeverity) ? value as AiSeverity : 'warning';
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
    minimumSeverity: normalizeSeverity(value?.minimumSeverity),
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
  minimumSeverity: AiSeverity;
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
        minimumSeverity,
      },
      update: {
        emailEnabled: input.emailEnabled,
        emailEnabledAt,
        minimumSeverity,
      },
    });
    return normalizePreference(row, input.organizationId, input.username);
  }

  const key = preferenceKey(input.organizationId, input.username);
  const existing = localPreferences.get(key);
  const timestamp = now.toISOString();
  const record: AiNotificationPreference = {
    organizationId: input.organizationId,
    username: input.username,
    emailEnabled: input.emailEnabled,
    ...(input.emailEnabled
      ? { emailEnabledAt: existing?.emailEnabled && existing.emailEnabledAt
        ? existing.emailEnabledAt
        : timestamp }
      : {}),
    minimumSeverity,
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

function preferenceAllowsFinding(
  preference: AiNotificationPreference,
  finding: AiFindingRecord,
): boolean {
  if (!preference.emailEnabled || !preference.emailEnabledAt) return false;
  if (severityRank(finding.severity) < severityRank(preference.minimumSeverity)) return false;
  return transitionOccurredAt(finding) >= new Date(preference.emailEnabledAt).getTime();
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

export function __resetInMemoryAiNotificationPreferences(): void {
  localPreferences.clear();
}
