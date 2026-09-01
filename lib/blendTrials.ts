import type { LabAnalysis, WineLot } from './wineryState';
import type { CostEntry } from './costing/types';
import { summarizeLot } from './costing/engine';

/**
 * Blend trials: proposing a blend without committing one.
 *
 * Blending is where a winemaker spends their judgement, and until now the only
 * way to ask "what would this taste like, cost, and analyse as" was to do it.
 * A trial is a saved candidate — components and volumes, nothing more — that
 * touches no vessel, no lot volume and no ledger. It predicts; the existing
 * blend workflow is what commits.
 *
 * Every prediction here is a straight volume-weighted average of what has
 * already been measured. That is honest for alcohol, sugar and titratable
 * acidity at the proportions a cellar actually blends at, and it is
 * deliberately NOT offered for anything it would be wrong about — see
 * [PREDICTABLE_ANALYTES].
 */

export interface BlendTrialComponent {
  lotId: string;
  volumeL: number;
}

export type BlendTrialStatus = 'draft' | 'accepted' | 'discarded';

export interface BlendTrial {
  id: string;
  title: string;
  components: BlendTrialComponent[];
  status: BlendTrialStatus;
  notes: string;
  createdAt: string;
  createdBy: string;
  lastModified?: string;
}

/**
 * Analytes whose blend value is a volume-weighted mean of the components.
 *
 * pH is excluded on purpose. It is a logarithm of hydrogen ion concentration,
 * so averaging two pH readings is not what the blend will measure — and a
 * confidently wrong pH is worse than none, because it is the number that
 * decides SO₂ additions. Titratable acidity, which does blend linearly, is
 * reported instead.
 */
export const PREDICTABLE_ANALYTES = [
  'alcoholPct',
  'titratableAcidity',
  'residualSugar',
  'volatileAcid',
  'freeSo2',
  'totalSo2',
  'malicAcid',
] as const;

export type PredictableAnalyte = (typeof PREDICTABLE_ANALYTES)[number];

export interface BlendTrialComponentSummary {
  lotId: string;
  lotName: string;
  volumeL: number;
  /** Share of the finished blend, 0–1. */
  share: number;
  /** Volume the lot actually has, so an over-draw is visible. */
  availableL: number;
  costPerLitre: number | null;
}

export interface BlendTrialSummary {
  totalVolumeL: number;
  components: BlendTrialComponentSummary[];
  /** Weighted means, keyed by analyte. Absent when no component has a reading. */
  analysis: Partial<Record<PredictableAnalyte, number>>;
  /** Analytes only some components have measured, so the mean is partial. */
  partialAnalytes: PredictableAnalyte[];
  costPerLitre: number | null;
  issues: BlendTrialIssue[];
}

export type BlendTrialIssue =
  | { kind: 'too_few_components' }
  | { kind: 'duplicate_lot'; lotId: string }
  | { kind: 'no_volume'; lotId: string }
  | { kind: 'over_draw'; lotId: string; requested: number; available: number }
  | { kind: 'unknown_lot'; lotId: string };

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** The most recent analysis for a lot, or nothing if it has never been measured. */
export function latestAnalysisFor(lotId: string, labLogs: LabAnalysis[]): LabAnalysis | undefined {
  let latest: LabAnalysis | undefined;
  for (const entry of labLogs) {
    if (entry.lotId !== lotId) continue;
    if (!latest || entry.date > latest.date) latest = entry;
  }
  return latest;
}

/**
 * What this trial would produce.
 *
 * Reports problems rather than throwing: a half-built trial is the normal state
 * of one being worked on, and the panel wants to show the numbers so far
 * alongside what is still wrong with it.
 */
