# Dependency Security Triage

**Last reviewed:** 2026-07-19

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

Eight moderate findings remain for `uuid` versions inherited through ExcelJS
and Google Cloud client libraries. The application does not import `uuid`
directly or call the affected buffer-writing APIs. The automated force fix is
not accepted because npm proposes downgrading ExcelJS across a breaking major
boundary, which would put spreadsheet generation at greater unverified risk.

These findings are temporarily accepted with the following controls:

- high/critical advisories continue to fail CI;
- dependency updates remain covered by the full release gate;
- the audit is reviewed whenever the lockfile changes and at least monthly;
- the exception is removed when compatible upstream releases eliminate the
  vulnerable transitive versions.
