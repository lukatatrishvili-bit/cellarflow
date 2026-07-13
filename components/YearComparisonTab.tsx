import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BadgeDollarSign,
  Boxes,
  CalendarDays,
  Grape,
  Lightbulb,
  Scale,
  TrendingDown,
  TrendingUp,
  Wine,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type {
  BottlingRunRecord,
  GrapeIntakeRecord,
  HarvestRecord,
  SalesDispatchRecord,
  SalesOrderRecord,
  WineLot,
} from '../lib/wineryState';
import type { CostEntry } from '../lib/costing';
import type { StockMovement } from '../lib/storage';
import {
  availableComparisonYears,
  buildYearComparison,
  type ComparisonMetric,
  type YearBucket,
  type YearComparisonMode,
} from '../lib/analytics';
import { CountUp } from './motion';

interface Props {
  lang: Language;
  lots: WineLot[];
  harvests: HarvestRecord[];
  grapeIntakes: GrapeIntakeRecord[];
  bottlingRuns: BottlingRunRecord[];
  costEntries: CostEntry[];
  stockMovements: StockMovement[];
  dispatches: SalesDispatchRecord[];
  orders: SalesOrderRecord[];
  currency: string;
  onNavigate?: (target: { module: string; tab?: string }) => void;
}

const categoryLabels: Record<string, string> = {
  grape: 'Grapes',
  additive: 'Additives',
  packaging: 'Packaging',
  labor: 'Labor',
  bottling: 'Bottling',
  energy: 'Energy',
  overhead: 'Overhead',
  blend_in: 'Blend in',
  blend_out: 'Blend out',
  other: 'Other',
};

const coreMetricKeys = ['revenue', 'grossProfit', 'costPerBottle', 'grossMarginPct', 'finishedGoodsValue'];

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function metricTone(metric: ComparisonMetric): string {
  if (metric.delta == null || metric.delta === 0) return 'text-stone-400';
  const good = metric.higherIsBetter === false ? metric.delta < 0 : metric.delta > 0;
  return good ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
}

