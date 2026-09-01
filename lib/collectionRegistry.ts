/**
 * The one place that says which collections exist, where each is mirrored in
 * browser storage, and — the part that was previously implicit — who is allowed
 * to change it.
 *
 * That last property was discoverable only by noticing which entries were
 * MISSING from a `setters` map buried in `hooks/useWineryState.ts`. Eight
 * collections are absent from it, which reads exactly like an oversight. It is
 * not: those collections are written only by server command responses, so the
 * client has no local edit to stamp. Recording that here means the next reader
 * does not have to re-derive it, and the test beside this file fails if the two
 * ever drift apart.
 *
 * The distinction is load-bearing. `server/sync.ts` uses each record's
 * `baselineTimestamp` for optimistic concurrency; a record that arrives without
 * one takes the branch commented "Legacy fallback: last-write-wins, never
 * reported as conflict." Client-editable collections must therefore be stamped
 * before they sync. Command-driven ones never need it, because the server
 * computed the result and the client only echoes it back.
 */

export type CollectionAuthority =
  /**
   * The client edits these directly. Local writes are stamped with
   * `lastModified` + `baselineTimestamp` so concurrent edits are detected
   * rather than silently overwritten. Each needs an entry in the hook's
   * `setters` map so the stamped value is written back into React state.
   */
  | 'client-editable'
  /**
   * Written only by `/api/commands/*` responses applied through
   * `updateAllStates`. The client never originates an edit, so there is nothing
   * to stamp and no setter is exposed to components.
   */
  | 'server-command';

export interface CollectionDefinition {
  /** Key on the client state object and in the sync payload. */
  readonly key: string;
  /** Browser-storage key holding the tenant's mirror of this collection. */
  readonly storageKey: string;
  readonly authority: CollectionAuthority;
}

