import type {
  DispatchFinancialInput,
  DispatchFinancials,
  ReservationLike,
  ReservationPosition,
  StockAvailabilityPosition,
} from './types';

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function positive(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

export function computeDispatchFinancials(input: DispatchFinancialInput): DispatchFinancials {
  const bottles = Math.max(0, Math.floor(input.bottles || 0));
  const pricePerBottle = positive(input.pricePerBottle);
  const costKnown = typeof input.costPerBottle === 'number' && Number.isFinite(input.costPerBottle) && input.costPerBottle >= 0;
  const costPerBottle = costKnown ? input.costPerBottle as number : 0;

  const revenue = round2(bottles * pricePerBottle);
  const cogs = costKnown ? round2(bottles * costPerBottle) : 0;
  const grossProfit = costKnown ? round2(revenue - cogs) : 0;
  const marginPct = costKnown && revenue > 0 ? round2((grossProfit / revenue) * 100) : null;

  return { revenue, cogs, grossProfit, marginPct };
}

export function reservationKey(locationId: string, lotId: string): string {
  return `${locationId}::${lotId}`;
}

export function isActiveReservation(order: ReservationLike, asOfDate = new Date().toISOString().slice(0, 10)): boolean {
  if (!order || order.status !== 'reserved') return false;
  if (!order.locationId || !order.lotId) return false;
  if (!(order.bottles > 0)) return false;
  if (order.reservedUntil && order.reservedUntil < asOfDate) return false;
  return true;
}

export function reservedByLocationLot(
  orders: ReservationLike[],
  asOfDate = new Date().toISOString().slice(0, 10),
  excludeOrderId?: string,
): Map<string, ReservationPosition> {
  const map = new Map<string, ReservationPosition>();
  for (const order of orders || []) {
    if (excludeOrderId && order.id === excludeOrderId) continue;
    if (!isActiveReservation(order, asOfDate)) continue;

    const bottles = Math.max(0, Math.floor(order.bottles || 0));
    const key = reservationKey(order.locationId, order.lotId);
    const current = map.get(key);
    if (current) {
      current.reservedBottles += bottles;
    } else {
      map.set(key, {
        key,
        locationId: order.locationId,
        lotId: order.lotId,
        reservedBottles: bottles,
      });
    }
  }
  return map;
}

export function reservedBottlesFor(
  orders: ReservationLike[],
  locationId: string,
  lotId: string,
  asOfDate = new Date().toISOString().slice(0, 10),
  excludeOrderId?: string,
): number {
  return reservedByLocationLot(orders, asOfDate, excludeOrderId)
    .get(reservationKey(locationId, lotId))?.reservedBottles || 0;
}

export function availableToSell(input: {
  onHandBottles: number;
  orders: ReservationLike[];
  locationId: string;
  lotId: string;
  asOfDate?: string;
  excludeOrderId?: string;
}): number {
  return stockAvailabilityPosition(input).availableBottles;
}

export function stockAvailabilityPosition(input: {
  onHandBottles: number;
  orders: ReservationLike[];
  locationId: string;
  lotId: string;
  asOfDate?: string;
  excludeOrderId?: string;
}): StockAvailabilityPosition {
  const onHand = Math.max(0, Math.floor(input.onHandBottles || 0));
  const reserved = reservedBottlesFor(
    input.orders,
    input.locationId,
    input.lotId,
    input.asOfDate,
    input.excludeOrderId,
  );
  return {
    locationId: input.locationId,
    lotId: input.lotId,
    onHandBottles: onHand,
    reservedBottles: reserved,
    availableBottles: Math.max(0, onHand - reserved),
  };
}
