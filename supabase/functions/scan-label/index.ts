// Nutrition-label scanner for the Zane macro tracker (FoodScreen).
// Takes a photo of a nutrition-facts panel (Nährwerttabelle) and returns the
// macros as JSON, so the client can prefill the Custom Item form and log it as
// a per-user entry. Nothing is written to the shared zane_foods cache: a
// label a single user photographed is per-user data (zane_food_logs), never a
// vetted, shared reference the way an Open Food Facts / USDA hit is.
//
// THREE BACKENDS, ONE FUNCTION. Grok (the default), Claude and Qwen all run
// through this endpoint; the caller names one in `provider` and gets an
// identically-shaped response whichever it picks. They used to be three
// separate functions kept in step by a rule in CLAUDE.md, which drifted, see
// the note at the top of _shared/ai.ts. The prompt and the response shape now
// exist once, so they cannot disagree.
//
// Whether one model actually READS labels better than another is the open
// question the toggle exists to answer, which only works if everything except
// the model is held identical. Cost was never the bottleneck at our volume.
//
// Needs whichever secret the chosen provider uses (XAI_API_KEY,
// ANTHROPIC_API_KEY, QWEN_API_KEY); the model ids and endpoints are
// configurable per provider, see _shared/ai.ts. Without the key the function
// hard-fails with a clear message (unlike search-foods, this has no free
// fallback source).
//
// One action: POST { image: <base64, no data: prefix>, mimeType?: 'image/jpeg',
// provider?: 'grok' | 'claude' | 'qwen' }
// -> { is_nutrition_label, name, brand, basis, serving_size_g, serving_label,
//      calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g,
//      sodium_mg }. The last three arrived with migration 0204; sodium is
//      returned in MILLIGRAMS whatever unit the label printed.

import { ADMIN_EMAIL, jsonResponse, preflight, resolveUser, withinQuota } from '../_shared/edge.ts';
import { callModel, extractJson, num, resolveProvider, str } from '../_shared/ai.ts';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const MAX_IMAGE_CHARS = 8_000_000;
const DAILY_SCAN_LIMIT = 60;
const MAX_TOKENS = 1500;

// Grok has been the default since this feature shipped; an unrecognised
// provider falls back to it.
const DEFAULT_PROVIDER = 'grok';

// No reasoning in any label scanner. Reading numbers off a printed table needs
// no deliberation, and the reasoning is billed as output tokens while somebody
// stands in a supermarket aisle waiting for the sheet to fill in. Two of the
// three models default it ON, so this is a real switch-off rather than a
// formality, see the thinking policy in _shared/ai.ts. The counterpart is
// parse-meal, which passes a budget for exactly the opposite reason.
const REASONING_BUDGET = null;

const LABELS = { tag: 'scan-label', feature: 'Label scanning', subject: 'label reader' };

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

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const caller = await resolveUser(req);
  if (!caller) return jsonResponse({ error: 'unauthorized' }, 401);
  const isAdmin = caller.email === ADMIN_EMAIL;
  if (!isAdmin && !await withinQuota(caller.id, 'scan', DAILY_SCAN_LIMIT)) {
    return jsonResponse({ error: `That is ${DAILY_SCAN_LIMIT} label scans today, well past normal use. The limit resets tomorrow; add the food manually until then.` }, 429);
  }

  const body = await req.json().catch(() => ({}));
  const image = typeof body?.image === 'string' ? body.image.trim() : '';
  const mimeType = ALLOWED_MIME.has(body?.mimeType) ? body.mimeType : 'image/jpeg';
  const provider = resolveProvider(body?.provider, DEFAULT_PROVIDER);
  if (!image) return jsonResponse({ error: 'missing image' }, 400);
  if (image.length > MAX_IMAGE_CHARS) return jsonResponse({ error: 'Image too large. Try again.' }, 413);

  const result = await callModel(provider, {
    system: SYSTEM_PROMPT,
    userText: USER_PROMPT,
    image: { base64: image, mimeType },
    maxTokens: MAX_TOKENS,
    reasoningBudget: REASONING_BUDGET,
  }, LABELS);
  if (!result.ok) return jsonResponse({ error: result.error }, result.status);

  const parsed = extractJson(result.text);
  if (!parsed) {
    return jsonResponse({ error: 'Could not read the label. Try a clearer, straight-on photo, or add it manually.' }, 422);
  }

  return jsonResponse({
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