function formatValue(value: number | null, metric: Pick<ComparisonMetric, 'kind' | 'unit'>, currency: string): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (metric.kind === 'money') {
    return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
  if (metric.kind === 'percent') {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${metric.unit ? ` ${metric.unit}` : ''}`;
}

function deltaLabel(metric: ComparisonMetric, currency: string): string {
  if (metric.delta == null) return 'new / n.a.';
  const sign = metric.delta > 0 ? '+' : '';
  const value = formatValue(metric.delta, metric, currency);
  const pct = metric.deltaPct == null ? '' : ` (${metric.deltaPct > 0 ? '+' : ''}${metric.deltaPct}%)`;
  return `${sign}${value}${pct}`;
}

function MiniBar({ current, previous }: { current: number; previous: number }) {
  const max = Math.max(Math.abs(current), Math.abs(previous), 1);
  const currentPct = Math.min(100, Math.round((Math.abs(current) / max) * 100));
  const previousPct = Math.min(100, Math.round((Math.abs(previous) / max) * 100));
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden dark:bg-stone-800">
        <div className="h-full bg-[#4e0e15] dark:bg-amber-400" style={{ width: `${currentPct}%` }} />
      </div>
      <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden dark:bg-stone-800">
        <div className="h-full bg-stone-300 dark:bg-stone-600" style={{ width: `${previousPct}%` }} />
      </div>
    </div>
  );
}

export default function YearComparisonTab({
  lang,
  lots,
  harvests,
  grapeIntakes,
  bottlingRuns,
  costEntries,
  stockMovements,
  dispatches,
  orders,
  currency,
  onNavigate,
}: Props) {
  const ka = lang === 'ka';
  const nowYear = new Date().getFullYear();
  const input = useMemo(() => ({
    lots,
    harvests,
    grapeIntakes,
    bottlingRuns,
    costEntries,
    stockMovements,
    salesDispatches: dispatches,
    salesOrders: orders,
  }), [bottlingRuns, costEntries, dispatches, grapeIntakes, harvests, lots, orders, stockMovements]);

  const availableYears = useMemo(() => availableComparisonYears(input), [input]);
  const [mode, setMode] = useState<YearComparisonMode>('vintage');
  const [currentYear, setCurrentYear] = useState(availableYears[0] || nowYear);
  const [previousYear, setPreviousYear] = useState((availableYears[0] || nowYear) - 1);

  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(currentYear)) {
      setCurrentYear(availableYears[0]);
      setPreviousYear(availableYears[0] - 1);
    }
  }, [availableYears, currentYear]);

  const yearOptions = useMemo(() => {
    const set = new Set([...availableYears, currentYear, previousYear, nowYear, nowYear - 1]);
    return Array.from(set).filter(Number.isFinite).sort((a, b) => b - a);
  }, [availableYears, currentYear, nowYear, previousYear]);

  const comparison = useMemo(() => buildYearComparison(input, {
    mode,
    currentYear,
    previousYear,
  }), [currentYear, input, mode, previousYear]);

  const cards = comparison.metrics.filter(m => coreMetricKeys.includes(m.key));
  const costCategories = Array.from(new Set([
    ...Object.keys(comparison.current.costsByCategory),
    ...Object.keys(comparison.previous.costsByCategory),
  ]));
  const hasAnyData = availableYears.length > 0
    || comparison.current.lotCount > 0
    || comparison.current.revenue > 0
    || comparison.current.costTotal > 0;

  const stat = (bucket: YearBucket) => [
    { label: 'Lots', value: bucket.lotCount, unit: '' },
    { label: 'Harvest', value: bucket.harvestKg, unit: 'kg' },
    { label: 'Bottled', value: bucket.bottledBottles, unit: 'btl' },
    { label: 'Dispatched', value: bucket.dispatchedBottles, unit: 'btl' },
    { label: 'Reserved', value: bucket.reservedBottles, unit: 'btl' },
  ];

  return (
    <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-6 flex flex-col space-y-5 font-sans animate-fade-in">
      <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <span className="text-[9px] uppercase tracking-widest bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded font-bold">
              {ka ? 'Analytics' : 'Analytics'}
            </span>
            <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
              <BarChart3 className="w-5 h-5 text-[#4e0e15]" />
              Year Comparison
            </h3>
            <p className="text-xs text-stone-400 font-semibold mt-0.5 max-w-3xl">
              Compare one vintage or business year against another using only your real harvest, cellar, storage, cost, reservation, and dispatch records.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest">Mode</label>
              <div className="flex bg-stone-100 rounded-xl p-1 dark:bg-stone-950">
                {([
                  ['vintage', 'Vintage'],
                  ['calendar', 'Calendar'],
                ] as Array<[YearComparisonMode, string]>).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setMode(id)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide cursor-pointer ${mode === id ? 'bg-[#4e0e15] text-amber-50' : 'text-stone-500 hover:text-stone-900 dark:hover:text-amber-100'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest">Current</label>
              <select
                value={currentYear}
                onChange={e => {
                  const y = Number(e.target.value);
                  setCurrentYear(y);
                  setPreviousYear(y - 1);
                }}
                className="bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs font-bold dark:bg-stone-950 dark:border-stone-800 dark:text-amber-50"
              >
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest">Compare to</label>
              <select
                value={previousYear}
                onChange={e => setPreviousYear(Number(e.target.value))}
                className="bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs font-bold dark:bg-stone-950 dark:border-stone-800 dark:text-amber-50"
              >
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {!hasAnyData && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/60 dark:text-amber-100">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <p>{ka ? 'შესადარებელი წარმოების მონაცემები ჯერ არ არის. დაამატეთ რთველის/მიღების, ჩამოსხმის, საწყობის, ხარჯების, ჯავშნის ან გატანის ჩანაწერები და ეს ანგარიში ავტომატურად შეივსება.' : 'No comparable production data yet. Add real harvest/intake, bottling, storage, cost, reservation, or dispatch records and this report will populate automatically.'}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate?.({ module: 'gvino', tab: 'intake' })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-stone-950 dark:ring-amber-900"
              >
                <Grape className="w-3.5 h-3.5" /> Intake
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.({ module: 'gvino', tab: 'bottling' })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-stone-950 dark:ring-amber-900"
              >
                <Boxes className="w-3.5 h-3.5" /> Bottling
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.({ module: 'costs' })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#4e0e15] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-50 hover:bg-[#34070a]"
              >
                <BadgeDollarSign className="w-3.5 h-3.5" /> Costs
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[comparison.current, comparison.previous].map(bucket => (
          <div key={`${bucket.mode}-${bucket.year}`} className="bg-white border border-[#e8dfd5] rounded-2xl p-4 dark:bg-stone-900 dark:border-stone-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-[9px] uppercase font-mono text-stone-400 font-bold tracking-widest">{bucket.mode === 'vintage' ? 'Vintage' : 'Calendar year'}</span>
                <h4 className="text-2xl font-serif font-black text-stone-900 dark:text-amber-100">{bucket.year}</h4>
              </div>
              <CalendarDays className="w-7 h-7 text-stone-300" />
            </div>
            <div className="grid grid-cols-5 gap-2">
              {stat(bucket).map(item => (
                <div key={item.label} className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/50">
                  <span className="text-[9px] uppercase font-mono text-stone-400 font-bold">{item.label}</span>
                  <strong className="block text-lg font-serif font-black text-stone-900 dark:text-amber-100">
                    <CountUp value={item.value} format={n => n.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
                  </strong>
                  {item.unit && <span className="text-[9px] text-stone-400">{item.unit}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {cards.map(metric => {
          const up = (metric.delta || 0) >= 0;
          const Icon = metric.key === 'revenue' ? BadgeDollarSign
            : metric.key === 'costPerBottle' ? Scale
              : metric.key === 'finishedGoodsValue' ? Boxes
                : up ? TrendingUp : TrendingDown;
          return (
            <div key={metric.key} className="bg-white border border-[#e8dfd5] rounded-2xl p-4 dark:bg-stone-900 dark:border-stone-800">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase font-mono text-stone-400 font-bold tracking-widest">{metric.label}</span>
                <Icon className={`w-4 h-4 ${metricTone(metric)}`} />
              </div>
              <strong className="block mt-1 text-xl font-serif font-black text-stone-900 dark:text-amber-100">
                {formatValue(metric.current, metric, currency)}
              </strong>
              <span className={`text-[10px] font-mono font-bold ${metricTone(metric)}`}>{deltaLabel(metric, currency)}</span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-5">
        <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
          <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
            <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
              <BarChart3 className="w-4 h-4" /> Metric comparison
            </span>
            <span className="text-[9px] font-mono text-stone-400">{comparison.currentYear} vs {comparison.previousYear}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-400 font-bold dark:bg-stone-950">
                  <th className="p-2.5">Metric</th>
                  <th className="p-2.5 text-right">{comparison.previousYear}</th>
                  <th className="p-2.5 text-right">{comparison.currentYear}</th>
                  <th className="p-2.5 text-right">Change</th>
                  <th className="p-2.5 w-36">Scale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                {comparison.metrics.map(metric => (
                  <tr key={metric.key} className="hover:bg-stone-50/50 dark:hover:bg-white/5">
                    <td className="p-2.5 font-bold text-stone-800 dark:text-amber-50">{metric.label}</td>
                    <td className="p-2.5 text-right font-mono text-stone-500">{formatValue(metric.previous, metric, currency)}</td>
                    <td className="p-2.5 text-right font-mono text-stone-900 dark:text-amber-100">{formatValue(metric.current, metric, currency)}</td>
                    <td className={`p-2.5 text-right font-mono font-bold ${metricTone(metric)}`}>{deltaLabel(metric, currency)}</td>
                    <td className="p-2.5"><MiniBar current={metric.current || 0} previous={metric.previous || 0} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-[#e8dfd5] rounded-2xl p-4 dark:bg-stone-900 dark:border-stone-800">
            <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
              <Lightbulb className="w-4 h-4" /> Auto insights
            </span>
            <div className="mt-3 space-y-2">
              {comparison.insights.map((insight, idx) => (
                <div key={idx} className="text-[12px] leading-relaxed bg-stone-50 border border-stone-100 rounded-xl p-3 text-stone-600 dark:bg-stone-950/50 dark:border-stone-800 dark:text-stone-300">
                  {insight}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-[#e8dfd5] rounded-2xl p-4 dark:bg-stone-900 dark:border-stone-800">
            <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
              <Scale className="w-4 h-4" /> Cost breakdown
            </span>
            {costCategories.length === 0 ? (
              <div className="text-center py-8 text-stone-400 text-xs font-semibold">
                <Scale className="w-9 h-9 mx-auto mb-2 opacity-40" />
                <p>{ka ? 'ამ წლების ხარჯების ჩანაწერები ჯერ არ არის' : 'No cost entries for these years yet'}</p>
                <button
                  type="button"
                  onClick={() => onNavigate?.({ module: 'costs' })}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#4e0e15] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-50 hover:bg-[#34070a]"
                >
                  <BadgeDollarSign className="w-3.5 h-3.5" /> Open costs
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {costCategories.map(category => {
                  const current = comparison.current.costsByCategory[category as keyof typeof comparison.current.costsByCategory] || 0;
                  const previous = comparison.previous.costsByCategory[category as keyof typeof comparison.previous.costsByCategory] || 0;
                  const delta = round2(current - previous);
                  return (
                    <div key={category} className="grid grid-cols-[1fr_auto] gap-3 items-center text-[11px]">
                      <div>
                        <div className="flex justify-between gap-3">
                          <span className="font-bold text-stone-700 dark:text-stone-200">{categoryLabels[category] || category}</span>
                          <span className={delta <= 0 ? 'text-emerald-700' : 'text-rose-600'}>{delta >= 0 ? '+' : ''}{delta.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        </div>
                        <MiniBar current={current} previous={previous} />
                      </div>
                      <span className="font-mono text-stone-500 w-24 text-right">{current.toLocaleString(undefined, { maximumFractionDigits: 0 })} {currency}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
        <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
          <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
            <Wine className="w-4 h-4" /> Wine performance in {comparison.currentYear}
          </span>
          <span className="text-[9px] font-mono text-stone-400">{comparison.current.wines.length} lots</span>
        </div>
        {comparison.current.wines.length === 0 ? (
          <div className="text-center py-12 text-stone-400 text-xs font-semibold">
            <Wine className="w-9 h-9 mx-auto mb-2 opacity-40" />
            <p>{ka ? 'ამ საშედარებელ წელს ღვინის პარტიები ჯერ არ ემთხვევა' : 'No wine lots match this comparison year yet'}</p>
            <button
              type="button"
              onClick={() => onNavigate?.({ module: 'gvino', tab: 'lots' })}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#4e0e15] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-50 hover:bg-[#34070a]"
            >
              <Wine className="w-3.5 h-3.5" /> Open wine lots
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-400 font-bold dark:bg-stone-950">
                  <th className="p-2.5">Wine</th>
                  <th className="p-2.5 text-right">Bottled</th>
                  <th className="p-2.5 text-right">Stock now</th>
                  <th className="p-2.5 text-right">Reserved</th>
                  <th className="p-2.5 text-right">Dispatched</th>
                  <th className="p-2.5 text-right">Revenue</th>
                  <th className="p-2.5 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                {comparison.current.wines.map(wine => (
                  <tr key={wine.lotId} className="hover:bg-stone-50/50 dark:hover:bg-white/5">
                    <td className="p-2.5">
                      <span className="font-bold text-stone-800 dark:text-amber-50">{wine.lotName}</span>
                      <span className="block text-[9px] font-mono text-stone-400">{wine.lotId} · {wine.vintage}</span>
                    </td>
                    <td className="p-2.5 text-right font-mono">{wine.bottledBottles.toLocaleString()}</td>
                    <td className="p-2.5 text-right font-mono">{wine.stockOnHandBottles.toLocaleString()}</td>
                    <td className="p-2.5 text-right font-mono text-blue-700">{wine.reservedBottles.toLocaleString()}</td>
                    <td className="p-2.5 text-right font-mono">{wine.dispatchedBottles.toLocaleString()}</td>
                    <td className="p-2.5 text-right font-mono text-emerald-700">{formatValue(wine.revenue, { kind: 'money' }, currency)}</td>
                    <td className="p-2.5 text-right font-mono">{wine.marginPct != null ? `${wine.marginPct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 text-[11px] text-stone-400 leading-relaxed">
        <Grape className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          Vintage mode groups records by wine-lot vintage, even if bottling or sales happened later. Calendar mode groups transactional records by their document dates. Finished-goods stock is the current on-hand stock for lots in the selected year.
        </p>
      </div>
    </main>
  );
}
