import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'motion/react';

/**
 * Shared motion primitives for the MaraniOS UI pass.
 *
 * All animations are compositor-only (transform/opacity) for 60fps on cellar
 * tablets, and respect prefers-reduced-motion (globally via <MotionConfig
 * reducedMotion="user"> in main.tsx; CountUp checks the media query directly
 * since it tweens outside Framer).
 */

const EASE_OUT_QUINT = [0.22, 1, 0.36, 1] as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** True when the user is on Data Saver — used to pause continuous ambient motion. */
export function prefersReducedData(): boolean {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as any).connection;
  return !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType || ''));
}

/** Whether continuous, decorative ambient motion (aurora, ripple) should run. */
export function ambientMotionEnabled(): boolean {
  return !prefersReducedMotion() && !prefersReducedData();
}

/* ── PageTransition ─────────────────────────────────────────────────────────
   Crossfade + subtle slide between keyed views (modules, tabs). */
export function PageTransition({ motionKey, children, className }: {
  motionKey: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={motionKey}
        className={className}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.24, ease: EASE_OUT_QUINT }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/* ── Stagger ────────────────────────────────────────────────────────────────
   Container that reveals its <StaggerItem> children in sequence. */
const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};
const staggerItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE_OUT_QUINT } },
};

export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={staggerContainer} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return <motion.div className={className} variants={staggerItem}>{children}</motion.div>;
}

/* ── Reveal ─────────────────────────────────────────────────────────────────
   Fades/slides content in when it scrolls into view (once). */
export function Reveal({ children, className, delay = 0, y = 18 }: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, ease: EASE_OUT_QUINT, delay }}
    >
      {children}
    </motion.div>
  );
}

/* ── CountUp ────────────────────────────────────────────────────────────────
   Animated number tween (rAF, easeOutQuart). Animates 0→value on mount and
   prev→value on change; snaps instantly under reduced-motion. */
export function CountUp({ value, decimals = 0, duration = 1100, prefix = '', suffix = '', format, className }: {
  value: number;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  /** Custom number formatter (e.g. thousands grouping). Overrides decimals. */
  format?: (n: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (prefersReducedMotion() || from === to) {
      setDisplay(to);
      fromRef.current = to;
      return;
    }
    let raf = 0;
    const start = performance.now();
    const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + (to - from) * easeOutQuart(t));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const text = format ? format(display) : Number(display).toFixed(decimals);
  return <span className={className}>{prefix}{text}{suffix}</span>;
}

/* ── Skeleton ───────────────────────────────────────────────────────────────
   Calm loading placeholder (opacity pulse — compositor-only). */
export function Skeleton({ className = '', rounded = 'rounded-lg' }: { className?: string; rounded?: string }) {
  return (
    <motion.div
      className={`bg-stone-200/70 dark:bg-stone-800/70 ${rounded} ${className}`}
      animate={{ opacity: [0.5, 1, 0.5] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}
