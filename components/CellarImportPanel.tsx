import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, Upload } from 'lucide-react';
import type { Language } from '../lib/language';
import type { Vessel, WineLot } from '../lib/wineryState';
import {
  applyImport,
  importTemplateCsv,
  previewLotImport,
  previewVesselImport,
  type ImportPreview,
} from '../lib/cellarImport';

/**
 * Bulk import for vessels and lots.
 *
 * The screen is deliberately a two-step: choose a file, read what it will do,
 * then decide. Nothing is written by picking a file. An import that silently
 * half-applies to live cellar records is worse than one that refuses, and the
 * person doing it is usually migrating in a hurry from another system.
 */

type ImportKind = 'vessels' | 'lots';

interface CellarImportPanelProps {
  lang?: Language;
  vessels: Vessel[];
  lots: WineLot[];
  canImport: boolean;
  onImportVessels: (vessels: Vessel[]) => void;
  onImportLots: (lots: WineLot[]) => void;
  setToastMessage?: (message: string | null) => void;
}

/** Enough rows to judge the file without turning the panel into a spreadsheet. */
const PREVIEW_ROW_LIMIT = 12;

export function CellarImportPanel({
  lang,
  vessels,
  lots,
  canImport,
  onImportVessels,
  onImportLots,
  setToastMessage,
}: CellarImportPanelProps) {
  const ka = lang === 'ka';
  const [kind, setKind] = useState<ImportKind>('vessels');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const preview = useMemo<ImportPreview<Vessel> | ImportPreview<WineLot> | null>(() => {
    if (!csv.trim()) return null;
    return kind === 'vessels'
      ? previewVesselImport({ csv, existing: vessels })
      : previewLotImport({ csv, existing: lots, now: new Date().toISOString() });
  }, [csv, kind, vessels, lots]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
  };

  const reset = () => {
    setCsv('');
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const runImport = () => {
    if (!preview) return;
    if (kind === 'vessels') {
      onImportVessels(applyImport(vessels, preview as ImportPreview<Vessel>));
    } else {
      onImportLots(applyImport(lots, preview as ImportPreview<WineLot>));
    }
    const total = preview.created + preview.updated;
    setToastMessage?.(ka
      ? `${total} ჩანაწერი დაიმპორტდა.`
      : `${total} record${total === 1 ? '' : 's'} imported.`);
    reset();
  };

  const downloadTemplate = () => {
    const blob = new Blob([importTemplateCsv(kind)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `vinos-${kind}-template.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const blocked = Boolean(preview?.missingColumns.length);
  const importable = preview ? preview.created + preview.updated : 0;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h2 className="flex items-center gap-2 text-sm font-black text-stone-900 dark:text-stone-100">
        <FileUp className="h-4 w-4 text-[#651522] dark:text-amber-300" />
        {ka ? 'მასობრივი იმპორტი' : 'Bulk import'}
      </h2>
      <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
        {ka
          ? 'ატვირთეთ CSV ფაილი ჭურჭლის ან პარტიების ერთიანად შესატანად. ჯერ ნახავთ, რა მოხდება.'
          : 'Bring vessels or lots over from a spreadsheet. You see exactly what will happen before anything is written.'}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-950" role="tablist">
          {(['vessels', 'lots'] as ImportKind[]).map(value => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              onClick={() => { setKind(value); reset(); }}
              className={'min-h-9 rounded-lg px-3 text-[10px] font-black ' + (kind === value
                ? 'bg-white text-[#651522] shadow-sm dark:bg-stone-800 dark:text-amber-200'
                : 'text-stone-500')}
            >
              {value === 'vessels' ? (ka ? 'ჭურჭელი' : 'Vessels') : (ka ? 'პარტიები' : 'Lots')}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={downloadTemplate}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-stone-200 px-3 text-[10px] font-black text-stone-600 hover:border-[#651522]/40 dark:border-stone-700 dark:text-stone-300"
        >
          <Download className="h-3.5 w-3.5" />
          {ka ? 'შაბლონი' : 'Template'}
        </button>
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-stone-300 p-3 text-[11px] font-bold text-stone-600 hover:border-[#651522]/50 dark:border-stone-700 dark:text-stone-300">
        <Upload className="h-4 w-4" />
        <span>{fileName || (ka ? 'აირჩიეთ CSV ფაილი' : 'Choose a CSV file')}</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={event => { void readFile(event.target.files?.[0]); }}
        />
      </label>

      {preview && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold">
            <span className="text-emerald-700 dark:text-emerald-300">
              {preview.created} {ka ? 'ახალი' : 'new'}
            </span>
            <span className="text-blue-700 dark:text-blue-300">
              {preview.updated} {ka ? 'განახლდება' : 'updated'}
            </span>
            <span className={preview.skipped ? 'text-rose-600 dark:text-rose-300' : 'text-stone-400'}>
              {preview.skipped} {ka ? 'გამოტოვებული' : 'skipped'}
            </span>
          </div>

          {blocked && (
            <p className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-[11px] font-bold text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {ka ? 'ფაილს აკლია სავალდებულო სვეტები: ' : 'The file is missing required columns: '}
              {preview.missingColumns.join(', ')}
            </p>
          )}

          {preview.unknownColumns.length > 0 && (
            <p className="text-[10px] text-stone-500 dark:text-stone-400">
              {ka ? 'გამოუყენებელი სვეტები: ' : 'Columns this importer ignores: '}
              {preview.unknownColumns.join(', ')}
            </p>
          )}

          {preview.skipped > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-stone-200 p-2 dark:border-stone-800">
              {preview.rows.filter(row => row.action === 'skip').slice(0, PREVIEW_ROW_LIMIT).map(row => (
                <li key={row.line} className="text-[10px] text-stone-600 dark:text-stone-300">
                  <strong className="font-mono">{ka ? 'ხაზი' : 'Line'} {row.line}</strong>
                  {' — '}
                  {row.issues.join(' ')}
                </li>
              ))}
              {preview.skipped > PREVIEW_ROW_LIMIT && (
                <li className="text-[10px] font-bold text-stone-400">
                  {ka ? 'და კიდევ ' : 'and '}{preview.skipped - PREVIEW_ROW_LIMIT}{ka ? '' : ' more'}…
                </li>
              )}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canImport || blocked || importable === 0}
              onClick={runImport}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#4e0e15] px-4 text-[11px] font-black text-amber-50 enabled:hover:bg-[#651522] disabled:opacity-40"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {ka ? 'იმპორტი' : 'Import'} {importable > 0 && <span className="font-mono">· {importable}</span>}
            </button>
            <button
              type="button"
              onClick={reset}
              className="min-h-10 rounded-lg border border-stone-200 px-3 text-[11px] font-bold text-stone-500 hover:text-stone-800 dark:border-stone-700"
            >
              {ka ? 'გაუქმება' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default React.memo(CellarImportPanel);
