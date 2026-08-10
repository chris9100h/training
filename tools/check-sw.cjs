#!/usr/bin/env node
/* Runs the REAL sw.js in a node vm and drives real requests through its fetch
   handler. This file exists because sw.js had no runtime coverage anywhere:
   check-syntax transpiles it and check-asset-parity reads its string literals,
   but nothing ever EXECUTED a branch, which is how a guard comparing an
   absolute URL to a pathname shipped as dead code through six green gates
   (v2.733, the PUBLIC_PAGES url/path mixup). String checks catch the one
   spelling of that bug; executing the handler catches the behaviour.

   What it pins, per scenario:
     - branch routing under a sub-path scope AND a root scope (supabase and
       foreign origins untouched, ?_v= probes bypass, public pages
       network-first, app shell stale-while-revalidate, CDN cache-first)
     - offline behaviour: warm shell serves, cold shell 504s, public pages
       fall back to the last online copy, a ?share= navigation gets the shell
     - background work (revalidation, cache.put) is registered via
       event.waitUntil, so a worker torn down after respondWith cannot lose it
     - redirected responses are rebuilt before being served or stored
     - install is atomic over ASSETS; activate sweeps old generations but
       never PHOTOS_CACHE

   Usage: node tools/check-sw.cjs [path-to-sw.js]   (default: repo sw.js) */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const swPath = process.argv[2] || path.join(root, 'sw.js');
const src = fs.readFileSync(swPath, 'utf8');

const CACHE_NAME = (src.match(/const CACHE = '([^']+)'/) || [])[1];
const PHOTOS_NAME = (src.match(/const PHOTOS_CACHE = '([^']+)'/) || [])[1];
if (!CACHE_NAME || !PHOTOS_NAME) {
  console.error('FAIL could not parse CACHE / PHOTOS_CACHE from sw.js');
  process.exit(1);
}

// ── Minimal browser fakes ───────────────────────────────────────────────────
class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.statusText = init.statusText ?? '';
    // Constructing a Response from another one deliberately drops the
    // redirected flag, mirroring the rebuild idiom sw.js relies on.
    this.redirected = false;
  }
  clone() {
    const c = new FakeResponse(this.body, this);
    c.redirected = this.redirected;
    return c;
  }
}
class FakeRequest {
  constructor(input, init = {}) {
    this.url = typeof input === 'string' ? input : input.url;
    this.method = init.method || 'GET';
    this.mode = init.mode || 'cors';
  }
}
// Models the two browser realities the first version of this harness missed,
// which let a mutation that removed the SWR waitUntil pass green:
//   1. an event is only extendable while its respondWith promise is pending or
//      at least one extension is; a later waitUntil throws InvalidStateError.
//   2. the network never beats the cache. The fetch stub resolves on a
//      MACROtask (see makeWorld), so any waitUntil registered from inside a
//      network .then really does arrive after the cached response settled,
//      exactly when the real browser would reject it.
class FetchEvent {
  constructor(request) {
    this.request = request; this.responded = false; this.resp = null;
    this.ext = []; this._pending = 0; this._respPending = false;
  }
  get active() { return this._respPending || this._pending > 0; }
  respondWith(p) {
    this.responded = true; this._respPending = true;
    this.resp = Promise.resolve(p);
    this.resp.catch(() => {}).finally(() => { this._respPending = false; });
  }
  waitUntil(p) {
    if (this.responded && !this.active) throw new Error('InvalidStateError: waitUntil after the event settled (nothing kept it alive)');
    this._pending++;
    this.ext.push(Promise.resolve(p).catch(() => {}).finally(() => { this._pending--; }));
  }
}

