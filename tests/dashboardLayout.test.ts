import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DashboardLayout, {
  mergeDashboardLayout,
  orderDashboardWidgets,
  reorderDashboardLayout,
} from '../components/DashboardLayout';

describe('explicit widget ordering', () => {
  const widgets = [
    { id: 'metrics' },
    { id: 'priority-queue' },
    { id: 'quick-actions' },
    { id: 'cellar-pulse' },
  ];

  it('puts Today’s work ahead of its numbers', () => {
    const ordered = orderDashboardWidgets(widgets, ['priority-queue', 'quick-actions', 'metrics']);

    expect(ordered.map(w => w.id)).toEqual(['priority-queue', 'quick-actions', 'metrics', 'cellar-pulse']);
  });

  it('keeps unnamed widgets after the named ones, in their original order', () => {
    const ordered = orderDashboardWidgets(
      [{ id: 'b' }, { id: 'unlisted-1' }, { id: 'a' }, { id: 'unlisted-2' }],
      ['a', 'b'],
    );

    expect(ordered.map(w => w.id)).toEqual(['a', 'b', 'unlisted-1', 'unlisted-2']);
  });

  it('leaves the list alone when no ids match', () => {
    const ordered = orderDashboardWidgets(widgets, ['nothing-here']);

    expect(ordered.map(w => w.id)).toEqual(widgets.map(w => w.id));
  });

  it('does not mutate the input', () => {
    const input = [{ id: 'metrics' }, { id: 'priority-queue' }];
    orderDashboardWidgets(input, ['priority-queue']);

    expect(input.map(w => w.id)).toEqual(['metrics', 'priority-queue']);
  });
});

describe('dashboard layout persistence', () => {
  const defaults = [
    { id: 'metrics', span: 12 as const },
    { id: 'queue', span: 8 as const },
    { id: 'actions', span: 4 as const },
  ];

  it('restores saved order and card sizes', () => {
    expect(mergeDashboardLayout(defaults, [
      { id: 'actions', span: 6 },
      { id: 'metrics', span: 8 },
      { id: 'queue', span: 4 },
    ])).toEqual([
      { id: 'actions', span: 6 },
      { id: 'metrics', span: 8 },
      { id: 'queue', span: 4 },
    ]);
  });

  it('ignores stale or malformed entries and appends new widgets', () => {
    expect(mergeDashboardLayout(defaults, [
      { id: 'queue', span: 5 },
      { id: 'removed-widget', span: 12 },
      { id: 'queue', span: 12 },
    ])).toEqual([
      { id: 'queue', span: 8 },
      { id: 'metrics', span: 12 },
      { id: 'actions', span: 4 },
    ]);
  });

  it('falls back to defaults when storage is not an array', () => {
    expect(mergeDashboardLayout(defaults, { id: 'metrics' })).toEqual(defaults);
  });

  it('restores hidden cards without breaking older saved layouts', () => {
    expect(mergeDashboardLayout(defaults, [
      { id: 'queue', span: 6, hidden: true },
      { id: 'metrics', span: 12 },
    ])).toEqual([
      { id: 'queue', span: 6, hidden: true },
      { id: 'metrics', span: 12 },
      { id: 'actions', span: 4 },
    ]);
  });

  it('moves a dragged card to the target position', () => {
    expect(reorderDashboardLayout(defaults, 'metrics', 'actions')).toEqual([
      { id: 'queue', span: 8 },
      { id: 'actions', span: 4 },
      { id: 'metrics', span: 12 },
    ]);
    expect(reorderDashboardLayout(defaults, 'missing', 'actions')).toBe(defaults);
  });

  it('renders the organizer and every configured widget', () => {
    const markup = renderToStaticMarkup(React.createElement(DashboardLayout, {
      dashboardId: 'test-user',
      lang: 'en',
      items: [
        { id: 'metrics', defaultSpan: 12, content: React.createElement('div', null, 'Metrics') },
        { id: 'queue', defaultSpan: 8, content: React.createElement('div', null, 'Queue') },
      ],
    }));

    expect(markup).toContain('Organize dashboard');
    expect(markup).toContain('data-dashboard-widget="metrics"');
    expect(markup).toContain('data-dashboard-widget="queue"');
    expect(markup).toContain('xl:col-span-12');
    expect(markup).toContain('xl:col-span-8');
  });

  it('places optional dashboard context beside the organizer', () => {
    const markup = renderToStaticMarkup(React.createElement(DashboardLayout, {
      dashboardId: 'test-context',
      lang: 'en',
      toolbar: React.createElement('div', { 'aria-label': 'Workspace context' }, 'Estate · Telavi'),
      items: [{ id: 'metrics', content: React.createElement('div', null, 'Metrics') }],
    }));

    expect(markup).toContain('Workspace context');
    expect(markup).toContain('Estate · Telavi');
    expect(markup).toContain('Organize dashboard');
  });
});
