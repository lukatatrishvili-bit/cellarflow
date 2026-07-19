# VinOS Whole-App UI/UX Improvement Plan

**Status:** UX-002 and Milestone 0 complete — Milestone 1 foundations next
**Audit date:** 2026-07-10  
**Scope:** Authentication, onboarding, shell/navigation, Vineyard, Cellar, Business, Documents/Compliance, Settings/Admin, accessibility, localization, responsive behavior, design system, feedback, and perceived performance.

This is the current UI/UX source of truth. It supersedes the UX portions of `design-plan.md` and `experience-master-plan.md`; the technical architecture roadmap in `improvement-plan.md` remains separate.

---

## 1. Executive diagnosis

VinOS already covers the complete winery lifecycle unusually well:

`vineyard block → sampling/harvest → intake/lot → vessel → fermentation/lab/operations → transfer → bottling → storage → sale → costs/analytics → documents/certification`

The main product problem is no longer missing capability. It is **connective UX**:

- users can reach screens that their role cannot edit, but the controls still look active;
- critical links such as password reset, invitations, and authenticated QR destinations do not complete their frontend journey;
- navigation is state-only, so Back, refresh, bookmarking, and sharing lose context;
- long forms expose nearly every field at once, are not safely draftable, and often lack programmatic labels;
- English and Georgian do not receive equal coverage, especially in newer Lab, Certification, Settings, attachments, shell, and feedback surfaces;
- a recognizable wine/cream/gold identity exists, but raw colors, global overrides, ad hoc typography, and duplicated components make the experience drift screen by screen;
- mobile layouts avoid page-level horizontal scroll in many places, but meaning is hidden behind icon-only navigation, primary actions remain undersized, and operational pages become very long.

The desired outcome is a **trustworthy shift companion**: a cellar or vineyard worker can open VinOS, understand what needs attention, complete one job quickly, recover from interruption or offline work, and know with certainty that it was saved.

---

## 2. Product principles

Every design and implementation decision should follow these rules:

1. **Job first, module second.** Lead with “Receive grapes,” “Log fermentation,” “Record lab result,” and “Dispatch order,” not the internal data structure.
2. **One canonical path per business event.** Harvest becomes intake through one handoff; roles are managed in one place; one entity has one canonical detail view.
3. **Permission-correct by construction.** Only show actions the effective workspace role may perform. Read-only views look read-only.
4. **Never lose operational input.** Draft locally, survive route changes/reloads/offline restarts, and make save/sync state explicit.
5. **English and Georgian are equal products.** The document language, copy, accessible names, validation, dialogs, notifications, and generated UI all switch together.
6. **Progressive disclosure over giant forms.** Show the essential fields first; reveal regulatory, commercial, or advanced detail when needed.
7. **Calm work zones, expressive brand zones.** Login and overview pages may feel atmospheric; forms, tables, and safety decisions stay quiet and high contrast.
8. **Tablet and phone are first-class.** Touch targets, dirty hands, sunlight, intermittent network, and one-handed use are normal conditions.
9. **Accessibility is a component contract.** Teams should not have to remember labels, focus behavior, or live regions on every screen.
10. **Improve incrementally.** Preserve the existing offline queue, lazy loading, reduced-motion behavior, business rules, and test suite; avoid a wholesale rewrite.

---

## 3. Audit baseline

The plan is based on a source audit plus a live walkthrough of the current demo workspace at desktop and 375 × 812.

### Product footprint

- Approximately 35 navigable surfaces.
- Six major areas: Dashboard, Vineyard, Cellar, Business, Documents/Compliance, and Settings.
- Cellar alone exposes 16 destinations including its dashboard.
- Global layers include search, alerts, AI, lot/vessel drawers, onboarding, update/offline feedback, sync troubleshooting, and conflict resolution.

### Measured live examples

- The empty Cellar dashboard was about 3,237px tall on a 375px phone.
- Nine of 17 visible interactive controls on that phone view were under 44px in at least one dimension.
- Grape Intake was about 3,161px tall and displayed 30 fields; 29 lacked a programmatically associated label in the browser accessibility tree.
- Lab displayed 13 fields; 12 lacked an associated label. In Georgian mode, most of the form and history filters remained English.
- Settings was about 2,957px tall with 36 fields and 12 headings; 27 fields lacked an associated label.
- A Head Winemaker saw “View-only” for Lab and Company Profile while still seeing active-looking entry/edit forms. Settings also showed a different Owner/Admin workspace role, creating a contradictory permission story.

