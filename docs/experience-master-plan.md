# VinOS Experience Master Plan — Execution Prompt

> This document is written as a **self-contained prompt**: hand it (or any single
> workstream from it) to an engineer or coding agent and it contains everything
> needed to execute without this repo's conversation history. Last updated
> 2026-07-06 after a deep experience audit.

---

## Prompt

You are improving **VinOS** (repo name `cellarflow`, package `maranios`) — an
offline-first winery & vineyard ERP used on cheap tablets in Georgian wine
cellars, in English and Georgian (ka). Your goal: make the user experience
*feel* flawless — instant, resilient, legible, and delightful — without
regressing offline capability, bundle size, or the existing test suite.

### Stack & constraints (do not fight these)

- React 19 + Vite 8 SPA, state-driven navigation (no URL router), Tailwind 4,
  Framer Motion (`motion/react`), Recharts, RxDB/IndexedDB offline queue.
- Express 5 server (`server.ts` + `server/routes/*`), sync via whole-state
  merge with per-item optimistic concurrency (`server/sync.ts`).
- Deployed on Cloud Run (europe-west1) with Cloud SQL Postgres; PWA with a
  hand-written service worker (`public/sw.js`).
- **Guardrails:** animate only `transform`/`opacity`; respect
  `prefers-reduced-motion` (global `MotionConfig reducedMotion="user"`); no new
  heavy dependencies; no photos; every phase must keep `npm run lint`
  (tsc) and `npm test` green and must not grow the initial bundle.

### How to verify anything in the browser

1. `cp .env .env.claude-backup && printf '\nDEMO_LOGIN_ENABLED="true"\n' >> .env`
2. Start the dev server (preview tool config `vinea` in `.claude/launch.json`;
   `server/loadEnv.ts` loads `.env` in dev).
3. `POST /api/auth/demo` → 200, reload → logged in as `demo` (Winemaker,
   modules vazi+gvino).
4. When done: restore `.env` from the backup. The `demo` user in `db.json` is
   gitignored local state — harmless.

### Already done — do NOT redo

Instant boot splash in `index.html`; deploy-safe lazy chunks
(`src/lazyRetry.ts`, all 28 modules); global `ErrorBoundary`
(`components/ErrorBoundary.tsx`, crash-tested); PWA manifest rebranded VinOS,
free rotation; service worker with sensible caching strategies; motion
primitives (`components/motion/`), AuroraBackdrop, VesselFill liquid
animation, module-nav `layoutId` pill; online/offline toasts; install button
(`components/InstallButton.tsx`); security headers with CSP (report-only);
server-side sync conflict retry + tenant-scoped merge history.

---

## Workstreams (priority order)

### W1 — Accessibility foundation *(impact: high, effort: M)*

`src/App.tsx` (2,400+ lines of shell UI) has ~2 aria attributes. Blind spots:
icon-only buttons (theme toggle, alerts bell, header collapse) lack labels in
KA; modals likely lack focus traps and `Escape` handling; focus-visible rings
were planned (design-plan Phase 4) but need verification everywhere.

Do: audit every interactive element in the shell + the 6 module navs for
(a) accessible name in both languages, (b) keyboard reachability and visible
focus, (c) `Escape`/backdrop-click closing for every modal/drawer, (d) AA
contrast in light AND dark themes (the stone-on-cream palette has known risky
pairs: `text-stone-400` on `#fbf9f6`).

Accept when: keyboard-only demo-login → create a task → log fermentation →
switch language → logout works end to end; axe DevTools reports no serious
violations on Dashboard, Cellar, Vineyard; contrast spot-checks pass AA.

### W2 — Georgian typography & i18n completeness *(impact: high, effort: M)*

The loaded fonts (Cormorant Garamond, Outfit, JetBrains Mono) contain **no
Georgian (Mkhedruli) glyphs** — every KA string falls back to system fonts,
so the premium typography evaporates for the primary audience. 

Do: add `Noto Sans Georgian` (or `Noto Serif Georgian` for display) via
Google Fonts with `unicode-range` subsetting so Latin users pay ~0 bytes;
wire it into the font stacks in `index.html` and Tailwind config; precache it
in `sw.js` SHELL_URLS. Then audit KA coverage: grep for user-facing literals
missing from `lib/i18n.ts` / `lib/i18nShell.ts`; verify number/date
formatting uses `ka-GE` locale where lang=ka.

Accept when: KA UI renders in the chosen Georgian face (screenshot diff),
offline included; no mixed-language screens in the six top-level modules.

### W3 — Service-worker update UX *(impact: medium, effort: S)*

`sw.js` uses `skipWaiting`+`clients.claim`, and `lazyRetry` now heals broken
chunks — but users mid-session never learn a new version exists until they
reload, and a mid-shift tablet may run stale code for days.

