import React from 'react';
import {
  AlertTriangle, ArrowRight, BarChart3, CalendarClock, CalendarDays, CalendarRange,
  Check, CheckCircle2, ChevronDown, CircleDot, Clock3, Columns3, ExternalLink,
  Grape, Lightbulb, ListChecks, Package, Pencil, Plus, Save, Search, Sparkles,
  Sprout, Trash2, Warehouse, Waves, Wine, Wrench, X,
} from 'lucide-react';
import type { Language } from '../lib/language';
import type { DailyFermLog, HarvestRecord, LabAnalysis, Vessel, VineyardBlock, WineLot } from '../lib/wineryState';
import {
  allowedProductionPlanStatuses,
  detectProductionPlanConflicts,
  productionPlanTransitionIssue,
  type ProductionPlanConflict,
  type ProductionPlanItem,
  type ProductionPlanKind,
  type ProductionPlanStatus,
} from '../lib/operationsControl';
import {
  alignPlanAfterDependencies,
  buildProductionPlanSuggestions,
  forecastProductionPlan,
  type ProductionPlanSuggestion,
} from '../lib/productionPlanner';
import { localISODate } from '../lib/weatherApi';

interface ProductionPlannerTabProps {
  lang: Language;
  currentUsername: string;
  productionPlans: ProductionPlanItem[];
  onUpdateProductionPlans: React.Dispatch<React.SetStateAction<ProductionPlanItem[]>>;
  vessels: Vessel[];
  lots: WineLot[];
  blocks: VineyardBlock[];
  harvests: HarvestRecord[];
  fermentationLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  focusPlanId?: string;
  onOpenLot?: (lotId: string) => void;
  onOpenVessel?: (vesselId: string) => void;
  onOpenBlock?: (blockId: string) => void;
  onOpenWorkflow?: (item: ProductionPlanItem) => void;
  setToastMessage?: (message: string | null) => void;
}

type PlannerView = 'agenda' | 'flow' | 'calendar';
type PlannerFilter = 'open' | 'attention' | 'completed' | 'all';

const kinds: ProductionPlanKind[] = ['harvest', 'intake', 'transfer', 'fermentation', 'lab', 'bottling', 'sanitation', 'procurement', 'dispatch', 'other'];
const quickKinds: ProductionPlanKind[] = ['transfer', 'lab', 'sanitation', 'fermentation', 'bottling', 'intake'];
const statuses: ProductionPlanStatus[] = ['planned', 'ready', 'blocked', 'in_progress', 'completed', 'cancelled'];
const today = () => localISODate();

const kindIcons: Record<ProductionPlanKind, React.ComponentType<{ className?: string }>> = {
  harvest: Grape, intake: Warehouse, transfer: ArrowRight, fermentation: Waves,
  lab: CircleDot, bottling: Package, sanitation: Sparkles, procurement: Warehouse,
  dispatch: ExternalLink, other: Wrench,
};

const kindCopy: Record<ProductionPlanKind, { ka: string; en: string; actionKa: string; actionEn: string }> = {
  harvest: { ka: 'რთველი', en: 'Harvest', actionKa: 'ვენახში გახსნა', actionEn: 'Open vineyard' },
  intake: { ka: 'ყურძნის მიღება', en: 'Grape intake', actionKa: 'მიღების გახსნა', actionEn: 'Open intake' },
  transfer: { ka: 'გადატანა', en: 'Transfer', actionKa: 'გადატანის დაწყება', actionEn: 'Start transfer' },
  fermentation: { ka: 'დუღილი', en: 'Fermentation', actionKa: 'დუღილის გახსნა', actionEn: 'Open fermentation' },
  lab: { ka: 'ლაბორატორია', en: 'Laboratory', actionKa: 'ანალიზის ჩაწერა', actionEn: 'Record analysis' },
  bottling: { ka: 'ჩამოსხმა', en: 'Bottling', actionKa: 'ჩამოსხმის გახსნა', actionEn: 'Open bottling' },
  sanitation: { ka: 'სანიტარია', en: 'Sanitation', actionKa: 'სანიტარიის ჩაწერა', actionEn: 'Record sanitation' },
  procurement: { ka: 'შესყიდვა', en: 'Procurement', actionKa: 'შესყიდვაში გახსნა', actionEn: 'Open purchasing' },
  dispatch: { ka: 'გატანა', en: 'Dispatch', actionKa: 'გატანის გახსნა', actionEn: 'Open dispatch' },
  other: { ka: 'სხვა სამუშაო', en: 'Other work', actionKa: 'დავალებად გახსნა', actionEn: 'Open as task' },
};

const statusCopy: Record<ProductionPlanStatus, { ka: string; en: string }> = {
  planned: { ka: 'დაგეგმილი', en: 'Planned' },
  ready: { ka: 'მზადაა', en: 'Ready' },
  blocked: { ka: 'დაბლოკილი', en: 'Blocked' },
  in_progress: { ka: 'მიმდინარეობს', en: 'In progress' },
  completed: { ka: 'დასრულებული', en: 'Completed' },
  cancelled: { ka: 'გაუქმებული', en: 'Cancelled' },
};

function plusDays(date: string, days: number): string {
  const value = new Date(date + 'T00:00:00.000Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateParts(date: string, lang: Language): { day: string; month: string; full: string } {
  const value = new Date(date + 'T00:00:00');
  const locale = lang === 'ka' ? 'ka-GE' : 'en-US';
  return {
    day: value.toLocaleDateString(locale, { day: '2-digit' }),
    month: value.toLocaleDateString(locale, { month: 'short' }),
    full: value.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }),
  };
}

function kindColor(kind: ProductionPlanKind): string {
  if (kind === 'harvest' || kind === 'intake') return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100';
  if (kind === 'bottling' || kind === 'dispatch') return 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100';
  if (kind === 'lab' || kind === 'sanitation') return 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100';
  if (kind === 'fermentation') return 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100';
  return 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100';
}

function statusColor(status: ProductionPlanStatus): string {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
  if (status === 'in_progress') return 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200';
  if (status === 'ready') return 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200';
  if (status === 'blocked') return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200';
  return 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300';
}

function readinessIssue(
  item: Pick<ProductionPlanItem, 'kind' | 'lotId' | 'vesselIds' | 'blockId'>,
  ka: boolean,
): string | null {
  if (item.kind === 'harvest' && !item.blockId) return ka ? 'დააკავშირეთ ვენახის ბლოკი' : 'Link a vineyard block';
  if (item.kind === 'intake' && !item.blockId && !item.lotId) return ka ? 'დააკავშირეთ ბლოკი ან პარტია' : 'Link a block or lot';
  if (item.kind === 'transfer' && (!item.lotId || item.vesselIds.length < 2)) return ka ? 'საჭიროა პარტია, წყარო და მიმღები ჭურჭელი' : 'Lot, source and destination vessels are required';
  if (item.kind === 'fermentation' && (!item.lotId || item.vesselIds.length < 1)) return ka ? 'დააკავშირეთ პარტია და ჭურჭელი' : 'Link a lot and vessel';
  if (item.kind === 'lab' && !item.lotId && item.vesselIds.length < 1) return ka ? 'დააკავშირეთ პარტია ან ჭურჭელი' : 'Link a lot or vessel';
  if (item.kind === 'bottling' && (!item.lotId || item.vesselIds.length < 1)) return ka ? 'დააკავშირეთ პარტია და წყარო ჭურჭელი' : 'Link a lot and source vessel';
  if (item.kind === 'sanitation' && item.vesselIds.length < 1) return ka ? 'დააკავშირეთ გასასუფთავებელი ჭურჭელი' : 'Link the vessel to sanitize';
  if (item.kind === 'dispatch' && !item.lotId) return ka ? 'დააკავშირეთ გასატანი პარტია' : 'Link the lot to dispatch';
  return null;
}

function conflictCopy(conflict: ProductionPlanConflict, ka: boolean): string {
  if (!ka) return conflict.message;
  const copy: Record<ProductionPlanConflict['code'], string> = {
    date_order: 'დასრულების თარიღი დაწყებამდეა.',
    vessel_overlap: 'ჭურჭელი ამავე პერიოდში სხვა სამუშაოშიც არის დაჯავშნილი.',
    vessel_capacity: 'არჩეულ ჭურჭლებში საკმარისი თავისუფალი მოცულობა არ არის.',
    missing_dependency: 'ერთ-ერთი წინაპირობა აღარ არსებობს.',
    dependency_timing: 'სამუშაო წინაპირობის დასრულებამდე იწყება.',
    dependency_cycle: 'წინაპირობების ჯაჭვი ჩაკეტილ წრეს ქმნის.',
  };
  return copy[conflict.code];
}

function generatedTitle(
  kind: ProductionPlanKind,
  lang: Language,
  lot: WineLot | undefined,
  vessels: Vessel[],
  block: VineyardBlock | undefined,
): string {
  const base = lang === 'ka' ? kindCopy[kind].ka : kindCopy[kind].en;
  const context = lot?.name || block?.name || vessels.map(vessel => vessel.id).join(' → ');
  return context ? base + ' · ' + context : base;
}

function nextStatusFor(status: ProductionPlanStatus): ProductionPlanStatus | null {
  if (status === 'planned' || status === 'blocked') return 'ready';
  if (status === 'ready') return 'in_progress';
  if (status === 'in_progress') return 'completed';
  return null;
}

