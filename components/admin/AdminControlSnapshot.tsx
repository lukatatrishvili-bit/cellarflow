import React from 'react';

interface Props {
  isKa: boolean;
  onlineUsers: number;
  activeOrganizations: number;
  totalOrganizations: number;
  organizationsNeedingAttention: number;
  pendingInvitations: number;
  pendingAccess: number;
  onOnlineUsers: () => void;
  onActiveOrganizations: () => void;
  onAttention: () => void;
  onInvitations: () => void;
  onPendingAccess: () => void;
}

export default function AdminControlSnapshot(props: Props) {
  const cards = [
    { label: props.isKa ? 'ონლაინ მომხმარებლები' : 'Online users', value: props.onlineUsers, tone: 'emerald', action: props.onOnlineUsers },
    { label: props.isKa ? 'აქტიური ორგანიზაციები' : 'Active organizations', value: `${props.activeOrganizations} / ${props.totalOrganizations}`, tone: 'cyan', action: props.onActiveOrganizations },
    { label: props.isKa ? 'საჭიროებს ყურადღებას' : 'Needs attention', value: props.organizationsNeedingAttention, tone: 'amber', action: props.onAttention },
    { label: props.isKa ? 'მოლოდინში მოწვევები' : 'Pending invitations', value: props.pendingInvitations, tone: 'purple', action: props.onInvitations },
    { label: props.isKa ? 'დასამტკიცებელი წვდომა' : 'Pending access', value: props.pendingAccess, tone: 'red', action: props.onPendingAccess },
  ] as const;

  const toneClass = (tone: string) => ({
    emerald: 'border-emerald-500/15 hover:border-emerald-500/35 text-emerald-400',
    cyan: 'border-cyan-500/15 hover:border-cyan-500/35 text-cyan-400',
    amber: 'border-amber-500/15 hover:border-amber-500/35 text-amber-400',
    purple: 'border-purple-500/15 hover:border-purple-500/35 text-purple-400',
    red: 'border-red-500/15 hover:border-red-500/35 text-red-400',
  }[tone] || 'border-stone-800 text-stone-300');

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/20 to-[#0c090a] p-5 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xs font-black uppercase tracking-wider text-cyan-300">{props.isKa ? 'კონტროლის მოკლე მიმოხილვა' : 'Tenant control snapshot'}</h2><p className="mt-1 text-[10px] text-stone-600">{props.isKa ? 'ადამიანები, წვდომა და ორგანიზაციების ჯანმრთელობა ერთ ხედში.' : 'People, access, and organization health in one operational view.'}</p></div>
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-950/20 px-2.5 py-1 text-[9px] font-bold text-emerald-400"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,.8)]" />{props.onlineUsers} {props.isKa ? 'ონლაინ' : 'online now'}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(card => <button key={card.label} type="button" onClick={card.action} className={`rounded-xl bg-stone-950/45 p-4 text-left ${toneClass(card.tone)}`}><span className="text-[9px] uppercase text-stone-600">{card.label}</span><strong className="mt-2 block text-2xl">{card.value}</strong></button>)}
      </div>
    </section>
  );
}
