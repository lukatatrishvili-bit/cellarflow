# MaraniOS — Modern/Smooth UI Implementation Plan

Goal: a modern, smooth, "wow" interface — **without photos** — that stays fast and
fully PWA/offline-capable. The wow comes from motion, depth, generative ambient
visuals, and domain-specific delight, all of which are tiny (no image weight, no
heavy libraries).

## Principles (guardrails)
- Animate only `transform` and `opacity` (compositor-only) → 60 fps on cellar tablets.
- Framer Motion (already installed) + CSS/SVG only. No GSAP/Lottie/image assets.
- Global `prefers-reduced-motion` + data-saver/battery guard downgrades ambient motion.
- Two zones: atmospheric (login, portal, headers, reports) is rich; work zones
  (tables, forms, charts) stay calm and high-contrast.
- Incremental, non-breaking: one phase per PR.

## Phases
- **Phase 0 — Foundation:** fonts 5→3 (Cormorant, Outfit, JetBrains Mono); motion
  tokens (eases/durations), elevation scale, semantic color tokens; `MotionConfig
  reducedMotion="user"` at app root.
- **Phase 1 — Motion primitives:** `components/motion/` — PageTransition, Stagger,
  CountUp, Reveal, Skeleton; shared-element nav pill via `layoutId`.
- **Phase 2 — Generative ambient backdrop:** AuroraBackdrop (drifting gradients +
  SVG contour terraces + grain); login dust particles + glass card; module header bands.
- **Phase 3 — Domain wow:** VesselFill (animated liquid), QvevriCrossSection,
  recharts draw-in / fermentation curve, KPI count-ups.
- **Phase 4 — Micro-interactions & states:** button press, hover lift, spring toasts,
  focus-visible rings, skeleton loaders, polished empty states.
- **Phase 5 — PWA & performance:** data-saver/battery guard, compositor-only audit
  (60fps @4× CPU), precache fonts/assets, install affordance + offline banner,
  Lighthouse, no bundle regression.
- **Phase 6 — Accessibility & cross-device:** AA contrast both themes, keyboard nav,
  reduced-motion verified, tablet/phone/desktop.

## Sequence
0 → 1 → vessel cards (Phase 3) as first visible wow → 2 → rest of 3 → 4 → 5 → 6.

## Non-goals
No photos, no heavy animation libraries, no breaking existing features.