export const COLLECTIONS: readonly CollectionDefinition[] = [
  // --- Cellar ---------------------------------------------------------------
  { key: 'vessels', storageKey: 'cf_vessels', authority: 'client-editable' },
  { key: 'lots', storageKey: 'cf_lots', authority: 'client-editable' },
  { key: 'fermLogs', storageKey: 'cf_fermlogs', authority: 'client-editable' },
  { key: 'labLogs', storageKey: 'cf_lablogs', authority: 'client-editable' },
  { key: 'inventory', storageKey: 'cf_inventory', authority: 'client-editable' },
  { key: 'tasks', storageKey: 'cf_tasks', authority: 'client-editable' },
  { key: 'notesList', storageKey: 'cf_notes', authority: 'client-editable' },
  // --- Command-driven cellar and business ledgers ---------------------------
  // A bottling run decrements stock and closes a lot in one server
  // transaction.
  { key: 'bottlingRuns', storageKey: 'cf_bottling_history', authority: 'server-command' },
  // A transfer moves volume between two vessels; the server owns the atomic
  // result and its reversal.
  { key: 'transfers', storageKey: 'cf_transfers_history', authority: 'server-command' },
  // Harvest intake creates lots and cost entries together.
  { key: 'grapeIntakes', storageKey: 'cf_grape_intakes', authority: 'server-command' },
  // Operations deduct additive stock as part of the same command.
  { key: 'cellarOps', storageKey: 'cf_cellar_ops', authority: 'server-command' },
  // Derived from the commands that incur the cost, never entered directly.
  { key: 'costEntries', storageKey: 'cf_cost_entries', authority: 'server-command' },
  // A map rather than a list; maintained alongside costing.
  { key: 'winePricing', storageKey: 'cf_wine_pricing', authority: 'server-command' },
  // Movements reference locations, so the server validates both together.
  { key: 'storageLocations', storageKey: 'cf_storage_locations', authority: 'server-command' },
  // The stock ledger; balances are replayed from it, so the server is the
  // only writer.
  { key: 'stockMovements', storageKey: 'cf_storage_movements', authority: 'server-command' },
  // Purchase invoices and their raw-material movements are immutable command
  // ledgers; the inventory balance is their current projection.
  { key: 'invoiceReceipts', storageKey: 'cf_invoice_receipts', authority: 'server-command' },
  // Each movement is appended by the same atomic receipt/reversal command.
  { key: 'inventoryMovements', storageKey: 'cf_inventory_movements', authority: 'server-command' },
  // --- Sales and compliance -------------------------------------------------
  { key: 'salesDispatches', storageKey: 'cf_sales_dispatches', authority: 'client-editable' },
  { key: 'salesOrders', storageKey: 'cf_sales_orders', authority: 'client-editable' },
  { key: 'supplierPayments', storageKey: 'cf_supplier_payments', authority: 'client-editable' },
  { key: 'certificationRecords', storageKey: 'cf_certification_records', authority: 'client-editable' },
  { key: 'attachments', storageKey: 'cf_attachments', authority: 'client-editable' },
  { key: 'crmLeads', storageKey: 'cf_crm_leads', authority: 'client-editable' },
  { key: 'aiDrafts', storageKey: 'cf_ai_drafts', authority: 'client-editable' },
  // --- Operational control -------------------------------------------------
  { key: 'qualitySops', storageKey: 'cf_quality_sops', authority: 'client-editable' },
  { key: 'purchaseOrders', storageKey: 'cf_purchase_orders', authority: 'client-editable' },
  { key: 'productionPlans', storageKey: 'cf_production_plans', authority: 'client-editable' },
  { key: 'recallCases', storageKey: 'cf_recall_cases', authority: 'client-editable' },
  { key: 'workOrders', storageKey: 'cf_work_orders', authority: 'client-editable' },
  { key: 'workOrderTemplates', storageKey: 'cf_work_order_templates', authority: 'client-editable' },
  { key: 'blendTrials', storageKey: 'cf_blend_trials', authority: 'client-editable' },
  // --- Vineyard -------------------------------------------------------------
  { key: 'blocks', storageKey: 'vinea_blocks', authority: 'client-editable' },
  { key: 'vineyardProjects', storageKey: 'vinea_projects', authority: 'client-editable' },
  { key: 'phenologyLogs', storageKey: 'vinea_phenology', authority: 'client-editable' },
  { key: 'sprays', storageKey: 'vinea_sprays', authority: 'client-editable' },
  { key: 'scoutings', storageKey: 'vinea_scoutings', authority: 'client-editable' },
  { key: 'soilRecords', storageKey: 'vinea_soil', authority: 'client-editable' },
  { key: 'samplings', storageKey: 'vinea_samplings', authority: 'client-editable' },
  { key: 'harvests', storageKey: 'vinea_harvests', authority: 'client-editable' },
  { key: 'irrigationLogs', storageKey: 'vinea_irrigation', authority: 'client-editable' },
  { key: 'fertilizerLogs', storageKey: 'vinea_fertilizer', authority: 'client-editable' },
  // --- Audit ----------------------------------------------------------------
  // Appended by the client, then hash-chained. See lib/retention.ts — never
  // truncate.
  { key: 'auditLogs', storageKey: 'vinea_audit_logs', authority: 'client-editable' },
] as const;

export function collectionKeys(): string[] {
  return COLLECTIONS.map(collection => collection.key);
}

/** Collections the client edits directly, which must be stamped before syncing. */
export function clientEditableCollectionKeys(): string[] {
  return COLLECTIONS.filter(c => c.authority === 'client-editable').map(c => c.key);
}

/** Collections written only by server command responses. */
export function serverCommandCollectionKeys(): string[] {
  return COLLECTIONS.filter(c => c.authority === 'server-command').map(c => c.key);
}

/** Browser-storage keys holding tenant collection data. */
export function collectionStorageKeys(): string[] {
  return COLLECTIONS.map(collection => collection.storageKey);
}

export function collectionForKey(key: string): CollectionDefinition | undefined {
  return COLLECTIONS.find(collection => collection.key === key);
}
