import { describe, expect, it } from 'vitest';
import {
  availableComparisonYears,
  buildYearBucket,
  buildYearComparison,
  calculateDeltaPercent,
} from '../lib/analytics';
import type {
  BottlingRunRecord,
  GrapeIntakeRecord,
  HarvestRecord,
  SalesDispatchRecord,
  SalesOrderRecord,
  WineLot,
} from '../lib/wineryState';
import type { CostEntry } from '../lib/costing';
import type { StockMovement } from '../lib/storage';

const lot = (over: Partial<WineLot>): WineLot => ({
  id: 'LOT-1',
  name: 'Saperavi Reserve',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Block A',
  region: 'Kakheti',
  initialVolume: 1000,
  currentVolume: 800,
  wineClass: 'red',
  stage: 'bottled',
  createdAt: '2026-09-15',
  history: [],
  ...over,
});

const cost = (over: Partial<CostEntry>): CostEntry => ({
  id: 'cost-1',
  date: '2026-09-20',
  lotId: 'LOT-1',
  category: 'grape',
  description: 'Fruit',
  amount: 1000,
  currency: 'GEL',
  ...over,
});

const movement = (over: Partial<StockMovement>): StockMovement => ({
  id: 'mov-1',
  date: '2026-12-01',
  lotId: 'LOT-1',
  locationId: 'loc-1',
  direction: 'in',
  bottles: 100,
  ...over,
});

const input = {
  lots: [
    lot({ id: 'LOT-2026', name: 'Saperavi 2026', vintage: 2026, createdAt: '2026-09-15', currentVolume: 600 }),
    lot({ id: 'LOT-2025', name: 'Saperavi 2025', vintage: 2025, createdAt: '2025-09-15', currentVolume: 500 }),
  ] as WineLot[],
  harvests: [
    { id: 'h-26', blockId: 'b1', variety: 'Saperavi', estimatedHarvestDate: '2026-09-10', estimatedTons: 1.2, actualHarvestDate: '2026-09-12', actualHarvestedKg: 1400, pickingMethod: 'hand', grapeCondition: 'excellent', sentToGvino: true, associatedLotId: 'LOT-2026', notes: '' },
    { id: 'h-25', blockId: 'b1', variety: 'Saperavi', estimatedHarvestDate: '2025-09-10', estimatedTons: 1, actualHarvestDate: '2025-09-12', actualHarvestedKg: 1000, pickingMethod: 'hand', grapeCondition: 'good', sentToGvino: true, associatedLotId: 'LOT-2025', notes: '' },
  ] as HarvestRecord[],
  grapeIntakes: [
    { id: 'i-26', date: '2026-09-12', source: 'own', variety: 'Saperavi', vintage: 2026, grossWeightKg: 1500, tareWeightKg: 100, netWeightKg: 1400, brix: 24, ph: 3.5, titratableAcidity: 5.2, temperatureC: 18, condition: 'excellent', pickingMethod: 'hand', wineClass: 'red', juiceYieldPct: 70, estimatedVolumeL: 980, destinationVesselId: null, createdLotId: 'LOT-2026', operator: 'Nino', notes: '' },
    { id: 'i-25', date: '2025-09-12', source: 'own', variety: 'Saperavi', vintage: 2025, grossWeightKg: 1100, tareWeightKg: 100, netWeightKg: 1000, brix: 23, ph: 3.4, titratableAcidity: 5.5, temperatureC: 18, condition: 'good', pickingMethod: 'hand', wineClass: 'red', juiceYieldPct: 70, estimatedVolumeL: 700, destinationVesselId: null, createdLotId: 'LOT-2025', operator: 'Nino', notes: '' },
  ] as GrapeIntakeRecord[],
  bottlingRuns: [
    { id: 'bot-26', lotId: 'LOT-2026', lotName: 'Saperavi 2026', date: '2027-03-01', lotNumber: 'B26', operator: 'Nino', formats: {}, totalBottles: 900, totalCeramic: 0, volumeBottledL: 675 },
    { id: 'bot-25', lotId: 'LOT-2025', lotName: 'Saperavi 2025', date: '2026-03-01', lotNumber: 'B25', operator: 'Nino', formats: {}, totalBottles: 800, totalCeramic: 0, volumeBottledL: 600 },
  ] as BottlingRunRecord[],
  costEntries: [
    cost({ id: 'c-26-grape', lotId: 'LOT-2026', date: '2026-09-12', category: 'grape', amount: 1400 }),
    cost({ id: 'c-26-pack', lotId: 'LOT-2026', date: '2027-03-01', category: 'packaging', amount: 900 }),
    cost({ id: 'c-25-grape', lotId: 'LOT-2025', date: '2025-09-12', category: 'grape', amount: 1000 }),
  ] as CostEntry[],
  stockMovements: [
    movement({ id: 'in-26', lotId: 'LOT-2026', date: '2027-03-01', direction: 'in', bottles: 900 }),
    movement({ id: 'out-26', lotId: 'LOT-2026', date: '2027-04-01', direction: 'out', bottles: 120 }),
    movement({ id: 'in-25', lotId: 'LOT-2025', date: '2026-03-01', direction: 'in', bottles: 800 }),
    movement({ id: 'out-25', lotId: 'LOT-2025', date: '2026-04-01', direction: 'out', bottles: 200 }),
  ] as StockMovement[],
  salesDispatches: [
    { id: 'sale-26', date: '2027-04-01', customerName: 'Buyer', lotId: 'LOT-2026', lotName: 'Saperavi 2026', locationId: 'loc-1', locationName: 'Main', bottles: 120, pricePerBottle: 20, currency: 'GEL', revenue: 2400, cogs: 300, grossProfit: 2100, marginPct: 87.5, stockMovementId: 'out-26', operator: 'Nino' },
    { id: 'sale-25', date: '2026-04-01', customerName: 'Buyer', lotId: 'LOT-2025', lotName: 'Saperavi 2025', locationId: 'loc-1', locationName: 'Main', bottles: 200, pricePerBottle: 18, currency: 'GEL', revenue: 3600, cogs: 250, grossProfit: 3350, marginPct: 93.06, stockMovementId: 'out-25', operator: 'Nino' },
  ] as SalesDispatchRecord[],
  salesOrders: [
    { id: 'so-26', orderDate: '2027-05-01', createdAt: '2027-05-01T00:00:00Z', customerName: 'Reserved Buyer', lotId: 'LOT-2026', lotName: 'Saperavi 2026', locationId: 'loc-1', locationName: 'Main', bottles: 50, pricePerBottle: 20, currency: 'GEL', revenue: 1000, cogs: 100, grossProfit: 900, marginPct: 90, status: 'reserved', operator: 'Nino' },
    { id: 'so-old', orderDate: '2026-05-01', createdAt: '2026-05-01T00:00:00Z', customerName: 'Expired', lotId: 'LOT-2025', lotName: 'Saperavi 2025', locationId: 'loc-1', locationName: 'Main', bottles: 30, pricePerBottle: 18, currency: 'GEL', revenue: 540, status: 'reserved', reservedUntil: '2026-05-10', operator: 'Nino' },
  ] as SalesOrderRecord[],
  asOfDate: '2027-05-02',
};

