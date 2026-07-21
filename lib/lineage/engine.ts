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
import { isActiveHarvestIntake } from '../harvestIntakeIntegrity';
import type { StorageLocation, StockMovement } from '../storage';
import { isSalesDispatchReversal } from '../sales';
import { isActiveBottlingRun } from '../bottlingIntegrity';
import { isActiveCellarOperation } from '../cellarOperationIntegrity';
import type {
  LineageEdge,
  LineageGraph,
  LineageNode,
  LineageNodeType,
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
const MAX_ROWS_PER_COLUMN = 8;

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
    subtitle: `${lot.name || lot.variety}${lot.voidedAt ? ' · voided' : ''}`,
    lotId: lot.id,
    date: safeDate(lot.createdAt),
    volumeL: positive(lot.currentVolume),
    metadata: {
      vintage: lot.vintage,
      variety: lot.variety,
      stage: lot.stage,
      wineClass: lot.wineClass,
      voidedAt: lot.voidedAt,
      voidedByCommandId: lot.voidedByCommandId,
      voidReason: lot.voidReason,
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
  const explicit = transfers.find(t => t.recordKind !== 'reversal' && t.category === 'blend' && t.resultLotId === lot.id);
  if (explicit) return explicit;
  return transfers.find(t => (
    t.recordKind !== 'reversal'
    && safeDate(t.date) === safeDate(lot.createdAt)
    && (t.category === 'blend' || t.details?.includes(lot.id) || t.details?.includes(lot.name))
  )) || transfers.find(t => (
    t.recordKind !== 'reversal' && (t.details?.includes(lot.id) || t.details?.includes(lot.name))
  ));
}

function blendParents(lot: WineLot, allLots: WineLot[], transfer?: CellarTransferRecord): WineLot[] {
  const explicitIds = [transfer?.sourceLotId, transfer?.destinationLotId]
    .filter((id): id is string => Boolean(id) && id !== lot.id);
  const explicit = explicitIds
    .map(id => allLots.find(candidate => candidate.id === id))
    .filter((candidate): candidate is WineLot => Boolean(candidate));
  const uniqueExplicit = explicit.filter((candidate, index) => explicit.findIndex(item => item.id === candidate.id) === index);
  return uniqueExplicit.length >= 2 ? uniqueExplicit : inferBlendParents(lot, allLots);
}

export function buildAllLineageGraph(input: BuildLineageInput): LineageGraph {
  const nodes = new Map<string, LineageNode>();
  const edges = new Map<string, LineageEdge>();
  const lotsById = new Map((input.lots || []).map(l => [l.id, l]));
  const representedBlendTransferIds = new Set<string>();
  const asOfDate = input.asOfDate || new Date().toISOString().slice(0, 10);

  for (const lot of input.lots || []) {
    addNode(nodes, lotNode(lot));
  }

  for (const intake of input.grapeIntakes || []) {
    if (!isActiveHarvestIntake(intake)) continue;
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
    const transfer = transferForBlend(lot, input.transfers || []);
    const parents = blendParents(lot, input.lots || [], transfer);
    if (parents.length < 2) continue;
    if (transfer) representedBlendTransferIds.add(transfer.id);
    const blendId = nodeId('blend', transfer?.id || lot.id);
    addNode(nodes, {
      id: blendId,
      type: 'blend',
      label: `Blend / Assembly${transfer?.reversedByCommandId ? ' · reversed' : ''}`,
      subtitle: lot.id,
      lotId: lot.id,
      date: safeDate(transfer?.date || lot.createdAt),
      volumeL: positive(lot.initialVolume),
      metadata: {
        resultingLotId: lot.id,
        transferId: transfer?.id,
        sourceLotId: transfer?.sourceLotId,
        destinationLotId: transfer?.destinationLotId,
        sourceContributionL: transfer?.sourceContributionL,
        destinationContributionL: transfer?.destinationContributionL,
        arrivalVolumeL: transfer?.arrivalVolumeL,
        details: transfer?.details,
        reversedByCommandId: transfer?.reversedByCommandId,
        reversedAt: transfer?.reversedAt,
        reversalReason: transfer?.reversalReason,
      },
    });

    for (const parent of parents) {
      const from = nodeId('lot', parent.id);
      const contribution = parent.id === transfer?.sourceLotId
        ? transfer.sourceContributionL
        : parent.id === transfer?.destinationLotId
          ? transfer.destinationContributionL
          : undefined;
      addEdge(edges, {
        id: edgeId('blended', from, blendId),
        from,
        to: blendId,
        type: 'blended',
        label: contribution ? `${parent.id} · ${contribution.toLocaleString()} L` : parent.id,
        volumeL: positive(contribution),
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
    // Reversal records are immutable audit evidence, not a second physical
    // movement. The original node carries the correction metadata instead.
    if (transfer.recordKind === 'reversal') continue;
    if (representedBlendTransferIds.has(transfer.id)) continue;
    const explicitLot = lotsById.get(transfer.resultLotId || transfer.sourceLotId || '')
      || input.lots.find(l => transfer.details?.includes(l.id));
    if (!explicitLot) continue;
    const transferId = nodeId('transfer', transfer.id);
    const lotId = nodeId('lot', explicitLot.id);
    addNode(nodes, {
      id: transferId,
      type: 'transfer',
      label: `${transfer.category || 'Transfer'}${transfer.reversedByCommandId ? ' · reversed' : ''}`,
      subtitle: `${transfer.sourceId} → ${transfer.destId}`,
      lotId: explicitLot.id,
      date: safeDate(transfer.date),
      volumeL: positive(transfer.arrivalVolumeL ?? (transfer.volume - transfer.loss)),
      metadata: {
        pump: transfer.pump,
        details: transfer.details,
        sourceLotId: transfer.sourceLotId,
        destinationLotId: transfer.destinationLotId,
        resultLotId: transfer.resultLotId,
        commandId: transfer.commandId,
        reversedByCommandId: transfer.reversedByCommandId,
        reversedAt: transfer.reversedAt,
        reversalReason: transfer.reversalReason,
      },
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
    if (!isActiveCellarOperation(op)) continue;
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

  const activeBottlingRunIds = new Set((input.bottlingRuns || [])
    .filter(isActiveBottlingRun)
    .map(run => run.id));
  for (const run of input.bottlingRuns || []) {
    if (!isActiveBottlingRun(run)) continue;
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
    if (movement.reason === 'bottling' && movement.sourceRef
      && !activeBottlingRunIds.has(movement.sourceRef)) continue;
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
    if (!lotsById.has(dispatch.lotId) || isSalesDispatchReversal(dispatch)) continue;
    const id = nodeId('dispatch', dispatch.id);
    addNode(nodes, {
      id,
      type: 'dispatch',
      label: dispatch.reversedByCommandId ? `${dispatch.customerName} (reversed)` : dispatch.customerName,
      subtitle: dispatch.locationName,
      lotId: dispatch.lotId,
      date: safeDate(dispatch.date),
      bottles: positive(dispatch.bottles),
      metadata: {
        revenue: dispatch.revenue,
        grossProfit: dispatch.grossProfit,
        marginPct: dispatch.marginPct,
        salesOrderId: dispatch.salesOrderId,
        reversedAt: dispatch.reversedAt,
        reversalReason: dispatch.reversalReason,
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

/** Return the smallest undirected audit path between two graph nodes. */
export function shortestPathNodeIds(graph: LineageGraph, startNodeId: string, endNodeId: string): Set<string> {
  if (startNodeId === endNodeId) return new Set([startNodeId]);
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from)!.push(edge.to);
    adjacency.get(edge.to)!.push(edge.from);
  }
  if (!adjacency.has(startNodeId) || !adjacency.has(endNodeId)) return new Set();

  const previous = new Map<string, string | null>([[startNodeId, null]]);
  const queue = [startNodeId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adjacency.get(id) || []) {
      if (previous.has(next)) continue;
      previous.set(next, id);
      if (next === endNodeId) {
        const path = new Set<string>();
        let cursor: string | null = endNodeId;
        while (cursor) {
          path.add(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return new Set();
}

/** Rank useful trace endpoints so dense graphs can be navigated without clicking tiny cards. */
export function lineagePathTargets(graph: LineageGraph, startNodeId: string): LineageNode[] {
  const typeRank: Record<LineageNodeType, number> = {
    dispatch: 0,
    certification: 1,
    reservation: 2,
    storage: 3,
    bottling: 4,
    blend: 5,
    transfer: 6,
    cellar_operation: 7,
    grape_intake: 8,
    wine_lot: 9,
  };
  return graph.nodes
    .filter(node => node.id !== startNodeId)
    .sort((a, b) => (
      typeRank[a.type] - typeRank[b.type]
      || (safeDate(b.date) || '').localeCompare(safeDate(a.date) || '')
      || a.label.localeCompare(b.label)
      || a.id.localeCompare(b.id)
    ));
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
  let layoutColumn = 0;
  for (const [d, list] of Array.from(byDepth.entries()).sort(([left], [right]) => left - right)) {
    list.sort((a, b) => {
      if (a.emphasis !== b.emphasis) return a.emphasis ? -1 : 1;
      return compareNodes(a, b);
    });
    const columnCount = Math.max(1, Math.ceil(list.length / MAX_ROWS_PER_COLUMN));
    maxRows = Math.max(maxRows, Math.min(list.length, MAX_ROWS_PER_COLUMN));
    list.forEach((node, idx) => {
      const columnOffset = Math.floor(idx / MAX_ROWS_PER_COLUMN);
      const row = idx % MAX_ROWS_PER_COLUMN;
      positioned.push({
        ...node,
        depth: d,
        x: PAD_X + (layoutColumn + columnOffset) * X_GAP,
        y: PAD_Y + row * Y_GAP,
      });
    });
    layoutColumn += columnCount;
  }

  return {
    nodes: positioned.sort((a, b) => a.depth - b.depth || a.y - b.y),
    edges: graph.edges,
    width: PAD_X * 2 + NODE_W + Math.max(0, layoutColumn - 1) * X_GAP,
    height: PAD_Y * 2 + NODE_H + (maxRows - 1) * Y_GAP,
    hasCycle: detectCycles(graph),
  };
}

export function fitLineageZoom(
  graphWidth: number,
  graphHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 32,
): number {
  if (![graphWidth, graphHeight, viewportWidth, viewportHeight].every(value => Number.isFinite(value) && value > 0)) return 1;
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  const scale = Math.min(availableWidth / graphWidth, availableHeight / graphHeight, 1.4);
  // A very small overview is still valuable for dense audit graphs; users can
  // then select a node and switch to the much shorter selected-path view.
  return Math.max(0.02, Math.round(scale * 100) / 100);
}

export const LINEAGE_NODE_WIDTH = NODE_W;
export const LINEAGE_NODE_HEIGHT = NODE_H;
