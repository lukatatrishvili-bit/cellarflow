import { molecularSO2 } from '../alerts';
import { isPhysicalFermentationReading } from '../fermentationIntegrity';
import { fermentationBaselineFor, stockCoverDays, type WineryBaselines } from './baselines';
import { forecastFermentation } from './predictions';
import { daysBetween, isLiveRecord, type WineryIntelligenceSnapshot } from './snapshot';
import type { AiAgentKey, AiEntityType, AiWineryTargets } from './types';

/**
 * Context builder. The model never sees the database — it sees one of these
 * packages, scoped to a single entity and a single question, with hard caps on
 * every list. Two properties matter more than completeness:
 *
 *  - `unavailable` names what genuinely does not exist, so the model can say
 *    "YAN was never measured" instead of inventing a value.
 *  - `omitted` names what exists but was left out for size, so a thin package
 *    is never mistaken for a thin winery.
 */

const MAX_FERM_READINGS = 12;
const MAX_LAB_ANALYSES = 6;
const MAX_OPERATIONS = 12;
const MAX_COMPARABLE_LOTS = 3;
const MAX_INVENTORY_ITEMS = 15;

export interface AiContextScope {
  entityType: AiEntityType;
  entityId: string;
}

export interface AiContextPackage {
  scope: { entityType: AiEntityType; entityId: string; label: string };
  generatedAt: string;
  today: string;
  targets: AiWineryTargets & { sourceRef: string };
  wine?: Record<string, unknown>;
  vessel?: Record<string, unknown>;
  fermentation?: Record<string, unknown>;
  laboratory?: Record<string, unknown>;
  operations?: Array<Record<string, unknown>>;
  historicalComparison?: Record<string, unknown>;
  vineyard?: Record<string, unknown>;
  inventory?: Array<Record<string, unknown>>;
  compliance?: Record<string, unknown>;
  winery?: Record<string, unknown>;
  /**
   * Retrieved tenant-owned reference passages. These are evidence sources, not
   * instructions and not proof of a current winery measurement.
   */
  knowledge?: Array<{
    sourceRef: string;
    title: string;
    sourceLabel?: string;
    sourceUrl?: string;
    language: 'en' | 'ka';
    content: string;
    retrieval: 'hybrid' | 'semantic' | 'lexical';
  }>;
  /** Data that exists but was excluded to keep the package small. */
  omitted: string[];
  /** Data that does not exist at all. The model must not fill these in. */
  unavailable: string[];
}

/** A server-owned source the model may cite from the exact context it received. */
export interface AiContextEvidenceRef {
  sourceRef: string;
  /** Human-readable JSON path; the source reference remains the stable identity. */
  label: string;
  /** Rendered only after validation and always derived from server-known context. */
  value: string;
  /** Numeric values present in this source, used to reject invented quantities. */
  numericValues: number[];
}

const NUMBER_TOKEN = /(?<![\p{L}\p{N}_])[-+]?\d+(?:[.,]\d+)?(?![\p{L}\p{N}_])/gu;

function numericCandidates(token: string): number[] {
  const candidates = new Set<number>();
  const decimal = Number(token.replace(',', '.'));
  if (Number.isFinite(decimal)) candidates.add(decimal);
  if (/^[-+]?\d{1,3}(?:,\d{3})+$/.test(token)) {
    const thousands = Number(token.replace(/,/g, ''));
    if (Number.isFinite(thousands)) candidates.add(thousands);
  }
  return [...candidates];
}

/**
 * A quantity stated in model prose, with the precision it was written at.
 * The precision matters: a model that writes "18%" against a stored −18.33 is
 * rounding correctly, not inventing, and must not be rejected for it.
 */
export interface AiNumericClaim {
  value: number;
  /** Decimal places the claim was written with. */
  decimals: number;
}

