import { describe, expect, it } from 'vitest';
import { persistDeletionTombstone } from '../lib/deletionTombstones';
import {
  isFinishedGoodsLot,
  storageLocationReferences,
  storageMovementDeletionBlockers,
  type StockMovement,
} from '../lib/storage';
import type { BottlingRunRecord, SalesDispatchRecord, SalesOrderRecord } from '../lib/wineryState';

const movement = (overrides: Partial<StockMovement> = {}): StockMovement => ({
  id: 'mov-in',
  date: '2027-01-10',
  lotId: 'lot-1',
  locationId: 'loc-1',
  direction: 'in',
  bottles: 100,
  ...overrides,
});

const run = (overrides: Partial<BottlingRunRecord> = {}): BottlingRunRecord => ({
  id: 'run-1',
  lotId: 'lot-1',
  lotName: 'Saperavi',
  date: '2027-01-10',
  lotNumber: 'SAP-27',
  operator: 'Nino',
  formats: { '750ml': 100 },
  totalBottles: 100,
  totalCeramic: 0,
  volumeBottledL: 75,
  ...overrides,
});

const order = (overrides: Partial<SalesOrderRecord> = {}): SalesOrderRecord => ({
  id: 'order-1',
  orderDate: '2027-01-11',
  createdAt: '2027-01-11T09:00:00.000Z',
  customerName: 'Wine Bar',
  lotId: 'lot-1',
  lotName: 'Saperavi',
  locationId: 'loc-1',
  locationName: 'Main Warehouse',
  bottles: 20,
  pricePerBottle: 20,
  currency: 'GEL',
  revenue: 400,
  status: 'reserved',
  operator: 'Nino',
  ...overrides,
});

const dispatch = (overrides: Partial<SalesDispatchRecord> = {}): SalesDispatchRecord => ({
  id: 'dispatch-1',
  date: '2027-01-12',
  customerName: 'Restaurant',
  lotId: 'lot-1',
  lotName: 'Saperavi',
  locationId: 'loc-1',
  locationName: 'Main Warehouse',
  bottles: 10,
  pricePerBottle: 20,
  currency: 'GEL',
  revenue: 200,
  stockMovementId: 'mov-out',
  operator: 'Nino',
  ...overrides,
});

describe('finished-goods lot eligibility', () => {
  it('accepts bottled and partially bottled lots but rejects unbottled bulk wine', () => {
    expect(isFinishedGoodsLot({ id: 'bottled', stage: 'bottled' }, [])).toBe(true);
    expect(isFinishedGoodsLot({ id: 'partial', stage: 'aging' }, [
      { lotId: 'partial', totalBottles: 40, totalCeramic: 0 },
    ])).toBe(true);
    expect(isFinishedGoodsLot({ id: 'bulk', stage: 'fermenting' }, [])).toBe(false);
  });
});

describe('storage deletion integrity', () => {
  it('finds every persisted record type that references a storage location', () => {
    const references = storageLocationReferences('loc-1', {
      movements: [movement()],
      bottlingRuns: [run({ storageLocationId: 'loc-1' })],
      orders: [order()],
      dispatches: [dispatch()],
    });

    expect(references).toEqual({
      movementIds: ['mov-in'],
      bottlingRunIds: ['run-1'],
      salesOrderIds: ['order-1'],
      salesDispatchIds: ['dispatch-1'],
      total: 4,
    });
  });

  it('protects movements linked to bottling and dispatch source records', () => {
    const bottlingMovement = movement({ sourceRef: 'run-1' });
    const bottlingBlockers = storageMovementDeletionBlockers(bottlingMovement.id, {
      movements: [bottlingMovement],
      bottlingRuns: [run()],
      orders: [],
      dispatches: [],
    });
    const outboundMovement = movement({ id: 'mov-out', direction: 'out', bottles: 10, sourceRef: 'dispatch-1' });
    const dispatchBlockers = storageMovementDeletionBlockers(outboundMovement.id, {
      movements: [movement(), outboundMovement],
      bottlingRuns: [],
      orders: [],
      dispatches: [dispatch()],
    });

    expect(bottlingBlockers).toMatchObject({ blocked: true, bottlingRunIds: ['run-1'] });
    expect(dispatchBlockers).toMatchObject({ blocked: true, salesDispatchIds: ['dispatch-1'] });
  });

  it('blocks a deletion that would create negative or under-reserved stock', () => {
    const receipt = movement({ bottles: 100 });
    const outbound = movement({ id: 'mov-out', direction: 'out', bottles: 40 });
    const negative = storageMovementDeletionBlockers(receipt.id, {
      movements: [receipt, outbound],
      bottlingRuns: [],
      orders: [],
      dispatches: [],
    });
    const extraReceipt = movement({ id: 'mov-extra', bottles: 20 });
    const reserved = storageMovementDeletionBlockers(extraReceipt.id, {
      movements: [receipt, extraReceipt],
      bottlingRuns: [],
      orders: [order({ bottles: 110 })],
      dispatches: [],
      asOfDate: '2027-01-12',
    });

    expect(negative).toMatchObject({
      blocked: true,
      remainingOnHandBottles: -40,
      wouldCreateNegativeStock: true,
    });
    expect(reserved).toMatchObject({
      blocked: true,
      remainingOnHandBottles: 100,
      reservedBottles: 110,
      wouldUndercutReservations: true,
    });
  });

  it('allows an unlinked movement deletion when stock and reservations remain valid', () => {
    const receipt = movement({ bottles: 100 });
    const adjustment = movement({ id: 'mov-adjust', direction: 'out', bottles: 10 });
    const blockers = storageMovementDeletionBlockers(adjustment.id, {
      movements: [receipt, adjustment],
      bottlingRuns: [],
      orders: [order({ bottles: 40 })],
      dispatches: [],
      asOfDate: '2027-01-12',
    });

    expect(blockers).toMatchObject({ blocked: false, remainingOnHandBottles: 100, reservedBottles: 40 });
  });
});

describe('storage deletion tombstones', () => {
  it('persists a unique deletion id and repairs malformed stored data', () => {
    const values = new Map<string, string>([['vinea_deleted_ids', '{bad-json']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };

    expect(persistDeletionTombstone('mov-1', storage, 'stockMovements')).toBe(true);
    expect(persistDeletionTombstone('mov-1', storage, 'stockMovements')).toBe(true);
    expect(persistDeletionTombstone('loc-1', storage, 'storageLocations')).toBe(true);
    expect(JSON.parse(values.get('vinea_deleted_ids') || '[]')).toEqual([
      { collection: 'stockMovements', id: 'mov-1' },
      { collection: 'storageLocations', id: 'loc-1' },
    ]);
  });

  it('does not migrate a legacy tombstone into an organization context', () => {
    const values = new Map<string, string>([
      ['vinea_deleted_ids', JSON.stringify(['legacy-delete'])],
      ['cellarflow_org_state_org_id', 'org-1'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };

    expect(persistDeletionTombstone('org-delete', storage, 'stockMovements')).toBe(true);
    expect(JSON.parse(values.get('vinea_deleted_ids') || '[]')).toEqual(['legacy-delete']);
    expect(JSON.parse(values.get('vinea_deleted_ids:org-1') || '[]')).toEqual([
      { collection: 'stockMovements', id: 'org-delete' },
    ]);
  });
});
