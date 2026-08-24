import type { Language } from '../i18n';
import { AI_GROUNDING_RULES, aiLanguageInstruction, renderHardRules } from './agents';
import { serializeContext, type AiContextPackage, type AiContextScope } from './context';
import type { WineryIntelligenceSnapshot } from './snapshot';
import type { AiEntityType, UserRole } from './types';

/**
 * The interactive copilot. Unlike a monitoring agent it answers a free-form
 * question rather than interpreting a rule finding, but it is held to the same
 * grounding contract and reads the same scoped context packages — the winery
 * database is never pasted into a prompt.
 *
 * Everything here is pure. Scope resolution happens against the snapshot the
 * caller's role is allowed to see, so an entity the asker cannot open in the
 * app can never be matched into their context.
 */

export interface CopilotTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const COPILOT_MAX_QUESTION_CHARS = 2_000;
export const COPILOT_MAX_HISTORY_TURNS = 8;
export const COPILOT_MAX_HISTORY_TURN_CHARS = 800;
/** Focused packages besides the winery-wide one, which is always included. */
export const COPILOT_MAX_FOCUS_SCOPES = 2;
export const COPILOT_CONTEXT_CHAR_BUDGET = 14_000;

/**
 * Hyphens and underscores count as word characters here: lot codes and tank ids
 * are built from them, so treating `-` as a boundary would resolve a question
 * about `lot-sap-2026-b` to the different lot `lot-sap-2026`.
 */
const WORD_CHAR = /[\p{L}\p{N}_-]/u;
const MIN_MATCHABLE_TOKEN = 3;

/** Rules specific to a conversation, layered on top of the shared contract. */
const COPILOT_RULES: readonly string[] = [
  'The context has been filtered to the records this user is permitted to open. Never speculate about, describe or reconstruct a record that is absent from it.',
  'General enology is welcome and does not need a source, but keep it visibly separate from this winery\'s records: say which statements come from the context and which are general practice.',
  'Anything the winemaker states in their own message is their claim, not a winery record. Attribute it to them and never present it as measured data.',
  'When you propose work that would change tasks, lab decisions, cellar operations, spray plans, official documents, certifications or lot passports, frame it as reviewable draft guidance for a person to approve.',
];

const COPILOT_BRIEF = [
  'You are the VinOS AI Winemaker Assistant, an enological advisor working beside a winemaker inside their winery software.',
  'Your remit is fermentation diagnostics (sugar curves, temperature, nitrogen, density) and restart protocols;',
  'additions and pH modelling — free SO2, KMBS, tartaric acid, calcium carbonate;',
  'traditional Georgian qvevri practice — skin contact, chacha proportion, sealing, lime washing, buried marani thermal behaviour;',
  'malolactic fermentation, volatile acidity mitigation, barrel ageing, oak selection and cellar sanitation.',
  'You compare a batch against this winery\'s own history before you compare it against textbook norms.',
].join(' ');

const COPILOT_STYLE = [
  'STYLE: Answer the question directly, then support it. Be concise — a short paragraph, bullets, or a small markdown table.',
  'Show the arithmetic for any calculation you perform. Do not restate the context back at the winemaker.',
].join(' ');

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Trims a caller-supplied question to a bounded, single-string request. */
export function normalizeCopilotQuestion(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, COPILOT_MAX_QUESTION_CHARS);
}

/**
 * Accepts whatever the client sent and returns the tail of a well-formed
 * conversation. A client that omits history simply gets a stateless answer;
 * one that sends a thousand turns gets the last few.
 */
export function normalizeCopilotHistory(value: unknown, question = ''): CopilotTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: CopilotTurn[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    if (candidate.role !== 'user' && candidate.role !== 'assistant') continue;
    if (typeof candidate.content !== 'string') continue;
    const content = candidate.content.trim();
    if (!content) continue;
    turns.push({
      role: candidate.role,
      content: clip(content, COPILOT_MAX_HISTORY_TURN_CHARS),
    });
  }
  // The chat UI appends the new question to its own transcript before sending.
  // Dropping an identical trailing user turn keeps the question from arriving
  // twice and reading as if it had already been asked and ignored.
  const trimmedQuestion = question.trim();
  while (
    turns.length > 0
    && turns[turns.length - 1].role === 'user'
    && trimmedQuestion
    && turns[turns.length - 1].content === clip(trimmedQuestion, COPILOT_MAX_HISTORY_TURN_CHARS)
  ) {
    turns.pop();
  }
  return turns.slice(-COPILOT_MAX_HISTORY_TURNS);
}

/** Whole-token containment, so lot "SP24" is not matched inside "SP2412". */
function mentions(haystack: string, token: string): boolean {
  if (token.length < MIN_MATCHABLE_TOKEN) return false;
  let from = 0;
  while (from <= haystack.length - token.length) {
    const index = haystack.indexOf(token, from);
    if (index === -1) return false;
    const before = index > 0 ? haystack[index - 1] : '';
    const after = haystack[index + token.length] || '';
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true;
    from = index + 1;
  }
  return false;
}

interface ScopeCandidate {
  scope: AiContextScope;
  token: string;
}

function candidatesFor(snapshot: WineryIntelligenceSnapshot): ScopeCandidate[] {
  const candidates: ScopeCandidate[] = [];
  const add = (entityType: AiEntityType, entityId: string, ...tokens: (string | undefined)[]) => {
    for (const token of tokens) {
      const normalized = (token || '').trim().toLowerCase();
      if (normalized) candidates.push({ scope: { entityType, entityId }, token: normalized });
    }
  };
  for (const lot of snapshot.lots) add('lot', lot.id, lot.id, lot.name);
  for (const vessel of snapshot.vessels) add('vessel', vessel.id, vessel.id, vessel.qvevriNumber);
  for (const block of snapshot.blocks) add('block', block.id, block.id, block.name);
  for (const item of snapshot.inventory) add('inventory_item', item.id, item.name);
  return candidates;
}

