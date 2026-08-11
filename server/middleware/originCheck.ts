import express from 'express';
import { appBaseUrl } from '../config';

/**
 * Defence-in-depth CSRF guard.
 *
 * The session cookie is already `SameSite=Lax`, which is what actually stops a
 * cross-site form or fetch from carrying credentials. This middleware is the
 * second, independent layer: it does not depend on cookie policy, so it still
 * holds if the cookie attributes are ever loosened (e.g. `SameSite=None` for an
 * embed) or if a client mishandles Lax.
 *
 * Deliberately conservative — it rejects only on **positive evidence** of a
 * cross-site request, never on an absent header. Non-browser callers (curl, the
 * test suites, scripts, server-to-server jobs) send no `Origin`/`Sec-Fetch-Site`
 * and are unaffected; they also carry no ambient cookie, so they are not the
 * threat this addresses. That keeps the guard shippable without an inventory of
 * every existing client.
 */

// Safe methods are excluded: they must not change state, and the emailed GET
// links (OAuth callback, registration review) are top-level navigations that
// legitimately arrive with a foreign or absent Origin.
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Reduce a URL to scheme://host[:port], the exact form of an `Origin` header. */
function toOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function allowedOrigins(req: express.Request): Set<string> {
  const origins = new Set<string>();

  // The configured public URL (APP_URL) when set, else the proxy-aware host.
  const base = toOrigin(appBaseUrl(req));
  if (base) origins.add(base);

  // Always accept the origin the request was actually addressed to. Cloud Run
  // serves the same revision on both the custom domain and the *.run.app host,
  // and APP_URL can only name one of them.
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol;
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.headers.host;
  if (proto && host) {
    const self = toOrigin(`${proto}://${host}`);
    if (self) origins.add(self);
  }

  return origins;
}

export function originCheck(): express.RequestHandler {
  return (req, res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();

    const secFetchSite = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;

    // `Sec-Fetch-Site` is browser-set and unspoofable by page JavaScript, so
    // when present it is the most trustworthy signal available.
    //   same-origin → the app itself
    //   same-site   → a sibling subdomain; the Lax cookie would be sent anyway,
    //                 so rejecting here would not change the trust boundary
    //   none        → user-initiated (address bar, bookmark)
    if (secFetchSite === 'cross-site') {
      return reject(req, res, `sec-fetch-site=cross-site`);
    }

    if (typeof origin === 'string' && origin.length > 0) {
      // A literal "null" origin comes from sandboxed iframes and opaque
      // redirect chains — a known CSRF laundering path, never legitimate here.
      if (origin === 'null') {
        return reject(req, res, 'origin=null');
      }
      if (!allowedOrigins(req).has(origin)) {
        return reject(req, res, `origin=${origin}`);
      }
    }

    return next();
  };
}

function reject(req: express.Request, res: express.Response, detail: string) {
  // Path only — query strings and bodies can carry tenant data.
  console.warn(`[origin-check] rejected ${req.method} ${req.path} (${detail})`);
  res.status(403).json({
    code: 'cross_origin_rejected',
    error: 'Cross-origin state-changing requests are not accepted.',
  });
}
