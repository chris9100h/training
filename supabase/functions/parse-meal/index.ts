// Free-text meal description, an optional photo of the meal, or both ->
// estimated food log items, for the Food tracker's "Describe a meal" sheet
// (FoodScreen, screens-food.jsx). Built for informal, home-cooked,
// multi-component meals with vague portions ("a thin slice", "one roll")
// that search-foods has no real chance at: there is no Open Food Facts /
// USDA / zane_foods entry for someone's own breakfast, so this never touches
// that pipeline, it estimates directly.
//
// THREE BACKENDS, ONE FUNCTION. Claude, Grok and Qwen all run through this
// endpoint behind one identical contract; Qwen is the one actually called,
// for the cost, with Claude as the automatic fallback if Qwen itself is
// unreachable, see PRIMARY_PROVIDER/FALLBACK_PROVIDER below and
// callModelWithFallback in _shared/ai.ts. `provider` in the request body
// still forces one exact backend with no fallback, but nothing in the app
// sends it any more; it is a manual-testing hook, not a user-facing toggle.
// The three used to be separate functions kept in step by a rule in
// CLAUDE.md, which drifted, see the note at the top of _shared/ai.ts. The
// prompt, the validation and the response shape now exist once, so they
// cannot disagree.
//
// The photo, when given, uses the same base64 contract as scan-label
// (client-side downscaled first). description and image are both optional,
// but at least one is required. When both are given, the prompt treats the
// text as authoritative for anything the photo alone can't show, see
// SYSTEM_PROMPT. Vision runs through the same call as the text-only path, no
// separate request or model.
//
// User-triggered only, one call per request. The returned items are staged
// client-side exactly like a manually-typed Custom Item (never written to
// zane_food_logs here): the user reviews/removes before the existing "Add N
// items" flow actually logs anything, same as every other add path in
// FoodScreen.
//
// Calories are always DERIVED from protein/carbs/fat (4/4/9 kcal/g), never
// trusted as a separate number from the model, same rule search-foods
// applies to every external source: a model estimate of "calories" is one
// more number that can silently disagree with the macros sitting right next
// to it, deriving it removes that failure mode entirely.
//
// One action: POST { mode?: 'meal' | 'recipe', description?: string,
// image?: <base64, no data: prefix>, mimeType?: 'image/jpeg', provider?:
// 'claude' | 'grok' | 'qwen', previousItems?: [...] }. Recipe mode returns
// { recipeName, portions, items }, while meal mode keeps the original
// { items } contract. The two prompts intentionally stay separate: a recipe
// ingredient list is a batch input for the editor, not a list of foods eaten
// right now.
//
// previousItems is refine mode: the caller's own prior estimate from an
// earlier call to this same endpoint, sent back alongside new or corrected
// description/image so the model revises that estimate instead of starting
// over. See SYSTEM_PROMPT and buildUserText.
//
// Needs whichever secret the chosen provider uses (ANTHROPIC_API_KEY,
// XAI_API_KEY, QWEN_API_KEY); the model ids and endpoints are configurable
// per provider, see _shared/ai.ts.

import { ADMIN_EMAIL, jsonResponse, preflight, resolveUser, withinQuota } from '../_shared/edge.ts';
import {
  callModel,
  callModelWithFallback,
  extractJson,
  isProviderId,
  num,
  str,
  stripEmDash,
  type ModelImage,
} from '../_shared/ai.ts';

const DAILY_MEAL_PARSE_LIMIT = 60;
const MAX_DESCRIPTION_CHARS = 2000;
// Bounded JPEG from the client's fdDownscaleImage, this is just a sanity
// ceiling against an unexpectedly huge upload.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const MAX_IMAGE_CHARS = 8_000_000;
// A legitimate refine payload only ever echoes the model's own prior output
// (bounded by that call's own max_tokens), so both bounds are generous.
// Unlike description/image above, previousItems had no cap at all before
// this: unbounded, it went straight into the prompt as JSON.stringify'd
// text, at both the client's own quota cost and the provider's.
const MAX_PREVIOUS_ITEMS = 50;
const MAX_ITEM_NAME_CHARS = 200;

// A ceiling on what may be generated, not a reservation. Reasoning tokens
// count against it, which is why it is not the 2000 this used to carry: a long
// deliberation would have eaten the allowance and truncated the JSON object
// itself, and a truncated object parses as zero items, surfacing as a bogus
// "could not find any food" rather than as an error.
const MAX_TOKENS = 8000;

