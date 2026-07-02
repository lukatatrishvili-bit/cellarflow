import React from 'react';
import { motion } from 'motion/react';
import { ambientMotionEnabled, prefersReducedMotion } from './motion';

const WINE_COLORS: Record<string, { liquid: string; surface: string }> = {
  red: { liquid: '#5a1020', surface: '#7c1c30' },
  amber: { liquid: '#b06a16', surface: '#d18e2b' },
  white: { liquid: '#c2a448', surface: '#dabf6a' },
  rose: { liquid: '#c05a6e', surface: '#d8808f' },
  sparkling: { liquid: '#cdb06a', surface: '#e6d089' },
  fortified: { liquid: '#65220f', surface: '#86371f' },
  base_wine: { liquid: '#94875a', surface: '#afa273' },
};

interface QvevriCrossSectionProps {
  fillPct: number;
  wineClass?: string;
  temperature: number;
  soilTemperature?: number;
  lastSealedDays?: number;
  lang?: 'en' | 'ka' | string;
}

export default function QvevriCrossSection({
  fillPct,
  wineClass = 'amber',
  temperature,
  soilTemperature,
  lastSealedDays = 0,
  lang = 'en',
}: QvevriCrossSectionProps) {
  const pct = Math.max(0, Math.min(100, isFinite(fillPct) ? fillPct : 0));
  const colors = WINE_COLORS[wineClass] || WINE_COLORS.amber;
  const ripple = ambientMotionEnabled();
  const reduce = prefersReducedMotion();

  const calculatedSoilTemp = soilTemperature ?? (temperature - 2.5);
  const needsReseal = lastSealedDays > 120;

  // Qvevri shape paths (viewBox 0 0 300 400)
  // Neck is at y=80, base at y=360, max width at y=200
  const qvevriOuterPath = `
    M 120 70 
    H 180 
    V 90 
    Q 240 130 250 200 
    Q 260 280 170 360 
    Q 150 375 130 360 
    Q 40 280 50 200 
    Q 60 130 120 90 
    Z
  `;

  // Interior cavity (slightly smaller for clay wall thickness of ~10px)
  const qvevriInnerPath = `
    M 128 92 
    H 172 
    V 96 
    Q 228 134 238 200 
    Q 248 274 165 350 
    Q 150 362 135 350 
    Q 52 274 62 200 
    Q 72 134 128 96 
    Z
  `;

  // Beeswax lining (1-2px inside the inner wall)
  const beeswaxLiningPath = `
    M 129 93 
    H 171 
    V 97 
    Q 227 135 237 200 
    Q 247 273 165 349 
    Q 150 361 135 349 
    Q 53 273 63 200 
    Q 73 135 129 97 
    Z
  `;

  // Wave path for liquid (width 400 to cover horizontal drifting)
  const WAVE = 'M -50 15 q 30 -12 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 v 300 h -300 z';

  // Liquid level calculation
  const topY = 96;
  const bottomY = 350;
  const cavityHeight = bottomY - topY;
  const targetSurfaceY = bottomY - (pct / 100) * cavityHeight;

  return (
    <div className="relative w-full max-w-sm mx-auto bg-stone-50 dark:bg-stone-950/25 border border-[#e8dfd5] dark:border-stone-850 rounded-2xl p-4 overflow-hidden shadow-xs">
      <svg viewBox="0 0 300 400" className="w-full h-auto select-none">
        <defs>
          {/* Soil Gradients */}
          <linearGradient id="topsoil" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#785e49" />
            <stop offset="100%" stopColor="#5c4533" />
          </linearGradient>
          <linearGradient id="gravelSoil" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5c4533" />
            <stop offset="100%" stopColor="#453426" />
          </linearGradient>
          <linearGradient id="claySoil" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#453426" />
            <stop offset="100%" stopColor="#2b1f16" />
          </linearGradient>

          {/* Qvevri Inner Clip */}
          <clipPath id="qvevri-inner-clip">
            <path d={qvevriInnerPath} />
          </clipPath>
        </defs>

        {/* ── GROUND & SOIL LAYERS ─────────────────────────────────────────── */}
        {/* Top Soil Layer (y: 80 -> 160) */}
        <path d="M 0 80 Q 75 75 150 82 T 300 80 V 170 Q 225 175 150 168 T 0 170 Z" fill="url(#topsoil)" opacity={0.95} />
        {/* Gravel/Limestone Layer (y: 170 -> 280) */}
        <path d="M 0 170 Q 75 175 150 168 T 300 170 V 290 Q 225 285 150 292 T 0 290 Z" fill="url(#gravelSoil)" opacity={0.95} />
        {/* Lower Deep Clay Layer (y: 290 -> 400) */}
        <path d="M 0 290 Q 75 285 150 292 T 300 290 V 400 H 0 Z" fill="url(#claySoil)" opacity={0.95} />

        {/* Ground Surface Line */}
        <path d="M 0 80 Q 75 75 150 82 T 300 80" fill="none" stroke="#3b2b1f" strokeWidth={3} />

        {/* Soil Labels */}
        <g opacity={0.45} className="font-mono text-[9px] fill-stone-200">
          <text x="15" y="115">{lang === 'ka' ? 'ნეშომპალა' : 'Humus & Clay'}</text>
          <text x="15" y="210">{lang === 'ka' ? 'კირქვიანი ხრეში' : 'Limestone Gravel'}</text>
          <text x="15" y="325">{lang === 'ka' ? 'ღრმა თიხნარი' : 'Deep Alluvial Clay'}</text>
        </g>

        {/* ── QVEVRI STRUCTURE ─────────────────────────────────────────────── */}
        {/* Outer Clay Body (Terracotta Color) */}
        <path d={qvevriOuterPath} fill="#c67a5c" stroke="#9e5538" strokeWidth={1.5} className="drop-shadow-md" />

        {/* Beeswax Lining (Yellow/Amber layer visible on the edge of inner wall) */}
        <path d={beeswaxLiningPath} fill="none" stroke="#ffd15c" strokeWidth={2.5} opacity={0.85} />

        {/* Inner Cavity (Dark Empty Space) */}
        <path d={qvevriInnerPath} fill="#241410" />

        {/* ── LIQUID FILL WITH WAVES ───────────────────────────────────────── */}
        <g clipPath="url(#qvevri-inner-clip)">
          <motion.g
            initial={false}
            animate={{ y: targetSurfaceY }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 45, damping: 15 }}
          >
            {/* Back Wave (lighter, offset) */}
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

            {/* Front Wave (Main Wine Liquid) */}
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

        {/* ── LID & SEAL ───────────────────────────────────────────────────── */}
        {/* Stone / Wood Lid */}
        <path d="M 116 65 H 184 V 74 H 116 Z" fill="#7a7268" stroke="#524b43" strokeWidth={1.5} />
        {/* Beeswax Seal Ring around lid */}
        <motion.path
          d="M 112 71 C 112 71 130 68 150 68 C 170 68 188 71 188 71 V 75 H 112 Z"
          fill={needsReseal ? '#cf4343' : '#e5ad23'}
          animate={needsReseal ? { opacity: [0.6, 1, 0.6] } : {}}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* ── TEMPERATURE PROBE ────────────────────────────────────────────── */}
        {/* Stainless Steel Cable / Rod */}
        <line x1="150" y1="65" x2="150" y2="210" stroke="#a1a1aa" strokeWidth={2} />
        {/* Cable holder at top */}
        <circle cx="150" cy="65" r="3" fill="#3f3f46" />
        {/* Sensor Tip */}
        <circle cx="150" cy="210" r="4.5" fill="#ef4444" className="animate-pulse" />

        {/* ── LABELS & POINTERS ────────────────────────────────────────────── */}
        {/* Wine Temp Pointer */}
        <path d="M 152 210 H 220" stroke="#ef4444" strokeWidth={1} strokeDasharray="2,2" />
        <circle cx="220" cy="210" r="2" fill="#ef4444" />
        <foreignObject x="225" y="195" width="70" height="40">
          <div className="text-left font-sans text-[#1b1715] dark:text-stone-100">
            <div className="text-[8px] uppercase font-mono text-slate-400 font-bold leading-none">Wine</div>
            <div className="text-[11px] font-bold text-rose-750 dark:text-rose-400 font-serif leading-tight">{temperature}°C</div>
          </div>
        </foreignObject>

        {/* Soil Temp Pointer */}
        <path d="M 230 260 H 190" stroke="#10b981" strokeWidth={1} strokeDasharray="2,2" />
        <circle cx="190" cy="260" r="2" fill="#10b981" />
        <foreignObject x="235" y="245" width="60" height="40">
          <div className="text-left font-sans text-[#1b1715] dark:text-stone-100">
            <div className="text-[8px] uppercase font-mono text-slate-400 font-bold leading-none">Soil</div>
            <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-450 font-serif leading-tight">{calculatedSoilTemp.toFixed(1)}°C</div>
          </div>
        </foreignObject>

        {/* Beeswax Lining Pointer */}
        <path d="M 64 200 H 15" stroke="#ffd15c" strokeWidth={1} strokeDasharray="2,2" />
        <circle cx="15" cy="200" r="2" fill="#ffd15c" />
        <foreignObject x="10" y="150" width="90" height="45">
          <div className="text-right font-sans text-amber-950 dark:text-amber-100">
            <div className="text-[8px] uppercase font-mono text-slate-400 font-bold leading-none">Lining</div>
            <div className="text-[9px] font-medium leading-tight mt-0.5">
              {lang === 'ka' ? 'ფუტკრის სანთელი' : 'Beeswax Seal'}
            </div>
          </div>
        </foreignObject>
      </svg>

      {/* Top Banner Alert for Seal Status */}
      <div className={`mt-3 px-3 py-2 rounded-xl text-[11px] font-medium flex items-center justify-between border ${
        needsReseal 
          ? 'bg-rose-50 border-rose-200 text-rose-950 dark:bg-rose-950/20 dark:border-rose-900/60 dark:text-rose-300' 
          : 'bg-emerald-50 border-emerald-200 text-emerald-950 dark:bg-emerald-950/20 dark:border-emerald-900/60 dark:text-emerald-300'
      }`}>
        <span>
          {lang === 'ka' ? 'ლუქი: ' : 'Lid Seal: '}
          <strong>
            {needsReseal 
              ? (lang === 'ka' ? 'განახლება სავალდებულოა' : 'Reseal Required') 
              : (lang === 'ka' ? 'ჰერმეტული' : 'Airtight')}
          </strong>
        </span>
        <span className="font-mono text-[10px]">
          {lastSealedDays}d
        </span>
      </div>
    </div>
  );
}
