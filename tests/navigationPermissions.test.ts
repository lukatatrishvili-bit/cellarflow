import { describe, expect, it } from 'vitest';
import {
  canViewAppDestination,
  firstVisibleWineryTab,
  permissionModuleFor,
  visibleWineryTabIds,
} from '../lib/navigationPermissions';

describe('permission-aware app navigation', () => {
  it('maps each cellar destination to the permission enforced by the server', () => {
    expect(permissionModuleFor('gvino', 'intake')).toBe('grape_intake');
    expect(permissionModuleFor('gvino', 'qvevri')).toBe('vessels');
    expect(permissionModuleFor('gvino', 'calculators')).toBe('lab');
    expect(permissionModuleFor('gvino', 'ai')).toBe('tasks');
    expect(permissionModuleFor('docs')).toBe('official_docs');
  });

  it('only exposes role-relevant cellar destinations to a lab technician', () => {
    const tabs = visibleWineryTabIds('Lab Technician');

    expect(tabs).toEqual([
      'dashboard',
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
});
