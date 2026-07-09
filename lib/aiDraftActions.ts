export type AiDraftActionType =
  | 'task'
  | 'lab_check'
  | 'cellar_operation'
  | 'so2_calculation'
  | 'spray_recommendation'
  | 'compliance_warning'
  | 'official_document_explanation'
  | 'lot_passport_summary';

export type AiDraftPriority = 'high' | 'medium' | 'low';

export interface AiDraftAction {
  id: string;
  type: AiDraftActionType;
  title: string;
  priority: AiDraftPriority;
  description: string;
  reviewOnly: true;
  targetModule: 'tasks' | 'labs' | 'operations' | 'vazi' | 'documents' | 'lots';
  warnings: string[];
  payload?: Record<string, unknown>;
}

export type AiDraftQueueStatus = 'draft' | 'converted_to_task' | 'dismissed';

export interface AiDraftQueueItem extends AiDraftAction {
  status: AiDraftQueueStatus;
  createdAt: string;
  createdBy?: string;
  dueDate?: string;
  sourceModule?: string;
  sourceTab?: string;
}

interface DraftContext {
  contextModule?: string;
  contextTab?: string;
  cellarState?: {
    tanksCount: number;
    activeFermsCount: number;
    avgTemp: number;
    lowSo2Count: number;
    highVaCount: number;
    sampleData: Array<{ id: string; lotCode: string; currentVolume: number; wineName: string; stage: string }>;
  };
}

const REVIEW_ONLY_WARNING = 'Review before applying; AI draft actions do not modify official winery records.';
const CHEMISTRY_WARNING = 'Confirm lot, volume, pH, target free SO2, and lab method before dosing.';
const SPRAY_WARNING = 'Check PHI, REI, product registration, weather window, and local label restrictions before spraying.';
const COMPLIANCE_WARNING = 'Verify official documents against source records before submission.';

const ACTION_LABELS: Record<AiDraftActionType, string> = {
  task: 'Task draft',
  lab_check: 'Lab check draft',
  cellar_operation: 'Cellar operation draft',
  so2_calculation: 'SO2 calculation draft',
  spray_recommendation: 'Spray recommendation draft',
  compliance_warning: 'Compliance warning draft',
  official_document_explanation: 'Official document field explanation',
  lot_passport_summary: 'Lot passport summary draft'
};

