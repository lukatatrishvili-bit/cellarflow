import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { downloadDb, uploadDb, gcsEnabled, gcsTarget } from './gcsStore';
import { createEmptyIntegrationHubState, ensureIntegrationHubState, type IntegrationHubState } from '../lib/integrations';
import {
  DEFAULT_TERROIR_SHARING_SETTINGS,
  normalizeTerroirSharingSettings,
  type TerroirSharingSettings,
} from '../lib/terroirPulse';
import { readDemoAccountConfig } from './demoAccount';
import { hashToken } from './emailVerification';
import { approvalStatusForUser } from './registrationApproval';
import { syncVesselLotProjection } from './relationalProjection';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let postgresDisabledAfterFailure = false;
let prismaInstance: PrismaClientType | null = null;
let lastLocalSaveAt: string | null = null;
let lastLocalSaveError: string | null = null;
let lastGcsUploadAttemptAt: string | null = null;
let lastGcsUploadAt: string | null = null;
let lastGcsUploadError: string | null = null;
let lastPostgresSyncAt: string | null = null;
let lastPostgresSyncError: string | null = null;
let lastPostgresSaveAt: string | null = null;
let lastPostgresSaveError: string | null = null;
let lastPostgresMigrationAt: string | null = null;
let lastPostgresMigrationSource: string | null = null;
let pendingGcsBackupJson: string | null = null;
let pendingGcsBackupTimer: ReturnType<typeof setTimeout> | null = null;
const organizationStateMeta = new Map<string, OrganizationStateMeta>();
const lastPresenceWriteAt = new Map<string, number>();
const GCS_BACKUP_MIN_INTERVAL_MS = 90_000;
const PRESENCE_WRITE_INTERVAL_MS = 30_000;
const DEFAULT_USER_MODULES = ['vazi', 'gvino'];
const DEFAULT_USER_WIDGETS = ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks'];

export class OrganizationStateVersionConflictError extends Error {
  constructor(
    public readonly organizationId: string,
    public readonly expectedVersion: number
  ) {
    super(`Organization state ${organizationId} changed while saving. Expected version ${expectedVersion}.`);
    this.name = 'OrganizationStateVersionConflictError';
  }
}

export interface OrganizationStateMeta {
  organizationId: string;
  version: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
  source: 'postgres' | 'memory-cache' | 'json-fallback' | 'missing';
}

function isPostgresConfigured(): boolean {
  return Boolean((process.env.DATABASE_URL || '').trim());
}

function maskedDatabaseTarget(): string | null {
  const raw = (process.env.DATABASE_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const port = url.port ? `:${url.port}` : '';
    const databaseName = url.pathname && url.pathname !== '/' ? url.pathname : '';
    return `${url.protocol}//${url.hostname}${port}${databaseName}`;
  } catch {
    return '(configured)';
  }
}

function replaceJsonFile(tempPath: string, targetPath: string): void {
  try {
    fs.renameSync(tempPath, targetPath);
    return;
  } catch (err: any) {
    if (!['EPERM', 'EBUSY', 'EACCES'].includes(err?.code)) {
      throw err;
    }
  }

  // Windows can briefly lock db.json after a process restart or file scan.
  // Preserve the save by overwriting the target contents, then remove temp.
  fs.copyFileSync(tempPath, targetPath);
  fs.unlinkSync(tempPath);
}

async function getPrisma(): Promise<PrismaClientType | null> {
  if (postgresDisabledAfterFailure || !isPostgresConfigured()) return null;
  if (!prismaInstance) {
    const { PrismaClient } = await import('@prisma/client');
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
}

export async function getPrismaClientForAdmin(): Promise<PrismaClientType | null> {
  return getPrisma();
}

let dbData: any = null;

export async function initDB(): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) {
    console.log('[db] PostgreSQL is not configured. Using GCS/local JSON persistence.');
    await loadLocalOrGcsDB();
    dbData = normalizeDbState(dbData);
    cleanupDemoData();
    saveDB();
    return;
  }

  console.log('[db] initializing PostgreSQL connection via Prisma...');

  try {
    const users = await prisma.user.findMany();
    const organizations = await prisma.organization.findMany();
    const memberships = await prisma.membership.findMany();
    const invitations = await prisma.invitation.findMany();
    const organizationStates = await (prisma as any).organizationState.findMany();

    if (organizationStates.length > 0) {
      dbData = dbFromPostgresRows({ users, organizations, memberships, invitations, organizationStates });
      console.log(`[db] hydrated ${organizationStates.length} organization state snapshot(s) from PostgreSQL JSONB.`);
    } else {
      console.log('[db] no PostgreSQL organization_state rows found. Attempting one-time migration from GCS/local JSON...');
      await loadLocalOrGcsDB();
      dbData = normalizeDbState(dbData);

      if (!dbHasDurableContent(dbData)) {
        dbData = dbFromPostgresRows({ users, organizations, memberships, invitations, organizationStates: [] });
      }

      cleanupDemoData();
      await persistFullDbToPostgres('gcs-or-local-json');
      lastPostgresMigrationAt = new Date().toISOString();
      lastPostgresMigrationSource = gcsEnabled ? gcsTarget() : 'local-json';
      console.log(`[db] migrated JSON state into PostgreSQL JSONB: users=${dbData.users.length}, organizations=${dbData.organizations.length}, orgStates=${Object.keys(dbData.orgData || {}).length}.`);
    }

    console.log('[db] successfully hydrated memory cache from PostgreSQL!');
    cleanupDemoData();
    // PostgreSQL is already the source of truth at this point. Keep the local
    // JSON backup fresh without starting a redundant background JSONB write
    // that can race with user-initiated saves during cold starts.
    saveDB({ syncPostgres: false });
  } catch (err) {
    await prisma.$disconnect().catch(() => undefined);
    prismaInstance = null;
    if (process.env.NODE_ENV === 'production') {
      console.error('[db] PostgreSQL initialization failed. Refusing fallback storage in production:', err);
      throw err;
    }

    console.warn('[db] PostgreSQL initialization failed. Falling back to GCS or local file:', err);
    postgresDisabledAfterFailure = true;
    await loadLocalOrGcsDB();
    dbData = normalizeDbState(dbData);
    cleanupDemoData();
    saveDB();
  }
}

/**
 * Drop organizations that the demo purge itself has just stranded.
 *
 * Deliberately narrow. A general "delete every organization nobody belongs to"
 * sweep at boot is far too dangerous for this codebase: an organization can be
 * claimed by `user.activeOrganizationId` alone, without a membership row — the
 * e2e fixtures do exactly that — so a sweep would quietly delete live
 * workspaces. Startup should never destroy data it did not create.
 *
 * This only considers ids that belonged to the demo user a moment ago, and only
 * removes them once nothing else references them at all.
 */
function removeStrandedDemoOrganizations(demoOrgIds: string[]): void {
  if (!dbData || !demoOrgIds.length) return;

  const stillClaimed = new Set<string>([
    ...(dbData.memberships || []).map((m: any) => m.organizationId),
    ...(dbData.users || []).map((u: any) => u.activeOrganizationId).filter(Boolean),
  ]);

  const stranded = demoOrgIds.filter(id => !stillClaimed.has(id));
  if (!stranded.length) return;

  dbData.organizations = (dbData.organizations || []).filter((org: any) => !stranded.includes(org.id));
  for (const id of stranded) delete dbData.orgData?.[id];
  console.log(`[db] removed ${stranded.length} demo organization(s) left behind by the demo purge.`);
}

function cleanupDemoData(): void {
  if (!dbData) return;

  /**
   * When the demo login is switched on, the demo account IS the product
   * surface. Deleting it on every boot meant `ensureDemoAccount` rebuilt it
   * from scratch each restart, with a fresh organization — so anything seeded
   * into the demo workspace was orphaned within one restart, and the demo was
   * permanently empty.
   *
   * The purge exists so a real deployment carries no demo records, and that
   * property is preserved: it still runs whenever demo mode is off. Enabled,
   * the account persists and the demo becomes something you can actually
   * prepare in advance.
   */
  if (readDemoAccountConfig().enabled) return;

  console.log('[db] performing demo data cleanup...');

  // Note which workspaces the demo account holds before removing it, so the
  // sweep below can only ever touch those.
  const demoOrgIds = [
    ...(dbData.memberships || []).filter((m: any) => m.userId === 'demo').map((m: any) => m.organizationId),
    ...(dbData.users || []).filter((u: any) => u.username === 'demo').map((u: any) => u.activeOrganizationId),
  ].filter(Boolean).filter((id, index, all) => all.indexOf(id) === index);

  dbData.users = (dbData.users || []).filter((u: any) => u.username !== 'demo');
  dbData.memberships = (dbData.memberships || []).filter((m: any) => m.userId !== 'demo');
  if (dbData.organizations) {
    dbData.organizations = dbData.organizations.filter((o: any) => o.id !== 'org_demo_georgian');
  }
  if (dbData.orgData) {
    delete dbData.orgData['org_demo_georgian'];
  }
  removeStrandedDemoOrganizations(demoOrgIds);
}


