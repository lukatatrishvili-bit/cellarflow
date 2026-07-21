export type PlanId = 'micro' | 'small' | 'professional' | 'business' | 'enterprise';
export type BillingInterval = 'monthly' | 'annual' | 'custom';

export type BillingFeature =
  | 'operational_core'
  | 'unlimited_users'
  | 'single_site'
  | 'data_import_export'
  | 'custom_fields'
  | 'guided_setup'
  | 'production_cost_tracking'
  | 'advanced_reports'
  | 'workflow_approvals'
  | 'management_tools'
  | 'multi_site'
  | 'advanced_roles'
  | 'audit_dashboards'
  | 'priority_support'
  | 'sso'
  | 'api_access'
  | 'custom_integrations'
  | 'sla'
  | 'dedicated_success'
  | 'multi_company';

export interface LocalizedText {
  en: string;
  ka: string;
}

export interface PlanDefinition {
  id: PlanId;
  rank: number;
  name: LocalizedText;
  productionLimitLiters: number | null;
  monthlyPriceGel: number | null;
  annualPriceGel: number;
  enterpriseStartingPrice: boolean;
  features: readonly BillingFeature[];
  highlights: readonly LocalizedText[];
}

const CORE: BillingFeature[] = ['operational_core', 'unlimited_users', 'single_site'];
const SMALL: BillingFeature[] = [...CORE, 'data_import_export', 'custom_fields', 'guided_setup'];
const PROFESSIONAL: BillingFeature[] = [
  ...SMALL,
  'production_cost_tracking',
  'advanced_reports',
  'workflow_approvals',
  'management_tools',
];
const BUSINESS: BillingFeature[] = [
  ...PROFESSIONAL.filter(feature => feature !== 'single_site'),
  'multi_site',
  'advanced_roles',
  'audit_dashboards',
  'priority_support',
];
const ENTERPRISE: BillingFeature[] = [
  ...BUSINESS,
  'sso',
  'api_access',
  'custom_integrations',
  'sla',
  'dedicated_success',
  'multi_company',
];

/** Single source of truth for public prices, capacity limits, and entitlements. */
export const PLAN_CATALOG: readonly PlanDefinition[] = [
  {
    id: 'micro',
    rank: 1,
    name: { en: 'Micro', ka: 'მიკრო' },
    productionLimitLiters: 25_000,
    monthlyPriceGel: 49,
    annualPriceGel: 490,
    enterpriseStartingPrice: false,
    features: CORE,
    highlights: [
      { en: 'Complete cellar operations', ka: 'მარნის სრული ოპერაციები' },
      { en: 'One winery site', ka: 'ერთი მარნის ლოკაცია' },
      { en: 'Standard support', ka: 'სტანდარტული მხარდაჭერა' },
    ],
  },
  {
    id: 'small',
    rank: 2,
    name: { en: 'Small', ka: 'მცირე' },
    productionLimitLiters: 100_000,
    monthlyPriceGel: 89,
    annualPriceGel: 890,
    enterpriseStartingPrice: false,
    features: SMALL,
    highlights: [
      { en: 'Everything in Micro', ka: 'ყველაფერი მიკრო გეგმიდან' },
      { en: 'Data import and export', ka: 'მონაცემების იმპორტი და ექსპორტი' },
      { en: 'Custom fields and guided setup', ka: 'მორგებული ველები და მართვადი გამართვა' },
    ],
  },
  {
    id: 'professional',
    rank: 3,
    name: { en: 'Professional', ka: 'პროფესიონალური' },
    productionLimitLiters: 500_000,
    monthlyPriceGel: 149,
    annualPriceGel: 1_490,
    enterpriseStartingPrice: false,
    features: PROFESSIONAL,
    highlights: [
      { en: 'Production cost tracking', ka: 'წარმოების ხარჯების აღრიცხვა' },
      { en: 'Advanced reports', ka: 'გაფართოებული ანგარიშები' },
      { en: 'Workflow approvals', ka: 'სამუშაო პროცესების დამტკიცება' },
    ],
  },
  {
    id: 'business',
    rank: 4,
    name: { en: 'Business', ka: 'ბიზნეს' },
    productionLimitLiters: 2_000_000,
    monthlyPriceGel: 299,
    annualPriceGel: 2_990,
    enterpriseStartingPrice: false,
    features: BUSINESS,
    highlights: [
      { en: 'Multi-site management', ka: 'მრავალლოკაციური მართვა' },
      { en: 'Advanced roles and dashboards', ka: 'გაფართოებული როლები და დაფები' },
      { en: 'Priority support', ka: 'პრიორიტეტული მხარდაჭერა' },
    ],
  },
  {
    id: 'enterprise',
    rank: 5,
    name: { en: 'Enterprise', ka: 'კორპორაციული' },
    productionLimitLiters: null,
    monthlyPriceGel: null,
    annualPriceGel: 5_990,
    enterpriseStartingPrice: true,
    features: ENTERPRISE,
    highlights: [
      { en: 'SSO and API access', ka: 'SSO და API წვდომა' },
      { en: 'Custom integrations and SLA', ka: 'მორგებული ინტეგრაციები და SLA' },
      { en: 'Dedicated customer success', ka: 'პერსონალური წარმატების მენეჯერი' },
    ],
  },
] as const;

