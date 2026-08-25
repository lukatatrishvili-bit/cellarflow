import { can, canAccess, type PermissionModule } from '../server/permissions';

export const WINERY_TAB_IDS = [
  'dashboard',
  'intelligence',
  'intake',
  'cellar',
  'lots',
  'lineage',
  'vessels',
  'operations',
  'transfers',
  'fermentation',
  'labs',
  'calculators',
  'bottling',
  'inventory',
  'quality',
  'planner',
  'tasks',
  'ai',
  'notes',
] as const;

export type WineryTabId = (typeof WINERY_TAB_IDS)[number];

/**
 * Cross-module surfaces that summarise the cellar rather than owning data of
 * their own. They carry no permission module: they are visible whenever the
 * role can reach at least one operational destination, and their contents are
 * filtered per record by the module that actually owns each row.
 */
export const AGGREGATE_WINERY_TAB_IDS: readonly WineryTabId[] = ['dashboard', 'intelligence', 'cellar'];

const OPERATIONAL_WINERY_TAB_IDS = WINERY_TAB_IDS.filter(
  (tabId) => !AGGREGATE_WINERY_TAB_IDS.includes(tabId),
);

export function permissionModuleFor(moduleId: string, tabId?: string): PermissionModule {
  if (moduleId === 'gvino') {
    switch (tabId) {
      case 'intake': return 'grape_intake';
      case 'lots':
      case 'lineage': return 'lots';
      case 'vessels':
      case 'qvevri': return 'vessels';
      case 'operations': return 'operations';
      case 'transfers': return 'transfers';
      case 'fermentation': return 'fermentation';
      case 'labs':
      case 'calculators': return 'lab';
      case 'bottling': return 'bottling';
      case 'inventory': return 'inventory';
      case 'quality': return 'tasks';
      case 'planner': return 'planning';
      case 'tasks':
      case 'ai': return 'tasks';
      case 'notes': return 'notes';
      default: return 'reports';
    }
  }

  const moduleMap: Record<string, PermissionModule> = {
    portal: 'reports',
    work: 'tasks',
    vazi: 'vineyard',
    docs: 'official_docs',
    certification: 'certification',
    audit: 'audit',
    costs: 'costs',
    storage: 'storage',
    sales: 'sales',
    recall: 'recall',
    procurement: 'procurement',
    analytics: 'reports',
    integrations: 'company_profile',
    settings: 'company_profile',
  };

  return moduleMap[moduleId] || 'reports';
}

export function canViewAppDestination(role: unknown, moduleId: string, tabId?: string): boolean {
  // Every signed-in user can reach their personal dashboard and preferences.
  // Organization-management controls inside Settings remain separately gated.
  if (moduleId === 'portal' || moduleId === 'settings') return true;
  if (moduleId === 'integrations') return can(role, 'admin');
  if (
    moduleId === 'gvino'
    && tabId !== undefined
    && tabId !== 'qvevri'
    && !(WINERY_TAB_IDS as readonly string[]).includes(tabId)
  ) return false;

  // The unified cellar workspace safely filters lot and vessel records by
  // their owning permission. A user may open it when either register is visible.
  if (moduleId === 'gvino' && tabId === 'cellar') {
    return canAccess(role, 'lots', 'view') || canAccess(role, 'vessels', 'view');
  }

  // The cellar overview and the intelligence centre are aggregate surfaces.
  // They are useful whenever at least one operational cellar destination is
  // available to the role, and they never expose more than that role can read.
  if (moduleId === 'gvino' && (tabId === undefined || AGGREGATE_WINERY_TAB_IDS.includes(tabId as WineryTabId))) {
    return OPERATIONAL_WINERY_TAB_IDS.some((candidate) => (
      canAccess(role, permissionModuleFor('gvino', candidate), 'view')
    ));
  }

  return canAccess(role, permissionModuleFor(moduleId, tabId), 'view');
}

export function canViewUserDestination(
  user: { role: unknown; isMasterAdmin?: boolean },
  moduleId: string,
  tabId?: string,
): boolean {
  // The environment master account has no active winery by design. It must
  // enter an organization through audited impersonation before tenant-scoped
  // routes or screens become available.
  if (user.isMasterAdmin === true) return moduleId === 'master-admin';
  if (moduleId === 'master-admin') return false;
  return canViewAppDestination(user.role, moduleId, tabId);
}

export function visibleWineryTabIds(role: unknown): WineryTabId[] {
  return WINERY_TAB_IDS.filter((tabId) => canViewAppDestination(role, 'gvino', tabId));
}

export function firstVisibleWineryTab(role: unknown): WineryTabId | null {
  return visibleWineryTabIds(role)[0] || null;
}
