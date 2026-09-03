import React, { useEffect, useMemo, useState } from 'react';
import { Wine, Package, AlertTriangle, CheckCircle2, RotateCcw, FileDown, X } from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { WineLot, BottlingRunRecord, InventoryItem, Vessel } from '../lib/wineryState';
import {
  computeBottlingCostPosting,
  type BottlingPackagingComponent,
  type BottlingPackagingSelections,
  type CostEntry,
} from '../lib/costing';
import type { StockMovement, StorageLocation } from '../lib/storage';
import {
  bottlingPackagingShortfalls,
  compareBottlingRunsNewestFirst,
  isActiveBottlingRun,
} from '../lib/bottlingIntegrity';
import { SyncQueueManager, type PendingCommandIntent } from '../lib/syncQueue';
import {
  applyBottlingCommand,
  BOTTLING_FORMATS,
  bottlingFormatLitres,
  isBottlingReadyStage,
  type BottlingCommandPayload,
} from '../lib/commands/bottling';
import type { BottlingReversalCommandPayload } from '../lib/commands/bottlingReversal';
import {
  inventoryItemsForPackagingComponent,
  isInventoryItemForPackagingComponent,
} from '../lib/inventoryCategories';
import {
  CommandRequestError,
  createBottlingCommandIntent,
  createBottlingReversalCommandIntent,
  pendingBottlingCommandIntent,
  pendingBottlingReversalCommandIntent,
  submitBottlingCommand,
  submitBottlingReversalCommand,
  type BottlingCommandResponse,
} from '../lib/commands/client';
import DateInput from './ui/DateInput';
import { localISODate } from '../lib/weatherApi';

interface Props {
  lang: Language;
  /** Vessel context carried from the winery plan's operation menu. */
  initialVesselId?: string;
  onInitialVesselConsumed?: () => void;
  canCreateBottling?: boolean;
  canReverseBottling?: boolean;
  canUseBottlingCosting?: boolean;
  canPlaceFinishedGoods?: boolean;
  lots: WineLot[];
  onUpdateLots: (lots: WineLot[]) => void;
  vessels: Vessel[];
  onUpdateVessels: (vessels: Vessel[]) => void;
  history: BottlingRunRecord[];
  onUpdateHistory: (runs: BottlingRunRecord[]) => void;
  inventory: InventoryItem[];
  onUpdateInventory: (inventory: InventoryItem[]) => void;
  costEntries: CostEntry[];
  onUpdateCostEntries: (entries: CostEntry[]) => void;
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
  onUpdateStockMovements: (movements: StockMovement[]) => void;
  onApplyBottlingCommandResponse?: (response: BottlingCommandResponse) => void;
  currency: string;
  currentUserName: string;
  setToastMessage?: (m: string) => void;
}

/** Official bottle formats from Annex №7 (ჩამოსხმის აქტი). */
export const BOTTLE_FORMATS: Array<{ key: string; litres: number; labelKa: string; kind: 'bottle' | 'ceramic' }> = [
  ...BOTTLING_FORMATS.map(format => ({
    ...format,
    labelKa: format.key === 'ceramic'
      ? 'კერამიკა 0.75 ლ'
      : `${format.key} ლ${format.key === '1.5' ? ' (მაგნუმი)' : ''}`,
  })),
];

export type BottlingRun = BottlingRunRecord;

const HISTORY_KEY = 'cf_bottling_history';