### Source-system indicators

- 475 inputs/selects/textareas and 398 `<label>` elements, but only two `htmlFor` usages.
- 21 remaining native `alert()`/`confirm()` flows.
- Only 8 of 53 feature components consume the shared UI primitives.
- Roughly 1,700 raw hex-color occurrences and 39 undeclared Tailwind palette steps.
- Global `!important` typography remaps change the meaning of Tailwind text utilities.
- Dark mode relies on wildcard class-substring overrides rather than semantic theme tokens.
- No automated component accessibility or browser workflow gate exists.

These numbers are baselines, not targets to optimize in isolation. They expose systemic causes that should be fixed through shared contracts.

---

## 4. Target information architecture

### 4.1 Global shell

The shell should contain:

- estate/workspace identity;
- explicit offline/queued/syncing/synced status;
- global search;
- language and theme;
- alerts;
- account/workspace switcher;
- role-relevant primary navigation.

Desktop may use a compact top bar plus a persistent contextual rail. Mobile should use a compact app bar and a maximum of four role-relevant destinations plus **More**. Labels must remain visible; tooltips are not a mobile navigation strategy.

### 4.2 Proposed hierarchy

```text
Today
├─ Attention queue
├─ My tasks
├─ Alerts
└─ Setup / first-vintage progress

Vineyard
├─ Overview
├─ Estate: blocks, projects, cadastre
├─ Field work: scouting, spray/IPM, soil, irrigation
├─ Harvest: sampling, yield, Rtveli
└─ Climate: current weather, history, risk

Cellar
├─ Today
├─ Wine lifecycle: intake, lots, lineage
├─ Vessels: tanks, qvevri, barrels
├─ Production: operations, transfers, fermentation, lab
├─ Packaging: bottling
└─ Tools: inventory, tasks, notes, calculators, AI

Business
├─ Customers & CRM
├─ Orders, reservations & dispatch
├─ Storage
├─ Costs
└─ Analytics

Compliance
├─ Official documents
├─ Certification
└─ Audit trail

Settings
├─ Winery profile
├─ Workspace & modules
├─ Team & roles
├─ Organizations
├─ Integrations
├─ Data & security
└─ Danger zone (authorized owners only)
```

### 4.3 Routing contract

Every module, tab, entity detail, and important overlay needs a canonical URL, for example:

- `/cellar/lots/:lotId`
- `/cellar/vessels/:vesselId`
- `/vineyard/blocks/:blockId`
- `/business/orders/:orderId`
- `/compliance/documents/:annexId`
- `/settings/team`

Back/Forward, refresh, bookmarks, search results, alerts, QR scans, password reset, and invitations must resolve through this model. Protected destinations must persist as a return URL across authentication.

---

## 5. Prioritized improvement backlog

Priority definitions:

- **P0:** trust, security perception, data-loss, or blocked journey; fix before visual expansion.
- **P1:** major efficiency, accessibility, consistency, or mobile issue.
- **P2:** polish, discoverability, and optimization after the core contracts are stable.

### P0 — Make the product trustworthy

| ID | Improvement | Why it matters | Effort | Acceptance |
|---|---|---|---|---|
| UX-001 | Complete password recovery and invitation acceptance | Backend links currently land in frontend flows that do not exist; login has no “Forgot password?” entry | M | Request, neutral confirmation, reset, expiry, invite acceptance, sign-in return, and keyboard/mobile E2E all pass |
| UX-002 | Make the UI permission-correct | View-only users still see editable forms and forbidden tabs; redirects are unexplained | L | A role × route × action matrix is enforced in navigation and components; zero unauthorized active controls; read-only views expose no mutation callbacks |
| UX-003 | Remove simulated role switching and gate destructive/admin surfaces | The visible “Simulated Clearance Role” changes client permissions and creates contradictory effective roles | S | Effective role comes from active membership; header, Settings, and API agree; Danger Zone renders only for authorized owners |
| UX-004 | Preserve QR and deep-link intent through authentication | Scanned lot/vessel links are lost when local login state is absent | M | Scan while signed out → authenticate → exact entity/action; invalid/forbidden targets show actionable states; URL remains canonical |
| UX-005 | Introduce safe drafts and navigation guards | Long operational forms unmount and can silently lose a shift’s work | L | Intake, transfer, fermentation, lab, bottling, and onboarding autosave locally within 500ms, restore after reload/offline restart, and clear after success |
| UX-006 | Establish accessible form contracts | Most controls are not programmatically named and errors are not connected to fields | L | 100% named controls; `aria-required`, `aria-invalid`, and `aria-describedby` where applicable; Enter submission; no nested labels; zero serious/critical axe form issues |
| UX-007 | Make Georgian parity release-blocking | Newer screens mix English, Georgian, and mojibake; `<html lang>` stays English | L | 100% translation-key coverage for supported locales; zero mixed-language UI in the test matrix; document `lang`, title, accessible names, errors, and notifications update together |
| UX-008 | Replace the fabricated harvest dispatch path with canonical intake | One path hard-codes vintage/weight/vessel behavior and bypasses the real intake record | M | Vineyard harvest opens a prefilled Intake draft; one review/confirm creates the authoritative linked records; no hard-coded operational values |

