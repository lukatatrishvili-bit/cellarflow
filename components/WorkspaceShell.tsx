import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, PanelLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
  nextSidebarMode,
  type SidebarMode,
  type WorkspaceNavItem,
  type WorkspaceNavSection,
} from '../lib/workspaceNavigation';

/**
 * The one navigation grammar every workspace uses.
 *
 * Before this, the cellar had a labelled sidebar, the vineyard had a
 * horizontal strip, and the business and records groups had no second level at
 * all — so "group → section → screen" was true in some places and false in
 * others, and there was no single model to learn. Every group now renders its
 * destinations the same way: a sticky labelled sidebar from `md` up, a grouped
 * select below it.
 *
 * Collapsing used to drop the group headings and leave an undifferentiated
 * icon column, so the collapsed state was strictly worse than the open one and
 * nobody kept it. The rail keeps the grouping — hairline rules between
 * sections, and a hover/focus flyout carrying the section label and its items —
 * so narrowing the sidebar costs width, not structure.
 */

export type { SidebarMode, WorkspaceNavItem, WorkspaceNavSection };

interface WorkspaceShellProps {
  sections: WorkspaceNavSection[];
  /** Visible label for the mobile section picker, e.g. "Winery section". */
  mobileLabel: string;
  sectionsLabel: string;
  /** Toggle tooltips, keyed by the mode the next click lands on. */
  modeLabels: Record<SidebarMode, string>;
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  /** Optional context card pinned above the section list (the cellar's focus panel). */
  summary?: React.ReactNode;
  children: React.ReactNode;
}

const MODE_ICON: Record<SidebarMode, React.ComponentType<{ className?: string }>> = {
  full: PanelLeft,
  rail: PanelLeftClose,
  hidden: PanelLeftOpen,
};

interface FlyoutState {
  sectionId: string;
  top: number;
  left: number;
}

