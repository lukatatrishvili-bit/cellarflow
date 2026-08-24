import React from 'react';
import { AlertOctagon, CheckCircle2, PackageX, Search, ShieldAlert, Truck, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Language } from '../lib/language';
import type {
  BottlingRunRecord,
  CellarOperation,
  CellarTransferRecord,
  GrapeIntakeRecord,
  HarvestRecord,
  SalesDispatchRecord,
  SalesOrderRecord,
  Task,
  TaskAssignmentInput,
  Vessel,
  WineLot,
} from '../lib/wineryState';
import type { StockMovement, StorageLocation } from '../lib/storage';
import {
  advanceRecallCase,
  buildRecallTrace,
  recallContainmentProgress,
  type RecallCase,
  type RecallCaseStatus,
} from '../lib/operationsControl';

interface RecallCockpitTabProps {
  lang: Language;
  currentUsername: string;
  currentUserName: string;
  lots: WineLot[];
  grapeIntakes: GrapeIntakeRecord[];
  harvests: HarvestRecord[];
  vessels: Vessel[];
  bottlingRuns: BottlingRunRecord[];
  cellarOps: CellarOperation[];
  transfers: CellarTransferRecord[];
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
  salesOrders: SalesOrderRecord[];
  salesDispatches: SalesDispatchRecord[];
  tasks: Task[];
  recallCases: RecallCase[];
  focusCaseId?: string;
  onUpdateRecallCases: React.Dispatch<React.SetStateAction<RecallCase[]>>;
  onAddTask: (
    title: string,
    priority: 'high' | 'medium' | 'low',
    dueDate: string,
    description: string,
    assignment?: TaskAssignmentInput,
  ) => Task | void;
  canManage: boolean;
  canCreateTasks: boolean;
  setToastMessage?: (message: string | null) => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

export default function RecallCockpitTab(props: RecallCockpitTabProps) {
  const ka = props.lang === 'ka';
  const [lotId, setLotId] = React.useState(props.lots[0]?.id || '');
  const [query, setQuery] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [selectedCaseId, setSelectedCaseId] = React.useState('');
  const filteredLots = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return props.lots.filter(lot => !needle || `${lot.id} ${lot.name} ${lot.variety}`.toLowerCase().includes(needle));
  }, [props.lots, query]);
  const trace = React.useMemo(() => buildRecallTrace({
    lotId,
    lots: props.lots,
    grapeIntakes: props.grapeIntakes,
    harvests: props.harvests,
    vessels: props.vessels,
    bottlingRuns: props.bottlingRuns,
    cellarOps: props.cellarOps,
    transfers: props.transfers,
    storageLocations: props.storageLocations,
    stockMovements: props.stockMovements,
    salesOrders: props.salesOrders,
    salesDispatches: props.salesDispatches,
  }), [lotId, props.bottlingRuns, props.cellarOps, props.grapeIntakes, props.harvests, props.lots, props.salesDispatches, props.salesOrders, props.stockMovements, props.storageLocations, props.transfers, props.vessels]);
  const selectedCase = props.recallCases.find(item => item.id === selectedCaseId)
    || props.recallCases.find(item => item.lotId === lotId && item.status !== 'closed');
  const containmentProgress = selectedCase ? recallContainmentProgress(selectedCase, props.tasks) : null;

  React.useEffect(() => {
    if (!lotId && props.lots[0]) setLotId(props.lots[0].id);
  }, [lotId, props.lots]);

  React.useEffect(() => {
    if (!props.focusCaseId) return;
    const focused = props.recallCases.find(item => item.id === props.focusCaseId);
    if (!focused) return;
    setSelectedCaseId(focused.id);
    setLotId(focused.lotId);
  }, [props.focusCaseId, props.recallCases]);

  const openCase = () => {
    if (!trace || !reason.trim()) {
      props.setToastMessage?.(ka ? 'აირჩიეთ პარტია და მიუთითეთ მიზეზი.' : 'Select a lot and enter the recall reason.');
      return;
    }
    if (!props.canCreateTasks) {
      props.setToastMessage?.(ka ? 'გაწვევის საქმისთვის შეკავების დავალებების შექმნის უფლებაა საჭირო.' : 'Opening a recall requires permission to create its containment tasks.');
      return;
    }
    const openedAt = now();
    const id = `recall-${openedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${trace.lot.id}`;
    const tasks: Task[] = [];
    if (props.canCreateTasks) {
      const taskSpecs: Array<[string, string]> = [
        [`Quarantine ${trace.lot.id}`, `Stop release and physically quarantine all stock for ${trace.lot.name}. Recall case: ${id}.`],
        [`Reconcile recalled stock · ${trace.lot.id}`, `Count bottled, stored, and dispatched units for recall case ${id}.`],
        [`Contact affected customers · ${trace.lot.id}`, `${trace.affectedCustomers.length} customer(s) identified for recall case ${id}.`],
      ];
      for (const [title, description] of taskSpecs) {
        const created = props.onAddTask(title, 'high', today(), description, {
          assignedUserId: props.currentUsername,
          assignedTo: props.currentUserName,
        });
        if (created) tasks.push(created);
      }
    }
    const recall: RecallCase = {
      id,
      lotId: trace.lot.id,
      title: `Recall · ${trace.lot.id}`,
      reason: reason.trim(),
      status: 'active',
      openedAt,
      openedBy: props.currentUsername,
      affectedBottlingRunIds: trace.bottlingRuns.map(item => item.id),
      affectedOrderIds: trace.orders.map(item => item.id),
      affectedDispatchIds: trace.dispatches.map(item => item.id),
      containmentTaskIds: tasks.map(item => item.id),
      notes: notes.trim(),
    };
    props.onUpdateRecallCases(current => [recall, ...current]);
    setSelectedCaseId(id);
    setReason('');
    setNotes('');
    props.setToastMessage?.(ka ? 'გაწვევის საქმე გაიხსნა და შეკავების დავალებები შეიქმნა.' : 'Recall case opened and containment tasks created.');
  };

  const updateCaseStatus = (status: RecallCaseStatus) => {
    if (!selectedCase || selectedCase.status === 'closed') return;
    try {
      const updated = advanceRecallCase(selectedCase, status, {
        actor: props.currentUsername,
        tasks: props.tasks,
      });
      props.onUpdateRecallCases(current => current.map(item => item.id === selectedCase.id ? updated : item));
      props.setToastMessage?.(status === 'closed' ? 'Recall case closed with completed containment evidence.' : 'Recall exposure is contained; closure is now available.');
    } catch (error) {
      props.setToastMessage?.(error instanceof Error ? error.message : 'Recall status could not be changed.');
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-rose-700 dark:text-rose-300"><ShieldAlert className="h-4 w-4" />{ka ? 'გაწვევა და შეკავება' : 'Recall and containment'}</div>
        <h2 className="mt-2 font-serif text-3xl font-semibold text-stone-950 dark:text-white">{ka ? 'პარტიის კვალის სწრაფი კონტროლი' : 'Lot containment cockpit'}</h2>
      </header>

      <section className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <label className="text-[10px] font-black uppercase tracking-wider text-stone-500">{ka ? 'პარტიის ძებნა' : 'Find a lot'}</label>
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-stone-200 px-3 dark:border-stone-700"><Search className="h-4 w-4 text-stone-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Lot, wine, variety" className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>
          <div className="mt-3 max-h-72 space-y-1 overflow-auto">
            {filteredLots.map(lot => <button key={lot.id} type="button" onClick={() => { setLotId(lot.id); setSelectedCaseId(''); }} className={`w-full rounded-xl p-3 text-left text-xs ${lotId === lot.id ? 'bg-[#651522] text-white' : 'bg-stone-50 text-stone-700 hover:bg-stone-100 dark:bg-stone-950 dark:text-stone-200'}`}><strong className="block">{lot.id}</strong><span className="mt-1 block opacity-75">{lot.name} · {lot.vintage} · {lot.currentVolume.toLocaleString()} L</span></button>)}
          </div>
          {props.recallCases.length > 0 && <div className="mt-5 border-t border-stone-200 pt-4 dark:border-stone-800"><div className="mb-2 text-[10px] font-black uppercase text-stone-500">{ka ? 'საქმეები' : 'Cases'}</div>{props.recallCases.slice(0, 20).map(item => <button key={item.id} type="button" onClick={() => { setSelectedCaseId(item.id); setLotId(item.lotId); }} className="mb-1 flex w-full items-center justify-between rounded-lg bg-stone-50 p-2 text-left text-[11px] dark:bg-stone-950"><span>{item.title}</span><span className="uppercase text-stone-500">{item.status}</span></button>)}</div>}
        </div>

        <div className="space-y-5">
          {!trace ? <div className="rounded-2xl border border-dashed border-stone-300 p-12 text-center text-sm text-stone-500 dark:border-stone-700">{ka ? 'აირჩიეთ პარტია.' : 'Select a lot to calculate exposure.'}</div> : <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {([
                [ka ? 'ჩამოსხმული პარტიები' : 'Bottling runs', trace.bottlingRuns.length, PackageX],
                [ka ? 'გაგზავნილი ბოთლი' : 'Bottles dispatched', trace.affectedBottleCount, Truck],
                [ka ? 'მომხმარებელი' : 'Customers', trace.affectedCustomers.length, Users],
                [ka ? 'საცავი/ჭურჭელი' : 'Storage / vessels', trace.storageLocations.length + trace.vessels.length, AlertOctagon],
              ] satisfies Array<[string, number, LucideIcon]>).map(([label, value, Icon]) => <div key={String(label)} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"><Icon className="h-5 w-5 text-rose-700 dark:text-rose-300" /><strong className="mt-3 block text-2xl">{String(value)}</strong><span className="text-[10px] font-bold uppercase text-stone-500">{String(label)}</span></div>)}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"><h3 className="text-xs font-black uppercase tracking-wider">{ka ? 'წარმოშობა' : 'Upstream origin'}</h3><div className="mt-3 space-y-2 text-xs text-stone-600 dark:text-stone-300"><p><strong>{trace.intakes.length}</strong> intake record(s)</p><p><strong>{trace.harvests.length}</strong> harvest record(s)</p><p><strong>{trace.lot.vineyardBlock || '—'}</strong> vineyard block</p><p>{trace.lot.variety} · {trace.lot.region}</p></div></div>
              <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"><h3 className="text-xs font-black uppercase tracking-wider">{ka ? 'გავრცელება' : 'Downstream exposure'}</h3><div className="mt-3 space-y-2 text-xs text-stone-600 dark:text-stone-300"><p><strong>{trace.affectedLots.length}</strong> affected lot(s)</p><p><strong>{trace.orders.length}</strong> sales order(s)</p><p><strong>{trace.dispatches.length}</strong> active dispatch(es)</p><p><strong>{trace.stockMovements.length}</strong> stock movement(s)</p><p className="break-words">{trace.affectedCustomers.join(', ') || (ka ? 'მომხმარებელი არ არის' : 'No dispatched customers')}</p></div></div>
            </div>
          </>}

          {selectedCase && containmentProgress && <div className="rounded-2xl border border-stone-200 bg-white p-4 text-xs dark:border-stone-800 dark:bg-stone-900"><div className="flex items-center justify-between gap-3"><strong>{ka ? 'შეკავების მზადყოფნა' : 'Containment readiness'}</strong><span className={containmentProgress.ready ? 'font-black text-emerald-700 dark:text-emerald-300' : 'font-black text-amber-700 dark:text-amber-300'}>{containmentProgress.completed}/{containmentProgress.total}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"><div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${containmentProgress.total ? (containmentProgress.completed / containmentProgress.total) * 100 : 0}%` }} /></div><p className="mt-2 text-stone-500">{containmentProgress.ready ? (ka ? 'ყველა შეკავების დავალება დასრულებულია.' : 'All containment tasks are complete; advance the case in order.') : (ka ? 'საქმის შეკავებამდე და დახურვამდე დაასრულეთ ყველა დავალება.' : 'Complete every containment task before containing or closing the case.')}</p></div>}

          {selectedCase ? <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5 dark:border-rose-900 dark:bg-rose-950/20">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] font-black uppercase text-rose-700 dark:text-rose-300">{selectedCase.status}</div><h3 className="mt-1 text-lg font-bold">{selectedCase.title}</h3><p className="mt-1 text-xs text-stone-600 dark:text-stone-300">{selectedCase.reason}</p></div><CheckCircle2 className="h-7 w-7 text-rose-700" /></div>
            {selectedCase.status === 'active' && <button type="button" disabled={!props.canManage || !containmentProgress?.ready} onClick={() => updateCaseStatus('contained')} className="mt-4 min-h-11 w-full rounded-xl bg-amber-700 px-4 text-xs font-black text-white disabled:opacity-40">{ka ? 'საქმის შეკავებულად მონიშვნა' : 'Mark exposure contained'}</button>}
            {selectedCase.status === 'contained' && <button type="button" disabled={!props.canManage || !containmentProgress?.ready} onClick={() => updateCaseStatus('closed')} className="mt-4 min-h-11 w-full rounded-xl bg-emerald-700 px-4 text-xs font-black text-white disabled:opacity-40">{ka ? 'საქმის დახურვა' : 'Close recall case'}</button>}
            <p className="mt-3 text-[10px] text-stone-500">{selectedCase.containmentTaskIds.length} containment task(s) · opened {new Date(selectedCase.openedAt).toLocaleString()}</p>
          </div> : props.canManage && trace && <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"><h3 className="text-sm font-black">{ka ? 'შეკავების დაწყება' : 'Launch containment'}</h3><div className="mt-4 grid gap-3"><input value={reason} onChange={event => setReason(event.target.value)} maxLength={300} placeholder={ka ? 'გაწვევის მიზეზი' : 'Recall reason'} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm outline-none dark:border-stone-700 dark:bg-stone-950" /><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} placeholder={ka ? 'დამატებითი შენიშვნები' : 'Containment notes (optional)'} className="min-h-24 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm outline-none dark:border-stone-700 dark:bg-stone-950" />{!props.canCreateTasks && <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{ka ? 'საქმის გასახსნელად საჭიროა დავალებების შექმნის უფლება.' : 'Task-creation permission is required to open a recall case.'}</p>}<button type="button" disabled={!props.canCreateTasks} onClick={openCase} className="min-h-12 rounded-xl bg-rose-700 px-4 text-sm font-black text-white disabled:opacity-40">{ka ? 'გაწვევის საქმის გახსნა' : 'Open recall case'}</button></div></div>}
        </div>
      </section>
    </div>
  );
}
