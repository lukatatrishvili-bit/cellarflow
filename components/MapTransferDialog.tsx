import React, { useMemo, useRef, useState } from 'react';
import { ArrowRight, Loader2, X } from 'lucide-react';
import type { Language } from '../lib/language';
import type { Vessel, WineLot } from '../lib/wineryState';
import type { TransferCategory } from '../lib/commands/transfer';
import { useFocusTrap } from './useFocusTrap';

/**
 * Recording a transfer on the cellar map.
 *
 * The map already knew how to pick a source and a destination, check the
 * destination's headroom and cleanliness, and work out how much could move. It
 * then threw all of that away and navigated to the transfers screen, which
 * asked for the same three things again.
 *
 * This commits it in place. Deliberately the short form — the two vessels are
 * already chosen by pointing at them, so all that is left is how much, how much
 * was lost, and why. Anything more specialised (materials, reversals, the
 * transfer history) still belongs on the transfers screen, and the link at the
 * bottom goes there.
 */

export interface MapTransferDialogProps {
  lang?: Language;
  source: Vessel;
  destination: Vessel;
  lots: WineLot[];
  /** Largest move the source stock and destination headroom both allow. */
  maxVolumeL: number;
  /** A volume asked for elsewhere, e.g. typed in the command palette. */
  suggestedVolumeL?: number;
  operatorName: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (input: { volumeLiters: number; lossLiters: number; category: TransferCategory; pump: string }) => void;
  onOpenFullTransfer?: () => void;
}