export default function WorkspaceShell({
  sections,
  mobileLabel,
  sectionsLabel,
  modeLabels,
  mode,
  onModeChange,
  summary,
  children,
}: WorkspaceShellProps) {
  const allItems = sections.flatMap(section => section.items);
  const activeItem = allItems.find(item => item.active);
  const hasNavigation = allItems.length > 0;
  const isRail = mode === 'rail';
  const isHidden = mode === 'hidden';

  const [flyout, setFlyout] = useState<FlyoutState | null>(null);
  // The flyout sits flush against the rail so the pointer never crosses dead
  // space, but it is portalled — so leaving the rail button always fires a
  // close. A short grace period lets the pointer arrive before it takes.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const closeFlyout = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setFlyout(null), 90);
  }, [cancelClose]);
  const closeFlyoutNow = useCallback(() => {
    cancelClose();
    setFlyout(null);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  // Ctrl/Cmd+B advances the same cycle the toggle button does, so there is one
  // order to learn rather than two competing ones.
  useEffect(() => {
    if (!hasNavigation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'b') return;
      event.preventDefault();
      onModeChange(nextSidebarMode(mode));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasNavigation, mode, onModeChange]);

  // A flyout anchored to a rail button goes stale the moment anything moves it.
  useEffect(() => {
    if (!flyout) return;
    window.addEventListener('scroll', closeFlyoutNow, true);
    window.addEventListener('resize', closeFlyoutNow);
    return () => {
      window.removeEventListener('scroll', closeFlyoutNow, true);
      window.removeEventListener('resize', closeFlyoutNow);
    };
  }, [flyout, closeFlyoutNow]);

  useEffect(() => {
    if (!isRail) closeFlyoutNow();
  }, [isRail, closeFlyoutNow]);

  const openFlyout = useCallback((section: WorkspaceNavSection, anchor: HTMLElement | null) => {
    cancelClose();
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // Rough height: heading + one row per item + padding. Enough to keep a long
    // section from running off the bottom of the viewport.
    const estimatedHeight = 34 + section.items.length * 34 + 12;
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - estimatedHeight - 8));
    // Anchored flush to the rail's right edge — the panel's own left padding
    // supplies the visual gap without leaving a hoverable hole in the middle.
    setFlyout({ sectionId: section.id, top, left: rect.right });
  }, [cancelClose]);

  const flyoutSection = flyout ? sections.find(section => section.id === flyout.sectionId) : undefined;

  const asideWidth = isHidden ? 'md:hidden' : isRail ? 'md:w-14' : 'md:w-56';

  const renderNavButton = (item: WorkspaceNavItem) => {
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        onClick={item.onSelect}
        title={isRail ? item.label : undefined}
        aria-current={item.active ? 'page' : undefined}
        className={`group shrink-0 md:w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
          isRail ? 'md:justify-center md:px-0' : ''
        } ${
          item.active
            ? 'bg-[#f0e6e8] text-[#651522] dark:bg-[#3a171d] dark:text-amber-100'
            : 'text-stone-600 hover:text-stone-950 hover:bg-stone-100 dark:text-stone-300 dark:hover:text-stone-100 dark:hover:bg-stone-900'
        }`}
      >
        <Icon className={`w-4 h-4 shrink-0 ${item.active ? 'text-[#651522] dark:text-amber-200' : 'text-stone-400 group-hover:text-stone-700 dark:text-stone-500 dark:group-hover:text-stone-300'}`} />
        <span className={isRail ? 'md:hidden' : ''}>{item.label}</span>
      </button>
    );
  };

  return (
    <main className="flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-4 lg:p-6 flex flex-col md:flex-row gap-4 lg:gap-6">

      {hasNavigation && (
        <aside aria-label={sectionsLabel} className={`app-sidebar shrink-0 w-full ${asideWidth} md:self-start md:sticky md:top-20 md:max-h-[calc(100dvh-9rem)] md:overflow-y-auto md:overscroll-contain md:pr-1 md:pb-2 md:[scrollbar-gutter:stable] transition-[width] duration-300`}>
          <div className="md:hidden rounded-xl border border-stone-200 bg-white p-3 shadow-xs dark:bg-stone-900 dark:border-stone-800">
            <label htmlFor="workspace-section-picker" className="mb-1.5 block text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
              {mobileLabel}
            </label>
            <select
              id="workspace-section-picker"
              value={activeItem?.id || ''}
              onChange={(event) => {
                const next = allItems.find(item => item.id === event.target.value);
                next?.onSelect();
              }}
              className="w-full border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-bold text-stone-800 dark:bg-stone-950 dark:border-stone-700 dark:text-stone-100"
            >
              {sections.map((section) => (
                <optgroup key={section.id} label={section.label}>
                  {section.items.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {!isRail && summary}

          <div className="hidden md:flex items-center justify-between px-1 pb-2 mb-1 border-b border-[#e8dfd5]/70 dark:border-stone-800">
            {!isRail && <span className="text-[10px] font-mono text-stone-600 uppercase tracking-[0.15em] font-bold dark:text-stone-400">{sectionsLabel}</span>}
            <button
              onClick={() => onModeChange(nextSidebarMode(mode))}
              className="ml-auto p-1.5 text-stone-400 hover:text-[#4e0e15] hover:bg-stone-100 rounded-md transition-colors cursor-pointer dark:hover:bg-stone-800 dark:hover:text-amber-200"
              title={modeLabels[nextSidebarMode(mode)]}
              aria-label={modeLabels[nextSidebarMode(mode)]}
            >
              {React.createElement(MODE_ICON[mode], { className: 'w-4 h-4' })}
            </button>
          </div>

          <div className={`hidden md:flex md:flex-col ${isRail ? 'gap-1.5' : 'gap-3'} md:overflow-visible`}>
            {sections.map((section, index) => (
              <div
                key={section.id}
                className={`space-y-1 ${isRail && index > 0 ? 'pt-1.5 border-t border-[#e8dfd5]/70 dark:border-stone-800' : ''}`}
                onMouseEnter={isRail ? (event) => openFlyout(section, event.currentTarget) : undefined}
                onMouseLeave={isRail ? closeFlyout : undefined}
                onFocus={isRail ? (event) => openFlyout(section, event.currentTarget) : undefined}
                onBlur={isRail ? (event) => {
                  // Arrowing between buttons inside one section should not
                  // flicker its own flyout shut.
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  closeFlyout();
                } : undefined}
              >
                {!isRail && (
                  <div className="px-3 pt-1 pb-0.5 text-[9px] font-mono font-black uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
                    {section.label}
                  </div>
                )}
                <div className="space-y-1">
                  {section.items.map(renderNavButton)}
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* The way back from `hidden` — always on screen, so the mode can't strand
          anyone who reached it from the keyboard. */}
      {hasNavigation && isHidden && (
        <button
          onClick={() => onModeChange('full')}
          className="hidden md:flex fixed left-0 top-1/2 -translate-y-1/2 z-30 items-center rounded-r-lg border border-l-0 border-[#e8dfd5] bg-white/95 py-2.5 pl-1 pr-1.5 text-stone-500 shadow-md backdrop-blur transition-colors hover:text-[#4e0e15] cursor-pointer dark:border-stone-800 dark:bg-stone-900/95 dark:text-stone-300 dark:hover:text-amber-200"
          title={modeLabels.full}
          aria-label={modeLabels.full}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {flyout && flyoutSection && typeof document !== 'undefined' && createPortal(
        <div
          style={{ top: flyout.top, left: flyout.left }}
          className="fixed z-50 hidden md:block pl-2"
          onMouseEnter={cancelClose}
          onMouseLeave={closeFlyout}
        >
          <div className="min-w-[190px] rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl dark:border-stone-800 dark:bg-[#1a1113]">
            <div className="px-2.5 pb-1 pt-0.5 text-[9px] font-mono font-black uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">
              {flyoutSection.label}
            </div>
            {flyoutSection.items.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => { item.onSelect(); closeFlyoutNow(); }}
                  aria-current={item.active ? 'page' : undefined}
                  className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold cursor-pointer transition-colors ${
                    item.active
                      ? 'bg-[#f0e6e8] text-[#651522] dark:bg-[#3a171d] dark:text-amber-100'
                      : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${item.active ? 'text-[#651522] dark:text-amber-200' : 'text-stone-400 dark:text-stone-500'}`} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}

      <section className="app-content flex-1 min-w-0 space-y-4">
        {children}
      </section>
    </main>
  );
}
