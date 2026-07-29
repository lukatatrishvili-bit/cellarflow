import crypto from 'crypto';
import { getDB, getPrismaClientForAdmin } from './db';
import { type AiFindingRecord, type UserRole } from '../lib/ai';
import {
  aiEmailDeliveryEligibility,
  eligibleAiEmailRecipients,
} from './aiNotificationPreferences';

export type AiOutboxStatus = 'pending' | 'processing' | 'delivered' | 'failed' | 'cancelled';

const OUTBOX_LEASE_MS = 5 * 60 * 1_000;
const MAX_DELIVERY_ATTEMPTS = 5;
export interface AiNotificationPayload {
  version: 1;
  findingId: string;
  dedupeKey: string;
  source: AiFindingRecord['source'];
  severity: AiFindingRecord['severity'];
  area: AiFindingRecord['area'];
  entityType: AiFindingRecord['entityType'];
  entityId: string;
  entityLabel: string;
  title: AiFindingRecord['title'];
  observation: AiFindingRecord['observation'];
  whyItMatters: AiFindingRecord['whyItMatters'];
  modelLanguage?: AiFindingRecord['modelLanguage'];
  createdAt: string;
  lastSeenAt: string;
  occurrences: number;
}

export interface AiNotificationOutboxRecord {
  id: string;
  organizationId: string;
  eventKey: string;
  channel: 'email';
  findingId: string;
  findingDedupeKey: string;
  recipientUsername: string;
  recipientRole: UserRole;
  severity: AiFindingRecord['severity'];
  priority: number;
  area: AiFindingRecord['area'];
  payload: AiNotificationPayload;
  status: AiOutboxStatus;
  attemptCount: number;
  availableAt: string;
  claimToken?: string;
  claimedAt?: string;
  deliveredAt?: string;
  failedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export type AiNotificationOperationsRecord = Omit<
  AiNotificationOutboxRecord,
  'payload' | 'claimToken'
>;

export interface AiNotificationOperationsSnapshot {
  backend: 'postgresql' | 'memory';
  counts: Record<AiOutboxStatus, number>;
  readyToDeliver: number;
  staleProcessing: number;
  oldestPendingAt?: string;
  latestDeliveredAt?: string;
  recent: AiNotificationOperationsRecord[];
  recentFailures: AiNotificationOperationsRecord[];
}

export type AiNotificationRetryResult =
  | { outcome: 'queued'; record: AiNotificationOperationsRecord }
  | { outcome: 'not_found' }
  | { outcome: 'not_retryable'; status: AiOutboxStatus }
  | { outcome: 'ineligible'; reason: string }
  | { outcome: 'conflict' };

const localOutbox = new Map<string, AiNotificationOutboxRecord>();

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeOutbox(value: any): AiNotificationOutboxRecord {
  return {
    id: String(value.id),
    organizationId: String(value.organizationId),
    eventKey: String(value.eventKey),
    channel: 'email',
    findingId: String(value.findingId),
    findingDedupeKey: String(value.findingDedupeKey),
    recipientUsername: String(value.recipientUsername),
    recipientRole: value.recipientRole as UserRole,
    severity: value.severity,
    area: value.area,
    payload: value.payload as AiNotificationPayload,
    priority: Math.max(0, Math.min(3, Number(value.priority) || 0)),
    status: ['pending', 'processing', 'delivered', 'failed', 'cancelled'].includes(value.status)
      ? value.status
      : 'failed',
    attemptCount: Math.max(0, Number(value.attemptCount) || 0),
    availableAt: iso(value.availableAt) || new Date().toISOString(),
    ...(typeof value.claimToken === 'string' && value.claimToken ? { claimToken: value.claimToken } : {}),
    ...(iso(value.claimedAt) ? { claimedAt: iso(value.claimedAt) } : {}),
    ...(iso(value.deliveredAt) ? { deliveredAt: iso(value.deliveredAt) } : {}),
    ...(iso(value.failedAt) ? { failedAt: iso(value.failedAt) } : {}),
    ...(typeof value.lastError === 'string' && value.lastError ? { lastError: value.lastError } : {}),
    createdAt: iso(value.createdAt) || new Date().toISOString(),
    updatedAt: iso(value.updatedAt) || new Date().toISOString(),
  };
}

function operationalRecord(
  value: AiNotificationOutboxRecord,
): AiNotificationOperationsRecord {
  const { payload: _payload, claimToken: _claimToken, ...record } = value;
  return record;
}

export function aiFindingNotificationEventKey(finding: AiFindingRecord): string {
  return `${finding.dedupeKey}:${finding.lastSeenAt}:${finding.severity}`;
}

function payload(finding: AiFindingRecord): AiNotificationPayload {
  return {
    version: 1,
    findingId: finding.id,
    dedupeKey: finding.dedupeKey,
    source: finding.source,
    severity: finding.severity,
    area: finding.area,
    entityType: finding.entityType,
    entityId: finding.entityId,
    entityLabel: finding.entityLabel,
    title: finding.title,
    observation: finding.observation,
    whyItMatters: finding.whyItMatters,
    ...(finding.modelLanguage ? { modelLanguage: finding.modelLanguage } : {}),
    createdAt: finding.createdAt,
    lastSeenAt: finding.lastSeenAt,
    occurrences: finding.occurrences,
  };
}

function severityPriority(severity: AiFindingRecord['severity']): number {
  if (severity === 'critical') return 3;
  if (severity === 'warning') return 2;
  if (severity === 'attention') return 1;
  return 0;
}

async function recipientIsStillEligible(
  record: AiNotificationOutboxRecord,
  prisma: any | null,
): Promise<boolean> {
  if (prisma) {
    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: record.recipientUsername,
          organizationId: record.organizationId,
        },
      },
      select: { role: true, user: { select: { accountEnabled: true } } },
    });
    return membership?.user?.accountEnabled === true && membership.role === record.recipientRole;
  }

  const db = getDB();
  const user = (db.users || []).find((candidate: any) => (
    candidate?.username === record.recipientUsername && candidate?.accountEnabled !== false
  ));
  if (!user) return false;
  return (db.memberships || []).some((membership: any) => (
    membership?.organizationId === record.organizationId
    && membership?.userId === record.recipientUsername
    && membership?.role === record.recipientRole
  ));
}