async function loadLocalOrGcsDB(): Promise<void> {
  // 1. Try GCS
  if (gcsEnabled) {
    console.log('[db] attempting to download database from GCS...');
    const gcsContent = await downloadDb();
    if (gcsContent) {
      try {
        dbData = JSON.parse(gcsContent);
        console.log('[db] successfully loaded database from GCS!');
        return;
      } catch (e) {
        console.error('[db] failed to parse GCS database content:', e);
      }
    }
  }

  // 2. Try local disk
  const templatePath = path.resolve(__dirname, '../db.json');
  const targetPath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : templatePath;
  if (fs.existsSync(targetPath)) {
    console.log(`[db] loading database from local file: ${targetPath}`);
    try {
      const localContent = fs.readFileSync(targetPath, 'utf8');
      dbData = JSON.parse(localContent);
      console.log('[db] successfully loaded database from local file!');
      return;
    } catch (e) {
      /**
       * A file that exists but will not parse is an emergency, not a reason to
       * start fresh.
       *
       * This used to log and fall through to the empty database below, which
       * `initDB` then saved straight back over the file — turning a corrupt but
       * potentially salvageable database into a permanent, total loss, and
       * destroying the evidence in the same step. The log even claimed no
       * database had been found, while it sat right there unreadable.
       *
       * So: keep the bytes under a timestamped name and refuse to boot. Someone
       * has to look at this, and an operator can recover far more from a corrupt
       * file than from an empty one.
       */
      const preservedPath = `${targetPath}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(targetPath, preservedPath);
      } catch (copyError) {
        console.error('[db] could not preserve the unreadable database file:', copyError);
      }
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        `The database file at ${targetPath} exists but could not be parsed (${detail}). `
        + `Refusing to start, because continuing would overwrite it with an empty database. `
        + `A copy has been kept at ${preservedPath}. `
        + `Repair or restore that file, or move it aside to intentionally start from empty.`,
      );
    }
  }

  // 3. No database anywhere — a genuine first run.
  console.log('[db] no database found on GCS or local disk. Initializing empty database.');
  dbData = {
    users: [],
    organizations: [],
    memberships: [],
    invitations: [],
    securityAuditEvents: [],
    whatsappDeliveries: [],
    orgData: {}
  };
}

export interface UserDataState {
  /** Server-private bounded ledger preventing stale clients from resurrecting deleted records. */
  syncDeletionLedger: any[];
  vessels: any[];
  lots: any[];
  fermlogs: any[];
  lablogs: any[];
  inventory: any[];
  invoiceReceipts: any[];
  inventoryMovements: any[];
  tasks: any[];
  notes: any[];
  blocks: any[];
  vineyardProjects: any[];
  phenologyLogs: any[];
  sprays: any[];
  scoutings: any[];
  soilRecords: any[];
  samplings: any[];
  harvests: any[];
  irrigationLogs: any[];
  fertilizerLogs: any[];
  auditLogs: any[];
  bottlingRuns: any[];
  transfers: any[];
  grapeIntakes: any[];
  cellarOps: any[];
  costEntries: any[];
  winePricing: Record<string, number>;
  storageLocations: any[];
  stockMovements: any[];
  salesDispatches: any[];
  salesOrders: any[];
  supplierPayments: any[];
  certificationRecords: any[];
  attachments: any[];
  crmLeads: any[];
  aiDrafts: any[];
  /** Server-owned review queue for command payloads awaiting human approval. */
  workflowApprovals: any[];
  qualitySops: any[];
  purchaseOrders: any[];
  productionPlans: any[];
  recallCases: any[];
  /** Intelligence-layer findings with their review lifecycle. */
  aiFindings: any[];
  integrationHub?: IntegrationHubState;
  /** Explicit, revocable opt-in for the public privacy-preserving vintage pulse. */
  terroirSharing?: TerroirSharingSettings;
  companyProfile: any;
}

export interface DBState {
  users: any[];
  organizations: any[];
  memberships: any[];
  invitations: any[];
  securityAuditEvents: any[];
  /** Local/GCS fallback for durable WhatsApp delivery state when PostgreSQL is unavailable. */
  whatsappDeliveries: any[];
  orgData: Record<string, UserDataState>;
}

export function createEmptyUserData(): UserDataState {
  return {
    syncDeletionLedger: [],
    vessels: [],
    lots: [],
    fermlogs: [],
    lablogs: [],
    inventory: [],
    invoiceReceipts: [],
    inventoryMovements: [],
    tasks: [],
    notes: [],
    blocks: [],
    vineyardProjects: [],
    phenologyLogs: [],
    sprays: [],
    scoutings: [],
    soilRecords: [],
    samplings: [],
    harvests: [],
    irrigationLogs: [],
    fertilizerLogs: [],
    auditLogs: [],
    bottlingRuns: [],
    transfers: [],
    grapeIntakes: [],
    cellarOps: [],
    costEntries: [],
    winePricing: {},
    storageLocations: [],
    stockMovements: [],
    salesDispatches: [],
    salesOrders: [],
    supplierPayments: [],
    certificationRecords: [],
    attachments: [],
    crmLeads: [],
    aiDrafts: [],
    workflowApprovals: [],
    qualitySops: [],
    purchaseOrders: [],
    productionPlans: [],
    recallCases: [],
    aiFindings: [],
    integrationHub: createEmptyIntegrationHubState(),
    terroirSharing: { ...DEFAULT_TERROIR_SHARING_SETTINGS },
    companyProfile: {
      companyName: '',
      wineryName: '',
      country: '',
      region: '',
      municipality: '',
      address: '',
      identificationCode: '',
      wineAgencyRegistrationCode: '',
      legalAddress: '',
      factualAddress: '',
      certificateContactPerson: '',
      certificatePhone: '',
      certificateEmail: '',
      producerRegistrationNotes: '',
      contactEmail: '',
      phone: '',
      website: '',
      measurementUnits: 'metric'
    }
  };
}

function normalizeUserData(data: Partial<UserDataState> | null | undefined): UserDataState {
  const empty = createEmptyUserData();
  if (!data || typeof data !== 'object') return empty;
  return {
    ...empty,
    ...data,
    syncDeletionLedger: Array.isArray(data.syncDeletionLedger) ? data.syncDeletionLedger : [],
    vessels: Array.isArray(data.vessels) ? data.vessels : [],
    lots: Array.isArray(data.lots) ? data.lots : [],
    fermlogs: Array.isArray(data.fermlogs) ? data.fermlogs : [],
    lablogs: Array.isArray(data.lablogs) ? data.lablogs : [],
    inventory: Array.isArray(data.inventory) ? data.inventory : [],
    invoiceReceipts: Array.isArray(data.invoiceReceipts) ? data.invoiceReceipts : [],
    inventoryMovements: Array.isArray(data.inventoryMovements) ? data.inventoryMovements : [],
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    notes: Array.isArray(data.notes) ? data.notes : [],
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
    vineyardProjects: Array.isArray(data.vineyardProjects) ? data.vineyardProjects : [],
    phenologyLogs: Array.isArray(data.phenologyLogs) ? data.phenologyLogs : [],
    sprays: Array.isArray(data.sprays) ? data.sprays : [],
    scoutings: Array.isArray(data.scoutings) ? data.scoutings : [],
    soilRecords: Array.isArray(data.soilRecords) ? data.soilRecords : [],
    samplings: Array.isArray(data.samplings) ? data.samplings : [],
    harvests: Array.isArray(data.harvests) ? data.harvests : [],
    irrigationLogs: Array.isArray(data.irrigationLogs) ? data.irrigationLogs : [],
    fertilizerLogs: Array.isArray(data.fertilizerLogs) ? data.fertilizerLogs : [],
    auditLogs: Array.isArray(data.auditLogs) ? data.auditLogs : [],
    bottlingRuns: Array.isArray(data.bottlingRuns) ? data.bottlingRuns : [],
    transfers: Array.isArray(data.transfers) ? data.transfers : [],
    grapeIntakes: Array.isArray(data.grapeIntakes) ? data.grapeIntakes : [],
    cellarOps: Array.isArray(data.cellarOps) ? data.cellarOps : [],
    costEntries: Array.isArray(data.costEntries) ? data.costEntries : [],
    winePricing: data.winePricing && typeof data.winePricing === 'object' && !Array.isArray(data.winePricing) ? data.winePricing : {},
    storageLocations: Array.isArray(data.storageLocations) ? data.storageLocations : [],
    stockMovements: Array.isArray(data.stockMovements) ? data.stockMovements : [],
    salesDispatches: Array.isArray(data.salesDispatches) ? data.salesDispatches : [],
    salesOrders: Array.isArray(data.salesOrders) ? data.salesOrders : [],
    supplierPayments: Array.isArray(data.supplierPayments) ? data.supplierPayments : [],
    certificationRecords: Array.isArray(data.certificationRecords) ? data.certificationRecords : [],
    attachments: Array.isArray(data.attachments) ? data.attachments : [],
    crmLeads: Array.isArray(data.crmLeads) ? data.crmLeads : [],
    aiDrafts: Array.isArray(data.aiDrafts) ? data.aiDrafts : [],
    workflowApprovals: Array.isArray(data.workflowApprovals) ? data.workflowApprovals : [],
    qualitySops: Array.isArray(data.qualitySops) ? data.qualitySops : [],
    purchaseOrders: Array.isArray(data.purchaseOrders) ? data.purchaseOrders : [],
    productionPlans: Array.isArray(data.productionPlans) ? data.productionPlans : [],
    recallCases: Array.isArray(data.recallCases) ? data.recallCases : [],
    aiFindings: Array.isArray(data.aiFindings) ? data.aiFindings : [],
    integrationHub: ensureIntegrationHubState(data.integrationHub),
    terroirSharing: normalizeTerroirSharingSettings(
      data.terroirSharing,
      (Array.isArray(data.blocks) ? data.blocks : []).map(block => String(block?.id || '')).filter(Boolean),
    ),
    companyProfile: data.companyProfile && typeof data.companyProfile === 'object'
      ? { ...empty.companyProfile, ...data.companyProfile }
      : empty.companyProfile,
  };
}

function normalizeDbState(data: Partial<DBState> & { userData?: Record<string, Partial<UserDataState>> } | null | undefined): DBState {
  const normalized: DBState = {
    users: Array.isArray(data?.users)
      ? data.users.map((user: any) => ({
        ...user,
        phone: typeof user?.phone === 'string' ? user.phone : '',
        whatsappOptIn: user?.whatsappOptIn === true,
        accountEnabled: user?.accountEnabled !== false,
        // Accounts stored before manual approval existed stay usable.
        approvalStatus: approvalStatusForUser(user),
        sessionVersion: Number.isInteger(Number(user?.sessionVersion)) && Number(user.sessionVersion) > 0
          ? Number(user.sessionVersion)
          : 1,
      }))
      : [],
    organizations: Array.isArray(data?.organizations)
      ? data.organizations.map((organization: any) => {
        organization.status = organization?.status || 'active';
        organization.internalNotes = typeof organization?.internalNotes === 'string' ? organization.internalNotes : '';
        organization.internalTags = Array.isArray(organization?.internalTags)
          ? organization.internalTags.map((tag: unknown) => String(tag)).filter(Boolean)
          : [];
        return organization;
      })
      : [],
    memberships: Array.isArray(data?.memberships) ? data.memberships : [],
    invitations: Array.isArray(data?.invitations)
      ? data.invitations.map((invite: any) => {
        const { token, ...safeInvite } = invite || {};
        return {
          ...safeInvite,
          tokenHash: safeInvite.tokenHash || (token ? hashToken(token) : hashToken(String(safeInvite.id || ''))),
        };
      })
      : [],
    securityAuditEvents: Array.isArray(data?.securityAuditEvents) ? data.securityAuditEvents : [],
    whatsappDeliveries: Array.isArray(data?.whatsappDeliveries) ? data.whatsappDeliveries : [],
    orgData: {},
  };

  const orgData = data?.orgData && typeof data.orgData === 'object' ? data.orgData : {};
  for (const [orgId, value] of Object.entries(orgData)) {
    normalized.orgData[orgId] = normalizeUserData(value);
  }

  // Legacy files may contain userData keyed by username. Map that data to the
  // user's active organization so old backups migrate cleanly into JSONB state.
  const legacyUserData = data?.userData && typeof data.userData === 'object' ? data.userData : {};
  for (const [usernameOrOrgId, value] of Object.entries(legacyUserData)) {
    if (normalized.orgData[usernameOrOrgId]) continue;
    const user = normalized.users.find((u: any) => u.username === usernameOrOrgId);
    const orgId = user?.activeOrganizationId || usernameOrOrgId;
    if (!normalized.orgData[orgId]) {
      normalized.orgData[orgId] = normalizeUserData(value);
    }
  }

  for (const org of normalized.organizations) {
    if (org?.id && !normalized.orgData[org.id]) {
      normalized.orgData[org.id] = createEmptyUserData();
    }
  }

  return normalized;
}

function dbHasDurableContent(data: DBState | null | undefined): boolean {
  if (!data) return false;
  return Boolean(
    (data.users || []).length ||
    (data.organizations || []).length ||
    (data.memberships || []).length ||
    (data.invitations || []).length ||
    Object.keys(data.orgData || {}).length
  );
}

function serializeDbState(data: DBState = getDB()): string {
  const plain = {
    users: data.users || [],
    organizations: data.organizations || [],
    memberships: data.memberships || [],
    invitations: data.invitations || [],
    securityAuditEvents: data.securityAuditEvents || [],
    whatsappDeliveries: data.whatsappDeliveries || [],
    orgData: data.orgData || {},
  };
  // Minified on purpose: this runs on every mutation and the result is written
  // to disk and uploaded to GCS. Indentation is ~35% of the payload for a blob
  // no human reads — use the admin snapshot export when you want it readable.
  return JSON.stringify(plain);
}

function jsonForPrisma(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null));
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : [...fallback];
}

function rememberOrganizationStateMeta(state: any, source: OrganizationStateMeta['source'] = 'postgres'): OrganizationStateMeta {
  const meta: OrganizationStateMeta = {
    organizationId: String(state.organizationId),
    version: typeof state.version === 'number' ? state.version : null,
    updatedAt: state.updatedAt ? new Date(state.updatedAt).toISOString() : null,
    updatedBy: state.updatedBy || null,
    source,
  };
  organizationStateMeta.set(meta.organizationId, meta);
  return meta;
}

async function backupJsonToGcsNow(jsonStr: string): Promise<void> {
  if (!gcsEnabled) return;
  lastGcsUploadAttemptAt = new Date().toISOString();
  try {
    await uploadDb(jsonStr);
    lastGcsUploadAt = new Date().toISOString();
    lastGcsUploadError = null;
  } catch (err) {
    lastGcsUploadError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

function backupJsonToGcs(jsonStr: string): void {
  if (!gcsEnabled) return;
  const now = Date.now();
  const lastAttempt = lastGcsUploadAttemptAt ? new Date(lastGcsUploadAttemptAt).getTime() : 0;
  const elapsed = Number.isFinite(lastAttempt) ? now - lastAttempt : GCS_BACKUP_MIN_INTERVAL_MS;
  const delayMs = Math.max(0, GCS_BACKUP_MIN_INTERVAL_MS - elapsed);

  if (delayMs === 0 && !pendingGcsBackupTimer) {
    backupJsonToGcsNow(jsonStr).catch(err => {
      console.error('[db] background GCS upload failed:', err);
    });
    return;
  }

  pendingGcsBackupJson = jsonStr;
  if (pendingGcsBackupTimer) return;

  pendingGcsBackupTimer = setTimeout(() => {
    const latestJson = pendingGcsBackupJson;
    pendingGcsBackupJson = null;
    pendingGcsBackupTimer = null;
    if (!latestJson) return;
    backupJsonToGcsNow(latestJson).catch(err => {
      console.error('[db] background GCS upload failed:', err);
    });
  }, delayMs || GCS_BACKUP_MIN_INTERVAL_MS);
}

/**
 * Upload any debounced-but-not-yet-written GCS backup immediately. Called from
 * the SIGTERM handler: Cloud Run throttles CPU between requests, so a pending
 * debounce timer may never fire — the shutdown grace period is the last
 * guaranteed CPU window before the instance (and its buffered writes) is gone.
 */
export async function flushPendingGcsBackup(): Promise<void> {
  if (!gcsEnabled) return;
  if (pendingGcsBackupTimer) {
    clearTimeout(pendingGcsBackupTimer);
    pendingGcsBackupTimer = null;
  }
  const latestJson = pendingGcsBackupJson;
  pendingGcsBackupJson = null;
  if (!latestJson) return;
  await backupJsonToGcsNow(latestJson);
}

/**
 * Map one PostgreSQL user row into the in-process directory shape.
 *
 * Shared by the bulk hydrate and the keyed session lookup on purpose: two
 * mappings for the same row would drift, and the fields below decide whether a
 * request is authorised (accountEnabled, approvalStatus, sessionVersion).
 */
function mapPostgresUserRow(u: any) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    language: u.language,
    phone: u.phone || '',
    whatsappOptIn: u.whatsappOptIn === true,
    passwordHash: u.passwordHash,
    emailVerified: u.emailVerified,
    verifyTokenHash: u.verifyTokenHash,
    verifyTokenExpires: u.verifyTokenExpires ? Number(u.verifyTokenExpires) : null,
    resetTokenHash: u.resetTokenHash,
    resetTokenExpires: u.resetTokenExpires ? Number(u.resetTokenExpires) : null,
    isDemo: u.isDemo,
    activeOrganizationId: u.activeOrganizationId,
    enabledModules: stringArray(u.enabledModules, DEFAULT_USER_MODULES),
    enabledWidgets: stringArray(u.enabledWidgets, DEFAULT_USER_WIDGETS),
    registrationComplete: u.registrationComplete ?? true,
    accountEnabled: u.accountEnabled !== false,
    approvalStatus: approvalStatusForUser(u),
    approvalRequestedAt: u.approvalRequestedAt ? new Date(u.approvalRequestedAt).toISOString() : undefined,
    approvalDecidedAt: u.approvalDecidedAt ? new Date(u.approvalDecidedAt).toISOString() : undefined,
    approvalDecidedBy: u.approvalDecidedBy || undefined,
    approvalTokenHash: u.approvalTokenHash,
    approvalTokenExpires: u.approvalTokenExpires ? Number(u.approvalTokenExpires) : null,
    sessionVersion: Number.isInteger(u.sessionVersion) && u.sessionVersion > 0 ? u.sessionVersion : 1,
    lastSeenAt: u.lastSeenAt ? new Date(u.lastSeenAt).toISOString() : undefined,
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : undefined,
    updatedAt: u.updatedAt ? new Date(u.updatedAt).toISOString() : undefined,
  };
}

/** Map one PostgreSQL membership row into the in-process directory shape. */
function mapPostgresMembershipRow(m: any) {
  return {
    id: m.id,
    userId: m.userId,
    organizationId: m.organizationId,
    role: m.role,
    createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : undefined,
    updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : undefined,
  };
}

function dbFromPostgresRows(rows: {
  users: any[];
  organizations: any[];
  memberships: any[];
  invitations: any[];
  organizationStates: any[];
}): DBState {
  const db: DBState = {
    users: rows.users.map(mapPostgresUserRow),
    organizations: rows.organizations.map(o => ({
      id: o.id,
      name: o.name,
      status: o.status || 'active',
      archivedAt: o.archivedAt ? new Date(o.archivedAt).toISOString() : null,
      deletionScheduledAt: o.deletionScheduledAt ? new Date(o.deletionScheduledAt).toISOString() : null,
      internalNotes: o.internalNotes || '',
      internalTags: stringArray(o.internalTags),
      createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : undefined,
      updatedAt: o.updatedAt ? new Date(o.updatedAt).toISOString() : undefined,
    })),
    memberships: rows.memberships.map(m => ({
      id: m.id,
      userId: m.userId,
      organizationId: m.organizationId,
      role: m.role,
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : undefined,
      updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : undefined,
    })),
    invitations: rows.invitations.map(i => ({
      id: i.id,
      email: i.email,
      organizationId: i.organizationId,
      role: i.role,
      tokenHash: i.tokenHash,
      expiresAt: i.expiresAt.toISOString(),
      acceptedAt: i.acceptedAt ? i.acceptedAt.toISOString() : null,
      revokedAt: i.revokedAt ? i.revokedAt.toISOString() : null,
      createdAt: i.createdAt ? new Date(i.createdAt).toISOString() : undefined,
    })),
    securityAuditEvents: [],
    whatsappDeliveries: [],
    orgData: {},
  };

  for (const state of rows.organizationStates) {
    rememberOrganizationStateMeta(state, 'postgres');
    db.orgData[state.organizationId] = normalizeUserData(state.data);
  }

  for (const org of db.organizations) {
    if (!db.orgData[org.id]) db.orgData[org.id] = createEmptyUserData();
  }

  return db;
}

function applyPostgresCoreMetadataRows(rows: {
  users: any[];
  organizations: any[];
  memberships: any[];
  invitations: any[];
}): DBState {
  const db = getDB();
  const core = dbFromPostgresRows({ ...rows, organizationStates: [] });
  db.users = core.users;
  db.organizations = core.organizations;
  db.memberships = core.memberships;
  db.invitations = core.invitations;

  for (const org of db.organizations) {
    if (!db.orgData[org.id]) db.orgData[org.id] = createEmptyUserData();
  }

  return db;
}

export function getDB(): DBState {
  if (!dbData) {
    dbData = {
      users: [],
      organizations: [],
      memberships: [],
      invitations: [],
      securityAuditEvents: [],
      whatsappDeliveries: [],
      orgData: {}
    };
  }

  if (!dbData.orgData || typeof dbData.orgData !== 'object') {
    dbData.orgData = {};
  }

  // Backwards compatibility proxy: redirect legacy db.userData[username] access to db.orgData[orgId]
  dbData.userData = new Proxy(dbData.orgData, {

    get(target, prop: string) {
      if (prop === 'then') return undefined; // Avoid promise resolution issues
      const user = dbData.users.find((u: any) => u.username === prop);
      if (user && user.activeOrganizationId) {
        return target[user.activeOrganizationId] || (target[user.activeOrganizationId] = createEmptyUserData());
      }
      if (prop in target) {
        return target[prop];
      }
      if (user) {
        return target[prop] || (target[prop] = createEmptyUserData());
      }
      return undefined;
    },
    set(target, prop: string, value) {
      const user = dbData.users.find((u: any) => u.username === prop);
      let orgId = user?.activeOrganizationId;
      if (!orgId) {
        orgId = prop;
        if (user) user.activeOrganizationId = orgId;
      }
      target[orgId] = value;
      return true;
    },
    has(target, prop: string) {
      const user = dbData.users.find((u: any) => u.username === prop);
      const key = user?.activeOrganizationId || prop;
      return key in target;
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    }
  });

  return dbData;
}

/**
 * Record lightweight user presence without turning every authenticated API
 * request into a database write. Memory is updated immediately; the shared
 * PostgreSQL row (or JSON fallback) is refreshed at most twice per minute.
 */
export async function touchUserPresence(username: string, now = new Date()): Promise<string | null> {
  const normalized = String(username || '').trim();
  if (!normalized) return null;
  const db = getDB();
  const user = db.users.find(candidate => candidate.username === normalized);
  if (!user) return null;

  const iso = now.toISOString();
  user.lastSeenAt = iso;
  const previousWrite = lastPresenceWriteAt.get(normalized) || 0;
  if (now.getTime() - previousWrite < PRESENCE_WRITE_INTERVAL_MS) return iso;
  lastPresenceWriteAt.set(normalized, now.getTime());

  const prisma = await getPrisma();
  if (prisma) {
    await prisma.user.updateMany({ where: { username: normalized }, data: { lastSeenAt: now } });
  } else {
    saveDB({ syncPostgres: false, gcsBackup: false });
  }
  return iso;
}

function writeLocalJsonBackup(jsonStr: string): void {
  try {
    const templatePath = path.resolve(__dirname, '../db.json');
    const targetPath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : templatePath;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${Date.now()}.tmp`);
    fs.writeFileSync(tempPath, jsonStr, 'utf8');
    replaceJsonFile(tempPath, targetPath);
    lastLocalSaveAt = new Date().toISOString();
    lastLocalSaveError = null;
  } catch (err) {
    lastLocalSaveError = err instanceof Error ? err.message : String(err);
    console.error('[db] failed to write local backup db.json:', err);
  }
}

