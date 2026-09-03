import express from 'express';
import { checkWineryScope, requireMasterAdmin, isMasterAdmin , loginLimiter, sessionCookie, parseCookies } from '../middleware/auth';
import { getDeploymentStatus, applyRuntimeScaleReadinessProbe } from '../deploymentStatus';
import {
  getDB,
  getUserData,
  saveCoreMetadata,
  saveUserData,
  resetUserData,
  deleteUserMetadataFromPostgres,
  refreshCoreMetadataFromPostgres,
  getPostgresReadinessProbe,
  forceSaveDB,
  reloadOrganizationDataFromPostgres,
  getDbRuntimeStatus,
  listSecurityAuditEvents,
  createEmptyUserData,
  saveOrganizationData,
  deleteOrganizationMetadataFromPostgres,
  deleteMembershipMetadataFromPostgres,
} from '../db';
import { getSeederData } from '../seedTestUser';
import { getRecentClientErrors } from './telemetry';

import {
  hashPassword,
  verifySessionToken,
  createSessionToken,
  passcodeValidationError,
  sessionPayloadForUser,
  sessionVersionForUser,
  userAccountIsEnabled,
} from '../auth';
import { generateVerificationToken, isValidEmail } from '../emailVerification';
import { buildInvitationEmail, buildResetPasswordEmail, sendMail } from '../mailer';
import { isKnownRole, permissionsForRole } from '../permissions';
import {
  applyApprovalDecision,
  approvalStatusForUser,
  describeApprovalRequest,
  sendApprovalDecisionNotice,
} from '../registrationApproval';
import { registrationApprovalBlockers } from '../registrationProfile';
import { appBaseUrl, clientIp } from '../config';
import { auditSecurityEvent } from '../securityAudit';
import {
  summarizeAiDrafts,
  summarizeAttachments,
  summarizeCrmLeads,
  summarizeOrgData,
} from '../adminOrgSummary';
import { getOperationalTelemetrySnapshot } from '../operationalTelemetry';

const router = express.Router();

// ── Master-admin action trail ────────────────────────────────────────────────
interface AdminAction {
  at: string;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
}
const ADMIN_ACTIONS_CAP = 500;
const adminActions: AdminAction[] = [];

export function recordAdminAction(actor: string, action: string, target?: string, detail?: string): void {
  adminActions.unshift({ at: new Date().toISOString(), actor, action, target, detail });
  if (adminActions.length > ADMIN_ACTIONS_CAP) adminActions.length = ADMIN_ACTIONS_CAP;
}

function cleanOrganizationName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function organizationNameError(name: string): string | null {
  if (name.length < 2) return 'Organization name must contain at least 2 characters';
  if (name.length > 120) return 'Organization name cannot exceed 120 characters';
  return null;
}

function adminRecordId(prefix: 'org' | 'mem'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const ORGANIZATION_STATUSES = new Set(['active', 'suspended', 'archived']);

function userIsOnline(lastSeenAt: unknown, now = Date.now()): boolean {
  const seen = typeof lastSeenAt === 'string' ? new Date(lastSeenAt).getTime() : NaN;
  return Number.isFinite(seen) && now - seen <= ONLINE_WINDOW_MS;
}

function organizationActivity(data: any): string | null {
  let latest: string | null = null;
  for (const collection of Object.values(data || {})) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      const candidate = item?.lastModified || item?.updatedAt || item?.createdAt || item?.date || null;
      if (typeof candidate === 'string' && (!latest || candidate > latest)) latest = candidate;
    }
  }
  return latest;
}

function organizationHealth(db: ReturnType<typeof getDB>, org: any) {
  const members = db.memberships.filter(item => item.organizationId === org.id);
  const owners = members.filter(item => item.role === 'Owner/Admin');
  const data = db.orgData[org.id] || {};
  const lastActivity = organizationActivity(data);
  const issues: string[] = [];
  if (members.length === 0) issues.push('No members assigned');
  if (owners.length === 0) issues.push('No Owner/Admin assigned');
  if ((org.status || 'active') !== 'active') issues.push(`Organization is ${org.status}`);
  if (org.deletionScheduledAt) issues.push('Permanent deletion is scheduled');
  if (!lastActivity) issues.push('No operational activity recorded');
  return {
    level: issues.some(issue => /No members|No Owner|deletion/i.test(issue)) ? 'critical' : issues.length ? 'warning' : 'healthy',
    issues,
    lastActivity,
  };
}

async function deliverAdminInvitation(
  req: express.Request,
  invitation: any,
  organization: any,
  actorUsername: string,
  language: string,
) {
  const token = generateVerificationToken();
  invitation.tokenHash = token.tokenHash;
  invitation.expiresAt = new Date(token.expiresAt).toISOString();
  invitation.acceptedAt = null;
  invitation.revokedAt = null;
  const link = `${appBaseUrl(req)}/accept-invite?token=${token.token}`;
  const delivery = await sendMail(buildInvitationEmail({
    to: invitation.email,
    inviterName: actorUsername,
    orgName: organization.name,
    link,
    lang: language,
  }));
  return { delivery, link };
}

// ── Event-loop lag sampler ───────────────────────────────────────────────────
let eventLoopLagMs = 0;
{
  const SAMPLE_EVERY_MS = 500;
  let last = Date.now();
  const sampler = setInterval(() => {
    const t = Date.now();
    eventLoopLagMs = Math.max(0, t - last - SAMPLE_EVERY_MS);
    last = t;
  }, SAMPLE_EVERY_MS);
  sampler.unref?.();
}

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

// GET /api/admin/deployment-status
router.get('/deployment-status', checkWineryScope('admin'), async (req, res) => {
  res.json(getDeploymentStatus());
});

// GET /api/admin/system-health
router.get('/system-health', async (req, res) => {
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

// GET /api/admin/export
router.get('/export', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const db = getDB();
  const exportedAt = new Date().toISOString();
  const snapshot: any = {
    exportedAt,
    scope: 'system',
    db: scrubSensitiveForExport(db),
  };
  delete snapshot.db.userData;
  const filename = exportFilename('vinos_system_export');

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(snapshot, null, 2));
});

