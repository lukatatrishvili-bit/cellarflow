import { describe, expect, it } from 'vitest';
import {
  buildAllLineageGraph,
  buildLotLineageGraph,
  connectedLotIds,
  detectCycles,
  layoutLineageGraph,
} from '../lib/lineage';
import type {
  BottlingRunRecord,
  CellarOperation,
  CellarTransferRecord,
  GrapeIntakeRecord,
  SalesDispatchRecord,
  SalesOrderRecord,
  WineLot,
} from '../lib/wineryState';
import type { StorageLocation, StockMovement } from '../lib/storage';

const lot = (over: Partial<WineLot>): WineLot => ({
  id: 'LOT-A',
  name: 'Lot A',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Block A',
  region: 'Kakheti',
  initialVolume: 1000,
  currentVolume: 800,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-09-10',
  history: [],
  ...over,
});

const lots: WineLot[] = [
  lot({ id: 'LOT-A', name: 'Lot A', createdAt: '2026-09-10' }),
  lot({ id: 'LOT-B', name: 'Lot B', createdAt: '2026-09-11' }),
  lot({
    id: 'BLEND-1',
    name: 'Assembly: Lot A / Lot B',
    variety: 'Saperavi (55%) / Rkatsiteli (45%)',
    createdAt: '2026-12-01',
    initialVolume: 1800,
    currentVolume: 1700,
  }),
];

const input = {
  lots,
  grapeIntakes: [
    { id: 'intake-a', date: '2026-09-10', source: 'own', blockName: 'Block A', variety: 'Saperavi', vintage: 2026, grossWeightKg: 1200, tareWeightKg: 100, netWeightKg: 1100, brix: 24, ph: 3.5, titratableAcidity: 5.2, temperatureC: 18, condition: 'excellent', pickingMethod: 'hand', wineClass: 'red', juiceYieldPct: 70, estimatedVolumeL: 770, destinationVesselId: null, createdLotId: 'LOT-A', operator: 'Nino', notes: '' },
  ] as GrapeIntakeRecord[],
  cellarOps: [
    { id: 'op-1', date: '2026-12-10', type: 'filtration', lotId: 'BLEND-1', lotName: 'Assembly: Lot A / Lot B', operator: 'Nino', notes: 'Polish filtration' },
  ] as CellarOperation[],
  transfers: [
    { id: 'xfer-1', sourceId: 'T1', destId: 'T2', volume: 900, loss: 5, operator: 'Nino', category: 'blend', date: '2026-12-01', pump: 'P1', details: 'Merged into brand-new genealogy lot: "BLEND-1"' },
  ] as CellarTransferRecord[],
  bottlingRuns: [
    { id: 'bot-1', lotId: 'BLEND-1', lotName: 'Assembly: Lot A / Lot B', date: '2027-02-01', lotNumber: 'B-001', operator: 'Nino', formats: {}, totalBottles: 1200, totalCeramic: 0, volumeBottledL: 900, storageLocationId: 'loc-1' },
  ] as BottlingRunRecord[],
  storageLocations: [
    { id: 'loc-1', name: 'Main Warehouse', type: 'warehouse' },
  ] as StorageLocation[],
  stockMovements: [
    { id: 'mov-in', date: '2027-02-01', lotId: 'BLEND-1', locationId: 'loc-1', direction: 'in', bottles: 1200, reason: 'bottling', sourceRef: 'bot-1' },
    { id: 'mov-out', date: '2027-03-01', lotId: 'BLEND-1', locationId: 'loc-1', direction: 'out', bottles: 100, reason: 'sale', sourceRef: 'sale-1' },
  ] as StockMovement[],
  salesOrders: [
    { id: 'so-1', orderDate: '2027-02-15', createdAt: '2027-02-15T00:00:00Z', customerName: 'Wine Bar', lotId: 'BLEND-1', lotName: 'Assembly: Lot A / Lot B', locationId: 'loc-1', locationName: 'Main Warehouse', bottles: 80, pricePerBottle: 20, currency: 'GEL', revenue: 1600, status: 'reserved', operator: 'Nino' },
  ] as SalesOrderRecord[],
  salesDispatches: [
    { id: 'sale-1', date: '2027-03-01', customerName: 'Restaurant', lotId: 'BLEND-1', lotName: 'Assembly: Lot A / Lot B', locationId: 'loc-1', locationName: 'Main Warehouse', bottles: 100, pricePerBottle: 20, currency: 'GEL', revenue: 2000, cogs: 500, grossProfit: 1500, marginPct: 75, stockMovementId: 'mov-out', operator: 'Nino' },
  ] as SalesDispatchRecord[],
  asOfDate: '2027-02-20',
};

describe('wine lineage graph', () => {
  it('links grape intake into its created wine lot', () => {
    const graph = buildAllLineageGraph(input);
    expect(graph.nodes.some(n => n.id === 'intake:intake-a')).toBe(true);
    expect(graph.edges).toContainEqual(expect.objectContaining({
      from: 'intake:intake-a',
      to: 'lot:LOT-A',
      type: 'created',
    }));
  });

  it('infers an assembly blend as multiple parent lines merging into the result lot', () => {
    const graph = buildLotLineageGraph(input, 'BLEND-1');
    expect(graph.nodes.some(n => n.id === 'blend:xfer-1')).toBe(true);
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'lot:LOT-A', to: 'blend:xfer-1', type: 'blended' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'lot:LOT-B', to: 'blend:xfer-1', type: 'blended' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'blend:xfer-1', to: 'lot:BLEND-1', type: 'created' }));
    expect(connectedLotIds(graph, 'BLEND-1')).toEqual(['BLEND-1', 'LOT-A', 'LOT-B']);
  });

  it('includes downstream bottling, storage, reservation, and dispatch nodes', () => {
    const graph = buildLotLineageGraph(input, 'LOT-A');
    expect(graph.nodes.map(n => n.type)).toEqual(expect.arrayContaining(['bottling', 'storage', 'reservation', 'dispatch']));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'lot:BLEND-1', to: 'bottling:bot-1', type: 'bottled' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'bottling:bot-1', to: 'storage:loc-1:BLEND-1', type: 'stored' }));
  });

  it('lays out the graph horizontally and detects cycles defensively', () => {
    const graph = buildLotLineageGraph(input, 'BLEND-1');
    const positioned = layoutLineageGraph(graph);
    const parent = positioned.nodes.find(n => n.id === 'lot:LOT-A')!;
    const blend = positioned.nodes.find(n => n.id === 'blend:xfer-1')!;
    const result = positioned.nodes.find(n => n.id === 'lot:BLEND-1')!;
    expect(parent.x).toBeLessThan(blend.x);
    expect(blend.x).toBeLessThan(result.x);
    expect(positioned.width).toBeGreaterThan(500);
    expect(positioned.hasCycle).toBe(false);

    expect(detectCycles({
      nodes: [{ id: 'a', type: 'wine_lot', label: 'a' }, { id: 'b', type: 'wine_lot', label: 'b' }],
      edges: [
        { id: 'a-b', from: 'a', to: 'b', type: 'created' },
        { id: 'b-a', from: 'b', to: 'a', type: 'created' },
      ],
    })).toBe(true);
  });
});
