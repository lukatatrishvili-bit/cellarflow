import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from "@google/genai";
import {
  getDB,
  saveDB,
  createEmptyUserData,
  initDB,
  resetUserData,
  getUserData,
  saveUserData,
  getDbRuntimeStatus,
  forceSaveDB,
  getUserOrganizationStateMeta,
  reloadOrganizationDataFromPostgres,
  reloadUserOrganizationDataFromPostgres,
  OrganizationStateVersionConflictError,
  refreshCoreMetadataFromPostgres,
  saveCoreMetadata,
  deleteUserMetadataFromPostgres,
  getPrismaClientForAdmin,
  getPostgresReadinessProbe,
} from './server/db';
import { verifySessionToken, createSessionToken, hashPassword, verifyPassword } from './server/auth';
import { applyDeletions, mergeCollections, isValidId } from './server/sync';
import { createSharedLoginLimiter } from './server/loginLimiter';
import { createDemoUser, readDemoAccountConfig } from './server/demoAccount';
import { can, type Capability } from './server/permissions';
import { generateVerificationToken, isVerificationTokenValid, isValidEmail } from './server/emailVerification';
import { sendMail, buildVerificationEmail, buildResetPasswordEmail, buildInvitationEmail } from './server/mailer';
import { applyRuntimeScaleReadinessProbe, getDeploymentStatus } from './server/deploymentStatus';
import { isRuntimeOAuthConfigAllowed, oauthConfigBlockedMessage } from './server/oauthConfigPolicy';
import { auditLogContentMatches, prepareAuditLogsForServerMerge } from './lib/auditHash';
import { getSeederData } from './server/seedTestUser';



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Google OAuth credentials are resolved ONLY from the environment
// (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) or the in-app setup screen
// (db.googleConfig). They are never hardcoded — a previously committed client
// secret was removed and must be rotated in Google Cloud Console. When neither
// source is configured, the OAuth routes fall back to the setup screen.
function cleanEnv(val: string | undefined): string {
  if (!val) return '';
  return val.replace(/^\uFEFF/, '').trim();
}

function getGoogleOAuthCreds(db: any): { clientId: string; clientSecret: string } {
  return {
    clientId: cleanEnv(process.env.GOOGLE_CLIENT_ID) || cleanEnv(db.googleConfig?.clientId),
    clientSecret: cleanEnv(process.env.GOOGLE_CLIENT_SECRET) || cleanEnv(db.googleConfig?.clientSecret),
  };
}


// Load .env manually if running locally
try {
  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const firstEqual = trimmed.indexOf('=');
        if (firstEqual !== -1) {
          const key = trimmed.slice(0, firstEqual).trim();
          let val = trimmed.slice(firstEqual + 1).trim();
          // remove surrounding quotes
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          // Only load if not already set in the environment
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    });
  }
} catch (err) {
  console.warn("Could not load .env file manually:", err);
}

// Helper to dynamically update the .env file with new credentials
function updateEnvFile(updates: Record<string, string>) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('Refusing to update .env at runtime in production. Use Secret Manager or Cloud Run environment variables instead.');
    return;
  }
  try {
    const envPath = path.resolve(__dirname, '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    const lines = envContent.split('\n');
    const newLines: string[] = [];
    const keysHandled = new Set<string>();
    
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const firstEqual = trimmed.indexOf('=');
        if (firstEqual !== -1) {
          const key = trimmed.slice(0, firstEqual).trim();
          if (updates[key] !== undefined) {
            newLines.push(`${key}="${updates[key]}"`);
            keysHandled.add(key);
            return;
          }
        }
      }
      newLines.push(line);
    });
    
    // Add keys not present in original file
    Object.keys(updates).forEach(key => {
      if (!keysHandled.has(key)) {
        newLines.push(`${key}="${updates[key]}"`);
      }
    });
    
    fs.writeFileSync(envPath, newLines.join('\n'), 'utf8');
    
    // Update process.env immediately
    Object.keys(updates).forEach(key => {
      process.env[key] = updates[key];
    });
  } catch (err) {
    console.error("Failed to update .env file manually:", err);
  }
}

// Gemini model used for all Winemaker AI features. Centralized here so the
// model can be swapped in a single place.
const GEMINI_MODEL = "gemini-2.5-flash";

const app = express();
// Behind Cloud Run / any reverse proxy: trust X-Forwarded-* so client IP
// (rate limiter) and protocol (cookie Secure / OAuth redirect) are correct.
app.set('trust proxy', true);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Helper to parse cookies manually
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
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

const COOKIE_SECURE = process.env.NODE_ENV === 'production';

