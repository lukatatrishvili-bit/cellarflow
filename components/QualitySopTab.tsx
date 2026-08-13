import React from 'react';
import { Check, ClipboardCheck, History, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { Language } from '../lib/language';
import type { Vessel, WineLot } from '../lib/wineryState';
import {
  completeQualitySop,
  type QualitySop,
  type QualitySopCategory,
  type QualitySopFrequency,
} from '../lib/operationsControl';

interface QualitySopTabProps {
  lang: Language;
  currentUsername: string;
  vessels: Vessel[];
  lots: WineLot[];
  qualitySops: QualitySop[];
  onUpdateQualitySops: React.Dispatch<React.SetStateAction<QualitySop[]>>;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  setToastMessage?: (message: string | null) => void;
}

const categories: QualitySopCategory[] = ['sanitation', 'calibration', 'sampling', 'bottling', 'compliance', 'safety', 'other'];
const frequencies: QualitySopFrequency[] = ['once', 'daily', 'weekly', 'monthly', 'quarterly', 'seasonal'];
const today = () => new Date().toISOString().slice(0, 10);

export default function QualitySopTab(props: QualitySopTabProps) {
  const ka = props.lang === 'ka';
  const [showCreate, setShowCreate] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [category, setCategory] = React.useState<QualitySopCategory>('sanitation');
  const [frequency, setFrequency] = React.useState<QualitySopFrequency>('weekly');
  const [dueDate, setDueDate] = React.useState(today());
  const [checklistText, setChecklistText] = React.useState('');
  const [evidenceRequired, setEvidenceRequired] = React.useState(true);
  const [relatedVesselId, setRelatedVesselId] = React.useState('');
  const [relatedLotId, setRelatedLotId] = React.useState('');
  const [checks, setChecks] = React.useState<Record<string, string[]>>({});
  const [evidence, setEvidence] = React.useState<Record<string, string>>({});

  const sorted = React.useMemo(() => [...props.qualitySops].sort((a, b) => Number(b.active) - Number(a.active) || a.nextDueDate.localeCompare(b.nextDueDate)), [props.qualitySops]);
  const overdue = props.qualitySops.filter(item => item.active && item.nextDueDate < today()).length;

  const createSop = () => {
    const checklist = checklistText.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    if (!title.trim() || checklist.length === 0) {
      props.setToastMessage?.(ka ? 'მიუთითეთ სათაური და მინიმუმ ერთი საკონტროლო პუნქტი.' : 'Enter a title and at least one checklist item.');
      return;
    }
    const createdAt = new Date().toISOString();
    const sop: QualitySop = {
      id: `sop-${createdAt.replace(/[^0-9]/g, '').slice(0, 17)}`,
      title: title.trim(),
      category,
      frequency,
      owner: props.currentUsername,
      active: true,
      nextDueDate: dueDate,
      checklist,
      evidenceRequired,
      ...(relatedVesselId ? { relatedVesselId } : {}),
      ...(relatedLotId ? { relatedLotId } : {}),
      completionHistory: [],
      createdAt,
      createdBy: props.currentUsername,
    };
    props.onUpdateQualitySops(current => [sop, ...current]);
    setTitle(''); setChecklistText(''); setRelatedVesselId(''); setRelatedLotId(''); setShowCreate(false);
    props.setToastMessage?.(ka ? 'SOP შეიქმნა.' : 'SOP created.');
  };

  const complete = (sop: QualitySop) => {
    try {
      const updated = completeQualitySop(sop, {
        completedBy: props.currentUsername,
        completedChecklist: checks[sop.id] || [],
        evidenceNote: evidence[sop.id] || '',
      });
      props.onUpdateQualitySops(current => current.map(item => item.id === sop.id ? updated : item));
      setChecks(current => ({ ...current, [sop.id]: [] }));
      setEvidence(current => ({ ...current, [sop.id]: '' }));
      props.setToastMessage?.(ka ? 'SOP დასრულდა და შემდეგი ვადა დაიგეგმა.' : 'SOP completed and its next due date was scheduled.');
    } catch (error) {
      props.setToastMessage?.(error instanceof Error ? error.message : 'SOP could not be completed.');
    }
  };

  return <div className="space-y-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-4 w-4" />{ka ? 'ხარისხის სისტემა' : 'Quality system'}</div><h2 className="mt-2 font-serif text-3xl font-semibold text-stone-950 dark:text-white">{ka ? 'განმეორებადი SOP-ები' : 'Recurring SOPs and evidence'}</h2><p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{overdue} {ka ? 'ვადაგადაცილებული პროცედურა' : 'overdue procedure(s)'}</p></div>{props.canCreate && <button type="button" onClick={() => setShowCreate(value => !value)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#651522] px-4 text-xs font-black text-white"><Plus className="h-4 w-4" />{ka ? 'ახალი SOP' : 'New SOP'}</button>}</header>

    {showCreate && <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900"><h3 className="text-sm font-black">{ka ? 'პროცედურის შექმნა' : 'Create procedure'}</h3><div className="mt-4 grid gap-3 md:grid-cols-2"><input value={title} onChange={event => setTitle(event.target.value)} placeholder={ka ? 'სათაური' : 'Procedure title'} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950" /><select value={category} onChange={event => setCategory(event.target.value as QualitySopCategory)} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950">{categories.map(value => <option key={value}>{value}</option>)}</select><select value={frequency} onChange={event => setFrequency(event.target.value as QualitySopFrequency)} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950">{frequencies.map(value => <option key={value}>{value}</option>)}</select><input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950" /><select value={relatedVesselId} onChange={event => setRelatedVesselId(event.target.value)} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950"><option value="">{ka ? 'ჭურჭელი (არასავალდებულო)' : 'Vessel (optional)'}</option>{props.vessels.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select><select value={relatedLotId} onChange={event => setRelatedLotId(event.target.value)} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm dark:border-stone-700 dark:bg-stone-950"><option value="">{ka ? 'პარტია (არასავალდებულო)' : 'Lot (optional)'}</option>{props.lots.map(item => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select><textarea value={checklistText} onChange={event => setChecklistText(event.target.value)} placeholder={ka ? 'ერთი საკონტროლო პუნქტი თითო ხაზზე' : 'One checklist item per line'} className="min-h-28 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm md:col-span-2 dark:border-stone-700 dark:bg-stone-950" /><label className="flex min-h-11 items-center gap-3 text-xs font-bold"><input type="checkbox" checked={evidenceRequired} onChange={event => setEvidenceRequired(event.target.checked)} className="h-5 w-5 accent-[#651522]" />{ka ? 'მოითხოვე მტკიცებულების შენიშვნა' : 'Require an evidence note'}</label><button type="button" onClick={createSop} className="min-h-11 rounded-xl bg-emerald-700 text-xs font-black text-white">{ka ? 'SOP-ის შენახვა' : 'Save SOP'}</button></div></section>}

    <section className="grid gap-4 lg:grid-cols-2">{sorted.length === 0 ? <div className="rounded-2xl border border-dashed border-stone-300 p-12 text-center text-sm text-stone-500 lg:col-span-2 dark:border-stone-700">{ka ? 'SOP ჯერ არ არის.' : 'No SOPs yet.'}</div> : sorted.map(sop => {
      const checked = checks[sop.id] || [];
      const isOverdue = sop.active && sop.nextDueDate < today();
      return <article key={sop.id} className={`rounded-2xl border bg-white p-5 shadow-sm dark:bg-stone-900 ${isOverdue ? 'border-rose-300 dark:border-rose-900' : 'border-stone-200 dark:border-stone-800'}`}><div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-black uppercase tracking-wider text-stone-500">{sop.category} · {sop.frequency}</div><h3 className="mt-1 text-lg font-bold text-stone-950 dark:text-white">{sop.title}</h3><p className={`mt-1 text-xs font-bold ${isOverdue ? 'text-rose-700 dark:text-rose-300' : 'text-stone-500'}`}>{ka ? 'შემდეგი ვადა' : 'Next due'}: {sop.nextDueDate}</p></div>{props.canDelete && <button type="button" onClick={() => props.onUpdateQualitySops(current => current.filter(item => item.id !== sop.id))} className="rounded-lg p-2 text-stone-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>}</div>
      <div className="mt-4 space-y-2">{sop.checklist.map(item => <label key={item} className="flex items-start gap-3 rounded-xl bg-stone-50 p-3 text-xs dark:bg-stone-950"><input type="checkbox" disabled={!props.canUpdate || !sop.active} checked={checked.includes(item)} onChange={event => setChecks(current => ({ ...current, [sop.id]: event.target.checked ? [...checked, item] : checked.filter(value => value !== item) }))} className="mt-0.5 h-4 w-4 accent-emerald-700" /><span>{item}</span></label>)}</div>
      {sop.evidenceRequired && <textarea value={evidence[sop.id] || ''} disabled={!props.canUpdate || !sop.active} onChange={event => setEvidence(current => ({ ...current, [sop.id]: event.target.value }))} placeholder={ka ? 'შედეგი, საზომი ან მტკიცებულების მითითება' : 'Result, reading, or evidence reference'} className="mt-3 min-h-20 w-full rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs dark:border-stone-700 dark:bg-stone-950" />}
      <div className="mt-3 flex gap-2">{props.canUpdate && sop.active && <button type="button" onClick={() => complete(sop)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 text-xs font-black text-white"><Check className="h-4 w-4" />{ka ? 'დასრულება' : 'Complete'}</button>}<details className="flex-1 rounded-xl border border-stone-200 p-2 dark:border-stone-700"><summary className="flex cursor-pointer items-center justify-center gap-2 text-xs font-bold"><History className="h-4 w-4" />{sop.completionHistory.length} {ka ? 'ჩანაწერი' : 'records'}</summary><div className="mt-2 max-h-40 space-y-2 overflow-auto">{sop.completionHistory.map(entry => <div key={entry.id} className="rounded-lg bg-stone-50 p-2 text-[10px] dark:bg-stone-950"><strong>{new Date(entry.completedAt).toLocaleString()}</strong><p>{entry.completedBy}</p><p className="mt-1 text-stone-500">{entry.evidenceNote}</p></div>)}</div></details></div>
      {!sop.active && <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><ClipboardCheck className="h-4 w-4" />{ka ? 'ერთჯერადი SOP დასრულებულია' : 'One-time SOP completed'}</div>}</article>;
    })}</section>
  </div>;
}
