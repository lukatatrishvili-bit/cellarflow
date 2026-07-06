import { lazy } from 'react';
import type { ComponentType } from 'react';

const RELOAD_FLAG = 'cf_chunk_reload';

/**
 * React.lazy that survives deploys. Build assets are content-hashed, so a
 * session that started before a deploy holds chunk URLs that now 404 — the
 * classic PWA "clicked a tab, got a white screen" failure. On the first import
 * failure we reload the page once (picking up the fresh index.html and chunk
 * map); a sessionStorage flag prevents reload loops when the failure has a
 * different cause, in which case the error propagates to the error boundary.
 */
export function lazyRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() =>
    factory().then(
      (module) => {
        try {
          globalThis.sessionStorage?.removeItem(RELOAD_FLAG);
        } catch { /* storage unavailable (private mode) — reload guard just stays conservative */ }
        return module;
      },
      (error) => {
        let alreadyReloaded = true;
        try {
          alreadyReloaded = globalThis.sessionStorage?.getItem(RELOAD_FLAG) === '1';
          if (!alreadyReloaded) globalThis.sessionStorage?.setItem(RELOAD_FLAG, '1');
        } catch { /* without storage we cannot guard a loop, so never auto-reload */ }

        if (!alreadyReloaded) {
          globalThis.location?.reload();
          // The page is reloading — never settle so React keeps showing the
          // Suspense fallback instead of flashing an error.
          return new Promise<never>(() => {});
        }
        throw error;
      },
    ),
  );
}