/** Enqueues one idempotent event per currently routed, enabled winery member. */
export async function enqueueAiFindingNotifications(
  organizationId: string,
  findings: AiFindingRecord[],
  now: Date = new Date(),
): Promise<number> {
  const prisma = await getPrismaClientForAdmin();
  const rows: Array<Record<string, unknown>> = [];
  for (const finding of findings) {
    const key = finding.lastNotificationEventKey || aiFindingNotificationEventKey(finding);
    const findingPayload = payload(finding);
    const recipients = await eligibleAiEmailRecipients(organizationId, finding);
    rows.push(...recipients.map((recipient) => ({
      organizationId,
      eventKey: key,
      channel: 'email',
      findingId: finding.id,
      findingDedupeKey: finding.dedupeKey,
      recipientUsername: recipient.username,
      recipientRole: recipient.role,
      severity: finding.severity,
      priority: severityPriority(finding.severity),
      area: finding.area,
      payload: findingPayload,
      status: 'pending',
      availableAt: now,
    })));
  }
  if (rows.length === 0) return 0;

  if (prisma) {
    const model = (prisma as any).aiNotificationOutbox;
    if (!model) {
      throw new Error('AI notification outbox storage is unavailable. Apply the committed database migration.');
    }
    const result = await model.createMany({ data: rows, skipDuplicates: true });
    return result.count;
  }

  let queued = 0;
  for (const row of rows) {
    const key = `${row.organizationId}:${row.eventKey}:${row.recipientUsername}:${row.channel}`;
    if (localOutbox.has(key)) continue;
    const timestamp = now.toISOString();
    localOutbox.set(key, normalizeOutbox({
      ...row,
      id: `aino_${crypto.randomUUID()}`,
      attemptCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    queued += 1;
  }
  return queued;
}

/**
 * Claims pending work for a future email/push/WhatsApp adapter. This module
 * deliberately does not choose or call a provider.
 */
export async function claimAiNotificationBatch(
  limit = 25,
  now: Date = new Date(),
): Promise<AiNotificationOutboxRecord[]> {
  const take = Math.max(1, Math.min(100, Math.floor(limit)));
  const claimToken = crypto.randomUUID();
  const staleBefore = new Date(now.getTime() - OUTBOX_LEASE_MS);
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiNotificationOutbox;
    if (!model) throw new Error('AI notification outbox storage is unavailable.');
    const candidates = await model.findMany({
      where: {
        OR: [
          { status: 'pending', availableAt: { lte: now } },
          { status: 'processing', claimedAt: { lte: staleBefore } },
        ],
      },
      orderBy: [{ priority: 'desc' }, { availableAt: 'asc' }],
      take,
    });
    const claimed: AiNotificationOutboxRecord[] = [];
    for (const candidate of candidates) {
      const result = await model.updateMany({
        where: {
          id: candidate.id,
          updatedAt: candidate.updatedAt,
          status: candidate.status,
        },
        data: {
          status: 'processing',
          claimToken,
          claimedAt: now,
          attemptCount: { increment: 1 },
          lastError: null,
          failedAt: null,
          updatedAt: now,
        },
      });
      if (result.count !== 1) continue;
      const row = await model.findUnique({ where: { id: candidate.id } });
      if (!row) continue;
      const normalized = normalizeOutbox(row);
      if (!await recipientIsStillEligible(normalized, prisma)) {
        await model.updateMany({
          where: { id: normalized.id, claimToken, status: 'processing' },
          data: {
            status: 'cancelled',
            claimToken: null,
            claimedAt: null,
            lastError: 'Recipient membership or account eligibility changed before delivery.',
          },
        });
        continue;
      }
      claimed.push(normalized);
    }
    return claimed;
  }

  const candidates = [...localOutbox.values()]
    .filter((row) => (
      (row.status === 'pending' && new Date(row.availableAt) <= now)
      || (row.status === 'processing' && row.claimedAt && new Date(row.claimedAt) <= staleBefore)
    ))
    .sort((left, right) => (
      right.priority - left.priority || left.availableAt.localeCompare(right.availableAt)
    ))
    .slice(0, take);
  const claimed: AiNotificationOutboxRecord[] = [];
  for (const row of candidates) {
    if (!await recipientIsStillEligible(row, null)) {
      Object.assign(row, {
        status: 'cancelled',
        lastError: 'Recipient membership or account eligibility changed before delivery.',
        updatedAt: now.toISOString(),
      });
      continue;
    }
    Object.assign(row, {
      status: 'processing',
      claimToken,
      claimedAt: now.toISOString(),
      attemptCount: row.attemptCount + 1,
      failedAt: undefined,
      lastError: undefined,
      updatedAt: now.toISOString(),
    });
    claimed.push(row);
  }
  return claimed;
}

export async function completeAiNotification(
  id: string,
  claimToken: string,
  now: Date = new Date(),
): Promise<boolean> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiNotificationOutbox;
    if (!model) throw new Error('AI notification outbox storage is unavailable.');
    const result = await model.updateMany({
      where: { id, claimToken, status: 'processing' },
      data: {
        status: 'delivered',
        deliveredAt: now,
        claimToken: null,
        claimedAt: null,
        lastError: null,
      },
    });
    return result.count === 1;
  }
  const row = [...localOutbox.values()].find((item) => item.id === id);
  if (!row || row.status !== 'processing' || row.claimToken !== claimToken) return false;
  Object.assign(row, {
    status: 'delivered',
    deliveredAt: now.toISOString(),
    claimToken: undefined,
    claimedAt: undefined,
    lastError: undefined,
    updatedAt: now.toISOString(),
  });
  return true;
}

