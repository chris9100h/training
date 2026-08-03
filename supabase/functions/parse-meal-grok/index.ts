// Free-text meal description, an optional photo of the meal, or both ->
// estimated food log items, xAI Grok variant. Same contract and prompt as
// parse-meal (Anthropic Claude, the long-standing default), so the client
// can pick either one and get an identically-shaped response, same
// relationship as scan-label-claude mirrors scan-label, just reversed which
// provider is the original. Built for informal, home-cooked, multi-component
// meals with vague portions ("a thin slice", "one roll") that search-foods
// has no real chance at: there is no Open Food Facts / USDA / zane_foods
// entry for someone's own breakfast, so this never touches that pipeline, it
// estimates directly.
//
// The photo, when given, uses the same base64 contract as scan-label
// (client-side downscaled first). description and image are both optional,
// but at least one is required. When both are given, the prompt treats the
// text as authoritative for anything the photo alone can't show, see
// SYSTEM_PROMPT. Vision runs through the same xAI chat completion call as
// the text-only path, no separate request or model.
//
// User-triggered only, one call per request. The returned items are staged
// client-side exactly like a manually-typed Custom Item (never written to
// zane_food_logs here): the user reviews/removes before the existing "Add N
// items" flow actually logs anything, same as every other add path in
// FoodScreen.
//
// Calories are always DERIVED from protein/carbs/fat (4/4/9 kcal/g), never
// trusted as a separate number from the model, same rule search-foods
// applies to every external source.
//
// One action: POST { description?: string, image?: <base64, no data:
// prefix>, mimeType?: 'image/jpeg', previousItems?: [{ name, quantityG,
// protein, carbs, fat, fiber, sugar, satFat, sodiumMg }] } (description/image
// both optional, at least one required, previousItems does not relax that
// rule) -> { items: [{ name, quantityG, calories, protein, carbs, fat,
// fiber, sugar, satFat, sodiumMg }] }
//
// previousItems is refine mode: the caller's own prior estimate from an
// earlier call to this same endpoint, sent back alongside new or corrected
// description/image so the model revises that estimate instead of starting
// over. See SYSTEM_PROMPT and buildUserText.
//
// Needs the secret XAI_API_KEY (same one scan-label uses). Model configurable
// via the optional XAI_MODEL secret (default 'grok-4.3'), same reasoning as
// scan-label's own comment: xAI rotates and deprecates model ids quickly, if
// grok-4.3 gets deprecated too, point XAI_MODEL at the replacement instead of
// editing this file.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

// xAI is OpenAI-compatible, plain text-only chat completion here (no image).
const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = 'grok-4.3';

const DAILY_MEAL_PARSE_LIMIT = 60;
const MAX_DESCRIPTION_CHARS = 2000;
// Same bounds as scan-label: bounded JPEG from the client's fdDownscaleImage,
// this is just a sanity ceiling against an unexpectedly huge upload.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const MAX_IMAGE_CHARS = 8_000_000;
// Same reasoning as parse-meal's own copy of these two constants: a
// legitimate refine payload only ever echoes the model's own prior output,
// so both bounds are generous; previousItems had no cap at all before this.
const MAX_PREVIOUS_ITEMS = 50;
const MAX_ITEM_NAME_CHARS = 200;

// Same admin identity as admin-send-email/screens-settings.jsx/screens-featuremap.jsx
// (isAdmin = store.user?.email === this): unlimited quota for testing.
const ADMIN_EMAIL = 'office@btc-prime.biz';

// Advisory per-user daily quota (same zane_api_usage/bump_api_usage as
// parse-meal, shared 'meal_parse' kind: switching providers must not double
// the effective quota). Fails OPEN on purpose: a broken quota mechanism must
// never be the reason someone can't log their food.
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

