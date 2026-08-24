import { isAreaEnabled, meetsSeverityThreshold } from './config';
import {
  detectorKey,
  findingFeedbackEntries,
  mutedDetectors,
  type AiDetectorMute,
} from './feedback';
import { severityRank } from './types';
import { text } from './text';
import type {
  AiAgentKey,
  AiAnalysisTier,
  AiEvent,
  AiFinding,
  AiFindingRecord,
  AiSeverity,
  AiTriageResult,
  AiWineryConfig,
} from './types';
import type { AiContextScope } from './context';

/**
 * The orchestrator decides *whether* to think, *who* should think, and *how
 * expensively*. Nothing here calls a model; it only produces plans. That
 * separation is what makes cost control testable.
 */

/** Event types whose meaning genuinely requires interpretation, not a threshold. */
const INTERPRETABLE_EVENTS = new Set<AiEvent['eventType']>([
  'fermentation_slowed',
  'fermentation_stopped',
  'volatile_acidity_changed',
  'disease_risk_increased',
  'abnormal_production_loss',
  'grape_maturity_changed',
  'traceability_gap_detected',
]);

const AREA_AGENT: Record<AiEvent['area'], AiAgentKey> = {
  fermentation: 'winemaking',
  laboratory: 'laboratory',
  inventory: 'inventory',
  vineyard: 'vineyard',
  compliance: 'compliance',
  operations: 'management',
};

export function triageEvent(event: AiEvent, config: AiWineryConfig): AiTriageResult {
  if (!isAreaEnabled(event.area, config)) {
    return {
      decision: 'ignore',
      agents: [],
      tier: 'lightweight',
      reason: text('Monitoring is disabled for this area.', 'ამ სფეროსთვის მონიტორინგი გამორთულია.'),
    };
  }

  if (event.severityHint === 'critical') {
    return {
      decision: 'urgent',
      agents: [AREA_AGENT[event.area]],
      tier: 'standard',
      reason: text('The change itself carries a critical severity hint.', 'ცვლილება თავად შეიცავს კრიტიკულ სიმძიმის მინიშნებას.'),
    };
  }

  if (INTERPRETABLE_EVENTS.has(event.eventType) && config.modelAnalysisEnabled) {
    return {
      decision: 'analyze',
      agents: [AREA_AGENT[event.area]],
      tier: 'standard',
      reason: text(
        'This change needs interpretation against history rather than a threshold test.',
        'ეს ცვლილება ისტორიასთან შედარებით ინტერპრეტაციას საჭიროებს და არა ზღვრულ შემოწმებას.',
      ),
    };
  }

  return {
    decision: 'rule',
    agents: [],
    tier: 'lightweight',
    reason: text(
      'Deterministic rules already cover this change; no model call is needed.',
      'დეტერმინისტული წესები უკვე ფარავს ამ ცვლილებას; მოდელის გამოძახება საჭირო არ არის.',
    ),
  };
}

// ---------------------------------------------------------------------------
// Planning model analysis from rule output
// ---------------------------------------------------------------------------

/** Findings where a second, reasoning pass genuinely adds something. */
const WORTH_ANALYZING = new Set([
  'fermentation_stopped',
  'fermentation_slowdown',
  'volatile_acidity_high',
  'volatile_acidity_rising',
  'so2_protection_low',
  'cross_module_nutrient_risk',
  'abnormal_process_loss',
  'vineyard_risk_downyMildew',
  'vineyard_risk_powderyMildew',
  'vineyard_risk_botrytis',
]);

/** Situations that benefit from more than one specialist looking at them. */
const MULTI_AGENT: Record<string, AiAgentKey[]> = {
  fermentation_stopped: ['winemaking', 'laboratory', 'inventory'],
  cross_module_nutrient_risk: ['winemaking', 'inventory'],
  volatile_acidity_high: ['laboratory', 'winemaking'],
};

/**
 * The winery's own review verdicts, applied.
 *
 * A muted detector keeps producing findings — it stays in the activity log and
 * in the briefing, and a user can still review it. What it loses is the two
 * things that cost something: a notification, and a model call. A critical
 * finding is never muted, so calibration can reduce noise but cannot silence
 * the alerts the layer exists for.
 */
function mutedDetectorsFor(
  config: AiWineryConfig,
  existing: readonly AiFindingRecord[],
): Map<string, AiDetectorMute> {
  if (!config.feedbackCalibrationEnabled) return new Map();
  return mutedDetectors(existing);
}

function isMuted(
  muted: ReadonlyMap<string, AiDetectorMute>,
  finding: Pick<AiFinding, 'findingType' | 'source' | 'area' | 'severity'>,
): boolean {
  if (muted.size === 0 || finding.severity === 'critical') return false;
  return muted.has(detectorKey(finding));
}

export interface AnalysisPlanItem {
  finding: AiFinding;
  scope: AiContextScope;
  agents: AiAgentKey[];
  tier: AiAnalysisTier;
}

