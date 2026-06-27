import { describe, expect, it } from 'vitest';
import { createEmptyUserData } from '../server/db';

describe('account data schema', () => {
  it('initializes account-backed ERP ledgers for new users', () => {
    const data = createEmptyUserData();
    expect(data.bottlingRuns).toEqual([]);
    expect(data.transfers).toEqual([]);
    expect(data.grapeIntakes).toEqual([]);
    expect(data.cellarOps).toEqual([]);
    expect(data.costEntries).toEqual([]);
    expect(data.winePricing).toEqual({});
    expect(data.storageLocations).toEqual([]);
    expect(data.stockMovements).toEqual([]);
    expect(data.salesDispatches).toEqual([]);
    expect(data.salesOrders).toEqual([]);
  });
});
