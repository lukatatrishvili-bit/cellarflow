import type {
  BottlingRunRecord,
  CellarOperation,
  CellarTransferRecord,
  CertificationRecord,
  GrapeIntakeRecord,
  SalesDispatchRecord,
  SalesOrderRecord,
  WineLot,
} from '../wineryState';
import type { StorageLocation, StockMovement } from '../storage';
import type {
  LineageEdge,
  LineageGraph,
  LineageNode,
  PositionedLineageGraph,
  PositionedLineageNode,
} from './types';

export interface BuildLineageInput {
  lots: WineLot[];
  grapeIntakes: GrapeIntakeRecord[];
  cellarOps: CellarOperation[];
  transfers: CellarTransferRecord[];
  bottlingRuns: BottlingRunRecord[];
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
  salesOrders: SalesOrderRecord[];
  salesDispatches: SalesDispatchRecord[];
  certificationRecords?: CertificationRecord[];
  asOfDate?: string;
}

const NODE_W = 210;
const NODE_H = 86;
const X_GAP = 270;
const Y_GAP = 118;
const PAD_X = 36;
const PAD_Y = 28;

function safeDate(date?: string): string | undefined {
  return typeof date === 'string' && date.length >= 10 ? date.slice(0, 10) : undefined;
}

function positive(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

function nodeId(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function edgeId(type: string, from: string, to: string): string {
  return `${type}:${from}->${to}`;
}

function addNode(map: Map<string, LineageNode>, node: LineageNode): void {
  const existing = map.get(node.id);
  if (!existing) {
    map.set(node.id, node);
    return;
  }
  map.set(node.id, {
    ...existing,
    ...node,
    metadata: { ...(existing.metadata || {}), ...(node.metadata || {}) },
  });
}

function addEdge(map: Map<string, LineageEdge>, edge: LineageEdge): void {
  if (edge.from === edge.to) return;
  if (!map.has(edge.id)) map.set(edge.id, edge);
}

function lotNode(lot: WineLot): LineageNode {
  return {
    id: nodeId('lot', lot.id),
    type: 'wine_lot',
    label: lot.id,
    subtitle: lot.name || lot.variety,
    lotId: lot.id,
    date: safeDate(lot.createdAt),
    volumeL: positive(lot.currentVolume),
    metadata: {
      vintage: lot.vintage,
      variety: lot.variety,
      stage: lot.stage,
      wineClass: lot.wineClass,
    },
  };
}

function storageNodeId(locationId: string, lotId: string): string {
  return nodeId('storage', `${locationId}:${lotId}`);
}

function isActiveReservation(order: SalesOrderRecord, asOfDate: string): boolean {
  if (order.status !== 'reserved') return false;
  if (order.reservedUntil && order.reservedUntil < asOfDate) return false;
  return order.bottles > 0;
}

function splitAssemblyNames(name: string): string[] {
  if (!name.startsWith('Assembly:')) return [];
  const body = name.replace(/^Assembly:\s*/i, '');
  return body.split(/\s+\/\s+/).map(s => s.trim()).filter(Boolean);
}

function inferBlendParents(lot: WineLot, allLots: WineLot[]): WineLot[] {
  const names = splitAssemblyNames(lot.name || '');
  if (names.length < 2) return [];
  const parents: WineLot[] = [];
  for (const name of names) {
    const match = allLots.find(candidate => candidate.id !== lot.id && candidate.name === name);
    if (match && !parents.some(p => p.id === match.id)) parents.push(match);
  }
  return parents;
}

function transferForBlend(lot: WineLot, transfers: CellarTransferRecord[]): CellarTransferRecord | undefined {
  return transfers.find(t => (
    safeDate(t.date) === safeDate(lot.createdAt)
    && (t.category === 'blend' || t.details?.includes(lot.id) || t.details?.includes(lot.name))
  )) || transfers.find(t => t.details?.includes(lot.id) || t.details?.includes(lot.name));
}

export function buildAllLineageGraph(input: BuildLineageInput): LineageGraph {
  const nodes = new Map<string, LineageNode>();
  const edges = new Map<string, LineageEdge>();
  const lotsById = new Map((input.lots || []).map(l => [l.id, l]));
  const asOfDate = input.asOfDate || new Date().toISOString().slice(0, 10);

  for (const lot of input.lots || []) {
    addNode(nodes, lotNode(lot));
  }

  for (const intake of input.grapeIntakes || []) {
    const lot = lotsById.get(intake.createdLotId);
    const id = nodeId('intake', intake.id);
    addNode(nodes, {
      id,
      type: 'grape_intake',
      label: `${intake.variety} intake`,
      subtitle: intake.source === 'own' ? (intake.blockName || 'Own vineyard') : (intake.supplierName || 'Supplier'),
      lotId: intake.createdLotId,
      date: safeDate(intake.date),
      volumeL: positive(intake.estimatedVolumeL),
      metadata: {
        netWeightKg: intake.netWeightKg,
        brix: intake.brix,
        ph: intake.ph,
        condition: intake.condition,
      },
    });
    if (lot) {
      const to = nodeId('lot', lot.id);
      addEdge(edges, {
        id: edgeId('created', id, to),
        from: id,
        to,
        type: 'created',
        label: `${Math.round(intake.netWeightKg || 0).toLocaleString()} kg`,
        volumeL: positive(intake.estimatedVolumeL),
        date: safeDate(intake.date),
      });
    }
  }

  for (const lot of input.lots || []) {
    const parents = inferBlendParents(lot, input.lots || []);
    if (parents.length < 2) continue;

    const transfer = transferForBlend(lot, input.transfers || []);
    const blendId = nodeId('blend', transfer?.id || lot.id);
    addNode(nodes, {
      id: blendId,
      type: 'blend',
      label: 'Blend / Assembly',
      subtitle: lot.id,
      lotId: lot.id,
      date: safeDate(transfer?.date || lot.createdAt),
      volumeL: positive(lot.initialVolume),
      metadata: {
        resultingLotId: lot.id,
        transferId: transfer?.id,
        details: transfer?.details,
      },
    });

    for (const parent of parents) {
      const from = nodeId('lot', parent.id);
      addEdge(edges, {
        id: edgeId('blended', from, blendId),
        from,
        to: blendId,
        type: 'blended',
        label: parent.id,
        date: safeDate(transfer?.date || lot.createdAt),
      });
    }
    const to = nodeId('lot', lot.id);
    addEdge(edges, {
      id: edgeId('created', blendId, to),
      from: blendId,
      to,
      type: 'created',
      label: 'new lot',
      volumeL: positive(lot.initialVolume),
      date: safeDate(transfer?.date || lot.createdAt),
    });
  }

  for (const transfer of input.transfers || []) {
    const explicitLot = input.lots.find(l => transfer.details?.includes(l.id));
    if (!explicitLot) continue;
    const transferId = nodeId('transfer', transfer.id);
    const lotId = nodeId('lot', explicitLot.id);
    addNode(nodes, {
      id: transferId,
      type: 'transfer',
      label: transfer.category || 'Transfer',
      subtitle: `${transfer.sourceId} → ${transfer.destId}`,
      lotId: explicitLot.id,
      date: safeDate(transfer.date),
      volumeL: positive(transfer.volume - transfer.loss),
      metadata: { pump: transfer.pump, details: transfer.details },
    });
    addEdge(edges, {
      id: edgeId('transferred', lotId, transferId),
      from: lotId,
      to: transferId,
      type: 'transferred',
      label: `${transfer.volume} L`,
      volumeL: positive(transfer.volume),
      date: safeDate(transfer.date),
    });
  }

  for (const op of input.cellarOps || []) {
    if (!lotsById.has(op.lotId)) continue;
    const id = nodeId('op', op.id);
    addNode(nodes, {
      id,
      type: 'cellar_operation',
      label: op.customLabel || op.type.replace(/_/g, ' '),
      subtitle: op.vesselId || op.operator,
      lotId: op.lotId,
      date: safeDate(op.date),
      volumeL: positive(op.volumeAfterL ?? op.volumeBeforeL),
      metadata: {
        materialName: op.materialName,
        dose: op.dose,
        unit: op.unit,
        notes: op.notes,
      },
    });
    const from = nodeId('lot', op.lotId);
    addEdge(edges, {
      id: edgeId('operated', from, id),
      from,
      to: id,
      type: 'operated',
      label: safeDate(op.date),
      date: safeDate(op.date),
    });
  }

  for (const run of input.bottlingRuns || []) {
    if (!lotsById.has(run.lotId)) continue;
    const id = nodeId('bottling', run.id);
    addNode(nodes, {
      id,
      type: 'bottling',
      label: run.lotNumber || 'Bottling',
      subtitle: run.lotName,
      lotId: run.lotId,
      date: safeDate(run.date),
      volumeL: positive(run.volumeBottledL),
      bottles: positive((run.totalBottles || 0) + (run.totalCeramic || 0)),
      metadata: {
        operator: run.operator,
        storageLocationId: run.storageLocationId,
      },
    });
    const from = nodeId('lot', run.lotId);
    addEdge(edges, {
      id: edgeId('bottled', from, id),
      from,
      to: id,
      type: 'bottled',
      label: `${((run.totalBottles || 0) + (run.totalCeramic || 0)).toLocaleString()} btl`,
      bottles: positive((run.totalBottles || 0) + (run.totalCeramic || 0)),
      date: safeDate(run.date),
    });
  }

  for (const movement of input.stockMovements || []) {
    if (movement.direction !== 'in' || !lotsById.has(movement.lotId)) continue;
    const loc = input.storageLocations.find(l => l.id === movement.locationId);
    const id = storageNodeId(movement.locationId, movement.lotId);
    addNode(nodes, {
      id,
      type: 'storage',
      label: loc?.name || movement.locationId,
      subtitle: movement.reason || 'Stored stock',
      lotId: movement.lotId,
      date: safeDate(movement.date),
      bottles: positive(movement.bottles),
      metadata: { locationId: movement.locationId, sourceRef: movement.sourceRef },
    });
    const sourceNode = movement.sourceRef && nodes.has(nodeId('bottling', movement.sourceRef))
      ? nodeId('bottling', movement.sourceRef)
      : nodeId('lot', movement.lotId);
    addEdge(edges, {
      id: edgeId('stored', sourceNode, id),
      from: sourceNode,
      to: id,
      type: 'stored',
      label: `${movement.bottles.toLocaleString()} btl`,
      bottles: positive(movement.bottles),
      date: safeDate(movement.date),
    });
  }

  for (const order of input.salesOrders || []) {
    if (!lotsById.has(order.lotId) || !isActiveReservation(order, asOfDate)) continue;
    const id = nodeId('reservation', order.id);
    addNode(nodes, {
      id,
      type: 'reservation',
      label: order.orderNumber || 'Reservation',
      subtitle: order.customerName,
      lotId: order.lotId,
      date: safeDate(order.orderDate || order.createdAt),
      bottles: positive(order.bottles),
      metadata: { status: order.status, revenue: order.revenue },
    });
    const storageId = storageNodeId(order.locationId, order.lotId);
    const from = nodes.has(storageId) ? storageId : nodeId('lot', order.lotId);
    addEdge(edges, {
      id: edgeId('reserved', from, id),
      from,
      to: id,
      type: 'reserved',
      label: `${order.bottles.toLocaleString()} btl`,
      bottles: positive(order.bottles),
      date: safeDate(order.orderDate),
    });
  }

  for (const dispatch of input.salesDispatches || []) {
    if (!lotsById.has(dispatch.lotId)) continue;
    const id = nodeId('dispatch', dispatch.id);
    addNode(nodes, {
      id,
      type: 'dispatch',
      label: dispatch.customerName,
      subtitle: dispatch.locationName,
      lotId: dispatch.lotId,
      date: safeDate(dispatch.date),
      bottles: positive(dispatch.bottles),
      metadata: {
        revenue: dispatch.revenue,
        grossProfit: dispatch.grossProfit,
        marginPct: dispatch.marginPct,
        salesOrderId: dispatch.salesOrderId,
      },
    });
    const reservationId = dispatch.salesOrderId ? nodeId('reservation', dispatch.salesOrderId) : null;
    const storageId = storageNodeId(dispatch.locationId, dispatch.lotId);
    const from = reservationId && nodes.has(reservationId)
      ? reservationId
      : nodes.has(storageId)
        ? storageId
        : nodeId('lot', dispatch.lotId);
    addEdge(edges, {
      id: edgeId('sold', from, id),
      from,
      to: id,
      type: 'sold',
      label: `${dispatch.bottles.toLocaleString()} btl`,
      bottles: positive(dispatch.bottles),
      date: safeDate(dispatch.date),
    });
  }

  for (const cert of input.certificationRecords || []) {
    if (!lotsById.has(cert.lotId)) continue;
    const id = nodeId('cert', cert.id);
    addNode(nodes, {
      id,
      type: 'certification',
      label: cert.certificateNumber || cert.applicationStatus || 'Certification',
      subtitle: cert.purpose ? cert.purpose.replace(/_/g, ' ') : cert.productType.replace(/_/g, ' '),
      lotId: cert.lotId,
      date: safeDate(cert.issueDate || cert.sampleDate),
      metadata: {
        productType: cert.productType,
        samplePrepared: cert.samplePrepared,
        applicationStatus: cert.applicationStatus,
        balanceCheckStatus: cert.balanceCheckStatus,
        organolepticResult: cert.organolepticResult,
        certificateFileName: cert.certificateFileName,
      },
    });
    const from = nodeId('lot', cert.lotId);
    addEdge(edges, {
      id: edgeId('certified', from, id),
      from,
      to: id,
      type: 'certified',
      label: cert.applicationStatus,
      date: safeDate(cert.issueDate || cert.sampleDate),
    });
  }

  return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) };
}