export function saveDB(options: { syncPostgres?: boolean; gcsBackup?: boolean } = {}): void {
  if (!dbData) return;
  const jsonStr = serializeDbState(dbData);

  writeLocalJsonBackup(jsonStr);

  if (options.syncPostgres === false) {
    // `gcsBackup: true` lets callers that always want a GCS copy reuse this
    // serialization instead of stringifying the whole database a second time.
    if (options.gcsBackup || !isPostgresConfigured() || postgresDisabledAfterFailure) {
      backupJsonToGcs(jsonStr);
    }
    return;
  }

  if (postgresDisabledAfterFailure || !isPostgresConfigured()) {
    backupJsonToGcs(jsonStr);
    return;
  }

  void syncCoreDbToPrisma();
}

export async function forceSaveDB(): Promise<ReturnType<typeof getDbRuntimeStatus>> {
  const db = getDB();
  const jsonStr = serializeDbState(db);

  writeLocalJsonBackup(jsonStr);

  if (postgresDisabledAfterFailure || !isPostgresConfigured()) {
    await backupJsonToGcsNow(jsonStr);
    return getDbRuntimeStatus();
  }

  await persistFullDbToPostgres('admin-force-save', { awaitGcsBackup: true });
  return getDbRuntimeStatus();
}

async function syncCoreDbToPrisma(): Promise<void> {
  try {
    // getPrisma() can reject (dynamic import / client construction). This runs
    // as a floating promise from saveDB, so an escape here becomes an unhandled
    // rejection and takes the process down — keep it inside the guard.
    const prisma = await getPrisma();
    if (!prisma || !dbData) return;
    await persistFullDbToPostgres('memory-cache');
  } catch (err) {
    // persistFullDbToPostgres records the detailed error. Keep this background
    // sync non-fatal so request handlers can continue using the in-memory state.
    console.error('[db] background PostgreSQL JSONB sync failed:', err);
  }
}

