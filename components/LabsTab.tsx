import React from 'react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import type { Vessel, WineLot, LabAnalysis } from '../lib/wineryState';

interface LabsTabProps {
  lang: Language;
  canCreateLabAnalysis?: boolean;
  lots: WineLot[];
  vessels: Vessel[];
  labLogs: LabAnalysis[];
  labFilterType: string;
  setLabFilterType: (val: string) => void;
  labFilterAge: string;
  setLabFilterAge: (val: string) => void;
  labLotId: string;
  setLabLotId: (val: string) => void;
  labTankId: string;
  setLabTankId: (val: string) => void;
  labABV: number;
  setLabABV: (val: number) => void;
  labVA: number;
  setLabVA: (val: number) => void;
  labFSO2: number;
  setLabFSO2: (val: number) => void;
  labTSO2: number;
  setLabTSO2: (val: number) => void;
  labResidualSugar: number;
  setLabResidualSugar: (val: number) => void;
  labLactic: number;
  setLabLactic: (val: number) => void;
  labTA: number;
  setLabTA: (val: number) => void;
  labTurbidity: number;
  setLabTurbidity: (val: number) => void;
  onAddLabLog: (e: React.FormEvent) => void;
}

export default function LabsTab({
  lang,
  canCreateLabAnalysis = true,
  lots,
  vessels,
  labLogs,
  labFilterType,
  setLabFilterType,
  labFilterAge,
  setLabFilterAge,
  labLotId,
  setLabLotId,
  labTankId,
  setLabTankId,
  labABV,
  setLabABV,
  labVA,
  setLabVA,
  labFSO2,
  setLabFSO2,
  labTSO2,
  setLabTSO2,
  labResidualSugar,
  setLabResidualSugar,
  labLactic,
  setLabLactic,
  labTA,
  setLabTA,
  labTurbidity,
  setLabTurbidity,
  onAddLabLog
}: LabsTabProps) {
  const handleAddLabLog = (event: React.FormEvent) => {
    if (!canCreateLabAnalysis) {
      event.preventDefault();
      return;
    }

    onAddLabLog(event);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 text-stone-800 animate-fade-in">
      {!canCreateLabAnalysis && (
        <div
          role="status"
          className="xl:col-span-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
        >
          {lang === 'ka'
            ? 'ლაბორატორიის ისტორია მხოლოდ სანახავია თქვენი სამუშაო სივრცის როლისთვის. ჩანაწერებისა და ფილტრების ნახვა კვლავ შეგიძლიათ.'
            : 'Lab history is read-only for your workspace role. You can still review records and use the filters.'}
        </div>
      )}

      {/* Lab Add entry */}
      {canCreateLabAnalysis && (
        <div className="xl:col-span-1 p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm">
          <h3 className="text-sm font-serif font-bold text-[#4e0e15] border-b border-slate-100 pb-2 mb-4">{lang === 'ka' ? 'ლაბორატორიული ანალიზის დამატება' : 'Add Lab Readings'}</h3>
          <form onSubmit={handleAddLabLog} className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{lang === 'ka' ? 'ღვინის პარტიის კოდი' : 'Wine Lot Code'}</label>
            <select
              required
              value={labLotId}
              onChange={(e) => setLabLotId(e.target.value)}
              className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
            >
              <option value="">{lang === 'ka' ? '-- აირჩიეთ პარტია --' : '-- Choose Lot --'}</option>
              {lots.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{lang === 'ka' ? 'ჭურჭელი' : 'Vessel Tank'}</label>
            <select
              required
              value={labTankId}
              onChange={(e) => setLabTankId(e.target.value)}
              className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
            >
              <option value="">{lang === 'ka' ? '-- აირჩიეთ ჭურჭელი --' : '-- Choose Vessel --'}</option>
              {vessels.filter(v => v.currentVolume > 0).map(v => (
                <option key={v.id} value={v.id}>{v.id}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">ABV% v/v</label>
              <input 
                type="number" step="0.1" value={labABV}
                onChange={(e) => setLabABV(parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{lang === 'ka' ? 'აქროლადი მჟავა (VA გ/ლ)' : 'Volatile Acid (VA g/L)'}</label>
              <input 
                type="number" step="0.01" value={labVA}
                onChange={(e) => setLabVA(parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{lang === 'ka' ? 'თავისუფალი SO₂ მგ/ლ' : 'Free SO₂ mg/L'}</label>
              <input 
                type="number" value={labFSO2}
                onChange={(e) => setLabFSO2(parseInt(e.target.value) || 0)}
                className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{lang === 'ka' ? 'საერთო SO₂ მგ/ლ' : 'Total SO₂ mg/L'}</label>
              <input 
                type="number" value={labTSO2}
                onChange={(e) => setLabTSO2(parseInt(e.target.value) || 0)}
                className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{lang === 'ka' ? 'ნარჩენი შაქარი (გ/ლ)' : 'Sugar residual (g/L)'}</label>
              <input 
                type="number" step="0.1" value={labResidualSugar}
                onChange={(e) => setLabResidualSugar(parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{lang === 'ka' ? 'რძემჟავა (გ/ლ)' : 'Lactic Acid (g/L)'}</label>
              <input 
                type="number" step="0.1" value={labLactic}
                onChange={(e) => setLabLactic(parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{lang === 'ka' ? 'ტიტრული მჟავიანობა (TA გ/ლ)' : 'Titratable Acidity (TA g/L)'}</label>
              <input 
                type="number" step="0.1" value={labTA}
                onChange={(e) => setLabTA(parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{lang === 'ka' ? 'სიმღვრივე (NTU)' : 'Turbidity (NTU)'}</label>
              <input 
                type="number" value={labTurbidity}
                onChange={(e) => setLabTurbidity(parseInt(e.target.value) || 0)}
                className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
              />
            </div>
          </div>
          <button 
            type="submit"
            className="w-full py-1.5 bg-[#4e0e15] hover:bg-[#6b151e] text-white text-xs font-semibold rounded cursor-pointer"
          >
            {lang === 'ka' ? 'ანალიზის შენახვა' : 'Commit Lab Reads'}
          </button>
          </form>
        </div>
      )}

      {/* Lab reports database */}
      <div className={`${canCreateLabAnalysis ? 'xl:col-span-2' : 'xl:col-span-3'} p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm text-stone-800 space-y-4`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <h3 className="text-sm font-serif font-bold text-[#4e0e15]">{lang === 'ka' ? 'ლაბორატორიული ქიმიის ისტორია' : 'Lab Chemical History Log'}</h3>
          <span className="text-xs text-slate-500 font-mono">
            {lang === 'ka' ? `სულ: ${labLogs.length} ჩანაწერი` : `Total: ${labLogs.length} records`}
          </span>
        </div>

        {/* Filters section */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#FAF8F5] p-3.5 border border-[#e8dfd5] rounded-xl">
          <div>
            <label className="block text-[10px] font-mono uppercase text-slate-500 font-bold mb-1">
              {lang === 'ka' ? 'ფილტრი: ღვინის ტიპი / კლასი' : 'Filter Wine Type / Class'}
            </label>
            <select
              value={labFilterType}
              onChange={(e) => setLabFilterType(e.target.value)}
              className="px-2 py-1 text-xs border border-stone-200 rounded-lg bg-white text-stone-705 outline-none w-full"
            >
              <option value="all">🍷 {lang === 'ka' ? 'ყველა კლასი' : 'All Wine Classes'}</option>
              <option value="red">🔴 {lang === 'ka' ? 'წითელი ღვინო' : 'Red Wine'}</option>
              <option value="white">🟡 {lang === 'ka' ? 'თეთრი ღვინო' : 'White Wine'}</option>
              <option value="rose">💗 {lang === 'ka' ? 'ვარდისფერი ღვინო' : 'Rosé Wine'}</option>
              <option value="amber">🟠 {lang === 'ka' ? 'ქარვისფერი / ტრადიციული' : 'Amber / Traditional'}</option>
              <option value="sparkling">🫧 {lang === 'ka' ? 'ცქრიალა' : 'Sparkling'}</option>
              <option value="fortified">🥃 {lang === 'ka' ? 'შემაგრებული' : 'Fortified / Base'}</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase text-slate-500 font-bold mb-1">
              {lang === 'ka' ? 'ფილტრი: ასაკი / მოსავალი' : 'Filter Age / Vintage'}
            </label>
            <select
              value={labFilterAge}
              onChange={(e) => setLabFilterAge(e.target.value)}
              className="px-2 py-1 text-xs border border-stone-200 rounded-lg bg-white text-stone-750 outline-none w-full"
            >
              <option value="all">📅 {lang === 'ka' ? 'ყველა მოსავალი / ასაკი' : 'All Vintages / Ages'}</option>
              <option value="young">🌱 {lang === 'ka' ? 'ახალგაზრდა (< 1 წელი)' : 'Young (< 1 Year)'}</option>
              <option value="aging">🍇 {lang === 'ka' ? 'დავარგებაში (1-2 წელი)' : 'Aging (1-2 Years)'}</option>
              <option value="aged">🪵 {lang === 'ka' ? 'რეზერვი (3+ წელი)' : 'Barrel Reserve (3+ Years)'}</option>
              <option value="2025">{lang === 'ka' ? 'მოსავალი 2025' : 'Vintage 2025'}</option>
              <option value="2024">{lang === 'ka' ? 'მოსავალი 2024' : 'Vintage 2024'}</option>
            </select>
          </div>
        </div>

        <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1 font-sans" tabIndex={0}>
          {labLogs.length === 0 && (
            <div className="flex flex-col items-center justify-center p-10 text-center border border-dashed border-stone-200 rounded-2xl bg-stone-50/50 dark:bg-stone-900/20 dark:border-stone-800">
              <svg className="w-12 h-12 text-stone-300 dark:text-stone-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                <path strokeLinecap="round" d="M9 3v7.5L4.7 17.8A2 2 0 0 0 6.4 21h11.2a2 2 0 0 0 1.7-3.2L15 10.5V3" />
                <path strokeLinecap="round" d="M8 3h8M7.5 15h9" />
              </svg>
              <h4 className="text-xs font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wider font-mono">
                {lang === 'ka' ? 'ლაბორატორიული ანალიზები ჯერ არ არის' : 'No lab analyses yet'}
              </h4>
              <p className="text-[11px] text-stone-500 dark:text-stone-400 max-w-xs mt-1.5 leading-relaxed">
                {lang === 'ka'
                  ? 'pH, SO2, VA და სხვა მაჩვენებლები აქ გამოჩნდება — ჩაწერეთ პირველი ანალიზი ზემოთა ფორმით, როცა ლოტი გექნებათ.'
                  : 'pH, SO2, VA and other chemistry readings will appear here. Record your first analysis with the form above once a wine lot exists.'}
              </p>
            </div>
          )}
          {labLogs
            .filter(log => {
              const lot = lots.find(l => l.id === log.lotId);
              if (!lot) return true;
              
              if (labFilterType !== 'all' && lot.wineClass !== labFilterType) return false;

              if (labFilterAge !== 'all') {
                const computedAgeYears = 2026 - lot.vintage;
                if (labFilterAge === 'young') {
                  if (computedAgeYears > 1) return false;
                } else if (labFilterAge === 'aging') {
                  if (computedAgeYears !== 2) return false;
                } else if (labFilterAge === 'aged') {
                  if (computedAgeYears < 3) return false;
                } else {
                  if (lot.vintage.toString() !== labFilterAge) return false;
                }
              }
              return true;
            })
            .map(log => {
              const lowSo2 = log.freeSo2 < 15;
              const highVa = log.volatileAcid > 0.8;
              const lot = lots.find(l => l.id === log.lotId);

              return (
                <div key={log.id} className={`p-4 border rounded-lg ${lowSo2 || highVa ? 'border-rose-300 bg-rose-50/20' : 'border-slate-100 bg-slate-50'}`}>
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[#801323]">🍷</span>
                      <span>{lot ? lot.name : log.lotId} ({log.tankId})</span>
                      <span className="px-1.5 py-0.5 text-[9px] font-bold text-slate-400 bg-slate-200/55 rounded uppercase">
                        {lot ? lot.wineClass : (lang === 'ka' ? 'უცნობი' : 'Unknown')}
                      </span>
                      <span className="px-1.5 py-0.5 text-[9px] font-mono text-indigo-700 bg-indigo-50 rounded">
                        {lot ? (lang === 'ka' ? `მოსავალი ${lot.vintage}` : `${lot.vintage} Vintage`) : ''}
                      </span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{log.date}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-[10px] text-slate-500 font-mono mt-3">
                    <div>ABV%: <strong className="text-slate-800 font-bold block">{log.alcoholPct}% vol</strong></div>
                    <div>{lang === 'ka' ? 'თავის. SO₂' : 'Free SO₂'}: <strong className={`block ${lowSo2 ? 'text-red-600 font-black' : 'text-slate-800'}`}>{log.freeSo2} mg/L {lowSo2 && (lang === 'ka' ? '⚠️ დაბალი!' : '⚠️ LOW!')}</strong></div>
                    <div>{lang === 'ka' ? 'აქროლადი მჟავა' : 'Volatile Acid'}: <strong className={`block ${highVa ? 'text-red-600 font-black' : 'text-slate-800'}`}>{log.volatileAcid} g/L {highVa && (lang === 'ka' ? '⚠️ მაღალი!' : '⚠️ HIGH!')}</strong></div>
                    <div>{lang === 'ka' ? 'ტიტრული მჟავა' : 'Titratable Acid'}: <strong className="text-[#4e0e15] font-black block">{log.titratableAcidity !== undefined ? log.titratableAcidity : 6.0} g/L</strong></div>
                    <div>{lang === 'ka' ? 'ნარჩენი შაქარი' : 'Sugar raw'}: <strong className="text-slate-800 block">{log.residualSugar} g/L</strong></div>
                    <div>{lang === 'ka' ? 'ვაშლმჟავა' : 'Malic'}: <strong className="text-slate-800 block">{log.malicAcid} g/L</strong></div>
                    <div>{lang === 'ka' ? 'რძემჟავა' : 'Lactic'}: <strong className="text-slate-800 block">{log.lacticAcid} g/L</strong></div>
                    <div>{lang === 'ka' ? 'სიმღვრივე' : 'Turbidity'}: <strong className="text-slate-800 block">{log.turbidity !== undefined ? log.turbidity : 20} NTU</strong></div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
