import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BellRing,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  MailCheck,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

type RunStatus = 'running' | 'completed' | 'failed';
type DeliveryStatus = 'pending' | 'processing' | 'delivered' | 'failed' | 'cancelled';

interface MonitoringRun {
  id: string;
  organizationId: string;
  cadence: 'hourly' | 'daily' | 'weekly';
  status: RunStatus;
  attemptCount: number;
  evaluated: number;
  outboxQueued: number;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  errorMessage?: string;
}

interface DeliveryRecord {
  id: string;
  organizationId: string;
  recipientUsername: string;
  channel: 'email' | 'push';
  severity: string;
  status: DeliveryStatus;
  attemptCount: number;
  failedAt?: string;
  lastError?: string;
}

interface OperationsSnapshot {
  checkedAt: string;
  health: 'healthy' | 'attention' | 'critical';
  emailTransportConfigured: boolean;
  pushTransportConfigured: boolean;
  organizations: Record<string, string>;
  monitoring: {
    backend: 'postgresql' | 'memory';
    counts: Record<RunStatus, number>;
    staleRunning: number;
    latestCompletedAt?: string;
    recentRuns: MonitoringRun[];
  };
  notifications: {
    backend: 'postgresql' | 'memory';
    counts: Record<DeliveryStatus, number>;
    readyToDeliver: number;
    staleProcessing: number;
    oldestPendingAt?: string;
    latestDeliveredAt?: string;
    recentFailures: DeliveryRecord[];
  };
  modelCalls: {
    backend: 'postgresql' | 'memory';
    today: {
      total: number;
      succeeded: number;
      invalidResponse: number;
      failed: number;
      successRate: number;
      averageLatencyMs: number;
    };
    byPurpose: Record<'analysis' | 'ask_planner' | 'ask_explanation' | 'knowledge_embedding', {
      total: number;
      succeeded: number;
      invalidResponse: number;
      failed: number;
    }>;
    staleRunning: number;
    latestCompletedAt?: string;
    recentFailures: Array<{
      id: string;
      organizationId: string;
      purpose: 'analysis' | 'ask_planner' | 'ask_explanation' | 'knowledge_embedding';
      agent?: string;
      model: string;
      status: 'invalid_response' | 'failed';
      errorCategory?: string;
      startedAt: string;
      completedAt?: string;
      latencyMs?: number;
    }>;
  };
  quality: {
    totalResponses: number;
    qualityResponses: number;
    findingsWithFeedback: number;
    counts: Record<'helpful' | 'not_helpful' | 'incorrect' | 'already_handled', number>;
    helpfulRate: number;
    incorrectRate: number;
    alreadyHandledRate: number;
    bySource: Record<'rule' | 'model' | 'hybrid', {
      totalResponses: number;
      counts: Record<'helpful' | 'not_helpful' | 'incorrect' | 'already_handled', number>;
    }>;
    calibration: {
      minimumQualityResponses: number;
      minimumFindings: number;
      detectorsWithFeedback: number;
      assessedDetectors: number;
      needsReview: number;
      candidates: Array<{
        findingType: string;
        source: 'rule' | 'model' | 'hybrid';
        area: 'fermentation' | 'laboratory' | 'inventory' | 'vineyard' | 'compliance' | 'operations';
        findingsReviewed: number;
        totalResponses: number;
        qualityResponses: number;
        counts: Record<'helpful' | 'not_helpful' | 'incorrect' | 'already_handled', number>;
        helpfulRate: number;
        incorrectRate: number;
        negativeRate: number;
        alreadyHandledRate: number;
      }>;
    };
  };
}

interface Props {
  isKa: boolean;
  onMessage: (message: string | null) => void;
}

const badgeClasses: Record<RunStatus, string> = {
  running: 'border-cyan-500/25 bg-cyan-950/30 text-cyan-300',
  completed: 'border-emerald-500/25 bg-emerald-950/30 text-emerald-300',
  failed: 'border-red-500/25 bg-red-950/30 text-red-300',
};

