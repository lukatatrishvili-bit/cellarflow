'use client';

import React, { useState } from 'react';
import { translations, Language } from '../lib/i18n';
import { WineLot, Vessel, DailyFermLog } from '../lib/wineryState';
import { 
  Plus, 
  Trash2, 
  Flame, 
  Droplet, 
  Compass, 
  Activity, 
  CheckCircle, 
  Thermometer, 
  TrendingDown, 
  Hourglass,
  FlaskConical,
  MessageSquare,
  Sparkles,
  Info,
  X
} from 'lucide-react';
import FermentationCurveChart from './FermentationCurveChart';

interface Props {
  lang: Language;
  vessels: Vessel[];
  lots: WineLot[];
  fermLogs: DailyFermLog[];
  onUpdateLots: (newLots: WineLot[]) => void;
  onUpdateVessels: (newVessels: Vessel[]) => void;
  onUpdateFermLogs: (newLogs: DailyFermLog[]) => void;
}

export default function FermentationTab({ 
  lang, 
  vessels, 
  lots, 
  fermLogs, 
  onUpdateLots, 
  onUpdateVessels, 
  onUpdateFermLogs 
}: Props) {
  const t = translations[lang];

  // Active fermenting lots
  const activeFerments = lots.filter(l => l.stage === 'fermenting');

  // Chart lot selector state
  const [chartLotId, setChartLotId] = useState<string>(
    activeFerments[0]?.id || (fermLogs.length > 0 ? fermLogs[0].lotId : '')
  );

  // Expanded log input for specific lot card
  const [expLogFormLotId, setExpLogFormLotId] = useState<string | null>(null);

  // Unified logger states (for log forms)
  const [logTankId, setLogTankId] = useState('');
  const [logTemp, setLogTemp] = useState(19.5);
  const [logDensity, setLogDensity] = useState(1.012);
  const [logSugar, setLogSugar] = useState(24);
  const [logPH, setLogPH] = useState(3.45);
  const [logNotes, setLogNotes] = useState('');
  const [logCap, setLogCap] = useState('Punchdowns - 2X');
  const [logAdditives, setLogAdditives] = useState('None');

  // General add log form state
  const [showGeneralForm, setShowGeneralForm] = useState(false);
  const [generalLotId, setGeneralLotId] = useState('');

  // Committing log entry
  const handleCommitLog = (lotId: string, tankId: string) => {
    if (!lotId || !tankId) {
      alert('Please configure both Lot and Vessel identifiers.');
      return;
    }

    const newLog: DailyFermLog = {
      id: `flog-${Date.now()}`,
      tankId: tankId,
      lotId: lotId,
      date: new Date().toISOString().split('T')[0],
      temperature: logTemp,
      density: logDensity,
      sugar: logSugar,
      ph: logPH,
      tastingNotes: logNotes || 'Caps look active and well-hydrated. Sound vinification kinetics.',
      capManagement: logCap,
      additives: logAdditives
    };

    const updatedLogs = [newLog, ...fermLogs];
    onUpdateFermLogs(updatedLogs);

    // Update wine lot history
    const updatedLots = lots.map(l => {
      if (l.id === lotId) {
        return {
          ...l,
          history: [
            {
              date: new Date().toISOString().split('T')[0],
              type: 'Fermentation Log Entry',
              description: `Density: ${logDensity} SG, Sugar: ${logSugar} g/L, Temp: ${logTemp}°C. Cap: ${logCap}. Note: ${logNotes || 'OK'}`,
              operator: 'S. Rossi'
            },
            ...l.history
          ]
        };
      }
      return l;
    });
    onUpdateLots(updatedLots);

    // Also update vessel stats
    const updatedVessels = vessels.map(v => {
      if (v.id === tankId) {
        return {
          ...v,
          temperature: logTemp
        };
      }
      return v;
    });
    onUpdateVessels(updatedVessels);

    // Reset log inputs
    setLogNotes('');
    setLogAdditives('None');
    setExpLogFormLotId(null);
    setShowGeneralForm(false);
  };

  const handleOpenLotLogForm = (lot: WineLot) => {
    // Find vessel this lot is assigned to
    const associatedVessel = vessels.find(v => v.assignedLotId === lot.id);
    setLogTankId(associatedVessel ? associatedVessel.id : '');
    setExpLogFormLotId(lot.id);
    
    // Default reasonable entries
    const lotLogs = fermLogs.filter(log => log.lotId === lot.id);
    if (lotLogs.length > 0) {
      const lastLog = lotLogs[0];
      setLogTemp(lastLog.temperature);
      // Deplete a bit for easier mock tracking
      setLogDensity(parseFloat(Math.max(0.990, lastLog.density - 0.005).toFixed(3)));
      setLogSugar(Math.max(0, Math.round(lastLog.sugar * 0.7)));
      setLogPH(lastLog.ph);
    } else {
      setLogTemp(20.0);
      setLogDensity(1.085);
      setLogSugar(200);
      setLogPH(3.40);
    }
  };

  // Mark fermentation as finished (transition lot stage for stabilization or barrel aging)
  const finishFermentationStage = (lotId: string) => {
    const confirmFinish = window.confirm(
      'Are you sure you want to mark this fermentation campaign as completed? This will update the Processing Stage of the Lot to "malolactic_fermentation".'
    );
    if (!confirmFinish) return;

    onUpdateLots(
      lots.map(l => {
        if (l.id === lotId) {
          return {
            ...l,
            stage: 'stabilization' as any,
            history: [
              {
                date: new Date().toISOString().split('T')[0],
                type: 'Fermentation Concluded',
                description: 'Primary yeast fermentation fully concluded. Dry status verified. Transferred or stabilized for MLF secondary inoculation.',
                operator: 'Sofia Rossi'
              },
              ...l.history
            ]
          };
        }
        return l;
      })
    );
  };

  // Delete a logged entry
  const handleDeleteLog = (logId: string) => {
    if (window.confirm('Delete this primary fermentation tracking point from historical ledger?')) {
      onUpdateFermLogs(fermLogs.filter(log => log.id !== logId));
    }
  };

  // Math helper stats
  const isSluggish = (lotId: string): boolean => {
    const lLogs = fermLogs.filter(log => log.lotId === lotId);
    if (lLogs.length < 2) return false;
    const latest = lLogs[0];
    const prev = lLogs[1];
    return latest.sugar > 20 && Math.abs(latest.sugar - prev.sugar) < 2;
  };

  const hotTanksCount = vessels.filter(v => v.currentVolume > 0 && v.temperature && v.temperature > 28).length;
  const slowFermsCount = activeFerments.filter(l => isSluggish(l.id)).length;

  return (
    <div className="space-y-6 text-stone-850">
      
      {/* High-end stats widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Active Ferments</span>
            <strong className="text-xl font-serif font-black text-[#4e0e15]">{activeFerments.length} Campaigns</strong>
          </div>
          <div className="p-3.5 bg-rose-50 rounded-lg text-[#801323] shrink-0">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
        </div>

        <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Hot Vessel Warning</span>
            <strong className="text-xl font-serif font-black text-amber-900">{hotTanksCount} Tanks &gt;28°C</strong>
          </div>
          <div className={`p-3.5 rounded-lg shrink-0 ${hotTanksCount > 0 ? 'bg-amber-100 text-amber-700 animate-bounce' : 'bg-slate-50 text-slate-400'}`}>
            <Flame className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Stuck / Sluggish Risk</span>
            <strong className="text-xl font-serif font-black text-rose-800">{slowFermsCount} Lots Flagged</strong>
          </div>
          <div className={`p-3.5 rounded-lg shrink-0 ${slowFermsCount > 0 ? 'bg-red-50 text-red-650' : 'bg-slate-50 text-slate-400'}`}>
            <TrendingDown className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Fermentation Logs</span>
            <strong className="text-xl font-serif font-black text-[#4e0e15]">{fermLogs.length} Entries</strong>
          </div>
          <div className="p-3.5 bg-amber-50 rounded-lg text-amber-700 shrink-0">
            <Hourglass className="w-5 h-5" />
          </div>
        </div>

      </div>

      {/* Main interactive workflow and layouts grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* Left column: Active Fermentations progress list with in-line input forms */}
        <div className="xl:col-span-4 space-y-4">
          <div className="flex items-center justify-between border-b border-[#e8dfd5] pb-2">
            <h3 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-1.5">
              <FlaskConical className="w-4 h-4 text-[#801323]" /> Active Yeast Ferments
            </h3>
            <button
              onClick={() => {
                setShowGeneralForm(!showGeneralForm);
                setExpLogFormLotId(null);
                if (activeFerments.length > 0) {
                  setGeneralLotId(activeFerments[0].id);
                  const associated = vessels.find(v => v.assignedLotId === activeFerments[0].id);
                  setLogTankId(associated ?? associated ? associated.id : '');
                }
              }}
              className="px-2.5 py-1 text-[11px] font-bold text-[#4e0e15] bg-[#f5efe9] border border-[#dcd0c0] hover:bg-[#eadecd] rounded-lg transition-colors cursor-pointer"
            >
              + Standard Log Entry
            </button>
          </div>

          {/* Quick-add general entry form drawer */}
          {showGeneralForm && (
            <div className="p-4 bg-[#FCFAF8] border border-stone-250 rounded-xl space-y-3 shadow-xs">
              <div className="flex items-center justify-between border-b border-stone-200 pb-2">
                <span className="text-[10px] font-mono font-bold uppercase text-[#4e0e15]">Register Ferment Parameters</span>
                <button onClick={() => setShowGeneralForm(false)} className="text-slate-400 hover:text-slate-700 p-0.5 rounded cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Select Active Wine Lot</label>
                  <select
                    value={generalLotId}
                    onChange={(e) => {
                      setGeneralLotId(e.target.value);
                      const associated = vessels.find(v => v.assignedLotId === e.target.value);
                      setLogTankId(associated ? associated.id : '');
                    }}
                    className="w-full px-2 py-1 text-xs border rounded bg-white text-stone-800"
                  >
                    {activeFerments.map(l => (
                      <option key={l.id} value={l.id}>{l.name} ({l.id})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Assigned Vessel / Tank</label>
                    <input
                      type="text"
                      disabled
                      value={logTankId || 'None assigned'}
                      className="w-full px-2 py-1 text-xs border bg-stone-100 rounded text-stone-500 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Temperature (°C)</label>
                    <input
                      type="number" step="0.1" value={logTemp}
                      onChange={(e) => setLogTemp(parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white text-stone-880"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Specific Gravity (SG)</label>
                    <input
                      type="number" step="0.001" value={logDensity}
                      onChange={(e) => setLogDensity(parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Residual Sugar (g/L)</label>
                    <input
                      type="number" value={logSugar}
                      onChange={(e) => setLogSugar(parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">pH</label>
                    <input
                      type="number" step="0.01" value={logPH}
                      onChange={(e) => setLogPH(parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Cap Operations</label>
                    <select
                      value={logCap}
                      onChange={(e) => setLogCap(e.target.value)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white text-stone-800"
                    >
                      <option value="None - Whites">None / Sedimentation (Whites)</option>
                      <option value="Punchdowns - 1X Daily">Punchdown - 1X daily</option>
                      <option value="Punchdowns - 2X Daily">Punchdowns - 2X daily (Reds)</option>
                      <option value="Pumpover - Gentle 15m">Pumpover - Gentle (15 min)</option>
                      <option value="Pumpover - Strong 30m">Pumpover - Strong (30 min)</option>
                      <option value="Délestage (Rack & Return)">Délestage (Rack & Return)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Yeast Nutrient / Additives Pitching</label>
                  <input
                    type="text"
                    value={logAdditives}
                    placeholder="e.g. 15g DAP, Go-Ferm sterols, enzymes, or None"
                    onChange={(e) => setLogAdditives(e.target.value)}
                    className="w-full px-2 py-1 text-xs border rounded bg-white text-stone-800"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">Organoleptic / Tasting Notes</label>
                  <textarea
                    value={logNotes}
                    placeholder="Notes on cap integrity, gas evolution, carbon dioxide aromas"
                    onChange={(e) => setLogNotes(e.target.value)}
                    className="w-full px-2 py-1 text-xs border rounded h-14 bg-white text-stone-800"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => handleCommitLog(generalLotId, logTankId)}
                  className="w-full py-1.5 bg-[#4e0e15] hover:bg-[#6b151e] text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors"
                >
                  Commit Entry
                </button>
              </div>
            </div>
          )}

          {/* Active lots list items container */}
          <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
            {activeFerments.map(lot => {
              const associatedVessel = vessels.find(v => v.assignedLotId === lot.id);
              const lotLogs = fermLogs.filter(log => log.lotId === lot.id);
              const latestLog = lotLogs[0];
              const isFormExp = expLogFormLotId === lot.id;

              return (
                <div 
                  key={lot.id} 
                  className={`p-4 bg-white border border-[#e8dfd5] rounded-xl hover:shadow-xs transition-shadow space-y-4 ${
                    isFormExp ? 'ring-1.5 ring-[#4e0e15]' : ''
                  }`}
                >
                  {/* Lot details header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xs font-serif font-bold text-stone-900">{lot.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                        {lot.id} • {associatedVessel ? associatedVessel.id : 'No Vessel'}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className="text-[9px] font-mono px-1.5 py-0.5 font-bold bg-[#FAF8F5] text-[#801323] border border-red-105 rounded uppercase">
                        🔬 {lot.wineClass} Wine
                      </span>
                      {isSluggish(lot.id) && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 font-black bg-rose-50 text-rose-700 border border-rose-200 rounded uppercase flex items-center gap-1 animate-pulse">
                          ⚠️ Sluggish
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Chemistry overview widget */}
                  <div className="grid grid-cols-4 gap-1 p-2 bg-stone-50 rounded-lg text-center font-mono">
                    <div className="border-r border-stone-200">
                      <span className="text-[8px] text-slate-400 block uppercase">Temp</span>
                      <strong className="text-[11px] text-stone-800 whitespace-nowrap">
                        {latestLog ? `${latestLog.temperature} °C` : '--'}
                      </strong>
                    </div>
                    <div className="border-r border-stone-200">
                      <span className="text-[8px] text-slate-400 block uppercase">Density</span>
                      <strong className="text-[11px] text-stone-800 block leading-tight truncate">
                        {latestLog ? latestLog.density : '--'}
                      </strong>
                    </div>
                    <div className="border-r border-stone-200">
                      <span className="text-[8px] text-slate-400 block uppercase">Sugar</span>
                      <strong className="text-[11px] text-stone-800 leading-tight block">
                        {latestLog ? `${latestLog.sugar} g/L` : '--'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[8px] text-slate-400 block uppercase">pH</span>
                      <strong className="text-[11px] text-stone-800">
                        {latestLog ? latestLog.ph : '--'}
                      </strong>
                    </div>
                  </div>

                  {/* Sensory notes and operations status */}
                  {latestLog && (
                    <div className="space-y-1 bg-amber-50/20 border border-amber-100 p-2.5 rounded-lg text-xs leading-relaxed">
                      <div className="flex items-center gap-1 font-mono text-[9px] text-[#4e0e15] font-black uppercase">
                        <MessageSquare className="w-3 h-3 text-[#801323]" />
                        Latest Lot Tasting Remarks
                      </div>
                      <p className="text-[11px] text-stone-600 font-serif italic">
                        &ldquo;{latestLog.tastingNotes}&rdquo;
                      </p>
                    </div>
                  )}

                  {/* Actions Bar */}
                  <div className="flex items-center gap-1.5 border-t border-dashed border-stone-205 pt-3">
                    <button
                      onClick={() => handleOpenLotLogForm(lot)}
                      className="flex-1 py-1 text-[10.5px] font-bold text-white bg-[#4e0e15] hover:bg-[#6b151e] rounded shadow-2xs transition-all cursor-pointer text-center"
                    >
                      📝 Log Today
                    </button>
                    <button
                      onClick={() => finishFermentationStage(lot.id)}
                      className="px-2.5 py-1 text-[10px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded transition-colors cursor-pointer"
                    >
                      ✓ Completed
                    </button>
                  </div>

                  {/* In-line form specifically for this card */}
                  {isFormExp && (
                    <div className="border-t border-stone-200/80 pt-3 mt-3 space-y-3 bg-[#FCFAF8] p-3 rounded-lg border">
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#801323] font-bold">
                        <span>Log kinetic stats for {lot.id}</span>
                        <button onClick={() => setExpLogFormLotId(null)} className="text-stone-400 hover:text-stone-700">Cancel</button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-medium text-slate-500">Temp (°C)</label>
                          <input
                            type="number" step="0.1" value={logTemp}
                            onChange={(e) => setLogTemp(parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-0.5 text-xs border rounded bg-white text-stone-800 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-medium text-slate-500">Density / SG</label>
                          <input
                            type="number" step="0.001" value={logDensity}
                            onChange={(e) => setLogDensity(parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-0.5 text-xs border rounded bg-white font-mono"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[9px] font-medium text-slate-500">Sugar (g/L)</label>
                          <input
                            type="number" value={logSugar}
                            onChange={(e) => setLogSugar(parseInt(e.target.value) || 0)}
                            className="w-full px-2 py-0.5 text-xs border rounded bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-medium text-slate-500">pH</label>
                          <input
                            type="number" step="0.01" value={logPH}
                            onChange={(e) => setLogPH(parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-0.5 text-xs border rounded bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-medium text-slate-500">Vessel</label>
                          <input
                            type="text" disabled value={logTankId || 'T-1'}
                            className="w-full px-2 py-0.5 text-xs border bg-stone-100 rounded text-stone-400 font-bold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[9px] font-medium text-slate-500">Cap Management Routine</label>
                        <select
                          value={logCap}
                          onChange={(e) => setLogCap(e.target.value)}
                          className="w-full px-2 py-1 text-xs border rounded bg-white"
                        >
                          <option value="Punchdowns - 2X Daily">Punchdowns - 2X Daily</option>
                          <option value="Pumpover - Gentle 15m">Pumpover - Gentle 15m</option>
                          <option value="Punchdown - Manual 1X">Punchdown - Manual 1X</option>
                          <option value="Délestage (Rack & Return)">Délestage (Rack & Return)</option>
                          <option value="None (Inert static environment)">None (Whites/Clay)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[9px] font-medium text-slate-500">Added Ingredients / Nutrients</label>
                        <input
                          type="text"
                          value={logAdditives}
                          onChange={(e) => setLogAdditives(e.target.value)}
                          placeholder="None, or e.g. 15kg Enartis Yeast Nutrition"
                          className="w-full px-2 py-0.5 text-xs border rounded bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] font-medium text-slate-500">Daily Tasting Reflections</label>
                        <textarea
                          value={logNotes}
                          placeholder="Arresting fruit esters, dynamic density decrease..."
                          onChange={(e) => setLogNotes(e.target.value)}
                          className="w-full px-2 py-1 text-xs border rounded h-14 bg-white"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCommitLog(lot.id, associatedVessel ? associatedVessel.id : 'Tank T-1')}
                        className="w-full py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold rounded cursor-pointer"
                      >
                        Commit Log Entry
                      </button>
                    </div>
                  )}

                </div>
              );
            })}
            
            {activeFerments.length === 0 && (
              <div className="p-8 text-center border-2 border-dashed border-[#e8dfd5] rounded-xl text-slate-400 italic font-serif">
                No active fermentation campaigns. Update a Lot stage to &ldquo;fermenting&rdquo; to begin tracking kinetics here.
              </div>
            )}
          </div>

        </div>

        {/* Right column: Charts & Ledgers */}
        <div className="xl:col-span-8 space-y-6">
          
          {/* Interactive curves visualizer */}
          <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-xs text-stone-850 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3">
              <div>
                <h3 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-1">
                  <span className="text-red-800">📊</span> Live Kinetic Fermentation Curves
                </h3>
                <p className="text-[10px] text-slate-400 font-medium">Dual-axes real-time depletion curves for Sugar (ruby red) & Density drop (amber gold)</p>
              </div>

              <div>
                <select
                  value={chartLotId}
                  onChange={(e) => setChartLotId(e.target.value)}
                  className="text-xs font-semibold px-3 py-1 bg-[#FAF8F5] border border-stone-200 rounded-lg outline-none w-full sm:w-56 cursor-pointer"
                >
                  <option value="">-- Choose Lot to Chart --</option>
                  {Array.from(new Set(fermLogs.map(l => l.lotId))).map(lId => {
                    const associatedLot = lots.find(lt => lt.id === lId);
                    return (
                      <option key={lId} value={lId}>
                        📈 {associatedLot ? associatedLot.name : lId} ({lId})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {chartLotId ? (
              <FermentationCurveChart logs={fermLogs} selectedLotId={chartLotId} />
            ) : (
              <div className="py-24 text-center border-2 border-dashed border-stone-100 text-stone-400 italic">
                Select a wine lot from the dropdown options above to inspect visual kinetic curves.
              </div>
            )}
          </div>

          {/* Master fermentation logs ledger list */}
          <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-xs text-stone-850 space-y-4">
            <h3 className="text-sm font-serif font-bold text-stone-900 flex items-center gap-1 border-b border-stone-100 pb-2">
              📋 Posted Primary Fermentation Journal
            </h3>

            <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
              {fermLogs.map(log => {
                const lot = lots.find(l => l.id === log.lotId);
                return (
                  <div key={log.id} className="p-3.5 bg-stone-50 border border-stone-150 rounded-xl hover:border-slate-305 transition-colors">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-705">
                      <span className="flex items-center gap-1.5 font-sans">
                        <span className="text-purple-900">🍇</span>
                        <strong>{lot ? lot.name : log.lotId}</strong>
                        <span className="text-[10px] bg-white border px-1.5 py-0.2 rounded text-slate-455 font-mono">Vessel: {log.tankId}</span>
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-slate-400 font-mono">{log.date}</span>
                        <button
                          title="Delete Entry"
                          onClick={() => handleDeleteLog(log.id)}
                          className="text-slate-300 hover:text-red-600 transition-colors p-1 rounded-full hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-slate-500 font-mono mt-2 bg-white/70 p-2 border rounded-lg">
                      <div className="flex items-baseline gap-1">Temp: <strong className="text-stone-800 text-xs font-black">{log.temperature} °C</strong></div>
                      <div className="flex items-baseline gap-1">Density: <strong className="text-stone-850 text-xs font-bold">{log.density} SG</strong></div>
                      <div className="flex items-baseline gap-1 font-sans">Sugar: <strong className="text-stone-800 font-bold block">{log.sugar} g/L</strong></div>
                      <div className="flex items-baseline gap-1">pH: <strong className="text-slate-700 text-xs">{log.ph}</strong></div>
                    </div>

                    {/* Cap & Additives specs block */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 text-[10px] text-stone-600 font-medium">
                      <div className="bg-[#FAF8F5] px-2.5 py-1.5 border border-stone-200/50 rounded-lg flex items-center gap-1.5">
                        <span className="font-bold underline text-[#4e0e15] uppercase text-[8px] font-mono shrink-0">Cap Ops:</span>
                        <span className="truncate">{log.capManagement || 'No active skin operations logged'}</span>
                      </div>
                      <div className="bg-indigo-50/20 px-2.5 py-1.5 border border-indigo-100/60 rounded-lg flex items-center gap-1.5">
                        <span className="font-bold underline text-indigo-750 uppercase text-[8px] font-mono shrink-0">Additives:</span>
                        <span className="truncate">{log.additives || 'None'}</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-stone-600 italic bg-white p-2.5 border border-slate-100 rounded-lg mt-2 font-serif">
                      &quot;{log.tastingNotes}&quot;
                    </p>
                  </div>
                );
              })}

              {fermLogs.length === 0 && (
                <p className="p-8 text-stone-400 italic text-center font-serif">No fermentation log ledger entries recorded.</p>
              )}
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
