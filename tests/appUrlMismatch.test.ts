import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { appUrlHostMismatch, hostWithoutPort, isInfrastructureHost, warnOnAppUrlMismatch } from '../server/appUrlMismatch';

const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

function runMiddleware(
  middleware: ReturnType<typeof warnOnAppUrlMismatch>,
  headers: Record<string, string>,
): { advanced: boolean; headers: Record<string, string> } {
  let advanced = false;
  const set: Record<string, string> = {};
  middleware(
    { headers } as unknown as express.Request,
    { setHeader: (name: string, value: string) => { set[name] = value; } } as unknown as express.Response,
    (() => { advanced = true; }) as express.NextFunction,
  );
  return { advanced, headers: set };
}

describe('appUrlHostMismatch', () => {
  it('reports a host that differs from the configured origin', () => {
    expect(appUrlHostMismatch('vinos.ge', 'https://svc-abc.run.app')).toEqual({
      requestHost: 'vinos.ge',
      configuredHost: 'svc-abc.run.app',
    });
  });

  it('stays silent when the hosts agree', () => {
    expect(appUrlHostMismatch('vinos.ge', 'https://vinos.ge')).toBeNull();
    // Case and trailing path must not create a false alarm.
    expect(appUrlHostMismatch('VINOS.GE', 'https://vinos.ge/')).toBeNull();
  });

  it('stays silent when APP_URL is unset or unparsable', () => {
    // Absence is already reported separately by the deployment status check.
    expect(appUrlHostMismatch('vinos.ge', undefined)).toBeNull();
    expect(appUrlHostMismatch('vinos.ge', '')).toBeNull();
    expect(appUrlHostMismatch('vinos.ge', 'not a url')).toBeNull();
  });

  it('ignores infrastructure hosts', () => {
    // Health checks and internal probes hit the service by address, and would
    // otherwise raise a warning on every deployment.
    const infrastructure = [
      'localhost', 'localhost:3000', '127.0.0.1', '127.0.0.1:8080',
      '::1', '[::1]', '[::1]:3000', '0.0.0.0:8080',
    ];
    for (const host of infrastructure) {
      expect(appUrlHostMismatch(host, 'https://vinos.ge'), host).toBeNull();
    }
    expect(isInfrastructureHost('vinos.ge')).toBe(false);
  });

  it('strips ports without mangling IPv6 literals', () => {
    expect(hostWithoutPort('vinos.ge:8443')).toBe('vinos.ge');
    expect(hostWithoutPort('vinos.ge')).toBe('vinos.ge');
    // The bug this caught: a naive /:\d+$/ turns "::1" into ":".
    expect(hostWithoutPort('::1')).toBe('::1');
    expect(hostWithoutPort('[::1]:3000')).toBe('::1');
    expect(hostWithoutPort('[2001:db8::1]:443')).toBe('2001:db8::1');
  });

  it('takes the first entry of a forwarded host list', () => {
    expect(appUrlHostMismatch('vinos.ge, proxy.internal', 'https://svc.run.app')?.requestHost)
      .toBe('vinos.ge');
  });
});

describe('warnOnAppUrlMismatch middleware', () => {
  it('warns once per host and always calls next', () => {
    process.env.APP_URL = 'https://svc-abc.run.app';
    const log = vi.fn();
    const middleware = warnOnAppUrlMismatch({ isProduction: true, log });

    expect(runMiddleware(middleware, { host: 'vinos.ge' }).advanced).toBe(true);
    expect(runMiddleware(middleware, { host: 'vinos.ge' }).advanced).toBe(true);
    expect(runMiddleware(middleware, { host: 'vinos.ge' }).advanced).toBe(true);

    // A misconfiguration must not become per-request log noise.
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('vinos.ge');
    expect(log.mock.calls[0][0]).toContain('svc-abc.run.app');
    // The message has to name the fix, not just the symptom.
    expect(log.mock.calls[0][0]).toContain('PUBLIC_APP_URL');
    expect(log.mock.calls[0][0]).toContain('https://vinos.ge');
  });

  it('warns separately for a second distinct host', () => {
    process.env.APP_URL = 'https://svc-abc.run.app';
    const log = vi.fn();
    const middleware = warnOnAppUrlMismatch({ isProduction: true, log });

    runMiddleware(middleware, { host: 'vinos.ge' });
    runMiddleware(middleware, { host: 'www.vinos.ge' });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('prefers the forwarded host, which is what the user actually typed', () => {
    process.env.APP_URL = 'https://svc-abc.run.app';
    const log = vi.fn();
    const middleware = warnOnAppUrlMismatch({ isProduction: true, log });

    runMiddleware(middleware, { 'x-forwarded-host': 'vinos.ge', host: 'svc-abc.run.app' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('vinos.ge');
  });

  it('says nothing outside production', () => {
    process.env.APP_URL = 'https://svc-abc.run.app';
    const log = vi.fn();
    const middleware = warnOnAppUrlMismatch({ isProduction: false, log });

    expect(runMiddleware(middleware, { host: 'vinos.ge' }).advanced).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it('says nothing when the deployment is configured correctly', () => {
    process.env.APP_URL = 'https://vinos.ge';
    const log = vi.fn();
    const middleware = warnOnAppUrlMismatch({ isProduction: true, log });

    runMiddleware(middleware, { host: 'vinos.ge' });
    expect(log).not.toHaveBeenCalled();
  });
});

describe('non-canonical origin indexing', () => {
  it('marks a non-canonical host noindex', () => {
    // Two origins serving byte-identical pages would otherwise compete in search
    // results, with the generated Cloud Run URL able to outrank the real domain.
    process.env.APP_URL = 'https://vinos.ge';
    const middleware = warnOnAppUrlMismatch({ isProduction: true, log: () => {} });

    const { headers, advanced } = runMiddleware(middleware, { host: 'svc-abc.run.app' });
    expect(advanced).toBe(true);
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow');
  });

  it('leaves the canonical host indexable', () => {
    process.env.APP_URL = 'https://vinos.ge';
    const middleware = warnOnAppUrlMismatch({ isProduction: true, log: () => {} });

    expect(runMiddleware(middleware, { host: 'vinos.ge' }).headers['X-Robots-Tag']).toBeUndefined();
  });

  it('leaves everything indexable when no canonical origin is configured', () => {
    // With APP_URL unset there is no basis to call any host non-canonical.
    delete process.env.APP_URL;
    const middleware = warnOnAppUrlMismatch({ isProduction: true, log: () => {} });

    expect(runMiddleware(middleware, { host: 'vinos.ge' }).headers['X-Robots-Tag']).toBeUndefined();
  });

  it('does not touch headers outside production', () => {
    process.env.APP_URL = 'https://vinos.ge';
    const middleware = warnOnAppUrlMismatch({ isProduction: false, log: () => {} });

    expect(runMiddleware(middleware, { host: 'localhost:3000' }).headers['X-Robots-Tag']).toBeUndefined();
  });
});
