// Food-database lookup for the Zane-native macro tracker (FoodScreen).
// Proxies two free/public sources: Open Food Facts (no key needed) and USDA
// FoodData Central (needs USDA_API_KEY, must be set as a Supabase Edge
// Function secret, sign up free at https://fdc.nal.usda.gov/api-key-signup).
// Open Food Facts is missing that secret requirement entirely, so it alone
// is enough to make search work; USDA is skipped silently (not a hard
// failure) whenever the key is unset.
//
// action: 'search' hits both sources (Open Food Facts only for a numeric
// barcode query, USDA has no meaningful barcode lookup) and returns
// normalized, UNCACHED results. action: 'select' re-fetches the chosen item
// server-side by id (never trusts client-submitted nutrition numbers) and
// upserts it into zane_foods, the app's shared, organically-growing food
// cache, before returning it. zane_food_logs itself is never touched here,
// the client computes the specific-quantity macros and writes that entry
// through the normal store/sync path once it knows the logged quantity.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';
const OFF_USER_AGENT = 'Zane Fitness PWA - contact office@btc-prime.biz';

function dbFetch(path: string, options: RequestInit = {}) {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const key  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}

async function resolveUser(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ANON_KEY;
  const r = await fetch(`${base}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': anon },
  }).catch(() => null);
  if (!r?.ok) return null;
  const user = await r.json().catch(() => null);
  return user?.id ?? null;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    console.error(`[search-foods] fetch error for ${url}:`, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface FoodResult {
  source: 'off' | 'usda';
  sourceId: string;
  name: string;
  brand: string | null;
  kcalPer100g: number | null;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
  servingSizeG: number | null;
  servingLabel: string | null;
  cached?: boolean; // search results only, marks a hit already verified/cached in zane_foods
}

// ── Open Food Facts ─────────────────────────────────────────────────────────

function offNum(n: Record<string, unknown> | undefined, key: string): number | null {
  const v = n?.[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') { const parsed = Number(v); return Number.isFinite(parsed) ? parsed : null; }
  return null;
}

// deno-lint-ignore no-explicit-any
function normalizeOffProduct(p: any): FoodResult | null {
  const code = p?.code ?? p?._id;
  if (!code || !p?.product_name) return null;
  const n = p.nutriments ?? {};
  return {
    source: 'off',
    sourceId: String(code),
    name: p.product_name,
    brand: p.brands ? String(p.brands).split(',')[0].trim() : null,
    kcalPer100g: offNum(n, 'energy-kcal_100g'),
    proteinPer100g: offNum(n, 'proteins_100g'),
    carbsPer100g: offNum(n, 'carbohydrates_100g'),
    fatPer100g: offNum(n, 'fat_100g'),
    fiberPer100g: offNum(n, 'fiber_100g'),
    servingSizeG: typeof p.serving_quantity === 'number' ? p.serving_quantity : null,
    servingLabel: p.serving_size ?? null,
  };
}

async function searchOff(query: string): Promise<FoodResult[]> {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=20&fields=code,product_name,brands,nutriments,serving_size,serving_quantity`;
  const r = await fetchWithTimeout(url, { headers: { 'User-Agent': OFF_USER_AGENT } });
  if (!r?.ok) return [];
  const data = await r.json().catch(() => null);
  const products = Array.isArray(data?.products) ? data.products : [];
  return products.map(normalizeOffProduct).filter((x: FoodResult | null): x is FoodResult => !!x);
}

async function lookupOffBarcode(barcode: string): Promise<FoodResult | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=code,product_name,brands,nutriments,serving_size,serving_quantity`;
  const r = await fetchWithTimeout(url, { headers: { 'User-Agent': OFF_USER_AGENT } });
  if (!r?.ok) return null;
  const data = await r.json().catch(() => null);
  if (data?.status !== 1 || !data?.product) return null;
  return normalizeOffProduct(data.product);
}

// ── USDA FoodData Central ───────────────────────────────────────────────────

// USDA's two endpoints report nutrients in different shapes: the search
// endpoint (/v1/foods/search) uses a flat { nutrientNumber, value }, while the
// by-id endpoint (/v1/food/{fdcId}, used on 'select') nests it as
// { nutrient: { number }, amount } instead. Checking both shapes here lets
// one normalizer serve both callers instead of silently reading undefined
// from the by-id shape (which is what previously made every USDA "select"
// come back as 0 kcal / 0g macros, only the search list looked right).
// deno-lint-ignore no-explicit-any
function usdaNum(foodNutrients: any[], nutrientNumber: string): number | null {
  for (const n of (foodNutrients || [])) {
    const num = n?.nutrientNumber ?? n?.nutrient?.number;
    if (String(num) !== nutrientNumber) continue;
    const v = n?.value ?? n?.amount;
    return typeof v === 'number' ? v : null;
  }
  return null;
}

// deno-lint-ignore no-explicit-any
function normalizeUsdaFood(f: any): FoodResult | null {
  if (!f?.fdcId || !f?.description) return null;
  const nutrients = f.foodNutrients || [];
  return {
    source: 'usda',
    sourceId: String(f.fdcId),
    name: f.description,
    brand: f.brandOwner ?? f.brandName ?? null,
    kcalPer100g: usdaNum(nutrients, '208'),
    proteinPer100g: usdaNum(nutrients, '203'),
    carbsPer100g: usdaNum(nutrients, '205'),
    fatPer100g: usdaNum(nutrients, '204'),
    fiberPer100g: usdaNum(nutrients, '291'),
    servingSizeG: typeof f.servingSize === 'number' && f.servingSizeUnit === 'g' ? f.servingSize : null,
    servingLabel: f.householdServingFullText ?? null,
  };
}

async function searchUsda(query: string, apiKey: string): Promise<FoodResult[]> {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&pageSize=20`;
  const r = await fetchWithTimeout(url);
  if (!r?.ok) return [];
  const data = await r.json().catch(() => null);
  const foods = Array.isArray(data?.foods) ? data.foods : [];
  return foods.map(normalizeUsdaFood).filter((x: FoodResult | null): x is FoodResult => !!x);
}

