import React, { useMemo, useState } from 'react';
import { Warehouse, Plus, Trash2, Boxes, Thermometer, Droplet, PackagePlus, LockKeyhole } from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { WineLot, BottlingRunRecord, SalesOrderRecord } from '../lib/wineryState';
import { computeStock, unstored, utilization, type StorageLocation, type StockMovement, type StorageType } from '../lib/storage';
import { reservedBottlesFor, stockAvailabilityPosition } from '../lib/sales';
import { CountUp } from './motion';

interface Props {
  lang: Language;
  lots: WineLot[];
  bottlingRuns: BottlingRunRecord[];
  locations: StorageLocation[];
  movements: StockMovement[];
  orders?: SalesOrderRecord[];
  onUpdateLocations: (locations: StorageLocation[]) => void;
  onUpdateMovements: (movements: StockMovement[]) => void;
  setToastMessage?: (message: string) => void;
}

const TYPES: Array<{ id: StorageType; ka: string; en: string }> = [
  { id: 'warehouse', ka: 'საწყობი', en: 'Warehouse' },
  { id: 'cellar', ka: 'მარანი', en: 'Cellar' },
  { id: 'rack', ka: 'სტელაჟი', en: 'Rack' },
  { id: 'cold_room', ka: 'მაცივარი', en: 'Cold room' },
  { id: 'qvevri_hall', ka: 'ქვევრის დარბაზი', en: 'Qvevri hall' },
  { id: 'other', ka: 'სხვა', en: 'Other' },
];
const typeLabel = (id: StorageType, ka: boolean) => { const t = TYPES.find(x => x.id === id); return t ? (ka ? t.ka : t.en) : id; };