export function summarizeBlendTrial(input: {
  trial: Pick<BlendTrial, 'components'>;
  lots: WineLot[];
  labLogs: LabAnalysis[];
  costEntries: CostEntry[];
}): BlendTrialSummary {
  const { trial, lots, labLogs, costEntries } = input;
  const lotsById = new Map(lots.map(lot => [lot.id, lot]));
  const issues: BlendTrialIssue[] = [];
  const seen = new Set<string>();

  const usable = trial.components.filter(component => {
    const lot = lotsById.get(component.lotId);
    if (!lot) {
      issues.push({ kind: 'unknown_lot', lotId: component.lotId });
      return false;
    }
    if (seen.has(component.lotId)) {
      issues.push({ kind: 'duplicate_lot', lotId: component.lotId });
      return false;
    }
    seen.add(component.lotId);
    if (!(component.volumeL > 0)) {
      issues.push({ kind: 'no_volume', lotId: component.lotId });
      return false;
    }
    if (component.volumeL > (lot.currentVolume || 0)) {
      issues.push({
        kind: 'over_draw',
        lotId: component.lotId,
        requested: component.volumeL,
        available: lot.currentVolume || 0,
      });
    }
    return true;
  });

  if (usable.length < 2) issues.push({ kind: 'too_few_components' });

  const totalVolumeL = round(usable.reduce((sum, component) => sum + component.volumeL, 0), 3);

  const components: BlendTrialComponentSummary[] = usable.map(component => {
    const lot = lotsById.get(component.lotId)!;
    const lotVolume = lot.currentVolume || 0;
    // A lot nobody has costed has an UNKNOWN cost, not a zero one. Reporting
    // 0/L would read as "this blend is free" and someone could price off it.
    const hasCost = costEntries.some(entry => entry.lotId === component.lotId);
    const lotCost = hasCost ? summarizeLot(component.lotId, costEntries).total : null;
    return {
      lotId: component.lotId,
      lotName: lot.name,
      volumeL: component.volumeL,
      share: totalVolumeL > 0 ? round(component.volumeL / totalVolumeL, 4) : 0,
      availableL: lotVolume,
      costPerLitre: lotCost !== null && lotVolume > 0 ? round(lotCost / lotVolume, 4) : null,
    };
  });

  const analysis: Partial<Record<PredictableAnalyte, number>> = {};
  const partialAnalytes: PredictableAnalyte[] = [];

  if (totalVolumeL > 0) {
    for (const analyte of PREDICTABLE_ANALYTES) {
      let weighted = 0;
      let measuredVolume = 0;
      for (const component of usable) {
        const reading = latestAnalysisFor(component.lotId, labLogs);
        const value = reading?.[analyte];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        weighted += value * component.volumeL;
        measuredVolume += component.volumeL;
      }
      if (measuredVolume <= 0) continue;
      // Weighted by the volume that was actually measured, so an unmeasured
      // component pulls the mean toward nothing rather than toward zero.
      analysis[analyte] = round(weighted / measuredVolume, 3);
      if (measuredVolume < totalVolumeL) partialAnalytes.push(analyte);
    }
  }

  const costed = components.filter(component => component.costPerLitre !== null);
  const costPerLitre = costed.length && totalVolumeL > 0
    ? round(
      costed.reduce((sum, component) => sum + (component.costPerLitre as number) * component.volumeL, 0)
        / costed.reduce((sum, component) => sum + component.volumeL, 0),
      4,
    )
    : null;

  return { totalVolumeL, components, analysis, partialAnalytes, costPerLitre, issues };
}

/** Problems that must be fixed before a trial could be committed as a blend. */
export function blockingBlendTrialIssues(summary: BlendTrialSummary): BlendTrialIssue[] {
  return summary.issues.filter(issue => issue.kind !== 'no_volume');
}

export function blendTrialIssueMessage(issue: BlendTrialIssue, lang: 'en' | 'ka'): string {
  const ka = lang === 'ka';
  switch (issue.kind) {
    case 'too_few_components':
      return ka ? 'კუპაჟს სულ მცირე ორი პარტია სჭირდება.' : 'A blend needs at least two lots.';
    case 'duplicate_lot':
      return ka
        ? `პარტია ${issue.lotId} ორჯერაა დამატებული.`
        : `Lot ${issue.lotId} is listed twice.`;
    case 'no_volume':
      return ka
        ? `მიუთითეთ ${issue.lotId}-ის მოცულობა.`
        : `Enter a volume for ${issue.lotId}.`;
    case 'over_draw':
      return ka
        ? `${issue.lotId}: მოთხოვნილია ${issue.requested} ლ, ხელმისაწვდომია ${issue.available} ლ.`
        : `${issue.lotId}: ${issue.requested} L requested but only ${issue.available} L available.`;
    case 'unknown_lot':
      return ka
        ? `პარტია ${issue.lotId} ვეღარ მოიძებნა.`
        : `Lot ${issue.lotId} no longer exists.`;
  }
}
