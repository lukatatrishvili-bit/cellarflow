import type express from 'express';

/**
 * Detects the one way a correct `APP_URL` policy still fails users.
 *
 * `appBaseUrl` returns `APP_URL` verbatim whenever it is set, ignoring the host
 * the request actually arrived on. That is deliberate — deriving the origin from
 * the `Host` header would let an attacker request a password reset with a forged
 * header and receive a link pointing at their own domain.
 *
 * The cost is that a stale `APP_URL` is invisible from inside the app. When a
 * custom domain is mapped to Cloud Run but `APP_URL` still holds the generated
 * `*.run.app` URL, everything looks healthy: the service answers on the domain,
 * pages render, no error is logged. But the Google OAuth `redirect_uri` and every
 * emailed link point at run.app, and since the session cookie is host-only, a
 * sign-in begun on the domain completes on run.app and the user returns to the
 * domain still signed out.
 *
 * The server can see both halves of that mismatch, so it should say so. This
 * warns once per distinct host to keep a misconfiguration from becoming log
 * noise — the goal is one clear line an operator can act on.
 */

/** Hosts that are never a real user-facing origin. */
const INFRASTRUCTURE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function hostOf(value: string): string {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
}

function normalizeHost(value: string | undefined): string {
  if (!value) return '';
  // `Host` may carry a port; forwarded headers may carry a list.
  return value.split(',')[0].trim().toLowerCase();
}

/**
 * Strip the port, leaving the bare host.
 *
 * IPv6 needs care: a literal is bracketed in a Host header (`[::1]:3000`), and
 * stripping `:<digits>` from an unbracketed `::1` would leave `:` — which is
 * why this does not just run a regex over everything.
 */
export function hostWithoutPort(host: string): string {
  const value = host.trim();
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    return close === -1 ? value.slice(1) : value.slice(1, close);
  }
  // More than one colon means an unbracketed IPv6 literal, which carries no port.
  if ((value.match(/:/g) || []).length > 1) return value;
  return value.replace(/:\d+$/, '');
}

export function isInfrastructureHost(host: string): boolean {
  const bare = hostWithoutPort(host);
  return !bare || INFRASTRUCTURE_HOSTS.has(bare);
}

/**
 * The mismatch, or null when there is nothing to report.
 *
 * Returns null when `APP_URL` is unset (a separate, already-reported warning),
 * when the request host is infrastructure, or when the hosts agree.
 */
export function appUrlHostMismatch(
  requestHost: string | undefined,
  appUrl: string | undefined,
): { requestHost: string; configuredHost: string } | null {
  const configured = (appUrl || '').trim();
  if (!configured) return null;

  const configuredHost = hostOf(configured);
  if (!configuredHost) return null;

  const host = normalizeHost(requestHost);
  if (!host || isInfrastructureHost(host)) return null;
  if (host === configuredHost) return null;

  return { requestHost: host, configuredHost };
}

/**
 * Express middleware. Production only: in development the two differ routinely
 * and the warning would mean nothing.
 *
 * It also marks non-canonical origins `noindex`. Once a custom domain is mapped
 * the service answers on at least two hostnames serving byte-identical pages,
 * and a crawler reaching the generated `*.run.app` URL would index it as a
 * separate site competing with the real one. Only the canonical origin should
 * be indexable, and the server already knows which that is.
 */
export function warnOnAppUrlMismatch(options: {
  isProduction: boolean;
  log?: (message: string) => void;
} = { isProduction: process.env.NODE_ENV === 'production' }) {
  const log = options.log ?? ((message: string) => console.warn(message));
  const reported = new Set<string>();

  return function appUrlMismatchWarning(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    if (!options.isProduction) return next();

    const forwarded = req.headers['x-forwarded-host'];
    const requestHost = normalizeHost(
      (Array.isArray(forwarded) ? forwarded[0] : forwarded) || req.headers.host,
    );

    const mismatch = appUrlHostMismatch(requestHost, process.env.APP_URL);
    if (mismatch) {
      // Keep duplicate content out of the index without redirecting: a redirect
      // would break anyone reaching the service directly by its Cloud Run
      // hostname, which is a legitimate way to check a deployment.
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    if (mismatch && !reported.has(mismatch.requestHost)) {
      reported.add(mismatch.requestHost);
      log(
        `[config] Requests are arriving on "${mismatch.requestHost}" but APP_URL points at `
        + `"${mismatch.configuredHost}". Google OAuth redirects and emailed links will send users to `
        + `"${mismatch.configuredHost}" — and because the session cookie is host-only, a sign-in started `
        + `on "${mismatch.requestHost}" completes elsewhere and the user appears signed out. `
        + `Set the PUBLIC_APP_URL repository variable to "https://${mismatch.requestHost}" and redeploy.`,
      );
    }
    return next();
  };
}
