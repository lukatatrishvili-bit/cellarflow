'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Building2, Check, ClipboardList, Crosshair, DoorOpen, Droplet,
  Factory, Grid3X3, Layers3, LayoutGrid, Map as MapIcon, Maximize2, Minus,
  Minimize2, Move, Pencil, PlugZap, Plus, RotateCcw, Ruler, Save, Search, ShieldCheck,
  Thermometer, Trash2, Waves, Wine, Wrench, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type {
  CellarFloor, CellarPlanObject, CellarPlanObjectKind, CellarZoneUse, Task, Vessel, WineLot,
} from '../lib/wineryState';
import type { ProductionPlanItem } from '../lib/operationsControl';
import {
  floorIdForVessel, normalizeCellarFloors, normalizeCellarPlanObjects,
  primaryCellarFloorId, snapPlanPosition, vesselsOnFloor,
} from '../lib/cellarLayout';
import { vesselTypeLabel } from '../lib/enumLabels';
import VesselFill from './VesselFill';

type PlanLayer = 'contents' | 'temperature' | 'sanitation' | 'work';
type VesselLabelMode = 'vessel' | 'lot' | 'status';
interface Position { x: number; y: number }
interface FloorDraft { id?: string; name: string; level: string; widthMeters: string; heightMeters: string; gridMeters: string; notes: string }
interface ViewWindow { left: number; top: number; width: number; height: number }
type DragGesture =
  | { kind: 'vessel'; id: string; pointerId: number; offsetX: number; offsetY: number }
  | { kind: 'object'; id: string; pointerId: number; offsetX: number; offsetY: number };
interface PanGesture {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
  lastX: number;
  lastY: number;
  lastAt: number;
  velocityX: number;
  velocityY: number;
}
interface PinchGesture { distance: number; zoom: number; centerX: number; centerY: number }

const ZONE_USES: CellarZoneUse[] = ['general', 'receiving', 'fermentation', 'aging', 'bottling', 'laboratory', 'storage', 'utility'];
const PLAN_OBJECT_TOOLS: CellarPlanObjectKind[] = ['zone', 'door', 'drain', 'water', 'power', 'pump', 'press'];

function planObjectLabel(kind: CellarPlanObjectKind, ka: boolean): string {
  const labels: Record<CellarPlanObjectKind, [string, string]> = {
    zone: ['სამუშაო ზონა', 'Work area'], door: ['კარი', 'Door'], drain: ['სანიაღვრე', 'Drain'],
    water: ['წყლის წერტილი', 'Water point'], power: ['დენის წერტილი', 'Power point'],
    pump: ['ტუმბო', 'Pump'], press: ['საწნახელი', 'Press'],
  };
  return labels[kind][ka ? 0 : 1];
}

function zoneUseLabel(use: CellarZoneUse, ka: boolean): string {
  const labels: Record<CellarZoneUse, [string, string]> = {
    general: ['ზოგადი', 'General'], receiving: ['ყურძნის მიღება', 'Receiving'],
    fermentation: ['დუღილი', 'Fermentation'], aging: ['დავარგება', 'Aging'],
    bottling: ['ჩამოსხმა', 'Bottling'], laboratory: ['ლაბორატორია', 'Laboratory'],
    storage: ['შენახვა', 'Storage'], utility: ['ტექნიკური', 'Utility'],
  };
  return labels[use][ka ? 0 : 1];
}

function zoneTone(use: CellarZoneUse | undefined): string {
  return ({
    general: 'border-slate-400/50 bg-slate-400/10 text-slate-200', receiving: 'border-lime-400/50 bg-lime-400/10 text-lime-100',
    fermentation: 'border-violet-400/55 bg-violet-400/10 text-violet-100', aging: 'border-amber-400/50 bg-amber-400/10 text-amber-100',
    bottling: 'border-sky-400/50 bg-sky-400/10 text-sky-100', laboratory: 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100',
    storage: 'border-orange-400/50 bg-orange-400/10 text-orange-100', utility: 'border-stone-400/50 bg-stone-400/10 text-stone-100',
  } as Record<CellarZoneUse, string>)[use || 'general'];
}

function fixtureIcon(kind: CellarPlanObjectKind) {
  return ({ door: DoorOpen, drain: Droplet, water: Waves, power: PlugZap, pump: Wrench, press: Factory, zone: Building2 })[kind];
}

export interface CellarPlanProps {
  lang: Language;
  vessels: Vessel[];
  lots: WineLot[];
  floors?: CellarFloor[];
  productionPlans?: ProductionPlanItem[];
  tasks?: Task[];
  selectedVesselId: string | null;
  onSelectVessel: (vesselId: string) => void;
  onOpenVessel: (vesselId: string) => void;
  onOpenProductionPlan?: (planId: string) => void;
  onUpdateVessels: (vessels: Vessel[]) => void;
  onUpdateFloors?: (floors: CellarFloor[]) => void;
  canUpdate: boolean;
}

const clamp = (value: number) => Math.max(3, Math.min(97, value));
const clampZoom = (value: number) => Math.max(0.45, Math.min(2.5, value));
const coordinateKey = (position: Position) => `${Math.round(position.x)}:${Math.round(position.y)}`;

function automaticPositions(vessels: Vessel[]): Record<string, Position> {
  const count = Math.max(1, vessels.length);
  const columns = Math.min(7, Math.max(2, Math.ceil(Math.sqrt(count * 1.6))));
  const rows = Math.max(1, Math.ceil(count / columns));
  const result: Record<string, Position> = {};
  vessels.forEach((vessel, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    result[vessel.id] = {
      x: columns === 1 ? 50 : 9 + (column / (columns - 1)) * 82,
      y: rows === 1 ? 50 : 13 + (row / (rows - 1)) * 74,
    };
  });
  return result;
}

function wineMapColor(wineClass: string | undefined): { liquid: string; light: string } {
  return ({
    red: { liquid: '#771a2d', light: '#b54d62' },
    amber: { liquid: '#b56e18', light: '#e0a347' },
    qvevri: { liquid: '#a45f27', light: '#d59755' },
    white: { liquid: '#c4a947', light: '#e5d17d' },
    rose: { liquid: '#c75f76', light: '#ed9cab' },
    sparkling: { liquid: '#cdb46d', light: '#efe0a9' },
    fortified: { liquid: '#702817', light: '#ad6048' },
    base_wine: { liquid: '#8f8357', light: '#c3b98b' },
  } as Record<string, { liquid: string; light: string }>)[wineClass || 'red'] || { liquid: '#771a2d', light: '#b54d62' };
}

function vesselMapSize(vessel: Vessel, zoom: number): number {
  const capacityFactor = Math.max(0, Math.min(6, Math.log2(Math.max(500, vessel.capacity) / 500)));
  const typeAdjustment = vessel.type === 'barrel' ? -4 : vessel.type === 'qvevri' ? 2 : 0;
  return Math.round(Math.max(44, Math.min(96, (48 + capacityFactor * 7 + typeAdjustment) * Math.pow(zoom, 0.28))));
}

