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
const fdInt = v => (v === '' || v == null || isNaN(parseInt(v, 10))) ? null : parseInt(v, 10);
const fdRound1 = v => Math.round(v * 10) / 10;

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

  const [tab, setTab] = useStateFd('log');
  const [quickTab, setQuickTab] = useStateFd('recent');
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

  const [qtySheetOpen, setQtySheetOpen] = useStateFd(false);
  const [pendingFood, setPendingFood] = useStateFd(null);
  const [qtyG, setQtyG] = useStateFd('');
  // id of the favorite created from the currently-open sheet, so the star
  // button can toggle it live (add on tap, remove on second tap) instead of
  // deferring the save to when the food is actually logged.
  const [favedId, setFavedId] = useStateFd(null);
  // recipe draft item being edited: finishEntry replaces it in place rather
  // than appending a new ingredient.
  const [editingDraftId, setEditingDraftId] = useStateFd(null);

  const [customOpen, setCustomOpen] = useStateFd(false);
  const [customName, setCustomName] = useStateFd('');
  const [customG, setCustomG] = useStateFd('');
  const [customCal, setCustomCal] = useStateFd('');
  const [customP, setCustomP] = useStateFd('');
  const [customC, setCustomC] = useStateFd('');
  const [customF, setCustomF] = useStateFd('');
  const [customFib, setCustomFib] = useStateFd('');

  // Recipe builder: a lightweight "mode" rather than its own sheet, so it can
  // reuse the Search tab's existing search/quantity/custom flows verbatim as
  // an ingredient picker (finishEntry below is the only branch point). The
  // banner renders on every tab so switching to Log to sanity-check doesn't
  // read as abandoning the draft.
  const [recipeMode, setRecipeMode] = useStateFd(null); // { editId?, name, items: [] }
  const [recipeNameOpen, setRecipeNameOpen] = useStateFd(false);
  const [recipeNameInput, setRecipeNameInput] = useStateFd('');
  const [recipeNameMode, setRecipeNameMode] = useStateFd('new'); // 'new' | 'rename'

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
  // prepends both put newest first), so a first-seen walk is enough.
  const recentFoods = useMemoFd(() => {
    const seen = new Set();
    const out = [];
    for (const l of (store.foodLogs || [])) {
      const key = l.foodId || `custom:${l.foodName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(l);
      if (out.length >= 20) break;
    }
    return out;
  }, [store.foodLogs]);

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

  function commitEntry(entry) {
    setStore(s => {
      const nextLogs = [entry, ...(s.foodLogs || [])];
      return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, entry.date, nextLogs.filter(l => l.date === entry.date)) };
    });
    setPendingHour(null);
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
  function finishEntry(entry) {
    if (recipeMode) {
      if (editingDraftId) {
        const eid = editingDraftId;
        setRecipeMode(m => m ? { ...m, items: m.items.map(i => i.id === eid ? { ...entry, id: eid } : i) } : m);
      } else {
        setRecipeMode(m => ({ ...m, items: [...m.items, entry] }));
      }
    } else {
      commitEntry(entry);
    }
  }

  async function deleteEntry(entry) {
    const ok = await confirm(`${entry.foodName} · ${entry.calories} kcal`, { title: 'Delete entry?', ok: 'Delete', cancel: 'Cancel', danger: true });
    if (!ok) return;
    setStore(s => {
      const nextLogs = (s.foodLogs || []).filter(l => l.id !== entry.id);
      return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, entry.date, nextLogs.filter(l => l.date === entry.date)) };
    });
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
    setQtySheetOpen(true);
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
        kcalPer100g: l.calories * per100, proteinPer100g: l.protein * per100,
        carbsPer100g: l.carbs * per100, fatPer100g: l.fat * per100,
        fiberPer100g: l.fiber != null ? l.fiber * per100 : null,
        servingSizeG: null, servingLabel: null,
        // Already in the log (so already cached): don't re-cache it on re-log.
        fromCache: true,
      });
      setQtyG(String(l.quantityG || 100));
      setQtySheetOpen(true);
    } else {
      setCustomName(l.foodName);
      setCustomG(l.quantityG ? String(l.quantityG) : '');
      setCustomCal(String(l.calories ?? ''));
      setCustomP(String(l.protein ?? ''));
      setCustomC(String(l.carbs ?? ''));
      setCustomF(String(l.fat ?? ''));
      setCustomFib(l.fiber != null ? String(l.fiber) : '');
      setCustomOpen(true);
    }
  }

  const qtyPreview = useMemoFd(() => {
    if (!pendingFood) return null;
    const qty = fdInt(qtyG);
    if (!qty || qty <= 0) return null;
    const factor = qty / 100;
    return {
      calories: Math.round((pendingFood.kcalPer100g || 0) * factor),
      protein: fdRound1((pendingFood.proteinPer100g || 0) * factor),
      carbs: fdRound1((pendingFood.carbsPer100g || 0) * factor),
      fat: fdRound1((pendingFood.fatPer100g || 0) * factor),
      fiber: pendingFood.fiberPer100g != null ? fdRound1(pendingFood.fiberPer100g * factor) : null,
    };
  }, [pendingFood, qtyG]);

  function closeQtySheet() { setQtySheetOpen(false); setPendingFood(null); setQtyG(''); setFavedId(null); setEditingDraftId(null); }
  function closeCustomSheet() { setCustomOpen(false); setFavedId(null); setEditingDraftId(null); }

  // Build the entry the open sheet describes right now (without logging it), so
  // both the log/ingredient action and the favorite toggle work off the same
  // data. Returns null while the form is incomplete.
  function buildQtyEntry() {
    if (!pendingFood || !qtyPreview) return null;
    return {
      id: LB.uid(), date: curDate, time: entryTime(),
      foodId: `${pendingFood.source}:${pendingFood.sourceId}`,
      foodName: pendingFood.name, brand: pendingFood.brand || null, source: pendingFood.source,
      quantityG: fdInt(qtyG), calories: qtyPreview.calories, protein: qtyPreview.protein,
      carbs: qtyPreview.carbs, fat: qtyPreview.fat, fiber: qtyPreview.fiber,
      createdAt: new Date().toISOString(),
    };
  }
  function buildCustomEntry() {
    const name = customName.trim();
    const cal = fdInt(customCal), p = fdInt(customP), c = fdInt(customC), f = fdInt(customF);
    if (!name || cal == null || p == null || c == null || f == null) return null;
    return {
      id: LB.uid(), date: curDate, time: entryTime(),
      foodId: null, foodName: name, brand: null, source: 'custom',
      quantityG: fdInt(customG) || 100, calories: cal, protein: p, carbs: c, fat: f,
      fiber: customFib !== '' ? fdInt(customFib) : null,
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
    }
  }
  function removeFavorite(fav) {
    setStore(s => ({ ...s, foodFavorites: (s.foodFavorites || []).filter(f => f.id !== fav.id) }));
  }

  function confirmLogFood() {
    const entry = buildQtyEntry();
    if (!entry) return;
    finishEntry(entry);
    // Only now (a real log, not a mere open) grow the shared cache, and only
    // for a freshly-fetched DB food that wasn't already cached. Not while
    // building a recipe (ingredients aren't standalone logs).
    if (!recipeMode && entry.foodId && pendingFood && !pendingFood.fromCache) {
      LB.cacheFood(pendingFood.source, pendingFood.sourceId);
    }
    closeQtySheet();
  }

  function resetCustomForm() {
    setCustomName(''); setCustomG(''); setCustomCal(''); setCustomP(''); setCustomC(''); setCustomF(''); setCustomFib('');
    setFavedId(null); setEditingDraftId(null);
  }

  function submitCustomItem() {
    const entry = buildCustomEntry();
    if (!entry) return;
    finishEntry(entry);
    closeCustomSheet();
    resetCustomForm();
  }
  const customValid = customName.trim() && fdInt(customCal) != null && fdInt(customP) != null && fdInt(customC) != null && fdInt(customF) != null;

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
        kcalPer100g: item.calories * per100, proteinPer100g: item.protein * per100,
        carbsPer100g: item.carbs * per100, fatPer100g: item.fat * per100,
        fiberPer100g: item.fiber != null ? item.fiber * per100 : null,
        servingSizeG: null, servingLabel: null, fromCache: true,
      });
      setQtyG(String(item.quantityG || 100));
      setQtySheetOpen(true);
    } else {
      setCustomName(item.foodName);
      setCustomG(item.quantityG ? String(item.quantityG) : '');
      setCustomCal(String(item.calories ?? ''));
      setCustomP(String(item.protein ?? ''));
      setCustomC(String(item.carbs ?? ''));
      setCustomF(String(item.fat ?? ''));
      setCustomFib(item.fiber != null ? String(item.fiber) : '');
      setCustomOpen(true);
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
  // Recipes log as ONE entry (the sum of their ingredients), not N, and at a
  // fixed amount, no scaling: the whole point is "log this exact thing I eat
  // the same way every time" in a single tap.
  function addRecipeToLog(recipe) {
    const items = recipe.items || [];
    if (!items.length) return;
    const sum = k => items.reduce((a, i) => a + (i[k] || 0), 0);
    const entry = {
      id: LB.uid(), date: curDate, time: entryTime(),
      foodId: null, foodName: recipe.name, brand: null, source: 'recipe',
      quantityG: Math.round(sum('quantityG')), calories: Math.round(sum('calories')),
      protein: fdRound1(sum('protein')), carbs: fdRound1(sum('carbs')), fat: fdRound1(sum('fat')),
      fiber: items.some(i => i.fiber != null) ? fdRound1(sum('fiber')) : null,
      createdAt: new Date().toISOString(),
    };
    commitEntry(entry);
  }

  const recipeDraftTotals = useMemoFd(() => {
    if (!recipeMode) return { calories: 0, protein: 0, carbs: 0, fat: 0 };
    const sum = k => recipeMode.items.reduce((a, i) => a + (i[k] || 0), 0);
    return { calories: Math.round(sum('calories')), protein: Math.round(sum('protein')), carbs: Math.round(sum('carbs')), fat: Math.round(sum('fat')) };
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
        right={tab === 'quickadd' && quickTab === 'recipes' && !recipeMode && (store.foodRecipes || []).length > 0 ? (
          <button onClick={openNewRecipe} aria-label="New recipe" style={fdTopAddBtn}>
            <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
          </button>
        ) : undefined} />

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
                      <span style={fdEntryMeta}>{i.quantityG}g · {i.calories} kcal · P{Math.round(i.protein)} C{Math.round(i.carbs)} F{Math.round(i.fat)}</span>
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

            {/* Totals hero */}
            <Card style={{ padding: 16 }}>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>{dayLabel} total</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className="num" style={{ fontSize: 32, fontWeight: 300, color: UI.ink }}>{dayTotals.calories}</span>
                <span style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi }}>kcal</span>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>P</span> {Math.round(dayTotals.protein)}g</span>
                <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>C</span> {Math.round(dayTotals.carbs)}g</span>
                <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 10 }}>F</span> {Math.round(dayTotals.fat)}g</span>
              </div>
            </Card>

            {/* Hourly timeline: every hour 0-23 has a "+" that logs at exactly
                that hour, with its entries listed underneath. */}
            <div>
              <Bezel style={{ marginBottom: 10 }}>Timeline</Bezel>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {FD_HOURS.map(h => {
                  const es = byHour[h] || [];
                  const filled = es.length > 0;
                  return (
                    <div key={h} style={fdHourRow(filled)}>
                      <div style={fdHourLabelCol}>
                        <span className="num" style={{ fontSize: 11, color: filled ? UI.inkSoft : UI.inkGhost }}>{String(h).padStart(2, '0')}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: filled ? 6 : 0 }}>
                        {es.map(e => (
                          <div key={e.id} style={fdEntryRow}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                <span className="num" style={{ fontSize: 10, color: 'var(--accent)' }}>{e.time}</span>
                                <span style={fdEntryName}>{e.foodName}</span>
                              </div>
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
                      <button onClick={() => addAtHour(h)} aria-label={`Add food at ${String(h).padStart(2, '0')}:00`} style={fdHourAddBtn}>
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
                  Searches only foods already verified in Zane's own database, instant, no external lookup.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
                  type="text" placeholder="Search food or scan a barcode…" style={fdInputStyle} />
                <button onClick={() => setScanOpen(true)} aria-label="Scan barcode" style={fdSearchBtn}>
                  <i className="fa-solid fa-barcode" style={{ fontSize: 14 }} />
                </button>
                <button onClick={() => runSearch()} disabled={searching || !query.trim()} aria-label="Search" style={fdSearchBtn}>
                  {searching ? <span style={{ fontFamily: UI.fontUi, fontSize: 11 }}>…</span> : <i className="fa-solid fa-magnifying-glass" style={{ fontSize: 13 }} />}
                </button>
              </div>
              <button onClick={() => { resetCustomForm(); setCustomOpen(true); }} style={fdLinkBtn}>
                Can't find it? Add manually
              </button>
            </div>

            {searchError && <div style={{ fontSize: 11, color: 'var(--danger)', fontFamily: UI.fontUi }}>{searchError}</div>}

            {results != null && (
              <div>
                <Bezel style={{ marginBottom: 10 }}>Results{results.length ? ` (${results.length})` : ''}</Bezel>
                {results.length === 0 ? (
                  <div style={fdEmptyStyle}>No matches. Try a different search or add it manually.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {results.map(r => (
                      <button key={`${r.source}:${r.sourceId}`} onClick={() => pickResult(r)} style={fdResultRow}>
                        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            {r.cached && <i className="fa-solid fa-circle-check" style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }} title="Already verified and cached" />}
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
              </div>
            )}
          </>
        )}

        {tab === 'quickadd' && (
          <>
            {pendingHourBanner}
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}` }}>
              {FD_QUICK_TABS.map(t => (
                <button key={t.id} onClick={() => setQuickTab(t.id)} style={fdSegBtn(quickTab === t.id)}>{t.label}</button>
              ))}
            </div>

            {quickTab === 'recent' && (
              recentFoods.length === 0 ? (
                <div style={fdEmptyStyle}>Nothing logged yet. Foods you add show up here.</div>
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
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(store.foodFavorites || []).map(f => (
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
              ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(store.foodRecipes || []).map(r => {
                      const items = r.items || [];
                      const kcal = Math.round(items.reduce((a, i) => a + (i.calories || 0), 0));
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
            <Field label="Amount (g)" style={{ marginBottom: 14 }}>
              <input value={qtyG} onChange={e => setQtyG(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder="g" autoFocus style={fdBigInput} />
            </Field>
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
              <button onClick={() => toggleFavorite(buildQtyEntry())} disabled={!qtyPreview} style={fdFavBtn(!!favedId, !qtyPreview)}>
                <i className={`fa-${favedId ? 'solid' : 'regular'} fa-star`} style={{ fontSize: 14, color: favedId ? UI.gold : UI.inkSoft }} />
                {favedId ? 'Saved to favorites' : 'Save as favorite'}
              </button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={closeQtySheet} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={confirmLogFood} disabled={!qtyPreview} style={{ flex: 2 }}>{recipeMode ? (editingDraftId ? 'Update ingredient' : 'Add ingredient') : 'Add'}</Btn>
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
            <input value={customG} onChange={e => setCustomG(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder="g" style={fdInputStyle} />
          </Field>
          <Field label="Calories (kcal)" style={{ flex: 1 }}>
            <input value={customCal} onChange={e => setCustomCal(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder="kcal" style={fdInputStyle} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Field label="Protein (g)" style={{ flex: 1 }}>
            <input value={customP} onChange={e => setCustomP(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder="g" style={fdInputStyle} />
          </Field>
          <Field label="Carbs (g)" style={{ flex: 1 }}>
            <input value={customC} onChange={e => setCustomC(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder="g" style={fdInputStyle} />
          </Field>
          <Field label="Fat (g)" style={{ flex: 1 }}>
            <input value={customF} onChange={e => setCustomF(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder="g" style={fdInputStyle} />
          </Field>
        </div>
        <Field label="Fiber (g, optional)" style={{ marginBottom: 16 }}>
          <input value={customFib} onChange={e => setCustomFib(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder="g" style={fdInputStyle} />
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

      {scanOpen && <FdScanner onClose={() => setScanOpen(false)} onDetect={handleScan} />}
    </Screen>
  );
}

// Live-camera barcode scanner using the native BarcodeDetector API (no
// dependency). Works where the API is available (Chrome / Android). Where it
// isn't (notably iOS Safari) it shows a clear fallback pointing to manual
// barcode entry, which the search box already handles. Owns the camera stream
// and detection loop, and tears both down on unmount.
function FdScanner({ onClose, onDetect }) {
  const videoRef = useRefFd(null);
  const [status, setStatus] = useStateFd('init'); // 'init' | 'scanning' | 'unsupported' | 'error'
  useEffectFd(() => {
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) { setStatus('unsupported'); return; }
    let detector;
    try { detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] }); }
    catch (_) { setStatus('unsupported'); return; }
    let stream = null, timer = null, cancelled = false, busy = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = videoRef.current;
        if (v) { v.srcObject = stream; await v.play().catch(() => {}); }
        setStatus('scanning');
        timer = setInterval(async () => {
          if (busy || cancelled || !videoRef.current) return;
          busy = true;
          try {
            const codes = await detector.detect(videoRef.current);
            const raw = codes && codes[0] && codes[0].rawValue ? String(codes[0].rawValue).replace(/\D/g, '') : '';
            if (/^\d{8,14}$/.test(raw)) { cancelled = true; clearInterval(timer); onDetect(raw); }
          } catch (_) {}
          busy = false;
        }, 250);
      } catch (_) {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; if (timer) clearInterval(timer); if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, []); // eslint-disable-line

  const fallback = status === 'unsupported' || status === 'error';
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#000', display: 'flex', flexDirection: 'column', animation: 'sheet-up 0.22s ease' }}>
      <div style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 18px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1, color: '#fff', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600 }}>Scan barcode</span>
        <button onClick={onClose} aria-label="Close scanner" style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 34, height: 34, borderRadius: 4, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {fallback ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32, textAlign: 'center' }}>
            <i className="fa-solid fa-barcode" style={{ fontSize: 34, color: 'rgba(255,255,255,0.45)' }} />
            <div style={{ color: '#fff', fontFamily: UI.fontUi, fontSize: 13, lineHeight: 1.5, maxWidth: 300 }}>
              {status === 'unsupported'
                ? "This browser can't scan barcodes. Type the barcode number into the search box instead, it looks it up the same way."
                : 'Could not open the camera. Check the camera permission, or type the barcode number into search.'}
            </div>
            <button onClick={onClose} style={{ marginTop: 4, background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', borderRadius: 6, padding: '11px 22px', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer' }}>Got it</button>
          </div>
        ) : (
          <>
            <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ width: '74%', maxWidth: 320, height: 150, border: '2px solid rgba(255,255,255,0.85)', borderRadius: 8, boxShadow: '0 0 0 100vmax rgba(0,0,0,0.45)' }} />
            </div>
            <div style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)', left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.85)', fontFamily: UI.fontUi, fontSize: 12 }}>
              {status === 'scanning' ? 'Point the camera at a barcode' : 'Starting camera…'}
            </div>
          </>
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
const fdBigInput = { ...fdInputStyle, fontFamily: UI.fontNum, fontSize: 22, padding: '12px 14px' };
const fdSearchBtn = {
  width: 42, height: 42, borderRadius: 4, border: `1px solid ${UI.hairStrong}`,
  background: UI.bgInset, color: UI.inkSoft, cursor: 'pointer', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
};
const fdLinkBtn = {
  marginTop: 8, background: 'none', border: 'none', padding: '4px 0', color: 'var(--accent)',
  fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
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
// Timeline: an hour tick column, its entries, and an always-present add button.
// Empty hours stay slim; hours with entries grow to fit them. The left column
// carries a hairline "spine" so the 24 rows read as one continuous axis.
function fdHourRow(filled) {
  return {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    borderTop: `var(--hair-width) solid ${UI.hair}`,
    paddingTop: filled ? 8 : 0, minHeight: 34,
  };
}
const fdHourLabelCol = { width: 24, flexShrink: 0, paddingTop: 9, textAlign: 'right' };
const fdHourAddBtn = {
  flexShrink: 0, width: 30, height: 30, marginTop: 4, borderRadius: 4,
  border: `1px solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkSoft,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
};
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
