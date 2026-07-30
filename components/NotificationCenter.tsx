import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AlertSeverity } from '../lib/alerts';
import type { NotificationCategory, NotificationItem } from '../lib/notificationFeed';
import type { Language } from '../lib/i18n';
import {
  Bell,
  BrainCircuit,
  Droplet,
  TestTube,
  Sparkles,
  Thermometer,
  CheckSquare,
  Boxes,
  ShieldCheck,
} from 'lucide-react';

interface Props {
  items: NotificationItem[];
  /** AI availability never hides operational alerts. */
  aiStatus?: 'loading' | 'ready' | 'unavailable';
  onMarkAllAiRead?: () => Promise<void>;
  /** Optional: jump to the area a notification relates to. */
  onSelect?: (item: NotificationItem) => void;
  lang?: Language;
}

const CATEGORY_ICON: Record<NotificationCategory, React.ComponentType<{ className?: string }>> = {
  so2: Droplet,
  va: TestTube,
  fermentation: Sparkles,
  temperature: Thermometer,
  cleaning: Droplet,
  task: CheckSquare,
  inventory: Boxes,
  intelligence: BrainCircuit,
};

type NotificationFilter = 'all' | AlertSeverity | 'ai';
const FILTERS: NotificationFilter[] = ['all', 'critical', 'warning', 'info', 'ai'];

