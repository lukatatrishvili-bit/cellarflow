import express from 'express';
import { verifySessionToken, sessionMatchesUserVersion, userAccountIsEnabled } from '../auth';
import { approvalStatusForUser } from '../registrationApproval';
import { can, type Capability } from '../permissions';
import { getDB, getUserOrganizationStateMeta, loadSessionPrincipal, getPrismaClientForAdmin, touchUserPresence } from '../db';
import { cleanEnv, COOKIE_SECURE } from '../config';
import { createSharedLoginLimiter } from '../loginLimiter';

// Helper to parse cookies manually
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const key = parts[0].trim();
    const val = parts.slice(1).join('=');
    list[key] = decodeURIComponent(val);
  });
  return list;
}

/** Build a hardened session cookie (HttpOnly, SameSite=Lax, Secure in prod). */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const parts = [
    `maranios_session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax', // Lax still allows the top-level Google OAuth redirect GET
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(): string {
  return ['maranios_session=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(COOKIE_SECURE ? ['Secure'] : [])].join('; ');
}

export function isMasterAdmin(username: string): boolean {
  const envAdmin = cleanEnv(process.env.ADMIN_USERNAME);
  return Boolean(envAdmin) && username.trim().toLowerCase() === envAdmin.toLowerCase();
}

/**
 * Resolve the authenticated user's *current* role from the database rather than
 * trusting the role baked into the session token at login time — so a role
 * change (or a deleted account) takes effect immediately on the next request.
 * The env master admin is not stored in db.users, so it is recognised here.
 * Returns null when there is no valid session or the user no longer exists.
 */
export async function liveSessionRole(req: express.Request): Promise<{ username: string; role: string } | null> {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies['maranios_session']);
  if (!session || !session.username) return null;
  const envAdmin = cleanEnv(process.env.ADMIN_USERNAME).toLowerCase();
  if (envAdmin && String(session.username).trim().toLowerCase() === envAdmin) {
    return { username: session.username, role: 'Owner/Admin' };
  }
  // Read only this user's rows, not the whole platform directory. The checks
  // below are unchanged and still resolved against PostgreSQL on every request;
  // see `loadSessionPrincipal` for why the narrower read is safe. When
  // PostgreSQL is unavailable the in-memory directory answers, as it did before.
  const principal = await loadSessionPrincipal(session.username);
  const db = getDB();
  const user = principal?.user || db.users.find(u => u.username === session.username);
  if (!user) return null;
  if (!userAccountIsEnabled(user)) return null;
  // Approval can be withdrawn after a session was issued; every request re-checks.
  if (approvalStatusForUser(user) !== 'approved') return null;
  if (!sessionMatchesUserVersion(session, user)) return null;
  const activeOrganizationId = user.activeOrganizationId;
  const memberships = principal?.memberships || db.memberships || [];
  const membership = activeOrganizationId
    ? memberships.find((m: any) => m.userId === user.username && m.organizationId === activeOrganizationId)
    : null;
  if (activeOrganizationId && !membership) return null;
  await touchUserPresence(user.username);
  return { username: user.username, role: membership?.role || user.role };
}

export async function requireMasterAdmin(req: express.Request, res: express.Response): Promise<{ username: string; role: string } | null> {
  const auth = await liveSessionRole(req);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  if (!isMasterAdmin(auth.username)) {
    res.status(403).json({ error: 'Forbidden: Master Administrator access required.' });
    return null;
  }
  return auth;
}

/**
 * Express guard: write the appropriate error and return null when the request
 * is unauthenticated (401) or the role lacks the capability (403); otherwise
 * return the resolved { username, role }.
 */
export function requireCapability(
  req: express.Request,
  res: express.Response,
  capability: Capability,
): Promise<{ username: string; role: string } | null> {
  return (async () => {
    const auth = await liveSessionRole(req);
    if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    if (!can(auth.role, capability)) {
      res.status(403).json({ error: `Forbidden: ${capability} access required.` });
      return null;
    }
    return auth;
  })();
}

export async function setOrganizationStateHeaders(res: express.Response, username: string) {
  const meta = await getUserOrganizationStateMeta(username);
  if (!meta) return null;

  res.setHeader('X-CellarFlow-Org-Id', meta.organizationId);
  res.setHeader('X-CellarFlow-Org-State-Source', meta.source);
  if (meta.version !== null) {
    res.setHeader('X-CellarFlow-Org-State-Version', String(meta.version));
  }
  if (meta.updatedAt) {
    res.setHeader('X-CellarFlow-Org-State-Updated-At', meta.updatedAt);
  }
  if (meta.updatedBy) {
    res.setHeader('X-CellarFlow-Org-State-Updated-By', meta.updatedBy);
  }
  return meta;
}

export function organizationContextMismatch(requestedOrganizationId: unknown, activeOrganizationId: string): boolean {
  const requested = typeof requestedOrganizationId === 'string'
    ? requestedOrganizationId.trim()
    : '';
  return Boolean(requested && requested !== activeOrganizationId);
}

export const loginLimiter = createSharedLoginLimiter({
  maxAttempts: 8,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}, getPrismaClientForAdmin);

export const accountRecoveryLimiter = createSharedLoginLimiter({
  maxAttempts: 5,
  windowMs: 60 * 60 * 1000,
  lockoutMs: 60 * 60 * 1000,
}, getPrismaClientForAdmin);

export const invitationLimiter = createSharedLoginLimiter({
  maxAttempts: 20,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}, getPrismaClientForAdmin);

/** Guards the emailed account-review page against token fishing. */
export const registrationApprovalLimiter = createSharedLoginLimiter({
  maxAttempts: 30,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}, getPrismaClientForAdmin);

export const oauthCallbackLimiter = createSharedLoginLimiter({
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}, getPrismaClientForAdmin);

/** Cost/abuse guard for proactive task email and browser-push sends per actor. */
export const taskNotificationLimiter = createSharedLoginLimiter({
  maxAttempts: 60,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}, getPrismaClientForAdmin);

export function checkWineryScope(capability: Capability) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = await liveSessionRole(req);
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!can(auth.role, capability)) {
      return res.status(403).json({ error: `Forbidden: ${capability} access required.` });
    }

    const db = getDB();
    const user = db.users.find(u => u.username === auth.username);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    const organizationId = user.activeOrganizationId;
    if (!organizationId) {
      return res.status(400).json({ error: 'No active organization set for user' });
    }
    const organization = db.organizations.find(org => org.id === organizationId);
    const organizationStatus = organization?.status || 'active';
    if (organizationStatus !== 'active') {
      return res.status(423).json({
        code: organizationStatus === 'archived' ? 'organization_archived' : 'organization_suspended',
        error: organizationStatus === 'archived'
          ? 'This organization is archived. Ask the master administrator to restore it.'
          : 'This organization is suspended. Ask the master administrator to restore access.',
      });
    }
    const requestedOrganizationId = req.get('X-CellarFlow-Org-Id');
    if (organizationContextMismatch(requestedOrganizationId, organizationId)) {
      res.setHeader('X-CellarFlow-Org-Id', organizationId);
      return res.status(409).json({
        code: 'org_context_changed',
        error: 'The active organization changed before this request completed. Reload the current organization state and retry.',
      });
    }

    (req as any).wineryContext = {
      username: auth.username,
      role: auth.role,
      organizationId,
    };

    next();
  };
}
