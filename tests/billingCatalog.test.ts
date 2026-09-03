import { describe, expect, it } from 'vitest';
import {
  PLAN_CATALOG,
  annualSavingsGel,
  annualSavingsPercent,
  planForProductionLiters,
  priceFor,
  subscriptionPriceMinor,
} from '../lib/billing/planCatalog';
import {
  capacityState,
  changeDirection,
  featureAccessAfterPlanChange,
  hasEntitlement,
  productionLitersForYear,
} from '../lib/billing/subscription';

describe('subscription plan catalogue', () => {
  it('selects inclusive production thresholds and Enterprise above 2,000,000 L', () => {
    expect(planForProductionLiters(25_000)).toBe('micro');
    expect(planForProductionLiters(25_001)).toBe('small');
    expect(planForProductionLiters(100_000)).toBe('small');
    expect(planForProductionLiters(100_001)).toBe('professional');
    expect(planForProductionLiters(500_000)).toBe('professional');
    expect(planForProductionLiters(500_001)).toBe('business');
    expect(planForProductionLiters(2_000_000)).toBe('business');
    expect(planForProductionLiters(2_000_001)).toBe('enterprise');
  });

  it('keeps the exact GEL monthly and annual catalogue prices', () => {
    expect(PLAN_CATALOG.map(plan => [plan.id, plan.monthlyPriceGel, plan.annualPriceGel])).toEqual([
      ['micro', 49, 490],
      ['small', 89, 890],
      ['professional', 149, 1_490],
      ['business', 299, 2_990],
      ['enterprise', null, 5_990],
    ]);
    expect(priceFor('micro', 'monthly')).toBe(49);
    expect(priceFor('business', 'annual')).toBe(2_990);
  });

  it('calculates annual savings from twelve monthly payments', () => {
    expect(annualSavingsGel('micro')).toBe(98);
    expect(annualSavingsGel('small')).toBe(178);
    expect(annualSavingsGel('professional')).toBe(298);
    expect(annualSavingsGel('business')).toBe(598);
    expect(annualSavingsPercent('micro')).toBe(17);
    expect(annualSavingsGel('enterprise')).toBeNull();
  });

  it('resolves standard and negotiated Enterprise prices without inventing a checkout price', () => {
    expect(subscriptionPriceMinor('professional', 'annual')).toBe(149_000);
    expect(subscriptionPriceMinor('enterprise', 'custom')).toBeNull();
    expect(subscriptionPriceMinor('enterprise', 'custom', 725_000)).toBe(725_000);
  });
});

describe('subscription entitlements and capacity', () => {
  it('includes operational core for every plan and gates advanced features', () => {
    for (const plan of PLAN_CATALOG) {
      expect(plan.features).toContain('operational_core');
      expect(plan.features).toContain('unlimited_users');
    }
    expect(hasEntitlement({ planId: 'micro', status: 'active' }, 'advanced_reports')).toBe(false);
    expect(hasEntitlement({ planId: 'professional', status: 'active' }, 'advanced_reports')).toBe(true);
    expect(hasEntitlement({ planId: 'small', status: 'active' }, 'data_import_export')).toBe(true);
    expect(hasEntitlement({ planId: 'business', status: 'active' }, 'audit_dashboards')).toBe(true);
    expect(hasEntitlement({ planId: 'enterprise', status: 'active' }, 'custom_integrations')).toBe(true);
    expect(hasEntitlement({ planId: 'enterprise', status: 'active' }, 'api_access')).toBe(false);
  });

  it('applies negotiated feature overrides and preserves core for expired accounts', () => {
    expect(hasEntitlement({
      planId: 'micro',
      status: 'active',
      featureOverrides: { api_access: true },
    }, 'api_access')).toBe(true);
    expect(hasEntitlement({ planId: 'enterprise', status: 'expired' }, 'api_access')).toBe(false);
    expect(hasEntitlement({ planId: 'enterprise', status: 'expired' }, 'operational_core')).toBe(true);
  });

  it('warns at 80%, escalates at 100%, and never blocks harvest operations', () => {
    const subscription = { planId: 'micro' as const, status: 'active' as const };
    expect(capacityState(19_999, subscription).level).toBe('normal');
    expect(capacityState(20_000, subscription).level).toBe('warning');
    expect(capacityState(25_000, subscription)).toEqual(expect.objectContaining({
      level: 'exceeded',
      requiresUpgrade: true,
      operationsBlocked: false,
    }));
  });

  it('uses capacity overrides and gives Enterprise unlimited capacity', () => {
    expect(capacityState(30_000, {
      planId: 'micro', status: 'active', capacityOverrideLiters: 50_000,
    }).level).toBe('normal');
    expect(capacityState(9_000_000, { planId: 'enterprise', status: 'active' }).limitLiters).toBeNull();
  });

  it('classifies upgrades/downgrades and keeps downgraded advanced data read-only', () => {
    expect(changeDirection('micro', 'business')).toBe('upgrade');
    expect(changeDirection('business', 'small')).toBe('downgrade');
    expect(changeDirection('small', 'small')).toBe('same');
    expect(featureAccessAfterPlanChange({
      previousPlanId: 'business', nextPlanId: 'micro', feature: 'advanced_reports', hasStoredData: true,
    })).toBe('read_only');
    expect(featureAccessAfterPlanChange({
      previousPlanId: 'business', nextPlanId: 'micro', feature: 'advanced_reports', hasStoredData: false,
    })).toBe('hidden');
  });

  it('derives usage from initial lot volume for the active vintage without double-counting transfers', () => {
    expect(productionLitersForYear({
      lots: [
        { vintage: 2026, initialVolume: 12_500 },
        { vintage: 2026, initialVolume: 7_500 },
        { vintage: 2025, initialVolume: 90_000 },
      ],
      transfers: [{ volume: 10_000 }],
    }, 2026)).toBe(20_000);
  });
});