Do: in `src/main.tsx` registration, listen for `updatefound` →
`statechange: installed` while `navigator.serviceWorker.controller` exists →
show a persistent toast "New version ready · განახლება მზადაა [Reload]".
Route it through the existing `ToastProvider`. Never auto-reload (cellar
workers may be mid-form).

Accept when: bumping `VERSION` in sw.js on a running preview surfaces the
toast, and clicking it reloads into the new version.

### W4 — Empty states & first-run delight *(impact: medium, effort: M)*

A fresh org sees zeros everywhere (0 L, 0/0 vessels, "No reports"). The setup
journey card is good; the surrounding deadness undermines it.

Do: every module's empty state gets (a) a one-line explanation of what will
appear, (b) a primary CTA that opens the relevant create-flow, (c) a small
inline SVG illustration in the brand's line style (reuse VesselFill /
QvevriCrossSection aesthetics — no images). Wire the dashboard KPI cards to
deep-link into the setup journey step that fills them.

Accept when: demo-login on an EMPTY org (create fresh account, don't seed)
shows zero dead-end screens; every empty state's CTA lands in a working form.

### W5 — Client error telemetry *(impact: medium, effort: S)*

`ErrorBoundary` and `lazyRetry` now catch failures, but nobody learns about
them. Do: `POST /api/telemetry/client-error` (new route, capability-gated
per org, rate-limited, body: message/stack/ua/appVersion) called from
`componentDidCatch` and from lazyRetry's give-up path; surface the last N in
the Master Admin portal (`MasterAdminPortal.tsx` already has a diagnostics
tab). Never block rendering on the POST.

Accept when: forcing a render error in preview produces a row visible in the
admin portal; offline errors queue and flush (reuse `IndexedDBQueue`).

### W6 — Mobile ergonomics *(impact: medium, effort: M–L)*

Cellar phones are the secondary device. Audit at 375×812 (preview_resize):
header density, table-heavy tabs (Inventory, Costs, Sales) need card layouts
under `sm:`; tap targets ≥ 44px; the module nav pill row must not overflow.

Accept when: the six top modules pass a 375px walkthrough with no horizontal
scroll, no overlapping controls, and all primary actions reachable.

### W7 — Performance ceiling *(impact: low-medium, effort: S–M)*

Already decent (code-split, compositor-only motion). Remaining: run Lighthouse
(target ≥90 Performance/PWA/A11y on the deployed URL); verify 60fps at 4×
CPU throttle on Dashboard + TanksVessels (the two animation-dense screens);
consider `content-visibility: auto` on long lists; check `exceljs`/`VaziModule`
chunks never land in the critical path (they don't today — keep it that way).

Accept when: Lighthouse numbers recorded in this doc; no animation jank at
4× throttle in a screen recording.

---

## Sequencing

W3 (smallest, ships alone) → W1 → W2 (pairs with W1's KA audit) → W5 →
W4 → W6 → W7. One workstream per PR; each PR ends with: preview verification
per the recipe above, `npm run lint && npm test` green, `npm run build` clean,
and a note appended to this file under "Progress log".

## Definition of "perfect" (exit criteria)

- Zero white screens under: cold load, deploy mid-session, render crash,
  offline tab-switch. *(done — splash / lazyRetry / ErrorBoundary / SW)*
- Keyboard- and screen-reader-operable core flows in EN and KA (W1).
- Georgian text set in a real Georgian typeface, offline included (W2).
- Users learn about updates without losing work (W3).
- No dead-end empty screens (W4); crashes are observable (W5).
- 375px phone walkthrough clean (W6); Lighthouse ≥90 across the board (W7).

## Progress log

- 2026-07-06 — Audit performed; splash, lazyRetry, ErrorBoundary, manifest
  rebrand, dev .env loader shipped and verified (commits `c1dffa7`, `821e294`).
- 2026-07-06 — **W3 DONE:** hourly `registration.update()` + `controllerchange`
  detection (first-install guarded) in `src/main.tsx`; bilingual bottom banner
  with Reload/dismiss in `src/App.tsx`. Verified end to end on a prod-mode
  boot: bumped dist/sw.js VERSION → update() → banner appeared → Reload landed
  in the new version, banner gone.
  **W2 DONE:** Noto Sans Georgian (unicode-range subsetted) added to
  `globals.css`, `index.html`, and sw.js precache; wired into all four font
  vars. Also fixed a pre-existing SW gap: cross-origin requests were never
  intercepted, so precached font CSS was unreachable offline — Google Fonts
  origins now get stale-while-revalidate. Verified live: KA UI renders in
  Noto Sans Georgian (`document.fonts.check` true, screenshot). SW VERSION
  bumped v4→v5. Remaining KA-coverage audit merged into W1's checklist.
