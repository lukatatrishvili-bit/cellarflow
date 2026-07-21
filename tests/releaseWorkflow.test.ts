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
    ]);
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
    ]);
    expect(workflow).not.toContain('db:migrate:deploy');
  });
});
