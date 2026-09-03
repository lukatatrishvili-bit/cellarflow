import type React from 'react';

/**
 * The shape of the one workspace sidebar, kept out of the component so the
 * state hook can persist the mode and the shell can stay lazily loaded.
 */

/**
 * `full` labels every destination and holds 224px. `rail` keeps the icons and
 * their grouping in 56px with a hover flyout for the labels. `auto` gives the
 * whole width back: the sidebar collapses to a spine, and a cursor arriving at
 * the screen edge slides the full panel out over the content.
 *
 * `auto` replaced an earlier `hidden` mode. Hidden reclaimed the same width but
 * cost a deliberate click on a floating tab to get the sidebar back, so it was
 * strictly worse than this for the same benefit.
 */
export type SidebarMode = 'full' | 'rail' | 'auto';

export const SIDEBAR_MODE_CYCLE: SidebarMode[] = ['full', 'rail', 'auto'];

/** One control, one order: the toggle button and Ctrl/Cmd+B advance the same cycle. */
export function nextSidebarMode(mode: SidebarMode): SidebarMode {
  const index = SIDEBAR_MODE_CYCLE.indexOf(mode);
  return SIDEBAR_MODE_CYCLE[(index + 1) % SIDEBAR_MODE_CYCLE.length];
}

export interface WorkspaceNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onSelect: () => void;
}

export interface WorkspaceNavSection {
  id: string;
  label: string;
  items: WorkspaceNavItem[];
}
