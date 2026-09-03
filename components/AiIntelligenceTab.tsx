import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleX,
  ClipboardList,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import {
  draftActionFromFindingRecommendation,
  type AiDraftAction,
} from '../lib/aiDraftActions';
import {
  AGENT_LABELS,
  AREA_LABELS,
  CONFIDENCE_LABELS,
  EVIDENCE_KIND_LABELS,
  SECTION_LABELS,
  SEVERITY_LABELS,
  buildDailyBriefing,
  evaluateRules,
  filterFindingsForRole,
  localize,
  resolveAiConfig,
  severityRank,
  type AiFinding,
  type AiFindingRecord,
  type AiFindingStatus,
  type AiFeedbackVerdict,
  type AiAgentKey,
  type AiMonitoringArea,
  type AiSeverity,
  type UserRole,
  type WineryIntelligenceSnapshotInput,
} from '../lib/ai';

interface AskRow {
  [column: string]: string | number | null;
}

interface AskResult {
  answer: string;
  columns: string[];
  rows: AskRow[];
  empty: boolean;
  truncated: boolean;
  query: { kind: string };
  modelUnavailableReason?: 'budget_exhausted';
  /** False when the rows are the winery's position, not an answer to the question. */
  answeredFromQuestion?: boolean;
  fallbackReason?: 'model_disabled' | 'budget_exhausted' | 'planner_failed';
  /** The assistant asked a question back instead of guessing at this one. */
  needsClarification?: boolean;
}

interface AiNotificationPreferenceWire {
  minimumSeverity: AiSeverity;
  inAppMinimumSeverity: AiSeverity;
}

interface AiCalibrationWire {
  enabled: boolean;
  thresholds: {
    minimumQualityResponses: number;
    minimumFindings: number;
    incorrectRate: number;
    negativeRate: number;
    alreadyHandledRate: number;
  };
  totalResponses: number;
  findingsWithFeedback: number;
  assessedDetectors: number;
  detectors: Array<{
    findingType: string;
    source: 'rule' | 'model' | 'hybrid';
    area: string;
    reason: 'incorrect' | 'unhelpful' | 'already_handled';
    findingsReviewed: number;
    totalResponses: number;
    incorrectRate: number;
    negativeRate: number;
    alreadyHandledRate: number;
  }>;
}

interface AiKnowledgeDocumentWire {
  id: string;
  title: string;
  sourceLabel?: string;
  sourceUrl?: string;
  language: Language;
  agents: AiAgentKey[];
  chunkCount: number;
  embeddedChunkCount: number;
  preview: string;
  updatedAt: string;
}

export interface AiIntelligenceTabProps {
  lang: Language;
  role: UserRole;
  /** Everything the rule engine reads. Passed straight through from app state. */
  data: Omit<WineryIntelligenceSnapshotInput, 'lang' | 'today' | 'config'>;
  /** Pre-computed rule findings, so the shell and this tab evaluate once. */
  findings?: AiFinding[];
  /** Winery AI configuration, stored on the company profile. */
  aiConfig?: unknown;
  canConfigure?: boolean;
  /** Lifecycle changes and deep analysis persist server-owned findings. */
  canReview?: boolean;
  onConfigSaved?: (config: ReturnType<typeof resolveAiConfig>) => void;
  /** Opens and scrolls to a finding selected in the global notification panel. */
  focusFindingId?: string | null;
  onFocusConsumed?: () => void;
  onCreateTask?: (title: string, priority: 'high' | 'medium' | 'low', dueDate: string, description: string) => void;
  onSaveDraftActions?: (actions: AiDraftAction[], dueDate?: string) => number | void;
  onNavigate?: (targetModule: string) => void;
  setToastMessage?: (message: string | null) => void;
}

const SEVERITY_STYLES: Record<AiSeverity, { chip: string; bar: string; dot: string }> = {
  critical: { chip: 'bg-rose-50 text-rose-700 border-rose-200', bar: 'bg-rose-500', dot: 'bg-rose-500' },
  warning: { chip: 'bg-amber-50 text-amber-800 border-amber-200', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  attention: { chip: 'bg-sky-50 text-sky-700 border-sky-200', bar: 'bg-sky-500', dot: 'bg-sky-500' },
  info: { chip: 'bg-stone-100 text-stone-600 border-stone-200', bar: 'bg-stone-400', dot: 'bg-stone-400' },
};

/** A finding's urgency carries through to the work it generates. */
function taskPriorityFor(severity: AiSeverity): 'high' | 'medium' | 'low' {
  if (severity === 'critical') return 'high';
  return severity === 'warning' ? 'medium' : 'low';
}

const AREAS: AiMonitoringArea[] = ['fermentation', 'laboratory', 'inventory', 'vineyard', 'compliance', 'operations'];
const SEVERITIES: AiSeverity[] = ['critical', 'warning', 'attention', 'info'];

function localizedWireText(value: unknown): { en: string; ka: string } {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.en === 'string' && typeof candidate.ka === 'string') {
      return { en: candidate.en, ka: candidate.ka };
    }
  }
  const rendered = typeof value === 'string' ? value : '';
  return { en: rendered, ka: rendered };
}

/** Convert the language-specific API representation back into the UI shape. */
function hydrateWireFinding(row: any): AiFindingRecord | null {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string') return null;
  return {
    ...row,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
    relatedEntities: Array.isArray(row.relatedEntities) ? row.relatedEntities : [],
    roles: Array.isArray(row.roles) ? row.roles : [],
    cooldownHours: typeof row.cooldownHours === 'number' ? row.cooldownHours : 24,
    title: localizedWireText(row.title),
    observation: localizedWireText(row.observation),
    whyItMatters: localizedWireText(row.whyItMatters),
    possibleCauses: (Array.isArray(row.possibleCauses) ? row.possibleCauses : []).map(localizedWireText),
    recommendedActions: (Array.isArray(row.recommendedActions) ? row.recommendedActions : []).map((item: any) => ({
      ...item,
      label: localizedWireText(item?.label),
      requiresConfirmation: item?.requiresConfirmation !== false,
    })),
    evidence: (Array.isArray(row.evidence) ? row.evidence : []).map((item: any) => ({
      ...item,
      label: localizedWireText(item?.label),
      value: localizedWireText(item?.value),
    })),
    confidence: {
      level: row.confidence?.level || 'low',
      score: typeof row.confidence?.score === 'number' ? row.confidence.score : 0,
      reasons: (Array.isArray(row.confidence?.reasons) ? row.confidence.reasons : []).map(localizedWireText),
    },
    missingInformation: (Array.isArray(row.missingInformation) ? row.missingInformation : []).map(localizedWireText),
    requiresHumanConfirmation: row.requiresHumanConfirmation !== false,
    status: row.status || 'new',
    lastSeenAt: typeof row.lastSeenAt === 'string' ? row.lastSeenAt : row.createdAt,
    occurrences: typeof row.occurrences === 'number' ? row.occurrences : 1,
  } as AiFindingRecord;
}

/**
 * The intelligence centre. Deterministic findings are computed in the browser
 * from live state, so the page is useful instantly and offline; the server is
 * consulted only to persist review decisions, run model analysis, and answer
 * questions about the winery's own records.
 */