// Identical to parse-meal's own SYSTEM_PROMPT: both providers must be
// interchangeable, including how they're instructed.
const SYSTEM_PROMPT = `You estimate nutrition for a home-logged meal from a photo of the food, a short often informal free-text description (may be a home-cooked dish, several components at once, and vague portions like "a thin slice" or "one roll"), or both together, the way an experienced dietitian doing a quick visual or verbal estimate would, not a database lookup. When the mandatory self-check below applies, show that arithmetic in plain text first; otherwise skip straight to the answer. Either way, end your response with exactly one JSON object, no markdown code fences around it, and no text of any kind after it.

Identify every separate food item, whether it's in a photo, in text, or both. For each, estimate a realistic quantity in grams and its macros, using everyday judgment for vague or visual portions the same way a dietitian eyeballing a plate would (a thin slice of a dense sliced meat is roughly 30-40 g, a bread roll is roughly 50-60 g, one egg is roughly 50-60 g, and so on; in a photo, use whatever's in frame for scale, a fork, a hand, a dinner plate is roughly 26-28 cm across). Never drop an item just because an exact amount wasn't given or isn't fully visible, make a reasonable assumption instead.

When both a photo and text are given, treat the text as authoritative for anything the photo alone can't show or could mislead you about: true size without a scale reference, ingredients hidden under sauce or cheese, that only part of a larger dish is pictured, what's actually inside a wrapped or opaque item, or a correction to something the photo makes ambiguous. Never let a plausible-looking photo override an explicit statement in the text.

Critical calibration: whenever the preparation involves unspecified added fat (fried, pan-fried, sauteed, roasted, breaded, buttered, a potato pancake/fritter/hash brown, and similar), estimate GENEROUSLY rather than a lean textbook version. Real home cooking uses more oil or butter than a minimal recipe would strictly need, people chronically under-count hidden fats, and it is better to slightly over-count calories here than to under-count them. This only calibrates HOW MUCH fat to assume for a named preparation, it is never a reason to invent an item that wasn't mentioned or shown at all.

Explicit size, quantity, or calorie signals always win over a typical-portion assumption, whether stated in text or visible in the photo itself: a stated dimension ("a 45cm pizza"), words like "whole", "large", "family-size", an instruction not to underestimate, a stated calorie floor ("easily over 1500 calories"), or a portion that's visibly oversized against something in frame for scale, are hard constraints, not flavor text. Calories are computed separately from protein*4 + carbs*4 + fat*9, not taken from you directly, so make sure the quantityG and macros you output are generous enough that this derived total genuinely reflects what was stated or shown, never quietly fall back to a smaller "typical" number once that signal is there. Reference point: a standard ~30cm pizza with cheese and a fatty topping like salami commonly totals 800-1200 kcal whole, and a large ~40-45cm one scales well past that, often 1500-2500+ kcal for the entire pie, not per slice.

Mandatory self-check when the text states an explicit calorie floor ("over 1500 calories", "at least 2000 kcal", and similar): before the JSON, visibly write out each item's quantityG and macros, then protein*4 + carbs*4 + fat*9 for each, then the sum across all items, all in plain text with no curly braces (so it can never be mistaken for the JSON object that follows). If the sum is below the stated floor, revise quantityG and/or the macros upward and redo the sum, repeating until it clears the floor. Only then output the final JSON, reflecting those revised numbers, never the first draft you started from.

Sometimes you will also be given your own previous estimate for this same meal, followed by new or corrected information from the user. When that happens, revise that previous estimate to account for the new information: keep every item, quantity, and macro exactly as it was unless the new information specifically implies a change, add or remove an item only if the new information calls for it, and do not restart the estimate from scratch or introduce unrelated changes to numbers the user did not question.

Return exactly this JSON shape:
{
  "items": [
    { "name": string, "quantityG": number, "protein": number, "carbs": number, "fat": number, "fiber": number or null, "sugar": number or null, "satFat": number or null, "sodiumMg": number or null }
  ]
}
protein/carbs/fat/fiber/sugar/satFat are grams, sodiumMg is milligrams. Use null for anything you genuinely cannot estimate, never invent a precise-looking number you don't believe. Never include a calories/kcal field, it is computed separately from the macros, not from you. Never use an em dash in a name; use a comma or a period instead. If neither the photo nor any text names an identifiable food or drink at all, return {"items": []}.`;

// Pull the first balanced JSON object out of the model's text, tolerant of an
// accidental ```json fence or a stray sentence around it. Same helper as
// parse-meal/scan-label.
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

// Best-effort short reason from an xAI error body, same as scan-label.
function errReason(raw: string): string {
  try {
    const j = JSON.parse(raw);
    const m = j?.error?.message ?? j?.error ?? j?.message;
    if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 160);
  } catch (_) { /* not JSON */ }
  return raw.trim().slice(0, 160);
}

// Same backstop as parse-meal/ai-daily-summary/ai-checkin-opinion: CLAUDE.md's
// "no em dashes" rule is enforced on committed source by tools/check-emdash.cjs,
// which can't touch runtime LLM output, so a prompt instruction alone isn't a
// guarantee, replace any that slip through. Matches by Unicode escape
// (U+2014), not the literal character, so check-emdash.cjs's grep has
// nothing to flag in this file.
function stripEmDash(s: string): string {
  return s.replace(/\u2014/g, ', ');
}

