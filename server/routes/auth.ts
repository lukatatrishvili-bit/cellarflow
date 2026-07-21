import express from 'express';
import {
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  checkWineryScope,

  accountRecoveryLimiter,
  invitationLimiter,
  loginLimiter,
  oauthCallbackLimiter} from '../middleware/auth';
import {
  verifySessionToken,
  createSessionToken,
  hashPassword,
  verifyPassword,
  passwordNeedsUpgrade,
  passcodeValidationError,
  sameNormalizedEmail,
  sessionMatchesUserVersion,
  sessionPayloadForUser,
  sessionVersionForUser,
  userAccountIsEnabled,
} from '../auth';
import {
  getDB,
  saveCoreMetadata,
  saveUserData,
  getUserData,
  createEmptyUserData,
  refreshCoreMetadataFromPostgres,
  acceptInvitationAtomically,
} from '../db';
import { generateVerificationToken, hashToken, isVerificationTokenValid, isValidEmail } from '../emailVerification';
import { sendMail, buildVerificationEmail, buildResetPasswordEmail, buildInvitationEmail } from '../mailer';
import { createDemoUser } from '../demoAccount';
import {
  cleanEnv,
  getGoogleOAuthCreds,
  updateEnvFile,
  appBaseUrl,
  clientIp,
  demoAccountConfig,
} from '../config';
import { isRuntimeOAuthConfigAllowed, oauthConfigBlockedMessage } from '../oauthConfigPolicy';
import { isKnownRole, type Role } from '../permissions';
import { auditSecurityEvent } from '../securityAudit';
import type { SharedLoginLimiter } from '../loginLimiter';

const authRouter = express.Router();
const orgRouter = express.Router();
const DEFAULT_MODULES = ['vazi', 'gvino'];
const DEFAULT_WIDGETS = ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks'];
const ALLOWED_MODULES = ['vazi', 'gvino'];
const ALLOWED_WIDGETS = ['weather', 'chemistry', 'scouting', 'fermentation', 'canopy', 'notes', 'tasks', 'audit'];
const WIDGET_MODULES: Record<string, 'vazi' | 'gvino' | null> = {
  weather: 'vazi',
  scouting: 'vazi',
  canopy: 'vazi',
  chemistry: 'gvino',
  fermentation: 'gvino',
  notes: null,
  tasks: null,
  audit: null,
};

function rateLimitKey(scope: string, req: express.Request, subject = ''): string {
  return `rate:${scope}:${hashToken(`${clientIp(req)}:${subject.trim().toLowerCase()}`)}`;
}

async function consumeRateLimit(
  limiter: SharedLoginLimiter,
  keys: string[],
  res: express.Response,
): Promise<boolean> {
  const uniqueKeys = Array.from(new Set(keys));
  for (const key of uniqueKeys) {
    const remaining = await limiter.lockRemainingSeconds(key);
    if (remaining > 0) {
      res.setHeader('Retry-After', String(remaining));
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return false;
    }
  }
  await Promise.all(uniqueKeys.map(key => limiter.recordFailure(key)));
  return true;
}