### P1 — Reduce cognitive load and create consistency

| ID | Improvement | Why it matters | Effort | Acceptance |
|---|---|---|---|---|
| UX-101 | Add URL-backed navigation and entity detail routes | Current state-only navigation loses tab/detail context and breaks Back/share | L | Back, Forward, refresh, bookmark, alert, search, and share tests pass for every major entity |
| UX-102 | Rebuild the responsive shell | Mobile navigation becomes icon-only and the toolbar can clip controls | L | Visible labels or an accessible menu at all widths; no clipped actions; 44px touch targets; role-aware mobile destinations |
| UX-103 | Split Settings into focused sections | One 3,000px surface mixes profile, directory import, modules, team, and destructive actions | M | Separate routes/sections, per-section dirty/save state, CRM import moved to Business, Profile opens by default |
| UX-104 | Make onboarding progressive and role-based | Registration and post-login setup duplicate company, module, and widget questions | M | Account creation asks only essentials; setup resumes later; role-specific steps; shared typed module/widget registry |
| UX-105 | Redesign Grape Intake for speed and compliance | Thirty fields appear at once; essential, commercial, and regulatory information compete | L | Essential-first grouping, smart prefill, optional compliance/commercial sections, sticky review, mobile step pattern, draft restore, inline validation |
| UX-106 | Unify feedback and confirmations | Native alerts, temporary unannounced toasts, and duplicate-submit risk undermine confidence | M | One status/toast/dialog system; live regions; persistent actionable errors; pending verbs; `aria-busy`; no product `alert()`/`confirm()` |
| UX-107 | Standardize dialogs, drawers, and popovers | Several overlays lack semantics, focus containment, Escape behavior, and focus return | M | All overlays use shared primitives with naming, inert background, scroll lock, initial/final focus, and keyboard tests |
| UX-108 | Finish the design system and component gallery | Most screens manually rebuild headers, buttons, fields, cards, and states | L | Shared primitives cover all feature screens; a local gallery documents states, themes, locales, density, and accessibility |
| UX-109 | Introduce responsive data views | Audit, Bottling, and Storage rely on overflow tables on phones | M | Cards/list rows on phones, full tables on larger screens, preserved actions, captions/scopes, no page-level overflow |
| UX-110 | Make alerts and search contextual | Selecting a result opens a category, not the chosen record | M | Exact entity opens, is highlighted/focused, and offers “Back to search/alert”; not-found and no-permission states are explicit |
| UX-111 | Complete empty, loading, and failure states | Some empty cards have no CTA; several lazy surfaces render nothing initially | M | Every empty state explains, offers a valid next step, and respects permission; named skeleton/status appears within 100ms; failures keep shell + Retry/Back |
| UX-112 | Make the Cellar Map input-agnostic | Dragging is mouse-only and is presented as the primary transfer interaction | M | Vessels are named/focusable; pointer, touch, keyboard, and a non-drag transfer form all complete the job |

### P2 — Refine the experience