// GET /api/admin/orgs/export?id=org_...
router.get('/orgs/export', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const organizationId = String(req.query.id || '').trim();
  if (!organizationId) return res.status(400).json({ error: 'Organization id is required' });

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const organization = db.organizations.find(candidate => candidate.id === organizationId);
  if (!organization) return res.status(404).json({ error: 'Organization not found' });

  const persisted = await reloadOrganizationDataFromPostgres(organizationId);
  const organizationData = persisted?.data || db.orgData[organizationId] || {};
  const memberships = db.memberships.filter(item => item.organizationId === organizationId);
  const members = memberships.map(membership => {
    const user = db.users.find(candidate => candidate.username === membership.userId);
    return {
      username: membership.userId,
      fullName: user?.fullName || '',
      email: user?.email || '',
      role: membership.role,
      accountEnabled: user?.accountEnabled !== false,
      approvalStatus: user ? approvalStatusForUser(user) : 'unknown',
      lastSeenAt: user?.lastSeenAt || null,
    };
  });
  const invitations = db.invitations
    .filter(invitation => invitation.organizationId === organizationId)
    .map(invitation => scrubSensitiveForExport(invitation));
  const snapshot = {
    exportedAt: new Date().toISOString(),
    scope: 'organization',
    organization: scrubSensitiveForExport(organization),
    members,
    invitations,
    data: scrubSensitiveForExport(organizationData),
  };

  recordAdminAction(auth.username, 'organization.export', organizationId, `members=${members.length}`);
  await auditSecurityEvent({
    eventType: 'admin.organization_exported',
    actorUsername: auth.username,
    organizationId,
    ip: clientIp(req),
    metadata: { members: members.length, invitations: invitations.length },
  });

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(`vinos_organization_${organizationId.replace(/[^a-zA-Z0-9_-]/g, '_')}`)}"`);
  res.send(JSON.stringify(snapshot, null, 2));
});

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const db = getDB();
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();
  const dbStatus = getDbRuntimeStatus();
  const orgSummaries = Object.values(db.orgData || {}).map(data => summarizeOrgData(data as any));
  const sumOrgMetric = (key: keyof ReturnType<typeof summarizeOrgData>) =>
    orgSummaries.reduce((total, summary) => total + Number(summary[key] || 0), 0);

  res.json({
    ok: true,
    usersCount: db.users.length,
    orgsCount: db.organizations?.length || 0,
    membershipsCount: db.memberships?.length || 0,
    invitationsCount: db.invitations?.length || 0,
    attachmentsCount: sumOrgMetric('attachmentsCount'),
    crmLeadsCount: sumOrgMetric('crmLeadsCount'),
    aiDraftsCount: sumOrgMetric('aiDraftsCount'),
    inlineAttachmentBytes: sumOrgMetric('inlineAttachmentBytes'),
    memoryHeapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    memoryHeapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    memoryRssMB: Math.round(memoryUsage.rss / 1024 / 1024),
    eventLoopLagMs,
    uptimeSeconds: Math.round(uptime),
    persistenceMode: dbStatus.activeBackendLabel,
    nodeEnv: process.env.NODE_ENV || 'development'
  });
});

// GET /api/admin/client-errors — recent client-side crashes (ErrorBoundary /
// chunk-load reports), newest first. In-memory ring buffer, see telemetry.ts.
router.get('/client-errors', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  res.json({ ok: true, errors: getRecentClientErrors() });
});

// GET /api/admin/operational-metrics — bounded, payload-free sync/command signals.
router.get('/operational-metrics', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  res.json({ ok: true, ...getOperationalTelemetrySnapshot() });
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const now = Date.now();
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
      accountEnabled: u.accountEnabled !== false,
      approvalStatus: approvalStatusForUser(u),
      isDemo: u.isDemo,
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt || null,
      isOnline: userIsOnline(u.lastSeenAt, now),
      activeOrganizationId: u.activeOrganizationId || null,
      organizations: orgs
    };
  });

  res.json({ ok: true, users: usersWithOrgs });
});

// GET /api/admin/registrations/pending — accounts waiting for a human decision.
router.get('/registrations/pending', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const waiting = db.users.filter(user => approvalStatusForUser(user) === 'pending');
  const pending = await Promise.all(waiting.map(async user => {
    const data = await getUserData(user.username);
    return {
      ...describeApprovalRequest(user, data?.companyProfile),
      approvalBlockedReasons: registrationApprovalBlockers(user, data?.companyProfile),
    };
  }));
  pending.sort((a, b) => String(a.requestedAt || '').localeCompare(String(b.requestedAt || '')));

  res.json({ ok: true, pending });
});

// POST /api/admin/registrations/decide — approve or reject a requested account.
router.post('/registrations/decide', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const { username, decision } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: 'Decision must be either approve or reject' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(u => u.username === username) as any;
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const approved = decision === 'approve';
  if (approved) {
    const data = await getUserData(user.username);
    const blockers = registrationApprovalBlockers(user, data?.companyProfile);
    if (blockers.length > 0) {
      return res.status(422).json({
        error: `This request cannot be approved until the applicant provides: ${blockers.join(', ')}`,
        code: 'registration_profile_incomplete',
        missing: blockers,
      });
    }
  }
  applyApprovalDecision(user, decision, auth.username);
  if (!approved) {
    // Revoke anything the account already holds.
    user.sessionVersion = sessionVersionForUser(user) + 1;
  }
  await saveCoreMetadata('admin-registration-decision');

  await sendApprovalDecisionNotice(user, approved, appBaseUrl(req));
  recordAdminAction(auth.username, `registration.${decision}`, username);
  await auditSecurityEvent({
    eventType: approved ? 'account.approved' : 'account.rejected',
    username,
    actorUsername: auth.username,
    organizationId: user.activeOrganizationId,
    ip: clientIp(req),
    metadata: { via: 'master_console' },
  });

  res.json({ ok: true, approvalStatus: user.approvalStatus });
});

// POST /api/admin/users/update
router.post('/users/update', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const { username, email, role, emailVerified, accountEnabled, passcode } = req.body;
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
    if (!isKnownRole(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    user.role = role;
  }

  if (emailVerified !== undefined) {
    user.emailVerified = !!emailVerified;
  }

  if (accountEnabled !== undefined) {
    if (typeof accountEnabled !== 'boolean') {
      return res.status(400).json({ error: 'accountEnabled must be a boolean' });
    }
    user.accountEnabled = accountEnabled;
  }

  if (passcode !== undefined) {
    const trimmed = String(passcode).trim();
    const passcodeError = passcodeValidationError(trimmed);
    if (passcodeError) return res.status(400).json({ error: passcodeError });
    user.passwordHash = hashPassword(trimmed);
  }

  if ([email, role, emailVerified, accountEnabled, passcode].some(value => value !== undefined)) {
    user.sessionVersion = sessionVersionForUser(user) + 1;
  }

  await saveCoreMetadata('admin-user-update');
  const changed = [
    email !== undefined ? 'email' : '',
    role !== undefined ? 'role' : '',
    emailVerified !== undefined ? 'emailVerified' : '',
    accountEnabled !== undefined ? 'accountEnabled' : '',
    passcode !== undefined ? 'passcode' : '',
  ].filter(Boolean).join(', ');
  recordAdminAction(auth.username, 'user.update', username, changed);
  await auditSecurityEvent({
    eventType: 'admin.user_updated',
    username,
    actorUsername: auth.username,
    organizationId: user.activeOrganizationId,
    ip: clientIp(req),
    metadata: { changed },
  });
  res.json({ ok: true, message: 'User updated successfully' });
});