function validSessionForUser(session: any, user: any): boolean {
  return Boolean(session && userAccountIsEnabled(user) && sessionMatchesUserVersion(session, user));
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLanguage(value: unknown): 'en' | 'ka' {
  return value === 'ka' ? 'ka' : 'en';
}

function normalizeRole(value: unknown, fallback: Role = 'Owner/Admin'): Role {
  return isKnownRole(value) ? value : fallback;
}

function selectedModules(value: unknown, fallback: string[] = []): string[] {
  const raw = Array.isArray(value) ? value : [];
  const modules = raw
    .map(item => cleanText(item))
    .filter(item => ALLOWED_MODULES.includes(item));
  const unique = Array.from(new Set(modules));
  return unique.length > 0 ? unique : [...fallback];
}

function selectedWidgets(value: unknown, modules: string[], fallback: string[] = DEFAULT_WIDGETS): string[] {
  const raw = Array.isArray(value) ? value : [];
  const widgets = raw
    .map(item => cleanText(item))
    .filter(item => ALLOWED_WIDGETS.includes(item))
    .filter(item => {
      const requiredModule = WIDGET_MODULES[item] ?? null;
      return !requiredModule || modules.includes(requiredModule);
    });
  const unique = Array.from(new Set(widgets));
  if (unique.length > 0) return unique;
  return fallback.filter(item => {
    const requiredModule = WIDGET_MODULES[item] ?? null;
    return !requiredModule || modules.includes(requiredModule);
  });
}

function normalizeCompanyProfile(input: unknown, fallbackEmail = '') {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  const profile: any = {
    companyName: cleanText(raw.companyName),
    wineryName: cleanText(raw.wineryName),
    country: cleanText(raw.country),
    region: cleanText(raw.region),
    municipality: cleanText(raw.municipality),
    address: cleanText(raw.address),
    contactEmail: cleanText(raw.contactEmail) || fallbackEmail,
    phone: cleanText(raw.phone),
    website: cleanText(raw.website),
    measurementUnits: raw.measurementUnits === 'imperial' ? 'imperial' : 'metric',
    currency: cleanText(raw.currency) || 'GEL',
  };
  if (Number.isFinite(latitude)) profile.latitude = latitude;
  if (Number.isFinite(longitude)) profile.longitude = longitude;
  return profile;
}

function publicUser(user: any, extra: Record<string, unknown> = {}) {
  const modules = selectedModules(user?.enabledModules, DEFAULT_MODULES);
  return {
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    role: normalizeRole(user.role),
    language: normalizeLanguage(user.language),
    enabledModules: modules,
    enabledWidgets: selectedWidgets(user.enabledWidgets, modules),
    registrationComplete: user.registrationComplete ?? true,
    isMasterAdmin: false,
    ...extra,
  };
}

function activeMembershipRole(db: any, user: any): Role {
  const membership = user?.activeOrganizationId
    ? db.memberships?.find((item: any) => item.userId === user.username && item.organizationId === user.activeOrganizationId)
    : null;
  return normalizeRole(membership?.role, normalizeRole(user?.role));
}

export function publicUserForActiveOrganization(
  db: any,
  user: any,
  extra: Record<string, unknown> = {},
) {
  return publicUser(user, { ...extra, role: activeMembershipRole(db, user) });
}

export interface OrganizationSwitchSuccess {
  ok: true;
  activeOrganizationId: string;
  role: Role;
}

export function buildOrganizationSwitchResponse(activeOrganizationId: string, role: Role): OrganizationSwitchSuccess {
  return { ok: true, activeOrganizationId, role };
}

function ensureDbCollections(db: any): void {
  if (!db.organizations) db.organizations = [];
  if (!db.memberships) db.memberships = [];
  if (!db.orgData) db.orgData = {};
}

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
    await saveUserData(demoAccountConfig.username, createEmptyUserData());
  }

  return user;
}

const getRedirectUri = (req: any) => {
  return `${appBaseUrl(req)}/api/auth/google/callback`;
};

// ── Authentication Endpoints ──────────────────────────────────────────

