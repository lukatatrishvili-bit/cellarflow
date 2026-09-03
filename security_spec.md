# CellarFlow security and data-integrity specification

This document describes the controls the application actually runs. PostgreSQL is the authoritative production backend; GCS/local JSON are bounded fallback/export modes and are not alternate authorization systems.

## Trust boundaries

- The browser is untrusted. Role labels, organization ids, record ids, timestamps, command receipts, sync baselines, tombstones, and attachment metadata supplied by a client must be revalidated at the server boundary.
- Authentication is established by the server session. Production sessions require a strong `SESSION_SECRET`; account verification, recovery, invitation, Google OAuth, and demo access are governed by server routes and environment policy.
- A session ends on the server, not only in the browser. Logout, password reset, and security-sensitive administrative changes increment the stored session version, so a token captured earlier fails its next request. Revocation is account-wide rather than per-device, and the environment master admin holds no stored version — that session expires rather than being revoked.
- State-changing requests must originate from the application itself. Two independent layers enforce this: the `SameSite=Lax` session cookie, and a request-layer check that rejects any unsafe-method request proving itself cross-site through `Sec-Fetch-Site`, a foreign `Origin`, or the opaque `null` origin. Safe methods are exempt so emailed OAuth and account-review links keep working, and an absent header is not treated as evidence, so non-browser clients are unaffected.
- Authorization comes from the current server-side organization membership, not cached browser state. Role changes take effect on the next request.
- Every operational read or write is scoped to the active organization. Human-readable record ids are never sufficient authority by themselves.
- Script execution in the browser is allowlisted. The production Content-Security-Policy permits no inline script and no `eval`, so injected markup cannot execute, and it names only origins the browser actually contacts. It ships in Report-Only mode with violations collected at `/api/telemetry/csp-report`; `CSP_ENFORCE=true` promotes it once a production run reports clean. `style-src` still allows inline styles, which nonces cannot cover for runtime style attributes.
- Model spend and request volume are bounded per organization. Every route that calls a model reserves against the winery's daily allowance before the provider is contacted, and whole-state sync, the full-state read, and the command endpoints refuse a caller past a fixed ceiling. The request ceiling is per instance and in memory, so it bounds a runaway client rather than a distributed one; cross-instance enforcement exists where it matters most, on authentication.
- Production writes require a durable backend. `/api/ready` rejects unavailable/mismatched PostgreSQL, incomplete hydration, active backend write failures, and production-local JSON.

## Data invariants

1. Vessel volume stays between zero and capacity; transfer, intake, fermentation, bottling, and reversal commands preserve vessel/lot conservation rules.
2. Command-created business events use an organization-scoped idempotency key. A replay returns the durable result without applying a second effect.
3. Corrections are append-only reversal commands. Original audit, movement, cost, receiving, dispatch, bottling, fermentation, and operation evidence is retained.
4. Sync uses server baselines, stable fingerprints, bounded deletion tombstones, optimistic versions, and a private deletion ledger. A stale full collection cannot silently resurrect deleted records.
5. Audit records are hash-linked and server-attributed. Clients cannot forge command-owned compound effects through `/api/sync`.
6. Attachments have bounded file/aggregate size, allowlisted MIME and filename rules, and verified checksums. Storage object keys are server-derived.
7. Credentials, session tokens, database URLs, organization ids, command ids, and winery record contents are excluded from public readiness and operational telemetry.

## Required negative tests

The automated suites must reject at least these attack classes:

1. unauthenticated API access and session forgery;
2. cross-organization reads, writes, invitations, command replay, and id collisions;
3. cached-role privilege escalation after a live membership downgrade;
4. replay of a session token after logout, password reset, or an administrative account change;
5. cross-site state-changing requests, covering a foreign `Origin`, `Sec-Fetch-Site: cross-site`, and the opaque `null` origin, without blocking safe methods or header-less non-browser clients;
6. reused command ids with a different command type or request body;
7. concurrent command races that could double-transfer, double-bottle, double-dispatch, or overfill storage/vessels;
8. reversal of a stale command after dependent work has changed the affected state;
9. forged command-owned records or incomplete compound side effects submitted through sync;
10. same-field two-client edits, both edit/delete orderings, delete/delete replay, and stale-record resurrection;
11. malformed, oversized, prototype-polluting, or excessively large sync/command recovery payloads;
12. attachment path traversal, unsupported MIME, mismatched checksum, and excessive inline bytes;
13. brute-force authentication attempts across multiple application instances;
14. request floods against whole-state sync, the full-state read, and the command endpoints, refused before the body is parsed and billed per account rather than per address;
15. model calls beyond the winery's configured daily allowance, including concurrent requests racing the same remaining capacity;
16. a build or generated document that reintroduces inline script, and a policy that loses its strict `script-src` or its reporting sink;
17. schema drift, missing production secrets, unsafe local persistence, and a deployed revision that fails readiness.

## Operational gates

- Pull requests and main pushes run reviewed migrations against disposable PostgreSQL, schema drift detection, tenant/isolation tests, typecheck, unit tests, build, bundle budget, and production boot smoke.
- Deployment uses an immutable image digest. The controlled migration Cloud Run job must execute successfully before service rollout; the deployed digest must pass liveness and readiness.
- Cloud SQL automated backups and PITR policy are enforced before migrations. Restore success is proven separately with the isolated-target procedure in `docs/cloud-sql-recovery-runbook.md`.
- Weekly operations rerun the high-severity production dependency audit and a read-only migration drift check from the exact deployed image.

Any new persistence backend must ship its real server implementation, tenant-isolation tests, backup/restore procedure, readiness semantics, and deployment configuration together. A feature flag or design file alone must never appear as an operationally supported backend.