| ID | Improvement | Why it matters | Effort | Acceptance |
|---|---|---|---|---|
| UX-201 | Consolidate brand and terminology | VinOS, VINEA, MaraniOS, CellarFlow, Vazi, and Gvino are mixed | S | One approved product name and bilingual glossary; Vineyard/Cellar are primary labels; legacy names removed from user-facing copy |
| UX-202 | Complete visual-token migration | Raw hex values, wildcard dark rules, and unknown utilities create theme drift | L | Semantic tokens only in product components; zero unknown utilities; no wildcard theme overrides; light/dark/system pass visual QA |
| UX-203 | Normalize typography and density | Global font-size remaps and synthetic weights make adjacent text unpredictable | M | Semantic type roles; no global `!important` size patch; normal copy 14–16px; no support text under 12px; EN/KA hierarchy matches |
| UX-204 | Standardize iconography and brand mark | Emoji UI/branding varies by platform | S | Reusable SVG brand mark; Lucide for operational UI; emoji limited to intentional content moments |
| UX-205 | Tokenize charts and add accessible summaries | Charts hard-code light colors and often lack equivalent data summaries | M | Theme-aware axes/grid/tooltips/categories; concise text summary and accessible/downloadable data alternative |
| UX-206 | Integrate or remove orphaned surfaces | Rtveli and Master Admin are implemented but unreachable | M | Rtveli joins Harvest/Intake; Admin is intentionally routed and authorized or excluded from product builds |
| UX-207 | Add route-level performance budgets | Initial bundle is protected, but lazy-route weight and feedback are not | M | Per-route compressed budgets, LCP ≤2.5s, INP ≤200ms on representative hardware/network, next-route idle prefetch where useful |

---

## 6. Design-system specification

### 6.1 Semantic color system

Replace raw UI hex values and wildcard dark-mode fixes with one semantic palette:

- `canvas`, `surface`, `surface-raised`, `surface-sunken`, `overlay`
- `text`, `text-muted`, `text-subtle`, `text-inverse`
- `border`, `border-strong`, `divider`
- `primary`, `primary-hover`, `primary-contrast`
- `focus`
- `success`, `warning`, `danger`, `info` with background/border/text variants
- chart foreground, grid, tooltip, and categorical series tokens

Gold may remain a decorative brand color, but a separate accessible ochre/burgundy token should handle small text and light-theme focus. Focus indicators need at least 3:1 contrast; normal text needs 4.5:1.

### 6.2 Typography

Use semantic roles instead of arbitrary pixel utilities:

- brand display;
- page title;
- section title;
- card title;
- body;
- compact body;
- label;
- caption/helper;
- data/mono.

Operational copy should use sentence case. Reserve serif and uppercase for a small number of brand/editorial moments. Either add a Georgian serif display face or use a shared sans display treatment so EN and KA have equal hierarchy. Load every weight the design actually uses; do not synthesize `font-black`.

### 6.3 Layout and density

Define three page containers:

- **Readable:** auth, setup, Settings forms, help.
- **Standard:** dashboards and ordinary workflows.
- **Data-wide:** dense tables, timeline, analytics, compliance preview.

Define one spacing scale, control radius, card radius, overlay radius, and elevation model. Content edges should not jump when switching modules. Shadows indicate floating layers; dividers and spacing structure nested content.

Minimum interactive size:

- touch layouts: 44 × 44px;
- compact desktop: 36 × 36px;
- destructive or high-risk actions: text label plus icon, never a bare 14px glyph.

### 6.4 Required primitives

Complete and adopt:

- `AppShell`, `PageContainer`, `PageHeader`, `SectionCard`, `MetricCard`
- `Button`, `IconButton`, `ButtonGroup`, `LinkButton`
- `TextField`, `NumberField`, `SelectField`, `TextArea`, `Checkbox`, `RadioGroup`, `DateField`
- `FieldLabel`, helper/error text, unit suffix, input summary/error summary
- `Tabs`, `SegmentedControl`, contextual mobile selector
- `Dialog`, `AlertDialog`, `Drawer`, `Popover`, `Menu`, `Tooltip`
- `Toast/StatusRegion`, offline/sync state
- `EmptyState`, `Skeleton`, `InlineNotice`, `ErrorState`
- `ResponsiveDataView`, `DataTable`, mobile record card
- `Progress`, `StepIndicator`

Use `clsx` plus `tailwind-merge` so variant classes resolve predictably.

### 6.5 Motion

Keep the existing compositor-only and reduced-motion direction. Motion should communicate:

- navigation/state continuity;
- save/sync completion;
- overlay entry/exit;
- reordering or entity creation.

Avoid constant pulsing, decorative motion in work zones, and animation that delays interaction. Power-saving mode should disable ambient effects without changing information.

---

## 7. Area-by-area experience plan

### 7.1 Authentication and team onboarding

- Add Forgot Password, Reset Password, Accept Invitation, expired/invalid token, and neutral confirmation screens.
- Add show/hide passcode, requirements, pending state, duplicate-submit protection, and inline errors.
- Preserve the requested URL across login, OAuth, verification, invitation, and reset flows.
- Ask for credentials first; defer winery profile, modules, widgets, and optional contact/location details to setup.
- Never reveal whether a recovery email is registered.