authRouter.post('/register', async (req, res) => {
  const { username, email, fullName, role, language, passcode, companyProfile } = req.body;

  if (!username || !passcode) {
    return res.status(400).json({ error: 'Username and passcode are required' });
  }
  const passcodeError = passcodeValidationError(passcode);
  if (passcodeError) {
    return res.status(400).json({ error: passcodeError });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  const cleanFullName = cleanText(fullName);
  if (!cleanFullName) {
    return res.status(400).json({ error: 'Full name is required' });
  }
  if (!isKnownRole(role)) {
    return res.status(400).json({ error: 'A valid role is required' });
  }

  const enabledModules = selectedModules(req.body?.enabledModules);
  if (enabledModules.length === 0) {
    return res.status(400).json({ error: 'Select at least one workspace module' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const cleanUsername = String(username).toLowerCase().replace(/\s+/g, '_');
  const cleanEmail = String(email).toLowerCase().trim();
  const normalizedCompanyProfile = normalizeCompanyProfile(companyProfile, cleanEmail);
  if (!normalizedCompanyProfile.companyName) {
    return res.status(400).json({ error: 'Company or estate name is required' });
  }
  const enabledWidgets = selectedWidgets(req.body?.enabledWidgets, enabledModules);

  if (db.users.find(u => u.username === cleanUsername)) {
    return res.status(400).json({ error: 'Username is already taken' });
  }
  if (db.users.find(u => (u.email || '').toLowerCase().trim() === cleanEmail)) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const verification = generateVerificationToken();

  const orgId = 'org_' + Math.random().toString(36).substr(2, 9);
  const org = { id: orgId, name: normalizedCompanyProfile.companyName };
  ensureDbCollections(db);
  db.organizations.push(org);

  const memId = 'mem_' + Math.random().toString(36).substr(2, 9);
  const membership = { id: memId, userId: cleanUsername, organizationId: orgId, role: 'Owner/Admin' };
  db.memberships.push(membership);

  const user: any = {
    username: cleanUsername,
    email: cleanEmail,
    fullName: cleanFullName,
    role,
    language: normalizeLanguage(language),
    passwordHash: hashPassword(passcode || 'vinea2026'),
    enabledModules,
    enabledWidgets,
    registrationComplete: true,
    emailVerified: false,
    verifyTokenHash: verification.tokenHash,
    verifyTokenExpires: verification.expiresAt,
    activeOrganizationId: orgId,
    accountEnabled: true,
    sessionVersion: 1,
  };
  db.users.push(user);

  db.orgData[orgId] = createEmptyUserData();
  db.orgData[orgId].companyProfile = {
    ...db.orgData[orgId].companyProfile,
    ...normalizedCompanyProfile,
  };

  await saveCoreMetadata('auth-register');
  await saveUserData(cleanUsername, db.orgData[orgId], { updatedBy: 'auth-register' });

  const exposeVerifyLink = (transport: 'smtp' | 'console'): boolean => {
    return transport === 'console' && process.env.NODE_ENV !== 'production';
  };
  const link = `${appBaseUrl(req)}/api/auth/verify-email?token=${verification.token}&u=${encodeURIComponent(cleanUsername)}`;
  let mail;
  try {
    mail = await sendMail(buildVerificationEmail({ to: cleanEmail, link, lang: user.language, wineryName: 'VinOS' }));
  } catch {
    await auditSecurityEvent({
      eventType: 'email.delivery_failed',
      username: cleanUsername,
      organizationId: orgId,
      ip: clientIp(req),
      metadata: { purpose: 'email_verification' },
    });
    return res.status(503).json({
      error: 'Your account was created, but the verification email could not be delivered. Please try resending it later.',
      code: 'email_delivery_failed',
    });
  }

  await auditSecurityEvent({
    eventType: 'account.registered',
    username: cleanUsername,
    organizationId: orgId,
    ip: clientIp(req),
  });

  res.json({
    requiresVerification: true,
    username: cleanUsername,
    email: cleanEmail,
    ...(exposeVerifyLink(mail.transport) ? { devVerifyUrl: link } : {}),
  });
});

authRouter.get('/verify-email', async (req, res) => {
  const token = String(req.query.token || '');
  const username = String(req.query.u || '').toLowerCase();
  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === username) as any;

  if (!user || !userAccountIsEnabled(user)) return res.redirect('/?verify_error=invalid');
  if (user.emailVerified) return res.redirect('/?verified=already');
  if (!isVerificationTokenValid(user, token)) return res.redirect('/?verify_error=expired');

  user.emailVerified = true;
  delete user.verifyTokenHash;
  delete user.verifyTokenExpires;
  await saveCoreMetadata('auth-verify-email');

  await auditSecurityEvent({
    eventType: 'email.verified',
    username: user.username,
    organizationId: user.activeOrganizationId,
    ip: clientIp(req),
  });

  const sessionToken = createSessionToken(sessionPayloadForUser(user, user.role), true);
  res.setHeader('Set-Cookie', sessionCookie(sessionToken, 2592000)); // 30 days

  res.redirect('/?verified=1');
});

authRouter.post('/resend-verification', async (req, res) => {
  const id = String(req.body?.identifier || '').toLowerCase().trim();
  if (!await consumeRateLimit(accountRecoveryLimiter, [
    rateLimitKey('verification-resend-ip', req),
    rateLimitKey('verification-resend-identity', req, id),
  ], res)) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === id || (u.email || '').toLowerCase().trim() === id) as any;

  const exposeVerifyLink = (transport: 'smtp' | 'console'): boolean => {
    return transport === 'console' && process.env.NODE_ENV !== 'production';
  };

  if (user && userAccountIsEnabled(user) && user.emailVerified === false) {
    const verification = generateVerificationToken();
    user.verifyTokenHash = verification.tokenHash;
    user.verifyTokenExpires = verification.expiresAt;
    await saveCoreMetadata('auth-resend-verification');
    const link = `${appBaseUrl(req)}/api/auth/verify-email?token=${verification.token}&u=${encodeURIComponent(user.username)}`;
    let mail;
    try {
      mail = await sendMail(buildVerificationEmail({ to: user.email, link, lang: user.language, wineryName: 'VinOS' }));
      await auditSecurityEvent({
        eventType: 'email.verification_resent',
        username: user.username,
        organizationId: user.activeOrganizationId,
        ip: clientIp(req),
      });
    } catch {
      await auditSecurityEvent({
        eventType: 'email.delivery_failed',
        username: user.username,
        organizationId: user.activeOrganizationId,
        ip: clientIp(req),
        metadata: { purpose: 'email_verification' },
      });
      return res.json({ ok: true });
    }
    if (exposeVerifyLink(mail.transport)) {
      return res.json({ ok: true, devVerifyUrl: link });
    }
  }
  res.json({ ok: true });
});

authRouter.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (!await consumeRateLimit(accountRecoveryLimiter, [
    rateLimitKey('password-forgot-ip', req),
    rateLimitKey('password-forgot-identity', req, email),
  ], res)) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => (u.email || '').toLowerCase().trim() === email) as any;

  // Always return the same public result for a syntactically valid email so
  // this endpoint cannot be used to enumerate VinOS accounts.
  if (!user || !userAccountIsEnabled(user)) {
    return res.json({ ok: true });
  }

  const resetToken = generateVerificationToken();
  user.resetTokenHash = resetToken.tokenHash;
  user.resetTokenExpires = resetToken.expiresAt;
  await saveCoreMetadata('auth-forgot-password');

  const link = `${appBaseUrl(req)}/?reset_token=${resetToken.token}&u=${encodeURIComponent(user.username)}`;
  let mail;
  try {
    mail = await sendMail(buildResetPasswordEmail({ to: user.email, link, lang: user.language, wineryName: 'VinOS' }));
    await auditSecurityEvent({
      eventType: 'password.reset_requested',
      username: user.username,
      organizationId: user.activeOrganizationId,
      ip: clientIp(req),
    });
  } catch {
    await auditSecurityEvent({
      eventType: 'email.delivery_failed',
      username: user.username,
      organizationId: user.activeOrganizationId,
      ip: clientIp(req),
      metadata: { purpose: 'password_reset' },
    });
    return res.json({ ok: true });
  }

  const exposeVerifyLink = (transport: 'smtp' | 'console'): boolean => {
    return transport === 'console' && process.env.NODE_ENV !== 'production';
  };

  if (exposeVerifyLink(mail.transport)) {
    return res.json({ ok: true, devVerifyUrl: link });
  }

  res.json({ ok: true });
});

