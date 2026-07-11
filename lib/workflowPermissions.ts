import { canAccess } from '../server/permissions';

export interface CellarWorkflowPermissions {
  vessels: {
    canCreateVessel: boolean;
    canUpdateVessel: boolean;
    canDeleteVessel: boolean;
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

  return {
    vessels: {
      canCreateVessel,
      canUpdateVessel,
      canDeleteVessel,
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