// The user-message text accompanying the request, shaped for whichever of
// description/image is actually present, see SYSTEM_PROMPT for how the
// model is told to weigh photo vs. text when both are given. previousItems
// is the sanitized array from a prior call to this same endpoint (refine
// mode): when non-empty, it is included as a labeled JSON block ahead of
// the rest of the message, and the text-only framing changes from "Meal
// description" (misleading once this is a revision, not a fresh one) to
// wording that reads as new information correcting that prior answer.
function buildUserText(description: string, hasImage: boolean, previousItems: unknown[]): string {
  const hasPrevious = Array.isArray(previousItems) && previousItems.length > 0;
  const previousBlock = hasPrevious ? `Previous estimate for this same meal:\n${JSON.stringify(previousItems)}\n\n` : '';
  if (hasImage && description) return `${previousBlock}Meal photo attached. Additional details from the user, treat as authoritative, see the system prompt:\n${description}`;
  if (hasImage) return `${previousBlock}Meal photo attached. No additional text was given, estimate from what is visible in the photo alone.`;
  if (hasPrevious) return `${previousBlock}New information from the user, revise the previous estimate above accordingly:\n${description}`;
  return `Meal description:\n${description}`;
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
  const image = typeof body?.image === 'string' ? body.image.trim() : '';
  const mimeType = ALLOWED_MIME.has(body?.mimeType) ? body.mimeType : 'image/jpeg';
  // Refine mode: the caller's own prior estimate from an earlier call to
  // this endpoint, sanitized the same defensive way as every other
  // numeric/string field in this file. Optional, never relaxes the
  // description/image requirement below.
  const rawPreviousItems = Array.isArray(body?.previousItems) ? body.previousItems : [];
  if (rawPreviousItems.length > MAX_PREVIOUS_ITEMS) return json({ error: 'Too many items to refine at once.' }, 413);
  const previousItems = rawPreviousItems
    .map((it: Record<string, unknown>) => {
      const name = str(it?.name);
      if (!name) return null;
      return {
        name: name.slice(0, MAX_ITEM_NAME_CHARS),
        quantityG: Math.max(0, num(it?.quantityG) ?? 100),
        protein: Math.max(0, num(it?.protein) ?? 0),
        carbs: Math.max(0, num(it?.carbs) ?? 0),
        fat: Math.max(0, num(it?.fat) ?? 0),
        fiber: num(it?.fiber),
        sugar: num(it?.sugar),
        satFat: num(it?.satFat),
        sodiumMg: num(it?.sodiumMg),
      };
    })
    .filter((it: unknown): it is NonNullable<typeof it> => it !== null);
  if (!description && !image) return json({ error: 'missing description or image' }, 400);
  if (description.length > MAX_DESCRIPTION_CHARS) return json({ error: 'Description too long. Try a shorter one.' }, 413);
  if (image.length > MAX_IMAGE_CHARS) return json({ error: 'Image too large. Try again.' }, 413);

  if (!isAdmin && !await withinQuota(userId, 'meal_parse', DAILY_MEAL_PARSE_LIMIT)) {
    return json({ error: `That's ${DAILY_MEAL_PARSE_LIMIT} meal descriptions today, well past normal use. The limit resets tomorrow; add items manually until then.` }, 429);
  }

  const apiKey = Deno.env.get('XAI_API_KEY') ?? '';
  if (!apiKey) return json({ error: 'Meal parsing is not set up yet (missing XAI_API_KEY).' }, 503);
  const model = (Deno.env.get('XAI_MODEL') ?? '').trim() || DEFAULT_MODEL;

  let resp: Response;
  try {
    resp = await fetch(XAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        // Bumped from 1200: the mandatory self-check can now show visible
        // arithmetic before the JSON for a multi-item meal, needs headroom
        // so that reasoning can never truncate the JSON object itself.
        max_tokens: 2000,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            // Text first, image second, same block order scan-label already
            // uses for its own vision request. Plain string (no array) when
            // there's no image, unchanged from the original text-only shape.
            content: image
              ? [{ type: 'text', text: buildUserText(description, true, previousItems) }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}`, detail: 'high' } }]
              : buildUserText(description, false, previousItems),
          },
        ],
      }),
    });
  } catch (e) {
    console.error('[parse-meal-grok] xai fetch error:', e);
    return json({ error: 'Could not reach the meal estimator. Try again.' }, 502);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('[parse-meal-grok] xai error', resp.status, detail);
    const reason = errReason(detail);
    return json({ error: `Meal estimator failed (${resp.status})${reason ? ': ' + reason : ''}` }, 502);
  }

  const data = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  const text = typeof content === 'string'
    ? content
    // Some OpenAI-compatible servers return content as an array of parts.
    : Array.isArray(content) ? content.map((p: { text?: string }) => p?.text ?? '').join('') : '';
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
        name: stripEmDash(name),
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
    return json({ error: 'Could not find any food there. Try a clearer photo, more detail, or add it manually.' }, 422);
  }

  return json({ items }, 200);
});
