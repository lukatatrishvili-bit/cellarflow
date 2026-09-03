import type { Language } from '../i18n';
import {
  extractNumericClaims,
  type AiContextEvidenceRef,
  type AiNumericClaim,
} from './context';
import { buildFinding } from './finding';
import { AREA_MODULE } from './roles';
import { fromModel, plain, text, type LocalizedText } from './text';
import {
  AGENT_AREA,
  type AiAgentKey,
  type AiEntityType,
  type AiFinding,
  type AiMonitoringArea,
  type AiRecommendedActionKind,
  type AiSeverity,
} from './types';

/**
 * The model's output contract. Free text is never trusted internally: the model
 * fills this structure, the structure is validated here, and the user-facing
 * prose is rendered from validated fields. Anything that fails validation is
 * dropped with a reason rather than shown.
 */

const SEVERITIES: AiSeverity[] = ['info', 'attention', 'warning', 'critical'];
const ACTION_KINDS: AiRecommendedActionKind[] = [
  'check', 'measure', 'create_task', 'notify', 'purchase', 'schedule', 'document', 'inspect',
];

const MAX_TITLE = 140;
const MAX_TEXT = 900;
const MAX_LIST_ITEMS = 6;
const MAX_ITEM_TEXT = 300;
const MAX_SOURCE_REFS = 8;

/** Passed to Gemini as `responseSchema`; uppercase type names are the SDK's form. */
export const AI_FINDING_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          finding_type: { type: 'STRING', description: 'Stable lowercase slug, e.g. fermentation_slowdown' },
          title: { type: 'STRING' },
          severity: { type: 'STRING', enum: SEVERITIES },
          entity_type: { type: 'STRING', enum: ['lot', 'vessel', 'block', 'inventory_item', 'winery'] },
          entity_id: { type: 'STRING', description: 'Must be an id present in the supplied context' },
          observation: { type: 'STRING', description: 'What the data shows. Facts only.' },
          reasoning_summary: { type: 'STRING', description: 'Why this matters, and how the conclusion follows.' },
          possible_causes: { type: 'ARRAY', items: { type: 'STRING' } },
          recommended_actions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                kind: { type: 'STRING', enum: ACTION_KINDS },
                label: { type: 'STRING' },
              },
              required: ['kind', 'label'],
            },
          },
          confidence: { type: 'NUMBER', description: '0 to 1' },
          confidence_reasons: { type: 'ARRAY', items: { type: 'STRING' } },
          missing_information: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Data that would change the conclusion but does not exist. Never guess it.',
          },
          source_refs: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'One or more sourceRef values copied exactly from WINERY DATA and used by this finding.',
          },
          requires_human_confirmation: { type: 'BOOLEAN' },
        },
        required: [
          'finding_type', 'title', 'severity', 'entity_type', 'entity_id',
          'observation', 'reasoning_summary', 'confidence', 'source_refs',
          'requires_human_confirmation',
        ],
      },
    },
  },
  required: ['findings'],
} as const;

export interface ValidationRejection {
  reason:
  | 'not_an_object'
  | 'missing_required_field'
  | 'unknown_entity'
  | 'missing_source_ref'
  | 'unknown_source_ref'
  | 'ungrounded_numeric_claim'
  | 'invalid_severity'
  | 'empty_text';
  detail: string;
}

export interface ParseModelFindingsOptions {
  agent: AiAgentKey;
  area: AiMonitoringArea;
  language: Language;
  /** Entity ids the model is allowed to attach a finding to. */
  allowedEntities: Array<{ type: AiEntityType; id: string; label: string }>;
  /** Sources present in the exact serialized context sent to the model. */
  allowedEvidence: AiContextEvidenceRef[];
  now?: string;
  /** Stable prefix for this agent invocation, used for dedupe continuity. */
  sourceDedupeKey?: string;
  /** Deterministic finding that caused this analysis to run. */
  triggerDedupeKey?: string;
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function strList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => str(item, maxLength))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

/** Model prose exists in one language only; both slots carry it verbatim. */
function modelText(value: string): LocalizedText {
  return fromModel(value);
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right)
    <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** Math.max(0, Math.min(12, decimals));
  return Math.round(value * factor) / factor;
}

