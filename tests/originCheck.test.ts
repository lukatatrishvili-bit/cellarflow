import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { originCheck } from '../server/middleware/originCheck';

const APP_ORIGIN = 'https://app.cellarflow.ge';

function run(
  {
    method = 'POST',
    origin,
    secFetchSite,
    host = 'app.cellarflow.ge',
    forwardedProto = 'https',
  }: {
    method?: string;
    origin?: string;
    secFetchSite?: string;
    host?: string;
    forwardedProto?: string;
  },
) {
  const headers: Record<string, string> = { host };
  if (origin !== undefined) headers.origin = origin;
  if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite;
  if (forwardedProto) headers['x-forwarded-proto'] = forwardedProto;

  const req: any = { method, headers, path: '/api/commands/transfer', protocol: forwardedProto };
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const res: any = { status, json };
  const next = vi.fn();

  originCheck()(req, res, next);

  return {
    passed: next.mock.calls.length > 0,
    statusCode: status.mock.calls[0]?.[0],
    body: json.mock.calls[0]?.[0],
  };
}

describe('originCheck', () => {
  beforeEach(() => {
    process.env.APP_URL = APP_ORIGIN;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.APP_URL;
    vi.restoreAllMocks();
  });

  it('allows same-origin state changes', () => {
    expect(run({ origin: APP_ORIGIN, secFetchSite: 'same-origin' }).passed).toBe(true);
  });

  it('rejects a cross-site POST carrying a foreign Origin', () => {
    const result = run({ origin: 'https://evil.example', secFetchSite: 'cross-site' });
    expect(result.passed).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.body.code).toBe('cross_origin_rejected');
  });

  it('rejects on Sec-Fetch-Site alone, even when Origin looks correct', () => {
    // Sec-Fetch-Site is browser-set and cannot be forged by page script, so it
    // outranks a spoofable Origin on a non-browser client.
    expect(run({ origin: APP_ORIGIN, secFetchSite: 'cross-site' }).passed).toBe(false);
  });

  it('rejects the opaque "null" origin used by sandboxed frames', () => {
    expect(run({ origin: 'null' }).passed).toBe(false);
  });

  it('rejects a foreign Origin even when Sec-Fetch-Site is absent', () => {
    expect(run({ origin: 'https://evil.example' }).passed).toBe(false);
  });

  it('leaves safe methods alone, including emailed GET links from foreign origins', () => {
    expect(run({ method: 'GET', origin: 'https://mail.google.com', secFetchSite: 'cross-site' }).passed).toBe(true);
    expect(run({ method: 'HEAD', secFetchSite: 'cross-site' }).passed).toBe(true);
  });

  it('allows non-browser clients that send neither header', () => {
    // curl, the test suites, and scheduled jobs carry no ambient cookie, so the
    // guard must not become a availability problem for them.
    expect(run({}).passed).toBe(true);
  });

  it('allows user-initiated navigation (sec-fetch-site: none)', () => {
    expect(run({ secFetchSite: 'none' }).passed).toBe(true);
  });

  it('accepts the request host when APP_URL names a different valid hostname', () => {
    // Cloud Run serves the same revision on the custom domain and *.run.app.
    delete process.env.APP_URL;
    const result = run({ origin: 'https://cellarflow-abc123.run.app', host: 'cellarflow-abc123.run.app' });
    expect(result.passed).toBe(true);
  });

  it('still rejects a foreign origin when APP_URL is unset', () => {
    delete process.env.APP_URL;
    expect(run({ origin: 'https://evil.example', host: 'app.cellarflow.ge' }).passed).toBe(false);
  });
});