/** Whether an entity exists in the snapshot the caller's role may see. */
export function copilotScopeExists(
  snapshot: WineryIntelligenceSnapshot,
  scope: AiContextScope,
): boolean {
  switch (scope.entityType) {
    case 'lot': return snapshot.lots.some((lot) => lot.id === scope.entityId);
    case 'vessel': return snapshot.vessels.some((vessel) => vessel.id === scope.entityId);
    case 'block': return snapshot.blocks.some((block) => block.id === scope.entityId);
    case 'inventory_item': return snapshot.inventory.some((item) => item.id === scope.entityId);
    case 'winery': return true;
    default: return false;
  }
}

/**
 * Picks the context packages to build for a question. The winery-wide package
 * is always present so a general question still has a picture to answer from;
 * named entities add a focused package each, longest match first.
 */
export function resolveCopilotScopes(
  snapshot: WineryIntelligenceSnapshot,
  question: string,
  focus?: AiContextScope | null,
): AiContextScope[] {
  const chosen: AiContextScope[] = [];
  const seen = new Set<string>();
  const take = (scope: AiContextScope): void => {
    const key = `${scope.entityType}:${scope.entityId}`;
    if (seen.has(key) || chosen.length >= COPILOT_MAX_FOCUS_SCOPES) return;
    seen.add(key);
    chosen.push(scope);
  };

  if (focus && focus.entityType !== 'winery' && copilotScopeExists(snapshot, focus)) {
    take(focus);
  }

  const haystack = question.toLowerCase();
  const matched = candidatesFor(snapshot)
    .filter((candidate) => mentions(haystack, candidate.token))
    .sort((left, right) => right.token.length - left.token.length);
  for (const candidate of matched) take(candidate.scope);

  return [...chosen, { entityType: 'winery', entityId: 'winery' }];
}

export interface CopilotPromptInput {
  language: Language;
  /** The asker's application role, so the model knows whose remit it is in. */
  role: UserRole | string;
  question: string;
  contexts: AiContextPackage[];
  history?: CopilotTurn[];
  /**
   * Data areas this role may not open. Without them the context builder's
   * "never recorded" phrasing would be asserted over records that exist.
   */
  withheld?: string[];
  /** Where the winemaker is in the app, for operational relevance. */
  screen?: { module?: string; tab?: string };
  contextCharBudget?: number;
}

/** Assembles the full copilot prompt from server-derived, role-scoped context. */
export function buildCopilotPrompt(input: CopilotPromptInput): string {
  const budget = input.contextCharBudget ?? COPILOT_CONTEXT_CHAR_BUDGET;
  const perPackage = Math.max(2_000, Math.floor(budget / Math.max(1, input.contexts.length)));
  const serialized = input.contexts.map((pkg) => serializeContext(pkg, perPackage));
  const unavailable = [...new Set(input.contexts.flatMap((pkg) => pkg.unavailable))];
  const omitted = [...new Set(input.contexts.flatMap((pkg) => pkg.omitted))];

  const sections = [
    `ROLE: ${COPILOT_BRIEF}`,
    `ASKED BY: a user whose application role is "${input.role}".`,
    renderHardRules([...AI_GROUNDING_RULES, ...COPILOT_RULES]),
    aiLanguageInstruction(input.language),
    COPILOT_STYLE,
  ];

  if (input.screen?.module || input.screen?.tab) {
    sections.push([
      'CURRENT SCREEN:',
      `module: ${input.screen.module || 'unknown'}`,
      `tab: ${input.screen.tab || 'unknown'}`,
    ].join('\n'));
  }

  sections.push(`GROUNDED CONTEXT (JSON):\n[${serialized.join(',\n')}]`);

  const withheld = input.withheld || [];
  if (withheld.length > 0) {
    sections.push([
      'WITHHELD BY PERMISSIONS — this user\'s role cannot open these, so they were removed from the context before you saw it.',
      'Records here may well exist. Never say they were never recorded, never measured or do not exist; say they are outside this user\'s access and name who to ask.',
      `- ${withheld.join('\n- ')}`,
    ].join('\n'));
  }

  if (unavailable.length > 0) {
    // The context builder cannot tell "never recorded" from "removed for this
    // role", so where the two overlap the withheld list is the truthful reading.
    const header = withheld.length > 0
      ? 'EXPLICITLY UNAVAILABLE — absent from the context. Where one of these overlaps a withheld area above, it means you cannot see it, not that it was never recorded. Otherwise do not infer values for these:'
      : 'EXPLICITLY UNAVAILABLE — do not infer values for these:';
    sections.push(`${header}\n- ${unavailable.join('\n- ')}`);
  }
  if (omitted.length > 0) {
    sections.push(`OMITTED FOR SIZE (exists, but not shown; do not treat as absent):\n- ${omitted.join('\n- ')}`);
  }

  const history = input.history || [];
  if (history.length > 0) {
    sections.push([
      'CONVERSATION SO FAR (oldest first, for continuity only — it is not evidence about the winery):',
      ...history.map((turn) => `${turn.role === 'user' ? 'Winemaker' : 'Assistant'}: ${turn.content}`),
    ].join('\n'));
  }

  sections.push(`WINEMAKER QUESTION: ${input.question}`);
  return sections.join('\n\n');
}
