import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  RotateCcw,
  Settings2,
} from 'lucide-react';
import type { Language } from '../lib/i18n';

export type DashboardWidgetSpan = 4 | 6 | 8 | 12;

export interface DashboardWidgetSpec {
  id: string;
  label?: string;
  content: React.ReactNode;
  defaultSpan?: DashboardWidgetSpan;
}

interface DashboardLayoutProps {
  dashboardId: string;
  items: DashboardWidgetSpec[];
  lang: Language;
  className?: string;
  toolbar?: React.ReactNode;
}

interface StoredWidgetLayout {
  id: string;
  span: DashboardWidgetSpan;
  hidden?: boolean;
}

const ALLOWED_SPANS: DashboardWidgetSpan[] = [4, 6, 8, 12];
const SPAN_CLASS: Record<DashboardWidgetSpan, string> = {
  4: 'xl:col-span-4',
  6: 'xl:col-span-6',
  8: 'xl:col-span-8',
  12: 'xl:col-span-12',
};
const SIZE_LABEL: Record<DashboardWidgetSpan, { en: string; ka: string; short: string }> = {
  4: { en: 'Compact', ka: 'კომპაქტური', short: 'S' },
  6: { en: 'Half', ka: 'ნახევარი', short: 'M' },
  8: { en: 'Wide', ka: 'ფართო', short: 'L' },
  12: { en: 'Full', ka: 'სრული', short: 'XL' },
};

function storageKey(dashboardId: string) {
  return `cellarflow:dashboard-layout:${dashboardId}:v1`;
}

function isWidgetSpan(value: unknown): value is DashboardWidgetSpan {
  return typeof value === 'number' && ALLOWED_SPANS.includes(value as DashboardWidgetSpan);
}

export function mergeDashboardLayout(
  defaults: StoredWidgetLayout[],
  stored: unknown,
): StoredWidgetLayout[] {
  if (!Array.isArray(stored)) return defaults;

  const defaultsById = new Map(defaults.map(item => [item.id, item]));
  const seen = new Set<string>();
  const restored: StoredWidgetLayout[] = [];

  for (const candidate of stored) {
    if (!candidate || typeof candidate !== 'object') continue;
    const id = 'id' in candidate && typeof candidate.id === 'string' ? candidate.id : '';
    const fallback = defaultsById.get(id);
    if (!fallback || seen.has(id)) continue;
    const span = 'span' in candidate && isWidgetSpan(candidate.span) ? candidate.span : fallback.span;
    restored.push({ id, span, ...(candidate.hidden === true ? { hidden: true } : {}) });
    seen.add(id);
  }

  for (const fallback of defaults) {
    if (!seen.has(fallback.id)) restored.push(fallback);
  }

  return restored;
}

