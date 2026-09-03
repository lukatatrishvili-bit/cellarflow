import React from 'react';
import {
  ArrowDownToLine,
  ArrowRightLeft,
  Beaker,
  CircleEllipsis,
  Combine,
  Droplets,
  Filter,
  FlaskConical,
  Grape,
  Package,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Thermometer,
  Wrench,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { CellarOperationType, Vessel, WineLot } from '../lib/wineryState';
import { CELLAR_OPERATIONS, isQuickCellarOperation } from '../lib/wineryOperations';
import { isBottlingReadyStage } from '../lib/commands/bottling';

interface VesselOperationMenuProps {
  lang: Language;
  vessel: Vessel;
  lot?: WineLot | null;
  onLogOperation?: (vesselId: string, operationType?: CellarOperationType) => void;
  onStartTransfer?: (sourceVesselId: string, operationType: 'racking' | 'blending') => void;
  onStartFilling?: (destinationVesselId: string) => void;
  onOpenBottling?: (sourceVesselId: string) => void;
  onRecordSanitation?: (vesselId: string) => void;
}

const OPERATION_ICONS: Record<CellarOperationType, React.ComponentType<{ className?: string }>> = {
  crush_destem: Grape,
  pressing: Droplets,
  ferment_start: FlaskConical,
  measurement: Thermometer,
  pumpover: RefreshCw,
  punchdown: ArrowDownToLine,
  racking: ArrowRightLeft,
  blending: Combine,
  sulfitation: ShieldCheck,
  additive: Beaker,
  fining: Sparkles,
  filtration: Filter,
  stabilization: Snowflake,
  vessel_filling: Droplets,
  bottling: Package,
  cleaning: Sparkles,
  correction: Wrench,
  topping: ArrowDownToLine,
  custom: CircleEllipsis,
};

interface AvailableOperation {
  type: CellarOperationType;
  run: () => void;
  workflow: 'quick' | 'dedicated';
}

/**
 * One contextual operation catalogue shared by the plan's two perspectives.
 * Dedicated physical workflows stay out of the quick recorder so balances,
 * packaging, and sanitation evidence continue to use their authoritative forms.
 */
export default function VesselOperationMenu({
  lang,
  vessel,
  lot,
  onLogOperation,
  onStartTransfer,
  onStartFilling,
  onOpenBottling,
  onRecordSanitation,
}: VesselOperationMenuProps) {
  const ka = lang === 'ka';
  const detailsRef = React.useRef<HTMLDetailsElement>(null);
  const available = React.useMemo<AvailableOperation[]>(() => CELLAR_OPERATIONS.flatMap<AvailableOperation>(operation => {
    const type = operation.key;
    if (isQuickCellarOperation(type)) {
      return lot && onLogOperation
        ? [{ type, workflow: 'quick' as const, run: () => onLogOperation(vessel.id, type) }]
        : [];
    }
    if ((type === 'racking' || type === 'blending') && vessel.currentVolume > 0 && onStartTransfer) {
      return [{ type, workflow: 'dedicated' as const, run: () => onStartTransfer(vessel.id, type) }];
    }
    if (type === 'vessel_filling' && vessel.currentVolume <= 0 && vessel.cleaningStatus === 'clean' && onStartFilling) {
      return [{ type, workflow: 'dedicated' as const, run: () => onStartFilling(vessel.id) }];
    }
    if (type === 'bottling' && lot && vessel.currentVolume > 0 && isBottlingReadyStage(lot.stage) && onOpenBottling) {
      return [{ type, workflow: 'dedicated' as const, run: () => onOpenBottling(vessel.id) }];
    }
    if (type === 'cleaning' && vessel.currentVolume <= 0 && onRecordSanitation) {
      return [{ type, workflow: 'dedicated' as const, run: () => onRecordSanitation(vessel.id) }];
    }
    return [];
  }), [lot, onLogOperation, onOpenBottling, onRecordSanitation, onStartFilling, onStartTransfer, vessel]);

  if (available.length === 0) return null;

  return (
    <details
      ref={detailsRef}
      onToggle={event => {
        if (!event.currentTarget.open) return;
        window.requestAnimationFrame(() => {
          detailsRef.current?.querySelector('[role="menu"]')?.scrollIntoView({
            block: 'nearest',
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          });
        });
      }}
      className="group mt-3 overflow-hidden rounded-2xl border border-violet-200 bg-violet-50/50 dark:border-violet-900 dark:bg-violet-950/20"
    >
      <summary aria-label={ka ? 'ოპერაციის ჩაწერა · ხელმისაწვდომი ოპერაციები' : 'Record operation · Available operations'} className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 text-left text-violet-950 marker:hidden hover:bg-violet-100/70 dark:text-violet-100 dark:hover:bg-violet-950/50 [&::-webkit-details-marker]:hidden">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-700 text-white shadow-sm"><Wrench className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <strong className="block text-[10px] font-black">{ka ? 'ოპერაციის ჩაწერა' : 'Record operation'}</strong>
          <span className="mt-0.5 block text-[8px] font-bold text-violet-700/70 dark:text-violet-300/75">{available.length} {ka ? 'მოქმედება ამ ჭურჭლისთვის' : available.length === 1 ? 'action for this vessel' : 'actions for this vessel'}</span>
        </span>
        <span className="rounded-full bg-white px-2 py-1 font-mono text-[9px] font-black text-violet-700 shadow-sm transition-transform group-open:rotate-180 dark:bg-slate-900 dark:text-violet-200">⌄</span>
      </summary>
      <div role="menu" aria-label={ka ? 'ჭურჭლის ხელმისაწვდომი ოპერაციები' : 'Available vessel operations'} className="max-h-80 overflow-y-auto border-t border-violet-200 bg-white p-2 dark:border-violet-900 dark:bg-slate-900">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-2">
          {available.map(entry => {
            const metadata = CELLAR_OPERATIONS.find(operation => operation.key === entry.type)!;
            const Icon = OPERATION_ICONS[entry.type];
            return (
              <button
                key={entry.type}
                type="button"
                role="menuitem"
                aria-label={entry.type === 'racking' || entry.type === 'blending'
                  ? `${ka ? 'გადატანის დაწყება' : 'Start transfer'} · ${ka ? metadata.ka : metadata.en}`
                  : entry.type === 'vessel_filling'
                    ? (ka ? 'ჭურჭლის შევსების დაწყება' : 'Start vessel filling')
                    : entry.type === 'bottling'
                      ? (ka ? 'ჩამოსხმის გახსნა' : 'Open bottling')
                      : entry.type === 'cleaning'
                        ? (ka ? 'სანიტარიის ჩაწერა' : 'Record sanitation')
                        : undefined}
                data-operation-type={entry.type}
                onClick={() => {
                  detailsRef.current?.removeAttribute('open');
                  entry.run();
                }}
                className="group/item flex min-h-16 items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-left text-slate-700 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-950 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
                <span className="min-w-0">
                  <strong className="block text-[9px] leading-tight">{ka ? metadata.ka : metadata.en}</strong>
                  <span className="mt-1 block text-[7px] font-black uppercase tracking-[0.12em] text-slate-400">
                    {entry.workflow === 'quick' ? (ka ? 'სწრაფი ჩანაწერი' : 'Quick record') : (ka ? 'სამუშაო პროცესი' : 'Workflow')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}