export function AiIntelligenceTab({
  lang,
  role,
  data,
  findings: providedFindings,
  aiConfig,
  canConfigure = false,
  canReview = false,
  onConfigSaved,
  focusFindingId,
  onFocusConsumed,
  onCreateTask,
  onSaveDraftActions,
  onNavigate,
  setToastMessage,
}: AiIntelligenceTabProps) {
  const isKa = lang === 'ka';
  const T = (en: string, ka: string) => (isKa ? ka : en);

  const [statuses, setStatuses] = useState<Record<string, AiFindingStatus>>({});
  const [feedback, setFeedback] = useState<Record<string, AiFeedbackVerdict>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [areaFilter, setAreaFilter] = useState<AiMonitoringArea | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<AiSeverity | 'all'>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [storedRecords, setStoredRecords] = useState<AiFindingRecord[]>([]);
  /** `findingId#index` for checks already turned into tasks, so none is created twice. */
  const [createdActions, setCreatedActions] = useState<string[]>([]);
  const [stagedActions, setStagedActions] = useState<string[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [highlightedFindingId, setHighlightedFindingId] = useState<string | null>(null);

  const config = useMemo(() => resolveAiConfig(aiConfig), [aiConfig]);

  // Rules run locally on every state change. This is the cheap path and it is
  // the same code the server and the scheduled job run. The shell usually
  // supplies the evaluation so it happens once per state change, not per screen.
  const ruleFindings = useMemo(
    () => providedFindings ?? evaluateRules({ ...data, lang, config: aiConfig }).findings,
    [providedFindings, data, lang, aiConfig],
  );

  const records: AiFindingRecord[] = useMemo(() => {
    const now = new Date().toISOString();
    const storedById = new Map(storedRecords.map((record) => [record.id, record]));
    const currentIds = new Set(ruleFindings.map((finding) => finding.id));
    const current = ruleFindings.map((finding) => {
      const stored = storedById.get(finding.id);
      return {
        ...stored,
        ...finding,
        // Local prose wins because it reflects state the server has not
        // evaluated yet — but severity must not. This pass runs on client state
        // that is already redacted for the role, so it can be *less* informed
        // than the server's (a role without bottling cannot see the packaging
        // draw-down behind a depletion forecast). Showing a calmer severity than
        // the one the user was notified about would contradict their own inbox.
        severity: stored && severityRank(stored.severity) > severityRank(finding.severity)
          ? stored.severity
          : finding.severity,
        status: statuses[finding.id] || stored?.status || 'new',
        statusChangedAt: stored?.statusChangedAt,
        statusChangedBy: stored?.statusChangedBy,
        lastSeenAt: stored?.lastSeenAt || now,
        occurrences: stored?.occurrences || 1,
        feedback: feedback[finding.id]
          ? {
            ...(stored?.feedback || {}),
            verdict: feedback[finding.id],
            submittedAt: stored?.feedback?.submittedAt || now,
          }
          : stored?.feedback,
        linkedTaskId: stored?.linkedTaskId,
        resolutionNote: stored?.resolutionNote,
        lastModified: stored?.lastModified,
      } as AiFindingRecord;
    });
    const historicalAndModel = storedRecords
      .filter((record) => !currentIds.has(record.id))
      .map((record): AiFindingRecord => ({
        ...record,
        status: statuses[record.id] || record.status,
        feedback: feedback[record.id]
          ? {
            ...(record.feedback || {}),
            verdict: feedback[record.id],
            submittedAt: record.feedback?.submittedAt || now,
          }
          : record.feedback,
      }));
    return filterFindingsForRole([...current, ...historicalAndModel], role);
  }, [ruleFindings, storedRecords, role, statuses, feedback]);

  // Pull persisted review state so a dismissal survives a reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/ai/findings?lang=${lang}`, { credentials: 'include' });
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled || !Array.isArray(payload.findings)) return;
        const nextStatuses: Record<string, AiFindingStatus> = {};
        const nextFeedback: Record<string, AiFeedbackVerdict> = {};
        const hydrated: AiFindingRecord[] = [];
        for (const stored of payload.findings) {
          if (stored?.id && stored.status) nextStatuses[stored.id] = stored.status;
          if (stored?.id && stored.feedback?.verdict) nextFeedback[stored.id] = stored.feedback.verdict;
          const record = hydrateWireFinding(stored);
          if (record) hydrated.push(record);
        }
        setStoredRecords(hydrated);
        setStatuses(nextStatuses);
        setFeedback(nextFeedback);
      } catch {
        // A findings feed that is unreachable must not blank the page. The
        // locally computed findings still stand on their own, but they are not
        // necessarily complete: this role's client state is redacted, so a
        // detector that reads across modules may be working with less than the
        // server had. Review lifecycle and severity escalations are unavailable
        // until the feed returns.
      }
    })();
    return () => { cancelled = true; };
  }, [lang]);

  const persistReview = useCallback(async (
    finding: AiFinding,
    patch: { status?: AiFindingStatus; feedback?: { verdict: AiFeedbackVerdict } },
  ) => {
    try {
      // Ensure the finding exists server-side before patching its lifecycle.
      await fetch('/api/ai/evaluate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang }),
      });
      const response = await fetch(`/api/ai/findings/${encodeURIComponent(finding.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, lang }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      const updated = hydrateWireFinding(payload?.finding);
      if (updated) {
        setStoredRecords((current) => [
          ...current.filter((record) => record.id !== updated.id),
          updated,
        ]);
      }
      window.dispatchEvent(new Event('vinos:ai-findings-changed'));
      setSyncError(null);
    } catch {
      setSyncError(isKa
        ? 'თქვენი გადაწყვეტილება აქ გამოყენებულია, მაგრამ სერვერზე ვერ შეინახა.'
        : 'Your review was applied here but could not be saved to the server.');
    }
  }, [lang, isKa]);

  const updateStatus = (finding: AiFinding, status: AiFindingStatus) => {
    setStatuses((current) => ({ ...current, [finding.id]: status }));
    void persistReview(finding, { status });
  };

  /**
   * Turns one recommended check into its own task.
   *
   * The description carries the provenance a person needs to act safely: what
   * was observed, how confident the layer is, and — critically — what it could
   * not confirm. A task that says "re-analyse SO₂" without "YAN was never
   * measured" invites someone to treat an inference as a measurement.
   */
  const createTaskForAction = (
    record: AiFindingRecord,
    item: AiFinding['recommendedActions'][number],
    actionKey: string,
  ) => {
    if (!onCreateTask) return;
    const lines = [
      localize(record.observation, lang),
      '',
      `${T('From AI finding', 'AI დასკვნიდან')}: ${localize(record.title, lang)}`,
      `${localize(SECTION_LABELS.confidence, lang)}: `
      + `${localize(CONFIDENCE_LABELS[record.confidence.level], lang)}`
      + ` · ${Math.round(record.confidence.score * 100)}%`,
    ];
    if (record.missingInformation.length > 0) {
      lines.push(
        '',
        `${localize(SECTION_LABELS.missingInformation, lang)}:`,
        ...record.missingInformation.map((entry) => `- ${localize(entry, lang)}`),
      );
    }

    onCreateTask(
      localize(item.label, lang),
      taskPriorityFor(record.severity),
      new Date().toISOString().slice(0, 10),
      lines.join('\n'),
    );
    setCreatedActions((current) => [...current, actionKey]);
    // Acting on a recommendation is acceptance. Only patch when it is a change,
    // so turning three checks into three tasks is not three identical writes.
    if ((statuses[record.id] || record.status) !== 'accepted') {
      updateStatus(record, 'accepted');
    }
    setToastMessage?.(T('Task created from this check.', 'ამ შემოწმებიდან დავალება შეიქმნა.'));
  };

  const stageDraftForAction = (
    record: AiFindingRecord,
    item: AiFinding['recommendedActions'][number],
    actionIndex: number,
    actionKey: string,
  ) => {
    if (!onSaveDraftActions) return;
    const draft = draftActionFromFindingRecommendation(record, item, {
      lang,
      actionIndex,
    });
    onSaveDraftActions([draft], new Date().toISOString().slice(0, 10));
    setStagedActions((current) => (
      current.includes(actionKey) ? current : [...current, actionKey]
    ));
    if ((statuses[record.id] || record.status) !== 'accepted') {
      updateStatus(record, 'accepted');
    }
    setToastMessage?.(T(
      'Review-only draft added to the AI action queue.',
      'AI ქმედებების რიგში განსახილველი სამუშაო ვერსია დაემატა.',
    ));
  };

  const submitFeedback = (finding: AiFinding, verdict: AiFeedbackVerdict) => {
    setFeedback((current) => ({ ...current, [finding.id]: verdict }));
    void persistReview(finding, { feedback: { verdict } });
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    setSyncError(null);
    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang, maxAnalyses: 2 }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || String(response.status));
      const produced = Array.isArray(payload.findings) ? payload.findings : [];
      const hydrated: AiFindingRecord[] = produced
        .map((row: any) => hydrateWireFinding(row))
        .filter((record: AiFindingRecord | null): record is AiFindingRecord => record !== null);
      setStoredRecords((current) => {
        const producedIds = new Set(hydrated.map((record) => record.id));
        return [...current.filter((record) => !producedIds.has(record.id)), ...hydrated];
      });
      window.dispatchEvent(new Event('vinos:ai-findings-changed'));
      // Reporting "nothing needs analysis" when the layer actually discarded
      // findings would be the exact dishonesty these guards exist to prevent.
      const discarded = Number(payload.rejectedCount) || 0;
      setToastMessage?.(
        payload.modelFindings > 0
          ? T(
            `AI analysis added ${payload.modelFindings} interpretation(s).`,
            `AI ანალიზმა დაამატა ${payload.modelFindings} ინტერპრეტაცია.`,
          )
          : discarded > 0
            ? T(
              `AI analysis produced ${discarded} interpretation(s) that failed grounding checks and were discarded.`,
              `AI ანალიზმა შექმნა ${discarded} ინტერპრეტაცია, რომლებმაც დასაბუთების შემოწმება ვერ გაიარა და გაუქმდა.`,
            )
            : T(
              'No situation currently needs deeper analysis.',
              'ამჟამად არცერთი სიტუაცია არ საჭიროებს ღრმა ანალიზს.',
            ),
      );
    } catch (error: any) {
      setSyncError(error?.message || T('Analysis failed.', 'ანალიზი ვერ შესრულდა.'));
    } finally {
      setAnalyzing(false);
    }
  };

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    setAsking(true);
    setAskError(null);
    try {
      const response = await fetch('/api/ai/ask', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, lang }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || String(response.status));
      setAskResult(payload);
    } catch (error: any) {
      setAskError(error?.message || T('Could not answer that question.', 'ამ კითხვაზე პასუხის გაცემა ვერ მოხერხდა.'));
      setAskResult(null);
    } finally {
      setAsking(false);
    }
  };

  const briefing = useMemo(
    () => buildDailyBriefing(records, { role, minimumSeverity: config.minimumSeverity }),
    [records, role, config.minimumSeverity],
  );

  const openRecords = records.filter((record) => record.status === 'new' || record.status === 'reviewed' || record.status === 'accepted');
  const closedRecords = records.filter((record) => !openRecords.includes(record));

  const visible = (showResolved ? closedRecords : openRecords)
    .filter((record) => areaFilter === 'all' || record.area === areaFilter)
    .filter((record) => severityFilter === 'all' || record.severity === severityFilter)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  useEffect(() => {
    if (!focusFindingId || !records.some((record) => record.id === focusFindingId)) return;
    setShowResolved(false);
    setAreaFilter('all');
    setSeverityFilter('all');
    setExpanded((current) => ({ ...current, [focusFindingId]: true }));
    setHighlightedFindingId(focusFindingId);

    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`ai-finding-${focusFindingId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      onFocusConsumed?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusFindingId, records, onFocusConsumed]);

  useEffect(() => {
    if (!highlightedFindingId) return;
    const timeout = window.setTimeout(() => setHighlightedFindingId(null), 2_500);
    return () => window.clearTimeout(timeout);
  }, [highlightedFindingId]);

  const predicted = openRecords.filter((record) =>
    record.evidence.some((item) => item.kind === 'prediction'));

  const statusTone = briefing.status === 'critical'
    ? 'border-rose-200 bg-rose-50'
    : briefing.status === 'attention'
      ? 'border-amber-200 bg-amber-50'
      : 'border-emerald-200 bg-emerald-50';

  const statusLabel = briefing.status === 'critical'
    ? T('Critical', 'კრიტიკული')
    : briefing.status === 'attention'
      ? T('Attention required', 'საჭიროებს ყურადღებას')
      : T('Normal', 'ნორმალური');

  return (
    <div className="space-y-6 animate-fade-in text-stone-800">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-[#e8dfd5] pb-4 gap-3">
        <div>
          <h3 className="text-lg font-serif font-black text-[#4e0e15] flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-[#801323]" />
            {T('Winery Intelligence', 'მარნის ინტელექტი')}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {canReview && (
            <button
              type="button"
              onClick={runAnalysis}
              disabled={analyzing || !config.modelAnalysisEnabled}
              className="inline-flex items-center gap-2 rounded-lg border border-[#801323] bg-[#801323] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {T('Deep analysis', 'ღრმა ანალიზი')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSettings((open) => !open)}
            className="inline-flex items-center gap-2 rounded-lg border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-semibold text-stone-600"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {T('Settings', 'პარამეტრები')}
          </button>
        </div>
      </div>

      {syncError && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
          {syncError}
        </div>
      )}

      {/* Status + briefing */}
      <div className={`rounded-xl border ${statusTone} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase font-mono font-bold text-stone-500">
              {localize(briefing.greeting, lang)} · {briefing.date}
            </p>
            <h4 className="font-serif text-base font-bold text-[#4e0e15]">{localize(briefing.headline, lang)}</h4>
          </div>
          <span className="rounded-full border border-white/60 bg-white/70 px-3 py-1 text-[10px] font-mono font-bold uppercase text-stone-700">
            {statusLabel}
          </span>
        </div>

        {briefing.sections.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {briefing.sections.map((section) => (
              <div key={section.key} className="rounded-lg border border-white/70 bg-white/70 p-3">
                <p className="text-[10px] uppercase font-mono font-bold text-stone-500">
                  {localize(section.title, lang)}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {section.findings.map((finding) => (
                    <li key={finding.id} className="flex items-start gap-1.5 text-[11px] text-stone-700">
                      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_STYLES[finding.severity].dot}`} />
                      <span>{localize(finding.title, lang)}</span>
                    </li>
                  ))}
                </ul>
                {section.overflow > 0 && (
                  <p className="mt-1 text-[10px] text-stone-500">
                    {T(`+${section.overflow} more`, `+${section.overflow} სხვა`)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {briefing.suppressedCount > 0 && (
          <p className="mt-3 text-[10px] text-stone-500">
            {T(
              `${briefing.suppressedCount} lower-priority observation(s) hidden by your notification threshold.`,
              `${briefing.suppressedCount} დაბალი პრიორიტეტის დაკვირვება დამალულია შეტყობინებების ზღვრის მიხედვით.`,
            )}
          </p>
        )}
      </div>

      {/* Ask my winery */}
      <div className="rounded-xl border border-[#e8dfd5] bg-white p-5">
        <h4 className="flex items-center gap-2 font-serif text-sm font-bold text-[#4e0e15]">
          <MessageSquare className="h-4 w-4 text-[#801323]" />
          {T('Ask my winery', 'ჰკითხე ჩემს მარანს')}
        </h4>
        <p className="mt-1 text-[11px] text-stone-500">
          {T(
            'Questions are answered from your own records. Nothing is invented — if there is no data, the answer says so.',
            'პასუხები მზადდება თქვენივე ჩანაწერებიდან. არაფერი გამოგონილი არ არის — თუ მონაცემი არ არსებობს, პასუხი ამას პირდაპირ იტყვის.',
          )}
        </p>
        <form onSubmit={ask} className="mt-3 flex gap-2">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={T('Which fermentations are currently at risk?', 'რომელი დუღილებია ამჟამად რისკის ქვეშ?')}
            className="w-full rounded-lg border border-[#e8dfd5] bg-white px-3 py-2 text-xs text-stone-800 outline-none focus:outline-[#801323]"
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#801323] bg-white px-3 py-2 text-xs font-semibold text-[#801323] disabled:opacity-50"
          >
            {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {T('Ask', 'კითხვა')}
          </button>
        </form>

        {askError && <p className="mt-2 text-[11px] font-semibold text-rose-700">{askError}</p>}

        {askResult && (
          <div className="mt-3 space-y-3">
            <p className={`whitespace-pre-wrap rounded-lg p-3 text-xs leading-relaxed ${
              askResult.needsClarification
                ? 'border border-amber-200 bg-amber-50 text-amber-900'
                : 'bg-stone-50 text-stone-700'
            }`}>
              {askResult.answer}
            </p>
            {askResult.needsClarification && (
              <p className="text-[10px] text-amber-700">
                {T(
                  'Rephrase with the lot, block or material you mean and ask again.',
                  'დააზუსტეთ პარტია, ნაკვეთი ან მასალა და კვლავ იკითხეთ.',
                )}
              </p>
            )}
            {askResult.answeredFromQuestion === false && !askResult.needsClarification && (
              <p className="text-[10px] text-amber-700">
                {T(
                  'This is the winery\'s overall position, not an answer to your question.',
                  'ეს მარნის საერთო მდგომარეობაა და არა პასუხი თქვენს კითხვაზე.',
                )}
              </p>
            )}
            {askResult.modelUnavailableReason === 'budget_exhausted'
              && askResult.answeredFromQuestion !== false && (
              <p className="text-[10px] text-amber-700">
                {T(
                  'The daily model budget is exhausted; this answer uses the deterministic query summary.',
                  'მოდელის დღიური ლიმიტი ამოიწურა; პასუხი დეტერმინისტული მოთხოვნის შეჯამებას იყენებს.',
                )}
              </p>
            )}
            {askResult.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-[#e8dfd5] text-[9px] uppercase font-mono text-stone-500">
                      {askResult.columns.map((column) => <th key={column} className="py-1.5 pr-3">{column}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {askResult.rows.map((row, index) => (
                      <tr key={index} className="border-b border-stone-100 text-stone-700">
                        {askResult.columns.map((column) => (
                          <td key={column} className="py-1.5 pr-3">{row[column] ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {askResult.truncated && (
                  <p className="mt-1 text-[10px] text-stone-500">
                    {T('Results were truncated.', 'შედეგები შემოკლებულია.')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Predicted risks */}
      {predicted.length > 0 && (
        <div className="rounded-xl border border-[#e8dfd5] bg-white p-5">
          <h4 className="flex items-center gap-2 font-serif text-sm font-bold text-[#4e0e15]">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            {T('Predicted risks', 'პროგნოზირებული რისკები')}
          </h4>
          <ul className="mt-2 space-y-1.5">
            {predicted.slice(0, 5).map((record) => {
              const prediction = record.evidence.find((item) => item.kind === 'prediction');
              return (
                <li key={`pred-${record.id}`} className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="text-stone-700">{localize(record.title, lang)}</span>
                  {prediction && (
                    <span className="shrink-0 font-mono text-[10px] text-stone-500">
                      {localize(prediction.label, lang)}: {localize(prediction.value, lang)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={areaFilter}
          onChange={(event) => setAreaFilter(event.target.value as AiMonitoringArea | 'all')}
          aria-label={T('Filter by area', 'ფილტრი სფეროს მიხედვით')}
          className="rounded-lg border border-[#e8dfd5] bg-white px-2.5 py-1.5 text-[11px] text-stone-700 outline-none"
        >
          <option value="all">{T('All areas', 'ყველა სფერო')}</option>
          {AREAS.map((area) => (
            <option key={area} value={area}>{localize(AREA_LABELS[area], lang)}</option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={(event) => setSeverityFilter(event.target.value as AiSeverity | 'all')}
          aria-label={T('Filter by severity', 'ფილტრი სიმძიმის მიხედვით')}
          className="rounded-lg border border-[#e8dfd5] bg-white px-2.5 py-1.5 text-[11px] text-stone-700 outline-none"
        >
          <option value="all">{T('All severities', 'ყველა დონე')}</option>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>{localize(SEVERITY_LABELS[severity], lang)}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowResolved((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#e8dfd5] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-stone-600"
        >
          <RefreshCw className="h-3 w-3" />
          {showResolved
            ? T(`Open (${openRecords.length})`, `ღია (${openRecords.length})`)
            : T(`Reviewed (${closedRecords.length})`, `განხილული (${closedRecords.length})`)}
        </button>
      </div>

      {/* Findings */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <ShieldCheck className="mx-auto h-6 w-6 text-emerald-600" />
          <p className="mt-2 text-sm font-serif font-bold text-emerald-900">
            {T('Nothing needs your attention here.', 'აქ თქვენს ყურადღებას არაფერი საჭიროებს.')}
          </p>
          <p className="mt-1 text-[11px] text-emerald-800">
            {T(
              'Monitoring ran against your current records and found no issue at this severity.',
              'მონიტორინგმა შეამოწმა თქვენი მიმდინარე ჩანაწერები და ამ დონეზე პრობლემა ვერ აღმოაჩინა.',
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((record) => {
            const isOpen = expanded[record.id] ?? false;
            const style = SEVERITY_STYLES[record.severity];
            return (
              <article
                id={`ai-finding-${record.id}`}
                key={record.id}
                className={`overflow-hidden rounded-xl border bg-white transition-shadow ${
                  highlightedFindingId === record.id
                    ? 'border-violet-400 shadow-[0_0_0_3px_rgba(139,92,246,0.18)]'
                    : 'border-[#e8dfd5]'
                }`}
              >
                <div className={`h-1 w-full ${style.bar}`} />
                <div className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase ${style.chip}`}>
                          {localize(SEVERITY_LABELS[record.severity], lang)}
                        </span>
                        <span className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[9px] font-mono uppercase text-stone-600">
                          {localize(AREA_LABELS[record.area], lang)}
                        </span>
                        {/* The agent chip only earns its space when it says
                            something the area chip does not. */}
                        {localize(AGENT_LABELS[record.agent], lang) !== localize(AREA_LABELS[record.area], lang) && (
                          <span className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[9px] font-mono uppercase text-stone-600">
                            {localize(AGENT_LABELS[record.agent], lang)}
                          </span>
                        )}
                        {record.source !== 'rule' && (
                          <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-mono uppercase text-violet-700">
                            {T('AI analysis', 'AI ანალიზი')}
                          </span>
                        )}
                      </div>
                      <h4 className="mt-1.5 font-serif text-sm font-bold text-[#4e0e15]">
                        {localize(record.title, lang)}
                      </h4>
                      <p className="mt-1 text-[11px] leading-relaxed text-stone-600">
                        {localize(record.observation, lang)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpanded((current) => ({ ...current, [record.id]: !isOpen }))}
                      aria-expanded={isOpen}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#e8dfd5] px-2 py-1 text-[10px] font-semibold text-stone-600"
                    >
                      {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {T('Why', 'რატომ')}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="mt-3 space-y-3 border-t border-stone-100 pt-3 text-[11px] text-stone-600">
                      <Section title={localize(SECTION_LABELS.whyItMatters, lang)}>
                        <p className="leading-relaxed">{localize(record.whyItMatters, lang)}</p>
                      </Section>

                      {record.possibleCauses.length > 0 && (
                        <Section title={localize(SECTION_LABELS.possibleCauses, lang)}>
                          <ul className="list-disc space-y-0.5 pl-4">
                            {record.possibleCauses.map((cause, index) => (
                              <li key={index}>{localize(cause, lang)}</li>
                            ))}
                          </ul>
                        </Section>
                      )}

                      {record.recommendedActions.length > 0 && (
                        <Section title={localize(SECTION_LABELS.recommendedActions, lang)}>
                          <ol className="list-decimal space-y-1 pl-4">
                            {record.recommendedActions.map((item, index) => {
                              const actionKey = `${record.id}#${index}`;
                              const alreadyCreated = createdActions.includes(actionKey);
                              const alreadyStaged = stagedActions.includes(actionKey);
                              return (
                                // Keep the <li> a list-item so the ordinal marker
                                // survives; the flex row lives one level in.
                                <li key={index}>
                                  <span className="flex flex-wrap items-baseline gap-2">
                                    <span>{localize(item.label, lang)}</span>
                                    {/* Each check becomes its own task. Collapsing
                                        them into one would force a single assignee
                                        on work that belongs to different people. */}
                                    {onCreateTask && (
                                      alreadyCreated ? (
                                        <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
                                          <CheckCircle2 className="h-2.5 w-2.5" />
                                          {T('Task created', 'დავალება შექმნილია')}
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => createTaskForAction(record, item, actionKey)}
                                          className="inline-flex items-center gap-1 rounded border border-[#801323] px-1.5 py-0.5 text-[9px] font-semibold text-[#801323]"
                                        >
                                          <ClipboardList className="h-2.5 w-2.5" />
                                          {T('Add task', 'დავალების დამატება')}
                                        </button>
                                      )
                                    )}
                                    {onSaveDraftActions && item.kind !== 'create_task' && (
                                      alreadyStaged ? (
                                        <span className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                                          <CheckCircle2 className="h-2.5 w-2.5" />
                                          {T('Draft staged', 'ვერსია მომზადებულია')}
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => stageDraftForAction(record, item, index, actionKey)}
                                          className="inline-flex items-center gap-1 rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-800"
                                        >
                                          <ClipboardList className="h-2.5 w-2.5" />
                                          {T('Stage typed draft', 'სამუშაო ვერსიის მომზადება')}
                                        </button>
                                      )
                                    )}
                                    {item.targetModule && onNavigate && (
                                      <button
                                        type="button"
                                        onClick={() => onNavigate(item.targetModule!)}
                                        className="rounded border border-[#e8dfd5] px-1.5 py-0.5 text-[9px] font-semibold text-[#801323]"
                                      >
                                        {T('Open', 'გახსნა')}
                                      </button>
                                    )}
                                  </span>
                                </li>
                              );
                            })}
                          </ol>
                        </Section>
                      )}

                      {record.evidence.length > 0 && (
                        <Section title={localize(SECTION_LABELS.evidence, lang)}>
                          <ul className="space-y-0.5">
                            {record.evidence.map((item, index) => (
                              <li key={index} className="flex flex-wrap items-baseline gap-1.5">
                                <span className="rounded bg-stone-100 px-1 py-0.5 text-[8px] font-mono uppercase text-stone-500">
                                  {localize(EVIDENCE_KIND_LABELS[item.kind], lang)}
                                </span>
                                <span className="font-semibold text-stone-700">{localize(item.label, lang)}:</span>
                                <span>{localize(item.value, lang)}</span>
                                {item.sourceRef && (
                                  <span className="font-mono text-[9px] text-stone-400">{item.sourceRef}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </Section>
                      )}

                      <Section title={localize(SECTION_LABELS.confidence, lang)}>
                        <p className="font-semibold text-stone-700">
                          {localize(CONFIDENCE_LABELS[record.confidence.level], lang)}
                          {' · '}
                          {Math.round(record.confidence.score * 100)}%
                        </p>
                        <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                          {record.confidence.reasons.map((reason, index) => (
                            <li key={index}>{localize(reason, lang)}</li>
                          ))}
                        </ul>
                      </Section>

                      {record.missingInformation.length > 0 && (
                        <Section title={localize(SECTION_LABELS.missingInformation, lang)}>
                          <ul className="list-disc space-y-0.5 pl-4 text-amber-800">
                            {record.missingInformation.map((item, index) => (
                              <li key={index}>{localize(item, lang)}</li>
                            ))}
                          </ul>
                        </Section>
                      )}
                    </div>
                  )}

                  {/* Review controls */}
                  {canReview && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-stone-100 pt-3">
                    {onCreateTask && (
                      <button
                        type="button"
                        onClick={() => {
                          // The whole-finding path stays for "just track this".
                          // Per-check tasks live in the expanded view, where the
                          // user can see what each one actually asks for.
                          onCreateTask(
                            localize(record.title, lang),
                            taskPriorityFor(record.severity),
                            new Date().toISOString().slice(0, 10),
                            `${localize(record.observation, lang)}\n\n${record.recommendedActions.map((item) => `- ${localize(item.label, lang)}`).join('\n')}`,
                          );
                          updateStatus(record, 'accepted');
                          setToastMessage?.(T('Task drafted from this finding.', 'ამ დასკვნიდან დავალება მომზადდა.'));
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#801323] px-2.5 py-1 text-[10px] font-semibold text-[#801323]"
                      >
                        <ClipboardList className="h-3 w-3" />
                        {T('Create task', 'დავალების შექმნა')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => updateStatus(record, 'resolved')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-2.5 py-1 text-[10px] font-semibold text-emerald-700"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {T('Resolved', 'მოგვარებულია')}
                    </button>
                    <button
                      type="button"
                      onClick={() => updateStatus(record, 'dismissed')}
                      className="rounded-lg border border-stone-200 px-2.5 py-1 text-[10px] font-semibold text-stone-500"
                    >
                      {T('Dismiss', 'დახურვა')}
                    </button>

                    <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
                      <span className="mr-1 text-[9px] font-semibold text-stone-400">
                        {T('Was this useful?', 'რამდენად გამოგადგათ?')}
                      </span>
                      <button
                        type="button"
                        aria-pressed={feedback[record.id] === 'helpful'}
                        onClick={() => submitFeedback(record, 'helpful')}
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-semibold ${feedback[record.id] === 'helpful' ? 'bg-emerald-100 text-emerald-700' : 'text-stone-400 hover:bg-stone-100'}`}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        {T('Helpful', 'სასარგებლო')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={feedback[record.id] === 'not_helpful'}
                        onClick={() => submitFeedback(record, 'not_helpful')}
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-semibold ${feedback[record.id] === 'not_helpful' ? 'bg-amber-100 text-amber-800' : 'text-stone-400 hover:bg-stone-100'}`}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        {T('Not helpful', 'არასასარგებლო')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={feedback[record.id] === 'incorrect'}
                        onClick={() => submitFeedback(record, 'incorrect')}
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-semibold ${feedback[record.id] === 'incorrect' ? 'bg-rose-100 text-rose-700' : 'text-stone-400 hover:bg-stone-100'}`}
                      >
                        <CircleX className="h-3.5 w-3.5" />
                        {T('Incorrect', 'არასწორია')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={feedback[record.id] === 'already_handled'}
                        onClick={() => submitFeedback(record, 'already_handled')}
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-semibold ${feedback[record.id] === 'already_handled' ? 'bg-sky-100 text-sky-700' : 'text-stone-400 hover:bg-stone-100'}`}
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        {T('Already handled', 'უკვე მოგვარებულია')}
                      </button>
                    </div>
                  </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <AiSettingsPanel
          lang={lang}
          config={config}
          canConfigure={canConfigure}
          onConfigSaved={(savedConfig) => onConfigSaved?.(savedConfig)}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase font-mono font-bold text-stone-500">{title}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function AiSettingsPanel({
  lang,
  config,
  canConfigure,
  onConfigSaved,
  onClose,
}: {
  lang: Language;
  config: ReturnType<typeof resolveAiConfig>;
  canConfigure: boolean;
  onConfigSaved: (config: ReturnType<typeof resolveAiConfig>) => void;
  onClose: () => void;
}) {
  const isKa = lang === 'ka';
  const T = (en: string, ka: string) => (isKa ? ka : en);
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationDraft, setNotificationDraft] = useState<AiNotificationPreferenceWire>({
    minimumSeverity: 'warning',
    inAppMinimumSeverity: 'info',
  });
  const [loadingPreference, setLoadingPreference] = useState(true);
  const [calibration, setCalibration] = useState<AiCalibrationWire | null>(null);

  useEffect(() => {
    if (!canConfigure) return undefined;
    let active = true;
    fetch(`/api/ai/calibration?lang=${lang}`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((payload) => {
        if (active) setCalibration(payload as AiCalibrationWire);
      })
      // A missing calibration read is not worth blocking the settings panel.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [canConfigure, lang]);

  useEffect(() => {
    let active = true;
    setLoadingPreference(true);
    fetch('/api/ai/notification-preferences', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((payload) => {
        if (!active) return;
        setNotificationDraft({
          minimumSeverity: SEVERITIES.includes(payload?.preference?.minimumSeverity)
            ? payload.preference.minimumSeverity
            : 'warning',
          inAppMinimumSeverity: SEVERITIES.includes(payload?.preference?.inAppMinimumSeverity)
            ? payload.preference.inAppMinimumSeverity
            : 'info',
        });
      })
      .catch(() => {
        if (active) {
          setError(isKa
            ? 'შეტყობინებების პარამეტრები ვერ ჩაიტვირთა.'
            : 'Alert preferences could not be loaded.');
        }
      })
      .finally(() => {
        if (active) setLoadingPreference(false);
      });
    return () => {
      active = false;
    };
  }, [isKa]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const preferenceResponse = await fetch('/api/ai/notification-preferences', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notificationDraft),
      });
      const preferencePayload = await preferenceResponse.json().catch(() => ({}));
      if (!preferenceResponse.ok) {
        throw new Error(preferencePayload?.error || T('Alert preferences could not be saved.', 'შეტყობინებების პარამეტრები ვერ შეინახა.'));
      }
      let savedConfig = config;
      if (canConfigure) {
        const response = await fetch('/api/ai/config', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: draft, lang }),
        });
        if (!response.ok) throw new Error(T('Winery settings could not be saved.', 'მარნის პარამეტრები ვერ შეინახა.'));
        const payload = await response.json();
        savedConfig = resolveAiConfig(payload?.config);
      }
      if (canConfigure) {
        onConfigSaved(savedConfig);
      }
      window.dispatchEvent(new Event('vinos:ai-findings-changed'));
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error
        ? saveError.message
        : T('Settings could not be saved.', 'პარამეტრები ვერ შეინახა.'));
    } finally {
      setSaving(false);
    }
  };

  const targetFields: Array<{ key: keyof typeof draft.targets; label: string; step?: number }> = [
    { key: 'molecularSo2MinMgL', label: T('Molecular SO₂ floor (mg/L)', 'მოლეკულური SO₂-ის ზღვარი (მგ/ლ)'), step: 0.05 },
    { key: 'freeSo2MinMgL', label: T('Free SO₂ minimum (mg/L)', 'თავისუფალი SO₂ მინიმუმი (მგ/ლ)') },
    { key: 'freeSo2MaxMgL', label: T('Free SO₂ maximum (mg/L)', 'თავისუფალი SO₂ მაქსიმუმი (მგ/ლ)') },
    { key: 'maxVolatileAcidityGL', label: T('Volatile acidity ceiling (g/L)', 'აქროლადი მჟავიანობის ზღვარი (გ/ლ)'), step: 0.05 },
    { key: 'fermentationTempMinC', label: T('Fermentation temperature min (°C)', 'დუღილის ტემპერატურა მინ. (°C)') },
    { key: 'fermentationTempMaxC', label: T('Fermentation temperature max (°C)', 'დუღილის ტემპერატურა მაქს. (°C)') },
    { key: 'labAnalysisIntervalDays', label: T('Analysis interval (days)', 'ანალიზის ინტერვალი (დღე)') },
    { key: 'minStockCoverDays', label: T('Minimum stock cover (days)', 'მარაგის მინიმალური მარაგი (დღე)') },
    { key: 'harvestTargetBrix', label: T('Harvest target (°Brix)', 'რთველის სამიზნე (°Brix)'), step: 0.5 },
  ];

  return (
    <div className="rounded-xl border border-[#e8dfd5] bg-white p-5">
      <h4 className="font-serif text-sm font-bold text-[#4e0e15]">
        {T('Intelligence settings', 'ინტელექტის პარამეტრები')}
      </h4>
      <p className="mt-1 text-[11px] text-stone-500">
        {T(
          'Intelligence alert thresholds are personal to your account.',
          'ინტელექტის შეტყობინებების ზღვრები თქვენს ანგარიშზეა მორგებული.',
        )}
      </p>

      <div className="mt-4 rounded-lg border border-[#e8dfd5] bg-stone-50 p-3">
        <div className="max-w-xs">
          <label htmlFor="ai-in-app-min-severity" className="mb-1 block text-[10px] uppercase font-mono font-semibold text-stone-500">
            {T('My in-app minimum severity', 'აპის შეტყობინებების მინიმალური დონე')}
          </label>
          <select
            id="ai-in-app-min-severity"
            value={notificationDraft.inAppMinimumSeverity}
            disabled={loadingPreference}
            onChange={(event) => setNotificationDraft({
              ...notificationDraft,
              inAppMinimumSeverity: event.target.value as AiSeverity,
            })}
            className="w-full rounded-lg border border-[#e8dfd5] bg-white px-2.5 py-1.5 text-[11px] text-stone-700 disabled:opacity-50"
          >
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>{localize(SEVERITY_LABELS[severity], lang)}</option>
            ))}
          </select>
          <p className="mt-1 text-[9px] leading-relaxed text-stone-500">
            {T(
              'This can make your bell quieter, but cannot lower the winery-wide notification floor.',
              'ეს ზარის შეტყობინებებს შეამცირებს, თუმცა მარნის საერთო მინიმალურ დონეს ვერ დაწევს.',
            )}
          </p>
        </div>

        <div className="my-3 border-t border-stone-200" />
        <p className="text-[9.5px] leading-relaxed text-stone-500">
          {T(
            'Email and browser push are controlled from Profile Settings → Personal notifications.',
            'ელფოსტა და ბრაუზერის Push შეტყობინებები იმართება პროფილის პარამეტრებში → პირადი შეტყობინებები.',
          )}
        </p>
        <div className="mt-3 max-w-xs">
          <label htmlFor="ai-personal-min-severity" className="mb-1 block text-[10px] uppercase font-mono font-semibold text-stone-500">
            {T('My minimum external-alert severity', 'გარე შეტყობინებების მინიმალური დონე')}
          </label>
          <select
            id="ai-personal-min-severity"
            value={notificationDraft.minimumSeverity}
            disabled={loadingPreference}
            onChange={(event) => setNotificationDraft({
              ...notificationDraft,
              minimumSeverity: event.target.value as AiSeverity,
            })}
            className="w-full rounded-lg border border-[#e8dfd5] bg-white px-2.5 py-1.5 text-[11px] text-stone-700 disabled:opacity-50"
          >
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>{localize(SEVERITY_LABELS[severity], lang)}</option>
            ))}
          </select>
        </div>
      </div>

      {canConfigure && (
      <>
      <AiKnowledgeManager lang={lang} />

      <h5 className="mt-5 font-serif text-xs font-bold text-[#4e0e15]">
        {T('Winery-wide monitoring policy', 'მარნის მონიტორინგის საერთო პოლიტიკა')}
      </h5>
      <p className="mt-1 text-[10px] text-stone-500">
        {T(
          'These targets apply to the whole winery and require company-profile administration permission.',
          'ეს სამიზნეები მთელ მარანს ეხება და კომპანიის პროფილის მართვის უფლებას მოითხოვს.',
        )}
      </p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2.5">
          <label className="flex items-center gap-2 text-[11px] font-semibold text-stone-700">
            <input
              type="checkbox"
              checked={draft.monitoringEnabled}
              onChange={(event) => setDraft({ ...draft, monitoringEnabled: event.target.checked })}
            />
            {T('AI monitoring', 'AI მონიტორინგი')}
          </label>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-stone-700">
            <input
              type="checkbox"
              checked={draft.dailyBriefingEnabled}
              onChange={(event) => setDraft({ ...draft, dailyBriefingEnabled: event.target.checked })}
            />
            {T('Daily briefing', 'დღიური მიმოხილვა')}
          </label>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-stone-700">
            <input
              type="checkbox"
              checked={draft.modelAnalysisEnabled}
              onChange={(event) => setDraft({ ...draft, modelAnalysisEnabled: event.target.checked })}
            />
            {T('Model-based deep analysis', 'მოდელზე დაფუძნებული ღრმა ანალიზი')}
          </label>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-stone-700">
            <input
              type="checkbox"
              checked={draft.feedbackCalibrationEnabled}
              onChange={(event) => setDraft({
                ...draft,
                feedbackCalibrationEnabled: event.target.checked,
              })}
            />
            {T('Act on review feedback', 'გამოხმაურების გათვალისწინება')}
          </label>
          <p className="-mt-1 text-[10px] leading-snug text-stone-500">
            {T(
              'A detector your team keeps marking incorrect, unhelpful or already handled stops sending alerts and stops earning model calls. Its findings stay in the activity log, and a critical finding is never muted.',
              'დეტექტორი, რომელსაც თქვენი გუნდი მუდმივად აღნიშნავს როგორც არასწორს, უსარგებლოს ან უკვე დამუშავებულს, წყვეტს შეტყობინებების გაგზავნას და მოდელის გამოძახებას. მისი მიგნებები რჩება აქტივობის ჟურნალში, ხოლო კრიტიკული მიგნება არასოდეს ითიშება.',
            )}
          </p>
          {calibration && (
            <div className="rounded-lg border border-[#e8dfd5] bg-[#fbf8f4] px-2.5 py-2">
              {calibration.detectors.length === 0 ? (
                <p className="text-[10px] leading-snug text-stone-500">
                  {calibration.totalResponses === 0
                    ? T(
                      'No review feedback yet. Rate findings as you work through them and this list will fill in.',
                      'გამოხმაურება ჯერ არ არის. შეაფასეთ მიგნებები მუშაობისას და ეს სია შეივსება.',
                    )
                    : T(
                      `No detector has crossed a threshold yet (${calibration.totalResponses} verdicts so far).`,
                      `ჯერ არცერთ დეტექტორს არ გადაუჭარბებია ზღვარი (${calibration.totalResponses} შეფასება).`,
                    )}
                </p>
              ) : (
                <>
                  <p className="text-[10px] font-bold uppercase font-mono text-stone-500">
                    {draft.feedbackCalibrationEnabled
                      ? T('Currently muted', 'ამჟამად გათიშული')
                      : T('Would be muted', 'გაითიშებოდა')}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {calibration.detectors.map((detector) => (
                      <li key={`${detector.source}-${detector.area}-${detector.findingType}`} className="text-[10px] text-stone-600">
                        <span className="font-mono font-bold">{detector.findingType}</span>
                        {' — '}
                        {detector.reason === 'incorrect'
                          ? T(
                            `${Math.round(detector.incorrectRate * 100)}% marked incorrect`,
                            `${Math.round(detector.incorrectRate * 100)}% არასწორად აღნიშნული`,
                          )
                          : detector.reason === 'unhelpful'
                            ? T(
                              `${Math.round(detector.negativeRate * 100)}% marked unhelpful or incorrect`,
                              `${Math.round(detector.negativeRate * 100)}% უსარგებლო ან არასწორი`,
                            )
                            : T(
                              `${Math.round(detector.alreadyHandledRate * 100)}% already handled before the alert`,
                              `${Math.round(detector.alreadyHandledRate * 100)}% უკვე დამუშავებული შეტყობინებამდე`,
                            )}
                        {` (${detector.totalResponses}`}
                        {T(' verdicts)', ' შეფასება)')}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <div>
            <label htmlFor="ai-min-severity" className="mb-1 block text-[10px] uppercase font-mono font-semibold text-stone-500">
              {T('Notify from severity', 'შეტყობინება ამ დონიდან')}
            </label>
            <select
              id="ai-min-severity"
              value={draft.minimumSeverity}
              onChange={(event) => setDraft({ ...draft, minimumSeverity: event.target.value as AiSeverity })}
              className="w-full rounded-lg border border-[#e8dfd5] bg-white px-2.5 py-1.5 text-[11px] text-stone-700"
            >
              {SEVERITIES.slice().reverse().map((severity) => (
                <option key={severity} value={severity}>{localize(SEVERITY_LABELS[severity], lang)}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ai-daily-model-limit" className="mb-1 block text-[10px] uppercase font-mono font-semibold text-stone-500">
              {T('Daily model-call limit', 'მოდელის დღიური გამოძახებების ზღვარი')}
            </label>
            <input
              id="ai-daily-model-limit"
              type="number"
              min={0}
              max={10_000}
              step={1}
              value={draft.maxModelCallsPerDay}
              onChange={(event) => setDraft({
                ...draft,
                maxModelCallsPerDay: Math.max(0, Math.round(Number(event.target.value) || 0)),
              })}
              className="w-full rounded-lg border border-[#e8dfd5] bg-white px-2.5 py-1.5 text-[11px] text-stone-700"
            />
            <p className="mt-1 text-[9px] leading-relaxed text-stone-400">
              {T(
                'Shared across every server instance; Ask My Winery, the copilot and deep analysis all count.',
                'ზღვარი საერთოა ყველა სერვერისთვის; ითვლება „ჰკითხე ჩემს მარანს“, კოპილოტი და ღრმა ანალიზი.',
              )}
            </p>
          </div>

          <div>
            <label htmlFor="ai-daily-embedding-limit" className="mb-1 block text-[10px] uppercase font-mono font-semibold text-stone-500">
              {T('Daily embedding limit', 'ემბედინგების დღიური ზღვარი')}
            </label>
            <input
              id="ai-daily-embedding-limit"
              type="number"
              min={0}
              max={100_000}
              step={1}
              value={draft.maxEmbeddingCallsPerDay}
              onChange={(event) => setDraft({
                ...draft,
                maxEmbeddingCallsPerDay: Math.max(0, Math.round(Number(event.target.value) || 0)),
              })}
              className="w-full rounded-lg border border-[#e8dfd5] bg-white px-2.5 py-1.5 text-[11px] text-stone-700"
            />
            <p className="mt-1 text-[9px] leading-relaxed text-stone-400">
              {T(
                'Knowledge-base retrieval and ingestion. Counted apart from model calls because an embedding costs a fraction of an analysis.',
                'ცოდნის ბაზის ინდექსაცია და მოძიება. ითვლება ცალკე, რადგან ემბედინგი ანალიზზე გაცილებით იაფია.',
              )}
            </p>
          </div>

          <div>
            <p className="mb-1 text-[10px] uppercase font-mono font-semibold text-stone-500">
              {T('Monitored areas', 'მონიტორინგის სფეროები')}
            </p>
            <div className="grid grid-cols-2 gap-1">
              {AREAS.map((area) => (
                <label key={area} className="flex items-center gap-1.5 text-[11px] text-stone-700">
                  <input
                    type="checkbox"
                    checked={draft.areas[area]}
                    onChange={(event) => setDraft({ ...draft, areas: { ...draft.areas, [area]: event.target.checked } })}
                  />
                  {localize(AREA_LABELS[area], lang)}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {targetFields.map((field) => (
            <div key={String(field.key)}>
              <label htmlFor={`ai-target-${String(field.key)}`} className="mb-1 block text-[10px] font-mono font-semibold text-stone-500">
                {field.label}
              </label>
              <input
                id={`ai-target-${String(field.key)}`}
                type="number"
                step={field.step ?? 1}
                value={draft.targets[field.key]}
                onChange={(event) => setDraft({
                  ...draft,
                  targets: { ...draft.targets, [field.key]: Number(event.target.value) },
                })}
                className="w-full rounded-lg border border-[#e8dfd5] bg-white px-2 py-1.5 text-[11px] text-stone-800"
              />
            </div>
          ))}
        </div>
      </div>
      </>
      )}

      {error && <p className="mt-3 text-[11px] font-semibold text-rose-700">{error}</p>}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg border border-[#801323] bg-[#801323] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {T('Save settings', 'პარამეტრების შენახვა')}
        </button>
      </div>
    </div>
  );
}

function AiKnowledgeManager({ lang }: { lang: Language }) {
  const isKa = lang === 'ka';
  const T = (en: string, ka: string) => (isKa ? ka : en);
  const [documents, setDocuments] = useState<AiKnowledgeDocumentWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [embeddingId, setEmbeddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [content, setContent] = useState('');
  const [agent, setAgent] = useState<AiAgentKey | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/ai/knowledge', { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Knowledge could not be loaded.');
      setDocuments(Array.isArray(payload?.documents) ? payload.documents : []);
    } catch (loadError) {
      setError(loadError instanceof Error
        ? loadError.message
        : isKa ? 'ცოდნის ბაზა ვერ ჩაიტვირთა.' : 'Knowledge could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [isKa]);

  useEffect(() => {
    void load();
  }, [load]);

  const addDocument = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || content.trim().length < 80) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/ai/knowledge', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
          sourceLabel,
          sourceUrl,
          language: lang,
          ...(agent === 'all' ? {} : { agents: [agent] }),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Knowledge could not be saved.');
      setDocuments((current) => [payload.document, ...current]);
      setTitle('');
      setSourceLabel('');
      setSourceUrl('');
      setContent('');
      setNotice(payload.embeddingStatus === 'generated'
        ? T(
          'Reference added with semantic retrieval.',
          'საცნობარო მასალა სემანტიკური ძიებით დაემატა.',
        )
        : T(
          'Reference added with lexical retrieval; embeddings can be generated when model budget is available.',
          'საცნობარო მასალა ტექსტური ძიებით დაემატა; ემბედინგები მოდელის ლიმიტის ხელმისაწვდომობისას შეიქმნება.',
        ));
    } catch (saveError) {
      setError(saveError instanceof Error
        ? saveError.message
        : T('Knowledge could not be saved.', 'ცოდნის ჩანაწერი ვერ შეინახა.'));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (documentId: string) => {
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/ai/knowledge/${encodeURIComponent(documentId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Knowledge could not be archived.');
      setDocuments((current) => current.filter((document) => document.id !== documentId));
      setNotice(T(
        'Reference archived and removed from future retrieval.',
        'საცნობარო მასალა დაარქივდა და მომავალ ძიებაში აღარ გამოიყენება.',
      ));
    } catch (archiveError) {
      setError(archiveError instanceof Error
        ? archiveError.message
        : T('Knowledge could not be archived.', 'ცოდნის ჩანაწერი ვერ დაარქივდა.'));
    }
  };

  const generateEmbeddings = async (documentId: string) => {
    setEmbeddingId(documentId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/ai/knowledge/${encodeURIComponent(documentId)}/embed`,
        { method: 'POST', credentials: 'include' },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Embeddings could not be generated.');
      setDocuments((current) => current.map((document) => (
        document.id === documentId ? payload.document : document
      )));
      setNotice(T(
        'Semantic retrieval is ready for this reference.',
        'ამ წყაროსთვის სემანტიკური ძიება მზადაა.',
      ));
    } catch (embeddingError) {
      setError(embeddingError instanceof Error
        ? embeddingError.message
        : T('Embeddings could not be generated.', 'ემბედინგები ვერ შეიქმნა.'));
    } finally {
      setEmbeddingId(null);
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex items-start gap-2">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" />
        <div>
          <h5 className="font-serif text-xs font-bold text-[#4e0e15]">
            {T('Grounded knowledge base', 'დასაბუთებული ცოდნის ბაზა')}
          </h5>
          <p className="mt-0.5 text-[10px] leading-relaxed text-stone-600">
            {T(
              'Add winery protocols, approved technical guidance, or compliance references. Retrieved passages are cited as evidence and are never treated as instructions or current measurements.',
              'დაამატეთ მარნის პროტოკოლები, დამტკიცებული ტექნიკური მითითებები ან შესაბამისობის წყაროები. მოძიებული ნაწყვეტები მტკიცებულებად მიეთითება და არასოდეს ჩაითვლება ინსტრუქციად ან მიმდინარე გაზომვად.',
            )}
          </p>
        </div>
      </div>

      <form onSubmit={addDocument} className="mt-3 grid gap-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            placeholder={T('Reference title', 'წყაროს სათაური')}
            className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-[11px]"
          />
          <select
            value={agent}
            onChange={(event) => setAgent(event.target.value as AiAgentKey | 'all')}
            aria-label={T('Relevant agent', 'შესაბამისი აგენტი')}
            className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-[11px]"
          >
            <option value="all">{T('All specialists', 'ყველა სპეციალისტი')}</option>
            {(Object.keys(AGENT_LABELS) as AiAgentKey[]).map((key) => (
              <option key={key} value={key}>{localize(AGENT_LABELS[key], lang)}</option>
            ))}
          </select>
          <input
            value={sourceLabel}
            onChange={(event) => setSourceLabel(event.target.value)}
            maxLength={200}
            placeholder={T('Publisher or source label (optional)', 'გამომცემელი ან წყარო (არასავალდებულო)')}
            className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-[11px]"
          />
          <input
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://…"
            className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-[11px]"
          />
        </div>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={100_000}
          rows={6}
          placeholder={T(
            'Paste reviewed reference text (minimum 80 characters)…',
            'ჩასვით გადამოწმებული საცნობარო ტექსტი (მინიმუმ 80 სიმბოლო)…',
          )}
          className="resize-y rounded-lg border border-violet-200 bg-white px-3 py-2 text-[11px] leading-relaxed"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[9px] text-stone-500">
            {content.trim().length.toLocaleString()} / 100,000
          </span>
          <button
            type="submit"
            disabled={saving || title.trim().length < 3 || content.trim().length < 80}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            {T('Add reference', 'წყაროს დამატება')}
          </button>
        </div>
      </form>

      {error && <p role="alert" className="mt-2 text-[10px] font-semibold text-rose-700">{error}</p>}
      {notice && <p role="status" className="mt-2 text-[10px] font-semibold text-emerald-700">{notice}</p>}

      <div className="mt-3 space-y-2">
        {loading ? (
          <p className="text-[10px] text-stone-500">{T('Loading references…', 'წყაროები იტვირთება…')}</p>
        ) : documents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-violet-200 bg-white/70 px-3 py-3 text-[10px] text-stone-500">
            {T('No knowledge references have been added yet.', 'ცოდნის წყაროები ჯერ დამატებული არ არის.')}
          </p>
        ) : documents.map((document) => (
          <div key={document.id} className="rounded-lg border border-violet-100 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold text-stone-800">{document.title}</p>
                <p className="mt-0.5 text-[9px] text-stone-500">
                  {document.sourceLabel || T('Winery reference', 'მარნის წყარო')}
                  {' · '}
                  {document.embeddedChunkCount}/{document.chunkCount} {T('semantic chunks', 'სემანტიკური ნაწილი')}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {document.embeddedChunkCount < document.chunkCount && (
                  <button
                    type="button"
                    onClick={() => void generateEmbeddings(document.id)}
                    disabled={embeddingId !== null}
                    className="inline-flex items-center gap-1 rounded border border-violet-200 px-1.5 py-1 text-[9px] font-semibold text-violet-700 disabled:opacity-50"
                    title={T('Generate semantic index', 'სემანტიკური ინდექსის შექმნა')}
                  >
                    <RefreshCw className={`h-3 w-3 ${embeddingId === document.id ? 'animate-spin' : ''}`} />
                    {T('Index', 'ინდექსი')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void archive(document.id)}
                  className="rounded border border-stone-200 p-1 text-stone-500 hover:text-rose-700"
                  aria-label={T(`Archive ${document.title}`, `${document.title}-ის დაარქივება`)}
                  title={T('Archive reference', 'წყაროს დაარქივება')}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-stone-600">{document.preview}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(AiIntelligenceTab);
