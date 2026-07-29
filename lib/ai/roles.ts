import { canAccess, type PermissionModule } from '../../server/permissions';
import type { AiFinding, AiMonitoringArea, UserRole } from './types';

/**
 * Two different questions, deliberately kept apart:
 *
 *  - *Visibility* — may this role see the finding at all? Purely a permission
 *    question, answered against the module that owns the underlying data.
 *  - *Routing* — should this finding land in this role's briefing and
 *    notifications? A responsibility question. Routing the lab technician's
 *    SO₂ backlog to the viticulturist is how alert fatigue starts.
 *
 * A read-only auditor can therefore review the whole activity log without ever
 * being paged, and a viticulturist is never notified about a tank.
 */

export const AREA_ROLES: Record<AiMonitoringArea, UserRole[]> = {
  fermentation: ['Owner/Admin', 'Winemaker', 'Cellar Worker'],
  laboratory: ['Owner/Admin', 'Winemaker', 'Lab Technician'],
  inventory: ['Owner/Admin', 'Winemaker', 'Cellar Worker'],
  vineyard: ['Owner/Admin', 'Viticulturist'],
  compliance: ['Owner/Admin', 'Winemaker'],
  operations: ['Owner/Admin', 'Winemaker', 'Cellar Worker'],
};

/** Permission module that gates read access to each monitoring area's data. */
const AREA_MODULE: Record<AiMonitoringArea, PermissionModule> = {
  fermentation: 'fermentation',
  laboratory: 'lab',
  inventory: 'inventory',
  vineyard: 'vineyard',
  compliance: 'certification',
  operations: 'operations',
};

/** Authorization gate. Never bypass this — routing is a preference, this is not. */
export function canRoleSeeFinding(role: UserRole, finding: AiFinding): boolean {
  return canAccess(role, AREA_MODULE[finding.area], 'view');
}

/** Whether this finding should reach the role's briefing and notifications. */
export function isFindingRoutedToRole(role: UserRole, finding: AiFinding): boolean {
  if (!canRoleSeeFinding(role, finding)) return false;
  const targets = finding.roles.length > 0 ? finding.roles : AREA_ROLES[finding.area];
  return targets.includes(role);
}

/** Everything the role is allowed to look at. Used by the activity centre. */
export function filterFindingsForRole<T extends AiFinding>(findings: T[], role: UserRole): T[] {
  return findings.filter((finding) => canRoleSeeFinding(role, finding));
}

/** Everything the role is responsible for. Used by briefings and alerts. */
export function filterFindingsRoutedToRole<T extends AiFinding>(findings: T[], role: UserRole): T[] {
  return findings.filter((finding) => isFindingRoutedToRole(role, finding));
}

/**
 * Directors and owners get the cross-module picture; specialists get their own
 * area. Used to pick a default lens on the dashboard.
 */
export function primaryAreasForRole(role: UserRole): AiMonitoringArea[] {
  switch (role) {
    case 'Viticulturist':
      return ['vineyard'];
    case 'Lab Technician':
      return ['laboratory'];
    case 'Cellar Worker':
      return ['fermentation', 'operations', 'inventory'];
    case 'Winemaker':
      return ['fermentation', 'laboratory', 'operations', 'compliance'];
    case 'Owner/Admin':
      return ['fermentation', 'laboratory', 'inventory', 'vineyard', 'compliance', 'operations'];
    default:
      return [];
  }
}