// GET /api/admin/role-permissions
router.get('/role-permissions', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const roles = ['Owner/Admin', 'Winemaker', 'Viticulturist', 'Lab Technician', 'Cellar Worker', 'Read-Only'];
  res.json({
    ok: true,
    roles: roles.map(role => ({ role, permissions: permissionsForRole(role) })),
  });
});

// POST /api/admin/users/security-action
router.post('/users/security-action', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const username = String(req.body?.username || '').trim();
  const action = String(req.body?.action || '').trim();
  if (!username || !action) return res.status(400).json({ error: 'Username and action are required' });
  if (isMasterAdmin(username)) return res.status(400).json({ error: 'The environment master administrator cannot be changed here' });

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const user = db.users.find(candidate => candidate.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (action === 'unlock') {
    const identifiers = [user.username, user.email].map(value => String(value || '').toLowerCase());
    const entries = await loginLimiter.list();
    const matching = entries.filter(entry => identifiers.some(identifier => entry.key.toLowerCase().endsWith(`:${identifier}`)));
    await Promise.all(matching.map(entry => loginLimiter.clear(entry.key)));
    recordAdminAction(auth.username, 'user.unlock', user.username, `cleared=${matching.length}`);
    await auditSecurityEvent({
      eventType: 'admin.user_unlocked', username: user.username, actorUsername: auth.username,
      organizationId: user.activeOrganizationId, ip: clientIp(req), metadata: { clearedEntries: matching.length },
    });
    return res.json({ ok: true, clearedEntries: matching.length });
  }

  if (action === 'revoke_sessions') {
    user.sessionVersion = sessionVersionForUser(user) + 1;
    await saveCoreMetadata('admin-revoke-user-sessions');
    recordAdminAction(auth.username, 'user.sessions.revoke', user.username);
    await auditSecurityEvent({
      eventType: 'admin.user_sessions_revoked', username: user.username, actorUsername: auth.username,
      organizationId: user.activeOrganizationId, ip: clientIp(req),
    });
    return res.json({ ok: true, sessionVersion: user.sessionVersion });
  }

  if (action === 'force_password_reset') {
    const reset = generateVerificationToken();
    user.resetTokenHash = reset.tokenHash;
    user.resetTokenExpires = reset.expiresAt;
    user.sessionVersion = sessionVersionForUser(user) + 1;
    await saveCoreMetadata('admin-force-password-reset');
    const link = `${appBaseUrl(req)}/?reset_token=${reset.token}&u=${encodeURIComponent(user.username)}`;
    try {
      const delivery = await sendMail(buildResetPasswordEmail({
        to: user.email, link, lang: user.language, wineryName: 'VinOS',
      }));
      recordAdminAction(auth.username, 'user.password_reset.force', user.username, `transport=${delivery.transport}`);
      await auditSecurityEvent({
        eventType: 'admin.password_reset_forced', username: user.username, actorUsername: auth.username,
        organizationId: user.activeOrganizationId, ip: clientIp(req), metadata: { transport: delivery.transport },
      });
      return res.json({ ok: true, delivered: delivery.delivered, transport: delivery.transport });
    } catch {
      await auditSecurityEvent({
        eventType: 'email.delivery_failed', username: user.username, actorUsername: auth.username,
        organizationId: user.activeOrganizationId, ip: clientIp(req), metadata: { purpose: 'admin_password_reset' },
      });
      return res.status(503).json({ error: 'The reset was prepared, but the email could not be delivered' });
    }
  }

  return res.status(400).json({ error: 'Unknown security action' });
});

// POST /api/admin/users/bulk
router.post('/users/bulk', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const usernames: string[] = Array.isArray(req.body?.usernames)
    ? [...new Set<string>(req.body.usernames.map((value: unknown) => String(value).trim()).filter(Boolean))].slice(0, 100)
    : [];
  const action = String(req.body?.action || '').trim();
  if (!usernames.length) return res.status(400).json({ error: 'Select at least one user' });
  if (!['enable', 'disable', 'revoke_sessions', 'assign'].includes(action)) {
    return res.status(400).json({ error: 'Unknown bulk user action' });
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const targets = db.users.filter(user => usernames.some(username => username.toLowerCase() === user.username.toLowerCase()));
  if (!targets.length) return res.status(404).json({ error: 'No matching users found' });

  const organizationId = String(req.body?.organizationId || '').trim();
  const role = req.body?.role;
  if (action === 'assign') {
    if (!db.organizations.some(org => org.id === organizationId)) return res.status(404).json({ error: 'Organization not found' });
    if (!isKnownRole(role)) return res.status(400).json({ error: 'A valid membership role is required' });
  }

  let changed = 0;
  for (const user of targets) {
    if (action === 'enable' || action === 'disable') {
      const enabled = action === 'enable';
      if (user.accountEnabled !== enabled) {
        user.accountEnabled = enabled;
        user.sessionVersion = sessionVersionForUser(user) + 1;
        changed += 1;
      }
    } else if (action === 'revoke_sessions') {
      user.sessionVersion = sessionVersionForUser(user) + 1;
      changed += 1;
    } else if (action === 'assign') {
      const existing = db.memberships.find(item => item.userId === user.username && item.organizationId === organizationId);
      if (existing) {
        if (existing.role !== role) { existing.role = role; changed += 1; }
      } else {
        db.memberships.push({
          id: adminRecordId('mem'), userId: user.username, organizationId, role,
          createdAt: new Date().toISOString(),
        });
        changed += 1;
      }
      if (!user.activeOrganizationId) {
        user.activeOrganizationId = organizationId;
        user.role = role;
        user.sessionVersion = sessionVersionForUser(user) + 1;
      }
    }
  }

  await saveCoreMetadata(`admin-users-bulk-${action}`);
  recordAdminAction(auth.username, `users.bulk.${action}`, `${targets.length} users`, `changed=${changed}`);
  await auditSecurityEvent({
    eventType: `admin.users_bulk_${action}`,
    actorUsername: auth.username,
    organizationId: action === 'assign' ? organizationId : null,
    ip: clientIp(req),
    metadata: { requested: usernames.length, matched: targets.length, changed, role: action === 'assign' ? role : undefined },
  });
  res.json({ ok: true, matched: targets.length, changed });
});

