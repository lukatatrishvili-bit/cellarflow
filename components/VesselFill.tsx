import React from 'react';
import { motion } from 'motion/react';
import { prefersReducedMotion } from './motion';

/**
 * Animated liquid-fill visual for a tank / qvevri. The fill height encodes
 * volume / capacity and the colour encodes wine class; a gentle surface ripple
 * loops while filled. Compositor-only (translateX/translateY) → cheap on tablets,
 * and it snaps static under prefers-reduced-motion.
 */

const WINE_COLORS: Record<string, { liquid: string; surface: string }> = {
  red: { liquid: '#5a1020', surface: '#7c1c30' },
  amber: { liquid: '#b06a16', surface: '#d18e2b' },
  white: { liquid: '#c2a448', surface: '#dabf6a' },
  rose: { liquid: '#c05a6e', surface: '#d8808f' },
  sparkling: { liquid: '#cdb06a', surface: '#e6d089' },
  fortified: { liquid: '#65220f', surface: '#86371f' },
  base_wine: { liquid: '#94875a', surface: '#afa273' },
};

// A wave path 150 wide (covers x −20..130) so a −30 horizontal loop is seamless.
const WAVE = 'M-20 7 q 15 -7 30 0 t 30 0 t 30 0 t 30 0 t 30 0 v 150 h -150 z';

export default function VesselFill({
  fillPct,
  wineClass = 'red',
  width = 56,
  height = 74,
  qvevri = false,
}: {
  fillPct: number;
  wineClass?: string;
  width?: number;
  height?: number;
  qvevri?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, isFinite(fillPct) ? fillPct : 0));
  const colors = WINE_COLORS[wineClass] || WINE_COLORS.red;
  const reduce = prefersReducedMotion();

  // viewBox 0..100 x, 0..132 y. Body spans y 10..126 (height 116).
  const topY = 10;
  const bottomY = 126;
  const bodyH = bottomY - topY;
  const surfaceY = bottomY - (pct / 100) * bodyH;

  // Vessel silhouette: amphora-ish for qvevri, rounded tank otherwise.
  const clipPath = qvevri
    ? 'M30 12 q20 -6 40 0 q6 26 4 54 q-3 40 -24 60 q-21 -20 -24 -60 q-2 -28 4 -54 z'
    : 'M22 14 q28 -8 56 0 q6 4 6 16 v74 q0 18 -34 18 q-34 0 -34 -18 v-74 q0 -12 6 -16 z';

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 132"
      role="img"
      aria-label={`${Math.round(pct)}% full`}
      style={{ display: 'block' }}
    >
      <defs>
        <clipPath id={`vclip-${qvevri ? 'q' : 't'}`}>
          <path d={clipPath} />
        </clipPath>
      </defs>

      {/* Vessel interior backdrop */}
      <path d={clipPath} fill="currentColor" opacity={0.06} />

      <g clipPath={`url(#vclip-${qvevri ? 'q' : 't'})`}>
        <motion.g
          initial={false}
          animate={{ y: surfaceY }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 55, damping: 14 }}
        >
          {/* Back wave (lighter, slower) */}
          {!reduce ? (
            <motion.path
              d={WAVE}
              fill={colors.surface}
              opacity={0.55}
              animate={{ x: [-30, 0] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: 'linear' }}
            />
          ) : (
            <path d={WAVE} fill={colors.surface} opacity={0.55} />
          )}
          {/* Front wave (main liquid) */}
          {!reduce ? (
            <motion.path
              d={WAVE}
              fill={colors.liquid}
              animate={{ x: [0, -30] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'linear' }}
            />
          ) : (
            <path d={WAVE} fill={colors.liquid} />
          )}
        </motion.g>
      </g>

      {/* Vessel outline + subtle rim highlight */}
      <path d={clipPath} fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={2} />
    </svg>
  );
}
