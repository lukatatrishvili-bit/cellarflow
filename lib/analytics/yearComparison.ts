import type {
  BottlingRunRecord,
  GrapeIntakeRecord,
  HarvestRecord,
  SalesDispatchRecord,
  SalesOrderRecord,
  WineLot,
} from '../wineryState';
import type { CostCategory, CostEntry } from '../costing';
import type { StockMovement } from '../storage';
import { isActiveReservation } from '../sales';

export type YearComparisonMode = 'vintage' | 'calendar';
export type MetricKind = 'number' | 'money' | 'percent';

export interface YearBucket {
  year: number;
  mode: YearComparisonMode;
  lotIds: string[];
  lotCount: number;
  harvestKg: number;
  grapeIntakeKg: number;
  producedLitres: number;
  currentBulkLitres: number;
  bottledBottles: number;
  bottledLitres: number;
  dispatchedBottles: number;
  reservedBottles: number;
  stockOnHandBottles: number;
  stockMovementBottles: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number | null;
  costTotal: number;
  costPerLitre: number | null;
  costPerBottle: number | null;
  finishedGoodsValue: number;
  costsByCategory: Partial<Record<CostCategory, number>>;
  wines: WineYearSummary[];
}

export interface WineYearSummary {
  lotId: string;
  lotName: string;
  vintage: number;
  bottledBottles: number;
  dispatchedBottles: number;
  reservedBottles: number;
  stockOnHandBottles: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number | null;
}

export interface ComparisonMetric {
  key: string;
  label: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  deltaPct: number | null;
  kind: MetricKind;
  unit?: string;
  higherIsBetter?: boolean;
}

export interface YearComparison {
  mode: YearComparisonMode;
  currentYear: number;
  previousYear: number;
  current: YearBucket;
  previous: YearBucket;
  metrics: ComparisonMetric[];
  insights: string[];
}

export interface YearComparisonInput {
  lots: WineLot[];
  harvests: HarvestRecord[];
  grapeIntakes: GrapeIntakeRecord[];
  bottlingRuns: BottlingRunRecord[];
  costEntries: CostEntry[];
  stockMovements: StockMovement[];
  salesDispatches: SalesDispatchRecord[];
  salesOrders: SalesOrderRecord[];
  asOfDate?: string;
}

