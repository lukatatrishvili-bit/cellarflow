import React, { useEffect, useMemo, useState } from 'react';
import { Coins, Plus, Trash2, Wine, FlaskConical, FileDown, FileSpreadsheet } from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { WineLot, InventoryItem, CompanyProfile, BottlingRunRecord } from '../lib/wineryState';
import { rollupLots, type CostEntry, type CostCategory } from '../lib/costing';
import type { WinePricing } from '../lib/costing/store';
import { buildCostReportRows, sumCostReport, costRowsToCSV } from '../lib/costing/report';
import { CountUp } from './motion';

interface Props {
  lang: Language;
  lots: WineLot[];
  inventory: InventoryItem[];
  company: CompanyProfile;
  bottlingRuns: BottlingRunRecord[];
  costEntries: CostEntry[];
  onUpdateCostEntries: (entries: CostEntry[]) => void;
  pricing: WinePricing;
  onUpdatePricing: (pricing: WinePricing) => void;
}

const CATEGORIES: Array<{ id: CostCategory; ka: string; en: string }> = [
  { id: 'grape', ka: 'ყურძენი', en: 'Grapes' },
  { id: 'additive', ka: 'დანამატები', en: 'Additives' },
  { id: 'packaging', ka: 'შეფუთვა', en: 'Packaging' },
  { id: 'labor', ka: 'შრომა', en: 'Labor' },
  { id: 'bottling', ka: 'ჩამოსხმა', en: 'Bottling' },
  { id: 'energy', ka: 'ენერგია', en: 'Energy' },
  { id: 'overhead', ka: 'ზედნადები', en: 'Overhead' },
  { id: 'other', ka: 'სხვა', en: 'Other' },
];
const catLabel = (id: CostCategory, ka: boolean) => {
  const c = CATEGORIES.find(x => x.id === id);
  return c ? (ka ? c.ka : c.en) : id;
};

const pricingToDraft = (pricing: WinePricing) =>
  Object.fromEntries(Object.entries(pricing).map(([lotId, value]) => [lotId, String(value)]));

const parsePriceDraft = (value: string | undefined) => {
  const normalized = (value || '').trim().replace(',', '.');
  if (!normalized) return 0;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
};

