import React from 'react';
import { translations, Language } from '../lib/i18n';
import { Vessel, WineLot, DailyFermLog, LabAnalysis, Task } from '../lib/wineryState';
import TankCapacityChart from './TankCapacityChart';
import FermentationCurveChart from './FermentationCurveChart';
import { ShieldAlert } from 'lucide-react';

interface WineryDashboardTabProps {
  lang: Language;
  lots: WineLot[];
  vessels: Vessel[];
  fermLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  tasks: Task[];
  chartLotId: string;
  setChartLotId: (val: string) => void;
  selectedTankId: string | null;
  setSelectedTankId: (val: string | null) => void;
  onToggleTaskStatus: (taskId: string) => void;
  setActiveTab?: (tab: string) => void;
  setCalculatorLotId?: (lotId: string) => void;
  setPrefilledTaskTitle?: (title: string) => void;
  setPrefilledTaskPriority?: (priority: 'high' | 'medium' | 'low') => void;
  setPrefilledTaskDesc?: (desc: string) => void;
}

export default function WineryDashboardTab({
  lang,
  lots,
  vessels,
  fermLogs,
  labLogs,
  tasks,
  chartLotId,
  setChartLotId,
  selectedTankId,
  setSelectedTankId,
  onToggleTaskStatus,
  setActiveTab,
  setCalculatorLotId,
  setPrefilledTaskTitle,
  setPrefilledTaskPriority,
  setPrefilledTaskDesc
}: WineryDashboardTabProps) {
  const t = translations[lang];
  const isKa = lang === 'ka';

  // Helper selectors
  const totalLotsVolume = lots.reduce((acc, curr) => acc + curr.currentVolume, 0);
  const totalTanksCount = vessels.length;
  const occupiedTanksCount = vessels.filter(v => v.currentVolume > 0).length;
  const activeFermsCount = lots.filter(l => l.stage === 'fermenting').length;

  const lowSO2Alerts = labLogs.filter(log => log.freeSo2 < 15);
  const highVAAlerts = labLogs.filter(log => log.volatileAcid > 0.8);

  const mappedTanks = vessels.map(v => ({
    id: v.id,
    name: v.id,
    capacity: v.capacity,
    currentVolume: v.currentVolume,
    status: v.assignedLotId 
      ? (lots.find(l => l.id === v.assignedLotId)?.stage === 'fermenting' ? 'fermenting' : 'occupied')
      : (v.cleaningStatus === 'dirty' ? 'cleaning' : 'empty')
  }));

  const avgTemp = occupiedTanksCount > 0 
    ? parseFloat((vessels.reduce((acc, curr) => acc + (curr.temperature || 0), 0) / vessels.length).toFixed(1))
    : 15.0;

  return (
    <div className="space-y-6 animate-fade-in text-stone-800 relative z-10">
      
      {/* Quick Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="p-6 lg:p-7 glass-card rounded-2xl shadow-xs text-center hover-lift hover-glow border-l-4 border-l-[#801323] transition-all">
          <span className="text-[10px] uppercase font-mono text-slate-450 block font-black tracking-wider">{t.total_volume}</span>
          <strong className="text-2xl lg:text-3xl font-display font-black text-[#801323] block mt-2">{totalLotsVolume.toLocaleString()} L</strong>
        </div>
        <div className="p-6 lg:p-7 glass-card rounded-2xl shadow-xs text-center hover-lift hover-glow border-l-4 border-l-[#4e0e15] transition-all">
          <span className="text-[10px] uppercase font-mono text-slate-450 block font-black tracking-wider">{t.total_tanks}</span>
          <strong className="text-2xl lg:text-3xl font-display font-black text-[#4e0e15] block mt-2">{totalTanksCount} <span className="text-xs font-sans text-stone-500 font-bold">({occupiedTanksCount} {isKa ? 'შევსებული' : 'fill'})</span></strong>
        </div>
        <div className="p-6 lg:p-7 glass-card rounded-2xl shadow-xs text-center hover-lift hover-glow border-l-4 border-l-amber-600 transition-all">
          <span className="text-[10px] uppercase font-mono text-slate-450 block font-black tracking-wider">{t.active_ferms}</span>
          <strong className="text-2xl lg:text-3xl font-display font-black text-amber-600 block mt-2">{activeFermsCount}</strong>
        </div>
        <div className="p-6 lg:p-7 glass-card rounded-2xl shadow-xs text-center hover-lift hover-glow border-l-4 border-l-emerald-750 transition-all">
          <span className="text-[10px] uppercase font-mono text-slate-450 block font-black tracking-wider">{t.temperature}</span>
          <strong className="text-2xl lg:text-3xl font-display font-black text-emerald-700 block mt-2">{avgTemp} °C</strong>
        </div>
      </div>

      {/* D3 Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* 1. Cellar Vessel utilization graph */}
        <div className="p-7 lg:p-8 glass-card rounded-3xl shadow-xs text-stone-850 space-y-4 hover-glow transition-all">
          <div className="border-b border-[#e8dfd5]/40 pb-3.5 flex items-center justify-between">
            <div>
              <h3 className="text-base font-display font-black text-[#4e0e15] dark:text-amber-100 uppercase tracking-wider">{isKa ? 'რეზერვუარების დატვირთვა' : 'Cellar Vessel Utilization'}</h3>
              <p className="text-[10.5px] text-slate-400 font-semibold mt-1">{isKa ? 'აქტიური მოცულობისა და ტევადობის დინამიური D3 დიაგრამა' : 'D3 Dynamic capacity vs active liquid volume tracking'}</p>
            </div>
            <span className="text-[9px] font-mono bg-stone-100/90 border border-stone-200 px-2.5 py-0.5 rounded-md text-[#4e0e15] uppercase font-bold tracking-widest shrink-0 dark:bg-stone-900 dark:border-stone-800 dark:text-amber-400">Cellar D3</span>
          </div>
          <TankCapacityChart tanks={mappedTanks} onSelectTank={setSelectedTankId} selectedTankId={selectedTankId} />
        </div>

        {/* 2. Fermentation kinetics curve */}
        <div className="p-7 lg:p-8 glass-card rounded-3xl shadow-xs text-stone-850 space-y-4 hover-glow transition-all">
          <div className="border-b border-[#e8dfd5]/40 pb-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-display font-black text-[#4e0e15] dark:text-amber-100 uppercase tracking-wider">{isKa ? 'დუღილის კინეტიკა და შაქრის კლება' : 'Kinetics & Sugar Degradation'}</h3>
              <p className="text-[10.5px] text-slate-400 font-semibold mt-1">{isKa ? 'დუღილის პროგრესის ორღერძიანი D3 ტრეკერი' : 'D3 Live dual-axis fermentation kinetic tracker'}</p>
            </div>
            <select
              value={chartLotId}
              onChange={(e) => setChartLotId(e.target.value)}
              className="text-[10.5px] font-bold px-3 py-1 bg-[#FAF8F5] border border-slate-200 rounded-lg outline-none w-full sm:w-44 cursor-pointer text-slate-850"
            >
              {Array.from(new Set(fermLogs.map(l => l.lotId))).map(lId => {
                const associatedLot = lots.find(lt => lt.id === lId);
                return (
                  <option key={lId} value={lId}>
                    {associatedLot ? associatedLot.name : lId}
                  </option>
                );
              })}
            </select>
          </div>
          <FermentationCurveChart logs={fermLogs} selectedLotId={chartLotId} />
        </div>

      </div>

      {/* Chemical Alerts Panel */}
      {(lowSO2Alerts.length > 0 || highVAAlerts.length > 0) && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-3">
          <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1">
            <ShieldAlert className="w-4 h-4 text-rose-500 animate-pulse" /> Winery Safety & Chemistry Alerts
          </h4>
          <div className="space-y-2.5">
            {lowSO2Alerts.map((log, i) => (
              <div key={`so2-alert-${i}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-rose-700 bg-white/60 p-2.5 rounded-lg border border-rose-100">
                <span className="font-sans leading-relaxed">
                  ⚠️ <strong>SO₂ Warning</strong>: Wine Lot &quot;{log.lotId}&quot; has low active Free SO₂ ({log.freeSo2} mg/L). Risk of spoilage. Action KMBS correction required.
                </span>
                {setActiveTab && setCalculatorLotId && (
                  <button
                    onClick={() => {
                      setCalculatorLotId(log.lotId);
                      setActiveTab('calculators');
                    }}
                    className="shrink-0 px-2.5 py-1 text-[10px] font-bold text-white bg-[#801323] hover:bg-[#4e0e15] rounded transition-all cursor-pointer shadow-2xs self-start sm:self-center"
                  >
                    🧪 Run SO₂ Calculator
                  </button>
                )}
              </div>
            ))}
            {highVAAlerts.map((log, i) => (
              <div key={`va-alert-${i}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-rose-700 bg-white/60 p-2.5 rounded-lg border border-rose-100">
                <span className="font-sans leading-relaxed">
                  ⚠️ <strong>Volatile Acidity Alert</strong>: Acetation warning for Lot &quot;{log.lotId}&quot; ({log.volatileAcid} g/L). Risk of ethyl acetate formation. Inspect seal.
                </span>
                {setActiveTab && setPrefilledTaskTitle && setPrefilledTaskPriority && setPrefilledTaskDesc && (
                  <button
                    onClick={() => {
                      setPrefilledTaskTitle(`Inspect & seal vessel for Lot ${log.lotId}`);
                      setPrefilledTaskPriority('high');
                      setPrefilledTaskDesc(`Acetation Alert: Volatile Acidity is elevated at ${log.volatileAcid} g/L. Check cooling jacket, clean headspace, verify lid gasket tightness, and purge with CO2/Argon if necessary.`);
                      setActiveTab('tasks');
                    }}
                    className="shrink-0 px-2.5 py-1 text-[10px] font-bold text-white bg-amber-700 hover:bg-amber-800 rounded transition-all cursor-pointer shadow-2xs self-start sm:self-center"
                  >
                    📋 Inspect & Seal Task
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grid 2 components: Recents */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Pending Tasks list */}
        <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm">
          <h4 className="text-sm font-serif font-bold text-[#4e0e15] border-b border-slate-100 pb-2 mb-3">{t.upcoming_tasks}</h4>
          <div className="space-y-2.5">
            {tasks.map(task => (
              <div key={task.id} className="flex items-start gap-2 text-xs">
                <input 
                  type="checkbox" 
                  checked={task.status === 'completed'}
                  onChange={() => onToggleTaskStatus(task.id)}
                  className="mt-0.5 cursor-pointer accent-[#4e0e15]"
                />
                <div className="flex-grow">
                  <span className={`block font-semibold ${task.status === 'completed' ? 'line-through text-slate-300 font-normal' : 'text-slate-700'}`}>{task.title}</span>
                  <span className="text-[10px] text-slate-400 font-medium block">Due: {task.dueDate} • Assigned: {task.assignedTo}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Daily Ferment log tracker */}
        <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm text-stone-800">
          <h4 className="text-sm font-serif font-bold text-[#4e0e15] border-b border-slate-100 pb-2 mb-3">Recent Fermentation Tracking Logs</h4>
          <div className="space-y-3">
            {fermLogs.slice(0, 3).map(log => (
              <div key={log.id} className="text-xs pb-2 border-b border-dashed border-slate-100">
                <div className="flex items-center justify-between font-bold text-slate-700 font-sans">
                  <span>{log.lotId}</span>
                  <span className="text-[10px] text-slate-400 font-mono font-medium">{log.date}</span>
                </div>
                <p className="text-[11px] text-slate-550 mt-1 font-medium">Temp: {log.temperature}°C \| Density: {log.density} \| Notes: {log.tastingNotes}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
