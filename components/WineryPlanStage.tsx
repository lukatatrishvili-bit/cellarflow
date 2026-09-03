'use client';

/**
 * The winery plan's shell.
 *
 * Everything the operator reads or clicks lives here as ordinary DOM: the
 * toolbar, the floor tabs, the vessel chips floating over the room, and the
 * inspector. The WebGL room underneath is one lazily loaded canvas that both
 * the plan and the 3D view share, so switching perspective is a camera move
 * rather than a different component with a different feature set.
 *
 * Rendering without a browser (server markup, or a device without WebGL) still
 * produces a usable plan: the chips fall back to a flat percentage layout of
 * the same floor.
 */

import React from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  ArrowDownToLine,
  Box,
  CalendarPlus,
  Check,
  ClipboardList,
  Crosshair,
  Grid3X3,
  Layers,
  Maximize2,
  Minimize2,
  Move3d,
  Pencil,
  Plus,
  RotateCcw,
  Ruler,
  Save,
  Search,
  ShieldCheck,
  Thermometer,
  Wine,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { ProductionPlanItem } from '../lib/operationsControl';
import type { CellarFloor, CellarOperationType, CellarTransferRecord, Task, Vessel, VesselPlanModel, WineLot } from '../lib/wineryState';
import { deriveCellarPlanPositions, floorIdForVessel, normalizeCellarFloors, primaryCellarFloorId, vesselsOnFloor } from '../lib/cellarLayout';
import {
  applyVesselPlan3dSettings,
  VESSEL_PLAN_MODELS,
  vesselPlan3dSettings,
  vesselPlanCollisions,
  vesselPlanGridPosition,
  vesselPlanWorldPosition,
  type VesselPlan3dSettings,
} from '../lib/wineryPlan3d';
import {
  bandTone,
  daysSince,
  focusMatches,
  layerBands,
  recentTransferRoutes,
  transferRun,
  vesselFillRatio,
  vesselLayerSignal,
  wineColorHex,
  type LayerBand,
  type LayerContext,
  type PlanFocus,
  type PlanLayer,
  type VesselLayerSignal,
} from '../lib/wineryScene';
import { localISODate } from '../lib/weatherApi';
import VesselOperationMenu from './VesselOperationMenu';
import type { PlanTransfer, PlanView, VesselAccent, WineryPlanCanvasHandle } from './WineryPlanCanvas';

const WineryPlanCanvas = React.lazy(() => import('./WineryPlanCanvas'));

type VesselLabelMode = 'vessel' | 'lot' | 'status';

export interface WineryPlanStageProps {
  lang: Language;
  view: PlanView;
  vessels: Vessel[];
  lots: WineLot[];
  floors?: CellarFloor[];
  productionPlans?: ProductionPlanItem[];
  tasks?: Task[];
  /** Recent transfer history, drawn as faded hoses over the room. */
  transfers?: CellarTransferRecord[];
  selectedVesselId: string | null;
  onSelectVessel: (vesselId: string) => void;
  onUpdateVessels: (vessels: Vessel[]) => void;
  onUpdateFloors?: (floors: CellarFloor[]) => void;
  onOpenVessel: (vesselId: string) => void;
  onOpenLot?: (lotId: string) => void;
  onLogOperation?: (vesselId: string, operationType?: CellarOperationType) => void;
  onRecordSanitation?: (vesselId: string) => void;
  onScheduleOperation?: (vesselId: string) => void;
  onPlanTransfer?: (sourceVesselId: string, destinationVesselId?: string, operationType?: 'racking' | 'blending') => void;
  onStartFilling?: (destinationVesselId: string) => void;
  onOpenBottling?: (sourceVesselId: string) => void;
  onRecordTransfer?: (sourceVesselId: string, destinationVesselId: string, maxVolumeL: number) => void;
  onBatchTopping?: (vesselIds: string[]) => void;
  onOpenProductionPlan?: (planId: string) => void;
  /** Headline figure the room is filtered by, owned by the module shell. */
  focus?: PlanFocus | null;
  onFocusChange?: (focus: PlanFocus | null) => void;
  canUpdate: boolean;
  reduceMotion?: boolean;
}

const BAND_LABEL: Record<LayerBand, { en: string; ka: string }> = {
  wine: { en: 'Holding wine', ka: 'ღვინით' },
  empty: { en: 'Empty', ka: 'ცარიელი' },
  cold: { en: 'Under 10°C', ka: '10°C-ზე დაბლა' },
  cool: { en: '10–17°C', ka: '10–17°C' },
  warm: { en: '18–24°C', ka: '18–24°C' },
  hot: { en: 'Over 24°C', ka: '24°C-ზე მაღლა' },
  drift: { en: 'Off set point', ka: 'რეჟიმს ასცდა' },
  clean: { en: 'Clean', ka: 'სუფთა' },
  stale: { en: 'Standing 45+ days', ka: '45+ დღე უქმად' },
  dirty: { en: 'Needs sanitation', ka: 'სანიტარია საჭიროა' },
  idle: { en: 'No work booked', ka: 'სამუშაო არ არის' },
  scheduled: { en: 'Work booked', ka: 'დაგეგმილია' },
  active: { en: 'Work under way', ka: 'მიმდინარეობს' },
};

const FOCUS_LABEL: Record<PlanFocus, { en: string; ka: string }> = {
  occupied: { en: 'Wine in cellar', ka: 'ღვინო მარანში' },
  available: { en: 'Clean capacity', ka: 'სუფთა ტევადობა' },
  lots: { en: 'Active lots', ka: 'აქტიური პარტიები' },
  work: { en: 'Open work', ka: 'ღია სამუშაო' },
};

const swatchStyle = (band: LayerBand) => ({ background: `#${bandTone(band).toString(16).padStart(6, '0')}` });

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function floorDisplayName(floor: CellarFloor, ka: boolean): string {
  if (floor.id === 'cellar-floor-main' && floor.name === 'Main cellar') return ka ? 'მთავარი მარანი' : floor.name;
  return floor.name;
}

function levelLabel(level: number, ka: boolean): string {
  if (level === 0) return ka ? 'მიწის დონე' : 'Ground';
  return level < 0 ? `${ka ? 'სარდაფი' : 'Basement'} ${Math.abs(level)}` : `${ka ? 'სართული' : 'Floor'} ${level}`;
}

