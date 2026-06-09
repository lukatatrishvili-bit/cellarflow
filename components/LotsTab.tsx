import { useState } from 'react';
import { translations, Language } from '@/lib/i18n';
import { WineLot, Tank, LabResult, Additive } from '@/lib/services/db';
import { formatDate } from '@/lib/utils';
import { 
  Wine, Plus, ClipboardCheck, History, Calendar, 
  MapPin, Anchor, Info, AlertTriangle, Layers,
  ShoppingBag, Sparkles, User, Truck, CheckCircle2
} from 'lucide-react';

interface LotsTabProps {
  lang: Language;
  lots: WineLot[];
  tanks: Tank[];
  labResults: LabResult[];
  additives: Additive[];
  onAddLot: (lot: Omit<WineLot, 'id'>) => void;
  onUpdateLot: (id: string, updated: Partial<WineLot>) => void;
}

export default function LotsTab({
  lang,
  lots,
  tanks,
  labResults,
  additives,
  onAddLot,
  onUpdateLot
}: LotsTabProps) {
  const t = translations[lang];

  // UI State
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedLot, setSelectedLot] = useState<WineLot | null>(null);

  // New Lot fields state
  const [code, setCode] = useState('');
  const [wineName, setWineName] = useState('');
  const [vintage, setVintage] = useState<number>(2024);
  const [variety, setVariety] = useState('Saperavi');
  const [vineyard, setVineyard] = useState('Central Block A');
  const [region, setRegion] = useState('Kakheti, Georgia');
  const [harvestDate, setHarvestDate] = useState('');
  const [grapeQuantity, setGrapeQuantity] = useState<number>(10000);
  const [initialVolume, setInitialVolume] = useState<number>(7000);
  const [type, setType] = useState<'white' | 'red' | 'rose' | 'amber' | 'sparkling' | 'fortified' | 'base_wine' | 'distillate'>('red');
  const [productionMethod, setProductionMethod] = useState('Traditional Kakhemian extended clay skin contact');
  const [notes, setNotes] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !wineName || grapeQuantity <= 0) return;

    onAddLot({
      code,
      wineName,
      vintage,
      variety,
      vineyard,
      region,
      harvestDate: harvestDate || new Date().toISOString().split('T')[0],
      grapeQuantity,
      initialVolume,
      currentVolume: initialVolume,
      type,
      productionMethod,
      stage: 'crushing',
      tanks: [],
      responsibleWinemaker: 'Luka Tatrishvili',
      notes
    });

    // Reset fields
    setCode('');
    setWineName('');
    setNotes('');
    setShowAddForm(false);
  };

  const currentAvailableTanksForLot = (lot: WineLot) => {
    return tanks.filter(tank => tank.currentLotId === lot.id);
  };

  const fetchLatestLabResults = (lotId: string) => {
    const results = labResults.filter(r => r.lotId === lotId);
    if (results.length === 0) return null;
    return results[0]; // Newest first
  };

  // Compile timeline events sequentially for selected Wine Lot
  const getTimelineEvents = (lot: WineLot) => {
    const events: {
      id: string;
      date: string;
      title: string;
      type: 'harvest' | 'lab' | 'treatment' | 'stage';
      details: string;
      icon: any;
      color: string;
    }[] = [];

    // 1. Harvest reception
    events.push({
      id: 'harvest-01',
      date: lot.harvestDate || '2024-09-12',
      title: `Grape Reception & Crushing`,
      type: 'harvest',
      details: `Received ${lot.grapeQuantity?.toLocaleString()} kg of Saperavi grapes sourced from Block ${lot.vineyard} (${lot.region}). Initial extracted sugar run yields ~${(lot.initialVolume).toLocaleString()} Liters of juice.`,
      icon: Truck,
      color: 'bg-amber-105 border-amber-500 text-amber-900'
    });

    // 2. Lab analysis events
    const labs = labResults.filter(r => r.lotId === lot.id);
    labs.forEach((l, index) => {
      events.push({
        id: `lab-${l.id}`,
        date: l.date,
        title: `Chemical Analysis Checkpoint #${labs.length - index}`,
        type: 'lab',
        details: `Standard chemistry sweep complete. Parameter log: pH ${l.pH}, Alcohol: ${l.alcohol}%, Volatile Acidity: ${l.volatileAcidity}g/L, Free/Total SO2: ${l.freeSO2}/${l.totalSO2} ppm. Sensory remarks: "${l.tastingNote}"`,
        icon: ClipboardCheck,
        color: 'bg-[#FAF3F5] border-[#722F37] text-burgundy-900'
      });
    });

    // 3. Treatment additions
    const additions = (additives || []).filter(a => a.lotId === lot.id);
    additions.forEach(a => {
      events.push({
        id: `treatment-${a.id}`,
        date: a.date,
        title: `Enological Additive Treatment`,
        type: 'treatment',
        details: `Added ${a.totalAmount}g of ${a.productName} formulation. Dosage rate: ${a.dose}. Operations supervisor: ${a.operator}. Remark notes: "${a.notes}"`,
        icon: Sparkles,
        color: 'bg-emerald-50 border-emerald-500 text-emerald-950'
      });
    });

    // Sort chronologically (oldest events at bottom, newest flow at top)
    return events.sort((a,b) => b.date.localeCompare(a.date));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-[#EBE5D8] pb-4">
        <div>
          <h3 className="text-lg font-bold font-sans text-gray-800 flex items-center gap-2">
            <Layers className="h-5 w-5 text-[#722F37]" />
            {t.wine_lots}
          </h3>
          <p className="text-xs text-gray-400">Harvest inputs, grape reception varieties, Appellations and chronological trace maps</p>
        </div>
        <button 
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-[#722F37] text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-opacity-90 inline-flex items-center gap-1 cursor-pointer transition-all shadow-sm"
        >
          <Plus className="h-4 w-4" />
          {t.add_new}
        </button>
      </div>

      {/* Deploy New Lot Form */}
      {showAddForm && (
        <form onSubmit={handleCreate} className="bg-[#FDFBF7] border border-[#EBE5D8] p-5 rounded-xl space-y-4 max-w-2xl shadow-sm animate-fade-in">
          <h4 className="font-semibold text-gray-800 text-sm">Deploy New Traceable Wine Lot</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[11px] font-mono text-gray-500 block mb-1">Lot Code *</label>
              <input 
                type="text" 
                value={code} 
                onChange={e => setCode(e.target.value)}
                placeholder="e.g. L-SAP24"
                className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:outline-hidden"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-mono text-gray-500 block mb-1">Wine Designate Name *</label>
              <input 
                type="text" 
                value={wineName} 
                onChange={e => setWineName(e.target.value)}
                placeholder="e.g. Saperavi Reserve Estate"
                className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 text-xs text-gray-700"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-gray-500 block mb-1">Vintage *</label>
              <input 
                type="number" 
                value={vintage} 
                onChange={e => setVintage(Number(e.target.value))}
                className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 text-xs text-gray-700"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-gray-500 block mb-1">Grape Variety *</label>
              <input 
                type="text" 
                value={variety} 
                onChange={e => setVariety(e.target.value)}
                className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 text-xs text-gray-700"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-gray-500 block mb-1">Vineyard Block/Source</label>
              <input 
                type="text" 
                value={vineyard} 
                onChange={e => setVineyard(e.target.value)}
                placeholder="Central Block A"
                className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 text-xs text-gray-700"
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-gray-500 block mb-1">Region Appellation App *</label>
              <input 
                type="text" 
                value={region} 
                onChange={e => setRegion(e.target.value)}
                className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 text-xs text-gray-700"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-gray-500 block mb-1">Grape Quantity (kg) *</label>
              <input 
                type="number" 
                value={grapeQuantity || ''} 
                onChange={e => setGrapeQuantity(Number(e.target.value))}
                className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 text-xs text-gray-700 font-mono"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-gray-500 block mb-1">Est Juice Volume (L) *</label>
              <input 
                type="number" 
                value={initialVolume || ''} 
                onChange={e => setInitialVolume(Number(e.target.value))}
                className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 text-xs text-gray-700 font-mono"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-mono text-gray-500 block mb-1">Winemaking Method Notes</label>
            <textarea 
              value={notes} 
              onChange={e => setNotes(e.target.value)}
              placeholder="E.g., wild yeast inoculations, basket press fractions..."
              className="w-full bg-white border border-[#EBE5D8] rounded-lg p-3 text-xs text-gray-700 focus:outline-[#722F37] h-16"
            />
          </div>

          <button 
            type="submit"
            className="bg-[#722F37] text-white font-bold text-xs uppercase px-5 py-2 rounded-lg cursor-pointer hover:bg-opacity-95 shadow-sm"
          >
            Deploy Trace Block Lot
          </button>
        </form>
      )}

      {/* Wine Lots Cards Ledger */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {lots.map((lot) => {
          const associatedTanks = currentAvailableTanksForLot(lot);
          const latestLab = fetchLatestLabResults(lot.id);
          
          return (
            <div 
              key={lot.id}
              className="bg-white border border-[#EBE5D8] p-5 rounded-xl shadow-xs space-y-4 flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              {/* Header */}
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] font-mono font-bold bg-[#FAF3F5] text-[#722F37] px-2 py-0.5 rounded-md">
                    {lot.code}
                  </span>
                  <h4 className="font-sans font-bold text-[#2C302E] text-base mt-1.5">{lot.wineName}</h4>
                  <p className="text-[11px] text-gray-400 font-mono mt-0.5">{lot.vintage} • {lot.variety}</p>
                </div>
                
                <span className="text-[10px] uppercase font-mono tracking-wider font-bold text-emerald-800 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-sm capitalize">
                  {lot.stage}
                </span>
              </div>

              {/* Geographic stats and harvest inputs */}
              <div className="grid grid-cols-2 gap-3 text-xs bg-stone-50/50 p-3 rounded-lg border border-stone-100">
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-stone-400 shrink-0" />
                  <span className="text-gray-600 line-clamp-1">{lot.region}</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono">
                  <Calendar className="h-4 w-4 text-stone-400 shrink-0" />
                  <span className="text-gray-500 whitespace-nowrap">{lot.harvestDate || '2024'}</span>
                </div>
                <div>
                  <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider block">Grapes Received</span>
                  <span className="font-bold text-gray-700">{lot.grapeQuantity?.toLocaleString() || 'N/A'} kg</span>
                </div>
                <div>
                  <span className="text-[9px] font-mono text-gray-400 uppercase tracking-wider block">Active Volume</span>
                  <span className="font-bold text-[#722F37]">{lot.currentVolume?.toLocaleString() || 'N/A'} L</span>
                </div>
              </div>

              {/* Linked hardware stats */}
              <div className="space-y-2">
                <span className="text-[9px] font-mono text-gray-400 uppercase tracking-widest block">Active Storage Locations</span>
                <div className="flex flex-wrap gap-1.5">
                  {associatedTanks.length === 0 ? (
                    <span className="text-[10px] text-gray-400 italic">No storage vessels linked. (Rack/Transfer wine in)</span>
                  ) : (
                    associatedTanks.map(tk => (
                      <span key={tk.id} className="text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-sm">
                        {tk.name} ({tk.currentVolume?.toLocaleString()}L)
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Chemical variables block */}
              {latestLab ? (
                <div className="border-t border-stone-100 pt-3 flex justify-between items-center text-[11px] font-mono text-gray-600">
                  <span>Alc: <strong>{latestLab.alcohol}%</strong></span>
                  <span>pH: <strong>{latestLab.pH}</strong></span>
                  <span>F SO2: <strong>{latestLab.freeSO2} mg/L</strong></span>
                </div>
              ) : (
                <div className="border-t border-stone-100 pt-3 text-[10px] italic text-gray-400 font-mono">
                  No chemical parameters recorded yet.
                </div>
              )}

              {/* Stage picker & actions */}
              <div className="pt-2 border-t border-stone-100 flex gap-2">
                <select 
                  value={lot.stage}
                  onChange={(e) => onUpdateLot(lot.id, { stage: e.target.value as any })}
                  className="bg-white border border-[#EBE5D8] px-2 py-1 text-[11px] rounded-md text-gray-600 focus:outline-hidden"
                >
                  <option value="crushing">Crushing/Pressing</option>
                  <option value="fermentation">Fermentation</option>
                  <option value="maceration">Maceration (Skins)</option>
                  <option value="pressing">Pressing</option>
                  <option value="aging">Wood Barrel Aging</option>
                  <option value="stabilization">Stabilization</option>
                  <option value="filtration">Filtration</option>
                  <option value="bottled">Bottled Estate</option>
                  <option value="sold">Sold/Shipped</option>
                </select>

                <button 
                  type="button"
                  onClick={() => setSelectedLot(lot)}
                  className="flex-1 bg-[#FAF3F5] text-[#722F37] hover:bg-[#722F37]/10 text-[11px] font-bold py-1.5 rounded-md text-center cursor-pointer transition-colors shadow-2xs inline-flex items-center justify-center gap-1"
                >
                  <History className="h-3 w-3" />
                  Full Traceability
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lot Traceability Full History Drawer Modal */}
      {selectedLot && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl border border-[#EBE5D8] max-w-5xl w-full p-6 space-y-5 shadow-2xl max-h-[92vh] overflow-y-auto">
            
            {/* Modal Header */}
            <div className="flex justify-between items-start border-b border-[#EBE5D8] pb-3">
              <div>
                <span className="text-[10px] font-bold font-mono tracking-widest bg-[#FAF3F5] text-[#722F37] px-2 py-0.5 rounded-md uppercase">
                  ⛓️ Cryptographic Wood-to-Glass Traceability dossier
                </span>
                <h3 className="text-lg font-bold text-stone-850 mt-1">{selectedLot.wineName} ({selectedLot.code})</h3>
                <p className="text-[11px] text-stone-400 mt-0.5">Origin and composition timeline mapping for winery provenance verification</p>
              </div>
              <button 
                onClick={() => setSelectedLot(null)}
                className="text-stone-400 hover:text-stone-700 text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Split layout: dossier on left, graphical timeline flow on right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column (5/12 spec cards) */}
              <div className="lg:col-span-5 space-y-4">
                
                {/* Vintage details */}
                <div className="bg-[#FAFDF9] p-4 rounded-xl border border-emerald-100/60 space-y-2">
                  <h5 className="text-[10px] font-mono text-emerald-800 uppercase tracking-wider font-extrabold flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    Provenance Origin Dossier
                  </h5>
                  <div className="grid grid-cols-2 gap-3 text-xs text-stone-600">
                    <div>
                      <span className="text-[9px] text-stone-400 block uppercase">Grape Variety</span>
                      <p className="font-semibold text-stone-800">{selectedLot.variety}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-stone-400 block uppercase">Source Vineyard</span>
                      <p className="font-semibold text-stone-800">{selectedLot.vineyard}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-stone-400 block uppercase">Appellation Region</span>
                      <p className="font-semibold text-stone-800">{selectedLot.region}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-stone-400 block uppercase">Winemaker Advisor</span>
                      <p className="font-semibold text-stone-800">{selectedLot.responsibleWinemaker}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <h5 className="text-xs font-mono text-gray-500 uppercase tracking-wider">Methodology Directive</h5>
                  <p className="text-xs text-gray-650 bg-stone-50 p-3 rounded-lg border border-stone-100 italic">
                    {selectedLot.productionMethod || 'No specialized directives recorded.'}
                  </p>
                </div>

                {/* Lab parameters registry table */}
                <div className="space-y-1">
                  <h5 className="text-xs font-mono text-gray-500 uppercase tracking-widest pl-1">Chemical Parameter Milestones</h5>
                  <div className="border border-[#EBE5D8] rounded-xl overflow-hidden text-[10px] bg-white">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-stone-55 font-mono uppercase text-[8px] text-gray-400 border-b border-[#EBE5D8]">
                          <th className="p-2">Date</th>
                          <th className="p-2">pH</th>
                          <th className="p-2">Alc %</th>
                          <th className="p-2">VA (g/L)</th>
                          <th className="p-1.5 text-right">Free SO2</th>
                        </tr>
                      </thead>
                      <tbody>
                        {labResults.filter(r => r.lotId === selectedLot.id).map(r => (
                          <tr key={r.id} className="border-b border-stone-100 hover:bg-stone-50/40">
                            <td className="p-2 font-mono text-gray-400">{formatDate(r.date)}</td>
                            <td className="p-2 font-semibold text-gray-800">{r.pH}</td>
                            <td className="p-2 font-mono">{r.alcohol}%</td>
                            <td className="p-2 font-mono">{r.volatileAcidity}</td>
                            <td className="p-2 font-mono text-right font-extrabold text-[#722F37]">{r.freeSO2} ppm</td>
                          </tr>
                        ))}
                        {labResults.filter(r => r.lotId === selectedLot.id).length === 0 && (
                          <tr>
                            <td colSpan={5} className="text-center p-3 text-gray-400 italic">No scientific labs logged yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>

              {/* Right Column: Visual Timeline Trace Map (7/12 layout) */}
              <div className="lg:col-span-7 space-y-3 bg-stone-50/60 p-5 rounded-2xl border border-stone-200/40">
                <h4 className="font-semibold text-stone-800 text-xs font-mono uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-stone-200">
                  <History className="h-4.5 w-4.5 text-[#722F37]" />
                  Chronological Prov-Map Timeline
                </h4>

                <div className="relative border-l-2 border-stone-200 pl-6 ml-3 space-y-6 max-h-[48vh] overflow-y-auto pt-2">
                  {getTimelineEvents(selectedLot).map((evt, idx) => {
                    const EvtIcon = evt.icon;
                    return (
                      <div key={evt.id} className="relative animate-fade-in">
                        {/* Bullet Icon marker */}
                        <span className={`absolute -left-[37px] top-0 p-1.5 rounded-full border-2 ${evt.color} shadow-sm flex items-center justify-center`}>
                          <EvtIcon className="h-3.5 w-3.5" />
                        </span>

                        {/* Card specification text */}
                        <div className="bg-white border border-[#EBE5D8] p-3.5 rounded-xl space-y-1 shadow-2xs hover:border-[#722F37]/30 transition-all">
                          <div className="flex justify-between items-center text-[10px] text-stone-400 font-mono">
                            <span className="bg-[#FAF3F5] text-[#722F37] px-2 py-0.2 rounded-sm uppercase tracking-wider font-extrabold text-[9px]">{evt.type}</span>
                            <span>{formatDate(evt.date)}</span>
                          </div>
                          <h6 className="font-bold text-stone-800 text-xs">{evt.title}</h6>
                          <p className="text-xs text-stone-500 leading-relaxed font-sans mt-1">{evt.details}</p>
                        </div>
                      </div>
                    );
                  })}
                  {getTimelineEvents(selectedLot).length === 0 && (
                    <p className="text-xs text-stone-400 italic py-4">No enological events processed inside ledger blockchain.</p>
                  )}
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="flex justify-between items-center pt-3 border-t border-[#EBE5D8] text-[10px] text-gray-400 font-mono">
              <span>Security Block Reference: cf-{selectedLot.code}-{selectedLot.vintage}</span>
              <button 
                type="button"
                onClick={() => setSelectedLot(null)}
                className="bg-[#722F37] hover:bg-opacity-95 text-white px-5 py-2 rounded-lg text-xs font-bold leading-none cursor-pointer"
              >
                Close Trace Dossier
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
