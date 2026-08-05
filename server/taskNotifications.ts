import type { MailMessage } from './mailer';
import { sendMail } from './mailer';
import {
  AiPushNoSubscriptionsError,
  sendWebPushNotification,
  type WebPushPayload,
} from './aiNotificationPush';

export interface TaskNotificationMessage {
  id: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  dueDate: string;
  description: string;
  assignedUserId?: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function compact(value: unknown, max: number): string {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function taskUrl(appUrl: string | undefined, taskId: string): string {
  const base = String(appUrl || '').trim().replace(/\/+$/, '');
  return `${base || ''}/tasks?task=${encodeURIComponent(taskId)}`;
}

function priorityLabel(priority: TaskNotificationMessage['priority'], language: 'en' | 'ka'): string {
  const labels = {
    high: { en: 'High', ka: 'მაღალი' },
    medium: { en: 'Medium', ka: 'საშუალო' },
    low: { en: 'Low', ka: 'დაბალი' },
  };
  return labels[priority][language];
}

export function buildTaskAssignmentEmail(input: {
  to: string;
  language: 'en' | 'ka';
  wineryName: string;
  recipientName: string;
  assignedBy: string;
  task: TaskNotificationMessage;
  appUrl?: string;
}): MailMessage {
  const ka = input.language === 'ka';
  const title = compact(input.task.title, 180);
  const winery = compact(input.wineryName || 'VinOS', 100);
  const priority = priorityLabel(input.task.priority, input.language);
  const dueDate = compact(input.task.dueDate || (ka ? 'არ არის მითითებული' : 'Not specified'), 40);
  const description = compact(input.task.description, 1_500);
  const url = taskUrl(input.appUrl, input.task.id);
  const subject = compact(ka
    ? `[ახალი დავალება] ${winery} — ${title}`
    : `[New task] ${winery} — ${title}`, 200);
  const text = [
    ka ? `გამარჯობა, ${input.recipientName}.` : `Hello ${input.recipientName},`,
    '',
    ka ? 'VinOS-ში ახალი დავალება დაგენიშნათ.' : 'You have been assigned a new task in VinOS.',
    `${ka ? 'დავალება' : 'Task'}: ${title}`,
    `${ka ? 'პრიორიტეტი' : 'Priority'}: ${priority}`,
    `${ka ? 'ვადა' : 'Due'}: ${dueDate}`,
    description ? `${ka ? 'დეტალები' : 'Details'}: ${description}` : '',
    `${ka ? 'დამნიშნავი' : 'Assigned by'}: ${compact(input.assignedBy, 100)}`,
    '',
    `${ka ? 'დავალების გახსნა' : 'Open task'}: ${url}`,
    '',
    ka
      ? 'შეტყობინებების გამორთვა შეგიძლიათ VinOS-ის პროფილის პარამეტრებში.'
      : 'You can turn these notifications off in your VinOS profile settings.',
  ].filter(Boolean).join('\n');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fcfbfa;padding:32px 16px;color:#2c221e;line-height:1.55">
      <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #ebdcd0;border-radius:14px;overflow:hidden">
        <div style="background:#4e0e15;padding:24px 28px;color:#fff">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em">VinOS · ${escapeHtml(priority)}</div>
          <h1 style="font-family:Georgia,serif;font-size:21px;margin:8px 0 0">${escapeHtml(title)}</h1>
        </div>
        <div style="padding:28px">
          <p style="font-size:14px;margin:0 0 18px">${escapeHtml(ka ? `გამარჯობა, ${input.recipientName}.` : `Hello ${input.recipientName},`)}</p>
          <p style="font-size:13px;color:#6f6260;margin:0 0 8px"><strong>${escapeHtml(ka ? 'ვადა' : 'Due')}:</strong> ${escapeHtml(dueDate)}</p>
          <p style="font-size:13px;color:#6f6260;margin:0 0 20px"><strong>${escapeHtml(ka ? 'დამნიშნავი' : 'Assigned by')}:</strong> ${escapeHtml(compact(input.assignedBy, 100))}</p>
          ${description ? `<p style="font-size:14px;margin:0 0 24px">${escapeHtml(description)}</p>` : ''}
          <p style="margin:26px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#801323;color:#fff;text-decoration:none;border-radius:8px;padding:11px 18px;font-weight:700">${escapeHtml(ka ? 'დავალების გახსნა' : 'Open task')}</a></p>
          <p style="font-size:12px;color:#8c7f7e;border-top:1px solid #ebdcd0;padding-top:18px;margin:0">${escapeHtml(
            ka
              ? 'შეტყობინებების გამორთვა შეგიძლიათ VinOS-ის პროფილის პარამეტრებში.'
              : 'You can turn these notifications off in your VinOS profile settings.',
          )}</p>
        </div>
      </div>
    </div>
  `;
  return { to: input.to, subject, text, html };
}

export function buildTaskAssignmentPush(input: {
  language: 'en' | 'ka';
  wineryName: string;
  assignedBy: string;
  task: TaskNotificationMessage;
  appUrl?: string;
}): WebPushPayload {
  const ka = input.language === 'ka';
  const priority = priorityLabel(input.task.priority, input.language);
  const details = [
    `${ka ? 'პრიორიტეტი' : 'Priority'}: ${priority}`,
    input.task.dueDate ? `${ka ? 'ვადა' : 'Due'}: ${compact(input.task.dueDate, 40)}` : '',
    `${ka ? 'დამნიშნავი' : 'Assigned by'}: ${compact(input.assignedBy, 80)}`,
  ].filter(Boolean).join(' · ');
  return {
    title: compact(ka ? `ახალი დავალება: ${input.task.title}` : `New task: ${input.task.title}`, 180),
    body: compact(details, 500),
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: `task-assignment-${input.task.id}`,
    renotify: input.task.priority === 'high',
    requireInteraction: input.task.priority === 'high',
    lang: input.language,
    data: {
      type: 'task_assignment',
      taskId: input.task.id,
      wineryName: compact(input.wineryName, 100),
      url: taskUrl(input.appUrl, input.task.id),
    },
    actions: [{ action: 'open', title: ka ? 'გახსნა' : 'Open' }],
  };
}

export async function sendTaskAssignmentEmail(
  input: Parameters<typeof buildTaskAssignmentEmail>[0],
): Promise<void> {
  const result = await sendMail(buildTaskAssignmentEmail(input));
  if (!result.delivered) throw new Error('Email transport did not confirm delivery.');
}

export async function sendTaskAssignmentPush(input: {
  organizationId: string;
  username: string;
} & Parameters<typeof buildTaskAssignmentPush>[0]): Promise<void> {
  try {
    await sendWebPushNotification({
      organizationId: input.organizationId,
      username: input.username,
      payload: buildTaskAssignmentPush(input),
      ttlSeconds: input.task.priority === 'high' ? 24 * 60 * 60 : 8 * 60 * 60,
      urgency: input.task.priority === 'high' ? 'high' : 'normal',
    });
  } catch (error) {
    if (error instanceof AiPushNoSubscriptionsError) {
      throw new Error('No active browser push subscriptions remain.');
    }
    throw error;
  }
}
