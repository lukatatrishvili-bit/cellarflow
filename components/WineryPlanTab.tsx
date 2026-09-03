'use client';

import React from 'react';
import { useReducedMotion } from 'motion/react';
import {
  ArrowRightLeft,
  Box,
  CalendarPlus,
  ChevronLeft,
  MapPinned,
  Save,
  ShieldCheck,
  UserRound,
  Wine,
  X,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { ProductionPlanItem } from '../lib/operationsControl';
import type {
  CellarFloor,
  CellarOperationType,
  Task,
  CellarTransferRecord,
  Vessel,
  WineLot,
} from '../lib/wineryState';
import {
  buildWineryPlanProductionItem,
  cellarOperationNeedsDestination,
  defaultWineryPlanOperation,
  suggestedWineryPlanQuantity,
  wineryPlanDraftIssue,
  type WineryPlanDraftIssueCode,
} from '../lib/wineryPlan';
import { CELLAR_OPERATIONS } from '../lib/wineryOperations';
import type { PlanFocus } from '../lib/wineryScene';
import { localISODate } from '../lib/weatherApi';
import WineryPlanStage from './WineryPlanStage';
import DateInput from './ui/DateInput';

const BatchToppingDialog = React.lazy(() => import('./BatchToppingDialog'));

interface WineryPlanTabProps {
  lang: Language;
  vessels: Vessel[];
  lots: WineLot[];
  floors?: CellarFloor[];
  productionPlans: ProductionPlanItem[];
  tasks?: Task[];
  /** Recent transfers, so the plan can show the routes wine has been taking. */
  transfers?: CellarTransferRecord[];
  currentUsername: string;
  wineryName?: string;
  initialVesselId?: string | null;
  onSelectedVesselChange?: (vesselId: string | null) => void;
  onUpdateVessels: (vessels: Vessel[]) => void;
  onUpdateFloors?: (floors: CellarFloor[]) => void;
  onUpdateProductionPlans: React.Dispatch<React.SetStateAction<ProductionPlanItem[]>>;
  onOpenVessel: (vesselId: string) => void;
  onOpenLot?: (lotId: string) => void;
  onLogOperation?: (vesselId: string, operationType?: CellarOperationType) => void;
  onStartTransfer?: (sourceVesselId: string, destinationVesselId?: string, operationType?: 'racking' | 'blending') => void;
  onStartFilling?: (destinationVesselId: string) => void;
  onOpenBottling?: (sourceVesselId: string) => void;
  /** Opens the shell's transfer recorder for these two vessels. */
  onRecordTransfer?: (sourceVesselId: string, destinationVesselId: string) => void;
  /**
   * Tops several vessels from one source. Resolves to an error message when the
   * batch was refused, naming the vessel that stopped it.
   */
  onBatchTopping?: (input: { sourceVesselId: string; litresPerVessel: number; vesselIds: string[] }) => Promise<string | null>;
  batchToppingProgress?: { done: number; total: number } | null;

  onOpenProductionPlan?: (planId: string) => void;
  onOpenPlanner?: () => void;
  onBackToWinery?: () => void;
  canUpdateLayout: boolean;
  canScheduleWork: boolean;
  setToastMessage?: (message: string) => void;
}

const issueCopy: Record<WineryPlanDraftIssueCode, { en: string; ka: string }> = {
  missing_source: { en: 'Select a source vessel.', ka: 'აირჩიეთ საწყისი ჭურჭელი.' },
  missing_lot: { en: 'This wine operation requires a lot assigned to the source vessel.', ka: 'ამ ოპერაციისთვის საწყის ჭურჭელზე პარტია უნდა იყოს მიბმული.' },
  invalid_dates: { en: 'Check the start and end dates.', ka: 'შეამოწმეთ დაწყებისა და დასრულების თარიღები.' },
  missing_assignee: { en: 'Assign the work to a person or team.', ka: 'სამუშაო მიანიჭეთ პირს ან გუნდს.' },
  missing_destination: { en: 'Select a destination vessel.', ka: 'აირჩიეთ მიმღები ჭურჭელი.' },
  same_destination: { en: 'Source and destination must be different vessels.', ka: 'საწყისი და მიმღები ჭურჭელი განსხვავებული უნდა იყოს.' },
  dirty_destination: { en: 'The destination must be clean before it can receive wine.', ka: 'ღვინის მიღებამდე მიმღები ჭურჭელი სუფთა უნდა იყოს.' },
  no_destination_headroom: { en: 'The destination has no available headroom.', ka: 'მიმღებ ჭურჭელში თავისუფალი მოცულობა არ არის.' },
  invalid_quantity: { en: 'Enter a volume that fits both source stock and destination headroom.', ka: 'შეიყვანეთ მოცულობა, რომელიც წყაროს ნაშთსა და მიმღების თავისუფალ ტევადობას შეესაბამება.' },
  vessel_conflict: { en: 'This vessel already has overlapping planned work.', ka: 'ამ ჭურჭელზე იმავე პერიოდში სხვა სამუშაოა დაგეგმილი.' },
};

/**
 * A headline figure that doubles as a filter. Pressing one spotlights the
 * vessels behind the number and dims the rest of the room, so the strip reads
 * as a way of interrogating the cellar rather than a caption on it.
 */
function Metric({
  label, value, tone = 'text-stone-100', active, hint, onClick,
}: {
  label: string;
  value: string;
  tone?: string;
  active: boolean;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={hint}
      onClick={onClick}
      className={`min-w-[8rem] border-l border-white/10 px-4 py-2 text-left transition-colors first:border-l-0 ${active ? 'bg-amber-400/15' : 'hover:bg-white/5'}`}
    >
      <span className={`block text-[8px] font-black uppercase tracking-[0.14em] ${active ? 'text-amber-200' : 'text-slate-400'}`}>{label}</span>
      <strong className={`mt-0.5 block text-sm font-black ${tone}`}>{value}</strong>
    </button>
  );
}

export default function WineryPlanTab({
  lang,
  vessels,
  lots,
  floors,
  productionPlans,
  tasks = [],
  transfers = [],
  currentUsername,
  wineryName,
  initialVesselId,
  onSelectedVesselChange,
  onUpdateVessels,
  onUpdateFloors,
  onUpdateProductionPlans,
  onOpenVessel,
  onOpenLot,
  onLogOperation,
  onStartTransfer,
  onStartFilling,
  onOpenBottling,
  onRecordTransfer,
  onBatchTopping,
  batchToppingProgress,
  onOpenProductionPlan,
  onOpenPlanner,
  onBackToWinery,
  canUpdateLayout,
  canScheduleWork,
  setToastMessage,
}: WineryPlanTabProps) {
  const ka = lang === 'ka';
  const reduceMotion = useReducedMotion();
  const [selectedVesselId, setSelectedVesselId] = React.useState<string | null>(
    initialVesselId && vessels.some(vessel => vessel.id === initialVesselId)
      ? initialVesselId
      : vessels[0]?.id || null,
  );
  const [scheduleVesselId, setScheduleVesselId] = React.useState<string | null>(null);
  const [sanitationVesselId, setSanitationVesselId] = React.useState<string | null>(null);
  const [viewMode, setViewMode] = React.useState<'top-down' | '3d'>('top-down');
  const [focus, setFocus] = React.useState<PlanFocus | null>(null);
  const toggleFocus = (next: PlanFocus) => setFocus(current => (current === next ? null : next));
  React.useEffect(() => {
    // Warm the Three.js chunk while the shell paints. Both views are the same
    // WebGL room, so this is the cost of the plan itself rather than of an
    // optional extra, and it must not block first paint.
    const preload = () => { void import('./WineryPlanCanvas'); };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(preload, { timeout: 1_500 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(preload, 250);
    return () => window.clearTimeout(handle);
  }, []);
  React.useEffect(() => {
    if (!initialVesselId || !vessels.some(vessel => vessel.id === initialVesselId)) return;
    setSelectedVesselId(initialVesselId);
  }, [initialVesselId, vessels]);

  const selectVessel = (vesselId: string) => {
    setSelectedVesselId(vesselId);
    onSelectedVesselChange?.(vesselId);
  };
  const switchView = (next: 'top-down' | '3d') => {
    if (next === viewMode) return;
    // Nothing unmounts: the stage keeps its WebGL room and flies the camera
    // between the overhead plan and the orbiting walkthrough.
    setViewMode(next);
  };

  const [batchVesselIds, setBatchVesselIds] = React.useState<string[] | null>(null);
  const [batchBusy, setBatchBusy] = React.useState(false);
  const [batchError, setBatchError] = React.useState<string | null>(null);

  const closeBatchDialog = () => {
    setBatchVesselIds(null);
    setBatchError(null);
  };

  const occupied = vessels.filter(vessel => vessel.currentVolume > 0);
  const cleanCapacity = vessels
    .filter(vessel => vessel.currentVolume <= 0 && vessel.cleaningStatus === 'clean')
    .reduce((sum, vessel) => sum + vessel.capacity, 0);
  const openPlans = productionPlans.filter(plan => !['completed', 'cancelled'].includes(plan.status));
  const activeLotIds = new Set(occupied.map(vessel => vessel.assignedLotId).filter(Boolean));

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-xl" data-testid="winery-plan-module">
      <nav className="flex min-h-14 items-center gap-3 overflow-x-auto bg-[#263c50] px-3 text-slate-100" aria-label={ka ? 'მარნის გეგმის ნავიგაცია' : 'Winery plan navigation'}>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-300"><MapPinned className="h-4 w-4" /></span>
          <strong className="max-w-44 truncate text-xs font-black">{wineryName || (ka ? 'ჩემი მარანი' : 'My winery')}</strong>
          <span className="h-5 w-px bg-white/20" />
          <span className="whitespace-nowrap text-xs font-bold text-slate-200">{ka ? 'მარნის გეგმა' : 'Winery Plan'}</span>
        </div>

        <div className="ml-2 flex shrink-0 overflow-hidden rounded-md border border-slate-950/50 bg-slate-100 text-[10px] font-black text-slate-800 shadow-sm" aria-label={ka ? 'ხედის არჩევა' : 'View selector'}>
          <span className="flex items-center border-r border-slate-300 bg-white px-3 text-[8px] uppercase tracking-wider text-slate-500">{ka ? 'ხედი' : 'View'}</span>
          <button type="button" aria-pressed={viewMode === 'top-down'} onClick={() => switchView('top-down')} className={`min-h-9 border-r border-slate-300 px-3 transition-colors duration-200 ${viewMode === 'top-down' ? 'bg-sky-100 text-slate-900' : 'bg-slate-100 text-slate-500 hover:bg-white'}`}>{ka ? 'ზემოდან' : 'Top-down'}</button>
          <button type="button" aria-pressed={viewMode === '3d'} onClick={() => switchView('3d')} className={`inline-flex min-h-9 items-center gap-1.5 px-3 transition-colors duration-200 ${viewMode === '3d' ? 'bg-sky-100 text-slate-900' : 'bg-slate-100 text-slate-500 hover:bg-white'}`}><Box className="h-3 w-3" />3D</button>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {onOpenPlanner && <button type="button" onClick={onOpenPlanner} className="min-h-10 rounded-lg px-3 text-[10px] font-bold text-slate-200 hover:bg-white/10 hover:text-white">{ka ? 'წარმოების გეგმა' : 'Production plan'}</button>}
          {onBackToWinery && <button type="button" onClick={onBackToWinery} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[10px] font-bold text-slate-200 hover:bg-white/10 hover:text-white"><ChevronLeft className="h-3.5 w-3.5" />{ka ? 'მარანში დაბრუნება' : 'Back to winery'}</button>}
        </div>
      </nav>

      <div className="flex overflow-x-auto border-b border-white/10 bg-[#1e3040] text-slate-100">
        <Metric
          label={ka ? 'ღვინო მარანში' : 'Wine in cellar'}
          value={`${occupied.reduce((sum, vessel) => sum + vessel.currentVolume, 0).toLocaleString()} L`}
          active={focus === 'occupied'}
          hint={ka ? 'ღვინით სავსე ჭურჭლის გამოყოფა' : 'Spotlight the vessels holding wine'}
          onClick={() => toggleFocus('occupied')}
        />
        <Metric
          label={ka ? 'სუფთა ტევადობა' : 'Clean capacity'}
          value={`${cleanCapacity.toLocaleString()} L`}
          tone="text-emerald-300"
          active={focus === 'available'}
          hint={ka ? 'ცარიელი, სუფთა ჭურჭლის გამოყოფა' : 'Spotlight the empty, clean vessels'}
          onClick={() => toggleFocus('available')}
        />
        <Metric
          label={ka ? 'აქტიური პარტიები' : 'Active lots'}
          value={String(activeLotIds.size)}
          tone="text-amber-200"
          active={focus === 'lots'}
          hint={ka ? 'პარტიის მქონე ჭურჭლის გამოყოფა' : 'Spotlight the vessels carrying a lot'}
          onClick={() => toggleFocus('lots')}
        />
        <Metric
          label={ka ? 'ღია სამუშაო' : 'Open work'}
          value={String(openPlans.length)}
          tone={openPlans.length ? 'text-violet-300' : undefined}
          active={focus === 'work'}
          hint={ka ? 'დაგეგმილი სამუშაოს მქონე ჭურჭლის გამოყოფა' : 'Spotlight the vessels with work booked'}
          onClick={() => toggleFocus('work')}
        />
        <p className="ml-auto hidden max-w-xl items-center px-4 text-[9px] font-semibold leading-4 text-slate-400 2xl:flex">
          {focus
            ? (ka
              ? 'ფილტრი აქტიურია — დანარჩენი ჭურჭელი დაბინდულია. თავიდან დააჭირეთ გასასუფთავებლად.'
              : 'Filter on: the rest of the room is dimmed. Press the figure again to clear it.')
            : (ka
              ? 'აირჩიეთ ჭურჭელი პარტიის გასახსნელად, ან დააჭირეთ ციფრს რუკაზე გასაფილტრად.'
              : 'Select a vessel to open its lot or record work — or press a figure to filter the room.')}
        </p>
      </div>

      <div className="relative overflow-hidden bg-slate-900" data-view-transition={viewMode}>
        <WineryPlanStage
          lang={lang}
          view={viewMode}
          vessels={vessels}
          lots={lots}
          floors={floors}
          productionPlans={productionPlans}
          tasks={tasks}
          transfers={transfers}
          selectedVesselId={selectedVesselId}
          onSelectVessel={selectVessel}
          onUpdateVessels={onUpdateVessels}
          onUpdateFloors={onUpdateFloors}
          onOpenVessel={onOpenVessel}
          onOpenLot={onOpenLot}
          onLogOperation={onLogOperation}
          onRecordSanitation={canUpdateLayout ? setSanitationVesselId : undefined}
          onScheduleOperation={canScheduleWork ? setScheduleVesselId : undefined}
          onPlanTransfer={onStartTransfer}
          onStartFilling={onStartFilling}
          onOpenBottling={onOpenBottling}
          onRecordTransfer={onRecordTransfer ? (sourceId, destinationId) => onRecordTransfer(sourceId, destinationId) : undefined}
          onBatchTopping={onBatchTopping
            ? (vesselIds) => { setBatchError(null); setBatchVesselIds(vesselIds); }
            : undefined}
          onOpenProductionPlan={onOpenProductionPlan}
          focus={focus}
          onFocusChange={setFocus}
          canUpdate={canUpdateLayout}
          reduceMotion={Boolean(reduceMotion)}
        />
      </div>

      {batchVesselIds && onBatchTopping && (
        <React.Suspense fallback={null}>
          <BatchToppingDialog
            lang={lang}
            vesselIds={batchVesselIds}
            vessels={vessels}
            lots={lots}
            busy={batchBusy}
            error={batchError}
            progress={batchToppingProgress}
            onCancel={closeBatchDialog}
            onConfirm={async ({ sourceVesselId, litresPerVessel }) => {
              setBatchBusy(true);
              setBatchError(null);
              const failure = await onBatchTopping({ sourceVesselId, litresPerVessel, vesselIds: batchVesselIds });
              setBatchBusy(false);
              if (failure) { setBatchError(failure); return; }
              closeBatchDialog();
            }}
          />
        </React.Suspense>
      )}

      {scheduleVesselId && vessels.some(vessel => vessel.id === scheduleVesselId) && (
        <ScheduleOperationDialog
          lang={lang}
          source={vessels.find(vessel => vessel.id === scheduleVesselId)!}
          vessels={vessels}
          lots={lots}
          productionPlans={productionPlans}
          currentUsername={currentUsername}
          onClose={() => setScheduleVesselId(null)}
          onCreate={(item) => {
            onUpdateProductionPlans(current => [item, ...current]);
            setScheduleVesselId(null);
            setToastMessage?.(ka ? 'სამუშაო მარნის გეგმიდან დაინიშნა.' : 'Work assigned from the winery plan.');
          }}
        />
      )}
      {sanitationVesselId && vessels.some(vessel => vessel.id === sanitationVesselId) && (
        <SanitationDialog
          lang={lang}
          vessel={vessels.find(item => item.id === sanitationVesselId)!}
          currentUsername={currentUsername}
          onClose={() => setSanitationVesselId(null)}
          onSave={({ date, operator, action, notes }) => {
            const now = new Date().toISOString();
            onUpdateVessels(vessels.map(vessel => vessel.id === sanitationVesselId ? {
              ...vessel,
              cleaningStatus: 'clean',
              lastCleaned: date,
              lastOperation: action,
              lastModified: now,
              sanitationHistory: [{ date, action, operator, ...(notes ? { notes } : {}) }, ...(vessel.sanitationHistory || [])],
            } : vessel));
            setSanitationVesselId(null);
            setToastMessage?.(ka ? 'სანიტარია ჩაიწერა და ჭურჭელი მზადაა.' : 'Sanitation recorded; the vessel is ready for use.');
          }}
        />
      )}
    </div>
  );
}

function SanitationDialog({
  lang,
  vessel,
  currentUsername,
  onClose,
  onSave,
}: {
  lang: Language;
  vessel: Vessel;
  currentUsername: string;
  onClose: () => void;
  onSave: (entry: { date: string; operator: string; action: string; notes: string }) => void;
}) {
  const ka = lang === 'ka';
  const [date, setDate] = React.useState(localISODate());
  const [operator, setOperator] = React.useState(currentUsername);
  const [action, setAction] = React.useState(ka ? 'რეცხვა და სანიტარია დასრულდა' : 'Wash and sanitation completed');
  const [notes, setNotes] = React.useState('');

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-stone-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form onSubmit={(event) => { event.preventDefault(); if (date && operator.trim() && action.trim()) onSave({ date, operator: operator.trim(), action: action.trim(), notes: notes.trim() }); }} role="dialog" aria-modal="true" aria-labelledby="record-sanitation-title" className="w-full max-w-lg rounded-t-3xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-900 sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300"><ShieldCheck className="h-4 w-4" />{ka ? 'სანიტარიის მტკიცებულება' : 'Sanitation evidence'}</div>
            <h2 id="record-sanitation-title" className="mt-1 text-xl font-black text-stone-900 dark:text-white">{vessel.id}</h2>
            <p className="mt-1 text-xs text-stone-500">{ka ? 'ჩაწერეთ შესრულებული ციკლი; მხოლოდ ამის შემდეგ გახდება ჭურჭელი სუფთა.' : 'Record the completed cycle before the vessel is marked clean.'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={ka ? 'დახურვა' : 'Close'} className="rounded-xl p-2 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'თარიღი' : 'Date'}</span><DateInput lang={lang} value={date} onValueChange={setDate} className="min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs dark:border-stone-700 dark:bg-stone-950" required /></label>
          <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'ოპერატორი' : 'Operator'}</span><input value={operator} onChange={(event) => setOperator(event.target.value)} className="min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs dark:border-stone-700 dark:bg-stone-950" required /></label>
          <label className="space-y-1 sm:col-span-2"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'შესრულებული ციკლი' : 'Completed cycle'}</span><input value={action} onChange={(event) => setAction(event.target.value)} className="min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs dark:border-stone-700 dark:bg-stone-950" required /></label>
          <label className="space-y-1 sm:col-span-2"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'შენიშვნა' : 'Notes'}</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs dark:border-stone-700 dark:bg-stone-950" /></label>
        </div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-stone-200 px-4 text-xs font-black text-stone-600 dark:border-stone-700 dark:text-stone-200">{ka ? 'გაუქმება' : 'Cancel'}</button><button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-600 px-5 text-xs font-black text-white hover:bg-amber-700"><ShieldCheck className="h-4 w-4" />{ka ? 'სანიტარიის ჩაწერა' : 'Record sanitation'}</button></div>
      </form>
    </div>
  );
}

