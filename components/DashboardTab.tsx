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
import { 
  Wind, Sprout, AlertTriangle, FileText, CheckCircle2, 
  Activity, Thermometer, ShieldAlert, Sliders, ClipboardList, CheckSquare 
} from 'lucide-react';
import { computeAlerts } from '../lib/alerts';

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
  onOpenOnboarding: () => void;
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
  setActiveTab,
  onOpenOnboarding
}: DashboardTabProps) {
  const t = translations[lang];

  // Resolve preferences defaults
  const enabledModules = currentUser.enabledModules || ['vazi', 'gvino'];
  const enabledWidgets = currentUser.enabledWidgets || ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks', 'audit'];

  // Derive metrics
  const totalArea = blocks.reduce((acc, b) => acc + b.area, 0);
  const totalCapacity = vessels.reduce((acc, v) => acc + v.capacity, 0);
  const activeFermsCount = lots.filter(l => l.stage === 'fermenting').length;

  // Compute oenology alerts
  const derivedAlerts = computeAlerts({
    vessels,
    lots,
    fermLogs: [],
    labLogs: [],
    inventory: [],
    tasks
  }).slice(0, 3);

  return (
    <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-8 flex flex-col space-y-8 animate-fade-in text-stone-900 dark:text-stone-200">
      {/* Main platform Welcome header */}
      <div className="bg-gradient-to-r from-white via-white to-[#fbfaf8] dark:from-[#110b0c] dark:via-[#110b0c] dark:to-[#1a1113] border border-stone-200/90 dark:border-stone-850 rounded-3xl p-8 lg:p-10 shadow-[0_4px_30px_rgba(78,14,21,0.02)] relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
        {/* Elegant side color-stripe indicator */}
        <div className="absolute top-0 bottom-0 left-0 w-2 bg-gradient-to-b from-[#801323] to-[#4e0e15]" />
        
        <div className="space-y-2.5 pl-3">
          <span className="text-[10px] uppercase tracking-widest bg-[#fcf8f6] dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 text-[#4e0e15] dark:text-amber-200 px-4 py-1.5 rounded-full font-black inline-block">
            📢 {t.portal_hq || 'Estate Headquarters'}
          </span>
          <h2 className="text-3xl lg:text-4xl font-display font-black text-stone-950 dark:text-amber-100 tracking-tight uppercase leading-none mt-1">{t.portal_welcome || 'Welcome to MaraniOS'}</h2>
          <p className="text-sm lg:text-base text-stone-600 dark:text-stone-400 font-sans mt-2">{t.portal_status_p || 'Real-time status indicators across your agricultural blocks & fermentation vats'}</p>
        </div>
        
        <div className="flex flex-wrap gap-3 text-[11px] font-mono pl-3 md:pl-0 items-center">
          {/* Precision Live Clock */}
          <div className="bg-[#FAF8F5]/85 dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 px-5 py-3 rounded-2xl text-left shadow-2xs">
            <span className="text-stone-400 dark:text-stone-500 block text-[9px] uppercase tracking-widest font-extrabold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
              Oenology Clock
            </span>
            <LiveClock className="text-stone-900 dark:text-amber-200 block mt-1 font-mono font-bold text-xs text-[#4e0e15]" />
          </div>
          <div className="bg-[#fcfbf9] dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 px-5 py-3 rounded-2xl text-left">
            <span className="text-stone-400 dark:text-stone-500 block text-[9px] uppercase tracking-wider font-extrabold">{t.portal_appellation || 'Active Appellation'}</span>
            <strong className="text-[#c5a059] block mt-1 font-display font-extrabold text-xs">{companyProfile.region !== 'Kakheti / Appellation' ? companyProfile.region : (lang === 'ka' ? 'კახეთი / ალაზნის ველი' : companyProfile.region)}, {companyProfile.country === 'Georgia' && lang === 'ka' ? 'საქართველო' : companyProfile.country}</strong>
          </div>
          <div className="bg-[#fcfbf9] dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 px-5 py-3 rounded-2xl text-left">
            <span className="text-stone-400 dark:text-stone-500 block text-[9px] uppercase tracking-wider font-extrabold">{t.portal_role || 'Active Role'}</span>
            <strong className="text-stone-950 dark:text-amber-100 block mt-1 font-display font-black text-xs">
              {currentUser.role === 'Viticulturist' ? (t.signin_role_viticulturist || 'Lead Viticulturist') :
               currentUser.role === 'Winemaker' ? (t.signin_role_winemaker || 'Head Winemaker') :
               (t.signin_role_owner || 'Owner & ERP Admin')}
            </strong>
          </div>
          <button
            onClick={onOpenOnboarding}
            className="bg-[#4e0e15] hover:bg-[#801323] text-white px-5 py-3 rounded-2xl font-mono font-bold uppercase transition-all cursor-pointer shadow-2xs text-[11px] select-none hover-lift"
          >
            ⚙️ {lang === 'ka' ? 'დაფის მორგება' : 'Customize Dashboard'}
          </button>
        </div>
      </div>

      {/* Module launch deck bentogrid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-stone-900">
        
        {/* Vazi Module Card */}
        {enabledModules.includes('vazi') && (
          <motion.div 
            whileHover={{ y: -4, shadow: '0 20px 40px rgba(16,185,129,0.08)' }}
            className={`p-8 lg:p-10 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-sm duration-300 space-y-6 flex flex-col justify-between relative overflow-hidden group hover:border-emerald-300 transition-all cursor-pointer ${
              !enabledModules.includes('gvino') ? 'lg:col-span-2' : ''
            }`}
          >
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-600/10 via-emerald-600/30 to-emerald-600/10" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-mono bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 px-4 py-1 rounded-full font-black border border-emerald-100 dark:border-emerald-900">
                  ✨ {t.portal_module_agri || 'Agricultural Module'}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 font-mono">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  LIVE FROM FIELDS
                </span>
              </div>
              
              <h3 className="text-2xl font-display font-black text-stone-950 dark:text-amber-100 leading-tight flex items-center gap-2">🚜 {t.portal_vazi_title || 'Vazi Vineyard Operations'}</h3>
              <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed font-medium">
                {t.portal_vazi_desc || 'Trace canopy development, heat sum Growing Degree Days predictions, scouting downy/powdery pathogens, and pre-harvest grape sugar maturation curves.'}
              </p>

              {/* Sub-metrics */}
              <div className="grid grid-cols-3 gap-4 border-t border-stone-100 dark:border-stone-800 pt-5 font-sans text-stone-600">
                <div>
                  <span className="text-[10px] uppercase text-stone-400 block pb-0.5">{t.portal_blocks_count || 'Registered Blocks'}</span>
                  <strong className="text-lg lg:text-xl font-display font-extrabold text-stone-900 dark:text-amber-100 block mt-0.5">{blocks.length} {lang === 'ka' ? 'ნაკვეთი' : 'Sectors'}</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-stone-400 block pb-0.5">{t.portal_total_area || 'Total Area'}</span>
                  <strong className="text-lg lg:text-xl font-display font-extrabold text-stone-900 dark:text-amber-100 block mt-0.5">{totalArea.toFixed(1)} ha</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-stone-400 block pb-0.5 font-bold">{t.portal_scout_status || 'Scouting Reports'}</span>
                  <strong className="text-lg lg:text-xl font-display font-extrabold text-emerald-800 dark:text-emerald-400 block mt-0.5">🌿 {t.portal_scout_healthy || 'Healthy'}</strong>
                </div>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveModule('vazi')}
              className="w-full mt-6 bg-emerald-850 hover:bg-emerald-950 text-white font-mono font-bold uppercase tracking-wider py-3.5 rounded-2xl cursor-pointer text-xs justify-center flex items-center gap-1 transition-colors shadow-2xs hover-lift"
            >
              {t.portal_launch_vazi || 'Launch Vazi Management'} →
            </motion.button>
          </motion.div>
        )}

        {/* Gvino Module Card */}
        {enabledModules.includes('gvino') && (
          <motion.div 
            whileHover={{ y: -4, shadow: '0 20px 40px rgba(78,14,21,0.08)' }}
            className={`p-8 lg:p-10 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-sm duration-300 space-y-6 flex flex-col justify-between relative overflow-hidden group hover:border-rose-300 transition-all cursor-pointer ${
              !enabledModules.includes('vazi') ? 'lg:col-span-2' : ''
            }`}
          >
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#4e0e15]/10 via-[#4e0e15]/30 to-[#4e0e15]/10" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-mono bg-rose-50 dark:bg-stone-950/40 text-rose-850 dark:text-rose-300 px-4 py-1 rounded-full font-black border border-rose-100 dark:border-stone-800">
                  🍇 {t.portal_module_wine || 'Winery & Oenology'}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-amber-600 font-mono">
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
                  MONITORING MARANI
                </span>
              </div>
              
              <h3 className="text-2xl font-display font-black text-[#4e0e15] dark:text-amber-100 leading-tight flex items-center gap-2">🍷 {t.portal_gvino_title || 'Gvino Cellar & Production'}</h3>
              <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed font-medium">
                {t.portal_gvino_desc || 'Manage stainless steel fermenters fill index, direct transfers log, lab Free & Total SO2 levels, additives calibration, and the Winemaker AI assistant.'}
              </p>

              {/* Sub-metrics */}
              <div className="grid grid-cols-3 gap-4 border-t border-stone-100 dark:border-stone-800 pt-5 font-sans text-stone-600">
                <div>
                  <span className="text-[10px] uppercase text-stone-400 block pb-0.5">{t.portal_total_capacity || 'Total Capacity'}</span>
                  <strong className="text-lg lg:text-xl font-display font-extrabold text-stone-900 dark:text-amber-100 block mt-0.5">{totalCapacity.toLocaleString()} L</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-stone-400 block pb-0.5">{t.portal_active_lots || 'Active Lots'}</span>
                  <strong className="text-lg lg:text-xl font-display font-extrabold text-stone-900 dark:text-amber-100 block mt-0.5">{lots.length} {lang === 'ka' ? 'ჯიში' : 'Lots'}</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-stone-400 block pb-0.5">{t.portal_fermenting_vessels || 'Fermenting'}</span>
                  <strong className="text-lg lg:text-xl font-display font-extrabold text-amber-600 block mt-0.5">🔥 {activeFermsCount} {lang === 'ka' ? 'ჭურჭელი' : 'Vessels'}</strong>
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
              className="w-full mt-6 bg-[#4e0e15] hover:bg-[#801323] text-white font-mono font-bold uppercase tracking-wider py-3.5 rounded-2xl cursor-pointer text-xs justify-center flex items-center gap-1 transition-colors shadow-2xs hover-lift"
            >
              {t.portal_launch_gvino || 'Launch Gvino Winemaking'} →
            </motion.button>
          </motion.div>
        )}

      </div>

      {/* Customizable Grid widgets - OVERHAULED to 3-column desktop layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 text-stone-900">
        
        {/* Widget 1: Safety & Chemistry alerts */}
        {enabledWidgets.includes('chemistry') && enabledModules.includes('gvino') && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-[#4e0e15] dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                ⚠️ {lang === 'ka' ? 'უსაფრთხოების და ქიმიის გაფრთხილებები' : 'Safety & Chemistry Warnings'}
              </h4>
              <div className="space-y-3.5">
                {derivedAlerts.length > 0 ? (
                  derivedAlerts.map(alert => (
                    <div key={alert.id} className="p-4 bg-red-50/50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/50 rounded-2xl space-y-1.5 hover-glow transition-all">
                      <div className="flex justify-between items-center text-[10px] font-mono font-bold text-red-850 dark:text-red-400">
                        <span>{alert.title}</span>
                        <span className="uppercase bg-red-100 dark:bg-red-950/60 px-2 py-0.5 rounded-md text-[9px]">{alert.severity}</span>
                      </div>
                      <p className="text-stone-700 dark:text-stone-355 text-xs leading-relaxed font-medium">{alert.message}</p>
                    </div>
                  ))
                ) : (
                  <div className="p-5 bg-emerald-50/50 dark:bg-emerald-955/10 border border-emerald-250 dark:border-emerald-900/50 text-emerald-900 dark:text-emerald-400 rounded-2xl font-bold flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <span className="text-xs">{lang === 'ka' ? 'ყველა ქიმიური მაჩვენებელი ნორმაშია.' : 'All cellar safety & lab parameters are optimal.'}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Widget 2: Weather & Mildew Station */}
        {enabledWidgets.includes('weather') && enabledModules.includes('vazi') && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-emerald-900 dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                🌦️ {lang === 'ka' ? 'მეტეო პროგნოზები და რისკები' : 'Weather Station & Mildew Forecasts'}
              </h4>
              <div className="space-y-3.5">
                <div className="p-4 bg-stone-50/70 dark:bg-stone-950/40 border border-stone-200 dark:border-stone-800 rounded-2xl flex items-center justify-between">
                  <div>
                    <strong className="block text-stone-900 dark:text-amber-100 font-display font-extrabold text-sm">Telavi Appellation</strong>
                    <span className="block text-[10px] text-slate-400 font-mono mt-1">GPS: {companyProfile.latitude?.toFixed(3) || 41.905}, {companyProfile.longitude?.toFixed(3) || 45.474}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-display font-black text-stone-900 dark:text-amber-100">24.5 °C</span>
                    <span className="block text-[10px] text-emerald-700 font-bold uppercase tracking-wider mt-0.5">Wind: 12 km/h</span>
                  </div>
                </div>
                
                <div className="p-4 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-250 dark:border-amber-900/55 text-amber-900 dark:text-amber-400 rounded-2xl flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block text-xs leading-tight font-extrabold">IPM Disease Model: Mildew Risk Level High</strong>
                    <p className="text-xs leading-relaxed mt-1 text-stone-700 dark:text-stone-400 font-medium">Canopy shoots are &gt;10cm length and weather stations show precipitation patterns. Initiate preventive sulfur-copper sprays in endangered blocks.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Widget 3: Active Fermentations */}
        {enabledWidgets.includes('fermentation') && enabledModules.includes('gvino') && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-[#4e0e15] dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                🔥 {lang === 'ka' ? 'აქტიური დუღილის ტელემეტრია' : 'Active Fermentations & Telemetry'}
              </h4>
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1 no-scrollbar">
                {lots.filter(l => l.stage === 'fermenting').length > 0 ? (
                  lots.filter(l => l.stage === 'fermenting').map(lot => {
                    const vessel = vessels.find(v => v.assignedLotId === lot.id);
                    return (
                      <div key={lot.id} className="p-4 bg-stone-50/50 dark:bg-stone-950/40 border border-stone-200 dark:border-stone-800 rounded-2xl flex justify-between items-center hover-glow transition-all">
                        <div>
                          <strong className="text-xs text-stone-900 dark:text-amber-100 block font-display font-extrabold">{lot.name} ({lot.variety})</strong>
                          <span className="text-[10px] text-slate-400 block font-mono mt-1">Vessel: {vessel ? vessel.id : 'Bulk Cellar'} • Vol: {lot.currentVolume} L</span>
                        </div>
                        <div className="text-right font-mono">
                          <span className="text-sm font-black text-red-800 dark:text-red-400 block">{vessel ? `${vessel.temperature}°C` : '--'}</span>
                          <span className="text-[10px] text-slate-450 block mt-0.5">Gravity: 1.002 SG</span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-400 italic font-mono py-6 text-center">No active fermentations logged in the system.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Widget 4: Canopy status radar */}
        {enabledWidgets.includes('canopy') && enabledModules.includes('vazi') && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-emerald-900 dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                🌿 {lang === 'ka' ? 'ვენახის კანოპის (ფოთლის) რადარი' : 'Vineyard Canopy Status Radar'}
              </h4>
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1 no-scrollbar">
                {blocks.slice(0, 4).map(block => (
                  <div key={block.id} className="p-4 bg-stone-50/50 dark:bg-stone-950/40 border border-stone-200 dark:border-stone-800 rounded-2xl flex justify-between items-center hover-glow transition-all">
                    <div>
                      <strong className="text-xs text-stone-900 dark:text-amber-100 block font-display font-extrabold">{block.name} ({block.grapeVariety})</strong>
                      <span className="text-[10px] text-slate-400 block font-mono mt-1">{block.area} ha • Plant Year: {block.plantingYear}</span>
                    </div>
                    <span className="text-[10px] font-mono bg-emerald-50 dark:bg-emerald-955/25 text-emerald-800 dark:text-emerald-300 px-3 py-1 rounded-lg border border-emerald-150 dark:border-emerald-900 font-bold shrink-0">
                      {block.currentPhenology}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Widget 5: Combined Tasks list */}
        {enabledWidgets.includes('tasks') && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-[#4e0e15] dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                📋 {t.portal_tasklist || 'Unified Operations Tasklist Checklist'}
              </h4>
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1">
                {tasks.length > 0 ? (
                  tasks.map(task => (
                    <div key={task.id} className="flex items-start gap-3 border-b border-stone-100 dark:border-stone-850 pb-3 last:border-0 font-medium">
                      <input 
                        type="checkbox" 
                        checked={task.status === 'completed'}
                        onChange={() => onToggleTaskStatus(task.id)}
                        className="mt-1 accent-emerald-800 cursor-pointer h-4 w-4 rounded border-stone-300 shrink-0"
                      />
                      <div className="flex-grow">
                        <span className={`block font-extrabold text-stone-900 dark:text-amber-100 text-xs ${task.status === 'completed' ? 'line-through text-stone-400 font-normal' : ''}`}>{task.title}</span>
                        <span className="block text-[10px] font-mono text-slate-400 font-bold mt-1">
                          {t.task_assign || 'Assignee'}: {task.assignedTo || 'Unassigned'} • {t.task_due || 'Due'}: {task.dueDate} • Priority: <span className={`uppercase font-black ${task.priority === 'high' ? 'text-red-700' : task.priority === 'medium' ? 'text-amber-600' : 'text-stone-500'}`}>{task.priority === 'high' ? (t.task_high || 'High') : task.priority === 'medium' ? (t.task_med || 'Medium') : (t.task_low || 'Low')}</span>
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400 italic font-mono py-6 text-center">No operations tasks currently scheduled.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Widget 6: Corporate audit logs ledger ticker */}
        {enabledWidgets.includes('audit') && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-[#4e0e15] dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                🛡️ {t.portal_audit_history || 'Immutable Audit Trail Ledger History'}
              </h4>
              
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1 no-scrollbar">
                {auditLogs.length > 0 ? (
                  auditLogs.slice(0, 10).map(log => (
                    <div key={log.id} className="p-4 bg-[#fdfdfb] dark:bg-stone-950/20 border border-stone-200 dark:border-stone-850 rounded-2xl space-y-1.5 hover-glow transition-all text-xs">
                      <div className="flex justify-between items-center text-[9px] text-slate-450 font-mono">
                        <span>{new Date(log.timestamp).toLocaleTimeString()} • Operator: {log.user}</span>
                        <span className="bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300 px-2 py-0.5 rounded-md uppercase font-extrabold text-[8px]">{log.module === 'VAZI' ? (t.nav_vazi || 'Vazi') : (t.nav_gvino || 'Gvino')}</span>
                      </div>
                      <strong className="block text-stone-950 dark:text-amber-100 font-display font-extrabold text-stone-900">{log.actionType}</strong>
                      <p className="text-stone-600 dark:text-stone-400 text-[11px] leading-relaxed font-semibold">{log.notes}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400 italic font-mono py-6 text-center">No system operations logged.</p>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
