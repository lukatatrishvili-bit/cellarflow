import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_WINERY_TAB_IDS,
  WINERY_TAB_IDS,
  canViewAppDestination,
  firstVisibleWineryTab,
  permissionModuleFor,
  visibleWineryTabIds,
} from '../lib/navigationPermissions';

/**
 * Role-navigation matrix smoke test.
 *
 * Two shipped regressions motivated this suite: a hooks-order crash that
 * white-screened every role, and a module-gate bug that hid the ENTIRE
 * Cellar module from Winemaker / Cellar Worker / Lab Technician (the roles
 * whose job is the cellar) while 400 unit tests stayed green. These tests
 * make per-role navigation an executable contract: if a permissions change
 * locks a role out of its working surface — or silently widens access — the
 * suite fails and the diff review happens HERE, on purpose.
 *
 * The group → destination map mirrors moduleGroups in src/App.tsx. If a group
 * is added or reshuffled there, update this table in the same commit.
 */

const ALL_ROLES = [
  'Owner/Admin',
  'Winemaker',
  'Viticulturist',
  'Lab Technician',
  'Cellar Worker',
  'Read-Only',
] as const;

const NAV_GROUPS: Record<string, string[]> = {
  dashboard: ['portal', 'work'],
  vineyard: ['vazi'],
  cellar: ['gvino'],
  business: ['sales', 'storage', 'recall', 'procurement', 'costs', 'analytics'],
  documents: ['docs', 'certification', 'audit'],
  settings: ['integrations', 'settings'],
};

function visibleGroups(role: string): string[] {
  return Object.entries(NAV_GROUPS)
    .filter(([, destinations]) => destinations.some((dest) => canViewAppDestination(role, dest)))
    .map(([group]) => group);
}

describe('role navigation matrix — invariants for every role', () => {
  it.each([...ALL_ROLES])('%s sees a non-empty navigation with Dashboard and Settings', (role) => {
    const groups = visibleGroups(role);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups).toContain('dashboard');
    expect(groups).toContain('settings');
  });

  it.each([...ALL_ROLES])('%s: every visible group has at least one reachable destination', (role) => {
    for (const [group, destinations] of Object.entries(NAV_GROUPS)) {
      const visible = destinations.filter((dest) => canViewAppDestination(role, dest));
      if (visibleGroups(role).includes(group)) {
        expect(visible.length, `${role} sees group "${group}" but no destination inside it`).toBeGreaterThan(0);
      }
    }
  });

  it.each([...ALL_ROLES])('%s: cellar visibility implies a working landing tab', (role) => {
    if (!canViewAppDestination(role, 'gvino')) return;
    const first = firstVisibleWineryTab(role);
    expect(first, `${role} can open the cellar but has no visible tab`).not.toBeNull();
    // The aggregate dashboard is always the safe landing for anyone in gvino.
    expect(visibleWineryTabIds(role)).toContain('dashboard');
  });
});

describe('role navigation matrix — exact per-role group visibility', () => {
  // This table IS the contract. A deliberate permissions change should update
  // it in the same commit; an accidental one fails loudly here.
  const EXPECTED: Record<(typeof ALL_ROLES)[number], string[]> = {
    'Owner/Admin':    ['dashboard', 'vineyard', 'cellar', 'business', 'documents', 'settings'],
    'Winemaker':      ['dashboard', 'cellar', 'business', 'documents', 'settings'],
    'Viticulturist':  ['dashboard', 'vineyard', 'cellar', 'documents', 'settings'],
    'Lab Technician': ['dashboard', 'cellar', 'documents', 'settings'],
    'Cellar Worker':  ['dashboard', 'cellar', 'documents', 'settings'],
    'Read-Only':      ['dashboard', 'vineyard', 'cellar', 'business', 'documents', 'settings'],
  };

  it.each([...ALL_ROLES])('%s sees exactly the expected module groups', (role) => {
    expect(visibleGroups(role)).toEqual(EXPECTED[role]);
  });
});

describe('regression: cellar roles must reach the Cellar module', () => {
  // Shipped bug: the bare 'gvino' container mapped to the 'reports' permission,
  // which these roles lack — hiding the whole Cellar module from the people
  // who live in it. The container must be visible whenever ANY cellar tab is.
  it.each(['Winemaker', 'Cellar Worker', 'Lab Technician'])('%s can open the Cellar module', (role) => {
    expect(canViewAppDestination(role, 'gvino')).toBe(true);
    expect(canViewAppDestination(role, 'gvino', 'dashboard')).toBe(true);
  });

  it('every operational cellar tab maps to a real permission module (no reports fallthrough)', () => {
    for (const tab of WINERY_TAB_IDS) {
      if (AGGREGATE_WINERY_TAB_IDS.includes(tab)) continue; // cross-module surfaces, special-cased
      expect(permissionModuleFor('gvino', tab), `tab "${tab}" fell through to 'reports'`).not.toBe('reports');
    }
  });

  it.each(['Winemaker', 'Cellar Worker', 'Lab Technician', 'Viticulturist'])(
    '%s can open the intelligence centre',
    (role) => {
      // The aggregate surfaces must never require the 'reports' permission the
      // operational roles do not hold — that was the original module-gate bug.
      expect(canViewAppDestination(role, 'gvino', 'intelligence')).toBe(true);
    },
  );
});

describe('degradation: unknown or malformed roles', () => {
  it.each(['Sommelier', '', undefined, null, 42])('role %s degrades to read-only visibility, never an empty nav', (role) => {
    const groups = visibleGroups(role as any);
    expect(groups).toContain('dashboard');
    expect(groups).toContain('settings');
    // Unknown roles must NEVER gain admin surfaces.
    expect(canViewAppDestination(role as any, 'integrations')).toBe(false);
  });
});
