import { getDB } from './db';
import {
  summarizeAiFindingFeedback,
  type AiFeedbackQualitySummary,
  type AiFindingRecord,
} from '../lib/ai';
import {
  getAiMonitoringOperations,
  type AiMonitoringOperationsSnapshot,
} from './aiMonitoringStore';
import {
  getAiNotificationOutboxOperations,
  type AiNotificationOperationsSnapshot,
} from './aiNotificationOutbox';
import {
  getAiModelCallOperations,
  type AiModelCallOperationsSnapshot,
} from './aiModelTelemetry';
import { aiWebPushConfigured } from './aiPushSubscriptions';
import { aiWhatsAppConfigured } from './aiNotificationWhatsApp';

export type AiOperationsHealth = 'healthy' | 'attention' | 'critical';

export interface AiOperationsSnapshot {
  checkedAt: string;
  health: AiOperationsHealth;
  emailTransportConfigured: boolean;
  pushTransportConfigured: boolean;
  whatsappTransportConfigured: boolean;
  organizations: Record<string, string>;
  monitoring: AiMonitoringOperationsSnapshot;
  notifications: AiNotificationOperationsSnapshot;
  modelCalls: AiModelCallOperationsSnapshot;
  /** Aggregate verdicts only; never reviewer identities or comments. */
  quality: AiFeedbackQualitySummary;
}

const DELIVERY_BACKLOG_ATTENTION_MS = 15 * 60 * 1_000;

export async function getAiOperationsSnapshot(
  limit = 25,
  now: Date = new Date(),
): Promise<AiOperationsSnapshot> {
  const [monitoring, notifications, modelCalls] = await Promise.all([
    getAiMonitoringOperations(limit, now),
    getAiNotificationOutboxOperations(limit, now),
    getAiModelCallOperations(limit, now),
  ]);
  const oldestPendingAge = notifications.oldestPendingAt
    ? now.getTime() - new Date(notifications.oldestPendingAt).getTime()
    : 0;
  const health: AiOperationsHealth = (
    monitoring.staleRunning > 0
    || notifications.staleProcessing > 0
    || modelCalls.staleRunning > 0
  )
    ? 'critical'
    : (
      monitoring.counts.failed > 0
      || notifications.counts.failed > 0
      || modelCalls.today.failed > 0
      || modelCalls.today.invalidResponse > 0
      || oldestPendingAge > DELIVERY_BACKLOG_ATTENTION_MS
    )
      ? 'attention'
      : 'healthy';
  const referencedOrganizationIds = new Set([
    ...monitoring.recentRuns.map((run) => run.organizationId),
    ...notifications.recent.map((row) => row.organizationId),
    ...notifications.recentFailures.map((row) => row.organizationId),
    ...modelCalls.recentFailures.map((row) => row.organizationId),
  ]);
  const organizations = Object.fromEntries(
    (getDB().organizations || [])
      .filter((organization) => referencedOrganizationIds.has(String(organization.id)))
      .map((organization) => [String(organization.id), String(organization.name)]),
  );
  const quality = summarizeAiFindingFeedback(
    Object.values(getDB().orgData || {}).flatMap((data) => {
      const findings = (data as unknown as Record<string, unknown>).aiFindings;
      return Array.isArray(findings) ? findings as AiFindingRecord[] : [];
    }),
  );

  return {
    checkedAt: now.toISOString(),
    health,
    emailTransportConfigured: Boolean(process.env.SMTP_HOST?.trim()),
    pushTransportConfigured: aiWebPushConfigured(),
    whatsappTransportConfigured: aiWhatsAppConfigured(),
    organizations,
    monitoring,
    notifications,
    modelCalls,
    quality,
  };
}
