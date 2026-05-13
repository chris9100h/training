const CACHE = 'logbook-1.03';
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
    caches.open(CACHE).then(c => c.addAll(ASSETS))
    // no skipWaiting() — wait for user confirmation
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
  // Only cache GET requests for our own origin
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
