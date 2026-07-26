import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { gzipSync } from 'node:zlib';

/**
 * Bundle budget guard (experience master plan W7: "no bundle regression").
 *
 * Measures the CRITICAL PATH only: chunks referenced directly by
 * dist/index.html (script tags + modulepreloads). Lazy chunks (module tabs,
 * exceljs, RxDB storage) are intentionally excluded — they may grow. The
 * The current ceiling leaves little headroom over the 2026-07 baseline of
 * ~582 KB raw / ~178 KB gzip JS and ~220 KB raw CSS, so it catches a heavy
 * library or translation dictionary accidentally imported into App.tsx.
 *
 * Skips when dist/ is absent (unit-test runs without a build).
 */

const INITIAL_JS_BUDGET_KB = 600;
const INITIAL_CSS_BUDGET_KB = 260;
const INITIAL_JS_GZIP_BUDGET_KB = 190;

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
      prefixes: ['MasterAdminPortal-'],
      rawKB: 120,
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