function ScheduleOperationDialog({
  lang,
  source,
  vessels,
  lots,
  productionPlans,
  currentUsername,
  onClose,
  onCreate,
}: {
  lang: Language;
  source: Vessel;
  vessels: Vessel[];
  lots: WineLot[];
  productionPlans: ProductionPlanItem[];
  currentUsername: string;
  onClose: () => void;
  onCreate: (item: ProductionPlanItem) => void;
}) {
  const ka = lang === 'ka';
  const today = localISODate();
  const sourceLot = source.assignedLotId ? lots.find(lot => lot.id === source.assignedLotId) : undefined;
  const [operationType, setOperationType] = React.useState<CellarOperationType>(defaultWineryPlanOperation(source));
  const [destinationVesselId, setDestinationVesselId] = React.useState('');
  const [quantityLiters, setQuantityLiters] = React.useState('');
  const [startDate, setStartDate] = React.useState(today);
  const [endDate, setEndDate] = React.useState(today);
  const [assignedTo, setAssignedTo] = React.useState(currentUsername);
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [dependencyIds, setDependencyIds] = React.useState<string[]>([]);
  const [issueCode, setIssueCode] = React.useState<WineryPlanDraftIssueCode | null>(null);
  const needsDestination = cellarOperationNeedsDestination(operationType);
  const destination = vessels.find(vessel => vessel.id === destinationVesselId);
  const eligibleDestinations = React.useMemo(() => vessels
    .filter(vessel => vessel.id !== source.id)
    .sort((left, right) => {
      const leftReady = left.cleaningStatus === 'clean' && left.capacity > left.currentVolume ? 0 : 1;
      const rightReady = right.cleaningStatus === 'clean' && right.capacity > right.currentVolume ? 0 : 1;
      return leftReady - rightReady || (right.capacity - right.currentVolume) - (left.capacity - left.currentVolume);
    }), [source.id, vessels]);
  const relevantDependencies = productionPlans.filter(plan => (
    !['completed', 'cancelled'].includes(plan.status)
    && (plan.lotId === source.assignedLotId || plan.vesselIds.includes(source.id))
  )).slice(0, 6);

  React.useEffect(() => {
    if (!needsDestination) {
      setDestinationVesselId('');
      setQuantityLiters('');
      return;
    }
    const firstReady = eligibleDestinations.find(vessel => vessel.cleaningStatus === 'clean' && vessel.capacity > vessel.currentVolume);
    const nextDestinationId = firstReady?.id || '';
    setDestinationVesselId(nextDestinationId);
    const quantity = suggestedWineryPlanQuantity(source, firstReady);
    setQuantityLiters(quantity ? String(quantity) : '');
  }, [eligibleDestinations, needsDestination, operationType, source]);

  React.useEffect(() => {
    if (!needsDestination) return;
    const quantity = suggestedWineryPlanQuantity(source, destination);
    setQuantityLiters(quantity ? String(quantity) : '');
  }, [destination, needsDestination, source]);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const draft = {
      operationType,
      vesselId: source.id,
      ...(destinationVesselId ? { destinationVesselId } : {}),
      ...(sourceLot ? { lotId: sourceLot.id } : {}),
      title,
      startDate,
      endDate,
      assignedTo,
      ...(Number(quantityLiters) > 0 ? { quantityLiters: Number(quantityLiters) } : {}),
      notes,
      dependencyIds,
    };
    const issue = wineryPlanDraftIssue(draft, vessels, lots, productionPlans);
    if (issue) {
      setIssueCode(issue.code);
      return;
    }
    onCreate(buildWineryPlanProductionItem(draft, currentUsername));
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-stone-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="schedule-winery-operation-title" className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-900 sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300"><CalendarPlus className="h-4 w-4" />{ka ? 'სამუშაოს დანიშვნა' : 'Assign wine operation'}</div>
            <h2 id="schedule-winery-operation-title" className="mt-1 text-xl font-black text-stone-900 dark:text-white">{source.id} · {sourceLot?.name || (ka ? 'თავისუფალი ჭურჭელი' : 'Available vessel')}</h2>
            <p className="mt-1 text-xs text-stone-500">{source.currentVolume.toLocaleString()} / {source.capacity.toLocaleString()} L · {source.temperature}°C</p>
          </div>
          <button type="button" onClick={onClose} aria-label={ka ? 'დახურვა' : 'Close'} className="rounded-xl p-2 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="space-y-1 md:col-span-2">
            <span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'ოპერაციის ტიპი' : 'Operation type'}</span>
            <select value={operationType} onChange={(event) => { setOperationType(event.target.value as CellarOperationType); setIssueCode(null); }} className="min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs font-bold outline-none focus:border-[#651522]/40 dark:border-stone-700 dark:bg-stone-950">
              {CELLAR_OPERATIONS.map(operation => <option key={operation.key} value={operation.key}>{ka ? operation.ka : operation.en}</option>)}
            </select>
          </label>

          {needsDestination && (
            <>
              <label className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'მიმღები ჭურჭელი' : 'Destination vessel'}</span>
                <select value={destinationVesselId} onChange={(event) => { setDestinationVesselId(event.target.value); setIssueCode(null); }} className="min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs font-bold outline-none dark:border-stone-700 dark:bg-stone-950">
                  <option value="">{ka ? 'აირჩიეთ…' : 'Select…'}</option>
                  {eligibleDestinations.map(vessel => <option key={vessel.id} value={vessel.id}>{vessel.id} · {(vessel.capacity - vessel.currentVolume).toLocaleString()} L {ka ? 'თავისუფალი' : 'free'} · {vessel.cleaningStatus}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'მოცულობა, ლ' : 'Volume, L'}</span>
                <input type="number" min="0.01" step="0.01" value={quantityLiters} onChange={(event) => { setQuantityLiters(event.target.value); setIssueCode(null); }} className="min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs font-bold outline-none dark:border-stone-700 dark:bg-stone-950" />
              </label>
            </>
          )}

          <label className="space-y-1">
            <span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'დაწყება' : 'Start'}</span>
            <DateInput lang={lang} value={startDate} onValueChange={(value) => { setStartDate(value); if (endDate < value) setEndDate(value); setIssueCode(null); }} className="min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs font-bold dark:border-stone-700 dark:bg-stone-950" required />
          </label>
          <label className="space-y-1">
            <span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'დასრულება' : 'End'}</span>
            <DateInput lang={lang} value={endDate} onValueChange={(value) => { setEndDate(value); setIssueCode(null); }} className="min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs font-bold dark:border-stone-700 dark:bg-stone-950" required />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-stone-500"><UserRound className="h-3 w-3" />{ka ? 'პასუხისმგებელი' : 'Assigned to'}</span>
            <input value={assignedTo} onChange={(event) => { setAssignedTo(event.target.value); setIssueCode(null); }} className="min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs font-bold outline-none dark:border-stone-700 dark:bg-stone-950" />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'სათაური (არასავალდებულო)' : 'Title (optional)'}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={ka ? 'ავტომატურად შეიქმნება ოპერაციიდან და პარტიიდან' : 'Generated from the operation and lot when left blank'} className="min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs outline-none dark:border-stone-700 dark:bg-stone-950" />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'ინსტრუქცია' : 'Instructions'}</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs outline-none dark:border-stone-700 dark:bg-stone-950" />
          </label>
        </div>

        {relevantDependencies.length > 0 && (
          <fieldset className="mt-4 rounded-2xl border border-stone-200 p-3 dark:border-stone-700">
            <legend className="px-2 text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'წინაპირობები' : 'Prerequisites'}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {relevantDependencies.map(plan => <label key={plan.id} className="flex items-start gap-2 rounded-xl bg-stone-50 px-3 py-2 text-[10px] font-bold text-stone-600 dark:bg-stone-950 dark:text-stone-300"><input type="checkbox" checked={dependencyIds.includes(plan.id)} onChange={(event) => setDependencyIds(current => event.target.checked ? [...current, plan.id] : current.filter(id => id !== plan.id))} className="mt-0.5 accent-[#651522]" /><span><span className="block text-stone-800 dark:text-stone-100">{plan.title}</span><span className="mt-0.5 block font-mono text-[8px] text-stone-400">{plan.endDate} · {plan.status}</span></span></label>)}
            </div>
          </fieldset>
        )}

        {issueCode && <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{ka ? issueCopy[issueCode].ka : issueCopy[issueCode].en}</div>}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2 text-[9px] font-bold text-stone-500">
            <span className="inline-flex items-center gap-1 rounded-lg bg-stone-100 px-2 py-1 dark:bg-stone-800"><Wine className="h-3 w-3" />{sourceLot?.id || (ka ? 'პარტიის გარეშე' : 'No lot')}</span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-stone-100 px-2 py-1 dark:bg-stone-800"><ShieldCheck className="h-3 w-3" />{source.cleaningStatus}</span>
            {destination && <span className="inline-flex items-center gap-1 rounded-lg bg-stone-100 px-2 py-1 dark:bg-stone-800"><ArrowRightLeft className="h-3 w-3" />{source.id} → {destination.id}</span>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-stone-200 px-4 text-xs font-black text-stone-600 dark:border-stone-700 dark:text-stone-200">{ka ? 'გაუქმება' : 'Cancel'}</button>
            <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#651522] px-5 text-xs font-black text-white hover:bg-[#7a1c2b]"><Save className="h-4 w-4" />{ka ? 'სამუშაოს დანიშვნა' : 'Assign work'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
