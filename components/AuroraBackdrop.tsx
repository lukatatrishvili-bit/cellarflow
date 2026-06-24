import React from 'react';
import { motion } from 'motion/react';
import { prefersReducedMotion } from './motion';

/**
 * Photo-free ambient backdrop: slow-drifting burgundy/gold/emerald light blobs
 * over faint topographic "terrace" contour lines. Pure CSS/SVG — no image
 * weight, offline-safe. Only `transform` animates (blur is static), so it stays
 * cheap; under prefers-reduced-motion the blobs hold still.
 *
 *   variant="subtle"  → behind the whole app
 *   variant="rich"    → login / portal hero
 */
export default function AuroraBackdrop({ variant = 'subtle' }: { variant?: 'subtle' | 'rich' }) {
  const reduce = prefersReducedMotion();
  const rich = variant === 'rich';
  const baseOpacity = rich ? 0.55 : 0.22;

  const blobs = [
    { color: '#801323', size: rich ? 580 : 440, top: '4%', left: '2%', dur: 26, drift: { x: [0, 44, -22, 0], y: [0, -30, 22, 0] } },
    { color: '#c5a059', size: rich ? 620 : 480, top: '38%', left: '68%', dur: 33, drift: { x: [0, -52, 30, 0], y: [0, 26, -26, 0] } },
    { color: '#0d9488', size: rich ? 500 : 380, top: '74%', left: '16%', dur: 30, drift: { x: [0, 36, -30, 0], y: [0, -22, 26, 0] } },
  ];

  const contourLines = Array.from({ length: 7 }, (_, i) => {
    const y = 70 + i * 74;
    return `M-50 ${y} C 220 ${y - 28}, 460 ${y + 28}, 700 ${y} S 1100 ${y - 22}, 1100 ${y}`;
  });

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {blobs.map((b, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: b.size,
            height: b.size,
            top: b.top,
            left: b.left,
            background: `radial-gradient(circle at center, ${b.color} 0%, transparent 68%)`,
            opacity: baseOpacity,
            filter: 'blur(72px)',
            willChange: 'transform',
          }}
          animate={reduce ? undefined : b.drift}
          transition={reduce ? undefined : { duration: b.dur, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}

      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 1000 600"
        preserveAspectRatio="none"
        style={{ opacity: rich ? 0.12 : 0.06 }}
      >
        {contourLines.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={i % 2 ? '#c5a059' : '#801323'} strokeWidth={1} />
        ))}
      </svg>
    </div>
  );
}
