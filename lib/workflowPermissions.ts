import { can, canAccess } from '../server/permissions';

export interface CellarWorkflowPermissions {
  intake: {
    canReceiveGrapes: boolean;
    canLinkHarvest: boolean;
    canFillDestinationVessel: boolean;
    canPostIntakeCost: boolean;
  };
  vessels: {
    canCreateVessel: boolean;
    canUpdateVessel: boolean;
    canDeleteVessel: boolean;
  };
  operations: {
    canLogCellarOperation: boolean;
    canUseOperationVessels: boolean;
    canConsumeOperationMaterials: boolean;
  };
  transfers: {
    canExecuteTransfer: boolean;
    canSanitizeVessels: boolean;
    canRollbackTransfer: boolean;
  };
  fermentation: {
    canCreateFermentationLog: boolean;
    canUpdateFermentationLot: boolean;
    canUpdateFermentationVessel: boolean;
    canDeleteFermentationLog: boolean;
  };
  bottling: {
    canCreateBottling: boolean;
    canDeleteBottling: boolean;
    canUseBottlingCosting: boolean;
    canPlaceFinishedGoods: boolean;
  };
}

export interface VineyardWorkflowPermissions {
  canCreateVineyardRecord: boolean;
  canUpdateVineyardRecord: boolean;
  canDeleteVineyardRecord: boolean;
  canCreateVineyardProject: boolean;
  canUpdateVineyardProject: boolean;
  canDispatchHarvestToGvino: boolean;
  canCreateTask: boolean;
}

export interface SalesWorkflowPermissions {
  canCreateOrder: boolean;
  canUpdateOrder: boolean;
  canCreateDispatch: boolean;
  canDeleteDispatch: boolean;
  canCreateStockMovement: boolean;
  canDeleteStockMovement: boolean;
  canViewCosts: boolean;
  canViewStorage: boolean;
  canViewBottling: boolean;
}

/**
 * Resolve action permissions for compound cellar workflows. These contracts
 * mirror every collection an existing UI action writes, so a user never starts
 * a workflow that the sync API must reject partway through.
 */
export function cellarWorkflowPermissions(role: unknown): CellarWorkflowPermissions {
  const canCreateVessel = canAccess(role, 'vessels', 'create');
  const canUpdateVessel = canAccess(role, 'vessels', 'update');
  const canDeleteVessel = canAccess(role, 'vessels', 'delete');
  const canCreateLot = canAccess(role, 'lots', 'create');
  const canUpdateLot = canAccess(role, 'lots', 'update');
  const canCreateCost = canAccess(role, 'costs', 'create');
  const canDeleteCost = canAccess(role, 'costs', 'delete');
  const canUpdateInventory = canAccess(role, 'inventory', 'update');
  const canCreateStorage = canAccess(role, 'storage', 'create');
  const canDeleteStorage = canAccess(role, 'storage', 'delete');
  const canWriteAudit = can(role, 'write');

  return {
    intake: {
      canReceiveGrapes: canAccess(role, 'grape_intake', 'create')
        && canCreateLot
        && canWriteAudit,
      canLinkHarvest: canAccess(role, 'vineyard', 'update'),
      canFillDestinationVessel: canUpdateVessel,
      canPostIntakeCost: canCreateCost,
    },
    vessels: {
      canCreateVessel,
      canUpdateVessel,
      canDeleteVessel,
    },
    operations: {
      canLogCellarOperation: canAccess(role, 'operations', 'create')
        && canUpdateLot
        && canWriteAudit,
      canUseOperationVessels: canUpdateVessel,
      canConsumeOperationMaterials: canUpdateInventory && canCreateCost,
    },
    transfers: {
      canExecuteTransfer: canAccess(role, 'transfers', 'create')
        && canUpdateVessel
        && canCreateLot
        && canUpdateLot,
      canSanitizeVessels: canUpdateVessel,
      canRollbackTransfer: canAccess(role, 'transfers', 'delete') && canUpdateVessel,
    },
    fermentation: {
      canCreateFermentationLog: canAccess(role, 'fermentation', 'create'),
      canUpdateFermentationLot: canUpdateLot,
      canUpdateFermentationVessel: canUpdateVessel,
      canDeleteFermentationLog: canAccess(role, 'fermentation', 'delete'),
    },
    bottling: {
      canCreateBottling: canAccess(role, 'bottling', 'create') && canUpdateLot,
      canDeleteBottling: canAccess(role, 'bottling', 'delete')
        && canUpdateLot
        && canUpdateInventory
        && canDeleteCost
        && canDeleteStorage,
      canUseBottlingCosting: canUpdateInventory && canCreateCost,
      canPlaceFinishedGoods: canCreateStorage,
    },
  };
}

/**
 * Resolve Vazi permissions, including the cross-module harvest handoff. The
 * handoff creates a wine lot and audit record before it updates the originating
 * harvest, so it is only safe when every write is authorized. Fermentation
 * readings are deliberately recorded later from actual cellar measurements.
 */
export function vineyardWorkflowPermissions(role: unknown): VineyardWorkflowPermissions {
  const canUpdateVineyardRecord = canAccess(role, 'vineyard', 'update');

  return {
    canCreateVineyardRecord: canAccess(role, 'vineyard', 'create'),
    canUpdateVineyardRecord,
    canDeleteVineyardRecord: canAccess(role, 'vineyard', 'delete'),
    canCreateVineyardProject: canAccess(role, 'vineyard_projects', 'create'),
    canUpdateVineyardProject: canAccess(role, 'vineyard_projects', 'update'),
    canDispatchHarvestToGvino: canUpdateVineyardRecord
      && canAccess(role, 'lots', 'create')
      && can(role, 'write'),
    canCreateTask: canAccess(role, 'vineyard', 'view') && canAccess(role, 'tasks', 'create'),
  };
}

/**
 * Resolve the individual collection permissions used by sales workflows. The
 * Sales screen combines these flags at the action boundary: recording or
 * fulfilling a dispatch requires both a sales record and a storage movement;
 * deleting one may additionally restore its linked order.
 */
export function salesWorkflowPermissions(role: unknown): SalesWorkflowPermissions {
  return {
    canCreateOrder: canAccess(role, 'sales', 'create'),
    canUpdateOrder: canAccess(role, 'sales', 'update'),
    canCreateDispatch: canAccess(role, 'sales', 'create'),
    canDeleteDispatch: canAccess(role, 'sales', 'delete'),
    canCreateStockMovement: canAccess(role, 'storage', 'create'),
    canDeleteStockMovement: canAccess(role, 'storage', 'delete'),
    canViewCosts: canAccess(role, 'costs', 'view'),
    canViewStorage: canAccess(role, 'storage', 'view'),
    canViewBottling: canAccess(role, 'bottling', 'view'),
  };
}