// A world = one freshly evaluated sw.js under one scope, with its own cache
// storage and network. Fresh per scenario so no state leaks between tests.
function makeWorld(scope) {
  const stores = new Map(); // cache name -> Map(url -> FakeResponse)
  const keyOf = (req) => (typeof req === 'string' ? req : req.url);
  const cacheFor = (name) => ({
    put: async (req, res) => { stores.get(name).set(keyOf(req), res); },
    match: async (req) => { const hit = stores.get(name).get(keyOf(req)); return hit ? hit.clone() : undefined; },
  });
  const caches = {
    open: async (name) => { if (!stores.has(name)) stores.set(name, new Map()); return cacheFor(name); },
    has: async (name) => stores.has(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (req) => {
      const u = keyOf(req);
      for (const m of stores.values()) if (m.has(u)) return m.get(u).clone();
      return undefined;
    },
  };
  const net = {
    offline: false,
    // url -> FakeResponse; default 200 echoing the url so bodies are assertable
    respond: (url) => new FakeResponse('net:' + url, { status: 200 }),
  };
  const fetchStub = async (input, _init) => {
    // One macrotask of latency: the cache always answers first, as in a real
    // browser. Without this, everything settles in the same microtask sweep
    // and the event-lifetime rule above can never fire.
    await new Promise(r => setTimeout(r, 0));
    if (net.offline) throw new TypeError('Failed to fetch');
    return net.respond(typeof input === 'string' ? input : input.url);
  };
  const handlers = {};
  const location = new URL(scope + 'sw.js');
  const sandbox = {
    console, URL, Promise, JSON, Math, Date, setTimeout, clearTimeout,
    Response: FakeResponse, Request: FakeRequest,
    caches, fetch: fetchStub, location,
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
  };
  sandbox.self = {
    registration: { scope, showNotification: async () => {} },
    location, skipWaiting: () => {}, clients: sandbox.clients,
    addEventListener: (t, fn) => { handlers[t] = fn; },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'sw.js' });
  const seed = (cacheName, url, body) => {
    if (!stores.has(cacheName)) stores.set(cacheName, new Map());
    stores.get(cacheName).set(url, new FakeResponse(body));
  };
  const hit = async (url, opts = {}) => {
    const ev = new FetchEvent(new FakeRequest(url, opts));
    handlers.fetch(ev);
    const res = ev.responded ? await ev.resp : undefined;
    return { ev, res };
  };
  // waitUntil entries can be appended from inside earlier entries (the put is
  // registered inside the network refresh), and the fetch stub resolves on a
  // macrotask, so drain a few real ticks rather than one microtask sweep.
  const settle = async (ev) => {
    for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 0)); await Promise.all([...ev.ext]); }
  };
  const cacheBody = (cacheName, url) => stores.get(cacheName)?.get(url)?.body;
  return { handlers, stores, net, clients: sandbox.clients, seed, hit, settle, cacheBody, scope };
}

// ── Scenarios ───────────────────────────────────────────────────────────────
const S = 'https://zane-wo.com/training/';
const failures = [];
const check = (name, cond, detail) => { if (!cond) failures.push(`${name}: ${detail}`); };

