const CACHE = 'zane-v2.824';
// Decorative background photos live in their own cache, deliberately decoupled
// from CACHE's version. They are runtime-only: the worker never downloads the
// whole VIP catalogue during install. The page tells the worker which one
// background belongs to the currently loaded account; every other photo is
// removed from this cache. The app shell remains fully precached and untouched.
const PHOTOS_CACHE = 'zane-photos-v2';
const CDN_HOSTS = ['unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];
// Works at any base path (e.g. /training/ on GitHub Pages, / on custom domain)
const BASE = self.registration.scope.replace(/\/$/, '');
// Boot shell, everything the app needs to actually start. Cached atomically
// via addAll(): if any one of these 404s the install aborts (as it should, a
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
  BASE + '/src/screens-friends.jsx',
  BASE + '/src/screens-health.jsx',
  BASE + '/src/screens-water.jsx',
  BASE + '/src/screens-food.jsx',
  BASE + '/src/screens-medications.jsx',
  BASE + '/src/screens-onboarding.jsx',
  BASE + '/src/screens-cardio.jsx',
  BASE + '/src/screens-featuremap.jsx',
  BASE + '/src/screens-autoreg-guide.jsx',
  BASE + '/src/app.jsx',
  BASE + '/icons/icon-192.png',
  BASE + '/icons/icon-512.png',
  BASE + '/icons/icon-180.png',
];

// Public pages that live outside the app shell (CLAUDE.md, "Public-Seiten"),
// plus the one script only they load. Never precached, and never served from
// cache while the network is reachable, see the fetch handler. Matched against
// the request path, so a new public page has to be listed here as well as kept
// out of ASSETS.
// PATHS, not BASE-prefixed URLs. BASE is registration.scope with the trailing
// slash stripped, and scope is a serialized ABSOLUTE url ("https://host/training"),
// which is right for ASSETS because CacheStorage is keyed by url. The fetch
// handler matches these against url.pathname ("/training/welcome.html"), and a
// path can never equal nor end with a string starting "https:", so the first
// version of this list was dead on arrival: every public page kept falling
// through to the stale-while-revalidate branch and kept being frozen in the
// versioned cache, exactly the behaviour it was added to remove. Keeping them
// relative to BASE's own path makes the comparison a path-to-path one, and
// tools/check-asset-parity.cjs now fails the build if they go back to BASE.
const BASE_PATH = new URL(BASE + '/', self.location.href).pathname.replace(/\/$/, '');
const PUBLIC_PAGES = [
  BASE_PATH + '/welcome.html',
  BASE_PATH + '/features.html',
  BASE_PATH + '/autoreg.html',
  BASE_PATH + '/src/autoreg-guide-page.js',
];

// CDN libraries the app boots with. Precached best-effort so the app is fully
// offline-capable right after the first load, but kept out of the atomic
// addAll() above so a CDN hiccup can never abort the install. Babel is included
// so that a fresh cache after an update can still transpile offline (on a
// cache miss the organic CDN path would otherwise fail with no network).
const CDN_ASSETS = [
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js',
];