export default function NotificationCenter({
  items,
  aiStatus = 'ready',
  onMarkAllAiRead,
  onSelect,
  lang = 'en',
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [markingAllRead, setMarkingAllRead] = useState(false);
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

  const CATEGORY_LABEL: Record<NotificationCategory, string> = {
    so2: 'SO2',
    va: 'VA',
    fermentation: isKa ? 'დუღილი' : 'Fermentation',
    temperature: isKa ? 'ტემპერატურა' : 'Temperature',
    cleaning: isKa ? 'რეცხვა' : 'Cleaning',
    task: isKa ? 'დავალება' : 'Task',
    inventory: isKa ? 'მარაგები' : 'Inventory',
    intelligence: isKa ? 'ინტელექტი' : 'Intelligence',
  };

  const criticalCount = items.filter((item) => item.severity === 'critical').length;
  const warningCount = items.filter((item) => item.severity === 'warning').length;
  const infoCount = items.filter((item) => item.severity === 'info').length;
  const aiCount = items.filter((item) => item.source === 'ai').length;
  const aiUnreadCount = items.filter((item) => item.source === 'ai' && item.unread).length;
  const unreadCount = items.filter((item) => item.unread).length;
  const count = items.length;
  const unreadCriticalCount = items.filter(
    (item) => item.unread && item.severity === 'critical',
  ).length;
  const badgeColor = unreadCriticalCount > 0 ? 'bg-rose-600' : 'bg-amber-500';
  const filteredItems = useMemo(
    () => filter === 'all'
      ? items
      : filter === 'ai'
        ? items.filter((item) => item.source === 'ai')
        : items.filter((item) => item.severity === filter),
    [items, filter],
  );
  const filterCounts: Record<NotificationFilter, number> = {
    all: count,
    critical: criticalCount,
    warning: warningCount,
    info: infoCount,
    ai: aiCount,
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
      aria-label={isKa ? 'შეტყობინებების ცენტრი' : 'Notification center'}
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
            <Bell className="w-3.5 h-3.5 text-amber-300" /> {isKa ? 'შეტყობინებების ცენტრი' : 'Notification Center'}
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
        {aiUnreadCount > 0 && onMarkAllAiRead && (
          <button
            type="button"
            disabled={markingAllRead}
            onClick={async () => {
              setMarkingAllRead(true);
              try {
                await onMarkAllAiRead();
              } catch {
                // The shell restores unread state and surfaces the error.
              } finally {
                setMarkingAllRead(false);
              }
            }}
            className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-[9px] font-bold text-amber-50 transition-colors hover:bg-white/15 disabled:cursor-wait disabled:opacity-60"
          >
            {markingAllRead
              ? (isKa ? 'ინიშნება…' : 'Marking…')
              : (isKa
                ? `ყველა AI შეტყობინების წაკითხვა (${aiUnreadCount})`
                : `Mark all AI as read (${aiUnreadCount})`)}
          </button>
        )}
      </div>

      {count > 0 && (
        <div className="grid grid-cols-5 gap-1 border-b border-stone-200 bg-stone-50 p-2 dark:border-stone-800 dark:bg-stone-900/70">
          {FILTERS.map((item) => {
            const active = filter === item;
            const label = item === 'all'
              ? (isKa ? 'ყველა' : 'All')
              : item === 'ai'
                ? 'AI'
                : SEVERITY_STYLES[item].label;
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

      {aiStatus !== 'ready' && (
        <div className={`border-b px-3 py-2 text-[9px] font-semibold ${
          aiStatus === 'loading'
            ? 'border-violet-100 bg-violet-50 text-violet-700 dark:border-violet-950 dark:bg-violet-950/30 dark:text-violet-300'
            : 'border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-950 dark:bg-amber-950/30 dark:text-amber-300'
        }`}>
          {aiStatus === 'loading'
            ? (isKa ? 'AI შეტყობინებები იტვირთება…' : 'Loading AI notifications…')
            : (isKa
              ? 'AI შეტყობინებები დროებით მიუწვდომელია. საოპერაციო ალერტები კვლავ აქტიურია.'
              : 'AI notifications are temporarily unavailable. Operational alerts remain active.')}
        </div>
      )}

      <div
        className="overflow-y-auto divide-y divide-stone-100 dark:divide-stone-850"
        style={{ maxHeight: panelBox.maxHeight }}
      >
        {count === 0 ? (
          <div className="px-4 py-8 text-center text-stone-400 flex flex-col items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-emerald-500" />
            <span className="text-[11px] font-semibold">
              {aiStatus === 'loading'
                ? (isKa ? 'საოპერაციო ალერტები არ არის. AI შემოწმება იტვირთება.' : 'No operational alerts. AI checks are loading.')
                : (isKa ? 'ყველა სისტემა წესრიგშია — აქტიური შეტყობინებები არ არის.' : 'All clear — no active notifications.')}
            </span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="px-4 py-8 text-center text-stone-400 flex flex-col items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-emerald-500" />
            <span className="text-[11px] font-semibold">
              {isKa
                ? (filter === 'ai'
                  ? 'აქტიური AI შეტყობინებები არ არის.'
                  : `აქტიური ${filter === 'critical' ? 'კრიტიკული' : filter === 'warning' ? 'გაფრთხილების' : 'ინფორმაციული'} შეტყობინებები არ არის.`)
                : `No ${filter} notifications.`}
            </span>
          </div>
        ) : (
          filteredItems.map((item) => {
            const Icon = CATEGORY_ICON[item.category];
            const sv = SEVERITY_STYLES[item.severity];
            const severityLabel = item.aiSeverity === 'attention'
              ? (isKa ? 'საყურადღებო' : 'Attention')
              : sv.label;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect?.(item);
                  setOpen(false);
                }}
                className={`w-full text-left px-4 py-3 transition-colors flex gap-3 cursor-pointer ${
                  item.source === 'ai' && item.unread
                    ? 'bg-violet-50/50 hover:bg-violet-50 dark:bg-violet-950/15 dark:hover:bg-violet-950/25'
                    : 'hover:bg-stone-50 dark:hover:bg-stone-900'
                }`}
              >
                <span className="mt-0.5 shrink-0 relative">
                  <Icon className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                  <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${sv.dot} ring-2 ring-white dark:ring-stone-950`} />
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    {item.source === 'ai' && item.unread && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
                        aria-label={isKa ? 'წაუკითხავი' : 'Unread'}
                      />
                    )}
                    <strong className="min-w-0 flex-1 truncate text-[11px] font-bold text-stone-850 dark:text-stone-100">{item.title}</strong>
                    <span className={`text-[7px] uppercase font-black px-1.5 py-0.5 rounded border ${sv.chip} shrink-0`}>
                      {severityLabel}
                    </span>
                  </span>
                  <span className="block text-[10px] text-stone-500 leading-snug mt-0.5 dark:text-stone-400">{item.message}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[8px] font-mono font-bold uppercase tracking-wide text-stone-400">
                    {item.source === 'ai' && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
                        <BrainCircuit className="h-2.5 w-2.5" /> AI
                      </span>
                    )}
                    <span className="rounded-md bg-stone-100 px-1.5 py-0.5 dark:bg-stone-900">{CATEGORY_LABEL[item.category]}</span>
                    {item.relatedLotId && <span className="rounded-md bg-stone-100 px-1.5 py-0.5 dark:bg-stone-900">{isKa ? 'ლოტი' : 'Lot'} {item.relatedLotId}</span>}
                    {item.relatedTankId && <span className="rounded-md bg-stone-100 px-1.5 py-0.5 dark:bg-stone-900">{isKa ? 'ჭურჭელი' : 'Vessel'} {item.relatedTankId}</span>}
                    {item.source === 'ai' && (item.occurrences || 0) > 1 && (
                      <span className="rounded-md bg-stone-100 px-1.5 py-0.5 dark:bg-stone-900">
                        {isKa ? `${item.occurrences} დაფიქსირება` : `${item.occurrences} observations`}
                      </span>
                    )}
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
        aria-label={isKa
          ? `შეტყობინებები: ${unreadCount} წაუკითხავი, ${count} აქტიური`
          : `Notifications: ${unreadCount} unread, ${count} active`}
        className="relative p-2 rounded-xl border border-stone-200 bg-gradient-to-r from-stone-50 to-stone-100 hover:border-[#4e0e15]/40 transition-colors cursor-pointer shadow-2xs"
      >
        <Bell className="w-4 h-4 text-[#4e0e15]" />
        {unreadCount > 0 && (
          <span
            className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full ${badgeColor} text-white text-[9px] font-black flex items-center justify-center ring-2 ring-white`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(panel, document.body)}
    </div>
  );
}
