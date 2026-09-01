import { describe, expect, it } from 'vitest';
import {
  blendTrialIssueMessage,
  blockingBlendTrialIssues,
  latestAnalysisFor,
  PREDICTABLE_ANALYTES,
  summarizeBlendTrial,
  type BlendTrialIssue,
} from '../lib/blendTrials';
import type { LabAnalysis, WineLot } from '../lib/wineryState';
import type { CostEntry } from '../lib/costing/types';

const lot = (id: string, currentVolume: number): WineLot => ({
  id,
  name: `Lot ${id}`,
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'A',
  region: 'Kakheti',
  initialVolume: currentVolume,
  currentVolume,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-01-01T00:00:00.000Z',
  history: [],
});

const analysis = (lotId: string, date: string, patch: Partial<LabAnalysis> = {}): LabAnalysis => ({
  id: `lab-${lotId}-${date}`,
  lotId,
  tankId: 'T-1',
  date,
  alcoholPct: 13,
  volatileAcid: 0.4,
  freeSo2: 25,
  totalSo2: 80,
  residualSugar: 2,
  ph: 3.5,
  malicAcid: 0.1,
  lacticAcid: 1.2,
  turbidity: 1,
  technician: 'ana',
  titratableAcidity: 5.5,
  ...patch,
});

const cost = (lotId: string, amount: number): CostEntry => ({
  id: `cost-${lotId}`,
  date: '2026-01-01',
  lotId,
  category: 'fruit',
  description: 'Fruit',
  amount,
  currency: 'GEL',
});

const lots = [lot('A', 1000), lot('B', 500), lot('C', 200)];

const summarize = (
  components: Array<{ lotId: string; volumeL: number }>,
  labLogs: LabAnalysis[] = [],
  costEntries: CostEntry[] = [],
) => summarizeBlendTrial({ trial: { components }, lots, labLogs, costEntries });

