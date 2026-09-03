import { useEffect, useRef } from 'react';
import {
  applyRecordRoute,
  applyWorkspaceRoute,
  clearWorkspaceRoute,
  parseRecordRoute,
  parseWorkspaceRoute,
  moduleUsesTabs,
  recordRouteMatches,
  routeCarriesOneShotAction,
  workspaceRouteMatches,
} from '../lib/workspaceRoute';

interface WorkspaceRouteOptions {
  /** Only mirror a destination while a signed-in workspace is on screen. */
  isActive: boolean;
  activeModule: string;
  activeTab: string;
  setActiveModule: (module: any) => void;
  setActiveTab: (tab: string) => void;
  /** Lot whose passport is open, if any. */
  passportLotId: string | null;
  setPassportLotId: (lotId: string | null) => void;
  /** Vessel selected on the vessels tab, if any. */
  selectedTankId: string | null;
  setSelectedTankId: (tankId: string | null) => void;
}

/**
 * Generic module/tab parameters belong only to the workspace shell route.
 * Dedicated routes such as `/tasks?task=...` and public/auth routes already
 * carry their own canonical meaning and must never be decorated as React state
 * changes during sign-in or sign-out.
 */
export function workspaceRouteCanMirrorPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === '/dashboard';
}

/**
 * Keep the workspace destination and the address bar in step.
 *
 * Three directions, and the loop between them closes because each side only
 * acts when the two actually disagree:
 *
 *   - on activation, a destination named in the URL wins over the last one in
 *     `localStorage`, so opening a shared link lands where the link points
 *     rather than where this browser happened to be;
 *   - moving around the app writes the destination back, pushing a history
 *     entry so Back returns to the previous screen instead of leaving the app;
 *   - Back and Forward apply whatever the URL now names.
 *
 * The first write after activation replaces rather than pushes. Pushing there
 * would put an entry for the restored destination underneath the one the user
 * arrived at, so their first Back would appear to do nothing.
 */
export function useWorkspaceRoute({
  isActive,
  activeModule,
  activeTab,
  setActiveModule,
  setActiveTab,
  passportLotId,
  setPassportLotId,
  selectedTankId,
  setSelectedTankId,
}: WorkspaceRouteOptions): void {
  const hasSyncedInitialRoute = useRef(false);
  /**
   * Set while a destination read out of the URL is still on its way into React
   * state. Both effects run in the same commit, so without this the mirror
   * below would run with the pre-adoption state and write the *old* destination
   * over the link the user just opened — losing it before the adopt effect's
   * update ever landed.
   */
  const pendingUrlAdoption = useRef(false);

  // Adopt a destination named in the URL, and follow Back/Forward.
  useEffect(() => {
    if (typeof window === 'undefined' || !isActive || !workspaceRouteCanMirrorPath(window.location.pathname)) return;

    const applyFromUrl = () => {
      const route = parseWorkspaceRoute(window.location.search);
      if (route.module) setActiveModule(route.module);
      if (route.tab) setActiveTab(route.tab);
      pendingUrlAdoption.current = Boolean(route.module || route.tab);
    };

    applyFromUrl();
    window.addEventListener('popstate', applyFromUrl);
    return () => window.removeEventListener('popstate', applyFromUrl);
  }, [isActive, setActiveModule, setActiveTab]);

  // Mirror the destination back into the URL.
  useEffect(() => {
    if (typeof window === 'undefined' || !isActive || !workspaceRouteCanMirrorPath(window.location.pathname)) return;
    const isDefaultDestination = activeModule === 'portal' && activeTab === 'dashboard';
    const parsed = parseWorkspaceRoute(window.location.search);
    // Only the cellar's destination includes a tab. Everywhere else the shared
    // activeTab is leftover cellar state and must not reach the address bar.
    const routeTab = moduleUsesTabs(activeModule) ? activeTab : '';

    // A destination named in the URL wins. Stay silent until state has caught
    // up with it, then fall through so the address is normalised to exactly
    // what is open.
    if (pendingUrlAdoption.current) {
      const adopted = (!parsed.module || parsed.module === activeModule)
        && (!parsed.tab || parsed.tab === activeTab);
      if (!adopted) return;
      pendingUrlAdoption.current = false;
      // hasSyncedInitialRoute stays false so this first write replaces rather
      // than pushes: arriving on a link is not a step in the user's history.
    }

    if (
      workspaceRouteMatches(window.location.search, activeModule, routeTab)
      || (isDefaultDestination && !parsed.module && !parsed.tab)
    ) {
      hasSyncedInitialRoute.current = true;
      return;
    }

    const search = isDefaultDestination
      ? clearWorkspaceRoute(window.location.search)
      : applyWorkspaceRoute(window.location.search, activeModule, routeTab);
    const target = `${window.location.pathname}${search}${window.location.hash}`;

    if (hasSyncedInitialRoute.current) {
      window.history.pushState(window.history.state, '', target);
    } else {
      window.history.replaceState(window.history.state, '', target);
      hasSyncedInitialRoute.current = true;
    }
  }, [isActive, activeModule, activeTab]);

  // Follow Back/Forward for the open record, so returning to an entry that
  // named a lot reopens its passport rather than leaving the URL lying.
  useEffect(() => {
    if (typeof window === 'undefined' || !isActive) return;
    if (!workspaceRouteCanMirrorPath(window.location.pathname)) return;

    const applyRecordFromUrl = () => {
      if (routeCarriesOneShotAction(window.location.search)) return;
      const record = parseRecordRoute(window.location.search);
      setPassportLotId(record.lot);
      setSelectedTankId(record.tank);
    };

    window.addEventListener('popstate', applyRecordFromUrl);
    return () => window.removeEventListener('popstate', applyRecordFromUrl);
  }, [isActive, setPassportLotId, setSelectedTankId]);

  /**
   * Mirror the open record into the URL, so the address bar of an open passport
   * can be copied to a colleague.
   *
   * `replaceState`, unlike the destination above. Opening a record is closer to
   * focusing something on the current screen than to travelling to a new one:
   * pushing would make Back close a passport while the on-screen close button
   * does something different, and would leave a history entry behind every lot
   * a user merely glanced at. The URL stays copyable either way, which is the
   * point.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !isActive) return;
    if (!workspaceRouteCanMirrorPath(window.location.pathname)) return;
    // A QR action link is an instruction, not a view; leave it exactly as sent.
    if (routeCarriesOneShotAction(window.location.search)) return;

    const record = { lot: passportLotId, tank: selectedTankId };
    if (recordRouteMatches(window.location.search, record)) return;

    const search = applyRecordRoute(window.location.search, record);
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search}${window.location.hash}`,
    );
  }, [isActive, passportLotId, selectedTankId]);

  // A sign-out returns the app to a clean slate; the next sign-in should not
  // inherit the previous session's first-write behaviour.
  useEffect(() => {
    if (!isActive) hasSyncedInitialRoute.current = false;
  }, [isActive]);
}