### 7.2 Today dashboard and setup

- Make “What needs attention” the first operational section.
- Combine duplicate zero-state sections; a new account should not scroll through multiple cards that all say nothing exists.
- Turn metrics into explicit destinations with a visible label, not just clickable cards.
- Extend setup into a **First Vintage** journey: winery → vineyard → vessels → intake → operation → lab → bottling → storage → first sale → compliance.
- Show role-specific progress and allow dismissal/resume from a predictable location.

### 7.3 Vineyard

- Group nine flat tabs into Estate, Field Work, Harvest, and Climate.
- Make block detail the organizing entity for scouting, spray/IPM, sampling, and yield history.
- Route harvest completion into a prefilled Intake draft; remove duplicate record creation.
- Integrate Rtveli supplier/payment/capacity views under Harvest or Intake.
- Make weather/risk explain source freshness, last update, and unavailable-state remedy.

### 7.4 Cellar

- Preserve the current lifecycle/work/tools grouping on desktop and expose the same hierarchy, not a 16-item flat list, on mobile.
- Redesign Intake around essential fields, prefill, local draft, live weight/volume summary, and a review step.
- Give lot and vessel detail canonical routes with timeline, related operations, chemistry, documents, and lineage.
- Make Lab read-only for roles without create permission; otherwise show units, expected ranges, latest comparison, and risk context.
- Make transfers possible with source/destination fields on every device; the map is an enhancement, not the only path.
- Add CTA-bearing prerequisites: Bottling → choose/create lot; Transfers → register vessels; dashboard empty cards → relevant setup action.

### 7.5 Business

- Move Winery Directory/CRM import from Settings to Customers & CRM.
- Reuse the existing Costs/Sales mobile-card pattern for Storage and other wide tables.
- Keep order, reservation, dispatch, movement, and payment states consistent and visible through shared badges/timelines.
- Link sales/storage/cost events back to the lot and customer rather than presenting disconnected ledgers.

### 7.6 Compliance and documents

- Rename the area consistently to **Compliance** or **Documents & Compliance**.
- Separate document configuration, readiness warnings, and preview; use side-by-side panes on wide screens and a dedicated preview step on phones.
- Localize Certification, readiness states, attachments, empty states, and export feedback completely.
- Turn missing data into actionable links to the exact Settings, Vineyard, Intake, or Production field that supplies it.
- Keep the audit trail read-only, filterable, shareable by URL, and responsive.

### 7.7 Settings and administration

- Make Winery Profile the default Settings destination, not Integration Hub.
- Split profile, workspace/modules, team/roles, organizations, integrations, data/security, and danger zone.
- Save each section independently; show dirty, saving, saved, and error states.
- Remove “Simulated Clearance Role.” Display the effective role and explain that owners manage it in Team & Roles.
- Hide export/reset/admin actions unless authorized. Use an AlertDialog with typed confirmation for irreversible actions.
- Intentionally route Master Admin for master admins or exclude it from ordinary product navigation/bundles.

### 7.8 Global layers

- Search opens the exact selected record and restores search context on Back.
- Alerts carry entity context and open that entity, not merely its category.
- AI should be available through a consistent mobile entry, clearly label draft versus committed actions, and use review before mutation.
- All drawers/dialogs share focus, Escape, outside-click, scroll-lock, and focus-return behavior.
- Sync conflicts use a real radio group, plain-language differences, timestamps/users, and a safe default.

---

## 8. Accessibility, localization, and data-safety gates

### Accessibility

- 100% of controls have a programmatic accessible name.
- Every page has one clear heading and receives focus after route navigation.
- Every dialog has name, modal semantics, trapped focus, Escape policy, inert background, and focus restoration.
- Every table has a caption and scoped headers; every chart/map has an equivalent summary or data view.
- Success/info use a polite status region; failures use a persistent alert or focused error summary.
- All keyboard-only core journeys work in EN and KA.
- No serious/critical axe violations; WCAG 2.2 AA contrast and focus indicators pass both themes.

### Localization

- Update `document.documentElement.lang` and localized page title at runtime.
- Centralize user-facing strings; stop adding inline language ternaries to feature components.
- Add a translation-key completeness test and terminology glossary.
- Test text expansion, long Georgian labels, dates, numbers, currency, units, and generated/export copy.
- Fail CI on malformed UTF-8/mojibake in user-facing source or generated markup.

