import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readWorkflow = (name: string) => fs.readFileSync(
  path.join(rootDir, '.github', 'workflows', name),
  'utf8',
);
const readRootFile = (name: string) => fs.readFileSync(path.join(rootDir, name), 'utf8');

function expectInOrder(source: string, entries: string[]): void {
  let cursor = -1;
  for (const entry of entries) {
    const next = source.indexOf(entry, cursor + 1);
    expect(next, `Expected ${JSON.stringify(entry)} after offset ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe('release workflow contracts', () => {
  it('runs mandatory release gates for pull requests and main pushes', () => {
    const workflow = readWorkflow('ci.yml');
    const viteConfig = readRootFile('vite.config.ts');

    expect(workflow).toMatch(/pull_request:\s*\n\s+branches: \[main\]/);
    expect(workflow).toMatch(/push:\s*\n\s+branches: \[main\]/);
    expect(workflow).toContain('workflow_call:');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm audit --omit=dev --audit-level=high');
    expect(workflow).toContain('image: postgres:16-alpine');
    expectInOrder(workflow, [
      'npm run db:migrate:deploy',
      'prisma migrate diff',
      'npm run test:postgres',
      'npm run typecheck',
      'npm run lint',
      'npm test',
      'npm run build',
      'npm test -- tests/bundleBudget.test.ts',
      'npm run test:production-smoke',
      'playwright install --with-deps chromium',
      'npm run test:e2e',
    ]);
    expect(viteConfig).toContain("'e2e/**'");
  });

  it('deploys the exact image digest that passed container smoke', () => {
    const workflow = readWorkflow('google-cloud-run.yml');

    expect(workflow).toContain('uses: ./.github/workflows/ci.yml');
    expect(workflow).toContain('name: production');
    expect(workflow).toContain('cancel-in-progress: false');
    expectInOrder(workflow, [
      'needs: verify',
      'docker build --pull',
      'npm run test:production-smoke',
      'docker push "$IMAGE_TAG"',
      "--format='value(image_summary.digest)'",
      'needs: build_image',
      'Enforce Cloud SQL backup and PITR policy',
      '--enable-point-in-time-recovery',
      'Run controlled database migrations',
      '--args "run,db:migrate:deploy"',
      '--execute-now',
      '--wait',
      'Deploy the verified digest',
      '--image "$IMAGE_URI"',
      'Verify deployed digest and health',
    ]);
    expect(workflow).not.toContain('--source .');
    expect(workflow).toContain('[[ "$DEPLOYED_IMAGE" != *@"$IMAGE_DIGEST" ]]');
    expect(workflow).toContain('PRODUCTION_SMOKE_EXPECT_READINESS=not-ready');
    expect(workflow).toContain('--retained-backups-count "$CLOUDSQL_RETAINED_BACKUPS"');
    expect(workflow).toContain('--retained-transaction-log-days "$CLOUDSQL_TRANSACTION_LOG_DAYS"');
    expect(workflow).toContain('--retain-backups-on-delete');
    expect(workflow).toContain('Cloud SQL project and region must match the deployment target.');
    expect(workflow).toContain("WHATSAPP_ENABLED: ${{ vars.WHATSAPP_ENABLED || 'false' }}");
    expect(workflow).toContain('WHATSAPP_WEBHOOK_VERIFY_TOKEN=cellarflow-whatsapp-webhook-verify-token:latest');
    expect(workflow).toContain('WHATSAPP_APP_SECRET=cellarflow-whatsapp-app-secret:latest');
    expect(workflow).toContain("BILLING_ENABLED: ${{ vars.BILLING_ENABLED || 'false' }}");
    expect(workflow).toContain('TBC_CLIENT_SECRET=cellarflow-tbc-client-secret:latest');
    expect(workflow).toContain('BILLING_CRON_SECRET=cellarflow-billing-cron-secret:latest');
    expectInOrder(workflow, [
      '"$SERVICE_URL/api/health"',
      '"$SERVICE_URL/api/ready"',
    ]);
    expect(readRootFile('.dockerignore')).toContain('gha-creds-*.json');
    expect(readRootFile('.gitignore')).toContain('gha-creds-*.json');
  });

  it('never mutates the schema during service startup', () => {
    const dockerfile = readRootFile('Dockerfile');
    const workflow = readWorkflow('google-cloud-run.yml');

    expect(dockerfile).not.toContain('prisma db push');
    expect(dockerfile).toContain('CMD ["node", "--import", "tsx", "server.ts"]');
    expect(workflow).toContain('--remove-env-vars "PRISMA_DB_PUSH_ON_STARTUP"');
    expect(workflow).toContain('--max-retries 0');
    expect(workflow).toContain('PRISMA_BASELINE_EXISTING_SCHEMA=true');
    expect(fs.existsSync(path.join(
      rootDir,
      'prisma',
      'migrations',
      '20260719000000_baseline',
      'migration.sql',
    ))).toBe(true);
  });

  it('audits dependencies and checks production schema drift on a weekly schedule', () => {
    const workflow = readWorkflow('scheduled-operations.yml');

    expect(workflow).toContain("cron: '17 4 * * 1'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('npm audit --omit=dev --audit-level=high');
    expect(workflow).toContain('GCP_CLOUDSQL_INSTANCE');
    expectInOrder(workflow, [
      'status.latestReadyRevisionName',
      'spec.containers[0].image',
      '--args "run,db:check-drift"',
      '--set-secrets "DATABASE_URL=cellarflow-database-url:latest"',
      '--max-retries 0',
      '--execute-now',
      '--wait',
      '--args "run,db:projection-check"',
    ]);
    expect(workflow).not.toContain('db:migrate:deploy');
  });

  it('runs an idempotent billing renewal job every day when billing is enabled', () => {
    const workflow = readWorkflow('scheduled-operations.yml');
    const script = readRootFile('scripts/processBillingRenewals.ts');

    expect(workflow).toContain("cron: '23 3 * * *'");
    expect(workflow).toContain("vars.BILLING_ENABLED == 'true'");
    expect(workflow).toContain('TBC_RECURRING_ENABLED must be true');
    expectInOrder(workflow, [
      'status.latestReadyRevisionName',
      'spec.containers[0].image',
      '--args "run,billing:renewals"',
      'SESSION_SECRET=cellarflow-session-secret:latest',
      'DATABASE_URL=cellarflow-database-url:latest',
      'TBC_API_KEY=cellarflow-tbc-api-key:latest',
      'TBC_CLIENT_ID=cellarflow-tbc-client-id:latest',
      'TBC_CLIENT_SECRET=cellarflow-tbc-client-secret:latest',
      '--max-retries 1',
      '--execute-now',
      '--wait',
    ]);
    expect(script).toContain("process.env.NODE_ENV !== 'production'");
    expect(script).toContain('provider.configured');
    expect(script).toContain('provider.supportsRecurring');
    expect(script).toContain('SESSION_SECRET is required');
    expect(script).toContain('processDueRenewals(provider)');
    expect(script).toContain("operation: 'billing-renewals'");
    expect(script).not.toContain('organizationId');
    expect(script).not.toContain('providerPaymentId');
  });
});
