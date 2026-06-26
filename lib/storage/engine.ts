/**
 * Pure derivations over storage movements. No I/O — unit-testable.
 */

import type { StockMovement, LocationStock, StorageLocation, LocationUtilization } from './types';

const signed = (m: StockMovement) => (m.direction === 'in' ? m.bottles : -m.bottles);

/** On-hand bottles per location, broken down by lot. Zeroed lots are dropped. */
export function computeStock(movements: StockMovement[]): Map<string, LocationStock> {
  const map = new Map<string, LocationStock>();
  for (const m of movements) {
    if (!m.locationId || !m.lotId || !m.bottles) continue;
    let loc = map.get(m.locationId);
    if (!loc) { loc = { locationId: m.locationId, totalBottles: 0, byLot: {} }; map.set(m.locationId, loc); }
    loc.byLot[m.lotId] = (loc.byLot[m.lotId] || 0) + signed(m);
  }
  // Recompute totals and prune empty lots.
  for (const loc of map.values()) {
    let total = 0;
    for (const lotId of Object.keys(loc.byLot)) {
      const n = loc.byLot[lotId];
      if (n === 0) delete loc.byLot[lotId];
      else total += n;
    }
    loc.totalBottles = total;
  }
  return map;
}

/** Total bottles of a lot stored across all locations. */
export function lotTotalStored(movements: StockMovement[], lotId: string): number {
  return movements.reduce((acc, m) => (m.lotId === lotId ? acc + signed(m) : acc), 0);
}

export function utilization(stock: LocationStock | undefined, location: StorageLocation): LocationUtilization {
  const used = stock?.totalBottles ?? 0;
  const capacity = location.capacityBottles && location.capacityBottles > 0 ? location.capacityBottles : null;
  const pct = capacity ? Math.round((used / capacity) * 100) : null;
  return { used, capacity, pct, over: capacity != null && used > capacity };
}

/** Bottles produced (from bottling runs) not yet placed into storage. */
export function unstored(producedByLot: Record<string, number>, movements: StockMovement[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const lotId of Object.keys(producedByLot)) {
    const stored = movements
      .filter(m => m.lotId === lotId && m.direction === 'in')
      .reduce((a, m) => a + m.bottles, 0);
    const remaining = (producedByLot[lotId] || 0) - stored;
    if (remaining > 0) out[lotId] = remaining;
  }
  return out;
}