authRouter.post('/reset-password', async (req, res) => {
  const { token, username, passcode } = req.body;
  if (!token || !username || !passcode) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const passcodeError = passcodeValidationError(passcode);
  if (passcodeError) {
    return res.status(400).json({ error: passcodeError });
  }

  const cleanUsername = String(username).toLowerCase().trim();
  if (!await consumeRateLimit(accountRecoveryLimiter, [
    rateLimitKey('password-reset-ip', req),
    rateLimitKey('password-reset-identity', req, cleanUsername),
  ], res)) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === cleanUsername) as any;

  if (!user || !userAccountIsEnabled(user)) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const isValid = isVerificationTokenValid({
    verifyTokenHash: user.resetTokenHash,
    verifyTokenExpires: user.resetTokenExpires
  }, token);

  if (!isValid) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  user.passwordHash = hashPassword(passcode || 'vinea2026');
  user.sessionVersion = sessionVersionForUser(user) + 1;
  delete user.resetTokenHash;
  delete user.resetTokenExpires;
  await saveCoreMetadata('auth-reset-password');

  await auditSecurityEvent({
    eventType: 'password.reset_completed',
    username: user.username,
    organizationId: user.activeOrganizationId,
    ip: clientIp(req),
  });

  res.json({ ok: true });
});

