/**
 * Role-based access control for the server. The source of truth for "which role
 * may do what", so authorization is enforced on the backend (not just hidden in
 * the UI). Capabilities are coarse on purpose — the client syncs every
 * collection in one request, so write access is all-or-nothing per user.
 *
 * Roles mirror UserProfile['role'] in lib/wineryState.ts.
 */

export type Role =
  | 'Owner/Admin'
  | 'Viticulturist'
  | 'Winemaker'
  | 'Lab Technician'
  | 'Cellar Worker'
  | 'Read-Only';

export type Capability =
  | 'read'         // load account data
  | 'write'        // persist changes via /api/sync
  | 'admin'        // destructive account actions (reset)
  | 'manage_users';// future: invite / change roles

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  'Owner/Admin':    ['read', 'write', 'admin', 'manage_users'],
  'Winemaker':      ['read', 'write'],
  'Viticulturist':  ['read', 'write'],
  'Lab Technician': ['read', 'write'],
  'Cellar Worker':  ['read', 'write'],
  'Read-Only':      ['read'],
};

export function isKnownRole(role: unknown): role is Role {
  return typeof role === 'string' && role in ROLE_CAPABILITIES;
}

/**
 * Whether a role holds a capability. Unknown / missing roles are treated as
 * read-only (deny by default) so a malformed or downgraded account can never
 * gain write access.
 */
export function can(role: unknown, capability: Capability): boolean {
  const caps = isKnownRole(role) ? ROLE_CAPABILITIES[role] : (['read'] as Capability[]);
  return caps.includes(capability);
}
