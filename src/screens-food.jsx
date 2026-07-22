/* Food Tracker screen: search Open Food Facts + USDA FoodData Central (via the
   search-foods Edge Function), log a quantity, and roll the result into the
   same daily macro fields the manual Health-tab form already writes. Also
   supports backdating (up to 14 days, same window DailyLogScreen enforces)
   and a "Custom Item" fallback for foods not in either database.

   Food is stored per-entry (store.foodLogs, table zane_food_logs). On every
   add/delete the affected day's summed calories/protein/carbs/fat (and fiber,
   net-carb mode only) are written back into that day's daily log, so the
   Health tab and coaching macros stay in sync from one source of truth, same
   pattern as screens-water.jsx uses for water_ml. */

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

function FoodScreen({ store, setStore, go, userId, date }) {
  const [confirmEl, confirm] = useConfirm();
  const today = LB.todayISO();
  const minDate = fdShiftDate(today, -14);
  const [curDate, setCurDate] = useStateFd(date || today);
  useEffectFd(() => setCurDate(date || today), [date]);

  const [query, setQuery] = useStateFd('');
  const [searching, setSearching] = useStateFd(false);
  const [searchError, setSearchError] = useStateFd(null);
  const [results, setResults] = useStateFd(null); // null = no search run yet

  const [selecting, setSelecting] = useStateFd(null);
  const [qtySheetOpen, setQtySheetOpen] = useStateFd(false);
  const [pendingFood, setPendingFood] = useStateFd(null);
  const [qtyG, setQtyG] = useStateFd('');

  const [customOpen, setCustomOpen] = useStateFd(false);
  const [customName, setCustomName] = useStateFd('');
  const [customG, setCustomG] = useStateFd('');
  const [customCal, setCustomCal] = useStateFd('');
  const [customP, setCustomP] = useStateFd('');
  const [customC, setCustomC] = useStateFd('');
  const [customF, setCustomF] = useStateFd('');
  const [customFib, setCustomFib] = useStateFd('');

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

  // Recent/frequent strip: dedupe by food_id for DB items, by food_name for
  // custom ones. store.foodLogs is already recency-ordered (server query and
  // local prepends both put newest first), so a first-seen walk is enough.
  const recentFoods = useMemoFd(() => {
    const seen = new Set();
    const out = [];
    for (const l of (store.foodLogs || [])) {
      const key = l.foodId || `custom:${l.foodName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(l);
      if (out.length >= 10) break;
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
    const log = existing
      ? { ...existing, calories, protein, carbs, fat, fiber, updatedAt: now }
      : { id: LB.uid(), date: dateStr, weight: null, steps: null, calories, protein, carbs, fat, fiber, waterMl: null, note: null, offPlanNote: null, coachFields: null, adherence: null, targetsSnap: null, updatedAt: now, createdAt: now };
    return [log, ...(s.dailyLogs || []).filter(l => l.id !== log.id && l.date !== dateStr)];
  }

  function commitEntry(entry) {
    setStore(s => {
      const nextLogs = [entry, ...(s.foodLogs || [])];
      return { ...s, foodLogs: nextLogs, dailyLogs: patchDaily(s, entry.date, nextLogs.filter(l => l.date === entry.date)) };
    });
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
    const res = await LB.searchFoods(q);
    setSearching(false);
    if (!res.ok) { setSearchError(res.error || 'Search failed. Try again.'); setResults([]); return; }
    setResults(res.results);
  }

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

  // Reconstructs per-100g rates from a past entry (the log only stores the
  // already-scaled amounts, not per-100g), so a recent DB-sourced item can be
  // relogged at a different quantity without another network round-trip.
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

  function closeQtySheet() { setQtySheetOpen(false); setPendingFood(null); setQtyG(''); }

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
    closeQtySheet();
    commitEntry(entry);
  }

  function resetCustomForm() {
    setCustomName(''); setCustomG(''); setCustomCal(''); setCustomP(''); setCustomC(''); setCustomF(''); setCustomFib('');
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
    setCustomOpen(false);
    commitEntry(entry);
    resetCustomForm();
  }
  const customValid = customName.trim() && fdInt(customCal) != null && fdInt(customP) != null && fdInt(customC) != null && fdInt(customF) != null;

  return (
    <Screen>
      {confirmEl}
      <TopBar title="Food" sub={dayLabel} onBack={() => go({ name: 'health' })} />
      <div style={{ padding: '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)', display: 'flex', flexDirection: 'column', gap: 16 }}>

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

        {/* Search */}
        <div>
          <Bezel style={{ marginBottom: 10 }}>Search</Bezel>
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

        {results != null ? (
          <div>
            <Bezel style={{ marginBottom: 10 }}>Results{results.length ? ` (${results.length})` : ''}</Bezel>
            {results.length === 0 ? (
              <div style={fdEmptyStyle}>No matches. Try a different search or add it manually.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {results.map(r => (
                  <button key={`${r.source}:${r.sourceId}`} onClick={() => pickResult(r)} disabled={selecting === r.sourceId} style={fdResultRow}>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                      {r.brand && <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.brand}</div>}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{r.kcalPer100g != null ? Math.round(r.kcalPer100g) : '—'} kcal</div>
                      <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi }}>/100g · {r.source === 'off' ? 'Open Food Facts' : 'USDA'}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : recentFoods.length > 0 && (
          <div>
            <Bezel style={{ marginBottom: 10 }}>Recent</Bezel>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {recentFoods.map(l => (
                <button key={l.id} onClick={() => reAddFromRecent(l)} style={fdRecentChip}>
                  <div style={fdRecentNameStyle}>{l.foodName}</div>
                  <div style={fdRecentMetaStyle}>{l.calories} kcal</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Entries list */}
        <div>
          <Bezel style={{ marginBottom: 10 }}>{dayLabel} entries ({dayEntries.length})</Bezel>
          {dayEntries.length === 0 ? (
            <div style={fdEmptyStyle}>Nothing logged for this day yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dayEntries.map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="num" style={{ fontSize: 11, color: 'var(--accent)' }}>{e.time}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.foodName}</span>
                    </div>
                    <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>
                      {e.quantityG ? `${e.quantityG}g · ` : ''}{e.calories} kcal · P{Math.round(e.protein)} C{Math.round(e.carbs)} F{Math.round(e.fat)}
                    </span>
                  </div>
                  <button onClick={() => deleteEntry(e)} aria-label="Delete" style={{ background: 'transparent', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 6, WebkitTapHighlightColor: 'transparent' }}>
                    <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={closeQtySheet} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={confirmLogFood} disabled={!qtyPreview} style={{ flex: 2 }}>Add</Btn>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => setCustomOpen(false)} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={submitCustomItem} disabled={!customValid} style={{ flex: 2 }}>Add</Btn>
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
const fdEmptyStyle = { textAlign: 'center', fontSize: 12, color: UI.inkFaint, padding: '18px 0', fontFamily: UI.fontUi };
const fdResultRow = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px',
  background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, textShadow: 'none',
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};
const fdPreset = {
  padding: '8px 12px', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset,
  color: UI.ink, textShadow: 'none', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};
const fdRecentChip = {
  flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px', borderRadius: 6,
  border: `1px solid ${UI.hairStrong}`, background: UI.bgInset, textShadow: 'none', cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent', minWidth: 100, textAlign: 'left',
};
const fdRecentNameStyle = { fontSize: 12, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 };
const fdRecentMetaStyle = { fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontNum };

window.Screens = window.Screens || {};
Object.assign(window.Screens, { FoodScreen });