// cache.addAll()/cache.add() don't force a network round-trip, being handed
// a plain URL (not a Request with explicit cache options), they can be
// satisfied by the browser's own HTTP cache, a layer entirely below
// CacheStorage. If the static host serves these files with any freshness
// window, a brand-new SW version's install step could silently precache the
// very stale bytes the update exists to replace, every check in this file
// (checkSwUpdate's ?_v= probe, the runtime fetch handler below) works hard to
// avoid exactly that, so precaching needs the same guarantee. Fetch each
// asset with cache:'no-store' explicitly instead.
function precacheAll(cache, urls) {
  return Promise.all(urls.map(url =>
    fetch(url, { cache: 'no-store' }).then(res => {
      if (!res.ok) throw new Error(`Precache failed: ${url} (${res.status})`);
      // A host that redirects this URL (e.g. Cloudflare's clean-URL handling
      // turning /index.html into /) hands back a Response with redirected
      // === true, and Cache Storage preserves that flag on the stored entry.
      // Serving such an entry later via respondWith() for a navigation is
      // rejected by the browser ("Response served by service worker has
      // redirections"), so rebuild a plain Response before storing it.
      if (res.redirected) res = new Response(res.body, res);
      return cache.put(url, res);
    })
  ));
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      precacheAll(c, ASSETS).then(() =>
        Promise.allSettled(
          CDN_ASSETS.map(u => fetch(new Request(u, { mode: 'cors', cache: 'no-store' })).then(res => { if (res.ok) return c.put(u, res); }).catch(() => {}))
        )
      )
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      // PHOTOS_CACHE is versioned independently of CACHE (see its
      // declaration above), never swept here alongside old app-shell caches.
      Promise.all(keys.filter(k => k !== CACHE && k !== PHOTOS_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (e.data?.type === 'SET_BACKGROUND') {
    // The page is the authority for the current account's selected image.
    // Clearing is also used on logout and before a new account is hydrated,
    // so a previous user's VIP image does not remain in this origin's cache.
    e.waitUntil(pruneBackgroundCache(e.data?.url || null));
    return;
  }
  // Authoritative answer to "which app-shell version is actually running".
  // The page cannot work this out by listing CacheStorage: skipWaiting() hands
  // control to this worker as soon as it activates, BEFORE the activate
  // handler's waitUntil (and therefore its old-cache sweep) has settled, so a
  // page reading caches.keys() at controllerchange can still see the previous
  // cache and record the wrong version. Only the running worker knows.
  if (e.data?.type === 'GET_VERSION') { e.ports?.[0]?.postMessage(CACHE); return; }
});

function backgroundUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, self.location.href);
    const basePath = new URL(BASE + '/', self.location.href).pathname.replace(/\/$/, '') + '/Background/';
    if (url.origin !== self.location.origin || !url.pathname.startsWith(basePath)) return null;
    if (url.pathname.endsWith('/index.json')) return null;
    return url;
  } catch (_) {
    return null;
  }
}

async function pruneBackgroundCache(keepValue) {
  const keep = backgroundUrl(keepValue);
  const keepPath = keep?.pathname || null;
  if (!keep && !(await caches.has(PHOTOS_CACHE))) return;
  const cache = await caches.open(PHOTOS_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.map(request => {
    const url = new URL(request.url);
    const basePath = new URL(BASE + '/', self.location.href).pathname.replace(/\/$/, '') + '/Background/';
    const isPhoto = url.origin === self.location.origin && url.pathname.startsWith(basePath);
    if (!isPhoto || (keepPath && url.pathname === keepPath)) return undefined;
    return cache.delete(request);
  }));
}

function cacheBackgroundResponse(request, response) {
  return caches.open(PHOTOS_CACHE)
    .then(cache => cache.put(request, response))
    .then(() => pruneBackgroundCache(request.url));
}