// How many tokens the model may spend deliberating before it has to start
// writing the answer. The same number for every provider, so the toggle
// compares models rather than how much rope each one was handed.
//
// Calibrated from measurement, not taste. On one meal photo with no
// accompanying text: Grok at reasoning_effort 'low' spent 1224 reasoning
// tokens, uncapped Qwen spent roughly 2950 on the identical picture, and the
// visible JSON was about 150 tokens either way. Uncapped Qwen took 24.1s for
// that, where the label scanner (no reasoning at all, same route, same image)
// answered in 1.7s, so almost the entire wait was deliberation. 1200 is Grok's
// own measured appetite, which makes it the honest number to hold the others
// to.
//
// This bounds ONLY the thinking. When the budget runs out the model stops
// deliberating and writes the answer, so unlike MAX_TOKENS it cannot truncate
// the JSON object.
const REASONING_BUDGET = 1200;

// Qwen runs first for the cost; Claude was the long-standing default before
// Qwen existed and is what a Qwen failure falls back to, see
// callModelWithFallback in _shared/ai.ts.
const PRIMARY_PROVIDER = 'qwen';
const FALLBACK_PROVIDER = 'claude';

const LABELS = { tag: 'parse-meal', feature: 'Meal parsing', subject: 'meal estimator' };

const RECIPE_LABELS = { tag: 'parse-recipe', feature: 'Recipe photo import', subject: 'recipe parser' };

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

// Recipe mode is deliberately a separate prompt instead of bolting more
// conditional instructions onto SYSTEM_PROMPT. The meal parser's job is to
// estimate what was eaten; this one reconstructs a whole batch for a recipe
// editor. In particular, quantities and macros are for the full recipe, not
// one serving, and ingredient names are normalized to English so the editor
// can be searched/reviewed consistently even when the source recipe is in
// German or another language.
const RECIPE_SYSTEM_PROMPT = `You reconstruct a cooking recipe from a recipe photo, an optional text note, or both. Read the complete ingredient list and identify every separate ingredient that belongs in the finished recipe. Estimate the amount for the FULL BATCH, not per serving. Keep ingredients separate even when they are repeated or used in different steps. If an amount is vague ("to taste", "a splash", "as needed"), make a sensible gram estimate and let the user adjust it later rather than dropping the ingredient.

For every ingredient, the JSON field "name" MUST be a clear canonical ENGLISH ingredient name, regardless of the language used in the photographed or typed recipe. Translate German, Spanish, French, and other source-language ingredient names into English. Do not leave German words, untranslated headings, or source-language labels in ingredient names. Preserve a useful brand or variety in English when it is part of the ingredient (for example "low-fat Greek yogurt"). This English-only rule applies to ingredient names, not to the recipe title.

Infer a concise recipe title and the number of servings when they are visible or stated. If either is unclear, return an empty title or 1 serving; never invent a detailed title from unrelated text. Nutrition is an estimate for the raw ingredient amount in the full batch. Every quantityG and every macro value must describe the complete amount of that ingredient used in the batch, never a per-100g value and never a single-serving value. Take a short private arithmetic pass before returning JSON: multiply each ingredient's protein by 4, carbs by 4, and fat by 9 and compare that energy with the ingredient's quantity. If an ingredient is energy-dense, use a normal full-fat nutrition profile for the named ingredient rather than a low-calorie textbook estimate. As conservative reality checks, oil is about 8 kcal/g, sugar about 4 kcal/g, chocolate and hazelnut spread about 5 kcal/g, mascarpone about 4 kcal/g, heavy or whipping cream about 3 kcal/g, and nuts about 6 kcal/g. Those numbers are lower bounds, not target values: do not clamp every dense ingredient to the minimum. Do not silently choose a light, low-fat, or reduced-fat product unless the recipe explicitly says so. Calories are derived by the server from protein, carbs, and fat, so never output a calories field.

Return exactly one JSON object, with no markdown fences and no text after it, in this shape:
{
  "recipeName": string,
  "portions": number,
  "items": [
    { "name": string, "quantityG": number, "protein": number, "carbs": number, "fat": number, "fiber": number or null, "sugar": number or null, "satFat": number or null, "sodiumMg": number or null }
  ]
}
Use grams for quantityG, grams for protein/carbs/fat/fiber/sugar/satFat, and milligrams for sodiumMg. Use null where a micronutrient cannot be estimated. Keep quantities and macros non-negative. Never use an em dash in a name; use a comma or period instead. If no readable recipe ingredients are present, return {"recipeName":"","portions":1,"items":[]}.`;

