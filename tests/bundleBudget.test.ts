import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { gzipSync } from 'node:zlib';

/**
 * Bundle budget guard (experience master plan W7: "no bundle regression").
 *
 * Measures the CRITICAL PATH only: chunks referenced directly by
 * dist/index.html (script tags + modulepreloads). Lazy chunks (module tabs,
 * exceljs, RxDB storage) are intentionally excluded — they may grow. It catches
 * a heavy library or translation dictionary accidentally imported into App.tsx.
 *
 * Baseline as of 2026-08-12: ~572 KB raw / ~170 KB gzip JS and ~236 KB raw CSS.
 * The raw-JS margin had previously eroded
 * to 43 bytes, which made the guard useless — any honest change tripped it, and
 * the failure looked like an unrelated regression. It was recovered by letting
 * lucide-react split with its consumers instead of forcing every icon in the
 * app into one eagerly preloaded chunk (see vite.config.ts). Keep real margin
 * here: a budget with no slack gets raised reflexively rather than respected.
 *
 * Skips when dist/ is absent (unit-test runs without a build).
 */

// Raised 600 → 620 on 2026-09-01 after the authenticated shell gained direct
// plan-fulfilment, scan-to-due-work and winery-plan routing. Those coordinators
// must be ready before a destination chunk opens, adding ~8 KB raw but less
// than the existing 190 KB compressed transfer ceiling. Keep the gzip ceiling
// fixed: a heavy eager dependency will still fail the user-visible budget.
const INITIAL_JS_BUDGET_KB = 620;
// The spatial cellar plan intentionally adds a richer tablet interaction
// surface (pinch/pan, minimap, vessel states, and fullscreen controls). Its
// utility CSS is globally emitted by Tailwind even though the plan route is
// lazy. Keep a little raw-size headroom while also enforcing the much more
// representative transfer-size ceiling below.
//
// Raised 270 → 276 on 2026-09-01 for the work-order, blend-trial and bulk-import
// panels — same cause: Tailwind emits their utilities globally even though all
// three routes are lazily loaded. Deliberately a small bump, and the gzip
// ceiling below was NOT moved: it still passes at ~36 KB, which is the number
// that describes what anyone actually downloads. If this needs raising again
// without the gzip figure moving, the right response is to look at why the
// utility surface is growing, not to add another six.
const INITIAL_CSS_BUDGET_KB = 276;
const INITIAL_JS_GZIP_BUDGET_KB = 190;
const INITIAL_CSS_GZIP_BUDGET_KB = 40;

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
  const gzipSizeKB = (refs: string[]) => refs.reduce((sum, ref) => {
    const file = path.join(distDir, ref);
    return sum + (fs.existsSync(file) ? gzipSync(fs.readFileSync(file)).byteLength : 0);
  }, 0) / 1024;

  it('references at least the entry chunk (sanity)', () => {
    expect(assetRefs.some((ref) => ref.endsWith('.js'))).toBe(true);
  });

  it(`keeps critical-path JS under ${INITIAL_JS_BUDGET_KB} KB raw`, () => {
    const js = sizeKB('.js');
    expect(js).toBeGreaterThan(0);
    expect(js).toBeLessThan(INITIAL_JS_BUDGET_KB);
  });

  it(`keeps critical-path JS under ${INITIAL_JS_GZIP_BUDGET_KB} KB gzip`, () => {
    const jsRefs = assetRefs.filter(ref => ref.endsWith('.js'));
    expect(gzipSizeKB(jsRefs)).toBeLessThan(INITIAL_JS_GZIP_BUDGET_KB);
  });

  it(`keeps critical-path CSS under ${INITIAL_CSS_BUDGET_KB} KB raw`, () => {
    expect(sizeKB('.css')).toBeLessThan(INITIAL_CSS_BUDGET_KB);
  });

  it(`keeps critical-path CSS under ${INITIAL_CSS_GZIP_BUDGET_KB} KB gzip`, () => {
    const cssRefs = assetRefs.filter(ref => ref.endsWith('.css'));
    expect(gzipSizeKB(cssRefs)).toBeLessThan(INITIAL_CSS_GZIP_BUDGET_KB);
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

describe.skipIf(!hasBuild)('lazy destination bundle budgets', () => {
  const assets = hasBuild
    ? fs.readdirSync(path.join(distDir, 'assets')).filter(name => name.endsWith('.js'))
    : [];
  const routeBudgets = [
    {
      route: 'vineyard and map',
      prefixes: ['VaziModule-', 'VineyardMap-'],
      rawKB: 625,
      gzipKB: 180,
    },
    {
      route: 'charts',
      prefixes: ['generateCategoricalChart-'],
      rawKB: 350,
      gzipKB: 100,
    },
    {
      route: 'administration',
      // Raised from 120 KB when lucide-react stopped being forced into one
      // eagerly preloaded chunk: this destination now carries the icons it
      // actually uses instead of everyone paying for them at first paint. The
      // cost moved off the critical path, it did not appear. Gzip is unchanged
      // at ~27 KB, which is the number that reflects what users download.
      prefixes: ['MasterAdminPortal-'],
      rawKB: 145,
      gzipKB: 40,
    },
    {
      route: 'documents and export',
      prefixes: ['OfficialDocsTab-', 'exceljs.min-'],
      rawKB: 1_100,
      gzipKB: 350,
    },
    {
      route: 'billing and account',
      prefixes: ['PricingPage-', 'ProfileSettingsTab-'],
      rawKB: 110,
      gzipKB: 35,
    },
  ];

  for (const budget of routeBudgets) {
    it(`keeps ${budget.route} chunks within raw and gzip budgets`, () => {
      const matched = assets.filter(asset => budget.prefixes.some(prefix => asset.startsWith(prefix)));
      expect(matched.length, `Expected chunks for ${budget.route}`).toBeGreaterThan(0);
      const rawBytes = matched.reduce(
        (sum, asset) => sum + fs.statSync(path.join(distDir, 'assets', asset)).size,
        0,
      );
      const gzipBytes = matched.reduce(
        (sum, asset) => sum + gzipSync(fs.readFileSync(path.join(distDir, 'assets', asset))).byteLength,
        0,
      );
      expect(rawBytes / 1024).toBeLessThan(budget.rawKB);
      expect(gzipBytes / 1024).toBeLessThan(budget.gzipKB);
    });
  }
});
