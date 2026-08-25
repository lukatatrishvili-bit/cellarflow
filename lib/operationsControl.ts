import type {
  BottlingRunRecord,
  CellarOperation,
  CellarTransferRecord,
  GrapeIntakeRecord,
  HarvestRecord,
  InventoryItem,
  SalesDispatchRecord,
  SalesOrderRecord,
  Task,
  Vessel,
  WineLot,
} from './wineryState';
import type { StockMovement, StorageLocation } from './storage';
import { buildAllLineageGraph } from './lineage';
import { taskIsAssignedToIdentity, workOwnerMatchesIdentity } from './workAssignments';

export const APPROVABLE_COMMAND_TYPES = [
  'cellar.operation',
  'cellar.operation.reverse',
  'cellar.transfer',
  'cellar.transfer.reverse',
  'cellar.bottling',
  'cellar.bottling.reverse',
  'sales.stock',
  'sales.stock.reverse',
] as const;

export type ApprovableCommandType = (typeof APPROVABLE_COMMAND_TYPES)[number];

export interface WorkflowApprovalPolicy {
  enabled: boolean;
  commandTypes: ApprovableCommandType[];
}

export type WorkflowApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'executed';

export interface WorkflowApprovalRecord {
  id: string;
  commandId: string;
  commandType: ApprovableCommandType;
  status: WorkflowApprovalStatus;
  requestedAt: string;
  requestedBy: string;
  requestSummary: string;
  payloadHash: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
  executedAt?: string;
}

export type QualitySopCategory = 'sanitation' | 'calibration' | 'sampling' | 'bottling' | 'compliance' | 'safety' | 'other';
export type QualitySopFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'seasonal';

export interface QualitySopCompletion {
  id: string;
  completedAt: string;
  completedBy: string;
  completedChecklist: string[];
  evidenceNote: string;
}

export interface QualitySop {
  id: string;
  title: string;
  category: QualitySopCategory;
  frequency: QualitySopFrequency;
  owner: string;
  active: boolean;
  nextDueDate: string;
  checklist: string[];
  evidenceRequired: boolean;
  relatedVesselId?: string;
  relatedLotId?: string;
  completionHistory: QualitySopCompletion[];
  createdAt: string;
  createdBy: string;
  lastModified?: string;
}

export type PurchaseOrderStatus = 'draft' | 'submitted' | 'ordered' | 'partially_received' | 'received' | 'cancelled';

export interface PurchaseOrderLine {
  id: string;
  inventoryItemId: string;
  productName: string;
  quantity: number;
  receivedQuantity: number;
  unit: string;
  unitCost: number;
}

export interface PurchaseOrderReceiptLine {
  purchaseOrderLineId: string;
  quantity: number;
}

export interface PurchaseOrderReceipt {
  id: string;
  commandId: string;
  receivedAt: string;
  receivedBy: string;
  lines: PurchaseOrderReceiptLine[];
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDate?: string;
  currency: 'GEL' | 'EUR' | 'USD';
  lines: PurchaseOrderLine[];
  notes: string;
  createdAt: string;
  createdBy: string;
  submittedAt?: string;
  orderedAt?: string;
  receivedAt?: string;
  receiptCommandId?: string;
  receiptHistory?: PurchaseOrderReceipt[];
  lastModified?: string;
}

export type ProductionPlanKind = 'harvest' | 'intake' | 'transfer' | 'fermentation' | 'lab' | 'bottling' | 'sanitation' | 'procurement' | 'dispatch' | 'other';
export type ProductionPlanStatus = 'planned' | 'ready' | 'blocked' | 'in_progress' | 'completed' | 'cancelled';

export interface ProductionPlanItem {
  id: string;
  title: string;
  kind: ProductionPlanKind;
  status: ProductionPlanStatus;
  startDate: string;
  endDate: string;
  assignedTo: string;
  lotId?: string;
  vesselIds: string[];
  blockId?: string;
  quantityLiters?: number;
  notes: string;
  dependencyIds: string[];
  createdAt: string;
  createdBy: string;
  lastModified?: string;
}

