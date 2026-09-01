'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Beaker,
  ChevronRight,
  CircleGauge,
  Container,
  Droplets,
  FileClock,
  FileText,
  Filter,
  FlaskConical,
  List,
  Map as MapIcon,
  MapPin,
  Package,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Wrench,
  Wine,
  X,
} from 'lucide-react';
import type {
  CellarOperation,
  CellarOperationType,
  CellarFloor,
  DailyFermLog,
  LabAnalysis,
  Task,
  Vessel,
  VesselType,
  WineLot,
} from '../lib/wineryState';
import type { ProductionPlanItem } from '../lib/operationsControl';
import type { Language } from '../lib/i18n';
import { stageLabel, vesselTypeLabel, wineClassLabel } from '../lib/enumLabels';
import { nextActionForWineLot } from '../lib/lotNextAction';
import { CELLAR_OPERATIONS } from '../lib/wineryOperations';
import WineLotsTrace, { type WineLotsTraceProps } from './WineLotsTrace';
import CellarPlan from './CellarPlan';
import VesselFill from './VesselFill';
import { PageHeader, StatusBadge } from './ui/primitives';

type WorkspaceMode = 'lots' | 'vessels';
type VesselPresentation = 'register' | 'plan';
type ContextTab = 'activity' | 'analysis' | 'details';
type WorkspaceFilter = 'all' | 'attention' | 'fermenting' | 'available' | 'cleaning';

export interface CellarWorkspaceProps extends Omit<
  WineLotsTraceProps,
  'embedded' | 'focusedLotId' | 'onFocusedLotIdChange' | 'compact' | 'vessels' | 'onLogOperation'
> {
  vessels: Vessel[];
  operations: CellarOperation[];
  cellarFloors?: CellarFloor[];
  productionPlans?: ProductionPlanItem[];
  tasks?: Task[];
  initialMode?: WorkspaceMode;
  initialVesselId?: string | null;
  onUpdateVessels: (vessels: Vessel[]) => void;
  onUpdateCellarFloors?: (floors: CellarFloor[]) => void;
  onOpenProductionPlan?: (planId: string) => void;
  onOpenVesselDetails?: (vesselId: string) => void;
  onLogOperation?: (vesselId: string, operationType?: CellarOperationType) => void;
  onCanonicalize?: () => void;
  canViewLots?: boolean;
  canViewVessels?: boolean;
  canCreateVessel?: boolean;
  canUpdateVessel?: boolean;
  canExecuteTransfer?: boolean;
  renderQvevriRecords?: (onBackToVessels: () => void, focusedVesselId?: string | null) => React.ReactNode;
}

interface VesselSignal {
  tone: 'danger' | 'warning' | 'ready' | 'neutral';
  label: string;
  description: string;
  operationType?: CellarOperationType;
}

interface ActivityRow {
  id: string;
  date: string;
  title: string;
  detail: string;
}

function vesselSignal(vessel: Vessel, lot: WineLot | undefined, lang: Language): VesselSignal {
  const ka = lang === 'ka';
  const fill = vessel.capacity > 0 ? (vessel.currentVolume / vessel.capacity) * 100 : 0;
  if ((vessel.currentVolume > 0 && !vessel.assignedLotId) || (vessel.currentVolume === 0 && vessel.assignedLotId)) {
    return {
      tone: 'danger',
      label: ka ? 'კავშირი შესამოწმებელია' : 'Assignment needs review',
      description: ka ? 'მოცულობა და პარტიის კავშირი ერთმანეთს არ შეესაბამება.' : 'The physical volume and lot assignment do not agree.',
    };
  }
  if (fill > 100) {
    return {
      tone: 'danger',
      label: ka ? 'ტევადობა გადაჭარბებულია' : 'Capacity exceeded',
      description: ka ? 'შეამოწმეთ მოცულობის ჩანაწერი დაუყოვნებლივ.' : 'Verify the recorded volume immediately.',
    };
  }
  if (lot?.stage === 'fermenting' && fill >= 90) {
    return {
      tone: 'danger',
      label: ka ? 'დუღილის სივრცე მცირეა' : 'Fermentation headspace is low',
      description: ka ? 'აქტიური დუღილისთვის თავისუფალი სივრცე შეამოწმეთ.' : 'Review free headspace for the active fermentation.',
      operationType: 'measurement',
    };
  }
  if (lot?.stage === 'fermenting' && (vessel.temperature < 8 || vessel.temperature > 30)) {
    return {
      tone: 'danger',
      label: ka ? 'ტემპერატურა შესამოწმებელია' : 'Temperature needs review',
      description: `${vessel.temperature}°C · ${ka ? 'დაადასტურეთ ახალი ფიზიკური გაზომვით' : 'confirm with a new physical reading'}`,
      operationType: 'measurement',
    };
  }
  if (vessel.currentVolume === 0 && vessel.cleaningStatus !== 'clean') {
    return {
      tone: 'warning',
      label: ka ? 'სანიტარია საჭიროა' : 'Sanitation required',
      description: ka ? 'გამოყენებამდე ჩაწერეთ დასრულებული სანიტარიული ციკლი.' : 'Record a completed sanitation cycle before reuse.',
      operationType: 'cleaning',
    };
  }
  if (lot && ['aging', 'stabilization', 'filtration'].includes(lot.stage)
    && vessel.currentVolume > 0 && fill < (vessel.type === 'barrel' ? 95 : 85)) {
    return {
      tone: 'warning',
      label: ka ? 'თავისუფალი სივრცე მაღალია' : 'Headspace is high',
      description: `${Math.round(100 - fill)}% ${ka ? 'თავისუფალი სივრცე' : 'free capacity'} · ${ka ? 'შეაფასეთ გადატანა ან შევსება' : 'review racking or topping'}`,
      operationType: 'racking',
    };
  }
  if (vessel.currentVolume === 0 && vessel.cleaningStatus === 'clean') {
    return {
      tone: 'ready',
      label: ka ? 'მზადაა გამოყენებისთვის' : 'Ready for use',
      description: ka ? 'ჭურჭელი ცარიელი და სუფთაა.' : 'The vessel is empty and clean.',
    };
  }
  return {
    tone: 'neutral',
    label: ka ? 'სტაბილური მდგომარეობა' : 'Stable condition',
    description: ka ? 'ამჟამად გადაუდებელი ჩანაწერი არ არის.' : 'No immediate record is required.',
  };
}

