import React, { useMemo, useState } from 'react';
import { Grape, CheckCircle2, AlertTriangle, ArrowRight, Sprout, Truck } from 'lucide-react';
import type { Language } from '../lib/i18n';
import type {
  WineLot, Vessel, VineyardBlock, HarvestRecord, GrapeIntakeRecord,
  WineClass, GrapeSource, GrapeIntakeCondition,
} from '../lib/wineryState';
import { estimateMustVolumeL, brixToPotentialAlcohol } from '../lib/wineryOperations';
import { EmptyState } from './ui/primitives';

interface Props {
  lang: Language;
  vessels: Vessel[];
  blocks: VineyardBlock[];
  harvests: HarvestRecord[];
  intakes: GrapeIntakeRecord[];
  currentUserName: string;
  currency: string;
  onReceiveGrapes: (input: Omit<GrapeIntakeRecord, 'id' | 'createdLotId' | 'netWeightKg' | 'estimatedVolumeL'>) => string;
  setActiveTab?: (t: string) => void;
  setToastMessage?: (m: string) => void;
}

const WINE_CLASSES: Array<{ key: WineClass; en: string; ka: string }> = [
  { key: 'red', en: 'Red', ka: 'წითელი' },
  { key: 'white', en: 'White', ka: 'თეთრი' },
  { key: 'amber', en: 'Amber (Qvevri)', ka: 'ქარვისფერი (ქვევრი)' },
  { key: 'rose', en: 'Rosé', ka: 'ვარდისფერი' },
  { key: 'sparkling', en: 'Sparkling base', ka: 'ცქრიალა' },
  { key: 'fortified', en: 'Fortified', ka: 'შემაგრებული' },
  { key: 'base_wine', en: 'Base wine', ka: 'საბაზო' },
];

const CONDITIONS: Array<{ key: GrapeIntakeCondition; en: string; ka: string }> = [
  { key: 'excellent', en: 'Excellent', ka: 'შესანიშნავი' },
  { key: 'good', en: 'Good', ka: 'კარგი' },
  { key: 'fair', en: 'Fair', ka: 'საშუალო' },
  { key: 'damaged', en: 'Damaged', ka: 'დაზიანებული' },
];

const round1 = (n: number) => Math.round(n * 10) / 10;

