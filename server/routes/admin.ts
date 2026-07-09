import express from 'express';
import { checkWineryScope, requireMasterAdmin, isMasterAdmin } from '../middleware/auth';
import { getDeploymentStatus, applyRuntimeScaleReadinessProbe } from '../deploymentStatus';
import {
  getDB,
  saveCoreMetadata,
  saveUserData,
  resetUserData,
  getUserData,
  createEmptyUserData,
  deleteUserMetadataFromPostgres,
  refreshCoreMetadataFromPostgres,
  getPrismaClientForAdmin,
  getPostgresReadinessProbe,
  forceSaveDB,
  reloadOrganizationDataFromPostgres,
  getDbRuntimeStatus,
} from '../db';
import { getSeederData } from '../seedTestUser';
import { getRecentClientErrors } from './telemetry';
import { loginLimiter, sessionCookie, parseCookies } from '../middleware/auth';
import { hashPassword, verifySessionToken, createSessionToken } from '../auth';
import { isValidEmail } from '../emailVerification';
import { sendMail } from '../mailer';
import {
  summarizeAiDrafts,
  summarizeAttachments,
  summarizeCrmLeads,
  summarizeOrgData,
} from '../adminOrgSummary';

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
router.get('/export', checkWineryScope('admin'), async (req, res) => {
  const auth = (req as any).wineryContext;

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

// GET /api/admin/users
router.get('/users', async (req, res) => {
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

// POST /api/admin/users/update
router.post('/users/update', async (req, res) => {
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
    user.passwordHash = hashPassword(trimmed);
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

// GET /api/admin/orgs
router.get('/orgs', async (req, res) => {
  const auth = await requireMasterAdmin(req, res);
  if (!auth) return;

  const db = getDB();
  const orgList = db.organizations?.map(org => {
    const members = db.memberships?.filter(m => m.organizationId === org.id) || [];
    const orgData = db.orgData?.[org.id] || {};
    const summary = summarizeOrgData(orgData);

    return {
      id: org.id,
      name: org.name,
      createdAt: org.createdAt,
      membersCount: members.length,
      tanksCount: summary.tanksCount,
      lotsCount: summary.lotsCount,
      certificationRecordsCount: summary.certificationRecordsCount,
      attachmentsCount: summary.attachmentsCount,
      crmLeadsCount: summary.crmLeadsCount,
      aiDraftsCount: summary.aiDraftsCount,
      inlineAttachmentBytes: summary.inlineAttachmentBytes,
      attachmentChecksumCoveragePct: summary.attachmentChecksumCoveragePct,
      dataSize: summary.dataSizeBytes,
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
  res.json({ ok: true, actions: adminActions });
});

// POST /api/admin/impersonate
router.post('/impersonate', async (req, res) => {
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

  const result = await sendMail({
    to,
    subject: 'VinOS — delivery test',
    text: `This is a delivery test from the VinOS admin console, requested by ${auth.username} at ${new Date().toISOString()}. If you received it, outbound email works.`,
  });
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
  res.json({
    ok: true,
    organization: { id: org.id, name: org.name, createdAt: org.createdAt },
    wineryName: data.companyProfile?.wineryName || data.companyProfile?.companyName || '',
    members: members.map(m => ({ username: m.userId, role: m.role })),
    dataSizeBytes: operationalSummary.dataSizeBytes,
    lastActivity,
    collections,
    operationalSummary,
    attachmentSummary: summarizeAttachments(data),
    crmSummary: summarizeCrmLeads(data),
    aiDraftSummary: summarizeAiDrafts(data),
  });
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