function RunBadge({ status, isKa }: { status: RunStatus; isKa: boolean }) {
  const labels = {
    running: { en: 'Running', ka: 'მიმდინარეობს' },
    completed: { en: 'Completed', ka: 'დასრულდა' },
    failed: { en: 'Failed', ka: 'ვერ შესრულდა' },
  };
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${badgeClasses[status]}`}>
      {isKa ? labels[status].ka : labels[status].en}
    </span>
  );
}

export default function AiOperationsAdmin({ isKa, onMessage }: Props) {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const formatTime = useCallback((value?: string) => {
    if (!value) return isKa ? 'ჯერ არა' : 'Not yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(isKa ? 'ka-GE' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }, [isKa]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/admin/ai-operations?limit=30', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'AI operations status is unavailable.');
      setSnapshot(body);
    } catch (error) {
      onMessage(error instanceof Error
        ? error.message
        : (isKa ? 'AI ოპერაციების სტატუსი მიუწვდომელია.' : 'AI operations status is unavailable.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [isKa, onMessage]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const retry = async (record: DeliveryRecord) => {
    setRetryingId(record.id);
    try {
      const response = await fetch(
        `/api/admin/ai-operations/notifications/${encodeURIComponent(record.id)}/retry`,
        { method: 'POST', credentials: 'include', headers: { accept: 'application/json' } },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.reason || body?.error || 'Retry could not be queued.');
      onMessage(isKa
        ? 'შეტყობინება უსაფრთხო ხელახალი მიწოდებისთვის რიგში დაბრუნდა.'
        : 'The notification was safely returned to the delivery queue.');
      await load(true);
    } catch (error) {
      onMessage(error instanceof Error
        ? error.message
        : (isKa ? 'ხელახალი ცდა ვერ დაიგეგმა.' : 'The retry could not be queued.'));
    } finally {
      setRetryingId(null);
    }
  };

  if (loading && !snapshot) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center gap-3 text-cyan-400">
        <RefreshCw className="h-5 w-5 animate-spin" />
        <span className="text-xs font-bold uppercase tracking-widest">
          {isKa ? 'AI ოპერაციების შემოწმება...' : 'Checking AI operations...'}
        </span>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="rounded-2xl border border-red-500/25 bg-red-950/20 p-8 text-center">
        <XCircle className="mx-auto mb-3 h-8 w-8 text-red-400" />
        <p className="text-sm text-red-200">
          {isKa ? 'AI ოპერაციების მონაცემები ვერ ჩაიტვირთა.' : 'AI operations data could not be loaded.'}
        </p>
        <button type="button" onClick={() => void load()} className="mt-4 rounded-xl border border-red-400/30 px-4 py-2 text-xs font-bold text-red-200">
          {isKa ? 'ხელახლა ცდა' : 'Try again'}
        </button>
      </div>
    );
  }

  const healthCopy = {
    healthy: {
      en: 'Healthy',
      ka: 'გამართულია',
      detailEn: 'No stuck workers or terminal failures need intervention.',
      detailKa: 'გაჭედილი პროცესები ან ჩარევის მომლოდინე შეცდომები არ არის.',
      className: 'border-emerald-500/25 bg-emerald-950/20 text-emerald-300',
      Icon: CheckCircle2,
    },
    attention: {
      en: 'Needs attention',
      ka: 'საჭიროებს ყურადღებას',
      detailEn: 'A failed run, failed delivery, or delayed queue needs review.',
      detailKa: 'წარუმატებელი გაშვება, მიწოდება ან დაგვიანებული რიგი გადასახედია.',
      className: 'border-amber-500/25 bg-amber-950/20 text-amber-300',
      Icon: AlertTriangle,
    },
    critical: {
      en: 'Worker lease expired',
      ka: 'პროცესის ვადა ამოიწურა',
      detailEn: 'A monitoring or delivery worker appears stuck.',
      detailKa: 'მონიტორინგის ან მიწოდების პროცესი სავარაუდოდ გაჭედილია.',
      className: 'border-red-500/25 bg-red-950/20 text-red-300',
      Icon: XCircle,
    },
  }[snapshot.health];
  const HealthIcon = healthCopy.Icon;
  const orgName = (id: string) => snapshot.organizations[id] || id;
  const recentFailures = snapshot.notifications.recentFailures.slice(0, 12);
  const formatRate = (value: number) => new Intl.NumberFormat(isKa ? 'ka-GE' : 'en-GB', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(value);
  const formatLatency = (value: number) => value >= 1_000
    ? `${(value / 1_000).toFixed(1)} s`
    : `${value} ms`;
  const formatFindingType = (value: string) => value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return (
    <div className="space-y-6 text-left">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-400">
            <BrainCircuit className="h-5 w-5" />
            <h2 className="text-sm font-black uppercase tracking-widest">
              {isKa ? 'AI ოპერაციების მართვა' : 'AI Operations Control'}
            </h2>
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-stone-500">
            {isKa
              ? 'მონიტორინგისა და შეტყობინებების მიწოდების მდგომარეობა. ხელახალი ცდა მხოლოდ საბოლოო შეცდომისთვისაა შესაძლებელი; ყველა ნებართვა გაგზავნამდე თავიდან მოწმდება.'
              : 'Monitoring and notification-delivery health. Retry is limited to terminal failures; every consent and routing condition is rechecked before sending.'}
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/20 px-4 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-950/40 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {isKa ? 'განახლება' : 'Refresh'}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <section className={`rounded-2xl border p-5 ${healthCopy.className}`}>
          <HealthIcon className="mb-4 h-5 w-5" />
          <p className="text-[9px] font-bold uppercase tracking-widest opacity-70">{isKa ? 'სისტემის მდგომარეობა' : 'System state'}</p>
          <p className="mt-2 text-lg font-black">{isKa ? healthCopy.ka : healthCopy.en}</p>
          <p className="mt-2 text-[10px] leading-relaxed opacity-70">{isKa ? healthCopy.detailKa : healthCopy.detailEn}</p>
        </section>
        <section className="rounded-2xl border border-cyan-900/30 bg-[#0c090a] p-5">
          <Clock3 className="mb-4 h-5 w-5 text-cyan-400" />
          <p className="text-[9px] font-bold uppercase tracking-widest text-stone-500">{isKa ? 'ბოლო მონიტორინგი' : 'Latest monitoring'}</p>
          <p className="mt-2 text-sm font-black text-stone-200">{formatTime(snapshot.monitoring.latestCompletedAt)}</p>
          <p className="mt-2 text-[10px] text-stone-600">{snapshot.monitoring.counts.running} {isKa ? 'მიმდინარე' : 'running'} · {snapshot.monitoring.counts.failed} {isKa ? 'შეცდომა' : 'failed'}</p>
        </section>
        <section className="rounded-2xl border border-cyan-900/30 bg-[#0c090a] p-5">
          <BellRing className="mb-4 h-5 w-5 text-amber-400" />
          <p className="text-[9px] font-bold uppercase tracking-widest text-stone-500">{isKa ? 'მზადაა მიწოდებისთვის' : 'Ready for delivery'}</p>
          <p className="mt-2 text-2xl font-black text-stone-100">{snapshot.notifications.readyToDeliver}</p>
          <p className="mt-2 text-[10px] text-stone-600">{isKa ? 'ყველაზე ძველი:' : 'Oldest:'} {formatTime(snapshot.notifications.oldestPendingAt)}</p>
        </section>
        <section className="rounded-2xl border border-cyan-900/30 bg-[#0c090a] p-5">
          <MailCheck className="mb-4 h-5 w-5 text-emerald-400" />
          <p className="text-[9px] font-bold uppercase tracking-widest text-stone-500">{isKa ? 'მიწოდების მდგომარეობა' : 'Delivery state'}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {[
              ['SMTP', snapshot.emailTransportConfigured],
              ['Push', snapshot.pushTransportConfigured],
            ].map(([label, configured]) => (
              <span
                key={String(label)}
                className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${
                  configured
                    ? 'border-emerald-800 bg-emerald-950/50 text-emerald-300'
                    : 'border-amber-800 bg-amber-950/40 text-amber-300'
                }`}
              >
                {label} {configured
                  ? (isKa ? 'მზადაა' : 'ready')
                  : (isKa ? 'არ არის' : 'off')}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-stone-600">{snapshot.notifications.counts.delivered} {isKa ? 'მიწოდებული' : 'delivered'} · {snapshot.notifications.counts.failed} {isKa ? 'შეცდომა' : 'failed'}</p>
        </section>
      </div>

      <section className="rounded-2xl border border-cyan-900/25 bg-[#0c090a] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-stone-300">
              <Activity className="h-4 w-4 text-cyan-400" />
              {isKa ? 'მოდელის გამოძახებები დღეს' : 'Model calls today'}
            </h3>
            <p className="mt-2 text-[10px] text-stone-600">
              {isKa
                ? 'ინახება მხოლოდ დანიშნულება, სტატუსი და დრო — მოთხოვნები, პასუხები და მარნის მონაცემები არ ინახება.'
                : 'Purpose, status, and timing only—prompts, responses, and winery data are never retained.'}
            </p>
          </div>
          <span className="rounded-full border border-stone-800 px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-stone-500">
            {snapshot.modelCalls.backend}
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/10 p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-600">
              {isKa ? 'სულ' : 'Total'}
            </p>
            <p className="mt-2 text-xl font-black text-cyan-300">{snapshot.modelCalls.today.total}</p>
          </div>
          <div className="rounded-xl border border-emerald-500/15 bg-emerald-950/10 p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-600">
              {isKa ? 'წარმატება' : 'Success rate'}
            </p>
            <p className="mt-2 text-xl font-black text-emerald-300">
              {formatRate(snapshot.modelCalls.today.successRate)}
            </p>
          </div>
          <div className="rounded-xl border border-amber-500/15 bg-amber-950/10 p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-600">
              {isKa ? 'არასწორი პასუხი / შეცდომა' : 'Invalid / failed'}
            </p>
            <p className="mt-2 text-xl font-black text-amber-300">
              {snapshot.modelCalls.today.invalidResponse} / {snapshot.modelCalls.today.failed}
            </p>
          </div>
          <div className="rounded-xl border border-violet-500/15 bg-violet-950/10 p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-600">
              {isKa ? 'საშუალო დრო' : 'Average latency'}
            </p>
            <p className="mt-2 text-xl font-black text-violet-300">
              {formatLatency(snapshot.modelCalls.today.averageLatencyMs)}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {(['analysis', 'ask_planner', 'ask_explanation', 'knowledge_embedding'] as const).map((purpose) => {
            const purposeSummary = snapshot.modelCalls.byPurpose[purpose];
            const labels = {
              analysis: { en: 'Finding analysis', ka: 'მიგნების ანალიზი' },
              ask_planner: { en: 'Question planner', ka: 'კითხვის დამგეგმავი' },
              ask_explanation: { en: 'Answer explanation', ka: 'პასუხის განმარტება' },
              knowledge_embedding: { en: 'Knowledge retrieval', ka: 'ცოდნის მოძიება' },
            };
            return (
              <div key={purpose} className="flex items-center justify-between rounded-xl border border-stone-900 px-3 py-2 text-[10px]">
                <span className="font-bold text-stone-400">
                  {isKa ? labels[purpose].ka : labels[purpose].en}
                </span>
                <span className="text-stone-600">
                  {purposeSummary.succeeded}/{purposeSummary.total} {isKa ? 'წარმატებული' : 'succeeded'}
                </span>
              </div>
            );
          })}
        </div>
        {snapshot.modelCalls.recentFailures.length > 0 && (
          <div className="mt-4 border-t border-stone-900 pt-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-600">
              {isKa ? 'ბოლო პრობლემები — შიგთავსის გარეშე' : 'Recent problems—content free'}
            </p>
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              {snapshot.modelCalls.recentFailures.slice(0, 6).map((record) => (
                <div key={record.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-900 px-3 py-2 text-[10px]">
                  <span className="min-w-0">
                    <strong className="block truncate text-stone-400">{orgName(record.organizationId)}</strong>
                    <span className="text-stone-600">{record.purpose} · {record.agent || record.model}</span>
                  </span>
                  <span className="shrink-0 text-amber-400">
                    {record.status === 'invalid_response'
                      ? (isKa ? 'არასწორი ფორმატი' : 'invalid format')
                      : (record.errorCategory || (isKa ? 'შეცდომა' : 'failed'))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-cyan-900/25 bg-[#0c090a] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-stone-300">
              <BarChart3 className="h-4 w-4 text-violet-400" />
              {isKa ? 'მიგნებების ხარისხის სიგნალები' : 'Finding quality signals'}
            </h3>
            <p className="mt-2 text-[10px] text-stone-600">
              {isKa
                ? 'მხოლოდ გაერთიანებული შეფასებები — მიმომხილველის ვინაობა და კომენტარები არ ჩანს.'
                : 'Aggregate verdicts only—reviewer identities and comments are never shown here.'}
            </p>
          </div>
          <span className="rounded-full border border-stone-800 px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-stone-500">
            {snapshot.quality.totalResponses} {isKa ? 'შეფასება' : 'responses'}
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-emerald-500/15 bg-emerald-950/10 p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-600">
              {isKa ? 'სასარგებლო' : 'Helpful'}
            </p>
            <p className="mt-2 text-xl font-black text-emerald-300">
              {formatRate(snapshot.quality.helpfulRate)}
            </p>
          </div>
          <div className="rounded-xl border border-red-500/15 bg-red-950/10 p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-600">
              {isKa ? 'არასწორი' : 'Incorrect'}
            </p>
            <p className="mt-2 text-xl font-black text-red-300">
              {formatRate(snapshot.quality.incorrectRate)}
            </p>
          </div>
          <div className="rounded-xl border border-stone-800 bg-stone-950/40 p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-600">
              {isKa ? 'შეფასებული მიგნებები' : 'Findings reviewed'}
            </p>
            <p className="mt-2 text-xl font-black text-stone-200">
              {snapshot.quality.findingsWithFeedback}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[9px] text-stone-500">
          <span className="rounded-full border border-stone-800 px-2.5 py-1">
            {isKa ? 'სასარგებლო' : 'Helpful'}: {snapshot.quality.counts.helpful}
          </span>
          <span className="rounded-full border border-stone-800 px-2.5 py-1">
            {isKa ? 'არასასარგებლო' : 'Not helpful'}: {snapshot.quality.counts.not_helpful}
          </span>
          <span className="rounded-full border border-stone-800 px-2.5 py-1">
            {isKa ? 'არასწორი' : 'Incorrect'}: {snapshot.quality.counts.incorrect}
          </span>
          <span className="rounded-full border border-stone-800 px-2.5 py-1">
            {isKa ? 'უკვე მოგვარებული' : 'Already handled'}: {snapshot.quality.counts.already_handled}
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {(['rule', 'model', 'hybrid'] as const).map((source) => {
            const sourceQuality = snapshot.quality.bySource[source];
            const sourceQualityResponses = sourceQuality.totalResponses
              - sourceQuality.counts.already_handled;
            const sourceHelpfulRate = sourceQualityResponses > 0
              ? sourceQuality.counts.helpful / sourceQualityResponses
              : 0;
            const labels = {
              rule: { en: 'Rule', ka: 'წესი' },
              model: { en: 'Model', ka: 'მოდელი' },
              hybrid: { en: 'Hybrid', ka: 'ჰიბრიდული' },
            };
            return (
              <div key={source} className="flex items-center justify-between rounded-xl border border-stone-900 px-3 py-2 text-[10px]">
                <span className="font-bold text-stone-400">
                  {isKa ? labels[source].ka : labels[source].en}
                </span>
                <span className="text-stone-600">
                  {sourceQuality.totalResponses} · {formatRate(sourceHelpfulRate)} {isKa ? 'სასარგებლო' : 'helpful'}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-5 border-t border-stone-900 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
                {isKa ? 'დეტექტორების კალიბრაცია' : 'Detector calibration'}
              </h4>
              <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-stone-600">
                {isKa
                  ? `მხოლოდ სარეკომენდაციო სიგნალი. შეფასება იწყება მინიმუმ ${snapshot.quality.calibration.minimumQualityResponses} ხარისხის პასუხისა და ${snapshot.quality.calibration.minimumFindings} ცალკეული მიგნების შემდეგ; გაფრთხილებები ავტომატურად არასოდეს ითიშება.`
                  : `Advisory only. Assessment starts after at least ${snapshot.quality.calibration.minimumQualityResponses} quality verdicts across ${snapshot.quality.calibration.minimumFindings} distinct findings; alerts are never suppressed automatically.`}
              </p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-[9px] font-bold uppercase tracking-wider ${
              snapshot.quality.calibration.needsReview > 0
                ? 'border-amber-500/25 bg-amber-950/20 text-amber-300'
                : 'border-emerald-500/20 bg-emerald-950/10 text-emerald-400'
            }`}>
              {snapshot.quality.calibration.needsReview} {isKa ? 'გადასახედი' : 'to review'}
            </span>
          </div>
          {snapshot.quality.calibration.candidates.length === 0 ? (
            <div className="mt-3 rounded-xl border border-stone-900 bg-stone-950/30 px-4 py-3 text-[10px] text-stone-600">
              {snapshot.quality.calibration.assessedDetectors === 0
                ? (isKa
                  ? 'ჯერ არც ერთ დეტექტორს არ აქვს საკმარისი შეფასება საიმედო კალიბრაციისთვის.'
                  : 'No detector has enough feedback for reliable calibration yet.')
                : (isKa
                  ? `${snapshot.quality.calibration.assessedDetectors} შეფასებული დეტექტორიდან არც ერთი არ საჭიროებს გადახედვას.`
                  : `None of ${snapshot.quality.calibration.assessedDetectors} assessed detectors currently needs review.`)}
            </div>
          ) : (
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {snapshot.quality.calibration.candidates.map((candidate) => (
                <div
                  key={`${candidate.source}:${candidate.area}:${candidate.findingType}`}
                  className="rounded-xl border border-amber-500/15 bg-amber-950/10 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-bold text-stone-300">
                        {formatFindingType(candidate.findingType)}
                      </p>
                      <p className="mt-1 text-[9px] uppercase tracking-wider text-stone-600">
                        {candidate.source} · {candidate.area}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-amber-500/20 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-amber-300">
                      {isKa ? 'გადასახედი' : 'Review'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-stone-500">
                    <span>
                      {candidate.qualityResponses} {isKa ? 'ხარისხის პასუხი' : 'quality verdicts'}
                    </span>
                    <span>
                      {candidate.findingsReviewed} {isKa ? 'მიგნება' : 'findings'}
                    </span>
                    <span className="text-red-300/80">
                      {formatRate(candidate.incorrectRate)} {isKa ? 'არასწორი' : 'incorrect'}
                    </span>
                    <span className="text-amber-300/80">
                      {formatRate(candidate.negativeRate)} {isKa ? 'უარყოფითი' : 'negative'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-cyan-900/25 bg-[#0c090a]">
          <div className="flex items-center justify-between border-b border-stone-900 px-5 py-4">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-300">{isKa ? 'მონიტორინგის ბოლო გაშვებები' : 'Recent monitoring runs'}</h3>
            <span className="text-[9px] text-stone-600">{snapshot.monitoring.backend}</span>
          </div>
          <div className="max-h-[430px] overflow-auto">
            {snapshot.monitoring.recentRuns.length === 0 ? (
              <p className="p-8 text-center text-xs text-stone-600">{isKa ? 'გაშვებები ჯერ არ არის.' : 'No monitoring runs recorded yet.'}</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-stone-950 text-[9px] uppercase tracking-wider text-stone-500"><tr><th className="px-4 py-3">{isKa ? 'მარანი' : 'Winery'}</th><th className="px-4 py-3">{isKa ? 'ციკლი' : 'Cadence'}</th><th className="px-4 py-3">{isKa ? 'შედეგი' : 'Result'}</th><th className="px-4 py-3">{isKa ? 'დრო' : 'Time'}</th></tr></thead>
                <tbody className="divide-y divide-stone-900/70">
                  {snapshot.monitoring.recentRuns.map((run) => (
                    <tr key={run.id} className="align-top hover:bg-stone-900/30">
                      <td className="px-4 py-3"><p className="font-bold text-stone-300">{orgName(run.organizationId)}</p><p className="mt-1 text-[9px] text-stone-600">{run.evaluated} {isKa ? 'შეფასებული' : 'evaluated'} · {run.outboxQueued} {isKa ? 'რიგში' : 'queued'}</p></td>
                      <td className="px-4 py-3 text-stone-400">{run.cadence}</td>
                      <td className="px-4 py-3"><RunBadge status={run.status} isKa={isKa} />{run.errorMessage ? <p className="mt-2 max-w-52 break-words text-[9px] text-red-300/70">{run.errorMessage}</p> : null}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-[10px] text-stone-500">{formatTime(run.completedAt || run.failedAt || run.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-cyan-900/25 bg-[#0c090a]">
          <div className="flex items-center justify-between border-b border-stone-900 px-5 py-4">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-stone-300"><AlertTriangle className="h-4 w-4 text-amber-400" />{isKa ? 'მიწოდების საბოლოო შეცდომები' : 'Terminal delivery failures'}</h3>
            <span className="text-[9px] text-stone-600">{snapshot.notifications.backend}</span>
          </div>
          <div className="max-h-[430px] overflow-auto">
            {recentFailures.length === 0 ? (
              <div className="p-8 text-center"><ShieldCheck className="mx-auto mb-3 h-7 w-7 text-emerald-500/70" /><p className="text-xs text-stone-500">{isKa ? 'ხელით ჩარევის მომლოდინე მიწოდება არ არის.' : 'No deliveries need manual intervention.'}</p></div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-stone-950 text-[9px] uppercase tracking-wider text-stone-500"><tr><th className="px-4 py-3">{isKa ? 'მიმღები' : 'Recipient'}</th><th className="px-4 py-3">{isKa ? 'შეცდომა' : 'Failure'}</th><th className="px-4 py-3 text-right">{isKa ? 'ქმედება' : 'Action'}</th></tr></thead>
                <tbody className="divide-y divide-stone-900/70">
                  {recentFailures.map((record) => (
                    <tr key={record.id} className="align-top hover:bg-stone-900/30">
                      <td className="px-4 py-3"><p className="font-bold text-stone-300">{record.recipientUsername}</p><p className="mt-1 text-[9px] text-stone-600">{orgName(record.organizationId)} · {record.channel} · {record.severity}</p></td>
                      <td className="px-4 py-3"><p className="max-w-56 break-words text-[10px] text-red-300/80">{record.lastError || (isKa ? 'მიზეზი არ დაფიქსირებულა.' : 'No reason recorded.')}</p><p className="mt-1 text-[9px] text-stone-600">{record.attemptCount} {isKa ? 'ცდა' : 'attempts'} · {formatTime(record.failedAt)}</p></td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => void retry(record)} disabled={retryingId !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-[10px] font-bold text-amber-300 hover:bg-amber-950/40 disabled:opacity-40">
                          <RotateCcw className={`h-3.5 w-3.5 ${retryingId === record.id ? 'animate-spin' : ''}`} />{isKa ? 'ხელახლა ცდა' : 'Retry'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <p className="flex items-center gap-2 text-[9px] text-stone-600">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-cyan-700" />
        {isKa
          ? `შემოწმებულია ${formatTime(snapshot.checkedAt)}. ეკრანი არ აჩვენებს წერილის ტექსტს, ელფოსტის მისამართს ან მოდელის კონტექსტს.`
          : `Checked ${formatTime(snapshot.checkedAt)}. This console does not expose message bodies, email addresses, or model context.`}
      </p>
    </div>
  );
}
