import { describe, it, expect } from 'vitest';
import { parseModelFindings, tagModelLanguage } from '../lib/ai/schema';
import { buildContext, collectContextEvidence, serializeContext } from '../lib/ai/context';
import { buildAgentPrompt } from '../lib/ai/agents';
import { computeWineryBaselines } from '../lib/ai/baselines';
import { normalizeSnapshot } from '../lib/ai/snapshot';

const ALLOWED = [
  { type: 'lot' as const, id: 'L1', label: 'Saperavi (L1)' },
  { type: 'vessel' as const, id: 'T1', label: 'T1' },
];

const options = {
  agent: 'winemaking' as const,
  area: 'fermentation' as const,
  language: 'en' as const,
  allowedEntities: ALLOWED,
  allowedEvidence: [{
    sourceRef: 'fermlogs:f1',
    label: 'fermentation.readings[0]',
    value: '{"densityDelta":0.001,"temperatureC":22}',
    numericValues: [0.001, 22],
  }],
};

const validEntry = (overrides: Record<string, unknown> = {}) => ({
  finding_type: 'nutrient_limitation_suspected',
  title: 'Fermentation pace has collapsed',
  severity: 'warning',
  entity_type: 'lot',
  entity_id: 'L1',
  observation: 'Density has moved 0.001 SG in three days at 22 °C.',
  reasoning_summary: 'The pace is far below this winery\'s own median for the variety.',
  possible_causes: ['Nitrogen limitation', 'Temperature drop'],
  recommended_actions: [{ kind: 'measure', label: 'Re-take the density reading' }],
  confidence: 0.62,
  confidence_reasons: ['Three readings available'],
  missing_information: ['YAN has never been measured'],
  source_refs: ['fermlogs:f1'],
  requires_human_confirmation: true,
  ...overrides,
});