export async function cancelAiNotification(
  id: string,
  claimToken: string,
  reason: string,
  now: Date = new Date(),
): Promise<boolean> {
  const lastError = reason.trim().slice(0, 1_000) || 'Delivery cancelled.';
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiNotificationOutbox;
    if (!model) throw new Error('AI notification outbox storage is unavailable.');
    const result = await model.updateMany({
      where: { id, claimToken, status: 'processing' },
      data: {
        status: 'cancelled',
        claimToken: null,
        claimedAt: null,
        failedAt: null,
        lastError,
      },
    });
    return result.count === 1;
  }
  const row = [...localOutbox.values()].find((item) => item.id === id);
  if (!row || row.status !== 'processing' || row.claimToken !== claimToken) return false;
  Object.assign(row, {
    status: 'cancelled',
    claimToken: undefined,
    claimedAt: undefined,
    failedAt: undefined,
    lastError,
    updatedAt: now.toISOString(),
  });
  return true;
}

export async function failAiNotification(
  id: string,
  claimToken: string,
  error: unknown,
  now: Date = new Date(),
): Promise<boolean> {
  const message = (error instanceof Error ? error.message : String(error || 'delivery failed')).slice(0, 1_000);
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiNotificationOutbox;
    if (!model) throw new Error('AI notification outbox storage is unavailable.');
    const row = await model.findFirst({ where: { id, claimToken, status: 'processing' } });
    if (!row) return false;
    const terminal = row.attemptCount >= MAX_DELIVERY_ATTEMPTS;
    const retryDelayMs = Math.min(60, 2 ** Math.max(0, row.attemptCount - 1)) * 60_000;
    const result = await model.updateMany({
      where: { id, claimToken, status: 'processing' },
      data: {
        status: terminal ? 'failed' : 'pending',
        availableAt: terminal ? row.availableAt : new Date(now.getTime() + retryDelayMs),
        failedAt: terminal ? now : null,
        lastError: message,
        claimToken: null,
        claimedAt: null,
      },
    });
    return result.count === 1;
  }
  const row = [...localOutbox.values()].find((item) => item.id === id);
  if (!row || row.status !== 'processing' || row.claimToken !== claimToken) return false;
  const terminal = row.attemptCount >= MAX_DELIVERY_ATTEMPTS;
  const retryDelayMs = Math.min(60, 2 ** Math.max(0, row.attemptCount - 1)) * 60_000;
  Object.assign(row, {
    status: terminal ? 'failed' : 'pending',
    availableAt: terminal ? row.availableAt : new Date(now.getTime() + retryDelayMs).toISOString(),
    failedAt: terminal ? now.toISOString() : undefined,
    lastError: message,
    claimToken: undefined,
    claimedAt: undefined,
    updatedAt: now.toISOString(),
  });
  return true;
}