export function connectedLotIds(graph: LineageGraph, selectedLotId: string): string[] {
  const selected = nodeId('lot', selectedLotId);
  const keep = connectedNodeIds(graph, selected);
  return graph.nodes
    .filter(n => keep.has(n.id) && n.type === 'wine_lot' && n.lotId)
    .map(n => n.lotId!)
    .sort();
}

export function connectedNodeIds(graph: LineageGraph, selectedNodeId: string): Set<string> {
  const undirected = new Map<string, Set<string>>();
  for (const node of graph.nodes) undirected.set(node.id, new Set());
  for (const edge of graph.edges) {
    if (!undirected.has(edge.from) || !undirected.has(edge.to)) continue;
    undirected.get(edge.from)!.add(edge.to);
    undirected.get(edge.to)!.add(edge.from);
  }
  const seen = new Set<string>();
  const stack = [selectedNodeId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of undirected.get(id) || []) {
      if (!seen.has(next)) stack.push(next);
    }
  }
  return seen;
}

export function buildLotLineageGraph(input: BuildLineageInput, selectedLotId: string): LineageGraph {
  const full = buildAllLineageGraph(input);
  const selectedNodeId = nodeId('lot', selectedLotId);
  if (!full.nodes.some(n => n.id === selectedNodeId)) return { nodes: [], edges: [] };
  const keep = connectedNodeIds(full, selectedNodeId);
  return {
    nodes: full.nodes
      .filter(n => keep.has(n.id))
      .map(n => n.id === selectedNodeId ? { ...n, emphasis: true } : n),
    edges: full.edges.filter(e => keep.has(e.from) && keep.has(e.to)),
  };
}

