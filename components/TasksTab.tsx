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
  setPrefilledTaskDesc = () => {}
}: TasksTabProps) {
  const t = translations[lang];

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
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

  return (
    <div className="space-y-6 animate-fade-in text-stone-800">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-[#e8dfd5] pb-4 gap-3">
        <div>
          <h3 className="text-lg font-serif font-black text-[#4e0e15] flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-[#801323]" />
            {t.tasks}
          </h3>
          <p className="text-xs text-slate-400">Track winemaker schedule, priority corrections, and cellar activities</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 bg-rose-50 border border-rose-200/50 rounded-lg text-center">
            <span className="text-[9px] text-rose-800 font-mono uppercase font-bold block">Active</span>
            <strong className="text-sm font-serif font-bold text-rose-700 block">{tasks.filter(t => t.status === 'pending').length}</strong>
          </div>
          <div className="px-3 py-1.5 bg-emerald-50 border border-emerald-150 rounded-lg text-center">
            <span className="text-[9px] text-emerald-800 font-mono uppercase font-bold block">Finished</span>
            <strong className="text-sm font-serif font-bold text-emerald-600 block">{tasks.filter(t => t.status === 'completed').length}</strong>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task Form */}
        <div className="lg:col-span-1 bg-white border border-[#e8dfd5] p-5 rounded-xl h-fit shadow-xs space-y-4">
          <h4 className="font-serif font-bold text-sm text-[#4e0e15] border-b border-stone-100 pb-2">Schedule Cellar Task</h4>
          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs text-stone-600 font-sans">
            <div>
              <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Task Title *</label>
              <input 
                type="text" 
                name="title"
                value={prefilledTaskTitle}
                onChange={(e) => setPrefilledTaskTitle(e.target.value)}
                placeholder="e.g. Pumpover Lot CS-2025-01"
                className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2.5 py-2 text-stone-800 focus:outline-[#801323] outline-none text-xs"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Priority</label>
                <select 
                  name="priority"
                  value={prefilledTaskPriority}
                  onChange={(e) => setPrefilledTaskPriority(e.target.value as any)}
                  className="w-full bg-white border border-[#e8dfd5] rounded px-2.5 py-1.5 text-stone-700 outline-none text-xs"
                >
                  <option value="high">🔴 High Priority</option>
                  <option value="medium">🟡 Medium Priority</option>
                  <option value="low">⚪ Low Priority</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Due Date</label>
                <input 
                  type="date" 
                  name="dueDate"
                  className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2 py-1 text-stone-700 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Description / Details</label>
              <textarea 
                name="description"
                value={prefilledTaskDesc}
                onChange={(e) => setPrefilledTaskDesc(e.target.value)}
                placeholder="e.g. Pump grape cap 2x daily, check sugar density readings."
                className="w-full bg-white border border-[#e8dfd5] rounded-lg p-2.5 h-20 text-stone-800 focus:outline-[#801323] outline-none text-xs"
              />
            </div>

            <button 
              type="submit"
              className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white py-2 rounded-lg font-bold uppercase transition-all duration-200 cursor-pointer text-xs"
            >
              Assign Task Directive
            </button>
          </form>
        </div>

        {/* Task List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-4">
            <h4 className="font-serif font-bold text-sm text-[#4e0e15] flex items-center justify-between">
              <span>Pending Directives</span>
              <span className="text-[10px] font-mono text-slate-400 font-normal">{tasks.filter(t => t.status === 'pending').length} tasks remaining</span>
            </h4>

            <div className="space-y-3">
              {tasks.filter(t => t.status === 'pending').map((task) => (
                <div key={task.id} className="p-4 border border-stone-100 rounded-xl hover:bg-stone-50/40 transition-all flex justify-between items-start gap-3">
                  <div className="flex gap-3 items-start">
                    <input 
                      type="checkbox" 
                      checked={false}
                      onChange={() => onToggleTaskStatus(task.id)}
                      className="mt-1 cursor-pointer accent-[#4e0e15] w-4 h-4 shrink-0"
                    />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded-sm font-bold ${
                          task.priority === 'high' ? 'bg-rose-100 text-rose-800' : 
                          task.priority === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-500'
                        }`}>
                          {task.priority === 'high' ? '🔴 High' : task.priority === 'medium' ? '🟡 Medium' : '⚪ Low'}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">Due: {task.dueDate}</span>
                      </div>
                      <h5 className="font-bold text-stone-800 text-xs mt-1.5 leading-snug">{task.title}</h5>
                      {task.description && <p className="text-xs text-stone-550 mt-1 leading-relaxed">{task.description}</p>}
                    </div>
                  </div>

                  <button 
                    onClick={() => onDeleteTask(task.id)}
                    className="p-1 text-stone-300 hover:text-rose-600 transition-colors cursor-pointer shrink-0"
                    title="Delete Task"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              ))}

              {tasks.filter(t => t.status === 'pending').length === 0 && (
                <div className="text-center py-10 text-[#4e0e15]/40 italic font-mono text-xs">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
                  All cellar directives completed! Cellar sanitation is stellar.
                </div>
              )}
            </div>
          </div>

          {tasks.filter(t => t.status === 'completed').length > 0 && (
            <div className="bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-3">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block font-semibold">Completed Records Archive</span>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {tasks.filter(t => t.status === 'completed').map(task => (
                  <div key={task.id} className="flex justify-between items-center text-xs bg-stone-50 px-3.5 py-2.5 rounded-lg border border-stone-200/60 text-slate-400">
                    <div className="flex items-center gap-2 line-through">
                      <span className="font-medium">{task.title}</span>
                      <span className="text-[9px] font-mono">({task.dueDate})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => onToggleTaskStatus(task.id)}
                        className="text-stone-400 hover:text-[#4e0e15] text-[10px] underline"
                      >
                        Reopen
                      </button>
                      <button 
                        onClick={() => onDeleteTask(task.id)}
                        className="text-stone-300 hover:text-rose-600 transition-colors"
                      >
                        <Trash className="w-3.5 h-3.5" />
                      </button>
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
