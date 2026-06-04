const CACHE = 'zane-v1.967';
const CDN_HOSTS = ['unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
// Works at any base path (e.g. /training/ on GitHub Pages, / on custom domain)
const BASE = self.registration.scope.replace(/\/$/, '');
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/src/store.js',
  BASE + '/src/supabase.js',
  BASE + '/src/ui.jsx',
  BASE + '/src/screens-home.jsx',
  BASE + '/src/screens-schedule.jsx',
  BASE + '/src/screens-train.jsx',
  BASE + '/src/screens-lib.jsx',
  BASE + '/src/screens-settings.jsx',
  BASE + '/src/screens-coaching.jsx',
  BASE + '/src/app.jsx',
  BASE + '/icons/icon-192.png',
  BASE + '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Supabase REST / Realtime / Edge functions — never cache, always hit network
  if (url.hostname.endsWith('supabase.co')) return;

  const sameOrigin = url.origin === location.origin;
  const isCdn = CDN_HOSTS.includes(url.hostname);
  if (!sameOrigin && !isCdn) return;

  const offlineResponse = () => new Response('', { status: 504, statusText: 'Offline' });

  if (sameOrigin) {
    // _v=timestamp requests are version-check probes — always hit network, never cache
    if (url.searchParams.has('_v')) {
      e.respondWith(fetch(e.request.url).catch(() => offlineResponse()));
      return;
    }
    // App shell: stale-while-revalidate — serve cache instantly, refresh in background
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => cached || offlineResponse());
        return cached || network;
      })
    );
    return;
  }

  // CDN libraries + web fonts: cache-first so the app can boot fully offline.
  // Fetch in CORS mode so the response is never opaque — an opaque response
  // can't satisfy a CORS request (e.g. font-awesome, @font-face files) and
  // can't be reliably reused. unpkg, cdnjs and Google Fonts all send
  // permissive CORS headers, so a CORS fetch always succeeds for these hosts.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request.url, { mode: 'cors' }).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => offlineResponse());
    })
  );
});