async function persistCoreMetadataToPostgres(source: string): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma || !dbData) return;

  const db = normalizeDbState(dbData);
  dbData = db;

  try {
    await prisma.$transaction(async (tx) => {
      for (const org of db.organizations || []) {
        if (!org?.id) continue;
        await tx.organization.upsert({
          where: { id: org.id },
          update: {
            name: org.name || org.id,
            status: org.status || 'active',
            archivedAt: org.archivedAt ? new Date(org.archivedAt) : null,
            deletionScheduledAt: org.deletionScheduledAt ? new Date(org.deletionScheduledAt) : null,
            internalNotes: org.internalNotes || null,
            internalTags: Array.isArray(org.internalTags) ? org.internalTags : [],
          },
          create: {
            id: org.id,
            name: org.name || org.id,
            status: org.status || 'active',
            archivedAt: org.archivedAt ? new Date(org.archivedAt) : null,
            deletionScheduledAt: org.deletionScheduledAt ? new Date(org.deletionScheduledAt) : null,
            internalNotes: org.internalNotes || null,
            internalTags: Array.isArray(org.internalTags) ? org.internalTags : [],
          },
        });
      }

      for (const user of db.users || []) {
        if (!user?.username) continue;
        await tx.user.upsert({
          where: { username: user.username },
          update: {
            email: user.email || `${user.username}@local.invalid`,
            fullName: user.fullName || user.username,
            role: user.role || 'Owner/Admin',
            language: user.language || 'en',
            phone: user.phone || '',
            whatsappOptIn: user.whatsappOptIn === true,
            passwordHash: user.passwordHash || '',
            emailVerified: user.emailVerified ?? false,
            verifyTokenHash: user.verifyTokenHash || null,
            verifyTokenExpires: user.verifyTokenExpires ? BigInt(user.verifyTokenExpires) : null,
            resetTokenHash: user.resetTokenHash || null,
            resetTokenExpires: user.resetTokenExpires ? BigInt(user.resetTokenExpires) : null,
            isDemo: user.isDemo ?? false,
            activeOrganizationId: user.activeOrganizationId || null,
            enabledModules: jsonForPrisma(stringArray(user.enabledModules, DEFAULT_USER_MODULES)),
            enabledWidgets: jsonForPrisma(stringArray(user.enabledWidgets, DEFAULT_USER_WIDGETS)),
            registrationComplete: user.registrationComplete ?? true,
            accountEnabled: user.accountEnabled !== false,
            approvalStatus: approvalStatusForUser(user),
            approvalRequestedAt: user.approvalRequestedAt ? new Date(user.approvalRequestedAt) : null,
            approvalDecidedAt: user.approvalDecidedAt ? new Date(user.approvalDecidedAt) : null,
            approvalDecidedBy: user.approvalDecidedBy || null,
            approvalTokenHash: user.approvalTokenHash || null,
            approvalTokenExpires: user.approvalTokenExpires ? BigInt(user.approvalTokenExpires) : null,
            sessionVersion: Number.isInteger(Number(user.sessionVersion)) ? Number(user.sessionVersion) : 1,
            lastSeenAt: user.lastSeenAt ? new Date(user.lastSeenAt) : null,
          },
          create: {
            id: user.id || undefined,
            username: user.username,
            email: user.email || `${user.username}@local.invalid`,
            fullName: user.fullName || user.username,
            role: user.role || 'Owner/Admin',
            language: user.language || 'en',
            phone: user.phone || '',
            whatsappOptIn: user.whatsappOptIn === true,
            passwordHash: user.passwordHash || '',
            emailVerified: user.emailVerified ?? false,
            verifyTokenHash: user.verifyTokenHash || null,
            verifyTokenExpires: user.verifyTokenExpires ? BigInt(user.verifyTokenExpires) : null,
            resetTokenHash: user.resetTokenHash || null,
            resetTokenExpires: user.resetTokenExpires ? BigInt(user.resetTokenExpires) : null,
            isDemo: user.isDemo ?? false,
            activeOrganizationId: user.activeOrganizationId || null,
            enabledModules: jsonForPrisma(stringArray(user.enabledModules, DEFAULT_USER_MODULES)),
            enabledWidgets: jsonForPrisma(stringArray(user.enabledWidgets, DEFAULT_USER_WIDGETS)),
            registrationComplete: user.registrationComplete ?? true,
            accountEnabled: user.accountEnabled !== false,
            approvalStatus: approvalStatusForUser(user),
            approvalRequestedAt: user.approvalRequestedAt ? new Date(user.approvalRequestedAt) : null,
            approvalDecidedAt: user.approvalDecidedAt ? new Date(user.approvalDecidedAt) : null,
            approvalDecidedBy: user.approvalDecidedBy || null,
            approvalTokenHash: user.approvalTokenHash || null,
            approvalTokenExpires: user.approvalTokenExpires ? BigInt(user.approvalTokenExpires) : null,
            sessionVersion: Number.isInteger(Number(user.sessionVersion)) ? Number(user.sessionVersion) : 1,
            lastSeenAt: user.lastSeenAt ? new Date(user.lastSeenAt) : null,
          },
        });
      }

      for (const membership of db.memberships || []) {
        if (!membership?.id || !membership.userId || !membership.organizationId) continue;
        await tx.membership.upsert({
          where: { id: membership.id },
          update: { role: membership.role || 'Read-Only' },
          create: {
            id: membership.id,
            userId: membership.userId,
            organizationId: membership.organizationId,
            role: membership.role || 'Read-Only',
          },
        });
      }

      for (const invite of db.invitations || []) {
        if (!invite?.id || !invite.organizationId || !invite.email) continue;
        const expiresAt = invite.expiresAt ? new Date(invite.expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await tx.invitation.upsert({
          where: { id: invite.id },
          update: {
            email: invite.email,
            organizationId: invite.organizationId,
            role: invite.role || 'Read-Only',
            tokenHash: invite.tokenHash || hashToken(invite.id),
            expiresAt,
            acceptedAt: invite.acceptedAt ? new Date(invite.acceptedAt) : null,
            revokedAt: invite.revokedAt ? new Date(invite.revokedAt) : null,
          },
          create: {
            id: invite.id,
            email: invite.email,
            organizationId: invite.organizationId,
            role: invite.role || 'Read-Only',
            tokenHash: invite.tokenHash || hashToken(invite.id),
            expiresAt,
            acceptedAt: invite.acceptedAt ? new Date(invite.acceptedAt) : null,
            revokedAt: invite.revokedAt ? new Date(invite.revokedAt) : null,
          },
        });
      }
    });

    lastPostgresSyncAt = new Date().toISOString();
    lastPostgresSyncError = null;
  } catch (err) {
    lastPostgresSyncError = err instanceof Error ? err.message : String(err);
    console.error(`[db] PostgreSQL core metadata persistence failed (${source}):`, err);
    throw err;
  }
}

