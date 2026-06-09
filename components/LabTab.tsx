import { useState, useEffect } from 'react';
import { translations, Language } from '@/lib/i18n';
import { LabResult, WineLot, Additive, InventoryItem } from '@/lib/services/db';
import { formatDate } from '@/lib/utils';
import { 
  Beaker, Plus, CheckCircle, Info, ShieldAlert,
  Search, FileSpreadsheet, Eye, Sparkles, TrendingUp,
  ShoppingBag, Trash, HelpCircle, User, Calendar
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

const formatChartDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [, month, day] = parts;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mIdx = parseInt(month, 10) - 1;
    if (mIdx >= 0 && mIdx < 12) {
      return `${months[mIdx]} ${parseInt(day, 10)}`;
    }
  }
  return dateStr;
};

const LOT_COLORS = [
  '#722F37', // Burgundy
  '#C5A880', // Amber Gold
  '#1B3A4B', // Deep Wine Teal
  '#4A5759', // Charcoal Sage
  '#B1A7A6', // Brushed Pewter
  '#D66853', // Terracotta Clay
  '#A37081', // Dusty Mauve
  '#588B8B', // Sage Green
];

interface LabTabProps {
  lang: Language;
  labResults: LabResult[];
  lots: WineLot[];
  additives: Additive[];
  inventory: InventoryItem[];
  onAddLabResult: (result: Omit<LabResult, 'id'>) => void;
  onAddAdditive: (additive: Omit<Additive, 'id'>) => void;
}

