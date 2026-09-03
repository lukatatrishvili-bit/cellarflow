import { describe, it, expect } from 'vitest';
import { buildDailyBriefing, renderBriefingText } from '../lib/ai/briefing';
import { buildFinding, confidence } from '../lib/ai/finding';
import { canRoleSeeFinding, filterFindingsForRole, filterFindingsRoutedToRole, isFindingRoutedToRole } from '../lib/ai/roles';
import { forecastFermentation, forecastHarvestDate, forecastInventoryDepletion } from '../lib/ai/predictions';
import { detectAnomaly, detectTrend } from '../lib/ai/anomaly';
import { computeWineryBaselines } from '../lib/ai/baselines';
import { normalizeSnapshot } from '../lib/ai/snapshot';
import { text } from '../lib/ai/text';
import type { AiFindingRecord, AiMonitoringArea, AiSeverity } from '../lib/ai/types';

const record = (
  id: string,
  severity: AiSeverity,
  area: AiMonitoringArea,
  overrides: Partial<AiFindingRecord> = {},
): AiFindingRecord => ({
  ...buildFinding({
    findingType: 'test_finding',
    agent: 'winemaking',
    area,
    severity,
    entityType: 'lot',
    entityId: id,
    entityLabel: id,
    title: text(`Title ${id}`, `სათაური ${id}`),
    observation: text(`Observation ${id}`, `დაკვირვება ${id}`),
    whyItMatters: text('Matters', 'მნიშვნელოვანია'),
    confidence: confidence('medium', 0.6, []),
    dedupeKey: `test:${id}`,
  }),
  status: 'new',
  lastSeenAt: '2026-09-20T06:00:00.000Z',
  occurrences: 1,
  ...overrides,
});

const MORNING = new Date('2026-09-20T07:30:00');

describe('buildDailyBriefing', () => {
  it('says so plainly when nothing needs attention', () => {
    const briefing = buildDailyBriefing([], { now: MORNING });
    expect(briefing.headline.en).toBe('No significant issues detected.');
    expect(briefing.headline.ka).toContain('არ არის აღმოჩენილი');
    expect(briefing.sections).toHaveLength(0);
    expect(briefing.status).toBe('normal');
  });

  it('separates critical from attention and files the rest by area', () => {
    const briefing = buildDailyBriefing([
      record('L1', 'critical', 'fermentation'),
      record('L2', 'warning', 'laboratory'),
      record('B1', 'attention', 'vineyard'),
      record('INV1', 'attention', 'inventory'),
      record('X1', 'info', 'fermentation'),
    ], { now: MORNING });

    const keys = briefing.sections.map((section) => section.key);
    expect(keys).toEqual(['critical', 'attention', 'vineyard', 'operations', 'everythingElse']);
    expect(briefing.headline.en).toContain('1 critical issue needs attention');
  });

  it('counts but does not list findings below the winery threshold', () => {
    const briefing = buildDailyBriefing([
      record('L1', 'critical', 'fermentation'),
      record('X1', 'info', 'fermentation'),
      record('X2', 'attention', 'fermentation'),
    ], { now: MORNING, minimumSeverity: 'warning' });

    expect(briefing.openCount).toBe(1);
    expect(briefing.suppressedCount).toBe(2);
  });

  it('caps a section and reports the overflow', () => {
    const many = Array.from({ length: 9 }, (_, index) => record(`L${index}`, 'critical', 'fermentation'));
    const briefing = buildDailyBriefing(many, { now: MORNING });
    expect(briefing.sections[0].findings).toHaveLength(5);
    expect(briefing.sections[0].overflow).toBe(4);
  });

  it('excludes findings a user has already closed', () => {
    const briefing = buildDailyBriefing([
      record('L1', 'critical', 'fermentation', { status: 'dismissed' }),
      record('L2', 'critical', 'fermentation', { status: 'resolved' }),
    ], { now: MORNING });
    expect(briefing.openCount).toBe(0);
  });

  it('greets by time of day in both languages', () => {
    expect(buildDailyBriefing([], { now: new Date('2026-09-20T07:00:00') }).greeting.ka).toBe('დილა მშვიდობისა');
    expect(buildDailyBriefing([], { now: new Date('2026-09-20T20:00:00') }).greeting.en).toBe('Good evening');
  });

  it('scopes the briefing to the reader\'s role', () => {
    const findings = [
      record('L1', 'critical', 'fermentation'),
      record('B1', 'warning', 'vineyard'),
    ];
    const forViticulturist = buildDailyBriefing(findings, { now: MORNING, role: 'Viticulturist' });
    expect(forViticulturist.openCount).toBe(1);
    expect(forViticulturist.sections[0].findings[0].entityId).toBe('B1');
  });
});

