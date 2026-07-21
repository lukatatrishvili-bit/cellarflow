import type {
  BottlingRunRecord,
  SalesDispatchRecord,
  SalesOrderRecord,
  WineLot,
} from '../wineryState';
import { reservedBottlesFor } from '../sales';
import { isActiveBottlingRun } from '../bottlingIntegrity';
import type { StockMovement } from './types';

export interface StorageLocationReferences {
  movementIds: string[];
  bottlingRunIds: string[];
  salesOrderIds: string[];
  salesDispatchIds: string[];
  total: number;
}

export interface StorageMovementDeletionBlockers {
  commandIds: string[];
  bottlingRunIds: string[];
  salesDispatchIds: string[];
  relatedMovementIds: string[];
  remainingOnHandBottles: number;
  reservedBottles: number;
  wouldCreateNegativeStock: boolean;
  wouldUndercutReservations: boolean;
  blocked: boolean;
}

interface StorageReferenceInput {
  movements: StockMovement[];
  bottlingRuns: BottlingRunRecord[];
  orders?: SalesOrderRecord[];
  dispatches?: SalesDispatchRecord[];
}

/** Storage records finished goods only: a bottled lot or a partially bottled lot with provenance. */
export function isFinishedGoodsLot(
  lot: Pick<WineLot, 'id' | 'stage'>,
  bottlingRuns: Array<Pick<BottlingRunRecord,
    'lotId' | 'totalBottles' | 'totalCeramic' | 'recordKind' | 'reversedByCommandId' | 'reversedAt'>>,
): boolean {
  return lot.stage === 'bottled' || bottlingRuns.some(run => (
    isActiveBottlingRun(run)
    && run.lotId === lot.id && ((run.totalBottles || 0) + (run.totalCeramic || 0)) > 0
  ));
}

export function storageLocationReferences(
  locationId: string,
  input: StorageReferenceInput,
): StorageLocationReferences {
  const movementIds = input.movements
    .filter(movement => movement.locationId === locationId)
    .map(movement => movement.id);
  const bottlingRunIds = input.bottlingRuns
    .filter(run => run.storageLocationId === locationId
      || run.storagePlacements?.some(placement => placement.locationId === locationId))
    .map(run => run.id);
  const salesOrderIds = (input.orders || [])
    .filter(order => order.locationId === locationId)
    .map(order => order.id);
  const salesDispatchIds = (input.dispatches || [])
    .filter(dispatch => dispatch.locationId === locationId)
    .map(dispatch => dispatch.id);

  return {
    movementIds,
    bottlingRunIds,
    salesOrderIds,
    salesDispatchIds,
    total: movementIds.length + bottlingRunIds.length + salesOrderIds.length + salesDispatchIds.length,
  };
}

export function storageMovementDeletionBlockers(
  movementId: string,
  input: StorageReferenceInput & { asOfDate?: string },
): StorageMovementDeletionBlockers | null {
  const movement = input.movements.find(item => item.id === movementId);
  if (!movement) return null;

  const commandIds = movement.commandId ? [movement.commandId] : [];
  const bottlingRunIds = input.bottlingRuns
    .filter(run => run.storageMovementId === movementId
      || run.storagePlacements?.some(placement => placement.movementId === movementId)
      || movement.sourceRef === run.id)
    .map(run => run.id);
  const salesDispatchIds = (input.dispatches || [])
    .filter(dispatch => dispatch.stockMovementId === movementId || movement.sourceRef === dispatch.id)
    .map(dispatch => dispatch.id);

  const remainingOnHandBottles = input.movements.reduce((total, item) => {
    if (item.id === movementId || item.locationId !== movement.locationId || item.lotId !== movement.lotId) {
      return total;
    }
    return total + (item.direction === 'in' ? item.bottles : -item.bottles);
  }, 0);
  const reservedBottles = reservedBottlesFor(
    input.orders || [],
    movement.locationId,
    movement.lotId,
    input.asOfDate,
  );
  const wouldCreateNegativeStock = remainingOnHandBottles < 0;
  const wouldUndercutReservations = remainingOnHandBottles >= 0 && remainingOnHandBottles < reservedBottles;
  const relatedMovementIds = movement.relatedMovementId
    && input.movements.some(item => item.id === movement.relatedMovementId)
    ? [movement.relatedMovementId]
    : [];

  return {
    commandIds,
    bottlingRunIds,
    salesDispatchIds,
    relatedMovementIds,
    remainingOnHandBottles,
    reservedBottles,
    wouldCreateNegativeStock,
    wouldUndercutReservations,
    blocked:
      commandIds.length > 0
      || bottlingRunIds.length > 0
      || salesDispatchIds.length > 0
      || relatedMovementIds.length > 0
      || wouldCreateNegativeStock
      || wouldUndercutReservations,
  };
}
