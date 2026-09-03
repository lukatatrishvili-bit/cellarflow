import type { ProductionPlanItem, ProductionPlanKind } from './operationsControl';
import { detectProductionPlanConflicts } from './operationsControl';
import type { CellarOperationType, Vessel, WineLot } from './wineryState';
import { CELLAR_OPERATIONS } from './wineryOperations';

export interface WineryPlanOperationDraft {
  operationType: CellarOperationType;
  vesselId: string;
  destinationVesselId?: string;
  lotId?: string;
  title?: string;
  startDate: string;
  endDate: string;
  assignedTo: string;
  quantityLiters?: number;
  notes?: string;
  dependencyIds?: string[];
}

export type WineryPlanDraftIssueCode =
  | 'missing_source'
  | 'missing_lot'
  | 'invalid_dates'
  | 'missing_assignee'
  | 'missing_destination'
  | 'same_destination'
  | 'dirty_destination'
  | 'no_destination_headroom'
  | 'invalid_quantity'
  | 'vessel_conflict';

export interface WineryPlanDraftIssue {
  code: WineryPlanDraftIssueCode;
  detail?: string;
}

export function productionPlanKindForCellarOperation(type: CellarOperationType): ProductionPlanKind {
  if (type === 'racking' || type === 'blending' || type === 'vessel_filling') return 'transfer';
  if (type === 'ferment_start' || type === 'pumpover' || type === 'punchdown') return 'fermentation';
  if (type === 'measurement') return 'lab';
  if (type === 'bottling') return 'bottling';
  if (type === 'cleaning') return 'sanitation';
  return 'other';
}

export function cellarOperationNeedsDestination(type: CellarOperationType): boolean {
  return Boolean(CELLAR_OPERATIONS.find(operation => operation.key === type)?.needsVesselTo);
}

export function defaultWineryPlanOperation(vessel: Vessel): CellarOperationType {
  if (vessel.currentVolume <= 0 && vessel.cleaningStatus !== 'clean') return 'cleaning';
  if (vessel.assignedLotId) return 'measurement';
  return 'custom';
}

export function suggestedWineryPlanQuantity(source: Vessel, destination?: Vessel): number | undefined {
  if (!destination) return undefined;
  const headroom = Math.max(0, destination.capacity - destination.currentVolume);
  const safeVolume = Math.min(Math.max(0, source.currentVolume), headroom);
  return safeVolume > 0 ? Math.round(safeVolume * 100) / 100 : undefined;
}

export function buildWineryPlanProductionItem(
  draft: WineryPlanOperationDraft,
  currentUsername: string,
  now = new Date().toISOString(),
): ProductionPlanItem {
  const operation = CELLAR_OPERATIONS.find(candidate => candidate.key === draft.operationType);
  const vesselIds = [draft.vesselId, draft.destinationVesselId].filter((id): id is string => Boolean(id));
  const generatedTitle = [operation?.en || draft.operationType, draft.lotId || draft.vesselId]
    .filter(Boolean)
    .join(' · ');
  const idStamp = now.replace(/[^0-9]/g, '').slice(0, 17);

  return {
    id: `plan-map-${draft.operationType}-${draft.vesselId}-${idStamp}`,
    title: draft.title?.trim() || generatedTitle,
    kind: productionPlanKindForCellarOperation(draft.operationType),
    operationType: draft.operationType,
    status: 'planned',
    startDate: draft.startDate,
    endDate: draft.endDate,
    assignedTo: draft.assignedTo.trim() || currentUsername,
    ...(draft.lotId ? { lotId: draft.lotId } : {}),
    vesselIds,
    ...(draft.quantityLiters && draft.quantityLiters > 0 ? { quantityLiters: draft.quantityLiters } : {}),
    notes: draft.notes?.trim() || '',
    dependencyIds: [...new Set(draft.dependencyIds || [])],
    createdAt: now,
    createdBy: currentUsername,
  };
}

export function wineryPlanDraftIssue(
  draft: WineryPlanOperationDraft,
  vessels: Vessel[],
  lots: WineLot[],
  productionPlans: ProductionPlanItem[],
): WineryPlanDraftIssue | null {
  const source = vessels.find(vessel => vessel.id === draft.vesselId);
  if (!source) return { code: 'missing_source' };
  if (!draft.startDate || !draft.endDate || draft.endDate < draft.startDate) return { code: 'invalid_dates' };
  if (!draft.assignedTo.trim()) return { code: 'missing_assignee' };

  const lotRequired = draft.operationType !== 'cleaning';
  if (lotRequired && (!draft.lotId || !lots.some(lot => lot.id === draft.lotId))) {
    return { code: 'missing_lot' };
  }

  if (cellarOperationNeedsDestination(draft.operationType)) {
    if (!draft.destinationVesselId) return { code: 'missing_destination' };
    if (draft.destinationVesselId === draft.vesselId) return { code: 'same_destination' };
    const destination = vessels.find(vessel => vessel.id === draft.destinationVesselId);
    if (!destination) return { code: 'missing_destination' };
    if (destination.cleaningStatus !== 'clean') return { code: 'dirty_destination' };
    const headroom = Math.max(0, destination.capacity - destination.currentVolume);
    if (headroom <= 0) return { code: 'no_destination_headroom' };
    if (!(draft.quantityLiters && draft.quantityLiters > 0)
      || draft.quantityLiters > source.currentVolume
      || draft.quantityLiters > headroom) {
      return { code: 'invalid_quantity' };
    }
  }

  const candidate = buildWineryPlanProductionItem(draft, draft.assignedTo, '2099-01-01T00:00:00.000Z');
  const conflict = detectProductionPlanConflicts([...productionPlans, candidate], vessels)
    .find(item => item.itemId === candidate.id && item.code === 'vessel_overlap');
  return conflict ? { code: 'vessel_conflict', detail: conflict.message } : null;
}
