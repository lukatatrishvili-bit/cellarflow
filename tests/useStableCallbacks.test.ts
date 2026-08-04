import { describe, expect, it } from 'vitest';
import { projectStableCallbacks } from '../hooks/useStableCallbacks';

/**
 * Simulates the render loop `useStableCallbacks` sits in: a persistent wrapper
 * cache and a `latest` box that React refreshes in a layout effect after each
 * render. Driving it by hand is what lets these run without a DOM environment.
 */
function makeHarness<T extends Record<string, any>>(initial: T) {
  const wrappers: Record<string, (...args: any[]) => any> = {};
  const latest = { current: initial };
  return {
    render(source: T): T {
      const projected = projectStableCallbacks(source, wrappers, latest);
      latest.current = source; // stands in for the layout effect
      return projected;
    },
  };
}

describe('projectStableCallbacks', () => {
  it('keeps handler identity fixed while values pass through', () => {
    const harness = makeHarness({ count: 1, bump: () => 1 });

    const first = harness.render({ count: 1, bump: () => 1 });
    const second = harness.render({ count: 2, bump: () => 2 });
    const third = harness.render({ count: 3, bump: () => 3 });

    expect(first.bump).toBe(second.bump);
    expect(second.bump).toBe(third.bump);
    // Data still changes — a memoized consumer must still see real updates.
    expect([first.count, second.count, third.count]).toEqual([1, 2, 3]);
  });

  it('forwards to the newest implementation, never a stale closure', () => {
    const harness = makeHarness({ describe: (suffix: string) => `first${suffix}` });

    const projected = harness.render({ describe: (suffix: string) => `first${suffix}` });
    const captured = projected.describe;
    expect(captured('!')).toBe('first!');

    harness.render({ describe: (suffix: string) => `second${suffix}` });

    // Same function object a memoized child would still be holding…
    expect(captured).toBe(projected.describe);
    // …now running the current implementation.
    expect(captured('!')).toBe('second!');
  });

  it('passes every argument through and returns the result', () => {
    const harness = makeHarness({ add: (a: number, b: number, c: number) => a + b + c });
    const { add } = harness.render({ add: (a: number, b: number, c: number) => a + b + c });
    expect(add(2, 3, 4)).toBe(9);
  });

  it('preserves non-function entries by reference, so memo still sees real edits', () => {
    const lots = [{ id: 'lot-1' }];
    const harness = makeHarness({ lots, noop: () => {} });

    const first = harness.render({ lots, noop: () => {} });
    const second = harness.render({ lots, noop: () => {} });
    expect(first.lots).toBe(second.lots); // unchanged data keeps its identity

    const nextLots = [{ id: 'lot-1' }, { id: 'lot-2' }];
    const third = harness.render({ lots: nextLots, noop: () => {} });
    expect(third.lots).not.toBe(first.lots); // a real change still propagates
  });

  it('gives every wrapped handler a distinct identity', () => {
    const harness = makeHarness({ a: () => 'a', b: () => 'b' });
    const projected = harness.render({ a: () => 'a', b: () => 'b' });

    expect(projected.a).not.toBe(projected.b);
    expect(projected.a()).toBe('a');
    expect(projected.b()).toBe('b');
  });

  it('handles entries that are null or undefined rather than treating them as handlers', () => {
    const harness = makeHarness<Record<string, any>>({ maybe: null, other: undefined });
    const projected = harness.render({ maybe: null, other: undefined });
    expect(projected.maybe).toBeNull();
    expect(projected.other).toBeUndefined();
  });

  it('reports the shallow-equality a memo boundary would compute', () => {
    // React.memo compares props one level deep. With handlers stabilised, an
    // unrelated state change leaves every prop a tab receives referentially
    // equal — which is precisely when memo skips the render.
    const lots = [{ id: 'lot-1' }];
    const harness = makeHarness<Record<string, any>>({ lots, onAct: () => 1, tick: 1 });

    const before = harness.render({ lots, onAct: () => 1, tick: 1 });
    const after = harness.render({ lots, onAct: () => 2, tick: 2 });

    const tabProps = ['lots', 'onAct'] as const; // `tick` is not passed down
    const allEqual = tabProps.every(key => before[key] === after[key]);
    expect(allEqual).toBe(true);
  });
});
