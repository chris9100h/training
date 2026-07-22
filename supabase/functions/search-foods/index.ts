// Food-database lookup for the Zane-native macro tracker (FoodScreen).
// Proxies two free/public sources: Open Food Facts (no key needed) and USDA
// FoodData Central (needs USDA_API_KEY, must be set as a Supabase Edge
// Function secret — sign up free at https://fdc.nal.usda.gov/api-key-signup).
// Open Food Facts is missing that secret requirement entirely, so it alone
// is enough to make search work; USDA is skipped silently (not a hard
// failure) whenever the key is unset.
//
// action: 'search' hits both sources (Open Food Facts only for a numeric
// barcode query — USDA has no meaningful barcode lookup) and returns
// normalized, UNCACHED results. action: 'select' re-fetches the chosen item
// server-side by id (never trusts client-submitted nutrition numbers) and
// upserts it into zane_foods, the app's shared, organically-growing food
// cache, before returning it. zane_food_logs itself is never touched here —
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

// deno-lint-ignore no-explicit-any
function usdaNum(foodNutrients: any[], nutrientNumber: string): number | null {
  const hit = (foodNutrients || []).find((n) => String(n?.nutrientNumber) === nutrientNumber);
  return typeof hit?.value === 'number' ? hit.value : null;
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

async function handleSearch(query: string) {
  const isBarcode = /^\d{8,14}$/.test(query);
  if (isBarcode) {
    const hit = await lookupOffBarcode(query);
    return { results: hit ? [hit] : [], isBarcode: true };
  }
  const usdaKey = Deno.env.get('USDA_API_KEY') ?? '';
  const [offSettled, usdaSettled] = await Promise.allSettled([
    searchOff(query),
    usdaKey ? searchUsda(query, usdaKey) : Promise.resolve([]),
  ]);
  const results = [
    ...(offSettled.status === 'fulfilled' ? offSettled.value : []),
    ...(usdaSettled.status === 'fulfilled' ? usdaSettled.value : []),
  ];
  return { results, isBarcode: false };
}

async function handleSelect(source: 'off' | 'usda', sourceId: string): Promise<FoodResult | null> {
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
  await dbFetch('zane_foods', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(row),
  }).catch((e) => console.error('[search-foods] cache upsert error:', e));

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
    const { results, isBarcode } = await handleSearch(query);
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
    if (source === 'usda' && !Deno.env.get('USDA_API_KEY')) {
      return new Response(JSON.stringify({ error: 'USDA source unavailable (no API key configured)' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
