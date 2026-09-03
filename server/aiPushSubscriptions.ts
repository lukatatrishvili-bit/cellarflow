import crypto from 'crypto';
import { getPrismaClientForAdmin } from './db';

export interface AiPushSubscriptionRecord {
  id: string;
  organizationId: string;
  username: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  expirationTime?: number;
  createdAt: string;
  updatedAt: string;
}

const localSubscriptions = new Map<string, AiPushSubscriptionRecord>();

function endpointHash(endpoint: string): string {
  return crypto.createHash('sha256').update(endpoint).digest('hex');
}

function key(organizationId: string, username: string, endpoint: string): string {
  return `${organizationId}:${username}:${endpointHash(endpoint)}`;
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value || 0));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function normalize(value: any): AiPushSubscriptionRecord {
  const rawExpiration = value?.expirationTime;
  const expirationTime = rawExpiration === null || rawExpiration === undefined
    ? undefined
    : Number(rawExpiration);
  return {
    id: String(value.id),
    organizationId: String(value.organizationId),
    username: String(value.username),
    endpoint: String(value.endpoint),
    p256dh: String(value.p256dh),
    auth: String(value.auth),
    ...(typeof value.userAgent === 'string' && value.userAgent
      ? { userAgent: value.userAgent }
      : {}),
    ...(Number.isFinite(expirationTime) ? { expirationTime } : {}),
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  };
}

function cleanKey(value: unknown, label: string): string {
  const cleaned = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,512}$/.test(cleaned)) {
    throw new Error(`Push subscription ${label} is invalid.`);
  }
  return cleaned;
}

export function validateAiPushSubscription(value: unknown): {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime?: number;
} {
  const candidate = value as {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  } | null;
  let endpoint: string;
  try {
    const url = new URL(String(candidate?.endpoint || ''));
    if (url.protocol !== 'https:') throw new Error();
    endpoint = url.toString();
  } catch {
    throw new Error('Push subscription endpoint must be a valid HTTPS URL.');
  }
  const expiration = candidate?.expirationTime === null || candidate?.expirationTime === undefined
    ? undefined
    : Number(candidate.expirationTime);
  if (expiration !== undefined && (!Number.isFinite(expiration) || expiration <= Date.now())) {
    throw new Error('Push subscription expiration time is invalid.');
  }
  return {
    endpoint,
    p256dh: cleanKey(candidate?.keys?.p256dh, 'p256dh key'),
    auth: cleanKey(candidate?.keys?.auth, 'auth key'),
    ...(expiration !== undefined ? { expirationTime: Math.floor(expiration) } : {}),
  };
}

export function aiWebPushPublicKey(): string | undefined {
  const value = (process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  return value || undefined;
}

export function aiWebPushConfigured(): boolean {
  return Boolean(
    aiWebPushPublicKey()
    && (process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim()
    && (process.env.WEB_PUSH_VAPID_SUBJECT || '').trim(),
  );
}

export async function registerAiPushSubscription(input: {
  organizationId: string;
  username: string;
  subscription: unknown;
  userAgent?: string;
  now?: Date;
}): Promise<AiPushSubscriptionRecord> {
  const validated = validateAiPushSubscription(input.subscription);
  const now = input.now || new Date();
  const hash = endpointHash(validated.endpoint);
  const userAgent = String(input.userAgent || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiPushSubscription;
    if (!model) {
      throw new Error('AI push subscription storage is unavailable. Apply the committed database migration.');
    }
    return normalize(await model.upsert({
      where: {
        organizationId_username_endpointHash: {
          organizationId: input.organizationId,
          username: input.username,
          endpointHash: hash,
        },
      },
      create: {
        organizationId: input.organizationId,
        username: input.username,
        endpointHash: hash,
        endpoint: validated.endpoint,
        p256dh: validated.p256dh,
        auth: validated.auth,
        userAgent: userAgent || null,
        expirationTime: validated.expirationTime === undefined
          ? null
          : BigInt(validated.expirationTime),
        createdAt: now,
        updatedAt: now,
      },
      update: {
        endpoint: validated.endpoint,
        p256dh: validated.p256dh,
        auth: validated.auth,
        userAgent: userAgent || null,
        expirationTime: validated.expirationTime === undefined
          ? null
          : BigInt(validated.expirationTime),
        updatedAt: now,
      },
    }));
  }

  const storageKey = key(input.organizationId, input.username, validated.endpoint);
  const existing = localSubscriptions.get(storageKey);
  const timestamp = now.toISOString();
  const record: AiPushSubscriptionRecord = {
    id: existing?.id || `aips_${crypto.randomUUID()}`,
    organizationId: input.organizationId,
    username: input.username,
    ...validated,
    ...(userAgent ? { userAgent } : {}),
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  localSubscriptions.set(storageKey, record);
  return record;
}

export async function listAiPushSubscriptions(
  organizationId: string,
  username: string,
): Promise<AiPushSubscriptionRecord[]> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiPushSubscription;
    if (!model) throw new Error('AI push subscription storage is unavailable.');
    const rows = await model.findMany({
      where: { organizationId, username },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(normalize);
  }
  return [...localSubscriptions.values()]
    .filter((record) => (
      record.organizationId === organizationId && record.username === username
    ))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function removeAiPushSubscription(input: {
  organizationId: string;
  username: string;
  endpoint: string;
}): Promise<boolean> {
  let endpoint: string;
  try {
    endpoint = new URL(input.endpoint).toString();
  } catch {
    return false;
  }
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiPushSubscription;
    if (!model) throw new Error('AI push subscription storage is unavailable.');
    const result = await model.deleteMany({
      where: {
        organizationId: input.organizationId,
        username: input.username,
        endpointHash: endpointHash(endpoint),
      },
    });
    return result.count > 0;
  }
  return localSubscriptions.delete(key(input.organizationId, input.username, endpoint));
}

export async function removeAiPushSubscriptionById(input: {
  organizationId: string;
  username: string;
  id: string;
}): Promise<boolean> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiPushSubscription;
    if (!model) throw new Error('AI push subscription storage is unavailable.');
    const result = await model.deleteMany({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        username: input.username,
      },
    });
    return result.count > 0;
  }
  const entry = [...localSubscriptions.entries()].find(([, record]) => (
    record.id === input.id
    && record.organizationId === input.organizationId
    && record.username === input.username
  ));
  return entry ? localSubscriptions.delete(entry[0]) : false;
}

export function __resetInMemoryAiPushSubscriptions(): void {
  localSubscriptions.clear();
}
