import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Filter, Hash, Search, ShieldCheck, X } from 'lucide-react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import { buildAuditHashChain } from '../lib/auditHash';
import type { MaraniOSAuditLog } from '../lib/wineryState';

interface AuditTrailTabProps {
  lang: Language;
  auditLogs: MaraniOSAuditLog[];
}

type ModuleFilter = 'all' | MaraniOSAuditLog['module'];
type TimeFilter = 'all' | '24h' | '7d' | '30d';

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

export default function AuditTrailTab({ lang, auditLogs }: AuditTrailTabProps) {
  const t = translations[lang];
  const [searchTerm, setSearchTerm] = useState('');
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const verification = useMemo(() => buildAuditHashChain(auditLogs), [auditLogs]);

  const moduleLabel = (module: MaraniOSAuditLog['module']) => {
    if (module === 'VAZI') return t.nav_vazi || 'Vazi';
    if (module === 'MARANIOS') return 'System';
    return t.nav_gvino || 'Gvino';
  };

  const timeFilterLabel = (value: TimeFilter) => {
    if (value === '24h') return lang === 'ka' ? '24 საათი' : 'Last 24h';
    if (value === '7d') return lang === 'ka' ? '7 დღე' : 'Last 7 days';
    if (value === '30d') return lang === 'ka' ? '30 დღე' : 'Last 30 days';
    return t.all || 'All';
  };

  const moduleCounts = useMemo(() => auditLogs.reduce<Record<MaraniOSAuditLog['module'], number>>((acc, log) => {
    acc[log.module] = (acc[log.module] || 0) + 1;
    return acc;
  }, { GVINO: 0, VAZI: 0, MARANIOS: 0 }), [auditLogs]);

  const filteredLogs = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const now = Date.now();
    const cutoff =
      timeFilter === '24h' ? now - 24 * 60 * 60 * 1000 :
      timeFilter === '7d' ? now - 7 * 24 * 60 * 60 * 1000 :
      timeFilter === '30d' ? now - 30 * 24 * 60 * 60 * 1000 :
      null;

    return auditLogs.filter(log => {
      if (moduleFilter !== 'all' && log.module !== moduleFilter) return false;
      if (cutoff != null) {
        const timestamp = new Date(log.timestamp).getTime();
        if (Number.isFinite(timestamp) && timestamp < cutoff) return false;
      }
      if (!query) return true;

      return [
        log.timestamp,
        moduleLabel(log.module),
        log.module,
        log.user,
        log.actionType,
        log.changedItem,
        log.oldValue,
        log.newValue,
        log.notes,
        verification.byId[log.id]?.hash,
        verification.byId[log.id]?.sequence,
      ].some(value => String(value || '').toLowerCase().includes(query));
    });
  }, [auditLogs, moduleFilter, searchTerm, timeFilter, verification.byId]);

  const hasActiveFilters = !!searchTerm || moduleFilter !== 'all' || timeFilter !== 'all';
  const verifiedCount = verification.verifiedCount;

  const resetFilters = () => {
    setSearchTerm('');
    setModuleFilter('all');
    setTimeFilter('all');
  };

  const exportCsv = () => {
    const headers = ['Timestamp', 'Module', 'User', 'Action', 'Item', 'Before', 'After', 'Notes', 'Record #', 'Chain Hash', 'Previous Hash', 'Algorithm', 'Persisted', 'Valid'];
    const rows = filteredLogs.map(log => [
      log.timestamp,
      moduleLabel(log.module),
      log.user,
      log.actionType,
      log.changedItem,
      log.oldValue || '',
      log.newValue || '',
      log.notes || '',
      verification.byId[log.id]?.sequence || '',
      verification.byId[log.id]?.hash || '',
      verification.byId[log.id]?.previousHash || '',
      verification.byId[log.id]?.algorithm || verification.algorithm,
      verification.byId[log.id]?.persisted ? 'yes' : 'computed',
      verification.byId[log.id]?.valid ? 'yes' : 'no',
    ]);
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col space-y-6 font-sans text-stone-700 text-xs animate-fade-in">
      <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <span className="text-[9px] uppercase tracking-widest bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded font-bold">PDO Traceability</span>
            <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-700" />
              {t.audit_title || 'SaaS Corporate Action Audit Trails'}
            </h3>
            <p className="text-xs text-stone-400 font-semibold mt-0.5">
              {t.audit_subtitle || 'Chronological action logs ledger strictly verifying viticultural and winemaking authenticity'}
            </p>
          </div>

          <button
            type="button"
            onClick={exportCsv}
            disabled={filteredLogs.length === 0}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#4e0e15] text-amber-50 disabled:opacity-50 disabled:cursor-not-allowed text-[10px] font-black uppercase tracking-widest hover:bg-[#34070a] transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {lang === 'ka' ? 'CSV ექსპორტი' : 'Export CSV'}
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="rounded-xl border border-stone-100 bg-[#FAF8F5]/70 p-3">
            <span className="block text-[9px] uppercase font-mono font-bold tracking-widest text-stone-400">{lang === 'ka' ? 'სულ' : 'Total logs'}</span>
            <strong className="block mt-1 text-lg font-serif text-stone-900">{auditLogs.length.toLocaleString()}</strong>
          </div>
          <div className="rounded-xl border border-stone-100 bg-[#FAF8F5]/70 p-3">
            <span className="block text-[9px] uppercase font-mono font-bold tracking-widest text-stone-400">{lang === 'ka' ? 'ნაჩვენებია' : 'Showing'}</span>
            <strong className="block mt-1 text-lg font-serif text-[#4e0e15]">{filteredLogs.length.toLocaleString()}</strong>
          </div>
          <div className="rounded-xl border border-stone-100 bg-[#FAF8F5]/70 p-3">
            <span className="block text-[9px] uppercase font-mono font-bold tracking-widest text-stone-400">{moduleLabel('GVINO')}</span>
            <strong className="block mt-1 text-lg font-serif text-stone-900">{moduleCounts.GVINO.toLocaleString()}</strong>
          </div>
          <div className="rounded-xl border border-stone-100 bg-[#FAF8F5]/70 p-3">
            <span className="block text-[9px] uppercase font-mono font-bold tracking-widest text-stone-400">{moduleLabel('VAZI')} / System</span>
            <strong className="block mt-1 text-lg font-serif text-stone-900">{(moduleCounts.VAZI + moduleCounts.MARANIOS).toLocaleString()}</strong>
          </div>
        </div>

        <div className={`rounded-2xl border p-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 ${
          verification.invalidCount > 0
            ? 'border-amber-200 bg-amber-50/70'
            : 'border-emerald-100 bg-emerald-50/60'
        }`}>
          <div className="flex items-start gap-2">
            <div className={`w-8 h-8 rounded-xl bg-white border flex items-center justify-center shrink-0 ${
              verification.invalidCount > 0 ? 'border-amber-100' : 'border-emerald-100'
            }`}>
              {verification.invalidCount > 0 ? (
                <AlertTriangle className="w-4 h-4 text-amber-700" />
              ) : (
                <Hash className="w-4 h-4 text-emerald-700" />
              )}
            </div>
            <div>
              <span className={`block text-[9px] uppercase font-mono font-black tracking-widest ${
                verification.invalidCount > 0 ? 'text-amber-800' : 'text-emerald-800'
              }`}>
                {lang === 'ka' ? 'შემოწმების ჯაჭვი' : 'Tamper-evident verification chain'}
              </span>
              <p className={`text-[11px] font-semibold mt-0.5 ${
                verification.invalidCount > 0 ? 'text-amber-900/75' : 'text-emerald-900/70'
              }`}>
                {lang === 'ka'
                  ? 'ჩანაწერები უკავშირდება წინა ჩანაწერის ჰეშს; ექსპორტში ინახება ჯაჭვის ჰეშებიც.'
                  : verification.invalidCount > 0
                    ? 'One or more persisted audit hashes no longer match the canonical chain.'
                    : 'New audit records are server-stamped with a hash linked to the previous record; legacy records are verified by computed chain.'}
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-[10px] font-mono">
            <span className="px-2.5 py-1 rounded-lg bg-white border border-emerald-100 text-emerald-900">
              {verification.algorithm}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-white border border-emerald-100 text-emerald-900">
              {verifiedCount.toLocaleString()} / {auditLogs.length.toLocaleString()} {lang === 'ka' ? 'ჩანაწერი' : 'records'}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-white border border-emerald-100 text-emerald-900">
              {verification.signedCount.toLocaleString()} server-signed
            </span>
            {verification.invalidCount > 0 ? (
              <span className="px-2.5 py-1 rounded-lg bg-white border border-amber-100 text-amber-900">
                {verification.invalidCount.toLocaleString()} invalid
              </span>
            ) : null}
            <code className="px-2.5 py-1 rounded-lg bg-white border border-emerald-100 text-[#4e0e15] font-bold" title={verification.rootHash || 'No root hash yet'}>
              {verification.rootHash ? `${verification.rootHash.slice(0, 18)}…` : '—'}
            </code>
          </div>
        </div>

        <div className="rounded-2xl border border-stone-100 bg-[#FAF8F5]/60 p-3">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_180px_180px_auto] gap-2">
            <label className="relative block">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder={lang === 'ka' ? 'ძებნა მომხმარებლით, მოქმედებით, ღვინის კოდით...' : 'Search user, action, wine code, note...'}
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-white border border-stone-200 text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15]"
              />
            </label>

            <label className="relative block">
              <Filter className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
              <select
                value={moduleFilter}
                onChange={e => setModuleFilter(e.target.value as ModuleFilter)}
                className="w-full appearance-none pl-8 pr-3 py-2 rounded-xl bg-white border border-stone-200 text-xs font-bold text-stone-700 outline-none focus:border-[#4e0e15]"
              >
                <option value="all">{t.all || 'All'} modules</option>
                <option value="GVINO">{moduleLabel('GVINO')}</option>
                <option value="VAZI">{moduleLabel('VAZI')}</option>
                <option value="MARANIOS">System</option>
              </select>
            </label>

            <select
              value={timeFilter}
              onChange={e => setTimeFilter(e.target.value as TimeFilter)}
              className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-xs font-bold text-stone-700 outline-none focus:border-[#4e0e15]"
            >
              {(['all', '24h', '7d', '30d'] as TimeFilter[]).map(value => (
                <option key={value} value={value}>{timeFilterLabel(value)}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={resetFilters}
              disabled={!hasActiveFilters}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 bg-white disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-black uppercase tracking-widest text-stone-500 hover:text-stone-900 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              {lang === 'ka' ? 'გასუფთავება' : 'Clear'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border border-stone-100 rounded-xl">
          <table className="w-full min-w-[1100px] text-left text-xs text-stone-600 border-collapse">
            <thead>
              <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-slate-400 font-bold">
                <th className="p-3">{t.audit_col_ts || 'Timestamp UTC'}</th>
                <th className="p-3">{t.audit_col_module || 'System Module'}</th>
                <th className="p-3">{t.audit_col_user || 'Operator User'}</th>
                <th className="p-3">{t.audit_col_action || 'Action Class'}</th>
                <th className="p-3">{t.audit_col_item || 'Scope Object'}</th>
                <th className="p-3">{t.audit_col_before || 'Before'}</th>
                <th className="p-3">{t.audit_col_after || 'After'}</th>
                <th className="p-3">{t.audit_col_verified || 'Verification'}</th>
                <th className="p-3">{t.notes || 'Notes'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50 font-mono text-[11px] font-medium text-stone-800">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-stone-400 font-sans">
                    {auditLogs.length === 0
                      ? (lang === 'ka' ? 'აუდიტის ჩანაწერები ჯერ არ არის.' : 'No audit entries yet.')
                      : (lang === 'ka' ? 'ფილტრებით ჩანაწერები ვერ მოიძებნა.' : 'No audit entries match the active filters.')}
                  </td>
                </tr>
              ) : filteredLogs.map(log => (
                <tr key={log.id} className="hover:bg-stone-50/50 duration-75 align-top">
                  <td className="p-3 text-slate-400 whitespace-nowrap">{new Date(log.timestamp).toLocaleDateString()} {new Date(log.timestamp).toLocaleTimeString()}</td>
                  <td className="p-3 font-serif font-bold uppercase">
                    <span className="px-2 py-0.5 bg-[#FAF8F5]/80 text-[#4e0e15] border border-stone-150 rounded">{moduleLabel(log.module)}</span>
                  </td>
                  <td className="p-3 text-emerald-900 font-sans font-extrabold">{log.user}</td>
                  <td className="p-3 font-bold text-stone-900">{log.actionType}</td>
                  <td className="p-3 font-sans text-stone-700 font-semibold">{log.changedItem}</td>
                  <td className="p-3 text-[10px] text-stone-500 max-w-[180px] whitespace-pre-wrap">{log.oldValue || '—'}</td>
                  <td className="p-3 text-[10px] text-stone-800 max-w-[220px] whitespace-pre-wrap">{log.newValue || '—'}</td>
                  <td className={`p-3 text-[10px] whitespace-nowrap ${
                    verification.byId[log.id]?.valid === false ? 'text-amber-800' : 'text-emerald-800'
                  }`}>
                    {verification.byId[log.id] ? (
                      <div
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border ${
                          verification.byId[log.id].valid
                            ? 'bg-emerald-50 border-emerald-100'
                            : 'bg-amber-50 border-amber-100'
                        }`}
                        title={`Record #${verification.byId[log.id].sequence}\nHash: ${verification.byId[log.id].hash}\nPrevious: ${verification.byId[log.id].previousHash}${verification.byId[log.id].persisted ? '\nPersisted: yes' : '\nPersisted: computed'}${verification.byId[log.id].reason ? `\n${verification.byId[log.id].reason}` : ''}`}
                      >
                        {verification.byId[log.id].valid ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <AlertTriangle className="w-3 h-3" />
                        )}
                        <span>#{verification.byId[log.id].sequence}</span>
                        <code className="font-bold">{verification.byId[log.id].hash.slice(0, 10)}</code>
                        {!verification.byId[log.id].persisted ? (
                          <span className="text-[9px] opacity-70">{lang === 'ka' ? 'computed' : 'computed'}</span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-stone-300">—</span>
                    )}
                  </td>
                  <td className="p-3 text-[11px] text-stone-500 font-sans leading-relaxed max-w-[280px]">{log.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