// POST /api/admin/users/delete
router.post('/users/delete', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const envAdmin = isMasterAdmin(username);
  if (envAdmin) {
    return res.status(400).json({ error: 'Cannot delete the master administrator' });
  }

  const db = getDB();
  const userIndex = db.users.findIndex(u => u.username === username);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  /**
   * Deleting a user used to remove the account and its memberships and stop
   * there, leaving the organization and its entire operational record behind
   * with nobody able to reach it. Two problems in one: a winery's history was
   * silently stranded rather than deleted, and "remove this account" did not
   * actually remove that account's data.
   *
   * So the caller has to say out loud which workspaces it accepts destroying.
   * The ids it sends must match the ones this deletion would actually strand —
   * an admin who has not seen the consequence cannot guess them, which is what
   * makes an accidental click impossible.
   */
  const remainingMemberships = (db.memberships || []).filter(m => m.userId !== username);
  const orphanedOrganizations = (db.memberships || [])
    .filter(m => m.userId === username)
    .map(m => m.organizationId)
    .filter((orgId, index, all) => all.indexOf(orgId) === index)
    .filter(orgId => !remainingMemberships.some(m => m.organizationId === orgId));

  const acknowledged: string[] = Array.isArray(req.body?.confirmOrphanedOrganizations)
    ? req.body.confirmOrphanedOrganizations.map(String)
    : [];
  const unacknowledged = orphanedOrganizations.filter(orgId => !acknowledged.includes(orgId));

  if (unacknowledged.length > 0) {
    return res.status(409).json({
      code: 'orphaned_organizations_require_confirmation',
      error: 'Deleting this account would leave one or more wineries with no members. Confirm which workspaces may be destroyed.',
      organizations: unacknowledged.map(orgId => {
        const org = db.organizations?.find(o => o.id === orgId);
        const summary = summarizeOrgData(db.orgData?.[orgId] || {});
        return {
          id: orgId,
          name: org?.name || orgId,
          lotsCount: summary.lotsCount,
          tanksCount: summary.tanksCount,
          attachmentsCount: summary.attachmentsCount,
          dataSize: summary.dataSizeBytes,
        };
      }),
    });
  }

  db.memberships = remainingMemberships;

  // Now that the consequence is acknowledged, remove the stranded workspaces
  // rather than leaving them unreachable but still stored.
  for (const orgId of orphanedOrganizations) {
    delete db.orgData?.[orgId];
    if (db.organizations) {
      db.organizations = db.organizations.filter(o => o.id !== orgId);
    }
  }

  // Delete user
  db.users.splice(userIndex, 1);
  await deleteUserMetadataFromPostgres(username);
  for (const orgId of orphanedOrganizations) {
    await deleteOrganizationMetadataFromPostgres(orgId);
  }
  await saveCoreMetadata('admin-user-delete');

  recordAdminAction(auth.username, 'user.delete', username);
  await auditSecurityEvent({
    eventType: 'admin.user_deleted',
    username,
    actorUsername: auth.username,
    ip: clientIp(req),
    // Destroying a winery's records is a much larger event than removing a
    // login, so the audit trail has to distinguish the two.
    ...(orphanedOrganizations.length
      ? { detail: `destroyed workspaces: ${orphanedOrganizations.join(', ')}` }
      : {}),
  });
  res.json({
    ok: true,
    message: 'User deleted successfully',
    deletedOrganizations: orphanedOrganizations,
  });
});

// POST /api/admin/orgs/create
router.post('/orgs/create', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const name = cleanOrganizationName(req.body?.name);
  const nameError = organizationNameError(name);
  if (nameError) return res.status(400).json({ error: nameError });

  const ownerUsername = String(req.body?.ownerUsername || '').trim();
  if (!ownerUsername) return res.status(400).json({ error: 'An initial owner is required' });
  const owner = db.users.find(user => user.username.toLowerCase() === ownerUsername.toLowerCase());
  if (!owner) return res.status(404).json({ error: 'Initial owner account not found' });
  if (db.organizations.some(org => String(org.name || '').trim().toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'An organization with this name already exists' });
  }

  const organizationId = adminRecordId('org');
  const createdAt = new Date().toISOString();
  const organization = { id: organizationId, name, status: 'active', archivedAt: null, deletionScheduledAt: null, internalNotes: '', internalTags: [], createdAt };
  const membership = {
    id: adminRecordId('mem'),
    userId: owner.username,
    organizationId,
    role: 'Owner/Admin',
    createdAt,
  };
  const data = createEmptyUserData();
  data.companyProfile.companyName = name;
  data.companyProfile.wineryName = name;

  db.organizations.push(organization);
  db.memberships.push(membership);
  db.orgData[organizationId] = data;

  let sessionRevoked = false;
  if (!owner.activeOrganizationId) {
    owner.activeOrganizationId = organizationId;
    owner.role = 'Owner/Admin';
    owner.sessionVersion = sessionVersionForUser(owner) + 1;
    sessionRevoked = true;
  }

  await saveCoreMetadata('admin-organization-create');
  await saveOrganizationData(organizationId, data, { updatedBy: auth.username });
  recordAdminAction(auth.username, 'organization.create', organizationId, `${name}; owner=${owner.username}`);
  await auditSecurityEvent({
    eventType: 'admin.organization_created',
    actorUsername: auth.username,
    username: owner.username,
    organizationId,
    ip: clientIp(req),
    metadata: { name, initialOwner: owner.username },
  });

  res.status(201).json({ ok: true, organization, membership, sessionRevoked });
});

// POST /api/admin/orgs/update
router.post('/orgs/update', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const organizationId = String(req.body?.organizationId || '').trim();
  const name = cleanOrganizationName(req.body?.name);
  if (!organizationId) return res.status(400).json({ error: 'Organization id is required' });
  const nameError = organizationNameError(name);
  if (nameError) return res.status(400).json({ error: nameError });

  const organization = db.organizations.find(org => org.id === organizationId);
  if (!organization) return res.status(404).json({ error: 'Organization not found' });
  if (db.organizations.some(org => org.id !== organizationId && String(org.name || '').trim().toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'An organization with this name already exists' });
  }

  const previousName = organization.name;
  organization.name = name;
  const data = db.orgData[organizationId];
  let profileUpdated = false;
  if (data?.companyProfile && (!data.companyProfile.companyName || data.companyProfile.companyName === previousName)) {
    data.companyProfile.companyName = name;
    profileUpdated = true;
  }

  await saveCoreMetadata('admin-organization-update');
  if (profileUpdated) {
    await saveOrganizationData(organizationId, data, { updatedBy: auth.username });
  }
  recordAdminAction(auth.username, 'organization.update', organizationId, `${previousName} -> ${name}`);
  await auditSecurityEvent({
    eventType: 'admin.organization_updated',
    actorUsername: auth.username,
    organizationId,
    ip: clientIp(req),
    metadata: { previousName, name },
  });

  res.json({ ok: true, organization: { ...organization } });
});

