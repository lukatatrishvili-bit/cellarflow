import { describe, expect, it } from 'vitest';
import {
  canViewAppDestination,
  canViewUserDestination,
  firstVisibleWineryTab,
  permissionModuleFor,
  visibleWineryTabIds,
} from '../lib/navigationPermissions';

describe('permission-aware app navigation', () => {
  it('maps each cellar destination to the permission enforced by the server', () => {
    expect(permissionModuleFor('gvino', 'intake')).toBe('grape_intake');
    // Legacy qvevri links still degrade into the consolidated Vessels area.
    expect(permissionModuleFor('gvino', 'qvevri')).toBe('vessels');
    expect(permissionModuleFor('gvino', 'calculators')).toBe('lab');
    expect(permissionModuleFor('gvino', 'ai')).toBe('tasks');
    expect(permissionModuleFor('docs')).toBe('official_docs');
  });

  it('keeps qvevri records inside the consolidated Vessels destination', () => {
    expect(visibleWineryTabIds('Owner/Admin')).toContain('vessels');
    expect(visibleWineryTabIds('Owner/Admin')).not.toContain('qvevri');
  });

  it('only exposes role-relevant cellar destinations to a lab technician', () => {
    const tabs = visibleWineryTabIds('Lab Technician');

    expect(tabs).toEqual([
      'dashboard',
      // Cross-module surface: reachable, but it only ever renders findings from
      // areas this role can read (lab, in this case).
      'intelligence',
      'lots',
      'lineage',
      'labs',
      'calculators',
      'tasks',
      'ai',
      'notes',
    ]);
    expect(tabs).not.toContain('fermentation');
    expect(tabs).not.toContain('bottling');
  });

  it('keeps personal preferences available while hiding admin integrations', () => {
    expect(canViewAppDestination('Cellar Worker', 'settings')).toBe(true);
    expect(canViewAppDestination('Cellar Worker', 'integrations')).toBe(false);
    expect(canViewAppDestination('Read-Only', 'integrations')).toBe(false);
    expect(canViewAppDestination('Owner/Admin', 'integrations')).toBe(true);
  });

  it('recovers an invalid cached cellar tab to the role overview', () => {
    expect(firstVisibleWineryTab('Viticulturist')).toBe('dashboard');
    expect(canViewAppDestination('Viticulturist', 'gvino', 'vessels')).toBe(false);
    expect(canViewAppDestination('Viticulturist', 'gvino', 'intake')).toBe(true);
  });

  it('keeps the raw master account in the system console until it impersonates a winery', () => {
    const master = { role: 'Owner/Admin', isMasterAdmin: true };
    expect(canViewUserDestination(master, 'master-admin')).toBe(true);
    expect(canViewUserDestination(master, 'portal')).toBe(false);
    expect(canViewUserDestination(master, 'integrations')).toBe(false);
    expect(canViewUserDestination(master, 'settings')).toBe(false);

    const impersonatedOwner = { role: 'Owner/Admin', isMasterAdmin: false };
    expect(canViewUserDestination(impersonatedOwner, 'master-admin')).toBe(false);
    expect(canViewUserDestination(impersonatedOwner, 'integrations')).toBe(true);
  });
});
