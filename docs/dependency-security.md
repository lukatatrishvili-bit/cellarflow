# Dependency Security Triage

**Last reviewed:** 2026-07-20

## Enforced gate

CI runs:

```bash
npm audit --omit=dev --audit-level=high
```

High and critical production advisories block pull requests, `main` pushes, and
production deployment. Audit findings do not trigger automatic dependency
upgrades; lockfile changes must pass the normal typecheck, tests, production
build, bundle budget, and boot smoke.

## Current disposition

`npm audit fix --package-lock-only` upgraded compatible transitive versions of
Vite, esbuild, RxDB, `ws`, and `protobufjs`, removing the high-severity findings.

Six moderate findings remain for `uuid` versions inherited through ExcelJS and
the active Google Cloud Storage client. The application does not import `uuid`
directly; inspection of the installed consumers shows they use `uuid.v4()`,
while the advisory concerns caller-provided buffers in v3/v5/v6. The automated
force fix is not accepted because npm proposes downgrading ExcelJS across a
breaking major boundary, which would put spreadsheet generation at greater
unverified risk.

The unused `@google-cloud/firestore` package was removed on 2026-07-20 together
with 27 transitive packages, reducing the moderate finding count from eight to
six. Its unused blueprint, rules, environment flag, and deployment-status mode
were also removed so Firestore can no longer appear as an implemented backend.

These findings are temporarily accepted with the following controls:

- high/critical advisories continue to fail CI;
- dependency updates remain covered by the full release gate;
- the audit is reviewed whenever the lockfile changes and every Monday by the
  scheduled operations workflow;
- the exception is removed when compatible upstream releases eliminate the
  vulnerable transitive versions.

## External credential follow-ups

Still requires owner/GCP-console confirmation; no completion is inferred from
code changes:

- confirm the stale `cellarflow` Cloud Run service in `us-central1` is deleted;
- rotate the Google OAuth client secret exposed by that legacy service and
  update `cellarflow-google-client-secret` in Secret Manager;
- rotate the Gmail SMTP app password and update `cellarflow-smtp-pass` in
  Secret Manager;
- record the confirmation date and reviewer here after the deployed service
  passes `/api/ready` with the rotated credentials.
