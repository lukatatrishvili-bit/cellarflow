import React from 'react';
import { Check, Loader2, RefreshCw, Save, X } from 'lucide-react';
import { PLAN_CATALOG, type BillingFeature, type BillingInterval, type PlanId } from '../lib/billing/planCatalog';

interface AdminOverview {
  organizations: Array<{ id: string; name: string }>;
  subscriptions: Array<{
    organizationId: string;
    planId: PlanId;
    billingInterval: BillingInterval;
    status: string;
    renewsAt: string | null;
    capacityOverrideLiters: number | null;
    featureOverrides: Partial<Record<BillingFeature, boolean>>;
    customPriceMinor: number | null;
  }>;
  requests: Array<{
    id: string;
    organizationId: string;
    requestedBy: string;
    requestType: string;
    requestedPlanId: PlanId;
    requestedBillingInterval: BillingInterval;
    message: string | null;
    status: string;
    createdAt: string;
  }>;
}

const negotiableFeatures: BillingFeature[] = [
  'production_cost_tracking', 'advanced_reports', 'workflow_approvals', 'multi_site',
  'advanced_roles', 'priority_support', 'sso', 'api_access', 'custom_integrations',
  'sla', 'dedicated_success', 'multi_company',
];
const statuses = ['trialing', 'active', 'past_due', 'grace_period', 'paused', 'canceled', 'expired'];