### Data safety

- Autosave drafts locally and include their status in the offline/sync story.
- Prevent duplicate submits and show idempotent completion.
- Warn on dirty navigation and browser close; provide Save draft / Discard / Stay.
- Use Undo for reversible deletes and AlertDialog for irreversible operations.
- A server rejection must never be the first time a user learns an action was not permitted.

---

## 9. Execution roadmap

Each milestone should ship independently and keep TypeScript, tests, build, offline behavior, and bundle budgets green.

### Milestone 0 — Trust repair

Deliver UX-001 through UX-008 before broad visual work:

- account recovery and invite routes;
- effective-role cleanup and permission-correct UI;
- pending destinations across auth;
- operational drafts;
- form-label foundation;
- Georgian shell/new-module parity;
- canonical harvest → intake handoff.

**Exit gate:** no broken account/team link, no unauthorized active control, no core-form data loss, and no mixed-language P0 journey.

### Milestone 1 — Foundations

- semantic color, typography, spacing, radius, elevation, z-index, chart, and motion tokens;
- accessible field/button/dialog/status/data-view primitives;
- local component gallery across EN/KA, light/dark, mobile/desktop, and all states;
- CI for unknown Tailwind utilities, accessibility, and translation coverage.

**Exit gate:** new screens can be built without raw colors, manual labels, native alerts, or custom modal focus code.

### Milestone 2 — Shell and navigation

- canonical route model;
- responsive app bar/primary navigation/context rail;
- role-aware destinations;
- deep-linkable entity detail;
- exact-target search and alerts;
- route loading/error states.

**Exit gate:** Back/Forward/refresh/share/QR work; no clipped or icon-only primary navigation; route feedback appears within 100ms.

### Milestone 3 — Core operational workflows

- progressive onboarding and First Vintage journey;
- Vineyard grouping and harvest handoff;
- Intake redesign;
- lot/vessel detail;
- fermentation, lab, transfer, map, bottling, inventory, and task state pass.

**Exit gate:** representative users complete block → harvest → intake → fermentation/lab → transfer/bottle by keyboard, touch, online, and offline without losing input.

### Milestone 4 — Business, compliance, and settings

- Customers/CRM and Business responsive views;
- document readiness/preview redesign;
- Certification and Audit parity;
- split Settings and authorized admin/danger surfaces;
- integrate Rtveli and make an intentional Master Admin decision.

**Exit gate:** every major area uses shared page/form/data/feedback contracts and has complete EN/KA states.

### Milestone 5 — Visual cleanup and performance

- remove wildcard dark-mode rules, global font-size patch, raw UI hex values, unknown utilities, and emoji UI drift;
- theme charts and exports;
- add route budgets, targeted prefetch, skeletons, and representative-device performance runs;
- final visual regression matrix.

**Exit gate:** no theme hacks, no design-token drift, and performance/accessibility targets hold on the supported device matrix.

---

## 10. Verification matrix

Every migrated journey should be verified across:

| Dimension | Required coverage |
|---|---|
| Viewport | 320, 375, 768, 1024, 1440px; portrait and representative tablet landscape |
| Theme | Light, dark, system; hover, focus, selected, disabled, warning, and error states |
| Language | English and Georgian, including long labels and generated copy |
| Input | Keyboard, mouse, touch/pointer, 200% zoom |
| Role | Owner/Admin, Winemaker, Viticulturist, Lab Technician, Cellar Worker, Read-Only |
| Data | Fresh estate, normal estate, dense/long data, missing prerequisites, invalid/expired link |
| Network | Online, offline, queued changes, reconnect/sync, conflict, lazy-route failure |
| Motion | Normal, reduced motion, power-saving mode |

Automation should include:

- real ESLint plus `jsx-a11y`;
- component-level axe tests for primitives and feature states;
- browser E2E for auth, invitation, QR, onboarding, intake, fermentation, lab, transfer, bottling, sale, document export, and Settings/team;
- visual regression for the viewport/theme/locale matrix;
- translation completeness and invalid-UTF-8 checks;
- unknown Tailwind utility detection;
- per-route bundle and Web Vitals budgets.

---

## 11. Product success measures

Establish an event taxonomy that does not collect wine data or sensitive field values. Track flow outcomes and timing only.

### Activation