async function lookupUsdaById(fdcId: string, apiKey: string): Promise<FoodResult | null> {
  const url = `https://api.nal.usda.gov/fdc/v1/food/${encodeURIComponent(fdcId)}?api_key=${encodeURIComponent(apiKey)}`;
  const r = await fetchWithTimeout(url);
  if (!r?.ok) return null;
  const data = await r.json().catch(() => null);
  return data ? normalizeUsdaFood(data) : null;
}

// ── Request handling ────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Neither OFF's nor USDA's search ranks a name that STARTS with the query
// above one that merely contains it somewhere ("Cookies, banana" was
// outranking "Banana, raw" for a "banana" search). Re-score locally against
// the literal query string and drop anything with no textual relation to it
// at all, so what the user typed is actually reflected in what comes back.
function textScore(text: string | null, q: string): number {
  const n = (text || '').toLowerCase();
  if (!n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 90;
  const m = new RegExp(`\\b${escapeRegExp(q)}`).exec(n);
  if (m) return Math.max(40, 70 - m.index);
  if (n.includes(q)) return 15;
  return 0;
}
function relevanceScore(item: FoodResult, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 50;
  return Math.max(textScore(item.name, q), item.brand ? textScore(item.brand, q) * 0.6 : 0);
}

// Text search over the shared zane_foods cache itself (our own, already-
// verified DB), used two ways: as the standalone "Zane" source, and folded
// into an "All" search so a food someone already selected reliably surfaces
// (and sorts to the top) instead of being buried in raw OFF/USDA output.
// The query is stripped of PostgREST's or=()/wildcard reserved chars ( ) , *
// and then percent-encoded, so it can never break out of the ilike value.
async function searchCache(query: string, sourceFilter?: 'off' | 'usda'): Promise<FoodResult[]> {
  const safe = query.replace(/[(),*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safe) return [];
  const pat = `*${encodeURIComponent(safe)}*`;
  const parts = [`or=(name.ilike.${pat},brand.ilike.${pat})`, 'select=*', 'limit=25'];
  if (sourceFilter) parts.push(`source=eq.${sourceFilter}`);
  const r = await dbFetch(`zane_foods?${parts.join('&')}`).catch(() => null);
  if (!r?.ok) return [];
  const rows = await r.json().catch(() => []);
  return (Array.isArray(rows) ? rows : []).map(foodRowToResult);
}

// Flags results already in zane_foods (used only by the barcode path, which
// returns a single upstream hit). ids are percent-encoded so an unusual
// upstream code can't break PostgREST's in.() list.
async function annotateCached(results: FoodResult[]): Promise<FoodResult[]> {
  if (!results.length) return results;
  const ids = results.map((r) => encodeURIComponent(`${r.source}:${r.sourceId}`));
  const r = await dbFetch(`zane_foods?id=in.(${ids.join(',')})&select=id`).catch(() => null);
  if (!r?.ok) return results.map((x) => ({ ...x, cached: false }));
  const rows = await r.json().catch(() => []);
  const cachedIds = new Set((Array.isArray(rows) ? rows : []).map((row: { id: string }) => row.id));
  return results.map((x) => ({ ...x, cached: cachedIds.has(`${x.source}:${x.sourceId}`) }));
}

async function handleSearch(query: string, source?: string) {
  const isBarcode = /^\d{8,14}$/.test(query);
  if (isBarcode) {
    const hit = await lookupOffBarcode(query);
    return { results: hit ? await annotateCached([hit]) : [], isBarcode: true };
  }

  // "Zane" = search our own already-verified cache only, no upstream calls.
  // No score>0 filter here: these already matched the DB ilike on name/brand,
  // so they are relevant by construction, score only orders them (and the
  // ilike ran on a punctuation-stripped query, which relevanceScore against
  // the raw query might not reproduce, so filtering on it could wrongly drop
  // a genuine hit).
  if (source === 'zane') {
    const results = (await searchCache(query))
      .map((r) => ({ r, score: relevanceScore(r, query) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => ({ ...x.r, cached: true }));
    return { results, isBarcode: false };
  }

  const wantOff = source !== 'usda';
  const wantUsda = source !== 'off';
  const usdaKey = Deno.env.get('USDA_API_KEY') ?? '';
  const cacheFilter = source === 'off' || source === 'usda' ? source : undefined;
  const [offSettled, usdaSettled, cacheSettled] = await Promise.allSettled([
    wantOff ? searchOff(query) : Promise.resolve([]),
    (wantUsda && usdaKey) ? searchUsda(query, usdaKey) : Promise.resolve([]),
    searchCache(query, cacheFilter),
  ]);
  const off = offSettled.status === 'fulfilled' ? offSettled.value : [];
  const usda = usdaSettled.status === 'fulfilled' ? usdaSettled.value : [];
  const cacheHits = cacheSettled.status === 'fulfilled' ? cacheSettled.value : [];

  // Cache entries are authoritative and win on id collisions, so an item we've
  // already verified is never shadowed by (or duplicated against) a raw
  // upstream hit for the same product.
  const byId = new Map<string, FoodResult>();
  for (const r of cacheHits) byId.set(`${r.source}:${r.sourceId}`, { ...r, cached: true });
  for (const r of [...off, ...usda]) {
    const id = `${r.source}:${r.sourceId}`;
    if (!byId.has(id)) byId.set(id, { ...r, cached: false });
  }
  const results = [...byId.values()]
    .map((r) => ({ r, score: relevanceScore(r, query) }))
    // Keep every cache hit (it matched the DB ilike, so it is relevant even if
    // relevanceScore against the raw query scores it 0), plus any external hit
    // with real textual relation to the query.
    .filter((x) => x.r.cached || x.score > 0)
    // Cached (already-verified) first, then by textual relevance within each group.
    .sort((a, b) => (Number(b.r.cached) - Number(a.r.cached)) || (b.score - a.score))
    .map((x) => x.r);
  return { results, isBarcode: false };
}

// deno-lint-ignore no-explicit-any
function foodRowToResult(row: any): FoodResult {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    source: row.source, sourceId: row.source_id, name: row.name, brand: row.brand ?? null,
    kcalPer100g: num(row.kcal_per_100g), proteinPer100g: num(row.protein_per_100g),
    carbsPer100g: num(row.carbs_per_100g), fatPer100g: num(row.fat_per_100g),
    fiberPer100g: num(row.fiber_per_100g), servingSizeG: num(row.serving_size_g),
    servingLabel: row.serving_label ?? null,
  };
}

async function fetchCachedFood(id: string): Promise<FoodResult | null> {
  const r = await dbFetch(`zane_foods?id=eq.${encodeURIComponent(id)}&select=*`).catch(() => null);
  if (!r?.ok) return null;
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? foodRowToResult(row) : null;
}

async function handleSelect(source: 'off' | 'usda', sourceId: string): Promise<FoodResult | null> {
  // A product's per-100g nutrition is static once published, so once we've
  // verified it server-side once (below) there is no need to hit the
  // upstream API again on every re-select. This is most of the perceived
  // "opening a result is slow" latency, especially for repeat picks off the
  // recent/favorites strips.
  const cached = await fetchCachedFood(`${source}:${sourceId}`);
  if (cached) return cached;

  // Only a live upstream lookup is left. USDA needs the key for that, but a
  // cached USDA row was already served above, so this only blocks a
  // genuinely-new USDA item when the key is unset (and none can even surface
  // in search then). Checked here, not in the request handler, so serving a
  // cached USDA food never depends on the key being present.
  if (source === 'usda' && !Deno.env.get('USDA_API_KEY')) return null;

  const food = source === 'off'
    ? await lookupOffBarcode(sourceId)
    : await lookupUsdaById(sourceId, Deno.env.get('USDA_API_KEY') ?? '');
  if (!food) return null;

  const row = {
    id: `${food.source}:${food.sourceId}`,
    source: food.source,
    source_id: food.sourceId,
    name: food.name,
    brand: food.brand,
    kcal_per_100g: food.kcalPer100g,
    protein_per_100g: food.proteinPer100g,
    carbs_per_100g: food.carbsPer100g,
    fat_per_100g: food.fatPer100g,
    fiber_per_100g: food.fiberPer100g,
    serving_size_g: food.servingSizeG,
    serving_label: food.servingLabel,
    cached_at: new Date().toISOString(),
  };
  const writeCache = dbFetch('zane_foods', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(row),
  }).catch((e) => console.error('[search-foods] cache upsert error:', e));
  // Don't make the caller wait on the cache write, it isn't needed to answer
  // this request. waitUntil (Supabase's Edge Runtime global) keeps it alive
  // in the background past the response instead of racing the isolate
  // shutdown; if that global isn't present the write still fires, it just
  // isn't guaranteed to finish, a dropped write is harmless and self-heals
  // (the next select for this id just re-fetches).
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(writeCache);

  return food;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const userId = await resolveUser(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));

  if (body?.action === 'search') {
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return new Response(JSON.stringify({ error: 'missing query' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const source = ['off', 'usda', 'zane'].includes(body.source) ? body.source : undefined;
    const { results, isBarcode } = await handleSearch(query, source);
    return new Response(JSON.stringify({ results, isBarcode }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (body?.action === 'select') {
    const source = body.source === 'off' || body.source === 'usda' ? body.source : null;
    const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
    if (!source || !sourceId) {
      return new Response(JSON.stringify({ error: 'missing source/sourceId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const food = await handleSelect(source, sourceId);
    if (!food) {
      return new Response(JSON.stringify({ error: 'food not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(food), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'unknown action' }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
