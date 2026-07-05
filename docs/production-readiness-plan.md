# Production Readiness Implementation Plan

**Status date:** 2026-07-06
**Branch:** `feat/erp-modules-deploy`
**Scope:** Close the gaps found in the production-readiness review before promoting to a live tenant deployment.

The codebase is mechanically healthy — `tsc --noEmit` is clean, tests pass, and the production build succeeds. What remains are a small number of security and durability issues. This plan sequences them by risk so the release-blocking items land first.

## Implementation progress — 2026-07-06

Phase 0 (item 1) and all of Phase 1 are **done**, plus a critical prod-boot crash found during verification:

- ✅ **Express 5 wildcard crash (new blocker).** `app.get('*')` threw under Express 5 / path-to-regexp v8, so the container (`NODE_ENV=production`) crashed on boot. Fixed with a RegExp catch-all in `server.ts`. This was missed by the original review because tests/build never boot the server in production mode — verified live now (server boots, SPA fallback serves `index.html`).
- ✅ `SESSION_SECRET` fail-fast in prod + `.env.example` entries (item 1). Verified: prod boot without the secret aborts.
- ✅ PBKDF2 210k with backward-compatible verification + transparent re-hash on login (item 4).
- ✅ Constant-time token signature comparison (item 5).
- ✅ `trust proxy = 1` + `clientIp()` uses `req.ip` (item 3).
- ✅ Security headers via `server/middleware/securityHeaders.ts`; CSP ships **Report-Only**, promote with `CSP_ENFORCE=true` after staging (item 6). `X-Powered-By` disabled.
- ✅ Tests: `tests/auth.test.ts`, `tests/clientIp.test.ts` added; suite green (214 passing).

**Still open:** commit the branch (item 2), Phase 2 durability + Google-user investigation (items 7–8), Phase 3 exceljs (item 9). Remaining action needing you: set `SESSION_SECRET` and confirm `DATABASE_URL` in the Fly environment.

## Priority summary

| # | Item | Severity | Effort | Phase |
|---|------|----------|--------|-------|
| 1 | Hardcoded `SESSION_SECRET` fallback | **Blocker** | XS | 0 |
| 2 | Commit the in-flight refactor branch | **Blocker** | XS | 0 |
| 3 | Rate-limiter bypass via spoofed `X-Forwarded-For` | High | S | 1 |
| 4 | PBKDF2 iteration count too low (10k) | High | S | 1 |
| 5 | Session-token signature compared with `!==` | Medium | XS | 1 |
| 6 | No HTTP security headers (helmet/CSP) | Medium | S | 1 |
| 7 | Google-auth users missing from admin panel (investigate) | Medium | M | 2 |
| 8 | State durability under scale-to-zero / multi-instance | High | M–L | 2 |
| 9 | `exceljs` (930 KB) eagerly bundled | Low | S | 3 |

---

## Phase 0 — Release blockers

### 1. Hardcoded `SESSION_SECRET` fallback

**Problem.** [`server/auth.ts:6`](../server/auth.ts) falls back to a literal secret when the env var is unset:

```ts
const SECRET_KEY = process.env.SESSION_SECRET || 'vinea-cellar-secret-key-signature-2026';
```

Session tokens are HMAC-signed with this key. If `SESSION_SECRET` is not set in production, anyone with repo access can forge a token for any `username` — including `ADMIN_USERNAME`, which grants master-admin godmode. `.env.example` does not currently mention `SESSION_SECRET`, so it may be unset in the live environment.

**Change.**
- In `server/auth.ts`, resolve the secret once at module load. If `NODE_ENV === 'production'` and `SESSION_SECRET` is missing/blank, `throw` at startup (fail fast) rather than falling back.
- Keep a deterministic fallback **only** for non-production so local/dev and tests keep working.
- Add `SESSION_SECRET` to `.env.example` with generation guidance (`openssl rand -hex 32`).

**Files.** `server/auth.ts`, `.env.example`.

**Verification.**
- Set the Fly secret: `fly secrets set SESSION_SECRET=$(openssl rand -hex 32)`, then `fly secrets list` to confirm.
- Add a unit test asserting the module throws when `NODE_ENV=production` and the secret is absent.
- Existing session/auth tests continue to pass in dev mode.

### 2. Commit the in-flight refactor branch

