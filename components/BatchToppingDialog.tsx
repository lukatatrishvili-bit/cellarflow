import React, { useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Check, Loader2, TriangleAlert, X } from 'lucide-react';
import type { Language } from '../lib/language';
import type { Vessel, WineLot } from '../lib/wineryState';
import { maxLitresPerVessel, planBatchTopping } from '../lib/batchTopping';
import { toppingIssueMessage } from '../lib/topping';
import { useFocusTrap } from './useFocusTrap';

/**
 * Topping a batch of barrels from one vessel.
 *
 * The whole point of the batch is that the barrels were already chosen by
 * pointing at them, so this asks only the two questions that remain: where the
 * wine comes from, and how much goes in each. Everything else is shown rather
 * than asked — which barrels will be topped, which will be skipped and why, and
 * what the source gives up in total.
 *
 * Barrels that cannot be topped are listed, not silently dropped. Someone who
 * selected twelve and tops nine needs to know which three were left and why,
 * or they will find out at the barrel.
 */

export interface BatchToppingDialogProps {
  lang?: Language;
  vesselIds: string[];
  vessels: Vessel[];
  lots: WineLot[];
  busy?: boolean;
  error?: string | null;
  /** Progress while the batch is being written, e.g. 3 of 9. */
  progress?: { done: number; total: number } | null;
  onCancel: () => void;
  onConfirm: (input: { sourceVesselId: string; litresPerVessel: number }) => void;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export default function BatchToppingDialog({
  lang,
  vesselIds,
  vessels,
  lots,
  busy = false,
  error,
  progress,
  onCancel,
  onConfirm,
}: BatchToppingDialogProps) {
  const ka = lang === 'ka';
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { active: true, onClose: onCancel });

  // Any vessel holding wine can be a topping source, except the ones being
  // topped — including one of them would quietly rob a barrel to fill another.
  const sourceOptions = useMemo(
    () => vessels.filter(vessel => vessel.assignedLotId && vessel.currentVolume > 0 && !vesselIds.includes(vessel.id)),
    [vessels, vesselIds],
  );

  const [sourceVesselId, setSourceVesselId] = useState(() => sourceOptions[0]?.id || '');
  const [litres, setLitres] = useState('2');

  const litresPerVessel = Number(litres);
  const preview = useMemo(
    () => planBatchTopping({ sourceVesselId, targetVesselIds: vesselIds, litresPerVessel, vessels, lots }),
    [sourceVesselId, vesselIds, litresPerVessel, vessels, lots],
  );
  const suggestion = useMemo(
    () => maxLitresPerVessel({ sourceVesselId, targetVesselIds: vesselIds, vessels }),
    [sourceVesselId, vesselIds, vessels],
  );

  const source = vessels.find(vessel => vessel.id === sourceVesselId);
  const sourceLot = lots.find(lot => lot.id === source?.assignedLotId);
  const canConfirm = Boolean(sourceVesselId) && preview.toppable.length > 0 && !busy;

  const field = 'min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-sm font-bold text-stone-900 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100';
  const label = 'mb-1 block text-[9px] font-mono font-black uppercase tracking-[0.16em] text-stone-500';

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-stone-950/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ka ? 'ჯგუფური დოლივა' : 'Top several vessels'}
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-900"
      >
        <header className="flex items-start justify-between gap-3 border-b border-stone-100 p-4 dark:border-stone-800">
          <div className="min-w-0">
            <span className="block text-[9px] font-mono font-black uppercase tracking-[0.18em] text-stone-400">
              {ka ? 'ჯგუფური დოლივა' : 'Batch topping'}
            </span>
            <strong className="mt-1 block text-sm font-black text-stone-900 dark:text-stone-100">
              {vesselIds.length} {ka ? 'ჭურჭელი' : (vesselIds.length === 1 ? 'vessel' : 'vessels')}
            </strong>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={ka ? 'დახურვა' : 'Close'}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label} htmlFor="batch-topping-source">{ka ? 'დოლივის წყარო' : 'Topping source'}</label>
              <select
                id="batch-topping-source"
                value={sourceVesselId}
                onChange={event => setSourceVesselId(event.target.value)}
                className={field}
              >
                {sourceOptions.length === 0 && <option value="">{ka ? '— წყარო არ არის —' : '— no source available —'}</option>}
                {sourceOptions.map(vessel => (
                  <option key={vessel.id} value={vessel.id}>{vessel.id} — {round1(vessel.currentVolume)} L</option>
                ))}
              </select>
              {sourceLot && (
                <p className="mt-1 truncate text-[10px] font-semibold text-stone-500">{sourceLot.name}</p>
              )}
            </div>
            <div>
              <label className={label} htmlFor="batch-topping-litres">{ka ? 'ლიტრი თითოზე' : 'Litres each'}</label>
              <input
                id="batch-topping-litres"
                type="number"
                min={0}
                step="0.1"
                value={litres}
                onChange={event => setLitres(event.target.value)}
                className={field}
                autoFocus
              />
              {suggestion > 0 && (
                <button
                  type="button"
                  onClick={() => setLitres(String(suggestion))}
                  className="mt-1 text-[10px] font-bold text-stone-500 underline-offset-2 hover:text-[#651522] hover:underline dark:hover:text-amber-300"
                >
                  {ka ? 'ყველასთვის მაქსიმუმი' : 'Most that fits all'}: {suggestion} L
                </button>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-stone-50 p-3 dark:bg-stone-950/40">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold">
              <span className="text-emerald-700 dark:text-emerald-300">
                {preview.toppable.length} {ka ? 'შეივსება' : 'will be topped'}
              </span>
              {preview.skipped.length > 0 && (
                <span className="text-amber-700 dark:text-amber-300">
                  {preview.skipped.length} {ka ? 'გამოტოვებული' : 'skipped'}
                </span>
              )}
              <span className="text-stone-600 dark:text-stone-300">
                {ka ? 'წყაროდან' : 'From source'}{' '}
                <strong className="font-mono">{round1(preview.totalDrawL)} L</strong>
                {source && (
                  <span className="text-stone-400"> / {round1(source.currentVolume)} L</span>
                )}
              </span>
            </div>

            {preview.toppable.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1">
                {preview.toppable.map(entry => (
                  <span key={entry.vesselId} className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 font-mono text-[9px] font-black text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                    <Check className="h-2.5 w-2.5" />{entry.vesselId}
                  </span>
                ))}
              </p>
            )}

            {preview.skipped.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {preview.skipped.map(entry => (
                  <li key={entry.vesselId} className="flex items-start gap-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="font-mono font-black">{entry.vesselId}</span>
                    <span>{entry.issue ? toppingIssueMessage(entry.issue, ka ? 'ka' : 'en') : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-[11px] font-bold text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-stone-100 p-4 dark:border-stone-800">
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm({ sourceVesselId, litresPerVessel })}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#4e0e15] px-4 text-xs font-black text-amber-50 enabled:hover:bg-[#651522] disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownToLine className="h-3.5 w-3.5" />}
            {busy && progress
              ? `${progress.done} / ${progress.total}`
              : `${ka ? 'დოლივა' : 'Top'} ${preview.toppable.length} ${ka ? 'ჭურჭელს' : (preview.toppable.length === 1 ? 'vessel' : 'vessels')}`}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-lg border border-stone-200 px-3 text-xs font-bold text-stone-500 hover:text-stone-800 disabled:opacity-40 dark:border-stone-700"
          >
            {ka ? 'გაუქმება' : 'Cancel'}
          </button>
        </footer>
      </div>
    </div>
  );
}
