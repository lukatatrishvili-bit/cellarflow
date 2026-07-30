import { describe, it, expect } from 'vitest';
import { evaluateRules } from '../lib/ai/rules';
import { computeWineryBaselines, fermentationBaselineFor } from '../lib/ai/baselines';
import { normalizeSnapshot } from '../lib/ai/snapshot';
import { DEFAULT_AI_CONFIG } from '../lib/ai/config';
import { canRoleSeeFinding } from '../lib/ai/roles';
import type { UserRole } from '../lib/ai/types';

const TODAY = '2026-09-20';

const lot = (fields: Record<string, any> = {}) => ({
  id: 'L1',
  name: 'Saperavi Qvevri',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'B1',
  region: 'Kakheti',
  initialVolume: 1000,
  currentVolume: 1000,
  wineClass: 'red',
  stage: 'fermenting',
  createdAt: '2026-09-01',
  history: [],
  ...fields,
}) as any;

const ferm = (fields: Record<string, any>) => ({
  id: `f-${fields.date}-${fields.lotId ?? 'L1'}`,
  tankId: 'T1',
  lotId: 'L1',
  temperature: 24,
  density: 1.05,
  sugar: 120,
  ph: 3.4,
  tastingNotes: '',
  capManagement: '',
  additives: '',
  ...fields,
}) as any;

const lab = (fields: Record<string, any> = {}) => ({
  id: 'lab1',
  lotId: 'L1',
  tankId: 'T1',
  date: '2026-09-18',
  alcoholPct: 13,
  volatileAcid: 0.3,
  freeSo2: 35,
  totalSo2: 90,
  residualSugar: 2,
  ph: 3.3,
  malicAcid: 0.5,
  lacticAcid: 0.1,
  turbidity: 5,
  technician: 'QA',
  titratableAcidity: 6,
  ...fields,
}) as any;

const base = (overrides: Record<string, any> = {}) => ({
  today: TODAY,
  lang: 'en' as const,
  ...overrides,
});

