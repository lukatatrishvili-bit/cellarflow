import { useState } from 'react';
import { translations, Language } from '@/lib/i18n';
import { Tank, WineLot, WineTransfer, LabResult, CellarTask, InventoryItem } from '@/lib/services/db';
import { formatDate } from '@/lib/utils';
import { 
  Wine, Database, TrendingUp, AlertCircle, 
  PlusCircle, ArrowRightLeft, Beaker, ClipboardList,
  ChevronRight, Circle, Activity, CheckCircle2
} from 'lucide-react';
import TankCapacityChart from './TankCapacityChart';

interface DashboardTabProps {
  lang: Language;
  tanks: Tank[];
  lots: WineLot[];
  transfers: WineTransfer[];
  labResults: LabResult[];
  tasks: CellarTask[];
  inventory: InventoryItem[];
  setTab: (tab: string) => void;
  onAddTask: () => void;
  onAddTransfer: () => void;
  onAddLabResult: () => void;
  onAddLot: () => void;
  onAddTank: () => void;
}

export default function DashboardTab({
  lang,
  tanks,
  lots,
  transfers,
  labResults,
  tasks,
  inventory,
  setTab,
  onAddTask,
  onAddTransfer,
  onAddLabResult,
  onAddLot,
  onAddTank
}: DashboardTabProps) {
  const t = translations[lang];

  // Calculated Stats
  const totalVolume = tanks.reduce((sum, tank) => sum + tank.currentVolume, 0);
  const totalTanks = tanks.length;
  const emptyTanks = tanks.filter(tank => tank.status === 'empty').length;
  const activeFermsTarget = tanks.filter(tank => tank.status === 'fermenting').length;
  const occupiedTanks = tanks.filter(tank => tank.status === 'occupied').length;

  const lowInventoryItems = inventory.filter(item => item.quantity <= item.minStock);
  const pendingTasks = tasks.filter(task => task.status === 'pending');

  const getWineLotCode = (lotId: string) => {
    const lot = lots.find(l => l.id === lotId);
    return lot ? lot.code : t.unknown;
  };

  const getWineLotName = (lotId: string) => {
    const lot = lots.find(l => l.id === lotId);
    return lot ? lot.wineName : t.unknown;
  };

  return (
    <div className="space-y-6">
      {/* Overview Stat Widgets */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div id="stat-volume" className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t.total_volume}</p>
            <h3 className="text-2xl font-bold font-sans text-slate-800 mt-1">{totalVolume.toLocaleString()} L</h3>
            <span className="text-[10px] text-red-700 bg-red-50 px-2.5 py-1 rounded-sm font-mono mt-2 inline-block">
              {t.winery}: Vinea Elite
            </span>
          </div>
          <div className="p-3 bg-red-50 text-red-700 rounded-sm">
            <Wine className="h-6 w-6" />
          </div>
        </div>

        <div id="stat-tanks" className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t.total_tanks}</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">{totalTanks}</h3>
            <div className="flex gap-2 text-[10px] text-slate-500 mt-2 font-mono">
              <span className="text-emerald-600">{emptyTanks} {t.empty_tanks}</span>
              <span>•</span>
              <span className="text-amber-600">{occupiedTanks} {t.occupied_tanks}</span>
            </div>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-800 rounded-sm">
            <Database className="h-6 w-6" />
          </div>
        </div>

        <div id="stat-fermentations" className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t.active_ferms}</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">{activeFermsTarget}</h3>
            <span className="text-[10px] text-amber-700 bg-amber-50 px-2.5 py-1 rounded-sm font-mono mt-2 inline-block">
              {t.ferm_type}: {t.alcoholic} / MLF
            </span>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-sm">
            <Activity className="h-6 w-6" />
          </div>
        </div>

        <div id="stat-tasks" className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t.upcoming_tasks}</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">{pendingTasks.length}</h3>
            <span className="text-[10px] text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-sm font-mono mt-2 inline-block">
              {pendingTasks.filter(tk => tk.priority === 'critical' || tk.priority === 'high').length} High Priority
            </span>
          </div>
          <div className="p-3 bg-slate-100 text-slate-600 rounded-sm">
            <ClipboardList className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Quick Action Matrix (Zero Telemetry or Logs) */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">{t.quick_actions}</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <button id="qa-add-tank" onClick={onAddTank} className="p-3 bg-white border border-slate-200 hover:border-[#2d0a0a] rounded-sm text-center cursor-pointer transition-all shadow-sm group">
            <PlusCircle className="h-5 w-5 mx-auto text-[#2d0a0a] mb-2 group-hover:scale-105 transition-transform" />
            <span className="text-xs font-semibold text-slate-700 block line-clamp-1">Add Vessel</span>
          </button>
          <button id="qa-add-lot" onClick={onAddLot} className="p-3 bg-white border border-slate-200 hover:border-[#2d0a0a] rounded-sm text-center cursor-pointer transition-all shadow-sm group">
            <PlusCircle className="h-5 w-5 mx-auto text-emerald-600 mb-2 group-hover:scale-105 transition-transform" />
            <span className="text-xs font-semibold text-slate-700 block line-clamp-1">Add Wine Lot</span>
          </button>
          <button id="qa-transfer" onClick={onAddTransfer} className="p-3 bg-white border border-slate-200 hover:border-[#2d0a0a] rounded-sm text-center cursor-pointer transition-all shadow-sm group">
            <ArrowRightLeft className="h-5 w-5 mx-auto text-blue-600 mb-2 group-hover:scale-105 transition-transform" />
            <span className="text-xs font-semibold text-slate-700 block line-clamp-1">Record Move</span>
          </button>
          <button id="qa-lab" onClick={onAddLabResult} className="p-3 bg-white border border-slate-200 hover:border-[#2d0a0a] rounded-sm text-center cursor-pointer transition-all shadow-sm group">
            <Beaker className="h-5 w-5 mx-auto text-purple-600 mb-2 group-hover:scale-105 transition-transform" />
            <span className="text-xs font-semibold text-slate-700 block line-clamp-1">Log Analysis</span>
          </button>
          <button id="qa-task" onClick={onAddTask} className="p-3 bg-white border border-slate-200 hover:border-[#2d0a0a] rounded-sm text-center cursor-pointer transition-all shadow-sm group">
            <ClipboardList className="h-5 w-5 mx-auto text-amber-600 mb-2 group-hover:scale-105 transition-transform" />
            <span className="text-xs font-semibold text-slate-700 block line-clamp-1">Add Task</span>
          </button>
          <button id="qa-calc" onClick={() => setTab('calculators')} className="p-3 bg-white border border-slate-200 hover:border-[#2d0a0a] rounded-sm text-center cursor-pointer transition-all shadow-sm group">
            <TrendingUp className="h-5 w-5 mx-auto text-slate-600 mb-2 group-hover:scale-105 transition-transform" />
            <span className="text-xs font-semibold text-slate-700 block line-clamp-1">Calculators</span>
          </button>
        </div>
      </div>

      {/* D3 Tank Live Fill Capacity Section */}
      <div id="capacity-overview" className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h4 className="font-sans font-semibold text-slate-800 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[#2d0a0a]" />
            Cellar Capacity & Vessel Utilization
          </h4>
          <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded-sm uppercase tracking-wide">
            Real-Time D3 Engine
          </span>
        </div>
        <TankCapacityChart tanks={tanks} />
      </div>

      {/* Two-Column Midsection: Tasks/Alerts & Recent Operations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column (2/3 size): Real Actions & Activities */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Recent Transfers */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-sans font-semibold text-slate-800 flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5 text-blue-600" />
                {t.recent_transfers}
              </h4>
              <button onClick={() => setTab('transfers')} className="text-xs font-bold text-red-700 hover:underline flex items-center uppercase tracking-wide">
                View All <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider bg-slate-50">
                    <th className="p-3">Date</th>
                    <th className="p-3">Route</th>
                    <th className="p-3">Lot (Wine)</th>
                    <th className="p-3 text-right">Volume</th>
                    <th className="p-3">Operator</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.slice(0, 4).map((tx) => {
                    const sourceTank = tanks.find(tk => tk.id === tx.sourceTankId);
                    const destTank = tanks.find(tk => tk.id === tx.destTankId);
                    return (
                      <tr key={tx.id} className="border-b border-slate-100 hover:bg-slate-50/40">
                        <td className="p-3 font-mono text-[11px] text-gray-400">
                          {formatDate(tx.date)}
                        </td>
                        <td className="p-3 ml-2 font-semibold text-gray-800">
                          {sourceTank?.name || t.unknown} → {destTank?.name || t.unknown}
                        </td>
                        <td className="p-3">
                          <span className="bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded-xs font-mono mr-1">
                            {getWineLotCode(tx.lotId)}
                          </span>
                          <span className="text-gray-500 max-w-[120px] line-clamp-1 inline-block align-middle">
                            {getWineLotName(tx.lotId)}
                          </span>
                        </td>
                        <td className="p-3 text-right font-bold text-gray-800 font-mono">
                          {tx.volume.toLocaleString()} L
                        </td>
                        <td className="p-3 text-gray-500 font-medium">
                          {tx.operator || 'Luka'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Lab Results */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-sans font-semibold text-slate-800 flex items-center gap-2">
                <Beaker className="h-5 w-5 text-purple-600" />
                {t.recent_labs}
              </h4>
              <button onClick={() => setTab('lab_analysis')} className="text-xs font-bold text-red-700 hover:underline flex items-center uppercase tracking-wider">
                View All <ChevronRight className="h-3 w-3" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {labResults.slice(0, 2).map((lab) => {
                const targetLotName = getWineLotName(lab.lotId);
                const targetLotCode = getWineLotCode(lab.lotId);
                return (
                  <div key={lab.id} className="border border-slate-200 rounded-lg p-4 bg-slate-50/30 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded-sm">
                          {targetLotCode}
                        </span>
                        <h5 className="font-semibold text-slate-700 text-sm mt-1">{targetLotName}</h5>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        {formatDate(lab.date)}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-[11px] border-t border-b border-slate-200/60 py-2">
                      <div>
                        <span className="text-gray-400 block text-[10px] uppercase font-mono">pH</span>
                        <span className="font-bold text-gray-800">{lab.pH}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 block text-[10px] uppercase font-mono">Alcohol</span>
                        <span className="font-bold text-gray-800">{lab.alcohol}%</span>
                      </div>
                      <div>
                        <span className="text-gray-400 block text-[10px] uppercase font-mono">Free SO2</span>
                        <span className="font-bold text-gray-800">{lab.freeSO2} mg/L</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-gray-500 italic line-clamp-2">
                      &ldquo;{lab.tastingNote || 'Fine balance observed.'}&rdquo;
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Right Column (1/3 size): Real Tasks & Stock Alerts */}
        <div className="space-y-6">
          
          {/* Low Stock Alerts */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <h4 className="font-sans font-semibold text-slate-800 flex items-center gap-2 mb-4">
              <AlertCircle className="h-5 w-5 text-red-600" />
              {t.low_inventory}
            </h4>

            {lowInventoryItems.length === 0 ? (
              <div className="text-center p-4 text-xs text-slate-400">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                <p>{t.alert_no_inventory}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {lowInventoryItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 border border-red-100 bg-red-50/25 rounded-sm text-xs">
                    <div>
                      <span className="font-semibold text-slate-700 block">{item.name}</span>
                      <span className="text-[10px] font-mono text-slate-400">{item.category} ({item.supplier})</span>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-red-600 font-mono italic">{item.quantity} {item.unit}</span>
                      <span className="text-[10px] text-slate-500 block">Min: {item.minStock} {item.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Tasks */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-sans font-semibold text-slate-800 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-amber-600" />
                {t.upcoming_tasks}
              </h4>
              <button onClick={() => setTab('tasks')} className="text-xs font-bold text-red-700 hover:underline flex items-center uppercase tracking-wide">
                Manage
              </button>
            </div>

            {pendingTasks.length === 0 ? (
              <div className="text-center p-4 text-xs text-slate-400">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                <p>{t.alert_no_tasks}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingTasks.slice(0, 4).map((task) => (
                  <div key={task.id} className="p-3 border border-slate-100 rounded-sm hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className={`text-[9px] uppercase font-mono px-1.5 py-0.2 ml-1 rounded-sm font-bold ${
                        task.priority === 'critical' ? 'bg-red-100 text-red-800' :
                        task.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                        task.priority === 'medium' ? 'bg-amber-100 text-amber-800' :
                        'bg-slate-100 text-slate-800'
                      }`}>
                        {task.priority}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {formatDate(task.dueDate)}
                      </span>
                    </div>
                    <p className="font-semibold text-slate-700 text-xs mt-1.5">{task.title}</p>
                    {task.notes && (
                      <p className="text-[10px] text-slate-400 italic line-clamp-1 mt-1">{task.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