/** Bounded operational status that never exposes notification message payloads. */
export async function getAiNotificationOutboxOperations(
  limit = 25,
  now: Date = new Date(),
): Promise<AiNotificationOperationsSnapshot> {
  const take = Math.max(1, Math.min(100, Math.floor(limit)));
  const staleBefore = new Date(now.getTime() - OUTBOX_LEASE_MS);
  const statuses: AiOutboxStatus[] = [
    'pending',
    'processing',
    'delivered',
    'failed',
    'cancelled',
  ];
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiNotificationOutbox;
    if (!model) throw new Error('AI notification outbox storage is unavailable.');
    const [
      statusCounts,
      readyToDeliver,
      staleProcessing,
      oldestPending,
      latestDelivered,
      recent,
      recentFailures,
    ] = await Promise.all([
      Promise.all(statuses.map((status) => model.count({ where: { status } }))),
      model.count({ where: { status: 'pending', availableAt: { lte: now } } }),
      model.count({ where: { status: 'processing', claimedAt: { lte: staleBefore } } }),
      model.findFirst({
        where: { status: 'pending' },
        orderBy: { availableAt: 'asc' },
        select: { availableAt: true },
      }),
      model.findFirst({
        where: { status: 'delivered' },
        orderBy: { deliveredAt: 'desc' },
        select: { deliveredAt: true },
      }),
      model.findMany({ orderBy: { createdAt: 'desc' }, take }),
      model.findMany({
        where: { status: 'failed' },
        orderBy: { failedAt: 'desc' },
        take,
      }),
    ]);
    return {
      backend: 'postgresql',
      counts: Object.fromEntries(
        statuses.map((status, index) => [status, statusCounts[index]]),
      ) as Record<AiOutboxStatus, number>,
      readyToDeliver,
      staleProcessing,
      ...(iso(oldestPending?.availableAt)
        ? { oldestPendingAt: iso(oldestPending.availableAt) }
        : {}),
      ...(iso(latestDelivered?.deliveredAt)
        ? { latestDeliveredAt: iso(latestDelivered.deliveredAt) }
        : {}),
      recent: recent.map(normalizeOutbox).map(operationalRecord),
      recentFailures: recentFailures.map(normalizeOutbox).map(operationalRecord),
    };
  }

  const records = [...localOutbox.values()];
  const counts = Object.fromEntries(statuses.map((status) => [
    status,
    records.filter((record) => record.status === status).length,
  ])) as Record<AiOutboxStatus, number>;
  const pendingTimes = records
    .filter((record) => record.status === 'pending')
    .map((record) => record.availableAt)
    .sort();
  const deliveredTimes = records
    .flatMap((record) => record.deliveredAt ? [record.deliveredAt] : [])
    .sort();
  return {
    backend: 'memory',
    counts,
    readyToDeliver: records.filter((record) => (
      record.status === 'pending' && new Date(record.availableAt) <= now
    )).length,
    staleProcessing: records.filter((record) => (
      record.status === 'processing'
      && record.claimedAt
      && new Date(record.claimedAt) <= staleBefore
    )).length,
    ...(pendingTimes[0] ? { oldestPendingAt: pendingTimes[0] } : {}),
    ...(deliveredTimes.at(-1) ? { latestDeliveredAt: deliveredTimes.at(-1) } : {}),
    recent: records
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, take)
      .map(operationalRecord),
    recentFailures: records
      .filter((record) => record.status === 'failed')
      .sort((left, right) => (right.failedAt || '').localeCompare(left.failedAt || ''))
      .slice(0, take)
      .map(operationalRecord),
  };
}