const scenarios = [
  ['routing: supabase, POST and foreign origins stay untouched', async () => {
    const w = makeWorld(S);
    check('supabase', !(await w.hit('https://xyz.supabase.co/rest/v1/zane_sets')).ev.responded, 'respondWith was called for a supabase request');
    check('post', !(await w.hit(S + 'src/store.js', { method: 'POST' })).ev.responded, 'respondWith was called for a POST');
    check('foreign', !(await w.hit('https://example.com/a.js')).ev.responded, 'respondWith was called for a foreign origin');
  }],

  ['notification click: an existing app window navigates before focus', async () => {
    const w = makeWorld(S);
    const calls = { navigated: null, focused: 0 };
    const client = {
      url: S,
      navigate: async (url) => { calls.navigated = url; client.url = url; return client; },
      focus: async () => { calls.focused++; return client; },
    };
    w.clients.matchAll = async () => [client];
    let done;
    w.handlers.notificationclick({
      notification: { data: { url: S + 'health?from=push' }, close: () => {} },
      waitUntil: promise => { done = Promise.resolve(promise); },
    });
    await done;
    check('notification-navigate', calls.navigated === S + 'health?from=push', `existing client stayed on ${calls.navigated}`);
    check('notification-focus', calls.focused === 1, 'existing client was not focused after navigation');
  }],

  ['version probe: ?_v= hits the network and is never cached', async () => {
    const w = makeWorld(S);
    const { ev, res } = await w.hit(S + 'src/store.js?_v=123');
    await w.settle(ev);
    check('probe-body', res.body === 'net:' + S + 'src/store.js?_v=123', `got ${res && res.body}`);
    check('probe-uncached', ![...(w.stores.get(CACHE_NAME) || new Map()).keys()].length, 'the probe landed in the cache');
  }],

  ['app shell: warm cache serves stale, refresh runs under waitUntil', async () => {
    const w = makeWorld(S);
    w.seed(CACHE_NAME, S + 'src/store.js', 'old');
    const { ev, res } = await w.hit(S + 'src/store.js');
    check('swr-stale', res.body === 'old', `served ${res && res.body}, expected the cached copy`);
    check('swr-waituntil', ev.ext.length >= 1, 'the background refresh is fire-and-forget: a worker torn down after respondWith loses the revalidation and its cache.put');
    await w.settle(ev);
    check('swr-refreshed', w.cacheBody(CACHE_NAME, S + 'src/store.js') === 'net:' + S + 'src/store.js', 'the revalidated copy never reached the cache');
  }],

  ['app shell offline: warm serves, cold 504s', async () => {
    const w = makeWorld(S);
    w.seed(CACHE_NAME, S + 'src/app.jsx', 'cached-app');
    w.net.offline = true;
    check('offline-warm', (await w.hit(S + 'src/app.jsx')).res.body === 'cached-app', 'cached copy not served offline');
    check('offline-cold', (await w.hit(S + 'src/ui.jsx')).res.status === 504, 'expected 504 for an uncached file offline');
  }],

  ['share deep link offline: the cached shell answers, not a 504', async () => {
    const w = makeWorld(S);
    w.seed(CACHE_NAME, S, 'shell');
    w.net.offline = true;
    const { res } = await w.hit(S + '?share=abc', { mode: 'navigate' });
    check('share-nav', res.body === 'shell', `a navigation with a query got ${res.status === 504 ? 'a 504' : res.body} despite the fully cached shell (cache keys on the full URL)`);
  }],

  ['public page online: network-first with write-through', async () => {
    const w = makeWorld(S);
    w.seed(CACHE_NAME, S + 'welcome.html', 'stale-marketing');
    const { ev, res } = await w.hit(S + 'welcome.html', { mode: 'navigate' });
    check('public-fresh', res.body === 'net:' + S + 'welcome.html', `served ${res && res.body}, the cache must never answer while the network is up`);
    await w.settle(ev);
    check('public-writethrough', w.cacheBody(CACHE_NAME, S + 'welcome.html') === 'net:' + S + 'welcome.html', 'the fresh copy was not written through, so the offline fallback still holds the stale one (or nothing after a bump)');
  }],

  ['public page offline: the last online copy answers after a visit', async () => {
    const w = makeWorld(S);
    const first = await w.hit(S + 'features.html', { mode: 'navigate' });
    await w.settle(first.ev);
    w.net.offline = true;
    const { res } = await w.hit(S + 'features.html', { mode: 'navigate' });
    check('public-offline', res.body === 'net:' + S + 'features.html', `offline after an online visit got ${res.status === 504 ? 'a blank 504' : res && res.body}`);
  }],

  ['public page offline cold: 504, never the app shell', async () => {
    const w = makeWorld(S);
    w.seed(CACHE_NAME, S, 'shell');
    w.net.offline = true;
    const { res } = await w.hit(S + 'welcome.html', { mode: 'navigate' });
    check('public-cold', res.status === 504, 'a never-visited public page must 504 offline, not impersonate the app');
  }],

  ['public share link offline: query-less copy answers', async () => {
    const w = makeWorld(S);
    const first = await w.hit(S + 'welcome.html', { mode: 'navigate' });
    await w.settle(first.ev);
    w.net.offline = true;
    const { res } = await w.hit(S + 'welcome.html?share=tok', { mode: 'navigate' });
    check('public-share', res.body === 'net:' + S + 'welcome.html', `?share= offline got ${res.status === 504 ? 'a 504' : res && res.body} although the plain page is cached`);
  }],

  ['CDN: cache-first, populated on first fetch, offline thereafter', async () => {
    const w = makeWorld(S);
    const u = 'https://unpkg.com/react@18.3.1/umd/react.production.min.js';
    const first = await w.hit(u);
    check('cdn-first', first.res.body === 'net:' + u, 'first CDN hit did not come from the network');
    check('cdn-waituntil', first.ev.ext.length >= 1, 'the CDN cache.put is fire-and-forget');
    await w.settle(first.ev);
    w.net.offline = true;
    check('cdn-offline', (await w.hit(u)).res.body === 'net:' + u, 'the cached CDN copy did not answer offline');
  }],

  ['background photos land in PHOTOS_CACHE, not the versioned cache', async () => {
    const w = makeWorld(S);
    const u = S + 'Background/marine.png';
    const { ev } = await w.hit(u);
    await w.settle(ev);
    check('photo-target', w.cacheBody(PHOTOS_NAME, u) != null, 'the photo was not stored in PHOTOS_CACHE');
    check('photo-not-versioned', w.cacheBody(CACHE_NAME, u) == null, 'the photo landed in the versioned cache and dies on the next bump');
  }],

  ['redirected responses are rebuilt before being served', async () => {
    const w = makeWorld(S);
    w.net.respond = (url) => { const r = new FakeResponse('net:' + url); r.redirected = true; return r; };
    const shell = await w.hit(S + 'src/store.js');
    check('redirect-swr', shell.res.redirected === false, 'the shell branch served a redirected response (rejected by the browser for navigations)');
    const pub = await w.hit(S + 'welcome.html', { mode: 'navigate' });
    check('redirect-public', pub.res.redirected === false, 'the public branch served a redirected response: welcome.html IS a navigation, the browser rejects this outright');
  }],

  ['install is atomic over ASSETS', async () => {
    const ok = makeWorld(S);
    const ev1 = { waitUntil: (p) => { ev1.p = p; } };
    ok.handlers.install(ev1);
    let installed = true; await ev1.p.catch(() => { installed = false; });
    check('install-ok', installed, 'install failed although every asset resolved');
    const bad = makeWorld(S);
    bad.net.respond = (url) => new FakeResponse('', { status: url.endsWith('/src/screens-water.jsx') ? 404 : 200 });
    const ev2 = { waitUntil: (p) => { ev2.p = p; } };
    bad.handlers.install(ev2);
    let failed = false; await ev2.p.catch(() => { failed = true; });
    check('install-atomic', failed, 'a 404 on one shell asset must abort the install');
  }],

  ['activate sweeps old generations, never the photos', async () => {
    const w = makeWorld(S);
    w.seed('zane-v2.700', S + 'x', 'old-gen');
    w.seed(CACHE_NAME, S + 'y', 'current');
    w.seed(PHOTOS_NAME, S + 'Background/a.png', 'photo');
    const ev = { waitUntil: (p) => { ev.p = p; } };
    w.handlers.activate(ev);
    await ev.p;
    check('activate-sweep', !w.stores.has('zane-v2.700'), 'the previous generation survived activate');
    check('activate-keep', w.stores.has(CACHE_NAME) && w.stores.has(PHOTOS_NAME), 'activate deleted a cache it must keep');
  }],

  ['root-scope deploy routes identically', async () => {
    const R = 'https://zane-wo.com/';
    const w = makeWorld(R);
    w.seed(CACHE_NAME, R + 'welcome.html', 'stale');
    const pub = await w.hit(R + 'welcome.html', { mode: 'navigate' });
    check('root-public', pub.res.body === 'net:' + R + 'welcome.html', 'public page not network-first under a root scope');
    w.seed(CACHE_NAME, R + 'src/store.js', 'old');
    const shell = await w.hit(R + 'src/store.js');
    check('root-shell', shell.res.body === 'old', 'app shell not cache-first under a root scope');
  }],
];

(async () => {
  for (const [name, fn] of scenarios) {
    try { await fn(); }
    catch (e) { failures.push(`${name}: threw ${e.message}`); }
  }
  if (failures.length) {
    for (const f of failures) console.error('FAIL ' + f);
    console.error(`\ncheck-sw FAILED (${failures.length} assertion${failures.length === 1 ? '' : 's'})`);
    process.exit(1);
  }
  console.log(`check-sw OK: ${scenarios.length} scenarios against ${path.basename(swPath)} (${CACHE_NAME}), routing + offline + waitUntil + install/activate all hold`);
})();