export function reorderDashboardLayout(
  current: StoredWidgetLayout[],
  sourceId: string,
  targetId: string,
): StoredWidgetLayout[] {
  const sourceIndex = current.findIndex(item => item.id === sourceId);
  const targetIndex = current.findIndex(item => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return current;

  const next = [...current];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

function fallbackWidgetLabel(id: string) {
  return id
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function DashboardLayout({ dashboardId, items, lang, className = '', toolbar }: DashboardLayoutProps) {
  const isKa = lang === 'ka';
  const defaultSignature = items.map(item => `${item.id}:${item.defaultSpan || 12}`).join('|');
  const defaults = useMemo<StoredWidgetLayout[]>(
    () => items.map(item => ({ id: item.id, span: item.defaultSpan || 12 })),
    // The signature deliberately tracks layout metadata, not React nodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultSignature],
  );
  const [layout, setLayout] = useState<StoredWidgetLayout[]>(defaults);
  const [editing, setEditing] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [hydratedDashboard, setHydratedDashboard] = useState<string | null>(null);

  useEffect(() => {
    let next = defaults;
    try {
      const raw = window.localStorage.getItem(storageKey(dashboardId));
      next = mergeDashboardLayout(defaults, raw ? JSON.parse(raw) : null);
    } catch {
      next = defaults;
    }
    setLayout(next);
    setEditing(false);
    setDraggedId(null);
    setDropTargetId(null);
    setHydratedDashboard(dashboardId);
  }, [dashboardId, defaults]);

  useEffect(() => {
    if (hydratedDashboard !== dashboardId) return;
    try {
      window.localStorage.setItem(storageKey(dashboardId), JSON.stringify(layout));
    } catch {
      // Storage can be unavailable in privacy modes; the layout still works
      // for the current session.
    }
  }, [dashboardId, hydratedDashboard, layout]);

  const itemById = new Map(items.map(item => [item.id, item]));
  const configuredLayout = layout.filter(item => itemById.has(item.id));
  const visibleLayout = configuredLayout.filter(item => !item.hidden);
  const hiddenLayout = configuredLayout.filter(item => item.hidden);

  const move = (id: string, direction: -1 | 1) => {
    setLayout(current => {
      const index = current.findIndex(item => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const setSize = (id: string, span: DashboardWidgetSpan) => {
    setLayout(current => current.map(item => {
      if (item.id !== id) return item;
      return { ...item, span };
    }));
  };

  const setHidden = (id: string, hidden: boolean) => {
    setLayout(current => current.map(item => {
      if (item.id !== id) return item;
      if (hidden) return { ...item, hidden: true };
      const { hidden: _hidden, ...visibleItem } = item;
      return visibleItem;
    }));
  };

  const dropBefore = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setLayout(current => reorderDashboardLayout(current, draggedId, targetId));
    setDraggedId(null);
    setDropTargetId(null);
  };

  const reset = () => {
    setLayout(defaults);
    try {
      window.localStorage.removeItem(storageKey(dashboardId));
    } catch {
      // See storage note above.
    }
  };

  return (
    <section className={`space-y-3 ${className}`} aria-label={isKa ? 'მორგებადი დაფა' : 'Customizable dashboard'}>
      <div className={`flex flex-wrap items-center gap-3 ${
        editing
          ? 'rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/25'
          : toolbar ? 'justify-between' : 'justify-end'
      }`}>
        {!editing && toolbar}
        {editing ? (
          <>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-800 text-white shadow-sm">
              <LayoutGrid className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block text-sm font-black text-emerald-950 dark:text-emerald-100">
                {isKa ? 'დაფის განლაგება' : 'Dashboard layout'}
              </strong>
              <p className="mt-0.5 text-[11px] font-semibold text-emerald-800/75 dark:text-emerald-300/75">
                {isKa
                  ? 'გადაათრიეთ ბარათები ან გამოიყენეთ მართვის ღილაკები. ცვლილებები ავტომატურად ინახება.'
                  : 'Drag cards or use the controls. Changes save automatically.'}
              </p>
            </div>
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-emerald-200 bg-white/80 px-2.5 text-[10px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-stone-900/70 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {isKa ? 'ავტომატურად შენახული' : 'Autosaved'}
            </span>
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 text-xs font-bold text-stone-600 transition hover:border-emerald-500 hover:text-emerald-900 dark:border-emerald-900 dark:bg-stone-900 dark:text-stone-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {isKa ? 'საწყისი განლაგება' : 'Reset layout'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-emerald-800 bg-emerald-800 px-3 text-xs font-bold text-white transition hover:bg-emerald-900"
            >
              <Check className="h-3.5 w-3.5" />
              {isKa ? 'მზადაა' : 'Done'}
            </button>
          </>
        ) : (
          <button
            type="button"
            aria-pressed="false"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 text-xs font-bold text-stone-700 transition hover:border-emerald-700 hover:text-emerald-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {isKa ? 'დაფის ორგანიზება' : 'Organize dashboard'}
          </button>
        )}
      </div>

      {editing && hiddenLayout.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-stone-300 bg-stone-50/80 px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900/60">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-stone-500 dark:text-stone-400">
            <EyeOff className="h-3.5 w-3.5" /> {isKa ? 'დამალული ბარათები' : 'Hidden cards'}
          </span>
          {hiddenLayout.map(widget => {
            const item = itemById.get(widget.id);
            const label = item?.label || fallbackWidgetLabel(widget.id);
            return (
              <button
                key={widget.id}
                type="button"
                onClick={() => setHidden(widget.id, false)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-[10px] font-bold text-stone-700 transition hover:border-emerald-500 hover:text-emerald-800 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200"
              >
                <Eye className="h-3.5 w-3.5" /> {label}
              </button>
            );
          })}
        </div>
      )}

      <div className={`grid grid-cols-1 items-start gap-5 xl:grid-cols-12 ${
        editing ? 'rounded-3xl border border-dashed border-emerald-300/80 p-2 sm:p-3 dark:border-emerald-900' : ''
      }`}>
        {visibleLayout.length > 0 ? visibleLayout.map((widget, index) => {
          const item = itemById.get(widget.id);
          const label = item?.label || fallbackWidgetLabel(widget.id);
          const isDropTarget = dropTargetId === widget.id && draggedId !== widget.id;
          return (
            <article
              key={widget.id}
              data-dashboard-widget={widget.id}
              onDragOver={editing ? event => {
                event.preventDefault();
                if (draggedId && draggedId !== widget.id) setDropTargetId(widget.id);
              } : undefined}
              onDrop={editing ? () => dropBefore(widget.id) : undefined}
              className={`min-w-0 ${SPAN_CLASS[widget.span]} ${
                editing
                  ? 'rounded-2xl outline outline-2 outline-offset-2 outline-emerald-600/20 transition-[opacity,outline-color,box-shadow]'
                  : ''
              } ${draggedId === widget.id ? 'opacity-45' : ''} ${
                isDropTarget ? 'shadow-[0_0_0_4px_rgba(16,185,129,0.28)] outline-emerald-600/80' : ''
              }`}
            >
              {editing && (
                <div className="mb-2 flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-2 py-1.5 text-stone-800 shadow-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">
                <button
                  type="button"
                  draggable
                  onDragStart={event => {
                    setDraggedId(widget.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', widget.id);
                  }}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDropTargetId(null);
                  }}
                  className="inline-flex min-w-0 cursor-grab items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[11px] font-black active:cursor-grabbing"
                  title={isKa ? 'გადაათრიეთ გადასაადგილებლად' : 'Drag to move'}
                >
                  <GripVertical className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                  <span className="truncate">{label}</span>
                </button>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {isDropTarget && (
                    <span className="rounded-md bg-emerald-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                      {isKa ? 'აქ მოათავსეთ' : 'Drop here'}
                    </span>
                  )}
                  <div className="flex items-center rounded-lg border border-stone-200 bg-stone-50 p-0.5 dark:border-stone-700 dark:bg-stone-950">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => move(widget.id, -1)}
                    aria-label={isKa ? 'ბარათის წინ გადატანა' : 'Move card earlier'}
                    title={isKa ? 'ზემოთ გადატანა' : 'Move up'}
                    className="rounded-md p-1.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-stone-900"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === visibleLayout.length - 1}
                    onClick={() => move(widget.id, 1)}
                    aria-label={isKa ? 'ბარათის უკან გადატანა' : 'Move card later'}
                    title={isKa ? 'ქვემოთ გადატანა' : 'Move down'}
                    className="rounded-md p-1.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-stone-900"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  </div>
                  <div
                    role="group"
                    aria-label={`${label} ${isKa ? 'ზომა' : 'size'}`}
                    className="flex items-center rounded-lg border border-stone-200 bg-stone-50 p-0.5 dark:border-stone-700 dark:bg-stone-950"
                  >
                    {ALLOWED_SPANS.map(span => (
                      <button
                        key={span}
                        type="button"
                        aria-pressed={widget.span === span}
                        onClick={() => setSize(widget.id, span)}
                        title={isKa ? SIZE_LABEL[span].ka : SIZE_LABEL[span].en}
                        className={`min-w-7 rounded-md px-1.5 py-1 text-[9px] font-black transition ${
                          widget.span === span
                            ? 'bg-emerald-800 text-white shadow-sm'
                            : 'text-stone-500 hover:bg-white hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100'
                        }`}
                      >
                        {SIZE_LABEL[span].short}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setHidden(widget.id, true)}
                    aria-label={`${isKa ? 'ბარათის დამალვა' : 'Hide card'}: ${label}`}
                    title={isKa ? 'ბარათის დამალვა' : 'Hide card'}
                    className="rounded-lg border border-stone-200 bg-stone-50 p-1.5 text-stone-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-400 dark:hover:border-rose-900 dark:hover:bg-rose-950/30 dark:hover:text-rose-300"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
              <div className={editing ? 'pointer-events-none select-none' : ''}>
                {item?.content}
              </div>
            </article>
          );
        }) : (
          <div className="xl:col-span-12 rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center dark:border-stone-700 dark:bg-stone-900/60">
            <EyeOff className="mx-auto h-6 w-6 text-stone-400" />
            <strong className="mt-2 block text-sm font-black text-stone-700 dark:text-stone-200">
              {isKa ? 'ყველა ბარათი დამალულია' : 'All cards are hidden'}
            </strong>
            <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
              {isKa ? 'აღადგინეთ ბარათი ზემოთ მოცემული სიიდან.' : 'Restore a card from the hidden cards list above.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
