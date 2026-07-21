import {
  planById,
  type BillingFeature,
  type BillingInterval,
  type PlanId,
} from './planCatalog';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'grace_period'
  | 'paused'
  | 'canceled'
  | 'expired';

export interface SubscriptionEntitlementInput {
  planId: PlanId;
  status: SubscriptionStatus;
  capacityOverrideLiters?: number | null;
  featureOverrides?: Partial<Record<BillingFeature, boolean>> | null;
  legacyAccess?: boolean;
}

export interface CapacityState {
  usedLiters: number;
  limitLiters: number | null;
  usageRatio: number | null;
  level: 'normal' | 'warning' | 'exceeded';
  requiresUpgrade: boolean;
  operationsBlocked: false;
}

export function effectiveCapacityLimit(input: SubscriptionEntitlementInput): number | null {
  if (typeof input.capacityOverrideLiters === 'number' && input.capacityOverrideLiters >= 0) {
    return input.capacityOverrideLiters;
  }
  return planById(input.planId).productionLimitLiters;
}

export function hasEntitlement(input: SubscriptionEntitlementInput, feature: BillingFeature): boolean {
  const override = input.featureOverrides?.[feature];
  if (typeof override === 'boolean') return override;
  if (input.legacyAccess) return true;
  if (input.status === 'canceled' || input.status === 'expired' || input.status === 'paused') {
    return feature === 'operational_core' || feature === 'unlimited_users';
  }
  return planById(input.planId).features.includes(feature);
}

export function capacityState(
  usedLiters: number,
  input: SubscriptionEntitlementInput,
): CapacityState {
  const used = Math.max(0, Number.isFinite(usedLiters) ? usedLiters : 0);
  const limit = effectiveCapacityLimit(input);
  if (limit === null) {
    return {
      usedLiters: used,
      limitLiters: null,
      usageRatio: null,
      level: 'normal',
      requiresUpgrade: false,
      operationsBlocked: false,
    };
  }
  const ratio = limit === 0 ? (used > 0 ? Number.POSITIVE_INFINITY : 0) : used / limit;
  const level = ratio >= 1 ? 'exceeded' : ratio >= 0.8 ? 'warning' : 'normal';
  return {
    usedLiters: used,
    limitLiters: limit,
    usageRatio: ratio,
    level,
    requiresUpgrade: ratio >= 1,
    // Harvest and cellar operations are deliberately never blocked by capacity.
    operationsBlocked: false,
  };
}

export function addBillingInterval(from: Date, interval: BillingInterval): Date {
  const next = new Date(from);
  if (interval === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1);
  if (interval === 'annual') next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

export function changeDirection(currentPlanId: PlanId, requestedPlanId: PlanId): 'upgrade' | 'downgrade' | 'same' {
  const currentRank = planById(currentPlanId).rank;
  const requestedRank = planById(requestedPlanId).rank;
  return requestedRank > currentRank ? 'upgrade' : requestedRank < currentRank ? 'downgrade' : 'same';
}

/** Advanced data remains available read-only after a downgrade. */
export function featureAccessAfterPlanChange(input: {
  previousPlanId: PlanId;
  nextPlanId: PlanId;
  feature: BillingFeature;
  hasStoredData: boolean;
}): 'enabled' | 'read_only' | 'hidden' {
  const nextHasFeature = planById(input.nextPlanId).features.includes(input.feature);
  if (nextHasFeature) return 'enabled';
  if (input.hasStoredData && planById(input.previousPlanId).features.includes(input.feature)) return 'read_only';
  return 'hidden';
}

/** Derive production by vintage from authoritative lots without counting transfers. */
export function productionLitersForYear(data: unknown, year: number): number {
  if (!data || typeof data !== 'object' || !Array.isArray((data as any).lots)) return 0;
  return (data as any).lots.reduce((total: number, lot: any) => {
    if (Number(lot?.vintage) !== year || lot?.recordKind === 'reversal') return total;
    const initialVolume = Number(lot?.initialVolume);
    return total + (Number.isFinite(initialVolume) && initialVolume > 0 ? initialVolume : 0);
  }, 0);
}
