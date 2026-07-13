import React from 'react';
import { ClipboardList, CheckCircle2, Trash } from 'lucide-react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import type { Task } from '../lib/wineryState';

interface TasksTabProps {
  lang: Language;
  tasks: Task[];
  onToggleTaskStatus: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onAddNewTask: (title: string, priority: 'high' | 'medium' | 'low', dueDate: string, description: string) => void;
  prefilledTaskTitle?: string;
  setPrefilledTaskTitle?: (title: string) => void;
  prefilledTaskPriority?: 'high' | 'medium' | 'low';
  setPrefilledTaskPriority?: (priority: 'high' | 'medium' | 'low') => void;
  prefilledTaskDesc?: string;
  setPrefilledTaskDesc?: (desc: string) => void;
  canCreateTask?: boolean;
  canUpdateTask?: boolean;
  canDeleteTask?: boolean;
}

export default function TasksTab({
  lang,
  tasks,
  onToggleTaskStatus,
  onDeleteTask,
  onAddNewTask,
  prefilledTaskTitle = '',
  setPrefilledTaskTitle = () => {},
  prefilledTaskPriority = 'medium',
  setPrefilledTaskPriority = () => {},
  prefilledTaskDesc = '',
  setPrefilledTaskDesc = () => {},
  canCreateTask = true,
  canUpdateTask = true,
  canDeleteTask = true
}: TasksTabProps) {
  const t = translations[lang];
  const isKa = lang === 'ka';

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canCreateTask) return;
    const form = e.currentTarget;
    const formData = new FormData(form);
    const title = formData.get('title') as string;
    const priority = formData.get('priority') as 'high' | 'medium' | 'low';
    const dueDate = formData.get('dueDate') as string;
    const description = formData.get('description') as string;
    if (title.trim()) {
      onAddNewTask(title, priority, dueDate, description);
      form.reset();
      setPrefilledTaskTitle('');
      setPrefilledTaskPriority('medium');
      setPrefilledTaskDesc('');
    }
  };

  const handleToggleTaskStatus = (id: string) => {
    if (!canUpdateTask) return;
    onToggleTaskStatus(id);
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
          <p className="text-xs text-slate-400">{isKa ? 'აკონტროლეთ მეღვინის გრაფიკი, პრიორიტეტული კორექტირებები და მარნის საქმიანობა' : 'Track winemaker schedule, priority corrections, and cellar activities'}</p>
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
            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs text-stone-600 font-sans">
              <div>
                <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{isKa ? 'დავალების სათაური *' : 'Task Title *'}</label>
                <input
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
                    <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{isKa ? 'პრიორიტეტი' : 'Priority'}</label>
                    <select
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
                    <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{isKa ? 'ვადა' : 'Due Date'}</label>
                    <input
                      type="date"
                      name="dueDate"
                      className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2 py-1 text-stone-700 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{isKa ? 'აღწერა / დეტალები' : 'Description / Details'}</label>
                <textarea
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
                <div key={task.id} className="p-4 border border-stone-100 rounded-xl hover:bg-stone-50/40 transition-all flex justify-between items-start gap-3">
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
