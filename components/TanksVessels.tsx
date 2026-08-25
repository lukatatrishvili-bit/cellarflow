'use client';

import React, { useRef, useState } from 'react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import type { Vessel, VesselType, WineLot } from '../lib/wineryState';
import { vesselTypeLabel } from '../lib/enumLabels';
import {
  ShieldAlert, CheckCircle, Snowflake, RotateCw, Plus, Trash2, Edit,
  Search, LayoutGrid, List, Database, Droplets, Thermometer, ShieldCheck,
  Container as ContainerIcon, FileText, AlertTriangle, ArrowRight,
  ChevronDown, ChevronUp, CircleGauge, MoveRight
} from 'lucide-react';
import TankCapacityChart, { ChartTankData } from './TankCapacityChart';
import VesselFill from './VesselFill';
import { Stagger, StaggerItem } from './motion';
import { useToast } from './ToastProvider';
import { PageHeader } from './ui/primitives';

interface Props {
  lang: Language;
  vessels: Vessel[];
  lots: WineLot[];
  onUpdateVessels: (newVessels: Vessel[]) => void;
  onSelectTank?: (tankId: string) => void;
  selectedTankId?: string | null;
  setActiveTab?: (tab: string) => void;
  wineryName?: string;
  canCreateVessel?: boolean;
  canUpdateVessel?: boolean;
  canDeleteVessel?: boolean;
  canExecuteTransfer?: boolean;
  currentUserName?: string;
  qvevriCount?: number;
  renderQvevriRecords?: (onBackToVessels: () => void, focusedVesselId?: string | null) => React.ReactNode;
}

type VesselStatusFilter = 'all' | 'attention' | 'ready' | 'empty' | 'occupied' | 'dirty' | 'cooling';
type VesselSignalKind = 'assignment' | 'fill' | 'headspace' | 'hygiene' | 'seal' | 'temperature';

function qvevriSealNeedsAttention(vessel: Vessel, now = Date.now()): boolean {
  if (vessel.type !== 'qvevri') return false;
  if (vessel.limeWashStatus === 'needed') return true;
  const sealedAt = vessel.lastSealedDate || vessel.sealingDate;
  if (!sealedAt) return false;
  const sealedTimestamp = new Date(sealedAt).getTime();
  if (!Number.isFinite(sealedTimestamp)) return false;
  return (now - sealedTimestamp) / 86_400_000 > 120;
}

