import {
  getDB,
  getUserData,
  reloadUserOrganizationDataFromPostgres,
  type UserDataState,
} from './db';
import { canAccess, type PermissionModule } from './permissions';
import type {
  AiWithheldArea,
  UserRole,
  WineryIntelligenceSnapshot,
  WineryIntelligenceSnapshotInput,
} from '../lib/ai';
import type { Language } from '../lib/i18n';

/**
 * The read path every AI surface shares. Both the monitoring routes and the
 * interactive copilot resolve their winery here, so the field-level role
 * boundary is written once and cannot drift apart between them.
 */

export interface Workspace {
  username: string;
  orgId: string;
  role: UserRole;
  data: UserDataState;
}

/**
 * Resolves the caller's active winery. The role comes from the authenticated
 * session, never from the request body — every downstream filter depends on it.
 */
export async function loadWorkspace(
  auth: { username: string; role: string },
): Promise<Workspace | null> {
  // Refresh on every AI request: model calls are long enough that relying on an
  // instance-local cache can otherwise analyze an older winery snapshot.
  const refreshed = await reloadUserOrganizationDataFromPostgres(auth.username);
  const data = refreshed?.data || await getUserData(auth.username);
  if (!data) return null;
  const orgId = getDB().users.find((u: any) => u.username === auth.username)?.activeOrganizationId;
  if (!orgId) return null;
  return { username: auth.username, orgId, role: auth.role as UserRole, data };
}

export function snapshotFor(
  workspace: Workspace,
  lang: Language,
): WineryIntelligenceSnapshotInput {
  const data = workspace.data as unknown as Record<string, any>;
  const evaluatedAt = new Date().toISOString();
  return {
    today: evaluatedAt.slice(0, 10),
    evaluatedAt,
    lang,
    config: data.companyProfile?.aiConfig,
    vessels: data.vessels,
    lots: data.lots,
    // Stored collection names are lower-case; the intelligence layer is camelCase.
    fermLogs: data.fermlogs,
    labLogs: data.lablogs,
    inventory: data.inventory,
    tasks: data.tasks,
    cellarOps: data.cellarOps,
    transfers: data.transfers,
    bottlingRuns: data.bottlingRuns,
    grapeIntakes: data.grapeIntakes,
    blocks: data.blocks,
    scoutings: data.scoutings,
    sprays: data.sprays,
    samplings: data.samplings,
    harvests: data.harvests,
    certifications: data.certificationRecords,
    salesOrders: data.salesOrders,
    companyProfile: data.companyProfile,
  };
}

export function roleCanView(role: UserRole, module: PermissionModule): boolean {
  return canAccess(role, module, 'view');
}

/**
 * Model context must obey the same field-level boundary as the caller. The
 * deterministic engine evaluates the winery as a whole, but a specialist's
 * model request receives only collections their role may view.
 */
export function snapshotVisibleToRole(
  snapshot: WineryIntelligenceSnapshot,
  role: UserRole,
): WineryIntelligenceSnapshot {
  const withheld = withheldAreasForRole(role);
  return {
    ...snapshot,
    // Carried into the context builder so an emptied collection is described as
    // unseen rather than as never recorded.
    ...(withheld.length > 0 ? { withheld } : {}),
    vessels: roleCanView(role, 'vessels') ? snapshot.vessels : [],
    lots: roleCanView(role, 'lots') ? snapshot.lots : [],
    fermLogs: roleCanView(role, 'fermentation') ? snapshot.fermLogs : [],
    labLogs: roleCanView(role, 'lab') ? snapshot.labLogs : [],
    inventory: roleCanView(role, 'inventory') ? snapshot.inventory : [],
    tasks: roleCanView(role, 'tasks') ? snapshot.tasks : [],
    cellarOps: roleCanView(role, 'operations') ? snapshot.cellarOps : [],
    transfers: roleCanView(role, 'transfers') ? snapshot.transfers : [],
    bottlingRuns: roleCanView(role, 'bottling') ? snapshot.bottlingRuns : [],
    grapeIntakes: roleCanView(role, 'grape_intake') ? snapshot.grapeIntakes : [],
    blocks: roleCanView(role, 'vineyard') ? snapshot.blocks : [],
    scoutings: roleCanView(role, 'vineyard') ? snapshot.scoutings : [],
    sprays: roleCanView(role, 'vineyard') ? snapshot.sprays : [],
    samplings: roleCanView(role, 'vineyard') ? snapshot.samplings : [],
    harvests: roleCanView(role, 'vineyard') ? snapshot.harvests : [],
    certifications: roleCanView(role, 'certification') ? snapshot.certifications : [],
    salesOrders: roleCanView(role, 'sales') ? snapshot.salesOrders : [],
    weatherByBlock: roleCanView(role, 'vineyard') ? snapshot.weatherByBlock : {},
    companyProfile: roleCanView(role, 'company_profile') ? snapshot.companyProfile : undefined,
  };
}

/**
 * The collections `snapshotVisibleToRole` empties, in the same order, each with
 * the label a model can say out loud and the context-builder area it belongs
 * to. Keep this beside that function: the two are checked against each other in
 * `tests/aiCopilot.test.ts`.
 */
const ROLE_SCOPED_DATA: ReadonlyArray<{
  module: PermissionModule;
  label: string;
  area?: AiWithheldArea;
}> = [
  { module: 'vessels', label: 'vessels', area: 'vessels' },
  { module: 'lots', label: 'wine lots', area: 'lots' },
  { module: 'fermentation', label: 'fermentation readings', area: 'fermentation' },
  { module: 'lab', label: 'laboratory analyses', area: 'laboratory' },
  { module: 'inventory', label: 'inventory and stock levels', area: 'inventory' },
  { module: 'tasks', label: 'tasks' },
  { module: 'operations', label: 'cellar operations', area: 'operations' },
  { module: 'transfers', label: 'transfers' },
  { module: 'bottling', label: 'bottling runs' },
  { module: 'grape_intake', label: 'grape intakes' },
  {
    module: 'vineyard',
    label: 'vineyard blocks, scouting, sprays, samplings, harvests and weather',
    area: 'vineyard',
  },
  { module: 'certification', label: 'certifications' },
  { module: 'sales', label: 'sales orders' },
  { module: 'company_profile', label: 'the company profile' },
];

/**
 * What a role-filtered snapshot is silent about.
 *
 * Without this the filtering is quietly dishonest: an emptied collection is
 * indistinguishable from one that was never populated, and the context builder
 * reports it as "no laboratory analysis has ever been recorded". Naming the
 * withheld areas lets the model say "outside your access" instead of asserting
 * a measurement was never taken.
 */
export function withheldDataForRole(role: UserRole): string[] {
  return ROLE_SCOPED_DATA
    .filter((entry) => !roleCanView(role, entry.module))
    .map((entry) => entry.label);
}

function withheldAreasForRole(role: UserRole): AiWithheldArea[] {
  return ROLE_SCOPED_DATA
    .filter((entry) => entry.area && !roleCanView(role, entry.module))
    .map((entry) => entry.area as AiWithheldArea);
}

export function normalizeLang(value: unknown): Language {
  return value === 'ka' ? 'ka' : 'en';
}
