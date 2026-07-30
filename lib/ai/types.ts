import type { PermissionModule } from '../../server/permissions';
import type { UserProfile } from '../wineryState';
import type { Language } from '../i18n';
import type { LocalizedText } from './text';

export type UserRole = UserProfile['role'];

// ---------------------------------------------------------------------------
// Severity, confidence, provenance
// ---------------------------------------------------------------------------

/**
 * Four levels, deliberately distinct from the legacy three-level `Alert`
 * severity in ../alerts. `attention` is the band that keeps low-value noise
 * out of `warning` so a WARNING still means "look at this today".
 */
export type AiSeverity = 'info' | 'attention' | 'warning' | 'critical';

export const AI_SEVERITY_ORDER: AiSeverity[] = ['info', 'attention', 'warning', 'critical'];

export function severityRank(severity: AiSeverity): number {
  return AI_SEVERITY_ORDER.indexOf(severity);
}

export function maxSeverity(a: AiSeverity, b: AiSeverity): AiSeverity {
  return severityRank(a) >= severityRank(b) ? a : b;
}

export type AiConfidenceLevel = 'low' | 'medium' | 'high';

export interface AiConfidence {
  level: AiConfidenceLevel;
  /** 0–1. Deterministic rules report their own certainty, not a model score. */
  score: number;
  /** Why the layer is (or is not) confident — shown verbatim to the user. */
  reasons: LocalizedText[];
}

/** Separates measured truth from reasoning, so a user always knows what is known. */
export type AiEvidenceKind = 'fact' | 'inference' | 'prediction' | 'recommendation';

export interface AiEvidence {
  kind: AiEvidenceKind;
  label: LocalizedText;
  /** Rendered as-is; already formatted with units. */
  value: LocalizedText;
  /** Where the number came from, e.g. `lablogs:LAB-2026-04-11`. */
  sourceRef?: string;
}

/** Whether a finding was produced by deterministic code, the model, or both. */
export type AiFindingSource = 'rule' | 'model' | 'hybrid';

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AiAgentKey =
  | 'winemaking'
  | 'vineyard'
  | 'laboratory'
  | 'inventory'
  | 'compliance'
  | 'management';

export type AiMonitoringArea =
  | 'fermentation'
  | 'laboratory'
  | 'inventory'
  | 'vineyard'
  | 'compliance'
  | 'operations';

/**
 * Each specialist's home area — the single source of truth, shared by the agent
 * registry and the authorization gate. A specialist invited onto another area's
 * trigger still writes about its own discipline, so this is what decides which
 * module its output requires.
 */
export const AGENT_AREA: Record<AiAgentKey, AiMonitoringArea> = {
  winemaking: 'fermentation',
  vineyard: 'vineyard',
  laboratory: 'laboratory',
  inventory: 'inventory',
  compliance: 'compliance',
  management: 'operations',
};

/** Cost tier chosen by the orchestrator; only `deep` may fan out across agents. */
export type AiAnalysisTier = 'lightweight' | 'standard' | 'deep';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type AiEntityType =
  | 'lot'
  | 'vessel'
  | 'block'
  | 'inventory_item'
  | 'task'
  | 'bottling_run'
  | 'certification'
  | 'intake'
  | 'transfer'
  | 'winery';

export type AiEventType =
  | 'lab_analysis_added'
  | 'fermentation_reading_added'
  | 'fermentation_slowed'
  | 'fermentation_stopped'
  | 'fermentation_completed'
  | 'temperature_changed'
  | 'density_changed'
  | 'so2_measured'
  | 'volatile_acidity_changed'
  | 'ph_changed'
  | 'transfer_completed'
  | 'blend_created'
  | 'vessel_filled'
  | 'vessel_emptied'
  | 'treatment_applied'
  | 'inventory_level_changed'
  | 'stock_low'
  | 'grape_intake_received'
  | 'vineyard_observation_added'
  | 'weather_forecast_changed'
  | 'disease_risk_increased'
  | 'harvest_window_approaching'
  | 'grape_maturity_changed'
  | 'task_completed'
  | 'task_overdue'
  | 'compliance_document_incomplete'
  | 'traceability_gap_detected'
  | 'planned_operation_missed'
  | 'abnormal_production_loss'
  | 'bottling_approaching'
  | 'lot_deadline_approaching';

export interface AiEntityRef {
  type: AiEntityType;
  id: string;
  /** Human label captured at event time so the feed survives renames. */
  label?: string;
}

