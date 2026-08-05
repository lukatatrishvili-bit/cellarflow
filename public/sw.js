// Bump the version to invalidate all caches on deploy of a new SW.
const VERSION = 'v7';
const SHELL_CACHE = `vinea-shell-${VERSION}`;
const ASSET_CACHE = `vinea-assets-${VERSION}`;
const KNOWN_CACHES = [SHELL_CACHE, ASSET_CACHE];

// Minimal shell precache. Each entry is added individually and failures are
// tolerated, so a missing file can never block SW installation (cache.addAll
// is atomic and previously failed in production where dev paths 404).
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+Georgian:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => !KNOWN_CACHES.includes(key)).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Google Fonts (css + woff2): stale-while-revalidate so typography — incl.
  // Noto Sans Georgian — keeps working offline. Without this branch the
  // cross-origin early-return below made the SHELL precache of the font CSS
  // unreachable and fonts silently fell back offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(request, { cacheName: SHELL_CACHE }).then((cached) => {
        const refresh = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || refresh;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Never intercept the AI stream or Vite dev-server internals.
  if (
    url.pathname.startsWith('/api/gemini') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return;
  }

  // Navigations (HTML): network-first so deploys reach users immediately;
  // fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', clone));
          return response;
        })
        .catch(() => caches.match('/', { cacheName: SHELL_CACHE }))
    );
    return;
  }

  // Authenticated API responses are never stored in the shared service-worker
  // cache. Offline operational state is already handled by the user-scoped
  // local sync queue, avoiding stale or cross-account API responses.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Hashed build assets are immutable: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request, { cacheName: ASSET_CACHE }).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else (icons, manifest, fonts): stale-while-revalidate.
  event.respondWith(
    caches.match(request, { cacheName: SHELL_CACHE }).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});

// Server-routed task assignments and intelligence findings arrive only after
// the signed-in user explicitly opts this browser in. Payloads contain a
// validated notification projection, never provider credentials or raw winery
// snapshots.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === 'string' && payload.title
    ? payload.title
    : 'VinOS';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: typeof payload.icon === 'string' ? payload.icon : '/icon.svg',
    badge: typeof payload.badge === 'string' ? payload.badge : '/icon.svg',
    tag: typeof payload.tag === 'string' ? payload.tag : undefined,
    renotify: payload.renotify === true,
    requireInteraction: payload.requireInteraction === true,
    lang: payload.lang === 'ka' ? 'ka' : 'en',
    data: payload.data && typeof payload.data === 'object' ? payload.data : {},
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requested = typeof event.notification?.data?.url === 'string'
    ? event.notification.data.url
    : '/';
  const target = new URL(requested, self.location.origin);
  if (target.origin !== self.location.origin) target.href = `${self.location.origin}/`;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client) await client.navigate(target.href);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target.href) : undefined;
    })
  );
});