export interface SessionPrincipal {
  user: any;
  memberships: any[];
}

/**
 * Load exactly the rows an authenticated request needs to authorise itself: one
 * user and their memberships, by key.
 *
 * This exists because the request path used to call
 * `refreshCoreMetadataFromPostgres()`, which issues four unfiltered `findMany`
 * queries and rebuilds the whole in-process directory — every user,
 * organization, membership, and invitation on the platform, on every
 * authenticated request. That is O(all tenants) per request, serialized through
 * one event loop, to answer a question about one person.
 *
 * Freshness is not relaxed to achieve that. The fields the request path decides
 * on — `accountEnabled`, `approvalStatus`, `sessionVersion`, and the membership
 * role — are still read from PostgreSQL on every request, because approval can
 * be withdrawn and roles changed after a session is issued. Only the scope of
 * the read changes.
 *
 * The rows are also written back into the process directory, so code that reads
 * `getDB().users` for the *requesting* user keeps seeing current data. Routes
 * that enumerate other users already call `refreshCoreMetadataFromPostgres()`
 * themselves — every admin and auth handler does — so none of them depended on
 * this path as their source of freshness.
 *
 * Returns `null` when PostgreSQL is unavailable, leaving the caller on the
 * in-memory directory exactly as before.
 */
export async function loadSessionPrincipal(username: string): Promise<SessionPrincipal | null> {
  const prisma = await getPrisma();
  if (!prisma) return null;

  try {
    const row = await prisma.user.findUnique({
      where: { username },
      include: { memberships: true },
    });
    if (!row) {
      // Deleted between requests: drop the stale directory entry so a cached
      // row cannot keep authorising a user who no longer exists.
      const db = getDB();
      db.users = db.users.filter((candidate: any) => candidate.username !== username);
      db.memberships = (db.memberships || []).filter((candidate: any) => candidate.userId !== username);
      return null;
    }

    const user = mapPostgresUserRow(row);
    const memberships = (row.memberships || []).map(mapPostgresMembershipRow);

    const db = getDB();
    const userIndex = db.users.findIndex((candidate: any) => candidate.username === username);
    if (userIndex === -1) db.users.push(user);
    else db.users[userIndex] = user;

    if (!db.memberships) db.memberships = [];
    db.memberships = [
      ...db.memberships.filter((candidate: any) => candidate.userId !== username),
      ...memberships,
    ];

    lastPostgresSyncError = null;
    return { user, memberships };
  } catch (err) {
    lastPostgresSyncError = err instanceof Error ? err.message : String(err);
    console.warn('[db] session principal lookup failed; using process cache fallback:', err);
    return null;
  }
}

export async function refreshCoreMetadataFromPostgres(): Promise<boolean> {
  const prisma = await getPrisma();
  if (!prisma) return false;

  try {
    const [users, organizations, memberships, invitations] = await Promise.all([
      prisma.user.findMany(),
      prisma.organization.findMany(),
      prisma.membership.findMany(),
      prisma.invitation.findMany(),
    ]);
    applyPostgresCoreMetadataRows({ users, organizations, memberships, invitations });
    lastPostgresSyncAt = new Date().toISOString();
    lastPostgresSyncError = null;
    return true;
  } catch (err) {
    lastPostgresSyncError = err instanceof Error ? err.message : String(err);
    console.warn('[db] PostgreSQL core metadata refresh failed; using process cache fallback:', err);
    return false;
  }
}

export type InvitationAcceptanceStatus =
  | 'success'
  | 'not_found'
  | 'already_accepted'
  | 'revoked'
  | 'expired'
  | 'user_not_found'
  | 'email_mismatch'
  | 'email_unverified';

export interface InvitationAcceptanceResult {
  status: InvitationAcceptanceStatus;
  organizationId?: string;
  role?: string;
}

function normalizedEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Claim an invitation and create/update its membership as one database
 * transaction. The conditional update is the concurrency gate: only one
 * request can move acceptedAt from null, so duplicate submissions cannot race
 * into multiple or partially-applied memberships.
 */
