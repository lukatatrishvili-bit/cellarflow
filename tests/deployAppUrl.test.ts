import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * `APP_URL` decides the origin of every link the server generates: the Google
 * OAuth `redirect_uri`, email verification, password reset, invitations,
 * approval review, and AI notification deep links (`server/config.ts`
 * `appBaseUrl`).
 *
 * It is deliberately pinned to a configured value rather than derived from the
 * request host — deriving it would let an attacker set a `Host` header and
 * receive a password-reset link pointing at their own domain. The cost of that
 * correct choice is that a wrong `APP_URL` is silently wrong for everyone.
 *
 * The deploy workflow used to pin it to the generated `*.run.app` URL
 * unconditionally. Once a custom domain is mapped, that sends users who signed
 * in on the domain back to run.app — and because the session cookie is
 * host-only (`server/middleware/auth.ts` sets no `Domain=`), they arrive
 * appearing signed out.
 */

const workflow = fs.readFileSync(
  path.resolve(__dirname, '../.github/workflows/google-cloud-run.yml'),
  'utf8',
);

describe('deployment APP_URL configuration', () => {
  it('exposes a PUBLIC_APP_URL repository variable', () => {
    expect(workflow).toMatch(/PUBLIC_APP_URL:\s*\$\{\{\s*vars\.PUBLIC_APP_URL\s*\}\}/);
  });

  it('never pins APP_URL directly to the generated service URL', () => {
    // The regression this guards: `APP_URL=$SERVICE_URL`.
    expect(workflow).not.toMatch(/APP_URL=\$SERVICE_URL/);
    expect(workflow).not.toMatch(/APP_URL=\$\{SERVICE_URL\}/);
  });

  it('prefers the configured public origin and falls back to the service URL', () => {
    expect(workflow).toContain('PUBLIC_URL="${PUBLIC_APP_URL:-}"');
    expect(workflow).toContain('APP_URL_VALUE="$PUBLIC_URL"');
    expect(workflow).toContain('APP_URL_VALUE="$SERVICE_URL"');
    expect(workflow).toContain('--update-env-vars "APP_URL=$APP_URL_VALUE"');
  });

  it('rejects a public origin that is not absolute https', () => {
    // A bare "vinos.ge" would produce links like "vinos.ge/api/..." — relative,
    // and broken everywhere they are used.
    expect(workflow).toMatch(/PUBLIC_APP_URL must be an absolute https origin/);
    expect(workflow).toContain('https://*) ;;');
  });

  it('strips a trailing slash so generated links do not double up', () => {
    // appBaseUrl also strips, but the deploy value is what operators read back.
    expect(workflow).toContain('PUBLIC_URL="${PUBLIC_URL%/}"');
  });

  it('gives background jobs the same origin as the service', () => {
    // The AI delivery job builds deep links too; it must not keep using run.app.
    expect(workflow).toContain('RESOLVED_APP_URL=$APP_URL_VALUE');
    expect(workflow).toContain('APP_URL=$RESOLVED_APP_URL');
  });

  it('documents why the fallback is not good enough once a domain exists', () => {
    expect(workflow).toMatch(/session cookie is host-only/i);
  });
});
