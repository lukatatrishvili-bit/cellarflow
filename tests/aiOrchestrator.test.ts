import { describe, it, expect } from 'vitest';
import { mergeFindings, planAnalysis, triageEvent, wineryStatus } from '../lib/ai/orchestrator';
import { buildFinding, confidence } from '../lib/ai/finding';
import { makeEvent } from '../lib/ai/events';
import { resolveAiConfig, DEFAULT_AI_CONFIG } from '../lib/ai/config';
import { text } from '../lib/ai/text';
import type { AiFinding, AiFindingRecord, AiSeverity } from '../lib/ai/types';

const config = resolveAiConfig({});

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

const record = (source: AiFinding, overrides: Partial<AiFindingRecord> = {}): AiFindingRecord => ({
  ...source,
  status: 'new',
  lastSeenAt: source.createdAt,
  occurrences: 1,
  ...overrides,
});

describe('triageEvent', () => {
  it('routes an ordinary change to the deterministic path', () => {
    const result = triageEvent(makeEvent({
      eventType: 'fermentation_reading_added',
      entityType: 'lot',
      entityId: 'L1',
      area: 'fermentation',
    }), config);
    expect(result.decision).toBe('rule');
    expect(result.agents).toHaveLength(0);
  });

  it('escalates a critical severity hint', () => {
    const result = triageEvent(makeEvent({
      eventType: 'fermentation_stopped',
      entityType: 'lot',
      entityId: 'L1',
      area: 'fermentation',
      severityHint: 'critical',
    }), config);
    expect(result.decision).toBe('urgent');
  });

  it('ignores an area the winery has switched off', () => {
    const result = triageEvent(makeEvent({
      eventType: 'vineyard_observation_added',
      entityType: 'block',
      entityId: 'B1',
      area: 'vineyard',
    }), resolveAiConfig({ areas: { vineyard: false } }));
    expect(result.decision).toBe('ignore');
  });

  it('never asks for model analysis when the model is disabled', () => {
    const result = triageEvent(makeEvent({
      eventType: 'volatile_acidity_changed',
      entityType: 'lot',
      entityId: 'L1',
      area: 'laboratory',
    }), resolveAiConfig({ modelAnalysisEnabled: false }));
    expect(result.decision).toBe('rule');
  });
});