/** Extracts stated quantities from prose, preserving each one's written precision. */
export function extractNumericClaims(texts: readonly string[]): AiNumericClaim[] {
  const claims = new Map<string, AiNumericClaim>();
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    for (const match of text.matchAll(NUMBER_TOKEN)) {
      const token = match[0];
      const separator = token.lastIndexOf('.') >= 0 ? '.' : ',';
      const fraction = /[.,]\d+$/.test(token) ? token.slice(token.lastIndexOf(separator) + 1) : '';
      for (const value of numericCandidates(token)) {
        // Thousands-separated candidates share the token but carry no fraction.
        const decimals = Number.isInteger(value) && !fraction ? 0 : fraction.length;
        claims.set(`${value}:${decimals}`, { value, decimals });
      }
    }
  }
  return [...claims.values()];
}

/** Extracts standalone quantities while ignoring digits embedded in ids/formulas such as L1 or SO2. */
export function extractNumericValues(value: unknown): number[] {
  const numbers = new Set<number>();
  const visit = (current: unknown): void => {
    if (typeof current === 'number') {
      if (Number.isFinite(current)) numbers.add(current);
      return;
    }
    if (typeof current === 'string') {
      for (const match of current.matchAll(NUMBER_TOKEN)) {
        for (const candidate of numericCandidates(match[0])) numbers.add(candidate);
      }
      return;
    }
    if (Array.isArray(current)) {
      // A count stated in prose ("across the last three analyses") is a real
      // fact about the cited data, so the collection's own size is grounded.
      if (current.length > 0) numbers.add(current.length);
      current.forEach(visit);
      return;
    }
    if (current && typeof current === 'object') {
      Object.entries(current as Record<string, unknown>).forEach(([key, child]) => {
        if (key !== 'sourceRef') visit(child);
      });
    }
  };
  visit(value);
  return [...numbers];
}

function withoutSourceRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSourceRefs);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'sourceRef')
      .map(([key, child]) => [key, withoutSourceRefs(child)]),
  );
}

/**
 * Builds the citation allow-list from a serialized context package. Call this
 * on the parsed JSON that was actually sent to the model, never on a broader
 * pre-truncation snapshot.
 */
export function collectContextEvidence(value: unknown): AiContextEvidenceRef[] {
  const evidence = new Map<string, AiContextEvidenceRef>();
  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!current || typeof current !== 'object') return;
    const record = current as Record<string, unknown>;
    const sourceRef = typeof record.sourceRef === 'string' ? record.sourceRef.trim() : '';
    if (sourceRef && !evidence.has(sourceRef)) {
      const knownValue = withoutSourceRefs(record);
      const rendered = JSON.stringify(knownValue);
      evidence.set(sourceRef, {
        sourceRef,
        label: path || 'winery data',
        value: rendered.length <= 900 ? rendered : `${rendered.slice(0, 899)}…`,
        numericValues: extractNumericValues(knownValue),
      });
    }
    Object.entries(record).forEach(([key, child]) => {
      if (key !== 'sourceRef') visit(child, path ? `${path}.${key}` : key);
    });
  };
  visit(value, '');
  return [...evidence.values()];
}

function round(value: number | undefined | null, digits = 2): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Lot context — the richest package, used by the winemaking and lab agents
// ---------------------------------------------------------------------------