export default function MasterBillingAdmin({ isKa, onMessage }: { isKa: boolean; onMessage: (message: string) => void }) {
  const [overview, setOverview] = React.useState<AdminOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [selectedOrgId, setSelectedOrgId] = React.useState('');
  const [planId, setPlanId] = React.useState<PlanId>('micro');
  const [interval, setInterval] = React.useState<BillingInterval>('annual');
  const [status, setStatus] = React.useState('trialing');
  const [renewsAt, setRenewsAt] = React.useState('');
  const [capacityOverride, setCapacityOverride] = React.useState('');
  const [customPriceGel, setCustomPriceGel] = React.useState('');
  const [featureOverrides, setFeatureOverrides] = React.useState<BillingFeature[]>([]);
  const [audit, setAudit] = React.useState<any[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/billing/admin/overview');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load billing admin data.');
      setOverview(data);
      setSelectedOrgId(current => current || data.organizations?.[0]?.id || '');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Unable to load billing admin data.');
    } finally {
      setLoading(false);
    }
  }, [onMessage]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (!overview || !selectedOrgId) return;
    const subscription = overview.subscriptions.find(item => item.organizationId === selectedOrgId);
    setPlanId(subscription?.planId || 'micro');
    setInterval(subscription?.billingInterval || 'annual');
    setStatus(subscription?.status || 'trialing');
    setRenewsAt(subscription?.renewsAt ? new Date(subscription.renewsAt).toISOString().slice(0, 10) : '');
    setCapacityOverride(subscription?.capacityOverrideLiters == null ? '' : String(subscription.capacityOverrideLiters));
    setCustomPriceGel(subscription?.customPriceMinor == null ? '' : String(subscription.customPriceMinor / 100));
    setFeatureOverrides(Object.entries(subscription?.featureOverrides || {})
      .filter(([, enabled]) => enabled)
      .map(([feature]) => feature as BillingFeature));
    fetch(`/api/billing/admin/organizations/${encodeURIComponent(selectedOrgId)}/audit`)
      .then(response => response.ok ? response.json() : { events: [] })
      .then(data => setAudit(data.events || []))
      .catch(() => setAudit([]));
  }, [overview, selectedOrgId]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedOrgId) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/billing/admin/organizations/${encodeURIComponent(selectedOrgId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planId,
          billingInterval: interval,
          status,
          renewsAt: renewsAt || null,
          capacityOverrideLiters: capacityOverride === '' ? null : Number(capacityOverride),
          customPriceMinor: customPriceGel === '' ? null : Math.round(Number(customPriceGel) * 100),
          featureOverrides: Object.fromEntries(featureOverrides.map(feature => [feature, true])),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save subscription.');
      onMessage(isKa ? 'გამოწერა განახლდა.' : 'Subscription updated.');
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Unable to save subscription.');
    } finally {
      setSaving(false);
    }
  };

  const resolveRequest = async (requestId: string, nextStatus: 'approved' | 'rejected') => {
    const response = await fetch(`/api/billing/admin/requests/${encodeURIComponent(requestId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    const data = await response.json();
    if (!response.ok) return onMessage(data.error || 'Unable to update request.');
    onMessage(isKa ? 'მოთხოვნა განახლდა.' : 'Request updated.');
    await load();
  };

  if (loading && !overview) return <div className="flex h-64 items-center justify-center gap-3 text-cyan-400"><Loader2 className="h-5 w-5 animate-spin" /> {isKa ? 'ბილინგი იტვირთება…' : 'Loading billing…'}</div>;
  if (!overview) return null;

  const fieldClass = 'w-full rounded-lg border border-stone-800 bg-black/30 px-3 py-2 text-xs text-stone-200 outline-none focus:border-cyan-600';
  const labelClass = 'mb-1 block text-[9px] font-bold uppercase tracking-wider text-stone-500';
  const pendingRequests = overview.requests.filter(request => request.status === 'pending');

  return (
    <div className="space-y-6 text-left">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-black text-cyan-300">{isKa ? 'გამოწერები და ფასები' : 'Subscriptions & pricing'}</h2><p className="mt-1 text-[10px] text-stone-500">{isKa ? 'გეგმის, ლიმიტებისა და შეთანხმებული ფუნქციების მართვა' : 'Manage plans, limits, negotiated features, and requests'}</p></div>
        <button type="button" onClick={() => void load()} className="rounded-lg border border-stone-800 p-2 text-stone-400 hover:text-cyan-400"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <form onSubmit={save} className="space-y-5 rounded-2xl border border-cyan-900/30 bg-[#0c090a] p-5">
          <h3 className="text-xs font-black uppercase tracking-wider text-stone-300">{isKa ? 'ორგანიზაციის გამოწერა' : 'Organization subscription'}</h3>
          <div><label className={labelClass}>{isKa ? 'ორგანიზაცია' : 'Organization'}</label><select className={fieldClass} value={selectedOrgId} onChange={event => setSelectedOrgId(event.target.value)}>{overview.organizations.map(org => <option key={org.id} value={org.id}>{org.name} · {org.id}</option>)}</select></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className={labelClass}>{isKa ? 'გეგმა' : 'Plan'}</label><select className={fieldClass} value={planId} onChange={event => setPlanId(event.target.value as PlanId)}>{PLAN_CATALOG.map(plan => <option key={plan.id} value={plan.id}>{plan.name[isKa ? 'ka' : 'en']}</option>)}</select></div>
            <div><label className={labelClass}>{isKa ? 'ინტერვალი' : 'Interval'}</label><select className={fieldClass} value={interval} onChange={event => setInterval(event.target.value as BillingInterval)}><option value="monthly">monthly</option><option value="annual">annual</option><option value="custom">custom</option></select></div>
            <div><label className={labelClass}>{isKa ? 'სტატუსი' : 'Status'}</label><select className={fieldClass} value={status} onChange={event => setStatus(event.target.value)}>{statuses.map(value => <option key={value}>{value}</option>)}</select></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className={labelClass}>{isKa ? 'განახლების თარიღი' : 'Renewal date'}</label><input type="date" className={fieldClass} value={renewsAt} onChange={event => setRenewsAt(event.target.value)} /></div>
            <div><label className={labelClass}>{isKa ? 'მოცულობის ლიმიტი (L)' : 'Capacity override (L)'}</label><input type="number" min="0" className={fieldClass} value={capacityOverride} onChange={event => setCapacityOverride(event.target.value)} placeholder={isKa ? 'გეგმის მიხედვით' : 'Use plan default'} /></div>
            <div><label className={labelClass}>{isKa ? 'შეთანხმებული ფასი (₾)' : 'Custom price (GEL)'}</label><input type="number" min="0" step="0.01" className={fieldClass} value={customPriceGel} onChange={event => setCustomPriceGel(event.target.value)} /></div>
          </div>
          <div><label className={labelClass}>{isKa ? 'შეთანხმებული ფუნქციები' : 'Negotiated feature overrides'}</label><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{negotiableFeatures.map(feature => { const selected = featureOverrides.includes(feature); return <button key={feature} type="button" onClick={() => setFeatureOverrides(current => selected ? current.filter(item => item !== feature) : [...current, feature])} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[10px] ${selected ? 'border-cyan-600 bg-cyan-950/30 text-cyan-300' : 'border-stone-850 text-stone-500'}`}><span className={`flex h-4 w-4 items-center justify-center rounded ${selected ? 'bg-cyan-600 text-black' : 'bg-stone-900'}`}>{selected && <Check className="h-3 w-3" />}</span>{feature.replace(/_/g, ' ')}</button>; })}</div></div>
          <button type="submit" disabled={saving || !selectedOrgId} className="flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-[10px] font-black uppercase text-white hover:bg-cyan-600 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{isKa ? 'შენახვა' : 'Save subscription'}</button>
        </form>

        <section className="rounded-2xl border border-cyan-900/30 bg-[#0c090a] p-5">
          <h3 className="text-xs font-black uppercase tracking-wider text-stone-300">{isKa ? 'მოთხოვნები' : 'Pending requests'} ({pendingRequests.length})</h3>
          <div className="mt-4 max-h-[520px] space-y-3 overflow-y-auto">{pendingRequests.length === 0 ? <p className="text-xs text-stone-600">{isKa ? 'მოლოდინში მოთხოვნები არ არის.' : 'No pending requests.'}</p> : pendingRequests.map(request => <article key={request.id} className="rounded-xl border border-stone-850 bg-black/20 p-4"><div className="flex justify-between gap-3"><div><div className="text-xs font-black text-cyan-300">{request.requestType} · {request.requestedPlanId}</div><div className="mt-1 text-[9px] text-stone-500">{request.organizationId} · @{request.requestedBy} · {new Date(request.createdAt).toLocaleDateString()}</div></div><div className="flex gap-2"><button type="button" title="Approve" onClick={() => void resolveRequest(request.id, 'approved')} className="rounded-lg bg-emerald-950 p-2 text-emerald-400"><Check className="h-4 w-4" /></button><button type="button" title="Reject" onClick={() => void resolveRequest(request.id, 'rejected')} className="rounded-lg bg-rose-950 p-2 text-rose-400"><X className="h-4 w-4" /></button></div></div>{request.message && <p className="mt-3 text-[10px] leading-5 text-stone-400">{request.message}</p>}</article>)}</div>
        </section>
      </div>

      <section className="rounded-2xl border border-cyan-900/30 bg-[#0c090a] p-5"><h3 className="text-xs font-black uppercase tracking-wider text-stone-300">{isKa ? 'გამოწერის აუდიტი' : 'Subscription audit'}</h3><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-[10px]"><thead className="text-left uppercase text-stone-600"><tr><th className="p-2">Time</th><th className="p-2">Actor</th><th className="p-2">Action</th></tr></thead><tbody className="divide-y divide-stone-900">{audit.map(event => <tr key={event.id}><td className="p-2 font-mono text-stone-500">{new Date(event.createdAt).toLocaleString()}</td><td className="p-2 text-cyan-500">{event.actorUsername}</td><td className="p-2 text-stone-300">{event.action}</td></tr>)}</tbody></table></div></section>
    </div>
  );
}
