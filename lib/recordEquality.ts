/**
 * Exact JSON-value equality without serializing.
 *
 * `hooks/useWineryState` compares every record against its previous version on
 * every collection write, and used `JSON.stringify(a) !== JSON.stringify(b)` to
 * do it. That allocated two strings per record per write: a sync response that
 * touches 33 collections re-ran the comparison across every record in each one,
 * so a winery with a few thousand audit and fermentation entries paid tens of
 * thousands of serializations on the main thread — on the cheap cellar tablets
 * the product targets.
 *
 * These helpers answer the same question by walking the values directly and
 * stopping at the first difference, which is what makes them cheap: an
 * unchanged record usually differs in no field, and a changed one usually
 * differs early.
 *
 * They reproduce `JSON.stringify` semantics rather than structural equality,
 * because that is the behaviour the call sites were built around:
 *
 * - keys holding `undefined`, functions, or symbols are dropped, so `{a: 1}`
 *   and `{a: 1, b: undefined}` are equal;
 * - non-finite numbers serialize to `null`, so `NaN` equals `Infinity`;
 * - `-0` serializes to `0`, so it equals `0`.
 *
 * One deliberate difference: key ORDER is ignored. `JSON.stringify` is
 * order-sensitive, so rebuilding a record with its fields spread in a different
 * order used to read as a content change and mark the collection dirty. Ignoring
 * order removes that spurious sync traffic; it can never hide a real edit.
 *
 * Values outside the JSON data model (`Date`, class instances — anything with a
 * custom prototype or a `toJSON`) fall back to serializing that subtree, so
 * exactness never depends on this module anticipating every shape.
 */

/** Sync bookkeeping that must not count as a content change. */
export const SYNC_METADATA_KEYS: ReadonlySet<string> = new Set([
  'lastModified',
  'baselineTimestamp',
]);

/** True when JSON.stringify would omit an object entry holding this value. */
function isOmittedByJson(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

/** True for values this module can compare directly rather than by serializing. */
function isPlainJsonContainer(value: object): boolean {
  if (Array.isArray(value)) return true;
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function countSignificantKeys(value: Record<string, unknown>, ignoredKeys?: ReadonlySet<string>): number {
  let count = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (ignoredKeys?.has(key)) continue;
    if (isOmittedByJson(value[key])) continue;
    count += 1;
  }
  return count;
}

/**
 * Compare two values the way `JSON.stringify` equality would, ignoring the
 * named keys at the TOP level only (nested records keep their own metadata,
 * exactly as a stringify comparison of the stripped objects would).
 */
export function jsonContentEquals(
  left: unknown,
  right: unknown,
  ignoredKeys?: ReadonlySet<string>,
): boolean {
  if (left === right) return true; // covers identical primitives and same-reference objects

  const leftType = typeof left;
  if (leftType !== typeof right) return false;

  if (leftType === 'number') {
    const a = left as number;
    const b = right as number;
    // Both serialize to `null` when non-finite, so they are indistinguishable.
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return !Number.isFinite(a) && !Number.isFinite(b);
    }
    return a === b; // `-0 === 0`, matching their shared `0` serialization
  }

  // Remaining primitives were settled by the identity check above.
  if (leftType !== 'object') return false;
  if (left === null || right === null) return false;

  const leftObject = left as object;
  const rightObject = right as object;

  if (!isPlainJsonContainer(leftObject) || !isPlainJsonContainer(rightObject)) {
    // Dates, class instances, anything with toJSON: defer to the real thing.
    return JSON.stringify(left) === JSON.stringify(right);
  }

  const leftIsArray = Array.isArray(leftObject);
  if (leftIsArray !== Array.isArray(rightObject)) return false;

  if (leftIsArray) {
    const a = leftObject as unknown[];
    const b = rightObject as unknown[];
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      // Array holes and `undefined` entries both serialize to `null`.
      if (!jsonContentEquals(a[index], b[index])) return false;
    }
    return true;
  }

  const a = leftObject as Record<string, unknown>;
  const b = rightObject as Record<string, unknown>;
  if (countSignificantKeys(a, ignoredKeys) !== countSignificantKeys(b, ignoredKeys)) return false;

  for (const key in a) {
    if (!Object.prototype.hasOwnProperty.call(a, key)) continue;
    if (ignoredKeys?.has(key)) continue;
    const valueA = a[key];
    if (isOmittedByJson(valueA)) continue;
    // Key counts already match, so a key missing on the right is a difference.
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!jsonContentEquals(valueA, b[key])) return false;
  }
  return true;
}

/**
 * True when two records carry the same content, disregarding the sync
 * timestamps the client stamps onto every write.
 */
export function recordContentEquals(left: unknown, right: unknown): boolean {
  return jsonContentEquals(left, right, SYNC_METADATA_KEYS);
}