self.addEventListener('push', e => {
  // A non-JSON payload (a test push, a truncated delivery) throws here; every
  // real sender always sends JSON, but without the guard that throw aborts
  // the whole handler before e.waitUntil ever runs, so no notification shows
  // at all despite the userVisibleOnly subscription.
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
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
  const requestedUrl = e.notification.data?.url || BASE + '/';
  let targetUrl = new URL(BASE + '/', self.location.href).href;
  try {
    const candidate = new URL(requestedUrl, targetUrl);
    // Push payloads are app-controlled. Still constrain navigation to this
    // origin and registration scope so a malformed/stale payload cannot turn
    // a notification click into an external redirect.
    if (candidate.origin === self.location.origin && candidate.href.startsWith(BASE + '/')) {
      targetUrl = candidate.href;
    }
  } catch (_) {}
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const match = cs.find(c => c.url.startsWith(BASE));
      if (match) {
        return match.navigate(targetUrl).catch(() => null).then(() => match.focus());
      }
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Supabase REST / Realtime / Edge functions, never cache, always hit network
  if (url.hostname.endsWith('supabase.co')) return;

  const sameOrigin = url.origin === location.origin;
  const isCdn = CDN_HOSTS.includes(url.hostname);
  if (!sameOrigin && !isCdn) return;

  const offlineResponse = () => new Response('', { status: 504, statusText: 'Offline' });

  if (sameOrigin) {
    // _v=timestamp requests are version-check probes, always hit network, never cache
    if (url.searchParams.has('_v')) {
      e.respondWith(fetch(e.request.url, { cache: 'no-store' }).catch(() => offlineResponse()));
      return;
    }
    // The standalone public pages (welcome/features/autoreg and the JS only
    // they load) are deliberately NOT in ASSETS: they carry their own ?v=
    // busters and are meant to update the moment they are redeployed, without
    // waiting for a service worker cycle. Being outside ASSETS did not keep
    // them out of the cache, though. Every same-origin GET falls into the
    // stale-while-revalidate block below, which caches whatever it fetches, so
    // the first visit put them in the versioned CACHE and every later visit was
    // answered from it: a marketing page frozen at whatever it said the day the
    // user first opened it, which is the exact failure the busters exist to
    // prevent. Network-first, cache only as an offline fallback.
    // Compared as paths (see PUBLIC_PAGES). endsWith as well as equality so the
    // match survives a deploy under a different base path; the query string is
    // deliberately not part of it, welcome.html takes ?share=<token> deep links.
    if (PUBLIC_PAGES.some(p => url.pathname === p || url.pathname.endsWith(p))) {
      e.respondWith(
        fetch(e.request, { cache: 'no-store' }).then(res => {
          // These pages are NAVIGATIONS, and the browser refuses to serve a
          // redirected response for one ("response has redirections"). The
          // shell branch below has defended against that since the Cloudflare
          // clean-URL incident (see precacheAll); this branch serves the same
          // kind of request and needs the same rebuild, or a host-side
          // redirect would stop these pages loading at all, online included.
          if (res.redirected) res = new Response(res.body, res);
          // Write-through, read only as an offline fallback. The first
          // network-first version skipped the cache entirely, which fixed the
          // staleness and silently emptied the offline path with it:
          // activate() wipes the previous cache generation on every bump and
          // nothing refilled these pages, so an offline open after any bump
          // got a blank 504 instead of the page from the last online visit.
          // Freshness is unchanged: the cache is only read when the network
          // is unreachable.
          if (res.ok) {
            const clone = res.clone();
            e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {}));
          }
          return res;
        }).catch(() =>
          // Exact URL first, then the query-less page: welcome.html carries
          // ?share=<token> deep links and the cache keys on the full URL, so
          // the plain page from a previous visit beats a blank 504.
          caches.match(e.request)
            .then(c => c || caches.match(url.origin + url.pathname))
            .then(c => c || offlineResponse())
        )
      );
      return;
    }
    // The active worker's app-shell cache is immutable for its generation.
    // install() populated it with no-store requests, and a newly activated
    // worker owns a newly populated generation. Serving these exact assets
    // cache-first avoids a network request and cache write for every JSX file
    // the boot loader reads on every warm start. The explicit _v probe above
    // remains network-only and is what discovers a newer worker.
    const appAssetUrl = url.origin + url.pathname;
    const isAppAsset = !url.search && ASSETS.includes(appAssetUrl);
    const isBackgroundPhoto = url.pathname.includes('/Background/');
    if (isAppAsset || isBackgroundPhoto) {
      e.respondWith(
        caches.match(e.request).then(cached => {
          if (cached) {
            if (isBackgroundPhoto) e.waitUntil(pruneBackgroundCache(e.request.url));
            return cached;
          }
          return fetch(e.request, { cache: 'no-store' }).then(res => {
            if (res.redirected) res = new Response(res.body, res);
            if (res.ok) {
              const clone = res.clone();
              e.waitUntil(isBackgroundPhoto
                ? cacheBackgroundResponse(e.request, clone).catch(() => {})
                : caches.open(CACHE).then(c => c.put(e.request, clone).catch(() => {})));
            }
            return res;
          }).catch(() => {
            if (e.request.mode === 'navigate') return caches.match(BASE + '/').then(c => c || offlineResponse());
            return offlineResponse();
          });
        })
      );
      return;
    }

    // Unlisted same-origin resources stay stale-while-revalidate. This covers
    // runtime-created files without making them part of the immutable shell.
    // { cache: 'no-store' } on the network fetch matters a lot more than it looks:
    // after a deliberate cache wipe (LB.clearCachesAndReload / "Clear cache &
    // reload"), every request here is a CacheStorage miss and falls through to
    // this fetch, but a plain fetch() is still answered by the BROWSER's own
    // HTTP cache (a layer entirely below CacheStorage, untouched by wiping it),
    // so static <script src> tags and the precompile loader's own fetch(src)
    // calls (index.html) could still silently resolve to stale bytes even
    // though every app-level cache had just been cleared. no-store forces an
    // actual network round-trip regardless of what the browser has cached.
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request, { cache: 'no-store' }).then(res => {
          // Same reasoning as precacheAll above: a redirected same-origin
          // response (e.g. Cloudflare turning /index.html into /) can't be
          // respondWith()'d for a navigation as-is, rebuild it first.
          if (res.redirected) res = new Response(res.body, res);
          if (res.ok) {
            const clone = res.clone();
            // A background photo fetched at runtime belongs in PHOTOS_CACHE,
            // not the short-lived versioned CACHE: otherwise it would get
            // wiped again on the next deploy.
            const target = url.pathname.includes('/Background/') ? PHOTOS_CACHE : CACHE;
            e.waitUntil(caches.open(target).then(c => c.put(e.request, clone)).catch(() => {}));
          }
          return res;
        }).catch(() => {
          if (cached) return cached;
          // A navigation can miss the cache on its query string alone: the
          // recipe-share deep link opens the app root as "/?share=<token>",
          // CacheStorage keys on the full URL, and the shell is stored
          // without one. The app reads the token from location.search after
          // boot either way, so the cached shell is the right answer, and a
          // blank 504 for a user carrying the entire app in their cache is
          // not. Public pages never reach this branch (matched above), so
          // this cannot make welcome.html impersonate the app.
          if (e.request.mode === 'navigate') return caches.match(BASE + '/').then(c => c || offlineResponse());
          return offlineResponse();
        });
        // The background refresh has to OUTLIVE respondWith. When the cached
        // copy is served (the normal, warm case) nothing else keeps this
        // worker alive, and a worker torn down early takes the revalidation
        // and its cache.put with it, so the stale copy survives until the
        // NEXT visit and the app stays one deploy behind for longer than the
        // stale-while-revalidate contract implies. Registered synchronously
        // inside the respondWith chain, which also keeps the event extendable
        // for the put's own waitUntil above.
        e.waitUntil(network.catch(() => {}));
        return cached || network;
      })
    );
    return;
  }

  // CDN libraries + web fonts: cache-first so the app can boot fully offline.
  // Fetch in CORS mode so the response is never opaque, an opaque response
  // can't satisfy a CORS request (e.g. font-awesome, @font-face files) and
  // can't be reliably reused. unpkg, cdnjs and Google Fonts all send
  // permissive CORS headers, so a CORS fetch always succeeds for these hosts.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request.url, { mode: 'cors', cache: 'no-store' }).then(res => {
        if (res.ok) {
          const clone = res.clone();
          // waitUntil for the same reason as the shell branch: the response
          // is served immediately, and without an extension the worker can be
          // torn down before the put lands, leaving the library uncached for
          // the next offline boot.
          e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {}));
        }
        return res;
      }).catch(() => offlineResponse());
    })
  );
});
