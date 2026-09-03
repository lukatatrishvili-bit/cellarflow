import { describe, expect, it } from 'vitest';
import {
  cellarWorkflowPermissions,
  salesWorkflowPermissions,
  vineyardWorkflowPermissions,
} from '../lib/workflowPermissions';
import type { Role } from '../server/permissions';
import { authorizeSyncPayload } from '../server/routes/sync';

const supportedRoles: Role[] = [
  'Owner/Admin',
  'Viticulturist',
  'Winemaker',
  'Lab Technician',
  'Cellar Worker',
  'Read-Only',
];

describe('compound cellar workflow permissions', () => {
  it('allows owners to complete every workflow action', () => {
    const permissions = cellarWorkflowPermissions('Owner/Admin');

    expect(Object.values(permissions).flatMap(Object.values).every(Boolean)).toBe(true);
  });

  it('lets winemakers consume production materials without opening owner-only ledgers', () => {
    const permissions = cellarWorkflowPermissions('Winemaker');

    expect(permissions.intake).toEqual({
      canReceiveGrapes: true,
      canLinkHarvest: false,
      canFillDestinationVessel: true,
      canPostIntakeCost: false,
      canReverseHarvestIntake: false,
    });
    expect(permissions.vessels).toEqual({
      canCreateVessel: true,
      canUpdateVessel: true,
      canDeleteVessel: false,
    });
    expect(permissions.operations).toEqual({
      canLogCellarOperation: true,
      canUseOperationVessels: true,
      canConsumeOperationMaterials: true,
      canReverseCellarOperation: false,
    });
    expect(permissions.transfers).toEqual({
      canExecuteTransfer: true,
      canSanitizeVessels: true,
      canConsumeTransferMaterials: true,
      canReverseTransfer: true,
    });
    expect(permissions.fermentation).toEqual({
      canCreateFermentationLog: true,
      canUpdateFermentationLot: true,
      canUpdateFermentationVessel: true,
      canCompleteFermentation: true,
      canConsumeFermentationMaterials: true,
      canReverseFermentationCompletion: false,
      canDeleteFermentationLog: false,
    });
    expect(permissions.bottling).toEqual({
      canCreateBottling: true,
      canReverseBottling: false,
      canUseBottlingCosting: false,
      canPlaceFinishedGoods: false,
    });
  });

  it('keeps cellar-worker telemetry and sanitation without unsafe lot mutations', () => {
    const permissions = cellarWorkflowPermissions('Cellar Worker');

    expect(permissions.intake).toEqual({
      canReceiveGrapes: false,
      canLinkHarvest: false,
      canFillDestinationVessel: true,
      canPostIntakeCost: false,
      canReverseHarvestIntake: false,
    });
    expect(permissions.vessels).toEqual({
      canCreateVessel: false,
      canUpdateVessel: true,
      canDeleteVessel: false,
    });
    expect(permissions.operations).toEqual({
      canLogCellarOperation: false,
      canUseOperationVessels: true,
      canConsumeOperationMaterials: false,
      canReverseCellarOperation: false,
    });
    expect(permissions.transfers).toEqual({
      canExecuteTransfer: false,
      canSanitizeVessels: true,
      canConsumeTransferMaterials: false,
      canReverseTransfer: false,
    });
    expect(permissions.fermentation).toEqual({
      canCreateFermentationLog: true,
      canUpdateFermentationLot: false,
      canUpdateFermentationVessel: true,
      canCompleteFermentation: false,
      canConsumeFermentationMaterials: false,
      canReverseFermentationCompletion: false,
      canDeleteFermentationLog: false,
    });
    expect(Object.values(permissions.bottling).every(value => value === false)).toBe(true);
  });

  it('does not expose the compound intake transaction to a vineyard-only writer', () => {
    const permissions = cellarWorkflowPermissions('Viticulturist');

    expect(permissions.intake).toEqual({
      canReceiveGrapes: false,
      canLinkHarvest: true,
      canFillDestinationVessel: false,
      canPostIntakeCost: false,
      canReverseHarvestIntake: false,
    });
  });

  it('denies every mutation for read-only and unknown roles', () => {
    for (const role of ['Read-Only', 'Unknown Role']) {
      const permissions = cellarWorkflowPermissions(role);
      expect(Object.values(permissions).flatMap(Object.values).every(value => value === false)).toBe(true);
    }
  });
});

describe('compound vineyard workflow permissions', () => {
  it('allows owners to manage vineyard records and complete the cellar handoff', () => {
    expect(Object.values(vineyardWorkflowPermissions('Owner/Admin')).every(Boolean)).toBe(true);
  });

  it('keeps viticulturist field management but blocks the unauthorized cellar handoff', () => {
    expect(vineyardWorkflowPermissions('Viticulturist')).toEqual({
      canCreateVineyardRecord: true,
      canUpdateVineyardRecord: true,
      canDeleteVineyardRecord: true,
      canCreateVineyardProject: true,
      canUpdateVineyardProject: true,
      canDispatchHarvestToGvino: false,
      canCreateTask: true,
    });
  });

  it('denies vineyard mutations for read-only and unrelated roles', () => {
    for (const role of ['Read-Only', 'Winemaker', 'Unknown Role']) {
      expect(Object.values(vineyardWorkflowPermissions(role)).every(value => value === false)).toBe(true);
    }
  });
});

