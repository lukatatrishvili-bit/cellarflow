import React, { useRef } from 'react';
import { X } from 'lucide-react';
import type { Language } from '../lib/i18n';
import { useFocusTrap } from './useFocusTrap';

export interface SyncConflictRecord {
  collection: string;
  recordId: string;
  local?: Record<string, unknown> | null;
  server?: Record<string, unknown> | null;
}

type ResolutionChoice = 'local' | 'server';

interface SyncConflictResolutionModalProps {
  lang: Language;
  conflicts: SyncConflictRecord[];
  resolutions: Record<string, ResolutionChoice>;
  onChoose: (key: string, choice: ResolutionChoice) => void;
  onResolve: () => void;
  onClose: () => void;
}

function changedFields(conflict: SyncConflictRecord): string[] {
  const local = conflict.local || {};
  const server = conflict.server || {};
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  return [...keys].filter((key) => {
    if (key === 'lastModified' || key === 'history' || key === 'notesList') return false;
    return JSON.stringify(local[key]) !== JSON.stringify(server[key]);
  });
}

function displayedValue(value: unknown): string {
  if (value === undefined) return '—';
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

export default function SyncConflictResolutionModal({
  lang,
  conflicts,
  resolutions,
  onChoose,
  onResolve,
  onClose,
}: SyncConflictResolutionModalProps) {
  const ka = lang === 'ka';
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, { active: true, onClose });
  const allResolved = conflicts.every(conflict => (
    resolutions[`${conflict.collection}-${conflict.recordId}`] === 'local'
    || resolutions[`${conflict.collection}-${conflict.recordId}`] === 'server'
  ));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-xs">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-conflict-title"
        aria-describedby="sync-conflict-description"
        tabIndex={-1}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white text-stone-850 shadow-2xl animate-scale-up"
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 bg-stone-50 px-6 py-4">
          <div>
            <h3 id="sync-conflict-title" className="font-serif text-base font-black text-[#4e0e15]">
              {ka ? 'სინქრონიზაციის კონფლიქტების მოგვარება' : 'Sync Conflict Resolution'}
            </h3>
            <p id="sync-conflict-description" className="mt-1 text-xs leading-relaxed text-slate-500">
              {ka
                ? 'ჩანაწერები შეიცვალა როგორც ამ მოწყობილობაზე, ისე სერვერზე. თითოეულისთვის აირჩიეთ შესანახი ვერსია.'
                : 'These records changed both on this device and on the server. Choose which version to keep for each one.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={ka ? 'კონფლიქტების მოგვიანებით განხილვა' : 'Review sync conflicts later'}
            className="shrink-0 rounded-lg p-2 text-stone-500 hover:bg-stone-200 hover:text-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#801323]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6 font-sans">
          {conflicts.map((conflict) => {
            const key = `${conflict.collection}-${conflict.recordId}`;
            const currentChoice = resolutions[key];
            const diffKeys = changedFields(conflict);
            const options: Array<{ choice: ResolutionChoice; label: string; record: Record<string, unknown> }> = [
              {
                choice: 'local',
                label: ka ? 'ლოკალური ვერსია (ოფლაინ)' : 'Local Version (Offline)',
                record: conflict.local || {},
              },
              {
                choice: 'server',
                label: ka ? 'სერვერის ვერსია (ახალი)' : 'Server Version (Remote)',
                record: conflict.server || {},
              },
            ];

            return (
              <section key={key} className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-stone-50 px-4 py-2 font-mono text-xs font-bold text-stone-700">
                  <span>{ka ? 'კოლექცია:' : 'Collection:'} {conflict.collection}</span>
                  <span>ID: {conflict.recordId}</span>
                </div>

                <div
                  role="radiogroup"
                  aria-label={ka ? `${conflict.recordId}: შესანახი ვერსია` : `${conflict.recordId}: version to keep`}
                  className="grid grid-cols-1 divide-y divide-stone-200 md:grid-cols-2 md:divide-x md:divide-y-0"
                >
                  {options.map(({ choice, label, record }) => {
                    const selected = currentChoice === choice;
                    return (
                      <button
                        key={choice}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChoose(key, choice)}
                        className={`p-4 text-left transition-all focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-700 ${
                          selected
                            ? 'bg-emerald-50/60 ring-2 ring-inset ring-emerald-600'
                            : 'hover:bg-stone-50/60'
                        }`}
                      >
                        <span className="mb-3 flex items-center justify-between gap-3">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
                          {selected && (
                            <span className="shrink-0 text-xs font-black text-emerald-700">
                              {ka ? '✓ არჩეულია' : '✓ Selected'}
                            </span>
                          )}
                        </span>

                        <span className="block space-y-1.5 font-mono text-xs">
                          {diffKeys.length === 0 && (
                            <span className="block text-slate-500">{ka ? 'ველებში განსხვავება არ არის.' : 'No field differences.'}</span>
                          )}
                          {diffKeys.map((field) => (
                            <span key={field} className="flex items-start justify-between gap-3 border-b border-stone-100 pb-1">
                              <span className="shrink-0 text-slate-500">{field}:</span>
                              <span className="min-w-0 break-all text-right font-semibold text-stone-800">
                                {displayedValue(record[field])}
                              </span>
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-stone-200 bg-stone-50 px-6 py-4">
          {!allResolved && (
            <p role="status" className="mr-auto self-center text-xs font-semibold text-amber-800">
              {ka ? 'გასაგრძელებლად თითოეულ კონფლიქტზე აირჩიეთ ვერსია.' : 'Choose a version for every conflict to continue.'}
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-bold text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#801323]"
          >
            {ka ? 'მოგვიანებით' : 'Review later'}
          </button>
          <button
            type="button"
            onClick={() => { if (allResolved) onResolve(); }}
            disabled={!allResolved}
            className="rounded-lg bg-[#4e0e15] px-4 py-2 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#801323] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#801323] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {ka ? 'შენახვა და შერწყმა' : 'Apply and Resolve Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
