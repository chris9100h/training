/* Food Tracker screen: search Open Food Facts + USDA FoodData Central (via the
   search-foods Edge Function), log a quantity, and roll the result into the
   same daily macro fields the manual Health-tab form already writes. Also
   supports backdating (up to 14 days, same window DailyLogScreen enforces)
   and a "Custom Item" fallback for foods not in either database.

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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fdNum = v => (v === '' || v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
const fdRound1 = v => Math.round(v * 10) / 10;
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
    recipeItems: e.recipeItems ? e.recipeItems.map(ri => ({
      ...ri, quantityG: sc(ri.quantityG), calories: sc(ri.calories),
      protein: sc1(ri.protein), carbs: sc1(ri.carbs), fat: sc1(ri.fat),
      fiber: ri.fiber != null ? sc1(ri.fiber) : null,
    })) : null,
  };
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
async function ensureFoodCached(pendingFoodOrItem) {
  if (pendingFoodOrItem?.sourceId && !pendingFoodOrItem.fromCache) {
    await LB.cacheFood(pendingFoodOrItem.source, pendingFoodOrItem.sourceId);
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
// Purely a display grouping for the Log tab's timeline: each range is
// [startHour, endHour), fixed for now (not a per-user setting). The hourly
// rows themselves (and their own "+") are unchanged, this just adds a
// read-only summary card above each cluster, no interaction of its own.
const FD_MEAL_CATEGORIES = [
  { id: 'breakfast', label: 'Breakfast', startHour: 0, endHour: 9 },
  { id: 'snack1', label: 'Snack 1', startHour: 9, endHour: 11 },
  { id: 'lunch', label: 'Lunch', startHour: 11, endHour: 13 },
  { id: 'snack2', label: 'Snack 2', startHour: 13, endHour: 16 },
  { id: 'dinner', label: 'Dinner', startHour: 16, endHour: 20 },
  { id: 'snack3', label: 'Snack 3', startHour: 20, endHour: 24 },
];

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
    fiber: slot.fiber ?? null, recipeItems: slot.recipeItems ?? null, recipeId: slot.recipeId ?? null,
    loggedTotalPortions: slot.loggedTotalPortions ?? null, planned: true, templateSlotId: slot.id,
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

// Plan Mode "did I eat this?" checkbox on a timeline entry: an empty
// accent-bordered box when planned (not eaten yet), the same box filled with a
// check once logged (eaten). Tapping toggles the entry's planned state.
function FdCheckbox({ checked, onToggle }) {
  return (
    <button
      data-reorder-ignore="true"
      onClick={onToggle}
      aria-label={checked ? 'Mark as planned' : 'Mark as eaten'}
      style={{
        width: 24, height: 24, flexShrink: 0, borderRadius: 4, padding: 0, cursor: 'pointer',
        border: `1.5px solid var(--accent)`,
        background: checked ? 'var(--accent)' : 'transparent',
        color: checked ? 'var(--accent-ink)' : 'transparent',
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
    Promise.all(toRequest.map(f => LB.cacheFood(f.source, f.foodId.slice(f.source.length + 1)).then(res => ({ foodId: f.foodId, ok: !!(res && res.ok) })))).then(results => {
      let changed = false;
      results.forEach(r => { if (r.ok) { repaired.add(r.foodId); changed = true; } });
      if (changed) { try { localStorage.setItem('logbook-food-fav-cache-repaired', JSON.stringify([...repaired])); } catch (_) {} }
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
  const labelInputRef = useRefFd(null);
  // Which AI reads the nutrition label photo: 'grok' (scan-label, the
  // long-standing default) or 'claude' (scan-label-claude), same request/
  // response contract either way. Per-device only, not a synced setting:
  // this is a comparison toggle, not a user-facing preference.
  const [labelScannerProvider, setLabelScannerProvider] = useStateFd(() => localStorage.getItem('logbook-label-scanner-provider') || 'grok');

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
  // Prompt shown before a recipe actually gets logged (see addRecipeToLog):
  // always a portions stepper (half-portion steps), even for a recipe with
  // just one portion, e.g. "1 cake" doesn't mean the only choice is the
  // whole cake. chosenPortions defaults to 1 regardless of how many the
  // recipe actually has, not "all of them": logging the whole batch by
  // default would be the more surprising default of the two.
  const [recipeLogPrompt, setRecipeLogPrompt] = useStateFd(null); // { recipe, chosenPortions } | null

  // Copy/move entries from the viewed day onto another one, at their
  // original time-of-day. copyMoveIds are foodLogs ids picked from
  // dayEntries (below); copyMoveMode decides whether the originals stay put
  // (copy) or get removed from curDate (move) once submitted.
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
  // Undo for the last APPLIED split (not the sheet draft above): the exact
  // pre-split entries plus the ids of what replaced them, captured once in
  // applySplit, so undoSplit can put this exact state back regardless of
  // what happens to the new entries afterward (no attempt to merge in a
  // later edit, undo always means "back to before the split"). Auto-clears
  // after a few seconds (splitUndoTimer); a second split before that just
  // replaces it, same as any other toast. `date` rides along separately
  // from curDate since the user may have flipped to a different day by the
  // time Undo is tapped.
  const [splitUndo, setSplitUndo] = useStateFd(null);
  const splitUndoTimer = useRefFd(null);
  useEffectFd(() => () => clearTimeout(splitUndoTimer.current), []);
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
  function openSplit(h) {
    const entries = byHour[h] || [];
    if (entries.length < 2) return;
    const qtys = {};
    entries.forEach(e => { qtys[e.id] = fdEvenSplit(splitOrigAmount(e), 2).map(v => splitDisplayStr(e, v)); });
    const nextHours = [Math.min(23, h + 4)];
    splitInitialSnap.current = JSON.stringify({ count: 2, hours: nextHours, qtys });
    setSplitHour(h);
    setSplitCount(2);
    setSplitHours(nextHours);
    setSplitQtys(qtys);
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
      while (next.length < n - 1) next.push(Math.min(23, (next[next.length - 1] ?? splitHour) + 4));
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
        toAdd.push({ ...e, ...fdScaleEntry(e, origAmt > 0 ? amt / origAmt : 0), id: LB.uid(), time: `${String(h).padStart(2, '0')}:00`, createdAt: now });
      });
      removeIds.add(e.id);
    });
    if (!toAdd.length) return;
    setStore(s => {
      const nextLogs = [...toAdd, ...(s.foodLogs || []).filter(l => !removeIds.has(l.id))];
      const dailyLogs = patchDaily(s, curDate, nextLogs.filter(l => l.date === curDate));
      return { ...s, foodLogs: nextLogs, dailyLogs };
    });
    // Undo snapshot: `entries` are the exact original objects (not
    // recomputed), so restoring them is a straight put-back, not a rebuild.
    clearTimeout(splitUndoTimer.current);
    setSplitUndo({ date: curDate, removedEntries: entries, addedIds: toAdd.map(e => e.id), count: hours.length });
    splitUndoTimer.current = setTimeout(() => setSplitUndo(null), 6000);
    setSplitHour(null);
  }
  // Reverses the last applySplit: drops exactly the entries it added and
  // restores exactly the ones it deleted. Ignores whatever curDate is now
  // (see splitUndo's own comment) and does nothing if the toast already
  // auto-cleared or a newer split replaced it.
  function undoSplit() {
    if (!splitUndo) return;
    clearTimeout(splitUndoTimer.current);
    const { date, removedEntries, addedIds } = splitUndo;
    setStore(s => {
      const nextLogs = [...removedEntries, ...(s.foodLogs || []).filter(l => !addedIds.includes(l.id))];
      const dailyLogs = patchDaily(s, date, nextLogs.filter(l => l.date === date));
      return { ...s, foodLogs: nextLogs, dailyLogs };
    });
    setSplitUndo(null);
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
  });
  const dayTotals = useMemoFd(() => sumTotals(loggedEntries), [loggedEntries]);
  // Planning aid: where the day is headed if every planned entry gets eaten
  // (logged + planned). Only shown when plan mode is on and the day actually
  // has planned entries, kept strictly separate from dayTotals above so the
  // real total is never inflated by something not yet eaten.
  const projectedTotals = useMemoFd(() => sumTotals(dayEntries), [dayEntries]);

  // The calorie target for the currently-viewed day (curDate, which can be
  // backdated), same resolution HealthScreen uses: coach macros win over
  // personal ones, and training/rest day pick different targets. null when
  // nothing is set, in which case the hero just shows a bare total, no ring.
  const macroTargets = useMemoFd(() => LB.effectiveMacroTargets(store.settings?.macroTargets, coachingMacros), [store.settings?.macroTargets, coachingMacros]);
  const dayTarget = useMemoFd(() => {
    const isTraining = LB.isTrainingDayForDate(store, curDate);
    return LB.dayTargetFromMacros(macroTargets, isTraining);
  }, [store, macroTargets, curDate]);
  const goalCalories = dayTarget?.calories ?? (dayTarget ? LB.caloriesFromMacros(dayTarget.protein, dayTarget.carbs, dayTarget.fat) : null);
  // Same weighted-macro-distance formula HealthScreen's today card uses
  // (LB.macroAdherence), computed live off dayTotals rather than reading
  // dailyLogs.adherence: that stored field only gets reconciled by an
  // effect living in HealthScreen, which isn't mounted while viewing this
  // screen, so it would show a stale number right after logging something
  // here. null (hidden) when there's no macro target to score against.
  const dayAdherence = useMemoFd(
    () => dayTarget ? LB.macroAdherence({ protein: dayTotals.protein, carbs: dayTotals.carbs, fat: dayTotals.fat }, dayTarget) : null,
    [dayTarget, dayTotals],
  );

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
  // timeline (see FD_MEAL_CATEGORIES), summed straight off byHour's buckets.
  // Category summary cards reflect the logged truth only: a planned entry
  // shows in the timeline rows below (visually distinct) but must not inflate
  // its meal category's kcal, same reason dayTotals excludes planned.
  const categoryTotals = useMemoFd(() => FD_MEAL_CATEGORIES.map(cat => {
    let calories = 0, protein = 0, carbs = 0, fat = 0;
    for (let h = cat.startHour; h < cat.endHour; h++) {
      for (const e of (byHour[h] || [])) {
        if (e.planned) continue;
        calories += e.calories || 0; protein += e.protein || 0; carbs += e.carbs || 0; fat += e.fat || 0;
      }
    }
    return { ...cat, calories: Math.round(calories), protein: fdRound1(protein), carbs: fdRound1(carbs), fat: fdRound1(fat) };
  }), [byHour]);

  // Flat drag-reorder slot list for the whole timeline, in EXACT render order
  // (category by category, hour by hour): one slot per logged entry, or one
  // placeholder slot for an hour with nothing logged (so an empty hour still
  // has an anchor to drop onto). Used only to map UI.useDragReorder's from/to
  // indices back to an actual hour; see handleTimelineReorder.
  const timelineSlots = useMemoFd(() => {
    const out = [];
    for (const cat of FD_MEAL_CATEGORIES) {
      for (let h = cat.startHour; h < cat.endHour; h++) {
        const es = byHour[h] || [];
        if (es.length) es.forEach(e => out.push({ entry: e, hour: h }));
        else out.push({ entry: null, hour: h });
      }
    }
    return out;
  }, [byHour]);

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
  // patchDaily/doAdd use in screens-water.jsx. Calories come straight from the
  // source's own energy value (summed), never derived from the macros.
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
    const log = existing
      ? { ...existing, calories, protein, carbs, fat, fiber, updatedAt: now, ...(has ? {} : { adherence: null, targetsSnap: null }) }
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
    go({ name: 'health' });
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
  const posterCategories = useMemoFd(() => {
    return categoryTotals
      .map(cat => {
        const hours = [];
        for (let h = cat.startHour; h < cat.endHour; h++) {
          const es = (byHour[h] || []).filter(e => !e.planned);
          if (es.length) hours.push({ hour: h, entries: es });
        }
        return { ...cat, hours };
      })
      .filter(cat => cat.hours.length > 0);
  }, [categoryTotals, byHour]);
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
    // source entry was logged or planned itself. Planned clones never touch the
    // target's daily log, so a future target neither warns about overwriting
    // manual macros nor gets a patchDaily (which would null them).
    const targetIsFuture = targetDate > today;
    if (!targetIsFuture) {
      const ok = await warnIfOverwritingManualMacros(targetDate);
      if (!ok) return;
    }
    setStore(s => {
      const selected = (s.foodLogs || []).filter(l => ids.includes(l.id));
      if (!selected.length) return s;
      const now = new Date().toISOString();
      const clones = selected.map(l => ({ ...l, id: LB.uid(), date: targetDate, createdAt: now, planned: targetIsFuture ? true : l.planned }));
      const remaining = mode === 'move' ? (s.foodLogs || []).filter(l => !ids.includes(l.id)) : (s.foodLogs || []);
      const nextLogs = [...clones, ...remaining];
      let dailyLogs = s.dailyLogs || [];
      if (!targetIsFuture) dailyLogs = patchDaily({ ...s, dailyLogs }, targetDate, nextLogs.filter(l => l.date === targetDate));
      if (mode === 'move') {
        dailyLogs = patchDaily({ ...s, dailyLogs }, sourceDate, nextLogs.filter(l => l.date === sourceDate));
      }
      return { ...s, foodLogs: nextLogs, dailyLogs };
    });
    setCopyMoveOpen(false);
  }

  // Sets the query text and, when it lands back at empty, resets the search
  // state along with it (so a stale results list, and the "Add manually"
  // button riding on it, don't linger for text no longer in the box). Shared
  // by the input's onChange and the field's clear ("x") button.
  function setQueryAndReset(v) {
    setQuery(v);
    if (!v.trim() && results != null) { setResults(null); setSearchError(null); }
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
    if (!res.ok) { setSearchError(res.error || 'Search failed. Try again.'); setResults([]); return; }
    setResults(res.results);
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
      ? { p, c, f, fib }
      : (label.serving_size_g > 0)
        ? (k => ({ p: p != null ? p * k : null, c: c != null ? c * k : null, f: f != null ? f * k : null, fib: fib != null ? fib * k : null }))(100 / label.serving_size_g)
        : null;

    if (per100) {
      const name = label.name || '';
      setPendingFood({
        custom: true, fromCache: true,
        name, brand: label.brand || null,
        proteinPer100g: per100.p, carbsPer100g: per100.c,
        fatPer100g: per100.f, fiberPer100g: per100.fib,
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
    return { calories, protein, carbs, fat, fiber };
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
  function closeQtySheet() { setQtySheetOpen(false); setPendingFood(null); setQtyG(''); setFavedId(null); setP100Str(''); setC100Str(''); setF100Str(''); setKcal100Str(''); setKcal100Touched(false); setQtyUnitIdx(null); setQtyCountStr(''); setEditingEntry(null); setQtyEditPlanned(false); }
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
    const dirty = customName.trim() || customG.trim() || customCal.trim() || customP.trim() || customC.trim() || customF.trim() || customFib.trim();
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
        createdAt: new Date().toISOString(),
      };
      // foodFavorites.food_id is a real FK into zane_foods, but that row is
      // normally only cached once a food gets logged (see confirmLogFood).
      // Starring a food without ever logging it would otherwise sync a
      // favorite whose food_id points at nothing, failing its FK check on
      // every retry forever. Await the cache write BEFORE writing the
      // favorite into the store, so the sync batch never races ahead of it.
      if (fav.foodId) {
        await ensureFoodCached(pendingFood);
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
    if (entry.foodId) ensureFoodCached(pendingFood).then(() => setPendingFood(f => (f ? { ...f, fromCache: true } : f)));
    closeQtySheet();
  }

  function resetCustomForm() {
    setCustomName(''); setCustomG(''); setCustomP(''); setCustomC(''); setCustomF(''); setCustomFib('');
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

  // ── Recipes ──
  function openNewRecipe() { setRecipeEditorRecipe(null); setRecipeEditorOpen(true); }
  function editRecipe(recipe) { setRecipeEditorRecipe(recipe); setRecipeEditorOpen(true); }
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
  function deleteRecipe(recipe) {
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
    setRecipeLogPrompt({ recipe, chosenPortions: 1, totalPortions: recipe.portions || 1 });
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
    const m = entry.foodName.match(/\(([\d.]+)\/([\d.]+)\)$/);
    // The total-portions-at-log-time must come from the entry itself, not the
    // live recipe (recipe.portions may have changed since logging, which
    // would silently rescale this entry's macros against the wrong base).
    // Preference: the entry's own remembered total, then the "(x/y)" suffix's
    // denominator, then recipe.portions as a last-resort fallback for entries
    // logged before this field existed.
    const totalPortions = entry.loggedTotalPortions != null ? entry.loggedTotalPortions
      : m ? parseFloat(m[2])
      : (recipe.portions || 1);
    const origChosen = m ? parseFloat(m[1]) : totalPortions;
    // Rescale from the entry's OWN frozen ingredient snapshot, not the live
    // recipe: changing the portion count of a past entry must not retroactively
    // bake in ingredient edits made to the recipe since it was logged (that
    // silently rewrote historical macros/daily totals). The stored recipeItems
    // are at origChosen scale, so rebuild a full-batch (totalPortions) item list
    // and hand THAT to the portions prompt in place of the live recipe, keeping
    // confirmRecipeLog's normal chosen/total math but sourcing it from the
    // snapshot. Legacy entries without a snapshot fall back to the live recipe.
    const snap = (entry.recipeItems && entry.recipeItems.length) ? entry.recipeItems : null;
    const promptRecipe = snap ? (() => {
      const perTotal = origChosen ? totalPortions / origChosen : 1;
      return { ...recipe, portions: totalPortions, items: snap.map(i => ({
        foodName: i.foodName,
        quantityG: (i.quantityG || 0) * perTotal,
        protein: (i.protein || 0) * perTotal,
        carbs: (i.carbs || 0) * perTotal,
        fat: (i.fat || 0) * perTotal,
        fiber: i.fiber != null ? i.fiber * perTotal : null,
      })) };
    })() : recipe;
    setEditingEntry(entry);
    setQtyEditPlanned(!!entry.planned);
    setRecipeLogPrompt({ recipe: promptRecipe, chosenPortions: origChosen, totalPortions });
  }
  // Live macro preview for the portions prompt, same scaling math
  // confirmRecipeLog itself uses (not committed until Add is actually
  // tapped), so the Stepper's live number always matches what gets logged.
  const recipeLogPreview = useMemoFd(() => {
    if (!recipeLogPrompt) return null;
    const { recipe, chosenPortions, totalPortions } = recipeLogPrompt;
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
    const { recipe, chosenPortions, totalPortions } = recipeLogPrompt;
    const items = recipe.items || [];
    const netCarbs = !!store.settings?.netCarbs;
    const scale = chosenPortions / totalPortions;
    const sum = k => items.reduce((a, i) => a + (i[k] || 0), 0);
    // Snapshot at the SAME scale as the entry's own totals, so the
    // timeline's expanded ingredient list always adds back up to exactly
    // what's shown collapsed (each row still needs its own whole-number
    // kcal, so it's individually rounded here). A later edit to the source
    // recipe must never retroactively change this: copied here, not
    // referenced.
    const recipeItems = items.map(i => ({
      foodName: i.foodName, quantityG: Math.round((i.quantityG || 0) * scale),
      calories: Math.round((LB.caloriesFromMacros(i.protein, i.carbs, i.fat, netCarbs ? i.fiber : null) || 0) * scale),
      protein: fdRound1((i.protein || 0) * scale), carbs: fdRound1((i.carbs || 0) * scale), fat: fdRound1((i.fat || 0) * scale),
      fiber: i.fiber != null ? fdRound1(i.fiber * scale) : null,
    }));
    const built = {
      foodId: null, foodName: chosenPortions !== totalPortions ? `${recipe.name} (${chosenPortions}/${totalPortions})` : recipe.name, brand: null, source: 'recipe',
      // Stable id back to the source recipe, so recipeEntryLiveRecipe can
      // resolve this entry correctly even if another recipe later gets the
      // same name (a plain name match, the old fallback, can't tell them apart).
      recipeId: recipe.id,
      // The entry's own remembered total, so a later edit of this entry
      // rescales against the total at LOG time, not against whatever
      // recipe.portions has since become (see openEditRecipeEntry).
      loggedTotalPortions: totalPortions,
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
    }
    setRecipeLogPrompt(null);
  }

  // Shown on both add-a-food tabs (Search and Quick Add) whenever a timeline
  // hour is pending, so the target time is always visible and cancelable.
  const pendingHourBanner = pendingHour != null ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'rgba(var(--accent-rgb),0.1)', border: `1px solid rgba(var(--accent-rgb),0.3)`, borderRadius: 6 }}>
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
    <div className="intensity-glow" style={{ flexShrink: 0, position: 'relative', zIndex: 1, borderTop: `1px solid rgba(var(--accent-rgb),0.35)`, background: 'rgba(var(--bg-rgb),0.96)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
      {pickedExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 168, overflowY: 'auto', padding: '8px 14px 0' }}>
          {staged.map(e => (
            <div key={e.id} style={fdDraftRow}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ ...fdEntryName, fontSize: 12 }}>{e.foodName}</span>
                <span style={fdEntryMeta}>
                  {e.time} · {e.quantityG ? `${e.quantityG}g · ` : ''}<span className="num" style={{ color: UI.warn }}>{e.calories} kcal</span>
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
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 10, marginLeft: 'auto', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <span className="num" style={{ color: UI.warn, fontWeight: 600 }}>{stagedTotals.calories} kcal</span>
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
      {confirmEl}
      <TopBar title="Food" sub={dayLabel} onBack={requestLeaveFood}
        right={
          tab === 'quickadd' && quickTab === 'recipes' && (store.foodRecipes || []).length > 0 ? (
            <button onClick={openNewRecipe} aria-label="New recipe" style={fdTopAddBtn}>
              <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
            </button>
          ) : tab === 'log' && dayEntries.length > 0 ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={takeScreenshot} disabled={capturing} aria-label="Share food log as image" style={{ ...fdTopAddBtn, cursor: capturing ? 'default' : 'pointer', color: capturing ? UI.inkGhost : UI.inkSoft }}>
                {capturing ? <span style={{ fontFamily: UI.fontUi, fontSize: 10 }}>…</span> : <i className="fa-solid fa-camera" style={{ fontSize: 13 }} />}
              </button>
              <button onClick={openCopyMove} aria-label="Copy or move entries" style={fdTopAddBtn}>
                <i className="fa-solid fa-clone" style={{ fontSize: 13 }} />
              </button>
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
            <div style={{ height: '0.5px', background: UI.gold, marginBottom: 16 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="display" style={{ fontSize: 24, color: UI.gold, lineHeight: 1.1 }}>Food Log</div>
                <div className="micro" style={{ color: UI.inkFaint, marginTop: 4 }}>{dayLabel}</div>
              </div>
              <div className="micro-gold" style={{ letterSpacing: '0.18em', marginTop: 2, flexShrink: 0, marginLeft: 12 }}>ZANE</div>
            </div>

            <BracketFrame gold style={{ padding: 20, marginTop: 16 }}>
              <FdHeroContent dayTarget={dayTarget} dayAdherence={dayAdherence} dayTotals={dayTotals} goalCalories={goalCalories} />
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
                            <div key={e.id} style={{ ...fdEntryCard, background: 'var(--surface-tint-md)', textShadow: 'var(--text-lift)' }}>
                              <span style={fdEntryName}>{e.foodName}</span>
                              <span style={fdEntryMeta}>
                                {e.quantityG ? `${e.quantityG}g · ` : ''}<span className="num" style={{ color: UI.warn }}>{e.calories} kcal</span>
                                <span style={fdMetaDivider} />
                                <FdMacroBits protein={e.protein} carbs={e.carbs} fat={e.fat} />
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
                  <button aria-label="Jump to date" style={{
                    width: '100%', height: '100%', borderRadius: 4, border: `1px solid ${UI.hairStrong}`,
                    background: 'transparent', color: UI.inkSoft, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    WebkitTapHighlightColor: 'transparent',
                  }}>
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
                projected={planMode && plannedEntries.length ? projectedTotals : null} />
            </BracketFrame>

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
                read-only per-meal summary card (FD_MEAL_CATEGORIES). Adding
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
                {categoryTotals.map(cat => (
                  <div key={cat.id}>
                    <div style={fdCategoryCard}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi }}>{cat.label}</div>
                        <span style={fdEntryMeta}>{String(cat.startHour).padStart(2, '0')}:00 - {String(cat.endHour % 24).padStart(2, '0')}:00</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="num" style={{ fontSize: 14, color: UI.warn }}>{cat.calories} kcal</div>
                        <span style={fdEntryMeta}><FdMacroBits protein={cat.protein} carbs={cat.carbs} fat={cat.fat} strong /></span>
                      </div>
                    </div>
                    <div style={{ position: 'relative', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <FdHourTrunk />
                      {Array.from({ length: cat.endHour - cat.startHour }, (_, i) => cat.startHour + i).map(h => {
                        const es = byHour[h] || [];
                        const filled = es.length > 0;
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
                                            {e.quantityG ? `${e.quantityG}g · ` : ''}<span className="num" style={{ color: UI.warn }}>{e.calories} kcal</span>
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
                                          {e.recipeItems.map((ri, i) => (
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
                                }) : <div data-reorder-item="true" data-reorder-ignore="true" style={{ flex: 1 }} />}
                              </div>
                              <div data-reorder-ignore="true" style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                                <button onClick={() => addAtHour(h)} aria-label={`Add food at ${String(h).padStart(2, '0')}:00`} style={fdHourAddBtn(isNow)}>
                                  <i className="fa-solid fa-plus" style={{ fontSize: 11 }} />
                                </button>
                                {/* Only once this hour stacks more than one item: a
                                    meal-prep batch logged/planned all at one hour but
                                    really eaten at different times. Splits it across
                                    hours without retyping every item's amount. */}
                                {es.length > 1 && (
                                  <button onClick={() => openSplit(h)} aria-label={`Split ${String(h).padStart(2, '0')}:00 into multiple meals`} style={fdHourAddBtn(isNow)}>
                                    <i className="fa-solid fa-arrows-split-up-and-left" style={{ fontSize: 11 }} />
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
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, marginBottom: 10 }}>
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
              {labelError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginTop: 8, lineHeight: 1.4 }}>{labelError}</div>}
            </div>

            {searchError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi }}>{searchError}</div>}

            {/* Only offered once a search has actually come up short (or the
                user wants to add something regardless): before searching, there
                is no way to know it isn't in the database yet. */}
            {results != null && (
              <div>
                <Bezel style={{ marginBottom: 10 }}>Results{results.length ? ` (${results.length})` : ''}</Bezel>
                {results.length === 0 ? (
                  <div style={fdEmptyStyle}>No matches. Try a different search.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {results.map(r => (
                      <button key={`${r.source}:${r.sourceId}`} onClick={() => pickResult(r)} style={fdResultRow}>
                        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            {r.cached && <i className="fa-solid fa-circle-check" style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }} title="Already added by a user before" />}
                            <div style={{ ...fdEntryName, minWidth: 0 }}>{r.name}</div>
                          </div>
                          {r.brand && <div style={fdEntryMeta}>{r.brand}</div>}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{r.kcalPer100g != null ? Math.round(r.kcalPer100g) : 'n/a'} kcal</div>
                          <div style={fdEntryMeta}>/100g · {r.source === 'off' ? 'Open Food Facts' : 'USDA'}{r.cached ? ' · cached' : ''}</div>
                        </div>
                      </button>
                    ))}
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
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}` }}>
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
                <div style={fdEmptyStyle}>Nothing logged yet. Foods you add show up here.</div>
              ) : recentFoods.length === 0 ? (
                <div style={fdEmptyStyle}>No matches for "{quickQuery}".</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recentFoods.map(l => (
                    <button key={l.id} onClick={() => reAddFromRecent(l)} style={fdResultRow}>
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <div style={fdEntryName}>{l.foodName}</div>
                        {l.brand && <div style={fdEntryMeta}>{l.brand}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{l.calories} kcal</div>
                        <div style={fdEntryMeta}>{l.quantityG}g</div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}

            {quickTab === 'favorites' && (
              (store.foodFavorites || []).length === 0 ? (
                <div style={fdEmptyStyle}>No favorites yet. Star a food while adding it to save it here.</div>
              ) : favoritesFiltered.length === 0 ? (
                <div style={fdEmptyStyle}>No favorites match "{quickQuery}".</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {favoritesFiltered.map(f => (
                    <div key={f.id} style={fdQuickRowWrap}>
                      <button onClick={() => reAddFromRecent(f)} style={fdQuickRowInner}>
                        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          <div style={fdEntryName}>{f.foodName}</div>
                          {f.brand && <div style={fdEntryMeta}>{f.brand}</div>}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{f.calories} kcal</div>
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
                  <div style={fdEmptyStyle}>No recipes yet. Build one from a few ingredients you log together often.</div>
                  <Btn onClick={openNewRecipe} style={{ width: '100%' }}>
                    <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> New recipe
                  </Btn>
                </div>
              ) : recipesFiltered.length === 0 ? (
                <div style={fdEmptyStyle}>No recipes match "{quickQuery}".</div>
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
                              <div style={fdEntryMeta}>{items.length} ingredient{items.length === 1 ? '' : 's'} · P{Math.round(items.reduce((a, i) => a + (i.protein || 0), 0))} C{Math.round(items.reduce((a, i) => a + (i.carbs || 0), 0))} F{Math.round(items.reduce((a, i) => a + (i.fat || 0), 0))}</div>
                            </div>
                            <div className="num" style={{ fontSize: 12, color: UI.inkSoft, flexShrink: 0 }}>{kcal} kcal</div>
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
      <Sheet open={qtySheetOpen} onClose={closeQtySheet} title={pendingFood?.name || 'Add food'} titleColor="var(--accent)">
        {pendingFood && (
          <>
            {pendingFood.brand && <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 14 }}>{pendingFood.brand}</div>}
            {pendingFood.custom && (
              <>
                <Field label="Name" style={{ marginBottom: 14 }}>
                  <TextInput value={pendingFood.name || ''} onChange={(v) => setPendingFood(pf => pf ? { ...pf, name: v } : pf)} placeholder="e.g. Protein bar" />
                </Field>
                <Bezel style={{ marginBottom: 6 }}>Per 100 g</Bezel>
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
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, marginBottom: 10, flexWrap: 'wrap' }}>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, marginBottom: 16, textShadow: 'none' }}>
                <span className="num" style={{ fontSize: 15, color: UI.ink }}>{qtyPreview.calories} kcal</span>
                <span style={{ display: 'flex', gap: 10 }}>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>P {qtyPreview.protein}</span>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>C {qtyPreview.carbs}</span>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>F {qtyPreview.fat}</span>
                </span>
              </div>
            )}
            <button onClick={() => toggleFavorite(buildQtyEntry())} disabled={!qtyPreview || qtyNameMissing} style={fdFavBtn(!!favedId, !qtyPreview || qtyNameMissing)}>
              <i className={`fa-${favedId ? 'solid' : 'regular'} fa-star`} style={{ fontSize: 14, color: favedId ? UI.gold : UI.inkSoft }} />
              {favedId ? 'Saved to favorites' : 'Save as favorite'}
            </button>
            {planMode && editingEntry && !curDateIsFuture && (
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, marginBottom: 8 }}>
                {[[false, 'Logged'], [true, 'Planned']].map(([val, label]) => (
                  <button key={label} onClick={() => setQtyEditPlanned(val)} style={fdSegBtn(qtyEditPlanned === val)}>{label}</button>
                ))}
              </div>
            )}
            {planMode && !editingEntry ? (
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
        <Field label="Fiber (g, optional)" style={{ marginBottom: 16 }}>
          <input value={customFib} onChange={e => setCustomFib(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
        </Field>
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

      {/* ── Copy/move entries from the viewed day onto another one ── */}
      <Sheet open={copyMoveOpen} onClose={() => setCopyMoveOpen(false)} title="Copy or move entries" titleColor="var(--accent)">
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: 1.4 }}>
          Pick entries below, they land on the new day at the same time.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, maxHeight: 260, overflowY: 'auto' }}>
          {dayEntries.map(e => {
            const checked = copyMoveIds.includes(e.id);
            return (
              <button key={e.id} onClick={() => toggleCopyMoveId(e.id)} style={fdCopyMoveRow(checked)}>
                <div style={fdCopyMoveCheck(checked)}>
                  {checked && <i className="fa-solid fa-check" style={{ fontSize: 10, color: 'var(--accent-ink)' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={fdEntryName}>{e.foodName}</div>
                  <span style={fdEntryMeta}>{e.time} · {e.calories} kcal</span>
                </div>
              </button>
            );
          })}
        </div>
        <Field label="To" style={{ marginBottom: 14 }}>
          <input type="date" value={copyMoveTarget} onChange={e => setCopyMoveTarget(e.target.value)}
            style={{ ...fdInputStyle, colorScheme: ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark') ? 'light' : 'dark' }} />
        </Field>
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, marginBottom: 16 }}>
          <button onClick={() => setCopyMoveMode('copy')} style={fdSegBtn(copyMoveMode === 'copy')}>Copy</button>
          <button onClick={() => setCopyMoveMode('move')} style={fdSegBtn(copyMoveMode === 'move')}>Move</button>
        </div>
        <Btn onClick={submitCopyMove} disabled={!copyMoveIds.length || !copyMoveTarget || copyMoveTarget === curDate} style={{ width: '100%' }}>
          {copyMoveMode === 'move' ? 'Move' : 'Copy'}{copyMoveIds.length ? ` ${copyMoveIds.length}` : ''} {copyMoveIds.length === 1 ? 'entry' : 'entries'}
        </Btn>
      </Sheet>

      {/* ── Split a stacked hour (a meal-prep batch) across multiple meal
          times: how many meals, at what hours, and how much of each item
          goes to each one. Deletes the original entries and replaces them
          with the redistributed set on Split. ── */}
      <Sheet open={splitHour != null} onClose={requestCloseSplit} title={`Split ${splitHour != null ? String(splitHour).padStart(2, '0') + ':00' : ''}`} titleColor="var(--accent)">
        {splitHour != null && (
          <>
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.4 }}>
              Really eaten at more than one time? Redistribute these items across meals, each amount adjustable on its own.
            </div>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8, textAlign: 'center' }}>Meals</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <Stepper value={splitCount} step={1} min={2} suffix={splitCount === 1 ? ' meal' : ' meals'} onChange={setSplitCountTo} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {[splitHour, ...splitHours].map((h, i) => (
                <div key={i} style={{ flex: '1 1 100px' }}>
                  <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4, textAlign: 'center' }}>Meal {i + 1}</div>
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
              {(byHour[splitHour] || []).map(e => {
                const unit = splitEntryUnit(e);
                return (
                  <div key={e.id}>
                    <div style={fdEntryName}>
                      {e.foodName}
                      {unit && <span style={{ ...fdEntryMeta, marginLeft: 6 }}>&middot; in {unit.label}</span>}
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
      </Sheet>

      {/* ── Units for a favorite (e.g. "1 Pc = 62g", "1 Pack = 500g") ── */}
      <Sheet open={!!editFavId} onClose={requestCloseEditFavorite} title="Units" titleColor="var(--accent)">
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 14, lineHeight: 1.4 }}>
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
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>Label reader (nutrition label only)</div>
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}` }}>
            {[['grok', 'Grok'], ['claude', 'Claude']].map(([id, label]) => (
              <button key={id} onClick={() => { setLabelScannerProvider(id); localStorage.setItem('logbook-label-scanner-provider', id); }} style={fdSegBtn(labelScannerProvider === id)}>{label}</button>
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
          can go above the recipe's own portion count too. ── */}
      <Sheet open={!!recipeLogPrompt} onClose={() => { setRecipeLogPrompt(null); setEditingEntry(null); }} title={recipeLogPrompt?.recipe?.name || 'Add recipe'} titleColor="var(--accent)"
        titleRight={recipeLogPrompt && (
          <button onClick={() => openShareRecipe(recipeLogPrompt.recipe)} aria-label="Share recipe" style={{
            width: 30, height: 30, background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 4,
            color: UI.inkFaint, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', textShadow: 'none',
          }}>
            <i className="fa-solid fa-share-from-square" style={{ fontSize: 12 }} />
          </button>
        )}
      >
        {recipeLogPrompt && (
          <>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.4 }}>
              How much of {recipeLogPrompt.recipe.name}, at {entryTime()}?
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <Stepper value={recipeLogPrompt.chosenPortions} step={0.5} min={0.5}
                suffix={recipeLogPrompt.chosenPortions === 1 ? ' portion' : ' portions'}
                onChange={v => setRecipeLogPrompt(p => p ? { ...p, chosenPortions: Math.max(0.5, Math.round(v * 2) / 2) } : p)} big />
            </div>
            {recipeLogPreview && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, marginBottom: 16, textShadow: 'none' }}>
                <span className="num" style={{ fontSize: 15, color: UI.ink }}>{recipeLogPreview.calories} kcal</span>
                <span style={{ display: 'flex', gap: 10 }}>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>P {recipeLogPreview.protein}</span>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>C {recipeLogPreview.carbs}</span>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>F {recipeLogPreview.fat}</span>
                </span>
              </div>
            )}
            {editingEntry && planMode && !curDateIsFuture && (
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, marginBottom: 8 }}>
                {[[false, 'Logged'], [true, 'Planned']].map(([val, label]) => (
                  <button key={label} onClick={() => setQtyEditPlanned(val)} style={fdSegBtn(qtyEditPlanned === val)}>{label}</button>
                ))}
              </div>
            )}
            {editingEntry ? (
              <Btn onClick={() => confirmRecipeLog(false)} style={{ width: '100%' }}>
                Save · {recipeLogPrompt.chosenPortions} portion{recipeLogPrompt.chosenPortions === 1 ? '' : 's'}
              </Btn>
            ) : planMode ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn kind={curDateIsFuture ? undefined : 'ghost'} onClick={() => confirmRecipeLog(true)} style={{ flex: 1 }}>Plan it</Btn>
                {!curDateIsFuture && <Btn onClick={() => confirmRecipeLog(false)} style={{ flex: 1 }}>Log it</Btn>}
              </div>
            ) : (
              <Btn onClick={() => confirmRecipeLog(false)} style={{ width: '100%' }}>
                Add {recipeLogPrompt.recipe.name} · {recipeLogPrompt.chosenPortions} portion{recipeLogPrompt.chosenPortions === 1 ? '' : 's'}
              </Btn>
            )}
          </>
        )}
      </Sheet>

      {/* ── Recipe share-link sheet (sender side, see openShareRecipe) ── */}
      <Sheet open={!!shareSheet} onClose={() => setShareSheet(null)} title={shareSheet ? `Share ${shareSheet.recipe.name}` : 'Share recipe'} titleColor="var(--accent)" zIndex={200}>
        {shareSheet?.status === 'busy' && (
          <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, padding: '8px 0 16px' }}>Creating the share link…</div>
        )}
        {shareSheet?.status === 'error' && (
          <>
            <div style={{ fontSize: 12, color: UI.danger, fontFamily: UI.fontUi, marginBottom: 14, lineHeight: 1.4 }}>{shareSheet.error}</div>
            <Btn onClick={() => openShareRecipe(shareSheet.recipe)} style={{ width: '100%' }}>Try again</Btn>
          </>
        )}
        {shareSheet?.status === 'ready' && (
          <>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 14, lineHeight: 1.4 }}>
              Anyone with this link can open the recipe in Zane and add a copy to their own recipes. The link carries a snapshot: edits you make later are not sent along.
            </div>
            <div className="num" style={{ fontSize: 11, color: UI.inkFaint, padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, wordBreak: 'break-all', userSelect: 'all', WebkitUserSelect: 'all', marginBottom: 14, textShadow: 'none' }}>
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

      <FoodTemplateScreen open={templateOpen} onClose={() => setTemplateOpen(false)} store={store} setStore={setStore} userId={userId} />

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
                  <i className="fa-solid fa-pen" style={{ marginRight: 8 }} /> Edit portions
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
    {/* Transient toast for the last applied split (see splitUndo/undoSplit),
        rendered the same "fixed footer sibling of Screen" way as
        stagedPanel below so it never overlaps TabBar either. Sits above
        stagedPanel: it's the momentary one of the two, stagedPanel is the
        one meant to persist until dealt with. */}
    {splitUndo && (
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: `1px solid ${UI.hairStrong}`, background: 'rgba(var(--bg-rgb),0.96)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
        <i className="fa-solid fa-arrows-split-up-and-left" style={{ fontSize: 12, color: UI.inkFaint, flexShrink: 0 }} />
        <span style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.inkSoft, flex: 1, minWidth: 0 }}>
          Split into {splitUndo.count} meals
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
          <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 14, lineHeight: 1.4 }}>{state.error}</div>
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
            {items.map((i, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, textShadow: 'none' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(i.foodName || 'Item')}</div>
                  <div className="num" style={{ fontSize: 10, color: UI.inkFaint }}>{Math.round(Number(i.quantityG) || 0)} g</div>
                </div>
                <span className="num" style={{ fontSize: 11, color: UI.inkSoft, flexShrink: 0 }}>{Math.round(LB.caloriesFromMacros(i.protein, i.carbs, i.fat) || 0)} kcal</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, marginBottom: 16, textShadow: 'none' }}>
            <span className="num" style={{ fontSize: 15, color: UI.ink }}>{totals.calories} kcal</span>
            <span style={{ display: 'flex', gap: 10 }}>
              <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>P {totals.protein}</span>
              <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>C {totals.carbs}</span>
              <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>F {totals.fat}</span>
            </span>
          </div>
          {added ? (
            <>
              <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: 1.4 }}>
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
    const d = { id: null, kind: 'recipe', recipeId: recipe.id, name: recipe.name, recipe, portions: 1, hour: 8, dayType: 'any' };
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
    if (!await confirm(`${slot.foodName}`, { title: 'Remove from template?', ok: 'Remove', cancel: 'Cancel', danger: true })) return;
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
      await confirm('Your active plan’s meals are already in today’s plan.', { title: 'Nothing to add', ok: 'OK', cancel: null });
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
        recipeItems: null, recipeId: null, loggedTotalPortions: null,
      };
    }
    if (draft.recipe) {
      const recipe = draft.recipe;
      const items = recipe.items || [];
      const totalPortions = recipe.portions || 1;
      const scale = draft.portions / totalPortions;
      const sum = k => items.reduce((a, i) => a + (i[k] || 0), 0);
      const recipeItems = items.map(i => ({
        foodName: i.foodName, quantityG: Math.round((i.quantityG || 0) * scale),
        calories: Math.round((LB.caloriesFromMacros(i.protein, i.carbs, i.fat, netCarbs ? i.fiber : null) || 0) * scale),
        protein: fdRound1((i.protein || 0) * scale), carbs: fdRound1((i.carbs || 0) * scale),
        fat: fdRound1((i.fat || 0) * scale), fiber: i.fiber != null ? fdRound1(i.fiber * scale) : null,
      }));
      return {
        foodId: null, foodName: draft.portions !== totalPortions ? `${recipe.name} (${draft.portions}/${totalPortions})` : recipe.name,
        brand: null, source: 'recipe', quantityG: Math.round(sum('quantityG') * scale),
        calories: Math.round(fdRecipeItemsCalories(items, netCarbs) * scale), protein: fdRound1(sum('protein') * scale),
        carbs: fdRound1(sum('carbs') * scale), fat: fdRound1(sum('fat') * scale),
        fiber: items.some(i => i.fiber != null) ? fdRound1(sum('fiber') * scale) : null,
        recipeItems, recipeId: recipe.id, loggedTotalPortions: totalPortions,
      };
    }
    // recipe edit: no macro recompute, reuse the existing slot's food fields.
    return { ...draft.slot };
  }, [draft, netCarbs]);

  function saveDraft() {
    if (!draft || !draftBuilt) return;
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
      <TopBar title={viewedPlan ? viewedPlan.name : 'Meal Plans'}
        onBack={viewedPlan ? () => setViewedPlanId(null) : onClose}
        right={viewedPlan ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setPickerQuery(''); setPickerOpen(true); }} aria-label="Add meal" style={fdTopAddBtn}>
              <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
            </button>
            <button onClick={() => setNameDraft({ id: viewedPlan.id, name: viewedPlan.name, initialName: viewedPlan.name })} style={fdEditBtn}>Edit</button>
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
            <div style={fdEmptyHint}>No meal plan yet. Create one (e.g. “Cut” or “Bulk”) to start planning your recurring meals.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plans.filter(p => p.id === activeId).map(p => {
                const n = slotCountFor(p.id);
                return (
                  <BracketFrame key={p.id} gold onClick={() => setViewedPlanId(p.id)} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                      <div className="display" style={{ fontSize: 22, color: UI.gold, lineHeight: 1.1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <Pill gold>active</Pill>
                    </div>
                    <div className="micro" style={{ color: UI.inkFaint, marginBottom: n > 0 ? 10 : 0 }}>{n} meal{n === 1 ? '' : 's'}</div>
                    {n > 0 && (
                      <Btn kind="ghost" onClick={e => { e.stopPropagation(); applyToToday(); }} style={{ width: '100%', marginTop: 4 }}>
                        <i className="fa-regular fa-calendar-plus" style={{ marginRight: 8 }} /> Apply to today’s plan
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
                    <div className="micro" style={{ color: UI.inkFaint }}>{n} meal{n === 1 ? '' : 's'}</div>
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
              <Btn onClick={() => { setPickerQuery(''); setPickerOpen(true); }} style={{ width: '100%' }}>
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
                          <span style={fdDayTypeChip(slot.dayType)}>{slot.dayType === 'training' ? 'TRAIN' : slot.dayType === 'rest' ? 'REST' : 'DAILY'}</span>
                          {slot.foodName}
                        </span>
                        <span style={fdEntryMeta}>
                          {slot.quantityG ? `${slot.quantityG}g · ` : ''}<span className="num" style={{ color: UI.warn }}>{slot.calories} kcal</span>
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

      {/* Food source picker: the user's Favorites and Recipes */}
      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add to template" titleColor="var(--accent)">
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, marginBottom: 10 }}>
          {[['favorites', 'Favorites'], ['recipes', 'Recipes']].map(([id, label]) => (
            <button key={id} onClick={() => setPickerTab(id)} style={fdSegBtn(pickerTab === id)}>{label}</button>
          ))}
        </div>
        <input value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} type="text" placeholder="Filter…" style={{ ...fdInputStyle, marginBottom: 10 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '46vh', overflowY: 'auto' }}>
          {pickerTab === 'favorites' ? (
            favs.length === 0 ? <div style={fdEmptyHint}>No favorites yet. Star a food to reuse it here.</div>
            : favs.map(f => (
              <button key={f.id} onClick={() => openAddFood(f)} style={fdPickRow}>
                <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <div style={fdEntryName}>{f.foodName}</div>
                  <div style={fdEntryMeta}>{f.quantityG}g · <span className="num" style={{ color: UI.warn }}>{f.calories} kcal</span></div>
                </div>
                <i className="fa-solid fa-plus" style={{ fontSize: 12, color: 'var(--accent)' }} />
              </button>
            ))
          ) : (
            recipes.length === 0 ? <div style={fdEmptyHint}>No recipes yet.</div>
            : recipes.map(r => (
              <button key={r.id} onClick={() => openAddRecipe(r)} style={fdPickRow}>
                <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <div style={fdEntryName}>{r.name}</div>
                  <div style={fdEntryMeta}>{r.portions} portion{r.portions === 1 ? '' : 's'}</div>
                </div>
                <i className="fa-solid fa-plus" style={{ fontSize: 12, color: 'var(--accent)' }} />
              </button>
            ))
          )}
        </div>
      </Sheet>

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
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8, textAlign: 'center' }}>Portions</div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <Stepper value={draft.portions} step={0.5} min={0.5} suffix={draft.portions === 1 ? ' portion' : ' portions'}
                    onChange={v => setDraft(d => ({ ...d, portions: Math.max(0.5, Math.round(v * 2) / 2) }))} big />
                </div>
              </div>
            ) : null}
            {draftBuilt && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, marginBottom: 14, textShadow: 'none' }}>
                <span className="num" style={{ fontSize: 15, color: UI.ink }}>{draftBuilt.calories} kcal</span>
                <span style={{ display: 'flex', gap: 10 }}>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>P {draftBuilt.protein}</span>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>C {draftBuilt.carbs}</span>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>F {draftBuilt.fat}</span>
                </span>
              </div>
            )}
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>Time</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <Stepper value={draft.hour} step={1} min={0} max={23} suffix=":00"
                onChange={v => setDraft(d => ({ ...d, hour: Math.max(0, Math.min(23, Math.round(v))) }))} big />
            </div>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>Day type</div>
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, marginBottom: draft.dayType !== 'any' && activeFlexPlan ? 10 : 16 }}>
              {[['any', 'Every day'], ['training', 'Training'], ['rest', 'Rest']].map(([id, label]) => (
                <button key={id} onClick={() => setDraft(d => ({ ...d, dayType: id }))} style={fdSegBtn(draft.dayType === id)}>{label}</button>
              ))}
            </div>
            {draft.dayType !== 'any' && activeFlexPlan && (
              <div style={{ marginBottom: 16, padding: '8px 10px', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset }}>
                <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.4 }}>
                  <i className="fa-solid fa-circle-info" style={{ marginRight: 5, color: UI.inkFaint }} />
                  Your active plan is flexible, so there's no fixed schedule to check ahead of time. A day only counts as Training once you've actually trained or set it manually in the Health tab, until then it's assumed to be Rest.
                </span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => setDraft(null)} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={saveDraft} disabled={!draftBuilt} style={{ flex: 2 }}>{draft.id ? 'Save' : 'Add to template'}</Btn>
            </div>
          </>
        )}
      </Sheet>

      {/* Manage: duplicate / export / delete */}
      <Sheet open={manageOpen} onClose={() => setManageOpen(false)} title="Manage Plan" titleColor="var(--accent)">
        {viewedPlan && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Btn onClick={() => duplicatePlan(viewedPlan)} style={{ width: '100%' }}>
              <i className="fa-solid fa-copy" style={{ marginRight: 8 }} /> Duplicate
            </Btn>
            <Btn kind="ghost" onClick={() => exportPlan(viewedPlan)} style={{ width: '100%' }}>
              <i className="fa-solid fa-file-export" style={{ marginRight: 8 }} /> Export (JSON)
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
              Copies “{pushPlan.name}” (and any recipes it uses) into a client’s account. You’ll pick whether it activates right away.
            </div>
            {coachClients.length === 0 ? <div style={fdEmptyHint}>No active clients.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {coachClients.map(c => (
                  <button key={c.id} onClick={() => setPushTarget(c)} style={fdPickRow}>
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
              Activate “{pushPlan.name}” for them right away, or just add it to their meal plans and talk it through first?
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
            <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.5 }}>
              “{pushDone.planName}” is in {pushDone.clientName}’s account{pushDone.activated ? ' and active now' : ', not activated yet'}.
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

function RecipeEditorScreen({ open, onClose, onSave, recipe, store }) {
  const [confirmEl, confirm] = useConfirm();
  const [name, setName] = useStateFd('');
  const [items, setItems] = useStateFd([]);
  const [portions, setPortions] = useStateFd(1);
  const [pickerOpen, setPickerOpen] = useStateFd(false);
  const [editItem, setEditItem] = useStateFd(null);
  const [editGrams, setEditGrams] = useStateFd('');
  // Snapshot of the draft as it was opened, to detect unsaved edits on close.
  const initialSnap = useRefFd(null);

  useEffectFd(() => {
    if (!open) return;
    const n = recipe?.name || '';
    const it = recipe?.items || [];
    const p = recipe?.portions || 1;
    setName(n); setItems(it); setPortions(p);
    initialSnap.current = JSON.stringify({ name: n, items: it, portions: p });
  }, [open, recipe]);

  // Batch totals, the whole recipe as cooked, independent of portions:
  // portions is purely metadata for how a batch splits up when logging it
  // later (see FoodScreen's addRecipeToLog/confirmRecipeLog), not a divisor
  // applied here.
  const totals = useMemoFd(() => ({
    calories: fdRecipeItemsCalories(items, !!store.settings?.netCarbs),
    protein: fdRound1(items.reduce((a, i) => a + (i.protein || 0), 0)),
    carbs: fdRound1(items.reduce((a, i) => a + (i.carbs || 0), 0)),
    fat: fdRound1(items.reduce((a, i) => a + (i.fat || 0), 0)),
  }), [items, store.settings?.netCarbs]);

  const isDirty = () => initialSnap.current != null && JSON.stringify({ name, items, portions }) !== initialSnap.current;
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
  function openEditItem(item) { setEditItem(item); setEditGrams(String(item.quantityG ?? '')); }
  function closeEditItem() { setEditItem(null); setEditGrams(''); }
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
    onSave({ name: trimmed, items, portions });
  }
  const canSave = !!(name.trim() && items.length);

  if (!open) return null;
  return (
    <Screen style={{ position: 'fixed', inset: 0, zIndex: 100, animation: 'sheet-up 0.22s ease' }}>
      <TopBar title={recipe ? 'Edit Recipe' : 'New Recipe'} onBack={requestClose}
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

        <BracketFrame gold style={{ padding: 20 }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>Whole batch</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="num" style={{ fontSize: 40, fontWeight: 300, color: UI.ink, lineHeight: 1 }}>{totals.calories}</span>
            <span style={{ fontSize: 15, color: UI.inkFaint, fontFamily: UI.fontUi }}>kcal</span>
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
            <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>P</span> {totals.protein}g</span>
            <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>C</span> {totals.carbs}g</span>
            <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>F</span> {totals.fat}g</span>
          </div>
        </BracketFrame>

        <div>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10, textAlign: 'center' }}>Portions</div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Stepper value={portions} step={1} min={1} onChange={v => setPortions(Math.max(1, Math.round(v)))} big />
          </div>
        </div>

        <div>
          <Bezel style={{ marginBottom: 10 }}>Ingredients</Bezel>
          {items.length === 0 ? (
            <Btn onClick={() => setPickerOpen(true)} style={{ width: '100%' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> Add ingredients
            </Btn>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map(i => (
                <div key={i.id} style={fdEntryRow}>
                  <button onClick={() => openEditItem(i)} style={fdDraftMain}>
                    <span style={{ ...fdEntryName, fontSize: 12 }}>{i.foodName}</span>
                    <span style={fdEntryMeta}>{i.quantityG}g · {Math.round(LB.caloriesFromMacros(i.protein, i.carbs, i.fat) || 0)} kcal · <span style={{ fontWeight: 600 }}>P{Math.round(i.protein)} C{Math.round(i.carbs)} F{Math.round(i.fat)}</span></span>
                  </button>
                  <button onClick={() => removeItem(i.id)} aria-label="Remove" style={fdInlineDeleteBtn}>
                    <i className="fa-solid fa-trash" style={{ fontSize: 11 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Edit an already-added ingredient's amount, rescaling its macros
          proportionally ── */}
      <Sheet open={!!editItem} onClose={closeEditItem} title={editItem?.foodName || 'Ingredient'} titleColor="var(--accent)">
        <Field label="Amount (g)" style={{ marginBottom: 16 }}>
          <input value={editGrams} onChange={e => setEditGrams(fdDecimalFilter(e.target.value))} type="text" inputMode="decimal" placeholder="g" style={fdInputStyle} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={removeEditItem} aria-label="Remove ingredient" style={{ ...fdSideBtn, width: 44, flexShrink: 0 }}>
            <i className="fa-solid fa-trash" style={{ fontSize: 13 }} />
          </button>
          <Btn kind="ghost" onClick={closeEditItem} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={saveEditItem} disabled={!(fdNum(editGrams) > 0)} style={{ flex: 2 }}>Save</Btn>
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
        <span className="num" style={{ fontSize: 16, color: UI.ink }}>{totals.calories}<span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 3 }}>kcal</span></span>
        <span className="num" style={{ fontSize: 13, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>P</span> {totals.protein}</span>
        <span className="num" style={{ fontSize: 13, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>C</span> {totals.carbs}</span>
        <span className="num" style={{ fontSize: 13, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>F</span> {totals.fat}</span>
      </div>
    </div>
  );
}

const FD_PICKER_TABS = [
  { id: 'search', label: 'Search' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'recent', label: 'Recent' },
];

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

  useEffectFd(() => {
    if (!open) return;
    setPickTab('search'); setQuery(''); setResults(null); setSearchError(null);
    setManualOpen(false);
    setMName(''); setMG(''); setMP(''); setMC(''); setMF(''); setMFib(''); setMCal(''); setMCalTouched(false);
    setStaged([]);
    setQtyItem(null); setQtyG(''); setQtyUnitIdx(null); setQtyCountStr('');
  }, [open]);

  async function runPickerSearch() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true); setSearchError(null);
    const res = await LB.searchFoods(q, null);
    setSearching(false);
    if (!res.ok) { setSearchError(res.error || 'Search failed. Try again.'); setResults([]); return; }
    setResults(res.results);
  }

  function closeQtySheet() { setQtyItem(null); setQtyG(''); setQtyUnitIdx(null); setQtyCountStr(''); }
  // Opens the quantity step for a search result: per-100g rates are already
  // right there in the search response, default amount is its stated
  // serving (else 100g), same defaults pickResult uses in FoodScreen.
  function openQtyForResult(r) {
    setQtyItem({
      name: r.name, brand: r.brand || null, source: r.source, sourceId: r.sourceId,
      kcalPer100g: r.kcalPer100g, proteinPer100g: r.proteinPer100g, carbsPer100g: r.carbsPer100g,
      fatPer100g: r.fatPer100g, fiberPer100g: r.fiberPer100g, fromCache: !!r.cached, units: null,
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
    return {
      calories: Math.round(LB.caloriesFromMacros(protein, carbs, fat, netCarbs ? fiber : null) || 0),
      protein, carbs, fat, fiber,
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
    }]);
    ensureFoodCached(qtyItem);
    closeQtySheet();
  }
  function removeStaged(tempId) {
    setStaged(list => list.filter(i => i.tempId !== tempId));
  }

  const recentPicks = useMemoFd(() => {
    const seen = new Set(); const out = [];
    for (const l of (store.foodLogs || [])) {
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

  // Two sibling Sheets, not one nested in the other's children (the app's
  // documented overlay convention, docs/internals.md "Modal-/Overlay-
  // Landschaft": a Sheet that must render above another already-open Sheet
  // gets a bumped zIndex instead, tier 200 = "must sit above a specific open
  // Sheet/Screen", same tier Account-Switch/Chart-Popups already use).
  return (
    <>
      <Sheet open={open} onClose={requestClosePicker} title="Add ingredients" titleColor="var(--accent)">
        {confirmEl}
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, marginBottom: 12 }}>
          {FD_PICKER_TABS.map(t => (
            <button key={t.id} onClick={() => setPickTab(t.id)} style={fdSegBtn(pickTab === t.id)}>{t.label}</button>
          ))}
        </div>

        {pickTab === 'search' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runPickerSearch(); }}
                  type="text" placeholder="Search food" style={{ ...fdInputStyle, paddingRight: 32 }} />
                {query && (
                  <button onClick={() => { setQuery(''); setResults(null); setSearchError(null); }} aria-label="Clear search" style={fdClearBtn}>
                    <i className="fa-solid fa-circle-xmark" style={{ fontSize: 15 }} />
                  </button>
                )}
              </div>
              <button onClick={runPickerSearch} disabled={searching || !query.trim()} aria-label="Search" style={fdSearchBtn}>
                {searching ? <span style={{ fontFamily: UI.fontUi, fontSize: 11 }}>…</span> : <i className="fa-solid fa-magnifying-glass" style={{ fontSize: 13 }} />}
              </button>
            </div>
            {searchError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginBottom: 10 }}>{searchError}</div>}
            {results != null && (
              results.length === 0 ? (
                <div style={fdEmptyStyle}>No matches. Try a different search.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, maxHeight: 280, overflowY: 'auto' }}>
                  {results.map(r => (
                    <button key={`${r.source}:${r.sourceId}`} onClick={() => openQtyForResult(r)} style={fdResultRow}>
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <div style={fdEntryName}>{r.name}</div>
                        {r.brand && <div style={fdEntryMeta}>{r.brand}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{r.kcalPer100g != null ? Math.round(r.kcalPer100g) : 'n/a'} kcal</div>
                        <div style={fdEntryMeta}>/100g</div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}
            {!manualOpen ? (
              <button onClick={() => setManualOpen(true)} style={{ ...fdActionCard, width: '100%' }}>
                <i className="fa-solid fa-keyboard" style={{ fontSize: 14 }} />
                <span>Add manually</span>
              </button>
            ) : (
              <div style={{ borderTop: `1px solid ${UI.hair}`, paddingTop: 14, marginTop: 4 }}>
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
            <div style={fdEmptyStyle}>No favorites yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
              {favoritesSorted.map(f => (
                <button key={f.id} onClick={() => openQtyForLog(f)} style={fdResultRow}>
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={fdEntryName}>{f.foodName}</div>
                    {f.brand && <div style={fdEntryMeta}>{f.brand}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{f.calories} kcal</div>
                    <div style={fdEntryMeta}>{f.quantityG}g</div>
                  </div>
                </button>
              ))}
            </div>
          )
        )}

        {pickTab === 'recent' && (
          recentPicks.length === 0 ? (
            <div style={fdEmptyStyle}>Nothing logged yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
              {recentPicks.map(l => (
                <button key={l.id} onClick={() => openQtyForLog(l)} style={fdResultRow}>
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={fdEntryName}>{l.foodName}</div>
                    {l.brand && <div style={fdEntryMeta}>{l.brand}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{l.calories} kcal</div>
                    <div style={fdEntryMeta}>{l.quantityG}g</div>
                  </div>
                </button>
              ))}
            </div>
          )
        )}

        {staged.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${UI.hair}` }}>
            <Bezel style={{ marginBottom: 10 }}>Picked ({staged.length})</Bezel>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10 }}>
              <span className="num" style={{ fontSize: 18, fontWeight: 300, color: UI.ink }}>{stagedTotals.calories}<span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 3 }}>kcal</span></span>
              <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>P</span> {stagedTotals.protein}</span>
              <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>C</span> {stagedTotals.carbs}</span>
              <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>F</span> {stagedTotals.fat}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 168, overflowY: 'auto' }}>
              {staged.map(i => (
                <div key={i.tempId} style={fdDraftRow}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ ...fdEntryName, fontSize: 12 }}>{i.foodName}</span>
                    <span style={fdEntryMeta}>{i.quantityG}g · {i.calories} kcal</span>
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
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, marginBottom: 10, flexWrap: 'wrap' }}>
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
                <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>P {qtyPreview.protein}</span>
                <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>C {qtyPreview.carbs}</span>
                <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}>F {qtyPreview.fat}</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={closeQtySheet} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={confirmStageItem} disabled={!qtyPreview} style={{ flex: 2 }}>Add</Btn>
            </div>
          </>
        )}
      </Sheet>
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
  if (a >= 90) return 'var(--ok)';
  if (a >= 75) return UI.warn;
  return 'var(--danger)';
}

// Adherence-progress ring for the Log-tab hero, same shape as WaterRing
// (screens-water.jsx) so both daily-total heroes read as the same idiom.
// Takes an explicit color (fdAdherenceColor's tier color, unlike the old
// fixed var(--accent) stroke) and an optional small label under the number,
// so the ring itself carries the same "PERFECT/STRONG/..." semantic tone the
// hero's rows do instead of always reading as a flat accent-colored dial.
function FdRing({ percent, size = 128, color = 'var(--accent)', label }) {
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
const FD_MACRO_COLORS = { protein: 'var(--info)', carbs: 'var(--ok)', fat: 'var(--danger)' };

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
      <div style={{ flex: 1, height: 4, borderRadius: 1, background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
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
function FdHeroContent({ dayTarget, dayAdherence, dayTotals, goalCalories, projected }) {
  const projectionLine = projected ? (
    <FdProjectionLine macros={{
      protein: { delta: projected.protein - dayTotals.protein, total: projected.protein },
      carbs:   { delta: projected.carbs   - dayTotals.carbs,   total: projected.carbs },
      fat:     { delta: projected.fat     - dayTotals.fat,     total: projected.fat },
    }} />
  ) : null;
  return dayTarget ? (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <FdRing percent={dayAdherence ?? 0} size={104} color={fdAdherenceColor(dayAdherence)} label="ADHERENCE" />
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
      <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
        <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>P</span> {Math.round(dayTotals.protein)}g</span>
        <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>C</span> {Math.round(dayTotals.carbs)}g</span>
        <span className="num" style={{ fontSize: 12, fontWeight: 600, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>F</span> {Math.round(dayTotals.fat)}g</span>
      </div>
      {projectionLine}
    </div>
  );
}
// Plan Mode projection: still-to-eat macros vs. the full logged+planned
// projection, each in its own centered column. Sits under the real totals as
// a lighter, dashed-topped table so it reads as a forecast, not part of the
// logged truth above it. The old standalone "+N kcal projected" line was
// dropped as redundant once this table shipped.
function FdProjectionLine({ macros }) {
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${UI.hairStrong}`, display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      <div style={{ textAlign: 'center', paddingRight: 10, borderRight: `1px solid ${UI.hairStrong}` }}>
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
            <div style={{ color: '#fff', fontFamily: UI.fontUi, fontSize: 13, lineHeight: 1.5, maxWidth: 300 }}>
              Could not start the scanner. Check the camera permission, or type the barcode number into search (it looks it up the same way).
            </div>
            <button onClick={onClose} style={{ marginTop: 4, background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', borderRadius: 6, padding: '11px 22px', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', textShadow: 'none' }}>Got it</button>
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
    width: 32, height: 32, borderRadius: 4, border: `1px solid ${UI.hairStrong}`,
    background: 'transparent', color: disabled ? UI.inkGhost : UI.inkSoft,
    cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  };
}
function fdSegBtn(active) {
  return {
    flex: 1, padding: '7px 4px', border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent)' : 'transparent',
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
    border: `1px solid ${checked ? 'rgba(var(--accent-rgb),0.5)' : UI.hair}`,
    borderRadius: 6, textShadow: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  };
}
function fdCopyMoveCheck(checked) {
  return {
    flexShrink: 0, width: 18, height: 18, borderRadius: 4,
    border: `1px solid ${checked ? 'var(--accent)' : UI.hairStrong}`,
    background: checked ? 'var(--accent)' : 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}
const fdInputStyle = {
  background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4,
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
  width: 42, height: 42, borderRadius: 4, border: `1px solid ${UI.hairStrong}`,
  background: UI.bgInset, color: UI.inkSoft, cursor: 'pointer', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
  textShadow: 'none',
};
const fdActionCard = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '11px 10px', borderRadius: 6, border: `1px solid ${UI.hairStrong}`,
  background: UI.bgInset, color: UI.inkSoft, textShadow: 'none',
  fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};
const fdScanChoice = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '22px 10px', borderRadius: 6, border: `1px solid ${UI.hairStrong}`,
  background: UI.bgInset, textShadow: 'none', textAlign: 'center', cursor: 'pointer',
  fontFamily: UI.fontUi, WebkitTapHighlightColor: 'transparent',
};
const fdTopAddBtn = {
  width: 34, height: 34, borderRadius: 4, border: `1px solid ${UI.hairStrong}`,
  background: 'transparent', color: UI.inkSoft, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
};
function fdFavBtn(active, disabled) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%',
    padding: '11px 0', marginBottom: 12, borderRadius: 6,
    border: `1px solid ${active ? UI.gold : UI.hairStrong}`,
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
const fdEmptyStyle = { textAlign: 'center', fontSize: 12, color: UI.inkFaint, padding: '18px 0', fontFamily: UI.fontUi };
// Read-only meal-category header above a cluster of timeline hours (see
// FD_MEAL_CATEGORIES): no border accent/interaction of its own, a plain
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
  border: `1px solid ${UI.hairStrong}`,
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
    border: `1px solid ${isNow ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`,
    background: isNow ? 'rgba(var(--accent-rgb),0.07)' : UI.bgInset,
    padding: filled ? '10px 10px' : '8px 10px',
  };
}
const fdHourLabelCol = { width: 24, flexShrink: 0, textAlign: 'right' };
function fdHourAddBtn(isNow) {
  return {
    flexShrink: 0, width: 30, height: 30, borderRadius: 4,
    border: `1px solid ${isNow ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`,
    background: 'transparent', color: isNow ? 'var(--accent)' : UI.inkSoft,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  };
}
const fdEntryName = { fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
// Plan Mode: the "Meal template" entry-point button in the Log tab.
const fdTemplateBtn = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 6, color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };
// Day-type badge on a template slot row (DAILY / TRAIN / REST).
function fdDayTypeChip(dayType) {
  const accent = dayType !== 'any';
  return { display: 'inline-block', fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color: accent ? 'var(--accent)' : UI.inkFaint, border: `1px solid ${accent ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, borderRadius: 4, padding: '1px 4px', marginRight: 6, verticalAlign: 'middle', fontFamily: UI.fontUi };
}
// A favorite/recipe row in the template food-source picker.
const fdPickRow = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };
// FoodTemplateScreen's plan-detail TopBar "Edit" button (rename), same look
// as PlanViewerScreen's own Edit button in screens-schedule.jsx.
const fdEditBtn = {
  background: 'transparent', border: `1px solid ${UI.hairStrong}`,
  borderRadius: 4, padding: '5px 12px', cursor: 'pointer',
  color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
};
// The "Active" / "Client template" status box atop a plan's detail view,
// same shape as PlanViewerScreen's planActions active indicator.
function fdStatusBox(gold) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    border: `1px solid ${gold ? UI.goldSoft : UI.hairStrong}`, borderRadius: 4,
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
// Thin vertical rule separating "quantity · kcal" from the macro bits, a
// deliberate element instead of another " · " so the macros read as their
// own group, not a fourth clause in the same list.
const fdMetaDivider = { display: 'inline-block', width: 1, height: 9, background: UI.hairStrong, margin: '0 6px', verticalAlign: 'middle' };
// textShadow: 'none' since UI.bgInset is a solid, opaque fill (unlike ui.jsx's
// Card, whose translucent surface-tint still shows the page's paper grid
// through it and so keeps the inherited lift): the grid-lift text-shadow
// Screen gives every descendant (paper theme only) would otherwise put a
// halo behind plain text sitting on an already-opaque background.
const fdEntryRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, textShadow: 'none' };
const fdInlineDeleteBtn = { background: 'transparent', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 6, WebkitTapHighlightColor: 'transparent' };
// A recipe entry's own card chrome (background/border/radius/padding, same
// values as fdEntryRow), but as a plain vertical stack instead of a single
// horizontal row: the header row sits on top, and when expanded the
// ingredient tree (FdIngredientTrunk/Tick, same idiom as the timeline's own
// FdHourTrunk/FdHourTick) joins it INSIDE the same card, not as a separate
// loose list underneath. fdEntryRow itself stays a plain row (used
// elsewhere for entries that never grow), this is only for the one entry
// type that does.
const fdEntryCard = { display: 'flex', flexDirection: 'column', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, padding: '10px 12px', textShadow: 'none' };
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
const fdResultRow = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px',
  background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, textShadow: 'none',
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};
const fdQuickRowWrap = { display: 'flex', alignItems: 'stretch', gap: 6 };
const fdQuickRowInner = {
  flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
  background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, textShadow: 'none',
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};
const fdSideBtn = {
  flexShrink: 0, width: 38, background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6,
  color: UI.inkFaint, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  display: 'flex', alignItems: 'center', justifyContent: 'center', textShadow: 'none',
};
const fdPreset = {
  padding: '8px 12px', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset,
  color: UI.ink, textShadow: 'none', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

window.Screens = window.Screens || {};
Object.assign(window.Screens, { FoodScreen, RecipeShareSheet });
