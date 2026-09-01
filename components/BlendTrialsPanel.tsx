import React, { useMemo, useState } from 'react';
import { Beaker, Check, Plus, Trash, TriangleAlert, X } from 'lucide-react';
import type { Language } from '../lib/language';
import type { LabAnalysis, WineLot } from '../lib/wineryState';
import type { CostEntry } from '../lib/costing/types';
import { createUniqueRecordId } from '../lib/recordIds';
import {
  blendTrialIssueMessage,
  blockingBlendTrialIssues,
  summarizeBlendTrial,
  type BlendTrial,
  type BlendTrialComponent,
  type PredictableAnalyte,
} from '../lib/blendTrials';

/**
 * Blend trials: try a blend on paper.
 *
 * The panel shows what a proposal would produce — volume, proportions, the
 * analytes that blend linearly, and cost per litre — and commits nothing. The
 * existing blend workflow is still the only thing that moves wine.
 */

interface BlendTrialsPanelProps {
  lang?: Language;
  currentUsername: string;
  trials: BlendTrial[];
  lots: WineLot[];
  labLogs: LabAnalysis[];
  costEntries: CostEntry[];
  currency?: string;
  canEdit: boolean;
  onSaveTrial: (trial: BlendTrial) => void;
  onDeleteTrial: (trialId: string) => void;
  setToastMessage?: (message: string | null) => void;
}

const ANALYTE_LABELS: Record<PredictableAnalyte, { en: string; ka: string; unit: string }> = {
  alcoholPct: { en: 'Alcohol', ka: 'ალკოჰოლი', unit: '%' },
  titratableAcidity: { en: 'TA', ka: 'ტიტრ. მჟავა', unit: 'g/L' },
  residualSugar: { en: 'Sugar', ka: 'შაქარი', unit: 'g/L' },
  volatileAcid: { en: 'VA', ka: 'აქროლადი', unit: 'g/L' },
  freeSo2: { en: 'Free SO₂', ka: 'თავისუფ. SO₂', unit: 'mg/L' },
  totalSo2: { en: 'Total SO₂', ka: 'სულ SO₂', unit: 'mg/L' },
  malicAcid: { en: 'Malic', ka: 'ვაშლის', unit: 'g/L' },
};

