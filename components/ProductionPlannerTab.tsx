import React from 'react';
import { AlertTriangle, CalendarRange, CheckCircle2, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Language } from '../lib/language';
import type { HarvestRecord, Vessel, VineyardBlock, WineLot } from '../lib/wineryState';
import {
  detectProductionPlanConflicts,
  type ProductionPlanItem,
  type ProductionPlanKind,
  type ProductionPlanStatus,
} from '../lib/operationsControl';

interface ProductionPlannerTabProps {
  lang: Language;
  currentUsername: string;
  productionPlans: ProductionPlanItem[];
  onUpdateProductionPlans: React.Dispatch<React.SetStateAction<ProductionPlanItem[]>>;
  vessels: Vessel[];
  lots: WineLot[];
  blocks: VineyardBlock[];
  harvests: HarvestRecord[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  setToastMessage?: (message: string | null) => void;
}

const kinds: ProductionPlanKind[] = ['harvest', 'intake', 'transfer', 'fermentation', 'lab', 'bottling', 'sanitation', 'procurement', 'dispatch', 'other'];
const statuses: ProductionPlanStatus[] = ['planned', 'ready', 'blocked', 'in_progress', 'completed', 'cancelled'];
const today = () => new Date().toISOString().slice(0, 10);
function plusDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function kindColor(kind: ProductionPlanKind): string {
  if (kind === 'harvest' || kind === 'intake') return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100';
  if (kind === 'bottling' || kind === 'dispatch') return 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100';
  if (kind === 'lab' || kind === 'sanitation') return 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100';
  return 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100';
}

export default function ProductionPlannerTab(props: ProductionPlannerTabProps) {
  const ka = props.lang === 'ka';
  const [showCreate, setShowCreate] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [kind, setKind] = React.useState<ProductionPlanKind>('transfer');
  const [startDate, setStartDate] = React.useState(today());
  const [endDate, setEndDate] = React.useState(today());
  const [lotId, setLotId] = React.useState('');
  const [vesselIds, setVesselIds] = React.useState<string[]>([]);
  const [dependencyIds, setDependencyIds] = React.useState<string[]>([]);
  const [blockId, setBlockId] = React.useState('');
  const [quantityLiters, setQuantityLiters] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [windowStart, setWindowStart] = React.useState(today());
  const days = React.useMemo(() => Array.from({ length: 14 }, (_, index) => plusDays(windowStart, index)), [windowStart]);
  const conflicts = React.useMemo(() => detectProductionPlanConflicts(props.productionPlans, props.vessels), [props.productionPlans, props.vessels]);
  const active = React.useMemo(() => [...props.productionPlans].sort((a, b) => a.startDate.localeCompare(b.startDate)), [props.productionPlans]);

  const addPlan = () => {
    if (!title.trim() || !startDate || !endDate || endDate < startDate) {
      props.setToastMessage?.(ka ? 'შეავსეთ სათაური და თარიღები.' : 'Enter a title and dates.');
      return;
    }
    const createdAt = new Date().toISOString();
    const item: ProductionPlanItem = {
      id: `plan-${createdAt.replace(/[^0-9]/g, '').slice(0, 17)}`,
      title: title.trim(),
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
    setTitle(''); setLotId(''); setVesselIds([]); setDependencyIds([]); setBlockId(''); setQuantityLiters(''); setNotes(''); setShowCreate(false);
  };

  const generateHarvestPlan = () => {
    const existingHarvestIds = new Set(props.productionPlans.filter(item => item.kind === 'harvest').map(item => item.notes.match(/harvest:([^\s]+)/)?.[1]).filter(Boolean));
    const createdAt = new Date().toISOString();
    const additions = props.harvests.filter(harvest => !existingHarvestIds.has(harvest.id)).map((harvest, index): ProductionPlanItem => {
      const date = harvest.actualHarvestDate || harvest.estimatedHarvestDate;
      const block = props.blocks.find(item => item.id === harvest.blockId);
      return {
        id: `plan-harvest-${harvest.id}-${createdAt.replace(/[^0-9]/g, '').slice(0, 14)}-${index}`,
        title: `${harvest.variety} harvest · ${block?.name || harvest.blockId}`,
        kind: 'harvest',
        status: harvest.actualHarvestDate ? 'completed' : 'planned',
        startDate: date,
        endDate: date,
        assignedTo: props.currentUsername,
        ...(harvest.associatedLotId ? { lotId: harvest.associatedLotId } : {}),
        vesselIds: [],
        blockId: harvest.blockId,
        quantityLiters: harvest.actualHarvestedKg ? harvest.actualHarvestedKg * 0.7 : harvest.estimatedTons * 700,
        notes: `Generated from harvest:${harvest.id}`,
        dependencyIds: [],
        createdAt,
        createdBy: props.currentUsername,
      };
    });
    if (!additions.length) {
      props.setToastMessage?.(ka ? 'ყველა მოსავლის ჩანაწერი უკვე დაგეგმილია.' : 'All harvest records are already represented in the plan.');
      return;
    }
    props.onUpdateProductionPlans(current => [...additions, ...current]);
    props.setToastMessage?.(ka ? `${additions.length} მოსავლის ეტაპი დაემატა.` : `${additions.length} harvest item(s) added.`);
  };

  const update = (id: string, patch: Partial<ProductionPlanItem>) => props.onUpdateProductionPlans(current => current.map(item => item.id === id ? { ...item, ...patch, lastModified: new Date().toISOString() } : item));

  const removePlan = (id: string) => {
    const dependents = props.productionPlans.filter(item => item.dependencyIds.includes(id));
    if (dependents.length) {
      props.setToastMessage?.(ka ? 'ჯერ დამოკიდებული სამუშაოებიდან მოხსენით ეს წინაპირობა.' : `Remove this prerequisite from ${dependents.length} dependent item(s) first.`);
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

  return <div className="space-y-6">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-violet-700 dark:text-violet-300"><CalendarRange className="h-4 w-4" />{ka ? 'წარმოების გეგმა' : 'Production planner'}</div><h2 className="mt-2 font-serif text-3xl font-semibold text-stone-950 dark:text-white">{ka ? 'ორი კვირის სამუშაო რუკა' : 'Visual production schedule'}</h2><p className="mt-2 max-w-3xl text-sm text-stone-600 dark:text-stone-400">{ka ? 'გააერთიანეთ მოსავალი, მარანი, ლაბორატორია და ჩამოსხმა; სისტემა აჩვენებს ჭურჭლისა და ტევადობის კონფლიქტებს.' : 'Coordinate harvest, cellar, lab, bottling, and dispatch work with automatic vessel and capacity conflict checks.'}</p></div><div className="flex flex-wrap gap-2">{props.canCreate && props.harvests.length > 0 && <button type="button" onClick={generateHarvestPlan} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 text-xs font-black text-violet-800 dark:border-violet-900 dark:bg-stone-900 dark:text-violet-200"><Sparkles className="h-4 w-4" />{ka ? 'მოსავლის გეგმა' : 'Generate harvest plan'}</button>}{props.canCreate && <button type="button" onClick={() => setShowCreate(value => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#651522] px-4 text-xs font-black text-white"><Plus className="h-4 w-4" />{ka ? 'ახალი ეტაპი' : 'New plan item'}</button>}</div></header>

    {showCreate && <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><input value={title} onChange={event => setTitle(event.target.value)} placeholder={ka ? 'სამუშაოს სათაური' : 'Work title'} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm xl:col-span-2 dark:border-stone-700 dark:bg-stone-950" /><select value={kind} onChange={event => setKind(event.target.value as ProductionPlanKind)} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950">{kinds.map(value => <option key={value}>{value}</option>)}</select><input type="number" min="0" value={quantityLiters} onChange={event => setQuantityLiters(event.target.value)} placeholder="Liters" className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950" /><input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950" /><input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950" /><select value={lotId} onChange={event => setLotId(event.target.value)} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950"><option value="">Lot (optional)</option>{props.lots.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select><select value={blockId} onChange={event => setBlockId(event.target.value)} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950"><option value="">Block (optional)</option>{props.blocks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><div className="rounded-xl border border-stone-200 p-3 md:col-span-2 dark:border-stone-700"><div className="mb-2 text-[10px] font-black uppercase text-stone-500">Vessels</div><div className="flex max-h-28 flex-wrap gap-2 overflow-auto">{props.vessels.map(vessel => <label key={vessel.id} className="flex items-center gap-2 rounded-lg bg-stone-50 px-2 py-1.5 text-xs dark:bg-stone-950"><input type="checkbox" checked={vesselIds.includes(vessel.id)} onChange={event => setVesselIds(current => event.target.checked ? [...current, vessel.id] : current.filter(id => id !== vessel.id))} />{vessel.id}</label>)}</div></div><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Notes" className="min-h-24 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm md:col-span-2 dark:border-stone-700 dark:bg-stone-950" /><button type="button" onClick={addPlan} className="min-h-11 rounded-xl bg-violet-700 text-xs font-black text-white md:col-span-2 xl:col-span-4">{ka ? 'გეგმაში დამატება' : 'Add to plan'}</button></div></section>}

    {showCreate && props.productionPlans.length > 0 && <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900 dark:bg-violet-950/20"><h3 className="text-[10px] font-black uppercase tracking-wider text-violet-800 dark:text-violet-200">{ka ? 'წინაპირობები' : 'Prerequisite work'}</h3><p className="mt-1 text-xs text-stone-500">{ka ? 'აირჩიეთ სამუშაოები, რომლებიც ამ ეტაპამდე უნდა დასრულდეს.' : 'Select work that must finish before this item starts.'}</p><div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-auto">{active.filter(item => !['cancelled'].includes(item.status)).map(item => <label key={item.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs dark:bg-stone-900"><input type="checkbox" checked={dependencyIds.includes(item.id)} onChange={event => setDependencyIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.title} <span className="text-stone-400">({item.endDate})</span></label>)}</div></section>}

    {conflicts.length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"><h3 className="flex items-center gap-2 text-xs font-black uppercase text-amber-900 dark:text-amber-100"><AlertTriangle className="h-4 w-4" />{conflicts.length} {ka ? 'კონფლიქტი' : 'planning conflict(s)'}</h3><div className="mt-2 grid gap-2 lg:grid-cols-2">{conflicts.map((conflict, index) => <button key={`${conflict.itemId}-${conflict.code}-${index}`} type="button" onClick={() => document.getElementById(`plan-${conflict.itemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="rounded-xl bg-white p-3 text-left text-xs text-amber-900 dark:bg-stone-900 dark:text-amber-100"><strong className="uppercase">{conflict.severity}</strong> · {conflict.message}</button>)}</div></section>}

    <section className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"><div className="flex items-center justify-between border-b border-stone-200 p-3 dark:border-stone-800"><button type="button" onClick={() => setWindowStart(plusDays(windowStart, -14))} className="rounded-lg border px-3 py-2 text-xs">← 14d</button><strong className="text-xs">{windowStart} — {days[13]}</strong><button type="button" onClick={() => setWindowStart(plusDays(windowStart, 14))} className="rounded-lg border px-3 py-2 text-xs">14d →</button></div><div className="grid min-w-[1120px]" style={{ gridTemplateColumns: 'repeat(14, minmax(80px, 1fr))' }}>{days.map(day => <div key={day} className={`min-h-72 border-r border-stone-100 p-2 dark:border-stone-800 ${day === today() ? 'bg-violet-50 dark:bg-violet-950/20' : ''}`}><div className="mb-3 text-center text-[9px] font-black uppercase text-stone-500">{new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div><div className="space-y-2">{active.filter(item => item.startDate <= day && item.endDate >= day && !['cancelled'].includes(item.status)).map(item => <div key={item.id} title={`${item.startDate} — ${item.endDate}`} className={`rounded-lg p-2 text-[9px] font-bold ${kindColor(item.kind)}`}>{item.title}<span className="mt-1 block opacity-65">{item.kind}</span></div>)}</div></div>)}</div></section>

    <section className="space-y-3">{active.map(item => { const itemConflicts = conflicts.filter(conflict => conflict.itemId === item.id); return <article id={`plan-${item.id}`} key={item.id} className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${kindColor(item.kind)}`}>{item.kind}</span>{itemConflicts.length === 0 && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}<strong className="truncate text-sm">{item.title}</strong></div><p className="mt-2 text-xs text-stone-500">{item.startDate} — {item.endDate} · {item.vesselIds.join(', ') || 'No vessel'}{item.quantityLiters ? ` · ${item.quantityLiters.toLocaleString()} L` : ''}{item.dependencyIds.length ? ` · ${item.dependencyIds.length} prerequisite(s)` : ''}</p>{itemConflicts.map((conflict, index) => <p key={index} className="mt-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">{conflict.message}</p>)}</div><div className="flex gap-2">{props.canUpdate && <select value={item.status} onChange={event => update(item.id, { status: event.target.value as ProductionPlanStatus })} className="min-h-10 rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs dark:border-stone-700 dark:bg-stone-950">{statuses.map(status => <option key={status}>{status}</option>)}</select>}{props.canDelete && <button type="button" onClick={() => removePlan(item.id)} className="rounded-xl border border-stone-200 p-3 text-stone-400 hover:text-rose-700 dark:border-stone-700"><Trash2 className="h-4 w-4" /></button>}</div></div></article>; })}</section>

    {props.canUpdate && active.length > 1 && <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"><h3 className="text-xs font-black uppercase tracking-wider">{ka ? 'წინაპირობების რედაქტორი' : 'Prerequisite editor'}</h3><div className="mt-3 grid gap-3 lg:grid-cols-2">{active.map(item => <details key={item.id} className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950"><summary className="cursor-pointer text-xs font-bold">{item.title} · {item.dependencyIds.length}</summary><div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-auto">{active.filter(candidate => candidate.id !== item.id).map(candidate => { const cycle = !item.dependencyIds.includes(candidate.id) && wouldCreateDependencyCycle(item.id, candidate.id); return <label key={candidate.id} className={`flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-[11px] dark:bg-stone-900 ${cycle ? 'opacity-40' : ''}`}><input type="checkbox" checked={item.dependencyIds.includes(candidate.id)} disabled={cycle} onChange={event => toggleDependency(item, candidate.id, event.target.checked)} />{candidate.title}</label>; })}</div></details>)}</div></section>}
  </div>;
}
