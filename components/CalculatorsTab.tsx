import { useState } from 'react';
import { translations, Language } from '@/lib/i18n';
import { 
  calculateSO2Addition, 
  estimatePotentialAlcohol, 
  calculateBlendParameter, 
  calculateCylinderVolume, 
  calculateTartaricAcidAddition 
} from '@/lib/calculators';
import { 
  TrendingUp, Layers, HelpCircle, 
  Sparkles, Check, Info, FileText 
} from 'lucide-react';

interface CalculatorsTabProps {
  lang: Language;
}

export default function CalculatorsTab({ lang }: CalculatorsTabProps) {
  const t = translations[lang];

  // Active Sub-panel
  const [activeCalc, setActiveCalc] = useState<'so2' | 'alcohol' | 'blend' | 'tank' | 'acid'>('so2');

  // SO2 states
  const [so2Vol, setSo2Vol] = useState<number>(3500);
  const [so2Target, setSo2Target] = useState<number>(30); // ppm

  // Alcohol projection states
  const [sugarVal, setSugarVal] = useState<number>(23.5); // Brix
  const [sugarType, setSugarType] = useState<'brix' | 'sg' | 'sugar'>('brix');

  // Blending average states
  const [v1, setV1] = useState<number>(3000);
  const [p1, setP1] = useState<number>(13.5);
  const [v2, setV2] = useState<number>(2000);
  const [p2, setP2] = useState<number>(14.2);
  const [v3, setV3] = useState<number>(0);
  const [p3, setP3] = useState<number>(0);

  // Tank volume states
  const [tankDiam, setTankDiam] = useState<number>(1.8); // meters
  const [tankHeight, setTankHeight] = useState<number>(2.4); // meters

  // Acid modification states
  const [acidVol, setAcidVol] = useState<number>(5000);
  const [acidIncr, setAcidIncr] = useState<number>(1.5); // g/L

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h3 className="text-lg font-bold font-sans text-slate-800 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-[#2d0a0a]" />
          {t.calculators}
        </h3>
        <p className="text-xs text-slate-400">Scientific biochemical modifications and volume conversion calibration engine</p>
      </div>

      {/* Calculator Mode Switcher */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 border-b border-slate-200 pb-2 font-mono text-[11px] font-bold">
        <button 
          onClick={() => setActiveCalc('so2')}
          className={`px-3 py-2 rounded-sm text-left border cursor-pointer transition-all ${
            activeCalc === 'so2' 
              ? 'border-[#2d0a0a] bg-slate-100 text-[#2d0a0a]' 
              : 'border-[#EBE5D8] bg-white text-gray-400 hover:text-gray-700'
          }`}
        >
          KMBS / SO2 Addition
        </button>
        <button 
          onClick={() => setActiveCalc('alcohol')}
          className={`px-3 py-2 rounded-lg text-left border cursor-pointer transition-all ${
            activeCalc === 'alcohol' 
              ? 'border-[#722F37] bg-[#FAF3F5] text-[#722F37]' 
              : 'border-[#EBE5D8] bg-white text-gray-400 hover:text-gray-700'
          }`}
        >
          Potential Alcohol
        </button>
        <button 
          onClick={() => setActiveCalc('blend')}
          className={`px-3 py-2 rounded-lg text-left border cursor-pointer transition-all ${
            activeCalc === 'blend' 
              ? 'border-[#722F37] bg-[#FAF3F5] text-[#722F37]' 
              : 'border-[#EBE5D8] bg-white text-gray-400 hover:text-gray-700'
          }`}
        >
          Blend Averages
        </button>
        <button 
          onClick={() => setActiveCalc('tank')}
          className={`px-3 py-2 rounded-lg text-left border cursor-pointer transition-all ${
            activeCalc === 'tank' 
              ? 'border-[#722F37] bg-[#FAF3F5] text-[#722F37]' 
              : 'border-[#EBE5D8] bg-white text-gray-400 hover:text-gray-700'
          }`}
        >
          Cylinder Tank Volume
        </button>
        <button 
          onClick={() => setActiveCalc('acid')}
          className={`px-3 py-2 rounded-lg text-left border cursor-pointer transition-all ${
            activeCalc === 'acid' 
              ? 'border-[#722F37] bg-[#FAF3F5] text-[#722F37]' 
              : 'border-[#EBE5D8] bg-white text-gray-400 hover:text-gray-700'
          }`}
        >
          Tartaric Acidity
        </button>
      </div>

      {/* Main calc active block */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side (2 cols): Input & Calculations */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#EBE5D8] p-6 space-y-4 shadow-2xs">
          
          {activeCalc === 'so2' && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5 text-rose-700">
                <Sparkles className="h-4 w-4" />
                Potassium Metabisulfite (KMBS) Addition Formula
              </h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                KMBS is the primary compound used to sanitize wine. It contains exactly **57.6%** active molecular Free SO2 by weight. 
                The mathematical formula checks: <code>Addition (g) = (Volume (L) * Target Increase (ppm)) / 576</code>.
              </p>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="text-[11px] font-mono text-gray-500 block mb-1">Wine Holding Volume (Liters)</label>
                  <input 
                    type="number" 
                    value={so2Vol}
                    onChange={e => setSo2Vol(Number(e.target.value))}
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 focus:outline-hidden text-gray-800 font-bold font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-mono text-gray-500 block mb-1">Target Free SO2 Increase (ppm / mg/L)</label>
                  <input 
                    type="number" 
                    value={so2Target}
                    onChange={e => setSo2Target(Number(e.target.value))}
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 focus:outline-hidden text-gray-800 font-bold font-mono"
                  />
                </div>
              </div>

              <div className="bg-[#FAF3F5] border border-[#722F37]/10 p-5 rounded-lg text-center space-y-1">
                <span className="text-[10px] text-[#722F37] font-mono uppercase font-bold tracking-widest block">KMBS Required Additives</span>
                <span className="text-3xl font-bold text-gray-800 tracking-tight font-mono">
                  {calculateSO2Addition(so2Vol, so2Target).toLocaleString()} grams
                </span>
                <p className="text-[11px] text-gray-500 italic">Disperse pure crystals directly in sterile water before stir in holding vessel.</p>
              </div>
            </div>
          )}

          {activeCalc === 'alcohol' && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5 text-amber-700">
                <Sparkles className="h-4 w-4" />
                Sugar Potential Alcohol Calculator
              </h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                Estimates the final volumetric alcohol percentage based on grape juice sugar concentrations (expressed in Brix, Specific Gravity, or g/L).
              </p>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="text-[11px] font-mono text-gray-500 block mb-1">Sugar Unit Scale</label>
                  <select 
                    value={sugarType}
                    onChange={e => setSugarType(e.target.value as any)}
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 text-gray-700 focus:outline-hidden"
                  >
                    <option value="brix">°Brix (Refractometer)</option>
                    <option value="sg">Specific Gravity (Hydrometer)</option>
                    <option value="sugar">Sugar content (g/L)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-mono text-gray-500 block mb-1">Measured Juice Value</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={sugarVal}
                    onChange={e => setSugarVal(Number(e.target.value))}
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 focus:outline-hidden text-gray-800 font-bold font-mono"
                  />
                </div>
              </div>

              <div className="bg-stone-50 border border-stone-200 p-5 rounded-lg text-center space-y-1">
                <span className="text-[10px] text-stone-500 font-mono uppercase font-bold tracking-widest block">Potential Volumetric Alcohol Index</span>
                <span className="text-3xl font-bold text-gray-800 tracking-tight font-mono">
                  {estimatePotentialAlcohol(sugarVal, sugarType).toLocaleString()}% ABV
                </span>
                <p className="text-[11px] text-gray-400 italic">Assumes complete fermentation dry out (less than 2g/L residual sugar).</p>
              </div>
            </div>
          )}

          {activeCalc === 'blend' && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5 text-blue-700">
                <Sparkles className="h-4 w-4" />
                Multi-Lot Proportionate Blending Calculator
              </h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                Determines the exact final weighted average index (Alcohol, acidity level, pH, or SO2 density) after combining up to three distinct lots.
              </p>

              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-3 gap-3">
                  <span className="text-[10px] font-mono text-stone-400">Batch Category</span>
                  <span className="text-[10px] font-mono text-stone-400">Volume (Liters)</span>
                  <span className="text-[10px] font-mono text-stone-400">Parameter value (e.g. % Alc 또는 g/L)</span>
                </div>

                <div className="grid grid-cols-3 gap-3 items-center">
                  <span className="font-semibold text-gray-700">Lot Component A</span>
                  <input type="number" value={v1} onChange={e => setV1(Number(e.target.value))} className="border border-stone-200 p-1 rounded-md text-center font-mono focus:outline-hidden" />
                  <input type="number" step="0.1" value={p1} onChange={e => setP1(Number(e.target.value))} className="border border-stone-200 p-1 rounded-md text-center font-mono focus:outline-hidden" />
                </div>
                <div className="grid grid-cols-3 gap-3 items-center">
                  <span className="font-semibold text-gray-700">Lot Component B</span>
                  <input type="number" value={v2} onChange={e => setV2(Number(e.target.value))} className="border border-stone-200 p-1 rounded-md text-center font-mono focus:outline-hidden" />
                  <input type="number" step="0.1" value={p2} onChange={e => setP2(Number(e.target.value))} className="border border-stone-200 p-1 rounded-md text-center font-mono focus:outline-hidden" />
                </div>
                <div className="grid grid-cols-3 gap-3 items-center">
                  <span className="font-semibold text-gray-700">Lot Component C</span>
                  <input type="number" value={v3} onChange={e => setV3(Number(e.target.value))} className="border border-stone-200 p-1 rounded-md text-center font-mono focus:outline-hidden" />
                  <input type="number" step="0.1" value={p3} onChange={e => setP3(Number(e.target.value))} className="border border-stone-200 p-1 rounded-md text-center font-mono focus:outline-hidden" />
                </div>
              </div>

              <div className="bg-blue-50/50 border border-blue-100 p-5 rounded-lg text-center space-y-1">
                <span className="text-[10px] text-blue-700 font-mono uppercase font-bold tracking-widest block">Combined Calculated Average</span>
                <span className="text-3xl font-bold text-gray-800 tracking-tight font-mono">
                  {calculateBlendParameter([
                    { volume: v1, parameterValue: p1 },
                    { volume: v2, parameterValue: p2 },
                    { volume: v3, parameterValue: p3 }
                  ]).toLocaleString()}
                </span>
                <p className="text-[11px] text-gray-400 italic">Total blended volume: {(v1+v2+v3).toLocaleString()} Liters.</p>
              </div>
            </div>
          )}

          {activeCalc === 'tank' && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5 text-teal-700">
                <Sparkles className="h-4 w-4" />
                Cylindrical Tank Capacity Calibration
              </h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                Applies standard geometric cylinder rules to calculate fluid filling levels: <code>Volume (L) = Pi * Radius^2 * Liquid Height * 1000</code>.
              </p>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="text-[11px] font-mono text-gray-500 block mb-1">Vessel Internal Diameter (meters)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={tankDiam}
                    onChange={e => setTankDiam(Number(e.target.value))}
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 focus:outline-hidden text-gray-800 font-bold font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-mono text-gray-500 block mb-1">Liquid Height Level (meters)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={tankHeight}
                    onChange={e => setTankHeight(Number(e.target.value))}
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 focus:outline-hidden text-gray-800 font-bold font-mono"
                  />
                </div>
              </div>

              <div className="bg-teal-50/30 border border-teal-100 p-5 rounded-lg text-center space-y-1">
                <span className="text-[10px] text-teal-800 font-mono uppercase font-bold tracking-widest block">Liquid Filing Capacity</span>
                <span className="text-3xl font-bold text-gray-800 tracking-tight font-mono">
                  {calculateCylinderVolume(tankDiam, tankHeight).toLocaleString()} Liters
                </span>
                <p className="text-[11px] text-gray-400 italic">Physical dimensions calibrated for upright cylindrical holds.</p>
              </div>
            </div>
          )}

          {activeCalc === 'acid' && (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5 text-purple-700">
                <Sparkles className="h-4 w-4" />
                Tartaric Acid Modification Sheet
              </h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                Calculates the total kilograms/grams of Tartaric Acid addition needed to correct juice total acidity indexes. Tartaric acid adds directly to volumetric weight (1g/L acid adds 1g per Liter weight).
              </p>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="text-[11px] font-mono text-gray-500 block mb-1">Total Juice Volume (Liters)</label>
                  <input 
                    type="number" 
                    value={acidVol}
                    onChange={e => setAcidVol(Number(e.target.value))}
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 focus:outline-hidden text-gray-800 font-bold font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-mono text-gray-500 block mb-1">Desired Acidity Increase (g/L)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={acidIncr}
                    onChange={e => setAcidIncr(Number(e.target.value))}
                    className="w-full bg-white border border-[#EBE5D8] rounded-lg px-3 py-1.5 focus:outline-hidden text-gray-800 font-bold font-mono"
                  />
                </div>
              </div>

              <div className="bg-[#FAF3F5] border border-[#722F37]/10 p-5 rounded-lg text-center space-y-1">
                <span className="text-[10px] text-[#722F37] font-mono uppercase font-bold tracking-widest block">Pure Tartaric Acid Weight</span>
                <span className="text-3xl font-bold text-gray-800 tracking-tight font-mono">
                  {(calculateTartaricAcidAddition(acidVol, acidIncr) / 1000).toFixed(2)} kilograms
                </span>
                <p className="text-[11px] text-gray-500 italic">({calculateTartaricAcidAddition(acidVol, acidIncr).toLocaleString()} grams required). Disperse thoroughly.</p>
              </div>
            </div>
          )}

        </div>

        {/* Right Side (1 col): Technical Winemaking Principles */}
        <div className="bg-[#FDFBF7] border border-[#EBE5D8] rounded-xl p-5 shadow-xs space-y-4 h-fit">
          <h5 className="font-sans font-bold text-gray-800 text-xs font-mono uppercase tracking-widest text-[#722F37]">Scientific Directives</h5>
          
          <div className="space-y-3 text-xs text-gray-600 leading-relaxed">
            <div className="p-3 bg-white rounded-lg border border-[#EBE5D8] space-y-1">
              <strong className="text-gray-800 block">Molecular SO2 Thresholds</strong>
              <p className="text-[11px] text-gray-500">
                To secure sterile cell environments, maintain molecular SO2 levels of 0.8 mg/L for whites, and 0.5 mg/L for reds. Higher pH wines demand multi-fold higher additions.
              </p>
            </div>

            <div className="p-3 bg-white rounded-lg border border-[#EBE5D8] space-y-1">
              <strong className="text-gray-800 block">Yeast Conversion Kinetics</strong>
              <p className="text-[11px] text-gray-500">
                Saccharomyces yeasts standardly convert 16.83 g/L sugar into 1% Alcohol. Refractometers read unfermented sugar in °Brix. Fermenting must should be analyzed via hydrometer (D-20 scale).
              </p>
            </div>

            <div className="p-3 bg-white rounded-lg border border-[#EBE5D8] space-y-1">
              <strong className="text-gray-800 block">Acidity Modifications</strong>
              <p className="text-[11px] text-gray-500">
                Tartaric acid correction must be done prior to primary fermentation (must phase) to secure optimal integration and sensory clean dry-out.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
