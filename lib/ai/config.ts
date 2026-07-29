import {
  severityRank,
  type AiMonitoringArea,
  type AiSeverity,
  type AiWineryConfig,
  type AiWineryTargets,
} from './types';

/**
 * Defaults are intentionally conservative Georgian-cellar values: a 0.5 mg/L
 * molecular SO₂ floor, a red-fermentation temperature band, and a 0.8 g/L VA
 * ceiling. Every winery can move them, and the rules read the winery's numbers
 * rather than hard-coded constants.
 */
export const DEFAULT_AI_TARGETS: AiWineryTargets = {
  freeSo2MinMgL: 25,
  freeSo2MaxMgL: 45,
  molecularSo2MinMgL: 0.5,
  fermentationTempMinC: 18,
  fermentationTempMaxC: 28,
  maxVolatileAcidityGL: 0.8,
  minStockCoverDays: 14,
  labAnalysisIntervalDays: 21,
  minDensityDropPerDay: 0.002,
  maxProcessLossPct: 3,
  maxCellarFillPct: 90,
  harvestTargetBrix: 22,
  harvestTargetPh: 3.4,
  harvestTargetTaGL: 6,
};

export const DEFAULT_AI_AREAS: Record<AiMonitoringArea, boolean> = {
  fermentation: true,
  laboratory: true,
  inventory: true,
  vineyard: true,
  compliance: true,
  operations: true,
};

export const DEFAULT_AI_CONFIG: AiWineryConfig = {
  monitoringEnabled: true,
  dailyBriefingEnabled: true,
  // `attention` keeps INFO findings in the activity log but out of notifications.
  minimumSeverity: 'attention',
  areas: { ...DEFAULT_AI_AREAS },
  modelAnalysisEnabled: true,
  maxModelCallsPerDay: 120,
  targets: { ...DEFAULT_AI_TARGETS },
};

const AREA_KEYS = Object.keys(DEFAULT_AI_AREAS) as AiMonitoringArea[];
const TARGET_KEYS = Object.keys(DEFAULT_AI_TARGETS) as (keyof AiWineryTargets)[];
const SEVERITIES: AiSeverity[] = ['info', 'attention', 'warning', 'critical'];

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Accepts anything (persisted config from an older release, a partial patch
 * from the settings UI, `undefined`) and returns a complete, valid config.
 * Callers never branch on missing fields.
 */
export function resolveAiConfig(stored: unknown): AiWineryConfig {
  const raw = (stored && typeof stored === 'object' && !Array.isArray(stored))
    ? stored as Record<string, unknown>
    : {};

  const rawAreas = (raw.areas && typeof raw.areas === 'object' && !Array.isArray(raw.areas))
    ? raw.areas as Record<string, unknown>
    : {};
  const areas = {} as Record<AiMonitoringArea, boolean>;
  for (const key of AREA_KEYS) {
    areas[key] = bool(rawAreas[key], DEFAULT_AI_AREAS[key]);
  }

  const rawTargets = (raw.targets && typeof raw.targets === 'object' && !Array.isArray(raw.targets))
    ? raw.targets as Record<string, unknown>
    : {};
  const targets = {} as AiWineryTargets;
  for (const key of TARGET_KEYS) {
    targets[key] = num(rawTargets[key], DEFAULT_AI_TARGETS[key]);
  }
  // A band with the floor above the ceiling would silently disable SO₂ rules.
  if (targets.freeSo2MinMgL > targets.freeSo2MaxMgL) {
    targets.freeSo2MaxMgL = targets.freeSo2MinMgL;
  }
  if (targets.fermentationTempMinC > targets.fermentationTempMaxC) {
    targets.fermentationTempMaxC = targets.fermentationTempMinC;
  }

  const minimumSeverity = SEVERITIES.includes(raw.minimumSeverity as AiSeverity)
    ? raw.minimumSeverity as AiSeverity
    : DEFAULT_AI_CONFIG.minimumSeverity;

  return {
    monitoringEnabled: bool(raw.monitoringEnabled, DEFAULT_AI_CONFIG.monitoringEnabled),
    dailyBriefingEnabled: bool(raw.dailyBriefingEnabled, DEFAULT_AI_CONFIG.dailyBriefingEnabled),
    minimumSeverity,
    areas,
    modelAnalysisEnabled: bool(raw.modelAnalysisEnabled, DEFAULT_AI_CONFIG.modelAnalysisEnabled),
    maxModelCallsPerDay: Math.min(
      10_000,
      Math.max(0, Math.round(num(raw.maxModelCallsPerDay, DEFAULT_AI_CONFIG.maxModelCallsPerDay))),
    ),
    targets,
  };
}

/** Notification gate. Findings below the threshold stay in the activity log only. */
export function meetsSeverityThreshold(severity: AiSeverity, config: AiWineryConfig): boolean {
  return severityRank(severity) >= severityRank(config.minimumSeverity);
}

export function isAreaEnabled(area: AiMonitoringArea, config: AiWineryConfig): boolean {
  return config.monitoringEnabled && config.areas[area] !== false;
}