// POST /api/admin/orgs/internal-profile
router.post('/orgs/internal-profile', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const organizationId = String(req.body?.organizationId || '').trim();
  const internalNotes = String(req.body?.internalNotes || '').trim();
  const requestedTags = Array.isArray(req.body?.internalTags) ? req.body.internalTags : [];
  if (!organizationId) return res.status(400).json({ error: 'Organization id is required' });
  if (internalNotes.length > 2_000) return res.status(400).json({ error: 'Internal notes cannot exceed 2,000 characters' });
  if (requestedTags.length > 10) return res.status(400).json({ error: 'Use no more than 10 internal tags' });

  const internalTags: string[] = [];
  const seenTags = new Set<string>();
  for (const value of requestedTags) {
    const tag = String(value || '').trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    if (tag.length > 32) return res.status(400).json({ error: 'Internal tags cannot exceed 32 characters' });
    const key = tag.toLowerCase();
    if (!seenTags.has(key)) { internalTags.push(tag); seenTags.add(key); }
  }

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const organization = db.organizations.find(org => org.id === organizationId);
  if (!organization) return res.status(404).json({ error: 'Organization not found' });
  const previousTags = Array.isArray(organization.internalTags) ? organization.internalTags : [];
  organization.internalNotes = internalNotes;
  organization.internalTags = internalTags;
  await saveCoreMetadata('admin-organization-internal-profile');
  recordAdminAction(auth.username, 'organization.internal_profile.update', organizationId, `tags=${internalTags.join(',') || 'none'}; notes=${internalNotes.length} chars`);
  await auditSecurityEvent({
    eventType: 'admin.organization_internal_profile_updated', actorUsername: auth.username,
    organizationId, ip: clientIp(req), metadata: { previousTags, internalTags, notesLength: internalNotes.length },
  });
  res.json({ ok: true, internalNotes, internalTags });
});

// POST /api/admin/memberships/upsert
router.post('/memberships/upsert', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const username = String(req.body?.username || '').trim();
  const organizationId = String(req.body?.organizationId || '').trim();
  const role = req.body?.role;
  const makeActive = req.body?.makeActive === true;
  if (!username || !organizationId) {
    return res.status(400).json({ error: 'Username and organization id are required' });
  }
  if (!isKnownRole(role)) return res.status(400).json({ error: 'Invalid membership role' });

  const user = db.users.find(candidate => candidate.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  const organization = db.organizations.find(candidate => candidate.id === organizationId);
  if (!organization) return res.status(404).json({ error: 'Organization not found' });

  let membership = db.memberships.find(item => item.userId === user.username && item.organizationId === organizationId);
  const created = !membership;
  const previousRole = membership?.role;
  if (membership) {
    membership.role = role;
  } else {
    membership = {
      id: adminRecordId('mem'),
      userId: user.username,
      organizationId,
      role,
      createdAt: new Date().toISOString(),
    };
    db.memberships.push(membership);
  }

  const activeMembershipChanged = user.activeOrganizationId === organizationId && previousRole !== role;
  const activeOrganizationChanged = makeActive && user.activeOrganizationId !== organizationId;
  const assignedFirstOrganization = !user.activeOrganizationId;
  const sessionRevoked = activeMembershipChanged || activeOrganizationChanged || assignedFirstOrganization;
  if (makeActive || assignedFirstOrganization || user.activeOrganizationId === organizationId) {
    user.activeOrganizationId = organizationId;
    user.role = role;
  }
  if (sessionRevoked) user.sessionVersion = sessionVersionForUser(user) + 1;

  await saveCoreMetadata('admin-membership-upsert');
  const action = created ? 'membership.create' : 'membership.update';
  recordAdminAction(auth.username, action, `${user.username}@${organizationId}`, `${previousRole || 'none'} -> ${role}${makeActive ? '; made active' : ''}`);
  await auditSecurityEvent({
    eventType: created ? 'admin.membership_created' : 'admin.membership_updated',
    username: user.username,
    actorUsername: auth.username,
    organizationId,
    ip: clientIp(req),
    metadata: { previousRole: previousRole || null, role, makeActive, sessionRevoked },
  });

  res.json({ ok: true, membership, activeOrganizationId: user.activeOrganizationId, sessionRevoked });
});

// POST /api/admin/orgs/lifecycle
router.post('/orgs/lifecycle', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const organizationId = String(req.body?.organizationId || '').trim();
  const status = String(req.body?.status || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!ORGANIZATION_STATUSES.has(status)) return res.status(400).json({ error: 'Status must be active, suspended, or archived' });
  if (reason.length < 5 || reason.length > 300) return res.status(400).json({ error: 'A reason between 5 and 300 characters is required' });

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const organization = db.organizations.find(candidate => candidate.id === organizationId);
  if (!organization) return res.status(404).json({ error: 'Organization not found' });
  const previousStatus = organization.status || 'active';

  let deletionScheduledAt: string | null = organization.deletionScheduledAt || null;
  if (req.body?.deletionScheduledAt !== undefined) {
    if (req.body.deletionScheduledAt === null || req.body.deletionScheduledAt === '') {
      deletionScheduledAt = null;
    } else {
      const scheduled = new Date(req.body.deletionScheduledAt);
      if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'Deletion must be scheduled for a future date' });
      }
      deletionScheduledAt = scheduled.toISOString();
    }
  }

  organization.status = status;
  organization.archivedAt = status === 'archived' ? (organization.archivedAt || new Date().toISOString()) : null;
  organization.deletionScheduledAt = deletionScheduledAt;

  let revokedSessions = 0;
  if (status !== previousStatus && status !== 'active') {
    for (const membership of db.memberships.filter(item => item.organizationId === organizationId)) {
      const user = db.users.find(candidate => candidate.username === membership.userId);
      if (!user || user.activeOrganizationId !== organizationId) continue;
      user.sessionVersion = sessionVersionForUser(user) + 1;
      revokedSessions += 1;
    }
  }

  await saveCoreMetadata('admin-organization-lifecycle');
  recordAdminAction(auth.username, 'organization.lifecycle', organizationId, `${previousStatus} -> ${status}; reason=${reason}`);
  await auditSecurityEvent({
    eventType: 'admin.organization_lifecycle_changed', actorUsername: auth.username,
    organizationId, ip: clientIp(req),
    metadata: { previousStatus, status, deletionScheduledAt, revokedSessions, reason },
  });
  res.json({ ok: true, organization, revokedSessions });
});

