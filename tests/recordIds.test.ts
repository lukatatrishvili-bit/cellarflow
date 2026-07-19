import { describe, expect, it } from 'vitest';
import { createUniqueLotId, createUniqueRecordId } from '../lib/recordIds';

describe('collision-resistant record ids', () => {
  it('uses the full timestamp and entropy for a lot id', () => {
    expect(createUniqueLotId('Saperavi', 2026, [], {
      now: 1_800_000_000_123,
      entropy: 'device-a',
    })).toBe('LOT-SAP-2026-1800000000123-device-a');
  });

  it('adds a deterministic suffix when a generated id already exists', () => {
    const existing = [
      'harv-1800000000123-fixed',
      'harv-1800000000123-fixed-2',
    ];
    expect(createUniqueRecordId('harv', existing, {
      now: 1_800_000_000_123,
      entropy: 'fixed',
    })).toBe('harv-1800000000123-fixed-3');
  });

  it('sanitizes user-derived fragments', () => {
    expect(createUniqueLotId('Rk@  atsiteli', 2027, [], {
      now: 1,
      entropy: 'x!',
    })).toBe('LOT-RKA-2027-1-x');
  });
});
