import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  RefreshCw,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Language } from '../lib/language';
import type { Task } from '../lib/wineryState';
import {
  APPROVABLE_COMMAND_TYPES,
  buildTodayQueue,
  type ProductionPlanItem,
  type PurchaseOrder,
  type QualitySop,
  type RecallCase,
  type WorkflowApprovalPolicy,
  type WorkflowApprovalRecord,
  type TodayQueueVisibility,
} from '../lib/operationsControl';
import { localISODate } from '../lib/weatherApi';
import { workOwnerMatchesIdentity } from '../lib/workAssignments';

interface OperationsControlTabProps {
  lang: Language;
  currentUsername: string;
  currentUserName: string;
  currentRole: string;
  tasks: Task[];
  qualitySops: QualitySop[];
  purchaseOrders: PurchaseOrder[];
  productionPlans: ProductionPlanItem[];
  recallCases: RecallCase[];
  queueVisibility: Partial<TodayQueueVisibility>;
  focusApprovalId?: string;
  onNavigate: (tab: string, targetId?: string) => void;
  setToastMessage?: (message: string | null) => void;
}

interface ApprovalResponse {
  entitled: boolean;
  policy: WorkflowApprovalPolicy;
  approvals: WorkflowApprovalRecord[];
}

const commandLabels: Record<string, { en: string; ka: string }> = {
  'cellar.operation': { en: 'Cellar operations', ka: 'მარნის ოპერაციები' },
  'cellar.operation.reverse': { en: 'Operation corrections', ka: 'ოპერაციის შესწორებები' },
  'cellar.transfer': { en: 'Transfers and blends', ka: 'გადატანა და კუპაჟი' },
  'cellar.transfer.reverse': { en: 'Transfer corrections', ka: 'გადატანის შესწორებები' },
  'cellar.bottling': { en: 'Bottling', ka: 'ჩამოსხმა' },
  'cellar.bottling.reverse': { en: 'Bottling corrections', ka: 'ჩამოსხმის შესწორებები' },
  'sales.stock': { en: 'Sales and dispatch', ka: 'გაყიდვა და გაგზავნა' },
  'sales.stock.reverse': { en: 'Sales corrections', ka: 'გაყიდვის შესწორებები' },
};

function priorityClass(priority: string): string {
  if (priority === 'critical') return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200';
  if (priority === 'high') return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200';
  return 'border-stone-200 bg-white text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200';
}