const COST_CATEGORIES: CostCategory[] = [
  'grape',
  'additive',
  'packaging',
  'labor',
  'bottling',
  'energy',
  'overhead',
  'blend_in',
  'blend_out',
  'other',
];

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function safeNumber(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function positive(n: unknown): number {
  const value = safeNumber(n);
  return value > 0 ? value : 0;
}

function dateYear(date?: string | null): number | null {
  if (!date || typeof date !== 'string') return null;
  const m = /^(\d{4})/.exec(date);
  return m ? Number(m[1]) : null;
}

function harvestYear(h: HarvestRecord): number | null {
  return dateYear(h.actualHarvestDate || h.estimatedHarvestDate);
}

function orderYear(o: SalesOrderRecord): number | null {
  return dateYear(o.orderDate || o.createdAt);
}

function signedMovement(m: StockMovement): number {
  return m.direction === 'in' ? positive(m.bottles) : -positive(m.bottles);
}

function sum<T>(items: T[], fn: (item: T) => number): number {
  return round2(items.reduce((acc, item) => acc + fn(item), 0));
}

export function calculateDeltaPercent(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

export function compareMetric(
  key: string,
  label: string,
  current: number | null,
  previous: number | null,
  kind: MetricKind = 'number',
  unit?: string,
  higherIsBetter = true,
): ComparisonMetric {
  const delta = current == null || previous == null ? null : round2(current - previous);
  return {
    key,
    label,
    current,
    previous,
    delta,
    deltaPct: calculateDeltaPercent(current, previous),
    kind,
    unit,
    higherIsBetter,
  };
}

export function availableComparisonYears(input: YearComparisonInput): number[] {
  const years = new Set<number>();
  for (const lot of input.lots || []) {
    if (Number.isFinite(lot.vintage)) years.add(lot.vintage);
    const created = dateYear(lot.createdAt);
    if (created) years.add(created);
  }
  for (const h of input.harvests || []) {
    const y = harvestYear(h);
    if (y) years.add(y);
  }
  for (const i of input.grapeIntakes || []) {
    if (Number.isFinite(i.vintage)) years.add(i.vintage);
    const y = dateYear(i.date);
    if (y) years.add(y);
  }
  for (const r of input.bottlingRuns || []) {
    const y = dateYear(r.date);
    if (y) years.add(y);
  }
  for (const c of input.costEntries || []) {
    const y = dateYear(c.date);
    if (y) years.add(y);
  }
  for (const d of input.salesDispatches || []) {
    const y = dateYear(d.date);
    if (y) years.add(y);
  }
  for (const o of input.salesOrders || []) {
    const y = orderYear(o);
    if (y) years.add(y);
  }
  return Array.from(years).sort((a, b) => b - a);
}

function lotIdsFor(input: YearComparisonInput, year: number, mode: YearComparisonMode): Set<string> {
  if (mode === 'vintage') {
    return new Set((input.lots || []).filter(l => l.vintage === year).map(l => l.id));
  }
  return new Set((input.lots || []).filter(l => dateYear(l.createdAt) === year).map(l => l.id));
}

function recordMatches(mode: YearComparisonMode, year: number, lotIds: Set<string>, lotId: string | undefined, date?: string): boolean {
  if (mode === 'vintage') return !!lotId && lotIds.has(lotId);
  return dateYear(date) === year;
}

function currentStockByLot(movements: StockMovement[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of movements || []) {
    if (!m.lotId) continue;
    map.set(m.lotId, round2((map.get(m.lotId) || 0) + signedMovement(m)));
  }
  for (const [lotId, bottles] of map.entries()) {
    if (bottles <= 0) map.delete(lotId);
  }
  return map;
}

function bottlesProducedByLot(runs: BottlingRunRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const run of runs || []) {
    if (!run.lotId) continue;
    map.set(run.lotId, (map.get(run.lotId) || 0) + positive(run.totalBottles) + positive(run.totalCeramic));
  }
  return map;
}

function costsByLot(entries: CostEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries || []) {
    if (!entry.lotId) continue;
    map.set(entry.lotId, round2((map.get(entry.lotId) || 0) + safeNumber(entry.amount)));
  }
  return map;
}

function reservedByLot(orders: SalesOrderRecord[], year: number, mode: YearComparisonMode, lotIds: Set<string>, asOfDate: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const order of orders || []) {
    if (!isActiveReservation(order, asOfDate)) continue;
    if (!recordMatches(mode, year, lotIds, order.lotId, order.orderDate || order.createdAt)) continue;
    map.set(order.lotId, (map.get(order.lotId) || 0) + positive(order.bottles));
  }
  return map;
}

function buildWineSummaries(input: YearComparisonInput, year: number, mode: YearComparisonMode, lotIds: Set<string>, asOfDate: string): WineYearSummary[] {
  const lots = (input.lots || []).filter(l => lotIds.has(l.id));
  const stock = currentStockByLot(input.stockMovements);
  const bottled = bottlesProducedByLot((input.bottlingRuns || []).filter(r => recordMatches(mode, year, lotIds, r.lotId, r.date)));
  const reserved = reservedByLot(input.salesOrders, year, mode, lotIds, asOfDate);
  return lots.map(lot => {
    const dispatches = (input.salesDispatches || []).filter(d => recordMatches(mode, year, lotIds, d.lotId, d.date) && d.lotId === lot.id);
    const revenue = sum(dispatches, d => safeNumber(d.revenue));
    const cogs = sum(dispatches, d => safeNumber(d.cogs));
    const grossProfit = sum(dispatches, d => safeNumber(d.grossProfit));
    return {
      lotId: lot.id,
      lotName: lot.name || lot.id,
      vintage: lot.vintage,
      bottledBottles: bottled.get(lot.id) || 0,
      dispatchedBottles: sum(dispatches, d => positive(d.bottles)),
      reservedBottles: reserved.get(lot.id) || 0,
      stockOnHandBottles: Math.max(0, stock.get(lot.id) || 0),
      revenue,
      cogs,
      grossProfit,
      marginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
    };
  }).sort((a, b) => b.revenue - a.revenue || b.stockOnHandBottles - a.stockOnHandBottles);
}