describe('evaluateRules — fermentation pace', () => {
  it('flags a stopped fermentation while sugar remains', () => {
    const { findings } = evaluateRules(base({
      lots: [lot()],
      fermLogs: [
        ferm({ date: '2026-09-16', density: 1.021 }),
        ferm({ date: '2026-09-18', density: 1.0205 }),
        ferm({ date: '2026-09-20', density: 1.020 }),
      ],
    }));

    const finding = findings.find((f) => f.findingType === 'fermentation_stopped');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('critical');
    expect(finding!.entityId).toBe('L1');
  });

  it('stays silent while a fermentation is dropping normally', () => {
    const { findings } = evaluateRules(base({
      lots: [lot()],
      fermLogs: [
        ferm({ date: '2026-09-16', density: 1.060 }),
        ferm({ date: '2026-09-18', density: 1.030 }),
        ferm({ date: '2026-09-20', density: 1.005 }),
      ],
    }));
    expect(findings.filter((f) => f.area === 'fermentation')).toHaveLength(0);
  });

  it('names YAN as missing rather than asserting a nutrient limitation', () => {
    const { findings } = evaluateRules(base({
      lots: [lot()],
      fermLogs: [
        ferm({ date: '2026-09-18', density: 1.0205 }),
        ferm({ date: '2026-09-20', density: 1.020 }),
      ],
    }));
    const finding = findings.find((f) => f.area === 'fermentation');
    expect(finding!.missingInformation.some((item) => item.en.includes('YAN'))).toBe(true);
    expect(finding!.missingInformation.some((item) => item.ka.includes('YAN'))).toBe(true);
  });

  it('compares against the winery\'s own completed history, not a generic norm', () => {
    // Three finished Saperavi campaigns dropping ~0.010 SG/day.
    const history = ['H1', 'H2', 'H3'].flatMap((id) => [
      ferm({ id: `${id}-a`, lotId: id, date: '2026-08-01', density: 1.090 }),
      ferm({ id: `${id}-b`, lotId: id, date: '2026-08-11', density: 0.990 }),
    ]);
    const snapshot = normalizeSnapshot(base({
      lots: [
        lot(),
        lot({ id: 'H1', stage: 'aging' }),
        lot({ id: 'H2', stage: 'aging' }),
        lot({ id: 'H3', stage: 'aging' }),
      ],
      fermLogs: history,
    }));
    const baselines = computeWineryBaselines(snapshot);
    const baseline = fermentationBaselineFor(baselines, 'Saperavi');

    expect(baseline).not.toBeNull();
    expect(baseline!.sampleSize).toBe(3);
    expect(baseline!.medianDropPerDay).toBeCloseTo(0.01, 3);
  });

  it('reports a pace deviation against the winery baseline in the observation', () => {
    const history = ['H1', 'H2'].flatMap((id) => [
      ferm({ id: `${id}-a`, lotId: id, date: '2026-08-01', density: 1.090 }),
      ferm({ id: `${id}-b`, lotId: id, date: '2026-08-11', density: 0.990 }),
    ]);
    const { findings } = evaluateRules(base({
      lots: [lot(), lot({ id: 'H1', stage: 'aging' }), lot({ id: 'H2', stage: 'aging' })],
      fermLogs: [
        ...history,
        // Current campaign is far slower than the 0.010 SG/day norm.
        ferm({ date: '2026-09-16', density: 1.040 }),
        ferm({ date: '2026-09-20', density: 1.035 }),
      ],
    }));
    const finding = findings.find((f) => f.findingType === 'fermentation_slowdown');
    expect(finding).toBeDefined();
    expect(finding!.whyItMatters.en).toMatch(/slower than this winery's median/);
    expect(finding!.evidence.some((item) => item.kind === 'prediction')).toBe(true);
  });
});

describe('evaluateRules — laboratory', () => {
  it('flags molecular SO2 below the winery floor', () => {
    const { findings } = evaluateRules(base({
      lots: [lot({ stage: 'aging' })],
      labLogs: [lab({ freeSo2: 10, ph: 3.6 })],
    }));
    const finding = findings.find((f) => f.findingType === 'so2_protection_low');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('critical');
  });

  it('respects a winery that has raised its own SO2 floor', () => {
    const relaxed = evaluateRules(base({
      lots: [lot({ stage: 'aging' })],
      labLogs: [lab({ freeSo2: 30, ph: 3.4 })],
      config: { targets: { ...DEFAULT_AI_CONFIG.targets, molecularSo2MinMgL: 0.1, freeSo2MinMgL: 10 } },
    }));
    expect(relaxed.findings.find((f) => f.findingType === 'so2_protection_low')).toBeUndefined();

    const strict = evaluateRules(base({
      lots: [lot({ stage: 'aging' })],
      labLogs: [lab({ freeSo2: 30, ph: 3.4 })],
      config: { targets: { ...DEFAULT_AI_CONFIG.targets, molecularSo2MinMgL: 1.2 } },
    }));
    expect(strict.findings.find((f) => f.findingType === 'so2_protection_low')).toBeDefined();
  });

  it('flags a rising VA trend before it crosses the ceiling', () => {
    const { findings } = evaluateRules(base({
      lots: [lot({ stage: 'aging' })],
      labLogs: [
        lab({ id: 'a', date: '2026-08-01', volatileAcid: 0.42 }),
        lab({ id: 'b', date: '2026-08-20', volatileAcid: 0.55 }),
        lab({ id: 'c', date: '2026-09-10', volatileAcid: 0.68 }),
      ],
    }));
    const finding = findings.find((f) => f.findingType === 'volatile_acidity_rising');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('attention');
  });

  it('flags an overdue analysis and says so in Georgian too', () => {
    const { findings } = evaluateRules(base({
      lots: [lot({ stage: 'aging' })],
      labLogs: [lab({ date: '2026-07-01' })],
    }));
    const finding = findings.find((f) => f.findingType === 'lab_analysis_overdue');
    expect(finding).toBeDefined();
    expect(finding!.title.ka).toContain('ვადაგადაცილებულია');
  });

  it('localizes stored enum values rather than leaking them into Georgian prose', () => {
    const { findings } = evaluateRules(base({
      lots: [lot({ stage: 'aging' })],
      // No analysis at all, so the observation names the stage.
    }));
    const finding = findings.find((f) => f.findingType === 'lab_analysis_overdue')!;
    expect(finding.observation.ka).toContain('დავარგება');
    expect(finding.observation.ka).not.toContain('aging');
    expect(finding.observation.en).toContain('Aging');

    const stageEvidence = finding.evidence.find((item) => item.label.en === 'Stage')!;
    expect(stageEvidence.value.ka).toBe('დავარგება');
    expect(stageEvidence.value.en).toBe('Aging');
  });
});

describe('evaluateRules — inventory and operations', () => {
  it('projects depletion from measured consumption, not just the threshold', () => {
    const { findings } = evaluateRules(base({
      // Above the reorder threshold, so only the consumption forecast can
      // surface this: 30 kg over the 180-day window is ~9 days of cover.
      inventory: [{
        id: 'INV1', name: 'Yeast nutrient', category: 'nutritions',
        stock: 1.5, minThreshold: 1, unit: 'kg', costPerUnit: 20, supplierName: 'Enartis',
      }],
      cellarOps: Array.from({ length: 6 }, (_, index) => ({
        id: `op${index}`,
        date: `2026-09-0${index + 1}`,
        type: 'additive',
        lotId: 'L1',
        lotName: 'Saperavi',
        operator: 'QA',
        notes: '',
        materials: [{ materialId: 'INV1', quantity: 5, unit: 'kg' }],
      })),
    }));
    const finding = findings.find((f) => f.findingType === 'inventory_depletion_risk');
    expect(finding).toBeDefined();
    expect(finding!.evidence.some((item) => item.kind === 'prediction')).toBe(true);
    expect(finding!.missingInformation).toHaveLength(0);
  });

  it('admits when no consumption history exists instead of forecasting', () => {
    const { findings } = evaluateRules(base({
      inventory: [{
        id: 'INV2', name: 'Bentonite', category: 'additives',
        stock: 0.5, minThreshold: 2, unit: 'kg', costPerUnit: 8, supplierName: 'Local',
      }],
    }));
    const finding = findings.find((f) => f.entityId === 'INV2');
    expect(finding!.confidence.level).toBe('low');
    expect(finding!.missingInformation.length).toBeGreaterThan(0);
  });

  it('aggregates overdue work into a single finding', () => {
    const { findings } = evaluateRules(base({
      tasks: Array.from({ length: 12 }, (_, index) => ({
        id: `t${index}`,
        title: `Racking ${index}`,
        priority: 'medium',
        dueDate: '2026-09-01',
        assignedTo: 'Nino',
        status: 'pending',
        description: '',
      })),
    }));
    const overdue = findings.filter((f) => f.findingType === 'work_overdue');
    expect(overdue).toHaveLength(1);
    expect(overdue[0].title.en).toContain('12 operations overdue');
  });

  it('correlates a slowing fermentation with a short nutrient stock', () => {
    const { findings } = evaluateRules(base({
      lots: [lot()],
      fermLogs: [
        ferm({ date: '2026-09-18', density: 1.0205 }),
        ferm({ date: '2026-09-20', density: 1.020 }),
      ],
      inventory: [{
        id: 'INV1', name: 'Yeast nutrient', category: 'nutritions',
        stock: 0, minThreshold: 2, unit: 'kg', costPerUnit: 20, supplierName: 'Enartis',
      }],
    }));
    const correlation = findings.find((f) => f.findingType === 'cross_module_nutrient_risk');
    expect(correlation).toBeDefined();
    expect(correlation!.relatedEntities.map((entity) => entity.id)).toEqual(
      expect.arrayContaining(['L1', 'INV1']),
    );
  });
});

describe('evaluateRules — compliance and configuration', () => {
  it('flags an export lot missing its origin and certification evidence', () => {
    const { findings } = evaluateRules(base({
      lots: [lot({ stage: 'bottled', classification: 'PDO', marketStatus: 'export', originProofStatus: 'partial' })],
    }));
    const finding = findings.find((f) => f.findingType === 'compliance_documentation_gap');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
    expect(finding!.observation.en).toContain('no certification record exists');
  });

  it('produces nothing at all when monitoring is switched off', () => {
    const { findings } = evaluateRules(base({
      lots: [lot({ stage: 'aging' })],
      labLogs: [lab({ freeSo2: 2, ph: 3.8 })],
      config: { monitoringEnabled: false },
    }));
    expect(findings).toHaveLength(0);
  });

  it('honours a disabled monitoring area', () => {
    const input = base({
      lots: [lot({ stage: 'aging' })],
      labLogs: [lab({ freeSo2: 2, ph: 3.8 })],
    });
    expect(evaluateRules(input).findings.length).toBeGreaterThan(0);
    expect(evaluateRules({ ...input, config: { areas: { laboratory: false } } })
      .findings.filter((f) => f.area === 'laboratory')).toHaveLength(0);
  });

  it('declares the laboratory module on a bottling finding that quotes analysis age', () => {
    const { findings } = evaluateRules(base({
      lots: [lot({ stage: 'filtration', currentVolume: 750 })],
      inventory: [{
        id: 'INV-CORK', name: 'Corks', category: 'closures',
        stock: 100, minThreshold: 50, unit: 'pcs', costPerUnit: 0.2, supplierName: 'Amorim',
      }],
    }));
    const finding = findings.find((f) => f.findingType === 'bottling_preparation_gap');
    expect(finding).toBeDefined();
    expect(finding!.observation.en).toContain('Release chemistry');
    // Gating on `operations` alone would show that lab fact to a cellar worker.
    expect(finding!.requiredModules).toEqual(expect.arrayContaining(['lab']));
    expect(canRoleSeeFinding('Cellar Worker', finding!)).toBe(false);
    expect(canRoleSeeFinding('Winemaker', finding!)).toBe(true);
  });

  it('never declares a module set that hides a finding from every workspace role', () => {
    // Guards against over-declaration: a finding only the owner can see is a
    // routing failure dressed up as security.
    const { findings } = evaluateRules(base({
      lots: [
        lot(),
        lot({ id: 'L2', stage: 'aging' }),
        lot({ id: 'L3', stage: 'filtration', currentVolume: 600 }),
        lot({ id: 'L4', stage: 'bottled', classification: 'PDO', marketStatus: 'export', originProofStatus: 'partial' }),
      ],
      vessels: [{
        id: 'T1', type: 'steel', shape: 'vertical', capacity: 1000, currentVolume: 950,
        assignedLotId: 'L1', cleaningStatus: 'clean', lastCleaned: '2026-09-01',
        temperature: 34, coolingJacketActive: false, targetTemperature: 24, lastOperation: 'fill',
      }],
      fermLogs: [
        ferm({ date: '2026-09-18', density: 1.0205 }),
        ferm({ date: '2026-09-20', density: 1.020 }),
      ],
      labLogs: [lab({ lotId: 'L2', freeSo2: 5, ph: 3.7, volatileAcid: 1.4 })],
      inventory: [{
        id: 'INV-NUT', name: 'Yeast nutrient', category: 'nutritions',
        stock: 0, minThreshold: 2, unit: 'kg', costPerUnit: 20, supplierName: 'Enartis',
      }],
      tasks: [{
        id: 't1', title: 'Racking', priority: 'high', dueDate: '2026-09-01',
        assignedTo: 'Nino', status: 'pending', description: '',
      }],
      transfers: [{
        id: 'tr1', sourceId: 'T1', destId: 'T2', volume: 500, loss: 60, operator: 'QA',
        category: 'racking', date: '2026-09-19', pump: 'p1', details: '', sourceLotId: 'L1',
      }],
    }));

    expect(findings.length).toBeGreaterThan(4);
    const workspaceRoles: UserRole[] = ['Winemaker', 'Cellar Worker', 'Lab Technician', 'Viticulturist'];
    for (const finding of findings) {
      const visibleTo = workspaceRoles.filter((role) => canRoleSeeFinding(role, finding));
      expect(
        visibleTo.length,
        `${finding.findingType} is visible to no workspace role (requires ${finding.requiredModules.join(', ') || 'area only'})`,
      ).toBeGreaterThan(0);
    }
  });

  it('is deterministic: the same state produces byte-equivalent findings', () => {
    const input = base({
      lots: [lot({ stage: 'aging' })],
      labLogs: [lab({ freeSo2: 8, ph: 3.7 })],
    });
    const first = evaluateRules(input).findings;
    const second = evaluateRules(input).findings;
    expect(first).toEqual(second);
    expect(first.every((finding) => finding.createdAt === '2026-09-20T00:00:00.000Z')).toBe(true);
  });

  it('always writes both English and Georgian for every rule finding', () => {
    const { findings } = evaluateRules(base({
      lots: [lot(), lot({ id: 'L2', stage: 'aging' })],
      fermLogs: [
        ferm({ date: '2026-09-18', density: 1.0205 }),
        ferm({ date: '2026-09-20', density: 1.020 }),
      ],
      labLogs: [lab({ lotId: 'L2', freeSo2: 5, ph: 3.7, volatileAcid: 1.4 })],
      inventory: [{
        id: 'INV3', name: 'Corks', category: 'closures',
        stock: 0, minThreshold: 500, unit: 'pcs', costPerUnit: 0.2, supplierName: 'Amorim',
      }],
      tasks: [{ id: 't1', title: 'Racking', priority: 'high', dueDate: '2026-09-01', assignedTo: 'Nino', status: 'pending', description: '' }],
    }));

    expect(findings.length).toBeGreaterThan(3);
    for (const finding of findings) {
      for (const field of [finding.title, finding.observation, finding.whyItMatters]) {
        expect(field.en.trim().length).toBeGreaterThan(0);
        expect(field.ka.trim().length).toBeGreaterThan(0);
        // Georgian text must actually be Georgian, not an English fallback.
        expect(field.ka).toMatch(/[Ⴀ-ჿ]/);
      }
    }
  });
});
