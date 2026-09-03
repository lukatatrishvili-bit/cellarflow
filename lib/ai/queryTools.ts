import { molecularSO2 } from '../alerts';
import { canAccess, type PermissionModule } from '../../server/permissions';
import { fermentationBaselineFor, stockCoverDays, type WineryBaselines } from './baselines';
import { forecastFermentation } from './predictions';
import { fermReadingsForLot, labsForLot } from './indexes';
import { daysBetween, isLiveRecord, type WineryIntelligenceSnapshot } from './snapshot';
import { text, type LocalizedText } from './text';
import type { UserRole } from './types';

/**
 * "Ask My Winery". A question in natural language is planned into one of a
 * fixed set of validated queries, executed by ordinary application code, and
 * only then explained by the model. The model never touches the database and
 * never sees a query language — so there is no SQL to inject, no field it can
 * reach that permissions do not allow, and no production number it can invent.
 */

export type QueryKind =
  | 'lots_filter'
  | 'lots_at_risk'
  | 'active_fermentations'
  | 'lot_operations'
  | 'lot_comparison'
  | 'lab_trend'
  | 'inventory_low'
  | 'material_usage'
  | 'bottling_ready'
  | 'block_yield'
  | 'open_tasks'
  | 'winery_summary';

export type FilterField =
  | 'variety'
  | 'vintage'
  | 'stage'
  | 'wineClass'
  | 'classification'
  | 'region'
  | 'currentVolume'
  | 'ph'
  | 'freeSo2'
  | 'volatileAcid'
  | 'alcoholPct'
  | 'residualSugar';

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';

export interface QueryFilter {
  field: FilterField;
  operator: FilterOperator;
  value: string | number;
}

export interface QueryPlan {
  kind: QueryKind;
  filters?: QueryFilter[];
  /** Lot / block / inventory item the question is about. */
  entityId?: string;
  /** Second entity, for comparisons. */
  compareEntityId?: string;
  /** Look-back window for usage and trend queries. */
  windowDays?: number;
  limit?: number;
  /**
   * Set when the planner could not resolve the question and wants to ask one
   * back. A plan carrying this must not be executed as though it answered.
   */
  clarification?: string;
}

const QUERY_KINDS: QueryKind[] = [
  'lots_filter', 'lots_at_risk', 'active_fermentations', 'lot_operations', 'lot_comparison',
  'lab_trend', 'inventory_low', 'material_usage', 'bottling_ready', 'block_yield',
  'open_tasks', 'winery_summary',
];

const FILTER_FIELDS: FilterField[] = [
  'variety', 'vintage', 'stage', 'wineClass', 'classification', 'region',
  'currentVolume', 'ph', 'freeSo2', 'volatileAcid', 'alcoholPct', 'residualSugar',
];

const NUMERIC_FIELDS = new Set<FilterField>([
  'vintage', 'currentVolume', 'ph', 'freeSo2', 'volatileAcid', 'alcoholPct', 'residualSugar',
]);

const OPERATORS: FilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'];

const MAX_FILTERS = 4;
const MAX_ROWS = 50;
const DEFAULT_LIMIT = 25;

/** Permission module each query reads from; enforced before execution. */
const QUERY_MODULE: Record<QueryKind, PermissionModule> = {
  lots_filter: 'lots',
  lots_at_risk: 'lots',
  active_fermentations: 'fermentation',
  lot_operations: 'operations',
  lot_comparison: 'fermentation',
  lab_trend: 'lab',
  inventory_low: 'inventory',
  material_usage: 'inventory',
  bottling_ready: 'bottling',
  block_yield: 'vineyard',
  open_tasks: 'tasks',
  winery_summary: 'reports',
};

/** Schema handed to the model as the planner's output contract. */
export const QUERY_PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: QUERY_KINDS },
    filters: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          field: { type: 'STRING', enum: FILTER_FIELDS },
          operator: { type: 'STRING', enum: OPERATORS },
          value: { type: 'STRING' },
        },
        required: ['field', 'operator', 'value'],
      },
    },
    entityId: { type: 'STRING' },
    compareEntityId: { type: 'STRING' },
    windowDays: { type: 'NUMBER' },
    limit: { type: 'NUMBER' },
    /**
     * The one question to ask back when the winemaker's question cannot be
     * resolved to a query. Without it the planner's only escape is
     * `winery_summary`, which answers a question nobody asked and reads as
     * though it did.
     */
    clarification: { type: 'STRING' },
  },
  required: ['kind'],
} as const;