describe('year comparison analytics', () => {
  it('builds vintage buckets from lot vintage regardless of transaction calendar dates', () => {
    const bucket = buildYearBucket(input, 2026, 'vintage');
    expect(bucket.lotCount).toBe(1);
    expect(bucket.harvestKg).toBe(1400);
    expect(bucket.grapeIntakeKg).toBe(1400);
    expect(bucket.bottledBottles).toBe(900);
    expect(bucket.stockOnHandBottles).toBe(780);
    expect(bucket.reservedBottles).toBe(50);
    expect(bucket.revenue).toBe(2400);
    expect(bucket.costTotal).toBe(2300);
    expect(bucket.costPerBottle).toBe(2.56);
    expect(bucket.finishedGoodsValue).toBe(1993.33);
  });

  it('builds calendar buckets from record dates', () => {
    const bucket = buildYearBucket(input, 2026, 'calendar');
    expect(bucket.lotIds).toEqual(['LOT-2026']);
    expect(bucket.harvestKg).toBe(1400);
    expect(bucket.costTotal).toBe(1400);
    expect(bucket.bottledBottles).toBe(800);
    expect(bucket.dispatchedBottles).toBe(200);
    expect(bucket.revenue).toBe(3600);
    expect(bucket.stockMovementBottles).toBe(600);
  });

  it('computes comparison metrics and handles zero baselines without fake percentages', () => {
    expect(calculateDeltaPercent(10, 0)).toBeNull();
    expect(calculateDeltaPercent(0, 0)).toBe(0);

    const comparison = buildYearComparison(input, { mode: 'vintage', currentYear: 2026, previousYear: 2025 });
    expect(comparison.metrics.find(m => m.key === 'revenue')?.delta).toBe(-1200);
    expect(comparison.current.grossMarginPct).toBe(87.5);
    expect(comparison.insights.length).toBeGreaterThan(0);
  });

  it('discovers available years from real records', () => {
    expect(availableComparisonYears(input)).toEqual([2027, 2026, 2025]);
  });
});