describe('planAnalysis — cost control', () => {
  it('plans nothing when model analysis is disabled', () => {
    const plan = planAnalysis([finding({ severity: 'critical' })], {
      config: resolveAiConfig({ modelAnalysisEnabled: false }),
    });
    expect(plan.reason).toBe('model_disabled');
    expect(plan.items).toHaveLength(0);
  });

  it('stops once the daily budget is spent', () => {
    const plan = planAnalysis([finding({ severity: 'critical' })], {
      config,
      callsUsedToday: DEFAULT_AI_CONFIG.maxModelCallsPerDay,
    });
    expect(plan.reason).toBe('budget_exhausted');
  });

  it('ignores findings below warning severity', () => {
    const plan = planAnalysis([finding({ severity: 'attention' })], { config });
    expect(plan.reason).toBe('nothing_eligible');
  });

  it('respects the per-run cap and reports what it deferred', () => {
    const findings = ['L1', 'L2', 'L3', 'L4'].map((id) =>
      finding({ entityId: id, entityLabel: id, severity: 'critical' }));
    const plan = planAnalysis(findings, { config, maxPerRun: 2 });
    expect(plan.items).toHaveLength(2);
    expect(plan.deferred).toBe(2);
  });

  it('suppresses a finding still inside its cooldown', () => {
    const active = finding({ severity: 'critical' });
    const analysis = finding({
      source: 'model',
      findingType: 'pace_interpretation',
      dedupeKey: `${active.dedupeKey}:winemaking:pace_interpretation:lot:L1:analysis`,
      triggerDedupeKey: active.dedupeKey,
    });
    const plan = planAnalysis([active], {
      config,
      existing: [record(active), record(analysis, { lastSeenAt: '2026-09-20T05:00:00.000Z' })],
      now: '2026-09-20T06:00:00.000Z', // 1h elapsed against a 6h critical cooldown
    });
    expect(plan.items).toHaveLength(0);
  });

  it('does not treat a recent rule evaluation as a completed model analysis', () => {
    const active = finding({ severity: 'critical' });
    const plan = planAnalysis([active], {
      config,
      existing: [record(active, { lastSeenAt: '2026-09-20T05:59:00.000Z' })],
      now: '2026-09-20T06:00:00.000Z',
    });
    expect(plan.items).toHaveLength(1);
  });

  it('cools down after a model attempt even when the model produced no finding', () => {
    const active = finding({ severity: 'critical' });
    const plan = planAnalysis([active], {
      config,
      existing: [record(active, { lastAnalyzedAt: '2026-09-20T05:30:00.000Z' })],
      now: '2026-09-20T06:00:00.000Z',
    });
    expect(plan.items).toHaveLength(0);
  });

  it('never re-analyses something a user dismissed', () => {
    const active = finding({ severity: 'critical' });
    const plan = planAnalysis([active], {
      config,
      existing: [record(active, { status: 'dismissed', lastSeenAt: '2026-01-01T00:00:00.000Z' })],
      now: '2026-09-20T06:00:00.000Z',
    });
    expect(plan.items).toHaveLength(0);
  });

  it('fans out to several agents only for genuinely cross-discipline situations', () => {
    const stopped = finding({ findingType: 'fermentation_stopped', severity: 'critical' });
    const plan = planAnalysis([stopped], { config });
    expect(plan.items[0].agents).toEqual(['winemaking', 'laboratory', 'inventory']);
    expect(plan.items[0].tier).toBe('deep');
    expect(plan.plannedModelCalls).toBe(3);
  });

  it('does not start a partial multi-agent pass at the budget boundary', () => {
    const stopped = finding({ findingType: 'fermentation_stopped', severity: 'critical' });
    const plan = planAnalysis([stopped], {
      config: resolveAiConfig({ maxModelCallsPerDay: 2 }),
    });
    expect(plan.items).toHaveLength(0);
    expect(plan.plannedModelCalls).toBe(0);
    expect(plan.reason).toBe('budget_exhausted');
  });
});