export interface QueryValidation {
  plan?: QueryPlan;
  error?: LocalizedText;
}

/** Rejects anything outside the whitelist rather than coercing it. */
export function validateQueryPlan(raw: unknown): QueryValidation {
  let payload: unknown = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      return { error: text('The query plan was not valid JSON.', 'მოთხოვნის გეგმა არასწორი JSON იყო.') };
    }
  }
  if (!payload || typeof payload !== 'object') {
    return { error: text('The query plan was not an object.', 'მოთხოვნის გეგმა ობიექტი არ არის.') };
  }
  const row = payload as Record<string, unknown>;

  if (!QUERY_KINDS.includes(row.kind as QueryKind)) {
    return { error: text(`Unsupported query type "${String(row.kind)}".`, `მოთხოვნის ტიპი "${String(row.kind)}" არ არის მხარდაჭერილი.`) };
  }

  const filters: QueryFilter[] = [];
  if (Array.isArray(row.filters)) {
    for (const entry of row.filters.slice(0, MAX_FILTERS)) {
      if (!entry || typeof entry !== 'object') continue;
      const candidate = entry as Record<string, unknown>;
      const field = candidate.field as FilterField;
      const operator = candidate.operator as FilterOperator;
      if (!FILTER_FIELDS.includes(field) || !OPERATORS.includes(operator)) {
        return {
          error: text(
            `Filter "${String(candidate.field)} ${String(candidate.operator)}" is not allowed.`,
            `ფილტრი "${String(candidate.field)} ${String(candidate.operator)}" დაშვებული არ არის.`,
          ),
        };
      }
      const rawValue = candidate.value;
      if (typeof rawValue !== 'string' && typeof rawValue !== 'number') continue;
      if (NUMERIC_FIELDS.has(field)) {
        const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue);
        if (!Number.isFinite(numeric)) {
          return {
            error: text(
              `Filter on "${field}" needs a number.`,
              `ფილტრს "${field}"-ზე რიცხვი სჭირდება.`,
            ),
          };
        }
        filters.push({ field, operator, value: numeric });
      } else {
        filters.push({ field, operator, value: String(rawValue).slice(0, 80) });
      }
    }
  }

  const sanitizeId = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : undefined;

  return {
    plan: {
      kind: row.kind as QueryKind,
      filters,
      entityId: sanitizeId(row.entityId),
      compareEntityId: sanitizeId(row.compareEntityId),
      windowDays: typeof row.windowDays === 'number' && Number.isFinite(row.windowDays)
        ? Math.max(1, Math.min(730, Math.round(row.windowDays)))
        : undefined,
      limit: typeof row.limit === 'number' && Number.isFinite(row.limit)
        ? Math.max(1, Math.min(MAX_ROWS, Math.round(row.limit)))
        : undefined,
      clarification: typeof row.clarification === 'string' && row.clarification.trim()
        ? row.clarification.trim().slice(0, 300)
        : undefined,
    },
  };
}

export interface QueryRow {
  [column: string]: string | number | null;
}

export interface QueryResult {
  kind: QueryKind;
  columns: string[];
  rows: QueryRow[];
  summary: LocalizedText;
  /** Record references behind the rows, so an answer can cite its sources. */
  sourceRefs: string[];
  truncated: boolean;
  /** Set when the query returned nothing, so the model says so instead of guessing. */
  empty: boolean;
}

/**
 * Uses the per-evaluation index rather than scanning. `matchesFilter` calls this
 * once per lot *per filter*, so a three-filter query over a large cellar would
 * otherwise walk the whole analysis collection nine hundred times.
 */
function latestLab(snapshot: WineryIntelligenceSnapshot, lotId: string) {
  return labsForLot(snapshot, lotId)[0];
}

