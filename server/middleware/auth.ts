import express from 'express';
import { verifySessionToken, createSessionToken } from '../auth';
import { can, type Capability } from '../permissions';
import { getDB, getUserOrganizationStateMeta, refreshCoreMetadataFromPostgres, getPrismaClientForAdmin } from '../db';
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
  await refreshCoreMetadataFromPostgres();
  const user = getDB().users.find(u => u.username === session.username);
  if (!user) return null;
  const db = getDB();
  const activeOrganizationId = user.activeOrganizationId;
  const membership = activeOrganizationId
    ? db.memberships?.find(m => m.userId === user.username && m.organizationId === activeOrganizationId)
    : null;
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

export const loginLimiter = createSharedLoginLimiter({
  maxAttempts: 8,
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
    
    (req as any).wineryContext = {
      username: auth.username,
      role: auth.role,
      organizationId,
    };
    
    next();
  };
}
