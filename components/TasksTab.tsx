import { useState } from 'react';
import { translations, Language } from '@/lib/i18n';
import { CellarTask, Tank, AuditLog } from '@/lib/services/db';
import { formatDate, formatDateTime } from '@/lib/utils';
import { 
  ClipboardList, Plus, CheckCircle2, Circle, AlertCircle, Wrench, Sparkles, Trash 
} from 'lucide-react';

interface TasksTabProps {
  lang: Language;
  tasks: CellarTask[];
  tanks: Tank[];
  auditLogs: AuditLog[];
  onAddTask: (task: Omit<CellarTask, 'id'>) => void;
  onCompleteTask: (id: string) => void;
  onRecordCleaning: (eqId: string, eqType: 'tank' | 'pump' | 'hose' | 'press') => void;
}

export default function TasksTab({
  lang,
  tasks,
  tanks,
  auditLogs,
  onAddTask,
  onCompleteTask,
  onRecordCleaning
}: TasksTabProps) {
  const t = translations[lang];

  // Tab state: Tasks vs Sanitation Wash
  const [subTab, setSubTab] = useState<'tasks' | 'sanitation'>('tasks');

  // Input fields for task creation
  const [taskTitle, setTaskTitle] = useState('');
  const [priority, setPriority] = useState<'critical' | 'high' | 'medium' | 'low'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  // Sanitation wash states
  const [washEquipmentId, setWashEquipmentId] = useState('pump');
  const [washType, setWashType] = useState<'tank' | 'pump' | 'hose' | 'press'>('pump');
  const [sanitizeMsg, setSanitizeMsg] = useState('');

  const handleAddTaskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle) return;

    onAddTask({
      title: taskTitle,
      status: 'pending',
      priority,
      dueDate: dueDate || new Date().toISOString().split('T')[0],
      notes,
      assignedTo: 'Luka Tatrishvili',
      relatedType: 'general',
      relatedId: ''
    });

    setTaskTitle('');
    setNotes('');
  };

  const handleWashSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Trigger cleaning sequence
    onRecordCleaning(washEquipmentId, washType);
    setSanitizeMsg(`Sanitation washing successfully logged for equipment ID: ${washEquipmentId} (${washType})!`);
    
    setTimeout(() => {
      setSanitizeMsg('');
    }, 4000);
  };

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case 'critical': return 'bg-red-100 text-red-800 font-bold';
      case 'high': return 'bg-orange-100 text-orange-800 font-bold';
      case 'medium': return 'bg-amber-100 text-amber-800';
      default: return 'bg-stone-100 text-gray-500';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-[#EBE5D8] pb-4">
        <div>
          <h3 className="text-lg font-bold font-sans text-gray-800 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-[#722F37]" />
            Cellar Tasks & Sanitizing wash checklist
          </h3>
          <p className="text-xs text-gray-400">Biological hygiene management, schedule tracking, and operational task priority checks</p>
        </div>

        <div className="flex bg-stone-100 p-1 rounded-lg text-xs font-mono font-bold">
          <button 
            onClick={() => setSubTab('tasks')}
            className={`px-3 py-1.5 rounded-md cursor-pointer ${subTab === 'tasks' ? 'bg-white text-gray-800 shadow-xs' : 'text-gray-400 hover:text-gray-700'}`}
          >
            Winemaker Tasks
          </button>
          <button 
            onClick={() => setSubTab('sanitation')}
            className={`px-3 py-1.5 rounded-md cursor-pointer ${subTab === 'sanitation' ? 'bg-white text-gray-800 shadow-xs' : 'text-gray-400 hover:text-gray-700'}`}
          >
            Hygienic Sanitation Wash
          </button>
        </div>
      </div>

      {subTab === 'tasks' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Add task form */}
          <div className="lg:col-span-1 bg-white border border-[#EBE5D8] p-5 rounded-xl h-fit shadow-xs space-y-4">
            <h4 className="font-semibold text-gray-800 text-xs font-mono uppercase tracking-wider text-rose-700">Schedule Cellar Task</h4>
            
            <form onSubmit={handleAddTaskSubmit} className="space-y-3 text-xs text-gray-600">
              <div>
                <label className="text-[10px] uppercase font-mono block mb-1">Task Title *</label>
                <input 
                  type="text" 
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  placeholder="e.g. Pumpover Lot L-SAP24 in Tank-1"
                  className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden text-gray-800"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-mono block mb-1">Priority</label>
                  <select 
                    value={priority}
                    onChange={e => setPriority(e.target.value as any)}
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High priority</option>
                    <option value="medium">Medium schedule</option>
                    <option value="low">Low index</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-mono block mb-1">Due Date</label>
                  <input 
                    type="date" 
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-mono block mb-1">Manipulations & Notes</label>
                <textarea 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Describe standard enology procedures..."
                  className="w-full bg-white border border-[#EBE5D8] rounded-lg p-2 h-16"
                />
              </div>

              <button 
                type="submit"
                className="w-full bg-[#1E3F20] text-white py-2 rounded-lg font-bold uppercase hover:bg-opacity-95 cursor-pointer text-xs"
              >
                Assign Task Directives
              </button>
            </form>
          </div>

          {/* Core Tasks list */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-[#EBE5D8] p-5 shadow-xs space-y-4">
            <h4 className="font-semibold text-gray-800 text-sm">Pragmatic Task Board</h4>

            <div className="space-y-3">
              {tasks.filter(t => t.status === 'pending').map((task) => (
                <div key={task.id} className="p-4 border border-stone-100 rounded-xl hover:bg-stone-50/40 transition-all flex justify-between items-start gap-3">
                  <div className="flex gap-2.5 items-start">
                    <button 
                      onClick={() => onCompleteTask(task.id)}
                      className="text-stone-300 hover:text-green-600 transition-colors mt-0.5 cursor-pointer"
                    >
                      <Circle className="h-5 w-5 shrink-0" />
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] uppercase font-mono px-2 py-0.2 rounded-sm ${getPriorityBadge(task.priority)}`}>
                          {task.priority}
                        </span>
                        <span className="text-[10px] font-mono text-gray-400">Due: {formatDate(task.dueDate)}</span>
                      </div>
                      <h5 className="font-semibold text-gray-800 text-xs mt-1.5 leading-snug">{task.title}</h5>
                      {task.notes && <p className="text-[11px] text-gray-400 italic mt-1 leading-relaxed">{task.notes}</p>}
                    </div>
                  </div>

                  <span className="text-[9px] font-mono text-gray-400 select-none whitespace-nowrap bg-stone-50 border px-1.5 py-0.2 rounded">
                    Assignee: {task.assignedTo || 'Luka'}
                  </span>
                </div>
              ))}

              {tasks.filter(t => t.status === 'pending').length === 0 && (
                <div className="text-center py-10 text-gray-400 italic font-mono text-xs">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
                  All cellar directives completed! Keep hygiene spotless.
                </div>
              )}
            </div>

            {/* Completed section */}
            {tasks.filter(t => t.status === 'completed').length > 0 && (
              <div className="pt-4 border-t border-stone-100 space-y-2">
                <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider block">Finished Records Ledger</span>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {tasks.filter(t => t.status === 'completed').map(task => (
                    <div key={task.id} className="flex justify-between items-center text-[11px] bg-stone-50 p-2 rounded border border-stone-100/60 line-through text-gray-400">
                      <span>{task.title}</span>
                      <span className="text-[9px] font-mono text-emerald-600 font-bold uppercase bg-emerald-50 px-1 rounded-xs">Verified</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Action washing form */}
          <div className="lg:col-span-1 bg-white border border-[#EBE5D8] p-5 rounded-xl h-fit shadow-xs space-y-4">
            <h4 className="font-semibold text-gray-800 text-xs font-mono uppercase tracking-wider text-green-700">Record Equipment Sanitation</h4>
            
            {sanitizeMsg && (
              <div className="p-3 bg-green-50 text-green-800 rounded-lg text-xs font-mono border-l-4 border-green-500">
                {sanitizeMsg}
              </div>
            )}

            <form onSubmit={handleWashSubmit} className="space-y-3 text-xs text-gray-600 font-sans">
              <div>
                <label className="text-[10px] uppercase font-mono block mb-1">Equipment Category</label>
                <select 
                  value={washType}
                  onChange={e => {
                    setWashType(e.target.value as any);
                    if (e.target.value === 'tank') setWashEquipmentId('Tank T-101');
                    else setWashEquipmentId(e.target.value + '-1');
                  }}
                  className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden"
                >
                  <option value="pump">Cellar Must Pump</option>
                  <option value="hose">Transfer Hoses / Lines</option>
                  <option value="press">Pneumatic Press</option>
                  <option value="tank">Storage Tank / Vessel</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase font-mono block mb-1">Equipment Identifier / Code *</label>
                {washType === 'tank' ? (
                  <select 
                    value={washEquipmentId}
                    onChange={e => setWashEquipmentId(e.target.value)}
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden"
                  >
                    {tanks.map(tk => (
                      <option key={tk.id} value={tk.id}>{tk.name} ({tk.type})</option>
                    ))}
                  </select>
                ) : (
                  <input 
                    type="text" 
                    value={washEquipmentId}
                    onChange={e => setWashEquipmentId(e.target.value)}
                    placeholder="e.g. Pump-Premium-SS"
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden"
                    required
                  />
                )}
              </div>

              <div className="bg-[#FDFBF7] p-3.5 rounded-lg border border-[#EBE5D8] text-[11px] leading-relaxed text-gray-500 space-y-1.5">
                <span className="font-bold block text-gray-700">Standard Sanitization Protocol:</span>
                <p>1. Recirculate **1.5% hot caustic solution** (Sodium hydroxide) for 15 minutes to strip pigments/tartrates.</p>
                <p>2. Flush thoroughly with fresh water until neutral pH is hit.</p>
                <p>3. Circulate **1% citric acid solution** to neutralize any residues.</p>
                <p>4. Cold san (Peracetic acid) recirculate immediately before juice transfer.</p>
              </div>

              <button 
                type="submit"
                className="w-full bg-[#1E3F20] text-white py-2 rounded-lg font-bold uppercase hover:bg-opacity-95 cursor-pointer text-xs"
              >
                Certify Clean Wash
              </button>
            </form>
          </div>

          {/* Historical sanitation audits list */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-[#EBE5D8] p-5 shadow-xs space-y-4">
            <h4 className="font-semibold text-gray-800 text-sm"> spots sanitation audit logs</h4>
            
            <div className="overflow-x-auto text-[11px]">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-stone-50 font-mono text-[9px] uppercase text-gray-400 border-b border-[#EBE5D8]">
                    <th className="p-3">Sanitization Date</th>
                    <th className="p-3">Washed Action</th>
                    <th className="p-3">Equip Type</th>
                    <th className="p-3">Ident Code</th>
                    <th className="p-3">Inspector Signature</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.filter(l => l.action.toLowerCase().includes('cleaned') || l.action.toLowerCase().includes('washed') || l.action.toLowerCase().includes('sanitized')).map((log) => (
                    <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50/20 text-xs text-slate-600">
                      <td className="p-3 font-mono text-slate-400 whitespace-nowrap">
                        {formatDateTime(log.timestamp)}
                      </td>
                      <td className="p-3 font-semibold text-slate-750">
                        {log.action}
                      </td>
                      <td className="p-3 text-slate-500 capitalize">
                        {log.details || 'General Equipment'}
                      </td>
                      <td className="p-3 font-mono text-slate-700 italic">
                        {log.relatedId || 'Cellar Equipment'}
                      </td>
                      <td className="p-3 font-medium text-slate-500 whitespace-nowrap">
                        {log.userId || 'Luka Tatrishvili'}
                      </td>
                    </tr>
                  ))}
                  {auditLogs.filter(l => l.action.toLowerCase().includes('cleaned') || l.action.toLowerCase().includes('washed') || l.action.toLowerCase().includes('sanitized')).length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center p-8 text-gray-400 italic font-mono">No equipment sanitizing audits currently on record.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
