import React from 'react';
import {
  Activity, Archive, Building2, Clock3, CreditCard, Database, HeartPulse,
  History, Loader2, Mail, RefreshCw, RotateCcw, Send, ShieldAlert,
  Save, Tag, Trash2, UserCog, UserRoundCheck, Users, X,
} from 'lucide-react';

const ROLES = ['Owner/Admin', 'Winemaker', 'Viticulturist', 'Lab Technician', 'Cellar Worker', 'Read-Only'] as const;

export interface AdminOrgInspection {
  organization: {
    id: string;
    name: string;
    status: 'active' | 'suspended' | 'archived';
    archivedAt: string | null;
    deletionScheduledAt: string | null;
    internalNotes: string;
    internalTags: string[];
    createdAt: string;
  };
  wineryName: string;
  members: Array<{
    username: string;
    fullName: string;
    email: string;
    role: string;
    accountEnabled: boolean;
    approvalStatus: string;
    lastSeenAt: string | null;
    isOnline: boolean;
    isActiveWorkspace: boolean;
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: string;
    status: 'pending' | 'accepted' | 'expired' | 'revoked';
    createdAt: string | null;
    expiresAt: string;
  }>;
  auditEvents: Array<{
    id?: string;
    eventType: string;
    username?: string | null;
    actorUsername?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
  }>;
  health: { level: 'healthy' | 'warning' | 'critical'; issues: string[]; lastActivity: string | null };
  dataSizeBytes: number;
  lastActivity: string | null;
  collections: Array<{ key: string; count: number; lastModified: string | null }>;
  operationalSummary?: Record<string, number>;
  attachmentSummary?: Record<string, unknown>;
  crmSummary?: Record<string, unknown>;
  aiDraftSummary?: Record<string, unknown>;
}

interface BillingSummary {
  planId: string;
  billingInterval: string;
  status: string;
  renewsAt: string | null;
  capacityOverrideLiters: number | null;
  featureOverrides: Record<string, boolean>;
}

