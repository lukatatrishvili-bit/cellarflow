import { describe, expect, it, vi } from 'vitest';
import { clearTenantCachedData } from '../lib/tenantCache';

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
});
