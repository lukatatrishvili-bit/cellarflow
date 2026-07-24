import { can, canAccess } from '../server/permissions';

export interface CellarWorkflowPermissions {
  intake: {
    canReceiveGrapes: boolean;
    canLinkHarvest: boolean;
    canFillDestinationVessel: boolean;
    canPostIntakeCost: boolean;
    /** Append-only compensation across harvest, lot, vessel, cost, and audit ledgers. */
    canReverseHarvestIntake: boolean;
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
    /** Append-only compensation across lot, vessel, inventory, cost, and audit ledgers. */
    canReverseCellarOperation: boolean;
  };
  transfers: {
    canExecuteTransfer: boolean;
    canSanitizeVessels: boolean;
    canConsumeTransferMaterials: boolean;
    canReverseTransfer: boolean;
  };
  fermentation: {
    canCreateFermentationLog: boolean;
    canUpdateFermentationLot: boolean;
    canUpdateFermentationVessel: boolean;
    canCompleteFermentation: boolean;
    /** Enables inventory-backed yeast, starter, nutrient, and additive usage. */
    canConsumeFermentationMaterials: boolean;
    /** Append-only compensation across reading, lot, vessel, and audit ledgers. */
    canReverseFermentationCompletion: boolean;
    canDeleteFermentationLog: boolean;
  };
  bottling: {
    canCreateBottling: boolean;
    /** Append-only compensation across lot, inventory, cost, and storage ledgers. */
    canReverseBottling: boolean;
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
  /** Append-only compensation; requires sales update/create and storage create. */
  canReverseDispatch: boolean;
  canCreateStockMovement: boolean;
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
  const canUpdateInventory = canAccess(role, 'inventory', 'update');
  const canCreateStorage = canAccess(role, 'storage', 'create');
  const canWriteAudit = can(role, 'write');

  return {
    intake: {
      canReceiveGrapes: canAccess(role, 'grape_intake', 'create')
        && canCreateLot
        && canWriteAudit,
      canLinkHarvest: canAccess(role, 'vineyard', 'update'),
      canFillDestinationVessel: canUpdateVessel,
      canPostIntakeCost: canCreateCost,
      canReverseHarvestIntake: canAccess(role, 'grape_intake', 'delete')
        && canUpdateLot
        && canAccess(role, 'vineyard', 'update')
        && canUpdateVessel
        && canCreateCost
        && canWriteAudit,
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
      // Material costing is a system-generated consequence of the cellar
      // operation. Operators need inventory authority, not direct access to
      // the financial ledger.
      canConsumeOperationMaterials: canUpdateInventory,
      canReverseCellarOperation: canAccess(role, 'operations', 'delete')
        && canUpdateLot
        && canUpdateVessel
        && canUpdateInventory
        && canCreateCost
        && canWriteAudit,
    },
    transfers: {
      canExecuteTransfer: canAccess(role, 'transfers', 'create')
        && canUpdateVessel
        && canCreateLot
        && canUpdateLot,
      canSanitizeVessels: canUpdateVessel,
      canConsumeTransferMaterials: canAccess(role, 'transfers', 'create')
        && canAccess(role, 'operations', 'create')
        && canUpdateLot
        && canUpdateInventory
        && canWriteAudit,
      canReverseTransfer: canAccess(role, 'transfers', 'delete')
        && canUpdateVessel
        && canUpdateLot,
    },
    fermentation: {
      canCreateFermentationLog: canAccess(role, 'fermentation', 'create'),
      canUpdateFermentationLot: canUpdateLot,
      canUpdateFermentationVessel: canUpdateVessel,
      canCompleteFermentation: canAccess(role, 'fermentation', 'update')
        && canUpdateLot
        && canUpdateVessel
        && canWriteAudit,
      canConsumeFermentationMaterials: canAccess(role, 'fermentation', 'create')
        && canAccess(role, 'operations', 'create')
        && canUpdateLot
        && canUpdateInventory
        && canWriteAudit,
      canReverseFermentationCompletion: canAccess(role, 'fermentation', 'delete')
        && canUpdateLot
        && canUpdateVessel
        && canWriteAudit,
      canDeleteFermentationLog: canAccess(role, 'fermentation', 'delete'),
    },
    bottling: {
      canCreateBottling: canAccess(role, 'bottling', 'create') && canUpdateLot,
      canReverseBottling: canAccess(role, 'bottling', 'delete')
        && canUpdateLot
        && canUpdateInventory
        && canCreateCost
        && canCreateStorage,
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
      && canAccess(role, 'grape_intake', 'create')
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
  const canCreateDispatch = canAccess(role, 'sales', 'create');
  const canUpdateOrder = canAccess(role, 'sales', 'update');
  const canCreateStockMovement = canAccess(role, 'storage', 'create');
  return {
    canCreateOrder: canAccess(role, 'sales', 'create'),
    canUpdateOrder,
    canCreateDispatch,
    canReverseDispatch: canAccess(role, 'sales', 'delete')
      && canUpdateOrder
      && canCreateDispatch
      && canCreateStockMovement,
    canCreateStockMovement,
    canViewCosts: canAccess(role, 'costs', 'view'),
    canViewStorage: canAccess(role, 'storage', 'view'),
    canViewBottling: canAccess(role, 'bottling', 'view'),
  };
}