function matchesFilter(
  snapshot: WineryIntelligenceSnapshot,
  lot: WineryIntelligenceSnapshot['lots'][number],
  filter: QueryFilter,
): boolean {
  const lab = NUMERIC_FIELDS.has(filter.field) && filter.field !== 'vintage' && filter.field !== 'currentVolume'
    ? latestLab(snapshot, lot.id)
    : undefined;

  let actual: string | number | undefined;
  switch (filter.field) {
    case 'variety': actual = lot.variety; break;
    case 'vintage': actual = lot.vintage; break;
    case 'stage': actual = lot.stage; break;
    case 'wineClass': actual = lot.wineClass; break;
    case 'classification': actual = lot.classification; break;
    case 'region': actual = lot.region; break;
    case 'currentVolume': actual = lot.currentVolume; break;
    case 'ph': actual = lab?.ph; break;
    case 'freeSo2': actual = lab?.freeSo2; break;
    case 'volatileAcid': actual = lab?.volatileAcid; break;
    case 'alcoholPct': actual = lab?.alcoholPct; break;
    case 'residualSugar': actual = lab?.residualSugar; break;
    default: actual = undefined;
  }
  // A lot with no measurement for the filtered field is excluded rather than
  // treated as zero — "pH above 3.6" must not silently include unmeasured lots.
  if (actual === undefined || actual === null) return false;

  if (typeof actual === 'number' && typeof filter.value === 'number') {
    switch (filter.operator) {
      case 'eq': return actual === filter.value;
      case 'neq': return actual !== filter.value;
      case 'gt': return actual > filter.value;
      case 'gte': return actual >= filter.value;
      case 'lt': return actual < filter.value;
      case 'lte': return actual <= filter.value;
      default: return false;
    }
  }

  const left = String(actual).toLowerCase();
  const right = String(filter.value).toLowerCase();
  switch (filter.operator) {
    case 'eq': return left === right;
    case 'neq': return left !== right;
    case 'contains': return left.includes(right);
    default: return false;
  }
}

function finish(
  kind: QueryKind,
  columns: string[],
  rows: QueryRow[],
  summary: LocalizedText,
  sourceRefs: string[],
  limit: number,
): QueryResult {
  const truncated = rows.length > limit;
  return {
    kind,
    columns,
    rows: rows.slice(0, limit),
    summary,
    sourceRefs: sourceRefs.slice(0, limit),
    truncated,
    empty: rows.length === 0,
  };
}

/**
 * Executes a validated plan against the snapshot. Pure and synchronous — the
 * same code path the UI could call directly, which is exactly why the model's
 * answer can be trusted to match what the user sees on screen.
 */
