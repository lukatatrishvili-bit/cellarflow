import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The index is only useful if it is complete. Two documents had drifted out of
 * it before this test existed (`ai-intelligence-operations.md` and
 * `ai-process-integration-plan-2026-07-26.md`), which is exactly the failure
 * mode that makes a reader fall back to guessing which plan is current.
 */

const docsDir = path.resolve(__dirname, '../docs');
const indexPath = path.join(docsDir, 'README.md');
const index = fs.readFileSync(indexPath, 'utf8');

const documents = fs.readdirSync(docsDir)
  .filter(name => name !== 'README.md')
  .filter(name => /\.(md|txt)$/.test(name));

describe('documentation index', () => {
  it('finds documents to check', () => {
    expect(documents.length).toBeGreaterThan(5);
  });

  it.each(documents)('lists %s', (name) => {
    expect(index).toContain(name);
  });

  it('gives every listed document an explicit status', () => {
    // Each document row is a table line; every one must carry a status cell.
    const rows = index.split('\n').filter(line => line.trim().startsWith('| [`'));
    expect(rows.length).toBeGreaterThanOrEqual(documents.length);

    const statuses = ['**Active**', '**Reference**', '**Historical**'];
    for (const row of rows) {
      expect(
        statuses.some(status => row.includes(status)),
        `row without a status: ${row}`,
      ).toBe(true);
    }
  });

  it('names exactly one authoritative whole-app plan', () => {
    expect(index).toContain('improvement-plan-2026-07-26.md');
    expect(index).toMatch(/authoritative whole-app improvement/i);
  });

  it('marks superseded plans historical rather than active', () => {
    for (const superseded of ['improvement-plan-2026-07-19.md', 'improvement-plan-2026-07-20.md']) {
      const row = index.split('\n').find(line => line.includes(superseded) && line.trim().startsWith('| ['));
      expect(row, `no index row for ${superseded}`).toBeDefined();
      expect(row).toContain('**Historical**');
    }
  });
});
