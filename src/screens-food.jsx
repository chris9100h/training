/* Food Tracker screen: search Open Food Facts + USDA FoodData Central (via the
   search-foods Edge Function), log a quantity, and roll the result into the
   same daily macro fields the manual Health-tab form already writes. The day
   navigation is unbounded in both directions (backwards lazy-fetches past the
   boot window, forwards is what Plan Mode needs), and a "Custom Item" fallback
   covers foods not in either database.

   Food is stored per-entry (store.foodLogs, table zane_food_logs). On every
   add/delete the affected day's summed calories/protein/carbs/fat (and fiber,
   net-carb mode only) are written back into that day's daily log, so the
   Health tab and coaching macros stay in sync from one source of truth, same
   pattern as screens-water.jsx uses for water_ml.

   Three tabs: Log (today's totals + entries only), Search (find + add a
   food, also doubles as the ingredient picker while building a recipe),
   and Quick Add (Recent / Favorites / Recipes, three fast paths back to
   something already logged before, table zane_food_favorites/
   zane_food_recipes, migration 0187). A recipe is a named jsonb list of
   ingredient snapshots; adding one sums them into a single log entry
   (source: 'recipe'), not N separate ones. */

const { useState: useStateFd, useEffect: useEffectFd, useMemo: useMemoFd, useRef: useRefFd } = React;

function fdShiftDate(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + deltaDays);
  return LB.fmtISO(d);
}
// Every calendar date from `from` to `to` inclusive, 'YYYY-MM-DD' strings.
// Used by the Stats sheet to build a chart series with a bar (or gap) for
// every day in the period, not just days that happen to have a log.
function fdDateRange(from, to) {
  const out = [];
  const cur = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
  let guard = 0;
  while (cur <= end && guard < 1000) {
    out.push(LB.fmtISO(cur));
    cur.setDate(cur.getDate() + 1); guard++;
  }
  return out;
}
const fdNum = v => (v === '' || v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
const fdRound1 = v => Math.round(v * 10) / 10;
// The grams figure to actually SHOW for a logged/planned entry or template
// slot. quantityG on a grams-mode recipe entry is the scaled raw-ingredient
// sum (needed elsewhere, e.g. Shopping List projections), not the cooked-
// dish weight the user actually typed, showing that number next to a name
// already suffixed "(500g)" read as two disagreeing amounts for the same
// entry. loggedCookedGrams is null for every non-grams-mode entry, so this
// is a no-op everywhere else.
const fdDisplayG = e => e?.loggedCookedGrams ?? e?.quantityG;
// Grams of the finished dish <-> the equivalent chosenPortions, so a recipe
// with a cookedWeightG can be logged by weight while every downstream
// consumer (confirmRecipeLog, draftBuilt, the live preview) keeps reading
// the same chosenPortions/totalPortions pair it always has, grams is purely
// an alternate input unit that resolves to that pair before anything else
// runs, not a second scaling path.
const fdGramsToPortions = (grams, cookedWeightG, totalPortions) => cookedWeightG > 0 ? (grams / cookedWeightG) * totalPortions : 0;
// Inverse, used only to carry the current amount across when the Portions/
// Grams toggle itself is flipped, so switching units mid-edit doesn't reset
// the quantity back to some default.
const fdPortionsToGrams = (portionsVal, cookedWeightG, totalPortions) => totalPortions > 0 ? (portionsVal / totalPortions) * cookedWeightG : 0;
// The chosenPortions a recipe-log prompt is actually at right now, resolving
// grams mode down to its portions equivalent. Shared by the live macro
// preview and confirmRecipeLog so the number the user sees is exactly the
// number that gets logged.
function fdEffectiveChosenPortions(prompt) {
  if (!prompt) return 0;
  if (prompt.mode === 'grams' && prompt.recipe.cookedWeightG > 0) {
    return fdGramsToPortions(fdNum(prompt.gramsStr) || 0, prompt.recipe.cookedWeightG, prompt.totalPortions);
  }
  return prompt.chosenPortions;
}
// Splits `total` into `n` whole-number parts as evenly as possible, remainder
// (from integer rounding) landing on the first parts so they always sum back
// to `total` exactly. Used by the timeline's "split into multiple meals".
function fdEvenSplit(total, n) {
  const base = Math.floor(total / n);
  const rem = Math.round(total) - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}
// Same idea as fdEvenSplit but for display-unit amounts (pieces, which can be
// fractional, e.g. 3 wraps over 2 meals is 1.5 each), rounded to 2 decimals
// with any rounding drift folded into the last part so the sum stays exact.
// Used to live-redistribute a split's OTHER fields when one gets hand-typed.
function fdEvenSplitFloat(total, n) {
  if (n <= 0) return [];
  const base = Math.round((total / n) * 100) / 100;
  const parts = Array.from({ length: n }, () => base);
  const drift = Math.round((total - base * n) * 100) / 100;
  parts[n - 1] = Math.round((parts[n - 1] + drift) * 100) / 100;
  return parts;
}
// Next hour at or after `preferred` (wrapping to the start of the day if the
// day runs out) with no existing entries (byHour) and not already claimed by
// another meal in this same split (`taken`), so the default proposal for a
// new split meal never silently lands on top of an unrelated existing entry
// or on top of another new meal's own hour. Without this a preferred hour
// past 19 clamps straight to 23 with no free-hour search at all, which for a
// preferred hour of exactly 23 (a stack starting at 19+) proposes putting
// the new meal on the SAME hour as the one being split. Falls back to
// `preferred` itself only if every hour of the day is already taken, same
// degraded "user has to fix it by hand" outcome the unconditional clamp
// always had, just no longer the common case.
function fdNextFreeHour(preferred, byHour, taken) {
  const isFree = h => !(byHour[h] || []).length && !taken.includes(h);
  for (let h = preferred; h <= 23; h++) if (isFree(h)) return h;
  for (let h = 0; h < preferred; h++) if (isFree(h)) return h;
  return preferred;
}
// Scales a food-log entry's amount/macros/ingredient-snapshot by `scale`, for
// "split into multiple meals": a fixed-composition food or recipe batch
// scales every field (and each recipeItems ingredient) linearly by the same
// factor, same math the quantity sheet's per-100g preview already uses.
function fdScaleEntry(e, scale) {
  const sc = (v) => v != null ? Math.round(v * scale) : v;
  const sc1 = (v) => v != null ? fdRound1(v * scale) : v;
  return {
    quantityG: sc(e.quantityG), calories: sc(e.calories),
    protein: sc1(e.protein), carbs: sc1(e.carbs), fat: sc1(e.fat),
    fiber: e.fiber != null ? sc1(e.fiber) : null,
    sugar: e.sugar != null ? sc1(e.sugar) : null,
    satFat: e.satFat != null ? sc1(e.satFat) : null,
    sodiumMg: e.sodiumMg != null ? sc(e.sodiumMg) : null,
    recipeItems: e.recipeItems ? e.recipeItems.map(ri => ({
      ...ri, quantityG: sc(ri.quantityG), calories: sc(ri.calories),
      protein: sc1(ri.protein), carbs: sc1(ri.carbs), fat: sc1(ri.fat),
      fiber: ri.fiber != null ? sc1(ri.fiber) : null,
      sugar: ri.sugar != null ? sc1(ri.sugar) : null,
      satFat: ri.satFat != null ? sc1(ri.satFat) : null,
      sodiumMg: ri.sodiumMg != null ? sc(ri.sodiumMg) : null,
    })) : null,
  };
}
// Ingredients read top-heavy (biggest contributor first) rather than in
// whatever order they were added/picked, which has no relationship to
// amount and reads as a random jumble on anything past a couple of
// ingredients. Display-only: never mutates or reorders the underlying
// stored array (recipe.items, entry.recipeItems), only what a given render
// site iterates. Used by the timeline's expanded ingredient view, the
// recipe editor, and an incoming share preview.
function fdSortIngredientsByQty(items) {
  return [...(items || [])].sort((a, b) => (b.quantityG || 0) - (a.quantityG || 0));
}
// Shared precondition for anything about to write a row that references a
// zane_foods food_id (favorites, log entries, recipe ingredients): a DB food
// only gets its zane_foods row on first log (see confirmLogFood), so any
// other write that can reach it first (favoriting straight from search,
// staging a recipe ingredient) must cache it itself, or the FK check on that
// write fails every retry forever. Called from toggleFavorite, confirmLogFood
// and FdIngredientPicker's confirmStageItem. Expects an object with source/
// sourceId/fromCache (pendingFood and FdIngredientPicker's qtyItem both have
// this shape already).
//
// Returns whether the food is actually cached now. confirmLogFood and
// confirmStageItem fire this without awaiting the result and rely on the
// self-heal cacheFood itself documents (a dropped call gets retried on the
// next log of the same food), so they can ignore it. toggleFavorite cannot:
// it awaits this specifically so the favorite it is about to write never
// races ahead of the cache row its food_id points at, and cacheFood's
// underlying fetch resolves even on a failed request rather than rejecting,
// so without checking the result here that guarantee was never enforced.
async function ensureFoodCached(pendingFoodOrItem) {
  if (pendingFoodOrItem?.sourceId && !pendingFoodOrItem.fromCache) {
    const res = await LB.cacheFood(pendingFoodOrItem.source, pendingFoodOrItem.sourceId);
    return !!(res && res.ok);
  }
  return true;
}
// Label-scanner provider: one per-device setting (localStorage key
// logbook-label-scanner-provider) read by TWO components that can be mounted
// at the same time (FoodScreen and the ingredient picker's search tab). Each
// held its own useState seeded once at mount, so toggling in one left the
// other on the old provider for the rest of the session. Route every read and
// write through here and broadcast the change.
function fdReadScannerProvider() {
  try { return localStorage.getItem('logbook-label-scanner-provider') || 'grok'; }
  catch (_) { return 'grok'; }
}
function fdWriteScannerProvider(v) {
  try { localStorage.setItem('logbook-label-scanner-provider', v); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('zane-scanner-provider', { detail: v })); } catch (_) {}
}
// English ordinal suffix for the meal-of-choice weekly counter ("1st", "2nd",
// "3rd", "4th", …), 11th/12th/13th excepted from the 1/2/3 rule.
function fdOrdinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
// Input filter for decimal numeric fields (grams, macros): keeps digits and a
// single decimal point, normalizing a typed comma to a point first (mobile
// keyboards in German locale emit ',' on the decimal key, and many nutrition
// figures are fractional, e.g. a 37.5g cookie).
// Capped at one decimal digit (every figure in this module, typed or
// computed, is meant to read at 1 decimal max): the food logger has no use
// for more precision than that, and it's what let a typed value carry
// enough digits to surface as raw floating-point noise once multiplied
// through a scaling calculation elsewhere.
function fdDecimalFilter(raw) {
  let v = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 1);
  return v;
}

// Shared "derive calories from protein/carbs/fat unless the user has typed
// into the calorie field directly" rule, used by three calorie fields:
// kcal100Str (scanned custom item, per-100g), customCal (Custom Item sheet)
// and mCal (FdIngredientPicker's own manual entry). protein/carbs/fat are the
// typed string values for those fields; fiber is passed already resolved to
// a number-or-null (callers source it differently: a live per-100g figure vs
// a typed fiber string, so fdNum'ing it is left to the caller). `active`
// (default true) lets a caller suspend deriving under some other condition
// (kcal100Str only derives while pendingFood.custom is true). Returns
// [calStr, setCalStr, onChange, touched, setTouched]: the raw setters are
// still needed for full-form resets that clear both the value and the
// touched flag together.
function useAutoDerivedCalories(protein, carbs, fat, fiber, netCarbs, active = true) {
  const [calStr, setCalStr] = useStateFd('');
  const [touched, setTouched] = useStateFd(false);
  useEffectFd(() => {
    if (touched || !active) return;
    const p = fdNum(protein), c = fdNum(carbs), f = fdNum(fat);
    const raw = LB.caloriesFromMacros(p, c, f, netCarbs ? fiber : null);
    setCalStr(raw != null ? String(Math.round(raw)) : '');
  }, [protein, carbs, fat, fiber, netCarbs, touched, active]);
  function onChange(v) {
    const filtered = fdDecimalFilter(v);
    setTouched(filtered !== '');
    setCalStr(filtered);
  }
  return [calStr, setCalStr, onChange, touched, setTouched];
}

// Read a picked image file into a data URL.
function fdReadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
// Downscale + re-encode a label photo to a bounded JPEG before upload: keeps
// the request small (and cheap) while staying at the model's native ~1568px
// image cap, above which the server just downsamples anyway. Returns the raw
// base64 (no data: prefix) plus its mime type.
async function fdDownscaleImage(file, maxDim = 1568, quality = 0.72) {
  const dataUrl = await fdReadImageFile(file);
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('decode failed'));
    im.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(1, Math.round((img.width || 1) * scale));
  const h = Math.max(1, Math.round((img.height || 1) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL('image/jpeg', quality);
  return { base64: (out.split(',')[1] || ''), mimeType: 'image/jpeg' };
}

const FD_TABS = [
  { id: 'log', label: 'Log', icon: 'fa-list' },
  { id: 'search', label: 'Search', icon: 'fa-magnifying-glass' },
  { id: 'quickadd', label: 'Quick Add', icon: 'fa-bolt' },
];
const FD_SOURCE_FILTERS = [
  { id: null, label: 'All' },
  { id: 'zane', label: 'Zane' },
  { id: 'off', label: 'OFF' },
  { id: 'usda', label: 'USDA' },
];
const FD_QUICK_TABS = [
  { id: 'recent', label: 'Recent' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'recipes', label: 'Recipes' },
];
// The Log tab's timeline groups its hourly rows under a read-only per-meal
// summary card. The boundaries are a user setting since migration 0206
// (settings.mealWindows, edited in Settings > Health > Food), resolved through
// LB.mealCategories, which also owns the labels and the defaults.

// Build the planned food-log entry a template slot materializes into on a
// given date. Shared by the auto-fill effect (opening a day) and the immediate
// fill when a new slot is added, so both produce an identical entry shape.
// slot.id becomes templateSlotId, which the dedup keys off.
function fdMaterializeSlotEntry(slot, dateISO) {
  return {
    // Deterministic per (day, slot): two devices auto-filling the same morning
    // before either has synced would otherwise materialize the same slot with
    // different random ids, and the purely id-based boot-merge would union both
    // into duplicate meals (and double-count once checked off). A stable id makes
    // the two rows collide so mergeById collapses them into one.
    id: `pl_${dateISO}_${slot.id}`, date: dateISO, time: `${String(slot.hour ?? 12).padStart(2, '0')}:00`,
    foodId: slot.foodId ?? null, foodName: slot.foodName, brand: slot.brand ?? null, source: slot.source ?? null,
    quantityG: slot.quantityG, calories: slot.calories, protein: slot.protein, carbs: slot.carbs, fat: slot.fat,
    fiber: slot.fiber ?? null, sugar: slot.sugar ?? null, satFat: slot.satFat ?? null, sodiumMg: slot.sodiumMg ?? null,
    recipeItems: slot.recipeItems ?? null, recipeId: slot.recipeId ?? null,
    loggedTotalPortions: slot.loggedTotalPortions ?? null,
    loggedCookedGrams: slot.loggedCookedGrams ?? null, loggedCookedWeightG: slot.loggedCookedWeightG ?? null,
    planned: true, templateSlotId: slot.id,
    createdAt: new Date().toISOString(),
  };
}
// Does a slot's day_type apply on a given date? ('any' always; 'training' /
// 'rest' via the plan's training-day check).
function fdSlotMatchesDate(slot, store, dateISO) {
  if (slot.dayType === 'any' || !slot.dayType) return true;
  const isTraining = LB.isTrainingDayForDate(store, dateISO);
  return slot.dayType === 'training' ? isTraining : !isTraining;
}

// ── Shopping list ────────────────────────────────────────────────────
// What to buy, derived from two independent signals that never double-count
// the same food (see fdBuildShoppingList): the last FD_SHOPPING_ANALYSIS_DAYS
// of what was actually eaten (pattern detection), and the active meal plan's
// template slots projected across the shopping window (definite, not
// inferred). shoppingDays is a display/scale knob, not a second analysis
// window: it rescales the historical daily rate AND the projection
// lookahead together (see fdBuildShoppingList for why those two must move
// in lockstep instead of the projection staying fixed at a calendar week).
const FD_SHOPPING_ANALYSIS_DAYS = 14;
const FD_SHOPPING_STAPLE_MIN = 3;
const FD_SHOPPING_DAYS_DEFAULT = 7;
// Floor for the historical rate's denominator (see fdBuildShoppingList): a
// food whose only occurrences in the window are all recent doesn't get
// divided by the full FD_SHOPPING_ANALYSIS_DAYS, which would silently assume
// an empty earlier week actually happened. Flooring at a week (rather than
// using the raw day-span) keeps a single very-recent occurrence from being
// read as "needed every single day".
const FD_SHOPPING_RATE_FLOOR_DAYS = 7;
// Upper bound for the package-size/stock-baseline draft fields in the
// Shopping List edit sheet (saveEdit, below): fdDecimalFilter only strips
// non-numeric characters, it never caps magnitude, so a stray extra digit or
// a pasted barcode-length number would otherwise sail straight into the DB.
// 100kg is far past any real package or stash a user would actually track,
// so this only ever catches garbage input, never a genuine bulk-buyer.
const FD_SHOPPING_QTY_MAX_G = 100000;
// Same green threshold fdAdherenceColor/screens-health.jsx's adherenceColor
// already use for "on target": the Stats sheet's streak/goal-hit KPIs and
// chart target line reuse it rather than inventing a second definition of
// "good" for the same metric.
const FD_STATS_GOAL_ADHERENCE = 90;
function fdClampQtyG(n) {
  return n == null ? null : Math.min(FD_SHOPPING_QTY_MAX_G, n);
}

function fdNormFoodName(name) {
  return (name || '').trim().toLowerCase();
}
// Whole-day difference between two 'YYYY-MM-DD' dates (b − a), noon-anchored
// to dodge DST/midnight shifts (same approach as screens-health.jsx's
// healthDayDiff, reimplemented locally to keep this section self-contained).
function fdDaysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
}
// foodId is always "<source>:<sourceId>" (see confirmStageItem), so a
// name-based key can never collide with one.
function fdShoppingKey(foodId, foodName) {
  return foodId ? `id:${foodId}` : `name:${fdNormFoodName(foodName)}`;
}
// A food-log-shaped row (a real store.foodLogs entry, or a virtual
// fdMaterializeSlotEntry projection row, both share the same shape) -> its
// flat "leaf" items to tally. A recipe's recipeItems snapshot carries
// foodId/brand for anything logged since that pairing was added to
// applyBlockRecipe/confirmRecipeLog/the template slot's draftBuilt (see
// docs/database.md's zane_food_logs section); a legacy row logged before
// that (or one with no recipeItems at all, predating the snapshot entirely)
// falls back to a name-keyed, brand-less leaf rather than silently dropping
// it, same as it always did.
function fdExplodeForShopping(entry) {
  if (entry.source === 'recipe' && entry.recipeItems && entry.recipeItems.length) {
    return entry.recipeItems.map(ri => ({ foodId: ri.foodId ?? null, foodName: ri.foodName, brand: ri.brand ?? null, quantityG: ri.quantityG || 0 }));
  }
  return [{ foodId: entry.foodId || null, foodName: entry.foodName, brand: entry.brand || null, quantityG: entry.quantityG || 0 }];
}
// Registers both keys a favorite could be reached by, not just its own
// primary one: a favorite with a real foodId still gets its name-key added
// too, because the exact same food logged only through a temporary recipe
// never carries a foodId (see fdExplodeForShopping) and would otherwise
// tally under a name-key the favorite-boost could never match, dropping a
// favorited, recipe-only food entirely instead of just under-counting it.
function fdFavoriteShoppingKeys(foodFavorites) {
  const set = new Set();
  (foodFavorites || []).forEach(f => {
    set.add(fdShoppingKey(f.foodId, f.foodName));
    if (f.foodName) set.add(fdShoppingKey(null, f.foodName));
  });
  return set;
}
// A recipe-exploded ingredient never carries a foodId (see fdExplodeForShopping),
// so the SAME grocery item logged both standalone (search/barcode, a real
// foodId) and only ever inside a recipe lands as two separate groups purely
// because one has an id-key and the other a name-key, even though their
// foodName is identical. Folds any name-keyed group into an existing
// id-keyed group when their normalized names match, foodId stays the
// group's identity, only the totals (and the earliest firstDate, for
// fdBuildShoppingList's rate denominator) combine. A missing brand on the
// surviving row is backfilled from the dropped one (never overwrites one it
// already has): the id-keyed row is standalone-logged and may well have a
// brand the recipe-only occurrence never could (see fdExplodeForShopping).
// Mutates and returns `tally`.
function fdReconcileShoppingTally(tally) {
  const idKeyByName = new Map();
  tally.forEach((row, key) => { if (row.foodId) idKeyByName.set(fdNormFoodName(row.foodName), key); });
  const toDrop = [];
  tally.forEach((row, key) => {
    if (row.foodId) return;
    const idKey = idKeyByName.get(fdNormFoodName(row.foodName));
    if (!idKey || idKey === key) return;
    const target = tally.get(idKey);
    target.totalGrams += row.totalGrams;
    if (row.count != null) target.count = (target.count || 0) + row.count;
    if (row.firstDate && (!target.firstDate || row.firstDate < target.firstDate)) target.firstDate = row.firstDate;
    if (!target.brand && row.brand) target.brand = row.brand;
    toDrop.push(key);
  });
  toDrop.forEach(key => tally.delete(key));
  return tally;
}
// Last FD_SHOPPING_ANALYSIS_DAYS of ACTUALLY-EATEN entries (planned rows
// never count toward "what do I typically buy"). store.foodLogs is
// boot-windowed to LB.FOOD_HISTORY_WINDOW_DAYS (30, see foodHistCutoff
// above), well past 14, so this never needs the lazy old-date fetch the
// timeline's own scroll-back uses. date > todayISO is excluded too: Plan
// Mode allows future-dated rows, and those belong to the projection below,
// not the "what did I eat" tally.
function fdShoppingHistoryTally(foodLogs, todayISO) {
  const cutoff = fdShiftDate(todayISO, -(FD_SHOPPING_ANALYSIS_DAYS - 1));
  const tally = new Map();
  (foodLogs || []).forEach(e => {
    if (e.planned || e.date < cutoff || e.date > todayISO) return;
    fdExplodeForShopping(e).forEach(leaf => {
      const key = fdShoppingKey(leaf.foodId, leaf.foodName);
      const row = tally.get(key) || { foodId: leaf.foodId, foodName: leaf.foodName, brand: leaf.brand, totalGrams: 0, count: 0, firstDate: e.date };
      row.totalGrams += leaf.quantityG;
      row.count += 1;
      if (e.date < row.firstDate) row.firstDate = e.date;
      tally.set(key, row);
    });
  });
  return fdReconcileShoppingTally(tally);
}
// The active plan's slots projected across `days` calendar days from today
// (today included), reusing fdSlotMatchesDate/fdMaterializeSlotEntry
// verbatim, the exact functions the real per-day auto-fill effect uses.
// Empty map with no active plan or no slots: contributes nothing rather
// than throwing, callers treat an empty projection as "no plan-driven need".
function fdShoppingProjectionTally(store, todayISO, days) {
  const tally = new Map();
  const activePlanId = store.activeMealTemplateId;
  const slots = activePlanId ? (store.foodTemplateSlots || []).filter(s => s.mealPlanId === activePlanId) : [];
  if (!slots.length) return tally;
  for (let i = 0; i < days; i++) {
    const d = fdShiftDate(todayISO, i);
    slots.forEach(slot => {
      if (!fdSlotMatchesDate(slot, store, d)) return;
      fdExplodeForShopping(fdMaterializeSlotEntry(slot, d)).forEach(leaf => {
        const key = fdShoppingKey(leaf.foodId, leaf.foodName);
        const row = tally.get(key) || { foodId: leaf.foodId, foodName: leaf.foodName, brand: leaf.brand, totalGrams: 0 };
        row.totalGrams += leaf.quantityG;
        tally.set(key, row);
      });
    });
  }
  return fdReconcileShoppingTally(tally);
}
// fdReconcileShoppingTally only folds a name-keyed row into an id-keyed one
// WITHIN a single tally. A food logged standalone (real food_id, lands in
// hist) that's ALSO only ever eaten via a projected recipe slot (no
// food_id, lands in proj under a name key) survives reconciliation in both
// tallies as two separate rows under two different keys, since neither
// tally on its own has both variants to fold together. Re-keys any such
// name-keyed row (in either tally) to the matching id-keyed key when the
// SAME food (by normalized name) has a real food_id in EITHER tally,
// backfilling foodId/brand onto the moved row so it still carries its real
// product identity. Deliberately does NOT merge totalGrams/count/firstDate
// across hist and proj, a projection's quantity must stay only the
// projection's own total (see fdBuildShoppingList below). Mutates hist/proj
// in place; called once per fdBuildShoppingList run, before the two tallies
// are merged into a single key set.
function fdUnifyShoppingKeys(hist, proj) {
  const idRowByName = new Map();
  // Two genuinely different products (different real foodId) can normalize
  // to the same display name (e.g. the same "Chicken Breast" from two
  // different sources). Silently keeping whichever one .set() saw last would
  // let a name-keyed row (no foodId of its own) get backfilled onto the
  // WRONG specific product. Track the collision instead and simply decline
  // to guess for that name, same safe fallback as no id-row match at all.
  const ambiguousNames = new Set();
  [hist, proj].forEach(tally => tally.forEach(row => {
    if (!row.foodId) return;
    const name = fdNormFoodName(row.foodName);
    const existing = idRowByName.get(name);
    if (existing && existing.foodId !== row.foodId) { ambiguousNames.add(name); return; }
    idRowByName.set(name, row);
  }));
  [hist, proj].forEach(tally => {
    const renames = [];
    tally.forEach((row, key) => {
      if (row.foodId) return;
      const name = fdNormFoodName(row.foodName);
      if (ambiguousNames.has(name)) return;
      const idRow = idRowByName.get(name);
      if (!idRow) return;
      const idKey = fdShoppingKey(idRow.foodId, idRow.foodName);
      if (idKey === key) return;
      renames.push([key, idKey, { ...row, foodId: idRow.foodId, brand: row.brand || idRow.brand }]);
    });
    // A tally already has its own row under idKey only if fdReconcileShoppingTally
    // missed it, which it doesn't: within one tally there's at most one row
    // per normalized name, so this rename never collides with an existing entry.
    renames.forEach(([oldKey, newKey, newRow]) => { tally.delete(oldKey); tally.set(newKey, newRow); });
  });
}
// Merges the two signals without ever double-counting a food: a projected
// food's quantity is the projection's own total for the window, full stop,
// never added to the historical estimate (a template slot is a definite
// future need, not a second vote alongside an inferred one). A food with no
// projection falls back to the historical rate scaled to shoppingDays,
// gated by the staple/favorite threshold: a favorited food only needs to
// have actually been logged once in the window to qualify (favoriting is
// already a strong "I need this" signal), a non-favorited one needs 3+. A
// key only reaches the history map at all via a real occurrence, so
// "favorited but never logged in the window" can't reach this filter and is
// correctly never resurrected.
// The historical rate itself divides by the number of days since that
// food's EARLIEST occurrence in the window (floored at
// FD_SHOPPING_RATE_FLOOR_DAYS), not always by the full
// FD_SHOPPING_ANALYSIS_DAYS: a recipe cooked twice this week but never
// before has all of its history packed into the last few days, and dividing
// that by the full 14 would silently assume an equally-empty earlier week
// actually happened, halving the real weekly amount. A long-running staple
// whose occurrences already span the full window is unaffected, its
// earliest occurrence sits at the window's cutoff either way.
function fdBuildShoppingList(store, todayISO, shoppingDays) {
  const favKeys = fdFavoriteShoppingKeys(store.foodFavorites);
  const hist = fdShoppingHistoryTally(store.foodLogs, todayISO);
  const proj = fdShoppingProjectionTally(store, todayISO, shoppingDays);
  fdUnifyShoppingKeys(hist, proj);
  const keys = new Set([...hist.keys(), ...proj.keys()]);
  const out = [];
  keys.forEach(key => {
    const p = proj.get(key);
    // Only a projection that actually produced a positive quantity skips the
    // history fallback below: a recipe-scaled occurrence that rounds to 0g
    // is not a real future need, but it's also not a reason to suppress a
    // food that's genuinely a historical staple, same as if there had been
    // no projection entry for this key at all.
    if (p && p.totalGrams > 0) {
      out.push({ key, foodId: p.foodId || null, foodName: p.foodName, brand: p.brand || null, grams: p.totalGrams, fromProjection: true });
      return;
    }
    const h = hist.get(key);
    if (!h) return; // projection-only key (rounded to 0g) with no history to fall back to
    if (h.count < FD_SHOPPING_STAPLE_MIN && !favKeys.has(key)) return;
    const daysSpan = Math.max(FD_SHOPPING_RATE_FLOOR_DAYS, fdDaysBetween(h.firstDate, todayISO) + 1);
    const grams = (h.totalGrams / daysSpan) * shoppingDays;
    if (grams > 0) out.push({ key, foodId: h.foodId || null, foodName: h.foodName, brand: h.brand || null, grams, fromProjection: false });
  });
  return out.sort((a, b) => a.foodName.localeCompare(b.foodName));
}
// Total grams of a specific food actually eaten (recipe-exploded, same as
// the historical-rate tally elsewhere in this file) from sinceISO through
// todayISO inclusive, planned entries excluded (not yet actually eaten).
// Used to derive a stock-tracked food's current amount from a manually-set
// baseline rather than a live-decremented counter that would need a hook in
// every food-logging code path, plus an undo hook wherever a log entry is
// later edited or deleted (see zane_food_shopping_prefs in
// docs/database.md). Compares real moments in time, not just calendar
// dates: day-granularity (truncating sinceISO to its date) sounded fine but
// wasn't, a same-day entry logged BEFORE the baseline was set still counted
// against it (a real report: updating stock at 2pm still deducted a 10am
// entry from hours earlier that day, the weighed/counted "X grams left"
// already accounted for it). entry.date/.time are local wall-clock (see
// zane_food_logs in docs/database.md), and a date-time string with no
// timezone designator parses as local too, so this compares correctly
// against sinceISO (a real UTC instant) without needing the browser's own
// UTC offset at all.
// Matches a leaf the same way fdReconcileShoppingTally folds the demand
// tally above: a leaf carrying its own foodId only ever counts against that
// exact id, a foodId-less leaf (a Custom Item, or a recipe-exploded
// ingredient predating the recipeItems snapshot) falls back to a
// normalized-name match instead. Without this fallback, logging the same
// product as a Custom Item silently never counted against its tracked
// stock, understating consumption the same way the demand tally did before
// that reconcile step existed.
function fdLeafMatchesFood(leaf, foodId, foodName) {
  if (leaf.foodId) return leaf.foodId === foodId;
  return fdNormFoodName(leaf.foodName) === fdNormFoodName(foodName);
}
function fdConsumedSince(foodLogs, foodId, foodName, sinceISO, todayISO) {
  const sinceMoment = new Date(sinceISO);
  let total = 0;
  (foodLogs || []).forEach(entry => {
    if (entry.planned || entry.date > todayISO) return;
    if (new Date(`${entry.date}T${entry.time || '00:00'}:00`) < sinceMoment) return;
    fdExplodeForShopping(entry).forEach(leaf => {
      if (fdLeafMatchesFood(leaf, foodId, foodName)) total += leaf.quantityG || 0;
    });
  });
  return total;
}
// Derives a stock-tracked food's current amount at read time from its
// manually-set baseline via fdConsumedSince above: null with tracking off (no
// baseline set, or a baseline somehow missing its stockSetAt to count forward
// from). Shared by fdApplyShoppingPrefs (below) and fdBuildInventoryList
// (further below): the Inventory tab lists a tracked pref row directly
// (there's no separate "item" wrapping it, unlike the Shopping List side), so
// this takes the pref row itself rather than an already-merged item.
function fdEffectiveStockG(pref, foodLogs, todayISO) {
  if (pref?.stockBaselineG == null || !pref.stockSetAt) return null;
  return Math.max(0, pref.stockBaselineG - fdConsumedSince(foodLogs, pref.foodId, pref.foodName, pref.stockSetAt, todayISO));
}
// Applies every stored per-food Shopping List preference
// (zane_food_shopping_prefs, synced cross-device via store.foodShoppingPrefs,
// see fdSetShoppingPref) in one pass: a display-name override (for the
// handful of foods whose bare name is genuinely ambiguous out of context, an
// OFF/USDA product naming only the flavor/variant, e.g. "Original", with the
// actual brand as its own field), an exclude flag, a package size for
// fdFormatShoppingQty below, and inventory tracking. All independent and
// optional; a food with no matching pref row gets none of them. Adds
// displayName/overridden (so the row can skip its own brand subtitle
// instead of showing it twice) to every item, then re-sorts by whatever
// ends up actually displayed. Matches on item.key, the same
// fdShoppingKey(foodId, foodName) both fdBuildShoppingList's demand tally
// and the pref row's own shopping_key (migration 0227) use, so a
// recipe-exploded ingredient or Custom Item with no real foodId still finds
// its pref row via a normalized-name fallback instead of never matching one.
// A fixed-duration "snooze": excluded_until N days from right now. Presets
// only (1 week/2 weeks/1 month in the edit sheet below), no date picker, so
// plain day counts are enough, no calendar-month edge cases to worry about.
function fdSnoozeUntil(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
function fdApplyShoppingPrefs(list, prefs, foodLogs, todayISO) {
  const byKey = new Map((prefs || []).map(p => [p.shoppingKey, p]));
  const now = new Date();
  const out = list.map(item => {
    const pref = byKey.get(item.key);
    // Only surfaced while still in the future: an expired snooze is exactly
    // as inert as no snooze at all, both for bucketing (excluded below) and
    // for what the edit sheet shows as "currently active".
    const tempExcludedUntil = (pref?.excludedUntil && new Date(pref.excludedUntil) > now) ? pref.excludedUntil : null;
    return {
      ...item,
      displayName: pref?.nameOverride || item.foodName,
      overridden: !!pref?.nameOverride,
      excluded: !!pref?.excluded || !!tempExcludedUntil,
      // The raw permanent flag, kept distinct from the effective `excluded`
      // above: the edit sheet's exclude picker needs to know specifically
      // whether THIS item is permanently excluded (to pre-select that
      // segment), not just "is it excluded at all" (which a temp snooze
      // alone would also satisfy).
      permanentExcluded: !!pref?.excluded,
      tempExcludedUntil,
      packageSizeG: pref?.packageSizeG ?? null,
      lowStockThresholdG: pref?.lowStockThresholdG ?? null,
      stockSetAt: pref?.stockSetAt ?? null,
      effectiveStockG: fdEffectiveStockG(pref, foodLogs, todayISO),
    };
  });
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
// Every food with inventory tracking on (a stock_baseline_g set), read
// straight off zane_food_shopping_prefs (store.foodShoppingPrefs), independent
// of fdBuildShoppingList's own staple/projection filter above: a bulk item
// bought twice a year is still something worth seeing and updating here, even
// through a long stretch where it never once qualifies as a shopping-list
// "staple". Uses the pref row's own food_name/brand (migration 0217) rather
// than cross-referencing foodLogs/foodFavorites for a name, so a tracked item
// stays identifiable in the Inventory tab even once it ages out of both.
// Shares fdEffectiveStockG/renderShoppingRow with the Shopping List tab (see
// ShoppingListScreen), just fed from this list instead of displayList.
function fdBuildInventoryList(store, todayISO, foodLogsOverride) {
  const foodLogs = foodLogsOverride || store.foodLogs;
  return (store.foodShoppingPrefs || [])
    .filter(p => p.stockBaselineG != null)
    .map(p => ({
      key: p.shoppingKey,
      foodId: p.foodId,
      foodName: p.foodName,
      brand: p.brand || null,
      displayName: p.nameOverride || p.foodName,
      overridden: !!p.nameOverride,
      excluded: !!p.excluded,
      packageSizeG: p.packageSizeG ?? null,
      lowStockThresholdG: p.lowStockThresholdG ?? null,
      stockSetAt: p.stockSetAt,
      effectiveStockG: fdEffectiveStockG(p, foodLogs, todayISO),
      grams: 0,
      fromProjection: false,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
// Below the effective threshold: lowStockThresholdG (migration 0232) when
// set, package size otherwise, only meaningful with stock tracking enabled
// (see fdApplyShoppingPrefs), a food with neither a threshold nor a package
// size has nothing to compare its stock against. The override exists
// because "below one package" alone fires too late for a food that gets
// eaten through faster than one package lasts, by the time it dips under
// package_size_g there might be nothing left at all.
function fdIsLowStock(item) {
  const threshold = item.lowStockThresholdG ?? item.packageSizeG;
  return threshold > 0 && item.effectiveStockG != null && item.effectiveStockG < threshold;
}
// The logical complement of fdIsLowStock above, same threshold precondition:
// tracked stock, a real threshold to compare against, and currently above
// it. Without either (no stock tracked at all, or tracked but no threshold
// ever set) this is false, not true, on purpose, a food with nothing to
// compare its stock against has no basis for "you have enough" either, and
// silently hiding it from the buy list while it might genuinely be at zero
// would be worse than just estimating demand for it like an untracked food.
function fdIsWellStocked(item) {
  const threshold = item.lowStockThresholdG ?? item.packageSizeG;
  return threshold > 0 && item.effectiveStockG != null && !fdIsLowStock(item);
}
// Per-device (CLAUDE.md localStorage-keys list): which low-stock "dip" the
// user has already seen the Running Low banner for, keyed by foodId ->
// the stockSetAt it was shown under. Keying on stockSetAt rather than a
// bare boolean means a later restock (which stamps a fresh stockSetAt) no
// longer matches the stored value, the banner comes back on its own next
// time that food dips low again, no separate reset needed anywhere.
function fdReadLowStockAcks() {
  try {
    const v = JSON.parse(localStorage.getItem('logbook-low-stock-acked'));
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (_) { return {}; }
}
function fdWriteLowStockAcks(v) {
  try { localStorage.setItem('logbook-low-stock-acked', JSON.stringify(v)); } catch (_) {}
}
// Display rounding: under 50g rounds to the nearest 5, under 1000g to the
// nearest 25, at or above 1000g switches to kg (fdRound1's "nearest 0.1" is
// exactly "nearest 100g" once expressed in kg, reused rather than writing a
// second decimal-rounding rule). Never rounds a genuinely non-zero amount
// down to a misleading 0.
// The numeric half of fdRoundShoppingQty below, split out so a caller that
// needs an actual gram amount (not a formatted display string) shares the
// exact same rounding, e.g. markBought's inventory write further below.
function fdRoundShoppingQtyG(grams) {
  if (!(grams > 0)) return 0;
  const unit = grams < 50 ? 5 : 25;
  return Math.round(grams / unit) * unit || unit;
}
function fdRoundShoppingQty(grams) {
  // Rounds to the nearest 5/25 FIRST, then checks the rounded value against
  // the 1000g cutoff, not the raw one: deciding off the raw value let
  // something like 990g round up to 1000g but still print as "1000g"
  // instead of switching to "1kg".
  const rounded = fdRoundShoppingQtyG(grams);
  if (!rounded) return '0g';
  if (rounded >= 1000) return `${fdRound1(rounded / 1000)}kg`;
  return `${rounded}g`;
}
// A package size is a fact printed on the product, not an estimate: unlike
// fdRoundShoppingQty above, this never rounds to a coarser display grid, only
// picks g vs kg and how many decimals to show (found via a real 372g wrap
// pack that fdRoundShoppingQty's nearest-25 rule was silently showing as
// 375g). Rounded to 1 decimal first (matching fdDecimalFilter's own
// input-side cap) purely to clean up float noise from summing many logged
// quantities, e.g. "741.23000000000001g" reading as "741.2g": that's noise
// cleanup, not the estimate-rounding fdRoundShoppingQty does, a whole-gram
// package fact like 372 passes through unchanged either way. parseFloat
// drops any trailing zeros in the kg branch so a round kg value still reads
// "1kg".
function fdExactShoppingQty(grams) {
  if (!(grams > 0)) return '0g';
  const g = Math.round(grams * 10) / 10;
  if (g < 1000) return `${g}g`;
  return `${parseFloat((g / 1000).toFixed(3))}kg`;
}
// Package-aware buy quantity. With no package size set, the plain rounded
// estimate above, unchanged, as `headline` with no `sub`. With one, the whole
// point of setting it was to shop by pack count, not by weight, so `headline`
// becomes "3 x 400g" (rounds UP, you can't buy half a pack), an exact fact
// about the product so it goes through fdExactShoppingQty, never
// fdRoundShoppingQty. `sub` used to just restate packs x size in kg, purely
// redundant with headline; it's the estimated need BEFORE rounding up to
// whole packages now instead, so a user can see how much headroom buying
// whole packages leaves them (still an estimate like the no-package-size
// case, so fdRoundShoppingQty, not fdExactShoppingQty). Exports use
// `headline` only, "3 x 400g" reads as a normal shopping-list line same as
// any plain amount.
function fdFormatShoppingQty(grams, packageSizeG) {
  if (!(packageSizeG > 0)) return { headline: fdRoundShoppingQty(grams), sub: null };
  const packs = Math.max(1, Math.ceil((grams || 0) / packageSizeG));
  return { headline: `${packs}× ${fdExactShoppingQty(packageSizeG)}`, sub: `~${fdRoundShoppingQty(grams)} needed` };
}
// The actual purchasable quantity in grams behind fdFormatShoppingQty's
// headline above: whole packages only with a package size (you can't buy
// half a pack), the same rounded estimate as fdRoundShoppingQty without
// one. Shared with markBought below so the number written to inventory on
// "bought it" is always exactly what the row's headline just showed, never
// a silently different raw estimate.
function fdShoppingBuyQtyG(grams, packageSizeG) {
  return packageSizeG > 0 ? Math.max(1, Math.ceil((grams || 0) / packageSizeG)) * packageSizeG : fdRoundShoppingQtyG(grams);
}
// Per-device only (CLAUDE.md localStorage-keys list): a low-stakes personal
// preference, not worth a synced setting/migration, self-heals to the
// default on a fresh device. Unlike logbook-label-scanner-provider this has
// exactly one simultaneous reader (ShoppingListScreen itself), so no
// cross-component broadcast is needed.
function fdReadShoppingDays() {
  try { const v = parseInt(localStorage.getItem('logbook-shopping-list-days'), 10); return v > 0 ? v : FD_SHOPPING_DAYS_DEFAULT; }
  catch (_) { return FD_SHOPPING_DAYS_DEFAULT; }
}
function fdWriteShoppingDays(v) {
  try { localStorage.setItem('logbook-shopping-list-days', String(v)); } catch (_) {}
}
// Finds-or-creates this food's zane_food_shopping_prefs row, merges `patch`
// (one or more of nameOverride/excluded/packageSizeG/stockBaselineG+
// stockSetAt, plus foodName/brand, see below) into it, and deletes the row
// instead of upserting it if the merge leaves everything at its default (no
// override, not excluded, no package size, no stock baseline): a row with
// nothing to say has no reason to exist. stockBaselineG uses == null, not a
// falsy check: a baseline of exactly 0 (genuinely out of stock) is
// meaningful, not "unset". foodName/brand (migration 0217) are a plain
// identity snapshot, like zane_food_logs/zane_food_favorites already do;
// they don't count towards isDefault, a food's own name never keeps an
// otherwise-empty row alive by itself. Every live call site (saveEdit,
// markBought) always includes the item's current foodName/brand in
// patch, this is the only place that writes this table, so the snapshot can
// never silently go stale relative to what the list itself shows for the
// same key. Needed so the Inventory tab (fdBuildInventoryList) can show a
// name for a tracked item independent of fdBuildShoppingList's own
// staple/projection filter. setStore drives it through the normal syncStore
// diff/upsert like any other collection, so this doesn't touch Supabase
// directly.
// Keyed on fdShoppingKey(item.foodId, item.foodName) (migration 0227), not
// item.foodId alone: a recipe-exploded ingredient or a Custom Item (Describe
// a meal's AI estimates always log foodId: null, see commitMealItems above)
// has no real product match, but still needs somewhere to persist an
// exclude/rename/stock preference. The same key fdBuildShoppingList already
// tallies demand under, so a name-keyed pref matches its item exactly the
// way an id-keyed one always has.
function fdSetShoppingPref(setStore, item, patch) {
  const key = fdShoppingKey(item.foodId, item.foodName);
  setStore(s => {
    const list = s.foodShoppingPrefs || [];
    const existing = list.find(p => p.shoppingKey === key);
    const merged = { ...(existing || { id: LB.uid(), shoppingKey: key, foodId: item.foodId || null, nameOverride: null, excluded: false, excludedUntil: null, packageSizeG: null, lowStockThresholdG: null, stockBaselineG: null, stockSetAt: null, foodName: null, brand: null }), ...patch };
    // An expired excludedUntil is as meaningless as a null one here: without
    // this check, a snoozed item whose date has already passed would keep
    // this row alive forever (never eligible for the delete-when-default
    // cleanup below) even after it has no actual effect on the list anymore.
    const tempStillActive = merged.excludedUntil && new Date(merged.excludedUntil) > new Date();
    const isDefault = !merged.nameOverride && !merged.excluded && !tempStillActive && merged.packageSizeG == null && merged.stockBaselineG == null && merged.lowStockThresholdG == null;
    const next = isDefault
      ? list.filter(p => p.shoppingKey !== key)
      : existing
        ? list.map(p => p.shoppingKey === key ? merged : p)
        : [...list, merged];
    return { ...s, foodShoppingPrefs: next };
  });
}
// One food per line, plain text (no bullets/markdown: Notes and every other
// notes app render those as literal characters, not a real list), in the
// same alphabetical order fdApplyShoppingPrefs already sorted them in.
// displayName (not the raw foodName) so a renamed item exports under its
// override too, that was the whole point of being able to rename it.
function fdBuildShoppingExportText(list, withAmounts) {
  return list.map(item => withAmounts ? `${item.displayName} ${fdFormatShoppingQty(item.grams, item.packageSizeG).headline}` : item.displayName).join('\n');
}
// HTML twin of the text above, a real <ul><li> list rather than \n-joined
// lines: a raw string's \n reads to Notes' paste parser as a soft line break
// WITHIN one paragraph (still one checklist item), not a paragraph break, so
// plain text alone can't reliably become one checklist row per food.
// Explicit <li> boundaries remove that guesswork. Escaped because
// displayName comes from OFF/USDA data, free-typed custom entries, or a
// user's own override, any of which could contain '&'/'<'/'>' (e.g. "M&M's").
function fdBuildShoppingExportHtml(list, withAmounts) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = list.map(item => `<li>${esc(withAmounts ? `${item.displayName} ${fdFormatShoppingQty(item.grams, item.packageSizeG).headline}` : item.displayName)}</li>`).join('');
  return `<ul>${rows}</ul>`;
}

// Plan Mode "did I eat this?" checkbox on a timeline entry: an empty
// accent-bordered box when planned (not eaten yet), the same box filled with a
// check once logged (eaten). Tapping toggles the entry's planned state.
// disabled/label are only used by the Shopping List's own reuse of this for
// its include/exclude toggle (a different meaning than planned/eaten, hence
// the label override; disabled covers rows with no stable id to toggle at
// all), both optional and unused by the original two call sites above.
function FdCheckbox({ checked, onToggle, disabled, label }) {
  return (
    <button
      data-reorder-ignore="true"
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      aria-label={label || (checked ? 'Mark as planned' : 'Mark as eaten')}
      style={{
        width: 24, height: 24, flexShrink: 0, borderRadius: 4, padding: 0,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
        border: `1.5px solid var(--accent)`,
        background: checked ? 'var(--accent)' : 'transparent',
        color: checked ? 'var(--accent-ink)' : 'transparent',
        textShadow: checked ? 'none' : 'var(--text-lift)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <i className="fa-solid fa-check" style={{ fontSize: 12 }} />
    </button>
  );
}

function FoodScreen({ store, setStore, go, userId, date }) {
  const [confirmEl, confirm] = useConfirm();
  const today = LB.todayISO();
  const [curDate, setCurDate] = useStateFd(date || today);
  useEffectFd(() => setCurDate(date || today), [date]);

  // store.foodLogs only carries FOOD_HISTORY_WINDOW_DAYS from boot; scrolling
  // further back needs a lazy fetch (mirrors fetchSessionEntries for old
  // session details), so history stays browsable without limit instead of
  // silently looking empty. loadedOldDates avoids re-fetching a date already
  // checked this session, whether or not it actually had entries.
  const foodHistCutoff = useMemoFd(() => LB.historyWindowCutoffISO(new Date(), LB.FOOD_HISTORY_WINDOW_DAYS), []);
  const [loadedOldDates, setLoadedOldDates] = useStateFd(() => new Set());
  useEffectFd(() => {
    if (curDate >= foodHistCutoff || loadedOldDates.has(curDate)) return;
    let on = true;
    LB.fetchFoodLogsForDates(userId, [curDate]).then(byDate => {
      if (!on) return;
      setLoadedOldDates(prev => new Set(prev).add(curDate));
      const entries = byDate[curDate];
      if (!entries || !entries.length) return;
      // Merge fetched (authoritative) entries with any not-yet-synced local
      // entry for the same date, e.g. the user logged something for this old
      // date while the fetch was in flight: fetched wins on id collision,
      // anything local-only survives alongside it, nothing is dropped either way.
      setStore(s => {
        const list = s.foodLogs || [];
        const localForDate = list.filter(l => l.date === curDate);
        const fetchedIds = new Set(entries.map(e => e.id));
        const extraLocal = localForDate.filter(l => !fetchedIds.has(l.id));
        return { ...s, foodLogs: [...list.filter(l => l.date !== curDate), ...entries, ...extraLocal] };
      });
    }).catch(() => {});
    return () => { on = false; };
  }, [curDate, foodHistCutoff, userId]);

  // Coach-assigned macros, same source and priority HealthScreen uses (coach
  // macros win over personal targets when both exist, see effectiveMacroTargets):
  // lets the Log-tab hero show progress against the real target instead of a
  // bare total when the user (or their coach) has one set.
  const [coachingMacros, setCoachingMacros] = useStateFd(null);
  const coachingId = store.coaching?.asClient?.id || store.coaching?.asSelf?.id || null;
  useEffectFd(() => {
    if (!coachingId) { setCoachingMacros(null); return; }
    let cancelled = false;
    LB.loadCoachingMacros(coachingId).then(data => { if (!cancelled) setCoachingMacros(data[0] || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [coachingId]);

  // One-time repair for favorites created before toggleFavorite cached their
  // food_id (see there): those never got a matching zane_foods row, so their
  // sync has been failing its FK check on every retry ever since. Re-cache on
  // every open, a harmless no-op for foods that are already cached. Skips
  // foodIds that already appear in store.foodLogs (already logged means
  // already cached, same reasoning as the fromCache flag above) and dedupes
  // by foodId, so a food favorited more than once only fires one request.
  // A favorite the user simply hasn't logged/quick-added yet is a normal
  // steady state, not a legacy-data case, so once a foodId is successfully
  // cached it's remembered in localStorage (logbook-food-fav-cache-repaired,
  // a JSON array of foodIds): without that, this effect would keep re-firing
  // one network request per such favorite on every single mount of this
  // screen (i.e. every tab switch) forever, not just once.
  useEffectFd(() => {
    const loggedFoodIds = new Set((store.foodLogs || []).map(l => l.foodId).filter(Boolean));
    let repaired;
    try { repaired = new Set(JSON.parse(localStorage.getItem('logbook-food-fav-cache-repaired') || '[]')); }
    catch (_) { repaired = new Set(); }
    const requested = new Set();
    const toRequest = [];
    (store.foodFavorites || []).forEach(f => {
      if (f.foodId && f.source && f.source !== 'custom' && !loggedFoodIds.has(f.foodId) && !repaired.has(f.foodId) && !requested.has(f.foodId)) {
        requested.add(f.foodId);
        toRequest.push(f);
      }
    });
    if (!toRequest.length) return;
    // Give up for the rest of the day once a repair round fails. Nothing is
    // marked repaired on failure, so an outage (or the daily API quota, where
    // every attempt is itself a quota hit) had this retrying the same failing
    // batch on every single mount of this screen.
    const ATTEMPT_KEY = 'logbook-food-fav-cache-attempt';
    const todayStr = LB.todayISO();
    try { if (localStorage.getItem(ATTEMPT_KEY) === todayStr) return; } catch (_) {}
    Promise.all(toRequest.map(f => LB.cacheFood(f.source, f.foodId.slice(f.source.length + 1)).then(res => ({ foodId: f.foodId, ok: !!(res && res.ok) })))).then(results => {
      let changed = false;
      results.forEach(r => { if (r.ok) { repaired.add(r.foodId); changed = true; } });
      if (changed) { try { localStorage.setItem('logbook-food-fav-cache-repaired', JSON.stringify([...repaired])); } catch (_) {} }
      if (results.some(r => !r.ok)) { try { localStorage.setItem(ATTEMPT_KEY, todayStr); } catch (_) {} }
    });
  }, []);

  // Plan Mode meal templates: on opening today, auto-materialize each matching
  // template slot (by day-type: any / training / rest) as a planned entry at
  // its fixed hour, unless the day already has one from that slot. Runs once
  // per day, tracked CROSS-DEVICE by a synced marker row (store.foodTemplateDays,
  // id `<userId>_<date>`), so deleting an auto-planned entry never makes it
  // reappear on reopen, on any device. Only for TODAY: a backdated day is never
  // auto-filled. The manual "Apply to today" button (FoodTemplateScreen) is the
  // escape hatch to pull the fixums back after clearing the day on purpose.
  useEffectFd(() => {
    if (!planMode || curDate !== today) return;
    // Only the ACTIVE meal plan's slots auto-fill the day.
    const activePlanId = store.activeMealTemplateId;
    const slots = (store.foodTemplateSlots || []).filter(s => s.mealPlanId === activePlanId);
    if (!activePlanId || !slots.length) return;
    const markerId = `${userId}_${today}`;
    if ((store.foodTemplateDays || []).some(d => d.id === markerId)) return;
    const existingSlotIds = new Set((store.foodLogs || []).filter(l => l.date === today && l.templateSlotId).map(l => l.templateSlotId));
    const toAdd = slots
      .filter(s => fdSlotMatchesDate(s, store, today) && !existingSlotIds.has(s.id))
      .map(s => fdMaterializeSlotEntry(s, today));
    setStore(s => {
      // Re-check inside the updater against a double-run race (marker may have
      // landed between read and commit).
      if ((s.foodTemplateDays || []).some(d => d.id === markerId)) return s;
      return {
        ...s,
        foodTemplateDays: [...(s.foodTemplateDays || []), { id: markerId, date: today }],
        // Planned entries never touch the daily log, so no patchDaily here.
        foodLogs: toAdd.length ? [...toAdd, ...(s.foodLogs || [])] : (s.foodLogs || []),
      };
    });
  }, [planMode, curDate, today, userId, store.foodTemplateSlots, store.foodTemplateDays, store.activeMealTemplateId]);

  const [tab, setTab] = useStateFd('log');
  // Day-level sugar/sat fat/sodium disclosure (migration 0204), per session.
  const [extrasOpen, setExtrasOpen] = useStateFd(false);
  // { name } while the meal-of-choice sheet is open, null otherwise.
  const [mocSheet, setMocSheet] = useStateFd(null);
  const [dayMenu, setDayMenu] = useStateFd(false);
  const [statsOpen, setStatsOpen] = useStateFd(false);
  const [quickTab, setQuickTab] = useStateFd('recent');
  // Shared across Recent/Favorites/Recipes since only one shows at a time;
  // cleared on switching sub-tabs so a filter typed in one never silently
  // hides everything in the next.
  const [quickQuery, setQuickQuery] = useStateFd('');
  function onQuickTabChange(id) { setQuickTab(id); setQuickQuery(''); }
  // Hour (0-23) a timeline "+" was tapped for, so the next logged entry lands
  // at that hour instead of now. Cleared once the staged batch that used it
  // actually commits (see commitEntries), or when the user leaves the
  // timeline by tapping a main tab directly.
  const [pendingHour, setPendingHour] = useStateFd(null);
  // Foods picked (quantity already chosen) but not yet written to the log:
  // tapping a search result / favorite / recent item, or submitting the
  // Custom Item form, stages an entry here instead of committing it right
  // away, so several can be picked in one sitting before "Add N items"
  // commits the whole batch in one store update. Each entry already carries
  // its own baked-in date/time (from entryTime() at stage time), so it stays
  // correct even if curDate or pendingHour changes mid-batch.
  const [staged, setStaged] = useStateFd([]);
  // The picked-items panel (stagedPanel below) starts collapsed to a one-line
  // summary + totals each time a fresh batch begins, expand shows the actual
  // list. Auto-collapses again once staged empties out (committed or
  // cleared), so the next pick starts collapsed too rather than remembering
  // the last expand state.
  const [pickedExpanded, setPickedExpanded] = useStateFd(false);
  useEffectFd(() => { if (!staged.length) setPickedExpanded(false); }, [staged.length]);
  // Which timeline entries (by id) currently show their expanded ingredient
  // list, for a source:'recipe' entry's chevron. Per-device UI state only,
  // not persisted.
  const [expandedEntryIds, setExpandedEntryIds] = useStateFd(() => new Set());
  function toggleEntryExpanded(id) {
    setExpandedEntryIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const [sourceFilter, setSourceFilter] = useStateFd(null); // null = all
  const [query, setQuery] = useStateFd('');
  const [searching, setSearching] = useStateFd(false);
  const [searchError, setSearchError] = useStateFd(null);
  const [results, setResults] = useStateFd(null); // null = no search run yet
  const [scanOpen, setScanOpen] = useStateFd(false);
  // "Barcode or label?" picker opened by the search box's scan button; routes
  // to whichever capture flow the user picks.
  const [scanPickerOpen, setScanPickerOpen] = useStateFd(false);
  const [labelScanning, setLabelScanning] = useStateFd(false);
  const [labelError, setLabelError] = useStateFd(null);
  // The barcode whose lookup came back empty, so the results block can offer
  // the label scan as the way out. Null whenever the last search was a normal
  // text search or did find something.
  const [barcodeMiss, setBarcodeMiss] = useStateFd(null);
  const labelInputRef = useRefFd(null);
  // Which AI reads the nutrition label photo: 'grok' (scan-label, the
  // long-standing default) or 'claude' (scan-label-claude), same request/
  // response contract either way. Per-device only, not a synced setting:
  // this is a comparison toggle, not a user-facing preference.
  const [labelScannerProvider, setLabelScannerProvider] = useStateFd(fdReadScannerProvider);
  useEffectFd(() => {
    const onChange = e => setLabelScannerProvider(e.detail);
    window.addEventListener('zane-scanner-provider', onChange);
    return () => window.removeEventListener('zane-scanner-provider', onChange);
  }, []);

  // "Describe a meal" sheet: free-text -> parse-meal edge function -> a
  // review list (mealItems) the user picks through before anything is
  // staged. null = no batch pending (also closes the review sheet, see its
  // `open` prop below); an empty array can't linger, removing the last item
  // nulls it out the same way.
  const [mealDescribeOpen, setMealDescribeOpen] = useStateFd(false);
  const [mealDescription, setMealDescription] = useStateFd('');
  const [mealParsing, setMealParsing] = useStateFd(false);
  const [mealParseError, setMealParseError] = useStateFd(null);
  const [mealItems, setMealItems] = useStateFd(null);
  // tempId of the mealItems row currently open in the quantity sheet, or null
  // for every other reason that sheet opens (fresh add / re-editing an
  // already-logged entry). Lets confirmLogFood route "Save" back into this
  // list instead of staging/closing.
  const [editingMealItemId, setEditingMealItemId] = useStateFd(null);

  const [qtySheetOpen, setQtySheetOpen] = useStateFd(false);
  const [pendingFood, setPendingFood] = useStateFd(null);
  // Set while the quantity sheet is editing an ALREADY-LOGGED timeline entry
  // in place (openEditEntry) rather than picking a new one to stage: holds
  // the original entry so confirmLogFood can update it by id and preserve
  // its own date/time (its own commit path skips the staging entirely, an
  // in-place edit isn't a new item to batch). null the rest of the time.
  const [editingEntry, setEditingEntry] = useStateFd(null);
  const [qtyG, setQtyG] = useStateFd(''); // always grams, the actual source of truth for qtyPreview/buildQtyEntry
  // Amount field mode when pendingFood.units has entries: null means the
  // field is grams (qtyG itself, typed directly); otherwise it's an index
  // into pendingFood.units and the field is a COUNT of that unit
  // (qtyCountStr), with qtyG derived from it (count * unit.grams) by
  // onQtyCountChange/selectQtyUnit below rather than typed directly.
  const [qtyUnitIdx, setQtyUnitIdx] = useStateFd(null);
  const [qtyCountStr, setQtyCountStr] = useStateFd('');
  // Plan Mode, edit path only: whether the entry being edited (editingEntry)
  // is planned or logged, so the quantity sheet's planned/logged switch can
  // change it as part of the same save. Irrelevant for a fresh pick, whose
  // status comes straight from the Log it / Plan it button tapped.
  const [qtyEditPlanned, setQtyEditPlanned] = useStateFd(false);
  // id of the favorite created from the currently-open sheet, so the star
  // button can toggle it live (add on tap, remove on second tap) instead of
  // deferring the save to when the food is actually logged.
  const [favedId, setFavedId] = useStateFd(null);
  // Editable per-100g protein/carbs/fat for a scanned custom item, so the user
  // can correct a misread before logging. Kept as strings (decimals allowed);
  // only used on the pendingFood.custom path. kcal100Str is the per-100g
  // calorie figure alongside them: auto-derived from p100/c100/f100Str
  // (see the effect below) unless kcal100Touched, in which case a direct
  // edit to it wins and stops following further macro edits.
  const [p100Str, setP100Str] = useStateFd('');
  const [c100Str, setC100Str] = useStateFd('');
  const [f100Str, setF100Str] = useStateFd('');
  // Clearing the field back to empty un-overrides it (touched=false) rather
  // than leaving it stuck empty forever: the hook's effect then recomputes
  // it from the current macros on the very next render, same as if the
  // field had never been touched. Only derives while pendingFood.custom.
  const [kcal100Str, setKcal100Str, onKcal100Change, kcal100Touched, setKcal100Touched] =
    useAutoDerivedCalories(p100Str, c100Str, f100Str, pendingFood?.fiberPer100g, !!store.settings?.netCarbs, !!pendingFood?.custom);

  const [customOpen, setCustomOpen] = useStateFd(false);
  const [customName, setCustomName] = useStateFd('');
  const [customG, setCustomG] = useStateFd('');
  const [customP, setCustomP] = useStateFd('');
  const [customC, setCustomC] = useStateFd('');
  const [customF, setCustomF] = useStateFd('');
  const [customFib, setCustomFib] = useStateFd('');
  // Migration 0204 extras, all optional and collapsed behind fdExtrasOpen: they
  // never enter the calorie math, so an empty field means 'unknown', not zero.
  const [customSugar, setCustomSugar] = useStateFd('');
  const [customSatFat, setCustomSatFat] = useStateFd('');
  const [customSodium, setCustomSodium] = useStateFd('');
  const [customExtrasOpen, setCustomExtrasOpen] = useStateFd(false);
  // Calories, same "derive from macros unless overridden" rule as
  // kcal100Str above: auto-follows protein/carbs/fat (matching how the
  // rest of the app derives calories, e.g. MacroTargetSheet) until the
  // user types into the field directly, at which point their number wins
  // and stops following further macro edits. Net-carb accounting matches
  // the daily-log convention: fiber is subtracted only when
  // settings.netCarbs is on.
  const [customCal, setCustomCal, onCustomCalChange, customCalTouched, setCustomCalTouched] =
    useAutoDerivedCalories(customP, customC, customF, fdNum(customFib), !!store.settings?.netCarbs);

  // Recipe editor: a dedicated full-page screen (RecipeEditorScreen below),
  // not an in-place mode. recipeEditorRecipe is the recipe being edited
  // (null while creating a new one); recipeEditorOpen just controls
  // whether the screen is mounted. handleRecipeSave/handleRecipeDiscard
  // (below) are what RecipeEditorScreen's onSave/onClose actually call.
  const [recipeEditorOpen, setRecipeEditorOpen] = useStateFd(false);
  const [recipeEditorRecipe, setRecipeEditorRecipe] = useStateFd(null);
  // "Which recipe do I want a copy of" picker, opened from the header's copy
  // icon (see duplicateRecipe below).
  const [duplicatePickerOpen, setDuplicatePickerOpen] = useStateFd(false);
  // Prompt shown before a recipe actually gets logged (see addRecipeToLog):
  // always a portions stepper (half-portion steps), even for a recipe with
  // just one portion, e.g. "1 cake" doesn't mean the only choice is the
  // whole cake. chosenPortions defaults to 1 regardless of how many the
  // recipe actually has, not "all of them": logging the whole batch by
  // default would be the more surprising default of the two. mode/gramsStr
  // only matter when recipe.cookedWeightG is set (see fdEffectiveChosenPortions).
  const [recipeLogPrompt, setRecipeLogPrompt] = useStateFd(null); // { recipe, mode, chosenPortions, totalPortions, gramsStr, fromCookingMode? } | null
  // Cooking Mode (CookingModeScreen, see startCookingMode below): { recipe,
  // draft } while open, null while closed. recipeLogPrompt is deliberately
  // left set (not cleared) while this is open, so Part D's handoff back into
  // it has nothing to re-open, just new values to show, no flash.
  const [cookingMode, setCookingMode] = useStateFd(null);

  // Copy/move entries from the viewed day onto another one, at their
  // original time-of-day. copyMoveIds are foodLogs ids picked from
  // dayEntries (below); copyMoveMode decides whether the originals stay put
  // (copy) or get removed from curDate (move) once submitted.
  // "Repeat yesterday": which meal is being carried over and which of its
  // entries are still ticked. Everything starts ticked, because carrying the
  // whole meal over is the normal case and unticking the one thing that
  // changed beats picking the three that didn't.
  const [repeat, setRepeat] = useStateFd(null); // { catId, label, ids }
  const [copyMoveOpen, setCopyMoveOpen] = useStateFd(false);
  const [copyMoveIds, setCopyMoveIds] = useStateFd([]);
  const [copyMoveTarget, setCopyMoveTarget] = useStateFd('');
  const [copyMoveMode, setCopyMoveMode] = useStateFd('copy'); // 'copy' | 'move'

  // Editing a favorite's optional units (e.g. "Pc" = 62g, "Pack" = 500g),
  // so relogging it can jump straight to a count of one of them instead of
  // typing grams (see the unit picker in the quantity sheet). editUnits is
  // a working copy of the favorite's units array; editUnitNewLabel/Grams
  // are the (not yet added) next-unit fields.
  const [editFavId, setEditFavId] = useStateFd(null);
  const [editUnits, setEditUnits] = useStateFd([]);
  const [editUnitNewLabel, setEditUnitNewLabel] = useStateFd('');
  const [editUnitNewGrams, setEditUnitNewGrams] = useStateFd('');

  const dayLabel = curDate === today ? 'Today' : curDate === fdShiftDate(today, -1) ? 'Yesterday' : curDate === fdShiftDate(today, 1) ? 'Tomorrow' : LB.fmtDayLabel(curDate);
  // A day that hasn't happened yet can't have anything "already eaten" on it:
  // Log it is unavailable and an edited entry can't be flipped back to logged.
  const curDateIsFuture = curDate > today;

  // Plan Mode (settings.planMode, off by default): entries carry a `planned`
  // flag. A planned entry sits in the timeline but does NOT count toward the
  // day's real macro totals (or the daily log / coaching) until it's checked
  // off (planned -> logged). With plan mode off nothing here changes: no entry
  // is ever planned, so loggedEntries === dayEntries and every total below is
  // exactly what it was before.
  const planMode = !!store.settings?.planMode;
  // Keep the user's UTC offset fresh while in Plan Mode: the meal-reminder cron
  // places "now" on the local clock via tzOffsetMinutes, and a Plan Mode user
  // may never open the Water tab (the other writer of this value). Only writes
  // when it actually changed (travel / DST). Same one-liner as WaterScreen.
  useEffectFd(() => {
    if (!planMode) return;
    const off = -new Date().getTimezoneOffset();
    if (store.settings?.tzOffsetMinutes !== off) setStore(s => ({ ...s, settings: { ...s.settings, tzOffsetMinutes: off } }));
  }, [planMode]); // eslint-disable-line
  // Meal-template manager overlay (FoodTemplateScreen), only reachable in plan
  // mode. Controls the recurring fixum slots that auto-fill each day's plan.
  const [templateOpen, setTemplateOpen] = useStateFd(false);
  // Shopping list overlay. Unlike templateOpen this is NOT plan-mode gated:
  // its historical-frequency half is useful with Plan Mode off, the
  // template-projection half just contributes nothing without an active plan.
  const [shoppingOpen, setShoppingOpen] = useStateFd(false);
  // Timeline entry whose overflow (kebab) action menu is open, or null. The
  // per-row secondary actions (edit, ingredients, delete) live in this one
  // menu instead of a cluster of inline buttons, to save width on mobile.
  const [entryMenu, setEntryMenu] = useStateFd(null);
  // "Split into multiple meals": an hour that stacks several items really
  // eaten at different times (a meal-prep batch), redistributed across N
  // times without retyping every item's amount. splitHour is the hour being
  // split (null = sheet closed); splitHours holds the target hour for each
  // additional meal (length splitCount-1, meal 1 stays at splitHour);
  // splitQtys maps entry id -> per-meal DISPLAY-value STRING array (length
  // splitCount, same input-as-you-type convention as every other quantity
  // field here). The display value is a unit count (e.g. "Pc") whenever the
  // matching favorite defines one (splitEntryUnit), since that's exactly why
  // a unit gets defined, so the user never has to do the gram math by hand;
  // otherwise grams, or kcal for an entry with no gram weight at all. The
  // underlying scaling (splitOrigAmount/fdScaleEntry) always works in grams/
  // kcal, splitDisplayFromAmount/splitAmountFromDisplay convert at the edges.
  const [splitHour, setSplitHour] = useStateFd(null);
  const [splitCount, setSplitCount] = useStateFd(2);
  const [splitHours, setSplitHours] = useStateFd([]);
  const [splitQtys, setSplitQtys] = useStateFd({});
  // Snapshot of the split as it opened, to detect unsaved edits on backdrop-
  // close (same pattern as the meal-slot draft's requestCloseDraft).
  const splitInitialSnap = useRefFd(null);
  // Toast for the last APPLIED split (not the sheet draft above): just enough
  // to look the batch back up (batchId) and label the toast (count). The
  // actual undo data (the exact pre-split entries) lives on the entries
  // themselves now (split_batch, see undoSplitBatch), not in this local
  // state, so the toast is only a convenience shortcut, not the only way to
  // reach undo, see splitBatchAt/the Undo Split block in the sheet below for
  // the persistent path. Auto-clears after a few seconds (splitUndoTimer); a
  // second split before that just replaces it, same as any other toast.
  const [splitUndo, setSplitUndo] = useStateFd(null);
  const splitUndoTimer = useRefFd(null);
  useEffectFd(() => () => clearTimeout(splitUndoTimer.current), []);
  // "Create recipe from block": the mirror of Split, folding a stacked
  // hour's 2+ items into ONE recipe-shaped entry instead of fanning one
  // entry out. recipeBlockHour is the hour being combined (null = sheet
  // closed). recipeBlockSave defaults OFF: off replaces the block with a
  // single log entry only ("temporary", no zane_food_recipes row, nothing
  // to reuse later); on ALSO saves it as a real recipe under Quick Add,
  // Recipes, same as building one in the recipe editor. Undo reuses the
  // exact same split_batch/restoreSplitBatch machinery as Split (see there),
  // tagged kind:'merge' instead of 'split'.
  const [recipeBlockHour, setRecipeBlockHour] = useStateFd(null);
  const [recipeBlockName, setRecipeBlockName] = useStateFd('');
  const [recipeBlockSave, setRecipeBlockSave] = useStateFd(false);
  const recipeBlockInitialSnap = useRefFd(null);
  function splitEntryUnit(e) {
    if (!(e.quantityG > 0)) return null;
    // Trust loggedUnit alone, no favorite-guess fallback: a row logged
    // straight in grams (loggedUnit null) is indistinguishable in the DB from
    // an old entry logged before this column existed, so guessing via a
    // matching favorite's units would wrongly relabel an intentional gram
    // entry as a unit count too (the bug this replaced).
    return e.loggedUnit || null;
  }
  const splitUnit = (e) => splitEntryUnit(e)?.label || ((e.quantityG != null && e.quantityG > 0) ? 'g' : 'kcal');
  const splitOrigAmount = (e) => (e.quantityG != null && e.quantityG > 0) ? e.quantityG : (e.calories || 0);
  const splitDisplayFromAmount = (e, amt) => { const u = splitEntryUnit(e); return u ? amt / u.grams : amt; };
  const splitAmountFromDisplay = (e, display) => { const u = splitEntryUnit(e); return u ? display * u.grams : display; };
  const splitDisplayStr = (e, amt) => String(Math.round(splitDisplayFromAmount(e, amt) * 100) / 100);
  // Opens with a fresh even-split draft when there's actually something to
  // split (2+ items); also opens, draft-less, when the hour holds nothing
  // but the result of an earlier split (splitBatchAt), purely so that
  // result has a way back to "Undo Split" (see the sheet below). Neither
  // applies (a single item that was never split) -> no-op, same as before.
  function openSplit(h) {
    const entries = byHour[h] || [];
    const batch = splitBatchAt(h);
    if (entries.length < 2 && !batch) return;
    setSplitHour(h);
    if (entries.length >= 2) {
      const qtys = {};
      entries.forEach(e => { qtys[e.id] = fdEvenSplit(splitOrigAmount(e), 2).map(v => splitDisplayStr(e, v)); });
      const nextHours = [fdNextFreeHour(Math.min(23, h + 4), byHour, [h])];
      splitInitialSnap.current = JSON.stringify({ count: 2, hours: nextHours, qtys });
      setSplitCount(2);
      setSplitHours(nextHours);
      setSplitQtys(qtys);
    } else {
      // Undo-only open: no draft to speak of, so the snapshot matches the
      // untouched defaults and backdrop-close never has anything to warn
      // about here (see requestCloseSplit's dirty check).
      splitInitialSnap.current = JSON.stringify({ count: 2, hours: [], qtys: {} });
      setSplitCount(2);
      setSplitHours([]);
      setSplitQtys({});
    }
  }
  // Backdrop tap used to drop the whole split configuration (meal count,
  // hours, every hand-adjusted amount) silently.
  async function requestCloseSplit() {
    if (splitHour != null) {
      const cur = JSON.stringify({ count: splitCount, hours: splitHours, qtys: splitQtys });
      if (cur !== splitInitialSnap.current && !await confirm("Your split changes won't be applied.", { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    }
    setSplitHour(null);
  }
  // Changing the meal count keeps meal 1 at splitHour, grows/shrinks the
  // target-hour list (new hours default +4h from the previous one), and
  // re-evens every item's split (any per-item hand-edits are reset, simplest
  // to reason about rather than guessing how to redistribute a partial edit).
  function setSplitCountTo(n) {
    n = Math.max(2, Math.min(6, Math.round(n)));
    const entries = byHour[splitHour] || [];
    setSplitCount(n);
    setSplitHours(prev => {
      const next = prev.slice(0, n - 1);
      while (next.length < n - 1) {
        const base = next[next.length - 1] ?? splitHour;
        next.push(fdNextFreeHour(Math.min(23, base + 4), byHour, [splitHour, ...next]));
      }
      return next;
    });
    setSplitQtys(prev => {
      const out = {};
      for (const id in prev) {
        const e = entries.find(x => x.id === id);
        if (!e) { out[id] = prev[id]; continue; }
        const totalAmt = prev[id].reduce((a, b) => a + splitAmountFromDisplay(e, fdNum(b) || 0), 0);
        out[id] = fdEvenSplit(totalAmt, n).map(v => splitDisplayStr(e, v));
      }
      return out;
    });
  }
  // Typing into one meal's amount fixes that value (clamped to the item's
  // total, an eaten wrap can't reappear in a later meal) and evenly
  // redistributes whatever's left across the other meals for that same
  // item, so the fields always stay aware of both the total and each other
  // instead of needing to be reconciled by hand.
  function updateSplitQty(entryId, idx, raw) {
    const filtered = fdDecimalFilter(raw);
    setSplitQtys(prev => {
      const arr = [...(prev[entryId] || [])];
      const n = arr.length;
      const entries = byHour[splitHour] || [];
      const e = entries.find(x => x.id === entryId);
      if (!e || n < 2) { arr[idx] = filtered; return { ...prev, [entryId]: arr }; }
      const total = splitDisplayFromAmount(e, splitOrigAmount(e));
      const typed = fdNum(filtered) || 0;
      const clamped = Math.max(0, Math.min(total, typed));
      arr[idx] = clamped === typed ? filtered : String(Math.round(clamped * 100) / 100);
      const remaining = Math.round((total - clamped) * 100) / 100;
      const others = arr.map((_, i) => i).filter(i => i !== idx);
      const parts = fdEvenSplitFloat(remaining, others.length);
      others.forEach((i, k) => { arr[i] = String(parts[k]); });
      return { ...prev, [entryId]: arr };
    });
  }
  function applySplit() {
    if (splitHour == null) return;
    const entries = byHour[splitHour] || [];
    const hours = [splitHour, ...splitHours];
    const now = new Date().toISOString();
    // Every entry the split creates carries the SAME batch: {id, kind, the
    // exact pre-split entries}, redundantly, so undoSplitBatch can restore
    // from whichever one still exists later (see split_batch's own doc
    // comment in docs/database.md). `entries` here are the exact original
    // objects (not recomputed), so restoring them is a straight put-back.
    // kind labels which direction this batch went (this is 1 hour's items
    // fanned out to N; applyBlockRecipe's is the mirror, N items folded into
    // 1), purely so the shared Undo UI can word itself correctly.
    const batch = { id: LB.uid(), kind: 'split', removedEntries: entries };
    const toAdd = [];
    const removeIds = new Set();
    entries.forEach(e => {
      const origAmt = splitOrigAmount(e);
      // splitQtys holds display values (unit count, grams, or kcal per
      // splitUnit); convert back to the grams/kcal basis fdScaleEntry works in.
      const amts = (splitQtys[e.id] || []).map(v => splitAmountFromDisplay(e, fdNum(v) || 0));
      hours.forEach((h, i) => {
        const amt = amts[i] || 0;
        if (amt <= 0) return;
        toAdd.push({ ...e, ...fdScaleEntry(e, origAmt > 0 ? amt / origAmt : 0), id: LB.uid(), time: `${String(h).padStart(2, '0')}:00`, createdAt: now, splitBatch: batch });
      });
      removeIds.add(e.id);
    });
    if (!toAdd.length) return;
    setStore(s => {
      const nextLogs = [...toAdd, ...(s.foodLogs || []).filter(l => !removeIds.has(l.id))];
      const dailyLogs = patchDaily(s, curDate, nextLogs.filter(l => l.date === curDate));
      return { ...s, foodLogs: nextLogs, dailyLogs };
    });
    clearTimeout(splitUndoTimer.current);
    setSplitUndo({ batchId: batch.id, count: hours.length, kind: 'split' });
    splitUndoTimer.current = setTimeout(() => setSplitUndo(null), 6000);
    setSplitHour(null);
  }
  // The split_batch of the first entry at hour h that has one, or null, so
  // the timeline button and the sheet can offer an Undo block for an hour
  // that's the result of an earlier split OR combine (see openSplit/the
  // Undo block in the sheet, applyBlockRecipe for the other direction).
  function splitBatchAt(h) {
    return (byHour[h] || []).find(e => e.splitBatch)?.splitBatch || null;
  }
  // Core restore, no confirmation: drops every CURRENT entry carrying this
  // batch id (wherever they've since ended up, in case one was moved to
  // another day) and restores the exact pre-split entries from whichever
  // surviving sibling still carries them. No attempt to merge in a later
  // edit, undo always means "back to before the split". No-op if nothing
  // with this batch id remains (every entry from it was itself edited/
  // deleted since, taking the restore data down with the last one).
  function restoreSplitBatch(batchId) {
    setStore(s => {
      const logs = s.foodLogs || [];
      const batchEntries = logs.filter(l => l.splitBatch?.id === batchId);
      if (!batchEntries.length) return s;
      const removedEntries = batchEntries[0].splitBatch.removedEntries;
      const touchedDates = new Set([...batchEntries.map(l => l.date), ...removedEntries.map(l => l.date)]);
      const nextLogs = [...removedEntries, ...logs.filter(l => l.splitBatch?.id !== batchId)];
      let dailyLogs = s.dailyLogs || [];
      touchedDates.forEach(d => { dailyLogs = patchDaily({ ...s, dailyLogs }, d, nextLogs.filter(l => l.date === d)); });
      return { ...s, foodLogs: nextLogs, dailyLogs };
    });
  }
  // Toast's one-tap Undo: no confirmation, same "just applied it, reverse
  // immediately" convention every other toast in this app follows.
  function undoSplit() {
    if (!splitUndo) return;
    clearTimeout(splitUndoTimer.current);
    restoreSplitBatch(splitUndo.batchId);
    setSplitUndo(null);
  }
  // Reopening the split sheet on an old result and tapping Undo can be long
  // after the fact and much less obviously reversible than the toast, so
  // this confirms first. kind is passed in by the caller (it already knows
  // which one it's showing), not re-derived here.
  async function undoSplitBatch(batchId, kind) {
    const isMerge = kind === 'merge';
    const ok = await confirm(
      isMerge ? 'This deletes the combined recipe entry and restores the original entries as they were before.' : 'This deletes the split and restores the original entry as it was before.',
      { title: isMerge ? 'Undo combine?' : 'Undo split?', ok: 'Undo', cancel: 'Cancel', danger: true }
    );
    if (!ok) return;
    restoreSplitBatch(batchId);
    if (splitUndo?.batchId === batchId) { clearTimeout(splitUndoTimer.current); setSplitUndo(null); }
    setSplitHour(null);
  }
  function openBlockRecipe(h) {
    const entries = byHour[h] || [];
    if (entries.length < 2) return;
    setRecipeBlockHour(h);
    setRecipeBlockName('');
    setRecipeBlockSave(false);
    recipeBlockInitialSnap.current = JSON.stringify({ name: '', save: false });
  }
  // Backdrop tap used to drop the whole block-recipe draft (name, save
  // toggle) silently, same pattern as requestCloseSplit.
  async function requestCloseBlockRecipe() {
    if (recipeBlockHour != null) {
      const cur = JSON.stringify({ name: recipeBlockName, save: recipeBlockSave });
      if (cur !== recipeBlockInitialSnap.current && !await confirm("Your recipe won't be created.", { title: 'Discard?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    }
    setRecipeBlockHour(null);
  }
  // Folds the block's items into one recipe-shaped log entry (source:
  // 'recipe', recipeItems built straight from them at their current
  // amounts, no rescaling since this IS the batch, not a portion of one).
  // recipeBlockSave additionally saves the same items as a real
  // zane_food_recipes row (with foodId/brand/source, unlike recipeItems'
  // own leaner shape) so it can be reused later like any other recipe;
  // off, it's just this one entry. Tags the new entry with a split_batch
  // (kind:'merge') the same way applySplit does, so the shared Undo
  // machinery works for this direction too.
  function applyBlockRecipe() {
    if (recipeBlockHour == null) return;
    const entries = byHour[recipeBlockHour] || [];
    const name = recipeBlockName.trim();
    if (entries.length < 2 || !name) return;
    const sum = k => entries.reduce((a, e) => a + (e[k] || 0), 0);
    const hasFiber = entries.some(e => e.fiber != null);
    const now = new Date().toISOString();
    const recipeId = recipeBlockSave ? LB.uid() : null;
    const recipeItems = entries.map(e => ({
      foodId: e.foodId ?? null, brand: e.brand ?? null,
      foodName: e.foodName, quantityG: e.quantityG ?? null, calories: e.calories,
      protein: e.protein, carbs: e.carbs, fat: e.fat, fiber: e.fiber ?? null,
      sugar: e.sugar ?? null, satFat: e.satFat ?? null, sodiumMg: e.sodiumMg ?? null,
    }));
    const merged = {
      id: LB.uid(), date: curDate, time: `${String(recipeBlockHour).padStart(2, '0')}:00`,
      foodId: null, foodName: name, brand: null, source: 'recipe', recipeId,
      loggedTotalPortions: 1,
      quantityG: Math.round(sum('quantityG')), calories: Math.round(sum('calories')),
      protein: fdRound1(sum('protein')), carbs: fdRound1(sum('carbs')), fat: fdRound1(sum('fat')),
      fiber: hasFiber ? fdRound1(sum('fiber')) : null,
      sugar: entries.some(e => e.sugar != null) ? fdRound1(sum('sugar')) : null,
      satFat: entries.some(e => e.satFat != null) ? fdRound1(sum('satFat')) : null,
      sodiumMg: entries.some(e => e.sodiumMg != null) ? Math.round(sum('sodiumMg')) : null,
      recipeItems, loggedUnit: null,
      // A block mixing planned and logged items is an edge case; conservative
      // default (same bias warnIfOverwritingManualMacros uses elsewhere):
      // logged unless EVERY item was still only planned.
      planned: entries.every(e => e.planned), templateSlotId: null,
      createdAt: now,
      splitBatch: { id: LB.uid(), kind: 'merge', removedEntries: entries },
    };
    const removeIds = new Set(entries.map(e => e.id));
    setStore(s => {
      const nextLogs = [merged, ...(s.foodLogs || []).filter(l => !removeIds.has(l.id))];
      const dailyLogs = patchDaily(s, curDate, nextLogs.filter(l => l.date === curDate));
      const nextRecipes = recipeBlockSave
        ? [{
            id: recipeId, name,
            items: entries.map(e => ({
              id: LB.uid(),
              foodId: e.foodId ?? null, foodName: e.foodName, brand: e.brand ?? null, source: e.source ?? null,
              quantityG: e.quantityG ?? null, calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat,
              fiber: e.fiber ?? null, sugar: e.sugar ?? null, satFat: e.satFat ?? null, sodiumMg: e.sodiumMg ?? null,
            })),
            portions: 1, createdAt: now, updatedAt: now,
          }, ...(s.foodRecipes || [])]
        : s.foodRecipes;
      return { ...s, foodLogs: nextLogs, dailyLogs, foodRecipes: nextRecipes };
    });
    clearTimeout(splitUndoTimer.current);
    setSplitUndo({ batchId: merged.splitBatch.id, count: entries.length, kind: 'merge' });
    splitUndoTimer.current = setTimeout(() => setSplitUndo(null), 6000);
    setRecipeBlockHour(null);
  }
  const dayEntries = useMemoFd(
    () => (store.foodLogs || []).filter(l => l.date === curDate).sort((a, b) => b.time.localeCompare(a.time)),
    [store.foodLogs, curDate],
  );
  const loggedEntries = useMemoFd(() => dayEntries.filter(e => !e.planned), [dayEntries]);
  const plannedEntries = useMemoFd(() => dayEntries.filter(e => e.planned), [dayEntries]);
  // The truth of the day: only logged entries. This is what the hero shows as
  // the actual total, what drives adherence, and what patchDaily writes to the
  // daily log.
  const sumTotals = (entries) => ({
    calories: entries.reduce((a, e) => a + (e.calories || 0), 0),
    protein: entries.reduce((a, e) => a + (e.protein || 0), 0),
    carbs: entries.reduce((a, e) => a + (e.carbs || 0), 0),
    fat: entries.reduce((a, e) => a + (e.fat || 0), 0),
    // Migration 0204 extras. Summed only over the entries that actually carry
    // a value, and null when none of them does: a day mixing foods that report
    // sodium with foods that do not must read as a partial figure, never as a
    // confident total, and a day made entirely of pre-0204 entries must show
    // nothing at all instead of a row of zeros.
    ...fdSumExtras(entries),
  });
  const dayTotals = useMemoFd(() => sumTotals(loggedEntries), [loggedEntries]);
  const dayHasExtras = dayTotals.sugar != null || dayTotals.satFat != null || dayTotals.sodiumMg != null;
  // Planning aid: where the day is headed if every planned entry gets eaten
  // (logged + planned). Only shown when plan mode is on and the day actually
  // has planned entries, kept strictly separate from dayTotals above so the
  // real total is never inflated by something not yet eaten.
  const projectedTotals = useMemoFd(() => sumTotals(dayEntries), [dayEntries]);

  const dayLog = useMemoFd(
    () => (store.dailyLogs || []).find(l => l.date === curDate) || null,
    [store.dailyLogs, curDate]);
  // The calorie target for the currently-viewed day (curDate, which can be
  // backdated), same resolution HealthScreen uses: coach macros win over
  // personal ones, and training/rest day pick different targets. null when
  // nothing is set, in which case the hero just shows a bare total, no ring.
  const macroTargets = useMemoFd(() => LB.effectiveMacroTargets(store.settings?.macroTargets, coachingMacros), [store.settings?.macroTargets, coachingMacros]);
  const dayTarget = useMemoFd(() => {
    // A day already scored keeps the target it was scored against, the same
    // dayTargetOverride contract LB.dailyLogAdherence and the food
    // reconciler effect (screens-health.jsx) already use: without this,
    // scrolling back to an old day after a later macro change would show it
    // measured against TODAY's numbers here, while the Health tab's card for
    // that same day (which reads the frozen dailyLogs.adherence first)
    // correctly kept showing the historical one. Today and future days have
    // no snap yet, so they fall through to the live target as before.
    const snap = dayLog?.targetsSnap;
    const storedTarget = snap && (snap.protein != null || snap.carbs != null || snap.fat != null) ? snap : null;
    if (storedTarget) return storedTarget;
    const isTraining = LB.isTrainingDayForDate(store, curDate);
    return LB.dayTargetFromMacros(macroTargets, isTraining);
  }, [store, macroTargets, curDate, dayLog]);
  const goalCalories = dayTarget?.calories ?? (dayTarget ? LB.caloriesFromMacros(dayTarget.protein, dayTarget.carbs, dayTarget.fat) : null);
  // Same weighted-macro-distance formula HealthScreen's today card uses
  // (LB.macroAdherence), computed live off dayTotals rather than reading
  // dailyLogs.adherence directly: that stored field only gets reconciled by
  // an effect living in HealthScreen, which isn't mounted while viewing this
  // screen, so it would show a stale number right after logging something
  // here (dayTarget above already resolves to the correct historical target
  // once one is stored, this only keeps the TOTALS live). null (hidden) when
  // there's no macro target to score against. A meal-of-choice day is
  // deliberately unscored (see LB.dailyLogAdherence), and this is the one
  // adherence figure in the app that is recomputed live rather than read
  // from the store, so it needs the rule applied a second time or the Food
  // hero would show a percentage while the Health tab shows none for the
  // same day.
  const isMealOfChoice = !!dayLog?.mealOfChoice;
  const dayAdherence = useMemoFd(
    () => (dayTarget && !isMealOfChoice) ? LB.macroAdherence({ protein: dayTotals.protein, carbs: dayTotals.carbs, fat: dayTotals.fat }, dayTarget) : null,
    [dayTarget, dayTotals, isMealOfChoice],
  );
  // Same formula, but against the Plan+Logged projection instead of the
  // logged truth: "if you eat everything still planned today, where does
  // that leave your adherence". Shown in the projection table, never in the
  // hero ring itself, so the real (logged-only) adherence stays the one
  // number that drives the ring and the daily log.
  const projectedAdherence = useMemoFd(
    () => (dayTarget && !isMealOfChoice) ? LB.macroAdherence({ protein: projectedTotals.protein, carbs: projectedTotals.carbs, fat: projectedTotals.fat }, dayTarget) : null,
    [dayTarget, projectedTotals, isMealOfChoice],
  );
  // The budget the meal inherits. Computed against PROJECTED totals, not just
  // logged: a shake still planned for 21:00 is already spoken for, and not
  // subtracting it here would let it be spent twice. This is also why the
  // meal itself stays a derived row until it is confirmed. A real planned
  // entry would sit inside projectedTotals and make the sum circular.
  const mocRemainder = useMemoFd(
    () => LB.mealOfChoiceRemainder(dayTarget, projectedTotals),
    [dayTarget, projectedTotals]);
  // Deterministic id so two devices confirming the same meal collide into one
  // row instead of duplicating, the same reason foodTemplateDays' marker id is
  // `${userId}_${today}` (this file, above). id is the PRIMARY KEY on
  // zane_food_logs, a table shared by every user, so date alone is not
  // enough: two different users marking a meal of choice on the same
  // calendar day would otherwise both compute the exact same id and collide
  // with each other's row, not just their own past confirmation.
  const mocEntryId = `moc_${userId}_${curDate}`;
  const mocEntry = useMemoFd(
    () => (store.foodLogs || []).find(l => l.id === mocEntryId) || null,
    [store.foodLogs, mocEntryId]);
  const mocWeek = useMemoFd(
    () => LB.mealOfChoiceWeekCount(store.dailyLogs, curDate),
    [store.dailyLogs, curDate]);
  const mocName = LB.mealOfChoiceNoteName(dayLog?.offPlanNote);
  // Entries bucketed by the hour of their time, for the 0-23 timeline.
  const byHour = useMemoFd(() => {
    const m = {};
    for (const e of dayEntries) {
      const h = parseInt((e.time || '0:0').split(':')[0], 10) || 0;
      (m[h] = m[h] || []).push(e);
    }
    Object.values(m).forEach(arr => arr.sort((a, b) => (a.time || '').localeCompare(b.time || '')));
    return m;
  }, [dayEntries]);

  // Read-only per-category totals shown above each cluster of hours in the
  // timeline (see LB.mealCategories), summed straight off byHour's buckets.
  // Category summary cards reflect the logged truth only: a planned entry
  // shows in the timeline rows below (visually distinct) but must not inflate
  // its meal category's kcal, same reason dayTotals excludes planned.
  const mealCats = useMemoFd(() => LB.mealCategories(store.settings), [store.settings?.mealWindows]);
  // Where the derived meal-of-choice row sits in the timeline. Defaults to the
  // dinner window (that is what a meal of choice usually is), changed in the
  // sheet. Must stay BELOW mealCats: these are const, so reading mealCats from
  // above it is a temporal dead zone and throws on every render of this screen.
  const mocDefaultHour = (mealCats.find(c => c.id === 'dinner') || mealCats[mealCats.length - 1] || {}).startHour ?? 18;
  const mocHour = dayLog?.mealOfChoiceHour ?? mocDefaultHour;
  const categoryTotals = useMemoFd(() => mealCats.map(cat => {
    let calories = 0, protein = 0, carbs = 0, fat = 0;
    // The totals count logged entries only (a planned meal isn't eaten yet),
    // but `count` counts every entry including planned ones: it gates the
    // "Repeat yesterday" offer, and a slot that already holds planned meals is
    // not an empty slot, even though its totals still read zero.
    let count = 0;
    for (let h = cat.startHour; h < cat.endHour; h++) {
      for (const e of (byHour[h] || [])) {
        count++;
        if (e.planned) continue;
        calories += e.calories || 0; protein += e.protein || 0; carbs += e.carbs || 0; fat += e.fat || 0;
      }
    }
    return { ...cat, count, calories: Math.round(calories), protein: fdRound1(protein), carbs: fdRound1(carbs), fat: fdRound1(fat) };
  }), [byHour, mealCats]);

  // settings.hideFoodCategories swaps the six meal-category groups for one
  // synthetic all-day group (label: null skips the header card, see the
  // timeline render below). Every hour still renders exactly as it does
  // today, filled or empty, since the hour loop only ever reads
  // startHour/endHour off whichever group it's handed. Categories themselves
  // stay the basis for "Repeat yesterday" and Manage Entries either way,
  // this only affects what the main timeline draws.
  const timelineGroups = useMemoFd(
    () => store.settings?.hideFoodCategories ? [{ id: 'all', label: null, startHour: 0, endHour: 24 }] : categoryTotals,
    [store.settings?.hideFoodCategories, categoryTotals]
  );

  // Yesterday's entries grouped by meal category, so an empty category can
  // offer to repeat it in one tap. Reads the store only: nothing is fetched
  // for this, so on a day whose predecessor sits outside the boot window the
  // offer simply doesn't appear rather than firing a request nobody asked for.
  const prevDayByCategory = useMemoFd(() => {
    const prev = fdShiftDate(curDate, -1);
    const out = {};
    (store.foodLogs || []).forEach(l => {
      if (l.date !== prev || l.planned) return;
      const hour = parseInt((l.time || '').slice(0, 2), 10);
      if (!Number.isFinite(hour)) return;
      const cat = mealCats.find(c => hour >= c.startHour && hour < c.endHour);
      if (!cat) return;
      (out[cat.id] = out[cat.id] || []).push(l);
    });
    return out;
  }, [store.foodLogs, curDate, mealCats]);

  // Repeat yesterday's meal into the same (still empty) slot today. Opens a
  // picker rather than copying straight away: the near-identical meal is the
  // common case ("same rice and sauce, different meat"), so the useful shape
  // is the whole meal pre-ticked with one thing to untick, not a yes/no on a
  // bare item count.
  function openRepeatYesterday(cat) {
    const src = prevDayByCategory[cat.id] || [];
    if (!src.length) return;
    setRepeat({ catId: cat.id, label: cat.label, ids: src.map(e => e.id) });
  }
  function toggleRepeatId(id) {
    setRepeat(r => (r ? { ...r, ids: r.ids.includes(id) ? r.ids.filter(x => x !== id) : [...r.ids, id] } : r));
  }
  // Derived from prevDayByCategory rather than snapshotted into the state, so
  // the list can't go stale against the store while the sheet is open.
  const repeatEntries = repeat ? (prevDayByCategory[repeat.catId] || []) : [];
  const repeatSelected = repeat ? repeatEntries.filter(e => repeat.ids.includes(e.id)) : [];
  const repeatTotals = sumTotals(repeatSelected);

  async function submitRepeatYesterday() {
    if (!repeat || !repeatSelected.length) return;
    // In Plan Mode this is planning today, not recording it: the copies land
    // as planned entries to be checked off as they're actually eaten, the same
    // way the meal template's own auto-fill behaves. Without Plan Mode there
    // is no planned state to land in, so they're logged outright.
    const planned = planMode;
    // Only a LOGGED copy reaches the daily log, so only that case can trample
    // macros typed into the Health tab (same rule commitEntries follows).
    if (!planned && !await warnIfOverwritingManualMacros(curDate)) return;
    const copies = repeatSelected.map(e => ({
      ...e, id: LB.uid(), date: curDate, planned,
      // A copy is its own entry: it must not inherit a split/merge batch (that
      // would offer to "undo" a split on a different day) or a template slot
      // marker (which would make the auto-fill think the slot is already done).
      splitBatch: null, templateSlotId: null,
      createdAt: new Date().toISOString(),
    }));
    setStore(s => {
      const nextLogs = [...copies, ...(s.foodLogs || [])];
      // Same rule commitEntries follows: a planned-only batch must never reach
      // patchDaily, which (seeing no logged entries at all when this is the
      // day's first foodLogs row) would null the day's macros/adherence and
      // silently wipe manually-entered Health-tab macros, the exact case the
      // guard above skips the warning for because planning is supposed to
      // leave the day untouched.
      const dailyLogs = planned ? s.dailyLogs : patchDaily(s, curDate, nextLogs.filter(l => l.date === curDate));
      return { ...s, foodLogs: nextLogs, dailyLogs };
    });
    setRepeat(null);
  }

  // Same category/hour grouping for the Manage-entries picker (see the
  // copyMove* sheet below), but keeps planned entries (this picker acts on
  // the whole day, not just the logged truth) and is always chronological:
  // byHour's own per-hour buckets already sort ascending by time, and hours
  // are walked low to high, unlike dayEntries itself (newest-first, for the
  // live timeline further down).
  const copyMoveCategories = useMemoFd(() => {
    return mealCats.map(cat => {
      const entries = [];
      for (let h = cat.startHour; h < cat.endHour; h++) entries.push(...(byHour[h] || []));
      return { ...cat, entries };
    }).filter(cat => cat.entries.length > 0);
  }, [byHour, mealCats]);

  // Flat drag-reorder slot list for the whole timeline, in EXACT render order
  // (category by category, hour by hour): one slot per logged entry, or one
  // placeholder slot for an hour with nothing logged (so an empty hour still
  // has an anchor to drop onto). Used only to map UI.useDragReorder's from/to
  // indices back to an actual hour; see handleTimelineReorder.
  const timelineSlots = useMemoFd(() => {
    const out = [];
    for (const cat of mealCats) {
      for (let h = cat.startHour; h < cat.endHour; h++) {
        const es = byHour[h] || [];
        if (es.length) es.forEach(e => out.push({ entry: e, hour: h }));
        else out.push({ entry: null, hour: h });
      }
    }
    return out;
  }, [byHour, mealCats]);

  // Recent strip: dedupe by food_id for DB items, by food_name for custom
  // ones. store.foodLogs is already recency-ordered (server query and local
  // prepends both put newest first), so a first-seen walk is enough. Kept
  // uncapped here so a search (below) can still reach further back than the
  // unfiltered 20-item cap; recentFoods itself stays recency-ordered either
  // way, never re-sorted, matching Favorites/Recipes' own alphabetical sort
  // being deliberately NOT applied to Recent.
  const recentFoodsAll = useMemoFd(() => {
    // Backdated entries can be prepended to store.foodLogs out of date order
    // (see commitEntries), so sort a copy by (date, time) descending before
    // the first-seen-wins dedupe walk instead of trusting array order.
    const sorted = [...(store.foodLogs || [])].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.time || '') < (b.time || '') ? 1 : (a.time || '') > (b.time || '') ? -1 : 0;
    });
    const seen = new Set();
    const out = [];
    for (const l of sorted) {
      const key = l.foodId || `custom:${l.foodName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(l);
    }
    return out;
  }, [store.foodLogs]);
  const recentFoods = useMemoFd(() => {
    const q = quickQuery.trim().toLowerCase();
    if (!q) return recentFoodsAll.slice(0, 20);
    return recentFoodsAll.filter(l => l.foodName.toLowerCase().includes(q) || (l.brand || '').toLowerCase().includes(q));
  }, [recentFoodsAll, quickQuery]);
  // Favorites/Recipes: alphabetical by name (unlike Recent, which stays
  // recency-ordered), filtered by the same shared quickQuery.
  const favoritesFiltered = useMemoFd(() => {
    const q = quickQuery.trim().toLowerCase();
    const list = q
      ? (store.foodFavorites || []).filter(f => f.foodName.toLowerCase().includes(q) || (f.brand || '').toLowerCase().includes(q))
      : (store.foodFavorites || []);
    return [...list].sort((a, b) => a.foodName.localeCompare(b.foodName));
  }, [store.foodFavorites, quickQuery]);
  const recipesFiltered = useMemoFd(() => {
    const q = quickQuery.trim().toLowerCase();
    const list = q ? (store.foodRecipes || []).filter(r => r.name.toLowerCase().includes(q)) : (store.foodRecipes || []);
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [store.foodRecipes, quickQuery]);

  // Unbounded both ways: backward lazy-fetches outside the boot window, forward
  // is needed for Plan Mode (plan tomorrow's meals), matching the calendar input
  // (no max) and the day-nav comment below.
  const shiftDay = (delta) => setCurDate(d => fdShiftDate(d, delta));

  // Writes the day's summed macros into the daily log, same one-call shape
  // patchDaily/doAdd use in screens-water.jsx. Calories are summed from each
  // entry's own stored kcal, which for a database food was itself derived as
  // 4P + 4C + 9F when the food was cached (the search-foods Edge Function
  // deliberately never trusts a source's printed energy value, see its own
  // comment), and for a custom item is whatever the user entered.
  function patchDaily(s, dateStr, entries) {
    const existing = (s.dailyLogs || []).find(l => l.date === dateStr);
    const netCarbs = !!s.settings?.netCarbs;
    // Also keep tracking fiber for a day that already has a fiber value, even
    // if netCarbs is now globally off (mirrors DailyLogScreen.save() in
    // screens-health.jsx).
    const netForFiber = existing?.fiber != null ? true : netCarbs;
    // Only LOGGED entries feed the daily macro totals: a planned entry (Plan
    // Mode) is not eaten yet, so it must never reach the daily log, coaching
    // targets, or adherence until it's checked off.
    const logged = entries.filter(e => !e.planned);
    const has = logged.length > 0;
    const sum = k => logged.reduce((a, e) => a + (e[k] || 0), 0);
    const calories = has ? Math.round(sum('calories')) : null;
    const protein = has ? Math.round(sum('protein')) : null;
    const carbs = has ? Math.round(sum('carbs')) : null;
    const fat = has ? Math.round(sum('fat')) : null;
    const fiber = has && netForFiber ? Math.round(sum('fiber')) : null;
    const now = new Date().toISOString();
    // Once the last entry for a day is removed there's no more macro data to
    // judge adherence against either, clear it right here instead of leaning
    // on the HealthScreen reconciliation effect: that effect only revisits
    // dates still present in store.foodLogs, so a day that just dropped to
    // zero entries would otherwise keep showing a stale adherence % from
    // when it still had entries.
    // Clearing targetsSnap on an emptied day used to throw away the flex
    // plan's Training|Rest override, which lives in targetsSnap.dayType and is
    // the user's explicit choice for that day, not derived data. The Health
    // tab's own save() and its food reconciler both preserve exactly this.
    const keptDayType = existing?.targetsSnap?.dayType;
    const clearedSnap = (keptDayType === 'training' || keptDayType === 'rest') ? { dayType: keptDayType } : null;
    const log = existing
      ? { ...existing, calories, protein, carbs, fat, fiber, updatedAt: now, ...(has ? {} : { adherence: null, targetsSnap: clearedSnap }) }
      : { id: LB.uid(), date: dateStr, weight: null, steps: null, calories, protein, carbs, fat, fiber, waterMl: null, note: null, offPlanNote: null, coachFields: null, adherence: null, targetsSnap: null, updatedAt: now, createdAt: now };
    return [log, ...(s.dailyLogs || []).filter(l => l.id !== log.id && l.date !== dateStr)];
  }

  // If this would be the FIRST food-tracker entry for the date and the day
  // already carries manually-entered macros (typed into the Health tab's
  // daily log, never touched by the tracker), warns before letting the
  // tracker take over, same "you're about to overwrite the other side"
  // confirm DailyLogScreen already shows in the opposite direction
  // (requestFoodUnlock there warns that editing a locked field gets
  // overwritten the next time food is logged). Once the tracker owns the
  // day (>=1 entry already), no more nagging on every add, same as the lock
  // only fires on that transition. Shared by commitEntries (single add or a
  // staged batch) and submitCopyMove (bulk copy/move onto another date).
  // Returns false if the user backs out, so callers can leave their sheet
  // open instead of closing on a log that never happened.
  async function warnIfOverwritingManualMacros(dateStr) {
    // A day is "food-owned" (tracker manages its macros) only once it has a
    // LOGGED entry: a purely-planned day hasn't touched the daily log yet, so
    // planning food onto a day with manual macros must not warn or claim it.
    const alreadyFoodOwned = (store.foodLogs || []).some(l => l.date === dateStr && !l.planned);
    if (alreadyFoodOwned) return true;
    const existingLog = (store.dailyLogs || []).find(l => l.date === dateStr);
    const hasManualMacros = existingLog && (existingLog.protein != null || existingLog.carbs != null || existingLog.fat != null || existingLog.calories != null);
    if (!hasManualMacros) return true;
    return confirm(
      "This day already has manually-entered macros in the Health tab. Logging food here will overwrite them, and the Food Tracker will manage this day's macros from now on.",
      { title: 'Overwrite manual macros?', ok: 'Continue', cancel: 'Cancel' }
    );
  }

  // Commits any number of entries in one store update, warning once per
  // distinct date represented (usually just one, but a staged batch can in
  // principle span dates if curDate changed mid-pick). The only way anything
  // ever reaches store.foodLogs now: every add flow (search/favorites/
  // recent/custom/recipe) stages first, commitStagedEntries below is what
  // actually calls this.
  async function commitEntries(entries) {
    if (!entries.length) return false;
    const dates = [...new Set(entries.map(e => e.date))];
    // Only a LOGGED entry can overwrite a day's manual macros, so only warn
    // for dates this batch actually logs something onto: a planned-only add
    // leaves the daily log untouched and needs no confirmation.
    const loggedDates = [...new Set(entries.filter(e => !e.planned).map(e => e.date))];
    for (const d of loggedDates) {
      const ok = await warnIfOverwritingManualMacros(d);
      if (!ok) return false;
    }
    setStore(s => {
      const nextLogs = [...entries, ...(s.foodLogs || [])];
      let dailyLogs = s.dailyLogs || [];
      // Only re-roll the daily log for dates this batch actually LOGGED onto: a
      // planned-only add must never reach patchDaily, which would (with no logged
      // entries) null the day's macros and silently wipe manually-entered Health
      // macros. loggedDates already excludes planned-only dates.
      for (const d of loggedDates) dailyLogs = patchDaily({ ...s, dailyLogs }, d, nextLogs.filter(l => l.date === d));
      return { ...s, foodLogs: nextLogs, dailyLogs };
    });
    setPendingHour(null);
    return true;
  }
  function removeStaged(id) {
    setStaged(list => list.filter(e => e.id !== id));
  }
  // "Add N items": commits the whole staged batch in one go, clearing it
  // only on success (a declined overwrite-warning leaves the picks in place
  // so the user doesn't lose them).
  async function commitStagedEntries() {
    if (!staged.length) return;
    const ok = await commitEntries(staged);
    if (ok) setStaged([]);
  }
  // TopBar back: warns first if there's a staged-but-uncommitted batch, same
  // "Discard picks?" wording FdIngredientPicker's own back/backdrop already
  // uses, so an accidental tap here doesn't silently drop everything picked.
  async function requestLeaveFood() {
    if (staged.length && !await confirm(`${staged.length} picked item${staged.length === 1 ? '' : 's'} won't be added.`, { title: 'Discard picks?', ok: 'Discard', cancel: 'Keep picking', danger: true })) return;
    // Health is an independently-toggleable tab now, not guaranteed on: fall
    // back to Home instead of navigating into a hidden tab.
    go(store.settings?.showHealthTab ? { name: 'health' } : { name: 'home' });
  }

  // Time stamped on a newly logged entry: the timeline hour the user tapped
  // "+" on, else the current wall-clock time.
  function entryTime() {
    return pendingHour != null ? `${String(pendingHour).padStart(2, '0')}:00` : LB.nowHHMM();
  }
  // Timeline "+": remember the hour and jump to Search to pick a food for it.
  function addAtHour(h) {
    setPendingHour(h);
    setQuery(''); setResults(null); setSearchError(null);
    setTab('search');
  }
  // A pending timeline hour applies to whatever the user adds next, so it must
  // survive moving between the two "add a food" tabs (Search and Quick Add).
  // Only stepping back to the Log tab (where the timeline itself lives, with
  // its own per-hour "+") ends that intent.
  function onTabChange(id) { if (id === 'log') setPendingHour(null); setTab(id); }

  async function deleteEntry(entry) {
    const ok = await confirm(`${entry.foodName} · ${entry.calories} kcal`, { title: 'Delete entry?', ok: 'Delete', cancel: 'Cancel', danger: true });
    if (!ok) return;
    setStore(s => {
      const nextLogs = (s.foodLogs || []).filter(l => l.id !== entry.id);
      return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, entry.date, nextLogs.filter(l => l.date === entry.date)) };
    });
  }

  // Flip an entry between planned and logged (Plan Mode). Checking a planned
  // entry off (planned -> logged) is the primary action on the timeline's
  // planned cards; patchDaily then folds its macros into the day, since a
  // logged entry counts and a planned one doesn't.
  async function setEntryPlanned(entry, planned) {
    // Unticking the meal of choice means "not eaten after all", and its
    // honest inverse is going back to a live budget, not a frozen row. Left as
    // an ordinary planned entry it would keep claiming the macros it happened
    // to be worth at the moment it was ticked, while the derived row that
    // tracks the rest of the day stayed hidden behind it, and it would then
    // spend that stale budget again through projectedTotals. Dropping the row
    // brings the live one straight back.
    if (planned && entry.id === mocEntryId) {
      setStore(s => {
        const nextLogs = (s.foodLogs || []).filter(l => l.id !== entry.id);
        return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, entry.date, nextLogs.filter(l => l.date === entry.date)) };
      });
      return;
    }
    // Flipping TO logged claims the day for the tracker. If this is the first
    // logged entry on a day that carries manual Health-tab macros, warn before
    // patchDaily overwrites them, same as a fresh logged add (commitEntries).
    // Flipping back to planned only removes it from the day, so no warning.
    if (!planned) {
      const ok = await warnIfOverwritingManualMacros(entry.date);
      if (!ok) return;
    }
    setStore(s => {
      const nextLogs = (s.foodLogs || []).map(l => l.id === entry.id ? { ...l, planned } : l);
      return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, entry.date, nextLogs.filter(l => l.date === entry.date)) };
    });
  }

  // Declare (or undeclare) the viewed day a meal-of-choice day.
  //
  // Nulling adherence here is not optional. This screen never writes adherence,
  // and the effect that would (HealthScreen's food reconciler) only runs while
  // HealthScreen is mounted, so without this the day keeps a stale score until
  // the user happens to open Health, and that stale number is exactly what
  // feeds the coach's weekly check-in. Bumping updatedAt is not optional
  // either: sync_daily_logs_batch drops any write that reuses the old stamp.
  //
  // Routed through dailyLogAdherence rather than hand-rolled, same reason
  // setFlexDayType and the retroactive day-type heal in screens-health.jsx
  // are: it owns the meal-of-choice rule AND now also builds targetsSnap
  // (previously left null on a fresh day until something else happened to
  // write it). Status is not on the row, so undeclaring still has to ask
  // statusModeForDate itself, or un-marking on a sick/vacation day would hand
  // it a real score, the same hole those two call sites had before Phase 2.4.
  // Marking on needs no such check: mealOfChoice alone already forces
  // dailyLogAdherence's result to null.
  async function setMealOfChoice(on, name, hour) {
    if (!on && mocEntry) {
      const ok = await confirm(
        'The day goes back to being scored, including the meal you already logged for it.',
        { title: 'Remove the marker?', ok: 'Remove', cancel: 'Keep' });
      if (!ok) return;
    }
    const now = new Date().toISOString();
    setStore(s => {
      const existing = (s.dailyLogs || []).find(l => l.date === curDate);
      const offPlanNote = LB.withMealOfChoiceNote(existing?.offPlanNote ?? null, on ? (name || '') : null);
      const isTraining = LB.isTrainingDayForDate(s, curDate);
      const unscored = !on && !!LB.statusModeForDate(s, curDate);
      const { adherence, targetsSnap } = unscored
        ? { adherence: null, targetsSnap: existing?.targetsSnap ?? null }
        : LB.dailyLogAdherence({ ...(existing || {}), mealOfChoice: on }, macroTargets, isTraining);
      const log = existing
        ? { ...existing, mealOfChoice: on, mealOfChoiceHour: on ? hour : null, offPlanNote, adherence, targetsSnap, updatedAt: now }
        : { id: LB.uid(), date: curDate, weight: null, steps: null, calories: null, protein: null, carbs: null,
            fat: null, fiber: null, waterMl: null, note: null, offPlanNote, coachFields: null,
            mealOfChoice: on, mealOfChoiceHour: on ? hour : null,
            adherence, targetsSnap, updatedAt: now, createdAt: now };
      return { ...s, dailyLogs: [log, ...(s.dailyLogs || []).filter(l => l.date !== curDate)] };
    });
  }

  // Confirming the meal freezes whatever was still open at that instant into a
  // real logged entry, then hands it to the ordinary commit path so it gets the
  // manual-macro warning and the daily-log mirror like anything else. From here
  // on it is a normal row: editable, movable, deletable.
  async function confirmMealOfChoice() {
    // mealOfChoiceRemainder only returns null with no macro target at all; a
    // fully-spent budget still comes back as a real {calories:0,...} object,
    // which is truthy. Same threshold the row's own "Budget spent, log it
    // normally" copy already uses, or tapping the checkbox there would still
    // log a real zero-macro entry instead of the no-op that copy promises.
    if (!mocRemainder || mocRemainder.calories <= 0) return;
    await commitEntries([{
      id: mocEntryId, date: curDate, time: `${String(mocHour).padStart(2, '0')}:00`,
      foodId: null, foodName: mocName || 'Meal of choice', brand: null, source: 'custom',
      // zane_food_logs.quantity_g is NOT NULL. There is no real weight here
      // (the remainder is macro-only), so this follows buildCustomEntry's own
      // fallback for the same situation, above.
      quantityG: 100,
      calories: mocRemainder.calories, protein: mocRemainder.protein,
      carbs: mocRemainder.carbs, fat: mocRemainder.fat,
      fiber: null, sugar: null, satFat: null, sodiumMg: null,
      planned: false, createdAt: new Date().toISOString(),
    }]);
  }

  // Re-hours a dragged entry, keeping its own minute (":MM") and every other
  // field untouched. The day's macro totals don't change (same entries,
  // different hour bucket), so no patchDaily call is needed here.
  function moveEntryToHour(entry, hour) {
    const hh = String(hour).padStart(2, '0');
    setStore(s => ({
      ...s,
      foodLogs: (s.foodLogs || []).map(l => l.id === entry.id ? { ...l, time: hh + (l.time || '00:00').slice(2) } : l),
    }));
  }
  // fixedSlots: true (see UI.useDragReorder in ui.jsx) hands back the raw
  // drop-line index as `to`, not one adjusted for a conventional array
  // reorder: hour rows never actually move here, only the dragged entry's
  // own hour changes, and a plain reorder-shaped index would make dropping
  // into the very next hour collapse to "same as source", silently
  // swallowing the single most common move.
  function handleTimelineReorder(from, to) {
    const src = timelineSlots[from];
    if (!src || !src.entry) return;
    const target = timelineSlots[Math.min(to, timelineSlots.length - 1)];
    if (!target || target.hour === src.hour) return;
    moveEntryToHour(src.entry, target.hour);
  }
  const timelineDragRef = UI.useDragReorder({ onReorder: handleTimelineReorder, fixedSlots: true });

  // Food log as an image: a dedicated "poster" tree (hero + every category
  // that actually has entries, empty categories/hours dropped), rasterized
  // via the same html2canvas flow the Plan poster and session-share camera
  // button use (captureNodeAsPng, screens-lib.jsx). Always mounted, only
  // ever hidden via display:none (see the poster's own comment further
  // down for why it can't be conditionally rendered on `capturing`).
  const [capturing, setCapturing] = useStateFd(false);
  const captureRef = useRefFd(null);
  // Same background-watermark treatment as the Plan poster (screens-schedule.jsx):
  // VIPs get their own background image, everyone else gets the ZANE mark.
  // Bumped past the Plan poster's own opacity: that poster's day cards are
  // spaced apart with real gaps between them, so the mark stays visible even
  // at a faint 0.06/0.10. This poster's category/entry cards (see below) are
  // a translucent surface tint rather than a solid fill specifically so the
  // mark reads through the cards themselves too, not just the gaps, which
  // needs a stronger base opacity to actually show up under that tint.
  const _shotLogo = store.settings?.vipBackground || 'icons/zane-logo.png';
  const _shotIsCustom = _shotLogo !== 'icons/zane-logo.png';
  const _shotIsLight = ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark');
  const _shotDefaultStyle = { width: '75%', maxWidth: 620, opacity: _shotIsLight ? 0.16 : 0.11, filter: _shotIsLight ? 'grayscale(1)' : 'grayscale(1) brightness(3)', objectFit: 'contain' };
  const _shotCustomStyle = { width: '80%', maxWidth: 680, opacity: 0.19, objectFit: 'contain' };
  const _shotGridOn = !!window.__gridEnabled;
  // Same shape as categoryTotals, but only categories with at least one
  // logged hour survive, and each surviving category only lists the hours
  // that actually have entries: the live timeline always renders all 24
  // hours (so "+" is reachable everywhere), a shareable image shouldn't.
  // Planned-but-not-yet-checked-off entries are dropped here too, same
  // "logged truth only" rule categoryTotals already applies to its kcal
  // sums: a screenshot is what you actually ate, an unchecked planned item
  // (that isn't even counted in its own category's total above it) has no
  // business appearing as its own card, and an hour with nothing BUT a
  // still-planned entry shouldn't appear at all.
  // An unconfirmed meal of choice rides along as a synthetic entry so the
  // poster shows the shape of the day the day actually has, including what is
  // still open for it. It carries a flag rather than looking like a normal
  // entry: it is not eaten, so it is deliberately NOT in the category totals,
  // and rendering it as an ordinary card would claim otherwise. Its hour is
  // kept even when nothing else is logged there, unlike every other empty
  // hour, because that hour is the whole point of the row.
  const posterCategories = useMemoFd(() => {
    const mocRow = (isMealOfChoice && !mocEntry && mocRemainder && mocRemainder.calories > 0)
      ? { id: 'moc', moc: true, foodName: mocName || 'Meal of choice',
          calories: mocRemainder.calories, protein: mocRemainder.protein,
          carbs: mocRemainder.carbs, fat: mocRemainder.fat }
      : null;
    return categoryTotals
      .map(cat => {
        const hours = [];
        for (let h = cat.startHour; h < cat.endHour; h++) {
          const es = (byHour[h] || []).filter(e => !e.planned);
          const withMoc = (mocRow && h === mocHour) ? [...es, mocRow] : es;
          if (withMoc.length) hours.push({ hour: h, entries: withMoc });
        }
        return { ...cat, hours };
      })
      .filter(cat => cat.hours.length > 0);
  }, [categoryTotals, byHour, isMealOfChoice, mocEntry, mocRemainder, mocName, mocHour]);
  const takeScreenshot = async () => {
    const res = await captureNodeAsPng(captureRef.current, {
      filename: `food-log-${curDate}.png`,
      setCapturing,
    });
    if (!res?.ok) {
      await confirm(res?.reason === 'unavailable'
        ? 'Could not build the image. Check your connection and try again.'
        : 'Could not build the image. Please try again.',
        { title: 'Export failed', ok: 'OK', cancel: null });
    } else if (res.saved) {
      await confirm('Food log image saved to your files.', { title: 'Saved', ok: 'OK', cancel: null });
    }
  };

  function openCopyMove() {
    setCopyMoveIds([]);
    setCopyMoveTarget('');
    setCopyMoveMode('copy');
    setCopyMoveOpen(true);
  }
  function toggleCopyMoveId(id) {
    setCopyMoveIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }
  // Backdrop tap used to drop the whole picker (selection, target date,
  // mode) silently. Same "Discard picks?" wording/pattern as the staged-
  // items guard (requestLeaveFood) and FdIngredientPicker's own; phrased
  // mode-agnostically since closing without submitting leaves every entry
  // untouched regardless of whether Copy, Move or Delete was selected.
  async function requestCloseCopyMove() {
    if (copyMoveIds.length && !await confirm(`${copyMoveIds.length} picked ${copyMoveIds.length === 1 ? 'entry' : 'entries'} will be unselected.`, { title: 'Discard picks?', ok: 'Discard', cancel: 'Keep picking', danger: true })) return;
    setCopyMoveOpen(false);
  }
  // Duplicates the selected entries onto another date at their original
  // time-of-day (copy), or does the same and also removes them from
  // curDate (move). One combined setStore call so both dates' daily
  // rollups patch together, same "mutate + patchDaily in one write" shape
  // every other add/delete on this screen uses; patching curDate has to
  // read off the store already carrying the target date's patched
  // dailyLogs row, not the stale one from before this write, so it chains
  // through an intermediate store rather than calling patchDaily twice off
  // the same s.
  async function submitCopyMove() {
    if (!copyMoveIds.length || !copyMoveTarget || copyMoveTarget === curDate) return;
    const targetDate = copyMoveTarget, mode = copyMoveMode, ids = copyMoveIds, sourceDate = curDate;
    // A day that hasn't happened yet can't already have something "eaten" on
    // it: landing on a future date forces planned, regardless of whether the
    // source entry was logged or planned itself. In Plan Mode, landing on
    // TODAY is the same situation, today isn't over either, so it's still
    // something to plan and check off later (same rule submitRepeatYesterday
    // follows for its own curDate-only copy). Without Plan Mode there is no
    // planned state to land in, so a same-day/past copy always logs outright.
    // Planned clones never touch the target's daily log, so a target that
    // lands planned neither warns about overwriting manual macros nor gets a
    // patchDaily (which would null them).
    const targetIsFuture = targetDate > today;
    const targetLandsPlanned = targetIsFuture || (planMode && targetDate === today);
    if (!targetLandsPlanned) {
      const ok = await warnIfOverwritingManualMacros(targetDate);
      if (!ok) return;
    }
    setStore(s => {
      const selected = (s.foodLogs || []).filter(l => ids.includes(l.id));
      if (!selected.length) return s;
      const now = new Date().toISOString();
      const clones = selected.map(l => ({
        ...l, id: LB.uid(), date: targetDate, createdAt: now, planned: targetLandsPlanned ? true : l.planned,
        // Same rule "Repeat yesterday" follows: a copy is its own entry and
        // must not inherit the split/merge batch (its "undo split" would act
        // on another day) or the template-slot marker (auto-fill would treat
        // that slot as already filled on the target day and skip it).
        splitBatch: null, templateSlotId: null,
      }));
      const remaining = mode === 'move' ? (s.foodLogs || []).filter(l => !ids.includes(l.id)) : (s.foodLogs || []);
      const nextLogs = [...clones, ...remaining];
      let dailyLogs = s.dailyLogs || [];
      if (!targetLandsPlanned) dailyLogs = patchDaily({ ...s, dailyLogs }, targetDate, nextLogs.filter(l => l.date === targetDate));
      if (mode === 'move') {
        dailyLogs = patchDaily({ ...s, dailyLogs }, sourceDate, nextLogs.filter(l => l.date === sourceDate));
      }
      return { ...s, foodLogs: nextLogs, dailyLogs };
    });
    setCopyMoveOpen(false);
  }
  // Mass delete: the same picker sheet's third mode, one patchDaily for
  // curDate instead of one confirm + one write per entry. Mirrors
  // deleteEntry's confirm wording (name/kcal) but for a whole selection, a
  // count and the combined kcal rather than every individual food name.
  async function deleteBulkEntries() {
    if (!copyMoveIds.length) return;
    const ids = copyMoveIds;
    const totalKcal = dayEntries.filter(e => ids.includes(e.id)).reduce((a, e) => a + (e.calories || 0), 0);
    const ok = await confirm(`${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} · ${totalKcal} kcal`, { title: 'Delete entries?', ok: 'Delete', cancel: 'Cancel', danger: true });
    if (!ok) return;
    setStore(s => {
      const nextLogs = (s.foodLogs || []).filter(l => !ids.includes(l.id));
      return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, curDate, nextLogs.filter(l => l.date === curDate)) };
    });
    setCopyMoveOpen(false);
  }

  // Sets the query text and, when it lands back at empty, resets the search
  // state along with it (so a stale results list, and the "Add manually"
  // button riding on it, don't linger for text no longer in the box). Shared
  // by the input's onChange and the field's clear ("x") button.
  function setQueryAndReset(v) {
    setQuery(v);
    if (!v.trim() && results != null) { setResults(null); setSearchError(null); setBarcodeMiss(null); }
  }

  // Source the last dispatched search actually ran against, so the effect
  // below can tell an already-served filter from one the user switched to
  // mid-flight (which must still re-run once the in-flight request settles).
  const lastSearchedSource = useRefFd(null);
  async function runSearch(override) {
    const q = (typeof override === 'string' ? override : query).trim();
    if (!q || searching) return;
    const src = sourceFilter;
    lastSearchedSource.current = src;
    setSearching(true); setSearchError(null);
    const res = await LB.searchFoods(q, src);
    setSearching(false);
    if (!res.ok) { setSearchError(res.error || 'Search failed. Try again.'); setResults([]); setBarcodeMiss(null); return; }
    setResults(res.results);
    // A barcode that finds nothing is a dead end the user is uniquely well
    // placed to get out of: the product is in their hand and the camera was
    // open a second ago. Barcode lookup only exists for Open Food Facts, so a
    // miss is routine for local products. Offer the label scan right there
    // instead of leaving them on "No matches" with a manual-entry button.
    setBarcodeMiss(res.isBarcode && !res.results.length ? q : null);
  }
  // Switching the source filter re-runs the last submitted query automatically
  // (a query is already an explicit user action, not the "hammer the API on
  // every keystroke" case submit-triggered search is guarding against). Also
  // depends on `searching`: a filter tapped mid-search would otherwise be
  // dropped by runSearch's own in-flight guard and never retried, leaving the
  // wrong source's results on screen. Re-running only when the last-searched
  // source differs from the current one avoids a redundant duplicate search
  // when a normal search completes.
  useEffectFd(() => {
    if (results != null && query.trim() && !searching && lastSearchedSource.current !== sourceFilter) runSearch();
  }, [sourceFilter, searching]); // eslint-disable-line

  // A scanned barcode runs straight through the normal search (its isBarcode
  // path does an Open Food Facts barcode lookup), so the found product shows as
  // a result the user taps to log.
  function handleScan(code) {
    setScanOpen(false);
    setQuery(code);
    runSearch(code);
  }

  // Nutrition-label scan: the user photographs a Nährwerttabelle, we shrink it
  // client-side and send it to the scan-label edge function (labelScannerProvider
  // picks xAI Grok or Claude vision, see the Scan sheet's toggle below), then
  // prefill the Custom Item form with what it read for the user to verify.
  // A scanned label is a per-user custom item, never a shared zane_foods entry.
  async function handleLabelFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // let the user re-pick the same photo after an error
    if (!file) return;
    setLabelError(null);
    setLabelScanning(true);
    try {
      const { base64, mimeType } = await fdDownscaleImage(file);
      if (!base64) { setLabelScanning(false); setLabelError('Could not read that image. Try again.'); return; }
      const res = await LB.scanLabel(base64, mimeType, labelScannerProvider);
      setLabelScanning(false);
      if (!res.ok) { setLabelError(res.error || 'Scan failed. Try again.'); return; }
      prefillFromLabel(res.label);
    } catch (_) {
      setLabelScanning(false);
      setLabelError('Could not read that image. Try again.');
    }
  }

  function prefillFromLabel(label) {
    if (!label || label.is_nutrition_label === false) {
      setLabelError("That doesn't look like a nutrition label. Try a straight-on photo of the table.");
      return;
    }
    const cal = label.calories, p = label.protein_g, c = label.carbs_g, f = label.fat_g, fib = label.fiber_g;
    // Migration 0204 extras, read off the same panel (sugar and saturated fat
    // as their own sub-lines, sodium already converted to mg by the scanner).
    const sug = label.sugar_g, sat = label.sat_fat_g, sod = label.sodium_mg;
    if (cal == null && p == null && c == null && f == null) {
      setLabelError('Could not read the values. Try a clearer photo, or add it manually.');
      return;
    }
    // Turn whatever basis the label used into per-100g/ml rates, so the
    // quantity sheet can scale the macros to any portion the user types. The
    // scanner is told to prefer the per-100 column, so basis is usually 100g;
    // a serving-only label is converted through its stated gram weight. The
    // label's own printed calories (cal) never makes it into per100: kcal100Str
    // (see its effect above) derives calories from p100Str/c100Str/f100Str
    // instead, same rule the search-foods edge function applies to every DB
    // result, so a scanned label reports calories the same consistent way.
    const per100 = (label.basis === '100g' || label.basis === '100ml')
      ? { p, c, f, fib, sug, sat, sod }
      : (label.serving_size_g > 0)
        ? (k => ({
            p: p != null ? p * k : null, c: c != null ? c * k : null, f: f != null ? f * k : null,
            fib: fib != null ? fib * k : null, sug: sug != null ? sug * k : null,
            sat: sat != null ? sat * k : null, sod: sod != null ? sod * k : null,
          }))(100 / label.serving_size_g)
        : null;

    if (per100) {
      const name = label.name || '';
      setPendingFood({
        custom: true, fromCache: true,
        name, brand: label.brand || null,
        proteinPer100g: per100.p, carbsPer100g: per100.c,
        fatPer100g: per100.f, fiberPer100g: per100.fib,
        sugarPer100g: per100.sug, satFatPer100g: per100.sat, sodiumMgPer100g: per100.sod,
        servingSizeG: label.serving_size_g > 0 ? label.serving_size_g : null,
        servingLabel: label.serving_label || null,
      });
      setP100Str(per100.p != null ? String(fdRound1(per100.p)) : '');
      setC100Str(per100.c != null ? String(fdRound1(per100.c)) : '');
      setF100Str(per100.f != null ? String(fdRound1(per100.f)) : '');
      setKcal100Touched(false);
      setFavedId(existingFavId(null, name));
      // Default portion: the printed 100 g when that is the basis (preview then
      // matches the package numbers as a read-back sanity check), else the
      // stated serving. The user edits it to their actual portion and the
      // macros scale live.
      setQtyG((label.basis === '100g' || label.basis === '100ml') ? '100' : String(Math.round(label.serving_size_g)));
      openQtySheet();
      return;
    }

    // No per-100 basis and no serving grams (a pure per-serving label with no
    // gram weight, or an unreadable basis): fall back to the plain custom form
    // where the user types the macros for the amount, no scaling possible.
    resetCustomForm();
    setCustomName(label.name || '');
    setCustomG('');
    setCustomP(p != null ? String(Math.round(p)) : '');
    setCustomC(c != null ? String(Math.round(c)) : '');
    setCustomF(f != null ? String(Math.round(f)) : '');
    setCustomFib(fib != null ? String(Math.round(fib)) : '');
    setCustomSugar(sug != null ? String(fdRound1(sug)) : '');
    setCustomSatFat(sat != null ? String(fdRound1(sat)) : '');
    setCustomSodium(sod != null ? String(Math.round(sod)) : '');
    setCustomExtrasOpen(sug != null || sat != null || sod != null);
    setCustomOpen(true);
  }

  // Open straight from the search result, no server round-trip: the result
  // already carries the macros (from the same server search response), so the
  // quantity sheet opens instantly, just like re-adding a favorite. The
  // authoritative cache write still happens server-side at log time (see
  // confirmLogFood -> LB.cacheFood), so a food that isn't cached yet
  // (r.cached false) is cached only once it's actually eaten.
  function pickResult(r) {
    setPendingFood({ ...r, fromCache: !!r.cached });
    setFavedId(existingFavId(`${r.source}:${r.sourceId}`, r.name));
    setQtyG(r.servingSizeG != null ? String(Math.round(r.servingSizeG)) : '100');
    openQtySheet();
  }

  // Reopens a previously-logged custom item (no foodId) through the scalable
  // quantity sheet instead of the static Custom Item form: derives per-100g
  // rates from the quantity it was originally logged at, exactly like
  // prefillFromLabel does for a scanned label, so typing a new gram amount
  // actually rescales the macros instead of leaving them frozen.
  function openCustomAsScalable(item) {
    const per100 = item.quantityG > 0 ? 100 / item.quantityG : 1;
    setPendingFood({
      custom: true, fromCache: true,
      name: item.foodName, brand: item.brand || null,
      // No kcalPer100g here: kcal100Str (set below, see its auto-calc effect)
      // derives calories from protein/carbs/fat instead, ignoring whatever
      // item.calories happens to already be.
      proteinPer100g: item.protein * per100,
      carbsPer100g: item.carbs * per100, fatPer100g: item.fat * per100,
      fiberPer100g: item.fiber != null ? item.fiber * per100 : null,
      sugarPer100g: item.sugar != null ? item.sugar * per100 : null,
      satFatPer100g: item.satFat != null ? item.satFat * per100 : null,
      sodiumMgPer100g: item.sodiumMg != null ? item.sodiumMg * per100 : null,
      servingSizeG: null, servingLabel: null,
      // zane_food_logs never stores the full units picker list (see
      // matchingFavorite); a favorite matching this same name still offers
      // its configured shortcuts, else undefined, which the quantity
      // sheet's units?.length check treats as "no units".
      units: item.units ?? matchingFavorite(null, item.foodName)?.units,
    });
    setP100Str(String(fdRound1(item.protein * per100)));
    setC100Str(String(fdRound1(item.carbs * per100)));
    setF100Str(String(fdRound1(item.fat * per100)));
    setKcal100Touched(false);
    setQtyG(item.quantityG != null ? String(item.quantityG) : '100');
    openQtySheet();
  }

  // Reconstructs per-100g rates from a past entry (the log/favorite only
  // stores the already-scaled amounts, not per-100g), so a recent or
  // favorited DB-sourced item can be relogged at a different quantity
  // without another network round-trip. Recent (foodLogs) and Favorites
  // share this exact shape, so one function serves both strips. Recipes
  // can only ever reach this via Recent (never favorited, no star button
  // on the recipe portion sheet), and need their own portion picker
  // instead of the plain rescale path everything else below takes.
  function reAddFromRecent(l) {
    if (l.source === 'recipe') {
      // foodName may carry a "(chosen/total portions)" suffix (see
      // confirmRecipeLog) when the whole batch wasn't logged; strip it to
      // find the live recipe by name. Reopens the normal portion picker
      // against the CURRENT recipe (ingredients/portions may have changed
      // since it was logged) exactly like tapping it fresh from the
      // Recipes tab, not a reconstruction from this entry's own
      // already-scaled snapshot. Falls through to the plain rescale path
      // below if the recipe was since renamed or deleted, so re-adding
      // still works, just without the portion picker.
      const recipe = recipeEntryLiveRecipe(l);
      if (recipe) { addRecipeToLog(recipe); return; }
    }
    setFavedId(existingFavId(l.foodId, l.foodName));
    if (l.foodId) {
      const per100 = l.quantityG > 0 ? 100 / l.quantityG : 1;
      const netCarbs = !!store.settings?.netCarbs;
      setPendingFood({
        source: l.source, sourceId: l.foodId.slice((l.source || '').length + 1),
        name: l.foodName, brand: l.brand || null,
        // Derived from the stored macros, not l.calories directly: always
        // computing at read time (rather than trusting whatever calories
        // this entry happened to be logged with) keeps a re-add correct
        // even for an entry from before this rule existed, without needing
        // every historical row to already be fixed. Fiber only enters the
        // subtraction when netCarbs is on, same rule every other caller of
        // caloriesFromMacros in this file follows.
        kcalPer100g: LB.caloriesFromMacros(l.protein, l.carbs, l.fat, netCarbs ? l.fiber : null) * per100,
        proteinPer100g: l.protein * per100,
        carbsPer100g: l.carbs * per100, fatPer100g: l.fat * per100,
        fiberPer100g: l.fiber != null ? l.fiber * per100 : null,
        // Migration 0204 extras, reconstructed the same way. Absent on
        // anything logged before those columns existed, which stays null
        // rather than becoming a fabricated zero.
        sugarPer100g: l.sugar != null ? l.sugar * per100 : null,
        satFatPer100g: l.satFat != null ? l.satFat * per100 : null,
        sodiumMgPer100g: l.sodiumMg != null ? l.sodiumMg * per100 : null,
        servingSizeG: null, servingLabel: null,
        // Already in the log (so already cached): don't re-cache it on re-log.
        fromCache: true,
        // zane_food_logs never stores the full units picker list; fall back
        // to a matching favorite's configured units, same as the custom
        // branch above.
        units: l.units ?? matchingFavorite(l.foodId, l.foodName)?.units,
      });
      setQtyG(l.quantityG != null ? String(l.quantityG) : '100');
      openQtySheet();
    } else {
      openCustomAsScalable(l);
    }
  }

  const qtyPreview = useMemoFd(() => {
    if (!pendingFood) return null;
    const qty = fdNum(qtyG);
    if (!qty || qty <= 0) return null;
    const factor = qty / 100;
    // For a scanned/custom item the per-100g P/C/F (and calories, see
    // kcal100Str above) come from the editable fields, so a correction
    // flows straight into the scaled totals; for a real DB food they come
    // from the fixed rates on pendingFood, its own source's energy value,
    // never derived from macros.
    const custom = !!pendingFood.custom;
    const rate = (s, key) => {
      if (!custom) return pendingFood[key] || 0;
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    };
    const netCarbs = !!store.settings?.netCarbs;
    const protein = fdRound1(rate(p100Str, 'proteinPer100g') * factor);
    const carbs = fdRound1(rate(c100Str, 'carbsPer100g') * factor);
    const fat = fdRound1(rate(f100Str, 'fatPer100g') * factor);
    const fiber = pendingFood.fiberPer100g != null ? fdRound1(pendingFood.fiberPer100g * factor) : null;
    // A custom item's calories still come from kcal100Str (already
    // netCarbs-aware, see useAutoDerivedCalories above), scaled by amount; a
    // real DB food now derives them from the scaled macros here instead of
    // pendingFood's own fixed per-100g energy value, so a high-fiber food
    // logged via search/barcode/recent respects net-carb mode the same way
    // a Custom Item with identical macros already does.
    const calories = custom
      ? Math.round((fdNum(kcal100Str) || 0) * factor)
      : Math.round(LB.caloriesFromMacros(protein, carbs, fat, netCarbs ? fiber : null) || 0);
    // Migration 0204 extras. Scaled by the same factor, straight off the food
    // (never user-editable like P/C/F: they play no part in the calorie math,
    // so there is nothing to correct here). null stays null, since "the source
    // does not report it" must not collapse into a confident zero.
    const sc1 = (v) => (v == null ? null : fdRound1(v * factor));
    const sugar = sc1(pendingFood.sugarPer100g);
    const satFat = sc1(pendingFood.satFatPer100g);
    const sodiumMg = pendingFood.sodiumMgPer100g == null ? null : Math.round(pendingFood.sodiumMgPer100g * factor);
    return { calories, protein, carbs, fat, fiber, sugar, satFat, sodiumMg };
  }, [pendingFood, qtyG, p100Str, c100Str, f100Str, kcal100Str, store.settings?.netCarbs]);

  // A scanned custom item needs a name before it can be logged/favorited; a
  // DB food always has one, so this only ever gates the custom path.
  const qtyNameMissing = !!(pendingFood && pendingFood.custom) && !String(pendingFood.name || '').trim();

  // Every call site that opens the quantity sheet for a (possibly new)
  // pendingFood must go through this instead of setQtySheetOpen(true)
  // directly: qtyUnitIdx is an index into THAT food's own units array, so
  // a stale index left over from a previous food (which may have had more
  // units, or none) would either point at the wrong unit or crash reading
  // pendingFood.units[qtyUnitIdx] on one with fewer/no units.
  function openQtySheet() { setQtyUnitIdx(null); setQtyCountStr(''); setQtySheetOpen(true); }

  // Switches the amount field between grams and a count of one of
  // pendingFood.units. Switching TO a unit seeds the count from whatever
  // qtyG currently holds (so picking a unit right after typing/tapping a
  // gram amount doesn't reset it to 1); switching back to grams just
  // leaves qtyG as-is, since it was already grams.
  function selectQtyUnit(idx) {
    setQtyUnitIdx(idx);
    if (idx == null) { setQtyCountStr(''); return; }
    const unit = pendingFood?.units?.[idx];
    if (!unit || !(unit.grams > 0)) return;
    const curG = fdNum(qtyG);
    const count = curG != null ? fdRound1(curG / unit.grams) : 1;
    setQtyCountStr(String(count));
    setQtyG(String(fdRound1(count * unit.grams)));
  }
  function onQtyCountChange(v) {
    const filtered = fdDecimalFilter(v);
    setQtyCountStr(filtered);
    const unit = pendingFood?.units?.[qtyUnitIdx];
    const n = fdNum(filtered);
    setQtyG(unit && n != null ? String(fdRound1(n * unit.grams)) : '');
  }
  function closeQtySheet() { setQtySheetOpen(false); setPendingFood(null); setQtyG(''); setFavedId(null); setP100Str(''); setC100Str(''); setF100Str(''); setKcal100Str(''); setKcal100Touched(false); setQtyUnitIdx(null); setQtyCountStr(''); setEditingEntry(null); setQtyEditPlanned(false); setEditingMealItemId(null); }
  // Reopens an already-logged (non-recipe) timeline entry through the same
  // scalable quantity sheet used to log it in the first place, deriving
  // per-100g rates from what it was actually logged at (reAddFromRecent
  // already does exactly this for both a DB food and a custom item);
  // editingEntry then routes confirmLogFood to update it in place instead
  // of staging a new one.
  function openEditEntry(entry) {
    setEditingEntry(entry);
    setQtyEditPlanned(!!entry.planned);
    reAddFromRecent(entry);
  }
  function closeCustomSheet() { setCustomOpen(false); setFavedId(null); }
  // Backdrop tap on this sheet used to discard a typed (or scan-prefilled)
  // custom item silently. This sheet only ever opens empty or freshly
  // scan-prefilled (never to re-edit an already-saved entry, see
  // openEditEntry), so "anything typed" is a safe dirty check with no
  // false positives.
  async function requestCloseCustomSheet() {
    const dirty = customName.trim() || customG.trim() || customCal.trim() || customP.trim() || customC.trim() || customF.trim() || customFib.trim()
      || customSugar.trim() || customSatFat.trim() || customSodium.trim();
    if (dirty && !await confirm("This item won't be saved.", { title: 'Discard item?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    closeCustomSheet();
  }

  // Build the entry the open sheet describes right now (without logging it), so
  // both the log/ingredient action and the favorite toggle work off the same
  // data. Returns null while the form is incomplete.
  function buildQtyEntry() {
    if (!pendingFood || !qtyPreview) return null;
    // A scanned label rides through the quantity sheet as a custom item
    // (foodId null, source 'custom'): it has per-100g rates to scale by, but
    // no shared-cache identity, so it must never be cached or keyed by source.
    const custom = !!pendingFood.custom;
    const name = (pendingFood.name || '').trim();
    if (custom && !name) return null;
    return {
      id: LB.uid(), date: curDate, time: entryTime(),
      foodId: custom ? null : `${pendingFood.source}:${pendingFood.sourceId}`,
      foodName: custom ? name : pendingFood.name, brand: pendingFood.brand || null,
      source: custom ? 'custom' : pendingFood.source,
      quantityG: fdNum(qtyG), calories: qtyPreview.calories, protein: qtyPreview.protein,
      carbs: qtyPreview.carbs, fat: qtyPreview.fat, fiber: qtyPreview.fiber,
      sugar: qtyPreview.sugar, satFat: qtyPreview.satFat, sodiumMg: qtyPreview.sodiumMg,
      // The exact unit this entry was logged in (e.g. "Pc"), so a later
      // "count" view (the split sheet) reads back what was actually used
      // instead of guessing via a matching favorite's first unit.
      loggedUnit: qtyUnitIdx != null ? (pendingFood.units?.[qtyUnitIdx] || null) : null,
      createdAt: new Date().toISOString(),
    };
  }
  function buildCustomEntry() {
    const name = customName.trim();
    const p = fdNum(customP), c = fdNum(customC), f = fdNum(customF);
    const cal = fdNum(customCal);
    if (!name || p == null || c == null || f == null || cal == null) return null;
    const g = fdNum(customG);
    return {
      id: LB.uid(), date: curDate, time: entryTime(),
      foodId: null, foodName: name, brand: null, source: 'custom',
      quantityG: g != null ? g : 100, calories: Math.round(cal), protein: p, carbs: c, fat: f,
      fiber: customFib !== '' ? fdNum(customFib) : null,
      sugar: customSugar !== '' ? fdNum(customSugar) : null,
      satFat: customSatFat !== '' ? fdNum(customSatFat) : null,
      sodiumMg: customSodium !== '' ? fdNum(customSodium) : null,
      createdAt: new Date().toISOString(),
    };
  }

  // Existing favorite matching this food (by food_id for DB items, by name
  // for custom ones), or null. zane_food_logs rows only ever remember the
  // ONE unit an entry was actually logged in (loggedUnit, e.g. for the split
  // sheet); the full picker list of available units still only lives on
  // zane_food_favorites (see openEditFavorite), so this also backs the units
  // fallback in reAddFromRecent/openCustomAsScalable: a food re-opened from
  // Log/Recent still offers a matching favorite's configured portion-size
  // shortcuts instead of silently losing them.
  function matchingFavorite(foodId, foodName) {
    return (store.foodFavorites || []).find(x => foodId ? x.foodId === foodId : (x.foodId == null && x.foodName === foodName)) || null;
  }
  function existingFavId(foodId, foodName) {
    return matchingFavorite(foodId, foodName)?.id ?? null;
  }

  // Immediate favorite: tapping the star saves (or, on a second tap, removes)
  // the favorite right away, independent of whether the food ends up logged.
  // Never creates a duplicate: if the food is already a favorite, it just
  // reflects (or removes) the existing one.
  async function toggleFavorite(entry) {
    if (!entry) return;
    const already = favedId || existingFavId(entry.foodId, entry.foodName);
    if (already) {
      setFavedId(null);
      setStore(s => ({ ...s, foodFavorites: (s.foodFavorites || []).filter(f => f.id !== already) }));
    } else {
      const fav = {
        id: LB.uid(), foodId: entry.foodId, foodName: entry.foodName, brand: entry.brand,
        source: entry.source, quantityG: entry.quantityG, calories: entry.calories,
        protein: entry.protein, carbs: entry.carbs, fat: entry.fat, fiber: entry.fiber,
        sugar: entry.sugar ?? null, satFat: entry.satFat ?? null, sodiumMg: entry.sodiumMg ?? null,
        createdAt: new Date().toISOString(),
      };
      // foodFavorites.food_id is a real FK into zane_foods, but that row is
      // normally only cached once a food gets logged (see confirmLogFood).
      // Starring a food without ever logging it would otherwise sync a
      // favorite whose food_id points at nothing, failing its FK check on
      // every retry forever. Await the cache write BEFORE writing the
      // favorite into the store, so the sync batch never races ahead of it.
      if (fav.foodId) {
        const cached = await ensureFoodCached(pendingFood);
        // The whole point of awaiting above was to guarantee food_id exists
        // before the favorite does. If the cache call itself failed, writing
        // the favorite anyway just moves the FK failure into the sync queue,
        // permanently this time. Bail instead: the star silently doesn't
        // take, same as any other failed write in this screen with no retry
        // surface, rather than syncing a favorite that can never land.
        if (!cached) return;
        // Marks the still-open pendingFood cached, so confirmLogFood
        // (tapping Add right after starring, same sheet visit) sees
        // fromCache: true and skips its own redundant ensureFoodCached call
        // for the same food.
        setPendingFood(f => (f ? { ...f, fromCache: true } : f));
      }
      setFavedId(fav.id);
      setStore(s => ({ ...s, foodFavorites: [fav, ...(s.foodFavorites || [])] }));
    }
  }
  function removeFavorite(fav) {
    setStore(s => ({ ...s, foodFavorites: (s.foodFavorites || []).filter(f => f.id !== fav.id) }));
  }

  function openEditFavorite(fav) {
    setEditFavId(fav.id);
    setEditUnits(fav.units || []);
    setEditUnitNewLabel('');
    setEditUnitNewGrams('');
  }
  function closeEditFavorite() { setEditFavId(null); }
  function addEditUnit() {
    const label = editUnitNewLabel.trim();
    const grams = fdNum(editUnitNewGrams);
    if (!label || !(grams > 0)) return;
    setEditUnits(u => [...u, { label, grams }]);
    setEditUnitNewLabel('');
    setEditUnitNewGrams('');
  }
  function removeEditUnit(idx) {
    setEditUnits(u => u.filter((_, i) => i !== idx));
  }
  function saveEditFavorite() {
    const id = editFavId;
    const units = editUnits;
    setStore(s => ({
      ...s,
      foodFavorites: (s.foodFavorites || []).map(f => f.id === id ? { ...f, units } : f),
    }));
    closeEditFavorite();
  }
  // Backdrop tap used to drop a removed/added unit (and any pending new-unit
  // typing) silently, since edits here only land in the store via the
  // explicit Save button. Compared against the favorite's own stored units,
  // not "anything present", so a sheet that was simply opened and looked at
  // never false-triggers this.
  async function requestCloseEditFavorite() {
    const fav = (store.foodFavorites || []).find(f => f.id === editFavId);
    const dirty = JSON.stringify(editUnits) !== JSON.stringify(fav?.units || []) || editUnitNewLabel.trim() || editUnitNewGrams.trim();
    if (dirty && !await confirm("Your changes to these units won't be saved.", { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    closeEditFavorite();
  }

  // Stages the entry (see `staged` above) instead of committing it right
  // away, so search/favorites/recent all share the same "pick, then Add N
  // items" flow. Caching a freshly-fetched DB food still happens right here
  // though, same as before: that's independent of whether the pick ever
  // ends up committed. editingEntry (see openEditEntry) skips staging
  // entirely: an in-place fix isn't a new pick to batch, it updates the
  // existing row by id and keeps its own original date/time (buildQtyEntry
  // only knows about curDate/entryTime(), which the sheet may have opened
  // under different than whenever the entry was originally logged).
  // planned: Plan Mode status for the resulting entry. On a fresh pick it comes
  // from the Log it / Plan it button tapped; on an edit it comes from the
  // sheet's planned/logged switch (qtyEditPlanned). Defaults false so every
  // non-plan-mode caller logs exactly as before.
  async function confirmLogFood(planned = false) {
    const built = buildQtyEntry();
    if (!built) return;
    // Editing one row of a "Describe a meal" review list: write the edited
    // amount/macros back into that row and return to the list (still open
    // underneath, see mealItems' Sheet below), nothing is staged/logged yet.
    if (editingMealItemId) {
      const id = editingMealItemId;
      setMealItems(list => (list || []).map(i => i.tempId === id ? {
        tempId: id, foodName: built.foodName, quantityG: built.quantityG,
        protein: built.protein, carbs: built.carbs, fat: built.fat,
        fiber: built.fiber, sugar: built.sugar, satFat: built.satFat, sodiumMg: built.sodiumMg,
      } : i));
      closeQtySheet();
      return;
    }
    if (editingEntry) {
      // Editing an entry to Logged (qtyEditPlanned false) can be the first
      // logged entry claiming a day that carries manual Health-tab macros; warn
      // before patchDaily overwrites them, same as the checkbox flip.
      if (!qtyEditPlanned) {
        const ok = await warnIfOverwritingManualMacros(editingEntry.date);
        if (!ok) return;
      }
      const updated = { ...built, id: editingEntry.id, date: editingEntry.date, time: editingEntry.time, createdAt: editingEntry.createdAt, planned: qtyEditPlanned };
      setStore(s => {
        const nextLogs = (s.foodLogs || []).map(l => l.id === editingEntry.id ? updated : l);
        return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, updated.date, nextLogs.filter(l => l.date === updated.date)) };
      });
      closeQtySheet();
      return;
    }
    const entry = { ...built, planned };
    setStaged(list => [...list, entry]);
    // Marks pendingFood cached once this resolves (see toggleFavorite's own
    // ensureFoodCached call above), so starring then logging the same food
    // in one sheet visit, in either order, only ever fires one cache
    // request instead of one from each call site.
    //
    // food_id is a real FK into zane_foods. If the cache row never lands, the
    // sync upsert fails with 23503, and because the flush is one Promise.all
    // over every table that failure takes sessions, sets and health down with
    // it on every retry. Nothing repairs it either: the re-cache effect below
    // deliberately skips foodIds that are already logged. So drop the id when
    // the cache write failed. The macros are denormalized onto the row and the
    // FK is purely informational, so the entry itself stays intact.
    if (entry.foodId) {
      ensureFoodCached(pendingFood).then(cached => {
        if (cached) { setPendingFood(f => (f ? { ...f, fromCache: true } : f)); return; }
        setStaged(list => list.map(e => (e.id === entry.id ? { ...e, foodId: null } : e)));
      });
    }
    closeQtySheet();
  }

  function resetCustomForm() {
    setCustomName(''); setCustomG(''); setCustomP(''); setCustomC(''); setCustomF(''); setCustomFib('');
    setCustomSugar(''); setCustomSatFat(''); setCustomSodium(''); setCustomExtrasOpen(false);
    setCustomCal(''); setCustomCalTouched(false);
    setFavedId(null);
  }

  function submitCustomItem(planned = false) {
    const entry = buildCustomEntry();
    if (!entry) return;
    setStaged(list => [...list, { ...entry, planned }]);
    closeCustomSheet();
    resetCustomForm();
  }
  const customValid = customName.trim() && fdNum(customP) != null && fdNum(customC) != null && fdNum(customF) != null && fdNum(customCal) != null;

  // "Describe a meal": free text -> parse-meal edge function estimates macros
  // per item -> each becomes its own staged entry, reviewed the same way as
  // every other add path (the docked staged panel already handles quantity/
  // macro review and per-item removal, nothing bespoke needed here). Guards
  // against closing mid-request so a cancel can't silently stage items into
  // a sheet the user already thinks they backed out of.
  function closeMealDescribeSheet() {
    if (mealParsing) return;
    setMealDescribeOpen(false);
  }
  async function handleDescribeMeal() {
    const text = mealDescription.trim();
    if (!text) return;
    setMealParsing(true);
    setMealParseError(null);
    const res = await LB.parseMealText(text);
    setMealParsing(false);
    if (!res.ok) { setMealParseError(res.error); return; }
    if (!res.items.length) { setMealParseError('Could not find any food in that description. Try rephrasing, or add it manually.'); return; }
    setMealItems(res.items.map(it => ({
      tempId: LB.uid(), foodName: it.name,
      quantityG: it.quantityG, protein: it.protein, carbs: it.carbs, fat: it.fat,
      fiber: it.fiber, sugar: it.sugar, satFat: it.satFat, sodiumMg: it.sodiumMg,
    })));
    setMealDescribeOpen(false);
    setMealDescription('');
  }
  // Opens one mealItems row in the normal custom-item quantity sheet
  // (openCustomAsScalable, same one a re-logged custom entry reopens
  // through): the AI's quantity and per-100g macros are only ever a
  // starting guess, and this reuses the one place in the app that already
  // lets a guess like that be corrected (name, per-100g macros, portion)
  // instead of building a second editor. editingMealItemId routes
  // confirmLogFood's "Save" back into this row rather than staging it.
  function editMealItem(item) {
    setEditingMealItemId(item.tempId);
    setFavedId(existingFavId(null, item.foodName));
    openCustomAsScalable(item);
  }
  function removeMealItem(tempId) {
    // Nulls out (not []) once the last row is gone, so the review Sheet
    // (open={mealItems != null}) closes itself instead of lingering empty.
    setMealItems(list => {
      const next = (list || []).filter(i => i.tempId !== tempId);
      return next.length ? next : null;
    });
  }
  // Cancel/backdrop/back on the review list: same "won't be added" dirty
  // check requestLeaveFood uses for the main staged batch, scoped to just
  // this not-yet-staged meal-description batch.
  async function requestCloseMealReview() {
    const n = mealItems?.length || 0;
    if (n && !await confirm(`${n} item${n === 1 ? '' : 's'} from your description won't be added.`, { title: 'Discard items?', ok: 'Discard', cancel: 'Keep reviewing', danger: true })) return;
    setMealItems(null);
  }
  // Blocks "Log it"/"Plan it"/"Add N items" while any row is still at a 0g
  // (or otherwise missing) amount: editMealItem (via openCustomAsScalable)
  // is the only way to fix a row's quantity, an untouched 0g AI estimate
  // would otherwise commit a phantom entry with nothing to catch it, unlike
  // every sibling add path (see customValid above) which already guards this.
  const mealItemsValid = !!mealItems && mealItems.length > 0 && mealItems.every(i => i.quantityG > 0);
  // "Log it" / "Plan it" / "Add N items" on the review list: every row
  // becomes its own staged entry (same shape/destination as any other add
  // path), sharing one time/createdAt since they're all the one described
  // meal. Calories are always derived here, never trusted from the edge
  // function's own number once it's had a chance to be hand-edited.
  function commitMealItems(planned) {
    if (!mealItems || !mealItems.length) return;
    const time = entryTime();
    const now = new Date().toISOString();
    const netCarbs = !!store.settings?.netCarbs;
    const entries = mealItems.map(i => ({
      id: LB.uid(), date: curDate, time,
      foodId: null, foodName: i.foodName, brand: null, source: 'custom',
      quantityG: i.quantityG,
      calories: Math.round(LB.caloriesFromMacros(i.protein, i.carbs, i.fat, netCarbs ? i.fiber : null) || 0),
      protein: i.protein, carbs: i.carbs, fat: i.fat,
      fiber: i.fiber, sugar: i.sugar, satFat: i.satFat, sodiumMg: i.sodiumMg,
      createdAt: now, planned,
    }));
    setStaged(list => [...list, ...entries]);
    setMealItems(null);
  }
  const mealItemsTotals = useMemoFd(() => {
    const netCarbs = !!store.settings?.netCarbs;
    const list = mealItems || [];
    return {
      calories: Math.round(list.reduce((a, i) => a + (LB.caloriesFromMacros(i.protein, i.carbs, i.fat, netCarbs ? i.fiber : null) || 0), 0)),
      protein: fdRound1(list.reduce((a, i) => a + (i.protein || 0), 0)),
      carbs: fdRound1(list.reduce((a, i) => a + (i.carbs || 0), 0)),
      fat: fdRound1(list.reduce((a, i) => a + (i.fat || 0), 0)),
    };
  }, [mealItems, store.settings?.netCarbs]);

  // ── Recipes ──
  function openNewRecipe() { setRecipeEditorRecipe(null); setRecipeEditorOpen(true); }
  function editRecipe(recipe) { setRecipeEditorRecipe(recipe); setRecipeEditorOpen(true); }
  // Reached from the header's copy icon (duplicatePickerOpen), not a button
  // per row: one row per recipe times three action icons got crowded fast
  // once someone had more than a handful. Picking a recipe here confirms
  // (a long list makes a mis-tap easy) then copies it, same naming/id-
  // regeneration pattern as duplicatePlan below (meal plans). Item ids are
  // regenerated too, not just the recipe's own: they're only ever scoped to
  // their own recipe's items array, but a fresh id per copy avoids any doubt
  // about whether editing one recipe's ingredient could ever reach the other.
  async function duplicateRecipe(recipe) {
    if (!await confirm(recipe.name, { title: 'Duplicate recipe?', ok: 'Duplicate' })) return;
    const now = new Date().toISOString();
    const copy = {
      ...recipe, id: LB.uid(), name: recipe.name + ' (Copy)',
      items: (recipe.items || []).map(i => ({ ...i, id: LB.uid() })),
      createdAt: now, updatedAt: now,
    };
    setStore(s => ({ ...s, foodRecipes: [copy, ...(s.foodRecipes || [])] }));
    setDuplicatePickerOpen(false);
  }
  // RecipeEditorScreen's onSave: it owns its own draft (name/items/portions)
  // entirely locally and only ever hands back the finished shape, so saving
  // is just the usual upsert-by-id-or-prepend every other store collection
  // write in this file already does.
  function handleRecipeSave(draft) {
    const now = new Date().toISOString();
    setStore(s => {
      if (recipeEditorRecipe?.id) {
        const id = recipeEditorRecipe.id;
        return { ...s, foodRecipes: (s.foodRecipes || []).map(r => r.id === id ? { ...r, ...draft, updatedAt: now } : r) };
      }
      return { ...s, foodRecipes: [{ id: LB.uid(), ...draft, createdAt: now, updatedAt: now }, ...(s.foodRecipes || [])] };
    });
    setRecipeEditorOpen(false);
    setTab('quickadd'); setQuickTab('recipes');
  }
  // Confirmed like every other destructive action in this module (deleteEntry,
  // deletePlan, deleteSlot, even removing a single ingredient): a recipe is the
  // most expensive artifact here, it's fired from a small trash icon in a
  // scrolling list, and dropping it silently breaks "Edit amount" on every
  // already-logged entry that resolves back to it (recipeEntryLiveRecipe).
  async function deleteRecipe(recipe) {
    const n = (recipe.items || []).length;
    if (!await confirm(`${recipe.name} · ${n} ingredient${n === 1 ? '' : 's'}`, { title: 'Delete recipe?', ok: 'Delete', cancel: 'Cancel', danger: true })) return;
    setStore(s => ({ ...s, foodRecipes: (s.foodRecipes || []).filter(r => r.id !== recipe.id) }));
  }
  // ── Recipe sharing (sender side) ──
  // Creates (or refreshes) the server-side snapshot for this recipe and opens
  // the share-link Sheet below. The Sheet's own buttons hand the link to the
  // OS share sheet / clipboard IN a fresh tap: calling navigator.share right
  // here, after the RPC roundtrip, would land outside iOS Safari's transient
  // user-activation window and get rejected.
  const [shareSheet, setShareSheet] = useStateFd(null); // { recipe, status: 'busy'|'ready'|'error', url?, error?, copied? } | null
  async function openShareRecipe(recipe) {
    setShareSheet({ recipe, status: 'busy' });
    const res = await LB.createRecipeShare(recipe.id, { name: recipe.name, portions: recipe.portions || 1, items: recipe.items || [] });
    setShareSheet(cur => {
      if (!cur || cur.recipe.id !== recipe.id) return cur; // closed in the meantime
      return res.ok
        ? { recipe, status: 'ready', url: `${location.origin}${location.pathname}?share=${res.token}` }
        : { recipe, status: 'error', error: res.error || 'Could not create the share link.' };
    });
  }
  async function copyShareLink() {
    if (!shareSheet?.url) return;
    try {
      await navigator.clipboard.writeText(shareSheet.url);
      setShareSheet(cur => cur ? { ...cur, copied: true } : cur);
    } catch (_) { /* link is shown selectable in the Sheet as the manual fallback */ }
  }
  function shareShareLink() {
    if (!shareSheet?.url) return;
    navigator.share({ title: `${shareSheet.recipe.name} · Zane recipe`, url: shareSheet.url }).catch(() => {});
  }

  // Finds the live recipe a logged/recent recipe entry was built from, by
  // name (its own foodName may carry a "(chosen/total portions)" suffix, see
  // confirmRecipeLog). Returns null once the recipe has since been renamed
  // or deleted, which is how callers detect "can't reopen the portion
  // picker for this one anymore".
  function recipeEntryLiveRecipe(entry) {
    if (entry.recipeId) return (store.foodRecipes || []).find(r => r.id === entry.recipeId) || null;
    // Older entries logged before recipeId was tracked have no stable id to
    // resolve by, only this best-effort name match (wrong on a name
    // collision, but strictly better than nothing for pre-existing data).
    const baseName = entry.foodName.replace(/ \([\d.]+\/\d+\)$/, '');
    return (store.foodRecipes || []).find(r => r.name === baseName) || null;
  }

  // Opens the portions prompt (see recipeLogPrompt's Sheet further down): a
  // recipe still needs its portions chosen before it has a fixed quantity to
  // stage, same reason a DB food needs its quantity sheet first.
  function addRecipeToLog(recipe) {
    if (!(recipe.items || []).length) return;
    setRecipeLogPrompt({ recipe, mode: 'portions', chosenPortions: 1, totalPortions: recipe.portions || 1, gramsStr: '' });
  }
  // Reopens an already-logged recipe entry's own portions prompt, so bumping
  // the count up or down doesn't need a delete + re-add. A recipe entry's
  // "quantity" is portions of the whole batch, not grams of one food, so
  // this reuses the SAME Sheet addRecipeToLog opens (never the generic
  // gram-rescale quantity sheet openEditEntry uses), pre-filled with the
  // portions this entry was actually logged at and routed through
  // editingEntry so confirmRecipeLog updates it in place.
  function openEditRecipeEntry(entry) {
    const recipe = recipeEntryLiveRecipe(entry);
    if (!recipe || !(recipe.items || []).length) return;
    // A grams-mode log carries both fields frozen at log time (see
    // confirmRecipeLog's `built`); reconstruct the SAME chosen/total pair a
    // portions-mode entry would via the entry's own logged_total_portions,
    // just with the scale coming from grams/cookedWeight instead of a typed
    // portions count. Every entry made before this feature shipped has
    // neither field, so it always falls through to the portions branch below
    // unchanged.
    const gramsMode = entry.loggedCookedGrams != null && entry.loggedCookedWeightG > 0;
    const m = !gramsMode ? entry.foodName.match(/\(([\d.]+)\/([\d.]+)\)$/) : null;
    // The total-portions-at-log-time must come from the entry itself, not the
    // live recipe (recipe.portions may have changed since logging, which
    // would silently rescale this entry's macros against the wrong base).
    // Preference: the entry's own remembered total, then the "(x/y)" suffix's
    // denominator, then recipe.portions as a last-resort fallback for entries
    // logged before this field existed.
    const totalPortions = entry.loggedTotalPortions != null ? entry.loggedTotalPortions
      : m ? parseFloat(m[2])
      : (recipe.portions || 1);
    const origChosen = gramsMode ? (entry.loggedCookedGrams / entry.loggedCookedWeightG) * totalPortions
      : m ? parseFloat(m[1])
      : totalPortions;
    // Rescale from the entry's OWN frozen ingredient snapshot, not the live
    // recipe: changing the portion count of a past entry must not retroactively
    // bake in ingredient edits made to the recipe since it was logged (that
    // silently rewrote historical macros/daily totals). The stored recipeItems
    // are at origChosen scale, so rebuild a full-batch (totalPortions) item list
    // and hand THAT to the portions prompt in place of the live recipe, keeping
    // confirmRecipeLog's normal chosen/total math but sourcing it from the
    // snapshot. Legacy entries without a snapshot fall back to the live recipe.
    const snap = (entry.recipeItems && entry.recipeItems.length) ? entry.recipeItems : null;
    let promptRecipe = snap ? (() => {
      const perTotal = origChosen ? totalPortions / origChosen : 1;
      return { ...recipe, portions: totalPortions, items: snap.map(i => ({
        foodId: i.foodId ?? null, brand: i.brand ?? null,
        foodName: i.foodName,
        quantityG: (i.quantityG || 0) * perTotal,
        protein: (i.protein || 0) * perTotal,
        carbs: (i.carbs || 0) * perTotal,
        fat: (i.fat || 0) * perTotal,
        fiber: i.fiber != null ? i.fiber * perTotal : null,
        sugar: i.sugar != null ? i.sugar * perTotal : null,
        satFat: i.satFat != null ? i.satFat * perTotal : null,
        sodiumMg: i.sodiumMg != null ? i.sodiumMg * perTotal : null,
      })) };
    })() : recipe;
    // Frozen cooked weight, not the live recipe's current one (same reasoning
    // as totalPortions above): the toggle and the grams math both need to
    // read the weight this entry was actually logged against. Always a fresh
    // object, promptRecipe may still be the live recipe reference (no
    // snapshot branch above) and must never be mutated in place.
    if (gramsMode) promptRecipe = { ...promptRecipe, cookedWeightG: entry.loggedCookedWeightG };
    setEditingEntry(entry);
    setQtyEditPlanned(!!entry.planned);
    setRecipeLogPrompt({
      recipe: promptRecipe, mode: gramsMode ? 'grams' : 'portions',
      chosenPortions: origChosen, totalPortions,
      gramsStr: gramsMode ? String(entry.loggedCookedGrams) : '',
    });
  }
  // Live macro preview for the portions prompt, same scaling math
  // confirmRecipeLog itself uses (not committed until Add is actually
  // tapped), so the Stepper's live number always matches what gets logged.
  const recipeLogPreview = useMemoFd(() => {
    if (!recipeLogPrompt) return null;
    const { recipe, totalPortions } = recipeLogPrompt;
    const chosenPortions = fdEffectiveChosenPortions(recipeLogPrompt);
    const items = recipe.items || [];
    const netCarbs = !!store.settings?.netCarbs;
    const scale = chosenPortions / totalPortions;
    const sum = k => items.reduce((a, i) => a + (i[k] || 0), 0);
    return {
      calories: Math.round(fdRecipeItemsCalories(items, netCarbs) * scale),
      protein: fdRound1(sum('protein') * scale),
      carbs: fdRound1(sum('carbs') * scale),
      fat: fdRound1(sum('fat') * scale),
    };
  }, [recipeLogPrompt, store.settings?.netCarbs]);
  // Stages the recipe (see `staged` above) same as everything else, "Add N
  // items" logs it together with whatever else is picked. Still a single log
  // entry either way, just staged instead of committed straight away.
  async function confirmRecipeLog(planned = false) {
    const { recipe, totalPortions, mode, gramsStr } = recipeLogPrompt;
    const chosenPortions = fdEffectiveChosenPortions(recipeLogPrompt);
    const gramsMode = mode === 'grams' && recipe.cookedWeightG > 0;
    const gramsVal = gramsMode ? (fdNum(gramsStr) || 0) : null;
    const items = recipe.items || [];
    const netCarbs = !!store.settings?.netCarbs;
    const scale = chosenPortions / totalPortions;
    const sum = k => items.reduce((a, i) => a + (i[k] || 0), 0);
    // Snapshot at the SAME scale as the entry's own totals, so the
    // timeline's expanded ingredient list always adds back up to exactly
    // what's shown collapsed (each row still needs its own whole-number
    // kcal, so it's individually rounded here). A later edit to the source
    // recipe must never retroactively change this: copied here, not
    // referenced. foodId/brand are pure identity, not a measurement, so
    // copying them through doesn't violate that freeze, unlike the macros
    // below they're never rescaled or recomputed from a live source.
    const recipeItems = items.map(i => ({
      foodId: i.foodId ?? null, brand: i.brand ?? null,
      foodName: i.foodName, quantityG: Math.round((i.quantityG || 0) * scale),
      calories: Math.round((LB.caloriesFromMacros(i.protein, i.carbs, i.fat, netCarbs ? i.fiber : null) || 0) * scale),
      protein: fdRound1((i.protein || 0) * scale), carbs: fdRound1((i.carbs || 0) * scale), fat: fdRound1((i.fat || 0) * scale),
      fiber: i.fiber != null ? fdRound1(i.fiber * scale) : null,
      sugar: i.sugar != null ? fdRound1(i.sugar * scale) : null,
      satFat: i.satFat != null ? fdRound1(i.satFat * scale) : null,
      sodiumMg: i.sodiumMg != null ? Math.round(i.sodiumMg * scale) : null,
    }));
    const built = {
      foodId: null,
      // Grams mode names itself by the typed weight, not a converted (and
      // often unfriendly-looking) portions fraction, it's what the user
      // actually thought in terms of.
      foodName: gramsMode ? (gramsVal !== recipe.cookedWeightG ? `${recipe.name} (${gramsVal}g)` : recipe.name)
        : chosenPortions !== totalPortions ? `${recipe.name} (${chosenPortions}/${totalPortions})` : recipe.name,
      brand: null, source: 'recipe',
      // Stable id back to the source recipe, so recipeEntryLiveRecipe can
      // resolve this entry correctly even if another recipe later gets the
      // same name (a plain name match, the old fallback, can't tell them apart).
      recipeId: recipe.id,
      // The entry's own remembered total, so a later edit of this entry
      // rescales against the total at LOG time, not against whatever
      // recipe.portions has since become (see openEditRecipeEntry).
      loggedTotalPortions: totalPortions,
      // Both null unless logged in grams mode, both frozen at log time same
      // as loggedTotalPortions above, so a later edit to the recipe's own
      // cooked weight can never retroactively rescale this entry when it's
      // reopened (openEditRecipeEntry reads these back, not the live recipe).
      loggedCookedGrams: gramsVal, loggedCookedWeightG: gramsMode ? recipe.cookedWeightG : null,
      quantityG: Math.round(sum('quantityG') * scale),
      // Same expression recipeLogPreview above already showed on the
      // portions sheet (fdRecipeItemsCalories sums every ingredient's exact
      // calories and rounds once, then this scales and rounds again), NOT
      // derived from summing recipeItems' own already-rounded per-ingredient
      // calories above: guarantees the total the user saw right before
      // tapping Add is exactly what gets logged. Can differ from the sum of
      // recipeItems by a kcal in rare cases (independent per-ingredient
      // rounding vs. rounding the aggregate), the smaller and better-hidden
      // of the two possible mismatches (that sum only surfaces behind the
      // expand chevron, this total is the headline number).
      calories: Math.round(fdRecipeItemsCalories(items, netCarbs) * scale),
      protein: fdRound1(sum('protein') * scale), carbs: fdRound1(sum('carbs') * scale), fat: fdRound1(sum('fat') * scale),
      fiber: items.some(i => i.fiber != null) ? fdRound1(sum('fiber') * scale) : null,
      // Migration 0204 extras: summed only over the ingredients that report
      // them, and left null when none does, so a recipe built from foods
      // without these values does not log a fabricated zero.
      sugar: items.some(i => i.sugar != null) ? fdRound1(sum('sugar') * scale) : null,
      satFat: items.some(i => i.satFat != null) ? fdRound1(sum('satFat') * scale) : null,
      sodiumMg: items.some(i => i.sodiumMg != null) ? Math.round(sum('sodiumMg') * scale) : null,
      recipeItems,
    };
    // editingEntry (see openEditRecipeEntry) updates the existing row by id
    // and keeps its original date/time instead of staging a new one, same
    // in-place-update shape confirmLogFood uses for a non-recipe entry.
    if (editingEntry) {
      // planned/logged comes from the sheet's own switch (qtyEditPlanned,
      // seeded from the entry in openEditRecipeEntry), same as the non-recipe
      // edit path. Editing to Logged can be the first logged entry claiming a
      // day with manual Health-tab macros, so warn before patchDaily overwrites
      // them, same as commitEntries / the checkbox flip.
      if (!qtyEditPlanned) {
        const ok = await warnIfOverwritingManualMacros(editingEntry.date);
        if (!ok) return;
      }
      const updated = { ...built, id: editingEntry.id, date: editingEntry.date, time: editingEntry.time, createdAt: editingEntry.createdAt, planned: qtyEditPlanned };
      setStore(s => {
        const nextLogs = (s.foodLogs || []).map(l => l.id === editingEntry.id ? updated : l);
        return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, updated.date, nextLogs.filter(l => l.date === updated.date)) };
      });
      setEditingEntry(null);
    } else {
      setStaged(list => [...list, { id: LB.uid(), date: curDate, time: entryTime(), createdAt: new Date().toISOString(), planned, ...built }]);
      // Cooking Mode's own draft (see startCookingMode) is done once its log
      // actually commits, whichever of Plan it/Log it got tapped: this is one
      // of the wizard's two terminal outcomes, see fdClearCookingDraft's
      // other call site (CookingModeScreen's requestExit) for the other.
      if (recipeLogPrompt?.fromCookingMode) fdClearCookingDraft();
    }
    setRecipeLogPrompt(null);
  }

  // "Cook it" on the recipe log prompt (see the Sheet's own button row
  // below): hands off to CookingModeScreen for the recipe currently sitting
  // in recipeLogPrompt, instead of calling confirmRecipeLog. The amount
  // chosen on the prompt so far is simply discarded, irrelevant, the wizard
  // determines the real amount itself (per ingredient, then optionally a
  // cooked weight). recipeLogPrompt itself is left untouched (not cleared)
  // so CookingModeScreen, opened on top of it, can cleanly hand back into it
  // afterward with no flash or remount.
  async function startCookingMode() {
    if (!recipeLogPrompt) return;
    const recipe = recipeLogPrompt.recipe;
    let draft = null;
    const saved = fdReadCookingDraft();
    if (saved) {
      const fresh = saved.startedAt && (Date.now() - Date.parse(saved.startedAt)) < 24 * 60 * 60 * 1000;
      const matches = saved.recipeId === recipe.id;
      if (matches && fresh) {
        const total = (saved.items || []).length;
        const atIdx = Math.min((saved.currentIdx || 0) + 1, Math.max(total, 1));
        // saved.step matters here, not just currentIdx: once the wizard has
        // moved past the last ingredient into the cooked-weight step,
        // currentIdx stays parked at items.length - 1 (see handleNext), so
        // without this branch the confirm would misleadingly read
        // "ingredient N of N" for a draft that actually resumes straight
        // into the cooked-weight screen, past every ingredient.
        const resumeMsg = saved.step === 'cookedWeight'
          ? 'Resume cooking? You already went through every ingredient, just the cooked weight is left.'
          : `Resume cooking from ingredient ${atIdx} of ${total}?`;
        const resume = await confirm(resumeMsg, { title: 'Resume cooking?', ok: 'Continue', cancel: 'Start over' });
        if (resume) draft = saved;
      } else if (!matches && fresh) {
        // A still-fresh draft for a DIFFERENT recipe (e.g. cooking got
        // interrupted earlier and the user backed out without finishing,
        // which deliberately leaves it in place, see requestExit) would
        // otherwise get silently wiped the moment a second recipe's Cook it
        // is tapped, with no warning at all, the opposite of the "survives
        // app-kill, resumable within 24h" guarantee this draft exists for.
        const otherName = (store.foodRecipes || []).find(r => r.id === saved.recipeId)?.name || 'another recipe';
        const ok = await confirm(`You have an unfinished cook for "${otherName}". Starting this one discards it.`,
          { title: 'Discard other cook?', ok: 'Discard, start this', cancel: 'Cancel', danger: true });
        if (!ok) return;
      }
      if (!draft) fdClearCookingDraft();
    }
    setCookingMode({ recipe, draft });
  }
  // CookingModeScreen's own onFinish: Part B/C are done (either no diff to
  // confirm, or the user picked Leave/Update recipe), hand off into the
  // normal recipeLogPrompt/confirmRecipeLog machinery as the actual final
  // commit step, exactly as if a plain portions/grams amount had been typed
  // on the prompt directly. resolvedCookedWeightG falls back to the recipe's
  // own existing cookedWeightG when nothing was typed this session (never
  // erased by leaving the field blank), typedThisSession alone decides the
  // sheet's starting unit.
  function finishCookingMode(finalItems, resolvedCookedWeightG, typedThisSession) {
    const recipe = cookingMode?.recipe;
    setCookingMode(null);
    if (!recipe) return;
    setRecipeLogPrompt({
      recipe: { ...recipe, items: finalItems, cookedWeightG: resolvedCookedWeightG },
      mode: typedThisSession ? 'grams' : 'portions',
      chosenPortions: 1,
      totalPortions: recipe.portions || 1,
      gramsStr: typedThisSession ? String(resolvedCookedWeightG) : '',
      fromCookingMode: true,
    });
  }
  // "Update recipe" in CookingModeScreen's own diff confirm: same store-write
  // shape handleRecipeSave already uses, name/portions untouched.
  function updateRecipeFromCooking(recipeId, items, cookedWeightG) {
    const now = new Date().toISOString();
    setStore(s => ({ ...s, foodRecipes: (s.foodRecipes || []).map(r => r.id === recipeId ? { ...r, items, cookedWeightG, updatedAt: now } : r) }));
  }
  // A note is evergreen prep guidance, not tied to this cook's own outcome
  // the way amounts/add/swap/remove are (those stay provisional until
  // Update recipe, or vanish on Leave recipe/Cancel). CookingModeScreen only
  // calls this for an ingredient that already exists in the persisted
  // recipe unchanged (see its own saveNoteEditor), so unlike
  // updateRecipeFromCooking above this patches ONE item's note in place,
  // nothing else about the recipe (other items, amounts, cookedWeightG)
  // moves, and it fires immediately rather than waiting for the diff sheet.
  function patchRecipeItemNote(recipeId, itemId, note) {
    const now = new Date().toISOString();
    setStore(s => ({
      ...s,
      foodRecipes: (s.foodRecipes || []).map(r => r.id !== recipeId ? r : {
        ...r, updatedAt: now,
        items: (r.items || []).map(i => i.id !== itemId ? i : { ...i, note }),
      }),
    }));
  }
  // "Back" on the Cooking Mode hand-off sheet (e.g. to fix the dish weight
  // after all): reopens the wizard from the SAME draft finishCookingMode
  // left behind (that draft only ever gets cleared on an actual commit or
  // an explicit discard, see requestCloseRecipeLogPrompt/CookingModeScreen's
  // own requestCancel), no confirm needed, going back loses nothing. Reads
  // the LIVE recipe, not recipeLogPrompt.recipe (that one is a synthetic
  // snapshot merged with the wizard's own final edits), so originalItemsRef
  // inside CookingModeScreen still diffs against what is actually persisted.
  // recipeLogPrompt itself is left in place, same reasoning as
  // startCookingMode: CookingModeScreen just re-layers on top of it, and
  // backing out of the wizard again lands cleanly back on this same sheet.
  function backToCookingMode() {
    if (!recipeLogPrompt?.fromCookingMode) return;
    const recipeId = recipeLogPrompt.recipe.id;
    const recipe = (store.foodRecipes || []).find(r => r.id === recipeId);
    if (!recipe) return;
    const saved = fdReadCookingDraft();
    const draft = (saved && saved.recipeId === recipeId) ? saved : null;
    setCookingMode({ recipe, draft });
  }
  // Every other use of this Sheet (plain log, plan, edit an existing entry)
  // stays a free backdrop-tap-to-close, low stakes, a couple seconds of typing
  // to redo. Reached via Cooking Mode it is not: a whole ingredient-by-
  // ingredient walkthrough sits behind it, so a stray tap outside the sheet
  // gets a confirm instead of silently dropping back to the recipe list, and
  // confirming actually discards the draft too (see below), "Discard" that
  // quietly left something resumable behind was its own bug. Backing out via
  // the new Back button instead (not this close path) reopens the wizard
  // from that same draft, nothing here stops that.
  async function requestCloseRecipeLogPrompt() {
    if (recipeLogPrompt?.fromCookingMode) {
      const ok = await confirm('This discards the cook, nothing gets logged.',
        { title: 'Discard cooking?', ok: 'Discard', cancel: 'Keep editing', danger: true });
      if (!ok) return;
      // "Discard" has to actually mean discard: leaving the draft behind
      // here (like a plain backdrop tap on every other sheet does) meant
      // the next "Cook it" for this recipe offered to resume a session the
      // user had just explicitly thrown away.
      fdClearCookingDraft();
    }
    setRecipeLogPrompt(null);
    setEditingEntry(null);
  }

  // Shown on both add-a-food tabs (Search and Quick Add) whenever a timeline
  // hour is pending, so the target time is always visible and cancelable.
  const pendingHourBanner = pendingHour != null ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'rgba(var(--accent-rgb),0.1)', border: `var(--hair-width) solid rgba(var(--accent-rgb),0.3)`, borderRadius: 6 }}>
      <i className="fa-solid fa-clock" style={{ fontSize: 12, color: 'var(--accent)' }} />
      <span style={{ flex: 1, fontSize: 12, color: UI.ink, fontFamily: UI.fontUi }}>Logging at {String(pendingHour).padStart(2, '0')}:00</span>
      <button onClick={() => setPendingHour(null)} style={{ background: 'none', border: 'none', padding: '2px 4px', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>Now instead</button>
    </div>
  ) : null;

  const stagedTotals = useMemoFd(() => ({
    calories: Math.round(staged.reduce((a, e) => a + (e.calories || 0), 0)),
    protein: fdRound1(staged.reduce((a, e) => a + (e.protein || 0), 0)),
    carbs: fdRound1(staged.reduce((a, e) => a + (e.carbs || 0), 0)),
    fat: fdRound1(staged.reduce((a, e) => a + (e.fat || 0), 0)),
  }), [staged]);

  // Docked bar shown whenever there's a staged (picked, quantity already
  // chosen, but not yet logged) batch, on ANY tab, not just Search/Quick Add:
  // rendered unconditionally in the return below, a staged pick is still
  // part of the food module even after flipping over to Log to check
  // something, and shouldn't quietly vanish (and be forgotten) just because
  // the tab changed. Rendered OUTSIDE the scrolling Screen (see the wrapping
  // div in the return below) as a fixed, non-scrolling footer, so it never
  // scrolls out of view while paging through search results or the Quick
  // Add lists either, the exact "forgot to hit Add and lost the picks"
  // complaint this replaced: the previous version sat inline at the top of
  // the scrollable content and disappeared the moment you scrolled past it.
  // Single collapsed line by default (count, kcal + P/C/F in the same colors
  // the Log tab's hero card uses, and the Add button, all always reachable);
  // tapping it reveals the per-item review, growing upward off the docked
  // bar rather than pushing the bar itself around. Lives here rather than
  // per-tab so switching between Search and Quick Add (or over to Log and
  // back) mid-batch doesn't lose it, both (and a staged recipe, see
  // confirmRecipeLog) stage into the same shared `staged` list.
  const stagedPanel = staged.length > 0 ? (
    // Same breathing box-shadow as the Intensity sheet (.intensity-glow,
    // index.html): a live batch waiting to be added is easy to forget about
    // otherwise, the glow keeps drawing the eye back to it. Regular
    // --accent-rgb (not the -raw variant the Intensity sheet's own backdrop
    // glow uses), since this bar sits on the normal theme-reactive Screen
    // background and should mute along with everything else on Paper.
    <div className="intensity-glow" style={{ flexShrink: 0, position: 'relative', zIndex: 1, borderTop: `var(--hair-width) solid rgba(var(--accent-rgb),0.35)`, background: 'rgba(var(--bg-rgb),0.96)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
      {pickedExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 168, overflowY: 'auto', padding: '8px 14px 0' }}>
          {staged.map(e => (
            <div key={e.id} style={fdDraftRow}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ ...fdEntryName, fontSize: 12 }}>{e.foodName}</span>
                <span style={fdEntryMeta}>
                  {e.time} · {fdDisplayG(e) ? `${fdDisplayG(e)}g · ` : ''}<span className="num" style={{ color: UI.warn }}>{e.calories} kcal</span>
                  <span style={fdMetaDivider} />
                  <FdMacroBits protein={e.protein} carbs={e.carbs} fat={e.fat} />
                </span>
              </div>
              <button onClick={() => removeStaged(e.id)} aria-label="Remove" style={fdInlineDeleteBtn}>
                <i className="fa-solid fa-trash" style={{ fontSize: 11 }} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
        <button onClick={() => setPickedExpanded(v => !v)} aria-label={pickedExpanded ? 'Collapse picked items' : 'Expand picked items'}
          style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', overflow: 'hidden' }}>
          <i className={`fa-solid fa-chevron-${pickedExpanded ? 'down' : 'up'}`} style={{ fontSize: 9, color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, color: UI.ink, flexShrink: 0, whiteSpace: 'nowrap' }}>
            Adding {staged.length} item{staged.length === 1 ? '' : 's'}
          </span>
          {/* Same coloring as the Log tab's hero (FdHeroRow/FD_MACRO_COLORS):
              kcal in UI.warn, P/C/F via the shared FdMacroBits, so this bar
              reads consistently with the rest of the food module. Smaller
              (fontSize 10, same as fdEntryMeta elsewhere) and the one part
              allowed to clip on a narrow screen, so "Adding N items" and the
              Add button both stay fully readable no matter what. FdMacroBits
              itself sets no font-size, it inherits this span's, same as
              every other call site (they all sit inside an fdEntryMeta span). */}
          <span style={{ display: 'flex', alignItems: 'baseline', fontSize: 10, marginLeft: 'auto', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <span className="num" style={{ color: UI.warn, fontWeight: 600 }}>{stagedTotals.calories} kcal</span>
            <span style={fdMetaDivider} />
            <FdMacroBits protein={stagedTotals.protein} carbs={stagedTotals.carbs} fat={stagedTotals.fat} />
          </span>
        </button>
        <Btn onClick={commitStagedEntries} style={{ flexShrink: 0, padding: '8px 18px', minHeight: 34 }}>
          Add
        </Btn>
      </div>
    </div>
  ) : null;

  return (
    // Wraps Screen (which still owns TopBar/content scrolling exactly as
    // before) alongside stagedPanel as a sibling flex item instead of a
    // scrolling child, the same "scrolling area + fixed footer" split
    // app.jsx already uses for Screen + TabBar, so the picked-items bar
    // stays docked to the bottom of the FoodScreen's own space (above
    // TabBar, never overlapping it) regardless of scroll position.
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <Screen>
      {/* Day-level actions. Kept as its own sheet rather than inline chrome so
          the timeline stays about food, and so a once-a-week declaration takes
          a deliberate detour instead of sitting one tap away all the time. */}
      <Sheet open={dayMenu} onClose={() => setDayMenu(false)} title={dayLabel}>
        <button onClick={() => { setDayMenu(false); setMocSheet({ name: mocName || '', hour: mocHour }); }}
          disabled={!dayTarget}
          style={{ ...fdTemplateBtn, flexDirection: 'column', alignItems: 'stretch', gap: 8, opacity: dayTarget ? 1 : 0.45, cursor: dayTarget ? 'pointer' : 'default' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="fa-solid fa-utensils" style={{ fontSize: 13, color: 'var(--accent)' }} />
            <span style={{ flex: 1, textAlign: 'left' }}>
              {isMealOfChoice ? 'Meal of choice, set' : 'Make this a meal of choice day'}
            </span>
            <i className="fa-solid fa-chevron-right" style={{ fontSize: 11, color: UI.inkFaint }} />
          </div>
          {/* Always shown, including the first one and including zero: the point
              of a counter you dose by is that it is there before you decide, not
              only once you are already over. */}
          <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--accent)', fontFamily: UI.fontUi, lineHeight: '16px', textAlign: 'left' }}>
            {isMealOfChoice
              ? `Your ${fdOrdinal(mocWeek.ordinal)} this week.`
              : mocWeek.count === 0
                ? 'None yet this week.'
                : `${mocWeek.count} so far this week, this would be your ${fdOrdinal(mocWeek.count + 1)}.`}
          </div>
          <div style={{ fontSize: 11, fontWeight: 400, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', textAlign: 'left' }}>
            {dayTarget
              ? 'One meal takes whatever macros are left over, and the day stops being scored. Meant for the odd meal you plan around, not for a day that got away from you.'
              : 'Needs a macro target first: without one there is no budget for the meal to inherit.'}
          </div>
        </button>
        <button onClick={() => { setDayMenu(false); setStatsOpen(true); }} style={{ ...fdTemplateBtn, marginTop: 8 }}>
          <i className="fa-solid fa-chart-column" style={{ fontSize: 13, color: 'var(--accent)' }} />
          <span style={{ flex: 1, textAlign: 'left' }}>Stats</span>
          <i className="fa-solid fa-chevron-right" style={{ fontSize: 11, color: UI.inkFaint }} />
        </button>
      </Sheet>

      <Sheet open={statsOpen} onClose={() => setStatsOpen(false)} title="Stats" titleColor="var(--accent)">
        <FdStatsBody store={store} />
      </Sheet>

      {/* Naming is optional but it is the ONLY thing the coach sees: the name
          goes into the day's off-plan note, which dailyLogsWeekPrefill folds
          into the weekly check-in. The field is prefilled with whatever is
          already in that note so nothing the user wrote can be overwritten
          without them seeing it. */}
      <Sheet open={!!mocSheet} onClose={() => setMocSheet(null)} title="Meal of choice">
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '18px', marginBottom: 16 }}>
          One meal takes whatever macros are left, and the day stops being scored. Eat the rest of the day light and protein heavy, then spend what is open on this.
        </div>
        <div className="micro" style={{ marginBottom: 6 }}>When</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <button onClick={() => setMocSheet(m => ({ ...m, hour: (m.hour + 23) % 24 }))} aria-label="Earlier" style={fdIconBtn(30)}>
            <i className="fa-solid fa-minus" style={{ fontSize: 11 }} />
          </button>
          <span className="num" style={{ fontSize: 18, color: UI.ink, minWidth: 56, textAlign: 'center' }}>
            {String(mocSheet?.hour ?? mocDefaultHour).padStart(2, '0')}:00
          </span>
          <button onClick={() => setMocSheet(m => ({ ...m, hour: (m.hour + 1) % 24 }))} aria-label="Later" style={fdIconBtn(30)}>
            <i className="fa-solid fa-plus" style={{ fontSize: 11 }} />
          </button>
          <span style={{ flex: 1, fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px' }}>
            {(mealCats.find(c => (mocSheet?.hour ?? mocDefaultHour) >= c.startHour && (mocSheet?.hour ?? mocDefaultHour) < c.endHour) || {}).label || ''}
          </span>
        </div>
        <div className="micro" style={{ marginBottom: 6 }}>What is it?</div>
        <input type="text" value={mocSheet?.name ?? ''} placeholder="Pizza with the team"
          onChange={e => setMocSheet(m => ({ ...m, name: e.target.value }))}
          style={{ width: '100%', boxSizing: 'border-box', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4, padding: '9px 10px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none' }} />
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', marginTop: 6, marginBottom: 16 }}>
          Optional, and it goes in your off-plan note for the day, so your coach sees it in the weekly check-in.
        </div>
        {mocRemainder && (
          <div style={{ padding: '12px 14px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, marginBottom: 16, textShadow: 'none' }}>
            <div className="micro" style={{ marginBottom: 4 }}>Open right now</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 300, color: UI.ink, lineHeight: '24px' }}>
              {mocRemainder.calories}<span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 4 }}>kcal</span>
            </div>
            <div style={{ marginTop: 4 }}>
              <FdMacroBits protein={mocRemainder.protein} carbs={mocRemainder.carbs} fat={mocRemainder.fat} />
            </div>
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', marginTop: 6 }}>
              This keeps updating as you log the rest of the day. It is frozen when you tick the meal off.
            </div>
          </div>
        )}
        {mocWeek.count > 0 && !isMealOfChoice && (
          <div style={{ fontSize: 11, color: UI.warn, fontFamily: UI.fontUi, lineHeight: '16px', marginBottom: 16 }}>
            That would be your {mocWeek.count + 1}. this week. Your call, the app only counts.
          </div>
        )}
        {/* Once the meal is CONFIRMED it is an ordinary logged entry, and Save
            here only rewrites the day marker: the entry's own time and name
            stay as they were. Saying so beats silently ignoring half of what
            this sheet lets you edit. */}
        {isMealOfChoice && mocEntry && (
          <div style={{ fontSize: 11, color: UI.warn, fontFamily: UI.fontUi, lineHeight: '16px', marginBottom: 12 }}>
            This meal is already logged. Editing the time or name here only changes the day marker, edit the entry itself in the timeline.
          </div>
        )}
        <Btn onClick={() => { setMealOfChoice(true, mocSheet?.name, mocSheet?.hour ?? mocDefaultHour); setMocSheet(null); }} style={{ width: '100%' }}>
          {isMealOfChoice ? 'Save' : 'Mark this day'}
        </Btn>
        {isMealOfChoice && (
          <Btn kind="ghost" onClick={() => { setMealOfChoice(false); setMocSheet(null); }} style={{ width: '100%', marginTop: 10 }}>
            Remove the marker
          </Btn>
        )}
      </Sheet>
      {confirmEl}
      <TopBar title="Food" sub={dayLabel} onBack={requestLeaveFood}
        right={
          tab === 'quickadd' && quickTab === 'recipes' && (store.foodRecipes || []).length > 0 ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setDuplicatePickerOpen(true)} aria-label="Duplicate a recipe" style={fdTopAddBtn}>
                <i className="fa-solid fa-copy" style={{ fontSize: 13 }} />
              </button>
              <button onClick={openNewRecipe} aria-label="New recipe" style={fdTopAddBtn}>
                <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
              </button>
            </div>
          ) : tab === 'log' ? (
            // Day-level actions. Screenshot and multi-select need something to
            // act on, but the overflow and shopping list must not: a
            // meal-of-choice day is a morning decision made before anything is
            // logged, and the shopping list is a standalone feature that
            // draws on history/plan data, independent of today's entries.
            <div style={{ display: 'flex', gap: 8 }}>
              {dayEntries.length > 0 && (
                <button onClick={takeScreenshot} disabled={capturing} aria-label="Share food log as image" style={{ ...fdTopAddBtn, cursor: capturing ? 'default' : 'pointer', color: capturing ? UI.inkGhost : UI.inkSoft }}>
                  {capturing ? <span style={{ fontFamily: UI.fontUi, fontSize: 10 }}>…</span> : <i className="fa-solid fa-camera" style={{ fontSize: 13 }} />}
                </button>
              )}
              <button onClick={() => setShoppingOpen(true)} aria-label="Shopping list" style={fdTopAddBtn}>
                <i className="fa-solid fa-basket-shopping" style={{ fontSize: 13 }} />
              </button>
              <button onClick={() => setDayMenu(true)} aria-label="Day options" style={fdTopAddBtn}>
                <i className="fa-solid fa-ellipsis-vertical" style={{ fontSize: 14 }} />
              </button>
              {dayEntries.length > 0 && (
                <button onClick={openCopyMove} aria-label="Select entries" style={fdTopAddBtn}>
                  <i className="fa-solid fa-list-check" style={{ fontSize: 13 }} />
                </button>
              )}
            </div>
          ) : undefined
        } />

      {/* Food log poster: hero + every category that has entries, empty
          categories and empty hours dropped entirely (unlike the live
          timeline below, which always renders all 24 hours so "+" stays
          reachable everywhere). Always mounted, only ever hidden via
          display:none, never conditionally rendered on `capturing` itself:
          captureNodeAsPng only flips capturing to true AFTER checking
          captureRef.current is non-null, so if this tree were gated on
          `capturing` the ref would still be null at that exact check (same
          reasoning as the Plan poster, screens-schedule.jsx). No drag
          handles, +, or edit/delete/chevron buttons: this is a static
          image, not another interactive surface. */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: UI.bg, overflow: 'auto', display: capturing ? 'block' : 'none' }}>
        <div ref={captureRef} style={{ padding: '26px 28px 32px', width: 480, margin: '0 auto', position: 'relative' }}>
          {_shotGridOn && <SvgGrid />}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
            <img src={_shotLogo} data-shot-avatar="1" style={_shotIsCustom ? _shotCustomStyle : _shotDefaultStyle} />
          </div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ height: 'var(--hair-width)', background: UI.gold, marginBottom: 16 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="display" style={{ fontSize: 24, color: UI.gold, lineHeight: '26px' }}>Food Log</div>
                <div className="micro" style={{ marginTop: 4 }}>{dayLabel}</div>
              </div>
              <div className="micro-gold" style={{ letterSpacing: '0.18em', marginTop: 2, flexShrink: 0, marginLeft: 12 }}>ZANE</div>
            </div>

            <BracketFrame gold style={{ padding: 20, marginTop: 16 }}>
              <FdHeroContent dayTarget={dayTarget} dayAdherence={dayAdherence} dayTotals={dayTotals} goalCalories={goalCalories}
                unscored={isMealOfChoice ? 'Meal of choice' : null} />
            </BracketFrame>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
              {posterCategories.map(cat => (
                <div key={cat.id}>
                  {/* Translucent surface-tint fill (not fdCategoryCard's
                      opaque one), same reason the Plan poster's day cards
                      use var(--surface-tint-lg) instead of a solid
                      background: an opaque card blocks the watermark
                      entirely wherever it sits, leaving it visible only in
                      the thin gaps between cards. textShadow explicitly
                      restored to the inherited lift (fdCategoryCard resets
                      it to 'none' for its own opaque-background reason,
                      which no longer applies once the fill is translucent). */}
                  <div style={{ ...fdCategoryCard, background: 'var(--surface-tint-lg)', textShadow: 'var(--text-lift)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi }}>{cat.label}</div>
                      <span style={fdEntryMeta}>{String(cat.startHour).padStart(2, '0')}:00 - {String(cat.endHour % 24).padStart(2, '0')}:00</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="num" style={{ fontSize: 14, color: UI.warn }}>{cat.calories} kcal</div>
                      <span style={fdEntryMeta}><FdMacroBits protein={cat.protein} carbs={cat.carbs} fat={cat.fat} strong /></span>
                    </div>
                  </div>
                  <div style={{ position: 'relative', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <FdHourTrunk />
                    {cat.hours.map(({ hour, entries }) => (
                      <div key={hour} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <FdHourTick />
                        <div style={fdHourLabelCol}>
                          <span className="num" style={{ fontSize: 11, color: UI.inkSoft }}>{String(hour).padStart(2, '0')}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {entries.map(e => (
                            <div key={e.id} style={{ ...fdEntryCard, background: 'var(--surface-tint-md)', textShadow: 'var(--text-lift)',
                              ...(e.moc ? { border: `var(--hair-width) dashed var(--hair-accent)` } : null) }}>
                              {e.moc && <div className="micro-gold">Meal of choice</div>}
                              <span style={fdEntryName}>{e.foodName}</span>
                              <span style={fdEntryMeta}>
                                {fdDisplayG(e) ? `${fdDisplayG(e)}g · ` : ''}<span className="num" style={{ color: UI.warn }}>{e.calories} kcal</span>
                                <span style={fdMetaDivider} />
                                <FdMacroBits protein={e.protein} carbs={e.carbs} fat={e.fat} />
                                {e.moc ? ' left for it' : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <SubTabBar tabs={FD_TABS} active={tab} onChange={onTabChange} />

      <div style={{ padding: '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {tab === 'log' && (
          <>
            {/* Day nav: unbounded both ways, no reason to cap it now that curDate
                lazy-fetches outside the boot window. Forward isn't capped at
                today either: Plan Mode needs to plan ahead, not just log the
                past. Calendar button jumps straight to a date instead of
                stepping one day at a time (same icon-button + overlaid
                invisible date input idiom Health uses, for iOS compat: a
                native picker needs a real <input type="date"> under the tap,
                can't be opened from a plain button). */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button onClick={() => shiftDay(-1)} aria-label="Previous day" style={fdNavBtn(false)}>
                <i className="fa-solid fa-chevron-left" style={{ fontSize: 12 }} />
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>{dayLabel}</div>
                <div style={{ position: 'relative', width: 26, height: 26, flexShrink: 0 }}>
                  <button aria-label="Jump to date" style={fdIconBtn(26)}>
                    <i className="fa-solid fa-calendar-day" style={{ fontSize: 12 }} />
                  </button>
                  <input type="date" value={curDate}
                    onChange={e => e.target.value && setCurDate(e.target.value)}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                  />
                </div>
              </div>
              <button onClick={() => shiftDay(1)} aria-label="Next day" style={fdNavBtn(false)}>
                <i className="fa-solid fa-chevron-right" style={{ fontSize: 12 }} />
              </button>
            </div>

            {/* Totals hero: same BracketFrame-gold hero Water uses for its own
                daily total. The dense ring+rows+composition layout only
                appears once a macro target is resolvable (personal or coach
                macros); with no target set it's just the bare total and the
                macro chips, same as before there was anything to compare
                against. */}
            <BracketFrame gold style={{ padding: 20 }}>
              <FdHeroContent dayTarget={dayTarget} dayAdherence={dayAdherence} dayTotals={dayTotals} goalCalories={goalCalories}
                projected={planMode && plannedEntries.length ? projectedTotals : null}
                projectedAdherence={projectedAdherence}
                unscored={isMealOfChoice ? 'Meal of choice' : null}
                // Health is an independently-toggleable tab now: only route into
                // it if it's actually enabled, else Home is the safe fallback.
                onSetTargets={() => go(store.settings?.showHealthTab ? { name: 'health', openMacroTargets: true } : { name: 'home' })} />
            </BracketFrame>


            {/* Sugar / saturated fat / sodium for the day (migration 0204).
                Deliberately OUTSIDE the hero frame and folded away: they are
                not scored, have no target, and the hero's job is the four
                numbers that do drive adherence. Hidden entirely on a day where
                nothing reports them (everything logged before 0204). */}
            {dayHasExtras && (
              <div>
                <FdExtrasToggle open={extrasOpen} onToggle={() => setExtrasOpen(o => !o)} style={{ marginBottom: extrasOpen ? 8 : 0 }} />
                {extrasOpen && (
                  <>
                    <FdExtrasRow sugar={dayTotals.sugar} satFat={dayTotals.satFat} sodiumMg={dayTotals.sodiumMg} />
                    {dayTotals.extrasPartial && (
                      <div className="micro" style={{ marginTop: 6, lineHeight: '14px' }}>
                        Partial: some of today's entries carry no value for these.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {planMode && (
              <button onClick={() => setTemplateOpen(true)} style={fdTemplateBtn}>
                <i className="fa-regular fa-calendar-check" style={{ fontSize: 13, color: 'var(--accent)' }} />
                <span style={{ flex: 1, textAlign: 'left' }}>Meal plans</span>
                <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
                  {(store.foodMealPlans || []).find(p => p.id === store.activeMealTemplateId)?.name || ''}
                </span>
                <i className="fa-solid fa-chevron-right" style={{ fontSize: 11, color: UI.inkFaint }} />
              </button>
            )}

            {/* Hourly timeline: every hour 0-23 has a "+" that logs at exactly
                that hour, with its entries listed underneath, grouped under a
                read-only per-meal summary card (LB.mealCategories). Adding
                still only ever happens through an hour's own "+", the
                category card itself has no tap target. The category card
                sits full-width; only its hour rows are indented, with a
                tree-style trunk line (FdHourTrunk, spanning the whole
                indented block) and a short branch tick per row (FdHourTick)
                connecting each one back to the trunk, so the card visually
                reads as the root of the hours below it.
                Already-logged entries are drag-reorderable across the WHOLE
                day (UI.useDragReorder, same engine as health-card/plan-item
                reordering elsewhere), re-houring an entry to wherever it's
                dropped instead of just permuting a list: see timelineSlots/
                handleTimelineReorder. Every hour, filled or empty, carries
                data-reorder-item so the drop-line has somewhere to land even
                on an hour with nothing logged yet; only the entry rows
                themselves (not the hour label or "+") can start a drag. */}
            <div>
              <Bezel style={{ marginBottom: 10 }}>Timeline</Bezel>
              <div ref={timelineDragRef} data-reorder-list="true" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {timelineGroups.map(cat => (
                  <div key={cat.id}>
                    {cat.label && (
                      <div style={fdCategoryCard}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi }}>{cat.label}</div>
                          <span style={fdEntryMeta}>{String(cat.startHour).padStart(2, '0')}:00 - {String(cat.endHour % 24).padStart(2, '0')}:00</span>
                        </div>
                        {/* Only offered where it can't be a mistake: this meal
                            slot is empty today and yesterday's is not. Once
                            anything is logged here the button is gone, so the
                            card goes back to being a pure read-only summary. */}
                        {cat.count === 0 && (prevDayByCategory[cat.id] || []).length > 0 ? (
                          <button className="micro-gold" onClick={() => openRepeatYesterday(cat)} style={{
                            display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
                            padding: '4px 0', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                          }}>
                            <i className="fa-solid fa-rotate-left" style={{ fontSize: 10 }} />
                            Repeat yesterday
                          </button>
                        ) : (
                          <div style={{ textAlign: 'right' }}>
                            <div className="num" style={{ fontSize: 14, color: UI.warn }}>{cat.calories} kcal</div>
                            <span style={fdEntryMeta}><FdMacroBits protein={cat.protein} carbs={cat.carbs} fat={cat.fat} strong /></span>
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ position: 'relative', marginTop: cat.label ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <FdHourTrunk />
                      {Array.from({ length: cat.endHour - cat.startHour }, (_, i) => cat.startHour + i).map(h => {
                        const es = byHour[h] || [];
                        // The meal of choice sits in the timeline like any
                        // other meal, in its category at its hour, instead of
                        // a card above it: it used to live in one place while
                        // unconfirmed and jump to another once ticked off.
                        // Derived, not a stored row, so nothing here is a real
                        // entry until it is confirmed.
                        const showMoc = isMealOfChoice && !mocEntry && h === mocHour;
                        const filled = es.length > 0 || showMoc;
                        // Only today has a "current hour" to mark; a backdated day's
                        // timeline stays plain. Local wall-clock hour (getHours()),
                        // matching the user's own timezone, same as entryTime()/
                        // LB.nowHHMM() already do for the "log at now" default.
                        const isNow = curDate === today && h === new Date().getHours();
                        return (
                          <div key={h} style={{ display: 'flex', alignItems: 'center' }}>
                            <FdHourTick />
                            <div style={{ ...fdHourRow(filled, isNow), flex: 1, minWidth: 0 }}>
                              <div data-reorder-ignore="true" style={fdHourLabelCol}>
                                <span className="num" style={{ fontSize: 11, fontWeight: isNow ? 700 : 400, color: isNow ? 'var(--accent)' : (filled ? UI.inkSoft : UI.inkGhost) }}>{String(h).padStart(2, '0')}</span>
                              </div>
                              {/* alignSelf: stretch (this column, and the empty-hour
                                  placeholder's flex: 1 below) makes the data-reorder-item
                                  element's own rect span the row's full height instead of
                                  shrink-wrapping its content and sitting centered within a
                                  taller row (fdHourRow's alignItems: center). An empty hour's
                                  placeholder was 1px tall, centered in a ~40-46px row: its
                                  actual drop-hittable area was a sliver around that single
                                  pixel, not the row a user sees and aims for. */}
                              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'stretch' }}>
                                {filled ? es.map(e => {
                                  // A recipe entry's own row expands to its ingredient
                                  // snapshot (recipeItems, see confirmRecipeLog); any
                                  // other entry's row is instead tap-to-edit, reopening
                                  // the scalable quantity sheet on its current values
                                  // (openEditEntry) for fixing a typo without a delete +
                                  // re-add. A recipe's "quantity" is really portions of
                                  // the whole batch, which that sheet's per-100g scaling
                                  // doesn't model, so it gets its own portions-only edit
                                  // instead (openEditRecipeEntry, the pencil button
                                  // below), gated on the source recipe still existing.
                                  // hasRecipeItems separately gates the chevron/expand
                                  // (recipe_items shipped after some entries were already
                                  // logged, so older recipe rows have no snapshot to show,
                                  // but can still be portion-edited).
                                  const isRecipe = e.source === 'recipe';
                                  const hasRecipeItems = isRecipe && e.recipeItems?.length > 0;
                                  const expanded = expandedEntryIds.has(e.id);
                                  // Expanded, the ingredient tree joins the SAME card the
                                  // header sits in (fdEntryCard), not a separate loose list
                                  // underneath: one continuous bordered surface, header on
                                  // top, ingredients branching off a trunk line below it
                                  // (FdIngredientTrunk/Tick), same idiom as the timeline's
                                  // own hour-row tree (FdHourTrunk/Tick).
                                  // Plan Mode: a planned (not-yet-eaten) entry
                                  // reads as a dashed, muted card. Its checkbox
                                  // (empty accent box) is checked off to mark it
                                  // eaten (planned -> logged); a logged entry
                                  // shows the same box filled. Secondary actions
                                  // (edit, ingredients, delete) live in the
                                  // overflow menu, so the row stays narrow.
                                  const isPlanned = !!e.planned;
                                  return (
                                    <div key={e.id} data-reorder-item="true" style={isPlanned ? { ...fdEntryCard, borderStyle: 'dashed', borderColor: UI.hairStrong, background: 'transparent' } : fdEntryCard}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <DragHandle style={{ width: 14, height: 22, marginRight: 2 }} />
                                        {planMode && (
                                          <FdCheckbox checked={!isPlanned} onToggle={() => setEntryPlanned(e, !isPlanned)} />
                                        )}
                                        <div
                                          onClick={() => { if (hasRecipeItems) toggleEntryExpanded(e.id); else if (!isRecipe) openEditEntry(e); }}
                                          style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1, cursor: (hasRecipeItems || !isRecipe) ? 'pointer' : 'default', opacity: isPlanned ? 0.7 : 1 }}
                                        >
                                          <span style={fdEntryName}>{e.foodName}</span>
                                          <span style={fdEntryMeta}>
                                            {fdDisplayG(e) ? `${fdDisplayG(e)}g · ` : ''}<span className="num" style={{ color: UI.warn }}>{e.calories} kcal</span>
                                            <span style={fdMetaDivider} />
                                            <FdMacroBits protein={e.protein} carbs={e.carbs} fat={e.fat} />
                                          </span>
                                        </div>
                                        <button data-reorder-ignore="true" onClick={() => setEntryMenu(e)} aria-label="More actions" style={fdInlineDeleteBtn}>
                                          <i className="fa-solid fa-ellipsis-vertical" style={{ fontSize: 14 }} />
                                        </button>
                                      </div>
                                      {hasRecipeItems && expanded && (
                                        <div style={{ position: 'relative', marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                          <FdIngredientTrunk />
                                          {fdSortIngredientsByQty(e.recipeItems).map((ri, i) => (
                                            <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                                              <FdIngredientTick />
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                                                <span style={{ ...fdEntryName, fontSize: 11, fontWeight: 500 }}>{ri.foodName}</span>
                                                <span style={fdEntryMeta}>
                                                  {ri.quantityG}g · <span className="num" style={{ color: UI.warn }}>{ri.calories} kcal</span>
                                                  <span style={fdMetaDivider} />
                                                  <FdMacroBits protein={ri.protein} carbs={ri.carbs} fat={ri.fat} />
                                                </span>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                }) : (showMoc ? null : <div data-reorder-item="true" data-reorder-ignore="true" style={{ flex: 1 }} />)}
                                {showMoc && (
                                  // Only this row's own hour still needs a reorder
                                  // slot when there's nothing else logged here (see
                                  // the empty-hour placeholder above, whose slot this
                                  // row takes over in that case): timelineSlots pushes
                                  // exactly one {entry:null} for an hour with no real
                                  // entries, and the DOM has to carry exactly one
                                  // matching data-reorder-item or every later hour's
                                  // drag index drifts by one. When es is non-empty the
                                  // real entries already supply that hour's slot(s), so
                                  // this row must NOT add a second one on top.
                                  <div data-reorder-ignore="true" data-reorder-item={es.length === 0 ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    {/* The shared checkbox, not a lookalike: its
                                        plan-mode gate lives at the entry call site,
                                        not inside it, so this row can render it
                                        unconditionally and still look like every
                                        other tickable row. */}
                                    <FdCheckbox checked={false} onToggle={confirmMealOfChoice} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div className="micro-gold">
                                        Meal of choice{mocWeek.ordinal > 1 ? ` #${mocWeek.ordinal} this week` : ''}
                                      </div>
                                      <div style={fdEntryName}>{mocName || 'Not named yet'}</div>
                                      <span style={fdEntryMeta}>
                                        {mocRemainder && mocRemainder.calories > 0
                                          ? <><span className="num" style={{ color: UI.warn }}>{mocRemainder.calories} kcal</span>{' · '}
                                              <FdMacroBits protein={mocRemainder.protein} carbs={mocRemainder.carbs} fat={mocRemainder.fat} />
                                              {' left for it'}</>
                                          : 'Budget spent, log it normally'}
                                      </span>
                                    </div>
                                    <button onClick={() => setMocSheet({ name: mocName || '', hour: mocHour })} aria-label="Edit meal of choice" style={fdIconBtn(30)}>
                                      <i className="fa-solid fa-pen" style={{ fontSize: 11 }} />
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div data-reorder-ignore="true" style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                                <button onClick={() => addAtHour(h)} aria-label={`Add food at ${String(h).padStart(2, '0')}:00`} style={fdHourAddBtn(isNow)}>
                                  <i className="fa-solid fa-plus" style={{ fontSize: 11 }} />
                                </button>
                                {/* Once this hour stacks more than one item (a
                                    meal-prep batch logged/planned all at one hour but
                                    really eaten at different times, splittable across
                                    hours without retyping every item's amount), OR it's
                                    itself the result of an earlier split (down to a
                                    single item by now, but still the only way back to
                                    "Undo Split" for it). */}
                                {(es.length > 1 || es.some(e => e.splitBatch)) && (
                                  <button onClick={() => openSplit(h)} aria-label={`Split ${String(h).padStart(2, '0')}:00 into multiple meals`} style={fdHourAddBtn(isNow)}>
                                    <i className="fa-solid fa-arrows-split-up-and-left" style={{ fontSize: 11 }} />
                                  </button>
                                )}
                                {/* Mirror of Split: folds this stack into one
                                    recipe-shaped entry instead of fanning one
                                    entry out. Only offered to actually START
                                    that (2+ items); undoing an existing one
                                    reuses the Split button/sheet above. */}
                                {es.length > 1 && (
                                  <button onClick={() => openBlockRecipe(h)} aria-label={`Create a recipe from ${String(h).padStart(2, '0')}:00`} style={fdHourAddBtn(isNow)}>
                                    <i className="fa-solid fa-bowl-food" style={{ fontSize: 11 }} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'search' && (
          <>
            {pendingHourBanner}
            <div>
              <Bezel style={{ marginBottom: 10 }}>Search</Bezel>
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 10 }}>
                {FD_SOURCE_FILTERS.map(f => (
                  <button key={f.label} onClick={() => setSourceFilter(f.id)} style={fdSegBtn(sourceFilter === f.id)}>{f.label}</button>
                ))}
              </div>
              {sourceFilter === 'zane' && (
                <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 10, lineHeight: 1.4 }}>
                  Searches only foods already added by you or another user before, instant, no external lookup.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ position: 'relative', width: '100%' }}>
                  <input value={query} onChange={e => setQueryAndReset(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
                    type="text" placeholder="Search food, or scan →" style={{ ...fdInputStyle, paddingRight: 32 }} />
                  {query && (
                    <button onClick={() => setQueryAndReset('')} aria-label="Clear search" style={fdClearBtn}>
                      <i className="fa-solid fa-circle-xmark" style={{ fontSize: 15 }} />
                    </button>
                  )}
                </div>
                <button onClick={() => setScanPickerOpen(true)} aria-label="Scan barcode or nutrition label" style={fdSearchBtn}>
                  <i className="fa-solid fa-barcode" style={{ fontSize: 14 }} />
                </button>
                <button onClick={() => runSearch()} disabled={searching || !query.trim()} aria-label="Search" style={fdSearchBtn}>
                  {searching ? <span style={{ fontFamily: UI.fontUi, fontSize: 11 }}>…</span> : <i className="fa-solid fa-magnifying-glass" style={{ fontSize: 13 }} />}
                </button>
              </div>
              {labelError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginTop: 8, lineHeight: '16px' }}>{labelError}</div>}
            </div>

            {/* Skips search entirely: a home-cooked plate with several vague-
                portion parts (a slice of this, one of that) rarely has a
                single matching database entry anyway. */}
            <button onClick={() => { setMealParseError(null); setMealDescription(''); setMealDescribeOpen(true); }} style={{ ...fdActionCard, width: '100%' }}>
              <i className="fa-solid fa-wand-magic-sparkles" style={{ fontSize: 14 }} />
              <span>Describe a meal</span>
            </button>

            {searchError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi }}>{searchError}</div>}

            {/* Only offered once a search has actually come up short (or the
                user wants to add something regardless): before searching, there
                is no way to know it isn't in the database yet. */}
            {results != null && (
              <div>
                <Bezel style={{ marginBottom: 10 }}>Results{results.length ? ` (${results.length})` : ''}</Bezel>
                {results.length === 0 ? (
                  barcodeMiss ? (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ ...fdEmptyHint, paddingBottom: 10 }}>
                        Barcode {barcodeMiss} is not in the database yet. Photograph the nutrition label instead and the values get read off it.
                      </div>
                      <button onClick={() => { setLabelError(null); labelInputRef.current && labelInputRef.current.click(); }} style={{ ...fdActionCard, width: '100%' }}>
                        <i className="fa-solid fa-camera" style={{ fontSize: 14 }} />
                        <span>Scan the nutrition label</span>
                      </button>
                    </div>
                  ) : (
                    <div style={fdEmptyHint}>No matches. Try a different search.</div>
                  )
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {results.map(r => {
                      // kcalPer100g is DERIVED from the macros (4/4/9, see the
                      // search-foods Edge Function), so null there means the
                      // source carries no usable nutrition at all, not just a
                      // missing energy value. Such a hit used to be tappable
                      // and quietly logged a 0 kcal / 0 macro entry into the
                      // day's totals and its adherence. The row stays visible
                      // (it still confirms the product exists) but is inert.
                      const noData = r.kcalPer100g == null;
                      return (
                        <button key={`${r.source}:${r.sourceId}`} onClick={() => pickResult(r)} disabled={noData}
                          style={{ ...fdResultRow, ...(noData ? { cursor: 'default', opacity: 0.55 } : null) }}>
                          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                              {r.cached && <i className="fa-solid fa-circle-check" style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }} title="In the shared food database" />}
                              <div style={{ ...fdEntryName, minWidth: 0 }}>{r.name}</div>
                            </div>
                            {r.brand && <div style={fdEntryMeta}>{r.brand}</div>}
                            {!noData && (
                              <div style={{ ...fdEntryMeta, marginTop: 3 }}>
                                <FdMacroBits protein={r.proteinPer100g || 0} carbs={r.carbsPer100g || 0} fat={r.fatPer100g || 0} />
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            {noData
                              ? <div style={fdEntryMeta}>No nutrition data</div>
                              : <div className="num" style={{ fontSize: 12, color: UI.warn }}>{Math.round(r.kcalPer100g)} kcal</div>}
                            <div style={fdEntryMeta}>{noData ? '' : '/100g · '}{r.source === 'off' ? 'Open Food Facts' : 'USDA'}{r.cached ? ' · cached' : ''}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                <button onClick={() => { setLabelError(null); resetCustomForm(); setCustomOpen(true); }} style={{ ...fdActionCard, width: '100%' }}>
                  <i className="fa-solid fa-keyboard" style={{ fontSize: 14 }} />
                  <span>Add manually</span>
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'quickadd' && (
          <>
            {pendingHourBanner}
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
              {FD_QUICK_TABS.map(t => (
                <button key={t.id} onClick={() => onQuickTabChange(t.id)} style={fdSegBtn(quickTab === t.id)}>{t.label}</button>
              ))}
            </div>

            <div style={{ position: 'relative', width: '100%' }}>
              <input value={quickQuery} onChange={e => setQuickQuery(e.target.value)} type="text"
                placeholder={`Search ${FD_QUICK_TABS.find(t => t.id === quickTab)?.label.toLowerCase() || ''}`}
                style={{ ...fdInputStyle, paddingRight: 32 }} />
              {quickQuery && (
                <button onClick={() => setQuickQuery('')} aria-label="Clear search" style={fdClearBtn}>
                  <i className="fa-solid fa-circle-xmark" style={{ fontSize: 15 }} />
                </button>
              )}
            </div>

            {quickTab === 'recent' && (
              recentFoodsAll.length === 0 ? (
                <div style={fdEmptyHint}>Nothing logged yet. Foods you add show up here.</div>
              ) : recentFoods.length === 0 ? (
                <div style={fdEmptyHint}>No matches for "{quickQuery}".</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recentFoods.map(l => (
                    <button key={l.id} onClick={() => reAddFromRecent(l)} style={fdResultRow}>
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          {l.foodId && <i className="fa-solid fa-circle-check" style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }} title="In the shared food database" />}
                          <div style={{ ...fdEntryName, minWidth: 0 }}>{l.foodName}</div>
                        </div>
                        {l.brand && <div style={fdEntryMeta}>{l.brand}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div className="num" style={{ fontSize: 12, color: UI.warn }}>{l.calories} kcal</div>
                        <div style={fdEntryMeta}>{l.quantityG}g</div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}

            {quickTab === 'favorites' && (
              (store.foodFavorites || []).length === 0 ? (
                <div style={fdEmptyHint}>No favorites yet. Star a food while adding it to save it here.</div>
              ) : favoritesFiltered.length === 0 ? (
                <div style={fdEmptyHint}>No favorites match "{quickQuery}".</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {favoritesFiltered.map(f => (
                    <div key={f.id} style={fdQuickRowWrap}>
                      <button onClick={() => reAddFromRecent(f)} style={fdQuickRowInner}>
                        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            {f.foodId && <i className="fa-solid fa-circle-check" style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }} title="In the shared food database" />}
                            <div style={{ ...fdEntryName, minWidth: 0 }}>{f.foodName}</div>
                          </div>
                          {f.brand && <div style={fdEntryMeta}>{f.brand}</div>}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div className="num" style={{ fontSize: 12, color: UI.warn }}>{f.calories} kcal</div>
                          <div style={fdEntryMeta}>{f.quantityG}g</div>
                        </div>
                      </button>
                      <button onClick={() => openEditFavorite(f)} aria-label="Edit units" style={fdSideBtn}>
                        <i className="fa-solid fa-pen" style={{ fontSize: 12, color: f.units?.length > 0 ? 'var(--accent)' : UI.inkSoft }} />
                      </button>
                      <button onClick={() => removeFavorite(f)} aria-label="Remove favorite" style={fdSideBtn}>
                        <i className="fa-solid fa-star" style={{ fontSize: 13, color: UI.gold }} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}

            {quickTab === 'recipes' && (
              (store.foodRecipes || []).length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
                  <div style={fdEmptyHint}>No recipes yet. Build one from a few ingredients you log together often.</div>
                  <Btn onClick={openNewRecipe} style={{ width: '100%' }}>
                    <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> New recipe
                  </Btn>
                </div>
              ) : recipesFiltered.length === 0 ? (
                <div style={fdEmptyHint}>No recipes match "{quickQuery}".</div>
              ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {recipesFiltered.map(r => {
                      const items = r.items || [];
                      const kcal = fdRecipeItemsCalories(items, !!store.settings?.netCarbs);
                      return (
                        <div key={r.id} style={fdQuickRowWrap}>
                          <button onClick={() => addRecipeToLog(r)} style={fdQuickRowInner}>
                            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                              <div style={fdEntryName}>{r.name}</div>
                              <div style={fdEntryMeta}>
                                {items.length} ingredient{items.length === 1 ? '' : 's'}
                                <span style={fdMetaDivider} />
                                <FdMacroBits
                                  protein={items.reduce((a, i) => a + (i.protein || 0), 0)}
                                  carbs={items.reduce((a, i) => a + (i.carbs || 0), 0)}
                                  fat={items.reduce((a, i) => a + (i.fat || 0), 0)} />
                              </div>
                            </div>
                            <div className="num" style={{ fontSize: 12, color: UI.warn, flexShrink: 0 }}>{kcal} kcal</div>
                          </button>
                          <button onClick={() => editRecipe(r)} aria-label="Edit recipe" style={fdSideBtn}>
                            <i className="fa-solid fa-pen" style={{ fontSize: 12 }} />
                          </button>
                          <button onClick={() => deleteRecipe(r)} aria-label="Delete recipe" style={fdSideBtn}>
                            <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
              )
            )}
          </>
        )}
      </div>

      {/* ── Quantity sheet ── */}
      {/* zIndex bumped while editing one row of the "Describe a meal" review
          list (see mealItems' Sheet further below): that list stays open
          underneath at the default tier, this sheet must render above it,
          same "bump the one that must sit on top" rule as every other
          Sheet-over-Sheet case in this file. */}
      <Sheet open={qtySheetOpen} onClose={closeQtySheet} title={pendingFood?.name || 'Add food'} titleColor="var(--accent)" zIndex={editingMealItemId ? 200 : 100}>
        {pendingFood && (
          <>
            {editingMealItemId && (
              <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 10 }}>
                Editing an item from your description
              </div>
            )}
            {pendingFood.brand && <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 14 }}>{pendingFood.brand}</div>}
            {pendingFood.custom && (
              <>
                <Field label="Name" style={{ marginBottom: 14 }}>
                  <TextInput value={pendingFood.name || ''} onChange={(v) => setPendingFood(pf => pf ? { ...pf, name: v } : pf)} placeholder="e.g. Protein bar" />
                </Field>
                <Bezel style={{ marginBottom: 6 }}>Per 100g</Bezel>
                <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 8 }}>Edit if the scan misread.</div>
                <Field label="Calories (kcal, from macros)" style={{ marginBottom: 10 }}>
                  <input value={kcal100Str} onChange={e => onKcal100Change(e.target.value)} type="text" inputMode="decimal" placeholder="kcal" style={fdInputStyle} />
                </Field>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <Field label="Protein (g)" style={{ flex: 1 }}>
                    <input value={p100Str} onChange={e => setP100Str(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
                  </Field>
                  <Field label="Carbs (g)" style={{ flex: 1 }}>
                    <input value={c100Str} onChange={e => setC100Str(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
                  </Field>
                  <Field label="Fat (g)" style={{ flex: 1 }}>
                    <input value={f100Str} onChange={e => setF100Str(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
                  </Field>
                </div>
              </>
            )}
            {pendingFood.units?.length > 0 && (
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 10, flexWrap: 'wrap' }}>
                <button onClick={() => selectQtyUnit(null)} style={fdSegBtn(qtyUnitIdx == null)}>Grams</button>
                {pendingFood.units.map((u, i) => (
                  <button key={i} onClick={() => selectQtyUnit(i)} style={fdSegBtn(qtyUnitIdx === i)}>{u.label}</button>
                ))}
              </div>
            )}
            <Field label={qtyUnitIdx == null ? (pendingFood.custom ? 'Portion (g)' : 'Amount (g)') : `Count (${pendingFood.units[qtyUnitIdx].label})`} style={{ marginBottom: qtyUnitIdx == null ? 14 : 4 }}>
              <input
                value={qtyUnitIdx == null ? qtyG : qtyCountStr}
                onChange={e => qtyUnitIdx == null ? setQtyG(fdDecimalFilter(e.target.value)) : onQtyCountChange(e.target.value)}
                type="text" inputMode="decimal" placeholder={qtyUnitIdx == null ? 'g' : 'count'}
                style={fdBigInput} />
            </Field>
            {qtyUnitIdx != null && (
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 14 }}>= {qtyG || 0}g</div>
            )}
            {qtyUnitIdx == null && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {[50, 100, 150, 200].map(g => (
                  <button key={g} onClick={() => setQtyG(String(g))} style={fdPreset}>{g}g</button>
                ))}
                {pendingFood.servingSizeG > 0 && (
                  <button onClick={() => setQtyG(String(Math.round(pendingFood.servingSizeG)))} style={fdPreset}>
                    {pendingFood.servingLabel || 'Serving'} ({Math.round(pendingFood.servingSizeG)}g)
                  </button>
                )}
              </div>
            )}
            {qtyPreview && (
              <FdMacroPreview calories={qtyPreview.calories} protein={qtyPreview.protein} carbs={qtyPreview.carbs} fat={qtyPreview.fat}
                sugar={qtyPreview.sugar} satFat={qtyPreview.satFat} sodiumMg={qtyPreview.sodiumMg} />
            )}
            <button onClick={() => toggleFavorite(buildQtyEntry())} disabled={!qtyPreview || qtyNameMissing} style={fdFavBtn(!!favedId, !qtyPreview || qtyNameMissing)}>
              <i className={`fa-${favedId ? 'solid' : 'regular'} fa-star`} style={{ fontSize: 14, color: favedId ? UI.gold : UI.inkSoft }} />
              {favedId ? 'Saved to favorites' : 'Save as favorite'}
            </button>
            {planMode && editingEntry && !curDateIsFuture && (
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 8 }}>
                {[[false, 'Logged'], [true, 'Planned']].map(([val, label]) => (
                  <button key={label} onClick={() => setQtyEditPlanned(val)} style={fdSegBtn(qtyEditPlanned === val)}>{label}</button>
                ))}
              </div>
            )}
            {editingMealItemId ? (
              // Plan vs Logged is decided once for the whole batch on the
              // review list itself (mealItems' Sheet, Plan it/Log it),
              // never here: this only writes the edit back into that row.
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn kind="ghost" onClick={closeQtySheet} style={{ flex: 1 }}>Cancel</Btn>
                <Btn onClick={() => confirmLogFood(false)} disabled={!qtyPreview || qtyNameMissing} style={{ flex: 2 }}>Save</Btn>
              </div>
            ) : planMode && !editingEntry ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn kind="ghost" onClick={closeQtySheet} style={{ flex: 1 }}>Cancel</Btn>
                <Btn kind={curDateIsFuture ? undefined : 'ghost'} onClick={() => confirmLogFood(true)} disabled={!qtyPreview || qtyNameMissing} style={{ flex: curDateIsFuture ? 2 : 1.5 }}>Plan it</Btn>
                {!curDateIsFuture && <Btn onClick={() => confirmLogFood(false)} disabled={!qtyPreview || qtyNameMissing} style={{ flex: 1.5 }}>Log it</Btn>}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn kind="ghost" onClick={closeQtySheet} style={{ flex: 1 }}>Cancel</Btn>
                <Btn onClick={() => confirmLogFood(false)} disabled={!qtyPreview || qtyNameMissing} style={{ flex: 2 }}>{editingEntry ? 'Save' : 'Add'}</Btn>
              </div>
            )}
          </>
        )}
      </Sheet>

      {/* ── Custom item sheet ── */}
      <Sheet open={customOpen} onClose={requestCloseCustomSheet} title="Custom item" titleColor="var(--accent)">
        <Field label="Name" style={{ marginBottom: 12 }}>
          <TextInput value={customName} onChange={setCustomName} placeholder="e.g. Mom's lasagna" />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Field label="Amount (g, optional)" style={{ flex: 1 }}>
            <input value={customG} onChange={e => setCustomG(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
          </Field>
          <Field label="Calories (kcal, from macros)" style={{ flex: 1 }}>
            <input value={customCal} onChange={e => onCustomCalChange(e.target.value)} type="text" inputMode="decimal" placeholder="kcal" style={fdInputStyle} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Field label="Protein (g)" style={{ flex: 1 }}>
            <input value={customP} onChange={e => setCustomP(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
          </Field>
          <Field label="Carbs (g)" style={{ flex: 1 }}>
            <input value={customC} onChange={e => setCustomC(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
          </Field>
          <Field label="Fat (g)" style={{ flex: 1 }}>
            <input value={customF} onChange={e => setCustomF(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
          </Field>
        </div>
        <Field label="Fiber (g, optional)" style={{ marginBottom: 12 }}>
          <input value={customFib} onChange={e => setCustomFib(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
        </Field>
        {/* Sugar/saturated fat/sodium (migration 0204). Collapsed by default:
            they are optional, play no part in the calorie math, and the form
            already asks for six numbers. A label scan that read them opens
            this block prefilled, so the values are visible rather than
            hidden behind a chevron the user never taps. */}
        <FdExtrasToggle open={customExtrasOpen} onToggle={() => setCustomExtrasOpen(o => !o)} />
        {customExtrasOpen && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <Field label="Sugar (g)" style={{ flex: 1 }}>
              <input value={customSugar} onChange={e => setCustomSugar(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
            </Field>
            <Field label="Sat. fat (g)" style={{ flex: 1 }}>
              <input value={customSatFat} onChange={e => setCustomSatFat(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
            </Field>
            <Field label="Sodium (mg)" style={{ flex: 1 }}>
              <input value={customSodium} onChange={e => setCustomSodium(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="mg" style={fdInputStyle} />
            </Field>
          </div>
        )}
        <button onClick={() => toggleFavorite(buildCustomEntry())} disabled={!customValid} style={fdFavBtn(!!favedId, !customValid)}>
          <i className={`fa-${favedId ? 'solid' : 'regular'} fa-star`} style={{ fontSize: 14, color: favedId ? UI.gold : UI.inkSoft }} />
          {favedId ? 'Saved to favorites' : 'Save as favorite'}
        </button>
        {planMode ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" onClick={closeCustomSheet} style={{ flex: 1 }}>Cancel</Btn>
            <Btn kind={curDateIsFuture ? undefined : 'ghost'} onClick={() => submitCustomItem(true)} disabled={!customValid} style={{ flex: curDateIsFuture ? 2 : 1.5 }}>Plan it</Btn>
            {!curDateIsFuture && <Btn onClick={() => submitCustomItem(false)} disabled={!customValid} style={{ flex: 1.5 }}>Log it</Btn>}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" onClick={closeCustomSheet} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={() => submitCustomItem(false)} disabled={!customValid} style={{ flex: 2 }}>Add</Btn>
          </div>
        )}
      </Sheet>

      {/* ── Describe a meal: free text -> parsed into mealItems, reviewed in
          the Sheet right below ── */}
      <Sheet open={mealDescribeOpen} onClose={closeMealDescribeSheet} title="Describe a meal" titleColor="var(--accent)">
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: '16px' }}>
          Describe what you ate, portions and all, in plain language. Claude estimates each item's macros (generously where cooking fat isn't specified), then you'll get a chance to review and adjust before anything's added.
        </div>
        <Field label="What did you eat?" style={{ marginBottom: 12 }}>
          <textarea
            value={mealDescription}
            onChange={e => setMealDescription(e.target.value)}
            placeholder="e.g. a thin slice of Leberkäse, one egg, a thin potato pancake and a bread roll"
            rows={4}
            autoFocus
            style={{ ...fdInputStyle, resize: 'vertical', lineHeight: 1.4 }}
          />
        </Field>
        {mealParseError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: '16px' }}>{mealParseError}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={closeMealDescribeSheet} disabled={mealParsing} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={handleDescribeMeal} disabled={mealParsing || !mealDescription.trim()} style={{ flex: 2 }}>{mealParsing ? 'Estimating…' : 'Estimate'}</Btn>
        </div>
      </Sheet>

      {/* ── Review list for a parsed meal-description batch: tap a row to
          adjust it (opens the quantity sheet above at zIndex 200), trash to
          drop it outright, Plan it/Log it stages every remaining row at
          once. Nothing from here reaches store.foodLogs until that tap. ── */}
      <Sheet open={mealItems != null} onClose={requestCloseMealReview} title="Review meal" titleColor="var(--accent)">
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: '16px' }}>
          Tap an item to adjust its amount or numbers. Remove anything that doesn't belong.
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10 }}>
          <span className="num" style={{ fontSize: 18, fontWeight: 300, color: UI.ink }}>{mealItemsTotals.calories}<span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 3 }}>kcal</span></span>
          <FdMacroGhosts protein={mealItemsTotals.protein} carbs={mealItemsTotals.carbs} fat={mealItemsTotals.fat} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {(mealItems || []).map(i => {
            const netCarbs = !!store.settings?.netCarbs;
            const kcal = Math.round(LB.caloriesFromMacros(i.protein, i.carbs, i.fat, netCarbs ? i.fiber : null) || 0);
            return (
              <div key={i.tempId} style={fdDraftRow}>
                <button onClick={() => editMealItem(i)} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                  <span style={{ ...fdEntryName, fontSize: 12 }}>{i.foodName}</span>
                  <span style={fdEntryMeta}>
                    {i.quantityG}g · <span className="num" style={{ color: UI.warn }}>{kcal} kcal</span>
                    <span style={fdMetaDivider} />
                    <FdMacroBits protein={i.protein} carbs={i.carbs} fat={i.fat} />
                  </span>
                </button>
                <button onClick={() => removeMealItem(i.tempId)} aria-label="Remove" style={fdInlineDeleteBtn}>
                  <i className="fa-solid fa-trash" style={{ fontSize: 11 }} />
                </button>
              </div>
            );
          })}
        </div>
        {planMode ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" onClick={requestCloseMealReview} style={{ flex: 1 }}>Cancel</Btn>
            <Btn kind={curDateIsFuture ? undefined : 'ghost'} onClick={() => commitMealItems(true)} disabled={!mealItemsValid} style={{ flex: curDateIsFuture ? 2 : 1.5 }}>Plan it</Btn>
            {!curDateIsFuture && <Btn onClick={() => commitMealItems(false)} disabled={!mealItemsValid} style={{ flex: 1.5 }}>Log it</Btn>}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" onClick={requestCloseMealReview} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={() => commitMealItems(false)} disabled={!mealItemsValid} style={{ flex: 2 }}>
              Add {mealItems?.length || 0} item{(mealItems?.length || 0) === 1 ? '' : 's'}
            </Btn>
          </div>
        )}
      </Sheet>

      {/* ── Repeat yesterday's meal, minus whatever changed ────────────────
          Same tick-list idiom as the Manage-entries sheet below, but pointed
          at YESTERDAY's entries and pre-ticked: the reason to open this is
          that today's meal is nearly the same, so the work is unticking the
          one item that isn't. ── */}
      <Sheet open={!!repeat} onClose={() => setRepeat(null)} title={repeat ? `Repeat ${repeat.label.toLowerCase()}` : 'Repeat yesterday'} titleColor="var(--accent)">
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: '16px' }}>
          {planMode
            ? "From yesterday, landing on today at the same times as planned meals you check off as you eat them."
            : 'From yesterday, landing on today at the same times.'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, maxHeight: 300, overflowY: 'auto' }}>
          {repeatEntries.map(e => {
            const checked = !!repeat && repeat.ids.includes(e.id);
            return (
              <button key={e.id} onClick={() => toggleRepeatId(e.id)} style={fdCopyMoveRow(checked)}>
                <div style={fdCopyMoveCheck(checked)}>
                  {checked && <i className="fa-solid fa-check" style={{ fontSize: 10, color: 'var(--accent-ink)' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={fdEntryName}>{e.foodName}</div>
                  <span style={fdEntryMeta}>
                    {e.time} · {fdDisplayG(e) ? `${fdDisplayG(e)}g · ` : ''}<span className="num" style={{ color: UI.warn }}>{e.calories} kcal</span>
                    <span style={fdMetaDivider} />
                    <FdMacroBits protein={e.protein} carbs={e.carbs} fat={e.fat} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        {repeatSelected.length > 0 && (
          <FdMacroPreview calories={repeatTotals.calories} protein={repeatTotals.protein} carbs={repeatTotals.carbs} fat={repeatTotals.fat}
            sugar={repeatTotals.sugar} satFat={repeatTotals.satFat} sodiumMg={repeatTotals.sodiumMg} />
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => setRepeat(null)} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={submitRepeatYesterday} disabled={!repeatSelected.length} style={{ flex: 2 }}>
            {repeatSelected.length
              ? `${planMode ? 'Plan' : 'Add'} ${repeatSelected.length} ${repeatSelected.length === 1 ? 'item' : 'items'}`
              : 'Nothing picked'}
          </Btn>
        </div>
      </Sheet>

      {/* ── Copy/move/delete a picked set of entries from the viewed day ── */}
      <Sheet open={copyMoveOpen} onClose={requestCloseCopyMove} title="Manage entries" titleColor="var(--accent)">
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: '16px' }}>
          {copyMoveMode === 'delete' ? 'Pick entries below to delete them together.' : 'Pick entries below, they land on the new day at the same time.'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16, maxHeight: 260, overflowY: 'auto' }}>
          {copyMoveCategories.map(cat => (
            <div key={cat.id}>
              <Bezel style={{ marginBottom: 6 }}>{cat.label}</Bezel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {cat.entries.map(e => {
                  const checked = copyMoveIds.includes(e.id);
                  return (
                    <button key={e.id} onClick={() => toggleCopyMoveId(e.id)} style={fdCopyMoveRow(checked)}>
                      <div style={fdCopyMoveCheck(checked)}>
                        {checked && <i className="fa-solid fa-check" style={{ fontSize: 10, color: 'var(--accent-ink)' }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <div style={fdEntryName}>{e.foodName}</div>
                        <span style={fdEntryMeta}>{e.time} · <span className="num" style={{ color: UI.warn }}>{e.calories} kcal</span></span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {copyMoveMode !== 'delete' && (
          <Field label="To" style={{ marginBottom: 14 }}>
            <input type="date" value={copyMoveTarget} onChange={e => setCopyMoveTarget(e.target.value)}
              style={{ ...fdInputStyle, colorScheme: ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark') ? 'light' : 'dark' }} />
          </Field>
        )}
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 16 }}>
          <button onClick={() => setCopyMoveMode('copy')} style={fdSegBtn(copyMoveMode === 'copy')}>Copy</button>
          <button onClick={() => setCopyMoveMode('move')} style={fdSegBtn(copyMoveMode === 'move')}>Move</button>
          <button onClick={() => setCopyMoveMode('delete')} style={fdSegBtn(copyMoveMode === 'delete', true)}>Delete</button>
        </div>
        {copyMoveMode === 'delete' ? (
          <Btn onClick={deleteBulkEntries} disabled={!copyMoveIds.length} style={{ width: '100%', background: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.6)' }}>
            Delete{copyMoveIds.length ? ` ${copyMoveIds.length}` : ''} {copyMoveIds.length === 1 ? 'entry' : 'entries'}
          </Btn>
        ) : (
          <Btn onClick={submitCopyMove} disabled={!copyMoveIds.length || !copyMoveTarget || copyMoveTarget === curDate} style={{ width: '100%' }}>
            {copyMoveMode === 'move' ? 'Move' : 'Copy'}{copyMoveIds.length ? ` ${copyMoveIds.length}` : ''} {copyMoveIds.length === 1 ? 'entry' : 'entries'}
          </Btn>
        )}
      </Sheet>

      {/* ── Split a stacked hour (a meal-prep batch) across multiple meal
          times: how many meals, at what hours, and how much of each item
          goes to each one. Deletes the original entries and replaces them
          with the redistributed set on Split. ── */}
      <Sheet open={splitHour != null} onClose={requestCloseSplit} title={`Split ${splitHour != null ? String(splitHour).padStart(2, '0') + ':00' : ''}`} titleColor="var(--accent)">
        {splitHour != null && (() => {
          const entries = byHour[splitHour] || [];
          const batch = splitBatchAt(splitHour);
          const canConfigure = entries.length >= 2;
          return (
            <>
              {/* However this hour got here (still mid-batch, or fully
                  reduced to one leftover item, or the single result of a
                  block combined into a recipe), an earlier split OR combine
                  it's part of can always be undone from here, not just the
                  6s toast right after applying it. */}
              {batch && (
                <div style={{ marginBottom: canConfigure ? 20 : 0, paddingBottom: canConfigure ? 20 : 0, borderBottom: canConfigure ? `var(--hair-width) solid ${UI.hairStrong}` : 'none' }}>
                  <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: '16px' }}>
                    {batch.kind === 'merge'
                      ? 'This entry was combined from a block of items. Undo it to delete the combined recipe and put the original entries back exactly as they were.'
                      : 'This meal was split from another time. Undo it to delete the split and put the original entry back exactly as it was.'}
                  </div>
                  <Btn kind="ghost" onClick={() => undoSplitBatch(batch.id, batch.kind)} style={{ width: '100%', color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.4)' }}>
                    <i className="fa-solid fa-rotate-left" style={{ marginRight: 8 }} /> {batch.kind === 'merge' ? 'Undo combine' : 'Undo split'}
                  </Btn>
                </div>
              )}
              {canConfigure && (
                <>
                  <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: '16px' }}>
                    Really eaten at more than one time? Redistribute these items across meals, each amount adjustable on its own.
                  </div>
                  <div className="micro" style={{ marginBottom: 8, textAlign: 'center' }}>Meals</div>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                    <Stepper value={splitCount} step={1} min={2} suffix={splitCount === 1 ? ' meal' : ' meals'} onChange={setSplitCountTo} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                    {[splitHour, ...splitHours].map((h, i) => (
                      <div key={i} style={{ flex: '1 1 100px' }}>
                        <div className="micro" style={{ marginBottom: 4, textAlign: 'center' }}>Meal {i + 1}</div>
                        {i === 0 ? (
                          <div style={{ ...fdInputStyle, textAlign: 'center', color: UI.inkSoft }}>{String(h).padStart(2, '0')}:00</div>
                        ) : (
                          <Stepper value={h} step={1} min={0} suffix=":00"
                            onChange={v => setSplitHours(prev => prev.map((x, xi) => xi === i - 1 ? Math.max(0, Math.min(23, Math.round(v))) : x))} />
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
                    {entries.map(e => {
                      const unit = splitEntryUnit(e);
                      return (
                        <div key={e.id}>
                          <div style={fdEntryName}>
                            {e.foodName}
                            {unit && <span style={{ ...fdEntryMeta, marginLeft: 6 }}>· in {unit.label}</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                            {[splitHour, ...splitHours].map((h, i) => (
                              <div key={i} style={{ flex: '1 1 80px' }}>
                                <input value={(splitQtys[e.id] || [])[i] ?? ''} onChange={ev => updateSplitQty(e.id, i, ev.target.value)}
                                  type="text" inputMode="decimal" placeholder={splitUnit(e)} style={fdInputStyle} />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn kind="ghost" onClick={() => setSplitHour(null)} style={{ flex: 1 }}>Cancel</Btn>
                    <Btn onClick={applySplit} style={{ flex: 2 }}>Split</Btn>
                  </div>
                </>
              )}
            </>
          );
        })()}
      </Sheet>

      {/* ── Combine a stacked hour's items into one recipe-shaped entry, either
          just for this log (temporary, no library row) or also saved as a real
          reusable recipe. ── */}
      <Sheet open={recipeBlockHour != null} onClose={requestCloseBlockRecipe} title="Create recipe" titleColor="var(--accent)">
        {recipeBlockHour != null && (
          <>
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: '16px' }}>
              Combines these items into one recipe entry. Off by default: it only replaces this log entry, on saves it to Quick Add, Recipes too.
            </div>
            <Field label="Recipe name" style={{ marginBottom: 16 }}>
              <TextInput value={recipeBlockName} onChange={setRecipeBlockName} placeholder="e.g. Breakfast bowl" />
            </Field>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>Save as reusable recipe</span>
              <Toggle on={recipeBlockSave} onToggle={() => setRecipeBlockSave(v => !v)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20, maxHeight: 220, overflowY: 'auto' }}>
              {fdSortIngredientsByQty(byHour[recipeBlockHour] || []).map(e => (
                <div key={e.id} style={fdEntryRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={fdEntryName}>{e.foodName}</div>
                    <span style={fdEntryMeta}>{fdDisplayG(e) ? `${fdDisplayG(e)}g · ` : ''}<span className="num" style={{ color: UI.warn }}>{e.calories} kcal</span></span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => setRecipeBlockHour(null)} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={applyBlockRecipe} disabled={!recipeBlockName.trim()} style={{ flex: 2 }}>Create recipe</Btn>
            </div>
          </>
        )}
      </Sheet>

      {/* ── Units for a favorite (e.g. "1 Pc = 62g", "1 Pack = 500g") ── */}
      <Sheet open={!!editFavId} onClose={requestCloseEditFavorite} title="Units" titleColor="var(--accent)">
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 14, lineHeight: '16px' }}>
          Add one or more units and relogging this favorite offers a picker (grams or a count of one of them) instead of always typing grams.
        </div>
        {editUnits.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {editUnits.map((u, i) => (
              <div key={i} style={fdEntryRow}>
                <span style={fdEntryName}>1 {u.label} = {u.grams}g</span>
                <button onClick={() => removeEditUnit(i)} aria-label="Remove unit" style={fdInlineDeleteBtn}>
                  <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <Field label="Unit name" style={{ flex: 1 }}>
            <TextInput value={editUnitNewLabel} onChange={setEditUnitNewLabel} placeholder="e.g. Pc" />
          </Field>
          <Field label="Grams" style={{ flex: 1 }}>
            <input value={editUnitNewGrams} onChange={e => setEditUnitNewGrams(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
          </Field>
        </div>
        <Btn kind="ghost" onClick={addEditUnit} disabled={!editUnitNewLabel.trim() || !(fdNum(editUnitNewGrams) > 0)} style={{ width: '100%', marginBottom: 16 }}>
          <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> Add unit
        </Btn>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={closeEditFavorite} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={saveEditFavorite} style={{ flex: 2 }}>Save</Btn>
        </div>
      </Sheet>

      {/* ── Barcode vs. label picker (opened by the search box's scan button) ── */}
      <Sheet open={scanPickerOpen} onClose={() => setScanPickerOpen(false)} title="Scan" titleColor="var(--accent)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <button onClick={() => { setScanPickerOpen(false); setScanOpen(true); }} style={fdScanChoice}>
            <i className="fa-solid fa-barcode" style={{ fontSize: 22, color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>Barcode</span>
            <span style={{ fontSize: 10, color: UI.inkFaint, lineHeight: 1.3 }}>The code on the packaging</span>
          </button>
          <button onClick={() => { setScanPickerOpen(false); setLabelError(null); labelInputRef.current && labelInputRef.current.click(); }} style={fdScanChoice}>
            <i className="fa-solid fa-camera" style={{ fontSize: 22, color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>Nutrition label</span>
            <span style={{ fontSize: 10, color: UI.inkFaint, lineHeight: 1.3 }}>Photograph the facts table</span>
          </button>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="micro" style={{ marginBottom: 6 }}>Label reader (nutrition label only)</div>
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
            {[['grok', 'Grok'], ['claude', 'Claude']].map(([id, label]) => (
              <button key={id} onClick={() => { setLabelScannerProvider(id); fdWriteScannerProvider(id); }} style={fdSegBtn(labelScannerProvider === id)}>{label}</button>
            ))}
          </div>
        </div>
      </Sheet>

      {/* Hidden picker: opens the native camera (capture) or gallery on tap,
          which works on iOS Safari without any library. */}
      <input ref={labelInputRef} type="file" accept="image/*" capture="environment" onChange={handleLabelFile} style={{ display: 'none' }} />
      {labelScanning && <FdLabelBusy />}
      {scanOpen && <FdScanner onClose={() => setScanOpen(false)} onDetect={handleScan} />}

      {/* ── Add a recipe to today's (or curDate's) log: always a portions
          stepper, even for a 1-portion recipe (e.g. "1 cake" doesn't mean
          logging the whole cake is the only option, half of it or a second
          one are just as valid). Half-portion steps, no upper cap: chosen
          can go above the recipe's own portion count too.
          STACKING WARNING: stays z-index 100 on purpose, tied with
          CookingModeScreen below, which must render as a LATER sibling than
          this Sheet in the JSX to win that tie (see CookingModeScreen's own
          comment for why a literal higher zIndex is unsafe here). Do not
          move this Sheet below CookingModeScreen's render call, or reorder
          either one, without re-reading that comment first. ── */}
      <Sheet open={!!recipeLogPrompt} onClose={requestCloseRecipeLogPrompt} title={recipeLogPrompt?.recipe?.name || 'Add recipe'} titleColor="var(--accent)"
        titleRight={recipeLogPrompt && (
          // Always share the LIVE recipe. When this sheet is opened from an
          // already-logged entry (openEditRecipeEntry) the prompt holds a
          // rescaled reconstruction of the entry's snapshot, which has no
          // calories, foodId, brand or source. Sharing that upserted it over
          // the existing share row under the SAME token, so a link already
          // sent to someone else silently degraded.
          <button onClick={() => openShareRecipe((store.foodRecipes || []).find(r => r.id === recipeLogPrompt.recipe.id) || recipeLogPrompt.recipe)} aria-label="Share recipe" style={fdIconBtn(30, true)}>
            <i className="fa-solid fa-share-from-square" style={{ fontSize: 12 }} />
          </button>
        )}
      >
        {recipeLogPrompt && (() => {
          const gramsCapable = recipeLogPrompt.recipe.cookedWeightG > 0;
          const gramsModeOn = gramsCapable && recipeLogPrompt.mode === 'grams';
          const qtyLabel = gramsModeOn
            ? `${fdNum(recipeLogPrompt.gramsStr) || 0}g`
            : `${recipeLogPrompt.chosenPortions} portion${recipeLogPrompt.chosenPortions === 1 ? '' : 's'}`;
          // Portions mode is already safe (the Stepper below floors at 0.5),
          // but grams mode is a free-typed field with no min at all, so a
          // cleared or "0" input would otherwise stage a real, 0-calorie
          // "Chicken Bowl (0g)" entry, the exact phantom-entry class every
          // other add flow in this file already guards against.
          const qtyValid = gramsModeOn ? fdNum(recipeLogPrompt.gramsStr) > 0 : recipeLogPrompt.chosenPortions > 0;
          return (
          <>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: '17px' }}>
              How much of {recipeLogPrompt.recipe.name}, at {entryTime()}?
            </div>
            {gramsCapable && (
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 16 }}>
                {[['portions', 'Portions'], ['grams', 'Grams']].map(([id, label]) => (
                  <button key={id} onClick={() => setRecipeLogPrompt(p => {
                    // Carries the current amount across in whichever direction,
                    // switching units mid-edit shouldn't reset the quantity.
                    if (!p || p.mode === id) return p;
                    if (id === 'grams') {
                      return { ...p, mode: id, gramsStr: String(Math.max(0, Math.round(fdPortionsToGrams(p.chosenPortions, p.recipe.cookedWeightG, p.totalPortions)))) };
                    }
                    return { ...p, mode: id, chosenPortions: Math.max(0.5, Math.round(fdGramsToPortions(fdNum(p.gramsStr) || 0, p.recipe.cookedWeightG, p.totalPortions) * 2) / 2) };
                  })} style={fdSegBtn(recipeLogPrompt.mode === id)}>{label}</button>
                ))}
              </div>
            )}
            {gramsModeOn ? (
              // Free-typed, not a Stepper: grams spans too wide a range for
              // a fixed step to ever be the right size (10g taps to shave 460g
              // off a 960g default is exactly the "tap fifty times" complaint
              // this replaced), unlike portions below where a half-step really
              // is normally the whole adjustment.
              <Field label="Amount (g)" style={{ marginBottom: 20 }}>
                <input value={recipeLogPrompt.gramsStr} onChange={e => setRecipeLogPrompt(p => p ? { ...p, gramsStr: fdDecimalFilter(e.target.value) } : p)}
                  type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
              </Field>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
                <Stepper value={recipeLogPrompt.chosenPortions} step={0.5} min={0.5}
                  suffix={recipeLogPrompt.chosenPortions === 1 ? ' portion' : ' portions'}
                  onChange={v => setRecipeLogPrompt(p => p ? { ...p, chosenPortions: Math.max(0.5, Math.round(v * 2) / 2) } : p)} big />
              </div>
            )}
            {recipeLogPreview && (
              <FdMacroPreview calories={recipeLogPreview.calories} protein={recipeLogPreview.protein} carbs={recipeLogPreview.carbs} fat={recipeLogPreview.fat} />
            )}
            {editingEntry && planMode && !curDateIsFuture && (
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 8 }}>
                {[[false, 'Logged'], [true, 'Planned']].map(([val, label]) => (
                  <button key={label} onClick={() => setQtyEditPlanned(val)} style={fdSegBtn(qtyEditPlanned === val)}>{label}</button>
                ))}
              </div>
            )}
            {editingEntry ? (
              <Btn onClick={() => confirmRecipeLog(false)} disabled={!qtyValid} style={{ width: '100%' }}>
                Save · {qtyLabel}
              </Btn>
            ) : recipeLogPrompt.fromCookingMode ? (
              // Reached via Cooking Mode's own hand-off (Part D): behaves like
              // a normal, non-Cook-it prompt (see the plain planMode/single-Add
              // branches this mirrors), no "Cook it" a second time, that
              // doesn't make sense once the dish is already cooked. The back
              // chevron (matching the wizard's own footer button) reopens
              // Cooking Mode, e.g. to fix the dish weight after all.
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={backToCookingMode} aria-label="Back to Cooking Mode" style={{
                  width: 44, minHeight: 44, borderRadius: 6, background: 'transparent', border: `var(--hair-width) solid ${UI.hairStrong}`,
                  color: UI.inkSoft, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  WebkitTapHighlightColor: 'transparent',
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                {planMode ? (
                  <div style={{ display: 'flex', gap: 8, flex: 1 }}>
                    <Btn kind={curDateIsFuture ? undefined : 'ghost'} onClick={() => confirmRecipeLog(true)} disabled={!qtyValid} style={{ flex: 1 }}>Plan it</Btn>
                    {!curDateIsFuture && <Btn onClick={() => confirmRecipeLog(false)} disabled={!qtyValid} style={{ flex: 1 }}>Log it</Btn>}
                  </div>
                ) : (
                  <Btn onClick={() => confirmRecipeLog(false)} disabled={!qtyValid} style={{ flex: 1 }}>
                    Add {recipeLogPrompt.recipe.name} · {qtyLabel}
                  </Btn>
                )}
              </div>
            ) : (<>
              {/* Three real actions instead of the old plan-mode-only split:
                  Cook it walks through Cooking Mode below (real-time only,
                  same reasoning as Log it, a future date can't be cooked
                  today); Plan it/Log it are unchanged. The chosen quantity no
                  longer fits inside a now-narrower button label, so it's
                  called out here instead. */}
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 10, textAlign: 'center' }}>{qtyLabel}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {!curDateIsFuture && <Btn kind="ghost" onClick={startCookingMode} style={{ flex: 1 }}>Cook it</Btn>}
                <Btn kind={curDateIsFuture ? undefined : 'ghost'} onClick={() => confirmRecipeLog(true)} disabled={!qtyValid} style={{ flex: 1 }}>Plan it</Btn>
                {!curDateIsFuture && <Btn onClick={() => confirmRecipeLog(false)} disabled={!qtyValid} style={{ flex: 1 }}>Log it</Btn>}
              </div>
            </>)}
          </>
          );
        })()}
      </Sheet>

      {/* ── Duplicate-recipe picker (header copy icon, see duplicateRecipe) ── */}
      <Sheet open={duplicatePickerOpen} onClose={() => setDuplicatePickerOpen(false)} title="Duplicate recipe" titleColor="var(--accent)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '60vh', overflowY: 'auto' }}>
          {(store.foodRecipes || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(r => {
            const n = (r.items || []).length;
            return (
              <button key={r.id} onClick={() => duplicateRecipe(r)} style={fdResultRow}>
                <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <div style={fdEntryName}>{r.name}</div>
                  <div style={fdEntryMeta}>{n} ingredient{n === 1 ? '' : 's'}</div>
                </div>
                <i className="fa-solid fa-copy" style={{ fontSize: 12, color: 'var(--accent)' }} />
              </button>
            );
          })}
        </div>
      </Sheet>

      {/* ── Recipe share-link sheet (sender side, see openShareRecipe) ── */}
      <Sheet open={!!shareSheet} onClose={() => setShareSheet(null)} title={shareSheet ? `Share ${shareSheet.recipe.name}` : 'Share recipe'} titleColor="var(--accent)" zIndex={200}>
        {shareSheet?.status === 'busy' && (
          <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, padding: '8px 0 16px' }}>Creating the share link…</div>
        )}
        {shareSheet?.status === 'error' && (
          <>
            <div style={{ fontSize: 12, color: UI.danger, fontFamily: UI.fontUi, marginBottom: 14, lineHeight: '17px' }}>{shareSheet.error}</div>
            <Btn onClick={() => openShareRecipe(shareSheet.recipe)} style={{ width: '100%' }}>Try again</Btn>
          </>
        )}
        {shareSheet?.status === 'ready' && (
          <>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 14, lineHeight: '17px' }}>
              Anyone with this link can open the recipe in Zane and add a copy to their own recipes. The link carries a snapshot: edits you make later are not sent along.
            </div>
            <div className="num" style={{ fontSize: 11, color: UI.inkFaint, padding: '10px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, wordBreak: 'break-all', userSelect: 'all', WebkitUserSelect: 'all', marginBottom: 14, textShadow: 'none' }}>
              {shareSheet.url}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={copyShareLink} style={{ flex: 1 }}>
                <i className={`fa-solid ${shareSheet.copied ? 'fa-check' : 'fa-copy'}`} style={{ marginRight: 8 }} />{shareSheet.copied ? 'Copied' : 'Copy link'}
              </Btn>
              {typeof navigator.share === 'function' && (
                <Btn onClick={shareShareLink} style={{ flex: 1 }}>
                  <i className="fa-solid fa-share-from-square" style={{ marginRight: 8 }} /> Share…
                </Btn>
              )}
            </div>
          </>
        )}
      </Sheet>

      <RecipeEditorScreen open={recipeEditorOpen} onClose={() => setRecipeEditorOpen(false)} onSave={handleRecipeSave} recipe={recipeEditorRecipe} store={store} />

      {/* Rendered AFTER recipeLogPrompt's own Sheet above (both z-index 100,
          see CookingModeScreen's own comment on why not a literal 200): later
          in document order wins an equal-z-index tie, so this correctly
          paints above the recipe log prompt it was opened from and returns
          into. */}
      <CookingModeScreen open={!!cookingMode} recipe={cookingMode?.recipe} draft={cookingMode?.draft} store={store}
        onClose={() => setCookingMode(null)} onFinish={finishCookingMode} onUpdateRecipe={updateRecipeFromCooking} onNoteChange={patchRecipeItemNote} />

      <FoodTemplateScreen open={templateOpen} onClose={() => setTemplateOpen(false)} store={store} setStore={setStore} userId={userId} />

      <ShoppingListScreen open={shoppingOpen} onClose={() => setShoppingOpen(false)} store={store} setStore={setStore} today={today} userId={userId} />

      {/* Per-entry overflow actions (kebab), one menu instead of a row of inline
          buttons. Recomputes its options from the open entry. */}
      <Sheet open={!!entryMenu} onClose={() => setEntryMenu(null)} title={entryMenu?.foodName || 'Entry'} titleColor="var(--accent)">
        {entryMenu && (() => {
          const me = entryMenu;
          const meIsRecipe = me.source === 'recipe';
          const meHasItems = meIsRecipe && me.recipeItems?.length > 0;
          const meCanPortions = meIsRecipe && !!recipeEntryLiveRecipe(me);
          const meExpanded = expandedEntryIds.has(me.id);
          const act = (fn) => { setEntryMenu(null); fn(); };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {meHasItems && (
                <Btn kind="ghost" onClick={() => act(() => toggleEntryExpanded(me.id))} style={{ width: '100%' }}>
                  <i className={`fa-solid fa-chevron-${meExpanded ? 'up' : 'down'}`} style={{ marginRight: 8 }} /> {meExpanded ? 'Hide ingredients' : 'Show ingredients'}
                </Btn>
              )}
              {meCanPortions ? (
                <Btn kind="ghost" onClick={() => act(() => openEditRecipeEntry(me))} style={{ width: '100%' }}>
                  <i className="fa-solid fa-pen" style={{ marginRight: 8 }} /> Edit amount
                </Btn>
              ) : !meIsRecipe ? (
                <Btn kind="ghost" onClick={() => act(() => openEditEntry(me))} style={{ width: '100%' }}>
                  <i className="fa-solid fa-pen" style={{ marginRight: 8 }} /> Edit
                </Btn>
              ) : null}
              <Btn kind="ghost" onClick={() => act(() => deleteEntry(me))} style={{ width: '100%', color: UI.danger }}>
                <i className="fa-solid fa-trash" style={{ marginRight: 8 }} /> Delete
              </Btn>
            </div>
          );
        })()}
      </Sheet>
    </Screen>
    {/* Transient toast for the last applied split OR block-recipe combine
        (see splitUndo/undoSplit), rendered the same "fixed footer sibling of
        Screen" way as stagedPanel below so it never overlaps TabBar either.
        Sits above stagedPanel: it's the momentary one of the two, stagedPanel
        is the one meant to persist until dealt with. */}
    {splitUndo && (
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: `var(--hair-width) solid ${UI.hairStrong}`, background: 'rgba(var(--bg-rgb),0.96)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
        <i className={`fa-solid ${splitUndo.kind === 'merge' ? 'fa-bowl-food' : 'fa-arrows-split-up-and-left'}`} style={{ fontSize: 12, color: UI.inkFaint, flexShrink: 0 }} />
        <span style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.inkSoft, flex: 1, minWidth: 0 }}>
          {splitUndo.kind === 'merge' ? `Combined ${splitUndo.count} items into a recipe` : `Split into ${splitUndo.count} meals`}
        </span>
        <button onClick={undoSplit} style={{ background: 'none', border: 'none', padding: '4px 8px', color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', flexShrink: 0 }}>
          Undo
        </button>
      </div>
    )}
    {stagedPanel}
    </div>
  );
}

// Recipe items are a fixed jsonb snapshot (zane_food_recipes.items), so an
// ingredient added before calories-always-from-macros became the rule still
// carries whatever calories it was snapshotted with. Recomputing from each
// item's own protein/carbs/fat at every use, not just once at write time,
// makes an old recipe self-heal exactly like reAddFromRecent already does
// for a single re-added item, with no separate migration needed for the
// jsonb blobs themselves. Shared by FoodScreen (recipe rows, add-to-log),
// RecipeEditorScreen (the batch hero) and RecipeShareSheet (the share
// preview). netCarbs (settings.netCarbs, passed by each caller) decides
// whether fiber is subtracted from carbs, same rule every other
// caloriesFromMacros call in this file follows.
// Sums sugar/satFat/sodiumMg across entries, keeping "unknown" distinct from
// zero: a key is null unless at least one entry reports it, and `partial` says
// whether some entries in the day were missing the value, so the UI can label
// the figure as incomplete rather than quietly understating it.
function fdSumExtras(entries) {
  const out = { sugar: null, satFat: null, sodiumMg: null, extrasPartial: false };
  ['sugar', 'satFat', 'sodiumMg'].forEach(k => {
    const known = entries.filter(e => e[k] != null);
    if (!known.length) return;
    out[k] = fdRound1(known.reduce((a, e) => a + e[k], 0));
    if (known.length < entries.length) out.extrasPartial = true;
  });
  return out;
}
function fdRecipeItemsCalories(items, netCarbs) {
  return Math.round((items || []).reduce((a, i) => a + (LB.caloriesFromMacros(i.protein, i.carbs, i.fat, netCarbs ? i.fiber : null) || 0), 0));
}

// ── Recipe share (receiver side) ────────────────────────────────────────────
// App-level overlay for an incoming ?share=<token> deep link, mounted from
// app.jsx once the app is 'ready' (NOT inside FoodScreen: the link must
// resolve no matter which screen the app opened on). Fetches the snapshot,
// previews it, and "Add to my recipes" copies it into store.foodRecipes as a
// brand-new fully-owned recipe: fresh item ids, whitelisted item fields only
// (the snapshot is another user's jsonb, so never spread it blindly), and a
// "(2)"-style suffix when the name is already taken (FoodScreen resolves a
// logged recipe entry back to its source BY NAME, duplicates would make that
// ambiguous). The copy then syncs through the normal foodRecipes collection
// diff like any hand-built recipe.
function RecipeShareSheet({ store, setStore, token, onClose }) {
  const [state, setState] = useStateFd({ status: 'loading' }); // { status: 'loading'|'error'|'ready', share?, error? }
  const [added, setAdded] = useStateFd(false);

  useEffectFd(() => {
    let dead = false;
    (async () => {
      const res = await LB.fetchRecipeShare(token);
      if (dead) return;
      setState(res.ok ? { status: 'ready', share: res.share } : { status: 'error', error: res.error || 'Could not load this share link.' });
    })();
    return () => { dead = true; };
  }, [token]);

  const recipe = state.share?.recipe;
  const items = Array.isArray(recipe?.items) ? recipe.items : [];
  const netCarbs = !!store.settings?.netCarbs;
  // fdRound1 (one decimal), matching RecipeEditorScreen's own totals below:
  // plain Math.round here made the same recipe show whole-number macros in
  // a share-link preview but one-decimal macros everywhere else.
  const totals = useMemoFd(() => ({
    calories: fdRecipeItemsCalories(items, netCarbs),
    protein: fdRound1(items.reduce((a, i) => a + (Number(i.protein) || 0), 0)),
    carbs: fdRound1(items.reduce((a, i) => a + (Number(i.carbs) || 0), 0)),
    fat: fdRound1(items.reduce((a, i) => a + (Number(i.fat) || 0), 0)),
  }), [state.share, netCarbs]); // eslint-disable-line

  function adopt() {
    const now = new Date().toISOString();
    const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const numOrNull = v => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    setStore(s => {
      if (!s) return s;
      const names = new Set((s.foodRecipes || []).map(r => r.name));
      const base = String(recipe.name || 'Shared recipe');
      let name = base, n = 2;
      while (names.has(name)) { name = `${base} (${n})`; n++; }
      const copy = {
        id: LB.uid(), name,
        portions: parseInt(recipe.portions, 10) > 0 ? parseInt(recipe.portions, 10) : 1,
        items: items.map(i => ({
          id: LB.uid(),
          foodId: typeof i.foodId === 'string' ? i.foodId : null,
          foodName: String(i.foodName || 'Item'),
          brand: i.brand != null ? String(i.brand) : null,
          source: typeof i.source === 'string' ? i.source : null,
          quantityG: num(i.quantityG),
          calories: Math.round(num(i.calories)),
          protein: num(i.protein), carbs: num(i.carbs), fat: num(i.fat),
          fiber: i.fiber != null && Number.isFinite(Number(i.fiber)) ? Number(i.fiber) : null,
          // Migration 0204 extras, whitelisted like everything else here: the
          // snapshot is another user's jsonb, so nothing is spread blindly.
          // Absent on anything shared before 0204, which stays null.
          sugar: numOrNull(i.sugar), satFat: numOrNull(i.satFat), sodiumMg: numOrNull(i.sodiumMg),
          // Prep notes are exactly why someone shares a recipe with notes in
          // the first place (e.g. so a partner cooks it the same way), keep
          // them through the adopt whitelist same as every other field here.
          note: i.note != null ? String(i.note) : null,
        })),
        createdAt: now, updatedAt: now,
      };
      return { ...s, foodRecipes: [copy, ...(s.foodRecipes || [])] };
    });
    setAdded(true);
  }

  return (
    <Sheet open onClose={onClose} title="Shared recipe" titleColor="var(--accent)">
      {state.status === 'loading' && (
        <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, padding: '8px 0 16px' }}>Loading recipe…</div>
      )}
      {state.status === 'error' && (
        <>
          <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 14, lineHeight: '17px' }}>{state.error}</div>
          <Btn onClick={onClose} style={{ width: '100%' }}>Close</Btn>
        </>
      )}
      {state.status === 'ready' && (
        <>
          <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 4 }}>
            {String(state.share.sharedBy || 'A Zane user')} shared a recipe with you:
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, marginBottom: 2 }}>{String(recipe.name || 'Recipe')}</div>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 12 }}>
            {items.length} ingredient{items.length === 1 ? '' : 's'} · makes {recipe.portions || 1} portion{(recipe.portions || 1) === 1 ? '' : 's'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, maxHeight: '38vh', overflowY: 'auto' }}>
            {fdSortIngredientsByQty(items).map((i, idx) => (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, textShadow: 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(i.foodName || 'Item')}</div>
                    <div className="num" style={{ fontSize: 10, color: UI.inkFaint }}>{Math.round(Number(i.quantityG) || 0)}g</div>
                  </div>
                  <span className="num" style={{ fontSize: 11, color: UI.warn, flexShrink: 0 }}>{Math.round(LB.caloriesFromMacros(i.protein, i.carbs, i.fat, netCarbs ? i.fiber : null) || 0)} kcal</span>
                </div>
                {/* Exactly why someone shares a recipe with notes at all: so
                    whoever cooks it (a partner, a roommate) gets the same
                    prep guidance, not just the ingredient list. */}
                {i.note && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, paddingTop: 4, borderTop: `var(--hair-width) dashed ${UI.hairStrong}` }}>
                    <i className="fa-solid fa-note-sticky" style={{ fontSize: 9, color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.4 }}>{String(i.note)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          <FdMacroPreview calories={totals.calories} protein={totals.protein} carbs={totals.carbs} fat={totals.fat} />
          {added ? (
            <>
              <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: '17px' }}>
                <i className="fa-solid fa-check" style={{ marginRight: 6, color: 'var(--accent)' }} />
                Added. You'll find it under Food log, Quick Add, Recipes.
              </div>
              <Btn onClick={onClose} style={{ width: '100%' }}>Done</Btn>
            </>
          ) : (
            <Btn onClick={adopt} style={{ width: '100%' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> Add to my recipes
            </Btn>
          )}
        </>
      )}
    </Sheet>
  );
}

// Recipe editor: a dedicated full page (same "full page, not a Sheet" idiom
// screens-health.jsx's DailyLogScreen uses), not an in-place FoodScreen mode.
// Owns its own draft (name/items/portions) entirely locally; onSave only ever
// receives the finished shape once the user actually confirms saving.
// `recipe` is the recipe being edited, null while creating a new one.
// Plan Mode meal-template manager (full-page overlay, opened from FoodScreen's
// Log tab). Manages the recurring fixum slots (store.foodTemplateSlots) that
// auto-fill each day's plan: a slot is a food or recipe snapshot + a fixed
// hour + a day-type filter (any / training / rest). A slot's food comes from
// the user's existing Favorites or Recipes (the natural home of repeated
// fixums), so there's no separate search here. Adding chooses the amount
// (grams for a food, portions for a recipe); editing an existing slot adjusts
// its hour and day-type (and a food slot's grams), recipe portions are set at
// add time (re-add to change them).
function FoodTemplateScreen({ open, onClose, store, setStore, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [pickerOpen, setPickerOpen] = useStateFd(false);
  const [pickerTab, setPickerTab] = useStateFd('favorites');
  const [pickerQuery, setPickerQuery] = useStateFd('');
  // Database search (Search tab): separate from pickerQuery, which only
  // live-filters the already-loaded favorites/recipes lists. This one is an
  // explicit, network-backed lookup (same LB.searchFoods used everywhere
  // else), so it needs its own query/results/error/loading state.
  const [pickerSearchQuery, setPickerSearchQuery] = useStateFd('');
  const [pickerSearching, setPickerSearching] = useStateFd(false);
  const [pickerSearchError, setPickerSearchError] = useStateFd(null);
  const [pickerResults, setPickerResults] = useStateFd(null);
  // Same All/Zane/OFF/USDA filter the main Search tab has. It only appears once
  // a search has actually run: this sheet is already two rows of chrome deep,
  // and the filter has nothing to act on before there are results.
  const [pickerSource, setPickerSource] = useStateFd(null);
  // Scan entry points for the Search tab, mirroring FoodScreen's own
  // scanPickerOpen/scanOpen/labelScanning/labelError/labelScannerProvider
  // quintet (same shared per-device localStorage key, see
  // logbook-label-scanner-provider in CLAUDE.md).
  const [pickerScanPickerOpen, setPickerScanPickerOpen] = useStateFd(false);
  const [pickerScanOpen, setPickerScanOpen] = useStateFd(false);
  const [pickerLabelScanning, setPickerLabelScanning] = useStateFd(false);
  const [pickerLabelError, setPickerLabelError] = useStateFd(null);
  const [pickerLabelScannerProvider, setPickerLabelScannerProvider] = useStateFd(fdReadScannerProvider);
  useEffectFd(() => {
    const onChange = e => setPickerLabelScannerProvider(e.detail);
    window.addEventListener('zane-scanner-provider', onChange);
    return () => window.removeEventListener('zane-scanner-provider', onChange);
  }, []);
  const pickerLabelInputRef = useRefFd(null);
  const [draft, setDraft] = useStateFd(null);
  const netCarbs = !!store.settings?.netCarbs;
  // A flex plan has no fixed weekday schedule to look ahead at, so a Training/
  // Rest slot's day-type match (LB.isTrainingDayForDate) can't tell in advance
  // either, it defaults to Rest until a session is actually logged or the
  // Health tab's Training|Rest slider is set for that day. Surfaced as a
  // disclaimer at the day-type picker below, the exact point that choice is made.
  const activeFlexPlan = LB.isFlexPlan((store.schedules || []).find(s => s.id === store.activeScheduleId));
  // Snapshot of the draft as it was opened, to detect unsaved edits on
  // backdrop-close (same pattern as RecipeEditorScreen's initialSnap).
  const draftInitialSnap = useRefFd(null);
  const snapDraft = d => JSON.stringify({ gramsStr: d.gramsStr, portions: d.portions, hour: d.hour, dayType: d.dayType });

  // Coach mode mirrors the training PlanScreen: a My Plans / Client Templates
  // split (by isTemplate), and a plan can be pushed to a client.
  const isCoach = (store.coaching?.asCoach || []).some(c => c.status === 'active');
  const coachClients = useMemoFd(() => (store.coaching?.asCoach || []).filter(c => c.status === 'active'), [store.coaching]);
  const [planSubTab, setPlanSubTab] = useStateFd('mine'); // 'mine' | 'templates'
  const [pushPlan, setPushPlan] = useStateFd(null);   // plan being pushed
  const [pushTarget, setPushTarget] = useStateFd(null); // client picked for the activate-choice step
  const [pushBusy, setPushBusy] = useStateFd(false);
  const [pushDone, setPushDone] = useStateFd(null);   // { clientName, planName, activated }

  // Multiple named meal plans (Cut/Bulk/...), exactly one active (mirrors the
  // training schedule model). viewedPlanId is the plan currently being edited
  // on this screen, defaulting to the active one. When coaching, the plan list
  // is bucketed by isTemplate (My Plans vs Client Templates).
  const inBucket = p => !isCoach || (planSubTab === 'templates' ? !!p.isTemplate : !p.isTemplate);
  const plans = useMemoFd(() => (store.foodMealPlans || []).filter(p => !p.archived && inBucket(p)), [store.foodMealPlans, isCoach, planSubTab]);
  const activeId = store.activeMealTemplateId;
  // List/detail split mirroring PlanScreen + PlanViewerScreen: viewedPlanId
  // null means the list is showing, set means a plan's own content is showing.
  const [viewedPlanId, setViewedPlanId] = useStateFd(null);
  const [manageOpen, setManageOpen] = useStateFd(false);  // Duplicate/Export/Delete menu
  const [coachOpen, setCoachOpen] = useStateFd(false);    // Push to client/Mark as client template menu
  const [nameDraft, setNameDraft] = useStateFd(null);     // { id: string|null, name } for create/rename
  // Always land back on the list on (re)open, and bounce back to it if the
  // viewed plan disappears from the current bucket (deleted, archived, or
  // switched out of view by a My Plans <-> Client Templates toggle).
  useEffectFd(() => {
    if (!open) { setViewedPlanId(null); return; }
    if (viewedPlanId && !plans.some(p => p.id === viewedPlanId)) setViewedPlanId(null);
  }, [open, plans]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewedPlan = plans.find(p => p.id === viewedPlanId) || null;

  const slots = useMemoFd(
    () => [...(store.foodTemplateSlots || [])].filter(s => s.mealPlanId === viewedPlanId).sort((a, b) => (a.hour - b.hour) || ((a.sortIdx || 0) - (b.sortIdx || 0))),
    [store.foodTemplateSlots, viewedPlanId],
  );

  function createPlan(name) {
    const id = LB.uid();
    // A plan created while in the coach's Client Templates bucket is a template
    // (never the coach's own active eating plan).
    const asTemplate = isCoach && planSubTab === 'templates';
    setStore(s => {
      const list = s.foodMealPlans || [];
      const plan = { id, name: (name || '').trim() || 'Meal plan', archived: false, isTemplate: asTemplate, coachId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      // The first (or only) NON-template plan becomes active automatically. The
      // membership check also excludes templates so a stale template-active
      // state (e.g. after deleting the last real plan) self-heals: a newly
      // created real plan then correctly claims active.
      const makeActive = !asTemplate && (!s.activeMealTemplateId || !list.some(p => p.id === s.activeMealTemplateId && !p.archived && !p.isTemplate));
      return { ...s, foodMealPlans: [plan, ...list], ...(makeActive ? { activeMealTemplateId: id } : {}) };
    });
    setViewedPlanId(id);
  }
  function renamePlan(id, name) {
    setStore(s => ({ ...s, foodMealPlans: (s.foodMealPlans || []).map(p => p.id === id ? { ...p, name: (name || '').trim() || p.name, updatedAt: new Date().toISOString() } : p) }));
  }
  function activatePlan(id) {
    setStore(s => ({ ...s, activeMealTemplateId: id }));
  }
  async function deletePlan(plan) {
    const n = (store.foodTemplateSlots || []).filter(x => x.mealPlanId === plan.id).length;
    if (!await confirm(`Delete "${plan.name}"${n ? ` and its ${n} meal${n === 1 ? '' : 's'}` : ''}?`, { title: 'Delete plan?', ok: 'Delete', cancel: 'Cancel', danger: true })) return;
    setStore(s => {
      const remainingPlans = (s.foodMealPlans || []).filter(p => p.id !== plan.id);
      const remainingSlots = (s.foodTemplateSlots || []).filter(x => x.mealPlanId !== plan.id);
      // Fall back to a real plan only, never a client template: a coach's own
      // plans and client templates share this array, and an active template
      // would auto-fill the coach's own day and block new plans from activating.
      const nextActive = s.activeMealTemplateId === plan.id ? (remainingPlans.find(p => !p.archived && !p.isTemplate)?.id ?? null) : s.activeMealTemplateId;
      return { ...s, foodMealPlans: remainingPlans, foodTemplateSlots: remainingSlots, activeMealTemplateId: nextActive };
    });
    setManageOpen(false);
    setViewedPlanId(null);
  }
  // Independent copy in the same bucket (mine/templates), inactive until
  // switched to, mirrors PlanScreen's duplicate(). coachId reset: the copy is
  // a new plan in its own right, not literally the plan a coach pushed.
  function duplicatePlan(plan) {
    const newId = LB.uid();
    const now = new Date().toISOString();
    const copy = { ...plan, id: newId, name: plan.name + ' (Copy)', archived: false, coachId: null, createdAt: now, updatedAt: now };
    const slotCopies = (store.foodTemplateSlots || []).filter(s => s.mealPlanId === plan.id).map(s => ({ ...s, id: LB.uid(), mealPlanId: newId, createdAt: now }));
    setStore(s => ({ ...s, foodMealPlans: [copy, ...(s.foodMealPlans || [])], foodTemplateSlots: [...(s.foodTemplateSlots || []), ...slotCopies] }));
    setManageOpen(false);
    setViewedPlanId(newId);
  }
  // The other half of exportPlan. Without it the export wrote a file format
  // nothing could read back, unlike the training plan, which has both halves.
  // Same validation shape the training plan importer uses (type tag first,
  // then the array it needs), because this creates real rows.
  function importPlan() {
    // input.click() must stay synchronous inside the user gesture (iOS Safari).
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      let payload;
      try { payload = JSON.parse(await file.text()); }
      catch (_) { await confirm('The selected file is not valid JSON.', { title: 'Invalid file', ok: 'OK', cancel: null }); return; }
      if (!payload || payload.type !== 'zane-meal-plan' || !Array.isArray(payload.slots)) {
        await confirm('That file is not a Zane meal plan export.', { title: 'Invalid file', ok: 'OK', cancel: null });
        return;
      }
      const id = LB.uid();
      const now = new Date().toISOString();
      const asTemplate = isCoach && planSubTab === 'templates';
      const name = (typeof payload.name === 'string' && payload.name.trim()) ? payload.name.trim() : 'Imported meal plan';
      // Slots are fully denormalized in the export, so they only need fresh
      // ids and the new plan's id. Anything else in the file is ignored.
      const slots = payload.slots
        .filter(sl => sl && typeof sl === 'object')
        .map((sl, i) => ({
          ...sl, id: LB.uid(), mealPlanId: id, createdAt: now,
          hour: Number.isFinite(+sl.hour) ? +sl.hour : 12,
          sortIdx: Number.isFinite(+sl.sortIdx) ? +sl.sortIdx : i,
        }));
      setStore(st => {
        const list = st.foodMealPlans || [];
        const plan = { id, name, archived: false, isTemplate: asTemplate, coachId: null, createdAt: now, updatedAt: now };
        const makeActive = !asTemplate && (!st.activeMealTemplateId || !list.some(p => p.id === st.activeMealTemplateId && !p.archived && !p.isTemplate));
        return {
          ...st,
          foodMealPlans: [plan, ...list],
          foodTemplateSlots: [...(st.foodTemplateSlots || []), ...slots],
          ...(makeActive ? { activeMealTemplateId: id } : {}),
        };
      });
      setManageOpen(false);
      setViewedPlanId(id);
    };
    input.click();
  }
  // Self-contained JSON: each slot already carries its own denormalized food/
  // recipe snapshot (docs/database.md), so there's nothing to look up, unlike
  // a training plan export that has to inline the exercises it references.
  function exportPlan(plan) {
    const slotsOut = (store.foodTemplateSlots || [])
      .filter(s => s.mealPlanId === plan.id)
      .sort((a, b) => (a.hour - b.hour) || ((a.sortIdx || 0) - (b.sortIdx || 0)))
      .map(({ id, mealPlanId, createdAt, ...rest }) => rest);
    const payload = { type: 'zane-meal-plan', version: 1, name: plan.name, slots: slotsOut };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plan.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setManageOpen(false);
  }
  function saveName() {
    if (!nameDraft) return;
    if (nameDraft.id) renamePlan(nameDraft.id, nameDraft.name);
    else createPlan(nameDraft.name);
    setNameDraft(null);
  }
  // Backdrop tap used to drop a typed rename (or a new plan's name) silently.
  // Compared against the name the sheet opened with, so reopening to rename
  // and closing without touching anything never false-triggers this.
  async function requestCloseNameDraft() {
    if (nameDraft && nameDraft.name.trim() !== (nameDraft.initialName || '').trim() && !await confirm("Your changes won't be saved.", { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    setNameDraft(null);
  }
  // Coach bucket flip (My Plans <-> Client Templates), mirrors PlanScreen's
  // toggleTemplate. Pure flag, no data move. A template that gets flipped out
  // of My Plans should also stop being this coach's own active plan.
  function toggleTemplate(plan) {
    setStore(s => ({
      ...s,
      foodMealPlans: (s.foodMealPlans || []).map(p => p.id === plan.id ? { ...p, isTemplate: !p.isTemplate, updatedAt: new Date().toISOString() } : p),
      activeMealTemplateId: (!plan.isTemplate && s.activeMealTemplateId === plan.id) ? null : s.activeMealTemplateId,
    }));
    setCoachOpen(false);
  }
  // Thin wrapper over LB.pushMealPlanToClient (shared with the client-detail
  // Nutrition tab): copies the plan + its slots (+ referenced recipes) into the
  // client's account and optionally activates it. client is a coaching row
  // (client.id = coachingId, client.clientId = the client user id).
  async function pushMealPlanToClient(plan, client, activateNow) {
    setPushBusy(true);
    try {
      await LB.pushMealPlanToClient({
        plan,
        slots: (store.foodTemplateSlots || []).filter(s => s.mealPlanId === plan.id),
        recipes: store.foodRecipes || [],
        coachUserId: userId, coachingId: client.id, clientId: client.clientId, activateNow,
      });
      setPushTarget(null);
      setPushPlan(null);
      setPushDone({ clientName: client.clientName, planName: plan.name, activated: activateNow });
    } catch (e) {
      await confirm(e?.message || 'Push failed. Please try again.', { title: 'Push failed', ok: 'OK', cancel: null });
    } finally {
      setPushBusy(false);
    }
  }

  const per100From = (m, q) => ({
    cal: q ? (m.calories || 0) / q * 100 : 0, p: q ? (m.protein || 0) / q * 100 : 0,
    c: q ? (m.carbs || 0) / q * 100 : 0, f: q ? (m.fat || 0) / q * 100 : 0,
    fib: (m.fiber != null && q) ? m.fiber / q * 100 : null,
    sug: (m.sugar != null && q) ? m.sugar / q * 100 : null,
    sat: (m.satFat != null && q) ? m.satFat / q * 100 : null,
    sod: (m.sodiumMg != null && q) ? m.sodiumMg / q * 100 : null,
  });
  function openAddFood(fav) {
    const q = fav.quantityG || 100;
    setPickerOpen(false);
    const d = { id: null, kind: 'food', foodId: fav.foodId ?? null, foodName: fav.foodName, brand: fav.brand ?? null, source: fav.source ?? null, per100: per100From(fav, q), gramsStr: String(q), hour: 8, dayType: 'any' };
    draftInitialSnap.current = snapDraft(d);
    setDraft(d);
  }
  function openAddRecipe(recipe) {
    setPickerOpen(false);
    const d = { id: null, kind: 'recipe', recipeId: recipe.id, name: recipe.name, recipe, mode: 'portions', portions: 1, gramsStr: '', hour: 8, dayType: 'any' };
    draftInitialSnap.current = snapDraft(d);
    setDraft(d);
  }
  // override lets a scanned barcode search immediately (handlePickerScan),
  // without waiting a tick for setPickerSearchQuery to land first.
  // srcOverride is passed by the source-filter buttons: setPickerSource has not
  // committed yet at the moment they fire, so reading pickerSource off the
  // closure here would search with the PREVIOUS filter.
  async function runPickerFoodSearch(override, srcOverride) {
    const q = (typeof override === 'string' ? override : pickerSearchQuery).trim();
    if (!q || pickerSearching) return;
    setPickerSearching(true); setPickerSearchError(null);
    const res = await LB.searchFoods(q, srcOverride !== undefined ? srcOverride : pickerSource);
    setPickerSearching(false);
    if (!res.ok) { setPickerSearchError(res.error || 'Search failed. Try again.'); setPickerResults([]); return; }
    setPickerResults(res.results);
  }
  // Third way into the config sheet, alongside openAddFood/openAddRecipe:
  // a fresh database pick instead of something already in the user's
  // library. Its per100 rates come straight off the result (no reverse
  // derivation like per100From needs for a favorite's fixed snapshot).
  // sourceId/fromCache ride along on the draft purely so saveDraft can
  // cache the food on commit, same as logging or favoriting one does.
  function openAddSearchResult(r) {
    setPickerOpen(false);
    const d = {
      id: null, kind: 'food', foodId: r.sourceId ? `${r.source}:${r.sourceId}` : null,
      foodName: r.name, brand: r.brand || null, source: r.source, sourceId: r.sourceId, fromCache: !!r.cached,
      per100: { cal: r.kcalPer100g || 0, p: r.proteinPer100g || 0, c: r.carbsPer100g || 0, f: r.fatPer100g || 0, fib: r.fiberPer100g ?? null,
        sug: r.sugarPer100g ?? null, sat: r.satFatPer100g ?? null, sod: r.sodiumMgPer100g ?? null },
      gramsStr: r.servingSizeG != null ? String(Math.round(r.servingSizeG)) : '100',
      hour: 8, dayType: 'any',
    };
    draftInitialSnap.current = snapDraft(d);
    setDraft(d);
  }
  // A scanned barcode runs straight through the normal search (same as
  // FoodScreen's handleScan): the found product shows as a result to tap,
  // no separate code path needed.
  function handlePickerScan(code) {
    setPickerScanOpen(false);
    setPickerSearchQuery(code);
    runPickerFoodSearch(code);
  }
  // Nutrition-label scan, mirrors FoodScreen's handleLabelFile/prefillFromLabel
  // pair, but funnels straight into the config sheet (openAddSearchResult's
  // draft shape) instead of FoodScreen's qty-sheet/custom-item-form pair,
  // since this screen has no manual-macro-entry fallback UI of its own.
  async function handlePickerLabelFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // let the user re-pick the same photo after an error
    if (!file) return;
    setPickerLabelError(null);
    setPickerLabelScanning(true);
    try {
      const { base64, mimeType } = await fdDownscaleImage(file);
      if (!base64) { setPickerLabelScanning(false); setPickerLabelError('Could not read that image. Try again.'); return; }
      const res = await LB.scanLabel(base64, mimeType, pickerLabelScannerProvider);
      setPickerLabelScanning(false);
      if (!res.ok) { setPickerLabelError(res.error || 'Scan failed. Try again.'); return; }
      openAddFromLabel(res.label);
    } catch (_) {
      setPickerLabelScanning(false);
      setPickerLabelError('Could not read that image. Try again.');
    }
  }
  // Same per-100 normalization FoodScreen's prefillFromLabel does (the
  // label's own printed calories never makes it in, calories are derived
  // from protein/carbs/fat like every other source): a 100g/100ml basis is
  // used as-is, a serving-only reading is converted through its stated gram
  // weight. Neither present (no scalable basis at all) has nothing to build
  // a per100 draft from, so it errors rather than guessing. source: 'custom'
  // and no sourceId, same as any hand-typed food: a scanned label is a
  // per-user item, never a shared zane_foods entry, so saveDraft's cache
  // step correctly skips it.
  function openAddFromLabel(label) {
    if (!label || label.is_nutrition_label === false) {
      setPickerLabelError("That doesn't look like a nutrition label. Try a straight-on photo of the table.");
      return;
    }
    const cal = label.calories, p = label.protein_g, c = label.carbs_g, f = label.fat_g, fib = label.fiber_g;
    const sug = label.sugar_g, sat = label.sat_fat_g, sod = label.sodium_mg;
    if (cal == null && p == null && c == null && f == null) {
      setPickerLabelError('Could not read the values. Try a clearer photo.');
      return;
    }
    const per100 = (label.basis === '100g' || label.basis === '100ml')
      ? { p, c, f, fib, sug, sat, sod }
      : (label.serving_size_g > 0)
        ? (k => ({
            p: p != null ? p * k : null, c: c != null ? c * k : null, f: f != null ? f * k : null,
            fib: fib != null ? fib * k : null, sug: sug != null ? sug * k : null,
            sat: sat != null ? sat * k : null, sod: sod != null ? sod * k : null,
          }))(100 / label.serving_size_g)
        : null;
    if (!per100) {
      setPickerLabelError('Could not tell the portion size from this label. Try a photo that shows the serving size, or use Search instead.');
      return;
    }
    setPickerOpen(false);
    const d = {
      id: null, kind: 'food', foodId: null,
      foodName: label.name || '', brand: label.brand || null, source: 'custom',
      per100: { cal: LB.caloriesFromMacros(per100.p, per100.c, per100.f, netCarbs ? per100.fib : null) || 0, p: per100.p || 0, c: per100.c || 0, f: per100.f || 0, fib: per100.fib ?? null,
        sug: per100.sug ?? null, sat: per100.sat ?? null, sod: per100.sod ?? null },
      gramsStr: label.serving_size_g > 0 ? String(Math.round(label.serving_size_g)) : '100',
      hour: 8, dayType: 'any',
    };
    draftInitialSnap.current = snapDraft(d);
    setDraft(d);
  }
  function openEditSlot(slot) {
    let d;
    if (slot.source === 'recipe') {
      d = { id: slot.id, kind: 'recipe', recipeId: slot.recipeId ?? null, name: slot.foodName, recipe: null, portions: null, hour: slot.hour, dayType: slot.dayType, slot };
    } else {
      const q = slot.quantityG || 100;
      d = { id: slot.id, kind: 'food', foodId: slot.foodId ?? null, foodName: slot.foodName, brand: slot.brand ?? null, source: slot.source ?? null, per100: per100From(slot, q), gramsStr: String(q), hour: slot.hour, dayType: slot.dayType };
    }
    draftInitialSnap.current = snapDraft(d);
    setDraft(d);
  }
  // Backdrop tap used to drop an in-progress add (or an edit's unsaved hour/
  // day-type/amount changes) silently.
  async function requestCloseDraft() {
    if (draft && snapDraft(draft) !== draftInitialSnap.current && !await confirm("Your changes won't be added.", { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    setDraft(null);
  }
  async function deleteSlot(slot) {
    if (!await confirm(`${slot.foodName}`, { title: 'Remove meal?', ok: 'Remove', cancel: 'Cancel', danger: true })) return;
    setStore(s => ({ ...s, foodTemplateSlots: (s.foodTemplateSlots || []).filter(x => x.id !== slot.id) }));
  }

  // Manually pull the template back into today's plan: the escape hatch for
  // when the day's entries were cleared (on purpose or by accident) and the
  // user changes their mind. Adds every matching slot not already present today
  // as a planned entry, deduped by templateSlotId, bypassing the once-per-day
  // auto-fill marker (which is exactly what's stopping auto-fill from redoing
  // it). Closes back to the log so the result is visible right away.
  async function applyToToday() {
    const todayISO = LB.todayISO();
    // Applies the ACTIVE plan (that's what auto-fills the log), regardless of
    // which plan is being viewed.
    const inActive = slot => slot.mealPlanId === activeId;
    const present = new Set((store.foodLogs || []).filter(l => l.date === todayISO && l.templateSlotId).map(l => l.templateSlotId));
    const pending = (store.foodTemplateSlots || []).filter(slot => inActive(slot) && fdSlotMatchesDate(slot, store, todayISO) && !present.has(slot.id));
    if (!pending.length) {
      await confirm("Your active plan's meals are already in today's plan.", { title: 'Nothing to add', ok: 'OK', cancel: null });
      return;
    }
    setStore(s => {
      const present2 = new Set((s.foodLogs || []).filter(l => l.date === todayISO && l.templateSlotId).map(l => l.templateSlotId));
      const entries = (s.foodTemplateSlots || []).filter(slot => slot.mealPlanId === s.activeMealTemplateId && fdSlotMatchesDate(slot, s, todayISO) && !present2.has(slot.id)).map(slot => fdMaterializeSlotEntry(slot, todayISO));
      return entries.length ? { ...s, foodLogs: [...entries, ...(s.foodLogs || [])] } : s;
    });
    onClose();
  }

  // Live macros for the config sheet. A food slot scales its per-100g base by
  // the typed grams; a recipe slot (add only) scales the recipe by portions,
  // exactly like confirmRecipeLog. A recipe EDIT keeps the slot's stored macros
  // (only hour/day-type change), so it has no live recompute.
  const draftBuilt = useMemoFd(() => {
    if (!draft) return null;
    if (draft.kind === 'food') {
      const g = fdNum(draft.gramsStr);
      if (g == null || !(g > 0)) return null;
      const sc = g / 100;
      return {
        foodId: draft.foodId, foodName: draft.foodName, brand: draft.brand, source: draft.source,
        quantityG: g, calories: Math.round(draft.per100.cal * sc), protein: fdRound1(draft.per100.p * sc),
        carbs: fdRound1(draft.per100.c * sc), fat: fdRound1(draft.per100.f * sc),
        fiber: draft.per100.fib != null ? fdRound1(draft.per100.fib * sc) : null,
        sugar: draft.per100.sug != null ? fdRound1(draft.per100.sug * sc) : null,
        satFat: draft.per100.sat != null ? fdRound1(draft.per100.sat * sc) : null,
        sodiumMg: draft.per100.sod != null ? Math.round(draft.per100.sod * sc) : null,
        recipeItems: null, recipeId: null, loggedTotalPortions: null,
      };
    }
    if (draft.recipe) {
      const recipe = draft.recipe;
      const items = recipe.items || [];
      const totalPortions = recipe.portions || 1;
      // Same grams-mode resolution as the direct-log prompt's
      // fdEffectiveChosenPortions, just against draft's own field names
      // (portions here, not chosenPortions).
      const gramsMode = draft.mode === 'grams' && recipe.cookedWeightG > 0;
      const gramsVal = gramsMode ? (fdNum(draft.gramsStr) || 0) : null;
      const chosenPortions = gramsMode ? fdGramsToPortions(gramsVal, recipe.cookedWeightG, totalPortions) : draft.portions;
      // Same guard the food branch above already has (g == null || !(g > 0)):
      // a cleared/zero grams field here would otherwise build and let
      // saveDraft persist a permanent, recurring 0-calorie template slot.
      if (!(chosenPortions > 0)) return null;
      const scale = chosenPortions / totalPortions;
      const sum = k => items.reduce((a, i) => a + (i[k] || 0), 0);
      const recipeItems = items.map(i => ({
        foodId: i.foodId ?? null, brand: i.brand ?? null,
        foodName: i.foodName, quantityG: Math.round((i.quantityG || 0) * scale),
        calories: Math.round((LB.caloriesFromMacros(i.protein, i.carbs, i.fat, netCarbs ? i.fiber : null) || 0) * scale),
        protein: fdRound1((i.protein || 0) * scale), carbs: fdRound1((i.carbs || 0) * scale),
        fat: fdRound1((i.fat || 0) * scale), fiber: i.fiber != null ? fdRound1(i.fiber * scale) : null,
        sugar: i.sugar != null ? fdRound1(i.sugar * scale) : null,
        satFat: i.satFat != null ? fdRound1(i.satFat * scale) : null,
        sodiumMg: i.sodiumMg != null ? Math.round(i.sodiumMg * scale) : null,
      }));
      return {
        foodId: null,
        foodName: gramsMode ? (gramsVal !== recipe.cookedWeightG ? `${recipe.name} (${gramsVal}g)` : recipe.name)
          : draft.portions !== totalPortions ? `${recipe.name} (${draft.portions}/${totalPortions})` : recipe.name,
        brand: null, source: 'recipe', quantityG: Math.round(sum('quantityG') * scale),
        calories: Math.round(fdRecipeItemsCalories(items, netCarbs) * scale), protein: fdRound1(sum('protein') * scale),
        carbs: fdRound1(sum('carbs') * scale), fat: fdRound1(sum('fat') * scale),
        fiber: items.some(i => i.fiber != null) ? fdRound1(sum('fiber') * scale) : null,
        sugar: items.some(i => i.sugar != null) ? fdRound1(sum('sugar') * scale) : null,
        satFat: items.some(i => i.satFat != null) ? fdRound1(sum('satFat') * scale) : null,
        sodiumMg: items.some(i => i.sodiumMg != null) ? Math.round(sum('sodiumMg') * scale) : null,
        recipeItems, recipeId: recipe.id, loggedTotalPortions: totalPortions,
        loggedCookedGrams: gramsVal, loggedCookedWeightG: gramsMode ? recipe.cookedWeightG : null,
      };
    }
    // recipe edit: no macro recompute, reuse the existing slot's food fields.
    return { ...draft.slot };
  }, [draft, netCarbs]);

  function saveDraft() {
    if (!draft || !draftBuilt) return;
    // A fresh database pick (openAddSearchResult) may never have been cached
    // before; fire-and-forget like confirmLogFood does, not awaited like
    // toggleFavorite has to be, since food_id on template slots is a plain
    // text column (no FK into zane_foods) unlike favorites/logs.
    if (draft.sourceId) ensureFoodCached(draft);
    const common = { hour: draft.hour, dayType: draft.dayType };
    const todayISO = LB.todayISO();
    setStore(s => {
      const list = s.foodTemplateSlots || [];
      // Edit: update the slot only. Existing materialized entries for today keep
      // their own (possibly already-eaten) state, not retro-rewritten from here.
      if (draft.id) {
        return { ...s, foodTemplateSlots: list.map(x => x.id === draft.id ? { ...x, ...draftBuilt, ...common } : x) };
      }
      const sortIdx = list.filter(x => x.mealPlanId === viewedPlanId).reduce((m, x) => Math.max(m, x.sortIdx || 0), 0) + 1;
      const slot = { id: LB.uid(), ...draftBuilt, ...common, mealPlanId: viewedPlanId, sortIdx, createdAt: new Date().toISOString() };
      // Fill today right away so a freshly added fixum shows in today's plan,
      // not only from tomorrow's auto-fill. ONLY when this plan is the active
      // one (an inactive plan never auto-fills, so editing it must not leak
      // into today), the day type matches, and no copy is already there. The
      // once-per-day marker is unaffected, and templateSlotId dedup keeps the
      // effect from adding a second copy.
      let foodLogs = s.foodLogs || [];
      const alreadyToday = foodLogs.some(l => l.date === todayISO && l.templateSlotId === slot.id);
      if (viewedPlanId === s.activeMealTemplateId && fdSlotMatchesDate(slot, s, todayISO) && !alreadyToday) {
        foodLogs = [fdMaterializeSlotEntry(slot, todayISO), ...foodLogs];
      }
      return { ...s, foodTemplateSlots: [...list, slot], foodLogs };
    });
    setDraft(null);
  }

  const favs = useMemoFd(() => {
    const q = pickerQuery.trim().toLowerCase();
    const list = q ? (store.foodFavorites || []).filter(f => f.foodName.toLowerCase().includes(q) || (f.brand || '').toLowerCase().includes(q)) : (store.foodFavorites || []);
    return [...list].sort((a, b) => a.foodName.localeCompare(b.foodName));
  }, [store.foodFavorites, pickerQuery]);
  const recipes = useMemoFd(() => {
    const q = pickerQuery.trim().toLowerCase();
    const list = q ? (store.foodRecipes || []).filter(r => r.name.toLowerCase().includes(q)) : (store.foodRecipes || []);
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [store.foodRecipes, pickerQuery]);

  if (!open) return null;
  // Meal count badge, the closest food analog to a training plan's day pills.
  const slotCountFor = pid => (store.foodTemplateSlots || []).filter(s => s.mealPlanId === pid).length;

  return (
    <Screen style={{ position: 'fixed', inset: 0, zIndex: 100, animation: 'sheet-up 0.22s ease' }}>
      <TopBar title={viewedPlan ? viewedPlan.name : 'Meal plans'}
        onBack={viewedPlan ? () => setViewedPlanId(null) : onClose}
        right={viewedPlan ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setPickerQuery(''); setPickerSearchQuery(''); setPickerResults(null); setPickerSearchError(null); setPickerLabelError(null); setPickerOpen(true); }} aria-label="Add a meal" style={fdTopAddBtn}>
              <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
            </button>
            <button className="label" onClick={() => setNameDraft({ id: viewedPlan.id, name: viewedPlan.name, initialName: viewedPlan.name })} style={fdEditBtn}>Edit</button>
          </div>
        ) : (
          <button onClick={() => setNameDraft({ id: null, name: '', initialName: '' })} aria-label="New meal plan" style={fdTopAddBtn}>
            <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
          </button>
        )} />
      <div style={{ padding: '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {confirmEl}
        {!viewedPlan && isCoach && (
          <SubTabBar tabs={[{ id: 'mine', label: 'My Plans' }, { id: 'templates', label: 'Client Templates' }]} active={planSubTab} onChange={setPlanSubTab} />
        )}

        {!viewedPlan ? (
          plans.length === 0 ? (
            <div style={fdEmptyHint}>No meal plan yet. Create one (e.g. "Cut" or "Bulk") to start planning your recurring meals.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plans.filter(p => p.id === activeId).map(p => {
                const n = slotCountFor(p.id);
                return (
                  <BracketFrame key={p.id} gold onClick={() => setViewedPlanId(p.id)} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                      <div className="display" style={{ fontSize: 22, color: UI.gold, lineHeight: '24px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <Pill gold>active</Pill>
                    </div>
                    <div className="micro" style={{ marginBottom: n > 0 ? 10 : 0 }}>{n} meal{n === 1 ? '' : 's'}</div>
                    {n > 0 && (
                      <Btn kind="ghost" onClick={e => { e.stopPropagation(); applyToToday(); }} style={{ width: '100%', marginTop: 4 }}>
                        <i className="fa-regular fa-calendar-plus" style={{ marginRight: 8 }} /> Apply to today's plan
                      </Btn>
                    )}
                  </BracketFrame>
                );
              })}
              {plans.filter(p => p.id !== activeId).map(p => {
                const n = slotCountFor(p.id);
                return (
                  <Frame key={p.id} onClick={() => setViewedPlanId(p.id)} style={{ cursor: 'pointer', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                      <div className="display" style={{ fontSize: 20, color: UI.ink, lineHeight: 1.1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      {p.isTemplate && <Pill>template</Pill>}
                    </div>
                    <div className="micro">{n} meal{n === 1 ? '' : 's'}</div>
                  </Frame>
                );
              })}
            </div>
          )
        ) : (
          <>
            {viewedPlan.isTemplate ? (
              <div style={fdStatusBox(false)}>
                <span className="label" style={{ color: UI.inkSoft, marginBottom: 0 }}>Client template</span>
              </div>
            ) : viewedPlanId === activeId ? (
              <div style={fdStatusBox(true)}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: UI.gold, flexShrink: 0 }} />
                <span className="label" style={{ color: UI.gold, marginBottom: 0 }}>Active</span>
              </div>
            ) : (
              <Btn kind="ghost" onClick={() => activatePlan(viewedPlanId)} style={{ width: '100%' }}>Activate</Btn>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => setManageOpen(true)} style={{ flex: 1, fontSize: 12 }}>Manage</Btn>
              {isCoach && <Btn kind="ghost" onClick={() => setCoachOpen(true)} style={{ flex: 1, fontSize: 12 }}>Coach</Btn>}
            </div>

            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
              Recurring meals for this plan. The active plan auto-fills each day as planned entries, filtered by day type. Check them off as you eat.
            </div>

            {slots.length === 0 ? (
              <Btn onClick={() => { setPickerQuery(''); setPickerSearchQuery(''); setPickerResults(null); setPickerSearchError(null); setPickerLabelError(null); setPickerOpen(true); }} style={{ width: '100%' }}>
                <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> Add a meal
              </Btn>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {slots.map(slot => (
                  <div key={slot.id} style={fdEntryCard}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 40, flexShrink: 0, textAlign: 'center' }}>
                        <span className="num" style={{ fontSize: 15, color: UI.inkSoft }}>{String(slot.hour).padStart(2, '0')}</span>
                        <div className="num" style={{ fontSize: 9, color: UI.inkGhost }}>:00</div>
                      </div>
                      <div onClick={() => openEditSlot(slot)} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1, cursor: 'pointer' }}>
                        <span style={fdEntryName}>
                          <Pill gold={slot.dayType !== 'any'} style={{ marginRight: 6, verticalAlign: 'middle' }}>
                            {slot.dayType === 'training' ? 'train' : slot.dayType === 'rest' ? 'rest' : 'daily'}
                          </Pill>
                          {slot.foodName}
                        </span>
                        <span style={fdEntryMeta}>
                          {fdDisplayG(slot) ? `${fdDisplayG(slot)}g · ` : ''}<span className="num" style={{ color: UI.warn }}>{slot.calories} kcal</span>
                          <span style={fdMetaDivider} />
                          <FdMacroBits protein={slot.protein} carbs={slot.carbs} fat={slot.fat} />
                        </span>
                      </div>
                      <button onClick={() => openEditSlot(slot)} aria-label="Edit" style={fdInlineDeleteBtn}>
                        <i className="fa-solid fa-pen" style={{ fontSize: 11 }} />
                      </button>
                      <button onClick={() => deleteSlot(slot)} aria-label="Remove" style={fdInlineDeleteBtn}>
                        <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Food source picker: the user's Favorites and Recipes, or a fresh database search */}
      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add a meal" titleColor="var(--accent)">
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 10 }}>
          {[['search', 'Search'], ['favorites', 'Favorites'], ['recipes', 'Recipes']].map(([id, label]) => (
            <button key={id} onClick={() => setPickerTab(id)} style={fdSegBtn(pickerTab === id)}>{label}</button>
          ))}
        </div>
        {pickerTab === 'search' ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <input value={pickerSearchQuery} onChange={e => setPickerSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runPickerFoodSearch(); }}
                  type="text" placeholder="Search food, or scan →" style={{ ...fdInputStyle, paddingRight: 32 }} />
                {pickerSearchQuery && (
                  <button onClick={() => { setPickerSearchQuery(''); setPickerResults(null); setPickerSearchError(null); }} aria-label="Clear search" style={fdClearBtn}>
                    <i className="fa-solid fa-circle-xmark" style={{ fontSize: 15 }} />
                  </button>
                )}
              </div>
              <button onClick={() => setPickerScanPickerOpen(true)} aria-label="Scan barcode or nutrition label" style={fdSearchBtn}>
                <i className="fa-solid fa-barcode" style={{ fontSize: 14 }} />
              </button>
              <button onClick={() => runPickerFoodSearch()} disabled={pickerSearching || !pickerSearchQuery.trim()} aria-label="Search" style={fdSearchBtn}>
                {pickerSearching ? <span style={{ fontFamily: UI.fontUi, fontSize: 11 }}>…</span> : <i className="fa-solid fa-magnifying-glass" style={{ fontSize: 13 }} />}
              </button>
            </div>
            {pickerResults != null && (
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 10 }}>
                {FD_SOURCE_FILTERS.map(f => (
                  <button key={f.label} onClick={() => { setPickerSource(f.id); runPickerFoodSearch(undefined, f.id); }} style={fdSegBtn(pickerSource === f.id)}>{f.label}</button>
                ))}
              </div>
            )}
            {pickerSearchError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginBottom: 10 }}>{pickerSearchError}</div>}
            {pickerLabelError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginBottom: 10, lineHeight: '16px' }}>{pickerLabelError}</div>}
            {pickerResults != null && (
              pickerResults.length === 0 ? <div style={fdEmptyHint}>No matches. Try a different search.</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '46vh', overflowY: 'auto' }}>
                  {pickerResults.map(r => {
                    // Same guard the main Search tab applies: no macros means
                    // no usable nutrition, so the hit stays visible but inert
                    // rather than seeding a 0 kcal slot.
                    const noData = r.kcalPer100g == null;
                    return (
                      <button key={`${r.source}:${r.sourceId}`} onClick={() => openAddSearchResult(r)} disabled={noData}
                        style={{ ...fdResultRow, ...(noData ? { cursor: 'default', opacity: 0.55 } : null) }}>
                        <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                          <div style={fdEntryName}>{r.name}</div>
                          {r.brand && <div style={fdEntryMeta}>{r.brand}</div>}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          {noData
                            ? <div style={fdEntryMeta}>No nutrition data</div>
                            : <>
                                <div className="num" style={{ fontSize: 12, color: UI.warn }}>{Math.round(r.kcalPer100g)} kcal</div>
                                <div style={fdEntryMeta}>/100g</div>
                              </>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            )}
          </>
        ) : (
          <>
            <input value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} type="text" placeholder="Filter…" style={{ ...fdInputStyle, marginBottom: 10 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '46vh', overflowY: 'auto' }}>
              {pickerTab === 'favorites' ? (
                favs.length === 0 ? <div style={fdEmptyHint}>No favorites yet. Star a food while adding it to save it here.</div>
                : favs.map(f => (
                  <button key={f.id} onClick={() => openAddFood(f)} style={fdResultRow}>
                    <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                      <div style={fdEntryName}>{f.foodName}</div>
                      <div style={fdEntryMeta}>{f.quantityG}g · <span className="num" style={{ color: UI.warn }}>{f.calories} kcal</span></div>
                    </div>
                    <i className="fa-solid fa-plus" style={{ fontSize: 12, color: 'var(--accent)' }} />
                  </button>
                ))
              ) : (
                recipes.length === 0 ? <div style={fdEmptyHint}>No recipes yet. Build one from a few ingredients you log together often.</div>
                : recipes.map(r => (
                  <button key={r.id} onClick={() => openAddRecipe(r)} style={fdResultRow}>
                    <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                      <div style={fdEntryName}>{r.name}</div>
                      <div style={fdEntryMeta}>{r.portions} portion{r.portions === 1 ? '' : 's'}</div>
                    </div>
                    <i className="fa-solid fa-plus" style={{ fontSize: 12, color: 'var(--accent)' }} />
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </Sheet>

      {/* ── Barcode vs. label picker (opened by the Search tab's scan button) ── */}
      <Sheet open={pickerScanPickerOpen} onClose={() => setPickerScanPickerOpen(false)} title="Scan" titleColor="var(--accent)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <button onClick={() => { setPickerScanPickerOpen(false); setPickerScanOpen(true); }} style={fdScanChoice}>
            <i className="fa-solid fa-barcode" style={{ fontSize: 22, color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>Barcode</span>
            <span style={{ fontSize: 10, color: UI.inkFaint, lineHeight: 1.3 }}>The code on the packaging</span>
          </button>
          <button onClick={() => { setPickerScanPickerOpen(false); setPickerLabelError(null); pickerLabelInputRef.current && pickerLabelInputRef.current.click(); }} style={fdScanChoice}>
            <i className="fa-solid fa-camera" style={{ fontSize: 22, color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>Nutrition label</span>
            <span style={{ fontSize: 10, color: UI.inkFaint, lineHeight: 1.3 }}>Photograph the facts table</span>
          </button>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="micro" style={{ marginBottom: 6 }}>Label reader (nutrition label only)</div>
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
            {[['grok', 'Grok'], ['claude', 'Claude']].map(([id, label]) => (
              <button key={id} onClick={() => { setPickerLabelScannerProvider(id); fdWriteScannerProvider(id); }} style={fdSegBtn(pickerLabelScannerProvider === id)}>{label}</button>
            ))}
          </div>
        </div>
      </Sheet>

      {/* Hidden picker: opens the native camera (capture) or gallery on tap,
          which works on iOS Safari without any library. */}
      <input ref={pickerLabelInputRef} type="file" accept="image/*" capture="environment" onChange={handlePickerLabelFile} style={{ display: 'none' }} />
      {pickerLabelScanning && <FdLabelBusy />}
      {pickerScanOpen && <FdScanner onClose={() => setPickerScanOpen(false)} onDetect={handlePickerScan} />}

      {/* Slot config: amount + hour + day type */}
      <Sheet open={!!draft} onClose={requestCloseDraft} title={draft?.foodName || draft?.name || 'Meal slot'} titleColor="var(--accent)">
        {draft && (
          <>
            {draft.kind === 'food' ? (
              <Field label="Amount (g)" style={{ marginBottom: 14 }}>
                <input value={draft.gramsStr} onChange={e => setDraft(d => ({ ...d, gramsStr: fdDecimalFilter(e.target.value) }))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
              </Field>
            ) : draft.recipe ? (
              <div style={{ marginBottom: 14 }}>
                {draft.recipe.cookedWeightG > 0 && (
                  <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 12 }}>
                    {[['portions', 'Portions'], ['grams', 'Grams']].map(([id, label]) => (
                      <button key={id} onClick={() => setDraft(d => {
                        // Carries the current amount across in whichever
                        // direction, same reasoning as the direct-log
                        // prompt's own toggle.
                        if (!d || d.mode === id) return d;
                        if (id === 'grams') {
                          return { ...d, mode: id, gramsStr: String(Math.max(0, Math.round(fdPortionsToGrams(d.portions, d.recipe.cookedWeightG, d.recipe.portions || 1)))) };
                        }
                        return { ...d, mode: id, portions: Math.max(0.5, Math.round(fdGramsToPortions(fdNum(d.gramsStr) || 0, d.recipe.cookedWeightG, d.recipe.portions || 1) * 2) / 2) };
                      })} style={fdSegBtn(draft.mode === id)}>{label}</button>
                    ))}
                  </div>
                )}
                {draft.mode === 'grams' ? (
                  // Free-typed, not a Stepper: grams spans too wide a range
                  // for a fixed step to ever be the right size, unlike
                  // portions below where a half-step really is normally the
                  // whole adjustment.
                  <Field label="Amount (g)">
                    <input value={draft.gramsStr} onChange={e => setDraft(d => ({ ...d, gramsStr: fdDecimalFilter(e.target.value) }))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
                  </Field>
                ) : (
                  <>
                    <div className="micro" style={{ marginBottom: 8, textAlign: 'center' }}>Portions</div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Stepper value={draft.portions} step={0.5} min={0.5} suffix={draft.portions === 1 ? ' portion' : ' portions'}
                        onChange={v => setDraft(d => ({ ...d, portions: Math.max(0.5, Math.round(v * 2) / 2) }))} big />
                    </div>
                  </>
                )}
              </div>
            ) : null}
            {draftBuilt && (
              <FdMacroPreview calories={draftBuilt.calories} protein={draftBuilt.protein} carbs={draftBuilt.carbs} fat={draftBuilt.fat} marginBottom={14} />
            )}
            <div className="micro" style={{ marginBottom: 6 }}>Time</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <Stepper value={draft.hour} step={1} min={0} max={23} suffix=":00"
                onChange={v => setDraft(d => ({ ...d, hour: Math.max(0, Math.min(23, Math.round(v))) }))} big />
            </div>
            <div className="micro" style={{ marginBottom: 6 }}>Day type</div>
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: draft.dayType !== 'any' && activeFlexPlan ? 10 : 16 }}>
              {[['any', 'Every day'], ['training', 'Training'], ['rest', 'Rest']].map(([id, label]) => (
                <button key={id} onClick={() => setDraft(d => ({ ...d, dayType: id }))} style={fdSegBtn(draft.dayType === id)}>{label}</button>
              ))}
            </div>
            {draft.dayType !== 'any' && activeFlexPlan && (
              <div style={{ marginBottom: 16, padding: '8px 10px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgInset }}>
                <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: '16px' }}>
                  <i className="fa-solid fa-circle-info" style={{ marginRight: 5, color: UI.inkFaint }} />
                  Your active plan is flexible, so there's no fixed schedule to check ahead of time. A day only counts as Training once you've actually trained or set it manually in the Health tab, until then it's assumed to be Rest.
                </span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => setDraft(null)} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={saveDraft} disabled={!draftBuilt} style={{ flex: 2 }}>{draft.id ? 'Save' : 'Add meal'}</Btn>
            </div>
          </>
        )}
      </Sheet>

      {/* Manage: duplicate / export / delete */}
      <Sheet open={manageOpen} onClose={() => setManageOpen(false)} title="Manage plan" titleColor="var(--accent)">
        {viewedPlan && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Btn onClick={() => duplicatePlan(viewedPlan)} style={{ width: '100%' }}>
              <i className="fa-solid fa-copy" style={{ marginRight: 8 }} /> Duplicate
            </Btn>
            <Btn kind="ghost" onClick={() => exportPlan(viewedPlan)} style={{ width: '100%' }}>
              <i className="fa-solid fa-file-export" style={{ marginRight: 8 }} /> Export (JSON)
            </Btn>
            <Btn kind="ghost" onClick={importPlan} style={{ width: '100%' }}>
              <i className="fa-solid fa-file-import" style={{ marginRight: 8 }} /> Import (JSON)
            </Btn>
            <Btn kind="ghost" onClick={() => deletePlan(viewedPlan)} style={{ width: '100%', color: UI.danger }}>
              <i className="fa-solid fa-trash" style={{ marginRight: 8 }} /> Delete plan
            </Btn>
          </div>
        )}
      </Sheet>

      {/* Coach: push to client / template bucket */}
      <Sheet open={coachOpen} onClose={() => setCoachOpen(false)} title="Coaching" titleColor="var(--accent)">
        {viewedPlan && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Btn onClick={() => { const p = viewedPlan; setCoachOpen(false); setPushPlan(p); }} style={{ width: '100%' }}>
              <i className="fa-solid fa-paper-plane" style={{ marginRight: 8 }} /> Push to client
            </Btn>
            <Btn kind="ghost" onClick={() => toggleTemplate(viewedPlan)} style={{ width: '100%' }}>
              <i className="fa-solid fa-user-group" style={{ marginRight: 8 }} /> {viewedPlan.isTemplate ? 'Move to My Plans' : 'Mark as client template'}
            </Btn>
          </div>
        )}
      </Sheet>

      {/* Push: pick a client */}
      <Sheet open={!!pushPlan && !pushTarget} onClose={() => setPushPlan(null)} title="Push to client" titleColor="var(--accent)">
        {pushPlan && (
          <>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: 1.5 }}>
              Copies "{pushPlan.name}" (and any recipes it uses) into a client's account. You'll pick whether it activates right away.
            </div>
            {coachClients.length === 0 ? <div style={fdEmptyHint}>No active clients.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {coachClients.map(c => (
                  <button key={c.id} onClick={() => setPushTarget(c)} style={fdResultRow}>
                    <span style={{ flex: 1, textAlign: 'left', ...fdEntryName }}>{c.clientName || 'Client'}</span>
                    <i className="fa-solid fa-chevron-right" style={{ fontSize: 12, color: UI.inkFaint }} />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Sheet>

      {/* Push: activate now vs add only */}
      <Sheet open={!!pushTarget} onClose={() => !pushBusy && setPushTarget(null)} title={pushTarget?.clientName || 'Client'} titleColor="var(--accent)">
        {pushTarget && pushPlan && (
          <>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.5 }}>
              Activate "{pushPlan.name}" for them right away, or just add it to their meal plans and talk it through first?
            </div>
            <Btn onClick={() => pushMealPlanToClient(pushPlan, pushTarget, true)} disabled={pushBusy} style={{ width: '100%', marginBottom: 8 }}>
              {pushBusy ? 'Pushing…' : 'Push & activate now'}
            </Btn>
            <Btn kind="ghost" onClick={() => pushMealPlanToClient(pushPlan, pushTarget, false)} disabled={pushBusy} style={{ width: '100%' }}>
              {pushBusy ? 'Pushing…' : 'Add only, talk to them first'}
            </Btn>
          </>
        )}
      </Sheet>

      {/* Push: success */}
      <Sheet open={!!pushDone} onClose={() => setPushDone(null)} title="Pushed" titleColor="var(--accent)">
        {pushDone && (
          <>
            <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: '20px' }}>
              "{pushDone.planName}" is in {pushDone.clientName}'s account{pushDone.activated ? ' and active now' : ', not activated yet'}.
            </div>
            <Btn onClick={() => setPushDone(null)} style={{ width: '100%' }}>Done</Btn>
          </>
        )}
      </Sheet>

      {/* Create / rename a plan */}
      <Sheet open={!!nameDraft} onClose={requestCloseNameDraft} title={nameDraft?.id ? 'Rename plan' : 'New meal plan'} titleColor="var(--accent)">
        {nameDraft && (
          <>
            <Field label="Name" style={{ marginBottom: 16 }}>
              <TextInput value={nameDraft.name} onChange={v => setNameDraft(d => ({ ...d, name: v }))} placeholder="e.g. Cut, Bulk, Maintenance" />
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => setNameDraft(null)} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={saveName} disabled={!nameDraft.name.trim()} style={{ flex: 2 }}>{nameDraft.id ? 'Save' : 'Create'}</Btn>
            </div>
          </>
        )}
      </Sheet>
    </Screen>
  );
}

// What to buy: mostly a read/derive view over fdBuildShoppingList (see there
// for the full merge logic), setStore is only for the per-food prefs
// (fdSetShoppingPref); still no userId/useConfirm like its siblings, it
// never touches Supabase directly or needs a destructive-action confirm.
function ShoppingListScreen({ open, onClose, store, setStore, today, userId }) {
  // 'list' is the default/most-opened path (see fdBuildInventoryList's own
  // comment): the Running Low section and its banner stay there rather than
  // moving to 'inventory', so the warning still surfaces on the path a user
  // actually opens often, not just the one dedicated to browsing stock.
  const [screenTab, setScreenTab] = useStateFd('list'); // 'list' | 'inventory'
  // store.foodLogs is boot-windowed (FOOD_HISTORY_WINDOW_DAYS), which
  // understates consumption, and so overstates stock, for a baseline set
  // further back than that (a bulk item bought a few times a year). Lazily
  // fetched in full from the DB whenever the Shopping List screen is open at
  // all, not gated to the Inventory tab: the Running Low section/banner
  // render on the default 'list' tab too (see screenTab's own comment
  // above), so gating this fetch on 'inventory' left it reading stale,
  // boot-windowed stock on the very tab most people actually see it on.
  // Reset to null on closing the screen so the next open always refetches
  // current data, not a stale snapshot.
  const [stockBackfill, setStockBackfill] = useStateFd(null);
  // Surfaces a failed fetch (network hiccup, etc.) instead of silently
  // falling back to logsForStock's boot-windowed data with no visible sign
  // the stock numbers on screen might be understating consumption.
  const [stockBackfillError, setStockBackfillError] = useStateFd(false);
  useEffectFd(() => {
    if (!open) { setStockBackfill(null); setStockBackfillError(false); return; }
    const oldestBaseline = (store.foodShoppingPrefs || []).reduce((min, p) => (p.stockSetAt && (!min || p.stockSetAt < min)) ? p.stockSetAt : min, null);
    if (!oldestBaseline) return;
    let cancelled = false;
    setStockBackfillError(false);
    LB.fetchFoodLogsSince(userId, oldestBaseline.slice(0, 10))
      .then(rows => { if (!cancelled) setStockBackfill(rows); })
      .catch(err => { console.error('food stock backfill fetch failed:', err); if (!cancelled) setStockBackfillError(true); });
    return () => { cancelled = true; };
  }, [open, store.foodShoppingPrefs, userId]);
  const logsForStock = stockBackfill || store.foodLogs;
  const [shoppingDays, setShoppingDays] = useStateFd(fdReadShoppingDays);
  function changeShoppingDays(v) {
    const n = Math.max(1, Math.min(30, Math.round(v)));
    setShoppingDays(n);
    fdWriteShoppingDays(n);
  }
  // Gated on `open` so this doesn't recompute while the screen sits closed.
  // Deps cover everything fdBuildShoppingList reads, directly or through
  // LB.isTrainingDayForDate's own schedule/session lookups.
  const list = useMemoFd(
    () => open ? fdBuildShoppingList(store, today, shoppingDays) : [],
    [open, store.foodLogs, store.foodFavorites, store.foodTemplateSlots, store.activeMealTemplateId,
     store.schedules, store.activeScheduleId, store.sessions, store.dailyLogs, today, shoppingDays],
  );

  // Per-food display-name override, exclude flag and package size (see
  // fdApplyShoppingPrefs): displayList is what actually renders, list stays
  // the untouched fdBuildShoppingList output, only used to recompute
  // displayList. store.foodShoppingPrefs is synced cross-device (migration
  // 0215), so this needs no local mirror state or localStorage of its own,
  // fdSetShoppingPref below writes straight through setStore.
  const displayList = useMemoFd(
    () => fdApplyShoppingPrefs(list, store.foodShoppingPrefs, logsForStock, today),
    [list, store.foodShoppingPrefs, logsForStock, today],
  );
  // What actually feeds the export/screenshot (included only) vs. what's
  // still shown, just set aside, in the list screen's own "Excluded"
  // section. excludedList stays keyed on `excluded` alone, unaffected by
  // low stock on purpose: an excluded bulk item running low still doesn't
  // belong in the grocery run, it needs reordering from wherever it's
  // normally bought. includedList additionally drops anything fdIsWellStocked
  // (tracked, real threshold, currently above it): there's nothing to buy
  // for a food you already have plenty of, whether it's a staple/projection
  // estimate is beside the point once inventory tracking says otherwise. A
  // well-stocked item that later dips low reappears here on its own the
  // moment fdIsWellStocked flips, same as everything else in this screen
  // that self-corrects off a derived value instead of a stored flag; it's
  // still visible the whole time via the Inventory tab regardless.
  const includedList = useMemoFd(() => displayList.filter(i => !i.excluded && !fdIsWellStocked(i)), [displayList]);
  const excludedList = useMemoFd(() => displayList.filter(i => i.excluded), [displayList]);
  // The Inventory tab's own list, independent of `list`/`displayList` above:
  // every tracked food, not just this window's staples/projections (see
  // fdBuildInventoryList).
  const inventoryList = useMemoFd(
    () => open ? fdBuildInventoryList(store, today, logsForStock) : [],
    [open, store.foodShoppingPrefs, logsForStock, today],
  );
  // Cuts across displayList for its own "Running Low" section instead
  // (surfaced first regardless of where it'd otherwise sit), so the two
  // *ForDisplay lists below carve it back out to avoid rendering it twice.
  // Also folds in inventoryList: fdIsLowStock only needs packageSizeG +
  // effectiveStockG (see fdBuildInventoryList's own comment), so a rarely-
  // bought bulk item can dip low on a week it doesn't qualify as a shopping
  // "staple" at all, and never reaches displayList in the first place. Left
  // out entirely, the very item inventory tracking exists for (bought too
  // rarely to ever count as a staple, see this file's own Whey/Dextrin
  // examples) would silently never trigger the warning it was built for.
  // Prefers the displayList copy when a food is in both (real grams/
  // fromProjection, a useful buy-quantity line in the hero row below), the
  // inventoryList copy only fills in a food displayList doesn't have at all.
  const lowStockList = useMemoFd(() => {
    const fromDisplay = displayList.filter(fdIsLowStock);
    const seen = new Set(fromDisplay.map(i => i.foodId));
    const extra = inventoryList.filter(i => fdIsLowStock(i) && !seen.has(i.foodId));
    return [...fromDisplay, ...extra];
  }, [displayList, inventoryList]);
  const includedForDisplay = useMemoFd(() => includedList.filter(i => !fdIsLowStock(i)), [includedList]);
  const excludedForDisplay = useMemoFd(() => excludedList.filter(i => !fdIsLowStock(i)), [excludedList]);
  // Collapsed by default: the Excluded section is set-aside stuff the user
  // already decided not to buy, not something that needs to compete for
  // attention with the actual shopping list every time this screen opens.
  const [excludedOpen, setExcludedOpen] = useStateFd(false);

  // One-time "Running Low" banner: shows only for a dip the user hasn't
  // already seen (see fdReadLowStockAcks), dismissing marks every currently-
  // fresh item as acked so the persistent section below stays but the
  // interrupt doesn't repeat on every reopen.
  const [lowStockAcks, setLowStockAcks] = useStateFd(fdReadLowStockAcks);
  const freshLowStock = useMemoFd(
    () => lowStockList.filter(i => lowStockAcks[i.foodId] !== i.stockSetAt),
    [lowStockList, lowStockAcks],
  );
  function dismissLowStockBanner() {
    const next = { ...lowStockAcks };
    freshLowStock.forEach(i => { next[i.foodId] = i.stockSetAt; });
    setLowStockAcks(next);
    fdWriteLowStockAcks(next);
  }

  const [editItem, setEditItem] = useStateFd(null); // the tapped displayList item, or null
  const [editDraft, setEditDraft] = useStateFd('');
  const [pkgDraft, setPkgDraft] = useStateFd('');
  // All three always start blank, unlike editDraft/pkgDraft: these are
  // "update the count" fields, not a display of the current value (that's
  // the read-only effectiveStockG line in the sheet itself). All blank on
  // Save means "leave stock tracking as it is", not "clear it", so an
  // unrelated name edit doesn't accidentally wipe out a tracked count just
  // for being left empty. stockDraft (plain grams) is only used without a
  // package size; with one, stockPacksDraft/stockExtraDraft take over so a
  // user can say "2 packs" or "2 packs plus a half-used one" directly,
  // instead of doing the pack-to-gram math themselves. Either field alone
  // still works (0 packs + grams = pure grams, packs + 0 grams = pure packs).
  const [stockDraft, setStockDraft] = useStateFd('');
  const [stockPacksDraft, setStockPacksDraft] = useStateFd('');
  const [stockExtraDraft, setStockExtraDraft] = useStateFd('');
  // Running Low threshold override (migration 0232): package-aware like the
  // stock fields above, two separate drafts rather than one field that
  // silently changes units. Whichever one is live (toggles off pkgDraft,
  // same condition the stock fields below use) is what saveEdit reads;
  // switching modes mid-edit never reinterprets an already-typed number
  // under a different unit, it just shows the other (still blank, or still
  // holding whatever was typed into IT specifically) field instead. Both
  // pre-fill like pkgDraft (an existing value being edited, not a blank
  // "type to add" field like stockDraft/stockPacksDraft/stockExtraDraft).
  // Blank on save means "no override", falls back to package size, same as
  // the item never had this pref set at all.
  const [thresholdPacksDraft, setThresholdPacksDraft] = useStateFd('');
  const [thresholdGramsDraft, setThresholdGramsDraft] = useStateFd('');
  // Exclude draft: null (not excluded), 'permanent', or an excludedUntil
  // ISO string (temporary, until that timestamp). One control now covers
  // both the old permanent excluded flag and the temporary snooze, they're
  // mutually exclusive states of the same underlying choice. Pre-fills from
  // the item like editDraft/pkgDraft do, using permanentExcluded/
  // tempExcludedUntil (not the raw pref) so a stale, already-expired
  // excludedUntil doesn't come back as if still active.
  const [excludeDraft, setExcludeDraft] = useStateFd(null);
  // Which temporary preset (7/14/30) lights up, purely a this-visit
  // interaction marker, separate from excludeDraft itself: an already-
  // active snooze from a previous save has no reliable matching preset
  // once time has passed (its remaining days no longer line up with
  // 7/14/30), so reopening the sheet never pre-highlights one, only
  // actually tapping a preset does. The Permanent segment needs no
  // equivalent marker, excludeDraft === 'permanent' is unambiguous on its own.
  const [excludeDraftDays, setExcludeDraftDays] = useStateFd(null);
  function openEdit(item) {
    setEditItem(item);
    setEditDraft(item.displayName);
    setPkgDraft(item.packageSizeG != null ? String(item.packageSizeG) : '');
    setStockDraft('');
    setStockPacksDraft('');
    setStockExtraDraft('');
    setThresholdPacksDraft(item.lowStockThresholdG != null && item.packageSizeG > 0 ? String(fdRound1(item.lowStockThresholdG / item.packageSizeG)) : '');
    setThresholdGramsDraft(item.lowStockThresholdG != null && !(item.packageSizeG > 0) ? String(item.lowStockThresholdG) : '');
    setExcludeDraft(item.permanentExcluded ? 'permanent' : (item.tempExcludedUntil || null));
    setExcludeDraftDays(null);
  }
  function closeEdit() {
    setEditItem(null); setEditDraft(''); setPkgDraft('');
    setStockDraft(''); setStockPacksDraft(''); setStockExtraDraft('');
    setThresholdPacksDraft(''); setThresholdGramsDraft('');
    setExcludeDraft(null); setExcludeDraftDays(null);
  }
  // True if any field actually differs from what the sheet opened with.
  // editDraft/pkgDraft/thresholdPacksDraft/thresholdGramsDraft/excludeDraft
  // are pre-filled on open (dirty means "changed from that"), the three
  // stock drafts always start blank (dirty means "typed into at all").
  // Backs requestCloseEdit's confirm below.
  function isEditDirty() {
    if (!editItem) return false;
    if (editDraft !== editItem.displayName) return true;
    if (pkgDraft !== (editItem.packageSizeG != null ? String(editItem.packageSizeG) : '')) return true;
    if (thresholdPacksDraft !== (editItem.lowStockThresholdG != null && editItem.packageSizeG > 0 ? String(fdRound1(editItem.lowStockThresholdG / editItem.packageSizeG)) : '')) return true;
    if (thresholdGramsDraft !== (editItem.lowStockThresholdG != null && !(editItem.packageSizeG > 0) ? String(editItem.lowStockThresholdG) : '')) return true;
    if (excludeDraft !== (editItem.permanentExcluded ? 'permanent' : (editItem.tempExcludedUntil || null))) return true;
    return !!(stockDraft.trim() || stockPacksDraft.trim() || stockExtraDraft.trim());
  }
  // Sheet's backdrop tap calls onClose directly with no dirty-check of its
  // own (same for every Sheet in the app), so a stray tap outside the panel
  // while mid-edit silently threw away whatever was typed. This is what
  // actually goes in as onClose instead: closeEdit is still called directly
  // by Save/Reset themselves, which just did something deliberate.
  async function requestCloseEdit() {
    if (isEditDirty() && !await confirm("Your changes won't be saved.", { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    closeEdit();
  }
  function saveEdit() {
    if (!editItem) return;
    const trimmed = editDraft.trim();
    // Blank, or typed back to exactly the original: same as no override, no
    // point leaving a no-op override sitting in the DB forever.
    const nameOverride = (!trimmed || trimmed === editItem.foodName) ? null : trimmed;
    // fdClampQtyG upper-bounds both gram fields: fdDecimalFilter only strips
    // non-numeric characters, it never caps magnitude, so an accidental
    // extra digit or a pasted barcode-length number would otherwise sail
    // straight into the DB as-is.
    const packageSizeG = fdClampQtyG(fdNum(pkgDraft));
    // Reads whichever unit is currently live off the just-computed
    // packageSizeG (not editItem's old one): a package size typed in this
    // same visit should convert its packs threshold against the NEW size,
    // not a stale one. The other field is simply never consulted, its
    // contents (if any, from before a mode switch) are left as-is on
    // screen but don't affect what gets saved.
    const thresholdPacksTyped = fdNum(thresholdPacksDraft);
    const thresholdGramsTyped = fdNum(thresholdGramsDraft);
    const lowStockThresholdG = packageSizeG > 0
      ? (thresholdPacksTyped != null ? fdClampQtyG(thresholdPacksTyped * packageSizeG) : null)
      : (thresholdGramsTyped != null ? fdClampQtyG(thresholdGramsTyped) : null);
    const patch = {
      nameOverride, packageSizeG, lowStockThresholdG, foodName: editItem.foodName, brand: editItem.brand ?? null,
      excluded: excludeDraft === 'permanent',
      excludedUntil: excludeDraft === 'permanent' ? null : excludeDraft,
    };
    // A typed stock value sets a FRESH baseline as of right now: fdConsumedSince
    // only ever counts forward from stockSetAt, so re-stamping it here is what
    // makes "I just restocked" mean "start counting from zero again".
    // Checked independent of which pair the sheet is CURRENTLY showing (that
    // toggles live off pkgDraft, see the packs/grams fields below): typing a
    // stock value in grams and only then adding a package size in the same
    // visit swaps the visible field out from under it, and reading only the
    // now-hidden pair would silently drop what was already typed. Packs wins
    // if both ended up touched (only possible by touching packs after the
    // switch, so it's what's currently visible/intended).
    let stockTyped = null;
    if (packageSizeG > 0 && (stockPacksDraft.trim() || stockExtraDraft.trim())) {
      stockTyped = (fdNum(stockPacksDraft) || 0) * packageSizeG + (fdNum(stockExtraDraft) || 0);
    } else if (stockDraft.trim()) {
      stockTyped = fdNum(stockDraft);
    }
    if (stockTyped != null) { patch.stockBaselineG = fdClampQtyG(stockTyped); patch.stockSetAt = new Date().toISOString(); }
    fdSetShoppingPref(setStore, editItem, patch);
    closeEdit();
  }
  async function resetEdit() {
    if (!editItem) return;
    if (!await confirm("This clears the rename, package size, low-stock threshold, and stock tracking for this item.", { title: 'Reset this item?', ok: 'Reset', cancel: 'Cancel', danger: true })) return;
    fdSetShoppingPref(setStore, editItem, { nameOverride: null, packageSizeG: null, lowStockThresholdG: null, stockBaselineG: null, stockSetAt: null });
    closeEdit();
  }
  // "Did I physically buy this on THIS shopping trip", not a persisted
  // preference: local and this-visit-only, always starts empty (see the
  // effect below), separate from the exclude/include concept entirely now
  // (that moved into the edit sheet, see excludeDraft above). Checking an
  // item writes fdShoppingBuyQtyG's quantity, exactly what the row's
  // headline shows, into inventory tracking straight away, on top of
  // whatever was already on hand (not a replacement: a partial pack left
  // over from before this trip is still real stock), stamping a fresh
  // stockSetAt like every other stock write in this screen. One-way: there's
  // no recorded "amount just added" to subtract back out, so unchecking only
  // clears the local mark, it does not undo the inventory write.
  const [boughtSet, setBoughtSet] = useStateFd(() => new Set());
  useEffectFd(() => { if (!open) setBoughtSet(new Set()); }, [open]);
  function markBought(item, bought) {
    setBoughtSet(prev => {
      const next = new Set(prev);
      if (bought) next.add(item.key); else next.delete(item.key);
      return next;
    });
    if (!bought) return;
    const qty = fdShoppingBuyQtyG(item.grams, item.packageSizeG);
    fdSetShoppingPref(setStore, item, {
      stockBaselineG: (item.effectiveStockG || 0) + qty,
      stockSetAt: new Date().toISOString(),
      foodName: item.foodName, brand: item.brand ?? null,
    });
  }
  // Shared row for both includedList and excludedList below: same layout,
  // just dimmed once excluded. The checkbox is a sibling button next to the
  // name/amount button, not nested inside it, real <button> elements can't
  // nest without the browser silently breaking the layout back out of the
  // outer one.
  // inventoryMode (Inventory tab, see below) drops the "bought it" checkbox
  // (a shopping-only concept) and swaps the buy-quantity column for a quiet
  // package-size reference instead, there's nothing to purchase here. Same
  // reason an excluded item never shows it either (see renderShoppingRow's
  // own check below): nothing on this trip's list to mark as bought, and
  // hasEstimate gates out low-stock fallback rows with no real buy quantity
  // for markBought to work with in the first place.
  function renderShoppingRow(item, inventoryMode) {
    // grams is only ever > 0 for a real fdBuildShoppingList estimate (both its
    // history and projection paths filter out non-positive grams themselves);
    // fromProjection is exclusive to that same path. Every displayList-sourced
    // row therefore always has hasEstimate === true, so !hasEstimate exactly
    // means "this came from fdBuildInventoryList" (directly via the Inventory
    // tab, or via lowStockList's own fallback for a low-stock item displayList
    // never had, see its comment), which always carries a real effectiveStockG
    // (fdBuildInventoryList's own filter condition). Without a real buy
    // quantity, the stock level is the one number worth a headline, not the
    // static package-size fact, so the two swap position versus the
    // hasEstimate row below: package size becomes the quiet caption (a fact
    // that explains the number on the right), stock takes the headline slot.
    const hasEstimate = item.grams > 0 || item.fromProjection;
    const low = fdIsLowStock(item);
    const { headline, sub } = hasEstimate ? fdFormatShoppingQty(item.grams, item.packageSizeG) : { headline: null, sub: null };
    // Dimming for `excluded` is a Shopping List concept (set from the edit
    // sheet's exclude picker, see excludeDraft above): skipped in
    // inventoryMode, same reasoning as hiding the checkbox itself, a food
    // excluded from the buy list is still just a normal tracked item here,
    // nothing to visually mute.
    const bought = boughtSet.has(item.key);
    return (
      <div key={item.key} style={{ ...fdQuickRowInner, cursor: 'default', opacity: (item.excluded && !inventoryMode) ? 0.55 : 1 }}>
        {!inventoryMode && !item.excluded && hasEstimate && (
          <FdCheckbox
            checked={bought}
            label={bought ? 'Bought, added to inventory' : 'Mark as bought, add the suggested amount to inventory'}
            onToggle={() => markBought(item, !bought)}
          />
        )}
        <button onClick={() => openEdit(item)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              <div style={{ ...fdEntryName, minWidth: 0 }}>{item.displayName}</div>
              {(item.overridden || item.packageSizeG || item.effectiveStockG != null) && <i className="fa-solid fa-pen" style={{ fontSize: 9, color: 'var(--accent)', flexShrink: 0 }} title="Customized" />}
              {item.tempExcludedUntil && <i className="fa-solid fa-clock" style={{ fontSize: 9, color: 'var(--accent)', flexShrink: 0 }} title={`Back ${new Date(item.tempExcludedUntil).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`} />}
            </div>
            {hasEstimate
              ? (item.effectiveStockG != null
                  // Stock tracked: always shown, not just once low, otherwise
                  // setting an initial healthy count gives zero feedback
                  // anywhere on the list that it actually took (a real report:
                  // 2 packs against a 1-pack low-stock threshold saved fine,
                  // just showed nothing anywhere to confirm it).
                  ? <div style={{ fontSize: 10, color: low ? 'var(--warn)' : UI.inkFaint, fontFamily: UI.fontUi }}>
                      {fdExactShoppingQty(item.effectiveStockG)} {low ? 'left' : 'in stock'}
                    </div>
                  : (!item.overridden && item.brand && <div style={fdEntryMeta}>{item.brand}</div>))
              : (item.packageSizeG > 0
                  ? <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{fdExactShoppingQty(item.packageSizeG)}/pack</div>
                  : (!item.overridden && item.brand && <div style={fdEntryMeta}>{item.brand}</div>))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {hasEstimate
              ? (<>
                  {item.fromProjection && <Pill gold>Plan</Pill>}
                  <div style={{ textAlign: 'right' }}>
                    <div className="num" style={{ fontSize: 13, color: UI.ink }}>{headline}</div>
                    {sub && <div style={{ fontSize: 9, color: UI.inkFaint }}>{sub}</div>}
                  </div>
                </>)
              : (
                  <div style={{ textAlign: 'right' }}>
                    <div className="num" style={{ fontSize: 13, color: low ? 'var(--warn)' : UI.ink }}>{fdExactShoppingQty(item.effectiveStockG)}</div>
                    <div style={{ fontSize: 9, color: low ? 'var(--warn)' : UI.inkFaint }}>{low ? 'left' : 'in stock'}</div>
                  </div>
                )}
          </div>
        </button>
      </div>
    );
  }

  // Two-step sheet: pick content (amounts or not) first, then how to get it
  // out (share or copy). exportContent doubles as the step tracker: null is
  // step 1, set is step 2. Skips straight to copying when navigator.share
  // isn't available at all, there's no real method choice to show then.
  const [exportOpen, setExportOpen] = useStateFd(false);
  const [exportContent, setExportContent] = useStateFd(null); // null | 'amounts' | 'names'
  const [justCopied, setJustCopied] = useStateFd(false);
  function openExport() { setExportContent(null); setJustCopied(false); setExportOpen(true); }
  function closeExport() { setExportOpen(false); setExportContent(null); setJustCopied(false); }
  function pickContent(withAmounts) {
    if (typeof navigator.share !== 'function') { doExport(withAmounts); return; }
    setExportContent(withAmounts ? 'amounts' : 'names');
  }

  // Writes a real HTML <ul><li> list alongside the plain text: a raw
  // \n-joined string doesn't reliably read as separate checklist rows to
  // every paste target (Notes' parser cares about actual paragraph
  // boundaries), an explicit list structure removes that guesswork. Falls
  // back to plain-text-only if the richer multi-type write isn't supported.
  async function doExport(withAmounts) {
    const text = fdBuildShoppingExportText(includedList, withAmounts);
    let copied = false;
    if (typeof ClipboardItem !== 'undefined') {
      try {
        const html = fdBuildShoppingExportHtml(includedList, withAmounts);
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })]);
        copied = true;
      } catch (_) { /* fall through to plain writeText below */ }
    }
    if (!copied) {
      try { await navigator.clipboard.writeText(text); copied = true; } catch (_) {}
    }
    if (!copied) return;
    setJustCopied(true);
    setTimeout(closeExport, 900);
  }
  // Separate from doExport on purpose: the Web Share API's `text` is always
  // plain (no HTML variant exists), so this can't carry the <ul><li> fix
  // above, sharing straight to Notes may still land as one glued item. Kept
  // anyway for every OTHER target (Messages, Mail, AirDrop, ...) where a
  // plain string is exactly what's wanted and there's no checklist to lose.
  async function doShare(withAmounts) {
    const text = fdBuildShoppingExportText(includedList, withAmounts);
    try { await navigator.share({ text }); } catch (_) {}
    closeExport();
  }

  const [confirmEl, confirm] = useConfirm();
  // Shopping list as an image: same "poster" idiom as the Food Log's own
  // screenshot (captureNodeAsPng, screens-lib.jsx) and the Plan poster
  // (screens-schedule.jsx), same background-watermark treatment (VIPs get
  // their own background image, everyone else gets the ZANE mark). Always
  // mounted, only ever hidden via display:none (see the Food Log poster's
  // own comment for why it can't be conditionally rendered on `capturing`).
  const [capturing, setCapturing] = useStateFd(false);
  const captureRef = useRefFd(null);
  const _shotLogo = store.settings?.vipBackground || 'icons/zane-logo.png';
  const _shotIsCustom = _shotLogo !== 'icons/zane-logo.png';
  const _shotIsLight = ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark');
  const _shotDefaultStyle = { width: '75%', maxWidth: 620, opacity: _shotIsLight ? 0.16 : 0.11, filter: _shotIsLight ? 'grayscale(1)' : 'grayscale(1) brightness(3)', objectFit: 'contain' };
  const _shotCustomStyle = { width: '80%', maxWidth: 680, opacity: 0.19, objectFit: 'contain' };
  const _shotGridOn = !!window.__gridEnabled;
  const takeScreenshot = async () => {
    const res = await captureNodeAsPng(captureRef.current, {
      filename: `shopping-list-${today}.png`,
      setCapturing,
    });
    if (!res?.ok) {
      await confirm(res?.reason === 'unavailable'
        ? 'Could not build the image. Check your connection and try again.'
        : 'Could not build the image. Please try again.',
        { title: 'Export failed', ok: 'OK', cancel: null });
    } else if (res.saved) {
      await confirm('Shopping list image saved to your files.', { title: 'Saved', ok: 'OK', cancel: null });
    }
  };

  if (!open) return null;
  return (
    <Screen style={{ position: 'fixed', inset: 0, zIndex: 100, animation: 'sheet-up 0.22s ease' }}>
      <TopBar title="Shopping list" onBack={onClose} right={
        screenTab === 'list' && includedList.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={takeScreenshot} disabled={capturing} aria-label="Share shopping list as image" style={{ ...fdTopAddBtn, cursor: capturing ? 'default' : 'pointer', color: capturing ? UI.inkGhost : UI.inkSoft }}>
              {capturing ? <span style={{ fontFamily: UI.fontUi, fontSize: 10 }}>…</span> : <i className="fa-solid fa-camera" style={{ fontSize: 13 }} />}
            </button>
            <button onClick={openExport} aria-label="Export list" style={fdTopAddBtn}>
              <i className="fa-solid fa-share-from-square" style={{ fontSize: 14 }} />
            </button>
          </div>
        )
      } />
      {confirmEl}
      {/* Screenshotting/exporting only mean anything on the buy list, not
          here, hence gating the TopBar's own buttons above on 'list' too:
          Inventory is a straight stock browse, nothing to ship out. */}
      <SubTabBar tabs={[{ id: 'list', label: 'Shopping List' }, { id: 'inventory', label: 'Inventory' }]} active={screenTab} onChange={setScreenTab} />
      {/* Poster tree: always mounted, only ever hidden via display:none, never
          conditionally rendered on `capturing` itself (captureNodeAsPng only
          flips capturing to true AFTER checking captureRef.current is
          non-null, so if this tree were gated on `capturing` the ref would
          still be null at that exact check, same reasoning as the Food Log
          poster above it in this file). No rename affordance, no Plan-mode
          controls: this is a static image, not another interactive surface. */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: UI.bg, overflow: 'auto', display: capturing ? 'block' : 'none' }}>
        <div ref={captureRef} style={{ padding: '26px 28px 32px', width: 480, margin: '0 auto', position: 'relative' }}>
          {_shotGridOn && <SvgGrid />}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
            <img src={_shotLogo} data-shot-avatar="1" style={_shotIsCustom ? _shotCustomStyle : _shotDefaultStyle} />
          </div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ height: 'var(--hair-width)', background: UI.gold, marginBottom: 16 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="display" style={{ fontSize: 24, color: UI.gold, lineHeight: '26px' }}>Shopping List</div>
                <div className="micro" style={{ marginTop: 4 }}>Next {shoppingDays} day{shoppingDays === 1 ? '' : 's'}</div>
              </div>
              <div className="micro-gold" style={{ letterSpacing: '0.18em', marginTop: 2, flexShrink: 0, marginLeft: 12 }}>ZANE</div>
            </div>

            <BracketFrame gold style={{ padding: 20, marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                <div>
                  <div className="num" style={{ fontSize: 28, color: UI.ink, fontWeight: 300 }}>{shoppingDays}</div>
                  <div className="micro" style={{ marginTop: 4 }}>{shoppingDays === 1 ? 'Day' : 'Days'}</div>
                </div>
                <div>
                  <div className="num" style={{ fontSize: 28, color: UI.ink, fontWeight: 300 }}>{includedList.length}</div>
                  <div className="micro" style={{ marginTop: 4 }}>{includedList.length === 1 ? 'Item' : 'Items'}</div>
                </div>
              </div>
            </BracketFrame>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
              {includedList.map(item => {
                const { headline, sub } = fdFormatShoppingQty(item.grams, item.packageSizeG);
                return (
                // Translucent surface-tint fill (not fdQuickRowInner's opaque
                // one), same reason the Food Log poster's entry cards use it:
                // an opaque row blocks the watermark entirely wherever it
                // sits, leaving it visible only in the gaps between rows.
                // Excluded and well-stocked items never make it into
                // includedList, neither belongs in a "what to buy" poster.
                <div key={item.key} style={{ ...fdQuickRowInner, background: 'var(--surface-tint-md)', textShadow: 'var(--text-lift)', cursor: 'default' }}>
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={fdEntryName}>{item.displayName}</div>
                    {!item.overridden && item.brand && <div style={fdEntryMeta}>{item.brand}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {item.fromProjection && <Pill gold>Plan</Pill>}
                    <div style={{ textAlign: 'right' }}>
                      <div className="num" style={{ fontSize: 13, color: UI.ink }}>{headline}</div>
                      {sub && <div style={{ fontSize: 9, color: UI.inkFaint }}>{sub}</div>}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div style={{ padding: '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {stockBackfillError && inventoryList.length > 0 && (
          // Companion to the backfill fetch's catch above: a failed fetch
          // leaves logsForStock on the boot-windowed fallback, so the stock
          // numbers below (in either tab) could be silently understating
          // consumption. Only shown when there's actually tracked stock to
          // doubt (inventoryList requires a baseline set), not on every
          // fetch failure regardless of relevance.
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, padding: '8px 10px' }} title="Stock estimate may be outdated">
            <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: 11, color: UI.inkFaint, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '14px' }}>Stock estimate may be outdated</span>
          </div>
        )}
        {screenTab === 'list' ? (
          <>
            {freshLowStock.length > 0 && (
              <div style={{ background: 'rgba(var(--warn-rgb),0.14)', border: '1px solid rgba(var(--warn-rgb),0.45)', borderRadius: 6, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: 15, color: 'var(--warn)', flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, lineHeight: '16px' }}>
                  {freshLowStock.length === 1 ? `${freshLowStock[0].displayName} is running low.` : `${freshLowStock.length} items are running low.`}
                </div>
                <button onClick={dismissLowStockBanner} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
                  <i className="fa-solid fa-xmark" style={{ fontSize: 14 }} />
                </button>
              </div>
            )}

            <Card style={{ textAlign: 'center' }}>
              <div className="micro" style={{ marginBottom: 10 }}>Shopping for the next</div>
              <Stepper value={shoppingDays} step={1} min={1} max={30}
                suffix={shoppingDays === 1 ? ' day' : ' days'} onChange={changeShoppingDays} />
            </Card>

            {lowStockList.length > 0 && (
              // Its own card (not just a knurl section like Excluded below): this
              // is the one category meant to interrupt, not just sit there,
              // hence the persistent glow rather than a plain divider. Stays on
              // this tab on purpose (see screenTab's own comment above): the
              // Inventory tab is the complete, calm browse, this is the interrupt.
              <div className="low-stock-glow" style={{ background: 'rgba(var(--warn-rgb),0.08)', border: '1px solid rgba(var(--warn-rgb),0.35)', borderRadius: 8, padding: '14px 14px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 10 }}>
                  <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: 12, color: 'var(--warn)' }} />
                  <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--warn)', fontFamily: UI.fontUi }}>Running Low</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {lowStockList.map(item => renderShoppingRow(item))}
                </div>
              </div>
            )}

            {!displayList.length ? (
              <Empty title="Nothing yet"
                sub="Log meals for a couple of weeks, or set up a meal plan, and your regulars will show up here."
                icon={<i className="fa-solid fa-basket-shopping" style={{ fontSize: 28, color: UI.inkFaint }} />} />
            ) : (
              // One wrapping div so the parent's own gap:16 (Card -> this block)
              // applies exactly once: a bare fragment here would flatten into
              // direct flex children and add that same 16px between the knurl,
              // the label and the excluded rows too, on top of their own margins.
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {includedForDisplay.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {includedForDisplay.map(item => renderShoppingRow(item))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '8px 0' }}>
                    Nothing to buy right now.
                  </div>
                )}
                {excludedForDisplay.length > 0 && (
                  <>
                    <div className="knurl" style={{ margin: '16px 0 10px' }} />
                    <button onClick={() => setExcludedOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--accent)', fontFamily: UI.fontUi }}>Excluded ({excludedForDisplay.length})</span>
                      <i className={`fa-solid fa-chevron-${excludedOpen ? 'down' : 'right'}`} style={{ fontSize: 11, color: 'var(--accent)' }} />
                    </button>
                    <div className="knurl" style={{ margin: '10px 0' }} />
                    {excludedOpen && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {excludedForDisplay.map(item => renderShoppingRow(item))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        ) : !inventoryList.length ? (
          <Empty title="Nothing tracked yet"
            sub="Open an item from the shopping list, set a package size or stock count, and it shows up here too."
            icon={<i className="fa-solid fa-boxes-stacked" style={{ fontSize: 28, color: UI.inkFaint }} />} />
        ) : (
          // Flat and alphabetical, same convention as the Shopping List tab's
          // own sections, no separate low-stock hero here: that stays the
          // Shopping List tab's job (see screenTab's own comment above),
          // this is the complete, calm browse of everything tracked.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {inventoryList.map(item => renderShoppingRow(item, true))}
          </div>
        )}
      </div>
      <Sheet open={exportOpen} onClose={closeExport} title="Export list" titleColor="var(--accent)">
        {justCopied ? (
          // Own view rather than nested in the Copy button: pickContent's
          // no-navigator.share fallback copies straight from step 1, never
          // visiting the step-2 grid the button-level state lived in before.
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '20px 0' }}>
            <i className="fa-solid fa-circle-check" style={{ fontSize: 28, color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>Copied</span>
          </div>
        ) : !exportContent ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <button onClick={() => pickContent(true)} style={fdScanChoice}>
              <i className="fa-solid fa-weight-hanging" style={{ fontSize: 22, color: 'var(--accent)' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>With amounts</span>
              <span style={{ fontSize: 10, color: UI.inkFaint, lineHeight: 1.3 }}>Chicken breast 500g</span>
            </button>
            <button onClick={() => pickContent(false)} style={fdScanChoice}>
              <i className="fa-solid fa-list" style={{ fontSize: 22, color: 'var(--accent)' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>Names only</span>
              <span style={{ fontSize: 10, color: UI.inkFaint, lineHeight: 1.3 }}>Chicken breast</span>
            </button>
          </div>
        ) : (
          <>
            <div className="micro" style={{ marginBottom: 8 }}>Share or copy?</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <button onClick={() => doShare(exportContent === 'amounts')} style={fdScanChoice}>
                <i className="fa-solid fa-share-from-square" style={{ fontSize: 22, color: 'var(--accent)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>Share</span>
                <span style={{ fontSize: 10, color: UI.inkFaint, lineHeight: 1.3 }}>Messages, Mail, AirDrop…</span>
              </button>
              <button onClick={() => doExport(exportContent === 'amounts')} style={fdScanChoice}>
                <i className="fa-solid fa-copy" style={{ fontSize: 22, color: 'var(--accent)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>Copy</span>
                <span style={{ fontSize: 10, color: UI.inkFaint, lineHeight: 1.3 }}>One item per line, for Notes</span>
              </button>
            </div>
          </>
        )}
      </Sheet>
      <Sheet open={!!editItem} onClose={requestCloseEdit} title="Edit item" titleColor="var(--accent)">
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 10, lineHeight: '16px' }}>
          Original: {editItem?.foodName}{editItem?.brand ? ` · ${editItem.brand}` : ''}
        </div>
        <Field label="Show as" accent style={{ marginBottom: 14 }}>
          <TextInput value={editDraft} onChange={setEditDraft} placeholder={editItem?.foodName} autoFocus />
        </Field>
        <Field label="Package size (g)" accent style={{ marginBottom: 6 }}>
          <input value={pkgDraft} onChange={e => setPkgDraft(fdDecimalFilter(e.target.value))}
            type="text" inputMode="decimal" placeholder="e.g. 400" style={fdInputStyle} />
        </Field>
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 14, lineHeight: '16px' }}>
          Rounds the shopping quantity up to whole packages instead of a raw gram estimate. Leave blank for plain grams.
        </div>
        <div style={{ borderTop: `var(--hair-width) solid ${UI.hair}`, paddingTop: 14, marginBottom: 14 }}>
          <span className="label-gold">Inventory</span>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', margin: '6px 0 10px' }}>
            Optional: track what you actually have on hand, so Running Low can warn you before it's gone instead of guessing off what you usually buy.
          </div>
          {editItem?.effectiveStockG != null && (
            <div style={{ fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, marginBottom: 8 }}>
              Current stock: <span className="num">{fdExactShoppingQty(editItem.effectiveStockG)}</span>
              {editItem.packageSizeG > 0 && (
                <span style={{ color: UI.inkFaint }}>
                  {' '}({Math.floor(editItem.effectiveStockG / editItem.packageSizeG)} packs
                  {editItem.effectiveStockG % editItem.packageSizeG > 0 ? ` + ${fdExactShoppingQty(editItem.effectiveStockG % editItem.packageSizeG)}` : ''})
                </span>
              )}
            </div>
          )}
          {fdNum(pkgDraft) > 0 ? (
            // A package size is already known, so stock is worth entering in
            // packs instead of doing the pack-to-gram math yourself: "2
            // packs" beats "800g", and "2 packs + 150g" (a couple of sealed
            // ones plus an opened partial) beats guessing a single gram
            // figure. Either field alone still works (0 + grams = pure
            // grams, packs + 0 = pure packs), this is one input, not a mode switch.
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <Field label="Full packs" accent style={{ flex: 1, marginBottom: 0 }}>
                <input value={stockPacksDraft} onChange={e => setStockPacksDraft(fdDecimalFilter(e.target.value))}
                  type="text" inputMode="decimal" placeholder="e.g. 2" style={fdInputStyle} />
              </Field>
              <Field label="+ grams" accent style={{ flex: 1, marginBottom: 0 }}>
                <input value={stockExtraDraft} onChange={e => setStockExtraDraft(fdDecimalFilter(e.target.value))}
                  type="text" inputMode="decimal" placeholder="e.g. 150" style={fdInputStyle} />
              </Field>
            </div>
          ) : (
            <Field label="Update stock (g)" accent style={{ marginBottom: 6 }}>
              <input value={stockDraft} onChange={e => setStockDraft(fdDecimalFilter(e.target.value))}
                type="text" inputMode="decimal" placeholder="e.g. 10000 after restocking" style={fdInputStyle} />
            </Field>
          )}
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', marginBottom: 14 }}>
            Tracks what's actually eaten since. Leave blank to keep the current count unchanged.
          </div>
          {fdNum(pkgDraft) > 0 ? (
            <Field label="Warn when below (packs)" accent style={{ marginBottom: 6 }}>
              <input value={thresholdPacksDraft} onChange={e => setThresholdPacksDraft(fdDecimalFilter(e.target.value))}
                type="text" inputMode="decimal" placeholder="e.g. 2" style={fdInputStyle} />
            </Field>
          ) : (
            <Field label="Warn when below (g)" accent style={{ marginBottom: 6 }}>
              <input value={thresholdGramsDraft} onChange={e => setThresholdGramsDraft(fdDecimalFilter(e.target.value))}
                type="text" inputMode="decimal" placeholder="e.g. 1000" style={fdInputStyle} />
            </Field>
          )}
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px' }}>
            Running Low fires under this. Defaults to one package, raise it for anything that gets eaten through faster than a package lasts.
          </div>
        </div>
        <div style={{ borderTop: `var(--hair-width) solid ${UI.hair}`, paddingTop: 14, marginBottom: 14 }}>
          <Field label="Exclude" accent style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
              <button onClick={() => { setExcludeDraft(fdSnoozeUntil(7)); setExcludeDraftDays(7); }} style={fdSegBtn(excludeDraftDays === 7)}>1 week</button>
              <button onClick={() => { setExcludeDraft(fdSnoozeUntil(14)); setExcludeDraftDays(14); }} style={fdSegBtn(excludeDraftDays === 14)}>2 weeks</button>
              <button onClick={() => { setExcludeDraft(fdSnoozeUntil(30)); setExcludeDraftDays(30); }} style={fdSegBtn(excludeDraftDays === 30)}>1 month</button>
              <button onClick={() => { setExcludeDraft('permanent'); setExcludeDraftDays(null); }} style={fdSegBtn(excludeDraft === 'permanent')}>Permanent</button>
            </div>
          </Field>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span>
              {excludeDraft === 'permanent'
                ? 'Off the shopping list until you pick something else here.'
                : excludeDraft
                  ? `Off the list until ${new Date(excludeDraft).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}, then back on its own.`
                  : 'On the shopping list. Pick a duration above to skip it for a while.'}
            </span>
            {excludeDraft && (
              <button onClick={() => { setExcludeDraft(null); setExcludeDraftDays(null); }} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0, textDecoration: 'underline' }}>
                Clear
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(editItem?.overridden || editItem?.packageSizeG || editItem?.lowStockThresholdG != null || editItem?.effectiveStockG != null) && <Btn kind="ghost" onClick={resetEdit} style={{ flex: 1 }}>Reset</Btn>}
          <Btn onClick={saveEdit} style={{ flex: (editItem?.overridden || editItem?.packageSizeG || editItem?.lowStockThresholdG != null || editItem?.effectiveStockG != null) ? 2 : 1 }}>Save</Btn>
        </div>
      </Sheet>
    </Screen>
  );
}

// Circular position badge (1, 2, 3, ...) reflecting an ingredient's place in
// the recipe's prep order (array order). Shared by the ingredient list above
// and Cooking Mode's one-at-a-time hero card below, so the same number means
// the same thing in both places.
function FdIngredientBadge({ n, size = 20 }) {
  return (
    <span className="num" style={{
      flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: 999,
      background: 'rgba(var(--accent-rgb),0.18)', color: 'var(--accent)',
      fontSize: Math.round(size * 0.5), fontWeight: 700,
    }}>{n}</span>
  );
}

function RecipeEditorScreen({ open, onClose, onSave, recipe, store }) {
  const [confirmEl, confirm] = useConfirm();
  const [name, setName] = useStateFd('');
  const [items, setItems] = useStateFd([]);
  const [portions, setPortions] = useStateFd(1);
  const [cookedWeightG, setCookedWeightG] = useStateFd('');
  const [pickerOpen, setPickerOpen] = useStateFd(false);
  const [editItem, setEditItem] = useStateFd(null);
  const [editGrams, setEditGrams] = useStateFd('');
  // Per-ingredient note (items[i].note, optional): the item being edited, or
  // null while closed. Carried through to Cooking Mode below, where it's the
  // whole point of being permanent (shown prominently on that ingredient's
  // own card while actually cooking).
  const [noteItem, setNoteItem] = useStateFd(null);
  const [noteText, setNoteText] = useStateFd('');
  // Snapshot of the draft as it was opened, to detect unsaved edits on close.
  const initialSnap = useRefFd(null);

  useEffectFd(() => {
    if (!open) return;
    const n = recipe?.name || '';
    // Backfill a stable id for any item that predates one: applyBlockRecipe's
    // "Create a recipe from HH:00" once saved recipe items with no id field
    // at all. Every item's id then read as undefined, so removeItem's
    // list.filter(i => i.id !== id) matched that same undefined on EVERY
    // item and wiped the whole recipe instead of the one being removed.
    const it = (recipe?.items || []).map(i => i.id ? i : { ...i, id: LB.uid() });
    const p = recipe?.portions || 1;
    const cw = recipe?.cookedWeightG != null ? String(recipe.cookedWeightG) : '';
    setName(n); setItems(it); setPortions(p); setCookedWeightG(cw);
    initialSnap.current = JSON.stringify({ name: n, items: it, portions: p, cookedWeightG: cw });
  }, [open, recipe]);

  // Batch totals, the whole recipe as cooked, independent of portions:
  // portions is purely metadata for how a batch splits up when logging it
  // later (see FoodScreen's addRecipeToLog/confirmRecipeLog), not a divisor
  // applied here.
  const netCarbs = !!store.settings?.netCarbs;
  const totals = useMemoFd(() => ({
    calories: fdRecipeItemsCalories(items, netCarbs),
    protein: fdRound1(items.reduce((a, i) => a + (i.protein || 0), 0)),
    carbs: fdRound1(items.reduce((a, i) => a + (i.carbs || 0), 0)),
    fat: fdRound1(items.reduce((a, i) => a + (i.fat || 0), 0)),
  }), [items, netCarbs]);
  // Raw ingredient weight, shown only as a reference next to cookedWeightG
  // below, never auto-filled into it: water lost or gained during cooking
  // means the finished dish rarely weighs what its raw ingredients did,
  // that gap is the entire reason this field asks for a real typed number.
  const rawGramsTotal = useMemoFd(() => items.reduce((a, i) => a + (i.quantityG || 0), 0), [items]);

  const isDirty = () => initialSnap.current != null && JSON.stringify({ name, items, portions, cookedWeightG }) !== initialSnap.current;
  const requestClose = async () => {
    if (isDirty() && !await confirm("Your changes to this recipe won't be saved.", { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    onClose();
  };

  // FdIngredientPicker only ever hands back a finished, already-quantified
  // batch (its own "Add N ingredients" button), never a single item.
  function addItems(newItems) {
    setItems(list => [...list, ...newItems.map(item => ({ id: LB.uid(), ...item }))]);
  }
  function removeItem(id) {
    setItems(list => list.filter(i => i.id !== id));
  }
  // The row's own trash icon goes through the same confirm removeEditItem
  // already shows: one action, one level of safety, no matter which of the two
  // affordances the user reaches for.
  async function requestRemoveItem(item) {
    if (!await confirm(`${item.foodName} · ${item.quantityG}g`, { title: 'Remove ingredient?', ok: 'Remove', cancel: 'Cancel', danger: true })) return;
    removeItem(item.id);
  }
  // Array order IS the deliberate prep order now (see the ingredient list
  // below and Cooking Mode further down): a plain splice-to-new-position,
  // no macro recalculation, only position changes.
  function reorderItems(from, to) {
    if (from === to) return;
    setItems(list => {
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  function openEditItem(item) { setEditItem(item); setEditGrams(String(item.quantityG ?? '')); }
  function closeEditItem() { setEditItem(null); setEditGrams(''); }
  function openNoteItem(item) { setNoteItem(item); setNoteText(item.note || ''); }
  function closeNoteItem() { setNoteItem(null); setNoteText(''); }
  function saveNote() {
    if (!noteItem) return;
    const trimmed = noteText.trim();
    setItems(list => list.map(i => i.id !== noteItem.id ? i : { ...i, note: trimmed || null }));
    closeNoteItem();
  }
  // Live preview of the rescaled macros as the amount is typed, same factor
  // math saveEditItem itself commits below, so what's shown here is exactly
  // what Save will write. Without this the sheet was just a bare grams
  // input, no way to tell how much of an ingredient to dial in for a target
  // without saving blind and checking the row after.
  const editItemPreview = useMemoFd(() => {
    const g = fdNum(editGrams);
    if (!editItem || !(g > 0) || !(editItem.quantityG > 0)) return null;
    const factor = g / editItem.quantityG;
    return {
      calories: Math.round((editItem.calories || 0) * factor),
      protein: fdRound1((editItem.protein || 0) * factor),
      carbs: fdRound1((editItem.carbs || 0) * factor),
      fat: fdRound1((editItem.fat || 0) * factor),
      sugar: editItem.sugar != null ? fdRound1(editItem.sugar * factor) : null,
      satFat: editItem.satFat != null ? fdRound1(editItem.satFat * factor) : null,
      sodiumMg: editItem.sodiumMg != null ? Math.round(editItem.sodiumMg * factor) : null,
    };
  }, [editItem, editGrams]);
  // Rescales every field on the item by the same factor (newGrams/oldGrams)
  // rather than re-deriving per-100g rates: mathematically identical, one
  // fewer intermediate step.
  function saveEditItem() {
    const g = fdNum(editGrams);
    if (!editItem || !(g > 0) || !(editItem.quantityG > 0)) return;
    const factor = g / editItem.quantityG;
    setItems(list => list.map(i => i.id !== editItem.id ? i : {
      ...i, quantityG: Math.round(g),
      calories: Math.round((i.calories || 0) * factor),
      protein: fdRound1((i.protein || 0) * factor),
      carbs: fdRound1((i.carbs || 0) * factor),
      fat: fdRound1((i.fat || 0) * factor),
      fiber: i.fiber != null ? fdRound1(i.fiber * factor) : null,
      sugar: i.sugar != null ? fdRound1(i.sugar * factor) : null,
      satFat: i.satFat != null ? fdRound1(i.satFat * factor) : null,
      sodiumMg: i.sodiumMg != null ? Math.round(i.sodiumMg * factor) : null,
    }));
    closeEditItem();
  }
  async function removeEditItem() {
    if (!editItem) return;
    const ok = await confirm(`${editItem.foodName} · ${editItem.quantityG}g`, { title: 'Remove ingredient?', ok: 'Remove', cancel: 'Cancel', danger: true });
    if (!ok) return;
    removeItem(editItem.id);
    closeEditItem();
  }

  async function requestSave() {
    const trimmed = name.trim();
    if (!trimmed || !items.length) return;
    const ok = await confirm(<RecipeSaveRecap name={trimmed} portions={portions} totals={totals} />,
      { title: recipe ? 'Save recipe?' : 'Add recipe?', ok: recipe ? 'Save' : 'Add' });
    if (!ok) return;
    onSave({ name: trimmed, items, portions, cookedWeightG: fdNum(cookedWeightG) });
  }
  const canSave = !!(name.trim() && items.length);

  if (!open) return null;
  return (
    <Screen style={{ position: 'fixed', inset: 0, zIndex: 100, animation: 'sheet-up 0.22s ease' }}>
      <TopBar title={recipe ? 'Edit recipe' : 'New recipe'} onBack={requestClose}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            {items.length > 0 && (
              <button onClick={() => setPickerOpen(true)} aria-label="Add ingredients" style={fdTopAddBtn}>
                <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
              </button>
            )}
            <button onClick={requestSave} disabled={!canSave} aria-label="Save recipe" style={{ ...fdTopAddBtn, opacity: canSave ? 1 : 0.4 }}>
              <i className="fa-solid fa-check" style={{ fontSize: 14 }} />
            </button>
          </div>
        } />
      <div style={{ padding: '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {confirmEl}
        <Field label="Name">
          <TextInput value={name} onChange={setName} placeholder="e.g. Breakfast bowl" />
        </Field>

        <FdMacroHero label="Whole batch" calories={totals.calories} protein={totals.protein} carbs={totals.carbs} fat={totals.fat} />

        <div>
          <div className="micro" style={{ marginBottom: 10, textAlign: 'center' }}>Portions</div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Stepper value={portions} step={1} min={1} onChange={v => setPortions(Math.max(1, Math.round(v)))} big />
          </div>
        </div>

        {/* Optional: unlocks logging this recipe by grams of the finished
            dish instead of only by portions, useful for batch cooking where
            weighing out a serving is more natural than a portion fraction
            (FoodScreen's addRecipeToLog / FoodTemplateScreen's openAddRecipe).
            Never auto-filled from the ingredient total below: cooking loses
            or gains water weight, so the two numbers are rarely the same. */}
        <Field label="Cooked weight (g), optional">
          <input value={cookedWeightG} onChange={e => setCookedWeightG(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal"
            placeholder={`e.g. ${Math.round(rawGramsTotal)}`} style={fdInputStyle} />
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6 }}>
            Raw ingredients weigh {Math.round(rawGramsTotal)}g. Weigh the actual finished dish, it usually differs.
          </div>
        </Field>

        <div>
          <Bezel style={{ marginBottom: 10 }}>Ingredients · prep order</Bezel>
          {items.length === 0 ? (
            <Btn onClick={() => setPickerOpen(true)} style={{ width: '100%' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> Add ingredients
            </Btn>
          ) : (
            // Array order is the deliberate prep order (the order to add
            // ingredients while cooking, see Cooking Mode below), so this list
            // renders items as-is, drag the grip to reorder, same engine as
            // the plan editor's own item list (screens-schedule.jsx).
            <ReorderList onReorder={reorderItems} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((i, idx) => (
                <div key={i.id} data-reorder-item="true" style={fdEntryRow}>
                  <DragHandle style={{ marginLeft: -8, marginRight: -4 }} />
                  <FdIngredientBadge n={idx + 1} />
                  <button onClick={() => openEditItem(i)} style={fdDraftMain}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {i.foodId && <i className="fa-solid fa-circle-check" style={{ fontSize: 10, color: 'var(--accent)', flexShrink: 0 }} title="In the shared food database" />}
                      <span style={{ ...fdEntryName, fontSize: 12 }}>{i.foodName}</span>
                    </div>
                    <span style={fdEntryMeta}>
                      {i.quantityG}g · <span className="num" style={{ color: UI.warn }}>{Math.round(LB.caloriesFromMacros(i.protein, i.carbs, i.fat, netCarbs ? i.fiber : null) || 0)} kcal</span>
                      <span style={fdMetaDivider} />
                      <FdMacroBits protein={i.protein} carbs={i.carbs} fat={i.fat} />
                    </span>
                  </button>
                  <button data-reorder-ignore="true" onClick={() => openNoteItem(i)} aria-label={i.note ? 'Edit note' : 'Add note'} style={fdInlineDeleteBtn}>
                    <i className="fa-solid fa-note-sticky" style={{ fontSize: 11, color: i.note ? 'var(--accent)' : UI.inkFaint }} />
                  </button>
                  <button data-reorder-ignore="true" onClick={() => requestRemoveItem(i)} aria-label="Remove" style={fdInlineDeleteBtn}>
                    <i className="fa-solid fa-trash" style={{ fontSize: 11 }} />
                  </button>
                </div>
              ))}
            </ReorderList>
          )}
        </div>
      </div>

      {/* ── Edit an already-added ingredient's amount, rescaling its macros
          proportionally ── */}
      <Sheet open={!!editItem} onClose={closeEditItem} title={editItem?.foodName || 'Ingredient'} titleColor="var(--accent)">
        <Field label="Amount (g)" style={{ marginBottom: 16 }}>
          <input value={editGrams} onChange={e => setEditGrams(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
        </Field>
        {editItemPreview && (
          <FdMacroPreview calories={editItemPreview.calories} protein={editItemPreview.protein} carbs={editItemPreview.carbs} fat={editItemPreview.fat}
            sugar={editItemPreview.sugar} satFat={editItemPreview.satFat} sodiumMg={editItemPreview.sodiumMg} />
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={removeEditItem} aria-label="Remove ingredient" style={{ ...fdSideBtn, width: 44, flexShrink: 0 }}>
            <i className="fa-solid fa-trash" style={{ fontSize: 13 }} />
          </button>
          <Btn kind="ghost" onClick={closeEditItem} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={saveEditItem} disabled={!(fdNum(editGrams) > 0)} style={{ flex: 2 }}>Save</Btn>
        </div>
      </Sheet>

      {/* ── Per-ingredient note: a short, permanent reminder that follows the
          ingredient into Cooking Mode (CookingModeScreen below), where it's
          shown prominently on that ingredient's own card while cooking ── */}
      <Sheet open={!!noteItem} onClose={closeNoteItem} title={noteItem?.foodName || 'Note'} titleColor="var(--accent)">
        <Field label="Note" style={{ marginBottom: 16 }}>
          <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="e.g. dice small, or add right at the end"
            rows={2} style={{ ...fdInputStyle, resize: 'vertical', lineHeight: 1.4 }} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={closeNoteItem} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={saveNote} style={{ flex: 2 }}>Save</Btn>
        </div>
      </Sheet>

      <FdIngredientPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onAdd={addItems} store={store} />
    </Screen>
  );
}

// Presentational body for RecipeEditorScreen's save confirm dialog
// (useConfirm's message accepts any React node, not just a string).
function RecipeSaveRecap({ name, portions, totals }) {
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi, marginBottom: 4 }}>{name}</div>
      <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 10 }}>{portions} portion{portions === 1 ? '' : 's'}</div>
      <div style={{ display: 'flex', gap: 14 }}>
        <span className="num" style={{ fontSize: 16, color: UI.warn }}>{totals.calories}<span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 3 }}>kcal</span></span>
        <FdMacroGhosts protein={totals.protein} carbs={totals.carbs} fat={totals.fat} size={13} />
      </div>
    </div>
  );
}

// ── Cooking Mode: localStorage draft (this device only, never synced) ──────
// Mirrors LB.saveToLocal's own defensive pattern (store.js): a full/blocked
// localStorage must never crash the wizard, it should just silently fail to
// persist that one write. Only one draft at a time, same as cooking itself.
function fdReadCookingDraft() {
  try {
    const raw = localStorage.getItem('logbook-cooking-draft');
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
function fdWriteCookingDraft(draft) {
  try { localStorage.setItem('logbook-cooking-draft', JSON.stringify(draft)); } catch (_) {}
}
function fdClearCookingDraft() {
  try { localStorage.removeItem('logbook-cooking-draft'); } catch (_) {}
}

// Diff between the wizard's final working items and the recipe's own
// currently persisted items, for the "Recipe changes" confirm below. Swaps
// are NOT re-derived from a generic added+removed pair (that would have to
// guess which removal pairs with which addition); they come in as an
// explicit event log recorded the moment each swap actually happened in the
// wizard (swapEvents), same reasoning training tracks its own swap
// operations directly instead of inferring them after the fact.
function fdComputeCookingDiff(originalItems, finalItems, swapEvents) {
  const origById = new Map((originalItems || []).map(i => [i.id, i]));
  const finalById = new Map((finalItems || []).map(i => [i.id, i]));
  const swappedIds = new Set((swapEvents || []).map(e => e.itemId));
  const diffs = [];
  (finalItems || []).forEach(i => { if (!origById.has(i.id)) diffs.push({ type: 'added', name: i.foodName }); });
  (originalItems || []).forEach(i => { if (!finalById.has(i.id)) diffs.push({ type: 'removed', name: i.foodName }); });
  // finalById guard: a slot that was swapped and later removed entirely
  // reports only as "removed" (the true end state), not also as "swapped"
  // into a food that no longer exists either. requestRemove already prunes
  // swapEvents for a removed slot, this is a second line of defense.
  // origById guard: a slot that was added this session and THEN swapped
  // (never existed in the persisted recipe at all) reports only as "added"
  // (using its final, post-swap food), not also as a "swapped" row naming an
  // old food that was never part of the recipe to begin with.
  (swapEvents || []).forEach(e => { if (finalById.has(e.itemId) && origById.has(e.itemId)) diffs.push({ type: 'swapped', fromName: e.fromFoodName, toName: e.toFoodName }); });
  // Amount changed: the same item survived (and wasn't swapped), but its
  // quantity moved by more than max(5% relative, 3g floor). At or under that
  // threshold is deliberately never reported, normal imprecise kitchen
  // weighing must never trigger this dialog, only a genuinely deliberate
  // change should.
  (originalItems || []).forEach(orig => {
    if (swappedIds.has(orig.id)) return;
    const fin = finalById.get(orig.id);
    if (!fin) return;
    const origG = orig.quantityG || 0;
    const finG = fin.quantityG || 0;
    const threshold = Math.max(origG * 0.05, 3);
    if (Math.abs(finG - origG) > threshold) {
      diffs.push({ type: 'amount', name: fin.foodName, oldG: origG, newG: finG });
    }
  });
  return diffs;
}

// Cooking Mode: a guided, one-ingredient-at-a-time wizard for actually
// cooking a recipe, opened from the recipe log prompt's "Cook it" button
// (FoodScreen's startCookingMode). Modeled on TrainingScreen's own
// one-exercise-at-a-time flow (chip row + position counter, swap/add/remove
// toolbar, Back/Next footer) but built entirely out of this file's own
// components, never training's literal CSS constants or its KgInput/
// CustomKeyboard machinery. Next is always enabled here, unlike training's
// gated Next: reviewing an ingredient has no "done" state to gate on.
//
// zIndex 100, tied with an ordinary Sheet, not the seemingly obvious 200
// ("must sit above the already-open recipeLogPrompt Sheet"): FdIngredientPicker
// is reused unmodified below, and its OWN internal "discard picks?" confirm
// (useConfirm's default zIndex, portaled straight to document.body) would
// render BEHIND a z-200 wizard, an invisible, unreachable confirm. Tied at
// z-100, that portal still always wins ties against same-tier content (see
// useConfirm's own comment in ui.jsx), and this component is rendered as a
// LATER sibling than recipeLogPrompt's own Sheet in FoodScreen's return, so
// the tie against THAT is won by DOM order instead, the exact same mechanism
// RecipeEditorScreen already relies on for nesting this same picker.
function CookingModeScreen({ open, recipe, draft, store, onClose, onFinish, onUpdateRecipe, onNoteChange }) {
  const [confirmEl, confirm] = useConfirm();
  const [items, setItems] = useStateFd([]);
  const originalItemsRef = useRefFd([]);
  const [currentIdx, setCurrentIdx] = useStateFd(0);
  const [step, setStep] = useStateFd('ingredients'); // 'ingredients' | 'cookedWeight'
  const [cookedWeightG, setCookedWeightG] = useStateFd('');
  const [swapEvents, setSwapEvents] = useStateFd([]); // [{ itemId, fromFoodName, toFoodName }]
  const [amountStr, setAmountStr] = useStateFd('');
  // Frozen basis for the live amount-scale preview (same two-state idea as
  // RecipeEditorScreen's editItem/editGrams): reset explicitly whenever the
  // ingredient AT the current position changes (goToIndex, a swap), never
  // recomputed from the drifting `items` state itself, or repeated typing
  // would compound rounding against an already-scaled value instead of the
  // ingredient's own fixed starting point for this visit.
  const baseItemRef = useRefFd(null);
  const startedAtRef = useRefFd(null);
  const [pickerOpen, setPickerOpen] = useStateFd(false);
  const pickerModeRef = useRefFd('add'); // 'add' | 'swap': which toolbar button opened FdIngredientPicker
  // Note editor always targets curItem (the wizard only ever shows one
  // ingredient at a time), so unlike RecipeEditorScreen's noteItem there is
  // no need to track WHICH item is being edited, only the draft text.
  const [noteEditorOpen, setNoteEditorOpen] = useStateFd(false);
  const [noteDraft, setNoteDraft] = useStateFd('');
  // Keeps the active chip centered in the strip as currentIdx moves, same
  // scrollLeft-centering idea as training's own chip row (screens-train.jsx),
  // without it the strip only scrolls by hand and the active chip silently
  // runs off-screen on a longer ingredient list.
  const chipRowRef = useRefFd(null);
  useEffectFd(() => {
    const row = chipRowRef.current;
    if (!row || step !== 'ingredients') return;
    const chip = row.querySelector(`[data-chip-idx="${currentIdx}"]`);
    if (!chip) return;
    row.scrollLeft = chip.offsetLeft - row.offsetWidth / 2 + chip.offsetWidth / 2;
  }, [currentIdx, step]);
  const [diffOpen, setDiffOpen] = useStateFd(false);
  const [diffList, setDiffList] = useStateFd([]);
  // Whether this open resumed a saved draft (vs. a from-scratch cook):
  // requestExit below must never wipe a resumed draft just because THIS
  // visit made no further changes, that would silently discard real
  // progress saved in an earlier session.
  const resumedRef = useRefFd(false);
  // Set on any state-changing action taken this session (amount typed,
  // add/swap/remove, cooked weight typed). requestExit only ever clears
  // the draft for a truly untouched session, see its own comment below.
  const dirtyRef = useRefFd(false);
  // Whether cookedWeightG actually reflects a real typed value, as opposed
  // to merely being pre-filled from the recipe's own already-saved
  // cookedWeightG. Deliberately separate from dirtyRef above (which also
  // flips true for unrelated actions like an ingredient amount edit): this
  // one specifically decides the Part D hand-off's starting unit ('grams'
  // vs 'portions'), an untouched pre-filled value must resolve to
  // 'portions' same as today, even if other fields were touched this
  // session. Initialized in the open-effect below (also handles resuming a
  // draft where the value was genuinely typed in an earlier, killed
  // session), then flipped true directly by the field's own onChange.
  const cookedWeightTypedRef = useRefFd(false);

  useEffectFd(() => {
    if (!open) return;
    const idsFilled = (recipe?.items || []).map(i => (i.id ? { ...i } : { ...i, id: LB.uid() }));
    originalItemsRef.current = idsFilled.map(i => ({ ...i }));
    let initItems, initIdx, initStep, initCookedWeightG, initSwapEvents;
    if (draft) {
      initItems = (draft.items || []).map(i => (i.id ? { ...i } : { ...i, id: LB.uid() }));
      initIdx = Math.max(0, Math.min(draft.currentIdx || 0, initItems.length - 1));
      initStep = draft.step === 'cookedWeight' ? 'cookedWeight' : 'ingredients';
      initCookedWeightG = draft.cookedWeightG || '';
      initSwapEvents = draft.swapEvents || [];
      startedAtRef.current = draft.startedAt || new Date().toISOString();
    } else {
      initItems = idsFilled.map(i => ({ ...i }));
      initIdx = 0;
      initStep = 'ingredients';
      initCookedWeightG = recipe?.cookedWeightG != null ? String(recipe.cookedWeightG) : '';
      initSwapEvents = [];
      startedAtRef.current = new Date().toISOString();
    }
    resumedRef.current = !!draft;
    dirtyRef.current = false;
    // A draft's cookedWeightG diverging from the recipe's own currently
    // saved value can only mean it was genuinely typed at some point (this
    // device only ever writes what the field itself held); matching it (or
    // a from-scratch open, where it's the same prefill by construction)
    // means untouched.
    const recipeCookedWeight = recipe?.cookedWeightG ?? null;
    cookedWeightTypedRef.current = fdNum(initCookedWeightG) > 0 && fdNum(initCookedWeightG) !== recipeCookedWeight;
    setItems(initItems);
    setCurrentIdx(initIdx);
    setStep(initStep);
    setCookedWeightG(initCookedWeightG);
    setSwapEvents(initSwapEvents);
    setDiffOpen(false);
    setDiffList([]);
    baseItemRef.current = initItems[initIdx] || null;
    setAmountStr(initItems[initIdx] ? String(initItems[initIdx].quantityG ?? '') : '');
  }, [open, recipe, draft]);

  // Persists on every change so an app-kill mid-cook survives (this device
  // only, see CLAUDE.md's localStorage-key list). Guarded on items.length:
  // the render right after `open` flips true, before the effect above's
  // setItems has actually landed, must never overwrite a real draft with an
  // empty one (a real recipe always has at least one ingredient). Carries
  // swapEvents along too, otherwise a resumed draft would forget which
  // ingredients were swapped and fdComputeCookingDiff below would misreport
  // them as a plain amount change (or drop them) instead of "swapped".
  useEffectFd(() => {
    if (!open || !recipe || !items.length) return;
    fdWriteCookingDraft({ recipeId: recipe.id, startedAt: startedAtRef.current, step, currentIdx, items, cookedWeightG, swapEvents });
  }, [open, recipe, step, currentIdx, items, cookedWeightG, swapEvents]);

  function syncAmountField(idx, list) {
    const it = list[idx];
    baseItemRef.current = it || null;
    setAmountStr(it ? String(it.quantityG ?? '') : '');
  }
  function goToIndex(idx, list) {
    const arr = list || items;
    const clamped = Math.max(0, Math.min(idx, arr.length - 1));
    setCurrentIdx(clamped);
    syncAmountField(clamped, arr);
  }

  const rawGramsTotal = useMemoFd(() => items.reduce((a, i) => a + (i.quantityG || 0), 0), [items]);
  // Whole-batch running total, same math as RecipeEditorScreen's own
  // `totals`: recomputed straight off the live `items` state, so it starts
  // equal to the saved recipe (items is cloned from recipe.items on open)
  // and updates itself for free on every amount/add/swap/remove action,
  // no separate "recompute on change" wiring needed.
  const netCarbs = !!store.settings?.netCarbs;
  const batchTotals = useMemoFd(() => ({
    calories: fdRecipeItemsCalories(items, netCarbs),
    protein: fdRound1(items.reduce((a, i) => a + (i.protein || 0), 0)),
    carbs: fdRound1(items.reduce((a, i) => a + (i.carbs || 0), 0)),
    fat: fdRound1(items.reduce((a, i) => a + (i.fat || 0), 0)),
  }), [items, netCarbs]);
  const curItem = items[currentIdx] || null;
  // Continuous shrink instead of training's fixed length breakpoints: a
  // straight-line falloff past a comfortable short-name length, clamped to
  // this card's own min/max, so a very long ingredient name never wraps or
  // overflows past the amount field below it.
  const curNameFontSize = curItem
    ? Math.max(15, Math.min(32, 32 - Math.max(0, curItem.foodName.length - 11) * 0.8))
    : 32;

  function onAmountChange(v) {
    const filtered = fdDecimalFilter(v);
    setAmountStr(filtered);
    const base = baseItemRef.current;
    const g = fdNum(filtered);
    if (!base || !(g > 0) || !(base.quantityG > 0)) return;
    dirtyRef.current = true;
    const factor = g / base.quantityG;
    setItems(list => list.map((it, i) => i !== currentIdx ? it : {
      ...it, quantityG: Math.round(g),
      calories: Math.round((base.calories || 0) * factor),
      protein: fdRound1((base.protein || 0) * factor),
      carbs: fdRound1((base.carbs || 0) * factor),
      fat: fdRound1((base.fat || 0) * factor),
      fiber: base.fiber != null ? fdRound1(base.fiber * factor) : null,
      sugar: base.sugar != null ? fdRound1(base.sugar * factor) : null,
      satFat: base.satFat != null ? fdRound1(base.satFat * factor) : null,
      sodiumMg: base.sodiumMg != null ? Math.round(base.sodiumMg * factor) : null,
    }));
  }

  function handleNext() {
    if (currentIdx < items.length - 1) goToIndex(currentIdx + 1);
    else setStep('cookedWeight');
  }
  function handleBack() {
    if (step === 'cookedWeight') { setStep('ingredients'); goToIndex(items.length - 1); return; }
    if (currentIdx === 0) return;
    goToIndex(currentIdx - 1);
  }
  // No confirm-to-exit here (deliberate, see Cooking Mode's persistence
  // notes): the localStorage draft is what survives navigating away. Only
  // a session that is BOTH back at the very first ingredient AND has made
  // no changes at all clears it, "before doing anything" per the spec.
  // resumedRef matters here too: re-opening a saved draft and immediately
  // backing out again with no further edits must not discard the progress
  // that draft already represents, only a from-scratch session with
  // nothing in it is safe to wipe.
  function requestExit() {
    if (step === 'ingredients' && currentIdx === 0 && !dirtyRef.current && !resumedRef.current) fdClearCookingDraft();
    onClose();
  }

  function openAddPicker() { pickerModeRef.current = 'add'; setPickerOpen(true); }
  // The only way to give a note to an ingredient added mid-cook: it never
  // passed through RecipeEditorScreen, so it has no chance to pick one up
  // there. Same permanent-note idea either way, saves straight into curItem.
  function openNoteEditor() { setNoteDraft(curItem?.note || ''); setNoteEditorOpen(true); }
  function closeNoteEditor() { setNoteEditorOpen(false); setNoteDraft(''); }
  function saveNoteEditor() {
    if (!curItem) return;
    dirtyRef.current = true;
    const trimmed = noteDraft.trim();
    const note = trimmed || null;
    const id = curItem.id;
    setItems(list => list.map(i => i.id !== id ? i : { ...i, note }));
    // Unlike an amount/add/swap/remove edit, a note is evergreen prep
    // guidance, not this session's outcome, so it should survive even if
    // the whole cook gets left or canceled. Only patch the persisted recipe
    // immediately for a slot that's actually still the SAME ingredient the
    // recipe already has: not swapped this session (a swapped-in food isn't
    // in the recipe yet, its note travels along with it only if Update
    // recipe later promotes it, same as a brand new added ingredient).
    const wasSwapped = swapEvents.some(e => e.itemId === id);
    if (!wasSwapped && originalItemsRef.current.some(o => o.id === id)) {
      onNoteChange(recipe.id, id, note);
    }
    closeNoteEditor();
  }
  // The X in the header: unlike requestExit (the back-chevron, silent, the
  // localStorage draft is the safety net for "just navigating away"), this
  // is a deliberate abort. Always confirms, and always clears the draft
  // even if requestExit's own narrower conditions would have kept it,
  // canceling here means the user does not want to pick this back up.
  async function requestCancel() {
    // Not "no changes are saved to the recipe": a note on an unswapped,
    // originally-existing ingredient already patched straight into
    // store.foodRecipes the moment it was saved (see saveNoteEditor), by
    // design, and canceling does not revert that. Promising otherwise here
    // was simply false.
    const ok = await confirm('This cancels the whole cook, nothing gets logged. Any notes you saved along the way stay on the recipe.',
      { title: 'Cancel cooking?', ok: 'Cancel cooking', cancel: 'Keep cooking', danger: true });
    if (!ok) return;
    fdClearCookingDraft();
    onClose();
  }
  async function requestSwap() {
    if (!curItem) return;
    if (!await confirm(`Swap "${curItem.foodName}"?`, { ok: 'Swap' })) return;
    pickerModeRef.current = 'swap';
    setPickerOpen(true);
  }
  async function requestRemove() {
    if (items.length <= 1 || !curItem) return;
    if (!await confirm(`${curItem.foodName} · ${curItem.quantityG}g`, { title: 'Remove ingredient?', ok: 'Remove', cancel: 'Cancel', danger: true })) return;
    dirtyRef.current = true;
    const removedId = curItem.id;
    const next = items.filter((_, i) => i !== currentIdx);
    setItems(next);
    // Drop any swap event recorded for the removed slot: it no longer
    // exists in the final list, so fdComputeCookingDiff below should just
    // report it as removed, not ALSO as swapped into a food that then
    // vanished too.
    setSwapEvents(list => list.filter(e => e.itemId !== removedId));
    goToIndex(Math.min(currentIdx, next.length - 1), next);
  }

  // FdIngredientPicker always hands back an array (its own "Add N
  // ingredients" button supports staging several at once); Add inserts all
  // of them, Swap uses only the first (multi-add makes no sense for a
  // one-for-one swap) and ignores the rest. Reused completely unmodified
  // either way, per this file's own established contract for that component.
  function handlePickerAdd(newItems) {
    if (!newItems || !newItems.length) { setPickerOpen(false); return; }
    if (pickerModeRef.current === 'swap') {
      applySwap({ id: LB.uid(), ...newItems[0] });
      setPickerOpen(false);
      return;
    }
    dirtyRef.current = true;
    const withIds = newItems.map(it => ({ id: LB.uid(), ...it }));
    const insertAt = currentIdx + 1;
    const next = [...items.slice(0, insertAt), ...withIds, ...items.slice(insertAt)];
    setItems(next);
    goToIndex(insertAt, next);
    setPickerOpen(false);
  }
  // Keeps the currently typed gram amount (not the new food's own default
  // quantity) and recomputes every macro from the new food's own rate at
  // that same gram amount; note is dropped, a note written for the old
  // ingredient has no reason to carry over to a different food.
  function applySwap(picked) {
    if (!curItem) return;
    dirtyRef.current = true;
    const keptGrams = fdNum(amountStr) || curItem.quantityG || 0;
    const factor = picked.quantityG > 0 ? keptGrams / picked.quantityG : 0;
    const swapped = {
      ...curItem,
      foodId: picked.foodId ?? null, foodName: picked.foodName, brand: picked.brand ?? null, source: picked.source ?? null,
      quantityG: Math.round(keptGrams),
      calories: Math.round((picked.calories || 0) * factor),
      protein: fdRound1((picked.protein || 0) * factor),
      carbs: fdRound1((picked.carbs || 0) * factor),
      fat: fdRound1((picked.fat || 0) * factor),
      fiber: picked.fiber != null ? fdRound1(picked.fiber * factor) : null,
      sugar: picked.sugar != null ? fdRound1(picked.sugar * factor) : null,
      satFat: picked.satFat != null ? fdRound1(picked.satFat * factor) : null,
      sodiumMg: picked.sodiumMg != null ? Math.round(picked.sodiumMg * factor) : null,
      note: null,
    };
    const swappedItemId = curItem.id;
    const next = items.map((it, i) => i === currentIdx ? swapped : it);
    setItems(next);
    baseItemRef.current = swapped;
    setAmountStr(String(swapped.quantityG));
    // Net-tracks per slot rather than appending a new row per swap: two
    // swaps of the same ingredient (rice to quinoa, then quinoa to
    // couscous) collapse into one "rice to couscous" event, matching what
    // actually changed versus the original recipe, not a stale
    // intermediate step. Swapping back to the very original food for that
    // slot cancels the event entirely, since nothing really changed.
    setSwapEvents(list => {
      const origItem = originalItemsRef.current.find(o => o.id === swappedItemId);
      const originalName = origItem ? origItem.foodName : curItem.foodName;
      const existing = list.find(e => e.itemId === swappedItemId);
      if (swapped.foodName === originalName) return list.filter(e => e.itemId !== swappedItemId);
      const fromFoodName = existing ? existing.fromFoodName : curItem.foodName;
      const event = { itemId: swappedItemId, fromFoodName, toFoodName: swapped.foodName };
      return existing ? list.map(e => e.itemId === swappedItemId ? event : e) : [...list, event];
    });
  }

  // Blank stays blank downstream (no update to cooked weight), it never
  // erases an already-set one: only a positive typed value overrides it.
  // typedThisSession reads cookedWeightTypedRef (was the field genuinely
  // edited, not just pre-filled from the recipe's own already-saved value),
  // not merely "does it currently parse to a positive number": a recipe
  // that already has a cookedWeightG would otherwise always look "typed"
  // even when the user never touched the field, wrongly forcing Part D's
  // hand-off into 'grams' instead of the spec's 'portions' default.
  function resolveCookedWeight() {
    const typed = fdNum(cookedWeightG);
    return { resolved: typed > 0 ? typed : (recipe?.cookedWeightG ?? null), typedThisSession: cookedWeightTypedRef.current && typed > 0 };
  }
  function proceedToLog() {
    const { resolved, typedThisSession } = resolveCookedWeight();
    onFinish(items, resolved, typedThisSession);
  }
  function handleFinishIngredients() {
    const diffs = fdComputeCookingDiff(originalItemsRef.current, items, swapEvents);
    if (!diffs.length) { proceedToLog(); return; }
    setDiffList(diffs);
    setDiffOpen(true);
  }
  function handleLeaveRecipe() { setDiffOpen(false); proceedToLog(); }
  function handleUpdateRecipe() {
    setDiffOpen(false);
    const { resolved } = resolveCookedWeight();
    onUpdateRecipe(recipe.id, items, resolved);
    proceedToLog();
  }

  if (!open) return null;
  return (
    <Screen style={{ position: 'fixed', inset: 0, zIndex: 100, animation: 'sheet-up 0.22s ease' }}>
      {confirmEl}
      <TopBar title={recipe?.name || 'Cooking'} sub="Cooking mode" onBack={requestExit} right={
        <button onClick={requestCancel} aria-label="Cancel cooking" style={fdTopAddBtn}>
          <i className="fa-solid fa-xmark" style={{ fontSize: 14 }} />
        </button>
      } />

      {step === 'ingredients' && curItem && (<>
        <div style={{ flexShrink: 0, padding: '6px 22px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="micro-gold">Ingredients</span>
          <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>
            {String(currentIdx + 1).padStart(2, '0')} <span style={{ color: UI.hair }}>/</span> {String(items.length).padStart(2, '0')}
          </span>
        </div>

        {/* Chip row, tap a chip to jump straight to that ingredient. */}
        <div ref={chipRowRef} style={{ flexShrink: 0, padding: '0 22px 12px', display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {items.map((it, i) => (
            <button key={it.id} data-chip-idx={i} onClick={() => goToIndex(i)} style={{
              flexShrink: 0, maxWidth: 110, padding: '5px 11px 4px', borderRadius: 4,
              border: `var(--hair-width) solid ${i === currentIdx ? 'var(--accent)' : UI.hairStrong}`,
              background: i === currentIdx ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
              fontSize: 10, fontFamily: UI.fontUi, letterSpacing: '0.07em',
              color: i === currentIdx ? 'var(--accent)' : UI.inkFaint,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}>{it.foodName}</button>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FdIngredientBadge n={currentIdx + 1} size={34} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="display" style={{
                display: 'block',
                fontSize: curNameFontSize,
                color: UI.ink, lineHeight: 1.05, letterSpacing: '0.02em', fontWeight: 700,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{curItem.foodName}</span>
              {curItem.brand && (
                <span style={{
                  display: 'block', fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{curItem.brand}</span>
              )}
            </div>
          </div>

          {/* Whole batch: the more consequential number while stepping
              through ingredients (does this dish still hit target?), starts
              equal to the saved recipe (items is cloned from recipe.items on
              open) and live-updates with every amount edit or add/swap/
              remove action. */}
          <FdMacroHero label="Whole batch" calories={batchTotals.calories} protein={batchTotals.protein} carbs={batchTotals.carbs} fat={batchTotals.fat} />

          {curItem.note && (
            <div style={{ background: 'rgba(var(--accent-rgb),0.1)', border: `var(--hair-width) solid rgba(var(--accent-rgb),0.3)`, borderRadius: 6, padding: '12px 14px' }}>
              <div className="micro-gold" style={{ marginBottom: 4 }}>Note</div>
              <div style={{ fontFamily: UI.fontDisplay, fontSize: 16, color: UI.ink, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{curItem.note}</div>
            </div>
          )}

          <Field label="Amount (g)">
            <input value={amountStr} onChange={e => onAmountChange(e.target.value)} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
          </Field>

          <FdMacroPreview calories={curItem.calories} protein={curItem.protein} carbs={curItem.carbs} fat={curItem.fat}
            sugar={curItem.sugar} satFat={curItem.satFat} sodiumMg={curItem.sodiumMg} marginBottom={0} />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={openAddPicker} aria-label="Add ingredient" style={fdIconBtn(38)}>
              <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
            </button>
            <button onClick={requestSwap} aria-label="Swap ingredient" style={fdIconBtn(38)}>
              <i className="fa-solid fa-right-left" style={{ fontSize: 14 }} />
            </button>
            {items.length > 1 && (
              <button onClick={requestRemove} aria-label="Remove ingredient" style={fdIconBtn(38)}>
                <i className="fa-solid fa-trash" style={{ fontSize: 14 }} />
              </button>
            )}
            <div style={{ flex: 1 }} />
            {/* Pinned to the far right, same "+ Note" / "Note" pill training's
                own toolbar row uses (screens-train.jsx), deliberately not a
                square fdIconBtn like its left-side siblings: those three
                mutate/replace the ingredient, this one is its own separate
                category of action. */}
            <button onClick={openNoteEditor} aria-label={curItem.note ? 'Edit note' : 'Add note'} style={{
              background: curItem.note ? UI.goldFaint : 'transparent',
              border: `var(--hair-width) solid ${curItem.note ? UI.goldSoft : UI.hairStrong}`,
              borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
              color: curItem.note ? UI.gold : UI.inkFaint, fontSize: 10,
              fontFamily: UI.fontUi, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500,
              WebkitTapHighlightColor: 'transparent',
            }}>
              {curItem.note ? 'Note' : '+ Note'}
            </button>
          </div>
        </div>
      </>)}

      {step === 'cookedWeight' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 22px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="display" style={{ fontSize: 28, color: UI.ink, lineHeight: 1.1 }}>Weigh the dish</div>
            <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
              Optional. Weigh the finished dish to log it by weight later instead of by portion, it usually differs from the raw ingredient total below.
            </div>
          </div>
          <Field label="Cooked weight (g), optional">
            <input value={cookedWeightG} onChange={e => { dirtyRef.current = true; cookedWeightTypedRef.current = true; setCookedWeightG(fdDecimalFilter(e.target.value)); }} type="text" inputMode="decimal"
              placeholder={`e.g. ${Math.round(rawGramsTotal)}`} style={fdInputStyle} />
          </Field>
        </div>
      )}

      <div className="knurl" />
      <div style={{ flexShrink: 0, padding: '10px 22px calc(env(safe-area-inset-bottom, 8px) + 10px)', display: 'flex', gap: 10 }}>
        <button onClick={handleBack} disabled={step === 'ingredients' && currentIdx === 0} style={{
          width: 44, minHeight: 44, borderRadius: 6, background: 'transparent', border: `var(--hair-width) solid ${UI.hairStrong}`,
          color: UI.inkSoft, cursor: (step === 'ingredients' && currentIdx === 0) ? 'default' : 'pointer',
          opacity: (step === 'ingredients' && currentIdx === 0) ? 0.3 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        {step === 'ingredients' ? (
          <Btn onClick={handleNext} style={{ flex: 1, minHeight: 44 }}>
            {currentIdx === items.length - 1 ? 'Weigh it →' : 'Next ingredient →'}
          </Btn>
        ) : (
          <Btn onClick={handleFinishIngredients} style={{ flex: 1, minHeight: 44 }}>Finish →</Btn>
        )}
      </div>

      {/* "Recipe changes" vs. the recipe's own persisted items, modeled
          directly on training's "Session changes" Sheet. */}
      <Sheet open={diffOpen} onClose={() => setDiffOpen(false)} title="Recipe changes">
        <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 12 }}>vs. recipe:</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {diffList.map((d, i) => (
            <div key={i} style={{ background: UI.bgInset, borderRadius: 4, padding: '10px 14px', border: `var(--hair-width) solid ${UI.hair}`, fontSize: 13, color: UI.ink, display: 'flex', alignItems: 'center', gap: 8 }}>
              {d.type === 'swapped' ? (
                <>
                  <span style={{ color: UI.goldLight, fontSize: 14 }}>⇄</span>
                  <span><span style={{ color: UI.inkSoft }}>{d.fromName}</span>{' → '}<strong>{d.toName}</strong></span>
                </>
              ) : d.type === 'amount' ? (
                <>
                  <span style={{ color: UI.goldLight, fontSize: 14 }}>≡</span>
                  <span><strong>{d.name}</strong>{': '}<span style={{ color: UI.inkSoft }}>{Math.round(d.oldG)}g</span>{' → '}<strong>{Math.round(d.newG)}g</strong></span>
                </>
              ) : d.type === 'added' ? (
                <>
                  <span style={{ color: UI.inkFaint, fontSize: 14 }}>＋</span>
                  <span style={{ color: UI.inkSoft }}><strong style={{ color: UI.ink }}>{d.name}</strong>{' added'}</span>
                </>
              ) : (
                <>
                  <span style={{ color: UI.inkFaint, fontSize: 14 }}>−</span>
                  <span style={{ color: UI.inkSoft }}><strong style={{ color: UI.ink }}>{d.name}</strong>{' removed'}</span>
                </>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={handleLeaveRecipe} style={{ flex: 1 }}>Leave recipe</Btn>
          <Btn onClick={handleUpdateRecipe} style={{ flex: 2 }}>Update recipe</Btn>
        </div>
      </Sheet>

      {/* Same permanent per-ingredient note as RecipeEditorScreen's own note
          Sheet, just always targeting curItem, so an ingredient added mid-
          cook (which never passed through the editor) can get one too. */}
      <Sheet open={noteEditorOpen} onClose={closeNoteEditor} title={curItem?.foodName || 'Note'} titleColor="var(--accent)">
        <Field label="Note" style={{ marginBottom: 16 }}>
          <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="e.g. dice small, or add right at the end"
            rows={2} style={{ ...fdInputStyle, resize: 'vertical', lineHeight: 1.4 }} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={closeNoteEditor} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={saveNoteEditor} style={{ flex: 2 }}>Save</Btn>
        </div>
      </Sheet>

      <FdIngredientPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onAdd={handlePickerAdd} store={store} />
    </Screen>
  );
}

const FD_PICKER_TABS = [
  { id: 'search', label: 'Search' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'recent', label: 'Recent' },
];

// Stats sheet body: 7/30/90/custom history of macro adherence with
// drag-to-inspect bars (reuses HealthBarChart, same as Water's own stats
// sheet), KPIs, and an average-macros breakdown. Charts adherence (0-100,
// store.dailyLogs, see dailyLogAdherence in store.js) rather than raw
// calories: HealthBarChart's target line is a single scalar for the whole
// period, but the actual calorie target can differ by training/rest day or
// change over time (targetsSnap freezes a day's target as of when it was
// scored), so only the already-normalized adherence score stays meaningful
// across an arbitrary date range. A day with no macro target (or nothing
// logged) has adherence: null, treated as 0 for both the chart and the KPIs
// below, same as Water treats an unlogged day as 0ml: an untracked day is
// not a hit, not a gap in the data.
function FdStatsBody({ store }) {
  const [period, setPeriod] = useStateFd(30);
  const [from, setFrom] = useStateFd(fdShiftDate(LB.todayISO(), -29));
  const [to, setTo] = useStateFd(LB.todayISO());
  const timeColorScheme = ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark') ? 'light' : 'dark';

  const range = useMemoFd(() => {
    if (period === 'custom') return (from > to) ? { from: to, to: from } : { from, to };
    return { from: fdShiftDate(LB.todayISO(), -(period - 1)), to: LB.todayISO() };
  }, [period, from, to]);

  const s = useMemoFd(() => {
    const adhByDate = {}, calByDate = {}, macroByDate = {}, mocDates = new Set();
    (store.dailyLogs || []).forEach(l => {
      if (l.date < range.from || l.date > range.to) return;
      if (l.adherence != null) adhByDate[l.date] = l.adherence;
      if (l.calories) { calByDate[l.date] = l.calories; macroByDate[l.date] = l; }
      // A meal-of-choice day is deliberately unscored (dailyLogAdherence
      // always nulls its adherence, see store.js), so it must not read as a
      // missed day here either: excluded from the goal-hit rate's own
      // denominator and skipped (neither breaking nor extending) by the
      // streak below, rather than counting as 0% the way a genuinely
      // untracked day correctly does.
      if (l.mealOfChoice) mocDates.add(l.date);
    });
    const dates = fdDateRange(range.from, range.to);
    const days = dates.map(d => ({ date: d, value: adhByDate[d] || 0, moc: mocDates.has(d) }));
    const scorable = days.filter(d => !d.moc);
    const loggedDates = dates.filter(d => calByDate[d] > 0);
    const goalDays = scorable.filter(d => d.value >= FD_STATS_GOAL_ADHERENCE);
    const avgCal = loggedDates.length ? Math.round(loggedDates.reduce((a, d) => a + calByDate[d], 0) / loggedDates.length) : 0;
    const rate = scorable.length ? Math.round((goalDays.length / scorable.length) * 100) : 0;
    let best = 0, cur = 0;
    days.forEach(d => {
      if (d.moc) return;
      if (d.value >= FD_STATS_GOAL_ADHERENCE) { cur++; best = Math.max(best, cur); } else cur = 0;
    });
    const avgMacros = loggedDates.length ? {
      protein: Math.round(loggedDates.reduce((a, d) => a + (macroByDate[d].protein || 0), 0) / loggedDates.length),
      carbs: Math.round(loggedDates.reduce((a, d) => a + (macroByDate[d].carbs || 0), 0) / loggedDates.length),
      fat: Math.round(loggedDates.reduce((a, d) => a + (macroByDate[d].fat || 0), 0) / loggedDates.length),
    } : null;
    // Average GOAL macros over the same logged days, from each day's own
    // frozen targetsSnap (the target it was actually scored against at save
    // time, see dailyLogAdherence): a raw achieved average means little on
    // its own without something to compare it to, and a single "today's
    // target" reference would be wrong for a period spanning both training
    // and rest days, or a target the user changed partway through.
    const goalSum = { protein: 0, carbs: 0, fat: 0, n: 0 };
    loggedDates.forEach(d => {
      const snap = macroByDate[d].targetsSnap;
      if (!snap || (snap.protein == null && snap.carbs == null && snap.fat == null)) return;
      goalSum.protein += snap.protein || 0; goalSum.carbs += snap.carbs || 0; goalSum.fat += snap.fat || 0; goalSum.n++;
    });
    const avgGoalMacros = goalSum.n ? {
      protein: Math.round(goalSum.protein / goalSum.n),
      carbs: Math.round(goalSum.carbs / goalSum.n),
      fat: Math.round(goalSum.fat / goalSum.n),
    } : null;
    // Top logged food: counts actually-eaten log rows as-is (not recipe-
    // exploded like the Shopping List's own tally), one count per entry,
    // normalized name groups casing/whitespace variants of the same food
    // the way fdShoppingKey does, display uses whichever raw name the group
    // was first seen under.
    const counts = new Map();
    (store.foodLogs || []).forEach(e => {
      if (e.planned || !e.foodName || e.date < range.from || e.date > range.to) return;
      const key = fdNormFoodName(e.foodName);
      const row = counts.get(key) || { name: e.foodName, count: 0 };
      row.count++;
      counts.set(key, row);
    });
    let top = null;
    counts.forEach(row => { if (!top || row.count > top.count) top = row; });
    return { days, loggedDays: loggedDates.length, goalDays: goalDays.length, avgCal, rate, best, avgMacros, avgGoalMacros, top };
  }, [store.dailyLogs, store.foodLogs, range]);

  const segBtn = (id, label) => (
    <button onClick={() => setPeriod(id)} style={{
      flex: 1, padding: '7px 0', border: 'none', cursor: 'pointer',
      background: period === id ? 'var(--accent)' : 'transparent',
      color: period === id ? 'var(--accent-ink)' : UI.inkFaint,
      textShadow: period === id ? 'none' : 'var(--text-lift)',
      fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', WebkitTapHighlightColor: 'transparent',
    }}>{label}</button>
  );
  const statCard = (label, value, sub) => (
    <div style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, padding: '11px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 5 }}>{label}</div>
      <div className="num" style={{ fontSize: 19, color: UI.ink, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}{sub && <span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 4, fontFamily: UI.fontUi }}>{sub}</span>}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 14 }}>
        {segBtn(7, '7D')}{segBtn(30, '30D')}{segBtn(90, '90D')}{segBtn('custom', 'Custom')}
      </div>
      {period === 'custom' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...fdInputStyle, colorScheme: timeColorScheme }} /></Field>
          <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...fdInputStyle, colorScheme: timeColorScheme }} /></Field>
        </div>
      )}
      <div style={{ marginBottom: 20 }}>
        <HealthBarChart series={s.days} from={range.from} to={range.to}
          format={v => `${Math.round(v)}%`} target={FD_STATS_GOAL_ADHERENCE}
          color={UI.ok} colorSoft="rgba(var(--ok-rgb),0.35)" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
        {statCard('Best streak', `🔥 ${s.best}`, 'days')}
        {statCard('Goal hit', `${s.rate}`, '%')}
        {statCard('Goal days', `${s.goalDays}`, 'days')}
        {statCard('Days logged', `${s.loggedDays}`, 'days')}
        {statCard('Avg / day', `${s.avgCal}`, 'kcal')}
        {statCard('Top food', s.top ? s.top.name : 'None', s.top ? `${s.top.count}x` : null)}
      </div>
      {s.avgMacros && (
        <Card style={{ padding: 14 }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>Average macros this period</div>
          <FdMacroBits protein={s.avgMacros.protein} carbs={s.avgMacros.carbs} fat={s.avgMacros.fat} strong />
          {s.avgGoalMacros && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 6 }}>Average goal</div>
              <FdMacroBits protein={s.avgGoalMacros.protein} carbs={s.avgGoalMacros.carbs} fat={s.avgGoalMacros.fat} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// Multi-select ingredient picker for the recipe editor. Tapping a search
// result / favorite / recent item opens a quantity step (same idiom as
// FoodScreen's own quantity sheet) to choose its amount; "Add" there stages
// it (not yet in the recipe) instead of committing straight away. A running
// "Add N ingredients" button at the bottom commits the whole staged batch
// into the recipe in one go via onAdd. Picking the same food twice just
// stages a second row, recipes have no dedup rule (e.g. "2 eggs" as two
// separate 1-egg picks is fine). Correcting an already-committed ingredient
// afterwards is RecipeEditorScreen's own per-row edit, not this sheet's job.
function FdIngredientPicker({ open, onClose, onAdd, store }) {
  const [confirmEl, confirm] = useConfirm();
  const [pickTab, setPickTab] = useStateFd('search');
  const [query, setQuery] = useStateFd('');
  const [searching, setSearching] = useStateFd(false);
  const [searchError, setSearchError] = useStateFd(null);
  const [results, setResults] = useStateFd(null);
  const [manualOpen, setManualOpen] = useStateFd(false);
  const [mName, setMName] = useStateFd('');
  const [mG, setMG] = useStateFd('');
  const [mP, setMP] = useStateFd('');
  const [mC, setMC] = useStateFd('');
  const [mF, setMF] = useStateFd('');
  const [mFib, setMFib] = useStateFd('');
  const [mCal, setMCal, onMCalChange, mCalTouched, setMCalTouched] =
    useAutoDerivedCalories(mP, mC, mF, fdNum(mFib), !!store.settings?.netCarbs);
  const [staged, setStaged] = useStateFd([]);
  // The item currently being quantified (normalized to per-100g rates), or
  // null while browsing. Search/favorites/recent all funnel through this one
  // quantity step before joining `staged`.
  const [qtyItem, setQtyItem] = useStateFd(null);
  const [qtyG, setQtyG] = useStateFd('');
  const [qtyUnitIdx, setQtyUnitIdx] = useStateFd(null);
  const [qtyCountStr, setQtyCountStr] = useStateFd('');
  // Same All/Zane/OFF/USDA filter the main Search tab has, shown only once a
  // search has run (see the template picker for the same reasoning).
  const [pickSource, setPickSource] = useStateFd(null);
  // Scan entry points for the Search tab, mirroring FoodScreen's own
  // scanPickerOpen/scanOpen/labelScanning/labelError/labelScannerProvider
  // quintet (same shared per-device localStorage key, see
  // logbook-label-scanner-provider in CLAUDE.md).
  const [scanPickerOpen, setScanPickerOpen] = useStateFd(false);
  const [scanOpen, setScanOpen] = useStateFd(false);
  const [labelScanning, setLabelScanning] = useStateFd(false);
  const [labelError, setLabelError] = useStateFd(null);
  const [labelScannerProvider, setLabelScannerProvider] = useStateFd(fdReadScannerProvider);
  useEffectFd(() => {
    const onChange = e => setLabelScannerProvider(e.detail);
    window.addEventListener('zane-scanner-provider', onChange);
    return () => window.removeEventListener('zane-scanner-provider', onChange);
  }, []);
  const labelInputRef = useRefFd(null);

  useEffectFd(() => {
    if (!open) return;
    setPickTab('search'); setQuery(''); setResults(null); setSearchError(null); setPickSource(null);
    setManualOpen(false);
    setMName(''); setMG(''); setMP(''); setMC(''); setMF(''); setMFib(''); setMCal(''); setMCalTouched(false);
    setStaged([]);
    setQtyItem(null); setQtyG(''); setQtyUnitIdx(null); setQtyCountStr('');
    setScanPickerOpen(false); setScanOpen(false); setLabelScanning(false); setLabelError(null);
  }, [open]);

  // override: handleScan calls this in the same tick it sets query, so the
  // state has not committed yet and reading it here would search the
  // previous query. srcOverride: same deal for the filter buttons and
  // pickSource.
  async function runPickerSearch(override, srcOverride) {
    const q = (typeof override === 'string' ? override : query).trim();
    if (!q || searching) return;
    setSearching(true); setSearchError(null);
    const res = await LB.searchFoods(q, srcOverride !== undefined ? srcOverride : pickSource);
    setSearching(false);
    if (!res.ok) { setSearchError(res.error || 'Search failed. Try again.'); setResults([]); return; }
    setResults(res.results);
  }
  // A scanned barcode runs straight through the normal search (same as
  // FoodScreen's handleScan): the found product shows as a result to tap.
  function handleScan(code) {
    setScanOpen(false);
    setQuery(code);
    runPickerSearch(code);
  }

  // Nutrition-label scan, mirrors FoodScreen's handleLabelFile/prefillFromLabel
  // pair, landing in the same qtyItem/quantity-step shape a search result
  // uses (openQtyForResult) instead of a separate path.
  async function handleLabelFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // let the user re-pick the same photo after an error
    if (!file) return;
    setLabelError(null);
    setLabelScanning(true);
    try {
      const { base64, mimeType } = await fdDownscaleImage(file);
      if (!base64) { setLabelScanning(false); setLabelError('Could not read that image. Try again.'); return; }
      const res = await LB.scanLabel(base64, mimeType, labelScannerProvider);
      setLabelScanning(false);
      if (!res.ok) { setLabelError(res.error || 'Scan failed. Try again.'); return; }
      prefillFromLabel(res.label);
    } catch (_) {
      setLabelScanning(false);
      setLabelError('Could not read that image. Try again.');
    }
  }

  // Same per-100 normalization FoodScreen's prefillFromLabel does. A scalable
  // basis (100g/100ml, or a serving weight to convert through) opens the
  // quantity step exactly like a search result (openQtyForResult); source:
  // 'custom' and no sourceId means confirmStageItem's ensureFoodCached call
  // correctly skips caching it, same as any hand-typed food. No scalable
  // basis at all falls back to the manual-entry form's typed totals, this
  // sheet's only other way to stage a fixed (non-scalable) amount.
  function prefillFromLabel(label) {
    if (!label || label.is_nutrition_label === false) {
      setLabelError("That doesn't look like a nutrition label. Try a straight-on photo of the table.");
      return;
    }
    const cal = label.calories, p = label.protein_g, c = label.carbs_g, f = label.fat_g, fib = label.fiber_g;
    const sug = label.sugar_g, sat = label.sat_fat_g, sod = label.sodium_mg;
    if (cal == null && p == null && c == null && f == null) {
      setLabelError('Could not read the values. Try a clearer photo, or add it manually.');
      return;
    }
    const per100 = (label.basis === '100g' || label.basis === '100ml')
      ? { p, c, f, fib, sug, sat, sod }
      : (label.serving_size_g > 0)
        ? (k => ({
            p: p != null ? p * k : null, c: c != null ? c * k : null, f: f != null ? f * k : null,
            fib: fib != null ? fib * k : null, sug: sug != null ? sug * k : null,
            sat: sat != null ? sat * k : null, sod: sod != null ? sod * k : null,
          }))(100 / label.serving_size_g)
        : null;

    if (per100) {
      const netCarbs = !!store.settings?.netCarbs;
      setQtyItem({
        name: label.name || '', brand: label.brand || null, source: 'custom', sourceId: null,
        kcalPer100g: LB.caloriesFromMacros(per100.p, per100.c, per100.f, netCarbs ? per100.fib : null) || 0,
        proteinPer100g: per100.p, carbsPer100g: per100.c, fatPer100g: per100.f, fiberPer100g: per100.fib,
        sugarPer100g: per100.sug, satFatPer100g: per100.sat, sodiumMgPer100g: per100.sod,
        fromCache: false, units: null,
      });
      setQtyUnitIdx(null); setQtyCountStr('');
      setQtyG((label.basis === '100g' || label.basis === '100ml') ? '100' : String(Math.round(label.serving_size_g)));
      return;
    }

    // No scalable basis: fall back to the manual-entry form's typed totals,
    // this sheet's own last resort, same role FoodScreen's Custom Item form
    // plays for this case.
    setManualOpen(true);
    setMName(label.name || ''); setMG('');
    setMP(p != null ? String(Math.round(p)) : ''); setMC(c != null ? String(Math.round(c)) : ''); setMF(f != null ? String(Math.round(f)) : '');
    setMFib(fib != null ? String(Math.round(fib)) : '');
  }

  function closeQtySheet() { setQtyItem(null); setQtyG(''); setQtyUnitIdx(null); setQtyCountStr(''); }
  // Opens the quantity step for a search result: per-100g rates are already
  // right there in the search response, default amount is its stated
  // serving (else 100g), same defaults pickResult uses in FoodScreen.
  function openQtyForResult(r) {
    setQtyItem({
      name: r.name, brand: r.brand || null, source: r.source, sourceId: r.sourceId,
      kcalPer100g: r.kcalPer100g, proteinPer100g: r.proteinPer100g, carbsPer100g: r.carbsPer100g,
      fatPer100g: r.fatPer100g, fiberPer100g: r.fiberPer100g,
      sugarPer100g: r.sugarPer100g ?? null, satFatPer100g: r.satFatPer100g ?? null, sodiumMgPer100g: r.sodiumMgPer100g ?? null,
      fromCache: !!r.cached, units: null,
    });
    setQtyUnitIdx(null); setQtyCountStr('');
    setQtyG(r.servingSizeG != null ? String(Math.round(r.servingSizeG)) : '100');
  }
  // Opens the quantity step for a favorite or a past log entry: both only
  // carry already-scaled macros, so per-100g rates are derived from their
  // own quantityG first, same trick reAddFromRecent uses in FoodScreen.
  function openQtyForLog(l) {
    const per100 = l.quantityG > 0 ? 100 / l.quantityG : 1;
    const netCarbs = !!store.settings?.netCarbs;
    setQtyItem({
      name: l.foodName, brand: l.brand || null, source: l.source,
      sourceId: l.foodId ? l.foodId.slice((l.source || '').length + 1) : null,
      kcalPer100g: (LB.caloriesFromMacros(l.protein, l.carbs, l.fat, netCarbs ? l.fiber : null) || 0) * per100,
      proteinPer100g: l.protein * per100, carbsPer100g: l.carbs * per100, fatPer100g: l.fat * per100,
      fiberPer100g: l.fiber != null ? l.fiber * per100 : null,
      sugarPer100g: l.sugar != null ? l.sugar * per100 : null,
      satFatPer100g: l.satFat != null ? l.satFat * per100 : null,
      sodiumMgPer100g: l.sodiumMg != null ? l.sodiumMg * per100 : null,
      fromCache: true, units: l.units || null,
    });
    setQtyUnitIdx(null); setQtyCountStr('');
    setQtyG(l.quantityG != null ? String(l.quantityG) : '100');
  }
  function selectQtyUnit(idx) {
    setQtyUnitIdx(idx);
    if (idx == null) { setQtyCountStr(''); return; }
    const unit = qtyItem?.units?.[idx];
    if (!unit || !(unit.grams > 0)) return;
    const curG = fdNum(qtyG);
    const count = curG != null ? fdRound1(curG / unit.grams) : 1;
    setQtyCountStr(String(count));
    setQtyG(String(fdRound1(count * unit.grams)));
  }
  function onQtyCountChange(v) {
    const filtered = fdDecimalFilter(v);
    setQtyCountStr(filtered);
    const unit = qtyItem?.units?.[qtyUnitIdx];
    const n = fdNum(filtered);
    setQtyG(unit && n != null ? String(fdRound1(n * unit.grams)) : '');
  }
  const qtyPreview = useMemoFd(() => {
    if (!qtyItem) return null;
    const qty = fdNum(qtyG);
    if (!qty || qty <= 0) return null;
    const factor = qty / 100;
    const netCarbs = !!store.settings?.netCarbs;
    const protein = fdRound1((qtyItem.proteinPer100g || 0) * factor);
    const carbs = fdRound1((qtyItem.carbsPer100g || 0) * factor);
    const fat = fdRound1((qtyItem.fatPer100g || 0) * factor);
    const fiber = qtyItem.fiberPer100g != null ? fdRound1(qtyItem.fiberPer100g * factor) : null;
    // Migration 0204 extras, scaled like the rest so an ingredient carries them
    // into the recipe it joins. null stays null ("source does not report it").
    const sugar = qtyItem.sugarPer100g != null ? fdRound1(qtyItem.sugarPer100g * factor) : null;
    const satFat = qtyItem.satFatPer100g != null ? fdRound1(qtyItem.satFatPer100g * factor) : null;
    const sodiumMg = qtyItem.sodiumMgPer100g != null ? Math.round(qtyItem.sodiumMgPer100g * factor) : null;
    return {
      calories: Math.round(LB.caloriesFromMacros(protein, carbs, fat, netCarbs ? fiber : null) || 0),
      protein, carbs, fat, fiber, sugar, satFat, sodiumMg,
    };
  }, [qtyItem, qtyG, store.settings?.netCarbs]);
  // "Add" on the quantity step: stages the item (not yet in the recipe, see
  // the "Add N ingredients" button below) and caches a not-yet-cached DB
  // food right away, same rule confirmLogFood/toggleFavorite use in
  // FoodScreen (a recipe is as durable a record as a favorite).
  function confirmStageItem() {
    if (!qtyItem || !qtyPreview) return;
    setStaged(list => [...list, {
      tempId: LB.uid(),
      foodId: qtyItem.sourceId ? `${qtyItem.source}:${qtyItem.sourceId}` : null,
      foodName: qtyItem.name, brand: qtyItem.brand, source: qtyItem.source,
      quantityG: fdNum(qtyG), calories: qtyPreview.calories, protein: qtyPreview.protein,
      carbs: qtyPreview.carbs, fat: qtyPreview.fat, fiber: qtyPreview.fiber,
      sugar: qtyPreview.sugar, satFat: qtyPreview.satFat, sodiumMg: qtyPreview.sodiumMg,
    }]);
    ensureFoodCached(qtyItem);
    closeQtySheet();
  }
  function removeStaged(tempId) {
    setStaged(list => list.filter(i => i.tempId !== tempId));
  }

  const recentPicks = useMemoFd(() => {
    // Sort by (date, time) first, exactly like recentFoodsAll: store.foodLogs
    // is not in date order (a backdated entry gets prepended), so the
    // first-seen-wins walk below picked essentially arbitrary "recent" foods.
    const sorted = [...(store.foodLogs || [])].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.time || '') < (b.time || '') ? 1 : (a.time || '') > (b.time || '') ? -1 : 0;
    });
    const seen = new Set(); const out = [];
    for (const l of sorted) {
      const key = l.foodId || `custom:${l.foodName}`;
      if (seen.has(key)) continue;
      seen.add(key); out.push(l);
      if (out.length >= 20) break;
    }
    return out;
  }, [store.foodLogs]);
  // Alphabetical, same as FoodScreen's own favoritesFiltered: store.foodFavorites
  // is otherwise recency/insertion-ordered, which read as random here.
  const favoritesSorted = useMemoFd(
    () => [...(store.foodFavorites || [])].sort((a, b) => a.foodName.localeCompare(b.foodName)),
    [store.foodFavorites],
  );

  const manualValid = mName.trim() && fdNum(mP) != null && fdNum(mC) != null && fdNum(mF) != null && fdNum(mCal) != null;
  // A manual entry already carries its exact quantity and macros with
  // nothing to scale, so it stages directly, skipping the quantity step.
  function submitManual() {
    if (!manualValid) return;
    const g = fdNum(mG);
    setStaged(list => [...list, {
      tempId: LB.uid(),
      foodId: null, foodName: mName.trim(), brand: null, source: 'custom',
      quantityG: g != null ? g : 100, calories: Math.round(fdNum(mCal)), protein: fdNum(mP), carbs: fdNum(mC), fat: fdNum(mF),
      fiber: mFib !== '' ? fdNum(mFib) : null,
      sugar: null, satFat: null, sodiumMg: null,
    }]);
    setManualOpen(false);
    setMName(''); setMG(''); setMP(''); setMC(''); setMF(''); setMFib(''); setMCal(''); setMCalTouched(false);
  }

  async function requestClosePicker() {
    if (staged.length && !await confirm(`${staged.length} picked ingredient${staged.length === 1 ? '' : 's'} won't be added.`, { title: 'Discard picks?', ok: 'Discard', cancel: 'Keep picking', danger: true })) return;
    onClose();
  }
  function commitStaged() {
    if (!staged.length) return;
    // tempId only ever identified a row within this sheet's own staged
    // list; RecipeEditorScreen assigns each item its real id on the way in.
    onAdd(staged.map(({ tempId, ...item }) => item));
    setStaged([]);
    onClose();
  }
  const stagedTotals = useMemoFd(() => ({
    calories: Math.round(staged.reduce((a, i) => a + (i.calories || 0), 0)),
    protein: fdRound1(staged.reduce((a, i) => a + (i.protein || 0), 0)),
    carbs: fdRound1(staged.reduce((a, i) => a + (i.carbs || 0), 0)),
    fat: fdRound1(staged.reduce((a, i) => a + (i.fat || 0), 0)),
  }), [staged]);

  // Sibling Sheets, not nested in each other's children (the app's
  // documented overlay convention, docs/internals.md "Modal-/Overlay-
  // Landschaft": a Sheet that must render above another already-open Sheet
  // gets a bumped zIndex instead, tier 200 = "must sit above a specific open
  // Sheet/Screen", same tier Account-Switch/Chart-Popups already use).
  return (
    <>
      <Sheet open={open} onClose={requestClosePicker} title="Add ingredients" titleColor="var(--accent)">
        {confirmEl}
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 12 }}>
          {FD_PICKER_TABS.map(t => (
            <button key={t.id} onClick={() => setPickTab(t.id)} style={fdSegBtn(pickTab === t.id)}>{t.label}</button>
          ))}
        </div>

        {pickTab === 'search' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runPickerSearch(); }}
                  type="text" placeholder="Search food, or scan →" style={{ ...fdInputStyle, paddingRight: 32 }} />
                {query && (
                  <button onClick={() => { setQuery(''); setResults(null); setSearchError(null); }} aria-label="Clear search" style={fdClearBtn}>
                    <i className="fa-solid fa-circle-xmark" style={{ fontSize: 15 }} />
                  </button>
                )}
              </div>
              <button onClick={() => setScanPickerOpen(true)} aria-label="Scan barcode or nutrition label" style={fdSearchBtn}>
                <i className="fa-solid fa-barcode" style={{ fontSize: 14 }} />
              </button>
              <button onClick={() => runPickerSearch()} disabled={searching || !query.trim()} aria-label="Search" style={fdSearchBtn}>
                {searching ? <span style={{ fontFamily: UI.fontUi, fontSize: 11 }}>…</span> : <i className="fa-solid fa-magnifying-glass" style={{ fontSize: 13 }} />}
              </button>
            </div>
            {labelError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginBottom: 10, lineHeight: '16px' }}>{labelError}</div>}
            {results != null && (
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 10 }}>
                {FD_SOURCE_FILTERS.map(f => (
                  <button key={f.label} onClick={() => { setPickSource(f.id); runPickerSearch(undefined, f.id); }} style={fdSegBtn(pickSource === f.id)}>{f.label}</button>
                ))}
              </div>
            )}
            {searchError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginBottom: 10 }}>{searchError}</div>}
            {results != null && (
              results.length === 0 ? (
                <div style={fdEmptyHint}>No matches. Try a different search.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, maxHeight: 280, overflowY: 'auto' }}>
                  {results.map(r => {
                    // Same guard the main Search tab applies, see there.
                    const noData = r.kcalPer100g == null;
                    return (
                      <button key={`${r.source}:${r.sourceId}`} onClick={() => openQtyForResult(r)} disabled={noData}
                        style={{ ...fdResultRow, ...(noData ? { cursor: 'default', opacity: 0.55 } : null) }}>
                        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          <div style={fdEntryName}>{r.name}</div>
                          {r.brand && <div style={fdEntryMeta}>{r.brand}</div>}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          {noData
                            ? <div style={fdEntryMeta}>No nutrition data</div>
                            : <>
                                <div className="num" style={{ fontSize: 12, color: UI.warn }}>{Math.round(r.kcalPer100g)} kcal</div>
                                <div style={fdEntryMeta}>/100g</div>
                              </>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            )}
            {!manualOpen ? (
              <button onClick={() => setManualOpen(true)} style={{ ...fdActionCard, width: '100%' }}>
                <i className="fa-solid fa-keyboard" style={{ fontSize: 14 }} />
                <span>Add manually</span>
              </button>
            ) : (
              <div style={{ borderTop: `var(--hair-width) solid ${UI.hair}`, paddingTop: 14, marginTop: 4 }}>
                <Field label="Name" style={{ marginBottom: 10 }}>
                  <TextInput value={mName} onChange={setMName} placeholder="e.g. Homemade sauce" />
                </Field>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <Field label="Amount (g)" style={{ flex: 1 }}>
                    <input value={mG} onChange={e => setMG(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
                  </Field>
                  <Field label="Calories (kcal)" style={{ flex: 1 }}>
                    <input value={mCal} onChange={e => onMCalChange(e.target.value)} type="text" inputMode="decimal" placeholder="kcal" style={fdInputStyle} />
                  </Field>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <Field label="Protein (g)" style={{ flex: 1 }}>
                    <input value={mP} onChange={e => setMP(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
                  </Field>
                  <Field label="Carbs (g)" style={{ flex: 1 }}>
                    <input value={mC} onChange={e => setMC(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
                  </Field>
                  <Field label="Fat (g)" style={{ flex: 1 }}>
                    <input value={mF} onChange={e => setMF(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
                  </Field>
                </div>
                <Field label="Fiber (g, optional)" style={{ marginBottom: 14 }}>
                  <input value={mFib} onChange={e => setMFib(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
                </Field>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn kind="ghost" onClick={() => setManualOpen(false)} style={{ flex: 1 }}>Cancel</Btn>
                  <Btn onClick={submitManual} disabled={!manualValid} style={{ flex: 2 }}>Add ingredient</Btn>
                </div>
              </div>
            )}
          </>
        )}

        {pickTab === 'favorites' && (
          favoritesSorted.length === 0 ? (
            <div style={fdEmptyHint}>No favorites yet. Star a food while adding it to save it here.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
              {favoritesSorted.map(f => (
                <button key={f.id} onClick={() => openQtyForLog(f)} style={fdResultRow}>
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {f.foodId && <i className="fa-solid fa-circle-check" style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }} title="In the shared food database" />}
                      <div style={{ ...fdEntryName, minWidth: 0 }}>{f.foodName}</div>
                    </div>
                    {f.brand && <div style={fdEntryMeta}>{f.brand}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="num" style={{ fontSize: 12, color: UI.warn }}>{f.calories} kcal</div>
                    <div style={fdEntryMeta}>{f.quantityG}g</div>
                  </div>
                </button>
              ))}
            </div>
          )
        )}

        {pickTab === 'recent' && (
          recentPicks.length === 0 ? (
            <div style={fdEmptyHint}>Nothing logged yet. Foods you add show up here.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
              {recentPicks.map(l => (
                <button key={l.id} onClick={() => openQtyForLog(l)} style={fdResultRow}>
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {l.foodId && <i className="fa-solid fa-circle-check" style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }} title="In the shared food database" />}
                      <div style={{ ...fdEntryName, minWidth: 0 }}>{l.foodName}</div>
                    </div>
                    {l.brand && <div style={fdEntryMeta}>{l.brand}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="num" style={{ fontSize: 12, color: UI.warn }}>{l.calories} kcal</div>
                    <div style={fdEntryMeta}>{l.quantityG}g</div>
                  </div>
                </button>
              ))}
            </div>
          )
        )}

        {staged.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
            <Bezel style={{ marginBottom: 10 }}>Picked ({staged.length})</Bezel>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10 }}>
              <span className="num" style={{ fontSize: 18, fontWeight: 300, color: UI.ink }}>{stagedTotals.calories}<span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 3 }}>kcal</span></span>
              <FdMacroGhosts protein={stagedTotals.protein} carbs={stagedTotals.carbs} fat={stagedTotals.fat} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 168, overflowY: 'auto' }}>
              {staged.map(i => (
                <div key={i.tempId} style={fdDraftRow}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ ...fdEntryName, fontSize: 12 }}>{i.foodName}</span>
                    <span style={fdEntryMeta}>{i.quantityG}g · <span className="num" style={{ color: UI.warn }}>{i.calories} kcal</span></span>
                  </div>
                  <button onClick={() => removeStaged(i.tempId)} aria-label="Remove" style={fdInlineDeleteBtn}>
                    <i className="fa-solid fa-trash" style={{ fontSize: 11 }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Btn kind="ghost" onClick={requestClosePicker} style={{ flex: 1 }}>Close</Btn>
          <Btn onClick={commitStaged} disabled={!staged.length} style={{ flex: 2 }}>
            Add {staged.length} ingredient{staged.length === 1 ? '' : 's'}
          </Btn>
        </div>
      </Sheet>

      {/* ── Quantity step for a tapped search result / favorite / recent item:
          choose the amount, "Add" here stages it into the picker above. A
          sibling Sheet (not nested in the picker's own children), bumped to
          zIndex 200 so it renders above the still-open picker Sheet. ── */}
      <Sheet open={!!qtyItem} onClose={closeQtySheet} title={qtyItem?.name || 'Amount'} titleColor="var(--accent)" zIndex={200}>
        {qtyItem && (
          <>
            {qtyItem.brand && <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 14 }}>{qtyItem.brand}</div>}
            {qtyItem.units?.length > 0 && (
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 10, flexWrap: 'wrap' }}>
                <button onClick={() => selectQtyUnit(null)} style={fdSegBtn(qtyUnitIdx == null)}>Grams</button>
                {qtyItem.units.map((u, i) => (
                  <button key={i} onClick={() => selectQtyUnit(i)} style={fdSegBtn(qtyUnitIdx === i)}>{u.label}</button>
                ))}
              </div>
            )}
            <Field label={qtyUnitIdx == null ? 'Amount (g)' : `Count (${qtyItem.units[qtyUnitIdx].label})`} style={{ marginBottom: 14 }}>
              <input
                value={qtyUnitIdx == null ? qtyG : qtyCountStr}
                onChange={e => qtyUnitIdx == null ? setQtyG(fdDecimalFilter(e.target.value)) : onQtyCountChange(e.target.value)}
                type="text" inputMode="decimal" placeholder={qtyUnitIdx == null ? 'g' : 'count'} style={fdInputStyle}
              />
            </Field>
            {qtyPreview && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 16 }}>
                <span className="num" style={{ fontSize: 20, fontWeight: 300, color: UI.ink }}>{qtyPreview.calories}<span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 3 }}>kcal</span></span>
                <FdMacroGhosts protein={qtyPreview.protein} carbs={qtyPreview.carbs} fat={qtyPreview.fat} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={closeQtySheet} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={confirmStageItem} disabled={!qtyPreview} style={{ flex: 2 }}>Add</Btn>
            </div>
          </>
        )}
      </Sheet>

      {/* ── Barcode vs. label picker (opened by the search row's scan
          button), same sibling-Sheet/zIndex-200 pattern as the quantity step
          above, since it also must render above the still-open "Add
          ingredients" Sheet. ── */}
      <Sheet open={scanPickerOpen} onClose={() => setScanPickerOpen(false)} title="Scan" titleColor="var(--accent)" zIndex={200}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <button onClick={() => { setScanPickerOpen(false); setScanOpen(true); }} style={fdScanChoice}>
            <i className="fa-solid fa-barcode" style={{ fontSize: 22, color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>Barcode</span>
            <span style={{ fontSize: 10, color: UI.inkFaint, lineHeight: 1.3 }}>The code on the packaging</span>
          </button>
          <button onClick={() => { setScanPickerOpen(false); setLabelError(null); labelInputRef.current && labelInputRef.current.click(); }} style={fdScanChoice}>
            <i className="fa-solid fa-camera" style={{ fontSize: 22, color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink }}>Nutrition label</span>
            <span style={{ fontSize: 10, color: UI.inkFaint, lineHeight: 1.3 }}>Photograph the facts table</span>
          </button>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="micro" style={{ marginBottom: 6 }}>Label reader (nutrition label only)</div>
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
            {[['grok', 'Grok'], ['claude', 'Claude']].map(([id, label]) => (
              <button key={id} onClick={() => { setLabelScannerProvider(id); fdWriteScannerProvider(id); }} style={fdSegBtn(labelScannerProvider === id)}>{label}</button>
            ))}
          </div>
        </div>
      </Sheet>

      {/* Hidden picker: opens the native camera (capture) or gallery on tap,
          which works on iOS Safari without any library. */}
      <input ref={labelInputRef} type="file" accept="image/*" capture="environment" onChange={handleLabelFile} style={{ display: 'none' }} />
      {labelScanning && <FdLabelBusy />}
      {scanOpen && <FdScanner onClose={() => setScanOpen(false)} onDetect={handleScan} />}
    </>
  );
}

// Same traffic-light thresholds as screens-health.jsx's adherenceColor
// (green >=90, amber 75-89, red <75), duplicated locally rather than
// relied on as a cross-file global: classic scripts share one execution
// scope so calling screens-health.jsx's version would happen to work
// given today's load order, but that's an implicit coupling this tiny a
// helper isn't worth introducing.
function fdAdherenceColor(a) {
  if (a == null) return UI.inkFaint;
  if (a >= 90) return UI.ok;
  if (a >= 75) return UI.warn;
  return UI.danger;
}

// Adherence-progress ring for the Log-tab hero, same shape as WaterRing
// (screens-water.jsx) so both daily-total heroes read as the same idiom.
// Takes an explicit color (fdAdherenceColor's tier color, unlike the old
// fixed var(--accent) stroke) and an optional small label under the number,
// so the ring itself carries the same "PERFECT/STRONG/..." semantic tone the
// hero's rows do instead of always reading as a flat accent-colored dial.
function FdRing({ percent, size = 128, color = UI.gold, label }) {
  const r = 50, circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(percent, 100) / 100);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke={UI.hair} strokeWidth="12" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circ.toFixed(1)} strokeDashoffset={offset.toFixed(1)}
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)' }} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontFamily: UI.fontNum, fontSize: 26, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{percent}%</span>
        {label && <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>{label}</span>}
      </div>
    </div>
  );
}

// Local duplicate of screens-health.jsx's MACRO_COLORS (same values), not
// relied on as a cross-file global for the same reason fdAdherenceColor
// above isn't: classic scripts share one execution scope so reaching across
// would happen to work today, but that's an implicit coupling this small a
// token map isn't worth introducing. protein uses the fixed --info blue
// rather than --accent: --accent is user-customizable and collides with
// --ok/--danger the moment someone picks green or red as their accent
// (fixed here after exactly that: red accent made protein and fat read as
// the same color). Applies generally, not just for a red accent, hence a
// fixed token instead of a per-accent special case.
const FD_MACRO_COLORS = { protein: UI.info, carbs: UI.ok, fat: UI.danger };

// One metric row in the dense hero (KCAL/PROTEIN/CARBS/FAT): label, a thin
// fill bar showing actual vs target, the actual/target pair, and the delta
// as a signed percent. The delta is intentionally neutral-colored rather
// than green/red: whether running over or under a given macro is "good"
// depends on the user's own goal (bulk vs cut), which this row has no way
// to know, so it states the fact without editorializing. The track's
// UI.hairStrong outline needs no light/dark special-casing: --hair-strong
// is already ink-derived, so it's dark in the light theme and light in the
// dark themes on its own.
function FdHeroRow({ label, color, actual, target, unit = '' }) {
  if (target == null) return null;
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  const delta = target > 0 ? Math.round(((actual - target) / target) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 46, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', color, fontFamily: UI.fontUi }}>{label}</span>
      <div style={{ flex: 1, height: 4, borderRadius: 999, background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
      <span className="num" style={{ fontSize: 11, fontWeight: 600, color, flexShrink: 0, textAlign: 'right' }}>
        {Math.round(actual)}{unit} / {Math.round(target)}{unit}
      </span>
      <span className="num" style={{ fontSize: 10, color: UI.inkFaint, flexShrink: 0, width: 30, textAlign: 'right' }}>
        {delta > 0 ? '+' : ''}{delta}%
      </span>
    </div>
  );
}

// Extracted from the Log tab's live hero so the exact same markup can be
// reused verbatim in the screenshot poster below (FoodScreen), instead of
// two copies drifting apart. Pure/presentational: everything it needs is
// passed in, nothing read from FoodScreen's own closure.
// projected (Plan Mode only): logged + planned totals, shown as a small
// "where the day is headed" line below the real numbers. null unless plan
// mode is on AND the day has planned entries, so the default view is
// untouched.
// onSetTargets (live hero only, never the screenshot poster): with no target
// resolvable the hero can only show a bare total, which is also the exact
// moment the question "what should this number be?" comes up. Omitted by the
// poster, so the button never renders into an exported image.
function FdHeroContent({ dayTarget, dayAdherence, dayTotals, goalCalories, projected, projectedAdherence, onSetTargets, unscored }) {
  const projectionLine = projected ? (
    <FdProjectionLine macros={{
      calories: { delta: projected.calories - dayTotals.calories, total: projected.calories },
      protein: { delta: projected.protein - dayTotals.protein, total: projected.protein },
      carbs:   { delta: projected.carbs   - dayTotals.carbs,   total: projected.carbs },
      fat:     { delta: projected.fat     - dayTotals.fat,     total: projected.fat },
    }} goalCalories={goalCalories} adherence={projectedAdherence} />
  ) : null;
  return dayTarget ? (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        {/* A day that is deliberately unscored gets the reason in place of
            the dial. Rendering FdRing at 0% would read as "you scored zero",
            which is the opposite of what a declared day means, and it is what
            makes this hero disagree with the Health tab today. The four bars
            below stay: actual against target is exactly what the user needs
            while deciding how much budget to spend. */}
        {unscored ? (
          <div style={{ width: 104, flexShrink: 0, textAlign: 'center' }}>
            <i className="fa-solid fa-utensils" style={{ fontSize: 22, color: 'var(--accent)' }} />
            <div className="micro" style={{ marginTop: 8, lineHeight: '12px' }}>Not scored</div>
            <div className="micro-gold" style={{ marginTop: 3, lineHeight: '12px' }}>{unscored}</div>
          </div>
        ) : (
          <FdRing percent={dayAdherence ?? 0} size={104} color={fdAdherenceColor(dayAdherence)} label="ADHERENCE" />
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <FdHeroRow label="KCAL" color={UI.warn} actual={dayTotals.calories} target={goalCalories} />
          <FdHeroRow label="PROTEIN" color={FD_MACRO_COLORS.protein} actual={dayTotals.protein} target={dayTarget.protein} unit="g" />
          <FdHeroRow label="CARBS" color={FD_MACRO_COLORS.carbs} actual={dayTotals.carbs} target={dayTarget.carbs} unit="g" />
          <FdHeroRow label="FAT" color={FD_MACRO_COLORS.fat} actual={dayTotals.fat} target={dayTarget.fat} unit="g" />
        </div>
      </div>
      {projectionLine}
    </>
  ) : (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className="num" style={{ fontSize: 40, fontWeight: 300, color: UI.ink, lineHeight: 1 }}>{dayTotals.calories}</span>
        <span style={{ fontSize: 15, color: UI.inkFaint, fontFamily: UI.fontUi }}>kcal</span>
      </div>
      <FdMacroGhosts protein={dayTotals.protein} carbs={dayTotals.carbs} fat={dayTotals.fat} style={{ marginTop: 12 }} />
      {onSetTargets && (
        <button className="micro-gold" onClick={onSetTargets} style={{
          display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, padding: 0,
          background: 'none', border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}>
          <i className="fa-solid fa-calculator" style={{ fontSize: 10 }} />
          Set macro targets
        </button>
      )}
      {projectionLine}
    </div>
  );
}
// Plan Mode projection: still-to-eat macros vs. the full logged+planned
// projection, each in its own centered column. Sits under the real totals as
// a lighter, dashed-topped table so it reads as a forecast, not part of the
// logged truth above it. The old standalone "+N kcal projected" line was
// dropped as redundant once this table shipped.
// goalCalories/adherence: what the day's adherence would read if every still-
// planned entry gets eaten. Shown only under Plan + Logged (the side these
// numbers actually describe), never under Still planned, which is a pure
// remainder with no target of its own to be judged against.
function FdProjectionLine({ macros, goalCalories, adherence }) {
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${UI.hairStrong}` }}>
      {/* Divider is scoped to this row alone (label + macro bits), not the
          whole block, so it stops where the two columns actually diverge
          instead of running down past a projection line that belongs to
          neither column on its own. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ textAlign: 'center', paddingRight: 10, borderRight: `var(--hair-width) solid ${UI.hairStrong}` }}>
          <div className="micro" style={{ marginBottom: 5 }}>Still planned</div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <FdMacroBits protein={macros.protein.delta} carbs={macros.carbs.delta} fat={macros.fat.delta} />
          </div>
        </div>
        <div style={{ textAlign: 'center', paddingLeft: 10 }}>
          <div className="micro" style={{ marginBottom: 5 }}>Plan + Logged</div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <FdMacroBits protein={macros.protein.total} carbs={macros.carbs.total} fat={macros.fat.total} />
          </div>
        </div>
      </div>
      {/* What the day's adherence would read at Plan + Logged (every still-
          planned entry eaten): centered under the whole table, since it's a
          property of the full projection, not of one column. */}
      {adherence != null && (
        <div style={{ marginTop: 8, textAlign: 'center', fontSize: 10, fontFamily: UI.fontUi, color: UI.inkFaint }}>
          {goalCalories != null && <>{Math.round(macros.calories.total)}<span style={{ color: UI.inkGhost }}> / {goalCalories} kcal</span>{' · '}</>}
          <span style={{ fontWeight: 700, color: fdAdherenceColor(adherence) }}>{adherence}%</span>
        </div>
      )}
    </div>
  );
}
// Full-screen dim while the label photo is uploaded and read. Kept dead simple
// (no cancel): the request is a couple of seconds and closing mid-flight would
// just discard a result the user asked for.
function FdLabelBusy() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.62)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 30, color: '#fff' }} />
      <div style={{ color: '#fff', fontFamily: UI.fontUi, fontSize: 13, letterSpacing: '0.02em' }}>Reading label…</div>
    </div>
  );
}

// Live-camera barcode scanner. Uses zbar-wasm (lazy-loaded via
// window.__ensureZbarWasm, same on-demand pattern as html2canvas): a real
// ZBar decoder compiled to WebAssembly, so it never depends on a browser
// barcode API at all. iOS Safari has no native BarcodeDetector (WebKit has
// never shipped it), and the previous html5-qrcode-based decoder had years
// of widely-reported failures decoding 1D barcodes (EAN/UPC) specifically
// on iOS Safari; zbar-wasm's own decoding doesn't hit that class of bug.
// This component owns the camera stream directly (getUserMedia) and draws
// each frame to a reused (Offscreen)Canvas for zbar-wasm to scan, following
// the library's own reference demo: recreating the canvas every frame
// (instead of resizing one in place) measurably slows decoding. Falls back
// to a "type the barcode" hint only if the library or camera is
// unavailable, the search box already handles typed barcodes.
//
// Known limitation, not fixable from here: multiple long-standing WebKit
// bugs make getUserMedia flaky specifically for a home-screen-installed
// ("standalone") PWA on iOS (permission not persisting, camera failing to
// restart after backgrounding, a camera-rotation bug on iOS 26) that don't
// reproduce in a plain Safari tab. That's a platform limitation independent
// of which decoder library is used.
function FdScanner({ onClose, onDetect }) {
  const [status, setStatus] = useStateFd('loading'); // 'loading' | 'scanning' | 'error'
  const videoRef = useRefFd(null);
  const streamRef = useRefFd(null);
  const canvasRef = useRefFd(null);
  const rafRef = useRefFd(null);
  const doneRef = useRefFd(false);
  useEffectFd(() => {
    let cancelled = false;
    let zbarWasm = null;

    async function detectFrame() {
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) return;
      const w = video.videoWidth, h = video.videoHeight;
      let canvas = canvasRef.current;
      if (!canvas || canvas.width !== w || canvas.height !== h) {
        canvas = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h) : document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvasRef.current = canvas;
      }
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      let symbols;
      try { symbols = await zbarWasm.scanImageData(imageData); } catch (_) { return; }
      if (doneRef.current || cancelled || !symbols?.length) return;
      const raw = symbols[0].decode().replace(/\D/g, '');
      if (!/^\d{8,14}$/.test(raw)) return;
      doneRef.current = true;
      onDetect(raw);
    }
    // Promise-chained rAF (not a fixed setInterval): waits for the previous
    // frame's draw + WASM decode to finish before scheduling the next one,
    // so it naturally throttles to whatever the device can sustain instead
    // of piling up overlapping scans.
    function tick() {
      if (cancelled || doneRef.current) return;
      detectFrame().finally(() => {
        if (!cancelled && !doneRef.current) rafRef.current = requestAnimationFrame(tick);
      });
    }

    (async () => {
      try { zbarWasm = await window.__ensureZbarWasm(); } catch (_) { zbarWasm = null; }
      if (cancelled) return;
      if (!zbarWasm) { setStatus('error'); return; }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
      } catch (_) {
        if (!cancelled) setStatus('error');
        return;
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      try { await video.play(); } catch (_) {}
      if (cancelled) return;
      setStatus('scanning');
      rafRef.current = requestAnimationFrame(tick);
    })();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const stream = streamRef.current;
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, []); // eslint-disable-line

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#000', display: 'flex', flexDirection: 'column', animation: 'sheet-up 0.22s ease' }}>
      <div style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 18px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1, color: '#fff', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600 }}>Scan barcode</span>
        <button onClick={onClose} aria-label="Close scanner" style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 34, height: 34, borderRadius: 4, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <video ref={videoRef} muted autoPlay playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        {status === 'error' ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32, textAlign: 'center' }}>
            <i className="fa-solid fa-barcode" style={{ fontSize: 34, color: 'rgba(255,255,255,0.45)' }} />
            <div style={{ color: '#fff', fontFamily: UI.fontUi, fontSize: 13, lineHeight: '20px', maxWidth: 300 }}>
              Could not start the scanner. Check the camera permission, or type the barcode number into search (it looks it up the same way).
            </div>
            <Btn onClick={onClose} style={{ marginTop: 4, textShadow: 'none' }}>Got it</Btn>
          </div>
        ) : (
          <div style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)', left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.85)', fontFamily: UI.fontUi, fontSize: 12 }}>
            {status === 'scanning' ? 'Point the camera at a barcode' : 'Starting camera…'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Local style constants ──────────────────────────────────────────
function fdNavBtn(disabled) {
  return {
    width: 32, height: 32, borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
    background: 'transparent', color: disabled ? UI.inkGhost : UI.inkSoft,
    cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  };
}
function fdSegBtn(active, danger) {
  return {
    flex: 1, padding: '7px 4px', border: 'none', cursor: 'pointer',
    background: active ? (danger ? UI.danger : 'var(--accent)') : 'transparent',
    color: active ? 'var(--accent-ink)' : UI.inkFaint,
    textShadow: active ? 'none' : 'var(--text-lift)',
    fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
    WebkitTapHighlightColor: 'transparent',
  };
}
function fdCopyMoveRow(checked) {
  return {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px',
    background: checked ? 'rgba(var(--accent-rgb),0.1)' : UI.bgInset,
    border: `var(--hair-width) solid ${checked ? 'var(--hair-accent)' : UI.hair}`,
    borderRadius: 6, textShadow: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  };
}
function fdCopyMoveCheck(checked) {
  return {
    flexShrink: 0, width: 18, height: 18, borderRadius: 4,
    border: `var(--hair-width) solid ${checked ? 'var(--accent)' : UI.hairStrong}`,
    background: checked ? 'var(--accent)' : 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}
const fdInputStyle = {
  background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4,
  color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, padding: '10px 12px', width: '100%',
  WebkitAppearance: 'none', boxSizing: 'border-box', textShadow: 'none',
};
const fdClearBtn = {
  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
  background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: UI.inkFaint,
  display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
};
const fdBigInput = { ...fdInputStyle, fontFamily: UI.fontNum, fontSize: 22, padding: '12px 14px' };
const fdSearchBtn = {
  width: 42, height: 42, borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
  background: UI.bgInset, color: UI.inkSoft, cursor: 'pointer', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
  textShadow: 'none',
};
const fdActionCard = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '11px 10px', borderRadius: 6, border: `var(--hair-width) solid ${UI.hairStrong}`,
  background: UI.bgInset, color: UI.inkSoft, textShadow: 'none',
  fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};
const fdScanChoice = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '22px 10px', borderRadius: 6, border: `var(--hair-width) solid ${UI.hairStrong}`,
  background: UI.bgInset, textShadow: 'none', textAlign: 'center', cursor: 'pointer',
  fontFamily: UI.fontUi, WebkitTapHighlightColor: 'transparent',
};
const fdTopAddBtn = {
  width: 34, height: 34, borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
  background: 'transparent', color: UI.inkSoft, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
};
function fdFavBtn(active, disabled) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%',
    padding: '11px 0', marginBottom: 12, borderRadius: 6,
    border: `var(--hair-width) solid ${active ? UI.gold : UI.hairStrong}`,
    background: active ? UI.bgInset : 'transparent',
    color: disabled ? UI.inkGhost : (active ? UI.ink : UI.inkSoft),
    fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, textShadow: 'none',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    WebkitTapHighlightColor: 'transparent',
  };
}
const fdDraftRow = { display: 'flex', alignItems: 'center', gap: 6 };
const fdDraftMain = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start',
  background: 'none', border: 'none', padding: '3px 0', cursor: 'pointer', textAlign: 'left',
  WebkitTapHighlightColor: 'transparent',
};
// Read-only meal-category header above a cluster of timeline hours (see
// LB.mealCategories): no border accent/interaction of its own, a plain
// neutral gray instead of an accent tint, since it's a summary, not a
// control. Layers a flat black wash OVER the same UI.bgInset the hour rows
// below it use (via a two-stop same-color gradient as the top background
// layer), not a differently-named token: UI.bg looked right in a dark
// theme but is theme-defined as LIGHTER than UI.bgInset in the light theme
// (a plain "one step darker" named surface flips direction there), so this
// darkens the exact color the rows use instead, which can't ever flip.
const fdCategoryCard = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '10px 12px', borderRadius: 6,
  background: `linear-gradient(rgba(0,0,0,0.16),rgba(0,0,0,0.16)), ${UI.bgInset}`,
  border: `var(--hair-width) solid ${UI.hairStrong}`,
  // Solid fill of its own (opaque UI.bgInset under the darkening layer, not
  // a translucent tint the page's own paper grid would still show through,
  // unlike ui.jsx's Card): the inherited grid-lift (paper theme only)
  // would otherwise put a halo behind the colored macro text sitting on it.
  textShadow: 'none',
};
// Tree connector linking a category card to its hour rows below (see the
// timeline render): FdHourTrunk is one continuous vertical line spanning the
// whole indented hours block, FdHourTick is the short horizontal branch each
// individual hour row gets, positioned via its own row's flex centering so
// it lines up regardless of that row's height (entries make some rows
// taller than others). Both plain neutral hairline color, not accent.
const FD_HOUR_GUTTER = 16;
function FdHourTrunk() {
  return <div style={{ position: 'absolute', left: 6, top: 0, bottom: 0, width: 2, background: UI.hairStrong, pointerEvents: 'none' }} />;
}
function FdHourTick() {
  return (
    <div style={{ width: FD_HOUR_GUTTER, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
      <div style={{ marginLeft: 6, width: FD_HOUR_GUTTER - 6, height: 2, background: UI.hairStrong }} />
    </div>
  );
}
// Timeline: an hour tick column, its entries, and an always-present add
// button, each hour its own bordered card (same idiom as the active-users
// list) with its content centered vertically instead of pinned to the top.
// isNow (today's current local hour) gets an accent border + tint so "now"
// is findable at a glance in a 24-card list.
function fdHourRow(filled, isNow) {
  return {
    display: 'flex', alignItems: 'center', gap: 10, borderRadius: 6,
    border: `var(--hair-width) solid ${isNow ? 'var(--hair-accent)' : UI.hairStrong}`,
    background: isNow ? 'rgba(var(--accent-rgb),0.07)' : UI.bgInset,
    padding: filled ? '10px 10px' : '8px 10px',
  };
}
const fdHourLabelCol = { width: 24, flexShrink: 0, textAlign: 'right' };
// Square icon button. `inset` fills it against a sheet's own background (the
// hairline goes soft and the paper-grid lift is dropped, same reasoning as
// fdListRow); without it the button is transparent chrome on the page. Two
// call sites used to hand-roll these exact declarations inline.
function fdIconBtn(size, inset) {
  return {
    flexShrink: 0, width: size, height: size, borderRadius: 4,
    border: `var(--hair-width) solid ${inset ? UI.hair : UI.hairStrong}`,
    background: inset ? UI.bgInset : 'transparent',
    color: inset ? UI.inkFaint : UI.inkSoft,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent', ...(inset ? { textShadow: 'none' } : null),
  };
}
function fdHourAddBtn(isNow) {
  return {
    flexShrink: 0, width: 30, height: 30, borderRadius: 4,
    border: `var(--hair-width) solid ${isNow ? 'var(--hair-accent)' : UI.hairStrong}`,
    background: 'transparent', color: isNow ? 'var(--accent)' : UI.inkSoft,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  };
}
const fdEntryName = { fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
// Plan Mode: the "Meal plans" entry-point button in the Log tab.
const fdTemplateBtn = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };
// A favorite/recipe row in the template food-source picker.
// One tappable list row: every food/favorite/recipe/search-result list in the
// module renders through this. There used to be three copies of it, identical
// apart from one missing textShadow reset and whether the row stretches
// (width) or flexes next to side buttons (fdQuickRowInner).
const fdListRow = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
  background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, textShadow: 'none',
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};
// FoodTemplateScreen's plan-detail TopBar "Edit" button (rename), same look
// as PlanViewerScreen's own Edit button in screens-schedule.jsx.
// Chrome only: the type comes from the shared .label class on the element
// itself (10px uppercase, 0.14em tracking), which this used to clone by hand
// with the tracking off by 0.02em.
const fdEditBtn = {
  background: 'transparent', border: `var(--hair-width) solid ${UI.hairStrong}`,
  borderRadius: 4, padding: '5px 12px', cursor: 'pointer', color: UI.inkSoft,
};
// The "Active" / "Client template" status box atop a plan's detail view,
// same shape as PlanViewerScreen's planActions active indicator.
function fdStatusBox(gold) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    border: `var(--hair-width) solid ${gold ? UI.goldSoft : UI.hairStrong}`, borderRadius: 4,
    background: gold ? UI.goldFaint : UI.bgInset,
    padding: '10px 14px', minHeight: 44,
  };
}
const fdEmptyHint = { fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '18px 8px', lineHeight: 1.5 };
const fdEntryMeta = { fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi };
// P/C/F in the same three colors the hero rows use (FD_MACRO_COLORS), so a
// glance at any macro mention in the Log tab reads the same way, instead of
// every digit sitting in the same flat fdEntryMeta gray. Inline, meant to
// sit at the end of an existing fdEntryMeta line (colors override the
// inherited gray; size/family still come from the parent span).
// strong bumps the weight to 700 (from the default 600): the category card
// (fdCategoryCard) layers a black wash under this to darken it below the
// hour rows, and FD_MACRO_COLORS's muted pastel tones lose enough contrast
// against that darker backdrop to read as thin again even at 600, the same
// reason that card's own label is 700 rather than the entry name's 600.
function FdMacroBits({ protein, carbs, fat, strong }) {
  const w = strong ? 700 : 600;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span className="num" style={{ fontWeight: w, color: FD_MACRO_COLORS.protein }}>P{Math.round(protein)}</span>
      <span style={{ color: UI.inkGhost }}>·</span>
      <span className="num" style={{ fontWeight: w, color: FD_MACRO_COLORS.carbs }}>C{Math.round(carbs)}</span>
      <span style={{ color: UI.inkGhost }}>·</span>
      <span className="num" style={{ fontWeight: w, color: FD_MACRO_COLORS.fat }}>F{Math.round(fat)}</span>
    </span>
  );
}
// Disclosure toggle for the sugar/saturated-fat/sodium block (migration 0204).
// Those three are captured everywhere P/C/F are, but they stay folded away by
// default: they take no part in calories, targets or adherence, and unfolding
// them into the hero would push the four numbers that do matter off the fold.
function FdExtrasToggle({ open, onToggle, style }) {
  return (
    <button className="micro" onClick={onToggle} style={{
      display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
      padding: '4px 0', marginBottom: 8, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', ...style,
    }}>
      <i className={`fa-solid fa-chevron-${open ? 'down' : 'right'}`} style={{ fontSize: 9 }} />
      More nutrients
    </button>
  );
}
// Read-only counterpart: renders only the values that are actually known. A
// null means the source never reported the value, which is NOT the same as
// zero, so it is left out instead of printed as "0g" (and the whole row
// disappears when nothing is known, e.g. for anything logged before 0204).
function FdExtrasRow({ sugar, satFat, sodiumMg, style }) {
  const cells = [
    sugar != null ? ['Sugar', `${Math.round(sugar)}g`] : null,
    satFat != null ? ['Sat. fat', `${Math.round(satFat)}g`] : null,
    sodiumMg != null ? ['Sodium', `${Math.round(sodiumMg)}mg`] : null,
  ].filter(Boolean);
  if (!cells.length) return null;
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', ...style }}>
      {cells.map(([label, value]) => (
        <span key={label} style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>
          {label} <span className="num" style={{ fontWeight: 600, color: UI.inkSoft }}>{value}</span>
        </span>
      ))}
    </div>
  );
}
// The "big total" macro row: ghost letter + whole grams, sitting under (or
// beside) a large kcal numeral. Four hand-tuned copies before this existed:
// the recipe batch hero, the save recap, the staged-picks bar and the day hero
// with no target set. They had drifted on the gram suffix (two of four printed
// bare numbers) and on rounding (two printed one-decimal values while every
// row they summarize prints whole grams). Rounds for display like the rest of
// this file, fdRound1 stays purely a storage concern.
function FdMacroGhosts({ protein, carbs, fat, size = 12, style }) {
  const cell = (letter, v) => (
    <span className="num" style={{ fontSize: size, fontWeight: 600, color: UI.inkSoft }}>
      <span style={{ color: UI.inkGhost, fontSize: 10 }}>{letter}</span> {Math.round(v || 0)}g
    </span>
  );
  return (
    <div style={{ display: 'flex', gap: 14, ...style }}>
      {cell('P', protein)}
      {cell('C', carbs)}
      {cell('F', fat)}
    </div>
  );
}
// Centered "hero" macro readout for Cooking Mode's whole-batch running
// total: a large label, calories big and gold, P/C/F below in
// FD_MACRO_COLORS, the same protein/carbs/fat colors the rest of the Log
// tab already uses (FdMacroBits), not FdMacroGhosts' neutral UI.inkSoft. A
// dedicated component rather than reusing FdMacroGhosts here: that one is
// also RecipeEditorScreen's own "Whole batch" card, and giving IT these
// colors too was not asked for, out of scope.
function FdMacroHero({ label, calories, protein, carbs, fat }) {
  return (
    <BracketFrame gold style={{ padding: 22, textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.gold, fontFamily: UI.fontUi, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
        <span className="num" style={{ fontSize: 44, fontWeight: 300, color: UI.gold, lineHeight: 1 }}>{Math.round(calories || 0)}</span>
        <span style={{ fontSize: 15, color: UI.inkFaint, fontFamily: UI.fontUi }}>kcal</span>
      </div>
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 12 }}>
        <span className="num" style={{ fontSize: 13, fontWeight: 700, color: FD_MACRO_COLORS.protein }}>P {Math.round(protein || 0)}g</span>
        <span className="num" style={{ fontSize: 13, fontWeight: 700, color: FD_MACRO_COLORS.carbs }}>C {Math.round(carbs || 0)}g</span>
        <span className="num" style={{ fontSize: 13, fontWeight: 700, color: FD_MACRO_COLORS.fat }}>F {Math.round(fat || 0)}g</span>
      </div>
    </BracketFrame>
  );
}
// The "what you're about to log" readout: kcal on the left, macros on the
// right, in an inset box. Shared by the quantity sheet, the recipe-portions
// sheet, the share preview and the template-slot editor, which carried four
// byte-identical copies of it before this existed.
// Formatted exactly like the rows the confirmed entry then produces (kcal in
// UI.warn, macros through FdMacroBits): the copies used to print macros at one
// decimal in their own grey style, so the same food read "P 20.4" while you
// confirmed it and "P20" a second later in the timeline.
function FdMacroPreview({ calories, protein, carbs, fat, sugar, satFat, sodiumMg, marginBottom = 16 }) {
  return (
    <div style={{ padding: '10px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, marginBottom, textShadow: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="num" style={{ fontSize: 15, color: UI.warn }}>{calories} kcal</span>
        <span style={{ fontSize: 12 }}><FdMacroBits protein={protein} carbs={carbs} fat={fat} strong /></span>
      </div>
      <FdExtrasRow sugar={sugar} satFat={satFat} sodiumMg={sodiumMg}
        style={{ marginTop: 8, paddingTop: 8, borderTop: `var(--hair-width) dashed ${UI.hairStrong}` }} />
    </div>
  );
}
// Thin vertical rule separating "quantity · kcal" from the macro bits, a
// deliberate element instead of another " · " so the macros read as their
// own group, not a fourth clause in the same list.
const fdMetaDivider = { display: 'inline-block', width: 1, height: 9, background: UI.hairStrong, margin: '0 6px', verticalAlign: 'middle' };
// textShadow: 'none' since UI.bgInset is a solid, opaque fill (unlike ui.jsx's
// Card, whose translucent surface-tint still shows the page's paper grid
// through it and so keeps the inherited lift): the grid-lift text-shadow
// Screen gives every descendant (paper theme only) would otherwise put a
// halo behind plain text sitting on an already-opaque background.
const fdEntryRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, textShadow: 'none' };
const fdInlineDeleteBtn = { background: 'transparent', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 6, WebkitTapHighlightColor: 'transparent' };
// A recipe entry's own card chrome (background/border/radius/padding, same
// values as fdEntryRow), but as a plain vertical stack instead of a single
// horizontal row: the header row sits on top, and when expanded the
// ingredient tree (FdIngredientTrunk/Tick, same idiom as the timeline's own
// FdHourTrunk/FdHourTick) joins it INSIDE the same card, not as a separate
// loose list underneath. fdEntryRow itself stays a plain row (used
// elsewhere for entries that never grow), this is only for the one entry
// type that does.
const fdEntryCard = { display: 'flex', flexDirection: 'column', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, padding: '10px 12px', textShadow: 'none' };
const FD_INGREDIENT_GUTTER = 14;
function FdIngredientTrunk() {
  return <div style={{ position: 'absolute', left: 4, top: 0, bottom: 0, width: 2, background: UI.hairStrong, pointerEvents: 'none' }} />;
}
function FdIngredientTick() {
  return (
    <div style={{ width: FD_INGREDIENT_GUTTER, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
      <div style={{ marginLeft: 4, width: FD_INGREDIENT_GUTTER - 4, height: 2, background: UI.hairStrong }} />
    </div>
  );
}
const fdResultRow = { ...fdListRow, width: '100%' };
const fdQuickRowWrap = { display: 'flex', alignItems: 'stretch', gap: 6 };
const fdQuickRowInner = { ...fdListRow, flex: 1, minWidth: 0 };
// Full-height action button beside a quick-add row. Radius 6 rather than the 4
// the small square icon buttons use (fdIconBtn): it stands shoulder to shoulder
// with fdQuickRowInner and has to match that row's corners, not theirs.
const fdSideBtn = {
  flexShrink: 0, width: 38, background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6,
  color: UI.inkFaint, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  display: 'flex', alignItems: 'center', justifyContent: 'center', textShadow: 'none',
};
const fdPreset = {
  padding: '8px 12px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgInset,
  color: UI.ink, textShadow: 'none', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

window.Screens = window.Screens || {};
Object.assign(window.Screens, { FoodScreen, RecipeShareSheet });