export function executeQuery(
  plan: QueryPlan,
  snapshot: WineryIntelligenceSnapshot,
  baselines: WineryBaselines,
): QueryResult {
  const limit = plan.limit ?? DEFAULT_LIMIT;
  const windowDays = plan.windowDays ?? 90;
  const liveLots = snapshot.lots.filter((lot) => !lot.voidedAt);

  switch (plan.kind) {
    case 'lots_filter': {
      const filters = plan.filters || [];
      const matched = liveLots.filter((lot) => filters.every((filter) => matchesFilter(snapshot, lot, filter)));
      const rows: QueryRow[] = matched.map((lot) => {
        const lab = latestLab(snapshot, lot.id);
        return {
          lotId: lot.id,
          name: lot.name,
          variety: lot.variety,
          vintage: lot.vintage,
          stage: lot.stage,
          volumeL: Math.round(lot.currentVolume),
          ph: lab ? Number(lab.ph.toFixed(2)) : null,
          freeSo2: lab ? Math.round(lab.freeSo2) : null,
          volatileAcid: lab ? Number(lab.volatileAcid.toFixed(2)) : null,
          lastAnalysis: lab ? lab.date.slice(0, 10) : null,
        };
      });
      return finish(
        plan.kind,
        ['lotId', 'name', 'variety', 'vintage', 'stage', 'volumeL', 'ph', 'freeSo2', 'volatileAcid', 'lastAnalysis'],
        rows,
        text(`${rows.length} lot(s) matched.`, `დაემთხვა ${rows.length} პარტია.`),
        matched.map((lot) => `lots:${lot.id}`),
        limit,
      );
    }

    case 'lots_at_risk': {
      const targets = snapshot.config.targets;
      const rows: QueryRow[] = [];
      const refs: string[] = [];
      for (const lot of liveLots) {
        const lab = latestLab(snapshot, lot.id);
        const reasons: string[] = [];
        if (lab) {
          const molecular = molecularSO2(lab.freeSo2, lab.ph);
          if (molecular < targets.molecularSo2MinMgL) reasons.push(`molecular SO2 ${molecular.toFixed(2)} mg/L`);
          if (lab.volatileAcid > targets.maxVolatileAcidityGL) reasons.push(`VA ${lab.volatileAcid.toFixed(2)} g/L`);
        }
        if (lot.stage === 'fermenting') {
          const logs = fermReadingsForLot(snapshot, lot.id);
          const forecast = forecastFermentation(logs, fermentationBaselineFor(baselines, lot.variety), snapshot.today);
          if (forecast.stuckRisk >= 0.5) reasons.push(`stuck risk ${Math.round(forecast.stuckRisk * 100)}%`);
        }
        if (reasons.length === 0) continue;
        rows.push({
          lotId: lot.id,
          name: lot.name,
          stage: lot.stage,
          volumeL: Math.round(lot.currentVolume),
          risks: reasons.join('; '),
        });
        refs.push(`lots:${lot.id}`);
      }
      return finish(
        plan.kind,
        ['lotId', 'name', 'stage', 'volumeL', 'risks'],
        rows,
        text(`${rows.length} lot(s) currently show a measurable risk signal.`, `ამჟამად ${rows.length} პარტიას აქვს გაზომვადი რისკის სიგნალი.`),
        refs,
        limit,
      );
    }

    case 'active_fermentations': {
      const rows: QueryRow[] = [];
      const refs: string[] = [];
      for (const lot of liveLots.filter((l) => l.stage === 'fermenting')) {
        const logs = fermReadingsForLot(snapshot, lot.id);
        const latest = [...logs].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
        const forecast = forecastFermentation(logs, fermentationBaselineFor(baselines, lot.variety), snapshot.today);
        rows.push({
          lotId: lot.id,
          name: lot.name,
          variety: lot.variety,
          vessel: latest?.tankId ?? null,
          density: latest ? Number(latest.density.toFixed(3)) : null,
          temperatureC: latest ? Number(latest.temperature.toFixed(1)) : null,
          dropPerDay: forecast.observedRatePerDay !== null ? Number(forecast.observedRatePerDay.toFixed(4)) : null,
          vsWineryBaselinePct: forecast.paceDeviationPct !== null ? Math.round(forecast.paceDeviationPct) : null,
          projectedDry: forecast.estimatedDryDate,
        });
        refs.push(`lots:${lot.id}`);
      }
      return finish(
        plan.kind,
        ['lotId', 'name', 'variety', 'vessel', 'density', 'temperatureC', 'dropPerDay', 'vsWineryBaselinePct', 'projectedDry'],
        rows,
        text(`${rows.length} active fermentation(s).`, `${rows.length} აქტიური დუღილი.`),
        refs,
        limit,
      );
    }

    case 'lot_operations': {
      if (!plan.entityId) {
        return finish(plan.kind, [], [], text('No lot was identified in the question.', 'კითხვაში პარტია არ იყო მითითებული.'), [], limit);
      }
      const ops = snapshot.cellarOps
        .filter((op) => op.lotId === plan.entityId && isLiveRecord(op))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const transfers = snapshot.transfers
        .filter((t) => isLiveRecord(t) && (t.sourceLotId === plan.entityId || t.resultLotId === plan.entityId));
      const rows: QueryRow[] = [
        ...ops.map((op) => ({
          date: op.date.slice(0, 10),
          type: op.type,
          vessel: op.vesselId ?? null,
          materials: (op.materials || []).map((m) => `${m.materialName || m.materialId} ${m.quantity}${m.unit || ''}`).join(', ') || null,
          operator: op.operator,
          notes: (op.notes || '').slice(0, 120) || null,
        })),
        ...transfers.map((t) => ({
          date: (t.date || '').slice(0, 10),
          type: 'transfer',
          vessel: `${t.sourceId} → ${t.destId}`,
          materials: null,
          operator: t.operator,
          notes: `${Math.round(t.volume)} L, loss ${t.loss} L`,
        })),
      ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

      return finish(
        plan.kind,
        ['date', 'type', 'vessel', 'materials', 'operator', 'notes'],
        rows,
        text(
          `${rows.length} recorded operation(s) for ${plan.entityId}.`,
          `${plan.entityId}-ისთვის ${rows.length} დაფიქსირებული ოპერაცია.`,
        ),
        [...ops.map((op) => `cellarOps:${op.id}`), ...transfers.map((t) => `transfers:${t.id}`)],
        limit,
      );
    }

    case 'lot_comparison': {
      const ids = [plan.entityId, plan.compareEntityId].filter((id): id is string => Boolean(id));
      if (ids.length < 2) {
        return finish(plan.kind, [], [], text('Two lots are needed for a comparison.', 'შედარებისთვის ორი პარტიაა საჭირო.'), [], limit);
      }
      const rows: QueryRow[] = ids.map((id) => {
        const lot = snapshot.lots.find((l) => l.id === id);
        const logs = fermReadingsForLot(snapshot, id);
        const forecast = forecastFermentation(logs, fermentationBaselineFor(baselines, lot?.variety), snapshot.today);
        const lab = latestLab(snapshot, id);
        const temps = logs.map((log) => log.temperature).filter((v) => Number.isFinite(v));
        return {
          lotId: id,
          name: lot?.name ?? null,
          variety: lot?.variety ?? null,
          vintage: lot?.vintage ?? null,
          readings: logs.length,
          dropPerDay: forecast.observedRatePerDay !== null ? Number(forecast.observedRatePerDay.toFixed(4)) : null,
          peakTempC: temps.length ? Number(Math.max(...temps).toFixed(1)) : null,
          ph: lab ? Number(lab.ph.toFixed(2)) : null,
          freeSo2: lab ? Math.round(lab.freeSo2) : null,
          volatileAcid: lab ? Number(lab.volatileAcid.toFixed(2)) : null,
        };
      });
      return finish(
        plan.kind,
        ['lotId', 'name', 'variety', 'vintage', 'readings', 'dropPerDay', 'peakTempC', 'ph', 'freeSo2', 'volatileAcid'],
        rows,
        text(`Side-by-side comparison of ${ids.join(' and ')}.`, `${ids.join(' და ')} პარტიების შედარება.`),
        ids.map((id) => `lots:${id}`),
        limit,
      );
    }

    case 'lab_trend': {
      const labs = snapshot.labLogs
        .filter((lab) => (!plan.entityId || lab.lotId === plan.entityId)
          && daysBetween(lab.date, snapshot.today) <= windowDays)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const rows: QueryRow[] = labs.map((lab) => ({
        date: lab.date.slice(0, 10),
        lotId: lab.lotId,
        ph: Number(lab.ph.toFixed(2)),
        titratableAcidity: Number(lab.titratableAcidity.toFixed(2)),
        volatileAcid: Number(lab.volatileAcid.toFixed(2)),
        freeSo2: Math.round(lab.freeSo2),
        totalSo2: Math.round(lab.totalSo2),
        molecularSo2: Number(molecularSO2(lab.freeSo2, lab.ph).toFixed(2)),
        alcoholPct: Number(lab.alcoholPct.toFixed(2)),
      }));
      return finish(
        plan.kind,
        ['date', 'lotId', 'ph', 'titratableAcidity', 'volatileAcid', 'freeSo2', 'totalSo2', 'molecularSo2', 'alcoholPct'],
        rows,
        text(
          `${rows.length} analysis record(s) in the last ${windowDays} days.`,
          `ბოლო ${windowDays} დღეში ${rows.length} ანალიზის ჩანაწერი.`,
        ),
        labs.map((lab) => `lablogs:${lab.id}`),
        limit,
      );
    }

    case 'inventory_low': {
      const rows: QueryRow[] = [];
      const refs: string[] = [];
      for (const item of snapshot.inventory) {
        const cover = stockCoverDays(baselines, item.id, item.stock);
        const short = item.stock <= item.minThreshold
          || (cover !== null && cover < snapshot.config.targets.minStockCoverDays);
        if (!short) continue;
        rows.push({
          id: item.id,
          name: item.name,
          category: item.category,
          stock: Number(item.stock.toFixed(2)),
          unit: item.unit,
          minThreshold: Number(item.minThreshold.toFixed(2)),
          coverDays: cover !== null ? Math.round(cover) : null,
          supplier: item.supplierName || null,
        });
        refs.push(`inventory:${item.id}`);
      }
      return finish(
        plan.kind,
        ['id', 'name', 'category', 'stock', 'unit', 'minThreshold', 'coverDays', 'supplier'],
        rows,
        text(`${rows.length} item(s) at or approaching their reorder point.`, `${rows.length} პროდუქტი შევსების ზღვარზეა ან უახლოვდება მას.`),
        refs,
        limit,
      );
    }

    case 'material_usage': {
      const since = new Date(Date.parse(`${snapshot.today}T00:00:00Z`) - windowDays * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const totals = new Map<string, { name: string; unit: string; quantity: number; events: number }>();
      const refs: string[] = [];
      for (const op of snapshot.cellarOps) {
        if (!isLiveRecord(op)) continue;
        const date = (op.date || '').slice(0, 10);
        if (date < since || date > snapshot.today) continue;
        const materials = (op.materials && op.materials.length > 0)
          ? op.materials
          : (op.materialId ? [{ materialId: op.materialId, materialName: op.materialName, quantity: op.dose || 0, unit: op.unit }] : []);
        for (const material of materials) {
          if (plan.entityId && material.materialId !== plan.entityId) continue;
          const item = snapshot.inventory.find((i) => i.id === material.materialId);
          const key = material.materialId;
          const current = totals.get(key) || {
            name: material.materialName || item?.name || key,
            unit: material.unit || item?.unit || '',
            quantity: 0,
            events: 0,
          };
          current.quantity += Number(material.quantity) || 0;
          current.events += 1;
          totals.set(key, current);
          refs.push(`cellarOps:${op.id}`);
        }
      }
      const rows: QueryRow[] = [...totals.entries()].map(([id, value]) => ({
        id,
        name: value.name,
        quantity: Number(value.quantity.toFixed(2)),
        unit: value.unit || null,
        operations: value.events,
      })).sort((a, b) => Number(b.quantity) - Number(a.quantity));
      return finish(
        plan.kind,
        ['id', 'name', 'quantity', 'unit', 'operations'],
        rows,
        text(
          `Material consumption over the last ${windowDays} days.`,
          `მასალების ხარჯვა ბოლო ${windowDays} დღეში.`,
        ),
        refs,
        limit,
      );
    }

    case 'bottling_ready': {
      const rows: QueryRow[] = [];
      const refs: string[] = [];
      for (const lot of liveLots) {
        if (lot.stage !== 'stabilization' && lot.stage !== 'filtration' && lot.stage !== 'aging') continue;
        const lab = latestLab(snapshot, lot.id);
        rows.push({
          lotId: lot.id,
          name: lot.name,
          stage: lot.stage,
          volumeL: Math.round(lot.currentVolume),
          bottlesAt750ml: Math.floor(lot.currentVolume / 0.75),
          lastAnalysis: lab ? lab.date.slice(0, 10) : null,
          analysisAgeDays: lab ? daysBetween(lab.date, snapshot.today) : null,
          certification: snapshot.certifications.find((c) => c.lotId === lot.id)?.applicationStatus ?? null,
        });
        refs.push(`lots:${lot.id}`);
      }
      return finish(
        plan.kind,
        ['lotId', 'name', 'stage', 'volumeL', 'bottlesAt750ml', 'lastAnalysis', 'analysisAgeDays', 'certification'],
        rows,
        text(`${rows.length} lot(s) approaching bottling.`, `${rows.length} პარტია უახლოვდება ჩამოსხმას.`),
        refs,
        limit,
      );
    }

    case 'block_yield': {
      const rows: QueryRow[] = [];
      const refs: string[] = [];
      for (const block of snapshot.blocks) {
        const intakes = snapshot.grapeIntakes.filter((intake) => isLiveRecord(intake) && intake.blockId === block.id);
        const harvested = intakes.reduce((sum, intake) => sum + (Number(intake.netWeightKg) || 0), 0);
        rows.push({
          blockId: block.id,
          name: block.name,
          variety: block.grapeVariety,
          areaHa: Number(block.area.toFixed(2)),
          harvestedKg: Math.round(harvested),
          yieldKgPerHa: block.area > 0 ? Math.round(harvested / block.area) : null,
          intakes: intakes.length,
        });
        refs.push(`blocks:${block.id}`);
      }
      rows.sort((a, b) => Number(b.yieldKgPerHa ?? 0) - Number(a.yieldKgPerHa ?? 0));
      return finish(
        plan.kind,
        ['blockId', 'name', 'variety', 'areaHa', 'harvestedKg', 'yieldKgPerHa', 'intakes'],
        rows,
        text('Yield by vineyard block, from recorded intakes.', 'მოსავლიანობა ნაკვეთების მიხედვით, დაფიქსირებული მიღებებიდან.'),
        refs,
        limit,
      );
    }

    case 'open_tasks': {
      const pending = snapshot.tasks
        .filter((task) => task.status === 'pending')
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      const rows: QueryRow[] = pending.map((task) => ({
        id: task.id,
        title: task.title,
        priority: task.priority,
        dueDate: task.dueDate || null,
        assignedTo: task.assignedTo || null,
        overdueDays: task.dueDate && task.dueDate < snapshot.today ? daysBetween(task.dueDate, snapshot.today) : 0,
      }));
      return finish(
        plan.kind,
        ['id', 'title', 'priority', 'dueDate', 'assignedTo', 'overdueDays'],
        rows,
        text(`${rows.length} open task(s).`, `${rows.length} ღია დავალება.`),
        pending.map((task) => `tasks:${task.id}`),
        limit,
      );
    }

    case 'winery_summary':
    default: {
      const capacity = snapshot.vessels.reduce((sum, v) => sum + (v.capacity || 0), 0);
      const occupied = snapshot.vessels.reduce((sum, v) => sum + Math.max(0, v.currentVolume || 0), 0);
      const rows: QueryRow[] = [{
        lots: liveLots.length,
        activeFermentations: liveLots.filter((l) => l.stage === 'fermenting').length,
        totalVolumeL: Math.round(liveLots.reduce((sum, lot) => sum + lot.currentVolume, 0)),
        cellarCapacityL: Math.round(capacity),
        cellarFillPct: capacity > 0 ? Math.round((occupied / capacity) * 100) : null,
        openTasks: snapshot.tasks.filter((t) => t.status === 'pending').length,
        overdueTasks: snapshot.tasks.filter((t) => t.status === 'pending' && t.dueDate && t.dueDate < snapshot.today).length,
        vineyardBlocks: snapshot.blocks.length,
        lowStockItems: snapshot.inventory.filter((i) => i.stock <= i.minThreshold).length,
      }];
      return finish(
        'winery_summary',
        Object.keys(rows[0]),
        rows,
        text('Current winery-wide position.', 'მარნის მიმდინარე ზოგადი მდგომარეობა.'),
        [],
        limit,
      );
    }
  }
}

/** Blocks a query whose underlying module the asking role cannot read. */
export function canRoleRunQuery(role: UserRole, kind: QueryKind): boolean {
  return canAccess(role, QUERY_MODULE[kind], 'view');
}

/** Compact, model-readable rendering of a result set. */
export function serializeQueryResult(result: QueryResult, maxChars = 8_000): string {
  const payload = {
    kind: result.kind,
    empty: result.empty,
    truncated: result.truncated,
    columns: result.columns,
    rows: result.rows,
    sources: result.sourceRefs,
  };
  return JSON.stringify(payload).slice(0, maxChars);
}

/**
 * Human-readable one-liner, used when the model is unavailable so the feature
 * still answers with real data instead of failing.
 */
export function describeQueryResult(result: QueryResult): LocalizedText {
  if (result.empty) {
    return text(
      'No records in your winery match that question.',
      'თქვენს მარანში ამ კითხვას შესაბამისი ჩანაწერები არ მოიძებნა.',
    );
  }
  const shown = `${result.rows.length}${result.truncated ? '+' : ''}`;
  return text(
    `${result.summary.en} Showing ${shown} row(s).`,
    `${result.summary.ka} ნაჩვენებია ${shown} ჩანაწერი.`,
  );
}
