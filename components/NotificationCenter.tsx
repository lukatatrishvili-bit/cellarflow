import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, AlertCategory, AlertSeverity } from '../lib/alerts';
import type { Language } from '../lib/i18n';
import {
  Bell,
  Droplet,
  TestTube,
  Sparkles,
  Thermometer,
  CheckSquare,
  Boxes,
  ShieldCheck,
} from 'lucide-react';

interface Props {
  alerts: Alert[];
  /** Optional: jump to the area an alert relates to. */
  onSelect?: (alert: Alert) => void;
  lang?: Language;
}

const CATEGORY_ICON: Record<AlertCategory, React.ComponentType<{ className?: string }>> = {
  so2: Droplet,
  va: TestTube,
  fermentation: Sparkles,
  temperature: Thermometer,
  cleaning: Droplet,
  task: CheckSquare,
  inventory: Boxes,
};

const FILTERS: Array<'all' | AlertSeverity> = ['all', 'critical', 'warning', 'info'];

export default function NotificationCenter({ alerts, onSelect, lang = 'en' }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | AlertSeverity>('all');
  const [panelBox, setPanelBox] = useState({ top: 0, left: 0, width: 360, maxHeight: 360 });
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isKa = lang === 'ka';

  const SEVERITY_STYLES: Record<AlertSeverity, { dot: string; chip: string; label: string }> = {
    critical: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200', label: isKa ? 'კრიტიკული' : 'Critical' },
    warning: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', label: isKa ? 'გაფრთხილება' : 'Warning' },
    info: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 border-sky-200', label: isKa ? 'ინფორმაცია' : 'Info' },
  };

  const CATEGORY_LABEL: Record<AlertCategory, string> = {
    so2: 'SO2',
    va: 'VA',
    fermentation: isKa ? 'დუღილი' : 'Fermentation',
    temperature: isKa ? 'ტემპერატურა' : 'Temperature',
    cleaning: isKa ? 'რეცხვა' : 'Cleaning',
    task: isKa ? 'დავალება' : 'Task',
    inventory: isKa ? 'მარაგები' : 'Inventory',
  };

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;
  const infoCount = alerts.filter((a) => a.severity === 'info').length;
  const count = alerts.length;
  const badgeColor = criticalCount > 0 ? 'bg-rose-600' : 'bg-amber-500';
  const filteredAlerts = useMemo(
    () => filter === 'all' ? alerts : alerts.filter((alert) => alert.severity === filter),
    [alerts, filter],
  );
  const filterCounts: Record<'all' | AlertSeverity, number> = {
    all: count,
    critical: criticalCount,
    warning: warningCount,
    info: infoCount,
  };

  const updatePanelBox = useCallback(() => {
    if (typeof window === 'undefined') return;
    const button = buttonRef.current;
    if (!button) return;

    const margin = 12;
    const gap = 8;
    const rect = button.getBoundingClientRect();
    const width = Math.min(360, Math.max(220, window.innerWidth - margin * 2));
    const left = Math.min(
      Math.max(rect.right - width, margin),
      Math.max(margin, window.innerWidth - width - margin),
    );
    const top = rect.bottom + gap;
    const maxHeight = Math.max(160, window.innerHeight - top - margin);

    setPanelBox({ top, left, width, maxHeight });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    updatePanelBox();
    window.addEventListener('resize', updatePanelBox);
    window.addEventListener('scroll', updatePanelBox, true);
    return () => {
      window.removeEventListener('resize', updatePanelBox);
      window.removeEventListener('scroll', updatePanelBox, true);
    };
  }, [open, updatePanelBox]);

  const panel = (
    <div
      ref={panelRef}
      id="cellar-alerts-popover"
      role="dialog"
      aria-label={isKa ? 'მარნის ალერტები' : 'Cellar alerts'}
      className="fixed bg-white border border-stone-200 rounded-2xl shadow-2xl z-[45] overflow-hidden dark:bg-stone-950 dark:border-stone-800"
      style={{
        top: panelBox.top,
        left: panelBox.left,
        width: panelBox.width,
      }}
    >
      <div className="px-4 py-3 bg-[#4e0e15] text-amber-50">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-serif font-black uppercase tracking-widest flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5 text-amber-300" /> {isKa ? 'მარნის ალერტები' : 'Cellar Alerts'}
          </span>
          <span className="text-[9px] font-mono font-bold">
            {criticalCount > 0 
              ? (isKa ? `${criticalCount} კრიტიკული` : `${criticalCount} critical`) 
              : (isKa ? `${count} აქტიური` : `${count} open`)}
          </span>
        </div>
        {count > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-[9px] font-mono font-bold uppercase">
            <span className="rounded-lg bg-white/10 px-2 py-1 text-rose-100">{criticalCount} {isKa ? 'კრიტიკული' : 'critical'}</span>
            <span className="rounded-lg bg-white/10 px-2 py-1 text-amber-100">{warningCount} {isKa ? 'გაფრთხილება' : 'warning'}</span>
            <span className="rounded-lg bg-white/10 px-2 py-1 text-sky-100">{infoCount} {isKa ? 'ინფო' : 'info'}</span>
          </div>
        )}
      </div>

      {count > 0 && (
        <div className="grid grid-cols-4 gap-1 border-b border-stone-200 bg-stone-50 p-2 dark:border-stone-800 dark:bg-stone-900/70">
          {FILTERS.map((item) => {
            const active = filter === item;
            const label = item === 'all' ? (isKa ? 'ყველა' : 'All') : SEVERITY_STYLES[item].label;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(item)}
                className={`rounded-lg px-2 py-1.5 text-[10px] font-black transition-colors ${
                  active
                    ? 'bg-[#4e0e15] text-amber-50 shadow-sm'
                    : 'bg-white text-stone-500 hover:text-[#4e0e15] dark:bg-stone-950 dark:text-stone-400 dark:hover:text-amber-200'
                }`}
              >
                {label}
                <span className="ml-1 font-mono opacity-70">{filterCounts[item]}</span>
              </button>
            );
          })}
        </div>
      )}

      <div
        className="overflow-y-auto divide-y divide-stone-100 dark:divide-stone-850"
        style={{ maxHeight: panelBox.maxHeight }}
      >
        {count === 0 ? (
          <div className="px-4 py-8 text-center text-stone-400 flex flex-col items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-emerald-500" />
            <span className="text-[11px] font-semibold">{isKa ? 'ყველა სისტემა წესრიგშია - ალერტები არ არის.' : 'All clear - no active alerts.'}</span>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="px-4 py-8 text-center text-stone-400 flex flex-col items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-emerald-500" />
            <span className="text-[11px] font-semibold">
              {isKa 
                ? `აქტიური ${filter === 'critical' ? 'კრიტიკული' : filter === 'warning' ? 'გაფრთხილების' : 'ინფორმაციული'} ალერტები არ არის.` 
                : `No ${filter} alerts.`}
            </span>
          </div>
        ) : (
          filteredAlerts.map((a) => {
            const Icon = CATEGORY_ICON[a.category];
            const sv = SEVERITY_STYLES[a.severity];
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onSelect?.(a);
                  setOpen(false);
                }}
                className="w-full text-left px-4 py-3 hover:bg-stone-50 transition-colors flex gap-3 cursor-pointer dark:hover:bg-stone-900"
              >
                <span className="mt-0.5 shrink-0 relative">
                  <Icon className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                  <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${sv.dot} ring-2 ring-white dark:ring-stone-950`} />
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <strong className="min-w-0 flex-1 truncate text-[11px] font-bold text-stone-850 dark:text-stone-100">{a.title}</strong>
                    <span className={`text-[7px] uppercase font-black px-1.5 py-0.5 rounded border ${sv.chip} shrink-0`}>
                      {sv.label}
                    </span>
                  </span>
                  <span className="block text-[10px] text-stone-500 leading-snug mt-0.5 dark:text-stone-400">{a.message}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[8px] font-mono font-bold uppercase tracking-wide text-stone-400">
                    <span className="rounded-md bg-stone-100 px-1.5 py-0.5 dark:bg-stone-900">{CATEGORY_LABEL[a.category]}</span>
                    {a.relatedLotId && <span className="rounded-md bg-stone-100 px-1.5 py-0.5 dark:bg-stone-900">{isKa ? 'ლოტი' : 'Lot'} {a.relatedLotId}</span>}
                    {a.relatedTankId && <span className="rounded-md bg-stone-100 px-1.5 py-0.5 dark:bg-stone-900">{isKa ? 'ჭურჭელი' : 'Vessel'} {a.relatedTankId}</span>}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          updatePanelBox();
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="cellar-alerts-popover"
        aria-label={isKa ? `ალერტები (${count})` : `Alerts (${count})`}
        className="relative p-2 rounded-xl border border-stone-200 bg-gradient-to-r from-stone-50 to-stone-100 hover:border-[#4e0e15]/40 transition-colors cursor-pointer shadow-2xs"
      >
        <Bell className="w-4 h-4 text-[#4e0e15]" />
        {count > 0 && (
          <span
            className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full ${badgeColor} text-white text-[9px] font-black flex items-center justify-center ring-2 ring-white`}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(panel, document.body)}
    </div>
  );
}
