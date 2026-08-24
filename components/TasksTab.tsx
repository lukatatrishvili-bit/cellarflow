import React from 'react';
import { BellRing, ClipboardList, CheckCircle2, Mail, Trash, UserRound } from 'lucide-react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import type { Task, TaskAssignmentInput } from '../lib/wineryState';
import { useFormDraft } from '../hooks/useFormDraft';
import DateInput from './ui/DateInput';

interface TaskTeamMember {
  username: string;
  fullName: string;
  role: string;
  language: 'en' | 'ka';
  emailNotificationReady: boolean;
  pushNotificationReady: boolean;
}

interface TaskFormDraft {
  title: string;
  priority: 'high' | 'medium' | 'low';
  dueDate: string;
  description: string;
  assignedUserId: string;
  notifyAssignee: boolean;
}

function taskDraftIsMeaningful(draft: TaskFormDraft): boolean {
  return Boolean(
    draft.title.trim()
    || draft.description.trim()
    || draft.dueDate
    || draft.priority !== 'medium',
  );
}

interface TasksTabProps {
  lang: Language;
  tasks: Task[];
  onToggleTaskStatus: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onAddNewTask: (
    title: string,
    priority: 'high' | 'medium' | 'low',
    dueDate: string,
    description: string,
    assignment?: TaskAssignmentInput,
  ) => Task | void;
  onUpdateTaskNotification?: (
    taskId: string,
    notification: NonNullable<Task['notification']>,
  ) => void;
  setToastMessage?: (message: string | null) => void;
  currentUsername?: string;
  prefilledTaskTitle?: string;
  setPrefilledTaskTitle?: (title: string) => void;
  prefilledTaskPriority?: 'high' | 'medium' | 'low';
  setPrefilledTaskPriority?: (priority: 'high' | 'medium' | 'low') => void;
  prefilledTaskDesc?: string;
  setPrefilledTaskDesc?: (desc: string) => void;
  focusTaskId?: string;
  canCreateTask?: boolean;
  canUpdateTask?: boolean;
  canDeleteTask?: boolean;
}

export function toggleTaskStatusIfAllowed(
  canUpdateTask: boolean,
  onToggleTaskStatus: (id: string) => void,
  taskId: string,
): void {
  if (canUpdateTask) onToggleTaskStatus(taskId);
}

