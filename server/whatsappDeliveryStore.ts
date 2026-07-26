import crypto from 'crypto';
import { getDB, getPrismaClientForAdmin, saveDB } from './db';
import type {
  WhatsAppDeliveryStatus,
  WhatsAppTaskLanguage,
  WhatsAppWebhookStatusEvent,
} from './whatsapp';

const ACTIVE_OR_SUCCESS = new Set<WhatsAppDeliveryStatus>(['accepted', 'sent', 'delivered', 'read']);
const CLAIM_TIMEOUT_MS = 2 * 60 * 1_000;
const STATUS_RANK: Record<WhatsAppDeliveryStatus, number> = {
  sending: 0,
  accepted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: -1,
};

export interface WhatsAppDeliveryRecord {
  id: string;
  organizationId: string;
  taskId: string;
  assigneeUsername: string;
  senderUsername: string;
  templateName: string;
  language: WhatsAppTaskLanguage;
  status: WhatsAppDeliveryStatus;
  claimToken: string;
  providerMessageId?: string;
  attemptCount: number;
  errorCode?: string;
  errorMessage?: string;
  acceptedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  lastWebhookAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppDeliveryStatusProjection {
  taskId: string;
  status: WhatsAppDeliveryStatus;
  messageId?: string;
  language: WhatsAppTaskLanguage;
  updatedAt: string;
  error?: string;
}

export type WhatsAppDeliveryClaim =
  | { outcome: 'claimed'; record: WhatsAppDeliveryRecord; claimToken: string }
  | { outcome: 'replay' | 'in_progress'; record: WhatsAppDeliveryRecord };

function whatsappDeliveryModel(prisma: any): any {
  return prisma?.whatsAppDelivery || prisma?.whatsappDelivery;
}

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeRecord(value: any): WhatsAppDeliveryRecord {
  return {
    id: String(value.id),
    organizationId: String(value.organizationId),
    taskId: String(value.taskId),
    assigneeUsername: String(value.assigneeUsername),
    senderUsername: String(value.senderUsername),
    templateName: String(value.templateName),
    language: value.language === 'ka' ? 'ka' : 'en',
    status: ['sending', 'accepted', 'sent', 'delivered', 'read', 'failed'].includes(value.status)
      ? value.status
      : 'failed',
    claimToken: String(value.claimToken || ''),
    ...(typeof value.providerMessageId === 'string' && value.providerMessageId
      ? { providerMessageId: value.providerMessageId }
      : {}),
    attemptCount: Number.isInteger(Number(value.attemptCount)) && Number(value.attemptCount) > 0
      ? Number(value.attemptCount)
      : 1,
    ...(typeof value.errorCode === 'string' && value.errorCode ? { errorCode: value.errorCode } : {}),
    ...(typeof value.errorMessage === 'string' && value.errorMessage ? { errorMessage: value.errorMessage } : {}),
    ...(iso(value.acceptedAt) ? { acceptedAt: iso(value.acceptedAt) } : {}),
    ...(iso(value.sentAt) ? { sentAt: iso(value.sentAt) } : {}),
    ...(iso(value.deliveredAt) ? { deliveredAt: iso(value.deliveredAt) } : {}),
    ...(iso(value.readAt) ? { readAt: iso(value.readAt) } : {}),
    ...(iso(value.failedAt) ? { failedAt: iso(value.failedAt) } : {}),
    ...(iso(value.lastWebhookAt) ? { lastWebhookAt: iso(value.lastWebhookAt) } : {}),
    createdAt: iso(value.createdAt) || new Date().toISOString(),
    updatedAt: iso(value.updatedAt) || new Date().toISOString(),
  };
}

function localRows(): WhatsAppDeliveryRecord[] {
  const db = getDB();
  if (!Array.isArray(db.whatsappDeliveries)) db.whatsappDeliveries = [];
  db.whatsappDeliveries = db.whatsappDeliveries.map(normalizeRecord);
  return db.whatsappDeliveries;
}

function persistLocal(): void {
  saveDB({ syncPostgres: false });
}

function isRecentClaim(record: WhatsAppDeliveryRecord): boolean {
  return record.status === 'sending'
    && Date.now() - new Date(record.updatedAt).getTime() < CLAIM_TIMEOUT_MS;
}

async function reserveWithPrisma(
  model: any,
  input: {
    organizationId: string;
    taskId: string;
    assigneeUsername: string;
    senderUsername: string;
    templateName: string;
    language: WhatsAppTaskLanguage;
  },
  remainingAttempts = 3,
): Promise<WhatsAppDeliveryClaim> {
  const claimToken = crypto.randomUUID();
  const now = new Date();
  try {
    const created = await model.create({
      data: {
        ...input,
        claimToken,
        status: 'sending',
        attemptCount: 1,
      },
    });
    return { outcome: 'claimed', record: normalizeRecord(created), claimToken };
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
  }

  const existingValue = await model.findUnique({
    where: {
      organizationId_taskId: {
        organizationId: input.organizationId,
        taskId: input.taskId,
      },
    },
  });
  if (!existingValue) {
    if (remainingAttempts <= 0) throw new Error('Could not claim WhatsApp delivery.');
    return reserveWithPrisma(model, input, remainingAttempts - 1);
  }

  const existing = normalizeRecord(existingValue);
  if (ACTIVE_OR_SUCCESS.has(existing.status)) return { outcome: 'replay', record: existing };
  if (isRecentClaim(existing)) return { outcome: 'in_progress', record: existing };

  const claimed = await model.updateMany({
    where: {
      id: existing.id,
      updatedAt: existingValue.updatedAt,
      status: { in: ['sending', 'failed'] },
    },
    data: {
      ...input,
      status: 'sending',
      claimToken,
      providerMessageId: null,
      attemptCount: { increment: 1 },
      errorCode: null,
      errorMessage: null,
      failedAt: null,
      updatedAt: now,
    },
  });
  if (claimed.count !== 1) {
    if (remainingAttempts <= 0) throw new Error('Could not claim WhatsApp delivery.');
    return reserveWithPrisma(model, input, remainingAttempts - 1);
  }
  const record = await model.findUnique({ where: { id: existing.id } });
  return { outcome: 'claimed', record: normalizeRecord(record), claimToken };
}

export async function reserveWhatsAppDelivery(input: {
  organizationId: string;
  taskId: string;
  assigneeUsername: string;
  senderUsername: string;
  templateName: string;
  language: WhatsAppTaskLanguage;
}): Promise<WhatsAppDeliveryClaim> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = whatsappDeliveryModel(prisma);
    if (!model) throw new Error('WhatsApp delivery storage is unavailable. Apply the committed database migration.');
    return reserveWithPrisma(model, input);
  }

  const rows = localRows();
  const existing = rows.find(row => (
    row.organizationId === input.organizationId && row.taskId === input.taskId
  ));
  if (existing && ACTIVE_OR_SUCCESS.has(existing.status)) return { outcome: 'replay', record: existing };
  if (existing && isRecentClaim(existing)) return { outcome: 'in_progress', record: existing };

  const now = new Date().toISOString();
  const claimToken = crypto.randomUUID();
  const record: WhatsAppDeliveryRecord = existing || {
    id: `wa_${crypto.randomUUID()}`,
    ...input,
    status: 'sending',
    claimToken,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  Object.assign(record, input, {
    status: 'sending',
    claimToken,
    providerMessageId: undefined,
    attemptCount: record.attemptCount + 1,
    errorCode: undefined,
    errorMessage: undefined,
    failedAt: undefined,
    updatedAt: now,
  });
  if (!existing) rows.unshift(record);
  persistLocal();
  return { outcome: 'claimed', record, claimToken };
}

