import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  getPrismaClientForAdmin: async () => null,
}));

import {
  buildTaskAssignmentEmail,
  buildTaskAssignmentPush,
} from '../server/taskNotifications';
import {
  __resetInMemoryTaskNotificationDeliveries,
  completeTaskNotificationDelivery,
  failTaskNotificationDelivery,
  reserveTaskNotificationDelivery,
} from '../server/taskNotificationStore';

const task = {
  id: 'task-42',
  title: 'Check <Saperavi> density',
  priority: 'high' as const,
  dueDate: '2026-08-06',
  description: 'Record the hydrometer reading.',
  assignedUserId: 'nino',
};

describe('task email and browser-push notifications', () => {
  beforeEach(() => {
    __resetInMemoryTaskNotificationDeliveries();
  });

  it('builds localized safe email with a direct task link', () => {
    const email = buildTaskAssignmentEmail({
      to: 'nino@example.com',
      language: 'ka',
      wineryName: 'მარანი ალაზანი',
      recipientName: 'ნინო',
      assignedBy: 'ლუკა',
      task,
      appUrl: 'https://vinos.ge/',
    });
    expect(email.subject).toContain('[ახალი დავალება]');
    expect(email.text).toContain('https://vinos.ge/tasks?task=task-42');
    expect(email.html).toContain('Check &lt;Saperavi&gt; density');
    expect(email.html).not.toContain('Check <Saperavi> density');
  });

  it('builds a high-priority push that deep-links to the task', () => {
    const push = buildTaskAssignmentPush({
      language: 'en',
      wineryName: 'Alazani Winery',
      assignedBy: 'Luka',
      task,
      appUrl: 'https://vinos.ge',
    });
    expect(push.title).toContain('New task:');
    expect(push.requireInteraction).toBe(true);
    expect(push.data).toEqual(expect.objectContaining({
      type: 'task_assignment',
      taskId: 'task-42',
      url: 'https://vinos.ge/tasks?task=task-42',
    }));
  });

  it('replays successful channels and retries only failed channels', async () => {
    const initial = await reserveTaskNotificationDelivery({
      organizationId: 'org-a',
      taskId: task.id,
      assigneeUsername: 'nino',
      senderUsername: 'owner',
      channel: 'email',
      now: new Date('2026-08-05T10:00:00.000Z'),
    });
    expect(initial.outcome).toBe('claimed');
    if (initial.outcome !== 'claimed') throw new Error('Expected claim.');
    await failTaskNotificationDelivery(
      initial.record.id,
      initial.record.claimToken,
      new Error('SMTP unavailable'),
      new Date('2026-08-05T10:01:00.000Z'),
    );

    const retry = await reserveTaskNotificationDelivery({
      organizationId: 'org-a',
      taskId: task.id,
      assigneeUsername: 'nino',
      senderUsername: 'owner',
      channel: 'email',
      now: new Date('2026-08-05T10:02:00.000Z'),
    });
    expect(retry.outcome).toBe('claimed');
    if (retry.outcome !== 'claimed') throw new Error('Expected retry claim.');
    expect(retry.record.attemptCount).toBe(2);
    await completeTaskNotificationDelivery(
      retry.record.id,
      retry.record.claimToken,
      new Date('2026-08-05T10:03:00.000Z'),
    );

    const replay = await reserveTaskNotificationDelivery({
      organizationId: 'org-a',
      taskId: task.id,
      assigneeUsername: 'nino',
      senderUsername: 'owner',
      channel: 'email',
      now: new Date('2026-08-05T10:04:00.000Z'),
    });
    expect(replay.outcome).toBe('replay');
    expect(replay.record.status).toBe('sent');
    expect(replay.record.attemptCount).toBe(2);
  });
});