describe('summarizeBlendTrial', () => {
  it('totals the blend and works out each share', () => {
    const summary = summarize([
      { lotId: 'A', volumeL: 750 },
      { lotId: 'B', volumeL: 250 },
    ]);

    expect(summary.totalVolumeL).toBe(1000);
    expect(summary.components.map(entry => entry.share)).toEqual([0.75, 0.25]);
    expect(summary.issues).toEqual([]);
  });

  it('predicts analytes as a volume-weighted mean', () => {
    const summary = summarize(
      [{ lotId: 'A', volumeL: 750 }, { lotId: 'B', volumeL: 250 }],
      [
        analysis('A', '2026-06-01', { alcoholPct: 12, titratableAcidity: 6 }),
        analysis('B', '2026-06-01', { alcoholPct: 16, titratableAcidity: 5 }),
      ],
    );

    // 12 × 0.75 + 16 × 0.25
    expect(summary.analysis.alcoholPct).toBe(13);
    expect(summary.analysis.titratableAcidity).toBe(5.75);
  });

  it('never predicts pH, which does not average', () => {
    const summary = summarize(
      [{ lotId: 'A', volumeL: 500 }, { lotId: 'B', volumeL: 500 }],
      [analysis('A', '2026-06-01', { ph: 3.2 }), analysis('B', '2026-06-01', { ph: 3.8 })],
    );

    expect(PREDICTABLE_ANALYTES).not.toContain('ph');
    expect('ph' in summary.analysis).toBe(false);
  });

  it('uses each lot’s most recent reading', () => {
    const summary = summarize(
      [{ lotId: 'A', volumeL: 500 }, { lotId: 'B', volumeL: 500 }],
      [
        analysis('A', '2026-01-01', { alcoholPct: 10 }),
        analysis('A', '2026-08-01', { alcoholPct: 14 }),
        analysis('B', '2026-08-01', { alcoholPct: 14 }),
      ],
    );

    expect(summary.analysis.alcoholPct).toBe(14);
  });

  it('flags a mean drawn from only some of the blend', () => {
    const summary = summarize(
      [{ lotId: 'A', volumeL: 500 }, { lotId: 'B', volumeL: 500 }],
      [analysis('A', '2026-06-01', { alcoholPct: 12 })],
    );

    // Weighted by the measured volume, so an unmeasured lot does not drag the
    // figure toward zero — but the caller is told the mean is partial.
    expect(summary.analysis.alcoholPct).toBe(12);
    expect(summary.partialAnalytes).toContain('alcoholPct');
  });

  it('reports nothing for an analyte nobody has measured', () => {
    const summary = summarize([{ lotId: 'A', volumeL: 500 }, { lotId: 'B', volumeL: 500 }]);

    expect(summary.analysis).toEqual({});
    expect(summary.partialAnalytes).toEqual([]);
  });

  it('predicts cost per litre from the components', () => {
    const summary = summarize(
      [{ lotId: 'A', volumeL: 500 }, { lotId: 'B', volumeL: 500 }],
      [],
      [cost('A', 2000), cost('B', 1000)],
    );

    // A is 2 GEL/L over 1000 L, B is 2 GEL/L over 500 L.
    expect(summary.components[0].costPerLitre).toBe(2);
    expect(summary.components[1].costPerLitre).toBe(2);
    expect(summary.costPerLitre).toBe(2);
  });

  it('reports no cost when no component has been costed', () => {
    const summary = summarize([{ lotId: 'A', volumeL: 500 }, { lotId: 'B', volumeL: 500 }]);

    expect(summary.costPerLitre).toBeNull();
  });

  it('flags drawing more than a lot holds without dropping the component', () => {
    const summary = summarize([{ lotId: 'A', volumeL: 500 }, { lotId: 'C', volumeL: 900 }]);

    expect(summary.issues).toContainEqual({
      kind: 'over_draw', lotId: 'C', requested: 900, available: 200,
    });
    expect(summary.totalVolumeL).toBe(1400);
  });

  it('flags a lot listed twice and counts it once', () => {
    const summary = summarize([
      { lotId: 'A', volumeL: 100 },
      { lotId: 'A', volumeL: 100 },
      { lotId: 'B', volumeL: 100 },
    ]);

    expect(summary.issues).toContainEqual({ kind: 'duplicate_lot', lotId: 'A' });
    expect(summary.totalVolumeL).toBe(200);
  });

  it('flags a lot that no longer exists', () => {
    const summary = summarize([{ lotId: 'A', volumeL: 100 }, { lotId: 'GONE', volumeL: 100 }]);

    expect(summary.issues).toContainEqual({ kind: 'unknown_lot', lotId: 'GONE' });
  });

  it('calls one component too few for a blend', () => {
    expect(summarize([{ lotId: 'A', volumeL: 100 }]).issues)
      .toContainEqual({ kind: 'too_few_components' });
  });

  it('reports a component still awaiting a volume without failing', () => {
    const summary = summarize([
      { lotId: 'A', volumeL: 100 },
      { lotId: 'B', volumeL: 100 },
      { lotId: 'C', volumeL: 0 },
    ]);

    // A half-built trial is the normal state of one being worked on.
    expect(summary.issues).toContainEqual({ kind: 'no_volume', lotId: 'C' });
    expect(summary.totalVolumeL).toBe(200);
  });

  it('is empty but calm for a trial with nothing in it', () => {
    const summary = summarize([]);

    expect(summary).toMatchObject({ totalVolumeL: 0, components: [], costPerLitre: null });
    expect(summary.issues).toEqual([{ kind: 'too_few_components' }]);
  });
});

describe('blockingBlendTrialIssues', () => {
  it('treats a missing volume as work in progress, not a blocker', () => {
    const summary = summarize([
      { lotId: 'A', volumeL: 100 },
      { lotId: 'B', volumeL: 100 },
      { lotId: 'C', volumeL: 0 },
    ]);

    expect(blockingBlendTrialIssues(summary)).toEqual([]);
  });

  it('treats an over-draw as a blocker', () => {
    const summary = summarize([{ lotId: 'A', volumeL: 100 }, { lotId: 'C', volumeL: 900 }]);

    expect(blockingBlendTrialIssues(summary)).toHaveLength(1);
  });
});

describe('latestAnalysisFor', () => {
  it('picks the newest reading for that lot only', () => {
    const logs = [
      analysis('A', '2026-01-01'),
      analysis('A', '2026-08-01'),
      analysis('B', '2026-12-01'),
    ];

    expect(latestAnalysisFor('A', logs)?.date).toBe('2026-08-01');
    expect(latestAnalysisFor('Z', logs)).toBeUndefined();
  });
});

describe('blendTrialIssueMessage', () => {
  it('says something useful for every issue, in both languages', () => {
    const issues: BlendTrialIssue[] = [
      { kind: 'too_few_components' },
      { kind: 'duplicate_lot', lotId: 'A' },
      { kind: 'no_volume', lotId: 'A' },
      { kind: 'over_draw', lotId: 'A', requested: 10, available: 5 },
      { kind: 'unknown_lot', lotId: 'A' },
    ];

    for (const issue of issues) {
      for (const lang of ['en', 'ka'] as const) {
        expect(blendTrialIssueMessage(issue, lang).trim().length).toBeGreaterThan(8);
      }
    }
  });
});
