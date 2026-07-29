import { text, type LocalizedText } from './text';
import {
  severityRank,
  type AiAgentKey,
  type AiConfidence,
  type AiEntityRef,
  type AiEntityType,
  type AiEvidence,
  type AiFinding,
  type AiFindingSource,
  type AiMonitoringArea,
  type AiRecommendedAction,
  type AiSeverity,
  type UserRole,
} from './types';

export interface FindingDraft {
  findingType: string;
  agent: AiAgentKey;
  area: AiMonitoringArea;
  severity: AiSeverity;
  entityType: AiEntityType;
  entityId: string;
  entityLabel: string;
  title: LocalizedText;
  observation: LocalizedText;
  whyItMatters: LocalizedText;
  possibleCauses?: LocalizedText[];
  recommendedActions?: AiRecommendedAction[];
  evidence?: AiEvidence[];
  confidence: AiConfidence;
  missingInformation?: LocalizedText[];
  relatedEntities?: AiEntityRef[];
  roles?: UserRole[];
  cooldownHours?: number;
  requiresHumanConfirmation?: boolean;
  source?: AiFindingSource;
  /** Overrides the default `findingType:entityId` identity. */
  dedupeKey?: string;
  /** Deterministic rule that triggered a model-authored interpretation. */
  triggerDedupeKey?: string;
  createdAt?: string;
}

/** Cooldowns keep a persistent condition from re-notifying on every evaluation. */
const DEFAULT_COOLDOWN_HOURS: Record<AiSeverity, number> = {
  critical: 6,
  warning: 24,
  attention: 48,
  info: 72,
};

/**
 * Identity is derived, not random: re-running the engine over unchanged state
 * must produce the same ids so the activity log accumulates status rather than
 * duplicates.
 */
export function stableFindingId(dedupeKey: string): string {
  const normalized = dedupeKey.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/-+/g, '-');
  return `ai-${normalized}`.slice(0, 120);
}

export function buildFinding(draft: FindingDraft): AiFinding {
  const dedupeKey = draft.dedupeKey || `${draft.findingType}:${draft.entityId}`;
  return {
    id: stableFindingId(dedupeKey),
    createdAt: draft.createdAt || new Date().toISOString(),
    source: draft.source || 'rule',
    agent: draft.agent,
    area: draft.area,
    findingType: draft.findingType,
    severity: draft.severity,
    entityType: draft.entityType,
    entityId: draft.entityId,
    entityLabel: draft.entityLabel,
    relatedEntities: draft.relatedEntities || [],
    title: draft.title,
    observation: draft.observation,
    whyItMatters: draft.whyItMatters,
    possibleCauses: draft.possibleCauses || [],
    recommendedActions: draft.recommendedActions || [],
    evidence: draft.evidence || [],
    confidence: draft.confidence,
    missingInformation: draft.missingInformation || [],
    requiresHumanConfirmation: draft.requiresHumanConfirmation ?? true,
    roles: draft.roles || [],
    cooldownHours: draft.cooldownHours ?? DEFAULT_COOLDOWN_HOURS[draft.severity],
    dedupeKey,
    triggerDedupeKey: draft.triggerDedupeKey,
  };
}

export function confidence(
  level: AiConfidence['level'],
  score: number,
  reasons: LocalizedText[],
): AiConfidence {
  return { level, score: Math.max(0, Math.min(1, score)), reasons };
}

export function evidence(
  kind: AiEvidence['kind'],
  label: LocalizedText,
  value: LocalizedText,
  sourceRef?: string,
): AiEvidence {
  return { kind, label, value, sourceRef };
}

export function action(
  kind: AiRecommendedAction['kind'],
  label: LocalizedText,
  options: { targetModule?: string; requiresConfirmation?: boolean } = {},
): AiRecommendedAction {
  return {
    kind,
    label,
    targetModule: options.targetModule,
    requiresConfirmation: options.requiresConfirmation ?? true,
  };
}

/** Standard note attached whenever a needed measurement has never been taken. */
export function neverMeasured(what: LocalizedText): LocalizedText {
  return text(
    `${what.en} has never been recorded for this batch, so this cannot be confirmed from your data.`,
    `${what.ka} ამ პარტიისთვის არასდროს დაფიქსირებულა, ამიტომ ეს თქვენი მონაცემებით ვერ დასტურდება.`,
  );
}

export function sortFindings(findings: AiFinding[]): AiFinding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = severityRank(b.severity) - severityRank(a.severity);
    if (bySeverity !== 0) return bySeverity;
    const byConfidence = b.confidence.score - a.confidence.score;
    if (byConfidence !== 0) return byConfidence;
    return a.dedupeKey.localeCompare(b.dedupeKey);
  });
}

/** Last writer wins per dedupe key; keeps the highest severity seen. */
export function dedupeFindings(findings: AiFinding[]): AiFinding[] {
  const byKey = new Map<string, AiFinding>();
  for (const finding of findings) {
    const existing = byKey.get(finding.dedupeKey);
    if (!existing || severityRank(finding.severity) > severityRank(existing.severity)) {
      byKey.set(finding.dedupeKey, finding);
    }
  }
  return sortFindings([...byKey.values()]);
}
