// Free-text meal description -> estimated food log items, for the Food
// tracker's "Describe a meal" sheet (FoodScreen, screens-food.jsx). Built
// for informal, home-cooked, multi-component meals with vague portions
// ("a thin slice", "one roll") that search-foods has no real chance at:
// there is no Open Food Facts / USDA / zane_foods entry for someone's own
// breakfast, so this never touches that pipeline, it estimates directly.
//
// User-triggered only, one call per description. The returned items are
// staged client-side exactly like a manually-typed Custom Item (never
// written to zane_food_logs here): the user reviews/removes before the
// existing "Add N items" flow actually logs anything, same as every other
// add path in FoodScreen.
//
// Calories are always DERIVED from protein/carbs/fat (4/4/9 kcal/g), never
// trusted as a separate number from the model, same rule search-foods
// applies to every external source: a model estimate of "calories" is one
// more number that can silently disagree with the macros sitting right next
// to it, deriving it removes that failure mode entirely.
//
// One action: POST { description: string } -> { items: [{ name, quantityG,
// calories, protein, carbs, fat, fiber, sugar, satFat, sodiumMg }] }
//
// Needs the secret ANTHROPIC_API_KEY (same one scan-label-claude uses).
//
// Web search tool: lets the model look up real nutrition data when the
// description names a chain/restaurant or a packaged product, instead of
// guessing from scratch. Server-side tool, no client-side loop needed, the
// existing text-only content extraction below already skips over the
// search-result blocks it adds to the response. Using the basic
// web_search_20250305 (not the newer _20260209 dynamic-filtering variant):
// DEFAULT_MODEL is Haiku, which the newer variant does not support.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const DAILY_MEAL_PARSE_LIMIT = 60;
const MAX_DESCRIPTION_CHARS = 2000;

// Same admin identity as admin-send-email/screens-settings.jsx/screens-featuremap.jsx
// (isAdmin = store.user?.email === this): unlimited quota for testing.
const ADMIN_EMAIL = 'office@btc-prime.biz';

// Advisory per-user daily quota (same zane_api_usage/bump_api_usage as every
// other AI edge function, migration 0207, new kind 'meal_parse'). Fails OPEN
// on purpose: a broken quota mechanism must never be the reason someone
// can't log their food.
async function withinQuota(userId: string, kind: string, limit: number): Promise<boolean> {
  try {
    const base = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!base || !key) return true;
    const r = await fetch(`${base}/rest/v1/rpc/bump_api_usage`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'apikey': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_kind: kind, p_limit: limit }),
    });
    if (!r.ok) return true;
    return (await r.json()) !== false;
  } catch (_) {
    return true;
  }
}

