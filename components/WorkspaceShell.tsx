import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * The one navigation grammar every workspace uses.
 *
 * Before this, the cellar had a labelled sidebar, the vineyard had a
 * horizontal strip, and the business and records groups had no second level at
 * all — so "group → section → screen" was true in some places and false in
 * others, and there was no single model to learn. Every group now renders its
 * destinations the same way: a sticky labelled sidebar on desktop, a grouped
 * select on mobile.
 */

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

interface WorkspaceShellProps {
  sections: WorkspaceNavSection[];
  /** Visible label for the mobile section picker, e.g. "Winery section". */
  mobileLabel: string;
  sectionsLabel: string;
  collapseLabel: string;
  expandLabel: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Optional context card pinned above the section list (the cellar's focus panel). */
  summary?: React.ReactNode;
  children: React.ReactNode;
}

export default function WorkspaceShell({
  sections,
  mobileLabel,
  sectionsLabel,
  collapseLabel,
  expandLabel,
  collapsed,
  onToggleCollapsed,
  summary,
  children,
}: WorkspaceShellProps) {
  const allItems = sections.flatMap(section => section.items);
  const activeItem = allItems.find(item => item.active);
  const hasNavigation = allItems.length > 0;

  return (
    <main className="flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-4 lg:p-6 flex flex-col lg:flex-row gap-6">

      {hasNavigation && (
        <aside className={`app-sidebar shrink-0 w-full ${collapsed ? 'lg:w-16' : 'lg:w-64'} lg:self-start lg:sticky lg:top-20 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1 lg:pb-2 lg:[scrollbar-gutter:stable] transition-[width] duration-300`}>
          <div className="lg:hidden rounded-xl border border-stone-200 bg-white p-3 shadow-xs dark:bg-stone-900 dark:border-stone-800">
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

          {!collapsed && summary}

          <div className="hidden lg:flex items-center justify-between px-1 pb-2 mb-1 border-b border-[#e8dfd5]/70 dark:border-stone-800">
            {!collapsed && <span className="text-[10px] font-mono text-stone-600 uppercase tracking-[0.15em] font-bold dark:text-stone-400">{sectionsLabel}</span>}
            <button
              onClick={onToggleCollapsed}
              className="ml-auto p-1.5 text-stone-400 hover:text-[#4e0e15] hover:bg-stone-100 rounded-md transition-colors cursor-pointer"
              title={collapsed ? expandLabel : collapseLabel}
              aria-label={collapsed ? expandLabel : collapseLabel}
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>

          <div className="hidden lg:flex lg:flex-col gap-3 lg:overflow-visible">
            {sections.map(section => (
              <div key={section.id} className="space-y-1">
                {!collapsed && (
                  <div className="px-3 pt-1 pb-0.5 text-[9px] font-mono font-black uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
                    {section.label}
                  </div>
                )}
                <div className="space-y-1">
                  {section.items.map(item => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={item.onSelect}
                        title={item.label}
                        aria-current={item.active ? 'page' : undefined}
                        className={`group shrink-0 lg:w-full flex items-center gap-2.5 px-3 py-2 lg:py-2.5 rounded-[10px] text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                          collapsed ? 'lg:justify-center' : ''
                        } ${
                          item.active
                            ? 'bg-[#f0e6e8] text-[#651522] dark:bg-[#3a171d] dark:text-amber-100'
                            : 'text-stone-600 hover:text-stone-950 hover:bg-stone-100 dark:text-stone-300 dark:hover:text-stone-100 dark:hover:bg-stone-900'
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${item.active ? 'text-[#651522] dark:text-amber-200' : 'text-stone-400 group-hover:text-stone-700 dark:text-stone-500 dark:group-hover:text-stone-300'}`} />
                        <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}

      <section className="app-content flex-1 min-w-0 space-y-4">
        {children}
      </section>
    </main>
  );
}
