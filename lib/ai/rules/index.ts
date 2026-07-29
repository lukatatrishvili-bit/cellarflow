import { computeWineryBaselines, type WineryBaselines } from '../baselines';
import { isAreaEnabled } from '../config';
import { action, buildFinding, confidence, dedupeFindings, evidence } from '../finding';
import { normalizeSnapshot, type WineryIntelligenceSnapshot, type WineryIntelligenceSnapshotInput } from '../snapshot';
import { plain, text } from '../text';
import type { AiFinding, AiMonitoringArea } from '../types';
import {
  detectAbnormalLoss,
  detectAnalysisOverdue,
  detectFermentationPace,
  detectFermentationTemperature,
  detectSo2Protection,
  detectVolatileAcidity,
} from './cellar';
import {
  detectBottlingReadiness,
  detectCapacityRisk,
  detectComplianceGaps,
  detectInventoryRisk,
  detectOverdueWork,
} from './operations';
import { detectHarvestWindow, detectVineyardRisk } from './vineyard';

export * from './cellar';
export * from './operations';
export * from './vineyard';

/** Materials whose category marks them as fermentation-critical consumables. */
const NUTRIENT_CATEGORIES = ['nutritions', 'nutrients', 'nutrition', 'yeasts', 'yeast'];

/**
 * Cross-module correlation. This is the step that makes the layer more than a
 * set of independent monitors: a fermentation slowing *while* the nutrient it
 * would be corrected with is nearly gone is a different, more urgent situation
 * than either finding on its own.
 */
export function correlateFindings(
  findings: AiFinding[],
  snapshot: WineryIntelligenceSnapshot,
): AiFinding[] {
  const slowFermentations = findings.filter(
    (f) => f.findingType === 'fermentation_slowdown' || f.findingType === 'fermentation_stopped',
  );
  if (slowFermentations.length === 0) return [];

  const nutrientShortages = findings.filter((f) => {
    if (f.area !== 'inventory') return false;
    const item = snapshot.inventory.find((i) => i.id === f.entityId);
    return Boolean(item && NUTRIENT_CATEGORIES.includes((item.category || '').toLowerCase()));
  });
  if (nutrientShortages.length === 0) return [];

  const lotLabels = slowFermentations.map((f) => f.entityLabel).join(', ');
  const materialLabels = nutrientShortages.map((f) => f.entityLabel).join(', ');

  return [buildFinding({
    findingType: 'cross_module_nutrient_risk',
    agent: 'management',
    area: 'fermentation',
    // Never louder than the loudest input: correlation adds context, not alarm.
    severity: slowFermentations.some((f) => f.severity === 'critical') ? 'critical' : 'warning',
    entityType: 'winery',
    entityId: 'fermentation-nutrient-correlation',
    entityLabel: snapshot.companyProfile?.wineryName || 'Winery',
    relatedEntities: [
      ...slowFermentations.map((f) => ({ type: f.entityType, id: f.entityId, label: f.entityLabel })),
      ...nutrientShortages.map((f) => ({ type: f.entityType, id: f.entityId, label: f.entityLabel })),
    ],
    title: text(
      'Fermentation slowing while nutrient stock is short',
      'დუღილი ნელდება, ხოლო საკვების მარაგი მწირია',
    ),
    observation: text(
      `${slowFermentations.length} batch${slowFermentations.length === 1 ? '' : 'es'} (${lotLabels}) are behind pace at the same time as ${materialLabels} ${nutrientShortages.length === 1 ? 'is' : 'are'} at or below the reorder point.`,
      `${slowFermentations.length} პარტია (${lotLabels}) ტემპს ჩამორჩება, პარალელურად კი ${materialLabels} შევსების ზღვარზეა ან მის ქვემოთ.`,
    ),
    whyItMatters: text(
      'The usual correction for a slowing fermentation is a nutrient addition. If that material is not on the shelf, the window in which the correction still works may close before a delivery arrives.',
      'ნელი დუღილის ჩვეული კორექცია საკვების დამატებაა. თუ ეს მასალა თაროზე არ არის, კორექციის ეფექტური ფანჯარა შეიძლება მიწოდებამდე დაიხუროს.',
    ),
    possibleCauses: [
      text('Nutrient consumption this vintage above the planned quantity', 'ამ მოსავალზე საკვების ხარჯვა დაგეგმილს აღემატება'),
      text('Several campaigns needing correction in the same period', 'რამდენიმე კამპანია ერთსა და იმავე პერიოდში საჭიროებს კორექციას'),
    ],
    recommendedActions: [
      action('check', text('Confirm the physical nutrient count before planning additions', 'დამატებების დაგეგმვამდე დაადასტურეთ საკვების ფაქტობრივი ნაშთი'), { targetModule: 'inventory' }),
      action('purchase', text('Expedite a nutrient order if the count is confirmed low', 'ნაშთის დადასტურების შემთხვევაში დააჩქარეთ საკვების შეკვეთა'), { targetModule: 'inventory' }),
      action('measure', text('Order nitrogen analysis so any addition is dosed on data', 'დანიშნეთ აზოტის ანალიზი, რომ დოზა მონაცემებს ეყრდნობოდეს'), { targetModule: 'labs' }),
    ],
    evidence: [
      evidence('fact', text('Batches behind pace', 'ტემპს ჩამორჩენილი პარტიები'), plain(lotLabels)),
      evidence('fact', text('Materials short', 'დეფიციტური მასალები'), plain(materialLabels)),
    ],
    confidence: confidence('medium', 0.6, [
      text('Both underlying findings are rule-derived from recorded data.', 'ორივე საწყისი დასკვნა წესებით არის მიღებული ჩაწერილი მონაცემებიდან.'),
      text('The causal link between them is an inference, not a measurement.', 'მათ შორის მიზეზობრივი კავშირი დასკვნაა და არა გაზომვა.'),
    ]),
    missingInformation: [
      text('Nitrogen (YAN) has not been measured, so nutrient limitation cannot be confirmed.', 'აზოტი (YAN) გაზომილი არ არის, ამიტომ საკვების დეფიციტი ვერ დასტურდება.'),
    ],
    cooldownHours: 24,
  })];
}

