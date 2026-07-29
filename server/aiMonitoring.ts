import {
  getDB,
  OrganizationStateVersionConflictError,
  reloadOrganizationDataFromPostgres,
  saveOrganizationData,
  type UserDataState,
} from './db';
import {
  buildDailyBriefing,
  evaluateRules,
  mergeFindings,
  renderBriefingText,
  wineryStatus,
  type AiFindingRecord,
  type WineryIntelligenceSnapshotInput,
} from '../lib/ai';
import type { Language } from '../lib/i18n';
import {
  completeAiMonitoringRun,
  failAiMonitoringRun,
  monitoringWindowStart,
  reserveAiMonitoringRun,
  type AiMonitoringCadence,
} from './aiMonitoringStore';
import {
  aiFindingNotificationEventKey,
  enqueueAiFindingNotifications,
} from './aiNotificationOutbox';

/**
 * Scheduled monitoring. The intelligence layer must not depend on a user
 * opening a page: the hourly and daily passes run the deterministic detectors
 * for every winery and persist what changed.
 *
 * Only rules run here — no model calls. A scheduled job that could spend tokens
 * per winery per hour is a cost incident waiting to happen; model analysis stays
 * on the explicit, budgeted `/api/ai/analyze` path.
 */

export type MonitoringCadence = AiMonitoringCadence;

export interface OrganizationMonitoringResult {
  organizationId: string;
  evaluated: number;
  created: number;
  escalated: number;
  autoResolved: number;
  outboxQueued: number;
  status: 'normal' | 'attention' | 'critical';
  /** Rendered briefing text, produced only on the daily pass. */
  briefing?: string;
}

export interface MonitoringRunResult {
  cadence: MonitoringCadence;
  ranAt: string;
  organizations: OrganizationMonitoringResult[];
  skipped: number;
  /** Organizations already completed or actively claimed for this cadence window. */
  deduplicated: number;
}

function snapshotInput(
  data: UserDataState,
  lang: Language,
  evaluatedAt: string,
): WineryIntelligenceSnapshotInput {
  const raw = data as unknown as Record<string, any>;
  return {
    today: evaluatedAt.slice(0, 10),
    evaluatedAt,
    lang,
    config: raw.companyProfile?.aiConfig,
    vessels: raw.vessels,
    lots: raw.lots,
    fermLogs: raw.fermlogs,
    labLogs: raw.lablogs,
    inventory: raw.inventory,
    tasks: raw.tasks,
    cellarOps: raw.cellarOps,
    transfers: raw.transfers,
    bottlingRuns: raw.bottlingRuns,
    grapeIntakes: raw.grapeIntakes,
    blocks: raw.blocks,
    scoutings: raw.scoutings,
    sprays: raw.sprays,
    samplings: raw.samplings,
    harvests: raw.harvests,
    certifications: raw.certificationRecords,
    salesOrders: raw.salesOrders,
    companyProfile: raw.companyProfile,
  };
}

/**
 * Areas each cadence is responsible for. The hourly pass stays narrow — an
 * hourly compliance sweep would produce the same finding 24 times a day for a
 * document that will be filed next week.
 */
const CADENCE_AREAS: Record<MonitoringCadence, Set<string>> = {
  hourly: new Set(['fermentation']),
  daily: new Set(['fermentation', 'laboratory', 'inventory', 'vineyard', 'operations', 'compliance']),
  weekly: new Set(['fermentation', 'laboratory', 'inventory', 'vineyard', 'operations', 'compliance']),
};

/**
 * Runs one monitoring pass across every winery in the database.
 * Pure with respect to the model; the only side effect is persisted findings.
 */