function normalizeText(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasAny(text: string, words: string[]): boolean {
  return words.some(word => text.includes(word));
}

function hashDraft(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

function firstLot(context?: DraftContext): { id: string; name: string; volume: number } | null {
  const sample = context?.cellarState?.sampleData?.[0];
  if (!sample) return null;
  return {
    id: sample.lotCode || sample.id,
    name: sample.wineName || sample.lotCode || sample.id,
    volume: sample.currentVolume || 0
  };
}

function makeDraft(
  type: AiDraftActionType,
  content: string,
  draft: Omit<AiDraftAction, 'id' | 'type' | 'reviewOnly'>
): AiDraftAction {
  const warningSet = new Set([REVIEW_ONLY_WARNING, ...draft.warnings]);
  return {
    ...draft,
    id: `ai-draft-${type}-${hashDraft(`${type}:${draft.title}:${content.slice(0, 120)}`)}`,
    type,
    reviewOnly: true,
    warnings: Array.from(warningSet)
  };
}

export function draftActionLabel(type: AiDraftActionType): string {
  return ACTION_LABELS[type];
}

export function deriveAiDraftActions(content: string, context: DraftContext = {}): AiDraftAction[] {
  const text = normalizeText(content);
  if (!text) return [];

  const lot = firstLot(context);
  const contextModule = (context.contextModule || '').toLowerCase();
  const contextTab = (context.contextTab || '').toLowerCase();
  const drafts: AiDraftAction[] = [];

  const so2Like = hasAny(text, ['so2', 'sulfur dioxide', 'sulphur dioxide', 'sulfite', 'sulphite', 'kmbs', 'metabisulfite']);
  const labLike = so2Like || hasAny(text, ['lab', 'analysis', 'sample', 'ph', 'volatile acidity', ' va ', 'density', 'brix', 'ta ', 'tartaric']);
  const cellarLike = hasAny(text, [
    'rack',
    'racking',
    'transfer',
    'punchdown',
    'pump-over',
    'pumpover',
    'topping',
    'sanitize',
    'cleaning',
    'qvevri',
    'wax',
    'seal',
    'fermentation restart',
    'stuck fermentation'
  ]);
  const vaziLike = contextModule === 'vazi' || hasAny(text, [
    'mildew',
    'botrytis',
    'spray',
    'canopy',
    'phenology',
    'vineyard',
    'scouting',
    'phi',
    'rei',
    'humidity',
    'rain'
  ]);
  const complianceLike = hasAny(text, [
    'compliance',
    'certificate',
    'certification',
    'declaration',
    'official',
    'pdo',
    'pgi',
    'export',
    'document',
    'agency',
    'traceability'
  ]);
  const officialFieldGapLike = hasAny(text, ['missing field', 'missing official', 'blank field', 'todo field', 'required field', 'annex', 'form', 'document warning'])
    || (hasAny(text, ['explain', 'why', 'what is missing', 'missing']) && hasAny(text, ['official document', 'annex', 'form', 'georgian document', 'agency document']));
  const passportLike = contextTab === 'lots' || hasAny(text, [
    'lot passport',
    'passport',
    'lineage',
    'chain of custody',
    'history',
    'traceability summary',
    'batch summary'
  ]);
  const urgentLike = hasAny(text, ['critical', 'urgent', 'immediately', 'high risk', 'high va', 'stuck', 'infection', 'contamination']);

  if (labLike) {
    drafts.push(makeDraft('lab_check', content, {
      title: lot ? `Verify chemistry for ${lot.name}` : 'Verify wine chemistry',
      priority: so2Like || urgentLike ? 'high' : 'medium',
      targetModule: 'labs',
      description: lot
        ? `Create a reviewed lab-check draft for ${lot.name} (${lot.id}) before making chemistry or stability decisions.`
        : 'Create a reviewed lab-check draft before making chemistry or stability decisions.',
      warnings: so2Like ? [CHEMISTRY_WARNING] : [],
      payload: {
        lotId: lot?.id,
        requestedChecks: so2Like ? ['pH', 'free SO2', 'total SO2'] : ['pH', 'density', 'TA', 'VA']
      }
    }));
  }

  if (so2Like) {
    drafts.push(makeDraft('so2_calculation', content, {
      title: lot ? `Review SO2 calculation for ${lot.name}` : 'Review SO2 calculation',
      priority: 'high',
      targetModule: 'labs',
      description: lot
        ? `Prepare a draft SO2 review for ${lot.name} using the current volume (${lot.volume} L), measured pH, current free SO2, and target molecular SO2.`
        : 'Prepare a draft SO2 review using confirmed lot volume, measured pH, current free SO2, and target molecular SO2.',
      warnings: [CHEMISTRY_WARNING],
      payload: {
        lotId: lot?.id,
        volumeL: lot?.volume,
        requiresConfirmedInputs: ['pH', 'currentFreeSo2', 'targetFreeSo2', 'wineVolumeL']
      }
    }));
  }

  if (cellarLike) {
    drafts.push(makeDraft('cellar_operation', content, {
      title: lot ? `Review cellar operation for ${lot.name}` : 'Review cellar operation',
      priority: urgentLike ? 'high' : 'medium',
      targetModule: 'operations',
      description: 'Turn the assistant recommendation into a reviewed cellar-operation draft before assigning operators or changing vessels.',
      warnings: [],
      payload: {
        lotId: lot?.id,
        operationHints: ['operator', 'vessel', 'volume', 'materials', 'sanitation check']
      }
    }));
  }

  if (vaziLike) {
    drafts.push(makeDraft('spray_recommendation', content, {
      title: 'Review vineyard protection recommendation',
      priority: urgentLike || hasAny(text, ['mildew', 'botrytis', 'high risk']) ? 'high' : 'medium',
      targetModule: 'vazi',
      description: 'Convert the vineyard recommendation into a checked scouting or spray-plan draft after confirming field pressure and label constraints.',
      warnings: [SPRAY_WARNING],
      payload: {
        contextModule,
        suggestedChecks: ['weather window', 'scouting severity', 'PHI', 'REI', 'operator safety']
      }
    }));
  }

  if (complianceLike) {
    drafts.push(makeDraft('compliance_warning', content, {
      title: 'Review compliance and document risk',
      priority: urgentLike || hasAny(text, ['missing', 'expired', 'rejected']) ? 'high' : 'medium',
      targetModule: 'documents',
      description: 'Create a review-only compliance warning so official files, declarations, and certification data can be checked against source records.',
      warnings: [COMPLIANCE_WARNING],
      payload: {
        suggestedChecks: ['lot origin', 'certificate status', 'declaration numbers', 'export purpose', 'attachments']
      }
    }));
  }

  if (officialFieldGapLike) {
    drafts.push(makeDraft('official_document_explanation', content, {
      title: 'Explain missing official document fields',
      priority: hasAny(text, ['critical', 'export', 'submission', 'submit']) ? 'high' : 'medium',
      targetModule: 'documents',
      description: 'Prepare a review-only explanation of missing official document fields, their likely source records, and what must be entered before export or submission.',
      warnings: [COMPLIANCE_WARNING],
      payload: {
        suggestedSections: ['missing fields', 'source module', 'blocking vs warning', 'next data-entry step']
      }
    }));
  }

  if (passportLike) {
    drafts.push(makeDraft('lot_passport_summary', content, {
      title: lot ? `Draft lot passport summary for ${lot.name}` : 'Draft lot passport summary',
      priority: 'low',
      targetModule: 'lots',
      description: 'Prepare a review-only lot passport summary from lineage, intake, lab, cellar, and document records.',
      warnings: [COMPLIANCE_WARNING],
      payload: {
        lotId: lot?.id,
        sections: ['origin', 'operations', 'chemistry', 'certification', 'audit']
      }
    }));
  }

  if (drafts.length === 0 || hasAny(text, ['todo', 'task', 'action', 'next step', 'protocol', 'checklist', 'schedule'])) {
    drafts.unshift(makeDraft('task', content, {
      title: urgentLike ? 'Review urgent AI-recommended task' : 'Review AI-recommended task',
      priority: urgentLike ? 'high' : 'medium',
      targetModule: 'tasks',
      description: 'Create a task draft from the assistant recommendation after a human review.',
      warnings: [],
      payload: {
        source: 'ai_assistant'
      }
    }));
  }

  return drafts;
}

export function formatDraftTaskDescription(action: AiDraftAction): string {
  const warningText = action.warnings.length > 0 ? `\n\nReview notes:\n- ${action.warnings.join('\n- ')}` : '';
  return `AI draft action (${draftActionLabel(action.type)}): ${action.description}${warningText}`;
}

export function createAiDraftQueueItems(
  actions: AiDraftAction[],
  options: {
    createdAt?: string;
    createdBy?: string;
    dueDate?: string;
    sourceModule?: string;
    sourceTab?: string;
  } = {},
): AiDraftQueueItem[] {
  const createdAt = options.createdAt || new Date().toISOString();
  return actions.map(action => ({
    ...action,
    status: 'draft',
    createdAt,
    createdBy: options.createdBy,
    dueDate: options.dueDate,
    sourceModule: options.sourceModule,
    sourceTab: options.sourceTab,
  }));
}

export function upsertAiDraftQueueItems(queue: AiDraftQueueItem[], incoming: AiDraftQueueItem[]): AiDraftQueueItem[] {
  const incomingIds = new Set(incoming.map(item => item.id));
  const updated = queue.map(item => {
    const next = incoming.find(candidate => candidate.id === item.id);
    if (!next) return item;
    return {
      ...item,
      ...next,
      status: item.status === 'converted_to_task' ? item.status : next.status,
      createdAt: item.createdAt,
    };
  });
  return [
    ...incoming.filter(item => !queue.some(existing => existing.id === item.id)),
    ...updated.filter(item => !incomingIds.has(item.id) || incoming.some(candidate => candidate.id === item.id)),
  ];
}
