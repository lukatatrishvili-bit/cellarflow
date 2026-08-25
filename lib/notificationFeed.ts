import type { Alert, AlertCategory, AlertSeverity } from './alerts';
import type {
  AiEntityRef,
  AiEntityType,
  AiFindingSource,
  AiFindingStatus,
  AiMonitoringArea,
  AiSeverity,
} from './ai/types';

export type NotificationCategory = AlertCategory | 'intelligence';
export type NotificationSource = 'operational' | 'ai';

/** The language-specific finding projection returned by /api/ai/notifications. */
export interface AiNotificationFinding {
  id: string;
  createdAt: string;
  source: AiFindingSource;
  area: AiMonitoringArea;
  findingType: string;
  severity: AiSeverity;
  entityType: AiEntityType;
  entityId: string;
  entityLabel: string;
  relatedEntities?: AiEntityRef[];
  title: string;
  observation: string;
  status?: AiFindingStatus;
  occurrences?: number;
  lastSeenAt?: string;
  notificationEventKey?: string;
  unread?: boolean;
  readAt?: string;
}

export interface NotificationItem {
  id: string;
  source: NotificationSource;
  severity: AlertSeverity;
  category: NotificationCategory;
  title: string;
  message: string;
  relatedEntityType?: AiEntityType;
  relatedEntityId?: string;
  relatedLotId?: string;
  relatedTankId?: string;
  findingId?: string;
  findingType?: string;
  aiSeverity?: AiSeverity;
  aiSource?: AiFindingSource;
  area?: AiMonitoringArea;
  status?: AiFindingStatus;
  occurrences?: number;
  lastSeenAt?: string;
  notificationEventKey?: string;
  unread: boolean;
  readAt?: string;
}

const ALERT_SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function categoryForFinding(finding: AiNotificationFinding): NotificationCategory {
  const type = finding.findingType.toLowerCase();
  if (type.includes('so2')) return 'so2';
  if (type.includes('volatile_acidity') || type.startsWith('va_')) return 'va';
  if (type.includes('temperature')) return 'temperature';
  if (type.startsWith('inventory_') || type.includes('stock_')) return 'inventory';
  if (type === 'work_overdue' || type.includes('task_overdue')) return 'task';
  if (type.includes('fermentation') || type === 'cross_module_nutrient_risk') return 'fermentation';
  return 'intelligence';
}

function alertSeverityFor(severity: AiSeverity): AlertSeverity {
  if (severity === 'critical' || severity === 'warning') return severity;
  return 'info';
}

function relatedId(finding: AiNotificationFinding, entityType: AiEntityType): string | undefined {
  if (finding.entityType === entityType) return finding.entityId;
  return finding.relatedEntities?.find((entity) => entity.type === entityType)?.id;
}

function operationalItem(alert: Alert): NotificationItem {
  return {
    ...alert,
    source: 'operational',
    unread: true,
  };
}

function aiItem(finding: AiNotificationFinding): NotificationItem {
  return {
    id: `ai-${finding.id}`,
    source: 'ai',
    severity: alertSeverityFor(finding.severity),
    category: categoryForFinding(finding),
    title: finding.title,
    message: finding.observation,
    relatedEntityType: finding.entityType,
    relatedEntityId: finding.entityId,
    relatedLotId: relatedId(finding, 'lot'),
    relatedTankId: relatedId(finding, 'vessel'),
    findingId: finding.id,
    findingType: finding.findingType,
    aiSeverity: finding.severity,
    aiSource: finding.source,
    area: finding.area,
    status: finding.status,
    occurrences: finding.occurrences,
    lastSeenAt: finding.lastSeenAt || finding.createdAt,
    notificationEventKey: finding.notificationEventKey,
    unread: finding.unread !== false,
    readAt: finding.readAt,
  };
}

function dedupeIdentity(item: NotificationItem): string | null {
  let entityId: string | undefined;
  if (item.category === 'so2' || item.category === 'va' || item.category === 'lab' || item.category === 'fermentation') {
    entityId = item.relatedLotId;
  } else if (item.category === 'temperature' || item.category === 'cleaning') {
    entityId = item.relatedTankId;
  } else {
    entityId = item.relatedEntityId;
  }
  return entityId ? `${item.category}:${entityId}` : null;
}

/**
 * Builds the bell feed. AI items are appended first so a routed, explainable
 * finding replaces a legacy alert that describes the same category and entity.
 */
export function buildNotificationFeed(
  alerts: Alert[],
  aiFindings: AiNotificationFinding[],
): NotificationItem[] {
  const aiItems = aiFindings.map(aiItem);
  const aiIdentities = new Set(
    aiItems
      .map(dedupeIdentity)
      .filter((identity): identity is string => Boolean(identity)),
  );
  const operationalItems = alerts
    .map(operationalItem)
    .filter((item) => {
      const identity = dedupeIdentity(item);
      return !identity || !aiIdentities.has(identity);
    });
  const deduped = [...aiItems, ...operationalItems];

  return deduped.sort((a, b) => {
    const bySeverity = ALERT_SEVERITY_RANK[a.severity] - ALERT_SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.source !== b.source) return a.source === 'ai' ? -1 : 1;
    return (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '');
  });
}
