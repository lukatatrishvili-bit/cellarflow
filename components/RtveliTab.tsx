import React, { useMemo, useState } from 'react';
import {
  Tractor, Grape, Scale, Banknote, Printer, Plus, X, CheckCircle2,
  Container, AlertTriangle, Trash2, Droplets,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type {
  GrapeIntakeRecord, SupplierPayment, SupplierPaymentMethod, Vessel, CompanyProfile,
} from '../lib/wineryState';
import {
  computeSupplierLedger, computeSeasonStats, computeCapacityPlan, seasonYears,
  type SupplierLedgerRow,
} from '../lib/rtveli';

interface Props {
  lang: Language;
  intakes: GrapeIntakeRecord[];
  payments: SupplierPayment[];
  vessels: Vessel[];
  company: CompanyProfile;
  currentUserName: string;
  onAddPayment: (input: Omit<SupplierPayment, 'id' | 'operator'> & { operator?: string }) => string;
  onDeletePayment: (id: string) => void;
  setActiveTab?: (tab: string) => void;
  setToastMessage?: (m: string) => void;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const fmtMoney = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function RtveliTab({
  lang, intakes, payments, vessels, company, currentUserName,
  onAddPayment, onDeletePayment, setActiveTab, setToastMessage,
}: Props) {
  const ka = lang === 'ka';
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => seasonYears(intakes), [intakes]);
  const [season, setSeason] = useState<number>(years[0] || currentYear);
  const currency = company.currency || 'GEL';

  const stats = useMemo(() => computeSeasonStats(intakes, season), [intakes, season]);
  const ledger = useMemo(() => computeSupplierLedger(intakes, payments, season), [intakes, payments, season]);
  const capacity = useMemo(() => computeCapacityPlan(vessels), [vessels]);

  const totalOutstanding = useMemo(
    () => Math.round(ledger.reduce((acc, r) => acc + Math.max(0, r.balance), 0) * 100) / 100,
    [ledger],
  );

  // Payment modal
  const [payingSupplier, setPayingSupplier] = useState<SupplierLedgerRow | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState<SupplierPaymentMethod>('bank');
  const [payNote, setPayNote] = useState('');
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);

  const payNum = parseFloat(payAmount) || 0;

  const submitPayment = () => {
    if (!payingSupplier || payNum <= 0) return;
    onAddPayment({
      date: payDate,
      supplierName: payingSupplier.supplierName,
      amount: payNum,
      currency,
      method: payMethod,
      note: payNote.trim() || undefined,
      operator: currentUserName,
    });
    setToastMessage?.(ka
      ? `გადახდა აღირიცხა: ${fmtMoney(payNum)} ${currency} — ${payingSupplier.supplierName}`
      : `Payment recorded: ${fmtMoney(payNum)} ${currency} — ${payingSupplier.supplierName}`);
    setPayingSupplier(null);
    setPayAmount(''); setPayNote('');
  };

  /** Printable bilingual settlement statement for one supplier. */
  const printStatement = (row: SupplierLedgerRow) => {
    const supplierIntakes = intakes.filter(i =>
      i.source === 'supplier' && (i.supplierName || '').trim() === row.supplierName && (i.date || '').startsWith(String(season)));
    const supplierPays = payments.filter(p =>
      (p.supplierName || '').trim() === row.supplierName && (p.date || '').startsWith(String(season)));
    const wineryName = company.wineryName || company.companyName || 'VinOS';

    const deliveryRows = supplierIntakes
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map(i => {
        const cost = (typeof i.totalCost === 'number' && i.totalCost > 0)
          ? i.totalCost
          : (i.costPerKg && i.costPerKg > 0 ? i.costPerKg * i.netWeightKg : 0);
        return `<tr><td>${i.date}</td><td>${i.variety}</td><td class="r">${fmt(i.netWeightKg)}</td><td class="r">${i.costPerKg ? fmtMoney(i.costPerKg) : '—'}</td><td class="r">${cost > 0 ? fmtMoney(cost) : '—'}</td></tr>`;
      }).join('');
    const paymentRows = supplierPays
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map(p => `<tr><td>${p.date}</td><td>${p.method}</td><td>${p.note || ''}</td><td class="r">${fmtMoney(p.amount)}</td></tr>`)
      .join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${row.supplierName} — ${season}</title>
<style>
  body{font-family:Georgia,serif;color:#2c221e;margin:40px;font-size:13px}
  h1{font-size:20px;color:#4e0e15;margin:0} h2{font-size:13px;margin:24px 0 6px;color:#4e0e15}
  .muted{color:#8c7f7e;font-size:11px} table{width:100%;border-collapse:collapse;margin-top:4px}
  th,td{border:1px solid #d9cdc2;padding:5px 8px;text-align:left} th{background:#f6f1eb;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
  td.r,th.r{text-align:right} .total{font-weight:bold;background:#faf6f1}
  .sig{margin-top:48px;display:flex;gap:60px} .sig div{flex:1;border-top:1px solid #2c221e;padding-top:4px;font-size:11px}
</style></head><body>
  <h1>${wineryName}</h1>
  <div class="muted">${ka ? 'მომწოდებელთან ანგარიშსწორების ამონაწერი' : 'Grape supplier settlement statement'} · ${ka ? 'რთველი' : 'Rtveli'} ${season} · ${new Date().toISOString().slice(0, 10)}</div>
  <h2>${ka ? 'მომწოდებელი' : 'Supplier'}: ${row.supplierName}</h2>
  <h2>${ka ? 'მიღებული ყურძენი' : 'Grapes received'}</h2>
  <table><tr><th>${ka ? 'თარიღი' : 'Date'}</th><th>${ka ? 'ჯიში' : 'Variety'}</th><th class="r">${ka ? 'ნეტო კგ' : 'Net kg'}</th><th class="r">${ka ? 'ფასი/კგ' : 'Price/kg'}</th><th class="r">${ka ? 'ღირებულება' : 'Value'} (${currency})</th></tr>
  ${deliveryRows || `<tr><td colspan="5">${ka ? 'ჩანაწერები არ არის' : 'No deliveries'}</td></tr>`}
  <tr class="total"><td colspan="2">${ka ? 'სულ' : 'Total'}</td><td class="r">${fmt(row.totalKg)}</td><td></td><td class="r">${fmtMoney(row.totalOwed)}</td></tr></table>
  ${row.unpricedKg > 0 ? `<div class="muted" style="margin-top:4px">⚠ ${fmt(row.unpricedKg)} ${ka ? 'კგ მიღებულია ფასის გარეშე — არ შედის ღირებულებაში' : 'kg received without a price — not included in the value'}</div>` : ''}
  <h2>${ka ? 'გადახდები' : 'Payments'}</h2>
  <table><tr><th>${ka ? 'თარიღი' : 'Date'}</th><th>${ka ? 'მეთოდი' : 'Method'}</th><th>${ka ? 'შენიშვნა' : 'Note'}</th><th class="r">${ka ? 'თანხა' : 'Amount'} (${currency})</th></tr>
  ${paymentRows || `<tr><td colspan="4">${ka ? 'გადახდები არ არის' : 'No payments'}</td></tr>`}
  <tr class="total"><td colspan="3">${ka ? 'სულ გადახდილი' : 'Total paid'}</td><td class="r">${fmtMoney(row.totalPaid)}</td></tr>
  <tr class="total"><td colspan="3">${ka ? 'დარჩენილი ბალანსი' : 'Outstanding balance'}</td><td class="r">${fmtMoney(row.balance)}</td></tr></table>
  <div class="sig"><div>${ka ? 'მარნის წარმომადგენელი' : 'Winery representative'}</div><div>${ka ? 'მომწოდებელი' : 'Supplier'}</div></div>
  <script>window.print()</script></body></html>`;

    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { setToastMessage?.(ka ? '⚠️ ბრაუზერმა დაბლოკა ფანჯარა' : '⚠️ Pop-up blocked by the browser'); return; }
    w.document.write(html);
    w.document.close();
  };

  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800';

  return (
    <div className="space-y-4 animate-fade-in text-stone-800">
      {/* Header */}
      <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm flex flex-wrap items-start justify-between gap-4 dark:bg-stone-900 dark:border-stone-800">
        <div>
          <span className="text-[9px] uppercase tracking-widest bg-[#4e0e15]/10 text-[#4e0e15] px-2.5 py-0.5 rounded font-bold">
            {ka ? 'მარანი · რთველი' : 'Cellar · Harvest'}
          </span>
          <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
            <Tractor className="w-5 h-5 text-[#4e0e15]" />
            {ka ? 'რთველის შტაბი' : 'Rtveli Command Center'}
          </h3>
          <p className="text-xs text-stone-400 font-semibold mt-0.5">
            {ka
              ? 'მიღებები, თავისუფალი ტევადობა და მომწოდებლებთან ანგარიშსწორება — ერთ ეკრანზე.'
              : 'Deliveries, free capacity and grape-supplier settlements — one screen for the season.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {years.length > 1 && (
            <select value={season} onChange={e => setSeason(parseInt(e.target.value))} className={inputCls + ' w-auto'}>
              {years.map(y => <option key={y} value={y}>{ka ? `რთველი ${y}` : `Rtveli ${y}`}</option>)}
            </select>
          )}
          <button
            onClick={() => setActiveTab?.('intake')}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#4e0e15] hover:bg-[#34070a] text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors"
          >
            <Plus className="w-4 h-4" /> {ka ? 'ახალი მიღება' : 'New intake'}
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            icon: Scale, label: ka ? 'სეზონის მოსავალი' : 'Season received',
            value: stats.totalKg >= 1000 ? `${fmt(stats.totalKg / 1000)} t` : `${fmt(stats.totalKg)} kg`,
            sub: `${stats.deliveries} ${ka ? 'მიღება' : 'deliveries'} · ${ka ? 'ნასყიდი' : 'purchased'} ${fmt(stats.supplierKg)} kg`,
          },
          {
            icon: Grape, label: ka ? 'დღეს' : 'Today',
            value: `${fmt(stats.todayKg)} kg`,
            sub: `${stats.todayDeliveries} ${ka ? 'მიღება დღეს' : 'deliveries today'}`,
          },
          {
            icon: Droplets, label: ka ? 'შაქრიანობა (საშ.)' : 'Weighted Brix',
            value: stats.weightedAvgBrix != null ? `${stats.weightedAvgBrix}°Bx` : '—',
            sub: ka ? 'კგ-შეწონილი საშუალო' : 'kg-weighted average',
          },
          {
            icon: Container, label: ka ? 'თავისუფალი ტევადობა' : 'Free capacity',
            value: `${fmt(capacity.freeL)} L`,
            sub: `${capacity.freeVessels.length} ${ka ? 'ჭურჭელი ღიაა' : 'vessels with room'}`,
          },
        ].map((kpi, i) => (
          <div key={i} className="bg-white border border-[#e8dfd5] p-4 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
            <span className={labelCls}><kpi.icon className="w-3.5 h-3.5 inline mr-1 text-[#c5a059]" />{kpi.label}</span>
            <span className="text-2xl font-serif font-black text-stone-900 dark:text-amber-100">{kpi.value}</span>
            <span className="block text-[10px] text-stone-400 font-semibold mt-0.5">{kpi.sub}</span>
          </div>
        ))}
      </div>

      {stats.deliveries === 0 ? (
        <div className="bg-white border border-[#e8dfd5] rounded-2xl p-12 text-center dark:bg-stone-900 dark:border-stone-800">
          <Tractor className="w-12 h-12 mx-auto text-stone-200 mb-3" />
          <p className="text-sm font-bold text-stone-500">
            {ka ? `რთველი ${season} ჯერ არ დაწყებულა` : `Rtveli ${season} has not started yet`}
          </p>
          <p className="text-xs text-stone-400 mt-1 mb-4">
            {ka ? 'პირველი მიღება ავტომატურად შექმნის სეზონის სტატისტიკას და ანგარიშსწორებას.' : 'The first intake starts the season stats and supplier ledger automatically.'}
          </p>
          <button onClick={() => setActiveTab?.('intake')}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#4e0e15] text-amber-50 rounded-xl text-xs font-bold uppercase cursor-pointer">
            <Plus className="w-4 h-4" /> {ka ? 'ყურძნის მიღება' : 'Receive grapes'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4 items-start">
          {/* ── Supplier settlements ─────────────────────── */}
          <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
            <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
              <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
                <Banknote className="w-4 h-4" /> {ka ? 'ანგარიშსწორება მომწოდებლებთან' : 'Supplier settlements'}
              </span>
              {totalOutstanding > 0 && (
                <span className="text-[10px] font-mono font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded dark:bg-rose-950/40">
                  {ka ? 'გადასახდელი' : 'outstanding'}: {fmtMoney(totalOutstanding)} {currency}
                </span>
              )}
            </div>
            {ledger.length === 0 ? (
              <div className="p-8 text-center text-xs text-stone-400 font-semibold">
                {ka
                  ? 'ამ სეზონზე ნასყიდი ყურძენი არ არის — ანგარიშსწორება ცარიელია.'
                  : 'No purchased fruit this season — the settlement ledger is empty.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-400 font-bold dark:bg-stone-950">
                      <th className="p-2.5">{ka ? 'მომწოდებელი' : 'Supplier'}</th>
                      <th className="p-2.5 text-right">{ka ? 'კგ' : 'Kg'}</th>
                      <th className="p-2.5 text-right">{ka ? 'ღირებულება' : 'Owed'}</th>
                      <th className="p-2.5 text-right">{ka ? 'გადახდილი' : 'Paid'}</th>
                      <th className="p-2.5 text-right">{ka ? 'ბალანსი' : 'Balance'}</th>
                      <th className="p-2.5 text-right">{ka ? 'ქმედება' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                    {ledger.map(row => (
                      <React.Fragment key={row.supplierName}>
                        <tr className="hover:bg-stone-50/50 dark:hover:bg-white/5 cursor-pointer"
                          onClick={() => setExpandedSupplier(expandedSupplier === row.supplierName ? null : row.supplierName)}>
                          <td className="p-2.5">
                            <span className="font-bold text-stone-800 dark:text-amber-50">{row.supplierName}</span>
                            <span className="block text-[9px] font-mono text-stone-400">
                              {row.deliveries} {ka ? 'მიღება' : 'deliveries'} · {row.varieties.join(', ')}
                              {row.unpricedKg > 0 && (
                                <span className="text-amber-600"> · ⚠ {fmt(row.unpricedKg)} kg {ka ? 'უფასოდ აღრიცხული' : 'unpriced'}</span>
                              )}
                            </span>
                          </td>
                          <td className="p-2.5 text-right font-bold whitespace-nowrap">{fmt(row.totalKg)}</td>
                          <td className="p-2.5 text-right font-mono whitespace-nowrap">{fmtMoney(row.totalOwed)}</td>
                          <td className="p-2.5 text-right font-mono text-emerald-700 whitespace-nowrap">{fmtMoney(row.totalPaid)}</td>
                          <td className={`p-2.5 text-right font-mono font-bold whitespace-nowrap ${
                            row.balance > 0 ? 'text-rose-700' : row.balance < 0 ? 'text-amber-600' : 'text-emerald-700'
                          }`}>
                            {fmtMoney(row.balance)}
                          </td>
                          <td className="p-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            <button onClick={() => { setPayingSupplier(row); setPayAmount(row.balance > 0 ? String(row.balance) : ''); }}
                              title={ka ? 'გადახდის აღრიცხვა' : 'Record payment'}
                              className="p-1.5 text-stone-400 hover:text-emerald-700 cursor-pointer transition-colors">
                              <Banknote className="w-4 h-4" />
                            </button>
                            <button onClick={() => printStatement(row)}
                              title={ka ? 'ამონაწერის ბეჭდვა' : 'Print statement'}
                              className="p-1.5 text-stone-400 hover:text-[#4e0e15] cursor-pointer transition-colors">
                              <Printer className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                        {expandedSupplier === row.supplierName && (
                          <tr>
                            <td colSpan={6} className="bg-stone-50/60 px-4 py-3 dark:bg-stone-950/40">
                              <span className={labelCls}>{ka ? 'გადახდების ისტორია' : 'Payment history'}</span>
                              {payments.filter(p => (p.supplierName || '').trim() === row.supplierName && (p.date || '').startsWith(String(season))).length === 0 ? (
                                <span className="text-[11px] text-stone-400">{ka ? 'გადახდები ჯერ არ არის' : 'No payments yet'}</span>
                              ) : (
                                <ul className="space-y-1">
                                  {payments
                                    .filter(p => (p.supplierName || '').trim() === row.supplierName && (p.date || '').startsWith(String(season)))
                                    .map(p => (
                                      <li key={p.id} className="flex items-center gap-3 text-[11px]">
                                        <span className="font-mono text-stone-500">{p.date}</span>
                                        <span className="font-bold text-emerald-700">{fmtMoney(p.amount)} {p.currency}</span>
                                        <span className="text-stone-400">{p.method}{p.note ? ` · ${p.note}` : ''}</span>
                                        <button onClick={() => onDeletePayment(p.id)} title={ka ? 'წაშლა' : 'Delete'}
                                          className="text-stone-300 hover:text-rose-600 cursor-pointer">
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </li>
                                    ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Right column: capacity + varieties ────────── */}
          <div className="space-y-4">
            <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
              <div className="px-4 py-3 border-b border-[#e8dfd5] dark:border-stone-800">
                <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
                  <Container className="w-4 h-4" /> {ka ? 'სად არის ადგილი ამაღამ?' : 'Where is there room tonight?'}
                </span>
              </div>
              {capacity.freeVessels.length === 0 ? (
                <div className="p-6 text-center text-xs text-stone-400 font-semibold flex items-center justify-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  {ka ? 'თავისუფალი ჭურჭელი არ არის!' : 'No free vessel capacity!'}
                </div>
              ) : (
                <ul className="divide-y divide-stone-50 max-h-72 overflow-y-auto dark:divide-stone-800">
                  {capacity.freeVessels.slice(0, 12).map(v => (
                    <li key={v.id} className="px-4 py-2 flex items-center justify-between text-[11px]">
                      <span className="font-bold text-stone-700 dark:text-amber-50">
                        {v.id}
                        <span className="ml-1.5 text-[9px] font-mono text-stone-400">{v.type}{v.empty ? (ka ? ' · ცარიელი' : ' · empty') : ''}</span>
                      </span>
                      <span className="font-mono font-bold text-[#4e0e15] dark:text-amber-300">{fmt(v.freeL)} L</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
              <div className="px-4 py-3 border-b border-[#e8dfd5] dark:border-stone-800">
                <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
                  <Grape className="w-4 h-4" /> {ka ? 'ჯიშების მიხედვით' : 'By variety'}
                </span>
              </div>
              <ul className="divide-y divide-stone-50 dark:divide-stone-800">
                {stats.byVariety.map(v => (
                  <li key={v.variety} className="px-4 py-2 flex items-center justify-between text-[11px]">
                    <span className="font-bold text-stone-700 dark:text-amber-50">{v.variety}</span>
                    <span className="font-mono text-stone-500">
                      {fmt(v.kg)} kg{v.weightedBrix != null ? ` · ${v.weightedBrix}°Bx` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment modal ─────────────────────────────── */}
      {payingSupplier && (
        <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPayingSupplier(null)}>
          <div className="bg-white rounded-2xl border border-[#e8dfd5] shadow-2xl w-full max-w-sm p-5 space-y-4 dark:bg-stone-900 dark:border-stone-800"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-serif font-black text-stone-900 dark:text-amber-100">
                  {ka ? 'გადახდის აღრიცხვა' : 'Record payment'}
                </h4>
                <p className="text-[11px] text-stone-400 font-semibold">
                  {payingSupplier.supplierName} · {ka ? 'ბალანსი' : 'balance'} {fmtMoney(payingSupplier.balance)} {currency}
                </p>
              </div>
              <button onClick={() => setPayingSupplier(null)} className="p-1 text-stone-300 hover:text-stone-500 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>{ka ? 'თანხა' : 'Amount'} ({currency})</label>
                <input type="number" min={0} step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} className={inputCls} autoFocus />
              </div>
              <div>
                <label className={labelCls}>{ka ? 'თარიღი' : 'Date'}</label>
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{ka ? 'მეთოდი' : 'Method'}</label>
              <div className="grid grid-cols-3 gap-1.5">
                {([['bank', ka ? 'გადარიცხვა' : 'Bank'], ['cash', ka ? 'ნაღდი' : 'Cash'], ['other', ka ? 'სხვა' : 'Other']] as const).map(([m, label]) => (
                  <button key={m} type="button" onClick={() => setPayMethod(m)}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer transition-colors ${
                      payMethod === m ? 'bg-[#4e0e15] text-amber-50 border-[#4e0e15]' : 'bg-stone-50 text-stone-500 border-stone-200 dark:bg-stone-950 dark:border-stone-800'
                    }`}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>{ka ? 'შენიშვნა' : 'Note'}</label>
              <input type="text" value={payNote} onChange={e => setPayNote(e.target.value)}
                placeholder={ka ? 'არასავალდებულო' : 'optional'} className={inputCls} />
            </div>
            <button onClick={submitPayment} disabled={payNum <= 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 disabled:cursor-not-allowed text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors">
              <CheckCircle2 className="w-4 h-4" /> {ka ? 'გადახდის აღრიცხვა' : 'Record payment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