authRouter.post('/login', async (req, res) => {
  const { identifier, passcode, rememberMe } = req.body;

  const limiterKey = `${clientIp(req)}:${String(identifier || '').toLowerCase()}`;
  const lockRemaining = await loginLimiter.lockRemainingSeconds(limiterKey);
  if (lockRemaining > 0) {
    res.setHeader('Retry-After', String(lockRemaining));
    return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(lockRemaining / 60)} min.` });
  }

  const envAdminUser = cleanEnv(process.env.ADMIN_USERNAME);
  const envAdminPass = cleanEnv(process.env.ADMIN_PASSCODE) || cleanEnv(process.env.ADMIN_PASSWORD);

  if (envAdminUser && envAdminPass && identifier && passcode) {
    const inputUser = String(identifier).trim().toLowerCase();
    const targetUser = String(envAdminUser).trim().toLowerCase();
    if (inputUser === targetUser || inputUser === `${targetUser}@vinea.com` || inputUser === `${targetUser}@cellarflow.com`) {
      if (String(passcode).trim() === String(envAdminPass).trim()) {
        await loginLimiter.clear(limiterKey);
        const token = createSessionToken({ username: envAdminUser, role: 'Owner/Admin' }, rememberMe);
        const maxAge = rememberMe ? 2592000 : 86400;
        res.setHeader('Set-Cookie', sessionCookie(token, maxAge));
        return res.json({
          username: envAdminUser,
          email: `${envAdminUser}@cellarflow.com`,
          fullName: 'Master Administrator',
          role: 'Owner/Admin',
          language: 'en',
          enabledModules: ['vazi', 'gvino'],
          enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks', 'audit'],
          registrationComplete: true,
          isMasterAdmin: true,
        });
      }
    }
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();

  const user = db.users.find(u => u.username === identifier || u.email === identifier);
  if (!user || !userAccountIsEnabled(user) || !verifyPassword(passcode, user.passwordHash)) {
    await loginLimiter.recordFailure(limiterKey);
    return res.status(401).json({ error: 'Invalid username or passcode' });
  }

  if ((user as any).emailVerified === false) {
    await loginLimiter.clear(limiterKey);
    return res.status(403).json({
      error: 'Please verify your email before signing in. Check your inbox for the confirmation link.',
      code: 'email_unverified',
    });
  }

  await loginLimiter.clear(limiterKey);

  // Transparently upgrade legacy/weaker password hashes on successful login.
  if (passwordNeedsUpgrade(user.passwordHash)) {
    user.passwordHash = hashPassword(passcode);
    try {
      await saveCoreMetadata('auth-login-rehash');
    } catch (err) {
      console.error('[auth] password re-hash persistence failed:', err);
    }
  }

  const effectiveRole = activeMembershipRole(db, user);
  const token = createSessionToken(sessionPayloadForUser(user, effectiveRole), rememberMe);
  const maxAge = rememberMe ? 2592000 : 86400;
  res.setHeader('Set-Cookie', sessionCookie(token, maxAge));
  res.json(publicUser(user, { role: effectiveRole }));
});

authRouter.post('/demo', async (_req, res) => {
  if (!demoAccountConfig.enabled) {
    return res.status(404).json({ error: 'Demo login is not enabled for this deployment.' });
  }

  try {
    const user = await ensureDemoAccount();
    if (!user || !userAccountIsEnabled(user)) return res.status(404).json({ error: 'Demo login is unavailable.' });

    const db = getDB();
    const effectiveRole = activeMembershipRole(db, user);
    const token = createSessionToken(sessionPayloadForUser(user, effectiveRole), false);
    res.setHeader('Set-Cookie', sessionCookie(token, 86400));
    res.json(publicUser(user, { role: effectiveRole, isDemo: true, registrationComplete: true }));
  } catch (err) {
    console.error('Demo login failed:', err);
    res.status(500).json({ error: 'Demo workspace could not be opened.' });
  }
});

authRouter.get('/google/login', (req, res) => {
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
          <pre>GOOGLE_CLIENT_ID<br/>GOOGLE_CLIENT_SECRET</pre>
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
              <input type="password" name="clientSecret" required placeholder="e.g. GOCSPX-xxxxx" />
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
    `&state=google_auth`;

  res.redirect(authUrl);
});

authRouter.post('/google/configure', async (req, res) => {
  if (!isRuntimeOAuthConfigAllowed()) {
    return res.status(403).send('Runtime OAuth configuration is disabled in production.');
  }

  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).send('Client ID and Client Secret are required');
  }

  const db = getDB() as any;
  if (!db.googleConfig) db.googleConfig = {};
  db.googleConfig.clientId = String(clientId).trim();
  db.googleConfig.clientSecret = String(clientSecret).trim();

  await saveCoreMetadata('auth-google-config');

  const trimmedClientId = String(clientId).trim();
  const trimmedClientSecret = String(clientSecret).trim();
  updateEnvFile({
    GOOGLE_CLIENT_ID: trimmedClientId,
    GOOGLE_CLIENT_SECRET: trimmedClientSecret
  });

  await auditSecurityEvent({
    eventType: 'runtime.oauth_configuration_updated',
    ip: clientIp(req),
    metadata: { provider: 'google' },
  });

  res.redirect('/api/auth/google/login');
});

authRouter.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  const callbackRateKey = rateLimitKey('oauth-callback-ip', req);
  if (!await consumeRateLimit(oauthCallbackLimiter, [callbackRateKey], res)) return;
  if (!code) {
    return res.status(400).send('Authorization code missing');
  }

  const db = getDB() as any;
  const { clientId, clientSecret } = getGoogleOAuthCreds(db);
  const redirectUri = getRedirectUri(req);

  try {
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
      console.error(`[auth] Google token exchange failed with status ${tokenRes.status}.`);
      await auditSecurityEvent({
        eventType: 'oauth.callback_failed',
        ip: clientIp(req),
        metadata: { stage: 'token_exchange', providerStatus: tokenRes.status },
      });
      return res.status(502).send('OAuth provider authentication failed');
    }

    const tokenData = await tokenRes.json() as any;
    const accessToken = tokenData.access_token;

    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!userinfoRes.ok) {
      console.error(`[auth] Google user information request failed with status ${userinfoRes.status}.`);
      await auditSecurityEvent({
        eventType: 'oauth.callback_failed',
        ip: clientIp(req),
        metadata: { stage: 'userinfo', providerStatus: userinfoRes.status },
      });
      return res.status(502).send('OAuth provider authentication failed');
    }

    const userinfo = await userinfoRes.json() as any;
    const email = userinfo.email;
    const fullName = userinfo.name || 'Google User';

    if (!email) {
      return res.status(400).send('Email not returned by Google');
    }

    await refreshCoreMetadataFromPostgres();
    const dbData = getDB();
    const cleanEmail = email.toLowerCase().trim();
    let user = dbData.users.find(u => (u.email || '').toLowerCase().trim() === cleanEmail);
    if (user && !userAccountIsEnabled(user)) {
      await auditSecurityEvent({
        eventType: 'oauth.login_rejected',
        username: user.username,
        organizationId: user.activeOrganizationId,
        ip: clientIp(req),
        metadata: { reason: 'account_disabled', provider: 'google' },
      });
      return res.status(403).send('This account is unavailable');
    }

    let username = '';
    if (user) {
      username = user.username;
    } else {
      const emailPrefix = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
      const baseUsername = emailPrefix || 'google_user';
      username = baseUsername;

      let suffix = 1;
      while (dbData.users.some(u => u.username === username)) {
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
        registrationComplete: false,
        emailVerified: true,
        accountEnabled: true,
        sessionVersion: 1,
      };
      const orgId = 'org_' + Math.random().toString(36).substr(2, 9);
      const org = { id: orgId, name: `${fullName || username}'s Estate` };
      const membership = { id: 'mem_' + Math.random().toString(36).substr(2, 9), userId: username, organizationId: orgId, role: 'Owner/Admin' };
      user.activeOrganizationId = orgId;

      ensureDbCollections(dbData);
      dbData.organizations.push(org);
      dbData.memberships.push(membership);
      dbData.orgData[orgId] = createEmptyUserData();
      dbData.users.push(user);
      await saveCoreMetadata('auth-google-register');
      await saveUserData(username, dbData.orgData[orgId]);
    }

    const effectiveRole = activeMembershipRole(dbData, user);
    const token = createSessionToken(sessionPayloadForUser(user, effectiveRole), true);
    res.setHeader('Set-Cookie', sessionCookie(token, 2592000));

    await oauthCallbackLimiter.clear(callbackRateKey);
    await auditSecurityEvent({
      eventType: 'oauth.login_succeeded',
      username: user.username,
      organizationId: user.activeOrganizationId,
      ip: clientIp(req),
      metadata: { provider: 'google' },
    });

    res.redirect((user as any).registrationComplete === false ? '/?complete_registration=1' : '/');
  } catch (err) {
    console.error(`[auth] OAuth callback failed (${err instanceof Error ? err.name : 'unknown_error'}).`);
    await auditSecurityEvent({
      eventType: 'oauth.callback_failed',
      ip: clientIp(req),
      metadata: { stage: 'unexpected' },
    });
    res.status(500).send('OAuth2 flow failed');
  }
});