// POST /api/admin/orgs/transfer-ownership
router.post('/orgs/transfer-ownership', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const organizationId = String(req.body?.organizationId || '').trim();
  const newOwnerUsername = String(req.body?.newOwnerUsername || '').trim();
  const previousOwnerUsername = String(req.body?.previousOwnerUsername || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!organizationId || !newOwnerUsername) return res.status(400).json({ error: 'Organization and new owner are required' });
  if (reason.length < 5 || reason.length > 300) return res.status(400).json({ error: 'A reason between 5 and 300 characters is required' });

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  if (!db.organizations.some(org => org.id === organizationId)) return res.status(404).json({ error: 'Organization not found' });
  const newOwner = db.users.find(user => user.username.toLowerCase() === newOwnerUsername.toLowerCase());
  if (!newOwner) return res.status(404).json({ error: 'New owner account not found' });

  let nextMembership = db.memberships.find(item => item.userId === newOwner.username && item.organizationId === organizationId);
  if (!nextMembership) {
    nextMembership = {
      id: adminRecordId('mem'), userId: newOwner.username, organizationId,
      role: 'Owner/Admin', createdAt: new Date().toISOString(),
    };
    db.memberships.push(nextMembership);
  } else {
    nextMembership.role = 'Owner/Admin';
  }

  const previousMembership = previousOwnerUsername
    ? db.memberships.find(item => item.userId.toLowerCase() === previousOwnerUsername.toLowerCase() && item.organizationId === organizationId)
    : null;
  if (previousMembership && previousMembership.userId !== newOwner.username && previousMembership.role === 'Owner/Admin') {
    previousMembership.role = 'Winemaker';
  }

  const affected = new Set([newOwner.username, previousMembership?.userId].filter(Boolean));
  for (const username of affected) {
    const user = db.users.find(candidate => candidate.username === username);
    const membership = db.memberships.find(item => item.userId === username && item.organizationId === organizationId);
    if (user && membership && user.activeOrganizationId === organizationId) {
      user.role = membership.role;
      user.sessionVersion = sessionVersionForUser(user) + 1;
    }
  }

  await saveCoreMetadata('admin-transfer-ownership');
  recordAdminAction(auth.username, 'organization.owner.transfer', organizationId, `${previousOwnerUsername || 'none'} -> ${newOwner.username}; reason=${reason}`);
  await auditSecurityEvent({
    eventType: 'admin.organization_ownership_transferred', actorUsername: auth.username,
    username: newOwner.username, organizationId, ip: clientIp(req),
    metadata: { previousOwnerUsername: previousOwnerUsername || null, newOwnerUsername: newOwner.username, reason },
  });
  res.json({ ok: true, previousOwnerUsername: previousOwnerUsername || null, newOwnerUsername: newOwner.username });
});

// POST /api/admin/orgs/bulk
router.post('/orgs/bulk', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const organizationIds: string[] = Array.isArray(req.body?.organizationIds)
    ? [...new Set<string>(req.body.organizationIds.map((value: unknown) => String(value).trim()).filter(Boolean))].slice(0, 100)
    : [];
  const status = String(req.body?.status || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!organizationIds.length) return res.status(400).json({ error: 'Select at least one organization' });
  if (!ORGANIZATION_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid organization status' });
  if (reason.length < 5 || reason.length > 300) return res.status(400).json({ error: 'A reason between 5 and 300 characters is required' });

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const targets = db.organizations.filter(org => organizationIds.includes(org.id));
  let changed = 0;
  for (const organization of targets) {
    if ((organization.status || 'active') === status) continue;
    organization.status = status;
    organization.archivedAt = status === 'archived' ? new Date().toISOString() : null;
    changed += 1;
    if (status !== 'active') {
      for (const membership of db.memberships.filter(item => item.organizationId === organization.id)) {
        const user = db.users.find(candidate => candidate.username === membership.userId);
        if (user?.activeOrganizationId === organization.id) user.sessionVersion = sessionVersionForUser(user) + 1;
      }
    }
  }
  await saveCoreMetadata('admin-organizations-bulk-status');
  recordAdminAction(auth.username, 'organizations.bulk.status', `${targets.length} organizations`, `${status}; reason=${reason}`);
  await auditSecurityEvent({
    eventType: 'admin.organizations_bulk_status_changed', actorUsername: auth.username,
    ip: clientIp(req), metadata: { matched: targets.length, changed, status, reason },
  });
  res.json({ ok: true, matched: targets.length, changed });
});

