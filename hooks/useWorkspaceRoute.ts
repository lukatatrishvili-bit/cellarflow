import { useEffect, useRef } from 'react';
import {
  applyWorkspaceRoute,
  clearWorkspaceRoute,
  parseWorkspaceRoute,
  workspaceRouteMatches,
} from '../lib/workspaceRoute';

interface WorkspaceRouteOptions {
  /** Only mirror a destination while a signed-in workspace is on screen. */
  isActive: boolean;
  activeModule: string;
  activeTab: string;
  setActiveModule: (module: any) => void;
  setActiveTab: (tab: string) => void;
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
}: WorkspaceRouteOptions): void {
  const hasSyncedInitialRoute = useRef(false);

  // Adopt a destination named in the URL, and follow Back/Forward.
  useEffect(() => {
    if (typeof window === 'undefined' || !isActive || !workspaceRouteCanMirrorPath(window.location.pathname)) return;

    const applyFromUrl = () => {
      const route = parseWorkspaceRoute(window.location.search);
      if (route.module) setActiveModule(route.module);
      if (route.tab) setActiveTab(route.tab);
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
    if (
      workspaceRouteMatches(window.location.search, activeModule, activeTab)
      || (isDefaultDestination && !parsed.module && !parsed.tab)
    ) {
      hasSyncedInitialRoute.current = true;
      return;
    }

    const search = isDefaultDestination
      ? clearWorkspaceRoute(window.location.search)
      : applyWorkspaceRoute(window.location.search, activeModule, activeTab);
    const target = `${window.location.pathname}${search}${window.location.hash}`;

    if (hasSyncedInitialRoute.current) {
      window.history.pushState(window.history.state, '', target);
    } else {
      window.history.replaceState(window.history.state, '', target);
      hasSyncedInitialRoute.current = true;
    }
  }, [isActive, activeModule, activeTab]);

  // A sign-out returns the app to a clean slate; the next sign-in should not
  // inherit the previous session's first-write behaviour.
  useEffect(() => {
    if (!isActive) hasSyncedInitialRoute.current = false;
  }, [isActive]);
}