function VesselMapGlyph({
  vessel, fill, wineClass, xRay, size, layer, needsSanitation, openWork,
}: {
  vessel: Vessel;
  fill: number;
  wineClass?: string;
  xRay: boolean;
  size: number;
  layer: PlanLayer;
  needsSanitation: boolean;
  openWork: number;
}) {
  const generatedId = React.useId().replace(/:/g, '');
  const metalId = `map-metal-${generatedId}`;
  const shadowId = `map-shadow-${generatedId}`;
  const colors = wineMapColor(wineClass);
  const pct = Math.max(0, Math.min(100, fill));
  const horizontal = vessel.type === 'barrel' || vessel.shape === 'horizontal';
  const qvevri = vessel.type === 'qvevri';
  const material = vessel.type === 'barrel' ? ['#d7ad71', '#9b6636', '#5d371f']
    : qvevri ? ['#d4a071', '#a7643d', '#704127']
      : vessel.type === 'concrete' ? ['#f1f0eb', '#b9b8b2', '#777772']
        : vessel.type === 'plastic' ? ['#f8fafc', '#dbe2e8', '#8a96a0']
          : ['#f1f5f9', '#a8b0b8', '#555f68'];
  const statusColor = layer === 'temperature'
    ? vessel.temperature < 10 ? '#38bdf8' : vessel.temperature <= 20 ? '#7dd3fc' : vessel.temperature <= 25 ? '#fbbf24' : '#fb7185'
    : layer === 'sanitation' ? needsSanitation ? '#f59e0b' : '#34d399'
      : layer === 'work' ? openWork ? '#a78bfa' : '#64748b'
        : colors.light;
  const width = horizontal ? Math.round(size * 1.28) : size;
  const height = horizontal ? Math.round(size * 0.8) : size;
  const progress = pct * 2.638;
  return <svg aria-hidden="true" width={width} height={height} viewBox="0 0 100 100" className="overflow-visible drop-shadow-[0_10px_12px_rgba(0,0,0,.45)]">
    <defs>
      <radialGradient id={metalId} cx="34%" cy="27%" r="72%"><stop offset="0" stopColor={material[0]} /><stop offset="0.45" stopColor={material[1]} /><stop offset="1" stopColor={material[2]} /></radialGradient>
      <filter id={shadowId} x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="5" stdDeviation="4" floodColor="#000" floodOpacity=".48" /></filter>
    </defs>
    {horizontal ? <g filter={`url(#${shadowId})`}><rect x="5" y="18" width="90" height="64" rx="28" fill={`url(#${metalId})`} stroke={statusColor} strokeWidth="3" /><rect x="13" y="26" width="74" height="48" rx="22" fill={xRay && pct > 0 ? colors.liquid : '#111827'} fillOpacity={xRay && pct > 0 ? 0.72 : 0.12} /><path d="M28 20v60M50 18v64M72 20v60" stroke="#fff" strokeOpacity=".2" strokeWidth="2" /></g> : <g filter={`url(#${shadowId})`}><circle cx="50" cy="50" r="45" fill={`url(#${metalId})`} stroke={statusColor} strokeWidth="3" /><circle cx="50" cy="50" r="34" fill={xRay && pct > 0 ? colors.liquid : '#111827'} fillOpacity={xRay && pct > 0 ? 0.74 : 0.12} /><circle cx="50" cy="50" r="27" fill="none" stroke="#fff" strokeOpacity={qvevri ? 0.2 : 0.13} strokeWidth="2" />{qvevri && <><circle cx="50" cy="50" r="39" fill="none" stroke="#6f3e24" strokeOpacity=".5" strokeWidth="2" /><path d="M20 50h60M50 20v60" stroke="#6f3e24" strokeOpacity=".18" /></>}</g>}
    {!horizontal && <circle cx="50" cy="50" r="42" fill="none" stroke={colors.light} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${progress} 264`} transform="rotate(-90 50 50)" opacity={xRay ? 0.95 : 0.18} />}
    <circle cx="50" cy="50" r="8" fill={qvevri ? '#75452c' : '#d8dde2'} stroke="#fff" strokeOpacity=".35" strokeWidth="2" />
    <circle cx="47" cy="47" r="2" fill="#fff" fillOpacity=".55" />
  </svg>;
}

export function deriveCellarPlanPositions(vessels: Vessel[]): Record<string, Position> {
  const fallback = automaticPositions(vessels);
  const used = new Set<string>();
  const result: Record<string, Position> = {};
  const pending: Vessel[] = [];
  vessels.forEach(vessel => {
    const x = Number(vessel.xGrid);
    const y = Number(vessel.yGrid);
    const candidate = { x: clamp(x), y: clamp(y) };
    const valid = Number.isFinite(x) && Number.isFinite(y) && !used.has(coordinateKey(candidate));
    if (!valid) pending.push(vessel);
    else { result[vessel.id] = candidate; used.add(coordinateKey(candidate)); }
  });
  const free = Object.values(fallback).filter(position => !used.has(coordinateKey(position)));
  pending.forEach((vessel, index) => {
    const position = free[index] || { x: clamp(10 + ((index * 17) % 80)), y: clamp(14 + ((index * 23) % 72)) };
    result[vessel.id] = position;
    used.add(coordinateKey(position));
  });
  return result;
}

function temperatureTone(temperature: number): string {
  if (temperature < 10) return 'bg-sky-600 text-white';
  if (temperature <= 20) return 'bg-sky-100 text-sky-900';
  if (temperature <= 25) return 'bg-amber-100 text-amber-900';
  return 'bg-rose-600 text-white';
}

function floorDisplayName(floor: CellarFloor, ka: boolean): string {
  if (floor.id === 'cellar-floor-main' && floor.name === 'Main cellar') return ka ? 'მთავარი მარანი' : floor.name;
  return floor.name;
}

function levelLabel(level: number, ka: boolean): string {
  if (level === 0) return ka ? 'მიწის დონე' : 'Ground';
  return level < 0 ? `${ka ? 'სარდაფი' : 'Basement'} ${Math.abs(level)}` : `${ka ? 'სართული' : 'Floor'} ${level}`;
}

export default function CellarPlan({
  lang, vessels, lots, floors: rawFloors, productionPlans = [], tasks = [],
  selectedVesselId, onSelectVessel, onOpenVessel, onOpenProductionPlan,
  onUpdateVessels, onUpdateFloors, canUpdate,
}: CellarPlanProps) {
  const ka = lang === 'ka';
  const floors = useMemo(() => normalizeCellarFloors(rawFloors), [rawFloors]);
  const primaryFloorId = primaryCellarFloorId(floors);
  const sectionRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const dragGestureRef = useRef<DragGesture | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureFrameRef = useRef<number | null>(null);
  const gestureUpdateRef = useRef<(() => void) | null>(null);
  const inertiaFrameRef = useRef<number | null>(null);
  const zoomFeedbackTimerRef = useRef<number | null>(null);
  const viewFrameRef = useRef<number | null>(null);
  const spacePressedRef = useRef(false);
  const storedPositions = useMemo(() => deriveCellarPlanPositions(vessels), [vessels]);
  const storedAssignments = useMemo(() => Object.fromEntries(vessels.map(vessel => [vessel.id, floorIdForVessel(vessel, floors)])), [floors, vessels]);
  const storedPlanObjects = useMemo(
    () => Object.fromEntries(floors.map(floor => [floor.id, normalizeCellarPlanObjects(floor.planObjects, floor)])),
    [floors],
  );
  const [positions, setPositions] = useState<Record<string, Position>>(storedPositions);
  const [assignments, setAssignments] = useState<Record<string, string>>(storedAssignments);
  const [planObjects, setPlanObjects] = useState<Record<string, CellarPlanObject[]>>(storedPlanObjects);
  const [selectedFloorId, setSelectedFloorId] = useState(primaryFloorId);
  const [layer, setLayer] = useState<PlanLayer>('contents');
  const [xRay, setXRay] = useState(true);
  const [labelMode, setLabelMode] = useState<VesselLabelMode>('lot');
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingObjectId, setDraggingObjectId] = useState<string | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [zooming, setZooming] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [floorDraft, setFloorDraft] = useState<FloorDraft | null>(null);
  const [confirmDeleteFloorId, setConfirmDeleteFloorId] = useState<string | null>(null);
  const [canvasPan, setCanvasPan] = useState(false);
  const [pinching, setPinching] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dragGuide, setDragGuide] = useState<{ x: number; y: number; label: string } | null>(null);
  const [viewWindow, setViewWindow] = useState<ViewWindow>({ left: 0, top: 0, width: 100, height: 100 });

  const selectedFloor = floors.find(floor => floor.id === selectedFloorId) || floors[0];
  const floorVessels = useMemo(
    () => vessels.filter(vessel => (assignments[vessel.id] || primaryFloorId) === selectedFloor.id),
    [assignments, primaryFloorId, selectedFloor.id, vessels],
  );
  const floorObjects = planObjects[selectedFloor.id] || [];
  const selectedObject = floorObjects.find(object => object.id === selectedObjectId) || null;
  const selectedVessel = vessels.find(vessel => vessel.id === selectedVesselId) || null;
  const selectedVesselFloor = selectedVessel
    ? floors.find(floor => floor.id === (assignments[selectedVessel.id] || primaryFloorId)) || selectedFloor
    : selectedFloor;
  const selectedLot = selectedVessel?.assignedLotId ? lots.find(lot => lot.id === selectedVessel.assignedLotId) || null : null;
  const openPlans = useMemo(() => productionPlans.filter(plan => !['completed', 'cancelled'].includes(plan.status)), [productionPlans]);
  const workByVessel = useMemo(() => {
    const map = new Map<string, ProductionPlanItem[]>();
    openPlans.forEach(plan => plan.vesselIds.forEach(id => map.set(id, [...(map.get(id) || []), plan])));
    return map;
  }, [openPlans]);
  const taskByPlanId = useMemo(() => new Map(tasks.filter(task => task.source?.type === 'production_plan').map(task => [task.source!.id, task])), [tasks]);
  const selectedWork = selectedVessel ? workByVessel.get(selectedVessel.id) || [] : [];
  const floorPlanIds = useMemo(() => new Set(floorVessels.flatMap(vessel => (workByVessel.get(vessel.id) || []).map(plan => plan.id))), [floorVessels, workByVessel]);
  const floorCapacity = floorVessels.reduce((sum, vessel) => sum + vessel.capacity, 0);
  const floorVolume = floorVessels.reduce((sum, vessel) => sum + vessel.currentVolume, 0);
  const floorSanitation = floorVessels.filter(vessel => vessel.cleaningStatus !== 'clean').length;

  useEffect(() => {
    if (editing) return;
    setPositions(storedPositions);
    setAssignments(storedAssignments);
    setPlanObjects(storedPlanObjects);
  }, [editing, storedAssignments, storedPlanObjects, storedPositions]);
  useEffect(() => {
    if (!floors.some(floor => floor.id === selectedFloorId)) setSelectedFloorId(primaryFloorId);
  }, [floors, primaryFloorId, selectedFloorId]);
  useEffect(() => {
    if (!selectedVessel) return;
    const floorId = assignments[selectedVessel.id] || primaryFloorId;
    if (floorId !== selectedFloorId) setSelectedFloorId(floorId);
    // Only selection changes should navigate floors; manual floor navigation must remain stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVesselId]);

  const pxPerMeter = Math.max(18, 720 / selectedFloor.widthMeters, 460 / selectedFloor.heightMeters);
  const baseWidth = Math.round(selectedFloor.widthMeters * pxPerMeter);
  const baseHeight = Math.round(selectedFloor.heightMeters * pxPerMeter);
  const canvasWidth = Math.round(baseWidth * zoom);
  const canvasHeight = Math.round(baseHeight * zoom);

  const stopInertia = () => {
    if (inertiaFrameRef.current !== null) window.cancelAnimationFrame(inertiaFrameRef.current);
    inertiaFrameRef.current = null;
  };

  const scheduleGestureUpdate = (update: () => void) => {
    gestureUpdateRef.current = update;
    if (gestureFrameRef.current !== null) return;
    gestureFrameRef.current = window.requestAnimationFrame(() => {
      gestureFrameRef.current = null;
      const pending = gestureUpdateRef.current;
      gestureUpdateRef.current = null;
      pending?.();
    });
  };

  const showZoomFeedback = () => {
    setZooming(true);
    if (zoomFeedbackTimerRef.current !== null) window.clearTimeout(zoomFeedbackTimerRef.current);
    zoomFeedbackTimerRef.current = window.setTimeout(() => setZooming(false), 180);
  };

  const refreshViewWindow = useCallback(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    const viewportRect = viewport.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return;
    const left = Math.max(0, Math.min(100, ((viewportRect.left - canvasRect.left) / canvasRect.width) * 100));
    const top = Math.max(0, Math.min(100, ((viewportRect.top - canvasRect.top) / canvasRect.height) * 100));
    const right = Math.max(0, Math.min(100, ((viewportRect.right - canvasRect.left) / canvasRect.width) * 100));
    const bottom = Math.max(0, Math.min(100, ((viewportRect.bottom - canvasRect.top) / canvasRect.height) * 100));
    setViewWindow({ left, top, width: Math.max(2, right - left), height: Math.max(2, bottom - top) });
  }, []);

  const scheduleViewWindow = useCallback(() => {
    if (viewFrameRef.current !== null) return;
    viewFrameRef.current = window.requestAnimationFrame(() => {
      viewFrameRef.current = null;
      refreshViewWindow();
    });
  }, [refreshViewWindow]);

  const changeZoom = (nextZoom: number, anchor?: { clientX: number; clientY: number }) => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    const currentZoom = zoomRef.current;
    const next = clampZoom(nextZoom);
    if (Math.abs(next - currentZoom) < 0.001) return;
    stopInertia();
    const viewportRect = viewport?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    const clientX = anchor?.clientX ?? (viewportRect ? viewportRect.left + viewportRect.width / 2 : 0);
    const clientY = anchor?.clientY ?? (viewportRect ? viewportRect.top + viewportRect.height / 2 : 0);
    const normalizedX = canvasRect ? Math.max(0, Math.min(1, (clientX - canvasRect.left) / canvasRect.width)) : 0.5;
    const normalizedY = canvasRect ? Math.max(0, Math.min(1, (clientY - canvasRect.top) / canvasRect.height)) : 0.5;
    const anchorX = viewportRect ? clientX - viewportRect.left : 0;
    const anchorY = viewportRect ? clientY - viewportRect.top : 0;
    const nextCanvasWidth = baseWidth * next;
    const nextCanvasHeight = baseHeight * next;
    const nextContentWidth = viewport ? Math.max(viewport.clientWidth, nextCanvasWidth + 40) : nextCanvasWidth;
    const nextContentHeight = viewport ? Math.max(viewport.clientHeight, nextCanvasHeight + 40) : nextCanvasHeight;
    const nextCanvasLeft = (nextContentWidth - nextCanvasWidth) / 2;
    const nextCanvasTop = (nextContentHeight - nextCanvasHeight) / 2;
    zoomRef.current = next;
    setZoom(next);
    showZoomFeedback();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!viewport) return;
        viewport.scrollLeft = nextCanvasLeft + normalizedX * nextCanvasWidth - anchorX;
        viewport.scrollTop = nextCanvasTop + normalizedY * nextCanvasHeight - anchorY;
        scheduleViewWindow();
      });
    });
  };

  const fitPlan = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(240, viewport.clientWidth - 36);
    const availableHeight = Math.max(240, viewport.clientHeight - 36);
    const next = clampZoom(Math.min(availableWidth / baseWidth, availableHeight / baseHeight));
    zoomRef.current = next;
    setZoom(next);
    showZoomFeedback();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        viewport.scrollTo({ left: Math.max(0, (baseWidth * next + 40 - viewport.clientWidth) / 2), top: Math.max(0, (baseHeight * next + 40 - viewport.clientHeight) / 2), behavior: 'smooth' });
        scheduleViewWindow();
      });
    });
  };

  const navigatePlan = (x: number, y: number, behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    const viewportRect = viewport.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    viewport.scrollTo({
      left: viewport.scrollLeft + canvasRect.left + (x / 100) * canvasRect.width - viewportRect.left - viewport.clientWidth / 2,
      top: viewport.scrollTop + canvasRect.top + (y / 100) * canvasRect.height - viewportRect.top - viewport.clientHeight / 2,
      behavior,
    });
    window.setTimeout(scheduleViewWindow, behavior === 'smooth' ? 280 : 0);
  };

  const focusVessel = (vesselId: string) => {
    const vessel = vessels.find(item => item.id === vesselId);
    if (!vessel) return;
    const floorId = assignments[vessel.id] || primaryFloorId;
    setSelectedFloorId(floorId);
    onSelectVessel(vesselId);
    window.requestAnimationFrame(() => {
      const position = positions[vesselId];
      if (position) navigatePlan(position.x, position.y);
    });
  };

  const updatePosition = (vesselId: string, position: Position, snap = snapEnabled) => {
    const next = snapPlanPosition(position, selectedFloor, snap);
    setPositions(current => ({ ...current, [vesselId]: next }));
    setDirty(true);
  };
  const pointerPosition = (event: React.PointerEvent): Position | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
  };

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === sectionRef.current);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    scheduleViewWindow();
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (typeof ResizeObserver === 'undefined' || !viewport || !canvas) return undefined;
    const observer = new ResizeObserver(scheduleViewWindow);
    observer.observe(viewport);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasHeight, canvasWidth, scheduleViewWindow, selectedFloor.id]);

  useEffect(() => () => {
    if (gestureFrameRef.current !== null) window.cancelAnimationFrame(gestureFrameRef.current);
    if (inertiaFrameRef.current !== null) window.cancelAnimationFrame(inertiaFrameRef.current);
    if (viewFrameRef.current !== null) window.cancelAnimationFrame(viewFrameRef.current);
    if (zoomFeedbackTimerRef.current !== null) window.clearTimeout(zoomFeedbackTimerRef.current);
  }, []);

  const updatePlanObject = (objectId: string, patch: Partial<CellarPlanObject>) => {
    setPlanObjects(current => {
      const next = (current[selectedFloor.id] || []).map(object => object.id === objectId ? { ...object, ...patch } : object);
      return { ...current, [selectedFloor.id]: normalizeCellarPlanObjects(next, selectedFloor) };
    });
    setDirty(true);
  };
  const movePlanObject = (objectId: string, position: Position, snap = snapEnabled) => {
    const object = floorObjects.find(item => item.id === objectId);
    if (!object) return;
    const rawX = (position.x / 100) * selectedFloor.widthMeters;
    const rawY = (position.y / 100) * selectedFloor.heightMeters;
    const xMeters = snap ? Math.round(rawX / selectedFloor.gridMeters) * selectedFloor.gridMeters : rawX;
    const yMeters = snap ? Math.round(rawY / selectedFloor.gridMeters) * selectedFloor.gridMeters : rawY;
    updatePlanObject(objectId, { xMeters, yMeters });
  };
  const addPlanObject = (kind: CellarPlanObjectKind) => {
    const count = floorObjects.length;
    const isZone = kind === 'zone';
    const candidate: CellarPlanObject = {
      id: `cellar-object-${Date.now()}-${count + 1}`,
      kind,
      label: planObjectLabel(kind, ka),
      xMeters: selectedFloor.widthMeters / 2 + ((count % 5) - 2) * selectedFloor.gridMeters,
      yMeters: selectedFloor.heightMeters / 2 + ((count % 3) - 1) * selectedFloor.gridMeters,
      widthMeters: isZone ? Math.min(8, selectedFloor.widthMeters * 0.45) : kind === 'door' ? 1.2 : 1,
      heightMeters: isZone ? Math.min(5, selectedFloor.heightMeters * 0.45) : kind === 'door' ? 0.3 : 1,
      rotation: 0,
      ...(isZone ? { zoneUse: 'general' as CellarZoneUse } : {}),
    };
    const next = normalizeCellarPlanObjects([...floorObjects, candidate], selectedFloor);
    setPlanObjects(current => ({ ...current, [selectedFloor.id]: next }));
    setSelectedObjectId(next.find(object => object.id === candidate.id)?.id || null);
    setDirty(true);
  };
  const removePlanObject = (objectId: string) => {
    setPlanObjects(current => ({ ...current, [selectedFloor.id]: (current[selectedFloor.id] || []).filter(object => object.id !== objectId) }));
    setSelectedObjectId(null);
    setDirty(true);
  };
  const clearActiveGestures = () => {
    dragGestureRef.current = null;
    panGestureRef.current = null;
    pinchGestureRef.current = null;
    touchPointersRef.current.clear();
    setDraggingId(null);
    setDraggingObjectId(null);
    setDragGuide(null);
    setCanvasPan(false);
    setPinching(false);
    stopInertia();
  };
  const beginEditing = () => { clearActiveGestures(); setPositions(storedPositions); setAssignments(storedAssignments); setPlanObjects(storedPlanObjects); setSelectedObjectId(null); setDirty(false); setEditing(true); };
  const cancelEditing = () => { clearActiveGestures(); setPositions(storedPositions); setAssignments(storedAssignments); setPlanObjects(storedPlanObjects); setSelectedObjectId(null); setDirty(false); setEditing(false); };
  const arrangeAutomatically = () => { setPositions(current => ({ ...current, ...automaticPositions(floorVessels) })); setDirty(true); };
  const savePlan = () => {
    const lastModified = new Date().toISOString();
    onUpdateVessels(vessels.map(vessel => ({ ...vessel, cellarFloorId: assignments[vessel.id] || primaryFloorId, xGrid: Math.round((positions[vessel.id]?.x || 50) * 100) / 100, yGrid: Math.round((positions[vessel.id]?.y || 50) * 100) / 100, lastModified })));
    if (onUpdateFloors) onUpdateFloors(floors.map(floor => {
      const objects = normalizeCellarPlanObjects(planObjects[floor.id], floor);
      return objects.length > 0 ? { ...floor, planObjects: objects } : { ...floor, planObjects: undefined };
    }));
    clearActiveGestures(); setSelectedObjectId(null); setDirty(false); setEditing(false);
  };
  const moveSelectedVessel = (floorId: string) => {
    if (!selectedVessel) return;
    setAssignments(current => ({ ...current, [selectedVessel.id]: floorId }));
    setSelectedFloorId(floorId);
    setDirty(true);
  };
  const nudge = (event: React.KeyboardEvent, vesselId: string) => {
    if (!editing || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const multiplier = event.shiftKey ? 5 : 1;
    const current = positions[vesselId];
    if (!current) return;
    const stepX = (selectedFloor.gridMeters / selectedFloor.widthMeters) * 100 * multiplier;
    const stepY = (selectedFloor.gridMeters / selectedFloor.heightMeters) * 100 * multiplier;
    updatePosition(vesselId, { x: current.x + (event.key === 'ArrowRight' ? stepX : event.key === 'ArrowLeft' ? -stepX : 0), y: current.y + (event.key === 'ArrowDown' ? stepY : event.key === 'ArrowUp' ? -stepY : 0) });
  };

  const beginVesselDrag = (event: React.PointerEvent<HTMLButtonElement>, vesselId: string) => {
    if (!editing || event.button !== 0 || spacePressedRef.current || pinchGestureRef.current) return;
    const point = pointerPosition(event);
    const current = positions[vesselId];
    if (!point || !current) return;
    stopInertia();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragGestureRef.current = { kind: 'vessel', id: vesselId, pointerId: event.pointerId, offsetX: current.x - point.x, offsetY: current.y - point.y };
    setDraggingId(vesselId);
    setDraggingObjectId(null);
    setDragGuide({ x: current.x, y: current.y, label: `${((current.x / 100) * selectedFloor.widthMeters).toFixed(1)} × ${((current.y / 100) * selectedFloor.heightMeters).toFixed(1)} m` });
    onSelectVessel(vesselId);
  };

  const beginObjectDrag = (event: React.PointerEvent<HTMLButtonElement>, object: CellarPlanObject) => {
    if (!editing || event.button !== 0 || spacePressedRef.current || pinchGestureRef.current) return;
    const point = pointerPosition(event);
    if (!point) return;
    const currentX = (object.xMeters / selectedFloor.widthMeters) * 100;
    const currentY = (object.yMeters / selectedFloor.heightMeters) * 100;
    stopInertia();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragGestureRef.current = { kind: 'object', id: object.id, pointerId: event.pointerId, offsetX: currentX - point.x, offsetY: currentY - point.y };
    setDraggingObjectId(object.id);
    setDraggingId(null);
    setSelectedObjectId(object.id);
    setDragGuide({ x: currentX, y: currentY, label: `${object.xMeters.toFixed(1)} × ${object.yMeters.toFixed(1)} m` });
  };

  const moveDraggedEntity = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || pinchGestureRef.current) return;
    const point = pointerPosition(event);
    if (!point) return;
    const next = { x: point.x + gesture.offsetX, y: point.y + gesture.offsetY };
    scheduleGestureUpdate(() => {
      if (gesture.kind === 'vessel') updatePosition(gesture.id, next, false);
      else movePlanObject(gesture.id, next, false);
      const x = Math.max(0, Math.min(100, next.x));
      const y = Math.max(0, Math.min(100, next.y));
      setDragGuide({ x, y, label: `${((x / 100) * selectedFloor.widthMeters).toFixed(1)} × ${((y / 100) * selectedFloor.heightMeters).toFixed(1)} m` });
    });
  };

  const endDraggedEntity = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = pointerPosition(event);
    if (gestureFrameRef.current !== null) window.cancelAnimationFrame(gestureFrameRef.current);
    gestureFrameRef.current = null;
    gestureUpdateRef.current = null;
    if (point) {
      const next = { x: point.x + gesture.offsetX, y: point.y + gesture.offsetY };
      if (gesture.kind === 'vessel') updatePosition(gesture.id, next, snapEnabled);
      else movePlanObject(gesture.id, next, snapEnabled);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragGestureRef.current = null;
    setDraggingId(null);
    setDraggingObjectId(null);
    setDragGuide(null);
  };

  const beginCanvasGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (event.pointerType === 'touch') {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointersRef.current.size === 2) {
        const [first, second] = [...touchPointersRef.current.values()];
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        pinchGestureRef.current = { distance: Math.max(1, distance), zoom: zoomRef.current, centerX: (first.x + second.x) / 2, centerY: (first.y + second.y) / 2 };
        dragGestureRef.current = null;
        panGestureRef.current = null;
        setDraggingId(null);
        setDraggingObjectId(null);
        setDragGuide(null);
        setCanvasPan(false);
        setPinching(true);
        stopInertia();
        return;
      }
    }
    const overEntity = Boolean((event.target as HTMLElement).closest('[data-plan-vessel], [data-plan-object]'));
    const wantsPan = event.button === 1 || spacePressedRef.current || !overEntity;
    if (!wantsPan || event.button > 1) return;
    event.preventDefault();
    stopInertia();
    viewport.setPointerCapture(event.pointerId);
    panGestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      lastX: event.clientX,
      lastY: event.clientY,
      lastAt: performance.now(),
      velocityX: 0,
      velocityY: 0,
    };
    setCanvasPan(true);
    if (editing && !overEntity) setSelectedObjectId(null);
  };

  const moveCanvasGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const pinch = pinchGestureRef.current;
    if (pinch && touchPointersRef.current.size >= 2) {
      event.preventDefault();
      const [first, second] = [...touchPointersRef.current.values()];
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      changeZoom(pinch.zoom * (distance / pinch.distance), { clientX: centerX, clientY: centerY });
      viewport.scrollLeft -= centerX - pinch.centerX;
      viewport.scrollTop -= centerY - pinch.centerY;
      pinch.centerX = centerX;
      pinch.centerY = centerY;
      return;
    }
    const pan = panGestureRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    const now = performance.now();
    const elapsed = Math.max(1, now - pan.lastAt);
    pan.velocityX = -(event.clientX - pan.lastX) / elapsed;
    pan.velocityY = -(event.clientY - pan.lastY) / elapsed;
    pan.lastX = event.clientX;
    pan.lastY = event.clientY;
    pan.lastAt = now;
    const left = pan.left - (event.clientX - pan.x);
    const top = pan.top - (event.clientY - pan.y);
    scheduleGestureUpdate(() => {
      viewport.scrollLeft = left;
      viewport.scrollTop = top;
      scheduleViewWindow();
    });
  };

  const startPanInertia = (pan: PanGesture) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const viewport = viewportRef.current;
    if (!viewport || Math.hypot(pan.velocityX, pan.velocityY) < 0.08) return;
    let velocityX = pan.velocityX;
    let velocityY = pan.velocityY;
    let previous = performance.now();
    const glide = (now: number) => {
      const elapsed = Math.min(32, now - previous);
      previous = now;
      const beforeLeft = viewport.scrollLeft;
      const beforeTop = viewport.scrollTop;
      viewport.scrollLeft += velocityX * elapsed;
      viewport.scrollTop += velocityY * elapsed;
      if (viewport.scrollLeft === beforeLeft) velocityX = 0;
      if (viewport.scrollTop === beforeTop) velocityY = 0;
      const damping = Math.pow(0.9, elapsed / 16.67);
      velocityX *= damping;
      velocityY *= damping;
      scheduleViewWindow();
      if (Math.hypot(velocityX, velocityY) >= 0.015) inertiaFrameRef.current = window.requestAnimationFrame(glide);
      else inertiaFrameRef.current = null;
    };
    inertiaFrameRef.current = window.requestAnimationFrame(glide);
  };

  const endCanvasGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') touchPointersRef.current.delete(event.pointerId);
    if (pinchGestureRef.current) {
      if (touchPointersRef.current.size < 2) {
        pinchGestureRef.current = null;
        setPinching(false);
      }
      return;
    }
    const pan = panGestureRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (gestureFrameRef.current !== null) {
      window.cancelAnimationFrame(gestureFrameRef.current);
      gestureFrameRef.current = null;
      gestureUpdateRef.current?.();
      gestureUpdateRef.current = null;
    }
    if (viewportRef.current?.hasPointerCapture(event.pointerId)) viewportRef.current.releasePointerCapture(event.pointerId);
    panGestureRef.current = null;
    setCanvasPan(false);
    startPanInertia(pan);
  };

  const handlePlanKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ' && !event.repeat) {
      event.preventDefault();
      spacePressedRef.current = true;
    }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(zoomRef.current + 0.15); }
    if (event.key === '-') { event.preventDefault(); changeZoom(zoomRef.current - 0.15); }
    if (event.key === '0' || event.key.toLowerCase() === 'f') { event.preventDefault(); fitPlan(); }
    if (event.key === 'Escape') { setSelectedObjectId(null); setDragGuide(null); }
  };

  const handlePlanWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaMode === 2 ? event.deltaY * 120 : event.deltaY;
    const factor = Math.exp(-delta * 0.0016);
    changeZoom(zoomRef.current * factor, { clientX: event.clientX, clientY: event.clientY });
  };

  const toggleFullscreen = async () => {
    const section = sectionRef.current;
    if (!section) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await section.requestFullscreen();
  };

  const openNewFloor = () => setFloorDraft({ name: ka ? `სართული ${floors.length}` : `Floor ${floors.length}`, level: String(floors.length), widthMeters: '30', heightMeters: '18', gridMeters: '1', notes: '' });
  const openEditFloor = () => setFloorDraft({ id: selectedFloor.id, name: floorDisplayName(selectedFloor, ka), level: String(selectedFloor.level), widthMeters: String(selectedFloor.widthMeters), heightMeters: String(selectedFloor.heightMeters), gridMeters: String(selectedFloor.gridMeters), notes: selectedFloor.notes || '' });
  const saveFloor = () => {
    if (!floorDraft || !onUpdateFloors || !floorDraft.name.trim()) return;
    const existingObjects = floorDraft.id ? planObjects[floorDraft.id] : undefined;
    const nextFloor: CellarFloor = { id: floorDraft.id || `cellar-floor-${Date.now()}`, name: floorDraft.name.trim(), level: Number(floorDraft.level) || 0, widthMeters: Math.max(5, Number(floorDraft.widthMeters) || 30), heightMeters: Math.max(5, Number(floorDraft.heightMeters) || 18), gridMeters: Math.max(0.25, Number(floorDraft.gridMeters) || 1), ...(floorDraft.notes.trim() ? { notes: floorDraft.notes.trim() } : {}), ...(existingObjects?.length ? { planObjects: existingObjects } : {}) };
    const next = floorDraft.id ? floors.map(floor => floor.id === floorDraft.id ? nextFloor : floor) : [...floors, nextFloor];
    onUpdateFloors(normalizeCellarFloors(next));
    setSelectedFloorId(nextFloor.id);
    setFloorDraft(null);
  };
  const deleteFloor = () => {
    if (!onUpdateFloors || floors.length < 2) return;
    const fallback = floors.find(floor => floor.id !== selectedFloor.id)!;
    const now = new Date().toISOString();
    onUpdateVessels(vessels.map(vessel => floorIdForVessel(vessel, floors) === selectedFloor.id ? { ...vessel, cellarFloorId: fallback.id, lastModified: now } : vessel));
    onUpdateFloors(floors.filter(floor => floor.id !== selectedFloor.id));
    setSelectedFloorId(fallback.id);
    setConfirmDeleteFloorId(null);
  };

  return (
    <section ref={sectionRef} className={`overflow-hidden border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900 ${isFullscreen ? 'flex h-screen flex-col rounded-none' : 'rounded-2xl'}`} data-testid="cellar-plan">
      <header className="border-b border-stone-100 p-4 dark:border-stone-800">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#651522] dark:text-amber-200"><MapIcon className="h-4 w-4" />{ka ? 'მარნის ციფრული გეგმა' : 'Digital cellar plan'}</div><p className="mt-1 max-w-2xl text-xs leading-5 text-stone-500">{ka ? 'მასშტაბური სივრცე, სართულები და ცოცხალი სამუშაოები — ჭურჭლის ფიზიკური მდებარეობიდან ოპერაციამდე.' : 'A scaled, multi-floor workspace that connects each physical vessel to live cellar work.'}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-stone-100 p-1 dark:bg-stone-800" aria-label={ka ? 'გეგმის ფენა' : 'Plan layer'}><LayerButton active={layer === 'contents'} onClick={() => setLayer('contents')} icon={Wine}>{ka ? 'ღვინო' : 'Wine'}</LayerButton><LayerButton active={layer === 'temperature'} onClick={() => setLayer('temperature')} icon={Thermometer}>{ka ? 'ტემპ.' : 'Temp.'}</LayerButton><LayerButton active={layer === 'sanitation'} onClick={() => setLayer('sanitation')} icon={ShieldCheck}>{ka ? 'ჰიგიენა' : 'Hygiene'}</LayerButton><LayerButton active={layer === 'work'} onClick={() => setLayer('work')} icon={ClipboardList}>{ka ? 'სამუშაო' : 'Work'}</LayerButton></div>
            <button type="button" aria-pressed={xRay} onClick={() => setXRay(current => !current)} className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-[10px] font-black transition-colors ${xRay ? 'border-[#651522]/30 bg-[#fbf4f5] text-[#651522] dark:border-amber-300/30 dark:bg-amber-950/20 dark:text-amber-100' : 'border-stone-200 text-stone-500 dark:border-stone-700'}`}><span className={`h-2.5 w-2.5 rounded-full transition-all ${xRay ? 'bg-[#8c2638] shadow-[0_0_0_4px_rgba(140,38,56,.12)]' : 'bg-stone-300'}`} />X-ray</button>
            <label className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-2.5 text-[9px] font-black text-stone-500 dark:border-stone-700"><span>{ka ? 'წარწერა' : 'Labels'}</span><select aria-label={ka ? 'ჭურჭლის წარწერები' : 'Vessel labels'} value={labelMode} onChange={event => setLabelMode(event.target.value as VesselLabelMode)} className="bg-transparent text-[10px] font-black text-stone-700 outline-none dark:text-stone-200"><option value="vessel">{ka ? 'კოდი' : 'Vessel'}</option><option value="lot">{ka ? 'პარტია' : 'Lot'}</option><option value="status">{ka ? 'სტატუსი' : 'Status'}</option></select></label>
            {canUpdate && !editing && <button type="button" onClick={beginEditing} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-black text-stone-700 hover:border-[#651522]/30 hover:text-[#651522] dark:border-stone-700 dark:text-stone-200"><Move className="h-4 w-4" />{ka ? 'განლაგების შეცვლა' : 'Edit layout'}</button>}
            {canUpdate && editing && <><button type="button" onClick={arrangeAutomatically} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-black text-stone-600 dark:border-stone-700 dark:text-stone-200"><LayoutGrid className="h-4 w-4" />{ka ? 'ამ სართულის დალაგება' : 'Arrange floor'}</button><button type="button" onClick={cancelEditing} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-black text-stone-600 dark:border-stone-700 dark:text-stone-200"><RotateCcw className="h-4 w-4" />{ka ? 'გაუქმება' : 'Cancel'}</button><button type="button" onClick={savePlan} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#651522] px-4 text-xs font-black text-white hover:bg-[#7a1c2b]"><Save className="h-4 w-4" />{dirty ? (ka ? 'შენახვა' : 'Save layout') : (ka ? 'დასრულება' : 'Done')}</button></>}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label={ka ? 'მარნის სართულები' : 'Cellar floors'}>
          {floors.map(floor => { const count = vesselsOnFloor(vessels, floors, floor.id).length; return <button key={floor.id} type="button" role="tab" aria-selected={selectedFloor.id === floor.id} onClick={() => setSelectedFloorId(floor.id)} className={`min-h-10 shrink-0 rounded-xl border px-3 text-left ${selectedFloor.id === floor.id ? 'border-[#651522] bg-[#fbf4f5] text-[#651522] dark:border-amber-300 dark:bg-[#351a20] dark:text-amber-100' : 'border-stone-200 text-stone-500 dark:border-stone-700'}`}><span className="block text-[10px] font-black">{floorDisplayName(floor, ka)}</span><span className="mt-0.5 block text-[8px] font-bold opacity-65">{levelLabel(floor.level, ka)} · {count} {ka ? 'ჭურჭელი' : count === 1 ? 'vessel' : 'vessels'}</span></button>; })}
          {canUpdate && onUpdateFloors && <button type="button" onClick={openNewFloor} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-stone-300 px-3 text-[10px] font-black text-stone-500 hover:border-[#651522] hover:text-[#651522] dark:border-stone-700"><Plus className="h-3.5 w-3.5" />{ka ? 'სართული' : 'Floor'}</button>}
        </div>
      </header>

      {floorDraft && <FloorEditor draft={floorDraft} setDraft={setFloorDraft} onSave={saveFloor} onCancel={() => setFloorDraft(null)} ka={ka} isNew={!floorDraft.id} />}

      <div className="border-b border-stone-100 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-950/50"><div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-stone-500"><span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-2 dark:bg-stone-900"><Ruler className="h-3.5 w-3.5" />{selectedFloor.widthMeters} × {selectedFloor.heightMeters} m</span><span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-2 dark:bg-stone-900"><Grid3X3 className="h-3.5 w-3.5" />{selectedFloor.gridMeters} m</span>{canUpdate && onUpdateFloors && <button type="button" onClick={openEditFloor} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-[10px] font-black text-stone-600 transition-colors hover:border-[#651522]/40 hover:text-[#651522] dark:border-stone-700 dark:bg-stone-900"><Pencil className="h-3 w-3" />{ka ? 'სართულის პარამეტრები' : 'Floor settings'}</button>}{editing && <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 dark:border-stone-700 dark:bg-stone-900"><input type="checkbox" checked={snapEnabled} onChange={event => setSnapEnabled(event.target.checked)} className="accent-[#651522]" />{ka ? 'ბადეზე მიბმა' : 'Snap to grid'}</label>}{editing && dirty && <span className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-amber-100 px-2.5 text-[9px] font-black text-amber-800 dark:bg-amber-950 dark:text-amber-200"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />{ka ? 'შეუნახავი ცვლილებები' : 'Unsaved changes'}</span>}</div><div className="flex items-center gap-1 self-end rounded-xl border border-stone-200 bg-white p-1 shadow-sm dark:border-stone-700 dark:bg-stone-900" aria-label={ka ? 'მასშტაბის მართვა' : 'Zoom controls'}><button type="button" onClick={() => changeZoom(zoomRef.current - 0.15)} aria-label={ka ? 'დაპატარავება' : 'Zoom out'} className="rounded-lg p-2 text-stone-500 transition-colors hover:bg-stone-100"><ZoomOut className="h-3.5 w-3.5" /></button><input aria-label={ka ? 'მასშტაბი' : 'Zoom level'} type="range" min="45" max="250" step="1" value={Math.round(zoom * 100)} onChange={event => changeZoom(Number(event.target.value) / 100)} className="w-24 accent-[#651522] sm:w-32" /><span className={`w-10 text-center font-mono text-[9px] font-black transition-colors ${zooming ? 'text-[#651522] dark:text-amber-200' : 'text-stone-500'}`}>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => changeZoom(zoomRef.current + 0.15)} aria-label={ka ? 'გადიდება' : 'Zoom in'} className="rounded-lg p-2 text-stone-500 transition-colors hover:bg-stone-100"><ZoomIn className="h-3.5 w-3.5" /></button><button type="button" onClick={fitPlan} title={ka ? 'მთლიანი გეგმის ჩატევა' : 'Fit entire plan'} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-stone-100 px-2 text-[9px] font-black text-stone-600 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700"><Crosshair className="h-3.5 w-3.5" />{ka ? 'ჩატევა' : 'Fit'}</button><button type="button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? (ka ? 'სრული ეკრანიდან გამოსვლა' : 'Exit full screen') : (ka ? 'სრულ ეკრანზე გახსნა' : 'Open full screen')} className="rounded-lg p-2 text-stone-500 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800">{isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button></div></div></div>

      <div className={`grid bg-stone-950 xl:grid-cols-[minmax(0,1fr)_15rem] ${isFullscreen ? 'min-h-0 flex-1' : ''}`}>
        <div ref={viewportRef} tabIndex={0} aria-label={ka ? `${floorDisplayName(selectedFloor, ka)} ინტერაქტიული გეგმა` : `${floorDisplayName(selectedFloor, ka)} interactive plan`} onKeyDown={handlePlanKeyDown} onKeyUp={event => { if (event.key === ' ') spacePressedRef.current = false; }} onBlur={() => { spacePressedRef.current = false; }} onWheel={handlePlanWheel} onPointerDown={beginCanvasGesture} onPointerMove={moveCanvasGesture} onPointerUp={endCanvasGesture} onPointerCancel={endCanvasGesture} onScroll={scheduleViewWindow} className={`${isFullscreen ? 'h-full' : 'h-[34rem]'} touch-none overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300 ${canvasPan || pinching ? 'cursor-grabbing select-none' : 'cursor-grab'}`}>
          <div className="flex items-center justify-center p-5" style={{ width: `max(100%, ${canvasWidth + 40}px)`, height: `max(100%, ${canvasHeight + 40}px)` }}>
          <div ref={canvasRef} className={`relative shrink-0 overflow-hidden rounded-2xl border bg-stone-900 shadow-2xl transition-[border-color,box-shadow] duration-200 ${editing ? 'border-amber-200/20 shadow-amber-950/20' : 'border-white/10'}`} style={{ width: canvasWidth, height: canvasHeight, backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(101,21,34,.14), transparent 42%), linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px)', backgroundSize: `100% 100%, ${selectedFloor.gridMeters * pxPerMeter * zoom}px ${selectedFloor.gridMeters * pxPerMeter * zoom}px, ${selectedFloor.gridMeters * pxPerMeter * zoom}px ${selectedFloor.gridMeters * pxPerMeter * zoom}px` }}>
            <div className="pointer-events-none absolute inset-x-4 top-3 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.16em] text-stone-500"><span>{floorDisplayName(selectedFloor, ka)} · {levelLabel(selectedFloor.level, ka)}</span><span>{editing ? (ka ? 'განლაგების რედაქტირება' : 'Layout editing') : `${selectedFloor.widthMeters} × ${selectedFloor.heightMeters} m`}</span></div>
            <div className="pointer-events-none absolute bottom-3 left-4 flex items-center gap-2 text-[8px] font-bold text-stone-500"><span className="h-px bg-stone-500" style={{ width: selectedFloor.gridMeters * pxPerMeter * zoom * 5 }} />5 m</div>
            {dragGuide && <div className="pointer-events-none absolute inset-0 z-50" aria-hidden="true"><span className="absolute inset-y-0 w-px bg-amber-300/30" style={{ left: `${dragGuide.x}%` }} /><span className="absolute inset-x-0 h-px bg-amber-300/30" style={{ top: `${dragGuide.y}%` }} /><span className="absolute -translate-x-1/2 rounded-lg border border-amber-200/30 bg-stone-950/90 px-2 py-1 font-mono text-[8px] font-black text-amber-100 shadow-xl backdrop-blur" style={{ left: `${dragGuide.x}%`, top: `calc(${dragGuide.y}% + 2.75rem)` }}>{dragGuide.label}{snapEnabled ? ` · ${ka ? 'ბადე' : 'snap'}` : ''}</span></div>}
            {zooming && <div className="pointer-events-none absolute left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-stone-950/80 px-4 py-2 font-mono text-sm font-black text-white shadow-2xl backdrop-blur-md" aria-hidden="true">{Math.round(zoom * 100)}%</div>}
            {[...floorObjects].sort((a, b) => Number(a.kind !== 'zone') - Number(b.kind !== 'zone')).map(object => {
              const selected = object.id === selectedObjectId;
              const ObjectIcon = fixtureIcon(object.kind);
              const width = object.kind === 'zone' ? object.widthMeters * pxPerMeter * zoom : Math.max(30, object.widthMeters * pxPerMeter * zoom);
              const height = object.kind === 'zone' ? object.heightMeters * pxPerMeter * zoom : Math.max(30, object.heightMeters * pxPerMeter * zoom);
              return <button key={object.id} type="button" data-plan-object="true" aria-label={`${object.label} · ${planObjectLabel(object.kind, ka)}`} aria-pressed={selected} onClick={() => editing && setSelectedObjectId(object.id)} onPointerDown={event => beginObjectDrag(event, object)} onPointerMove={moveDraggedEntity} onPointerUp={endDraggedEntity} onPointerCancel={endDraggedEntity} className={`absolute flex touch-none -translate-x-1/2 -translate-y-1/2 items-center justify-center border text-left will-change-[left,top] ${draggingObjectId === object.id ? 'z-30 cursor-grabbing shadow-2xl transition-none' : 'transition-[left,top,border-color,box-shadow] duration-200 ease-out'} ${object.kind === 'zone' ? `z-0 rounded-2xl border-dashed ${zoneTone(object.zoneUse)}` : 'z-10 rounded-xl border-white/20 bg-stone-800/95 text-stone-100 shadow-lg'} ${selected ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-stone-950' : ''} ${editing ? 'pointer-events-auto cursor-grab hover:border-amber-300' : 'pointer-events-none'}`} style={{ left: `${(object.xMeters / selectedFloor.widthMeters) * 100}%`, top: `${(object.yMeters / selectedFloor.heightMeters) * 100}%`, width, height, transform: `translate(-50%, -50%) rotate(${object.rotation || 0}deg)` }}><span style={{ transform: `rotate(-${object.rotation || 0}deg)` }} className={object.kind === 'zone' ? 'flex h-full w-full flex-col justify-start overflow-hidden p-2' : 'flex flex-col items-center justify-center gap-0.5'}><ObjectIcon className={object.kind === 'zone' ? 'h-4 w-4 opacity-70' : 'h-4 w-4 text-amber-200'} /><strong className={`${object.kind === 'zone' ? 'mt-1 max-w-full truncate text-[9px]' : 'max-w-[4.5rem] truncate text-[7px]'} font-black`}>{object.label}</strong>{object.kind === 'zone' && <span className="mt-auto text-[7px] font-bold opacity-60">{object.widthMeters.toFixed(1)} × {object.heightMeters.toFixed(1)} m</span>}</span></button>;
            })}
            {floorVessels.map(vessel => {
              const position = positions[vessel.id]; if (!position) return null;
              const lot = vessel.assignedLotId ? lots.find(item => item.id === vessel.assignedLotId) : undefined;
              const fill = vessel.capacity > 0 ? (vessel.currentVolume / vessel.capacity) * 100 : 0;
              const selected = vessel.id === selectedVesselId;
              const needsSanitation = vessel.cleaningStatus !== 'clean';
              const work = workByVessel.get(vessel.id) || [];
              const mapSize = vesselMapSize(vessel, zoom);
              const statusLabel = layer === 'contents' ? `${Math.round(fill)}% · ${vessel.currentVolume.toLocaleString()} L` : layer === 'temperature' ? `${vessel.temperature}°C` : layer === 'sanitation' ? (needsSanitation ? (ka ? 'გასარეცხი' : 'To clean') : (ka ? 'სუფთა' : 'Clean')) : work.length ? `${work.length} ${ka ? 'სამუშაო' : work.length === 1 ? 'work item' : 'work items'}` : (ka ? 'სამუშაო არ არის' : 'No open work');
              const secondaryLabel = labelMode === 'lot' ? lot ? `${lot.id} · ${Math.round(fill)}%` : (ka ? 'თავისუფალი' : 'Available') : labelMode === 'status' ? statusLabel : vesselTypeLabel(vessel.type, lang);
              return <button key={vessel.id} type="button" data-plan-vessel="true" aria-label={`${vessel.id} · ${Math.round(fill)}% ${ka ? 'შევსებული' : 'full'}${work.length ? ` · ${work.length} ${ka ? 'სამუშაო' : 'work items'}` : ''}`} aria-pressed={selected} onClick={() => onSelectVessel(vessel.id)} onDoubleClick={() => { if (!editing) onOpenVessel(vessel.id); }} onKeyDown={event => nudge(event, vessel.id)} onPointerDown={event => beginVesselDrag(event, vessel.id)} onPointerMove={moveDraggedEntity} onPointerUp={endDraggedEntity} onPointerCancel={endDraggedEntity} className={`group absolute z-20 flex touch-none -translate-x-1/2 -translate-y-1/2 flex-col items-center text-white will-change-[left,top] focus-visible:outline-none ${draggingId === vessel.id ? 'z-40 cursor-grabbing scale-[1.04] transition-none' : 'transition-[left,top,transform] duration-200 ease-out hover:z-40 hover:scale-[1.04]'} ${editing ? 'cursor-grab' : 'cursor-pointer'}`} style={{ left: `${position.x}%`, top: `${position.y}%` }}><span className={`relative rounded-full transition-[filter,box-shadow] duration-200 ${selected ? 'shadow-[0_0_0_3px_rgba(252,211,77,.85),0_0_0_8px_rgba(252,211,77,.12)]' : 'group-hover:brightness-110'}`}><VesselMapGlyph vessel={vessel} fill={fill} wineClass={lot?.wineClass} xRay={xRay} size={mapSize} layer={layer} needsSanitation={needsSanitation} openWork={work.length} />{layer === 'temperature' && <span className={`absolute -right-2 top-0 rounded-md px-1.5 py-0.5 text-[8px] font-black shadow-lg ${temperatureTone(vessel.temperature)}`}>{vessel.temperature}°</span>}{layer === 'sanitation' && <span className={`absolute -right-1 top-0 flex h-5 w-5 items-center justify-center rounded-full shadow-lg ${needsSanitation ? 'bg-amber-500 text-stone-950' : 'bg-emerald-500 text-white'}`}>{needsSanitation ? '!' : <Check className="h-3 w-3" />}</span>}{layer === 'work' && <span className={`absolute -right-1 top-0 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[9px] font-black shadow-lg ${work.length ? 'bg-violet-500 text-white' : 'bg-stone-700 text-stone-300'}`}>{work.length}</span>}</span><span className={`mt-1 max-w-32 rounded-lg border px-2 py-1 text-center shadow-lg backdrop-blur-sm transition-colors ${selected ? 'border-amber-300/60 bg-stone-800/95' : 'border-white/10 bg-stone-950/90 group-hover:border-white/25 group-hover:bg-stone-900/95'}`}><strong className="block truncate font-mono text-[9px] text-white">{vessel.id}</strong><span className="mt-0.5 block max-w-28 truncate text-[7px] font-bold text-stone-300">{secondaryLabel}</span></span><span aria-hidden="true" className={`pointer-events-none absolute w-56 rounded-2xl border border-white/10 bg-stone-950/95 p-3 text-left opacity-0 shadow-2xl backdrop-blur-md transition-[opacity,transform] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${position.y < 35 ? 'top-full mt-3 translate-y-1 group-hover:translate-y-0' : 'bottom-full mb-3 -translate-y-1 group-hover:translate-y-0'} ${position.x < 18 ? 'left-0' : position.x > 82 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}><span className="flex items-center gap-3"><span className="shrink-0 text-stone-200"><VesselFill fillPct={fill} wineClass={lot?.wineClass || 'red'} qvevri={vessel.type === 'qvevri'} width={32} height={42} /></span><span className="min-w-0"><strong className="block truncate text-xs text-white">{vessel.id}</strong><span className="mt-0.5 block truncate text-[9px] font-bold text-stone-300">{lot?.name || (ka ? 'თავისუფალი ჭურჭელი' : 'Available vessel')}</span>{lot && <span className="mt-0.5 block truncate font-mono text-[8px] text-stone-500">{lot.id} · {lot.stage.replace(/_/g, ' ')}</span>}</span></span><span className="mt-3 grid grid-cols-2 gap-1.5"><span className="rounded-lg bg-white/5 px-2 py-1.5"><small className="block text-[7px] font-black uppercase text-stone-500">{ka ? 'მოცულობა' : 'Volume'}</small><strong className="mt-0.5 block text-[9px] text-stone-200">{vessel.currentVolume.toLocaleString()} / {vessel.capacity.toLocaleString()} L</strong></span><span className="rounded-lg bg-white/5 px-2 py-1.5"><small className="block text-[7px] font-black uppercase text-stone-500">{ka ? 'სტატუსი' : 'Status'}</small><strong className="mt-0.5 block truncate text-[9px] text-stone-200">{statusLabel}</strong></span></span>{lot?.createdAt && <span className="mt-2 block text-[8px] font-bold text-stone-500">{ka ? 'პირველი ჩანაწერი' : 'First recorded'} · {lot.createdAt}</span>}{!editing && <span className="mt-1.5 block text-[8px] font-bold text-amber-200">{ka ? 'ორმაგი კლიკი — ჭურჭლის გახსნა' : 'Double-click to open vessel'}</span>}</span></button>;
            })}
            {floorVessels.length === 0 && <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-xs font-bold text-stone-500"><Building2 className="mb-3 h-8 w-8 text-stone-700" />{ka ? 'ამ სართულზე ჭურჭელი ჯერ არ არის.' : 'No vessels are assigned to this floor yet.'}{editing && selectedVessel && <button type="button" onClick={() => moveSelectedVessel(selectedFloor.id)} className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-[10px] text-stone-300">{ka ? 'არჩეული ჭურჭლის აქ გადმოტანა' : 'Move selected vessel here'}</button>}</div>}
          </div>
          </div>
        </div>

        <CellarPlanSidebar ka={ka} editing={editing} floors={floors} floor={selectedFloor} vessels={vessels} floorVessels={floorVessels} positions={positions} assignments={assignments} selectedVesselId={selectedVesselId} workByVessel={workByVessel} onFocusVessel={focusVessel} canDeleteFloor={canUpdate && !!onUpdateFloors && floors.length > 1} confirmDeleteFloor={confirmDeleteFloorId === selectedFloor.id} onRequestDeleteFloor={() => setConfirmDeleteFloorId(selectedFloor.id)} onConfirmDeleteFloor={deleteFloor} onCancelDeleteFloor={() => setConfirmDeleteFloorId(null)} floorObjects={floorObjects} selectedObject={selectedObject} onAddObject={addPlanObject} onSelectObject={setSelectedObjectId} onUpdateObject={updatePlanObject} onRemoveObject={removePlanObject} floorCapacity={floorCapacity} floorVolume={floorVolume} floorOpenWork={floorPlanIds.size} floorSanitation={floorSanitation} viewWindow={viewWindow} onNavigate={navigatePlan} />
      </div>

      {selectedVessel && <div className="border-t border-stone-100 p-4 dark:border-stone-800"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-stone-900 dark:text-stone-100">{selectedVessel.id}</strong><span className="text-[10px] font-bold text-stone-400">{vesselTypeLabel(selectedVessel.type, lang)}</span>{positions[selectedVessel.id] && <span className="rounded-md bg-stone-100 px-2 py-1 font-mono text-[9px] text-stone-500 dark:bg-stone-800">{((positions[selectedVessel.id].x / 100) * selectedVesselFloor.widthMeters).toFixed(1)} × {((positions[selectedVessel.id].y / 100) * selectedVesselFloor.heightMeters).toFixed(1)} m</span>}</div><p className="mt-1 truncate text-xs text-stone-500">{selectedLot?.name || (ka ? 'თავისუფალი ჭურჭელი' : 'Available vessel')} · {selectedVessel.currentVolume.toLocaleString()} / {selectedVessel.capacity.toLocaleString()} L · {floorDisplayName(selectedVesselFloor, ka)}</p></div><div className="flex flex-wrap gap-2">{editing && <label className="flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-[10px] font-black text-stone-600 dark:border-stone-700"><Building2 className="h-3.5 w-3.5" /><select aria-label={ka ? 'ჭურჭლის სართული' : 'Vessel floor'} value={assignments[selectedVessel.id] || floors[0].id} onChange={event => moveSelectedVessel(event.target.value)} className="bg-transparent outline-none">{floors.map(floor => <option key={floor.id} value={floor.id}>{floorDisplayName(floor, ka)}</option>)}</select></label>}{!editing && <button type="button" onClick={() => onOpenVessel(selectedVessel.id)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#651522] px-4 text-xs font-black text-white hover:bg-[#7a1c2b]">{ka ? 'ჭურჭლის გახსნა' : 'Open vessel'}<ArrowRight className="h-4 w-4" /></button>}</div></div>{selectedWork.length > 0 && <div className="mt-3 grid gap-2 border-t border-stone-100 pt-3 dark:border-stone-800 sm:grid-cols-2 xl:grid-cols-3">{selectedWork.slice(0, 6).map(plan => { const linkedTask = taskByPlanId.get(plan.id); return <button key={plan.id} type="button" disabled={!onOpenProductionPlan} onClick={() => onOpenProductionPlan?.(plan.id)} className="flex min-h-12 items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/50 px-3 text-left enabled:hover:border-violet-300 dark:border-violet-900 dark:bg-violet-950/20"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200"><ClipboardList className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-[10px] text-stone-800 dark:text-stone-100">{plan.title}</strong><span className="mt-0.5 block text-[8px] font-bold text-stone-400">{plan.startDate} · {linkedTask ? (linkedTask.status === 'completed' ? (ka ? 'დავალება დასრულებულია' : 'task completed') : (ka ? 'დავალება ღიაა' : 'task open')) : (ka ? 'დავალება ჯერ არ შექმნილა' : 'no task yet')}</span></span><ArrowRight className="h-3.5 w-3.5 text-violet-400" /></button>; })}</div>}</div>}
    </section>
  );
}

interface CellarPlanSidebarProps {
  ka: boolean;
  editing: boolean;
  floors: CellarFloor[];
  floor: CellarFloor;
  vessels: Vessel[];
  floorVessels: Vessel[];
  positions: Record<string, Position>;
  assignments: Record<string, string>;
  selectedVesselId: string | null;
  workByVessel: Map<string, ProductionPlanItem[]>;
  onFocusVessel: (id: string) => void;
  canDeleteFloor: boolean;
  confirmDeleteFloor: boolean;
  onRequestDeleteFloor: () => void;
  onConfirmDeleteFloor: () => void;
  onCancelDeleteFloor: () => void;
  floorObjects: CellarPlanObject[];
  selectedObject: CellarPlanObject | null;
  onAddObject: (kind: CellarPlanObjectKind) => void;
  onSelectObject: (id: string | null) => void;
  onUpdateObject: (id: string, patch: Partial<CellarPlanObject>) => void;
  onRemoveObject: (id: string) => void;
  floorCapacity: number;
  floorVolume: number;
  floorOpenWork: number;
  floorSanitation: number;
  viewWindow: ViewWindow;
  onNavigate: (x: number, y: number) => void;
}

function CellarPlanSidebar({
  ka, editing, floors, floor, vessels, floorVessels, positions, assignments, selectedVesselId,
  workByVessel, onFocusVessel, canDeleteFloor, confirmDeleteFloor, onRequestDeleteFloor,
  onConfirmDeleteFloor, onCancelDeleteFloor, floorObjects, selectedObject, onAddObject,
  onSelectObject, onUpdateObject, onRemoveObject, floorCapacity, floorVolume, floorOpenWork,
  floorSanitation, viewWindow, onNavigate,
}: CellarPlanSidebarProps) {
  const fill = floorCapacity > 0 ? Math.round((floorVolume / floorCapacity) * 100) : 0;
  if (editing) {
    return <aside className="border-t border-white/10 bg-stone-900 p-3 text-stone-200 xl:border-l xl:border-t-0" aria-label={ka ? 'გეგმის ობიექტები' : 'Layout objects'}>
      <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.14em] text-amber-200"><LayoutGrid className="h-3.5 w-3.5" />{ka ? 'მარნის ბიბლიოთეკა' : 'Winery library'}</div>
      <p className="mt-2 text-[9px] leading-4 text-stone-500">{ka ? 'დაამატეთ ობიექტი და გადაათრიეთ ბუნებრივად. გადაადგილებისას დაიჭირეთ Space — გეგმის გადასაწევად.' : 'Add an object and drag it naturally. Hold Space while dragging to pan the plan.'}</p>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {PLAN_OBJECT_TOOLS.map(kind => { const Icon = fixtureIcon(kind); return <button key={kind} type="button" onClick={() => onAddObject(kind)} className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-stone-950 px-2.5 text-left text-[9px] font-black text-stone-300 hover:border-amber-300/50 hover:text-amber-100"><Icon className="h-3.5 w-3.5 text-amber-200" />{planObjectLabel(kind, ka)}</button>; })}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3"><span className="text-[9px] font-black uppercase tracking-[0.12em] text-stone-500">{ka ? 'ობიექტები' : 'Objects'}</span><span className="rounded-md bg-stone-800 px-2 py-1 text-[8px] font-black text-stone-400">{floorObjects.length}</span></div>
      {floorObjects.length > 0 ? <div className="mt-2 max-h-28 space-y-1 overflow-auto pr-1">{floorObjects.map(object => { const Icon = fixtureIcon(object.kind); return <button key={object.id} type="button" onClick={() => onSelectObject(object.id)} aria-pressed={selectedObject?.id === object.id} className={`flex min-h-9 w-full items-center gap-2 rounded-lg border px-2 text-left text-[9px] font-bold ${selectedObject?.id === object.id ? 'border-amber-300/50 bg-amber-300/10 text-amber-100' : 'border-white/5 bg-stone-950 text-stone-400'}`}><Icon className="h-3 w-3 shrink-0" /><span className="min-w-0 flex-1 truncate">{object.label}</span><span className="font-mono text-[7px] text-stone-600">{object.xMeters.toFixed(1)}×{object.yMeters.toFixed(1)}</span></button>; })}</div> : <p className="mt-2 rounded-xl border border-dashed border-white/10 p-3 text-center text-[9px] text-stone-600">{ka ? 'ჯერ არცერთი ობიექტი არ არის.' : 'No plan objects yet.'}</p>}
      {selectedObject && <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between"><strong className="text-[10px] text-stone-200">{ka ? 'ობიექტის პარამეტრები' : 'Object inspector'}</strong><button type="button" onClick={() => onRemoveObject(selectedObject.id)} aria-label={ka ? 'ობიექტის წაშლა' : 'Delete plan object'} className="rounded-lg p-2 text-stone-500 hover:bg-rose-950 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button></div>
        <label className="block text-[8px] font-black uppercase tracking-[0.1em] text-stone-500">{ka ? 'სახელი' : 'Label'}<input aria-label={ka ? 'ობიექტის სახელი' : 'Object label'} value={selectedObject.label} maxLength={80} onChange={event => onUpdateObject(selectedObject.id, { label: event.target.value })} className="mt-1 min-h-9 w-full rounded-lg border border-white/10 bg-stone-950 px-2 text-[10px] font-bold text-stone-200 outline-none focus:border-amber-300/60" /></label>
        {selectedObject.kind === 'zone' && <label className="block text-[8px] font-black uppercase tracking-[0.1em] text-stone-500">{ka ? 'დანიშნულება' : 'Area use'}<select aria-label={ka ? 'ზონის დანიშნულება' : 'Area use'} value={selectedObject.zoneUse || 'general'} onChange={event => onUpdateObject(selectedObject.id, { zoneUse: event.target.value as CellarZoneUse })} className="mt-1 min-h-9 w-full rounded-lg border border-white/10 bg-stone-950 px-2 text-[10px] font-bold text-stone-200">{ZONE_USES.map(use => <option key={use} value={use}>{zoneUseLabel(use, ka)}</option>)}</select></label>}
        <div className="grid grid-cols-2 gap-2"><PlanNumberField label="X" value={selectedObject.xMeters} min={(selectedObject.rotation === 90 || selectedObject.rotation === 270 ? selectedObject.heightMeters : selectedObject.widthMeters) / 2} max={floor.widthMeters - (selectedObject.rotation === 90 || selectedObject.rotation === 270 ? selectedObject.heightMeters : selectedObject.widthMeters) / 2} step={floor.gridMeters} onChange={value => onUpdateObject(selectedObject.id, { xMeters: value })} /><PlanNumberField label="Y" value={selectedObject.yMeters} min={(selectedObject.rotation === 90 || selectedObject.rotation === 270 ? selectedObject.widthMeters : selectedObject.heightMeters) / 2} max={floor.heightMeters - (selectedObject.rotation === 90 || selectedObject.rotation === 270 ? selectedObject.widthMeters : selectedObject.heightMeters) / 2} step={floor.gridMeters} onChange={value => onUpdateObject(selectedObject.id, { yMeters: value })} /><PlanNumberField label={ka ? 'სიგანე' : 'Width'} value={selectedObject.widthMeters} max={selectedObject.rotation === 90 || selectedObject.rotation === 270 ? floor.heightMeters : floor.widthMeters} step={0.25} onChange={value => onUpdateObject(selectedObject.id, { widthMeters: value })} /><PlanNumberField label={ka ? 'სიღრმე' : 'Depth'} value={selectedObject.heightMeters} max={selectedObject.rotation === 90 || selectedObject.rotation === 270 ? floor.widthMeters : floor.heightMeters} step={0.25} onChange={value => onUpdateObject(selectedObject.id, { heightMeters: value })} /></div>
        <label className="block text-[8px] font-black uppercase tracking-[0.1em] text-stone-500">{ka ? 'მობრუნება' : 'Rotation'}<select aria-label={ka ? 'ობიექტის მობრუნება' : 'Object rotation'} value={selectedObject.rotation || 0} onChange={event => onUpdateObject(selectedObject.id, { rotation: Number(event.target.value) as 0 | 90 | 180 | 270 })} className="mt-1 min-h-9 w-full rounded-lg border border-white/10 bg-stone-950 px-2 text-[10px] font-bold text-stone-200"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>
      </div>}
    </aside>;
  }

  return <aside className="border-t border-white/10 bg-stone-900 p-3 text-stone-200 xl:border-l xl:border-t-0">
    <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.14em] text-stone-500"><Layers3 className="h-3.5 w-3.5" />{ka ? 'სართულის სურათი' : 'Floor pulse'}</div>
    <div className="mt-3 grid grid-cols-2 gap-1.5"><FloorPulseMetric label={ka ? 'შევსება' : 'Fill'} value={`${fill}%`} tone="text-sky-200" /><FloorPulseMetric label={ka ? 'სამუშაო' : 'Open work'} value={String(floorOpenWork)} tone={floorOpenWork ? 'text-violet-200' : 'text-stone-300'} /><FloorPulseMetric label={ka ? 'გასარეცხი' : 'To clean'} value={String(floorSanitation)} tone={floorSanitation ? 'text-amber-200' : 'text-emerald-200'} /><FloorPulseMetric label={ka ? 'ზონები' : 'Areas'} value={String(floorObjects.filter(object => object.kind === 'zone').length)} tone="text-stone-300" /></div>
    <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3 text-[9px] font-black uppercase tracking-[0.14em] text-stone-500"><MapIcon className="h-3.5 w-3.5" />{ka ? 'ნავიგატორი' : 'Navigator'}</div>
    <label className="relative mt-3 block"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500" /><select aria-label={ka ? 'ჭურჭლის პოვნა გეგმაზე' : 'Find vessel on plan'} value={selectedVesselId || ''} onChange={event => event.target.value && onFocusVessel(event.target.value)} className="min-h-10 w-full appearance-none rounded-xl border border-white/10 bg-stone-950 pl-8 pr-2 text-[10px] font-bold text-stone-300"><option value="">{ka ? 'ჭურჭლის პოვნა…' : 'Find a vessel…'}</option>{vessels.map(vessel => <option key={vessel.id} value={vessel.id}>{vessel.id} · {floorDisplayName(floors.find(item => item.id === (assignments[vessel.id] || floors[0].id)) || floors[0], ka)}</option>)}</select></label>
    <div className="relative mt-3 h-36 overflow-hidden rounded-xl border border-white/10 bg-stone-950" role="group" aria-label={ka ? 'სართულის მინი რუკა' : 'Floor mini map'}><button type="button" aria-label={ka ? 'მინი რუკით გადაადგილება' : 'Navigate with mini map'} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); onNavigate(((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100); }} className="absolute inset-0 cursor-crosshair" />{floorObjects.filter(object => object.kind === 'zone').map(object => <span key={object.id} className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded border border-dashed ${zoneTone(object.zoneUse)}`} style={{ left: `${(object.xMeters / floor.widthMeters) * 100}%`, top: `${(object.yMeters / floor.heightMeters) * 100}%`, width: `${(object.widthMeters / floor.widthMeters) * 100}%`, height: `${(object.heightMeters / floor.heightMeters) * 100}%` }} />)}<span className="pointer-events-none absolute z-10 rounded border border-amber-200/70 bg-amber-200/10 shadow-[0_0_0_1px_rgba(0,0,0,.4)] transition-[left,top,width,height] duration-150" style={{ left: `${viewWindow.left}%`, top: `${viewWindow.top}%`, width: `${viewWindow.width}%`, height: `${viewWindow.height}%` }} />{floorVessels.map(vessel => { const position = positions[vessel.id]; const active = vessel.id === selectedVesselId; return position ? <button key={vessel.id} type="button" onClick={() => onFocusVessel(vessel.id)} title={vessel.id} aria-label={vessel.id} className={`absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-transform hover:scale-125 ${active ? 'border-amber-200 bg-amber-400 ring-2 ring-amber-300/30' : workByVessel.get(vessel.id)?.length ? 'border-violet-300 bg-violet-500' : 'border-stone-400 bg-stone-600'}`} style={{ left: `${position.x}%`, top: `${position.y}%` }} /> : null; })}<div className="pointer-events-none absolute bottom-2 left-2 text-[8px] font-bold text-stone-600">{floor.widthMeters} × {floor.heightMeters} m</div></div>
    <div className="mt-3 space-y-2 text-[9px] text-stone-400"><p className="flex items-center gap-2"><Move className="h-3.5 w-3.5" />{ka ? 'გადაათრიეთ სივრცე · Space ობიექტის ზემოთ' : 'Drag space · hold Space over objects'}</p><p className="flex items-center gap-2"><ZoomIn className="h-3.5 w-3.5" />{ka ? 'ბორბალი ან ორი თითი — რბილი მასშტაბი' : 'Wheel or pinch for fluid zoom'}</p><p className="flex items-center gap-2"><Crosshair className="h-3.5 w-3.5" />{ka ? 'F — ჩატევა · ისრები — ზუსტი სვლა' : 'F to fit · arrows for precise placement'}</p></div>
    {canDeleteFloor && <div className="mt-4 border-t border-white/10 pt-3">{confirmDeleteFloor ? <div className="rounded-xl border border-rose-900 bg-rose-950/30 p-2"><p className="text-[9px] leading-4 text-rose-200">{ka ? 'ჭურჭლები ავტომატურად გადავა სხვა სართულზე. ნამდვილად წავშალოთ?' : 'Vessels will move to another floor. Delete this floor?'}</p><div className="mt-2 flex gap-1"><button type="button" onClick={onConfirmDeleteFloor} className="min-h-8 flex-1 rounded-lg bg-rose-700 text-[9px] font-black text-white">{ka ? 'წაშლა' : 'Delete'}</button><button type="button" onClick={onCancelDeleteFloor} className="min-h-8 flex-1 rounded-lg border border-white/10 text-[9px] font-black">{ka ? 'გაუქმება' : 'Cancel'}</button></div></div> : <button type="button" onClick={onRequestDeleteFloor} className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-xl border border-white/10 text-[9px] font-black text-stone-500 hover:border-rose-900 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" />{ka ? 'სართულის წაშლა' : 'Delete floor'}</button>}</div>}
  </aside>;
}

function FloorPulseMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="rounded-xl border border-white/5 bg-stone-950 px-2.5 py-2"><span className="block text-[7px] font-black uppercase tracking-[0.1em] text-stone-600">{label}</span><strong className={`mt-0.5 block text-base ${tone}`}>{value}</strong></div>;
}

function PlanNumberField({ label, value, min = 0.25, max, step, onChange }: { label: string; value: number; min?: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="block text-[8px] font-black uppercase tracking-[0.1em] text-stone-500">{label}<span className="relative mt-1 block"><input aria-label={`${label} (m)`} type="number" min={min} max={max} step={step} value={Math.round(value * 100) / 100} onChange={event => onChange(Number(event.target.value))} className="min-h-9 w-full rounded-lg border border-white/10 bg-stone-950 px-2 pr-6 font-mono text-[10px] text-stone-200 outline-none focus:border-amber-300/60" /><span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[7px] text-stone-600">m</span></span></label>;
}

function FloorEditor({ draft, setDraft, onSave, onCancel, ka, isNew }: { draft: FloorDraft; setDraft: React.Dispatch<React.SetStateAction<FloorDraft | null>>; onSave: () => void; onCancel: () => void; ka: boolean; isNew: boolean }) {
  const update = (key: keyof FloorDraft, value: string) => setDraft(current => current ? { ...current, [key]: value } : current);
  return <div className="border-b border-[#d9c4c8] bg-[#fbf7f8] p-4 dark:border-[#5a2730] dark:bg-[#2b171c]"><div className="flex items-start justify-between gap-3"><div><strong className="text-xs text-stone-900 dark:text-white">{isNew ? (ka ? 'სართულის დამატება' : 'Add cellar floor') : (ka ? 'სართულის პარამეტრები' : 'Floor settings')}</strong><p className="mt-1 text-[10px] text-stone-500">{ka ? 'ზომები და ბადე რეალურ მეტრებში შეიყვანეთ.' : 'Enter the physical dimensions and working grid in meters.'}</p></div><button type="button" onClick={onCancel} aria-label={ka ? 'დახურვა' : 'Close'} className="rounded-lg p-2 text-stone-400"><Minus className="h-4 w-4" /></button></div><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><label className="space-y-1 lg:col-span-2"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'სახელი' : 'Name'}</span><input value={draft.name} onChange={event => update('name', event.target.value)} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950" /></label><FloorNumber label={ka ? 'დონე' : 'Level'} value={draft.level} onChange={value => update('level', value)} step="1" /><FloorNumber label={ka ? 'სიგანე, მ' : 'Width, m'} value={draft.widthMeters} onChange={value => update('widthMeters', value)} min="5" /><FloorNumber label={ka ? 'სიგრძე, მ' : 'Height, m'} value={draft.heightMeters} onChange={value => update('heightMeters', value)} min="5" /><FloorNumber label={ka ? 'ბადე, მ' : 'Grid, m'} value={draft.gridMeters} onChange={value => update('gridMeters', value)} min="0.25" step="0.25" /><label className="space-y-1 sm:col-span-2 lg:col-span-5"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'შენიშვნა' : 'Notes'}</span><input value={draft.notes} onChange={event => update('notes', event.target.value)} placeholder={ka ? 'მაგ. ქვევრების დარბაზი, სადრენაჟო ზონა…' : 'e.g. qvevri hall, drainage zone…'} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950" /></label><button type="button" onClick={onSave} disabled={!draft.name.trim()} className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-xl bg-[#651522] px-4 text-[10px] font-black text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" />{ka ? 'შენახვა' : 'Save'}</button></div></div>;
}

function FloorNumber({ label, value, onChange, min, step }: { label: string; value: string; onChange: (value: string) => void; min?: string; step?: string }) {
  return <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{label}</span><input type="number" min={min} step={step} value={value} onChange={event => onChange(event.target.value)} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950" /></label>;
}

function LayerButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-black ${active ? 'bg-white text-[#651522] shadow-sm dark:bg-stone-700 dark:text-amber-100' : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'}`}><Icon className="h-3.5 w-3.5" />{children}</button>;
}
