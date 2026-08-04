import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, {
  backendOrigin,
  isAppNavigation,
  rewriteBackendRedirect,
} from '../sites/worker.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Sites deployment worker', () => {
  it('requires an HTTPS backend origin', () => {
    expect(backendOrigin({ BACKEND_ORIGIN: 'https://api.example.com/' })).toBe('https://api.example.com');
    expect(() => backendOrigin({})).toThrow(/must be configured/i);
    expect(() => backendOrigin({ BACKEND_ORIGIN: 'http://api.example.com' })).toThrow(/HTTPS/);
  });

  it('recognizes client-side routes without treating asset paths as navigation', () => {
    expect(isAppNavigation(new Request('https://cellarflow.example/cellar'), new URL('https://cellarflow.example/cellar'))).toBe(true);
    expect(isAppNavigation(new Request('https://cellarflow.example/assets/app.js'), new URL('https://cellarflow.example/assets/app.js'))).toBe(false);
  });

  it('serves static assets and falls back to index.html for app routes', async () => {
    const assets = {
      fetch: vi.fn(async (request: Request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/index.html') return new Response('<main>VinOS</main>');
        return new Response('missing', { status: 404 });
      }),
    };

    const response = await worker.fetch(
      new Request('https://cellarflow.example/cellar', {
        headers: { accept: 'text/html' },
      }),
      { ASSETS: assets },
    );

    expect(await response.text()).toContain('VinOS');
    expect(assets.fetch).toHaveBeenCalledTimes(2);
    expect(new URL(assets.fetch.mock.calls[1][0].url).pathname).toBe('/index.html');
  });

  it('proxies API requests to the existing application backend', async () => {
    const upstreamFetch = vi.fn(async (request: Request) => (
      Response.json({
        host: new URL(request.url).host,
        forwardedHost: request.headers.get('x-forwarded-host'),
      })
    ));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await worker.fetch(
      new Request('https://cellarflow.example/api/health'),
      {
        ASSETS: { fetch: vi.fn() },
        BACKEND_ORIGIN: 'https://api.example.com',
      },
    );

    await expect(response.json()).resolves.toEqual({
      host: 'api.example.com',
      forwardedHost: 'cellarflow.example',
    });
  });

  it('rewrites same-backend redirects to the deployed site origin', () => {
    const response = rewriteBackendRedirect(
      new Response(null, {
        status: 302,
        headers: { location: 'https://api.example.com/settings?tab=profile' },
      }),
      'https://api.example.com',
      new URL('https://cellarflow.example/api/auth/login'),
    );

    expect(response.headers.get('location')).toBe('https://cellarflow.example/settings?tab=profile');
  });
});