authRouter.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ success: true });
});

authRouter.get('/me', async (req, res) => {
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
      enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks', 'audit'],
      registrationComplete: true,
      isMasterAdmin: true,
    });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === session.username);
  if (!validSessionForUser(session, user)) {
    return res.status(401).json({ error: 'User not found' });
  }
  if (user.activeOrganizationId && !db.memberships?.some((membership: any) => (
    membership.userId === user.username && membership.organizationId === user.activeOrganizationId
  ))) {
    return res.status(401).json({ error: 'Session is no longer authorized for the active organization' });
  }

  res.json(publicUser(user, {
    role: activeMembershipRole(db, user),
    ...(session.impersonatedBy ? { impersonatedBy: session.impersonatedBy } : {})
  }));
});

authRouter.post('/complete_registration', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['maranios_session'];
  const session = verifySessionToken(token);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  ensureDbCollections(db);
  const user = db.users.find(u => u.username === session.username) as any;
  if (!validSessionForUser(session, user)) {
    return res.status(401).json({ error: 'User not found' });
  }
  if (user.registrationComplete !== false) {
    return res.status(409).json({ error: 'Registration is already complete' });
  }

  const cleanFullName = cleanText(req.body?.fullName || user.fullName);
  if (!cleanFullName) {
    return res.status(400).json({ error: 'Full name is required' });
  }
  if (!isKnownRole(req.body?.role)) {
    return res.status(400).json({ error: 'A valid role is required' });
  }

  const enabledModules = selectedModules(req.body?.enabledModules);
  if (enabledModules.length === 0) {
    return res.status(400).json({ error: 'Select at least one workspace module' });
  }

  const companyProfile = normalizeCompanyProfile(req.body?.companyProfile, user.email);
  if (!companyProfile.companyName) {
    return res.status(400).json({ error: 'Company or estate name is required' });
  }

  user.fullName = cleanFullName;
  user.role = req.body.role;
  user.sessionVersion = sessionVersionForUser(user) + 1;
  user.language = normalizeLanguage(req.body?.language || user.language);
  user.enabledModules = enabledModules;
  user.enabledWidgets = selectedWidgets(req.body?.enabledWidgets, enabledModules);
  user.registrationComplete = true;

  const data = await getUserData(user.username) || createEmptyUserData();
  data.companyProfile = {
    ...createEmptyUserData().companyProfile,
    ...data.companyProfile,
    ...companyProfile,
  };

  const orgId = user.activeOrganizationId;
  const org = orgId ? db.organizations.find(o => o.id === orgId) : null;
  if (org) {
    org.name = companyProfile.companyName;
  }

  await saveCoreMetadata('auth-complete-registration');
  await saveUserData(user.username, data, { updatedBy: 'auth-complete-registration' });

  const newToken = createSessionToken(sessionPayloadForUser(user, user.role), true);
  res.setHeader('Set-Cookie', sessionCookie(newToken, 2592000));
  res.json(publicUser(user));
});

