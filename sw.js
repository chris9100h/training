const CACHE = 'zane-v2.572';
const CDN_HOSTS = ['unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
// Works at any base path (e.g. /training/ on GitHub Pages, / on custom domain)
const BASE = self.registration.scope.replace(/\/$/, '');
// Boot shell — everything the app needs to actually start. Cached atomically
// via addAll(): if any one of these 404s the install aborts (as it should — a
// missing shell file means a broken deploy).
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
  BASE + '/src/store.js',
  BASE + '/src/supabase.js',
  BASE + '/src/whatsnew.js',
  BASE + '/src/exercise-db.js',
  BASE + '/src/feature-map-db.js',
  BASE + '/src/programs-db.js',
  BASE + '/src/ui.jsx',
  BASE + '/src/screens-home.jsx',
  BASE + '/src/screens-schedule.jsx',
  BASE + '/src/screens-train.jsx',
  BASE + '/src/screens-lib.jsx',
  BASE + '/src/screens-settings.jsx',
  BASE + '/src/screens-coaching-core.jsx',
  BASE + '/src/screens-coaching-client.jsx',
  BASE + '/src/screens-coaching-detail.jsx',
  BASE + '/src/screens-coaching-tabs.jsx',
  BASE + '/src/screens-health.jsx',
  BASE + '/src/screens-onboarding.jsx',
  BASE + '/src/screens-cardio.jsx',
  BASE + '/src/screens-featuremap.jsx',
  BASE + '/src/app.jsx',
  BASE + '/icons/icon-192.png',
  BASE + '/icons/icon-512.png',
  BASE + '/icons/icon-180.png',
];

// Decorative background photos + their index. Purely cosmetic, and their file
// names/extensions drift (e.g. .png vs .PNG on case-sensitive hosting), so a
// single 404 here must NOT abort the whole SW install. Precached best-effort.
const PHOTO_ASSETS = [
  BASE + '/Background/Appy.png',
  BASE + '/Background/phoenix.png',
  BASE + '/Background/marine.png',
  BASE + '/Background/prince_abu.png',
  BASE + '/Background/Chris1.PNG',
  BASE + '/Background/Chris2.PNG',
  BASE + '/Background/akxyl.png',
  BASE + '/Background/IMG_6817.png',
  BASE + '/Background/Brettski.PNG',
  BASE + '/Background/IMG_6950.png',
  BASE + '/Background/index.json',
];

// CDN libraries the app boots with. Precached best-effort so the app is fully
// offline-capable right after the first load — but kept out of the atomic
// addAll() above so a CDN hiccup can never abort the install. Babel is included
// so that a fresh cache after an update can still transpile offline (on a
// cache miss the organic CDN path would otherwise fail with no network).
const CDN_ASSETS = [
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js',
];

// cache.addAll()/cache.add() don't force a network round-trip — being handed
// a plain URL (not a Request with explicit cache options), they can be
// satisfied by the browser's own HTTP cache, a layer entirely below
// CacheStorage. If the static host serves these files with any freshness
// window, a brand-new SW version's install step could silently precache the
// very stale bytes the update exists to replace — every check in this file
// (checkSwUpdate's ?_v= probe, the runtime fetch handler below) works hard to
// avoid exactly that, so precaching needs the same guarantee. Fetch each
// asset with cache:'no-store' explicitly instead.
function precacheAll(cache, urls) {
  return Promise.all(urls.map(url =>
    fetch(url, { cache: 'no-store' }).then(res => {
      if (!res.ok) throw new Error(`Precache failed: ${url} (${res.status})`);
      return cache.put(url, res);
    })
  ));
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      precacheAll(c, ASSETS).then(() =>
        Promise.allSettled([].concat(
          PHOTO_ASSETS.map(u => fetch(u, { cache: 'no-store' }).then(res => { if (res.ok) return c.put(u, res); }).catch(() => {})),
          CDN_ASSETS.map(u => fetch(new Request(u, { mode: 'cors', cache: 'no-store' })).then(res => { if (res.ok) return c.put(u, res); }).catch(() => {}))
        ))
      )
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Slot for the active SW-managed rest timer (one at a time).
const _restTimer = { id: null, resolve: null };

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') { self.skipWaiting(); return; }

  if (e.data?.type === 'SCHEDULE_REST_TIMER') {
    // Cancel any previously scheduled timer and release its waitUntil promise.
    clearTimeout(_restTimer.id); _restTimer.id = null;
    if (_restTimer.resolve) { _restTimer.resolve(); _restTimer.resolve = null; }

    const { delayMs = 0, title, body } = e.data;
    // waitUntil keeps the SW alive for the full rest duration.
    e.waitUntil(new Promise(resolve => {
      _restTimer.resolve = resolve;
      _restTimer.id = setTimeout(async () => {
        _restTimer.id = null; _restTimer.resolve = null;
        // Skip notification if any app window is currently focused.
        const cs = await clients.matchAll({ type: 'window' });
        if (!cs.some(c => c.focused)) {
          await self.registration.showNotification(title || 'Zane · Rest done', {
            body: body || 'Time to start your next set! 💪',
            icon: BASE + '/icons/icon-192.png',
            badge: BASE + '/icons/icon-192.png',
            tag: 'rest-timer',
          });
        }
        resolve();
      }, delayMs);
    }));
    return;
  }

  if (e.data?.type === 'CANCEL_REST_TIMER') {
    clearTimeout(_restTimer.id); _restTimer.id = null;
    if (_restTimer.resolve) { _restTimer.resolve(); _restTimer.resolve = null; }
    return;
  }
});

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Zane', {
      body: data.body || '',
      icon: BASE + '/icons/icon-192.png',
      badge: BASE + '/icons/icon-192.png',
      data: { url: data.url || BASE + '/' },
      tag: 'zane-push',
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || BASE + '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const match = cs.find(c => c.url.startsWith(BASE));
      if (match) return match.focus();
      return clients.openWindow(url);
    })
  );
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
      e.respondWith(fetch(e.request.url, { cache: 'no-store' }).catch(() => offlineResponse()));
      return;
    }
    // App shell: stale-while-revalidate — serve cache instantly, refresh in background.
    // { cache: 'no-store' } on the network fetch matters a lot more than it looks:
    // after a deliberate cache wipe (LB.clearCachesAndReload / "Clear cache &
    // reload"), every request here is a CacheStorage miss and falls through to
    // this fetch — but a plain fetch() is still answered by the BROWSER's own
    // HTTP cache (a layer entirely below CacheStorage, untouched by wiping it),
    // so static <script src> tags and the precompile loader's own fetch(src)
    // calls (index.html) could still silently resolve to stale bytes even
    // though every app-level cache had just been cleared. no-store forces an
    // actual network round-trip regardless of what the browser has cached.
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request, { cache: 'no-store' }).then(res => {
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
      return fetch(e.request.url, { mode: 'cors', cache: 'no-store' }).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => offlineResponse());
    })
  );
});
