import { describe, expect, it } from 'vitest';
import {
  bottlingPackagingShortfalls,
  compareBottlingRunsNewestFirst,
  newerBottlingRunFor,
} from '../lib/bottlingIntegrity';
import type { BottlingRunRecord, InventoryItem } from '../lib/wineryState';

const run = (id: string, lotId: string, date = '2026-07-18', createdAt?: string): BottlingRunRecord => ({
  id,
  createdAt,
  lotId,
  lotName: lotId,
  date,
  lotNumber: id,
  operator: 'Nino',
  formats: {},
  totalBottles: 0,
  totalCeramic: 0,
  volumeBottledL: 0,
});

describe('bottling rollback chronology', () => {
  it('blocks an older run when a newer run for the same lot survives', () => {
    const history = [run('run-3', 'lot-a'), run('run-2', 'lot-b'), run('run-1', 'lot-a')];

    expect(newerBottlingRunFor(history, 'run-1')?.id).toBe('run-3');
  });

  it('allows the newest run for a lot even when other lots have newer runs', () => {
    const history = [run('run-2', 'lot-b'), run('run-1', 'lot-a')];

    expect(newerBottlingRunFor(history, 'run-1')).toBeNull();
    expect(newerBottlingRunFor(history, 'run-2')).toBeNull();
  });

  it('uses canonical chronology even when merge order is unsorted', () => {
    const older = run('bot-1700000000000', 'lot-a', '2026-08-01');
    const newest = run('legacy-new', 'lot-a', '2026-01-01', '2026-09-10T10:00:00.000Z');
    const middle = run('bot-1750000000000', 'lot-a', '2026-09-01');
    const history = [older, newest, middle];

    expect([...history].sort(compareBottlingRunsNewestFirst).map(item => item.id)).toEqual([
      'legacy-new',
      'bot-1750000000000',
      'bot-1700000000000',
    ]);
    expect(newerBottlingRunFor(history, older.id)?.id).toBe(newest.id);
    expect(newerBottlingRunFor(history, newest.id)).toBeNull();
  });
});

describe('bottling packaging integrity', () => {
  const bottle: InventoryItem = {
    id: 'bottle-750',
    name: '750 ml bottle',
    category: 'bottles',
    stock: 80,
    minThreshold: 20,
    unit: 'pcs',
    costPerUnit: 1,
    supplierName: 'Glass Co',
  };

  it('reports the exact shortfall so bottling can be blocked before mutation', () => {
    expect(bottlingPackagingShortfalls({ [bottle.id]: 100 }, [bottle])).toEqual([{
      item: bottle,
      required: 100,
      available: 80,
    }]);
    expect(bottlingPackagingShortfalls({ [bottle.id]: 80 }, [bottle])).toEqual([]);
  });
});
