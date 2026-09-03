import React from 'react';
import { AlertTriangle, CreditCard, Loader2 } from 'lucide-react';
import { planById, type BillingInterval, type PlanId } from '../lib/billing/planCatalog';
import type { Language } from '../lib/i18n';

interface Snapshot {
  subscription: {
    planId: PlanId;
    billingInterval: BillingInterval;
    status: string;
    renewsAt: string | null;
    trialEndsAt: string | null;
    provider: string | null;
    providerCardMask: string | null;
    cancelAtPeriodEnd: boolean;
    legacyAccess: boolean;
  };
  productionYear: number;
  usage: {
    usedLiters: number;
    limitLiters: number | null;
    usageRatio: number | null;
    level: 'normal' | 'warning' | 'exceeded';
    operationsBlocked: false;
  };
  capacityGrace?: {
    exceededAt: string | null;
    endsAt: string | null;
    active: boolean;
  };
}

export default function BillingSettingsPanel({ lang, canManage }: { lang: Language; canManage: boolean }) {
  const ka = lang === 'ka';
  const locale: 'ka' | 'en' = ka ? 'ka' : 'en';
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/billing/subscription')
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to load billing.');
        if (!cancelled) setSnapshot(data);
      })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load billing.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="flex items-center gap-2 rounded-2xl border border-[#e8dfd5] bg-white p-5 text-xs text-stone-500"><Loader2 className="h-4 w-4 animate-spin" /> {ka ? 'ბილინგი იტვირთება…' : 'Loading billing…'}</div>;
  if (error || !snapshot) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-xs text-amber-900"><strong>{ka ? 'ბილინგი მიუწვდომელია:' : 'Billing unavailable:'}</strong> {error}</div>;

  const plan = planById(snapshot.subscription.planId);
  const usagePercent = snapshot.usage.usageRatio === null ? 0 : Math.min(100, Math.round(snapshot.usage.usageRatio * 100));
  const number = (value: number) => new Intl.NumberFormat(ka ? 'ka-GE' : 'en-US', { maximumFractionDigits: 0 }).format(value);
  const renewal = snapshot.subscription.renewsAt || snapshot.subscription.trialEndsAt;

  return (
    <section className="rounded-2xl border border-[#e1d7cc] bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2 text-[#4e0e15] dark:text-[#d7b36a]"><CreditCard className="h-5 w-5" /><h3 className="font-serif text-xl font-black">{ka ? 'გეგმა და ბილინგი' : 'Plan & billing'}</h3></div>
          <p className="mt-2 text-xs text-stone-500">{plan.name[locale]} · {snapshot.subscription.billingInterval} · {snapshot.subscription.status}</p>
          {snapshot.subscription.providerCardMask && <p className="mt-1 text-[10px] text-stone-400">TBC · {snapshot.subscription.providerCardMask}</p>}
        </div>
        <a href="/pricing" className="rounded-xl bg-[#4e0e15] px-4 py-2 text-center text-[10px] font-black uppercase tracking-wide text-white hover:bg-[#34070a]">
          {canManage ? (ka ? 'გეგმის მართვა' : 'Manage plan') : (ka ? 'გეგმების ნახვა' : 'View plans')}
        </a>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div className="rounded-xl bg-stone-50 p-4 dark:bg-black/20">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-stone-500">
            <span>{ka ? `${snapshot.productionYear} წლის წარმოება` : `${snapshot.productionYear} production`}</span>
            <span>{number(snapshot.usage.usedLiters)} / {snapshot.usage.limitLiters === null ? '∞' : number(snapshot.usage.limitLiters)} L</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-white/10">
            <div className={`h-full rounded-full ${snapshot.usage.level === 'exceeded' ? 'bg-rose-600' : snapshot.usage.level === 'warning' ? 'bg-amber-500' : 'bg-emerald-700'}`} style={{ width: `${usagePercent}%` }} />
          </div>
          <p className="mt-2 text-[10px] text-stone-500">{usagePercent}% {ka ? 'გამოყენებულია' : 'used'}</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-4 dark:bg-black/20">
          <div className="text-[10px] font-black uppercase tracking-wide text-stone-500">{ka ? 'შემდეგი თარიღი' : 'Next billing date'}</div>
          <div className="mt-2 text-sm font-black">{renewal ? new Date(renewal).toLocaleDateString(ka ? 'ka-GE' : 'en-US') : (ka ? 'ხელშეკრულებით' : 'Contract-based')}</div>
          {snapshot.subscription.cancelAtPeriodEnd && <p className="mt-2 text-[10px] font-bold text-rose-700">{ka ? 'გაუქმება დაგეგმილია პერიოდის ბოლოს.' : 'Cancellation is scheduled for period end.'}</p>}
        </div>
      </div>

      {snapshot.usage.level !== 'normal' && (
        <div className={`mt-5 flex gap-3 rounded-xl border p-4 text-xs ${snapshot.usage.level === 'exceeded' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{snapshot.usage.level === 'exceeded'
            ? (ka ? 'გეგმის მოცულობა მიღწეულია. ოპერაციები არ დაიბლოკება; გთხოვთ, დაგეგმოთ განახლება საშეღავათო პერიოდში.' : `Plan capacity has been reached. Operations remain available; please arrange an upgrade${snapshot.capacityGrace?.endsAt ? ` by ${new Date(snapshot.capacityGrace.endsAt).toLocaleDateString('en-US')}` : ' during the grace period'}.`)
            : (ka ? 'გამოყენებამ გეგმის მოცულობის 80%-ს მიაღწია.' : 'Usage has reached 80% of plan capacity.')}</span>
        </div>
      )}
    </section>
  );
}
