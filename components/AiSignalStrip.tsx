import React, { useMemo, useState } from 'react';
import { BrainCircuit, ChevronRight, X } from 'lucide-react';
import type { Language } from '../lib/i18n';
import {
  SEVERITY_LABELS,
  filterFindingsRoutedToRole,
  localize,
  severityRank,
  type AiFinding,
  type AiMonitoringArea,
  type AiSeverity,
  type UserRole,
} from '../lib/ai';

/**
 * Contextual intelligence, in place. The product principle is that AI shows up
 * where the work is rather than behind an "Ask AI" button on every screen — so
 * the fermentation tab surfaces fermentation findings, the inventory tab
 * surfaces stock findings, and a screen with nothing to say stays silent.
 */

/** Monitoring areas worth surfacing on each winery tab. */
const TAB_AREAS: Record<string, AiMonitoringArea[]> = {
  dashboard: ['fermentation', 'laboratory', 'inventory', 'compliance', 'operations'],
  vessels: ['fermentation', 'operations'],
  fermentation: ['fermentation'],
  labs: ['laboratory'],
  inventory: ['inventory'],
  bottling: ['operations', 'compliance'],
  transfers: ['operations'],
  operations: ['operations', 'fermentation'],
  lots: ['compliance', 'laboratory'],
  tasks: ['operations'],
};

const SEVERITY_TONE: Record<AiSeverity, string> = {
  critical: 'border-rose-200 bg-rose-50 text-rose-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  attention: 'border-sky-200 bg-sky-50 text-sky-900',
  info: 'border-stone-200 bg-stone-50 text-stone-700',
};

interface Props {
  findings: AiFinding[];
  activeTab: string;
  role: UserRole;
  lang: Language;
  /** Opens the full intelligence centre. */
  onOpen: () => void;
}

export default function AiSignalStrip({ findings, activeTab, role, lang, onOpen }: Props) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const isKa = lang === 'ka';

  const relevant = useMemo(() => {
    const areas = TAB_AREAS[activeTab];
    if (!areas) return [];
    // Interrupting a working screen is a routing decision, not a visibility one.
    return filterFindingsRoutedToRole(findings, role)
      .filter((finding) => areas.includes(finding.area))
      // Only genuinely actionable severities interrupt a working screen.
      .filter((finding) => severityRank(finding.severity) >= severityRank('warning'))
      .filter((finding) => !dismissed.includes(finding.id))
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
      .slice(0, 2);
  }, [findings, activeTab, role, dismissed]);

  if (relevant.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {relevant.map((finding) => (
        <div
          key={finding.id}
          className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${SEVERITY_TONE[finding.severity]}`}
        >
          <BrainCircuit className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold">
              <span className="mr-1.5 font-mono text-[9px] uppercase opacity-70">
                {localize(SEVERITY_LABELS[finding.severity], lang)}
              </span>
              {localize(finding.title, lang)}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed opacity-90">
              {localize(finding.observation, lang)}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex shrink-0 items-center gap-0.5 rounded border border-current/20 px-1.5 py-0.5 text-[10px] font-semibold"
          >
            {isKa ? 'დეტალები' : 'Details'}
            <ChevronRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label={isKa ? 'დამალვა' : 'Hide'}
            onClick={() => setDismissed((current) => [...current, finding.id])}
            className="shrink-0 rounded p-0.5 opacity-50 hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
