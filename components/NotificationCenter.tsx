import React, { useState, useRef, useEffect } from 'react';
import { Alert, AlertCategory, AlertSeverity } from '../lib/alerts';
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

const SEVERITY_STYLES: Record<AlertSeverity, { dot: string; chip: string; label: string }> = {
  critical: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Critical' },
  warning: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Warning' },
  info: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 border-sky-200', label: 'Info' },
};

export default function NotificationCenter({ alerts, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const count = alerts.length;
  const badgeColor = criticalCount > 0 ? 'bg-rose-600' : 'bg-amber-500';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Alerts (${count})`}
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

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white border border-stone-200 rounded-2xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 bg-[#4e0e15] text-amber-50 flex items-center justify-between">
            <span className="text-[11px] font-serif font-black uppercase tracking-widest flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-amber-300" /> Cellar Alerts
            </span>
            <span className="text-[9px] font-mono font-bold">
              {criticalCount > 0 ? `${criticalCount} critical` : `${count} open`}
            </span>
          </div>

          <div className="max-h-[60vh] overflow-y-auto divide-y divide-stone-100">
            {count === 0 ? (
              <div className="px-4 py-8 text-center text-stone-400 flex flex-col items-center gap-2">
                <ShieldCheck className="w-7 h-7 text-emerald-500" />
                <span className="text-[11px] font-semibold">All clear — no active alerts.</span>
              </div>
            ) : (
              alerts.map((a) => {
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
                    className="w-full text-left px-4 py-3 hover:bg-stone-50 transition-colors flex gap-3 cursor-pointer"
                  >
                    <span className="mt-0.5 shrink-0 relative">
                      <Icon className="w-4 h-4 text-stone-500" />
                      <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${sv.dot} ring-2 ring-white`} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <strong className="text-[11px] font-bold text-stone-850 truncate">{a.title}</strong>
                        <span className={`text-[7px] uppercase font-black px-1.5 py-0.5 rounded border ${sv.chip} shrink-0`}>
                          {sv.label}
                        </span>
                      </span>
                      <span className="block text-[10px] text-stone-500 leading-snug mt-0.5">{a.message}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
