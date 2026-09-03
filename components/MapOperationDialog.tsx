import React, { useMemo, useRef, useState } from 'react';
import { ClipboardCheck, Loader2, X } from 'lucide-react';
import type { Language } from '../lib/language';
import type {
  CellarOperationType,
  InventoryItem,
  Vessel,
  WineLot,
} from '../lib/wineryState';
import { CELLAR_OPERATIONS, QUICK_CELLAR_OPERATIONS } from '../lib/wineryOperations';
import { planTopping, toppingIssueMessage } from '../lib/topping';
import { useFocusTrap } from './useFocusTrap';

/**
 * Recording a cellar operation without leaving the map.
 *
 * Pressing "Record operation" on a tank used to swap the whole screen to the
 * treatments tab and swap back afterwards — there was a `returnTab` parameter
 * whose only job was remembering where to put you. The vessel and its lot were
 * already known from the tank you pointed at, so the round trip existed to ask
 * for things the app had.
 *
 * This asks only what is genuinely still open, and which fields those are
 * depends on the operation: a material and dose for an addition, litres and a
 * source for topping, a resulting volume for anything that changes one. The
 * long tail — multiple materials, cost drivers, the ledger and reversals — is
 * still the treatments screen's job, and the link at the bottom goes there.
 */

export interface MapOperationDialogProps {
  lang?: Language;
  vessel: Vessel;
  lot: WineLot | null;
  vessels: Vessel[];
  lots: WineLot[];
  inventory: InventoryItem[];
  operatorName: string;
  initialType?: CellarOperationType;
  /** Litres asked for elsewhere, e.g. typed in the command palette. */
  initialLitres?: number;
  canUseMaterials?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (input: {
    type: CellarOperationType;
    volumeAfterL?: number;
    sourceVesselId?: string;
    toppingVolumeL?: number;
    materialId?: string;
    dose?: number;
    notes: string;
  }) => void;
  onOpenFullRecorder?: () => void;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export default function MapOperationDialog({
  lang,
  vessel,
  lot,
  vessels,
  lots,
  inventory,
  operatorName,
  initialType,
  initialLitres,
  canUseMaterials = true,
  busy = false,
  error,
  onCancel,
  onConfirm,
  onOpenFullRecorder,
}: MapOperationDialogProps) {
  const ka = lang === 'ka';
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { active: true, onClose: onCancel });

  const [type, setType] = useState<CellarOperationType>(
    initialType && QUICK_CELLAR_OPERATIONS.some(entry => entry.key === initialType)
      ? initialType
      : 'measurement',
  );
  const [notes, setNotes] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [dose, setDose] = useState('');
  const [sourceVesselId, setSourceVesselId] = useState('');
  const [litres, setLitres] = useState(initialLitres !== undefined ? String(initialLitres) : '');
  const [volumeAfter, setVolumeAfter] = useState('');

  const meta = CELLAR_OPERATIONS.find(entry => entry.key === type);
  const needsMaterial = Boolean(meta?.needsMaterial) && canUseMaterials;
  const needsSource = Boolean(meta?.needsSourceVessel);
  // Topping states its own volume as litres added, so it never asks for a total.
  const needsVolume = Boolean(meta?.affectsVolume) && !needsSource;

  const material = inventory.find(item => item.id === materialId);
  const doseValue = Number(dose);
  const litresValue = Number(litres);
  const volumeValue = Number(volumeAfter);

  const sourceOptions = useMemo(
    () => vessels.filter(entry => entry.id !== vessel.id && entry.assignedLotId && entry.currentVolume > 0),
    [vessels, vessel.id],
  );

  const issue = useMemo(() => {
    if (!lot) return ka ? 'ამ ჭურჭელს პარტია არ აქვს.' : 'This vessel holds no lot.';
    if (needsMaterial && materialId && !(doseValue > 0)) {
      return ka ? 'შეიყვანეთ დოზა.' : 'Enter a dose.';
    }
    if (needsMaterial && materialId && material && doseValue > material.stock) {
      return ka ? 'მარაგში საკმარისი რაოდენობა არ არის.' : 'Not enough of that material in stock.';
    }
    if (needsVolume && !(volumeValue >= 0) ) {
      return ka ? 'შეიყვანეთ მოცულობა.' : 'Enter the resulting volume.';
    }
    if (needsSource) {
      const checked = planTopping({
        toppedVessel: vessel,
        toppedLotId: lot.id,
        sourceVesselId,
        vessels,
        lots,
        volumeL: litresValue,
      });
      if (!checked.ok) return toppingIssueMessage(checked.issue, ka ? 'ka' : 'en');
    }
    return null;
  }, [ka, lot, needsMaterial, materialId, doseValue, material, needsVolume, volumeValue,
    needsSource, vessel, sourceVesselId, vessels, lots, litresValue]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (issue || busy) return;
    onConfirm({
      type,
      ...(needsVolume ? { volumeAfterL: volumeValue } : {}),
      ...(needsSource ? { sourceVesselId, toppingVolumeL: litresValue } : {}),
      ...(needsMaterial && materialId && doseValue > 0 ? { materialId, dose: doseValue } : {}),
      notes: notes.trim(),
    });
  };