export type RecallCaseStatus = 'draft' | 'active' | 'contained' | 'closed';

export interface RecallCase {
  id: string;
  lotId: string;
  title: string;
  reason: string;
  status: RecallCaseStatus;
  openedAt: string;
  openedBy: string;
  affectedBottlingRunIds: string[];
  affectedOrderIds: string[];
  affectedDispatchIds: string[];
  containmentTaskIds: string[];
  notes: string;
  containedAt?: string;
  containedBy?: string;
  closedAt?: string;
  closedBy?: string;
  lastModified?: string;
}

export function recallContainmentProgress(recall: RecallCase, tasks: Task[]): { completed: number; total: number; ready: boolean } {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const completed = recall.containmentTaskIds.filter(id => byId.get(id)?.status === 'completed').length;
  return {
    completed,
    total: recall.containmentTaskIds.length,
    ready: recall.containmentTaskIds.length > 0 && completed === recall.containmentTaskIds.length,
  };
}

export function advanceRecallCase(
  recall: RecallCase,
  targetStatus: RecallCaseStatus,
  input: { actor: string; tasks: Task[]; changedAt?: string },
): RecallCase {
  const changedAt = input.changedAt || new Date().toISOString();
  const allowed: Record<RecallCaseStatus, RecallCaseStatus[]> = {
    draft: ['active'],
    active: ['contained'],
    contained: ['closed'],
    closed: [],
  };
  if (!allowed[recall.status].includes(targetStatus)) {
    throw new Error(`Recall case cannot move from ${recall.status} to ${targetStatus}.`);
  }
  const progress = recallContainmentProgress(recall, input.tasks);
  if ((targetStatus === 'contained' || targetStatus === 'closed') && !progress.ready) {
    throw new Error(`Complete all containment tasks first (${progress.completed}/${progress.total}).`);
  }
  return {
    ...recall,
    status: targetStatus,
    ...(targetStatus === 'contained' ? { containedAt: changedAt, containedBy: input.actor } : {}),
    ...(targetStatus === 'closed' ? { closedAt: changedAt, closedBy: input.actor } : {}),
    lastModified: changedAt,
  };
}

function calendarDate(value: string): Date {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addUtcMonths(value: Date, months: number): Date {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(value.getUTCDate(), lastDay)));
}

export function nextSopDueDate(currentDueDate: string, frequency: QualitySopFrequency): string {
  if (frequency === 'once') return currentDueDate;
  const next = calendarDate(currentDueDate);
  if (frequency === 'daily') next.setUTCDate(next.getUTCDate() + 1);
  if (frequency === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  if (frequency === 'monthly') return isoDate(addUtcMonths(next, 1));
  if (frequency === 'quarterly') return isoDate(addUtcMonths(next, 3));
  if (frequency === 'seasonal') return isoDate(addUtcMonths(next, 12));
  return isoDate(next);
}

export function completeQualitySop(
  sop: QualitySop,
  input: { completedBy: string; completedAt?: string; completedChecklist: string[]; evidenceNote?: string },
): QualitySop {
  const completedAt = input.completedAt || new Date().toISOString();
  const completedOn = completedAt.slice(0, 10);
  const required = new Set(sop.checklist);
  const completed = new Set(input.completedChecklist);
  if ([...required].some(item => !completed.has(item))) {
    throw new Error('Every SOP checklist item must be completed.');
  }
  if (sop.evidenceRequired && !String(input.evidenceNote || '').trim()) {
    throw new Error('This SOP requires an evidence note.');
  }
  const completion: QualitySopCompletion = {
    id: `${sop.id}-${completedAt.replace(/[^0-9]/g, '').slice(0, 17)}`,
    completedAt,
    completedBy: input.completedBy,
    completedChecklist: [...sop.checklist],
    evidenceNote: String(input.evidenceNote || '').trim(),
  };
  return {
    ...sop,
    active: sop.frequency === 'once' ? false : sop.active,
    nextDueDate: nextSopDueDate(completedOn, sop.frequency),
    completionHistory: [completion, ...sop.completionHistory].slice(0, 100),
  };
}

export function purchaseOrderTotal(order: PurchaseOrder): number {
  return order.lines.reduce((sum, line) => sum + Math.max(0, line.quantity) * Math.max(0, line.unitCost), 0);
}

export function purchaseOrderOutstandingTotal(order: PurchaseOrder): number {
  return order.lines.reduce((sum, line) => (
    sum + Math.max(0, line.quantity - line.receivedQuantity) * Math.max(0, line.unitCost)
  ), 0);
}

export function nextPurchaseOrderReceiptReference(order: PurchaseOrder): string {
  return `${order.orderNumber}-R${(order.receiptHistory?.length || 0) + 1}`;
}

const purchaseOrderStatusTransitions: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  draft: ['draft', 'submitted', 'cancelled'],
  submitted: ['submitted', 'ordered', 'cancelled'],
  ordered: ['ordered', 'cancelled'],
  partially_received: ['partially_received', 'cancelled'],
  received: ['received'],
  cancelled: ['cancelled'],
};