describe('renderBriefingText', () => {
  it('renders a ranked Georgian digest for messaging channels', () => {
    const briefing = buildDailyBriefing([
      record('L1', 'critical', 'fermentation'),
      record('B1', 'warning', 'vineyard'),
    ], { now: MORNING });
    const rendered = renderBriefingText(briefing, 'ka');

    expect(rendered).toContain('დილა მშვიდობისა');
    expect(rendered).toContain('კრიტიკული');
    expect(rendered).toContain('სათაური L1');
    expect(rendered.indexOf('სათაური L1')).toBeLessThan(rendered.indexOf('სათაური B1'));
  });
});

describe('role visibility and routing', () => {
  it('blocks a role from a module it cannot read', () => {
    const vineyard = record('B1', 'warning', 'vineyard');
    expect(canRoleSeeFinding('Viticulturist', vineyard)).toBe(true);
    expect(canRoleSeeFinding('Lab Technician', vineyard)).toBe(false);
  });

  it('hides a finding whose prose quotes a module the role cannot open', () => {
    // A bottling-readiness finding lives in `operations` but states the age of a
    // laboratory analysis. A cellar worker holds operations and inventory but no
    // lab, so gating on the area alone would leak a lab fact to them.
    const bottling = record('L1', 'attention', 'operations', {
      requiredModules: ['lab', 'inventory'],
    });
    expect(canRoleSeeFinding('Cellar Worker', bottling)).toBe(false);
    expect(canRoleSeeFinding('Winemaker', bottling)).toBe(true);
    expect(canRoleSeeFinding('Owner/Admin', bottling)).toBe(true);

    // The same area without the cross-module citation stays visible.
    expect(canRoleSeeFinding('Cellar Worker', record('L2', 'attention', 'operations'))).toBe(true);
  });

  it('derives the agent module for a stored finding written before the field existed', () => {
    // A record persisted by an older release has no requiredModules at all. For a
    // model finding that is not safe to ignore: it is filed under its trigger's
    // area, so a laboratory agent's chemistry sits in a `fermentation` record.
    const legacy = record('L1', 'warning', 'fermentation', { source: 'model', agent: 'laboratory' });
    delete (legacy as Partial<AiFindingRecord>).requiredModules;

    expect(canRoleSeeFinding('Cellar Worker', legacy)).toBe(false);
    expect(canRoleSeeFinding('Winemaker', legacy)).toBe(true);

    // A legacy *rule* finding keeps its original area-only gating: nothing about
    // it can be recovered, and hiding it outright would lose real signal.
    const legacyRule = record('L2', 'warning', 'fermentation');
    delete (legacyRule as Partial<AiFindingRecord>).requiredModules;
    expect(canRoleSeeFinding('Cellar Worker', legacyRule)).toBe(true);
  });

  it('keeps a vineyard finding visible to the viticulturist it is routed to', () => {
    // Harvest timing derives from past fruit receipts, which a viticulturist may
    // read. If this ever starts quoting cellar capacity it must stop being
    // routed here rather than silently widening the viticulturist's view.
    const harvest = record('B1', 'warning', 'vineyard', {
      requiredModules: ['grape_intake'],
    });
    expect(canRoleSeeFinding('Viticulturist', harvest)).toBe(true);
    expect(isFindingRoutedToRole('Viticulturist', harvest)).toBe(true);
    expect(canRoleSeeFinding('Cellar Worker', harvest)).toBe(false);
  });

  it('gives the owner the cross-module picture', () => {
    const findings = [
      record('L1', 'critical', 'fermentation'),
      record('B1', 'warning', 'vineyard'),
      record('INV1', 'warning', 'inventory'),
    ];
    expect(filterFindingsForRole(findings, 'Owner/Admin')).toHaveLength(3);
    expect(filterFindingsRoutedToRole(findings, 'Owner/Admin')).toHaveLength(3);
  });

  it('lets a read-only auditor review findings without ever being paged', () => {
    const finding = record('L1', 'critical', 'fermentation');
    expect(canRoleSeeFinding('Read-Only', finding)).toBe(true);
    expect(isFindingRoutedToRole('Read-Only', finding)).toBe(false);
    expect(buildDailyBriefing([finding], { now: MORNING, role: 'Read-Only' }).openCount).toBe(0);
  });

  it('does not route a cellar finding to the viticulturist', () => {
    const finding = record('L1', 'critical', 'fermentation');
    expect(isFindingRoutedToRole('Viticulturist', finding)).toBe(false);
    expect(isFindingRoutedToRole('Cellar Worker', finding)).toBe(true);
  });
});

