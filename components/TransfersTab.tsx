'use client';

import React, { useState, useEffect } from 'react';
import { translations, Language } from '../lib/i18n';
import { Vessel, WineLot } from '../lib/wineryState';
import { 
  RefreshCw, 
  ShieldAlert, 
  ArrowRight, 
  ShieldCheck, 
  CheckCircle2, 
  Trash2, 
  Flame, 
  Droplet,
  Shuffle,
  Compass,
  Sparkles,
  Info,
  Check,
  User,
  Activity
} from 'lucide-react';

interface Props {
  lang: Language;
  vessels: Vessel[];
  lots: WineLot[];
  onUpdateVessels: (newVessels: Vessel[]) => void;
  onUpdateLots: (newLots: WineLot[]) => void;
}

interface TransferRecord {
  id: string;
  sourceId: string;
  destId: string;
  volume: number;
  loss: number;
  operator: string;
  category: string;
  date: string;
  pump: string;
  details: string;
}

export default function TransfersTab({ lang, vessels, lots, onUpdateVessels, onUpdateLots }: Props) {
  const t = translations[lang];

  // Transfer input states
  const [sourceId, setSourceId] = useState<string>('');
  const [destId, setDestId] = useState<string>('');
  const [transferVol, setTransferVol] = useState<number>(500);
  const [pumpModel, setPumpModel] = useState<string>('Enopump E-400');
  const [lossVol, setLossVol] = useState<number>(4);
  const [operatorName, setOperatorName] = useState<string>('');
  const [reasonCategory, setReasonCategory] = useState<'racking' | 'blend' | 'filtration' | 'bottling'>('racking');
  const [operationReceipt, setOperationReceipt] = useState<string | null>(null);

  // Custom transfers list for persistence
  const [pastTransfers, setPastTransfers] = useState<TransferRecord[]>([]);

  // Load past transfers on mount
  useEffect(() => {
    const saved = localStorage.getItem('cf_transfers_history');
    if (saved) {
      setPastTransfers(JSON.parse(saved));
    } else {
      // Mock past transfers for beautiful UI filling
      const mockTransfers: TransferRecord[] = [
        {
          id: 'xfer-1',
          sourceId: 'Tank T-2',
          destId: 'Tank T-1',
          volume: 1200,
          loss: 8,
          operator: 'G. Tatrishvili',
          category: 'racking',
          date: '2026-05-24',
          pump: 'Enopump E-400',
          details: 'Decanted Cabernet lees post primary fermentation.'
        },
        {
          id: 'xfer-2',
          sourceId: 'B-1 (Barrel)',
          destId: 'Tank T-3',
          volume: 225,
          loss: 2,
          operator: 'S. Rossi',
          category: 'filtration',
          date: '2026-05-26',
          pump: 'Enopump Mini',
          details: 'Moved Chardonnay lot to tank for cold stabilization.'
        }
      ];
      setPastTransfers(mockTransfers);
      localStorage.setItem('cf_transfers_history', JSON.stringify(mockTransfers));
    }
  }, []);

  const saveTransfers = (newXfers: TransferRecord[]) => {
    setPastTransfers(newXfers);
    localStorage.setItem('cf_transfers_history', JSON.stringify(newXfers));
  };

  const sourceVessel = vessels.find(v => v.id === sourceId);
  const destVessel = vessels.find(v => v.id === destId);

  // Safety assessments
  const sourceIsEmpty = sourceVessel ? sourceVessel.currentVolume === 0 : true;
  const sourceHasInsufficient = sourceVessel ? sourceVessel.currentVolume < transferVol : true;
  
  const destCapRemaining = destVessel ? destVessel.capacity - destVessel.currentVolume : 0;
  const destWillOverflow = destVessel ? transferVol > destCapRemaining : true;

  // Wet blend warning
  const showsBlendAlert = sourceVessel && destVessel && 
                      sourceVessel.assignedLotId && destVessel.assignedLotId && 
                      sourceVessel.assignedLotId !== destVessel.assignedLotId;

  // Let's make an advanced calculation of resulting enological metrics (Weighted blend model!)
  const getBlendedPrediction = () => {
    if (!sourceVessel || !destVessel) return null;
    const sourceLot = lots.find(l => l.id === sourceVessel.assignedLotId);
    const destLot = lots.find(l => l.id === destVessel.assignedLotId);

    if (!sourceLot) return null;

    // Default mock chemistry values if not explicit
    const sourceABV = sourceVessel.id.includes('T-1') ? 13.5 : 14.2;
    const sourcepH = 3.42;
    const sourceSO2 = 25;

    // Dest values
    const destABV = destVessel.id.includes('T-3') ? 12.8 : 13.9;
    const destpH = 3.55;
    const destSO2 = 28;

    const vSource = transferVol - lossVol;
    const vDest = destVessel.currentVolume;
    const vTotal = vSource + vDest;

    if (vTotal === 0) return null;

    // If destination is empty, prediction is simply the incoming source
    if (vDest === 0) {
      return {
        abv: sourceABV,
        ph: sourcepH,
        so2: sourceSO2
      };
    }

    const blendedABV = parseFloat(((sourceABV * vSource + destABV * vDest) / vTotal).toFixed(2));
    const blendedpH = parseFloat(((sourcepH * vSource + destpH * vDest) / vTotal).toFixed(2));
    const blendedSO2 = Math.round((sourceSO2 * vSource + destSO2 * vDest) / vTotal);

    return {
      abv: blendedABV,
      ph: blendedpH,
      so2: blendedSO2
    };
  };

  const predictedBlend = getBlendedPrediction();

  // Execute transfer state
  const handleExecuteTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceVessel || !destVessel) return;
    if (sourceIsEmpty || sourceHasInsufficient || destWillOverflow) return;

    const opDate = new Date().toISOString().split('T')[0];
    const sourceLot = lots.find(l => l.id === sourceVessel.assignedLotId);
    const destLot = lots.find(l => l.id === destVessel.assignedLotId);

    // Calc volumes
    const finalSourceVolume = sourceVessel.currentVolume - transferVol;
    const finalTransferArrival = transferVol - lossVol;
    const finalDestVolume = destVessel.currentVolume + finalTransferArrival;

    let finalDestLotId = destVessel.assignedLotId || sourceVessel.assignedLotId;
    let newLots = [...lots];

    let detailedReceiptText = '';

    // Blended Genealogy
    if (showsBlendAlert && sourceLot && destLot) {
      const blendedLotId = `B-${sourceLot.id}-${destLot.id}`.slice(0, 15);
      const blendedName = `Assembly: ${sourceLot.name} / ${destLot.name}`;
      
      const prevDestAmount = destVessel.currentVolume;
      const pctSource = parseFloat((finalTransferArrival / (prevDestAmount + finalTransferArrival) * 100).toFixed(1));
      const pctDest = parseFloat((prevDestAmount / (prevDestAmount + finalTransferArrival) * 100).toFixed(1));

      const blendedLot: WineLot = {
        id: blendedLotId,
        name: blendedName,
        vintage: Math.max(sourceLot.vintage, destLot.vintage),
        variety: `${sourceLot.variety} (${pctSource}%) / ${destLot.variety} (${pctDest}%)`,
        vineyardBlock: `Combined inside ${destVessel.id}`,
        region: destLot.region,
        initialVolume: prevDestAmount + finalTransferArrival,
        currentVolume: prevDestAmount + finalTransferArrival,
        wineClass: destLot.wineClass,
        stage: 'aging',
        createdAt: opDate,
        history: [
          {
            date: opDate,
            type: 'Genealogy Merge Blend',
            description: `Merged ${finalTransferArrival}L of ${sourceLot.name} (${pctSource}%) with ${prevDestAmount}L of ${destLot.name} (${pctDest}%). Predicted ABV: ${predictedBlend?.abv}%, pH: ${predictedBlend?.ph}.`,
            operator: operatorName || 'Cuviste master'
          },
          ...destLot.history
        ]
      };

      newLots.push(blendedLot);
      finalDestLotId = blendedLotId;
      detailedReceiptText = `Merged into brand-new genealogy lot: "${blendedLotId}" (${pctSource}% source / ${pctDest}% dest). Predicted ABV: ${predictedBlend?.abv}%, pH: ${predictedBlend?.ph}.`;
      setOperationReceipt(detailedReceiptText);
    } else {
      // Normal single lot move
      if (sourceLot) {
        newLots = lots.map(l => {
          if (l.id === sourceLot.id) {
            return {
              ...l,
              currentVolume: Math.max(0, l.currentVolume - lossVol),
              history: [
                {
                  date: opDate,
                  type: 'Liquid Transfer',
                  description: `Pumped ${transferVol}L out of ${sourceVessel.id} to ${destVessel.id}. Logged loss: ${lossVol}L. Hoses sanitized.`,
                  operator: operatorName || 'Cuviste'
                },
                ...l.history
              ]
            };
          }
          return l;
        });
      }
      detailedReceiptText = `Successfully racked ${transferVol}L into ${destVessel.id}. Transferred wine assigned to lot ${finalDestLotId}.`;
      setOperationReceipt(detailedReceiptText);
    }

    // Update Vessels
    const newVessels = vessels.map(v => {
      if (v.id === sourceVessel.id) {
        return {
          ...v,
          currentVolume: finalSourceVolume,
          assignedLotId: finalSourceVolume === 0 ? null : v.assignedLotId,
          cleaningStatus: finalSourceVolume === 0 ? 'dirty' as const : v.cleaningStatus,
          lastOperation: `Transferred raw wine to ${destVessel.id}`
        };
      }
      if (v.id === destVessel.id) {
        return {
          ...v,
          currentVolume: finalDestVolume,
          assignedLotId: finalDestLotId,
          lastOperation: `Received wine transfer from ${sourceVessel.id}`
        };
      }
      return v;
    });

    onUpdateVessels(newVessels);
    onUpdateLots(newLots);

    // Add to transfers history ledger
    const newRecord: TransferRecord = {
      id: `xfer-${Date.now()}`,
      sourceId: sourceVessel.id,
      destId: destVessel.id,
      volume: transferVol,
      loss: lossVol,
      operator: operatorName || 'Cellar Crew',
      category: reasonCategory,
      date: opDate,
      pump: pumpModel,
      details: detailedReceiptText
    };

    saveTransfers([newRecord, ...pastTransfers]);

    // Reset Form Fields
    setSourceId('');
    setDestId('');
    setOperatorName('');
  };

  // Quick sanitation of vessels
  const handleSanitizeVessel = (id: string, stage: 'clean' | 'sterilized') => {
    const updated = vessels.map(v => {
      if (v.id === id) {
        return {
          ...v,
          cleaningStatus: (stage === 'sterilized' ? 'clean' : stage) as any,
          lastOperation: `Sanitized on ${new Date().toISOString().split('T')[0]} as ${stage.toUpperCase()}`
        };
      }
      return v;
    });
    onUpdateVessels(updated);
  };

  // Undo / Rollback a transfer log entry (for winemaker convenience if typo was made)
  const handleRollbackTransfer = (record: TransferRecord) => {
    const confirmRollback = window.confirm(
      `Do you want to ROLLBACK the transfer of ${record.volume}L from ${record.sourceId} to ${record.destId}? This will attempt to restore previous volume levels in the vessels.`
    );
    if (!confirmRollback) return;

    // Restore volumes
    const restoredVessels = vessels.map(v => {
      if (v.id === record.sourceId) {
        return {
          ...v,
          currentVolume: v.currentVolume + record.volume,
          cleaningStatus: 'clean' as const,
          lastOperation: `Restored post transaction rollback of ${record.id}`
        };
      }
      if (v.id === record.destId) {
        return {
          ...v,
          currentVolume: Math.max(0, v.currentVolume - (record.volume - record.loss)),
          lastOperation: `Restored post transaction rollback of ${record.id}`
        };
      }
      return v;
    });

    onUpdateVessels(restoredVessels);
    saveTransfers(pastTransfers.filter(x => x.id !== record.id));
    alert('Vessel liquid volume was safely restored to original pre-transfer baseline. Cleaning logs annotated.');
  };

  return (
    <div className="space-y-6 text-stone-850">
      
      {/* Intro info box */}
      <div className="bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-serif font-black text-[#4e0e15] flex items-center gap-2">
            <Shuffle className="w-5 h-5 text-[#801323]" />
            Winery Liquid Movement & Pomace Blending Panel
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Perform wine transfers, barrel decantations, Lees rackings, and blend proportional genealogies accurately with automatic volumetric math.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left column: Visual Tank Selectors */}
        <div className="lg:col-span-4 space-y-4">
          
          {/* Source Vessel selector */}
          <div className="bg-white p-4 border border-[#e8dfd5] rounded-xl shadow-xs space-y-3">
            <h3 className="text-xs font-mono font-bold uppercase text-slate-400 border-b border-stone-100 pb-2">
              Step 1: Select Source Vessel
            </h3>
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {vessels.filter(v => v.currentVolume > 0).map(v => {
                const isSelected = sourceId === v.id;
                const lot = lots.find(l => l.id === v.assignedLotId);
                const percentFull = Math.round((v.currentVolume / v.capacity) * 100);

                return (
                  <div
                    key={v.id}
                    onClick={() => {
                      setSourceId(v.id);
                      setTransferVol(v.currentVolume); // default to whole volume
                    }}
                    className={`p-3 border rounded-xl cursor-pointer hover:bg-stone-50 transition-all ${
                      isSelected 
                        ? 'bg-[#4e0e15]/5 border-[#4e0e15] ring-2 ring-[#4e0e15]/10' 
                        : 'bg-[#FAF8F5]/80 border-[#e8dfd5] hover:border-slate-350'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <strong className="text-xs font-sans text-stone-900">{v.id}</strong>
                      <span className={`text-[8px] font-mono px-1.5 py-0.2 rounded font-black uppercase ${
                        v.cleaningStatus === 'dirty' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                      }`}>
                        🎨 {v.cleaningStatus}
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-400 mt-0.5 font-semibold">
                      Lot: <span className="text-stone-800 italic font-medium">{lot ? lot.name : 'Unknown lot'}</span>
                    </p>

                    {/* Progress Fill Bar */}
                    <div className="mt-2 text-[9px] text-slate-500 font-mono flex items-center justify-between">
                      <span>Volume: {v.currentVolume} L / {v.capacity}L</span>
                      <span>{percentFull}% Full</span>
                    </div>
                    <div className="w-full bg-stone-200 h-1.5 rounded-full overflow-hidden mt-1">
                      <div 
                        className="bg-[#801323] h-full" 
                        style={{ width: `${percentFull}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Destination Vessel Selector */}
          <div className="bg-white p-4 border border-[#e8dfd5] rounded-xl shadow-xs space-y-3">
            <h3 className="text-xs font-mono font-bold uppercase text-slate-400 border-b border-stone-100 pb-2">
              Step 2: Select Recipient Vessel
            </h3>
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {vessels.filter(v => v.id !== sourceId).map(v => {
                const isSelected = destId === v.id;
                const lot = lots.find(l => l.id === v.assignedLotId);
                const freeSpace = v.capacity - v.currentVolume;
                const percentFull = Math.round((v.currentVolume / v.capacity) * 100);

                return (
                  <div
                    key={v.id}
                    onClick={() => setDestId(v.id)}
                    className={`p-3 border rounded-xl cursor-pointer hover:bg-stone-50 transition-all ${
                      isSelected 
                        ? 'bg-[#4e0e15]/5 border-[#4e0e15] ring-2 ring-[#4e0e15]/10' 
                        : 'bg-[#FAF8F5]/80 border-[#e8dfd5] hover:border-slate-350'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <strong className="text-xs font-sans text-stone-900">{v.id}</strong>
                      <span className={`text-[8px] font-mono px-1.5 py-0.2 rounded font-black uppercase ${
                        v.cleaningStatus === 'dirty' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                      }`}>
                        ⚙ {v.cleaningStatus}
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-400 mt-0.5 font-semibold">
                      Lot occupied: <span className="text-stone-800 italic font-medium">{lot ? lot.name : 'Empty / Clean vessel'}</span>
                    </p>

                    {/* Headroom fill info */}
                    <div className="mt-2 text-[9px] text-slate-505 font-mono flex items-center justify-between">
                      <span>Headroom: {freeSpace} L free space</span>
                      <span>{percentFull}% Full</span>
                    </div>
                    <div className="w-full bg-stone-200 h-1.5 rounded-full overflow-hidden mt-1">
                      <div 
                        className="bg-sky-600 h-full" 
                        style={{ width: `${percentFull}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick sanitization list */}
          <div className="bg-amber-50/50 p-4 border border-[#e8dfd5] rounded-xl space-y-2">
            <h4 className="text-[10px] font-mono font-bold uppercase text-amber-955 flex items-center gap-1">
              <Compass className="w-3.5 h-3.5 text-amber-600 animate-spin" />
              Quick Sanitization Controls
            </h4>
            <p className="text-[10px] text-amber-900/80 leading-relaxed font-serif">
              Immediately clean and sterilize empty tanks so they are ready for wine storage.
            </p>
            <div className="space-y-2 mt-2">
              {vessels.filter(v => v.currentVolume === 0 && (v.cleaningStatus === 'dirty' || v.cleaningStatus === 'clean')).map(v => (
                <div key={v.id} className="text-xs font-semibold bg-white p-2 border border-slate-205 rounded-lg flex items-center justify-between">
                  <span>{v.id} ({v.cleaningStatus})</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleSanitizeVessel(v.id, 'clean')}
                      className="px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded text-[9px] font-bold hover:bg-emerald-100"
                    >
                      Clean
                    </button>
                    <button
                      onClick={() => handleSanitizeVessel(v.id, 'sterilized')}
                      className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-350 rounded text-[9px] font-bold hover:bg-blue-105"
                    >
                      Sterilize
                    </button>
                  </div>
                </div>
              ))}
              {vessels.filter(v => v.currentVolume === 0 && (v.cleaningStatus === 'dirty' || v.cleaningStatus === 'clean')).length === 0 && (
                <p className="text-[10px] text-slate-400 italic text-center p-2">All empty tanks are already clean or sterilized!</p>
              )}
            </div>
          </div>

        </div>

        {/* Right Columns: Racking Form, Safety Checklist & Predictions */}
        <div className="lg:col-span-8 space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            
            {/* Controller main inputs */}
            <div className="md:col-span-7 bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs space-y-4">
              <h3 className="text-sm font-serif font-bold text-[#4e0e15] border-b pb-2 flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-[#801323]" /> Racking & Blending Form
              </h3>

              <form onSubmit={handleExecuteTransfer} className="space-y-3.5">
                
                {/* Visual arrow indicator or active selected summary */}
                <div className="p-3 bg-stone-50 border border-stone-200/50 rounded-xl flex items-center justify-center gap-4 text-xs font-semibold">
                  <div className="text-center flex-1">
                    <span className="block text-[8px] font-mono text-slate-400 uppercase">SOURCE</span>
                    <strong className="text-stone-904">{sourceId || 'Choose Source'}</strong>
                    <span className="block text-[9px] text-amber-900 font-mono mt-0.5">
                      {sourceVessel ? `${sourceVessel.currentVolume} L` : ''}
                    </span>
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-400 animate-pulse" />
                  <div className="text-center flex-1 font-sans">
                    <span className="block text-[8px] font-mono text-slate-400 uppercase">RECIPIENT</span>
                    <strong className="text-slate-700">{destId || 'Choose Destination'}</strong>
                    <span className="block text-[9px] text-indigo-805 font-mono mt-0.5">
                      {destVessel ? `${destCapRemaining} L free` : ''}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">Volume to Move (Liters)</label>
                    <input
                      type="number"
                      required
                      value={transferVol}
                      onChange={(e) => setTransferVol(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-205 rounded font-mono outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">Racking Loss Allowance (L)</label>
                    <input
                      type="number"
                      required
                      value={lossVol}
                      onChange={(e) => setLossVol(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-205 rounded font-mono outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">Pump Model / Hose Tag</label>
                    <input
                      type="text"
                      required
                      value={pumpModel}
                      onChange={(e) => setPumpModel(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-205 rounded outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">Operation Category</label>
                    <select
                      value={reasonCategory}
                      onChange={(e) => setReasonCategory(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-205 rounded outline-none cursor-pointer"
                    >
                      <option value="racking">Decantation / Racking lees</option>
                      <option value="blend">Cuvée Assembly blending</option>
                      <option value="filtration">Filtration Loop</option>
                      <option value="bottling">Pre-bottling tank load</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">Responsible Cellar Master *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. S. Rossi"
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-205 rounded outline-none font-medium"
                  />
                </div>

                <button
                  type="submit"
                  disabled={sourceIsEmpty || sourceHasInsufficient || destWillOverflow || !sourceId || !destId}
                  className="w-full py-2 bg-[#4e0e15] text-white hover:bg-[#6b151e] shadow-xs text-xs font-bold rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Confirm & Initiate Fluid Pump
                </button>

              </form>

              {operationReceipt && (
                <div className="mt-4 p-3.5 bg-emerald-50 border border-emerald-250 rounded-xl flex items-center gap-2 text-emerald-950 text-xs">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span className="font-serif font-medium">{operationReceipt}</span>
                </div>
              )}

            </div>

            {/* Safety parameters & Blending calculations panel */}
            <div className="md:col-span-5 space-y-4">
              
              <div className="bg-[#FAF8F5] p-4 border border-stone-200 rounded-xl space-y-4">
                <h4 className="text-xs font-mono font-bold uppercase text-stone-700 tracking-wider">Safety & Compatibility Check</h4>
                
                <div className="space-y-3">
                  {/* Liquid verification block */}
                  <div className="flex items-start gap-2.5 text-xs leading-tight">
                    <div className={`p-0.5 rounded-full shrink-0 ${sourceId && !sourceIsEmpty ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {sourceId && !sourceIsEmpty ? <Check className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                    </div>
                    <div>
                      <span className="font-bold block text-stone-900">Source Headroom Check</span>
                      <p className="text-[10px] text-slate-400 font-medium">
                        {sourceVessel ? `${sourceVessel.id} shares ${sourceVessel.currentVolume} L volume safely.` : 'Please configure source.'}
                      </p>
                    </div>
                  </div>

                  {/* Free capacity block */}
                  <div className="flex items-start gap-2.5 text-xs leading-tight">
                    <div className={`p-0.5 rounded-full shrink-0 ${destId && !destWillOverflow ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {destId && !destWillOverflow ? <Check className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                    </div>
                    <div>
                      <span className="font-bold block text-[#4e0e15]">Headroom Check</span>
                      <p className="text-[10px] text-slate-400 font-medium">
                        {destVessel ? `${destVessel.id} supports up to ${destCapRemaining} L empty capacity.` : 'Please configure receiver.'}
                      </p>
                    </div>
                  </div>

                  {/* Micro blend analysis predictions weighted by volume */}
                  {showsBlendAlert && predictedBlend && (
                    <div className="p-3 bg-amber-50 border border-amber-250 rounded-xl space-y-2">
                      <h5 className="text-[10px] font-mono font-bold text-amber-900 flex items-center gap-1.5 uppercase">
                        <Activity className="w-3.5 h-3.5 text-amber-700 animate-spin" />
                        Weighted Blend Predictions
                      </h5>
                      <div className="space-y-1 font-mono text-[10.5px] leading-relaxed text-amber-950 font-semibold">
                        <div className="flex justify-between">
                          <span>Blending proportions:</span>
                          <span className="text-[#801323]">Lot Merge</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Est. Blended Alcohol:</span>
                          <span className="border-b border-dashed">{predictedBlend.abv} % ABV</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Est. Blended pH:</span>
                          <span className="border-b border-dashed">{predictedBlend.ph} pH</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Est. Blended Free SO2:</span>
                          <span>{predictedBlend.so2} mg/L (ppm)</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {!showsBlendAlert && sourceId && destId && (
                    <div className="p-2 bg-emerald-50/50 border border-emerald-100 rounded-lg text-[10.5px] text-emerald-900 leading-tight flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      Compatible Wine Lots! Direct transfer without dynamic blending calculations in genealogy.
                    </div>
                  )}

                </div>
              </div>

            </div>

          </div>

          {/* Core movement ledgers journal with undo support */}
          <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-xs space-y-3 text-stone-850">
            <h3 className="text-sm font-serif font-bold text-stone-900 border-b border-stone-100 pb-2 flex items-center justify-between">
              <span>Winery Translocation Movement Logs Ledger</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-[#FAF8F5] border font-bold text-slate-400">{pastTransfers.length} Recorded</span>
            </h3>

            <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
              {pastTransfers.map(record => (
                <div key={record.id} className="p-3.5 bg-[#FAF8F5] border border-stone-200 hover:border-slate-350 transition-color rounded-xl flex flex-col justify-between md:flex-row gap-3 items-start md:items-center">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-mono font-bold text-[#801323] uppercase bg-red-50 px-1.5 py-0.2 rounded">
                        {record.category}
                      </span>
                      <span className="font-sans font-black text-xs text-stone-900 flex items-center gap-1">
                        <strong>{record.sourceId}</strong>
                        <ArrowRight className="w-3.5 h-3.5 text-stone-405 text-slate-400" />
                        <strong>{record.destId}</strong>
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">({record.date})</span>
                    </div>

                    <p className="text-[11px] text-stone-605 font-medium leading-relaxed font-serif text-slate-600">
                      Moved <strong className="text-stone-900">{record.volume} Liters</strong>. loss allowance: {record.loss}L (Racked with {record.pump}).
                    </p>

                    <p className="text-[11px] text-emerald-900 font-serif italic border-l-2 border-emerald-250 pl-2">
                      &quot;{record.details}&quot;
                    </p>
                  </div>

                  <div className="flex items-center gap-2shrink-0">
                    <span className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> {record.operator}
                    </span>
                    <button
                      title="Rollback / Undo Movement"
                      onClick={() => handleRollbackTransfer(record)}
                      className="p-1.5 hover:bg-rose-50 rounded text-slate-300 hover:text-red-650 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              {pastTransfers.length === 0 && (
                <p className="p-8 text-stone-400 italic font-serif text-center">No cellar transfer logs posted yet.</p>
              )}
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
