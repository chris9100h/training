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
function fdFmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fdNowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const fdNum = v => (v === '' || v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
const fdRound1 = v => Math.round(v * 10) / 10;
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
const FD_HOURS = Array.from({ length: 24 }, (_, i) => i);

function FoodScreen({ store, setStore, go, userId, date }) {
  const [confirmEl, confirm] = useConfirm();
  const today = LB.todayISO();
  const minDate = fdShiftDate(today, -14);
  const [curDate, setCurDate] = useStateFd(date || today);
  useEffectFd(() => setCurDate(date || today), [date]);

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
  // every open, a harmless no-op for foods that are already cached.
  useEffectFd(() => {
    (store.foodFavorites || []).forEach(f => {
      if (f.foodId && f.source && f.source !== 'custom') {
        LB.cacheFood(f.source, f.foodId.slice(f.source.length + 1));
      }
    });
  }, []);

  const [tab, setTab] = useStateFd('log');
  const [quickTab, setQuickTab] = useStateFd('recent');
  // Shared across Recent/Favorites/Recipes since only one shows at a time;
  // cleared on switching sub-tabs so a filter typed in one never silently
  // hides everything in the next.
  const [quickQuery, setQuickQuery] = useStateFd('');
  function onQuickTabChange(id) { setQuickTab(id); setQuickQuery(''); }
  // Hour (0-23) a timeline "+" was tapped for, so the next logged entry lands
  // at that hour instead of now. Cleared after a log, or when the user leaves
  // the timeline by tapping a main tab directly.
  const [pendingHour, setPendingHour] = useStateFd(null);

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

  const [qtySheetOpen, setQtySheetOpen] = useStateFd(false);
  const [pendingFood, setPendingFood] = useStateFd(null);
  const [qtyG, setQtyG] = useStateFd(''); // always grams, the actual source of truth for qtyPreview/buildQtyEntry
  // Amount field mode when pendingFood.units has entries: null means the
  // field is grams (qtyG itself, typed directly); otherwise it's an index
  // into pendingFood.units and the field is a COUNT of that unit
  // (qtyCountStr), with qtyG derived from it (count * unit.grams) by
  // onQtyCountChange/selectQtyUnit below rather than typed directly.
  const [qtyUnitIdx, setQtyUnitIdx] = useStateFd(null);
  const [qtyCountStr, setQtyCountStr] = useStateFd('');
  // id of the favorite created from the currently-open sheet, so the star
  // button can toggle it live (add on tap, remove on second tap) instead of
  // deferring the save to when the food is actually logged.
  const [favedId, setFavedId] = useStateFd(null);
  // recipe draft item being edited: finishEntry replaces it in place rather
  // than appending a new ingredient.
  const [editingDraftId, setEditingDraftId] = useStateFd(null);
  // Editable per-100g protein/carbs/fat for a scanned custom item, so the user
  // can correct a misread before logging. Kept as strings (decimals allowed);
  // only used on the pendingFood.custom path. kcal100Str is the per-100g
  // calorie figure alongside them: auto-derived from p100/c100/f100Str
  // (see the effect below) unless kcal100Touched, in which case a direct
  // edit to it wins and stops following further macro edits.
  const [p100Str, setP100Str] = useStateFd('');
  const [c100Str, setC100Str] = useStateFd('');
  const [f100Str, setF100Str] = useStateFd('');
  const [kcal100Str, setKcal100Str] = useStateFd('');
  const [kcal100Touched, setKcal100Touched] = useStateFd(false);
  useEffectFd(() => {
    if (kcal100Touched || !pendingFood?.custom) return;
    const p = fdNum(p100Str), c = fdNum(c100Str), f = fdNum(f100Str);
    const netCarbs = !!store.settings?.netCarbs;
    const raw = LB.caloriesFromMacros(p, c, f, netCarbs ? pendingFood?.fiberPer100g : null);
    setKcal100Str(raw != null ? String(Math.round(raw)) : '');
  }, [p100Str, c100Str, f100Str, kcal100Touched, pendingFood?.custom, pendingFood?.fiberPer100g, store.settings?.netCarbs]);
  // Clearing the field back to empty un-overrides it (touched=false) rather
  // than leaving it stuck empty forever: the effect above then recomputes
  // it from the current macros on the very next render, same as if the
  // field had never been touched.
  function onKcal100Change(v) {
    const filtered = fdDecimalFilter(v);
    setKcal100Touched(filtered !== '');
    setKcal100Str(filtered);
  }

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
  const [customCal, setCustomCal] = useStateFd('');
  const [customCalTouched, setCustomCalTouched] = useStateFd(false);
  useEffectFd(() => {
    if (customCalTouched) return;
    const p = fdNum(customP), c = fdNum(customC), f = fdNum(customF);
    const netCarbs = !!store.settings?.netCarbs;
    const raw = LB.caloriesFromMacros(p, c, f, netCarbs ? fdNum(customFib) : null);
    setCustomCal(raw != null ? String(Math.round(raw)) : '');
  }, [customP, customC, customF, customFib, customCalTouched, store.settings?.netCarbs]);
  // Same un-override-on-clear behavior as onKcal100Change above.
  function onCustomCalChange(v) {
    const filtered = fdDecimalFilter(v);
    setCustomCalTouched(filtered !== '');
    setCustomCal(filtered);
  }

  // Recipe builder: a lightweight "mode" rather than its own sheet, so it can
  // reuse the Search tab's existing search/quantity/custom flows verbatim as
  // an ingredient picker (finishEntry below is the only branch point). The
  // banner renders on every tab so switching to Log to sanity-check doesn't
  // read as abandoning the draft.
  const [recipeMode, setRecipeMode] = useStateFd(null); // { editId?, name, items: [] }
  const [recipeNameOpen, setRecipeNameOpen] = useStateFd(false);
  const [recipeNameInput, setRecipeNameInput] = useStateFd('');
  const [recipeNameMode, setRecipeNameMode] = useStateFd('new'); // 'new' | 'rename'
  // A one-tap recipe log (see addRecipeToLog) has no sheet to open/close, so
  // without this nothing visibly changes on tap: users couldn't tell whether
  // it registered and often tapped again, logging it twice. addingRecipeId
  // disables the row for the duration of the write (blocks a fast double-tap
  // from firing twice); recipeJustAddedId swaps the row's kcal for a brief
  // checkmark afterwards, same idiom as the exercise library's "Added" state.
  const [addingRecipeId, setAddingRecipeId] = useStateFd(null);
  const [recipeJustAddedId, setRecipeJustAddedId] = useStateFd(null);

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

  const dayLabel = curDate === today ? 'Today' : curDate === fdShiftDate(today, -1) ? 'Yesterday' : fdFmtDate(curDate);

  const dayEntries = useMemoFd(
    () => (store.foodLogs || []).filter(l => l.date === curDate).sort((a, b) => b.time.localeCompare(a.time)),
    [store.foodLogs, curDate],
  );
  const dayTotals = useMemoFd(() => ({
    calories: dayEntries.reduce((a, e) => a + (e.calories || 0), 0),
    protein: dayEntries.reduce((a, e) => a + (e.protein || 0), 0),
    carbs: dayEntries.reduce((a, e) => a + (e.carbs || 0), 0),
    fat: dayEntries.reduce((a, e) => a + (e.fat || 0), 0),
  }), [dayEntries]);

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
  const heroPercent = goalCalories > 0 ? Math.min(Math.round((dayTotals.calories / goalCalories) * 100), 100) : null;

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

  // Recent strip: dedupe by food_id for DB items, by food_name for custom
  // ones. store.foodLogs is already recency-ordered (server query and local
  // prepends both put newest first), so a first-seen walk is enough. Kept
  // uncapped here so a search (below) can still reach further back than the
  // unfiltered 20-item cap; recentFoods itself stays recency-ordered either
  // way, never re-sorted, matching Favorites/Recipes' own alphabetical sort
  // being deliberately NOT applied to Recent.
  const recentFoodsAll = useMemoFd(() => {
    const seen = new Set();
    const out = [];
    for (const l of (store.foodLogs || [])) {
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

  const shiftDay = (delta) => setCurDate(d => {
    const next = fdShiftDate(d, delta);
    return (next > today || next < minDate) ? d : next;
  });

  // Writes the day's summed macros into the daily log, same one-call shape
  // patchDaily/doAdd use in screens-water.jsx. Calories come straight from the
  // source's own energy value (summed), never derived from the macros.
  function patchDaily(s, dateStr, entries) {
    const netCarbs = !!s.settings?.netCarbs;
    const has = entries.length > 0;
    const sum = k => entries.reduce((a, e) => a + (e[k] || 0), 0);
    const calories = has ? Math.round(sum('calories')) : null;
    const protein = has ? Math.round(sum('protein')) : null;
    const carbs = has ? Math.round(sum('carbs')) : null;
    const fat = has ? Math.round(sum('fat')) : null;
    const fiber = has && netCarbs ? Math.round(sum('fiber')) : null;
    const existing = (s.dailyLogs || []).find(l => l.date === dateStr);
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
  // only fires on that transition. Shared by commitEntry (single add) and
  // submitCopyMove (bulk copy/move onto another date). Returns false if the
  // user backs out, so callers can leave their sheet open instead of
  // closing on a log that never happened.
  async function warnIfOverwritingManualMacros(dateStr) {
    const alreadyFoodOwned = (store.foodLogs || []).some(l => l.date === dateStr);
    if (alreadyFoodOwned) return true;
    const existingLog = (store.dailyLogs || []).find(l => l.date === dateStr);
    const hasManualMacros = existingLog && (existingLog.protein != null || existingLog.carbs != null || existingLog.fat != null || existingLog.calories != null);
    if (!hasManualMacros) return true;
    return confirm(
      "This day already has manually-entered macros in the Health tab. Logging food here will overwrite them, and the Food Tracker will manage this day's macros from now on.",
      { title: 'Overwrite manual macros?', ok: 'Continue', cancel: 'Cancel' }
    );
  }

  // Commits a real log write (not a recipe-draft stage).
  async function commitEntry(entry) {
    const ok = await warnIfOverwritingManualMacros(entry.date);
    if (!ok) return false;
    setStore(s => {
      const nextLogs = [entry, ...(s.foodLogs || [])];
      return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, entry.date, nextLogs.filter(l => l.date === entry.date)) };
    });
    setPendingHour(null);
    return true;
  }

  // Time stamped on a newly logged entry: the timeline hour the user tapped
  // "+" on, else the current wall-clock time.
  function entryTime() {
    return pendingHour != null ? `${String(pendingHour).padStart(2, '0')}:00` : fdNowHHMM();
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

  // Terminal step shared by the search-selected and custom-item flows: commits
  // straight to the day's log, or (while building a recipe) appends to the
  // draft ingredient list, or replaces an existing draft ingredient when one
  // is being edited.
  // Returns whether the entry actually landed: always true for a recipe-draft
  // stage (nothing is written to the day's log yet, so there's nothing to
  // warn about), or commitEntry's result for a real log.
  async function finishEntry(entry) {
    if (recipeMode) {
      if (editingDraftId) {
        const eid = editingDraftId;
        setRecipeMode(m => m ? { ...m, items: m.items.map(i => i.id === eid ? { ...entry, id: eid } : i) } : m);
      } else {
        setRecipeMode(m => ({ ...m, items: [...m.items, entry] }));
      }
      return true;
    }
    return commitEntry(entry);
  }

  async function deleteEntry(entry) {
    const ok = await confirm(`${entry.foodName} · ${entry.calories} kcal`, { title: 'Delete entry?', ok: 'Delete', cancel: 'Cancel', danger: true });
    if (!ok) return;
    setStore(s => {
      const nextLogs = (s.foodLogs || []).filter(l => l.id !== entry.id);
      return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, entry.date, nextLogs.filter(l => l.date === entry.date)) };
    });
  }

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
    const ok = await warnIfOverwritingManualMacros(copyMoveTarget);
    if (!ok) return;
    const targetDate = copyMoveTarget, mode = copyMoveMode, ids = copyMoveIds, sourceDate = curDate;
    setStore(s => {
      const selected = (s.foodLogs || []).filter(l => ids.includes(l.id));
      if (!selected.length) return s;
      const now = new Date().toISOString();
      const clones = selected.map(l => ({ ...l, id: LB.uid(), date: targetDate, createdAt: now }));
      const remaining = mode === 'move' ? (s.foodLogs || []).filter(l => !ids.includes(l.id)) : (s.foodLogs || []);
      const nextLogs = [...clones, ...remaining];
      let dailyLogs = patchDaily(s, targetDate, nextLogs.filter(l => l.date === targetDate));
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
  // client-side and send it to the scan-label edge function (Claude vision),
  // then prefill the Custom Item form with what it read for the user to verify.
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
      const res = await LB.scanLabel(base64, mimeType);
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
      setEditingDraftId(null);
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
    setEditingDraftId(null);
    setPendingFood({ ...r, fromCache: !!r.cached });
    setFavedId(existingFavId(`${r.source}:${r.sourceId}`, r.name));
    setQtyG(r.servingSizeG ? String(Math.round(r.servingSizeG)) : '100');
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
      // Set only on a favorite with units configured (see openEditFavorite);
      // undefined everywhere else (recent items, recipe draft ingredients),
      // which the quantity sheet's units?.length check treats as "no units".
      units: item.units,
    });
    setP100Str(String(fdRound1(item.protein * per100)));
    setC100Str(String(fdRound1(item.carbs * per100)));
    setF100Str(String(fdRound1(item.fat * per100)));
    setKcal100Touched(false);
    setQtyG(String(item.quantityG || 100));
    openQtySheet();
  }

  // Reconstructs per-100g rates from a past entry (the log/favorite only
  // stores the already-scaled amounts, not per-100g), so a recent or
  // favorited DB-sourced item can be relogged at a different quantity
  // without another network round-trip. Recent (foodLogs) and Favorites
  // share this exact shape, so one function serves both strips.
  function reAddFromRecent(l) {
    setEditingDraftId(null);
    setFavedId(existingFavId(l.foodId, l.foodName));
    if (l.foodId) {
      const per100 = l.quantityG > 0 ? 100 / l.quantityG : 1;
      setPendingFood({
        source: l.source, sourceId: l.foodId.slice((l.source || '').length + 1),
        name: l.foodName, brand: l.brand || null,
        // Derived from the stored macros, not l.calories directly: always
        // computing at read time (rather than trusting whatever calories
        // this entry happened to be logged with) keeps a re-add correct
        // even for an entry from before this rule existed, without needing
        // every historical row to already be fixed.
        kcalPer100g: LB.caloriesFromMacros(l.protein, l.carbs, l.fat) * per100,
        proteinPer100g: l.protein * per100,
        carbsPer100g: l.carbs * per100, fatPer100g: l.fat * per100,
        fiberPer100g: l.fiber != null ? l.fiber * per100 : null,
        servingSizeG: null, servingLabel: null,
        // Already in the log (so already cached): don't re-cache it on re-log.
        fromCache: true,
        // Only present on a favorite (see openEditFavorite); undefined for a
        // plain Recent entry, same "no units" fallback as the custom branch.
        units: l.units,
      });
      setQtyG(String(l.quantityG || 100));
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
    const kcal100 = custom ? (fdNum(kcal100Str) || 0) : (pendingFood.kcalPer100g || 0);
    return {
      calories: Math.round(kcal100 * factor),
      protein: fdRound1(rate(p100Str, 'proteinPer100g') * factor),
      carbs: fdRound1(rate(c100Str, 'carbsPer100g') * factor),
      fat: fdRound1(rate(f100Str, 'fatPer100g') * factor),
      fiber: pendingFood.fiberPer100g != null ? fdRound1(pendingFood.fiberPer100g * factor) : null,
    };
  }, [pendingFood, qtyG, p100Str, c100Str, f100Str, kcal100Str]);

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
  function closeQtySheet() { setQtySheetOpen(false); setPendingFood(null); setQtyG(''); setFavedId(null); setEditingDraftId(null); setP100Str(''); setC100Str(''); setF100Str(''); setKcal100Str(''); setKcal100Touched(false); setQtyUnitIdx(null); setQtyCountStr(''); }
  function closeCustomSheet() { setCustomOpen(false); setFavedId(null); setEditingDraftId(null); }

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
      createdAt: new Date().toISOString(),
    };
  }
  function buildCustomEntry() {
    const name = customName.trim();
    const p = fdNum(customP), c = fdNum(customC), f = fdNum(customF);
    const cal = fdNum(customCal);
    if (!name || p == null || c == null || f == null || cal == null) return null;
    return {
      id: LB.uid(), date: curDate, time: entryTime(),
      foodId: null, foodName: name, brand: null, source: 'custom',
      quantityG: fdNum(customG) || 100, calories: Math.round(cal), protein: p, carbs: c, fat: f,
      fiber: customFib !== '' ? fdNum(customFib) : null,
      createdAt: new Date().toISOString(),
    };
  }

  // Id of an existing favorite matching this food (by food_id for DB items, by
  // name for custom ones), or null. Used to reflect the already-favorited
  // state on open and to prevent duplicate favorites.
  function existingFavId(foodId, foodName) {
    const f = (store.foodFavorites || []).find(x => foodId ? x.foodId === foodId : (x.foodId == null && x.foodName === foodName));
    return f ? f.id : null;
  }

  // Immediate favorite: tapping the star saves (or, on a second tap, removes)
  // the favorite right away, independent of whether the food ends up logged.
  // Never creates a duplicate: if the food is already a favorite, it just
  // reflects (or removes) the existing one.
  function toggleFavorite(entry) {
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
      setFavedId(fav.id);
      setStore(s => ({ ...s, foodFavorites: [fav, ...(s.foodFavorites || [])] }));
      // foodFavorites.food_id is a real FK into zane_foods, but that row is
      // normally only cached once a food gets logged (see confirmLogFood).
      // Starring a food without ever logging it would otherwise sync a
      // favorite whose food_id points at nothing, failing its FK check on
      // every retry forever. Trigger the same cache write here so favoriting
      // alone is enough.
      if (fav.foodId && pendingFood && !pendingFood.fromCache) {
        LB.cacheFood(pendingFood.source, pendingFood.sourceId);
      }
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

  async function confirmLogFood() {
    const entry = buildQtyEntry();
    if (!entry) return;
    const ok = await finishEntry(entry);
    if (!ok) return; // user backed out of the overwrite warning; leave the sheet open
    // Only now (a real log, not a mere open) grow the shared cache, and only
    // for a freshly-fetched DB food that wasn't already cached. Not while
    // building a recipe (ingredients aren't standalone logs).
    if (!recipeMode && entry.foodId && pendingFood && !pendingFood.fromCache) {
      LB.cacheFood(pendingFood.source, pendingFood.sourceId);
    }
    closeQtySheet();
  }

  function resetCustomForm() {
    setCustomName(''); setCustomG(''); setCustomP(''); setCustomC(''); setCustomF(''); setCustomFib('');
    setCustomCal(''); setCustomCalTouched(false);
    setFavedId(null); setEditingDraftId(null);
  }

  async function submitCustomItem() {
    const entry = buildCustomEntry();
    if (!entry) return;
    const ok = await finishEntry(entry);
    if (!ok) return; // user backed out of the overwrite warning; leave the sheet open
    closeCustomSheet();
    resetCustomForm();
  }
  const customValid = customName.trim() && fdNum(customP) != null && fdNum(customC) != null && fdNum(customF) != null && fdNum(customCal) != null;

  // ── Recipes ──
  function openNewRecipe() { setRecipeNameInput(''); setRecipeNameMode('new'); setRecipeNameOpen(true); }
  function openRenameRecipe() { setRecipeNameInput(recipeMode?.name || ''); setRecipeNameMode('rename'); setRecipeNameOpen(true); }
  function confirmRecipeName() {
    const name = recipeNameInput.trim();
    if (!name) return;
    setRecipeNameOpen(false);
    if (recipeNameMode === 'rename') {
      setRecipeMode(m => m ? { ...m, name } : m);
    } else {
      setRecipeMode({ name, items: [] });
      setTab('search');
    }
  }
  // Open an existing recipe for editing: ingredients get fresh ephemeral ids
  // for the draft (stored recipe items carry no id), and editId marks that
  // saving updates in place instead of creating a new recipe.
  function editRecipe(recipe) {
    setRecipeMode({ editId: recipe.id, name: recipe.name, items: (recipe.items || []).map(i => ({ ...i, id: LB.uid() })) });
    setTab('search');
  }
  // Tap a draft ingredient to edit its amount: reopens the matching sheet
  // prefilled, and editingDraftId makes finishEntry replace it in place.
  function editDraftItem(item) {
    setFavedId(null);
    setEditingDraftId(item.id);
    if (item.foodId) {
      const per100 = item.quantityG > 0 ? 100 / item.quantityG : 1;
      setPendingFood({
        source: item.source, sourceId: item.foodId.slice((item.source || '').length + 1),
        name: item.foodName, brand: item.brand || null,
        // See reAddFromRecent: always derived from the stored macros, not
        // item.calories directly.
        kcalPer100g: LB.caloriesFromMacros(item.protein, item.carbs, item.fat) * per100,
        proteinPer100g: item.protein * per100,
        carbsPer100g: item.carbs * per100, fatPer100g: item.fat * per100,
        fiberPer100g: item.fiber != null ? item.fiber * per100 : null,
        servingSizeG: null, servingLabel: null, fromCache: true,
      });
      setQtyG(String(item.quantityG || 100));
      openQtySheet();
    } else {
      openCustomAsScalable(item);
    }
  }
  function removeRecipeDraftItem(id) {
    setRecipeMode(m => m ? { ...m, items: m.items.filter(i => i.id !== id) } : m);
  }
  function cancelRecipe() { setRecipeMode(null); setEditingDraftId(null); }
  function saveRecipe() {
    if (!recipeMode || !recipeMode.items.length) { setRecipeMode(null); return; }
    const items = recipeMode.items.map(i => ({
      foodId: i.foodId, foodName: i.foodName, brand: i.brand, source: i.source,
      quantityG: i.quantityG, calories: i.calories, protein: i.protein, carbs: i.carbs, fat: i.fat, fiber: i.fiber,
    }));
    const now = new Date().toISOString();
    if (recipeMode.editId) {
      const id = recipeMode.editId;
      setStore(s => ({ ...s, foodRecipes: (s.foodRecipes || []).map(r => r.id === id ? { ...r, name: recipeMode.name, items, updatedAt: now } : r) }));
    } else {
      setStore(s => ({ ...s, foodRecipes: [{ id: LB.uid(), name: recipeMode.name, items, createdAt: now, updatedAt: now }, ...(s.foodRecipes || [])] }));
    }
    setRecipeMode(null);
    setTab('quickadd'); setQuickTab('recipes');
  }
  function deleteRecipe(recipe) {
    setStore(s => ({ ...s, foodRecipes: (s.foodRecipes || []).filter(r => r.id !== recipe.id) }));
  }
  // Recipe items are a fixed jsonb snapshot (zane_food_recipes.items), so an
  // ingredient added before calories-always-from-macros became the rule
  // still carries whatever calories it was snapshotted with. Recomputing
  // from each item's own protein/carbs/fat at every use, not just once at
  // write time, makes an old recipe self-heal exactly like
  // reAddFromRecent/editDraftItem already do for a single re-added item,
  // with no separate migration needed for the jsonb blobs themselves.
  function recipeItemsCalories(items) {
    return Math.round((items || []).reduce((a, i) => a + (LB.caloriesFromMacros(i.protein, i.carbs, i.fat) || 0), 0));
  }

  // Recipes log as ONE entry (the sum of their ingredients), not N, and at a
  // fixed amount, no scaling: the whole point is "log this exact thing I eat
  // the same way every time" in a single tap.
  async function addRecipeToLog(recipe) {
    if (addingRecipeId) return; // a request for another recipe is already in flight
    const items = recipe.items || [];
    if (!items.length) return;
    setAddingRecipeId(recipe.id);
    try {
      const sum = k => items.reduce((a, i) => a + (i[k] || 0), 0);
      const entry = {
        id: LB.uid(), date: curDate, time: entryTime(),
        foodId: null, foodName: recipe.name, brand: null, source: 'recipe',
        quantityG: Math.round(sum('quantityG')), calories: recipeItemsCalories(items),
        protein: fdRound1(sum('protein')), carbs: fdRound1(sum('carbs')), fat: fdRound1(sum('fat')),
        fiber: items.some(i => i.fiber != null) ? fdRound1(sum('fiber')) : null,
        createdAt: new Date().toISOString(),
      };
      const ok = await commitEntry(entry);
      if (ok) {
        setRecipeJustAddedId(recipe.id);
        setTimeout(() => setRecipeJustAddedId(id => id === recipe.id ? null : id), 2000);
      }
    } finally {
      setAddingRecipeId(null);
    }
  }

  const recipeDraftTotals = useMemoFd(() => {
    if (!recipeMode) return { calories: 0, protein: 0, carbs: 0, fat: 0 };
    const sum = k => recipeMode.items.reduce((a, i) => a + (i[k] || 0), 0);
    return { calories: recipeItemsCalories(recipeMode.items), protein: Math.round(sum('protein')), carbs: Math.round(sum('carbs')), fat: Math.round(sum('fat')) };
  }, [recipeMode]);

  // Shown on both add-a-food tabs (Search and Quick Add) whenever a timeline
  // hour is pending, so the target time is always visible and cancelable.
  const pendingHourBanner = pendingHour != null && !recipeMode ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'rgba(var(--accent-rgb),0.1)', border: `1px solid rgba(var(--accent-rgb),0.3)`, borderRadius: 6 }}>
      <i className="fa-solid fa-clock" style={{ fontSize: 12, color: 'var(--accent)' }} />
      <span style={{ flex: 1, fontSize: 12, color: UI.ink, fontFamily: UI.fontUi }}>Logging at {String(pendingHour).padStart(2, '0')}:00</span>
      <button onClick={() => setPendingHour(null)} style={{ background: 'none', border: 'none', padding: '2px 4px', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>Now instead</button>
    </div>
  ) : null;

  return (
    <Screen>
      {confirmEl}
      <TopBar title="Food" sub={dayLabel} onBack={() => go({ name: 'health' })}
        right={
          tab === 'quickadd' && quickTab === 'recipes' && !recipeMode && (store.foodRecipes || []).length > 0 ? (
            <button onClick={openNewRecipe} aria-label="New recipe" style={fdTopAddBtn}>
              <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
            </button>
          ) : tab === 'log' && dayEntries.length > 0 ? (
            <button onClick={openCopyMove} aria-label="Copy or move entries" style={fdTopAddBtn}>
              <i className="fa-solid fa-clone" style={{ fontSize: 13 }} />
            </button>
          ) : undefined
        } />

      <SubTabBar tabs={FD_TABS} active={tab} onChange={onTabChange} />

      {recipeMode && (
        <div style={fdRecipeBanner}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: recipeMode.items.length ? 8 : 6 }}>
            <button onClick={openRenameRecipe} style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
              <div className="micro" style={{ color: UI.inkFaint }}>{recipeMode.editId ? 'Editing recipe' : 'New recipe'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{recipeMode.name}</span>
                <i className="fa-solid fa-pen" style={{ fontSize: 9, color: UI.inkFaint, flexShrink: 0 }} />
              </div>
            </button>
            <button onClick={cancelRecipe} style={fdBannerBtn}>Cancel</button>
            <button onClick={saveRecipe} disabled={!recipeMode.items.length} style={{ ...fdBannerBtn, color: recipeMode.items.length ? 'var(--accent)' : UI.inkGhost, fontWeight: 700 }}>{recipeMode.editId ? 'Save' : 'Done'}</button>
          </div>
          {recipeMode.items.length > 0 ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10 }}>
                <span className="num" style={{ fontSize: 20, fontWeight: 300, color: UI.ink }}>{recipeDraftTotals.calories}<span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 3 }}>kcal</span></span>
                <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>P</span> {recipeDraftTotals.protein}</span>
                <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>C</span> {recipeDraftTotals.carbs}</span>
                <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>F</span> {recipeDraftTotals.fat}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 168, overflowY: 'auto' }}>
                {recipeMode.items.map(i => (
                  <div key={i.id} style={fdDraftRow}>
                    <button onClick={() => editDraftItem(i)} style={fdDraftMain}>
                      <span style={{ ...fdEntryName, fontSize: 12 }}>{i.foodName}</span>
                      <span style={fdEntryMeta}>{i.quantityG}g · {Math.round(LB.caloriesFromMacros(i.protein, i.carbs, i.fat) || 0)} kcal · P{Math.round(i.protein)} C{Math.round(i.carbs)} F{Math.round(i.fat)}</span>
                    </button>
                    <button onClick={() => removeRecipeDraftItem(i.id)} aria-label="Remove" style={fdInlineDeleteBtn}>
                      <i className="fa-solid fa-trash" style={{ fontSize: 11 }} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.4 }}>Search below and add ingredients with their usual amounts, then Done.</div>
          )}
        </div>
      )}

      <div style={{ padding: '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {tab === 'log' && (
          <>
            {/* Day nav */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button onClick={() => shiftDay(-1)} disabled={curDate <= minDate} aria-label="Previous day" style={fdNavBtn(curDate <= minDate)}>
                <i className="fa-solid fa-chevron-left" style={{ fontSize: 12 }} />
              </button>
              <div style={{ fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>{dayLabel}</div>
              <button onClick={() => shiftDay(1)} disabled={curDate >= today} aria-label="Next day" style={fdNavBtn(curDate >= today)}>
                <i className="fa-solid fa-chevron-right" style={{ fontSize: 12 }} />
              </button>
            </div>

            {/* Totals hero: same BracketFrame-gold + progress-ring hero Water
                uses for its own daily total, so this reads as the same kind of
                primary "today" surface elsewhere in the app. The ring only
                appears once a calorie target is resolvable (personal or coach
                macros, see goalCalories above); with no target set it's just
                the total and the macro chips, same as before. */}
            <BracketFrame gold style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="micro" style={{ color: UI.inkFaint }}>{dayLabel}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                    <span className="num" style={{ fontSize: 40, fontWeight: 300, color: UI.ink, lineHeight: 1 }}>{dayTotals.calories}</span>
                    <span style={{ fontSize: 15, color: UI.inkFaint, fontFamily: UI.fontUi }}>kcal</span>
                  </div>
                  {goalCalories != null && (
                    <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 8, fontFamily: UI.fontUi }}>of {goalCalories} kcal</div>
                  )}
                  <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
                    <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>P</span> {Math.round(dayTotals.protein)}g</span>
                    <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>C</span> {Math.round(dayTotals.carbs)}g</span>
                    <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>F</span> {Math.round(dayTotals.fat)}g</span>
                  </div>
                </div>
                {heroPercent != null && <FdRing percent={heroPercent} />}
              </div>
            </BracketFrame>

            {/* Hourly timeline: every hour 0-23 has a "+" that logs at exactly
                that hour, with its entries listed underneath. */}
            <div>
              <Bezel style={{ marginBottom: 10 }}>Timeline</Bezel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {FD_HOURS.map(h => {
                  const es = byHour[h] || [];
                  const filled = es.length > 0;
                  // Only today has a "current hour" to mark; a backdated day's
                  // timeline stays plain. Local wall-clock hour (getHours()),
                  // matching the user's own timezone, same as entryTime()/
                  // fdNowHHMM() already do for the "log at now" default.
                  const isNow = curDate === today && h === new Date().getHours();
                  return (
                    <div key={h} style={fdHourRow(filled, isNow)}>
                      <div style={fdHourLabelCol}>
                        <span className="num" style={{ fontSize: 11, fontWeight: isNow ? 700 : 400, color: isNow ? 'var(--accent)' : (filled ? UI.inkSoft : UI.inkGhost) }}>{String(h).padStart(2, '0')}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {es.map(e => (
                          <div key={e.id} style={fdEntryRow}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                              <span style={fdEntryName}>{e.foodName}</span>
                              <span style={fdEntryMeta}>
                                {e.quantityG ? `${e.quantityG}g · ` : ''}{e.calories} kcal · P{Math.round(e.protein)} C{Math.round(e.carbs)} F{Math.round(e.fat)}
                              </span>
                            </div>
                            <button onClick={() => deleteEntry(e)} aria-label="Delete" style={fdInlineDeleteBtn}>
                              <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => addAtHour(h)} aria-label={`Add food at ${String(h).padStart(2, '0')}:00`} style={fdHourAddBtn(isNow)}>
                        <i className="fa-solid fa-plus" style={{ fontSize: 11 }} />
                      </button>
                    </div>
                  );
                })}
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
                          <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{r.kcalPer100g != null ? Math.round(r.kcalPer100g) : '—'} kcal</div>
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
                          {f.units?.length > 0 && (
                            <div style={fdEntryMeta}>{f.units.map(u => `1 ${u.label} = ${u.grams}g`).join(' · ')}</div>
                          )}
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
                      const kcal = recipeItemsCalories(items);
                      const justAdded = recipeJustAddedId === r.id;
                      return (
                        <div key={r.id} style={fdQuickRowWrap}>
                          <button onClick={() => addRecipeToLog(r)} disabled={addingRecipeId === r.id} style={{ ...fdQuickRowInner, opacity: addingRecipeId === r.id ? 0.6 : 1 }}>
                            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                              <div style={fdEntryName}>{r.name}</div>
                              <div style={fdEntryMeta}>{items.length} ingredient{items.length === 1 ? '' : 's'} · P{Math.round(items.reduce((a, i) => a + (i.protein || 0), 0))} C{Math.round(items.reduce((a, i) => a + (i.carbs || 0), 0))} F{Math.round(items.reduce((a, i) => a + (i.fat || 0), 0))}</div>
                            </div>
                            {justAdded ? (
                              <span style={{ fontSize: 11, color: UI.gold, fontFamily: UI.fontUi, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                <i className="fa-solid fa-check" /> Added
                              </span>
                            ) : (
                              <div className="num" style={{ fontSize: 12, color: UI.inkSoft, flexShrink: 0 }}>{kcal} kcal</div>
                            )}
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
                autoFocus={!pendingFood.custom} style={fdBigInput} />
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, marginBottom: 16 }}>
                <span className="num" style={{ fontSize: 15, color: UI.ink }}>{qtyPreview.calories} kcal</span>
                <span style={{ display: 'flex', gap: 10 }}>
                  <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>P {qtyPreview.protein}</span>
                  <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>C {qtyPreview.carbs}</span>
                  <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>F {qtyPreview.fat}</span>
                </span>
              </div>
            )}
            {!recipeMode && (
              <button onClick={() => toggleFavorite(buildQtyEntry())} disabled={!qtyPreview || qtyNameMissing} style={fdFavBtn(!!favedId, !qtyPreview || qtyNameMissing)}>
                <i className={`fa-${favedId ? 'solid' : 'regular'} fa-star`} style={{ fontSize: 14, color: favedId ? UI.gold : UI.inkSoft }} />
                {favedId ? 'Saved to favorites' : 'Save as favorite'}
              </button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={closeQtySheet} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={confirmLogFood} disabled={!qtyPreview || qtyNameMissing} style={{ flex: 2 }}>{recipeMode ? (editingDraftId ? 'Update ingredient' : 'Add ingredient') : 'Add'}</Btn>
            </div>
          </>
        )}
      </Sheet>

      {/* ── Custom item sheet ── */}
      <Sheet open={customOpen} onClose={closeCustomSheet} title="Custom item" titleColor="var(--accent)">
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
        {!recipeMode && (
          <button onClick={() => toggleFavorite(buildCustomEntry())} disabled={!customValid} style={fdFavBtn(!!favedId, !customValid)}>
            <i className={`fa-${favedId ? 'solid' : 'regular'} fa-star`} style={{ fontSize: 14, color: favedId ? UI.gold : UI.inkSoft }} />
            {favedId ? 'Saved to favorites' : 'Save as favorite'}
          </button>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={closeCustomSheet} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={submitCustomItem} disabled={!customValid} style={{ flex: 2 }}>{recipeMode ? (editingDraftId ? 'Update ingredient' : 'Add ingredient') : 'Add'}</Btn>
        </div>
      </Sheet>

      {/* ── Recipe name sheet (new + rename) ── */}
      <Sheet open={recipeNameOpen} onClose={() => setRecipeNameOpen(false)} title={recipeNameMode === 'rename' ? 'Rename recipe' : 'New recipe'} titleColor="var(--accent)">
        <Field label="Name" style={{ marginBottom: 16 }}>
          <TextInput value={recipeNameInput} onChange={setRecipeNameInput} placeholder="e.g. Breakfast bowl" autoFocus />
        </Field>
        {recipeNameMode === 'new' && (
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.5 }}>
            Next you'll search and add each ingredient with its usual amount. Once saved, the whole recipe logs in one tap.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => setRecipeNameOpen(false)} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={confirmRecipeName} disabled={!recipeNameInput.trim()} style={{ flex: 2 }}>{recipeNameMode === 'rename' ? 'Save name' : 'Start adding ingredients'}</Btn>
        </div>
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
          <input type="date" value={copyMoveTarget} min={minDate} max={today} onChange={e => setCopyMoveTarget(e.target.value)}
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

      {/* ── Units for a favorite (e.g. "1 Pc = 62g", "1 Pack = 500g") ── */}
      <Sheet open={!!editFavId} onClose={closeEditFavorite} title="Units" titleColor="var(--accent)">
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
      </Sheet>

      {/* Hidden picker: opens the native camera (capture) or gallery on tap,
          which works on iOS Safari without any library. */}
      <input ref={labelInputRef} type="file" accept="image/*" capture="environment" onChange={handleLabelFile} style={{ display: 'none' }} />
      {labelScanning && <FdLabelBusy />}
      {scanOpen && <FdScanner onClose={() => setScanOpen(false)} onDetect={handleScan} />}
    </Screen>
  );
}

// Calorie-progress ring for the Log-tab hero, same shape as WaterRing
// (screens-water.jsx) so both daily-total heroes read as the same idiom. Uses
// the live accent color instead of a fixed hex: unlike Water's own semantic
// blue (deliberately decoupled from the user's accent), Food has no such
// fixed identity, and var(--accent) already adapts per theme on its own, so
// no light/dark special-casing is needed here the way WaterRing needs for its
// hardcoded blue.
function FdRing({ percent, size = 128 }) {
  const r = 50, circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(percent, 100) / 100);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke={UI.hair} strokeWidth="12" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--accent)" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circ.toFixed(1)} strokeDashoffset={offset.toFixed(1)}
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)' }} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: UI.fontNum, fontSize: 26, fontWeight: 600, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums',
      }}>{percent}%</div>
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

