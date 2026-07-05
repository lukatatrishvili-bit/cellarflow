import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { downloadDb, uploadDb, gcsEnabled, gcsTarget } from './gcsStore';


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
const GCS_BACKUP_MIN_INTERVAL_MS = 90_000;
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
    let migratedJsonToPostgres = false;
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
      migratedJsonToPostgres = true;
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
    console.warn('[db] PostgreSQL initialization failed. Falling back to GCS or local file:', err);
    postgresDisabledAfterFailure = true;
    await prisma.$disconnect().catch(() => undefined);
    prismaInstance = null;
    await loadLocalOrGcsDB();
    dbData = normalizeDbState(dbData);
    cleanupDemoData();
    saveDB();
  }
}

function cleanupDemoData(): void {
  if (!dbData) return;
  console.log('[db] performing demo data cleanup...');
  dbData.users = (dbData.users || []).filter((u: any) => u.username !== 'demo');
  dbData.memberships = (dbData.memberships || []).filter((m: any) => m.userId !== 'demo');
  if (dbData.organizations) {
    dbData.organizations = dbData.organizations.filter((o: any) => o.id !== 'org_demo_georgian');
  }
  if (dbData.orgData) {
    delete dbData.orgData['org_demo_georgian'];
  }
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
      console.error('[db] failed to parse local database file:', e);
    }
  }

  // 3. Fallback to empty
  console.log('[db] no database found on GCS or local disk. Initializing empty database.');
  dbData = {
    users: [],
    organizations: [],
    memberships: [],
    invitations: [],
    orgData: {}
  };
}

export interface UserDataState {
  vessels: any[];
  lots: any[];
  fermlogs: any[];
  lablogs: any[];
  inventory: any[];
  tasks: any[];
  notes: any[];
  blocks: any[];
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
  companyProfile: any;
}

export interface DBState {
  users: any[];
  organizations: any[];
  memberships: any[];
  invitations: any[];
  orgData: Record<string, UserDataState>;
}