export const BILLING_FEATURE_LABELS: Record<BillingFeature, LocalizedText> = {
  operational_core: { en: 'Complete operational core', ka: 'სრული საოპერაციო ბირთვი' },
  unlimited_users: { en: 'Unlimited cellar users', ka: 'მარნის შეუზღუდავი მომხმარებლები' },
  single_site: { en: 'One winery site', ka: 'ერთი მარნის ლოკაცია' },
  data_import_export: { en: 'Data import and export', ka: 'მონაცემების იმპორტი და ექსპორტი' },
  custom_fields: { en: 'Custom fields', ka: 'მორგებული ველები' },
  guided_setup: { en: 'Guided setup', ka: 'მართვადი გამართვა' },
  production_cost_tracking: { en: 'Production cost tracking', ka: 'წარმოების ხარჯების აღრიცხვა' },
  advanced_reports: { en: 'Advanced reports', ka: 'გაფართოებული ანგარიშები' },
  workflow_approvals: { en: 'Workflow approvals', ka: 'სამუშაო პროცესების დამტკიცება' },
  management_tools: { en: 'Management tools', ka: 'მართვის ინსტრუმენტები' },
  multi_site: { en: 'Multi-site management', ka: 'მრავალლოკაციური მართვა' },
  advanced_roles: { en: 'Advanced roles and permissions', ka: 'გაფართოებული როლები და უფლებები' },
  audit_dashboards: { en: 'Audit and management dashboards', ka: 'აუდიტისა და მართვის დაფები' },
  priority_support: { en: 'Priority support', ka: 'პრიორიტეტული მხარდაჭერა' },
  sso: { en: 'Single sign-on (SSO)', ka: 'ერთიანი ავტორიზაცია (SSO)' },
  api_access: { en: 'API access', ka: 'API წვდომა' },
  custom_integrations: { en: 'Custom integrations', ka: 'მორგებული ინტეგრაციები' },
  sla: { en: 'Service-level agreement', ka: 'მომსახურების დონის შეთანხმება' },
  dedicated_success: { en: 'Dedicated customer success', ka: 'პერსონალური წარმატების მენეჯერი' },
  multi_company: { en: 'Complex multi-company setup', ka: 'რთული მრავალკომპანიური გამართვა' },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && PLAN_CATALOG.some(plan => plan.id === value);
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === 'monthly' || value === 'annual' || value === 'custom';
}

export function planById(id: PlanId): PlanDefinition {
  const plan = PLAN_CATALOG.find(candidate => candidate.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

export function priceFor(planId: PlanId, interval: BillingInterval): number | null {
  const plan = planById(planId);
  if (interval === 'annual') return plan.annualPriceGel;
  if (interval === 'monthly') return plan.monthlyPriceGel;
  return null;
}

export function subscriptionPriceMinor(
  planId: PlanId,
  interval: BillingInterval,
  customPriceMinor?: number | null,
): number | null {
  if (typeof customPriceMinor === 'number' && Number.isInteger(customPriceMinor) && customPriceMinor >= 0) {
    return customPriceMinor;
  }
  const catalogPrice = priceFor(planId, interval);
  return catalogPrice === null ? null : catalogPrice * 100;
}

export function annualSavingsGel(planId: PlanId): number | null {
  const plan = planById(planId);
  return plan.monthlyPriceGel === null ? null : (plan.monthlyPriceGel * 12) - plan.annualPriceGel;
}

export function annualSavingsPercent(planId: PlanId): number | null {
  const plan = planById(planId);
  if (plan.monthlyPriceGel === null) return null;
  return Math.round((annualSavingsGel(planId)! / (plan.monthlyPriceGel * 12)) * 100);
}

/** Thresholds are inclusive; production above 2,000,000 L is Enterprise. */
export function planForProductionLiters(liters: number): PlanId {
  const safeLiters = Math.max(0, Number.isFinite(liters) ? liters : 0);
  return PLAN_CATALOG.find(plan => (
    plan.productionLimitLiters !== null && safeLiters <= plan.productionLimitLiters
  ))?.id || 'enterprise';
}
