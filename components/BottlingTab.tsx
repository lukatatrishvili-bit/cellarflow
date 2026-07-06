import React, { useMemo, useState } from 'react';
import { Wine, Package, AlertTriangle, CheckCircle2, Trash2, FileDown } from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { WineLot, BottlingRunRecord, InventoryItem } from '../lib/wineryState';
import { deductStock } from '../lib/wineryOperations';
import {
  classifyInventoryCostCategory,
  computeBottlingCostPosting,
  type BottlingPackagingComponent,
  type BottlingPackagingSelections,
  type CostEntry,
} from '../lib/costing';
import { stockMovementFromBottlingRun, type StockMovement, type StorageLocation } from '../lib/storage';

interface Props {
  lang: Language;
  lots: WineLot[];
  onUpdateLots: (lots: WineLot[]) => void;
  history: BottlingRunRecord[];
  onUpdateHistory: (runs: BottlingRunRecord[]) => void;
  inventory: InventoryItem[];
  onUpdateInventory: (inventory: InventoryItem[]) => void;
  costEntries: CostEntry[];
  onUpdateCostEntries: (entries: CostEntry[]) => void;
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
  onUpdateStockMovements: (movements: StockMovement[]) => void;
  currency: string;
  currentUserName: string;
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

export type BottlingRun = BottlingRunRecord;

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
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const PACKAGING_COMPONENTS: Array<{ key: BottlingPackagingComponent; en: string; ka: string }> = [
  { key: 'bottle', en: 'Bottle / ceramic', ka: 'ბოთლი / კერამიკა' },
  { key: 'closure', en: 'Cork / closure', ka: 'საცობი' },
  { key: 'capsule', en: 'Capsule', ka: 'კაფსულა' },
  { key: 'label', en: 'Label', ka: 'ეტიკეტი' },
  { key: 'box', en: 'Box / case', ka: 'ყუთი' },
];

export default function BottlingTab({
  lang,
  lots,
  onUpdateLots,
  history,
  onUpdateHistory,
  inventory,
  onUpdateInventory,
  costEntries,
  onUpdateCostEntries,
  storageLocations,
  stockMovements,
  onUpdateStockMovements,
  currency,
  currentUserName,
  setToastMessage,
}: Props) {
  const ka = lang === 'ka';

  const bottleable = useMemo(
    () => lots.filter(l => l.currentVolume > 0 && l.stage !== 'sold'),
    [lots],
  );

  const [lotId, setLotId] = useState(bottleable[0]?.id || '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lotNumber, setLotNumber] = useState('');
  const [operator, setOperator] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [packagingSelections, setPackagingSelections] = useState<BottlingPackagingSelections>({});
  const [bottlesPerBox, setBottlesPerBox] = useState('6');
  const [bottlingServiceCost, setBottlingServiceCost] = useState('');
  const [storageLocationId, setStorageLocationId] = useState('');

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
  const totalUnits = totalBottles + totalCeramic;

  const packagingItems = useMemo(() => {
    const filtered = inventory.filter(i => classifyInventoryCostCategory(i) === 'packaging');
    return filtered.length > 0 ? filtered : inventory;
  }, [inventory]);

  const costPreview = useMemo(() => computeBottlingCostPosting({
    runId: 'preview',
    date,
    lotId: lot?.id || '',
    totalUnits,
    packagingSelections,
    inventory,
    bottlesPerBox: parseInt(bottlesPerBox) || 6,
    bottlingServiceCost: parseFloat(bottlingServiceCost) || 0,
    currency,
    createdBy: operator || currentUserName,
  }), [bottlesPerBox, bottlingServiceCost, currency, currentUserName, date, inventory, lot?.id, operator, packagingSelections, totalUnits]);

  const overdrawnPackaging = useMemo(() => Object.entries(costPreview.deductions)
    .map(([itemId, qty]) => ({ item: inventory.find(i => i.id === itemId), qty }))
    .filter(x => x.item && x.qty > (x.item.stock || 0)), [costPreview.deductions, inventory]);
  const selectedStorageLocation = storageLocations.find(l => l.id === storageLocationId) || null;

  const setCount = (key: string, val: string) => {
    const n = Math.max(0, parseInt(val) || 0);
    setCounts(prev => ({ ...prev, [key]: n }));
  };

  const setPackaging = (component: BottlingPackagingComponent, itemId: string) => {
    setPackagingSelections(prev => {
      const next = { ...prev };
      if (itemId) next[component] = itemId;
      else delete next[component];
      return next;
    });
  };

  const resetForm = () => { setCounts({}); setLotNumber(''); setBottlingServiceCost(''); };

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

    const runId = `bot-${Date.now()}`;
    const storageMovement = stockMovementFromBottlingRun({
      runId,
      date,
      lotId: lot.id,
      locationId: storageLocationId,
      bottles: totalUnits,
      lotName: lot.name,
    });
    const costPosting = computeBottlingCostPosting({
      runId,
      date,
      lotId: lot.id,
      totalUnits,
      packagingSelections,
      inventory,
      bottlesPerBox: parseInt(bottlesPerBox) || 6,
      bottlingServiceCost: parseFloat(bottlingServiceCost) || 0,
      currency,
      createdBy: operator || currentUserName,
    });

    const run: BottlingRunRecord = {
      id: runId,
      lotId: lot.id,
      lotName: lot.name,
      date,
      lotNumber,
      operator,
      formats: { ...counts },
      totalBottles,
      totalCeramic,
      volumeBottledL,
      previousLotVolumeL: availableL,
      previousLotStage: lot.stage,
      ...(Object.keys(packagingSelections).length > 0 ? { packagingMaterialIds: { ...packagingSelections } } : {}),
      ...(Object.keys(costPosting.deductions).length > 0 ? { packagingDeductions: costPosting.deductions } : {}),
      ...(parseInt(bottlesPerBox) > 0 ? { bottlesPerBox: parseInt(bottlesPerBox) } : {}),
      ...(costPosting.packagingCostTotal > 0 ? { packagingCostTotal: costPosting.packagingCostTotal } : {}),
      ...(costPosting.bottlingServiceCost > 0 ? { bottlingServiceCost: costPosting.bottlingServiceCost } : {}),
      ...(storageMovement ? {
        storageLocationId: storageMovement.locationId,
        storageMovementId: storageMovement.id,
        placedInStorageBottles: storageMovement.bottles,
      } : {}),
    };
    const next = [run, ...history];
    onUpdateHistory(next);
    saveBottlingHistory(next);
    if (storageMovement) {
      onUpdateStockMovements([storageMovement, ...stockMovements]);
    }
    if (Object.keys(costPosting.deductions).length > 0) {
      onUpdateInventory(inventory.map(item => {
        const used = costPosting.deductions[item.id] || 0;
        return used > 0 ? { ...item, stock: deductStock(item.stock, used) } : item;
      }));
    }
    if (costPosting.entries.length > 0) {
      onUpdateCostEntries([...costPosting.entries, ...costEntries]);
    }
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
    const run = history.find(r => r.id === id);
    const next = history.filter(r => r.id !== id);
    onUpdateHistory(next);
    saveBottlingHistory(next);
    onUpdateCostEntries(costEntries.filter(e => e.sourceRef !== id));
    if (run?.storageMovementId) {
      onUpdateStockMovements(stockMovements.filter(m => m.id !== run.storageMovementId));
    }
    if (run?.packagingDeductions) {
      onUpdateInventory(inventory.map(item => {
        const restored = run.packagingDeductions?.[item.id] || 0;
        return restored > 0 ? { ...item, stock: round3((item.stock || 0) + restored) } : item;
      }));
    }
    if (run?.previousLotVolumeL !== undefined || run?.previousLotStage !== undefined) {
      onUpdateLots(lots.map(l => l.id !== run.lotId ? l : {
        ...l,
        ...(run.previousLotVolumeL !== undefined ? { currentVolume: run.previousLotVolumeL } : {}),
        ...(run.previousLotStage !== undefined ? { stage: run.previousLotStage } : {}),
      }));
    }
  };

  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800';
  const fmtMoney = (n: number) => `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

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
            <div className="text-center py-10 text-stone-500 dark:text-stone-400">
              <Wine className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-xs font-bold">{ka ? 'ჩამოსასხმელი ლოტი არ მოიძებნა' : 'No lots available to bottle'}</p>
              <p className="text-[11px] mt-1.5 max-w-xs mx-auto leading-relaxed">
                {ka
                  ? 'ჩამოსხმა ხელმისაწვდომი გახდება, როცა ლოტს ექნება მოცულობა — დაიწყეთ ყურძნის მიღებით და დუღილით.'
                  : 'Bottling unlocks once a wine lot holds volume — start with grape intake and fermentation, then return here.'}
              </p>
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

              {/* Packaging and bottling costing */}
              <div className="border border-stone-200 rounded-xl p-3 space-y-3 bg-stone-50/50 dark:bg-stone-950/40 dark:border-stone-800">
                <div className="flex items-center justify-between gap-2">
                  <label className={labelCls}>{ka ? 'შეფუთვის ხარჯები' : 'Packaging & bottling cost'}</label>
                  <span className="text-[10px] font-mono text-stone-400">{ka ? 'არასავალდებულო' : 'optional'}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PACKAGING_COMPONENTS.map(component => (
                    <div key={component.key}>
                      <span className="text-[10px] font-bold text-stone-500 block mb-1">{ka ? component.ka : component.en}</span>
                      <select value={packagingSelections[component.key] || ''} onChange={e => setPackaging(component.key, e.target.value)} className={inputCls}>
                        <option value="">{ka ? '— არ არის —' : '— none —'}</option>
                        {packagingItems.map(item => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {round1(item.stock)} {item.unit} · {fmtMoney(item.costPerUnit || 0)}/{item.unit}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] font-bold text-stone-500 block mb-1">{ka ? 'ბოთლი / ყუთი' : 'Bottles per box'}</span>
                    <input type="number" min={1} value={bottlesPerBox} onChange={e => setBottlesPerBox(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-stone-500 block mb-1">{ka ? 'ჩამოსხმის სერვისი' : `Bottling service (${currency})`}</span>
                    <input type="number" min={0} step="0.01" value={bottlingServiceCost} onChange={e => setBottlingServiceCost(e.target.value)} placeholder="0.00" className={inputCls} />
                  </div>
                </div>
                {(costPreview.packagingCostTotal > 0 || costPreview.bottlingServiceCost > 0) && (
                  <div className="text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 dark:bg-emerald-950/20 dark:text-emerald-300 dark:border-emerald-900">
                    {ka ? 'ხარჯებში ჩაიწერება:' : 'Will post to COGS:'}{' '}
                    <strong>{fmtMoney(costPreview.packagingCostTotal + costPreview.bottlingServiceCost)}</strong>
                    {costPreview.entries.length > 0 && <span className="text-stone-500"> · {costPreview.entries.length} {ka ? 'ჩანაწერი' : 'entry(s)'}</span>}
                  </div>
                )}
                {overdrawnPackaging.length > 0 && (
                  <div className="flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 dark:bg-amber-950/30">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      {ka ? 'მასალა აღემატება მარაგს — ნაშთი ნულამდე დაიყვანება:' : 'Some packaging exceeds stock; inventory will be clamped at zero:'}{' '}
                      {overdrawnPackaging.map(x => `${x.item?.name} (${round1(x.qty)} > ${round1(x.item?.stock || 0)})`).join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {/* Finished-goods placement */}
              {storageLocations.length > 0 && (
                <div className="border border-sky-200 rounded-xl p-3 space-y-2 bg-sky-50/50 dark:bg-sky-950/20 dark:border-sky-900/50">
                  <div className="flex items-center justify-between gap-2">
                    <label className={labelCls}>{ka ? 'საწყობში განთავსება' : 'Place finished goods'}</label>
                    <span className="text-[10px] font-mono text-stone-400">{ka ? 'არასავალდებულო' : 'optional'}</span>
                  </div>
                  <select value={storageLocationId} onChange={e => setStorageLocationId(e.target.value)} className={inputCls}>
                    <option value="">{ka ? '— მოგვიანებით განთავსება —' : '— place later —'}</option>
                    {storageLocations.map(loc => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}{loc.capacityBottles ? ` · ${loc.capacityBottles.toLocaleString()} btl cap.` : ''}
                      </option>
                    ))}
                  </select>
                  {storageLocationId && selectedStorageLocation && totalUnits > 0 && (
                    <div className="text-[11px] font-mono text-sky-800 bg-white border border-sky-100 rounded-lg px-3 py-2 dark:bg-stone-900 dark:text-sky-300 dark:border-sky-900">
                      {ka ? 'შეიქმნება საწყობის შემოსავლის მოძრაობა:' : 'Will create inbound storage movement:'}{' '}
                      <strong>{totalUnits.toLocaleString()} {ka ? 'ბოთლი' : 'bottles'}</strong> → {selectedStorageLocation.name}
                    </div>
                  )}
                </div>
              )}

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