export function loadBottlingHistory(): BottlingRun[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveBottlingHistory(runs: BottlingRun[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(runs)); } catch { /* ignore */ }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const PACKAGING_COMPONENTS: Array<{ key: BottlingPackagingComponent; en: string; ka: string }> = [
  { key: 'bottle', en: 'Bottle / ceramic', ka: 'ბოთლი / კერამიკა' },
  { key: 'closure', en: 'Cork / closure', ka: 'საცობი' },
  { key: 'capsule', en: 'Capsule', ka: 'ჩაჩი' },
  { key: 'label', en: 'Label', ka: 'ეტიკეტი' },
  { key: 'box', en: 'Box / case', ka: 'ყუთი' },
];

export function BottlingTab({
  lang,
  initialVesselId,
  onInitialVesselConsumed,
  canCreateBottling = true,
  canReverseBottling = true,
  canUseBottlingCosting = true,
  canPlaceFinishedGoods = true,
  lots,
  onUpdateLots,
  vessels,
  onUpdateVessels,
  history,
  onUpdateHistory,
  inventory,
  onUpdateInventory,
  costEntries,
  onUpdateCostEntries,
  storageLocations,
  stockMovements,
  onUpdateStockMovements,
  onApplyBottlingCommandResponse,
  currency,
  currentUserName,
  setToastMessage,
}: Props) {
  const ka = lang === 'ka';

  const [pendingIntent, setPendingIntent] = useState<PendingCommandIntent<BottlingCommandPayload> | null>(null);
  const [pendingReversalIntent, setPendingReversalIntent] = useState<PendingCommandIntent<BottlingReversalCommandPayload> | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const [reversalRunId, setReversalRunId] = useState('');
  const [reversalReason, setReversalReason] = useState('');

  const bottleable = useMemo(
    () => lots.filter(lot => (
      (lot.currentVolume > 0
        && isBottlingReadyStage(lot.stage)
        && vessels.some(vessel => vessel.assignedLotId === lot.id && vessel.currentVolume > 0))
      || lot.id === pendingIntent?.payload.lotId
    )),
    [lots, pendingIntent?.payload.lotId, vessels],
  );

  const initialVessel = initialVesselId ? vessels.find(vessel => vessel.id === initialVesselId) : undefined;
  const initialLotId = initialVessel?.assignedLotId && bottleable.some(lot => lot.id === initialVessel.assignedLotId)
    ? initialVessel.assignedLotId
    : bottleable[0]?.id || '';
  const [lotId, setLotId] = useState(initialLotId);
  const [sourceVesselId, setSourceVesselId] = useState(() => (
    initialVessel && initialVessel.assignedLotId === initialLotId && initialVessel.currentVolume > 0
      ? initialVessel.id
      : vessels.find(vessel => vessel.assignedLotId === initialLotId && vessel.currentVolume > 0)?.id || ''
  ));
  const [date, setDate] = useState(localISODate());
  const [lotNumber, setLotNumber] = useState('');
  const [operator, setOperator] = useState(currentUserName);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [customBottleSize, setCustomBottleSize] = useState('0.75');
  const [customBottleCount, setCustomBottleCount] = useState('');
  const [packagingSelections, setPackagingSelections] = useState<BottlingPackagingSelections>({});
  const [bottlesPerBox, setBottlesPerBox] = useState('6');
  const [bottlingServiceCost, setBottlingServiceCost] = useState('');
  const [storageLocationId, setStorageLocationId] = useState('');

  useEffect(() => {
    const restored = pendingBottlingCommandIntent();
    if (!restored) return;
    setPendingIntent(restored);
    setLotId(restored.payload.lotId);
    setSourceVesselId(restored.payload.sourceVesselId);
    setDate(restored.payload.date);
    setLotNumber(restored.payload.lotNumber);
    setOperator(restored.payload.operator);
    setCounts({ ...restored.payload.formats });
    setPackagingSelections({ ...restored.payload.packagingSelections });
    setBottlesPerBox(String(restored.payload.bottlesPerBox));
    setBottlingServiceCost(String(restored.payload.bottlingServiceCost || ''));
    setStorageLocationId(restored.payload.storageLocationId);
    setCommandError(ka
      ? 'წინა ჩამოსხმის შედეგი ჯერ არ არის დადასტურებული. იგივე ბრძანების უსაფრთხოდ აღსადგენად ხელახლა გაგზავნეთ.'
      : 'A previous bottling run is not yet acknowledged. Resubmit to recover the same command safely.');
  }, [ka]);

  useEffect(() => {
    const restored = pendingBottlingReversalCommandIntent();
    if (!restored) return;
    const original = history.find(run => run.commandId === restored.payload.originalCommandId);
    setPendingReversalIntent(restored);
    setReversalRunId(original?.id || '');
    setReversalReason(restored.payload.reason);
    setCommandError(ka
      ? 'წინა ჩამოსხმის შესწორება ჯერ არ არის დადასტურებული. იმავე ბრძანების უსაფრთხოდ აღსადგენად ხელახლა გაგზავნეთ.'
      : 'A previous bottling correction is not yet acknowledged. Resubmit to recover the same command safely.');
  }, [history, ka]);

  const lot = lots.find(l => l.id === lotId) || null;
  const sourceVessels = useMemo(
    () => vessels.filter(vessel => vessel.assignedLotId === lotId && vessel.currentVolume > 0),
    [lotId, vessels],
  );
  const sourceVessel = sourceVessels.find(vessel => vessel.id === sourceVesselId) || null;
  const availableL = lot && sourceVessel ? Math.min(lot.currentVolume, sourceVessel.currentVolume) : 0;

  useEffect(() => {
    if (pendingIntent) return;
    if (!sourceVessels.some(vessel => vessel.id === sourceVesselId)) {
      setSourceVesselId(sourceVessels[0]?.id || '');
    }
  }, [pendingIntent, sourceVesselId, sourceVessels]);

  useEffect(() => {
    if (!initialVesselId) return;
    onInitialVesselConsumed?.();
    if (pendingIntent) return;
    const preferred = vessels.find(vessel => vessel.id === initialVesselId && vessel.currentVolume > 0);
    if (!preferred?.assignedLotId || !bottleable.some(candidate => candidate.id === preferred.assignedLotId)) return;
    setLotId(preferred.assignedLotId);
    setSourceVesselId(preferred.id);
  }, [bottleable, initialVesselId, onInitialVesselConsumed, pendingIntent, vessels]);

  const displayedFormats = useMemo(() => {
    const known = new Set(BOTTLE_FORMATS.map(format => format.key));
    const custom = Object.keys(counts)
      .filter(key => !known.has(key) && bottlingFormatLitres(key) !== null)
      .map(key => ({
        key,
        litres: bottlingFormatLitres(key) as number,
        labelKa: `${key} ლ`,
        kind: 'bottle' as const,
      }));
    return [...BOTTLE_FORMATS, ...custom];
  }, [counts]);
  const volumeBottledL = useMemo(
    () => round1(Object.entries(counts).reduce(
      (acc, [key, count]) => acc + count * (bottlingFormatLitres(key) || 0),
      0,
    )),
    [counts],
  );
  const totalCeramic = counts.ceramic || 0;
  const totalBottles = Object.entries(counts)
    .filter(([key]) => key !== 'ceramic')
    .reduce((sum, [, count]) => sum + count, 0);

  const overfill = volumeBottledL > availableL + 0.001;
  const noBottles = totalBottles + totalCeramic === 0;
  const totalUnits = totalBottles + totalCeramic;
  const effectivePackagingSelections = useMemo<BottlingPackagingSelections>(
    () => canUseBottlingCosting ? packagingSelections : {},
    [canUseBottlingCosting, packagingSelections],
  );
  const effectiveBottlingServiceCost = canUseBottlingCosting ? parseFloat(bottlingServiceCost) || 0 : 0;
  const effectiveStorageLocationId = canPlaceFinishedGoods ? storageLocationId : '';

  const packagingItemsByComponent = useMemo(() => Object.fromEntries(
    PACKAGING_COMPONENTS.map(component => [
      component.key,
      inventoryItemsForPackagingComponent(inventory, component.key),
    ]),
  ) as Record<BottlingPackagingComponent, InventoryItem[]>, [inventory]);

  useEffect(() => {
    setPackagingSelections(previous => {
      const next = { ...previous };
      let changed = false;
      for (const [component, itemId] of Object.entries(previous) as Array<[BottlingPackagingComponent, string]>) {
        const item = inventory.find(candidate => candidate.id === itemId);
        if (!item || !isInventoryItemForPackagingComponent(item, component)) {
          delete next[component];
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [inventory]);

  const costPreview = useMemo(() => computeBottlingCostPosting({
    runId: 'preview',
    date,
    lotId: lot?.id || '',
    totalUnits,
    packagingSelections: effectivePackagingSelections,
    inventory,
    bottlesPerBox: parseInt(bottlesPerBox) || 6,
    bottlingServiceCost: effectiveBottlingServiceCost,
    currency,
    createdBy: operator || currentUserName,
  }), [bottlesPerBox, currency, currentUserName, date, effectiveBottlingServiceCost, effectivePackagingSelections, inventory, lot?.id, operator, totalUnits]);

  const overdrawnPackaging = useMemo(
    () => bottlingPackagingShortfalls(costPreview.deductions, inventory),
    [costPreview.deductions, inventory],
  );
  const hasPackagingShortfall = overdrawnPackaging.length > 0;
  const canSubmit = Boolean(pendingIntent) || (!!lot && !!sourceVessel && !overfill && !noBottles && !hasPackagingShortfall);
  const orderedHistory = useMemo(
    () => [...history].sort(compareBottlingRunsNewestFirst),
    [history],
  );
  const selectedStorageLocation = storageLocations.find(l => l.id === effectiveStorageLocationId) || null;

  const setCount = (key: string, val: string) => {
    const n = Math.max(0, parseInt(val) || 0);
    setCounts(prev => ({ ...prev, [key]: n }));
  };

  const setPackaging = (component: BottlingPackagingComponent, itemId: string) => {
    setPackagingSelections(prev => {
      const next = { ...prev };
      if (itemId) next[component] = itemId;
      else delete next[component];
      return next;
    });
  };

  const resetForm = () => { setCounts({}); setLotNumber(''); setBottlingServiceCost(''); };

  const finishCommand = () => {
    setPendingIntent(null);
    setCommandError(null);
    resetForm();
  };

  const addCustomBottleFormat = () => {
    const litres = Number(customBottleSize);
    const count = Number(customBottleCount);
    if (!Number.isFinite(litres) || litres <= 0 || litres > 30 || !Number.isSafeInteger(count) || count <= 0) return;
    const key = String(litres);
    setCounts(previous => ({ ...previous, [key]: (previous[key] || 0) + count }));
    setCustomBottleCount('');
  };

  const applyBottlingLocally = (intent: PendingCommandIntent<BottlingCommandPayload>) => {
    const applied = applyBottlingCommand(
      { lots, vessels, bottlingRuns: history, inventory, costEntries, storageLocations, stockMovements },
      intent.payload,
      {
        commandId: intent.commandId,
        actorUsername: currentUserName,
        currency,
        performedAt: new Date(),
      },
    );
    onUpdateLots(applied.state.lots);
    onUpdateVessels(applied.state.vessels);
    onUpdateHistory(applied.state.bottlingRuns);
    saveBottlingHistory(applied.state.bottlingRuns);
    onUpdateInventory(applied.state.inventory);
    onUpdateCostEntries(applied.state.costEntries);
    onUpdateStockMovements(applied.state.stockMovements);
    setToastMessage?.(ka
      ? `ჩამოსხმა აღირიცხა: ${applied.result.receipt.totalUnits} ერთეული (${applied.result.receipt.volumeBottledL} ლ)`
      : `Bottling recorded: ${applied.result.receipt.totalUnits} units (${applied.result.receipt.volumeBottledL} L)`);
    finishCommand();
    if (applied.result.updatedLot.stage === 'bottled') {
      setLotId(applied.state.lots.find(item => item.currentVolume > 0 && isBottlingReadyStage(item.stage))?.id || '');
    }
  };

  const handleBottleCommand = async () => {
    if (!canCreateBottling || (!pendingIntent && (!lot || !canSubmit))) return;
    const intent = pendingIntent || createBottlingCommandIntent({
      lotId,
      sourceVesselId,
      date,
      lotNumber,
      operator: operator || currentUserName,
      formats: { ...counts },
      packagingSelections: { ...effectivePackagingSelections },
      bottlesPerBox: parseInt(bottlesPerBox) || 6,
      bottlingServiceCost: effectiveBottlingServiceCost,
      storageLocationId: effectiveStorageLocationId,
    });

    setCommandError(null);
    if (!onApplyBottlingCommandResponse || !SyncQueueManager.isOnline()) {
      if (pendingIntent) {
        setCommandError(ka
          ? 'დაუდასტურებელი ჩამოსხმის აღდგენას ინტერნეტთან კავშირი სჭირდება.'
          : 'Recovering an unacknowledged bottling run requires a server connection.');
        return;
      }
      try {
        applyBottlingLocally(intent);
      } catch (error) {
        setCommandError(error instanceof Error ? error.message : 'Bottling validation failed.');
      }
      return;
    }

    setPendingIntent(intent);
    setIsSubmitting(true);
    try {
      const response = await submitBottlingCommand(intent);
      onApplyBottlingCommandResponse(response);
      setToastMessage?.(ka
        ? `ჩამოსხმა აღირიცხა: ${response.result.receipt.totalUnits} ერთეული (${response.result.receipt.volumeBottledL} ლ)`
        : `Bottling recorded: ${response.result.receipt.totalUnits} units (${response.result.receipt.volumeBottledL} L)`);
      finishCommand();
      if (response.result.updatedLot.stage === 'bottled') {
        const authoritativeLots = response.collections?.lots || lots;
        setLotId(authoritativeLots.find(item => item.currentVolume > 0 && isBottlingReadyStage(item.stage))?.id || '');
      }
    } catch (error) {
      if (error instanceof CommandRequestError
        && error.code === 'command_store_unavailable'
        && !pendingIntent) {
        SyncQueueManager.consumePendingCommandIntent(intent.commandId);
        try {
          applyBottlingLocally(intent);
          return;
        } catch (fallbackError) {
          setCommandError(fallbackError instanceof Error ? fallbackError.message : 'Bottling validation failed.');
          setPendingIntent(null);
          return;
        }
      }
      setCommandError(error instanceof Error ? error.message : 'Bottling command failed.');
      if (error instanceof CommandRequestError && !error.retryable) setPendingIntent(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const reversalRun = history.find(run => run.id === reversalRunId) || null;

  const applyReversalResponse = (response: Awaited<ReturnType<typeof submitBottlingReversalCommand>>) => {
    if (response.collections) {
      onUpdateLots(response.collections.lots);
      onUpdateVessels(response.collections.vessels);
      onUpdateHistory(response.collections.bottlingRuns);
      saveBottlingHistory(response.collections.bottlingRuns);
      onUpdateInventory(response.collections.inventory);
      onUpdateCostEntries(response.collections.costEntries);
      onUpdateStockMovements(response.collections.stockMovements);
      return;
    }
    const replaceById = <T extends { id: string }>(current: T[], changed: T[]) => {
      const changedById = new Map(changed.map(item => [item.id, item]));
      return [...changed, ...current.filter(item => !changedById.has(item.id))];
    };
    const nextRuns = replaceById(history, [response.result.reversalRun, response.result.originalRun]);
    onUpdateLots(replaceById(lots, [response.result.updatedLot]));
    if (response.result.updatedVessel) {
      onUpdateVessels(replaceById(vessels, [response.result.updatedVessel]));
    }
    onUpdateHistory(nextRuns);
    saveBottlingHistory(nextRuns);
    onUpdateInventory(replaceById(inventory, response.result.updatedInventoryItems));
    onUpdateCostEntries(replaceById(costEntries, [
      ...response.result.reversalCostEntries,
      ...response.result.updatedOriginalCostEntries,
    ]));
    if (response.result.storageReturnMovement) {
      onUpdateStockMovements(replaceById(stockMovements, [response.result.storageReturnMovement]));
    }
  };

  const handleReverseRun = async () => {
    if (!canReverseBottling || isReversing) return;
    const original = pendingReversalIntent
      ? history.find(run => run.commandId === pendingReversalIntent.payload.originalCommandId)
      : reversalRun;
    const reason = pendingReversalIntent?.payload.reason || reversalReason.trim();
    if (!original?.commandId || !reason) {
      setCommandError(ka ? 'შესწორების მიზეზი სავალდებულოა.' : 'A correction reason is required.');
      return;
    }
    if (!onApplyBottlingCommandResponse || !SyncQueueManager.isOnline()) {
      setCommandError(ka
        ? 'ჩამოსხმის შესწორებას სჭირდება სერვერთან კავშირი.'
        : 'Bottling corrections require a server connection.');
      return;
    }
    const intent = pendingReversalIntent || createBottlingReversalCommandIntent({
      originalCommandId: original.commandId,
      reason,
    });
    setPendingReversalIntent(intent);
    setCommandError(null);
    setIsReversing(true);
    try {
      const response = await submitBottlingReversalCommand(intent);
      applyReversalResponse(response);
      setPendingReversalIntent(null);
      setReversalRunId('');
      setReversalReason('');
      setToastMessage?.(ka
        ? `ჩამოსხმა შესწორდა: აღდგენილია ${response.result.receipt.restoredVolumeL} ლ`
        : `Bottling corrected: ${response.result.receipt.restoredVolumeL} L restored`);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Bottling reversal failed.');
      if (error instanceof CommandRequestError && !error.retryable) {
        setPendingReversalIntent(null);
      }
    } finally {
      setIsReversing(false);
    }
  };

  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800';
  const fmtMoney = (n: number) => `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  const bottlingAccessNotice = !canCreateBottling && !canReverseBottling
    ? (ka
      ? 'მხოლოდ ნახვის წვდომა: შეგიძლიათ ჩამოსხმის ისტორიისა და დანართ №7-ის მონაცემების ნახვა, თუმცა ჩანაწერის შექმნა ან გაუქმება არ შეგიძლიათ.'
      : 'Read-only access: you can review bottling history and Annex №7 data, but you cannot record runs or append corrections.')
    : canCreateBottling && !canReverseBottling
      ? (ka
        ? 'შეგიძლიათ ჩამოსხმის აღრიცხვა, თუმცა ყველა დაკავშირებულ რეესტრში შესწორების დამატება მხოლოდ უფლებამოსილ მფლობელს შეუძლია.'
        : 'You can record bottling runs, but only an authorized owner can append a correction across the linked ledgers.')
      : !canCreateBottling
        ? (ka
          ? 'ახალი ჩამოსხმის აღრიცხვა თქვენი როლისთვის მიუწვდომელია; უფლებამოსილი ისტორიული მოქმედებები კვლავ ხელმისაწვდომია.'
          : 'Your role cannot record a new bottling run; any authorized history actions remain available.')
        : null;
  const hasRestrictedLedgerTools = canCreateBottling && (!canUseBottlingCosting || !canPlaceFinishedGoods);

  return (
    <div className="space-y-4 animate-fade-in text-stone-800">
      {/* Header */}
      <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
        <span className="text-[9px] uppercase tracking-widest bg-[#4e0e15]/10 text-[#4e0e15] px-2.5 py-0.5 rounded font-bold">
          {ka ? 'მარანი · ჩამოსხმა' : 'Cellar · Bottling'}
        </span>
        <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
          <Package className="w-5 h-5 text-[#4e0e15]" />
          {ka ? 'ღვინის ჩამოსხმა' : 'Wine Bottling'}
        </h3>
      </div>

      {bottlingAccessNotice && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium leading-relaxed text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100">
          {bottlingAccessNotice}
        </div>
      )}

      {hasRestrictedLedgerTools && (
        <div role="note" className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs font-medium leading-relaxed text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
          {ka
            ? 'ჩამოსხმის ძირითადი აღრიცხვა ხელმისაწვდომია. ხარჯების/შეფუთვის გატარება და მზა პროდუქციის საწყობში განთავსება ნაჩვენებია მხოლოდ შესაბამისი ინვენტარის, ხარჯებისა და საწყობის უფლებებით.'
            : 'Core bottling remains available. Packaging/cost posting and finished-goods placement only appear with the required inventory, cost, and storage permissions.'}
        </div>
      )}

      <div className={`grid grid-cols-1 ${canCreateBottling ? '2xl:grid-cols-[1fr_1.2fr]' : ''} gap-4`}>
        {/* ── Bottling form ─────────────────────────────── */}
        {canCreateBottling && (
          <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-4 dark:bg-stone-900 dark:border-stone-800">
          {bottleable.length === 0 ? (
            <div className="text-center py-10 text-stone-500 dark:text-stone-400">
              <Wine className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-xs font-bold">{ka ? 'ჩამოსასხმელი ლოტი არ მოიძებნა' : 'No lots available to bottle'}</p>
              <p className="text-[11px] mt-1.5 max-w-xs mx-auto leading-relaxed">
                {ka
                  ? 'ჩამოსხმა ხელმისაწვდომია დაძველების, სტაბილიზაციის ან ფილტრაციის ეტაპზე, როცა ლოტი რეალურად არის განთავსებული შევსებულ ჭურჭელში.'
                  : 'Bottling is available during aging, stabilization, or filtration when the lot is physically assigned to a filled vessel.'}
              </p>
            </div>
          ) : (
            <>
              <fieldset disabled={Boolean(pendingIntent) || isSubmitting} className="contents">
              <div>
                <label className={labelCls}>{ka ? 'ღვინის ლოტი' : 'Wine lot'}</label>
                <select value={lotId} onChange={e => {
                  const nextLotId = e.target.value;
                  setLotId(nextLotId);
                  setSourceVesselId(vessels.find(vessel => vessel.assignedLotId === nextLotId && vessel.currentVolume > 0)?.id || '');
                  resetForm();
                }} className={inputCls}>
                  {bottleable.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.id}) — {round1(l.currentVolume)} L</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>{ka ? 'თარიღი' : 'Date'}</label>
                  <DateInput lang={lang} value={date} onValueChange={setDate} className={inputCls} required />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ლოტის №' : 'Lot №'}</label>
                  <input type="text" value={lotNumber} onChange={e => setLotNumber(e.target.value)} placeholder={ka ? 'მაგ. L-2026-07' : 'e.g. L-2026-07'} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ოპერატორი' : 'Operator'}</label>
                  <input type="text" value={operator} onChange={e => setOperator(e.target.value)} className={inputCls} />
                </div>
              </div>

              {/* Format counts */}
              <div>
                <label className={labelCls}>{ka ? 'ბოთლის ფორმატები (ცალი)' : 'Bottle formats (units)'}</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {displayedFormats.map(f => (
                    <div key={f.key} className={`border rounded-lg px-2.5 py-1.5 ${f.kind === 'ceramic' ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20' : 'border-stone-200 dark:border-stone-800'}`}>
                      <span className="text-[10px] font-bold text-stone-500 block">{f.labelKa}</span>
                      <input type="number" min={0} value={counts[f.key] || ''} placeholder="0"
                        onChange={e => setCount(f.key, e.target.value)}
                        className="w-full bg-transparent text-sm font-bold text-stone-800 outline-none dark:text-amber-50" />
                    </div>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-2 dark:border-stone-700 dark:bg-stone-900">
                  <label className="text-[9px] font-bold text-stone-500">
                    {ka ? 'სხვა ზომა (ლ)' : 'Custom size (L)'}
                    <input
                      type="number"
                      min="0.01"
                      max="30"
                      step="0.001"
                      value={customBottleSize}
                      onChange={event => setCustomBottleSize(event.target.value)}
                      className="mt-1 w-full rounded border border-stone-200 bg-white px-2 py-1.5 text-xs font-bold outline-none"
                    />
                  </label>
                  <label className="text-[9px] font-bold text-stone-500">
                    {ka ? 'რაოდენობა' : 'Units'}
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={customBottleCount}
                      onChange={event => setCustomBottleCount(event.target.value)}
                      placeholder="0"
                      className="mt-1 w-full rounded border border-stone-200 bg-white px-2 py-1.5 text-xs font-bold outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={addCustomBottleFormat}
                    className="self-end rounded bg-[#4e0e15] px-3 py-2 text-[10px] font-bold text-white hover:bg-[#6b151e]"
                  >
                    {ka ? 'დამატება' : 'Add'}
                  </button>
                </div>
              </div>

              <div>
                <label className={labelCls}>{ka ? 'წყარო ჭურჭელი' : 'Source vessel'}</label>
                <select required value={sourceVesselId} onChange={event => setSourceVesselId(event.target.value)} className={inputCls}>
                  <option value="">{ka ? '— აირჩიეთ ჭურჭელი —' : '— choose vessel —'}</option>
                  {sourceVessels.map(vessel => (
                    <option key={vessel.id} value={vessel.id}>
                      {vessel.id} — {round1(vessel.currentVolume)} L
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-stone-500">
                  {ka
                    ? 'ჩამოსხმისას მოცულობა ერთდროულად ჩამოიწერება ლოტიდან და ამ ჭურჭლიდან.'
                    : 'The run debits the wine lot and this physical vessel together.'}
                </p>
              </div>

              {/* Packaging and bottling costing */}
              {canUseBottlingCosting && (
                <div className="border border-stone-200 rounded-xl p-3 space-y-3 bg-stone-50/50 dark:bg-stone-950/40 dark:border-stone-800">
                <div className="flex items-center justify-between gap-2">
                  <label className={labelCls}>{ka ? 'შეფუთვის ხარჯები' : 'Packaging & bottling cost'}</label>
                  <span className="text-[10px] font-mono text-stone-400">{ka ? 'არასავალდებულო' : 'optional'}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PACKAGING_COMPONENTS.map(component => (
                    <div key={component.key}>
                      <span className="text-[10px] font-bold text-stone-500 block mb-1">{ka ? component.ka : component.en}</span>
                      <select value={packagingSelections[component.key] || ''} onChange={e => setPackaging(component.key, e.target.value)} className={inputCls}>
                        <option value="">{ka ? '— არ არის —' : '— none —'}</option>
                        {packagingItemsByComponent[component.key].map(item => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {round1(item.stock)} {item.unit} · {fmtMoney(item.costPerUnit || 0)}/{item.unit}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] font-bold text-stone-500 block mb-1">{ka ? 'ბოთლი / ყუთი' : 'Bottles per box'}</span>
                    <input type="number" min={1} value={bottlesPerBox} onChange={e => setBottlesPerBox(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-stone-500 block mb-1">{ka ? 'ჩამოსხმის სერვისი' : `Bottling service (${currency})`}</span>
                    <input type="number" min={0} step="0.01" value={bottlingServiceCost} onChange={e => setBottlingServiceCost(e.target.value)} placeholder="0.00" className={inputCls} />
                  </div>
                </div>
                {(costPreview.packagingCostTotal > 0 || costPreview.bottlingServiceCost > 0) && (
                  <div className="text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 dark:bg-emerald-950/20 dark:text-emerald-300 dark:border-emerald-900">
                    {ka ? 'ხარჯებში ჩაიწერება:' : 'Will post to COGS:'}{' '}
                    <strong>{fmtMoney(costPreview.packagingCostTotal + costPreview.bottlingServiceCost)}</strong>
                    {costPreview.entries.length > 0 && <span className="text-stone-500"> · {costPreview.entries.length} {ka ? 'ჩანაწერი' : 'entry(s)'}</span>}
                  </div>
                )}
                {hasPackagingShortfall && (
                  <div id="bottling-packaging-shortfall" role="alert" className="flex items-start gap-2 text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      {ka ? 'ჩამოსხმა დაბლოკილია — შეფუთვის პროდუქტი მარაგში საკმარისი არ არის:' : 'Bottling is blocked until packaging stock is replenished:'}{' '}
                      {overdrawnPackaging.map(x => `${x.item.name} (${round1(x.required)} required, ${round1(x.available)} available)`).join(', ')}
                    </span>
                  </div>
                )}
                </div>
              )}

              {/* Finished-goods placement */}
              {canPlaceFinishedGoods && storageLocations.length > 0 && (
                <div className="border border-sky-200 rounded-xl p-3 space-y-2 bg-sky-50/50 dark:bg-sky-950/20 dark:border-sky-900/50">
                  <div className="flex items-center justify-between gap-2">
                    <label className={labelCls}>{ka ? 'საწყობში განთავსება' : 'Place finished goods'}</label>
                    <span className="text-[10px] font-mono text-stone-400">{ka ? 'არასავალდებულო' : 'optional'}</span>
                  </div>
                  <select value={effectiveStorageLocationId} onChange={e => setStorageLocationId(e.target.value)} className={inputCls}>
                    <option value="">{ka ? '— მოგვიანებით განთავსება —' : '— place later —'}</option>
                    {storageLocations.map(loc => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}{loc.capacityBottles ? ` · ${loc.capacityBottles.toLocaleString()} btl cap.` : ''}
                      </option>
                    ))}
                  </select>
                  {effectiveStorageLocationId && selectedStorageLocation && totalUnits > 0 && (
                    <div className="text-[11px] font-mono text-sky-800 bg-white border border-sky-100 rounded-lg px-3 py-2 dark:bg-stone-900 dark:text-sky-300 dark:border-sky-900">
                      {ka ? 'შეიქმნება საწყობის შემოსავლის მოძრაობა:' : 'Will create inbound storage movement:'}{' '}
                      <strong>{totalUnits.toLocaleString()} {ka ? 'ბოთლი' : 'bottles'}</strong> → {selectedStorageLocation.name}
                    </div>
                  )}
                </div>
              )}

              {/* Live summary */}
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono border-t border-stone-100 pt-3 dark:border-stone-800">
                <span className="text-stone-500">{ka ? 'ჩამოსხმული:' : 'Bottled:'} <strong className={overfill ? 'text-rose-600' : 'text-[#4e0e15] dark:text-amber-300'}>{volumeBottledL} L</strong></span>
                <span className="text-stone-500">{ka ? 'ჭურჭელში ხელმისაწვდომი:' : 'Available in vessel:'} <strong>{round1(availableL)} L</strong></span>
                <span className="text-stone-500">{ka ? 'ბოთლი:' : 'Bottles:'} <strong>{totalBottles}</strong></span>
                {totalCeramic > 0 && <span className="text-stone-500">{ka ? 'კერამიკა:' : 'Ceramic:'} <strong>{totalCeramic}</strong></span>}
              </div>

              {overfill && (
                <div className="flex items-center gap-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 dark:bg-rose-950/30">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {ka ? 'ჩამოსხმის მოცულობა აღემატება ლოტის ან წყარო ჭურჭლის ნაშთს.' : 'Bottled volume exceeds the lot or source-vessel balance.'}
                </div>
              )}

              </fieldset>
              {commandError && (
                <div role="alert" className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900">
                  {commandError}
                </div>
              )}
              <button onClick={handleBottleCommand} disabled={!canSubmit || isSubmitting} aria-describedby={hasPackagingShortfall ? 'bottling-packaging-shortfall' : undefined}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 disabled:cursor-not-allowed text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors">
                <CheckCircle2 className="w-4 h-4" /> {pendingIntent
                  ? (ka ? 'იგივე ჩამოსხმის ხელახლა გაგზავნა' : 'Resubmit bottling run')
                  : (ka ? 'ჩამოსხმის აღრიცხვა' : 'Record bottling')}
              </button>
            </>
          )}
          </div>
        )}

        {/* ── History ───────────────────────────────────── */}
        <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
          <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
            <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
              <Package className="w-4 h-4" /> {ka ? 'ჩამოსხმის ისტორია' : 'Bottling history'}
            </span>
            <span className="text-[9px] font-mono text-stone-400 flex items-center gap-1">
              <FileDown className="w-3 h-3" /> {ka ? 'დანართი №7' : 'Annex №7'}
            </span>
          </div>
          {(reversalRun || pendingReversalIntent) && (
            <div className="border-b border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-amber-950 dark:text-amber-100">
                    {ka ? 'ჩამოსხმის შესწორება' : 'Correct bottling run'}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                    {ka
                      ? 'თავდაპირველი ჩანაწერი დარჩება აუდიტის ისტორიაში. მოცულობა, შეფუთვა, ხარჯი და საწყობის მიღება აღდგება მხოლოდ თუ შემდგომი დამოკიდებული სამუშაო არ არსებობს.'
                      : 'The original remains in the audit trail. Lot volume, packaging, cost, and the original warehouse receipt are compensated only if no later work depends on them.'}
                  </p>
                </div>
                {!pendingReversalIntent && (
                  <button type="button" onClick={() => { setReversalRunId(''); setReversalReason(''); setCommandError(null); }}
                    aria-label={ka ? 'დახურვა' : 'Close correction'} className="text-amber-700 hover:text-amber-950 dark:text-amber-300">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <label className="mt-3 block text-[9px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                {ka ? 'შესწორების მიზეზი' : 'Correction reason'}
                <textarea value={reversalReason} onChange={event => setReversalReason(event.target.value)}
                  disabled={Boolean(pendingReversalIntent)} maxLength={500} rows={2}
                  className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-medium normal-case tracking-normal text-stone-800 outline-none focus:border-amber-600 disabled:opacity-70 dark:border-amber-900 dark:bg-stone-950 dark:text-amber-50"
                  placeholder={ka ? 'რატომ არის ეს შესწორება საჭირო?' : 'Why is this correction required?'} />
              </label>
              <button type="button" onClick={handleReverseRun}
                disabled={isReversing || (!pendingReversalIntent && !reversalReason.trim())}
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-amber-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-50 disabled:opacity-50 dark:bg-amber-700">
                <RotateCcw className="h-3.5 w-3.5" />
                {pendingReversalIntent
                  ? (ka ? 'იმავე შესწორების ხელახლა გაგზავნა' : 'Resubmit same correction')
                  : (ka ? 'შესწორების დადასტურება' : 'Confirm correction')}
              </button>
            </div>
          )}
          {history.length === 0 ? (
            <div className="text-center py-12 text-stone-400 text-xs font-semibold">
              {ka ? 'ჯერ არ არის ჩამოსხმა აღრიცხული' : 'No bottling runs recorded yet'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[11px]">
                <thead>
                  <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-400 font-bold dark:bg-stone-950">
                    <th className="p-2.5">{ka ? 'თარიღი' : 'Date'}</th>
                    <th className="p-2.5">{ka ? 'ლოტი' : 'Lot'}</th>
                    <th className="p-2.5 text-right">{ka ? 'ბოთლი' : 'Bottles'}</th>
                    <th className="p-2.5 text-right">{ka ? 'მოცულობა' : 'Volume'}</th>
                    {canReverseBottling && <th className="p-2.5"><span className="sr-only">{ka ? 'მოქმედებები' : 'Actions'}</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                  {orderedHistory.map(r => (
                    <tr key={r.id} className={`hover:bg-stone-50/50 dark:hover:bg-white/5 ${r.recordKind === 'reversal' || r.reversedByCommandId ? 'opacity-65' : ''}`}>
                      <td className="p-2.5 font-mono text-stone-500">{r.date}</td>
                      <td className="p-2.5 font-bold text-stone-800 dark:text-amber-50">
                        {r.lotName}
                        {r.recordKind === 'reversal' && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[8px] uppercase text-amber-800">{ka ? 'შესწორება' : 'Correction'}</span>}
                        {r.reversedByCommandId && <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-[8px] uppercase text-stone-600">{ka ? 'გაუქმებული' : 'Reversed'}</span>}
                        <span className="block text-[9px] font-mono text-stone-400">{r.lotNumber || r.lotId}</span>
                      </td>
                      <td className="p-2.5 text-right font-bold">{r.recordKind === 'reversal' ? '−' : ''}{r.totalBottles}{r.totalCeramic ? ` +${r.totalCeramic}🏺` : ''}</td>
                      <td className="p-2.5 text-right font-mono text-[#4e0e15] dark:text-amber-300">{r.recordKind === 'reversal' ? '−' : ''}{r.volumeBottledL} L</td>
                      {canReverseBottling && (
                        <td className="p-2.5 text-right">
                          {isActiveBottlingRun(r) && r.commandId && (
                            <button
                              type="button"
                              onClick={() => { setReversalRunId(r.id); setReversalReason(''); setCommandError(null); }}
                              title={ka ? 'შესწორება' : 'Correct'}
                              aria-label={ka ? `${r.lotName} ჩამოსხმის შესწორება` : `Correct bottling run for ${r.lotName}`}
                              className="text-stone-300 hover:text-amber-700 cursor-pointer transition-colors"
                            >
                              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(BottlingTab);
