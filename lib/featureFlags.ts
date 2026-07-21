/**
 * Compatibility adapter for older client-only flags. Authoritative plan and
 * entitlement checks now live in the centralized catalogue and are enforced
 * by the server. No plan is read from or written to localStorage.
 */
import { planById, type PlanId } from './billing/planCatalog';

export type Plan = PlanId;

export type Feature =
  | 'offline_field_mode'   // touch capture + background sync in the field
  | 'advanced_reports'     // cost/margin XLSX, valuation exports
  | 'multi_company';       // managing multiple wineries

export function getPlan(): Plan {
  return 'micro';
}

export function setPlan(_plan: Plan): void {
  // Deliberate no-op: a browser must never be able to grant itself a plan.
}

export function isFeatureEnabled(feature: Feature, plan: Plan = getPlan()): boolean {
  const definition = planById(plan);
  if (feature === 'offline_field_mode') return definition.rank >= planById('business').rank;
  if (feature === 'advanced_reports') return definition.features.includes('advanced_reports');
  return definition.features.includes('multi_company');
}
