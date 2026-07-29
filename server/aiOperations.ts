import { getDB } from './db';
import {
  getAiMonitoringOperations,
  type AiMonitoringOperationsSnapshot,
} from './aiMonitoringStore';
import {
  getAiNotificationOutboxOperations,
  type AiNotificationOperationsSnapshot,
} from './aiNotificationOutbox';

export type AiOperationsHealth = 'healthy' | 'attention' | 'critical';

export interface AiOperationsSnapshot {
  checkedAt: string;
  health: AiOperationsHealth;
  emailTransportConfigured: boolean;
  organizations: Record<string, string>;
  monitoring: AiMonitoringOperationsSnapshot;
  notifications: AiNotificationOperationsSnapshot;
}

const DELIVERY_BACKLOG_ATTENTION_MS = 15 * 60 * 1_000;

export async function getAiOperationsSnapshot(
  limit = 25,
  now: Date = new Date(),
): Promise<AiOperationsSnapshot> {
  const [monitoring, notifications] = await Promise.all([
    getAiMonitoringOperations(limit, now),
    getAiNotificationOutboxOperations(limit, now),
  ]);
  const oldestPendingAge = notifications.oldestPendingAt
    ? now.getTime() - new Date(notifications.oldestPendingAt).getTime()
    : 0;
  const health: AiOperationsHealth = (
    monitoring.staleRunning > 0 || notifications.staleProcessing > 0
  )
    ? 'critical'
    : (
      monitoring.counts.failed > 0
      || notifications.counts.failed > 0
      || oldestPendingAge > DELIVERY_BACKLOG_ATTENTION_MS
    )
      ? 'attention'
      : 'healthy';
  const referencedOrganizationIds = new Set([
    ...monitoring.recentRuns.map((run) => run.organizationId),
    ...notifications.recent.map((row) => row.organizationId),
    ...notifications.recentFailures.map((row) => row.organizationId),
  ]);
  const organizations = Object.fromEntries(
    (getDB().organizations || [])
      .filter((organization) => referencedOrganizationIds.has(String(organization.id)))
      .map((organization) => [String(organization.id), String(organization.name)]),
  );

  return {
    checkedAt: now.toISOString(),
    health,
    emailTransportConfigured: Boolean(process.env.SMTP_HOST?.trim()),
    organizations,
    monitoring,
    notifications,
  };
}
