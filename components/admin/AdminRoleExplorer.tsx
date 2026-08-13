import React from 'react';
import { Check, Eye, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';

interface RolePermissionRecord {
  role: string;
  permissions: Record<string, string[]>;
}

const ACTIONS = ['view', 'create', 'update', 'delete', 'export'] as const;

export default function AdminRoleExplorer({ isKa, onMessage }: { isKa: boolean; onMessage: (message: string) => void }) {
  const [roles, setRoles] = React.useState<RolePermissionRecord[]>([]);
  const [selectedRole, setSelectedRole] = React.useState('Owner/Admin');
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/role-permissions');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to load role permissions');
      setRoles(data.roles || []);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Unable to load role permissions');
    } finally {
      setLoading(false);
    }
  }, [onMessage]);

  React.useEffect(() => { void load(); }, [load]);

  const selected = roles.find(item => item.role === selectedRole) || roles[0];
  const modules = Array.from(new Set(roles.flatMap(role => Object.keys(role.permissions)))).sort();

  if (loading && !roles.length) {
    return <div className="flex h-64 items-center justify-center gap-2 text-cyan-400"><Loader2 className="h-5 w-5 animate-spin" /> {isKa ? 'წვდომები იტვირთება…' : 'Loading access model…'}</div>;
  }

  return (
    <div className="space-y-5 text-left">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-cyan-300"><ShieldCheck className="h-5 w-5" /> {isKa ? 'როლები და უფლებები' : 'Roles & permissions'}</h2>
          <p className="mt-1 max-w-2xl text-[10px] leading-5 text-stone-500">{isKa ? 'ეს არის სერვერზე აღსრულებული წვდომის რეალური მოდელი. აირჩიეთ როლი და წინასწარ ნახეთ, რას შეძლებს მომხმარებელი.' : 'This is the access model enforced by the server. Select a role to preview exactly what a user can do.'}</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-lg border border-stone-800 bg-stone-900 p-2 text-stone-500 hover:text-cyan-400" title={isKa ? 'განახლება' : 'Refresh'}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-2 rounded-2xl border border-cyan-900/25 bg-[#0c090a] p-3">
          {roles.map(record => (
            <button key={record.role} type="button" onClick={() => setSelectedRole(record.role)} className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${selected?.role === record.role ? 'border-cyan-500/35 bg-cyan-950/25 text-cyan-300' : 'border-transparent text-stone-500 hover:bg-stone-900 hover:text-stone-300'}`}>
              <span className="block text-[11px] font-black">{record.role}</span>
              <span className="mt-1 block text-[9px] text-stone-600">{Object.keys(record.permissions).length} {isKa ? 'მოდული' : 'modules'}</span>
            </button>
          ))}
        </aside>

        <section className="overflow-hidden rounded-2xl border border-cyan-900/25 bg-[#0c090a]">
          <div className="border-b border-stone-900 px-5 py-4">
            <h3 className="text-xs font-black text-stone-200">{selected?.role}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-[9px] text-stone-600"><Eye className="h-3 w-3" /> {isKa ? 'ამ როლის წვდომის წინასწარი ნახვა' : 'Effective access preview for this role'}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[10px]">
              <thead><tr className="border-b border-stone-900 bg-stone-950/70 uppercase tracking-wider text-stone-600"><th className="px-5 py-3">{isKa ? 'მოდული' : 'Module'}</th>{ACTIONS.map(action => <th key={action} className="px-3 py-3 text-center">{action}</th>)}</tr></thead>
              <tbody className="divide-y divide-stone-900/70">
                {modules.map(module => {
                  const allowed = selected?.permissions[module] || [];
                  return <tr key={module} className="hover:bg-stone-900/25"><td className="px-5 py-3 font-bold text-stone-300">{module.replace(/_/g, ' ')}</td>{ACTIONS.map(action => <td key={action} className="px-3 py-3 text-center">{allowed.includes(action) ? <Check className="mx-auto h-3.5 w-3.5 text-emerald-400" /> : <X className="mx-auto h-3.5 w-3.5 text-stone-800" />}</td>)}</tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
