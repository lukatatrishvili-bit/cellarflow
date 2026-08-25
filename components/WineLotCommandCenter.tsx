import React from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  Activity,
  Calculator,
  CircleAlert,
  CircleCheck,
  FlaskConical,
  GitMerge,
  LockKeyhole,
  MapPin,
  PackageCheck,
  Pencil,
  Wrench,
  Wine,
  FileText,
} from 'lucide-react';
import type {
  BottlingRunRecord,
  CellarOperationType,
  LabAnalysis,
  SalesDispatchRecord,
  SalesOrderRecord,
  Vessel,
  WineLot,
  WinemakingStage,
} from '../lib/wineryState';
import type { CostEntry } from '../lib/costing';
import type { StockMovement } from '../lib/storage';
import type { Language } from '../lib/i18n';
import { stageLabel as sharedStageLabel, vesselTypeLabel } from '../lib/enumLabels';
import {
  stagesForCurrentLot,
  winemakingWorkflowLabel,
} from '../lib/winemakingWorkflow';
import {
  lotNextActionStatusLabel,
  type LotNextAction,
} from '../lib/lotNextAction';
import { StatusBadge } from './ui/primitives';

interface Props {
  lang?: Language;
  lot: WineLot;
  vessels: Vessel[];
  labLogs: LabAnalysis[];
  costEntries: CostEntry[];
  bottlingRuns: BottlingRunRecord[];
  stockMovements: StockMovement[];
  salesOrders: SalesOrderRecord[];
  salesDispatches: SalesDispatchRecord[];
  currency: string;
  nextAction: LotNextAction;
  onEdit?: () => void;
  onNextAction?: () => void;
  onChangeStage?: () => void;
  onOpenPassport?: (lotId: string) => void;
  setActiveTab?: (tab: string) => void;
  setSelectedTankId?: (tankId: string | null) => void;
  setCalculatorLotId?: (lotId: string) => void;
  setLabLotId?: (lotId: string) => void;
  onLogOperation?: (vesselId: string, operationType?: CellarOperationType) => void;
  onPlanTransfer?: (vesselId: string, role?: 'source' | 'destination') => void;
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
  lang = 'en',
  lot,
  vessels,
  labLogs,
  nextAction,
  onEdit,
  onNextAction,
  onChangeStage,
  onOpenPassport,
  setActiveTab,
  setSelectedTankId,
  setCalculatorLotId,
  setLabLotId,
  onLogOperation,
  onPlanTransfer,
}: Props) {
  const ka = lang === 'ka';
  const stageLabel = (stage: WinemakingStage) => sharedStageLabel(stage, lang);
  const containingVessels = vessels.filter(v => v.assignedLotId === lot.id);
  const latestLab = labLogs
    .filter(log => log.lotId === lot.id)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const vesselVolume = containingVessels.reduce((total, vessel) => total + vessel.currentVolume, 0);
  const volumeDifference = Math.round((lot.currentVolume - vesselVolume) * 100) / 100;
  const averageTemperature = containingVessels.length
    ? containingVessels.reduce((total, vessel) => total + vessel.temperature, 0) / containingVessels.length
    : null;
  const highestFill = containingVessels.reduce((highest, vessel) => (
    Math.max(highest, vessel.capacity > 0 ? (vessel.currentVolume / vessel.capacity) * 100 : 0)
  ), 0);
  const operationAction = containingVessels.length === 1 && onLogOperation
    ? () => onLogOperation(containingVessels[0].id)
    : setActiveTab
      ? () => setActiveTab('operations')
      : undefined;
  const stageOrder = stagesForCurrentLot(lot.wineClass, lot.stage);
  const currentStageIndex = Math.max(0, stageOrder.indexOf(lot.stage));
  const progressPct = Math.round(((currentStageIndex + 1) / stageOrder.length) * 100);
  const nextStepTone = {
    ready: {
      border: 'border-emerald-200 dark:border-emerald-900/70',
      background: 'bg-emerald-50/70 dark:bg-emerald-950/20',
      badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
      icon: CircleCheck,
    },
    needs_data: {
      border: 'border-amber-200 dark:border-amber-900/70',
      background: 'bg-amber-50/70 dark:bg-amber-950/20',
      badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
      icon: CircleAlert,
    },
    blocked: {
      border: 'border-rose-200 dark:border-rose-900/70',
      background: 'bg-rose-50/70 dark:bg-rose-950/20',
      badge: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
      icon: LockKeyhole,
    },
    complete: {
      border: 'border-sky-200 dark:border-sky-900/70',
      background: 'bg-sky-50/70 dark:bg-sky-950/20',
      badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
      icon: CircleCheck,
    },
  }[nextAction.status];
  const NextStepIcon = nextStepTone.icon;

  return (
    <section className="overflow-hidden rounded-3xl border border-[#e8dfd5] bg-gradient-to-br from-white via-[#fffdfa] to-[#f8f1ea] shadow-sm dark:border-stone-800 dark:from-stone-900 dark:via-stone-900 dark:to-stone-950">
      <div className="relative p-5 lg:p-6">
        <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-[#4e0e15] via-[#801323] to-[#c5a059]" />
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="brand">{lot.id}</StatusBadge>
              <StatusBadge tone={lot.stage === 'sold' ? 'success' : lot.stage === 'bottled' ? 'info' : 'neutral'}>
                {stageLabel(lot.stage) || lot.stage}
              </StatusBadge>
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-stone-400">
                {ka ? 'მოსავალი' : 'Vintage'} {lot.vintage}
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-serif font-black leading-tight text-stone-950 dark:text-amber-100">
              {lot.name}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-stone-500 dark:text-stone-400">
              {lot.variety} · {lot.vineyardBlock || (ka ? 'ბლოკი მიუთითებელია' : 'unassigned block')} · {lot.region || (ka ? 'უცნობი რეგიონი' : 'unknown region')}
            </p>
          </div>

          <div className="flex flex-wrap items-stretch gap-2">
            {onEdit && <ActionChip icon={Pencil} onClick={onEdit}>{ka ? 'რედაქტირება' : 'Edit'}</ActionChip>}
            <ActionChip icon={GitMerge} onClick={setActiveTab ? () => setActiveTab('lineage') : undefined}>{ka ? 'გენეალოგია' : 'Lineage'}</ActionChip>
            <ActionChip icon={FileText} onClick={onOpenPassport ? () => onOpenPassport(lot.id) : undefined}>{ka ? 'პასპორტი' : 'Passport'}</ActionChip>
          </div>
        </div>

        <div className={`mt-5 rounded-2xl border p-4 ${nextStepTone.border} ${nextStepTone.background}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[9px] font-mono font-black uppercase tracking-widest text-stone-500 dark:text-stone-300">
                  <Activity className="h-3.5 w-3.5 text-[#4e0e15] dark:text-amber-200" />
                  {ka ? 'შემდეგი ნაბიჯი' : 'Next step'}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wide ${nextStepTone.badge}`}>
                  <NextStepIcon className="h-3 w-3" />
                  {lotNextActionStatusLabel(nextAction.status, lang)}
                </span>
              </div>
              <h3 className="mt-2 text-base font-serif font-black text-stone-950 dark:text-amber-100">
                {nextAction.label}
              </h3>
              <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-stone-600 dark:text-stone-300">
                {nextAction.description}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {onChangeStage && nextAction.intent !== 'transition' && lot.stage !== 'sold' && (
                <button
                  type="button"
                  onClick={onChangeStage}
                  className="rounded-xl border border-stone-300 bg-white/80 px-3 py-2 text-[10px] font-bold text-stone-600 transition-colors hover:border-[#4e0e15]/40 hover:text-[#4e0e15] dark:border-stone-700 dark:bg-stone-950/50 dark:text-stone-300"
                >
                  {ka ? 'სხვა ეტაპის არჩევა' : 'Choose another stage'}
                </button>
              )}
              {onNextAction && nextAction.intent !== 'none' && (
                <button
                  type="button"
                  onClick={onNextAction}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#4e0e15] px-4 py-2 text-[10px] font-black text-amber-50 shadow-sm transition-colors hover:bg-[#6b151e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a059] focus-visible:ring-offset-2"
                >
                  {nextAction.ctaLabel}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard label={ka ? 'მიმდინარე მოცულობა' : 'Current volume'} value={`${lot.currentVolume.toLocaleString()} L`} hint={`${lot.initialVolume.toLocaleString()} L ${ka ? 'საწყისი' : 'initial'}`} />
          <MetricCard
            label={ka ? 'განთავსება' : 'Placement'}
            value={containingVessels.length ? `${containingVessels.length} ${ka ? 'ჭურჭელი' : containingVessels.length === 1 ? 'vessel' : 'vessels'}` : '—'}
            hint={Math.abs(volumeDifference) > 0.1
              ? `${ka ? 'მოცულობის სხვაობა' : 'volume difference'} ${volumeDifference.toLocaleString()} L`
              : `${vesselVolume.toLocaleString()} L ${ka ? 'შეჯერებულია' : 'reconciled'}`}
          />
          <MetricCard
            label={ka ? 'ტემპერატურა' : 'Temperature'}
            value={averageTemperature == null ? '—' : `${averageTemperature.toFixed(1)}°C`}
            hint={containingVessels.length ? `${ka ? 'უმაღლესი შევსება' : 'highest fill'} ${Math.round(highestFill)}%` : (ka ? 'ჭურჭელი არ არის მიბმული' : 'no vessel assigned')}
          />
          <MetricCard
            label={ka ? 'ბოლო ანალიზი' : 'Latest analysis'}
            value={latestLab ? `pH ${latestLab.ph}` : '—'}
            hint={latestLab ? `SO₂ ${latestLab.freeSo2} mg/L · ${latestLab.date}` : (ka ? 'ანალიზი ჯერ არ არის' : 'no lab yet')}
          />
        </div>

        <div className="mt-5 rounded-2xl border border-stone-200 bg-white/55 p-3 dark:border-stone-800 dark:bg-stone-950/30">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[9px] font-mono font-black uppercase tracking-widest text-stone-400">
              {winemakingWorkflowLabel(lot.wineClass, lang)}
            </span>
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
                {stageLabel(stage)}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-stone-200 bg-white/65 p-4 dark:border-stone-800 dark:bg-stone-950/30">
            <h3 className="flex items-center gap-1.5 text-xs font-black text-stone-700 dark:text-amber-100">
              <MapPin className="h-4 w-4 text-[#4e0e15]" /> {ka ? 'სად არის ახლა' : 'Where it is now'}
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
                      <span className="text-[10px] text-stone-400">{vesselTypeLabel(vessel.type, lang)} · {vessel.temperature}°C</span>
                    </span>
                    <span className="text-[10px] font-mono font-bold text-stone-500">{vessel.currentVolume.toLocaleString()} L</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-stone-400">{ka ? 'ამჟამად ჭურჭელი მიბმული არ არის. თუ ჩამოსხმულია, შეამოწმეთ მზა პროდუქციის მარაგი და საწყობი.' : 'No vessel currently assigned. If bottled, check finished-goods stock and storage.'}</p>
            )}
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white/65 p-4 dark:border-stone-800 dark:bg-stone-950/30">
            <h3 className="flex items-center gap-1.5 text-xs font-black text-stone-700 dark:text-amber-100">
              <Wine className="h-4 w-4 text-[#4e0e15]" /> {ka ? 'სწრაფი მოქმედებები' : 'Quick actions'}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionChip icon={Wrench} onClick={operationAction}>{ka ? 'ოპერაცია' : 'Operation'}</ActionChip>
              <ActionChip icon={ArrowRightLeft} onClick={containingVessels.length === 1 && onPlanTransfer ? () => onPlanTransfer(containingVessels[0].id) : setActiveTab && containingVessels.length ? () => setActiveTab('transfers') : undefined}>{ka ? 'გადატანა' : 'Transfer'}</ActionChip>
              <ActionChip icon={FlaskConical} onClick={setActiveTab ? () => { setLabLotId?.(lot.id); setActiveTab('labs'); } : undefined}>{ka ? 'ლაბორატორია' : 'Lab'}</ActionChip>
              {lot.stage === 'filtration'
                ? <ActionChip icon={PackageCheck} onClick={setActiveTab ? () => setActiveTab('bottling') : undefined}>{ka ? 'ჩამოსხმა' : 'Bottling'}</ActionChip>
                : <ActionChip icon={Calculator} onClick={setActiveTab && setCalculatorLotId ? () => { setCalculatorLotId(lot.id); setActiveTab('calculators'); } : undefined}>{ka ? 'კალკულატორი' : 'Calculator'}</ActionChip>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