export default function LabTab({
  lang,
  labResults,
  lots,
  additives,
  inventory,
  onAddLabResult,
  onAddAdditive
}: LabTabProps) {
  const t = translations[lang];

  // Active Sub-tab View ('chemistry' or 'additives')
  const [activeSubView, setActiveSubView] = useState<'chemistry' | 'additives'>('chemistry');

  // Selected Lots for Trend Chart
  const [selectedLots, setSelectedLots] = useState<string[]>(() => {
    return Array.from(new Set(labResults.map(r => r.lotId)));
  });
  // Metric to compare in comparative multi-lot mode ('pH' or 'freeSO2')
  const [chartMetric, setChartMetric] = useState<'pH' | 'freeSO2'>('pH');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
    }, 55);
    return () => clearTimeout(timer);
  }, []);

  const toggleLotSelection = (id: string) => {
    if (selectedLots.includes(id)) {
      setSelectedLots(selectedLots.filter(x => x !== id));
    } else {
      setSelectedLots([...selectedLots, id]);
    }
  };

  const handleSelectAll = () => {
    const activeLotIds = Array.from(new Set(labResults.map(r => r.lotId)));
    setSelectedLots(activeLotIds);
  };

  const handleClearAll = () => {
    setSelectedLots([]);
  };

  // Search filter
  const [searchTerm, setSearchTerm] = useState('');
  const [treatmentSearch, setTreatmentSearch] = useState('');
  const [filterVintage, setFilterVintage] = useState<string>('all');
  const [filterClass, setFilterClass] = useState<string>('all');

  // Lab form states
  const [lotId, setLotId] = useState('');
  const [pH, setPH] = useState<number>(3.5);
  const [alcohol, setAlcohol] = useState<number>(13.5);
  const [totalAcidity, setTotalAcidity] = useState<number>(5.8);
  const [volatileAcidity, setVolatileAcidity] = useState<number>(0.45);
  const [freeSO2, setFreeSO2] = useState<number>(30);
  const [totalSO2, setTotalSO2] = useState<number>(90);
  const [residualSugar, setResidualSugar] = useState<number>(1.5);
  const [tastingNote, setTastingNote] = useState('');
  const [labTechnician, setLabTechnician] = useState('George Barisashvili');

  // Additive Treatment form states
  const [addLotId, setAddLotId] = useState('');
  const [addProduct, setAddProduct] = useState('Potassium Metabisulfite (KMBS)');
  const [addType, setAddType] = useState('stabilizer');
  const [addDose, setAddDose] = useState('15 g/hL');
  const [addAmount, setAddAmount] = useState<number>(50);
  const [addOperator, setAddOperator] = useState('Luka Tatrishvili');
  const [addNotes, setAddNotes] = useState('');

  // Auxiliary calculator helpers
  const [targetIncreasePpm, setTargetIncreasePpm] = useState<number>(20);
  const [targetAcidIncrease, setTargetAcidIncrease] = useState<number>(1.5);

  const [panelMsg, setPanelMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [addMsg, setAddMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Auto-calculate additive doses based on holding volume
  const activeLotVolume = lots.find(l => l.id === addLotId)?.currentVolume || 0;

  const handleCalculateKMBSDose = () => {
    if (activeLotVolume <= 0) {
      setAddMsg({ type: 'error', text: 'Select a wine lot with active holding volume to compute KMBS formulas.' });
      return;
    }
    // KMBS contains 57.6% active SO2. Formula: g = (Volume * TargetPpm) / 576
    const calculated = (activeLotVolume * targetIncreasePpm) / 576;
    setAddAmount(Math.round(calculated));
    setAddDose(`${targetIncreasePpm} ppm increase`);
    setAddMsg({ type: 'success', text: `KMBS enology addition calibrated: ${Math.round(calculated)} grams required for ${activeLotVolume}L of wine.` });
  };

  const handleCalculateAcidDose = () => {
    if (activeLotVolume <= 0) {
      setAddMsg({ type: 'error', text: 'Select a wine lot to compute acid additions.' });
      return;
    }
    // Tartaric Acid dosage formula: g = Volume * Desired acidity increase (g/L)
    const calculated = activeLotVolume * targetAcidIncrease;
    setAddAmount(Math.round(calculated));
    setAddDose(`${targetAcidIncrease} g/L adjustment`);
    setAddMsg({ type: 'success', text: `Tartaric acid addition calibrated: ${Math.round(calculated)} grams required for ${activeLotVolume}L.` });
  };

  // KMBS direct trigger from laboratory pH stabilizer curves
  const triggerStabilityTreatment = (pHValue: number, deficiencyPpm: number, selectedLot: string) => {
    setActiveSubView('additives');
    setAddLotId(selectedLot);
    setAddProduct('Potassium Metabisulfite (KMBS)');
    setAddType('stabilizer');
    setTargetIncreasePpm(deficiencyPpm);
    
    // Auto calculate right away
    const volume = lots.find(l => l.id === selectedLot)?.currentVolume || 0;
    if (volume > 0) {
      const calculated = (volume * deficiencyPpm) / 576;
      setAddAmount(Math.round(calculated));
      setAddDose(`${deficiencyPpm} ppm correction`);
      setAddNotes(`Calibrated chemistry correction triggered following lab analysis. Target safe molecular SO2 threshold.`);
      setAddMsg({ type: 'success', text: `Transferred pH correction parameters! Dose calculated: ${Math.round(calculated)}g for ${volume}L.` });
    } else {
      setAddNotes(`pH correction triggered from lab analysis. Target: +${deficiencyPpm} ppm.`);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPanelMsg(null);

    if (!lotId || pH <= 0 || alcohol <= 0) {
      setPanelMsg({ type: 'error', text: 'Please fill out all mandatory lab results parameters.' });
      return;
    }

    onAddLabResult({
      lotId,
      date: new Date().toISOString().split('T')[0],
      pH,
      alcohol,
      totalAcidity,
      volatileAcidity,
      freeSO2,
      totalSO2,
      residualSugar,
      density: 0.992,
      tastingNote: tastingNote || 'Sensory properties align perfectly with lot stage parameters.',
      technician: labTechnician
    });

    setPanelMsg({ type: 'success', text: 'Enological analysis logged successfully!' });
    // Reset secondary fields
    setTastingNote('');
  };

  const handleAdditiveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAddMsg(null);

    if (!addLotId || addAmount <= 0) {
      setAddMsg({ type: 'error', text: 'Please select a wine lot and enter a valid total addition amount.' });
      return;
    }

    // Check inventory stock to avoid phantom warehouse operations
    const matchingStock = inventory.find(i => 
      i.name.toLowerCase().includes(addProduct.toLowerCase()) || 
      addProduct.toLowerCase().includes(i.name.toLowerCase())
    );

    if (matchingStock && matchingStock.quantity < (addAmount / 1000)) {
      setAddMsg({ 
        type: 'error', 
        text: `Stock depletion warning: Warehouse only holds ${(matchingStock.quantity).toFixed(2)} ${matchingStock.unit} of ${addProduct}, but the calculation demands ${(addAmount / 1000).toFixed(2)} kg. Stock up inventory first!` 
      });
      return;
    }

    // Submit enological treatment
    onAddAdditive({
      lotId: addLotId,
      date: new Date().toISOString().split('T')[0],
      productName: addProduct,
      productType: addType,
      dose: addDose,
      totalAmount: addAmount,
      operator: addOperator,
      notes: addNotes || 'Standard enology cellar additions.'
    });

    setAddMsg({ type: 'success', text: `Registered ${addAmount}g addition of ${addProduct} and deducted from warehouse stockpile!` });
    setAddNotes('');
  };

  const getLotDetails = (lotId: string) => {
    const lot = lots.find(l => l.id === lotId);
    return lot ? { name: lot.wineName, code: lot.code } : { name: t.unknown, code: 'N/A' };
  };

  // SO2 Chemistry Helper according to enological science
  const getSO2StabilityAdvice = (phValue: number, currentFreeSo2Value: number) => {
    let targetSo2 = 30;
    if (phValue < 3.2) targetSo2 = 14;
    else if (phValue < 3.4) targetSo2 = 24;
    else if (phValue < 3.6) targetSo2 = 34;
    else if (phValue < 3.8) targetSo2 = 46;
    else targetSo2 = 56;

    const diff = targetSo2 - currentFreeSo2Value;
    if (diff > 5) {
      return {
        stable: false,
        diff,
        targetSo2,
        text: `Microbiological risk identified. Highly recommend adding ~${diff} mg/L (ppm) Free SO2 to reach a stable ${targetSo2} mg/L threshold for this pH level (${phValue}).`
      };
    }
    return {
      stable: true,
      diff: 0,
      targetSo2,
      text: `Molecular SO2 index is microbially stable. Protective barrier active.`
    };
  };

  // Filter lists
  const filteredLabResults = labResults.filter(r => {
    const lot = lots.find(l => l.id === r.lotId);
    if (!lot) return false;

    // Filter by type
    const wineClass = (lot as any).wineClass || (lot as any).type;
    if (filterClass !== 'all' && wineClass !== filterClass) return false;

    // Filter by age (vintage)
    if (filterVintage !== 'all' && lot.vintage.toString() !== filterVintage) return false;

    const details = getLotDetails(r.lotId);
    const str = `${details.name} ${details.code} ${r.technician} ${r.tastingNote}`.toLowerCase();
    return str.includes(searchTerm.toLowerCase());
  });

  const filteredAdditives = (additives || []).filter(a => {
    const details = getLotDetails(a.lotId);
    const str = `${details.name} ${details.code} ${a.productName} ${a.operator} ${a.notes}`.toLowerCase();
    return str.includes(treatmentSearch.toLowerCase());
  });

  // Calculate unique lot IDs from active analyses
  const lotsWithAnalyses = Array.from(new Set(labResults.map(r => r.lotId)));

  // Setup single lot or multi-lot trend data arrays
  let singleLotData: { date: string; pH: number; freeSO2: number }[] = [];
  let multiLotData: any[] = [];

  if (selectedLots.length === 1) {
    singleLotData = labResults
      .filter(r => r.lotId === selectedLots[0])
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(r => ({
        date: r.date,
        pH: r.pH,
        freeSO2: r.freeSO2,
      }));
  } else if (selectedLots.length > 1) {
    const lotDates = Array.from(new Set(
      labResults
        .filter(r => selectedLots.includes(r.lotId))
        .map(r => r.date)
    )).sort();

    multiLotData = lotDates.map(date => {
      const row: { [key: string]: any } = { date };
      selectedLots.forEach(lotId => {
        const r = labResults.find(x => x.lotId === lotId && x.date === date);
        if (r) {
          row[lotId] = chartMetric === 'pH' ? r.pH : r.freeSO2;
        }
      });
      return row;
    });
  }

  // Stock utility displays
  const getProductStock = (productName: string) => {
    const matched = inventory?.find(i => 
      i.name.toLowerCase().includes(productName.toLowerCase()) || 
      productName.toLowerCase().includes(i.name.toLowerCase())
    );
    return matched ? `${matched.quantity.toFixed(1)} ${matched.unit}` : '0 kg (Out of Stock)';
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4 justify-between items-center sm:flex max-md:space-y-2">
        <div>
          <h3 className="text-lg font-bold font-sans text-slate-800 flex items-center gap-2">
            <Beaker className="h-5 w-5 text-[#2d0a0a]" />
            {t.lab_analysis}
          </h3>
          <p className="text-xs text-slate-400">Manage wine chemistry, track acidity trends, and adjust molecular sulfur stability</p>
        </div>

        {/* Beautiful high contrast sub-tabs */}
        <div className="bg-stone-100 p-0.5 rounded-lg flex font-mono text-[11px] font-bold shadow-2xs border border-[#EBE5D8] justify-end">
          <button 
            type="button"
            onClick={() => setActiveSubView('chemistry')}
            className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors ${activeSubView === 'chemistry' ? 'bg-white text-slate-800 font-extrabold shadow-sm' : 'text-slate-500 hover:text-slate-850'}`}
          >
            <Beaker className="h-3 w-3 inline mr-1" />
            Chemistry Analyses
          </button>
          <button 
            type="button"
            onClick={() => setActiveSubView('additives')}
            className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors ${activeSubView === 'additives' ? 'bg-white text-slate-800 font-extrabold shadow-sm' : 'text-slate-500 hover:text-slate-850'}`}
          >
            <Sparkles className="h-3 w-3 inline mr-1" />
            Treatments & Additives ({additives?.length || 0})
          </button>
        </div>
      </div>

      {activeSubView === 'chemistry' ? (
        /* CHEMISTRY ANALYTICAL WORKSPACE VIEW */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
          
          {/* Lab Inputs Sheet */}
          <div className="lg:col-span-1 bg-white border border-[#EBE5D8] p-5 rounded-xl h-fit shadow-xs space-y-4">
            <h4 className="font-semibold text-gray-800 text-xs font-mono uppercase tracking-wider text-[#722F37] flex items-center gap-1.5">
              <Beaker className="h-4 w-4 text-[#722F37]" />
              Commit Laboratory Log
            </h4>

            {panelMsg && (
              <div id="lab-form-msg" className={`p-3 rounded-lg text-xs font-mono leading-relaxed ${
                panelMsg.type === 'success' ? 'bg-green-50 text-green-800 border-l-4 border-green-500' : 'bg-red-50 text-red-800 border-l-4 border-red-500'
              }`}>
                {panelMsg.text}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3 text-xs text-gray-600">
              <div>
                <label className="text-[10px] font-mono block mb-1">Target Wine Lot *</label>
                <select 
                  value={lotId}
                  onChange={e => setLotId(e.target.value)}
                  className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden"
                  required
                >
                  <option value="">-- Choose Wine Lot --</option>
                  {lots.map(l => (
                    <option key={l.id} value={l.id}>{l.wineName} ({l.code})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-mono block mb-1">pH level *</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={pH || ''}
                    onChange={e => setPH(Number(e.target.value))}
                    placeholder="e.g. 3.45"
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden font-mono font-bold text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono block mb-1">Alcohol % *</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    value={alcohol || ''}
                    onChange={e => setAlcohol(Number(e.target.value))}
                    placeholder="e.g. 13.5"
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden font-mono font-bold text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono block mb-1">TA (g/L)*</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    value={totalAcidity || ''}
                    onChange={e => setTotalAcidity(Number(e.target.value))}
                    placeholder="e.g. 5.8"
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden font-mono font-bold text-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono block mb-1">Volatile Acidity (g/L)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={volatileAcidity || ''}
                    onChange={e => setVolatileAcidity(Number(e.target.value))}
                    placeholder="e.g. 0.45"
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono block mb-1">Residual Sugar (g/L)</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    value={residualSugar || ''}
                    onChange={e => setResidualSugar(Number(e.target.value))}
                    placeholder="g/L Dry vs Sweet"
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono block mb-1">Free SO2 (mg/L / ppm)</label>
                  <input 
                    type="number" 
                    value={freeSO2 || ''}
                    onChange={e => setFreeSO2(Number(e.target.value))}
                    placeholder="e.g. 30"
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono block mb-1">Total SO2 (mg/L / ppm)</label>
                  <input 
                    type="number" 
                    value={totalSO2 || ''}
                    onChange={e => setTotalSO2(Number(e.target.value))}
                    placeholder="e.g. 90"
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono block mb-1">Tasting & Organoleptic Impressions</label>
                <textarea 
                  value={tastingNote}
                  onChange={e => setTastingNote(e.target.value)}
                  placeholder="Arômes, barrel reaction, clarity impressions..."
                  className="w-full bg-white border border-[#EBE5D8] rounded-lg p-2 h-16 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono block mb-1">Enology Inspector Signature *</label>
                <input 
                  type="text" 
                  value={labTechnician}
                  onChange={e => setLabTechnician(e.target.value)}
                  className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden font-medium"
                  required
                />
              </div>

              <button 
                type="submit"
                className="w-full bg-[#722F37] text-white py-2 rounded-lg font-bold text-xs uppercase cursor-pointer hover:bg-opacity-95 transition-all shadow-xs"
              >
                Commit Chemistry Data
              </button>
            </form>
          </div>

          {/* Labs ledger list & molecular advice */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Molecular SO2 Smart Helper Panel */}
            {lotId && pH > 3 && (
              <div id="molecular-stability-advice" className="bg-[#FAF3F5] border border-[#722F37]/15 rounded-xl p-5 shadow-sm space-y-3 animate-fade-in">
                <h5 className="font-semibold text-[#722F37] text-xs font-mono uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-4.5 w-4.5 text-[#722F37]" />
                  Vinea Molecular Stability Intel
                </h5>
                
                {(() => {
                  const check = getSO2StabilityAdvice(pH, freeSO2);
                  return (
                    <div className="space-y-3 text-xs">
                      <p className="text-stone-600 leading-relaxed">
                        At pH <strong>{pH}</strong>, winemaking science requires a protective Free SO2 level to achieve a 0.8 mg/L molecular balance (sterile barrier limit).
                      </p>
                      <div className={`p-3 rounded-lg leading-relaxed font-mono text-[11px] border-l-4 ${
                        check.stable ? 'bg-green-50 text-green-800 border-green-500' : 'bg-red-50 text-[#722F37] border-[#722F37]'
                      }`}>
                        {check.text}
                      </div>
                      
                      {!check.stable && check.diff > 0 && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => triggerStabilityTreatment(pH, check.diff, lotId)}
                            className="bg-[#722F37] hover:bg-opacity-90 text-white font-mono font-bold text-[10px] tracking-wider uppercase px-4 py-2 rounded-lg transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                          >
                            <Sparkles className="h-3 w-3" />
                            👉 Apply Suggested KMBS Treatment (+{check.diff} ppm)
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Historical Enological Trend Chart Panel */}
            <div id="enology-trend-panel" className="bg-white border border-[#EBE5D8] rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4 pb-2 border-b border-stone-100">
                <div>
                  <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                    <TrendingUp className="h-4.5 w-4.5 text-[#722F37]" />
                    Enological Trend & Chemical Fluctuations
                  </h4>
                  <p className="text-[10px] text-slate-400 font-sans mt-0.5">
                    Analyze pH progression and antioxidant (Free SO2) buffer stability curves over time
                  </p>
                </div>
                
                {/* Selectors for comparison modes */}
                {selectedLots.length > 1 && (
                  <div className="bg-stone-100 p-0.5 rounded-lg flex font-mono text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setChartMetric('pH')}
                      className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
                        chartMetric === 'pH' 
                        ? 'bg-white text-slate-800 font-extrabold shadow-xs' 
                        : 'text-slate-500 hover:text-slate-850'
                      }`}
                    >
                      Compare pH
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartMetric('freeSO2')}
                      className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
                        chartMetric === 'freeSO2' 
                        ? 'bg-white text-slate-800 font-extrabold shadow-xs' 
                        : 'text-slate-500 hover:text-slate-850'
                      }`}
                    >
                      Compare Free SO2
                    </button>
                  </div>
                )}
              </div>

              {/* Lot Pill Checkboxes selection row */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-[10px] font-mono text-slate-400">
                  <span className="uppercase tracking-wider">Select Lots for Mapping ({selectedLots.length} Selected)</span>
                  <div className="flex gap-2">
                    <button 
                      type="button" 
                      onClick={handleSelectAll} 
                      className="hover:text-[#722F37] font-bold transition-colors"
                    >
                      [Select All]
                    </button>
                    <button 
                      type="button" 
                      onClick={handleClearAll} 
                      className="hover:text-[#722F37] font-bold transition-colors"
                    >
                      [Clear]
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {lots.map(l => {
                    const isSelected = selectedLots.includes(l.id);
                    const count = labResults.filter(r => r.lotId === l.id).length;
                    if (count === 0) return null; 
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => toggleLotSelection(l.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-all ${
                          isSelected 
                          ? 'bg-[#722F37]/10 text-[#722F37] border border-[#722F37]/30 font-semibold shadow-xs' 
                          : 'bg-stone-50 text-stone-500 border border-stone-200/60 hover:bg-stone-100'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-[#722F37]' : 'bg-stone-300'}`} />
                        {l.wineName} ({l.code})
                        <span className="opacity-60 text-[9px] font-mono">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Chart Area */}
              <div className="pt-2 bg-stone-50/40 rounded-xl border border-stone-100 p-3">
                {!mounted ? (
                  <div className="h-[280px] flex items-center justify-center text-xs text-[#722F37]/40 font-mono">
                    Loading enological graphics vectors...
                  </div>
                ) : selectedLots.length === 0 ? (
                  <div className="h-[280px] flex flex-col items-center justify-center text-center p-6 space-y-2">
                    <div className="p-3 bg-stone-100 text-stone-400 rounded-full">
                      <TrendingUp className="h-6 w-6 stroke-1" />
                    </div>
                    <p className="text-xs text-stone-500 font-medium font-sans">No Wine Lots Selected</p>
                    <p className="text-[10px] text-stone-400 font-sans">
                      Toggle one or more active wine lot parameters below to model corresponding trend progressions.
                    </p>
                  </div>
                ) : selectedLots.length === 1 ? (
                  singleLotData.length < 2 ? (
                    <div className="h-[280px] flex flex-col items-center justify-center text-center p-6 space-y-2">
                      <div className="p-3 bg-[#FAF3F5] text-[#722F37] rounded-full">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <p className="text-xs text-stone-600 font-semibold font-sans">Single Data Point Registered</p>
                      <p className="text-[10px] text-stone-400 max-w-xs font-sans">
                        Historically tracked fluctuations require at least two logged lab results. Commit another lab log for this lot to model curves!
                      </p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={singleLotData} margin={{ top: 15, right: 10, left: -5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f3f3" />
                        <XAxis 
                          dataKey="date" 
                          stroke="#94a3b8" 
                          fontSize={10} 
                          tickLine={false} 
                          tickFormatter={formatChartDate}
                        />
                        <YAxis 
                          yAxisId="left" 
                          domain={['dataMin - 0.1', 'dataMax + 0.1']} 
                          stroke="#722F37" 
                          fontSize={10} 
                          tickLine={false}
                          tickFormatter={(val) => Number(val).toFixed(2)}
                          label={{ 
                            value: 'pH level', 
                            angle: -90, 
                            position: 'insideLeft', 
                            style: { fill: '#722F37', fontSize: 10, fontWeight: 650 } 
                          }}
                        />
                        <YAxis 
                          yAxisId="right" 
                          orientation="right" 
                          domain={[0, 'dataMax + 10']} 
                          stroke="#C5A880" 
                          fontSize={10} 
                          tickLine={false}
                          tickFormatter={(val) => `${val} ppm`}
                          label={{ 
                            value: 'Free SO2 (mg/L)', 
                            angle: 90, 
                            position: 'insideRight', 
                            style: { fill: '#C5A880', fontSize: 10, fontWeight: 650 } 
                          }}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #EBE5D8', fontSize: '11px' }}
                          labelFormatter={(label) => `Analysis: ${formatDate(label)}`}
                        />
                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px' }} />
                        <Line 
                          yAxisId="left" 
                          type="monotone" 
                          dataKey="pH" 
                          name="pH Parameter (Acidity)" 
                          stroke="#722F37" 
                          strokeWidth={3} 
                          activeDot={{ r: 6 }} 
                        />
                        <Line 
                          yAxisId="right" 
                          type="monotone" 
                          dataKey="freeSO2" 
                          name="Free SO2 (Antioxidant)" 
                          stroke="#C5A880" 
                          strokeWidth={3} 
                          activeDot={{ r: 6 }} 
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )
                ) : (
                  multiLotData.length < 1 ? (
                    <div className="h-[280px] flex items-center justify-center text-xs text-stone-400 italic">
                      Insufficient data logged for comparative analytics.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={multiLotData} margin={{ top: 15, right: 10, left: -5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f3f3" />
                        <XAxis 
                          dataKey="date" 
                          stroke="#94a3b8" 
                          fontSize={10} 
                          tickLine={false} 
                          tickFormatter={formatChartDate}
                        />
                        <YAxis 
                          domain={['auto', 'auto']} 
                          stroke="#4A5759" 
                          fontSize={10} 
                          tickLine={false}
                          tickFormatter={(val) => chartMetric === 'pH' ? Number(val).toFixed(2) : `${val} ppm`}
                          label={{ 
                            value: chartMetric === 'pH' ? 'pH Parameter' : 'Free SO2 (mg/L / ppm)', 
                            angle: -90, 
                            position: 'insideLeft', 
                            style: { fill: '#4A5759', fontSize: 10, fontWeight: 650 } 
                          }}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #EBE5D8', fontSize: '11px' }}
                          labelFormatter={(label) => `Analysis: ${formatDate(label)}`}
                        />
                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px' }} />
                        {selectedLots.map((lotId, idx) => {
                          const lot = lots.find(l => l.id === lotId);
                          const name = lot ? `${lot.wineName} (${lot.code})` : lotId;
                          const color = LOT_COLORS[idx % LOT_COLORS.length];
                          return (
                            <Line
                              key={lotId}
                              type="monotone"
                              dataKey={lotId}
                              name={name}
                              stroke={color}
                              strokeWidth={3}
                              connectNulls={true}
                              activeDot={{ r: 6 }}
                            />
                          );
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  )
                )}
              </div>
            </div>

            {/* Master searchable list */}
            <div className="bg-white border border-[#EBE5D8] rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                <h4 className="font-semibold text-gray-800 text-sm">Historical Lab Analyses Registry</h4>
                
                <div className="flex flex-wrap items-center gap-2">
                  {/* Wine Class / Type Filter */}
                  <select
                    value={filterClass}
                    onChange={e => setFilterClass(e.target.value)}
                    className="bg-white border border-[#EBE5D8] px-2.5 py-1.5 rounded-lg text-xs text-stone-800 font-medium focus:outline-hidden cursor-pointer"
                  >
                    <option value="all">🔍 All Varieties / Classes</option>
                    <option value="red">🔴 Red Wines</option>
                    <option value="white">🟡 White Wines</option>
                    <option value="rose">💗 Rosé Wines</option>
                    <option value="amber">🟠 Amber / Orange Wines</option>
                  </select>

                  {/* Vintage / Age Filter */}
                  <select
                    value={filterVintage}
                    onChange={e => setFilterVintage(e.target.value)}
                    className="bg-white border border-[#EBE5D8] px-2.5 py-1.5 rounded-lg text-xs text-stone-800 font-medium focus:outline-hidden cursor-pointer"
                  >
                    <option value="all">📅 All Vintages / Ages</option>
                    {Array.from(new Set(lots.map(l => l.vintage))).sort((a,b)=>b-a).map(v => (
                      <option key={v} value={v.toString()}>{v} Harvest</option>
                    ))}
                  </select>

                  <div className="relative">
                    <input 
                      type="text" 
                      placeholder="Search labs..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="bg-white border border-[#EBE5D8] pl-8 pr-3 py-1.5 rounded-lg text-xs text-gray-700 w-full sm:w-40 focus:outline-hidden"
                    />
                    <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-2.5" />
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto text-[11px] text-gray-600">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-stone-50 font-mono text-[9px] uppercase text-gray-400 border-b border-[#EBE5D8]">
                      <th className="p-2">Date</th>
                      <th className="p-2">Wine Lot</th>
                      <th className="p-2">pH</th>
                      <th className="p-2">Alc %</th>
                      <th className="p-2">TA (g/L)</th>
                      <th className="p-2">VA (g/L)</th>
                      <th className="p-2">Free/Tot SO2</th>
                      <th className="p-2">Sugar (g/L)</th>
                      <th className="p-2">Tasting Description</th>
                      <th className="p-2">Enologist</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLabResults.map((r) => {
                      const d = getLotDetails(r.lotId);
                      return (
                        <tr key={r.id} className="border-b border-stone-100 hover:bg-stone-50/20 text-xs text-gray-700">
                          <td className="p-2 font-mono text-gray-400">{formatDate(r.date)}</td>
                          <td className="p-2 font-semibold">
                            <span className="bg-stone-100 px-1 font-mono text-[9px] font-bold text-stone-700 mr-1">{d.code}</span>
                            <span className="text-[11px] truncate inline-block align-middle max-w-[80px]">{d.name}</span>
                          </td>
                          <td className="p-2 font-bold font-mono text-gray-800">{r.pH}</td>
                          <td className="p-2 font-bold font-mono text-stone-700">{r.alcohol}%</td>
                          <td className="p-2 font-bold font-mono text-slate-650">{r.totalAcidity || '5.8'}</td>
                          <td className={`p-2 font-mono ${r.volatileAcidity > 0.8 ? 'text-red-600 font-bold' : 'text-gray-500'}`}>{r.volatileAcidity}</td>
                          <td className="p-2 font-mono">{r.freeSO2} / {r.totalSO2}</td>
                          <td className="p-2 font-mono">{r.residualSugar} g/L</td>
                          <td className="p-2 text-slate-400 italic max-w-[120px] truncate">{r.tastingNote}</td>
                          <td className="p-2 font-medium text-slate-500 whitespace-nowrap">{r.technician}</td>
                        </tr>
                      );
                    })}
                    {filteredLabResults.length === 0 && (
                      <tr>
                        <td colSpan={10} className="text-center p-8 text-gray-400 italic font-mono">No analyses matched the filters.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

        </div>
      ) : (
        /* CELLAR TREATMENTS & ADDITIVES INTEG VIEW */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
          
          {/* Formulation Setup Sheet */}
          <div className="lg:col-span-1 bg-white border border-[#EBE5D8] p-5 rounded-xl h-fit shadow-xs space-y-4">
            <h4 className="font-semibold text-gray-800 text-xs font-mono uppercase tracking-wider text-[#722F37] flex items-center gap-1.5">
              <Sparkles className="h-4.5 w-4.5 text-[#722F37]" />
              Formulate Chemical Treatment
            </h4>

            {addMsg && (
              <div id="additive-form-msg" className={`p-3 rounded-lg text-xs font-mono leading-relaxed ${
                addMsg.type === 'success' ? 'bg-green-50 text-green-800 border-l-4 border-green-500 animate-pulse' : 'bg-red-50 text-red-800 border-l-4 border-red-500'
              }`}>
                {addMsg.text}
              </div>
            )}

            <form onSubmit={handleAdditiveSubmit} className="space-y-4 text-xs text-gray-600">
              <div>
                <label className="text-[10px] font-mono block mb-1">Target Wine Lot *</label>
                <select 
                  value={addLotId}
                  onChange={e => {
                    setAddLotId(e.target.value);
                    setAddMsg(null);
                  }}
                  className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden"
                  required
                >
                  <option value="">-- Choose Wine Lot --</option>
                  {lots.map(l => (
                    <option key={l.id} value={l.id}>{l.wineName} ({l.code}) ({l.currentVolume}L)</option>
                  ))}
                </select>
                {activeLotVolume > 0 && (
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 mt-1 inline-block font-mono">
                    Holding space active volume: <strong>{activeLotVolume.toLocaleString()} Liters</strong>
                  </span>
                )}
              </div>

              <div>
                <label className="text-[10px] font-mono block mb-1">Additive / Product compound *</label>
                <select 
                  value={addProduct}
                  onChange={e => {
                    setAddProduct(e.target.value);
                    setAddMsg(null);
                    if (e.target.value.includes('KMBS')) setAddType('stabilizer');
                    else if (e.target.value.includes('Acid')) setAddType('acidification');
                    else if (e.target.value.includes('Phosphate') || e.target.value.includes('Nutrient')) setAddType('yeast_nutrient');
                    else setAddType('clarifying');
                  }}
                  className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden"
                  required
                >
                  <option value="Potassium Metabisulfite (KMBS)">Potassium Metabisulfite (KMBS)</option>
                  <option value="Tartaric Acid">Tartaric Acid (Acidifier)</option>
                  <option value="Diammonium Phosphate (DAP)">Diammonium Phosphate (DAP Nutrient)</option>
                  <option value="GoFerm Yeast Nutrient">GoFerm Yeast Nutrient</option>
                  <option value="Bentonite Clay">Bentonite Clay (Clarifying agent)</option>
                </select>
                <div className="flex justify-between items-center text-[10px] font-mono text-stone-400 mt-1">
                  <span>Warehouse Stock level:</span>
                  <span className="text-stone-700 font-bold">{getProductStock(addProduct)}</span>
                </div>
              </div>

              {/* Dynamic contextual calculators inside formulation builder */}
              {addProduct === 'Potassium Metabisulfite (KMBS)' && (
                <div className="p-3 bg-red-50/40 rounded-lg border border-red-100/40 space-y-2">
                  <span className="text-[9px] font-mono uppercase font-bold text-[#722F37] tracking-widest block">KMBS Sulfiter Solver</span>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <label className="block text-slate-400 mb-1">Desired SO2 Raise (ppm)</label>
                      <input 
                        type="number" 
                        value={targetIncreasePpm}
                        onChange={e => setTargetIncreasePpm(Number(e.target.value))}
                        className="w-full bg-white border border-stone-200 rounded px-1.5 py-1 text-center font-mono font-bold"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleCalculateKMBSDose}
                        className="w-full bg-[#722F37] text-white py-1 rounded text-[10px] font-mono hover:bg-opacity-95 cursor-pointer font-bold"
                      >
                        Compute Dose
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {addProduct === 'Tartaric Acid' && (
                <div className="p-3 bg-indigo-50/40 rounded-lg border border-indigo-100/40 space-y-2">
                  <span className="text-[9px] font-mono uppercase font-bold text-indigo-700 tracking-widest block">Acidity Corrector</span>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <label className="block text-slate-400 mb-1">Target TA (g/L)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={targetAcidIncrease}
                        onChange={e => setTargetAcidIncrease(Number(e.target.value))}
                        className="w-full bg-white border border-stone-200 rounded px-1.5 py-1 text-center font-mono font-bold"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleCalculateAcidDose}
                        className="w-full bg-indigo-700 text-white py-1 rounded text-[10px] font-mono hover:bg-opacity-95 cursor-pointer font-bold"
                      >
                        Compute Dose
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono block mb-1">Product Type</label>
                  <input
                    type="text"
                    value={addType}
                    disabled
                    className="w-full bg-stone-50 border border-stone-200/60 rounded-lg px-2 py-1.5 focus:outline-hidden font-mono uppercase text-stone-500 font-extrabold text-[9px]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono block mb-1">Dosage rate *</label>
                  <input 
                    type="text" 
                    value={addDose}
                    onChange={e => setAddDose(e.target.value)}
                    placeholder="e.g. 20 g/hL"
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono block mb-1">Total Treatment Amount (grams) *</label>
                <input 
                  type="number" 
                  value={addAmount === 0 ? '' : addAmount}
                  onChange={e => setAddAmount(Number(e.target.value))}
                  placeholder="e.g. 150 grams"
                  className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 focus:outline-hidden text-gray-800 font-bold font-mono text-sm"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-mono block mb-1">Operator *</label>
                <input 
                  type="text" 
                  value={addOperator}
                  onChange={e => setAddOperator(e.target.value)}
                  className="w-full bg-white border border-[#EBE5D8] rounded-lg px-2 py-1.5 focus:outline-hidden"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-mono block mb-1">Cellar Instruction Notes</label>
                <textarea 
                  value={addNotes}
                  onChange={e => setAddNotes(e.target.value)}
                  placeholder="E.g. dissolve in warm water before integrating into tank circulation..."
                  className="w-full bg-white border border-[#EBE5D8] rounded-lg p-2 h-16 focus:outline-hidden"
                />
              </div>

              <button 
                type="submit"
                className="w-full bg-[#722F37] text-white py-2 rounded-lg font-bold text-xs uppercase cursor-pointer hover:bg-opacity-95 transition-all shadow-xs"
              >
                Assemble & Commit Treatment
              </button>
            </form>
          </div>

          {/* Additive Treatments History log */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white border border-[#EBE5D8] rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                <div>
                  <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5">
                    <ShoppingBag className="h-4.5 w-4.5 text-[#722F37]" />
                    Cellar Treatments & Chemical Additives Ledger
                  </h4>
                  <p className="text-[10px] text-slate-400 font-sans mt-0.5">
                    Real-time immutable record of enology additions and warehouse raw stock depletion trails
                  </p>
                </div>
                
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Search treatments..."
                    value={treatmentSearch}
                    onChange={e => setTreatmentSearch(e.target.value)}
                    className="bg-white border border-[#EBE5D8] pl-8 pr-3 py-1.5 rounded-lg text-xs text-gray-700 w-full sm:w-56 focus:outline-hidden"
                  />
                  <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-2.5" />
                </div>
              </div>

              <div className="overflow-x-auto text-[11px] text-gray-600">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-stone-50 font-mono text-[9px] uppercase text-gray-400 border-b border-[#EBE5D8]">
                      <th className="p-2">Date</th>
                      <th className="p-2">Wine Lot</th>
                      <th className="p-2">Additive Material</th>
                      <th className="p-2">Dosage Rate</th>
                      <th className="p-2 text-right">Added Grams</th>
                      <th className="p-2">Cellar Operator</th>
                      <th className="p-2">Log Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(filteredAdditives || []).map((a) => {
                      const d = getLotDetails(a.lotId);
                      return (
                        <tr key={a.id} className="border-b border-stone-100 hover:bg-stone-50/20 text-xs text-gray-700">
                          <td className="p-2 font-mono text-gray-400">{formatDate(a.date)}</td>
                          <td className="p-2 font-semibold">
                            <span className="bg-stone-100 px-1 font-mono text-[9px] font-bold text-stone-700 mr-1">{d.code}</span>
                            <span className="text-[11px] truncate inline-block align-middle max-w-[80px]">{d.name}</span>
                          </td>
                          <td className="p-2 font-bold font-sans text-[#722F37]">
                            <span className="inline-block w-2 h-2 rounded-full mr-1 bg-[#722F37]" />
                            {a.productName}
                          </td>
                          <td className="p-2 font-mono text-gray-500">{a.dose}</td>
                          <td className="p-2 font-mono text-right font-extrabold text-stone-850">{(a.totalAmount).toLocaleString()}g</td>
                          <td className="p-2 text-slate-500 font-medium">{a.operator}</td>
                          <td className="p-2 text-slate-400 italic max-w-[150px] truncate" title={a.notes}>{a.notes}</td>
                        </tr>
                      );
                    })}
                    {(filteredAdditives || []).length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center p-8 text-gray-400 italic font-mono">No enological treatments resolved or matches found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
