import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Thermometer, RefreshCw } from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { Vessel, WineLot, DailyFermLog } from '../lib/wineryState';
import { stageLabel } from '../lib/enumLabels';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import QvevriCrossSection from './QvevriCrossSection';
import { ambientMotionEnabled, prefersReducedMotion } from './motion';
import { useFocusTrap } from './useFocusTrap';

const WINE_COLORS: Record<string, { liquid: string; surface: string }> = {
  red: { liquid: '#5a1020', surface: '#7c1c30' },
  amber: { liquid: '#b06a16', surface: '#d18e2b' },
  white: { liquid: '#c2a448', surface: '#dabf6a' },
  rose: { liquid: '#c05a6e', surface: '#d8808f' },
  sparkling: { liquid: '#cdb06a', surface: '#e6d089' },
  fortified: { liquid: '#65220f', surface: '#86371f' },
  base_wine: { liquid: '#94875a', surface: '#afa273' },
};

function SteelTankCrossSection({
  fillPct,
  wineClass = 'red',
  temperature,
  targetTemperature,
  coolingJacketActive = false,
  lang = 'en',
}: {
  fillPct: number;
  wineClass?: string;
  temperature: number;
  targetTemperature?: number | null;
  coolingJacketActive?: boolean;
  lang?: string;
}) {
  const pct = Math.max(0, Math.min(100, isFinite(fillPct) ? fillPct : 0));
  const colors = WINE_COLORS[wineClass] || WINE_COLORS.red;
  const ripple = ambientMotionEnabled();
  const reduce = prefersReducedMotion();

  const WAVE = 'M -50 15 q 30 -12 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 v 350 h -300 z';

  const topY = 100;
  const bottomY = 320;
  const cavityHeight = bottomY - topY;
  const targetSurfaceY = bottomY - (pct / 100) * cavityHeight;

  return (
    <div className="relative w-full max-w-sm mx-auto bg-stone-50 dark:bg-stone-950/25 border border-[#e8dfd5] dark:border-stone-850 rounded-2xl p-4 overflow-hidden shadow-xs">
      <svg viewBox="0 0 300 400" className="w-full h-auto select-none">
        <defs>
          <clipPath id="steel-tank-inner-clip">
            <path d="M 96 100 C 96 76, 204 76, 204 100 V 320 C 204 344, 96 344, 96 320 Z" />
          </clipPath>
          <linearGradient id="steel-sheen" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#d4d4d8" />
            <stop offset="30%" stopColor="#f4f4f5" />
            <stop offset="70%" stopColor="#a1a1aa" />
            <stop offset="100%" stopColor="#71717a" />
          </linearGradient>
        </defs>

        <g stroke="#e2e8f0" strokeWidth={0.5} opacity={0.3} className="dark:stroke-stone-800">
          <line x1="50" y1="0" x2="50" y2="400" />
          <line x1="250" y1="0" x2="250" y2="400" />
          <line x1="0" y1="100" x2="300" y2="100" />
          <line x1="0" y1="200" x2="300" y2="200" />
          <line x1="0" y1="300" x2="300" y2="300" />
        </g>

        <path d="M 90 320 V 375 L 85 380 H 98 L 100 320 Z" fill="#71717a" stroke="#52525b" strokeWidth={1} />
        <path d="M 210 320 V 375 L 215 380 H 202 L 200 320 Z" fill="#71717a" stroke="#52525b" strokeWidth={1} />

        <path d="M 90 100 C 90 70, 210 70, 210 100 V 320 C 210 350, 90 350, 90 320 Z" fill="url(#steel-sheen)" stroke="#52525b" strokeWidth={2} />

        <path d="M 96 100 C 96 76, 204 76, 204 100 V 320 C 204 344, 96 344, 96 320 Z" fill="#18181b" />

        <g clipPath="url(#steel-tank-inner-clip)">
          <motion.g
            initial={false}
            animate={{ y: targetSurfaceY }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 45, damping: 15 }}
          >
            {ripple ? (
              <motion.path
                d={WAVE}
                fill={colors.surface}
                opacity={0.45}
                animate={{ x: [-35, 5] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
              />
            ) : (
              <path d={WAVE} fill={colors.surface} opacity={0.45} />
            )}

            {ripple ? (
              <motion.path
                d={WAVE}
                fill={colors.liquid}
                animate={{ x: [0, -40] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
              />
            ) : (
              <path d={WAVE} fill={colors.liquid} />
            )}
          </motion.g>
        </g>

        <g opacity={coolingJacketActive ? 0.95 : 0.35}>
          <rect x={86} y={140} width={128} height={140} rx={4} fill={coolingJacketActive ? 'rgba(14, 165, 233, 0.08)' : 'none'} stroke={coolingJacketActive ? '#38bdf8' : '#71717a'} strokeWidth={1} />
          {[150, 170, 190, 210, 230, 250, 270].map((y, idx) => (
            <motion.path
              key={y}
              d={`M 86 ${y} Q 150 ${y + 3}, 214 ${y}`}
              fill="none"
              stroke={coolingJacketActive ? '#0ea5e9' : '#52525b'}
              strokeWidth={3}
              strokeLinecap="round"
              animate={coolingJacketActive ? {
                strokeDasharray: ['4 4', '8 4', '4 4'],
                opacity: [0.65, 1, 0.65]
              } : {}}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', delay: idx * 0.15 }}
            />
          ))}
        </g>

        <line x1="150" y1="80" x2="150" y2="200" stroke="#d4d4d8" strokeWidth={2.5} />
        <circle cx="150" cy="80" r="4" fill="#3f3f46" />
        <circle cx="150" cy="200" r="4" fill="#ef4444" className="animate-pulse" />

        <path d="M 152 200 H 220" stroke="#ef4444" strokeWidth={1} strokeDasharray="2,2" />
        <circle cx="220" cy="200" r="2" fill="#ef4444" />
        <foreignObject x="225" y="185" width="70" height="40">
          <div className="text-left font-sans text-stone-900 dark:text-stone-150">
            <div className="text-[8px] uppercase font-mono text-slate-400 font-bold leading-none">Wine Temp</div>
            <div className="text-[11px] font-bold text-rose-750 dark:text-rose-400 font-serif leading-tight">{temperature}°C</div>
          </div>
        </foreignObject>

        {targetTemperature && (
          <>
            <path d="M 150 80 H 45" stroke="#38bdf8" strokeWidth={1} strokeDasharray="2,2" />
            <circle cx="45" cy="80" r="2" fill="#0ea5e9" />
            <foreignObject x="5" y="65" width="80" height="40">
              <div className="text-right font-sans text-stone-900 dark:text-stone-150">
                <div className="text-[8px] uppercase font-mono text-sky-400 font-bold leading-none">Target</div>
                <div className="text-[11px] font-bold text-sky-700 dark:text-sky-400 font-serif leading-tight">{targetTemperature}°C</div>
              </div>
            </foreignObject>
          </>
        )}

        <path d="M 214 210 H 230" stroke={coolingJacketActive ? '#0ea5e9' : '#71717a'} strokeWidth={1} strokeDasharray="2,2" />
        <circle cx="230" cy="210" r="2" fill={coolingJacketActive ? '#0ea5e9' : '#71717a'} />
        <foreignObject x="235" y="195" width="60" height="40">
          <div className="text-left font-sans">
            <div className="text-[8px] uppercase font-mono text-slate-400 font-bold leading-none">{lang === 'ka' ? 'პერანგი' : 'Jacket'}</div>
            <div className={`text-[10px] font-bold leading-tight ${coolingJacketActive ? 'text-sky-600 dark:text-sky-400' : 'text-stone-500'}`}>
              {coolingJacketActive ? (lang === 'ka' ? 'ჩართული' : 'Active') : (lang === 'ka' ? 'გამორთული' : 'Standby')}
            </div>
          </div>
        </foreignObject>
      </svg>

      <div className={`mt-3 px-3 py-2 rounded-xl text-[11px] font-medium flex items-center justify-between border ${
        coolingJacketActive
          ? 'bg-sky-50 border-sky-200 text-sky-950 dark:bg-sky-950/20 dark:border-sky-900/60 dark:text-sky-300'
          : 'bg-stone-50 border-stone-200 text-stone-600 dark:bg-stone-950/20 dark:border-stone-900/60 dark:text-stone-450'
      }`}>
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${coolingJacketActive ? 'bg-sky-400 animate-ping' : 'bg-stone-405'}`} />
          {lang === 'ka' ? 'თერმორეგულაცია: ' : 'Thermoregulation: '}
          <strong>
            {coolingJacketActive
              ? (lang === 'ka' ? 'აქტიური გაგრილება' : 'Active Cooling')
              : (lang === 'ka' ? 'სტაბილური' : 'Stable')}
          </strong>
        </span>
        {targetTemperature && (
          <span className="font-mono text-[10px]">
            Target: {targetTemperature}°C
          </span>
        )}
      </div>
    </div>
  );
}

function OakBarrelCrossSection({
  fillPct,
  wineClass = 'red',
  temperature,
  lang = 'en',
}: {
  fillPct: number;
  wineClass?: string;
  temperature: number;
  lang?: string;
}) {
  const pct = Math.max(0, Math.min(100, isFinite(fillPct) ? fillPct : 0));
  const colors = WINE_COLORS[wineClass] || WINE_COLORS.red;
  const ripple = ambientMotionEnabled();
  const reduce = prefersReducedMotion();

  const WAVE = 'M -50 15 q 30 -12 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 v 350 h -300 z';

  const topY = 106;
  const bottomY = 294;
  const cavityHeight = bottomY - topY;
  const targetSurfaceY = bottomY - (pct / 100) * cavityHeight;

  return (
    <div className="relative w-full max-w-sm mx-auto bg-stone-50 dark:bg-stone-950/25 border border-[#e8dfd5] dark:border-stone-850 rounded-2xl p-4 overflow-hidden shadow-xs">
      <svg viewBox="0 0 300 400" className="w-full h-auto select-none">
        <defs>
          <clipPath id="barrel-inner-clip">
            <path d="M 106 106 Q 150 102, 194 106 Q 230 200, 194 294 Q 150 298, 106 294 Q 70 200, 106 106 Z" />
          </clipPath>
          <linearGradient id="wood-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#b08968" />
            <stop offset="50%" stopColor="#7f5539" />
            <stop offset="100%" stopColor="#9c6644" />
          </linearGradient>
          <linearGradient id="hoop-sheen" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#334155" />
            <stop offset="50%" stopColor="#64748b" />
            <stop offset="100%" stopColor="#1e293b" />
          </linearGradient>
        </defs>

        <g stroke="#e2e8f0" strokeWidth={0.5} opacity={0.3} className="dark:stroke-stone-800">
          <line x1="50" y1="0" x2="50" y2="400" />
          <line x1="250" y1="0" x2="250" y2="400" />
          <line x1="0" y1="100" x2="300" y2="100" />
          <line x1="0" y1="200" x2="300" y2="200" />
          <line x1="0" y1="300" x2="300" y2="300" />
        </g>

        <path d="M 80 290 L 60 350 H 90 L 95 300 Z" fill="#4a3b32" stroke="#2d221b" strokeWidth={1} />
        <path d="M 220 290 L 240 350 H 210 L 205 300 Z" fill="#4a3b32" stroke="#2d221b" strokeWidth={1} />
        <rect x={85} y={325} width={130} height={12} rx={2} fill="#3b2f27" stroke="#2d221b" />

        <path d="M 100 100 Q 150 95, 200 100 Q 240 200, 200 300 Q 150 305, 100 300 Q 60 200, 100 100 Z" fill="url(#wood-gradient)" stroke="#4a3525" strokeWidth={2.5} />

        <path d="M 115 100 Q 130 200, 115 300" fill="none" stroke="#5c3d2e" strokeWidth={1.5} opacity={0.5} />
        <path d="M 132 99 Q 142 200, 132 301" fill="none" stroke="#5c3d2e" strokeWidth={1.5} opacity={0.5} />
        <path d="M 150 98 V 302" fill="none" stroke="#5c3d2e" strokeWidth={1.8} opacity={0.65} />
        <path d="M 168 99 Q 158 200, 168 301" fill="none" stroke="#5c3d2e" strokeWidth={1.5} opacity={0.5} />
        <path d="M 185 100 Q 170 200, 185 300" fill="none" stroke="#5c3d2e" strokeWidth={1.5} opacity={0.5} />

        <path d="M 92 130 Q 150 138, 208 130" fill="none" stroke="url(#hoop-sheen)" strokeWidth={5} strokeLinecap="round" />
        <path d="M 76 185 Q 150 193, 224 185" fill="none" stroke="url(#hoop-sheen)" strokeWidth={5.5} strokeLinecap="round" />
        <path d="M 76 215 Q 150 223, 224 215" fill="none" stroke="url(#hoop-sheen)" strokeWidth={5.5} strokeLinecap="round" />
        <path d="M 92 270 Q 150 278, 208 270" fill="none" stroke="url(#hoop-sheen)" strokeWidth={5} strokeLinecap="round" />

        <ellipse cx="150" cy="98" rx="7" ry="3.5" fill="#4a2c11" stroke="#3b1e05" strokeWidth={1} />
        <path d="M 146 95 L 148 88 H 152 L 154 95 Z" fill="#d4a373" stroke="#a98467" />

        <path d="M 106 106 Q 150 102, 194 106 Q 230 200, 194 294 Q 150 298, 106 294 Q 70 200, 106 106 Z" fill="#1b110b" />

        <g clipPath="url(#barrel-inner-clip)">
          <motion.g
            initial={false}
            animate={{ y: targetSurfaceY }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 45, damping: 15 }}
          >
            {ripple ? (
              <motion.path
                d={WAVE}
                fill={colors.surface}
                opacity={0.45}
                animate={{ x: [-35, 5] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
              />
            ) : (
              <path d={WAVE} fill={colors.surface} opacity={0.45} />
            )}

            {ripple ? (
              <motion.path
                d={WAVE}
                fill={colors.liquid}
                animate={{ x: [0, -40] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
              />
            ) : (
              <path d={WAVE} fill={colors.liquid} />
            )}
          </motion.g>
        </g>

        <line x1="150" y1="98" x2="150" y2="190" stroke="#d4d4d8" strokeWidth={1.5} />
        <circle cx="150" cy="190" r="3.5" fill="#ef4444" className="animate-pulse" />

        <path d="M 152 190 H 220" stroke="#ef4444" strokeWidth={1} strokeDasharray="2,2" />
        <circle cx="220" cy="190" r="2" fill="#ef4444" />
        <foreignObject x="225" y="175" width="70" height="40">
          <div className="text-left font-sans text-stone-900 dark:text-stone-150">
            <div className="text-[8px] uppercase font-mono text-slate-400 font-bold leading-none">Wine</div>
            <div className="text-[11px] font-bold text-rose-750 dark:text-rose-400 font-serif leading-tight">{temperature}°C</div>
          </div>
        </foreignObject>

        <foreignObject x="10" y="240" width="80" height="45">
          <div className="text-right font-sans text-amber-950 dark:text-amber-100">
            <div className="text-[8px] uppercase font-mono text-slate-400 font-bold leading-none">Maturation</div>
            <div className="text-[9px] font-medium leading-tight mt-0.5">
              {lang === 'ka' ? 'მუხის კასრი' : 'Oak Aging'}
            </div>
          </div>
        </foreignObject>
      </svg>
    </div>
  );
}


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
  /** Jump to the quick-operation form with this vessel (and its batch) preselected. */
  onLogOperation?: (vesselId: string) => void;
  canUpdateVessel?: boolean;
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
  onUpdateVessels,
  onLogOperation,
  canUpdateVessel = true
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
  const drawerRef = useRef<HTMLDivElement | null>(null);

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
  }, [canUpdateVessel, selectedTankId, selectedVessel]);

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

  const handleAdjustTargetTemp = (increment: number) => {
    if (!canUpdateVessel || !selectedVessel) return;
    onAdjustTargetTemp(selectedVessel.id, increment);
  };

  const handleToggleSanitation = () => {
    if (!canUpdateVessel || !selectedVessel) return;
    onToggleSanitation(selectedVessel.id);
  };

  const handleEditSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canUpdateVessel || !selectedVessel || !onUpdateVessels) return;

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
  };

  useFocusTrap(drawerRef, { active: !!selectedTankId && !!selectedVessel, onClose });

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
            ref={drawerRef}
            key="vessel-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vessel-drawer-title"
            tabIndex={-1}
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
                    {canUpdateVessel && (
                      <button
                        onClick={() => {
                          if (!canUpdateVessel) return;
                          setIsEditing(!isEditing);
                        }}
                        className="text-stone-500 hover:text-[#4e0e15] text-[10px] font-mono font-bold transition-colors cursor-pointer select-none border border-stone-250 px-1.5 rounded"
                        title={lang === 'ka' ? 'პარამეტრების შეცვლა' : 'Edit Properties'}
                      >
                        ✏️ {lang === 'ka' ? 'შეცვლა' : 'Edit'}
                      </button>
                    )}
                  </div>
                  <h2 id="vessel-drawer-title" className="text-xl font-serif font-bold text-[#4e0e15] mt-1">{selectedVessel.id}</h2>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{selectedVessel.locationDetails || 'Cellar Room A, main row'}</p>
                  {onLogOperation && (
                    <button
                      onClick={() => onLogOperation(selectedVessel.id)}
                      className="mt-2.5 inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#4e0e15] hover:bg-[#34070a] text-amber-50 rounded-xl text-[11px] font-bold uppercase tracking-wide cursor-pointer transition-colors"
                    >
                      ⚡ {lang === 'ka' ? 'ოპერაციის ჩაწერა' : 'Log operation'}
                    </button>
                  )}
                </div>
                <button
                  onClick={onClose}
                  aria-label={lang === 'ka' ? 'დახურვა' : 'Close vessel details'}
                  className="p-1.5 rounded-full hover:bg-stone-200/50 text-stone-505 hover:text-stone-800 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {!canUpdateVessel && (
                <div role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-[11px] font-semibold leading-relaxed text-sky-900">
                  <strong>{lang === 'ka' ? 'ჭურჭლის დეტალები მხოლოდ სანახავია.' : 'Read-only vessel details.'}</strong>{' '}
                  {lang === 'ka'
                    ? 'შეგიძლიათ ნახოთ ტელემეტრია, ტემპერატურის ისტორია, სანიტარული მდგომარეობა, AI რჩევები და ბოლო ოპერაციები, მაგრამ ჭურჭელს ვერ შეცვლით.'
                    : 'You can review telemetry, thermal history, sanitation status, AI guidance, and recent operations, but cannot change this vessel.'}
                </div>
              )}

              {canUpdateVessel && isEditing ? (
                <form onSubmit={handleEditSubmit} className="space-y-4 bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs text-stone-700">
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
                          <option value="stainless_steel">{lang === 'ka' ? 'უჟანგავი ფოლადი' : 'Stainless Steel'}</option>
                          <option value="qvevri">{lang === 'ka' ? 'თიხის ქვევრი' : 'Clay Qvevri'}</option>
                          <option value="barrel">{lang === 'ka' ? 'მუხის კასრი' : 'Oak Barrel'}</option>
                          <option value="plastic">{lang === 'ka' ? 'პლასტმასის ავზი' : 'Plastic Tank'}</option>
                          <option value="concrete">{lang === 'ka' ? 'ბეტონის კვერცხი' : 'Concrete Egg'}</option>
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
                            {stageLabel(selectedLot.stage, lang)}
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

                  {/* Visual Cross-Section & Environmental Metrics */}
                  <div className="space-y-4">
                    <div className="px-1">
                      <h3 className="text-xs font-mono uppercase font-bold text-slate-400 tracking-wider mb-2">
                        {lang === 'ka' ? 'კვეთის ხედი და პარამეტრები' : 'Cross-Section & Environmental Metrics'}
                      </h3>
                      {(() => {
                        const progress = selectedVessel.capacity > 0 ? (selectedVessel.currentVolume / selectedVessel.capacity) * 100 : 0;
                        if (selectedVessel.type === 'qvevri') {
                          const lastSealed = selectedVessel.lastSealedDate ? new Date(selectedVessel.lastSealedDate) : new Date(Date.now() - 45 * 86400000);
                          const diffDays = Math.round((Date.now() - lastSealed.getTime()) / (1000 * 60 * 60 * 24));
                          return (
                            <QvevriCrossSection
                              fillPct={progress}
                              wineClass={selectedLot?.wineClass || 'amber'}
                              temperature={selectedVessel.temperature || 15}
                              soilTemperature={selectedVessel.soilTemperature}
                              lastSealedDays={diffDays}
                              lang={lang}
                            />
                          );
                        } else if (selectedVessel.type === 'barrel') {
                          return (
                            <OakBarrelCrossSection
                              fillPct={progress}
                              wineClass={selectedLot?.wineClass || 'red'}
                              temperature={selectedVessel.temperature || 15}
                              lang={lang}
                            />
                          );
                        } else {
                          return (
                            <SteelTankCrossSection
                              fillPct={progress}
                              wineClass={selectedLot?.wineClass || 'red'}
                              temperature={selectedVessel.temperature || 15}
                              targetTemperature={selectedVessel.targetTemperature}
                              coolingJacketActive={selectedVessel.coolingJacketActive}
                              lang={lang}
                            />
                          );
                        }
                      })()}
                    </div>
                  </div>

                  {selectedVessel.type !== 'qvevri' && (
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
                            {canUpdateVessel && (
                              <div className="flex items-center gap-1 bg-white border border-slate-200 rounded shrink-0 shadow-2xs">
                                <button
                                  onClick={() => handleAdjustTargetTemp(-0.5)}
                                  aria-label={lang === 'ka' ? 'სამიზნე ტემპერატურის შემცირება' : 'Decrease target temperature'}
                                  className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 font-bold border-r border-slate-200 cursor-pointer"
                                >
                                  -
                                </button>
                                <button
                                  onClick={() => handleAdjustTargetTemp(0.5)}
                                  aria-label={lang === 'ka' ? 'სამიზნე ტემპერატურის გაზრდა' : 'Increase target temperature'}
                                  className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 font-bold cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            )}
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
                      {canUpdateVessel && (
                        <button
                          onClick={handleToggleSanitation}
                          className="px-2 py-1 text-[10px] font-mono font-semibold text-indigo-850 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/50 rounded transition-all cursor-pointer"
                        >
                          {selectedVessel.cleaningStatus === 'clean'
                            ? (lang === 'ka' ? 'CIP რეცხვა საჭიროა' : 'Flag: CIP Required')
                            : (lang === 'ka' ? '✓ დღეს სანიტარიზებულია' : '✓ Mark Sanitized Today')}
                        </button>
                      )}
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
                        <span>{lang === 'ka' ? 'ბოლო ჩაწერილი ოპერაცია' : 'Last Operation recorded'}</span>
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