export function detectCycles(graph: LineageGraph): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) outgoing.set(node.id, []);
  for (const edge of graph.edges) {
    if (outgoing.has(edge.from) && outgoing.has(edge.to)) outgoing.get(edge.from)!.push(edge.to);
  }

  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of outgoing.get(id) || []) {
      if (visit(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return graph.nodes.some(node => visit(node.id));
}

function compareNodes(a: LineageNode, b: LineageNode): number {
  const dateA = a.date || '9999-99-99';
  const dateB = b.date || '9999-99-99';
  return dateA.localeCompare(dateB) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

export function layoutLineageGraph(graph: LineageGraph): PositionedLineageGraph {
  const nodesById = new Map(graph.nodes.map(n => [n.id, n]));
  const indegree = new Map(graph.nodes.map(n => [n.id, 0]));
  const outgoing = new Map<string, LineageEdge[]>();
  for (const node of graph.nodes) outgoing.set(node.id, []);
  for (const edge of graph.edges) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
    outgoing.get(edge.from)!.push(edge);
  }

  const depth = new Map(graph.nodes.map(n => [n.id, 0]));
  const queue = graph.nodes
    .filter(n => (indegree.get(n.id) || 0) === 0)
    .sort(compareNodes)
    .map(n => n.id);
  const seen = new Set<string>();

  while (queue.length) {
    const id = queue.shift()!;
    seen.add(id);
    for (const edge of outgoing.get(id) || []) {
      depth.set(edge.to, Math.max(depth.get(edge.to) || 0, (depth.get(id) || 0) + 1));
      indegree.set(edge.to, (indegree.get(edge.to) || 0) - 1);
      if ((indegree.get(edge.to) || 0) === 0) queue.push(edge.to);
    }
    queue.sort((a, b) => compareNodes(nodesById.get(a)!, nodesById.get(b)!));
  }

  let fallbackDepth = Math.max(0, ...Array.from(depth.values()));
  for (const node of graph.nodes) {
    if (!seen.has(node.id)) depth.set(node.id, ++fallbackDepth);
  }

  const byDepth = new Map<number, LineageNode[]>();
  for (const node of graph.nodes) {
    const d = depth.get(node.id) || 0;
    const list = byDepth.get(d) || [];
    list.push(node);
    byDepth.set(d, list);
  }

  const positioned: PositionedLineageNode[] = [];
  let maxRows = 1;
  for (const [d, list] of byDepth.entries()) {
    list.sort((a, b) => {
      if (a.emphasis !== b.emphasis) return a.emphasis ? -1 : 1;
      return compareNodes(a, b);
    });
    maxRows = Math.max(maxRows, list.length);
    list.forEach((node, idx) => {
      positioned.push({
        ...node,
        depth: d,
        x: PAD_X + d * X_GAP,
        y: PAD_Y + idx * Y_GAP,
      });
    });
  }

  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  return {
    nodes: positioned.sort((a, b) => a.depth - b.depth || a.y - b.y),
    edges: graph.edges,
    width: PAD_X * 2 + NODE_W + maxDepth * X_GAP,
    height: PAD_Y * 2 + NODE_H + (maxRows - 1) * Y_GAP,
    hasCycle: detectCycles(graph),
  };
}

export const LINEAGE_NODE_WIDTH = NODE_W;
export const LINEAGE_NODE_HEIGHT = NODE_H;
