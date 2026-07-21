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
      .filter(m => m.lotId === lotId)
      .reduce((total, movement) => {
        // Relocations are not new placements and sales returns are not new
        // production. A bottling reversal is the one outbound fact that must
        // cancel its original inbound receipt for this reconciliation.
        if (movement.direction === 'in'
          && movement.reason !== 'transfer'
          && movement.reason !== 'sale_reversal') return total + movement.bottles;
        if (movement.direction === 'out' && movement.reason === 'bottling_reversal') {
          return total - movement.bottles;
        }
        return total;
      }, 0);
    const remaining = (producedByLot[lotId] || 0) - stored;
    if (remaining > 0) out[lotId] = remaining;
  }
  return out;
}

function safeMovementId(...parts: Array<string | number | undefined>): string {
  const raw = parts.filter(p => p !== undefined && p !== '').join('-') || `mov-${Date.now()}`;
  return raw.replace(/[^\p{L}\p{N}_\- ]/gu, '-').slice(0, 128);
}

export function stockMovementFromBottlingRun(input: {
  runId: string;
  date: string;
  lotId: string;
  locationId: string;
  bottles: number;
  lotName?: string;
}): StockMovement | null {
  const bottles = Math.max(0, Math.floor(input.bottles || 0));
  if (!input.runId || !input.lotId || !input.locationId || bottles <= 0) return null;
  return {
    id: safeMovementId('mov', 'bottling', input.runId),
    date: (input.date || new Date().toISOString()).slice(0, 10),
    lotId: input.lotId,
    locationId: input.locationId,
    direction: 'in',
    bottles,
    reason: 'bottling',
    sourceRef: input.runId,
    note: input.lotName ? `Auto placed from bottling run: ${input.lotName}` : 'Auto placed from bottling run',
  };
}

export function stockMovementFromDispatch(input: {
  dispatchId: string;
  date: string;
  lotId: string;
  locationId: string;
  bottles: number;
  customerName?: string;
}): StockMovement | null {
  const bottles = Math.max(0, Math.floor(input.bottles || 0));
  if (!input.dispatchId || !input.lotId || !input.locationId || bottles <= 0) return null;
  return {
    id: safeMovementId('mov', 'dispatch', input.dispatchId),
    date: (input.date || new Date().toISOString()).slice(0, 10),
    lotId: input.lotId,
    locationId: input.locationId,
    direction: 'out',
    bottles,
    reason: 'sale',
    sourceRef: input.dispatchId,
    note: input.customerName ? `Dispatch to ${input.customerName}` : 'Sales dispatch',
  };
}
