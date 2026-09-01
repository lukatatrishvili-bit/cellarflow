/**
 * Browser-storage keys holding one organization's data, cleared on logout and
 * on an organization switch.
 *
 * This is a flat list on purpose. `lib/collectionRegistry.ts` is the richer
 * model — it also records each collection's client key and who is allowed to
 * write it — but that metadata is read only by tests, and importing it here put
 * it in the critical-path bundle for every user. A winery tablet on a rural
 * connection should not download a description of the data model.
 *
 * The duplication is safe because it cannot drift: `tests/collectionRegistry.test.ts`
 * asserts this list equals the registry's storage keys plus the non-collection
 * keys below. Add a collection there and this list fails until it matches.
 */
const COLLECTION_STORAGE_KEYS = [
  'cf_vessels',
  'cf_lots',
  'cf_fermlogs',
  'cf_lablogs',
  'cf_inventory',
  'cf_tasks',
  'cf_notes',
  'cf_bottling_history',
  'cf_transfers_history',
  'cf_grape_intakes',
  'cf_cellar_ops',
  'cf_cost_entries',
  'cf_wine_pricing',
  'cf_storage_locations',
  'cf_storage_movements',
  'cf_invoice_receipts',
  'cf_inventory_movements',
  'cf_sales_dispatches',
  'cf_sales_orders',
  'cf_supplier_payments',
  'cf_certification_records',
  'cf_attachments',
  'cf_crm_leads',
  'cf_ai_drafts',
  'cf_quality_sops',
  'cf_purchase_orders',
  'cf_production_plans',
  'cf_recall_cases',
  'cf_work_orders',
  'cf_work_order_templates',
  'cf_blend_trials',
  'vinea_blocks',
  'vinea_projects',
  'vinea_phenology',
  'vinea_sprays',
  'vinea_scoutings',
  'vinea_soil',
  'vinea_samplings',
  'vinea_harvests',
  'vinea_irrigation',
  'vinea_fertilizer',
  'vinea_audit_logs',
] as const;

/** Tenant-scoped keys that are not collections. */
const NON_COLLECTION_TENANT_KEYS = [
  'vinea_company_profile',
  'vinea_last_sync_at',
] as const;

export const TENANT_CACHE_KEYS: readonly string[] = [
  ...COLLECTION_STORAGE_KEYS,
  ...NON_COLLECTION_TENANT_KEYS,
];

export function clearTenantCachedData(storage: Pick<Storage, 'removeItem'>): void {
  TENANT_CACHE_KEYS.forEach(key => storage.removeItem(key));
}
