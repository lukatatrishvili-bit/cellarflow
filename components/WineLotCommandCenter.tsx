import React from 'react';
import {
  BadgeDollarSign,
  Calculator,
  FlaskConical,
  GitMerge,
  MapPin,
  PackageCheck,
  Pencil,
  ShoppingCart,
  Warehouse,
  Wine,
  FileText,
} from 'lucide-react';
import type {
  BottlingRunRecord,
  LabAnalysis,
  SalesDispatchRecord,
  SalesOrderRecord,
  Vessel,
  WineLot,
  WinemakingStage,
} from '../lib/wineryState';
import type { CostEntry } from '../lib/costing';
import type { StockMovement } from '../lib/storage';
import { isActiveReservation } from '../lib/sales';
import { StatusBadge } from './ui/primitives';

interface Props {
  lot: WineLot;
  vessels: Vessel[];
  labLogs: LabAnalysis[];
  costEntries: CostEntry[];
  bottlingRuns: BottlingRunRecord[];
  stockMovements: StockMovement[];
  salesOrders: SalesOrderRecord[];
  salesDispatches: SalesDispatchRecord[];
  currency: string;
  onEdit: () => void;
  onOpenPassport?: (lotId: string) => void;
  setActiveTab?: (tab: string) => void;
  setSelectedTankId?: (tankId: string | null) => void;
  setCalculatorLotId?: (lotId: string) => void;
}

const stageOrder: WinemakingStage[] = [
  'crushing',
  'fermenting',
  'maceration',
  'pressing',
  'aging',
  'stabilization',
  'filtration',
  'bottled',
  'sold',
];

