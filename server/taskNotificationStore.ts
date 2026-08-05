import crypto from 'crypto';
import { getPrismaClientForAdmin } from './db';

export type TaskNotificationChannel = 'email' | 'push';
export type TaskNotificationStatus = 'sending' | 'sent' | 'failed';

export interface TaskNotificationDeliveryRecord {
  id: string;
  organizationId: string;
  taskId: string;
  assigneeUsername: string;
  senderUsername: string;
  channel: TaskNotificationChannel;
  status: TaskNotificationStatus;
  claimToken: string;
  attemptCount: number;
  errorMessage?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

const LEASE_MS = 5 * 60 * 1_000;
const localDeliveries = new Map<string, TaskNotificationDeliveryRecord>();

function key(organizationId: string, taskId: string, channel: TaskNotificationChannel): string {
  return `${organizationId}:${taskId}:${channel}`;
}

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalize(value: any): TaskNotificationDeliveryRecord {
  return {
    id: String(value.id),
    organizationId: String(value.organizationId),
    taskId: String(value.taskId),
    assigneeUsername: String(value.assigneeUsername),
    senderUsername: String(value.senderUsername),
    channel: value.channel === 'push' ? 'push' : 'email',
    status: ['sending', 'sent', 'failed'].includes(value.status) ? value.status : 'failed',
    claimToken: String(value.claimToken || ''),
    attemptCount: Math.max(1, Number(value.attemptCount) || 1),
    ...(typeof value.errorMessage === 'string' && value.errorMessage
      ? { errorMessage: value.errorMessage }
      : {}),
    ...(iso(value.sentAt) ? { sentAt: iso(value.sentAt) } : {}),
    createdAt: iso(value.createdAt) || new Date().toISOString(),
    updatedAt: iso(value.updatedAt) || new Date().toISOString(),
  };
}

export type ReserveTaskNotificationResult =
  | { outcome: 'claimed'; record: TaskNotificationDeliveryRecord }
  | { outcome: 'replay' | 'busy'; record: TaskNotificationDeliveryRecord };

export async function reserveTaskNotificationDelivery(input: {
  organizationId: string;
  taskId: string;
  assigneeUsername: string;
  senderUsername: string;
  channel: TaskNotificationChannel;
  now?: Date;
}): Promise<ReserveTaskNotificationResult> {
  const now = input.now || new Date();
  const prisma = await getPrismaClientForAdmin();
  const claimToken = crypto.randomUUID();
  if (prisma) {
    const model = (prisma as any).taskNotificationDelivery;
    if (!model) {
      throw new Error('Task notification delivery storage is unavailable. Apply the committed database migration.');
    }
    const where = {
      organizationId_taskId_channel: {
        organizationId: input.organizationId,
        taskId: input.taskId,
        channel: input.channel,
      },
    };
    const existing = await model.findUnique({ where });
    if (existing?.status === 'sent') return { outcome: 'replay', record: normalize(existing) };
    if (existing?.status === 'sending'
      && now.getTime() - new Date(existing.updatedAt).getTime() < LEASE_MS) {
      return { outcome: 'busy', record: normalize(existing) };
    }
    if (existing) {
      const claimed = await model.update({
        where,
        data: {
          assigneeUsername: input.assigneeUsername,
          senderUsername: input.senderUsername,
          status: 'sending',
          claimToken,
          attemptCount: { increment: 1 },
          errorMessage: null,
          updatedAt: now,
        },
      });
      return { outcome: 'claimed', record: normalize(claimed) };
    }
    try {
      const created = await model.create({
        data: {
          organizationId: input.organizationId,
          taskId: input.taskId,
          assigneeUsername: input.assigneeUsername,
          senderUsername: input.senderUsername,
          channel: input.channel,
          status: 'sending',
          claimToken,
          attemptCount: 1,
          createdAt: now,
          updatedAt: now,
        },
      });
      return { outcome: 'claimed', record: normalize(created) };
    } catch (error: any) {
      if (error?.code === 'P2002') return reserveTaskNotificationDelivery(input);
      throw error;
    }
  }

  const storageKey = key(input.organizationId, input.taskId, input.channel);
  const existing = localDeliveries.get(storageKey);
  if (existing?.status === 'sent') return { outcome: 'replay', record: { ...existing } };
  if (existing?.status === 'sending'
    && now.getTime() - new Date(existing.updatedAt).getTime() < LEASE_MS) {
    return { outcome: 'busy', record: { ...existing } };
  }
  const timestamp = now.toISOString();
  const record: TaskNotificationDeliveryRecord = {
    id: existing?.id || `tasknotify_${crypto.randomUUID()}`,
    organizationId: input.organizationId,
    taskId: input.taskId,
    assigneeUsername: input.assigneeUsername,
    senderUsername: input.senderUsername,
    channel: input.channel,
    status: 'sending',
    claimToken,
    attemptCount: (existing?.attemptCount || 0) + 1,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  localDeliveries.set(storageKey, record);
  return { outcome: 'claimed', record: { ...record } };
}

export async function completeTaskNotificationDelivery(
  id: string,
  claimToken: string,
  now: Date = new Date(),
): Promise<TaskNotificationDeliveryRecord | null> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).taskNotificationDelivery;
    const result = await model.updateMany({
      where: { id, claimToken, status: 'sending' },
      data: { status: 'sent', sentAt: now, errorMessage: null, updatedAt: now },
    });
    if (result.count === 0) return null;
    return normalize(await model.findUnique({ where: { id } }));
  }
  const entry = [...localDeliveries.entries()].find(([, record]) => (
    record.id === id && record.claimToken === claimToken && record.status === 'sending'
  ));
  if (!entry) return null;
  const record = entry[1];
  Object.assign(record, {
    status: 'sent',
    sentAt: now.toISOString(),
    errorMessage: undefined,
    updatedAt: now.toISOString(),
  });
  return { ...record };
}

export async function failTaskNotificationDelivery(
  id: string,
  claimToken: string,
  error: unknown,
  now: Date = new Date(),
): Promise<TaskNotificationDeliveryRecord | null> {
  const message = (error instanceof Error ? error.message : 'Notification delivery failed.')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 300);
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).taskNotificationDelivery;
    const result = await model.updateMany({
      where: { id, claimToken, status: 'sending' },
      data: { status: 'failed', errorMessage: message, updatedAt: now },
    });
    if (result.count === 0) return null;
    return normalize(await model.findUnique({ where: { id } }));
  }
  const entry = [...localDeliveries.entries()].find(([, record]) => (
    record.id === id && record.claimToken === claimToken && record.status === 'sending'
  ));
  if (!entry) return null;
  const record = entry[1];
  Object.assign(record, { status: 'failed', errorMessage: message, updatedAt: now.toISOString() });
  return { ...record };
}

export function projectTaskNotificationDelivery(record: TaskNotificationDeliveryRecord) {
  return {
    channel: record.channel,
    status: record.status,
    attemptCount: record.attemptCount,
    updatedAt: record.updatedAt,
    ...(record.sentAt ? { sentAt: record.sentAt } : {}),
    ...(record.errorMessage ? { error: record.errorMessage } : {}),
  };
}

export function __resetInMemoryTaskNotificationDeliveries(): void {
  localDeliveries.clear();
}
