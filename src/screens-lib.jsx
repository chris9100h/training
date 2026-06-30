/* Library + History + Session detail + Settings */

const { useState: useStateL, useMemo: useMemoL, useRef: useRefL, useEffect: useEffectL } = React;

// Persists library filter state across navigation (survives remounts)
const _lib = { tab: 'recent', q: '', filterTags: [], filterRestCats: [], filterUnilateral: null, filterPlan: null, filterEquipment: [], filtersOpen: false };

// ─── LIBRARY ──────────────────────────────────────────────────────────
function LibraryScreen({ store, setStore, go, userId }) {
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
      <TopBar title="Exercises" right={topBarRight} />
      <SubTabBar
        tabs={[
          { id: 'plan',   label: 'Workout',   icon: 'fa-dumbbell' },
          { id: 'lib',    label: 'Exercises', icon: 'fa-book' },
          { id: 'cardio', label: 'Cardio',    icon: 'fa-person-running' },
        ]}
        active="lib"
        onChange={id => { if (id === 'plan') go({ name: 'plan' }); else if (id === 'cardio') go({ name: 'cardio-plans' }); }}
      />

      {/* Tab strip */}
      <div style={{ display: 'flex', padding: '0 22px', borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0, marginTop: 8 }}>
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
          const isSystemCardio = e.movement_type === 'cardio';
          return (
            <React.Fragment key={e.id}>
            <div
              onClick={() => (selecting && !isSystemCardio) ? toggleSelect(e.id) : go({ name: 'exercise', exId: e.id })}
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
                  width: 20, height: 20, borderRadius: 4, flexShrink: 0,
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

      {creating && <ExerciseCreator onClose={() => setCreating(false)} store={store} setStore={setStore} initialTags={filterTags} />}

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
  { key: 'no_equipment',   label: 'No equipment' },
  { key: 'bodyweight',     label: 'Bodyweight' },
  { key: 'cable',          label: 'Cable' },
  { key: 'dumbbell',       label: 'Dumbbell' },
  { key: 'barbell_dual',   label: 'Dual plates' },
  { key: 'machine',        label: 'Machine' },
  { key: 'barbell_single', label: 'Single plate' },
];

// Shared chip style for the always-visible muscle / equipment pickers below.
// Replaces the expand-in-place dropdowns: a list that opened inside the
// (position:fixed) sheet was hard to tap precisely while the keyboard was up on
// iOS. Always-visible chips have no expand/scroll, so the hit area never drifts.
const pickChipStyle = (on) => ({
  padding: '9px 13px', borderRadius: 4, cursor: 'pointer',
  border: `1px solid ${on ? 'var(--accent)' : UI.hairStrong}`,
  background: on ? 'rgba(var(--accent-rgb),0.12)' : UI.bgInset,
  color: on ? 'var(--accent)' : UI.inkSoft,
  fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, lineHeight: 1.1,
  WebkitTapHighlightColor: 'transparent',
});

function EquipmentPills({ value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {EQUIPMENT_TYPES.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)} style={pickChipStyle(o.key === value)}>{o.label}</button>
      ))}
    </div>
  );
}

// Single tappable chip matching the muscle/equipment pickers — used for the
// smaller choices in the exercise editor (size, movement, rep target) so every
// chip in the form is the same size.
function Chip({ on, onClick, children }) {
  return <button onClick={onClick} style={pickChipStyle(on)}>{children}</button>;
}

// Dismiss the soft keyboard the instant the user taps a non-text control inside
// a sheet. On iOS an open keyboard desyncs position:fixed hit-testing from the
// visual layout, so taps on controls below an autofocused input land offset
// ("you have to tap above where you think"). Blurring on pointerdown restores
// the hit area for every following tap.
function blurKbOnControlTap(e) {
  const t = e.target;
  if (t && t.closest && !t.closest('input, textarea, [contenteditable]')) {
    try { if (document.activeElement) document.activeElement.blur(); } catch (_) {}
  }
}

function MusclePills({ value, onChange }) {
  const toggle = (m) => onChange(value.includes(m) ? value.filter(x => x !== m) : [...value, m]);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {MUSCLES.map(m => (
        <button key={m} onClick={() => toggle(m)} style={pickChipStyle(value.includes(m))}>{m}</button>
      ))}
    </div>
  );
}

// SVG knurl for use inside html2canvas — repeating-linear-gradient doesn't render there.
// useLayoutEffect resolves width="100%" to a pixel value before html2canvas serializes
// the SVG as a data URL (where percentage widths lose their containing block context).
function SvgKnurl({ style }) {
  const ref = useRefL(null);
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const w = Math.round(ref.current.getBoundingClientRect().width);
    if (w > 0) ref.current.setAttribute('width', w);
  }, []);
  // Read the CSS variable at render time so the color matches the active theme.
  const knurlRgb = getComputedStyle(document.documentElement).getPropertyValue('--knurl-rgb').trim() || '236,228,208';
  return (
    <svg ref={ref} width="100%" height="3" style={{ display: 'block', overflow: 'hidden', ...style }}>
      {Array.from({ length: 100 }, (_, i) => {
        const x = (i - 1) * 5.2;
        return <line key={i} x1={x} y1="3" x2={x + 1.73} y2="0" stroke={`rgba(${knurlRgb},0.20)`} strokeWidth="1.5" />;
      })}
    </svg>
  );
}

// Canvas placeholder for between-exercise knurl dividers in screenshot mode.
// takeScreenshot draws into these imperatively right before html2canvas runs,
// so timing is guaranteed regardless of when React flushes the re-render. Lines
// that overlap the avatar (bottom-right) are shortened there too, measured live.
function KnurlCanvas({ style }) {
  return <canvas data-knurl="1" style={{ display: 'block', width: '100%', height: 3, ...style }} />;
}