export function allowedPurchaseOrderStatuses(status: PurchaseOrderStatus): PurchaseOrderStatus[] {
  return [...purchaseOrderStatusTransitions[status]];
}

export function applyPurchaseOrderReceipt(
  order: PurchaseOrder,
  input: {
    quantities: Record<string, number>;
    commandId: string;
    receivedBy: string;
    receivedAt?: string;
    receiptId?: string;
  },
): PurchaseOrder {
  if (!['submitted', 'ordered', 'partially_received'].includes(order.status)) {
    throw new Error('Only submitted or ordered purchase orders can be received.');
  }
  const receivedAt = input.receivedAt || new Date().toISOString();
  if (!input.commandId.trim() || !input.receivedBy.trim() || Number.isNaN(Date.parse(receivedAt))) {
    throw new Error('Purchase order receipt evidence is incomplete.');
  }
  const receiptLines: PurchaseOrderReceiptLine[] = [];
  const lines = order.lines.map(line => {
    const quantity = Number(input.quantities[line.id] || 0);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`Receipt quantity for ${line.productName} is invalid.`);
    }
    const outstanding = Math.max(0, line.quantity - line.receivedQuantity);
    if (quantity > outstanding) {
      throw new Error(`Receipt quantity for ${line.productName} exceeds ${outstanding} ${line.unit} outstanding.`);
    }
    if (quantity === 0) return line;
    receiptLines.push({ purchaseOrderLineId: line.id, quantity });
    return { ...line, receivedQuantity: line.receivedQuantity + quantity };
  });
  if (!receiptLines.length) throw new Error('Enter a receipt quantity for at least one purchase-order line.');
  const complete = lines.every(line => line.receivedQuantity === line.quantity);
  const receipt: PurchaseOrderReceipt = {
    id: input.receiptId || `por-${input.commandId}`,
    commandId: input.commandId,
    receivedAt,
    receivedBy: input.receivedBy.trim(),
    lines: receiptLines,
  };
  return {
    ...order,
    status: complete ? 'received' : 'partially_received',
    lines,
    receiptHistory: [receipt, ...(order.receiptHistory || [])].slice(0, 1_000),
    receiptCommandId: input.commandId,
    ...(complete ? { receivedAt } : {}),
    lastModified: receivedAt,
  };
}