/** Normalized change record. Everything the layer reacts to becomes one of these. */
export interface AiEvent {
  id: string;
  eventType: AiEventType;
  entityType: AiEntityType;
  entityId: string;
  entityLabel?: string;
  /** ISO timestamp of the change, not of detection. */
  timestamp: string;
  previousValue?: string | number | null;
  newValue?: string | number | null;
  userId?: string;
  relatedEntities: AiEntityRef[];
  severityHint: AiSeverity;
  area: AiMonitoringArea;
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Triage outcome. `rule` means deterministic code already produced the whole
 * finding and the model is not needed — the default, and the cheap path.
 */
export type AiTriageDecision = 'ignore' | 'rule' | 'analyze' | 'urgent';

export interface AiTriageResult {
  decision: AiTriageDecision;
  agents: AiAgentKey[];
  tier: AiAnalysisTier;
  reason: LocalizedText;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type AiRecommendedActionKind =
  | 'check'
  | 'measure'
  | 'create_task'
  | 'notify'
  | 'purchase'
  | 'schedule'
  | 'document'
  | 'inspect';

export interface AiRecommendedAction {
  kind: AiRecommendedActionKind;
  label: LocalizedText;
  /** Module the user should land in when they accept the recommendation. */
  targetModule?: string;
  /** True when the layer must not create the record without a human decision. */
  requiresConfirmation: boolean;
}

/**
 * The single structured output of the whole intelligence layer. Rules and the
 * model both produce exactly this shape, so the UI, notification routing and
 * activity log never care which path a finding came from.
 */
export interface AiFinding {
  id: string;
  createdAt: string;
  source: AiFindingSource;
  agent: AiAgentKey;
  area: AiMonitoringArea;
  /** Stable slug, e.g. `fermentation_slowdown`. Used for dedupe and analytics. */
  findingType: string;
  severity: AiSeverity;
  entityType: AiEntityType;
  entityId: string;
  entityLabel: string;
  relatedEntities: AiEntityRef[];
  title: LocalizedText;
  observation: LocalizedText;
  whyItMatters: LocalizedText;
  possibleCauses: LocalizedText[];
  recommendedActions: AiRecommendedAction[];
  evidence: AiEvidence[];
  confidence: AiConfidence;
  /** Named gaps. Non-empty means the layer explicitly could not confirm something. */
  missingInformation: LocalizedText[];
  requiresHumanConfirmation: boolean;
  /**
   * Every permission module whose data this finding actually quotes.
   *
   * A finding's `area` says which monitor produced it, not which records it
   * read — a bottling-readiness finding lives in `operations` but states the age
   * of a laboratory analysis. Visibility must be gated on all of these, or the
   * finding becomes a side channel around the module boundary. Empty means the
   * finding is confined to its own area.
   */
  requiredModules: PermissionModule[];
  /** Roles this finding is routed to. Empty means every role that can see the area. */
  roles: UserRole[];
  /** Suppression window for the same `dedupeKey`, in hours. */
  cooldownHours: number;
  /** Stable identity across evaluations of the same underlying situation. */
  dedupeKey: string;
  /**
   * Deterministic rule that caused a model analysis to run. This lets a
   * rule-only pass keep the interpretation while the trigger is still active,
   * and resolve it only after the underlying situation clears.
   */
  triggerDedupeKey?: string;
  /** Language the model wrote in, when `source` is not `rule`. */
  modelLanguage?: Language;
}

export type AiFindingStatus =
  | 'new'
  | 'reviewed'
  | 'accepted'
  | 'rejected'
  | 'resolved'
  | 'dismissed';

export type AiFeedbackVerdict = 'helpful' | 'not_helpful' | 'incorrect' | 'already_handled';

export interface AiFindingFeedback {
  verdict: AiFeedbackVerdict;
  comment?: string;
  submittedBy?: string;
  submittedAt: string;
}

/** Persisted lifecycle wrapper. Server-owned; never accepted through client sync. */
export interface AiFindingRecord extends AiFinding {
  status: AiFindingStatus;
  statusChangedAt?: string;
  statusChangedBy?: string;
  /** Last time an evaluation re-observed the same situation. */
  lastSeenAt: string;
  /** Last completed model attempt for this deterministic trigger, even if it returned no usable finding. */
  lastAnalyzedAt?: string;
  /** Durable hand-off marker for the latest transition routed to the notification outbox. */
  lastNotificationEventKey?: string;
  /** Cadence window that produced `lastNotificationEventKey`. */
  lastNotificationAt?: string;
  /** Distinguishes hourly/daily/weekly retries that share the same UTC boundary. */
  lastNotificationRunKey?: string;
  /** How many evaluations have re-observed it; drives escalation, not noise. */
  occurrences: number;
  /**
   * Viewer-specific feedback used on the wire and retained for compatibility
   * with records written before multi-reviewer feedback was introduced.
   */
  feedback?: AiFindingFeedback;
  /** Server-owned feedback history. Never projected directly to clients. */
  feedbackEntries?: AiFindingFeedback[];
  /** Task created when a user accepted a recommendation. */
  linkedTaskId?: string;
  /** Free text captured when the user resolves the finding. */
  resolutionNote?: string;
  lastModified?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AiWineryTargets {
  /** Winery's preferred free SO₂ working band, mg/L. */
  freeSo2MinMgL: number;
  freeSo2MaxMgL: number;
  /** Molecular SO₂ floor for microbial stability, mg/L. */
  molecularSo2MinMgL: number;
  fermentationTempMinC: number;
  fermentationTempMaxC: number;
  maxVolatileAcidityGL: number;
  /** Below this many days of cover, an inventory item is flagged. */
  minStockCoverDays: number;
  /** Days after which a fermenting or aging lot is due for fresh chemistry. */
  labAnalysisIntervalDays: number;
  /** Minimum expected specific-gravity drop per day during active fermentation. */
  minDensityDropPerDay: number;
  /** Maximum acceptable transfer/process loss before it reads as abnormal. */
  maxProcessLossPct: number;
  /** Cellar fill above this share of total capacity is a capacity risk. */
  maxCellarFillPct: number;
  harvestTargetBrix: number;
  harvestTargetPh: number;
  harvestTargetTaGL: number;
}

export interface AiWineryConfig {
  monitoringEnabled: boolean;
  dailyBriefingEnabled: boolean;
  /** Findings below this severity are computed but never notified. */
  minimumSeverity: AiSeverity;
  areas: Record<AiMonitoringArea, boolean>;
  /** Master switch for any paid model call. Rules keep working when false. */
  modelAnalysisEnabled: boolean;
  /** Hard ceiling on model calls per winery per day. */
  maxModelCallsPerDay: number;
  targets: AiWineryTargets;
}
