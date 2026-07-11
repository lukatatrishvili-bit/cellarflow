import { describe, expect, it } from 'vitest';
import { cellarWorkflowPermissions } from '../lib/workflowPermissions';

describe('compound cellar workflow permissions', () => {
  it('allows owners to complete every workflow action', () => {
    const permissions = cellarWorkflowPermissions('Owner/Admin');

    expect(Object.values(permissions).flatMap(Object.values).every(Boolean)).toBe(true);
  });

  it('keeps winemaker production actions but omits owner-only ledgers and deletion', () => {
    const permissions = cellarWorkflowPermissions('Winemaker');

    expect(permissions.vessels).toEqual({
      canCreateVessel: true,
      canUpdateVessel: true,
      canDeleteVessel: false,
    });
    expect(permissions.transfers).toEqual({
      canExecuteTransfer: true,
      canSanitizeVessels: true,
      canRollbackTransfer: true,
    });
    expect(permissions.fermentation).toEqual({
      canCreateFermentationLog: true,
      canUpdateFermentationLot: true,
      canUpdateFermentationVessel: true,
      canDeleteFermentationLog: false,
    });
    expect(permissions.bottling).toEqual({
      canCreateBottling: true,
      canDeleteBottling: false,
      canUseBottlingCosting: false,
      canPlaceFinishedGoods: false,
    });
  });

  it('keeps cellar-worker telemetry and sanitation without unsafe lot mutations', () => {
    const permissions = cellarWorkflowPermissions('Cellar Worker');

    expect(permissions.vessels).toEqual({
      canCreateVessel: false,
      canUpdateVessel: true,
      canDeleteVessel: false,
    });
    expect(permissions.transfers).toEqual({
      canExecuteTransfer: false,
      canSanitizeVessels: true,
      canRollbackTransfer: false,
    });
    expect(permissions.fermentation).toEqual({
      canCreateFermentationLog: true,
      canUpdateFermentationLot: false,
      canUpdateFermentationVessel: true,
      canDeleteFermentationLog: false,
    });
    expect(Object.values(permissions.bottling).every(value => value === false)).toBe(true);
  });

  it('denies every mutation for read-only and unknown roles', () => {
    for (const role of ['Read-Only', 'Unknown Role']) {
      const permissions = cellarWorkflowPermissions(role);
      expect(Object.values(permissions).flatMap(Object.values).every(value => value === false)).toBe(true);
    }
  });
});