export default function StorageTab({
  lang,
  lots,
  bottlingRuns,
  locations,
  movements,
  orders = [],
  onUpdateLocations,
  onUpdateMovements,
  setToastMessage,
}: Props) {
  const ka = lang === 'ka';
  const today = new Date().toISOString().slice(0, 10);

  const producedByLot = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of bottlingRuns) m[r.lotId] = (m[r.lotId] || 0) + (r.totalBottles || 0) + (r.totalCeramic || 0);
    return m;
  }, [bottlingRuns]);

  const stock = useMemo(() => computeStock(movements), [movements]);
  const unstoredByLot = useMemo(() => unstored(producedByLot, movements), [producedByLot, movements]);
  const totalStored = useMemo(() => [...stock.values()].reduce((a, s) => a + s.totalBottles, 0), [stock]);
  const totalReserved = useMemo(() => {
    let sum = 0;
    for (const loc of stock.values()) {
      for (const [lotId, bottles] of Object.entries(loc.byLot)) {
        sum += Math.min(bottles, reservedBottlesFor(orders, loc.locationId, lotId, today));
      }
    }
    return sum;
  }, [orders, stock, today]);
  const totalAvailable = Math.max(0, totalStored - totalReserved);
  const totalUnstored = useMemo(() => Object.values(unstoredByLot).reduce((a, n) => a + n, 0), [unstoredByLot]);

  const lotName = (id: string) => lots.find(l => l.id === id)?.name || id;

  // location form
  const [ln, setLn] = useState(''); const [lt, setLt] = useState<StorageType>('warehouse');
  const [lcap, setLcap] = useState(''); const [ltemp, setLtemp] = useState(''); const [lhum, setLhum] = useState('');
  const addLoc = () => {
    if (!ln.trim()) return;
    const loc: StorageLocation = {
      id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: ln.trim(), type: lt,
      capacityBottles: parseInt(lcap) || undefined,
      targetTempC: ltemp === '' ? undefined : parseFloat(ltemp),
      targetHumidity: lhum === '' ? undefined : parseFloat(lhum),
    };
    onUpdateLocations([...locations, loc]);
    setLn(''); setLcap(''); setLtemp(''); setLhum('');
  };

  // movement form
  const [mDate, setMDate] = useState(new Date().toISOString().slice(0, 10));
  const [mLot, setMLot] = useState(lots[0]?.id || '');
  const [mLoc, setMLoc] = useState('');
  const [mDir, setMDir] = useState<'in' | 'out'>('in');
  const [mQty, setMQty] = useState('');
  const moveQty = Math.max(0, parseInt(mQty) || 0);
  const selectedOnHand = stock.get(mLoc)?.byLot[mLot] || 0;
  const selectedPosition = stockAvailabilityPosition({
    onHandBottles: selectedOnHand,
    orders,
    locationId: mLoc,
    lotId: mLot,
    asOfDate: today,
  });
  const overAvailableForOut = mDir === 'out' && moveQty > selectedPosition.availableBottles;
  const canMove = !!mLot && !!mLoc && moveQty > 0 && !overAvailableForOut;
  const submitMove = () => {
    if (!canMove) {
      if (overAvailableForOut) {
        setToastMessage?.(
          ka
            ? 'ვერ გაიცემა: რაოდენობა აჭარბებს არარეზერვირებულ ხელმისაწვდომ მარაგს.'
            : 'Cannot record outbound movement: quantity exceeds unreserved available stock.'
        );
      }
      return;
    }
    const movement: StockMovement = {
      id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: mDate,
      lotId: mLot,
      locationId: mLoc,
      direction: mDir,
      bottles: moveQty,
      reason: mDir === 'in' ? 'receive' : 'dispatch',
    };
    onUpdateMovements([movement, ...movements]);
    setMQty('');
  };
  const prefillReceive = (lotId: string, bottles: number) => {
    setMLot(lotId); setMDir('in'); setMQty(String(bottles)); if (!mLoc && locations[0]) setMLoc(locations[0].id);
  };

  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800';

  return (
    <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-6 flex flex-col space-y-5 font-sans animate-fade-in">
      <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
        <span className="text-[9px] uppercase tracking-widest bg-sky-100 text-sky-800 px-2.5 py-0.5 rounded font-bold">{ka ? 'მარაგი' : 'Inventory'}</span>
        <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
          <Warehouse className="w-5 h-5 text-[#4e0e15]" /> {ka ? 'ღვინის შენახვა' : 'Wine Storage'}
        </h3>
        <p className="text-xs text-stone-400 font-semibold mt-0.5">{ka ? 'მზა ნაწარმის მარაგი ლოკაციების მიხედვით' : 'Finished-goods stock by location · feeds Annex №8'}</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: ka ? 'რეზერვში' : 'Reserved', value: totalReserved, accent: totalReserved > 0 ? 'text-blue-700 dark:text-blue-300' : 'text-stone-800 dark:text-amber-100' },
          { label: ka ? 'ხელმისაწვდომი' : 'Available', value: totalAvailable, accent: 'text-emerald-700 dark:text-emerald-400' },
          { label: ka ? 'შენახული ბოთლი' : 'Bottles stored', value: totalStored, accent: 'text-[#4e0e15] dark:text-amber-300' },
          { label: ka ? 'ლოკაციები' : 'Locations', value: locations.length, accent: 'text-stone-800 dark:text-amber-100' },
          { label: ka ? 'განსათავსებელი' : 'To place', value: totalUnstored, accent: totalUnstored > 0 ? 'text-amber-600' : 'text-stone-800 dark:text-amber-100' },
          { label: ka ? 'ლოტები' : 'Lots', value: lots.length, accent: 'text-stone-800 dark:text-amber-100' },
        ].map((c, i) => (
          <div key={i} className="bg-white border border-[#e8dfd5] rounded-2xl p-4 dark:bg-stone-900 dark:border-stone-800">
            <span className="text-[9px] uppercase font-mono text-stone-400 font-bold tracking-widest">{c.label}</span>
            <strong className={`block mt-1 text-2xl font-serif font-black ${c.accent}`}><CountUp value={c.value} /></strong>
          </div>
        ))}
      </div>

      {/* Unstored hint */}
      {totalUnstored > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 dark:bg-amber-950/30 dark:border-amber-900/50">
          <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300">{ka ? 'ჩამოსხმული, მაგრამ ჯერ არ განთავსებული:' : 'Bottled but not yet placed in storage:'}</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {Object.entries(unstoredByLot).map(([lotId, n]) => (
              <button key={lotId} onClick={() => prefillReceive(lotId, n)}
                className="flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-stone-900 border border-amber-300 rounded-lg text-[10px] font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-100 cursor-pointer">
                <PackagePlus className="w-3 h-3" /> {lotName(lotId)} — {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5">
        {/* Locations */}
        <div className="space-y-4">
          <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-3 dark:bg-stone-900 dark:border-stone-800">
            <h4 className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100"><Plus className="w-4 h-4" /> {ka ? 'ლოკაციის დამატება' : 'Add location'}</h4>
            <div><label className={labelCls}>{ka ? 'დასახელება' : 'Name'}</label><input value={ln} onChange={e => setLn(e.target.value)} className={inputCls} placeholder={ka ? 'მაგ. მთავარი საწყობი' : 'e.g. Main warehouse'} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>{ka ? 'ტიპი' : 'Type'}</label>
                <select value={lt} onChange={e => setLt(e.target.value as StorageType)} className={inputCls}>{TYPES.map(t => <option key={t.id} value={t.id}>{ka ? t.ka : t.en}</option>)}</select>
              </div>
              <div><label className={labelCls}>{ka ? 'ტევადობა (ბოთლი)' : 'Capacity (btl)'}</label><input type="number" min={0} value={lcap} onChange={e => setLcap(e.target.value)} className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>{ka ? 'სამიზნე °C' : 'Target °C'}</label><input type="number" value={ltemp} onChange={e => setLtemp(e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>{ka ? 'ტენიანობა %' : 'Humidity %'}</label><input type="number" value={lhum} onChange={e => setLhum(e.target.value)} className={inputCls} /></div>
            </div>
            <button onClick={addLoc} disabled={!ln.trim()} className="w-full px-4 py-2 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer">{ka ? 'დამატება' : 'Add'}</button>
          </div>

          {/* Movement form */}
          <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-3 dark:bg-stone-900 dark:border-stone-800">
            <h4 className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100"><Boxes className="w-4 h-4" /> {ka ? 'მოძრაობა' : 'Stock movement'}</h4>
            {locations.length === 0 ? (
              <p className="text-xs text-stone-400 py-4 text-center">{ka ? 'ჯერ დაამატეთ ლოკაცია' : 'Add a location first'}</p>
            ) : (
              <>
                <div className="inline-flex rounded-lg border border-stone-200 overflow-hidden w-full dark:border-stone-800">
                  {([{ id: 'in', ka: 'მიღება', en: 'Receive' }, { id: 'out', ka: 'გაცემა', en: 'Dispatch' }] as const).map(o => (
                    <button key={o.id} onClick={() => setMDir(o.id)} className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase cursor-pointer ${mDir === o.id ? (o.id === 'in' ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white') : 'bg-stone-50 text-stone-500 dark:bg-stone-900'}`}>{ka ? o.ka : o.en}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={labelCls}>{ka ? 'თარიღი' : 'Date'}</label><input type="date" value={mDate} onChange={e => setMDate(e.target.value)} className={inputCls} /></div>
                  <div><label className={labelCls}>{ka ? 'ბოთლი' : 'Bottles'}</label><input type="number" min={0} value={mQty} onChange={e => setMQty(e.target.value)} className={inputCls} /></div>
                </div>
                <div><label className={labelCls}>{ka ? 'ლოტი' : 'Wine lot'}</label><select value={mLot} onChange={e => setMLot(e.target.value)} className={inputCls}>{lots.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
                <div><label className={labelCls}>{ka ? 'ლოკაცია' : 'Location'}</label><select value={mLoc} onChange={e => setMLoc(e.target.value)} className={inputCls}><option value="">{ka ? 'აირჩიეთ' : 'Select…'}</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
                <button onClick={submitMove} disabled={!canMove} className="w-full px-4 py-2 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer">{ka ? 'დაფიქსირება' : 'Record'}</button>
                {mDir === 'out' && mLoc && mLot && (
                  <div className="text-[11px] font-mono border border-stone-200 rounded-xl p-3 bg-stone-50/60 space-y-1 dark:bg-stone-950/40 dark:border-stone-800">
                    <div className="flex justify-between"><span>{ka ? 'საწყობში' : 'On hand'}</span><strong>{selectedPosition.onHandBottles.toLocaleString()} btl</strong></div>
                    <div className="flex justify-between"><span>{ka ? 'რეზერვში' : 'Reserved'}</span><strong className="text-blue-700 dark:text-blue-300">{selectedPosition.reservedBottles.toLocaleString()} btl</strong></div>
                    <div className="flex justify-between"><span>{ka ? 'ხელმისაწვდომი გასაცემად' : 'Available for outbound'}</span><strong className="text-emerald-700 dark:text-emerald-400">{selectedPosition.availableBottles.toLocaleString()} btl</strong></div>
                  </div>
                )}
                {overAvailableForOut && (
                  <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-2">
                    <LockKeyhole className="w-3.5 h-3.5" />
                    {ka ? 'რაოდენობა აჭარბებს არარეზერვირებულ ხელმისაწვდომ მარაგს.' : 'Quantity exceeds unreserved available stock. Reserved bottles are protected.'}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Stock by location */}
        <div className="space-y-4">
          {locations.length === 0 ? (
            <div className="bg-white border border-dashed border-[#e8dfd5] rounded-2xl p-12 text-center text-stone-400 dark:bg-stone-900 dark:border-stone-800">
              <Warehouse className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-xs font-bold">{ka ? 'დაამატეთ პირველი ლოკაცია' : 'Add your first storage location'}</p>
            </div>
          ) : locations.map(loc => {
            const s = stock.get(loc.id);
            const u = utilization(s, loc);
            const lotEntries = s ? Object.entries(s.byLot) : [];
            return (
              <div key={loc.id} className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
                <div className="px-4 py-3 border-b border-[#e8dfd5] dark:border-stone-800 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-serif font-bold text-[#4e0e15] dark:text-amber-100">{loc.name}</span>
                    <span className="ml-2 text-[9px] font-mono uppercase text-stone-400">{typeLabel(loc.type, ka)}</span>
                    <div className="flex items-center gap-3 mt-0.5 text-[9px] font-mono text-stone-400">
                      {loc.targetTempC != null && <span className="flex items-center gap-0.5"><Thermometer className="w-3 h-3" />{loc.targetTempC}°C</span>}
                      {loc.targetHumidity != null && <span className="flex items-center gap-0.5"><Droplet className="w-3 h-3" />{loc.targetHumidity}%</span>}
                    </div>
                  </div>
                  <button onClick={() => onUpdateLocations(locations.filter(l => l.id !== loc.id))} className="text-stone-300 hover:text-rose-600 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="p-4 space-y-3">
                  {/* capacity bar */}
                  <div>
                    <div className="flex justify-between text-[10px] font-mono text-stone-500 mb-1">
                      <span>{u.used.toLocaleString()} {ka ? 'ბოთლი' : 'bottles'}</span>
                      {u.capacity != null && <span className={u.over ? 'text-rose-600 font-bold' : ''}>{u.pct}% {ka ? 'სავსე' : 'full'}{u.over ? ` · ${ka ? 'გადავსება!' : 'over!'}` : ''}</span>}
                    </div>
                    {u.capacity != null && (
                      <div className="h-2 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${u.over ? 'bg-rose-500' : 'bg-emerald-600'}`} style={{ width: `${Math.min(100, u.pct || 0)}%` }} />
                      </div>
                    )}
                  </div>
                  {lotEntries.length === 0 ? (
                    <p className="text-[11px] text-stone-400 italic">{ka ? 'ცარიელია' : 'Empty'}</p>
                  ) : (
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="text-[9px] uppercase font-mono text-stone-400">
                          <th className="py-1.5 font-bold">{ka ? 'ლოტი' : 'Lot'}</th>
                          <th className="py-1.5 text-right font-bold">{ka ? 'საწყობში' : 'On hand'}</th>
                          <th className="py-1.5 text-right font-bold">{ka ? 'რეზერვი' : 'Reserved'}</th>
                          <th className="py-1.5 text-right font-bold">{ka ? 'ხელმისაწვ.' : 'Available'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                        {lotEntries.map(([lotId, n]) => {
                          const pos = stockAvailabilityPosition({
                            onHandBottles: n,
                            orders,
                            locationId: loc.id,
                            lotId,
                            asOfDate: today,
                          });
                          return (
                            <tr key={lotId}>
                              <td className="py-1.5 text-stone-700 dark:text-amber-50">{lotName(lotId)}</td>
                              <td className="py-1.5 text-right font-mono font-bold text-[#4e0e15] dark:text-amber-300">{pos.onHandBottles.toLocaleString()}</td>
                              <td className="py-1.5 text-right font-mono font-bold text-blue-700 dark:text-blue-300">{pos.reservedBottles.toLocaleString()}</td>
                              <td className="py-1.5 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">{pos.availableBottles.toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })}

          {/* Recent movements */}
          {movements.length > 0 && (
            <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
              <div className="px-4 py-3 border-b border-[#e8dfd5] dark:border-stone-800"><span className="text-xs font-bold text-stone-700 dark:text-amber-100">{ka ? 'ბოლო მოძრაობები' : 'Recent movements'}</span></div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                    {movements.slice(0, 30).map(m => (
                      <tr key={m.id} className="hover:bg-stone-50/50 dark:hover:bg-white/5">
                        <td className="p-2.5 font-mono text-stone-500">{m.date}</td>
                        <td className="p-2.5 text-stone-700 dark:text-amber-50">{lotName(m.lotId)}</td>
                        <td className="p-2.5 text-stone-500">{locations.find(l => l.id === m.locationId)?.name || '—'}</td>
                        <td className={`p-2.5 text-right font-mono font-bold ${m.direction === 'in' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}`}>{m.direction === 'in' ? '+' : '−'}{m.bottles}</td>
                        <td className="p-2.5 text-right"><button onClick={() => onUpdateMovements(movements.filter(x => x.id !== m.id))} className="text-stone-300 hover:text-rose-600 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