export default function OperationsControlTab({
  lang,
  currentUsername,
  currentUserName,
  currentRole,
  tasks,
  qualitySops,
  purchaseOrders,
  productionPlans,
  recallCases,
  queueVisibility,
  focusApprovalId,
  onNavigate,
  setToastMessage,
}: OperationsControlTabProps) {
  const ka = lang === 'ka';
  const canApprove = currentRole === 'Owner/Admin';
  const [data, setData] = React.useState<ApprovalResponse>({
    entitled: false,
    policy: { enabled: false, commandTypes: [] },
    approvals: [],
  });
  const [loading, setLoading] = React.useState(true);
  const [working, setWorking] = React.useState('');
  const [decisionReasons, setDecisionReasons] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!focusApprovalId) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(`approval-${focusApprovalId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusApprovalId]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/workflow-approvals', { credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load workflow approvals.');
      setData({
        entitled: body.entitled === true,
        policy: body.policy || { enabled: false, commandTypes: [] },
        approvals: Array.isArray(body.approvals) ? body.approvals : [],
      });
    } catch (error) {
      setToastMessage?.(error instanceof Error ? error.message : 'Could not load workflow approvals.');
    } finally {
      setLoading(false);
    }
  }, [setToastMessage]);

  React.useEffect(() => { void load(); }, [load]);

  const today = localISODate();
  const queue = React.useMemo(() => buildTodayQueue({
    today,
    tasks,
    sops: qualitySops,
    purchaseOrders,
    productionPlans,
    approvals: data.approvals,
    recallCases,
    currentUsername,
    currentUserName,
    visibility: queueVisibility,
  }), [currentUserName, currentUsername, data.approvals, productionPlans, purchaseOrders, qualitySops, queueVisibility, recallCases, tasks, today]);

  const updatePolicy = async () => {
    setWorking('policy');
    try {
      const response = await fetch('/api/workflow-approvals/policy', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.policy),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Approval policy could not be saved.');
      setData(current => ({ ...current, policy: body.policy }));
      setToastMessage?.(ka ? 'დამტკიცების წესი შენახულია.' : 'Approval policy saved.');
    } catch (error) {
      setToastMessage?.(error instanceof Error ? error.message : 'Approval policy could not be saved.');
    } finally {
      setWorking('');
    }
  };

  const decide = async (approval: WorkflowApprovalRecord, status: 'approved' | 'rejected') => {
    setWorking(approval.id);
    try {
      const response = await fetch(`/api/workflow-approvals/${encodeURIComponent(approval.id)}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reason: decisionReasons[approval.id] || '' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Decision could not be saved.');
      setData(current => ({
        ...current,
        approvals: current.approvals.map(item => item.id === approval.id ? body.approval : item),
      }));
      setToastMessage?.(status === 'approved'
        ? (ka ? 'ოპერაცია დამტკიცებულია. შემქმნელმა იგივე ბრძანება ხელახლა უნდა გააგზავნოს.' : 'Approved. The requester can now resubmit the same command.')
        : (ka ? 'ოპერაცია უარყოფილია.' : 'Approval request rejected.'));
    } catch (error) {
      setToastMessage?.(error instanceof Error ? error.message : 'Decision could not be saved.');
    } finally {
      setWorking('');
    }
  };

  const visibleApprovals = data.approvals.filter(item => (
    canApprove || workOwnerMatchesIdentity(item.requestedBy, { username: currentUsername, fullName: currentUserName })
  ));
  const pending = visibleApprovals.filter(item => item.status === 'pending');
  const history = visibleApprovals.filter(item => item.status !== 'pending').slice(0, 20);
  const queueSourceLabel = (source: (typeof queue)[number]['source']) => ({
    task: ka ? 'დავალება' : 'Task',
    sop: 'SOP',
    purchase_order: ka ? 'შესყიდვა' : 'Purchase order',
    production_plan: ka ? 'გეგმა' : 'Production plan',
    approval: ka ? 'დამტკიცება' : 'Approval',
    recall: ka ? 'გაწვევა' : 'Recall',
  })[source];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#7a1c2b] dark:text-amber-300">
            <ShieldCheck className="h-4 w-4" /> {ka ? 'ოპერაციული კონტროლი' : 'Operational control'}
          </div>
          <h2 className="mt-2 font-serif text-3xl font-semibold text-stone-950 dark:text-stone-50">
            {ka ? 'დღევანდელი სამუშაო და დამტკიცებები' : 'Today’s work and approvals'}
          </h2>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-xs font-bold text-stone-700 shadow-sm disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {ka ? 'განახლება' : 'Refresh'}
        </button>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {([
          [ka ? 'დღეს ღია' : 'Open today', queue.length, Clock3],
          [ka ? 'კრიტიკული' : 'Critical', queue.filter(item => item.priority === 'critical').length, AlertTriangle],
          [ka ? 'დასამტკიცებელი' : 'Awaiting approval', pending.length, ClipboardCheck],
        ] satisfies Array<[string, number, LucideIcon]>).map(([label, value, Icon]) => (
          <div key={String(label)} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <Icon className="h-5 w-5 text-[#7a1c2b] dark:text-amber-300" />
            <strong className="mt-4 block text-3xl text-stone-950 dark:text-white">{String(value)}</strong>
            <span className="mt-1 block text-xs font-bold uppercase tracking-wider text-stone-500">{String(label)}</span>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-950/40">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-stone-700 dark:text-stone-200">{ka ? 'პრიორიტეტული რიგი' : 'Priority queue'}</h3>
          <span className="text-[10px] text-stone-500">{today}</span>
        </div>
        <div className="space-y-2">
          {queue.length === 0 ? (
            <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-8 text-center text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
              <CheckCircle2 className="mx-auto mb-2 h-6 w-6" /> {ka ? 'დღევანდელი რიგი ცარიელია.' : 'The operational queue is clear.'}
            </div>
          ) : queue.map(item => (
            <button key={item.id} type="button" onClick={() => onNavigate(item.targetTab, item.targetId)} className={`flex w-full min-h-16 items-center gap-3 rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${priorityClass(item.priority)}`}>
              <span className="min-w-0 flex-1">
                <span className="mb-1 block text-[9px] font-black uppercase tracking-wider opacity-65">{queueSourceLabel(item.source)}</span>
                <strong className="block truncate text-sm">{item.title}</strong>
                <span className="mt-1 block truncate text-[11px] opacity-75">{item.detail}</span>
              </span>
              <span className="shrink-0 text-right text-[10px] font-black uppercase"><span className="block">{item.dueDate}</span><span className="mt-1 inline-flex items-center gap-1 opacity-70">{ka ? 'გახსნა' : 'Open'} <ArrowRight className="h-3 w-3" /></span></span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <h3 className="flex items-center gap-2 text-sm font-black text-stone-900 dark:text-white"><ShieldCheck className="h-4 w-4" />{ka ? 'დამტკიცების პოლიტიკა' : 'Approval policy'}</h3>
          {!data.entitled ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {ka ? 'Workflow approvals საჭიროებს Professional ან უფრო მაღალ გეგმას.' : 'Workflow approvals require the Professional plan or higher.'}
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <label className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                <span className="text-xs font-bold text-stone-700 dark:text-stone-200">{ka ? 'დამტკიცების მოთხოვნა' : 'Require approvals'}</span>
                <input type="checkbox" checked={data.policy.enabled} disabled={!canApprove} onChange={event => setData(current => ({ ...current, policy: { ...current.policy, enabled: event.target.checked } }))} className="h-5 w-5 accent-[#7a1c2b]" />
              </label>
              <div className="space-y-2">
                {APPROVABLE_COMMAND_TYPES.map(commandType => (
                  <label key={commandType} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-xs text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-950">
                    <input type="checkbox" disabled={!canApprove} checked={data.policy.commandTypes.includes(commandType)} onChange={event => setData(current => ({
                      ...current,
                      policy: {
                        ...current.policy,
                        commandTypes: event.target.checked
                          ? [...current.policy.commandTypes, commandType]
                          : current.policy.commandTypes.filter(item => item !== commandType),
                      },
                    }))} className="h-4 w-4 accent-[#7a1c2b]" />
                    {commandLabels[commandType][ka ? 'ka' : 'en']}
                  </label>
                ))}
              </div>
              {canApprove && (
                <button type="button" onClick={() => void updatePolicy()} disabled={working === 'policy'} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#651522] px-4 text-xs font-black text-white disabled:opacity-50">
                  {working === 'policy' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {ka ? 'პოლიტიკის შენახვა' : 'Save policy'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <h3 className="text-sm font-black text-stone-900 dark:text-white">{ka ? 'დასამტკიცებელი ოპერაციები' : 'Commands awaiting review'}</h3>
          <div className="mt-4 space-y-3">
            {pending.length === 0 ? <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-xs text-stone-500 dark:border-stone-700">{ka ? 'მოლოდინში ოპერაცია არ არის.' : 'No commands are waiting for approval.'}</p> : pending.map(approval => (
              <article id={`approval-${approval.id}`} tabIndex={-1} key={approval.id} className={`rounded-xl border p-4 focus:outline-none focus:ring-2 focus:ring-[#7a1c2b] ${focusApprovalId === approval.id ? 'border-[#7a1c2b] bg-rose-50/40 dark:bg-rose-950/20' : 'border-stone-200 dark:border-stone-800'}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <strong className="text-sm text-stone-900 dark:text-white">{approval.requestSummary}</strong>
                    <p className="mt-1 text-[10px] text-stone-500">{approval.commandType} · @{approval.requestedBy} · {new Date(approval.requestedAt).toLocaleString()}</p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[9px] font-black uppercase text-amber-800 dark:bg-amber-950 dark:text-amber-200">pending</span>
                </div>
                {canApprove && (
                  <div className="mt-3 space-y-2">
                    <input value={decisionReasons[approval.id] || ''} onChange={event => setDecisionReasons(current => ({ ...current, [approval.id]: event.target.value }))} maxLength={500} placeholder={ka ? 'გადაწყვეტილების შენიშვნა (არასავალდებულო)' : 'Decision note (optional)'} className="min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 text-xs outline-none focus:border-[#7a1c2b] dark:border-stone-700 dark:bg-stone-950" />
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" disabled={working === approval.id} onClick={() => void decide(approval, 'approved')} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 text-xs font-bold text-white disabled:opacity-50"><Check className="h-4 w-4" />{ka ? 'დამტკიცება' : 'Approve'}</button>
                      <button type="button" disabled={working === approval.id} onClick={() => void decide(approval, 'rejected')} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-rose-700 text-xs font-bold text-white disabled:opacity-50"><X className="h-4 w-4" />{ka ? 'უარყოფა' : 'Reject'}</button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
          {history.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-bold text-stone-600 dark:text-stone-300">{ka ? 'ბოლო გადაწყვეტილებები' : 'Recent decisions'} ({history.length})</summary>
              <div className="mt-2 space-y-2">
                {history.map(approval => <div key={approval.id} className="rounded-lg bg-stone-50 p-3 text-[11px] text-stone-600 dark:bg-stone-950 dark:text-stone-300"><strong>{approval.requestSummary}</strong><span className="ml-2 uppercase">{approval.status}</span></div>)}
              </div>
            </details>
          )}
        </div>
      </section>
    </div>
  );
}