export async function acceptInvitationAtomically(
  tokenHash: string,
  username: string,
  now = new Date(),
): Promise<InvitationAcceptanceResult> {
  const prisma = await getPrisma();

  if (prisma) {
    const result = await prisma.$transaction(async (tx) => {
      const invite = await tx.invitation.findUnique({ where: { tokenHash } });
      if (!invite) return { status: 'not_found' } as InvitationAcceptanceResult;
      if (invite.acceptedAt) return { status: 'already_accepted' } as InvitationAcceptanceResult;
      if (invite.revokedAt) return { status: 'revoked' } as InvitationAcceptanceResult;
      if (invite.expiresAt.getTime() <= now.getTime()) return { status: 'expired' } as InvitationAcceptanceResult;

      const user = await tx.user.findUnique({ where: { username } });
      if (!user) return { status: 'user_not_found' } as InvitationAcceptanceResult;
      if (user.accountEnabled === false) return { status: 'user_not_found' } as InvitationAcceptanceResult;
      if (normalizedEmail(user.email) !== normalizedEmail(invite.email)) {
        return { status: 'email_mismatch' } as InvitationAcceptanceResult;
      }
      if (!user.emailVerified) return { status: 'email_unverified' } as InvitationAcceptanceResult;

      const claimed = await tx.invitation.updateMany({
        where: {
          id: invite.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      if (claimed.count !== 1) {
        return { status: 'already_accepted' } as InvitationAcceptanceResult;
      }

      await tx.membership.upsert({
        where: {
          userId_organizationId: {
            userId: user.username,
            organizationId: invite.organizationId,
          },
        },
        update: { role: invite.role },
        create: {
          userId: user.username,
          organizationId: invite.organizationId,
          role: invite.role,
        },
      });
      await tx.user.update({
        where: { username: user.username },
        data: { activeOrganizationId: invite.organizationId },
      });

      return {
        status: 'success',
        organizationId: invite.organizationId,
        role: invite.role,
      } as InvitationAcceptanceResult;
    });

    if (result.status === 'success') await refreshCoreMetadataFromPostgres();
    return result;
  }

  const db = getDB();
  const invite = db.invitations.find((candidate: any) => candidate.tokenHash === tokenHash);
  if (!invite) return { status: 'not_found' };
  if (invite.acceptedAt) return { status: 'already_accepted' };
  if (invite.revokedAt) return { status: 'revoked' };
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return { status: 'expired' };

  const user = db.users.find((candidate: any) => candidate.username === username);
  if (!user) return { status: 'user_not_found' };
  if (user.accountEnabled === false) return { status: 'user_not_found' };
  if (normalizedEmail(user.email) !== normalizedEmail(invite.email)) return { status: 'email_mismatch' };
  if (user.emailVerified === false) return { status: 'email_unverified' };

  // Claim before the first await so concurrent requests in this process see it.
  invite.acceptedAt = now.toISOString();
  const existing = db.memberships.find((membership: any) => (
    membership.userId === user.username && membership.organizationId === invite.organizationId
  ));
  if (existing) {
    existing.role = invite.role;
  } else {
    db.memberships.push({
      id: `mem_${Math.random().toString(36).slice(2, 11)}`,
      userId: user.username,
      organizationId: invite.organizationId,
      role: invite.role,
    });
  }
  user.activeOrganizationId = invite.organizationId;
  await saveCoreMetadata('org-invite-accept');
  return { status: 'success', organizationId: invite.organizationId, role: invite.role };
}

export interface SecurityAuditEventInput {
  eventType: string;
  username?: string | null;
  actorUsername?: string | null;
  organizationId?: string | null;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
}

function safeAuditMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(([key]) => (
    !/(authorization|cookie|passcode|password|secret|token)/i.test(key)
  ));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export async function recordSecurityAuditEvent(input: SecurityAuditEventInput): Promise<void> {
  const eventType = String(input.eventType || '').trim();
  if (!eventType) return;
  const metadata = safeAuditMetadata(input.metadata);
  const data = {
    eventType,
    username: input.username || null,
    actorUsername: input.actorUsername || null,
    organizationId: input.organizationId || null,
    ipHash: input.ipHash || null,
    metadata: metadata ? jsonForPrisma(metadata) : undefined,
  };

  const prisma = await getPrisma();
  if (prisma && (prisma as any).securityAuditEvent) {
    await (prisma as any).securityAuditEvent.create({ data });
    return;
  }

  const db = getDB();
  if (!db.securityAuditEvents) db.securityAuditEvents = [];
  db.securityAuditEvents.unshift({
    id: `security_${Math.random().toString(36).slice(2, 11)}`,
    ...data,
    createdAt: new Date().toISOString(),
  });
  if (db.securityAuditEvents.length > 2000) db.securityAuditEvents.length = 2000;
  saveDB({ syncPostgres: false });
}

export async function listSecurityAuditEvents(limit = 200): Promise<any[]> {
  const take = Math.min(500, Math.max(1, Math.floor(limit)));
  const prisma = await getPrisma();
  if (prisma && (prisma as any).securityAuditEvent) {
    const rows = await (prisma as any).securityAuditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.map((row: any) => ({
      ...row,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    }));
  }
  return [...(getDB().securityAuditEvents || [])].slice(0, take);
}

export async function saveCoreMetadata(source = 'core-metadata'): Promise<void> {
  const db = normalizeDbState(getDB());
  dbData = db;
  const jsonStr = serializeDbState(db);
  writeLocalJsonBackup(jsonStr);

  const prisma = await getPrisma();
  if (!prisma) {
    // Without Postgres, GCS is the only durable store. Account metadata is
    // rare but must never be lost, so upload synchronously within the request
    // — Cloud Run throttles CPU after the response, so a debounced background
    // upload may never run and the account would vanish on instance recycle.
    await backupJsonToGcsNow(jsonStr);
    return;
  }

  await persistCoreMetadataToPostgres(source);
  backupJsonToGcs(jsonStr);
}

export async function deleteUserMetadataFromPostgres(username: string): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;

  try {
    await prisma.user.deleteMany({ where: { username } });
    lastPostgresSyncAt = new Date().toISOString();
    lastPostgresSyncError = null;
  } catch (err) {
    lastPostgresSyncError = err instanceof Error ? err.message : String(err);
    console.error(`[db] PostgreSQL user metadata delete failed (${username}):`, err);
    throw err;
  }
}

/**
 * Remove one tenant and every PostgreSQL record owned by it. The Prisma
 * relations use cascading deletes, so this also clears memberships, the JSONB
 * organization state, billing metadata, and relational projections.
 *
 * Core-metadata saves intentionally only upsert records. Deletion therefore
 * needs an explicit database operation or another application instance would
 * rehydrate the removed tenant on its next metadata refresh.
 */
export async function deleteOrganizationMetadataFromPostgres(organizationId: string): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;

  try {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    lastPostgresSyncAt = new Date().toISOString();
    lastPostgresSyncError = null;
  } catch (err) {
    lastPostgresSyncError = err instanceof Error ? err.message : String(err);
    console.error(`[db] PostgreSQL organization metadata delete failed (${organizationId}):`, err);
    throw err;
  }
}

/** Explicit counterpart to the membership upserts in saveCoreMetadata. */
export async function deleteMembershipMetadataFromPostgres(
  username: string,
  organizationId: string,
): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;

  try {
    await prisma.membership.deleteMany({ where: { userId: username, organizationId } });
    lastPostgresSyncAt = new Date().toISOString();
    lastPostgresSyncError = null;
  } catch (err) {
    lastPostgresSyncError = err instanceof Error ? err.message : String(err);
    console.error(`[db] PostgreSQL membership metadata delete failed (${username}, ${organizationId}):`, err);
    throw err;
  }
}

export interface PostgresReadinessProbe {
  ok: boolean;
  checkedAt: string;
  configured: boolean;
  usable: boolean;
  target: string | null;
  checks: {
    coreMetadataRead: boolean;
    organizationStateRead: boolean;
    loginAttemptStoreRead: boolean;
    securityAuditStoreRead: boolean;
    billingStorageRead?: boolean;
    relationalProjectionRead: boolean;
  };
  errors: string[];
}

