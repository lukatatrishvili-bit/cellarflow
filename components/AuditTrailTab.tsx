import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, CloudOff, Download, Filter, Hash, Search, ShieldCheck, X } from 'lucide-react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import {
  AUDIT_TRAIL_MAX_LIMIT,
  buildAuditTrailPage,
  type AuditModuleFilter,
  type AuditTrailPage,
  type AuditTrailQuery,
} from '../lib/auditTrailPage';
import { isWindowedAuditChain } from '../lib/auditHydration';
import type { MaraniOSAuditLog } from '../lib/wineryState';

interface AuditTrailTabProps {
  lang: Language;
  /**
   * The tenant's local mirror — the recent window the server hydrates, not the
   * whole chain. Used only when the trail cannot be reached; online, the chain
   * shown is the one verified server-side against stored state.
   */
  auditLogs: MaraniOSAuditLog[];
}

type TimeFilter = 'all' | '24h' | '7d' | '30d';
/**
 * Where the displayed page came from, and what may honestly be claimed about it.
 *
 * `local-window` is the case that needs care. A windowed chain cannot be
 * verified locally at all — `buildAuditHashChain` asserts
 * `chainSequence === index + 1`, so a window starting at #501 fails on its first
 * record and marks every record tampered. Reporting that as tampering would
 * accuse a winery of forging its own records because it went offline, so the
 * verification column and banner report it as unavailable instead.
 */
type TrailSource = 'server' | 'local' | 'local-window';

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;
/** Matches the sync ceiling on a single collection; nothing can exceed it. */
const MAX_EXPORT_PAGES = Math.ceil(20_000 / AUDIT_TRAIL_MAX_LIMIT);

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

