import express from 'express';

/**
 * Baseline HTTP security headers.
 *
 * The framing / sniffing / referrer / transport headers are safe to enforce
 * everywhere and are applied unconditionally. The Content-Security-Policy is the
 * only header with real breakage risk (Google Maps, Google Fonts, the Georgian
 * document renderer), so it ships in **Report-Only** mode by default and is
 * promoted to enforcing via `CSP_ENFORCE=true` once validated in staging.
 *
 * CSP and HSTS are emitted in production only — in development Vite's dev server
 * injects inline scripts, uses eval, and opens an HMR websocket that a strict
 * policy would fight with.
 */

const isProd = process.env.NODE_ENV === 'production';
const cspEnforce = process.env.CSP_ENFORCE === 'true';

// External origins the client legitimately contacts. Gemini AI is proxied
// through /api/gemini (same origin), so it needs no CSP allowance.
const OPEN_METEO = 'https://open-meteo.com https://api.open-meteo.com https://geocoding-api.open-meteo.com https://archive-api.open-meteo.com';
const OPEN_STREET_MAP = 'https://*.openstreetmap.org https://openstreetmap.org https://www.openstreetmap.org';
const GMAPS_SCRIPT = 'https://maps.googleapis.com https://maps.gstatic.com';
const GMAPS_CONNECT = 'https://maps.googleapis.com';
const GMAPS_IMG = 'https://maps.googleapis.com https://maps.gstatic.com https://*.googleusercontent.com';
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
    `script-src 'self' 'unsafe-inline' ${GMAPS_SCRIPT}`,
    `style-src 'self' 'unsafe-inline' ${GFONTS_STYLE}`,
    `img-src 'self' data: blob: ${GMAPS_IMG} ${OPEN_STREET_MAP}`,
    `font-src 'self' data: ${GFONTS_FONT}`,
    `connect-src 'self' ${OPEN_METEO} ${GMAPS_CONNECT} ${OPEN_STREET_MAP}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
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
      const header = cspEnforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
      res.setHeader(header, csp);
    }
    next();
  };
}
