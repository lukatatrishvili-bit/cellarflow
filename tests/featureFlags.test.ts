import { describe, it, expect } from 'vitest';
import { isFeatureEnabled, type Plan } from '../lib/featureFlags';

describe('feature flags', () => {
  it('free plan unlocks no premium features', () => {
    const free: Plan = 'free';
    expect(isFeatureEnabled('offline_field_mode', free)).toBe(false);
    expect(isFeatureEnabled('advanced_reports', free)).toBe(false);
    expect(isFeatureEnabled('multi_company', free)).toBe(false);
  });

  it('business plan unlocks offline field mode and reports', () => {
    const biz: Plan = 'business';
    expect(isFeatureEnabled('offline_field_mode', biz)).toBe(true);
    expect(isFeatureEnabled('advanced_reports', biz)).toBe(true);
    expect(isFeatureEnabled('multi_company', biz)).toBe(true);
  });
});
