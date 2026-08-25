'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  LayoutGrid,
  Map as MapIcon,
  Move,
  RotateCcw,
  Save,
  ShieldCheck,
  Thermometer,
  Wine,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { Vessel, WineLot } from '../lib/wineryState';
import { vesselTypeLabel } from '../lib/enumLabels';
import VesselFill from './VesselFill';

type PlanLayer = 'contents' | 'temperature' | 'sanitation';

interface Position {
  x: number;
  y: number;
}

export interface CellarPlanProps {
  lang: Language;
  vessels: Vessel[];
  lots: WineLot[];
  selectedVesselId: string | null;
  onSelectVessel: (vesselId: string) => void;
  onOpenVessel: (vesselId: string) => void;
  onUpdateVessels: (vessels: Vessel[]) => void;
  canUpdate: boolean;
}

const clamp = (value: number) => Math.max(5, Math.min(95, value));
const coordinateKey = (position: Position) => `${Math.round(position.x)}:${Math.round(position.y)}`;

function automaticPositions(vessels: Vessel[]): Record<string, Position> {
  const count = Math.max(1, vessels.length);
  const columns = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(count * 1.5))));
  const rows = Math.max(1, Math.ceil(count / columns));
  const result: Record<string, Position> = {};
  vessels.forEach((vessel, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    result[vessel.id] = {
      x: columns === 1 ? 50 : 10 + (column / (columns - 1)) * 80,
      y: rows === 1 ? 50 : 14 + (row / (rows - 1)) * 72,
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
    if (!valid) {
      pending.push(vessel);
      return;
    }
    result[vessel.id] = candidate;
    used.add(coordinateKey(candidate));
  });

  const freeAutomaticPositions = Object.values(fallback).filter(position => !used.has(coordinateKey(position)));
  pending.forEach((vessel, index) => {
    const position = freeAutomaticPositions[index] || {
      x: clamp(10 + ((index * 17) % 80)),
      y: clamp(14 + ((index * 23) % 72)),
    };
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

export default function CellarPlan({
  lang,
  vessels,
  lots,
  selectedVesselId,
  onSelectVessel,
  onOpenVessel,
  onUpdateVessels,
  canUpdate,
}: CellarPlanProps) {
  const ka = lang === 'ka';
  const planRef = useRef<HTMLDivElement>(null);
  const storedPositions = useMemo(() => deriveCellarPlanPositions(vessels), [vessels]);
  const [positions, setPositions] = useState<Record<string, Position>>(storedPositions);
  const [layer, setLayer] = useState<PlanLayer>('contents');
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    setPositions(storedPositions);
  }, [editing, storedPositions]);

  const selectedVessel = vessels.find(vessel => vessel.id === selectedVesselId) || null;
  const selectedLot = selectedVessel?.assignedLotId
    ? lots.find(lot => lot.id === selectedVessel.assignedLotId) || null
    : null;

  const updatePosition = (vesselId: string, position: Position) => {
    setPositions(current => ({ ...current, [vesselId]: { x: clamp(position.x), y: clamp(position.y) } }));
    setDirty(true);
  };

  const pointerPosition = (event: React.PointerEvent): Position | null => {
    const rect = planRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  };

  const beginEditing = () => {
    setPositions(storedPositions);
    setDirty(false);
    setEditing(true);
  };

  const cancelEditing = () => {
    setPositions(storedPositions);
    setDraggingId(null);
    setDirty(false);
    setEditing(false);
  };

  const arrangeAutomatically = () => {
    setPositions(automaticPositions(vessels));
    setDirty(true);
  };

  const savePlan = () => {
    if (!dirty) {
      setEditing(false);
      return;
    }
    const lastModified = new Date().toISOString();
    onUpdateVessels(vessels.map(vessel => {
      const position = positions[vessel.id];
      if (!position) return vessel;
      return {
        ...vessel,
        xGrid: Math.round(position.x),
        yGrid: Math.round(position.y),
        lastModified,
      };
    }));
    setDraggingId(null);
    setDirty(false);
    setEditing(false);
  };

  const nudge = (event: React.KeyboardEvent, vesselId: string) => {
    if (!editing || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 5 : 2;
    const current = positions[vesselId];
    if (!current) return;
    updatePosition(vesselId, {
      x: current.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      y: current.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
    });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900" data-testid="cellar-plan">
      <header className="flex flex-col gap-3 border-b border-stone-100 p-4 dark:border-stone-800 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#651522] dark:text-amber-200">
            <MapIcon className="h-4 w-4" />
            {ka ? 'მარნის გეგმა' : 'Cellar plan'}
          </div>
          <p className="mt-1 text-xs text-stone-500">
            {editing
              ? (ka ? 'გადაადგილეთ ჭურჭლები და ბოლოს შეინახეთ გეგმა.' : 'Move vessels, then save the plan when the layout is correct.')
              : (ka ? 'ჭურჭლების ფიზიკური განლაგება და მიმდინარე მდგომარეობა.' : 'Physical vessel layout with the current recorded condition.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-stone-100 p-1 dark:bg-stone-800" aria-label={ka ? 'გეგმის ფენა' : 'Plan layer'}>
            <LayerButton active={layer === 'contents'} onClick={() => setLayer('contents')} icon={Wine}>{ka ? 'შიგთავსი' : 'Contents'}</LayerButton>
            <LayerButton active={layer === 'temperature'} onClick={() => setLayer('temperature')} icon={Thermometer}>{ka ? 'ტემპ.' : 'Temp.'}</LayerButton>
            <LayerButton active={layer === 'sanitation'} onClick={() => setLayer('sanitation')} icon={ShieldCheck}>{ka ? 'ჰიგიენა' : 'Hygiene'}</LayerButton>
          </div>
          {canUpdate && !editing && (
            <button type="button" onClick={beginEditing} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-black text-stone-700 hover:border-[#651522]/30 hover:text-[#651522] dark:border-stone-700 dark:text-stone-200">
              <Move className="h-4 w-4" />{ka ? 'გეგმის შეცვლა' : 'Edit plan'}
            </button>
          )}
          {canUpdate && editing && (
            <>
              <button type="button" onClick={arrangeAutomatically} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-black text-stone-600 dark:border-stone-700 dark:text-stone-200">
                <LayoutGrid className="h-4 w-4" />{ka ? 'ავტოგანლაგება' : 'Auto arrange'}
              </button>
              <button type="button" onClick={cancelEditing} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-xs font-black text-stone-600 dark:border-stone-700 dark:text-stone-200">
                <RotateCcw className="h-4 w-4" />{ka ? 'გაუქმება' : 'Cancel'}
              </button>
              <button type="button" onClick={savePlan} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#651522] px-4 text-xs font-black text-white hover:bg-[#7a1c2b]">
                <Save className="h-4 w-4" />{ka ? 'გეგმის შენახვა' : 'Save plan'}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="overflow-x-auto bg-stone-950 p-3 sm:p-4">
        <div
          ref={planRef}
          className="relative h-[31rem] min-w-[45rem] overflow-hidden rounded-2xl border border-white/10 bg-stone-900"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        >
          <div className="pointer-events-none absolute inset-x-5 top-4 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.18em] text-stone-600">
            <span>{ka ? 'მარნის სამუშაო სივრცე' : 'Cellar workspace'}</span>
            <span>{editing ? (ka ? 'რედაქტირების რეჟიმი' : 'Editing layout') : (ka ? 'მასშტაბის გარეშე' : 'Not to scale')}</span>
          </div>
          <div className="pointer-events-none absolute inset-x-[33%] inset-y-0 border-x border-dashed border-white/5" />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-white/5" />

          {vessels.map(vessel => {
            const position = positions[vessel.id];
            if (!position) return null;
            const lot = vessel.assignedLotId ? lots.find(item => item.id === vessel.assignedLotId) : undefined;
            const fill = vessel.capacity > 0 ? (vessel.currentVolume / vessel.capacity) * 100 : 0;
            const selected = vessel.id === selectedVesselId;
            const needsSanitation = vessel.cleaningStatus !== 'clean';
            return (
              <button
                key={vessel.id}
                type="button"
                aria-label={`${vessel.id} · ${Math.round(fill)}% ${ka ? 'შევსებული' : 'full'}`}
                aria-pressed={selected}
                onClick={() => onSelectVessel(vessel.id)}
                onKeyDown={event => nudge(event, vessel.id)}
                onPointerDown={event => {
                  if (!editing) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDraggingId(vessel.id);
                  onSelectVessel(vessel.id);
                }}
                onPointerMove={event => {
                  if (!editing || draggingId !== vessel.id) return;
                  const positionAtPointer = pointerPosition(event);
                  if (positionAtPointer) updatePosition(vessel.id, positionAtPointer);
                }}
                onPointerUp={event => {
                  if (!editing || draggingId !== vessel.id) return;
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  setDraggingId(null);
                }}
                className={`group absolute flex min-w-[5.25rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl border px-2 py-1.5 text-white shadow-lg transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${editing ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-pointer'} ${selected ? 'border-amber-300 bg-stone-800 ring-2 ring-amber-300/25' : 'border-white/10 bg-stone-950/88 hover:border-white/25 hover:bg-stone-800'}`}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
              >
                <span className="relative text-stone-200">
                  <VesselFill fillPct={fill} wineClass={lot?.wineClass || 'red'} qvevri={vessel.type === 'qvevri'} width={38} height={50} />
                  {layer === 'temperature' && <span className={`absolute -right-7 top-0 rounded-md px-1.5 py-0.5 text-[8px] font-black ${temperatureTone(vessel.temperature)}`}>{vessel.temperature}°</span>}
                  {layer === 'sanitation' && <span className={`absolute -right-6 top-0 flex h-5 w-5 items-center justify-center rounded-full ${needsSanitation ? 'bg-amber-500 text-stone-950' : 'bg-emerald-500 text-white'}`}>{needsSanitation ? '!' : <Check className="h-3 w-3" />}</span>}
                </span>
                <strong className="mt-0.5 max-w-20 truncate font-mono text-[10px]">{vessel.id}</strong>
                <span className="text-[8px] font-bold text-stone-400">{layer === 'contents' ? `${Math.round(fill)}%` : layer === 'temperature' ? `${vessel.temperature}°C` : (needsSanitation ? (ka ? 'გასარეცხი' : 'wash') : (ka ? 'სუფთა' : 'clean'))}</span>
              </button>
            );
          })}

          {vessels.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-stone-500">
              {ka ? 'გეგმაზე დასამატებელი ჭურჭელი ჯერ არ არის.' : 'There are no vessels to place on the plan.'}
            </div>
          )}
        </div>
      </div>

      {selectedVessel && (
        <div className="flex flex-col gap-3 border-t border-stone-100 p-4 dark:border-stone-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm text-stone-900 dark:text-stone-100">{selectedVessel.id}</strong>
              <span className="text-[10px] font-bold text-stone-400">{vesselTypeLabel(selectedVessel.type, lang)}</span>
            </div>
            <p className="mt-1 truncate text-xs text-stone-500">
              {selectedLot?.name || (ka ? 'თავისუფალი ჭურჭელი' : 'Available vessel')} · {selectedVessel.currentVolume.toLocaleString()} / {selectedVessel.capacity.toLocaleString()} L · {selectedVessel.locationDetails || selectedVessel.maraniLocation || (ka ? 'მდებარეობა მითითებული არ არის' : 'location not recorded')}
            </p>
          </div>
          {!editing && (
            <button type="button" onClick={() => onOpenVessel(selectedVessel.id)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#651522] px-4 text-xs font-black text-white hover:bg-[#7a1c2b]">
              {ka ? 'ჭურჭლის გახსნა' : 'Open vessel'}<ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function LayerButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-black ${active ? 'bg-white text-[#651522] shadow-sm dark:bg-stone-700 dark:text-amber-100' : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'}`}>
      <Icon className="h-3.5 w-3.5" />{children}
    </button>
  );
}