export interface AnalysisPlan {
  items: AnalysisPlanItem[];
  /** Exact number of specialist calls represented by `items`. */
  plannedModelCalls: number;
  /** Findings that were eligible but dropped by the per-run budget. */
  deferred: number;
  /** Findings skipped because this winery's reviewers muted their detector. */
  muted: number;
  reason: 'ok' | 'model_disabled' | 'budget_exhausted' | 'nothing_eligible';
}

export interface PlanOptions {
  config: AiWineryConfig;
  /** Model calls already spent by this winery today. */
  callsUsedToday?: number;
  /** Hard cap on analyses planned in a single pass. */
  maxPerRun?: number;
  /** Existing records, used to respect per-finding cooldowns. */
  existing?: AiFindingRecord[];
  now?: string;
}

function cooldownActive(finding: AiFinding, existing: AiFindingRecord[], now: string): boolean {
  const triggerRecord = existing.find((row) => row.dedupeKey === finding.dedupeKey);
  // Dismissed and resolved findings stay quiet until the situation changes
  // enough to produce a different dedupe key.
  if (triggerRecord?.status === 'dismissed' || triggerRecord?.status === 'resolved') return true;
  if (triggerRecord?.lastAnalyzedAt) {
    const lastAttempt = Date.parse(triggerRecord.lastAnalyzedAt);
    if (Number.isFinite(lastAttempt)) {
      return (Date.parse(now) - lastAttempt) / 3_600_000 < finding.cooldownHours;
    }
  }

  // Rule evaluations update their own `lastSeenAt` on every pass. Using that as
  // the model cooldown would make scheduled monitoring prevent deep analysis
  // forever. Cool down only from an actual model interpretation of this trigger.
  const analyses = existing
    .filter((row) => row.source === 'model' && row.triggerDedupeKey === finding.dedupeKey)
    .sort((a, b) => (b.lastSeenAt || b.createdAt).localeCompare(a.lastSeenAt || a.createdAt));
  const record = analyses[0];
  if (!record) return false;
  if (record.status === 'dismissed' || record.status === 'resolved') return true;
  const last = Date.parse(record.lastSeenAt || record.createdAt);
  if (!Number.isFinite(last)) return false;
  const elapsedHours = (Date.parse(now) - last) / 3_600_000;
  return elapsedHours < finding.cooldownHours;
}

/**
 * Chooses which rule findings deserve a model pass, most severe first, capped
 * by both the per-run limit and the winery's daily budget.
 */
export function planAnalysis(findings: AiFinding[], options: PlanOptions): AnalysisPlan {
  const { config } = options;
  if (!config.modelAnalysisEnabled) {
    return { items: [], plannedModelCalls: 0, deferred: 0, muted: 0, reason: 'model_disabled' };
  }
  const now = options.now || new Date().toISOString();
  const existing = options.existing || [];
  const remainingBudget = Math.max(0, config.maxModelCallsPerDay - (options.callsUsedToday || 0));
  if (remainingBudget === 0) {
    return { items: [], plannedModelCalls: 0, deferred: 0, muted: 0, reason: 'budget_exhausted' };
  }

  // Buying an interpretation of a trigger this winery keeps marking wrong is
  // the least valuable call the layer can make; it is skipped before cooldown.
  const muted = mutedDetectorsFor(config, existing);
  const candidates = findings.filter((finding) => WORTH_ANALYZING.has(finding.findingType));
  const mutedCount = candidates.filter((finding) => isMuted(muted, finding)).length;

  const eligible = candidates
    .filter((finding) => !isMuted(muted, finding))
    .filter((finding) => severityRank(finding.severity) >= severityRank('warning'))
    .filter((finding) => !cooldownActive(finding, existing, now))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  if (eligible.length === 0) {
    return {
      items: [],
      plannedModelCalls: 0,
      deferred: 0,
      muted: mutedCount,
      reason: 'nothing_eligible',
    };
  }

  const itemLimit = Math.max(0, options.maxPerRun ?? 3);
  const chosen: AnalysisPlanItem[] = [];
  let plannedModelCalls = 0;
  for (const finding of eligible) {
    if (chosen.length >= itemLimit) break;
    const agents = MULTI_AGENT[finding.findingType] || [finding.agent];
    // A cross-discipline pass is useful only when every selected specialist can
    // run. Do not start a partial investigation at the end of the daily budget.
    if (plannedModelCalls + agents.length > remainingBudget) continue;
    chosen.push({
      finding,
      scope: { entityType: finding.entityType, entityId: finding.entityId },
      agents,
      tier: agents.length > 1 ? 'deep' : finding.severity === 'critical' ? 'standard' : 'lightweight',
    });
    plannedModelCalls += agents.length;
  }

  if (chosen.length === 0) {
    return {
      items: [],
      plannedModelCalls: 0,
      deferred: eligible.length,
      muted: mutedCount,
      reason: 'budget_exhausted',
    };
  }

  return {
    items: chosen,
    plannedModelCalls,
    deferred: eligible.length - chosen.length,
    muted: mutedCount,
    reason: 'ok',
  };
}

// ---------------------------------------------------------------------------
// Merging fresh findings into the persisted activity log
// ---------------------------------------------------------------------------

