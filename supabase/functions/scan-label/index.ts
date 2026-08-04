// Nutrition-label scanner for the Zane macro tracker (FoodScreen).
// Takes a photo of a nutrition-facts panel (Nährwerttabelle) and returns the
// macros as JSON, so the client can prefill the Custom Item form and log it as
// a per-user entry. Nothing is written to the shared zane_foods cache: a
// label a single user photographed is per-user data (zane_food_logs), never a
// vetted, shared reference the way an Open Food Facts / USDA hit is.
//
// Vision runs through xAI (Grok), whose API is OpenAI-compatible. Needs the
// secret XAI_API_KEY set as a Supabase Edge Function secret (Project Settings
// -> Edge Functions -> Secrets, or `supabase secrets set XAI_API_KEY=...`).
// Without the key the function hard-fails with a clear message (unlike
// search-foods, this has no free fallback source).
//
// The model is configurable via the optional XAI_MODEL secret (default
// 'grok-4.3'), because xAI rotates and deprecates model ids quickly: grok-4
// itself, the original default here, was deprecated 2026-05-15 and retires
// 2026-08-15, which is exactly this scenario. If xAI deprecates grok-4.3 too,
// point XAI_MODEL at the replacement instead of editing this file. A model
// the API rejects surfaces xAI's own error text to the client so the fix is
// obvious.
//
// One action: POST { image: <base64, no data: prefix>, mimeType?: 'image/jpeg' }
// -> { is_nutrition_label, name, brand, basis, serving_size_g, serving_label,
//      calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g,
//      sodium_mg }. The last three arrived with migration 0204; sodium is
//      returned in MILLIGRAMS whatever unit the label printed.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

// xAI is OpenAI-compatible; the image goes in a user message as an image_url
// data URI, exactly like OpenAI vision.
const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = 'grok-4.3';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const MAX_IMAGE_CHARS = 8_000_000;

const DAILY_SCAN_LIMIT = 60;

// Same admin identity as admin-send-email/screens-settings.jsx/screens-featuremap.jsx
// (isAdmin = store.user?.email === this): unlimited quota for testing.
const ADMIN_EMAIL = 'office@btc-prime.biz';

// Advisory per-user daily quota (migration 0207). Fails OPEN on purpose: if the
// RPC errors, times out or the migration has not run yet, the call goes
// through. A problem with the quota mechanism must never be the reason someone
// cannot log their food, and the point of it is catching a runaway account, not
// enforcing a contract.
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

const SYSTEM_PROMPT =
  'You read nutrition-facts panels (a Nährwerttabelle / "Nutrition Facts" table) from a photo and return the values as strict JSON. You never invent numbers.';

const USER_PROMPT = `Read the nutrition facts from this photo of a food package or label.
Return ONLY a JSON object, no prose and no markdown code fences, with exactly these keys:
{
  "is_nutrition_label": boolean,
  "name": string or null,
  "brand": string or null,
  "basis": "serving" | "100g" | "100ml" | "unknown",
  "serving_size_g": number or null,
  "serving_label": string or null,
  "calories": number or null,
  "protein_g": number or null,
  "carbs_g": number or null,
  "fat_g": number or null,
  "fiber_g": number or null,
  "sugar_g": number or null,
  "sat_fat_g": number or null,
  "sodium_mg": number or null
}
Rules:
- Set is_nutrition_label to false if the image is not a nutrition table at all; still return the object with the other fields null.
- ALWAYS prefer the per-100 g (or per-100 ml) column. If the label has a per-100g / per-100ml column, report THOSE values and set basis to "100g" or "100ml", even when a per-serving column is also present. Only if the label has no per-100g / per-100ml column at all, fall back to the per-serving values and set basis to "serving".
- serving_size_g is the grams in one serving when stated (e.g. "per 30 g"); serving_label is the human text like "1 cup (30 g)".
- calories must be in kcal. If only kilojoules (kJ) are printed, convert with kcal = kJ / 4.184 and round.
- carbs_g is total carbohydrate, NOT the "of which sugars" sub-line. Report that sub-line ("of which sugars" / "Total Sugars") separately as sugar_g.
- sat_fat_g is the "of which saturates" / "Saturated Fat" sub-line of the fat row, not the total fat.
- sodium_mg must be MILLIGRAMS of sodium. Labels that print salt instead of sodium (common in the EU) state grams of salt: convert with sodium_mg = salt_g / 2.5 * 1000. Labels that print sodium in grams convert with sodium_mg = sodium_g * 1000.
- Numeric fields must be plain numbers with no units. Use null for anything you cannot read confidently, and do not guess.`;

