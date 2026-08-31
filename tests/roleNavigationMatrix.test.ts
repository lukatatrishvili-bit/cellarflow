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
  // "Stock & Sales" — materials in, goods out. Materials was a cellar tab
  // until it became a module of its own.
  business: ['inventory', 'procurement', 'storage', 'sales', 'recall'],
  // "Records" — everything looked up or reported on, including cost reporting.
  documents: ['docs', 'certification', 'audit', 'costs', 'analytics'],
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
    // Reaches Stock & Sales for Materials alone — stock lookup is part of the job.
    'Cellar Worker':  ['dashboard', 'cellar', 'business', 'documents', 'settings'],
    'Read-Only':      ['dashboard', 'vineyard', 'cellar', 'business', 'documents', 'settings'],
  };

  it.each([...ALL_ROLES])('%s sees exactly the expected module groups', (role) => {
    expect(visibleGroups(role)).toEqual(EXPECTED[role]);
  });
});

describe('role navigation matrix — exact per-role destinations', () => {
  // Group-level visibility is too coarse to notice a module quietly appearing
  // inside a group a role already had. This table pins every destination, so
  // "which roles can see this screen" is reviewed whenever it changes.
  const EXPECTED_MODULES: Record<(typeof ALL_ROLES)[number], Record<string, string[]>> = {
    'Owner/Admin': {
      dashboard: ['portal', 'work'],
      vineyard: ['vazi'],
      cellar: ['gvino'],
      business: ['inventory', 'procurement', 'storage', 'sales', 'recall'],
      documents: ['docs', 'certification', 'audit', 'costs', 'analytics'],
      settings: ['integrations', 'settings'],
    },
    'Winemaker': {
      dashboard: ['portal', 'work'],
      cellar: ['gvino'],
      business: ['inventory', 'procurement', 'recall'],
      documents: ['docs', 'certification', 'audit'],
      settings: ['settings'],
    },
    'Viticulturist': {
      dashboard: ['portal', 'work'],
      vineyard: ['vazi'],
      cellar: ['gvino'],
      documents: ['docs', 'certification', 'audit'],
      settings: ['settings'],
    },
    'Lab Technician': {
      dashboard: ['portal', 'work'],
      cellar: ['gvino'],
      documents: ['docs', 'certification', 'audit'],
      settings: ['settings'],
    },
    'Cellar Worker': {
      dashboard: ['portal', 'work'],
      cellar: ['gvino'],
      business: ['inventory'],
      documents: ['audit'],
      settings: ['settings'],
    },
    'Read-Only': {
      dashboard: ['portal', 'work'],
      vineyard: ['vazi'],
      cellar: ['gvino'],
      business: ['inventory', 'procurement', 'storage', 'sales', 'recall'],
      documents: ['docs', 'certification', 'audit', 'costs', 'analytics'],
      settings: ['settings'],
    },
  };

  it.each([...ALL_ROLES])('%s reaches exactly the expected modules', (role) => {
    const actual = Object.fromEntries(
      Object.entries(NAV_GROUPS)
        .map(([group, destinations]) => [group, destinations.filter((dest) => canViewAppDestination(role, dest))])
        .filter(([, visible]) => (visible as string[]).length > 0),
    );
    expect(actual).toEqual(EXPECTED_MODULES[role]);
  });

  // The cellar sidebar is the longest branch of the tree, so its per-role
  // shape is worth pinning too.
  const EXPECTED_CELLAR_TABS: Record<(typeof ALL_ROLES)[number], number> = {
    'Owner/Admin': 18,
    'Winemaker': 18,
    'Viticulturist': 11,
    'Lab Technician': 12,
    'Cellar Worker': 14,
    'Read-Only': 18,
  };

  it.each([...ALL_ROLES])('%s sees the expected number of cellar destinations', (role) => {
    expect(visibleWineryTabIds(role)).toHaveLength(EXPECTED_CELLAR_TABS[role]);
  });

  it('no operational role sees the full owner tree', () => {
    const owner = visibleWineryTabIds('Owner/Admin').length;
    for (const role of ['Viticulturist', 'Lab Technician', 'Cellar Worker'] as const) {
      expect(visibleWineryTabIds(role).length, `${role} sees as much as the owner`).toBeLessThan(owner);
    }
  });
});

describe('vineyard destinations honour their own permissions', () => {
  // The project register is gated on 'vineyard_projects', which the sync layer
  // already enforces. Navigation must use the same permission rather than
  // lumping every vineyard screen under 'vineyard'.
  it('maps the project register to its own permission module', () => {
    expect(permissionModuleFor('vazi', 'projects')).toBe('vineyard_projects');
  });

  it.each(['dashboard', 'blocks', 'scouting', 'ipm_pheno', 'spraying', 'sampling', 'yield', 'weather'])(
    'maps the "%s" screen to the vineyard permission',
    (tab) => {
      expect(permissionModuleFor('vazi', tab)).toBe('vineyard');
    },
  );

  it('keeps every vineyard screen reachable for the roles that own the vineyard', () => {
    for (const role of ['Owner/Admin', 'Viticulturist', 'Read-Only'] as const) {
      for (const tab of ['dashboard', 'blocks', 'projects', 'scouting', 'spraying', 'sampling', 'yield', 'weather']) {
        expect(canViewAppDestination(role, 'vazi', tab), `${role} lost vineyard/${tab}`).toBe(true);
      }
    }
  });

  it('keeps the vineyard closed to roles without it', () => {
    for (const role of ['Winemaker', 'Lab Technician', 'Cellar Worker'] as const) {
      expect(canViewAppDestination(role, 'vazi')).toBe(false);
      expect(canViewAppDestination(role, 'vazi', 'projects')).toBe(false);
    }
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