function ExerciseCreator({ onClose, store, setStore, onCreated, initialName = '', initialTags = [] }) {
  const [confirmEl, confirm] = useConfirm();
  const [name, setName] = useStateL(initialName);
  const [selectedTags, setSelectedTags] = useStateL(initialTags);
  const [category, setCategory] = useStateL(null);
  const [movementType, setMovementType] = useStateL('bilateral');
  const [noWeightReps, setNoWeightReps] = useStateL(false);
  const [equipment, setEquipment] = useStateL('barbell_dual');
  const [progressionReps, setProgressionReps] = useStateL(null);
  const [showSizeInfo, setShowSizeInfo] = useStateL(false);
  const [showBodyweightHint, setShowBodyweightHint] = useStateL(false);
  const toggleTag = (m) => setSelectedTags(t => t.includes(m) ? t.filter(x => x !== m) : [...t, m]);
  const handleEquipmentChange = (key) => {
    setEquipment(key || 'no_equipment');
    if (key === 'bodyweight' && !store?.settings?.showHealthTab) {
      setStore(s => ({ ...s, settings: { ...s.settings, showHealthTab: true } }));
      setShowBodyweightHint(true);
    }
  };
  const save = () => {
    if (!name.trim()) return;
    const ex = { id: LB.uid(), name: name.trim(), tags: selectedTags, category: category || null, unilateral: movementType === 'unilateral', movement_type: movementType, no_weight_reps: noWeightReps, equipment: equipment || null, note: '', progression_reps: progressionReps ?? null };
    setStore(s => ({ ...s, exercises: [...s.exercises, ex] }));
    onCreated?.(ex.id);
    onClose();
  };
  // Guard against an accidental backdrop tap wiping a half-filled form.
  const isDirty = () =>
    name.trim() !== initialName.trim() || selectedTags.length > 0 || category != null ||
    movementType !== 'bilateral' || noWeightReps || progressionReps != null || equipment !== 'barbell_dual';
  const requestClose = async () => {
    if (isDirty() && !await confirm('Your new exercise will be discarded.', { title: 'Leave without saving?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    onClose();
  };
  return (
    <>
    <Sheet open={true} onClose={requestClose} title="New exercise">
      <div onPointerDown={blurKbOnControlTap} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Field label="Name">
          <TextInput value={name} onChange={v => setName(v.toUpperCase())} placeholder="e.g. BENCH PRESS" autoFocus />
        </Field>
        <div>
          <span className="label">Muscle group</span>
          <MusclePills value={selectedTags} onChange={setSelectedTags} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="label">Exercise size</span>
            <button onClick={() => setShowSizeInfo(v => !v)} style={{
              background: 'none', border: `1px solid ${UI.hairStrong}`, borderRadius: '50%',
              width: 22, height: 22, padding: 0, cursor: 'pointer', color: UI.inkFaint,
              fontFamily: UI.fontUi, fontSize: 11, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent', flexShrink: 0,
            }}>?</button>
          </div>
          {showSizeInfo && (
            <div style={{ marginTop: 6, padding: '8px 10px', background: UI.bgRaised, borderRadius: 6, border: `1px solid ${UI.hairStrong}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[['BIG','Heavy compounds — squat, deadlift, overhead press'],['MEDIUM','Moderate compounds — bench press, pull-up, lunge'],['SMALL','Isolation — bicep curl, lateral raise, tricep extension']].map(([k,v]) => (
                <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span className="micro" style={{ color: UI.gold, flexShrink: 0, minWidth: 46 }}>{k}</span>
                  <span className="micro" style={{ color: UI.inkSoft, letterSpacing: '0.04em', textTransform: 'none', fontWeight: 400 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {EXERCISE_SIZES.map(([val, label]) => (
              <Chip key={val} on={category === val} onClick={() => setCategory(c => c === val ? null : val)}>{label}</Chip>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Equipment</span>
          <EquipmentPills value={equipment} onChange={handleEquipmentChange} />
        </div>
        <div>
          <span className="label">Movement type</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {[['bilateral', 'Bilateral'], ['unilateral', 'Unilateral'], ['mobility', 'Mobility']].map(([val, label]) => (
              <Chip key={val} on={movementType === val}
                onClick={() => { setMovementType(val); setNoWeightReps(val === 'mobility'); if (val === 'mobility') setEquipment('no_equipment'); }}
              >{label}</Chip>
            ))}
          </div>
          {movementType === 'mobility' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              <Chip on={noWeightReps} onClick={() => setNoWeightReps(true)}>Checkbox only</Chip>
              <Chip on={!noWeightReps} onClick={() => setNoWeightReps(false)}>Weight & Reps</Chip>
            </div>
          )}
        </div>
        <div>
          <span className="label">Rep target</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <Chip on={progressionReps != null} onClick={() => setProgressionReps(v => v == null ? 12 : null)}>
              {progressionReps != null ? 'On' : 'Off'}
            </Chip>
            {progressionReps != null
              ? <Stepper value={progressionReps} onChange={v => setProgressionReps(Math.max(1, Math.round(v)))} step={1} min={1} />
              : <span style={{ color: UI.inkFaint, fontSize: 13 }}>Uses planned reps per day</span>
            }
          </div>
        </div>
        <Btn onClick={save} style={{ opacity: name.trim() ? 1 : 0.4 }} disabled={!name.trim()}>Create</Btn>
      </div>
    </Sheet>
    {showBodyweightHint && (
      <Sheet open={true} onClose={() => setShowBodyweightHint(false)} title="Health tab activated">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 14, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>
            The <strong style={{ color: UI.ink }}>Health</strong> tab is now active. Tap it in the bottom nav, then tap <strong style={{ color: UI.ink }}>Log</strong> to record your weight — it'll be pre-filled automatically when you train bodyweight exercises.
          </div>
          <Btn onClick={() => setShowBodyweightHint(false)}>OK</Btn>
        </div>
      </Sheet>
    )}
    {confirmEl}
    </>
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

function ExerciseDetailScreenInner({ store, setStore, go, exId, back, editQueue = [], editQueueTotal = 0, autoEdit = false, ex, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [editMode, setEditMode] = useStateL(autoEdit);
  const [editName, setEditName] = useStateL(autoEdit ? ex.name : '');
  const [editTags, setEditTags] = useStateL(autoEdit ? [...(ex.tags || [])] : []);
  const [editCategory, setEditCategory] = useStateL(autoEdit ? (ex.category || null) : null);
  const [editMovementType, setEditMovementType] = useStateL(autoEdit ? (ex.movement_type ?? (ex.unilateral ? 'unilateral' : 'bilateral')) : 'bilateral');
  const [editNoWeightReps, setEditNoWeightReps] = useStateL(autoEdit ? !!ex.no_weight_reps : false);
  const [editEquipment, setEditEquipment] = useStateL(autoEdit ? (ex.equipment || null) : null);
  const [editProgressionReps, setEditProgressionReps] = useStateL(autoEdit ? (ex.progression_reps ?? null) : null);
  const [editYoutubeUrl, setEditYoutubeUrl] = useStateL(autoEdit ? (ex.youtube_url || '') : '');
  const [editNote, setEditNote] = useStateL(false);
  const [noteVal, setNoteVal] = useStateL(ex.note || '');
  const [showSizeInfoEdit, setShowSizeInfoEdit] = useStateL(false);
  const [showBodyweightHint, setShowBodyweightHint] = useStateL(false);
  const handleEditEquipmentChange = (key) => {
    setEditEquipment(key || null);
    if (key === 'bodyweight' && !store.settings?.showHealthTab) {
      setStore(s => ({ ...s, settings: { ...s.settings, showHealthTab: true } }));
      setShowBodyweightHint(true);
    }
  };

  const advanceQueue = () => {
    if (editQueue.length > 0) {
      const [next, ...rest] = editQueue;
      go({ name: 'exercise', exId: next, editQueue: rest, editQueueTotal, autoEdit: true });
    } else {
      go(back || { name: 'lib' });
    }
  };

  const startEdit = () => { setEditName(ex.name); setEditTags([...(ex.tags || [])]); setEditCategory(ex.category || null); setEditMovementType(ex.movement_type ?? (ex.unilateral ? 'unilateral' : 'bilateral')); setEditNoWeightReps(!!ex.no_weight_reps); setEditEquipment(ex.equipment || null); setEditProgressionReps(ex.progression_reps ?? null); setEditYoutubeUrl(ex.youtube_url || ''); setEditMode(true); };
  const cancelEdit = () => { if (autoEdit) advanceQueue(); else setEditMode(false); };
  const saveEdit = () => {
    if (!editName.trim()) return;
    const newProgressionReps = editProgressionReps ?? null;
    const repsChanged = newProgressionReps !== (ex.progression_reps ?? null);
    setStore(s => {
      const exercises = s.exercises.map(e => e.id === exId
        ? { ...e, name: editName.trim(), tags: editTags, category: editCategory || null, unilateral: editMovementType === 'unilateral', movement_type: editMovementType, no_weight_reps: editNoWeightReps, equipment: editEquipment || null, progression_reps: newProgressionReps, youtube_url: editYoutubeUrl.trim() || null }
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
    setStore(s => ({
      ...s,
      exercises: s.exercises.filter(e => e.id !== exId),
      schedules: s.schedules.map(sch => ({
        ...sch,
        days: (sch.days || []).map(day => ({
          ...day,
          items: (day.items || []).filter(item => item.exId !== exId),
        })),
      })),
    }));
    go({ name: 'lib' });
  };

  // Local window renders instantly (and is all we have offline); the server
  // history (get_exercise_history) extends the chart/PRs to the full account
  // age once it arrives. Rows are merged by session id, newest first.
  const [serverRows, setServerRows] = useStateL(null);
  useEffectL(() => {
    let on = true;
    LB.fetchExerciseHistory(exId, null, 500, userId)
      .then(rows => { if (on) setServerRows(rows); })
      .catch(() => {});
    return () => { on = false; };
  }, [exId]);

  const history = useMemoL(() => {
    const local = store.sessions
      .filter(s => s.ended && s.entries.some(e => e.exId === exId))
      .map(s => ({ session: s, entry: s.entries.find(e => e.exId === exId) }));
    const seen = new Set(local.map(h => h.session.id));
    // Session metadata (dayName, date, …) is fully loaded at boot — attach it
    // to the server rows so the list renders like the local ones.
    const metaById = new Map(store.sessions.map(s => [s.id, s]));
    const remote = (serverRows || [])
      .filter(r => !seen.has(r.sessionId))
      .map(r => ({
        session: metaById.get(r.sessionId) || { id: r.sessionId, dayId: r.dayId, date: r.date, ended: r.ended },
        entry: { exId, sets: r.sets },
      }));
    return [...local, ...remote]
      .sort((a, b) => (Date.parse(b.session.ended) || 0) - (Date.parse(a.session.ended) || 0));
  }, [store.sessions, exId, serverRows]);

  const e1rmForSet = (s) => {
    if (s.kg == null) return 0;
    if (s.repsL != null || s.repsR != null) return LB.e1rm(s.kg, Math.min(s.repsL ?? 0, s.repsR ?? 0));
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
            ) : ex.movement_type === 'cardio' ? (
              <span className="micro" style={{ color: UI.inkFaint, letterSpacing: '0.1em' }}>SYSTEM</span>
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
          <div onPointerDown={blurKbOnControlTap} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Name">
              <TextInput value={editName} onChange={v => setEditName(v.toUpperCase())} />
            </Field>
            <div>
              <span className="label">Muscle group</span>
              <MusclePills value={editTags} onChange={setEditTags} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="label">Exercise size</span>
                <button onClick={() => setShowSizeInfoEdit(v => !v)} style={{
                  background: 'none', border: `1px solid ${UI.hairStrong}`, borderRadius: '50%',
                  width: 22, height: 22, padding: 0, cursor: 'pointer', color: UI.inkFaint,
                  fontFamily: UI.fontUi, fontSize: 11, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  WebkitTapHighlightColor: 'transparent', flexShrink: 0,
                }}>?</button>
              </div>
              {showSizeInfoEdit && (
                <div style={{ marginTop: 6, padding: '8px 10px', background: UI.bgRaised, borderRadius: 6, border: `1px solid ${UI.hairStrong}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[['BIG','Heavy compounds — squat, deadlift, overhead press'],['MEDIUM','Moderate compounds — bench press, pull-up, lunge'],['SMALL','Isolation — bicep curl, lateral raise, tricep extension']].map(([k,v]) => (
                    <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span className="micro" style={{ color: UI.gold, flexShrink: 0, minWidth: 46 }}>{k}</span>
                      <span className="micro" style={{ color: UI.inkSoft, letterSpacing: '0.04em', textTransform: 'none', fontWeight: 400 }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {EXERCISE_SIZES.map(([val, label]) => (
                  <Chip key={val} on={editCategory === val} onClick={() => setEditCategory(c => c === val ? null : val)}>{label}</Chip>
                ))}
              </div>
            </div>
            <div>
              <span className="label">Equipment</span>
              <EquipmentPills value={editEquipment} onChange={handleEditEquipmentChange} />
            </div>
            <div>
              <span className="label">Movement type</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {[['bilateral', 'Bilateral'], ['unilateral', 'Unilateral'], ['mobility', 'Mobility']].map(([val, label]) => (
                  <Chip key={val} on={editMovementType === val}
                    onClick={() => { setEditMovementType(val); setEditNoWeightReps(val === 'mobility'); if (val === 'mobility') setEditEquipment('no_equipment'); }}
                  >{label}</Chip>
                ))}
              </div>
              {editMovementType === 'mobility' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  <Chip on={editNoWeightReps} onClick={() => setEditNoWeightReps(true)}>Checkbox only</Chip>
                  <Chip on={!editNoWeightReps} onClick={() => setEditNoWeightReps(false)}>Weight & Reps</Chip>
                </div>
              )}
            </div>
            <div>
              <span className="label">Rep target</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <Chip on={editProgressionReps != null} onClick={() => setEditProgressionReps(v => v == null ? 12 : null)}>
                  {editProgressionReps != null ? 'On' : 'Off'}
                </Chip>
                {editProgressionReps != null
                  ? <Stepper value={editProgressionReps} onChange={v => setEditProgressionReps(Math.max(1, Math.round(v)))} step={1} min={1} />
                  : <span style={{ color: UI.inkFaint, fontSize: 13 }}>Uses planned reps per day</span>
                }
              </div>
            </div>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i className="fa-brands fa-youtube" style={{ color: '#FF0000', fontSize: 12 }} />Form video</span>}>
              <TextInput value={editYoutubeUrl} onChange={setEditYoutubeUrl} placeholder="YouTube link (optional)" />
            </Field>
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
            {ex.movement_type === 'unilateral' || (ex.unilateral && !ex.movement_type) ? <Pill gold>Unilateral</Pill> : null}
            {ex.movement_type === 'mobility' && <Pill gold>Mobility</Pill>}
            {ex.movement_type === 'cardio' && <Pill gold>Cardio</Pill>}
            {(ex.tags || []).map(t => <Pill key={t} gold>{t}</Pill>)}
            {ex.equipment && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>{EQUIPMENT_TYPES.find(t => t.key === ex.equipment)?.label ?? ex.equipment}</Pill>}
            {!ex.category && !ex.unilateral && ex.movement_type !== 'mobility' && ex.movement_type !== 'cardio' && !(ex.tags || []).length && <span className="micro" style={{ fontStyle: 'italic', color: UI.inkFaint }}>No muscle group — Edit</span>}
          </div>
        )}
      </div>

      {!editMode && <div style={{ padding: '18px 22px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Form video link */}
        {ex.youtube_url && (
          <a href={ex.youtube_url} target="_blank" rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '11px 12px', borderRadius: 6, textDecoration: 'none',
              border: `0.5px solid ${UI.hairStrong}`, background: UI.bgRaised,
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12,
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>
            <i className="fa-brands fa-youtube" style={{ color: '#FF0000', fontSize: 16 }} />
            Watch form video
          </a>
        )}

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
      {showBodyweightHint && (
        <Sheet open={true} onClose={() => setShowBodyweightHint(false)} title="Health tab activated">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 14, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>
              The <strong style={{ color: UI.ink }}>Health</strong> tab is now active. Tap it in the bottom nav, then tap <strong style={{ color: UI.ink }}>Log</strong> to record your weight — it'll be pre-filled automatically when you train bodyweight exercises.
            </div>
            <Btn onClick={() => setShowBodyweightHint(false)}>OK</Btn>
          </div>
        </Sheet>
      )}
      {confirmEl}
    </Screen>
  );
}

function ProgressChart({ points }) {
  const w = 280, h = 108, padT = 8, padB = 20, padL = 36, padR = 8;
  const max = Math.max(...points.map(p => p.est));
  const min = Math.min(...points.map(p => p.est));
  const dom = UI.chartDomain(min, max);
  const gridVals = Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const yOf = v => padT + (1 - (v - dom.min) / dom.range) * (h - padT - padB);
  const xy = points.map((p, i) => {
    const x = padL + (i / Math.max(1, points.length - 1)) * (w - padL - padR);
    return [x, yOf(p.est)];
  });
  const path = xy.map(([x,y], i) => `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const fmtDate = d => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  const unit = UI.unit();
  return (
    <div style={{ padding: '10px 0', maxWidth: 380 }}>
      <div className="micro" style={{ marginBottom: 8, color: UI.inkFaint }}>EST. 1RM · HISTORY</div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>
        {gridVals.map((v, i) => (
          <g key={`g${i}`}>
            {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={w - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
            <text x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fill={UI.inkFaint} fontFamily={UI.fontNum}>{i === 3 ? `${Math.round(v)} ${unit}` : Math.round(v)}</text>
          </g>
        ))}
        <line x1={padL} y1={padT} x2={padL} y2={h - padB} stroke={UI.hair} strokeWidth="0.5" />
        <line x1={padL} y1={h - padB} x2={w - padR} y2={h - padB} stroke={UI.hair} strokeWidth="0.5" />
        <path d={path} fill="none" stroke={UI.gold} strokeWidth="1" opacity="0.6" />
        {xy.map(([x,y], i) => (
          <circle key={i} cx={x} cy={y} r="2" fill={UI.gold} />
        ))}
        {points.length > 1 && <>
          <text x={padL} y={h - 6} textAnchor="start" fontSize="8" fill={UI.inkFaint} fontFamily={UI.fontUi}>{fmtDate(points[0].date)}</text>
          <text x={w - padR} y={h - 6} textAnchor="end" fontSize="8" fill={UI.inkFaint} fontFamily={UI.fontUi}>{fmtDate(points[points.length - 1].date)}</text>
        </>}
      </svg>
    </div>
  );
}

// ─── CARDIO TYPE DETAIL SHEET ────────────────────────────────────────
function CardioLineChart({ points, label, formatVal, yMin, yMax }) {
  if (!points || points.length < 2) return null;
  const w = 200, h = 88, padT = 8, padB = 18, padL = 34, padR = 6;
  const vals = points.map(p => p.value);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const dom = UI.chartDomain(min, max, { min: yMin, max: yMax });
  const yOf = v => padT + (1 - (v - dom.min) / dom.range) * (h - padT - padB);
  const xy = points.map((p, i) => {
    const x = padL + (i / Math.max(1, points.length - 1)) * (w - padL - padR);
    return [x, yOf(p.value)];
  });
  const pathD = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const fmtDate = d => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  return (
    <div style={{ background: UI.bgInset, borderRadius: 6, padding: '10px 12px', border: `0.5px solid ${UI.hair}` }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 2 }}>
        <span className="num" style={{ fontSize: 17, color: UI.gold }}>{formatVal(vals.reduce((s, v) => s + v, 0) / vals.length)}</span>
        <span className="micro" style={{ color: UI.inkFaint }}>AVG</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>
        <line x1={padL} y1={padT} x2={padL} y2={h - padB} stroke={UI.hair} strokeWidth="0.5" />
        <line x1={padL} y1={h - padB} x2={w - padR} y2={h - padB} stroke={UI.hair} strokeWidth="0.5" />
        <line x1={padL} y1={yOf(max).toFixed(1)} x2={w - padR} y2={yOf(max).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="2 2" />
        {max > min && <line x1={padL} y1={yOf(min).toFixed(1)} x2={w - padR} y2={yOf(min).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="2 2" />}
        <text x={padL - 4} y={(yOf(max) + 2.5).toFixed(1)} textAnchor="end" fontSize="7" fill={UI.inkFaint} fontFamily={UI.fontUi}>{formatVal(max)}</text>
        {max > min && (yOf(min) - yOf(max)) >= 10 && <text x={padL - 4} y={(yOf(min) + 2.5).toFixed(1)} textAnchor="end" fontSize="7" fill={UI.inkFaint} fontFamily={UI.fontUi}>{formatVal(min)}</text>}
        <path d={pathD} fill="none" stroke={UI.gold} strokeWidth="1.2" opacity="0.7" />
        {xy.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={xy.length > 60 ? 0 : 1.5} fill={UI.gold} />)}
        <text x={padL} y={h - 4} textAnchor="start" fontSize="7" fill={UI.inkFaint} fontFamily={UI.fontUi}>{fmtDate(points[0].date)}</text>
        <text x={w - padR} y={h - 4} textAnchor="end" fontSize="7" fill={UI.inkFaint} fontFamily={UI.fontUi}>{fmtDate(points[points.length - 1].date)}</text>
      </svg>
    </div>
  );
}

function CardioTypeDetailSheet({ type, logs, open, onClose }) {
  const du = (() => { try { return localStorage.getItem(CARDIO_DIST_KEY_H) || 'km'; } catch (_) { return 'km'; } })();
  if (!open || !type) return null;
  const filtered = logs
    .filter(l => (l.type || '').toLowerCase() === type.toLowerCase())
    .slice(0, 360)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (filtered.length < 2) return (
    <Sheet open={open} onClose={onClose} title={type}>
      <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, paddingBottom: 20 }}>Log at least 2 sessions of this type to see charts.</div>
    </Sheet>
  );

  const totalMin = filtered.reduce((s, l) => s + (l.durationMinutes || 0), 0);
  const totalM = filtered.reduce((s, l) => s + (l.distanceM || 0), 0);

  const durPoints = filtered.map(l => ({ date: l.date, value: l.durationMinutes }));
  const distPoints = filtered.filter(l => l.distanceM != null).map(l => ({ date: l.date, value: du === 'mi' ? l.distanceM / MI_TO_M_H : l.distanceM / 1000 }));
  const pacePoints = filtered.filter(l => l.distanceM != null && l.durationMinutes > 0).map(l => ({ date: l.date, value: (l.distanceM / 1000) * 60 / (du === 'mi' ? l.distanceM / MI_TO_M_H * (1000 / 1000) : 1) }));
  const speedPoints = filtered.filter(l => l.distanceM != null && l.durationMinutes > 0).map(l => ({ date: l.date, value: parseFloat(((du === 'mi' ? l.distanceM / MI_TO_M_H : l.distanceM / 1000) / (l.durationMinutes / 60)).toFixed(2)) }));
  const effortPoints = filtered.filter(l => l.effort != null).map(l => ({ date: l.date, value: l.effort }));
  const paceFlPoints = filtered.filter(l => l.paceFeeling != null).map(l => ({ date: l.date, value: l.paceFeeling }));
  const paceFlLabels = ['', 'Easy', 'Light', 'Steady', 'Solid', 'Hard', 'Max'];

  const charts = [
    durPoints.length >= 2 && { points: durPoints, label: 'DURATION', formatVal: v => `${Math.round(v)}min` },
    speedPoints.length >= 2 && { points: speedPoints, label: `SPEED (${du}/h)`, formatVal: v => v.toFixed(1) },
    effortPoints.length >= 2 && { points: effortPoints, label: 'EFFORT', formatVal: v => `${Math.round(v * 10) / 10}/10`, yMin: 0, yMax: 10 },
    paceFlPoints.length >= 2 && { points: paceFlPoints, label: 'PACE FEELING', formatVal: v => paceFlLabels[Math.round(v)] || Math.round(v), yMin: 0, yMax: 6 },
    distPoints.length >= 2 && { points: distPoints, label: `DISTANCE (${du})`, formatVal: v => v.toFixed(2) },
  ].filter(Boolean);

  const summaryParts = [
    `${filtered.length} sessions`,
    totalMin > 0 && `${Math.floor(totalMin / 60)}h ${totalMin % 60}min total`,
    totalM > 0 && `${du === 'mi' ? (totalM / MI_TO_M_H).toFixed(1) : (totalM / 1000).toFixed(1)} ${du} total`,
  ].filter(Boolean);

  return (
    <Sheet open={open} onClose={onClose} title={type}>
      <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 16 }}>{summaryParts.join(' · ')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, paddingBottom: 8 }}>
        {charts.map((c, i) => <CardioLineChart key={i} points={c.points} label={c.label} formatVal={c.formatVal} yMin={c.yMin} yMax={c.yMax} />)}
      </div>
    </Sheet>
  );
}

// ─── WORKOUT EFFORT CHART ─────────────────────────────────────────────
function WorkoutEffortSheet({ dayId, dayName, sessions, onClose }) {
  const FEEL_NUM = { easy: 1, good: 2, hard: 3, very_hard: 4, max: 5 };
  const FEEL_LBL = { 1: 'Easy', 2: 'Good', 3: 'Hard', 4: 'Very Hard', 5: 'Max' };
  const fmtDate = iso => { const d = new Date(iso + 'T12:00:00'); return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`; };

  const filtered = [...sessions]
    .filter(s => s.ended && (dayId ? s.dayId === dayId : s.dayName === dayName))
    .sort((a, b) => a.date.localeCompare(b.date));

  const effortPts = filtered
    .filter(s => s.feel)
    .map(s => ({ date: s.date.slice(0, 10), value: FEEL_NUM[s.feel] }))
    .filter(p => p.value);

  const volumePts = filtered
    .map(s => ({ date: s.date.slice(0, 10), value: LB.totalVolume(s) }))
    .filter(p => p.value > 0);

  const W = 300, padL = 52, padR = 16, padTop = 36, padBottom = 26, plotH = 100;
  const H = padTop + plotH + padBottom;
  const plotW = W - padL - padR;

  const renderLine = (points, gridLines, fmtY) => {
    const n = points.length;
    const maxVal = Math.max(...points.map(p => p.value));
    const dom = UI.chartDomain(0, maxVal, { zeroFloor: true });
    const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
    const xOf = i => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const pts = points.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ');
    const base = (padTop + plotH).toFixed(1);
    const labelStep = Math.max(1, Math.round(n / 5));
    const showLbl = i => i === n - 1 || i % labelStep === 0;
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
        {gridLines.map((lvl, gi) => (
          <g key={gi}>
            <line x1={padL} y1={yOf(lvl).toFixed(1)} x2={W - padR} y2={yOf(lvl).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />
            <text x={padL - 6} y={(yOf(lvl) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontUi} fill={UI.inkFaint}>{fmtY(lvl)}</text>
          </g>
        ))}
        <line x1={padL} y1={padTop} x2={padL} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
        <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
        <polygon points={`${xOf(0).toFixed(1)},${base} ${pts} ${xOf(n - 1).toFixed(1)},${base}`} fill="rgba(var(--accent-rgb),0.12)" />
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => {
          const cx = xOf(i).toFixed(1), cy = yOf(p.value).toFixed(1);
          const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={i === n - 1 ? '3.5' : '2.5'} fill="var(--accent)" />
              {showLbl(i) && <text x={cx} y={(padTop + plotH + 18).toFixed(1)} textAnchor={anchor} fontSize="8" fontFamily={UI.fontUi} fill={UI.inkFaint}>{fmtDate(p.date)}</text>}
            </g>
          );
        })}
      </svg>
    );
  };

  const effortGridLines = [1, 2, 3, 4, 5];

  const maxVol = volumePts.length ? Math.max(...volumePts.map(p => p.value)) : 0;
  const volDom = volumePts.length ? UI.chartDomain(0, maxVol, { zeroFloor: true }) : null;
  const volGridLines = volDom ? [0, Math.round(volDom.max / 2), Math.round(volDom.max)] : [];
  const fmtVol = v => v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`;

  const sectionLabel = (icon, text) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
      <i className={`fa-solid ${icon}`} style={{ fontSize: 10, color: 'var(--accent)' }} />
      <span className="label" style={{ color: UI.inkSoft }}>{text}</span>
    </div>
  );

  const content = (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div style={{ background: UI.bg, borderRadius: '6px 6px 0 0', borderTop: `0.5px solid ${UI.hairStrong}`, width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 0', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{dayName}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, fontSize: 18, lineHeight: 1 }}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '20px 20px 44px' }}>
          {sectionLabel('fa-gauge-high', 'EFFORT OVER TIME')}
          {effortPts.length > 0
            ? renderLine(effortPts, effortGridLines, v => FEEL_LBL[v])
            : <div style={{ textAlign: 'center', padding: '12px 0 4px', fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>No effort ratings yet</div>
          }
          {effortPts.length > 0 && (
            <div style={{ marginTop: 6, textAlign: 'center' }}>
              <span className="micro" style={{ color: UI.inkFaint }}>{effortPts.length} SESSION{effortPts.length !== 1 ? 'S' : ''} WITH EFFORT RATING</span>
            </div>
          )}

          <div style={{ height: 0.5, background: UI.hair, margin: '20px 0' }} />

          {sectionLabel('fa-dumbbell', 'VOLUME OVER TIME')}
          {volumePts.length > 0
            ? renderLine(volumePts, volGridLines, fmtVol)
            : <div style={{ textAlign: 'center', padding: '12px 0 4px', fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>No volume data</div>
          }
          {volumePts.length > 0 && (
            <div style={{ marginTop: 6, textAlign: 'center' }}>
              <span className="micro" style={{ color: UI.inkFaint }}>{volumePts.length} SESSION{volumePts.length !== 1 ? 'S' : ''} · {UI.unit().toUpperCase()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  return ReactDOM.createPortal(content, document.body);
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
  const isFlex = sch ? LB.isFlexPlan(sch) : false;
  const isCycleMode = sch && !LB.isWeekdayPlan(sch) && !!store.cycleStartDate;
  const cycleLen = sch?.days?.length || 1;
  // Use getCycleNumForDate (version-aware) when versions exist; fall back to
  // simple arithmetic for unversioned plans. Both return 1-indexed; convert to
  // 0-indexed for internal use (display adds 1 back via selectedCycleNum + 1).
  const todayISO = today.toISOString().slice(0, 10);
  const currentCycleNum = (() => {
    if (!isCycleMode) return 0;
    if (sch?.versions?.length) return LB.getCycleNumForDate(sch, todayISO) - 1;
    return Math.floor(Math.round((today.getTime() - LB.parseDate(store.cycleStartDate).getTime()) / 86400000) / cycleLen);
  })();
  // Start of the current cycle window — use the version-aware helper when versions exist
  const cycleWindowStart = (() => {
    if (!isCycleMode) return null;
    if (sch?.versions?.length) {
      const d = LB.getCycleStartForNum(sch, currentCycleNum + 1);
      return d || null;
    }
    const start = LB.parseDate(store.cycleStartDate);
    const n = Math.round((today.getTime() - start.getTime()) / 86400000);
    const idxInCycle = ((n % cycleLen) + cycleLen) % cycleLen;
    const d = new Date(today); d.setDate(today.getDate() - idxInCycle);
    return d;
  })();

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
        .reduce((sum, s) => sum + LB.totalVolume(s, store.exercises), 0);
      const label = wMon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      weeks.push({ label, vol });
    }
    return weeks;
  }, [sessions, todayKey]);

  // All-time stats
  const totalVol = sessions.reduce((sum, s) => sum + LB.totalVolume(s, store.exercises), 0);
  const avgVol = sessions.length ? Math.round(totalVol / sessions.length) : 0;
  const durations = sessions
    .map(s => s.durationMinutes != null
      ? s.durationMinutes
      : (s.startedAt && s.ended ? Math.round((new Date(s.ended) - new Date(s.startedAt)) / 60000) : null))
    .filter(d => d != null && d > 0);
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const maxDuration = durations.length ? Math.max(...durations) : 0;

  // Best session by volume
  const bestSession = sessions.length ? sessions.reduce((best, s) => LB.totalVolume(s, store.exercises) > LB.totalVolume(best, store.exercises) ? s : best, sessions[0]) : null;

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
    const dateStr = date.toISOString().slice(0, 10);
    const days = LB.getPlanDaysForDate(sch, dateStr);
    const idx = LB.getCyclePosForDate(sch, dateStr);
    if (idx !== null) return (days[idx]?.items || []).length > 0;
    if (!store.cycleStartDate) return true;
    const start = LB.parseDate(store.cycleStartDate);
    const n = Math.round((date.getTime() - start.getTime()) / 86400000);
    if (n < 0) return false;
    const day = sch.days[((n % sch.days.length) + sch.days.length) % sch.days.length];
    return day ? day.items.length > 0 : false;
  };

  const oldestVersion = sch?.versions?.length ? sch.versions[sch.versions.length - 1] : null;
  const planStart = oldestVersion ? LB.parseDate(oldestVersion.validFrom) : (store.cycleStartDate ? LB.parseDate(store.cycleStartDate) : null);

  // Streaks scan up to ~730 days (+ the full history for the longest streak).
  // Memoize so this only re-runs when the day rolls over, the sessions change,
  // or the active plan changes — not on every unrelated re-render.
  const { currentStreak, longestStreak } = useMemoL(() => {
    const periods = store.statusPeriods || [];
    const isInStatusPeriod = (d) => {
      const ts = d.getTime();
      return periods.some(p => {
        const start = new Date(p.startedAt).getTime();
        const end = p.endedAt ? new Date(p.endedAt).getTime() : Date.now();
        return ts >= start && ts <= end;
      });
    };
    let cur = 0;
    for (let i = 0; i <= 730; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i); d.setHours(12, 0, 0, 0);
      if (planStart && d < planStart) break; // don't count before plan start
      const key = d.toISOString().slice(0, 10);
      if (sessionDateSet.has(key)) { cur++; }
      else if (i === 0) { /* today not done yet — don't break */ }
      else if (isTrainingDay(d) && !isInStatusPeriod(d)) { break; }
      // rest day or sick/vacation day → continue without breaking or counting
    }
    let longest = 0, ls = 0;
    if (sessions.length > 0) {
      const earliest = planStart ?? LB.parseDate(sessions[sessions.length - 1].date);
      const dayCount = Math.round((today.getTime() - earliest.getTime()) / 86400000) + 1;
      for (let i = 0; i < dayCount; i++) {
        const d = new Date(earliest); d.setDate(earliest.getDate() + i); d.setHours(12, 0, 0, 0);
        const key = d.toISOString().slice(0, 10);
        if (sessionDateSet.has(key)) { ls++; longest = Math.max(longest, ls); }
        else if (isTrainingDay(d) && !isInStatusPeriod(d)) { ls = 0; }
        // rest day or sick/vacation day → ls unchanged
      }
    }
    return { currentStreak: cur, longestStreak: longest };
  }, [todayKey, sessions, store.statusPeriods, store.activeScheduleId, store.cycleStartDate]);

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
    const anchorDay = LB.isoWd(anchor);
    const anchorMonday = new Date(anchor); anchorMonday.setDate(anchor.getDate() - anchorDay); anchorMonday.setHours(0,0,0,0);
    // Monday of the current week
    const todayDay = LB.isoWd(today);
    const currentMonday = new Date(today); currentMonday.setDate(today.getDate() - todayDay); currentMonday.setHours(0,0,0,0);
    const weeks = Math.round((currentMonday - anchorMonday) / (7 * 86400000)) + 1;
    return (relevant.length / Math.max(1, weeks)).toFixed(1);
  }, [sessions, planStart]);

  const { missedWorkouts, sickVacationMissed } = useMemoL(() => {
    if (!sch || !planStart) return { missedWorkouts: 0, sickVacationMissed: 0 };
    const skipDates = new Set((store.skips || []).map(s => s.date.slice(0, 10)));
    const periods = store.statusPeriods || [];
    const isInStatusPeriod = (dateStr) => {
      const ts = new Date(dateStr + 'T12:00:00').getTime();
      return periods.some(p => {
        const start = new Date(p.startedAt).getTime();
        const end = p.endedAt ? new Date(p.endedAt).getTime() : Date.now();
        return ts >= start && ts <= end;
      });
    };
    let missed = 0, sickVac = 0;
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1); yesterday.setHours(12, 0, 0, 0);
    for (let d = new Date(planStart); d <= yesterday; d.setDate(d.getDate() + 1)) {
      d.setHours(12, 0, 0, 0);
      if (!isTrainingDay(d)) continue;
      const key = d.toISOString().slice(0, 10);
      if (sessionDateSet.has(key) || skipDates.has(key)) continue;
      missed++;
      if (isInStatusPeriod(key)) sickVac++;
    }
    return { missedWorkouts: missed, sickVacationMissed: sickVac };
  }, [todayKey, sessions, store.skips, store.statusPeriods, store.activeScheduleId, store.cycleStartDate, planStart]);

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
            <div style={{ flex: 1, height: 3, background: UI.hair, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(sets / maxSets) * 100}%`, background: UI.gold, borderRadius: 4 }} />
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
                width: '100%', borderRadius: 4,
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
          {/* Streaks are day-based and assume fixed training days — meaningless for
              flexible plans, where the rotation never expects a specific day. */}
          {!isFlex && (
            <div style={{ gridColumn: '1 / -1', background: UI.goldFaint, borderRadius: 4, padding: '14px 14px', textAlign: 'center', border: `1px solid ${UI.goldSoft}` }}>
              <div className="micro" style={{ color: UI.gold, marginBottom: 6 }}>CURRENT STREAK</div>
              <div className="num" style={{ fontSize: 40, color: UI.gold, lineHeight: 1 }}>{currentStreak}</div>
              <div className="micro" style={{ color: UI.gold, marginTop: 5, opacity: 0.7 }}>{currentStreak === 1 ? 'DAY' : 'DAYS'}</div>
            </div>
          )}
          {!isFlex && (
            <div style={{ gridColumn: '1 / -1', background: UI.goldFaint, borderRadius: 4, padding: '10px 14px', textAlign: 'center', border: `1px solid ${UI.goldSoft}` }}>
              <div className="micro" style={{ color: UI.gold, marginBottom: 4 }}>LONGEST STREAK</div>
              <div className="num" style={{ fontSize: 28, color: UI.gold, lineHeight: 1 }}>{longestStreak}</div>
              <div className="micro" style={{ color: UI.gold, marginTop: 3, opacity: 0.7 }}>{longestStreak === 1 ? 'DAY' : 'DAYS'}</div>
            </div>
          )}
          <StatCard label="Avg / Week" value={avgSessionsPerWeek} sub="sessions" compact />
          <StatCard label="This Year" value={thisYearSessions.length} sub="sessions" compact />
          <StatCard label="This Month" value={thisMonthSessions.length} sub="sessions" compact />
          <StatCard label="This Week" value={thisWeekSessions.length} sub="sessions" compact />
          {planStart && <StatCard label="Missed Workouts" value={missedWorkouts} sub="since plan start" compact />}
          {planStart && <StatCard label="Of Which Sick/Away" value={sickVacationMissed} sub="status mode" compact />}
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
                  {bestSession.entries.length || bestSession.aggExercises || 0} exercises · {LB.doneSetCount(bestSession)} sets
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
const CARDIO_DIST_KEY_H = 'logbook-cardio-dist-unit';
const MI_TO_M_H = 1609.344;
function mToDisplayH(meters, unit) {
  if (meters == null) return '';
  return unit === 'mi' ? (meters / MI_TO_M_H).toFixed(2) : (meters / 1000).toFixed(2);
}

function HistoryScreen({ store, setStore, go, userId, initialTab }) {
  const [tab, setTab] = useStateL(initialTab || 'workouts');
  const [planFilter, setPlanFilter] = useStateL(null);
  const [periodFilter, setPeriodFilter] = useStateL(null);
  const [dayFilter, setDayFilter] = useStateL(null);
  const [confirmEl, confirm] = useConfirm();
  const [cardioLogOpen, setCardioLogOpen] = useStateL(false);
  const [editingCardioLog, setEditingCardioLog] = useStateL(null);
  const [cardioTypeDetail, setCardioTypeDetail] = useStateL(null);
  const [effortChart, setEffortChart] = useStateL(null);

  const sessions = useMemoL(() => {
    return [...store.sessions]
      .filter(s => s.ended)
      .sort((a,b) => (b.ended||'').localeCompare(a.ended||''));
  }, [store.sessions]);

  // Plans that appear in sessions
  const planOptions = useMemoL(() => {
    const seen = new Map();
    sessions.forEach(s => {
      if (s.scheduleId && !seen.has(s.scheduleId)) {
        const sch = store.schedules.find(x => x.id === s.scheduleId);
        seen.set(s.scheduleId, sch?.name || '?');
      }
    });
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [sessions, store.schedules]);

  // Compute "Cycle N" / "Week N" label for each session
  const sessionPeriods = useMemoL(() => {
    const map = new Map();
    const bySchedule = {};
    sessions.forEach(s => { if (s.scheduleId) (bySchedule[s.scheduleId] = bySchedule[s.scheduleId] || []).push(s); });
    Object.entries(bySchedule).forEach(([schedId, schSessions]) => {
      const sch = store.schedules.find(x => x.id === schedId);
      if (!sch) return;
      const isWd = LB.isWeekdayPlan(sch);
      let startStr = schedId === store.activeScheduleId
        ? (isWd ? store.weekPlanStartDate : store.cycleStartDate)
        : null;
      if (!startStr)
        startStr = schSessions.reduce((min, s) => s.date < min ? s.date : min, schSessions[0].date);
      const startD = new Date(startStr.slice(0, 10) + 'T12:00:00');
      schSessions.forEach(s => {
        const sDate = new Date(s.date.slice(0, 10) + 'T12:00:00');
        if (isWd) {
          const startWd = LB.isoWd(startD);
          const startMon = new Date(startD); startMon.setDate(startD.getDate() - startWd); startMon.setHours(0,0,0,0);
          const weekNum = Math.floor((sDate - startMon) / (7 * 86400000)) + 1;
          if (weekNum > 0) map.set(s.id, `Week ${weekNum}`);
        } else {
          const cycleLen = sch.days.length || 1;
          const daysDiff = Math.round((sDate - startD) / 86400000);
          if (daysDiff >= 0) map.set(s.id, `Cycle ${Math.floor(daysDiff / cycleLen) + 1}`);
        }
      });
    });
    return map;
  }, [sessions, store.schedules, store.activeScheduleId, store.cycleStartDate, store.weekPlanStartDate]);

  // Period options depend on planFilter
  const periodOptions = useMemoL(() => {
    const base = planFilter ? sessions.filter(s => s.scheduleId === planFilter) : sessions;
    const seen = new Set();
    base.forEach(s => { const p = sessionPeriods.get(s.id); if (p) seen.add(p); });
    return [...seen].sort((a, b) => parseInt(a.split(' ')[1]) - parseInt(b.split(' ')[1]));
  }, [sessions, planFilter, sessionPeriods]);

  // Day options depend on planFilter + periodFilter
  const dayOptions = useMemoL(() => {
    let base = sessions;
    if (planFilter) base = base.filter(s => s.scheduleId === planFilter);
    if (periodFilter) base = base.filter(s => sessionPeriods.get(s.id) === periodFilter);
    const counts = {};
    base.forEach(s => { if (s.dayName && s.dayName !== 'REST') counts[s.dayName] = (counts[s.dayName] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [sessions, planFilter, periodFilter, sessionPeriods]);

  const dayEffortCounts = useMemoL(() => {
    const counts = {};
    sessions.forEach(s => {
      if (s.feel) { const k = s.dayId || s.dayName; counts[k] = (counts[k] || 0) + 1; }
    });
    return counts;
  }, [sessions]);

  const daySessionCounts = useMemoL(() => {
    const counts = {};
    sessions.forEach(s => {
      if (s.ended) { const k = s.dayId || s.dayName; counts[k] = (counts[k] || 0) + 1; }
    });
    return counts;
  }, [sessions]);

  const filteredSessions = useMemoL(() => {
    let s = sessions;
    if (planFilter) s = s.filter(x => x.scheduleId === planFilter);
    if (periodFilter) s = s.filter(x => sessionPeriods.get(x.id) === periodFilter);
    if (dayFilter) s = s.filter(x => x.dayName === dayFilter);
    return s;
  }, [sessions, planFilter, periodFilter, dayFilter, sessionPeriods]);

  const [filtersOpen, setFiltersOpen] = useStateL(false);
  const filterCount = [planFilter, periodFilter, dayFilter].filter(Boolean).length;

  return (
    <Screen scroll={false}>
      <TopBar title="History" right={tab === 'workouts' && planOptions.length > 0 ? (
        <button onClick={() => setFiltersOpen(true)} style={{
          background: filterCount > 0 ? UI.goldFaint : 'transparent',
          border: `1px solid ${filterCount > 0 ? UI.goldSoft : UI.hairStrong}`,
          borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
          color: filterCount > 0 ? UI.gold : UI.inkSoft,
          fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 5, WebkitTapHighlightColor: 'transparent',
        }}>
          Filter{filterCount > 0 && <span style={{ background: UI.gold, color: '#0a0805', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700 }}>{filterCount}</span>}
        </button>
      ) : null} />
      <SubTabBar
        tabs={[{ id: 'workouts', label: 'Workouts', icon: 'fa-dumbbell' }, { id: 'cardio', label: 'Cardio', icon: 'fa-person-running' }, { id: 'stats', label: 'Stats', icon: 'fa-chart-simple' }]}
        active={tab} onChange={setTab} style={{ paddingBottom: 8 }} />

      {tab === 'workouts' && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 22px 22px', display: 'flex', flexDirection: 'column' }}>
          {filteredSessions.length === 0 && (
            <Empty title="No sessions" sub={planFilter || periodFilter || dayFilter ? 'No sessions match the selected filters.' : 'Log your first workout to see your history.'} icon={ICON_HISTORY} />
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
            filteredSessions.forEach(s => {
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
              const vol = LB.totalVolume(s, store.exercises);
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
                    {(() => {
                      const ek = s.dayId || s.dayName;
                      const hasEffort = (dayEffortCounts[ek] || 0) >= 3;
                      const hasVolume = (daySessionCounts[ek] || 0) >= 3;
                      const hasCharts = hasEffort || hasVolume;
                      return (
                        <div
                          className="display"
                          style={{ fontSize: 21, color: UI.ink, lineHeight: 1.1, marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          onClick={hasCharts ? e => { e.stopPropagation(); setEffortChart({ dayId: s.dayId, dayName: s.dayName }); } : undefined}
                        >
                          {s.dayName}
                          {s.isBonus && <span style={{ fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: UI.gold, background: 'rgba(var(--accent-rgb), 0.12)', border: `0.5px solid rgba(var(--accent-rgb), 0.3)`, borderRadius: 4, padding: '3px 6px' }}>BONUS</span>}
                          {s.isDeload && <span style={{ fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: UI.inkSoft, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '3px 6px' }}>DELOAD</span>}
                          {hasCharts && <i className="fa-solid fa-chart-line" style={{ fontSize: 10, color: UI.gold }} />}
                        </div>
                      );
                    })()}
                    <div className="micro" style={{ color: UI.inkFaint }}>
                      {s.entries.length || s.aggExercises || 0} Exercises · {setsLogged} Sets
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div className="num" style={{ fontSize: 21, color: UI.gold, lineHeight: 1 }}>
                        {Math.round(vol).toLocaleString('en-US')}
                      </div>
                      {s.feel && <div style={{ width: 7, height: 7, borderRadius: '50%', background: feelColor(s.feel), flexShrink: 0 }} />}
                    </div>
                    <div className="micro" style={{ color: UI.inkFaint, marginTop: 3 }}>{UI.unit()}</div>
                  </div>
                </div>
                </React.Fragment>
              );
            });
          })()}
          </div>
        </div>
      )}

      {tab === 'cardio' && (() => {
        const logs = [...(store.cardioLogs || [])].sort((a, b) => b.date.localeCompare(a.date));
        const du = (() => { try { return localStorage.getItem(CARDIO_DIST_KEY_H) || 'km'; } catch (_) { return 'km'; } })();
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
        const paceLbl = ['', 'Easy', 'Light', 'Steady', 'Solid', 'Hard', 'Max'];
        return (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 22px 22px' }}>
              {logs.length === 0 && (
                <Empty title="No cardio logged" sub="Tap the button above to log your first cardio session." icon={<i className="fa-solid fa-person-running" style={{ fontSize: 28, color: UI.inkFaint }} />} />
              )}
              {(() => {
                const items = [];
                let lastGroup = null;
                logs.forEach(l => {
                  const group = getGroup(l.date);
                  if (group !== lastGroup) { items.push({ type: 'header', label: group, key: `h-${group}`, isFirst: items.length === 0 }); lastGroup = group; }
                  items.push({ type: 'log', log: l, key: l.id });
                });
                return items.map(item => {
                  if (item.type === 'header') {
                    return <div key={item.key} className="micro" style={{ marginTop: item.isFirst ? 6 : 24, marginBottom: 10, borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8 }}>{item.label}</div>;
                  }
                  const l = item.log;
                  return (
                    <React.Fragment key={l.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', borderBottom: `0.5px solid ${UI.hair}` }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>
                            {LB.parseDate(l.date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                            {l.type
                              ? <button onClick={() => setCardioTypeDetail(l.type)} style={{ fontFamily: UI.fontDisplay, fontSize: 16, color: UI.ink, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationColor: UI.hairStrong, textUnderlineOffset: 3 }}>{l.type}</button>
                              : <span style={{ fontFamily: UI.fontDisplay, fontSize: 16, color: UI.ink, lineHeight: 1 }}>—</span>
                            }
                            <span className="num" style={{ fontSize: 13, color: UI.gold }}>{l.durationMinutes}<span style={{ fontSize: 10, color: UI.inkFaint }}>min</span></span>
                            {l.distanceM != null && <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{mToDisplayH(l.distanceM, du)}<span style={{ fontSize: 9 }}>{du}</span></span>}
                          </div>
                          {(l.paceFeeling != null || l.effort != null || l.note) && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              {l.paceFeeling != null && <span className="micro" style={{ color: UI.inkFaint }}>PACE : {paceLbl[l.paceFeeling] || l.paceFeeling}</span>}
                              {l.paceFeeling != null && l.effort != null && <span style={{ fontSize: 14, color: UI.gold, lineHeight: 1 }}>·</span>}
                              {l.effort != null && <span className="micro" style={{ color: UI.inkFaint }}>EFFORT : <span style={{ color: UI.gold }}>{l.effort}/10</span></span>}
                              {l.note && <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, fontStyle: 'italic' }}>{l.note}</span>}
                            </div>
                          )}
                        </div>
                        <button onClick={() => { setEditingCardioLog(l); setCardioLogOpen(true); }} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: UI.inkFaint }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button onClick={async () => {
                          if (!await confirm('Delete this cardio log?', { ok: 'Delete', danger: true })) return;
                          setStore(s => ({ ...s, cardioLogs: (s.cardioLogs||[]).filter(x => x.id !== l.id) }));
                        }} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', color: UI.danger, fontSize: 20, lineHeight: 1, fontFamily: UI.fontUi }}>×</button>
                      </div>
                    </React.Fragment>
                  );
                });
              })()}
            </div>
            {window.Screens.CardioQuickLogSheet && (
              <window.Screens.CardioQuickLogSheet
                open={cardioLogOpen}
                onClose={() => { setCardioLogOpen(false); setEditingCardioLog(null); }}
                store={store} setStore={setStore} userId={userId}
                editLog={editingCardioLog}
              />
            )}
            <CardioTypeDetailSheet
              type={cardioTypeDetail}
              logs={store.cardioLogs || []}
              open={!!cardioTypeDetail}
              onClose={() => setCardioTypeDetail(null)}
            />
          </div>
        );
      })()}

      {tab === 'stats' && <StatsTab store={store} sessions={sessions} go={go} />}

      {filtersOpen && (() => {
        const selSt = (active) => ({
          width: '100%', appearance: 'none', WebkitAppearance: 'none',
          background: active ? 'rgba(var(--accent-rgb),0.08)' : 'transparent',
          border: `1px solid ${active ? UI.gold : UI.hairStrong}`,
          borderRadius: 4, color: active ? UI.gold : UI.ink,
          fontFamily: UI.fontUi, fontSize: 13, padding: '10px 36px 10px 12px',
          cursor: 'pointer', outline: 'none', colorScheme: 'dark',
        });
        const selWrap = { position: 'relative' };
        const selChevron = { position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 10, color: UI.inkFaint };
        return (
          <Sheet open={true} onClose={() => setFiltersOpen(false)} title="Filter">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <div style={{ borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8, marginBottom: 10 }}>
                  <span className="micro" style={{ color: UI.gold }}>PLAN</span>
                </div>
                <div style={selWrap}>
                  <select value={planFilter || ''} style={selSt(!!planFilter)}
                    onChange={e => { const v = e.target.value || null; setPlanFilter(v); setPeriodFilter(null); setDayFilter(null); }}>
                    <option value="">All plans</option>
                    {planOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <i className="fa-solid fa-chevron-down" style={selChevron} />
                </div>
              </div>

              {periodOptions.length > 0 && (
                <div>
                  <div style={{ borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8, marginBottom: 10 }}>
                    <span className="micro" style={{ color: UI.gold }}>CYCLE / WEEK</span>
                  </div>
                  <div style={selWrap}>
                    <select value={periodFilter || ''} style={selSt(!!periodFilter)}
                      onChange={e => { const v = e.target.value || null; setPeriodFilter(v); setDayFilter(null); }}>
                      <option value="">All cycles / weeks</option>
                      {periodOptions.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <i className="fa-solid fa-chevron-down" style={selChevron} />
                  </div>
                </div>
              )}

              {dayOptions.length > 1 && (
                <div>
                  <div style={{ borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8, marginBottom: 10 }}>
                    <span className="micro" style={{ color: UI.gold }}>DAY</span>
                  </div>
                  <div style={selWrap}>
                    <select value={dayFilter || ''} style={selSt(!!dayFilter)}
                      onChange={e => setDayFilter(e.target.value || null)}>
                      <option value="">All days</option>
                      {dayOptions.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <i className="fa-solid fa-chevron-down" style={selChevron} />
                  </div>
                </div>
              )}

              {filterCount > 0 && (
                <button onClick={() => { setPlanFilter(null); setPeriodFilter(null); setDayFilter(null); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.danger, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', alignSelf: 'flex-start' }}>
                  Clear all
                </button>
              )}
              <Btn onClick={() => setFiltersOpen(false)} disabled={filteredSessions.length === 0} style={{ opacity: filteredSessions.length === 0 ? 0.4 : 1 }}>
                {filteredSessions.length === 0 ? 'No results' : `Show ${filteredSessions.length} workout${filteredSessions.length === 1 ? '' : 's'}`}
              </Btn>
            </div>
          </Sheet>
        );
      })()}
      {confirmEl}
      {effortChart && <WorkoutEffortSheet dayId={effortChart.dayId} dayName={effortChart.dayName} sessions={sessions} onClose={() => setEffortChart(null)} />}
    </Screen>
  );
}

// ─── FEEL ────────────────────────────────────────────────────────────
const FEEL_LEVELS = [
  { key: 'easy',      label: 'EASY',      color: '#38bdf8' },
  { key: 'good',      label: 'GOOD',      color: '#4ade80' },
  { key: 'hard',      label: 'HARD',      color: '#facc15' },
  { key: 'very_hard', label: 'VERY HARD', color: '#f97316' },
  { key: 'max',       label: 'MAX',       color: '#ef4444' },
];

function feelColor(key) {
  return FEEL_LEVELS.find(f => f.key === key)?.color ?? UI.inkFaint;
}
function feelLabel(key) {
  return FEEL_LEVELS.find(f => f.key === key)?.label ?? null;
}

function FeelSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {FEEL_LEVELS.map(f => {
        const active = value === f.key;
        return (
          <button key={f.key} onClick={() => onChange(active ? null : f.key)}
            style={{
              flex: 1, padding: '7px 2px', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${active ? f.color : UI.hairStrong}`,
              background: active ? `${f.color}22` : 'transparent',
              color: active ? f.color : UI.inkSoft,
              fontFamily: UI.fontUi, fontSize: 9, fontWeight: active ? 600 : 400,
              letterSpacing: '0.07em', WebkitTapHighlightColor: 'transparent',
            }}>
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── SET COMPARISON HELPERS ──────────────────────────────────────────
// Shared by SessionDetailScreen, ComparisonScreen, and the LAST TIME card.
// Canonical logic lives in store.js (window.LB) — one definition, no drift.
const isImprovement = LB.isImprovement;
const isDecline = LB.isDecline;

// ─── SESSION DETAIL ──────────────────────────────────────────────────
function SessionDetailScreen({ store, setStore, go, sessionId, justFinished, back, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [editing, setEditing] = useStateL(false);
  const [capturing, setCapturing] = useStateL(false);
  const [feelOpen, setFeelOpen] = useStateL(false);
  const [tplFormOpen, setTplFormOpen] = useStateL(false);
  const [tplName, setTplName] = useStateL('');
  const [tplSaved, setTplSaved] = useStateL(false);
  const captureRef = useRefL(null);
  // Screenshot watermark: VIPs get their home-screen background image instead of the default ZANE mark.
  const _shotLogo = store.settings?.vipBackground || 'icons/zane-logo-2.png';
  const _shotIsCustom = _shotLogo !== 'icons/zane-logo-2.png';
  const s = store.sessions.find(x => x.id === sessionId);
  useEffectL(() => { if (!s) go({ name: 'hist' }); }, [!!s]);
  // Sessions outside the boot window carry no entries — lazy-load them into
  // the store on first open (also makes editing work; aggExercises > 0 tells
  // a windowed-out session apart from a genuinely empty one).
  const needsEntries = !!(s && s.ended && !(s.entries || []).length && (s.aggExercises || 0) > 0);
  useEffectL(() => {
    if (!needsEntries) return;
    let on = true;
    LB.fetchSessionEntries([sessionId])
      .then(bySession => {
        const entries = bySession[sessionId];
        if (!on || !entries?.length) return;
        setStore(st => ({
          ...st,
          sessions: st.sessions.map(x => x.id === sessionId && !(x.entries || []).length ? { ...x, entries } : x),
        }));
      })
      .catch(() => {});
    return () => { on = false; };
  }, [needsEntries, sessionId]);
  if (!s) return null;
  const vol = LB.totalVolume(s, store.exercises);
  const duration = s.durationMinutes != null
    ? s.durationMinutes
    : (s.ended && (s.startedAt ?? s.date) ? Math.round((new Date(s.ended) - new Date(s.startedAt ?? s.date)) / 60000) : null);

  const setFeel = (feel) => {
    setStore(st => ({ ...st, sessions: st.sessions.map(x => x.id === sessionId ? { ...x, feel } : x) }));
  };

  const saveAsTemplate = () => {
    const name = tplName.trim();
    if (!name) return;
    const exercises = (s.entries || []).map(e => ({
      exId: e.exId, name: e.name,
      sets: e.plannedSets || (e.sets || []).filter(st => !st.warmup).length || 3,
      reps: e.plannedReps ?? null,
      repsPerSet: e.plannedRepsPerSet ?? null,
      supersetGroup: e.supersetGroup ?? null,
    }));
    const tpl = { id: LB.uid(), name, exercises, createdAt: new Date().toISOString() };
    setStore(st => ({ ...st, workoutTemplates: [tpl, ...(st.workoutTemplates || [])] }));
    setTplFormOpen(false);
    setTplSaved(true);
  };

  const deleteSession = async () => {
    if (!await confirm('This session will be permanently deleted.', { title: 'Delete session?', ok: 'Delete', danger: true })) return;
    setStore(s => ({
      ...s,
      sessions: s.sessions.filter(x => x.id !== sessionId),
      cardioLogs: (s.cardioLogs || []).filter(l => l.sessionId !== sessionId),
    }));
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
    if (!captureRef.current) return;
    // html2canvas is loaded on demand (not at boot) — fetch it on first use.
    const html2canvas = await window.__ensureHtml2Canvas?.().catch(() => null);
    if (!html2canvas) return;
    setCapturing(true);
    // Temporarily expand scroll parent so html2canvas captures full content
    const scrollParent = captureRef.current.parentElement;
    const saved = { overflow: scrollParent.style.overflow, height: scrollParent.style.height, minHeight: scrollParent.style.minHeight };
    scrollParent.style.overflow = 'visible';
    scrollParent.style.height = 'auto';
    scrollParent.style.minHeight = 'auto';
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Draw knurl dividers imperatively — canvas elements placed by KnurlCanvas
    // are guaranteed to be in the DOM now (React re-render completed within 2 RAFs).
    // Shorten any knurl divider that overlaps the avatar (bottom-right) so the
    // line stops just before it. Measured live, so it's correct for any avatar /
    // background aspect ratio — not just the last divider.
    const avatarEl = captureRef.current.querySelector('img[data-shot-avatar]');
    // The avatar is a freshly-mounted <img>; on first capture it may not have
    // decoded within the 2 RAFs above, so its box would measure 0 and no line
    // would be trimmed. Wait for it to load before measuring.
    if (avatarEl && !avatarEl.complete) {
      await new Promise(res => {
        avatarEl.addEventListener('load', res, { once: true });
        avatarEl.addEventListener('error', res, { once: true });
      });
      await new Promise(r => requestAnimationFrame(r));
    }
    const avatarRect = (avatarEl && avatarEl.getBoundingClientRect().height) ? avatarEl.getBoundingClientRect() : null;
    const KNURL_GAP = 14;
    // Limit chip containers that vertically overlap the avatar so they don't
    // bleed into it. Same gap as knurl lines.
    if (avatarRect) {
      captureRef.current.querySelectorAll('[data-shot-chips]').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.bottom > avatarRect.top && r.top < avatarRect.bottom) {
          const maxW = Math.round(avatarRect.left - r.left - KNURL_GAP);
          if (maxW > 0 && maxW < r.width) el.style.maxWidth = maxW + 'px';
        }
      });
    }
    captureRef.current.querySelectorAll('canvas[data-knurl]').forEach(c => {
      const pw = c.parentElement ? c.parentElement.offsetWidth : 320;
      let w = pw;
      if (avatarRect) {
        const r = c.getBoundingClientRect();
        // Vertical overlap with the avatar band → trim to just left of it.
        if (r.bottom > avatarRect.top && r.top < avatarRect.bottom) {
          w = Math.min(w, Math.round(pw - (r.right - avatarRect.left) - KNURL_GAP));
        }
      }
      if (w <= 0) return;
      if (w < pw) c.style.width = w + 'px';
      c.width = w; c.height = 3;
      const ctx = c.getContext('2d');
      const knurlRgb = getComputedStyle(document.documentElement).getPropertyValue('--knurl-rgb').trim() || '236,228,208';
      ctx.strokeStyle = `rgba(${knurlRgb},0.20)`;
      ctx.lineWidth = 1.5;
      for (let x = -2; x < w + 6; x += 5.2) {
        ctx.beginPath(); ctx.moveTo(x, 3); ctx.lineTo(x + 1.73, 0); ctx.stroke();
      }
    });
    try {
      const el = captureRef.current;
      const canvas = await html2canvas(el, {
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
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, lineHeight: 1 }}>
            {s.dayName}
            {s.isBonus && <span style={{ fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: UI.gold, background: 'rgba(var(--accent-rgb), 0.12)', border: `0.5px solid rgba(var(--accent-rgb), 0.3)`, borderRadius: 4, padding: '3px 6px', textTransform: 'uppercase' }}>BONUS</span>}
            {s.isDeload && <span style={{ fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: UI.inkSoft, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '3px 6px', textTransform: 'uppercase' }}>DELOAD</span>}
          </span>
        }
        onBack={() => go(justFinished ? { name: 'home' } : (back || { name: 'hist' }))}
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={takeScreenshot} disabled={capturing} style={{
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              borderRadius: 4, padding: '5px 10px', cursor: capturing ? 'default' : 'pointer',
              color: capturing ? UI.inkGhost : UI.inkSoft, lineHeight: 1,
              WebkitTapHighlightColor: 'transparent',
            }}>
              {capturing ? <span style={{ fontFamily: UI.fontUi, fontSize: 10 }}>…</span> : <i className="fa-solid fa-camera" style={{ fontSize: 11 }} />}
            </button>
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
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <div className="display" style={{ fontSize: 26 }}>{s.dayName}</div>
                  {s.isBonus && <span style={{ fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: UI.gold, background: 'rgba(var(--accent-rgb), 0.12)', border: `0.5px solid rgba(var(--accent-rgb), 0.3)`, borderRadius: 4, padding: '3px 6px' }}>BONUS</span>}
                  {s.isDeload && <span style={{ fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: UI.inkSoft, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '3px 6px' }}>DELOAD</span>}
                </div>
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

        {/* Save as template — freestyle sessions only, right after finishing */}
        {justFinished && !capturing && s.isFreestyle && (s.entries || []).length > 0 && (
          tplSaved ? (
            <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 0', color: UI.gold, fontFamily: UI.fontUi, fontSize: 12, letterSpacing: '0.08em' }}>
              <i className="fa-solid fa-check" /> Saved as template
            </div>
          ) : tplFormOpen ? (
            <div style={{ marginBottom: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Template name">
                <TextInput value={tplName} onChange={setTplName} placeholder="e.g. Push A" autoFocus />
              </Field>
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn kind="ghost" onClick={() => setTplFormOpen(false)} style={{ flex: 1 }}>Cancel</Btn>
                <Btn onClick={saveAsTemplate} style={{ flex: 1 }}>Save template</Btn>
              </div>
            </div>
          ) : (
            <Btn kind="ghost" onClick={() => { setTplName(s.dayName && s.dayName !== 'Freestyle' ? s.dayName : ''); setTplFormOpen(true); }} style={{ width: '100%', marginBottom: 4 }}>
              <i className="fa-solid fa-bookmark" style={{ marginRight: 8 }} /> Save as template
            </Btn>
          )
        )}

        {/* Feel — prompt after finish, always editable */}
        {!capturing && (
          <div style={{ marginBottom: 4 }}>
            {justFinished && !s.feel && (
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8, letterSpacing: '0.12em' }}>RATE WORKOUT EFFORT</div>
            )}
            {!justFinished && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: s.feel && !feelOpen ? 0 : 8 }}>
                <span className="micro" style={{ color: UI.inkFaint, letterSpacing: '0.12em' }}>FEEL</span>
                {s.feel && !feelOpen && (
                  <button onClick={() => setFeelOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: feelColor(s.feel) }}>
                    {feelLabel(s.feel)} <span style={{ color: UI.inkFaint, fontWeight: 400 }}>· EDIT</span>
                  </button>
                )}
              </div>
            )}
            {(justFinished || feelOpen || !s.feel) && (
              <FeelSelector value={s.feel} onChange={(v) => { setFeel(v); setFeelOpen(false); }} />
            )}
          </div>
        )}

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
        {volDelta != null && !s.isDeload && (
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
          {capturing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px' }}>
              <SvgKnurl style={{ flex: 1 }} />
              <span style={{ fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.20em', color: UI.inkFaint, textTransform: 'uppercase', fontWeight: 700, whiteSpace: 'nowrap' }}>EXERCISES</span>
              <SvgKnurl style={{ flex: 1 }} />
            </div>
          ) : (
            <Bezel>EXERCISES</Bezel>
          )}
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
                const exObj = store.exercises.find(ex => ex.id === e.exId);
                const exName = exObj?.name ?? e.name;

                // Cardio entry — show activity summary instead of sets
                // isCardio may be missing on entries loaded from DB (not a DB column),
                // so derive it from the exercise's movement_type as fallback.
                const isEntryCardio = !!e.isCardio || exObj?.movement_type === 'cardio';
                if (isEntryCardio) {
                  // cardioData is in-memory only; for historical sessions look up
                  // from store.cardioLogs by session date + exercise name.
                  let cd = e.cardioData;
                  if (!cd) {
                    const sessionDate = s.date?.slice(0, 10);
                    const logs = sessionDate ? (store.cardioLogs || []).filter(cl => cl.date === sessionDate) : [];
                    const exNameLower = (exObj?.name || e.name || '').toLowerCase();
                    const match = logs.find(cl => cl.type?.toLowerCase() === exNameLower) || logs[0] || null;
                    if (match) cd = { type: match.type, durationMinutes: match.durationMinutes, distanceM: match.distanceM ?? null };
                  }
                  const du = localStorage.getItem('logbook-cardio-dist-unit') || 'km';
                  const parts = [];
                  if (cd?.type) parts.push(cd.type.charAt(0).toUpperCase() + cd.type.slice(1));
                  if (cd?.durationMinutes) parts.push(`${cd.durationMinutes} min`);
                  if (cd?.distanceM != null) parts.push(du === 'mi' ? `${(cd.distanceM / 1609.344).toFixed(2)} mi` : `${(cd.distanceM / 1000).toFixed(1)} km`);
                  const done = e.cardioDone ?? !!cd;
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                        <div className="display" style={{ fontSize: 17, color: UI.ink, lineHeight: 1.1 }}>{exName}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {done ? (
                          <span style={{ border: `1px solid ${UI.hairStrong}`, borderRadius: 4, padding: '3px 10px', fontFamily: UI.fontUi, fontSize: 12, color: UI.inkSoft, letterSpacing: '0.03em' }}>
                            {parts.length > 0 ? parts.join(' · ') : '✓'}
                          </span>
                        ) : (
                          <span style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.inkFaint }}>—</span>
                        )}
                      </div>
                    </div>
                  );
                }

                const isCheckboxOnly = !!exObj?.no_weight_reps;
                const filteredSets = e.sets.filter(st => !st.skipped && (showWarmup || !st.warmup));
                // Compare working sets by position, warm-ups excluded on both sides.
                const prevWorking = (prev?.sets || []).filter(st => !st.warmup);
                const prevWorkingFor = (j) => {
                  if (filteredSets[j]?.warmup) return undefined;
                  const wIdx = filteredSets.slice(0, j + 1).filter(st => !st.warmup).length - 1;
                  return wIdx >= 0 ? prevWorking[wIdx] : undefined;
                };
                const canHistory = !!s.dayId;
                return (
                <div key={i}
                  onClick={() => canHistory && go({ name: 'exerciseHistory', exId: e.exId, dayId: s.dayId, exName, back: { name: 'session', sessionId: s.id } })}
                  style={{ cursor: canHistory ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <div className="display" style={{ fontSize: 17, color: UI.ink, lineHeight: 1.1 }}>
                      {exName}{canHistory && <span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 5 }}>›</span>}
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

                      // Drop set: DS badge + chips connected by arrows
                      if (st.technique === 'drop' && !isCheckboxOnly) {
                        const drops = (st.drops && st.drops.length > 0) ? st.drops : (st.kg != null ? [{ kg: st.kg, reps: st.reps }] : []);
                        const chipColor = highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.ink;
                        const chipBorder = highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hairStrong;
                        const chipBg = highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'transparent';
                        return (
                          <div key={j} style={{
                            width: '100%', marginTop: j > 0 ? 6 : 0,
                            borderLeft: `2px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.4)' : 'rgba(var(--accent-rgb),0.35)'}`,
                            paddingLeft: 10,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <span style={{
                                fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em',
                                color: highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.inkFaint,
                                background: highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'rgba(var(--accent-rgb),0.08)',
                                border: `0.5px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : 'rgba(var(--accent-rgb),0.25)'}`,
                                borderRadius: 4, padding: '2px 6px',
                              }}>DROP SET</span>
                              {pr && <i className="fa-solid fa-dumbbell" style={{ fontSize: 9, color: UI.gold }} />}
                            </div>
                            <div data-shot-chips="1" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, overflow: 'hidden' }}>
                              {drops.map((d, di) => (
                                <React.Fragment key={di}>
                                  {di > 0 && (
                                    <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi }}>→</span>
                                  )}
                                  <span style={{
                                    background: chipBg,
                                    border: `1px solid ${chipBorder}`,
                                    borderRadius: 4, padding: '3px 8px',
                                    fontFamily: UI.fontNum, fontSize: 12,
                                    color: chipColor,
                                    opacity: di === 0 ? 1 : 0.75,
                                  }}>
                                    {d.kg ?? '—'}<span style={{ color: highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, fontSize: 10 }}>{UI.unit()}</span>
                                    <span style={{ color: highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, margin: '0 1px' }}>×</span>
                                    {d.reps ?? '—'}
                                  </span>
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                        );
                      }

                      // Myo-rep / myo-rep match: badge + activation chip + mini chips
                      if ((st.technique === 'myorep' || st.technique === 'myorep_match') && !isCheckboxOnly) {
                        const drops = (st.drops && st.drops.length > 0) ? st.drops : (st.kg != null ? [{ kg: st.kg, reps: st.reps }] : []);
                        const chipColor = highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.ink;
                        const chipBorder = highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hairStrong;
                        const chipBg = highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'transparent';
                        const isMatch = st.technique === 'myorep_match';
                        return (
                          <div key={j} style={{
                            width: '100%', marginTop: j > 0 ? 6 : 0,
                            borderLeft: `2px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.4)' : 'rgba(var(--accent-rgb),0.35)'}`,
                            paddingLeft: 10,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <span style={{
                                fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em',
                                color: highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.inkFaint,
                                background: highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'rgba(var(--accent-rgb),0.08)',
                                border: `0.5px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : 'rgba(var(--accent-rgb),0.25)'}`,
                                borderRadius: 4, padding: '2px 6px',
                              }}>{isMatch ? 'MYO MATCH' : 'MYO-REPS'}</span>
                              {pr && <i className="fa-solid fa-dumbbell" style={{ fontSize: 9, color: UI.gold }} />}
                            </div>
                            <div data-shot-chips="1" style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
                              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                                {drops.map((d, di) => (
                                  <React.Fragment key={di}>
                                    {di > 0 && (
                                      <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi }}>↺</span>
                                    )}
                                    <span style={{
                                      background: di === 0 ? chipBg : 'transparent',
                                      border: `1px solid ${di === 0 ? chipBorder : UI.hair}`,
                                      borderRadius: 4, padding: '3px 8px',
                                      fontFamily: UI.fontNum, fontSize: 12,
                                      color: di === 0 ? chipColor : UI.inkSoft,
                                      opacity: di === 0 ? 1 : 0.7,
                                    }}>
                                      {di === 0 && <>{d.kg ?? '—'}<span style={{ color: highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, fontSize: 10 }}>{UI.unit()}</span><span style={{ color: highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, margin: '0 1px' }}>×</span></>}
                                      {d.reps ?? '—'}
                                    </span>
                                  </React.Fragment>
                                ))}
                              </div>
                              {(() => { const t = drops.reduce((a, d) => a + (d.reps || 0), 0); return t > 0 ? (
                                <div style={{ border: `1px solid var(--accent)`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.03em', textAlign: 'center' }}>
                                  Total {t}
                                </div>
                              ) : null; })()}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <span key={j} style={{
                          opacity: (st.done || hasData) ? (isWarm ? 0.65 : 1) : 0.45,
                          background: highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'transparent',
                          border: `1px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hairStrong}`,
                          borderRadius: 4, padding: '3px 8px',
                          fontFamily: UI.fontNum, fontSize: 12,
                          color: isWarm ? UI.inkFaint : highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.ink,
                        }}>
                          {isCheckboxOnly ? (st.done ? '✓' : '○') : (<>
                            {isWarm && <span style={{ fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.1em', color: UI.inkFaint, marginRight: 4 }}>W</span>}
                            {st.kg ?? '—'}<span style={{ color: isWarm ? UI.inkGhost : highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, fontSize: 10 }}>{UI.unit()}</span><span style={{ color: isWarm ? UI.inkGhost : highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, margin: '0 1px' }}>×</span>{(st.repsL != null || st.repsR != null) ? `L${st.repsL ?? '?'}/R${st.repsR ?? '?'}` : (st.reps ?? '—')}{pr && <i className="fa-solid fa-dumbbell" style={{ fontSize: 8, color: UI.gold, marginLeft: 4 }} />}
                          </>)}
                        </span>
                      );
                    })}
                    {(() => { const n = e.sets.filter(st => st.skipped).length; return n > 0 && (
                      <span style={{ border: `1px solid ${UI.hair}`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, letterSpacing: '0.05em' }}>
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
                  {gi < groups.length - 1 && (capturing ? <KnurlCanvas style={{ marginTop: 14 }} /> : <Hairline style={{ marginTop: 14 }} />)}
                </div>
              ));
            })()}
          </div>
          {capturing && (
            <img src={_shotLogo} data-shot-avatar="1" style={{ position: 'absolute', bottom: 2, right: 0, width: 90, opacity: 0.5, zIndex: 1, transform: _shotIsCustom ? 'none' : 'scaleX(-1)' }} />
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
  const [confirmEl, confirm] = useConfirm();
  const origDate = session.date ? session.date.slice(0, 10) : '';
  const origDuration = duration != null ? String(Math.round(duration / 5) * 5) : '0';
  const origEntriesJson = useRefL(() => JSON.stringify(session.entries));
  const isDirty = draftDate !== origDate || draftDuration !== origDuration || JSON.stringify(draftEntries) !== origEntriesJson.current;
  const requestClose = async () => {
    if (isDirty && !await confirm('Your edits won\'t be saved.', { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    onClose();
  };

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
    <Sheet open={true} onClose={requestClose} title="Edit session">
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
          <Btn kind="ghost" onClick={requestClose} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={save} style={{ flex: 2 }}>Save</Btn>
        </div>
      </div>
      {confirmEl}
    </Sheet>
  );
}


function ComparisonScreen({ session, onDismiss, go, userName }) {
  const entries     = session.entries || [];
  const lastEntries = session.last_session_entries || [];
  // Label weights in the trainee's own unit (stored numbers aren't converted),
  // so a coach watching an lbs client never sees their lifts marked "kg".
  const unit        = (session.unit === 'lbs') ? 'lbs' : 'kg';
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
            if (s.skipped && !s.done) return 'skipped';
            const drops = s.drops && s.drops.length > 0 ? s.drops : null;
            if (s.technique === 'drop' && drops) {
              return drops.map(d => `${d.kg ?? '—'}${unit}×${d.reps ?? '—'}`).join(' → ');
            }
            if ((s.technique === 'myorep' || s.technique === 'myorep_match') && drops) {
              const total = drops.reduce((a, d) => a + (d.reps || 0), 0);
              const chain = drops.map((d, di) => di === 0 ? `${d.kg ?? '—'}${unit}×${d.reps ?? '—'}` : (d.reps ?? '—')).join(' ↺ ');
              return `${chain} (${total})`;
            }
            const repsStr = (s.repsL != null || s.repsR != null)
              ? `L${s.repsL ?? '?'}/R${s.repsR ?? '?'}`
              : (s.reps ?? '—');
            return `${s.kg != null ? s.kg + unit : '—'} × ${repsStr}`;
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
                const currSkipped = curr?.skipped && !curr?.done;
                const declined = !anyImprovementBefore && (isDecline(curr, prev) || ((!curr || currSkipped) && prevDone));
                const icon   = !curr ? '−' : !prev ? '+' : currSkipped && prevDone ? '↓' : curr && !currSkipped && prev?.skipped && !prev?.done ? '↑' : improved ? '↑' : declined ? '↓' : '—';
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
                    <span className="num" style={{ fontSize: 14, color: curr && (!curr.skipped || curr.done) ? UI.ink : UI.inkFaint }}>
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
  // Auto-follow the trainee's current exercise. Turned off the moment the
  // spectator taps a different exercise, so the 2s poll stops yanking the view
  // back; tapping the live exercise (or the LIVE badge) re-engages it.
  const [followLive, setFollowLive] = useStateL(true);
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
          // Position is synced separately (see the follow-live effect below) so
          // a poll never overrides the spectator's manual navigation.
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

  // Keep the view on the trainee's current exercise while following live. Runs
  // on each poll (session changes) and when following is re-engaged. Once the
  // spectator navigates away (followLive = false) the position is left alone.
  useEffectL(() => {
    if (sessionId || !session || !followLive) return;
    setExIdx(LB.inferCurrentExIdx(session.entries || []));
  }, [session, followLive, sessionId]);

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
  // Label weights in the trainee's own unit (stored numbers aren't converted).
  const unit = (session.unit === 'lbs') ? 'lbs' : 'kg';
  const liveIdx = LB.inferCurrentExIdx(entries);
  const entry = entries[exIdx];
  const goLive = () => { setFollowLive(true); setExIdx(liveIdx); };

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
        <button onClick={goLive} style={{
          display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
          border: `1px solid ${followLive ? 'transparent' : UI.gold}`,
          background: followLive ? 'transparent' : UI.goldFaint,
          borderRadius: 4, padding: '4px 8px',
          cursor: followLive ? 'default' : 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: UI.gold, animation: followLive ? 'pulseDot 1.4s ease-in-out infinite' : 'none' }} />
          <span className="micro" style={{ color: UI.gold }}>{followLive ? 'LIVE' : 'GO LIVE'}</span>
        </button>
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
          const isLive = i === liveIdx;
          // Tapping the live exercise re-engages following; any other stops it.
          return (
            <button key={i} onClick={() => { setExIdx(i); setFollowLive(i === liveIdx); }} style={{
              flexShrink: 0, padding: '6px 12px', borderRadius: 4,
              border: `${isCurrent ? '1.5px' : '1px'} solid ${isCurrent ? UI.gold : allDone ? UI.goldSoft : UI.hair}`,
              background: isCurrent ? UI.goldFaint : allDone ? 'rgba(var(--accent-rgb),0.06)' : 'transparent',
              color: isCurrent ? UI.gold : allDone ? UI.goldSoft : UI.inkSoft,
              fontFamily: UI.fontUi, fontSize: 12, fontWeight: isCurrent ? 600 : 400,
              letterSpacing: '0.06em', cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}>
              {isLive && !isCurrent && (
                <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: UI.gold, marginRight: 5, verticalAlign: 'middle', animation: 'pulseDot 1.4s ease-in-out infinite' }} />
              )}
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
            {(entry.category || entry.equipment || entry.movementType) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                {entry.category && (
                  <span style={{ fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.inkFaint, background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 4, padding: '2px 7px' }}>{entry.category}</span>
                )}
                {entry.equipment && (
                  <span style={{ fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.inkFaint, background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 4, padding: '2px 7px' }}>{entry.equipment}</span>
                )}
                {entry.movementType && (
                  <span style={{ fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.inkFaint, background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 4, padding: '2px 7px' }}>{entry.movementType}</span>
                )}
              </div>
            )}
          </div>

          <Frame style={{ padding: '0 16px' }}>
            {(entry.sets || []).map((s, i) => {
              const done = s.done || s.skipped;
              const unilateral = s.repsL != null || s.repsR != null;
              const drops = s.drops && s.drops.length > 0 ? s.drops : null;

              // Drop set
              if (s.technique === 'drop' && drops) return (
                <React.Fragment key={i}>
                <div style={{ padding: '12px 0', opacity: done ? 1 : 0.35, transition: 'opacity 0.3s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span className="num" style={{ fontSize: 11, color: done ? UI.gold : UI.inkFaint }}>{i + 1}</span>
                    <span style={{ fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: UI.inkFaint, background: 'rgba(var(--accent-rgb),0.08)', border: `0.5px solid rgba(var(--accent-rgb),0.25)`, borderRadius: 4, padding: '2px 6px' }}>DROP SET</span>
                    <div style={{ marginLeft: 'auto' }}>
                      {done ? <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.8"><path d="M2 6l2.5 2.5L10 3"/></svg>
                             : <div style={{ width: 13, height: 13, borderRadius: '50%', border: `1px solid ${UI.hair}` }} />}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                    {drops.map((d, di) => (
                      <React.Fragment key={di}>
                        {di > 0 && <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi }}>→</span>}
                        <span className="num" style={{ fontSize: 13, color: UI.ink }}>{d.kg ?? '—'}<span style={{ fontSize: 10, color: UI.inkFaint }}>{unit}</span> × {d.reps ?? '—'}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                {i < entry.sets.length - 1 && <div className="knurl" />}
                </React.Fragment>
              );

              // Myo-rep / myo-rep match
              if ((s.technique === 'myorep' || s.technique === 'myorep_match') && drops) {
                const isMatch = s.technique === 'myorep_match';
                const total = drops.reduce((a, d) => a + (d.reps || 0), 0);
                return (
                  <React.Fragment key={i}>
                  <div style={{ padding: '12px 0', opacity: done ? 1 : 0.35, transition: 'opacity 0.3s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span className="num" style={{ fontSize: 11, color: done ? UI.gold : UI.inkFaint }}>{i + 1}</span>
                      <span style={{ fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: UI.inkFaint, background: 'rgba(var(--accent-rgb),0.08)', border: `0.5px solid rgba(var(--accent-rgb),0.25)`, borderRadius: 4, padding: '2px 6px' }}>{isMatch ? 'MYO MATCH' : 'MYO-REPS'}</span>
                      {total > 0 && <span className="num" style={{ fontSize: 10, color: UI.inkFaint }}>{total} total</span>}
                      <div style={{ marginLeft: 'auto' }}>
                        {done ? <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.8"><path d="M2 6l2.5 2.5L10 3"/></svg>
                               : <div style={{ width: 13, height: 13, borderRadius: '50%', border: `1px solid ${UI.hair}` }} />}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                      {drops.map((d, di) => (
                        <React.Fragment key={di}>
                          {di > 0 && <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi }}>↺</span>}
                          <span className="num" style={{ fontSize: 13, color: UI.ink }}>
                            {di === 0 && <>{d.kg ?? '—'}<span style={{ fontSize: 10, color: UI.inkFaint }}>{unit}</span> × </>}{d.reps ?? '—'}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  {i < entry.sets.length - 1 && <div className="knurl" />}
                  </React.Fragment>
                );
              }

              // Normal set
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
                    {s.kg != null && <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em' }}>{unit}</span>}
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
                    const currSkipped = curr?.skipped && !curr?.done;
                    const declined = !anyImprovementBefore && (isDecline(curr, s) || (currSkipped && prevDone));
                    const showIcon = (curr?.done || curr?.skipped) && !!s;
                    const icon     = currSkipped && prevDone ? '↓' : improved ? '↑' : declined ? '↓' : '—';
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
                               {s.kg != null && <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{unit}</span>}</>
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


function ExerciseHistoryScreen({ store, go, exId, dayId, exName, back, userId }) {
  const [metric, setMetric] = useStateL('kg');
  const [showCount, setShowCount] = useStateL(20);

  const ex = store.exercises.find(e => e.id === exId);
  const isUni = !!ex?.unilateral;
  const displayName = exName || ex?.name || '?';

  // Local window renders instantly; the server history extends the chart to
  // the full account age once it arrives (merged by session id).
  const [serverRows, setServerRows] = useStateL(null);
  useEffectL(() => {
    let on = true;
    LB.fetchExerciseHistory(exId, dayId, 500, userId)
      .then(rows => { if (on) setServerRows(rows); })
      .catch(() => {});
    return () => { on = false; };
  }, [exId, dayId]);

  const allSessions = useMemoL(() => {
    const local = store.sessions
      .filter(s => s.ended && s.dayId === dayId)
      .map(s => {
        const entry = s.entries.find(e => e.exId === exId);
        if (!entry) return null;
        const working = entry.sets.filter(st => !st.warmup && !st.skipped);
        if (!working.some(st => st.kg != null || st.reps != null)) return null;
        return { id: s.id, ended: s.ended, sets: working };
      })
      .filter(Boolean);
    const seen = new Set(local.map(s => s.id));
    const remote = (serverRows || [])
      .filter(r => !seen.has(r.sessionId))
      .map(r => {
        const working = (r.sets || []).filter(st => !st.warmup && !st.skipped);
        if (!working.some(st => st.kg != null || st.reps != null)) return null;
        return { id: r.sessionId, ended: r.ended, sets: working };
      })
      .filter(Boolean);
    return [...local, ...remote]
      .sort((a, b) => (Date.parse(a.ended) || 0) - (Date.parse(b.ended) || 0));
  }, [store.sessions, exId, dayId, serverRows]);

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
  const dom = UI.chartDomain(minVal, rawMax);

  const PAD_L = 36, PAD_R = 12, PAD_T = 14, PAD_B = 26;
  const VW = 320, VH = 180;
  const plotW = VW - PAD_L - PAD_R;
  const plotH = VH - PAD_T - PAD_B;
  const n = allSessions.length;
  const xPos = (i) => PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yPos = (v) => PAD_T + plotH - ((v - dom.min) / dom.range) * plotH;

  const gridVals = Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
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

          {/* SVG Chart — maxWidth keeps it from ballooning on iPad */}
          <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ display: 'block', overflow: 'visible', marginBottom: 12, maxWidth: 480 }}>
            <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={VH - PAD_B} stroke={UI.hair} strokeWidth="0.5" />
            <line x1={PAD_L} y1={VH - PAD_B} x2={VW - PAD_R} y2={VH - PAD_B} stroke={UI.hair} strokeWidth="0.5" />
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
                  <div style={{ width: 14, height: 2, borderRadius: 4, background: `rgba(var(--accent-rgb),${setAlphas[si] ?? 0.12})` }} />
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
                      border: `1px solid ${UI.hair}`, borderRadius: 4, padding: '2px 7px',
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
