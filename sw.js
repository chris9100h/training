const CACHE = 'zane-v1.7';
const CDN_HOSTS = ['unpkg.com', 'cdnjs.cloudflare.com'];
const ASSETS = [
  '/training/',
  '/training/index.html',
  '/training/store.js',
  '/training/supabase.js',
  '/training/ui.jsx',
  '/training/screens-home.jsx',
  '/training/screens-schedule.jsx',
  '/training/screens-train.jsx',
  '/training/screens-lib.jsx',
  '/training/app.jsx',
  '/training/icons/icon-192.png',
  '/training/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

let _pushTimer = null;
let _pushCancel = null;

self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_PUSHOVER') {
    if (_pushTimer) { clearTimeout(_pushTimer); _pushCancel?.(); }
    const { endsAt, url, headers, body } = e.data;
    const delay = Math.max(0, endsAt - Date.now());
    let resolve;
    const p = new Promise(res => { resolve = res; }).catch(() => {});
    _pushCancel = () => { _pushTimer = null; resolve(); };
    _pushTimer = setTimeout(() => {
      _pushTimer = null;
      fetch(url, { method: 'POST', headers, body }).catch(() => {}).finally(resolve);
    }, delay);
    e.waitUntil(p);
  } else if (e.data?.type === 'CANCEL_PUSHOVER') {
    if (_pushTimer) { clearTimeout(_pushTimer); _pushCancel?.(); _pushTimer = null; }
  }
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

  // CDN libraries: cache-first so the app can boot fully offline.
  // Only cache complete CORS/same-origin responses — caching or serving an
  // opaque response for a CORS request makes the browser fail it.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => offlineResponse());
    })
  );
});
