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

const { useState: useStateFd, useEffect: useEffectFd, useMemo: useMemoFd } = React;

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
  { id: 'off', label: 'Open Food Facts' },
  { id: 'usda', label: 'USDA' },
];
const FD_QUICK_TABS = [
  { id: 'recent', label: 'Recent' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'recipes', label: 'Recipes' },
];

function FoodScreen({ store, setStore, go, userId, date }) {
  const [confirmEl, confirm] = useConfirm();
  const today = LB.todayISO();
  const minDate = fdShiftDate(today, -14);
  const [curDate, setCurDate] = useStateFd(date || today);
  useEffectFd(() => setCurDate(date || today), [date]);

  const [tab, setTab] = useStateFd('log');
  const [quickTab, setQuickTab] = useStateFd('recent');

  const [sourceFilter, setSourceFilter] = useStateFd(null); // null = all
  const [query, setQuery] = useStateFd('');
  const [searching, setSearching] = useStateFd(false);
  const [searchError, setSearchError] = useStateFd(null);
  const [results, setResults] = useStateFd(null); // null = no search run yet

  const [selecting, setSelecting] = useStateFd(null);
  const [qtySheetOpen, setQtySheetOpen] = useStateFd(false);
  const [pendingFood, setPendingFood] = useStateFd(null);
  const [qtyG, setQtyG] = useStateFd('');
  const [saveFav, setSaveFav] = useStateFd(false);

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
  const [recipeMode, setRecipeMode] = useStateFd(null); // { name, items: [] }
  const [recipeNameOpen, setRecipeNameOpen] = useStateFd(false);
  const [recipeNameInput, setRecipeNameInput] = useStateFd('');

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
  }

  // Terminal step shared by the search-selected and custom-item flows: either
  // commits straight to the day's log, or (while building a recipe) appends
  // to the draft ingredient list instead.
  function finishEntry(entry) {
    if (recipeMode) setRecipeMode(m => ({ ...m, items: [...m.items, entry] }));
    else commitEntry(entry);
  }

  async function deleteEntry(entry) {
    const ok = await confirm(`${entry.foodName} · ${entry.calories} kcal`, { title: 'Delete entry?', ok: 'Delete', cancel: 'Cancel', danger: true });
    if (!ok) return;
    setStore(s => {
      const nextLogs = (s.foodLogs || []).filter(l => l.id !== entry.id);
      return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, entry.date, nextLogs.filter(l => l.date === entry.date)) };
    });
  }

  async function runSearch() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true); setSearchError(null);
    const res = await LB.searchFoods(q, sourceFilter);
    setSearching(false);
    if (!res.ok) { setSearchError(res.error || 'Search failed. Try again.'); setResults([]); return; }
    setResults(res.results);
  }
  // Switching the source filter re-runs the last submitted query automatically
  // (a query is already an explicit user action, not the "hammer the API on
  // every keystroke" case submit-triggered search is guarding against).
  useEffectFd(() => {
    if (results != null && query.trim()) runSearch();
  }, [sourceFilter]); // eslint-disable-line

  async function pickResult(r) {
    if (selecting) return;
    setSelecting(r.sourceId);
    const res = await LB.selectFood(r.source, r.sourceId);
    setSelecting(null);
    if (!res.ok || !res.food) {
      await confirm(res.error || 'Could not load this food. Try again.', { title: 'Lookup failed', ok: 'OK', cancel: null });
      return;
    }
    setPendingFood(res.food);
    setQtyG(res.food.servingSizeG ? String(Math.round(res.food.servingSizeG)) : '100');
    setQtySheetOpen(true);
  }

  // Reconstructs per-100g rates from a past entry (the log/favorite only
  // stores the already-scaled amounts, not per-100g), so a recent or
  // favorited DB-sourced item can be relogged at a different quantity
  // without another network round-trip. Recent (foodLogs) and Favorites
  // share this exact shape, so one function serves both strips.
  function reAddFromRecent(l) {
    if (l.foodId) {
      const per100 = l.quantityG > 0 ? 100 / l.quantityG : 1;
      setPendingFood({
        source: l.source, sourceId: l.foodId.slice((l.source || '').length + 1),
        name: l.foodName, brand: l.brand || null,
        kcalPer100g: l.calories * per100, proteinPer100g: l.protein * per100,
        carbsPer100g: l.carbs * per100, fatPer100g: l.fat * per100,
        fiberPer100g: l.fiber != null ? l.fiber * per100 : null,
        servingSizeG: null, servingLabel: null,
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

  function closeQtySheet() { setQtySheetOpen(false); setPendingFood(null); setQtyG(''); setSaveFav(false); }

  function addFavorite(entry) {
    const fav = {
      id: LB.uid(), foodId: entry.foodId, foodName: entry.foodName, brand: entry.brand,
      source: entry.source, quantityG: entry.quantityG, calories: entry.calories,
      protein: entry.protein, carbs: entry.carbs, fat: entry.fat, fiber: entry.fiber,
      createdAt: new Date().toISOString(),
    };
    setStore(s => ({ ...s, foodFavorites: [fav, ...(s.foodFavorites || [])] }));
  }
  function removeFavorite(fav) {
    setStore(s => ({ ...s, foodFavorites: (s.foodFavorites || []).filter(f => f.id !== fav.id) }));
  }

  function confirmLogFood() {
    if (!pendingFood || !qtyPreview) return;
    const entry = {
      id: LB.uid(), date: curDate, time: fdNowHHMM(),
      foodId: `${pendingFood.source}:${pendingFood.sourceId}`,
      foodName: pendingFood.name, brand: pendingFood.brand || null, source: pendingFood.source,
      quantityG: fdInt(qtyG), calories: qtyPreview.calories, protein: qtyPreview.protein,
      carbs: qtyPreview.carbs, fat: qtyPreview.fat, fiber: qtyPreview.fiber,
      createdAt: new Date().toISOString(),
    };
    if (saveFav) addFavorite(entry);
    closeQtySheet();
    finishEntry(entry);
  }

  function resetCustomForm() {
    setCustomName(''); setCustomG(''); setCustomCal(''); setCustomP(''); setCustomC(''); setCustomF(''); setCustomFib(''); setSaveFav(false);
  }

  function submitCustomItem() {
    const name = customName.trim();
    const cal = fdInt(customCal), p = fdInt(customP), c = fdInt(customC), f = fdInt(customF);
    if (!name || cal == null || p == null || c == null || f == null) return;
    const entry = {
      id: LB.uid(), date: curDate, time: fdNowHHMM(),
      foodId: null, foodName: name, brand: null, source: 'custom',
      quantityG: fdInt(customG) || 100, calories: cal, protein: p, carbs: c, fat: f,
      fiber: customFib !== '' ? fdInt(customFib) : null,
      createdAt: new Date().toISOString(),
    };
    if (saveFav) addFavorite(entry);
    setCustomOpen(false);
    finishEntry(entry);
    resetCustomForm();
  }
  const customValid = customName.trim() && fdInt(customCal) != null && fdInt(customP) != null && fdInt(customC) != null && fdInt(customF) != null;

  // ── Recipes ──
  function openNewRecipe() { setRecipeNameInput(''); setRecipeNameOpen(true); }
  function startRecipe() {
    const name = recipeNameInput.trim();
    if (!name) return;
    setRecipeNameOpen(false);
    setRecipeMode({ name, items: [] });
    setTab('search');
  }
  function removeRecipeDraftItem(id) {
    setRecipeMode(m => m ? { ...m, items: m.items.filter(i => i.id !== id) } : m);
  }
  function cancelRecipe() { setRecipeMode(null); }
  function saveRecipe() {
    if (!recipeMode || !recipeMode.items.length) { setRecipeMode(null); return; }
    const recipe = {
      id: LB.uid(), name: recipeMode.name,
      items: recipeMode.items.map(i => ({
        foodId: i.foodId, foodName: i.foodName, brand: i.brand, source: i.source,
        quantityG: i.quantityG, calories: i.calories, protein: i.protein, carbs: i.carbs, fat: i.fat, fiber: i.fiber,
      })),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setStore(s => ({ ...s, foodRecipes: [recipe, ...(s.foodRecipes || [])] }));
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
      id: LB.uid(), date: curDate, time: fdNowHHMM(),
      foodId: null, foodName: recipe.name, brand: null, source: 'recipe',
      quantityG: Math.round(sum('quantityG')), calories: Math.round(sum('calories')),
      protein: fdRound1(sum('protein')), carbs: fdRound1(sum('carbs')), fat: fdRound1(sum('fat')),
      fiber: items.some(i => i.fiber != null) ? fdRound1(sum('fiber')) : null,
      createdAt: new Date().toISOString(),
    };
    commitEntry(entry);
  }

  const recipeDraftKcal = useMemoFd(
    () => recipeMode ? Math.round(recipeMode.items.reduce((a, i) => a + (i.calories || 0), 0)) : 0,
    [recipeMode],
  );

  return (
    <Screen>
      {confirmEl}
      <TopBar title="Food" sub={dayLabel} onBack={() => go({ name: 'health' })} />

      <div style={fdTabBarStyle}>
        {FD_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={fdTabBtn(tab === t.id)}>
            <i className={`fa-solid ${t.icon}`} style={{ fontSize: 13 }} />
            {t.label}
          </button>
        ))}
      </div>

      {recipeMode && (
        <div style={fdRecipeBanner}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Building: {recipeMode.name}</div>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{recipeMode.items.length} ingredient{recipeMode.items.length === 1 ? '' : 's'}{recipeMode.items.length ? ` · ${recipeDraftKcal} kcal` : ''}</div>
          </div>
          <button onClick={cancelRecipe} style={fdBannerBtn}>Cancel</button>
          <button onClick={saveRecipe} disabled={!recipeMode.items.length} style={{ ...fdBannerBtn, color: recipeMode.items.length ? 'var(--accent)' : UI.inkGhost, fontWeight: 700 }}>Done</button>
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

            {/* Entries list */}
            <div>
              <Bezel style={{ marginBottom: 10 }}>{dayLabel} entries ({dayEntries.length})</Bezel>
              {dayEntries.length === 0 ? (
                <div style={fdEmptyStyle}>Nothing logged for this day yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {dayEntries.map(e => (
                    <div key={e.id} style={fdEntryRow}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span className="num" style={{ fontSize: 11, color: 'var(--accent)' }}>{e.time}</span>
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
              )}
            </div>
          </>
        )}

        {tab === 'search' && (
          <>
            {recipeMode && recipeMode.items.length > 0 && (
              <div>
                <Bezel style={{ marginBottom: 10 }}>Added so far</Bezel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recipeMode.items.map(i => (
                    <div key={i.id} style={fdEntryRow}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={fdEntryName}>{i.foodName}</div>
                        <div style={fdEntryMeta}>{i.quantityG}g · {i.calories} kcal</div>
                      </div>
                      <button onClick={() => removeRecipeDraftItem(i.id)} aria-label="Remove" style={fdInlineDeleteBtn}>
                        <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Bezel style={{ marginBottom: 10 }}>Search</Bezel>
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, marginBottom: 10 }}>
                {FD_SOURCE_FILTERS.map(f => (
                  <button key={f.label} onClick={() => setSourceFilter(f.id)} style={fdSegBtn(sourceFilter === f.id)}>{f.label}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
                  type="text" placeholder="Search food or scan a barcode…" style={fdInputStyle} />
                <button onClick={runSearch} disabled={searching || !query.trim()} aria-label="Search" style={fdSearchBtn}>
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
                      <button key={`${r.source}:${r.sourceId}`} onClick={() => pickResult(r)} disabled={selecting === r.sourceId} style={fdResultRow}>
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
              <>
                <button onClick={openNewRecipe} style={fdLinkBtn}>+ New recipe</button>
                {(store.foodRecipes || []).length === 0 ? (
                  <div style={fdEmptyStyle}>No recipes yet. Build one from a few ingredients you log together often.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {(store.foodRecipes || []).map(r => {
                      const items = r.items || [];
                      const kcal = Math.round(items.reduce((a, i) => a + (i.calories || 0), 0));
                      return (
                        <div key={r.id} style={fdQuickRowWrap}>
                          <button onClick={() => addRecipeToLog(r)} style={fdQuickRowInner}>
                            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                              <div style={fdEntryName}>{r.name}</div>
                              <div style={fdEntryMeta}>{items.length} ingredient{items.length === 1 ? '' : 's'}</div>
                            </div>
                            <div className="num" style={{ fontSize: 12, color: UI.inkSoft, flexShrink: 0 }}>{kcal} kcal</div>
                          </button>
                          <button onClick={() => deleteRecipe(r)} aria-label="Delete recipe" style={fdSideBtn}>
                            <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
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
              <button onClick={() => setSaveFav(v => !v)} style={fdFavToggle}>
                <i className="fa-solid fa-star" style={{ fontSize: 13, color: saveFav ? UI.gold : UI.inkGhost }} />
                <span style={{ fontSize: 11, color: saveFav ? UI.ink : UI.inkFaint, fontFamily: UI.fontUi }}>Save as favorite</span>
              </button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={closeQtySheet} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={confirmLogFood} disabled={!qtyPreview} style={{ flex: 2 }}>{recipeMode ? 'Add ingredient' : 'Add'}</Btn>
            </div>
          </>
        )}
      </Sheet>

      {/* ── Custom item sheet ── */}
      <Sheet open={customOpen} onClose={() => setCustomOpen(false)} title="Custom item" titleColor="var(--accent)">
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
          <button onClick={() => setSaveFav(v => !v)} style={fdFavToggle}>
            <i className="fa-solid fa-star" style={{ fontSize: 13, color: saveFav ? UI.gold : UI.inkGhost }} />
            <span style={{ fontSize: 11, color: saveFav ? UI.ink : UI.inkFaint, fontFamily: UI.fontUi }}>Save as favorite</span>
          </button>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => setCustomOpen(false)} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={submitCustomItem} disabled={!customValid} style={{ flex: 2 }}>{recipeMode ? 'Add ingredient' : 'Add'}</Btn>
        </div>
      </Sheet>

      {/* ── New recipe name sheet ── */}
      <Sheet open={recipeNameOpen} onClose={() => setRecipeNameOpen(false)} title="New recipe" titleColor="var(--accent)">
        <Field label="Name" style={{ marginBottom: 16 }}>
          <TextInput value={recipeNameInput} onChange={setRecipeNameInput} placeholder="e.g. Breakfast bowl" autoFocus />
        </Field>
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.5 }}>
          Next you'll search and add each ingredient with its usual amount. Once saved, the whole recipe logs in one tap.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => setRecipeNameOpen(false)} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={startRecipe} disabled={!recipeNameInput.trim()} style={{ flex: 2 }}>Start adding ingredients</Btn>
        </div>
      </Sheet>
    </Screen>
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
function fdTabBtn(active) {
  return {
    flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer', background: 'transparent',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    color: active ? 'var(--accent)' : UI.inkFaint,
    fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
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
const fdTabBarStyle = { display: 'flex', borderBottom: `1px solid ${UI.hairStrong}` };
const fdRecipeBanner = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 22px',
  background: 'rgba(var(--accent-rgb),0.1)', borderBottom: `1px solid rgba(var(--accent-rgb),0.3)`,
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
const fdFavToggle = {
  display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
  padding: '4px 0 14px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};
const fdEmptyStyle = { textAlign: 'center', fontSize: 12, color: UI.inkFaint, padding: '18px 0', fontFamily: UI.fontUi };
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
