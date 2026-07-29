import React, { useEffect, useMemo, useState } from 'react';
import { Warehouse, Plus, Trash2, Boxes, Thermometer, Droplet, PackagePlus, LockKeyhole } from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { WineLot, BottlingRunRecord, SalesDispatchRecord, SalesOrderRecord } from '../lib/wineryState';
import DateInput from './ui/DateInput';
import {
  computeStock,
  isFinishedGoodsLot,
  lotTotalStored,
  storageLocationReferences,
  storageMovementDeletionBlockers,
  unstored,
  utilization,
  type StorageLocation,
  type StorageLocationReferences,
  type StockMovement,
  type StorageMovementDeletionBlockers,
  type StorageType,
} from '../lib/storage';
import { reservedBottlesFor, stockAvailabilityPosition } from '../lib/sales';
import { CountUp } from './motion';
import { isActiveBottlingRun } from '../lib/bottlingIntegrity';
import { SyncQueueManager, type PendingCommandIntent } from '../lib/syncQueue';
import {
  applyStorageMovementCommand,
  bottlingRunUnplacedUnits,
  type StorageMovementCommandPayload,
} from '../lib/commands/storageMovement';
import {
  CommandRequestError,
  createStorageMovementCommandIntent,
  pendingStorageMovementCommandIntent,
  submitStorageMovementCommand,
  type StorageMovementCommandResponse,
} from '../lib/commands/client';

interface Props {
  lang: Language;
  lots: WineLot[];
  bottlingRuns: BottlingRunRecord[];
  locations: StorageLocation[];
  movements: StockMovement[];
  orders?: SalesOrderRecord[];
  dispatches?: SalesDispatchRecord[];
  onUpdateLocations: (locations: StorageLocation[]) => void;
  onUpdateMovements: (movements: StockMovement[]) => void;
  onUpdateBottlingRuns?: (runs: BottlingRunRecord[]) => void;
  onApplyStorageMovementCommandResponse?: (response: StorageMovementCommandResponse) => void;
  currentUserName?: string;
  onDeleteLocation?: (locationId: string) => boolean | void;
  onDeleteMovement?: (movementId: string) => boolean | void;
  setToastMessage?: (message: string) => void;
  onNavigate?: (target: { module: string; tab?: string }) => void;
  canCreateLocation?: boolean;
  canDeleteLocation?: boolean;
  canCreateMovement?: boolean;
  canDeleteMovement?: boolean;
}

const TYPES: Array<{ id: StorageType; ka: string; en: string }> = [
  { id: 'warehouse', ka: 'საწყობი', en: 'Warehouse' },
  { id: 'cellar', ka: 'მარანი', en: 'Cellar' },
  { id: 'rack', ka: 'სტელაჟი', en: 'Rack' },
  { id: 'cold_room', ka: 'მაცივარი', en: 'Cold room' },
  { id: 'qvevri_hall', ka: 'ქვევრის დარბაზი', en: 'Qvevri hall' },
  { id: 'other', ka: 'სხვა', en: 'Other' },
];
const typeLabel = (id: StorageType, ka: boolean) => { const t = TYPES.find(x => x.id === id); return t ? (ka ? t.ka : t.en) : id; };

const joinLabels = (parts: string[], conjunction: string): string => {
  if (parts.length <= 1) return parts[0] || '';
  if (parts.length === 2) return `${parts[0]} ${conjunction} ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, ${conjunction} ${parts[parts.length - 1]}`;
};

const locationDeletionReason = (references: StorageLocationReferences, ka: boolean): string => {
  const counts: Array<[number, string, string]> = [
    [references.movementIds.length, 'stock movement', 'მარაგის მოძრაობა'],
    [references.bottlingRunIds.length, 'bottling run', 'ჩამოსხმის ჩანაწერი'],
    [references.salesOrderIds.length, 'sales order', 'გაყიდვის შეკვეთა'],
    [references.salesDispatchIds.length, 'sales dispatch', 'გაცემის ჩანაწერი'],
  ];
  const parts = counts
    .filter(([count]) => count > 0)
    .map(([count, en, kaLabel]) => ka ? `${count} ${kaLabel}` : `${count} ${en}${count === 1 ? '' : 's'}`);
  return ka
    ? `წაშლა დაბლოკილია: ამ ლოკაციას კვლავ უკავშირდება ${joinLabels(parts, 'და')}. ჯერ განაახლეთ ან წაშალეთ დაკავშირებული ჩანაწერები.`
    : `Deletion locked: ${joinLabels(parts, 'and')} still ${references.total === 1 ? 'references' : 'reference'} this location. Update or remove the linked records first.`;
};