const stageLabels: Record<WinemakingStage, string> = {
  crushing: 'Crushing',
  fermenting: 'Fermenting',
  maceration: 'Maceration',
  pressing: 'Pressing',
  aging: 'Aging',
  stabilization: 'Stabilization',
  filtration: 'Filtration',
  bottled: 'Bottled',
  sold: 'Sold',
};

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function money(n: number, currency: string): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`;
}

function signedMovement(m: StockMovement): number {
  return m.direction === 'in' ? m.bottles : -m.bottles;
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white/75 p-3 shadow-2xs dark:border-stone-800 dark:bg-stone-950/40">
      <span className="block text-[9px] font-mono font-black uppercase tracking-widest text-stone-400">{label}</span>
      <strong className="mt-1 block text-lg font-serif font-black text-stone-900 dark:text-amber-100">{value}</strong>
      {hint && <span className="mt-0.5 block text-[10px] text-stone-400">{hint}</span>}
    </div>
  );
}

function ActionChip({
  icon: Icon,
  children,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[11px] font-bold text-stone-700 transition-colors hover:border-[#4e0e15]/30 hover:text-[#4e0e15] disabled:opacity-40 disabled:cursor-not-allowed dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:text-amber-100"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

export default function WineLotCommandCenter({
  lot,
  vessels,
  labLogs,
  costEntries,
  bottlingRuns,
  stockMovements,
  salesOrders,
  salesDispatches,
  currency,
  onEdit,
  onOpenPassport,
  setActiveTab,
  setSelectedTankId,
  setCalculatorLotId,
}: Props) {
  const containingVessels = vessels.filter(v => v.assignedLotId === lot.id);
  const latestLab = labLogs
    .filter(log => log.lotId === lot.id)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const bottled = bottlingRuns
    .filter(run => run.lotId === lot.id)
    .reduce((acc, run) => acc + (run.totalBottles || 0) + (run.totalCeramic || 0), 0);
  const stockOnHand = Math.max(0, stockMovements
    .filter(m => m.lotId === lot.id)
    .reduce((acc, m) => acc + signedMovement(m), 0));
  const reserved = salesOrders
    .filter(order => order.lotId === lot.id && isActiveReservation(order))
    .reduce((acc, order) => acc + (order.bottles || 0), 0);
  const dispatches = salesDispatches.filter(d => d.lotId === lot.id);
  const dispatched = dispatches.reduce((acc, d) => acc + (d.bottles || 0), 0);
  const revenue = dispatches.reduce((acc, d) => acc + (d.revenue || 0), 0);
  const totalCost = costEntries
    .filter(entry => entry.lotId === lot.id)
    .reduce((acc, entry) => acc + (entry.amount || 0), 0);
  const costPerBottle = bottled > 0 ? round2(totalCost / bottled) : null;
  const currentStageIndex = Math.max(0, stageOrder.indexOf(lot.stage));
  const progressPct = Math.round(((currentStageIndex + 1) / stageOrder.length) * 100);

  return (
    <section className="overflow-hidden rounded-3xl border border-[#e8dfd5] bg-gradient-to-br from-white via-[#fffdfa] to-[#f8f1ea] shadow-sm dark:border-stone-800 dark:from-stone-900 dark:via-stone-900 dark:to-stone-950">
      <div className="relative p-5 lg:p-6">
        <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-[#4e0e15] via-[#801323] to-[#c5a059]" />
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="brand">{lot.id}</StatusBadge>
              <StatusBadge tone={lot.stage === 'sold' ? 'success' : lot.stage === 'bottled' ? 'info' : 'neutral'}>
                {stageLabels[lot.stage] || lot.stage}
              </StatusBadge>
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-stone-400">
                Vintage {lot.vintage}
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-serif font-black leading-tight text-stone-950 dark:text-amber-100">
              {lot.name}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-stone-500 dark:text-stone-400">
              {lot.variety} from {lot.vineyardBlock || 'unassigned block'} · {lot.region || 'unknown region'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionChip icon={Pencil} onClick={onEdit}>Edit</ActionChip>
            <ActionChip icon={GitMerge} onClick={setActiveTab ? () => setActiveTab('lineage') : undefined}>Lineage</ActionChip>
            <ActionChip icon={FileText} onClick={onOpenPassport ? () => onOpenPassport(lot.id) : undefined}>Passport</ActionChip>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
          <MetricCard label="Current volume" value={`${lot.currentVolume.toLocaleString()} L`} hint={`${lot.initialVolume.toLocaleString()} L initial`} />
          <MetricCard label="Bottled" value={`${bottled.toLocaleString()} btl`} hint={bottled > 0 ? 'finished goods' : 'not bottled yet'} />
          <MetricCard label="Stock now" value={`${stockOnHand.toLocaleString()} btl`} hint={reserved > 0 ? `${reserved.toLocaleString()} reserved` : 'unreserved'} />
          <MetricCard label="Dispatched" value={`${dispatched.toLocaleString()} btl`} hint={revenue > 0 ? money(revenue, currency) : 'no sales yet'} />
          <MetricCard label="Lot cost" value={money(totalCost, currency)} hint={costPerBottle != null ? `${costPerBottle} ${currency}/btl` : 'cost/btl pending'} />
          <MetricCard label="Latest pH" value={latestLab ? String(latestLab.ph) : '—'} hint={latestLab ? latestLab.date : 'no lab yet'} />
          <MetricCard label="Free SO₂" value={latestLab ? `${latestLab.freeSo2} mg/L` : '—'} hint={latestLab && latestLab.freeSo2 < 15 ? 'needs review' : 'latest lab'} />
        </div>

        <div className="mt-5 rounded-2xl border border-stone-200 bg-white/55 p-3 dark:border-stone-800 dark:bg-stone-950/30">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[9px] font-mono font-black uppercase tracking-widest text-stone-400">Winemaking progress</span>
            <span className="text-[10px] font-mono font-bold text-stone-500">{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
            <div className="h-full rounded-full bg-gradient-to-r from-[#4e0e15] to-[#c5a059]" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {stageOrder.map((stage, index) => (
              <span
                key={stage}
                className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                  index <= currentStageIndex
                    ? 'bg-[#4e0e15] text-amber-50'
                    : 'bg-stone-100 text-stone-400 dark:bg-stone-800'
                }`}
              >
                {stageLabels[stage]}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-stone-200 bg-white/65 p-4 dark:border-stone-800 dark:bg-stone-950/30">
            <h3 className="flex items-center gap-1.5 text-xs font-black text-stone-700 dark:text-amber-100">
              <MapPin className="h-4 w-4 text-[#4e0e15]" /> Where it is now
            </h3>
            {containingVessels.length > 0 ? (
              <div className="mt-3 space-y-2">
                {containingVessels.slice(0, 3).map(vessel => (
                  <button
                    type="button"
                    key={vessel.id}
                    onClick={setSelectedTankId ? () => setSelectedTankId(vessel.id) : undefined}
                    className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-3 py-2 text-left transition-colors hover:border-[#4e0e15]/30 dark:border-stone-800 dark:bg-stone-900"
                  >
                    <span>
                      <strong className="block text-xs text-stone-900 dark:text-amber-100">{vessel.id}</strong>
                      <span className="text-[10px] text-stone-400">{vessel.type.replace(/_/g, ' ')} · {vessel.temperature}°C</span>
                    </span>
                    <span className="text-[10px] font-mono font-bold text-stone-500">{vessel.currentVolume.toLocaleString()} L</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-stone-400">No vessel currently assigned. If bottled, check finished-goods stock and storage.</p>
            )}
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white/65 p-4 dark:border-stone-800 dark:bg-stone-950/30">
            <h3 className="flex items-center gap-1.5 text-xs font-black text-stone-700 dark:text-amber-100">
              <Wine className="h-4 w-4 text-[#4e0e15]" /> Next useful actions
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionChip icon={FlaskConical} onClick={setActiveTab ? () => setActiveTab('labs') : undefined}>Lab</ActionChip>
              <ActionChip icon={Calculator} onClick={setActiveTab && setCalculatorLotId ? () => { setCalculatorLotId(lot.id); setActiveTab('calculators'); } : undefined}>Calculator</ActionChip>
              <ActionChip icon={PackageCheck} onClick={setActiveTab ? () => setActiveTab('bottling') : undefined}>Bottling</ActionChip>
              <ActionChip icon={Warehouse} onClick={setActiveTab ? () => setActiveTab('inventory') : undefined}>Materials</ActionChip>
              <ActionChip icon={ShoppingCart} onClick={setActiveTab ? () => setActiveTab('lineage') : undefined}>Trace sales</ActionChip>
              <ActionChip icon={BadgeDollarSign} onClick={setActiveTab ? () => setActiveTab('lineage') : undefined}>Trace value</ActionChip>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
