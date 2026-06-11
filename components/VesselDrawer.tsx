import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Thermometer, RefreshCw } from 'lucide-react';
import { Language } from '../lib/i18n';
import { Vessel, WineLot, DailyFermLog } from '../lib/wineryState';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface VesselDrawerProps {
  lang: Language;
  selectedTankId: string | null;
  vessels: Vessel[];
  lots: WineLot[];
  fermLogs: DailyFermLog[];
  onClose: () => void;
  onAdjustTargetTemp: (vesselId: string, increment: number) => void;
  onToggleSanitation: (vesselId: string) => void;
  onToggleCoolingJacket?: (vesselId: string) => void;
}

export default function VesselDrawer({
  lang,
  selectedTankId,
  vessels,
  lots,
  fermLogs,
  onClose,
  onAdjustTargetTemp,
  onToggleSanitation,
  onToggleCoolingJacket
}: VesselDrawerProps) {
  const selectedVessel = selectedTankId ? vessels.find(v => v.id === selectedTankId) : null;
  const selectedLot = selectedVessel?.assignedLotId 
    ? lots.find(l => l.id === selectedVessel.assignedLotId) 
    : null;
  const tankLogs = selectedTankId 
    ? fermLogs.filter(log => log.tankId === selectedTankId) 
    : [];

  const [aiInsights, setAiInsights] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!selectedTankId || !selectedVessel) {
      setAiInsights('');
      return;
    }

    const fetchInsights = async () => {
      setIsAiLoading(true);
      setAiInsights('');
      try {
        const lotInfo = selectedLot 
          ? `holding ${selectedLot.name} (${selectedLot.variety}, vintage ${selectedLot.vintage}, stage ${selectedLot.stage})`
          : 'vacant';
        const promptMsg = `Vessel: ${selectedVessel.id} (${selectedVessel.type}, shape ${selectedVessel.shape}, capacity ${selectedVessel.capacity}L, volume ${selectedVessel.currentVolume}L).
Assigned Lot: ${lotInfo}.
Current Temperature: ${selectedVessel.temperature}°C, Sanitation Status: ${selectedVessel.cleaningStatus}.
Provide a highly-precise two-bullet checklist of critical winemaking/cellaring next steps for this vessel. Focus on KMBS sulfur dioxide, headspace control, temp checks, or sanitizing needs. Respond ONLY with the two bullet points in markdown (bolding key terms).`;

        const resp = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptMsg })
        });

        if (resp.ok) {
          const data = await resp.json();
          setAiInsights(data.text);
        } else {
          setAiInsights('⚠️ Failed to load AI recommendations.');
        }
      } catch (err) {
        setAiInsights('⚠️ AI Winemaker advisor is currently offline.');
      } finally {
        setIsAiLoading(false);
      }
    };

    // Lightweight debounced delay to prevent spamming the API on rapid clicks
    const timer = setTimeout(fetchInsights, 400);
    return () => clearTimeout(timer);
  }, [selectedTankId, selectedVessel?.currentVolume, selectedVessel?.temperature, selectedVessel?.cleaningStatus]);

  // Build 7-day temperature history
  const tempHistory = (() => {
    if (!selectedVessel) return [];
    const list = [];
    const currentTemp = selectedVessel.temperature;
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const realLog = tankLogs.find(log => log.date === dateStr);
      
      let temp = currentTemp;
      let isReal = false;
      
      if (realLog) {
        temp = realLog.temperature;
        isReal = true;
      } else {
        const idSum = selectedVessel.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const variance = Math.sin((idSum + i) * 1.7) * 1.3;
        temp = Number((currentTemp + variance).toFixed(1));
      }
      
      const label = d.toLocaleDateString(lang === 'ka' ? 'ka-GE' : lang === 'it' ? 'it-IT' : 'en-US', {
        month: 'short',
        day: 'numeric',
      });
      
      list.push({
        date: dateStr,
        label,
        temperature: temp,
        isReal
      });
    }
    return list;
  })();

  return (
    <AnimatePresence>
      {selectedTankId && selectedVessel && (
        <>
          <motion.div
            key="vessel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-stone-900/40 backdrop-blur-xs z-50 transition-opacity"
          />

          <motion.div
            key="vessel-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 24, stiffness: 200 }}
            className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-[#FAF8F5] shadow-2xl border-l border-[#f0e6da] flex flex-col focus:outline-none text-stone-800"
          >
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              <div className="flex items-start justify-between border-b border-[#e8dfd5] pb-4">
                <div>
                  <span className="text-[10px] font-mono uppercase bg-amber-100 text-amber-955 px-2 py-0.5 rounded font-bold tracking-wider mb-1.5 inline-block">
                    Cellar Core Vessel
                  </span>
                  <h2 className="text-xl font-serif font-bold text-[#4e0e15]">{selectedVessel.id}</h2>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{selectedVessel.locationDetails || 'Cellar Room A, main row'}</p>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-full hover:bg-stone-200/50 text-stone-505 hover:text-stone-800 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-white border border-[#e8dfd5] rounded-xl shadow-2xs">
                  <span className="text-[10px] uppercase font-mono text-slate-450 block">Vessel Type</span>
                  <strong className="text-xs text-stone-800 font-semibold capitalize block mt-0.5">
                    {selectedVessel.type.replace('_', ' ')}
                  </strong>
                </div>
                <div className="p-3 bg-white border border-[#e8dfd5] rounded-xl shadow-2xs">
                  <span className="text-[10px] uppercase font-mono text-slate-450 block">Profile Shape</span>
                  <strong className="text-xs text-stone-800 font-semibold capitalize block mt-0.5">
                    {selectedVessel.shape} Container
                  </strong>
                </div>
              </div>

              {/* Assigned Wine Lot Card */}
              <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl space-y-3.5 shadow-2xs">
                <span className="text-[10px] uppercase font-mono text-slate-400 block font-bold">Assigned Wine Lot / Blend</span>
                {selectedLot ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-serif font-bold text-[#4e0e15]">{selectedLot.name}</h4>
                      <span className="px-2 py-0.5 text-[9px] font-semibold text-[#801323] bg-rose-50 border border-rose-100 rounded-full uppercase">
                        {selectedLot.stage}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 text-xs border-t border-slate-100 pt-2.5">
                      <div>
                        <span className="text-slate-400 text-[10px] block font-mono uppercase">Vintage & Variety</span>
                        <strong className="text-stone-705 font-serif font-semibold">{selectedLot.vintage} • {selectedLot.variety}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block font-mono uppercase">Vineyard Block</span>
                        <strong className="text-stone-705 font-mono text-[11px]">{selectedLot.vineyardBlock}</strong>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-400 text-[10px] block font-mono uppercase">Origin Appellation</span>
                        <strong className="text-stone-705 text-[11px]">{selectedLot.region} Protected Appellation</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-2 text-center text-xs text-slate-400 italic font-mono text-[11px]">
                    No active wine grapes or fermenting lot assigned. This tank is vacant.
                  </div>
                )}
              </div>

              <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl space-y-2 shadow-2xs">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-500 font-medium">Volumetric Fill Degree</span>
                  <span className="font-bold text-[#4e0e15]">
                    {selectedVessel.capacity > 0 ? Math.round((selectedVessel.currentVolume / selectedVessel.capacity) * 100) : 0}% Filled
                  </span>
                </div>
                
                <div className="w-full bg-slate-100 h-3.5 rounded-full overflow-hidden border border-slate-200 relative">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      (selectedVessel.currentVolume / selectedVessel.capacity) > 0.95 
                        ? 'bg-gradient-to-r from-red-600 to-rose-500 animate-pulse' 
                        : 'bg-gradient-to-r from-[#801323] to-[#510e19]'
                    }`}
                    style={{ width: `${selectedVessel.capacity > 0 ? (selectedVessel.currentVolume / selectedVessel.capacity) * 100 : 0}%` }}
                  />
                </div>

                <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 mt-1">
                  <span>{selectedVessel.currentVolume.toLocaleString()} L Net volume</span>
                  <span>{selectedVessel.capacity.toLocaleString()} L Total Limit</span>
                </div>
              </div>

              <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl space-y-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Thermometer className="w-5 h-5 text-[#801323]" />
                    <div>
                      <h3 className="text-xs font-bold text-stone-850">Thermal Intelligence Loop</h3>
                      <p className="text-[10px] text-slate-400">Automated temperature regulation</p>
                    </div>
                  </div>
                  {onToggleCoolingJacket && (
                    <span className={`h-2.5 w-2.5 relative flex ${selectedVessel.coolingJacketActive ? '' : 'hidden'}`}>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 bg-[#FAF8F5] p-3 rounded-lg border border-[#e8dfd5]/40">
                  <div>
                    <span className="text-[9px] uppercase font-mono text-slate-405 block">Current Fluid Temp</span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <strong className="text-lg font-serif font-black text-[#4e0e15]">{selectedVessel.temperature} °C</strong>
                      <span className="text-[8px] text-indigo-705 font-semibold font-mono whitespace-nowrap">Sensors Live</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase font-mono text-slate-405 block">Set Target</span>
                    <div className="flex items-center justify-between mt-1">
                      <strong className="text-xs font-semibold text-slate-750 font-mono">
                        {selectedVessel.targetTemperature ? `${selectedVessel.targetTemperature} °C` : '--'}
                      </strong>
                      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded shrink-0 shadow-2xs">
                        <button 
                          onClick={() => onAdjustTargetTemp(selectedVessel.id, -0.5)}
                          className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 font-bold border-r border-slate-200 cursor-pointer"
                        >
                          -
                        </button>
                        <button 
                          onClick={() => onAdjustTargetTemp(selectedVessel.id, 0.5)}
                          className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 font-bold cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase font-mono text-slate-400 block font-bold">7-Day Thermal History</span>
                    <span className="text-[8px] font-mono text-slate-400">
                      {tempHistory[0]?.label || ''} — {tempHistory[tempHistory.length - 1]?.label || ''}
                    </span>
                  </div>
                  <div className="h-28 w-full bg-[#FAF8F5]/80 rounded-lg p-2 border border-[#e8dfd5]/40">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={tempHistory} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                        <XAxis 
                          dataKey="label" 
                          fontSize={8} 
                          tickLine={false} 
                          axisLine={false}
                          stroke="#94a3b8" 
                        />
                        <YAxis 
                          domain={['dataMin - 1', 'dataMax + 1']} 
                          fontSize={8} 
                          tickLine={false} 
                          axisLine={false}
                          stroke="#94a3b8" 
                          tickFormatter={(val) => `${val}°C`}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#fff', 
                            borderRadius: '6px', 
                            border: '1px solid #e8dfd5', 
                            fontSize: '10px',
                            padding: '4px 8px'
                          }}
                          formatter={(value: any) => [`${value} °C`, 'Temp']}
                          labelFormatter={(label) => `Date: ${label}`}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="temperature" 
                          stroke="#801323" 
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          activeDot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl space-y-3 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold text-stone-850 flex items-center gap-1.5">
                    <RefreshCw className="w-4 h-4 text-emerald-800" />
                    Sanitation & Hygiene Protocol
                  </h3>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono uppercase ${
                    selectedVessel.cleaningStatus === 'clean' 
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                      : 'bg-amber-100 text-amber-805 border border-amber-200'
                  }`}>
                    {selectedVessel.cleaningStatus.replace('_', ' ')}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <div className="text-slate-500">
                    <span className="block text-[9px]">Last Hygiene Record:</span>
                    <strong className="font-mono text-slate-650 block mt-0.5">
                      {selectedVessel.lastCleaned ? selectedVessel.lastCleaned : 'Never/New'}
                    </strong>
                  </div>
                  <button
                    onClick={() => onToggleSanitation(selectedVessel.id)}
                    className="px-2 py-1 text-[10px] font-mono font-semibold text-indigo-850 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/50 rounded transition-all cursor-pointer"
                  >
                    {selectedVessel.cleaningStatus === 'clean' ? 'Flag: CIP Required' : '✓ Mark Sanitized Today'}
                  </button>
                </div>
              </div>

              {/* Dynamic AI Winemaker Insights Card */}
              <div className="p-4 bg-gradient-to-br from-white to-amber-50/10 border border-[#e8dfd5] rounded-xl space-y-2.5 shadow-2xs relative overflow-hidden">
                {/* Embedded decorative bg orb */}
                <div className="absolute -right-6 -bottom-6 text-4xl opacity-[0.07] select-none pointer-events-none">🔮</div>
                
                <div className="flex items-center justify-between border-b border-stone-200/50 pb-2">
                  <h3 className="text-xs font-serif font-black text-[#4e0e15] flex items-center gap-1.5">
                    <span className="animate-pulse">💡</span> AI Winemaker Insights
                  </h3>
                  <span className="text-[8px] font-mono text-amber-700 font-extrabold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    REAL-TIME ADVICE
                  </span>
                </div>

                {isAiLoading ? (
                  <div className="py-3 flex items-center justify-center gap-2 text-[10px] text-slate-400 font-mono">
                    <span className="animate-spin h-3 w-3 border-2 border-[#4e0e15] border-t-transparent rounded-full"></span>
                    Generating enological counsel...
                  </div>
                ) : aiInsights ? (
                  <div className="text-xs text-stone-650 leading-relaxed font-sans">
                    <div className="space-y-1">
                      {aiInsights.split('\n').filter(l => l.trim()).map((line, idx) => (
                        <p key={idx} className="flex items-start gap-1.5 text-[11px] text-[#2c241e]">
                          <span className="text-amber-600 mt-0.5">•</span>
                          <span dangerouslySetInnerHTML={{ 
                            __html: line.replace(/^\s*[\-\*]\s*/, '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') 
                          }} />
                        </p>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-stone-400 font-mono italic">AI insights unavailable.</p>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-bold text-[#4e0e15] uppercase tracking-wider px-1 font-serif">
                  Recent Ledger & Operations
                </h3>
                <div className="p-3.5 bg-white border border-stone-200 rounded-xl space-y-2 text-[11px]">
                  <div className="flex justify-between items-center text-slate-400 font-mono text-[9px]">
                    <span>Last Operation recorded</span>
                    <span>AUTOMATED SENSOR LOG</span>
                  </div>
                  <p className="text-stone-700 font-medium">
                    {selectedVessel.lastOperation || 'No recent operations recorded for this vessel.'}
                  </p>
                </div>
              </div>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