export function createEmptyUserData(): UserDataState {
  return {
    vessels: [],
    lots: [],
    fermlogs: [],
    lablogs: [],
    inventory: [],
    tasks: [],
    notes: [],
    blocks: [],
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
    companyProfile: {
      companyName: '',
      wineryName: '',
      country: '',
      region: '',
      municipality: '',
      address: '',
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
    vessels: Array.isArray(data.vessels) ? data.vessels : [],
    lots: Array.isArray(data.lots) ? data.lots : [],
    fermlogs: Array.isArray(data.fermlogs) ? data.fermlogs : [],
    lablogs: Array.isArray(data.lablogs) ? data.lablogs : [],
    inventory: Array.isArray(data.inventory) ? data.inventory : [],
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    notes: Array.isArray(data.notes) ? data.notes : [],
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
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
    companyProfile: data.companyProfile && typeof data.companyProfile === 'object'
      ? { ...empty.companyProfile, ...data.companyProfile }
      : empty.companyProfile,
  };
}

function normalizeDbState(data: Partial<DBState> & { userData?: Record<string, Partial<UserDataState>> } | null | undefined): DBState {
  const normalized: DBState = {
    users: Array.isArray(data?.users) ? data.users : [],
    organizations: Array.isArray(data?.organizations) ? data.organizations : [],
    memberships: Array.isArray(data?.memberships) ? data.memberships : [],
    invitations: Array.isArray(data?.invitations) ? data.invitations : [],
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
    orgData: data.orgData || {},
  };
  return JSON.stringify(plain, null, 2);
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

function dbFromPostgresRows(rows: {
  users: any[];
  organizations: any[];
  memberships: any[];
  invitations: any[];
  organizationStates: any[];
}): DBState {
  const db: DBState = {
    users: rows.users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      language: u.language,
      passwordHash: u.passwordHash,
      emailVerified: u.emailVerified,
      verifyTokenHash: u.verifyTokenHash,
      verifyTokenExpires: u.verifyTokenExpires ? Number(u.verifyTokenExpires) : null,
      isDemo: u.isDemo,
      activeOrganizationId: u.activeOrganizationId,
      enabledModules: stringArray(u.enabledModules, DEFAULT_USER_MODULES),
      enabledWidgets: stringArray(u.enabledWidgets, DEFAULT_USER_WIDGETS),
      registrationComplete: u.registrationComplete ?? true,
      createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : undefined,
      updatedAt: u.updatedAt ? new Date(u.updatedAt).toISOString() : undefined,
    })),
    organizations: rows.organizations.map(o => ({
      id: o.id,
      name: o.name,
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
      token: i.token,
      expiresAt: i.expiresAt.toISOString(),
      acceptedAt: i.acceptedAt ? i.acceptedAt.toISOString() : null,
      createdAt: i.createdAt ? new Date(i.createdAt).toISOString() : undefined,
    })),
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

export function saveDB(options: { syncPostgres?: boolean } = {}): void {
  if (!dbData) return;
  const jsonStr = serializeDbState(dbData);

  writeLocalJsonBackup(jsonStr);

  if (options.syncPostgres === false) {
    if (!isPostgresConfigured() || postgresDisabledAfterFailure) backupJsonToGcs(jsonStr);
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
  const prisma = await getPrisma();
  if (!prisma || !dbData) return;
  try {
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
          update: { name: org.name || org.id },
          create: { id: org.id, name: org.name || org.id },
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
            passwordHash: user.passwordHash || '',
            emailVerified: user.emailVerified ?? false,
            verifyTokenHash: user.verifyTokenHash || null,
            verifyTokenExpires: user.verifyTokenExpires ? BigInt(user.verifyTokenExpires) : null,
            isDemo: user.isDemo ?? false,
            activeOrganizationId: user.activeOrganizationId || null,
            enabledModules: jsonForPrisma(stringArray(user.enabledModules, DEFAULT_USER_MODULES)),
            enabledWidgets: jsonForPrisma(stringArray(user.enabledWidgets, DEFAULT_USER_WIDGETS)),
            registrationComplete: user.registrationComplete ?? true,
          },
          create: {
            id: user.id || undefined,
            username: user.username,
            email: user.email || `${user.username}@local.invalid`,
            fullName: user.fullName || user.username,
            role: user.role || 'Owner/Admin',
            language: user.language || 'en',
            passwordHash: user.passwordHash || '',
            emailVerified: user.emailVerified ?? false,
            verifyTokenHash: user.verifyTokenHash || null,
            verifyTokenExpires: user.verifyTokenExpires ? BigInt(user.verifyTokenExpires) : null,
            isDemo: user.isDemo ?? false,
            activeOrganizationId: user.activeOrganizationId || null,
            enabledModules: jsonForPrisma(stringArray(user.enabledModules, DEFAULT_USER_MODULES)),
            enabledWidgets: jsonForPrisma(stringArray(user.enabledWidgets, DEFAULT_USER_WIDGETS)),
            registrationComplete: user.registrationComplete ?? true,
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
            token: invite.token || invite.id,
            expiresAt,
            acceptedAt: invite.acceptedAt ? new Date(invite.acceptedAt) : null,
          },
          create: {
            id: invite.id,
            email: invite.email,
            organizationId: invite.organizationId,
            role: invite.role || 'Read-Only',
            token: invite.token || invite.id,
            expiresAt,
            acceptedAt: invite.acceptedAt ? new Date(invite.acceptedAt) : null,
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
  };
  errors: string[];
}

async function probePrismaModelRead(model: any, label: string, errors: string[]): Promise<boolean> {
  if (!model) {
    errors.push(`${label} Prisma model is not available in the generated client.`);
    return false;
  }

  try {
    if (typeof model.count === 'function') {
      await model.count();
      return true;
    }
    if (typeof model.findMany === 'function') {
      await model.findMany({ take: 1 });
      return true;
    }
    errors.push(`${label} Prisma model has no readable count/findMany method.`);
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
            passwordHash: user.passwordHash || '',
            emailVerified: user.emailVerified ?? false,
            verifyTokenHash: user.verifyTokenHash || null,
            verifyTokenExpires: user.verifyTokenExpires ? BigInt(user.verifyTokenExpires) : null,
            isDemo: user.isDemo ?? false,
            activeOrganizationId: user.activeOrganizationId || null,
            enabledModules: jsonForPrisma(stringArray(user.enabledModules, DEFAULT_USER_MODULES)),
            enabledWidgets: jsonForPrisma(stringArray(user.enabledWidgets, DEFAULT_USER_WIDGETS)),
            registrationComplete: user.registrationComplete ?? true,
          },
          create: {
            username: user.username,
            email: user.email || `${user.username}@local.invalid`,
            fullName: user.fullName || user.username,
            role: user.role || 'Owner/Admin',
            language: user.language || 'en',
            passwordHash: user.passwordHash || '',
            emailVerified: user.emailVerified ?? false,
            verifyTokenHash: user.verifyTokenHash || null,
            verifyTokenExpires: user.verifyTokenExpires ? BigInt(user.verifyTokenExpires) : null,
            isDemo: user.isDemo ?? false,
            activeOrganizationId: user.activeOrganizationId || null,
            enabledModules: jsonForPrisma(stringArray(user.enabledModules, DEFAULT_USER_MODULES)),
            enabledWidgets: jsonForPrisma(stringArray(user.enabledWidgets, DEFAULT_USER_WIDGETS)),
            registrationComplete: user.registrationComplete ?? true,
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
            token: invite.token || invite.id,
            expiresAt,
            acceptedAt: invite.acceptedAt ? new Date(invite.acceptedAt) : null,
          },
          create: {
            id: invite.id,
            email: invite.email,
            organizationId: invite.organizationId,
            role: invite.role || 'Read-Only',
            token: invite.token || invite.id,
            expiresAt,
            acceptedAt: invite.acceptedAt ? new Date(invite.acceptedAt) : null,
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
    saveDB({ syncPostgres: false });
    backupJsonToGcs(serializeDbState(db));
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
    });

    // Background double-writing of vessels and lots (safe, non-blocking)
    void (async () => {
      try {
        const normalizedData = db.orgData[orgId];
        // 1. Double-write vessels
        for (const vessel of normalizedData.vessels || []) {
          if (!vessel.id) continue;
          await prisma.vessel.upsert({
            where: { id: vessel.id },
            update: {
              type: vessel.type || '',
              shape: vessel.shape || '',
              capacity: Number(vessel.capacity) || 0,
              currentVolume: Number(vessel.currentVolume) || 0,
              assignedLotId: vessel.assignedLotId || null,
              cleaningStatus: vessel.cleaningStatus || 'clean',
              lastCleaned: vessel.lastCleaned || '',
              temperature: Number(vessel.temperature) || 0,
              coolingJacketActive: Boolean(vessel.coolingJacketActive),
              targetTemperature: vessel.targetTemperature !== undefined && vessel.targetTemperature !== null ? Number(vessel.targetTemperature) : null,
              lastOperation: vessel.lastOperation || '',
              locationDetails: vessel.locationDetails || null,
              xGrid: vessel.xGrid !== undefined && vessel.xGrid !== null ? Number(vessel.xGrid) : null,
              yGrid: vessel.yGrid !== undefined && vessel.yGrid !== null ? Number(vessel.yGrid) : null,
              lastSealedDate: vessel.lastSealedDate || null,
              soilTemperature: vessel.soilTemperature !== undefined && vessel.soilTemperature !== null ? Number(vessel.soilTemperature) : null,
            },
            create: {
              id: vessel.id,
              organizationId: orgId,
              type: vessel.type || '',
              shape: vessel.shape || '',
              capacity: Number(vessel.capacity) || 0,
              currentVolume: Number(vessel.currentVolume) || 0,
              assignedLotId: vessel.assignedLotId || null,
              cleaningStatus: vessel.cleaningStatus || 'clean',
              lastCleaned: vessel.lastCleaned || '',
              temperature: Number(vessel.temperature) || 0,
              coolingJacketActive: Boolean(vessel.coolingJacketActive),
              targetTemperature: vessel.targetTemperature !== undefined && vessel.targetTemperature !== null ? Number(vessel.targetTemperature) : null,
              lastOperation: vessel.lastOperation || '',
              locationDetails: vessel.locationDetails || null,
              xGrid: vessel.xGrid !== undefined && vessel.xGrid !== null ? Number(vessel.xGrid) : null,
              yGrid: vessel.yGrid !== undefined && vessel.yGrid !== null ? Number(vessel.yGrid) : null,
              lastSealedDate: vessel.lastSealedDate || null,
              soilTemperature: vessel.soilTemperature !== undefined && vessel.soilTemperature !== null ? Number(vessel.soilTemperature) : null,
            }
          });
        }
        
        // 2. Double-write lots
        for (const lot of normalizedData.lots || []) {
          if (!lot.id) continue;
          await prisma.wineLot.upsert({
            where: { id: lot.id },
            update: {
              name: lot.name || '',
              vintage: Number(lot.vintage) || 0,
              variety: lot.variety || '',
              vineyardBlock: lot.vineyardBlock || '',
              region: lot.region || '',
              initialVolume: Number(lot.initialVolume) || 0,
              currentVolume: Number(lot.currentVolume) || 0,
              wineClass: lot.wineClass || '',
              stage: lot.stage || '',
              createdAt: lot.createdAt || new Date().toISOString(),
              history: lot.history || [],
              sensoryProfile: lot.sensoryProfile || null,
            },
            create: {
              id: lot.id,
              organizationId: orgId,
              name: lot.name || '',
              vintage: Number(lot.vintage) || 0,
              variety: lot.variety || '',
              vineyardBlock: lot.vineyardBlock || '',
              region: lot.region || '',
              initialVolume: Number(lot.initialVolume) || 0,
              currentVolume: Number(lot.currentVolume) || 0,
              wineClass: lot.wineClass || '',
              stage: lot.stage || '',
              createdAt: lot.createdAt || new Date().toISOString(),
              history: lot.history || [],
              sensoryProfile: lot.sensoryProfile || null,
            }
          });
        }
      } catch (relationalErr) {
        console.error('[db] background relational double-write failed:', relationalErr);
      }
    })();

    lastPostgresSaveAt = new Date().toISOString();
    lastPostgresSaveError = null;
    lastPostgresSyncAt = lastPostgresSaveAt;
    lastPostgresSyncError = null;
    if ((prisma as any).organizationState?.findUnique) {
      await getOrganizationStateMeta(orgId);
    }
    saveDB({ syncPostgres: false });
    backupJsonToGcs(serializeDbState(db));
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
