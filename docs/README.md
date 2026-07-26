# VinOS documentation index

## Active plans

- `improvement-plan-2026-07-26.md` — current whole-app improvement and launch plan
- `production-readiness-plan.md` — production readiness evidence and remaining live checks

`improvement-plan.md`, `improvement-plan-2026-07-19.md`, `improvement-plan-2026-07-20.md`, `experience-master-plan.md`, `ui-ux-improvement-plan.md`, and `design-plan.md` are historical inputs. When they conflict, the 2026-07-26 plan is authoritative.

## Operations and recovery

- `cloud-sql-recovery-runbook.md` — backup policy, isolated restore drill, checksum comparison, and RPO/RTO report
- `billing-operations-runbook.md` — renewals, callbacks, reconciliation, failures, cancellation, and support handling
- `whatsapp-task-notifications.md` — Meta template, webhook verification, delivery tracking, retries, and deployment configuration
- `relational-projection-runbook.md` — dry-run drift checks, bounded repair, rollout, and rollback
- `dependency-security.md` — dependency audit policy
- `../deployment_guide.md` — Google Cloud deployment architecture and repository configuration

## Product and domain references

- `terroir-pulse.md` — privacy-preserving regional vineyard aggregation
- `georgian-annexes-source.txt` — source notes for Georgian regulatory annexes
- `../security_spec.md` — authorization and security contract
- `../walkthrough.md` — product walkthrough

## Maintenance rule

New plans must name the document they supersede, include a status date, and link from this index. Live drill evidence and production identifiers belong in reviewed, redacted operational records—not in speculative planning documents.
