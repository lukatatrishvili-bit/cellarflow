# CellarFlow security and data-integrity specification

This document describes the controls the application actually runs. PostgreSQL is the authoritative production backend; GCS/local JSON are bounded fallback/export modes and are not alternate authorization systems.

## Trust boundaries

- The browser is untrusted. Role labels, organization ids, record ids, timestamps, command receipts, sync baselines, tombstones, and attachment metadata supplied by a client must be revalidated at the server boundary.
- Authentication is established by the server session. Production sessions require a strong `SESSION_SECRET`; account verification, recovery, invitation, Google OAuth, and demo access are governed by server routes and environment policy.
- Authorization comes from the current server-side organization membership, not cached browser state. Role changes take effect on the next request.
- Every operational read or write is scoped to the active organization. Human-readable record ids are never sufficient authority by themselves.
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
4. reused command ids with a different command type or request body;
5. concurrent command races that could double-transfer, double-bottle, double-dispatch, or overfill storage/vessels;
6. reversal of a stale command after dependent work has changed the affected state;
7. forged command-owned records or incomplete compound side effects submitted through sync;
8. same-field two-client edits, both edit/delete orderings, delete/delete replay, and stale-record resurrection;
9. malformed, oversized, prototype-polluting, or excessively large sync/command recovery payloads;
10. attachment path traversal, unsupported MIME, mismatched checksum, and excessive inline bytes;
11. brute-force authentication attempts across multiple application instances;
12. schema drift, missing production secrets, unsafe local persistence, and a deployed revision that fails readiness.

## Operational gates

- Pull requests and main pushes run reviewed migrations against disposable PostgreSQL, schema drift detection, tenant/isolation tests, typecheck, unit tests, build, bundle budget, and production boot smoke.
- Deployment uses an immutable image digest. The controlled migration Cloud Run job must execute successfully before service rollout; the deployed digest must pass liveness and readiness.
- Cloud SQL automated backups and PITR policy are enforced before migrations. Restore success is proven separately with the isolated-target procedure in `docs/cloud-sql-recovery-runbook.md`.
- Weekly operations rerun the high-severity production dependency audit and a read-only migration drift check from the exact deployed image.

Any new persistence backend must ship its real server implementation, tenant-isolation tests, backup/restore procedure, readiness semantics, and deployment configuration together. A feature flag or design file alone must never appear as an operationally supported backend.
