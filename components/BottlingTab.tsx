import React, { useMemo, useState } from 'react';
import { Wine, Package, AlertTriangle, CheckCircle2, Trash2, FileDown } from 'lucide-react';
import { Language } from '../lib/i18n';
import type { WineLot } from '../lib/wineryState';

interface Props {
  lang: Language;
  lots: WineLot[];
  onUpdateLots: (lots: WineLot[]) => void;
  setToastMessage?: (m: string) => void;
}

/** Official bottle formats from Annex №7 (ჩამოსხმის აქტი). */
export const BOTTLE_FORMATS: Array<{ key: string; litres: number; labelKa: string; kind: 'bottle' | 'ceramic' }> = [
  { key: '0.75', litres: 0.75, labelKa: '0.75 ლ', kind: 'bottle' },
  { key: '0.5', litres: 0.5, labelKa: '0.5 ლ', kind: 'bottle' },
  { key: '0.375', litres: 0.375, labelKa: '0.375 ლ', kind: 'bottle' },
  { key: '0.2', litres: 0.2, labelKa: '0.2 ლ', kind: 'bottle' },
  { key: '1.5', litres: 1.5, labelKa: '1.5 ლ (მაგნუმი)', kind: 'bottle' },
  { key: '3.0', litres: 3.0, labelKa: '3.0 ლ', kind: 'bottle' },
  { key: 'ceramic', litres: 0.75, labelKa: 'კერამიკა 0.75 ლ', kind: 'ceramic' },
];

export interface BottlingRun {
  id: string;
  lotId: string;
  lotName: string;
  date: string;
  lotNumber: string;
  operator: string;
  formats: Record<string, number>; // format key -> bottle count
  totalBottles: number;
  totalCeramic: number;
  volumeBottledL: number;
}

const HISTORY_KEY = 'cf_bottling_history';