async function probePrismaModelRead(model: any, label: string, errors: string[]): Promise<boolean> {
  if (!model) {
    errors.push(`${label} Prisma model is not available in the generated client.`);
    return false;
  }

  try {
    if (typeof model.findMany === 'function') {
      await model.findMany({ take: 1 });
      return true;
    }
    // Compatibility fallback for minimal clients/test doubles. Generated
    // Prisma models use the bounded findMany branch above so readiness never
    // scans an entire growing audit or login-attempt table.
    if (typeof model.count === 'function') {
      await model.count();
      return true;
    }
    errors.push(`${label} Prisma model has no readable findMany/count method.`);
    return false;
  } catch (err) {
    errors.push(`${label} read failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function getPostgresReadinessProbe(): Promise<PostgresReadinessProbe> {
  const configured = isPostgresConfigured();
  const probe: PostgresReadinessProbe = {
    ok: true,
    checkedAt: new Date().toISOString(),
    configured,
    usable: configured && !postgresDisabledAfterFailure,
    target: maskedDatabaseTarget(),
    checks: {
      coreMetadataRead: false,
      organizationStateRead: false,
      loginAttemptStoreRead: false,
      securityAuditStoreRead: false,
      billingStorageRead: false,
      relationalProjectionRead: false,
    },
    errors: [],
  };

  if (!configured) {
    return probe;
  }

  const prisma = await getPrisma();
  if (!prisma) {
    probe.ok = false;
    probe.errors.push('PostgreSQL is configured but Prisma is not available for this process.');
    return probe;
  }

  const coreChecks = await Promise.all([
    probePrismaModelRead((prisma as any).user, 'User', probe.errors),
    probePrismaModelRead((prisma as any).organization, 'Organization', probe.errors),
    probePrismaModelRead((prisma as any).membership, 'Membership', probe.errors),
    probePrismaModelRead((prisma as any).invitation, 'Invitation', probe.errors),
  ]);
  probe.checks.coreMetadataRead = coreChecks.every(Boolean);
  probe.checks.organizationStateRead = await probePrismaModelRead((prisma as any).organizationState, 'OrganizationState', probe.errors);
  probe.checks.loginAttemptStoreRead = await probePrismaModelRead((prisma as any).loginAttempt, 'LoginAttempt', probe.errors);
  probe.checks.securityAuditStoreRead = await probePrismaModelRead((prisma as any).securityAuditEvent, 'SecurityAuditEvent', probe.errors);
  const billingChecks = await Promise.all([
    probePrismaModelRead((prisma as any).organizationSubscription, 'OrganizationSubscription', probe.errors),
    probePrismaModelRead((prisma as any).billingPayment, 'BillingPayment', probe.errors),
    probePrismaModelRead((prisma as any).subscriptionRequest, 'SubscriptionRequest', probe.errors),
    probePrismaModelRead((prisma as any).subscriptionAudit, 'SubscriptionAudit', probe.errors),
    probePrismaModelRead((prisma as any).annualProductionUsage, 'AnnualProductionUsage', probe.errors),
  ]);
  probe.checks.billingStorageRead = billingChecks.every(Boolean);
  const projectionChecks = await Promise.all([
    probePrismaModelRead((prisma as any).vessel, 'Vessel', probe.errors),
    probePrismaModelRead((prisma as any).wineLot, 'WineLot', probe.errors),
  ]);
  probe.checks.relationalProjectionRead = projectionChecks.every(Boolean);
  probe.ok = Object.values(probe.checks).every(Boolean) && probe.errors.length === 0;
  return probe;
}

async function persistFullDbToPostgres(
  source: string,
  options: { awaitGcsBackup?: boolean } = {}
): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma || !dbData) return;

  const db = normalizeDbState(dbData);
  dbData = db;

  try {
    await prisma.$transaction(async (tx) => {
      const knownOrgIds = new Set<string>([
        ...(db.organizations || []).map((org: any) => org.id).filter(Boolean),
        ...(db.memberships || []).map((membership: any) => membership.organizationId).filter(Boolean),
        ...(db.users || []).map((user: any) => user.activeOrganizationId).filter(Boolean),
        ...Object.keys(db.orgData || {}),
      ]);

      for (const orgId of knownOrgIds) {
        const org = (db.organizations || []).find((candidate: any) => candidate.id === orgId);
        await tx.organization.upsert({
          where: { id: orgId },
          update: { name: org?.name || orgId },
          create: { id: orgId, name: org?.name || orgId },
        });
      }

      for (const user of db.users || []) {
        if (!user?.username) continue;
        await tx.user.upsert({
          where: { username: user.username },
          update: {
            email: user.email || `${user.username}@local.invalid`,
            fullName: user.fullName || user.username,
            role: user.role || 'Owner/Admin',
            language: user.language || 'en',
            phone: user.phone || '',
            whatsappOptIn: user.whatsappOptIn === true,
            passwordHash: user.passwordHash || '',
            emailVerified: user.emailVerified ?? false,
            verifyTokenHash: user.verifyTokenHash || null,
            verifyTokenExpires: user.verifyTokenExpires ? BigInt(user.verifyTokenExpires) : null,
            resetTokenHash: user.resetTokenHash || null,
            resetTokenExpires: user.resetTokenExpires ? BigInt(user.resetTokenExpires) : null,
            isDemo: user.isDemo ?? false,
            activeOrganizationId: user.activeOrganizationId || null,
            enabledModules: jsonForPrisma(stringArray(user.enabledModules, DEFAULT_USER_MODULES)),
            enabledWidgets: jsonForPrisma(stringArray(user.enabledWidgets, DEFAULT_USER_WIDGETS)),
            registrationComplete: user.registrationComplete ?? true,
            accountEnabled: user.accountEnabled !== false,
            approvalStatus: approvalStatusForUser(user),
            approvalRequestedAt: user.approvalRequestedAt ? new Date(user.approvalRequestedAt) : null,
            approvalDecidedAt: user.approvalDecidedAt ? new Date(user.approvalDecidedAt) : null,
            approvalDecidedBy: user.approvalDecidedBy || null,
            approvalTokenHash: user.approvalTokenHash || null,
            approvalTokenExpires: user.approvalTokenExpires ? BigInt(user.approvalTokenExpires) : null,
            sessionVersion: Number.isInteger(Number(user.sessionVersion)) ? Number(user.sessionVersion) : 1,
          },
          create: {
            username: user.username,
            email: user.email || `${user.username}@local.invalid`,
            fullName: user.fullName || user.username,
            role: user.role || 'Owner/Admin',
            language: user.language || 'en',
            phone: user.phone || '',
            whatsappOptIn: user.whatsappOptIn === true,
            passwordHash: user.passwordHash || '',
            emailVerified: user.emailVerified ?? false,
            verifyTokenHash: user.verifyTokenHash || null,
            verifyTokenExpires: user.verifyTokenExpires ? BigInt(user.verifyTokenExpires) : null,
            resetTokenHash: user.resetTokenHash || null,
            resetTokenExpires: user.resetTokenExpires ? BigInt(user.resetTokenExpires) : null,
            isDemo: user.isDemo ?? false,
            activeOrganizationId: user.activeOrganizationId || null,
            enabledModules: jsonForPrisma(stringArray(user.enabledModules, DEFAULT_USER_MODULES)),
            enabledWidgets: jsonForPrisma(stringArray(user.enabledWidgets, DEFAULT_USER_WIDGETS)),
            registrationComplete: user.registrationComplete ?? true,
            accountEnabled: user.accountEnabled !== false,
            approvalStatus: approvalStatusForUser(user),
            approvalRequestedAt: user.approvalRequestedAt ? new Date(user.approvalRequestedAt) : null,
            approvalDecidedAt: user.approvalDecidedAt ? new Date(user.approvalDecidedAt) : null,
            approvalDecidedBy: user.approvalDecidedBy || null,
            approvalTokenHash: user.approvalTokenHash || null,
            approvalTokenExpires: user.approvalTokenExpires ? BigInt(user.approvalTokenExpires) : null,
            sessionVersion: Number.isInteger(Number(user.sessionVersion)) ? Number(user.sessionVersion) : 1,
          },
        });
      }

      for (const membership of db.memberships || []) {
        if (!membership?.id || !membership.userId || !membership.organizationId) continue;
        await tx.membership.upsert({
          where: { id: membership.id },
          update: { role: membership.role || 'Read-Only' },
          create: {
            id: membership.id,
            userId: membership.userId,
            organizationId: membership.organizationId,
            role: membership.role || 'Read-Only',
          },
        });
      }

      for (const invite of db.invitations || []) {
        if (!invite?.id || !invite.organizationId || !invite.email) continue;
        const expiresAt = invite.expiresAt ? new Date(invite.expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await tx.invitation.upsert({
          where: { id: invite.id },
          update: {
            email: invite.email,
            organizationId: invite.organizationId,
            role: invite.role || 'Read-Only',
            tokenHash: invite.tokenHash || hashToken(invite.id),
            expiresAt,
            acceptedAt: invite.acceptedAt ? new Date(invite.acceptedAt) : null,
            revokedAt: invite.revokedAt ? new Date(invite.revokedAt) : null,
          },
          create: {
            id: invite.id,
            email: invite.email,
            organizationId: invite.organizationId,
            role: invite.role || 'Read-Only',
            tokenHash: invite.tokenHash || hashToken(invite.id),
            expiresAt,
            acceptedAt: invite.acceptedAt ? new Date(invite.acceptedAt) : null,
            revokedAt: invite.revokedAt ? new Date(invite.revokedAt) : null,
          },
        });
      }

      for (const orgId of knownOrgIds) {
        const state = normalizeUserData(db.orgData?.[orgId]);
        await (tx as any).organizationState.upsert({
          where: { organizationId: orgId },
          update: {
            data: jsonForPrisma(state),
            version: { increment: 1 },
            updatedBy: source,
          },
          create: {
            organizationId: orgId,
            data: jsonForPrisma(state),
            version: 1,
            updatedBy: source,
          },
        });
        await syncVesselLotProjection(tx, orgId, state);
      }
    });

    lastPostgresSaveAt = new Date().toISOString();
    lastPostgresSaveError = null;
    lastPostgresSyncAt = lastPostgresSaveAt;
    lastPostgresSyncError = null;
    const jsonBackup = serializeDbState(db);
    if (options.awaitGcsBackup) {
      await backupJsonToGcsNow(jsonBackup);
    } else {
      backupJsonToGcs(jsonBackup);
    }
  } catch (err) {
    lastPostgresSaveError = err instanceof Error ? err.message : String(err);
    lastPostgresSyncError = lastPostgresSaveError;
    console.error('[db] PostgreSQL JSONB persistence failed:', err);
    throw err;
  }
}

export function getDbRuntimeStatus() {
  const templatePath = path.resolve(__dirname, '../db.json');
  const targetPath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : templatePath;
  const postgresConfigured = isPostgresConfigured();
  const postgresUsable = postgresConfigured && !postgresDisabledAfterFailure;
  const persistenceMode = postgresUsable ? 'postgresql-jsonb' : (gcsEnabled ? 'gcs-json' : 'local-json');
  const warnings: string[] = [];
  let localFileSizeBytes = 0;
  let localFileUpdatedAt: string | null = null;

  try {
    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      localFileSizeBytes = stat.size;
      localFileUpdatedAt = stat.mtime.toISOString();
    }
  } catch (err) {
    warnings.push(`Could not inspect local database file: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (postgresConfigured && postgresDisabledAfterFailure) {
    warnings.push('PostgreSQL is configured but unavailable; the app is using JSON fallback for this process.');
  }
  if (process.env.NODE_ENV === 'production' && persistenceMode === 'local-json') {
    warnings.push('Production is using local JSON storage. Configure PostgreSQL or GCS before real multi-user use.');
  }
  if (lastLocalSaveError) warnings.push(`Last local JSON save failed: ${lastLocalSaveError}`);
  if (lastGcsUploadError) warnings.push(`Last GCS upload failed: ${lastGcsUploadError}`);
  if (lastPostgresSaveError || lastPostgresSyncError) warnings.push(lastPostgresSaveError || lastPostgresSyncError || 'PostgreSQL save failed.');

  const db = dbData || {
    users: [],
    organizations: [],
    memberships: [],
    invitations: [],
    securityAuditEvents: [],
    whatsappDeliveries: [],
    orgData: {}
  };
  const serializedBytes = Buffer.byteLength(JSON.stringify(db), 'utf8');
  const organizationStateSummaries = Object.entries(db.orgData || {}).map(([organizationId, state]) => {
    const meta = organizationStateMeta.get(organizationId);
    const organization = (db.organizations || []).find((org: any) => org.id === organizationId);
    return {
      organizationId,
      organizationName: organization?.name || organizationId,
      version: meta?.version ?? null,
      updatedAt: meta?.updatedAt ?? null,
      updatedBy: meta?.updatedBy ?? null,
      source: meta?.source ?? (postgresUsable ? 'memory-cache' : 'json-fallback'),
      dataSizeBytes: Buffer.byteLength(JSON.stringify(state || {}), 'utf8'),
    };
  }).sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bTime - aTime;
  });
  const latestOrganizationState = organizationStateSummaries[0] || null;

  return {
    ok: warnings.length === 0,
    checkedAt: new Date().toISOString(),
    persistenceMode,
    activeBackendLabel: persistenceMode === 'postgresql-jsonb'
      ? 'PostgreSQL JSONB organization state via Prisma'
      : persistenceMode === 'gcs-json'
        ? 'Google Cloud Storage JSON fallback'
        : 'Local JSON fallback',
    postgres: {
      configured: postgresConfigured,
      usable: postgresUsable,
      disabledAfterFailure: postgresDisabledAfterFailure,
      clientLoaded: Boolean(prismaInstance),
      target: maskedDatabaseTarget(),
      lastMetadataSyncAt: lastPostgresSyncAt,
      lastMetadataSyncError: lastPostgresSyncError,
      lastSaveAt: lastPostgresSaveAt,
      lastSaveError: lastPostgresSaveError,
      lastMigrationAt: lastPostgresMigrationAt,
      lastMigrationSource: lastPostgresMigrationSource,
    },
    json: {
      localPath: targetPath,
      localFileSizeBytes,
      localFileUpdatedAt,
      lastLocalSaveAt,
      lastLocalSaveError,
      gcsEnabled,
      gcsTarget: gcsTarget(),
      lastGcsUploadAttemptAt,
      lastGcsUploadAt,
      lastGcsUploadError,
    },
    memory: {
      loaded: Boolean(dbData),
      usersCount: db.users?.length || 0,
      organizationsCount: db.organizations?.length || 0,
      membershipsCount: db.memberships?.length || 0,
      invitationsCount: db.invitations?.length || 0,
      orgDataCount: Object.keys(db.orgData || {}).length,
      serializedBytes,
    },
    organizationStates: {
      trackedCount: organizationStateSummaries.length,
      latestOrganizationId: latestOrganizationState?.organizationId || null,
      latestVersion: latestOrganizationState?.version ?? null,
      latestUpdatedAt: latestOrganizationState?.updatedAt || null,
      states: organizationStateSummaries,
    },
    warnings,
  };
}