export function TasksTab({
  lang,
  tasks,
  onToggleTaskStatus,
  onDeleteTask,
  onAddNewTask,
  onUpdateTaskNotification,
  setToastMessage,
  currentUsername = '',
  prefilledTaskTitle = '',
  setPrefilledTaskTitle = () => {},
  prefilledTaskPriority = 'medium',
  setPrefilledTaskPriority = () => {},
  prefilledTaskDesc = '',
  setPrefilledTaskDesc = () => {},
  focusTaskId,
  canCreateTask = true,
  canUpdateTask = true,
  canDeleteTask = true
}: TasksTabProps) {
  const t = translations[lang];
  const isKa = lang === 'ka';
  const [members, setMembers] = React.useState<TaskTeamMember[]>([]);
  const [assignedUserId, setAssignedUserId] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');
  const [notifyAssignee, setNotifyAssignee] = React.useState(false);
  const [loadingRecipients, setLoadingRecipients] = React.useState(true);
  const [sendingNotificationTaskIds, setSendingNotificationTaskIds] = React.useState<Set<string>>(new Set());
  const selectedMember = members.find(member => member.username === assignedUserId);
  const selectedChannels = [
    selectedMember?.emailNotificationReady ? 'email' : '',
    selectedMember?.pushNotificationReady ? 'push' : '',
  ].filter(Boolean);
  const canNotifyAssignee = selectedChannels.length > 0;
  const taskDraft = React.useMemo<TaskFormDraft>(() => ({
    title: prefilledTaskTitle,
    priority: prefilledTaskPriority,
    dueDate,
    description: prefilledTaskDesc,
    assignedUserId,
    notifyAssignee,
  }), [
    assignedUserId,
    dueDate,
    notifyAssignee,
    prefilledTaskDesc,
    prefilledTaskPriority,
    prefilledTaskTitle,
  ]);
  const restoreTaskDraft = React.useCallback((draft: TaskFormDraft) => {
    setPrefilledTaskTitle(draft.title);
    setPrefilledTaskPriority(draft.priority);
    setDueDate(draft.dueDate);
    setPrefilledTaskDesc(draft.description);
    setAssignedUserId(draft.assignedUserId);
    setNotifyAssignee(draft.notifyAssignee);
  }, [
    setPrefilledTaskDesc,
    setPrefilledTaskPriority,
    setPrefilledTaskTitle,
  ]);
  const {
    restored: taskDraftRestored,
    clear: clearTaskDraft,
  } = useFormDraft({
    formId: 'task-create',
    userId: currentUsername,
    value: taskDraft,
    isMeaningful: taskDraftIsMeaningful,
    onRestore: restoreTaskDraft,
  });
  React.useEffect(() => {
    let active = true;
    setLoadingRecipients(true);
    fetch('/api/org/members').then(response => response.ok ? response.json() : { members: [] }).then((memberPayload) => {
      if (!active) return;
      const nextMembers = Array.isArray(memberPayload.members) ? memberPayload.members as TaskTeamMember[] : [];
      setMembers(nextMembers);
      setAssignedUserId(current => current || (
        nextMembers.some(member => member.username === currentUsername)
          ? currentUsername
          : nextMembers[0]?.username || ''
      ));
    }).catch(() => {
      if (!active) return;
      setMembers([]);
    }).finally(() => {
      if (active) setLoadingRecipients(false);
    });
    return () => { active = false; };
  }, [currentUsername]);

  React.useEffect(() => {
    setNotifyAssignee(canNotifyAssignee);
  }, [assignedUserId, canNotifyAssignee]);

  React.useEffect(() => {
    if (!focusTaskId) return;
    const taskElement = document.getElementById(`task-${focusTaskId}`);
    taskElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    taskElement?.focus({ preventScroll: true });
  }, [focusTaskId, tasks]);

  const sendTaskNotification = async (task: Task, assigneeUsername: string, isRetry = false) => {
    if (!assigneeUsername || sendingNotificationTaskIds.has(task.id)) return;
    setSendingNotificationTaskIds(current => new Set(current).add(task.id));
    onUpdateTaskNotification?.(task.id, {
      status: 'sending',
      deliveries: task.notification?.deliveries,
      updatedAt: new Date().toISOString(),
    });
    try {
      const response = await fetch('/api/notifications/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigneeUsername,
          task: {
            id: task.id,
            title: task.title,
            priority: task.priority,
            dueDate: task.dueDate,
            description: task.description,
            assignedUserId: assigneeUsername,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      const status = ['sent', 'partial', 'failed'].includes(payload.status)
        ? payload.status as NonNullable<Task['notification']>['status']
        : response.ok ? 'sent' : 'failed';
      const deliveries = Array.isArray(payload.deliveries)
        ? payload.deliveries.filter((delivery: any) => (
          ['email', 'push'].includes(delivery?.channel)
          && ['sending', 'sent', 'failed'].includes(delivery?.status)
        ))
        : [];
      onUpdateTaskNotification?.(task.id, {
        status,
        deliveries,
        updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
        ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
      });
      if (!response.ok) {
        const message = typeof payload.error === 'string' ? payload.error : 'Task notification failed.';
        setToastMessage?.(isKa
          ? `${isRetry ? 'დავალების შეტყობინება' : 'დავალება დაემატა, მაგრამ შეტყობინება'} ვერ გაიგზავნა: ${message}`
          : `${isRetry ? 'Task notification' : 'Task added, but its notification'} failed: ${message}`);
        return;
      }
      setToastMessage?.(isKa
        ? (isRetry ? 'დავალების შეტყობინება ხელახლა გაიგზავნა.' : 'დავალება დაემატა და შეტყობინება გაიგზავნა.')
        : (isRetry ? 'Task notification retried.' : 'Task added and notification sent.'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Task notification failed.';
      onUpdateTaskNotification?.(task.id, {
        status: 'failed',
        deliveries: task.notification?.deliveries,
        error: message.slice(0, 300),
        updatedAt: new Date().toISOString(),
      });
      setToastMessage?.(isKa
        ? `${isRetry ? 'დავალების შეტყობინება' : 'დავალება დაემატა, მაგრამ შეტყობინება'} ვერ გაიგზავნა: ${message}`
        : `${isRetry ? 'Task notification' : 'Task added, but its notification'} failed: ${message}`);
    } finally {
      setSendingNotificationTaskIds(current => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canCreateTask) return;
    const form = e.currentTarget;
    const formData = new FormData(form);
    const title = formData.get('title') as string;
    const priority = formData.get('priority') as 'high' | 'medium' | 'low';
    const description = formData.get('description') as string;
    if (title.trim()) {
      const createdTask = onAddNewTask(title, priority, dueDate, description, {
        assignedUserId: selectedMember?.username,
        assignedTo: selectedMember?.fullName || (isKa ? 'დაუნიშნავი' : 'Unassigned'),
        notifyAssignee: notifyAssignee && canNotifyAssignee,
      });
      if (createdTask && notifyAssignee && canNotifyAssignee && selectedMember) {
        void sendTaskNotification(createdTask, selectedMember.username);
      }
      if (createdTask) {
        clearTaskDraft();
        form.reset();
        setPrefilledTaskTitle('');
        setPrefilledTaskPriority('medium');
        setDueDate('');
        setPrefilledTaskDesc('');
      }
    }
  };

  const handleToggleTaskStatus = (id: string) => {
    toggleTaskStatusIfAllowed(canUpdateTask, onToggleTaskStatus, id);
  };

  const handleDeleteTask = (id: string) => {
    if (!canDeleteTask) return;
    onDeleteTask(id);
  };

  return (
    <div className="space-y-6 animate-fade-in text-stone-800">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-[#e8dfd5] pb-4 gap-3">
        <div>
          <h3 className="text-lg font-serif font-black text-[#4e0e15] flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-[#801323]" />
            {t.tasks}
          </h3>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 bg-rose-50 border border-rose-200/50 rounded-lg text-center">
            <span className="text-[9px] text-rose-800 font-mono uppercase font-bold block">{isKa ? 'აქტიური' : 'Active'}</span>
            <strong className="text-sm font-serif font-bold text-rose-700 block">{tasks.filter(t => t.status === 'pending').length}</strong>
          </div>
          <div className="px-3 py-1.5 bg-emerald-50 border border-emerald-150 rounded-lg text-center">
            <span className="text-[9px] text-emerald-800 font-mono uppercase font-bold block">{isKa ? 'დასრულებული' : 'Finished'}</span>
            <strong className="text-sm font-serif font-bold text-emerald-600 block">{tasks.filter(t => t.status === 'completed').length}</strong>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task Form */}
        {canCreateTask && (
          <div className="lg:col-span-1 bg-white border border-[#e8dfd5] p-5 rounded-xl h-fit shadow-xs space-y-4">
            <h4 className="font-serif font-bold text-sm text-[#4e0e15] border-b border-stone-100 pb-2">{isKa ? 'მარნის დავალების დაგეგმვა' : 'Schedule Cellar Task'}</h4>
            {taskDraftRestored && (
              <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-900">
                {isKa ? 'შენახული დავალების პროექტი აღდგა.' : 'Your saved task draft was restored.'}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs text-stone-600 font-sans">
              <div>
                <label htmlFor="task-title" className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{isKa ? 'დავალების სათაური *' : 'Task Title *'}</label>
                <input
                  id="task-title"
                  type="text"
                  name="title"
                  value={prefilledTaskTitle}
                  onChange={(e) => setPrefilledTaskTitle(e.target.value)}
                  placeholder={isKa ? 'მაგ. გადატუმბვა, პარტია CS-2025-01' : 'e.g. Pumpover Lot CS-2025-01'}
                  className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2.5 py-2 text-stone-800 focus:outline-[#801323] outline-none text-xs"
                  required
                />
              </div>

              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="task-priority" className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{isKa ? 'პრიორიტეტი' : 'Priority'}</label>
                    <select
                      id="task-priority"
                      name="priority"
                      value={prefilledTaskPriority}
                      onChange={(e) => setPrefilledTaskPriority(e.target.value as any)}
                      className="w-full bg-white border border-[#e8dfd5] rounded px-2.5 py-1.5 text-stone-700 outline-none text-xs"
                    >
                      <option value="high">🔴 {isKa ? 'მაღალი პრიორიტეტი' : 'High Priority'}</option>
                      <option value="medium">🟡 {isKa ? 'საშუალო პრიორიტეტი' : 'Medium Priority'}</option>
                      <option value="low">⚪ {isKa ? 'დაბალი პრიორიტეტი' : 'Low Priority'}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="task-due-date" className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{isKa ? 'ვადა' : 'Due Date'}</label>
                    <DateInput
                      id="task-due-date"
                      name="dueDate"
                      lang={lang}
                      value={dueDate}
                      onValueChange={setDueDate}
                      className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2 py-1 text-stone-700 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="task-assignee" className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">
                  {isKa ? 'პასუხისმგებელი პირი' : 'Assignee'}
                </label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
                  <select
                    id="task-assignee"
                    value={assignedUserId}
                    onChange={(event) => setAssignedUserId(event.target.value)}
                    disabled={loadingRecipients || members.length === 0}
                    className="w-full bg-white border border-[#e8dfd5] rounded-lg py-2 pl-8 pr-2 text-stone-700 outline-none text-xs disabled:bg-stone-50 disabled:text-stone-400"
                  >
                    {members.length === 0 && (
                      <option value="">{loadingRecipients ? (isKa ? 'იტვირთება…' : 'Loading…') : (isKa ? 'გუნდის წევრები ვერ მოიძებნა' : 'No team members found')}</option>
                    )}
                    {members.map(member => (
                      <option key={member.username} value={member.username}>
                        {member.fullName} · {member.role}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={`rounded-lg border px-3 py-2.5 ${canNotifyAssignee ? 'border-sky-200 bg-sky-50/60' : 'border-stone-200 bg-stone-50'}`}>
                <label className={`flex items-start gap-2 ${canNotifyAssignee ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                  <input
                    type="checkbox"
                    checked={notifyAssignee && canNotifyAssignee}
                    onChange={(event) => setNotifyAssignee(event.target.checked)}
                    disabled={!canNotifyAssignee}
                    className="mt-0.5 h-4 w-4 accent-sky-700"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 font-bold text-stone-700">
                      <BellRing className="h-3.5 w-3.5 text-sky-700" aria-hidden="true" />
                      {isKa ? 'პასუხისმგებელი პირის შეტყობინება' : 'Notify the assignee'}
                    </span>
                    <span className="mt-0.5 block text-[9.5px] leading-relaxed text-stone-500">
                      {!selectedMember
                        ? (isKa ? 'ჯერ აირჩიეთ გუნდის წევრი.' : 'Select a team member first.')
                        : !canNotifyAssignee
                          ? (isKa ? 'არჩეულ წევრს ელფოსტა და Push შეტყობინებები გამორთული აქვს.' : 'The selected member has email and push notifications turned off.')
                          : (isKa
                            ? `გაიგზავნება: ${selectedChannels.join(' + ')}.`
                            : `Will send via ${selectedChannels.join(' + ')}.`)}
                    </span>
                  </span>
                </label>
              </div>

              <div>
                <label htmlFor="task-description" className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{isKa ? 'აღწერა / დეტალები' : 'Description / Details'}</label>
                <textarea
                  id="task-description"
                  name="description"
                  value={prefilledTaskDesc}
                  onChange={(e) => setPrefilledTaskDesc(e.target.value)}
                  placeholder={isKa ? 'მაგ. დღეში 2-ჯერ გადატუმბვა, შაქრის სიმკვრივის შემოწმება.' : 'e.g. Pump grape cap 2x daily, check sugar density readings.'}
                  className="w-full bg-white border border-[#e8dfd5] rounded-lg p-2.5 h-20 text-stone-800 focus:outline-[#801323] outline-none text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white py-2 rounded-lg font-bold uppercase transition-all duration-200 cursor-pointer text-xs"
              >
                {isKa ? 'დავალების მინიჭება' : 'Assign Task Directive'}
              </button>
            </form>
          </div>
        )}

        {/* Task List */}
        <div className={`${canCreateTask ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-4`}>
          {!canCreateTask && (
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs font-medium text-stone-500" role="note">
              {isKa
                ? 'თქვენ შეგიძლიათ დავალებების ნახვა, მაგრამ ახალი დავალების შექმნის უფლება არ გაქვთ.'
                : 'You can browse cellar tasks, but your role cannot create new tasks.'}
            </div>
          )}
          <div className="bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-4">
            <h4 className="font-serif font-bold text-sm text-[#4e0e15] flex items-center justify-between">
              <span>{isKa ? 'მიმდინარე დავალებები' : 'Pending Directives'}</span>
              <span className="text-[10px] font-mono text-slate-400 font-normal">{tasks.filter(t => t.status === 'pending').length} {isKa ? 'დარჩენილი დავალება' : 'tasks remaining'}</span>
            </h4>

            <div className="space-y-3">
              {tasks.filter(t => t.status === 'pending').map((task) => (
                <div
                  key={task.id}
                  id={`task-${task.id}`}
                  tabIndex={-1}
                  className={`p-4 border rounded-xl hover:bg-stone-50/40 transition-all flex justify-between items-start gap-3 focus:outline-none focus:ring-2 focus:ring-[#801323] ${
                    focusTaskId === task.id ? 'border-[#801323] bg-rose-50/40' : 'border-stone-100'
                  }`}
                >
                  <div className="flex gap-3 items-start">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => handleToggleTaskStatus(task.id)}
                      disabled={!canUpdateTask}
                      aria-label={canUpdateTask ? (isKa ? `${task.title} — დასრულებულად მონიშვნა` : `Mark ${task.title} completed`) : (isKa ? `${task.title} — თქვენს როლს ვერ განაახლებს` : `${task.title} cannot be updated by your role`)}
                      title={canUpdateTask ? (isKa ? 'დავალების დასრულებულად მონიშვნა' : 'Mark task completed') : (isKa ? 'თქვენს როლს დავალებების განახლება არ შეუძლია' : 'Your role cannot update tasks')}
                      className={`mt-1 accent-[#4e0e15] w-4 h-4 shrink-0 ${canUpdateTask ? 'cursor-pointer' : 'cursor-not-allowed opacity-45'}`}
                    />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded-sm font-bold ${
                          task.priority === 'high' ? 'bg-rose-100 text-rose-800' :
                          task.priority === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-500'
                        }`}>
                          {task.priority === 'high' ? (isKa ? '🔴 მაღალი' : '🔴 High') : task.priority === 'medium' ? (isKa ? '🟡 საშუალო' : '🟡 Medium') : (isKa ? '⚪ დაბალი' : '⚪ Low')}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{isKa ? 'ვადა' : 'Due'}: {task.dueDate}</span>
                      </div>
                      <h5 className="font-bold text-stone-800 text-xs mt-1.5 leading-snug">{task.title}</h5>
                      {task.description && <p className="text-xs text-stone-550 mt-1 leading-relaxed">{task.description}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[9.5px] font-semibold text-stone-500">
                        <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" aria-hidden="true" /> {task.assignedTo || (isKa ? 'დაუნიშნავი' : 'Unassigned')}</span>
                        {task.notification && (
                          <span
                            title={task.notification.error}
                            className={`inline-flex items-center gap-1 ${
                              task.notification.status === 'sent'
                                ? 'text-emerald-700'
                                : task.notification.status === 'failed'
                                  ? 'text-rose-600'
                                  : 'text-amber-700'
                            }`}
                          >
                            <BellRing className="h-3 w-3" aria-hidden="true" />
                            {task.notification.status === 'sent'
                              ? (isKa ? 'შეტყობინება გაგზავნილია' : 'Notification sent')
                              : task.notification.status === 'partial'
                                ? (isKa ? 'ნაწილობრივ გაიგზავნა' : 'Partially sent')
                                : task.notification.status === 'failed'
                                  ? (isKa ? 'შეტყობინება ვერ გაიგზავნა' : 'Notification failed')
                                  : (isKa ? 'შეტყობინება იგზავნება' : 'Notification sending')}
                          </span>
                        )}
                        {task.notification?.deliveries?.map(delivery => (
                          <span
                            key={delivery.channel}
                            title={delivery.error}
                            className={`inline-flex items-center gap-1 ${delivery.status === 'sent' ? 'text-emerald-700' : 'text-rose-600'}`}
                          >
                            {delivery.channel === 'email'
                              ? <Mail className="h-3 w-3" aria-hidden="true" />
                              : <BellRing className="h-3 w-3" aria-hidden="true" />}
                            {delivery.channel === 'email' ? 'Email' : 'Push'}
                          </span>
                        ))}
                        {['failed', 'partial'].includes(task.notification?.status || '')
                          && task.assignedUserId
                          && canCreateTask && (
                            <button
                              type="button"
                              onClick={() => void sendTaskNotification(task, task.assignedUserId!, true)}
                              disabled={sendingNotificationTaskIds.has(task.id)}
                              className="rounded-md border border-rose-200 px-2 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50"
                            >
                              {isKa ? 'ხელახლა გაგზავნა' : 'Retry notification'}
                            </button>
                          )}
                      </div>
                    </div>
                  </div>

                  {canDeleteTask && (
                    <button
                      type="button"
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-1 text-stone-300 hover:text-rose-600 transition-colors cursor-pointer shrink-0"
                      title={isKa ? 'დავალების წაშლა' : 'Delete Task'}
                      aria-label={isKa ? `${task.title} — წაშლა` : `Delete ${task.title}`}
                    >
                      <Trash className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}

              {tasks.filter(t => t.status === 'pending').length === 0 && (
                <div className="text-center py-10 text-[#4e0e15]/40 italic font-mono text-xs">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
                  {isKa ? 'ყველა დავალება შესრულებულია! მარანი მოწესრიგებულია.' : 'All cellar directives completed! Cellar sanitation is stellar.'}
                </div>
              )}
            </div>
          </div>

          {tasks.filter(t => t.status === 'completed').length > 0 && (
            <div className="bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-3">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block font-semibold">{isKa ? 'დასრულებულის არქივი' : 'Completed Records Archive'}</span>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {tasks.filter(t => t.status === 'completed').map(task => (
                  <div key={task.id} className="flex justify-between items-center text-xs bg-stone-50 px-3.5 py-2.5 rounded-lg border border-stone-200/60 text-slate-400">
                    <div className="flex items-center gap-2 line-through">
                      <span className="font-medium">{task.title}</span>
                      <span className="text-[9px] font-mono">({task.dueDate})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleTaskStatus(task.id)}
                        disabled={!canUpdateTask}
                        aria-label={isKa ? `${task.title} — ხელახლა გახსნა` : `Reopen ${task.title}`}
                        title={canUpdateTask ? (isKa ? 'დავალების ხელახლა გახსნა' : 'Reopen task') : (isKa ? 'თქვენს როლს დავალებების განახლება არ შეუძლია' : 'Your role cannot update tasks')}
                        className={`text-[10px] underline ${canUpdateTask ? 'text-stone-400 hover:text-[#4e0e15] cursor-pointer' : 'text-stone-300 cursor-not-allowed no-underline'}`}
                      >
                        {isKa ? 'ხელახლა გახსნა' : 'Reopen'}
                      </button>
                      {canDeleteTask && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTask(task.id)}
                          className="text-stone-300 hover:text-rose-600 transition-colors cursor-pointer"
                          aria-label={isKa ? `${task.title} — წაშლა` : `Delete ${task.title}`}
                          title={isKa ? 'დავალების წაშლა' : 'Delete Task'}
                        >
                          <Trash className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(TasksTab);
