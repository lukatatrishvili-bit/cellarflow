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

  it('gives a viticulturist vineyard-first metrics even when cellar data exists', () => {
    const props = dashboardProps('Viticulturist');
    props.blocks = [{
      id: 'block-1',
      name: 'North Saperavi',
      area: 2.4,
      grapeVariety: 'Saperavi',
      currentPhenology: 'Veraison',
    }] as any;
    props.lots = [{
      id: 'lot-1',
      name: 'Saperavi 2026',
      stage: 'fermenting',
      currentVolume: 800,
    }] as any;
    props.vessels = [{
      id: 'tank-1',
      capacity: 1000,
      currentVolume: 800,
      assignedLotId: 'lot-1',
    }] as any;

    const markup = renderToStaticMarkup(
      React.createElement(DashboardTab, props),
    );

    expect(markup).toContain('Vineyard blocks');
    expect(markup).toContain('Vineyard area');
    expect(markup).toContain('Field &amp; weather risk');
    expect(markup).toContain('2.4 ha');
    expect(markup).toContain('Open vineyard');
    expect(markup).toContain('Vineyard pulse');
    expect(markup).toContain('Current stage');
    expect(markup).toContain('Veraison');
    expect(markup).not.toContain('Cellar pulse');
    expect(markup).not.toContain('Cellar capacity');
    expect(markup).not.toContain('Active fermentations');
  });

  it('gives a lab technician chemistry and analysis metrics instead of cellar metrics', () => {
    const props = dashboardProps('Lab Technician');
    props.labLogs = [{
      id: 'lab-1',
      lotId: 'lot-1',
      date: '2026-07-23',
    }, {
      id: 'lab-2',
      lotId: 'lot-1',
      date: '2026-07-23',
    }] as any;
    props.lots = [{
      id: 'lot-1',
      name: 'Saperavi 2026',
      stage: 'fermenting',
      currentVolume: 800,
    }] as any;
    props.vessels = [{
      id: 'tank-1',
      capacity: 1000,
      currentVolume: 800,
      assignedLotId: 'lot-1',
    }] as any;

    const markup = renderToStaticMarkup(
      React.createElement(DashboardTab, props),
    );

    expect(markup).toContain('Chemistry alerts');
    expect(markup).toContain('Lab analyses');
    expect(markup).toContain('1 lot tested');
    expect(markup).toContain('Open tasks');
    expect(markup).toContain('Laboratory pulse');
    expect(markup).toContain('Latest lot');
    expect(markup).toContain('Saperavi 2026');
    expect(markup).not.toContain('Cellar pulse');
    expect(markup).not.toContain('Cellar capacity');
    expect(markup).not.toContain('Active fermentations');
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

  it('keeps a new empty workspace compact instead of repeating zero-value sections', () => {
    const props = dashboardProps('Owner/Admin');
    props.tasks = [];

    const markup = renderToStaticMarkup(
      React.createElement(DashboardTab, props),
    );

    expect(markup).toContain('Complete the next setup step to bring your live operation into view.');
    expect(markup).toContain('Start here');
    expect(markup).not.toContain('Today metrics');
    expect(markup).not.toContain('Today’s priority queue');
    expect(markup).not.toContain('Operational pulse');
    expect(markup).not.toContain('Your cellar is ready to configure');
    expect(markup).not.toContain('Active fermentations');
    expect(markup).not.toContain('Cellar capacity');
    expect(markup).not.toContain('My tasks');
    expect(markup).not.toContain('Recent activity');
  });

  it('restores operational metrics and activity when the estate has recorded data', () => {
    const props = dashboardProps('Owner/Admin');
    props.lots = [{
      id: 'lot-1',
      name: 'Saperavi 2026',
      stage: 'aging',
      currentVolume: 800,
    }] as any;
    props.vessels = [{
      id: 'tank-1',
      capacity: 1000,
      currentVolume: 800,
      assignedLotId: 'lot-1',
    }] as any;
    props.auditLogs = [{
      id: 'audit-1',
      timestamp: '2026-07-23T10:00:00.000Z',
      user: 'QA User',
      actionType: 'Transfer',
      changedItem: 'Saperavi 2026',
    }] as any;

    const markup = renderToStaticMarkup(
      React.createElement(DashboardTab, props),
    );

    expect(markup).toContain('Today at Example Estate');
    expect(markup).toContain('Active fermentations');
    expect(markup).toContain('Cellar capacity');
    expect(markup).toContain('My tasks');
    expect(markup).toContain('Recent activity');
  });
});