/** Build a hardened session cookie (HttpOnly, SameSite=Lax, Secure in prod). */
function sessionCookie(token: string, maxAgeSeconds: number): string {
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
function clearSessionCookie(): string {
  return ['maranios_session=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(COOKIE_SECURE ? ['Secure'] : [])].join('; ');
}

function pruneTestUserSeedDuplicates(userDb: any): void {
  const staleHarvestIds = new Set(['HV-SAP-24', 'HV-RK-23']);
  const staleSamplingIds = new Set(['GS-SAP-24', 'GS-RK-23']);

  if (Array.isArray(userDb.harvests)) {
    userDb.harvests = userDb.harvests.filter((item: any) => !staleHarvestIds.has(item?.id));
  }
  if (Array.isArray(userDb.samplings)) {
    userDb.samplings = userDb.samplings.filter((item: any) => !staleSamplingIds.has(item?.id));
  }
}

/** Public base URL for building links (verification emails, redirects). */
function appBaseUrl(req: express.Request): string {
  const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

function verificationLink(req: express.Request, username: string, token: string): string {
  return `${appBaseUrl(req)}/api/auth/verify-email?token=${token}&u=${encodeURIComponent(username)}`;
}

/**
 * Whether the verification link may be returned in the API response. Only when
 * no real mail provider delivered it (console fallback) AND we are not in
 * production — in production the link must reach the user only by email, never
 * in the HTTP response (which would defeat verification).
 */
function exposeVerifyLink(transport: 'smtp' | 'console'): boolean {
  return transport === 'console' && process.env.NODE_ENV !== 'production';
}

/**
 * Resolve the authenticated user's *current* role from the database rather than
 * trusting the role baked into the session token at login time — so a role
 * change (or a deleted account) takes effect immediately on the next request.
 * The env master admin is not stored in db.users, so it is recognised here.
 * Returns null when there is no valid session or the user no longer exists.
 */
async function liveSessionRole(req: express.Request): Promise<{ username: string; role: string } | null> {
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

function isMasterAdmin(username: string): boolean {
  const envAdmin = cleanEnv(process.env.ADMIN_USERNAME);
  return Boolean(envAdmin) && username.trim().toLowerCase() === envAdmin.toLowerCase();
}


async function requireMasterAdmin(req: express.Request, res: express.Response): Promise<{ username: string; role: string } | null> {
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
function requireCapability(
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

// ── Master-admin action trail ────────────────────────────────────────────────
// Append-only record of every privileged mutation (who did what to whom).
// In-process ring buffer, same tradeoff as the login limiter: effective with
// --max-instances=1; move to a shared store for multi-instance.
interface AdminAction {
  at: string;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
}
const ADMIN_ACTIONS_CAP = 500;
const adminActions: AdminAction[] = [];
function recordAdminAction(actor: string, action: string, target?: string, detail?: string): void {
  adminActions.unshift({ at: new Date().toISOString(), actor, action, target, detail });
  if (adminActions.length > ADMIN_ACTIONS_CAP) adminActions.length = ADMIN_ACTIONS_CAP;
}

// ── Event-loop lag sampler ───────────────────────────────────────────────────
// Real responsiveness signal for the admin console (a lagging loop means slow
// requests regardless of CPU). Sampled continuously, cheap (one timer).
let eventLoopLagMs = 0;
{
  const SAMPLE_EVERY_MS = 500;
  let last = Date.now();
  const sampler = setInterval(() => {
    const t = Date.now();
    eventLoopLagMs = Math.max(0, t - last - SAMPLE_EVERY_MS);
    last = t;
  }, SAMPLE_EVERY_MS);
  sampler.unref?.(); // never keep the process alive just for telemetry
}

// ── Login brute-force limiter ────────────────────────────────────────────────
// Per IP+identifier sliding window with temporary lockout. In-memory: paired
// with --max-instances=1 (see deployment guide) it is effective; a shared store
// (Redis) would be needed for multi-instance.
async function setOrganizationStateHeaders(res: express.Response, username: string) {
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

const loginLimiter = createSharedLoginLimiter({
  maxAttempts: 8,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}, getPrismaClientForAdmin);

function clientIp(req: any): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

const demoAccountConfig = readDemoAccountConfig();

async function ensureDemoAccount() {
  if (!demoAccountConfig.enabled) return null;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  let user = db.users.find((candidate: any) => candidate.username === demoAccountConfig.username);
  if (!user) {
    user = createDemoUser(demoAccountConfig);
    db.users.push(user);
    await saveCoreMetadata('demo-account-create');
  }

  const existingData = await getUserData(demoAccountConfig.username);
  if (!existingData) {
    // This is intentionally empty. The demo account uses the real persistence
    // and sync paths; it never receives fabricated operational records.
    await saveUserData(demoAccountConfig.username, createEmptyUserData());
  }

  return user;
}

app.get('/api/config', (_req, res) => {
  res.json({ demoLoginEnabled: demoAccountConfig.enabled });
});

// Public liveness probe — intentionally minimal (no config/infra details).
app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

// Detailed deployment diagnostics (backend, integrations, warnings) are
// admin-only: the full status reveals infrastructure that should not be public.
app.get('/api/admin/deployment-status', async (req, res) => {
  const auth = await requireCapability(req, res, 'admin');
  if (!auth) return;
  res.json(getDeploymentStatus());
});

// Authentication endpoints
app.post('/api/auth/register', async (req, res) => {
  const { username, email, fullName, role, language, passcode } = req.body;

  if (!username || !passcode) {
    return res.status(400).json({ error: 'Username and passcode are required' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const cleanUsername = String(username).toLowerCase().replace(/\s+/g, '_');
  const cleanEmail = String(email).toLowerCase().trim();

  if (db.users.find(u => u.username === cleanUsername)) {
    return res.status(400).json({ error: 'Username is already taken' });
  }
  if (db.users.find(u => (u.email || '').toLowerCase().trim() === cleanEmail)) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const verification = generateVerificationToken();
  
  // Create a default organization for the user
  const orgId = 'org_' + Math.random().toString(36).substr(2, 9);
  const org = { id: orgId, name: `${fullName || cleanUsername}'s Estate` };
  if (!db.organizations) db.organizations = [];
  db.organizations.push(org);

  // Create membership
  const memId = 'mem_' + Math.random().toString(36).substr(2, 9);
  const membership = { id: memId, userId: cleanUsername, organizationId: orgId, role: 'Owner/Admin' };
  if (!db.memberships) db.memberships = [];
  db.memberships.push(membership);

  const user: any = {
    username: cleanUsername,
    email: cleanEmail,
    fullName,
    role,
    language: language || 'en',
    passwordHash: hashPassword(passcode || 'vinea2026'),
    enabledModules: ['vazi', 'gvino'],
    enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks'],
    // New accounts must confirm their email before they can sign in.
    emailVerified: false,
    verifyTokenHash: verification.tokenHash,
    verifyTokenExpires: verification.expiresAt,
    activeOrganizationId: orgId,
  };
  db.users.push(user);

  // Initialize empty organization-scoped data container
  if (!db.orgData) {
    db.orgData = {};
  }
  db.orgData[orgId] = createEmptyUserData();

  await saveCoreMetadata('auth-register');
  await saveUserData(cleanUsername, db.orgData[orgId]);

  const link = verificationLink(req, cleanUsername, verification.token);
  const mail = await sendMail(buildVerificationEmail({ to: cleanEmail, link, lang: user.language, wineryName: 'VinOS' }));

  // No session cookie — the account is inactive until the email is verified.
  res.json({
    requiresVerification: true,
    username: cleanUsername,
    email: cleanEmail,
    // Outside production, when no real mail provider delivered the message,
    // surface the link so the flow is completeable without SMTP. Never exposed
    // in production — there a verification link must arrive only via email.
    ...(exposeVerifyLink(mail.transport) ? { devVerifyUrl: link } : {}),
  });
});

// Email verification — opened from the link in the verification email.
app.get('/api/auth/verify-email', async (req, res) => {
  const token = String(req.query.token || '');
  const username = String(req.query.u || '').toLowerCase();
  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === username) as any;

  if (!user) return res.redirect('/?verify_error=invalid');
  if (user.emailVerified) return res.redirect('/?verified=already');
  if (!isVerificationTokenValid(user, token)) return res.redirect('/?verify_error=expired');

  user.emailVerified = true;
  delete user.verifyTokenHash;
  delete user.verifyTokenExpires;
  await saveCoreMetadata('auth-verify-email');

  // Automatically log the user in after successful verification
  const sessionToken = createSessionToken({ username: user.username, role: user.role }, true);
  res.setHeader('Set-Cookie', sessionCookie(sessionToken, 2592000)); // 30 days

  res.redirect('/?verified=1');
});

// Resend a verification link. Responds uniformly to avoid leaking which
// accounts exist; only actually re-sends for a known, still-unverified user.
app.post('/api/auth/resend-verification', async (req, res) => {
  const id = String(req.body?.identifier || '').toLowerCase().trim();
  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === id || (u.email || '').toLowerCase().trim() === id) as any;

  if (user && user.emailVerified === false) {
    const verification = generateVerificationToken();
    user.verifyTokenHash = verification.tokenHash;
    user.verifyTokenExpires = verification.expiresAt;
    await saveCoreMetadata('auth-resend-verification');
    const link = verificationLink(req, user.username, verification.token);
    const mail = await sendMail(buildVerificationEmail({ to: user.email, link, lang: user.language, wineryName: 'VinOS' }));
    if (exposeVerifyLink(mail.transport)) {
      return res.json({ ok: true, devVerifyUrl: link });
    }
  }
  res.json({ ok: true });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => (u.email || '').toLowerCase().trim() === email) as any;

  if (!user) {
    return res.status(400).json({ error: 'No account found with this email address' });
  }

  const resetToken = generateVerificationToken();
  user.resetTokenHash = resetToken.tokenHash;
  user.resetTokenExpires = resetToken.expiresAt;
  await saveCoreMetadata('auth-forgot-password');

  const link = `${appBaseUrl(req)}/?reset_token=${resetToken.token}&u=${encodeURIComponent(user.username)}`;
  const mail = await sendMail(buildResetPasswordEmail({ to: user.email, link, lang: user.language, wineryName: 'VinOS' }));

  if (exposeVerifyLink(mail.transport)) {
    return res.json({ ok: true, devVerifyUrl: link });
  }

  res.json({ ok: true });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, username, passcode } = req.body;
  if (!token || !username || !passcode) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const cleanUsername = String(username).toLowerCase().trim();
  const user = db.users.find(u => u.username === cleanUsername) as any;

  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  const isValid = isVerificationTokenValid({
    verifyTokenHash: user.resetTokenHash,
    verifyTokenExpires: user.resetTokenExpires
  }, token);

  if (!isValid) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  user.passwordHash = hashPassword(passcode || 'vinea2026');
  delete user.resetTokenHash;
  delete user.resetTokenExpires;
  await saveCoreMetadata('auth-reset-password');

  res.json({ ok: true });
});


app.post('/api/auth/login', async (req, res) => {
  const { identifier, passcode, rememberMe } = req.body;

  // Brute-force guard: lock out an IP+identifier after repeated failures.
  const limiterKey = `${clientIp(req)}:${String(identifier || '').toLowerCase()}`;
  const lockRemaining = await loginLimiter.lockRemainingSeconds(limiterKey);
  if (lockRemaining > 0) {
    res.setHeader('Retry-After', String(lockRemaining));
    return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(lockRemaining / 60)} min.` });
  }

  // Master Admin Environment Check (Private Credentials)
  const envAdminUser = cleanEnv(process.env.ADMIN_USERNAME);
  const envAdminPass = cleanEnv(process.env.ADMIN_PASSCODE) || cleanEnv(process.env.ADMIN_PASSWORD);

  
  if (envAdminUser && envAdminPass && identifier && passcode) {
    const inputUser = String(identifier).trim().toLowerCase();
    const targetUser = String(envAdminUser).trim().toLowerCase();
    if (inputUser === targetUser || inputUser === `${targetUser}@vinea.com` || inputUser === `${targetUser}@cellarflow.com`) {
      if (String(passcode).trim() === String(envAdminPass).trim()) {
        await loginLimiter.clear(limiterKey);
        const token = createSessionToken({ username: envAdminUser, role: 'Owner/Admin' }, rememberMe);
        const maxAge = rememberMe ? 2592000 : 86400; // 30 days vs 24 hours
        res.setHeader('Set-Cookie', sessionCookie(token, maxAge));
        return res.json({
          username: envAdminUser,
          email: `${envAdminUser}@cellarflow.com`,
          fullName: 'Master Administrator',
          role: 'Owner/Admin',
          language: 'en',
          enabledModules: ['vazi', 'gvino'],
          enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks', 'audit']
        });
      }
    }
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  
  const user = db.users.find(u => u.username === identifier || u.email === identifier);
  if (!user || !verifyPassword(passcode, user.passwordHash)) {
    await loginLimiter.recordFailure(limiterKey);
    return res.status(401).json({ error: 'Invalid username or passcode' });
  }

  // Block sign-in until the email is confirmed (legacy accounts without the
  // field are treated as verified, so they are never locked out).
  if ((user as any).emailVerified === false) {
    await loginLimiter.clear(limiterKey);
    return res.status(403).json({
      error: 'Please verify your email before signing in. Check your inbox for the confirmation link.',
      code: 'email_unverified',
    });
  }

  await loginLimiter.clear(limiterKey);
  const token = createSessionToken({ username: user.username, role: user.role }, rememberMe);
  const maxAge = rememberMe ? 2592000 : 86400; // 30 days vs 24 hours
  res.setHeader('Set-Cookie', sessionCookie(token, maxAge));
  res.json({
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    language: user.language,
    enabledModules: (user as any).enabledModules || ['vazi', 'gvino'],
    enabledWidgets: (user as any).enabledWidgets || ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks']
  });
});

app.post('/api/auth/demo', async (_req, res) => {
  if (!demoAccountConfig.enabled) {
    return res.status(404).json({ error: 'Demo login is not enabled for this deployment.' });
  }

  try {
    const user = await ensureDemoAccount();
    if (!user) return res.status(404).json({ error: 'Demo login is unavailable.' });

    const token = createSessionToken({ username: user.username, role: user.role }, false);
    res.setHeader('Set-Cookie', sessionCookie(token, 86400));
    res.json({
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      language: user.language,
      enabledModules: user.enabledModules,
      enabledWidgets: user.enabledWidgets,
      isDemo: true,
    });
  } catch (err) {
    console.error('Demo login failed:', err);
    res.status(500).json({ error: 'Demo workspace could not be opened.' });
  }
});

const getRedirectUri = (req: any) => {
  return `${appBaseUrl(req)}/api/auth/google/callback`;
};

app.get('/api/auth/google/login', (req, res) => {
  const db = getDB() as any;
  const { clientId, clientSecret } = getGoogleOAuthCreds(db);
  
  const reconfigure = req.query.reset === 'true' || req.query.reconfigure === 'true';
  const redirectUri = getRedirectUri(req);
  const runtimeConfigAllowed = isRuntimeOAuthConfigAllowed();

  if ((!clientId || !clientSecret || reconfigure) && !runtimeConfigAllowed) {
    const message = oauthConfigBlockedMessage();
    res.status(reconfigure ? 403 : 503).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google OAuth2 Setup Locked</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8f6f2; color: #1b1715; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: white; border: 1px solid #e8dfd5; padding: 36px; border-radius: 20px; max-width: 680px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.03); box-sizing: border-box; }
          h1 { font-family: Georgia, serif; color: #4e0e15; margin-top: 0; }
          pre { background: #f0ebe4; padding: 15px; border-radius: 10px; font-family: monospace; overflow-x: auto; font-size: 12px; margin: 15px 0; line-height: 1.5; }
          .notice { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; padding: 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; }
          a { color: #4e0e15; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Google OAuth2 Setup Locked</h1>
          <div class="notice"><strong>Production safety:</strong> ${message}</div>
          <p>Use these production configuration names:</p>
          <pre>GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET</pre>
          <p>Authorized redirect URI:</p>
          <pre>${redirectUri}</pre>
          <p>If you intentionally need runtime setup for a private maintenance window, deploy with <code>ALLOW_RUNTIME_OAUTH_CONFIG=true</code>, update credentials, then disable it again.</p>
          <p><a href="/">Return to app</a></p>
        </div>
      </body>
      </html>
    `);
    return;
  }
  
  if (!clientId || !clientSecret || reconfigure) {
    const displayClientId = db.googleConfig?.clientId || '';
    const displayClientSecret = db.googleConfig?.clientSecret || '';

    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google OAuth2 Setup Required</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8f6f2; color: #1b1715; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: white; border: 1px solid #e8dfd5; padding: 40px; border-radius: 20px; max-width: 600px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.03); box-sizing: border-box; }
          h1 { font-family: Georgia, serif; color: #4e0e15; margin-top: 0; }
          pre { background: #f0ebe4; padding: 15px; border-radius: 10px; font-family: monospace; overflow-x: auto; font-size: 13px; margin: 15px 0; line-height: 1.5; }
          ol { padding-left: 20px; line-height: 1.6; font-size: 14px; }
          li { margin-bottom: 10px; }
          .btn { display: inline-block; background: #4e0e15; color: white; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-weight: bold; border: none; font-size: 13px; cursor: pointer; transition: background 0.2s; font-family: sans-serif; }
          .btn:hover { background: #681820; }
          .form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 15px; }
          .form-group label { font-size: 11px; text-transform: uppercase; font-family: monospace; font-weight: bold; color: #8c7f76; }
          .form-group input { padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-family: monospace; width: 100%; box-sizing: border-box; outline: none; background: #fcfbfa; }
          .form-group input:focus { border-color: #4e0e15; background: white; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Google OAuth2 Credentials Setup</h1>
          <p>The application requires <strong>GOOGLE_CLIENT_ID</strong> and <strong>GOOGLE_CLIENT_SECRET</strong> to be configured for Google Sign-In to function.</p>
          
          <div style="background: #fef2f2; border: 1px solid #fee2e2; color: #991b1b; padding: 15px; border-radius: 12px; font-size: 13px; margin: 15px 0; line-height: 1.5; font-family: sans-serif;">
            <strong>Warning:</strong> If you get a <code>401: invalid_client</code> error on the Google page, the Client ID is incorrect, has trailing spaces, or is not yet propagated in Google Cloud Console. Double check your settings below.
          </div>

          <div style="background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; padding: 15px; border-radius: 12px; font-size: 13px; margin: 15px 0; line-height: 1.5; font-family: sans-serif;">
            <strong>💡 Google Cloud Run (Stateless Deployment) Note:</strong> 
            Since Cloud Run container storage is ephemeral, saving to <code>db.json</code> will be wiped whenever the container restarts or scales down. To save credentials permanently, configure them as environment variables in Cloud Run:
            <pre style="background: #dbeafe; border: 1px solid #bfdbfe; padding: 10px; border-radius: 6px; font-family: monospace; overflow-x: auto; font-size: 11px; margin-top: 8px; font-weight: bold; white-space: pre-wrap; word-break: break-all;">gcloud run deploy cellarflow-app --set-env-vars GOOGLE_CLIENT_ID="YOUR_CLIENT_ID",GOOGLE_CLIENT_SECRET="YOUR_CLIENT_SECRET" --region europe-west1</pre>
          </div>

          <p>Please follow these setup steps:</p>
          <ol>
            <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" style="color: #4e0e15; font-weight: bold; text-decoration: underline;">Google Cloud Console</a>.</li>
            <li>Create a new project or select an existing one.</li>
            <li>Configure the <strong>OAuth Consent Screen</strong> (scopes: <code>openid</code>, <code>email</code>, <code>profile</code>).</li>
            <li>Go to <strong>Credentials > Create Credentials > OAuth client ID</strong> (Application type: <strong>Web application</strong>).</li>
            <li>Add the following Authorized Redirect URI:
              <pre>${redirectUri}</pre>
            </li>
          </ol>
          
          <h2 style="font-family: Georgia, serif; color: #4e0e15; margin-top: 30px; font-size: 18px; border-top: 1px solid #e8dfd5; padding-top: 25px; margin-bottom: 15px;">Configure & Save Credentials</h2>
          <p style="font-size: 13px; color: #666; margin-bottom: 20px;">You can save your credentials directly to the local database file (<code>db.json</code>) and local <code>.env</code> file. They will be persisted securely across app updates and restarts.</p>
          <form action="/api/auth/google/configure" method="POST">
            <div class="form-group">
              <label>Google Client ID</label>
              <input type="text" name="clientId" required value="${displayClientId}" placeholder="e.g. xxxxx.apps.googleusercontent.com" />
            </div>
            <div class="form-group">
              <label>Google Client Secret</label>
              <input type="password" name="clientSecret" required value="${displayClientSecret}" placeholder="e.g. GOCSPX-xxxxx" />
            </div>
            <div style="display: flex; gap: 15px; align-items: center; margin-top: 10px;">
              <button type="submit" class="btn">Save & Continue to Google</button>
              <a href="/" style="color: #666; text-decoration: none; font-size: 13px; font-weight: bold; font-family: sans-serif;">Cancel</a>
            </div>
          </form>
        </div>
      </body>
      </html>
    `);
    return;
  }
  
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
    `response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=openid%20email%20profile` +
    `&access_type=offline` +
    `&prompt=consent`;
    
  res.redirect(authUrl);
});

app.post('/api/auth/google/configure', (req, res) => {
  if (!isRuntimeOAuthConfigAllowed()) {
    return res.status(403).send(oauthConfigBlockedMessage());
  }

  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).send('Client ID and Client Secret are required');
  }
  
  const trimmedClientId = String(clientId).trim();
  const trimmedClientSecret = String(clientSecret).trim();
  
  const db = getDB() as any;
  db.googleConfig = {
    clientId: trimmedClientId,
    clientSecret: trimmedClientSecret
  };
  saveDB();
  
  // Write to .env file as well to persist locally across restarts
  updateEnvFile({
    GOOGLE_CLIENT_ID: trimmedClientId,
    GOOGLE_CLIENT_SECRET: trimmedClientSecret
  });
  
  res.redirect('/api/auth/google/login');
});

app.get('/api/dev/seed-testuser1', async (req, res) => {
  // Demo seeding replaces the whole organization dataset — anyone-can-GET is
  // fine on a dev machine but must be master-admin-only in production.
  if (process.env.NODE_ENV === 'production') {
    const auth = await requireMasterAdmin(req, res);
    if (!auth) return;
    recordAdminAction(auth.username, 'seed.testuser1');
  }
  try {
    await refreshCoreMetadataFromPostgres();
    const db = getDB();
    const user = db.users.find(u => u.username === 'testuser1');
    if (!user) {
      return res.status(404).send('User testuser1 not found in core database. Please ensure they have signed up first.');
    }

    let orgId = user.activeOrganizationId;
    if (!orgId) {
      const membership = db.memberships.find(m => m.userId === user.username);
      if (membership) {
        orgId = membership.organizationId;
      }
    }

    if (!orgId) {
      orgId = `org_testuser1`;
      const newOrg = { id: orgId, name: 'ყვარლის სადემონსტრაციო მარანი' };
      const newMembership = {
        id: `mem_testuser1`,
        userId: user.username,
        organizationId: orgId,
        role: 'Owner/Admin'
      };
      db.organizations.push(newOrg);
      db.memberships.push(newMembership);
      user.activeOrganizationId = orgId;
    }

    user.language = 'ka';
    await saveCoreMetadata('seed-testuser1');

    const seededData = getSeederData(orgId);
    db.orgData[orgId] = seededData;
    
    // Save organizational data using standard persistence routine
    await saveUserData('testuser1', seededData, { updatedBy: 'seed-testuser1' });

    // The strict round-trip check only applies when PostgreSQL is the active
    // backend; on the GCS/local JSON fallback `reload...` returns null even
    // though saveUserData persisted the seed — failing there was a bug.
    const persisted = await reloadOrganizationDataFromPostgres(orgId);
    if (persisted) {
      const persistedData = persisted.data;
      const expectedHarvestIds = new Set(seededData.harvests.map((item: any) => item.id));
      const expectedSamplingIds = new Set(seededData.samplings.map((item: any) => item.id));
      const lotIds = new Set(seededData.lots.map((lot: any) => lot.id));
      const persistedMatchesSeed = Boolean(
        persistedData.lots.length === seededData.lots.length &&
        persistedData.harvests.length === seededData.harvests.length &&
        persistedData.samplings.length === seededData.samplings.length &&
        persistedData.grapeIntakes.every((intake: any) => lotIds.has(intake.createdLotId)) &&
        persistedData.harvests.every((item: any) => expectedHarvestIds.has(item.id)) &&
        persistedData.samplings.every((item: any) => expectedSamplingIds.has(item.id))
      );
      if (!persistedMatchesSeed) {
        throw new Error('Seed data was generated but did not persist exactly to PostgreSQL. Please retry after the deployment is warm.');
      }
    }

    res.status(200).send(`Successfully seeded Kvareli demonstration data into organization [${orgId}] for testuser1 (backend: ${persisted ? 'postgres' : 'json-fallback'}).`);
  } catch (err) {
    console.error('Failed to seed testuser1:', err);
    res.status(500).send(`Seeding failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});


app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Authorization code missing');
  }
  
  const db = getDB() as any;
  const { clientId, clientSecret } = getGoogleOAuthCreds(db);
  const redirectUri = getRedirectUri(req);
  
  try {
    // 1. Exchange auth code for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId || '',
        client_secret: clientSecret || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }).toString()
    });
    
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Google token exchange failed:', errText);
      return res.status(tokenRes.status).send(`Failed to exchange code: ${errText}`);
    }
    
    const tokenData = await tokenRes.json() as any;
    const accessToken = tokenData.access_token;
    
    // 2. Fetch user information using access token
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!userinfoRes.ok) {
      const errText = await userinfoRes.text();
      console.error('Google userinfo fetch failed:', errText);
      return res.status(userinfoRes.status).send(`Failed to fetch userinfo: ${errText}`);
    }
    
    const userinfo = await userinfoRes.json() as any;
    const email = userinfo.email;
    const fullName = userinfo.name || 'Google User';
    
    if (!email) {
      return res.status(400).send('Email not returned by Google');
    }
    
    // 3. Find or register the user in the database
    await refreshCoreMetadataFromPostgres();
    const db = getDB();
    const cleanEmail = email.toLowerCase().trim();
    let user = db.users.find(u => u.email.toLowerCase().trim() === cleanEmail);
    
    let username = '';
    if (user) {
      username = user.username;
    } else {
      // Create a unique username based on the email prefix
      const emailPrefix = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
      let baseUsername = emailPrefix || 'google_user';
      username = baseUsername;
      
      let suffix = 1;
      while (db.users.some(u => u.username === username)) {
        username = `${baseUsername}_${suffix}`;
        suffix++;
      }
      
      user = {
        username,
        email: cleanEmail,
        fullName,
        role: 'Owner/Admin',
        language: 'en',
        passwordHash: '',
        enabledModules: ['vazi', 'gvino'],
        enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks'],
        // Google has already verified ownership of this email address.
        emailVerified: true,
      };
      const orgId = 'org_' + Math.random().toString(36).substr(2, 9);
      const org = { id: orgId, name: `${fullName || username}'s Estate` };
      const membership = { id: 'mem_' + Math.random().toString(36).substr(2, 9), userId: username, organizationId: orgId, role: 'Owner/Admin' };
      user.activeOrganizationId = orgId;
      
      if (!db.organizations) db.organizations = [];
      if (!db.memberships) db.memberships = [];
      if (!db.orgData) db.orgData = {};
      db.organizations.push(org);
      db.memberships.push(membership);
      db.orgData[orgId] = createEmptyUserData();
      db.users.push(user);
      await saveCoreMetadata('auth-google-register');
      await saveUserData(username, db.orgData[orgId]);
    }
    
    // 4. Create and set session cookie
    const token = createSessionToken({ username: user.username, role: user.role }, true);
    res.setHeader('Set-Cookie', sessionCookie(token, 2592000));
    
    // Redirect to main site
    res.redirect('/');
  } catch (err) {
    console.error('OAuth2 callback error:', err);
    res.status(500).send('OAuth2 flow failed');
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['maranios_session'];
  const session = verifySessionToken(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const envAdmin = cleanEnv(process.env.ADMIN_USERNAME).toLowerCase();
  if (envAdmin && String(session.username).trim().toLowerCase() === envAdmin) {
    return res.json({
      username: session.username,
      email: `${session.username}@cellarflow.com`,
      fullName: 'Master Administrator',
      role: 'Owner/Admin',
      language: 'en',
      enabledModules: ['vazi', 'gvino'],
      enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks', 'audit']
    });
  }
  
  const db = getDB();
  const user = db.users.find(u => u.username === session.username);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  
  res.json({
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    language: user.language,
    enabledModules: (user as any).enabledModules || ['vazi', 'gvino'],
    enabledWidgets: (user as any).enabledWidgets || ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks'],
    // Present only while a master admin is viewing this account (support mode).
    ...(session.impersonatedBy ? { impersonatedBy: session.impersonatedBy } : {})
  });
});


app.post('/api/auth/update_profile', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['maranios_session'];
  const session = verifySessionToken(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const db = getDB();
  const user = db.users.find(u => u.username === session.username);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  
  const { fullName, language, enabledModules, enabledWidgets } = req.body;
  if (fullName !== undefined) user.fullName = fullName;
  if (language !== undefined) user.language = language;
  if (enabledModules !== undefined) (user as any).enabledModules = enabledModules;
  if (enabledWidgets !== undefined) (user as any).enabledWidgets = enabledWidgets;
  
  await saveCoreMetadata('auth-update-profile');
  
  res.json({
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    language: user.language,
    enabledModules: (user as any).enabledModules,
    enabledWidgets: (user as any).enabledWidgets
  });
});

app.post('/api/org/invite', async (req, res) => {
  const session = await requireCapability(req, res, 'manage_users');
  if (!session) return;

  const { email, role } = req.body;
  if (!email || !role) {
    return res.status(400).json({ error: 'Email and role are required' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === session.username);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  const orgId = user.activeOrganizationId;
  if (!orgId) {
    return res.status(400).json({ error: 'User has no active organization' });
  }

  const org = db.organizations?.find(o => o.id === orgId);
  const cleanEmail = String(email).toLowerCase().trim();

  // Generate a secure token
  const token = generateVerificationToken().token;
  const inviteId = 'invite_' + Math.random().toString(36).substr(2, 9);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  const invitation = {
    id: inviteId,
    email: cleanEmail,
    organizationId: orgId,
    role: role,
    token: token,
    expiresAt: expiresAt.toISOString(),
    acceptedAt: null,
  };

  if (!db.invitations) db.invitations = [];
  db.invitations.push(invitation);
  await saveCoreMetadata('org-invite-create');

  const link = `${appBaseUrl(req)}/accept-invite?token=${token}`;
  const mail = await sendMail(buildInvitationEmail({
    to: cleanEmail,
    inviterName: user.fullName,
    orgName: org?.name || 'VinOS Estate',
    link,
    lang: user.language
  }));

  if (exposeVerifyLink(mail.transport)) {
    return res.json({ ok: true, devInviteUrl: link });
  }

  res.json({ ok: true });
});

app.get('/api/org/invitations/:token', async (req, res) => {
  const { token } = req.params;
  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const invite = db.invitations?.find(i => i.token === token);

  if (!invite) {
    return res.status(404).json({ error: 'Invitation not found' });
  }
  if (invite.acceptedAt) {
    return res.status(400).json({ error: 'Invitation has already been accepted' });
  }
  if (new Date(invite.expiresAt) < new Date()) {
    return res.status(400).json({ error: 'Invitation has expired' });
  }

  const org = db.organizations?.find(o => o.id === invite.organizationId);
  res.json({
    email: invite.email,
    role: invite.role,
    orgName: org?.name || 'VinOS Estate',
  });
});

app.post('/api/org/accept-invite', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Invitation token is required' });
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies['maranios_session'];
  const session = verifySessionToken(sessionToken);

  if (!session) {
    return res.status(401).json({ error: 'Authentication required. Please sign in or register to accept the invitation.' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const invite = db.invitations?.find(i => i.token === token);

  if (!invite) {
    return res.status(404).json({ error: 'Invitation not found' });
  }
  if (invite.acceptedAt) {
    return res.status(400).json({ error: 'Invitation has already been accepted' });
  }
  if (new Date(invite.expiresAt) < new Date()) {
    return res.status(400).json({ error: 'Invitation has expired' });
  }

  const user = db.users.find(u => u.username === session.username);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  // Create membership
  const memId = 'mem_' + Math.random().toString(36).substr(2, 9);
  const membership = {
    id: memId,
    userId: user.username,
    organizationId: invite.organizationId,
    role: invite.role
  };

  if (!db.memberships) db.memberships = [];
  
  // Check if already a member
  const alreadyMember = db.memberships.some(m => m.userId === user.username && m.organizationId === invite.organizationId);
  if (!alreadyMember) {
    db.memberships.push(membership);
  }

  // Mark invitation as accepted
  invite.acceptedAt = new Date().toISOString();
  user.activeOrganizationId = invite.organizationId;
  await saveCoreMetadata('org-invite-accept');

  res.json({ ok: true, activeOrganizationId: invite.organizationId });
});

app.post('/api/org/switch', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies['maranios_session'];
  const session = verifySessionToken(sessionToken);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { organizationId } = req.body;
  if (!organizationId) {
    return res.status(400).json({ error: 'Organization ID is required' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === session.username);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  // Verify the user is a member of this organization
  const isMember = db.memberships?.some(m => m.userId === user.username && m.organizationId === organizationId);
  if (!isMember) {
    return res.status(403).json({ error: 'You are not a member of this organization' });
  }

  user.activeOrganizationId = organizationId;
  await saveCoreMetadata('org-switch');

  // Also update session cookie with the new active organization role if it changed
  const membership = db.memberships.find(m => m.userId === user.username && m.organizationId === organizationId);
  const newToken = createSessionToken({ username: user.username, role: membership.role }, true);
  res.setHeader('Set-Cookie', sessionCookie(newToken, 2592000));

  res.json({ ok: true, activeOrganizationId: organizationId });
});

// ── Master Admin Endpoints ──────────────────────────────────────────

function scrubSensitiveForExport(value: any): any {
  if (Array.isArray(value)) {
    return value.map(item => scrubSensitiveForExport(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sensitiveKey = /password|passcode|secret|token|api[_-]?key/i;
  const cleaned: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) continue;
    cleaned[key] = scrubSensitiveForExport(child);
  }
  return cleaned;
}

function exportFilename(prefix: string): string {
  return `${prefix}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

app.get('/api/admin/system-health', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const memoryUsage = process.memoryUsage();
  const dbStatus = getDbRuntimeStatus();
  const postgresReadiness = await getPostgresReadinessProbe();
  const deployment = applyRuntimeScaleReadinessProbe(getDeploymentStatus(), postgresReadiness);
  res.json({
    ok: dbStatus.ok && deployment.ok && postgresReadiness.ok,
    checkedAt: new Date().toISOString(),
    db: {
      ...dbStatus,
      postgresReadiness,
    },
    deployment,
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryHeapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      memoryHeapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      nodeVersion: process.version,
      platform: process.platform,
    },
    actions: {
      exportUrl: '/api/admin/export',
      forceSaveAction: 'save_db',
    },
  });
});

app.get('/api/admin/export', async (req, res) => {
  const auth = await requireCapability(req, res, 'admin');
  if (!auth) return;

  const db = getDB();
  const exportedAt = new Date().toISOString();
  let snapshot: any;
  let filename = exportFilename('cellarflow_export');

  if (isMasterAdmin(auth.username)) {
    snapshot = {
      exportedAt,
      scope: 'system',
      db: scrubSensitiveForExport(db),
    };
    delete snapshot.db.userData;
    filename = exportFilename('cellarflow_system_export');
  } else {
    const user = db.users.find(u => u.username === auth.username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const orgId = user.activeOrganizationId;
    if (!orgId) {
      return res.status(400).json({ error: 'No active organization to export' });
    }
    const organization = db.organizations?.find(o => o.id === orgId);
    const memberships = db.memberships?.filter(m => m.organizationId === orgId) || [];
    const invitations = db.invitations?.filter(i => i.organizationId === orgId) || [];
    snapshot = {
      exportedAt,
      scope: 'organization',
      organization: scrubSensitiveForExport(organization || { id: orgId, name: 'Unnamed Winery' }),
      currentUser: scrubSensitiveForExport(user),
      members: memberships.map(m => ({
        ...scrubSensitiveForExport(m),
        user: scrubSensitiveForExport(db.users.find(u => u.username === m.userId) || null),
      })),
      pendingInvitations: scrubSensitiveForExport(invitations),
      data: scrubSensitiveForExport(db.orgData?.[orgId] || createEmptyUserData()),
    };
    filename = exportFilename(`cellarflow_${orgId}_export`);
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(snapshot, null, 2));
});

app.get('/api/admin/stats', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const db = getDB();
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();
  const dbStatus = getDbRuntimeStatus();

  res.json({
    ok: true,
    usersCount: db.users.length,
    orgsCount: db.organizations?.length || 0,
    membershipsCount: db.memberships?.length || 0,
    invitationsCount: db.invitations?.length || 0,
    memoryHeapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    memoryHeapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    memoryRssMB: Math.round(memoryUsage.rss / 1024 / 1024),
    eventLoopLagMs,
    uptimeSeconds: Math.round(uptime),
    persistenceMode: dbStatus.activeBackendLabel,
    nodeEnv: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/admin/users', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const db = getDB();
  const usersWithOrgs = db.users.map(u => {
    const userMemberships = db.memberships?.filter(m => m.userId === u.username) || [];
    const orgs = userMemberships.map(m => {
      const org = db.organizations?.find(o => o.id === m.organizationId);
      return {
        id: m.organizationId,
        name: org?.name || 'Unknown',
        role: m.role
      };
    });

    return {
      id: u.id,
      username: u.username,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      emailVerified: u.emailVerified,
      isDemo: u.isDemo,
      createdAt: u.createdAt,
      organizations: orgs
    };
  });

  res.json({ ok: true, users: usersWithOrgs });
});

app.post('/api/admin/users/update', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const { username, email, role, emailVerified, passcode } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const db = getDB();
  const user = db.users.find(u => u.username === username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (email !== undefined) {
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const duplicate = db.users.find(u => u.email === email && u.username !== username);
    if (duplicate) {
      return res.status(400).json({ error: 'Email address already in use' });
    }
    user.email = email;
  }

  if (role !== undefined) {
    user.role = role;
  }

  if (emailVerified !== undefined) {
    user.emailVerified = !!emailVerified;
  }

  if (passcode !== undefined) {
    const trimmed = String(passcode).trim();
    if (trimmed.length < 4) {
      return res.status(400).json({ error: 'Passcode must be at least 4 characters long' });
    }
    user.passwordHash = await hashPassword(trimmed);
  }

  await saveCoreMetadata('admin-user-update');
  const changed = [
    email !== undefined ? 'email' : '',
    role !== undefined ? 'role' : '',
    emailVerified !== undefined ? 'emailVerified' : '',
    passcode !== undefined ? 'passcode' : '',
  ].filter(Boolean).join(', ');
  recordAdminAction(auth.username, 'user.update', username, changed);
  res.json({ ok: true, message: 'User updated successfully' });
});

app.post('/api/admin/users/delete', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const envAdmin = cleanEnv(process.env.ADMIN_USERNAME) || 'admin';
  if (username.trim().toLowerCase() === envAdmin.toLowerCase()) {
    return res.status(400).json({ error: 'Cannot delete the master administrator' });
  }

  const db = getDB();
  const userIndex = db.users.findIndex(u => u.username === username);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Remove memberships
  if (db.memberships) {
    db.memberships = db.memberships.filter(m => m.userId !== username);
  }

  // Delete user
  db.users.splice(userIndex, 1);
  await deleteUserMetadataFromPostgres(username);
  await saveCoreMetadata('admin-user-delete');

  recordAdminAction(auth.username, 'user.delete', username);
  res.json({ ok: true, message: 'User deleted successfully' });
});

app.get('/api/admin/orgs', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const db = getDB();
  const orgList = db.organizations?.map(org => {
    const members = db.memberships?.filter(m => m.organizationId === org.id) || [];
    const orgData = db.orgData?.[org.id] || {};
    const tanksCount = orgData.vessels?.length || 0;
    const lotsCount = orgData.lots?.length || 0;
    const dataSize = JSON.stringify(orgData).length;

    return {
      id: org.id,
      name: org.name,
      createdAt: org.createdAt,
      membersCount: members.length,
      tanksCount,
      lotsCount,
      dataSize
    };
  }) || [];

  res.json({ ok: true, organizations: orgList });
});

app.post('/api/admin/system-action', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const { action } = req.body;
  if (!action) {
    return res.status(400).json({ error: 'Action is required' });
  }

  if (action === 'save_db') {
    try {
      recordAdminAction(auth.username, 'system.save_db');
      const status = await forceSaveDB();
      return res.json({
        ok: status.ok,
        message: status.postgres.usable
          ? 'Database snapshot durably saved to PostgreSQL JSONB and backup mirror checked'
          : status.json.gcsEnabled
            ? 'Database snapshot durably saved to JSON fallback and GCS backup'
            : 'Database snapshot saved to local JSON fallback',
        status,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Durable save failed',
        status: getDbRuntimeStatus(),
      });
    }
  }

  res.status(400).json({ error: 'Unknown system action' });
});

// ── Master-admin action trail ────────────────────────────────────────────────
app.get('/api/admin/actions', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  res.json({ ok: true, actions: adminActions });
});

// ── Impersonation ("view as") ────────────────────────────────────────────────
// The support session token carries BOTH identities: it acts as the target user
// while `impersonatedBy` marks the responsible admin. Short-lived cookie.
app.post('/api/admin/impersonate', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const target = String(req.body?.username || '').trim();
  if (!target) return res.status(400).json({ error: 'Username is required' });
  if (isMasterAdmin(target)) {
    return res.status(400).json({ error: 'Cannot impersonate the master administrator' });
  }

  const db = getDB();
  const user = db.users.find(u => u.username === target);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const token = createSessionToken(
    { username: user.username, role: user.role, impersonatedBy: auth.username },
    false,
  );
  res.setHeader('Set-Cookie', sessionCookie(token, 3600)); // 1-hour support window
  recordAdminAction(auth.username, 'impersonate.start', target);
  res.json({ ok: true, username: user.username, fullName: user.fullName });
});

// Exiting impersonation only requires the impersonation cookie itself: the
// claim proves a master admin started it, so the admin session is restored
// without re-entering credentials.
app.post('/api/admin/impersonate/stop', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies['maranios_session']);
  if (!session || !session.impersonatedBy) {
    return res.status(400).json({ error: 'Not in an impersonation session' });
  }
  if (!isMasterAdmin(String(session.impersonatedBy))) {
    return res.status(403).json({ error: 'Impersonation origin is no longer the master administrator' });
  }

  const adminToken = createSessionToken({ username: session.impersonatedBy, role: 'Owner/Admin' }, false);
  res.setHeader('Set-Cookie', sessionCookie(adminToken, 86400));
  recordAdminAction(String(session.impersonatedBy), 'impersonate.stop', String(session.username));
  res.json({ ok: true, username: session.impersonatedBy });
});

// ── Login lockouts (brute-force limiter state) ───────────────────────────────
app.get('/api/admin/lockouts', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const entries = await loginLimiter.list();
  res.json({ ok: true, backend: loginLimiter.backend(), entries });
});

app.post('/api/admin/lockouts/clear', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const key = String(req.body?.key || '').trim();
  if (!key) return res.status(400).json({ error: 'Lockout key is required' });
  await loginLimiter.clear(key);
  recordAdminAction(auth.username, 'lockout.clear', key);
  res.json({ ok: true });
});

// ── Outbound email check ─────────────────────────────────────────────────────
app.post('/api/admin/test-email', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const to = String(req.body?.to || '').trim();
  if (!isValidEmail(to)) return res.status(400).json({ error: 'A valid recipient email is required' });

  const result = await sendMail({
    to,
    subject: 'VinOS — delivery test',
    text: `This is a delivery test from the VinOS admin console, requested by ${auth.username} at ${new Date().toISOString()}. If you received it, outbound email works.`,
  });
  recordAdminAction(auth.username, 'email.test', to, `transport=${result.transport}`);
  res.json({ ok: true, delivered: result.delivered, transport: result.transport });
});

// ── Organization data inspector ──────────────────────────────────────────────
// Per-collection record counts + freshness for any winery, without exposing the
// records themselves in the console.
app.get('/api/admin/orgs/inspect', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const orgId = String(req.query.id || '').trim();
  if (!orgId) return res.status(400).json({ error: 'Organization id is required' });

  const db = getDB();
  const org = db.organizations?.find(o => o.id === orgId);
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const data: any = db.orgData?.[orgId] || {};
  const collections: Array<{ key: string; count: number; lastModified: string | null }> = [];
  let lastActivity: string | null = null;

  for (const key of Object.keys(data)) {
    if (!Array.isArray(data[key])) continue;
    let newest: string | null = null;
    for (const item of data[key]) {
      const lm = item?.lastModified;
      if (typeof lm === 'string' && (!newest || lm > newest)) newest = lm;
    }
    if (newest && (!lastActivity || newest > lastActivity)) lastActivity = newest;
    collections.push({ key, count: data[key].length, lastModified: newest });
  }
  collections.sort((a, b) => b.count - a.count);

  const members = db.memberships?.filter(m => m.organizationId === orgId) || [];
  res.json({
    ok: true,
    organization: { id: org.id, name: org.name, createdAt: org.createdAt },
    wineryName: data.companyProfile?.wineryName || data.companyProfile?.companyName || '',
    members: members.map(m => ({ username: m.userId, role: m.role })),
    dataSizeBytes: JSON.stringify(data).length,
    lastActivity,
    collections,
  });
});


app.get('/api/org/members', async (req, res) => {
  const session = await requireCapability(req, res, 'read');
  if (!session) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === session.username);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const orgId = user.activeOrganizationId;
  if (!orgId) return res.status(400).json({ error: 'No active organization' });

  const memberships = db.memberships?.filter(m => m.organizationId === orgId) || [];
  const members = memberships.map(m => {
    const u = db.users.find(usr => usr.username === m.userId);
    return {
      username: m.userId,
      fullName: u?.fullName || m.userId,
      email: u?.email || '',
      role: m.role,
    };
  });

  const pendingInvites = db.invitations?.filter(i => i.organizationId === orgId && !i.acceptedAt && new Date(i.expiresAt) > new Date()) || [];

  res.json({ members, pendingInvites });
});

app.get('/api/org/list', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies['maranios_session'];
  const session = verifySessionToken(sessionToken);

  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === session.username);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const userMemberships = db.memberships?.filter(m => m.userId === user.username) || [];
  const orgs = userMemberships.map(m => {
    const org = db.organizations?.find(o => o.id === m.organizationId);
    return {
      id: m.organizationId,
      name: org?.name || 'Unnamed Winery',
      role: m.role,
      isActive: m.organizationId === user.activeOrganizationId,
    };
  });

  res.json(orgs);
});

// Administrative database reset endpoint
app.post('/api/admin/reset', async (req, res) => {
  // Destructive — requires the live 'admin' capability (Owner/Admin only).
  const session = await requireCapability(req, res, 'admin');
  if (!session) return;

  const emptyData = await resetUserData(session.username);
  res.json(emptyData);
});

// Sync endpoint
app.post('/api/sync', async (req, res) => {
  // Authoritative role check (resolved from the DB, not the login-time token).
  const session = await requireCapability(req, res, 'write');
  if (!session) return;

  const refreshed = await reloadUserOrganizationDataFromPostgres(session.username);
  const expectedOrgStateVersion = refreshed?.meta.version ?? null;
  const userDb = refreshed?.data || await getUserData(session.username) || createEmptyUserData();

  const { deletedIds, ...collections } = req.body;

  try {
    // 1. Validate deletedIds syntax & block deletions of bottled lots or audit logs
    if (deletedIds !== undefined) {
      if (!Array.isArray(deletedIds)) {
        throw new Error('deletedIds must be an array');
      }
      for (const id of deletedIds) {
        if (!isValidId(id)) {
          throw new Error(`Invalid deleted ID syntax: ${id}`);
        }
        // Volatile Content Lock
        const existingLot = userDb.lots.find((l: any) => l.id === id);
        if (existingLot && existingLot.stage === 'bottled') {
          throw new Error(`Volatile Content Lock: Bottled wine lot ${id} cannot be deleted.`);
        }
        // Audit Immutability
        const existingAudit = userDb.auditLogs.find((l: any) => l.id === id);
        if (existingAudit) {
          throw new Error(`Audit Immutability: Deletion of audit log ${id} is forbidden.`);
        }
      }
    }

    // 2. Validate collections syntax and schema integrity
    for (const key of Object.keys(collections)) {
      if (key === 'users') {
        throw new Error('Modifying user credentials via sync is forbidden');
      }
      if (key === 'companyProfile') {
        const profile = collections[key];
        if (profile && typeof profile === 'object') {
          if (profile.latitude !== undefined && typeof profile.latitude !== 'number') {
            throw new Error('companyProfile latitude must be a number');
          }
          if (profile.longitude !== undefined && typeof profile.longitude !== 'number') {
            throw new Error('companyProfile longitude must be a number');
          }
        }
        continue;
      }
      if (key === 'winePricing') {
        const pricing = collections[key];
        if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) {
          throw new Error('winePricing must be an object keyed by lot ID');
        }
        for (const [lotId, price] of Object.entries(pricing)) {
          if (!isValidId(lotId)) {
            throw new Error(`winePricing has invalid lot ID: ${lotId}`);
          }
          if (typeof price !== 'number' || price < 0) {
            throw new Error(`winePricing for ${lotId} must be a non-negative number`);
          }
        }
        continue;
      }
      
      const clientList = collections[key];
      if (clientList !== undefined) {
        if (!Array.isArray(clientList)) {
          throw new Error(`Collection ${key} must be an array of objects`);
        }
        for (const item of clientList) {
          if (!item || typeof item !== 'object') {
            throw new Error(`Items in ${key} must be valid objects`);
          }
          if (!isValidId(item.id)) {
            throw new Error(`Item in ${key} has invalid or missing ID: ${item.id}`);
          }

          // General Time Invariance / Immutable properties check
          const existingItem = (userDb as any)[key]?.find((x: any) => x.id === item.id);
          if (existingItem) {
            if (item.createdAt !== undefined && item.createdAt !== existingItem.createdAt) {
              throw new Error(`Immortal Field Mutation: createdAt cannot be modified on item ${item.id}.`);
            }
            if (item.originalOwnerId !== undefined && item.originalOwnerId !== existingItem.originalOwnerId) {
              throw new Error(`Immortal Field Mutation: originalOwnerId cannot be modified on item ${item.id}.`);
            }
          }

          // Viticulture log referential integrity check (blockId must exist and not be deleted)
          const hasBlockRef = ['scoutings', 'phenologyLogs', 'sprays', 'soilRecords', 'samplings', 'harvests', 'irrigationLogs', 'fertilizerLogs'].includes(key);
          if (hasBlockRef && item.blockId !== undefined) {
            if (!isValidId(item.blockId)) {
              throw new Error(`Item in ${key} has invalid referenced blockId.`);
            }
            const blockExists = userDb.blocks.some((b: any) => b.id === item.blockId) || (collections.blocks && collections.blocks.some((b: any) => b.id === item.blockId));
            const blockDeleted = deletedIds && deletedIds.includes(item.blockId);
            if (!blockExists || blockDeleted) {
              throw new Error(`Orphaned Reference: Item in ${key} references non-existent or deleted Block (${item.blockId}).`);
            }
          }

          if (key === 'vessels') {
            const capacity = item.capacity !== undefined ? item.capacity : (existingItem ? existingItem.capacity : undefined);
            const currentVolume = item.currentVolume !== undefined ? item.currentVolume : (existingItem ? existingItem.currentVolume : undefined);
            const assignedLotId = item.assignedLotId !== undefined ? item.assignedLotId : (existingItem ? existingItem.assignedLotId : undefined);

            if (capacity !== undefined) {
              if (typeof capacity !== 'number' || capacity <= 0) {
                throw new Error(`Vessel ${item.id} capacity must be a positive number.`);
              }
            } else {
              throw new Error(`Vessel ${item.id} must have a capacity.`);
            }

            if (currentVolume !== undefined) {
              if (typeof currentVolume !== 'number' || currentVolume < 0) {
                throw new Error(`Vessel ${item.id} volume cannot be negative.`);
              }
              if (currentVolume > capacity) {
                throw new Error(`Capacity Theft: Vessel ${item.id} volume (${currentVolume}) exceeds physical capacity (${capacity}).`);
              }
            }

            if (assignedLotId !== undefined && assignedLotId !== null) {
              if (!isValidId(assignedLotId)) {
                throw new Error(`Vessel ${item.id} has invalid referenced assignedLotId.`);
              }
              const lotExists = userDb.lots.some((l: any) => l.id === assignedLotId) || (collections.lots && collections.lots.some((l: any) => l.id === assignedLotId));
              const lotDeleted = deletedIds && deletedIds.includes(assignedLotId);
              if (!lotExists || lotDeleted) {
                throw new Error(`Orphaned Reference: Vessel ${item.id} references non-existent or deleted Lot (${assignedLotId}).`);
              }
              
              const lot = userDb.lots.find((l: any) => l.id === assignedLotId) || (collections.lots && collections.lots.find((l: any) => l.id === assignedLotId));
              if (lot && lot.stage === 'bottled') {
                if (existingItem && currentVolume !== undefined && currentVolume < existingItem.currentVolume) {
                  throw new Error(`Volatile Content Lock: Vessel ${item.id} volume containing bottled lot cannot decrease.`);
                }
              }
            }
          }
          
          else if (key === 'lots') {
            const existingLot = existingItem;
            const currentVolume = item.currentVolume !== undefined ? item.currentVolume : (existingLot ? existingLot.currentVolume : undefined);
            const initialVolume = item.initialVolume !== undefined ? item.initialVolume : (existingLot ? existingLot.initialVolume : undefined);

            if (initialVolume !== undefined && (typeof initialVolume !== 'number' || initialVolume < 0)) {
              throw new Error(`Lot ${item.id} initial volume cannot be negative.`);
            }
            if (currentVolume !== undefined && (typeof currentVolume !== 'number' || currentVolume < 0)) {
              throw new Error(`Lot ${item.id} volume cannot be negative.`);
            }

            if (existingLot && existingLot.stage === 'bottled') {
              if (currentVolume !== undefined && currentVolume < existingLot.currentVolume) {
                throw new Error(`Volatile Content Lock: Bottled wine lot ${item.id} volume cannot decrease.`);
              }
              const frozenFields = ['name', 'vintage', 'variety', 'vineyardBlock', 'region', 'wineClass', 'stage'];
              for (const field of frozenFields) {
                if (item[field] !== undefined && item[field] !== existingLot[field]) {
                  throw new Error(`Volatile Content Lock: Bottled wine lot ${item.id} parameter '${field}' is frozen.`);
                }
              }
            }
          }

          else if (key === 'fermlogs') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Fermentation log ${item.id} has invalid referenced lotId.`);
            }
            const hasTankRef = item.tankId !== undefined && item.tankId !== null && item.tankId !== '';
            if (hasTankRef && !isValidId(item.tankId)) {
              throw new Error(`Fermentation log ${item.id} has invalid referenced tankId.`);
            }
            const lotExists = (userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId))) &&
                              !(deletedIds && deletedIds.includes(item.lotId));
            const tankExists = !hasTankRef || ((userDb.vessels.some((v: any) => v.id === item.tankId) || (collections.vessels && collections.vessels.some((v: any) => v.id === item.tankId))) &&
                               !(deletedIds && deletedIds.includes(item.tankId)));
            if (!lotExists || !tankExists) {
              throw new Error(`Orphaned Fermentation: Fermentation log ${item.id} references non-existent or deleted Lot (${item.lotId}) or Vessel (${item.tankId}).`);
            }
            if (item.temperature !== undefined && typeof item.temperature !== 'number') {
              throw new Error(`Fermentation log ${item.id} temperature must be a number`);
            }
            if (item.density !== undefined && (typeof item.density !== 'number' || item.density < 0)) {
              throw new Error(`Fermentation log ${item.id} density cannot be negative`);
            }
            if (item.sugar !== undefined && (typeof item.sugar !== 'number' || item.sugar < 0)) {
              throw new Error(`Fermentation log ${item.id} sugar cannot be negative`);
            }
            if (item.ph !== undefined && (typeof item.ph !== 'number' || item.ph < 0)) {
              throw new Error(`Fermentation log ${item.id} pH cannot be negative`);
            }
          }

          else if (key === 'lablogs') {
            if (!isValidId(item.tankId) || !isValidId(item.lotId)) {
              throw new Error(`Lab analysis ${item.id} has invalid referenced IDs.`);
            }
            const lotExists = (userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId))) &&
                              !(deletedIds && deletedIds.includes(item.lotId));
            const tankExists = (userDb.vessels.some((v: any) => v.id === item.tankId) || (collections.vessels && collections.vessels.some((v: any) => v.id === item.tankId))) &&
                               !(deletedIds && deletedIds.includes(item.tankId));
            if (!lotExists || !tankExists) {
              throw new Error(`Orphaned Lab Log: Lab analysis ${item.id} references non-existent or deleted Lot (${item.lotId}) or Vessel (${item.tankId}).`);
            }
            const checkFields = ['alcoholPct', 'volatileAcid', 'freeSo2', 'totalSo2', 'residualSugar', 'ph', 'malicAcid', 'lacticAcid', 'turbidity', 'titratableAcidity'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Lab analysis ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'inventory') {
            if (item.stock !== undefined && (typeof item.stock !== 'number' || item.stock < 0)) {
              throw new Error(`Inventory item ${item.id} stock cannot be negative.`);
            }
            if (item.minThreshold !== undefined && (typeof item.minThreshold !== 'number' || item.minThreshold < 0)) {
              throw new Error(`Inventory item ${item.id} minThreshold cannot be negative.`);
            }
            if (item.costPerUnit !== undefined && (typeof item.costPerUnit !== 'number' || item.costPerUnit < 0)) {
              throw new Error(`Inventory item ${item.id} costPerUnit cannot be negative.`);
            }
          }

          else if (key === 'bottlingRuns') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Bottling run ${item.id} has invalid referenced lotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const lotDeleted = deletedIds && deletedIds.includes(item.lotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Bottling Run: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }
            const numericFields = ['totalBottles', 'totalCeramic', 'volumeBottledL', 'previousLotVolumeL', 'bottlesPerBox', 'packagingCostTotal', 'bottlingServiceCost', 'placedInStorageBottles'];
            for (const field of numericFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Bottling run ${item.id} property ${field} must be non-negative.`);
              }
            }
            if (item.formats !== undefined) {
              if (!item.formats || typeof item.formats !== 'object' || Array.isArray(item.formats)) {
                throw new Error(`Bottling run ${item.id} formats must be an object.`);
              }
              for (const [format, count] of Object.entries(item.formats)) {
                if (typeof count !== 'number' || count < 0) {
                  throw new Error(`Bottling run ${item.id} format ${format} count must be non-negative.`);
                }
              }
            }
            if (item.packagingMaterialIds !== undefined) {
              if (!item.packagingMaterialIds || typeof item.packagingMaterialIds !== 'object' || Array.isArray(item.packagingMaterialIds)) {
                throw new Error(`Bottling run ${item.id} packagingMaterialIds must be an object.`);
              }
              for (const [component, materialId] of Object.entries(item.packagingMaterialIds)) {
                if (materialId !== undefined && materialId !== null && materialId !== '') {
                  if (!isValidId(materialId)) {
                    throw new Error(`Bottling run ${item.id} has invalid packaging material for ${component}.`);
                  }
                  const materialExists = userDb.inventory.some((i: any) => i.id === materialId) || (collections.inventory && collections.inventory.some((i: any) => i.id === materialId));
                  const materialDeleted = deletedIds && deletedIds.includes(materialId as string);
                  if (!materialExists || materialDeleted) {
                    throw new Error(`Orphaned Bottling Run: ${item.id} references non-existent or deleted packaging material (${materialId}).`);
                  }
                }
              }
            }
            if (item.packagingDeductions !== undefined) {
              if (!item.packagingDeductions || typeof item.packagingDeductions !== 'object' || Array.isArray(item.packagingDeductions)) {
                throw new Error(`Bottling run ${item.id} packagingDeductions must be an object.`);
              }
              for (const [materialId, qty] of Object.entries(item.packagingDeductions)) {
                if (!isValidId(materialId)) {
                  throw new Error(`Bottling run ${item.id} has invalid packaging deduction material ID.`);
                }
                if (typeof qty !== 'number' || qty < 0) {
                  throw new Error(`Bottling run ${item.id} packaging deduction for ${materialId} must be non-negative.`);
                }
              }
            }
            if (item.storageLocationId) {
              if (!isValidId(item.storageLocationId)) {
                throw new Error(`Bottling run ${item.id} has invalid storageLocationId.`);
              }
              const locExists = userDb.storageLocations?.some((l: any) => l.id === item.storageLocationId) || (collections.storageLocations && collections.storageLocations.some((l: any) => l.id === item.storageLocationId));
              if (!locExists) {
                throw new Error(`Orphaned Bottling Run: ${item.id} references non-existent Storage Location (${item.storageLocationId}).`);
              }
            }
            if (item.storageMovementId && !isValidId(item.storageMovementId)) {
              throw new Error(`Bottling run ${item.id} has invalid storageMovementId.`);
            }
          }

          else if (key === 'transfers') {
            const numericFields = ['volume', 'loss'];
            for (const field of numericFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Transfer ${item.id} property ${field} must be non-negative.`);
              }
            }
            if (item.sourceId !== undefined && !isValidId(item.sourceId)) {
              throw new Error(`Transfer ${item.id} has invalid sourceId.`);
            }
            if (item.destId !== undefined && !isValidId(item.destId)) {
              throw new Error(`Transfer ${item.id} has invalid destId.`);
            }
          }

          else if (key === 'grapeIntakes') {
            if (!isValidId(item.createdLotId)) {
              throw new Error(`Grape intake ${item.id} has invalid referenced createdLotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.createdLotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.createdLotId));
            const lotDeleted = deletedIds && deletedIds.includes(item.createdLotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Grape Intake: ${item.id} references non-existent or deleted Lot (${item.createdLotId}).`);
            }

            if (item.source !== undefined && !['own', 'supplier'].includes(item.source)) {
              throw new Error(`Grape intake ${item.id} has invalid source.`);
            }
            if (item.condition !== undefined && !['excellent', 'good', 'fair', 'damaged'].includes(item.condition)) {
              throw new Error(`Grape intake ${item.id} has invalid condition.`);
            }
            if (item.pickingMethod !== undefined && !['hand', 'machine'].includes(item.pickingMethod)) {
              throw new Error(`Grape intake ${item.id} has invalid pickingMethod.`);
            }
            const nonNegativeFields = ['grossWeightKg', 'tareWeightKg', 'netWeightKg', 'brix', 'ph', 'titratableAcidity', 'estimatedVolumeL', 'costPerKg', 'totalCost'];
            for (const field of nonNegativeFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Grape intake ${item.id} property ${field} must be non-negative.`);
              }
            }
            if (item.juiceYieldPct !== undefined && (typeof item.juiceYieldPct !== 'number' || item.juiceYieldPct < 0 || item.juiceYieldPct > 100)) {
              throw new Error(`Grape intake ${item.id} juiceYieldPct must be between 0 and 100.`);
            }
            if (item.destinationVesselId) {
              if (!isValidId(item.destinationVesselId)) {
                throw new Error(`Grape intake ${item.id} has invalid destinationVesselId.`);
              }
              const vesselExists = userDb.vessels.some((v: any) => v.id === item.destinationVesselId) || (collections.vessels && collections.vessels.some((v: any) => v.id === item.destinationVesselId));
              const vesselDeleted = deletedIds && deletedIds.includes(item.destinationVesselId);
              if (!vesselExists || vesselDeleted) {
                throw new Error(`Orphaned Grape Intake: ${item.id} references non-existent or deleted Vessel (${item.destinationVesselId}).`);
              }
            }
            if (item.harvestRecordId) {
              if (!isValidId(item.harvestRecordId)) {
                throw new Error(`Grape intake ${item.id} has invalid harvestRecordId.`);
              }
              const harvestExists = userDb.harvests.some((h: any) => h.id === item.harvestRecordId) || (collections.harvests && collections.harvests.some((h: any) => h.id === item.harvestRecordId));
              const harvestDeleted = deletedIds && deletedIds.includes(item.harvestRecordId);
              if (!harvestExists || harvestDeleted) {
                throw new Error(`Orphaned Grape Intake: ${item.id} references non-existent or deleted Harvest (${item.harvestRecordId}).`);
              }
            }
          }

          else if (key === 'cellarOps') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Cellar operation ${item.id} has invalid referenced lotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const lotDeleted = deletedIds && deletedIds.includes(item.lotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Cellar Operation: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }

            for (const vesselField of ['vesselId', 'vesselToId']) {
              if (item[vesselField]) {
                if (!isValidId(item[vesselField])) {
                  throw new Error(`Cellar operation ${item.id} has invalid ${vesselField}.`);
                }
                const vesselExists = userDb.vessels.some((v: any) => v.id === item[vesselField]) || (collections.vessels && collections.vessels.some((v: any) => v.id === item[vesselField]));
                const vesselDeleted = deletedIds && deletedIds.includes(item[vesselField]);
                if (!vesselExists || vesselDeleted) {
                  throw new Error(`Orphaned Cellar Operation: ${item.id} references non-existent or deleted Vessel (${item[vesselField]}).`);
                }
              }
            }

            if (item.materialId) {
              if (!isValidId(item.materialId)) {
                throw new Error(`Cellar operation ${item.id} has invalid materialId.`);
              }
              const materialExists = userDb.inventory.some((i: any) => i.id === item.materialId) || (collections.inventory && collections.inventory.some((i: any) => i.id === item.materialId));
              const materialDeleted = deletedIds && deletedIds.includes(item.materialId);
              if (!materialExists || materialDeleted) {
                throw new Error(`Orphaned Cellar Operation: ${item.id} references non-existent or deleted inventory material (${item.materialId}).`);
              }
            }

            const nonNegativeFields = ['dose', 'volumeBeforeL', 'volumeAfterL'];
            for (const field of nonNegativeFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Cellar operation ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'costEntries') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Cost entry ${item.id} has invalid referenced lotId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const lotDeleted = deletedIds && deletedIds.includes(item.lotId);
            if (!lotExists || lotDeleted) {
              throw new Error(`Orphaned Cost Entry: ${item.id} references non-existent or deleted Lot (${item.lotId}).`);
            }
            if (typeof item.amount !== 'number') {
              throw new Error(`Cost entry ${item.id} amount must be a number.`);
            }
            if (item.quantity !== undefined && (typeof item.quantity !== 'number' || item.quantity < 0)) {
              throw new Error(`Cost entry ${item.id} quantity must be non-negative.`);
            }
            if (item.unitCost !== undefined && (typeof item.unitCost !== 'number' || item.unitCost < 0)) {
              throw new Error(`Cost entry ${item.id} unitCost must be non-negative.`);
            }
          }

          else if (key === 'storageLocations') {
            if (item.capacityBottles !== undefined && (typeof item.capacityBottles !== 'number' || item.capacityBottles < 0)) {
              throw new Error(`Storage location ${item.id} capacityBottles must be non-negative.`);
            }
            if (item.targetTempC !== undefined && typeof item.targetTempC !== 'number') {
              throw new Error(`Storage location ${item.id} targetTempC must be a number.`);
            }
            if (item.targetHumidity !== undefined && (typeof item.targetHumidity !== 'number' || item.targetHumidity < 0 || item.targetHumidity > 100)) {
              throw new Error(`Storage location ${item.id} targetHumidity must be between 0 and 100.`);
            }
          }

          else if (key === 'stockMovements') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Stock movement ${item.id} has invalid referenced lotId.`);
            }
            if (!isValidId(item.locationId)) {
              throw new Error(`Stock movement ${item.id} has invalid referenced locationId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const locExists = userDb.storageLocations?.some((l: any) => l.id === item.locationId) || (collections.storageLocations && collections.storageLocations.some((l: any) => l.id === item.locationId));
            if (!lotExists) {
              throw new Error(`Orphaned Stock Movement: ${item.id} references non-existent Lot (${item.lotId}).`);
            }
            if (!locExists) {
              throw new Error(`Orphaned Stock Movement: ${item.id} references non-existent Storage Location (${item.locationId}).`);
            }
            if (!['in', 'out'].includes(item.direction)) {
              throw new Error(`Stock movement ${item.id} has invalid direction.`);
            }
            if (typeof item.bottles !== 'number' || item.bottles < 0) {
              throw new Error(`Stock movement ${item.id} bottles must be non-negative.`);
            }
            if (item.sourceRef !== undefined && item.sourceRef !== null && item.sourceRef !== '' && !isValidId(item.sourceRef)) {
              throw new Error(`Stock movement ${item.id} has invalid sourceRef.`);
            }
          }

          else if (key === 'salesDispatches') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid referenced lotId.`);
            }
            if (!isValidId(item.locationId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid referenced locationId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const locExists = userDb.storageLocations?.some((l: any) => l.id === item.locationId) || (collections.storageLocations && collections.storageLocations.some((l: any) => l.id === item.locationId));
            if (!lotExists) {
              throw new Error(`Orphaned Sales Dispatch: ${item.id} references non-existent Lot (${item.lotId}).`);
            }
            if (!locExists) {
              throw new Error(`Orphaned Sales Dispatch: ${item.id} references non-existent Storage Location (${item.locationId}).`);
            }
            const numericFields = ['bottles', 'pricePerBottle', 'revenue', 'cogs'];
            for (const field of numericFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Sales dispatch ${item.id} property ${field} must be non-negative.`);
              }
            }
            if (item.grossProfit !== undefined && typeof item.grossProfit !== 'number') {
              throw new Error(`Sales dispatch ${item.id} grossProfit must be a number.`);
            }
            if (item.costPerBottle !== undefined && item.costPerBottle !== null && (typeof item.costPerBottle !== 'number' || item.costPerBottle < 0)) {
              throw new Error(`Sales dispatch ${item.id} costPerBottle must be non-negative.`);
            }
            if (item.marginPct !== undefined && item.marginPct !== null && typeof item.marginPct !== 'number') {
              throw new Error(`Sales dispatch ${item.id} marginPct must be a number.`);
            }
            if (item.stockMovementId !== undefined && !isValidId(item.stockMovementId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid stockMovementId.`);
            }
            if (item.salesOrderId !== undefined && item.salesOrderId !== null && item.salesOrderId !== '' && !isValidId(item.salesOrderId)) {
              throw new Error(`Sales dispatch ${item.id} has invalid salesOrderId.`);
            }
          }

          else if (key === 'salesOrders') {
            if (!isValidId(item.lotId)) {
              throw new Error(`Sales order ${item.id} has invalid referenced lotId.`);
            }
            if (!isValidId(item.locationId)) {
              throw new Error(`Sales order ${item.id} has invalid referenced locationId.`);
            }
            const lotExists = userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId));
            const locExists = userDb.storageLocations?.some((l: any) => l.id === item.locationId) || (collections.storageLocations && collections.storageLocations.some((l: any) => l.id === item.locationId));
            if (!lotExists) {
              throw new Error(`Orphaned Sales Order: ${item.id} references non-existent Lot (${item.lotId}).`);
            }
            if (!locExists) {
              throw new Error(`Orphaned Sales Order: ${item.id} references non-existent Storage Location (${item.locationId}).`);
            }
            if (!['reserved', 'fulfilled', 'cancelled'].includes(item.status)) {
              throw new Error(`Sales order ${item.id} has invalid status.`);
            }
            const numericFields = ['bottles', 'pricePerBottle', 'revenue', 'cogs'];
            for (const field of numericFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Sales order ${item.id} property ${field} must be non-negative.`);
              }
            }
            if (item.grossProfit !== undefined && typeof item.grossProfit !== 'number') {
              throw new Error(`Sales order ${item.id} grossProfit must be a number.`);
            }
            if (item.costPerBottle !== undefined && item.costPerBottle !== null && (typeof item.costPerBottle !== 'number' || item.costPerBottle < 0)) {
              throw new Error(`Sales order ${item.id} costPerBottle must be non-negative.`);
            }
            if (item.marginPct !== undefined && item.marginPct !== null && typeof item.marginPct !== 'number') {
              throw new Error(`Sales order ${item.id} marginPct must be a number.`);
            }
            if (item.dispatchId !== undefined && item.dispatchId !== null && item.dispatchId !== '' && !isValidId(item.dispatchId)) {
              throw new Error(`Sales order ${item.id} has invalid dispatchId.`);
            }
          }

          else if (key === 'supplierPayments') {
            if (typeof item.supplierName !== 'string' || !item.supplierName.trim()) {
              throw new Error(`Supplier payment ${item.id} requires a supplier name.`);
            }
            if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount <= 0) {
              throw new Error(`Supplier payment ${item.id} amount must be a positive number.`);
            }
            if (item.method !== undefined && !['cash', 'bank', 'other'].includes(item.method)) {
              throw new Error(`Supplier payment ${item.id} has invalid method.`);
            }
          }

          else if (key === 'tasks') {
            if (item.priority && !['high', 'medium', 'low'].includes(item.priority)) {
              throw new Error(`Task ${item.id} has invalid priority: ${item.priority}`);
            }
            if (item.status && !['pending', 'completed'].includes(item.status)) {
              throw new Error(`Task ${item.id} has invalid status: ${item.status}`);
            }
          }

          else if (key === 'blocks') {
            if (item.area !== undefined && (typeof item.area !== 'number' || item.area < 0)) {
              throw new Error(`Block ${item.id} area cannot be negative.`);
            }
            if (item.elevation !== undefined && (typeof item.elevation !== 'number' || item.elevation < 0)) {
              throw new Error(`Block ${item.id} elevation cannot be negative.`);
            }
            if (item.rowsCount !== undefined && (typeof item.rowsCount !== 'number' || item.rowsCount < 0)) {
              throw new Error(`Block ${item.id} rowsCount cannot be negative.`);
            }
            if (item.vinesCount !== undefined && (typeof item.vinesCount !== 'number' || item.vinesCount < 0)) {
              throw new Error(`Block ${item.id} vinesCount cannot be negative.`);
            }
          }

          else if (key === 'sprays') {
            const checkFields = ['dosePerHa', 'waterVolumePerHa', 'totalProductUsed', 'totalWaterUsed', 'windSpeed', 'temperature', 'humidity'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Spray record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'soilRecords') {
            const checkFields = ['pH', 'organicMatterPct', 'nitrogenMgKg', 'phosphorusMgKg', 'potassiumMgKg', 'calciumMgKg', 'magnesiumMgKg', 'salinityDsm'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Soil record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'samplings') {
            const checkFields = ['brix', 'pH', 'totalAcidityGL', 'berryWeightG'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Sampling record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'harvests') {
            if (item.estimatedTons !== undefined && (typeof item.estimatedTons !== 'number' || item.estimatedTons < 0)) {
              throw new Error(`Harvest ${item.id} estimatedTons cannot be negative.`);
            }
            if (item.actualHarvestedKg !== undefined && (typeof item.actualHarvestedKg !== 'number' || item.actualHarvestedKg < 0)) {
              throw new Error(`Harvest ${item.id} actualHarvestedKg cannot be negative.`);
            }
          }

          else if (key === 'irrigationLogs') {
            const checkFields = ['durationHours', 'waterVolumeLiters', 'soilMoistureBeforePct', 'soilMoistureAfterPct'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Irrigation record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'fertilizerLogs') {
            if (item.dosePerHa !== undefined && (typeof item.dosePerHa !== 'number' || item.dosePerHa < 0)) {
              throw new Error(`Fertilizer log ${item.id} dosePerHa cannot be negative.`);
            }
            if (item.totalAmountUsed !== undefined && (typeof item.totalAmountUsed !== 'number' || item.totalAmountUsed < 0)) {
              throw new Error(`Fertilizer log ${item.id} totalAmountUsed cannot be negative.`);
            }
          }

          else if (key === 'phenologyLogs') {
            if (item.gdd !== undefined && (typeof item.gdd !== 'number' || item.gdd < 0)) {
              throw new Error(`Phenology record ${item.id} gdd cannot be negative.`);
            }
            if (item.confidence !== undefined && (typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 100)) {
              throw new Error(`Phenology record ${item.id} confidence must be between 0 and 100.`);
            }
          }

          else if (key === 'notes') {
            if (item.relatedLotId !== undefined && item.relatedLotId !== null) {
              if (!isValidId(item.relatedLotId)) {
                throw new Error(`Note ${item.id} has invalid referenced relatedLotId.`);
              }
              const lotExists = userDb.lots.some((l: any) => l.id === item.relatedLotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.relatedLotId));
              const lotDeleted = deletedIds && deletedIds.includes(item.relatedLotId);
              if (!lotExists || lotDeleted) {
                throw new Error(`Orphaned Reference: Note ${item.id} references non-existent or deleted Lot (${item.relatedLotId}).`);
              }
            }
          }

          else if (key === 'auditLogs') {
            const existingAudit = userDb.auditLogs.find((l: any) => l.id === item.id);
            if (existingAudit && !auditLogContentMatches(existingAudit, item)) {
              throw new Error(`Audit Immutability: Modify log ${item.id} is forbidden.`);
            }
          }
        }
      }
    }
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Validation error' });
  }

  try {
    if (Array.isArray(collections.auditLogs)) {
      collections.auditLogs = prepareAuditLogsForServerMerge(userDb.auditLogs || [], collections.auditLogs);
    }
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Audit validation error' });
  }

  // Apply deletions, then merge with optimistic-concurrency conflict
  // detection. Conflicted items are not applied; everything else is.
  applyDeletions(userDb, deletedIds);
  const conflicts = mergeCollections(userDb, collections);
  if (session.username === 'testuser1') {
    pruneTestUserSeedDuplicates(userDb);
  }

  try {
    await saveUserData(session.username, userDb, {
      expectedVersion: expectedOrgStateVersion,
      updatedBy: `api-sync:${session.username}`,
    });
  } catch (err) {
    if (err instanceof OrganizationStateVersionConflictError) {
      const latest = await reloadUserOrganizationDataFromPostgres(session.username);
      if (latest) {
        saveDB({ syncPostgres: false });
        await setOrganizationStateHeaders(res, session.username);
      }
      return res.status(409).json({
        code: 'org_state_conflict',
        error: 'Organization data changed while saving. Please sync again before retrying.',
        serverDb: latest?.data || userDb,
      });
    }
    throw err;
  }

  await setOrganizationStateHeaders(res, session.username);

  if (conflicts.length > 0) {
    return res.json({ hasConflicts: true, conflicts, serverDb: userDb });
  }
  res.json(userDb);
});

// Load DB values initial route
app.get('/api/db', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['maranios_session'];
  const session = verifySessionToken(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const refreshed = await reloadUserOrganizationDataFromPostgres(session.username);
  let userDb = refreshed?.data || await getUserData(session.username);
  if (!userDb) {
    userDb = createEmptyUserData();
    await saveUserData(session.username, userDb);
  }
  await setOrganizationStateHeaders(res, session.username);
  res.json(userDb);
});

// --- MOCK TELEMETRY ENGINE ---
interface TelemetryReading {
  lotId: string;
  tankId: string;
  timestamp: string;
  density: number; // Specific Gravity (SG)
  temperature: number; // °C
  ph: number;
  dissolvedOxygen: number; // mg/L
  dailySlope: number; // SG drop per day
  status: 'active' | 'slow' | 'stuck' | 'finished';
}

let simulatedTelemetry: Record<string, Record<string, TelemetryReading>> = {};

function initTelemetry(username: string, userDb: any) {
  const fermentingLots = userDb.lots.filter((l: any) => l.stage === 'fermenting');
  if (!simulatedTelemetry[username]) {
    simulatedTelemetry[username] = {};
  }
  const userSimulated = simulatedTelemetry[username];
  const newTelemetry: Record<string, TelemetryReading> = {};
  
  for (const lot of fermentingLots) {
    const vessel = userDb.vessels.find((v: any) => v.assignedLotId === lot.id);
    if (!vessel) continue;
    
    if (userSimulated[lot.id]) {
      newTelemetry[lot.id] = userSimulated[lot.id];
      newTelemetry[lot.id].tankId = vessel.id;
    } else {
      const isStuck = lot.name.toLowerCase().includes('stuck') || lot.id.toLowerCase().includes('stuck');
      newTelemetry[lot.id] = {
        lotId: lot.id,
        tankId: vessel.id,
        timestamp: new Date().toISOString(),
        density: isStuck ? 1.024 : 1.012,
        temperature: isStuck ? 15.5 : 21.8,
        ph: 3.5,
        dissolvedOxygen: isStuck ? 0.04 : 0.35,
        dailySlope: isStuck ? 0.0008 : 0.012,
        status: isStuck ? 'stuck' : 'active'
      };
    }
  }
  simulatedTelemetry[username] = newTelemetry;
}

app.get('/api/telemetry/active', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['maranios_session'];
  const session = verifySessionToken(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userDb = await getUserData(session.username) || createEmptyUserData();

  initTelemetry(session.username, userDb);

  const userSimulated = simulatedTelemetry[session.username] || {};
  Object.keys(userSimulated).forEach((lotId) => {
    const t = userSimulated[lotId];
    t.timestamp = new Date().toISOString();
    
    if (t.status === 'stuck') {
      t.density = parseFloat((t.density - 0.00005 + (Math.random() - 0.5) * 0.0001).toFixed(4));
      t.temperature = parseFloat((15.5 + (Math.random() - 0.5) * 0.3).toFixed(1));
      t.dailySlope = 0.0008;
    } else if (t.status === 'active') {
      t.density = parseFloat((t.density - 0.0012 + (Math.random() - 0.5) * 0.0002).toFixed(4));
      t.temperature = parseFloat((21.8 + (Math.random() - 0.5) * 0.5).toFixed(1));
      t.dailySlope = 0.012;
      if (t.density <= 0.992) {
        t.density = 0.992;
        t.status = 'finished';
        t.dailySlope = 0;
      }
    }
  });

  res.json(Object.values(userSimulated));
});

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Helper to assemble rich historical context about the user's winery and vineyard
export function getHistoricalContext(username: string): string {
  const db = getDB();
  const user = db.users.find(u => u.username === username);
  const orgId = user?.activeOrganizationId;
  const userData = orgId ? db.orgData[orgId] : null;
  if (!userData) return "";

  let context = "\n[HISTORICAL WINERY & VINEYARD CONTEXT]\n";

  const blockName = (id: string) => (userData.blocks || []).find((b: any) => b.id === id)?.name || id;

  // 1. Vineyard Blocks
  if (userData.blocks && userData.blocks.length > 0) {
    context += "\n* VINEYARD BLOCKS:\n";
    userData.blocks.forEach((b: any) => {
      context += `  - Block "${b.name}" (${b.grapeVariety}, ${b.area} ha): Stage is "${b.currentPhenology}", Est. Harvest: ${b.estimatedHarvestDate}. Spacing: ${b.spacing}, Training: ${b.trainingSystem}.\n`;
    });
  }

  // 2. Recent Spraying and Scouting
  if (userData.scoutings && userData.scoutings.length > 0) {
    context += "\n* RECENT SCOUTING RECORDS:\n";
    userData.scoutings.slice(-5).forEach((s: any) => {
      context += `  - Date: ${s.date}, Block: "${blockName(s.blockId)}": Problem: ${s.problemType}, Severity: ${s.severity}. Findings: ${s.notes}\n`;
    });
  }
  if (userData.sprays && userData.sprays.length > 0) {
    context += "\n* RECENT SPRAY LOGS:\n";
    userData.sprays.slice(-5).forEach((s: any) => {
      context += `  - Date: ${s.date}, Block: "${blockName(s.blockId)}": Product: ${s.productName}, Target: ${s.targetProblem || 'N/A'}, Dose/ha: ${s.dosePerHa}.\n`;
    });
  }

  // 3. Active Wine Lots and Vessels
  if (userData.lots && userData.lots.length > 0) {
    context += "\n* WINE LOTS & VESSEL LOCATIONS:\n";
    userData.lots.forEach((l: any) => {
      const vessels = (userData.vessels || []).filter((v: any) => v.assignedLotId === l.id);
      const vesselNames = vessels.map((v: any) => `${v.name} (${v.type})`).join(', ') || "Not in vessel";
      context += `  - Lot "${l.id}" (${l.name}, ${l.variety}, Vintage ${l.vintage}, Vol: ${l.currentVolume} L): Stage is "${l.stage}". Stored in: ${vesselNames}.\n`;
      
      // Add recent chemistry
      const chemistry = (userData.lablogs || [])
        .filter((c: any) => c.lotId === l.id)
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      if (chemistry) {
        context += `    - Last Chemistry (${chemistry.date}): pH: ${chemistry.ph}, Free SO2: ${chemistry.freeSo2} ppm, TA: ${chemistry.titratableAcidity} g/L, VA: ${chemistry.volatileAcid} g/L, Alc: ${chemistry.alcoholPct}%.\n`;
      }

      // Add recent fermentation readings
      const fermentation = (userData.fermlogs || [])
        .filter((f: any) => f.lotId === l.id)
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 3);
      if (fermentation.length > 0) {
        context += "    - Recent Fermentation Readings:\n";
        fermentation.forEach((f: any) => {
          context += `      * ${f.date}: SG/Density: ${f.density}, Temp: ${f.temperature}°C, pH: ${f.ph ?? 'N/A'}\n`;
        });
      }
    });
  }

  return context;
}

// -------------------------------------------------------------
// POST /api/gemini — Winemaker AI assistant
// Consumed by the AI chat (AiWinemaker) and the Weather tab.
// -------------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
  try {
    const { prompt, cellarState, stream } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({
        error: "API key is not configured yet. Please configure GEMINI_API_KEY in Settings."
      });
    }

    const cookies = parseCookies(req.headers.cookie);
    const session = verifySessionToken(cookies['maranios_session']);
    const username = session?.username;

    let historicalContext = "";
    if (username) {
      historicalContext = getHistoricalContext(username);
    }

    const SYSTEM_PROMPT = `You are the VinOS AI Winemaker Assistant (Copilot), a world-class enological advisor, biochemist, and cellar processes expert.
You help winemakers worldwide with:
1. Stuck and sluggish fermentation diagnostics (sugar curves, temperature, nitrogen, density) and restart protocols.
2. Chemical additions and pH modeling: free SO2 calculations, potassium metabisulfite (KMBS) formulations, tartaric acid / calcium carbonate additions.
3. Traditional Georgian winemaking in clay Qvevris: skin contact maceration times, lid sealing, lime water lining, buried marani temperature dynamics.
4. Malolactic fermentation (MLF) management, volatile acidity (VA) mitigation, barrel aging, oak toast selections, and cellaring sanitation.

You have access to the winemaker's real-time cellar state and historical data (fermentation logs, chemistry history, vineyard spray/scouting records) below. Use this data to provide highly personalized, context-aware advice, diagnose issues, and perform enological calculations automatically without asking the user to re-enter values unless needed.

Provide highly professional, authentic, scientifically accurate enological advice. Answer concisely, using markdown tables or bullet points where helpful.`;

    let chemicalContext = "";
    if (cellarState) {
      chemicalContext = `
[CURRENT CELLAR SUMMARY]
- Total active vessels: ${cellarState.tanksCount}
- Active fermentations: ${cellarState.activeFermsCount}
- Average fermenter temperature: ${cellarState.avgTemp}°C
- Low SO2 warnings: ${cellarState.lowSo2Count}
- High Volatile Acidity alerts: ${cellarState.highVaCount}

[REPRESENTATIVE TANKS/LOTS]
${JSON.stringify(cellarState.sampleData || [], null, 2)}
`;
    }

    const fullPrompt = `${SYSTEM_PROMPT}\n\n${chemicalContext}\n\n${historicalContext}\n\nWinemaker Query: ${prompt}\n\nAI Winemaker Response:\n`;

    const client = getAiClient();

    // Streaming (Server-Sent Events) for the chat UI. Callers that don't ask for
    // a stream (e.g. the Weather tab) still get a single JSON response below.
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      try {
        const streamed = await client.models.generateContentStream({
          model: GEMINI_MODEL,
          contents: fullPrompt,
        });
        for await (const chunk of streamed) {
          const piece = chunk.text;
          if (piece) res.write(`data: ${JSON.stringify({ text: piece })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      } catch (streamErr: any) {
        res.write(`data: ${JSON.stringify({ error: streamErr?.message || 'Streaming failed' })}\n\n`);
      }
      return res.end();
    }

    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: fullPrompt,
    });

    return res.json({ text: response.text });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error?.message?.includes("GEMINI_API_KEY")) {
      return res.status(400).json({
        error: "API key is not configured yet. Please configure GEMINI_API_KEY in Settings."
      });
    }
    return res.status(500).json({
      error: "I am offline. Please verify settings or connection, or ask about general winemaking.",
      details: error?.message || "Unknown error"
    });
  }
});

// Serve frontend
const isProd = process.env.NODE_ENV === 'production';
const server = http.createServer(app);

if (isProd) {
  // Serve production build static files
  app.use(express.static(path.resolve(__dirname, 'dist'), {
    maxAge: '1y',
    immutable: true,
    index: false // Do not serve index.html with aggressive caching
  }));
  app.get('*any', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });

} else {
  // In development, load Vite middleware dynamically to provide live reload on same port!
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { 
      middlewareMode: true,
      hmr: { server }
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

const PORT = parseInt(process.env.PORT || '3000', 10);

// Hydrate the database from durable storage (GCS) before accepting traffic.
// initDB() is a no-op unless GCS_BUCKET is set, so local/dev startup is unchanged.
if (process.env.VITEST !== 'true') {
  initDB()
    .catch((err) => console.error('[db] initialisation failed, continuing with local state:', err))
    .finally(() => {
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is running in ${isProd ? 'production' : 'development'} on http://0.0.0.0:${PORT}`);
      });
    });
}
