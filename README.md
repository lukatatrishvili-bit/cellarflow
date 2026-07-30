# VinOS

VinOS is a bilingual English/Georgian winery operations platform spanning vineyard work, harvest and intake, lots and vessels, cellar commands, fermentation, laboratory records, bottling, storage, sales, documents, team permissions, billing, and offline synchronization.

The application is a React 19 PWA served by an Express API. PostgreSQL is the production authority for accounts, per-organization JSONB state, command idempotency, billing, WhatsApp deliveries, and the first tenant-safe relational vessel/lot projection. A local JSON store remains available for development, while Google Cloud Storage can be configured as a backup/export target.

## Local setup

Prerequisites:

- Node.js 20
- npm
- PostgreSQL 16 when testing production persistence; it is optional for the local JSON mode

```powershell
Copy-Item .env.example .env
npm ci
npx --no-install prisma generate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The development server loads `.env`; blank optional integration values keep those features disabled. Do not commit `.env`, database snapshots, credential files, or attachment data.

To use PostgreSQL, set `DATABASE_URL` in `.env`, then apply the committed migrations before starting:

```powershell
npm run db:migrate:deploy
npm run dev
```

For an existing non-empty database created before migration history, follow the reviewed baseline procedure in `deployment_guide.md`; do not set `PRISMA_BASELINE_EXISTING_SCHEMA=true` casually.

## Verification

The normal local release sequence is:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm test -- tests/bundleBudget.test.ts
npm run test:production-smoke
npm run test:e2e
```

The PostgreSQL suite requires a disposable database in `TEST_DATABASE_URL`:

```powershell
npm run test:postgres
```

CI creates PostgreSQL 16, applies migrations, rejects schema drift, runs tenant-isolation and concurrency tests, verifies type/lint/unit contracts, builds, checks raw and gzip bundle budgets, boots the production server, and runs Playwright desktop/mobile journeys with accessibility checks.

## Architecture

- `src/` — application shell, browser routing behavior, crash and performance telemetry
- `components/` — lazy-loaded product modules and shared UI feedback/primitives
- `hooks/` — tenant cache, synchronization, and safe form-draft behavior
- `lib/` — domain models, command contracts, offline queues, permissions, and localization
- `server/routes/` — Express API boundaries
- `server/commands/` — idempotent compound business commands and reversals
- `server/db.ts` — runtime persistence and PostgreSQL JSONB repository
- `server/relationalProjection.ts` — atomic vessel/lot projection, comparison, and repair behavior
- `prisma/` — reviewed schema and forward-only migrations
- `e2e/` and `tests/` — release journeys, contracts, and disposable-PostgreSQL tests

Production health endpoints are `/api/health` for liveness and `/api/ready` for dependency/schema readiness. Readiness intentionally fails closed when PostgreSQL is configured but unavailable or its generated client/schema is incomplete.

## Operations

Start with the [documentation index](docs/README.md). The active references include:

- [App improvement plan](docs/improvement-plan-2026-07-26.md)
- [Cloud SQL recovery runbook](docs/cloud-sql-recovery-runbook.md)
- [Billing operations runbook](docs/billing-operations-runbook.md)
- [WhatsApp task notifications](docs/whatsapp-task-notifications.md)
- [Winery Intelligence knowledge, delivery, and scheduled operations](docs/ai-intelligence-operations.md)
- [Relational projection runbook](docs/relational-projection-runbook.md)
- [Deployment guide](deployment_guide.md)

Production deployment is handled by `.github/workflows/google-cloud-run.yml`. It verifies the exact container image, enforces the Cloud SQL backup/PITR policy, runs migrations as a zero-retry Cloud Run Job, deploys by immutable digest, and verifies the deployed digest plus health endpoints. Scheduled operations run dependency/schema/projection checks and, when explicitly enabled, idempotent billing renewals.

Secrets belong in Google Secret Manager in production. See `.env.example` for the supported configuration contract and each integration runbook for provisioning details.