function cutoffFor(timeFilter: TimeFilter): string | null {
  if (timeFilter === 'all') return null;
  const days = timeFilter === '24h' ? 1 : timeFilter === '7d' ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function AuditTrailTab({ lang, auditLogs }: AuditTrailTabProps) {
  const t = translations[lang];
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<AuditModuleFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [pageIndex, setPageIndex] = useState(0);

  const [page, setPage] = useState<AuditTrailPage | null>(null);
  const [source, setSource] = useState<TrailSource>('server');
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Typing must not put one request per keystroke on a server that verifies a
  // hash chain to answer.
  //
  // Every filter change resets to the first page in the same update as the
  // filter itself. Doing it in a follow-up effect instead costs a wasted round
  // trip: the old offset is still in state for one render, so a reader on page
  // three who types a search fetches page three of the new result set and then
  // immediately fetches page one.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPageIndex(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = useMemo<AuditTrailQuery>(() => ({
    module: moduleFilter,
    since: cutoffFor(timeFilter),
    search,
    offset: pageIndex * PAGE_SIZE,
    limit: PAGE_SIZE,
  }), [moduleFilter, pageIndex, search, timeFilter]);

  const auditLogsRef = useRef(auditLogs);
  auditLogsRef.current = auditLogs;

  const fetchPage = useCallback(async (
    trailQuery: AuditTrailQuery,
    signal?: AbortSignal,
  ): Promise<{ page: AuditTrailPage; source: TrailSource }> => {
    const params = new URLSearchParams();
    if (trailQuery.module && trailQuery.module !== 'all') params.set('module', trailQuery.module);
    if (trailQuery.since) params.set('since', trailQuery.since);
    if (trailQuery.search) params.set('search', trailQuery.search);
    params.set('offset', String(trailQuery.offset ?? 0));
    params.set('limit', String(trailQuery.limit ?? PAGE_SIZE));

    try {
      const res = await fetch(`/api/audit-trail?${params.toString()}`, { signal });
      if (!res.ok) throw new Error(`Audit trail request failed: ${res.status}`);
      return { page: await res.json(), source: 'server' };
    } catch (error) {
      if (signal?.aborted) throw error;
      // Offline, or the trail is briefly unavailable. The local mirror goes
      // through the same paging module, so ordering and search are identical;
      // only the authority behind the verification differs, and the banner
      // below says so rather than letting it pass as server-verified.
      const local = auditLogsRef.current;
      return {
        page: buildAuditTrailPage(local, trailQuery),
        source: isWindowedAuditChain(local) ? 'local-window' : 'local',
      };
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setIsLoading(true);

    fetchPage(query, controller.signal)
      .then(result => {
        if (!active) return;
        setPage(result.page);
        setSource(result.source);
      })
      .catch(() => { /* superseded by a newer query */ })
      .finally(() => { if (active) setIsLoading(false); });

    return () => { active = false; controller.abort(); };
  }, [fetchPage, query]);

  const moduleLabel = useCallback((module: MaraniOSAuditLog['module']) => {
    if (module === 'VAZI') return t.nav_vazi || 'Vazi';
    if (module === 'MARANIOS') return 'System';
    return t.nav_gvino || 'Gvino';
  }, [t.nav_gvino, t.nav_vazi]);

  const timeFilterLabel = (value: TimeFilter) => {
    if (value === '24h') return lang === 'ka' ? '24 საათი' : 'Last 24h';
    if (value === '7d') return lang === 'ka' ? '7 დღე' : 'Last 7 days';
    if (value === '30d') return lang === 'ka' ? '30 დღე' : 'Last 30 days';
    return t.all || 'All';
  };

  const chain = page?.chain;
  const entries = page?.entries || [];
  const total = page?.total || 0;
  const moduleCounts = page?.moduleCounts || { GVINO: 0, VAZI: 0, MARANIOS: 0 };
  /**
   * A window's local "invalid" count is an artefact of the missing head of the
   * chain, not evidence about the records. Suppress it rather than raise a
   * tamper alarm the data cannot support.
   */
  const canVerifyLocally = source !== 'local-window';
  const invalidCount = canVerifyLocally ? (chain?.invalidCount || 0) : 0;
  const hasActiveFilters = !!searchInput || moduleFilter !== 'all' || timeFilter !== 'all';
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (pageIndex + 1) * PAGE_SIZE);

  const resetFilters = () => {
    setSearchInput('');
    setSearch('');
    setModuleFilter('all');
    setTimeFilter('all');
    setPageIndex(0);
  };

  /**
   * Export covers every record matching the filter, not the page on screen: a
   * compliance export that silently stopped at 100 rows would be worse than no
   * export at all. Pages are walked at the server's maximum window.
   */
  const exportCsv = async () => {
    if (isExporting || total === 0) return;
    setIsExporting(true);
    try {
      const collected: AuditTrailPage['entries'] = [];
      let exportSource: TrailSource = 'server';

      for (let pageNumber = 0; pageNumber < MAX_EXPORT_PAGES; pageNumber += 1) {
        const result = await fetchPage({
          ...query,
          offset: pageNumber * AUDIT_TRAIL_MAX_LIMIT,
          limit: AUDIT_TRAIL_MAX_LIMIT,
        });
        if (result.source !== 'server') exportSource = result.source;
        collected.push(...result.page.entries);
        if (collected.length >= result.page.total || result.page.entries.length === 0) break;
      }

      // An export taken from a window carries no verification it can stand
      // behind. Emitting "valid: no" would be a false accusation and "yes" a
      // false assurance, so the columns say unavailable and name the source.
      const verified = exportSource !== 'local-window';

      const headers = ['Timestamp', 'Module', 'User', 'Action', 'Item', 'Before', 'After', 'Notes', 'Record #', 'Chain Hash', 'Previous Hash', 'Algorithm', 'Persisted', 'Valid', 'Verified by'];
      const rows = collected.map(({ log, verification }) => [
        log.timestamp,
        moduleLabel(log.module),
        log.user,
        log.actionType,
        log.changedItem,
        log.oldValue || '',
        log.newValue || '',
        log.notes || '',
        verified ? (verification?.sequence || '') : (log.chainSequence || ''),
        verified ? (verification?.hash || '') : (log.chainHash || ''),
        verified ? (verification?.previousHash || '') : (log.previousHash || ''),
        verification?.algorithm || chain?.algorithm || '',
        verification?.persisted ? 'yes' : 'computed',
        verified ? (verification?.valid ? 'yes' : 'no') : 'unavailable',
        exportSource === 'server'
          ? 'server'
          : exportSource === 'local'
            ? 'local-cache'
            : 'local-cache-window (unverified)',
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
    } finally {
      setIsExporting(false);
    }
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
          </div>

          <button
            type="button"
            onClick={exportCsv}
            disabled={total === 0 || isExporting}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#4e0e15] text-amber-50 disabled:opacity-50 disabled:cursor-not-allowed text-[10px] font-black uppercase tracking-widest hover:bg-[#34070a] transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {isExporting
              ? (lang === 'ka' ? 'მიმდინარეობს…' : 'Exporting…')
              : (lang === 'ka' ? 'CSV ექსპორტი' : 'Export CSV')}
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="rounded-xl border border-stone-100 bg-[#FAF8F5]/70 p-3">
            <span className="block text-[9px] uppercase font-mono font-bold tracking-widest text-stone-400">{lang === 'ka' ? 'სულ' : 'Total logs'}</span>
            <strong className="block mt-1 text-lg font-serif text-stone-900">{(chain?.totalEntries || 0).toLocaleString()}</strong>
          </div>
          <div className="rounded-xl border border-stone-100 bg-[#FAF8F5]/70 p-3">
            <span className="block text-[9px] uppercase font-mono font-bold tracking-widest text-stone-400">{lang === 'ka' ? 'ნაჩვენებია' : 'Showing'}</span>
            <strong className="block mt-1 text-lg font-serif text-[#4e0e15]">{total.toLocaleString()}</strong>
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
          invalidCount > 0
            ? 'border-amber-200 bg-amber-50/70'
            : source !== 'server'
              ? 'border-stone-200 bg-stone-50/70'
              : 'border-emerald-100 bg-emerald-50/60'
        }`}>
          <div className="flex items-start gap-2">
            <div className={`w-8 h-8 rounded-xl bg-white border flex items-center justify-center shrink-0 ${
              invalidCount > 0 ? 'border-amber-100' : source !== 'server' ? 'border-stone-200' : 'border-emerald-100'
            }`}>
              {invalidCount > 0 ? (
                <AlertTriangle className="w-4 h-4 text-amber-700" />
              ) : source !== 'server' ? (
                <CloudOff className="w-4 h-4 text-stone-500" />
              ) : (
                <Hash className="w-4 h-4 text-emerald-700" />
              )}
            </div>
            <div>
              <span className={`block text-[9px] uppercase font-mono font-black tracking-widest ${
                invalidCount > 0 ? 'text-amber-800' : source !== 'server' ? 'text-stone-600' : 'text-emerald-800'
              }`}>
                {lang === 'ka' ? 'შემოწმების ჯაჭვი' : 'Tamper-evident verification chain'}
              </span>
              <p className={`text-[11px] font-semibold mt-0.5 ${
                invalidCount > 0 ? 'text-amber-900/75' : source !== 'server' ? 'text-stone-500' : 'text-emerald-900/70'
              }`}>
                {source === 'local-window'
                  ? (lang === 'ka'
                    ? 'ოფლაინ რეჟიმი: ხელმისაწვდომია მხოლოდ ბოლო ჩანაწერები, ამიტომ ჯაჭვის შემოწმება შეუძლებელია. ჩანაწერები ნაჩვენებია შემოწმების გარეშე.'
                    : 'Offline: only recent records are held on this device, so the chain cannot be verified here. Records are shown unverified.')
                  : source === 'local'
                    ? (lang === 'ka'
                      ? 'ოფლაინ რეჟიმი: ჯაჭვი შემოწმებულია ლოკალური ასლით, არა სერვერზე შენახული ჩანაწერებით.'
                      : 'Offline: verified against this device’s local copy, not the stored chain.')
                    : invalidCount > 0
                      ? (lang === 'ka'
                        ? 'ერთი ან მეტი შენახული ჰეში აღარ ემთხვევა კანონიკურ ჯაჭვს.'
                        : 'One or more persisted audit hashes no longer match the canonical chain.')
                      : (lang === 'ka'
                        ? 'ჩანაწერები უკავშირდება წინა ჩანაწერის ჰეშს; შემოწმება ხდება სერვერზე, სრულ ჯაჭვზე.'
                        : 'Records are chained to the previous record’s hash and verified server-side across the full chain.')}
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-[10px] font-mono">
            <span className="px-2.5 py-1 rounded-lg bg-white border border-emerald-100 text-emerald-900">
              {chain?.algorithm || 'SHA-256'}
            </span>
            {canVerifyLocally ? (
              <span className="px-2.5 py-1 rounded-lg bg-white border border-emerald-100 text-emerald-900">
                {(chain?.verifiedCount || 0).toLocaleString()} / {(chain?.totalEntries || 0).toLocaleString()} {lang === 'ka' ? 'ჩანაწერი' : 'records'}
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-lg bg-white border border-stone-200 text-stone-500">
                {lang === 'ka' ? 'შემოწმება მიუწვდომელია' : 'Verification unavailable'}
              </span>
            )}
            <span className="px-2.5 py-1 rounded-lg bg-white border border-emerald-100 text-emerald-900">
              {(chain?.signedCount || 0).toLocaleString()} server-signed
            </span>
            {invalidCount > 0 ? (
              <span className="px-2.5 py-1 rounded-lg bg-white border border-amber-100 text-amber-900">
                {invalidCount.toLocaleString()} invalid
              </span>
            ) : null}
            {/* A window's computed root is derived from a chain missing its
                head, so it is not this organization's root hash at all. */}
            {canVerifyLocally ? (
              <code className="px-2.5 py-1 rounded-lg bg-white border border-emerald-100 text-[#4e0e15] font-bold" title={chain?.rootHash || 'No root hash yet'}>
                {chain?.rootHash ? `${chain.rootHash.slice(0, 18)}…` : '—'}
              </code>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-stone-100 bg-[#FAF8F5]/60 p-3">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_180px_180px_auto] gap-2">
            <label className="relative block">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder={lang === 'ka' ? 'ძებნა მომხმარებლით, მოქმედებით, ღვინის კოდით...' : 'Search user, action, wine code, note...'}
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-white border border-stone-200 text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15]"
              />
            </label>

            <label className="relative block">
              <Filter className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
              <select
                value={moduleFilter}
                onChange={e => { setModuleFilter(e.target.value as AuditModuleFilter); setPageIndex(0); }}
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
              onChange={e => { setTimeFilter(e.target.value as TimeFilter); setPageIndex(0); }}
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
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-stone-400 font-sans">
                    {isLoading && !page
                      ? (lang === 'ka' ? 'იტვირთება…' : 'Loading audit trail…')
                      : (chain?.totalEntries || 0) === 0
                        ? (lang === 'ka' ? 'აუდიტის ჩანაწერები ჯერ არ არის.' : 'No audit entries yet.')
                        : (lang === 'ka' ? 'ფილტრებით ჩანაწერები ვერ მოიძებნა.' : 'No audit entries match the active filters.')}
                  </td>
                </tr>
              ) : entries.map(({ log, verification }) => (
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
                    canVerifyLocally && verification?.valid === false ? 'text-amber-800' : 'text-emerald-800'
                  }`}>
                    {!canVerifyLocally ? (
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-stone-200 bg-stone-50 text-stone-500"
                        title={lang === 'ka'
                          ? 'ჯაჭვის შემოწმება საჭიროებს სრულ ისტორიას, რომელიც ამ მოწყობილობაზე არ ინახება.'
                          : 'Verifying this record requires the full chain, which is not held on this device.'}
                      >
                        <CloudOff className="w-3 h-3" />
                        <span>{lang === 'ka' ? 'შეუმოწმებელი' : 'unverified'}</span>
                      </span>
                    ) : verification ? (
                      <div
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border ${
                          verification.valid
                            ? 'bg-emerald-50 border-emerald-100'
                            : 'bg-amber-50 border-amber-100'
                        }`}
                        title={`Record #${verification.sequence}\nHash: ${verification.hash}\nPrevious: ${verification.previousHash}${verification.persisted ? '\nPersisted: yes' : '\nPersisted: computed'}${verification.reason ? `\n${verification.reason}` : ''}`}
                      >
                        {verification.valid ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <AlertTriangle className="w-3 h-3" />
                        )}
                        <span>#{verification.sequence}</span>
                        <code className="font-bold">{verification.hash.slice(0, 10)}</code>
                        {!verification.persisted ? (
                          <span className="text-[9px] opacity-70">computed</span>
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

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">
            {total === 0
              ? '—'
              : `${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} / ${total.toLocaleString()}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPageIndex(index => Math.max(0, index - 1))}
              disabled={pageIndex === 0 || isLoading}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-stone-200 bg-white disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-black uppercase tracking-widest text-stone-500 hover:text-stone-900 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {lang === 'ka' ? 'უკან' : 'Previous'}
            </button>
            <span className="text-[10px] font-mono text-stone-500">
              {(pageIndex + 1).toLocaleString()} / {pageCount.toLocaleString()}
            </span>
            <button
              type="button"
              onClick={() => setPageIndex(index => index + 1)}
              disabled={pageIndex + 1 >= pageCount || isLoading}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-stone-200 bg-white disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-black uppercase tracking-widest text-stone-500 hover:text-stone-900 cursor-pointer"
            >
              {lang === 'ka' ? 'შემდეგი' : 'Next'}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(AuditTrailTab);
