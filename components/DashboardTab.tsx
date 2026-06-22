import React from 'react';
import { motion } from 'motion/react';
import { translations, Language } from '../lib/i18n';
import LiveClock from './LiveClock';
import { 
  UserProfile, 
  CompanyProfile, 
  VineyardBlock, 
  WineLot, 
  Vessel, 
  Task, 
  MaraniOSAuditLog 
} from '../lib/wineryState';
import { Wind, Sprout, AlertTriangle, FileText } from 'lucide-react';

interface DashboardTabProps {
  lang: Language;
  companyProfile: CompanyProfile;
  currentUser: UserProfile;
  blocks: VineyardBlock[];
  lots: WineLot[];
  vessels: Vessel[];
  tasks: Task[];
  auditLogs: MaraniOSAuditLog[];
  onToggleTaskStatus: (taskId: string) => void;
  setActiveModule: (mod: 'portal' | 'vazi' | 'gvino' | 'settings' | 'audit') => void;
  setActiveTab: (tab: string) => void;
}

export default function DashboardTab({
  lang,
  companyProfile,
  currentUser,
  blocks,
  lots,
  vessels,
  tasks,
  auditLogs,
  onToggleTaskStatus,
  setActiveModule,
  setActiveTab
}: DashboardTabProps) {
  const t = translations[lang];

  // Derive metrics
  const totalArea = blocks.reduce((acc, b) => acc + b.area, 0);
  const totalCapacity = vessels.reduce((acc, v) => acc + v.capacity, 0);
  const activeFermsCount = lots.filter(l => l.stage === 'fermenting').length;

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col space-y-6 animate-fade-in">
      {/* Main platform Welcome header */}
      <div className="bg-gradient-to-r from-white via-white to-[#fbfaf8] border border-stone-200/90 rounded-2xl p-8 shadow-[0_4px_25px_rgba(78,14,21,0.015)] relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-6 text-stone-800 text-xs">
        {/* Elegant side color-stripe indicator */}
        <div className="absolute top-0 bottom-0 left-0 w-1.5 bg-gradient-to-b from-[#801323] to-[#4e0e15]" />
        
        <div className="space-y-1.5 pl-3">
          <span className="text-[9px] uppercase tracking-widest bg-[#fcf8f6] border border-[#e8dfd5] text-[#4e0e15] px-3.5 py-1 rounded-full font-black inline-block">
            📢 {t.portal_hq || 'Estate Headquarters'}
          </span>
          <h2 className="text-2xl font-serif font-black text-stone-900 tracking-tight uppercase leading-none mt-1">{t.portal_welcome || 'Welcome to MaraniOS'}</h2>
          <p className="text-xs text-stone-550 font-sans mt-1.5">{t.portal_status_p || 'Real-time status indicators across your agricultural blocks & fermentation vats'}</p>
        </div>
        
        <div className="flex flex-wrap gap-2.5 text-[10px] font-mono pl-3 md:pl-0">
          {/* Precision Live Clock */}
          <div className="bg-[#FAF8F5]/85 border border-[#e8dfd5] px-4 py-2.5 rounded-xl text-left shadow-2xs">
            <span className="text-stone-400 block text-[8px] uppercase tracking-widest font-extrabold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-550 animate-pulse inline-block" />
              Oenology Clock
            </span>
            <LiveClock className="text-stone-850 block mt-1 font-mono font-bold text-[11px] text-[#4e0e15]" />
          </div>
          <div className="bg-[#fcfbf9] border border-[#e8dfd5] px-4 py-2.5 rounded-xl text-left">
            <span className="text-stone-400 block text-[8px] uppercase tracking-wider font-extrabold">{t.portal_appellation || 'Active Appellation'}</span>
            <strong className="text-[#c5a059] block mt-0.5 font-serif font-bold">{companyProfile.region != 'Kakheti / Appellation' ? companyProfile.region : (lang === 'ka' ? 'კახეთი / ალაზნის ველი' : companyProfile.region)}, {companyProfile.country === 'Georgia' && lang === 'ka' ? 'საქართველო' : companyProfile.country}</strong>
          </div>
          <div className="bg-[#fcfbf9] border border-[#e8dfd5] px-4 py-2.5 rounded-xl text-left">
            <span className="text-stone-400 block text-[8px] uppercase tracking-wider font-extrabold">{t.portal_role || 'Active Role'}</span>
            <strong className="text-stone-800 block mt-0.5 font-extrabold">
              {currentUser.role === 'Viticulturist' ? (t.signin_role_viticulturist || 'Lead Viticulturist') :
               currentUser.role === 'Winemaker' ? (t.signin_role_winemaker || 'Head Winemaker') :
               (t.signin_role_owner || 'Owner & ERP Admin')}
            </strong>
          </div>
        </div>
      </div>

      {/* Module launch deck bentogrid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-stone-800">
        
        {/* Vazi Module Card */}
        <motion.div 
          whileHover={{ y: -4, shadow: '0 10px 30px rgba(16,185,129,0.06)' }}
          className="p-6 bg-white border border-[#e8dfd5] rounded-3xl shadow-xs duration-300 space-y-4 flex flex-col justify-between relative overflow-hidden group hover:border-emerald-200/80 transition-all cursor-pointer"
        >
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-600/10 via-emerald-600/30 to-emerald-600/10" />
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase font-mono bg-emerald-50 text-emerald-800 px-3 py-1 rounded-full font-black border border-emerald-100">
                ✨ {t.portal_module_agri || 'Agricultural Module'}
              </span>
              <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 font-mono">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                LIVE FROM FIELDS
              </span>
            </div>
            
            <h3 className="text-xl font-serif font-black text-stone-900 leading-tight flex items-center gap-2">🚜 {t.portal_vazi_title || 'Vazi Vineyard Operations'}</h3>
            <p className="text-xs text-stone-550 leading-relaxed font-medium">
              {t.portal_vazi_desc || 'Trace canopy development, heat sum Growing Degree Days predictions, scouting downy/powdery pathogens, and pre-harvest grape sugar maturation curves.'}
            </p>

            {/* Sub-metrics */}
            <div className="grid grid-cols-3 gap-3 border-t border-stone-100 pt-4 font-mono text-[10px] text-stone-550">
              <div>
                <span className="text-[8px] uppercase text-stone-400 block pb-0.5">{t.portal_blocks_count || 'Registered Blocks'}</span>
                <strong className="text-xs text-stone-850 font-bold block mt-0.5">{blocks.length} {lang === 'ka' ? 'ნაკვეთი' : 'Sectors'}</strong>
              </div>
              <div>
                <span className="text-[8px] uppercase text-stone-400 block pb-0.5">{t.portal_total_area || 'Total Area'}</span>
                <strong className="text-xs text-stone-850 font-bold block mt-0.5">{totalArea.toFixed(1)} ha</strong>
              </div>
              <div>
                <span className="text-[8px] uppercase text-stone-400 block pb-0.5 font-bold">{t.portal_scout_status || 'Scouting Reports'}</span>
                <strong className="text-xs text-emerald-800 font-bold block mt-0.5">🌿 {t.portal_scout_healthy || 'Canopy Healthy'}</strong>
              </div>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setActiveModule('vazi')}
            className="w-full mt-4 bg-emerald-850 hover:bg-emerald-950 text-white font-mono font-bold uppercase tracking-wider py-3 rounded-xl cursor-pointer text-xs justify-center flex items-center gap-1 transition-colors shadow-2xs"
          >
            {t.portal_launch_vazi || 'Launch Vazi Management'} →
          </motion.button>
        </motion.div>

        {/* Gvino Module Card */}
        <motion.div 
          whileHover={{ y: -4, shadow: '0 10px 30px rgba(78,14,21,0.06)' }}
          className="p-6 bg-white border border-[#e8dfd5] rounded-3xl shadow-xs duration-300 space-y-4 flex flex-col justify-between relative overflow-hidden group hover:border-rose-200/80 transition-all cursor-pointer"
        >
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#4e0e15]/10 via-[#4e0e15]/30 to-[#4e0e15]/10" />
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase font-mono bg-rose-50 text-rose-850 px-3 py-1 rounded-full font-black border border-rose-100">
                🍇 {t.portal_module_wine || 'Winery & Oenology'}
              </span>
              <span className="flex items-center gap-1 text-[9px] font-bold text-amber-600 font-mono">
                <span className="h-2 w-2 rounded-full bg-amber-555 animate-pulse"></span>
                MONITORING MARANI
              </span>
            </div>
            
            <h3 className="text-xl font-serif font-black text-[#4e0e15] leading-tight flex items-center gap-2">🍷 {t.portal_gvino_title || 'Gvino Cellar & Production'}</h3>
            <p className="text-xs text-stone-550 leading-relaxed font-medium">
              {t.portal_gvino_desc || 'Manage stainless steel fermenters fill index, direct transfers log, lab Free & Total SO2 levels, additives calibration, and the Winemaker AI assistant.'}
            </p>

            {/* Sub-metrics */}
            <div className="grid grid-cols-3 gap-3 border-t border-stone-100 pt-4 font-mono text-[10px] text-stone-550 font-bold">
              <div>
                <span className="text-[8px] uppercase text-stone-400 block font-normal pb-0.5">{t.portal_total_capacity || 'Total Capacity'}</span>
                <strong className="text-xs text-stone-850 font-bold block mt-0.5">{totalCapacity.toLocaleString()} L</strong>
              </div>
              <div>
                <span className="text-[8px] uppercase text-stone-400 block font-normal pb-0.5">{t.portal_active_lots || 'Active Lots'}</span>
                <strong className="text-xs text-stone-850 font-bold block mt-0.5">{lots.length} {lang === 'ka' ? 'ჯიში' : 'Varieties'}</strong>
              </div>
              <div>
                <span className="text-[8px] uppercase text-stone-400 block font-normal pb-0.5">{t.portal_fermenting_vessels || 'Fermenting'}</span>
                <strong className="text-xs text-amber-600 font-bold block mt-0.5">🔥 {activeFermsCount} {lang === 'ka' ? 'ჭურჭელი' : 'Vessels'}</strong>
              </div>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setActiveModule('gvino');
              setActiveTab('dashboard');
            }}
            className="w-full mt-4 bg-[#4e0e15] hover:bg-[#801323] text-white font-mono font-bold uppercase tracking-wider py-3 rounded-xl cursor-pointer text-xs justify-center flex items-center gap-1 transition-colors shadow-2xs"
          >
            {t.portal_launch_gvino || 'Launch Gvino Winemaking'} →
          </motion.button>
        </motion.div>

      </div>

      {/* Quick Joint Operational Dashboard Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-stone-855 text-xs">
        
        {/* Combined Tasks list */}
        <div className="p-6 bg-white border border-[#e8dfd5] rounded-3xl shadow-2xs space-y-4">
          <h4 className="font-serif font-black text-sm text-[#4e0e15] border-b border-stone-100 pb-3 flex items-center gap-1.5 uppercase text-[11px] tracking-wider">
            📋 {t.portal_tasklist || 'Unified Operations Tasklist Checklist'}
          </h4>
          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
            {tasks.map(task => (
              <div key={task.id} className="flex items-start gap-2.5 border-b border-stone-50 pb-2.5 last:border-0 font-medium">
                <input 
                  type="checkbox" 
                  checked={task.status === 'completed'}
                  onChange={() => onToggleTaskStatus(task.id)}
                  className="mt-0.5 accent-emerald-800 cursor-pointer h-3.5 w-3.5 rounded border-stone-300"
                />
                <div className="flex-grow">
                  <span className={`block font-bold text-stone-850 text-xs ${task.status === 'completed' ? 'line-through text-stone-400 font-normal' : ''}`}>{task.title}</span>
                  <span className="block text-[9px] font-mono text-slate-400 font-medium">
                    {t.task_assign || 'Assignee'}: {task.assignedTo || 'Unassigned'} • {t.task_due || 'Due Date'}: {task.dueDate} • {t.task_priority || 'Priority'}: <span className="uppercase font-bold text-red-700">{task.priority === 'high' ? (t.task_high || 'High') : task.priority === 'medium' ? (t.task_med || 'Medium') : (t.task_low || 'Low')}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Corporate audit logs ledger ticker */}
        <div className="p-6 bg-white border border-[#e8dfd5] rounded-3xl shadow-2xs space-y-4">
          <h4 className="font-serif font-black text-xs text-[#4e0e15] border-b border-stone-100 pb-3 flex items-center gap-1.5 uppercase tracking-wider">
            🛡️ {t.portal_audit_history || 'Immutable Audit Trail Ledger History'}
          </h4>
          
          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
            {auditLogs.map(log => (
              <div key={log.id} className="p-3 bg-stone-50/50 border border-stone-200 rounded-xl space-y-1 hover:border-emerald-250 transition-all font-sans text-xs">
                <div className="flex justify-between items-center text-[9px] text-slate-400 font-mono">
                  <span>{new Date(log.timestamp).toLocaleTimeString()} • {t.audit_col_user || 'Operator'} {log.user}</span>
                  <span className="bg-stone-250/55 text-stone-600 px-1.5 py-0.2 rounded uppercase font-extrabold text-[8px]">{log.module === 'VAZI' ? (t.nav_vazi || 'Vazi') : (t.nav_gvino || 'Gvino')}</span>
                </div>
                <strong className="block text-stone-850 font-bold font-serif text-stone-900">{log.actionType}</strong>
                <p className="text-stone-500 text-[10.5px] leading-relaxed font-semibold">{log.notes}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </main>
  );
}