export function createReorderPurchaseOrder(
  items: InventoryItem[],
  input: { supplierName: string; createdBy: string; orderDate: string; currency?: PurchaseOrder['currency']; id?: string },
): PurchaseOrder {
  const supplierItems = items.filter(item => (
    item.supplierName.trim() === input.supplierName.trim() && item.stock <= item.minThreshold
  ));
  if (!supplierItems.length) throw new Error('No items from this supplier are at or below their reorder point.');
  const nonce = input.id || `${Date.now()}`;
  return {
    id: `po-${nonce}`,
    orderNumber: `PO-${input.orderDate.replace(/-/g, '')}-${String(nonce).slice(-4)}`,
    supplierName: input.supplierName.trim(),
    status: 'draft',
    orderDate: input.orderDate,
    currency: input.currency || 'GEL',
    lines: supplierItems.map((item, index) => ({
      id: `pol-${nonce}-${index + 1}`,
      inventoryItemId: item.id,
      productName: item.name,
      quantity: Math.max(item.minThreshold * 2 - item.stock, item.minThreshold || 1),
      receivedQuantity: 0,
      unit: item.unit,
      unitCost: item.costPerUnit,
    })),
    notes: '',
    receiptHistory: [],
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  };
}

export interface RecallTrace {
  lot: WineLot;
  affectedLots: WineLot[];
  intakes: GrapeIntakeRecord[];
  harvests: HarvestRecord[];
  vessels: Vessel[];
  bottlingRuns: BottlingRunRecord[];
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
  orders: SalesOrderRecord[];
  dispatches: SalesDispatchRecord[];
  affectedBottleCount: number;
  affectedCustomers: string[];
}

export function buildRecallTrace(input: {
  lotId: string;
  lots: WineLot[];
  grapeIntakes: GrapeIntakeRecord[];
  harvests: HarvestRecord[];
  vessels: Vessel[];
  cellarOps: CellarOperation[];
  transfers: CellarTransferRecord[];
  bottlingRuns: BottlingRunRecord[];
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
  salesOrders: SalesOrderRecord[];
  salesDispatches: SalesDispatchRecord[];
}): RecallTrace | null {
  const lot = input.lots.find(item => item.id === input.lotId);
  if (!lot) return null;
  const graph = buildAllLineageGraph({
    lots: input.lots,
    grapeIntakes: input.grapeIntakes,
    cellarOps: input.cellarOps,
    transfers: input.transfers,
    bottlingRuns: input.bottlingRuns,
    storageLocations: input.storageLocations,
    stockMovements: input.stockMovements,
    salesOrders: input.salesOrders,
    salesDispatches: input.salesDispatches,
  });
  const startNodeId = `lot:${lot.id}`;
  const walk = (direction: 'upstream' | 'downstream'): Set<string> => {
    const seen = new Set<string>();
    const queue = [startNodeId];
    while (queue.length) {
      const nodeId = queue.shift()!;
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      for (const edge of graph.edges) {
        const next = direction === 'downstream'
          ? edge.from === nodeId ? edge.to : null
          : edge.to === nodeId ? edge.from : null;
        if (next && !seen.has(next)) queue.push(next);
      }
    }
    return seen;
  };
  const downstreamNodeIds = walk('downstream');
  const upstreamNodeIds = walk('upstream');
  const affectedLotIds = new Set(graph.nodes
    .filter(node => downstreamNodeIds.has(node.id) && node.type === 'wine_lot' && node.lotId)
    .map(node => node.lotId!));
  affectedLotIds.add(lot.id);
  const affectedLots = input.lots.filter(item => affectedLotIds.has(item.id));
  const intakes = input.grapeIntakes.filter(item => upstreamNodeIds.has(`intake:${item.id}`));
  const harvestIds = new Set(intakes.map(item => item.harvestRecordId).filter(Boolean));
  const harvests = input.harvests.filter(item => (item.associatedLotId && affectedLotIds.has(item.associatedLotId)) || harvestIds.has(item.id));
  const vessels = input.vessels.filter(item => item.assignedLotId && affectedLotIds.has(item.assignedLotId));
  const bottlingRuns = input.bottlingRuns.filter(item => affectedLotIds.has(item.lotId) && item.recordKind !== 'reversal');
  const stockMovements = input.stockMovements.filter(item => affectedLotIds.has(item.lotId));
  const storageIds = new Set(stockMovements.map(item => item.locationId));
  const storageLocations = input.storageLocations.filter(item => storageIds.has(item.id));
  const orders = input.salesOrders.filter(item => affectedLotIds.has(item.lotId));
  const dispatches = input.salesDispatches.filter(item => affectedLotIds.has(item.lotId) && item.recordKind !== 'reversal');
  const reversedDispatchIds = new Set(input.salesDispatches
    .filter(item => item.recordKind === 'reversal' && item.reversalOfDispatchId)
    .map(item => item.reversalOfDispatchId));
  const activeDispatches = dispatches.filter(item => !reversedDispatchIds.has(item.id) && !item.reversedByCommandId);
  return {
    lot,
    affectedLots,
    intakes,
    harvests,
    vessels,
    bottlingRuns,
    storageLocations,
    stockMovements,
    orders,
    dispatches: activeDispatches,
    affectedBottleCount: activeDispatches.reduce((sum, item) => sum + Math.max(0, item.bottles || 0), 0),
    affectedCustomers: [...new Set(activeDispatches.map(item => item.customerName).filter(Boolean))].sort(),
  };
}

