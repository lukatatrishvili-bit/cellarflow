import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The policy is only worth having if `script-src` stays strict, and it only
 * stays strict if nothing reintroduces an inline script. These lock both ends:
 * the emitted header, and the generated documents that inherit it.
 */

const originalEnv = { ...process.env };

async function policy(env: Record<string, string> = {}): Promise<Record<string, string>> {
  vi.resetModules();
  process.env = { ...originalEnv, NODE_ENV: 'production', SESSION_SECRET: 'csp-test-secret', ...env };
  const { securityHeaders } = await import('../server/middleware/securityHeaders');
  const headers: Record<string, string> = {};
  securityHeaders()({} as any, { setHeader: (k: string, v: string) => { headers[k] = v; } } as any, () => {});
  return headers;
}

function directives(csp: string): Map<string, string> {
  return new Map(csp.split('; ').map(part => {
    const [name, ...values] = part.split(' ');
    return [name, values.join(' ')];
  }));
}

beforeEach(() => { process.env = { ...originalEnv }; });
afterEach(() => { process.env = { ...originalEnv }; vi.resetModules(); });

describe('content security policy', () => {
  it('allows no inline or eval script', async () => {
    const headers = await policy();
    const csp = headers['Content-Security-Policy-Report-Only'];
    const scriptSrc = directives(csp).get('script-src');

    expect(scriptSrc).toBe("'self'");
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('keeps the dangerous fallbacks locked down', async () => {
    const found = directives(await policy().then(h => h['Content-Security-Policy-Report-Only']));
    expect(found.get('default-src')).toBe("'self'");
    expect(found.get('object-src')).toBe("'none'");
    expect(found.get('base-uri')).toBe("'self'");
    expect(found.get('form-action')).toBe("'self'");
  });

  it('names no origin the browser does not actually contact', async () => {
    const csp = (await policy())['Content-Security-Policy-Report-Only'];
    // Maps were allowed for years without ever being loaded; the app uses
    // Leaflet against OpenStreetMap. A dead allowance is only attack surface.
    expect(csp).not.toContain('maps.googleapis.com');
    expect(csp).not.toContain('maps.gstatic.com');
    expect(csp).not.toContain('googleusercontent.com');
  });

  it('ships Report-Only until CSP_ENFORCE is set', async () => {
    const reportOnly = await policy();
    expect(reportOnly['Content-Security-Policy-Report-Only']).toBeTruthy();
    expect(reportOnly['Content-Security-Policy']).toBeUndefined();

    const enforced = await policy({ CSP_ENFORCE: 'true' });
    expect(enforced['Content-Security-Policy']).toBeTruthy();
    expect(enforced['Content-Security-Policy-Report-Only']).toBeUndefined();
  });

  it('always carries a reporting sink, in both modes', async () => {
    for (const env of [{}, { CSP_ENFORCE: 'true' }]) {
      const headers = await policy(env);
      const csp = headers['Content-Security-Policy'] || headers['Content-Security-Policy-Report-Only'];
      expect(csp).toContain('report-uri /api/telemetry/csp-report');
      expect(headers['Reporting-Endpoints']).toContain('/api/telemetry/csp-report');
    }
  });

  it('emits no CSP outside production, where Vite needs inline and eval', async () => {
    vi.resetModules();
    process.env = { ...originalEnv, NODE_ENV: 'development' };
    const { securityHeaders } = await import('../server/middleware/securityHeaders');
    const headers: Record<string, string> = {};
    securityHeaders()({} as any, { setHeader: (k: string, v: string) => { headers[k] = v; } } as any, () => {});

    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(headers['Content-Security-Policy-Report-Only']).toBeUndefined();
    expect(headers['X-Content-Type-Options']).toBe('nosniff'); // the safe ones still apply
  });

  /**
   * A document written into a window this app opened, or loaded from a blob:
   * URL it created, inherits this CSP. An inline <script> there is blocked just
   * as it would be in the SPA itself, so print flows must not carry one.
   */
  it('generates no printable document containing an inline script', async () => {
    const roots = ['components', 'lib', 'src'].map(d => path.resolve(__dirname, '..', d));
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const source = fs.readFileSync(full, 'utf8');
        source.split('\n').forEach((line, index) => {
          const trimmed = line.trim();
          // Comments discuss this rule (including the ones explaining the fix),
          // and the escaped form is the XSS-safety fixture in qrLabels.
          if (/^(\/\/|\/?\*)/.test(trimmed) || line.includes('&lt;script')) return;
          if (/<script[\s>]/.test(line)) {
            offenders.push(`${path.relative(path.resolve(__dirname, '..'), full)}:${index + 1}`);
          }
        });
      }
    };
    roots.forEach(walk);

    expect(offenders, `inline <script> in generated HTML: ${offenders.join(', ')}`).toEqual([]);
  });
});
