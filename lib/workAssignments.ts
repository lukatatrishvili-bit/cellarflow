import type { Task } from './wineryState';

export interface WorkIdentity {
  username?: string;
  fullName?: string;
}

function normalizedIdentity(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

function identityValues(identity: WorkIdentity): Set<string> {
  return new Set(
    [identity.username, identity.fullName]
      .map(normalizedIdentity)
      .filter(Boolean),
  );
}

/**
 * Matches both current username-backed assignments and older records that only
 * persisted the assignee's display name. Explicit user IDs always win so a
 * renamed display name cannot make another person's task appear as "mine".
 */
export function taskIsAssignedToIdentity(task: Pick<Task, 'assignedUserId' | 'assignedTo'>, identity: WorkIdentity): boolean {
  const identities = identityValues(identity);
  if (identities.size === 0) return false;
  const assignedUserId = normalizedIdentity(task.assignedUserId);
  if (assignedUserId) return identities.has(assignedUserId);
  const assignedTo = normalizedIdentity(task.assignedTo);
  return Boolean(assignedTo && identities.has(assignedTo));
}

export function workOwnerMatchesIdentity(owner: unknown, identity: WorkIdentity): boolean {
  const normalizedOwner = normalizedIdentity(owner);
  return Boolean(normalizedOwner && identityValues(identity).has(normalizedOwner));
}

export function tasksForIdentity(tasks: Task[], identity: WorkIdentity): Task[] {
  return tasks.filter(task => taskIsAssignedToIdentity(task, identity));
}
