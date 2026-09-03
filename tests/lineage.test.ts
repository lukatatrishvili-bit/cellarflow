import { describe, expect, it } from 'vitest';
import {
  buildAllLineageGraph,
  buildLotLineageGraph,
  connectedLotIds,
  detectCycles,
  fitLineageZoom,
  layoutLineageGraph,
  lineagePathTargets,
  shortestPathNodeIds,
} from '../lib/lineage';
import type { LineageGraph } from '../lib/lineage';
import type {
  BottlingRunRecord,
  CellarOperation,
  CellarTransferRecord,
  CertificationRecord,
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
  certificationRecords: [
    { id: 'cert-1', lotId: 'BLEND-1', productType: 'wine', samplePrepared: true, sampleDate: '2027-02-10', labProtocolUploaded: true, applicationStatus: 'approved', balanceCheckStatus: 'passed', organolepticResult: 'passed', certificateNumber: 'CERT-1', issueDate: '2027-02-20', purpose: 'export' },
  ] as CertificationRecord[],
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

  it('includes downstream bottling, storage, reservation, dispatch, and certification nodes', () => {
    const graph = buildLotLineageGraph(input, 'LOT-A');
    expect(graph.nodes.map(n => n.type)).toEqual(expect.arrayContaining(['bottling', 'storage', 'reservation', 'dispatch', 'certification']));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'lot:BLEND-1', to: 'bottling:bot-1', type: 'bottled' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'bottling:bot-1', to: 'storage:loc-1:BLEND-1', type: 'stored' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'lot:BLEND-1', to: 'cert:cert-1', type: 'certified' }));
  });

  it('does not render reversed intake evidence as physical lineage', () => {
    const original = { ...input.grapeIntakes[0], commandId: 'cmd-intake', reversedByCommandId: 'cmd-reversal' };
    const correction: GrapeIntakeRecord = {
      ...input.grapeIntakes[0], id: 'intake-correction', commandId: 'cmd-reversal', recordKind: 'reversal',
      reversalOfIntakeId: original.id, reversalOfCommandId: original.commandId,
    };
    const graph = buildAllLineageGraph({ ...input, grapeIntakes: [original, correction] });
    expect(graph.nodes.some(node => node.id === 'intake:intake-a')).toBe(false);
    expect(graph.nodes.some(node => node.id === 'intake:intake-correction')).toBe(false);
  });

  it('shows the historical dispatch once and omits the compensating return as new physical lineage', () => {
    const original = input.salesDispatches[0];
    const graph = buildLotLineageGraph({
      ...input,
      salesDispatches: [
        {
          ...original,
          reversedByCommandId: 'cmd-sale-reversal',
          reversedAt: '2027-03-02T10:00:00.000Z',
          reversalReason: 'Returned shipment.',
        },
        {
          ...original,
          id: 'sale-1-reversal',
          recordKind: 'reversal',
          date: '2027-03-02',
          stockMovementId: 'mov-return',
          reversalOfDispatchId: original.id,
          reversalOfCommandId: 'cmd-sale-original',
        },
      ] as SalesDispatchRecord[],
    }, 'BLEND-1');

    expect(graph.nodes).toContainEqual(expect.objectContaining({
      id: 'dispatch:sale-1',
      label: 'Restaurant (reversed)',
      metadata: expect.objectContaining({ reversalReason: 'Returned shipment.' }),
    }));
    expect(graph.nodes.some(node => node.id === 'dispatch:sale-1-reversal')).toBe(false);
  });

  it('omits reversed cellar treatments and their compensation from physical lineage', () => {
    const original = {
      ...input.cellarOps[0],
      commandId: 'cmd-operation-original',
      recordKind: 'operation' as const,
      reversedByCommandId: 'cmd-operation-reversal',
    };
    const correction: CellarOperation = {
      ...input.cellarOps[0],
      id: 'op-1-reversal',
      commandId: 'cmd-operation-reversal',
      recordKind: 'reversal',
      type: 'correction',
      reversalOfOperationId: original.id,
      reversalOfCommandId: original.commandId,
    };
    const graph = buildAllLineageGraph({ ...input, cellarOps: [original, correction] });

    expect(graph.nodes.some(node => node.id === 'op:op-1')).toBe(false);
    expect(graph.nodes.some(node => node.id === 'op:op-1-reversal')).toBe(false);
  });

  it('prefers explicit transfer lineage facts over display-name inference', () => {
    const explicitLots = [
      lot({ id: 'PARENT-A', name: 'Parent alpha' }),
      lot({ id: 'PARENT-B', name: 'Parent beta' }),
      lot({ id: 'RESULT', name: 'Named independently', initialVolume: 950 }),
    ];
    const graph = buildLotLineageGraph({
      ...input,
      lots: explicitLots,
      grapeIntakes: [],
      cellarOps: [],
      bottlingRuns: [],
      storageLocations: [],
      stockMovements: [],
      salesOrders: [],
      salesDispatches: [],
      certificationRecords: [],
      transfers: [{
        id: 'explicit-blend',
        commandId: 'cmd-explicit-blend',
        lineageVersion: 1,
        sourceLotId: 'PARENT-A',
        destinationLotId: 'PARENT-B',
        resultLotId: 'RESULT',
        sourceContributionL: 450,
        destinationContributionL: 500,
        arrivalVolumeL: 445,
        sourceId: 'T-1',
        destId: 'T-2',
        volume: 450,
        loss: 5,
        operator: 'Nino',
        category: 'blend',
        date: '2026-12-01',
        pump: 'P-1',
        details: 'Structured lineage record',
      }],
    }, 'RESULT');

    expect(graph.edges).toContainEqual(expect.objectContaining({
      from: 'lot:PARENT-A',
      to: 'blend:explicit-blend',
      type: 'blended',
      volumeL: 450,
    }));
    expect(graph.edges).toContainEqual(expect.objectContaining({
      from: 'lot:PARENT-B',
      to: 'blend:explicit-blend',
      volumeL: 500,
    }));
    expect(graph.nodes.some(node => node.id === 'transfer:explicit-blend')).toBe(false);
  });

  it('shows a reversed original once and does not invent physical lineage from its correction record', () => {
    const original = {
      id: 'xfer-reversed',
      commandId: 'cmd-xfer-reversed',
      recordKind: 'transfer' as const,
      sourceLotId: 'LOT-A',
      resultLotId: 'LOT-A',
      sourceId: 'T-1',
      destId: 'T-2',
      volume: 100,
      loss: 2,
      operator: 'Nino',
      category: 'racking',
      date: '2026-12-02',
      pump: 'P-1',
      details: 'Structured transfer',
      reversedByCommandId: 'cmd-xfer-reversal',
      reversedAt: '2026-12-02T12:00:00.000Z',
      reversalReason: 'Wrong destination.',
    };
    const graph = buildLotLineageGraph({
      ...input,
      transfers: [original, {
        id: 'xfer-reversal',
        commandId: 'cmd-xfer-reversal',
        recordKind: 'reversal',
        reversalOfTransferId: original.id,
        reversalOfCommandId: original.commandId,
        sourceLotId: 'LOT-A',
        resultLotId: 'LOT-A',
        sourceId: 'T-2',
        destId: 'T-1',
        volume: 100,
        loss: 0,
        operator: 'Owner',
        category: 'reversal',
        date: '2026-12-02',
        pump: 'Accounting correction',
        details: 'Reversed transfer.',
      }],
    }, 'LOT-A');

    expect(graph.nodes).toContainEqual(expect.objectContaining({
      id: 'transfer:xfer-reversed',
      label: 'racking · reversed',
    }));
    expect(graph.nodes.some(node => node.id === 'transfer:xfer-reversal')).toBe(false);
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

  it('wraps dense depth bands into readable columns instead of an unbounded vertical stack', () => {
    const graph: LineageGraph = {
      nodes: [
        { id: 'root', type: 'wine_lot', label: 'Root' },
        ...Array.from({ length: 20 }, (_, index) => ({
          id: `operation-${index}`,
          type: 'cellar_operation' as const,
          label: `Operation ${index}`,
        })),
        { id: 'terminal', type: 'bottling', label: 'Bottling' },
      ],
      edges: [
        ...Array.from({ length: 20 }, (_, index) => ({
          id: `root-operation-${index}`,
          from: 'root',
          to: `operation-${index}`,
          type: 'operated' as const,
        })),
        ...Array.from({ length: 20 }, (_, index) => ({
          id: `operation-terminal-${index}`,
          from: `operation-${index}`,
          to: 'terminal',
          type: 'bottled' as const,
        })),
      ],
    };

    const positioned = layoutLineageGraph(graph);
    const operations = positioned.nodes.filter(node => node.type === 'cellar_operation');
    const terminal = positioned.nodes.find(node => node.id === 'terminal')!;
    const operationColumns = new Set(operations.map(node => node.x));

    expect(operationColumns.size).toBe(3);
    expect(positioned.height).toBeLessThan(1_100);
    expect(terminal.x).toBeGreaterThan(Math.max(...operations.map(node => node.x)));
  });

  it('returns the smallest selected audit path instead of the full connected component', () => {
    const graph = buildLotLineageGraph(input, 'BLEND-1');
    const path = shortestPathNodeIds(graph, 'lot:BLEND-1', 'dispatch:sale-1');

    expect(Array.from(path)).toEqual(expect.arrayContaining([
      'lot:BLEND-1',
      'bottling:bot-1',
      'storage:loc-1:BLEND-1',
      'dispatch:sale-1',
    ]));
    expect(path.has('op:op-1')).toBe(false);
    expect(path.size).toBeLessThan(graph.nodes.length);
  });

  it('ranks downstream trace endpoints ahead of low-level operations', () => {
    const graph = buildLotLineageGraph(input, 'BLEND-1');
    const targets = lineagePathTargets(graph, 'lot:BLEND-1');

    expect(targets[0].type).toBe('dispatch');
    expect(targets.findIndex(node => node.type === 'certification')).toBeLessThan(
      targets.findIndex(node => node.type === 'cellar_operation'),
    );
    expect(targets.some(node => node.id === 'lot:BLEND-1')).toBe(false);
  });

  it('computes a bounded fit zoom for narrow and invalid viewports', () => {
    expect(fitLineageZoom(822, 360, 336, 378)).toBeCloseTo(0.33, 2);
    expect(fitLineageZoom(12_000, 1_000, 336, 600)).toBe(0.02);
    expect(fitLineageZoom(822, 360, 1400, 900)).toBe(1.4);
    expect(fitLineageZoom(0, 360, 336, 378)).toBe(1);
  });
});
