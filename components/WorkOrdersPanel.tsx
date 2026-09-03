import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Layers,
  Play,
  Repeat,
  Trash,
  TriangleAlert,
} from 'lucide-react';
import type { Language } from '../lib/language';
import type { ProductionPlanItem } from '../lib/operationsControl';
import type { CellarOperationType, Vessel, WineLot } from '../lib/wineryState';
import { QUICK_CELLAR_OPERATIONS } from '../lib/wineryOperations';
import { createUniqueRecordId } from '../lib/recordIds';
import {
  expandWorkOrderTemplate,
  nextWorkOrderItem,
  outstandingOccurrences,
  workOrderProgress,
  type WorkOrder,
  type WorkOrderTemplate,
} from '../lib/workOrders';

/**
 * Work orders: the container that lets a winemaker hand someone a morning.
 *
 * Assigning six barrels of topping used to mean six separate plan items with
 * six assignees, and a cellar hand looking at six unrelated rows. An order
 * names the batch once. Its progress is derived from the items rather than
 * stored, so it cannot disagree with the work actually recorded — the same rule
 * the fulfilment loop follows.
 */

interface WorkOrdersPanelProps {
  lang: Language;
  currentUsername: string;
  orders: WorkOrder[];
  templates: WorkOrderTemplate[];
  productionPlans: ProductionPlanItem[];
  vessels: Vessel[];
  lots: WineLot[];
  assignees: string[];
  canCreate: boolean;
  canDelete: boolean;
  onRaiseOrder: (order: WorkOrder, items: ProductionPlanItem[]) => void;
  onDeleteOrder: (orderId: string) => void;
  onSaveTemplate?: (template: WorkOrderTemplate) => void;
  /** Opens the recorder for a plan item — the same path a task's "Record it" takes. */
  onWorkItem?: (item: ProductionPlanItem) => void;
  setToastMessage?: (message: string | null) => void;
}

/** How far ahead a recurring template is asked what it owes. */
const RECURRENCE_HORIZON_DAYS = 21;

/**
 * Templates may only carry operations the planner can actually open. Dedicated
 * operations (racking, blending, bottling…) have their own workflows and are
 * excluded from `QUICK_CELLAR_OPERATIONS` for that reason.
 */