export async function runMonitoringPass(cadence: MonitoringCadence = 'daily'): Promise<MonitoringRunResult> {
  const db = getDB();
  const ranAt = new Date().toISOString();
  const windowStart = monitoringWindowStart(cadence, new Date(ranAt));
  const notificationRunKey = `${cadence}:${windowStart}`;
  const organizations: OrganizationMonitoringResult[] = [];
  let skipped = 0;
  let deduplicated = 0;

  const areas = CADENCE_AREAS[cadence];

  for (const organizationId of Object.keys(db.orgData || {})) {
    const claim = await reserveAiMonitoringRun({ organizationId, cadence, windowStart });
    if (claim.outcome !== 'claimed') {
      deduplicated += 1;
      continue;
    }

    try {
      let completed = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
        const data = refreshed?.data || getDB().orgData?.[organizationId];
        if (!data) {
          skipped += 1;
          const didComplete = await completeAiMonitoringRun(claim.record.id, claim.claimToken, {
            evaluated: 0,
            created: 0,
            escalated: 0,
            autoResolved: 0,
            outboxQueued: 0,
            wineryStatus: 'normal',
          });
          if (!didComplete) throw new Error(`AI monitoring lease was lost for organization ${organizationId}.`);
          completed = true;
          break;
        }
        const raw = data as unknown as Record<string, any>;
        const lang: Language = raw.companyProfile?.country === 'Georgia' ? 'ka' : 'en';
        const { snapshot, findings } = evaluateRules(snapshotInput(data, lang, windowStart));
        if (!snapshot.config.monitoringEnabled) {
          skipped += 1;
          const didComplete = await completeAiMonitoringRun(claim.record.id, claim.claimToken, {
            evaluated: 0,
            created: 0,
            escalated: 0,
            autoResolved: 0,
            outboxQueued: 0,
            wineryStatus: 'normal',
          });
          if (!didComplete) throw new Error(`AI monitoring lease was lost for organization ${organizationId}.`);
          completed = true;
          break;
        }

        const scoped = findings.filter((finding) => areas.has(finding.area));
        const existing: AiFindingRecord[] = Array.isArray(raw.aiFindings) ? raw.aiFindings : [];

        // A narrow cadence must not auto-resolve findings it never looked for, so
        // records outside this pass's areas are carried through untouched.
        const inScope = existing.filter((record) => areas.has(record.area));
        const outOfScope = existing.filter((record) => !areas.has(record.area));
        const merge = mergeFindings(inScope, scoped, { config: snapshot.config, now: windowStart });
        for (const record of merge.notify) {
          record.lastNotificationEventKey = aiFindingNotificationEventKey(record);
          record.lastNotificationAt = windowStart;
          record.lastNotificationRunKey = notificationRunKey;
        }
        const currentNotifications = merge.records.filter(
          (record) => (
            record.lastNotificationRunKey === notificationRunKey
            && record.lastNotificationEventKey
          ),
        );
        const created = merge.records.filter(
          (record) => record.createdAt === windowStart && record.lastSeenAt === windowStart,
        ).length;
        const notifiedCreated = currentNotifications.filter(
          (record) => record.createdAt === windowStart,
        ).length;
        const autoResolved = merge.records.filter((record) => (
          record.status === 'resolved'
          && record.statusChangedBy === 'system'
          && record.statusChangedAt === windowStart
        )).length;
        raw.aiFindings = [...outOfScope, ...merge.records];

        try {
          await saveOrganizationData(organizationId, data, {
            expectedVersion: refreshed?.meta.version ?? null,
            updatedBy: `ai-monitor:${cadence}`,
          });
        } catch (error) {
          if (error instanceof OrganizationStateVersionConflictError && attempt < 3) {
            continue;
          }
          throw error;
        }

        const outboxQueued = await enqueueAiFindingNotifications(
          organizationId,
          currentNotifications,
          new Date(ranAt),
        );
        const result: OrganizationMonitoringResult = {
          organizationId,
          evaluated: scoped.length,
          created,
          escalated: Math.max(0, currentNotifications.length - notifiedCreated),
          autoResolved,
          outboxQueued,
          status: wineryStatus(raw.aiFindings as AiFindingRecord[]),
        };

        if (cadence === 'daily' && snapshot.config.dailyBriefingEnabled) {
          const briefing = buildDailyBriefing(raw.aiFindings as AiFindingRecord[], {
            minimumSeverity: snapshot.config.minimumSeverity,
          });
          result.briefing = renderBriefingText(briefing, lang);
        }

        const didComplete = await completeAiMonitoringRun(claim.record.id, claim.claimToken, {
          evaluated: result.evaluated,
          created: result.created,
          escalated: result.escalated,
          autoResolved: result.autoResolved,
          outboxQueued: result.outboxQueued,
          wineryStatus: result.status,
          briefing: result.briefing,
        });
        if (!didComplete) throw new Error(`AI monitoring lease was lost for organization ${organizationId}.`);
        organizations.push(result);
        completed = true;
        break;
      }
      if (!completed) {
        throw new Error(`AI monitoring could not persist organization ${organizationId} after 3 attempts.`);
      }
    } catch (error) {
      await failAiMonitoringRun(claim.record.id, claim.claimToken, error);
      throw error;
    }
  }

  return { cadence, ranAt, organizations, skipped, deduplicated };
}
