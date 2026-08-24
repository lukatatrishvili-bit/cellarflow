import { describe, it, expect } from 'vitest';
import { mergeFindings, planAnalysis } from '../lib/ai/orchestrator';
import { buildAgentPrompt } from '../lib/ai/agents';
import { buildFinding, confidence } from '../lib/ai/finding';
import { resolveAiConfig } from '../lib/ai/config';
import {
  detectorTrackRecord,
  mutedDetectors,
  type AiDetectorMuteReason,
} from '../lib/ai/feedback';
import { text } from '../lib/ai/text';
import { aiModelFor } from '../server/config';
import {
  getAiModelBudget,
  reserveAiModelCalls,
  __resetInMemoryAiModelBudget,
} from '../server/aiModelBudget';
import type { AiContextPackage } from '../lib/ai/context';
import type {
  AiFeedbackVerdict,
  AiFinding,
  AiFindingRecord,
  AiSeverity,
} from '../lib/ai/types';

/**
 * Review feedback used to be collected, summarized for a master-admin panel,
 * and then ignored. These cover the loop actually closing: a detector this
 * winery keeps calling wrong stops notifying and stops earning model calls,
 * without ever silencing a critical finding or hiding the finding itself.
 */

const on = resolveAiConfig({ feedbackCalibrationEnabled: true });
const off = resolveAiConfig({ feedbackCalibrationEnabled: false });

const finding = (overrides: Partial<Parameters<typeof buildFinding>[0]> = {}): AiFinding => buildFinding({
  findingType: 'fermentation_slowdown',
  agent: 'winemaking',
  area: 'fermentation',
  severity: 'warning' as AiSeverity,
  entityType: 'lot',
  entityId: 'L1',
  entityLabel: 'Saperavi (L1)',
  title: text('Slow', 'ნელი'),
  observation: text('Observation', 'დაკვირვება'),
  whyItMatters: text('Matters', 'მნიშვნელოვანია'),
  confidence: confidence('medium', 0.6, []),
  createdAt: '2026-09-20T06:00:00.000Z',
  ...overrides,
});

/**
 * Reviewed findings for one detector. Each verdict comes from a different
 * reviewer, since one reviewer owns a single current verdict per finding.
 */
function reviewed(
  verdicts: AiFeedbackVerdict[],
  overrides: Partial<Parameters<typeof buildFinding>[0]> = {},
): AiFindingRecord[] {
  return verdicts.map((verdict, index) => {
    const source = finding({ ...overrides, entityId: `L${index + 1}` });
    return {
      ...source,
      status: 'reviewed',
      lastSeenAt: source.createdAt,
      occurrences: 1,
      feedbackEntries: [{
        verdict,
        submittedBy: `reviewer-${index}`,
        submittedAt: '2026-09-20T07:00:00.000Z',
      }],
    } satisfies AiFindingRecord;
  });
}

function reasonFor(records: AiFindingRecord[]): AiDetectorMuteReason | undefined {
  return [...mutedDetectors(records).values()][0]?.reason;
}

describe('detector muting thresholds', () => {
  it('says nothing until there is enough feedback to say it', () => {
    // A 100% incorrect rate, but across too few findings and too few
    // responses to act on.
    expect(mutedDetectors(reviewed(['incorrect', 'incorrect'])).size).toBe(0);
    expect(mutedDetectors([]).size).toBe(0);
  });

  it('mutes a detector this winery keeps calling incorrect', () => {
    const records = reviewed([
      'incorrect', 'incorrect', 'helpful', 'helpful', 'helpful', 'helpful',
    ]);

    expect(reasonFor(records)).toBe('incorrect');
  });

  it('mutes a detector that is right but useless', () => {
    const records = reviewed([
      'not_helpful', 'not_helpful', 'not_helpful', 'helpful', 'helpful',
    ]);

    expect(reasonFor(records)).toBe('unhelpful');
  });

  it('mutes a detector that always arrives after the work is done', () => {
    // Every verdict is `already_handled`, so there are no quality responses at
    // all — the detector is correct and still not worth an alert.
    const records = reviewed([
      'already_handled', 'already_handled', 'already_handled',
      'already_handled', 'already_handled',
    ]);

    expect(reasonFor(records)).toBe('already_handled');
  });

  it('leaves a detector alone when the reviews are good', () => {
    const records = reviewed([
      'helpful', 'helpful', 'helpful', 'helpful', 'helpful', 'incorrect',
    ]);

    expect(mutedDetectors(records).size).toBe(0);
  });

  it('judges each detector separately', () => {
    const records = [
      ...reviewed(['incorrect', 'incorrect', 'helpful', 'helpful', 'helpful', 'helpful']),
      ...reviewed(
        ['helpful', 'helpful', 'helpful', 'helpful', 'helpful'],
        { findingType: 'so2_protection_low', area: 'laboratory', agent: 'laboratory' },
      ),
    ];

    const muted = [...mutedDetectors(records).values()];
    expect(muted).toHaveLength(1);
    expect(muted[0].findingType).toBe('fermentation_slowdown');
  });
});

