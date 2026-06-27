import { describe, expect, it } from 'vitest';
import {
  availableToSell,
  computeDispatchFinancials,
  isActiveReservation,
  reservedBottlesFor,
  reservedByLocationLot,
  type ReservationLike,
} from '../lib/sales';

describe('sales dispatch financials', () => {
  it('computes revenue, COGS, gross profit, and margin', () => {
    expect(computeDispatchFinancials({
      bottles: 120,
      pricePerBottle: 18,
      costPerBottle: 6.5,
    })).toEqual({
      revenue: 2160,
      cogs: 780,
      grossProfit: 1380,
      marginPct: 63.89,
    });
  });

  it('keeps margin unknown when cost per bottle is unavailable', () => {
    expect(computeDispatchFinancials({
      bottles: 100,
      pricePerBottle: 12,
      costPerBottle: null,
    })).toEqual({
      revenue: 1200,
      cogs: 0,
      grossProfit: 0,
      marginPct: null,
    });
  });

  it('guards against negative quantities and prices', () => {
    expect(computeDispatchFinancials({
      bottles: -5,
      pricePerBottle: -10,
      costPerBottle: -1,
    })).toEqual({
      revenue: 0,
      cogs: 0,
      grossProfit: 0,
      marginPct: null,
    });
  });
});

describe('sales reservations', () => {
  const orders: ReservationLike[] = [
    { id: 'so-1', locationId: 'loc-1', lotId: 'LOT-1', bottles: 30, status: 'reserved' },
    { id: 'so-2', locationId: 'loc-1', lotId: 'LOT-1', bottles: 20, status: 'reserved', reservedUntil: '2026-06-30' },
    { id: 'so-3', locationId: 'loc-1', lotId: 'LOT-1', bottles: 10, status: 'fulfilled' },
    { id: 'so-4', locationId: 'loc-1', lotId: 'LOT-2', bottles: 12, status: 'cancelled' },
    { id: 'so-5', locationId: 'loc-2', lotId: 'LOT-1', bottles: 8, status: 'reserved', reservedUntil: '2026-06-01' },
  ];

  it('counts only active reserved orders by location and lot', () => {
    const map = reservedByLocationLot(orders, '2026-06-27');
    expect(map.get('loc-1::LOT-1')?.reservedBottles).toBe(50);
    expect(map.get('loc-1::LOT-2')).toBeUndefined();
    expect(map.get('loc-2::LOT-1')).toBeUndefined();
  });

  it('subtracts reservations from on-hand stock', () => {
    expect(availableToSell({
      onHandBottles: 120,
      orders,
      locationId: 'loc-1',
      lotId: 'LOT-1',
      asOfDate: '2026-06-27',
    })).toBe(70);
  });

  it('can exclude the order being fulfilled so its own reservation remains available', () => {
    expect(availableToSell({
      onHandBottles: 120,
      orders,
      locationId: 'loc-1',
      lotId: 'LOT-1',
      asOfDate: '2026-06-27',
      excludeOrderId: 'so-1',
    })).toBe(100);
  });

  it('treats expired reservations as inactive', () => {
    expect(isActiveReservation(orders[4], '2026-06-27')).toBe(false);
    expect(reservedBottlesFor(orders, 'loc-2', 'LOT-1', '2026-06-27')).toBe(0);
  });
});
