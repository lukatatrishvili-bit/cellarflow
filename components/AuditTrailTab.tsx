import React from 'react';
import { translations, Language } from '../lib/i18n';
import { MaraniOSAuditLog } from '../lib/wineryState';

interface AuditTrailTabProps {
  lang: Language;
  auditLogs: MaraniOSAuditLog[];
}

export default function AuditTrailTab({ lang, auditLogs }: AuditTrailTabProps) {
  const t = translations[lang];

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col space-y-6 font-sans text-stone-700 text-xs text-stone-850 animate-fade-in">
      <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm space-y-4">
        <div>
          <span className="text-[9px] uppercase tracking-widest bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded font-bold">PDO Traceability</span>
          <h3 className="text-xl font-serif font-black text-stone-905 uppercase mt-1">
            🛡️ {t.audit_title || 'SaaS Corporate Action Audit Trails'}
          </h3>
          <p className="text-xs text-stone-400 font-semibold mt-0.5">
            {t.audit_subtitle || 'Chronological action logs ledger strictly verifying viticultural and winemaking authenticity'}
          </p>
        </div>

        <div className="overflow-x-auto border border-stone-100 rounded-xl">
          <table className="w-full text-left text-xs text-stone-605 border-collapse">
            <thead>
              <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-slate-400 font-bold">
                <th className="p-3">{t.audit_col_ts || 'Timestamp UTC'}</th>
                <th className="p-3">{t.audit_col_module || 'System Module'}</th>
                <th className="p-3">{t.audit_col_user || 'Operator User'}</th>
                <th className="p-3">{t.audit_col_action || 'Action Class'}</th>
                <th className="p-3">{t.audit_col_item || 'Scope Object'}</th>
                <th className="p-3">{t.notes || 'Notes'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50 font-mono text-[11px] font-medium text-stone-800">
              {auditLogs.map(log => (
                <tr key={log.id} className="hover:bg-stone-50/50 duration-75">
                  <td className="p-3 text-slate-400">{new Date(log.timestamp).toLocaleDateString()} {new Date(log.timestamp).toLocaleTimeString()}</td>
                  <td className="p-3 font-serif font-bold uppercase"><span className="px-2 py-0.5 bg-[#FAF8F5]/80 text-[#4e0e15] border border-stone-150 rounded">{log.module === 'VAZI' ? (t.nav_vazi || 'Vazi') : (t.nav_gvino || 'Gvino')}</span></td>
                  <td className="p-3 text-emerald-900 font-sans font-extrabold">{log.user}</td>
                  <td className="p-3 font-bold text-stone-900">{log.actionType}</td>
                  <td className="p-3 font-sans text-stone-700 font-semibold">{log.changedItem}</td>
                  <td className="p-3 text-[11px] text-stone-500 font-sans leading-relaxed">{log.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
