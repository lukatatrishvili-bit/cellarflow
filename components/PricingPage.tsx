import React from 'react';
import { ArrowLeft, Check, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import {
  BILLING_FEATURE_LABELS,
  PLAN_CATALOG,
  annualSavingsGel,
  annualSavingsPercent,
  type BillingInterval,
  type PlanId,
} from '../lib/billing/planCatalog';
import { changeDirection } from '../lib/billing/subscription';
import type { Language } from '../lib/i18n';

interface PricingPageProps {
  lang: Language;
  isLoggedIn: boolean;
  currentRole?: string;
  onLanguageChange: (lang: Language) => void;
}

interface BillingSnapshot {
  subscription: {
    planId: PlanId;
    billingInterval: BillingInterval;
    status: string;
  };
}

const comparisonFeatures = [
  'operational_core',
  'unlimited_users',
  'data_import_export',
  'production_cost_tracking',
  'advanced_reports',
  'workflow_approvals',
  'multi_site',
  'advanced_roles',
  'priority_support',
  'sso',
  'api_access',
  'custom_integrations',
] as const;

export default function PricingPage({ lang, isLoggedIn, currentRole, onLanguageChange }: PricingPageProps) {
  const ka = lang === 'ka';
  const locale: 'ka' | 'en' = ka ? 'ka' : 'en';
  const [interval, setInterval] = React.useState<'monthly' | 'annual'>('annual');
  const [snapshot, setSnapshot] = React.useState<BillingSnapshot | null>(null);
  const [checkoutConfigured, setCheckoutConfigured] = React.useState(false);
  const [vatLabel, setVatLabel] = React.useState('');
  const [busyPlan, setBusyPlan] = React.useState<PlanId | null>(null);
  const [message, setMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/billing/catalog')
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        setCheckoutConfigured(Boolean(data.checkout?.configured));
        setVatLabel(String(data.vatLabel?.[lang] || ''));
      })
      .catch(() => undefined);
    if (isLoggedIn) {
      fetch('/api/billing/subscription')
        .then(response => response.ok ? response.json() : null)
        .then(data => { if (!cancelled && data) setSnapshot(data); })
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [isLoggedIn, lang]);

  React.useEffect(() => {
    if (!isLoggedIn || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const paymentId = params.get('payment');
    if (params.get('checkout') !== 'returned' || !paymentId) return;
    let cancelled = false;
    setMessage({ type: 'success', text: ka ? 'გადახდის სტატუსი მოწმდება…' : 'Verifying payment status…' });
    fetch(`/api/billing/payments/${encodeURIComponent(paymentId)}/reconcile`, { method: 'POST' })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to verify payment.');
        if (cancelled) return;
        if (data.status === 'succeeded') {
          setMessage({ type: 'success', text: ka ? 'გადახდა დადასტურდა და გეგმა განახლდა.' : 'Payment verified and your plan is active.' });
          const snapshotResponse = await fetch('/api/billing/subscription');
          if (snapshotResponse.ok && !cancelled) setSnapshot(await snapshotResponse.json());
        } else {
          setMessage({ type: 'error', text: ka ? `გადახდის სტატუსი: ${data.status}` : `Payment status: ${data.status}` });
        }
      })
      .catch(error => { if (!cancelled) setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to verify payment.' }); });
    return () => { cancelled = true; };
  }, [isLoggedIn, ka]);

  const money = (value: number) => new Intl.NumberFormat(ka ? 'ka-GE' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(value);
  const capacity = (value: number | null) => value === null
    ? (ka ? '2,000,000 ლ-ზე მეტი' : 'Above 2,000,000 L')
    : `${new Intl.NumberFormat(ka ? 'ka-GE' : 'en-US').format(value)} L`;

  const requestPlan = async (planId: PlanId) => {
    const response = await fetch('/api/billing/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId, billingInterval: planId === 'enterprise' ? 'custom' : interval }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to submit request.');
    setMessage({
      type: 'success',
      text: planId === 'enterprise'
        ? (ka ? 'შეთავაზების მოთხოვნა მიღებულია.' : 'Your quotation request has been received.')
        : (ka ? 'გეგმის ცვლილების მოთხოვნა მიღებულია.' : 'Your plan-change request has been received.'),
    });
  };

  const selectPlan = async (planId: PlanId) => {
    setMessage(null);
    if (!isLoggedIn) {
      window.location.assign('/');
      return;
    }
    setBusyPlan(planId);
    try {
      const currentPlanId = snapshot?.subscription.planId;
      const isDowngrade = currentPlanId && changeDirection(currentPlanId, planId) === 'downgrade';
      if (planId === 'enterprise' || currentRole !== 'Owner/Admin' || isDowngrade) {
        await requestPlan(planId);
        return;
      }
      if (!checkoutConfigured) {
        await requestPlan(planId);
        return;
      }
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId, billingInterval: interval, language: lang }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to start checkout.');
      const approval = new URL(String(data.approvalUrl || ''));
      if (approval.protocol !== 'https:' || !approval.hostname.endsWith('.tbcbank.ge')) {
        throw new Error('Payment provider returned an invalid checkout address.');
      }
      window.location.assign(approval.toString());
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to continue.' });
    } finally {
      setBusyPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f6f2] text-[#2c241e] dark:bg-[#0a0607] dark:text-stone-100">
      <header className="sticky top-0 z-20 border-b border-[#e8dfd5]/80 bg-[#f8f6f2]/90 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-[#0a0607]/90">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2 text-sm font-black text-[#4e0e15] dark:text-[#d7b36a]">
            <ArrowLeft className="h-4 w-4" /> Cellarflow
          </a>
          <div className="flex items-center gap-2">
            {(['en', 'ka'] as Language[]).map(code => (
              <button
                key={code}
                type="button"
                onClick={() => onLanguageChange(code)}
                className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${lang === code ? 'bg-[#4e0e15] text-white' : 'bg-white text-stone-500 dark:bg-white/10 dark:text-stone-300'}`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-12 lg:px-8 lg:py-20">
        <section className="mx-auto max-w-4xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#c5a059]/30 bg-[#c5a059]/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#7a5b1f] dark:text-[#d7b36a]">
            <Sparkles className="h-3.5 w-3.5" /> {ka ? 'ფასი წარმოების მოცულობის მიხედვით' : 'Pricing by production capacity'}
          </div>
          <h1 className="font-serif text-4xl font-black tracking-tight text-[#4e0e15] dark:text-stone-50 md:text-6xl">
            {ka ? 'ყველა მარანს ეკუთვნის სრული საოპერაციო ბირთვი' : 'Every winery gets the complete operational core'}
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-sm leading-7 text-stone-600 dark:text-stone-300 md:text-base">
            {ka
              ? 'ფასი ეფუძნება წლიურ წარმოებას — არა მომხმარებლების რაოდენობას. რთველისას ოპერაციები არასოდეს იბლოკება.'
              : 'Pricing follows annual production—not user count. Essential cellar work stays available, and harvest operations are never blocked.'}
          </p>

          <div className="mx-auto mt-8 inline-flex rounded-full border border-[#ded5ca] bg-white p-1 shadow-sm dark:border-white/10 dark:bg-white/5">
            <button type="button" onClick={() => setInterval('monthly')} className={`rounded-full px-5 py-2 text-xs font-black ${interval === 'monthly' ? 'bg-[#4e0e15] text-white' : 'text-stone-500'}`}>
              {ka ? 'თვიური' : 'Monthly'}
            </button>
            <button type="button" onClick={() => setInterval('annual')} className={`rounded-full px-5 py-2 text-xs font-black ${interval === 'annual' ? 'bg-[#4e0e15] text-white' : 'text-stone-500'}`}>
              {ka ? 'წლიური' : 'Annual'} · {ka ? 'ნაგულისხმევი' : 'default'}
            </button>
          </div>
        </section>

        {message && (
          <div className={`mx-auto mt-8 max-w-3xl rounded-2xl border px-5 py-4 text-center text-sm font-bold ${message.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'}`} role="status">
            {message.text}
          </div>
        )}

        <section className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          {PLAN_CATALOG.map(plan => {
            const current = snapshot?.subscription.planId === plan.id;
            const price = interval === 'annual' ? plan.annualPriceGel : plan.monthlyPriceGel;
            const featured = plan.id === 'professional';
            const sameInterval = current && snapshot?.subscription.billingInterval === interval;
            return (
              <article key={plan.id} className={`relative flex min-h-[500px] flex-col rounded-3xl border p-6 shadow-sm ${featured ? 'border-[#4e0e15] bg-[#4e0e15] text-white shadow-xl xl:-translate-y-3' : 'border-[#e1d7cc] bg-white dark:border-white/10 dark:bg-white/5'}`}>
                {featured && <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#c5a059] px-3 py-1 text-[9px] font-black uppercase tracking-widest text-[#2c241e]">{ka ? 'ყველაზე პოპულარული' : 'Most popular'}</div>}
                {current && <div className={`mb-3 inline-flex w-fit rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${featured ? 'bg-white/15 text-white' : 'bg-emerald-100 text-emerald-800'}`}>{ka ? 'მიმდინარე გეგმა' : 'Current plan'}</div>}
                <h2 className="font-serif text-2xl font-black">{plan.name[locale]}</h2>
                <p className={`mt-2 text-xs ${featured ? 'text-white/70' : 'text-stone-500 dark:text-stone-400'}`}>{capacity(plan.productionLimitLiters)} / {ka ? 'წელი' : 'year'}</p>
                <div className="mt-7 min-h-[76px]">
                  {price === null ? (
                    <>
                      <div className="text-3xl font-black">{ka ? 'შეთავაზებით' : 'Custom'}</div>
                      <div className={`mt-1 text-[10px] ${featured ? 'text-white/60' : 'text-stone-400'}`}>{ka ? `${money(plan.annualPriceGel)} ₾-დან / წელი` : `From ${money(plan.annualPriceGel)} ₾ / year`}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-3xl font-black">{money(price)} ₾</div>
                      <div className={`mt-1 text-[10px] ${featured ? 'text-white/60' : 'text-stone-400'}`}>/ {interval === 'annual' ? (ka ? 'წელი' : 'year') : (ka ? 'თვე' : 'month')}</div>
                    </>
                  )}
                </div>
                {interval === 'annual' && annualSavingsGel(plan.id) !== null && (
                  <div className={`mb-5 rounded-xl px-3 py-2 text-[10px] font-bold ${featured ? 'bg-white/10 text-[#f2d79e]' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'}`}>
                    {ka ? 'დაზოგეთ' : 'Save'} {money(annualSavingsGel(plan.id)!)} ₾ ({annualSavingsPercent(plan.id)}%)
                  </div>
                )}
                <ul className="flex-1 space-y-3">
                  {plan.highlights.map(item => (
                    <li key={item.en} className={`flex gap-2 text-xs leading-5 ${featured ? 'text-white/85' : 'text-stone-600 dark:text-stone-300'}`}>
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? 'text-[#d7b36a]' : 'text-emerald-700'}`} /> {item[locale]}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={Boolean(busyPlan) || Boolean(sameInterval)}
                  onClick={() => void selectPlan(plan.id)}
                  className={`mt-7 flex w-full items-center justify-center rounded-xl px-3 py-3 text-[11px] font-black uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-50 ${featured ? 'bg-[#c5a059] text-[#2c241e] hover:bg-[#d7b36a]' : 'bg-[#4e0e15] text-white hover:bg-[#34070a]'}`}
                >
                  {busyPlan === plan.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {sameInterval
                    ? (ka ? 'მიმდინარე გეგმა' : 'Current plan')
                    : plan.id === 'enterprise'
                      ? (ka ? 'მოითხოვეთ შეთავაზება' : 'Request a quotation')
                      : !isLoggedIn
                        ? (ka ? 'შედით გეგმის ასარჩევად' : 'Sign in to select')
                        : (ka ? 'გეგმის არჩევა' : 'Select plan')}
                </button>
              </article>
            );
          })}
        </section>

        {vatLabel && <p className="mt-5 text-center text-xs text-stone-500">{vatLabel}</p>}

        <section className="mt-20 overflow-hidden rounded-3xl border border-[#e1d7cc] bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="border-b border-[#e8dfd5] p-6 dark:border-white/10">
            <h2 className="font-serif text-2xl font-black text-[#4e0e15] dark:text-stone-50">{ka ? 'გეგმების შედარება' : 'Compare plans'}</h2>
            <p className="mt-2 text-xs text-stone-500">{ka ? 'ძირითადი მარნისა და მიკვლევადობის ფუნქციები ყველა გეგმაში შედის.' : 'Core cellar and traceability features are included in every plan.'}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-xs">
              <thead>
                <tr className="bg-stone-50 dark:bg-black/20">
                  <th className="p-4 font-black">{ka ? 'შესაძლებლობა' : 'Capability'}</th>
                  {PLAN_CATALOG.map(plan => <th key={plan.id} className="p-4 text-center font-black">{plan.name[locale]}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eee7df] dark:divide-white/10">
                {comparisonFeatures.map(feature => (
                  <tr key={feature}>
                    <td className="p-4 font-semibold">{BILLING_FEATURE_LABELS[feature][locale]}</td>
                    {PLAN_CATALOG.map(plan => (
                      <td key={plan.id} className="p-4 text-center">
                        {plan.features.includes(feature) ? <Check className="mx-auto h-4 w-4 text-emerald-700" aria-label="Included" /> : <span className="text-stone-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12 flex flex-col items-center rounded-3xl bg-[#4e0e15] px-6 py-10 text-center text-white">
          <ShieldCheck className="h-8 w-8 text-[#d7b36a]" />
          <h2 className="mt-4 font-serif text-2xl font-black">{ka ? 'მონაცემები უსაფრთხოდ რჩება გეგმის შემცირებისას' : 'Your data stays safe after a downgrade'}</h2>
          <p className="mt-3 max-w-2xl text-xs leading-6 text-white/70">{ka ? 'ისტორიული მონაცემები არასოდეს იშლება ან იმალება. მიუწვდომელი გაფართოებული ფუნქციების მონაცემები საჭიროების შემთხვევაში მხოლოდ წაკითხვის რეჟიმში რჩება.' : 'Historical records are never deleted or hidden. Data from unavailable advanced features remains safely readable where appropriate.'}</p>
        </section>
      </main>
    </div>
  );
}