describe('parseModelFindings — hallucination guards', () => {
  it('accepts a well-formed finding about a known entity', () => {
    const { findings, rejected } = parseModelFindings({ findings: [validEntry()] }, options);
    expect(rejected).toHaveLength(0);
    expect(findings).toHaveLength(1);
    expect(findings[0].source).toBe('model');
    expect(findings[0].entityLabel).toBe('Saperavi (L1)');
    expect(findings[0].evidence).toEqual([
      expect.objectContaining({
        sourceRef: 'fermlogs:f1',
        value: { en: '{"densityDelta":0.001,"temperatureC":22}', ka: '{"densityDelta":0.001,"temperatureC":22}' },
      }),
    ]);
  });

  it('discards a finding about an entity the context never mentioned', () => {
    const { findings, rejected } = parseModelFindings(
      { findings: [validEntry({ entity_id: 'TANK-99' })] },
      options,
    );
    expect(findings).toHaveLength(0);
    expect(rejected[0].reason).toBe('unknown_entity');
  });

  it('discards an invented severity rather than coercing it', () => {
    const { findings, rejected } = parseModelFindings(
      { findings: [validEntry({ severity: 'catastrophic' })] },
      options,
    );
    expect(findings).toHaveLength(0);
    expect(rejected[0].reason).toBe('invalid_severity');
  });

  it('discards an entry with no observation', () => {
    const { rejected } = parseModelFindings({ findings: [validEntry({ observation: '  ' })] }, options);
    expect(rejected[0].reason).toBe('empty_text');
  });

  it('requires citations and rejects source references that were not in the exact context', () => {
    expect(parseModelFindings(
      { findings: [validEntry({ source_refs: [] })] },
      options,
    ).rejected[0].reason).toBe('missing_source_ref');
    expect(parseModelFindings(
      { findings: [validEntry({ source_refs: ['lablogs:invented'] })] },
      options,
    ).rejected[0].reason).toBe('unknown_source_ref');
  });

  it('rejects a numerical claim that does not occur in the cited server data', () => {
    const parsed = parseModelFindings({
      findings: [validEntry({
        observation: 'Density has moved 0.001 SG at 999 °C.',
      })],
    }, options);
    expect(parsed.findings).toHaveLength(0);
    expect(parsed.rejected[0].reason).toBe('ungrounded_numeric_claim');
    expect(parsed.rejected[0].detail).toContain('999');
  });

  it('ignores digits embedded in chemical formulas and entity ids', () => {
    const parsed = parseModelFindings({
      findings: [validEntry({
        observation: 'SO2 protection for L1 is weak at 22 °C after a 0.001 SG movement.',
      })],
    }, options);
    expect(parsed.rejected).toHaveLength(0);
    expect(parsed.findings).toHaveLength(1);
  });

  it('forces human confirmation even when the model says otherwise', () => {
    const { findings } = parseModelFindings(
      { findings: [validEntry({ requires_human_confirmation: false })] },
      options,
    );
    expect(findings[0].requiresHumanConfirmation).toBe(true);
    expect(findings[0].recommendedActions.every((action) => action.requiresConfirmation)).toBe(true);
  });

  it('handles a raw JSON string and rejects malformed output', () => {
    expect(parseModelFindings(JSON.stringify({ findings: [validEntry()] }), options).findings).toHaveLength(1);
    expect(parseModelFindings('not json', options).rejected[0].reason).toBe('not_an_object');
    expect(parseModelFindings({ nope: true }, options).rejected[0].reason).toBe('missing_required_field');
  });

  it('clamps confidence into range and derives a level', () => {
    const { findings } = parseModelFindings({ findings: [validEntry({ confidence: 42 })] }, options);
    expect(findings[0].confidence.score).toBe(1);
    expect(findings[0].confidence.level).toBe('high');
  });

  it('carries missing information through instead of dropping it', () => {
    const { findings } = parseModelFindings({ findings: [validEntry()] }, options);
    expect(findings[0].missingInformation[0].en).toContain('YAN');
  });

  it('records which language the model wrote in', () => {
    const { findings } = parseModelFindings({ findings: [validEntry()] }, options);
    expect(tagModelLanguage(findings, 'ka')[0].modelLanguage).toBe('ka');
  });

  it('gives distinct model findings distinct stable identities and trigger provenance', () => {
    const parsed = parseModelFindings({
      findings: [
        validEntry(),
        validEntry({ finding_type: 'temperature_check', title: 'Check temperature' }),
      ],
    }, {
      ...options,
      sourceDedupeKey: 'fermentation_slowdown:L1:winemaking',
      triggerDedupeKey: 'fermentation_slowdown:L1',
    });
    expect(new Set(parsed.findings.map((finding) => finding.id)).size).toBe(2);
    expect(parsed.findings.every(
      (finding) => finding.triggerDedupeKey === 'fermentation_slowdown:L1',
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------

const snapshotInput = {
  today: '2026-09-20',
  lots: [{
    id: 'L1', name: 'Saperavi Qvevri', vintage: 2026, variety: 'Saperavi', vineyardBlock: 'B1',
    region: 'Kakheti', initialVolume: 1000, currentVolume: 980, wineClass: 'red',
    stage: 'fermenting', createdAt: '2026-09-01', history: [],
  }],
  vessels: [{
    id: 'T1', type: 'qvevri', shape: 'conical', capacity: 1200, currentVolume: 980,
    assignedLotId: 'L1', cleaningStatus: 'clean', lastCleaned: '2026-08-30',
    temperature: 24, coolingJacketActive: false, targetTemperature: 26, lastOperation: 'fill',
  }],
  fermLogs: [{
    id: 'f1', tankId: 'T1', lotId: 'L1', date: '2026-09-18', temperature: 24,
    density: 1.02, sugar: 60, ph: 3.4, tastingNotes: '', capManagement: '', additives: '',
  }],
  labLogs: [],
} as any;

describe('buildContext — grounding', () => {
  const snapshot = normalizeSnapshot(snapshotInput);
  const baselines = computeWineryBaselines(snapshot);

  it('names absent data explicitly so the model cannot invent it', () => {
    const context = buildContext(snapshot, baselines, { entityType: 'lot', entityId: 'L1' });
    expect(context.unavailable).toContain('no laboratory analysis has ever been recorded for this lot');
    expect(context.unavailable.some((entry) => entry.includes('YAN'))).toBe(true);
  });

  it('reports a lot that does not exist rather than returning an empty package', () => {
    const context = buildContext(snapshot, baselines, { entityType: 'lot', entityId: 'GHOST' });
    expect(context.unavailable[0]).toContain('does not exist');
    expect(context.wine).toBeUndefined();
  });

  it('resolves a vessel question to the lot inside it', () => {
    const context = buildContext(snapshot, baselines, { entityType: 'vessel', entityId: 'T1' });
    expect(context.scope.entityType).toBe('lot');
    expect(context.scope.entityId).toBe('L1');
  });

  it('caps serialized context at the model budget', () => {
    const context = buildContext(snapshot, baselines, { entityType: 'lot', entityId: 'L1' });
    const serialized = serializeContext(context, 200);
    expect(serialized.length).toBeLessThanOrEqual(200);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });

  it('collects only server-owned evidence references from the serialized package', () => {
    const context = buildContext(snapshot, baselines, { entityType: 'lot', entityId: 'L1' });
    const evidence = collectContextEvidence(JSON.parse(serializeContext(context)));
    expect(evidence.map((item) => item.sourceRef)).toEqual(expect.arrayContaining([
      'lots:L1',
      'vessels:T1',
      'fermlogs:f1',
      'derived:fermentation-forecast:L1',
    ]));
    expect(evidence.find((item) => item.sourceRef === 'fermlogs:f1')?.numericValues)
      .toEqual(expect.arrayContaining([1.02, 24]));
  });
});

describe('buildAgentPrompt', () => {
  const snapshot = normalizeSnapshot(snapshotInput);
  const baselines = computeWineryBaselines(snapshot);
  const context = buildContext(snapshot, baselines, { entityType: 'lot', entityId: 'L1' });

  it('always carries the safety contract and the unavailable list', () => {
    const prompt = buildAgentPrompt({ agent: 'winemaking', context, language: 'en', tier: 'standard' });
    expect(prompt).toContain('HARD RULES');
    expect(prompt).toContain('EXPLICITLY UNAVAILABLE');
    expect(prompt).toContain('You never change records');
    expect(prompt).toContain('source_refs');
    expect(prompt).toContain('sourceRef');
  });

  it('instructs Georgian output with authentic terminology', () => {
    const prompt = buildAgentPrompt({ agent: 'winemaking', context, language: 'ka', tier: 'standard' });
    expect(prompt).toContain('ქართულად');
    expect(prompt).toContain('ქვევრი');
    expect(prompt).toContain('Do not translate entity ids');
  });

  it('tells a deep-tier agent it is one of several specialists', () => {
    const prompt = buildAgentPrompt({ agent: 'laboratory', context, language: 'en', tier: 'deep' });
    expect(prompt).toContain('one of several specialists');
  });
});