export interface MergeResult {
  records: AiFindingRecord[];
  /** Records that are new or newly escalated and pass the notification gate. */
  notify: AiFindingRecord[];
  /** Previously open records whose underlying situation is no longer detected. */
  autoResolved: AiFindingRecord[];
  /** Records that would have notified but for a muted detector. */
  mutedNotifications: AiFindingRecord[];
}

/**
 * Folds a fresh evaluation into the stored activity log. Re-detecting the same
 * situation increments its occurrence count instead of creating a duplicate,
 * and a user's status decision is never overwritten by a later evaluation.
 */
export function mergeFindings(
  existing: AiFindingRecord[],
  incoming: AiFinding[],
  options: { config: AiWineryConfig; now?: string },
): MergeResult {
  const now = options.now || new Date().toISOString();
  const incomingByKey = new Map(incoming.map((finding) => [finding.dedupeKey, finding]));
  const activeRuleKeys = new Set(
    incoming
      .filter((finding) => finding.source === 'rule' || finding.source === 'hybrid')
      .map((finding) => finding.dedupeKey),
  );
  const records: AiFindingRecord[] = [];
  const notify: AiFindingRecord[] = [];
  const autoResolved: AiFindingRecord[] = [];
  const mutedNotifications: AiFindingRecord[] = [];
  const muted = mutedDetectorsFor(options.config, existing);
  const routeNotification = (record: AiFindingRecord): void => {
    if (!meetsSeverityThreshold(record.severity, options.config)) return;
    if (isMuted(muted, record)) {
      mutedNotifications.push(record);
      return;
    }
    notify.push(record);
  };

  for (const record of existing) {
    const fresh = incomingByKey.get(record.dedupeKey);
    if (!fresh) {
      if (record.source === 'model') {
        // A rule-only pass cannot re-produce model prose. Keep the model finding
        // while its deterministic trigger remains active. Legacy model records
        // without trigger provenance are preserved for human review rather than
        // being silently resolved by an unrelated evaluation.
        if (!record.triggerDedupeKey || activeRuleKeys.has(record.triggerDedupeKey)) {
          records.push(record);
          continue;
        }
      }
      // Still detected? No. An open record whose situation cleared is resolved
      // automatically so the log reflects reality without user bookkeeping.
      if (record.status === 'new' || record.status === 'reviewed' || record.status === 'accepted') {
        const resolved: AiFindingRecord = {
          ...record,
          status: 'resolved',
          statusChangedAt: now,
          statusChangedBy: 'system',
          resolutionNote: 'No longer detected by monitoring.',
          lastModified: now,
        };
        records.push(resolved);
        autoResolved.push(resolved);
      } else {
        records.push(record);
      }
      continue;
    }

    incomingByKey.delete(record.dedupeKey);
    const escalated = severityRank(fresh.severity) > severityRank(record.severity);
    const recurredAfterClearing = record.status === 'resolved' && record.statusChangedBy === 'system';
    const shouldReopen = recurredAfterClearing || (escalated && record.status !== 'dismissed');
    const alreadySeenThisPass = record.lastSeenAt === now;
    const reviewerFeedback = findingFeedbackEntries(record);
    const merged: AiFindingRecord = {
      ...record,
      ...fresh,
      // The user's decision outranks re-detection, unless severity escalated.
      status: shouldReopen ? 'new' : record.status,
      statusChangedAt: shouldReopen ? now : record.statusChangedAt,
      statusChangedBy: shouldReopen ? 'system' : record.statusChangedBy,
      createdAt: record.createdAt,
      lastSeenAt: now,
      occurrences: record.occurrences + (alreadySeenThisPass ? 0 : 1),
      lastAnalyzedAt: shouldReopen ? undefined : record.lastAnalyzedAt,
      feedback: undefined,
      // Left absent rather than set to `[]` when there is no feedback. A newly
      // created record has no such key, so materialising an empty array on the
      // first re-detection would change the stored shape and force one pointless
      // durable write per finding, for every finding, forever.
      feedbackEntries: reviewerFeedback.length > 0 ? reviewerFeedback : undefined,
      linkedTaskId: record.linkedTaskId,
      resolutionNote: shouldReopen ? undefined : record.resolutionNote,
      lastModified: now,
    };
    records.push(merged);
    if (shouldReopen) routeNotification(merged);
  }

  for (const finding of incomingByKey.values()) {
    const record: AiFindingRecord = {
      ...finding,
      createdAt: now,
      status: 'new',
      lastSeenAt: now,
      occurrences: 1,
      lastModified: now,
    };
    records.push(record);
    routeNotification(record);
  }

  return { records, notify, autoResolved, mutedNotifications };
}

/** Overall winery posture, driven by the most severe open finding. */
export type WineryStatus = 'normal' | 'attention' | 'critical';

export function wineryStatus(records: AiFindingRecord[]): WineryStatus {
  const open = records.filter((record) => record.status === 'new' || record.status === 'reviewed' || record.status === 'accepted');
  const worst = open.reduce<AiSeverity>(
    (acc, record) => (severityRank(record.severity) > severityRank(acc) ? record.severity : acc),
    'info',
  );
  if (worst === 'critical') return 'critical';
  if (worst === 'warning' || worst === 'attention') return 'attention';
  return 'normal';
}
