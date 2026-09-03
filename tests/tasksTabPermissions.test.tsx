import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TasksTab, { toggleTaskStatusIfAllowed } from '../components/TasksTab';

const tasks = [
  {
    id: 'task-pending',
    title: 'Pending pump-over',
    priority: 'high' as const,
    dueDate: '2026-09-01',
    assignedTo: 'Nino',
    status: 'pending' as const,
    description: 'Pump over twice.',
  },
  {
    id: 'task-complete',
    title: 'Completed lab check',
    priority: 'medium' as const,
    dueDate: '2026-08-30',
    assignedTo: 'Giorgi',
    status: 'completed' as const,
    description: 'Record final density.',
  },
];

function taskProps(overrides: Partial<ComponentProps<typeof TasksTab>> = {}): ComponentProps<typeof TasksTab> {
  return {
    lang: 'en',
    tasks,
    onToggleTaskStatus: vi.fn(),
    onDeleteTask: vi.fn(),
    onAddNewTask: vi.fn(),
    ...overrides,
  };
}

describe('TasksTab action permissions', () => {
  it('preserves task browsing while hiding create/delete and disabling updates', () => {
    const markup = renderToStaticMarkup(React.createElement(TasksTab, taskProps({
      canCreateTask: false,
      canUpdateTask: false,
      canDeleteTask: false,
    })));

    expect(markup).toContain('Pending pump-over');
    expect(markup).toContain('Completed lab check');
    expect(markup).toContain('You can browse cellar tasks');
    expect(markup).not.toContain('Schedule Cellar Task');
    expect(markup).not.toContain('Assign Task Directive');
    expect(markup).not.toContain('Delete Pending pump-over');
    expect(markup).not.toContain('Delete Completed lab check');
    expect(markup).toContain('Pending pump-over cannot be updated by your role');
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it('guards update callbacks even if a disabled handler is invoked directly', () => {
    const onToggleTaskStatus = vi.fn();
    toggleTaskStatusIfAllowed(false, onToggleTaskStatus, 'task-pending');
    toggleTaskStatusIfAllowed(false, onToggleTaskStatus, 'task-complete');
    expect(onToggleTaskStatus).not.toHaveBeenCalled();
  });

  it('keeps the original fully interactive behavior by default', () => {
    const markup = renderToStaticMarkup(React.createElement(TasksTab, taskProps()));

    expect(markup).toContain('Schedule Cellar Task');
    expect(markup).toContain('Assign Task Directive');
    expect(markup).toContain('Delete Pending pump-over');
    expect(markup).toContain('Delete Completed lab check');
    expect(markup).toContain('Mark Pending pump-over completed');
    expect(markup).not.toContain('cannot be updated by your role');
  });

  it('opens on the current user task scope while keeping a visible team switch', () => {
    const markup = renderToStaticMarkup(React.createElement(TasksTab, taskProps({
      currentUsername: 'nino',
      currentUserName: 'Nino',
    })));

    expect(markup).toContain('Pending pump-over');
    expect(markup).not.toContain('Completed lab check');
    expect(markup).toContain('Mine');
    expect(markup).toContain('Team');
  });
});