const movementDeletionReason = (blockers: StorageMovementDeletionBlockers, ka: boolean): string => {
  const linked: string[] = [];
  if (blockers.commandIds.length > 0) {
    linked.push(ka ? 'სერვერის ატომურ ბრძანებას' : 'an atomic server command');
  }
  if (blockers.bottlingRunIds.length > 0) {
    linked.push(ka
      ? `${blockers.bottlingRunIds.length} ჩამოსხმის ჩანაწერს`
      : `${blockers.bottlingRunIds.length} bottling run${blockers.bottlingRunIds.length === 1 ? '' : 's'}`);
  }
  if (blockers.salesDispatchIds.length > 0) {
    linked.push(ka
      ? `${blockers.salesDispatchIds.length} გაცემის ჩანაწერს`
      : `${blockers.salesDispatchIds.length} sales dispatch${blockers.salesDispatchIds.length === 1 ? '' : 'es'}`);
  }
  if (blockers.relatedMovementIds.length > 0) {
    linked.push(ka ? 'áƒ¬áƒ§áƒ•áƒ˜áƒš áƒ¨áƒ˜áƒ“áƒ áƒ’áƒáƒ“áƒáƒ¢áƒáƒœáƒáƒ¡' : 'a paired internal relocation');
  }
  if (linked.length > 0) {
    return ka
      ? `მოძრაობა დაბლოკილია, რადგან ის ეკუთვნის ${joinLabels(linked, 'და')}. წაშალეთ საწყისი ჩანაწერი შესაბამის სამუშაო პროცესში.`
      : `Movement locked because it belongs to ${joinLabels(linked, 'and')}. Delete the source record from its workflow instead.`;
  }
  if (blockers.wouldCreateNegativeStock) {
    const shortage = Math.abs(blockers.remainingOnHandBottles);
    return ka
      ? `წაშლა მარაგს ${shortage.toLocaleString()} ბოთლით უარყოფითს გახდის. ამის ნაცვლად დააფიქსირეთ მაკორექტირებელი მოძრაობა.`
      : `Deletion would leave stock short by ${shortage.toLocaleString()} bottles. Record a correcting movement instead.`;
  }
  return ka
    ? `წაშლის შემდეგ დარჩება ${blockers.remainingOnHandBottles.toLocaleString()} ბოთლი, ხოლო ${blockers.reservedBottles.toLocaleString()} დაჯავშნილია. ჯერ გადაიტანეთ ან გააუქმეთ ჯავშნები.`
    : `Deletion would leave ${blockers.remainingOnHandBottles.toLocaleString()} bottles for ${blockers.reservedBottles.toLocaleString()} reserved. Move or cancel the reservations first.`;
};