async function resolveUser(req: Request): Promise<{ id: string; email: string | null } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ANON_KEY;
  const r = await fetch(`${base}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': anon },
  }).catch(() => null);
  if (!r?.ok) return null;
  const user = await r.json().catch(() => null);
  return user?.id ? { id: user.id, email: user.email ?? null } : null;
}

const SYSTEM_PROMPT = `You estimate nutrition for a home-logged meal from a short, often informal, free-text description (may be a home-cooked dish, several components at once, and vague portions like "a thin slice" or "one roll"), the way an experienced dietitian doing a quick verbal estimate would, not a database lookup. Return ONLY a JSON object, no prose and no markdown code fences.

Break the description into separate food items. For each, estimate a realistic quantity in grams and its macros, using everyday judgment for vague portions the same way a dietitian eyeballing a plate would (a thin slice of a dense sliced meat is roughly 30-40 g, a bread roll is roughly 50-60 g, one egg is roughly 50-60 g, and so on). Never drop an item just because an exact amount wasn't given, make a reasonable assumption instead.

Critical calibration: whenever the preparation involves unspecified added fat (fried, pan-fried, sauteed, roasted, breaded, buttered, a potato pancake/fritter/hash brown, and similar), estimate GENEROUSLY rather than a lean textbook version. Real home cooking uses more oil or butter than a minimal recipe would strictly need, people chronically under-count hidden fats, and it is better to slightly over-count calories here than to under-count them. This only calibrates HOW MUCH fat to assume for a named preparation, it is never a reason to invent an item that was not mentioned at all.

When the description names a specific restaurant, fast-food chain, or packaged/branded product (e.g. "Subway", "McDonald's", a named chocolate bar), use the web search tool to look up that chain's or product's real published nutrition information before estimating, and base the item on what you find rather than a generic guess. Search only for items that are actually named this way; a home-cooked or generically-described item still gets the everyday-judgment estimate above, never a search.

Return exactly this JSON shape:
{
  "items": [
    { "name": string, "quantityG": number, "protein": number, "carbs": number, "fat": number, "fiber": number or null, "sugar": number or null, "satFat": number or null, "sodiumMg": number or null }
  ]
}
protein/carbs/fat/fiber/sugar/satFat are grams, sodiumMg is milligrams. Use null for anything you genuinely cannot estimate, never invent a precise-looking number you don't believe. Never include a calories/kcal field, it is computed separately from the macros, not from you. If the description names no identifiable food or drink at all, return {"items": []}.`;

// Pull the first balanced JSON object out of the model's text, tolerant of an
// accidental ```json fence or a stray sentence around it. Same helper as
// scan-label/scan-label-claude.
function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

// Same rule as search-foods' caloriesFromMacros: calories are always derived
// from protein/carbs/fat (standard 4/4/9 kcal/g), never a separate number
// trusted from the model.
function caloriesFromMacros(p: number, c: number, f: number): number {
  return Math.round(p * 4 + c * 4 + f * 9);
}

// Best-effort short reason from an Anthropic error body, same as scan-label-claude.
function errReason(raw: string): string {
  try {
    const j = JSON.parse(raw);
    const m = j?.error?.message ?? j?.error ?? j?.message;
    if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 160);
  } catch (_) { /* not JSON */ }
  return raw.trim().slice(0, 160);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const caller = await resolveUser(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);
  const userId = caller.id;
  const isAdmin = caller.email === ADMIN_EMAIL;

  const body = await req.json().catch(() => ({}));
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  if (!description) return json({ error: 'missing description' }, 400);
  if (description.length > MAX_DESCRIPTION_CHARS) return json({ error: 'Description too long. Try a shorter one.' }, 413);

  if (!isAdmin && !await withinQuota(userId, 'meal_parse', DAILY_MEAL_PARSE_LIMIT)) {
    return json({ error: `That's ${DAILY_MEAL_PARSE_LIMIT} meal descriptions today, well past normal use. The limit resets tomorrow; add items manually until then.` }, 429);
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!apiKey) return json({ error: 'Meal parsing is not set up yet (missing ANTHROPIC_API_KEY).' }, 503);
  const model = (Deno.env.get('ANTHROPIC_MODEL') ?? '').trim() || DEFAULT_MODEL;

  let resp: Response;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: [{ type: 'text', text: `Meal description:\n${description}` }] }],
      }),
    });
  } catch (e) {
    console.error('[parse-meal] anthropic fetch error:', e);
    return json({ error: 'Could not reach the meal estimator. Try again.' }, 502);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('[parse-meal] anthropic error', resp.status, detail);
    const reason = errReason(detail);
    return json({ error: `Meal estimator failed (${resp.status})${reason ? ': ' + reason : ''}` }, 502);
  }

  const data = await resp.json().catch(() => null);
  const content = data?.content;
  const text = Array.isArray(content)
    ? content.map((p: { type?: string; text?: string }) => (p?.type === 'text' ? p.text ?? '' : '')).join('')
    : '';
  const parsed = extractJson(text);
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];

  const items = rawItems
    .map((it: Record<string, unknown>) => {
      const name = str(it?.name);
      if (!name) return null;
      const protein = Math.max(0, num(it?.protein) ?? 0);
      const carbs = Math.max(0, num(it?.carbs) ?? 0);
      const fat = Math.max(0, num(it?.fat) ?? 0);
      return {
        name,
        quantityG: Math.max(0, num(it?.quantityG) ?? 100),
        calories: caloriesFromMacros(protein, carbs, fat),
        protein, carbs, fat,
        fiber: num(it?.fiber),
        sugar: num(it?.sugar),
        satFat: num(it?.satFat),
        sodiumMg: num(it?.sodiumMg),
      };
    })
    .filter((it: unknown): it is NonNullable<typeof it> => it !== null);

  if (!items.length) {
    return json({ error: 'Could not find any food in that description. Try rephrasing, or add it manually.' }, 422);
  }

  return json({ items }, 200);
});
