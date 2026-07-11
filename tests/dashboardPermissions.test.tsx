import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import DashboardTab from '../components/DashboardTab';
import type { UserProfile } from '../lib/wineryState';

function dashboardProps(role: UserProfile['role']): ComponentProps<typeof DashboardTab> {
  return {
    lang: 'en',
    companyProfile: {
      companyName: 'Example Estate',
      wineryName: '',
      country: 'Georgia',
      region: '',
      municipality: '',
      address: '',
      contactEmail: '',
      phone: '',
      website: '',
      measurementUnits: 'metric',
    },
    currentUser: {
      username: 'qa-user',
      email: 'qa@example.com',
      fullName: 'QA User',
      role,
      language: 'en',
      enabledModules: ['vazi', 'gvino'],
      enabledWidgets: ['weather', 'chemistry', 'fermentation', 'tasks', 'audit'],
    },
    blocks: [],
    lots: [],
    vessels: [],
    tasks: [{
      id: 'task-1',
      title: 'Review lab results',
      priority: 'medium',
      dueDate: '2026-07-11',
      assignedTo: 'QA User',
      status: 'pending',
      description: '',
    }],
    fermLogs: [],
    labLogs: [],
    inventory: [],
    scoutings: [],
    auditLogs: [],
    grapeIntakes: [],
    cellarOps: [],
    onToggleTaskStatus: vi.fn(),
    setActiveModule: vi.fn(),
    setActiveTab: vi.fn(),
    onOpenOnboarding: vi.fn(),
  };
}

describe('DashboardTab role-aware actions', () => {
  it('shows a lab technician only the setup and quick actions their role can perform', () => {
    const markup = renderToStaticMarkup(
      React.createElement(DashboardTab, dashboardProps('Lab Technician')),
    );

    expect(markup).toContain('Add lab result');
    expect(markup).toContain('Review tasks');
    expect(markup).toContain('Record a lab analysis');
    expect(markup).not.toContain('Log fermentation');
    expect(markup).not.toContain('Register tanks &amp; qvevri');
    expect(markup).not.toContain('Launch Vazi Management');
    expect(markup).not.toContain('Active Fermentation Readings');
  });

  it('removes setup mutations and disables task changes for a read-only user', () => {
    const markup = renderToStaticMarkup(
      React.createElement(DashboardTab, dashboardProps('Read-Only')),
    );

    expect(markup).not.toContain('Winery setup journey');
    expect(markup).not.toContain('Add lab result');
    expect(markup).not.toContain('Log fermentation');
    expect(markup).toContain('Review tasks');
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
  });
});
