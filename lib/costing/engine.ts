/**
 * Pure cost-accounting engine. No I/O, no app imports — fully unit-testable.
 * All money is rounded to 2 dp on every operation to avoid float drift.
 */

import type {
  CostEntry, CostCategory, LotCostSummary, CostableLot, BlendComponent,
} from './types';

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Per-lot cost broken down by category, with a total. Direct ledger sum. */
export function summarizeLot(lotId: string, entries: CostEntry[]): LotCostSummary {
  const byCategory: Partial<Record<CostCategory, number>> = {};
  let total = 0;
  for (const e of entries) {
    if (e.lotId !== lotId) continue;
    byCategory[e.category] = round2((byCategory[e.category] || 0) + e.amount);
    total = round2(total + e.amount);
  }
  return { lotId, byCategory, total, perLitre: null, perBottle: null };
}

/** Cost per unit (litre/bottle); null when the denominator is unknown/zero. */
export function perUnit(total: number, units: number | undefined): number | null {
  if (!units || units <= 0) return null;
  return round2(total / units);
}

/** Gross margin %: (price − cost) / price × 100. Null when price ≤ 0. */
export function marginPct(pricePerBottle: number, costPerBottle: number): number | null {
  if (!pricePerBottle || pricePerBottle <= 0) return null;
  return round2(((pricePerBottle - costPerBottle) / pricePerBottle) * 100);
}

/** Finished-goods valuation for a quantity on hand at a unit cost. */
export function valuation(bottlesOnHand: number, costPerBottle: number): number {
  if (!bottlesOnHand || bottlesOnHand <= 0) return 0;
  return round2(bottlesOnHand * costPerBottle);
}

/** Gross profit = (price − cost) × bottles. */
export function grossProfit(pricePerBottle: number, costPerBottle: number, bottles: number): number {
  if (!bottles || bottles <= 0) return 0;
  return round2((pricePerBottle - costPerBottle) * bottles);
}

/**
 * Roll up every lot's costs and derive per-litre / per-bottle.
 * `bottlesByLot` overrides a lot's own `bottles` when provided (e.g. from
 * recorded bottling runs).
 */
export function rollupLots(
  lots: CostableLot[],
  entries: CostEntry[],
  bottlesByLot?: Record<string, number>,
): Map<string, LotCostSummary> {
  const out = new Map<string, LotCostSummary>();
  for (const lot of lots) {
    const s = summarizeLot(lot.id, entries);
    s.perLitre = perUnit(s.total, lot.volumeLitres);
    const bottles = bottlesByLot?.[lot.id] ?? lot.bottles;
    s.perBottle = perUnit(s.total, bottles);
    out.set(lot.id, s);
  }
  return out;
}

let blendSeq = 0;
/**
 * Compute the paired ledger entries for a blend (weighted-average cost):
 * each source contributes cost ∝ volumeMoved / lotVolume as a negative
 * `blend_out`, and the destination receives the sum as one `blend_in`.
 * Returns entries to append to the ledger — the rollup then just sums them.
 */
export function computeBlendTransfers(input: {
  destLotId: string;
  date: string;
  currency: string;
  components: BlendComponent[];
  createdBy?: string;
}): CostEntry[] {
  const { destLotId, date, currency, components, createdBy } = input;
  const entries: CostEntry[] = [];
  let received = 0;

  for (const c of components) {
    if (c.lotId === destLotId) continue;
    const moved = c.lotVolume > 0 ? Math.min(c.volumeMoved, c.lotVolume) : 0;
    const pulled = c.lotVolume > 0 ? round2(c.lotTotalCost * (moved / c.lotVolume)) : 0;
    if (pulled === 0) continue;
    received = round2(received + pulled);
    entries.push({
      id: `blend-out-${date}-${c.lotId}-${++blendSeq}`,
      date, lotId: c.lotId, category: 'blend_out',
      description: `Blended into ${destLotId}`,
      amount: -pulled, currency, quantity: moved, createdBy,
      sourceRef: destLotId,
    });
  }

  if (received > 0) {
    entries.push({
      id: `blend-in-${date}-${destLotId}-${++blendSeq}`,
      date, lotId: destLotId, category: 'blend_in',
      description: `Cost received from ${components.filter(c => c.lotId !== destLotId).length} component(s)`,
      amount: received, currency, createdBy,
    });
  }
  return entries;
}

/** Sum a ledger total across categories (e.g. for a period or whole cellar). */
export function totalLedger(entries: CostEntry[]): number {
  return round2(entries.reduce((acc, e) => acc + e.amount, 0));
}