function buildLotContext(
  snapshot: WineryIntelligenceSnapshot,
  baselines: WineryBaselines,
  lotId: string,
): AiContextPackage {
  const lot = snapshot.lots.find((l) => l.id === lotId);
  const omitted: string[] = [];
  const unavailable: string[] = [];

  const pkg: AiContextPackage = {
    scope: { entityType: 'lot', entityId: lotId, label: lot ? `${lot.name} (${lot.id})` : lotId },
    generatedAt: snapshot.evaluatedAt,
    today: snapshot.today,
    targets: { ...snapshot.config.targets, sourceRef: 'configuration:ai-targets' },
    omitted,
    unavailable,
  };

  if (!lot) {
    unavailable.push(`lot ${lotId} does not exist in this winery`);
    return pkg;
  }

  pkg.wine = {
    sourceRef: `lots:${lot.id}`,
    lotId: lot.id,
    name: lot.name,
    variety: lot.variety,
    vintage: lot.vintage,
    wineClass: lot.wineClass,
    stage: lot.stage,
    region: lot.region,
    vineyardBlock: lot.vineyardBlock,
    appellation: lot.intendedAppellation || null,
    classification: lot.classification || null,
    initialVolumeL: round(lot.initialVolume, 0),
    currentVolumeL: round(lot.currentVolume, 0),
    createdAt: lot.createdAt,
  };

  const vessel = snapshot.vessels.find((v) => v.assignedLotId === lot.id);
  if (vessel) {
    pkg.vessel = {
      sourceRef: `vessels:${vessel.id}`,
      id: vessel.id,
      type: vessel.type,
      capacityL: round(vessel.capacity, 0),
      currentVolumeL: round(vessel.currentVolume, 0),
      headroomL: round(vessel.capacity - vessel.currentVolume, 0),
      temperatureC: round(vessel.temperature, 1),
      targetTemperatureC: round(vessel.targetTemperature, 1),
      coolingJacketActive: vessel.coolingJacketActive,
      cleaningStatus: vessel.cleaningStatus,
      location: vessel.maraniLocation || vessel.locationDetails || null,
      buried: vessel.buried ?? null,
      soilTemperatureC: round(vessel.soilTemperature, 1),
    };
  } else {
    unavailable.push('no vessel is currently assigned to this lot');
  }

  // --- Fermentation ---------------------------------------------------------
  const fermLogs = snapshot.fermLogs
    .filter((log) => log.lotId === lot.id && isPhysicalFermentationReading(log))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (fermLogs.length === 0) {
    unavailable.push('no fermentation readings have been recorded for this lot');
  } else {
    if (fermLogs.length > MAX_FERM_READINGS) {
      omitted.push(`${fermLogs.length - MAX_FERM_READINGS} older fermentation readings`);
    }
    const baseline = fermentationBaselineFor(baselines, lot.variety);
    const forecast = forecastFermentation(fermLogs, baseline, snapshot.today);
    pkg.fermentation = {
      readings: fermLogs.slice(0, MAX_FERM_READINGS).map((log) => ({
        sourceRef: `fermlogs:${log.id}`,
        date: log.date.slice(0, 10),
        density: round(log.density, 4),
        temperatureC: round(log.temperature, 1),
        sugarGL: round(log.sugar, 1),
        ph: round(log.ph, 2),
        capManagement: log.capManagement || null,
        additives: log.additives || null,
      })),
      forecast: {
        sourceRef: `derived:fermentation-forecast:${lot.id}`,
        observedDropPerDay: round(forecast.observedRatePerDay, 4),
        wineryBaselineDropPerDay: round(forecast.baselineRatePerDay, 4),
        paceDeviationPct: round(forecast.paceDeviationPct, 1),
        projectedDryDate: forecast.estimatedDryDate,
        stuckRisk: round(forecast.stuckRisk, 2),
        forecastMethod: forecast.method,
      },
    };
    if (!baseline) {
      unavailable.push('this winery has no comparable completed fermentation for this variety');
    }
  }

  // --- Laboratory -----------------------------------------------------------
  const labs = snapshot.labLogs
    .filter((lab) => lab.lotId === lot.id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (labs.length === 0) {
    unavailable.push('no laboratory analysis has ever been recorded for this lot');
  } else {
    if (labs.length > MAX_LAB_ANALYSES) {
      omitted.push(`${labs.length - MAX_LAB_ANALYSES} older laboratory analyses`);
    }
    pkg.laboratory = {
      analyses: labs.slice(0, MAX_LAB_ANALYSES).map((lab) => ({
        sourceRef: `lablogs:${lab.id}`,
        date: lab.date.slice(0, 10),
        ph: round(lab.ph, 2),
        titratableAcidityGL: round(lab.titratableAcidity, 2),
        volatileAcidityGL: round(lab.volatileAcid, 2),
        freeSo2MgL: round(lab.freeSo2, 0),
        totalSo2MgL: round(lab.totalSo2, 0),
        molecularSo2MgL: round(molecularSO2(lab.freeSo2, lab.ph), 2),
        alcoholPct: round(lab.alcoholPct, 2),
        residualSugarGL: round(lab.residualSugar, 1),
        malicAcidGL: round(lab.malicAcid, 2),
        lacticAcidGL: round(lab.lacticAcid, 2),
        turbidityNtu: round(lab.turbidity, 1),
      })),
      daysSinceLastAnalysis: daysBetween(labs[0].date, snapshot.today),
    };
  }
  // YAN is not part of the lab schema at all; naming it explicitly is what stops
  // the model from asserting a nitrogen limitation it cannot possibly know.
  unavailable.push('yeast assimilable nitrogen (YAN) is not recorded anywhere in this system');

  // --- Operational history --------------------------------------------------
  const ops = snapshot.cellarOps
    .filter((op) => op.lotId === lot.id && isLiveRecord(op))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const transfers = snapshot.transfers
    .filter((t) => isLiveRecord(t) && (t.sourceLotId === lot.id || t.resultLotId === lot.id || t.destinationLotId === lot.id));
  if (ops.length > MAX_OPERATIONS) omitted.push(`${ops.length - MAX_OPERATIONS} older cellar operations`);
  pkg.operations = [
    ...ops.slice(0, MAX_OPERATIONS).map((op) => ({
      sourceRef: `cellarOps:${op.id}`,
      date: op.date.slice(0, 10),
      type: op.type,
      vessel: op.vesselId || null,
      materials: (op.materials || []).map((m) => `${m.materialName || m.materialId} ${m.quantity}${m.unit || ''}`),
      volumeBeforeL: round(op.volumeBeforeL, 0),
      volumeAfterL: round(op.volumeAfterL, 0),
      notes: (op.notes || '').slice(0, 160) || null,
    })),
    ...transfers.slice(0, 5).map((t) => ({
      sourceRef: `transfers:${t.id}`,
      date: (t.date || '').slice(0, 10),
      type: 'transfer',
      from: t.sourceId,
      to: t.destId,
      volumeL: round(t.volume, 0),
      lossL: round(t.loss, 1),
    })),
  ];

  // --- Historical comparison against the winery's own lots ------------------
  const comparable = snapshot.lots
    .filter((other) =>
      other.id !== lot.id
      && !other.voidedAt
      && (other.variety || '').toLowerCase() === (lot.variety || '').toLowerCase())
    .sort((a, b) => b.vintage - a.vintage)
    .slice(0, MAX_COMPARABLE_LOTS);
  const varietyBaseline = fermentationBaselineFor(baselines, lot.variety);
  pkg.historicalComparison = {
    sameVarietyLots: comparable.map((other) => {
      const otherLabs = snapshot.labLogs
        .filter((lab) => lab.lotId === other.id)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      return {
        sourceRef: `derived:lot-comparison:${other.id}`,
        lotId: other.id,
        name: other.name,
        vintage: other.vintage,
        stage: other.stage,
        lastPh: round(otherLabs?.ph, 2),
        lastVolatileAcidityGL: round(otherLabs?.volatileAcid, 2),
        lastFreeSo2MgL: round(otherLabs?.freeSo2, 0),
      };
    }),
    wineryFermentationBaseline: varietyBaseline
      ? {
        sourceRef: `derived:fermentation-baseline:${lot.variety.toLowerCase()}`,
        variety: varietyBaseline.variety,
        medianDropPerDay: round(varietyBaseline.medianDropPerDay, 4),
        sampleSize: varietyBaseline.sampleSize,
        medianDurationDays: round(varietyBaseline.medianDurationDays, 0),
        medianPeakTempC: round(varietyBaseline.medianPeakTempC, 1),
      }
      : null,
    wineryFreeSo2MedianAtThisStage: {
      sourceRef: `derived:stage-so2-median:${lot.stage}`,
      valueMgL: round(baselines.freeSo2MedianByStage[lot.stage], 0),
    },
  };
  if (comparable.length === 0) {
    unavailable.push('this winery has no other lot of the same variety to compare against');
  }

  return pkg;
}

// ---------------------------------------------------------------------------
// Block, inventory and winery-wide packages
// ---------------------------------------------------------------------------

function buildBlockContext(
  snapshot: WineryIntelligenceSnapshot,
  baselines: WineryBaselines,
  blockId: string,
): AiContextPackage {
  const block = snapshot.blocks.find((b) => b.id === blockId);
  const omitted: string[] = [];
  const unavailable: string[] = [];
  const pkg: AiContextPackage = {
    scope: { entityType: 'block', entityId: blockId, label: block?.name || blockId },
    generatedAt: snapshot.evaluatedAt,
    today: snapshot.today,
    targets: { ...snapshot.config.targets, sourceRef: 'configuration:ai-targets' },
    omitted,
    unavailable,
  };
  if (!block) {
    unavailable.push(`vineyard block ${blockId} does not exist in this winery`);
    return pkg;
  }

  const weather = snapshot.weatherByBlock[block.id];
  if (!weather) unavailable.push('no weather data is attached to this block');

  const scoutings = snapshot.scoutings
    .filter((s) => s.blockId === block.id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const sprays = snapshot.sprays
    .filter((s) => s.blockId === block.id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const samplings = snapshot.samplings
    .filter((s) => s.blockId === block.id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (scoutings.length === 0) unavailable.push('no scouting observation has been recorded for this block');
  if (samplings.length === 0) unavailable.push('no maturity sampling has been recorded for this block');

  pkg.vineyard = {
    block: {
      sourceRef: `blocks:${block.id}`,
      id: block.id,
      name: block.name,
      variety: block.grapeVariety,
      areaHa: round(block.area, 2),
      elevationM: round(block.elevation, 0),
      soilType: block.soilType,
      trainingSystem: block.trainingSystem,
      farmingStatus: block.farmingStatus,
      phenologyStage: block.currentPhenology,
      estimatedHarvestDate: block.estimatedHarvestDate,
      irrigationEnabled: block.irrigationEnabled,
      microzone: block.microzone || null,
    },
    weather: weather
      ? {
        sourceRef: `weather:${block.id}:${snapshot.today}`,
        temperatureC: round(weather.temp ?? weather.tempMax, 1),
        tempMaxC: round(weather.tempMax, 1),
        tempMinC: round(weather.tempMin, 1),
        humidityPct: round(weather.humidity, 0),
        rainMm: round(weather.rainMm, 1),
        windKmh: round(weather.wind, 0),
      }
      : null,
    recentScouting: scoutings.slice(0, 5).map((s) => ({
      sourceRef: `scoutings:${s.id}`,
      date: s.date.slice(0, 10),
      problem: s.problemType,
      severity: s.severity,
      notes: (s.notes || '').slice(0, 160) || null,
    })),
    recentSprays: sprays.slice(0, 5).map((s) => ({
      sourceRef: `sprays:${s.id}`,
      date: s.date.slice(0, 10),
      product: s.productName,
      target: s.targetProblem,
      dosePerHa: round(s.dosePerHa, 2),
      preHarvestIntervalDays: s.preHarvestIntervalDays,
    })),
    recentSamplings: samplings.slice(0, 5).map((s) => ({
      sourceRef: `samplings:${s.id}`,
      date: s.date.slice(0, 10),
      brix: round(s.brix, 1),
      ph: round(s.pH, 2),
      totalAcidityGL: round(s.totalAcidityGL, 2),
      phenolicMaturity: s.phenolicMaturity,
    })),
    wineryHarvestHistory: {
      sourceRef: `derived:harvest-history:${(block.grapeVariety || 'unknown').toLowerCase()}`,
      value: baselines.harvestTimingByVariety[(block.grapeVariety || '').toLowerCase()] || null,
    },
  };
  if (scoutings.length > 5) omitted.push(`${scoutings.length - 5} older scouting records`);
  if (sprays.length > 5) omitted.push(`${sprays.length - 5} older spray records`);

  return pkg;
}

function buildInventoryContext(
  snapshot: WineryIntelligenceSnapshot,
  baselines: WineryBaselines,
  itemId: string,
): AiContextPackage {
  const item = snapshot.inventory.find((i) => i.id === itemId);
  const unavailable: string[] = [];
  const pkg: AiContextPackage = {
    scope: { entityType: 'inventory_item', entityId: itemId, label: item?.name || itemId },
    generatedAt: snapshot.evaluatedAt,
    today: snapshot.today,
    targets: { ...snapshot.config.targets, sourceRef: 'configuration:ai-targets' },
    omitted: [],
    unavailable,
  };
  if (!item) {
    unavailable.push(`inventory item ${itemId} does not exist in this winery`);
    return pkg;
  }
  const consumption = baselines.inventoryConsumption[item.id];
  if (!consumption) unavailable.push('no consumption of this item has been recorded against any operation');

  pkg.inventory = [{
    sourceRef: `inventory:${item.id}`,
    id: item.id,
    name: item.name,
    category: item.category,
    stock: round(item.stock, 2),
    unit: item.unit,
    minThreshold: round(item.minThreshold, 2),
    supplier: item.supplierName || null,
    dailyUsage: round(consumption?.dailyUsage, 3),
    observationCount: consumption?.observations ?? 0,
    coverDays: round(stockCoverDays(baselines, item.id, item.stock), 0),
  }];
  pkg.winery = {
    sourceRef: `derived:winery-summary:${snapshot.today}`,
    activeFermentations: snapshot.lots.filter((l) => l.stage === 'fermenting').length,
    lotsAwaitingBottling: snapshot.lots.filter((l) => l.stage === 'stabilization' || l.stage === 'filtration').length,
  };
  return pkg;
}

function buildWineryContext(
  snapshot: WineryIntelligenceSnapshot,
  baselines: WineryBaselines,
): AiContextPackage {
  const omitted: string[] = [];
  const capacity = snapshot.vessels.reduce((sum, v) => sum + (v.capacity || 0), 0);
  const filled = snapshot.vessels.reduce((sum, v) => sum + Math.max(0, v.currentVolume || 0), 0);
  const lowStock = snapshot.inventory
    .filter((item) => item.stock <= item.minThreshold)
    .slice(0, MAX_INVENTORY_ITEMS);
  if (snapshot.inventory.length > MAX_INVENTORY_ITEMS) {
    omitted.push('inventory items above their reorder point');
  }

  return {
    scope: { entityType: 'winery', entityId: 'winery', label: snapshot.companyProfile?.wineryName || 'Winery' },
    generatedAt: snapshot.evaluatedAt,
    today: snapshot.today,
    targets: { ...snapshot.config.targets, sourceRef: 'configuration:ai-targets' },
    omitted,
    unavailable: [],
    winery: {
      sourceRef: `derived:winery-summary:${snapshot.today}`,
      name: snapshot.companyProfile?.wineryName || null,
      region: snapshot.companyProfile?.region || null,
      totalLots: snapshot.lots.filter((l) => !l.voidedAt).length,
      activeFermentations: snapshot.lots.filter((l) => l.stage === 'fermenting').length,
      lotsByStage: snapshot.lots.reduce<Record<string, number>>((acc, lot) => {
        if (lot.voidedAt) return acc;
        acc[lot.stage] = (acc[lot.stage] || 0) + 1;
        return acc;
      }, {}),
      cellarCapacityL: round(capacity, 0),
      cellarOccupiedL: round(filled, 0),
      cellarFillPct: capacity > 0 ? round((filled / capacity) * 100, 0) : null,
      openTasks: snapshot.tasks.filter((t) => t.status === 'pending').length,
      overdueTasks: snapshot.tasks.filter((t) => t.status === 'pending' && t.dueDate && t.dueDate < snapshot.today).length,
      vineyardBlocks: snapshot.blocks.length,
      medianTransferLossPct: round(baselines.medianTransferLossPct, 1),
    },
    inventory: lowStock.map((item) => ({
      sourceRef: `inventory:${item.id}`,
      id: item.id,
      name: item.name,
      category: item.category,
      stock: round(item.stock, 2),
      unit: item.unit,
      minThreshold: round(item.minThreshold, 2),
      coverDays: round(stockCoverDays(baselines, item.id, item.stock), 0),
    })),
  };
}

/** Dispatches to the right scoped package. Unknown scopes fall back to winery-wide. */
export function buildContext(
  snapshot: WineryIntelligenceSnapshot,
  baselines: WineryBaselines,
  scope: AiContextScope,
): AiContextPackage {
  switch (scope.entityType) {
    case 'lot':
      return buildLotContext(snapshot, baselines, scope.entityId);
    case 'block':
      return buildBlockContext(snapshot, baselines, scope.entityId);
    case 'inventory_item':
      return buildInventoryContext(snapshot, baselines, scope.entityId);
    case 'vessel': {
      const vessel = snapshot.vessels.find((v) => v.id === scope.entityId);
      // A vessel question is almost always a question about what is inside it.
      if (vessel?.assignedLotId) return buildLotContext(snapshot, baselines, vessel.assignedLotId);
      return buildWineryContext(snapshot, baselines);
    }
    default:
      return buildWineryContext(snapshot, baselines);
  }
}

/** Which scopes each agent is allowed to reason over. */
export const AGENT_SCOPES: Record<AiAgentKey, AiEntityType[]> = {
  winemaking: ['lot', 'vessel'],
  laboratory: ['lot'],
  vineyard: ['block'],
  inventory: ['inventory_item', 'winery'],
  compliance: ['lot', 'winery'],
  management: ['winery'],
};

/**
 * Compact JSON for the prompt. Keys are preserved (the model needs them) but
 * whitespace is not, and the result is hard-capped so a pathological winery
 * cannot blow the context window.
 */
export function serializeContext(pkg: AiContextPackage, maxChars = 12_000): string {
  const fit = (candidate: unknown): string | null => {
    const serialized = JSON.stringify(candidate);
    return serialized.length <= maxChars ? serialized : null;
  };
  const full = fit(pkg);
  if (full) return full;
  const trimmed: AiContextPackage = {
    ...pkg,
    operations: pkg.operations?.slice(0, 4),
    fermentation: pkg.fermentation
      ? { ...pkg.fermentation, readings: (pkg.fermentation.readings as unknown[] | undefined)?.slice(0, 5) }
      : undefined,
    laboratory: pkg.laboratory
      ? { ...pkg.laboratory, analyses: (pkg.laboratory.analyses as unknown[] | undefined)?.slice(0, 3) }
      : undefined,
    knowledge: pkg.knowledge?.slice(0, 4),
    omitted: [...pkg.omitted, 'context was truncated to fit the model budget'],
  };
  const compact = fit(trimmed);
  if (compact) return compact;

  const focused = {
    ...trimmed,
    operations: trimmed.operations?.slice(0, 1),
    fermentation: trimmed.fermentation
      ? { ...trimmed.fermentation, readings: (trimmed.fermentation.readings as unknown[] | undefined)?.slice(0, 2) }
      : undefined,
    laboratory: trimmed.laboratory
      ? { ...trimmed.laboratory, analyses: (trimmed.laboratory.analyses as unknown[] | undefined)?.slice(0, 1) }
      : undefined,
    historicalComparison: undefined,
    vineyard: trimmed.vineyard
      ? {
        block: trimmed.vineyard.block,
        weather: trimmed.vineyard.weather,
        recentScouting: (trimmed.vineyard.recentScouting as unknown[] | undefined)?.slice(0, 1),
        recentSprays: (trimmed.vineyard.recentSprays as unknown[] | undefined)?.slice(0, 1),
        recentSamplings: (trimmed.vineyard.recentSamplings as unknown[] | undefined)?.slice(0, 1),
      }
      : undefined,
    inventory: trimmed.inventory?.slice(0, 3),
    knowledge: trimmed.knowledge?.slice(0, 3),
    unavailable: trimmed.unavailable.slice(0, 4),
  };
  const focusedJson = fit(focused);
  if (focusedJson) return focusedJson;

  const core = fit({
    scope: pkg.scope,
    generatedAt: pkg.generatedAt,
    today: pkg.today,
    targets: pkg.targets,
    wine: pkg.wine,
    vessel: pkg.vessel,
    inventory: pkg.inventory?.slice(0, 1),
    winery: pkg.winery,
    knowledge: pkg.knowledge?.slice(0, 1),
    omitted: ['context truncated'],
    unavailable: pkg.unavailable.slice(0, 1),
  });
  if (core) return core;

  const metadata = fit({
    scope: pkg.scope,
    omitted: ['context truncated'],
    unavailable: [],
  });
  if (metadata) return metadata;
  if (maxChars >= 18) return '{"truncated":true}';
  if (maxChars >= 2) return '{}';
  return '0';
}
