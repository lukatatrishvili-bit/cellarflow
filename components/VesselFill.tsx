import React from 'react';
import { motion } from 'motion/react';
import { prefersReducedMotion, ambientMotionEnabled } from './motion';

/**
 * Animated liquid-fill visual for a tank / qvevri. The fill height encodes
 * volume / capacity and the colour encodes wine class; a gentle surface ripple
 * loops while filled. Compositor-only (translateX/translateY) → cheap on tablets,
 * and it snaps static under prefers-reduced-motion.
 */

const WINE_COLORS: Record<string, { liquid: string; surface: string }> = {
  red: { liquid: '#5a1020', surface: '#7c1c30' },
  amber: { liquid: '#b06a16', surface: '#d18e2b' },
  qvevri: { liquid: '#9a5b23', surface: '#c17a35' },
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
  const generatedId = React.useId().replace(/:/g, '');
  const clipId = `vessel-fill-${qvevri ? 'qvevri' : 'tank'}-${generatedId}`;
  const pct = Math.max(0, Math.min(100, isFinite(fillPct) ? fillPct : 0));
  const colors = WINE_COLORS[wineClass] || WINE_COLORS.red;
  const reduce = prefersReducedMotion();  // gates the fill-level spring
  const ripple = ambientMotionEnabled();  // gates the continuous wave loop (off on Data Saver)

  // viewBox 0..100 x, 0..132 y. Body spans y 10..126 (height 116).
  const topY = qvevri ? 8 : 10;
  const bottomY = qvevri ? 128 : 126;
  const bodyH = bottomY - topY;
  const surfaceY = bottomY - (pct / 100) * bodyH;

  // Traditional Georgian qvevri: narrow lip and neck, full shoulder and belly,
  // then a handle-free pointed base intended for burial in the marani floor.
  const clipPath = qvevri
    ? 'M42 8 Q50 5 58 8 L58 14 C70 20 77 35 79 53 C82 81 70 108 50 128 C30 108 18 81 21 53 C23 35 30 20 42 14 Z'
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
        <clipPath id={clipId}>
          <path d={clipPath} />
        </clipPath>
      </defs>

      {/* Vessel interior backdrop */}
      <path d={clipPath} fill={qvevri ? '#b96f3e' : 'currentColor'} opacity={qvevri ? 0.16 : 0.06} />

      <g clipPath={`url(#${clipId})`}>
        <motion.g
          initial={false}
          animate={{ y: surfaceY }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 55, damping: 14 }}
        >
          {/* Back wave (lighter, slower) */}
          {ripple ? (
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
          {ripple ? (
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
      {qvevri && (
        <>
          <ellipse cx="50" cy="8.5" rx="8" ry="2.8" fill="#c88755" fillOpacity="0.42" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
          <ellipse cx="50" cy="9" rx="5.2" ry="1.5" fill="currentColor" fillOpacity="0.12" />
          <path d="M42 14 Q50 18 58 14" fill="none" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1.4" />
          <path d="M25 46 Q50 55 75 46" fill="none" stroke="#9b5a34" strokeOpacity="0.2" strokeWidth="1.2" />
          <path d="M23 62 Q50 72 77 62" fill="none" stroke="#9b5a34" strokeOpacity="0.16" strokeWidth="1.2" />
        </>
      )}
    </svg>
  );
}
