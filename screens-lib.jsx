/* Library + History + Session detail + Settings */

const { useState: useStateL, useMemo: useMemoL, useRef: useRefL, useEffect: useEffectL } = React;

// Persists library filter state across navigation (survives remounts)
const _lib = { tab: 'recent', q: '', filterTags: [], filterRestCats: [], filterUnilateral: null, filterPlan: null, filtersOpen: false };

// ─── LIBRARY ──────────────────────────────────────────────────────────
function LibraryScreen({ store, setStore, go }) {
  const [confirmEl, confirm] = useConfirm();
  const [tab, setTab] = useStateL(_lib.tab);
  const [q, setQ] = useStateL(_lib.q);
  const [creating, setCreating] = useStateL(false);
  const [selecting, setSelecting] = useStateL(false);
  const [selected, setSelected] = useStateL(new Set());
  const [filterTags, setFilterTags] = useStateL(_lib.filterTags);
  const [filterRestCats, setFilterRestCats] = useStateL(_lib.filterRestCats);
  const [filterUnilateral, setFilterUnilateral] = useStateL(_lib.filterUnilateral);
  const toggleFilter = (m) => setFilterTags(t => { const n = t.includes(m) ? t.filter(x => x !== m) : [...t, m]; _lib.filterTags = n; return n; });
  const toggleRestCat = (v) => setFilterRestCats(t => { const n = t.includes(v) ? t.filter(x => x !== v) : [...t, v]; _lib.filterRestCats = n; return n; });
  const toggleUni = (v) => { const n = filterUnilateral === v ? null : v; _lib.filterUnilateral = n; setFilterUnilateral(n); };
  const [filterPlan, setFilterPlan] = useStateL(_lib.filterPlan);
  const togglePlan = (v) => { const n = filterPlan === v ? null : v; _lib.filterPlan = n; setFilterPlan(n); };
  const [filtersOpen, setFiltersOpen] = useStateL(_lib.filtersOpen);
  useEffectL(() => { _lib.filtersOpen = filtersOpen; }, [filtersOpen]);

  const planExIds = useMemoL(() => new Set(
    store.schedules.flatMap(s => s.days.flatMap(d => (d.items || []).map(it => it.exId)))
  ), [store.schedules]);

  useEffectL(() => { _lib.tab = tab; }, [tab]);
  useEffectL(() => { _lib.q = q; }, [q]);

  const exitSelect = () => { setSelecting(false); setSelected(new Set()); };

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const deleteSelected = async () => {
    if (!await confirm(`Previous sessions will be preserved.`, { title: `Delete ${selected.size} exercise${selected.size > 1 ? 's' : ''}?`, ok: 'Delete', danger: true })) return;
    setStore(s => ({ ...s, exercises: s.exercises.filter(e => !selected.has(e.id)) }));
    exitSelect();
  };

  const recent = useMemoL(() => {
    const sortedSessions = [...store.sessions].filter(s => s.ended).sort((a,b) => (b.ended||'').localeCompare(a.ended||''));
    const lastTwo = new Map();
    const seenFirst = new Map();
    sortedSessions.forEach(s => {
      s.entries.forEach(e => {
        const arr = lastTwo.get(e.exId) || [];
        if (arr.length < 2) {
          lastTwo.set(e.exId, [...arr, s]);
          if (arr.length === 0) seenFirst.set(e.exId, s.ended);
        }
      });
    });
    const e1rm = (entry) => entry
      ? Math.max(0, ...(entry.sets || []).filter(s => s.kg && s.reps).map(s => s.kg * (1 + s.reps / 30)), 0)
      : 0;
    return store.exercises
      .filter(e => seenFirst.has(e.id))
      .sort((a,b) => (seenFirst.get(b.id)||'').localeCompare(seenFirst.get(a.id)||''))
      .slice(0, 12)
      .map(e => {
        const [sess0, sess1] = lastTwo.get(e.id) || [];
        const lastEntry = sess0?.entries.find(en => en.exId === e.id);
        const prevEntry = sess1?.entries.find(en => en.exId === e.id);
        const cur = e1rm(lastEntry), prev = e1rm(prevEntry);
        const trend = cur > 0 && prev > 0
          ? cur > prev * 1.005 ? 'up' : cur < prev * 0.995 ? 'down' : 'same'
          : null;
        return { ex: e, last: seenFirst.get(e.id), lastEntry, trend };
      });
  }, [store.exercises, store.sessions]);

  const filtered = useMemoL(() => {
    const ql = q.toUpperCase();
    return store.exercises
      .filter(e => {
        const matchSearch = !q || e.name.toUpperCase().includes(ql) || e.tags?.some(t => t.toUpperCase().includes(ql));
        const matchTags = filterTags.length === 0 || filterTags.some(ft => e.tags?.includes(ft));
        const matchRest = filterRestCats.length === 0 ||
          (filterRestCats.includes('none') && !e.category) ||
          (e.category && filterRestCats.includes(e.category));
        const matchUnilateral = filterUnilateral === null || !!e.unilateral === filterUnilateral;
        const matchPlan = filterPlan === null || (filterPlan === 'in' ? planExIds.has(e.id) : !planExIds.has(e.id));
        return matchSearch && matchTags && matchRest && matchUnilateral && matchPlan;
      })
      .sort((a,b) => a.name.localeCompare(b.name));
  }, [store.exercises, q, filterTags, filterRestCats, filterUnilateral, filterPlan, planExIds]);

  const topBarRight = selecting ? (
    <button onClick={exitSelect} style={{ background: 'none', border: 'none', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', padding: '4px 8px' }}>
      Cancel
    </button>
  ) : (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {store.exercises.length > 0 && (
        <button onClick={() => { setTab('all'); setSelecting(true); }} style={{
          background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
          borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
          color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>Select</button>
      )}
      <button onClick={() => setCreating(true)} style={{
        width: 32, height: 32, borderRadius: '50%',
        boxShadow: `inset 0 0 0 0.5px ${UI.goldSoft}`, background: UI.goldFaint,
        color: UI.gold, cursor: 'pointer', fontSize: 20, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>+</button>
    </div>
  );

  return (
    <Screen>
      <TopBar title="Library" right={topBarRight} />

      {/* Tab strip */}
      <div style={{ display: 'flex', padding: '0 22px', borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0 }}>
        {[['recent','Recent'],['all','All']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, background: 'transparent', border: 'none',
            padding: '11px 0', cursor: 'pointer',
            color: tab === id ? UI.gold : UI.inkFaint,
            fontFamily: UI.fontUi, fontSize: 10, fontWeight: tab === id ? 600 : 400,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            borderBottom: `0.5px solid ${tab === id ? UI.gold : 'transparent'}`,
            marginBottom: -0.5,
            transition: 'color 0.2s',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: '18px 22px', paddingBottom: selecting ? 80 : 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tab === 'all' && (() => {
          const activeCount = filterTags.length + filterRestCats.length + (filterUnilateral !== null ? 1 : 0) + (filterPlan !== null ? 1 : 0);
          return (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1 }}>
                  <Field label="">
                    <TextInput value={q} onChange={v => setQ(v.toUpperCase())} placeholder="Search…" />
                  </Field>
                </div>
                <button onClick={() => setFiltersOpen(true)} style={{
                  flexShrink: 0, background: activeCount > 0 ? UI.goldFaint : 'transparent',
                  border: `0.5px solid ${activeCount > 0 ? UI.goldSoft : UI.hairStrong}`,
                  borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
                  color: activeCount > 0 ? UI.gold : UI.inkSoft,
                  fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  Filter{activeCount > 0 && <span style={{ background: UI.gold, color: '#0a0805', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700 }}>{activeCount}</span>}
                </button>
              </div>
            </>
          );
        })()}

        {tab === 'recent' && recent.length === 0 && (
          <Empty title="Nothing logged yet" sub="Once you log sessions, exercises will appear here." icon={ICON_BARBELL} />
        )}

        {tab === 'recent' && recent.map(({ ex, last, lastEntry, trend }, ri) => {
          const days = Math.round((Date.now() - new Date(last)) / 86400000);
          const isToday = days === 0;
          const top = lastEntry?.sets?.find(s => s.kg);
          const trendColor = trend === 'up' ? UI.ok : trend === 'down' ? UI.danger : UI.inkFaint;
          const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : trend === 'same' ? '→' : null;
          return (
            <div key={ex.id}
              onClick={() => go({ name: 'exercise', exId: ex.id })}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '13px 0',
                borderBottom: ri < recent.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
                cursor: 'pointer',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 19, color: isToday ? UI.gold : UI.ink, lineHeight: 1.1, marginBottom: 3 }}>{ex.name}</div>
                <div className="num" style={{ fontSize: 10, color: isToday ? UI.gold : UI.inkFaint, letterSpacing: '0.05em', marginBottom: 4 }}>
                  {isToday ? 'today' : `${days}d ago`}
                  {top && ` · ${top.kg}kg × ${top.reps}`}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {ex.tags?.map(t => <Pill key={t}>{t}</Pill>)}
                  {ex.category && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>{ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}</Pill>}
                  {ex.unilateral && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>Unilateral</Pill>}
                  {planExIds.has(ex.id) && <span style={{ color: UI.inkFaint, fontSize: 9, letterSpacing: '0.05em' }}>◆</span>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {trendIcon && (
                  <span className="num" style={{ color: trendColor, fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{trendIcon}</span>
                )}
                <ChevronRight />
              </div>
            </div>
          );
        })}

        {tab === 'all' && filtered.map((e, fi) => {
          const isSelected = selected.has(e.id);
          return (
            <div key={e.id}
              onClick={() => selecting ? toggleSelect(e.id) : go({ name: 'exercise', exId: e.id })}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '13px 0',
                borderBottom: fi < filtered.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
                cursor: 'pointer',
                background: isSelected ? 'rgba(200,116,105,0.04)' : 'transparent',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 19, color: isSelected ? UI.danger : UI.ink, lineHeight: 1.1 }}>{e.name}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {e.tags?.map(t => <Pill key={t}>{t}</Pill>)}
                  {e.category && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>{e.category.charAt(0).toUpperCase() + e.category.slice(1)}</Pill>}
                  {e.unilateral && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>Unilateral</Pill>}
                  {planExIds.has(e.id) && <span style={{ color: UI.inkFaint, fontSize: 9, letterSpacing: '0.05em' }}>◆</span>}
                </div>
              </div>
              {selecting ? (
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  boxShadow: `inset 0 0 0 0.5px ${isSelected ? UI.danger : UI.hairStrong}`,
                  background: isSelected ? UI.danger : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSelected && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                </div>
              ) : (
                <ChevronRight />
              )}
            </div>
          );
        })}
        {tab === 'all' && filtered.length === 0 && (
          <Empty title="No exercises" action={<Btn onClick={() => setCreating(true)}>Add exercise</Btn>} icon={ICON_BARBELL} />
        )}
      </div>

      {selecting && (
        <div style={{
          position: 'fixed', bottom: 'calc(76px + env(safe-area-inset-bottom, 8px))',
          left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: 440,
          padding: '12px 22px',
          background: 'rgba(var(--bg-rgb),0.92)', borderTop: `0.5px solid ${UI.hair}`,
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          zIndex: 15,
        }}>
          <span className="micro" style={{ color: UI.inkSoft }}>
            {selected.size === 0 ? 'Tap exercises to select' : `${selected.size} selected`}
          </span>
          <Btn kind="ghost" onClick={deleteSelected}
            disabled={selected.size === 0}
            style={{ color: UI.danger, borderColor: 'rgba(200,116,105,0.25)', opacity: selected.size === 0 ? 0.4 : 1, minHeight: 36, padding: '6px 14px', fontSize: 11 }}>
            Delete
          </Btn>
        </div>
      )}

      {creating && <ExerciseCreator onClose={() => setCreating(false)} setStore={setStore} />}

      {filtersOpen && (
        <Sheet open={true} onClose={() => setFiltersOpen(false)} title="Filter">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div style={{ borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8, marginBottom: 10 }}>
                <span className="micro" style={{ color: UI.gold }}>MUSCLE GROUP</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {MUSCLES.map(m => (
                  <Pill key={m} gold={filterTags.includes(m)} onClick={() => toggleFilter(m)} style={{ cursor: 'pointer' }}>{m}</Pill>
                ))}
              </div>
            </div>
            <div>
              <div style={{ borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8, marginBottom: 10 }}>
                <span className="micro" style={{ color: UI.gold }}>REST</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <Pill gold={filterRestCats.includes('none')} onClick={() => toggleRestCat('none')} style={{ cursor: 'pointer' }}>No rest assigned</Pill>
                <Pill gold={filterRestCats.includes('big')} onClick={() => toggleRestCat('big')} style={{ cursor: 'pointer' }}>Big</Pill>
                <Pill gold={filterRestCats.includes('medium')} onClick={() => toggleRestCat('medium')} style={{ cursor: 'pointer' }}>Medium</Pill>
                <Pill gold={filterRestCats.includes('small')} onClick={() => toggleRestCat('small')} style={{ cursor: 'pointer' }}>Small</Pill>
              </div>
            </div>
            <div>
              <div style={{ borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8, marginBottom: 10 }}>
                <span className="micro" style={{ color: UI.gold }}>MOVEMENT</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Pill gold={filterUnilateral === true} onClick={() => toggleUni(true)} style={{ cursor: 'pointer' }}>Unilateral</Pill>
                <Pill gold={filterUnilateral === false} onClick={() => toggleUni(false)} style={{ cursor: 'pointer' }}>Bilateral</Pill>
              </div>
            </div>
            <div>
              <div style={{ borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8, marginBottom: 10 }}>
                <span className="micro" style={{ color: UI.gold }}>PLAN</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Pill gold={filterPlan === 'in'} onClick={() => togglePlan('in')} style={{ cursor: 'pointer' }}>In plan</Pill>
                <Pill gold={filterPlan === 'out'} onClick={() => togglePlan('out')} style={{ cursor: 'pointer' }}>Not in plan</Pill>
              </div>
            </div>
            <Btn onClick={() => setFiltersOpen(false)} disabled={filtered.length === 0} style={{ opacity: filtered.length === 0 ? 0.4 : 1 }}>
              {filtered.length === 0 ? 'No results' : `Show ${filtered.length} exercise${filtered.length === 1 ? '' : 's'}`}
            </Btn>
          </div>
        </Sheet>
      )}

      {confirmEl}
    </Screen>
  );
}

const EXERCISE_SIZES = [['big','Big'],['medium','Medium'],['small','Small']];

function ExerciseCreator({ onClose, setStore, onCreated, initialName = '' }) {
  const [name, setName] = useStateL(initialName);
  const [selectedTags, setSelectedTags] = useStateL([]);
  const [category, setCategory] = useStateL(null);
  const [unilateral, setUnilateral] = useStateL(false);
  const toggleTag = (m) => setSelectedTags(t => t.includes(m) ? t.filter(x => x !== m) : [...t, m]);
  const save = () => {
    if (!name.trim()) return;
    const ex = { id: LB.uid(), name: name.trim(), tags: selectedTags, category: category || null, unilateral, note: '' };
    setStore(s => ({ ...s, exercises: [...s.exercises, ex] }));
    onCreated?.(ex.id);
    onClose();
  };
  return (
    <Sheet open={true} onClose={onClose} title="New exercise">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Field label="Name">
          <TextInput value={name} onChange={v => setName(v.toUpperCase())} placeholder="e.g. BENCH PRESS" autoFocus />
        </Field>
        <div>
          <span className="label">Muscle group</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {MUSCLES.map(m => (
              <Pill key={m} gold={selectedTags.includes(m)} onClick={() => toggleTag(m)}
                style={{ cursor: 'pointer' }}>{m}</Pill>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Exercise size</span>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {EXERCISE_SIZES.map(([val, label]) => (
              <Pill key={val} gold={category === val} onClick={() => setCategory(c => c === val ? null : val)} style={{ cursor: 'pointer' }}>{label}</Pill>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Movement type</span>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Pill gold={unilateral} onClick={() => setUnilateral(v => !v)} style={{ cursor: 'pointer' }}>Unilateral</Pill>
          </div>
        </div>
        <Btn onClick={save} style={{ opacity: name.trim() ? 1 : 0.4 }} disabled={!name.trim()}>Create</Btn>
      </div>
    </Sheet>
  );
}

// ─── EXERCISE DETAIL ─────────────────────────────────────────────────
function ExerciseDetailScreen({ store, setStore, go, exId, back }) {
  const ex = LB.findExercise(store, exId);
  if (!ex) { go(back || { name: 'lib' }); return null; }

  const [confirmEl, confirm] = useConfirm();
  const [editMode, setEditMode] = useStateL(false);
  const [editName, setEditName] = useStateL('');
  const [editTags, setEditTags] = useStateL([]);
  const [editCategory, setEditCategory] = useStateL(null);
  const [editUnilateral, setEditUnilateral] = useStateL(false);
  const [editNote, setEditNote] = useStateL(false);
  const [noteVal, setNoteVal] = useStateL(ex.note || '');

  const startEdit = () => { setEditName(ex.name); setEditTags([...(ex.tags || [])]); setEditCategory(ex.category || null); setEditUnilateral(!!ex.unilateral); setEditMode(true); };
  const cancelEdit = () => setEditMode(false);
  const saveEdit = () => {
    if (!editName.trim()) return;
    setStore(s => ({ ...s, exercises: s.exercises.map(e => e.id === exId ? { ...e, name: editName.trim(), tags: editTags, category: editCategory || null, unilateral: editUnilateral } : e) }));
    setEditMode(false);
  };
  const toggleEditTag = (m) => setEditTags(t => t.includes(m) ? t.filter(x => x !== m) : [...t, m]);

  const saveNote = () => {
    setStore(s => ({ ...s, exercises: s.exercises.map(e => e.id === exId ? { ...e, note: noteVal.trim() } : e) }));
    setEditNote(false);
  };

  const deleteExercise = async () => {
    if (!await confirm('Previous sessions will be preserved.', { title: `Delete "${ex.name}"?`, ok: 'Delete', danger: true })) return;
    setStore(s => ({ ...s, exercises: s.exercises.filter(e => e.id !== exId) }));
    go({ name: 'lib' });
  };

  const history = useMemoL(() => {
    return store.sessions
      .filter(s => s.ended && s.entries.some(e => e.exId === exId))
      .sort((a,b) => (b.ended||'').localeCompare(a.ended||''))
      .map(s => ({ session: s, entry: s.entries.find(e => e.exId === exId) }));
  }, [store.sessions, exId]);

  const e1rmForSet = (s) => {
    if (s.kg == null) return 0;
    if (s.repsL != null || s.repsR != null) return s.kg * (1 + Math.max(s.repsL || 0, s.repsR || 0) / 30);
    return s.reps ? s.kg * (1 + s.reps / 30) : 0;
  };

  const points = history.map(h => {
    const best = (h.entry.sets || []).reduce((m, s) => Math.max(m, e1rmForSet(s)), 0);
    return { date: h.session.date, est: best };
  }).filter(p => p.est > 0).reverse();

  const pr = points.length ? Math.max(...points.map(p => p.est)) : 0;

  const volPr = history.length ? Math.max(...history.map(h =>
    (h.entry.sets || []).filter(s => s.kg != null && s.reps).reduce((sum, s) => sum + s.kg * s.reps, 0)
  )) : 0;

  return (
    <Screen>
      <ScreenHead
        ref_="EXERCISE"
        title={editMode ? editName || ex.name : ex.name}
        onBack={() => { if (editMode) cancelEdit(); else go(back || { name: 'lib' }); }}
        right={
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={editMode ? saveEdit : startEdit} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: UI.gold, fontSize: 11, fontFamily: UI.fontUi, padding: '4px 8px',
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>{editMode ? 'Save' : 'Edit'}</button>
            {!editMode && <button onClick={deleteExercise} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              width: 30, height: 30, borderRadius: '50%',
              boxShadow: `inset 0 0 0 0.5px rgba(200,116,105,0.3)`,
              color: UI.danger, fontSize: 16, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>}
          </div>
        }
      />
      <Hairline />

      <div style={{ padding: '14px 22px 0' }}>
        {editMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Name">
              <TextInput value={editName} onChange={v => setEditName(v.toUpperCase())} />
            </Field>
            <div>
              <span className="label">Muscle group</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {MUSCLES.map(m => (
                  <Pill key={m} gold={editTags.includes(m)} onClick={() => toggleEditTag(m)}
                    style={{ cursor: 'pointer' }}>{m}</Pill>
                ))}
              </div>
            </div>
            <div>
              <span className="label">Exercise size</span>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {EXERCISE_SIZES.map(([val, label]) => (
                  <Pill key={val} gold={editCategory === val} onClick={() => setEditCategory(c => c === val ? null : val)} style={{ cursor: 'pointer' }}>{label}</Pill>
                ))}
              </div>
            </div>
            <div>
              <span className="label">Movement type</span>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <Pill gold={editUnilateral} onClick={() => setEditUnilateral(v => !v)} style={{ cursor: 'pointer' }}>Unilateral</Pill>
              </div>
            </div>
            <Btn kind="ghost" onClick={cancelEdit} style={{ fontSize: 11 }}>Cancel</Btn>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ex.category && <Pill gold>{ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}</Pill>}
            {ex.unilateral && <Pill gold>Unilateral</Pill>}
            {(ex.tags || []).map(t => <Pill key={t} gold>{t}</Pill>)}
            {!ex.category && !ex.unilateral && !(ex.tags || []).length && <span className="micro" style={{ fontStyle: 'italic', color: UI.inkFaint }}>No muscle group — Edit</span>}
          </div>
        )}
      </div>

      <div style={{ padding: '18px 22px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Stats — SubDials */}
        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '6px 0' }}>
          <SubDial label="1RM PR" value={pr ? Math.round(pr) : '—'} sub="kg" size={90} gold />
          <SubDial label="Sessions" value={history.length} size={90} />
          <SubDial label="Vol PR" value={volPr ? Math.round(volPr) : '—'} sub="kg" size={90} gold />
        </div>

        {points.length > 1 && <ProgressChart points={points} />}

        {/* Note */}
        <div>
          <Bezel>NOTE</Bezel>
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span />
              <button onClick={() => { setNoteVal(ex.note || ''); setEditNote(v => !v); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.gold, fontSize: 10, fontFamily: UI.fontUi, padding: 0, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {editNote ? 'Cancel' : 'Edit'}
              </button>
            </div>
            {editNote ? (
              <div>
                <textarea value={noteVal} onChange={e => setNoteVal(e.target.value)}
                  placeholder="e.g. Cable pos 4, neutral grip, slow eccentric"
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box', background: 'transparent',
                    border: 'none', borderBottom: `0.5px solid ${UI.hairStrong}`,
                    padding: '6px 0', color: UI.ink, fontFamily: UI.fontUi, fontSize: 14,
                    resize: 'none', outline: 'none',
                  }}
                />
                <Btn onClick={saveNote} style={{ marginTop: 12, width: '100%' }}>Save</Btn>
              </div>
            ) : (
              <div className="display-it" style={{ fontSize: 16, color: ex.note ? UI.inkSoft : UI.inkFaint, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {ex.note || 'No note yet.'}
              </div>
            )}
          </div>
        </div>

        {/* History */}
        <div>
          <Bezel>HISTORY</Bezel>
          <div style={{ marginTop: 8 }}>
            {history.slice(0, 10).map((h, hi) => {
              const sessionBest = h.entry.sets.reduce((m, s) => Math.max(m, e1rmForSet(s)), 0);
              const isPR = pr > 0 && sessionBest > 0 && Math.abs(sessionBest - pr) < 0.01;
              return (
                <div key={h.session.id}
                  onClick={() => go({ name: 'session', sessionId: h.session.id })}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    padding: '12px 0',
                    borderBottom: hi < Math.min(history.length, 10) - 1 ? `0.5px solid ${UI.hair}` : 'none',
                    cursor: 'pointer',
                  }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                      <span className="num" style={{ fontSize: 10, color: isPR ? UI.gold : UI.inkFaint, letterSpacing: '0.05em' }}>
                        {new Date(h.session.date.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'2-digit' })}
                      </span>
                      {isPR && (
                        <span style={{ fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.1em', color: UI.gold, background: UI.goldFaint, border: `0.5px solid ${UI.goldSoft}`, borderRadius: 4, padding: '1px 5px' }}>PR</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {h.entry.sets.filter(s => s.kg).map((s, i) => {
                        const isBest = sessionBest > 0 && Math.abs(e1rmForSet(s) - sessionBest) < 0.01;
                        const repsStr = (s.repsL != null || s.repsR != null)
                          ? `L${s.repsL ?? '?'}/R${s.repsR ?? '?'}`
                          : s.reps;
                        return (
                          <span key={i} className="num" style={{ fontSize: 13, color: isBest ? UI.gold : UI.ink }}>
                            {s.kg}<span style={{ color: isBest ? UI.goldSoft : UI.inkFaint }}>×</span>{repsStr}
                          </span>
                        );
                      })}
                    </div>
                    {h.entry.note && <div className="micro" style={{ color: UI.inkFaint, marginTop: 4, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>{h.entry.note}</div>}
                  </div>
                  <span className="micro" style={{ color: UI.inkFaint }}>{h.session.dayName}</span>
                </div>
              );
            })}
            {history.length === 0 && <Empty title="Never trained" />}
          </div>
        </div>
      </div>
      {confirmEl}
    </Screen>
  );
}

function ProgressChart({ points }) {
  const w = 280, h = 90, pad = 8;
  const max = Math.max(...points.map(p => p.est));
  const min = Math.min(...points.map(p => p.est));
  const range = max - min || 1;
  const xy = points.map((p, i) => {
    const x = pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p.est - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const path = xy.map(([x,y], i) => `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <div style={{ padding: '10px 0' }}>
      <div className="micro" style={{ marginBottom: 8, color: UI.inkFaint }}>EST. 1RM · HISTORY</div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>
        <path d={path} fill="none" stroke={UI.gold} strokeWidth="1" opacity="0.6" />
        {xy.map(([x,y], i) => (
          <circle key={i} cx={x} cy={y} r="2" fill={UI.gold} />
        ))}
      </svg>
    </div>
  );
}

// ─── STATS TAB ───────────────────────────────────────────────────────
function StatsTab({ store, sessions, go }) {
  const today = new Date(); today.setHours(12, 0, 0, 0);

  // Monday of current week
  const dow = today.getDay();
  const monday = new Date(today); monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);

  // Determine whether we're in cycle mode and compute current cycle window
  const sch = store.schedules.find(s => s.id === store.activeScheduleId);
  const isCycleMode = sch && !LB.isWeekdayPlan(sch) && !!store.cycleStartDate;
  const cycleLen = sch?.days?.length || 1;
  const cycleWindowStart = (() => {
    if (!isCycleMode) return null;
    const start = new Date(store.cycleStartDate + 'T12:00:00');
    const n = Math.round((today.getTime() - start.getTime()) / 86400000);
    const idxInCycle = ((n % cycleLen) + cycleLen) % cycleLen;
    const d = new Date(today); d.setDate(today.getDate() - idxInCycle);
    return d;
  })();
  const currentCycleNum = isCycleMode ? Math.floor(Math.round((today.getTime() - new Date(store.cycleStartDate + 'T12:00:00').getTime()) / 86400000) / cycleLen) : 0;

  const [cycleViewOffset, setCycleViewOffset] = useStateL(0);
  const selectedCycleStart = isCycleMode && cycleWindowStart ? (() => {
    const d = new Date(cycleWindowStart); d.setDate(cycleWindowStart.getDate() + cycleViewOffset * cycleLen); return d;
  })() : null;
  const selectedCycleEnd = isCycleMode && selectedCycleStart ? (cycleViewOffset === 0 ? today : (() => {
    const d = new Date(selectedCycleStart); d.setDate(selectedCycleStart.getDate() + cycleLen - 1); return d;
  })()) : null;
  const selectedCycleNum = currentCycleNum + cycleViewOffset;

  // Sessions in the selected training period (cycle or calendar week)
  const thisPeriodSessions = useMemoL(() => sessions.filter(s => {
    const d = new Date(s.date.slice(0, 10) + 'T12:00:00');
    if (isCycleMode) return selectedCycleStart && selectedCycleEnd && d >= selectedCycleStart && d <= selectedCycleEnd;
    return d >= monday && d <= sunday;
  }), [sessions, isCycleMode, selectedCycleStart, selectedCycleEnd]);

  // Calendar-week sessions — used for consistency card ("This Week")
  const thisWeekSessions = useMemoL(() => sessions.filter(s => {
    const d = new Date(s.date.slice(0, 10) + 'T12:00:00');
    return d >= monday && d <= sunday;
  }), [sessions]);

  const thisMonthSessions = useMemoL(() => sessions.filter(s => {
    const d = new Date(s.date.slice(0, 10) + 'T12:00:00');
    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  }), [sessions]);

  // Weekly sets per muscle group
  const setsPerMuscle = useMemoL(() => {
    const counts = {};
    thisPeriodSessions.forEach(s => {
      s.entries.forEach(entry => {
        const ex = store.exercises.find(e => e.id === entry.exId);
        const muscles = (ex?.tags || []).filter(t => MUSCLES.includes(t));
        const done = entry.sets.filter(st => st.done).length;
        muscles.forEach(m => { counts[m] = (counts[m] || 0) + done; });
      });
    });
    return MUSCLES.map(m => ({ muscle: m, sets: counts[m] || 0 })).filter(x => x.sets > 0).sort((a, b) => b.sets - a.sets);
  }, [thisPeriodSessions, store.exercises]);

  // Weekly volume over last 8 weeks
  const weeklyVolume = useMemoL(() => {
    const weeks = [];
    for (let w = 7; w >= 0; w--) {
      const wMon = new Date(monday); wMon.setDate(monday.getDate() - w * 7);
      const wSun = new Date(wMon); wSun.setDate(wMon.getDate() + 6);
      const vol = sessions
        .filter(s => { const d = new Date(s.date.slice(0,10)+'T12:00:00'); return d >= wMon && d <= wSun; })
        .reduce((sum, s) => sum + totalVolume(s), 0);
      const label = wMon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      weeks.push({ label, vol });
    }
    return weeks;
  }, [sessions]);

  // All-time stats
  const totalVol = sessions.reduce((sum, s) => sum + totalVolume(s), 0);
  const totalSets = sessions.reduce((sum, s) => sum + s.entries.reduce((c, e) => c + e.sets.filter(st => st.done).length, 0), 0);
  const totalReps = sessions.reduce((sum, s) => sum + s.entries.reduce((c, e) => c + e.sets.filter(st => st.done).reduce((r, st) => r + (+st.reps || 0), 0), 0), 0);
  const avgVol = sessions.length ? Math.round(totalVol / sessions.length) : 0;
  const durations = sessions.filter(s => s.startedAt && s.ended).map(s => Math.round((new Date(s.ended) - new Date(s.startedAt)) / 60000));
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const maxDuration = durations.length ? Math.max(...durations) : 0;

  // Best session by volume
  const bestSession = sessions.length ? sessions.reduce((best, s) => totalVolume(s) > totalVolume(best) ? s : best, sessions[0]) : null;

  // Streaks — rest days are transparent, only missed training days break the streak
  const sessionDateSet = new Set(sessions.map(s => s.date.slice(0, 10)));

  const isTrainingDay = (date) => {
    if (!sch) return true;
    if (LB.isWeekdayPlan(sch)) {
      const js = date.getDay();
      const wd = js === 0 ? 6 : js - 1;
      const day = sch.days.find(d => d.weekday === wd);
      return day ? day.items.length > 0 : false;
    }
    if (!store.cycleStartDate) return true;
    const start = new Date(store.cycleStartDate + 'T12:00:00');
    const n = Math.round((date.getTime() - start.getTime()) / 86400000);
    if (n < 0) return false; // before plan start → streak-neutral
    const day = sch.days[((n % sch.days.length) + sch.days.length) % sch.days.length];
    return day ? day.items.length > 0 : false;
  };

  const planStart = store.cycleStartDate ? new Date(store.cycleStartDate + 'T12:00:00') : null;

  let currentStreak = 0;
  for (let i = 0; i <= 730; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i); d.setHours(12, 0, 0, 0);
    if (planStart && d < planStart) break; // don't count before plan start
    const key = d.toISOString().slice(0, 10);
    if (sessionDateSet.has(key)) { currentStreak++; }
    else if (i === 0) { /* today not done yet — don't break */ }
    else if (isTrainingDay(d)) { break; }
    // rest day → continue without breaking or counting
  }

  let longestStreak = 0, ls = 0;
  if (sessions.length > 0) {
    const earliest = planStart ?? new Date(sessions[sessions.length - 1].date.slice(0, 10) + 'T12:00:00');
    const dayCount = Math.round((today.getTime() - earliest.getTime()) / 86400000) + 1;
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(earliest); d.setDate(earliest.getDate() + i); d.setHours(12, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      if (sessionDateSet.has(key)) { ls++; longestStreak = Math.max(longestStreak, ls); }
      else if (isTrainingDay(d)) { ls = 0; }
      // rest day → ls unchanged
    }
  }

  const totalTrainingMins = durations.reduce((a, b) => a + b, 0);
  const totalTrainingStr = totalTrainingMins >= 60
    ? `${Math.floor(totalTrainingMins / 60)}h ${totalTrainingMins % 60}m`
    : `${totalTrainingMins}m`;

  const thisYearSessions = useMemoL(() => sessions.filter(s => {
    return new Date(s.date.slice(0, 10) + 'T12:00:00').getFullYear() === today.getFullYear();
  }), [sessions]);

  const avgSessionsPerWeek = useMemoL(() => {
    const relevant = planStart
      ? sessions.filter(s => new Date(s.date.slice(0, 10) + 'T12:00:00') >= planStart)
      : sessions;
    if (!relevant.length) return '0.0';
    const oldest = relevant.reduce((min, s) =>
      s.date.slice(0, 10) < min ? s.date.slice(0, 10) : min, relevant[0].date.slice(0, 10));
    const anchor = planStart ?? new Date(oldest + 'T12:00:00');
    // Monday of the anchor week
    const anchorDay = anchor.getDay() === 0 ? 6 : anchor.getDay() - 1;
    const anchorMonday = new Date(anchor); anchorMonday.setDate(anchor.getDate() - anchorDay); anchorMonday.setHours(0,0,0,0);
    // Monday of the current week
    const todayDay = today.getDay() === 0 ? 6 : today.getDay() - 1;
    const currentMonday = new Date(today); currentMonday.setDate(today.getDate() - todayDay); currentMonday.setHours(0,0,0,0);
    const weeks = Math.round((currentMonday - anchorMonday) / (7 * 86400000)) + 1;
    return (relevant.length / Math.max(1, weeks)).toFixed(1);
  }, [sessions, planStart]);
  const exCounts = {};
  sessions.forEach(s => s.entries.forEach(e => { exCounts[e.exId] = (exCounts[e.exId] || 0) + 1; }));
  const topExercises = Object.entries(exCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, count]) => ({ id, name: store.exercises.find(e => e.id === id)?.name || '?', count }));

  const maxSets = Math.max(...setsPerMuscle.map(x => x.sets), 1);
  const maxWeekVol = Math.max(...weeklyVolume.map(w => w.vol), 1);

  const StatCard = ({ label, value, sub, gold }) => (
    <div style={{ background: gold ? UI.goldFaint : UI.bgInset, borderRadius: 12, padding: '12px 14px', textAlign: 'center', border: gold ? `0.5px solid ${UI.goldSoft}` : 'none' }}>
      <div className="micro" style={{ color: gold ? UI.gold : UI.inkFaint, marginBottom: 6 }}>{label}</div>
      <div className="num" style={{ fontSize: 22, color: gold ? UI.gold : UI.ink, lineHeight: 1 }}>{value}</div>
      {sub && <div className="micro" style={{ color: gold ? UI.gold : UI.inkFaint, marginTop: 3, opacity: gold ? 0.7 : 1 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 40px', display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Weekly sets per muscle */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="micro" style={{ borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8 }}>
            {isCycleMode ? `CYCLE ${selectedCycleNum + 1} · SETS PER MUSCLE` : 'THIS WEEK · SETS PER MUSCLE'}
          </div>
          {isCycleMode && (
            <div style={{ display: 'flex', gap: 2 }}>
              <button onClick={() => setCycleViewOffset(o => Math.max(-currentCycleNum, o - 1))} style={{ background: 'none', border: 'none', color: cycleViewOffset <= -currentCycleNum ? UI.inkFaint : UI.inkSoft, cursor: cycleViewOffset <= -currentCycleNum ? 'default' : 'pointer', fontSize: 16, padding: '0 6px', lineHeight: 1 }}>‹</button>
              <button onClick={() => setCycleViewOffset(o => Math.min(0, o + 1))} style={{ background: 'none', border: 'none', color: cycleViewOffset >= 0 ? UI.inkFaint : UI.inkSoft, cursor: cycleViewOffset >= 0 ? 'default' : 'pointer', fontSize: 16, padding: '0 6px', lineHeight: 1 }}>›</button>
            </div>
          )}
        </div>
        {setsPerMuscle.length === 0 ? (
          <div style={{ color: UI.inkFaint, fontSize: 13, fontFamily: UI.fontUi }}>{isCycleMode ? `No sessions in cycle ${selectedCycleNum + 1}.` : 'No sessions this week yet.'}</div>
        ) : setsPerMuscle.map(({ muscle, sets }) => (
          <div key={muscle} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 100, fontSize: 11, fontFamily: UI.fontUi, color: UI.inkSoft, letterSpacing: '0.05em' }}>{muscle}</div>
            <div style={{ flex: 1, height: 3, background: UI.hair, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(sets / maxSets) * 100}%`, background: UI.gold, borderRadius: 2 }} />
            </div>
            <div className="num" style={{ width: 24, textAlign: 'right', fontSize: 13, color: UI.gold }}>{sets}</div>
          </div>
        ))}
      </div>

      {/* Weekly volume trend */}
      <div>
        <div className="micro" style={{ marginBottom: 14, borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8 }}>WEEKLY VOLUME · LAST 8 WEEKS</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
          {weeklyVolume.map(({ label, vol }, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
              <div style={{
                width: '100%', borderRadius: 3,
                height: `${Math.max(3, (vol / maxWeekVol) * 68)}px`,
                background: i === 7 ? UI.gold : UI.hair,
              }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
          {weeklyVolume.map(({ label }, i) => (
            <div key={i} style={{ flex: 1, fontSize: 8, fontFamily: UI.fontUi, color: i === 7 ? UI.gold : UI.inkFaint, textAlign: 'center', letterSpacing: '0.03em' }}>
              {i === 7 ? 'NOW' : i % 2 === 0 ? label : ''}
            </div>
          ))}
        </div>
      </div>

      {/* All time */}
      <div>
        <div className="micro" style={{ marginBottom: 14, borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8 }}>ALL TIME</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <StatCard label="Sessions" value={sessions.length} />
          <StatCard label="Avg Volume" value={avgVol.toLocaleString('en-US')} sub="kg / session" />
          <StatCard label="Avg Duration" value={avgDuration || '—'} sub={avgDuration ? 'min' : ''} />
          <StatCard label="Longest Session" value={maxDuration || '—'} sub={maxDuration ? 'min' : ''} />
          <div style={{ gridColumn: '1 / -1', background: UI.bgInset, borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>Total Time Trained</div>
            <div className="num" style={{ fontSize: 22, color: UI.ink, lineHeight: 1 }}>{totalTrainingMins ? totalTrainingStr : '—'}</div>
          </div>
        </div>
      </div>

      {/* Consistency */}
      <div>
        <div className="micro" style={{ marginBottom: 14, borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8 }}>CONSISTENCY</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <StatCard label="Current Streak" value={currentStreak} sub={currentStreak === 1 ? 'day' : 'days'} gold />
          <StatCard label="Longest Streak" value={longestStreak} sub={longestStreak === 1 ? 'day' : 'days'} gold />
          <StatCard label="This Year" value={thisYearSessions.length} sub="sessions" />
          <StatCard label="This Month" value={thisMonthSessions.length} sub="sessions" />
          <StatCard label="This Week" value={thisWeekSessions.length} sub="sessions" />
          <StatCard label="Avg / Week" value={avgSessionsPerWeek} sub="sessions" />
        </div>
      </div>

      {/* Best session */}
      {bestSession && (
        <div>
          <div className="micro" style={{ marginBottom: 14, borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8 }}>BEST SESSION</div>
          <Frame onClick={() => go({ name: 'session', sessionId: bestSession.id, back: { name: 'hist', initialTab: 'stats' } })} style={{ padding: '14px 16px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="display" style={{ fontSize: 18, color: UI.ink }}>{bestSession.dayName}</div>
                <div className="micro" style={{ color: UI.inkFaint, marginTop: 4 }}>
                  {new Date(bestSession.date.slice(0,10)+'T12:00:00').toLocaleDateString('en-US', { weekday:'short', day:'numeric', month:'short' }).toUpperCase()}
                </div>
                <div className="micro" style={{ color: UI.inkFaint, marginTop: 3 }}>
                  {bestSession.entries.length} exercises · {bestSession.entries.reduce((sum, e) => sum + e.sets.filter(st => st.done).length, 0)} sets
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ fontSize: 22, color: UI.gold }}>{Math.round(totalVolume(bestSession)).toLocaleString('en-US')}</div>
                <div className="micro" style={{ color: UI.inkFaint }}>kg</div>
              </div>
            </div>
          </Frame>
        </div>
      )}

      {/* Top exercises */}
      {topExercises.length > 0 && (
        <div>
          <div className="micro" style={{ marginBottom: 14, borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8 }}>TOP EXERCISES</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {topExercises.map(({ id, name, count }, i) => (
              <div key={id} onClick={() => go({ name: 'exercise', exId: id, back: { name: 'hist', initialTab: 'stats' } })} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '11px 0',
                borderBottom: i < topExercises.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
                cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="num" style={{ fontSize: i === 0 ? 13 : 11, color: i === 0 ? UI.gold : UI.inkFaint, width: 16 }}>{i + 1}</span>
                  <span style={{ fontFamily: UI.fontUi, fontSize: 14, color: i === 0 ? UI.gold : UI.ink }}>{name}</span>
                </div>
                <span className="num" style={{ fontSize: 13, color: i === 0 ? UI.gold : UI.inkSoft }}>{count}×</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ─── HISTORY ─────────────────────────────────────────────────────────
function HistoryScreen({ store, go, initialTab }) {
  const [tab, setTab] = useStateL(initialTab || 'workouts');
  const sessions = useMemoL(() => {
    return [...store.sessions]
      .filter(s => s.ended)
      .sort((a,b) => (b.ended||'').localeCompare(a.ended||''));
  }, [store.sessions]);

  return (
    <Screen scroll={false}>
      <TopBar title="History" />
      {/* Tab strip */}
      <div style={{ display: 'flex', padding: '0 22px', borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0 }}>
        {[['workouts','Workouts'],['stats','Stats']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, background: 'transparent', border: 'none',
            padding: '11px 0', cursor: 'pointer',
            color: tab === id ? UI.gold : UI.inkFaint,
            fontFamily: UI.fontUi, fontSize: 10, fontWeight: tab === id ? 600 : 400,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            borderBottom: `0.5px solid ${tab === id ? UI.gold : 'transparent'}`,
            marginBottom: -0.5, transition: 'color 0.2s',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'workouts' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 22px 22px', display: 'flex', flexDirection: 'column' }}>
          {sessions.length === 0 && (
            <Empty title="No sessions" sub="Log your first workout to see your history." icon={ICON_HISTORY} />
          )}
          {(() => {
            const now = new Date(); now.setHours(12,0,0,0);
            const dow = now.getDay();
            const monday = new Date(now); monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
            const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7);
            const getGroup = (dateStr) => {
              const d = new Date(dateStr.slice(0,10) + 'T12:00:00');
              if (d >= monday) return 'THIS WEEK';
              if (d >= lastMonday) return 'LAST WEEK';
              return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
            };
            const items = [];
            let lastGroup = null;
            sessions.forEach(s => {
              const group = getGroup(s.date);
              const firstInGroup = group !== lastGroup;
              if (firstInGroup) { items.push({ type: 'header', label: group, key: `h-${group}`, isFirst: items.length === 0 }); lastGroup = group; }
              items.push({ type: 'session', session: s, key: s.id, firstInGroup });
            });
            return items.map(item => {
              if (item.type === 'header') {
                return (
                  <div key={item.key} className="micro" style={{ marginTop: item.isFirst ? 6 : 24, marginBottom: 10, borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8 }}>
                    {item.label}
                  </div>
                );
              }
              const s = item.session;
              const setsLogged = s.entries.reduce((c, e) => c + e.sets.filter(x => x.done).length, 0);
              const vol = totalVolume(s);
              const date = new Date(s.date.slice(0,10) + 'T12:00:00');
              const days = Math.round((Date.now() - date) / 86400000);
              const isToday = days === 0;
              return (
                <div key={item.key}
                  onClick={() => go({ name: 'session', sessionId: s.id })}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    padding: '16px 0',
                    borderTop: !item.firstInGroup ? `0.5px solid ${UI.hair}` : 'none',
                    cursor: 'pointer',
                  }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="micro" style={{ color: isToday ? UI.gold : UI.inkFaint, marginBottom: 5 }}>
                      {date.toLocaleDateString('en-US', { weekday:'short', day:'numeric', month:'short' }).toUpperCase()} · {isToday ? 'TODAY' : `${days}D AGO`}
                    </div>
                    <div className="display" style={{ fontSize: 21, color: UI.ink, lineHeight: 1.1, marginBottom: 4 }}>{s.dayName}</div>
                    <div className="micro" style={{ color: UI.inkFaint }}>
                      {s.entries.length} Exercises · {setsLogged} Sets
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="num" style={{ fontSize: 21, color: UI.gold, lineHeight: 1 }}>
                      {vol.toLocaleString('en-US')}
                    </div>
                    <div className="micro" style={{ color: UI.inkFaint, marginTop: 3 }}>kg</div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {tab === 'stats' && <StatsTab store={store} sessions={sessions} go={go} />}
    </Screen>
  );
}

// ─── SESSION DETAIL ──────────────────────────────────────────────────
function SessionDetailScreen({ store, setStore, go, sessionId, justFinished, back }) {
  const [confirmEl, confirm] = useConfirm();
  const [editing, setEditing] = useStateL(false);
  const [capturing, setCapturing] = useStateL(false);
  const captureRef = useRefL(null);
  const s = store.sessions.find(x => x.id === sessionId);
  if (!s) { go({ name: 'hist' }); return null; }
  const vol = totalVolume(s);
  const duration = s.ended && (s.startedAt ?? s.date) ? Math.round((new Date(s.ended) - new Date(s.startedAt ?? s.date)) / 60000) : null;

  const deleteSession = async () => {
    if (!await confirm('This session will be permanently deleted.', { title: 'Delete session?', ok: 'Delete', danger: true })) return;
    setStore(s => ({ ...s, sessions: s.sessions.filter(x => x.id !== sessionId) }));
    go({ name: 'hist' });
  };

  const prevEntryMap = {};
  s.entries.forEach(e => {
    const prev = store.sessions
      .filter(x => x.ended && x.id !== s.id && x.ended < s.ended && x.dayId === s.dayId)
      .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))
      .find(x => x.entries.some(en => en.exId === e.exId && en.sets.some(st => st.kg != null || st.reps != null)));
    prevEntryMap[e.exId] = prev?.entries.find(en => en.exId === e.exId) ?? null;
  });

  const prevSameDay = store.sessions
    .filter(x => x.ended && x.id !== s.id && x.ended < s.ended && x.dayId === s.dayId)
    .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0];
  const volDelta = prevSameDay != null ? vol - totalVolume(prevSameDay) : null;

  const prMap = {};
  store.sessions.filter(x => x.ended && x.id !== s.id && x.ended < s.ended).forEach(sess =>
    sess.entries.forEach(e => e.sets.filter(st => st.done && st.kg != null && st.reps != null).forEach(st => {
      const cur = prMap[e.exId];
      if (!cur || st.kg > cur.kg || (st.kg === cur.kg && st.reps > cur.reps)) prMap[e.exId] = { kg: st.kg, reps: st.reps };
    }))
  );
  const sessionBestMap = {};
  s.entries.forEach(e => e.sets.filter(st => st.done && st.kg != null && st.reps != null).forEach(st => {
    const cur = sessionBestMap[e.exId];
    if (!cur || st.kg > cur.kg || (st.kg === cur.kg && st.reps > cur.reps)) sessionBestMap[e.exId] = { kg: st.kg, reps: st.reps };
  }));
  const isPR = (st, exId) => {
    if (!st.done || st.kg == null || st.reps == null) return false;
    const sessionBest = sessionBestMap[exId];
    if (!sessionBest || st.kg !== sessionBest.kg || st.reps !== sessionBest.reps) return false;
    const best = prMap[exId];
    return !best || st.kg > best.kg || (st.kg === best.kg && st.reps > best.reps);
  };

  const muscleGroups = [...new Set(
    s.entries.flatMap(e => store.exercises.find(x => x.id === e.exId)?.tags || []).filter(Boolean)
  )];

  const takeScreenshot = async () => {
    if (!captureRef.current || !window.html2canvas) return;
    setCapturing(true);
    // Temporarily expand scroll parent so html2canvas captures full content
    const scrollParent = captureRef.current.parentElement;
    const saved = { overflow: scrollParent.style.overflow, height: scrollParent.style.height, minHeight: scrollParent.style.minHeight };
    scrollParent.style.overflow = 'visible';
    scrollParent.style.height = 'auto';
    scrollParent.style.minHeight = 'auto';
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const el = captureRef.current;
      const canvas = await window.html2canvas(el, {
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#1a1820',
        scale: 2, useCORS: true, logging: false,
        height: el.scrollHeight, windowHeight: el.scrollHeight,
      });
      canvas.toBlob(async (blob) => {
        const filename = `${s.dayName}-${s.date.slice(0,10)}.png`;
        const file = new File([blob], filename, { type: 'image/png' });
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file] }); } catch(_) {}
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename;
          document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }, 'image/png');
    } finally {
      scrollParent.style.overflow = saved.overflow;
      scrollParent.style.height = saved.height;
      scrollParent.style.minHeight = saved.minHeight;
      setCapturing(false);
    }
  };

  const effReps = (st) => {
    if (st.repsL != null || st.repsR != null) return Math.min(st.repsL ?? st.repsR, st.repsR ?? st.repsL);
    return st.reps;
  };
  const isImprovement = (st, prevSet) => {
    if (!prevSet || !st.done || st.kg == null || prevSet.kg == null) return false;
    const repsA = effReps(st); const repsB = effReps(prevSet);
    if (repsA == null || repsB == null) return false;
    return (st.kg > prevSet.kg && repsA >= repsB - 2) || (st.kg >= prevSet.kg && repsA > repsB);
  };

  const isDecline = (st, prevSet) => {
    if (!prevSet || !st.done || st.kg == null || prevSet.kg == null) return false;
    const repsA = effReps(st); const repsB = effReps(prevSet);
    if (repsA == null || repsB == null) return false;
    return st.kg < prevSet.kg || (st.kg === prevSet.kg && repsA < repsB);
  };

  return (
    <Screen>
      <ScreenHead
        ref_={new Date(s.date.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long' }).toUpperCase()}
        title={s.dayName}
        onBack={() => go(justFinished ? { name: 'home' } : (back || { name: 'hist' }))}
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={takeScreenshot} disabled={capturing} style={{
              background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
              borderRadius: 999, padding: '5px 10px', cursor: 'pointer',
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>{capturing ? '…' : '↓'}</button>
            <button onClick={() => setEditing(true)} style={{
              background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
              borderRadius: 999, padding: '5px 10px', cursor: 'pointer',
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>Edit</button>
            <button onClick={deleteSession} style={{
              width: 28, height: 28, borderRadius: '50%',
              boxShadow: `inset 0 0 0 0.5px rgba(200,116,105,0.25)`, background: 'transparent',
              color: UI.danger, cursor: 'pointer', fontSize: 16, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>
          </div>
        }
      />
      <Hairline />

      <div ref={captureRef} style={{ padding: capturing ? '20px 22px 24px' : '14px 22px 28px', display: 'flex', flexDirection: 'column', gap: 18, background: UI.bg }}>

        {/* Screenshot-only header */}
        {capturing && (
          <div style={{ marginBottom: -4 }}>
            <div style={{ height: '0.5px', background: UI.gold, marginBottom: 14 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div className="micro" style={{ color: UI.inkFaint, letterSpacing: '0.12em', marginBottom: 4 }}>
                  {new Date(s.date.slice(0,10) + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long' }).toUpperCase()}
                </div>
                <div className="display" style={{ fontSize: 26 }}>{s.dayName}</div>
              </div>
              <div className="micro-gold" style={{ letterSpacing: '0.18em', marginTop: 2 }}>ZANE</div>
            </div>
            <div style={{ height: '0.5px', background: UI.hair, marginBottom: 0 }} />
          </div>
        )}

        {/* Celebration banner — screen only */}
        {justFinished && !capturing && (() => {
          return (
            <BracketFrame gold style={{ marginBottom: 4 }}>
              <div style={{ textAlign: 'center', padding: '6px 0 10px' }}>
                <div className="micro-gold" style={{ letterSpacing: '0.24em', marginBottom: 16 }}>SESSION COMPLETE</div>
                <div className="display-it" style={{ fontSize: 28, color: UI.gold, marginBottom: 18 }}>Well done.</div>
                <div style={{ display: 'flex', borderTop: `0.5px solid ${UI.hair}`, paddingTop: 16, gap: 0 }}>
                  {[
                    { label: 'Volume', value: `${Math.round(vol).toLocaleString('en-US')} kg`, gold: true },
                    ...(duration ? [{ label: 'Duration', value: `${duration} min`, gold: false }] : []),
                    { label: 'Sets', value: String(s.entries.reduce((c,e) => c + e.sets.filter(x => x.done).length, 0)), gold: false },
                  ].map((st, k, arr) => (
                    <div key={st.label} style={{
                      flex: 1,
                      borderRight: k < arr.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
                      padding: '0 4px',
                    }}>
                      <div className="num" style={{ fontSize: 18, color: st.gold ? UI.gold : UI.ink, lineHeight: 1 }}>{st.value}</div>
                      <div className="micro" style={{ marginTop: 6 }}>{st.label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
              </div>
            </BracketFrame>
          );
        })()}

        {/* Stats — circle dials on screen, flat grid in screenshot */}
        {!justFinished && !capturing && (
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            <SubDial label="Duration" value={duration ?? '—'} sub={duration ? 'min' : ''} size={90} />
            <SubDial label="Volume" value={Math.round(vol).toLocaleString('en-US')} sub="kg" size={90} gold />
            <SubDial label="Sets" value={s.entries.reduce((c,e) => c + e.sets.filter(x => x.done).length, 0)} size={90} />
          </div>
        )}
        {capturing && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', marginTop: -8 }}>
            {[['DURATION', duration != null ? `${duration} min` : '—', false], ['VOLUME', `${Math.round(vol).toLocaleString('en-US')} kg`, true], ['SETS', s.entries.reduce((c,e) => c + e.sets.filter(x => x.done).length, 0), false]].map(([label, value, gold], idx) => (
              <div key={label} style={{ padding: '6px 12px', borderRight: idx < 2 ? `0.5px solid ${UI.hair}` : 'none', textAlign: 'center' }}>
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 3 }}>{label}</div>
                <div className="num" style={{ fontSize: 16, color: gold ? UI.gold : UI.ink }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Volume delta vs previous same-day session */}
        {volDelta != null && (
          <div className="micro" style={{ textAlign: 'center', marginTop: -8, color: volDelta >= 0 ? UI.gold : UI.inkFaint }}>
            {volDelta >= 0 ? '↑' : '↓'} {Math.abs(Math.round(volDelta)).toLocaleString('en-US')} kg · vs last {s.dayName}
          </div>
        )}

        {/* Exercise entries */}
        <div style={{ position: 'relative' }}>
          {capturing && <div style={{ height: '0.5px', background: UI.gold, marginBottom: 14 }} />}
          {muscleGroups.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {muscleGroups.map(tag => (
                <span key={tag} className="micro" style={{
                  color: UI.inkFaint, border: `0.5px solid ${UI.hair}`,
                  borderRadius: 4, padding: '2px 8px',
                }}>{tag}</span>
              ))}
            </div>
          )}
          <Bezel>EXERCISES</Bezel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
            {(() => {
              // Group entries: consecutive entries with the same supersetGroup are bundled
              const groups = [];
              let idx = 0;
              while (idx < s.entries.length) {
                const e = s.entries[idx];
                if (e.supersetGroup) {
                  const members = [{ entry: e, idx }];
                  let j = idx + 1;
                  while (j < s.entries.length && s.entries[j].supersetGroup === e.supersetGroup) {
                    members.push({ entry: s.entries[j], idx: j });
                    j++;
                  }
                  groups.push({ type: 'superset', members });
                  idx = j;
                } else {
                  groups.push({ type: 'standalone', entry: e, idx });
                  idx++;
                }
              }

              const renderEntry = (e, i) => {
                const prev = prevEntryMap[e.exId];
                const exName = store.exercises.find(ex => ex.id === e.exId)?.name ?? e.name;
                const hasImprovement = e.sets.some((st, j) => isPR(st, e.exId) || isImprovement(st, prev?.sets?.[j]));
                return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <div className="display" style={{ fontSize: 17, color: UI.ink, lineHeight: 1.1 }}>{exName}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {e.sets.filter(st => !st.skipped).map((st, j) => {
                      const pr = isPR(st, e.exId);
                      const highlight = pr || isImprovement(st, prev?.sets?.[j]);
                      const decline = !hasImprovement && isDecline(st, prev?.sets?.[j]);
                      return (
                        <span key={j} style={{
                          opacity: st.done ? 1 : 0.3,
                          background: highlight ? UI.goldFaint : decline ? 'rgba(200,116,105,0.08)' : 'transparent',
                          border: `0.5px solid ${highlight ? UI.goldSoft : decline ? 'rgba(200,116,105,0.35)' : UI.hair}`,
                          borderRadius: 6, padding: '3px 8px',
                          fontFamily: UI.fontNum, fontSize: 12,
                          color: highlight ? UI.goldLight : decline ? 'rgba(200,116,105,0.85)' : UI.ink,
                        }}>
                          {st.kg ?? '—'}<span style={{ color: highlight ? UI.gold : decline ? 'rgba(200,116,105,0.6)' : UI.inkFaint, fontSize: 10 }}>kg</span><span style={{ color: highlight ? UI.gold : decline ? 'rgba(200,116,105,0.6)' : UI.inkFaint, margin: '0 1px' }}>×</span>{(st.repsL != null || st.repsR != null) ? `L${st.repsL ?? '?'}/R${st.repsR ?? '?'}` : (st.reps ?? '—')}{pr && <i className="fa-solid fa-dumbbell" style={{ fontSize: 8, color: UI.gold, marginLeft: 4 }} />}
                        </span>
                      );
                    })}
                    {(() => { const n = e.sets.filter(st => st.skipped).length; return n > 0 && (
                      <span style={{ border: `0.5px solid ${UI.hair}`, borderRadius: 6, padding: '3px 8px', fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, letterSpacing: '0.05em' }}>
                        {n} SET{n > 1 ? 'S' : ''} SKIPPED
                      </span>
                    ); })()}
                  </div>
                  {e.note && <div className="micro" style={{ color: UI.inkFaint, marginTop: 6, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>{e.note}</div>}
                </div>
                );
              };

              return groups.map((g, gi) => (
                <div key={gi}>
                  {g.type === 'superset' ? (
                    <div style={{ borderLeft: `2px solid ${UI.goldSoft}`, paddingLeft: 12 }}>
                      <div className="micro" style={{ color: UI.gold, marginBottom: 10, letterSpacing: '0.12em' }}>SUPERSET</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {g.members.map(({ entry: e, idx: i }) => renderEntry(e, i))}
                      </div>
                    </div>
                  ) : renderEntry(g.entry, g.idx)}
                  {gi < groups.length - 1 && <Hairline style={{ marginTop: 14 }} />}
                </div>
              ));
            })()}
          </div>
          {capturing && (
            <img src="icons/zane-logo-2.png" style={{ position: 'absolute', bottom: 2, right: 0, width: 90, opacity: 0.5, transform: 'scaleX(-1)' }} />
          )}
          {capturing && <div style={{ height: '0.5px', background: UI.gold, marginTop: 10 }} />}
        </div>
      </div>


      {editing && (
        <SessionEditSheet
          session={s}
          duration={duration}
          exercises={store.exercises}
          onClose={() => setEditing(false)}
          onSave={(patch) => {
            setStore(st => ({ ...st, sessions: st.sessions.map(x => x.id === s.id ? { ...x, ...patch } : x) }));
            setEditing(false);
          }}
        />
      )}
      {confirmEl}
    </Screen>
  );
}

function SessionEditSheet({ session, duration, exercises, onClose, onSave }) {
  const [draftDate, setDraftDate] = useStateL(session.date ? session.date.slice(0, 10) : '');
  const [draftDuration, setDraftDuration] = useStateL(duration != null ? String(Math.round(duration / 5) * 5) : '0');
  const [draftEntries, setDraftEntries] = useStateL(() => JSON.parse(JSON.stringify(session.entries)));

  const updateSet = (eIdx, sIdx, patch) => {
    setDraftEntries(entries => entries.map((e, i) =>
      i !== eIdx ? e : { ...e, sets: e.sets.map((st, k) => k !== sIdx ? st : { ...st, ...patch }) }
    ));
  };

  const save = () => {
    const patch = { entries: draftEntries };
    if (draftDate && draftDate !== session.date?.slice(0, 10)) {
      const original = new Date(session.date);
      const [y, m, d] = draftDate.split('-').map(Number);
      original.setFullYear(y, m - 1, d);
      patch.date = original.toISOString();
    }
    const mins = parseInt(draftDuration, 10);
    if (!isNaN(mins) && mins > 0 && session.ended) {
      patch.startedAt = new Date(new Date(session.ended) - mins * 60000).toISOString();
    }
    onSave(patch);
  };

  const inputStyle = {
    background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`,
    borderRadius: 10, padding: '11px 14px', color: UI.ink,
    fontFamily: UI.fontNum, fontSize: 16, outline: 'none',
    width: '100%', boxSizing: 'border-box', display: 'block',
  };
  const numInputStyle = {
    width: 64, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`,
    borderRadius: 8, color: UI.ink, padding: '9px 6px', textAlign: 'center',
    fontFamily: UI.fontNum, fontSize: 15, outline: 'none', flexShrink: 0,
  };

  return (
    <Sheet open={true} onClose={onClose} title="Edit session">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 160 }}>
        <div>
          <span className="label">Date</span>
          <div style={{ width: '100%', overflow: 'hidden', borderRadius: 10, marginTop: 6 }}>
            <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)} style={{ ...inputStyle, textAlign: 'center', textAlignLast: 'center' }} />
          </div>
        </div>
        <div>
          <span className="label">Duration</span>
          <select value={draftDuration} onChange={e => setDraftDuration(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', textAlignLast: 'center', marginTop: 6 }}>
            {Array.from({ length: 37 }, (_, i) => i * 5).map(m => (
              <option key={m} value={String(m)}>{m === 0 ? '—' : `${m} min`}</option>
            ))}
          </select>
        </div>
        <div style={{ borderTop: `0.5px solid ${UI.hair}`, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {draftEntries.map((e, eIdx) => {
            const isUnilateral = !!(exercises?.find(ex => ex.id === e.exId)?.unilateral)
              || e.sets.some(st => st.repsL != null || st.repsR != null);
            return (
              <div key={eIdx}>
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>{(exercises?.find(ex => ex.id === e.exId)?.name ?? e.name).toUpperCase()}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {e.sets.map((st, sIdx) => (
                    <div key={sIdx} style={{ display: 'flex', alignItems: 'center', gap: 8, background: UI.bgInset, borderRadius: 10, padding: '8px 12px' }}>
                      <span className="num" style={{ width: 20, fontSize: 11, color: UI.inkFaint, flexShrink: 0 }}>{sIdx + 1}</span>
                      <input type="number" inputMode="decimal" step="0.5" value={st.kg ?? ''}
                        placeholder="—" onFocus={e => e.target.select()}
                        onChange={ev => updateSet(eIdx, sIdx, { kg: ev.target.value === '' ? null : +ev.target.value })}
                        style={numInputStyle} />
                      <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>kg</span>
                      <span style={{ color: UI.hair, fontSize: 14, margin: '0 2px', fontFamily: UI.fontDisplay, fontStyle: 'italic' }}>×</span>
                      {isUnilateral ? (
                        <>
                          <input type="number" inputMode="numeric" value={st.repsL ?? ''}
                            placeholder="—" onFocus={e => e.target.select()}
                            onChange={ev => updateSet(eIdx, sIdx, { repsL: ev.target.value === '' ? null : +ev.target.value })}
                            style={numInputStyle} />
                          <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>L</span>
                          <input type="number" inputMode="numeric" value={st.repsR ?? ''}
                            placeholder="—" onFocus={e => e.target.select()}
                            onChange={ev => updateSet(eIdx, sIdx, { repsR: ev.target.value === '' ? null : +ev.target.value })}
                            style={numInputStyle} />
                          <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>R</span>
                        </>
                      ) : (
                        <>
                          <input type="number" inputMode="numeric" value={st.reps ?? ''}
                            placeholder="—" onFocus={e => e.target.select()}
                            onChange={ev => updateSet(eIdx, sIdx, { reps: ev.target.value === '' ? null : +ev.target.value })}
                            style={numInputStyle} />
                          <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>reps</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={save} style={{ flex: 2 }}>Save</Btn>
        </div>
      </div>
    </Sheet>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────
function SettingsScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [nickname, setNickname] = useStateL(store.user?.name || '');
  const [restOpen, setRestOpen] = useStateL(false);
  const [appearanceOpen, setAppearanceOpen] = useStateL(false);
  const [pushOpen, setPushOpen] = useStateL(false);
  const [dataOpen, setDataOpen] = useStateL(false);
  const [importing, setImporting] = useStateL(false);
  const [swVersion, setSwVersion] = useStateL('');
  const [pushStatus, setPushStatus] = useStateL(null);
  const [pushEnabled, setPushEnabled] = useStateL(() => store.settings?.pushEnabled ?? localStorage.getItem('logbook-push-enabled') === 'true');
  const [pushKeyDraft, setPushKeyDraft] = useStateL('');
  const [pushKeyModalOpen, setPushKeyModalOpen] = useStateL(false);
  const [cycleWeekView, setCycleWeekView] = useStateL(() => store.settings?.cycleWeekView ?? localStorage.getItem('logbook-cycle-week-view') === 'true');
  const [darkMode, setDarkMode] = useStateL(() => store.settings?.darkMode ?? localStorage.getItem('logbook-dark-mode') ?? 'dark');
  const pushStatusTimer = React.useRef(null);
  useEffectL(() => {
    if (!('caches' in window)) return;
    caches.keys().then(keys => {
      const name = keys.find(k => k.startsWith('zane-'));
      if (name) setSwVersion(name.replace('zane-', ''));
    });
  }, []);

  const togglePush = () => {
    if (!pushEnabled) {
      const existingKey = store.settings?.pushoverUserKey;
      if (existingKey) {
        setPushEnabled(true);
        localStorage.setItem('logbook-push-enabled', 'true');
        setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: true } }));
      } else {
        setPushKeyDraft('');
        setPushKeyModalOpen(true);
      }
    } else {
      setPushEnabled(false);
      localStorage.setItem('logbook-push-enabled', 'false');
      setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: false } }));
    }
  };

  const pushKeyValid = /^[a-zA-Z0-9]{30}$/.test(pushKeyDraft.trim());

  const confirmPushKey = () => {
    const key = pushKeyDraft.trim();
    if (!pushKeyValid) return;
    setPushEnabled(true);
    localStorage.setItem('logbook-push-enabled', 'true');
    setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: true, pushoverUserKey: key } }));
    setPushKeyModalOpen(false);
  };

  const testPushover = async (delaySeconds = 0) => {
    clearTimeout(pushStatusTimer.current);
    setPushStatus(delaySeconds > 0 ? `Sending… Lock screen now!` : 'Sending…');
    try {
      const res = await fetch(LB.PUSHOVER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LB.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'Rest done — keep going! 💪', title: 'Zane Test', delaySeconds, nonce: String(Date.now()), userKey: store.settings?.pushoverUserKey ?? '' }),
      });
      if (res.status === 202) {
        setPushStatus(`✓ Scheduled — notification in ~${delaySeconds}s`);
        pushStatusTimer.current = setTimeout(() => setPushStatus(null), (delaySeconds + 15) * 1000);
      } else {
        const data = await res.json();
        setPushStatus(data.status === 1 ? '✓ Sent' : `Error: ${JSON.stringify(data)}`);
        pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
      }
    } catch (e) {
      setPushStatus(`Error: ${e.message}`);
      pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
    }
  };

  const saveNickname = () => {
    const trimmed = nickname.trim();
    if (!trimmed || trimmed === store.user?.name) return;
    setStore(s => ({ ...s, user: { ...s.user, name: trimmed } }));
  };

  const exportData = (filename) => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || `zane-${LB.todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importData = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      let backup;
      try {
        backup = JSON.parse(await file.text());
      } catch (_) {
        await confirm('The selected file is not valid JSON.', { title: 'Invalid file', ok: 'OK' });
        return;
      }
      if (!backup.sessions || !backup.exercises || !backup.schedules) {
        await confirm('This file does not look like a Zane backup.', { title: 'Invalid backup', ok: 'OK' });
        return;
      }
      const latestSession = [...(backup.sessions || [])].filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0];
      const backupDate = latestSession ? new Date(latestSession.ended).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : 'unknown date';
      const ok = await confirm(
        `This backup contains data up to ${backupDate}. Your current data will be downloaded first, then replaced.`,
        { title: 'Restore backup?', ok: 'Restore', danger: true }
      );
      if (!ok) return;
      exportData(`zane-before-import-${LB.todayISO()}.json`);
      setImporting(true);
      try {
        await LB.importFromBackup(backup, userId);
        window.location.reload();
      } catch (err) {
        setImporting(false);
        await confirm(`Import failed: ${err.message || 'Unknown error'}`, { title: 'Error', ok: 'OK' });
      }
    };
    input.click();
  };

  const handleSignOut = async () => {
    await LB.signOut();
  };

  const handleDeleteAll = async () => {
    if (!await confirm('This action cannot be undone.', { title: 'Delete all data?', ok: 'Delete all', danger: true })) return;
    await LB.deleteAllData(userId);
    await LB.signOut();
  };

  return (
    <Screen>
      <TopBar title="Settings" onBack={() => go({ name: 'home' })} />
      <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Account */}
        <Frame style={{ padding: '14px 16px' }}>
          <span className="label">Nickname</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <input
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              onBlur={saveNickname}
              onKeyDown={e => e.key === 'Enter' && (e.target.blur())}
              placeholder="Your name"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: UI.ink, fontFamily: UI.fontUi, fontSize: 16, padding: 0,
              }}
            />
          </div>
          <div className="micro" style={{ marginTop: 8 }}>
            Logged in as {store.user?.email || userId}
          </div>
        </Frame>

        {/* Rest Settings */}
        <Frame style={{ padding: '14px 16px' }}>
          <button onClick={() => setRestOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}>
            <span className="label" style={{ marginBottom: 0 }}>Rest settings</span>
            <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round" style={{ transition: 'transform 0.2s', transform: restOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              <path d="M2 1l5 5-5 5"/>
            </svg>
          </button>
          {restOpen && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                ['Default', 'restDefault', 120],
                ['Big',     'restBig',     180],
                ['Medium',  'restMedium',  120],
                ['Small',   'restSmall',   90],
              ].map(([label, key, def]) => (
                <div key={key}>
                  <div className="micro" style={{ marginBottom: 6 }}>{label.toUpperCase()}</div>
                  <Stepper
                    value={store.settings?.[key] || def}
                    step={15} min={0} suffix="s"
                    onChange={(v) => setStore(s => ({ ...s, settings: { ...s.settings, [key]: v } }))}
                  />
                </div>
              ))}
            </div>
          )}
        </Frame>

        {/* Appearance */}
        <Frame style={{ padding: '14px 16px' }}>
          <button onClick={() => setAppearanceOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}>
            <span className="label" style={{ marginBottom: 0 }}>Appearance</span>
            <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round" style={{ transition: 'transform 0.2s', transform: appearanceOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              <path d="M2 1l5 5-5 5"/>
            </svg>
          </button>
          {appearanceOpen && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div className="micro" style={{ marginBottom: 8 }}>ACCENT COLOR</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {Object.entries(window.ACCENT_PALETTE).map(([key, c]) => {
                    const active = (store.settings?.accentColor ?? 'copper') === key;
                    return (
                      <button key={key} onClick={() => {
                        window.applyAccentColor(key);
                        localStorage.setItem('logbook-accent-color', key);
                        setStore(s => ({ ...s, settings: { ...s.settings, accentColor: key } }));
                      }} title={c.label} style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: c.hex,
                        border: active ? `2.5px solid ${UI.ink}` : '2.5px solid transparent',
                        boxShadow: active ? `0 0 0 1px ${c.hex}` : 'none',
                        cursor: 'pointer', padding: 0, flexShrink: 0,
                        WebkitTapHighlightColor: 'transparent',
                      }} />
                    );
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: `0.5px solid ${UI.hair}` }}>
                <div>
                  <span className="label" style={{ marginBottom: 0 }}>Week view in cycle mode</span>
                  <div className="micro" style={{ marginTop: 4, maxWidth: 220 }}>Show Mon–Sun instead of cycle days in the date strip</div>
                </div>
                <div
                  onClick={() => {
                    const next = !cycleWeekView;
                    setCycleWeekView(next);
                    localStorage.setItem('logbook-cycle-week-view', String(next));
                    setStore(s => ({ ...s, settings: { ...s.settings, cycleWeekView: next } }));
                  }}
                  style={{
                    width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0,
                    background: cycleWeekView ? 'var(--accent)' : UI.bgInset,
                    border: `0.5px solid ${cycleWeekView ? UI.goldSoft : UI.hairStrong}`,
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <div style={{ position: 'absolute', top: 3, left: cycleWeekView ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: cycleWeekView ? '#0a0805' : UI.inkFaint, transition: 'left 0.2s' }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: `0.5px solid ${UI.hair}` }}>
                <div>
                  <span className="label" style={{ marginBottom: 0 }}>Pure black background</span>
                  <div className="micro" style={{ marginTop: 4, maxWidth: 220 }}>Use OLED black instead of dark gray</div>
                </div>
                <div
                  onClick={() => {
                    const next = darkMode === 'black' ? 'dark' : 'black';
                    setDarkMode(next);
                    localStorage.setItem('logbook-dark-mode', next);
                    setStore(s => ({ ...s, settings: { ...s.settings, darkMode: next } }));
                  }}
                  style={{
                    width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0,
                    background: darkMode === 'black' ? 'var(--accent)' : UI.bgInset,
                    border: `0.5px solid ${darkMode === 'black' ? UI.goldSoft : UI.hairStrong}`,
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <div style={{ position: 'absolute', top: 3, left: darkMode === 'black' ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: darkMode === 'black' ? '#0a0805' : UI.inkFaint, transition: 'left 0.2s' }} />
                </div>
              </div>
            </div>
          )}
        </Frame>

        {/* Push notifications */}
        <Frame style={{ padding: '14px 16px' }}>
          <button onClick={() => setPushOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}>
            <span className="label" style={{ marginBottom: 0 }}>Push notifications</span>
            <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round" style={{ transition: 'transform 0.2s', transform: pushOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              <path d="M2 1l5 5-5 5"/>
            </svg>
          </button>
          {pushOpen && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="micro" style={{ color: UI.inkSoft }}>Enabled</span>
                <div onClick={togglePush} style={{
                  width: 44, height: 26, borderRadius: 13, cursor: 'pointer',
                  background: pushEnabled ? 'var(--accent)' : UI.bgInset,
                  border: `0.5px solid ${pushEnabled ? UI.goldSoft : UI.hairStrong}`,
                  position: 'relative', transition: 'background 0.2s',
                }}>
                  <div style={{
                    position: 'absolute', top: 3, left: pushEnabled ? 21 : 3,
                    width: 18, height: 18, borderRadius: 9,
                    background: pushEnabled ? '#0a0805' : UI.inkFaint,
                    transition: 'left 0.2s',
                  }} />
                </div>
              </div>
              {store.settings?.pushoverUserKey && (
                <button onClick={() => { setPushKeyDraft(store.settings.pushoverUserKey); setPushKeyModalOpen(true); }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'left' }}>
                  Change user key
                </button>
              )}
              {pushEnabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn kind="ghost" onClick={() => testPushover(0)} style={{ flex: 1, fontSize: 11, minHeight: 36 }}>Now</Btn>
                    <Btn kind="ghost" onClick={() => testPushover(10)} style={{ flex: 1, fontSize: 11, minHeight: 36 }}>10s</Btn>
                    <Btn kind="ghost" onClick={() => testPushover(30)} style={{ flex: 1, fontSize: 11, minHeight: 36 }}>30s</Btn>
                  </div>
                  {pushStatus && (
                    <div className="micro" style={{ color: pushStatus.startsWith('✓') ? UI.gold : UI.inkSoft, textAlign: 'center' }}>
                      {pushStatus}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Frame>

        <Frame style={{ padding: '14px 16px' }}>
          <button onClick={() => setDataOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}>
            <span className="label" style={{ marginBottom: 0 }}>Backup &amp; Restore</span>
            <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round" style={{ transition: 'transform 0.2s', transform: dataOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              <path d="M2 1l5 5-5 5"/>
            </svg>
          </button>
          {dataOpen && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Btn kind="ghost" onClick={() => exportData()} style={{ fontSize: 12 }}>Export data (JSON)</Btn>
              <Btn kind="ghost" onClick={importData} disabled={importing} style={{ fontSize: 12 }}>{importing ? 'Importing…' : 'Import data (JSON)'}</Btn>
            </div>
          )}
        </Frame>
        <Btn kind="ghost" onClick={async () => {
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
          window.location.reload(true);
        }} style={{ fontSize: 12 }}>Clear app cache & reload</Btn>
        <Btn kind="ghost" onClick={handleSignOut} style={{ color: UI.danger, borderColor: 'rgba(200,116,105,0.25)', fontSize: 12 }}>
          Sign out
        </Btn>
        <Btn kind="ghost" onClick={handleDeleteAll} style={{ color: UI.danger, borderColor: 'rgba(200,116,105,0.25)', opacity: 0.6, fontSize: 12 }}>
          Delete all data
        </Btn>
        <div className="micro" style={{ textAlign: 'center', marginTop: 8 }}>
          Zane · {swVersion || '…'} · Data in Supabase
        </div>
      </div>
      {confirmEl}
      <Sheet open={pushKeyModalOpen} onClose={() => setPushKeyModalOpen(false)} title="Pushover User Key">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, color: UI.inkSoft, lineHeight: 1.5 }}>
            Enter your Pushover user key. Find it at pushover.net after logging in.
          </div>
          <input
            value={pushKeyDraft}
            onChange={e => setPushKeyDraft(e.target.value)}
            placeholder="uXXXXXXXXXXXXXXXXXXXX"
            style={{
              background: UI.bgInset, border: `0.5px solid ${pushKeyDraft && !pushKeyValid ? 'rgba(200,116,105,0.5)' : UI.hairStrong}`,
              borderRadius: 10, padding: '10px 14px',
              fontFamily: UI.fontUi, fontSize: 13, color: UI.ink,
              outline: 'none', width: '100%', boxSizing: 'border-box',
            }}
            autoCorrect="off" autoCapitalize="none" spellCheck={false}
          />
          {pushKeyDraft && !pushKeyValid && (
            <div className="micro" style={{ color: 'rgba(200,116,105,0.85)' }}>Invalid key — must be 30 alphanumeric characters</div>
          )}
          <Btn onClick={confirmPushKey} disabled={!pushKeyValid}>Enable notifications</Btn>
        </div>
      </Sheet>
    </Screen>
  );
}

Object.assign(window.Screens, { LibraryScreen, ExerciseCreator, ExerciseDetailScreen, HistoryScreen, SessionDetailScreen, SettingsScreen });