/**
 * Requeues only a terminal failure and only while its original recipient is
 * still eligible. The delivery worker performs the same check again at send.
 */
export async function retryFailedAiNotification(
  id: string,
  now: Date = new Date(),
): Promise<AiNotificationRetryResult> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiNotificationOutbox;
    if (!model) throw new Error('AI notification outbox storage is unavailable.');
    const value = await model.findUnique({ where: { id } });
    if (!value) return { outcome: 'not_found' };
    const record = normalizeOutbox(value);
    if (record.status !== 'failed') {
      return { outcome: 'not_retryable', status: record.status };
    }
    const eligibility = await aiEmailDeliveryEligibility({
      organizationId: record.organizationId,
      username: record.recipientUsername,
      recipientRole: record.recipientRole,
      severity: record.severity,
      eventOccurredAt: record.payload.lastSeenAt,
    });
    if (!eligibility.eligible) {
      return { outcome: 'ineligible', reason: eligibility.reason };
    }
    const result = await model.updateMany({
      where: { id, status: 'failed', updatedAt: value.updatedAt },
      data: {
        status: 'pending',
        attemptCount: 0,
        availableAt: now,
        claimToken: null,
        claimedAt: null,
        failedAt: null,
        lastError: null,
      },
    });
    if (result.count !== 1) return { outcome: 'conflict' };
    const queued = await model.findUnique({ where: { id } });
    return {
      outcome: 'queued',
      record: operationalRecord(normalizeOutbox(queued)),
    };
  }

  const record = [...localOutbox.values()].find((candidate) => candidate.id === id);
  if (!record) return { outcome: 'not_found' };
  if (record.status !== 'failed') {
    return { outcome: 'not_retryable', status: record.status };
  }
  const eligibility = await aiEmailDeliveryEligibility({
    organizationId: record.organizationId,
    username: record.recipientUsername,
    recipientRole: record.recipientRole,
    severity: record.severity,
    eventOccurredAt: record.payload.lastSeenAt,
  });
  if (!eligibility.eligible) {
    return { outcome: 'ineligible', reason: eligibility.reason };
  }
  Object.assign(record, {
    status: 'pending',
    attemptCount: 0,
    availableAt: now.toISOString(),
    claimToken: undefined,
    claimedAt: undefined,
    failedAt: undefined,
    lastError: undefined,
    updatedAt: now.toISOString(),
  });
  return { outcome: 'queued', record: operationalRecord({ ...record }) };
}

export function __resetInMemoryAiNotificationOutbox(): void {
  localOutbox.clear();
}