interface Props {
  detail: AdminOrgInspection;
  isKa: boolean;
  loading: boolean;
  onClose: () => void;
  onMessage: (message: string) => void;
  onRefresh: () => Promise<void> | void;
  onManageUser: (username: string) => void;
  onOpenBilling: (organizationId: string) => void;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function relativeTime(value: string | null, isKa: boolean) {
  if (!value) return isKa ? 'არასდროს' : 'Never';
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return value;
  const minutes = Math.max(0, Math.round(elapsed / 60_000));
  if (minutes < 1) return isKa ? 'ახლახან' : 'Just now';
  if (minutes < 60) return isKa ? `${minutes} წთ წინ` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return isKa ? `${hours} სთ წინ` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return isKa ? `${days} დღის წინ` : `${days}d ago`;
}

export default function AdminOrganizationWorkspace({ detail, isKa, loading, onClose, onMessage, onRefresh, onManageUser, onOpenBilling }: Props) {
  const [tab, setTab] = React.useState<'overview' | 'members' | 'invitations' | 'data' | 'security' | 'billing'>('overview');
  const [working, setWorking] = React.useState('');
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState('Winemaker');
  const [scheduleDate, setScheduleDate] = React.useState(detail.organization.deletionScheduledAt?.slice(0, 10) || '');
  const [newOwner, setNewOwner] = React.useState('');
  const [previousOwner, setPreviousOwner] = React.useState(detail.members.find(member => member.role === 'Owner/Admin')?.username || '');
  const [lifecycleReason, setLifecycleReason] = React.useState('');
  const [ownershipReason, setOwnershipReason] = React.useState('');
  const [internalNotes, setInternalNotes] = React.useState(detail.organization.internalNotes || '');
  const [internalTags, setInternalTags] = React.useState((detail.organization.internalTags || []).join(', '));
  const [billing, setBilling] = React.useState<BillingSummary | null>(null);

  React.useEffect(() => {
    setScheduleDate(detail.organization.deletionScheduledAt?.slice(0, 10) || '');
    setPreviousOwner(detail.members.find(member => member.role === 'Owner/Admin')?.username || '');
    setNewOwner(current => detail.members.some(member => member.username === current) ? current : (detail.members.find(member => member.role !== 'Owner/Admin')?.username || ''));
    setInternalNotes(detail.organization.internalNotes || '');
    setInternalTags((detail.organization.internalTags || []).join(', '));
  }, [detail]);

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/billing/admin/overview')
      .then(async response => response.ok ? response.json() : Promise.reject(new Error('billing unavailable')))
      .then(data => {
        if (!cancelled) setBilling((data.subscriptions || []).find((item: any) => item.organizationId === detail.organization.id) || null);
      })
      .catch(() => { if (!cancelled) setBilling(null); });
    return () => { cancelled = true; };
  }, [detail.organization.id]);

  const request = async (key: string, url: string, body: Record<string, unknown>, success: string) => {
    if (working) return;
    setWorking(key);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Action failed');
      onMessage(success);
      await onRefresh();
      return data;
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Action failed');
      return null;
    } finally {
      setWorking('');
    }
  };

  const changeLifecycle = async (status: 'active' | 'suspended' | 'archived', deletionScheduledAt?: string | null) => {
    const result = await request(
      `lifecycle:${status}`,
      '/api/admin/orgs/lifecycle',
      { organizationId: detail.organization.id, status, reason: lifecycleReason.trim(), ...(deletionScheduledAt !== undefined ? { deletionScheduledAt } : {}) },
      isKa ? 'ორგანიზაციის სტატუსი განახლდა' : 'Organization lifecycle updated',
    );
    if (result) setLifecycleReason('');
    return result;
  };

  const transferOwnership = async () => {
    const result = await request('owner:transfer', '/api/admin/orgs/transfer-ownership', {
      organizationId: detail.organization.id,
      previousOwnerUsername: previousOwner,
      newOwnerUsername: newOwner,
      reason: ownershipReason.trim(),
    }, isKa ? 'მფლობელობა გადაცემულია' : 'Ownership transferred');
    if (result) setOwnershipReason('');
  };

  const saveInternalProfile = async () => request(
    'internal-profile',
    '/api/admin/orgs/internal-profile',
    {
      organizationId: detail.organization.id,
      internalNotes,
      internalTags: internalTags.split(',').map(tag => tag.trim()).filter(Boolean),
    },
    isKa ? 'შიდა კონტექსტი შენახულია' : 'Internal context saved',
  );

  const createInvitation = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await request('invite:create', '/api/admin/orgs/invitations/create', {
      organizationId: detail.organization.id, email: inviteEmail, role: inviteRole, language: isKa ? 'ka' : 'en',
    }, isKa ? 'მოწვევა გაიგზავნა' : 'Invitation sent');
    if (result) setInviteEmail('');
  };

  const tabs = [
    { id: 'overview', label: isKa ? 'მიმოხილვა' : 'Overview', icon: Activity },
    { id: 'members', label: isKa ? 'წევრები' : 'Members', icon: Users, count: detail.members.length },
    { id: 'invitations', label: isKa ? 'მოწვევები' : 'Invitations', icon: Mail, count: detail.invitations.filter(item => item.status === 'pending').length },
    { id: 'data', label: isKa ? 'მონაცემები' : 'Data health', icon: Database },
    { id: 'security', label: isKa ? 'ისტორია' : 'Security log', icon: History, count: detail.auditEvents.length },
    { id: 'billing', label: isKa ? 'ბილინგი' : 'Billing', icon: CreditCard },
  ] as const;

  const healthTone = detail.health.level === 'healthy' ? 'emerald' : detail.health.level === 'critical' ? 'red' : 'amber';
  const pendingInvitations = detail.invitations.filter(item => item.status === 'pending');

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-500/25 bg-[#0c090a] shadow-xl">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-900 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-950/25"><Building2 className="h-5 w-5 text-cyan-400" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-black text-stone-100">{detail.organization.name}</h3><span className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${detail.organization.status === 'active' ? 'border-emerald-500/25 bg-emerald-950/25 text-emerald-400' : detail.organization.status === 'suspended' ? 'border-amber-500/25 bg-amber-950/25 text-amber-400' : 'border-stone-600 bg-stone-900 text-stone-400'}`}>{detail.organization.status}</span></div>
            <p className="mt-1 text-[9px] font-mono text-stone-600">{detail.organization.id}{detail.wineryName && detail.wineryName !== detail.organization.name ? ` · ${detail.wineryName}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2"><button type="button" onClick={() => void onRefresh()} className="rounded-lg border border-stone-800 bg-stone-900 p-2 text-stone-500 hover:text-cyan-400"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button><button type="button" onClick={onClose} className="rounded-lg p-2 text-stone-600 hover:text-stone-200"><X className="h-4 w-4" /></button></div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-stone-900 bg-stone-950/40 px-3 py-2">
        {tabs.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[9px] font-black uppercase tracking-wider ${tab === item.id ? 'bg-cyan-950/35 text-cyan-300' : 'text-stone-600 hover:bg-stone-900 hover:text-stone-300'}`}><Icon className="h-3.5 w-3.5" />{item.label}{'count' in item && item.count ? <span className="rounded-full bg-stone-900 px-1.5 py-0.5 text-[8px]">{item.count}</span> : null}</button>; })}
      </nav>

      <div className="p-5">
        {tab === 'overview' && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-stone-900 bg-stone-950/45 p-4"><span className="text-[9px] uppercase text-stone-600">{isKa ? 'წევრები ონლაინ' : 'Members online'}</span><strong className="mt-2 block text-2xl text-emerald-400">{detail.members.filter(member => member.isOnline).length}<span className="text-sm text-stone-600"> / {detail.members.length}</span></strong></div>
              <div className="rounded-xl border border-stone-900 bg-stone-950/45 p-4"><span className="text-[9px] uppercase text-stone-600">{isKa ? 'ბოლო აქტივობა' : 'Last activity'}</span><strong className="mt-2 block text-sm text-stone-300">{relativeTime(detail.lastActivity, isKa)}</strong></div>
              <div className="rounded-xl border border-stone-900 bg-stone-950/45 p-4"><span className="text-[9px] uppercase text-stone-600">{isKa ? 'მონაცემთა ზომა' : 'Data footprint'}</span><strong className="mt-2 block text-sm text-cyan-300">{formatBytes(detail.dataSizeBytes)}</strong></div>
              <div className="rounded-xl border border-stone-900 bg-stone-950/45 p-4"><span className="text-[9px] uppercase text-stone-600">{isKa ? 'მოლოდინში მოწვევები' : 'Pending invitations'}</span><strong className="mt-2 block text-2xl text-purple-400">{pendingInvitations.length}</strong></div>
            </div>

            <div className={`rounded-xl border p-4 ${healthTone === 'emerald' ? 'border-emerald-500/25 bg-emerald-950/10' : healthTone === 'red' ? 'border-red-500/30 bg-red-950/10' : 'border-amber-500/25 bg-amber-950/10'}`}>
              <div className="flex items-center gap-2">{detail.health.level === 'healthy' ? <HeartPulse className="h-4 w-4 text-emerald-400" /> : <ShieldAlert className={`h-4 w-4 ${detail.health.level === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />}<strong className="text-[10px] uppercase tracking-wider text-stone-300">{isKa ? 'ორგანიზაციის ჯანმრთელობა' : 'Organization health'} · {detail.health.level}</strong></div>
              {detail.health.issues.length ? <ul className="mt-3 space-y-1 text-[10px] text-stone-400">{detail.health.issues.map(issue => <li key={issue}>• {issue}</li>)}</ul> : <p className="mt-2 text-[10px] text-emerald-400/75">{isKa ? 'კრიტიკული პრობლემა არ გამოვლენილა.' : 'No critical operational issues detected.'}</p>}
            </div>

            <section className="rounded-xl border border-cyan-900/25 bg-cyan-950/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider text-cyan-400"><Tag className="h-3.5 w-3.5" />{isKa ? 'შიდა ადმინისტრაციული კონტექსტი' : 'Internal admin context'}</h4><p className="mt-1 text-[9px] text-stone-600">{isKa ? 'ხილულია მხოლოდ მთავარი ადმინისტრატორებისთვის.' : 'Visible only to master administrators—never to tenant users.'}</p></div><button type="button" disabled={!!working} onClick={() => void saveInternalProfile()} className="flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-950/25 px-3 py-2 text-[9px] font-bold text-cyan-300 disabled:opacity-40">{working === 'internal-profile' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{isKa ? 'შენახვა' : 'Save context'}</button></div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,.45fr)]"><textarea value={internalNotes} onChange={event => setInternalNotes(event.target.value)} maxLength={2000} rows={3} placeholder={isKa ? 'მაგ. მხარდაჭერის ისტორია, განახლების რისკები, შეთანხმებული შემდეგი ნაბიჯი…' : 'Support history, renewal risk, agreed next step…'} className="resize-y rounded-lg border border-stone-800 bg-stone-950 px-3 py-2.5 text-[10px] leading-5 text-stone-300 outline-none focus:border-cyan-500/30" /><div><input value={internalTags} onChange={event => setInternalTags(event.target.value)} placeholder={isKa ? 'VIP, განახლების რისკი, onboarding' : 'VIP, renewal risk, onboarding'} className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2.5 text-[10px] text-stone-300 outline-none focus:border-cyan-500/30" /><p className="mt-1.5 text-[8px] text-stone-700">{isKa ? 'მძიმით გამოყოფილი · მაქს. 10 ტეგი' : 'Comma separated · maximum 10 tags'}</p></div></div>
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-stone-900 p-4">
                <h4 className="text-[9px] font-black uppercase tracking-wider text-stone-500">{isKa ? 'წვდომის მდგომარეობა' : 'Access lifecycle'}</h4>
                <input value={lifecycleReason} onChange={event => setLifecycleReason(event.target.value)} maxLength={300} placeholder={isKa ? 'ცვლილების მიზეზი (სავალდებულო)' : 'Reason for change (required)'} className="mt-3 w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-[10px] text-stone-300 outline-none focus:border-amber-500/30" />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button type="button" disabled={!!working || lifecycleReason.trim().length < 5 || detail.organization.status === 'active'} onClick={() => void changeLifecycle('active')} className="rounded-lg border border-emerald-500/20 bg-emerald-950/15 px-2 py-2 text-[9px] font-bold text-emerald-400 disabled:opacity-30"><RotateCcw className="mx-auto mb-1 h-3.5 w-3.5" />{isKa ? 'აღდგენა' : 'Restore'}</button>
                  <button type="button" disabled={!!working || lifecycleReason.trim().length < 5 || detail.organization.status === 'suspended'} onClick={() => void changeLifecycle('suspended')} className="rounded-lg border border-amber-500/20 bg-amber-950/15 px-2 py-2 text-[9px] font-bold text-amber-400 disabled:opacity-30"><Clock3 className="mx-auto mb-1 h-3.5 w-3.5" />{isKa ? 'შეჩერება' : 'Suspend'}</button>
                  <button type="button" disabled={!!working || lifecycleReason.trim().length < 5 || detail.organization.status === 'archived'} onClick={() => void changeLifecycle('archived')} className="rounded-lg border border-stone-700 bg-stone-900 px-2 py-2 text-[9px] font-bold text-stone-400 disabled:opacity-30"><Archive className="mx-auto mb-1 h-3.5 w-3.5" />{isKa ? 'არქივი' : 'Archive'}</button>
                </div>
                <div className="mt-4 border-t border-stone-900 pt-3"><label className="text-[9px] text-stone-600">{isKa ? 'წაშლის დაგეგმილი თარიღი' : 'Scheduled deletion date'}</label><div className="mt-1 flex gap-2"><input type="date" value={scheduleDate} onChange={event => setScheduleDate(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-stone-800 bg-stone-950 px-2 py-2 text-[10px] text-stone-300" /><button type="button" disabled={!!working || lifecycleReason.trim().length < 5} onClick={() => void changeLifecycle(detail.organization.status, scheduleDate ? new Date(`${scheduleDate}T12:00:00Z`).toISOString() : null)} className="rounded-lg border border-red-500/20 px-3 text-[9px] font-bold text-red-400 disabled:opacity-30">{scheduleDate ? (isKa ? 'დაგეგმვა' : 'Schedule') : (isKa ? 'გაუქმება' : 'Clear')}</button></div></div>
              </div>

              <div className="rounded-xl border border-stone-900 p-4">
                <h4 className="text-[9px] font-black uppercase tracking-wider text-stone-500">{isKa ? 'მფლობელობის გადაცემა' : 'Ownership transfer'}</h4>
                <p className="mt-1 text-[9px] leading-4 text-stone-600">{isKa ? 'ახალი მფლობელი მიიღებს Owner/Admin როლს; წინა მფლობელი გახდება Winemaker.' : 'The new owner receives Owner/Admin; the previous owner becomes Winemaker.'}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2"><select value={previousOwner} onChange={event => setPreviousOwner(event.target.value)} className="rounded-lg border border-stone-800 bg-stone-950 px-2 py-2 text-[10px] text-stone-300">{detail.members.filter(member => member.role === 'Owner/Admin').map(member => <option key={member.username} value={member.username}>{isKa ? 'დან' : 'From'} @{member.username}</option>)}</select><select value={newOwner} onChange={event => setNewOwner(event.target.value)} className="rounded-lg border border-stone-800 bg-stone-950 px-2 py-2 text-[10px] text-stone-300"><option value="">{isKa ? 'აირჩიეთ ახალი მფლობელი' : 'Choose new owner'}</option>{detail.members.filter(member => member.username !== previousOwner).map(member => <option key={member.username} value={member.username}>@{member.username} · {member.role}</option>)}</select></div>
                <input value={ownershipReason} onChange={event => setOwnershipReason(event.target.value)} maxLength={300} placeholder={isKa ? 'გადაცემის მიზეზი (სავალდებულო)' : 'Transfer reason (required)'} className="mt-2 w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-[10px] text-stone-300 outline-none focus:border-purple-500/30" />
                <button type="button" disabled={!newOwner || ownershipReason.trim().length < 5 || !!working} onClick={() => void transferOwnership()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-purple-500/20 bg-purple-950/15 py-2 text-[9px] font-bold text-purple-300 disabled:opacity-30"><UserRoundCheck className="h-3.5 w-3.5" />{isKa ? 'მფლობელობის გადაცემა' : 'Transfer ownership'}</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'members' && <div className="space-y-2">{detail.members.map(member => <article key={member.username} className="flex flex-col gap-3 rounded-xl border border-stone-900 bg-stone-950/40 p-4 sm:flex-row sm:items-center"><div className="flex min-w-0 flex-1 items-center gap-3"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${member.isOnline ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.8)]' : 'bg-stone-700'}`} title={member.isOnline ? (isKa ? 'ონლაინ' : 'Online') : (isKa ? 'ოფლაინ' : 'Offline')} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs text-stone-200">{member.fullName}</strong><span className="text-[9px] text-stone-600">@{member.username}</span>{member.isActiveWorkspace && <span className="rounded-full border border-cyan-500/20 px-1.5 py-0.5 text-[8px] text-cyan-400">{isKa ? 'აქტიური' : 'active'}</span>}</div><p className="mt-1 truncate text-[9px] text-stone-600">{member.email} · {member.isOnline ? (isKa ? 'ონლაინ' : 'Online') : `${isKa ? 'ბოლოს' : 'last seen'} ${relativeTime(member.lastSeenAt, isKa)}`}</p></div></div><span className="rounded-lg border border-stone-800 bg-stone-900 px-2.5 py-1.5 text-[9px] font-bold text-stone-300">{member.role}</span><button type="button" onClick={() => onManageUser(member.username)} className="flex items-center justify-center gap-1.5 rounded-lg border border-purple-500/20 px-3 py-2 text-[9px] font-bold text-purple-300"><UserCog className="h-3.5 w-3.5" />{isKa ? 'მართვა' : 'Manage'}</button></article>)}</div>}

        {tab === 'invitations' && <div className="grid gap-5 xl:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]"><form onSubmit={createInvitation} className="space-y-3 rounded-xl border border-purple-500/20 bg-purple-950/10 p-4"><h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-purple-300"><Send className="h-4 w-4" />{isKa ? 'ახალი მოწვევა' : 'Invite a user'}</h4><input type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="person@example.com" className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2.5 text-xs text-stone-200 outline-none focus:border-purple-500/40" /><select value={inviteRole} onChange={event => setInviteRole(event.target.value)} className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2.5 text-xs text-stone-200">{ROLES.map(role => <option key={role}>{role}</option>)}</select><button type="submit" disabled={!!working} className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-700 py-2.5 text-[10px] font-black text-white disabled:opacity-40">{working === 'invite:create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}{isKa ? 'მოწვევის გაგზავნა' : 'Send invitation'}</button></form><div className="space-y-2">{detail.invitations.length === 0 ? <div className="rounded-xl border border-stone-900 p-8 text-center text-xs text-stone-600">{isKa ? 'მოწვევები არ არის.' : 'No invitations yet.'}</div> : detail.invitations.map(invitation => <article key={invitation.id} className="flex flex-col gap-3 rounded-xl border border-stone-900 bg-stone-950/40 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><strong className="block truncate text-xs text-stone-300">{invitation.email}</strong><p className="mt-1 text-[9px] text-stone-600">{invitation.role} · {invitation.status} · {new Date(invitation.expiresAt).toLocaleDateString()}</p></div>{invitation.status !== 'accepted' && <div className="flex gap-2"><button type="button" disabled={!!working} onClick={() => void request(`invite:resend:${invitation.id}`, '/api/admin/orgs/invitations/resend', { invitationId: invitation.id, language: isKa ? 'ka' : 'en' }, isKa ? 'მოწვევა ხელახლა გაიგზავნა' : 'Invitation resent')} className="rounded-lg border border-cyan-500/20 p-2 text-cyan-400" title={isKa ? 'ხელახლა გაგზავნა' : 'Resend'}><RefreshCw className="h-3.5 w-3.5" /></button>{invitation.status === 'pending' && <button type="button" disabled={!!working} onClick={() => void request(`invite:revoke:${invitation.id}`, '/api/admin/orgs/invitations/revoke', { invitationId: invitation.id }, isKa ? 'მოწვევა გაუქმდა' : 'Invitation revoked')} className="rounded-lg border border-red-500/20 p-2 text-red-400" title={isKa ? 'გაუქმება' : 'Revoke'}><Trash2 className="h-3.5 w-3.5" /></button>}</div>}</article>)}</div></div>}

        {tab === 'data' && <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-stone-900 p-4"><span className="text-[9px] uppercase text-stone-600">{isKa ? 'კოლექციები' : 'Collections'}</span><strong className="mt-2 block text-xl text-cyan-300">{detail.collections.length}</strong></div><div className="rounded-xl border border-stone-900 p-4"><span className="text-[9px] uppercase text-stone-600">{isKa ? 'ჩანაწერები' : 'Records'}</span><strong className="mt-2 block text-xl text-purple-300">{detail.collections.reduce((sum, item) => sum + item.count, 0)}</strong></div><div className="rounded-xl border border-stone-900 p-4"><span className="text-[9px] uppercase text-stone-600">{isKa ? 'ზომა' : 'Serialized size'}</span><strong className="mt-2 block text-xl text-emerald-300">{formatBytes(detail.dataSizeBytes)}</strong></div></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{detail.collections.map(collection => <div key={collection.key} className={`rounded-xl border p-3 ${collection.count ? 'border-cyan-900/30 bg-stone-950/50' : 'border-stone-900 bg-stone-950/20'}`}><span className="block truncate text-[9px] font-bold uppercase text-stone-600" title={collection.key}>{collection.key}</span><strong className={collection.count ? 'text-lg text-cyan-300' : 'text-lg text-stone-800'}>{collection.count}</strong><span className="block truncate text-[8px] text-stone-700">{collection.lastModified ? relativeTime(collection.lastModified, isKa) : (isKa ? 'ცარიელი' : 'empty')}</span></div>)}</div></div>}

        {tab === 'security' && <div className="space-y-2">{detail.auditEvents.length === 0 ? <div className="rounded-xl border border-stone-900 p-8 text-center text-xs text-stone-600">{isKa ? 'აუდიტის ჩანაწერები არ არის.' : 'No audit events for this organization.'}</div> : detail.auditEvents.map((event, index) => <article key={event.id || `${event.createdAt}-${index}`} className="rounded-xl border border-stone-900 bg-stone-950/35 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-[10px] text-cyan-300">{event.eventType}</strong><time className="text-[9px] text-stone-600">{new Date(event.createdAt).toLocaleString()}</time></div><p className="mt-1 text-[9px] text-stone-500">{event.actorUsername ? `@${event.actorUsername}` : 'system'}{event.username ? ` → @${event.username}` : ''}</p>{event.metadata && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[8px] leading-4 text-stone-700">{JSON.stringify(event.metadata, null, 2)}</pre>}</article>)}</div>}

        {tab === 'billing' && <div className="space-y-4"><div className="rounded-xl border border-cyan-900/30 bg-cyan-950/10 p-5">{billing ? <div className="grid gap-4 sm:grid-cols-4"><div><span className="text-[9px] uppercase text-stone-600">{isKa ? 'გეგმა' : 'Plan'}</span><strong className="mt-1 block text-sm text-cyan-300">{billing.planId}</strong></div><div><span className="text-[9px] uppercase text-stone-600">{isKa ? 'სტატუსი' : 'Status'}</span><strong className="mt-1 block text-sm text-stone-300">{billing.status}</strong></div><div><span className="text-[9px] uppercase text-stone-600">{isKa ? 'ინტერვალი' : 'Interval'}</span><strong className="mt-1 block text-sm text-stone-300">{billing.billingInterval}</strong></div><div><span className="text-[9px] uppercase text-stone-600">{isKa ? 'განახლება' : 'Renews'}</span><strong className="mt-1 block text-sm text-stone-300">{billing.renewsAt ? new Date(billing.renewsAt).toLocaleDateString() : '—'}</strong></div></div> : <p className="text-xs text-stone-500">{isKa ? 'ამ ორგანიზაციას გამოწერა ჯერ არ აქვს მინიჭებული.' : 'No subscription is assigned to this organization yet.'}</p>}</div><button type="button" onClick={() => onOpenBilling(detail.organization.id)} className="flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2.5 text-[10px] font-black text-white"><CreditCard className="h-4 w-4" />{isKa ? 'გამოწერის სრული მართვა' : 'Open full subscription controls'}</button></div>}
      </div>
    </section>
  );
}
