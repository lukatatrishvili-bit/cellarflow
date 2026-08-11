import express from 'express';

/**
 * Baseline HTTP security headers.
 *
 * The framing / sniffing / referrer / transport headers are safe to enforce
 * everywhere and are applied unconditionally. The Content-Security-Policy is the
 * only header with real breakage risk (Google Fonts, OpenStreetMap tiles, the
 * printed Georgian documents), so it ships in **Report-Only** mode by default
 * and is promoted to enforcing via `CSP_ENFORCE=true` once the violation
 * reports collected at `/api/telemetry/csp-report` show a clean production run.
 *
 * The allowlist names only origins the browser actually contacts. Google Maps
 * was allowed here but never loaded — the maps are Leaflet/OpenStreetMap — and
 * a dead allowance is just attack surface, so it is gone.
 *
 * CSP and HSTS are emitted in production only — in development Vite's dev server
 * injects inline scripts, uses eval, and opens an HMR websocket that a strict
 * policy would fight with.
 */

const isProd = process.env.NODE_ENV === 'production';
const cspEnforce = process.env.CSP_ENFORCE === 'true';

/** Same-origin collector in server/routes/telemetry.ts. */
const CSP_REPORT_PATH = '/api/telemetry/csp-report';

// External origins the client legitimately contacts. Gemini AI is proxied
// through /api/gemini (same origin), so it needs no CSP allowance.
const OPEN_METEO = 'https://open-meteo.com https://api.open-meteo.com https://geocoding-api.open-meteo.com https://archive-api.open-meteo.com';
const OPEN_STREET_MAP = 'https://*.openstreetmap.org https://openstreetmap.org https://www.openstreetmap.org';
const GFONTS_STYLE = 'https://fonts.googleapis.com';
const GFONTS_FONT = 'https://fonts.gstatic.com';

function buildCsp(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "frame-src 'self' https://www.openstreetmap.org https://*.openstreetmap.org",
    "form-action 'self'",
    // No 'unsafe-inline': the Vite build emits one external module script and no
    // inline handlers, and the two print flows that injected
    // `<script>window.print()</script>` now drive printing from the opener.
    // This directive is the point of the whole policy — an injected script is
    // the difference between a defaced page and a stolen session.
    "script-src 'self'",
    // 'unsafe-inline' stays for styles: index.html carries the boot-splash CSS
    // and React sets style attributes at runtime, neither of which a nonce
    // covers. CSS injection is a far smaller prize than script execution.
    `style-src 'self' 'unsafe-inline' ${GFONTS_STYLE}`,
    `img-src 'self' data: blob: ${OPEN_STREET_MAP}`,
    `font-src 'self' data: ${GFONTS_FONT}`,
    `connect-src 'self' ${OPEN_METEO} ${OPEN_STREET_MAP}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Without a sink, Report-Only mode is a no-op: the browser evaluates the
    // policy and discards the result. `report-uri` is formally deprecated but
    // is still the only directive Safari and older Chrome honour; `report-to`
    // is the modern path and pairs with the Reporting-Endpoints header below.
    `report-uri ${CSP_REPORT_PATH}`,
    'report-to csp-endpoint',
  ].join('; ');
}

export function securityHeaders(): express.RequestHandler {
  const csp = buildCsp();
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');

    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      // Declares the named group that the policy's `report-to` directive uses.
      res.setHeader(
        'Reporting-Endpoints',
        `csp-endpoint="${CSP_REPORT_PATH}"`,
      );
      const header = cspEnforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
      res.setHeader(header, csp);
    }
    next();
  };
}