export interface ProductionPlanConflict {
  itemId: string;
  severity: 'warning' | 'critical';
  code: 'date_order' | 'vessel_overlap' | 'vessel_capacity' | 'missing_dependency' | 'dependency_timing' | 'dependency_cycle';
  message: string;
}

function overlaps(a: ProductionPlanItem, b: ProductionPlanItem): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function detectProductionPlanConflicts(items: ProductionPlanItem[], vessels: Vessel[]): ProductionPlanConflict[] {
  const conflicts: ProductionPlanConflict[] = [];
  const active = items.filter(item => !['completed', 'cancelled'].includes(item.status));
  const byId = new Map(items.map(item => [item.id, item]));
  for (const item of active) {
    if (item.endDate < item.startDate) {
      conflicts.push({ itemId: item.id, severity: 'critical', code: 'date_order', message: 'End date is before start date.' });
    }
    for (const dependencyId of item.dependencyIds) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        conflicts.push({ itemId: item.id, severity: 'warning', code: 'missing_dependency', message: `Dependency ${dependencyId} no longer exists.` });
      } else if (item.startDate < dependency.endDate) {
        conflicts.push({ itemId: item.id, severity: 'warning', code: 'dependency_timing', message: `Starts before dependency “${dependency.title}” finishes on ${dependency.endDate}.` });
      }
    }
    if (item.quantityLiters && item.vesselIds.length) {
      const available = vessels
        .filter(vessel => item.vesselIds.includes(vessel.id))
        .reduce((sum, vessel) => sum + Math.max(0, vessel.capacity - vessel.currentVolume), 0);
      if (item.quantityLiters > available) {
        conflicts.push({
          itemId: item.id,
          severity: 'critical',
          code: 'vessel_capacity',
          message: `${item.quantityLiters.toLocaleString()} L is planned against ${available.toLocaleString()} L of current vessel headroom.`,
        });
      }
    }
  }
  for (const item of active) {
    const dependencyQueue = [...item.dependencyIds];
    const traversed = new Set<string>();
    while (dependencyQueue.length) {
      const dependencyId = dependencyQueue.shift()!;
      if (dependencyId === item.id) {
        conflicts.push({ itemId: item.id, severity: 'critical', code: 'dependency_cycle', message: 'Dependency chain contains a cycle.' });
        break;
      }
      if (traversed.has(dependencyId)) continue;
      traversed.add(dependencyId);
      const dependency = byId.get(dependencyId);
      if (dependency) dependencyQueue.push(...dependency.dependencyIds);
    }
  }
  for (let left = 0; left < active.length; left += 1) {
    for (let right = left + 1; right < active.length; right += 1) {
      const a = active[left];
      const b = active[right];
      const shared = a.vesselIds.filter(id => b.vesselIds.includes(id));
      if (shared.length && overlaps(a, b)) {
        conflicts.push({
          itemId: b.id,
          severity: 'warning',
          code: 'vessel_overlap',
          message: `${shared.join(', ')} is also reserved by “${a.title}” during this period.`,
        });
      }
    }
  }
  return conflicts;
}

