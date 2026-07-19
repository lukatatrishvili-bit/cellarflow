import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Bundle budget guard (experience master plan W7: "no bundle regression").
 *
 * Measures the CRITICAL PATH only: chunks referenced directly by
 * dist/index.html (script tags + modulepreloads). Lazy chunks (module tabs,
 * exceljs, RxDB storage) are intentionally excluded — they may grow. The
 * budget is deliberately loose (~20% headroom over the 2026-07 baseline of
 * ~494 KB raw JS / ~188 KB CSS) so it only trips on real regressions, e.g. a
 * heavy library accidentally imported eagerly from App.tsx.
 *
 * Skips when dist/ is absent (unit-test runs without a build).
 */

const INITIAL_JS_BUDGET_KB = 600;
const INITIAL_CSS_BUDGET_KB = 260;

const distDir = path.resolve(__dirname, '../dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const hasBuild = fs.existsSync(indexHtmlPath);

describe.skipIf(!hasBuild)('initial bundle budget', () => {
  const html = hasBuild ? fs.readFileSync(indexHtmlPath, 'utf8') : '';
  const assetRefs = [...new Set(html.match(/\/assets\/[a-zA-Z0-9._-]+\.(?:js|css)/g) || [])];

  const sizeKB = (ext: string) =>
    assetRefs
      .filter((ref) => ref.endsWith(ext))
      .reduce((sum, ref) => {
        const file = path.join(distDir, ref);
        return sum + (fs.existsSync(file) ? fs.statSync(file).size : 0);
      }, 0) / 1024;

  it('references at least the entry chunk (sanity)', () => {
    expect(assetRefs.some((ref) => ref.endsWith('.js'))).toBe(true);
  });

  it(`keeps critical-path JS under ${INITIAL_JS_BUDGET_KB} KB raw`, () => {
    const js = sizeKB('.js');
    expect(js).toBeGreaterThan(0);
    expect(js).toBeLessThan(INITIAL_JS_BUDGET_KB);
  });

  it(`keeps critical-path CSS under ${INITIAL_CSS_BUDGET_KB} KB raw`, () => {
    expect(sizeKB('.css')).toBeLessThan(INITIAL_CSS_BUDGET_KB);
  });

  it('keeps heavy lazy libraries out of the critical path', () => {
    // These must always stay behind dynamic import().
    for (const banned of [
      'exceljs',
      'storage-dexie',
      'VaziModule',
      'generateCategoricalChart',
      'AuthAccountFlows',
      'SyncConflictResolutionModal',
    ]) {
      expect(assetRefs.some((ref) => ref.includes(banned))).toBe(false);
    }
  });
});
