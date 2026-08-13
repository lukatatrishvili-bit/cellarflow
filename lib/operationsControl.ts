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
  closedAt?: string;
  closedBy?: string;
  lastModified?: string;
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
  code: 'date_order' | 'vessel_overlap' | 'vessel_capacity' | 'missing_dependency';
  message: string;
}

function overlaps(a: ProductionPlanItem, b: ProductionPlanItem): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function detectProductionPlanConflicts(items: ProductionPlanItem[], vessels: Vessel[]): ProductionPlanConflict[] {
  const conflicts: ProductionPlanConflict[] = [];
  const active = items.filter(item => !['completed', 'cancelled'].includes(item.status));
  const ids = new Set(items.map(item => item.id));
  for (const item of active) {
    if (item.endDate < item.startDate) {
      conflicts.push({ itemId: item.id, severity: 'critical', code: 'date_order', message: 'End date is before start date.' });
    }
    for (const dependencyId of item.dependencyIds) {
      if (!ids.has(dependencyId)) {
        conflicts.push({ itemId: item.id, severity: 'warning', code: 'missing_dependency', message: `Dependency ${dependencyId} no longer exists.` });
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

export interface TodayQueueItem {
  id: string;
  source: 'task' | 'sop' | 'purchase_order' | 'production_plan' | 'approval';
  title: string;
  detail: string;
  dueDate: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  targetTab: string;
}

export function buildTodayQueue(input: {
  today: string;
  tasks: Task[];
  sops: QualitySop[];
  purchaseOrders: PurchaseOrder[];
  productionPlans: ProductionPlanItem[];
  approvals: WorkflowApprovalRecord[];
  currentUsername?: string;
}): TodayQueueItem[] {
  const items: TodayQueueItem[] = [];
  for (const task of input.tasks.filter(item => item.status !== 'completed')) {
    if (input.currentUsername && task.assignedUserId && task.assignedUserId !== input.currentUsername) continue;
    items.push({
      id: `task:${task.id}`,
      source: 'task',
      title: task.title,
      detail: task.description,
      dueDate: task.dueDate,
      priority: task.dueDate < input.today ? 'critical' : task.priority,
      targetTab: 'tasks',
    });
  }
  for (const sop of input.sops.filter(item => item.active && item.nextDueDate <= input.today)) {
    items.push({
      id: `sop:${sop.id}`,
      source: 'sop',
      title: sop.title,
      detail: `${sop.category} · ${sop.checklist.length} checks`,
      dueDate: sop.nextDueDate,
      priority: sop.nextDueDate < input.today ? 'critical' : 'high',
      targetTab: 'quality',
    });
  }
  for (const order of input.purchaseOrders.filter(item => ['submitted', 'ordered', 'partially_received'].includes(item.status))) {
    if (!order.expectedDate || order.expectedDate > input.today) continue;
    items.push({
      id: `po:${order.id}`,
      source: 'purchase_order',
      title: `${order.orderNumber} · ${order.supplierName}`,
      detail: `${order.lines.length} line${order.lines.length === 1 ? '' : 's'} · ${order.status}`,
      dueDate: order.expectedDate,
      priority: order.expectedDate < input.today ? 'critical' : 'medium',
      targetTab: 'procurement',
    });
  }
  for (const plan of input.productionPlans.filter(item => !['completed', 'cancelled'].includes(item.status) && item.startDate <= input.today)) {
    items.push({
      id: `plan:${plan.id}`,
      source: 'production_plan',
      title: plan.title,
      detail: `${plan.kind} · ${plan.status}`,
      dueDate: plan.startDate,
      priority: plan.status === 'blocked' ? 'critical' : plan.startDate < input.today ? 'high' : 'medium',
      targetTab: 'planner',
    });
  }
  for (const approval of input.approvals.filter(item => item.status === 'pending')) {
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
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return items.sort((a, b) => rank[a.priority] - rank[b.priority] || a.dueDate.localeCompare(b.dueDate));
}