  const field = 'min-h-10 w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-sm font-bold text-stone-900 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100';
  const label = 'mb-1 block text-[9px] font-mono font-black uppercase tracking-[0.16em] text-stone-500';

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-stone-950/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ka ? 'ოპერაციის ჩაწერა' : 'Record operation'}
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-900"
      >
        <header className="flex items-start justify-between gap-3 border-b border-stone-100 p-4 dark:border-stone-800">
          <div className="min-w-0">
            <span className="block text-[9px] font-mono font-black uppercase tracking-[0.18em] text-stone-400">
              {ka ? 'ოპერაციის ჩაწერა' : 'Record operation'}
            </span>
            <strong className="mt-1 block truncate text-sm font-black text-stone-900 dark:text-stone-100">
              {vessel.id}
            </strong>
            <span className="mt-0.5 block truncate text-[11px] font-semibold text-stone-500">
              {lot ? `${lot.name} · ${round1(vessel.currentVolume)} L` : (ka ? 'პარტიის გარეშე' : 'No lot assigned')}
            </span>
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

        <form onSubmit={submit} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div>
            <label className={label} htmlFor="map-operation-type">{ka ? 'ოპერაცია' : 'Operation'}</label>
            <select
              id="map-operation-type"
              value={type}
              onChange={event => {
                setType(event.target.value as CellarOperationType);
                // Fields belong to the operation that asked for them.
                setMaterialId('');
                setDose('');
                setSourceVesselId('');
                setLitres('');
                setVolumeAfter('');
              }}
              className={field}
            >
              {QUICK_CELLAR_OPERATIONS.map(entry => (
                <option key={entry.key} value={entry.key}>{ka ? entry.ka : entry.en}</option>
              ))}
            </select>
          </div>

          {needsSource && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label} htmlFor="map-operation-source">{ka ? 'დოლივის წყარო' : 'Topping source'}</label>
                <select
                  id="map-operation-source"
                  value={sourceVesselId}
                  onChange={event => setSourceVesselId(event.target.value)}
                  className={field}
                >
                  <option value="">{ka ? '— აირჩიეთ —' : '— select —'}</option>
                  {sourceOptions.map(entry => (
                    <option key={entry.id} value={entry.id}>{entry.id} — {round1(entry.currentVolume)} L</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="map-operation-litres">{ka ? 'დამატებული (ლ)' : 'Litres added'}</label>
                <input
                  id="map-operation-litres"
                  type="number"
                  min={0}
                  step="0.1"
                  value={litres}
                  onChange={event => setLitres(event.target.value)}
                  className={field}
                />
                <p className="mt-1 text-[10px] font-semibold text-stone-500">
                  {ka ? 'თავისუფალი' : 'Headroom'}{' '}
                  <span className="font-mono">{round1(Math.max(0, vessel.capacity - vessel.currentVolume))} L</span>
                </p>
              </div>
            </div>
          )}

          {needsVolume && (
            <div>
              <label className={label} htmlFor="map-operation-volume">{ka ? 'მოცულობა მერე (ლ)' : 'Volume after (L)'}</label>
              <input
                id="map-operation-volume"
                type="number"
                min={0}
                step="0.1"
                value={volumeAfter}
                onChange={event => setVolumeAfter(event.target.value)}
                placeholder={lot ? String(round1(lot.currentVolume)) : ''}
                className={field}
              />
              {lot && (
                <p className="mt-1 text-[10px] font-semibold text-stone-500">
                  {ka ? 'ახლა' : 'Currently'} <span className="font-mono">{round1(lot.currentVolume)} L</span>
                </p>
              )}
            </div>
          )}

          {needsMaterial && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label} htmlFor="map-operation-material">{ka ? 'მასალა' : 'Material'}</label>
                <select
                  id="map-operation-material"
                  value={materialId}
                  onChange={event => setMaterialId(event.target.value)}
                  className={field}
                >
                  <option value="">{ka ? '— არცერთი —' : '— none —'}</option>
                  {inventory.filter(item => item.stock > 0).map(item => (
                    <option key={item.id} value={item.id}>{item.name} ({round1(item.stock)} {item.unit})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="map-operation-dose">
                  {ka ? 'დოზა' : 'Dose'}{material?.unit ? ` (${material.unit})` : ''}
                </label>
                <input
                  id="map-operation-dose"
                  type="number"
                  min={0}
                  step="0.001"
                  value={dose}
                  onChange={event => setDose(event.target.value)}
                  disabled={!materialId}
                  className={`${field} disabled:opacity-40`}
                />
              </div>
            </div>
          )}

          <div>
            <label className={label} htmlFor="map-operation-notes">{ka ? 'შენიშვნა' : 'Notes'}</label>
            <input
              id="map-operation-notes"
              value={notes}
              onChange={event => setNotes(event.target.value)}
              className={field}
            />
          </div>

          <p className="text-[10px] font-semibold text-stone-500">
            {ka ? 'ოპერატორი' : 'Operator'}:{' '}
            <span className="font-bold text-stone-700 dark:text-stone-300">{operatorName}</span>
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
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
              {ka ? 'ჩაწერა' : 'Record'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 rounded-lg border border-stone-200 px-3 text-xs font-bold text-stone-500 hover:text-stone-800 dark:border-stone-700"
            >
              {ka ? 'გაუქმება' : 'Cancel'}
            </button>
          </div>

          {onOpenFullRecorder && (
            <button
              type="button"
              onClick={onOpenFullRecorder}
              className="w-full text-[10px] font-bold text-stone-500 underline-offset-2 hover:text-[#651522] hover:underline dark:hover:text-amber-300"
            >
              {ka ? 'სრული ფორმა (რამდენიმე მასალა, ისტორია)' : 'Full recorder (multiple materials, history)'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
