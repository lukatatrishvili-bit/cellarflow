import type React from 'react';

/**
 * The shape of the one workspace sidebar, kept out of the component so the
 * state hook can persist the mode and the shell can stay lazily loaded.
 */

/**
 * `full` labels every destination, `rail` keeps the icons and their grouping in
 * 56px with a hover flyout for the labels, and `hidden` gives the whole width
 * to the content — which the cellar's wider tables actually want.
 */
export type SidebarMode = 'full' | 'rail' | 'hidden';

export const SIDEBAR_MODE_CYCLE: SidebarMode[] = ['full', 'rail', 'hidden'];

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
