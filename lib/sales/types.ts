export interface DispatchFinancialInput {
  bottles: number;
  pricePerBottle: number;
  costPerBottle?: number | null;
}

export interface DispatchFinancials {
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number | null;
}

export type ReservationStatus = 'reserved' | 'fulfilled' | 'cancelled';

export interface ReservationLike {
  id: string;
  locationId: string;
  lotId: string;
  bottles: number;
  status: ReservationStatus;
  reservedUntil?: string;
}

export interface ReservationPosition {
  key: string;
  locationId: string;
  lotId: string;
  reservedBottles: number;
}

export interface StockAvailabilityPosition {
  locationId: string;
  lotId: string;
  onHandBottles: number;
  reservedBottles: number;
  availableBottles: number;
}
