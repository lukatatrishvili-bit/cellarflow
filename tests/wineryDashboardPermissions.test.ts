import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WineryDashboardTab, { toggleTaskStatusIfAllowed } from '../components/WineryDashboardTab';
import type { Task } from '../lib/wineryState';
import type { Role } from '../server/permissions';

const task: Task = {
  id: 'task-1',
  title: 'Check cellar temperature',
  priority: 'high',
  dueDate: '2099-01-01',
  assignedTo: 'Cellar team',
  status: 'pending',
  description: 'Record the current vessel temperatures.',
};

function renderDashboard(canUpdateTasks: boolean, role: Role = 'Owner/Admin'): string {
  return renderToStaticMarkup(React.createElement(WineryDashboardTab, {
    lang: 'en',
    lots: [],
    vessels: [],
    fermLogs: [],
    labLogs: [],
    tasks: [task],
    chartLotId: '',
    setChartLotId: vi.fn(),
    selectedTankId: null,
    setSelectedTankId: vi.fn(),
    onToggleTaskStatus: vi.fn(),
    canUpdateTasks,
    role,
  }));
}

describe('WineryDashboardTab task permissions', () => {
  it('renders task controls as read-only when updates are not allowed', () => {
    const markup = renderDashboard(false);

    expect(markup).toContain('Task status is view-only for your role.');
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(markup).toContain('cursor-default');
  });

  it('keeps task controls interactive by default', () => {
    const markup = renderDashboard(true);

    expect(markup).not.toContain('Task status is view-only for your role.');
    expect(markup).not.toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(markup).toContain('cursor-pointer');
  });

  it('only exposes role-relevant dashboard actions and operational panels', () => {
    const markup = renderDashboard(true, 'Lab Technician');

    expect(markup).toContain('Add lab');
    expect(markup).toContain('Tasks');
    expect(markup).toContain('Chemistry');
    expect(markup).not.toContain('Log fermentation');
    expect(markup).not.toContain('Cellar vessel utilization');
    expect(markup).not.toContain('Kinetics &amp; sugar degradation');
    expect(markup).not.toContain('Recent fermentation logs');
  });

  it('does not call the mutation callback when task updates are forbidden', () => {
    const onToggleTaskStatus = vi.fn();

    toggleTaskStatusIfAllowed(false, onToggleTaskStatus, task.id);
    expect(onToggleTaskStatus).not.toHaveBeenCalled();

    toggleTaskStatusIfAllowed(true, onToggleTaskStatus, task.id);
    expect(onToggleTaskStatus).toHaveBeenCalledOnce();
    expect(onToggleTaskStatus).toHaveBeenCalledWith(task.id);
  });
});
