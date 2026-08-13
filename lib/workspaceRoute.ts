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