// Live-camera barcode scanner. Uses html5-qrcode (lazy-loaded via
// window.__ensureBarcodeLib, same on-demand pattern as html2canvas), which
// works on iOS Safari too (and uses the native BarcodeDetector internally
// where it exists). Owns the scanner instance and tears the camera down on
// unmount. Falls back to a "type the barcode" hint only if the library or
// camera is unavailable, the search box already handles typed barcodes.
const FD_SCANNER_ELEM_ID = 'fd-barcode-scanner-view';
function FdScanner({ onClose, onDetect }) {
  const [status, setStatus] = useStateFd('loading'); // 'loading' | 'scanning' | 'error'
  const scannerRef = useRefFd(null);
  const doneRef = useRefFd(false);
  useEffectFd(() => {
    let cancelled = false;
    (async () => {
      let lib;
      try { lib = await window.__ensureBarcodeLib(); } catch (_) { lib = null; }
      if (cancelled) return;
      if (!lib || !window.Html5Qrcode) { setStatus('error'); return; }
      try {
        const Formats = window.Html5QrcodeSupportedFormats;
        const formats = Formats ? [Formats.EAN_13, Formats.EAN_8, Formats.UPC_A, Formats.UPC_E, Formats.UPC_EAN_EXTENSION, Formats.CODE_128] : undefined;
        const scanner = new window.Html5Qrcode(FD_SCANNER_ELEM_ID, { formatsToSupport: formats, experimentalFeatures: { useBarCodeDetectorIfSupported: true }, verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          // No qrbox: scan the whole frame (its shaded overlay is what letterboxed
          // the view and drew brackets outside the image). The video is forced to
          // fill the screen via CSS below, and we draw our own centered frame.
          { fps: 10 },
          (text) => {
            const raw = String(text || '').replace(/\D/g, '');
            if (doneRef.current || !/^\d{8,14}$/.test(raw)) return;
            doneRef.current = true;
            onDetect(raw);
          },
          () => {}, // per-frame decode misses: ignore
        );
        if (cancelled) { scanner.stop().catch(() => {}); return; }
        setStatus('scanning');
      } catch (_) {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) { try { s.stop().then(() => s.clear()).catch(() => {}); } catch (_) {} }
    };
  }, []); // eslint-disable-line

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#000', display: 'flex', flexDirection: 'column', animation: 'sheet-up 0.22s ease' }}>
      <div style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 18px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1, color: '#fff', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600 }}>Scan barcode</span>
        <button onClick={onClose} aria-label="Close scanner" style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 34, height: 34, borderRadius: 4, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* html5-qrcode renders the camera into this element. Force the video it
            injects to fill the area (cover), so the preview is truly full-screen
            instead of letterboxed at the container's width. */}
        <style>{`#${FD_SCANNER_ELEM_ID}{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;overflow:hidden;}#${FD_SCANNER_ELEM_ID} video{position:absolute!important;top:0;left:0;width:100%!important;height:100%!important;object-fit:cover!important;}`}</style>
        <div id={FD_SCANNER_ELEM_ID} />
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
const fdRecipeBanner = {
  padding: '12px 22px',
  background: 'rgba(var(--accent-rgb),0.08)', borderBottom: `1px solid rgba(var(--accent-rgb),0.3)`,
};
const fdBannerBtn = {
  flexShrink: 0, background: 'none', border: 'none', padding: '4px 6px', cursor: 'pointer',
  color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, WebkitTapHighlightColor: 'transparent',
};
const fdInputStyle = {
  background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4,
  color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, padding: '10px 12px', width: '100%',
  WebkitAppearance: 'none', boxSizing: 'border-box',
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
const fdEntryMeta = { fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi };
const fdEntryRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6 };
const fdInlineDeleteBtn = { background: 'transparent', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 6, WebkitTapHighlightColor: 'transparent' };
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
  flexShrink: 0, width: 38, background: 'transparent', border: `1px solid ${UI.hair}`, borderRadius: 6,
  color: UI.inkFaint, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const fdPreset = {
  padding: '8px 12px', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset,
  color: UI.ink, textShadow: 'none', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

window.Screens = window.Screens || {};
Object.assign(window.Screens, { FoodScreen });
