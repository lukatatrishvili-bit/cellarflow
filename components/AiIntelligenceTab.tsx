import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
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
}

interface AiNotificationPreferenceWire {
  emailEnabled: boolean;
  minimumSeverity: AiSeverity;
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
  onCreateTask?: (title: string, priority: 'high' | 'medium' | 'low', dueDate: string, description: string) => void;
  onNavigate?: (targetModule: string) => void;
  setToastMessage?: (message: string | null) => void;
}

const SEVERITY_STYLES: Record<AiSeverity, { chip: string; bar: string; dot: string }> = {
  critical: { chip: 'bg-rose-50 text-rose-700 border-rose-200', bar: 'bg-rose-500', dot: 'bg-rose-500' },
  warning: { chip: 'bg-amber-50 text-amber-800 border-amber-200', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  attention: { chip: 'bg-sky-50 text-sky-700 border-sky-200', bar: 'bg-sky-500', dot: 'bg-sky-500' },
  info: { chip: 'bg-stone-100 text-stone-600 border-stone-200', bar: 'bg-stone-400', dot: 'bg-stone-400' },
};

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
export default function AiIntelligenceTab({
  lang,
  role,
  data,
  findings: providedFindings,
  aiConfig,
  canConfigure = false,
  canReview = false,
  onConfigSaved,
  onCreateTask,
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
  const [syncError, setSyncError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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
        // A findings feed that is unreachable must not blank the page: the
        // locally computed findings above are still correct and complete.
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
      setToastMessage?.(payload.modelFindings > 0
        ? T(`AI analysis added ${payload.modelFindings} interpretation(s).`, `AI ანალიზმა დაამატა ${payload.modelFindings} ინტერპრეტაცია.`)
        : T('No situation currently needs deeper analysis.', 'ამჟამად არცერთი სიტუაცია არ საჭიროებს ღრმა ანალიზს.'));
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
          <p className="text-xs text-slate-400">
            {T(
              'Continuous monitoring across vineyard, cellar, laboratory, inventory and compliance.',
              'უწყვეტი მონიტორინგი ვენახზე, მარანში, ლაბორატორიაში, მარაგებსა და შესაბამისობაზე.',
            )}
          </p>
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
            <p className="whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-xs leading-relaxed text-stone-700">
              {askResult.answer}
            </p>
            {askResult.modelUnavailableReason === 'budget_exhausted' && (
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
              <article key={record.id} className="overflow-hidden rounded-xl border border-[#e8dfd5] bg-white">
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
                            {record.recommendedActions.map((item, index) => (
                              // Keep the <li> a list-item so the ordinal marker
                              // survives; the flex row lives one level in.
                              <li key={index}>
                                <span className="flex flex-wrap items-baseline gap-2">
                                  <span>{localize(item.label, lang)}</span>
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
                            ))}
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
                          onCreateTask(
                            localize(record.title, lang),
                            record.severity === 'critical' ? 'high' : record.severity === 'warning' ? 'medium' : 'low',
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

                    <span className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={T('Helpful', 'სასარგებლო')}
                        onClick={() => submitFeedback(record, 'helpful')}
                        className={`rounded p-1 ${feedback[record.id] === 'helpful' ? 'bg-emerald-100 text-emerald-700' : 'text-stone-400'}`}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={T('Not helpful', 'უსარგებლო')}
                        onClick={() => submitFeedback(record, 'not_helpful')}
                        className={`rounded p-1 ${feedback[record.id] === 'not_helpful' ? 'bg-rose-100 text-rose-700' : 'text-stone-400'}`}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </button>
                    </span>
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
    emailEnabled: false,
    minimumSeverity: 'warning',
  });
  const [emailVerified, setEmailVerified] = useState(false);
  const [loadingPreference, setLoadingPreference] = useState(true);

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
          emailEnabled: payload?.preference?.emailEnabled === true,
          minimumSeverity: SEVERITIES.includes(payload?.preference?.minimumSeverity)
            ? payload.preference.minimumSeverity
            : 'warning',
        });
        setEmailVerified(payload?.account?.emailVerified === true && payload?.account?.hasEmail === true);
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
      if (canConfigure) onConfigSaved(savedConfig);
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
          'Email alerts are personal to your account and disabled until you explicitly opt in.',
          'ელფოსტის შეტყობინებები პირადია და არ ჩაირთვება, სანამ თავად არ დაეთანხმებით.',
        )}
      </p>

      <div className="mt-4 rounded-lg border border-[#e8dfd5] bg-stone-50 p-3">
        <label className="flex items-start gap-2 text-[11px] font-semibold text-stone-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={notificationDraft.emailEnabled}
            disabled={loadingPreference || !emailVerified}
            onChange={(event) => setNotificationDraft({
              ...notificationDraft,
              emailEnabled: event.target.checked,
            })}
          />
          <span>
            {T('Email me routed intelligence alerts', 'მომწერეთ ელფოსტაზე ჩემთვის განკუთვნილი ინტელექტის შეტყობინებები')}
            <span className="mt-0.5 block text-[9px] font-normal leading-relaxed text-stone-500">
              {emailVerified
                ? T(
                  'Only new or escalated findings after opt-in are eligible; old alerts are never sent retroactively.',
                  'იგზავნება მხოლოდ თანხმობის შემდეგ შექმნილი ან გამწვავებული დასკვნები; ძველი შეტყობინებები უკუქცევით არ გაიგზავნება.',
                )
                : T(
                  'Verify your account email before enabling alerts.',
                  'შეტყობინებების ჩასართავად ჯერ დაადასტურეთ ანგარიშის ელფოსტა.',
                )}
            </span>
          </span>
        </label>
        <div className="mt-3 max-w-xs">
          <label htmlFor="ai-personal-min-severity" className="mb-1 block text-[10px] uppercase font-mono font-semibold text-stone-500">
            {T('My minimum email severity', 'ელფოსტის მინიმალური დონე')}
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
                'Shared across every server instance; Ask My Winery and deep analysis both count.',
                'ზღვარი საერთოა ყველა სერვერისთვის; ითვლება როგორც „ჰკითხე ჩემს მარანს“, ისე ღრმა ანალიზი.',
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
