import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyRetry } from '../src/lazyRetry';

/**
 * lazyRetry wraps React.lazy; we exercise the underlying factory behavior by
 * driving the module loader the same way React does (calling the payload's
 * _init/_payload is React-internal, so instead we test through the factory
 * semantics: the wrapper's behavior is observable via sessionStorage and
 * location.reload side effects).
 */

function stubBrowserGlobals() {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const reload = vi.fn();
  vi.stubGlobal('sessionStorage', sessionStorage);
  vi.stubGlobal('location', { reload });
  return { store, reload };
}

// Extract the wrapped factory React.lazy received. React lazy stores it on the
// element payload; rather than poking React internals, re-implement the call:
// lazyRetry passes our factory through .then(onOk, onErr) — so we can observe
// behavior by invoking the same chain via a spy factory and the returned
// component's private payload initializer.
function initLazy(component: any): Promise<unknown> {
  // React lazy exotic components expose _init(_payload) internally; calling it
  // kicks off the factory exactly once, mirroring first render.
  return Promise.resolve()
    .then(() => component._init(component._payload))
    .then(
      (v) => v,
      (e) => {
        if (e && typeof e.then === 'function') return e; // React throws the pending promise
        throw e;
      },
    );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lazyRetry', () => {
  it('resolves normally and clears the reload flag on success', async () => {
    const { store } = stubBrowserGlobals();
    store.set('cf_chunk_reload', '1'); // stale flag from a previous recovery
    const Component = () => null;
    const wrapped = lazyRetry(async () => ({ default: Component }));
    await initLazy(wrapped).catch(() => {});
    // Flag cleared so the NEXT deploy can auto-reload again.
    expect(store.has('cf_chunk_reload')).toBe(false);
  });

  it('reloads once on first chunk failure and sets the guard flag', async () => {
    const { store, reload } = stubBrowserGlobals();
    const wrapped = lazyRetry(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    // Deliberately not awaited: on the reload path the wrapper never settles,
    // holding the Suspense fallback on screen while the page reloads.
    void initLazy(wrapped).catch(() => {});
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(store.get('cf_chunk_reload')).toBe('1');
  });

  it('does NOT reload again when the guard flag is already set (no loops)', async () => {
    const { store, reload } = stubBrowserGlobals();
    store.set('cf_chunk_reload', '1');
    const err = new Error('still failing');
    const wrapped = lazyRetry(() => Promise.reject(err));
    let caught: unknown = null;
    await initLazy(wrapped).catch((e) => { caught = e; });
    await new Promise((r) => setTimeout(r, 10));
    expect(reload).not.toHaveBeenCalled();
    expect(caught).toBe(err); // error propagates to the error boundary
  });
});