export async function acceptWhatsAppDelivery(
  claimToken: string,
  providerMessageId: string,
): Promise<WhatsAppDeliveryRecord> {
  const prisma = await getPrismaClientForAdmin();
  const acceptedAt = new Date();
  if (prisma) {
    const model = whatsappDeliveryModel(prisma);
    if (!model) throw new Error('WhatsApp delivery storage is unavailable.');
    const result = await model.updateMany({
      where: { claimToken, status: 'sending' },
      data: {
        status: 'accepted',
        providerMessageId,
        acceptedAt,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (result.count !== 1) throw new Error('WhatsApp delivery claim is no longer active.');
    return normalizeRecord(await model.findUnique({ where: { providerMessageId } }));
  }

  const record = localRows().find(row => row.claimToken === claimToken && row.status === 'sending');
  if (!record) throw new Error('WhatsApp delivery claim is no longer active.');
  Object.assign(record, {
    status: 'accepted',
    providerMessageId,
    acceptedAt: acceptedAt.toISOString(),
    updatedAt: acceptedAt.toISOString(),
    errorCode: undefined,
    errorMessage: undefined,
  });
  persistLocal();
  return record;
}

export async function failWhatsAppDelivery(
  claimToken: string,
  errorCode: string,
  errorMessage: string,
): Promise<WhatsAppDeliveryRecord | null> {
  const prisma = await getPrismaClientForAdmin();
  const failedAt = new Date();
  if (prisma) {
    const model = whatsappDeliveryModel(prisma);
    if (!model) throw new Error('WhatsApp delivery storage is unavailable.');
    await model.updateMany({
      where: { claimToken, status: 'sending' },
      data: {
        status: 'failed',
        errorCode: errorCode.slice(0, 80),
        errorMessage: errorMessage.slice(0, 300),
        failedAt,
      },
    });
    const record = await model.findFirst({ where: { claimToken } });
    return record ? normalizeRecord(record) : null;
  }

  const record = localRows().find(row => row.claimToken === claimToken);
  if (!record || record.status !== 'sending') return record || null;
  Object.assign(record, {
    status: 'failed',
    errorCode: errorCode.slice(0, 80),
    errorMessage: errorMessage.slice(0, 300),
    failedAt: failedAt.toISOString(),
    updatedAt: failedAt.toISOString(),
  });
  persistLocal();
  return record;
}

function shouldApplyWebhook(
  record: WhatsAppDeliveryRecord,
  event: WhatsAppWebhookStatusEvent,
): boolean {
  const eventAt = new Date(event.occurredAt).getTime();
  const lastAt = record.lastWebhookAt ? new Date(record.lastWebhookAt).getTime() : 0;
  if (eventAt < lastAt) return false;
  if (record.status === 'read') return false;
  if (event.status === 'failed' && ['delivered', 'read'].includes(record.status)) return false;
  if (record.status !== 'failed' && event.status !== 'failed'
    && STATUS_RANK[event.status] < STATUS_RANK[record.status]) return false;
  return true;
}

function webhookPatch(event: WhatsAppWebhookStatusEvent): Record<string, unknown> {
  const occurredAt = new Date(event.occurredAt);
  const patch: Record<string, unknown> = {
    status: event.status,
    lastWebhookAt: occurredAt,
    ...(event.status === 'failed'
      ? {
        failedAt: occurredAt,
        errorCode: event.errorCode || 'provider_delivery_failed',
        errorMessage: event.errorMessage || 'WhatsApp delivery failed.',
      }
      : { errorCode: null, errorMessage: null }),
  };
  if (event.status === 'sent') patch.sentAt = occurredAt;
  if (event.status === 'delivered') patch.deliveredAt = occurredAt;
  if (event.status === 'read') patch.readAt = occurredAt;
  return patch;
}

export async function applyWhatsAppWebhookStatus(
  event: WhatsAppWebhookStatusEvent,
): Promise<WhatsAppDeliveryRecord | null> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = whatsappDeliveryModel(prisma);
    if (!model) throw new Error('WhatsApp delivery storage is unavailable.');
    const currentValue = await model.findUnique({
      where: { providerMessageId: event.providerMessageId },
    });
    if (!currentValue) return null;
    const current = normalizeRecord(currentValue);
    if (!shouldApplyWebhook(current, event)) return current;
    return normalizeRecord(await model.update({
      where: { id: current.id },
      data: webhookPatch(event),
    }));
  }

  const record = localRows().find(row => row.providerMessageId === event.providerMessageId);
  if (!record || !shouldApplyWebhook(record, event)) return record || null;
  const patch = webhookPatch(event);
  Object.assign(record, {
    ...patch,
    lastWebhookAt: iso(patch.lastWebhookAt),
    sentAt: iso(patch.sentAt) || record.sentAt,
    deliveredAt: iso(patch.deliveredAt) || record.deliveredAt,
    readAt: iso(patch.readAt) || record.readAt,
    failedAt: iso(patch.failedAt) || record.failedAt,
    updatedAt: new Date().toISOString(),
    errorCode: patch.errorCode || undefined,
    errorMessage: patch.errorMessage || undefined,
  });
  persistLocal();
  return record;
}

export async function listWhatsAppDeliveryStatuses(
  organizationId: string,
  taskIds: string[],
): Promise<WhatsAppDeliveryStatusProjection[]> {
  const uniqueTaskIds = [...new Set(taskIds)].slice(0, 100);
  const prisma = await getPrismaClientForAdmin();
  let records: WhatsAppDeliveryRecord[];
  if (prisma) {
    const model = whatsappDeliveryModel(prisma);
    if (!model) throw new Error('WhatsApp delivery storage is unavailable.');
    const rows = await model.findMany({
      where: { organizationId, taskId: { in: uniqueTaskIds } },
      orderBy: { updatedAt: 'desc' },
    });
    records = rows.map(normalizeRecord);
  } else {
    const allowed = new Set(uniqueTaskIds);
    records = localRows().filter(row => row.organizationId === organizationId && allowed.has(row.taskId));
  }
  return records.map(record => ({
    taskId: record.taskId,
    status: record.status,
    ...(record.providerMessageId ? { messageId: record.providerMessageId } : {}),
    language: record.language,
    updatedAt: record.updatedAt,
    ...(record.errorMessage ? { error: record.errorMessage } : {}),
  }));
}

export function projectWhatsAppDelivery(record: WhatsAppDeliveryRecord): WhatsAppDeliveryStatusProjection {
  return {
    taskId: record.taskId,
    status: record.status,
    ...(record.providerMessageId ? { messageId: record.providerMessageId } : {}),
    language: record.language,
    updatedAt: record.updatedAt,
    ...(record.errorMessage ? { error: record.errorMessage } : {}),
  };
}
