/* Library + History + Session detail + Settings */

const { useState: useStateL, useMemo: useMemoL, useRef: useRefL, useEffect: useEffectL } = React;

// Persists library filter state across navigation (survives remounts)
const _lib = { tab: 'recent', q: '', filterTags: [], filterRestCats: [], filterUnilateral: null, filterPlan: null, filterEquipment: [], filtersOpen: false };

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
  const [filterEquipment, setFilterEquipment] = useStateL(_lib.filterEquipment);
  const toggleEquipment = (v) => setFilterEquipment(t => { const n = t.includes(v) ? t.filter(x => x !== v) : [...t, v]; _lib.filterEquipment = n; return n; });
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

  const editSelected = () => {
    const ordered = filtered.filter(e => selected.has(e.id)).map(e => e.id);
    if (ordered.length === 0) return;
    exitSelect();
    const [first, ...rest] = ordered;
    go({ name: 'exercise', exId: first, editQueue: rest, editQueueTotal: ordered.length, autoEdit: true });
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
      ? Math.max(0, ...(entry.sets || []).filter(s => s.kg && s.reps).map(s => LB.e1rm(s.kg, s.reps)), 0)
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
        const matchEquipment = filterEquipment.length === 0 ||
          (filterEquipment.includes('none') && !e.equipment) ||
          (e.equipment && filterEquipment.includes(e.equipment));
        return matchSearch && matchTags && matchRest && matchUnilateral && matchPlan && matchEquipment;
      })
      .sort((a,b) => a.name.localeCompare(b.name));
  }, [store.exercises, q, filterTags, filterRestCats, filterUnilateral, filterPlan, filterEquipment, planExIds]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(e => selected.has(e.id));
  const selectAll = () => setSelected(new Set(filtered.map(e => e.id)));
  const deselectAll = () => setSelected(new Set());

  const topBarRight = selecting ? (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <button onClick={allFilteredSelected ? deselectAll : selectAll} style={{
        background: 'none', border: 'none', color: UI.gold, fontFamily: UI.fontUi, fontSize: 11,
        letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', padding: '4px 8px',
      }}>{allFilteredSelected ? 'None' : 'All'}</button>
      <button onClick={exitSelect} style={{ background: 'none', border: 'none', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', padding: '4px 8px' }}>
        Cancel
      </button>
    </div>
  ) : (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {store.exercises.length > 0 && (
        <button onClick={() => { setTab('all'); setSelecting(true); }} style={{
          background: 'transparent', border: `1px solid ${UI.hairStrong}`,
          borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
          color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>Select</button>
      )}
      <button onClick={() => setCreating(true)} style={{
        width: 32, height: 32, borderRadius: 4,
        border: `1px solid ${UI.goldSoft}`, background: UI.goldFaint,
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
          const activeCount = filterTags.length + filterRestCats.length + filterEquipment.length + (filterUnilateral !== null ? 1 : 0) + (filterPlan !== null ? 1 : 0);
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
                  border: `1px solid ${activeCount > 0 ? UI.goldSoft : UI.hairStrong}`,
                  borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
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
          const top = lastEntry?.sets?.find(s => s.kg != null);
          const trendColor = trend === 'up' ? UI.ok : trend === 'down' ? UI.danger : UI.inkFaint;
          const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : trend === 'same' ? '→' : null;
          return (
            <React.Fragment key={ex.id}>
            <div
              onClick={() => go({ name: 'exercise', exId: ex.id })}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '13px 0',
                cursor: 'pointer',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 19, color: isToday ? UI.gold : UI.ink, lineHeight: 1.1, marginBottom: 3 }}>{ex.name}</div>
                <div className="num" style={{ fontSize: 10, color: isToday ? UI.gold : UI.inkFaint, letterSpacing: '0.05em', marginBottom: 4 }}>
                  {isToday ? 'today' : `${days}d ago`}
                  {top && ` · ${top.kg}${UI.unit()} × ${LB.effReps(top) ?? '?'}`}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {ex.tags?.map(t => <Pill key={t}>{t}</Pill>)}
                  {ex.category && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>{ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}</Pill>}
                  {ex.unilateral && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>Unilateral</Pill>}
                  {ex.equipment ? <Pill style={{ color: UI.inkFaint, borderColor: UI.hair, fontSize: 8 }}>{EQUIPMENT_TYPES.find(t => t.key === ex.equipment)?.label ?? ex.equipment}</Pill> : <Pill style={{ color: 'rgba(var(--danger-rgb),0.5)', borderColor: 'rgba(var(--danger-rgb),0.2)', fontSize: 8 }}>No equipment</Pill>}
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
            {ri < recent.length - 1 && <div className="knurl" />}
            </React.Fragment>
          );
        })}

        {tab === 'all' && filtered.map((e, fi) => {
          const isSelected = selected.has(e.id);
          return (
            <React.Fragment key={e.id}>
            <div
              onClick={() => selecting ? toggleSelect(e.id) : go({ name: 'exercise', exId: e.id })}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '13px 0',
                cursor: 'pointer',
                background: isSelected ? 'rgba(var(--danger-rgb),0.04)' : 'transparent',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 19, color: isSelected ? UI.danger : UI.ink, lineHeight: 1.1 }}>{e.name}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {e.tags?.map(t => <Pill key={t}>{t}</Pill>)}
                  {e.category && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>{e.category.charAt(0).toUpperCase() + e.category.slice(1)}</Pill>}
                  {e.unilateral && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>Unilateral</Pill>}
                  {e.equipment ? <Pill style={{ color: UI.inkFaint, borderColor: UI.hair, fontSize: 8 }}>{EQUIPMENT_TYPES.find(t => t.key === e.equipment)?.label ?? e.equipment}</Pill> : <Pill style={{ color: 'rgba(var(--danger-rgb),0.5)', borderColor: 'rgba(var(--danger-rgb),0.2)', fontSize: 8 }}>No equipment</Pill>}
                  {planExIds.has(e.id) && <span style={{ color: UI.inkFaint, fontSize: 9, letterSpacing: '0.05em' }}>◆</span>}
                </div>
              </div>
              {selecting ? (
                <div style={{
                  width: 20, height: 20, borderRadius: 3, flexShrink: 0,
                  border: `1px solid ${isSelected ? UI.danger : UI.hairStrong}`,
                  background: isSelected ? UI.danger : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSelected && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                </div>
              ) : (
                <ChevronRight />
              )}
            </div>
            {fi < filtered.length - 1 && <div className="knurl" />}
            </React.Fragment>
          );
        })}
        {tab === 'all' && filtered.length === 0 && (
          <Empty title="No exercises" action={<Btn onClick={() => setCreating(true)}>Add exercise</Btn>} icon={ICON_BARBELL} />
        )}
      </div>

      {selecting && (
        <div style={(() => {
          const sidebar = window.innerWidth >= 768;
          return {
            position: 'fixed',
            bottom: sidebar ? 'calc(env(safe-area-inset-bottom, 0px) + 8px)' : 'calc(76px + env(safe-area-inset-bottom, 8px))',
            left: sidebar ? 220 : '50%',
            transform: sidebar ? 'none' : 'translateX(-50%)',
            width: sidebar ? 'calc(100% - 220px)' : '100%',
            maxWidth: sidebar ? 'none' : 440,
            padding: '12px 22px',
            background: 'rgba(var(--bg-rgb),0.92)', borderTop: `0.5px solid ${UI.hair}`,
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            zIndex: 15,
          };
        })()}>
          <span className="micro" style={{ color: UI.inkSoft }}>
            {selected.size === 0 ? 'Tap exercises to select' : `${selected.size} selected`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" onClick={editSelected}
              disabled={selected.size === 0}
              style={{ color: UI.gold, borderColor: UI.goldSoft, opacity: selected.size === 0 ? 0.4 : 1, minHeight: 36, padding: '6px 14px', fontSize: 11 }}>
              Edit
            </Btn>
            <Btn kind="ghost" onClick={deleteSelected}
              disabled={selected.size === 0}
              style={{ color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.25)', opacity: selected.size === 0 ? 0.4 : 1, minHeight: 36, padding: '6px 14px', fontSize: 11 }}>
              Delete
            </Btn>
          </div>
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
                <span className="micro" style={{ color: UI.gold }}>EQUIPMENT</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <Pill gold={filterEquipment.includes('none')} onClick={() => toggleEquipment('none')} style={{ cursor: 'pointer' }}>No equipment set</Pill>
                {EQUIPMENT_TYPES.map(({ key, label }) => (
                  <Pill key={key} gold={filterEquipment.includes(key)} onClick={() => toggleEquipment(key)} style={{ cursor: 'pointer' }}>{label}</Pill>
                ))}
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

const EQUIPMENT_TYPES = [
  { key: 'barbell_dual',   label: 'Dual plates' },
  { key: 'barbell_single', label: 'Single plate' },
  { key: 'cable',          label: 'Cable' },
  { key: 'machine',        label: 'Machine' },
  { key: 'dumbbell',       label: 'Dumbbell' },
];

function ExerciseCreator({ onClose, setStore, onCreated, initialName = '' }) {
  const [name, setName] = useStateL(initialName);
  const [selectedTags, setSelectedTags] = useStateL([]);
  const [category, setCategory] = useStateL(null);
  const [unilateral, setUnilateral] = useStateL(false);
  const [equipment, setEquipment] = useStateL('barbell_dual');
  const [progressionReps, setProgressionReps] = useStateL(null);
  const toggleTag = (m) => setSelectedTags(t => t.includes(m) ? t.filter(x => x !== m) : [...t, m]);
  const save = () => {
    if (!name.trim()) return;
    const ex = { id: LB.uid(), name: name.trim(), tags: selectedTags, category: category || null, unilateral, equipment: equipment || null, note: '', progression_reps: progressionReps ?? null };
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
          <span className="label">Equipment</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {EQUIPMENT_TYPES.map(({ key, label }) => (
              <Pill key={key} gold={equipment === key} onClick={() => setEquipment(key)} style={{ cursor: 'pointer' }}>{label}</Pill>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Movement type</span>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Pill gold={unilateral} onClick={() => setUnilateral(v => !v)} style={{ cursor: 'pointer' }}>Unilateral</Pill>
          </div>
        </div>
        <div>
          <span className="label">Rep target</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <Pill gold={progressionReps != null} onClick={() => setProgressionReps(v => v == null ? 12 : null)} style={{ cursor: 'pointer' }}>
              {progressionReps != null ? 'On' : 'Off'}
            </Pill>
            {progressionReps != null
              ? <Stepper value={progressionReps} onChange={v => setProgressionReps(Math.max(1, Math.round(v)))} step={1} min={1} />
              : <span style={{ color: UI.inkFaint, fontSize: 13 }}>Uses planned reps per day</span>
            }
          </div>
        </div>
        <Btn onClick={save} style={{ opacity: name.trim() ? 1 : 0.4 }} disabled={!name.trim()}>Create</Btn>
      </div>
    </Sheet>
  );
}

// ─── EXERCISE DETAIL ─────────────────────────────────────────────────
function ExerciseDetailScreen(props) {
  const ex = LB.findExercise(props.store, props.exId);
  // Redirect from an effect — never call go() during render. The inner
  // component mounts only when the exercise exists, so its hook order stays
  // stable even if the exercise is deleted while the screen is open.
  useEffectL(() => { if (!ex) props.go(props.back || { name: 'lib' }); }, [!!ex]);
  if (!ex) return null;
  return <ExerciseDetailScreenInner {...props} ex={ex} />;
}

function ExerciseDetailScreenInner({ store, setStore, go, exId, back, editQueue = [], editQueueTotal = 0, autoEdit = false, ex }) {
  const [confirmEl, confirm] = useConfirm();
  const [editMode, setEditMode] = useStateL(autoEdit);
  const [editName, setEditName] = useStateL(autoEdit ? ex.name : '');
  const [editTags, setEditTags] = useStateL(autoEdit ? [...(ex.tags || [])] : []);
  const [editCategory, setEditCategory] = useStateL(autoEdit ? (ex.category || null) : null);
  const [editUnilateral, setEditUnilateral] = useStateL(autoEdit ? !!ex.unilateral : false);
  const [editEquipment, setEditEquipment] = useStateL(autoEdit ? (ex.equipment || null) : null);
  const [editProgressionReps, setEditProgressionReps] = useStateL(autoEdit ? (ex.progression_reps ?? null) : null);
  const [editNote, setEditNote] = useStateL(false);
  const [noteVal, setNoteVal] = useStateL(ex.note || '');

  const advanceQueue = () => {
    if (editQueue.length > 0) {
      const [next, ...rest] = editQueue;
      go({ name: 'exercise', exId: next, editQueue: rest, editQueueTotal, autoEdit: true });
    } else {
      go(back || { name: 'lib' });
    }
  };

  const startEdit = () => { setEditName(ex.name); setEditTags([...(ex.tags || [])]); setEditCategory(ex.category || null); setEditUnilateral(!!ex.unilateral); setEditEquipment(ex.equipment || null); setEditProgressionReps(ex.progression_reps ?? null); setEditMode(true); };
  const cancelEdit = () => { if (autoEdit) advanceQueue(); else setEditMode(false); };
  const saveEdit = () => {
    if (!editName.trim()) return;
    const newProgressionReps = editProgressionReps ?? null;
    const repsChanged = newProgressionReps !== (ex.progression_reps ?? null);
    setStore(s => {
      const exercises = s.exercises.map(e => e.id === exId
        ? { ...e, name: editName.trim(), tags: editTags, category: editCategory || null, unilateral: editUnilateral, equipment: editEquipment || null, progression_reps: newProgressionReps }
        : e);
      const schedules = (repsChanged && newProgressionReps != null)
        ? s.schedules.map(sch => ({ ...sch, days: sch.days.map(day => ({ ...day, items: (day.items || []).map(it => it.exId === exId ? { ...it, reps: newProgressionReps } : it) })) }))
        : s.schedules;
      return { ...s, exercises, schedules };
    });
    setEditMode(false);
    if (autoEdit) advanceQueue();
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
    if (s.repsL != null || s.repsR != null) return LB.e1rm(s.kg, Math.max(s.repsL || 0, s.repsR || 0));
    return s.reps ? LB.e1rm(s.kg, s.reps) : 0;
  };

  const points = history.map(h => {
    const best = (h.entry.sets || []).reduce((m, s) => Math.max(m, e1rmForSet(s)), 0);
    return { date: h.session.date, est: best };
  }).filter(p => p.est > 0).reverse();

  const pr = points.length ? Math.max(...points.map(p => p.est)) : 0;

  const volPr = history.length ? Math.max(...history.map(h =>
    (h.entry.sets || []).reduce((sum, s) => s.kg == null ? sum : sum + s.kg * (LB.effReps(s) ?? 0), 0)
  )) : 0;

  const queuePos = editQueueTotal > 0 ? editQueueTotal - editQueue.length : 0;

  return (
    <Screen>
      <ScreenHead
        ref_="EXERCISE"
        title={editMode ? editName || ex.name : ex.name}
        sub={autoEdit && editQueueTotal > 1 ? `${queuePos} / ${editQueueTotal}` : undefined}
        onBack={() => { if (editMode) cancelEdit(); else go(back || { name: 'lib' }); }}
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {editMode ? (
              autoEdit && (
                <button onClick={() => go(back || { name: 'lib' })} style={{
                  background: 'none', border: `1px solid ${UI.hairStrong}`, cursor: 'pointer',
                  width: 30, height: 30, borderRadius: 4,
                  color: UI.inkSoft, fontSize: 16, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>×</button>
              )
            ) : (
              <>
                <button onClick={startEdit} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: UI.gold, fontSize: 11, fontFamily: UI.fontUi, padding: '4px 8px',
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                }}>Edit</button>
                <button onClick={deleteExercise} style={{
                  background: 'none', border: `1px solid rgba(var(--danger-rgb),0.3)`, cursor: 'pointer',
                  width: 30, height: 30, borderRadius: 4,
                  color: UI.danger, fontSize: 16, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>×</button>
              </>
            )}
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
              <span className="label">Equipment</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {EQUIPMENT_TYPES.map(({ key, label }) => (
                  <Pill key={key} gold={editEquipment === key} onClick={() => setEditEquipment(k => k === key ? null : key)} style={{ cursor: 'pointer' }}>{label}</Pill>
                ))}
              </div>
            </div>
            <div>
              <span className="label">Movement type</span>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <Pill gold={editUnilateral} onClick={() => setEditUnilateral(v => !v)} style={{ cursor: 'pointer' }}>Unilateral</Pill>
              </div>
            </div>
            <div>
              <span className="label">Rep target</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <Pill gold={editProgressionReps != null} onClick={() => setEditProgressionReps(v => v == null ? 12 : null)} style={{ cursor: 'pointer' }}>
                  {editProgressionReps != null ? 'On' : 'Off'}
                </Pill>
                {editProgressionReps != null
                  ? <Stepper value={editProgressionReps} onChange={v => setEditProgressionReps(Math.max(1, Math.round(v)))} step={1} min={1} />
                  : <span style={{ color: UI.inkFaint, fontSize: 13 }}>Uses planned reps per day</span>
                }
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn kind="ghost" onClick={cancelEdit} style={{ flex: 1 }}>
                {autoEdit ? 'Skip' : 'Cancel'}
              </Btn>
              <Btn onClick={saveEdit} style={{ flex: 1 }}>
                {autoEdit ? (editQueue.length > 0 ? 'Save & Next' : 'Save') : 'Save'}
              </Btn>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ex.category && <Pill gold>{ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}</Pill>}
            {ex.unilateral && <Pill gold>Unilateral</Pill>}
            {(ex.tags || []).map(t => <Pill key={t} gold>{t}</Pill>)}
            {ex.equipment && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>{EQUIPMENT_TYPES.find(t => t.key === ex.equipment)?.label ?? ex.equipment}</Pill>}
            {!ex.category && !ex.unilateral && !(ex.tags || []).length && <span className="micro" style={{ fontStyle: 'italic', color: UI.inkFaint }}>No muscle group — Edit</span>}
          </div>
        )}
      </div>

      {!editMode && <div style={{ padding: '18px 22px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Stats — SubDials */}
        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '6px 0' }}>
          <SubDial label="1RM PR" value={pr ? Math.round(pr) : '—'} sub={UI.unit()} size={90} gold />
          <SubDial label="Sessions" value={history.length} size={90} />
          <SubDial label="Vol PR" value={volPr ? Math.round(volPr) : '—'} sub={UI.unit()} size={90} gold />
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
                <React.Fragment key={h.session.id}>
                <div
                  onClick={() => go({ name: 'session', sessionId: h.session.id })}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    padding: '12px 0',
                    cursor: 'pointer',
                  }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                      <span className="num" style={{ fontSize: 10, color: isPR ? UI.gold : UI.inkFaint, letterSpacing: '0.05em' }}>
                        {LB.parseDate(h.session.date).toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'2-digit' })}
                      </span>
                      {isPR && (
                        <span style={{ fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.1em', color: UI.gold, background: UI.goldFaint, border: `0.5px solid ${UI.goldSoft}`, borderRadius: 4, padding: '1px 5px' }}>PR</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {h.entry.sets.filter(s => s.kg != null && !s.warmup).map((s, i) => {
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
                {hi < Math.min(history.length, 10) - 1 && <div className="knurl" />}
                </React.Fragment>
              );
            })}
            {history.length === 0 && <Empty title="Never trained" />}
          </div>
        </div>
      </div>}
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
    <div style={{ padding: '10px 0', maxWidth: 380 }}>
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
  // Stable per-day key so the date-scoped memos below re-run when the calendar
  // day rolls over (long-lived PWA session), but stay memoized within a day.
  const todayKey = today.toISOString().slice(0, 10);

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
    const start = LB.parseDate(store.cycleStartDate);
    const n = Math.round((today.getTime() - start.getTime()) / 86400000);
    const idxInCycle = ((n % cycleLen) + cycleLen) % cycleLen;
    const d = new Date(today); d.setDate(today.getDate() - idxInCycle);
    return d;
  })();
  const currentCycleNum = isCycleMode ? Math.floor(Math.round((today.getTime() - LB.parseDate(store.cycleStartDate).getTime()) / 86400000) / cycleLen) : 0;

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
    const d = LB.parseDate(s.date);
    if (isCycleMode) return selectedCycleStart && selectedCycleEnd && d >= selectedCycleStart && d <= selectedCycleEnd;
    return d >= monday && d <= sunday;
  }), [sessions, isCycleMode, selectedCycleStart, selectedCycleEnd]);

  // Calendar-week sessions — used for consistency card ("This Week")
  const thisWeekSessions = useMemoL(() => sessions.filter(s => {
    const d = LB.parseDate(s.date);
    return d >= monday && d <= sunday;
  }), [sessions, todayKey]);

  const thisMonthSessions = useMemoL(() => sessions.filter(s => {
    const d = LB.parseDate(s.date);
    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  }), [sessions, todayKey]);

  // Weekly sets per muscle group
  const setsPerMuscle = useMemoL(() => {
    const counts = {};
    thisPeriodSessions.forEach(s => {
      s.entries.forEach(entry => {
        const ex = store.exercises.find(e => e.id === entry.exId);
        const muscles = (ex?.tags || []).filter(t => MUSCLES.includes(t));
        const done = entry.sets.filter(st => st.done && !st.warmup).length;
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
        .filter(s => { const d = LB.parseDate(s.date); return d >= wMon && d <= wSun; })
        .reduce((sum, s) => sum + LB.totalVolume(s), 0);
      const label = wMon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      weeks.push({ label, vol });
    }
    return weeks;
  }, [sessions, todayKey]);

  // All-time stats
  const totalVol = sessions.reduce((sum, s) => sum + LB.totalVolume(s), 0);
  const avgVol = sessions.length ? Math.round(totalVol / sessions.length) : 0;
  const durations = sessions
    .map(s => s.durationMinutes != null
      ? s.durationMinutes
      : (s.startedAt && s.ended ? Math.round((new Date(s.ended) - new Date(s.startedAt)) / 60000) : null))
    .filter(d => d != null && d > 0);
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const maxDuration = durations.length ? Math.max(...durations) : 0;

  // Best session by volume
  const bestSession = sessions.length ? sessions.reduce((best, s) => LB.totalVolume(s) > LB.totalVolume(best) ? s : best, sessions[0]) : null;

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
    const start = LB.parseDate(store.cycleStartDate);
    const n = Math.round((date.getTime() - start.getTime()) / 86400000);
    if (n < 0) return false; // before plan start → streak-neutral
    const day = sch.days[((n % sch.days.length) + sch.days.length) % sch.days.length];
    return day ? day.items.length > 0 : false;
  };

  const planStart = store.cycleStartDate ? LB.parseDate(store.cycleStartDate) : null;

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
    const earliest = planStart ?? LB.parseDate(sessions[sessions.length - 1].date);
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
    return LB.parseDate(s.date).getFullYear() === today.getFullYear();
  }), [sessions, todayKey]);

  const avgSessionsPerWeek = useMemoL(() => {
    const relevant = planStart
      ? sessions.filter(s => LB.parseDate(s.date) >= planStart)
      : sessions;
    if (!relevant.length) return '0.0';
    const oldest = relevant.reduce((min, s) =>
      s.date.slice(0, 10) < min ? s.date.slice(0, 10) : min, relevant[0].date.slice(0, 10));
    const anchor = planStart ?? LB.parseDate(oldest);
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

  const StatCard = ({ label, value, sub, gold, compact, style: extraStyle = {} }) => (
    <div style={{ background: gold ? UI.goldFaint : UI.bgInset, borderRadius: 4, padding: compact ? '8px 12px' : '12px 14px', textAlign: 'center', border: gold ? `1px solid ${UI.goldSoft}` : `1px solid ${UI.hair}`, ...extraStyle }}>
      <div className="micro" style={{ color: gold ? UI.gold : UI.inkFaint, marginBottom: compact ? 4 : 6 }}>{label}</div>
      <div className="num" style={{ fontSize: compact ? 18 : 22, color: gold ? UI.gold : UI.ink, lineHeight: 1 }}>{value}</div>
      {sub && <div className="micro" style={{ color: gold ? UI.gold : UI.inkFaint, marginTop: compact ? 2 : 3, opacity: gold ? 0.7 : 1 }}>{sub}</div>}
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
          <StatCard label="Avg Volume" value={Math.round(avgVol).toLocaleString('en-US')} sub={`${UI.unit()} / session`} />
          <StatCard label="Avg Duration" value={avgDuration || '—'} sub={avgDuration ? 'min' : ''} compact />
          <StatCard label="Longest Session" value={maxDuration || '—'} sub={maxDuration ? 'min' : ''} compact />
          <div style={{ gridColumn: '1 / -1', background: UI.bgInset, borderRadius: 4, padding: '16px 14px', textAlign: 'center', border: `1px solid ${UI.hair}` }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>TOTAL TIME TRAINED</div>
            <div className="num" style={{ fontSize: 32, color: UI.ink, lineHeight: 1 }}>{totalTrainingMins ? totalTrainingStr : '—'}</div>
          </div>
        </div>
      </div>

      {/* Consistency */}
      <div>
        <div className="micro" style={{ marginBottom: 14, borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8 }}>CONSISTENCY</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {/* Current streak — full width, slightly taller than longest */}
          <div style={{ gridColumn: '1 / -1', background: UI.goldFaint, borderRadius: 4, padding: '14px 14px', textAlign: 'center', border: `1px solid ${UI.goldSoft}` }}>
            <div className="micro" style={{ color: UI.gold, marginBottom: 6 }}>CURRENT STREAK</div>
            <div className="num" style={{ fontSize: 40, color: UI.gold, lineHeight: 1 }}>{currentStreak}</div>
            <div className="micro" style={{ color: UI.gold, marginTop: 5, opacity: 0.7 }}>{currentStreak === 1 ? 'DAY' : 'DAYS'}</div>
          </div>
          {/* Longest streak — full width, slightly shorter than current */}
          <div style={{ gridColumn: '1 / -1', background: UI.goldFaint, borderRadius: 4, padding: '10px 14px', textAlign: 'center', border: `1px solid ${UI.goldSoft}` }}>
            <div className="micro" style={{ color: UI.gold, marginBottom: 4 }}>LONGEST STREAK</div>
            <div className="num" style={{ fontSize: 28, color: UI.gold, lineHeight: 1 }}>{longestStreak}</div>
            <div className="micro" style={{ color: UI.gold, marginTop: 3, opacity: 0.7 }}>{longestStreak === 1 ? 'DAY' : 'DAYS'}</div>
          </div>
          <StatCard label="Avg / Week" value={avgSessionsPerWeek} sub="sessions" compact />
          <StatCard label="This Year" value={thisYearSessions.length} sub="sessions" compact />
          <StatCard label="This Month" value={thisMonthSessions.length} sub="sessions" compact />
          <StatCard label="This Week" value={thisWeekSessions.length} sub="sessions" compact />
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
                  {LB.parseDate(bestSession.date).toLocaleDateString('en-US', { weekday:'short', day:'numeric', month:'short' }).toUpperCase()}
                </div>
                <div className="micro" style={{ color: UI.inkFaint, marginTop: 3 }}>
                  {bestSession.entries.length} exercises · {LB.doneSetCount(bestSession)} sets
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ fontSize: 22, color: UI.gold }}>{Math.round(LB.totalVolume(bestSession)).toLocaleString('en-US')}</div>
                <div className="micro" style={{ color: UI.inkFaint }}>{UI.unit()}</div>
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
              <React.Fragment key={id}>
              <div onClick={() => go({ name: 'exercise', exId: id, back: { name: 'hist', initialTab: 'stats' } })} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '11px 0',
                cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="num" style={{ fontSize: i === 0 ? 13 : 11, color: i === 0 ? UI.gold : UI.inkFaint, width: 16 }}>{i + 1}</span>
                  <span style={{ fontFamily: UI.fontUi, fontSize: 14, color: i === 0 ? UI.gold : UI.ink }}>{name}</span>
                </div>
                <span className="num" style={{ fontSize: 13, color: i === 0 ? UI.gold : UI.inkSoft }}>{count}×</span>
              </div>
              {i < topExercises.length - 1 && <div className="knurl" />}
              </React.Fragment>
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
              const d = LB.parseDate(dateStr);
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
              const setsLogged = LB.doneSetCount(s);
              const vol = LB.totalVolume(s);
              const date = LB.parseDate(s.date);
              const days = Math.round((Date.now() - date) / 86400000);
              const isToday = days === 0;
              return (
                <React.Fragment key={item.key}>
                {!item.firstInGroup && <div className="knurl" />}
                <div
                  onClick={() => go({ name: 'session', sessionId: s.id })}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    padding: '16px 0',
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
                      {Math.round(vol).toLocaleString('en-US')}
                    </div>
                    <div className="micro" style={{ color: UI.inkFaint, marginTop: 3 }}>{UI.unit()}</div>
                  </div>
                </div>
                </React.Fragment>
              );
            });
          })()}
        </div>
      )}

      {tab === 'stats' && <StatsTab store={store} sessions={sessions} go={go} />}
    </Screen>
  );
}

