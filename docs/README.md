# VinOS documentation index

Every document in `docs/` is listed here with an explicit status, so which one
is authoritative can be read off this page rather than reconstructed from the
supersedes-chain inside each file.

**Status meanings**

| Status | Meaning |
|---|---|
| **Active** | Current and authoritative. Follow it. |
| **Reference** | Describes how something works today. Not a plan; keep it accurate as the code changes. |
| **Historical** | Superseded. Useful as an execution record and for the reasoning behind past decisions — do not plan from it. |

## Plans

| Document | Status | Dated | Notes |
|---|---|---|---|
| [`improvement-plan-2026-07-26.md`](./improvement-plan-2026-07-26.md) | **Active** | 2026-07-26 | The authoritative whole-app improvement and launch plan. When any document below conflicts with it, this one wins. |
| [`improvement-plan.md`](./improvement-plan.md) | **Active** (pointer) | — | Stable filename for bookmarks; forwards to the dated plan above. Holds no plan content of its own. |
| [`ai-process-integration-plan-2026-07-26.md`](./ai-process-integration-plan-2026-07-26.md) | **Active** | 2026-07-26 | Plan for making AI a contextual layer inside each workflow rather than a separate chat surface. Written in Georgian. |
| [`production-readiness-plan.md`](./production-readiness-plan.md) | **Active** | 2026-07-06 | Production readiness evidence and the live checks still outstanding. |
| [`experience-master-plan.md`](./experience-master-plan.md) | **Historical** | 2026-07-06 | Deep experience audit, written as a self-contained execution prompt. Its stack guardrails (animate transform/opacity only, respect reduced motion, no new heavy dependencies, no bundle growth) still hold. |
| [`ui-ux-improvement-plan.md`](./ui-ux-improvement-plan.md) | **Historical** | — | UX backlog evidence, partly delivered. |
| [`design-plan.md`](./design-plan.md) | **Historical** | — | Motion and visual-depth implementation plan ("wow without photos"). |
| [`improvement-plan-2026-07-20.md`](./improvement-plan-2026-07-20.md) | **Historical** | 2026-07-21 | Superseded by the 2026-07-26 plan. |
| [`improvement-plan-2026-07-19.md`](./improvement-plan-2026-07-19.md) | **Historical** | 2026-07-19 | Superseded on 2026-07-20. Retained as the execution record for Milestones 0–1. |

## Operations and recovery

| Document | Status | Notes |
|---|---|---|
| [`cloud-sql-recovery-runbook.md`](./cloud-sql-recovery-runbook.md) | **Active** | Backup policy, isolated restore drill, checksum comparison, RPO/RTO. Tooling implemented 2026-07-20; the live policy verification and first restore drill remain operator actions. |
| [`billing-operations-runbook.md`](./billing-operations-runbook.md) | **Active** | Renewals, callbacks, reconciliation, failures, cancellation, support handling. Code and the scheduled Cloud Run job are implemented; TBC merchant approval, production secrets, and the first observed renewal remain operator actions. |
| [`relational-projection-runbook.md`](./relational-projection-runbook.md) | **Active** | Dry-run drift checks, bounded repair, rollout, rollback. Covers the first tenant-safe relational slice. |
| [`notification-delivery.md`](./notification-delivery.md) | **Active** | Personal channel toggles, task delivery, browser push, email, retries, and deployment configuration. |
| [`ai-intelligence-operations.md`](./ai-intelligence-operations.md) | **Reference** | Winery Intelligence knowledge, delivery, and scheduled operations. Deterministic rules stay authoritative; model analysis is an optional layer around the same validated findings. |
| [`dependency-security.md`](./dependency-security.md) | **Active** | Dependency audit policy and the enforced CI gate. Last reviewed 2026-07-20. |
| [`../deployment_guide.md`](../deployment_guide.md) | **Active** | Google Cloud deployment architecture and repository configuration. |

## Product and domain references

| Document | Status | Notes |
|---|---|---|
| [`../security_spec.md`](../security_spec.md) | **Reference** | Authorization and security contract. |
| [`terroir-pulse.md`](./terroir-pulse.md) | **Reference** | Privacy-preserving regional vineyard aggregation. |
| [`../walkthrough.md`](../walkthrough.md) | **Reference** | Product walkthrough. |
| [`georgian-annexes-source.txt`](./georgian-annexes-source.txt) | **Reference** | Source notes for the Georgian regulatory annexes. |

## Invariants worth knowing before you plan

Constraints that are easy to miss and expensive to violate. Each is enforced by
a test — the test, not this list, is the contract.

- **The audit log is a tamper-evident hash chain.** `buildAuditHashChain`
  asserts `chainSequence === index + 1`, so truncating or windowing `auditLogs`
  makes every remaining entry verify as tampered. It does not degrade the trail;
  it invalidates it. See `lib/retention.ts` and `tests/retention.test.ts`.
- **Sync ceilings are ordered.** The body-byte ceiling binds before the record
  ceilings, and the inline-attachment budget must stay reachable beneath it, or
  its actionable message is replaced by a generic 413. See
  `tests/attachments.test.ts`.
- **Whole-state sync merges by union.** Absent records are never treated as
  deletions — removal requires an explicit tombstone.
- **Collections have two different owners.** Most are edited on the client and
  must be stamped with `lastModified` + `baselineTimestamp` before they sync;
  eight are written only by `/api/commands/*` responses and deliberately expose
  no setter. A client-editable collection missing from the hook's `setters` map
  syncs with no baseline, and `server/sync.ts` then silently takes its
  "last-write-wins, never reported as conflict" path. See
  `lib/collectionRegistry.ts` and `tests/collectionRegistry.test.ts`.
- **`APP_URL` is pinned, not derived from the request host.** Deriving it would
  let a forged `Host` header redirect a password-reset link. The cost is that a
  stale value is silently wrong for everyone, so a mapped custom domain needs
  the `PUBLIC_APP_URL` repository variable. See `tests/deployAppUrl.test.ts`.

## Tried and rejected

Recording these so the next person does not spend the same afternoon.

**Splitting Motion off the critical path with `LazyMotion` (2026-08-04).** The
`vendor-motion` chunk is 110 KB raw / 36 KB gzip of the ~600 KB initial bundle
and looked like the single biggest win available. It did not work:

* `m` imported from `motion/react` still pulls Motion's React integration
  (~100 KB), so the shell gained a `LazyMotion` wrapper and saved nothing —
  599.9 KB vs a 599.6 KB baseline.
* Dropping the `vendor-motion` entry from `manualChunks` so the feature bundle
  could split fragmented the build into ~29 chunks and made the critical path
  *worse* (603.2 KB), because the heavy React integration stayed eager.
* `motion/react-m`, the subpath that exists to avoid exactly this, does not
  export `m` in the types shipped with motion 11.18.2.

The chunk also contains `drag` and `projection` code this app never uses, so
there is probably still a win here — but it needs a Motion upgrade or a
different entry point, not another pass at `manualChunks`. Note that the
implementation lives under `node_modules/framer-motion/`, which the current
`/node_modules/motion/` chunk rule does not match.

Worth knowing before trying again: the app uses `layout` animations in five
places, so `domAnimation` is not sufficient — any split needs `domMax`.

## Maintenance rule

New plans must name the document they supersede, include a status date, and be
listed in the table above with an explicit status. Every file in `docs/` belongs
in this index; an unlisted document is a bug in this page. Live drill evidence
and production identifiers belong in reviewed, redacted operational records —
not in speculative planning documents.
