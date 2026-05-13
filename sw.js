const CACHE = 'logbook-1.07';
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

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Network-first: always try to fetch fresh, fall back to cache when offline
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