export default function GrapeReceivingTab({
  lang, vessels, blocks, harvests, intakes, currentUserName,
  currency,
  onReceiveGrapes, setActiveTab, setToastMessage,
}: Props) {
  const ka = lang === 'ka';
  const today = new Date().toISOString().slice(0, 10);
  const thisYear = new Date().getFullYear();

  const [source, setSource] = useState<GrapeSource>('own');
  const [blockId, setBlockId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [harvestRecordId, setHarvestRecordId] = useState('');
  const [variety, setVariety] = useState('');
  const [vintage, setVintage] = useState(thisYear);
  const [date, setDate] = useState(today);
  const [grossWeightKg, setGross] = useState('');
  const [tareWeightKg, setTare] = useState('');
  const [brix, setBrix] = useState('');
  const [ph, setPh] = useState('');
  const [ta, setTa] = useState('');
  const [temperatureC, setTemp] = useState('');
  const [condition, setCondition] = useState<GrapeIntakeCondition>('good');
  const [pickingMethod, setPicking] = useState<'hand' | 'machine'>('hand');
  const [wineClass, setWineClass] = useState<WineClass>('red');
  const [juiceYieldPct, setYield] = useState('70');
  const [costPerKg, setCostPerKg] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [destinationVesselId, setDest] = useState('');
  const [operator, setOperator] = useState('');
  const [notes, setNotes] = useState('');

  // Own-vineyard harvests not yet received into the winery.
  const pendingHarvests = useMemo(
    () => harvests.filter(h => !h.sentToGvino),
    [harvests],
  );

  const net = Math.max(0, (parseFloat(grossWeightKg) || 0) - (parseFloat(tareWeightKg) || 0));
  const yieldPct = parseFloat(juiceYieldPct) || 0;
  const estVolumeL = estimateMustVolumeL(net, yieldPct);
  const potentialAbv = brixToPotentialAlcohol(parseFloat(brix) || 0);
  const costPerKgNum = parseFloat(costPerKg) || 0;
  const explicitTotalCost = parseFloat(totalCost) || 0;
  const computedFruitCost = Math.round((explicitTotalCost || (net * costPerKgNum)) * 100) / 100;

  const destVessel = vessels.find(v => v.id === destinationVesselId) || null;
  const freeCapacity = destVessel ? round1(destVessel.capacity - destVessel.currentVolume) : 0;
  const overfill = !!destVessel && estVolumeL > freeCapacity + 0.001;

  const varietyOk = variety.trim().length > 0;
  const sourceOk = source === 'own' ? !!blockId : supplierName.trim().length > 0;
  const canSubmit = varietyOk && sourceOk && net > 0 && yieldPct > 0 && !overfill;

  const applyBlock = (id: string) => {
    setBlockId(id);
    const b = blocks.find(x => x.id === id);
    if (b && !variety) setVariety(b.grapeVariety);
  };

  const applyHarvest = (id: string) => {
    setHarvestRecordId(id);
    const h = harvests.find(x => x.id === id);
    if (!h) return;
    setSource('own');
    setBlockId(h.blockId);
    setVariety(h.variety);
    const b = blocks.find(x => x.id === h.blockId);
    if (b) setBlockId(b.id);
    if (h.estimatedTons) setGross(String(Math.round((h.actualHarvestedKg || h.estimatedTons * 1000))));
    if (h.temperatureAtHarvest != null) setTemp(String(h.temperatureAtHarvest));
  };

  const resetForm = () => {
    setHarvestRecordId(''); setVariety(''); setGross(''); setTare('');
    setBrix(''); setPh(''); setTa(''); setTemp(''); setCostPerKg(''); setTotalCost(''); setNotes(''); setDest('');
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const block = blocks.find(b => b.id === blockId);
    const lotId = onReceiveGrapes({
      date,
      source,
      supplierName: source === 'supplier' ? supplierName.trim() : undefined,
      blockId: source === 'own' ? blockId : undefined,
      blockName: source === 'own' ? (block?.name || '') : undefined,
      variety: variety.trim(),
      vintage,
      grossWeightKg: parseFloat(grossWeightKg) || 0,
      tareWeightKg: parseFloat(tareWeightKg) || 0,
      brix: parseFloat(brix) || 0,
      ph: parseFloat(ph) || 0,
      titratableAcidity: parseFloat(ta) || 0,
      temperatureC: parseFloat(temperatureC) || 0,
      condition,
      pickingMethod,
      wineClass,
      juiceYieldPct: yieldPct,
      costPerKg: costPerKgNum > 0 ? costPerKgNum : undefined,
      totalCost: computedFruitCost > 0 ? computedFruitCost : undefined,
      currency,
      destinationVesselId: destinationVesselId || null,
      harvestRecordId: harvestRecordId || undefined,
      operator: operator.trim() || currentUserName,
      notes: notes.trim(),
    });
    setToastMessage?.(ka
      ? `მიღება აღირიცხა: ${net.toLocaleString()} კგ ${variety} → ლოტი ${lotId}`
      : `Intake recorded: ${net.toLocaleString()} kg ${variety} → lot ${lotId}`);
    resetForm();
  };

  const openLot = (_lotId: string) => {
    setActiveTab?.('lots');
  };

  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800';

  return (
    <div className="space-y-4 animate-fade-in text-stone-800">
      {/* Header */}
      <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
        <span className="text-[9px] uppercase tracking-widest bg-[#4e0e15]/10 text-[#4e0e15] px-2.5 py-0.5 rounded font-bold">
          {ka ? 'მარანი · დურდოს მიღება' : 'Cellar · Grape Receiving'}
        </span>
        <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
          <Grape className="w-5 h-5 text-[#4e0e15]" />
          {ka ? 'ყურძნის მიღება' : 'Grape Intake'}
        </h3>
        <p className="text-xs text-stone-400 font-semibold mt-0.5">
          {ka
            ? 'ყურძნის მიღება საკუთარი ვენახიდან ან მომწოდებლისგან — ავტომატურად იქმნება პარტია და ივსება ჭურჭელი'
            : 'Receive fruit from an own block or a supplier — auto-creates the wine batch and fills the vessel'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4">
        {/* ── Intake form ───────────────────────────────── */}
        <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-4 dark:bg-stone-900 dark:border-stone-800">
          {/* Source toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setSource('own')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer ${source === 'own' ? 'bg-[#4e0e15] text-amber-50 border-[#4e0e15]' : 'bg-stone-50 text-stone-500 border-stone-200 dark:bg-stone-900 dark:border-stone-800'}`}>
              <Sprout className="w-3.5 h-3.5" /> {ka ? 'საკუთარი ვენახი' : 'Own vineyard'}
            </button>
            <button type="button" onClick={() => { setSource('supplier'); setHarvestRecordId(''); }}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer ${source === 'supplier' ? 'bg-[#4e0e15] text-amber-50 border-[#4e0e15]' : 'bg-stone-50 text-stone-500 border-stone-200 dark:bg-stone-900 dark:border-stone-800'}`}>
              <Truck className="w-3.5 h-3.5" /> {ka ? 'მომწოდებელი' : 'Supplier'}
            </button>
          </div>

          {/* Own vineyard: optional pending-harvest prefill + block */}
          {source === 'own' ? (
            <>
              {pendingHarvests.length > 0 && (
                <div>
                  <label className={labelCls}>{ka ? 'მოსავლის ჩანაწერიდან (არჩევითი)' : 'From planned harvest (optional)'}</label>
                  <select value={harvestRecordId} onChange={e => applyHarvest(e.target.value)} className={inputCls}>
                    <option value="">{ka ? '— ხელით შევსება —' : '— enter manually —'}</option>
                    {pendingHarvests.map(h => {
                      const b = blocks.find(x => x.id === h.blockId);
                      return <option key={h.id} value={h.id}>{h.variety} · {b?.name || h.blockId} · ~{h.estimatedTons}t</option>;
                    })}
                  </select>
                </div>
              )}
              <div>
                <label className={labelCls}>{ka ? 'ვენახის ბლოკი' : 'Vineyard block'}</label>
                <select value={blockId} onChange={e => applyBlock(e.target.value)} className={inputCls}>
                  <option value="">{ka ? '— აირჩიეთ ბლოკი —' : '— select block —'}</option>
                  {blocks.map(b => <option key={b.id} value={b.id}>{b.name} ({b.grapeVariety})</option>)}
                </select>
              </div>
            </>
          ) : (
            <div>
              <label className={labelCls}>{ka ? 'მომწოდებლის სახელი' : 'Supplier name'}</label>
              <input type="text" value={supplierName} onChange={e => setSupplierName(e.target.value)}
                placeholder={ka ? 'მაგ. გიორგი ბ. — სოფ. ვაზისუბანი' : 'e.g. Giorgi B. — Vazisubani'} className={inputCls} />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>{ka ? 'ჯიში' : 'Variety'}</label>
              <input type="text" value={variety} onChange={e => setVariety(e.target.value)}
                placeholder={ka ? 'საფერავი' : 'Saperavi'} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{ka ? 'მოსავალი (წელი)' : 'Vintage'}</label>
              <input type="number" value={vintage} onChange={e => setVintage(parseInt(e.target.value) || thisYear)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{ka ? 'თარიღი' : 'Date'}</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Weighbridge */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>{ka ? 'ბრუტო (კგ)' : 'Gross (kg)'}</label>
              <input type="number" min={0} value={grossWeightKg} onChange={e => setGross(e.target.value)} placeholder="12500" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{ka ? 'ტარა (კგ)' : 'Tare (kg)'}</label>
              <input type="number" min={0} value={tareWeightKg} onChange={e => setTare(e.target.value)} placeholder="500" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{ka ? 'გამოსავ. %' : 'Yield %'}</label>
              <input type="number" min={1} max={100} value={juiceYieldPct} onChange={e => setYield(e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Costing */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>{ka ? 'ყურძნის ფასი / კგ' : `Fruit cost / kg (${currency})`}</label>
              <input type="number" min={0} step="0.01" value={costPerKg} onChange={e => setCostPerKg(e.target.value)}
                placeholder="0.00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{ka ? 'სულ ყურძნის ხარჯი' : `Total fruit cost (${currency})`}</label>
              <input type="number" min={0} step="0.01" value={totalCost} onChange={e => setTotalCost(e.target.value)}
                placeholder={costPerKgNum > 0 && net > 0 ? String(Math.round(net * costPerKgNum * 100) / 100) : 'optional override'} className={inputCls} />
            </div>
          </div>
          {computedFruitCost > 0 && (
            <div className="text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 dark:bg-emerald-950/20 dark:text-emerald-300 dark:border-emerald-900">
              {ka ? 'ხარჯების წიგნში ჩაიწერება:' : 'Will post to cost ledger:'} <strong>{computedFruitCost.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}</strong>
            </div>
          )}

          {/* Chemistry */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div>
              <label className={labelCls}>°Brix</label>
              <input type="number" step="0.1" value={brix} onChange={e => setBrix(e.target.value)} placeholder="22.5" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>pH</label>
              <input type="number" step="0.01" value={ph} onChange={e => setPh(e.target.value)} placeholder="3.30" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{ka ? 'მჟავ. (TA)' : 'TA g/L'}</label>
              <input type="number" step="0.1" value={ta} onChange={e => setTa(e.target.value)} placeholder="6.0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{ka ? 'ტემპ. °C' : 'Temp °C'}</label>
              <input type="number" step="0.1" value={temperatureC} onChange={e => setTemp(e.target.value)} placeholder="18" className={inputCls} />
            </div>
          </div>

          {/* Classification */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>{ka ? 'ღვინის ტიპი' : 'Wine class'}</label>
              <select value={wineClass} onChange={e => setWineClass(e.target.value as WineClass)} className={inputCls}>
                {WINE_CLASSES.map(c => <option key={c.key} value={c.key}>{ka ? c.ka : c.en}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{ka ? 'მდგომარეობა' : 'Condition'}</label>
              <select value={condition} onChange={e => setCondition(e.target.value as GrapeIntakeCondition)} className={inputCls}>
                {CONDITIONS.map(c => <option key={c.key} value={c.key}>{ka ? c.ka : c.en}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{ka ? 'კრეფა' : 'Picking'}</label>
              <select value={pickingMethod} onChange={e => setPicking(e.target.value as 'hand' | 'machine')} className={inputCls}>
                <option value="hand">{ka ? 'ხელით' : 'Hand'}</option>
                <option value="machine">{ka ? 'მექანიკური' : 'Machine'}</option>
              </select>
            </div>
          </div>

          {/* Destination + operator */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>{ka ? 'დანიშნულების ჭურჭელი' : 'Destination vessel'}</label>
              <select value={destinationVesselId} onChange={e => setDest(e.target.value)} className={inputCls}>
                <option value="">{ka ? '— მოგვიანებით —' : '— assign later —'}</option>
                {vessels.map(v => (
                  <option key={v.id} value={v.id}>{v.id} — {round1(v.capacity - v.currentVolume)} L {ka ? 'თავისუფ.' : 'free'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{ka ? 'ოპერატორი' : 'Operator'}</label>
              <input type="text" value={operator} onChange={e => setOperator(e.target.value)} placeholder={currentUserName} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>{ka ? 'შენიშვნები' : 'Notes'}</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder={ka ? 'მაგ. ჯანმრთელი მტევნები, მსუბუქი ბოტრიტისი' : 'e.g. healthy clusters, light botrytis'} className={inputCls} />
          </div>

          {/* Live summary */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono border-t border-stone-100 pt-3 dark:border-stone-800">
            <span className="text-stone-500">{ka ? 'ნეტო:' : 'Net:'} <strong className="text-stone-800 dark:text-amber-50">{net.toLocaleString()} kg</strong></span>
            <span className="text-stone-500">{ka ? 'სავარაუდო ტკბილი:' : 'Est. must:'} <strong className={overfill ? 'text-rose-600' : 'text-[#4e0e15] dark:text-amber-300'}>{estVolumeL.toLocaleString()} L</strong></span>
            {potentialAbv > 0 && <span className="text-stone-500">{ka ? 'პოტ. ალკ.:' : 'Pot. ABV:'} <strong>{potentialAbv}%</strong></span>}
          </div>

          {overfill && (
            <div className="flex items-center gap-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 dark:bg-rose-950/30">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {ka
                ? `სავარაუდო მოცულობა აღემატება ჭურჭლის თავისუფალ ტევადობას (${freeCapacity} L).`
                : `Estimated volume exceeds the vessel’s free capacity (${freeCapacity} L).`}
            </div>
          )}

          <button onClick={handleSubmit} disabled={!canSubmit}
            className="sticky bottom-3 z-10 w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 disabled:cursor-not-allowed text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors shadow-lg shadow-[#4e0e15]/20 lg:static lg:shadow-none">
            <CheckCircle2 className="w-4 h-4" /> {ka ? 'მიღების აღრიცხვა და პარტიის შექმნა' : 'Record intake & create batch'}
          </button>
        </div>

        {/* ── Recent intakes ────────────────────────────── */}
        <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
          <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
            <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
              <Grape className="w-4 h-4" /> {ka ? 'მიღების ჟურნალი' : 'Intake log'}
            </span>
            <span className="text-[9px] font-mono text-stone-400">{intakes.length} {ka ? 'ჩანაწერი' : 'records'}</span>
          </div>
          {intakes.length === 0 ? (
            <>
            <EmptyState
              icon={Grape}
              title="No grape intakes yet"
              description="Fill in the receiving form to receive fruit and create the first wine batch."
            />
            <div className="hidden">
              <Grape className="w-10 h-10 mx-auto mb-2 opacity-30" />
              {ka ? 'ჯერ არ არის მიღება აღრიცხული. შეავსეთ ფორმა მარცხნივ.' : 'No intakes yet. Fill in the form to receive your first fruit.'}
            </div>
            </>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-400 font-bold dark:bg-stone-950">
                    <th className="p-2.5">{ka ? 'თარიღი' : 'Date'}</th>
                    <th className="p-2.5">{ka ? 'ჯიში / წყარო' : 'Variety / Source'}</th>
                    <th className="p-2.5 text-right">{ka ? 'ნეტო' : 'Net'}</th>
                    <th className="p-2.5 text-right">{ka ? 'ტკბილი' : 'Must'}</th>
                    <th className="p-2.5">{ka ? 'პარტია' : 'Batch'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                  {intakes.map(r => (
                    <tr key={r.id} className="hover:bg-stone-50/50 dark:hover:bg-white/5">
                      <td className="p-2.5 font-mono text-stone-500 whitespace-nowrap">{r.date}</td>
                      <td className="p-2.5">
                        <span className="font-bold text-stone-800 dark:text-amber-50">{r.variety}</span>
                        <span className="block text-[9px] font-mono text-stone-400">
                          {r.source === 'own' ? `🌿 ${r.blockName || (ka ? 'ვენახი' : 'block')}` : `🚚 ${r.supplierName || (ka ? 'მომწოდებელი' : 'supplier')}`}
                          {r.brix ? ` · ${r.brix}°Bx` : ''}
                        </span>
                      </td>
                      <td className="p-2.5 text-right font-bold whitespace-nowrap">{r.netWeightKg.toLocaleString()} kg</td>
                      <td className="p-2.5 text-right font-mono text-[#4e0e15] dark:text-amber-300 whitespace-nowrap">{r.estimatedVolumeL.toLocaleString()} L</td>
                      <td className="p-2.5">
                        <button onClick={() => openLot(r.createdLotId)}
                          className="text-[10px] font-mono text-[#4e0e15] hover:underline cursor-pointer flex items-center gap-0.5 dark:text-amber-300">
                          {r.createdLotId} <ArrowRight className="w-3 h-3" />
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
