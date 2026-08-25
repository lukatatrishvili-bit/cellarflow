/**
 * The workspace destination as a URL, so a place in the app can be linked to.
 *
 * The app already understands a few entry points — `?lot=`, `?tank=`,
 * `?tank=&op=1` from a cellar QR label, `?task=` from a notification — but once
 * a worker is inside, the destination lived only in React state and
 * `localStorage`. The address bar never changed again, so a winemaker looking at
 * a fermentation chart could not send a colleague a link to it, Back did
 * nothing, and browser tests had to click their way to every screen instead of
 * navigating to one.
 *
 * Query parameters rather than path segments, deliberately: `normalizeAppPath`
 * in `lib/authRouting.ts` routes on the pathname alone, and
 * `authRedirectTarget` carries the query suffix across the post-login redirect
 * unchanged. Putting the destination in the query means it survives sign-in and
 * cannot collide with an auth or marketing route.
 */

export const MODULE_PARAM = 'module';
export const TAB_PARAM = 'tab';

/** Mirrors the `activeModule` union in `hooks/useWineryState.ts`. */
export const WORKSPACE_MODULES = [
  'portal',
  'work',
  'vazi',
  'gvino',
  'integrations',
  'settings',
  'audit',
  'docs',
  'certification',
  'costs',
  'storage',
  'sales',
  'recall',
  'procurement',
  'analytics',
  'master-admin',
] as const;

export type WorkspaceModule = (typeof WORKSPACE_MODULES)[number];

/**
 * Tabs are not enumerated here. There are dozens, they are added with features,
 * and a list in a second place would drift into a bug that silently drops a
 * destination. An unknown tab is no more dangerous than the unknown value
 * `localStorage` could already hold — the workspace falls back to its default —
 * so the check is only that the value is a plausible identifier.
 */
const TAB_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

export interface WorkspaceRoute {
  module: WorkspaceModule | null;
  tab: string | null;
}

export function isWorkspaceModule(value: unknown): value is WorkspaceModule {
  return typeof value === 'string' && (WORKSPACE_MODULES as readonly string[]).includes(value);
}

/** Read a destination out of a `location.search` string. */
export function parseWorkspaceRoute(search: string): WorkspaceRoute {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    return { module: null, tab: null };
  }

  const module = params.get(MODULE_PARAM);
  const tab = params.get(TAB_PARAM);

  return {
    module: isWorkspaceModule(module) ? module : null,
    tab: typeof tab === 'string' && TAB_PATTERN.test(tab) ? tab : null,
  };
}

/**
 * Write a destination into a search string, preserving every other parameter.
 *
 * Deep-link parameters are deliberately kept rather than cleared once consumed:
 * dropping `?lot=` on the first navigation would mean copying the address bar no
 * longer reproduces the passport that is on screen, which defeats the point.
 */
export function applyWorkspaceRoute(search: string, module: string, tab: string): string {
  const params = new URLSearchParams(search || '');

  if (isWorkspaceModule(module)) params.set(MODULE_PARAM, module);
  else params.delete(MODULE_PARAM);

  if (tab && TAB_PATTERN.test(tab)) params.set(TAB_PARAM, tab);
  else params.delete(TAB_PARAM);

  const query = params.toString();
  return query ? `?${query}` : '';
}

export const LOT_PARAM = 'lot';
export const TANK_PARAM = 'tank';
/** Marks a cellar QR label that opens the quick-operation form for a vessel. */
export const OPERATION_PARAM = 'op';

/**
 * Record ids as the server defines them in `isValidId` (`server/sync.ts`).
 *
 * Unicode-aware on purpose, and the reason is not cosmetic: vessel and lot ids
 * here are frequently Georgian — "ქვევრი 1" is a real qvevri id — so an
 * ASCII-only pattern would silently refuse to put half this product's records
 * in a URL.
 */
const RECORD_ID_PATTERN = /^[\p{L}\p{N}_\- ]{1,128}$/u;

export interface RecordRoute {
  lot: string | null;
  tank: string | null;
}

const readRecordId = (value: string | null): string | null =>
  typeof value === 'string' && RECORD_ID_PATTERN.test(value) ? value : null;

/** Read the record a URL points at, if any. */
export function parseRecordRoute(search: string): RecordRoute {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    return { lot: null, tank: null };
  }
  return {
    lot: readRecordId(params.get(LOT_PARAM)),
    tank: readRecordId(params.get(TANK_PARAM)),
  };
}

/**
 * Whether the URL is a one-shot instruction rather than a view to mirror.
 *
 * `?tank=…&op=1` comes from a QR label stuck to a tank: it means "open the
 * quick-operation form for this vessel", and it deliberately does not select
 * the vessel. Mirroring view state over it would delete the `tank` parameter
 * the moment the page loaded and break the label.
 */
export function routeCarriesOneShotAction(search: string): boolean {
  try {
    return new URLSearchParams(search || '').get(OPERATION_PARAM) === '1';
  } catch {
    return false;
  }
}

/** Write the open record into the URL, clearing it when nothing is open. */
export function applyRecordRoute(search: string, record: RecordRoute): string {
  const params = new URLSearchParams(search || '');

  const lot = readRecordId(record.lot);
  if (lot) params.set(LOT_PARAM, lot);
  else params.delete(LOT_PARAM);

  const tank = readRecordId(record.tank);
  if (tank) params.set(TANK_PARAM, tank);
  else params.delete(TANK_PARAM);

  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Whether the URL already names this record selection. */
export function recordRouteMatches(search: string, record: RecordRoute): boolean {
  const current = parseRecordRoute(search);
  return current.lot === readRecordId(record.lot)
    && current.tank === readRecordId(record.tank);
}

/** Remove only the generic workspace destination while preserving deep links. */
export function clearWorkspaceRoute(search: string): string {
  const params = new URLSearchParams(search || '');
  params.delete(MODULE_PARAM);
  params.delete(TAB_PARAM);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Whether a search string already names this destination. */
export function workspaceRouteMatches(search: string, module: string, tab: string): boolean {
  const current = parseWorkspaceRoute(search);
  return current.module === (isWorkspaceModule(module) ? module : null)
    && current.tab === (tab && TAB_PATTERN.test(tab) ? tab : null);
}