/**
 * Whether a stated quantity is supported by the cited server data.
 *
 * Exact equality alone is too strict to be useful: the context carries
 * `paceDeviationPct: -18.33` and any competent write-up says "18% slower".
 * Rejecting that would discard good analysis and — worse — do it invisibly.
 *
 * So a claim is grounded when it is a *correct rounding* of a cited value, or of
 * that value's magnitude (prose states direction in words, the data in a sign).
 * This stays sound because rounding only ever admits claims that are true of a
 * real number: 999 against 22, or a unit-shifted 13 against 0.13, still fail.
 */
function claimIsGrounded(claim: AiNumericClaim, grounded: readonly number[]): boolean {
  return grounded.some((known) => {
    if (sameNumber(claim.value, known)) return true;
    if (sameNumber(claim.value, roundTo(known, claim.decimals))) return true;
    const magnitude = Math.abs(known);
    return sameNumber(claim.value, magnitude)
      || sameNumber(claim.value, roundTo(magnitude, claim.decimals));
  });
}

/**
 * Validates raw model output and converts surviving entries into findings.
 * Two guards matter most: an entity the context never mentioned is rejected
 * outright, and every model finding is forced to require human confirmation.
 */
export function parseModelFindings(
  raw: unknown,
  options: ParseModelFindingsOptions,
): { findings: AiFinding[]; rejected: ValidationRejection[] } {
  const rejected: ValidationRejection[] = [];
  const findings: AiFinding[] = [];

  let payload: unknown = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      return { findings, rejected: [{ reason: 'not_an_object', detail: 'response was not valid JSON' }] };
    }
  }
  if (!payload || typeof payload !== 'object') {
    return { findings, rejected: [{ reason: 'not_an_object', detail: 'response was not an object' }] };
  }

  const entries = (payload as { findings?: unknown }).findings;
  if (!Array.isArray(entries)) {
    return { findings, rejected: [{ reason: 'missing_required_field', detail: 'findings array missing' }] };
  }

  const allowed = new Map(options.allowedEntities.map((entity) => [`${entity.type}:${entity.id}`, entity]));
  const allowedEvidence = new Map(options.allowedEvidence.map((item) => [item.sourceRef, item]));
  const now = options.now || new Date().toISOString();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      rejected.push({ reason: 'not_an_object', detail: 'finding entry was not an object' });
      continue;
    }
    const row = entry as Record<string, unknown>;

    const observation = str(row.observation, MAX_TEXT);
    const reasoning = str(row.reasoning_summary, MAX_TEXT);
    const title = str(row.title, MAX_TITLE);
    if (!title || !observation || !reasoning) {
      rejected.push({ reason: 'empty_text', detail: `finding "${title || 'untitled'}" was missing required prose` });
      continue;
    }

    const severity = SEVERITIES.includes(row.severity as AiSeverity)
      ? row.severity as AiSeverity
      : null;
    if (!severity) {
      rejected.push({ reason: 'invalid_severity', detail: `finding "${title}" had severity "${String(row.severity)}"` });
      continue;
    }

    const entityType = str(row.entity_type, 40) as AiEntityType;
    const entityId = str(row.entity_id, 120);
    const match = allowed.get(`${entityType}:${entityId}`);
    if (!match) {
      // The single most important guard: a model that invents a tank or lot id
      // is hallucinating, and the finding is discarded rather than displayed.
      rejected.push({
        reason: 'unknown_entity',
        detail: `finding "${title}" referenced ${entityType} "${entityId}", which is not in the supplied context`,
      });
      continue;
    }

    const sourceRefs = [...new Set(strList(row.source_refs, MAX_SOURCE_REFS, 200))];
    if (sourceRefs.length === 0) {
      rejected.push({
        reason: 'missing_source_ref',
        detail: `finding "${title}" did not cite any sourceRef from the supplied context`,
      });
      continue;
    }
    const unknownSourceRef = sourceRefs.find((sourceRef) => !allowedEvidence.has(sourceRef));
    if (unknownSourceRef) {
      rejected.push({
        reason: 'unknown_source_ref',
        detail: `finding "${title}" cited "${unknownSourceRef}", which was not in the supplied context`,
      });
      continue;
    }
    const citedEvidence = sourceRefs.map((sourceRef) => allowedEvidence.get(sourceRef)!);

    const rawActions = Array.isArray(row.recommended_actions) ? row.recommended_actions : [];
    const actions = rawActions
      .slice(0, MAX_LIST_ITEMS)
      .map((item) => {
        const record = (item && typeof item === 'object') ? item as Record<string, unknown> : {};
        const label = str(record.label, MAX_ITEM_TEXT);
        if (!label) return null;
        const kind = ACTION_KINDS.includes(record.kind as AiRecommendedActionKind)
          ? record.kind as AiRecommendedActionKind
          : 'check';
        return { kind, label: modelText(label), requiresConfirmation: true };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);
    const possibleCauses = strList(row.possible_causes, MAX_LIST_ITEMS, MAX_ITEM_TEXT);
    const confidenceReasons = strList(row.confidence_reasons, 3, MAX_ITEM_TEXT);
    const missingInformation = strList(row.missing_information, MAX_LIST_ITEMS, MAX_ITEM_TEXT);

    const claimNumbers = extractNumericClaims([
      title,
      observation,
      reasoning,
      ...possibleCauses,
      ...actions.map((action) => action.label.en),
      ...confidenceReasons,
      ...missingInformation,
    ]);
    const groundedNumbers = citedEvidence.flatMap((item) => item.numericValues);
    const unsupportedNumber = claimNumbers.find((claim) => !claimIsGrounded(claim, groundedNumbers));
    if (unsupportedNumber !== undefined) {
      rejected.push({
        reason: 'ungrounded_numeric_claim',
        detail: `finding "${title}" stated ${unsupportedNumber.value}, which does not occur in its cited sources`,
      });
      continue;
    }

    const confidenceScore = typeof row.confidence === 'number' && Number.isFinite(row.confidence)
      ? Math.max(0, Math.min(1, row.confidence))
      : 0.4;
    const level = confidenceScore >= 0.75 ? 'high' : confidenceScore >= 0.45 ? 'medium' : 'low';

    const findingType = str(row.finding_type, 60).toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'model_analysis';

    findings.push(buildFinding({
      findingType,
      agent: options.agent,
      // A model finding inherits the *trigger's* area, which is not necessarily
      // the specialist's own. A laboratory agent invited onto a stuck-fermentation
      // trigger writes chemistry into a finding filed under `fermentation`, so the
      // agent's own module has to be required on top of the area's.
      area: options.area,
      requiredModules: [AREA_MODULE[AGENT_AREA[options.agent]]],
      severity,
      entityType,
      entityId,
      entityLabel: match.label,
      source: 'model',
      title: modelText(title),
      observation: modelText(observation),
      whyItMatters: modelText(reasoning),
      possibleCauses: possibleCauses.map(modelText),
      recommendedActions: actions,
      evidence: citedEvidence.map((item) => ({
        kind: 'fact',
        label: plain(item.label),
        value: plain(item.value),
        sourceRef: item.sourceRef,
      })),
      confidence: {
        level,
        score: confidenceScore,
        reasons: [
          text('Produced by model analysis over your winery data.', 'შექმნილია მოდელის ანალიზით თქვენი მარნის მონაცემებზე.'),
          ...confidenceReasons.map(modelText),
        ],
      },
      missingInformation: missingInformation.map(modelText),
      // Non-negotiable: a model finding never authorises an action by itself.
      requiresHumanConfirmation: true,
      createdAt: now,
      dedupeKey: options.sourceDedupeKey
        ? `${options.sourceDedupeKey}:${findingType}:${entityType}:${entityId}:analysis`
        : `${findingType}:${entityId}:model`,
      triggerDedupeKey: options.triggerDedupeKey,
    }));
  }

  return { findings, rejected };
}

/**
 * Model prose is written in one language. Rendering it in the other would be a
 * silent lie, so the finding records which language it holds.
 */
export function tagModelLanguage(findings: AiFinding[], language: Language): AiFinding[] {
  return findings.map((finding) => ({ ...finding, modelLanguage: language }));
}