export function loadBottlingHistory(): BottlingRun[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveBottlingHistory(runs: BottlingRun[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(runs)); } catch { /* ignore */ }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export default function BottlingTab({ lang, lots, onUpdateLots, setToastMessage }: Props) {
  const ka = lang === 'ka';
  const [history, setHistory] = useState<BottlingRun[]>(loadBottlingHistory);

  const bottleable = useMemo(
    () => lots.filter(l => l.currentVolume > 0 && l.stage !== 'sold'),
    [lots],
  );

  const [lotId, setLotId] = useState(bottleable[0]?.id || '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lotNumber, setLotNumber] = useState('');
  const [operator, setOperator] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});

  const lot = lots.find(l => l.id === lotId) || null;
  const availableL = lot ? lot.currentVolume : 0;

  const volumeBottledL = useMemo(
    () => round1(BOTTLE_FORMATS.reduce((acc, f) => acc + (counts[f.key] || 0) * f.litres, 0)),
    [counts],
  );
  const totalBottles = BOTTLE_FORMATS.filter(f => f.kind === 'bottle').reduce((a, f) => a + (counts[f.key] || 0), 0);
  const totalCeramic = BOTTLE_FORMATS.filter(f => f.kind === 'ceramic').reduce((a, f) => a + (counts[f.key] || 0), 0);

  const overfill = volumeBottledL > availableL + 0.001;
  const noBottles = totalBottles + totalCeramic === 0;
  const canSubmit = !!lot && !overfill && !noBottles;

  const setCount = (key: string, val: string) => {
    const n = Math.max(0, parseInt(val) || 0);
    setCounts(prev => ({ ...prev, [key]: n }));
  };

  const resetForm = () => { setCounts({}); setLotNumber(''); };

  const handleBottle = () => {
    if (!lot || !canSubmit) return;
    const remaining = round1(availableL - volumeBottledL);
    const fullyBottled = remaining <= 0.5; // essentially emptied

    const breakdown = BOTTLE_FORMATS
      .filter(f => (counts[f.key] || 0) > 0)
      .map(f => `${counts[f.key]}×${f.labelKa}`)
      .join(', ');

    const updatedLots = lots.map(l => l.id !== lot.id ? l : {
      ...l,
      currentVolume: Math.max(0, remaining),
      stage: fullyBottled ? 'bottled' as const : l.stage,
      history: [
        { date, type: 'bottling', description: `${ka ? 'ჩამოსხმა' : 'Bottling'}: ${breakdown}${lotNumber ? ` (ლოტი ${lotNumber})` : ''}`, operator: operator || (ka ? 'უცნობი' : 'Unknown') },
        ...(l.history || []),
      ],
    });
    onUpdateLots(updatedLots);

    const run: BottlingRun = {
      id: `bot-${Date.now()}`,
      lotId: lot.id,
      lotName: lot.name,
      date,
      lotNumber,
      operator,
      formats: { ...counts },
      totalBottles,
      totalCeramic,
      volumeBottledL,
    };
    const next = [run, ...history];
    setHistory(next);
    saveBottlingHistory(next);
    setToastMessage?.(ka
      ? `ჩამოსხმა აღირიცხა: ${totalBottles + totalCeramic} ერთეული (${volumeBottledL} ლ)`
      : `Bottling recorded: ${totalBottles + totalCeramic} units (${volumeBottledL} L)`);
    resetForm();
    if (fullyBottled) {
      const stillBottleable = updatedLots.filter(l => l.currentVolume > 0 && l.stage !== 'sold');
      setLotId(stillBottleable[0]?.id || '');
    }
  };

  const deleteRun = (id: string) => {
    const next = history.filter(r => r.id !== id);
    setHistory(next);
    saveBottlingHistory(next);
  };

  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800';

  return (
    <div className="space-y-4 animate-fade-in text-stone-800">
      {/* Header */}
      <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
        <span className="text-[9px] uppercase tracking-widest bg-[#4e0e15]/10 text-[#4e0e15] px-2.5 py-0.5 rounded font-bold">
          {ka ? 'მარანი · ჩამოსხმა' : 'Cellar · Bottling'}
        </span>
        <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
          <Package className="w-5 h-5 text-[#4e0e15]" />
          {ka ? 'ღვინის ჩამოსხმა' : 'Wine Bottling'}
        </h3>
        <p className="text-xs text-stone-400 font-semibold mt-0.5">
          {ka ? 'ჩამოსხმის აღრიცხვა ფორმატების მიხედვით — სინქრონული დანართ №7-თან' : 'Record bottling runs by format — feeds official Annex №7'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4">
        {/* ── Bottling form ─────────────────────────────── */}
        <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-4 dark:bg-stone-900 dark:border-stone-800">
          {bottleable.length === 0 ? (
            <div className="text-center py-10 text-stone-400">
              <Wine className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-xs font-bold">{ka ? 'ჩამოსასხმელი ლოტი არ მოიძებნა' : 'No lots available to bottle'}</p>
            </div>
          ) : (
            <>
              <div>
                <label className={labelCls}>{ka ? 'ღვინის ლოტი' : 'Wine lot'}</label>
                <select value={lotId} onChange={e => { setLotId(e.target.value); resetForm(); }} className={inputCls}>
                  {bottleable.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.id}) — {round1(l.currentVolume)} L</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>{ka ? 'თარიღი' : 'Date'}</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ლოტის №' : 'Lot №'}</label>
                  <input type="text" value={lotNumber} onChange={e => setLotNumber(e.target.value)} placeholder={ka ? 'მაგ. L-2026-07' : 'e.g. L-2026-07'} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ოპერატორი' : 'Operator'}</label>
                  <input type="text" value={operator} onChange={e => setOperator(e.target.value)} className={inputCls} />
                </div>
              </div>

              {/* Format counts */}
              <div>
                <label className={labelCls}>{ka ? 'ბოთლის ფორმატები (ცალი)' : 'Bottle formats (units)'}</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {BOTTLE_FORMATS.map(f => (
                    <div key={f.key} className={`border rounded-lg px-2.5 py-1.5 ${f.kind === 'ceramic' ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20' : 'border-stone-200 dark:border-stone-800'}`}>
                      <span className="text-[10px] font-bold text-stone-500 block">{f.labelKa}</span>
                      <input type="number" min={0} value={counts[f.key] || ''} placeholder="0"
                        onChange={e => setCount(f.key, e.target.value)}
                        className="w-full bg-transparent text-sm font-bold text-stone-800 outline-none dark:text-amber-50" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Live summary */}
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono border-t border-stone-100 pt-3 dark:border-stone-800">
                <span className="text-stone-500">{ka ? 'ჩამოსხმული:' : 'Bottled:'} <strong className={overfill ? 'text-rose-600' : 'text-[#4e0e15] dark:text-amber-300'}>{volumeBottledL} L</strong></span>
                <span className="text-stone-500">{ka ? 'ხელმისაწვდომი:' : 'Available:'} <strong>{round1(availableL)} L</strong></span>
                <span className="text-stone-500">{ka ? 'ბოთლი:' : 'Bottles:'} <strong>{totalBottles}</strong></span>
                {totalCeramic > 0 && <span className="text-stone-500">{ka ? 'კერამიკა:' : 'Ceramic:'} <strong>{totalCeramic}</strong></span>}
              </div>

              {overfill && (
                <div className="flex items-center gap-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 dark:bg-rose-950/30">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {ka ? 'ჩამოსხმის მოცულობა აღემატება ლოტში არსებულ ნაშთს.' : 'Bottled volume exceeds the lot’s available balance.'}
                </div>
              )}

              <button onClick={handleBottle} disabled={!canSubmit}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 disabled:cursor-not-allowed text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors">
                <CheckCircle2 className="w-4 h-4" /> {ka ? 'ჩამოსხმის აღრიცხვა' : 'Record bottling'}
              </button>
            </>
          )}
        </div>

        {/* ── History ───────────────────────────────────── */}
        <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
          <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
            <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
              <Package className="w-4 h-4" /> {ka ? 'ჩამოსხმის ისტორია' : 'Bottling history'}
            </span>
            <span className="text-[9px] font-mono text-stone-400 flex items-center gap-1">
              <FileDown className="w-3 h-3" /> {ka ? 'დანართი №7' : 'Annex №7'}
            </span>
          </div>
          {history.length === 0 ? (
            <div className="text-center py-12 text-stone-400 text-xs font-semibold">
              {ka ? 'ჯერ არ არის ჩამოსხმა აღრიცხული' : 'No bottling runs recorded yet'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-400 font-bold dark:bg-stone-950">
                    <th className="p-2.5">{ka ? 'თარიღი' : 'Date'}</th>
                    <th className="p-2.5">{ka ? 'ლოტი' : 'Lot'}</th>
                    <th className="p-2.5 text-right">{ka ? 'ბოთლი' : 'Bottles'}</th>
                    <th className="p-2.5 text-right">{ka ? 'მოცულობა' : 'Volume'}</th>
                    <th className="p-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                  {history.map(r => (
                    <tr key={r.id} className="hover:bg-stone-50/50 dark:hover:bg-white/5">
                      <td className="p-2.5 font-mono text-stone-500">{r.date}</td>
                      <td className="p-2.5 font-bold text-stone-800 dark:text-amber-50">{r.lotName}<span className="block text-[9px] font-mono text-stone-400">{r.lotNumber || r.lotId}</span></td>
                      <td className="p-2.5 text-right font-bold">{r.totalBottles}{r.totalCeramic ? ` +${r.totalCeramic}🏺` : ''}</td>
                      <td className="p-2.5 text-right font-mono text-[#4e0e15] dark:text-amber-300">{r.volumeBottledL} L</td>
                      <td className="p-2.5 text-right">
                        <button onClick={() => deleteRun(r.id)} title={ka ? 'წაშლა' : 'Delete'}
                          className="text-stone-300 hover:text-rose-600 cursor-pointer transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