export interface RuleEvaluation {
  snapshot: WineryIntelligenceSnapshot;
  baselines: WineryBaselines;
  findings: AiFinding[];
}

/**
 * Runs every deterministic detector the winery has enabled. This is the whole
 * intelligence layer's cheap path: it is safe to call on every state change,
 * costs no model tokens, and its output is the input to model analysis when a
 * situation genuinely needs interpretation.
 */
export function evaluateRules(input: WineryIntelligenceSnapshotInput): RuleEvaluation {
  const snapshot = normalizeSnapshot(input);
  const baselines = computeWineryBaselines(snapshot);

  if (!snapshot.config.monitoringEnabled) {
    return { snapshot, baselines, findings: [] };
  }

  const findings: AiFinding[] = [];
  const run = (area: AiMonitoringArea, detector: () => AiFinding[]) => {
    if (!isAreaEnabled(area, snapshot.config)) return;
    findings.push(...detector());
  };

  run('fermentation', () => detectFermentationPace(snapshot, baselines));
  run('fermentation', () => detectFermentationTemperature(snapshot));
  run('laboratory', () => detectSo2Protection(snapshot, baselines));
  run('laboratory', () => detectVolatileAcidity(snapshot));
  run('laboratory', () => detectAnalysisOverdue(snapshot));
  run('inventory', () => detectInventoryRisk(snapshot, baselines));
  run('operations', () => detectAbnormalLoss(snapshot, baselines));
  run('operations', () => detectCapacityRisk(snapshot));
  run('operations', () => detectOverdueWork(snapshot));
  run('operations', () => detectBottlingReadiness(snapshot));
  run('compliance', () => detectComplianceGaps(snapshot));
  run('vineyard', () => detectVineyardRisk(snapshot));
  run('vineyard', () => detectHarvestWindow(snapshot, baselines));

  findings.push(...correlateFindings(findings, snapshot));

  return {
    snapshot,
    baselines,
    findings: dedupeFindings(findings).map((finding) => ({
      ...finding,
      createdAt: snapshot.evaluatedAt,
    })),
  };
}
