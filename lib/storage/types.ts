/**
 * Finished-goods (bottled wine) storage model.
 *
 * Bulk wine lives in vessels (already modelled); this tracks *bottled* stock
 * across storage locations via in/out movements. On-hand = Σ in − Σ out per
 * (location, lot), derived purely so it's auditable and testable.
 */

export type StorageType =
  | 'warehouse'
  | 'cellar'
  | 'rack'
  | 'cold_room'
  | 'qvevri_hall'
  | 'other';

export interface StorageLocation {
  id: string;
  name: string;
  type: StorageType;
  capacityBottles?: number;
  targetTempC?: number;
  targetHumidity?: number;
  notes?: string;
}

export interface StockMovement {
  id: string;
  date: string;            // yyyy-mm-dd
  lotId: string;
  locationId: string;
  direction: 'in' | 'out'; // received vs dispatched/sold
  bottles: number;         // always positive; direction sets the sign
  reason?: string;         // bottling | sale | transfer | adjustment | ...
  sourceRef?: string;      // optional linked document/run id, e.g. bottlingRunId
  note?: string;
}

export interface LocationStock {
  locationId: string;
  totalBottles: number;
  byLot: Record<string, number>;
}

export interface LocationUtilization {
  used: number;
  capacity: number | null;
  pct: number | null;       // 0..100, null when no capacity set
  over: boolean;            // used > capacity
}
