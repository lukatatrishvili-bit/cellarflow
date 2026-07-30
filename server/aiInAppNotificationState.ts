import type { AiFindingRecord } from '../lib/ai';
import { getPrismaClientForAdmin } from './db';

export interface AiNotificationReadState {
  organizationId: string;
  username: string;
  findingId: string;
  eventKey: string;
  readAt: string;
}

const localReadStates = new Map<string, AiNotificationReadState>();

function readStateKey(organizationId: string, username: string, findingId: string): string {
  return `${organizationId}:${username}:${findingId}`;
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function normalizeReadState(value: any): AiNotificationReadState {
  return {
    organizationId: String(value.organizationId),
    username: String(value.username),
    findingId: String(value.findingId),
    eventKey: String(value.eventKey),
    readAt: iso(value.readAt),
  };
}

/**
 * Stable across polling. A severity escalation or lifecycle transition creates
 * a new event; a routine re-evaluation of the same open condition does not.
 */
export function aiNotificationEventKey(finding: AiFindingRecord): string {
  const reopenedAt = finding.status === 'new' && finding.statusChangedBy === 'system'
    ? finding.statusChangedAt || ''
    : '';
  const modelRevision = finding.source === 'model' ? finding.lastModified || '' : '';
  return [
    finding.id,
    finding.severity,
    reopenedAt,
    modelRevision,
  ].join(':');
}

export async function getAiNotificationReadStates(
  organizationId: string,
  username: string,
  findingIds: string[],
): Promise<Map<string, AiNotificationReadState>> {
  if (findingIds.length === 0) return new Map();
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiNotificationReadState;
    if (!model) {
      throw new Error('AI in-app notification state is unavailable. Apply the committed database migration.');
    }
    const rows = await model.findMany({
      where: {
        organizationId,
        username,
        findingId: { in: findingIds },
      },
    });
    return new Map(
      rows.map((row: any) => {
        const normalized = normalizeReadState(row);
        return [normalized.findingId, normalized];
      }),
    );
  }

  const states = new Map<string, AiNotificationReadState>();
  for (const findingId of findingIds) {
    const state = localReadStates.get(readStateKey(organizationId, username, findingId));
    if (state) states.set(findingId, state);
  }
  return states;
}

export async function markAiNotificationsRead(input: {
  organizationId: string;
  username: string;
  notifications: Array<{ findingId: string; eventKey: string }>;
  now?: Date;
}): Promise<AiNotificationReadState[]> {
  if (input.notifications.length === 0) return [];
  const now = input.now || new Date();
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiNotificationReadState;
    if (!model) {
      throw new Error('AI in-app notification state is unavailable. Apply the committed database migration.');
    }
    const operations = input.notifications.map((notification) => model.upsert({
      where: {
        organizationId_username_findingId: {
          organizationId: input.organizationId,
          username: input.username,
          findingId: notification.findingId,
        },
      },
      create: {
        organizationId: input.organizationId,
        username: input.username,
        findingId: notification.findingId,
        eventKey: notification.eventKey,
        readAt: now,
      },
      update: {
        eventKey: notification.eventKey,
        readAt: now,
      },
    }));
    const rows = typeof (prisma as any).$transaction === 'function'
      ? await (prisma as any).$transaction(operations)
      : await Promise.all(operations);
    return rows.map(normalizeReadState);
  }

  const readAt = now.toISOString();
  return input.notifications.map((notification) => {
    const state: AiNotificationReadState = {
      organizationId: input.organizationId,
      username: input.username,
      findingId: notification.findingId,
      eventKey: notification.eventKey,
      readAt,
    };
    localReadStates.set(
      readStateKey(input.organizationId, input.username, notification.findingId),
      state,
    );
    return state;
  });
}

export function __resetInMemoryAiNotificationReadStates(): void {
  localReadStates.clear();
}
