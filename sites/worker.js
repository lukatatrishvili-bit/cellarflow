function backendOrigin(env) {
  const configured = String(env?.BACKEND_ORIGIN || '').trim();
  if (!configured) {
    throw new Error('BACKEND_ORIGIN must be configured.');
  }
  const url = new URL(configured);
  if (url.protocol !== 'https:') {
    throw new Error('BACKEND_ORIGIN must use HTTPS.');
  }
  return url.origin;
}

function isAppNavigation(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (request.headers.get('accept')?.includes('text/html')) return true;
  const lastSegment = url.pathname.split('/').pop() || '';
  return !lastSegment.includes('.');
}

function rewriteBackendRedirect(response, origin, publicOrigin) {
  const location = response.headers.get('location');
  if (!location) return response;

  let target;
  try {
    target = new URL(location, origin);
  } catch {
    return response;
  }
  if (target.origin !== origin) return response;

  const headers = new Headers(response.headers);
  target.protocol = publicOrigin.protocol;
  target.host = publicOrigin.host;
  headers.set('location', target.toString());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function proxyApiRequest(request, env, publicUrl) {
  const origin = backendOrigin(env);
  const upstreamUrl = new URL(publicUrl.pathname + publicUrl.search, origin);
  const upstreamRequest = new Request(upstreamUrl, request);
  upstreamRequest.headers.delete('host');
  upstreamRequest.headers.set('x-forwarded-host', publicUrl.host);
  upstreamRequest.headers.set('x-forwarded-proto', publicUrl.protocol.slice(0, -1));

  const response = await fetch(upstreamRequest, { redirect: 'manual' });
  return rewriteBackendRedirect(response, origin, publicUrl);
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return proxyApiRequest(request, env, url);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404 || !isAppNavigation(request, url)) {
      return assetResponse;
    }

    const indexRequest = new Request(new URL('/index.html', url), request);
    return env.ASSETS.fetch(indexRequest);
  },
};

export {
  backendOrigin,
  isAppNavigation,
  proxyApiRequest,
  rewriteBackendRedirect,
};
export default worker;