- time to configured estate;
- setup and First Vintage step completion;
- time to first block, vessel, intake, operation, and lab record;
- invite acceptance success rate.

### Efficiency

- median time and interaction count for intake, fermentation log, lab result, transfer, dispatch, and document export;
- search result → exact entity success rate;
- Back/refresh/deep-link recovery success;
- mobile versus desktop completion rate.

### Trust and reliability

- client-visible permission rejection rate;
- duplicate submission rate;
- restored draft success rate;
- sync conflict rate and resolution success;
- form validation failure/abandonment rate;
- route/chunk/client-error rate.

### Quality targets

- 100% accessible-name coverage for controls;
- zero serious/critical axe violations;
- zero mixed-language or mojibake defects in supported locales;
- zero page-level horizontal overflow;
- 44px touch targets for touch layouts;
- LCP ≤2.5s and INP ≤200ms on the representative cellar tablet/network profile.

---

## 12. Whole-app definition of done

The improvement program is complete when:

- account recovery, invitation, OAuth, verification, QR, search, and alert links land on the intended authenticated destination;
- every screen has a canonical URL and preserves context through Back, Forward, refresh, and share;
- users see only the routes and actions permitted by their effective workspace role;
- no core operational input is lost by navigation, reload, offline restart, or lazy-route failure;
- the canonical vineyard-to-bottle flow produces one coherent linked record chain;
- every feature uses shared shell, page, form, dialog, feedback, empty/loading/error, and responsive-data contracts;
- English and Georgian are complete, legible, and equivalent, including accessibility and generated UI;
- light/dark/system themes use semantic tokens with AA contrast and no wildcard override layer;
- all primary touch actions meet 44px, all keyboard journeys pass, and all dense tables have a usable phone representation;
- automated accessibility, localization, visual, workflow, utility, and route-performance gates prevent regression.

The app should then feel less like a collection of powerful modules and more like one continuous winery operating system.

---

## 13. Delivery log

### 2026-07-10 — UX-001 complete

The account-access vertical slice is implemented and verified:

- added localized English/Georgian password-recovery, password-reset, and invitation-acceptance screens;
- added neutral recovery responses, shared passcode validation, safe link-token parsing and URL cleanup, and return-to-invitation behavior after sign-in;
- bound invitation acceptance to the invited, verified email address and made the effective organization-membership role authoritative in the session, header, and dashboard;
- persisted reset-token metadata in both JSON and PostgreSQL database paths and cleared stale cached authentication after an authoritative `401` response;
- added regression coverage for access links, role labels, passcode policy, invitation authorization, and reset-token persistence;
- passed lint, 327 automated tests across 52 files, the production build, and live desktop/mobile browser QA in both supported languages.

The next product slice is **UX-002: permission-correct UI**, starting with a single effective-role model, role-aware destinations, removal of simulated role controls, and elimination of active-looking mutation controls in view-only areas.

Security hardening that remains scheduled after the core journey work: throttling recovery/invitation endpoints, hashing stored invitation tokens, atomic invitation consumption, session revocation after password reset, and production-safe mail/base-URL configuration.

### 2026-07-11 — UX-002 foundation delivered; workflow rollout in progress

The effective-role and permission-correct interface foundation is now implemented:

