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
    expectInOrder(workflow, [
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
      '--image "$IMAGE_URI"',
      'Verify deployed digest and health',
    ]);
    expect(workflow).not.toContain('--source .');
    expect(workflow).toContain('[[ "$DEPLOYED_IMAGE" != *@"$IMAGE_DIGEST" ]]');
    expect(readRootFile('.dockerignore')).toContain('gha-creds-*.json');
    expect(readRootFile('.gitignore')).toContain('gha-creds-*.json');
  });
});