function operationLabel(type: CellarOperationType, lang: Language): string {
  const meta = CELLAR_OPERATIONS.find(item => item.key === type);
  return lang === 'ka' ? (meta?.ka || type) : (meta?.en || type);
}

function toneClasses(tone: VesselSignal['tone']): string {
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/25 dark:text-rose-100';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100';
  if (tone === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-100';
  return 'border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-200';
}

function ContextTabs({
  lang,
  value,
  onChange,
}: {
  lang: Language;
  value: ContextTab;
  onChange: (tab: ContextTab) => void;
}) {
  const tabs: Array<{ id: ContextTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'activity', label: lang === 'ka' ? 'აქტივობა' : 'Activity', icon: FileClock },
    { id: 'analysis', label: lang === 'ka' ? 'ანალიზები' : 'Analysis', icon: Beaker },
    { id: 'details', label: lang === 'ka' ? 'დეტალები' : 'Details', icon: FileText },
  ];
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-stone-200 px-1 dark:border-stone-800" role="tablist">
      {tabs.map(tab => {
        const Icon = tab.icon;
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`inline-flex min-h-10 items-center gap-1.5 border-b-2 px-3 text-[11px] font-black transition-colors ${selected
              ? 'border-[#651522] text-[#651522] dark:border-amber-300 dark:text-amber-100'
              : 'border-transparent text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'}`}
          >
            <Icon className="h-3.5 w-3.5" /> {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-stone-200 p-5 text-center text-xs text-stone-400 dark:border-stone-800">{children}</p>;
}

export default function CellarWorkspace({
  lang,
  lots: sourceLots,
  vessels: sourceVessels,
  operations,
  cellarFloors,
  productionPlans = [],
  tasks = [],
  fermLogs = [],
  labLogs = [],
  bottlingRuns = [],
  initialMode = 'lots',
  initialVesselId,
  onUpdateVessels,
  onUpdateCellarFloors,
  onOpenProductionPlan,
  onOpenVesselDetails,
  onLogOperation,
  onPlanTransfer,
  onLocateOnWineryPlan,
  onCanonicalize,
  canViewLots = true,
  canViewVessels = true,
  canCreateVessel = true,
  canUpdateVessel = true,
  canExecuteTransfer = true,
  renderQvevriRecords,
  setActiveTab,
  setLabLotId,
  setToastMessage,
  ...lotProps
}: CellarWorkspaceProps) {
  const ka = lang === 'ka';
  // The workspace is an aggregate surface: never pass records from an owning
  // module the current role cannot view into list, search, or detail rendering.
  const lots = useMemo(() => canViewLots ? sourceLots : [], [canViewLots, sourceLots]);
  const vessels = useMemo(() => canViewVessels ? sourceVessels : [], [canViewVessels, sourceVessels]);
  const availableModes = useMemo<WorkspaceMode[]>(() => [
    ...(canViewLots ? ['lots' as const] : []),
    ...(canViewVessels ? ['vessels' as const] : []),
  ], [canViewLots, canViewVessels]);
  const normalizedInitialMode = availableModes.includes(initialMode) ? initialMode : (availableModes[0] || 'lots');
  const [mode, setMode] = useState<WorkspaceMode>(normalizedInitialMode);
  const [vesselPresentation, setVesselPresentation] = useState<VesselPresentation>('register');
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<WorkspaceFilter>('all');
  const [contextTab, setContextTab] = useState<ContextTab>('activity');
  const [selectedLotId, setSelectedLotId] = useState<string | null>(lots.find(lot => !lot.voidedAt)?.id || lots[0]?.id || null);
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(initialVesselId || vessels[0]?.id || null);
  const [showAddVessel, setShowAddVessel] = useState(false);
  const [showQvevriRecords, setShowQvevriRecords] = useState(false);
  const [newVesselId, setNewVesselId] = useState('');
  const [newVesselType, setNewVesselType] = useState<VesselType>('stainless_steel');
  const [newVesselCapacity, setNewVesselCapacity] = useState('2000');
  const [newVesselLocation, setNewVesselLocation] = useState('');
  const [addVesselError, setAddVesselError] = useState('');

  useEffect(() => {
    if (!availableModes.includes(mode) && availableModes[0]) setMode(availableModes[0]);
  }, [availableModes, mode]);

  useEffect(() => {
    if (selectedLotId && lots.some(lot => lot.id === selectedLotId)) return;
    setSelectedLotId(lots.find(lot => !lot.voidedAt)?.id || lots[0]?.id || null);
  }, [lots, selectedLotId]);

  useEffect(() => {
    if (selectedVesselId && vessels.some(vessel => vessel.id === selectedVesselId)) return;
    setSelectedVesselId(vessels[0]?.id || null);
  }, [selectedVesselId, vessels]);

  const lotActionById = useMemo(() => new Map(lots.map(lot => [
    lot.id,
    nextActionForWineLot(lot, { vessels, fermLogs, labLogs, bottlingRuns }, lang),
  ])), [bottlingRuns, fermLogs, labLogs, lang, lots, vessels]);

  const vesselSignalById = useMemo(() => new Map(vessels.map(vessel => [
    vessel.id,
    vesselSignal(vessel, lots.find(lot => lot.id === vessel.assignedLotId), lang),
  ])), [lang, lots, vessels]);

  const attentionLotCount = lots.filter(lot => {
    const status = lotActionById.get(lot.id)?.status;
    return !lot.voidedAt && (status === 'blocked' || status === 'needs_data');
  }).length;
  const attentionVesselCount = vessels.filter(vessel => ['danger', 'warning'].includes(vesselSignalById.get(vessel.id)?.tone || '')).length;
  const freeCleanCapacity = vessels
    .filter(vessel => vessel.currentVolume === 0 && vessel.cleaningStatus === 'clean')
    .reduce((total, vessel) => total + vessel.capacity, 0);
  const cleaningCount = vessels.filter(vessel => vessel.currentVolume === 0 && vessel.cleaningStatus !== 'clean').length;
  const fermentingCount = lots.filter(lot => !lot.voidedAt && lot.stage === 'fermenting').length;

  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
  const filteredLots = lots.filter(lot => {
    if (lot.voidedAt) return false;
    const vesselsForLot = vessels.filter(vessel => vessel.assignedLotId === lot.id);
    const searchable = [lot.id, lot.name, lot.variety, lot.vintage, lot.vineyardBlock, ...vesselsForLot.map(vessel => vessel.id)]
      .join(' ').toLocaleLowerCase();
    if (normalizedSearch && !searchable.includes(normalizedSearch)) return false;
    const status = lotActionById.get(lot.id)?.status;
    if (filter === 'attention' && status !== 'blocked' && status !== 'needs_data') return false;
    if (filter === 'fermenting' && lot.stage !== 'fermenting') return false;
    return filter !== 'available' && filter !== 'cleaning';
  });
  const filteredVessels = vessels.filter(vessel => {
    const lot = lots.find(item => item.id === vessel.assignedLotId);
    const searchable = [vessel.id, vessel.locationDetails, vessel.type, lot?.id, lot?.name].join(' ').toLocaleLowerCase();
    if (normalizedSearch && !searchable.includes(normalizedSearch)) return false;
    const signal = vesselSignalById.get(vessel.id);
    if (filter === 'attention' && signal?.tone !== 'danger' && signal?.tone !== 'warning') return false;
    if (filter === 'available' && !(vessel.currentVolume === 0 && vessel.cleaningStatus === 'clean')) return false;
    if (filter === 'cleaning' && !(vessel.currentVolume === 0 && vessel.cleaningStatus !== 'clean')) return false;
    return filter !== 'fermenting' || lot?.stage === 'fermenting';
  });

  const selectedLot = lots.find(lot => lot.id === selectedLotId);
  const selectedVessel = vessels.find(vessel => vessel.id === selectedVesselId);
  const selectedVesselLot = selectedVessel?.assignedLotId
    ? lots.find(lot => lot.id === selectedVessel.assignedLotId)
    : undefined;
  const selectedVesselSignal = selectedVessel
    ? vesselSignalById.get(selectedVessel.id) || vesselSignal(selectedVessel, selectedVesselLot, lang)
    : undefined;

  const switchMode = (nextMode: WorkspaceMode) => {
    if (!availableModes.includes(nextMode)) return;
    setMode(nextMode);
    if (nextMode === 'vessels') setVesselPresentation('register');
    setFilter('all');
    setContextTab('activity');
    setShowQvevriRecords(false);
    onCanonicalize?.();
  };

  const showVesselPlan = () => {
    const focusVesselId = selectedVesselId || vessels[0]?.id;
    if (focusVesselId && onLocateOnWineryPlan) {
      onLocateOnWineryPlan(focusVesselId);
      return;
    }
    setMode('vessels');
    setVesselPresentation('plan');
    setSearchTerm('');
    setFilter('all');
    setShowQvevriRecords(false);
  };

  const openLot = (lotId: string) => {
    setSelectedLotId(lotId);
    setMode('lots');
    setContextTab('activity');
    setShowQvevriRecords(false);
    onCanonicalize?.();
  };

  const openVessel = (vesselId: string) => {
    setSelectedVesselId(vesselId);
    setMode('vessels');
    setContextTab('activity');
    setShowQvevriRecords(false);
    onCanonicalize?.();
  };

  const addVessel = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreateVessel) return;
    const id = newVesselId.trim();
    const capacity = Number(newVesselCapacity);
    if (!id) {
      setAddVesselError(ka ? 'მიუთითეთ ჭურჭლის ID.' : 'Enter a vessel ID.');
      return;
    }
    if (vessels.some(vessel => vessel.id.toLocaleLowerCase() === id.toLocaleLowerCase())) {
      setAddVesselError(ka ? 'ამ ID-ით ჭურჭელი უკვე არსებობს.' : 'A vessel with this ID already exists.');
      return;
    }
    if (!Number.isFinite(capacity) || capacity <= 0) {
      setAddVesselError(ka ? 'ტევადობა უნდა იყოს ნულზე მეტი.' : 'Capacity must be greater than zero.');
      return;
    }
    const nextVessel: Vessel = {
      id,
      type: newVesselType,
      shape: newVesselType === 'barrel' ? 'horizontal' : 'vertical',
      capacity,
      currentVolume: 0,
      assignedLotId: null,
      cleaningStatus: 'clean',
      lastCleaned: new Date().toISOString().slice(0, 10),
      temperature: 15,
      coolingJacketActive: false,
      targetTemperature: null,
      lastOperation: 'Vessel commissioned',
      locationDetails: newVesselLocation.trim() || undefined,
    };
    onUpdateVessels([...vessels, nextVessel]);
    setNewVesselId('');
    setNewVesselLocation('');
    setNewVesselCapacity('2000');
    setAddVesselError('');
    setShowAddVessel(false);
    setSelectedVesselId(id);
    setMode('vessels');
    setToastMessage?.(ka ? `ჭურჭელი ${id} დაემატა.` : `Vessel ${id} added.`);
  };

  const activityForLot = (lot: WineLot): ActivityRow[] => {
    const historyRows = (lot.history || []).map((row, index) => ({
      id: `history-${index}-${row.date}`,
      date: row.date,
      title: row.type,
      detail: `${row.description}${row.operator ? ` · ${row.operator}` : ''}`,
    }));
    const operationRows = operations
      .filter(operation => operation.lotId === lot.id)
      .map(operation => ({
        id: operation.id,
        date: operation.date,
        title: operationLabel(operation.type, lang),
        detail: [operation.vesselId, operation.notes, operation.operator].filter(Boolean).join(' · '),
      }));
    return [...historyRows, ...operationRows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  };

  const activityForVessel = (vessel: Vessel): ActivityRow[] => {
    const operationRows = operations
      .filter(operation => operation.vesselId === vessel.id || operation.vesselToId === vessel.id)
      .map(operation => ({
        id: operation.id,
        date: operation.date,
        title: operationLabel(operation.type, lang),
        detail: [operation.lotName, operation.notes, operation.operator].filter(Boolean).join(' · '),
      }));
    const sanitationRows = (vessel.sanitationHistory || []).map((row, index) => ({
      id: `sanitation-${index}-${row.date}`,
      date: row.date,
      title: ka ? 'სანიტარია' : 'Sanitation',
      detail: [row.action, row.operator, row.notes].filter(Boolean).join(' · '),
    }));
    return [...operationRows, ...sanitationRows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  };

  const renderActivity = (rows: ActivityRow[]) => rows.length ? (
    <div className="divide-y divide-stone-100 dark:divide-stone-800">
      {rows.map(row => (
        <div key={row.id} className="grid gap-1 py-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <span className="text-[10px] font-mono font-bold text-stone-400">{row.date.slice(0, 10)}</span>
          <div>
            <strong className="block text-xs text-stone-800 dark:text-stone-100">{row.title}</strong>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">{row.detail || '—'}</span>
          </div>
        </div>
      ))}
    </div>
  ) : <EmptyPanel>{ka ? 'აქტივობა ჯერ არ არის ჩაწერილი.' : 'No activity has been recorded yet.'}</EmptyPanel>;

  const renderLotContext = (lot: WineLot) => {
    const lotLabs = labLogs.filter(log => log.lotId === lot.id).slice().sort((a, b) => b.date.localeCompare(a.date));
    const lotFermLogs = fermLogs.filter(log => log.lotId === lot.id).slice().sort((a, b) => b.date.localeCompare(a.date));
    const lotVessels = vessels.filter(vessel => vessel.assignedLotId === lot.id);
    if (contextTab === 'activity') return renderActivity(activityForLot(lot));
    if (contextTab === 'analysis') return (
      <div className="grid gap-4 lg:grid-cols-2">
        <AnalysisCard lang={lang} lab={lotLabs[0]} />
        <FermentationCard lang={lang} reading={lotFermLogs[0]} />
      </div>
    );
    return (
      <div className="grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <DetailItem label={ka ? 'ჯიში' : 'Variety'} value={lot.variety} />
        <DetailItem label={ka ? 'მოსავალი' : 'Vintage'} value={String(lot.vintage)} />
        <DetailItem label={ka ? 'ვენახი / ბლოკი' : 'Vineyard block'} value={lot.vineyardBlock || '—'} />
        <DetailItem label={ka ? 'რეგიონი' : 'Region'} value={lot.region || '—'} />
        <DetailItem label={ka ? 'ღვინის ტიპი' : 'Wine style'} value={wineClassLabel(lot.wineClass, lang)} />
        <DetailItem label={ka ? 'შაქრიანობა' : 'Sugar category'} value={lot.sugarCategory || '—'} />
        <DetailItem label={ka ? 'ჭურჭლების მოცულობა' : 'Vessel volume'} value={`${lotVessels.reduce((total, vessel) => total + vessel.currentVolume, 0).toLocaleString()} L`} />
        <DetailItem label={ka ? 'შექმნილია' : 'Created'} value={lot.createdAt} />
      </div>
    );
  };

  const renderVesselContext = (vessel: Vessel) => {
    const vesselLabs = labLogs.filter(log => log.tankId === vessel.id).slice().sort((a, b) => b.date.localeCompare(a.date));
    const vesselFermLogs = fermLogs.filter(log => log.tankId === vessel.id).slice().sort((a, b) => b.date.localeCompare(a.date));
    if (contextTab === 'activity') return renderActivity(activityForVessel(vessel));
    if (contextTab === 'analysis') return (
      <div className="grid gap-4 lg:grid-cols-2">
        <AnalysisCard lang={lang} lab={vesselLabs[0]} />
        <FermentationCard lang={lang} reading={vesselFermLogs[0]} />
      </div>
    );
    return (
      <div className="grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <DetailItem label={ka ? 'ტიპი' : 'Type'} value={vesselTypeLabel(vessel.type, lang)} />
        <DetailItem label={ka ? 'ფორმა' : 'Shape'} value={vessel.shape} />
        <DetailItem label={ka ? 'მდებარეობა' : 'Location'} value={vessel.locationDetails || vessel.maraniLocation || '—'} />
        <DetailItem label={ka ? 'ბოლო რეცხვა' : 'Last sanitation'} value={vessel.lastCleaned || '—'} />
        <DetailItem label={ka ? 'სასურველი ტემპერატურა' : 'Recorded setpoint'} value={vessel.targetTemperature == null ? '—' : `${vessel.targetTemperature}°C`} />
        <DetailItem label={ka ? 'გაგრილების ჩანაწერი' : 'Cooling status'} value={vessel.coolingJacketActive ? (ka ? 'აქტიურად მონიშნული' : 'Recorded active') : (ka ? 'არააქტიური' : 'Inactive')} />
        {vessel.type === 'qvevri' && <DetailItem label={ka ? 'დალუქვა' : 'Last sealed'} value={vessel.lastSealedDate || vessel.sealingDate || '—'} />}
        {vessel.type === 'qvevri' && <DetailItem label={ka ? 'ნიადაგის ტემპ.' : 'Soil temperature'} value={vessel.soilTemperature == null ? '—' : `${vessel.soilTemperature}°C`} />}
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="cellar-workspace">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <PageHeader
          eyebrow={ka ? 'მარნის სამუშაო სივრცე' : 'Cellar workspace'}
          title={ka ? 'ღვინო და ჭურჭელი' : 'Wine and vessels'}
          icon={Wine}
        />
        <div className="flex flex-wrap gap-2">
          {lotProps.canCreateLot && setActiveTab && (
            <button type="button" onClick={() => setActiveTab('intake')} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-xs font-black text-stone-700 hover:border-[#651522]/30 hover:text-[#651522] dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
              <Droplets className="h-4 w-4" /> {ka ? 'ახალი მიღება' : 'New intake'}
            </button>
          )}
          {canCreateVessel && canViewVessels && (
            <button type="button" onClick={() => setShowAddVessel(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#651522] px-3 text-xs font-black text-white hover:bg-[#7a1c2b]">
              <Plus className="h-4 w-4" /> {ka ? 'ჭურჭლის დამატება' : 'Add vessel'}
            </button>
          )}
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between lg:p-4">
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex w-fit rounded-xl bg-stone-100 p-1 dark:bg-stone-950" aria-label={ka ? 'მარნის ხედვა' : 'Cellar view'}>
              {canViewLots && (
                <button type="button" aria-pressed={mode === 'lots'} onClick={() => switchMode('lots')} className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-black ${mode === 'lots' ? 'bg-white text-[#651522] shadow-sm dark:bg-stone-800 dark:text-amber-100' : 'text-stone-500'}`}>
                  <Wine className="h-4 w-4" /> {ka ? 'პარტიებით' : 'By lot'}
                </button>
              )}
              {canViewVessels && (
                <button type="button" aria-pressed={mode === 'vessels'} onClick={() => switchMode('vessels')} className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-black ${mode === 'vessels' ? 'bg-white text-[#651522] shadow-sm dark:bg-stone-800 dark:text-amber-100' : 'text-stone-500'}`}>
                  <Container className="h-4 w-4" /> {ka ? 'ჭურჭლებით' : 'By vessel'}
                </button>
              )}
            </div>
            {mode === 'vessels' && canViewVessels && (
              <div className="inline-flex w-fit rounded-xl border border-stone-200 bg-white p-1 dark:border-stone-800 dark:bg-stone-900" aria-label={ka ? 'ჭურჭლების წარმოდგენა' : 'Vessel presentation'}>
                <button type="button" aria-pressed={vesselPresentation === 'register'} onClick={() => setVesselPresentation('register')} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-black ${vesselPresentation === 'register' ? 'bg-stone-100 text-[#651522] dark:bg-stone-800 dark:text-amber-100' : 'text-stone-400'}`}><List className="h-3.5 w-3.5" />{ka ? 'რეესტრი' : 'Register'}</button>
                <button type="button" aria-pressed={vesselPresentation === 'plan'} onClick={showVesselPlan} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-black ${vesselPresentation === 'plan' ? 'bg-stone-100 text-[#651522] dark:bg-stone-800 dark:text-amber-100' : 'text-stone-400'}`}><MapIcon className="h-3.5 w-3.5" />{ka ? 'მარნის გეგმა' : 'Cellar plan'}</button>
              </div>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:max-w-2xl">
            <label className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                placeholder={mode === 'lots'
                  ? (ka ? 'პარტია, ჯიში, ჭურჭელი...' : 'Lot, variety, vessel...')
                  : (ka ? 'ჭურჭელი, მდებარეობა, პარტია...' : 'Vessel, location, lot...')}
                className="min-h-10 w-full rounded-xl border border-stone-200 bg-stone-50 pl-10 pr-9 text-xs outline-none focus:border-[#651522]/40 dark:border-stone-800 dark:bg-stone-950"
              />
              {searchTerm && <button type="button" onClick={() => setSearchTerm('')} aria-label={ka ? 'ძებნის გასუფთავება' : 'Clear search'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-stone-400 hover:text-stone-700"><X className="h-3.5 w-3.5" /></button>}
            </label>
            <label className="relative w-full sm:w-auto">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <select value={filter} onChange={event => setFilter(event.target.value as WorkspaceFilter)} className="min-h-10 w-full appearance-none rounded-xl border border-stone-200 bg-stone-50 pl-9 pr-8 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950 sm:min-w-44">
                <option value="all">{ka ? 'ყველა ჩანაწერი' : 'All records'}</option>
                <option value="attention">{ka ? 'საჭიროებს ყურადღებას' : 'Needs attention'}</option>
                <option value="fermenting">{ka ? 'აქტიური დუღილი' : 'Active fermentation'}</option>
                {mode === 'vessels' && <option value="available">{ka ? 'ცარიელი და სუფთა' : 'Empty and clean'}</option>}
                {mode === 'vessels' && <option value="cleaning">{ka ? 'სანიტარია საჭიროა' : 'Needs sanitation'}</option>}
              </select>
            </label>
          </div>
        </div>
        <div className="flex gap-x-5 gap-y-2 overflow-x-auto border-t border-stone-100 px-4 py-2.5 text-[10px] font-bold text-stone-500 dark:border-stone-800">
          <button type="button" onClick={() => setFilter('attention')} className="whitespace-nowrap hover:text-[#651522]"><AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-600" />{ka ? 'ყურადღება' : 'Attention'} {mode === 'lots' ? attentionLotCount : attentionVesselCount}</button>
          {canViewVessels && <button type="button" onClick={() => { switchMode('vessels'); setFilter('available'); }} className="whitespace-nowrap hover:text-[#651522]"><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />{freeCleanCapacity.toLocaleString()} L {ka ? 'თავისუფალი სუფთა ტევადობა' : 'clean capacity'}</button>}
          {canViewVessels && <button type="button" onClick={() => { switchMode('vessels'); setFilter('cleaning'); }} className="whitespace-nowrap hover:text-[#651522]"><Sparkles className="mr-1 inline h-3.5 w-3.5" />{ka ? 'გასარეცხი' : 'Sanitation'} {cleaningCount}</button>}
          {canViewLots && <button type="button" onClick={() => { switchMode('lots'); setFilter('fermenting'); }} className="whitespace-nowrap hover:text-[#651522]"><Activity className="mr-1 inline h-3.5 w-3.5 text-rose-700" />{ka ? 'აქტიური დუღილი' : 'Active ferments'} {fermentingCount}</button>}
        </div>
      </section>

      {mode === 'vessels' && vesselPresentation === 'plan' ? (
        <CellarPlan
          lang={lang}
          vessels={vessels}
          lots={lots}
          floors={cellarFloors}
          productionPlans={productionPlans}
          tasks={tasks}
          selectedVesselId={selectedVesselId}
          onSelectVessel={setSelectedVesselId}
          onOpenVessel={vesselId => {
            setSelectedVesselId(vesselId);
            setVesselPresentation('register');
          }}
          onOpenLot={openLot}
          onLogOperation={onLogOperation}
          onUpdateVessels={onUpdateVessels}
          onUpdateFloors={onUpdateCellarFloors}
          onOpenProductionPlan={onOpenProductionPlan}
          canUpdate={canUpdateVessel}
        />
      ) : (
      <div className="grid gap-4 xl:grid-cols-[minmax(16rem,0.34fr)_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 dark:border-stone-800">
            <strong className="text-xs text-stone-800 dark:text-stone-100">{mode === 'lots' ? (ka ? 'აქტიური პარტიები' : 'Active lots') : (ka ? 'ჭურჭლების რეესტრი' : 'Vessel register')}</strong>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-black text-stone-500 dark:bg-stone-800">{mode === 'lots' ? filteredLots.length : filteredVessels.length}</span>
          </div>
          <div className="max-h-[28dvh] overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800 sm:max-h-[36dvh] xl:max-h-[68dvh]">
            {mode === 'lots' && filteredLots.map(lot => {
              const lotVessels = vessels.filter(vessel => vessel.assignedLotId === lot.id);
              const action = lotActionById.get(lot.id);
              const selected = lot.id === selectedLotId;
              return (
                <button key={lot.id} type="button" onClick={() => openLot(lot.id)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${selected ? 'bg-[#f6edef] dark:bg-[#351a20]' : 'hover:bg-stone-50 dark:hover:bg-stone-950/40'}`}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${action?.status === 'blocked' ? 'bg-rose-500' : action?.status === 'needs_data' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs text-stone-900 dark:text-stone-100">{lot.name}</strong>
                    <span className="mt-0.5 block truncate text-[10px] text-stone-400">{lot.id} · {lot.vintage} · {stageLabel(lot.stage, lang)}</span>
                    <span className="mt-1 block text-[10px] font-bold text-stone-500">{lot.currentVolume.toLocaleString()} L · {lotVessels.length} {ka ? 'ჭურჭელი' : lotVessels.length === 1 ? 'vessel' : 'vessels'}</span>
                  </span>
                  <ChevronRight className={`h-4 w-4 shrink-0 ${selected ? 'text-[#651522]' : 'text-stone-300'}`} />
                </button>
              );
            })}
            {mode === 'vessels' && filteredVessels.map(vessel => {
              const lot = lots.find(item => item.id === vessel.assignedLotId);
              const signal = vesselSignalById.get(vessel.id)!;
              const selected = vessel.id === selectedVesselId;
              const fill = vessel.capacity > 0 ? Math.round((vessel.currentVolume / vessel.capacity) * 100) : 0;
              return (
                <button key={vessel.id} type="button" onClick={() => openVessel(vessel.id)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${selected ? 'bg-[#f6edef] dark:bg-[#351a20]' : 'hover:bg-stone-50 dark:hover:bg-stone-950/40'}`}>
                  <span className={`relative shrink-0 ${selected ? 'text-[#651522]' : 'text-stone-500'}`}>
                    <VesselFill fillPct={fill} wineClass={lot?.wineClass || 'red'} qvevri={vessel.type === 'qvevri'} width={30} height={40} />
                    <span className={`absolute -right-0.5 top-0 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-stone-900 ${signal.tone === 'danger' ? 'bg-rose-500' : signal.tone === 'warning' ? 'bg-amber-400' : signal.tone === 'ready' ? 'bg-emerald-500' : 'bg-stone-300'}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs text-stone-900 dark:text-stone-100">{vessel.id}</strong>
                    <span className="mt-0.5 block truncate text-[10px] text-stone-400">{vesselTypeLabel(vessel.type, lang)} · {lot?.name || (ka ? 'თავისუფალი' : 'unassigned')}</span>
                    <span className="mt-1 block text-[10px] font-bold text-stone-500">{vessel.currentVolume.toLocaleString()} / {vessel.capacity.toLocaleString()} L · {fill}% · {vessel.temperature}°C</span>
                  </span>
                  <ChevronRight className={`h-4 w-4 shrink-0 ${selected ? 'text-[#651522]' : 'text-stone-300'}`} />
                </button>
              );
            })}
            {((mode === 'lots' && filteredLots.length === 0) || (mode === 'vessels' && filteredVessels.length === 0)) && (
              <div className="p-8 text-center text-xs text-stone-400">{ka ? 'შესაბამისი ჩანაწერი ვერ მოიძებნა.' : 'No matching records found.'}</div>
            )}
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {mode === 'lots' && selectedLot ? (
            <>
              <WineLotsTrace
                {...lotProps}
                lang={lang}
                lots={lots}
                vessels={vessels}
                fermLogs={fermLogs}
                labLogs={labLogs}
                bottlingRuns={bottlingRuns}
                setActiveTab={setActiveTab}
                setLabLotId={setLabLotId}
                setToastMessage={setToastMessage}
                embedded
                compact
                focusedLotId={selectedLot.id}
                onFocusedLotIdChange={setSelectedLotId}
                onLogOperation={onLogOperation}
                onPlanTransfer={onPlanTransfer}
                onLocateOnWineryPlan={onLocateOnWineryPlan}
              />
              <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
                <ContextTabs lang={lang} value={contextTab} onChange={setContextTab} />
                <div className="p-4">{renderLotContext(selectedLot)}</div>
              </section>
            </>
          ) : mode === 'vessels' && selectedVessel && showQvevriRecords && selectedVessel.type === 'qvevri' && renderQvevriRecords ? (
            <section className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
              {renderQvevriRecords(() => setShowQvevriRecords(false), selectedVessel.id)}
            </section>
          ) : mode === 'vessels' && selectedVessel && selectedVesselSignal ? (
            <>
              <section className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <div className="border-t-4 border-[#651522] p-5 lg:p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="brand">{selectedVessel.id}</StatusBadge>
                        <StatusBadge tone={selectedVessel.currentVolume === 0 ? 'neutral' : 'info'}>{vesselTypeLabel(selectedVessel.type, lang)}</StatusBadge>
                        <StatusBadge tone={selectedVessel.cleaningStatus === 'clean' ? 'success' : 'warning'}>{selectedVessel.cleaningStatus === 'clean' ? (ka ? 'სუფთა' : 'Clean') : (ka ? 'სანიტარია' : 'Sanitation')}</StatusBadge>
                      </div>
                      <h2 className="mt-2 text-2xl font-serif font-black text-stone-950 dark:text-amber-100">{selectedVesselLot?.name || (ka ? 'თავისუფალი ჭურჭელი' : 'Available vessel')}</h2>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500"><MapPin className="h-3.5 w-3.5" />{selectedVessel.locationDetails || selectedVessel.maraniLocation || (ka ? 'მდებარეობა არ არის მითითებული' : 'Location not recorded')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedVesselLot && canViewLots && <button type="button" onClick={() => openLot(selectedVesselLot.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-[11px] font-black text-stone-700 hover:border-[#651522]/30 hover:text-[#651522] dark:border-stone-800 dark:text-stone-200"><Wine className="h-4 w-4" />{ka ? 'პარტიის გახსნა' : 'Open lot'}</button>}
                      {selectedVessel.type === 'qvevri' && renderQvevriRecords && <button type="button" onClick={() => setShowQvevriRecords(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-[11px] font-black text-stone-700 hover:border-[#651522]/30 hover:text-[#651522] dark:border-stone-800 dark:text-stone-200"><FileText className="h-4 w-4" />{ka ? 'ქვევრის ჩანაწერი' : 'Qvevri record'}</button>}
                      {onOpenVesselDetails && <button type="button" onClick={() => onOpenVesselDetails(selectedVessel.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-[11px] font-black text-stone-700 hover:border-[#651522]/30 hover:text-[#651522] dark:border-stone-800 dark:text-stone-200"><FileText className="h-4 w-4" />{ka ? 'ტექნიკური დეტალები' : 'Technical details'}</button>}
                    </div>
                  </div>

                  <div className={`mt-5 rounded-2xl border p-4 ${toneClasses(selectedVesselSignal.tone)}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <span className="text-[9px] font-mono font-black uppercase tracking-widest opacity-70">{ka ? 'მიმდინარე მდგომარეობა' : 'Current condition'}</span>
                        <h3 className="mt-1 text-sm font-black">{selectedVesselSignal.label}</h3>
                        <p className="mt-1 text-[11px] opacity-80">{selectedVesselSignal.description}</p>
                      </div>
                      {onLogOperation && canUpdateVessel && (selectedVesselLot || selectedVesselSignal.operationType === 'cleaning') && (
                        <button type="button" onClick={() => onLogOperation(selectedVessel.id, selectedVesselSignal.operationType)} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-[#651522] px-4 text-xs font-black text-white hover:bg-[#7a1c2b]"><Wrench className="h-4 w-4" />{selectedVesselSignal.operationType === 'cleaning' ? (ka ? 'სანიტარიის ჩაწერა' : 'Record sanitation') : (ka ? 'ოპერაციის ჩაწერა' : 'Record operation')}</button>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <Metric label={ka ? 'მოცულობა' : 'Volume'} value={`${selectedVessel.currentVolume.toLocaleString()} L`} hint={`${selectedVessel.capacity.toLocaleString()} L ${ka ? 'ტევადობა' : 'capacity'}`} icon={Droplets} />
                    <Metric label={ka ? 'შევსება' : 'Fill'} value={`${selectedVessel.capacity > 0 ? Math.round((selectedVessel.currentVolume / selectedVessel.capacity) * 100) : 0}%`} hint={`${Math.max(0, selectedVessel.capacity - selectedVessel.currentVolume).toLocaleString()} L ${ka ? 'თავისუფალი' : 'free'}`} icon={CircleGauge} />
                    <Metric label={ka ? 'ტემპერატურა' : 'Temperature'} value={`${selectedVessel.temperature}°C`} hint={selectedVessel.targetTemperature == null ? (ka ? 'setpoint არ არის ჩაწერილი' : 'no recorded setpoint') : `${ka ? 'ჩაწერილი setpoint' : 'recorded setpoint'} ${selectedVessel.targetTemperature}°C`} icon={Thermometer} />
                    <Metric label={ka ? 'პარტია' : 'Lot'} value={selectedVesselLot?.id || '—'} hint={selectedVesselLot ? stageLabel(selectedVesselLot.stage, lang) : (ka ? 'არ არის მიბმული' : 'unassigned')} icon={Wine} />
                  </div>

                  <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950/30">
                    <h3 className="text-xs font-black text-stone-700 dark:text-stone-200">{ka ? 'სწრაფი მოქმედებები' : 'Quick actions'}</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {onLogOperation && selectedVesselLot && <QuickAction icon={Wrench} onClick={() => onLogOperation(selectedVessel.id)}>{ka ? 'ოპერაცია' : 'Operation'}</QuickAction>}
                      {canExecuteTransfer && (onPlanTransfer || setActiveTab) && <QuickAction icon={ArrowLeftRight} onClick={() => onPlanTransfer ? onPlanTransfer(selectedVessel.id, selectedVessel.currentVolume > 0 ? 'source' : 'destination') : setActiveTab?.('transfers')}>{selectedVessel.currentVolume > 0 ? (ka ? 'გადატანა' : 'Transfer') : (ka ? 'ღვინის მიღება' : 'Receive transfer')}</QuickAction>}
                      {selectedVesselLot && setActiveTab && <QuickAction icon={FlaskConical} onClick={() => { setLabLotId?.(selectedVesselLot.id); setActiveTab('labs'); }}>{ka ? 'ლაბორატორია' : 'Lab'}</QuickAction>}
                      {selectedVesselLot?.stage === 'filtration' && setActiveTab && <QuickAction icon={Package} onClick={() => setActiveTab('bottling')}>{ka ? 'ჩამოსხმა' : 'Bottling'}</QuickAction>}
                    </div>
                  </div>
                </div>
              </section>
              <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
                <ContextTabs lang={lang} value={contextTab} onChange={setContextTab} />
                <div className="p-4">{renderVesselContext(selectedVessel)}</div>
              </section>
            </>
          ) : (
            <EmptyPanel>{ka ? 'აირჩიეთ ჩანაწერი სამუშაოდ.' : 'Select a record to begin.'}</EmptyPanel>
          )}
        </main>
      </div>
      )}

      {showAddVessel && canCreateVessel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/50 p-4" onMouseDown={() => setShowAddVessel(false)}>
          <form role="dialog" aria-modal="true" aria-label={ka ? 'ჭურჭლის დამატება' : 'Add vessel'} onSubmit={addVessel} onMouseDown={event => event.stopPropagation()} className="w-full max-w-xl space-y-4 rounded-2xl bg-white p-5 shadow-2xl dark:bg-stone-900">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-serif font-black text-stone-900 dark:text-amber-100">{ka ? 'ახალი ჭურჭელი' : 'New vessel'}</h2><p className="mt-1 text-xs text-stone-400">{ka ? 'მხოლოდ რეესტრის ძირითადი ტექნიკური მონაცემები.' : 'Only the essential technical register data.'}</p></div>
              <button type="button" onClick={() => setShowAddVessel(false)} aria-label={ka ? 'დახურვა' : 'Close'} className="rounded-lg p-2 text-stone-400 hover:bg-stone-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={ka ? 'ჭურჭლის ID' : 'Vessel ID'}><input required value={newVesselId} onChange={event => setNewVesselId(event.target.value)} placeholder="TK-01" className="min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 text-xs outline-none focus:border-[#651522]/40 dark:border-stone-800 dark:bg-stone-950" /></Field>
              <Field label={ka ? 'ტიპი' : 'Type'}><select value={newVesselType} onChange={event => setNewVesselType(event.target.value as VesselType)} className="min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 text-xs outline-none dark:border-stone-800 dark:bg-stone-950"><option value="stainless_steel">{ka ? 'უჟანგავი ფოლადი' : 'Stainless steel'}</option><option value="qvevri">{ka ? 'ქვევრი' : 'Qvevri'}</option><option value="barrel">{ka ? 'კასრი' : 'Barrel'}</option><option value="concrete">{ka ? 'ბეტონი' : 'Concrete'}</option><option value="plastic">{ka ? 'პლასტიკი' : 'Plastic'}</option><option value="other">{ka ? 'სხვა' : 'Other'}</option></select></Field>
              <Field label={ka ? 'ტევადობა (ლ)' : 'Capacity (L)'}><input required type="number" min="1" value={newVesselCapacity} onChange={event => setNewVesselCapacity(event.target.value)} className="min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 text-xs outline-none focus:border-[#651522]/40 dark:border-stone-800 dark:bg-stone-950" /></Field>
              <Field label={ka ? 'მდებარეობა' : 'Location'}><input value={newVesselLocation} onChange={event => setNewVesselLocation(event.target.value)} placeholder={ka ? 'მთავარი მარანი' : 'Main cellar'} className="min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 text-xs outline-none focus:border-[#651522]/40 dark:border-stone-800 dark:bg-stone-950" /></Field>
            </div>
            {addVesselError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">{addVesselError}</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowAddVessel(false)} className="min-h-10 rounded-xl px-4 text-xs font-bold text-stone-500 hover:bg-stone-100">{ka ? 'გაუქმება' : 'Cancel'}</button><button type="submit" className="min-h-10 rounded-xl bg-[#651522] px-4 text-xs font-black text-white hover:bg-[#7a1c2b]">{ka ? 'დამატება' : 'Add vessel'}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: React.ComponentType<{ className?: string }> }) {
  return <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-950/40"><span className="flex items-center gap-1.5 text-[9px] font-mono font-black uppercase tracking-widest text-stone-400"><Icon className="h-3.5 w-3.5" />{label}</span><strong className="mt-1.5 block text-lg font-serif font-black text-stone-900 dark:text-amber-100">{value}</strong><span className="mt-0.5 block text-[10px] text-stone-400">{hint}</span></div>;
}

function QuickAction({ icon: Icon, onClick, children }: { icon: React.ComponentType<{ className?: string }>; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-[11px] font-black text-stone-700 hover:border-[#651522]/30 hover:text-[#651522] dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200"><Icon className="h-4 w-4" />{children}</button>;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-950/40"><span className="block text-[9px] font-mono font-black uppercase tracking-wider text-stone-400">{label}</span><strong className="mt-1 block break-words text-xs text-stone-800 dark:text-stone-100">{value}</strong></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="mb-1 block text-[10px] font-bold text-stone-500">{label}</span>{children}</label>;
}

function AnalysisCard({ lang, lab }: { lang: Language; lab?: LabAnalysis }) {
  const ka = lang === 'ka';
  if (!lab) return <EmptyPanel>{ka ? 'ლაბორატორიული ანალიზი ჯერ არ არის.' : 'No laboratory analysis yet.'}</EmptyPanel>;
  return <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className="flex items-center justify-between"><strong className="text-xs text-stone-800 dark:text-stone-100">{ka ? 'ბოლო ლაბორატორია' : 'Latest laboratory panel'}</strong><span className="text-[10px] font-mono text-stone-400">{lab.date}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><DetailItem label="pH" value={String(lab.ph)} /><DetailItem label={ka ? 'თავისუფალი SO₂' : 'Free SO₂'} value={`${lab.freeSo2} mg/L`} /><DetailItem label={ka ? 'მჟავიანობა' : 'TA'} value={`${lab.titratableAcidity} g/L`} /><DetailItem label={ka ? 'ნარჩენი შაქარი' : 'Residual sugar'} value={`${lab.residualSugar} g/L`} /></div></div>;
}

function FermentationCard({ lang, reading }: { lang: Language; reading?: DailyFermLog }) {
  const ka = lang === 'ka';
  if (!reading) return <EmptyPanel>{ka ? 'დუღილის გაზომვა ჯერ არ არის.' : 'No fermentation reading yet.'}</EmptyPanel>;
  return <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className="flex items-center justify-between"><strong className="text-xs text-stone-800 dark:text-stone-100">{ka ? 'ბოლო ფიზიკური გაზომვა' : 'Latest physical reading'}</strong><span className="text-[10px] font-mono text-stone-400">{reading.date}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><DetailItem label={ka ? 'ტემპერატურა' : 'Temperature'} value={`${reading.temperature}°C`} /><DetailItem label={ka ? 'სიმკვრივე' : 'Density'} value={String(reading.density)} /><DetailItem label={ka ? 'შაქარი' : 'Sugar'} value={`${reading.sugar} g/L`} /><DetailItem label="pH" value={String(reading.ph)} /></div></div>;
}