// POST /api/admin/orgs/invitations/create
router.post('/orgs/invitations/create', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const organizationId = String(req.body?.organizationId || '').trim();
  const email = String(req.body?.email || '').toLowerCase().trim();
  const role = req.body?.role;
  const language = req.body?.language === 'ka' ? 'ka' : 'en';
  if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email address is required' });
  if (!isKnownRole(role)) return res.status(400).json({ error: 'A valid role is required' });

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const organization = db.organizations.find(org => org.id === organizationId);
  if (!organization) return res.status(404).json({ error: 'Organization not found' });
  const duplicate = db.invitations.find(invite => (
    invite.organizationId === organizationId && String(invite.email).toLowerCase() === email
    && !invite.acceptedAt && !invite.revokedAt && new Date(invite.expiresAt).getTime() > Date.now()
  ));
  if (duplicate) return res.status(409).json({ error: 'A current invitation already exists for this email address' });

  const invitation: any = {
    id: `invite_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    email, organizationId, role, acceptedAt: null, revokedAt: null, createdAt: new Date().toISOString(),
  };
  db.invitations.push(invitation);
  try {
    const result = await deliverAdminInvitation(req, invitation, organization, auth.username, language);
    await saveCoreMetadata('admin-invitation-create');
    recordAdminAction(auth.username, 'invitation.create', email, `${organizationId}; role=${role}`);
    await auditSecurityEvent({
      eventType: 'admin.invitation_created', username: email, actorUsername: auth.username,
      organizationId, ip: clientIp(req), metadata: { role, transport: result.delivery.transport },
    });
    return res.status(201).json({
      ok: true,
      invitation: { id: invitation.id, email, organizationId, role, expiresAt: invitation.expiresAt },
      ...(result.delivery.transport === 'console' && process.env.NODE_ENV !== 'production' ? { devInviteUrl: result.link } : {}),
    });
  } catch {
    invitation.revokedAt = new Date().toISOString();
    await saveCoreMetadata('admin-invitation-delivery-failed');
    return res.status(503).json({ error: 'The invitation email could not be delivered' });
  }
});

// POST /api/admin/orgs/invitations/resend
router.post('/orgs/invitations/resend', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const invitationId = String(req.body?.invitationId || '').trim();
  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const invitation = db.invitations.find(candidate => candidate.id === invitationId);
  if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
  const organization = db.organizations.find(org => org.id === invitation.organizationId);
  if (!organization) return res.status(404).json({ error: 'Organization not found' });
  try {
    const result = await deliverAdminInvitation(req, invitation, organization, auth.username, req.body?.language === 'ka' ? 'ka' : 'en');
    await saveCoreMetadata('admin-invitation-resend');
    recordAdminAction(auth.username, 'invitation.resend', invitation.email, invitation.organizationId);
    await auditSecurityEvent({
      eventType: 'admin.invitation_resent', username: invitation.email, actorUsername: auth.username,
      organizationId: invitation.organizationId, ip: clientIp(req), metadata: { role: invitation.role, transport: result.delivery.transport },
    });
    return res.json({ ok: true, expiresAt: invitation.expiresAt });
  } catch {
    return res.status(503).json({ error: 'The invitation email could not be delivered' });
  }
});

// POST /api/admin/orgs/invitations/revoke
router.post('/orgs/invitations/revoke', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const invitationId = String(req.body?.invitationId || '').trim();
  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const invitation = db.invitations.find(candidate => candidate.id === invitationId);
  if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
  if (invitation.acceptedAt) return res.status(409).json({ error: 'Accepted invitations cannot be revoked' });
  invitation.revokedAt = new Date().toISOString();
  await saveCoreMetadata('admin-invitation-revoke');
  recordAdminAction(auth.username, 'invitation.revoke', invitation.email, invitation.organizationId);
  await auditSecurityEvent({
    eventType: 'admin.invitation_revoked', username: invitation.email, actorUsername: auth.username,
    organizationId: invitation.organizationId, ip: clientIp(req), metadata: { role: invitation.role },
  });
  res.json({ ok: true });
});

// POST /api/admin/memberships/remove
router.post('/memberships/remove', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const username = String(req.body?.username || '').trim();
  const organizationId = String(req.body?.organizationId || '').trim();
  const user = db.users.find(candidate => candidate.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  const membership = db.memberships.find(item => item.userId === user.username && item.organizationId === organizationId);
  if (!membership) return res.status(404).json({ error: 'Membership not found' });

  const organizationMembers = db.memberships.filter(item => item.organizationId === organizationId);
  if (organizationMembers.length <= 1) {
    return res.status(409).json({
      code: 'last_organization_member',
      error: 'The last member cannot be removed. Assign another user or delete the organization instead.',
    });
  }

  db.memberships = db.memberships.filter(item => item !== membership);
  const wasActive = user.activeOrganizationId === organizationId;
  let nextActiveOrganizationId = user.activeOrganizationId || null;
  if (wasActive) {
    const nextMembership = db.memberships.find(item => item.userId === user.username);
    nextActiveOrganizationId = nextMembership?.organizationId || null;
    user.activeOrganizationId = nextActiveOrganizationId;
    user.role = nextMembership?.role || 'Read-Only';
    user.sessionVersion = sessionVersionForUser(user) + 1;
  }

  await deleteMembershipMetadataFromPostgres(user.username, organizationId);
  await saveCoreMetadata('admin-membership-remove');
  recordAdminAction(auth.username, 'membership.delete', `${user.username}@${organizationId}`, `role=${membership.role}`);
  await auditSecurityEvent({
    eventType: 'admin.membership_deleted',
    username: user.username,
    actorUsername: auth.username,
    organizationId,
    ip: clientIp(req),
    metadata: { role: membership.role, wasActive, nextActiveOrganizationId },
  });

  res.json({ ok: true, activeOrganizationId: nextActiveOrganizationId, sessionRevoked: wasActive });
});

// POST /api/admin/orgs/delete
router.post('/orgs/delete', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const organizationId = String(req.body?.organizationId || '').trim();
  const organization = db.organizations.find(candidate => candidate.id === organizationId);
  if (!organization) return res.status(404).json({ error: 'Organization not found' });

  const confirmationName = String(req.body?.confirmationName || '');
  if (confirmationName !== organization.name) {
    const summary = summarizeOrgData(db.orgData[organizationId] || {});
    return res.status(409).json({
      code: 'organization_deletion_requires_confirmation',
      error: 'Type the exact organization name to confirm permanent deletion',
      organization: {
        id: organization.id,
        name: organization.name,
        membersCount: db.memberships.filter(item => item.organizationId === organizationId).length,
        tanksCount: summary.tanksCount,
        lotsCount: summary.lotsCount,
        dataSize: summary.dataSizeBytes,
      },
    });
  }

  const affectedMemberships = db.memberships.filter(item => item.organizationId === organizationId);
  const affectedUsernames = new Set(affectedMemberships.map(item => item.userId));
  db.memberships = db.memberships.filter(item => item.organizationId !== organizationId);
  db.invitations = db.invitations.filter(invite => invite.organizationId !== organizationId);
  db.organizations = db.organizations.filter(item => item.id !== organizationId);
  delete db.orgData[organizationId];

  let revokedSessions = 0;
  for (const username of affectedUsernames) {
    const user = db.users.find(candidate => candidate.username === username);
    if (!user || user.activeOrganizationId !== organizationId) continue;
    const nextMembership = db.memberships.find(item => item.userId === username);
    user.activeOrganizationId = nextMembership?.organizationId || null;
    user.role = nextMembership?.role || 'Read-Only';
    user.sessionVersion = sessionVersionForUser(user) + 1;
    revokedSessions += 1;
  }

  await deleteOrganizationMetadataFromPostgres(organizationId);
  await saveCoreMetadata('admin-organization-delete');
  recordAdminAction(auth.username, 'organization.delete', organizationId, `${organization.name}; members=${affectedMemberships.length}`);
  await auditSecurityEvent({
    eventType: 'admin.organization_deleted',
    actorUsername: auth.username,
    organizationId,
    ip: clientIp(req),
    metadata: { name: organization.name, membersRemoved: affectedMemberships.length, revokedSessions },
  });

  res.json({ ok: true, deletedOrganizationId: organizationId, membersRemoved: affectedMemberships.length, revokedSessions });
});

// GET /api/admin/orgs
router.get('/orgs', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  await refreshCoreMetadataFromPostgres();
  const db = getDB();
  const orgList = db.organizations?.map(org => {
    const members = db.memberships?.filter(m => m.organizationId === org.id) || [];
    const orgData = db.orgData?.[org.id] || {};
    const summary = summarizeOrgData(orgData);
    const health = organizationHealth(db, org);

    return {
      id: org.id,
      name: org.name,
      status: org.status || 'active',
      archivedAt: org.archivedAt || null,
      deletionScheduledAt: org.deletionScheduledAt || null,
      internalTags: Array.isArray(org.internalTags) ? org.internalTags : [],
      createdAt: org.createdAt,
      membersCount: members.length,
      ownersCount: members.filter(member => member.role === 'Owner/Admin').length,
      onlineMembersCount: members.filter(member => {
        const user = db.users.find(candidate => candidate.username === member.userId);
        return userIsOnline(user?.lastSeenAt);
      }).length,
      pendingInvitationsCount: db.invitations.filter(invite => (
        invite.organizationId === org.id && !invite.acceptedAt && !invite.revokedAt && new Date(invite.expiresAt).getTime() > Date.now()
      )).length,
      tanksCount: summary.tanksCount,
      lotsCount: summary.lotsCount,
      certificationRecordsCount: summary.certificationRecordsCount,
      attachmentsCount: summary.attachmentsCount,
      crmLeadsCount: summary.crmLeadsCount,
      aiDraftsCount: summary.aiDraftsCount,
      inlineAttachmentBytes: summary.inlineAttachmentBytes,
      attachmentChecksumCoveragePct: summary.attachmentChecksumCoveragePct,
      dataSize: summary.dataSizeBytes,
      lastActivity: health.lastActivity,
      health: { level: health.level, issues: health.issues },
    };
  }) || [];

  res.json({ ok: true, organizations: orgList });
});

// POST /api/admin/system-action
router.post('/system-action', async (req, res) => {
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

// GET /api/admin/actions
router.get('/actions', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const durable = (await listSecurityAuditEvents(500)).map(event => ({
    at: event.createdAt,
    actor: event.actorUsername || 'system',
    action: event.eventType,
    target: event.username || event.organizationId || undefined,
    detail: event.metadata && Object.keys(event.metadata).length ? JSON.stringify(event.metadata) : undefined,
    organizationId: event.organizationId || undefined,
    durable: true,
  }));
  const actions = [...durable, ...adminActions]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 500);
  res.json({ ok: true, actions });
});

// POST /api/admin/impersonate
router.post('/impersonate', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const target = String(req.body?.username || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!target) return res.status(400).json({ error: 'Username is required' });
  if (reason.length < 5 || reason.length > 300) {
    return res.status(400).json({ error: 'A support reason between 5 and 300 characters is required' });
  }
  if (isMasterAdmin(target)) {
    return res.status(400).json({ error: 'Cannot impersonate the master administrator' });
  }

  const db = getDB();
  const user = db.users.find(u => u.username === target);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!userAccountIsEnabled(user)) return res.status(409).json({ error: 'Disabled accounts cannot be impersonated' });

  const token = createSessionToken(
    sessionPayloadForUser(user, user.role, { impersonatedBy: auth.username, supportReason: reason }),
    false,
  );
  res.setHeader('Set-Cookie', sessionCookie(token, 1800)); // 30-minute support window
  recordAdminAction(auth.username, 'impersonate.start', target, reason);
  await auditSecurityEvent({
    eventType: 'admin.impersonation_started',
    username: target,
    actorUsername: auth.username,
    organizationId: user.activeOrganizationId,
    ip: clientIp(req),
    metadata: { reason, expiresInMinutes: 30 },
  });
  res.json({ ok: true, username: user.username, fullName: user.fullName });
});

// POST /api/admin/impersonate/stop
router.post('/impersonate/stop', async (req, res) => {
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
  await auditSecurityEvent({
    eventType: 'admin.impersonation_stopped',
    username: String(session.username),
    actorUsername: String(session.impersonatedBy),
    ip: clientIp(req),
  });
  res.json({ ok: true, username: session.impersonatedBy });
});

// GET /api/admin/lockouts
router.get('/lockouts', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const entries = await loginLimiter.list();
  res.json({ ok: true, backend: loginLimiter.backend(), entries });
});

// POST /api/admin/lockouts/clear
router.post('/lockouts/clear', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const key = String(req.body?.key || '').trim();
  if (!key) return res.status(400).json({ error: 'Lockout key is required' });
  await loginLimiter.clear(key);
  recordAdminAction(auth.username, 'lockout.clear', key);
  res.json({ ok: true });
});

// POST /api/admin/test-email
router.post('/test-email', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const to = String(req.body?.to || '').trim();
  if (!isValidEmail(to)) return res.status(400).json({ error: 'A valid recipient email is required' });

  let result;
  try {
    result = await sendMail({
      to,
      subject: 'VinOS — delivery test',
      text: `This is a delivery test from the VinOS admin console, requested by ${auth.username} at ${new Date().toISOString()}. If you received it, outbound email works.`,
    });
  } catch {
    return res.status(503).json({ error: 'Outbound email delivery failed' });
  }
  recordAdminAction(auth.username, 'email.test', to, `transport=${result.transport}`);
  res.json({ ok: true, delivered: result.delivered, transport: result.transport });
});

// GET /api/admin/orgs/inspect
router.get('/orgs/inspect', async (req, res) => {
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
  const operationalSummary = summarizeOrgData(data);
  const health = organizationHealth(db, org);
  const invitations = db.invitations.filter(invite => invite.organizationId === orgId).map(invite => {
    const invitedUser = db.users.find(user => String(user.email || '').toLowerCase() === String(invite.email || '').toLowerCase());
    const acceptedMembership = invitedUser
      ? db.memberships.some(item => item.userId === invitedUser.username && item.organizationId === orgId)
      : false;
    const expired = new Date(invite.expiresAt).getTime() <= Date.now();
    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      createdAt: invite.createdAt || null,
      expiresAt: invite.expiresAt,
      status: acceptedMembership || invite.acceptedAt ? 'accepted' : invite.revokedAt ? 'revoked' : expired ? 'expired' : 'pending',
    };
  }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const auditEvents = (await listSecurityAuditEvents(500))
    .filter(event => event.organizationId === orgId)
    .slice(0, 100);
  res.json({
    ok: true,
    organization: {
      id: org.id,
      name: org.name,
      status: org.status || 'active',
      archivedAt: org.archivedAt || null,
      deletionScheduledAt: org.deletionScheduledAt || null,
      internalNotes: org.internalNotes || '',
      internalTags: Array.isArray(org.internalTags) ? org.internalTags : [],
      createdAt: org.createdAt,
    },
    wineryName: data.companyProfile?.wineryName || data.companyProfile?.companyName || '',
    members: members.map(m => {
      const user = db.users.find(candidate => candidate.username === m.userId);
      return {
        username: m.userId,
        fullName: user?.fullName || m.userId,
        email: user?.email || '',
        role: m.role,
        accountEnabled: user?.accountEnabled !== false,
        approvalStatus: user ? approvalStatusForUser(user) : 'unknown',
        lastSeenAt: user?.lastSeenAt || null,
        isOnline: userIsOnline(user?.lastSeenAt),
        isActiveWorkspace: user?.activeOrganizationId === orgId,
      };
    }),
    invitations,
    auditEvents,
    health: { ...health, lastActivity: health.lastActivity || lastActivity },
    dataSizeBytes: operationalSummary.dataSizeBytes,
    lastActivity: health.lastActivity || lastActivity,
    collections,
    operationalSummary,
    attachmentSummary: summarizeAttachments(data),
    crmSummary: summarizeCrmLeads(data),
    aiDraftSummary: summarizeAiDrafts(data),
  });
});

// GET /api/admin/security-events
router.get('/security-events', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;
  const events = await listSecurityAuditEvents(200);
  res.json({ ok: true, events });
});

// POST /api/admin/reset
router.post('/reset', checkWineryScope('admin'), async (req, res) => {
  const session = (req as any).wineryContext;

  const emptyData = await resetUserData(session.username);
  res.json(emptyData);
});

// Handler for dev seeder: GET /api/dev/seed-testuser1
export async function seedTestUserHandler(req: express.Request, res: express.Response) {
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

    await saveUserData('testuser1', seededData, { updatedBy: 'seed-testuser1' });

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
}

export default router;
