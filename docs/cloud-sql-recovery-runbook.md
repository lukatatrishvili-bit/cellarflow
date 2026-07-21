# Cloud SQL backup and recovery runbook

**Status:** policy and checksum tooling implemented locally on 2026-07-20; live policy verification and the first restore drill are still required.

## Recovery contract

The protected Cloud Run deployment enforces this Cloud SQL policy before migrations or application rollout:

- automated backup start window: 02:00 UTC;
- retained automated backups: 30;
- point-in-time recovery: enabled;
- retained transaction logs: seven days;
- backups retained if the source instance is deleted.

The first live deployment containing this policy must retain the successful workflow log and a redacted `gcloud sql instances describe` snapshot as evidence. A configured policy is not a proven restore.

The weekly scheduled operations workflow also requires these GitHub repository variables: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_CLOUD_RUN_SERVICE`, and `GCP_CLOUDSQL_INSTANCE` in `PROJECT:REGION:INSTANCE` form. It reuses the deployment authentication secrets and the `cellarflow-database-url` Secret Manager entry. Missing configuration fails the run rather than silently skipping production drift verification.

## Safety rules

- Never restore into the production/source instance during a drill. A Cloud SQL restore overwrites all data in the target instance and interrupts its connections.
- Use an isolated target whose name ends in `-restore-drill`, has no Cloud Run production service attached, and contains no needed data.
- Confirm source project, region, instance, backup id, target instance, and target label with two people before the restore command.
- Freeze application writes for the short checksum/backup capture window. Without a write freeze, an exact comparison can legitimately differ even when the backup is healthy.
- Never print `DATABASE_URL`, organization ids, organization names, or JSONB contents into workflow logs or drill artifacts.
- Do not automatically delete the restored target. Keep it until the owner accepts the report, then remove it through the normal reviewed infrastructure process.

## Drill procedure

1. Record the UTC drill start time, operator, source revision, source instance, isolated target instance, and the proposed RPO/RTO targets in a copy of the report template below.
2. Verify that the target differs from the source, ends in `-restore-drill`, is disposable, and is not attached to the production Cloud Run service.
3. Freeze writes and capture a privacy-safe source report using a database connection that reaches the source instance:

   ```text
   npm run db:state-checksums -- --output source-organization-state-checksums.json
   ```

4. Create an on-demand Cloud SQL backup while writes remain frozen. Record its backup id, start time, end time, and status. Resume writes only after the backup is `SUCCESSFUL`.
5. Restore that backup into the isolated target. The explicit source flag is required because the target is a different instance:

   ```text
   gcloud sql backups restore BACKUP_ID --project PROJECT_ID --backup-instance SOURCE_INSTANCE --restore-instance TARGET_RESTORE_DRILL_INSTANCE
   ```

6. Start the RTO clock from the agreed incident-detection point. Wait until the target is `RUNNABLE`, then run committed migrations in validation mode only if the restored backup predates the current release. Do not point the production service at the target.
7. Connect `DATABASE_URL` to the restored target and compare its state with the source artifact:

   ```text
   npm run db:state-checksums -- --output restored-organization-state-checksums.json --compare source-organization-state-checksums.json
   ```

   Exit code `0` and `"matches":true` are required. Exit code `2` means at least one organization state changed, disappeared, or appeared unexpectedly. The reports contain only pseudonymous organization keys, versions, timestamps, and SHA-256 checksums.
8. Run the PostgreSQL migration/isolation suite against the restored target only if the target is disposable, then boot the verified image against it and require `/api/ready` to return HTTP 200. Record the image digest and results.
9. Stop the RTO clock when checksum comparison, schema validation, and readiness all pass. Calculate actual RPO from the newest recovered `OrganizationState.updatedAt` and the incident/recovery point defined for the drill.
10. Have the owner accept or reject the measured objectives. Keep the redacted reports and workflow/run logs; delete the isolated target only after acceptance.

## Drill report template

```text
Date (UTC):
Operators/reviewers:
Source project/region/instance:
Source Cloud Run revision and image digest:
Backup id, start, end, status:
Isolated target instance:
Write-freeze start/end:
Recovery validation start/end:
OrganizationState count:
Aggregate source checksum:
Aggregate restored checksum:
Checksum comparison result:
PostgreSQL migration/isolation result:
/api/ready result:
Measured RPO:
Measured RTO:
Accepted RPO/RTO targets:
Owner decision and date:
Follow-ups:
```

## Tool behavior

`db:state-checksums` canonicalizes JSON object keys, preserves array order and primitive types, and hashes every `OrganizationState.data` value. It orders rows by a pseudonymous key before calculating an aggregate hash, so PostgreSQL row order and JSONB object-key order cannot cause false mismatches. Captures made at different wall-clock times can match; stored versions, update timestamps, and data hashes must be identical.