function modelLabel(model: VesselPlanModel, ka: boolean): string {
  const option = VESSEL_PLAN_MODELS.find(item => item.id === model);
  return option ? (ka ? option.ka : option.en) : model;
}

const WINE_SWATCH: Record<string, string> = {
  red: '#8a1c34', white: '#d9bd5c', amber: '#c07520', rose: '#d96f8c',
  sparkling: '#dcc884', qvevri: '#b3652a', fortified: '#8c3520', base_wine: '#9a8a58',
};

export default function WineryPlanStage({
  lang,
  view,
  vessels,
  lots,
  floors: rawFloors,
  productionPlans = [],
  tasks = [],
  transfers = [],
  selectedVesselId,
  onSelectVessel,
  onUpdateVessels,
  onUpdateFloors,
  onOpenVessel,
  onOpenLot,
  onLogOperation,
  onRecordSanitation,
  onScheduleOperation,
  onPlanTransfer,
  onStartFilling,
  onOpenBottling,
  onRecordTransfer,
  onBatchTopping,
  onOpenProductionPlan,
  focus = null,
  onFocusChange,
  canUpdate,
  reduceMotion = false,
}: WineryPlanStageProps) {
  const ka = lang === 'ka';
  const floors = React.useMemo(() => normalizeCellarFloors(rawFloors), [rawFloors]);
  const [selectedFloorId, setSelectedFloorId] = React.useState(() => primaryCellarFloorId(floors));
  const [layer, setLayer] = React.useState<PlanLayer>('contents');
  const [xRay, setXRay] = React.useState(true);
  const [labelMode, setLabelMode] = React.useState<VesselLabelMode>('lot');
  const [editing, setEditing] = React.useState(false);
  const [draftVessels, setDraftVessels] = React.useState(vessels);
  const [dirty, setDirty] = React.useState(false);
  const [snapToGrid, setSnapToGrid] = React.useState(true);
  const [zoomPercent, setZoomPercent] = React.useState(100);
  const [batchIds, setBatchIds] = React.useState<string[]>([]);
  const [transferSourceId, setTransferSourceId] = React.useState<string | null>(null);
  const [transferDestinationId, setTransferDestinationId] = React.useState<string | null>(null);
  const [floorSettingsOpen, setFloorSettingsOpen] = React.useState(false);
  const [webglUnavailable, setWebglUnavailable] = React.useState(false);
  const [interactive, setInteractive] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);

  const sectionRef = React.useRef<HTMLElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<WineryPlanCanvasHandle>(null);

  React.useEffect(() => { setInteractive(true); }, []);
  React.useEffect(() => { if (!editing) { setDraftVessels(vessels); setDirty(false); } }, [editing, vessels]);
  React.useEffect(() => {
    if (floors.some(floor => floor.id === selectedFloorId)) return;
    setSelectedFloorId(primaryCellarFloorId(floors));
  }, [floors, selectedFloorId]);

  const workingVessels = editing ? draftVessels : vessels;
  const positionedVessels = React.useMemo(() => {
    const positions = deriveCellarPlanPositions(workingVessels);
    return workingVessels.map(vessel => (Number.isFinite(vessel.xGrid) && Number.isFinite(vessel.yGrid)
      ? vessel
      : { ...vessel, xGrid: positions[vessel.id].x, yGrid: positions[vessel.id].y }));
  }, [workingVessels]);

  const selectedFloor = floors.find(floor => floor.id === selectedFloorId) || floors[0];
  const floorVessels = React.useMemo(
    () => positionedVessels.filter(vessel => floorIdForVessel(vessel, floors) === selectedFloor.id),
    [floors, positionedVessels, selectedFloor.id],
  );
  const collisions = React.useMemo(() => vesselPlanCollisions(floorVessels, selectedFloor), [floorVessels, selectedFloor]);
  const selectedVessel = positionedVessels.find(vessel => vessel.id === selectedVesselId) || null;
  const selectedLot = selectedVessel?.assignedLotId ? lots.find(lot => lot.id === selectedVessel.assignedLotId) : undefined;
  const selectedSettings = selectedVessel ? vesselPlan3dSettings(selectedVessel) : null;
  const selectedCollisions = selectedVessel ? collisions.get(selectedVessel.id) || [] : [];

  const today = React.useMemo(() => localISODate(), []);
  const workByVessel = React.useMemo(() => {
    const byVessel = new Map<string, { active: number; scheduled: number; plans: ProductionPlanItem[] }>();
    productionPlans
      .filter(plan => !['completed', 'cancelled'].includes(plan.status))
      .forEach(plan => {
        // ISO dates order lexicographically, so a window covering today needs
        // no date parsing to recognise.
        const underWay = plan.startDate <= today && plan.endDate >= today;
        plan.vesselIds.forEach(id => {
          const entry = byVessel.get(id) || { active: 0, scheduled: 0, plans: [] };
          if (underWay) entry.active += 1; else entry.scheduled += 1;
          entry.plans.push(plan);
          byVessel.set(id, entry);
        });
      });
    return byVessel;
  }, [productionPlans, today]);
  const taskByPlanId = React.useMemo(
    () => new Map(tasks.filter(task => task.source?.type === 'production_plan').map(task => [task.source!.id, task])),
    [tasks],
  );
  const selectedWork = selectedVesselId ? workByVessel.get(selectedVesselId)?.plans || [] : [];

  const layerContexts = React.useMemo(() => {
    const contexts = new Map<string, LayerContext>();
    floorVessels.forEach(vessel => {
      const lot = vessel.assignedLotId ? lots.find(item => item.id === vessel.assignedLotId) : undefined;
      const work = workByVessel.get(vessel.id);
      contexts.set(vessel.id, {
        wineClass: lot?.wineClass,
        activeWork: work?.active || 0,
        scheduledWork: work?.scheduled || 0,
        daysSinceCleaned: daysSince(vessel.lastCleaned, today),
      });
    });
    return contexts;
  }, [floorVessels, lots, today, workByVessel]);

  const signals = React.useMemo(() => {
    const record: Record<string, VesselLayerSignal> = {};
    floorVessels.forEach(vessel => {
      const context = layerContexts.get(vessel.id);
      if (context) record[vessel.id] = vesselLayerSignal(layer, vessel, context);
    });
    return record;
  }, [floorVessels, layer, layerContexts]);

  const bandCounts = React.useMemo(() => {
    const counts = new Map<LayerBand, number>();
    Object.values(signals).forEach(signal => counts.set(signal.band, (counts.get(signal.band) || 0) + 1));
    return counts;
  }, [signals]);

  const spotlight = React.useMemo(() => {
    if (!focus) return null;
    return floorVessels
      .filter(vessel => {
        const context = layerContexts.get(vessel.id);
        return context ? focusMatches(focus, vessel, context) : false;
      })
      .map(vessel => vessel.id);
  }, [floorVessels, focus, layerContexts]);
  const spotlightSet = React.useMemo(() => (spotlight ? new Set(spotlight) : null), [spotlight]);

  // Follow the selection onto its floor so a vessel opened from elsewhere in
  // the app is actually on screen when the plan appears.
  React.useEffect(() => {
    const vessel = positionedVessels.find(item => item.id === selectedVesselId);
    if (!vessel) return;
    const vesselFloorId = floorIdForVessel(vessel, floors);
    if (vesselFloorId !== selectedFloorId) setSelectedFloorId(vesselFloorId);
  }, [floors, positionedVessels, selectedFloorId, selectedVesselId]);

  const recentTransfers = React.useMemo<PlanTransfer[]>(() => {
    const onFloor = new Set(floorVessels.map(vessel => vessel.id));
    return recentTransferRoutes(transfers, onFloor).map(route => {
      const arriving = floorVessels.find(item => item.id === route.destinationId);
      const lot = arriving?.assignedLotId ? lots.find(item => item.id === arriving.assignedLotId) : undefined;
      return { ...route, color: wineColorHex(lot?.wineClass), historic: true };
    });
  }, [floorVessels, lots, transfers]);

  const transferSource = transferSourceId ? vessels.find(vessel => vessel.id === transferSourceId) || null : null;
  const transferDestination = transferDestinationId ? vessels.find(vessel => vessel.id === transferDestinationId) || null : null;
  const transferHeadroom = transferDestination ? Math.max(0, transferDestination.capacity - transferDestination.currentVolume) : 0;
  const transferableVolume = transferSource ? Math.min(transferSource.currentVolume, transferHeadroom) : 0;
  const transferRunFacts = transferSource && transferDestination
    ? transferRun(transferSource, transferDestination, selectedFloor)
    : null;
  const planTransfers = React.useMemo<PlanTransfer[]>(() => {
    if (transferSource && transferDestination) {
      const lot = transferSource.assignedLotId ? lots.find(item => item.id === transferSource.assignedLotId) : undefined;
      return [{
        sourceId: transferSource.id,
        destinationId: transferDestination.id,
        color: wineColorHex(lot?.wineClass),
      }];
    }
    return recentTransfers;
  }, [lots, recentTransfers, transferDestination, transferSource]);

  const transferIssue = transferDestination && transferDestination.cleaningStatus !== 'clean'
    ? (ka ? 'მიმღები ჭურჭელი ჯერ უნდა გაიწმინდოს.' : 'The destination vessel must be clean first.')
    : transferDestination && transferHeadroom <= 0
      ? (ka ? 'მიმღებ ჭურჭელში თავისუფალი ადგილი არ არის.' : 'The destination vessel has no available headroom.')
      : null;

  const accents = React.useMemo(() => {
    const map: Record<string, VesselAccent> = {};
    floorVessels.forEach(vessel => {
      if (collisions.has(vessel.id)) map[vessel.id] = 'conflict';
    });
    batchIds.forEach(id => { map[id] = 'batch'; });
    if (transferSourceId) {
      floorVessels.forEach(vessel => {
        if (vessel.id === transferSourceId) return;
        if (vessel.cleaningStatus === 'clean' && vessel.capacity - vessel.currentVolume > 0) map[vessel.id] = 'candidate';
      });
      map[transferSourceId] = 'source';
      if (transferDestinationId) map[transferDestinationId] = 'destination';
    }
    return map;
  }, [batchIds, collisions, floorVessels, transferDestinationId, transferSourceId]);

  /* ------------------------------------------------------------- mutation */

  const patchDraft = (vesselId: string, patch: Partial<Vessel>) => {
    setDirty(true);
    setDraftVessels(current => current.map(vessel => (vessel.id === vesselId ? { ...vessel, ...patch } : vessel)));
  };
  const updateSettings = (patch: Partial<VesselPlan3dSettings>) => {
    if (!selectedVessel) return;
    const next = applyVesselPlan3dSettings(selectedVessel, { ...vesselPlan3dSettings(selectedVessel), ...patch });
    setDirty(true);
    setDraftVessels(current => current.map(vessel => (vessel.id === selectedVessel.id ? next : vessel)));
  };
  const moveVessel = React.useCallback((vesselId: string, xGrid: number, yGrid: number) => {
    setDirty(true);
    setDraftVessels(current => current.map(vessel => (vessel.id === vesselId ? { ...vessel, xGrid, yGrid } : vessel)));
  }, []);

  const saveLayout = () => {
    const draftById = new Map(draftVessels.map(vessel => [vessel.id, vessel]));
    const now = new Date().toISOString();
    onUpdateVessels(vessels.map(vessel => {
      const draft = draftById.get(vessel.id);
      if (!draft) return vessel;
      const next = {
        cellarFloorId: draft.cellarFloorId,
        xGrid: draft.xGrid,
        yGrid: draft.yGrid,
        planModel: draft.planModel,
        planWidthMeters: draft.planWidthMeters,
        planDepthMeters: draft.planDepthMeters,
        planHeightMeters: draft.planHeightMeters,
        planElevationMeters: draft.planElevationMeters,
        planRotationDegrees: draft.planRotationDegrees,
      };
      const changed = Object.entries(next).some(([key, value]) => vessel[key as keyof Vessel] !== value);
      return changed ? { ...vessel, ...next, lastModified: now } : vessel;
    }));
    setEditing(false);
    setDirty(false);
  };

  const handleSelect = React.useCallback((vesselId: string, additive: boolean) => {
    if (transferSourceId && vesselId !== transferSourceId) { setTransferDestinationId(vesselId); return; }
    if (additive && onBatchTopping) {
      setBatchIds(current => (current.includes(vesselId) ? current.filter(id => id !== vesselId) : [...current, vesselId]));
      return;
    }
    onSelectVessel(vesselId);
  }, [onBatchTopping, onSelectVessel, transferSourceId]);

  const focusVessel = (vesselId: string) => {
    onSelectVessel(vesselId);
    canvasRef.current?.focusVessel(vesselId);
  };

  const changeZoom = (percent: number) => {
    setZoomPercent(percent);
    canvasRef.current?.zoomTo(percent);
  };

  const toggleFullscreen = async () => {
    const element = sectionRef.current;
    if (!element) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await element.requestFullscreen();
  };
  React.useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const updateFloor = (patch: Partial<CellarFloor>) => {
    if (!onUpdateFloors) return;
    onUpdateFloors(floors.map(floor => (floor.id === selectedFloor.id ? { ...floor, ...patch } : floor)));
  };
  const addFloor = () => {
    if (!onUpdateFloors) return;
    const level = Math.max(...floors.map(floor => floor.level)) + 1;
    const id = `cellar-floor-${floors.length + 1}`;
    onUpdateFloors([...floors, {
      id, name: ka ? `სართული ${level}` : `Floor ${level}`, level,
      widthMeters: selectedFloor.widthMeters, heightMeters: selectedFloor.heightMeters, gridMeters: selectedFloor.gridMeters,
    }]);
    setSelectedFloorId(id);
  };

  /* --------------------------------------------------------------- render */

  const canvasVisible = interactive && !webglUnavailable;
  const floorFill = (() => {
    const capacity = floorVessels.reduce((sum, vessel) => sum + vessel.capacity, 0);
    const volume = floorVessels.reduce((sum, vessel) => sum + vessel.currentVolume, 0);
    return capacity > 0 ? Math.round((volume / capacity) * 100) : 0;
  })();

  return (
    <section
      ref={sectionRef}
      data-testid="winery-plan-stage"
      data-plan-view={view}
      className={`flex flex-col bg-[#5c6870] xl:flex-row ${
        fullscreen ? 'h-screen' : 'xl:h-[calc(100dvh-14rem)] xl:min-h-[38rem] xl:max-h-[54rem]'
      }`}
    >
      {/* The room keeps its own aspect: letting the inspector stretch this
          column would frame the plan for a viewport nobody is looking at. */}
      <div className={`relative flex-1 overflow-hidden ${fullscreen ? 'min-h-0' : 'min-h-[30rem] xl:min-h-0'}`}>
      <div className="absolute inset-0 overflow-hidden">
        {canvasVisible && (
          <React.Suspense fallback={null}>
            <WineryPlanCanvas
              ref={canvasRef}
              view={view}
              floor={selectedFloor}
              vessels={floorVessels}
              lots={lots}
              selectedVesselId={selectedVesselId}
              accents={accents}
              layer={layer}
              signals={signals}
              spotlight={spotlight}
              transfers={planTransfers}
              xRay={xRay}
              editing={editing}
              snapToGrid={snapToGrid}
              reduceMotion={reduceMotion}
              overlayRef={overlayRef}
              onSelectVessel={handleSelect}
              onOpenVessel={onOpenVessel}
              onMoveVessel={moveVessel}
              onZoomChange={setZoomPercent}
              onUnavailable={() => setWebglUnavailable(true)}
            />
          </React.Suspense>
        )}

        {/* Vessel chips. The canvas positions these each frame; without WebGL
            they keep the flat plan coordinates they are rendered with. */}
        <div
          ref={overlayRef}
          className="pointer-events-none absolute inset-0"
          aria-label={ka ? 'ჭურჭლის ეტიკეტები' : 'Vessel labels'}
        >
          {floorVessels.map(vessel => {
            const lot = vessel.assignedLotId ? lots.find(item => item.id === vessel.assignedLotId) : undefined;
            const percent = Math.round(vesselFillRatio(vessel) * 100);
            const selected = vessel.id === selectedVesselId;
            const batched = batchIds.includes(vessel.id);
            const marked = selected || batched || Boolean(accents[vessel.id]);
            // The chip of a dimmed-but-selected vessel stays legible: the room
            // dims honestly, the "you are here" marker does not.
            const dimmed = Boolean(spotlightSet) && !spotlightSet!.has(vessel.id) && !marked;
            const caption = labelMode === 'vessel'
              ? vessel.id
              : labelMode === 'lot'
                ? lot?.name || (ka ? 'ცარიელი' : 'Empty')
                : `${percent}% · ${vessel.currentVolume.toLocaleString()} L`;
            return (
              <button
                key={vessel.id}
                type="button"
                data-vessel-label={vessel.id}
                data-caption={caption}
                data-chip-priority={marked ? '2' : dimmed ? '0' : '1'}
                data-chip-dimmed={dimmed ? '1' : '0'}
                aria-label={`${vessel.id} · ${percent}% full`}
                aria-pressed={selected}
                onClick={event => handleSelect(vessel.id, event.shiftKey || event.metaKey || event.ctrlKey)}
                onDoubleClick={() => onOpenVessel(vessel.id)}
                className={`pointer-events-auto absolute flex max-w-[10rem] items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-black shadow-lg backdrop-blur transition-colors ${
                  selected
                    ? 'border-violet-300 bg-violet-600/95 text-white'
                    : batched
                      ? 'border-sky-300 bg-sky-600/95 text-white'
                      : 'border-white/20 bg-slate-950/80 text-slate-100 hover:border-white/50'
                }`}
                style={{
                  left: `${clamp(vessel.xGrid ?? 50, 0, 100)}%`,
                  top: `${clamp(vessel.yGrid ?? 50, 0, 100)}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/40"
                  style={{ background: lot ? WINE_SWATCH[lot.wineClass] || WINE_SWATCH.red : '#475569' }}
                />
                <span data-chip-caption className="flex items-center gap-1.5 truncate">
                  <span className="truncate">{caption}</span>
                  {labelMode !== 'status' && <span className="shrink-0 font-mono opacity-70">{percent}%</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {webglUnavailable && (
        <p className="absolute inset-x-0 top-1/2 z-10 mx-auto max-w-md -translate-y-1/2 rounded-2xl bg-slate-950/80 p-5 text-center text-xs font-bold text-slate-200">
          <Box className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          {ka
            ? 'ამ მოწყობილობაზე WebGL მიუწვდომელია — გეგმა ბრტყელ რეჟიმში მუშაობს.'
            : 'WebGL is unavailable on this device, so the plan is showing its flat fallback layout.'}
        </p>
      )}

      {/* ------------------------------------------------------------- toolbar */}
      <div className="absolute inset-x-0 top-0 z-30 border-b border-white/10 bg-[#1f313f]/94 text-white backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className={`rounded-md px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${editing ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-slate-200'}`}>
            {editing ? (ka ? 'განლაგების რედაქტირება' : 'Editing layout') : (ka ? 'ცოცხალი მარანი' : 'Live cellar')}
          </span>

          <div className="inline-flex overflow-hidden rounded-xl bg-white/10 p-0.5" aria-label={ka ? 'გეგმის ფენა' : 'Plan layer'}>
            <LayerButton active={layer === 'contents'} onClick={() => setLayer('contents')} icon={Wine}>{ka ? 'ღვინო' : 'Wine'}</LayerButton>
            <LayerButton active={layer === 'temperature'} onClick={() => setLayer('temperature')} icon={Thermometer}>{ka ? 'ტემპ.' : 'Temp.'}</LayerButton>
            <LayerButton active={layer === 'sanitation'} onClick={() => setLayer('sanitation')} icon={ShieldCheck}>{ka ? 'ჰიგიენა' : 'Hygiene'}</LayerButton>
            <LayerButton active={layer === 'work'} onClick={() => setLayer('work')} icon={ClipboardList}>{ka ? 'სამუშაო' : 'Work'}</LayerButton>
          </div>

          <button
            type="button"
            aria-pressed={xRay}
            onClick={() => setXRay(current => !current)}
            className={`inline-flex min-h-9 items-center gap-2 rounded-xl border px-3 text-[10px] font-black transition-colors ${xRay ? 'border-rose-300/40 bg-rose-400/15 text-rose-100' : 'border-white/15 text-slate-300'}`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${xRay ? 'bg-rose-300 shadow-[0_0_0_4px_rgba(253,164,175,.18)]' : 'bg-slate-500'}`} />
            X-ray
          </button>

          <label className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/15 px-2.5 text-[9px] font-black text-slate-300">
            <span>{ka ? 'წარწერა' : 'Labels'}</span>
            <select
              aria-label={ka ? 'ჭურჭლის წარწერები' : 'Vessel labels'}
              value={labelMode}
              onChange={event => setLabelMode(event.target.value as VesselLabelMode)}
              className="rounded-md bg-slate-950 px-1 py-1 text-[10px] font-black text-white outline-none"
            >
              <option value="vessel">{ka ? 'კოდი' : 'Vessel'}</option>
              <option value="lot">{ka ? 'პარტია' : 'Lot'}</option>
              <option value="status">{ka ? 'სტატუსი' : 'Status'}</option>
            </select>
          </label>

          <div className="ml-auto flex items-center gap-1.5">
            {canUpdate && !editing && (
              <button type="button" onClick={() => { setDraftVessels(vessels); setEditing(true); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-[10px] font-black hover:bg-white/20">
                <Move3d className="h-3.5 w-3.5" />{ka ? 'განლაგების შეცვლა' : 'Edit layout'}
              </button>
            )}
            {editing && (
              <>
                <button type="button" onClick={() => { setDraftVessels(vessels); setEditing(false); setDirty(false); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-[10px] font-black text-slate-200 hover:bg-white/10">
                  <RotateCcw className="h-3.5 w-3.5" />{ka ? 'გაუქმება' : 'Cancel'}
                </button>
                <button type="button" onClick={saveLayout} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-emerald-400 px-3 text-[10px] font-black text-slate-950 hover:bg-emerald-300">
                  <Save className="h-3.5 w-3.5" />{dirty ? (ka ? 'შენახვა' : 'Save layout') : (ka ? 'დასრულება' : 'Done')}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-3 py-1.5">
          <div className="flex items-center gap-1.5 overflow-x-auto" role="tablist" aria-label={ka ? 'მარნის სართულები' : 'Cellar floors'}>
            {floors.map(floor => (
              <button
                key={floor.id}
                type="button"
                role="tab"
                aria-selected={selectedFloor.id === floor.id}
                onClick={() => setSelectedFloorId(floor.id)}
                className={`min-h-9 shrink-0 rounded-lg border px-2.5 text-left ${selectedFloor.id === floor.id ? 'border-amber-300/60 bg-amber-400/15 text-amber-100' : 'border-white/10 text-slate-400 hover:border-white/30'}`}
              >
                <span className="block text-[10px] font-black">{floorDisplayName(floor, ka)}</span>
                <span className="block text-[8px] font-bold opacity-70">{levelLabel(floor.level, ka)} · {vesselsOnFloor(vessels, floors, floor.id).length}</span>
              </button>
            ))}
            {canUpdate && onUpdateFloors && (
              <button type="button" onClick={addFloor} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-dashed border-white/20 px-2.5 text-[10px] font-black text-slate-400 hover:border-amber-300 hover:text-amber-200">
                <Plus className="h-3.5 w-3.5" />{ka ? 'სართული' : 'Floor'}
              </button>
            )}
          </div>

          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-white/5 px-2 text-[9px] font-bold text-slate-300">
            <Ruler className="h-3 w-3" />{selectedFloor.widthMeters} × {selectedFloor.heightMeters} m
          </span>
          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-white/5 px-2 text-[9px] font-bold text-slate-300">
            <Grid3X3 className="h-3 w-3" />{selectedFloor.gridMeters} m
          </span>
          {canUpdate && onUpdateFloors && (
            <button type="button" onClick={() => setFloorSettingsOpen(open => !open)} aria-expanded={floorSettingsOpen} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2 text-[9px] font-black text-slate-300 hover:border-amber-300 hover:text-amber-200">
              <Pencil className="h-3 w-3" />{ka ? 'სართულის პარამეტრები' : 'Floor settings'}
            </button>
          )}
          {editing && (
            <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 px-2 text-[9px] font-black text-slate-300">
              <input type="checkbox" checked={snapToGrid} onChange={event => setSnapToGrid(event.target.checked)} className="accent-amber-400" />
              {ka ? 'ბადეზე მიბმა' : 'Snap to grid'}
            </label>
          )}

          <div className="ml-auto flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 p-1" aria-label={ka ? 'მასშტაბის მართვა' : 'Zoom controls'}>
            <button type="button" onClick={() => changeZoom(Math.max(45, zoomPercent - 15))} aria-label={ka ? 'დაპატარავება' : 'Zoom out'} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10"><ZoomOut className="h-3.5 w-3.5" /></button>
            <input
              aria-label={ka ? 'მასშტაბი' : 'Zoom level'}
              type="range"
              min="45"
              max="250"
              step="1"
              value={zoomPercent}
              onChange={event => changeZoom(Number(event.target.value))}
              className="w-20 accent-amber-400 sm:w-28"
            />
            <span className="w-9 text-center font-mono text-[9px] font-black text-slate-300">{zoomPercent}%</span>
            <button type="button" onClick={() => changeZoom(Math.min(250, zoomPercent + 15))} aria-label={ka ? 'გადიდება' : 'Zoom in'} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10"><ZoomIn className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => { canvasRef.current?.resetView(); setZoomPercent(100); }} className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-white/10 px-2 text-[9px] font-black text-slate-200 hover:bg-white/20"><Crosshair className="h-3.5 w-3.5" />{ka ? 'ჩატევა' : 'Fit'}</button>
            <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? (ka ? 'სრული ეკრანიდან გამოსვლა' : 'Exit full screen') : (ka ? 'სრულ ეკრანზე გახსნა' : 'Open full screen')} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10">
              {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {floorSettingsOpen && canUpdate && onUpdateFloors && (
          <div className="grid gap-2 border-t border-white/10 bg-slate-950/70 px-3 py-2 sm:grid-cols-4">
            <FloorField label={ka ? 'სახელი' : 'Floor name'} value={selectedFloor.name} onChange={value => updateFloor({ name: value })} />
            <FloorNumber label={ka ? 'სიგანე, მ' : 'Width, m'} value={selectedFloor.widthMeters} min={5} max={250} onChange={value => updateFloor({ widthMeters: value })} />
            <FloorNumber label={ka ? 'სიღრმე, მ' : 'Depth, m'} value={selectedFloor.heightMeters} min={5} max={250} onChange={value => updateFloor({ heightMeters: value })} />
            <FloorNumber label={ka ? 'ბადე, მ' : 'Grid, m'} value={selectedFloor.gridMeters} min={0.25} max={10} step={0.25} onChange={value => updateFloor({ gridMeters: value })} />
          </div>
        )}

        {batchIds.length > 0 && onBatchTopping && !transferSource && (
          <div role="status" className="flex flex-wrap items-center gap-3 border-t border-sky-300/40 bg-sky-500/15 px-3 py-2">
            <Layers className="h-4 w-4 text-sky-200" />
            <strong className="text-[11px] text-sky-50">{batchIds.length} {ka ? 'ჭურჭელი არჩეულია' : batchIds.length === 1 ? 'vessel selected' : 'vessels selected'}</strong>
            <span className="min-w-0 truncate text-[9px] font-semibold text-sky-200/80">{batchIds.join(' · ')}</span>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setBatchIds([])} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-sky-300/40 px-3 text-[10px] font-black text-sky-100"><X className="h-3.5 w-3.5" />{ka ? 'გასუფთავება' : 'Clear'}</button>
              <button type="button" onClick={() => onBatchTopping(batchIds)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-sky-500 px-3 text-[10px] font-black text-white"><ArrowDownToLine className="h-4 w-4" />{ka ? 'ყველას დოლივა' : 'Top all'}</button>
            </div>
          </div>
        )}

        {transferSource && (
          <div role="status" className="flex flex-wrap items-center gap-3 border-t border-violet-300/40 bg-violet-500/15 px-3 py-2">
            <ArrowLeftRight className="h-4 w-4 text-violet-200" />
            <div className="min-w-0">
              <strong className="block text-[11px] text-violet-50">
                {transferDestination ? `${transferSource.id} → ${transferDestination.id}` : (ka ? `${transferSource.id}-დან მიმღები ჭურჭელი აირჩიეთ` : `Select the destination for ${transferSource.id}`)}
              </strong>
              <span className={`block text-[9px] font-semibold ${transferIssue ? 'text-rose-200' : 'text-violet-200/80'}`}>
                {transferIssue || (transferDestination
                  ? (ka ? `უსაფრთხო მაქსიმუმი: ${transferableVolume.toLocaleString()} ლ` : `Safe maximum: ${transferableVolume.toLocaleString()} L`)
                  : (ka ? 'დააჭირეთ ცარიელ, სუფთა ჭურჭელს რუკაზე.' : 'Choose an empty, clean vessel directly on the plan.'))}
              </span>
              {transferRunFacts && (
                // What the hose actually has to do. Both numbers come off the
                // same model the plan draws the arc from.
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[9px] font-bold text-violet-200/70">
                  <span>{ka ? 'შლანგი' : 'Hose'} ≈ {transferRunFacts.hoseMeters.toFixed(1)} m</span>
                  <span aria-hidden="true">·</span>
                  {transferRunFacts.gravityFed ? (
                    <span className="text-emerald-200">{ka ? 'თვითდინებით' : 'Gravity-fed'}</span>
                  ) : (
                    <span className="text-amber-200">
                      {ka
                        ? `ტუმბო საჭიროა · აწევა ${transferRunFacts.liftMeters.toFixed(1)} მ`
                        : `Needs the pump · ${transferRunFacts.liftMeters.toFixed(1)} m lift`}
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => { setTransferSourceId(null); setTransferDestinationId(null); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-violet-300/40 px-3 text-[10px] font-black text-violet-100"><X className="h-3.5 w-3.5" />{ka ? 'გაუქმება' : 'Cancel'}</button>
              {transferDestination && (
                <button
                  type="button"
                  disabled={Boolean(transferIssue) || transferableVolume <= 0}
                  onClick={() => {
                    if (!transferDestination) return;
                    if (onRecordTransfer) onRecordTransfer(transferSource.id, transferDestination.id, transferableVolume);
                    else onPlanTransfer?.(transferSource.id, transferDestination.id, 'racking');
                    setTransferSourceId(null);
                    setTransferDestinationId(null);
                  }}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-violet-500 px-3 text-[10px] font-black text-white disabled:opacity-40"
                >
                  <ArrowRight className="h-4 w-4" />{onRecordTransfer ? (ka ? 'გადატანის ჩაწერა' : 'Record transfer') : (ka ? 'გადატანის გაგრძელება' : 'Continue transfer')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-3 left-3 z-20 max-w-60 rounded-xl border border-white/10 bg-slate-950/80 p-2.5 text-slate-200 shadow-xl backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[8px] font-black uppercase tracking-[0.14em] text-slate-400">
            {layer === 'contents' ? (ka ? 'ღვინო' : 'Wine')
              : layer === 'temperature' ? (ka ? 'ტემპერატურა' : 'Temperature')
                : layer === 'sanitation' ? (ka ? 'ჰიგიენა' : 'Hygiene') : (ka ? 'სამუშაო' : 'Work')}
          </span>
          {focus && onFocusChange && (
            <button
              type="button"
              onClick={() => onFocusChange(null)}
              className="inline-flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[8px] font-black text-amber-200 hover:bg-white/10"
            >
              {ka ? FOCUS_LABEL[focus].ka : FOCUS_LABEL[focus].en}
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        <ul className="mt-1.5 space-y-1">
          {layerBands(layer).map(band => {
            const count = bandCounts.get(band) || 0;
            return (
              <li key={band} className={`flex items-center gap-1.5 text-[9px] font-bold ${count ? 'text-slate-200' : 'text-slate-500'}`}>
                <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/25" style={swatchStyle(band)} />
                <span className="min-w-0 flex-1 truncate">{ka ? BAND_LABEL[band].ka : BAND_LABEL[band].en}</span>
                <span className="shrink-0 font-mono tabular-nums opacity-70">{count}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="pointer-events-none absolute bottom-3 left-72 z-20 hidden max-w-xs rounded-xl bg-slate-950/70 px-3 py-2 text-[9px] font-semibold leading-4 text-slate-300 backdrop-blur 2xl:block">
        {editing
          ? (ka ? 'გადაათრიეთ ჭურჭელი იატაკზე. ორმაგი დაწკაპუნება — დეტალები.' : 'Drag vessels across the floor. Double-click opens the vessel.')
          : view === '3d'
            ? (ka ? 'მოატრიალეთ ხედი, ბორბალი — მასშტაბი. Shift+დაწკაპუნება — ჯგუფი.' : 'Drag to orbit, scroll to zoom, Shift-click to build a batch.')
            : (ka ? 'იგივე 3D ოთახი პირდაპირ ზემოდან. Shift+დაწკაპუნება — ჯგუფი.' : 'The same 3D room seen from straight above. Shift-click to build a batch.')}
      </p>
      </div>

      {/* ----------------------------------------------------------- inspector */}
      <aside className="flex max-h-[26rem] flex-col overflow-hidden border-t border-slate-300/70 bg-white xl:h-full xl:max-h-none xl:w-[22rem] xl:shrink-0 xl:border-l xl:border-t-0 dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-700">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-[11px] text-slate-900 dark:text-white">{ka ? 'არჩეული ჭურჭელი' : 'Selected vessel'}</strong>
            <span className="text-[8px] font-black uppercase tracking-wider text-slate-400">
              {floorVessels.length} {ka ? 'ობიექტი' : 'objects'} · {floorFill}% {ka ? 'შევსება' : 'full'}
            </span>
          </div>
          <label className="relative mt-2 block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <select
              aria-label={ka ? 'ჭურჭლის პოვნა გეგმაზე' : 'Find vessel on plan'}
              value={selectedVessel?.id || ''}
              onChange={event => event.target.value && focusVessel(event.target.value)}
              className="min-h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-2 text-[11px] font-black outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="" disabled>{ka ? 'ჭურჭლის პოვნა…' : 'Find a vessel…'}</option>
              {floorVessels.map(vessel => (
                <option key={vessel.id} value={vessel.id}>{vessel.id} · {vessel.assignedLotId || (ka ? 'თავისუფალი' : 'available')}</option>
              ))}
            </select>
          </label>
        </div>

        {selectedVessel && selectedSettings ? (
          <div className="flex-1 overflow-y-auto p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950 dark:text-white">{selectedVessel.id}</h2>
                <p className="mt-0.5 text-[10px] font-semibold text-slate-500">{modelLabel(selectedSettings.model, ka)} · {selectedVessel.capacity.toLocaleString()} L</p>
              </div>
              <span className={`rounded-lg px-2 py-1 text-[8px] font-black uppercase ${selectedVessel.cleaningStatus === 'clean' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{selectedVessel.cleaningStatus}</span>
            </div>

            {selectedCollisions.length > 0 && (
              <div role="alert" className="mt-3 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-[10px] font-bold text-rose-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{ka ? `იკვეთება: ${selectedCollisions.join(', ')}` : `Footprint overlaps ${selectedCollisions.join(', ')}. Move or resize before finalizing the room.`}</span>
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <MiniFact label={ka ? 'შიგთავსი' : 'Contents'} value={selectedLot?.name || (ka ? 'ცარიელი' : 'Empty')} />
              <MiniFact label={ka ? 'მოცულობა' : 'Volume'} value={`${selectedVessel.currentVolume.toLocaleString()} L`} />
              <MiniFact label={ka ? 'შევსება' : 'Fill'} value={`${Math.round(vesselFillRatio(selectedVessel) * 100)}%`} />
              <MiniFact label={ka ? 'ტემპერატურა' : 'Temperature'} value={`${selectedVessel.temperature}°C`} />
              <MiniFact label={ka ? 'ღია სამუშაო' : 'Open work'} value={String(selectedWork.length)} />
              <MiniFact label={ka ? 'ზომები' : 'Footprint'} value={`${selectedSettings.widthMeters.toFixed(1)} × ${selectedSettings.depthMeters.toFixed(1)} m`} />
            </div>

            {selectedWork.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <FieldLabel>{ka ? 'დაგეგმილი სამუშაო' : 'Planned work'}</FieldLabel>
                {selectedWork.map(plan => {
                  const task = taskByPlanId.get(plan.id);
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      disabled={!onOpenProductionPlan}
                      onClick={() => onOpenProductionPlan?.(plan.id)}
                      className="flex w-full min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-2 text-left disabled:cursor-default dark:border-slate-700"
                    >
                      <ClipboardList className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[10px] text-slate-900 dark:text-white">{plan.title}</strong>
                        <span className="block truncate text-[9px] font-semibold text-slate-500">
                          {plan.startDate} · {task?.assignedTo || plan.assignedTo}
                          {task?.status === 'completed' ? ` · ${ka ? 'დასრულდა' : 'done'}` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <fieldset disabled={!editing} className="mt-3 space-y-2.5 disabled:opacity-60">
              <label className="block">
                <FieldLabel>{ka ? 'ჭურჭლის მოდელი' : 'Vessel model'}</FieldLabel>
                <select value={selectedSettings.model} onChange={event => updateSettings({ model: event.target.value as VesselPlanModel })} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-2 text-[11px] font-bold dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                  {VESSEL_PLAN_MODELS.map(model => <option key={model.id} value={model.id}>{ka ? model.ka : model.en}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField label={ka ? 'სიგანე, მ' : 'Width, m'} value={selectedSettings.widthMeters} onChange={value => updateSettings({ widthMeters: value })} min={0.2} max={20} />
                <NumberField label={ka ? 'სიღრმე, მ' : 'Depth, m'} value={selectedSettings.depthMeters} onChange={value => updateSettings({ depthMeters: value })} min={0.2} max={20} />
                <NumberField label={ka ? 'სიმაღლე, მ' : 'Height, m'} value={selectedSettings.heightMeters} onChange={value => updateSettings({ heightMeters: value })} min={0.2} max={30} />
                <NumberField label={ka ? 'მიწიდან, მ' : 'From ground, m'} value={selectedSettings.elevationMeters} onChange={value => updateSettings({ elevationMeters: value })} min={-10} max={15} />
                <NumberField
                  label="X, m"
                  value={vesselPlanWorldPosition(selectedVessel, selectedFloor).x}
                  onChange={value => patchDraft(selectedVessel.id, vesselPlanGridPosition(value, vesselPlanWorldPosition(selectedVessel, selectedFloor).z, selectedFloor))}
                  min={-selectedFloor.widthMeters / 2}
                  max={selectedFloor.widthMeters / 2}
                />
                <NumberField
                  label="Y, m"
                  value={vesselPlanWorldPosition(selectedVessel, selectedFloor).z}
                  onChange={value => patchDraft(selectedVessel.id, vesselPlanGridPosition(vesselPlanWorldPosition(selectedVessel, selectedFloor).x, value, selectedFloor))}
                  min={-selectedFloor.heightMeters / 2}
                  max={selectedFloor.heightMeters / 2}
                />
              </div>
              <label className="block">
                <div className="flex items-center justify-between">
                  <FieldLabel>{ka ? 'მობრუნება' : 'Rotation'}</FieldLabel>
                  <span className="font-mono text-[9px] font-bold text-slate-500">{Math.round(selectedSettings.rotationDegrees)}°</span>
                </div>
                <input type="range" min="0" max="359" step="1" value={selectedSettings.rotationDegrees} onChange={event => updateSettings({ rotationDegrees: Number(event.target.value) })} className="mt-1.5 w-full accent-violet-600" />
              </label>
              <label className="block">
                <FieldLabel>{ka ? 'სართული' : 'Floor assignment'}</FieldLabel>
                <select
                  value={floorIdForVessel(selectedVessel, floors)}
                  onChange={event => { patchDraft(selectedVessel.id, { cellarFloorId: event.target.value }); setSelectedFloorId(event.target.value); }}
                  className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-2 text-[11px] font-bold dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  {floors.map(floor => <option key={floor.id} value={floor.id}>{floorDisplayName(floor, ka)}</option>)}
                </select>
              </label>
            </fieldset>

            {!editing && (
              <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                <div className="grid grid-cols-2 gap-1.5">
                  {selectedLot && onOpenLot && <Action icon={Wine} label={ka ? 'პარტიის გახსნა' : 'Open wine lot'} onClick={() => onOpenLot(selectedLot.id)} />}
                  {onScheduleOperation && <Action icon={CalendarPlus} label={ka ? 'სამუშაოს დანიშვნა' : 'Assign work'} onClick={() => onScheduleOperation(selectedVessel.id)} />}
                  <Action icon={Check} label={ka ? 'ჭურჭლის დეტალები' : 'Vessel details'} onClick={() => onOpenVessel(selectedVessel.id)} />
                  {(onRecordTransfer || onPlanTransfer) && selectedVessel.currentVolume > 0 && (
                    <Action
                      icon={ArrowLeftRight}
                      label={ka ? 'გეგმაზე გადატანა' : 'Transfer on plan'}
                      onClick={() => { setTransferSourceId(selectedVessel.id); setTransferDestinationId(null); setBatchIds([]); }}
                    />
                  )}
                  {onBatchTopping && (
                    <Action
                      icon={Layers}
                      label={ka ? 'ჯგუფური არჩევა' : 'Add to batch'}
                      onClick={() => setBatchIds(current => (current.includes(selectedVessel.id) ? current : [...current, selectedVessel.id]))}
                    />
                  )}
                </div>
                <VesselOperationMenu
                  lang={lang}
                  vessel={selectedVessel}
                  lot={selectedLot}
                  onLogOperation={onLogOperation}
                  onStartTransfer={onPlanTransfer ? (sourceVesselId, operationType) => onPlanTransfer(sourceVesselId, undefined, operationType) : undefined}
                  onStartFilling={onStartFilling}
                  onOpenBottling={onOpenBottling}
                  onRecordSanitation={onRecordSanitation}
                />
              </div>
            )}
          </div>
        ) : (
          <p className="flex flex-1 items-center justify-center p-6 text-center text-[11px] font-semibold text-slate-500">
            {ka ? 'აირჩიეთ ჭურჭელი გეგმაზე.' : 'Select a vessel on the plan to inspect, operate, or move it.'}
          </p>
        )}
      </aside>
    </section>
  );
}

function LayerButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[10px] font-black transition-colors ${active ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}>
      <Icon className="h-3 w-3" />{children}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-500">{children}</span>;
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }) {
  return (
    <label>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        value={Number(value.toFixed(2))}
        min={min}
        max={max}
        step="0.1"
        onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }}
        className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-2 font-mono text-[11px] font-bold dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      />
    </label>
  );
}

function FloorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</span>
      <input value={value} maxLength={60} onChange={event => onChange(event.target.value)} aria-label={label} className="mt-1 min-h-9 w-full rounded-lg border border-white/15 bg-slate-950 px-2 text-[11px] font-bold text-white outline-none" />
    </label>
  );
}

function FloorNumber({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</span>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next) && next >= min && next <= max) onChange(next); }}
        className="mt-1 min-h-9 w-full rounded-lg border border-white/15 bg-slate-950 px-2 font-mono text-[11px] font-bold text-white outline-none"
      />
    </label>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-100 px-2.5 py-1.5 dark:bg-slate-800">
      <span className="block text-[7px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      <strong className="mt-0.5 block truncate text-[10px] text-slate-900 dark:text-white">{value}</strong>
    </div>
  );
}

function Action({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-2 text-left text-[9px] font-black text-slate-700 hover:border-violet-300 hover:text-violet-800 dark:border-slate-700 dark:text-slate-200">
      <Icon className="h-3.5 w-3.5 shrink-0" />{label}
    </button>
  );
}