const DEFAULT_TEMPLATE_OPERATION: CellarOperationType = QUICK_CELLAR_OPERATIONS[0].key;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function WorkOrdersPanel({
  lang,
  currentUsername,
  orders,
  templates,
  productionPlans,
  vessels,
  lots,
  assignees,
  canCreate,
  canDelete,
  onRaiseOrder,
  onDeleteOrder,
  onSaveTemplate,
  onWorkItem,
  setToastMessage,
}: WorkOrdersPanelProps) {
  const ka = lang === 'ka';
  const [templateId, setTemplateId] = useState('');
  const [dueDate, setDueDate] = useState(todayISO);
  const [assignedTo, setAssignedTo] = useState(currentUsername);
  const [selectedVessels, setSelectedVessels] = useState<string[]>([]);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftOperation, setDraftOperation] = useState<CellarOperationType>(DEFAULT_TEMPLATE_OPERATION);
  const [draftEvery, setDraftEvery] = useState('1');
  const [draftUnit, setDraftUnit] = useState<'day' | 'week' | 'none'>('week');

  const planById = useMemo(
    () => new Map(productionPlans.map(item => [item.id, item])),
    [productionPlans],
  );

  const rows = useMemo(() => orders
    .map(order => ({ order, progress: workOrderProgress(order, productionPlans) }))
    .sort((a, b) => {
      // Open work first, then by the date it is due — an order that is finished
      // is a record, not a job.
      const aDone = a.progress.status === 'completed' ? 1 : 0;
      const bDone = b.progress.status === 'completed' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return a.order.dueDate.localeCompare(b.order.dueDate);
    }), [orders, productionPlans]);

  const selectedTemplate = templates.find(entry => entry.id === templateId);

  const owed = useMemo(() => templates.flatMap(template => outstandingOccurrences({
    template,
    orders,
    from: todayISO(),
    horizonDays: RECURRENCE_HORIZON_DAYS,
  }).map(date => ({ template, date }))), [templates, orders]);

  const toggleVessel = (vesselId: string) => setSelectedVessels(current => (
    current.includes(vesselId)
      ? current.filter(entry => entry !== vesselId)
      : [...current, vesselId]
  ));

  const raise = (template: WorkOrderTemplate, date: string) => {
    if (!selectedVessels.length) {
      setToastMessage?.(ka
        ? 'აირჩიეთ მინიმუმ ერთი ჭურჭელი.'
        : 'Choose at least one vessel for this work.');
      return;
    }
    const expanded = expandWorkOrderTemplate({
      template,
      dueDate: date,
      assignedTo,
      targets: selectedVessels.map(vesselId => {
        const vessel = vessels.find(entry => entry.id === vesselId);
        return vessel?.assignedLotId ? { vesselId, lotId: vessel.assignedLotId } : { vesselId };
      }),
      createdBy: currentUsername,
      now: new Date().toISOString(),
      existingPlanIds: productionPlans.map(item => item.id),
      existingOrderIds: orders.map(order => order.id),
    });
    onRaiseOrder(expanded.order, expanded.items);
    setSelectedVessels([]);
    setToastMessage?.(ka
      ? `სამუშაო ორდერი შეიქმნა — ${expanded.items.length} პუნქტი.`
      : `Work order raised — ${expanded.items.length} item${expanded.items.length === 1 ? '' : 's'}.`);
  };

  const saveTemplate = () => {
    const title = draftTitle.trim();
    if (!title || !onSaveTemplate) return;
    const every = Number.parseInt(draftEvery, 10);
    const operation = QUICK_CELLAR_OPERATIONS.find(entry => entry.key === draftOperation);
    onSaveTemplate({
      id: createUniqueRecordId('wotpl', templates.map(entry => entry.id)),
      title,
      items: [{
        title: operation ? (ka ? operation.ka : operation.en) : title,
        kind: 'other',
        operationType: draftOperation,
        dayOffset: 0,
        notes: '',
      }],
      ...(draftUnit !== 'none' && Number.isInteger(every) && every > 0
        ? { recurrence: { every, unit: draftUnit } }
        : {}),
      createdAt: new Date().toISOString(),
      createdBy: currentUsername,
    });
    setDraftTitle('');
    setShowTemplateEditor(false);
    setToastMessage?.(ka ? 'შაბლონი შენახულია.' : 'Template saved.');
  };

  return (
    <div className="space-y-4">
      {canCreate && onSaveTemplate && (
        <section className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
          <button
            type="button"
            onClick={() => setShowTemplateEditor(open => !open)}
            aria-expanded={showTemplateEditor}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-stone-600 dark:text-stone-300">
              <Repeat className="h-3.5 w-3.5 text-[#651522] dark:text-amber-300" />
              {ka ? 'ახალი შაბლონი' : 'New template'}
            </span>
            <span className="text-[10px] font-bold text-stone-400">{showTemplateEditor ? '–' : '+'}</span>
          </button>

          {showTemplateEditor && (
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-stone-500">
                  {ka ? 'დასახელება' : 'Name'}
                </span>
                <input
                  value={draftTitle}
                  onChange={event => setDraftTitle(event.target.value)}
                  placeholder={ka ? 'მაგ. ყოველკვირეული შევსება' : 'e.g. Weekly topping'}
                  className="min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-2 text-xs font-bold dark:border-stone-700 dark:bg-stone-950"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-stone-500">
                  {ka ? 'ოპერაცია' : 'Operation'}
                </span>
                <select
                  value={draftOperation}
                  onChange={event => setDraftOperation(event.target.value as CellarOperationType)}
                  className="min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-2 text-xs font-bold dark:border-stone-700 dark:bg-stone-950"
                >
                  {QUICK_CELLAR_OPERATIONS.map(entry => (
                    <option key={entry.key} value={entry.key}>{ka ? entry.ka : entry.en}</option>
                  ))}
                </select>
              </label>
              <div>
                <span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-stone-500">
                  {ka ? 'გამეორება' : 'Repeats'}
                </span>
                <div className="flex gap-1">
                  <input
                    type="number"
                    min={1}
                    value={draftEvery}
                    onChange={event => setDraftEvery(event.target.value)}
                    disabled={draftUnit === 'none'}
                    aria-label={ka ? 'ინტერვალი' : 'Interval'}
                    className="min-h-10 w-14 rounded-lg border border-stone-200 bg-stone-50 px-2 text-xs font-bold disabled:opacity-40 dark:border-stone-700 dark:bg-stone-950"
                  />
                  <select
                    value={draftUnit}
                    onChange={event => setDraftUnit(event.target.value as 'day' | 'week' | 'none')}
                    aria-label={ka ? 'პერიოდი' : 'Period'}
                    className="min-h-10 min-w-0 flex-1 rounded-lg border border-stone-200 bg-stone-50 px-2 text-xs font-bold dark:border-stone-700 dark:bg-stone-950"
                  >
                    <option value="none">{ka ? 'არა' : 'Never'}</option>
                    <option value="day">{ka ? 'დღე' : 'Days'}</option>
                    <option value="week">{ka ? 'კვირა' : 'Weeks'}</option>
                  </select>
                </div>
              </div>
              <button
                type="button"
                disabled={!draftTitle.trim()}
                onClick={saveTemplate}
                className="min-h-10 rounded-lg bg-[#4e0e15] px-4 text-[11px] font-black text-amber-50 enabled:hover:bg-[#651522] disabled:opacity-40 sm:col-span-4 sm:justify-self-start"
              >
                {ka ? 'შაბლონის შენახვა' : 'Save template'}
              </button>
            </div>
          )}
        </section>
      )}
      {canCreate && templates.length > 0 && (
        <section className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-stone-700 dark:text-stone-200">
            <ClipboardList className="h-4 w-4 text-[#651522] dark:text-amber-300" />
            {ka ? 'ორდერის შექმნა შაბლონიდან' : 'Raise an order from a template'}
          </h3>
          <p className="mt-1 text-[10px] text-stone-500 dark:text-stone-400">
            {ka
              ? 'შაბლონი აღწერს სამუშაოს, ჭურჭელს კი ორდერის შექმნისას ირჩევთ.'
              : 'The template describes the work; you pick the vessels it applies to now.'}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-stone-500">
                {ka ? 'შაბლონი' : 'Template'}
              </span>
              <select
                value={templateId}
                onChange={event => setTemplateId(event.target.value)}
                className="min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-2 text-xs font-bold dark:border-stone-700 dark:bg-stone-950"
              >
                <option value="">{ka ? 'აირჩიეთ…' : 'Choose…'}</option>
                {templates.map(template => (
                  <option key={template.id} value={template.id}>{template.title}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-stone-500">
                {ka ? 'ვადა' : 'Due'}
              </span>
              <input
                type="date"
                value={dueDate}
                onChange={event => setDueDate(event.target.value)}
                className="min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-2 text-xs font-bold dark:border-stone-700 dark:bg-stone-950"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-stone-500">
                {ka ? 'შემსრულებელი' : 'Assignee'}
              </span>
              <select
                value={assignedTo}
                onChange={event => setAssignedTo(event.target.value)}
                className="min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-2 text-xs font-bold dark:border-stone-700 dark:bg-stone-950"
              >
                {[currentUsername, ...assignees.filter(name => name !== currentUsername)].map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3">
            <span className="mb-1.5 block text-[9px] font-black uppercase tracking-wider text-stone-500">
              {ka ? 'ჭურჭელი' : 'Vessels'} · {selectedVessels.length}
            </span>
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
              {vessels.map(vessel => {
                const active = selectedVessels.includes(vessel.id);
                const lot = lots.find(entry => entry.id === vessel.assignedLotId);
                return (
                  <button
                    key={vessel.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleVessel(vessel.id)}
                    title={lot ? lot.name : (ka ? 'ცარიელი' : 'Empty')}
                    className={'min-h-8 rounded-lg border px-2.5 text-[10px] font-bold transition-colors ' + (active
                      ? 'border-[#651522] bg-[#651522] text-amber-50'
                      : 'border-stone-200 bg-stone-50 text-stone-600 hover:border-[#651522]/40 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300')}
                  >
                    {vessel.id}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            disabled={!selectedTemplate || !selectedVessels.length}
            onClick={() => selectedTemplate && raise(selectedTemplate, dueDate)}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#4e0e15] px-4 text-[11px] font-black text-amber-50 enabled:hover:bg-[#651522] disabled:opacity-40"
          >
            <Layers className="h-3.5 w-3.5" />
            {ka ? 'ორდერის შექმნა' : 'Raise work order'}
            {selectedTemplate && selectedVessels.length > 0 && (
              <span className="font-mono">
                · {selectedTemplate.items.length * selectedVessels.length}
              </span>
            )}
          </button>
        </section>
      )}

      {canCreate && owed.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-amber-900 dark:text-amber-200">
            <Repeat className="h-3.5 w-3.5" />
            {ka ? 'განმეორებადი სამუშაო' : 'Recurring work due'}
          </h3>
          <p className="mt-1 text-[10px] text-amber-800 dark:text-amber-300/80">
            {ka
              ? 'ეს თარიღები ჯერ არცერთ ორდერს არ აქვს დაფარული. აირჩიეთ ჭურჭელი და შექმენით.'
              : 'No order covers these dates yet. Pick the vessels above, then raise one.'}
          </p>
          <ul className="mt-2 space-y-1">
            {owed.slice(0, 6).map(({ template, date }) => (
              <li key={template.id + date} className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-amber-950 dark:text-amber-100">
                  {template.title} · <span className="font-mono">{date}</span>
                </span>
                <button
                  type="button"
                  disabled={!selectedVessels.length}
                  onClick={() => raise(template, date)}
                  className="min-h-7 rounded-md border border-amber-400 px-2 text-[9px] font-black text-amber-900 enabled:hover:bg-amber-100 disabled:opacity-40 dark:text-amber-200"
                >
                  {ka ? 'შექმნა' : 'Raise'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-xs text-stone-500 dark:border-stone-700">
          {ka ? 'სამუშაო ორდერები ჯერ არ არის.' : 'No work orders yet.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ order, progress }) => {
            const next = nextWorkOrderItem(order, productionPlans);
            const complete = progress.status === 'completed';
            return (
              <li
                key={order.id}
                className={'rounded-xl border p-3 ' + (complete
                  ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20'
                  : 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900')}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {complete
                        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        : <ClipboardCheck className="h-4 w-4 shrink-0 text-[#651522] dark:text-amber-300" />}
                      <strong className="truncate text-xs font-black text-stone-900 dark:text-stone-100">
                        {order.title}
                      </strong>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[9.5px] font-semibold text-stone-500">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />{order.dueDate}
                      </span>
                      <span>{order.assignedTo || (ka ? 'დაუნიშნავი' : 'Unassigned')}</span>
                      <span className="font-mono">{progress.done}/{progress.total}</span>
                      {progress.blocked > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                          <TriangleAlert className="h-3 w-3" />
                          {progress.blocked} {ka ? 'დაბლოკილი' : 'blocked'}
                        </span>
                      )}
                      {progress.missing > 0 && (
                        <span className="text-rose-600 dark:text-rose-300">
                          {progress.missing} {ka ? 'წაშლილი' : 'deleted'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {next && onWorkItem && (
                      <button
                        type="button"
                        onClick={() => onWorkItem(next)}
                        className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-[#651522] px-2.5 text-[10px] font-black text-amber-50 hover:bg-[#7a1c2b]"
                      >
                        <Play className="h-3 w-3" />
                        {ka ? 'გაგრძელება' : 'Work next'}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => onDeleteOrder(order.id)}
                        aria-label={ka ? 'ორდერის წაშლა' : 'Delete work order'}
                        title={ka ? 'ორდერის წაშლა' : 'Delete work order'}
                        className="min-h-8 rounded-lg border border-stone-200 px-2 text-stone-400 hover:border-rose-300 hover:text-rose-600 dark:border-stone-700"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                  <div
                    className={'h-full rounded-full ' + (complete ? 'bg-emerald-500' : 'bg-[#4e0e15]')}
                    style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                  />
                </div>

                {next && (
                  <p className="mt-1.5 truncate text-[10px] text-stone-500 dark:text-stone-400">
                    {ka ? 'შემდეგი' : 'Next'}: {planById.get(next.id)?.title || next.title}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default React.memo(WorkOrdersPanel);