export function TanksVessels({
  lang, vessels, lots, onUpdateVessels, onSelectTank, selectedTankId,
  setActiveTab,
  canCreateVessel = true, canUpdateVessel = true, canDeleteVessel = true, canExecuteTransfer = true,
  currentUserName = 'Current cellar operator',
  renderQvevriRecords,
}: Props) {
  const t = translations[lang];
  const ka = lang === 'ka';
  const { success, error, info } = useToast();
  const lText = (
    obj: Partial<Record<'en' | 'ka' | 'it' | 'fr' | 'de', string>>,
    fallback: string,
  ): string => {
    return obj[lang] || fallback;
  };

  const [filterType, setFilterType] = useState<string>('all');

  // Custom view modes and search states for intuitive navigation
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<VesselStatusFilter>('all');
  const [workspaceView, setWorkspaceView] = useState<'register' | 'qvevri'>('register');
  const [qvevriFocusId, setQvevriFocusId] = useState<string | null>(null);
  const [showCapacityChart, setShowCapacityChart] = useState(false);
  const vesselRegisterRef = useRef<HTMLDivElement>(null);

  // Custom add vessel state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newId, setNewId] = useState('');
  const [newType, setNewType] = useState<VesselType>('stainless_steel');
  const [newCapacity, setNewCapacity] = useState('2000');
  const [newLocation, setNewLocation] = useState('');

  // Editing temperature state
  const [editingTempId, setEditingTempId] = useState<string | null>(null);
  const [tempInputValue, setTempInputValue] = useState<number>(15);

  const openVessel = (vessel: Vessel) => {
    if (vessel.type === 'qvevri' && renderQvevriRecords) {
      setQvevriFocusId(vessel.id);
      setWorkspaceView('qvevri');
      return;
    }
    onSelectTank?.(vessel.id);
  };

  const applyStatusFilter = (nextFilter: VesselStatusFilter) => {
    setWorkspaceView('register');
    setFilterType('all');
    setSearchTerm('');
    setStatusFilter(current => current === nextFilter ? 'all' : nextFilter);
    window.requestAnimationFrame(() => vesselRegisterRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleClean = (vId: string) => {
    if (!canUpdateVessel) return;
    const target = vessels.find(vessel => vessel.id === vId);
    if (!target || target.currentVolume > 0 || target.assignedLotId || target.type === 'qvevri') {
      error(ka
        ? 'სანიტარია შეიძლება დადასტურდეს მხოლოდ ცარიელ, პარტიისგან თავისუფალ ჩვეულებრივ ჭურჭელზე. ქვევრის მოვლა აღრიცხეთ ქვევრის ჩანაწერში.'
        : 'Sanitation can only be confirmed for an empty, unassigned standard vessel. Record qvevri care in its dedicated record.');
      return;
    }
    const date = new Date().toISOString().split('T')[0];
    const updated = vessels.map(v => {
      if (v.id === vId) {
        return {
          ...v,
          cleaningStatus: 'clean' as const,
          lastCleaned: date,
          lastOperation: `Sanitized by ${currentUserName}`,
          sanitationHistory: [
            ...(v.sanitationHistory || []),
            { date, action: 'Wash and sanitation completed', operator: currentUserName },
          ],
        };
      }
      return v;
    });
    onUpdateVessels(updated);
    success(ka ? `ჭურჭელი ${vId} წარმატებით გაირეცხა და დასუფთავდა` : `Vessel ${vId} sanitized successfully`);
  };

  const handleToggleCooling = (vId: string) => {
    if (!canUpdateVessel) return;
    let stateActive = false;
    const updated = vessels.map(v => {
      if (v.id === vId) {
        stateActive = !v.coolingJacketActive;
        return {
          ...v,
          coolingJacketActive: !v.coolingJacketActive,
          lastOperation: !v.coolingJacketActive ? 'Activated Cooling Jacket' : 'Deactivated Cooling'
        };
      }
      return v;
    });
    onUpdateVessels(updated);
    if (stateActive) {
      success(ka ? `პერანგის გაგრილება ჩაირთო ჭურჭლისთვის: ${vId}` : `Active cooling enabled for ${vId}`);
    } else {
      info(ka ? `პერანგის გაგრილება გამოირთო ჭურჭლისთვის: ${vId}` : `Active cooling disabled for ${vId}`);
    }
  };

  const handleSaveTemp = (vId: string) => {
    if (!canUpdateVessel) return;
    const updated = vessels.map(v => {
      if (v.id === vId) {
        return {
          ...v,
          temperature: tempInputValue,
          lastOperation: `Adjusted temperature to ${tempInputValue}°C`
        };
      }
      return v;
    });
    onUpdateVessels(updated);
    setEditingTempId(null);
    success(ka ? `ტემპერატურა შეიცვალა: ${tempInputValue}°C` : `Target temperature set to ${tempInputValue}°C`);
  };

  const handleDeleteVessel = (vId: string) => {
    if (!canDeleteVessel) return;
    const vessel = vessels.find(v => v.id === vId);
    if (!vessel) return;
    if (vessel.currentVolume > 0 || vessel.assignedLotId) {
      error(ka
        ? `ჭურჭელი ${vId} ჯერ უნდა დაიცალოს და პარტიას მოშორდეს.`
        : `Empty ${vId} and remove its lot assignment before decommissioning.`);
      return;
    }
    const confirmed = window.confirm(ka
      ? `ნამდვილად გსურთ ${vId}-ის ექსპლუატაციიდან ამოღება?`
      : `Decommission ${vId}? This removes it from the active cellar register.`);
    if (!confirmed) return;
    const filtered = vessels.filter(v => v.id !== vId);
    onUpdateVessels(filtered);
    info(ka ? `ჭურჭელი ${vId} ამოღებულია ექსპლუატაციიდან` : `Vessel ${vId} decommissioned`);
  };

  const handleAddVessel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateVessel) return;
    const vesselId = newId.trim();
    if (!vesselId) {
      error(ka ? 'შეიყვანეთ ჭურჭლის ID.' : 'Enter a vessel ID.');
      return;
    }
    if (vessels.some(vessel => vessel.id.toLocaleLowerCase() === vesselId.toLocaleLowerCase())) {
      error(ka ? `ჭურჭელი ${vesselId} უკვე არსებობს.` : `Vessel ${vesselId} already exists.`);
      return;
    }
    const parsedCapacity = Number(newCapacity);
    if (!Number.isFinite(parsedCapacity) || parsedCapacity <= 0) {
      error(ka ? 'ტევადობა უნდა იყოს ნულზე მეტი.' : 'Capacity must be greater than zero.');
      return;
    }

    const newVessel: Vessel = {
      id: vesselId,
      type: newType,
      shape: newType === 'barrel' ? 'horizontal' : 'vertical',
      capacity: parsedCapacity,
      currentVolume: 0,
      assignedLotId: null,
      cleaningStatus: 'clean',
      lastCleaned: new Date().toISOString().split('T')[0],
      temperature: 15.0,
      coolingJacketActive: false,
      targetTemperature: null,
      lastOperation: 'Vessel commissioned',
      locationDetails: newLocation || 'Main Cellar Hall'
    };

    onUpdateVessels([...vessels, newVessel]);
    const addedId = vesselId;
    setNewId('');
    setNewLocation('');
    setShowAddForm(false);
    success(ka ? `ახალი ჭურჭელი ${addedId} წარმატებით დაემატა` : `New vessel ${addedId} commissioned successfully`);
  };

  const vesselSignalKind = (vessel: Vessel): VesselSignalKind | null => {
    const assignedLot = lots.find(lot => lot.id === vessel.assignedLotId);
    const fill = vessel.capacity > 0 ? (vessel.currentVolume / vessel.capacity) * 100 : 0;
    if ((vessel.currentVolume > 0 && !vessel.assignedLotId) || (vessel.currentVolume === 0 && vessel.assignedLotId)) {
      return 'assignment';
    }
    if (fill > 100 || (assignedLot?.stage === 'fermenting' && fill >= 90)) return 'fill';
    if (assignedLot && ['aging', 'stabilization', 'filtration'].includes(assignedLot.stage)
      && vessel.currentVolume > 0 && fill < (vessel.type === 'barrel' ? 95 : 85)) {
      return 'headspace';
    }
    if (vessel.cleaningStatus !== 'clean') return 'hygiene';
    if (qvevriSealNeedsAttention(vessel)) return 'seal';
    if (assignedLot?.stage === 'fermenting' && (!Number.isFinite(vessel.temperature) || vessel.temperature < 8 || vessel.temperature > 30)) {
      return 'temperature';
    }
    return null;
  };

  const signalCopy = (vessel: Vessel, kind: VesselSignalKind) => {
    const assignedLot = lots.find(lot => lot.id === vessel.assignedLotId);
    const fill = vessel.capacity > 0 ? Math.round((vessel.currentVolume / vessel.capacity) * 100) : 0;
    const copy = {
      assignment: {
        title: ka ? 'პარტიის კავშირი შესამოწმებელია' : 'Lot assignment needs review',
        detail: ka ? 'მოცულობა და მიბმული პარტია ერთმანეთს არ ემთხვევა.' : 'Volume and lot assignment are out of sync.',
        action: ka ? 'ჭურჭლის გახსნა' : 'Open vessel',
      },
      fill: {
        title: ka ? `დუღილის ჭურჭელი ${fill}%-ითაა შევსებული` : `Fermenter is ${fill}% full`,
        detail: ka ? 'დუღილისთვის დატოვებული სივრცე შეიძლება არასაკმარისი იყოს. შეამოწმეთ ქაფი და წნევა.' : 'Fermentation headroom may be insufficient. Check foam expansion and pressure.',
        action: ka ? 'შევსების ნახვა' : 'Review fill',
      },
      headspace: {
        title: ka ? `თავისუფალი სივრცე ${100 - fill}%` : `${100 - fill}% headspace`,
        detail: ka ? 'დაძველებისას შეამოწმეთ შევსება, ინერტული გაზი ან დალუქვა ჟანგბადის რისკის შესამცირებლად.' : 'During aging, confirm topping, inert-gas cover, or sealing to limit oxygen exposure.',
        action: ka ? 'ჭურჭლის შემოწმება' : 'Review vessel',
      },
      hygiene: {
        title: ka ? 'სანიტაცია საჭიროა' : 'Sanitation required',
        detail: ka ? 'ჭურჭელი წარმოებაში დაბრუნებამდე უნდა გაირეცხოს.' : 'Wash before returning this vessel to production.',
        action: ka ? 'ჭურჭლის გახსნა' : 'Open vessel',
      },
      seal: {
        title: ka ? 'ქვევრის მოვლა შესამოწმებელია' : 'Qvevri care check due',
        detail: ka ? 'კირით დამუშავების ან დალუქვის ჩანაწერს განახლება სჭირდება.' : 'Lime-wash or sealing evidence needs attention.',
        action: ka ? 'ქვევრის ჩანაწერი' : 'Open qvevri record',
      },
      temperature: {
        title: ka ? 'დუღილის ტემპერატურა საეჭვოა' : 'Fermentation temperature risk',
        detail: assignedLot
          ? (ka ? `${assignedLot.name}: ${vessel.temperature}°C` : `${assignedLot.name}: ${vessel.temperature}°C`)
          : `${vessel.temperature}°C`,
        action: ka ? 'ტემპერატურის ნახვა' : 'Review temperature',
      },
    } satisfies Record<VesselSignalKind, { title: string; detail: string; action: string }>;
    return copy[kind];
  };

  const attentionVessels = vessels
    .map(vessel => ({ vessel, kind: vesselSignalKind(vessel) }))
    .filter((item): item is { vessel: Vessel; kind: VesselSignalKind } => Boolean(item.kind))
    .sort((a, b) => {
      const priority: Record<VesselSignalKind, number> = { assignment: 0, fill: 1, temperature: 2, headspace: 3, hygiene: 4, seal: 5 };
      return priority[a.kind] - priority[b.kind];
    });
  const readyVessels = vessels.filter(vessel =>
    vessel.currentVolume === 0 &&
    !vessel.assignedLotId &&
    vessel.cleaningStatus === 'clean' &&
    !qvevriSealNeedsAttention(vessel)
  );
  const readyCapacity = readyVessels.reduce((sum, vessel) => sum + vessel.capacity, 0);

  // Improved reactive filtering system with multi-criteria support
  const filteredVessels = vessels.filter(v => {
    // 1. Filter by Material/Type
    if (filterType !== 'all' && v.type !== filterType) return false;

    // 2. Filter by Status filter
    if (statusFilter === 'attention' && !vesselSignalKind(v)) return false;
    if (statusFilter === 'ready' && !readyVessels.some(vessel => vessel.id === v.id)) return false;
    if (statusFilter === 'empty' && v.currentVolume > 0) return false;
    if (statusFilter === 'occupied' && (!v.assignedLotId || v.currentVolume === 0)) return false;
    if (statusFilter === 'dirty' && v.cleaningStatus === 'clean') return false;
    if (statusFilter === 'cooling' && !v.coolingJacketActive) return false;

    // 3. Search input matches vessel ID, location, or assigned wine description
    if (searchTerm.trim() !== '') {
      const query = searchTerm.toLowerCase();
      const matchesId = v.id.toLowerCase().includes(query);
      const matchesLocation = v.locationDetails ? v.locationDetails.toLowerCase().includes(query) : false;
      const assignedLot = lots.find(l => l.id === v.assignedLotId);
      const matchesLotName = assignedLot ? assignedLot.name.toLowerCase().includes(query) : false;
      const matchesLotVariety = assignedLot ? assignedLot.variety.toLowerCase().includes(query) : false;
      if (!matchesId && !matchesLocation && !matchesLotName && !matchesLotVariety) return false;
    }

    return true;
  });

  // Calculate high-fidelity health diagnostics
  const totalVolume = vessels.reduce((sum, v) => sum + v.currentVolume, 0);
  const totalCapacity = vessels.reduce((sum, v) => sum + v.capacity, 0);
  const totalUtilization = totalCapacity > 0 ? (totalVolume / totalCapacity) * 100 : 0;
  const coolingActiveCount = vessels.filter(v => v.coolingJacketActive).length;
  const dirtyCount = vessels.filter(v => v.cleaningStatus !== 'clean').length;

  const mappedTanks: ChartTankData[] = vessels.map(v => ({
    id: v.id,
    name: v.id,
    capacity: v.capacity,
    currentVolume: v.currentVolume,
    status: v.assignedLotId
      ? (lots.find(l => l.id === v.assignedLotId)?.stage === 'fermenting' ? 'fermenting' : 'occupied')
      : (v.cleaningStatus === 'dirty' ? 'cleaning' : 'empty')
  }));
  const missingVesselActions = [
    !canCreateVessel ? (ka ? 'ჭურჭლის დამატება' : 'commission vessels') : '',
    !canUpdateVessel ? (ka ? 'ოპერაციებისა და განლაგების შეცვლა' : 'change vessel operations or layout') : '',
    !canDeleteVessel ? (ka ? 'ჭურჭლის ექსპლუატაციიდან ამოღება' : 'decommission vessels') : '',
  ].filter(Boolean);
  const missingVesselActionsText = ka || missingVesselActions.length < 2
    ? missingVesselActions.join(', ')
    : `${missingVesselActions.slice(0, -1).join(', ')} or ${missingVesselActions.at(-1)}`;
  const workspaceHeader = (
    <PageHeader
      eyebrow={ka ? 'მარნის კონტროლი' : 'Cellar control'}
      title={ka ? 'ჭურჭლის მართვის ცენტრი' : 'Vessel command center'}
      icon={ContainerIcon}
    />
  );

  if (workspaceView === 'qvevri' && renderQvevriRecords) {
    return (
      <div className="space-y-4">
        {workspaceHeader}
        {renderQvevriRecords(() => setWorkspaceView('register'), qvevriFocusId)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {workspaceHeader}

      {vessels.length > 0 && (
        <>
          <section className="overflow-hidden rounded-2xl border border-[#e8dfd5] bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <div className="p-4 lg:p-5">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                <div className="max-w-2xl">
                  <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                    <span className={`h-2 w-2 rounded-full ${attentionVessels.length ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                    {ka ? 'მეღვინის დღიური ხედვა' : 'Winemaker briefing'}
                  </span>
                  <h3 className="mt-3 max-w-xl text-xl font-black leading-tight tracking-tight text-stone-900 dark:text-stone-100 lg:text-2xl">
                    {attentionVessels.length
                      ? (ka
                          ? `${attentionVessels.length} გადაწყვეტილება შემდეგ მოძრაობამდე`
                          : `${attentionVessels.length} ${attentionVessels.length === 1 ? 'decision' : 'decisions'} before the next movement`)
                      : (ka ? 'მარანი მზადაა შემდეგი მოძრაობისთვის' : 'The cellar is ready for its next movement')}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canExecuteTransfer && setActiveTab && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('transfers')}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-2 text-xs font-black text-[#4e0e15] transition hover:border-stone-300 hover:bg-white dark:border-stone-700 dark:bg-stone-800 dark:text-amber-100"
                    >
                      <MoveRight className="h-4 w-4" />
                      {ka ? 'გადატანის დაგეგმვა' : 'Plan a transfer'}
                    </button>
                  )}
                  {canCreateVessel && (
                    <button
                      type="button"
                      onClick={() => setShowAddForm(true)}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#4e0e15] px-4 py-2 text-xs font-black text-white transition hover:bg-[#6b151e]"
                    >
                      <Plus className="h-4 w-4" />
                      {ka ? 'ჭურჭლის დამატება' : 'Add vessel'}
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  aria-pressed={statusFilter === 'attention'}
                  onClick={() => applyStatusFilter('attention')}
                  className={`rounded-2xl border p-3 text-left transition lg:p-4 ${
                    statusFilter === 'attention'
                      ? 'border-amber-300 bg-amber-100 text-[#4e0e15]'
                      : 'border-stone-200 bg-stone-50 text-stone-700 hover:border-amber-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200'
                  }`}
                >
                  <span className="flex items-center justify-between text-[10px] font-black uppercase tracking-wide opacity-75">
                    {ka ? 'ყურადღება' : 'Needs action'}
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <strong className="mt-2 block text-2xl font-black">{attentionVessels.length}</strong>
                  <span className="mt-1 block text-[10px] font-semibold opacity-70">{ka ? 'პრიორიტეტული ჭურჭელი' : 'priority vessels'}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={statusFilter === 'ready'}
                  onClick={() => applyStatusFilter('ready')}
                  className={`rounded-2xl border p-3 text-left transition lg:p-4 ${
                    statusFilter === 'ready'
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-950'
                      : 'border-stone-200 bg-stone-50 text-stone-700 hover:border-emerald-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200'
                  }`}
                >
                  <span className="flex items-center justify-between text-[10px] font-black uppercase tracking-wide opacity-75">
                    {ka ? 'ცარიელი და სუფთაა' : 'Empty and clean'}
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <strong className="mt-2 block text-2xl font-black">{readyCapacity.toLocaleString()} L</strong>
                  <span className="mt-1 block text-[10px] font-semibold opacity-70">{readyVessels.length} {ka ? 'სუფთა ჭურჭელი' : 'clean vessels'}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={statusFilter === 'cooling'}
                  onClick={() => applyStatusFilter('cooling')}
                  className={`rounded-2xl border p-3 text-left transition lg:p-4 ${
                    statusFilter === 'cooling'
                      ? 'border-sky-300 bg-sky-100 text-sky-950'
                      : 'border-stone-200 bg-stone-50 text-stone-700 hover:border-sky-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200'
                  }`}
                >
                  <span className="flex items-center justify-between text-[10px] font-black uppercase tracking-wide opacity-75">
                    {ka ? 'გაგრილება' : 'Cooling live'}
                    <Snowflake className={`h-4 w-4 ${coolingActiveCount ? 'animate-spin' : ''}`} />
                  </span>
                  <strong className="mt-2 block text-2xl font-black">{coolingActiveCount}</strong>
                  <span className="mt-1 block text-[10px] font-semibold opacity-70">{ka ? 'გაგრილება ჩართულია' : 'cooling enabled'}</span>
                </button>
              </div>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.55fr)]">
            <section className="overflow-hidden rounded-2xl border border-[#e8dfd5] bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e8dfd5] px-4 py-4 dark:border-stone-800 lg:px-5">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-black text-stone-900 dark:text-amber-100">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    {ka ? 'მოქმედების რიგი' : 'Action queue'}
                  </h3>
                </div>
                {attentionVessels.length > 4 && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterType('all');
                      setSearchTerm('');
                      setStatusFilter('attention');
                    }}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-[11px] font-black text-[#4e0e15] hover:bg-rose-50 dark:text-amber-200 dark:hover:bg-stone-800"
                  >
                    {ka ? 'ყველას ნახვა' : 'Show all'} <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {attentionVessels.length ? (
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {attentionVessels.slice(0, 4).map(({ vessel, kind }) => {
                    const copy = signalCopy(vessel, kind);
                    const assignedLot = lots.find(lot => lot.id === vessel.assignedLotId);
                    const critical = kind === 'assignment' || kind === 'fill' || kind === 'temperature';
                    return (
                      <button
                        type="button"
                        key={`${vessel.id}-${kind}`}
                        onClick={() => {
                          openVessel(vessel);
                        }}
                        className="group flex min-h-20 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-stone-50 dark:hover:bg-stone-800/70 lg:px-5"
                      >
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                          critical ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                        }`}>
                          {kind === 'hygiene' ? <ShieldAlert className="h-5 w-5" /> : kind === 'seal' ? <FileText className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <strong className="text-xs font-black text-stone-900 dark:text-stone-100">{vessel.id}</strong>
                            {assignedLot && <span className="truncate text-[10px] font-bold text-stone-500">{assignedLot.name}</span>}
                          </span>
                          <span className="mt-0.5 block text-xs font-bold text-stone-700 dark:text-stone-200">{copy.title}</span>
                          <span className="mt-0.5 block text-[10px] font-medium leading-snug text-stone-500 dark:text-stone-400">{copy.detail}</span>
                        </span>
                        <span className="hidden shrink-0 items-center gap-1 text-[10px] font-black text-[#4e0e15] group-hover:underline dark:text-amber-200 sm:inline-flex">
                          {copy.action} <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-40 items-center justify-center px-5 py-8 text-center">
                  <div>
                    <CheckCircle className="mx-auto h-8 w-8 text-emerald-600" />
                    <strong className="mt-2 block text-sm font-black text-stone-800 dark:text-stone-100">{ka ? 'ღია რისკი არ არის' : 'No open vessel risks'}</strong>
                    <span className="mt-1 block text-xs text-stone-500">{ka ? 'ჭურჭლები მზადაა მიმდინარე სამუშაოსთვის.' : 'The register is ready for today’s cellar work.'}</span>
                  </div>
                </div>
              )}
            </section>

            <aside className="rounded-2xl border border-[#e8dfd5] bg-[#faf7f2] p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-[0.14em] text-stone-500">{ka ? 'ტევადობის გეგმა' : 'Capacity plan'}</span>
                  <strong className="mt-2 block text-3xl font-black text-[#4e0e15] dark:text-amber-100">{totalVolume.toLocaleString()} L</strong>
                  <span className="mt-1 block text-[11px] font-semibold text-stone-500">{Math.round(totalUtilization)}% {ka ? 'მარნის ტევადობიდან' : `of ${totalCapacity.toLocaleString()} L cellar capacity`}</span>
                </div>
                <span className="rounded-xl border border-stone-200 bg-white p-2.5 text-[#4e0e15] dark:border-stone-700 dark:bg-stone-800 dark:text-amber-200">
                  <CircleGauge className="h-5 w-5" />
                </span>
              </div>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                <div className="h-full rounded-full bg-[#801323] transition-all duration-500" style={{ width: `${Math.min(100, totalUtilization)}%` }} />
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/40">
                  <dt className="text-[9px] font-black uppercase tracking-wide text-stone-400">{ka ? 'მზადაა ახლა' : 'Ready now'}</dt>
                  <dd className="mt-1 text-lg font-black text-emerald-700 dark:text-emerald-300">{readyCapacity.toLocaleString()} L</dd>
                </div>
                <div className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/40">
                  <dt className="text-[9px] font-black uppercase tracking-wide text-stone-400">{ka ? 'გასარეცხი' : 'Needs wash'}</dt>
                  <dd className={`mt-1 text-lg font-black ${dirtyCount ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{dirtyCount}</dd>
                </div>
              </dl>
              <button
                type="button"
                aria-expanded={showCapacityChart}
                onClick={() => setShowCapacityChart(value => !value)}
                className="mt-4 flex min-h-10 w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-3 text-[11px] font-black text-stone-700 transition hover:border-stone-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
              >
                <span className="flex items-center gap-2"><Droplets className="h-4 w-4 text-[#801323] dark:text-amber-300" />{ka ? 'ტევადობის დიაგრამა' : 'Open capacity chart'}</span>
                {showCapacityChart ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </aside>
          </div>

          {showCapacityChart && (
            <section className="rounded-2xl border border-[#e8dfd5] bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="mb-4">
                <h3 className="text-sm font-black text-stone-900 dark:text-amber-100">{ka ? 'მარნის შევსების დიაგრამა' : 'Cellar fill chart'}</h3>
              </div>
              <TankCapacityChart
                tanks={mappedTanks}
                onSelectTank={tankId => {
                  const vessel = vessels.find(item => item.id === tankId);
                  if (vessel) openVessel(vessel);
                }}
                selectedTankId={selectedTankId}
              />
            </section>
          )}
        </>
      )}

      {(!canCreateVessel || !canUpdateVessel || !canDeleteVessel) && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong className="font-semibold">
            {!canCreateVessel && !canUpdateVessel && !canDeleteVessel
              ? (ka ? 'მხოლოდ ნახვის წვდომა.' : 'Read-only vessel access.')
              : (ka ? 'ჭურჭელზე შეზღუდული წვდომა.' : 'Limited vessel access.')}
          </strong>{' '}
          {!canCreateVessel && !canUpdateVessel && !canDeleteVessel
            ? (ka
                ? 'შეგიძლიათ ნახოთ ტევადობა და მდგომარეობა, მაგრამ ჭურჭლის ჩანაწერებს ვერ შეცვლით.'
                : 'You can review vessel capacity and status, but cannot change vessel records.')
            : (ka
                ? `თქვენი როლი არ გაძლევთ უფლებას: ${missingVesselActionsText}.`
                : `Your role cannot ${missingVesselActionsText}.`)}
        </div>
      )}

      {/* 2. Top advanced command and control panel */}
      <div ref={vesselRegisterRef} className="scroll-mt-4 space-y-4">
        {/* Core Filters Row */}
        <div className="flex flex-col lg:flex-row gap-3 justify-between items-stretch lg:items-center bg-white p-4 border border-[#e8dfd5] rounded-xl shadow-xs">
          {/* Material classification tab filters */}
          <div className="flex flex-wrap gap-1">
            {['all', 'stainless_steel', 'qvevri', 'barrel', 'concrete'].map(type => {
              // Calculate counts of each type inline
              const count = vessels.filter(v => type === 'all' || v.type === type).length;
              return (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium cursor-pointer transition-all flex items-center gap-1 mt-1 ${
                    filterType === type
                      ? 'bg-[#4e0e15] text-white border-[#4e0e15] shadow-xs'
                      : 'bg-[#FCFAF7] text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span>
                    {type === 'all' && (t.all || 'Show All')}
                    {type === 'stainless_steel' && (t.stainless_steel || 'Stainless Steel')}
                    {type === 'qvevri' && (t.qvevri || 'Qvevris')}
                    {type === 'barrel' && (t.barrel || 'Oak Barrels')}
                    {type === 'concrete' && (t.concrete || 'Concrete')}
                  </span>
                  <span className={`text-[9px] px-1 rounded-full ${
                    filterType === type
                      ? 'bg-white/25 text-white'
                      : 'bg-slate-200/60 text-slate-500'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action trigger button */}
          {canCreateVessel && (
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="inline-flex items-center justify-center gap-1 px-3.5 py-1.5 bg-[#4e0e15] hover:bg-[#6b151e] cursor-pointer text-white font-semibold text-xs rounded-lg transition-colors shadow-sm h-9"
            >
              <Plus className="w-3.5 h-3.5" />
              {({
                en: 'Commission Vessel',
                ka: 'ჭურჭლის დამატება',
                it: 'Commissiona Recipiente',
                fr: 'Commissionner une Cuve',
                de: 'Behälter in Betrieb nehmen'
              })[lang] || 'Commission Vessel'}
            </button>
          )}
        </div>

        {/* Sub search parameters line */}
        <div className="flex flex-col md:flex-row gap-3 justify-between items-center bg-[#FAF8F5]/80 p-3 border border-[#f0e6da] rounded-xl">
          {/* Search bar with lens icon */}
          <div className="relative w-full md:w-80">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder={({
                en: "Search vessels, locations or wine lots...",
                ka: "მოძებნე ჭურჭელი, მდებარეობა ან პარტია...",
                it: "Cerca recipienti, ubicazioni o lotti...",
                fr: "Rechercher cuves, emplacements ou lots...",
                de: "Suche nach Behältern, Standorten oder Chargen..."
              })[lang] || "Search vessels, locations or wine lots..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-[#4e0e15] text-stone-800 shadow-3xs"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-2 text-xs text-slate-400 hover:text-stone-700 font-bold"
              >
                ×
              </button>
            )}
          </div>

          {/* Additional status filter filters & View toggler */}
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-between md:justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                {({ en: 'Filter:', ka: 'ფილტრი:', it: 'Stato:', fr: 'Statut :', de: 'Filter:' })[lang] || 'Filter:'}
              </span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as VesselStatusFilter)}
                className="bg-white border border-slate-200 text-xs px-2.5 py-1.5 rounded-lg outline-none text-stone-700 cursor-pointer focus:border-[#4e0e15]"
              >
                <option value="all">{({ en: 'All Statuses', ka: 'ყველა სტატუსი', it: 'Tutti gli Stati', fr: 'Tous les Statuts', de: 'Alle Status' })[lang] || 'All Statuses'}</option>
                <option value="attention">{ka ? 'საჭიროებს ყურადღებას' : 'Needs Action'}</option>
                <option value="ready">{ka ? 'ცარიელი და სუფთაა' : 'Empty & Clean'}</option>
                <option value="empty">{({ en: 'All Empty', ka: 'ყველა ცარიელი', it: 'Vuoto', fr: 'Vides', de: 'Leer' })[lang] || 'All Empty'}</option>
                <option value="occupied">{({ en: 'Filled / In-use', ka: 'შევსებული', it: 'Occupato', fr: 'Occupés', de: 'In Verwendung' })[lang] || 'Filled / In-use'}</option>
                <option value="dirty">{({ en: 'Needs Cleaning', ka: 'საჭიროებს რეცხვას', it: 'Da Pulire', fr: 'À Laver', de: 'Reinigungsbedarf' })[lang] || 'Needs Cleaning'}</option>
                <option value="cooling">{({ en: 'Active Cooling', ka: 'აქტიური გაგრილება', it: 'Raffreddamento', fr: 'Refroidissement actif', de: 'Aktive Kühlung' })[lang] || 'Active Cooling'}</option>
              </select>
            </div>

            <span className="text-slate-200 hidden md:block">|</span>

            {/* Layout viewMode switches */}
            <div className="bg-slate-200/70 p-0.5 rounded-lg flex items-center">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md cursor-pointer transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-white text-[#4e0e15] shadow-xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title={ka ? 'დაფის ბადე' : 'Board Grid Representation'}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-md cursor-pointer transition-colors ${
                  viewMode === 'table'
                    ? 'bg-white text-[#4e0e15] shadow-xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title={ka ? 'კომპაქტური ცხრილი' : 'Compact Power-Winery Table'}
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Add Vessel Form Popup */}
      {canCreateVessel && showAddForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 p-4 backdrop-blur-[2px]"
          onMouseDown={() => setShowAddForm(false)}
        >
        <form
          role="dialog"
          aria-modal="true"
          aria-label={ka ? 'ჭურჭლის დამატება' : 'Add vessel'}
          onMouseDown={event => event.stopPropagation()}
          onSubmit={handleAddVessel}
          className="grid max-h-[90vh] w-full max-w-2xl grid-cols-1 items-end gap-4 overflow-y-auto rounded-2xl border border-[#e8dfd5] bg-white p-5 shadow-2xl sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <h3 className="text-lg font-black text-stone-900">{ka ? 'ახალი ჭურჭელი' : 'New vessel'}</h3>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {({
                en: 'Unique Vessel ID',
                ka: 'უნიკალური ჭურჭლის ID',
                it: 'ID Recipiente Unico',
                fr: 'ID Unique de la Cuve',
                de: 'Eindeutige Behälter-ID'
              })[lang] || 'Unique Vessel ID'}
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Tank T-5"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-200 rounded outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {({
                en: 'Vessel Material/Type',
                ka: 'ჭურჭლის მასალა/ტიპი',
                it: 'Materiale/Tipo Recipiente',
                fr: 'Matériau/Type de Cuve',
                de: 'Behältermaterial/-typ'
              })[lang] || 'Vessel Material/Type'}
            </label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as VesselType)}
              className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-200 rounded outline-none"
            >
              <option value="stainless_steel">{t.stainless_steel || 'Stainless Steel'}</option>
              <option value="qvevri">
                {({
                  en: 'Traditional Clay Qvevri',
                  ka: 'ტრადიციული თიხის ქვევრი',
                  it: 'Qvevri Tradizionale',
                  fr: 'Qvevri Traditionnel',
                  de: 'Klassischer Qvevri'
                })[lang] || 'Traditional Clay Qvevri'}
              </option>
              <option value="barrel">
                {({
                  en: 'Oak Barrel (Barrique)',
                  ka: 'მუხის კასრი (ბარიკი)',
                  it: 'Botte di Rovere (Barrique)',
                  fr: 'Tonneau de Chêne (Barrique)',
                  de: 'Eichenfass (Barrique)'
                })[lang] || 'Oak Barrel (Barrique)'}
              </option>
              <option value="concrete">{t.concrete || 'Concrete Vessel'}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {({
                en: 'Maximum Liters Capacity',
                ka: 'მაქსიმალური ტევადობა (ლ)',
                it: 'Capacità Massima Litri',
                fr: 'Capacité Maximale (L)',
                de: 'Maximales Volumen (L)'
              })[lang] || 'Maximum Liters Capacity'}
            </label>
            <input
              type="number"
              required
              value={newCapacity}
              onChange={(e) => setNewCapacity(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-200 rounded outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              {ka ? 'მდებარეობა' : 'Location'}
            </label>
            <input
              type="text"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              placeholder={ka ? 'მაგ. მთავარი მარანი' : 'e.g. Main cellar'}
              className="w-full rounded border border-slate-200 bg-[#FAF8F5] px-2.5 py-1.5 text-xs outline-none"
            />
          </div>
          <div className="flex gap-2 sm:col-span-2 sm:justify-end">
            <button
              type="submit"
              className="flex-1 cursor-pointer rounded bg-[#4e0e15] px-4 py-2 text-xs font-semibold text-white hover:bg-[#6b151e] sm:flex-none"
            >
              {({
                en: 'Register Vessel',
                ka: 'რეგისტრაცია',
                it: 'Registra',
                fr: 'Enregistrer',
                de: 'Registrieren'
              })[lang] || 'Register Vessel'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 bg-slate-200 text-slate-700 text-xs rounded hover:bg-slate-300 pointer-events-auto"
            >
              {t.cancel || 'Cancel'}
            </button>
          </div>
        </form>
        </div>
      )}

      {/* 4. Executive Vessel Visual Workspace */}
      {filteredVessels.length === 0 ? (
        <div className="p-12 text-center bg-[#FAF8F5] border border-dashed border-[#e8dfd5] rounded-2xl">
          <Database className="w-10 h-10 mx-auto text-stone-300 mb-3" />
          <h4 className="text-sm font-serif font-bold text-stone-700 mb-1">
            {vessels.length === 0
              ? (({ en: 'No vessels registered yet', ka: 'ჭურჭელი ჯერ არ არის დარეგისტრირებული', it: 'Nessun recipiente registrato', fr: 'Aucune cuve enregistrée', de: 'Noch keine Behälter registriert' })[lang] || 'No vessels registered yet')
              : (({
                  en: 'No matching cellar vessels found',
                  ka: 'იდენტური ჭურჭელი ვერ მოიძებნა',
                  it: 'Nessun recipiente trovato',
                  fr: 'Aucune cuve trouvée',
                  de: 'Keine passenden Behälter gefunden'
                })[lang] || 'No matching cellar vessels found')}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-4">
            {vessels.length === 0
              ? (({
                  en: 'Tanks, qvevri, and barrels registered here become the destinations for grape intake, transfers, and fermentation tracking.',
                  ka: 'აქ დარეგისტრირებული ავზები, ქვევრები და კასრები გამოჩნდება მიღების, გადატანისა და დუღილის აღრიცხვისას.',
                  it: 'Serbatoi, qvevri e botti registrati qui diventano le destinazioni per conferimenti, travasi e fermentazioni.',
                  fr: 'Les cuves, qvevri et fûts enregistrés ici deviennent les destinations des réceptions, soutirages et fermentations.',
                  de: 'Hier registrierte Tanks, Qvevri und Fässer werden zu Zielen für Traubenannahme, Umzüge und Gärverfolgung.',
                })[lang] || 'Tanks, qvevri, and barrels registered here become the destinations for grape intake, transfers, and fermentation tracking.')
              : (({
                  en: 'Adjust your active material filters, search queries, or cleaning statuses to expose commissioned cellar units.',
                  ka: 'შეცვალეთ ფილტრაციის პარამეტრები ან საძიებო სიტყვა.',
                  it: 'Modifica i filtri o la ricerca per mostrare i recipienti disponibili.',
                  fr: 'Ajustez vos filtres ou votre terme de recherche.',
                  de: 'Passen Sie Ihre Filter oder Ihren Suchbegriff an.'
                })[lang] || 'Adjust your active material filters, search queries, or cleaning statuses to expose commissioned cellar units.')}
          </p>
          {(vessels.length > 0 || canCreateVessel) && (
            <button
              onClick={() => {
                if (vessels.length === 0) {
                  if (!canCreateVessel) return;
                  setShowAddForm(true);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  return;
                }
                setSearchTerm('');
                setFilterType('all');
                setStatusFilter('all');
              }}
              className="px-3.5 py-1.5 bg-[#4e0e15] text-white hover:bg-[#6b151e] rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
            >
              {vessels.length === 0
                ? (({ en: '+ Register your first vessel', ka: '+ დაარეგისტრირეთ პირველი ჭურჭელი', it: '+ Registra il primo recipiente', fr: '+ Enregistrer la première cuve', de: '+ Ersten Behälter registrieren' })[lang] || '+ Register your first vessel')
                : (({ en: 'Clear Active Filters', ka: 'ფილტრების გასუფთავება', it: 'Azzera Filtri', fr: 'Effacer Filtres', de: 'Filter zurücksetzen' })[lang] || 'Clear Active Filters')}
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        /* Original Premium Glass Cards Grid View */
        <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredVessels.map(v => {
            const progress = v.capacity > 0 ? (v.currentVolume / v.capacity) * 100 : 0;
            const assignedLot = lots.find(l => l.id === v.assignedLotId);
            const needsCleaning = v.cleaningStatus !== 'clean';
            const isHighFermentationFill = assignedLot?.stage === 'fermenting' && progress >= 90;
            const isSelected = v.id === selectedTankId;
            const signalKind = vesselSignalKind(v);
            const signal = signalKind ? signalCopy(v, signalKind) : null;
            const isReady = readyVessels.some(vessel => vessel.id === v.id);

            return (
              <StaggerItem key={v.id}>
                <div
                  onClick={() => openVessel(v)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openVessel(v);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={ka ? `${v.id} ჭურჭლის გახსნა` : `Open vessel ${v.id}`}
                  className={`flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white text-stone-800 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#801323]/40 ${
                    isSelected
                      ? 'border-[#801323] ring-2 ring-[#801323]/10'
                      : isHighFermentationFill
                        ? 'border-rose-400 shadow-md ring-1 ring-rose-100'
                        : signal
                          ? 'border-amber-300 hover:border-amber-400'
                          : 'border-[#e8dfd5] hover:-translate-y-0.5 hover:border-stone-400 hover:shadow-md'
                  }`}
                >
                {/* Card Title Header */}
                <div className="flex items-start justify-between gap-3 border-b border-[#e8dfd5] bg-[#FAF8F5] px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {isSelected && <span className="w-2 h-2 rounded-full bg-[#801323] animate-pulse" />}
                    <div className="min-w-0">
                      <h4 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-1">
                        {v.id}
                        {isSelected && <span className="text-[9px] font-sans font-normal text-stone-400 italic">({({ en: 'selected', ka: 'არჩეული', it: 'selezionato', fr: 'sélectionné', de: 'ausgewählt' })[lang] || 'selected'})</span>}
                      </h4>
                      <p className="text-[10px] text-slate-400 font-mono capitalize">
                        {vesselTypeLabel(v.type, lang)} • {v.locationDetails}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {signal ? (
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                        signalKind === 'fill' || signalKind === 'assignment' || signalKind === 'temperature'
                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700'
                      }`}>
                        {ka ? 'ყურადღება' : 'Action'}
                      </span>
                    ) : isReady ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700">
                        {ka ? 'ცარიელი და სუფთაა' : 'Empty & Clean'}
                      </span>
                    ) : (
                      <span className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-stone-500">
                        {ka ? 'მუშაობაში' : 'In use'}
                      </span>
                    )}
                    {canDeleteVessel && v.currentVolume === 0 && !v.assignedLotId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteVessel(v.id);
                      }}
                      className="p-1 text-slate-300 hover:text-red-500 cursor-pointer transition-colors"
                      title={ka ? 'ჭურჭლის ჩამოწერა / განადგურება' : 'Commission out / destroy vessel'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    )}
                  </div>
                </div>

                {/* Liquid Graphics Fill Card */}
                <div className="p-4 flex-1 flex flex-col space-y-4">
                  {signal && (
                    <div className={`rounded-xl border px-3 py-2 ${
                      signalKind === 'fill' || signalKind === 'assignment' || signalKind === 'temperature'
                        ? 'border-rose-200 bg-rose-50'
                        : 'border-amber-200 bg-amber-50'
                    }`}>
                      <strong className={`block text-[11px] font-black ${
                        signalKind === 'fill' || signalKind === 'assignment' || signalKind === 'temperature'
                          ? 'text-rose-800'
                          : 'text-amber-800'
                      }`}>{signal.title}</strong>
                      <span className="mt-0.5 block text-[9px] font-semibold leading-snug text-stone-600">{signal.detail}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-4">
                    {/* Animated liquid-fill vessel (height = volume, colour = wine class) */}
                    <div className={`shrink-0 flex flex-col items-center ${isHighFermentationFill ? 'text-red-600' : 'text-[#4e0e15]'}`}>
                      <VesselFill
                        fillPct={progress}
                        wineClass={assignedLot?.wineClass || 'red'}
                        qvevri={v.type === 'qvevri'}
                        width={48}
                        height={64}
                      />
                      <span className="mt-0.5 text-[9px] font-mono font-bold text-slate-500">{progress.toFixed(0)}%</span>
                    </div>

                    {/* Lot metrics */}
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-mono uppercase font-bold text-slate-400">
                        {({
                          en: 'Assigned Lot',
                          ka: 'მიკუთვნებული პარტია',
                          it: 'Lotto Assegnato',
                          fr: 'Lot Assigné',
                          de: 'Zugewiesene Charge'
                        })[lang] || 'Assigned Lot'}
                      </span>
                      {assignedLot ? (
                        <div>
                          <span className="text-xs font-bold text-slate-700 block truncate">{assignedLot.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 mt-0.5 inline-block bg-[#f5efe9] border border-[#e3d7cb] text-[#4e0e15] rounded font-medium capitalize truncate">{assignedLot.variety}</span>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-slate-400 block italic">
                          {({
                            en: 'Empty / Ready',
                            ka: 'ცარიელი / მზადყოფნაში',
                            it: 'Vuoto / Pronto',
                            fr: 'Vide / Prêt',
                            de: 'Leer / Bereit'
                          })[lang] || 'Empty / Ready'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress parameters bar text */}
                  <div className="grid grid-cols-2 gap-2 text-xs py-2 bg-[#Fdfbfc] border border-[#f5ece4] rounded p-2">
                    <div>
                      <span className="text-[9px] text-slate-400 block font-mono">
                        {({
                          en: 'Current Vol',
                          ka: 'მიმდინარე მოცულობა',
                          it: 'Volume Corrente',
                          fr: 'Volume Actuel',
                          de: 'Aktuelle Füllung'
                        })[lang] || 'Current Vol'}
                      </span>
                      <strong className="text-slate-800 text-xs">{v.currentVolume} L</strong>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 block font-mono">
                        {({
                          en: 'Vessel Capacity',
                          ka: 'ჭურჭლის ტევადობა',
                          it: 'Capacità Recipiente',
                          fr: 'Capacité',
                          de: 'Gesamtkapazität'
                        })[lang] || 'Vessel Capacity'}
                      </span>
                      <strong className="text-slate-800 text-xs">{v.capacity} L</strong>
                    </div>
                  </div>

                  {/* Temperature settings edit */}
                  <div className="text-xs flex items-center justify-between border-t border-dashed border-slate-100 pt-2" onClick={e => e.stopPropagation()}>
                    {v.type === 'qvevri' ? (
                      <>
                        <div>
                          <span className="text-[9px] text-slate-400 block font-mono">
                            {ka ? 'ქვევრის / ნიადაგის ტემპ.' : 'Qvevri / Soil Temp'}
                          </span>
                          <span className="font-bold flex items-center gap-1 mt-0.5 text-stone-750">
                            <Thermometer className="w-3.5 h-3.5 text-emerald-600" />
                            {v.temperature}°C / {(v.soilTemperature ?? (v.temperature - 2.5)).toFixed(1)}°C
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] text-slate-400 block font-mono">
                            {ka ? 'თიხის ლუქი' : 'Clay Seal Status'}
                          </span>
                          {(() => {
                            const lastSealed = v.lastSealedDate ? new Date(v.lastSealedDate) : new Date(Date.now() - 45 * 86400000);
                            const diffDays = Math.round((Date.now() - lastSealed.getTime()) / (1000 * 60 * 60 * 24));
                            const needsReseal = diffDays > 120;
                            const formattedDate = v.lastSealedDate || lastSealed.toISOString().split('T')[0];
                            return (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded font-bold border mt-0.5 ${
                                  needsReseal
                                    ? 'bg-red-50 text-red-750 border-red-200 animate-pulse'
                                    : 'bg-emerald-50 text-emerald-750 border-emerald-200'
                                }`}
                                title={needsReseal ? (ka ? 'საჭიროებს ხელახალ დალუქვას' : 'Requires beeswax resealing!') : (ka ? 'დალუქულია' : 'Sealed')}
                              >
                                {needsReseal ? (ka ? 'ლუქი გასაახლებელია' : 'Reseal Needed') : (ka ? 'დალუქულია' : 'Sealed')} ({formattedDate})
                              </span>
                            );
                          })()}
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <span className="text-[9px] text-slate-400 block font-mono">
                            {({
                              en: 'Current Temp',
                              ka: 'მიმდინარე ტემპ.',
                              it: 'Temperatura Corrente',
                              fr: 'Température Actuelle',
                              de: 'Aktuelle Temp.'
                            })[lang] || 'Current Temp'}
                          </span>
                          {canUpdateVessel && editingTempId === v.id ? (
                            <div className="flex items-center gap-1 mt-0.5">
                              <input
                                type="number"
                                step="0.1"
                                value={tempInputValue}
                                onChange={(e) => setTempInputValue(parseFloat(e.target.value) || 0)}
                                className="w-14 px-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs"
                              />
                              <button
                                onClick={() => handleSaveTemp(v.id)}
                                className="px-1.5 py-0.5 text-[9px] bg-green-600 hover:bg-green-700 text-white rounded cursor-pointer"
                              >
                                {t.save || 'Save'}
                              </button>
                            </div>
                          ) : (
                            <span className="font-bold flex items-center gap-1 mt-0.5">
                              {v.temperature}°C
                              {canUpdateVessel && (
                                <button
                                  onClick={() => {
                                    setEditingTempId(v.id);
                                    setTempInputValue(v.temperature);
                                  }}
                                  className="p-0.5 text-slate-400 hover:text-[#4e0e15] cursor-pointer"
                                  title={ka ? 'ტემპერატურის შეცვლა' : 'Set temperature value'}
                                >
                                  <Edit className="w-3 h-3" />
                                </button>
                              )}
                            </span>
                          )}
                        </div>

                        {/* Cooling options */}
                        <div className="text-right">
                          <span className="text-[9px] text-slate-400 block font-mono">
                            {({
                              en: 'Cooling Jacket',
                              ka: 'გამაგრილებელი პერანგი',
                              it: 'Giacca di Raffreddamento',
                              fr: 'Double Enveloppe',
                              de: 'Kühlmantel'
                            })[lang] || 'Cooling Jacket'}
                          </span>
                          {canUpdateVessel ? (
                            <button
                              onClick={() => handleToggleCooling(v.id)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded font-bold transition-all border mt-0.5 cursor-pointer active:scale-95 hover:scale-[1.03] duration-150 ${
                                v.coolingJacketActive
                                  ? 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd] animate-pulse'
                                  : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                              }`}
                            >
                              {v.coolingJacketActive ? (
                                <>
                                  <Snowflake className="w-2.5 h-2.5 text-[#0369a1] animate-spin" />
                                  {({ en: 'Active', ka: 'აქტიური', it: 'Attiva', fr: 'Active', de: 'Aktiv' })[lang] || 'Active'}
                                </>
                              ) : (
                                ({ en: 'Inactive', ka: 'არააქტიური', it: 'Inattiva', fr: 'Inactive', de: 'Inaktiv' })[lang] || 'Inactive'
                              )}
                            </button>
                          ) : (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded font-bold border mt-0.5 ${
                              v.coolingJacketActive
                                ? 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd]'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                            {v.coolingJacketActive ? (
                              <>
                                <Snowflake className="w-2.5 h-2.5 text-[#0369a1] animate-spin" />
                                {({ en: 'Active', ka: 'აქტიური', it: 'Attiva', fr: 'Active', de: 'Aktiv' })[lang] || 'Active'}
                              </>
                            ) : (
                                ({ en: 'Inactive', ka: 'არააქტიური', it: 'Inattiva', fr: 'Inactive', de: 'Inaktiv' })[lang] || 'Inactive'
                              )}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Cleaning / Operation Status */}
                  <div className="text-xs border-t border-dashed border-slate-100 pt-2 flex items-center justify-between mt-auto" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-slate-400 font-mono text-[9px]">
                        {({ en: 'Hygiene:', ka: 'ჰიგიენა:', it: 'Igiene:', fr: 'Hygiène :', de: 'Reinigung:' })[lang] || 'Hygiene:'}
                      </span>
                      {needsCleaning ? (
                        <span className="text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 border border-amber-200 rounded">
                          {({ en: 'Needs Cleaning', ka: 'საჭიროებს რეცხვას', it: 'Da Pulire', fr: 'À Nettoyer', de: 'Reinigungsbedarf' })[lang] || 'Needs Cleaning'}
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                          {({ en: 'Clean', ka: 'სუფთა', it: 'Pulito', fr: 'Propre', de: 'Sauber' })[lang] || 'Clean'} ({v.lastCleaned})
                        </span>
                      )}
                    </div>

                    {canUpdateVessel && needsCleaning && v.currentVolume === 0 && !v.assignedLotId && v.type !== 'qvevri' && (
                      <button
                        onClick={() => handleClean(v.id)}
                        className="inline-flex items-center gap-0.5 px-2 py-1 bg-[#4e0e15] text-white font-bold rounded hover:bg-[#6b151e] cursor-pointer text-[9px] active:scale-95 hover:-translate-y-0.5 duration-150"
                      >
                        <RotateCw className="w-2.5 h-2.5" />
                        {({ en: 'Wash Vessel', ka: 'ჭურჭლის რეცხვა', it: 'Lava Recipiente', fr: 'Nettoyer la Cuve', de: 'Gefäß waschen' })[lang] || 'Wash Vessel'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </StaggerItem>
            );
          })}
        </Stagger>
      ) : (
        /* Executive Compact Interactive Wine-Table Layout */
        <div className="bg-white border border-[#e8dfd5] rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-[#FAF8F5] text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider border-b border-[#e8dfd5]">
                <tr>
                  <th className="py-3 px-4">{lText({ en: 'ID / Material', ka: 'ID / მასალა', it: 'ID / Materiale', fr: 'ID / Matériau', de: 'ID / Material' }, 'ID / Material')}</th>
                  <th className="py-3 px-3">{lText({ en: 'Location', ka: 'მდებარეობა', it: 'Ubicazione', fr: 'Emplacement', de: 'Standort' }, 'Location')}</th>
                  <th className="py-3 px-3">{lText({ en: 'Assigned Lot', ka: 'პარტია', it: 'Lotto Assegnato', fr: 'Lot Assigné', de: 'Zugewiesene Charge' }, 'Assigned Lot')}</th>
                  <th className="py-3 px-3">{lText({ en: 'Volume State / Fills', ka: 'მოცულობა', it: 'Volume / Riempimento', fr: 'Volume / Remplissage', de: 'Füllmenge' }, 'Volume State / Fills')}</th>
                  <th className="py-3 px-3">{lText({ en: 'Temperature', ka: 'ტემპერატურა', it: 'Temperatura', fr: 'Température', de: 'Temperatur' }, 'Temperature')}</th>
                  <th className="py-3 px-3 text-center">{lText({ en: 'Cooling Jacket', ka: 'გაგრილება', it: 'Giacca Raffreddamento', fr: 'Jaquette de Rafroidissement', de: 'Kühlmantel' }, 'Cooling Jacket')}</th>
                  <th className="py-3 px-3">{lText({ en: 'Hygiene', ka: 'ჰიგიენა', it: 'Igiene', fr: 'Hygiène', de: 'Hygiene' }, 'Hygiene')}</th>
                  {(canUpdateVessel || canDeleteVessel) && (
                    <th className="py-3 px-4 text-center">{lText({ en: 'Actions', ka: 'ქმედებები', it: 'Azioni', fr: 'Actions', de: 'Aktionen' }, 'Actions')}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredVessels.map(v => {
                  const progress = v.capacity > 0 ? (v.currentVolume / v.capacity) * 100 : 0;
                  const assignedLot = lots.find(l => l.id === v.assignedLotId);
                  const needsCleaning = v.cleaningStatus !== 'clean';
                  const isHighFermentationFill = assignedLot?.stage === 'fermenting' && progress >= 90;
                  const isSelected = v.id === selectedTankId;

                  return (
                    <tr
                      key={v.id}
                      onClick={() => openVessel(v)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openVessel(v);
                        }
                      }}
                      tabIndex={0}
                      className={`cursor-pointer transition-colors hover:bg-slate-50/50 ${
                        isSelected ? 'bg-[#FAF8F5] font-semibold' : ''
                      }`}
                    >
                      {/* 1. ID / Material */}
                      <td className="py-3.5 px-4 font-serif">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            isSelected
                              ? 'bg-[#801323] animate-ping'
                              : isHighFermentationFill
                                ? 'bg-red-500'
                                : v.currentVolume > 0 ? 'bg-[#801323]' : 'bg-slate-300'
                          }`} />
                          <div>
                            <span className="font-bold text-[#4e0e15] text-xs hover:underline">{v.id}</span>
                            <span className="text-[10px] text-slate-400 font-mono block capitalize">{v.type.replace('_', ' ')}</span>
                          </div>
                        </div>
                      </td>

                      {/* 2. Location */}
                      <td className="py-3.5 px-3 text-slate-500 font-mono">{v.locationDetails || 'Main Hall'}</td>

                      {/* 3. Assigned Wine Lot */}
                      <td className="py-3.5 px-3">
                        {assignedLot ? (
                          <div>
                            <span className="font-bold text-slate-800 text-xs block">{assignedLot.name}</span>
                            <span className="text-[9px] font-mono px-1 py-0.5 bg-slate-100 text-[#4e0e15] rounded whitespace-nowrap inline-block capitalize">{assignedLot.variety}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic font-medium">{lText({ en: 'Empty / Standby', ka: 'ცარიელი', it: 'Vuoto / Pronto', fr: 'Vide', de: 'Leer' }, 'Empty / Standby')}</span>
                        )}
                      </td>

                      {/* 4. Volume State / Fill Index progress bar */}
                      <td className="py-3.5 px-3 min-w-[130px]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <div className="flex justify-between text-[10px] text-slate-500 mb-0.5 font-mono">
                              <span className="font-semibold text-slate-700">{v.currentVolume.toLocaleString()} L</span>
                              <span>{progress.toFixed(0)}%</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${isHighFermentationFill ? 'bg-red-500' : 'bg-[#801323]'}`}
                                style={{ width: `${Math.min(100, progress)}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-400 block font-mono">/ {v.capacity.toLocaleString()} L</span>
                        </div>
                      </td>

                      {/* 5. Temperature Controls */}
                      <td className="py-3.5 px-3" onClick={e => e.stopPropagation()}>
                        {canUpdateVessel && editingTempId === v.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.1"
                              value={tempInputValue}
                              onChange={(e) => setTempInputValue(parseFloat(e.target.value) || 0)}
                              className="w-14 px-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs"
                            />
                            <button
                              onClick={() => handleSaveTemp(v.id)}
                              className="px-1.5 py-0.5 text-[9px] bg-green-600 hover:bg-green-700 text-white rounded cursor-pointer"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => setEditingTempId(null)}
                              className="px-1.5 py-0.5 text-[9px] bg-slate-200 text-slate-600 rounded cursor-pointer"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="font-bold text-slate-700 flex items-center gap-1 font-mono">
                              <Thermometer className="w-3 h-3 text-slate-400" />
                              {v.temperature.toFixed(1)}°C
                            </span>
                            {canUpdateVessel && (
                              <button
                                onClick={() => {
                                  setEditingTempId(v.id);
                                  setTempInputValue(v.temperature);
                                }}
                                className="p-1 text-slate-400 hover:text-[#4e0e15] cursor-pointer"
                                title={ka ? 'ტემპერატურის შეცვლა' : 'Set temperature value'}
                              >
                                <Edit className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 6. Stabilization active control toggle */}
                      <td className="py-3.5 px-3 text-center" onClick={e => e.stopPropagation()}>
                        {canUpdateVessel ? (
                          <button
                            onClick={() => handleToggleCooling(v.id)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-lg font-bold transition-all border cursor-pointer ${
                              v.coolingJacketActive
                                ? 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd] animate-pulse'
                                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <Snowflake className={`w-2.5 h-2.5 ${v.coolingJacketActive ? 'text-[#0369a1] animate-spin' : 'text-slate-400'}`} />
                            {v.coolingJacketActive
                              ? lText({ en: 'Active', ka: 'აქტიური', it: 'Attiva', fr: 'Active', de: 'Aktiv' }, 'Active')
                              : lText({ en: 'Hold', ka: 'გამორთული', it: 'Fermo', fr: 'Arrêt', de: 'Aus' }, 'Hold')
                            }
                          </button>
                        ) : (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-lg font-bold border ${
                            v.coolingJacketActive
                              ? 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd]'
                              : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}>
                          <Snowflake className={`w-2.5 h-2.5 ${v.coolingJacketActive ? 'text-[#0369a1] animate-spin' : 'text-slate-400'}`} />
                          {v.coolingJacketActive
                            ? lText({ en: 'Active', ka: 'აქტიური', it: 'Attiva', fr: 'Active', de: 'Aktiv' }, 'Active')
                              : lText({ en: 'Hold', ka: 'გამორთული', it: 'Fermo', fr: 'Arrêt', de: 'Aus' }, 'Hold')
                            }
                          </span>
                        )}
                      </td>

                      {/* 7. Hygiene cleaning logs */}
                      <td className="py-3.5 px-3">
                        {needsCleaning ? (
                          <span className="text-amber-600 font-bold bg-amber-50 px-2 py-0.5 border border-amber-200 rounded text-[10px] whitespace-nowrap">
                            ⚠️ {lText({ en: 'Dirty', ka: 'სარეცხი', it: 'Da Lavare', fr: 'Sale', de: 'Schmutzig' }, 'Dirty')}
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5 text-[10px] whitespace-nowrap">
                            <CheckCircle className="w-3 h-3 text-emerald-600" />
                            {lText({ en: 'Clean', ka: 'სუფთა', it: 'Pulito', fr: 'Propre', de: 'Sauber' }, 'Clean')}
                          </span>
                        )}
                      </td>

                      {/* 8. Extra action column */}
                      {(canUpdateVessel || canDeleteVessel) && (
                        <td className="py-3.5 px-4 text-center" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            {canUpdateVessel && needsCleaning && v.currentVolume === 0 && !v.assignedLotId && v.type !== 'qvevri' && (
                              <button
                                onClick={() => handleClean(v.id)}
                                className="px-2 py-1 bg-[#4e0e15] text-white hover:bg-[#6b151e] rounded text-[10px] font-bold inline-flex items-center gap-0.5 cursor-pointer"
                                title={ka ? 'ერთეულის რეცხვა და სანიტარია' : 'Wash and sanitize unit'}
                              >
                                <RotateCw className="w-2.5 h-2.5" />
                                Washing
                              </button>
                            )}
                            {canDeleteVessel && v.currentVolume === 0 && !v.assignedLotId && (
                              <button
                                onClick={() => handleDeleteVessel(v.id)}
                                className="p-1 text-slate-300 hover:text-red-500 rounded cursor-pointer hover:bg-red-50"
                                title={ka ? 'ჭურჭლის ჩამოწერა' : 'Decommission vessel unit'}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(TanksVessels);