// ─── SET COMPARISON HELPERS ──────────────────────────────────────────
// Shared by SessionDetailScreen, ComparisonScreen, and the LAST TIME card.
function isImprovement(curr, prev) {
  if (!prev || !curr || !curr.done || curr.skipped || curr.kg == null || prev.kg == null) return false;
  const rA = LB.effReps(curr); const rB = LB.effReps(prev);
  if (rA == null || rB == null) return false;
  return (curr.kg > prev.kg && rA >= rB - 2) || (curr.kg >= prev.kg && rA > rB);
}
function isDecline(curr, prev) {
  if (!prev || !curr || curr.skipped) return false;
  if (prev.skipped) return false; // prev was already skipped, no baseline to decline from
  if (!curr.done || curr.kg == null || prev.kg == null) return false;
  const rA = LB.effReps(curr); const rB = LB.effReps(prev);
  if (rA == null || rB == null) return false;
  return (curr.kg < prev.kg && rA <= rB) || (curr.kg === prev.kg && rA < rB);
}

// ─── SESSION DETAIL ──────────────────────────────────────────────────
function SessionDetailScreen({ store, setStore, go, sessionId, justFinished, back }) {
  const [confirmEl, confirm] = useConfirm();
  const [editing, setEditing] = useStateL(false);
  const [capturing, setCapturing] = useStateL(false);
  const captureRef = useRefL(null);
  const s = store.sessions.find(x => x.id === sessionId);
  useEffectL(() => { if (!s) go({ name: 'hist' }); }, [!!s]);
  if (!s) return null;
  const vol = LB.totalVolume(s);
  const duration = s.durationMinutes != null
    ? s.durationMinutes
    : (s.ended && (s.startedAt ?? s.date) ? Math.round((new Date(s.ended) - new Date(s.startedAt ?? s.date)) / 60000) : null);

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
  const volDelta = prevSameDay != null ? vol - LB.totalVolume(prevSameDay) : null;

  const exIsUnilateral = (exId) => !!store.exercises.find(x => x.id === exId)?.unilateral;
  const prReps = (st, exId) => exIsUnilateral(exId)
    ? Math.min(st.repsL ?? 0, st.repsR ?? 0)
    : (st.reps ?? 0);
  const prRepsValid = (st, exId) => exIsUnilateral(exId)
    ? (st.repsL != null && st.repsR != null)
    : st.reps != null;

  const prMap = {};
  store.sessions.filter(x => x.ended && x.id !== s.id && x.ended < s.ended).forEach(sess =>
    sess.entries.forEach(e => e.sets.filter(st => st.done && st.kg != null && prRepsValid(st, e.exId)).forEach(st => {
      const cur = prMap[e.exId];
      const reps = prReps(st, e.exId);
      if (!cur || st.kg > cur.kg || (st.kg === cur.kg && reps > cur.reps)) prMap[e.exId] = { kg: st.kg, reps };
    }))
  );
  const sessionBestMap = {};
  s.entries.forEach(e => e.sets.filter(st => st.done && st.kg != null && prRepsValid(st, e.exId)).forEach(st => {
    const cur = sessionBestMap[e.exId];
    const reps = prReps(st, e.exId);
    if (!cur || st.kg > cur.kg || (st.kg === cur.kg && reps > cur.reps)) sessionBestMap[e.exId] = { kg: st.kg, reps };
  }));
  const isPR = (st, exId) => {
    if (!st.done || st.kg == null || !prRepsValid(st, exId)) return false;
    const reps = prReps(st, exId);
    const sessionBest = sessionBestMap[exId];
    if (!sessionBest || st.kg !== sessionBest.kg || reps !== sessionBest.reps) return false;
    const best = prMap[exId];
    return !best || st.kg > best.kg || (st.kg === best.kg && reps > best.reps);
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

  return (
    <Screen>
      <ScreenHead
        ref_={LB.parseDate(s.date).toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long' }).toUpperCase()}
        title={s.dayName}
        onBack={() => go(justFinished ? { name: 'home' } : (back || { name: 'hist' }))}
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={takeScreenshot} disabled={capturing} style={{
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              borderRadius: 4, padding: '5px 10px', cursor: 'pointer',
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>{capturing ? '…' : '↓'}</button>
            <button onClick={() => setEditing(true)} style={{
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              borderRadius: 4, padding: '5px 10px', cursor: 'pointer',
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>Edit</button>
            <button onClick={deleteSession} style={{
              width: 28, height: 28, borderRadius: 4,
              border: `1px solid rgba(var(--danger-rgb),0.25)`, background: 'transparent',
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
                  {LB.parseDate(s.date).toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long' }).toUpperCase()}
                </div>
                <div className="display" style={{ fontSize: 26 }}>{s.dayName}</div>
              </div>
              <div className="micro-gold" style={{ letterSpacing: '0.18em', marginTop: 2 }}>ZANE</div>
            </div>
            <div className="knurl" />
          </div>
        )}

        {/* Celebration banner — screen only */}
        {justFinished && !capturing && (() => {
          return (
            <BracketFrame gold style={{ marginBottom: 4 }}>
              <div style={{ textAlign: 'center', padding: '6px 0 10px' }}>
                <div className="micro-gold" style={{ letterSpacing: '0.24em', marginBottom: 16 }}>SESSION COMPLETE</div>
                <div className="display-it" style={{ fontSize: 28, color: UI.gold, marginBottom: 18 }}>Well done.</div>
                <div className="knurl" style={{ marginBottom: 16 }} />
                <div style={{ display: 'flex', gap: 0 }}>
                  {[
                    { label: 'Volume', value: `${Math.round(vol).toLocaleString('en-US')} ${UI.unit()}`, gold: true },
                    ...(duration ? [{ label: 'Duration', value: `${duration} min`, gold: false }] : []),
                    { label: 'Sets', value: String(LB.doneSetCount(s)), gold: false },
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
            <SubDial label="Volume" value={Math.round(vol).toLocaleString('en-US')} sub={UI.unit()} size={90} gold />
            <SubDial label="Sets" value={LB.doneSetCount(s)} size={90} />
          </div>
        )}
        {capturing && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', marginTop: -8 }}>
            {[['DURATION', duration != null ? `${duration} min` : '—', false], ['VOLUME', `${Math.round(vol).toLocaleString('en-US')} ${UI.unit()}`, true], ['SETS', LB.doneSetCount(s), false]].map(([label, value, gold], idx) => (
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
            {volDelta >= 0 ? '↑' : '↓'} {Math.abs(Math.round(volDelta)).toLocaleString('en-US')} {UI.unit()} · vs last {s.dayName}
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

              const showWarmup = store.settings?.showWarmupInSummary ?? true;
              const renderEntry = (e, i) => {
                const prev = prevEntryMap[e.exId];
                const exName = store.exercises.find(ex => ex.id === e.exId)?.name ?? e.name;
                const filteredSets = e.sets.filter(st => !st.skipped && (showWarmup || !st.warmup));
                // Compare working sets by position, warm-ups excluded on both sides.
                const prevWorking = (prev?.sets || []).filter(st => !st.warmup);
                const prevWorkingFor = (j) => {
                  if (filteredSets[j]?.warmup) return undefined;
                  const wIdx = filteredSets.slice(0, j + 1).filter(st => !st.warmup).length - 1;
                  return wIdx >= 0 ? prevWorking[wIdx] : undefined;
                };
                return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <div
                      className="display"
                      onClick={() => s.dayId && go({ name: 'exerciseHistory', exId: e.exId, dayId: s.dayId, exName, back: { name: 'session', sessionId: s.id } })}
                      style={{ fontSize: 17, color: UI.ink, lineHeight: 1.1, cursor: s.dayId ? 'pointer' : 'default' }}
                    >
                      {exName}{s.dayId && <span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 5 }}>›</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {filteredSets.map((st, j) => {
                      const isWarm = !!st.warmup;
                      const prevSet = prevWorkingFor(j);
                      const pr = !isWarm && isPR(st, e.exId);
                      const highlight = !isWarm && (pr || isImprovement(st, prevSet));
                      const anyImprovementBefore = !isWarm && filteredSets.slice(0, j).some((s, k) => !s.warmup && (isPR(s, e.exId) || isImprovement(s, prevWorkingFor(k))));
                      const decline = !isWarm && !anyImprovementBefore && isDecline(st, prevSet);
                      const hasData = st.kg != null || st.reps != null || st.repsL != null || st.repsR != null;
                      return (
                        <span key={j} style={{
                          opacity: (st.done || hasData) ? (isWarm ? 0.5 : 1) : 0.3,
                          background: highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'transparent',
                          border: `1px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hair}`,
                          borderRadius: 3, padding: '3px 8px',
                          fontFamily: UI.fontNum, fontSize: 12,
                          color: isWarm ? UI.inkFaint : highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.ink,
                        }}>
                          {isWarm && <span style={{ fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.1em', color: UI.inkFaint, marginRight: 4 }}>W</span>}
                          {st.kg ?? '—'}<span style={{ color: isWarm ? UI.inkGhost : highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, fontSize: 10 }}>{UI.unit()}</span><span style={{ color: isWarm ? UI.inkGhost : highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, margin: '0 1px' }}>×</span>{(st.repsL != null || st.repsR != null) ? `L${st.repsL ?? '?'}/R${st.repsR ?? '?'}` : (st.reps ?? '—')}{pr && <i className="fa-solid fa-dumbbell" style={{ fontSize: 8, color: UI.gold, marginLeft: 4 }} />}
                        </span>
                      );
                    })}
                    {(() => { const n = e.sets.filter(st => st.skipped).length; return n > 0 && (
                      <span style={{ border: `1px solid ${UI.hair}`, borderRadius: 3, padding: '3px 8px', fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, letterSpacing: '0.05em' }}>
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
      i !== eIdx ? e : { ...e, sets: e.sets.map((st, k) => k !== sIdx ? st : { ...st, ...patch, skipped: false, done: true }) }
    ));
  };

  const skipSet = (eIdx, sIdx, skip) => {
    setDraftEntries(entries => entries.map((e, i) =>
      i !== eIdx ? e : { ...e, sets: e.sets.map((st, k) => k !== sIdx ? st : { ...st, skipped: skip, done: false, kg: null, reps: null, repsL: null, repsR: null }) }
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
    if (!isNaN(mins) && mins > 0) {
      patch.durationMinutes = mins;
    }
    onSave(patch);
  };

  const inputStyle = {
    background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
    borderRadius: 4, padding: '11px 14px', color: UI.ink,
    fontFamily: UI.fontNum, fontSize: 16, outline: 'none',
    width: '100%', boxSizing: 'border-box', display: 'block',
  };
  const numInputStyle = {
    width: 64, background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
    borderRadius: 4, color: UI.ink, padding: '9px 6px', textAlign: 'center',
    fontFamily: UI.fontNum, fontSize: 15, outline: 'none', flexShrink: 0,
  };

  return (
    <Sheet open={true} onClose={onClose} title="Edit session">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 160 }}>
        <div>
          <span className="label">Date</span>
          <div style={{ width: '100%', overflow: 'hidden', borderRadius: 4, marginTop: 6 }}>
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
        <div className="knurl" style={{ marginBottom: 16 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {draftEntries.map((e, eIdx) => {
            const isUnilateral = !!(exercises?.find(ex => ex.id === e.exId)?.unilateral)
              || e.sets.some(st => st.repsL != null || st.repsR != null);
            return (
              <div key={eIdx}>
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>{(exercises?.find(ex => ex.id === e.exId)?.name ?? e.name).toUpperCase()}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {e.sets.map((st, sIdx) => {
                    const isEmpty = st.kg == null && st.reps == null && st.repsL == null && st.repsR == null;
                    return (
                      <div key={sIdx} style={{ display: 'flex', alignItems: 'center', gap: 8, background: UI.bgInset, borderRadius: 4, padding: '8px 12px', opacity: st.skipped ? 0.5 : 1, border: `1px solid ${UI.hair}` }}>
                        <span className="num" style={{ width: 20, fontSize: 11, color: UI.inkFaint, flexShrink: 0 }}>{sIdx + 1}</span>
                        {st.skipped ? (
                          <>
                            <span className="num" style={{ flex: 1, fontSize: 12, color: UI.inkFaint }}>skipped</span>
                            <button onClick={() => skipSet(eIdx, sIdx, false)} style={{ background: 'rgba(var(--accent-rgb),0.15)', border: `0.5px solid rgba(var(--accent-rgb),0.4)`, borderRadius: 6, padding: '3px 8px', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', fontFamily: UI.fontUi, flexShrink: 0 }}>Undo</button>
                          </>
                        ) : (
                          <>
                            <input type="number" inputMode="decimal" step="0.5" value={st.kg ?? ''}
                              placeholder="—" onFocus={e => e.target.select()}
                              onChange={ev => updateSet(eIdx, sIdx, { kg: ev.target.value === '' ? null : +ev.target.value })}
                              style={numInputStyle} />
                            <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>{UI.unit()}</span>
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
                            {isEmpty && (
                              <button onClick={() => skipSet(eIdx, sIdx, true)} style={{ background: 'rgba(var(--accent-rgb),0.15)', border: `0.5px solid rgba(var(--accent-rgb),0.4)`, borderRadius: 6, padding: '3px 8px', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', fontFamily: UI.fontUi, flexShrink: 0 }}>Skip</button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
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


function ComparisonScreen({ session, onDismiss, go, userName }) {
  const entries     = session.entries || [];
  const lastEntries = session.last_session_entries || [];
  const duration    = session.ended && session.started_at
    ? Math.round((new Date(session.ended) - new Date(session.started_at)) / 60000)
    : null;

  return (
    <Screen scroll={false} style={{ position: 'relative' }}>
      <TopBar title={userName} onBack={() => go({ name: 'settings' })} />
      <div style={{ flexShrink: 0, padding: '12px 22px', borderBottom: `0.5px solid ${UI.hair}` }}>
        <div className="micro" style={{ color: UI.inkFaint, marginBottom: 2 }}>
          {session.day_name} · COMPLETE
        </div>
        {duration != null && (
          <span className="num" style={{ fontSize: 13, color: UI.inkSoft }}>{duration} min</span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
        {entries.map((entry, ei) => {
          const lastEntry = lastEntries.find(e => e.name === entry.name);
          const sets      = (entry.sets || []).filter(s => !s.warmup);
          const lastSets  = (lastEntry?.sets || []).filter(s => !s.warmup);
          const maxLen    = Math.max(sets.length, lastSets.length);
          const fmtSet = s => {
            if (!s) return '—';
            if (s.skipped) return 'skipped';
            const repsStr = (s.repsL != null || s.repsR != null)
              ? `L${s.repsL ?? '?'}/R${s.repsR ?? '?'}`
              : (s.reps ?? '—');
            return `${s.kg != null ? s.kg + UI.unit() : '—'} × ${repsStr}`;
          };
          return (
            <div key={ei} style={{ marginBottom: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 100px 18px', gap: 10, marginBottom: 6 }}>
                <span />
                <span style={{ fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.07em', color: UI.inkSoft }}>
                  {entry.name}
                </span>
                <span className="micro" style={{ color: UI.inkFaint, textAlign: 'right' }}>LAST TIME</span>
                <span />
              </div>
              {Array.from({ length: maxLen }).map((_, si) => {
                const curr = sets[si];
                const prev = lastSets[si];
                if (!curr && !prev) return null;
                const prevDone = prev && !prev.skipped;
                const improved = isImprovement(curr, prev);
                const anyImprovementBefore = sets.slice(0, si).some((c, j) => isImprovement(c, lastSets[j]));
                const declined = !anyImprovementBefore && (isDecline(curr, prev) || ((!curr || curr.skipped) && prevDone));
                const icon   = !curr ? '−' : !prev ? '+' : curr.skipped && prevDone ? '↓' : curr && !curr.skipped && prev?.skipped ? '↑' : improved ? '↑' : declined ? '↓' : '—';
                const iconColor = (improved || (!prev && curr && !curr.skipped) || (curr && !curr.skipped && prev?.skipped)) ? 'var(--accent)'
                                : declined ? UI.danger
                                : UI.inkFaint;
                return (
                  <div key={si} style={{
                    display: 'grid', gridTemplateColumns: '20px 1fr 100px 18px',
                    alignItems: 'center', gap: 10, padding: '6px 0',
                    borderBottom: si < maxLen - 1 ? `0.5px solid ${UI.hair}` : 'none',
                  }}>
                    <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{si + 1}</span>
                    <span className="num" style={{ fontSize: 14, color: curr && !curr.skipped ? UI.ink : UI.inkFaint }}>
                      {fmtSet(curr)}
                    </span>
                    <span className="num" style={{ fontSize: 13, color: UI.inkFaint, textAlign: 'right' }}>
                      {fmtSet(prev)}
                    </span>
                    <span style={{ fontSize: 14, color: iconColor, textAlign: 'right' }}>{icon}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div style={{ flexShrink: 0, padding: '14px 22px', paddingBottom: `calc(14px + env(safe-area-inset-bottom, 0px))`, borderTop: `0.5px solid ${UI.hair}` }}>
        <Btn onClick={onDismiss}>Got it</Btn>
      </div>
    </Screen>
  );
}

function SpectatorScreen({ go, targetUserId, userName, sessionId }) {
  const [session, setSession] = useStateL(null);
  const [exIdx, setExIdx] = useStateL(0);
  const [loading, setLoading] = useStateL(true);
  const [ended, setEnded] = useStateL(false);
  const [now, setNow] = useStateL(Date.now());
  const chipRowRef = useRefL(null);

  useEffectL(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = () => {
    const params = { p_user_id: targetUserId };
    if (sessionId) params.p_session_id = sessionId;
    LB.supabase.rpc('get_active_session_detail', params)
      .then(({ data }) => {
        if (!data?.length) {
          if (!loading) setEnded(true);
          setSession(null);
        } else {
          const d = data[0];
          setSession(d);
          setEnded(false);
          if (!sessionId) setExIdx(LB.inferCurrentExIdx(d.entries || []));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffectL(() => {
    load();
    if (sessionId) return; // finished session: single fetch, no polling
    const iv = setInterval(load, 2000);
    return () => clearInterval(iv);
  }, [targetUserId, sessionId]);

  useEffectL(() => {
    const row = chipRowRef.current;
    if (!row) return;
    const chip = row.children[exIdx];
    if (chip) chip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [exIdx]);

  const elapsed = session?.started_at
    ? Math.floor((now - new Date(session.started_at).getTime()) / 1000)
    : 0;
  const elapsedStr = elapsed >= 3600
    ? `${Math.floor(elapsed/3600)}:${String(Math.floor((elapsed%3600)/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`
    : `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;

  if (loading) return (
    <Screen scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.1em' }}>LOADING…</div>
    </Screen>
  );

  if (session && sessionId) {
    const dismiss = () => {
      const list = JSON.parse(localStorage.getItem('logbook-dismissed-sessions') || '[]');
      if (!list.includes(sessionId)) { list.push(sessionId); localStorage.setItem('logbook-dismissed-sessions', JSON.stringify(list)); }
      go({ name: 'settings' });
    };
    return <ComparisonScreen session={session} onDismiss={dismiss} go={go} userName={userName} />;
  }

  if (!session) return (
    <Screen>
      <TopBar title={userName} onBack={() => go({ name: 'settings' })} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 }}>
        <div style={{ fontSize: 32, color: UI.inkGhost }}>✓</div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 20, color: UI.inkSoft }}>
          {ended ? 'Session ended' : 'Not training right now'}
        </div>
        <div className="micro" style={{ color: UI.inkFaint }}>
          {ended ? `${userName} has finished their workout.` : `${userName} has no active session.`}
        </div>
      </div>
    </Screen>
  );

  const entries = session.entries || [];
  const entry = entries[exIdx];

  return (
    <Screen scroll={false} style={{ position: 'relative' }}>
      {/* TopBar */}
      <div style={{
        flexShrink: 0,
        padding: `calc(env(safe-area-inset-top, 0px) + 14px) 22px 14px`,
        borderBottom: `0.5px solid ${UI.hair}`,
        position: 'sticky', top: 0, zIndex: 5,
        background: 'rgba(var(--bg-rgb),0.9)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => go({ name: 'settings' })} style={{
          width: 32, height: 32, borderRadius: 4,
          border: `1px solid ${UI.hairStrong}`, background: 'transparent',
          color: UI.gold, cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><path d="M7 1 1 7l6 6"/></svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 400, lineHeight: 1.1 }}>
            {userName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <span className="micro" style={{ color: UI.inkSoft }}>{session.day_name}</span>
            <span className="num" style={{ fontSize: 10, color: UI.inkFaint }}>{elapsedStr}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: UI.gold, animation: 'pulseDot 1.4s ease-in-out infinite' }} />
          <span className="micro" style={{ color: UI.gold }}>LIVE</span>
        </div>
      </div>

      {/* Exercise chips */}
      <div ref={chipRowRef} style={{
        flexShrink: 0, display: 'flex', gap: 6, overflowX: 'auto',
        padding: '10px 16px', borderBottom: `0.5px solid ${UI.hair}`,
        scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
      }}>
        {entries.map((e, i) => {
          const allDone = e.sets?.length > 0 && e.sets.every(s => s.done || s.skipped);
          const isCurrent = i === exIdx;
          return (
            <button key={i} onClick={() => setExIdx(i)} style={{
              flexShrink: 0, padding: '6px 12px', borderRadius: 4,
              border: `${isCurrent ? '1.5px' : '1px'} solid ${isCurrent ? UI.gold : allDone ? UI.goldSoft : UI.hair}`,
              background: isCurrent ? UI.goldFaint : allDone ? 'rgba(201,169,97,0.06)' : 'transparent',
              color: isCurrent ? UI.gold : allDone ? UI.goldSoft : UI.inkSoft,
              fontFamily: UI.fontUi, fontSize: 12, fontWeight: isCurrent ? 600 : 400,
              letterSpacing: '0.06em', cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}>
              {e.name?.split(' ').slice(0, 2).join(' ')}
              {allDone && !isCurrent && (
                <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ marginLeft: 4, verticalAlign: 'middle' }}>
                  <path d="M2 6l2.5 2.5L10 3"/>
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* Sets */}
      {entry && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 22px' }}>
          <div style={{ marginBottom: 18 }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>
              EXERCISE {exIdx + 1} OF {entries.length}
            </div>
            <div className="display" style={{ fontSize: 28, color: UI.ink, fontWeight: 400 }}>{entry.name}</div>
            <div className="micro" style={{ marginTop: 4, color: UI.inkSoft }}>
              {entry.plannedSets} SETS · {entry.plannedReps} REPS PLANNED
            </div>
          </div>

          <Frame style={{ padding: '0 16px' }}>
            {(entry.sets || []).map((s, i) => {
              const done = s.done || s.skipped;
              const unilateral = s.repsL != null || s.repsR != null;
              return (
                <React.Fragment key={i}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '20px 1fr 1fr 20px',
                  alignItems: 'center', gap: 10, padding: '13px 0',
                  opacity: done ? 1 : 0.35,
                  transition: 'opacity 0.3s',
                }}>
                  <span className="num" style={{ fontSize: 11, color: s.warmup ? UI.inkFaint : done ? UI.gold : UI.inkFaint }}>
                    {s.warmup ? 'W' : i + 1}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>
                      {s.kg != null ? s.kg : '—'}
                    </span>
                    {s.kg != null && <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em' }}>{UI.unit()}</span>}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    {unilateral ? (
                      <span className="num" style={{ fontSize: 14, color: UI.ink }}>
                        {s.repsL ?? '—'}<span style={{ color: UI.inkFaint, fontSize: 11 }}> / </span>{s.repsR ?? '—'}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, justifyContent: 'center' }}>
                        <span className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>
                          {s.reps != null ? s.reps : '—'}
                        </span>
                        {s.reps != null && <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em' }}>reps</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    {done ? (
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.8">
                        <path d="M2 6l2.5 2.5L10 3"/>
                      </svg>
                    ) : (
                      <div style={{ width: 13, height: 13, borderRadius: '50%', border: `1px solid ${UI.hair}` }} />
                    )}
                  </div>
                </div>
                {i < entry.sets.length - 1 && <div className="knurl" />}
                </React.Fragment>
              );
            })}
          </Frame>

          {/* Last time card */}
          {(() => {
            const lastEntry = (session.last_session_entries || []).find(e => e.name === entry.name);
            if (!lastEntry?.sets?.length) return null;
            const lastSets = lastEntry.sets.filter(s => !s.warmup);
            const currWorkingSets = (entry.sets || []).filter(s => !s.warmup);
            if (!lastSets.length) return null;
            return (
              <div style={{ marginTop: 16 }}>
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>LAST TIME</div>
                <Frame style={{ padding: '0 16px' }}>
                  {lastSets.map((s, i) => {
                    const curr     = currWorkingSets[i];
                    const prevDone = !s.skipped;
                    const improved = isImprovement(curr, s);
                    const anyImprovementBefore = currWorkingSets.slice(0, i).some((c, j) => isImprovement(c, lastSets[j]));
                    const declined = !anyImprovementBefore && (isDecline(curr, s) || (curr?.skipped && prevDone));
                    const showIcon = (curr?.done || curr?.skipped) && !!s;
                    const icon     = curr?.skipped && prevDone ? '↓' : improved ? '↑' : declined ? '↓' : '—';
                    const iconColor = improved ? 'var(--accent)' : declined ? UI.danger : UI.inkFaint;
                    return (
                      <React.Fragment key={i}>
                      <div style={{
                        display: 'grid', gridTemplateColumns: '20px 1fr 1fr 20px',
                        alignItems: 'center', gap: 10, padding: '10px 0',
                      }}>
                        <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{i + 1}</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          {s.skipped
                            ? <span className="num" style={{ fontSize: 13, color: UI.inkFaint }}>skipped</span>
                            : <><span className="num" style={{ fontSize: 16, color: UI.inkSoft }}>{s.kg != null ? s.kg : '—'}</span>
                               {s.kg != null && <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{UI.unit()}</span>}</>
                          }
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, justifyContent: 'center' }}>
                          {!s.skipped && <>
                            <span className="num" style={{ fontSize: 16, color: UI.inkSoft }}>{s.reps != null ? s.reps : '—'}</span>
                            {s.reps != null && <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>reps</span>}
                          </>}
                        </div>
                        <div style={{ textAlign: 'right', fontSize: 13, color: iconColor }}>
                          {showIcon ? icon : ''}
                        </div>
                      </div>
                      {i < lastSets.length - 1 && <div className="knurl" />}
                      </React.Fragment>
                    );
                  })}
                </Frame>
              </div>
            );
          })()}
        </div>
      )}

      {/* Progress footer — only shown when historical avg is available */}
      {(() => {
        const totalSetsDone  = entries.reduce((s, e) => s + (e.sets?.filter(x => x.done).length || 0), 0);
        const totalSetsTotal = entries.reduce((s, e) => s + (e.sets?.filter(x => !x.skipped).length || 0), 0);
        const blended = LB.calcBlended(session?.started_at, session?.avg_duration_seconds, session?.avg_sets_total, totalSetsDone, totalSetsTotal, now);
        if (!blended) return null;
        const { remainingMin: remMin } = blended;
        const finishing = remMin === 0;
        const avgDurMin  = (session?.avg_duration_seconds || 0) / 60;
        const timeRatio  = avgDurMin > 0 ? Math.min(1, Math.max(0, (avgDurMin - remMin) / avgDurMin)) : 0;

        const paceDelta = (() => {
          const avgDurMin = (session?.avg_duration_seconds || 0) / 60;
          const elapsed   = session?.started_at ? (now - new Date(session.started_at).getTime()) / 60000 : 0;
          if (!avgDurMin || totalSetsDone < 2) return null;
          if (Math.max(0, totalSetsTotal - totalSetsDone) === 0) return null;
          const diffMin = Math.round(elapsed + remMin - avgDurMin); // positive = behind, negative = ahead
          if (Math.abs(diffMin) < 2) return null;
          return diffMin;
        })();

        return (
          <>
          <div className="knurl" />
          <div style={{
            flexShrink: 0,
            padding: '14px 22px',
            paddingBottom: `calc(14px + env(safe-area-inset-bottom, 0px))`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span className="micro" style={{ color: UI.inkFaint }}>ESTIMATED REMAINING</span>
              <span className="num" style={{ fontSize: 13, color: finishing ? 'var(--accent-light)' : 'var(--accent)' }}>
                {finishing ? 'finishing soon' : `~${remMin} min`}
              </span>
            </div>
            <div style={{ height: 4, borderRadius: 999, background: UI.hairStrong, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: '100%',
                background: `linear-gradient(to right, ${UI.inkFaint}, var(--accent))`,
                clipPath: `inset(0 ${(1 - timeRatio) * 100}% 0 0)`,
                transition: 'clip-path 2s linear',
              }} />
            </div>
            {paceDelta !== null && (() => {
              const ahead = paceDelta < 0;
              const pct   = Math.min(Math.abs(paceDelta) / 20 * 50, 50);
              return (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span className="micro" style={{ color: UI.inkFaint }}>PACE</span>
                    <span className="num" style={{ fontSize: 11, color: ahead ? 'var(--accent)' : UI.inkFaint }}>
                      {ahead ? `${Math.abs(paceDelta)}m ahead` : `+${paceDelta}m behind`}
                    </span>
                  </div>
                  <div style={{ position: 'relative', height: 4 }}>
                    <div style={{ position: 'absolute', inset: 0, borderRadius: 999, background: UI.hairStrong }} />
                    <div style={{
                      position: 'absolute', top: 0, height: '100%',
                      left:  ahead ? '50%' : `${50 - pct}%`,
                      width: `${pct}%`,
                      background: ahead ? 'var(--accent)' : UI.inkFaint,
                      borderRadius: ahead ? '0 999px 999px 0' : '999px 0 0 999px',
                      transition: 'left 2s linear, width 2s linear',
                    }} />
                    <div style={{ position: 'absolute', left: '50%', top: -2, width: 1.5, height: 8, background: UI.inkSoft, transform: 'translateX(-50%)' }} />
                  </div>
                </div>
              );
            })()}
            {totalSetsTotal > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10, marginBottom: 8 }}>
                  <span className="micro" style={{ color: UI.inkFaint }}>SETS</span>
                  <span className="num" style={{ fontSize: 13, color: UI.inkSoft }}>{totalSetsDone} / {totalSetsTotal}</span>
                </div>
                <div style={{ height: 4, borderRadius: 999, background: UI.hairStrong, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: '100%',
                    background: `linear-gradient(to right, ${UI.inkFaint}, var(--accent))`,
                    clipPath: `inset(0 ${(1 - totalSetsDone / totalSetsTotal) * 100}% 0 0)`,
                    transition: 'clip-path 2s linear',
                  }} />
                </div>
              </>
            )}
          </div>
          </>
        );
      })()}
    </Screen>
  );
}


function ExerciseHistoryScreen({ store, go, exId, dayId, exName, back }) {
  const [metric, setMetric] = useStateL('kg');
  const [showCount, setShowCount] = useStateL(20);

  const ex = store.exercises.find(e => e.id === exId);
  const isUni = !!ex?.unilateral;
  const displayName = exName || ex?.name || '?';

  const allSessions = useMemoL(() =>
    store.sessions
      .filter(s => s.ended && s.dayId === dayId)
      .map(s => {
        const entry = s.entries.find(e => e.exId === exId);
        if (!entry) return null;
        const working = entry.sets.filter(st => !st.warmup && !st.skipped);
        if (!working.some(st => st.kg != null || st.reps != null)) return null;
        return { ended: s.ended, sets: working };
      })
      .filter(Boolean)
      .sort((a, b) => a.ended.localeCompare(b.ended)),
    [store.sessions, exId, dayId]
  );

  const maxSets = Math.max(...allSessions.map(s => s.sets.length), 1);

  const getValue = (st) => {
    if (metric === 'reps') return isUni
      ? (st.repsL != null ? Math.min(st.repsL ?? 0, st.repsR ?? 0) : (st.reps ?? null))
      : (st.reps ?? null);
    return st.kg ?? null;
  };

  const allVals = allSessions.flatMap(s => s.sets.map(getValue)).filter(v => v != null);
  const minVal = allVals.length ? Math.min(...allVals) : 0;
  const rawMax = allVals.length ? Math.max(...allVals) : 10;
  const maxVal = rawMax === minVal ? rawMax + 1 : rawMax;
  const valRange = maxVal - minVal;

  const PAD_L = 36, PAD_R = 12, PAD_T = 14, PAD_B = 26;
  const VW = 320, VH = 180;
  const plotW = VW - PAD_L - PAD_R;
  const plotH = VH - PAD_T - PAD_B;
  const n = allSessions.length;
  const xPos = (i) => PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yPos = (v) => PAD_T + plotH - ((v - minVal) / valRange) * plotH;

  const gridVals = Array.from({ length: 4 }, (_, i) => minVal + (valRange / 3) * i);
  const setAlphas = [1, 0.55, 0.35, 0.22, 0.14];

  const labelIdxs = (() => {
    if (n <= 5) return allSessions.map((_, i) => i);
    const step = Math.floor((n - 1) / 4);
    const idxs = new Set([0]);
    for (let i = step; i < n; i += step) idxs.add(Math.min(i, n - 1));
    idxs.add(n - 1);
    return [...idxs].sort((a, b) => a - b);
  })();

  const fmtDate = (ended) => {
    const d = new Date(ended);
    return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;
  };

  const listSessions = [...allSessions].reverse();
  const visible = listSessions.slice(0, showCount);

  return (
    <Screen>
      <TopBar title={displayName} onBack={() => back ? go(back) : go({ name: 'hist' })} />

      {(ex?.category || ex?.equipment || (ex?.tags || []).length > 0) && (
        <div style={{ padding: '4px 22px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ex?.category && <Pill gold>{ex.category}</Pill>}
          {ex?.equipment && <Pill>{(window.EQUIPMENT_TYPES || []).find(t => t.key === ex.equipment)?.label ?? ex.equipment}</Pill>}
          {(ex?.tags || []).map(t => <Pill key={t}>{t}</Pill>)}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px 40px' }}>
        {allSessions.length === 0 ? (
          <Empty title="No history yet" />
        ) : (<>

          {/* Metric toggle + session count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            {['kg', 'reps'].map(m => (
              <button key={m} onClick={() => setMetric(m)} style={{
                padding: '5px 14px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${metric === m ? UI.gold : UI.hairStrong}`,
                background: metric === m ? UI.goldFaint : 'transparent',
                color: metric === m ? UI.gold : UI.inkFaint,
                fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                WebkitTapHighlightColor: 'transparent',
              }}>{m === 'kg' ? UI.unit().toUpperCase() : 'REPS'}</button>
            ))}
            <span className="micro" style={{ marginLeft: 'auto', color: UI.inkFaint }}>
              {n} SESSION{n !== 1 ? 'S' : ''}
            </span>
          </div>

          {/* SVG Chart */}
          <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ display: 'block', overflow: 'visible', marginBottom: 12 }}>
            {/* Horizontal grid lines + Y labels */}
            {gridVals.map((v, i) => {
              const y = yPos(v);
              return (
                <g key={i}>
                  <line x1={PAD_L} y1={y} x2={VW - PAD_R} y2={y} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />
                  <text x={PAD_L - 5} y={y + 3.5} textAnchor="end" fontSize="8" fontFamily="JetBrains Mono, monospace" fill={UI.inkFaint}>
                    {Math.round(v)}
                  </text>
                </g>
              );
            })}

            {/* Per-set polylines + dots */}
            {Array.from({ length: maxSets }, (_, si) => {
              const pts = allSessions
                .map((sess, xi) => { const v = getValue(sess.sets[si]); return v != null ? { x: xPos(xi), y: yPos(v) } : null; })
                .filter(Boolean);
              if (!pts.length) return null;
              const a = setAlphas[si] ?? 0.12;
              return (
                <g key={si}>
                  {pts.length > 1 && (
                    <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none"
                      stroke={`rgba(var(--accent-rgb),${a})`} strokeWidth={si === 0 ? 1.5 : 1} strokeLinejoin="round" />
                  )}
                  {pts.map((p, pi) => (
                    <circle key={pi} cx={p.x} cy={p.y} r={si === 0 ? 2.5 : 1.8}
                      fill={si === 0 ? 'var(--accent)' : `rgba(var(--accent-rgb),${Math.min(a + 0.15, 1)})`} />
                  ))}
                </g>
              );
            })}

            {/* X-axis date labels */}
            {labelIdxs.map(xi => (
              <text key={xi} x={xPos(xi)} y={VH - 4} textAnchor="middle" fontSize="7.5"
                fontFamily="JetBrains Mono, monospace" fill={UI.inkFaint}>
                {fmtDate(allSessions[xi].ended)}
              </text>
            ))}
          </svg>

          {/* Set legend */}
          {maxSets > 1 && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              {Array.from({ length: maxSets }, (_, si) => (
                <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 14, height: 2, borderRadius: 1, background: `rgba(var(--accent-rgb),${setAlphas[si] ?? 0.12})` }} />
                  <span className="micro" style={{ color: UI.inkFaint }}>Set {si + 1}</span>
                </div>
              ))}
            </div>
          )}

          {/* Session list */}
          <div className="knurl" style={{ marginBottom: 2 }} />
          {visible.map((sess, i) => (
            <React.Fragment key={i}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 0' }}>
                <span className="num" style={{ fontSize: 11, color: UI.inkSoft, flexShrink: 0, width: 50 }}>
                  {fmtDate(sess.ended)}
                </span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {sess.sets.map((st, si) => (
                    <span key={si} style={{
                      border: `1px solid ${UI.hair}`, borderRadius: 3, padding: '2px 7px',
                      fontFamily: UI.fontNum, fontSize: 11, color: UI.ink,
                    }}>
                      {st.kg ?? '—'}<span style={{ color: UI.inkFaint, fontSize: 9 }}>{UI.unit()}</span>
                      <span style={{ color: UI.inkFaint, margin: '0 1px' }}>×</span>
                      {isUni ? `L${st.repsL ?? '?'}/R${st.repsR ?? '?'}` : (st.reps ?? '—')}
                    </span>
                  ))}
                </div>
              </div>
              {i < visible.length - 1 && <div className="knurl" />}
            </React.Fragment>
          ))}

          {listSessions.length > showCount && (
            <button onClick={() => setShowCount(c => c + 20)} style={{
              width: '100%', marginTop: 16, padding: '10px 0',
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              color: UI.inkFaint, borderRadius: 4, cursor: 'pointer',
              fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
              WebkitTapHighlightColor: 'transparent',
            }}>
              Show more ({listSessions.length - showCount} remaining)
            </button>
          )}
        </>)}
      </div>
    </Screen>
  );
}


Object.assign(window.Screens, { LibraryScreen, ExerciseCreator, ExerciseDetailScreen, HistoryScreen, SessionDetailScreen, SpectatorScreen, ExerciseHistoryScreen });

window.EQUIPMENT_TYPES = EQUIPMENT_TYPES;
