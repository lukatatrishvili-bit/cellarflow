import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NotificationCenter from '../components/NotificationCenter';
import type { NotificationItem } from '../lib/notificationFeed';

function item(overrides: Partial<NotificationItem>): NotificationItem {
  return {
    id: 'notification',
    source: 'ai',
    severity: 'warning',
    category: 'intelligence',
    title: 'Finding',
    message: 'Observation',
    unread: true,
    ...overrides,
  };
}

describe('NotificationCenter', () => {
  it('uses unread count for the bell while retaining the active count for context', () => {
    const markup = renderToStaticMarkup(
      <NotificationCenter
        items={[
          item({ id: 'unread', unread: true }),
          item({ id: 'read', unread: false }),
        ]}
      />,
    );

    expect(markup).toContain('aria-label="Notifications: 1 unread, 2 active"');
    expect(markup).toContain('>1</span>');
  });

  it('renders no badge when every AI notification is already read', () => {
    const markup = renderToStaticMarkup(
      <NotificationCenter items={[item({ unread: false })]} lang="ka" />,
    );

    expect(markup).toContain('1 აქტიური');
    expect(markup).not.toContain('ring-2 ring-white');
  });
});