export default function StorageTab({
  lang,
  lots,
  bottlingRuns,
  locations,
  movements,
  orders = [],
  dispatches = [],
  onUpdateLocations,
  onUpdateMovements,
  onUpdateBottlingRuns,
  onApplyStorageMovementCommandResponse,
  currentUserName = 'Cellar Crew',
  onDeleteLocation,
  onDeleteMovement,
  setToastMessage,
  onNavigate,
  canCreateLocation = true,
  canDeleteLocation = true,
  canCreateMovement = true,
  canDeleteMovement = true,
}: Props) {
  const ka = lang === 'ka';
  const today = new Date().toISOString().slice(0, 10);

  const producedByLot = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of bottlingRuns) {
      if (!isActiveBottlingRun(r)) continue;
      m[r.lotId] = (m[r.lotId] || 0) + (r.totalBottles || 0) + (r.totalCeramic || 0);
    }
    return m;
  }, [bottlingRuns]);

  const stock = useMemo(() => computeStock(movements), [movements]);
  const unstoredByLot = useMemo(() => unstored(producedByLot, movements), [producedByLot, movements]);
  const totalStored = useMemo(() => [...stock.values()].reduce((a, s) => a + s.totalBottles, 0), [stock]);
  const totalReserved = useMemo(() => {
    let sum = 0;
    for (const loc of stock.values()) {
      for (const [lotId, bottles] of Object.entries(loc.byLot)) {
        sum += Math.min(bottles, reservedBottlesFor(orders, loc.locationId, lotId, today));
      }
    }
    return sum;
  }, [orders, stock, today]);
  const totalAvailable = Math.max(0, totalStored - totalReserved);
  const totalUnstored = useMemo(() => Object.values(unstoredByLot).reduce((a, n) => a + n, 0), [unstoredByLot]);
  const locationDeletionReferences = useMemo(() => new Map(locations.map(location => [
    location.id,
    storageLocationReferences(location.id, { movements, bottlingRuns, orders, dispatches }),
  ])), [bottlingRuns, dispatches, locations, movements, orders]);
  const movementDeletionGuards = useMemo(() => new Map(movements.slice(0, 30).map(movement => [
    movement.id,
    storageMovementDeletionBlockers(movement.id, {
      movements,
      bottlingRuns,
      orders,
      dispatches,
      asOfDate: today,
    }),
  ])), [bottlingRuns, dispatches, movements, orders, today]);
  const finishedGoodsLots = useMemo(
    () => lots.filter(lot => isFinishedGoodsLot(lot, bottlingRuns)),
    [bottlingRuns, lots],
  );

  const lotName = (id: string) => lots.find(l => l.id === id)?.name || id;

  // location form
  const [ln, setLn] = useState(''); const [lt, setLt] = useState<StorageType>('warehouse');
  const [lcap, setLcap] = useState(''); const [ltemp, setLtemp] = useState(''); const [lhum, setLhum] = useState('');
  const addLoc = () => {
    if (!canCreateLocation || !ln.trim()) return;
    const loc: StorageLocation = {
      id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: ln.trim(), type: lt,
      capacityBottles: parseInt(lcap) || undefined,
      targetTempC: ltemp === '' ? undefined : parseFloat(ltemp),
      targetHumidity: lhum === '' ? undefined : parseFloat(lhum),
    };
    onUpdateLocations([...locations, loc]);
    setLn(''); setLcap(''); setLtemp(''); setLhum('');
  };
  const deleteLocation = (locationId: string) => {
    if (!canDeleteLocation) return;
    const references = locationDeletionReferences.get(locationId);
    if (references && references.total > 0) {
      setToastMessage?.(locationDeletionReason(references, ka));
      return;
    }
    if (typeof window !== 'undefined' && !window.confirm(ka
      ? 'წავშალოთ ეს შენახვის ლოკაცია? სინქრონიზაციის შემდეგ მოქმედების გაუქმება შეუძლებელია.'
      : 'Delete this storage location? This cannot be undone after sync.')) return;
    if (onDeleteLocation) {
      onDeleteLocation(locationId);
      return;
    }
    onUpdateLocations(locations.filter(location => location.id !== locationId));
  };

  // Command-owned movement form. Sales owns customer dispatches and bottling
  // owns same-transaction placement; this form only receives previously
  // unplaced output, relocates stock, or records an explicit count adjustment.
  const [mAction, setMAction] = useState<'receive' | 'relocate' | 'adjust'>('receive');
  const [mDate, setMDate] = useState(new Date().toISOString().slice(0, 10));
  const [mLot, setMLot] = useState(finishedGoodsLots[0]?.id || '');
  const [mRun, setMRun] = useState('');
  const [mLoc, setMLoc] = useState('');
  const [mDest, setMDest] = useState('');
  const [mDir, setMDir] = useState<'in' | 'out'>('out');
  const [mQty, setMQty] = useState('');
  const [mReason, setMReason] = useState('Inventory count correction');
  const [mNote, setMNote] = useState('');
  const [commandError, setCommandError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<PendingCommandIntent<StorageMovementCommandPayload> | null>(null);

  const unplacedRuns = useMemo(() => bottlingRuns.filter(run => (
    isActiveBottlingRun(run) && bottlingRunUnplacedUnits(run, movements) > 0
  )), [bottlingRuns, movements]);

  useEffect(() => {
    const restored = pendingStorageMovementCommandIntent();
    if (!restored) return;
    setPendingIntent(restored);
    setMAction(restored.payload.action);
    setMDate(restored.payload.date);
    setMLot(restored.payload.lotId);
    setMQty(String(restored.payload.bottles));
    setMNote(restored.payload.note);
    if (restored.payload.action === 'receive') {
      setMRun(restored.payload.bottlingRunId);
      setMLoc(restored.payload.locationId);
    } else if (restored.payload.action === 'relocate') {
      setMLoc(restored.payload.sourceLocationId);
      setMDest(restored.payload.destinationLocationId);
    } else {
      setMLoc(restored.payload.locationId);
      setMDir(restored.payload.direction);
      setMReason(restored.payload.adjustmentReason);
    }
    setCommandError(ka
      ? 'წინა მოძრაობის შედეგი ჯერ არ არის დადასტურებული. იგივე ბრძანება ხელახლა გააგზავნეთ.'
      : 'A previous movement is not yet acknowledged. Resubmit to recover the same command safely.');
  }, [ka]);

  useEffect(() => {
    if (finishedGoodsLots.some(lot => lot.id === mLot)) return;
    setMLot(finishedGoodsLots[0]?.id || '');
  }, [finishedGoodsLots, mLot]);

  const receiveRunsForLot = useMemo(
    () => unplacedRuns.filter(run => run.lotId === mLot),
    [mLot, unplacedRuns],
  );
  useEffect(() => {
    if (mAction !== 'receive' || receiveRunsForLot.some(run => run.id === mRun)) return;
    setMRun(receiveRunsForLot[0]?.id || '');
  }, [mAction, mRun, receiveRunsForLot]);

  const moveQty = Math.max(0, parseInt(mQty) || 0);
  const selectedLotIsFinishedGoods = finishedGoodsLots.some(lot => lot.id === mLot);
  const selectedRun = receiveRunsForLot.find(run => run.id === mRun);
  const selectedRunRemaining = selectedRun ? bottlingRunUnplacedUnits(selectedRun, movements) : 0;
  const selectedOnHand = stock.get(mLoc)?.byLot[mLot] || 0;
  const selectedPosition = stockAvailabilityPosition({
    onHandBottles: selectedOnHand,
    orders,
    locationId: mLoc,
    lotId: mLot,
    asOfDate: today,
  });
  const destinationId = mAction === 'relocate' ? mDest : mLoc;
  const destination = locations.find(location => location.id === destinationId);
  const destinationStored = stock.get(destinationId)?.totalBottles || 0;
  const addsToDestination = mAction === 'receive' || mAction === 'relocate'
    || (mAction === 'adjust' && mDir === 'in');
  const overDestinationCapacity = addsToDestination && Boolean(
    destination?.capacityBottles && destinationStored + moveQty > destination.capacityBottles,
  );
  const overAvailableForOut = (mAction === 'relocate' || (mAction === 'adjust' && mDir === 'out'))
    && moveQty > selectedPosition.availableBottles;
  const overRunRemaining = mAction === 'receive' && moveQty > selectedRunRemaining;
  const producedForSelectedLot = producedByLot[mLot] || 0;
  const overProducedForAdjustment = mAction === 'adjust' && mDir === 'in'
    && lotTotalStored(movements, mLot) + moveQty > producedForSelectedLot;
  const canMove = selectedLotIsFinishedGoods
    && moveQty > 0
    && !!mDate
    && !overAvailableForOut
    && !overDestinationCapacity
    && !overRunRemaining
    && !overProducedForAdjustment
    && (mAction === 'receive'
      ? Boolean(mRun && mLoc)
      : mAction === 'relocate'
        ? Boolean(mLoc && mDest && mLoc !== mDest)
        : Boolean(mLoc && mReason.trim()));
  const formLocked = isSubmitting || Boolean(pendingIntent);

  const finishMovementCommand = () => {
    setPendingIntent(null);
    setCommandError(null);
    setMQty('');
    setMNote('');
  };

  const localizedMovementReceipt = (result: StorageMovementCommandResponse['result']): string => {
    const receipt = result.receipt;
    if (receipt.action === 'receive') {
      return ka
        ? `${receipt.bottles.toLocaleString()} ერთეული საწყობში განთავსდა.`
        : `${receipt.bottles.toLocaleString()} bottled units placed in storage.`;
    }
    if (receipt.action === 'relocate') {
      return ka
        ? `${receipt.bottles.toLocaleString()} ბოთლი ლოკაციებს შორის გადაიტანეს.`
        : `${receipt.bottles.toLocaleString()} bottles relocated atomically.`;
    }
    return ka
      ? `${receipt.bottles.toLocaleString()} ბოთლის კორექტირება აღირიცხა.`
      : `${receipt.bottles.toLocaleString()} bottle adjustment recorded.`;
  };

  const applyMovementLocally = (intent: PendingCommandIntent<StorageMovementCommandPayload>) => {
    if (intent.payload.action === 'receive' && !onUpdateBottlingRuns) {
      throw new Error('The linked bottling run cannot be updated in this workspace.');
    }
    const applied = applyStorageMovementCommand(
      { lots, bottlingRuns, storageLocations: locations, stockMovements: movements, salesOrders: orders },
      intent.payload,
      { commandId: intent.commandId, actorUsername: currentUserName, performedAt: new Date() },
    );
    onUpdateMovements(applied.state.stockMovements);
    onUpdateBottlingRuns?.(applied.state.bottlingRuns);
    setToastMessage?.(localizedMovementReceipt(applied.result));
    finishMovementCommand();
  };

  const executeMovementCommand = async (intent: PendingCommandIntent<StorageMovementCommandPayload>) => {
    setCommandError(null);
    if (!onApplyStorageMovementCommandResponse || !SyncQueueManager.isOnline()) {
      if (pendingIntent) {
        setCommandError(ka
          ? 'დაუდასტურებელი მოძრაობის აღდგენას ინტერნეტი სჭირდება.'
          : 'Recovering an unacknowledged storage movement requires a server connection.');
        return;
      }
      try {
        applyMovementLocally(intent);
      } catch (error) {
        setCommandError(error instanceof Error ? error.message : 'Storage movement validation failed.');
      }
      return;
    }

    setPendingIntent(intent);
    setIsSubmitting(true);
    try {
      const response = await submitStorageMovementCommand(intent);
      onApplyStorageMovementCommandResponse(response);
      setToastMessage?.(localizedMovementReceipt(response.result));
      finishMovementCommand();
    } catch (error) {
      if (error instanceof CommandRequestError
        && error.code === 'command_store_unavailable'
        && !pendingIntent) {
        SyncQueueManager.consumePendingCommandIntent(intent.commandId);
        try {
          applyMovementLocally(intent);
          return;
        } catch (fallbackError) {
          setCommandError(fallbackError instanceof Error ? fallbackError.message : 'Storage movement validation failed.');
          setPendingIntent(null);
          return;
        }
      }
      setCommandError(error instanceof Error ? error.message : 'Storage movement command failed.');
      if (error instanceof CommandRequestError && !error.retryable) setPendingIntent(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitMove = () => {
    if (!canCreateMovement) return;
    if (pendingIntent) {
      void executeMovementCommand(pendingIntent);
      return;
    }
    if (!canMove) {
      const message = overAvailableForOut
        ? 'Quantity exceeds unreserved available stock.'
        : overDestinationCapacity
          ? 'Quantity exceeds destination capacity.'
          : overRunRemaining
            ? 'Quantity exceeds the selected bottling run\'s unplaced units.'
            : overProducedForAdjustment
              ? 'Adjustment would exceed bottled production for this lot.'
              : 'Complete the required movement fields.';
      setToastMessage?.(message);
      return;
    }
    const common = { date: mDate, lotId: mLot, bottles: moveQty, note: mNote };
    const intent = mAction === 'receive'
      ? createStorageMovementCommandIntent({
        ...common,
        action: 'receive',
        bottlingRunId: mRun,
        locationId: mLoc,
      })
      : mAction === 'relocate'
        ? createStorageMovementCommandIntent({
          ...common,
          action: 'relocate',
          sourceLocationId: mLoc,
          destinationLocationId: mDest,
        })
        : createStorageMovementCommandIntent({
          ...common,
          action: 'adjust',
          locationId: mLoc,
          direction: mDir,
          adjustmentReason: mReason,
        });
    void executeMovementCommand(intent);
  };

  const prefillReceive = (lotId: string, bottles: number) => {
    if (!canCreateMovement || formLocked) return;
    const run = unplacedRuns.find(item => item.lotId === lotId);
    setMAction('receive');
    setMLot(lotId);
    setMRun(run?.id || '');
    setMQty(String(Math.min(bottles, run ? bottlingRunUnplacedUnits(run, movements) : bottles)));
    if (!mLoc && locations[0]) setMLoc(locations[0].id);
  };
  const deleteMovement = (movementId: string) => {
    if (!canDeleteMovement) return;
    const blockers = storageMovementDeletionBlockers(movementId, {
      movements,
      bottlingRuns,
      orders,
      dispatches,
      asOfDate: today,
    });
    if (blockers?.blocked) {
      setToastMessage?.(movementDeletionReason(blockers, ka));
      return;
    }
    if (typeof window !== 'undefined' && !window.confirm(ka
      ? 'წავშალოთ ეს მარაგის მოძრაობა? ბალანსი დაუყოვნებლივ შეიცვლება და სინქრონიზაციის შემდეგ მოქმედების გაუქმება შეუძლებელია.'
      : 'Delete this stock movement? Stock balances will change immediately and this cannot be undone after sync.')) return;
    if (onDeleteMovement) {
      onDeleteMovement(movementId);
      return;
    }
    onUpdateMovements(movements.filter(movement => movement.id !== movementId));
  };

  const hasAnyStorageAction = canCreateLocation || canDeleteLocation || canCreateMovement || canDeleteMovement;
  const hasAllStorageActions = canCreateLocation && canDeleteLocation && canCreateMovement && canDeleteMovement;
  const showStorageForms = canCreateLocation || canCreateMovement;

  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800';

  return (
    <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-6 flex flex-col space-y-5 font-sans animate-fade-in">
      <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
        <span className="text-[9px] uppercase tracking-widest bg-sky-100 text-sky-800 px-2.5 py-0.5 rounded font-bold">{ka ? 'მარაგი' : 'Inventory'}</span>
        <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
          <Warehouse className="w-5 h-5 text-[#4e0e15]" /> {ka ? 'ღვინის შენახვა' : 'Wine Storage'}
        </h3>
        <p className="text-xs text-stone-400 font-semibold mt-0.5">{ka ? 'მზა ნაწარმის მარაგი ლოკაციების მიხედვით' : 'Finished-goods stock by location · feeds Annex №8'}</p>
      </div>

      {!hasAllStorageActions && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {!hasAnyStorageAction
              ? (ka
                ? 'შენახვის მონაცემები მხოლოდ სანახავია. შეგიძლიათ შეამოწმოთ ლოკაციები, მარაგი, ხელმისაწვდომობა და მოძრაობების ისტორია.'
                : 'Storage data is read-only. You can review locations, stock, availability, and movement history.')
              : (ka
                ? 'შენახვის ზოგიერთი მოქმედება თქვენი როლისთვის მიუწვდომელია. ლოკაციები, მარაგი, ხელმისაწვდომობა და მოძრაობების ისტორია კვლავ ხილულია.'
                : 'Some storage actions are unavailable for your role. Locations, stock, availability, and movement history remain visible.')}
          </span>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: ka ? 'რეზერვში' : 'Reserved', value: totalReserved, accent: totalReserved > 0 ? 'text-blue-700 dark:text-blue-300' : 'text-stone-800 dark:text-amber-100' },
          { label: ka ? 'ხელმისაწვდომი' : 'Available', value: totalAvailable, accent: 'text-emerald-700 dark:text-emerald-400' },
          { label: ka ? 'შენახული ბოთლი' : 'Bottles stored', value: totalStored, accent: 'text-[#4e0e15] dark:text-amber-300' },
          { label: ka ? 'ლოკაციები' : 'Locations', value: locations.length, accent: 'text-stone-800 dark:text-amber-100' },
          { label: ka ? 'განსათავსებელი' : 'To place', value: totalUnstored, accent: totalUnstored > 0 ? 'text-amber-600' : 'text-stone-800 dark:text-amber-100' },
          { label: ka ? 'ლოტები' : 'Lots', value: lots.length, accent: 'text-stone-800 dark:text-amber-100' },
        ].map((c, i) => (
          <div key={i} className="bg-white border border-[#e8dfd5] rounded-2xl p-4 dark:bg-stone-900 dark:border-stone-800">
            <span className="text-[9px] uppercase font-mono text-stone-400 font-bold tracking-widest">{c.label}</span>
            <strong className={`block mt-1 text-2xl font-serif font-black ${c.accent}`}><CountUp value={c.value} /></strong>
          </div>
        ))}
      </div>

      {/* Unstored hint */}
      {totalUnstored > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 dark:bg-amber-950/30 dark:border-amber-900/50">
          <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300">{ka ? 'ჩამოსხმული, მაგრამ ჯერ არ განთავსებული:' : 'Bottled but not yet placed in storage:'}</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {Object.entries(unstoredByLot).map(([lotId, n]) => (
              canCreateMovement ? (
                <button key={lotId} onClick={() => prefillReceive(lotId, n)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-stone-900 border border-amber-300 rounded-lg text-[10px] font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-100 cursor-pointer">
                  <PackagePlus className="w-3 h-3" /> {lotName(lotId)} — {n}
                </button>
              ) : (
                <span key={lotId} className="flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-stone-900 border border-amber-300 rounded-lg text-[10px] font-bold text-amber-800 dark:text-amber-300">
                  <PackagePlus className="w-3 h-3" /> {lotName(lotId)} — {n}
                </span>
              )
            ))}
          </div>
        </div>
      )}

      <div className={`grid grid-cols-1 ${showStorageForms ? 'lg:grid-cols-[340px_1fr]' : ''} gap-5`}>
        {/* Locations */}
        {showStorageForms && <div className="space-y-4">
          {canCreateLocation && (
          <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-3 dark:bg-stone-900 dark:border-stone-800">
            <h4 className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100"><Plus className="w-4 h-4" /> {ka ? 'ლოკაციის დამატება' : 'Add location'}</h4>
            <div><label className={labelCls}>{ka ? 'დასახელება' : 'Name'}</label><input value={ln} onChange={e => setLn(e.target.value)} className={inputCls} placeholder={ka ? 'მაგ. მთავარი საწყობი' : 'e.g. Main warehouse'} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>{ka ? 'ტიპი' : 'Type'}</label>
                <select value={lt} onChange={e => setLt(e.target.value as StorageType)} className={inputCls}>{TYPES.map(t => <option key={t.id} value={t.id}>{ka ? t.ka : t.en}</option>)}</select>
              </div>
              <div><label className={labelCls}>{ka ? 'ტევადობა (ბოთლი)' : 'Capacity (btl)'}</label><input type="number" min={0} value={lcap} onChange={e => setLcap(e.target.value)} className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>{ka ? 'სამიზნე °C' : 'Target °C'}</label><input type="number" value={ltemp} onChange={e => setLtemp(e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>{ka ? 'ტენიანობა %' : 'Humidity %'}</label><input type="number" value={lhum} onChange={e => setLhum(e.target.value)} className={inputCls} /></div>
            </div>
            <button onClick={addLoc} disabled={!ln.trim()} className="w-full px-4 py-2 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer">{ka ? 'დამატება' : 'Add'}</button>
          </div>
          )}

          {/* Movement form */}
          {canCreateMovement && (
          <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-3 dark:bg-stone-900 dark:border-stone-800">
            <h4 className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100"><Boxes className="w-4 h-4" /> {ka ? 'მოძრაობა' : 'Stock movement'}</h4>
            {locations.length === 0 ? (
              <p className="text-xs text-stone-400 py-4 text-center">{ka ? 'ჯერ დაამატეთ ლოკაცია' : 'Add a location first'}</p>
            ) : (
              <>
                <div className="grid grid-cols-3 rounded-lg border border-stone-200 overflow-hidden w-full dark:border-stone-800">
                  {([
                    { id: 'receive', ka: 'მიღება', en: 'Receive' },
                    { id: 'relocate', ka: 'გადატანა', en: 'Relocate' },
                    { id: 'adjust', ka: 'კორექცია', en: 'Adjust' },
                  ] as const).map(option => (
                    <button
                      type="button"
                      key={option.id}
                      onClick={() => setMAction(option.id)}
                      disabled={formLocked}
                      className={`px-2 py-2 text-[9px] font-bold uppercase cursor-pointer disabled:cursor-not-allowed ${mAction === option.id ? 'bg-[#4e0e15] text-white' : 'bg-stone-50 text-stone-500 dark:bg-stone-900'}`}
                    >
                      {ka ? option.ka : option.en}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={labelCls}>{ka ? 'თარიღი' : 'Date'}</label><DateInput lang={lang} value={mDate} onValueChange={setMDate} disabled={formLocked} className={inputCls} required /></div>
                  <div><label className={labelCls}>{ka ? 'ბოთლი' : 'Bottles'}</label><input type="number" min={1} value={mQty} onChange={e => setMQty(e.target.value)} disabled={formLocked} className={inputCls} /></div>
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ჩამოსხმული ლოტი' : 'Bottled wine lot'}</label>
                  <select value={mLot} onChange={e => setMLot(e.target.value)} className={inputCls} disabled={formLocked || finishedGoodsLots.length === 0}>
                    {finishedGoodsLots.length === 0 && <option value="">{ka ? 'ჩამოსხმული ლოტი არ არის' : 'No bottled lots available'}</option>}
                    {finishedGoodsLots.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  {finishedGoodsLots.length === 0 && (
                    <p role="status" className="mt-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                      {ka ? 'ჯერ დააფიქსირეთ ჩამოსხმა; დაუმუშავებელი ღვინო ბოთლების საწყობში ვერ განთავსდება.' : 'Record a bottling run first; bulk wine cannot be placed in finished-goods storage.'}
                    </p>
                  )}
                </div>
                {mAction === 'receive' && (
                  <div>
                    <label className={labelCls}>{ka ? 'ჩამოსხმის წყარო' : 'Bottling source'}</label>
                    <select value={mRun} onChange={event => setMRun(event.target.value)} disabled={formLocked || receiveRunsForLot.length === 0} className={inputCls}>
                      {receiveRunsForLot.length === 0 && <option value="">{ka ? 'განსათავსებელი გამოშვება არ არის' : 'No unplaced run for this lot'}</option>}
                      {receiveRunsForLot.map(run => (
                        <option key={run.id} value={run.id}>
                          {run.lotNumber || run.id} · {bottlingRunUnplacedUnits(run, movements).toLocaleString()} {ka ? 'ერთ.' : 'units left'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {mAction === 'adjust' && (
                  <>
                    <div className="inline-flex rounded-lg border border-stone-200 overflow-hidden w-full dark:border-stone-800">
                      {([{ id: 'out', ka: 'შემცირება', en: 'Decrease' }, { id: 'in', ka: 'გაზრდა', en: 'Increase' }] as const).map(option => (
                        <button type="button" key={option.id} onClick={() => setMDir(option.id)} disabled={formLocked}
                          className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase cursor-pointer disabled:cursor-not-allowed ${mDir === option.id ? (option.id === 'in' ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white') : 'bg-stone-50 text-stone-500 dark:bg-stone-900'}`}>
                          {ka ? option.ka : option.en}
                        </button>
                      ))}
                    </div>
                    <div><label className={labelCls}>{ka ? 'კორექტირების მიზეზი' : 'Adjustment reason'}</label><input value={mReason} onChange={event => setMReason(event.target.value)} disabled={formLocked} maxLength={200} className={inputCls} /></div>
                  </>
                )}
                <div>
                  <label className={labelCls}>{mAction === 'relocate' ? (ka ? 'საწყისი ლოკაცია' : 'Source location') : (ka ? 'ლოკაცია' : 'Location')}</label>
                  <select value={mLoc} onChange={e => setMLoc(e.target.value)} disabled={formLocked} className={inputCls}><option value="">{ka ? 'აირჩიეთ' : 'Select…'}</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                </div>
                {mAction === 'relocate' && (
                  <div>
                    <label className={labelCls}>{ka ? 'დანიშნულების ლოკაცია' : 'Destination location'}</label>
                    <select value={mDest} onChange={event => setMDest(event.target.value)} disabled={formLocked} className={inputCls}>
                      <option value="">{ka ? 'აირჩიეთ' : 'Select…'}</option>
                      {locations.filter(location => location.id !== mLoc).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
                    </select>
                  </div>
                )}
                <div><label className={labelCls}>{ka ? 'შენიშვნა' : 'Note'}</label><input value={mNote} onChange={event => setMNote(event.target.value)} disabled={formLocked} maxLength={500} className={inputCls} placeholder={ka ? 'არასავალდებულო' : 'Optional operational context'} /></div>
                <button onClick={submitMove} disabled={isSubmitting || (!pendingIntent && !canMove)} className="w-full px-4 py-2 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer">
                  {isSubmitting ? (ka ? 'იგზავნება…' : 'Recording…') : pendingIntent ? (ka ? 'იგივე ბრძანების აღდგენა' : 'Recover same command') : (ka ? 'დაფიქსირება' : 'Record')}
                </button>
                {(mAction === 'relocate' || (mAction === 'adjust' && mDir === 'out')) && mLoc && mLot && (
                  <div className="text-[11px] font-mono border border-stone-200 rounded-xl p-3 bg-stone-50/60 space-y-1 dark:bg-stone-950/40 dark:border-stone-800">
                    <div className="flex justify-between"><span>{ka ? 'საწყობში' : 'On hand'}</span><strong>{selectedPosition.onHandBottles.toLocaleString()} btl</strong></div>
                    <div className="flex justify-between"><span>{ka ? 'რეზერვში' : 'Reserved'}</span><strong className="text-blue-700 dark:text-blue-300">{selectedPosition.reservedBottles.toLocaleString()} btl</strong></div>
                    <div className="flex justify-between"><span>{ka ? 'ხელმისაწვდომი გასაცემად' : 'Available for outbound'}</span><strong className="text-emerald-700 dark:text-emerald-400">{selectedPosition.availableBottles.toLocaleString()} btl</strong></div>
                  </div>
                )}
                {overAvailableForOut && (
                  <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-2">
                    <LockKeyhole className="w-3.5 h-3.5" />
                    {ka ? 'რაოდენობა აჭარბებს არარეზერვირებულ ხელმისაწვდომ მარაგს.' : 'Quantity exceeds unreserved available stock. Reserved bottles are protected.'}
                  </div>
                )}
              </>
            )}
          </div>
          )}
        </div>}

        {/* Stock by location */}
        <div className="space-y-4">
          {locations.length === 0 ? (
            <div className="bg-white border border-dashed border-[#e8dfd5] rounded-2xl p-12 text-center text-stone-400 dark:bg-stone-900 dark:border-stone-800">
              <Warehouse className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-xs font-bold">
                {canCreateLocation
                  ? (ka ? 'დაამატეთ პირველი ლოკაცია' : 'Add your first storage location')
                  : (ka ? 'შენახვის ლოკაციები ჯერ არ არის' : 'No storage locations yet')}
              </p>
              <p className="mt-1 text-[11px] text-stone-400">
                {canCreateLocation
                  ? (ka ? 'ჩამოსხმული მარაგის განთავსებამდე საჭიროა შენახვის ადგილი.' : 'Create a place to receive bottled stock, or return to bottling first.')
                  : (ka ? 'ლოკაციის დამატება შეუძლია შესაბამისი წვდომის მქონე გუნდის წევრს.' : 'A team member with storage access can add the first location.')}
              </p>
              <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate?.({ module: 'gvino', tab: 'bottling' })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-stone-700 hover:bg-stone-50 dark:bg-stone-950 dark:border-stone-800 dark:text-stone-200"
                >
                  <PackagePlus className="w-3.5 h-3.5" /> {ka ? 'ჩამოსხმა' : 'Open bottling'}
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate?.({ module: 'sales' })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#4e0e15] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-50 hover:bg-[#34070a]"
                >
                  <Boxes className="w-3.5 h-3.5" /> {ka ? 'გაყიდვები' : 'Open sales'}
                </button>
              </div>
            </div>
          ) : locations.map(loc => {
            const s = stock.get(loc.id);
            const u = utilization(s, loc);
            const lotEntries = s ? Object.entries(s.byLot) : [];
            const deletionReferences = locationDeletionReferences.get(loc.id);
            const deletionLocked = Boolean(deletionReferences && deletionReferences.total > 0);
            const deletionReason = deletionReferences && deletionLocked
              ? locationDeletionReason(deletionReferences, ka)
              : '';
            return (
              <div key={loc.id} className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
                <div className="px-4 py-3 border-b border-[#e8dfd5] dark:border-stone-800 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-serif font-bold text-[#4e0e15] dark:text-amber-100">{loc.name}</span>
                    <span className="ml-2 text-[9px] font-mono uppercase text-stone-400">{typeLabel(loc.type, ka)}</span>
                    <div className="flex items-center gap-3 mt-0.5 text-[9px] font-mono text-stone-400">
                      {loc.targetTempC != null && <span className="flex items-center gap-0.5"><Thermometer className="w-3 h-3" />{loc.targetTempC}°C</span>}
                      {loc.targetHumidity != null && <span className="flex items-center gap-0.5"><Droplet className="w-3 h-3" />{loc.targetHumidity}%</span>}
                    </div>
                  </div>
                  {canDeleteLocation && (
                    <button
                      type="button"
                      onClick={() => deleteLocation(loc.id)}
                      disabled={deletionLocked}
                      title={deletionLocked ? deletionReason : (ka ? `${loc.name} ლოკაციის წაშლა` : `Delete location ${loc.name}`)}
                      aria-label={ka ? `${loc.name} ლოკაციის წაშლა` : `Delete location ${loc.name}`}
                      className="text-stone-300 hover:text-rose-600 disabled:text-amber-500 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {deletionLocked ? <LockKeyhole className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
                {canDeleteLocation && deletionLocked && (
                  <div role="status" className="flex items-start gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[10px] font-semibold leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                    <LockKeyhole className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{deletionReason}</span>
                  </div>
                )}
                {overDestinationCapacity && (
                  <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-2">
                    <LockKeyhole className="w-3.5 h-3.5" /> {ka ? 'დანიშნულების ლოკაციას საკმარისი ტევადობა არ აქვს.' : 'Destination capacity is too small for this movement.'}
                  </div>
                )}
                {mAction === 'receive' && selectedRun && (
                  <p className="text-[10px] text-stone-500">{ka ? 'გამოშვებაში დარჩენილია' : 'Unplaced in selected run'}: <strong>{selectedRunRemaining.toLocaleString()}</strong></p>
                )}
                {commandError && (
                  <div role="alert" className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{commandError}</div>
                )}
                <div className="p-4 space-y-3">
                  {/* capacity bar */}
                  <div>
                    <div className="flex justify-between text-[10px] font-mono text-stone-500 mb-1">
                      <span>{u.used.toLocaleString()} {ka ? 'ბოთლი' : 'bottles'}</span>
                      {u.capacity != null && <span className={u.over ? 'text-rose-600 font-bold' : ''}>{u.pct}% {ka ? 'სავსე' : 'full'}{u.over ? ` · ${ka ? 'გადავსება!' : 'over!'}` : ''}</span>}
                    </div>
                    {u.capacity != null && (
                      <div className="h-2 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${u.over ? 'bg-rose-500' : 'bg-emerald-600'}`} style={{ width: `${Math.min(100, u.pct || 0)}%` }} />
                      </div>
                    )}
                  </div>
                  {lotEntries.length === 0 ? (
                    <p className="text-[11px] text-stone-400 italic">{ka ? 'ცარიელია' : 'Empty'}</p>
                  ) : (
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="text-[9px] uppercase font-mono text-stone-400">
                          <th className="py-1.5 font-bold">{ka ? 'ლოტი' : 'Lot'}</th>
                          <th className="py-1.5 text-right font-bold">{ka ? 'საწყობში' : 'On hand'}</th>
                          <th className="py-1.5 text-right font-bold">{ka ? 'რეზერვი' : 'Reserved'}</th>
                          <th className="py-1.5 text-right font-bold">{ka ? 'ხელმისაწვ.' : 'Available'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                        {lotEntries.map(([lotId, n]) => {
                          const pos = stockAvailabilityPosition({
                            onHandBottles: n,
                            orders,
                            locationId: loc.id,
                            lotId,
                            asOfDate: today,
                          });
                          return (
                            <tr key={lotId}>
                              <td className="py-1.5 text-stone-700 dark:text-amber-50">{lotName(lotId)}</td>
                              <td className="py-1.5 text-right font-mono font-bold text-[#4e0e15] dark:text-amber-300">{pos.onHandBottles.toLocaleString()}</td>
                              <td className="py-1.5 text-right font-mono font-bold text-blue-700 dark:text-blue-300">{pos.reservedBottles.toLocaleString()}</td>
                              <td className="py-1.5 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">{pos.availableBottles.toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })}

          {/* Recent movements */}
          {movements.length > 0 && (
            <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
              <div className="px-4 py-3 border-b border-[#e8dfd5] dark:border-stone-800"><span className="text-xs font-bold text-stone-700 dark:text-amber-100">{ka ? 'ბოლო მოძრაობები' : 'Recent movements'}</span></div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                    {movements.slice(0, 30).map(m => {
                      const blockers = movementDeletionGuards.get(m.id);
                      const deletionLocked = Boolean(blockers?.blocked);
                      const deletionReason = blockers && deletionLocked ? movementDeletionReason(blockers, ka) : '';
                      return (
                        <tr key={m.id} className="hover:bg-stone-50/50 dark:hover:bg-white/5">
                          <td className="p-2.5 font-mono text-stone-500">{m.date}</td>
                          <td className="p-2.5 text-stone-700 dark:text-amber-50">
                            <span>{lotName(m.lotId)}</span>
                            {canDeleteMovement && deletionLocked && (
                              <span className="mt-1 flex max-w-sm items-start gap-1 text-[9px] font-semibold leading-relaxed text-amber-700 dark:text-amber-300">
                                <LockKeyhole className="mt-0.5 h-2.5 w-2.5 shrink-0" /> {deletionReason}
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 text-stone-500">{locations.find(l => l.id === m.locationId)?.name || '—'}</td>
                          <td className={`p-2.5 text-right font-mono font-bold ${m.direction === 'in' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}`}>{m.direction === 'in' ? '+' : '−'}{m.bottles}</td>
                          {canDeleteMovement && (
                            <td className="p-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => deleteMovement(m.id)}
                                disabled={deletionLocked}
                                title={deletionLocked ? deletionReason : (ka ? `${m.date} მოძრაობის წაშლა` : `Delete movement ${m.date}`)}
                                aria-label={ka ? `${m.date} მოძრაობის წაშლა` : `Delete movement ${m.date}`}
                                className="text-stone-300 hover:text-rose-600 disabled:text-amber-500 disabled:cursor-not-allowed cursor-pointer"
                              >
                                {deletionLocked ? <LockKeyhole className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