export function getActiveOrganizationIdForUser(username: string): string | null {
  const db = getDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return null;
  if (user.activeOrganizationId) return user.activeOrganizationId;

  const membership = db.memberships.find(m => m.userId === user.username || m.userId === (user as any).id);
  return membership?.organizationId || null;
}

export async function getOrganizationStateMeta(orgId: string): Promise<OrganizationStateMeta> {
  const prisma = await getPrisma();
  if (prisma && (prisma as any).organizationState?.findUnique) {
    const state = await (prisma as any).organizationState.findUnique({
      where: { organizationId: orgId },
      select: { organizationId: true, version: true, updatedAt: true, updatedBy: true },
    });
    if (state) return rememberOrganizationStateMeta(state, 'postgres');
  }

  const cached = organizationStateMeta.get(orgId);
  if (cached) return cached;

  const db = getDB();
  if (db.orgData?.[orgId]) {
    return {
      organizationId: orgId,
      version: null,
      updatedAt: lastPostgresSaveAt || lastLocalSaveAt,
      updatedBy: null,
      source: isPostgresConfigured() && !postgresDisabledAfterFailure ? 'memory-cache' : 'json-fallback',
    };
  }

  return {
    organizationId: orgId,
    version: null,
    updatedAt: null,
    updatedBy: null,
    source: 'missing',
  };
}

export async function getUserOrganizationStateMeta(username: string): Promise<OrganizationStateMeta | null> {
  const orgId = getActiveOrganizationIdForUser(username);
  return orgId ? getOrganizationStateMeta(orgId) : null;
}

export async function reloadOrganizationDataFromPostgres(orgId: string): Promise<{ data: UserDataState; meta: OrganizationStateMeta } | null> {
  const prisma = await getPrisma();
  if (!prisma) return null;

  const state = await (prisma as any).organizationState.findUnique({
    where: { organizationId: orgId },
  });
  if (!state) return null;

  const data = normalizeUserData(state.data);
  const db = getDB();
  db.orgData[orgId] = data;
  const meta = rememberOrganizationStateMeta(state, 'postgres');
  return { data, meta };
}

export async function reloadUserOrganizationDataFromPostgres(username: string): Promise<{ data: UserDataState; meta: OrganizationStateMeta } | null> {
  const orgId = getActiveOrganizationIdForUser(username);
  return orgId ? reloadOrganizationDataFromPostgres(orgId) : null;
}

export async function getOrganizationData(orgId: string): Promise<UserDataState | null> {
  const db = getDB();
  if (!db.orgData[orgId]) {
    const prisma = await getPrisma();
    if (!prisma) return null;

    const state = await (prisma as any).organizationState.findUnique({ where: { organizationId: orgId } });
    if (!state) return null;
    rememberOrganizationStateMeta(state, 'postgres');
    db.orgData[orgId] = normalizeUserData(state.data);
  }

  const normalized = normalizeUserData(db.orgData[orgId]);
  db.orgData[orgId] = normalized;
  return normalized;
}

export async function saveOrganizationData(
  orgId: string,
  data: UserDataState,
  options: { expectedVersion?: number | null; updatedBy?: string } = {}
): Promise<void> {
  const db = getDB();
  db.orgData[orgId] = normalizeUserData(data);

  const prisma = await getPrisma();
  if (!prisma) {
    saveDB({ syncPostgres: false, gcsBackup: true });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const org = db.organizations.find((candidate: any) => candidate.id === orgId);
      await tx.organization.upsert({
        where: { id: orgId },
        update: { name: org?.name || orgId },
        create: { id: orgId, name: org?.name || orgId },
      });

      const updatedBy = options.updatedBy || 'saveOrganizationData';
      if (typeof options.expectedVersion === 'number') {
        const result = await (tx as any).organizationState.updateMany({
          where: { organizationId: orgId, version: options.expectedVersion },
          data: {
            data: jsonForPrisma(db.orgData[orgId]),
            version: { increment: 1 },
            updatedBy,
          },
        });
        if (!result || result.count !== 1) {
          throw new OrganizationStateVersionConflictError(orgId, options.expectedVersion);
        }
      } else {
        await (tx as any).organizationState.upsert({
          where: { organizationId: orgId },
          update: {
            data: jsonForPrisma(db.orgData[orgId]),
            version: { increment: 1 },
            updatedBy,
          },
          create: {
            organizationId: orgId,
            data: jsonForPrisma(db.orgData[orgId]),
            version: 1,
            updatedBy,
          },
        });
      }
      await syncVesselLotProjection(tx, orgId, db.orgData[orgId]);
    });

    lastPostgresSaveAt = new Date().toISOString();
    lastPostgresSaveError = null;
    lastPostgresSyncAt = lastPostgresSaveAt;
    lastPostgresSyncError = null;
    if ((prisma as any).organizationState?.findUnique) {
      await getOrganizationStateMeta(orgId);
    }
    saveDB({ syncPostgres: false, gcsBackup: true });
  } catch (dbErr) {
    lastPostgresSaveError = dbErr instanceof Error ? dbErr.message : String(dbErr);
    lastPostgresSyncError = lastPostgresSaveError;
    if (dbErr instanceof OrganizationStateVersionConflictError) {
      throw dbErr;
    }
    console.warn('[db] PostgreSQL organization JSONB save failed; local memory remains current and GCS/local fallback may be used:', dbErr);
  }
}


// Backwards-compatible UserData bridges mapped to their active organization
export async function getUserData(username: string): Promise<UserDataState | null> {
  const db = getDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return null;

  let orgId = user.activeOrganizationId;
  if (!orgId) {
    const membership = db.memberships.find(m => m.userId === user.username || m.userId === (user as any).id);
    if (membership) {
      orgId = membership.organizationId;
      user.activeOrganizationId = orgId;
      saveDB();
    }
  }

  if (!orgId) {
    // Fallback: Create a default organization if they have none
    const orgName = `${user.fullName}'s Estate`;
    const newOrg = { id: `org_${Math.random().toString(36).substr(2, 9)}`, name: orgName };
    const newMembership = {
      id: `mem_${Math.random().toString(36).substr(2, 9)}`,
      userId: user.username,
      organizationId: newOrg.id,
      role: 'Owner/Admin'
    };
    db.organizations.push(newOrg);
    db.memberships.push(newMembership);
    db.orgData[newOrg.id] = createEmptyUserData();
    user.activeOrganizationId = newOrg.id;
    saveDB();
    orgId = newOrg.id;
  }

  return getOrganizationData(orgId);
}

export async function saveUserData(
  username: string,
  data: UserDataState,
  options: { expectedVersion?: number | null; updatedBy?: string } = {}
): Promise<void> {
  const db = getDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return;

  let orgId = user.activeOrganizationId;
  if (!orgId) {
    const membership = db.memberships.find(m => m.userId === user.username || m.userId === (user as any).id);
    if (membership) orgId = membership.organizationId;
  }

  if (orgId) {
    await saveOrganizationData(orgId, data, options);
  }
}

export async function resetUserData(username: string): Promise<UserDataState> {
  const empty = createEmptyUserData();
  await saveUserData(username, empty);
  return empty;
}
