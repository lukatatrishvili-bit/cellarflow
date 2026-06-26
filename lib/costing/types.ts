/**
 * Cost-accounting model for MaraniOS.
 *
 * Everything is a CostEntry posted against a wine lot. Cost-per-lot is the sum
 * of its entries; cost-per-litre and cost-per-bottle are derived; blends move
 * cost between lots as paired blend_out/blend_in entries (weighted-average
 * cost). Keeping a single immutable ledger makes every report a pure rollup and
 * keeps the numbers auditable.
 */

export type CostCategory =
  | 'grape'       // fruit: own-block allocation or purchased grapes
  | 'additive'    // yeast, nutrients, SO2, bentonite, enzymes, etc.
  | 'packaging'   // bottle, cork, capsule, label, box
  | 'labor'       // hours × rate, or flat service cost
  | 'bottling'    // bottling line / service
  | 'energy'      // power, cooling, heating
  | 'overhead'    // indirect / allocated
  | 'blend_in'    // cost received when this lot is the blend destination
  | 'blend_out'   // cost moved out when this lot feeds a blend (negative)
  | 'other';

export interface CostEntry {
  id: string;
  date: string;            // yyyy-mm-dd
  lotId: string;           // the lot this cost is attributed to
  category: CostCategory;
  description: string;
  amount: number;          // major currency units, 2 dp (negative for blend_out)
  currency: string;        // ISO-ish code, e.g. 'GEL', 'EUR', 'USD'
  quantity?: number;       // optional: units consumed (for audit)
  unitCost?: number;       // optional: cost per unit (for audit)
  sourceRef?: string;      // optional: inventoryItemId / harvestId / bottlingRunId / laborId
  createdBy?: string;
}

export interface LotCostSummary {
  lotId: string;
  byCategory: Partial<Record<CostCategory, number>>;
  total: number;
  perLitre: number | null;  // null when volume is unknown / zero
  perBottle: number | null; // null when bottle count is unknown / zero
}

/** Minimal lot shape the rollup needs (decoupled from the app's WineLot). */
export interface CostableLot {
  id: string;
  volumeLitres: number;
  bottles?: number;
}

/** One component feeding a blend. */
export interface BlendComponent {
  lotId: string;
  volumeMoved: number;   // litres moved from this source into the blend
  lotTotalCost: number;  // source lot's accumulated cost at blend time
  lotVolume: number;     // source lot's volume at blend time (for WAC)
}