function nextStatusLabel(status: ProductionPlanStatus, ka: boolean): string {
  if (status === 'planned' || status === 'blocked') return ka ? 'მზადაა' : 'Mark ready';
  if (status === 'ready') return ka ? 'დაწყება' : 'Start';
  if (status === 'in_progress') return ka ? 'დასრულება' : 'Complete';
  return '';
}

export default function ProductionPlannerTab(props: ProductionPlannerTabProps) {
  const ka = props.lang === 'ka';
  const [view, setView] = React.useState<PlannerView>('agenda');
  const [filter, setFilter] = React.useState<PlannerFilter>('open');
  const [search, setSearch] = React.useState('');
  const [showCreate, setShowCreate] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [showInsights, setShowInsights] = React.useState(false);
  const [editDraft, setEditDraft] = React.useState<ProductionPlanItem | null>(null);
  const [title, setTitle] = React.useState('');
  const [kind, setKind] = React.useState<ProductionPlanKind>('transfer');
  const [startDate, setStartDate] = React.useState(today());
  const [endDate, setEndDate] = React.useState(today());
  const [lotId, setLotId] = React.useState('');
  const [vesselIds, setVesselIds] = React.useState<string[]>([]);
  const [vesselPickerId, setVesselPickerId] = React.useState('');
  const [dependencyIds, setDependencyIds] = React.useState<string[]>([]);
  const [blockId, setBlockId] = React.useState('');
  const [quantityLiters, setQuantityLiters] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [windowStart, setWindowStart] = React.useState(today());
  const days = React.useMemo(() => Array.from({ length: 14 }, (_, index) => plusDays(windowStart, index)), [windowStart]);
  const conflicts = React.useMemo(
    () => detectProductionPlanConflicts(props.productionPlans, props.vessels),
    [props.productionPlans, props.vessels],
  );
  const active = React.useMemo(
    () => [...props.productionPlans].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [props.productionPlans],
  );
  const lotsById = React.useMemo(() => new Map(props.lots.map(lot => [lot.id, lot])), [props.lots]);
  const vesselsById = React.useMemo(() => new Map(props.vessels.map(vessel => [vessel.id, vessel])), [props.vessels]);
  const blocksById = React.useMemo(() => new Map(props.blocks.map(block => [block.id, block])), [props.blocks]);
  const suggestions = React.useMemo(() => buildProductionPlanSuggestions({
    today: today(),
    lots: props.lots,
    vessels: props.vessels,
    fermentationLogs: props.fermentationLogs,
    labLogs: props.labLogs,
    productionPlans: props.productionPlans,
  }), [props.fermentationLogs, props.labLogs, props.lots, props.productionPlans, props.vessels]);

  React.useEffect(() => {
    if (!props.focusPlanId) return;
    setView('agenda');
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById('plan-' + props.focusPlanId);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.focusPlanId, props.productionPlans]);

  const selectedDraftLot = lotsById.get(lotId);
  const selectedDraftVessels = vesselIds.map(id => vesselsById.get(id)).filter((vessel): vessel is Vessel => Boolean(vessel));
  const selectedDraftBlock = blocksById.get(blockId);
  const draftLinkIssue = lotId && vesselIds.length > 0
    && ['transfer', 'fermentation', 'lab', 'bottling'].includes(kind)
    && selectedDraftVessels[0]?.assignedLotId
    && selectedDraftVessels[0].assignedLotId !== lotId
      ? (ka ? 'არჩეული წყარო ჭურჭელი სხვა პარტიას ეკუთვნის' : 'The selected source vessel belongs to another lot')
      : null;
  const transferCapacityIssue = kind === 'transfer' && selectedDraftVessels.length >= 2
    ? (() => {
      const plannedVolume = Number(quantityLiters);
      const sourceAvailable = selectedDraftVessels[0].currentVolume;
      const destinationHeadroom = Math.max(
        0,
        selectedDraftVessels[1].capacity - selectedDraftVessels[1].currentVolume,
      );
      if (!(plannedVolume > 0)) return ka ? 'გადასატანი მოცულობა უნდა იყოს ნულზე მეტი' : 'Transfer volume must be greater than zero';
      if (plannedVolume > sourceAvailable) return ka ? 'გეგმიური მოცულობა წყაროში არსებულზე მეტია' : 'Planned volume exceeds the source volume';
      if (plannedVolume > destinationHeadroom) return ka ? 'გეგმიური მოცულობა მიმღების თავისუფალ ტევადობას აღემატება' : 'Planned volume exceeds destination headroom';
      return null;
    })()
    : null;
  const draftIssue = readinessIssue(
    { kind, lotId: lotId || undefined, vesselIds, blockId: blockId || undefined },
    ka,
  ) || draftLinkIssue || transferCapacityIssue;
  const availableDraftVessels = React.useMemo(() => props.vessels
    .filter(vessel => !vesselIds.includes(vessel.id))
    .sort((left, right) => {
      if (!lotId) return left.id.localeCompare(right.id);
      const sourceSelection = vesselIds.length === 0;
      const leftScore = sourceSelection
        ? (left.assignedLotId === lotId && left.currentVolume > 0 ? 0 : 1)
        : (left.currentVolume === 0 && left.cleaningStatus === 'clean' ? 0 : 1);
      const rightScore = sourceSelection
        ? (right.assignedLotId === lotId && right.currentVolume > 0 ? 0 : 1)
        : (right.currentVolume === 0 && right.cleaningStatus === 'clean' ? 0 : 1);
      if (leftScore !== rightScore) return leftScore - rightScore;
      if (!sourceSelection) {
        const leftHeadroom = Math.max(0, left.capacity - left.currentVolume);
        const rightHeadroom = Math.max(0, right.capacity - right.currentVolume);
        if (leftHeadroom !== rightHeadroom) return rightHeadroom - leftHeadroom;
      }
      return left.id.localeCompare(right.id);
    }), [lotId, props.vessels, vesselIds]);

  const resetDraft = () => {
    setTitle('');
    setKind('transfer');
    setStartDate(today());
    setEndDate(today());
    setLotId('');
    setVesselIds([]);
    setVesselPickerId('');
    setDependencyIds([]);
    setBlockId('');
    setQuantityLiters('');
    setNotes('');
    setShowAdvanced(false);
  };

  const closeCreate = () => {
    setShowCreate(false);
    resetDraft();
  };

  const addDraftVessel = () => {
    if (!vesselPickerId) return;
    const nextVesselIds = [...vesselIds, vesselPickerId];
    setVesselIds(nextVesselIds);
    if (kind === 'transfer' && nextVesselIds.length === 2) {
      const source = vesselsById.get(nextVesselIds[0]);
      const destination = vesselsById.get(nextVesselIds[1]);
      const safeVolume = Math.min(
        source?.currentVolume || 0,
        Math.max(0, (destination?.capacity || 0) - (destination?.currentVolume || 0)),
      );
      setQuantityLiters(safeVolume > 0 ? String(safeVolume) : '');
    }
    setVesselPickerId('');
  };

  const addPlan = () => {
    if (!startDate || !endDate || endDate < startDate) {
      props.setToastMessage?.(ka ? 'შეამოწმეთ სამუშაოს თარიღები.' : 'Check the work dates.');
      return;
    }
    if (draftIssue) {
      props.setToastMessage?.(draftIssue);
      return;
    }
    const createdAt = new Date().toISOString();
    const item: ProductionPlanItem = {
      id: 'plan-' + createdAt.replace(/[^0-9]/g, '').slice(0, 17),
      title: title.trim() || generatedTitle(kind, props.lang, selectedDraftLot, selectedDraftVessels, selectedDraftBlock),
      kind,
      status: 'planned',
      startDate,
      endDate,
      assignedTo: props.currentUsername,
      ...(lotId ? { lotId } : {}),
      vesselIds,
      ...(blockId ? { blockId } : {}),
      ...(Number(quantityLiters) > 0 ? { quantityLiters: Number(quantityLiters) } : {}),
      notes: notes.trim(),
      dependencyIds,
      createdAt,
      createdBy: props.currentUsername,
    };
    props.onUpdateProductionPlans(current => [item, ...current]);
    props.setToastMessage?.(ka ? 'სამუშაო საოპერაციო გეგმაში დაემატა.' : 'Work added to the operational plan.');
    closeCreate();
  };

  const acceptSuggestion = (suggestion: ProductionPlanSuggestion) => {
    const createdAt = new Date().toISOString();
    const item: ProductionPlanItem = {
      id: 'plan-' + suggestion.id + '-' + createdAt.replace(/[^0-9]/g, '').slice(0, 17),
      title: ka ? suggestion.title.ka : suggestion.title.en,
      kind: suggestion.kind,
      status: 'planned',
      startDate: suggestion.startDate,
      endDate: suggestion.endDate,
      assignedTo: props.currentUsername,
      ...(suggestion.lotId ? { lotId: suggestion.lotId } : {}),
      vesselIds: suggestion.vesselIds,
      notes: ka ? suggestion.notes.ka : suggestion.notes.en,
      dependencyIds: [],
      createdAt,
      createdBy: props.currentUsername,
    };
    props.onUpdateProductionPlans(current => [item, ...current]);
    props.setToastMessage?.(ka ? 'რეკომენდებული სამუშაო გეგმაში დაემატა.' : 'Suggested work added to the plan.');
  };

  const generateHarvestPlan = () => {
    const existingHarvestIds = new Set(
      props.productionPlans
        .filter(item => item.kind === 'harvest')
        .map(item => item.notes.match(/harvest:([^\s]+)/)?.[1])
        .filter(Boolean),
    );
    const createdAt = new Date().toISOString();
    const additions = props.harvests
      .filter(harvest => !existingHarvestIds.has(harvest.id))
      .map((harvest, index): ProductionPlanItem => {
        const date = harvest.actualHarvestDate || harvest.estimatedHarvestDate;
        const block = props.blocks.find(item => item.id === harvest.blockId);
        return {
          id: 'plan-harvest-' + harvest.id + '-' + createdAt.replace(/[^0-9]/g, '').slice(0, 14) + '-' + index,
          title: harvest.variety + ' · ' + (block?.name || harvest.blockId),
          kind: 'harvest',
          status: harvest.actualHarvestDate ? 'completed' : 'planned',
          startDate: date,
          endDate: date,
          assignedTo: props.currentUsername,
          ...(harvest.associatedLotId ? { lotId: harvest.associatedLotId } : {}),
          vesselIds: [],
          blockId: harvest.blockId,
          quantityLiters: harvest.actualHarvestedKg ? harvest.actualHarvestedKg * 0.7 : harvest.estimatedTons * 700,
          notes: 'Generated from harvest:' + harvest.id,
          dependencyIds: [],
          createdAt,
          createdBy: props.currentUsername,
        };
      });
    if (!additions.length) {
      props.setToastMessage?.(ka ? 'ყველა მოსავლის ჩანაწერი უკვე გეგმაშია.' : 'All harvest records are already in the plan.');
      return;
    }
    props.onUpdateProductionPlans(current => [...additions, ...current]);
    props.setToastMessage?.(
      ka ? additions.length + ' მოსავლის ეტაპი დაემატა.' : additions.length + ' harvest item(s) added.',
    );
  };

  const update = (id: string, patch: Partial<ProductionPlanItem>) => props.onUpdateProductionPlans(
    current => current.map(item => item.id === id ? { ...item, ...patch, lastModified: new Date().toISOString() } : item),
  );

  const operationalDataIssue = (item: ProductionPlanItem): string | null => {
    const requiredLinkIssue = readinessIssue(item, ka);
    if (requiredLinkIssue) return requiredLinkIssue;
    const selectedVessels = item.vesselIds
      .map(id => vesselsById.get(id))
      .filter((vessel): vessel is Vessel => Boolean(vessel));
    if (
      item.lotId
      && selectedVessels[0]?.assignedLotId
      && selectedVessels[0].assignedLotId !== item.lotId
      && ['transfer', 'fermentation', 'lab', 'bottling'].includes(item.kind)
    ) {
      return ka ? 'არჩეული წყარო ჭურჭელი სხვა პარტიას ეკუთვნის' : 'The selected source vessel belongs to another lot';
    }
    if (item.kind !== 'transfer' || selectedVessels.length < 2) return null;
    const quantity = item.quantityLiters || 0;
    if (!(quantity > 0)) return ka ? 'გადასატანი მოცულობა უნდა იყოს ნულზე მეტი' : 'Transfer volume must be greater than zero';
    if (quantity > selectedVessels[0].currentVolume) {
      return ka ? 'გეგმიური მოცულობა წყაროში არსებულზე მეტია' : 'Planned volume exceeds the source volume';
    }
    const destinationHeadroom = Math.max(0, selectedVessels[1].capacity - selectedVessels[1].currentVolume);
    if (quantity > destinationHeadroom) {
      return ka ? 'გეგმიური მოცულობა მიმღების თავისუფალ ტევადობას აღემატება' : 'Planned volume exceeds destination headroom';
    }
    return null;
  };

  const saveEdit = () => {
    if (!editDraft) return;
    if (!editDraft.title.trim() || !editDraft.startDate || !editDraft.endDate || editDraft.endDate < editDraft.startDate) {
      props.setToastMessage?.(ka ? 'შეამოწმეთ სათაური და თარიღები.' : 'Check the title and dates.');
      return;
    }
    const issue = operationalDataIssue(editDraft);
    if (issue) {
      props.setToastMessage?.(issue);
      return;
    }
    update(editDraft.id, {
      title: editDraft.title.trim(),
      startDate: editDraft.startDate,
      endDate: editDraft.endDate,
      assignedTo: editDraft.assignedTo.trim() || props.currentUsername,
      lotId: editDraft.lotId || undefined,
      vesselIds: editDraft.vesselIds,
      blockId: editDraft.blockId || undefined,
      quantityLiters: editDraft.quantityLiters && editDraft.quantityLiters > 0 ? editDraft.quantityLiters : undefined,
      notes: editDraft.notes.trim(),
    });
    setEditDraft(null);
    props.setToastMessage?.(ka ? 'სამუშაო განახლდა.' : 'Work updated.');
  };

  const changeStatus = (item: ProductionPlanItem, status: ProductionPlanStatus) => {
    const issue = productionPlanTransitionIssue(item, status, props.productionPlans, conflicts);
    if (issue) {
      props.setToastMessage?.(ka ? 'სტატუსი ვერ შეიცვალა: ' + issue : 'Status was not changed: ' + issue);
      return;
    }
    update(item.id, { status });
  };

  const removePlan = (id: string) => {
    const dependents = props.productionPlans.filter(item => item.dependencyIds.includes(id));
    if (dependents.length) {
      props.setToastMessage?.(
        ka ? 'ჯერ დამოკიდებული სამუშაოებიდან მოხსენით ეს წინაპირობა.' : 'Remove this prerequisite from dependent items first.',
      );
      return;
    }
    props.onUpdateProductionPlans(current => current.filter(candidate => candidate.id !== id));
  };

  const wouldCreateDependencyCycle = (itemId: string, dependencyId: string) => {
    const byId = new Map(props.productionPlans.map(item => [item.id, item]));
    const queue = [dependencyId];
    const visited = new Set<string>();
    while (queue.length) {
      const currentId = queue.shift()!;
      if (currentId === itemId) return true;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      queue.push(...(byId.get(currentId)?.dependencyIds || []));
    }
    return false;
  };

  const toggleDependency = (item: ProductionPlanItem, dependencyId: string, checked: boolean) => {
    if (checked && wouldCreateDependencyCycle(item.id, dependencyId)) {
      props.setToastMessage?.(ka ? 'ეს კავშირი დამოკიდებულების ციკლს შექმნის.' : 'That prerequisite would create a dependency cycle.');
      return;
    }
    update(item.id, {
      dependencyIds: checked
        ? [...new Set([...item.dependencyIds, dependencyId])]
        : item.dependencyIds.filter(id => id !== dependencyId),
    });
  };

  const isAttentionItem = React.useCallback((item: ProductionPlanItem) => (
    item.status === 'blocked'
    || conflicts.some(conflict => conflict.itemId === item.id)
    || Boolean(readinessIssue(item, ka))
    || (() => {
      const nextStatus = nextStatusFor(item.status);
      return Boolean(nextStatus && productionPlanTransitionIssue(item, nextStatus, props.productionPlans, conflicts));
    })()
  ), [conflicts, ka, props.productionPlans]);

  const openItems = active.filter(item => !['completed', 'cancelled'].includes(item.status));
  const todayItems = openItems.filter(item => item.startDate <= today() && item.endDate >= today());
  const overdueItems = openItems.filter(item => item.endDate < today());
  const inProgressCount = openItems.filter(item => item.status === 'in_progress').length;
  const attentionCount = openItems.filter(isAttentionItem).length;
  const unlinkedCount = openItems.filter(item => Boolean(readinessIssue(item, ka))).length;
  const forecast = forecastProductionPlan({
    today: today(),
    productionPlans: props.productionPlans,
    vessels: props.vessels,
    attentionItemIds: openItems.filter(isAttentionItem).map(item => item.id),
  });
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredItems = active.filter(item => {
    if (filter === 'open' && ['completed', 'cancelled'].includes(item.status)) return false;
    if (filter === 'attention' && !isAttentionItem(item)) return false;
    if (filter === 'completed' && !['completed', 'cancelled'].includes(item.status)) return false;
    if (!normalizedSearch) return true;
    const lot = item.lotId ? lotsById.get(item.lotId) : undefined;
    const block = item.blockId ? blocksById.get(item.blockId) : undefined;
    return [
      item.title, item.kind, item.status, item.lotId, lot?.name, block?.name, ...item.vesselIds,
    ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalizedSearch);
  });

  const attentionItems = filteredItems.filter(
    item => !['completed', 'cancelled'].includes(item.status) && isAttentionItem(item),
  );
  const agendaTodayItems = filteredItems.filter(
    item => !attentionItems.includes(item)
      && !['completed', 'cancelled'].includes(item.status)
      && (item.endDate < today() || (item.startDate <= today() && item.endDate >= today()) || item.status === 'in_progress'),
  );
  const nextWeekItems = filteredItems.filter(
    item => !attentionItems.includes(item)
      && !agendaTodayItems.includes(item)
      && !['completed', 'cancelled'].includes(item.status)
      && item.startDate <= plusDays(today(), 7),
  );
  const laterItems = filteredItems.filter(
    item => !attentionItems.includes(item)
      && !agendaTodayItems.includes(item)
      && !nextWeekItems.includes(item)
      && !['completed', 'cancelled'].includes(item.status),
  );
  const closedItems = filteredItems.filter(item => ['completed', 'cancelled'].includes(item.status));

  const renderPlanCard = (item: ProductionPlanItem) => {
    const itemConflicts = conflicts.filter(conflict => conflict.itemId === item.id);
    const allowedStatuses = allowedProductionPlanStatuses(item, props.productionPlans, conflicts);
    const nextStatus = nextStatusFor(item.status);
    const nextIssue = nextStatus
      ? productionPlanTransitionIssue(item, nextStatus, props.productionPlans, conflicts)
      : null;
    const missingLink = readinessIssue(item, ka);
    const lot = item.lotId ? lotsById.get(item.lotId) : undefined;
    const block = item.blockId ? blocksById.get(item.blockId) : undefined;
    const date = dateParts(item.startDate, props.lang);
    const KindIcon = kindIcons[item.kind];
    const isOverdue = !['completed', 'cancelled'].includes(item.status) && item.endDate < today();
    const critical = item.status === 'blocked' || itemConflicts.some(conflict => conflict.severity === 'critical');
    const focus = props.focusPlanId === item.id;
    const alignedDates = alignPlanAfterDependencies(item, props.productionPlans);
    const itemEditDraft = editDraft?.id === item.id ? editDraft : null;
    const editIssue = itemEditDraft ? operationalDataIssue(itemEditDraft) : null;
    const articleClass = 'group rounded-2xl border bg-white p-4 shadow-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-[#651522] hover:shadow-md dark:bg-stone-900 '
      + (focus
        ? 'border-violet-700 bg-violet-50/40 dark:border-violet-400 dark:bg-violet-950/20'
        : critical ? 'border-rose-200 dark:border-rose-900/70' : 'border-stone-200 dark:border-stone-800');
    return (
      <article id={'plan-' + item.id} tabIndex={-1} key={item.id} className={articleClass}>
        <div className="flex gap-3 sm:gap-4">
          <div className={'flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-xl border text-center '
            + (isOverdue
              ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950'
              : 'border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200')}>
            <strong className="text-lg leading-none">{date.day}</strong>
            <span className="mt-1 text-[9px] font-black uppercase">{date.month}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-black uppercase ' + kindColor(item.kind)}>
                <KindIcon className="h-3 w-3" />{ka ? kindCopy[item.kind].ka : kindCopy[item.kind].en}
              </span>
              <span className={'rounded-full px-2 py-1 text-[9px] font-black uppercase ' + statusColor(item.status)}>
                {ka ? statusCopy[item.status].ka : statusCopy[item.status].en}
              </span>
              {isOverdue && <span className="text-[9px] font-black uppercase text-rose-700 dark:text-rose-300">{ka ? 'ვადაგადაცილებული' : 'Overdue'}</span>}
            </div>
            <h3 className="mt-2 text-sm font-black text-stone-950 dark:text-white">{item.title}</h3>
            <p className="mt-1 text-[11px] text-stone-500">
              {item.startDate === item.endDate ? date.full : item.startDate + ' — ' + item.endDate}
              {item.quantityLiters ? ' · ' + item.quantityLiters.toLocaleString() + ' L' : ''}
              {item.dependencyIds.length ? ' · ' + item.dependencyIds.length + (ka ? ' წინაპირობა' : ' prerequisite(s)') : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.lotId && (
                <button
                  type="button"
                  onClick={() => props.onOpenLot?.(item.lotId!)}
                  disabled={!props.onOpenLot}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2 text-[10px] font-bold text-stone-700 enabled:hover:border-[#651522] enabled:hover:text-[#651522] disabled:cursor-default dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200"
                >
                  <Wine className="h-3 w-3" />{lot?.name || item.lotId}<span className="font-mono text-stone-400">{item.lotId}</span>
                </button>
              )}
              {item.vesselIds.map(vesselId => (
                <button
                  key={vesselId}
                  type="button"
                  onClick={() => props.onOpenVessel?.(vesselId)}
                  disabled={!props.onOpenVessel}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2 text-[10px] font-bold text-stone-700 enabled:hover:border-[#651522] enabled:hover:text-[#651522] disabled:cursor-default dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200"
                >
                  <CircleDot className="h-3 w-3" />{vesselId}
                </button>
              ))}
              {item.blockId && (
                <button
                  type="button"
                  onClick={() => props.onOpenBlock?.(item.blockId!)}
                  disabled={!props.onOpenBlock}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2 text-[10px] font-bold text-stone-700 enabled:hover:border-[#651522] enabled:hover:text-[#651522] disabled:cursor-default dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200"
                >
                  <Sprout className="h-3 w-3" />{block?.name || item.blockId}
                </button>
              )}
              {!item.lotId && !item.vesselIds.length && !item.blockId && (
                <span className="inline-flex min-h-8 items-center rounded-lg border border-dashed border-amber-300 px-2 text-[10px] font-bold text-amber-700 dark:border-amber-800 dark:text-amber-300">
                  {ka ? 'ჩანაწერი სისტემასთან დაუკავშირებელია' : 'Not linked to a system record'}
                </span>
              )}
            </div>
            {(missingLink || itemConflicts.length > 0 || nextIssue) && (
              <div className="mt-3 space-y-1">
                {missingLink && <p className="flex items-start gap-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{missingLink}</p>}
                {itemConflicts.map((conflict, index) => (
                  <p key={conflict.code + '-' + index} className={'flex items-start gap-1.5 text-[10px] font-bold ' + (conflict.severity === 'critical' ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300')}>
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{conflictCopy(conflict, ka)}
                  </p>
                ))}
                {nextIssue && <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300">{ka ? 'შემდეგი ნაბიჯი დაბლოკილია' : 'Next step is blocked'}: {nextIssue}</p>}
              </div>
            )}
          </div>
          <div className="hidden shrink-0 flex-col items-end gap-2 lg:flex">
            {props.onOpenWorkflow && !['completed', 'cancelled'].includes(item.status) && (
              <button type="button" onClick={() => props.onOpenWorkflow?.(item)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#651522] px-3 text-[10px] font-black text-white hover:bg-[#4e0e15]">
                <ExternalLink className="h-3.5 w-3.5" />{ka ? kindCopy[item.kind].actionKa : kindCopy[item.kind].actionEn}
              </button>
            )}
            {props.canUpdate && nextStatus && (
              <button
                type="button"
                disabled={Boolean(nextIssue || missingLink)}
                onClick={() => changeStatus(item, nextStatus)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-stone-200 px-3 text-[10px] font-black text-stone-700 hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:text-stone-200"
              >
                <Check className="h-3.5 w-3.5" />{nextStatusLabel(item.status, ka)}
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-2 lg:hidden">
          {props.onOpenWorkflow && !['completed', 'cancelled'].includes(item.status) && (
            <button type="button" onClick={() => props.onOpenWorkflow?.(item)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[#651522] px-3 text-[10px] font-black text-white">
              <ExternalLink className="h-3.5 w-3.5" />{ka ? kindCopy[item.kind].actionKa : kindCopy[item.kind].actionEn}
            </button>
          )}
          {props.canUpdate && nextStatus && (
            <button type="button" disabled={Boolean(nextIssue || missingLink)} onClick={() => changeStatus(item, nextStatus)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-stone-200 px-3 text-[10px] font-black disabled:opacity-40 dark:border-stone-700">
              <Check className="h-3.5 w-3.5" />{nextStatusLabel(item.status, ka)}
            </button>
          )}
        </div>
        <details className="mt-3 border-t border-stone-100 pt-2 dark:border-stone-800">
          <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between text-[10px] font-black uppercase tracking-wide text-stone-400">
            <span>{ka ? 'დეტალები და მართვა' : 'Details and controls'}</span><ChevronDown className="h-3.5 w-3.5" />
          </summary>
          <div className="mt-3 grid gap-3 border-t border-stone-100 pt-3 dark:border-stone-800 lg:grid-cols-[1fr_auto]">
            {itemEditDraft && (
              <div className="rounded-2xl border border-[#d9c4c8] bg-[#fbf7f8] p-4 dark:border-[#5a2730] dark:bg-[#2b171c] lg:col-span-2">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="space-y-1 md:col-span-2"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'სათაური' : 'Title'}</span><input value={itemEditDraft.title} onChange={event => setEditDraft({ ...itemEditDraft, title: event.target.value })} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950" /></label>
                  <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'დაწყება' : 'Start'}</span><input type="date" value={itemEditDraft.startDate} onChange={event => setEditDraft({ ...itemEditDraft, startDate: event.target.value, endDate: itemEditDraft.endDate < event.target.value ? event.target.value : itemEditDraft.endDate })} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950" /></label>
                  <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'დასრულება' : 'End'}</span><input type="date" min={itemEditDraft.startDate} value={itemEditDraft.endDate} onChange={event => setEditDraft({ ...itemEditDraft, endDate: event.target.value })} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950" /></label>
                  {!['harvest', 'sanitation', 'procurement', 'other'].includes(item.kind) && (
                    <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'პარტია' : 'Lot'}</span><select value={itemEditDraft.lotId || ''} onChange={event => setEditDraft({ ...itemEditDraft, lotId: event.target.value || undefined, vesselIds: [] })} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950"><option value="">{ka ? 'აირჩიეთ' : 'Select'}</option>{props.lots.filter(candidate => !candidate.voidedAt).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.id}</option>)}</select></label>
                  )}
                  {['harvest', 'intake'].includes(item.kind) && (
                    <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'ვენახის ბლოკი' : 'Vineyard block'}</span><select value={itemEditDraft.blockId || ''} onChange={event => setEditDraft({ ...itemEditDraft, blockId: event.target.value || undefined })} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950"><option value="">{ka ? 'აირჩიეთ' : 'Select'}</option>{props.blocks.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
                  )}
                  {item.kind === 'transfer' && [0, 1].map(index => (
                    <label key={index} className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{index === 0 ? (ka ? 'წყარო ჭურჭელი' : 'Source vessel') : (ka ? 'მიმღები ჭურჭელი' : 'Destination vessel')}</span><select value={itemEditDraft.vesselIds[index] || ''} onChange={event => { const next = [...itemEditDraft.vesselIds]; if (event.target.value) next[index] = event.target.value; else next.splice(index, 1); setEditDraft({ ...itemEditDraft, vesselIds: next.slice(0, 2) }); }} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950"><option value="">{ka ? 'აირჩიეთ' : 'Select'}</option>{props.vessels.filter(candidate => !itemEditDraft.vesselIds.some((id, selectedIndex) => selectedIndex !== index && id === candidate.id)).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.id} · {candidate.currentVolume.toLocaleString()}/{candidate.capacity.toLocaleString()} L</option>)}</select></label>
                  ))}
                  {['fermentation', 'lab', 'bottling', 'sanitation'].includes(item.kind) && (
                    <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'ჭურჭელი' : 'Vessel'}</span><select value={itemEditDraft.vesselIds[0] || ''} onChange={event => setEditDraft({ ...itemEditDraft, vesselIds: event.target.value ? [event.target.value] : [] })} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950"><option value="">{ka ? 'აირჩიეთ' : 'Select'}</option>{props.vessels.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.id} · {candidate.currentVolume.toLocaleString()}/{candidate.capacity.toLocaleString()} L</option>)}</select></label>
                  )}
                  <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'პასუხისმგებელი' : 'Owner'}</span><input value={itemEditDraft.assignedTo} onChange={event => setEditDraft({ ...itemEditDraft, assignedTo: event.target.value })} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950" /></label>
                  <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'მოცულობა, ლ' : 'Quantity, L'}</span><input type="number" min="0" value={itemEditDraft.quantityLiters || ''} onChange={event => setEditDraft({ ...itemEditDraft, quantityLiters: Number(event.target.value) || undefined })} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950" /></label>
                  <label className="space-y-1 md:col-span-2"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'შენიშვნა' : 'Notes'}</span><input value={itemEditDraft.notes} onChange={event => setEditDraft({ ...itemEditDraft, notes: event.target.value })} className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-xs dark:border-stone-700 dark:bg-stone-950" /></label>
                </div>
                <div className="mt-4 flex flex-col gap-3 border-t border-stone-200 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-stone-700">
                  <span className={'flex items-center gap-1.5 text-[10px] font-bold ' + (editIssue ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300')}>{editIssue ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{editIssue || (ka ? 'სამუშაო მზადაა შესანახად' : 'Work is ready to save')}</span>
                  <div className="flex gap-2"><button type="button" onClick={() => setEditDraft(null)} className="min-h-10 rounded-xl border border-stone-200 px-3 text-[10px] font-black dark:border-stone-700">{ka ? 'გაუქმება' : 'Cancel'}</button><button type="button" onClick={saveEdit} disabled={Boolean(editIssue)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#651522] px-4 text-[10px] font-black text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" />{ka ? 'შენახვა' : 'Save changes'}</button></div>
                </div>
              </div>
            )}
            <div>
              {item.notes && <p className="text-xs leading-5 text-stone-600 dark:text-stone-300">{item.notes}</p>}
              {item.dependencyIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.dependencyIds.map(id => <span key={id} className="rounded-lg bg-stone-100 px-2 py-1 text-[10px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">{props.productionPlans.find(plan => plan.id === id)?.title || id}</span>)}
                </div>
              )}
              {props.canUpdate && alignedDates && itemConflicts.some(conflict => conflict.code === 'dependency_timing') && (
                <button type="button" onClick={() => update(item.id, alignedDates)} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 text-[10px] font-black text-amber-800 hover:border-amber-400 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"><CalendarClock className="h-3.5 w-3.5" />{ka ? 'წინაპირობების შემდეგ გადატანა' : 'Move after prerequisites'}</button>
              )}
              {props.canUpdate && active.length > 1 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[10px] font-black text-violet-700 dark:text-violet-300">{ka ? 'წინაპირობების შეცვლა' : 'Edit prerequisites'}</summary>
                  <div className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-auto">
                    {active.filter(candidate => candidate.id !== item.id).map(candidate => {
                      const cycle = !item.dependencyIds.includes(candidate.id) && wouldCreateDependencyCycle(item.id, candidate.id);
                      return (
                        <label key={candidate.id} className={'flex items-center gap-2 rounded-lg bg-stone-50 px-2 py-1.5 text-[10px] dark:bg-stone-950 ' + (cycle ? 'opacity-40' : '')}>
                          <input type="checkbox" checked={item.dependencyIds.includes(candidate.id)} disabled={cycle} onChange={event => toggleDependency(item, candidate.id, event.target.checked)} />{candidate.title}
                        </label>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
            <div className="flex items-start gap-2">
              {props.canUpdate && (
                <button type="button" aria-label={ka ? item.title + ' რედაქტირება' : 'Edit ' + item.title} onClick={() => setEditDraft(itemEditDraft ? null : { ...item, vesselIds: [...item.vesselIds], dependencyIds: [...item.dependencyIds] })} className="rounded-xl border border-stone-200 p-3 text-stone-500 hover:border-[#651522] hover:text-[#651522] dark:border-stone-700"><Pencil className="h-4 w-4" /></button>
              )}
              {props.canUpdate && (
                <select
                  aria-label={(ka ? item.title + ' სტატუსი' : item.title + ' status')}
                  value={item.status}
                  onChange={event => changeStatus(item, event.target.value as ProductionPlanStatus)}
                  className="min-h-10 rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs dark:border-stone-700 dark:bg-stone-950"
                >
                  {statuses.map(status => <option key={status} value={status} disabled={!allowedStatuses.includes(status)}>{ka ? statusCopy[status].ka : statusCopy[status].en}</option>)}
                </select>
              )}
              {props.canDelete && (
                <button type="button" aria-label={ka ? item.title + ' წაშლა' : 'Delete ' + item.title} onClick={() => removePlan(item.id)} className="rounded-xl border border-stone-200 p-3 text-stone-400 hover:border-rose-200 hover:text-rose-700 dark:border-stone-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </details>
      </article>
    );
  };

  const renderAgendaSection = (
    sectionId: string,
    label: string,
    description: string,
    items: ProductionPlanItem[],
    tone: 'stone' | 'rose' = 'stone',
  ) => {
    if (!items.length) return null;
    return (
      <section aria-labelledby={sectionId} className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id={sectionId} className={'text-xs font-black uppercase tracking-[0.14em] ' + (tone === 'rose' ? 'text-rose-700 dark:text-rose-300' : 'text-stone-700 dark:text-stone-200')}>{label}</h2>
            <p className="mt-1 text-[10px] text-stone-400">{description}</p>
          </div>
          <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-black text-stone-500 dark:bg-stone-800">{items.length}</span>
        </div>
        {items.map(renderPlanCard)}
      </section>
    );
  };

  const metrics = [
    {
      label: ka ? 'დღეს' : 'Today',
      value: todayItems.length,
      detail: overdueItems.length ? overdueItems.length + (ka ? ' ვადაგადაც.' : ' overdue') : (ka ? 'ვადაში' : 'on schedule'),
      tone: overdueItems.length ? 'text-rose-700' : 'text-stone-950',
    },
    { label: ka ? 'მიმდინარეობს' : 'In progress', value: inProgressCount, detail: ka ? 'აქტიური სამუშაო' : 'active work', tone: 'text-sky-700' },
    { label: ka ? 'საჭიროებს ყურადღებას' : 'Needs attention', value: attentionCount, detail: ka ? 'კონფლიქტი ან ბლოკი' : 'conflict or blocker', tone: attentionCount ? 'text-rose-700' : 'text-stone-950' },
    { label: ka ? 'კავშირის გარეშე' : 'Missing links', value: unlinkedCount, detail: ka ? 'მონაცემი აკლია' : 'records needed', tone: unlinkedCount ? 'text-amber-700' : 'text-stone-950' },
    { label: ka ? 'შემდეგი 7 დღე' : 'Next 7 days', value: openItems.filter(item => item.startDate > today() && item.startDate <= plusDays(today(), 7)).length, detail: ka ? 'დაგეგმილი' : 'scheduled', tone: 'text-stone-950' },
  ];
  const flowColumns: Array<{ key: string; label: string; statuses: ProductionPlanStatus[]; tone: string }> = [
    { key: 'planned', label: ka ? 'დაგეგმილი' : 'Planned', statuses: ['planned'], tone: 'bg-stone-400' },
    { key: 'ready', label: ka ? 'მზადაა' : 'Ready', statuses: ['ready'], tone: 'bg-violet-500' },
    { key: 'in-progress', label: ka ? 'მიმდინარეობს' : 'In progress', statuses: ['in_progress'], tone: 'bg-sky-500' },
    { key: 'blocked', label: ka ? 'დაბლოკილი' : 'Blocked', statuses: ['blocked'], tone: 'bg-rose-500' },
    ...(['completed', 'all'].includes(filter) ? [{ key: 'closed', label: ka ? 'დახურული' : 'Closed', statuses: ['completed', 'cancelled'] as ProductionPlanStatus[], tone: 'bg-emerald-500' }] : []),
  ];

  return (
    <div data-testid="production-planner" className="space-y-5">
      <header className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900 lg:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#651522] dark:text-amber-300"><CalendarRange className="h-4 w-4" />{ka ? 'მარანი · საოპერაციო გეგმა' : 'Cellar · operational plan'}</div>
            <h1 className="mt-2 font-serif text-3xl font-semibold text-stone-950 dark:text-white">{ka ? 'დღის სამუშაო, ერთი ხედიდან' : 'Operational production plan'}</h1>
            <p className="mt-2 max-w-xl text-xs leading-5 text-stone-500">{ka ? 'დაგეგმეთ მხოლოდ საჭირო ნაბიჯები, გადაამოწმეთ მზადყოფნა და პირდაპირ გახსენით პარტია, ჭურჭელი ან სამუშაო მოდული.' : 'Plan only the work that matters, verify readiness, and open the linked lot, vessel, vineyard or work area directly.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-expanded={showInsights} onClick={() => setShowInsights(value => !value)} className={'inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-xs font-black ' + (showInsights ? 'border-[#651522] bg-[#fbf4f5] text-[#651522] dark:border-amber-300 dark:bg-[#351a20] dark:text-amber-200' : 'border-stone-200 bg-white text-stone-700 hover:border-[#d9c4c8] hover:text-[#651522] dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200')}>
              <BarChart3 className="h-4 w-4" />{ka ? 'გეგმის ანალიზი' : 'Plan intelligence'}{suggestions.length > 0 && <span className="rounded-full bg-[#651522] px-1.5 py-0.5 text-[9px] text-white dark:bg-amber-300 dark:text-stone-950">{suggestions.length}</span>}
            </button>
            {props.canCreate && props.harvests.length > 0 && (
              <button type="button" onClick={generateHarvestPlan} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-xs font-black text-stone-700 hover:border-emerald-300 hover:text-emerald-800 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200">
                <Sparkles className="h-4 w-4" />{ka ? 'მოსავლის სინქრონიზაცია' : 'Sync harvest plan'}
              </button>
            )}
            {props.canCreate && (
              <button type="button" onClick={() => showCreate ? closeCreate() : setShowCreate(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#651522] px-4 text-xs font-black text-white hover:bg-[#4e0e15]">
                {showCreate ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{showCreate ? (ka ? 'დახურვა' : 'Close') : (ka ? 'სამუშაოს დამატება' : 'Add work')}
              </button>
            )}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-5">
          {metrics.map(metric => (
            <div key={metric.label} className="rounded-2xl bg-stone-50 p-3 dark:bg-stone-950">
              <span className="block text-[9px] font-black uppercase tracking-wide text-stone-400">{metric.label}</span>
              <div className="mt-1 flex items-end justify-between gap-2"><strong className={'text-2xl ' + metric.tone + ' dark:text-white'}>{metric.value}</strong><span className="text-right text-[9px] text-stone-400">{metric.detail}</span></div>
            </div>
          ))}
        </div>
      </header>

      {showInsights && (
        <section aria-labelledby="plan-intelligence-title" className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div><div className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-600" /><h2 id="plan-intelligence-title" className="text-sm font-black text-stone-950 dark:text-white">{ka ? 'ცოცხალი საწარმოო სურათი' : 'Live production picture'}</h2></div><p className="mt-1 text-[11px] leading-5 text-stone-500">{ka ? 'გეგმა, ჭურჭლების მზადყოფნა, დუღილის ჩანაწერები და ლაბორატორია ერთ პროგნოზში.' : 'The plan, vessel readiness, fermentation readings and laboratory evidence in one forecast.'}</p></div>
            <span className="text-[9px] font-black uppercase tracking-wide text-stone-400">{ka ? 'შემდეგი 14 დღე' : 'Next 14 days'}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-stone-50 p-3 dark:bg-stone-950"><span className="text-[9px] font-black uppercase text-stone-400">{ka ? 'გეგმის მზადყოფნა' : 'Plan readiness'}</span><strong className={'mt-1 block text-2xl ' + (forecast.readinessPercent < 70 ? 'text-rose-700' : forecast.readinessPercent < 90 ? 'text-amber-700' : 'text-emerald-700')}>{forecast.readinessPercent}%</strong><span className="text-[9px] text-stone-400">{forecast.openCount} {ka ? 'ღია სამუშაო' : 'open work items'}</span></div>
            <div className="rounded-2xl bg-stone-50 p-3 dark:bg-stone-950"><span className="text-[9px] font-black uppercase text-stone-400">{ka ? 'პიკური დღე' : 'Peak workload'}</span><strong className="mt-1 block text-base text-stone-950 dark:text-white">{forecast.peakDate || '—'}</strong><span className="text-[9px] text-stone-400">{forecast.peakCount} {ka ? 'პარალელური სამუშაო' : 'parallel work items'}</span></div>
            <div className="rounded-2xl bg-stone-50 p-3 dark:bg-stone-950"><span className="text-[9px] font-black uppercase text-stone-400">{ka ? 'გეგმიური ნაკადი' : 'Planned flow'}</span><strong className="mt-1 block text-2xl text-stone-950 dark:text-white">{forecast.plannedFlowLiters.toLocaleString()} <small className="text-xs">L</small></strong><span className="text-[9px] text-stone-400">{ka ? 'მოცულობის მქონე სამუშაოები' : 'volume-bearing work'}</span></div>
            <div className="rounded-2xl bg-stone-50 p-3 dark:bg-stone-950"><span className="text-[9px] font-black uppercase text-stone-400">{ka ? 'მზად ტევადობა' : 'Ready capacity'}</span><strong className="mt-1 block text-2xl text-stone-950 dark:text-white">{forecast.cleanEmptyCapacityLiters.toLocaleString()} <small className="text-xs">L</small></strong><span className="text-[9px] text-stone-400">{ka ? 'სუფთა და ცარიელ ჭურჭლებში' : 'clean, empty vessels'}</span></div>
          </div>
          <div className="mt-5 border-t border-stone-100 pt-4 dark:border-stone-800">
            <div className="flex items-end justify-between gap-3"><div><h3 className="text-xs font-black text-stone-800 dark:text-stone-100">{ka ? 'სისტემიდან აღმოჩენილი სამუშაო' : 'Work detected from live records'}</h3><p className="mt-1 text-[10px] text-stone-400">{ka ? 'არცერთი ჩანაწერი ავტომატურად არ იქმნება — მეღვინე წყვეტს რას დაამატებს.' : 'Nothing is created automatically—the winemaker decides what belongs in the plan.'}</p></div><span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-black text-stone-500 dark:bg-stone-800">{suggestions.length}</span></div>
            {suggestions.length > 0 ? (
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {suggestions.slice(0, 8).map(suggestion => {
                  const SuggestionIcon = kindIcons[suggestion.kind];
                  return (
                    <article key={suggestion.id} className="flex gap-3 rounded-2xl border border-stone-200 p-3 dark:border-stone-700">
                      <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ' + kindColor(suggestion.kind)}><SuggestionIcon className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="text-xs font-black text-stone-900 dark:text-white">{ka ? suggestion.title.ka : suggestion.title.en}</h4>{suggestion.priority === 'high' && <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-rose-700 dark:bg-rose-950 dark:text-rose-200">{ka ? 'მაღალი' : 'High'}</span>}</div><p className="mt-1 text-[10px] leading-4 text-stone-500">{ka ? suggestion.rationale.ka : suggestion.rationale.en}</p><div className="mt-2 flex flex-wrap gap-1">{suggestion.lotId && <span className="rounded-md bg-stone-100 px-1.5 py-1 text-[9px] font-mono text-stone-500 dark:bg-stone-800">{suggestion.lotId}</span>}{suggestion.vesselIds.map(id => <span key={id} className="rounded-md bg-stone-100 px-1.5 py-1 text-[9px] font-mono text-stone-500 dark:bg-stone-800">{id}</span>)}</div></div>
                      {props.canCreate && <button type="button" onClick={() => acceptSuggestion(suggestion)} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-xl border border-[#d9c4c8] px-2.5 text-[9px] font-black text-[#651522] hover:bg-[#fbf4f5] dark:border-[#5a2730] dark:text-amber-200"><Plus className="h-3 w-3" />{ka ? 'დაგეგმვა' : 'Plan it'}</button>}
                    </article>
                  );
                })}
              </div>
            ) : <div className="mt-3 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 p-4 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><CheckCircle2 className="mr-2 inline h-4 w-4" />{ka ? 'ცოცხალი ჩანაწერებიდან დაუგეგმავი აუცილებელი სამუშაო არ ჩანს.' : 'No unplanned essential work is visible in live records.'}</div>}
            {suggestions.length > 8 && <p className="mt-2 text-[9px] text-stone-400">{ka ? `კიდევ ${suggestions.length - 8} რეკომენდაცია — დაკავშირებული სამუშაოების დამატების შემდეგ სია ავტომატურად მოკლდება.` : `${suggestions.length - 8} more suggestions—the list contracts automatically as linked work is added.`}</p>}
          </div>
        </section>
      )}

      {showCreate && (
        <section className="rounded-3xl border border-[#d9c4c8] bg-[#fbf7f8] p-5 shadow-sm dark:border-[#5a2730] dark:bg-[#2b171c]">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-sm font-black text-stone-950 dark:text-white">{ka ? 'რა სამუშაო უნდა შესრულდეს?' : 'What work needs to happen?'}</h2><p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">{ka ? 'ჯერ აირჩიეთ ოპერაცია — გამოჩნდება მხოლოდ მისთვის საჭირო კავშირები.' : 'Choose the operation first; only the relevant links will be shown.'}</p></div>
            <button type="button" onClick={closeCreate} aria-label={ka ? 'ფორმის დახურვა' : 'Close form'} className="rounded-lg p-2 text-stone-400 hover:bg-white hover:text-stone-700 dark:hover:bg-stone-900"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {quickKinds.map(value => {
              const Icon = kindIcons[value];
              const selected = kind === value;
              return (
                <button key={value} type="button" onClick={() => { setKind(value); setVesselIds([]); setLotId(''); setBlockId(''); }} className={'flex min-h-16 items-center gap-2 rounded-xl border p-3 text-left text-[10px] font-black transition-colors ' + (selected ? 'border-[#651522] bg-white text-[#651522] shadow-sm dark:border-amber-300 dark:bg-stone-900 dark:text-amber-200' : 'border-transparent bg-white/60 text-stone-500 hover:border-stone-200 dark:bg-stone-900/40 dark:text-stone-300')}>
                  <Icon className="h-4 w-4 shrink-0" />{ka ? kindCopy[value].ka : kindCopy[value].en}
                </button>
              );
            })}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 xl:col-span-2"><span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'სათაური (სურვილისამებრ)' : 'Title (optional)'}</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder={generatedTitle(kind, props.lang, selectedDraftLot, selectedDraftVessels, selectedDraftBlock)} className="min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950" /></label>
            <label className="space-y-1"><span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'ოპერაცია' : 'Operation'}</span><select value={kind} onChange={event => { setKind(event.target.value as ProductionPlanKind); setVesselIds([]); setLotId(''); setBlockId(''); }} className="min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950">{kinds.map(value => <option key={value} value={value}>{ka ? kindCopy[value].ka : kindCopy[value].en}</option>)}</select></label>
            <label className="space-y-1"><span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'დაწყება' : 'Start date'}</span><input type="date" value={startDate} onChange={event => { setStartDate(event.target.value); if (endDate < event.target.value) setEndDate(event.target.value); }} className="min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950" /></label>
            {['harvest', 'intake'].includes(kind) && (
              <label className="space-y-1"><span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'ვენახის ბლოკი' : 'Vineyard block'}</span><select value={blockId} onChange={event => setBlockId(event.target.value)} className="min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"><option value="">{ka ? 'აირჩიეთ ბლოკი' : 'Select block'}</option>{props.blocks.map(item => <option key={item.id} value={item.id}>{item.name} · {item.grapeVariety}</option>)}</select></label>
            )}
            {!['harvest', 'sanitation', 'procurement', 'other'].includes(kind) && (
              <label className="space-y-1"><span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{ka ? 'ღვინის პარტია' : 'Wine lot'}</span><select value={lotId} onChange={event => { setLotId(event.target.value); setVesselIds([]); }} className="min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"><option value="">{ka ? 'აირჩიეთ პარტია' : 'Select lot'}</option>{props.lots.filter(item => !item.voidedAt && (kind !== 'transfer' || props.vessels.some(vessel => vessel.assignedLotId === item.id && vessel.currentVolume > 0))).map(item => <option key={item.id} value={item.id}>{item.name} · {item.id} · {item.currentVolume.toLocaleString()} L</option>)}</select></label>
            )}
            {['transfer', 'fermentation', 'lab', 'bottling', 'sanitation'].includes(kind) && (
              <div className="space-y-1 md:col-span-2">
                <span className="text-[9px] font-black uppercase tracking-wide text-stone-500">{kind === 'transfer' ? (ka ? 'ჭურჭლები · ჯერ წყარო, შემდეგ მიმღები' : 'Vessels · source first, destination second') : (ka ? 'ჭურჭელი' : 'Vessel')}</span>
                <div className="flex gap-2">
                  <select aria-label={kind === 'transfer' ? (ka ? 'წყარო ან მიმღები ჭურჭელი' : 'Source or destination vessel') : (ka ? 'ჭურჭელი' : 'Vessel')} value={vesselPickerId} onChange={event => setVesselPickerId(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"><option value="">{ka ? 'აირჩიეთ ჭურჭელი' : 'Select vessel'}</option>{availableDraftVessels.map(vessel => <option key={vessel.id} value={vessel.id}>{vessel.id} · {vessel.currentVolume.toLocaleString()}/{vessel.capacity.toLocaleString()} L{vessel.assignedLotId ? ' · ' + vessel.assignedLotId : ''}</option>)}</select>
                  <button type="button" aria-label={ka ? 'ჭურჭლის დამატება' : 'Add vessel'} disabled={!vesselPickerId || (kind === 'transfer' ? vesselIds.length >= 2 : vesselIds.length >= 1)} onClick={addDraftVessel} className="min-h-11 rounded-xl border border-stone-200 bg-white px-3 text-xs font-black text-[#651522] disabled:opacity-40 dark:border-stone-700 dark:bg-stone-950 dark:text-amber-200"><Plus className="h-4 w-4" /></button>
                </div>
                {vesselIds.length > 0 && <div className="flex flex-wrap gap-2 pt-1">{vesselIds.map((id, index) => <span key={id} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[10px] font-bold dark:bg-stone-900">{kind === 'transfer' ? (index + 1) + '. ' : ''}{id}<button type="button" onClick={() => { setVesselIds(current => current.filter(value => value !== id)); if (kind === 'transfer') setQuantityLiters(''); }} aria-label={id + ' remove'} className="text-stone-400 hover:text-rose-600"><X className="h-3 w-3" /></button></span>)}</div>}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setShowAdvanced(value => !value)} className="mt-4 inline-flex min-h-9 items-center gap-2 text-[10px] font-black uppercase tracking-wide text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"><ChevronDown className={'h-3.5 w-3.5 transition-transform ' + (showAdvanced ? 'rotate-180' : '')} />{ka ? 'დრო, მოცულობა, შენიშვნა და წინაპირობები' : 'Timing, quantity, notes and prerequisites'}</button>
          {showAdvanced && (
            <div className="mt-3 grid gap-3 border-t border-stone-200 pt-4 md:grid-cols-2 xl:grid-cols-4 dark:border-stone-700">
              <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'დასრულება' : 'End date'}</span><input type="date" min={startDate} value={endDate} onChange={event => setEndDate(event.target.value)} className="min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950" /></label>
              <label className="space-y-1"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'მოცულობა, ლ' : 'Quantity, L'}</span><input type="number" min="0" value={quantityLiters} onChange={event => setQuantityLiters(event.target.value)} placeholder="0" className="min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950" /></label>
              <label className="space-y-1 md:col-span-2"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'შენიშვნა' : 'Notes'}</span><input value={notes} onChange={event => setNotes(event.target.value)} placeholder={ka ? 'მხოლოდ შესრულებისთვის საჭირო მითითება' : 'Only what the operator needs to execute'} className="min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950" /></label>
              {active.length > 0 && (
                <div className="md:col-span-2 xl:col-span-4"><span className="text-[9px] font-black uppercase text-stone-500">{ka ? 'რა უნდა დასრულდეს მანამდე?' : 'What must finish first?'}</span><div className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-auto">{active.filter(item => item.status !== 'cancelled').map(item => <label key={item.id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-[10px] dark:bg-stone-900"><input type="checkbox" checked={dependencyIds.includes(item.id)} onChange={event => setDependencyIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.title}<span className="text-stone-400">{item.endDate}</span></label>)}</div></div>
              )}
            </div>
          )}
          <div className="mt-5 flex flex-col gap-3 border-t border-stone-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-stone-700">
            <div className={'flex items-center gap-2 text-[10px] font-bold ' + (draftIssue ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300')}>{draftIssue ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{draftIssue || (ka ? 'საჭირო კავშირები შევსებულია' : 'Required links are complete')}</div>
            <button type="button" onClick={addPlan} disabled={Boolean(draftIssue)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#651522] px-5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-4 w-4" />{ka ? 'გეგმაში დამატება' : 'Add to plan'}</button>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-950" role="tablist" aria-label={ka ? 'გეგმის ხედი' : 'Plan view'}>
          <button type="button" role="tab" aria-selected={view === 'agenda'} onClick={() => setView('agenda')} className={'inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-[10px] font-black ' + (view === 'agenda' ? 'bg-white text-[#651522] shadow-sm dark:bg-stone-800 dark:text-amber-200' : 'text-stone-500')}><ListChecks className="h-3.5 w-3.5" />{ka ? 'სამუშაო რიგი' : 'Work agenda'}</button>
          <button type="button" role="tab" aria-selected={view === 'flow'} onClick={() => setView('flow')} className={'inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-[10px] font-black ' + (view === 'flow' ? 'bg-white text-[#651522] shadow-sm dark:bg-stone-800 dark:text-amber-200' : 'text-stone-500')}><Columns3 className="h-3.5 w-3.5" />{ka ? 'ნაკადი' : 'Flow'}</button>
          <button type="button" role="tab" aria-selected={view === 'calendar'} onClick={() => setView('calendar')} className={'inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-[10px] font-black ' + (view === 'calendar' ? 'bg-white text-[#651522] shadow-sm dark:bg-stone-800 dark:text-amber-200' : 'text-stone-500')}><CalendarDays className="h-3.5 w-3.5" />{ka ? '14 დღე' : '14 days'}</button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
          <label className="relative min-w-0 sm:max-w-xs sm:flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" /><input aria-label={ka ? 'გეგმაში ძიება' : 'Search plan'} value={search} onChange={event => setSearch(event.target.value)} placeholder={ka ? 'პარტია, ჭურჭელი, სამუშაო…' : 'Lot, vessel, work…'} className="min-h-10 w-full rounded-xl border border-stone-200 bg-stone-50 pl-9 pr-3 text-xs dark:border-stone-700 dark:bg-stone-950" /></label>
          <div className="flex gap-1 overflow-x-auto">
            {(['open', 'attention', 'completed', 'all'] as PlannerFilter[]).map(value => <button key={value} type="button" onClick={() => setFilter(value)} className={'min-h-10 whitespace-nowrap rounded-xl px-3 text-[10px] font-black ' + (filter === value ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950' : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800')}>{value === 'open' ? (ka ? 'ღია' : 'Open') : value === 'attention' ? (ka ? 'საყურადღებო' : 'Attention') : value === 'completed' ? (ka ? 'დახურული' : 'Closed') : (ka ? 'ყველა' : 'All')}</button>)}
          </div>
        </div>
      </section>

      {view === 'calendar' ? (
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center justify-between border-b border-stone-200 p-3 dark:border-stone-800">
            <button type="button" onClick={() => setWindowStart(plusDays(windowStart, -14))} className="rounded-lg border border-stone-200 px-3 py-2 text-xs dark:border-stone-700">← 14</button>
            <div className="text-center"><strong className="block text-xs">{windowStart} — {days[13]}</strong><button type="button" onClick={() => setWindowStart(today())} className="mt-1 text-[9px] font-black uppercase text-[#651522] dark:text-amber-300">{ka ? 'დღეს დაბრუნება' : 'Back to today'}</button></div>
            <button type="button" onClick={() => setWindowStart(plusDays(windowStart, 14))} className="rounded-lg border border-stone-200 px-3 py-2 text-xs dark:border-stone-700">14 →</button>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[1120px]" style={{ gridTemplateColumns: 'repeat(14, minmax(80px, 1fr))' }}>
              {days.map(day => (
                <div key={day} className={'min-h-80 border-r border-stone-100 p-2 dark:border-stone-800 ' + (day === today() ? 'bg-[#fbf4f5] dark:bg-[#351a20]' : '')}>
                  <div className="mb-3 text-center text-[9px] font-black uppercase text-stone-500">{dateParts(day, props.lang).full}</div>
                  <div className="space-y-2">
                    {filteredItems.filter(item => item.startDate <= day && item.endDate >= day && item.status !== 'cancelled').map(item => (
                      <button key={item.id} type="button" onClick={() => { setView('agenda'); window.requestAnimationFrame(() => document.getElementById('plan-' + item.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })); }} title={item.startDate + ' — ' + item.endDate} className={'w-full rounded-lg p-2 text-left text-[9px] font-bold ' + kindColor(item.kind)}>
                        {item.title}<span className="mt-1 block opacity-65">{ka ? statusCopy[item.status].ka : statusCopy[item.status].en}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : view === 'flow' ? (
        <section aria-label={ka ? 'სამუშაოს ნაკადის დაფა' : 'Production flow board'} className="overflow-x-auto pb-2">
          <div className={'grid min-w-[920px] gap-3 ' + (flowColumns.length === 5 ? 'grid-cols-5' : 'grid-cols-4')}>
            {flowColumns.map(column => {
              const columnItems = filteredItems.filter(item => column.statuses.includes(item.status));
              return (
                <section key={column.key} aria-labelledby={'flow-' + column.key} className="min-h-72 rounded-2xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-950/60">
                  <div className="mb-3 flex items-center justify-between gap-2"><h2 id={'flow-' + column.key} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-stone-700 dark:text-stone-200"><span className={'h-2 w-2 rounded-full ' + column.tone} />{column.label}</h2><span className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-stone-500 dark:bg-stone-900">{columnItems.length}</span></div>
                  <div className="space-y-2">
                    {columnItems.map(item => {
                      const KindIcon = kindIcons[item.kind];
                      const nextStatus = nextStatusFor(item.status);
                      const nextIssue = nextStatus ? productionPlanTransitionIssue(item, nextStatus, props.productionPlans, conflicts) : null;
                      const needsAttention = isAttentionItem(item);
                      return (
                        <article key={item.id} className={'rounded-xl border bg-white p-3 shadow-sm dark:bg-stone-900 ' + (needsAttention ? 'border-amber-300 dark:border-amber-800' : 'border-stone-200 dark:border-stone-800')}>
                          <div className="flex items-start gap-2"><span className={'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ' + kindColor(item.kind)}><KindIcon className="h-3.5 w-3.5" /></span><div className="min-w-0 flex-1"><h3 className="text-[11px] font-black leading-4 text-stone-900 dark:text-white">{item.title}</h3><p className="mt-1 text-[9px] text-stone-400">{item.startDate === item.endDate ? item.startDate : item.startDate + ' — ' + item.endDate}</p></div>{needsAttention && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />}</div>
                          <div className="mt-2 flex flex-wrap gap-1">{item.lotId && <span className="rounded-md bg-stone-100 px-1.5 py-1 text-[8px] font-mono text-stone-500 dark:bg-stone-800">{item.lotId}</span>}{item.vesselIds.map(id => <span key={id} className="rounded-md bg-stone-100 px-1.5 py-1 text-[8px] font-mono text-stone-500 dark:bg-stone-800">{id}</span>)}</div>
                          <div className="mt-3 flex gap-1.5 border-t border-stone-100 pt-2 dark:border-stone-800">
                            <button type="button" onClick={() => { setView('agenda'); window.requestAnimationFrame(() => document.getElementById('plan-' + item.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })); }} className="min-h-8 flex-1 rounded-lg border border-stone-200 px-2 text-[8px] font-black text-stone-600 hover:text-[#651522] dark:border-stone-700 dark:text-stone-300">{ka ? 'დეტალები' : 'Details'}</button>
                            {props.onOpenWorkflow && !['completed', 'cancelled'].includes(item.status) && <button type="button" aria-label={ka ? item.title + ' სამუშაო მოდულში გახსნა' : 'Open workflow for ' + item.title} onClick={() => props.onOpenWorkflow?.(item)} className="flex min-h-8 items-center justify-center rounded-lg bg-[#651522] px-2 text-white"><ExternalLink className="h-3 w-3" /></button>}
                            {props.canUpdate && nextStatus && <button type="button" title={nextIssue || nextStatusLabel(item.status, ka)} aria-label={nextStatusLabel(item.status, ka)} disabled={Boolean(nextIssue || readinessIssue(item, ka))} onClick={() => changeStatus(item, nextStatus)} className="flex min-h-8 items-center justify-center rounded-lg border border-stone-200 px-2 text-emerald-700 disabled:opacity-30 dark:border-stone-700"><Check className="h-3 w-3" /></button>}
                          </div>
                        </article>
                      );
                    })}
                    {columnItems.length === 0 && <div className="rounded-xl border border-dashed border-stone-200 p-5 text-center text-[9px] text-stone-400 dark:border-stone-800">{ka ? 'სამუშაო არ არის' : 'No work'}</div>}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="space-y-7">
          {renderAgendaSection('attention-work', ka ? 'გადასაწყვეტია' : 'Needs a decision', ka ? 'ბლოკი, კონფლიქტი ან აუცილებელი კავშირი აკლია' : 'Blocked, conflicting, or missing a required system link', attentionItems, 'rose')}
          {renderAgendaSection('today-work', ka ? 'დღეს' : 'Today', ka ? 'მიმდინარე და ვადაგადაცილებული სამუშაო' : 'Current and overdue work', agendaTodayItems)}
          {renderAgendaSection('next-work', ka ? 'შემდეგი 7 დღე' : 'Next 7 days', ka ? 'უახლოესი დაგეგმილი სამუშაო' : 'Upcoming scheduled work', nextWeekItems)}
          {renderAgendaSection('later-work', ka ? 'მოგვიანებით' : 'Later', ka ? 'გრძელვადიანი გეგმა' : 'Longer-term plan', laterItems)}
          {renderAgendaSection('closed-work', ka ? 'დახურული' : 'Closed', ka ? 'დასრულებული და გაუქმებული ჩანაწერები' : 'Completed and cancelled records', closedItems)}
          {filteredItems.length === 0 && (
            <section className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center dark:border-stone-700 dark:bg-stone-900">
              <Clock3 className="mx-auto h-6 w-6 text-stone-300" /><h2 className="mt-3 text-sm font-black text-stone-700 dark:text-stone-200">{ka ? 'ამ ხედში სამუშაო არ არის' : 'No work in this view'}</h2><p className="mt-1 text-xs text-stone-400">{ka ? 'შეცვალეთ ფილტრი ან დაამატეთ კონკრეტულ ჩანაწერთან დაკავშირებული სამუშაო.' : 'Change the filter or add work linked to a system record.'}</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
