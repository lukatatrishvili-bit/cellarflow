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
  onUpdateVessels?: (newVessels: Vessel[]) => void;
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
  onToggleCoolingJacket,
  onUpdateVessels
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

  // Edit States
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState('');
  const [editType, setEditType] = useState<any>('stainless_steel');
  const [editShape, setEditShape] = useState<any>('vertical');
  const [editCapacity, setEditCapacity] = useState(1000);
  const [editLocationDetails, setEditLocationDetails] = useState('');
  const [editLastSealedDate, setEditLastSealedDate] = useState('');
  const [editSoilTemperature, setEditSoilTemperature] = useState(15);

  useEffect(() => {
    if (selectedVessel) {
      setEditId(selectedVessel.id);
      setEditType(selectedVessel.type);
      setEditShape(selectedVessel.shape);
      setEditCapacity(selectedVessel.capacity);
      setEditLocationDetails(selectedVessel.locationDetails || '');
      setEditLastSealedDate(selectedVessel.lastSealedDate || '');
      setEditSoilTemperature(selectedVessel.soilTemperature ?? (selectedVessel.temperature - 2.5));
      setIsEditing(false);
    }
  }, [selectedTankId, selectedVessel]);

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
            className="fixed inset-y-0 right-0 z-50 w-full sm:w-[600px] lg:w-[680px] bg-[#FAF8F5] dark:bg-[#140d0e] shadow-2xl border-l border-[#f0e6da] dark:border-[#2a1618] flex flex-col focus:outline-none text-stone-800 dark:text-stone-200"
          >
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              
              <div className="flex items-start justify-between border-b border-[#e8dfd5] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase bg-amber-100 text-amber-955 px-2 py-0.5 rounded font-bold tracking-wider inline-block">
                      Cellar Core Vessel
                    </span>
                    <button 
                      onClick={() => setIsEditing(!isEditing)}
                      className="text-stone-500 hover:text-[#4e0e15] text-[10px] font-mono font-bold transition-colors cursor-pointer select-none border border-stone-250 px-1.5 rounded"
                      title="Edit Properties"
                    >
                      ✏️ {lang === 'ka' ? 'შეცვლა' : 'Edit'}
                    </button>
                  </div>
                  <h2 className="text-xl font-serif font-bold text-[#4e0e15] mt-1">{selectedVessel.id}</h2>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{selectedVessel.locationDetails || 'Cellar Room A, main row'}</p>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-full hover:bg-stone-200/50 text-stone-505 hover:text-stone-800 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {isEditing ? (
                <form onSubmit={(e) => {
                  e.preventDefault();
                  if (!selectedVessel || !onUpdateVessels) return;
                  
                  if (editId.trim() !== selectedVessel.id && vessels.some(v => v.id === editId.trim())) {
                    alert(lang === 'ka' ? 'ეს ID უკვე გამოყენებულია სხვა ჭურჭლისთვის.' : 'This Vessel ID is already in use by another vessel.');
                    return;
                  }

                  const updatedVessels = vessels.map(v => {
                    if (v.id === selectedVessel.id) {
                      return {
                        ...v,
                        id: editId.trim(),
                        type: editType,
                        shape: editShape,
                        capacity: Number(editCapacity) || 0,
                        locationDetails: editLocationDetails,
                        lastSealedDate: editType === 'qvevri' ? editLastSealedDate : undefined,
                        soilTemperature: editType === 'qvevri' ? Number(editSoilTemperature) : undefined
                      };
                    }
                    return v;
                  });

                  onUpdateVessels(updatedVessels);
                  setIsEditing(false);
                }} className="space-y-4 bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs text-stone-700">
                  <h3 className="text-xs uppercase font-mono tracking-widest text-[#4e0e15] font-black border-b pb-1.5 mb-3 flex justify-between items-center">
                    <span>✏️ {lang === 'ka' ? 'პარამეტრების რედაქტირება' : 'Edit Vessel Properties'}</span>
                  </h3>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block text-[9px] uppercase font-mono text-slate-400 font-bold mb-1">Vessel ID / Identifier *</label>
                      <input 
                        type="text" required
                        value={editId} onChange={(e) => setEditId(e.target.value)}
                        className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded font-bold text-stone-900 focus:bg-white outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-400 font-bold mb-1">Vessel Type</label>
                        <select 
                          value={editType} onChange={(e) => setEditType(e.target.value as any)}
                          className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded font-bold text-stone-900 outline-none"
                        >
                          <option value="stainless_steel">Stainless Steel</option>
                          <option value="qvevri">Clay Qvevri</option>
                          <option value="barrel">Oak Barrel</option>
                          <option value="plastic">Plastic Tank</option>
                          <option value="concrete">Concrete Egg</option>
                          <option value="other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-400 font-bold mb-1">Profile Shape</label>
                        <select 
                          value={editShape} onChange={(e) => setEditShape(e.target.value as any)}
                          className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded font-bold text-stone-900 outline-none"
                        >
                          <option value="vertical">Vertical</option>
                          <option value="horizontal">Horizontal</option>
                          <option value="conical">Conical</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-400 font-bold mb-1">Total Capacity (Liters) *</label>
                        <input 
                          type="number" required min="1"
                          value={editCapacity} onChange={(e) => setEditCapacity(Number(e.target.value) || 0)}
                          className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded font-semibold text-stone-850 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-400 font-bold mb-1">Location Details</label>
                        <input 
                          type="text"
                          value={editLocationDetails} onChange={(e) => setEditLocationDetails(e.target.value)}
                          className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded text-stone-800 outline-none"
                          placeholder="e.g. Cellar Room A"
                        />
                      </div>
                    </div>

                    {editType === 'qvevri' && (
                      <div className="grid grid-cols-2 gap-3 bg-[#FCFAF8] p-3 rounded-lg border border-amber-200">
                        <div>
                          <label className="block text-[9px] uppercase font-mono text-amber-800 font-bold mb-1">Last Sealed Date</label>
                          <input 
                            type="date"
                            value={editLastSealedDate} onChange={(e) => setEditLastSealedDate(e.target.value)}
                            className="w-full bg-white border border-[#e8dfd5] p-1.5 rounded outline-none text-stone-800"
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] uppercase font-mono text-amber-800 font-bold mb-1">Soil Temperature (°C)</label>
                          <input 
                            type="number" step="0.1"
                            value={editSoilTemperature} onChange={(e) => setEditSoilTemperature(Number(e.target.value) || 0)}
                            className="w-full bg-white border border-[#e8dfd5] p-1.5 rounded outline-none text-stone-800 font-mono"
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <button 
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="flex-1 bg-stone-200 hover:bg-stone-300 text-stone-700 font-mono font-bold uppercase py-2.5 rounded-lg text-[10px] cursor-pointer shadow-3xs transition-colors"
                      >
                        {lang === 'ka' ? 'გაუქმება' : 'Cancel'}
                      </button>
                      <button 
                        type="submit"
                        className="flex-1 bg-emerald-850 hover:bg-emerald-950 text-white font-mono font-bold uppercase py-2.5 rounded-lg text-[10px] cursor-pointer shadow-xs transition-colors"
                      >
                        {lang === 'ka' ? 'შენახვა' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <>
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

                  {selectedVessel.type === 'qvevri' ? (
                    <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl space-y-4 shadow-2xs">
                      <div className="flex items-center gap-2">
                        <Thermometer className="w-5 h-5 text-emerald-800" />
                        <div>
                          <h3 className="text-xs font-bold text-stone-850">{lang === 'ka' ? 'მიწისქვეშა თერმული მონიტორინგი' : 'Underground Thermal Monitoring'}</h3>
                          <p className="text-[10px] text-slate-400">{lang === 'ka' ? 'ქვევრის მიმდებარე ნიადაგის ტემპერატურა' : 'Clay vessel surrounding ground parameters'}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 bg-[#FAF8F5] p-3 rounded-lg border border-[#e8dfd5]/40">
                        <div>
                          <span className="text-[9px] uppercase font-mono text-slate-405 block">{lang === 'ka' ? 'ღვინის ტემპერატურა' : 'Internal Wine Temp'}</span>
                          <strong className="text-lg font-serif font-black text-[#4e0e15] mt-0.5 block">{selectedVessel.temperature} °C</strong>
                        </div>
                        <div>
                          <span className="text-[9px] uppercase font-mono text-slate-405 block">{lang === 'ka' ? 'ნიადაგის ტემპერატურა' : 'Surrounding Soil Temp'}</span>
                          <strong className="text-lg font-serif font-black text-emerald-800 mt-0.5 block">{(selectedVessel.soilTemperature ?? (selectedVessel.temperature - 2.5)).toFixed(1)} °C</strong>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-100 space-y-1.5">
                        <span className="text-[9px] uppercase font-mono text-slate-400 block font-bold">{lang === 'ka' ? 'ჰერმეტულობა და თიხის ლუქის ისტორია' : 'Airtightness & Clay Seal History'}</span>
                        {(() => {
                          const lastSealed = selectedVessel.lastSealedDate ? new Date(selectedVessel.lastSealedDate) : new Date(Date.now() - 45 * 86400000);
                          const diffDays = Math.round((Date.now() - lastSealed.getTime()) / (1000 * 60 * 60 * 24));
                          const needsReseal = diffDays > 120;
                          const formattedDate = selectedVessel.lastSealedDate || lastSealed.toISOString().split('T')[0];
                          return (
                            <div className={`p-3 rounded-lg border text-xs ${
                              needsReseal 
                                ? 'bg-red-50 border-red-200 text-red-950 animate-pulse' 
                                : 'bg-emerald-50 border-emerald-200 text-emerald-950'
                            }`}>
                              <strong className="block font-bold">
                                {needsReseal 
                                  ? (lang === 'ka' ? '⚠️ საჭიროებს სასწრაფო ხელახალ დალუქვას' : '⚠️ Urgent Beeswax Reseal Required') 
                                  : (lang === 'ka' ? '✓ ჰერმეტულობა დაცულია' : '✓ Airtightness Intact')}
                              </strong>
                              <p className="mt-1 text-[10px] leading-relaxed text-stone-500">
                                {lang === 'ka' 
                                  ? `ეს ქვევრი ბოლოს დაილუქა ${diffDays} დღის წინ (${formattedDate}). თიხის ლუქის ჰერმეტულობა უნდა განახლდეს ყოველ 120 დღეში ჟანგბადის შეღწევის თავიდან ასაცილებლად.`
                                  : `This vessel was last sealed ${diffDays} days ago (${formattedDate}). Beeswax seals must be audited or reapplied every 120 days to prevent oxidation and volatile acidity growth.`
                                }
                              </p>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
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
                    </div>
                  )}

                  <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl space-y-4 shadow-2xs">
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

                  <div className="p-4 bg-gradient-to-br from-white to-amber-50/10 border border-[#e8dfd5] rounded-xl space-y-2.5 shadow-2xs relative overflow-hidden">
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
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