// Pull the first balanced JSON object out of the model's text, tolerant of an
// accidental ```json fence or a stray sentence around it.
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

// Best-effort short reason from an xAI error body, so a rejected model id (or
// out-of-credit account) is visible to the user instead of a bare status code.
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
  if (!isAdmin && !await withinQuota(userId, 'scan', DAILY_SCAN_LIMIT)) {
    return json({ error: `That is ${DAILY_SCAN_LIMIT} label scans today, well past normal use. The limit resets tomorrow; add the food manually until then.` }, 429);
  }

  const apiKey = Deno.env.get('XAI_API_KEY') ?? '';
  if (!apiKey) return json({ error: 'Label scanning is not set up yet (missing XAI_API_KEY).' }, 503);
  const model = (Deno.env.get('XAI_MODEL') ?? '').trim() || DEFAULT_MODEL;

  const body = await req.json().catch(() => ({}));
  const image = typeof body?.image === 'string' ? body.image.trim() : '';
  const mimeType = ALLOWED_MIME.has(body?.mimeType) ? body.mimeType : 'image/jpeg';
  if (!image) return json({ error: 'missing image' }, 400);
  if (image.length > MAX_IMAGE_CHARS) return json({ error: 'Image too large. Try again.' }, 413);

  let resp: Response | null = null;
  try {
    resp = await fetch(XAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        // Reasoning is ALWAYS on by default on Grok 4.3 (effort 'low') unless
        // this is set, which it had not been: the label scanner was quietly
        // paying for deliberation nobody asked for. Reading numbers off a
        // printed table needs none, and it is latency somebody feels standing
        // at a shelf. All three label scanners now run without it, so the
        // toggle compares models and not accidental per-provider defaults.
        reasoning_effort: 'none',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: USER_PROMPT },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}`, detail: 'high' } },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    console.error('[scan-label] xai fetch error:', e);
    return json({ error: 'Could not reach the label reader. Try again.' }, 502);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('[scan-label] xai error', resp.status, detail);
    const reason = errReason(detail);
    return json({ error: `Label reader failed (${resp.status})${reason ? ': ' + reason : ''}` }, 502);
  }

  const data = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  const text = typeof content === 'string'
    ? content
    // Some OpenAI-compatible servers return content as an array of parts.
    : Array.isArray(content) ? content.map((p: { text?: string }) => p?.text ?? '').join('') : '';
  const parsed = extractJson(text);
  if (!parsed) {
    return json({ error: 'Could not read the label. Try a clearer, straight-on photo, or add it manually.' }, 422);
  }

  return json({
    is_nutrition_label: parsed.is_nutrition_label !== false,
    name: str(parsed.name),
    brand: str(parsed.brand),
    basis: ['serving', '100g', '100ml'].includes(parsed.basis as string) ? parsed.basis : 'unknown',
    serving_size_g: num(parsed.serving_size_g),
    serving_label: str(parsed.serving_label),
    calories: num(parsed.calories),
    protein_g: num(parsed.protein_g),
    carbs_g: num(parsed.carbs_g),
    fat_g: num(parsed.fat_g),
    fiber_g: num(parsed.fiber_g),
    sugar_g: num(parsed.sugar_g),
    sat_fat_g: num(parsed.sat_fat_g),
    sodium_mg: num(parsed.sodium_mg),
  }, 200);
});
