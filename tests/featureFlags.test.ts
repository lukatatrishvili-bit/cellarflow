import { describe, it, expect } from 'vitest';
import { isFeatureEnabled, type Plan } from '../lib/featureFlags';

describe('feature flags', () => {
  it('micro plan unlocks no advanced features', () => {
    const micro: Plan = 'micro';
    expect(isFeatureEnabled('offline_field_mode', micro)).toBe(false);
    expect(isFeatureEnabled('advanced_reports', micro)).toBe(false);
    expect(isFeatureEnabled('multi_company', micro)).toBe(false);
  });

  it('business plan unlocks offline field mode and reports but not multi-company', () => {
    const biz: Plan = 'business';
    expect(isFeatureEnabled('offline_field_mode', biz)).toBe(true);
    expect(isFeatureEnabled('advanced_reports', biz)).toBe(true);
    expect(isFeatureEnabled('multi_company', biz)).toBe(false);
    expect(isFeatureEnabled('multi_company', 'enterprise')).toBe(false);
  });
});