- organization switching returns and applies the authoritative membership role immediately; personal-profile saves preserve that role instead of falling back to the account’s legacy role;
- the compact app shell, desktop/mobile cellar navigation, quick links, invalid cached-tab recovery, and global search only expose destinations the active role can open;
- portal and cellar dashboards now show role-relevant setup steps, actions, metrics, widgets, charts, and task controls;
- task create/update/delete actions are gated independently, matching the server matrix for Lab Technician, Cellar Worker, and Read-Only roles;
- certification becomes an explicit read-only review surface when mutation permission is absent;
- the first operational-form rollout now gates wine-lot creation and editing/stage transitions, lab-analysis entry, inventory create/update/delete actions, and note create/delete actions independently;
- read-only and partial-access states preserve lot history, lab history, stock records, note browsing, and filters, expand the remaining review surface when forms are hidden, and explain the active limitation in English and Georgian;
- the second operational rollout covers tanks and vessels, the cellar map, vessel detail drawer, qvevri passports, transfers, fermentation, and bottling with guarded callbacks as well as hidden mutation controls;
- a centralized compound-workflow resolver now checks every collection an action writes: transfer execution requires transfer, vessel, and lot permissions; fermentation readings can save the permitted journal and vessel telemetry without attempting a forbidden lot-history write; bottling separates its core run from optional cost/inventory and finished-goods storage ledgers;
- Cellar Worker keeps vessel sanitation and fermentation-reading entry without seeing commission/decommission, unsafe transfer execution, lot-stage completion, history rollback, or bottling actions; Winemaker retains core bottling while owner-only costing, storage placement, and rollback remain hidden;
- the third operational rollout covers grape intake, cellar operations, finished-goods storage, and cost/margin reporting: forbidden forms and destructive controls disappear while histories, availability, valuation, margin, and export surfaces remain useful;
- grape receiving now treats intake, lot creation, the initial fermentation reading, and audit history as one mandatory permission contract, while harvest linking, vessel filling, and fruit-cost posting are independently stripped when their destination collection is unavailable;
- cellar-operation logging now requires both the operation journal and lot timeline, with vessel context and material/cost consumption independently gated; Winemaker retains core operational entry and vessel context without being offered cost-ledger material consumption, while read-only roles retain a coherent history-only page;
- storage location/movement actions and cost create/delete, sales-price editing, and report export are independently permissioned; storage availability now receives live sales reservations from the shell instead of presenting every on-hand bottle as available;
- live mobile QA caught and corrected a contradictory read-only operations empty state, and verified that the four review surfaces fit a 384 px viewport without page-level horizontal overflow;
- the fourth operational rollout covers Vazi and sales: field records, vineyard projects, task drafts, harvest handoff, reservations, dispatches, stock movements, order updates, deletion, and cost visibility now use explicit action contracts rather than a page-level write flag;
- harvest dispatch is exposed only when the role can update the harvest, create the destination lot, and write its audit event; sales fulfillment and deletion likewise require every sales, storage, and linked-order write they perform;
- cross-layer contract tests now compare the UI workflow resolver with the sync authorization boundary for all six supported roles across harvest handoff, dispatch creation, order fulfillment, and compound dispatch deletion;
- the fresh bundle gate caught the new account/conflict interfaces entering the eager shell; password/invitation flows and conflict resolution now load on demand, with regression assertions keeping both chunks off the critical path;
- the storage-deletion/conflict-recovery stabilization now carries the exact attempted multi-collection transaction into manual resolution, replays clean siblings from the authoritative server snapshot, retains deferred tombstones, and removes only deletions explicitly resolved to the server version;
- a server-rejected deletion now retires its scoped tombstone and supplies a safe retry payload with its order/bottling rollback companions removed, while unrelated clean edits remain queued; repeated organization-state races keep the local transaction instead of replacing it with the server snapshot;
- successful retries acknowledge the durable conflict snapshot, rejected or unreadable responses keep it, and a recovery snapshot is refused when a newer edit, tombstone, organization context, or offline mutation makes it stale;
- the stale fermentation backup was verified against the active localized component and removed; no unique implementation was discarded;
- production boot proof is now repeatable: the live smoke boots an isolated production server and checks health, deep-link SPA fallback, JSON 404s for unknown APIs, non-immutable service-worker caching, immutable hashed assets, and missing-session-secret failure;
- production no longer serves after a configured PostgreSQL initialization or startup schema-command failure, preventing a damaged revision from silently switching to fallback persistence;
- Settings no longer offers simulated role switching, company fields are genuinely disabled for non-managers, personal preferences remain editable, workspace-specific forms refresh with the selected organization’s data, and export/danger surfaces remain owner-only;
- the newer compact-header shell was preserved and the verified auth/recovery/invitation work was rebased onto it after a concurrent workspace update;
- validation passes: TypeScript, 613 pre-build tests plus 4 build-dependent bundle assertions across 87 tracked test files, production build, the fresh critical-path bundle budget, and the live production boot smoke. Nested assistant worktrees are excluded from Vitest discovery so the baseline measures only the primary checkout. Live browser QA covers Owner, Winemaker, Lab Technician, Cellar Worker, and Read-Only navigation/action matrices; the latest pass covers desktop owner controls, Winemaker partial intake/operations, 384 px read-only intake/operations/storage/costs, and zero browser console errors; localized English/Georgian permission states are regression-tested.

UX-002 and Milestone 0 are **complete**. The stabilized work is partitioned into reviewable startup-safety, permission/sync-integrity, and test-isolation commits, and the complete gate sequence passes from a clean checkout. The next bounded slice is Milestone 1: mandatory pull-request CI and verified-artifact deployment.
