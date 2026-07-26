import express from 'express';
import { hashPassword } from './auth';
import {
  getDB,
  saveCoreMetadata,
  saveOrganizationData,
} from './db';
import { getSeederData } from './seedTestUser';

const router = express.Router();

const ORGANIZATION_ID = 'org_e2e_release';
const OWNER_USERNAME = 'e2e_owner';
const READER_USERNAME = 'e2e_reader';
const GEORGIAN_USERNAME = 'e2e_georgian';
const PASSPHRASE = 'E2e-release-passphrase-2026';
const TASK_ID = 'task_e2e_deep_link';
const TASK_TITLE = 'Verify the signed WhatsApp delivery';

export function e2eFixturesAreAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV !== 'production' && env.E2E_TEST_MODE === 'true';
}

router.use((_req, res, next) => {
  if (!e2eFixturesAreAllowed()) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  next();
});

router.post('/reset', async (_req, res) => {
  const now = new Date().toISOString();
  const data = getSeederData(ORGANIZATION_ID);
  data.companyProfile = {
    ...data.companyProfile,
    companyName: 'Release Gate Estate',
    wineryName: 'Release Gate Estate',
    region: 'Kakheti',
    municipality: 'Telavi',
  };
  data.tasks = [
    {
      id: TASK_ID,
      title: TASK_TITLE,
      priority: 'high',
      dueDate: '2026-07-27',
      assignedTo: 'Release Gate Reader',
      assignedUserId: READER_USERNAME,
      status: 'pending',
      description: 'Confirm that the provider status moves from accepted to delivered.',
      lastModified: now,
    },
    ...data.tasks,
  ];

  const db = getDB();
  db.users = [
    {
      username: OWNER_USERNAME,
      email: 'owner@release-gate.test',
      fullName: 'Release Gate Owner',
      role: 'Owner/Admin',
      language: 'en',
      phone: '',
      whatsappOptIn: false,
      passwordHash: hashPassword(PASSPHRASE),
      enabledModules: ['vazi', 'gvino'],
      enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks', 'audit'],
      registrationComplete: true,
      emailVerified: true,
      activeOrganizationId: ORGANIZATION_ID,
      accountEnabled: true,
      sessionVersion: 1,
    },
    {
      username: READER_USERNAME,
      email: 'reader@release-gate.test',
      fullName: 'Release Gate Reader',
      role: 'Read-Only',
      language: 'en',
      phone: '',
      whatsappOptIn: false,
      passwordHash: hashPassword(PASSPHRASE),
      enabledModules: ['vazi', 'gvino'],
      enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks', 'audit'],
      registrationComplete: true,
      emailVerified: true,
      activeOrganizationId: ORGANIZATION_ID,
      accountEnabled: true,
      sessionVersion: 1,
    },
    {
      username: GEORGIAN_USERNAME,
      email: 'georgian@release-gate.test',
      fullName: 'ქართული ტესტის მფლობელი',
      role: 'Owner/Admin',
      language: 'ka',
      phone: '',
      whatsappOptIn: false,
      passwordHash: hashPassword(PASSPHRASE),
      enabledModules: ['vazi', 'gvino'],
      enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks', 'audit'],
      registrationComplete: true,
      emailVerified: true,
      activeOrganizationId: ORGANIZATION_ID,
      accountEnabled: true,
      sessionVersion: 1,
    },
  ];
  db.organizations = [{ id: ORGANIZATION_ID, name: 'Release Gate Estate' }];
  db.memberships = [
    {
      id: 'mem_e2e_owner',
      userId: OWNER_USERNAME,
      organizationId: ORGANIZATION_ID,
      role: 'Owner/Admin',
    },
    {
      id: 'mem_e2e_reader',
      userId: READER_USERNAME,
      organizationId: ORGANIZATION_ID,
      role: 'Read-Only',
    },
    {
      id: 'mem_e2e_georgian',
      userId: GEORGIAN_USERNAME,
      organizationId: ORGANIZATION_ID,
      role: 'Owner/Admin',
    },
  ];
  db.invitations = [];
  db.securityAuditEvents = [];
  db.whatsappDeliveries = [];
  db.orgData = { [ORGANIZATION_ID]: data };

  await saveCoreMetadata('e2e-fixture-reset');
  await saveOrganizationData(ORGANIZATION_ID, data, {
    updatedBy: 'e2e-fixture-reset',
  });

  res.json({
    organizationId: ORGANIZATION_ID,
    task: { id: TASK_ID, title: TASK_TITLE },
    owner: { identifier: 'owner@release-gate.test', passphrase: PASSPHRASE },
    reader: { identifier: 'reader@release-gate.test', passphrase: PASSPHRASE },
    georgian: { identifier: 'georgian@release-gate.test', passphrase: PASSPHRASE },
  });
});

export default router;