export function buildYearBucket(input: YearComparisonInput, year: number, mode: YearComparisonMode): YearBucket {
  const asOfDate = input.asOfDate || new Date().toISOString().slice(0, 10);
  const lotIds = lotIdsFor(input, year, mode);
  const lotList = (input.lots || []).filter(l => lotIds.has(l.id));

  const harvests = (input.harvests || []).filter(h => {
    if (mode === 'vintage' && h.associatedLotId && lotIds.has(h.associatedLotId)) return true;
    return harvestYear(h) === year;
  });
  const grapeIntakes = (input.grapeIntakes || []).filter(i => (
    mode === 'vintage'
      ? i.vintage === year
      : dateYear(i.date) === year
  ));
  const bottlingRuns = (input.bottlingRuns || []).filter(r => recordMatches(mode, year, lotIds, r.lotId, r.date));
  const costEntries = (input.costEntries || []).filter(c => recordMatches(mode, year, lotIds, c.lotId, c.date));
  const dispatches = (input.salesDispatches || []).filter(d => recordMatches(mode, year, lotIds, d.lotId, d.date));
  const activeOrders = (input.salesOrders || []).filter(o => (
    isActiveReservation(o, asOfDate) && recordMatches(mode, year, lotIds, o.lotId, o.orderDate || o.createdAt)
  ));
  const stockMovements = (input.stockMovements || []).filter(m => recordMatches(mode, year, lotIds, m.lotId, m.date));

  const costsByCategory: Partial<Record<CostCategory, number>> = {};
  for (const category of COST_CATEGORIES) {
    const total = sum(costEntries.filter(c => c.category === category), c => safeNumber(c.amount));
    if (total !== 0) costsByCategory[category] = total;
  }

  const costTotal = sum(costEntries, c => safeNumber(c.amount));
  const producedLitres = sum(grapeIntakes, i => positive(i.estimatedVolumeL));
  const bottledBottles = sum(bottlingRuns, r => positive(r.totalBottles) + positive(r.totalCeramic));
  const bottledLitres = sum(bottlingRuns, r => positive(r.volumeBottledL));
  const revenue = sum(dispatches, d => safeNumber(d.revenue));
  const cogs = sum(dispatches, d => safeNumber(d.cogs));
  const grossProfit = sum(dispatches, d => safeNumber(d.grossProfit));

  const stockByLot = currentStockByLot(input.stockMovements);
  const costTotalsByLot = costsByLot(input.costEntries);
  const bottleTotalsByLot = bottlesProducedByLot(input.bottlingRuns);
  let stockOnHandBottles = 0;
  let finishedGoodsValue = 0;
  for (const lotId of lotIds) {
    const onHand = Math.max(0, stockByLot.get(lotId) || 0);
    stockOnHandBottles += onHand;
    const produced = bottleTotalsByLot.get(lotId) || 0;
    const perBottle = produced > 0 ? (costTotalsByLot.get(lotId) || 0) / produced : 0;
    finishedGoodsValue = round2(finishedGoodsValue + (onHand * perBottle));
  }

  return {
    year,
    mode,
    lotIds: Array.from(lotIds),
    lotCount: lotIds.size,
    harvestKg: sum(harvests, h => positive(h.actualHarvestedKg) || positive(h.estimatedTons) * 1000),
    grapeIntakeKg: sum(grapeIntakes, i => positive(i.netWeightKg)),
    producedLitres,
    currentBulkLitres: sum(lotList, l => positive(l.currentVolume)),
    bottledBottles,
    bottledLitres,
    dispatchedBottles: sum(dispatches, d => positive(d.bottles)),
    reservedBottles: sum(activeOrders, o => positive(o.bottles)),
    stockOnHandBottles: round2(stockOnHandBottles),
    stockMovementBottles: sum(stockMovements, signedMovement),
    revenue,
    cogs,
    grossProfit,
    grossMarginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
    costTotal,
    costPerLitre: producedLitres > 0 ? round2(costTotal / producedLitres) : null,
    costPerBottle: bottledBottles > 0 ? round2(costTotal / bottledBottles) : null,
    finishedGoodsValue,
    costsByCategory,
    wines: buildWineSummaries(input, year, mode, lotIds, asOfDate),
  };
}