authRouter.post('/update_profile', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['maranios_session'];
  const session = verifySessionToken(token);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === session.username);
  if (!validSessionForUser(session, user)) {
    return res.status(401).json({ error: 'User not found' });
  }

  const { fullName, language, enabledModules, enabledWidgets } = req.body;
  if (fullName !== undefined) user.fullName = cleanText(fullName) || user.fullName;
  if (language !== undefined) user.language = normalizeLanguage(language);
  if (enabledModules !== undefined) {
    const modules = selectedModules(enabledModules);
    if (modules.length === 0) {
      return res.status(400).json({ error: 'Select at least one workspace module' });
    }
    (user as any).enabledModules = modules;
    if (enabledWidgets === undefined) {
      (user as any).enabledWidgets = selectedWidgets((user as any).enabledWidgets, modules);
    }
  }
  if (enabledWidgets !== undefined) {
    const modules = selectedModules((user as any).enabledModules, DEFAULT_MODULES);
    (user as any).enabledWidgets = selectedWidgets(enabledWidgets, modules);
  }

  await saveCoreMetadata('auth-update-profile');

  res.json(publicUserForActiveOrganization(db, user));
});

// ── Organization Endpoints ─────────────────────────────────────────────

orgRouter.post('/invite', checkWineryScope('manage_users'), async (req, res) => {
  const session = (req as any).wineryContext;

  const { email, role } = req.body;
  if (!email || !role) {
    return res.status(400).json({ error: 'Email and role are required' });
  }
  if (!isValidEmail(String(email).toLowerCase().trim())) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (!isKnownRole(role)) {
    return res.status(400).json({ error: 'A valid role is required' });
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

  if (!await consumeRateLimit(invitationLimiter, [
    rateLimitKey('invitation-create-ip', req),
    rateLimitKey('invitation-create-actor', req, session.username),
  ], res)) return;

  const existingPending = db.invitations?.find((candidate: any) => (
    candidate.organizationId === orgId
    && sameNormalizedEmail(candidate.email, cleanEmail)
    && !candidate.acceptedAt
    && new Date(candidate.expiresAt).getTime() > Date.now()
  ));
  if (existingPending) {
    return res.status(409).json({ error: 'A current invitation already exists for this email address' });
  }

  const inviteToken = generateVerificationToken();
  const inviteId = 'invite_' + Math.random().toString(36).substr(2, 9);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const invitation: any = {
    id: inviteId,
    email: cleanEmail,
    organizationId: orgId,
    role: role,
    tokenHash: inviteToken.tokenHash,
    expiresAt: expiresAt.toISOString(),
    acceptedAt: null,
  };

  if (!db.invitations) db.invitations = [];
  db.invitations.push(invitation);
  await saveCoreMetadata('org-invite-create');

  const link = `${appBaseUrl(req)}/accept-invite?token=${inviteToken.token}`;
  let mail;
  try {
    mail = await sendMail(buildInvitationEmail({
      to: cleanEmail,
      inviterName: user.fullName,
      orgName: org?.name || 'VinOS Estate',
      link,
      lang: user.language
    }));
  } catch {
    // The raw token is intentionally gone after this request. Mark the record
    // unusable so a failed delivery cannot leave a misleading pending invite.
    invitation.acceptedAt = new Date().toISOString();
    await saveCoreMetadata('org-invite-delivery-failed');
    await auditSecurityEvent({
      eventType: 'email.delivery_failed',
      username: user.username,
      actorUsername: user.username,
      organizationId: orgId,
      ip: clientIp(req),
      metadata: { purpose: 'invitation' },
    });
    return res.status(503).json({ error: 'The invitation email could not be delivered. Please try again later.' });
  }

  await auditSecurityEvent({
    eventType: 'invitation.created',
    username: cleanEmail,
    actorUsername: user.username,
    organizationId: orgId,
    ip: clientIp(req),
    metadata: { role },
  });

  const exposeVerifyLink = (transport: 'smtp' | 'console'): boolean => {
    return transport === 'console' && process.env.NODE_ENV !== 'production';
  };

  if (exposeVerifyLink(mail.transport)) {
    return res.json({ ok: true, devInviteUrl: link });
  }

  res.json({ ok: true });
});

orgRouter.get('/invitations/:token', async (req, res) => {
  const { token } = req.params;
  if (!await consumeRateLimit(invitationLimiter, [
    rateLimitKey('invitation-read-ip', req),
  ], res)) return;
  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const invite = db.invitations?.find(i => i.tokenHash === hashToken(token));

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

orgRouter.post('/accept-invite', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Invitation token is required' });
  }
  if (!await consumeRateLimit(invitationLimiter, [
    rateLimitKey('invitation-accept-ip', req),
  ], res)) return;

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies['maranios_session'];
  const session = verifySessionToken(sessionToken);

  if (!session) {
    return res.status(401).json({ error: 'Authentication required. Please sign in or register to accept the invitation.' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === session.username);
  if (!validSessionForUser(session, user)) {
    return res.status(401).json({ error: 'User not found' });
  }

  const result = await acceptInvitationAtomically(hashToken(String(token)), user.username);
  if (result.status === 'not_found') return res.status(404).json({ error: 'Invitation not found' });
  if (result.status === 'already_accepted') return res.status(400).json({ error: 'Invitation has already been accepted' });
  if (result.status === 'expired') return res.status(400).json({ error: 'Invitation has expired' });
  if (result.status === 'email_mismatch') {
    return res.status(403).json({ error: 'This invitation was issued to a different email address' });
  }
  if (result.status === 'email_unverified') {
    return res.status(403).json({ error: 'Verify your email before accepting this invitation' });
  }
  if (result.status !== 'success' || !result.organizationId || !result.role) {
    return res.status(401).json({ error: 'User not found' });
  }

  const refreshedUser = getDB().users.find(candidate => candidate.username === user.username) || user;
  const newToken = createSessionToken(sessionPayloadForUser(refreshedUser, result.role), true);
  res.setHeader('Set-Cookie', sessionCookie(newToken, 2592000));
  await auditSecurityEvent({
    eventType: 'invitation.accepted',
    username: user.username,
    actorUsername: user.username,
    organizationId: result.organizationId,
    ip: clientIp(req),
    metadata: { role: result.role },
  });

  res.json({ ok: true, activeOrganizationId: result.organizationId });
});

orgRouter.post('/switch', async (req, res) => {
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
  if (!validSessionForUser(session, user)) {
    return res.status(401).json({ error: 'User not found' });
  }

  const membership = db.memberships?.find(m => m.userId === user.username && m.organizationId === organizationId);
  if (!membership) {
    return res.status(403).json({ error: 'You are not a member of this organization' });
  }
  if (!isKnownRole(membership.role)) {
    return res.status(403).json({ error: 'The organization membership has an invalid role' });
  }

  user.activeOrganizationId = organizationId;
  await saveCoreMetadata('org-switch');

  const newToken = createSessionToken(sessionPayloadForUser(user, membership.role), true);
  res.setHeader('Set-Cookie', sessionCookie(newToken, 2592000));

  res.json(buildOrganizationSwitchResponse(organizationId, membership.role));
});

orgRouter.get('/members', checkWineryScope('read'), async (req, res) => {
  const session = (req as any).wineryContext;

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

  const pendingInvites = (db.invitations?.filter(i => (
    i.organizationId === orgId && !i.acceptedAt && new Date(i.expiresAt) > new Date()
  )) || []).map((invite: any) => ({
    id: invite.id,
    email: invite.email,
    organizationId: invite.organizationId,
    role: invite.role,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  }));

  res.json({ members, pendingInvites });
});

orgRouter.get('/list', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies['maranios_session'];
  const session = verifySessionToken(sessionToken);

  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === session.username);
  if (!validSessionForUser(session, user)) return res.status(401).json({ error: 'User not found' });

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

export { orgRouter };
export default authRouter;
