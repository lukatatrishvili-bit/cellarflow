import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PanelLeft, PanelLeftClose, PanelLeftDashed } from 'lucide-react';
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
 *
 * `auto` goes further: the sidebar gives its width back entirely and returns
 * when the cursor arrives at the screen edge. That is a desktop affordance and
 * is gated on `pointer: fine` rather than on viewport width — a touch screen has
 * no cursor to arrive, and below `md` the grouped select is the navigation.
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
  children: React.ReactNode;
}

const MODE_ICON: Record<SidebarMode, React.ComponentType<{ className?: string }>> = {
  full: PanelLeft,
  rail: PanelLeftClose,
  auto: PanelLeftDashed,
};

/**
 * How near the screen edge counts as reaching for the sidebar.
 *
 * Two thresholds rather than one, because two different gestures mean the same
 * thing. Slamming the pointer against the edge is unambiguous, so it opens at
 * once; drifting into the zone might just be someone reaching for content on
 * the left, so it waits out a short dwell. A single threshold has to choose
 * between feeling sluggish and opening when nobody asked.
 */
const EDGE_ZONE_PX = 12;
const EDGE_SLAM_PX = 2;
const EDGE_DWELL_MS = 110;
const RETRACT_DELAY_MS = 180;
/** Matches `md:w-56`; the pointer is outside the panel beyond this. */
const PANEL_WIDTH_PX = 224;

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
  children,
}: WorkspaceShellProps) {
  const allItems = sections.flatMap(section => section.items);
  const activeItem = allItems.find(item => item.active);
  const hasNavigation = allItems.length > 0;
  const isRail = mode === 'rail';
  const isAuto = mode === 'auto';

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

  // --- auto-reveal ---------------------------------------------------------
  const [revealed, setRevealed] = useState(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRevealTimers = useCallback(() => {
    if (dwellTimer.current) { clearTimeout(dwellTimer.current); dwellTimer.current = null; }
    if (retractTimer.current) { clearTimeout(retractTimer.current); retractTimer.current = null; }
  }, []);

  const retractNow = useCallback(() => {
    clearRevealTimers();
    setRevealed(false);
  }, [clearRevealTimers]);

  useEffect(() => clearRevealTimers, [clearRevealTimers]);

  useEffect(() => {
    if (!isAuto) retractNow();
  }, [isAuto, retractNow]);

  useEffect(() => {
    if (!isAuto || !hasNavigation || typeof window === 'undefined') return;
    // A cursor is the whole premise. Without one there is nothing to arrive at
    // the edge, and a touch device would only get phantom reveals.
    if (!window.matchMedia('(pointer: fine)').matches) return;

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;

      if (revealed) {
        if (event.clientX > PANEL_WIDTH_PX + 8) {
          if (!retractTimer.current) {
            retractTimer.current = setTimeout(() => {
              retractTimer.current = null;
              setRevealed(false);
            }, RETRACT_DELAY_MS);
          }
        } else if (retractTimer.current) {
          clearTimeout(retractTimer.current);
          retractTimer.current = null;
        }
        return;
      }

      if (event.clientX <= EDGE_SLAM_PX) {
        clearRevealTimers();
        setRevealed(true);
        return;
      }
      if (event.clientX <= EDGE_ZONE_PX) {
        if (!dwellTimer.current) {
          dwellTimer.current = setTimeout(() => {
            dwellTimer.current = null;
            setRevealed(true);
          }, EDGE_DWELL_MS);
        }
      } else if (dwellTimer.current) {
        clearTimeout(dwellTimer.current);
        dwellTimer.current = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') retractNow();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('keydown', onKeyDown);
    // Losing the window while the panel is out would leave it out on return.
    window.addEventListener('blur', retractNow);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', retractNow);
    };
  }, [isAuto, hasNavigation, revealed, clearRevealTimers, retractNow]);

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

  const asideWidth = isAuto ? 'md:w-1.5' : isRail ? 'md:w-14' : 'md:w-56';
  /**
   * The spine is 6px of chrome, not a column of content, so it should sit in
   * the page's own left gutter rather than beside it. Left at the full column
   * gap it produced 54px of empty space against 24px on the right — a strip
   * wide enough to read as a mistake.
   */
  const shellSpacing = isAuto
    ? 'gap-2 md:pl-2 lg:pl-2'
    : 'gap-4 lg:gap-6';

  const renderNavButton = (item: WorkspaceNavItem, compact: boolean) => {
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        onClick={() => { item.onSelect(); if (isAuto) retractNow(); }}
        title={compact ? item.label : undefined}
        aria-current={item.active ? 'page' : undefined}
        className={`group shrink-0 md:w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
          compact ? 'md:justify-center md:px-0' : ''
        } ${
          item.active
            ? 'bg-[#f0e6e8] text-[#651522] dark:bg-[#3a171d] dark:text-amber-100'
            : 'text-stone-600 hover:text-stone-950 hover:bg-stone-100 dark:text-stone-300 dark:hover:text-stone-100 dark:hover:bg-stone-900'
        }`}
      >
        <Icon className={`w-4 h-4 shrink-0 ${item.active ? 'text-[#651522] dark:text-amber-200' : 'text-stone-400 group-hover:text-stone-700 dark:text-stone-500 dark:group-hover:text-stone-300'}`} />
        <span className={compact ? 'md:hidden' : ''}>{item.label}</span>
      </button>
    );
  };

  /**
   * The sections list, shared by the in-flow sidebar and the auto-reveal panel
   * so the two cannot drift into looking like different components.
   */
  const renderSections = (compact: boolean) => (
    <div className={`hidden md:flex md:flex-col ${compact ? 'gap-1.5' : 'gap-3'} md:overflow-visible`}>
      {sections.map((section, index) => (
        <div
          key={section.id}
          className={`space-y-1 ${compact && index > 0 ? 'pt-1.5 border-t border-[#e8dfd5]/70 dark:border-stone-800' : ''}`}
          onMouseEnter={compact ? (event) => openFlyout(section, event.currentTarget) : undefined}
          onMouseLeave={compact ? closeFlyout : undefined}
          onFocus={compact ? (event) => openFlyout(section, event.currentTarget) : undefined}
          onBlur={compact ? (event) => {
            // Arrowing between buttons inside one section should not flicker
            // its own flyout shut.
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            closeFlyout();
          } : undefined}
        >
          {!compact && (
            <div className="px-3 pt-1 pb-0.5 text-[9px] font-mono font-black uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
              {section.label}
            </div>
          )}
          <div className="space-y-1">
            {section.items.map(item => renderNavButton(item, compact))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderModeToggle = (showLabel: boolean) => (
    <div className="hidden md:flex items-center justify-between px-1 pb-2 mb-1 border-b border-[#e8dfd5]/70 dark:border-stone-800">
      {showLabel && <span className="text-[10px] font-mono text-stone-600 uppercase tracking-[0.15em] font-bold dark:text-stone-400">{sectionsLabel}</span>}
      <button
        onClick={() => onModeChange(nextSidebarMode(mode))}
        className="ml-auto p-1.5 text-stone-400 hover:text-[#4e0e15] hover:bg-stone-100 rounded-md transition-colors cursor-pointer dark:hover:bg-stone-800 dark:hover:text-amber-200"
        title={modeLabels[nextSidebarMode(mode)]}
        aria-label={modeLabels[nextSidebarMode(mode)]}
      >
        {React.createElement(MODE_ICON[mode], { className: 'w-4 h-4' })}
      </button>
    </div>
  );

  return (
    <main className={`flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-4 lg:p-6 flex flex-col md:flex-row ${shellSpacing}`}>

      {hasNavigation && (
        <aside aria-label={sectionsLabel} className={`app-sidebar shrink-0 w-full ${asideWidth} md:self-start md:sticky md:top-[var(--app-header-offset,5rem)] md:max-h-[calc(100dvh-var(--app-header-offset,5rem)-4rem)] md:overflow-y-auto md:overscroll-contain ${isAuto ? '' : 'md:pr-1 md:pb-2 md:[scrollbar-gutter:stable]'} transition-[width] duration-300`}>
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

          {isAuto ? (
            /* The spine. Not a hidden drawer: one tick per section, the current
               one accented, so the sidebar's shape and where you are in it stay
               legible at 6px and the affordance advertises itself. */
            <button
              type="button"
              onClick={() => setRevealed(true)}
              onFocus={() => setRevealed(true)}
              aria-label={sectionsLabel}
              aria-expanded={revealed}
              className="hidden md:flex w-full cursor-pointer flex-col items-center gap-1 rounded-full py-2"
            >
              {sections.map(section => (
                <span
                  key={section.id}
                  className={`h-6 w-0.5 rounded-full transition-colors ${
                    section.items.some(item => item.active)
                      ? 'bg-[#651522] dark:bg-amber-300'
                      : 'bg-stone-300 dark:bg-stone-700'
                  }`}
                />
              ))}
            </button>
          ) : (
            <>
              {renderModeToggle(!isRail)}
              {renderSections(isRail)}
            </>
          )}
        </aside>
      )}

      {/* The auto-reveal panel. Fixed to the viewport edge rather than to the
          centred content column, so it arrives where the cursor actually is on
          a wide screen. Parked off-screen it is still in the DOM, so it is
          marked `inert` as well as `aria-hidden` — otherwise Tab walks into a
          panel nobody can see. */}
      {hasNavigation && isAuto && (
        <div
          aria-hidden={!revealed}
          inert={!revealed}
          onMouseEnter={() => clearRevealTimers()}
          className={`hidden md:block fixed left-0 top-[var(--app-header-offset,5rem)] z-40 w-56 max-h-[calc(100dvh-var(--app-header-offset,5rem)-1rem)] overflow-y-auto overscroll-contain rounded-r-2xl border border-l-0 border-[#e8dfd5] bg-white/98 p-3 shadow-2xl backdrop-blur transition-transform duration-200 ease-out dark:border-stone-800 dark:bg-stone-900/98 ${
            revealed ? 'translate-x-0' : '-translate-x-[105%]'
          }`}
        >
          {renderModeToggle(true)}
          {renderSections(false)}
        </div>
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