export default function CostsTab({
  lang,
  lots,
  inventory,
  company,
  bottlingRuns,
  costEntries,
  onUpdateCostEntries,
  pricing,
  onUpdatePricing,
}: Props) {
  const ka = lang === 'ka';
  const currency = company.currency || 'GEL';

  const bottlesByLot = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of bottlingRuns) {
      map[r.lotId] = (map[r.lotId] || 0) + (r.totalBottles || 0) + (r.totalCeramic || 0);
    }
    return map;
  }, [bottlingRuns]);

  const summaries = useMemo(() => rollupLots(
    lots.map(l => ({ id: l.id, volumeLitres: l.currentVolume || l.initialVolume || 0 })),
    costEntries,
    bottlesByLot,
  ), [lots, costEntries, bottlesByLot]);

  const totalCost = useMemo(() => costEntries.reduce((a, e) => a + e.amount, 0), [costEntries]);
  const [draftPricing, setDraftPricing] = useState<Record<string, string>>(() => pricingToDraft(pricing));

  useEffect(() => {
    setDraftPricing(pricingToDraft(pricing));
  }, [pricing]);

  // ── pricing + margin/valuation report ────────────────────────
  const reportRows = useMemo(() => buildCostReportRows(
    lots.map(l => ({ lotId: l.id, lotName: l.name, bottles: bottlesByLot[l.id] || 0, pricePerBottle: pricing[l.id] })),
    summaries,
  ), [lots, bottlesByLot, pricing, summaries]);
  const reportTotals = useMemo(() => sumCostReport(reportRows), [reportRows]);
  const updatePriceDraft = (lotId: string, value: string) => {
    setDraftPricing(prev => ({ ...prev, [lotId]: value }));
  };

  const savePrice = (lotId: string) => {
    const pricePerBottle = parsePriceDraft(draftPricing[lotId]);
    const current = pricing[lotId] || 0;
    if (pricePerBottle === current) {
      setDraftPricing(prev => ({ ...prev, [lotId]: pricePerBottle > 0 ? String(pricePerBottle) : '' }));
      return;
    }

    const next = { ...pricing };
    if (pricePerBottle > 0) next[lotId] = pricePerBottle;
    else delete next[lotId];
    onUpdatePricing(next);
  };

  const resetPriceDraft = (lotId: string) => {
    setDraftPricing(prev => ({ ...prev, [lotId]: pricing[lotId] ? String(pricing[lotId]) : '' }));
  };

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const exportCSV = () => {
    const csv = costRowsToCSV(reportRows, currency);
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `cost_margin_report.csv`);
  };
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const exportXLSX = async () => {
    setXlsxBusy(true);
    try {
      const { renderCostReportXlsx } = await import('../lib/costing/reportXlsx');
      const blob = await renderCostReportXlsx(reportRows, {
        company: company.companyName || 'MaraniOS',
        currency,
        generatedAt: new Date().toLocaleString(),
      });
      download(blob, 'cost_margin_report.xlsx');
    } finally {
      setXlsxBusy(false);
    }
  };

  // ── form state ──────────────────────────────────────────────
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lotId, setLotId] = useState(lots[0]?.id || '');
  const [category, setCategory] = useState<CostCategory>('additive');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [fromInventory, setFromInventory] = useState(false);
  const [invId, setInvId] = useState('');
  const [qty, setQty] = useState('');

  const invItem = inventory.find(i => i.id === invId);
  const computedAmount = fromInventory && invItem ? (parseFloat(qty) || 0) * (invItem.costPerUnit || 0) : parseFloat(amount) || 0;
  const canAdd = !!lotId && computedAmount > 0;

  const fmt = (n: number) => `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

  const submit = () => {
    if (!canAdd) return;
    const entry: CostEntry = {
      id: `cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date, lotId, category,
      description: description || (invItem ? invItem.name : catLabel(category, ka)),
      amount: Math.round(computedAmount * 100) / 100,
      currency,
      ...(fromInventory && invItem ? { quantity: parseFloat(qty) || 0, unitCost: invItem.costPerUnit, sourceRef: invItem.id } : {}),
    };
    onUpdateCostEntries([entry, ...costEntries]);
    setAmount(''); setQty(''); setDescription('');
  };

  const remove = (id: string) => onUpdateCostEntries(costEntries.filter(e => e.id !== id));

  const lotName = (id: string) => lots.find(l => l.id === id)?.name || id;
  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800';

  return (
    <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-6 flex flex-col space-y-5 font-sans animate-fade-in">
      {/* Header */}
      <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
        <span className="text-[9px] uppercase tracking-widest bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded font-bold">
          {ka ? 'ფინანსები' : 'Finance'}
        </span>
        <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
          <Coins className="w-5 h-5 text-[#4e0e15]" />
          {ka ? 'ხარჯები და თვითღირებულება' : 'Costs & Cost-of-Goods'}
        </h3>
        <p className="text-xs text-stone-400 font-semibold mt-0.5">
          {ka ? 'ხარჯის აღრიცხვა ლოტებზე — თვითღირებულება ლიტრზე და ბოთლზე' : 'Track costs against lots — cost per litre and per bottle'}
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-[#e8dfd5] rounded-2xl p-4 dark:bg-stone-900 dark:border-stone-800">
          <span className="text-[9px] uppercase font-mono text-stone-400 font-bold tracking-widest">{ka ? 'სულ ხარჯი' : 'Total cost'}</span>
          <strong className="block mt-1 text-2xl font-serif font-black text-[#4e0e15] dark:text-amber-300">
            <CountUp value={totalCost} format={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })} /> {currency}
          </strong>
        </div>
        <div className="bg-white border border-[#e8dfd5] rounded-2xl p-4 dark:bg-stone-900 dark:border-stone-800">
          <span className="text-[9px] uppercase font-mono text-stone-400 font-bold tracking-widest">{ka ? 'მზა მარაგის ღირებ.' : 'Finished-goods value'}</span>
          <strong className="block mt-1 text-2xl font-serif font-black text-emerald-800 dark:text-emerald-400">
            <CountUp value={reportTotals.inventoryValue} format={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })} /> {currency}
          </strong>
        </div>
        <div className="bg-white border border-[#e8dfd5] rounded-2xl p-4 dark:bg-stone-900 dark:border-stone-800">
          <span className="text-[9px] uppercase font-mono text-stone-400 font-bold tracking-widest">{ka ? 'მთლიანი მოგება' : 'Gross profit'}</span>
          <strong className={`block mt-1 text-2xl font-serif font-black ${reportTotals.grossProfit >= 0 ? 'text-emerald-800 dark:text-emerald-400' : 'text-rose-600'}`}>
            <CountUp value={reportTotals.grossProfit} format={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })} /> {currency}
          </strong>
        </div>
        <div className="bg-white border border-[#e8dfd5] rounded-2xl p-4 dark:bg-stone-900 dark:border-stone-800">
          <span className="text-[9px] uppercase font-mono text-stone-400 font-bold tracking-widest">{ka ? 'ვალუტა' : 'Currency'}</span>
          <strong className="block mt-1 text-2xl font-serif font-black text-stone-800 dark:text-amber-100">{currency}</strong>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
        {/* Add entry */}
        <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-3 dark:bg-stone-900 dark:border-stone-800 self-start">
          <h4 className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100"><Plus className="w-4 h-4" /> {ka ? 'ხარჯის დამატება' : 'Add cost'}</h4>

          {lots.length === 0 ? (
            <p className="text-xs text-stone-400 py-6 text-center">{ka ? 'ჯერ არ არის ლოტი' : 'No wine lots yet'}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>{ka ? 'თარიღი' : 'Date'}</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>{ka ? 'კატეგორია' : 'Category'}</label>
                  <select value={category} onChange={e => setCategory(e.target.value as CostCategory)} className={inputCls}>
                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{ka ? c.ka : c.en}</option>)}
                  </select>
                </div>
              </div>
              <div><label className={labelCls}>{ka ? 'ლოტი' : 'Wine lot'}</label>
                <select value={lotId} onChange={e => setLotId(e.target.value)} className={inputCls}>
                  {lots.map(l => <option key={l.id} value={l.id}>{l.name} ({l.id})</option>)}
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                <input type="checkbox" checked={fromInventory} onChange={e => setFromInventory(e.target.checked)} className="w-3.5 h-3.5 accent-[#4e0e15]" />
                <span className="text-[11px] font-bold text-stone-600 dark:text-stone-300">{ka ? 'ინვენტარიდან (რაოდ. × ფასი)' : 'From inventory (qty × unit cost)'}</span>
              </label>

              {fromInventory ? (
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={labelCls}>{ka ? 'მასალა' : 'Material'}</label>
                    <select value={invId} onChange={e => setInvId(e.target.value)} className={inputCls}>
                      <option value="">{ka ? 'აირჩიეთ' : 'Select…'}</option>
                      {inventory.map(i => <option key={i.id} value={i.id}>{i.name} ({fmt(i.costPerUnit || 0)}/{i.unit})</option>)}
                    </select>
                  </div>
                  <div><label className={labelCls}>{ka ? 'რაოდენობა' : 'Quantity'}</label><input type="number" min={0} value={qty} onChange={e => setQty(e.target.value)} className={inputCls} placeholder={invItem?.unit || ''} /></div>
                </div>
              ) : (
                <div><label className={labelCls}>{ka ? `თანხა (${currency})` : `Amount (${currency})`}</label><input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} /></div>
              )}

              <div><label className={labelCls}>{ka ? 'აღწერა' : 'Description'}</label><input type="text" value={description} onChange={e => setDescription(e.target.value)} className={inputCls} placeholder={ka ? 'არასავალდებულო' : 'optional'} /></div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] font-mono text-stone-500">{ka ? 'თანხა:' : 'Amount:'} <strong className="text-[#4e0e15] dark:text-amber-300">{fmt(computedAmount)}</strong></span>
                <button onClick={submit} disabled={!canAdd}
                  className="px-4 py-2 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 disabled:cursor-not-allowed text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors">
                  {ka ? 'დამატება' : 'Add'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Per-lot rollup + entries */}
        <div className="space-y-4">
          <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
            <div className="px-4 py-3 border-b border-[#e8dfd5] dark:border-stone-800 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100"><Wine className="w-4 h-4" /> {ka ? 'თვითღირებულება და მოგება' : 'Cost & margin per lot'}</span>
              <div className="flex items-center gap-1.5">
                <button onClick={exportCSV} className="flex items-center gap-1 px-2.5 py-1 border border-stone-200 dark:border-stone-700 rounded-lg text-[10px] font-bold uppercase tracking-wide text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
                  <FileDown className="w-3 h-3" /> CSV
                </button>
                <button onClick={exportXLSX} disabled={xlsxBusy} className="flex items-center gap-1 px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white rounded-lg text-[10px] font-bold uppercase tracking-wide cursor-pointer">
                  <FileSpreadsheet className="w-3 h-3" /> {xlsxBusy ? '…' : 'XLSX'}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] whitespace-nowrap">
                <thead>
                  <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-400 font-bold dark:bg-stone-950">
                    <th className="p-2.5">{ka ? 'ლოტი' : 'Lot'}</th>
                    <th className="p-2.5 text-right">{ka ? 'სულ' : 'Total'}</th>
                    <th className="p-2.5 text-right">{ka ? 'ლიტრზე' : '/L'}</th>
                    <th className="p-2.5 text-right">{ka ? 'ბოთლზე' : '/Bottle'}</th>
                    <th className="p-2.5 text-right">{ka ? 'ბოთლი' : 'Bottles'}</th>
                    <th className="p-2.5 text-right">{ka ? 'ფასი' : 'Price'}</th>
                    <th className="p-2.5 text-right">{ka ? 'მარჟა' : 'Margin'}</th>
                    <th className="p-2.5 text-right">{ka ? 'მოგება' : 'Profit'}</th>
                    <th className="p-2.5 text-right">{ka ? 'ღირებ.' : 'Value'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                  {lots.length === 0 ? (
                    <tr><td colSpan={9} className="p-6 text-center text-stone-400 italic">{ka ? 'მონაცემები არ არის' : 'No data'}</td></tr>
                  ) : reportRows.map(r => (
                    <tr key={r.lotId} className="hover:bg-stone-50/50 dark:hover:bg-white/5">
                      <td className="p-2.5 font-bold text-stone-800 dark:text-amber-50">{r.lotName}<span className="block text-[9px] font-mono text-stone-400">{r.lotId}</span></td>
                      <td className="p-2.5 text-right font-mono text-[#4e0e15] dark:text-amber-300">{fmt(r.totalCost)}</td>
                      <td className="p-2.5 text-right font-mono">{r.perLitre != null ? fmt(r.perLitre) : '—'}</td>
                      <td className="p-2.5 text-right font-mono">{r.perBottle != null ? fmt(r.perBottle) : '—'}</td>
                      <td className="p-2.5 text-right font-mono text-stone-500">{r.bottles || '—'}</td>
                      <td className="p-2.5 text-right">
                        <input type="number" min={0} step="0.01" value={draftPricing[r.lotId] ?? ''} onChange={e => updatePriceDraft(r.lotId, e.target.value)} onBlur={() => savePrice(r.lotId)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') resetPriceDraft(r.lotId); }}
                          placeholder="—" className="w-16 bg-stone-50 border border-stone-200 dark:bg-stone-800 dark:border-stone-700 rounded px-1.5 py-1 text-right text-[11px] font-mono outline-none focus:border-[#4e0e15]" />
                      </td>
                      <td className={`p-2.5 text-right font-mono font-bold ${r.marginPct == null ? 'text-stone-300' : r.marginPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}`}>{r.marginPct != null ? `${r.marginPct}%` : '—'}</td>
                      <td className={`p-2.5 text-right font-mono ${r.grossProfit < 0 ? 'text-rose-600' : 'text-stone-700 dark:text-stone-300'}`}>{r.pricePerBottle != null ? fmt(r.grossProfit) : '—'}</td>
                      <td className="p-2.5 text-right font-mono text-stone-600 dark:text-stone-300">{r.perBottle != null ? fmt(r.inventoryValue) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Ledger */}
          <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
            <div className="px-4 py-3 border-b border-[#e8dfd5] dark:border-stone-800">
              <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100"><FlaskConical className="w-4 h-4" /> {ka ? 'ხარჯების ჟურნალი' : 'Cost ledger'}</span>
            </div>
            {costEntries.length === 0 ? (
              <div className="text-center py-10 text-stone-400 text-xs font-semibold">{ka ? 'ჯერ არ არის ხარჯი აღრიცხული' : 'No costs recorded yet'}</div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0">
                    <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-400 font-bold dark:bg-stone-950">
                      <th className="p-2.5">{ka ? 'თარიღი' : 'Date'}</th>
                      <th className="p-2.5">{ka ? 'ლოტი' : 'Lot'}</th>
                      <th className="p-2.5">{ka ? 'კატეგ.' : 'Category'}</th>
                      <th className="p-2.5">{ka ? 'აღწერა' : 'Description'}</th>
                      <th className="p-2.5 text-right">{ka ? 'თანხა' : 'Amount'}</th>
                      <th className="p-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                    {costEntries.map(e => (
                      <tr key={e.id} className="hover:bg-stone-50/50 dark:hover:bg-white/5">
                        <td className="p-2.5 font-mono text-stone-500">{e.date}</td>
                        <td className="p-2.5 text-stone-700 dark:text-amber-50">{lotName(e.lotId)}</td>
                        <td className="p-2.5"><span className="px-1.5 py-0.5 bg-stone-100 dark:bg-stone-800 rounded text-[9px] font-bold uppercase">{catLabel(e.category, ka)}</span></td>
                        <td className="p-2.5 text-stone-600 dark:text-stone-300">{e.description}</td>
                        <td className={`p-2.5 text-right font-mono font-bold ${e.amount < 0 ? 'text-rose-600' : 'text-stone-800 dark:text-amber-200'}`}>{fmt(e.amount)}</td>
                        <td className="p-2.5 text-right"><button onClick={() => remove(e.id)} className="text-stone-300 hover:text-rose-600 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
