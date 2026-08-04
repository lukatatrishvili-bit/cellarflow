import { describe, expect, it } from 'vitest';
import { jsonContentEquals, recordContentEquals, SYNC_METADATA_KEYS } from '../lib/recordEquality';

/**
 * These helpers replaced `JSON.stringify(a) !== JSON.stringify(b)` on the hot
 * collection-write path, so the contract under test is that they agree with
 * that comparison — including where its behaviour is surprising. Key ORDER is
 * the one intentional divergence and is asserted separately.
 */
function stringifyEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

describe('jsonContentEquals', () => {
  it('matches primitives the way stringify does', () => {
    const cases: Array<[unknown, unknown]> = [
      ['a', 'a'],
      ['a', 'b'],
      [1, 1],
      [1, 2],
      [true, true],
      [true, false],
      [null, null],
      [null, 0],
      ['1', 1],
      [true, 1],
    ];
    for (const [left, right] of cases) {
      expect(jsonContentEquals(left, right)).toBe(stringifyEquals(left, right));
    }
  });

  it('treats non-finite numbers as equal because both serialize to null', () => {
    expect(stringifyEquals(NaN, Infinity)).toBe(true); // both render as "null"
    expect(jsonContentEquals(NaN, Infinity)).toBe(true);
    expect(jsonContentEquals(NaN, 0)).toBe(false);
  });

  it('treats -0 and 0 as equal because both serialize to 0', () => {
    expect(stringifyEquals(-0, 0)).toBe(true);
    expect(jsonContentEquals(-0, 0)).toBe(true);
  });

  it('ignores keys holding undefined, functions, or symbols', () => {
    const withHoles = { a: 1, b: undefined, c: () => 1, d: Symbol('x') };
    const without = { a: 1 };
    expect(stringifyEquals(withHoles, without)).toBe(true);
    expect(jsonContentEquals(withHoles, without)).toBe(true);
  });

  it('does not confuse a missing key with a different value', () => {
    expect(jsonContentEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonContentEquals({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(jsonContentEquals({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  });

  it('compares nested objects and arrays by content', () => {
    const left = { id: 'l1', readings: [{ brix: 22.4 }, { brix: 21.9 }], meta: { vessel: 'q1' } };
    expect(jsonContentEquals(left, structuredClone(left))).toBe(true);
    expect(jsonContentEquals(left, { ...left, readings: [{ brix: 22.4 }] })).toBe(false);
    expect(jsonContentEquals(left, { ...left, meta: { vessel: 'q2' } })).toBe(false);
  });

  it('distinguishes arrays from objects and respects array order', () => {
    expect(jsonContentEquals([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(jsonContentEquals([1, 2], [2, 1])).toBe(false);
    expect(jsonContentEquals([1, 2], [1, 2])).toBe(true);
  });

  it('ignores key order, unlike stringify', () => {
    const left = { a: 1, b: 2 };
    const right = { b: 2, a: 1 };
    // The deliberate divergence: stringify calls these different.
    expect(stringifyEquals(left, right)).toBe(false);
    expect(jsonContentEquals(left, right)).toBe(true);
  });

  it('falls back to serialization for values outside the JSON data model', () => {
    const date = new Date('2026-03-01T00:00:00.000Z');
    expect(jsonContentEquals(date, new Date('2026-03-01T00:00:00.000Z'))).toBe(true);
    expect(jsonContentEquals(date, new Date('2026-03-02T00:00:00.000Z'))).toBe(false);
    // A Date nested inside a record still resolves correctly.
    expect(jsonContentEquals({ at: date }, { at: new Date('2026-03-01T00:00:00.000Z') })).toBe(true);
  });
});

describe('recordContentEquals', () => {
  const base = { id: 'lot-1', volumeL: 400, variety: 'Saperavi' };

  it('ignores the sync timestamps stamped onto every write', () => {
    expect(recordContentEquals(
      { ...base, lastModified: '2026-01-01T00:00:00.000Z' },
      { ...base, lastModified: '2026-08-03T00:00:00.000Z' },
    )).toBe(true);

    expect(recordContentEquals(
      { ...base, baselineTimestamp: '2026-01-01T00:00:00.000Z' },
      base,
    )).toBe(true);
  });

  it('still reports real content edits', () => {
    expect(recordContentEquals(
      { ...base, lastModified: 'x' },
      { ...base, volumeL: 380, lastModified: 'x' },
    )).toBe(false);
  });

  it('only strips the metadata keys at the top level', () => {
    // A nested record's own lastModified is content, exactly as the previous
    // stringify comparison of the top-level-stripped objects treated it.
    expect(recordContentEquals(
      { ...base, source: { id: 's1', lastModified: 'a' } },
      { ...base, source: { id: 's1', lastModified: 'b' } },
    )).toBe(false);
  });

  it('exposes the metadata key set the call sites strip', () => {
    expect([...SYNC_METADATA_KEYS].sort()).toEqual(['baselineTimestamp', 'lastModified']);
  });

  it('agrees with the stripped-stringify comparison it replaced', () => {
    const strippedStringifyEquals = (left: any, right: any) => {
      const { lastModified: _l, baselineTimestamp: _b, ...a } = left;
      const { lastModified: _l2, baselineTimestamp: _b2, ...b } = right;
      return JSON.stringify(a) === JSON.stringify(b);
    };

    const pairs: Array<[any, any]> = [
      [{ ...base, lastModified: '1' }, { ...base, lastModified: '2' }],
      [{ ...base, lastModified: '1' }, { ...base, volumeL: 1, lastModified: '1' }],
      [{ ...base, notes: '' }, { ...base, notes: '' }],
      [{ ...base, notes: null }, { ...base, notes: null }],
      [{ ...base, tags: ['a', 'b'] }, { ...base, tags: ['a', 'b'] }],
      [{ ...base, tags: ['a', 'b'] }, { ...base, tags: ['b', 'a'] }],
    ];

    for (const [left, right] of pairs) {
      expect(recordContentEquals(left, right)).toBe(strippedStringifyEquals(left, right));
    }
  });
});
