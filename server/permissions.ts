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

export type PermissionModule =
  | 'company_profile'
  | 'lots'
  | 'grape_intake'
  | 'vessels'
  | 'operations'
  | 'transfers'
  | 'fermentation'
  | 'lab'
  | 'bottling'
  | 'official_docs'
  | 'certification'
  | 'vineyard'
  | 'vineyard_projects'
  | 'inventory'
  | 'costs'
  | 'storage'
  | 'sales'
  | 'reports'
  | 'tasks'
  | 'notes'
  | 'audit';

export type PermissionAction = 'view' | 'create' | 'update' | 'delete' | 'export';

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  'Owner/Admin':    ['read', 'write', 'admin', 'manage_users'],
  'Winemaker':      ['read', 'write'],
  'Viticulturist':  ['read', 'write'],
  'Lab Technician': ['read', 'write'],
  'Cellar Worker':  ['read', 'write'],
  'Read-Only':      ['read'],
};

const allActions: PermissionAction[] = ['view', 'create', 'update', 'delete', 'export'];
const readExport: PermissionAction[] = ['view', 'export'];
const readWrite: PermissionAction[] = ['view', 'create', 'update'];
const readWriteDelete: PermissionAction[] = ['view', 'create', 'update', 'delete'];

const ALL_MODULES: PermissionModule[] = [
  'company_profile', 'lots', 'grape_intake', 'vessels', 'operations', 'transfers', 'fermentation', 'lab', 'bottling',
  'official_docs', 'certification', 'vineyard', 'vineyard_projects', 'inventory', 'costs',
  'storage', 'sales', 'reports', 'tasks', 'notes', 'audit',
];

const ownerPermissions: Record<PermissionModule, PermissionAction[]> =
  Object.fromEntries(ALL_MODULES.map(module => [module, allActions])) as Record<PermissionModule, PermissionAction[]>;

const ROLE_MODULE_PERMISSIONS: Record<Role, Partial<Record<PermissionModule, PermissionAction[]>>> = {
  'Owner/Admin': ownerPermissions,
  'Winemaker': {
    lots: readWrite,
    grape_intake: readWrite,
    vessels: readWrite,
    operations: readWriteDelete,
    transfers: readWriteDelete,
    fermentation: readWrite,
    lab: ['view'],
    bottling: readWrite,
    official_docs: readExport,
    certification: readWrite,
    inventory: readWrite,
    tasks: readWriteDelete,
    notes: readWriteDelete,
    audit: ['view', 'create'],
  },
  'Lab Technician': {
    lots: ['view'],
    lab: readWriteDelete,
    certification: readWrite,
    official_docs: ['view'],
    tasks: readWrite,
    notes: readWrite,
    audit: ['view', 'create'],
  },
  'Cellar Worker': {
    lots: ['view'],
    vessels: ['view', 'update'],
    operations: readWrite,
    transfers: readWrite,
    fermentation: readWrite,
    inventory: ['view'],
    tasks: readWrite,
    notes: readWrite,
    audit: ['view', 'create'],
  },
  'Viticulturist': {
    vineyard: readWriteDelete,
    vineyard_projects: readWrite,
    grape_intake: readWrite,
    tasks: readWriteDelete,
    notes: readWriteDelete,
    official_docs: ['view'],
    lots: ['view'],
    certification: ['view'],
    audit: ['view', 'create'],
  },
  'Read-Only': Object.fromEntries(ALL_MODULES.map(module => [module, readExport])) as Record<PermissionModule, PermissionAction[]>,
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

export function canAccess(role: unknown, module: PermissionModule, action: PermissionAction): boolean {
  if (!isKnownRole(role)) return action === 'view' || action === 'export';
  const moduleActions = ROLE_MODULE_PERMISSIONS[role][module] || [];
  return moduleActions.includes(action);
}

export function permissionsForRole(role: unknown): Partial<Record<PermissionModule, PermissionAction[]>> {
  if (!isKnownRole(role)) {
    return ROLE_MODULE_PERMISSIONS['Read-Only'];
  }
  return ROLE_MODULE_PERMISSIONS[role];
}

const SYNC_COLLECTION_MODULES: Record<string, PermissionModule> = {
  companyProfile: 'company_profile',
  vessels: 'vessels',
  lots: 'lots',
  grapeIntakes: 'grape_intake',
  fermlogs: 'fermentation',
  lablogs: 'lab',
  inventory: 'inventory',
  tasks: 'tasks',
  notes: 'notes',
  blocks: 'vineyard',
  vineyardProjects: 'vineyard_projects',
  phenologyLogs: 'vineyard',
  sprays: 'vineyard',
  scoutings: 'vineyard',
  soilRecords: 'vineyard',
  samplings: 'vineyard',
  harvests: 'vineyard',
  irrigationLogs: 'vineyard',
  fertilizerLogs: 'vineyard',
  auditLogs: 'audit',
  bottlingRuns: 'bottling',
  transfers: 'transfers',
  cellarOps: 'operations',
  costEntries: 'costs',
  winePricing: 'sales',
  storageLocations: 'storage',
  stockMovements: 'storage',
  salesDispatches: 'sales',
  salesOrders: 'sales',
  supplierPayments: 'costs',
  certificationRecords: 'certification',
  attachments: 'certification',
  crmLeads: 'sales',
  aiDrafts: 'tasks',
};

export function moduleForSyncCollection(collection: string): PermissionModule | null {
  return SYNC_COLLECTION_MODULES[collection] || null;
}

export function moduleForAttachmentKind(kind: unknown): PermissionModule | null {
  switch (kind) {
    case 'company': return 'company_profile';
    case 'official_docs': return 'official_docs';
    case 'certification': return 'certification';
    case 'cadastre': return 'vineyard';
    case 'qvevri': return 'vessels';
    case 'lab': return 'lab';
    case 'vineyard_project': return 'vineyard_projects';
    case 'crm': return 'sales';
    case 'other': return 'official_docs';
    default: return null;
  }
}

export function canSyncCollection(
  role: unknown,
  collection: string,
  action: PermissionAction,
): boolean {
  const module = moduleForSyncCollection(collection);
  if (!module) return false;
  if (collection === 'auditLogs' && action === 'create') {
    return can(role, 'write');
  }
  return canAccess(role, module, action);
}