describe('predictions', () => {
  const reading = (date: string, density: number, temperature = 24) => ({
    id: `f-${date}`, tankId: 'T1', lotId: 'L1', date, temperature, density,
    sugar: 50, ph: 3.4, tastingNotes: '', capManagement: '', additives: '',
  }) as any;

  it('projects a dryness date from the recent pace', () => {
    const forecast = forecastFermentation(
      [reading('2026-09-14', 1.040), reading('2026-09-17', 1.022), reading('2026-09-20', 1.004)],
      { variety: 'saperavi', medianDropPerDay: 0.006, sampleSize: 4, lotIds: [], medianPeakTempC: 26, medianDurationDays: 12 },
      '2026-09-20',
    );
    expect(forecast.method).toBe('recent_rate');
    expect(forecast.observedRatePerDay).toBeCloseTo(0.006, 3);
    expect(forecast.estimatedDryDate).toBe('2026-09-22');
    expect(forecast.stuckRisk).toBe(0);
  });

  it('raises stuck risk when the pace collapses against the winery norm', () => {
    const forecast = forecastFermentation(
      [reading('2026-09-17', 1.0205), reading('2026-09-20', 1.020)],
      { variety: 'saperavi', medianDropPerDay: 0.010, sampleSize: 4, lotIds: [], medianPeakTempC: 26, medianDurationDays: 12 },
      '2026-09-20',
    );
    expect(forecast.stuckRisk).toBeGreaterThanOrEqual(0.7);
    expect(forecast.paceDeviationPct).toBeLessThan(-90);
  });

  it('reports insufficient data instead of guessing', () => {
    const forecast = forecastFermentation([], null, '2026-09-20');
    expect(forecast.method).toBe('insufficient_data');
    expect(forecast.estimatedDryDate).toBeNull();
    expect(forecast.limitations).toContain('no_readings');
    expect(forecast.limitations).toContain('no_baseline');
  });

  it('projects inventory depletion from observed usage only', () => {
    const snapshot = normalizeSnapshot({
      today: '2026-09-20',
      cellarOps: [{
        id: 'op1', date: '2026-09-10', type: 'additive', lotId: 'L1', lotName: 'x',
        operator: 'QA', notes: '', materials: [{ materialId: 'INV1', quantity: 18 }],
      }],
    } as any);
    const baselines = computeWineryBaselines(snapshot);

    const known = forecastInventoryDepletion(baselines, 'INV1', 9, '2026-09-20');
    expect(known.coverDays).toBeCloseTo(90, 0);

    const unknown = forecastInventoryDepletion(baselines, 'INV-NEVER-USED', 9, '2026-09-20');
    expect(unknown.coverDays).toBeNull();
    expect(unknown.depletionDate).toBeNull();
  });

  it('projects a harvest date from the block\'s own sugar curve', () => {
    const sampling = (date: string, brix: number) => ({
      id: `s-${date}`, blockId: 'B1', date, brix, pH: 3.2, totalAcidityGL: 8,
      berryWeightG: 1.5, phenolicMaturity: 'Intermediate', seedColor: 'Yellow-brown',
      tasteNotes: '', diseaseCondition: '', estimatedHarvestDate: '', notes: '',
    }) as any;

    const forecast = forecastHarvestDate(
      [sampling('2026-09-06', 18), sampling('2026-09-13', 20), sampling('2026-09-20', 22)],
      { today: '2026-09-20', targetBrix: 23 },
    );
    expect(forecast.method).toBe('sugar_accumulation');
    expect(forecast.brixPerDay).toBeCloseTo(0.2857, 3);
    expect(forecast.daysToTarget).toBe(4);
  });
});

describe('anomaly detection', () => {
  it('needs real history before calling anything an outlier', () => {
    expect(detectAnomaly(50, [1, 2]).isAnomaly).toBe(false);
    expect(detectAnomaly(50, [1, 2]).sampleSize).toBe(2);
  });

  it('flags a value far outside a stable series', () => {
    const result = detectAnomaly(25, [2, 2.2, 1.9, 2.1, 2.05]);
    expect(result.isAnomaly).toBe(true);
    expect(result.direction).toBe('above');
  });

  it('is not fooled by a single outlier already in the history', () => {
    // A median/MAD test keeps the 40 from widening the spread.
    expect(detectAnomaly(2.1, [2, 2.2, 1.9, 40, 2.05]).isAnomaly).toBe(false);
  });

  it('detects a monotonic rising trend', () => {
    const trend = detectTrend([0.42, 0.55, 0.68]);
    expect(trend.direction).toBe('rising');
    expect(trend.monotonic).toBe(true);
    expect(trend.slope).toBeGreaterThan(0);
  });
});