// Same rule as search-foods' caloriesFromMacros: calories are always derived
// from protein/carbs/fat (standard 4/4/9 kcal/g), never a separate number
// trusted from the model.
function caloriesFromMacros(p: number, c: number, f: number): number {
  return Math.round(p * 4 + c * 4 + f * 9);
}

type RecipeNutrition = {
  name: string;
  quantityG: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  sugar: number | null;
  satFat: number | null;
  sodiumMg: number | null;
};

function normalizedIngredientName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// These are deliberately conservative lower bounds, not a replacement for
// a food database. They catch the dangerous failure mode where a vision model
// returns values that look like a small serving or per-100g estimate for a
// large amount of a dense ingredient. Low-fat wording opts out because a
// genuinely light product can be far below the normal ingredient density.
function recipeKcalFloor(name: string): number | null {
  const normalized = normalizedIngredientName(name);
  if (/\b(light|low fat|low calorie|reduced fat|fat free|skim|semi skimmed|nonfat|fettarm|mager|entrahmt)\b/.test(normalized)) return null;
  if (/\b(chocolate milk|chocolate pudding|chocolate yogurt)\b/.test(normalized)) return null;
  if (/\b(nutella|hazelnut spread|chocolate hazelnut spread|nuss nougat creme|nuss nougat cream)\b/.test(normalized)) return 4.5;
  if (/\b(dark chocolate|milk chocolate|white chocolate|baking chocolate|chocolate chips|chocolate bar|chocolate|dunkle schokolade|schokolade|couverture|kuvertuere)\b/.test(normalized)) return 4.5;
  if (/\b(mascarpone)\b/.test(normalized)) return 3.5;
  if (/\b(heavy cream|heavy whipping cream|whipping cream|double cream|sahne|vollrahm|schlagsahne)\b/.test(normalized)) return 2.8;
  if (/\b(oil|olive oil|rapeseed oil|canola oil|vegetable oil|coconut oil|butter|ghee|shortening|rapsol|sonnenblumenoel|speiseoel)\b/.test(normalized)) return 7;
  if (/\b(sugar|brown sugar|powdered sugar|icing sugar|zucker)\b/.test(normalized)) return 3.6;
  if (/\b(almond|almonds|walnut|walnuts|pecan|pecans|peanut|peanuts|hazelnut|hazelnuts|cashew|cashews|pistachio|pistachios)\b/.test(normalized)) return 4.5;
  return null;
}