**Problem.** The `server.ts` monolith → `server/routes` + `server/middleware` split is entirely uncommitted (8 modified + 4 untracked paths). "Production ready" requires that the code which passed CI is the code that ships.

**Change.** Stage and commit the modular refactor on `feat/erp-modules-deploy` as a coherent commit (or a small series). Do **not** fold the Phase 1 security fixes into this commit — keep the refactor reviewable on its own.

**Verification.** `git status` clean; `npm run lint && npm test` on the committed tree.

---

## Phase 1 — Security hardening

### 3. Rate-limiter bypass via spoofed `X-Forwarded-For`

**Problem.** [`server.ts:19`](../server.ts) sets `app.set('trust proxy', true)` (trust *all* hops), and [`server/config.ts:84`](../server/config.ts) `clientIp()` takes the **first** `X-Forwarded-For` entry. A client can send an arbitrary `X-Forwarded-For` header and get a fresh rate-limit bucket per request, defeating the login brute-force limiter ([`server/middleware/auth.ts:121`](../server/middleware/auth.ts)).

**Change.**
- Set `trust proxy` to the exact number of proxy hops the platform adds (Fly.io = `1`) instead of `true`.
- Derive the client IP from Express's `req.ip` (which respects the hop count) rather than manually reading the first XFF entry, or make `clientIp()` read the *last* untrusted entry consistent with the hop count.

**Files.** `server.ts`, `server/config.ts`.

**Verification.** Add a test that forges `X-Forwarded-For` and asserts the limiter still counts attempts against the real socket IP. Manually confirm login lockout still triggers after the configured attempts.

### 4. PBKDF2 iteration count too low

**Problem.** [`server/auth.ts:3`](../server/auth.ts) uses 10,000 PBKDF2-SHA512 iterations — well below the current OWASP guidance (~210,000 for SHA-512).

**Change.**
- Raise `ITERATIONS` to ≥210,000 for **newly created** hashes.
- Store the iteration count alongside each hash (e.g. `iterations:salt:hash`) so `verifyPassword` can validate existing 10k hashes and transparently re-hash on next successful login. Preserve backward compatibility for the current `salt:hash` format (assume 10,000 when the count is absent).

**Files.** `server/auth.ts`.

**Verification.** Unit tests: (a) a legacy `salt:hash` still verifies, (b) a new hash uses the higher count and verifies, (c) round-trip re-hash upgrades a legacy hash. Spot-check login latency stays acceptable (<~300 ms).

### 5. Constant-time token-signature comparison

**Problem.** [`server/auth.ts:42`](../server/auth.ts) compares HMAC signatures with `signature !== expectedSignature`, a non-constant-time comparison (timing-attack surface). Password verification already uses `timingSafeEqual`.

**Change.** Compare the two hex signatures via `crypto.timingSafeEqual` on equal-length buffers (guard against length mismatch first).

**Files.** `server/auth.ts`.

**Verification.** Existing token tests pass; add a case for a tampered signature returning `null`.

### 6. HTTP security headers

**Problem.** No `helmet`/CSP/`X-Frame-Options`/HSTS are set. The SPA is served without framing or content-type protections.

**Change.**
- Add `helmet` with a Content-Security-Policy compatible with the app's needs (Google OAuth redirect, Google Maps/`@vis.gl`, Gemini calls, inline styles from Tailwind, the service worker).
- Enable HSTS (prod only, behind `force_https`).
- Start CSP in report-only mode if needed to avoid breaking the map/AI integrations, then enforce.

**Files.** `server.ts` (or a new `server/middleware/securityHeaders.ts`), `package.json`.

**Verification.** `curl -I` shows the headers in prod mode; smoke-test that Google login, the map picker, and the AI winemaker still function under the enforced CSP via the preview server.

---

## Phase 2 — Data durability & the admin-panel gap

### 7. Google-auth users missing from admin panel (investigate → fix)

**Finding so far.** A full static trace shows **no provider-based filter** anywhere:
- Google OAuth creates the user/org/membership and calls `saveCoreMetadata('auth-google-register')` — structurally identical to the email `/register` path ([`auth.ts:640-688`](../server/routes/auth.ts) vs [`auth.ts:200-234`](../server/routes/auth.ts)).
- The admin endpoint returns **all** `db.users` ([`admin.ts:187`](../server/routes/admin.ts)); the Postgres read-back mapping preserves every row ([`db.ts:468`](../server/db.ts)); the portal filter is only a search box ([`MasterAdminPortal.tsx:504`](../components/MasterAdminPortal.tsx)).