const CATEGORIES: Array<{ value: TransferCategory; en: string; ka: string }> = [
  { value: 'racking', en: 'Racking', ka: 'გადატანა' },
  { value: 'blend', en: 'Blending', ka: 'კუპაჟი' },
  { value: 'filtration', en: 'Filtration', ka: 'ფილტრაცია' },
  { value: 'bottling', en: 'Bottling', ka: 'ჩამოსხმა' },
];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export default function MapTransferDialog({
  lang,
  source,
  destination,
  lots,
  maxVolumeL,
  suggestedVolumeL,
  operatorName,
  busy = false,
  error,
  onCancel,
  onConfirm,
  onOpenFullTransfer,
}: MapTransferDialogProps) {
  const ka = lang === 'ka';
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { active: true, onClose: onCancel });

  // A volume asked for elsewhere wins, clamped to what actually fits; without
  // one, the whole movable volume is what racking a vessel usually means, and
  // it is the number the map already computed.
  const [volume, setVolume] = useState(() => String(round1(
    suggestedVolumeL !== undefined ? Math.min(suggestedVolumeL, maxVolumeL) : maxVolumeL,
  )));
  const [loss, setLoss] = useState('0');
  const [category, setCategory] = useState<TransferCategory>('racking');
  const [pump, setPump] = useState('');

  const volumeL = Number(volume);
  const lossL = Number(loss) || 0;
  const sourceLot = lots.find(lot => lot.id === source.assignedLotId);

  const issue = useMemo(() => {
    if (!Number.isFinite(volumeL) || volumeL <= 0) {
      return ka ? 'შეიყვანეთ მოცულობა.' : 'Enter a volume.';
    }
    if (volumeL > maxVolumeL + 0.001) {
      return ka
        ? `მაქსიმუმი ${round1(maxVolumeL)} ლ.`
        : `At most ${round1(maxVolumeL)} L will fit.`;
    }
    if (!Number.isFinite(lossL) || lossL < 0 || lossL >= volumeL) {
      return ka ? 'დანაკარგი მოცულობაზე ნაკლები უნდა იყოს.' : 'Loss must be less than the volume moved.';
    }
    if (!pump.trim()) {
      return ka ? 'მიუთითეთ ტუმბო.' : 'Name the pump used.';
    }
    return null;
  }, [ka, lossL, maxVolumeL, pump, volumeL]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (issue || busy) return;
    onConfirm({ volumeLiters: volumeL, lossLiters: lossL, category, pump: pump.trim() });
  };

  const field = 'min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-sm font-bold text-stone-900 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100';
  const label = 'mb-1 block text-[9px] font-mono font-black uppercase tracking-[0.16em] text-stone-500';

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-stone-950/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ka ? 'გადატანის ჩაწერა' : 'Record transfer'}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-900"
      >
        <header className="flex items-start justify-between gap-3 border-b border-stone-100 p-4 dark:border-stone-800">
          <div className="min-w-0">
            <span className="block text-[9px] font-mono font-black uppercase tracking-[0.18em] text-stone-400">
              {ka ? 'გადატანის ჩაწერა' : 'Record transfer'}
            </span>
            <strong className="mt-1 flex items-center gap-2 text-sm font-black text-stone-900 dark:text-stone-100">
              <span className="truncate">{source.id}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#651522] dark:text-amber-300" />
              <span className="truncate">{destination.id}</span>
            </strong>
            {sourceLot && (
              <span className="mt-0.5 block truncate text-[11px] font-semibold text-stone-500">
                {sourceLot.name}
              </span>
            )}
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

        <form onSubmit={submit} className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label} htmlFor="map-transfer-volume">{ka ? 'მოცულობა (ლ)' : 'Volume (L)'}</label>
              <input
                id="map-transfer-volume"
                type="number"
                min={0}
                step="0.1"
                value={volume}
                onChange={event => setVolume(event.target.value)}
                className={field}
                autoFocus
              />
              <p className="mt-1 text-[10px] font-semibold text-stone-500">
                {ka ? 'მაქსიმუმი' : 'Up to'} <span className="font-mono">{round1(maxVolumeL)} L</span>
              </p>
            </div>
            <div>
              <label className={label} htmlFor="map-transfer-loss">{ka ? 'დანაკარგი (ლ)' : 'Loss (L)'}</label>
              <input
                id="map-transfer-loss"
                type="number"
                min={0}
                step="0.1"
                value={loss}
                onChange={event => setLoss(event.target.value)}
                className={field}
              />
              <p className="mt-1 text-[10px] font-semibold text-stone-500">
                {ka ? 'მიდის' : 'Arrives'}{' '}
                <span className="font-mono">
                  {Number.isFinite(volumeL) && volumeL > lossL ? round1(volumeL - lossL) : 0} L
                </span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label} htmlFor="map-transfer-category">{ka ? 'მიზეზი' : 'Reason'}</label>
              <select
                id="map-transfer-category"
                value={category}
                onChange={event => setCategory(event.target.value as TransferCategory)}
                className={field}
              >
                {CATEGORIES.map(entry => (
                  <option key={entry.value} value={entry.value}>{ka ? entry.ka : entry.en}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="map-transfer-pump">{ka ? 'ტუმბო' : 'Pump'}</label>
              <input
                id="map-transfer-pump"
                value={pump}
                onChange={event => setPump(event.target.value)}
                placeholder="Enopump E-400"
                className={field}
              />
            </div>
          </div>

          <p className="text-[10px] font-semibold text-stone-500">
            {ka ? 'ოპერატორი' : 'Operator'}: <span className="font-bold text-stone-700 dark:text-stone-300">{operatorName}</span>
          </p>

          {(issue || error) && (
            <p className="rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-[11px] font-bold text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
              {error || issue}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={Boolean(issue) || busy}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#4e0e15] px-4 text-xs font-black text-amber-50 enabled:hover:bg-[#651522] disabled:opacity-40"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {ka ? 'გადატანის ჩაწერა' : 'Record transfer'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 rounded-lg border border-stone-200 px-3 text-xs font-bold text-stone-500 hover:text-stone-800 dark:border-stone-700"
            >
              {ka ? 'გაუქმება' : 'Cancel'}
            </button>
          </div>

          {onOpenFullTransfer && (
            <button
              type="button"
              onClick={onOpenFullTransfer}
              className="w-full text-[10px] font-bold text-stone-500 underline-offset-2 hover:text-[#651522] hover:underline dark:hover:text-amber-300"
            >
              {ka ? 'სრული გადატანის ფორმა (დანამატები, ისტორია)' : 'Full transfer form (materials, history)'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
