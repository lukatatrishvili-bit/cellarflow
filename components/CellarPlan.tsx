'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Building2, Check, ClipboardList, Crosshair, DoorOpen, Droplet,
  Factory, Grid3X3, Layers3, LayoutGrid, Map as MapIcon, Maximize2, Minus,
  Move, Pencil, PlugZap, Plus, RotateCcw, Ruler, Save, Search, ShieldCheck,
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
interface Position { x: number; y: number }
interface FloorDraft { id?: string; name: string; level: string; widthMeters: string; heightMeters: string; gridMeters: string; notes: string }

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
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
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
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingObjectId, setDraggingObjectId] = useState<string | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [floorDraft, setFloorDraft] = useState<FloorDraft | null>(null);
  const [confirmDeleteFloorId, setConfirmDeleteFloorId] = useState<string | null>(null);
  const [canvasPan, setCanvasPan] = useState<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);

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

  const changeZoom = (nextZoom: number) => {
    const viewport = viewportRef.current;
    const currentZoom = zoom;
    const next = clampZoom(nextZoom);
    if (!viewport || next === currentZoom) { setZoom(next); return; }
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / (baseWidth * currentZoom);
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / (baseHeight * currentZoom);
    setZoom(next);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = centerX * baseWidth * next - viewport.clientWidth / 2;
      viewport.scrollTop = centerY * baseHeight * next - viewport.clientHeight / 2;
    });
  };

  const fitPlan = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(240, viewport.clientWidth - 36);
    const availableHeight = Math.max(240, viewport.clientHeight - 36);
    const next = clampZoom(Math.min(availableWidth / baseWidth, availableHeight / baseHeight));
    setZoom(next);
    window.requestAnimationFrame(() => { viewport.scrollLeft = 0; viewport.scrollTop = 0; });
  };

  const focusVessel = (vesselId: string) => {
    const vessel = vessels.find(item => item.id === vesselId);
    if (!vessel) return;
    const floorId = assignments[vessel.id] || primaryFloorId;
    setSelectedFloorId(floorId);
    onSelectVessel(vesselId);
    window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const position = positions[vesselId];
      if (!viewport || !position) return;
      viewport.scrollTo({ left: (position.x / 100) * canvasWidth - viewport.clientWidth / 2, top: (position.y / 100) * canvasHeight - viewport.clientHeight / 2, behavior: 'smooth' });
    });
  };

  const updatePosition = (vesselId: string, position: Position) => {
    const next = snapPlanPosition(position, selectedFloor, snapEnabled);
    setPositions(current => ({ ...current, [vesselId]: next }));
    setDirty(true);
  };
  const pointerPosition = (event: React.PointerEvent): Position | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
  };
  const updatePlanObject = (objectId: string, patch: Partial<CellarPlanObject>) => {
    setPlanObjects(current => {
      const next = (current[selectedFloor.id] || []).map(object => object.id === objectId ? { ...object, ...patch } : object);
      return { ...current, [selectedFloor.id]: normalizeCellarPlanObjects(next, selectedFloor) };
    });
    setDirty(true);
  };
  const movePlanObject = (objectId: string, position: Position) => {
    const object = floorObjects.find(item => item.id === objectId);
    if (!object) return;
    const rawX = (position.x / 100) * selectedFloor.widthMeters;
    const rawY = (position.y / 100) * selectedFloor.heightMeters;
    const xMeters = snapEnabled ? Math.round(rawX / selectedFloor.gridMeters) * selectedFloor.gridMeters : rawX;
    const yMeters = snapEnabled ? Math.round(rawY / selectedFloor.gridMeters) * selectedFloor.gridMeters : rawY;
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
  const beginEditing = () => { setPositions(storedPositions); setAssignments(storedAssignments); setPlanObjects(storedPlanObjects); setSelectedObjectId(null); setDirty(false); setEditing(true); };
  const cancelEditing = () => { setPositions(storedPositions); setAssignments(storedAssignments); setPlanObjects(storedPlanObjects); setDraggingId(null); setDraggingObjectId(null); setSelectedObjectId(null); setDirty(false); setEditing(false); };
  const arrangeAutomatically = () => { setPositions(current => ({ ...current, ...automaticPositions(floorVessels) })); setDirty(true); };
  const savePlan = () => {
    const lastModified = new Date().toISOString();
    onUpdateVessels(vessels.map(vessel => ({ ...vessel, cellarFloorId: assignments[vessel.id] || primaryFloorId, xGrid: Math.round((positions[vessel.id]?.x || 50) * 100) / 100, yGrid: Math.round((positions[vessel.id]?.y || 50) * 100) / 100, lastModified })));
    if (onUpdateFloors) onUpdateFloors(floors.map(floor => {
      const objects = normalizeCellarPlanObjects(planObjects[floor.id], floor);
      return objects.length > 0 ? { ...floor, planObjects: objects } : { ...floor, planObjects: undefined };
    }));
    setDraggingId(null); setDraggingObjectId(null); setSelectedObjectId(null); setDirty(false); setEditing(false);
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
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900" data-testid="cellar-plan">
      <header className="border-b border-stone-100 p-4 dark:border-stone-800">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#651522] dark:text-amber-200"><MapIcon className="h-4 w-4" />{ka ? 'მარნის ციფრული გეგმა' : 'Digital cellar plan'}</div><p className="mt-1 max-w-2xl text-xs leading-5 text-stone-500">{ka ? 'მასშტაბური სივრცე, სართულები და ცოცხალი სამუშაოები — ჭურჭლის ფიზიკური მდებარეობიდან ოპერაციამდე.' : 'A scaled, multi-floor workspace that connects each physical vessel to live cellar work.'}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-stone-100 p-1 dark:bg-stone-800" aria-label={ka ? 'გეგმის ფენა' : 'Plan layer'}><LayerButton active={layer === 'contents'} onClick={() => setLayer('contents')} icon={Wine}>{ka ? 'ღვინო' : 'Wine'}</LayerButton><LayerButton active={layer === 'temperature'} onClick={() => setLayer('temperature')} icon={Thermometer}>{ka ? 'ტემპ.' : 'Temp.'}</LayerButton><LayerButton active={layer === 'sanitation'} onClick={() => setLayer('sanitation')} icon={ShieldCheck}>{ka ? 'ჰიგიენა' : 'Hygiene'}</LayerButton><LayerButton active={layer === 'work'} onClick={() => setLayer('work')} icon={ClipboardList}>{ka ? 'სამუშაო' : 'Work'}</LayerButton></div>
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

      <div className="border-b border-stone-100 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-950/50"><div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-stone-500"><span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-2 dark:bg-stone-900"><Ruler className="h-3.5 w-3.5" />{selectedFloor.widthMeters} × {selectedFloor.heightMeters} m</span><span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-2 dark:bg-stone-900"><Grid3X3 className="h-3.5 w-3.5" />{selectedFloor.gridMeters} m</span>{canUpdate && onUpdateFloors && <button type="button" onClick={openEditFloor} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-[10px] font-black text-stone-600 dark:border-stone-700 dark:bg-stone-900"><Pencil className="h-3 w-3" />{ka ? 'სართულის პარამეტრები' : 'Floor settings'}</button>}{editing && <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 dark:border-stone-700 dark:bg-stone-900"><input type="checkbox" checked={snapEnabled} onChange={event => setSnapEnabled(event.target.checked)} className="accent-[#651522]" />{ka ? 'ბადეზე მიბმა' : 'Snap to grid'}</label>}</div><div className="flex items-center gap-1 self-end rounded-xl border border-stone-200 bg-white p-1 dark:border-stone-700 dark:bg-stone-900" aria-label={ka ? 'მასშტაბის მართვა' : 'Zoom controls'}><button type="button" onClick={() => changeZoom(zoom - 0.15)} aria-label={ka ? 'დაპატარავება' : 'Zoom out'} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100"><ZoomOut className="h-3.5 w-3.5" /></button><input aria-label={ka ? 'მასშტაბი' : 'Zoom level'} type="range" min="45" max="250" step="5" value={Math.round(zoom * 100)} onChange={event => changeZoom(Number(event.target.value) / 100)} className="w-24 accent-[#651522] sm:w-32" /><span className="w-10 text-center font-mono text-[9px] font-black text-stone-500">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => changeZoom(zoom + 0.15)} aria-label={ka ? 'გადიდება' : 'Zoom in'} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100"><ZoomIn className="h-3.5 w-3.5" /></button><button type="button" onClick={fitPlan} title={ka ? 'მთლიანი გეგმის ჩატევა' : 'Fit entire plan'} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-stone-100 px-2 text-[9px] font-black text-stone-600 dark:bg-stone-800"><Maximize2 className="h-3.5 w-3.5" />{ka ? 'ჩატევა' : 'Fit'}</button></div></div></div>

      <div className="grid bg-stone-950 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div ref={viewportRef} tabIndex={0} aria-label={ka ? `${floorDisplayName(selectedFloor, ka)} ინტერაქტიული გეგმა` : `${floorDisplayName(selectedFloor, ka)} interactive plan`} onKeyDown={event => { if (event.key === '+' || event.key === '=') changeZoom(zoom + 0.15); if (event.key === '-') changeZoom(zoom - 0.15); if (event.key === '0') fitPlan(); }} onWheel={event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); changeZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1)); }} onPointerDown={event => { if (editing || (event.target as HTMLElement).closest('[data-plan-vessel]')) return; const viewport = viewportRef.current; if (!viewport) return; viewport.setPointerCapture(event.pointerId); setCanvasPan({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }); }} onPointerMove={event => { const viewport = viewportRef.current; if (!viewport || !canvasPan || event.pointerId !== canvasPan.pointerId) return; viewport.scrollLeft = canvasPan.left - (event.clientX - canvasPan.x); viewport.scrollTop = canvasPan.top - (event.clientY - canvasPan.y); }} onPointerUp={event => { if (canvasPan?.pointerId !== event.pointerId) return; if (viewportRef.current?.hasPointerCapture(event.pointerId)) viewportRef.current.releasePointerCapture(event.pointerId); setCanvasPan(null); }} className={`h-[34rem] overflow-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300 ${!editing ? (canvasPan ? 'cursor-grabbing' : 'cursor-grab') : ''}`}>
          <div ref={canvasRef} className="relative overflow-hidden rounded-2xl border border-white/10 bg-stone-900 shadow-2xl" style={{ width: canvasWidth, height: canvasHeight, backgroundImage: 'linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px)', backgroundSize: `${selectedFloor.gridMeters * pxPerMeter * zoom}px ${selectedFloor.gridMeters * pxPerMeter * zoom}px` }}>
            <div className="pointer-events-none absolute inset-x-4 top-3 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.16em] text-stone-500"><span>{floorDisplayName(selectedFloor, ka)} · {levelLabel(selectedFloor.level, ka)}</span><span>{editing ? (ka ? 'განლაგების რედაქტირება' : 'Layout editing') : `${selectedFloor.widthMeters} × ${selectedFloor.heightMeters} m`}</span></div>
            <div className="pointer-events-none absolute bottom-3 left-4 flex items-center gap-2 text-[8px] font-bold text-stone-500"><span className="h-px bg-stone-500" style={{ width: selectedFloor.gridMeters * pxPerMeter * zoom * 5 }} />5 m</div>
            {[...floorObjects].sort((a, b) => Number(a.kind !== 'zone') - Number(b.kind !== 'zone')).map(object => {
              const selected = object.id === selectedObjectId;
              const ObjectIcon = fixtureIcon(object.kind);
              const width = object.kind === 'zone' ? object.widthMeters * pxPerMeter * zoom : Math.max(30, object.widthMeters * pxPerMeter * zoom);
              const height = object.kind === 'zone' ? object.heightMeters * pxPerMeter * zoom : Math.max(30, object.heightMeters * pxPerMeter * zoom);
              return <button key={object.id} type="button" data-plan-object="true" aria-label={`${object.label} · ${planObjectLabel(object.kind, ka)}`} aria-pressed={selected} onClick={() => editing && setSelectedObjectId(object.id)} onPointerDown={event => { if (!editing) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingObjectId(object.id); setSelectedObjectId(object.id); }} onPointerMove={event => { if (!editing || draggingObjectId !== object.id) return; const next = pointerPosition(event); if (next) movePlanObject(object.id, next); }} onPointerUp={event => { if (!editing || draggingObjectId !== object.id) return; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDraggingObjectId(null); }} className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center border text-left transition ${object.kind === 'zone' ? `z-0 rounded-2xl border-dashed ${zoneTone(object.zoneUse)}` : 'z-10 rounded-xl border-white/20 bg-stone-800/95 text-stone-100 shadow-lg'} ${selected ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-stone-950' : ''} ${editing ? 'pointer-events-auto cursor-move hover:border-amber-300' : 'pointer-events-none'}`} style={{ left: `${(object.xMeters / selectedFloor.widthMeters) * 100}%`, top: `${(object.yMeters / selectedFloor.heightMeters) * 100}%`, width, height, transform: `translate(-50%, -50%) rotate(${object.rotation || 0}deg)` }}><span style={{ transform: `rotate(-${object.rotation || 0}deg)` }} className={object.kind === 'zone' ? 'flex h-full w-full flex-col justify-start overflow-hidden p-2' : 'flex flex-col items-center justify-center gap-0.5'}><ObjectIcon className={object.kind === 'zone' ? 'h-4 w-4 opacity-70' : 'h-4 w-4 text-amber-200'} /><strong className={`${object.kind === 'zone' ? 'mt-1 max-w-full truncate text-[9px]' : 'max-w-[4.5rem] truncate text-[7px]'} font-black`}>{object.label}</strong>{object.kind === 'zone' && <span className="mt-auto text-[7px] font-bold opacity-60">{object.widthMeters.toFixed(1)} × {object.heightMeters.toFixed(1)} m</span>}</span></button>;
            })}
            {floorVessels.map(vessel => {
              const position = positions[vessel.id]; if (!position) return null;
              const lot = vessel.assignedLotId ? lots.find(item => item.id === vessel.assignedLotId) : undefined;
              const fill = vessel.capacity > 0 ? (vessel.currentVolume / vessel.capacity) * 100 : 0;
              const selected = vessel.id === selectedVesselId;
              const needsSanitation = vessel.cleaningStatus !== 'clean';
              const work = workByVessel.get(vessel.id) || [];
              return <button key={vessel.id} type="button" data-plan-vessel="true" aria-label={`${vessel.id} · ${Math.round(fill)}% ${ka ? 'შევსებული' : 'full'}${work.length ? ` · ${work.length} ${ka ? 'სამუშაო' : 'work items'}` : ''}`} aria-pressed={selected} onClick={() => onSelectVessel(vessel.id)} onKeyDown={event => nudge(event, vessel.id)} onPointerDown={event => { if (!editing) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingId(vessel.id); onSelectVessel(vessel.id); }} onPointerMove={event => { if (!editing || draggingId !== vessel.id) return; const next = pointerPosition(event); if (next) updatePosition(vessel.id, next); }} onPointerUp={event => { if (!editing || draggingId !== vessel.id) return; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDraggingId(null); }} className={`group absolute z-20 flex min-w-[5.5rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl border px-2 py-1.5 text-white shadow-lg transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${editing ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer'} ${selected ? 'border-amber-300 bg-stone-800 ring-2 ring-amber-300/25' : 'border-white/10 bg-stone-950/90 hover:border-white/25 hover:bg-stone-800'}`} style={{ left: `${position.x}%`, top: `${position.y}%` }}><span className="relative text-stone-200"><VesselFill fillPct={fill} wineClass={lot?.wineClass || 'red'} qvevri={vessel.type === 'qvevri'} width={38} height={50} />{layer === 'temperature' && <span className={`absolute -right-7 top-0 rounded-md px-1.5 py-0.5 text-[8px] font-black ${temperatureTone(vessel.temperature)}`}>{vessel.temperature}°</span>}{layer === 'sanitation' && <span className={`absolute -right-6 top-0 flex h-5 w-5 items-center justify-center rounded-full ${needsSanitation ? 'bg-amber-500 text-stone-950' : 'bg-emerald-500 text-white'}`}>{needsSanitation ? '!' : <Check className="h-3 w-3" />}</span>}{layer === 'work' && <span className={`absolute -right-7 top-0 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[9px] font-black ${work.length ? 'bg-violet-500 text-white' : 'bg-stone-700 text-stone-300'}`}>{work.length}</span>}</span><strong className="mt-0.5 max-w-20 truncate font-mono text-[10px]">{vessel.id}</strong><span className="text-[8px] font-bold text-stone-400">{layer === 'contents' ? `${Math.round(fill)}%` : layer === 'temperature' ? `${vessel.temperature}°C` : layer === 'sanitation' ? (needsSanitation ? (ka ? 'გასარეცხი' : 'wash') : (ka ? 'სუფთა' : 'clean')) : work.length ? `${work.length} ${ka ? 'სამუშაო' : 'work'}` : (ka ? 'თავისუფალია' : 'clear')}</span></button>;
            })}
            {floorVessels.length === 0 && <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-xs font-bold text-stone-500"><Building2 className="mb-3 h-8 w-8 text-stone-700" />{ka ? 'ამ სართულზე ჭურჭელი ჯერ არ არის.' : 'No vessels are assigned to this floor yet.'}{editing && selectedVessel && <button type="button" onClick={() => moveSelectedVessel(selectedFloor.id)} className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-[10px] text-stone-300">{ka ? 'არჩეული ჭურჭლის აქ გადმოტანა' : 'Move selected vessel here'}</button>}</div>}
          </div>
        </div>

        <CellarPlanSidebar ka={ka} editing={editing} floors={floors} floor={selectedFloor} vessels={vessels} floorVessels={floorVessels} positions={positions} assignments={assignments} selectedVesselId={selectedVesselId} workByVessel={workByVessel} onFocusVessel={focusVessel} canDeleteFloor={canUpdate && !!onUpdateFloors && floors.length > 1} confirmDeleteFloor={confirmDeleteFloorId === selectedFloor.id} onRequestDeleteFloor={() => setConfirmDeleteFloorId(selectedFloor.id)} onConfirmDeleteFloor={deleteFloor} onCancelDeleteFloor={() => setConfirmDeleteFloorId(null)} floorObjects={floorObjects} selectedObject={selectedObject} onAddObject={addPlanObject} onSelectObject={setSelectedObjectId} onUpdateObject={updatePlanObject} onRemoveObject={removePlanObject} floorCapacity={floorCapacity} floorVolume={floorVolume} floorOpenWork={floorPlanIds.size} floorSanitation={floorSanitation} />
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
}

function CellarPlanSidebar({
  ka, editing, floors, floor, vessels, floorVessels, positions, assignments, selectedVesselId,
  workByVessel, onFocusVessel, canDeleteFloor, confirmDeleteFloor, onRequestDeleteFloor,
  onConfirmDeleteFloor, onCancelDeleteFloor, floorObjects, selectedObject, onAddObject,
  onSelectObject, onUpdateObject, onRemoveObject, floorCapacity, floorVolume, floorOpenWork,
  floorSanitation,
}: CellarPlanSidebarProps) {
  const fill = floorCapacity > 0 ? Math.round((floorVolume / floorCapacity) * 100) : 0;
  if (editing) {
    return <aside className="border-t border-white/10 bg-stone-900 p-3 text-stone-200 xl:border-l xl:border-t-0" aria-label={ka ? 'გეგმის ობიექტები' : 'Layout objects'}>
      <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.14em] text-amber-200"><LayoutGrid className="h-3.5 w-3.5" />{ka ? 'მარნის ბიბლიოთეკა' : 'Winery library'}</div>
      <p className="mt-2 text-[9px] leading-4 text-stone-500">{ka ? 'დაამატეთ სივრცე ან ინფრასტრუქტურა, შემდეგ გადაათრიეთ ზუსტ ადგილას.' : 'Add a work area or utility, then drag it into its exact position.'}</p>
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
    <div className="relative mt-3 h-36 overflow-hidden rounded-xl border border-white/10 bg-stone-950" aria-label={ka ? 'სართულის მინი რუკა' : 'Floor mini map'}>{floorObjects.filter(object => object.kind === 'zone').map(object => <span key={object.id} className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded border border-dashed ${zoneTone(object.zoneUse)}`} style={{ left: `${(object.xMeters / floor.widthMeters) * 100}%`, top: `${(object.yMeters / floor.heightMeters) * 100}%`, width: `${(object.widthMeters / floor.widthMeters) * 100}%`, height: `${(object.heightMeters / floor.heightMeters) * 100}%` }} />)}{floorVessels.map(vessel => { const position = positions[vessel.id]; const active = vessel.id === selectedVesselId; return position ? <button key={vessel.id} type="button" onClick={() => onFocusVessel(vessel.id)} title={vessel.id} aria-label={vessel.id} className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border ${active ? 'border-amber-200 bg-amber-400 ring-2 ring-amber-300/30' : workByVessel.get(vessel.id)?.length ? 'border-violet-300 bg-violet-500' : 'border-stone-400 bg-stone-600'}`} style={{ left: `${position.x}%`, top: `${position.y}%` }} /> : null; })}<div className="pointer-events-none absolute bottom-2 left-2 text-[8px] font-bold text-stone-600">{floor.widthMeters} × {floor.heightMeters} m</div></div>
    <div className="mt-3 space-y-2 text-[9px] text-stone-400"><p className="flex items-center gap-2"><Move className="h-3.5 w-3.5" />{ka ? 'ცარიელ სივრცეზე გადაათრიეთ — პანორამა' : 'Drag empty space to pan'}</p><p className="flex items-center gap-2"><ZoomIn className="h-3.5 w-3.5" />{ka ? 'Ctrl + ბორბალი — მასშტაბი' : 'Ctrl + wheel to zoom'}</p><p className="flex items-center gap-2"><Crosshair className="h-3.5 w-3.5" />{ka ? 'ისრები — ზუსტი გადაადგილება' : 'Arrow keys for precise placement'}</p></div>
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
