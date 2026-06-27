/**
 * Plan-based feature gating. Lets capabilities (e.g. offline field mode) ship as
 * Business-plan features without scattering plan checks across the app.
 *
 * The plan is stored locally for now (cf_plan); when billing exists it should be
 * derived from the authenticated user/subscription instead.
 */

export type Plan = 'free' | 'business';

export type Feature =
  | 'offline_field_mode'   // touch capture + background sync in the field
  | 'advanced_reports'     // cost/margin XLSX, valuation exports
  | 'multi_company';       // managing multiple wineries

const PLAN_FEATURES: Record<Plan, Feature[]> = {
  free: [],
  business: ['offline_field_mode', 'advanced_reports', 'multi_company'],
};

export function getPlan(): Plan {
  try {
    return (localStorage.getItem('cf_plan') as Plan) === 'business' ? 'business' : 'free';
  } catch {
    return 'free';
  }
}

export function setPlan(plan: Plan): void {
  try { localStorage.setItem('cf_plan', plan); } catch { /* ignore */ }
}

export function isFeatureEnabled(feature: Feature, plan: Plan = getPlan()): boolean {
  return PLAN_FEATURES[plan].includes(feature);
}
