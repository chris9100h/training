// Nutrition-label scanner for the Zane macro tracker (FoodScreen).
// Takes a photo of a nutrition-facts panel (Nährwerttabelle) and returns the
// macros as JSON, so the client can prefill the Custom Item form and log it as
// a per-user entry. Nothing is written to the shared zane_foods cache: a
// label a single user photographed is per-user data (zane_food_logs), never a
// vetted, shared reference the way an Open Food Facts / USDA hit is.
//
// Vision runs through Anthropic (Claude Haiku), which needs ANTHROPIC_API_KEY
// set as a Supabase Edge Function secret (Project Settings -> Edge Functions
// -> Secrets, or `supabase secrets set ANTHROPIC_API_KEY=...`). Without the
// key the function hard-fails with a clear message (unlike search-foods, this
// has no free fallback source).
//
// One action: POST { image: <base64, no data: prefix>, mimeType?: 'image/jpeg' }
// -> { is_nutrition_label, name, brand, basis, serving_size_g, serving_label,
//      calories, protein_g, carbs_g, fat_g, fiber_g }.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

// Claude Haiku: cheap, fast, accurate enough to read a printed nutrition
// table. A compressed label photo is a fraction of a cent per scan.
const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Client already downscales/compresses; this only guards against abuse. base64
// inflates bytes ~4/3, so ~8M chars is roughly a 6 MB image.
const MAX_IMAGE_CHARS = 8_000_000;

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
  "fiber_g": number or null
}
Rules:
- Set is_nutrition_label to false if the image is not a nutrition table at all; still return the object with the other fields null.
- If the label shows BOTH a per-serving and a per-100g (or per-100ml) column, report the PER-SERVING values and set basis to "serving". Otherwise report the per-100g / per-100ml column and set basis to "100g" or "100ml".
- serving_size_g is the grams in one serving when stated (e.g. "per 30 g"); serving_label is the human text like "1 cup (30 g)".
- calories must be in kcal. If only kilojoules (kJ) are printed, convert with kcal = kJ / 4.184 and round.
- carbs_g is total carbohydrate, NOT the "of which sugars" sub-line.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const userId = await resolveUser(req);
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!apiKey) return json({ error: 'Label scanning is not set up yet (missing ANTHROPIC_API_KEY).' }, 503);

  const body = await req.json().catch(() => ({}));
  const image = typeof body?.image === 'string' ? body.image.trim() : '';
  const mimeType = ALLOWED_MIME.has(body?.mimeType) ? body.mimeType : 'image/jpeg';
  if (!image) return json({ error: 'missing image' }, 400);
  if (image.length > MAX_IMAGE_CHARS) return json({ error: 'Image too large. Try again.' }, 413);

  let resp: Response | null = null;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } },
            { type: 'text', text: USER_PROMPT },
          ],
        }],
      }),
    });
  } catch (e) {
    console.error('[scan-label] anthropic fetch error:', e);
    return json({ error: 'Could not reach the label reader. Try again.' }, 502);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('[scan-label] anthropic error', resp.status, detail);
    return json({ error: `Label reader failed (${resp.status}). Try again.` }, 502);
  }

  const data = await resp.json().catch(() => null);
  const textBlock = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b?.type === 'text') : null;
  const parsed = extractJson(textBlock?.text ?? '');
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
  }, 200);
});