describe('mergeFindings', () => {
  const now = '2026-09-21T06:00:00.000Z';

  it('increments occurrences instead of duplicating a re-detected finding', () => {
    const existing = [record(finding())];
    const merged = mergeFindings(existing, [finding()], { config, now });
    expect(merged.records).toHaveLength(1);
    expect(merged.records[0].occurrences).toBe(2);
    expect(merged.records[0].createdAt).toBe('2026-09-20T06:00:00.000Z');
  });

  it('does not increment occurrences when the same cadence window is retried', () => {
    const existing = [record(finding(), { lastSeenAt: now, occurrences: 2 })];
    const merged = mergeFindings(existing, [finding()], { config, now });
    expect(merged.records[0].occurrences).toBe(2);
  });

  it('preserves a user decision across re-detection', () => {
    const existing = [record(finding(), { status: 'accepted' })];
    const merged = mergeFindings(existing, [finding()], { config, now });
    expect(merged.records[0].status).toBe('accepted');
    expect(merged.notify).toHaveLength(0);
  });

  it('preserves every reviewer verdict across re-detection', () => {
    const existing = [record(finding(), {
      feedbackEntries: [
        {
          verdict: 'helpful',
          submittedBy: 'alice',
          submittedAt: '2026-09-20T07:00:00.000Z',
        },
        {
          verdict: 'incorrect',
          submittedBy: 'bob',
          submittedAt: '2026-09-20T08:00:00.000Z',
        },
      ],
    })];
    const merged = mergeFindings(existing, [finding()], { config, now });
    expect(merged.records[0].feedbackEntries).toEqual(existing[0].feedbackEntries);
    expect(merged.records[0].feedback).toBeUndefined();
  });

  it('reopens and notifies when severity escalates', () => {
    const existing = [record(finding({ severity: 'warning' }), { status: 'reviewed' })];
    const merged = mergeFindings(existing, [finding({ severity: 'critical' })], { config, now });
    expect(merged.records[0].status).toBe('new');
    expect(merged.notify).toHaveLength(1);
  });

  it('auto-resolves an open finding whose situation cleared', () => {
    const existing = [record(finding())];
    const merged = mergeFindings(existing, [], { config, now });
    expect(merged.records[0].status).toBe('resolved');
    expect(merged.autoResolved).toHaveLength(1);
  });

  it('reopens and notifies when a system-cleared situation recurs', () => {
    const active = finding();
    const cleared = record(active, {
      status: 'resolved',
      statusChangedBy: 'system',
      resolutionNote: 'No longer detected by monitoring.',
      lastAnalyzedAt: '2026-09-20T07:00:00.000Z',
    });
    const merged = mergeFindings([cleared], [active], { config, now });
    expect(merged.records[0].status).toBe('new');
    expect(merged.records[0].resolutionNote).toBeUndefined();
    expect(merged.records[0].lastAnalyzedAt).toBeUndefined();
    expect(merged.notify).toHaveLength(1);
  });

  it('leaves a dismissed finding dismissed when it disappears', () => {
    const existing = [record(finding(), { status: 'dismissed' })];
    const merged = mergeFindings(existing, [], { config, now });
    expect(merged.records[0].status).toBe('dismissed');
    expect(merged.autoResolved).toHaveLength(0);
  });

  it('keeps a model interpretation while its deterministic trigger remains active', () => {
    const trigger = finding();
    const interpretation = finding({
      source: 'model',
      findingType: 'pace_interpretation',
      dedupeKey: `${trigger.dedupeKey}:winemaking:pace_interpretation:lot:L1:analysis`,
      triggerDedupeKey: trigger.dedupeKey,
    });
    const merged = mergeFindings([record(interpretation)], [trigger], { config, now });
    expect(merged.records.find((item) => item.id === interpretation.id)?.status).toBe('new');
    expect(merged.autoResolved).toHaveLength(0);
  });

  it('resolves a model interpretation only after its deterministic trigger clears', () => {
    const trigger = finding();
    const interpretation = finding({
      source: 'model',
      findingType: 'pace_interpretation',
      dedupeKey: `${trigger.dedupeKey}:winemaking:pace_interpretation:lot:L1:analysis`,
      triggerDedupeKey: trigger.dedupeKey,
    });
    const merged = mergeFindings([record(interpretation)], [], { config, now });
    expect(merged.records[0].status).toBe('resolved');
    expect(merged.autoResolved).toHaveLength(1);
  });

  it('preserves legacy model records without trigger provenance for human review', () => {
    const legacy = finding({ source: 'model', findingType: 'legacy_model_interpretation' });
    const merged = mergeFindings([record(legacy)], [], { config, now });
    expect(merged.records[0].status).toBe('new');
    expect(merged.autoResolved).toHaveLength(0);
  });

  it('withholds notification below the winery threshold', () => {
    const merged = mergeFindings([], [finding({ severity: 'info' })], {
      config: resolveAiConfig({ minimumSeverity: 'warning' }),
      now,
    });
    expect(merged.records).toHaveLength(1);
    expect(merged.notify).toHaveLength(0);
  });
});

describe('wineryStatus', () => {
  it('reports critical only while a critical finding is open', () => {
    const open = record(finding({ severity: 'critical' }));
    expect(wineryStatus([open])).toBe('critical');
    expect(wineryStatus([{ ...open, status: 'resolved' }])).toBe('normal');
  });

  it('reports normal for an empty log', () => {
    expect(wineryStatus([])).toBe('normal');
  });
});