export function buildYearComparison(input: YearComparisonInput, options: {
  currentYear: number;
  previousYear?: number;
  mode?: YearComparisonMode;
}): YearComparison {
  const mode = options.mode || 'vintage';
  const currentYear = options.currentYear;
  const previousYear = options.previousYear ?? currentYear - 1;
  const current = buildYearBucket(input, currentYear, mode);
  const previous = buildYearBucket(input, previousYear, mode);

  const metrics = [
    compareMetric('harvestKg', 'Harvested grapes', current.harvestKg, previous.harvestKg, 'number', 'kg'),
    compareMetric('grapeIntakeKg', 'Grapes received', current.grapeIntakeKg, previous.grapeIntakeKg, 'number', 'kg'),
    compareMetric('producedLitres', 'Estimated wine volume', current.producedLitres, previous.producedLitres, 'number', 'L'),
    compareMetric('bottledBottles', 'Bottled production', current.bottledBottles, previous.bottledBottles, 'number', 'btl'),
    compareMetric('stockOnHandBottles', mode === 'vintage' ? 'FG stock now' : 'Current stock from year lots', current.stockOnHandBottles, previous.stockOnHandBottles, 'number', 'btl'),
    compareMetric('reservedBottles', 'Reserved stock', current.reservedBottles, previous.reservedBottles, 'number', 'btl'),
    compareMetric('dispatchedBottles', 'Dispatched bottles', current.dispatchedBottles, previous.dispatchedBottles, 'number', 'btl'),
    compareMetric('revenue', 'Revenue', current.revenue, previous.revenue, 'money'),
    compareMetric('costTotal', 'Total production cost', current.costTotal, previous.costTotal, 'money', undefined, false),
    compareMetric('costPerBottle', 'Cost per bottle', current.costPerBottle, previous.costPerBottle, 'money', undefined, false),
    compareMetric('grossProfit', 'Gross profit', current.grossProfit, previous.grossProfit, 'money'),
    compareMetric('grossMarginPct', 'Gross margin', current.grossMarginPct, previous.grossMarginPct, 'percent'),
    compareMetric('finishedGoodsValue', 'Finished goods value', current.finishedGoodsValue, previous.finishedGoodsValue, 'money'),
  ];

  return {
    mode,
    currentYear,
    previousYear,
    current,
    previous,
    metrics,
    insights: buildInsights(current, previous, mode),
  };
}

function buildInsights(current: YearBucket, previous: YearBucket, mode: YearComparisonMode): string[] {
  const insights: string[] = [];
  const label = mode === 'vintage' ? 'vintage' : 'calendar year';
  if (previous.lotCount === 0 && previous.revenue === 0 && previous.costTotal === 0) {
    insights.push(`No comparable ${previous.year} ${label} data yet; this will sharpen as historical records accumulate.`);
  }
  if (current.revenue > previous.revenue) {
    insights.push(`Revenue is up by ${round2(current.revenue - previous.revenue).toLocaleString()} versus ${previous.year}.`);
  } else if (current.revenue < previous.revenue) {
    insights.push(`Revenue is down by ${round2(previous.revenue - current.revenue).toLocaleString()} versus ${previous.year}.`);
  }
  if (current.costPerBottle != null && previous.costPerBottle != null) {
    if (current.costPerBottle > previous.costPerBottle) {
      insights.push(`Cost per bottle increased by ${round2(current.costPerBottle - previous.costPerBottle).toLocaleString()}; review grape, packaging, and bottling components.`);
    } else if (current.costPerBottle < previous.costPerBottle) {
      insights.push(`Cost per bottle improved by ${round2(previous.costPerBottle - current.costPerBottle).toLocaleString()} compared with ${previous.year}.`);
    }
  }
  if (current.reservedBottles > 0) {
    insights.push(`${current.reservedBottles.toLocaleString()} bottles are reserved but not physically dispatched yet.`);
  }
  if (insights.length === 0) {
    insights.push(`Current ${current.year} ${label} is broadly in line with ${previous.year}.`);
  }
  return insights.slice(0, 4);
}