So this is **not** a simple display filter. The leading hypothesis is durability (see item 8): a Google account created on one instance may not be visible to an admin request served by a different/restarted instance if Postgres persistence is not the authoritative store. The two paths also differ subtly — Google users have `passwordHash: ''` and `registrationComplete: false` until they finish onboarding — which is worth ruling out.

**Change (staged).**
1. **Reproduce** against the real deployment: register a fresh Google account, immediately hit `/api/admin/users`, and record whether it appears. Repeat after a cold start / on a second machine.
2. **Instrument** `saveCoreMetadata('auth-google-register')` and `persistCoreMetadataToPostgres` to log whether the Postgres upsert succeeded for that username (the current failure path throws → 500, but confirm it isn't being swallowed upstream).
3. Confirm whether the deployment actually has `DATABASE_URL` set (Postgres authoritative) or is running on GCS/local-volume only.
4. Apply the fix indicated by the reproduction: most likely making Postgres the guaranteed source of truth for account creation (item 8), or correcting an onboarding-state assumption if incomplete-registration accounts are being hidden.

**Files.** `server/routes/auth.ts`, `server/db.ts` (instrumentation), possibly `server/routes/admin.ts`.

**Verification.** A newly registered Google account appears in `/api/admin/users` immediately and survives an instance restart.

### 8. State durability under scale-to-zero / multi-instance

**Problem.** [`fly.toml`](../fly.toml) sets `min_machines_running = 0` with `auto_stop_machines`. The server holds core state in-memory (`getDB()`) with a JSONB/`db.json` snapshot. If `DATABASE_URL` is unset or Postgres writes fail, account creations live only in one machine's memory + local `/app/data/db.json`; a scaled-down/restarted or second machine serves stale data. This is the most probable root cause of item 7 and a general data-loss risk.

**Change.**
- Make Postgres the **authoritative, synchronous** store for account/org/membership creation in production: require `DATABASE_URL`, and fail account-creation requests if the core-metadata write does not commit (rather than treating Postgres as a best-effort mirror).
- Confirm the Fly Postgres attachment and `DATABASE_URL` secret are present; document the requirement in `.env.example` and deploy docs.
- Reconsider `min_machines_running = 0` for a system that must reflect writes immediately — either keep ≥1 warm machine, or ensure every read path re-hydrates from Postgres (the code already calls `refreshCoreMetadataFromPostgres()` in `liveSessionRole`, so the gap is write durability, not read).
- This is the near-term mitigation of the larger JSONB-blob sync ceiling already documented in [`docs/improvement-plan.md`](./improvement-plan.md); the full relational migration remains a separate, later effort.

**Files.** `server/db.ts`, `server/routes/auth.ts`, `fly.toml`, `.env.example`, deploy docs.

**Verification.** Register an account, restart the machine (`fly machine restart`), confirm the account persists and is visible. Load-test with two machines and confirm a write on one is visible on the other.

---

## Phase 3 — Performance (non-blocking)

### 9. Lazy-load `exceljs`

**Problem.** The build flags a 930 KB (`256 KB` gzip) `exceljs` chunk. Excel export is not needed on first paint.

**Change.** Confirm `exceljs` is only reached via `import()` at export time (the build already emits it as a separate chunk — verify no eager import pulls it into the initial graph). Defer any remaining eager import behind the export action.

**Files.** Whichever module imports `exceljs` (search `reportXlsx` / `renderXlsx`).

**Verification.** `npm run build` shows the `exceljs` chunk is not a dependency of the entry/initial chunks; export still works via the preview server.

---

## Suggested execution order

1. **Phase 0** (both items) — same day; unblocks a safe deploy.
2. **Phase 1** items 3–6 — one focused PR, security-themed, with tests.
3. **Phase 2** item 8 first (fixes durability), then verify item 7 is resolved by it; only add targeted code if reproduction shows a second cause.
4. **Phase 3** — opportunistic.

Each phase should end green on `npm run lint && npm test` and a manual preview-server smoke test of login, Google OAuth, the map picker, and the AI winemaker.
