import { describe, expect, it } from 'vitest';
import { taskIsAssignedToIdentity, tasksForIdentity, workOwnerMatchesIdentity } from '../lib/workAssignments';
import type { Task } from '../lib/wineryState';

const task = (patch: Partial<Task>): Task => ({
  id: 'task-1',
  title: 'Cellar check',
  priority: 'medium',
  dueDate: '2026-08-24',
  assignedTo: 'Ana K.',
  status: 'pending',
  description: '',
  ...patch,
});

describe('work assignment identity matching', () => {
  it('matches current username-backed assignments without trusting a stale display name', () => {
    expect(taskIsAssignedToIdentity(
      task({ assignedUserId: 'ana', assignedTo: 'Old display name' }),
      { username: 'ANA', fullName: 'Ana K.' },
    )).toBe(true);
    expect(taskIsAssignedToIdentity(
      task({ assignedUserId: 'nino', assignedTo: 'Ana K.' }),
      { username: 'ana', fullName: 'Ana K.' },
    )).toBe(false);
  });

  it('supports legacy display-name-only tasks and owner fields', () => {
    const identity = { username: 'ana', fullName: 'Ana K.' };
    expect(taskIsAssignedToIdentity(task({ assignedUserId: undefined }), identity)).toBe(true);
    expect(workOwnerMatchesIdentity('ANA', identity)).toBe(true);
    expect(workOwnerMatchesIdentity('Nino', identity)).toBe(false);
  });

  it('filters a mixed team list down to the current user', () => {
    const tasks = [
      task({ id: 'mine-by-id', assignedUserId: 'ana', assignedTo: 'Ana K.' }),
      task({ id: 'mine-legacy', assignedUserId: undefined, assignedTo: 'Ana K.' }),
      task({ id: 'theirs', assignedUserId: 'nino', assignedTo: 'Nino' }),
    ];
    expect(tasksForIdentity(tasks, { username: 'ana', fullName: 'Ana K.' }).map(item => item.id))
      .toEqual(['mine-by-id', 'mine-legacy']);
  });
});
