import React from 'react';
import { motion } from 'motion/react';
import {
  Building2, Copy, CreditCard, Database, Download, Edit3, ExternalLink,
  Loader2, Mail, ShieldCheck, Trash2, Users, Wifi, X,
} from 'lucide-react';
import { useFocusTrap } from '../useFocusTrap';

interface QuickOrganization {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'archived';
  membersCount: number;
  ownersCount: number;
  onlineMembersCount: number;
  pendingInvitationsCount: number;
  lotsCount: number;
  dataSize: number;
  health: { level: 'healthy' | 'warning' | 'critical'; issues: string[] };
}

interface Props {
  organization: QuickOrganization;
  isKa: boolean;
  name: string;
  deleteConfirmation: string;
  saving: boolean;
  deleting: boolean;
  onNameChange: (name: string) => void;
  onDeleteConfirmationChange: (name: string) => void;
  onRename: (event: React.FormEvent) => void;
  onDelete: () => void;
  onClose: () => void;
  onCopyId: () => void;
  onOpenControlCenter: () => void;
  onOpenBilling: () => void;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function AdminOrganizationQuickActions(props: Props) {
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, { active: true, onClose: props.onClose });
  const org = props.organization;
  const statusTone = org.status === 'active'
    ? 'border-emerald-500/25 bg-emerald-950/20 text-emerald-400'
    : org.status === 'suspended'
      ? 'border-amber-500/25 bg-amber-950/20 text-amber-400'
      : 'border-stone-700 bg-stone-900 text-stone-400';

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={props.onClose} className="admin-modal-backdrop fixed inset-0 z-55 bg-black/60 backdrop-blur-xs" />
      <div className="fixed inset-0 z-55 flex items-center justify-center p-3 sm:p-5">
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="master-admin-manage-org-title"
          tabIndex={-1}
          initial={{ scale: .97, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: .97, opacity: 0, y: 10 }}
          className="admin-modal-panel max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border p-4 text-left shadow-2xl sm:p-6"
        >
          <header className="flex items-start justify-between gap-4 border-b border-stone-900 pb-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-950/20 text-purple-400"><Building2 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="master-admin-manage-org-title" className="truncate text-sm font-black text-stone-100">{org.name}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase ${statusTone}`}>{org.status}</span>
                </div>
                <button type="button" onClick={props.onCopyId} className="mt-1 flex items-center gap-1.5 font-mono text-[9px] text-stone-500 hover:text-cyan-400" title={props.isKa ? 'ID-ის კოპირება' : 'Copy organization ID'}><Copy className="h-3 w-3" />{org.id}</button>
              </div>
            </div>
            <button type="button" onClick={props.onClose} aria-label={props.isKa ? 'ფანჯრის დახურვა' : 'Close dialog'} className="rounded-lg p-2 text-stone-500 hover:bg-stone-900 hover:text-stone-200"><X className="h-4 w-4" /></button>
          </header>

          <section className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: props.isKa ? 'წევრები' : 'Members', value: org.membersCount, icon: Users, tone: 'text-cyan-400' },
              { label: props.isKa ? 'მფლობელები' : 'Owners', value: org.ownersCount, icon: ShieldCheck, tone: 'text-purple-400' },
              { label: props.isKa ? 'ონლაინ' : 'Online', value: org.onlineMembersCount, icon: Wifi, tone: 'text-emerald-400' },
              { label: props.isKa ? 'მოწვევები' : 'Invites', value: org.pendingInvitationsCount, icon: Mail, tone: 'text-amber-400' },
              { label: props.isKa ? 'პარტიები' : 'Lots', value: org.lotsCount, icon: Database, tone: 'text-cyan-400' },
              { label: props.isKa ? 'მონაცემები' : 'Data', value: formatBytes(org.dataSize), icon: Database, tone: 'text-stone-300' },
            ].map(item => { const Icon = item.icon; return <div key={item.label} className="rounded-xl border border-stone-900 bg-stone-950/50 p-3"><div className="flex items-center justify-between"><span className="text-[8px] font-bold uppercase text-stone-600">{item.label}</span><Icon className={`h-3.5 w-3.5 ${item.tone}`} /></div><strong className="mt-2 block text-base text-stone-200">{item.value}</strong></div>; })}
          </section>

          <section className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={props.onOpenControlCenter} className="flex items-center justify-between rounded-xl border border-cyan-500/25 bg-cyan-950/20 p-4 text-left text-cyan-300 transition-colors hover:bg-cyan-950/35"><span><strong className="block text-xs">{props.isKa ? 'სრული მართვის ცენტრი' : 'Full control center'}</strong><span className="mt-1 block text-[9px] text-stone-500">{props.isKa ? 'წევრები, მოწვევები, უსაფრთხოება და მონაცემები' : 'Members, invitations, security, lifecycle and data health'}</span></span><ExternalLink className="h-4 w-4" /></button>
            <button type="button" onClick={props.onOpenBilling} className="flex items-center justify-between rounded-xl border border-purple-500/20 bg-purple-950/15 p-4 text-left text-purple-300 transition-colors hover:bg-purple-950/30"><span><strong className="block text-xs">{props.isKa ? 'გეგმა და ბილინგი' : 'Plan and billing'}</strong><span className="mt-1 block text-[9px] text-stone-500">{props.isKa ? 'გამოწერა, ლიმიტები და განახლება' : 'Subscription, limits, overrides and renewal'}</span></span><CreditCard className="h-4 w-4" /></button>
            <a href={`/api/admin/orgs/export?id=${encodeURIComponent(org.id)}`} className="flex items-center justify-between rounded-xl border border-stone-800 bg-stone-950/45 p-4 text-left text-stone-300 transition-colors hover:border-cyan-500/30 hover:text-cyan-400"><span><strong className="block text-xs">{props.isKa ? 'ორგანიზაციის ბექაფი' : 'Organization backup'}</strong><span className="mt-1 block text-[9px] text-stone-500">{props.isKa ? 'უსაფრთხო JSON ექსპორტის ჩამოტვირთვა' : 'Download a credential-safe JSON export'}</span></span><Download className="h-4 w-4" /></a>
            <div className={`rounded-xl border p-4 ${org.health.level === 'healthy' ? 'border-emerald-500/20 bg-emerald-950/10' : org.health.level === 'critical' ? 'border-red-500/25 bg-red-950/10' : 'border-amber-500/20 bg-amber-950/10'}`}><div className="flex items-center justify-between"><strong className="text-xs text-stone-300">{props.isKa ? 'ჯანმრთელობა' : 'Organization health'}</strong><span className="text-[9px] font-bold uppercase text-stone-500">{org.health.level}</span></div><p className="mt-1 line-clamp-2 text-[9px] text-stone-500">{org.health.issues.length ? org.health.issues.join(' · ') : (props.isKa ? 'პრობლემა არ გამოვლენილა' : 'No operational issues detected')}</p></div>
          </section>

          <form onSubmit={props.onRename} className="mt-5 rounded-xl border border-stone-900 bg-stone-950/30 p-4">
            <label className="block text-[9px] font-bold uppercase text-stone-500">{props.isKa ? 'რეესტრის სახელი' : 'Registry name'}</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input value={props.name} onChange={event => props.onNameChange(event.target.value)} minLength={2} maxLength={120} required className="min-w-0 flex-1 rounded-xl border border-stone-800 bg-stone-950 px-3 py-2.5 text-xs text-stone-200 outline-none focus:border-purple-500/40" />
              <button type="submit" disabled={props.saving || props.name.trim() === org.name} className="flex items-center justify-center gap-2 rounded-xl border border-purple-500/25 bg-purple-950/25 px-5 py-2.5 text-xs font-bold text-purple-300 disabled:cursor-not-allowed"><Edit3 className="h-3.5 w-3.5" />{props.saving ? (props.isKa ? 'ინახება…' : 'Saving…') : (props.isKa ? 'სახელის შენახვა' : 'Save name')}</button>
            </div>
          </form>

          <details className="mt-4 rounded-xl border border-red-500/20 bg-red-950/10 p-4">
            <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-red-400">{props.isKa ? 'საფრთხის ზონა' : 'Danger zone'}</summary>
            <p className="mt-3 text-[9px] leading-5 text-red-300/80">{props.isKa ? 'ორგანიზაციის წაშლა სამუდამოდ შლის ყველა მარნის ჩანაწერს, წევრობასა და მოწვევას.' : 'Permanent deletion removes every winery record, membership, and invitation. Download a backup first.'}</p>
            <label className="mt-3 block text-[9px] text-stone-500">{props.isKa ? `დასადასტურებლად აკრიფეთ: ${org.name}` : `Type ${org.name} to confirm`}</label>
            <input value={props.deleteConfirmation} onChange={event => props.onDeleteConfirmationChange(event.target.value)} className="mt-1 w-full rounded-xl border border-red-500/25 bg-stone-950 px-3 py-2.5 text-xs text-red-200 outline-none focus:border-red-500/50" />
            <button type="button" onClick={props.onDelete} disabled={props.deleting || props.deleteConfirmation !== org.name} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-950/30 py-2.5 text-xs font-bold text-red-400 disabled:cursor-not-allowed">{props.deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}{props.isKa ? 'ორგანიზაციის და მონაცემების წაშლა' : 'Delete organization and all data'}</button>
          </details>
        </motion.div>
      </div>
    </>
  );
}