describe('compound sales workflow permissions', () => {
  it('allows owners to use every sales and supporting-ledger action', () => {
    expect(Object.values(salesWorkflowPermissions('Owner/Admin')).every(Boolean)).toBe(true);
  });

  it('keeps read-only reporting context without exposing mutations', () => {
    expect(salesWorkflowPermissions('Read-Only')).toEqual({
      canCreateOrder: false,
      canUpdateOrder: false,
      canCreateDispatch: false,
      canReverseDispatch: false,
      canCreateStockMovement: false,
      canViewCosts: true,
      canViewStorage: true,
      canViewBottling: true,
    });
  });

  it('denies sales mutations to unrelated or unknown roles', () => {
    for (const role of ['Winemaker', 'Viticulturist', 'Unknown Role']) {
      const permissions = salesWorkflowPermissions(role);
      expect([
        permissions.canCreateOrder,
        permissions.canUpdateOrder,
        permissions.canCreateDispatch,
        permissions.canReverseDispatch,
        permissions.canCreateStockMovement,
      ].every(value => value === false)).toBe(true);
    }
  });
});

describe('workflow permission contracts match sync authorization', () => {
  it.each(supportedRoles)('matches the complete Vazi harvest handoff for %s', (role) => {
    const userDb = {
      harvests: [{ id: 'harvest-1', sentToGvino: false }],
      lots: [],
      auditLogs: [],
    };
    const handoff = {
      harvests: [{ id: 'harvest-1', sentToGvino: true, associatedLotId: 'lot-1' }],
      lots: [{ id: 'lot-1', name: 'Saperavi harvest lot' }],
      auditLogs: [{ id: 'audit-1', actionType: 'Traceability Dispatch' }],
    };

    const serverAllowsHandoff = authorizeSyncPayload(
      role,
      userDb,
      handoff,
      undefined,
    ) === null;

    expect(vineyardWorkflowPermissions(role).canDispatchHarvestToGvino)
      .toBe(serverAllowsHandoff);
  });

  it.each(supportedRoles)('matches a sales dispatch transaction for %s', (role) => {
    const userDb = {
      salesDispatches: [],
      stockMovements: [],
    };
    const dispatch = {
      salesDispatches: [{ id: 'dispatch-1', stockMovementId: 'movement-1' }],
      stockMovements: [{ id: 'movement-1', sourceRef: 'dispatch-1' }],
    };
    const permissions = salesWorkflowPermissions(role);
    const uiAllowsDispatch = permissions.canCreateDispatch
      && permissions.canCreateStockMovement;
    const serverAllowsDispatch = authorizeSyncPayload(
      role,
      userDb,
      dispatch,
      undefined,
    ) === null;

    expect(uiAllowsDispatch).toBe(serverAllowsDispatch);
  });

  it.each(supportedRoles)('matches sales-order fulfillment for %s', (role) => {
    const userDb = {
      salesOrders: [{ id: 'order-1', status: 'reserved' }],
      salesDispatches: [],
      stockMovements: [],
    };
    const fulfillment = {
      salesOrders: [{ id: 'order-1', status: 'fulfilled', dispatchId: 'dispatch-1' }],
      salesDispatches: [{ id: 'dispatch-1', salesOrderId: 'order-1', stockMovementId: 'movement-1' }],
      stockMovements: [{ id: 'movement-1', sourceRef: 'dispatch-1' }],
    };
    const permissions = salesWorkflowPermissions(role);
    const uiAllowsFulfillment = permissions.canUpdateOrder
      && permissions.canCreateDispatch
      && permissions.canCreateStockMovement;
    const serverAllowsFulfillment = authorizeSyncPayload(
      role,
      userDb,
      fulfillment,
      undefined,
    ) === null;

    expect(uiAllowsFulfillment).toBe(serverAllowsFulfillment);
  });

  it.each(supportedRoles)('matches append-only sales reversal writes for %s', (role) => {
    const userDb = {
      salesOrders: [{ id: 'order-1', status: 'fulfilled', dispatchId: 'dispatch-1' }],
      salesDispatches: [{ id: 'dispatch-1', salesOrderId: 'order-1', stockMovementId: 'movement-1' }],
      stockMovements: [{ id: 'movement-1', sourceRef: 'dispatch-1' }],
    };
    const correction = {
      salesOrders: [{ id: 'order-1', status: 'cancelled', dispatchId: 'dispatch-1' }],
      salesDispatches: [
        { id: 'dispatch-1', salesOrderId: 'order-1', stockMovementId: 'movement-1', reversedByCommandId: 'cmd-reversal' },
        { id: 'dispatch-reversal', recordKind: 'reversal', stockMovementId: 'movement-return' },
      ],
      stockMovements: [
        { id: 'movement-1', sourceRef: 'dispatch-1' },
        { id: 'movement-return', sourceRef: 'dispatch-reversal', direction: 'in' },
      ],
    };
    const permissions = salesWorkflowPermissions(role);
    const serverAllowsCorrection = authorizeSyncPayload(
      role,
      userDb,
      correction,
      undefined,
    ) === null;

    expect(permissions.canReverseDispatch).toBe(serverAllowsCorrection);
  });
});
