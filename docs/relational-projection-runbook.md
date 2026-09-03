# Vessel and lot relational projection runbook

Status: active for the first tenant-safe relational slice.

The organization JSONB snapshot remains authoritative. Vessel and wine-lot rows
are an atomic relational projection written in the same database transaction as
each JSONB state update. Their business identifiers are unique only inside an
organization.

## Automatic checks

The weekly Scheduled Operations workflow runs:

```text
npm run db:projection-check
```

The command scans up to 100 organizations in organization-ID order, compares
vessel and lot projections, logs counts only, and exits non-zero when any
mismatch remains. Use `--limit=N` (maximum 500) and the returned
`--after=<cursor>` to continue a bounded scan.

## Dry-run investigation

Run from the deployed image or an isolated maintenance environment with
`DATABASE_URL` set:

```text
npm run db:projection-check -- --limit=100
```

The summary never contains record contents. A non-zero mismatch count means the
relational slice must not be used as a read authority.

## Repair

Take or verify a current database backup first. Repairs are idempotent and
organization-scoped, but they replace the relational projection with the
authoritative JSONB vessel/lot state, including removing stale projected rows.

```text
ALLOW_RELATIONAL_PROJECTION_REPAIR=true \
npm run db:projection-check -- --repair --limit=25
```

Repeat with the returned cursor until `hasMore` is false. The command rechecks
every repaired organization and exits non-zero if divergence remains.

## Rollback

Application reads still use JSONB, so rollback is immediate: stop the repair or
scheduled check and deploy the previous application image. Do not reverse the
composite primary-key migration after multiple tenants have reused the same
business identifiers; doing so would be lossy. Restore from backup only in an
isolated recovery environment.