export function BlendTrialsPanel({
  lang,
  currentUsername,
  trials,
  lots,
  labLogs,
  costEntries,
  currency = 'GEL',
  canEdit,
  onSaveTrial,
  onDeleteTrial,
  setToastMessage,
}: BlendTrialsPanelProps) {
  const ka = lang === 'ka';
  const [title, setTitle] = useState('');
  const [components, setComponents] = useState<BlendTrialComponent[]>([]);
  const [pickerLotId, setPickerLotId] = useState('');

  const draftSummary = useMemo(
    () => summarizeBlendTrial({ trial: { components }, lots, labLogs, costEntries }),
    [components, lots, labLogs, costEntries],
  );

  const addComponent = () => {
    if (!pickerLotId || components.some(entry => entry.lotId === pickerLotId)) return;
    setComponents(current => [...current, { lotId: pickerLotId, volumeL: 0 }]);
    setPickerLotId('');
  };

  const setVolume = (lotId: string, raw: string) => {
    const volumeL = Number(raw);
    setComponents(current => current.map(entry => (
      entry.lotId === lotId ? { ...entry, volumeL: Number.isFinite(volumeL) ? volumeL : 0 } : entry
    )));
  };

  const save = () => {
    const name = title.trim();
    if (!name) return;
    onSaveTrial({
      id: createUniqueRecordId('trial', trials.map(entry => entry.id)),
      title: name,
      components,
      status: 'draft',
      notes: '',
      createdAt: new Date().toISOString(),
      createdBy: currentUsername,
    });
    setTitle('');
    setComponents([]);
    setToastMessage?.(ka ? 'ცდა შენახულია.' : 'Trial saved.');
  };

  const blocking = blockingBlendTrialIssues(draftSummary);
  const inputCls = 'min-h-9 w-full rounded-lg border border-stone-200 bg-stone-50 px-2 text-xs font-bold dark:border-stone-700 dark:bg-stone-950';

  const renderAnalysis = (summary: ReturnType<typeof summarizeBlendTrial>) => {
    const entries = Object.entries(summary.analysis) as Array<[PredictableAnalyte, number]>;
    if (!entries.length) {
      return (
        <p className="text-[10px] text-stone-400">
          {ka ? 'კომპონენტებს ანალიზი არ აქვთ.' : 'No lab readings on these lots yet.'}
        </p>
      );
    }
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {entries.map(([analyte, value]) => (
          <span key={analyte} className="text-[10px] font-bold text-stone-600 dark:text-stone-300">
            {ka ? ANALYTE_LABELS[analyte].ka : ANALYTE_LABELS[analyte].en}{' '}
            <strong className="font-mono text-stone-900 dark:text-amber-100">{value}</strong>
            <span className="text-stone-400"> {ANALYTE_LABELS[analyte].unit}</span>
            {summary.partialAnalytes.includes(analyte) && (
              <span
                className="ml-0.5 text-amber-600"
                title={ka ? 'ყველა კომპონენტი არ არის გაზომილი' : 'Not every component has been measured'}
              >
                *
              </span>
            )}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <section className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-stone-700 dark:text-stone-200">
            <Beaker className="h-4 w-4 text-[#651522] dark:text-amber-300" />
            {ka ? 'ახალი კუპაჟის ცდა' : 'New blend trial'}
          </h3>
          <p className="mt-1 text-[10px] text-stone-500 dark:text-stone-400">
            {ka
              ? 'ცდა არაფერს გადაადგილებს — მხოლოდ ითვლის.'
              : 'A trial moves no wine. It only works out what the blend would be.'}
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder={ka ? 'ცდის დასახელება' : 'Trial name'}
              aria-label={ka ? 'ცდის დასახელება' : 'Trial name'}
              className={`${inputCls} sm:col-span-2`}
            />
            <div className="flex gap-1">
              <select
                value={pickerLotId}
                onChange={event => setPickerLotId(event.target.value)}
                aria-label={ka ? 'პარტიის დამატება' : 'Add lot'}
                className={inputCls}
              >
                <option value="">{ka ? '— პარტია —' : '— add lot —'}</option>
                {lots
                  .filter(entry => !components.some(component => component.lotId === entry.id))
                  .map(entry => (
                    <option key={entry.id} value={entry.id}>{entry.name} ({entry.currentVolume} L)</option>
                  ))}
              </select>
              <button
                type="button"
                onClick={addComponent}
                disabled={!pickerLotId}
                aria-label={ka ? 'დამატება' : 'Add'}
                className="min-h-9 rounded-lg border border-stone-200 px-2 text-stone-600 enabled:hover:border-[#651522]/40 disabled:opacity-40 dark:border-stone-700"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {components.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {components.map(component => {
                const detail = draftSummary.components.find(entry => entry.lotId === component.lotId);
                const lotName = lots.find(entry => entry.id === component.lotId)?.name || component.lotId;
                return (
                  <li key={component.lotId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-stone-700 dark:text-stone-200">
                      {lotName}
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={component.volumeL || ''}
                      onChange={event => setVolume(component.lotId, event.target.value)}
                      aria-label={`${lotName} ${ka ? 'ლიტრი' : 'litres'}`}
                      className="min-h-9 w-24 rounded-lg border border-stone-200 bg-stone-50 px-2 text-xs font-bold dark:border-stone-700 dark:bg-stone-950"
                    />
                    <span className="w-14 text-right font-mono text-[10px] text-stone-500">
                      {detail ? `${Math.round(detail.share * 100)}%` : '—'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setComponents(current => current.filter(entry => entry.lotId !== component.lotId))}
                      aria-label={ka ? 'ამოღება' : 'Remove'}
                      className="min-h-9 rounded-lg px-1.5 text-stone-400 hover:text-rose-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {components.length > 0 && (
            <div className="mt-3 space-y-2 rounded-lg bg-stone-50 p-3 dark:bg-stone-950/40">
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold">
                <span>
                  {ka ? 'სულ' : 'Total'}{' '}
                  <strong className="font-mono text-stone-900 dark:text-amber-100">{draftSummary.totalVolumeL} L</strong>
                </span>
                {draftSummary.costPerLitre !== null && (
                  <span>
                    {ka ? 'ღირებულება' : 'Cost'}{' '}
                    <strong className="font-mono text-stone-900 dark:text-amber-100">
                      {draftSummary.costPerLitre} {currency}/L
                    </strong>
                  </span>
                )}
              </div>
              {renderAnalysis(draftSummary)}
              {draftSummary.issues.length > 0 && (
                <ul className="space-y-0.5">
                  {draftSummary.issues.map((issue, position) => (
                    <li
                      key={`${issue.kind}-${position}`}
                      className="flex items-start gap-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                    >
                      <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                      {blendTrialIssueMessage(issue, ka ? 'ka' : 'en')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={!title.trim() || blocking.length > 0}
            onClick={save}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#4e0e15] px-4 text-[11px] font-black text-amber-50 enabled:hover:bg-[#651522] disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" />
            {ka ? 'ცდის შენახვა' : 'Save trial'}
          </button>
        </section>
      )}

      {trials.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-xs text-stone-500 dark:border-stone-700">
          {ka ? 'ცდები ჯერ არ არის.' : 'No blend trials yet.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {trials.map(trial => {
            const summary = summarizeBlendTrial({ trial, lots, labLogs, costEntries });
            return (
              <li key={trial.id} className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="block truncate text-xs font-black text-stone-900 dark:text-stone-100">
                      {trial.title}
                    </strong>
                    <span className="text-[10px] font-semibold text-stone-500">
                      {summary.components.length} {ka ? 'პარტია' : 'lots'} ·{' '}
                      <span className="font-mono">{summary.totalVolumeL} L</span>
                      {summary.costPerLitre !== null && (
                        <> · <span className="font-mono">{summary.costPerLitre} {currency}/L</span></>
                      )}
                    </span>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onDeleteTrial(trial.id)}
                      aria-label={ka ? 'ცდის წაშლა' : 'Delete trial'}
                      className="min-h-8 rounded-lg border border-stone-200 px-2 text-stone-400 hover:border-rose-300 hover:text-rose-600 dark:border-stone-700"
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="mt-2">{renderAnalysis(summary)}</div>
                <p className="mt-1.5 truncate text-[10px] text-stone-500 dark:text-stone-400">
                  {summary.components.map(entry => `${entry.lotName} ${Math.round(entry.share * 100)}%`).join(' · ')}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default React.memo(BlendTrialsPanel);