function guardRecipeNutrition(item: RecipeNutrition): RecipeNutrition {
  const floor = recipeKcalFloor(item.name);
  if (!floor || item.quantityG <= 0) return item;

  const currentCalories = caloriesFromMacros(item.protein, item.carbs, item.fat);
  const minimumCalories = Math.round(item.quantityG * floor);
  if (currentCalories >= minimumCalories) return item;

  // Scale the model's own macro proportions instead of inventing a new food
  // profile. The cap keeps a malformed response reviewable rather than letting
  // one bad token create absurd nutrition values.
  const factor = currentCalories > 0 ? Math.min(4, minimumCalories / currentCalories) : 1;
  const scale = (value: number | null): number | null => value == null ? null : Math.round(value * factor * 10) / 10;
  if (currentCalories <= 0) {
    return { ...item, fat: Math.round((minimumCalories / 9) * 10) / 10 };
  }
  return {
    ...item,
    protein: scale(item.protein) ?? 0,
    carbs: scale(item.carbs) ?? 0,
    fat: scale(item.fat) ?? 0,
    fiber: scale(item.fiber),
    sugar: scale(item.sugar),
    satFat: scale(item.satFat),
    sodiumMg: item.sodiumMg == null ? null : Math.round(item.sodiumMg * factor),
  };
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

function buildRecipeUserText(description: string, hasImage: boolean): string {
  if (hasImage && description) return `Recipe photo attached. Additional details from the user (for example servings or a correction):\n${description}`;
  if (hasImage) return 'Recipe photo attached. Read the ingredients and recipe title from the photo.';
  return `Recipe text:\n${description}`;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const caller = await resolveUser(req);
  if (!caller) return jsonResponse({ error: 'unauthorized' }, 401);
  const isAdmin = caller.email === ADMIN_EMAIL;

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'recipe' ? 'recipe' : 'meal';
  const isRecipe = mode === 'recipe';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const rawImage = typeof body?.image === 'string' ? body.image.trim() : '';
  const mimeType = ALLOWED_MIME.has(body?.mimeType) ? body.mimeType : 'image/jpeg';
  // Manual-testing override only, see the file header; the app never sends this.
  const explicitProvider = isProviderId(body?.provider) ? body.provider : null;
  // Refine mode: the caller's own prior estimate from an earlier call to
  // this endpoint, sanitized the same defensive way as every other
  // numeric/string field in this file. Optional, never relaxes the
  // description/image requirement below.
  const rawPreviousItems = Array.isArray(body?.previousItems) ? body.previousItems : [];
  if (rawPreviousItems.length > MAX_PREVIOUS_ITEMS) return jsonResponse({ error: 'Too many items to refine at once.' }, 413);
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
  if (!description && !rawImage) return jsonResponse({ error: 'missing description or image' }, 400);
  if (description.length > MAX_DESCRIPTION_CHARS) return jsonResponse({ error: 'Description too long. Try a shorter one.' }, 413);
  if (rawImage.length > MAX_IMAGE_CHARS) return jsonResponse({ error: 'Image too large. Try again.' }, 413);

  if (!isAdmin && !await withinQuota(caller.id, 'meal_parse', DAILY_MEAL_PARSE_LIMIT)) {
    return jsonResponse({ error: `That's ${DAILY_MEAL_PARSE_LIMIT} meal descriptions today, well past normal use. The limit resets tomorrow; add items manually until then.` }, 429);
  }

  const image: ModelImage | null = rawImage ? { base64: rawImage, mimeType } : null;
  const modelCall = {
    system: isRecipe ? RECIPE_SYSTEM_PROMPT : SYSTEM_PROMPT,
    userText: isRecipe ? buildRecipeUserText(description, !!rawImage) : buildUserText(description, !!rawImage, previousItems),
    image,
    maxTokens: MAX_TOKENS,
    // Recipe photos need a bounded arithmetic pass: Qwen's no-thinking path
    // is fast, but it was the source of the implausibly low dense-ingredient
    // values that the deterministic guard can only partially repair. The
    // shared Qwen adapter sends this as enable_thinking:true with the same
    // measured ceiling used by meal estimates, so it cannot become an
    // unbounded wait again.
    reasoningBudget: REASONING_BUDGET,
  };
  const labels = isRecipe ? RECIPE_LABELS : LABELS;
  const result = explicitProvider
    ? await callModel(explicitProvider, modelCall, labels)
    : await callModelWithFallback(PRIMARY_PROVIDER, FALLBACK_PROVIDER, modelCall, labels);
  if (!result.ok) return jsonResponse({ error: result.error }, result.status);

  // The prompt's visible self-check arithmetic is deliberately brace-free, so
  // extractJson's first `{` is the JSON object whether or not it ran.
  const parsed = extractJson(result.text);
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];

  const items = rawItems
    .map((it: Record<string, unknown>) => {
      const name = str(it?.name);
      if (!name) return null;
      const protein = Math.max(0, num(it?.protein) ?? 0);
      const carbs = Math.max(0, num(it?.carbs) ?? 0);
      const fat = Math.max(0, num(it?.fat) ?? 0);
      const base: RecipeNutrition = {
        name: stripEmDash(name),
        quantityG: Math.max(0, num(it?.quantityG) ?? 100),
        protein, carbs, fat,
        fiber: num(it?.fiber),
        sugar: num(it?.sugar),
        satFat: num(it?.satFat),
        sodiumMg: num(it?.sodiumMg),
      };
      const nutrition = isRecipe ? guardRecipeNutrition(base) : base;
      return {
        ...nutrition,
        calories: caloriesFromMacros(nutrition.protein, nutrition.carbs, nutrition.fat),
      };
    })
    .filter((it: unknown): it is NonNullable<typeof it> => it !== null);

  if (!items.length) {
    return jsonResponse({ error: isRecipe
      ? 'Could not find any recipe ingredients. Try a clearer photo, more detail, or add them manually.'
      : 'Could not find any food there. Try a clearer photo, more detail, or add it manually.' }, 422);
  }

  if (isRecipe) {
    const recipeName = stripEmDash(str(parsed?.recipeName)).slice(0, 160);
    const portionsRaw = num(parsed?.portions);
    const portions = Math.min(100, Math.max(1, Math.round(portionsRaw ?? 1)));
    return jsonResponse({ recipeName, portions, items }, 200);
  }

  return jsonResponse({ items }, 200);
});