describe('muted detectors and notifications', () => {
  const existing = reviewed([
    'incorrect', 'incorrect', 'helpful', 'helpful', 'helpful', 'helpful',
  ]);
  const fresh = finding({ entityId: 'L9' });

  it('keeps the finding but drops the alert', () => {
    const merged = mergeFindings(existing, [fresh], { config: on, now: '2026-09-21T06:00:00.000Z' });

    expect(merged.notify).toHaveLength(0);
    expect(merged.mutedNotifications.map((row) => row.entityId)).toEqual(['L9']);
    // The finding is still in the log for anyone who goes looking.
    expect(merged.records.some((row) => row.entityId === 'L9')).toBe(true);
  });

  it('still alerts when the winery has not opted in', () => {
    const merged = mergeFindings(existing, [fresh], { config: off, now: '2026-09-21T06:00:00.000Z' });

    expect(merged.notify.map((row) => row.entityId)).toEqual(['L9']);
    expect(merged.mutedNotifications).toHaveLength(0);
  });

  it('never mutes a critical finding', () => {
    const critical = finding({ entityId: 'L9', severity: 'critical' });
    const merged = mergeFindings(existing, [critical], {
      config: on,
      now: '2026-09-21T06:00:00.000Z',
    });

    expect(merged.notify.map((row) => row.entityId)).toEqual(['L9']);
  });

  it('does not mute a different detector', () => {
    const other = finding({
      entityId: 'L9',
      findingType: 'so2_protection_low',
      area: 'laboratory',
      agent: 'laboratory',
    });
    const merged = mergeFindings(existing, [other], {
      config: on,
      now: '2026-09-21T06:00:00.000Z',
    });

    expect(merged.notify).toHaveLength(1);
  });
});

describe('muted detectors and model spend', () => {
  const existing = reviewed([
    'incorrect', 'incorrect', 'helpful', 'helpful', 'helpful', 'helpful',
  ]);

  it('buys no interpretation of a trigger the winery says is wrong', () => {
    const plan = planAnalysis([finding({ entityId: 'L9' })], { config: on, existing });

    expect(plan.items).toHaveLength(0);
    expect(plan.plannedModelCalls).toBe(0);
    expect(plan.muted).toBe(1);
    expect(plan.reason).toBe('nothing_eligible');
  });

  it('still analyzes when the winery has not opted in', () => {
    const plan = planAnalysis([finding({ entityId: 'L9' })], { config: off, existing });

    expect(plan.items).toHaveLength(1);
    expect(plan.muted).toBe(0);
  });

  it('still analyzes a critical finding from a muted detector', () => {
    const plan = planAnalysis([finding({ entityId: 'L9', severity: 'critical' })], {
      config: on,
      existing,
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.muted).toBe(0);
  });
});

describe('budget and model tiering', () => {
  it('keeps a lightweight pass and a cross-discipline pass on different models', () => {
    // The mapping the analyze route applies, stated once so a change to it is
    // visible rather than buried in a conditional.
    expect(aiModelFor('default')).toBe('gemini-2.5-flash');
    expect(aiModelFor('deep')).toBe('gemini-2.5-pro');
    // The planner has no model of its own until an operator gives it one.
    expect(aiModelFor('planner')).toBe(aiModelFor('default'));
  });

  it('does not let retrieval spend the analysis allowance', async () => {
    __resetInMemoryAiModelBudget();

    // Exhaust the embedding allowance entirely.
    for (let call = 0; call < 3; call += 1) {
      expect((await reserveAiModelCalls('org-budget', 3, 1, undefined, 'embedding')).granted)
        .toBe(true);
    }
    expect((await reserveAiModelCalls('org-budget', 3, 1, undefined, 'embedding')).granted)
      .toBe(false);

    // Generation is untouched: this is the bug the split exists to fix.
    const generation = await reserveAiModelCalls('org-budget', 2, 1);
    expect(generation.granted).toBe(true);
    expect(generation.used).toBe(1);
    expect((await getAiModelBudget('org-budget', 2)).used).toBe(1);
    expect((await getAiModelBudget('org-budget', 3, undefined, 'embedding')).used).toBe(3);
  });

  it('still enforces each ceiling on its own', async () => {
    __resetInMemoryAiModelBudget();

    expect((await reserveAiModelCalls('org-budget', 1, 1)).granted).toBe(true);
    expect((await reserveAiModelCalls('org-budget', 1, 1)).granted).toBe(false);
    expect((await reserveAiModelCalls('org-budget', 1, 1, undefined, 'embedding')).granted)
      .toBe(true);
    expect((await reserveAiModelCalls('org-budget', 1, 1, undefined, 'embedding')).granted)
      .toBe(false);
  });
});

describe('feedback reaching the model', () => {
  const context: AiContextPackage = {
    scope: { entityType: 'lot', entityId: 'L1', label: 'Saperavi (L1)' },
    generatedAt: '2026-09-21T06:00:00.000Z',
    today: '2026-09-21',
    targets: { ...resolveAiConfig({}).targets, sourceRef: 'configuration:ai-targets' },
    omitted: [],
    unavailable: [],
  };

  it('tells the agent how this winery has judged the detector before', () => {
    const records = reviewed([
      'incorrect', 'incorrect', 'helpful', 'helpful', 'helpful', 'helpful',
    ]);
    const trackRecord = detectorTrackRecord(records, finding());
    expect(trackRecord?.totalResponses).toBe(6);

    const prompt = buildAgentPrompt({
      agent: 'winemaking',
      context,
      language: 'en',
      tier: 'standard',
      trigger: { findingType: 'fermentation_slowdown', title: 'Slow', observation: 'Observation' },
      trackRecord,
    });

    expect(prompt).toContain('THIS WINERY\'S REVIEW HISTORY FOR THIS DETECTOR');
    expect(prompt).toContain('33% were marked incorrect');
    expect(prompt).toContain('feedback about the rule, not about the wine');
  });

  it('says nothing about a detector with no history', () => {
    const prompt = buildAgentPrompt({
      agent: 'winemaking',
      context,
      language: 'en',
      tier: 'standard',
      trackRecord: detectorTrackRecord([], finding()),
    });

    expect(prompt).not.toContain('REVIEW HISTORY');
  });
});
