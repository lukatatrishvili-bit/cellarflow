import { useLayoutEffect, useRef } from 'react';

/**
 * Give every function in a state object a stable identity across renders.
 *
 * `useWineryState` returns ~149 entries, 67 of them handlers declared fresh on
 * each render. `App` spreads those into the open module as props, so every
 * render handed each tab a new `onAddCellarOperation`, `onApplyTransferCommandResponse`,
 * and so on. That is why `React.memo` was absent from all 64 components: with
 * props changing identity every time, a memo boundary would have cost a
 * comparison and never once prevented a render.
 *
 * Wrapping the handlers is what makes those boundaries pay. Each wrapper is
 * created once and forwards to the newest implementation through a ref, so it
 * never closes over stale state while its identity stays fixed. Non-function
 * entries pass through untouched — a memoized tab still re-renders when the
 * `lots` it displays actually change, which is the point.
 */

/**
 * The projection itself, kept free of React so it can be tested directly: the
 * repo has no DOM test environment, and adding one would mean a new heavy
 * dependency the experience plan rules out.
 *
 * `wrappers` is the persistent cache (one entry per handler, created once) and
 * `latest` is the box holding the current render's implementations.
 */
export function projectStableCallbacks<T extends Record<string, any>>(
  source: T,
  wrappers: Record<string, (...args: any[]) => any>,
  latest: { current: T },
): T {
  // Built as a loose record and asserted once at the end: the projection is
  // key-for-key identical to `source`, but TypeScript cannot express writing to
  // an arbitrary generic's index signature.
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value !== 'function') {
      result[key] = value;
      continue;
    }
    let wrapper = wrappers[key];
    if (!wrapper) {
      // Reads through `latest` on every call, so the identity can stay fixed
      // without the closure ever going stale.
      wrapper = (...args: any[]) => latest.current[key](...args);
      wrappers[key] = wrapper;
    }
    result[key] = wrapper;
  }
  return result as T;
}

/**
 * React binding for {@link projectStableCallbacks}.
 *
 * The ref is refreshed in a layout effect, so it is current before any
 * `useEffect` or event handler can run. Handlers must therefore not be invoked
 * *during* render; these are event and async callbacks, which never are.
 */
export function useStableCallbacks<T extends Record<string, any>>(source: T): T {
  const latest = useRef(source);
  useLayoutEffect(() => {
    latest.current = source;
  });

  const wrappers = useRef<Record<string, (...args: any[]) => any>>({});
  return projectStableCallbacks(source, wrappers.current, latest);
}
