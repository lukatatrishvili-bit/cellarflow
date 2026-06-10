'use client';

import React, { useState, useEffect } from 'react';
import { translations, Language } from '../lib/i18n';
import { 
  FlaskConical, 
  Droplets, 
  Percent, 
  RefreshCw, 
  Sliders, 
  TriangleAlert, 
  Gauge, 
  Scale, 
  Info, 
  Compass, 
  ShieldCheck,
  Zap
} from 'lucide-react';

import { Vessel, WineLot, LabAnalysis } from '../lib/wineryState';

interface Props {
  lang: Language;
  lots?: WineLot[];
  vessels?: Vessel[];
  labLogs?: LabAnalysis[];
  calculatorLotId?: string;
  setCalculatorLotId?: (val: string) => void;
  calculatorLotIdA?: string;
  setCalculatorLotIdA?: (val: string) => void;
  calculatorLotIdB?: string;
  setCalculatorLotIdB?: (val: string) => void;
}

export default function EnoCalculators({
  lang,
  lots = [],
  vessels = [],
  labLogs = [],
  calculatorLotId = '',
  setCalculatorLotId = () => {},
  calculatorLotIdA = '',
  setCalculatorLotIdA = () => {},
  calculatorLotIdB = '',
  setCalculatorLotIdB = () => {}
}: Props) {
  const t = translations[lang];

  // Active calculator tab in standard sub-navigation
  const [activeSubTab, setActiveSubTab] = useState<'so2' | 'blend' | 'alcohol' | 'vessel' | 'acid'>('so2');

  // --- CALCULATOR 1: ADVANCED SO2 EQUILIBRIUM & KMBS ---
  const [so2CurrentFree, setSo2CurrentFree] = useState<number>(15);
  const [so2PH, setSo2PH] = useState<number>(3.45);
  const [so2Temp, setSo2Temp] = useState<number>(14.0); // Celcius
  const [so2ABV, setSo2ABV] = useState<number>(13.5); // ABV
  const [so2Volume, setSo2Volume] = useState<number>(2500); // Liters
  const [so2TargetMolMode, setSo2TargetMolMode] = useState<'white' | 'red' | 'custom'>('white');
  const [so2CustomTargetMol, setSo2CustomTargetMol] = useState<number>(0.8);
  const [kmbsPurity, setKmbsPurity] = useState<number>(57); // 57% average active SO2 in KMBS

  // Outputs for SO2
  const [molecularSO2Result, setMolecularSO2Result] = useState<{
    pKa: number;
    fraction: number;
    currentMolecular: number;
    targetFreeNeeded: number;
    freeSO2ToIncrease: number;
    kmbsGramsNeeded: number;
    warningStyle: 'danger' | 'marginal' | 'safe';
    warningMessage: string;
  } | null>(null);

  // Pre-load SO2 Calculator inputs from lot data when a lot is selected
  useEffect(() => {
    if (!calculatorLotId) return;
    const lot = lots.find(l => l.id === calculatorLotId);
    if (!lot) return;
    
    const vessel = vessels.find(v => v.assignedLotId === lot.id);
    const lotLabs = labLogs.filter(log => log.lotId === lot.id);
    const latestLab = lotLabs[0];
    
    if (latestLab) {
      setSo2CurrentFree(latestLab.freeSo2);
      setSo2PH(latestLab.ph || 3.5);
      setSo2ABV(latestLab.alcoholPct || 13.5);
    }
    
    if (vessel) {
      setSo2Volume(vessel.currentVolume);
      setSo2Temp(vessel.temperature || 15.0);
    } else {
      setSo2Volume(lot.currentVolume);
    }
  }, [calculatorLotId, lots, vessels, labLogs]);

  // Pre-load Blending Calculator inputs from lot data when Lot A or Lot B is selected
  useEffect(() => {
    if (!calculatorLotIdA) return;
    const lot = lots.find(l => l.id === calculatorLotIdA);
    if (!lot) return;
    
    const vessel = vessels.find(v => v.assignedLotId === lot.id);
    const lotLabs = labLogs.filter(log => log.lotId === lot.id);
    const latestLab = lotLabs[0];
    
    if (latestLab) {
      setBlendParamA(latestLab.alcoholPct || 13.5);
      setBlendPHA(latestLab.ph || 3.5);
      setBlendTAA(latestLab.titratableAcidity || 6.0);
    }
    if (vessel) {
      setBlendVolA(vessel.currentVolume);
    } else {
      setBlendVolA(lot.currentVolume);
    }
  }, [calculatorLotIdA, lots, vessels, labLogs]);

  useEffect(() => {
    if (!calculatorLotIdB) return;
    const lot = lots.find(l => l.id === calculatorLotIdB);
    if (!lot) return;
    
    const vessel = vessels.find(v => v.assignedLotId === lot.id);
    const lotLabs = labLogs.filter(log => log.lotId === lot.id);
    const latestLab = lotLabs[0];
    
    if (latestLab) {
      setBlendParamB(latestLab.alcoholPct || 13.5);
      setBlendPHB(latestLab.ph || 3.5);
      setBlendTAB(latestLab.titratableAcidity || 6.0);
    }
    if (vessel) {
      setBlendVolB(vessel.currentVolume);
    } else {
      setBlendVolB(lot.currentVolume);
    }
  }, [calculatorLotIdB, lots, vessels, labLogs]);

  useEffect(() => {
    // 1. Calculate temperature & alcohol adjusted pKa of SO2
    // pKa references around 1.81. Increases with temp (exothermic dissociation), decreases slightly under ethanol.
    const pKa = 1.81 + 0.013 * (so2Temp - 20) - 0.007 * so2ABV;
    
    // 2. Fraction of Free SO2 in molecular state: f = 1 / (1 + 10^(pH - pKa))
    const fraction = 1 / (1 + Math.pow(10, so2PH - pKa));
    
    // 3. Current Molecular SO2 (mg/L)
    const currentMolecular = so2CurrentFree * fraction;

    // 4. Target Molecular SO2
    const targetMolecular = so2TargetMolMode === 'white' ? 0.8 : (so2TargetMolMode === 'red' ? 0.5 : so2CustomTargetMol);

    // 5. Target Free SO2 needed to achieve target molecular
    const targetFreeNeeded = targetMolecular / fraction;

    // 6. Free SO2 addition required
    const freeSO2ToIncrease = Math.max(0, targetFreeNeeded - so2CurrentFree);

    // 7. Grams KMBS = (mg/L increase * Liters) / (1000 * purityFraction)
    const kmbsGramsNeeded = (freeSO2ToIncrease * so2Volume) / (1000 * (kmbsPurity / 100));

    // Determine safe status
    // Standard white molecular shelf stability threshold is 0.8 mg/L. Standard red is 0.5 mg/L.
    let warningStyle: 'danger' | 'marginal' | 'safe' = 'danger';
    let warningMessage = '';

    if (currentMolecular >= targetMolecular - 0.05) {
      warningStyle = 'safe';
      warningMessage = `Vastly Protected. Active molecular of ${currentMolecular.toFixed(2)} mg/L meets target thresholds against yeast, Brettanomyces, and acetic acid bacteria.`;
    } else if (currentMolecular >= 0.4) {
      warningStyle = 'marginal';
      warningMessage = `Marginally Protected. Low bio-protection overhead. At higher pH states or storage temperatures, spoilage organisms can slowly proliferate.`;
    } else {
      warningStyle = 'danger';
      warningMessage = `CRITICAL BIOLOGICAL RISK. Under-sulfited. Below 0.4 mg/L molecular, Saccharomyces and wild flora can revive. Increase Free SO2.`;
    }

    if (so2PH >= 3.8) {
      warningMessage += ` WARNING: Exceptionally high pH (${so2PH}) renders SO2 nearly inactive (Fraction: ${(fraction * 100).toFixed(2)}%). Consider tartaric acidification first to drop pH, else sulfur additions will bleach color and trigger off-flavors.`;
    }

    setMolecularSO2Result({
      pKa,
      fraction,
      currentMolecular,
      targetFreeNeeded,
      freeSO2ToIncrease,
      kmbsGramsNeeded,
      warningStyle,
      warningMessage
    });
  }, [so2CurrentFree, so2PH, so2Temp, so2ABV, so2Volume, so2TargetMolMode, so2CustomTargetMol, kmbsPurity]);


  // --- CALCULATOR 2: LOGARITHMIC BLEND & PEARSON'S SQUARE ---
  const [blendVolA, setBlendVolA] = useState<number>(3000);
  const [blendParamA, setBlendParamA] = useState<number>(13.5); // ABV
  const [blendPHA, setBlendPHA] = useState<number>(3.35); // pH logarithmic
  const [blendTAA, setBlendTAA] = useState<number>(6.2); // TA g/L

  const [blendVolB, setBlendVolB] = useState<number>(1500);
  const [blendParamB, setBlendParamB] = useState<number>(14.8); // ABV
  const [blendPHB, setBlendPHB] = useState<number>(3.85); // pH logarithmic
  const [blendTAB, setBlendTAB] = useState<number>(4.8); // TA g/L

  // Pearson's Square helper inputs
  const [pearsonsTarget, setPearsonsTarget] = useState<number>(13.9); // Target ABV
  const [pearsonsTotalVol, setPearsonsTotalVol] = useState<number>(4500); // Desired blend volume

  const [blendOutput, setBlendOutput] = useState<{
    totalVolume: number;
    finalABV: number;
    finalTA: number;
    finalPH: number;
    pearsonsRatioA: number;
    pearsonsRatioB: number;
    pearsonsVolA: number;
    pearsonsVolB: number;
    isPearsonsFeasible: boolean;
  } | null>(null);

  useEffect(() => {
    const totalVolume = blendVolA + blendVolB;
    if (totalVolume <= 0) return;

    // Linear weighted parameters (ABV & TA)
    const finalABV = ((blendVolA * blendParamA) + (blendVolB * blendParamB)) / totalVolume;
    const finalTA = ((blendVolA * blendTAA) + (blendVolB * blendTAB)) / totalVolume;

    // LOGARITHMIC pH Blending: [H+] = 10^-pH
    const hConcA = Math.pow(10, -blendPHA);
    const hConcB = Math.pow(10, -blendPHB);
    const blendedHConc = ((blendVolA * hConcA) + (blendVolB * hConcB)) / totalVolume;
    const finalPH = -Math.log10(blendedHConc);

    // Pearson's Square proportionality targeting ABV (blendParamA vs blendParamB towards target)
    const minParam = Math.min(blendParamA, blendParamB);
    const maxParam = Math.max(blendParamA, blendParamB);
    const isPearsonsFeasible = pearsonsTarget > minParam && pearsonsTarget < maxParam;

    let pearsonsRatioA = 0;
    let pearsonsRatioB = 0;
    let pearsonsVolA = 0;
    let pearsonsVolB = 0;

    if (isPearsonsFeasible) {
      // Parts of A = Absolute difference of B and Target
      const partsA = Math.abs(blendParamB - pearsonsTarget);
      // Parts of B = Absolute difference of A and Target
      const partsB = Math.abs(blendParamA - pearsonsTarget);
      const totalParts = partsA + partsB;

      pearsonsRatioA = partsA / totalParts;
      pearsonsRatioB = partsB / totalParts;

      pearsonsVolA = pearsonsTotalVol * pearsonsRatioA;
      pearsonsVolB = pearsonsTotalVol * pearsonsRatioB;
    }

    setBlendOutput({
      totalVolume,
      finalABV,
      finalTA,
      finalPH,
      pearsonsRatioA,
      pearsonsRatioB,
      pearsonsVolA,
      pearsonsVolB,
      isPearsonsFeasible
    });
  }, [blendVolA, blendParamA, blendPHA, blendTAA, blendVolB, blendParamB, blendPHB, blendTAB, pearsonsTarget, pearsonsTotalVol]);


  // --- CALCULATOR 3: ADVANCED ALCOHOL & FERMENTATION ATTENUATOR ---
  const [startSG, setStartSG] = useState<number>(1.096); // Starting Specific Gravity
  const [currentSG, setCurrentSG] = useState<number>(0.992); // Ending Specific Gravity
  const [yeastYield, setYeastYield] = useState<number>(0.59); // Grams of sugar converted to alc (0.55 - 0.65)
  const [sampleTemp, setSampleTemp] = useState<number>(20.0); // Hydrometer temp

  const [alcOutput, setAlcOutput] = useState<{
    startingBrix: number;
    currentBrix: number;
    tempCorrectedSG: number;
    apparentABV: number;
    advancedABV: number;
    spentBrix: number;
    attenuation: number;
  } | null>(null);

  useEffect(() => {
    // 1. Hydrometer temperature correction
    // Most cellars are at 15-20C. Standard hydrometers are calibrated at 20C.
    // SG correction factor approx.
    const correction = 0.00013 * (sampleTemp - 20) + 0.000003 * Math.pow(sampleTemp - 20, 2);
    const tempCorrectedSG = currentSG + correction;

    // 2. Specific gravity to Brix conversions
    // Plato/Brix equation: Brix = 261.3 * (1 - 1 / SG)
    const startingBrix = 261.3 * (1 - 1 / startSG);
    const currentBrix = 261.3 * (1 - 1 / Math.max(0.5, tempCorrectedSG));

    // 3. Apparent ABV (basic linear formula): ABV = (StartSG - EndSG) * 131.25
    const apparentABV = (startSG - tempCorrectedSG) * 131.25;

    // 4. Advanced Non-Linear ABV (Cutaia & Bailey equations taking yeast expansion contraction & mass-loss CO2 escaping):
    // ABV% = (76.08 * (SG_start - SG_end)) / (1.775 - SG_start) * (SG_end / 0.794)
    const advancedABV = ((76.08 * (startSG - tempCorrectedSG)) / (1.775 - startSG)) * (tempCorrectedSG / 0.794);

    const spentBrix = startingBrix - currentBrix;
    // Attenuation rate %
    const attenuation = Math.min(100, Math.max(0, (spentBrix / startingBrix) * 100));

    setAlcOutput({
      startingBrix,
      currentBrix,
      tempCorrectedSG,
      apparentABV,
      advancedABV,
      spentBrix,
      attenuation
    });
  }, [startSG, currentSG, yeastYield, sampleTemp]);


  // --- CALCULATOR 4: VESSEL GEOMETRY & HEADSPACE (ULLAGE) SENTRY ---
  const [tankShape, setTankShape] = useState<'cylinder_flat' | 'cylinder_cone' | 'oak_barrel'>('cylinder_cone');
  const [vesselRadius, setVesselRadius] = useState<number>(0.9); // meters
  const [vesselHeight, setVesselHeight] = useState<number>(2.4); // cylindrical portion meters
  const [coneHeight, setConeHeight] = useState<number>(0.5); // height of bottom cone
  const [measuredLiquidHeight, setMeasuredLiquidHeight] = useState<number>(1.8); // meters from bottom including cone

  const [vesselOutput, setVesselOutput] = useState<{
    totalCapacityL: number;
    liquidVolumeL: number;
    ullageL: number;
    ullagePercentage: number;
    riskStatus: 'minimal' | 'warning' | 'critical';
    oxidativeAdvice: string;
  } | null>(null);

  useEffect(() => {
    let totalCapacityL = 0;
    let liquidVolumeL = 0;

    const r = vesselRadius;
    const h = vesselHeight;

    if (tankShape === 'cylinder_flat') {
      // Cylinder = PI * r^2 * h
      const cylinderVolM3 = Math.PI * r * r * h;
      totalCapacityL = cylinderVolM3 * 1000;

      const fill = Math.min(h, measuredLiquidHeight);
      liquidVolumeL = Math.PI * r * r * fill * 1000;
    } else if (tankShape === 'cylinder_cone') {
      // Cylindrical portion + Conical bottom
      // Cone Volume = (1/3) * PI * r^2 * h_cone
      const coneVolM3 = (1 / 3) * Math.PI * r * r * coneHeight;
      const cylVolM3 = Math.PI * r * r * h;
      totalCapacityL = (coneVolM3 + cylVolM3) * 1000;

      const hLiq = measuredLiquidHeight;
      if (hLiq <= coneHeight) {
        // Only filling the cone portion. Liquid radius is proportional!
        // r_liq = r * (h_liq / coneHeight)
        const proportionalRadius = r * (hLiq / coneHeight);
        const variableConeVol = (1 / 3) * Math.PI * proportionalRadius * proportionalRadius * hLiq;
        liquidVolumeL = variableConeVol * 1000;
      } else {
        // Cone is full + some cylinder height
        const extraCyl = Math.min(h, hLiq - coneHeight);
        liquidVolumeL = (coneVolM3 + (Math.PI * r * r * extraCyl)) * 1000;
      }
    } else {
      // Wooden barrel / Barrique model (bilge expansion approximation)
      // Standard barrique shape is barrel of rotational parabolic curvature
      // volume ~ PI * h_barrel * (r_mid^2 * 2 + r_ends^2) / 3 or simplified bilge multiplier
      // Dynamic flat estimation
      const totalBarrelL = 225; // Standard barrique
      totalCapacityL = totalBarrelL;
      // Proportional level
      const fillRatio = Math.min(1.0, measuredLiquidHeight / 0.7); // 70cm diameter typical barrique
      liquidVolumeL = totalBarrelL * Math.pow(fillRatio, 1.8); // Non-linear chord volume
    }

    // Safety checks
    if (liquidVolumeL > totalCapacityL) {
      liquidVolumeL = totalCapacityL;
    }

    const ullageL = Math.max(0, totalCapacityL - liquidVolumeL);
    const ullagePercentage = totalCapacityL > 0 ? (ullageL / totalCapacityL) * 100 : 0;

    let riskStatus: 'minimal' | 'warning' | 'critical' = 'minimal';
    let oxidativeAdvice = '';

    if (ullagePercentage < 1.5) {
      riskStatus = 'minimal';
      oxidativeAdvice = 'Excellent volume optimization. Extremely low pocket of oxygen prevents film yeasts (Mycoderma aceti) and Acetobacter colonies.';
    } else if (ullagePercentage <= 8.0) {
      riskStatus = 'warning';
      oxidativeAdvice = 'Moderate headspace warning. Gaseous volume allows oxygen circulation. Inert gas blanketing (CO₂/Argon) required daily to prevent ethanol converting to volatile acetaldehyde.';
    } else {
      riskStatus = 'critical';
      oxidativeAdvice = 'CRITICAL OXIDATIVE RISK. High headspace. Acetone-like ethyl acetate or vinegar-like acetic acid will quickly spoil sensory profile. Spill into smaller vessels or insert immediate dry ice dry blocks.';
    }

    setVesselOutput({
      totalCapacityL: Math.round(totalCapacityL),
      liquidVolumeL: Math.round(liquidVolumeL),
      ullageL: Math.round(ullageL),
      ullagePercentage,
      riskStatus,
      oxidativeAdvice
    });
  }, [tankShape, vesselRadius, vesselHeight, coneHeight, measuredLiquidHeight]);


  // --- CALCULATOR 5: ADVANCED ACID DE-ACIDIFIER MODELER ---
  const [wineAcidVol, setWineAcidVol] = useState<number>(3500);
  const [currTA, setCurrTA] = useState<number>(5.2); // g/L in tartaric 
  const [targetTA, setTargetTA] = useState<number>(6.5); // g/L in tartaric
  const [acidAdditiveType, setAcidAdditiveType] = useState<'tartaric' | 'malic' | 'citric' | 'carbonate_deacid' | 'bicarbonate_deacid'>('tartaric');

  const [acidOutput, setAcidOutput] = useState<{
    dosageGrams: number;
    dosagPerHL: number;
    taExpectedDelta: number;
    acidChemistryComment: string;
  } | null>(null);

  useEffect(() => {
    let dosageGrams = 0;
    let taExpectedDelta = targetTA - currTA;
    let acidChemistryComment = '';

    const deltaReq = targetTA - currTA;

    if (acidAdditiveType === 'tartaric') {
      // 1 g/L addition of Tartaric acid increases Titratable Acidity exactly by 1 g/L
      if (deltaReq > 0) {
        dosageGrams = deltaReq * wineAcidVol;
        acidChemistryComment = 'Direct tartaric acid addition. Standard organic acidification. Expect a strong drop in pH (approx 0.1 - 0.25 units depends on buffer state) and vibrant crisp mouthfeel. Also promotes color shift towards rubies.';
      }
    } else if (acidAdditiveType === 'malic') {
      if (deltaReq > 0) {
        // Malic acts cooler, gives apple-like acidity. Neutralizing offset represents roughly 0.9 g/L TA per 1g/L
        dosageGrams = (deltaReq / 0.9) * wineAcidVol;
        acidChemistryComment = 'Malic Acid addition. Highly microbial unstable if the wine is slated to undergo Malolactic Fermentation (MLF). High risk of lactic spoilage if not sulfited well.';
      }
    } else if (acidAdditiveType === 'citric') {
      if (deltaReq > 0) {
        dosageGrams = (deltaReq / 0.8) * wineAcidVol;
        acidChemistryComment = 'Citric Acid addition. Fresh citrus lift. Must only be added post-fermentation, as Saccharomyces yeasts can metabolize citric acid into acetic acid (volatile acidity spiker). Limit to 0.5g/L max by EU law.';
      }
    } else if (acidAdditiveType === 'carbonate_deacid') {
      // Calcium Carbonate CaCO3 deacidification.
      // 0.67 g/L reduces TA by approx 1.0 g/L by precipitation.
      if (deltaReq < 0) {
        const dropAmt = Math.abs(deltaReq);
        dosageGrams = dropAmt * 0.67 * wineAcidVol;
        acidChemistryComment = 'Calcium Carbonate deacidification. Promotes double-salt precipitation of calcium tartro-malate. Requires 2-4 weeks sediment rest. Softens over-acidic vintages but can bleach delicate aromatics.';
      }
    } else {
      // Potassium Bicarbonate KHCO3 deacidification.
      // 0.67 g/L reduces TA by approx 1 g/L but triggers rapid Cream of Tartar precipitation.
      if (deltaReq < 0) {
        const dropAmt = Math.abs(deltaReq);
        dosageGrams = dropAmt * 0.67 * wineAcidVol;
        acidChemistryComment = 'Potassium Bicarbonate double precipitation. Triggers rapid precipitation of potassium bitartrate. Demands immediate cold stabilization (thermo-chilling at -4°C) to drop crystals before racking.';
      }
    }

    const dosagPerHL = wineAcidVol > 0 ? (dosageGrams / (wineAcidVol / 100)) : 0;

    setAcidOutput({
      dosageGrams: parseFloat(dosageGrams.toFixed(1)),
      dosagPerHL: parseFloat(dosagPerHL.toFixed(1)),
      taExpectedDelta,
      acidChemistryComment
    });
  }, [wineAcidVol, currTA, targetTA, acidAdditiveType]);

  return (
    <div className="space-y-6">
      
      {/* 5-Tab Nested Navigation Bar */}
      <div className="flex flex-wrap items-center gap-1 bg-[#FAF8F5] p-1 border border-[#e8dfd5] rounded-xl">
        <button 
          onClick={() => setActiveSubTab('so2')}
          className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeSubTab === 'so2' 
              ? 'bg-[#4e0e15] text-white shadow-xs' 
              : 'text-stone-600 hover:text-[#4e0e15] hover:bg-white/70'
          }`}
        >
          <FlaskConical className="w-3.5 h-3.5" />
          <span>SO₂ Equilibrium</span>
        </button>

        <button 
          onClick={() => setActiveSubTab('blend')}
          className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeSubTab === 'blend' 
              ? 'bg-[#4e0e15] text-white shadow-xs' 
              : 'text-stone-600 hover:text-[#4e0e15] hover:bg-white/70'
          }`}
        >
          <Droplets className="w-3.5 h-3.5" />
          <span>Blend & Pearson′s Square</span>
        </button>

        <button 
          onClick={() => setActiveSubTab('alcohol')}
          className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeSubTab === 'alcohol' 
              ? 'bg-[#4e0e15] text-white shadow-xs' 
              : 'text-stone-600 hover:text-[#4e0e15] hover:bg-white/70'
          }`}
        >
          <Percent className="w-3.5 h-3.5" />
          <span>ABV & Hydrometer</span>
        </button>

        <button 
          onClick={() => setActiveSubTab('vessel')}
          className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeSubTab === 'vessel' 
              ? 'bg-[#4e0e15] text-white shadow-xs' 
              : 'text-stone-600 hover:text-[#4e0e15] hover:bg-white/70'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Geometry & Headspace</span>
        </button>

        <button 
          onClick={() => setActiveSubTab('acid')}
          className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeSubTab === 'acid' 
              ? 'bg-[#4e0e15] text-white shadow-xs' 
              : 'text-stone-600 hover:text-[#4e0e15] hover:bg-white/70'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Acid Modeller</span>
        </button>
      </div>

      {/* --- TAB 1 DETAILED CONTENT: SO2 EQUILIBRIUM --- */}
      {activeSubTab === 'so2' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Controls */}
          <div className="lg:col-span-7 bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs space-y-4">
            <h3 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-2">
              <FlaskConical className="w-4.5 h-4.5 text-[#801323]" />
              Thermodynamic SO₂ & KMBS Dose Modeller
            </h3>
            <p className="text-xs text-slate-500">
              Only molecular (non-dissociated) SO₂ gas penetrates microbe walls to inhibit spoilage. This calculator calculates ionic equilibrium based on temperature, ABV%, and pH.
            </p>

            {lots && lots.length > 0 && (
              <div className="bg-[#FAF8F5] p-3 border border-[#e8dfd5] rounded-xl space-y-1">
                <label className="block text-[9px] font-mono font-bold uppercase text-[#4e0e15] tracking-wider">
                  🍇 Sync Cellar State: Select Active Lot
                </label>
                <select
                  value={calculatorLotId}
                  onChange={(e) => setCalculatorLotId(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-stone-200 rounded-lg bg-white text-stone-850 font-semibold outline-none cursor-pointer hover:border-slate-350"
                >
                  <option value="">-- Manual Input / Select Lot --</option>
                  {lots.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name} [{l.id}]
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Current Free SO₂ (mg/L)
                </label>
                <input 
                  type="number" 
                  value={so2CurrentFree} 
                  onChange={(e) => setSo2CurrentFree(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805 focus:bg-white focus:border-red-800"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Wine Acidity (pH Value)
                </label>
                <div className="flex items-center gap-2">
                  <input 
                    type="range"
                    min="2.8"
                    max="4.3"
                    step="0.05"
                    value={so2PH}
                    onChange={(e) => setSo2PH(parseFloat(e.target.value))}
                    className="flex-1 accent-[#801323] cursor-pointer"
                  />
                  <span className="text-xs font-mono font-bold bg-[#FAF8F5] px-2.5 py-1 border border-stone-200 rounded min-w-[50px] text-center">
                    {so2PH.toFixed(2)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Cellar Temperature (°C)
                </label>
                <input 
                  type="number" 
                  value={so2Temp} 
                  onChange={(e) => setSo2Temp(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Wine Alcohol (% vol ABV)
                </label>
                <input 
                  type="number" 
                  value={so2ABV} 
                  onChange={(e) => setSo2ABV(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805"
                />
              </div>

              <div className="col-span-2 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => { setSo2TargetMolMode('white'); setSo2CustomTargetMol(0.8); }}
                  className={`px-2 py-1.5 text-[10.5px] font-medium rounded border transition-all cursor-pointer ${
                    so2TargetMolMode === 'white' 
                      ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold' 
                      : 'bg-white border-stone-200 text-slate-600'
                  }`}
                >
                  White style (0.8 mg/L Mol)
                </button>
                <button
                  type="button"
                  onClick={() => { setSo2TargetMolMode('red'); setSo2CustomTargetMol(0.5); }}
                  className={`px-2 py-1.5 text-[10.5px] font-medium rounded border transition-all cursor-pointer ${
                    so2TargetMolMode === 'red' 
                      ? 'bg-rose-50 border-rose-300 text-rose-900 font-bold' 
                      : 'bg-white border-stone-200 text-slate-600'
                  }`}
                >
                  Red style (0.5 mg/L Mol)
                </button>
                <button
                  type="button"
                  onClick={() => setSo2TargetMolMode('custom')}
                  className={`px-2 py-1.5 text-[10.5px] font-medium rounded border transition-all cursor-pointer ${
                    so2TargetMolMode === 'custom' 
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-900 font-bold' 
                      : 'bg-white border-stone-200 text-slate-600'
                  }`}
                >
                  Custom Molecular Limit
                </button>
              </div>

              {so2TargetMolMode === 'custom' && (
                <div className="col-span-2">
                  <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                    Custom Target Molecular SO₂ (mg/L limit)
                  </label>
                  <input 
                    type="number" 
                    step="0.05"
                    value={so2CustomTargetMol} 
                    onChange={(e) => setSo2CustomTargetMol(parseFloat(e.target.value) || 0.8)}
                    className="w-48 px-3 py-1 bg-stone-50 border border-stone-200 text-xs rounded outline-none"
                  />
                </div>
              )}

              <div className="col-span-2 grid grid-cols-2 gap-4 border-t border-slate-100 pt-3">
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                    Batch Volume of Wine (L)
                  </label>
                  <input 
                    type="number" 
                    value={so2Volume} 
                    onChange={(e) => setSo2Volume(Math.max(1, parseFloat(e.target.value) || 0))}
                    className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                    KMBS active SO₂ Yield (%)
                  </label>
                  <input 
                    type="number" 
                    value={kmbsPurity} 
                    onChange={(e) => setKmbsPurity(Math.max(1, parseFloat(e.target.value) || 0))}
                    className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Outputs / Gauges */}
          {molecularSO2Result && (
            <div className="lg:col-span-5 flex flex-col gap-4">
              {/* Core visual risk card */}
              <div className={`p-5 rounded-xl border text-stone-850 space-y-3.5 shadow-xs ${
                molecularSO2Result.warningStyle === 'safe' 
                  ? 'bg-emerald-50 border-emerald-250 text-emerald-950' 
                  : molecularSO2Result.warningStyle === 'marginal'
                    ? 'bg-amber-50/70 border-amber-250 text-amber-950'
                    : 'bg-rose-50 border-rose-250 text-rose-950'
              }`}>
                <div className="flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-current" />
                  <h4 className="text-xs font-mono font-bold uppercase tracking-wider">
                    Bio-Protection Diagnostics
                  </h4>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-mono tracking-wider opacity-70 block">
                    Active Molecular SO₂ Level
                  </span>
                  <div className="flex items-baseline gap-1.5">
                    <strong className="text-2xl font-sans font-black">
                      {molecularSO2Result.currentMolecular.toFixed(3)}
                    </strong>
                    <span className="text-xs font-mono font-semibold">mg/L</span>
                  </div>
                  <span className="text-[10px] block font-mono opacity-80 pt-0.5">
                    Target requested: {so2TargetMolMode === 'white' ? '0.80' : (so2TargetMolMode === 'red' ? '0.50' : so2CustomTargetMol.toFixed(2))} mg/L
                  </span>
                </div>

                {/* Micro visual meter */}
                <div className="w-full bg-stone-200/50 h-2 rounded-full overflow-hidden border border-stone-200/30">
                  <div 
                    className={`h-full transition-all duration-300 ${
                      molecularSO2Result.warningStyle === 'safe' 
                        ? 'bg-emerald-600' 
                        : molecularSO2Result.warningStyle === 'marginal'
                          ? 'bg-amber-500'
                          : 'bg-red-600'
                    }`}
                    style={{ width: `${Math.min(100, (molecularSO2Result.currentMolecular / 1.2) * 100)}%` }}
                  />
                </div>

                <p className="text-[11px] leading-relaxed italic border-t border-[#000000]/5 pt-2">
                  {molecularSO2Result.warningMessage}
                </p>
              </div>

              {/* Exact mathematical results and instructions */}
              <div className="bg-[#FCFAF8] p-5 border border-[#e8dfd5] rounded-xl space-y-3 shadow-xs">
                <h4 className="text-xs font-serif font-bold text-[#4e0e15] uppercase tracking-wider flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-[#801323]" />
                  Cellar Adjustment Order
                </h4>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-stone-200/50 pb-1.5 font-mono">
                    <span className="text-slate-500">Thermodynamic pKa:</span>
                    <span className="font-bold text-stone-750">{molecularSO2Result.pKa.toFixed(3)}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-stone-200/50 pb-1.5 font-mono">
                    <span className="text-slate-500">Molecular Fraction:</span>
                    <span className="font-bold text-[#801323]">{(molecularSO2Result.fraction * 100).toFixed(3)}%</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-stone-200/50 pb-1.5 font-mono border-dashed">
                    <span className="text-slate-500">Required Free SO₂:</span>
                    <span className="font-bold text-stone-800">{molecularSO2Result.targetFreeNeeded.toFixed(1)} mg/L</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-stone-200/50 pb-1.5 font-mono">
                    <span className="text-slate-500">Required Free Increase:</span>
                    <span className="font-bold text-stone-800">+{molecularSO2Result.freeSO2ToIncrease.toFixed(1)} mg/L</span>
                  </div>
                  
                  {/* Grams recommendation */}
                  <div className="p-3 bg-white border border-[#f0e6da] rounded-lg mt-2 flex flex-col justify-center items-center text-center">
                    <span className="text-[9px] uppercase font-mono font-bold text-slate-400 block mb-0.5">
                      Dry KMBS Addition Target
                    </span>
                    <strong className="text-lg font-serif font-bold text-[#801323]">
                      {molecularSO2Result.kmbsGramsNeeded.toFixed(1)} Grams
                    </strong>
                    <span className="text-[9px] text-[#801323] mt-1 font-semibold italic bg-rose-50 px-2 py-0.5 rounded">
                      ({(molecularSO2Result.kmbsGramsNeeded / 100).toFixed(2)} g/hL dosage)
                    </span>
                  </div>
                </div>
              </div>

              {/* ADVANCED CORRELATION WORKBENCH */}
              <div className="bg-amber-50/50 p-4 border border-amber-200/60 rounded-xl space-y-3 shadow-xs">
                <h5 className="text-[11px] font-mono font-bold text-amber-900 uppercase tracking-widest flex items-center gap-1">
                  <Sliders className="w-3.5 h-3.5 text-amber-800" />
                  pH & Alcohol Stability Correlator
                </h5>
                <p className="text-[11px] text-stone-605 leading-relaxed">
                  Thermodynamic pKa shifts based on temperature and alcohol density. Standard <strong>pKa is {molecularSO2Result.pKa.toFixed(3)}</strong> at {so2Temp}°C with {so2ABV}% ABV.
                </p>

                <div className="space-y-2 border-t border-amber-200/30 pt-2.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-amber-800 block">
                    Free SO₂ required to hit target molecular ({so2TargetMolMode === 'white' ? '0.80' : (so2TargetMolMode === 'red' ? '0.50' : so2CustomTargetMol.toFixed(2))} mg/L) across pH spectrum:
                  </span>
                  
                  <div className="grid grid-cols-4 gap-1.5 text-center">
                    {[3.2, 3.4, 3.6, 3.8].map((phVal) => {
                      const computedPka = 1.81 + 0.013 * (so2Temp - 20) - 0.007 * so2ABV;
                      const computedFraction = 1 / (1 + Math.pow(10, phVal - computedPka));
                      const computedTarget = so2TargetMolMode === 'white' ? 0.8 : (so2TargetMolMode === 'red' ? 0.5 : so2CustomTargetMol);
                      const requiredFree = computedTarget / computedFraction;
                      const isCurrentPh = Math.abs(so2PH - phVal) < 0.1;
                      
                      return (
                        <div key={phVal} className={`p-2 rounded border transition-all ${
                          isCurrentPh 
                            ? 'bg-amber-100 border-amber-400 font-bold scale-105 shadow-xs' 
                            : 'bg-white/80 border-stone-200'
                        }`}>
                          <span className="text-[10px] block font-mono">pH {phVal}</span>
                          <span className="text-xs block font-bold text-stone-800 mt-1">
                            {requiredFree.toFixed(1)} <span className="text-[9px] font-normal font-mono text-slate-500">mg/L</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-[11px] leading-relaxed text-amber-950 bg-amber-100/40 p-2.5 rounded-lg border border-amber-200/40 mt-1 space-y-1">
                    <span className="font-bold block text-[11px]">💡 Winery Suggestion:</span>
                    {so2PH > 3.6 ? (
                      <div>
                        Your pH of <span className="underline font-bold">{so2PH.toFixed(2)}</span> is high. Free SO₂ loses molecular potency exponentially above pH 3.6. We strongly recommend adding <strong>Tartaric Acid first</strong> to decrease pH. This reduces the wine's sulfur demand, avoids color bleaching, keeps the nose clean, and guarantees biological defense.
                      </div>
                    ) : (
                      <div>
                        Your pH is in the safe zone (<span className="underline font-bold">{so2PH.toFixed(2)}</span>). Maintain cellar sanitation and monitor free SO₂ regularly. With alcohol at <span className="underline font-bold">{so2ABV}%</span> and cellar temps at <span className="underline font-bold">{so2Temp}°C</span>, your molecular stability fraction is <strong>{(molecularSO2Result.fraction * 100).toFixed(2)}%</strong>. Keep barrels sealed.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 2 DETAILED CONTENT: LOGARITHMIC BLEND & PEARSONS SQUARE --- */}
      {activeSubTab === 'blend' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Blend specifications */}
          <div className="lg:col-span-7 bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs space-y-4">
            <h3 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-2">
              <Droplets className="w-4.5 h-4.5 text-[#801323]" />
              Double Lot Assembly & Pearson′s Proportioner
            </h3>

            {/* Lot A */}
            <div className="space-y-2 p-3 bg-[#FCFAF8] border border-[#f0e6da]/70 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-mono font-black uppercase text-[#801323] block">Lot A Wine component</span>
                {lots && lots.length > 0 && (
                  <select
                    value={calculatorLotIdA}
                    onChange={(e) => setCalculatorLotIdA(e.target.value)}
                    className="px-2 py-0.5 text-[10px] border border-stone-200 rounded bg-white text-stone-800 font-bold outline-none cursor-pointer"
                  >
                    <option value="">-- Populate A --</option>
                    {lots.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="col-span-2">
                  <label className="text-[9px] font-mono text-slate-450 uppercase block mb-1">Lot A Vol (L)</label>
                  <input 
                    type="number"
                    value={blendVolA}
                    onChange={(e) => setBlendVolA(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded font-bold"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono text-slate-450 uppercase block mb-1">ABV (%)</label>
                  <input 
                    type="number"
                    step="0.05"
                    value={blendParamA}
                    onChange={(e) => setBlendParamA(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono text-slate-450 uppercase block mb-1">Wine pH</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={blendPHA}
                    onChange={(e) => setBlendPHA(parseFloat(e.target.value) || 3.5)}
                    className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Lot B */}
            <div className="space-y-2 p-3 bg-[#FCFAF8] border border-[#f0e6da]/70 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-mono font-black uppercase text-[#d97706] block">Lot B Wine component</span>
                {lots && lots.length > 0 && (
                  <select
                    value={calculatorLotIdB}
                    onChange={(e) => setCalculatorLotIdB(e.target.value)}
                    className="px-2 py-0.5 text-[10px] border border-stone-200 rounded bg-white text-stone-800 font-bold outline-none cursor-pointer"
                  >
                    <option value="">-- Populate B --</option>
                    {lots.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="col-span-2">
                  <label className="text-[9px] font-mono text-slate-450 uppercase block mb-1">Lot B Vol (L)</label>
                  <input 
                    type="number"
                    value={blendVolB}
                    onChange={(e) => setBlendVolB(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded font-bold"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono text-slate-450 uppercase block mb-1">ABV (%)</label>
                  <input 
                    type="number"
                    step="0.05"
                    value={blendParamB}
                    onChange={(e) => setBlendParamB(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono text-slate-450 uppercase block mb-1">Wine pH</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={blendPHB}
                    onChange={(e) => setBlendPHB(parseFloat(e.target.value) || 3.5)}
                    className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Pearson's Target Panel */}
            <div className="p-3 border border-indigo-100 bg-indigo-50/40 rounded-lg space-y-2.5">
              <span className="text-[10px] font-mono font-black uppercase text-indigo-900 flex items-center gap-1">
                <Compass className="w-3.5 h-3.5" />
                Active Target blend Optimizer (Pearson′s square)
              </span>
              <p className="text-[10.5px] text-indigo-950">
                Determine the exact ratios of Lot A and Lot B dynamically. Input desired target alcohol concentration and target size:
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase block mb-0.5">Target ABV (%)</label>
                  <input 
                    type="number"
                    step="0.05"
                    value={pearsonsTarget}
                    onChange={(e) => setPearsonsTarget(parseFloat(e.target.value) || 12.0)}
                    className="w-full px-2 py-1 bg-white border border-indigo-200 text-xs rounded font-bold text-indigo-900 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase block mb-0.5">Target total Volume (L)</label>
                  <input 
                    type="number"
                    value={pearsonsTotalVol}
                    onChange={(e) => setPearsonsTotalVol(Math.max(1, parseInt(e.target.value) || 100))}
                    className="w-full px-2 py-1 bg-white border border-indigo-200 text-xs rounded font-bold text-indigo-900 outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Blend output */}
          {blendOutput && (
            <div className="lg:col-span-5 space-y-4">
              {/* Core blend outputs */}
              <div className="bg-white p-5 border border-[#e8dfd5] rounded-xl space-y-4 shadow-xs">
                <h4 className="text-xs font-serif font-bold text-[#4e0e15] uppercase tracking-wider border-b border-stone-100 pb-2 flex items-center gap-1.5">
                  <Droplets className="w-4 h-4 text-rose-800" />
                  Calculated Blend matrix
                </h4>

                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between font-mono pb-1 border-b border-slate-100">
                    <span className="text-slate-500">Total volume:</span>
                    <strong className="text-stone-800 text-sm font-black">{blendOutput.totalVolume.toLocaleString()} Liters</strong>
                  </div>
                  
                  <div className="flex justify-between font-mono pb-1 border-b border-slate-100">
                    <span className="text-slate-500">Finished ABV%:</span>
                    <strong className="text-stone-800 font-bold">{blendOutput.finalABV.toFixed(2)} % vol</strong>
                  </div>

                  {/* Logarithmic pH display */}
                  <div className="p-2.5 bg-[#fdfaf7] border border-[#f0e6da] rounded">
                    <div className="flex justify-between font-mono text-xs items-center">
                      <span className="text-slate-500 flex items-center gap-1">
                        Blended pH (Logarithmic):
                        <span className="text-[8px] uppercase px-1.5 bg-rose-50 border border-stone-200 text-stone-605 rounded">Ion Model</span>
                      </span>
                      <strong className="text-[#801323] text-sm font-black">{blendOutput.finalPH.toFixed(2)}</strong>
                    </div>
                    <span className="text-[9px] text-[#801323] font-serif italic block mt-1">
                      Note: pH is logarithmic. Simply averaging values is incorrect; we model true hydrogen ion saturation.
                    </span>
                  </div>
                </div>
              </div>

              {/* Pearson's optimization outputs */}
              <div className="bg-white p-5 border border-[#e8dfd5] rounded-xl space-y-4 shadow-xs">
                <h4 className="text-xs font-serif font-bold text-[#4e0e15] uppercase tracking-wider border-b border-stone-100 pb-2 flex items-center gap-1.5">
                  <Compass className="w-4 h-4 text-indigo-700" />
                  Pearson′s square results
                </h4>

                {blendOutput.isPearsonsFeasible ? (
                  <div className="space-y-3 text-xs">
                    <div className="flex items-center justify-between text-indigo-900 bg-indigo-50 px-2 py-1 rounded font-bold font-mono">
                      <span>Proportions Achievable</span>
                      <span>Target: {pearsonsTarget}%</span>
                    </div>

                    <div className="space-y-2 font-mono text-[11.5px]">
                      <div className="flex justify-between border-b pb-1 border-stone-100">
                        <span>Lot A Contribution:</span>
                        <strong className="text-[#801323] font-black">{blendOutput.pearsonsVolA.toFixed(0)} Liters ({(blendOutput.pearsonsRatioA * 100).toFixed(1)}%)</strong>
                      </div>
                      <div className="flex justify-between border-b pb-1 border-stone-100">
                        <span>Lot B Contribution:</span>
                        <strong className="text-[#d97706] font-black">{blendOutput.pearsonsVolB.toFixed(0)} Liters ({(blendOutput.pearsonsRatioB * 100).toFixed(1)}%)</strong>
                      </div>
                    </div>

                    <p className="text-[9.5px] italic text-slate-400 font-serif leading-relaxed">
                      Pearson&#39;s limits require mixing {(blendOutput.pearsonsRatioA * 100).toFixed(1)}% of Lot A with {(blendOutput.pearsonsRatioB * 100).toFixed(1)}% of Lot B.
                    </p>
                  </div>
                ) : (
                  <div className="p-3 border border-red-200 bg-red-50 text-red-950 rounded text-xs space-y-1">
                    <strong className="font-bold flex items-center gap-1">
                      <TriangleAlert className="w-4 h-4 text-red-650" />
                      Target Out of Ranges
                    </strong>
                    <p className="text-[10px]">
                      The target ABV ({pearsonsTarget}%) can only be created by blending if it lies between current Lot A ({blendParamA}%) and Lot B ({blendParamB}%).
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 3 DETAILED CONTENT: ABV & HYDROMETER CONTROLS --- */}
      {activeSubTab === 'alcohol' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Controls */}
          <div className="lg:col-span-7 bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs space-y-4">
            <h3 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-2">
              <Percent className="w-4.5 h-4.5 text-[#801323]" />
              Non-Linear Alcohol potential & Hydrometer Temp Correction
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Starting Specific Gravity (SG)
                </label>
                <input 
                  type="number"
                  step="0.001"
                  value={startSG}
                  onChange={(e) => setStartSG(parseFloat(e.target.value) || 1.090)}
                  className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Finished SG
                </label>
                <input 
                  type="number"
                  step="0.001"
                  value={currentSG}
                  onChange={(e) => setCurrentSG(parseFloat(e.target.value) || 0.990)}
                  className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Sample Liquid Temp (°C)
                </label>
                <input 
                  type="number"
                  value={sampleTemp}
                  onChange={(e) => setSampleTemp(parseFloat(e.target.value) || 20.0)}
                  className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805"
                />
                <span className="text-[9px] text-slate-400 block mt-1">Calibrated for 20C glass hydrometers.</span>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Yeast Yield Factor
                </label>
                <input 
                  type="text"
                  value={yeastYield}
                  onChange={(e) => setYeastYield(parseFloat(e.target.value) || 0.59)}
                  className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805"
                />
                <span className="text-[9px] text-slate-400 block mt-1">Saccharomyces yield: 0.57-0.62.</span>
              </div>
            </div>
          </div>

          {/* Output metrics */}
          {alcOutput && (
            <div className="lg:col-span-5 bg-[#FCFAF8] p-5 border border-[#e8dfd5] rounded-xl space-y-4 shadow-xs">
              <h4 className="text-xs font-serif font-bold text-[#4e0e15] uppercase tracking-wider border-b border-stone-100 pb-2">
                Oenology Attenuation Statistics
              </h4>

              <div className="space-y-3.5 text-xs font-mono text-slate-705">
                <div className="flex justify-between items-center border-b pb-1.5 border-stone-200/50">
                  <span className="text-slate-500">Brix Equivalents (Start):</span>
                  <strong className="text-stone-800 text-[13px] font-black">{alcOutput.startingBrix.toFixed(2)} °Brix</strong>
                </div>

                <div className="flex justify-between items-center border-b pb-1.5 border-stone-200/50">
                  <span className="text-slate-500">Brix Equivalents (End):</span>
                  <strong className="text-stone-850">{alcOutput.currentBrix.toFixed(2)} °Brix</strong>
                </div>

                <div className="flex justify-between items-center border-b pb-1.5 border-stone-200/50">
                  <span className="text-slate-500">Yeast Attenuation:</span>
                  <strong className="text-emerald-700 font-bold">{alcOutput.attenuation.toFixed(2)} % attenuation</strong>
                </div>

                <div className="bg-white p-3 border border-stone-205 rounded space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-450 uppercase font-mono">Simple ABV Formula:</span>
                    <strong className="text-stone-600 text-xs">{alcOutput.apparentABV.toFixed(2)}% vol</strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-indigo-900 uppercase font-mono font-bold flex items-center gap-0.5">
                      <Zap className="w-3 h-3 text-amber-500" />
                      Yeast Weight-loss Eq:
                    </span>
                    <strong className="text-indigo-950 font-black text-sm">{alcOutput.advancedABV.toFixed(2)}% vol</strong>
                  </div>
                  <span className="text-[9px] block text-slate-400 font-serif whitespace-normal leading-tight italic pt-1 border-t border-slate-100">
                    * The advanced method accounts for mass lost during CO₂ venting and ethanol solution contraction factors.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 4 DETAILED CONTENT: VESSEL GEOMETRY & HEADSPACE --- */}
      {activeSubTab === 'vessel' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Controls */}
          <div className="lg:col-span-7 bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs space-y-4">
            <h3 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-2">
              <RefreshCw className="w-4.5 h-4.5 text-[#801323]" />
              Complex Container Geometry & Ullage Risk Advisor
            </h3>

            <div className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Vessel Geometry Profile
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTankShape('cylinder_cone')}
                    className={`px-2 py-1.5 text-xs font-semibold rounded border transition-all cursor-pointer ${
                      tankShape === 'cylinder_cone' ? 'bg-[#4e0e15] border-[#4e0e15] text-white font-bold' : 'bg-white border-stone-200 text-stone-605'
                    }`}
                  >
                    Cylinder + Cone底
                  </button>
                  <button
                    type="button"
                    onClick={() => setTankShape('cylinder_flat')}
                    className={`px-2 py-1.5 text-xs font-semibold rounded border transition-all cursor-pointer ${
                      tankShape === 'cylinder_flat' ? 'bg-[#4e0e15] border-[#4e0e15] text-white font-bold' : 'bg-white border-stone-200 text-stone-605'
                    }`}
                  >
                    Flat Bottom Cyl
                  </button>
                  <button
                    type="button"
                    onClick={() => setTankShape('oak_barrel')}
                    className={`px-2 py-1.5 text-xs font-semibold rounded border transition-all cursor-pointer ${
                      tankShape === 'oak_barrel' ? 'bg-[#4e0e15] border-[#4e0e15] text-white font-bold' : 'bg-white border-stone-200 text-stone-605'
                    }`}
                  >
                    Barrique (225L)
                  </button>
                </div>
              </div>

              {tankShape !== 'oak_barrel' && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">Radius (m)</label>
                    <input 
                      type="number"
                      step="0.05"
                      value={vesselRadius}
                      onChange={(e) => setVesselRadius(parseFloat(e.target.value) || 0.5)}
                      className="w-full px-2 py-1 text-xs bg-stone-50 border border-slate-200 rounded outline-none text-slate-805"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">Cyl height (m)</label>
                    <input 
                      type="number"
                      step="0.1"
                      value={vesselHeight}
                      onChange={(e) => setVesselHeight(parseFloat(e.target.value) || 1.0)}
                      className="w-full px-2 py-1 text-xs bg-stone-50 border border-slate-200 rounded outline-none text-slate-805"
                    />
                  </div>
                  {tankShape === 'cylinder_cone' && (
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">Cone high (m)</label>
                      <input 
                        type="number"
                        step="0.1"
                        value={coneHeight}
                        onChange={(e) => setConeHeight(parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs bg-stone-50 border border-slate-200 rounded outline-none text-slate-805"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-slate-100 pt-3">
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1.5 flex justify-between">
                  <span>Measured Liquid Depth Level</span>
                  <span className="text-[#801323]">{measuredLiquidHeight} meters</span>
                </label>
                <input 
                  type="range"
                  min="0.05"
                  max={tankShape === 'cylinder_cone' ? (vesselHeight + coneHeight).toFixed(1) : (tankShape === 'cylinder_flat' ? vesselHeight.toFixed(1) : '0.7')}
                  step="0.05"
                  value={measuredLiquidHeight}
                  onChange={(e) => setMeasuredLiquidHeight(parseFloat(e.target.value))}
                  className="w-full accent-[#801323] cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Outputs */}
          {vesselOutput && (
            <div className="lg:col-span-5 flex flex-col gap-4">
              {/* Headspace alarm card */}
              <div className={`p-5 rounded-xl border text-stone-850 space-y-3.5 shadow-xs ${
                vesselOutput.riskStatus === 'minimal' 
                  ? 'bg-emerald-50 border-emerald-250 text-emerald-950' 
                  : vesselOutput.riskStatus === 'warning'
                    ? 'bg-amber-50/70 border-amber-250 text-amber-950'
                    : 'bg-rose-50 border-rose-250 text-rose-950'
              }`}>
                <div className="flex items-center gap-2">
                  <TriangleAlert className="w-5 h-5" />
                  <h4 className="text-xs font-mono font-bold uppercase tracking-wider">
                    Oxygen Spoilage Exposure Risk
                  </h4>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-mono tracking-wider opacity-70 block">
                    Headspace (Ullage Ratio)
                  </span>
                  <div className="flex items-baseline gap-1.5">
                    <strong className="text-2xl font-sans font-black">
                      {vesselOutput.ullagePercentage.toFixed(1)} %
                    </strong>
                    <span className="text-xs font-semibold">Ullage Volume</span>
                  </div>
                </div>

                <p className="text-[11px] leading-relaxed italic border-t border-[#000000]/5 pt-2 font-serif">
                  {vesselOutput.oxidativeAdvice}
                </p>
              </div>

              {/* Exact numbers card */}
              <div className="bg-white p-5 border border-[#e8dfd5] rounded-xl space-y-3.5 shadow-xs">
                <h4 className="text-xs font-serif font-bold text-[#4e0e15] uppercase tracking-wider border-b border-slate-100 pb-2">
                  Vessel capacity results
                </h4>

                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between border-b pb-1.5 border-stone-105">
                    <span className="text-slate-500">Total volume limit:</span>
                    <strong className="text-stone-800">{vesselOutput.totalCapacityL.toLocaleString()} Liters</strong>
                  </div>
                  <div className="flex justify-between border-b pb-1.5 border-stone-105">
                    <span className="text-slate-500">Current liquid volume:</span>
                    <strong className="text-stone-800">{vesselOutput.liquidVolumeL.toLocaleString()} L</strong>
                  </div>
                  <div className="flex justify-between border-b pb-1.5 border-stone-105">
                    <span className="text-slate-500 flex items-center gap-1 text-slate-550 font-bold">
                      Headspace (Ullage Air):
                    </span>
                    <span className="text-red-800 font-bold">{vesselOutput.ullageL.toLocaleString()} Liters</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 5 DETAILED CONTENT: ACID MODELLER --- */}
      {activeSubTab === 'acid' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Controls */}
          <div className="lg:col-span-12 xl:col-span-7 bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs space-y-4">
            <h3 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-2">
              <Sliders className="w-4.5 h-4.5 text-[#801323]" />
              Oenological Buffer Modeller & Chemical Addition Target
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Batch volume (Liters)
                </label>
                <input 
                  type="number"
                  value={wineAcidVol}
                  onChange={(e) => setWineAcidVol(Math.max(1, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Current Titratable Acidity (g/L)
                </label>
                <input 
                  type="number"
                  step="0.1"
                  value={currTA}
                  onChange={(e) => setCurrTA(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                  Target Titratable Acidity (g/L)
                </label>
                <input 
                  type="number"
                  step="0.1"
                  value={targetTA}
                  onChange={(e) => setTargetTA(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs rounded font-medium outline-none text-slate-805"
                />
              </div>

              <div className="col-span-1 sm:col-span-2 lg:col-span-3 border-t border-slate-100 pt-3">
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-2">
                  Add Acidifying or De-Acidifying Chemical Treatment Agent
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-5 gap-2">
                  <button
                    type="button"
                    onClick={() => setAcidAdditiveType('tartaric')}
                    className={`px-2 py-1.5 text-[10.5px] font-semibold rounded border transition-all cursor-pointer ${
                      acidAdditiveType === 'tartaric' ? 'bg-[#4e0e15] border-[#4e0e15] text-white font-bold' : 'bg-white border-stone-200 text-stone-605'
                    }`}
                  >
                    Tartaric (Standard)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAcidAdditiveType('malic')}
                    className={`px-2 py-1.5 text-[10.5px] font-semibold rounded border transition-all cursor-pointer ${
                      acidAdditiveType === 'malic' ? 'bg-[#4e0e15] border-[#4e0e15] text-white font-bold' : 'bg-white border-stone-200 text-stone-605'
                    }`}
                  >
                    Malic Acid
                  </button>
                  <button
                    type="button"
                    onClick={() => setAcidAdditiveType('citric')}
                    className={`px-2 py-1.5 text-[10.5px] font-semibold rounded border transition-all cursor-pointer ${
                      acidAdditiveType === 'citric' ? 'bg-[#4e0e15] border-[#4e0e15] text-white font-bold' : 'bg-white border-stone-200 text-stone-605'
                    }`}
                  >
                    Citric Acid (Post-ferm)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAcidAdditiveType('carbonate_deacid')}
                    className={`px-2 py-1.5 text-[10.5px] font-semibold rounded border transition-all cursor-pointer ${
                      acidAdditiveType === 'carbonate_deacid' ? 'bg-indigo-900 border-indigo-900 text-white font-bold' : 'bg-white border-stone-200 text-indigo-805'
                    }`}
                  >
                    CaCO₃ (De-acid)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAcidAdditiveType('bicarbonate_deacid')}
                    className={`px-2 py-1.5 text-[10.5px] font-semibold rounded border transition-all cursor-pointer ${
                      acidAdditiveType === 'bicarbonate_deacid' ? 'bg-indigo-900 border-indigo-900 text-white font-bold' : 'bg-white border-stone-200 text-indigo-805'
                    }`}
                  >
                    KHCO₃ (De-acid)
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Result */}
          {acidOutput && (
            <div className="lg:col-span-12 xl:col-span-5 bg-white p-5 border border-[#e8dfd5] rounded-xl space-y-4 shadow-xs">
              <h4 className="text-xs font-serif font-bold text-[#4e0e15] uppercase tracking-wider border-b border-stone-100 pb-2 flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-[#801323]" />
                Interactive titration outcomes
              </h4>

              <div className="space-y-3.5 text-xs">
                <div className="flex justify-between items-center font-mono border-b pb-1 border-stone-105">
                  <span className="text-slate-500">Requested Adjustment Direction:</span>
                  <strong className={acidOutput.taExpectedDelta > 0 ? 'text-rose-800' : 'text-[#801323]'}>
                    {acidOutput.taExpectedDelta > 0 ? 'Acidification' : 'De-acidification'} ({acidOutput.taExpectedDelta.toFixed(1)} g/L)
                  </strong>
                </div>

                <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 block mb-0.5">
                    Recommended Chemical Additive Dosage
                  </span>
                  
                  {/* Highlighted grams weight */}
                  <strong className="text-lg font-serif font-black text-[#801323]">
                    {Math.abs(acidOutput.dosageGrams).toLocaleString()} Grams
                  </strong>
                  
                  <span className="text-[9.5px] font-mono text-stone-600 block mt-1.5">
                    Equals approx <strong className="font-extrabold">{Math.abs(acidOutput.dosagPerHL)} g/hL</strong> ({(Math.abs(acidOutput.dosageGrams) / 1000).toFixed(2)} kg net weight)
                  </span>
                </div>

                {/* Chemical contextual advice */}
                <div className="bg-[#FCFAF8] p-3 rounded-lg border border-[#f0e6da] space-y-1">
                  <strong className="text-[10.5px] font-mono font-bold text-stone-800 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Enology Chemical Feedback
                  </strong>
                  <p className="text-[10.5px] text-slate-500 leading-relaxed font-serif pt-1">
                    {acidOutput.acidChemistryComment}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
