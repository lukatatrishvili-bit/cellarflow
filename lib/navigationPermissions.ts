import { can, canAccess, type PermissionModule } from '../server/permissions';

export const WINERY_TAB_IDS = [
  'dashboard',
  'intake',
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
  'tasks',
  'ai',
  'notes',
] as const;

export type WineryTabId = (typeof WINERY_TAB_IDS)[number];

const OPERATIONAL_WINERY_TAB_IDS = WINERY_TAB_IDS.filter((tabId) => tabId !== 'dashboard');

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
      case 'tasks':
      case 'ai': return 'tasks';
      case 'notes': return 'notes';
      default: return 'reports';
    }
  }

  const moduleMap: Record<string, PermissionModule> = {
    portal: 'reports',
    vazi: 'vineyard',
    docs: 'official_docs',
    certification: 'certification',
    audit: 'audit',
    costs: 'costs',
    storage: 'storage',
    sales: 'sales',
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

  // The cellar overview is an aggregate surface. It is useful whenever at
  // least one operational cellar destination is available to the role.
  if (moduleId === 'gvino' && (tabId === undefined || tabId === 'dashboard')) {
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