const productionPlanStatusTransitions: Record<ProductionPlanStatus, ProductionPlanStatus[]> = {
  planned: ['planned', 'ready', 'blocked', 'cancelled'],
  ready: ['planned', 'ready', 'in_progress', 'blocked', 'cancelled'],
  blocked: ['planned', 'ready', 'blocked', 'cancelled'],
  in_progress: ['ready', 'in_progress', 'completed', 'blocked', 'cancelled'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

export function productionPlanTransitionIssue(
  item: ProductionPlanItem,
  targetStatus: ProductionPlanStatus,
  items: ProductionPlanItem[],
  conflicts: ProductionPlanConflict[] = [],
): string | null {
  if (!productionPlanStatusTransitions[item.status].includes(targetStatus)) {
    return `Plan item cannot move from ${item.status} to ${targetStatus}.`;
  }
  if (targetStatus === item.status || ['planned', 'blocked', 'cancelled'].includes(targetStatus)) return null;

  const byId = new Map(items.map(candidate => [candidate.id, candidate]));
  const missingDependencies = item.dependencyIds.filter(dependencyId => !byId.has(dependencyId));
  if (missingDependencies.length) {
    return `${missingDependencies.length} prerequisite${missingDependencies.length === 1 ? '' : 's'} no longer exist.`;
  }
  const incompleteDependencies = item.dependencyIds
    .map(dependencyId => byId.get(dependencyId))
    .filter((dependency): dependency is ProductionPlanItem => Boolean(dependency && dependency.status !== 'completed'));
  if (incompleteDependencies.length) {
    return `Complete prerequisite work first: ${incompleteDependencies.map(dependency => dependency.title).join(', ')}.`;
  }

  if (targetStatus === 'ready' || targetStatus === 'in_progress') {
    const criticalConflicts = conflicts.filter(conflict => conflict.itemId === item.id && conflict.severity === 'critical');
    if (criticalConflicts.length) return criticalConflicts[0].message;
  }
  return null;
}

export function allowedProductionPlanStatuses(
  item: ProductionPlanItem,
  items: ProductionPlanItem[],
  conflicts: ProductionPlanConflict[] = [],
): ProductionPlanStatus[] {
  return productionPlanStatusTransitions[item.status].filter(status => (
    productionPlanTransitionIssue(item, status, items, conflicts) === null
  ));
}

export interface TodayQueueItem {
  id: string;
  source: 'task' | 'sop' | 'purchase_order' | 'production_plan' | 'approval' | 'recall';
  title: string;
  detail: string;
  dueDate: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  targetTab: string;
  targetId?: string;
}

export interface TodayQueueVisibility {
  tasks: boolean;
  sops: boolean;
  purchaseOrders: boolean;
  productionPlans: boolean;
  approvals: 'all' | 'own' | 'none';
  recalls: boolean;
  /** Owners can supervise team work; operational roles receive their own queue. */
  includeTeamWork: boolean;
}

const DEFAULT_QUEUE_VISIBILITY: TodayQueueVisibility = {
  tasks: true,
  sops: true,
  purchaseOrders: true,
  productionPlans: true,
  approvals: 'all',
  recalls: true,
  includeTeamWork: true,
};

export function buildTodayQueue(input: {
  today: string;
  tasks: Task[];
  sops: QualitySop[];
  purchaseOrders: PurchaseOrder[];
  productionPlans: ProductionPlanItem[];
  approvals: WorkflowApprovalRecord[];
  recallCases?: RecallCase[];
  currentUsername?: string;
  currentUserName?: string;
  visibility?: Partial<TodayQueueVisibility>;
}): TodayQueueItem[] {
  const items: TodayQueueItem[] = [];
  const visibility = { ...DEFAULT_QUEUE_VISIBILITY, ...input.visibility };
  const identity = { username: input.currentUsername, fullName: input.currentUserName };
  for (const task of input.tasks.filter(item => item.status !== 'completed')) {
    if (!visibility.tasks) continue;
    if (!visibility.includeTeamWork && !taskIsAssignedToIdentity(task, identity)) continue;
    items.push({
      id: `task:${task.id}`,
      source: 'task',
      title: task.title,
      detail: task.description,
      dueDate: task.dueDate,
      priority: task.dueDate < input.today ? 'critical' : task.priority,
      targetTab: 'tasks',
      targetId: task.id,
    });
  }
  for (const sop of input.sops.filter(item => item.active && item.nextDueDate <= input.today)) {
    if (!visibility.sops) continue;
    if (!visibility.includeTeamWork && !workOwnerMatchesIdentity(sop.owner, identity)) continue;
    items.push({
      id: `sop:${sop.id}`,
      source: 'sop',
      title: sop.title,
      detail: `${sop.category} · ${sop.checklist.length} checks`,
      dueDate: sop.nextDueDate,
      priority: sop.nextDueDate < input.today ? 'critical' : 'high',
      targetTab: 'quality',
      targetId: sop.id,
    });
  }
  for (const order of input.purchaseOrders.filter(item => ['submitted', 'ordered', 'partially_received'].includes(item.status))) {
    if (!visibility.purchaseOrders) continue;
    if (!order.expectedDate || order.expectedDate > input.today) continue;
    items.push({
      id: `po:${order.id}`,
      source: 'purchase_order',
      title: `${order.orderNumber} · ${order.supplierName}`,
      detail: `${order.lines.length} line${order.lines.length === 1 ? '' : 's'} · ${order.status}`,
      dueDate: order.expectedDate,
      priority: order.expectedDate < input.today ? 'critical' : 'medium',
      targetTab: 'procurement',
      targetId: order.id,
    });
  }
  for (const plan of input.productionPlans.filter(item => !['completed', 'cancelled'].includes(item.status) && item.startDate <= input.today)) {
    if (!visibility.productionPlans) continue;
    if (!visibility.includeTeamWork && !workOwnerMatchesIdentity(plan.assignedTo, identity)) continue;
    items.push({
      id: `plan:${plan.id}`,
      source: 'production_plan',
      title: plan.title,
      detail: `${plan.kind} · ${plan.status}`,
      dueDate: plan.startDate,
      priority: plan.status === 'blocked' ? 'critical' : plan.startDate < input.today ? 'high' : 'medium',
      targetTab: 'planner',
      targetId: plan.id,
    });
  }
  for (const approval of input.approvals.filter(item => item.status === 'pending')) {
    if (visibility.approvals === 'none') continue;
    if (visibility.approvals === 'own' && !workOwnerMatchesIdentity(approval.requestedBy, identity)) continue;
    items.push({
      id: `approval:${approval.id}`,
      source: 'approval',
      title: approval.requestSummary,
      detail: `${approval.commandType} · ${approval.requestedBy}`,
      dueDate: approval.requestedAt.slice(0, 10),
      priority: approval.requestedAt.slice(0, 10) < input.today ? 'high' : 'medium',
      targetTab: 'control',
    });
  }
  for (const recall of (input.recallCases || []).filter(item => ['active', 'contained'].includes(item.status))) {
    if (!visibility.recalls) continue;
    items.push({
      id: `recall:${recall.id}`,
      source: 'recall',
      title: recall.title,
      detail: `${recall.status} · ${recall.containmentTaskIds.length} containment task${recall.containmentTaskIds.length === 1 ? '' : 's'}`,
      dueDate: recall.openedAt.slice(0, 10),
      priority: recall.status === 'active' ? 'critical' : 'high',
      targetTab: 'recall',
      targetId: recall.id,
    });
  }
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return items.sort((a, b) => (
    Number(b.source === 'recall' && b.priority === 'critical') - Number(a.source === 'recall' && a.priority === 'critical')
    || rank[a.priority] - rank[b.priority]
    || a.dueDate.localeCompare(b.dueDate)
  ));
}
