import { describe, expect, it, vi } from 'vitest';
import { clearTenantCachedData, TENANT_CACHE_KEYS } from '../lib/tenantCache';
import { collectionStorageKeys } from '../lib/collectionRegistry';

describe('clearTenantCachedData', () => {
  it('clears winery-scoped caches without touching unrelated preferences', () => {
    const removeItem = vi.fn();

    clearTenantCachedData({ removeItem });

    const removedKeys = removeItem.mock.calls.map(([key]) => key);
    expect(removedKeys).toContain('cf_vessels');
    expect(removedKeys).toContain('cf_lots');
    expect(removedKeys).toContain('cf_cellar_ops');
    expect(removedKeys).toContain('vinea_company_profile');
    expect(removedKeys).not.toContain('vinea_theme');
    expect(removedKeys).not.toContain('vinea_lang');
  });

  it('clears every registered collection, not a hand-maintained subset', () => {
    const removeItem = vi.fn();
    clearTenantCachedData({ removeItem });
    const removedKeys = new Set(removeItem.mock.calls.map(([key]) => key));

    // A collection missing here leaks the previous tenant's records into the
    // next workspace after an organization switch, with nothing to signal it.
    for (const storageKey of collectionStorageKeys()) {
      expect(removedKeys.has(storageKey), `${storageKey} was not cleared`).toBe(true);
    }
  });

  it('preserves user preferences that are not tenant data', () => {
    // Language and theme belong to the person, not the winery, and must survive
    // an organization switch.
    for (const preference of ['vinea_lang', 'vinea_theme', 'vinea_is_logged_in']) {
      expect(TENANT_CACHE_KEYS).not.toContain(preference);
    }
  });
});
