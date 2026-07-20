/* Library + History + Session detail + Settings */

const { useState: useStateL, useMemo: useMemoL, useRef: useRefL, useEffect: useEffectL } = React;

// Persists library filter state across navigation (survives remounts)
const _lib = { tab: 'recent', q: '', filterTags: [], filterRestCats: [], filterUnilateral: null, filterPlan: null, filterEquipment: [], filtersOpen: false };

// Shown when a user tries to delete the built-in CARDIO exercise (bulk-select
// or the exercise detail). It is auto-seeded per user and re-created if removed,
// so silently refusing just reads as "delete is broken" — which cost us a real
// support ticket. Explain instead.
const CARDIO_SYSTEM_MSG = "System exercises can't be deleted. Cardio is here to stay, always ready to drop into a plan or session.";

// SessionDetailScreen screenshot export: a long session (many exercise blocks)
// renders very tall as a single phone-width column. Above this many blocks,
// the export switches to a wider two-column grid instead (see the `twoCol`
// capture treatment below), roughly halving the image height. `SHOT_TWO_COL_WIDTH`
// is picked so each column's inner content is close to the normal single-column
// content width (accounting for the Frame card padding + column gap), not simply
// double the phone viewport, so per-exercise wrapping doesn't get noticeably worse.
const SHOT_TWO_COL_THRESHOLD = 8;
const SHOT_TWO_COL_WIDTH = 840;

// Accept only http(s) YouTube URLs. React does NOT block javascript: hrefs in
// production, so we validate on save (strip otherwise) and guard again at render.
// Returns the normalized URL string, or null if it is not a valid YouTube link.
function sanitizeYoutubeUrl(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(String(raw).trim()); } catch (_) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const ok = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
  return ok.includes(u.hostname.toLowerCase()) ? u.href : null;
}

// Post-hoc meso feedback editing (SessionDetailScreen) renders its own pickers
// so the live in-session sheets in screens-train.jsx stay untouched. These
// option lists + label maps MIRROR the live ones there (Soreness / Joint /
// Pump+Volume sheets and SORENESS_LABELS/JOINT_LABELS/PUMP_LABELS/VOLUME_LABELS):
// keep them in sync by hand if the live options or labels change.
const MESO_SORENESS_OPTS = [
  { key: 'never', label: 'Never sore', sub: 'No soreness from previous sessions' },
  { key: 'healed_long', label: 'Healed a while ago', sub: 'Fully recovered well before this session' },
  { key: 'healed_just', label: 'Healed just in time', sub: 'Recovered right around this session' },
  { key: 'still_sore', label: 'Still sore', sub: 'Still feeling last session in this muscle' },
];
// Joint / pump / affinity edit chips are toned inline (see toneBtn); only the soreness
// edit sheet still uses a full option list with descriptions, so keep that one.
const MESO_SORENESS_LBL = { never: 'Never sore', healed_long: 'Healed a while ago', healed_just: 'Healed just in time', still_sore: 'Still sore', very_sore: 'Very sore' };
const MESO_JOINT_LBL = { none: 'None', noticeable: 'Noticeable', sharp: 'Sharp pain' };
const MESO_PUMP_LBL = { low: 'Low', moderate: 'Moderate', amazing: 'Amazing' };
const MESO_AFFINITY_LBL = { love: 'Love it', ok: "It's fine", dislike: 'Not my lift' };
const mesoVolumeLbl = (loadOnly) => loadOnly
  ? { not_enough: 'Too light', just_right: 'Just right', pushed: 'Hard', too_much: 'Too heavy' }
  : { not_enough: 'Not enough', just_right: 'Just right', pushed: 'Pushed my limits', too_much: 'Too much' };
// Readiness labels for the recap edit row (mirrors the live sheet in screens-train.jsx).
// 'reentry' is the auto-stamped post-break ramp (discounted, like Rough).
const MESO_READINESS_LBL = { fresh: 'Fresh', normal: 'Normal', rough: 'Rough day', reentry: 'Easing back in' };

// Autoreg v2 P2: shared Block-Recap content node (spec 5.1), rendered inside a
// confirm() sheet (its message accepts a node). Pure: depends only on the global UI
// object and its args, no store/closure state, so both the training screen (via the
// blockRecapNode wrapper) and the home 8-cycle nudge render the identical recap.
// evidence null + escalation 0 is the block-end CELEBRATION framing (gains only); a
// non-null evidence array is the mid-block DECLINE framing (adds the fatigue section).
function BlockRecap({ recap, evidence = null, escalation = 0 }) {
  const u = UI.unit();
  const tile = (k, v) => (
    <div style={{ background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 6, padding: '10px 12px' }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>{k}</div>
      <div style={{ fontFamily: UI.fontNum, fontSize: 20, fontWeight: 700, color: UI.ink }}>{v}</div>
    </div>
  );
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8, marginBottom: 16 }}>
        {tile('Weight PRs', recap.prCount)}
        {tile('Sessions', recap.sessionCount)}
      </div>
      {recap.loadPRs.length > 0 && (<>
        <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>WHAT YOU BUILT</div>
        <div className="knurl" style={{ marginBottom: 10 }} />
        <div style={{ marginBottom: 16 }}>
          {recap.loadPRs.map((g, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: i < recap.loadPRs.length - 1 ? `1px solid ${UI.hair}` : 'none' }}>
              <span style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
              <span style={{ fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: 'var(--accent)', flexShrink: 0, marginLeft: 10 }}>+{g.weightDelta} {u}</span>
            </div>
          ))}
        </div>
      </>)}
      {recap.setGains.some(g => g.setDelta > 0) && (<>
        <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>MORE SETS</div>
        <div className="knurl" style={{ marginBottom: 10 }} />
        <div style={{ marginBottom: 16 }}>
          {recap.setGains.filter(g => g.setDelta > 0).map((g, i, arr) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: i < arr.length - 1 ? `1px solid ${UI.hair}` : 'none' }}>
              <span style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
              <span style={{ fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: 'var(--accent)', flexShrink: 0, marginLeft: 10 }}>+{g.setDelta} set{g.setDelta > 1 ? 's' : ''}</span>
            </div>
          ))}
        </div>
      </>)}
      {evidence && evidence.length > 0 && (<>
        <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>{escalation > 0 ? 'THE FATIGUE, STILL CLIMBING' : 'THE FATIGUE'}</div>
        <div className="knurl" style={{ marginBottom: 10 }} />
        <div>
          {evidence.map((e, i) => (
            <div key={i} style={{ fontFamily: UI.fontUi, fontSize: 12.5, color: UI.inkSoft, lineHeight: 1.45, marginBottom: 6 }}>{e}</div>
          ))}
        </div>
      </>)}
    </div>
  );
}

// Toggle shown under a non-empty exercise note: pins the note so it pops up and
// must be acknowledged at the start of that exercise every workout (zane_exercises
// note_pinned, migration 0167). Shared by the create + edit exercise forms.
function PinNoteToggle({ on, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.ink, fontWeight: 600 }}>Pin note</div>
        <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 2, lineHeight: 1.4 }}>Pops up at the start of this exercise each workout, until you tap to dismiss.</div>
      </div>
      <Toggle on={on} onToggle={onToggle} />
    </div>
  );
}

// ─── LIBRARY ──────────────────────────────────────────────────────────
function LibraryScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [tab, setTab] = useStateL(_lib.tab);
  const [q, setQ] = useStateL(_lib.q);
  const [creating, setCreating] = useStateL(false);
  const [selecting, setSelecting] = useStateL(false);
  const [selected, setSelected] = useStateL(new Set());
  const [addedSysIds, setAddedSysIds] = useStateL(new Set()); // sys_ ids added to the library this session (for row feedback)
  const [dbSeed, setDbSeed] = useStateL(null); // catalog entry being reviewed via "Check & Add" (opens the review sheet)
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
  const anyFilter = filterTags.length > 0 || filterRestCats.length > 0 || filterEquipment.length > 0 || filterUnilateral !== null || filterPlan !== null;
  const clearFilters = () => {
    setFilterTags([]); _lib.filterTags = [];
    setFilterRestCats([]); _lib.filterRestCats = [];
    setFilterUnilateral(null); _lib.filterUnilateral = null;
    setFilterPlan(null); _lib.filterPlan = null;
    setFilterEquipment([]); _lib.filterEquipment = [];
  };

  const planExIds = useMemoL(() => new Set(
    store.schedules.flatMap(s => s.days.flatMap(d => (d.items || []).map(it => it.exId)))
  ), [store.schedules]);
  // Catalog entries carry sys_ ids that are never in a plan, so plan-membership
  // for the Database tab is resolved by NAME (same mapping as the "In library"
  // check): a catalog row counts as in-plan when a same-named user exercise is.
  const planExNamesLower = useMemoL(() => {
    const names = new Set();
    for (const e of store.exercises) if (planExIds.has(e.id)) names.add((e.name || '').toUpperCase());
    return names;
  }, [store.exercises, planExIds]);

  useEffectL(() => { _lib.tab = tab; }, [tab]);
  useEffectL(() => { _lib.q = q; }, [q]);

  const exitSelect = () => { setSelecting(false); setSelected(new Set()); };

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Strip deleted exIds from a 5/3/1 program_data (mainLifts/tmHistory are keyed
  // by exId), so deleting a main lift doesn't leave orphaned program entries.
  const stripProgramData = (pd, del) => {
    if (!pd || typeof pd !== 'object' || (!pd.mainLifts && !pd.tmHistory)) return pd;
    const clean = obj => { if (!obj) return obj; const out = {}; for (const k in obj) if (!del.has(k)) out[k] = obj[k]; return out; };
    return { ...pd, ...(pd.mainLifts ? { mainLifts: clean(pd.mainLifts) } : {}), ...(pd.tmHistory ? { tmHistory: clean(pd.tmHistory) } : {}) };
  };

  const deleteSelected = async () => {
    // System cardio can't be deleted (matches the individual-tap guard), so drop
    // it from the effective set: Select All → Delete must not remove it.
    const del = new Set([...selected].filter(id => (store.exercises.find(e => e.id === id)?.movement_type) !== 'cardio'));
    if (del.size === 0) { exitSelect(); return; }
    if (!await confirm(`Previous sessions will be preserved.`, { title: `Delete ${del.size} exercise${del.size > 1 ? 's' : ''}?`, ok: 'Delete', danger: true })) return;
    const stripItems = items => (items || []).filter(item => !del.has(item.exId));
    setStore(s => ({
      ...s,
      exercises: s.exercises.filter(e => !del.has(e.id)),
      schedules: s.schedules.map(sch => ({
        ...sch,
        days: (sch.days || []).map(day => ({ ...day, items: stripItems(day.items) })),
        versions: (sch.versions || []).map(v => ({ ...v, days: (v.days || []).map(day => ({ ...day, items: stripItems(day.items) })) })),
        ...(sch.program_data ? { program_data: stripProgramData(sch.program_data, del) } : {}),
      })),
    }));
    exitSelect();
  };

  const editSelected = () => {
    const ordered = filtered.filter(e => selected.has(e.id) && e.movement_type !== 'cardio').map(e => e.id);
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
      ? Math.max(0, ...(entry.sets || []).map(s => { const r = LB.effReps(s); return s.kg && r ? LB.e1rm(s.kg, r) : 0; }), 0)
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

  // Read-only system catalog (Exercise DB tab), normalized to the row/filter shape
  // the library already renders. Duplicate-on-add copies an entry into the user's
  // own exercises (LB.systemExerciseToRow), so it never mixes into the user lists.
  const systemDisplay = useMemoL(() => (window.SYSTEM_EXERCISES || []).map(s => ({
    id: s.id, name: s.name, tags: s.tags || [], category: s.category ?? null,
    unilateral: (s.movement || 'bilateral') === 'unilateral', movement_type: s.movement || 'bilateral',
    equipment: s.equipment ?? null, _sys: s,
  })), []);
  const userNamesLower = useMemoL(() => new Set(store.exercises.map(e => (e.name || '').toUpperCase())), [store.exercises]);
  const dbFiltered = useMemoL(() => {
    const ql = q.toUpperCase();
    return systemDisplay.filter(e => {
      const matchSearch = !q || e.name.toUpperCase().includes(ql) || e.tags?.some(t => t.toUpperCase().includes(ql));
      const matchTags = filterTags.length === 0 || filterTags.some(ft => e.tags?.includes(ft));
      const matchUnilateral = filterUnilateral === null || !!e.unilateral === filterUnilateral;
      const matchEquipment = filterEquipment.length === 0 ||
        (filterEquipment.includes('none') && !e.equipment) ||
        (e.equipment && filterEquipment.includes(e.equipment));
      const matchRestCat = filterRestCats.length === 0 ||
        (filterRestCats.includes('none') && !e.category) ||
        (e.category && filterRestCats.includes(e.category));
      const inPlan = planExNamesLower.has(e.name.toUpperCase());
      const matchPlan = filterPlan === null || (filterPlan === 'in' ? inPlan : !inPlan);
      return matchSearch && matchTags && matchUnilateral && matchEquipment && matchRestCat && matchPlan;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [systemDisplay, q, filterTags, filterUnilateral, filterEquipment, filterRestCats, filterPlan, planExNamesLower]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(e => selected.has(e.id));
  // System cardio can't be deleted/edited (matches the individual-tap guard), so
  // never select it in bulk.
  const selectAll = () => setSelected(new Set(filtered.filter(e => e.movement_type !== 'cardio').map(e => e.id)));
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
        {[['recent','Recent'],['all','My exercises'],['db','Database']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, background: 'transparent', border: 'none',
            padding: '11px 0', cursor: 'pointer', whiteSpace: 'nowrap',
            color: tab === id ? UI.gold : UI.inkFaint,
            fontFamily: UI.fontUi, fontSize: 10, fontWeight: tab === id ? 600 : 400,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            borderBottom: `0.5px solid ${tab === id ? UI.gold : 'transparent'}`,
            marginBottom: -0.5,
            transition: 'color 0.2s',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: '18px 22px', paddingBottom: selecting ? 80 : 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tab === 'db' && (
          <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, marginBottom: 4 }}>
            Browse the catalog and tap Check &amp; Add — review or tweak the exercise first, then it becomes your own editable copy, ready for your plans.
          </div>
        )}
        {(tab === 'all' || tab === 'db') && (() => {
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
                  Filter{activeCount > 0 && <span style={{ background: UI.gold, color: 'var(--accent-ink)', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700 }}>{activeCount}</span>}
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
                  {LB.dayLabel(days)}
                  {top && ` · ${top.kg}${UI.unit()} × ${LB.effReps(top) ?? '?'}`}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {ex.tags?.map(t => <Pill key={t}>{t}</Pill>)}
                  {ex.category && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>{ex.category.charAt(0).toUpperCase() + ex.category.slice(1)}</Pill>}
                  {ex.unilateral && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>Unilateral</Pill>}
                  {ex.equipment ? <Pill style={{ color: UI.inkFaint, borderColor: UI.hair, fontSize: 8 }}>{EQUIPMENT_TYPES.find(t => t.key === ex.equipment)?.label ?? ex.equipment}</Pill> : <Pill style={{ color: 'rgba(var(--danger-rgb),0.5)', borderColor: 'rgba(var(--danger-rgb),0.2)', fontSize: 8 }}>Unspecified</Pill>}
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
              onClick={() => {
                if (selecting) {
                  if (isSystemCardio) { confirm(CARDIO_SYSTEM_MSG, { title: 'You shall not pass 🧙', ok: 'Got it', cancel: null }); return; }
                  toggleSelect(e.id); return;
                }
                go({ name: 'exercise', exId: e.id });
              }}
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
                  {e.equipment ? <Pill style={{ color: UI.inkFaint, borderColor: UI.hair, fontSize: 8 }}>{EQUIPMENT_TYPES.find(t => t.key === e.equipment)?.label ?? e.equipment}</Pill> : <Pill style={{ color: 'rgba(var(--danger-rgb),0.5)', borderColor: 'rgba(var(--danger-rgb),0.2)', fontSize: 8 }}>Unspecified</Pill>}
                  {planExIds.has(e.id) && <span style={{ color: UI.inkFaint, fontSize: 9, letterSpacing: '0.05em' }}>◆</span>}
                </div>
              </div>
              {selecting ? (
                isSystemCardio ? (
                  <i className="fa-solid fa-lock" title="Built-in, can't be deleted" style={{ fontSize: 12, color: UI.inkFaint, flexShrink: 0, width: 20, textAlign: 'center' }} />
                ) : (
                  <div style={{
                    width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                    border: `1px solid ${isSelected ? UI.danger : UI.hairStrong}`,
                    background: isSelected ? UI.danger : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                  </div>
                )
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

        {tab === 'db' && dbFiltered.map((e, fi) => {
          const inLib = addedSysIds.has(e.id) || userNamesLower.has(e.name.toUpperCase());
          const justAdded = addedSysIds.has(e.id);
          return (
            <React.Fragment key={e.id}>
            <div onClick={() => { if (!inLib) setDbSeed(e._sys); }} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
              padding: '13px 0', cursor: inLib ? 'default' : 'pointer',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 19, color: UI.ink, lineHeight: 1.1 }}>{e.name}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {e.tags?.map(t => <Pill key={t}>{t}</Pill>)}
                  {e.category && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>{e.category.charAt(0).toUpperCase() + e.category.slice(1)}</Pill>}
                  {e.unilateral && <Pill style={{ color: UI.inkSoft, borderColor: UI.hair }}>Unilateral</Pill>}
                  {e.equipment ? <Pill style={{ color: UI.inkFaint, borderColor: UI.hair, fontSize: 8 }}>{EQUIPMENT_TYPES.find(t => t.key === e.equipment)?.label ?? e.equipment}</Pill> : <Pill style={{ color: 'rgba(var(--danger-rgb),0.5)', borderColor: 'rgba(var(--danger-rgb),0.2)', fontSize: 8 }}>Unspecified</Pill>}
                  {planExNamesLower.has(e.name.toUpperCase()) && <span style={{ color: UI.inkFaint, fontSize: 9, letterSpacing: '0.05em' }}>◆</span>}
                </div>
              </div>
              {inLib ? (
                <span style={{ flexShrink: 0, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: justAdded ? UI.gold : UI.inkFaint, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <i className="fa-solid fa-check" /> {justAdded ? 'Added' : 'In library'}
                </span>
              ) : (
                <button onClick={ev => { ev.stopPropagation(); setDbSeed(e._sys); }} style={{
                  flexShrink: 0, background: UI.goldFaint, border: `1px solid ${UI.goldSoft}`, borderRadius: 4,
                  padding: '7px 13px', cursor: 'pointer', color: UI.gold, fontFamily: UI.fontUi, fontSize: 11,
                  fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5,
                  WebkitTapHighlightColor: 'transparent', whiteSpace: 'nowrap',
                }}><i className="fa-solid fa-plus" /> Check &amp; Add</button>
              )}
            </div>
            {fi < dbFiltered.length - 1 && <div className="knurl" />}
            </React.Fragment>
          );
        })}
        {tab === 'db' && dbFiltered.length === 0 && (
          <Empty title="No matches" sub="Try a different search or filter." icon={ICON_BARBELL} />
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
      {dbSeed && <ExerciseCreator seed={dbSeed} onClose={() => setDbSeed(null)} store={store} setStore={setStore} onCreated={() => setAddedSysIds(prev => new Set(prev).add(dbSeed.id))} />}

      {filtersOpen && (
        <Sheet open={true} onClose={() => setFiltersOpen(false)} title="Filter" titleColor="var(--accent)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <GoldSectionLabel style={{ color: UI.gold }}>MUSCLE GROUP</GoldSectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {MUSCLES.map(m => (
                  <Pill key={m} gold={filterTags.includes(m)} onClick={() => toggleFilter(m)} style={{ cursor: 'pointer' }}>{m}</Pill>
                ))}
              </div>
            </div>
            <div>
              <GoldSectionLabel style={{ color: UI.gold }}>REST</GoldSectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <Pill gold={filterRestCats.includes('none')} onClick={() => toggleRestCat('none')} style={{ cursor: 'pointer' }}>No rest assigned</Pill>
                <Pill gold={filterRestCats.includes('big')} onClick={() => toggleRestCat('big')} style={{ cursor: 'pointer' }}>Big</Pill>
                <Pill gold={filterRestCats.includes('medium')} onClick={() => toggleRestCat('medium')} style={{ cursor: 'pointer' }}>Medium</Pill>
                <Pill gold={filterRestCats.includes('small')} onClick={() => toggleRestCat('small')} style={{ cursor: 'pointer' }}>Small</Pill>
              </div>
            </div>
            <div>
              <GoldSectionLabel style={{ color: UI.gold }}>MOVEMENT</GoldSectionLabel>
              <div style={{ display: 'flex', gap: 6 }}>
                <Pill gold={filterUnilateral === true} onClick={() => toggleUni(true)} style={{ cursor: 'pointer' }}>Unilateral</Pill>
                <Pill gold={filterUnilateral === false} onClick={() => toggleUni(false)} style={{ cursor: 'pointer' }}>Bilateral</Pill>
              </div>
            </div>
            <div>
              <GoldSectionLabel style={{ color: UI.gold }}>EQUIPMENT</GoldSectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <Pill gold={filterEquipment.includes('none')} onClick={() => toggleEquipment('none')} style={{ cursor: 'pointer' }}>Unspecified</Pill>
                {EQUIPMENT_TYPES.map(({ key, label }) => (
                  <Pill key={key} gold={filterEquipment.includes(key)} onClick={() => toggleEquipment(key)} style={{ cursor: 'pointer' }}>{label}</Pill>
                ))}
              </div>
            </div>
            <div>
              <GoldSectionLabel style={{ color: UI.gold }}>PLAN</GoldSectionLabel>
              <div style={{ display: 'flex', gap: 6 }}>
                <Pill gold={filterPlan === 'in'} onClick={() => togglePlan('in')} style={{ cursor: 'pointer' }}>In plan</Pill>
                <Pill gold={filterPlan === 'out'} onClick={() => togglePlan('out')} style={{ cursor: 'pointer' }}>Not in plan</Pill>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Two destinations: apply the filter and view either the user's own
                  library or the catalog. Current tab is the primary button. */}
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn kind={tab === 'all' ? undefined : 'ghost'} onClick={() => { setTab('all'); setFiltersOpen(false); }} disabled={filtered.length === 0} style={{ flex: 1, opacity: filtered.length === 0 ? 0.4 : 1 }}>Mine ({filtered.length})</Btn>
                <Btn kind={tab === 'db' ? undefined : 'ghost'} onClick={() => { setTab('db'); setFiltersOpen(false); }} disabled={dbFiltered.length === 0} style={{ flex: 1, opacity: dbFiltered.length === 0 ? 0.4 : 1 }}>Database ({dbFiltered.length})</Btn>
              </div>
              {anyFilter && <Btn kind="ghost" onClick={clearFilters}>Clear all filters</Btn>}
            </div>
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

// Paper theme's grid canvas (see index.html's --bg-texture) doesn't survive
// html2canvas: repeating-linear-gradient background-images are silently
// dropped from the export (verified against the exact CDN build the app
// loads, html2canvas 1.4.1). An SVG <pattern> renders fine there, so
// screenshot mode gets its own grid via this component instead of CSS.
// Absolutely positioned inset:0 — the caller must be position:relative (or
// :fixed) for that to resolve against the right box.
function SvgPaperGrid({ style }) {
  const knurlRgb = getComputedStyle(document.documentElement).getPropertyValue('--knurl-rgb').trim() || '236,228,208';
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none', ...style }}>
      <defs>
        <pattern id="paperGridPattern" width="22" height="22" patternUnits="userSpaceOnUse">
          <path d="M 22 0 L 0 0 0 22" fill="none" stroke={`rgba(${knurlRgb},0.16)`} strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#paperGridPattern)" />
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

// Gold-bordered micro-label heading off a section throughout the library/
// stats screens. Border is always UI.gold (the fixed brand color, not the
// user's --accent); text color follows the normal .micro convention
// (ink-faint) unless a caller passes an explicit style.color override.
function GoldSectionLabel({ children, style }) {
  return (
    <div className="micro" style={{ borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8, marginBottom: 10, ...style }}>
      {children}
    </div>
  );
}

// Shared html2canvas capture flow for SessionDetailScreen, SessionCompareScreen,
// and the plan poster: expand the scroll parent, draw the imperative knurl
// canvases, wait for the watermark avatar to decode, capture, then share/
// download the PNG and restore layout. `dodgeAvatar` (SessionDetailScreen's
// single-column export only) shortens knurl dividers and shrinks chip rows
// that overlap the corner avatar; every other watermark (SessionDetailScreen's
// own two-column export, SessionCompareScreen, the plan poster) is a centered
// full-page background, so dividers there always draw full width.
async function captureNodeAsPng(node, { filename, dodgeAvatar = false, setCapturing, fitWidth = false } = {}) {
  if (!node) return { ok: false, reason: 'no-node' };
  // html2canvas is loaded on demand (not at boot) — fetch it on first use.
  const html2canvas = await window.__ensureHtml2Canvas?.().catch(() => null);
  if (!html2canvas) return { ok: false, reason: 'unavailable' };
  setCapturing?.(true);
  // Temporarily expand scroll parent so html2canvas captures full content
  const scrollParent = node.parentElement;
  const saved = { overflow: scrollParent.style.overflow, height: scrollParent.style.height, minHeight: scrollParent.style.minHeight };
  scrollParent.style.overflow = 'visible';
  scrollParent.style.height = 'auto';
  scrollParent.style.minHeight = 'auto';
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Draw knurl dividers imperatively — canvas elements placed by KnurlCanvas
  // are guaranteed to be in the DOM now (React re-render completed within 2 RAFs).
  const avatarEl = node.querySelector('img[data-shot-avatar]');
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
  // SessionDetailScreen's two-column centered watermark (marked data-shot-fill) is
  // sized to fill as much of the capture as possible while preserving its aspect
  // ratio, near edge-to-edge top/bottom. CSS percentage width+height on the <img>
  // itself (even with objectFit:contain) rendered visibly stretched under
  // html2canvas, the same class of bug SvgKnurl above already works around for its
  // own width:'100%', so compute and set an explicit pixel size here instead,
  // exactly like the knurl canvases below get their width imperatively.
  const fillEl = node.querySelector('img[data-shot-fill]');
  if (fillEl && fillEl.naturalWidth && fillEl.naturalHeight) {
    const wrap = fillEl.parentElement;
    const availW = wrap ? wrap.offsetWidth : 0, availH = wrap ? wrap.offsetHeight : 0;
    const scale = Math.min((availW * 0.94) / fillEl.naturalWidth, (availH * 0.96) / fillEl.naturalHeight);
    if (scale > 0 && isFinite(scale)) {
      fillEl.style.width = Math.round(fillEl.naturalWidth * scale) + 'px';
      fillEl.style.height = Math.round(fillEl.naturalHeight * scale) + 'px';
    }
  }
  const avatarRect = (dodgeAvatar && avatarEl && avatarEl.getBoundingClientRect().height) ? avatarEl.getBoundingClientRect() : null;
  const KNURL_GAP = 14;
  // Limit chip containers that vertically overlap the avatar so they don't
  // bleed into it. Same gap as knurl lines.
  if (avatarRect) {
    node.querySelectorAll('[data-shot-chips]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom > avatarRect.top && r.top < avatarRect.bottom) {
        const maxW = Math.round(avatarRect.left - r.left - KNURL_GAP);
        if (maxW > 0 && maxW < r.width) el.style.maxWidth = maxW + 'px';
      }
    });
  }
  node.querySelectorAll('canvas[data-knurl]').forEach(c => {
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
    const canvas = await html2canvas(node, {
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#1a1820',
      scale: 2, useCORS: true, logging: false,
      height: node.scrollHeight, windowHeight: node.scrollHeight,
      // fitWidth: capture the node's own full width rather than whatever's
      // currently scrolled into view. Only needed by content intentionally
      // wider than the viewport (the plan poster); every other caller's
      // content is never wider than its own viewport, so this is opt-in
      // rather than applied unconditionally to node.scrollWidth for everyone.
      ...(fitWidth ? { width: node.scrollWidth, windowWidth: node.scrollWidth } : {}),
    });
    // Report the outcome so callers can confirm success or surface a failure,
    // instead of the export silently doing nothing.
    return await new Promise(resolve => {
      canvas.toBlob(async (blob) => {
        if (!blob) { resolve({ ok: false, reason: 'encode' }); return; }
        const file = new File([blob], filename, { type: 'image/png' });
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file] }); resolve({ ok: true, shared: true }); }
          catch (_) { resolve({ ok: true, shared: false }); }
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename;
          document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          resolve({ ok: true, saved: true });
        }
      }, 'image/png');
    });
  } catch (e) {
    return { ok: false, reason: 'render' };
  } finally {
    scrollParent.style.overflow = saved.overflow;
    scrollParent.style.height = saved.height;
    scrollParent.style.minHeight = saved.minHeight;
    setCapturing?.(false);
  }
}

// Shared "how is this logged" picker. Appears whenever load isn't inherent —
// no_equipment / bodyweight equipment, or a mobility movement (the union, since
// a mobility exercise may keep any equipment). Three modes resolve to
// LB.exerciseLogMode; for bodyweight + Weight & Reps an opt-in toggle pulls the
// user's logged bodyweight (LB.shouldPullBodyweight), gated on having logged one.
const LOG_MODES = [['checkbox', 'Checkbox only'], ['reps', 'Reps only'], ['time', 'Time'], ['weight', 'Weight & Reps']];
// Assisted (band/machine takes bodyweight off) only makes sense when the base load
// IS the user's bodyweight: bodyweight, or a machine (assisted pull-up/dip). On
// external-load equipment (cable/dumbbell/barbell) the floor is just zero added
// weight, there is nothing to assist. Gates the movement picker's Assisted option.
function assistedAllowed(equipment) {
  return equipment === 'bodyweight' || equipment === 'machine';
}
function loggingPickerVisible(equipment, movementType) {
  // Assisted always logs weight (the negative assistance load), so the logging
  // picker is skipped and weight mode is forced (same path mobility/checkbox use).
  if (movementType === 'assisted') return false;
  return equipment === 'no_equipment' || equipment === 'bodyweight' || movementType === 'mobility';
}
const logNoteStyle = { marginTop: 8, textTransform: 'none', letterSpacing: '0.02em', fontWeight: 400, lineHeight: 1.5 };
function LoggingModeSection({ equipment, movementType, logMode, onLogMode, pullBodyweight, onPullBodyweight, hasLoggedWeight }) {
  if (!loggingPickerVisible(equipment, movementType)) return null;
  const info = logMode === 'reps' ? 'Tracks reps only — no weight, adds 0 to volume.'
             : logMode === 'checkbox' ? 'Just tick each set off — no reps or weight, 0 volume.'
             : logMode === 'time' ? 'Time each set with a countdown, no weight, 0 volume. Great for HIIT or holds.'
             : null;
  const showPull = equipment === 'bodyweight' && logMode === 'weight';
  return (
    <div>
      <span className="label">Logging</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {LOG_MODES.map(([val, label]) => (
          <Chip key={val} on={logMode === val} onClick={() => onLogMode(val)}>{label}</Chip>
        ))}
      </div>
      {info && <div className="micro" style={{ color: UI.inkFaint, ...logNoteStyle }}>{info}</div>}
      {showPull && (
        <div style={{ marginTop: 12 }}>
          {hasLoggedWeight ? (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <Chip on={pullBodyweight} onClick={() => onPullBodyweight(true)}>Use my bodyweight</Chip>
                <Chip on={!pullBodyweight} onClick={() => onPullBodyweight(false)}>Enter manually</Chip>
              </div>
              {pullBodyweight && <div className="micro" style={{ color: UI.inkFaint, ...logNoteStyle }}>Pulls your latest weight from the Health tab — tap Log there to record it.</div>}
            </>
          ) : (
            <div className="micro" style={{ color: 'rgba(var(--danger-rgb),0.7)', ...logNoteStyle }}>
              Log your bodyweight first in the app's Health tab (enable it under Settings) to auto-fill it.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Exercise-creation wizard ────────────────────────────────────────────────
// A step-by-step pop-up flow (UnitPromptModal-style overlay) that guides through
// a NEW exercise's fields one pick at a time, then hands off to the existing
// ExerciseCreator sheet (pre-filled) for a final review/edit before saving. It
// writes into the SAME state ExerciseCreator owns, so the hand-off is just
// "stop showing the wizard" (wizardStep → null). Sits above Sheets (z 9998), so
// its own discard prompt is inline rather than the portaled useConfirm sheet.

// Shown under the movement picker when Assisted is selected. Assisted volume needs
// a logged bodyweight (load moved = bodyweight minus assistance): warn in red when
// none is logged, matching the bodyweight logging hint.
function AssistedVolumeNote({ hasLoggedWeight }) {
  return hasLoggedWeight
    ? <div className="micro" style={{ color: 'rgba(var(--danger-rgb),0.7)', ...logNoteStyle }}>Volume uses your logged bodyweight minus the assistance, so assisted sets count too.</div>
    : <div className="micro" style={{ color: 'rgba(var(--danger-rgb),0.7)', ...logNoteStyle }}>Log your bodyweight first in the app's Health tab (enable it under Settings) so assisted sets count toward volume.</div>;
}
const WIZARD_ORDER = ['name', 'muscle', 'size', 'equipment', 'movement', 'logging'];
const WIZARD_TITLES = { name: 'Name your exercise', muscle: 'Muscle group', size: 'Exercise size', equipment: 'Equipment', movement: 'Movement type', logging: 'How do you log it?' };
function wizardStepApplicable(step, equipment, movementType) {
  return step === 'logging' ? loggingPickerVisible(equipment, movementType) : true;
}
function adjacentWizardStep(current, dir, equipment, movementType) {
  let i = WIZARD_ORDER.indexOf(current) + dir;
  while (i >= 0 && i < WIZARD_ORDER.length) {
    if (wizardStepApplicable(WIZARD_ORDER[i], equipment, movementType)) return WIZARD_ORDER[i];
    i += dir;
  }
  return null;
}

const WIZARD_INTRO = {
  name: 'Give it a clear name — this is what shows up in your plans and history.',
  muscle: 'Which muscle(s) does it train? Used to count your weekly sets per muscle. Pick one or more.',
  size: 'The times below are your own rest timers — heavier lifts get more rest. Set them under Settings › Training › Session › Rest timers, or just tweak rest mid-workout.',
  equipment: 'What do you load or do it with? This also decides how weight is entered while training.',
  movement: 'How is it performed? Decides whether you log one number or one per side.',
  logging: 'What do you want to record for each set while training?',
};
const WIZARD_EQUIP_META = {
  no_equipment:   { icon: 'fa-ban',            sub: 'Bands, ab-wheel, sled — or nothing at all' },
  bodyweight:     { icon: 'fa-person',         sub: 'Just your bodyweight (push-ups, pull-ups)' },
  cable:          { icon: 'fa-grip-vertical',  sub: 'Cable pulley / stack' },
  dumbbell:       { icon: 'fa-dumbbell',       sub: 'Dumbbells or kettlebells' },
  barbell_dual:   { icon: 'fa-weight-hanging', sub: 'Barbell, plates on both sides' },
  machine:        { icon: 'fa-sliders',        sub: 'Pin- or plate-loaded machine' },
  barbell_single: { icon: 'fa-weight-hanging', sub: 'Landmine / single-loaded bar' },
};

function ExerciseWizard({ step, setStep, onClose, isDirty, store,
  name, setName, selectedTags, setSelectedTags, category, setCategory,
  equipment, onEquipment, movementType, setMovementType, logMode, pickLogMode,
  pullBodyweight, setPullBodyweight }) {
  const [confirming, setConfirming] = useStateL(false);
  // Keep the card inside the VISIBLE viewport so the Name step's text input isn't
  // hidden behind the on-screen keyboard: visualViewport shrinks when the keyboard
  // opens, so centering within it floats the card just above the keyboard.
  const [vp, setVp] = useStateL(null);
  useEffectL(() => {
    const v = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!v) return;
    const on = () => setVp({ top: v.offsetTop, height: v.height });
    on();
    v.addEventListener('resize', on); v.addEventListener('scroll', on);
    return () => { v.removeEventListener('resize', on); v.removeEventListener('scroll', on); };
  }, []);
  const applicable = WIZARD_ORDER.filter(s => wizardStepApplicable(s, equipment, movementType));
  const idx = applicable.indexOf(step);
  const hasPrev = adjacentWizardStep(step, -1, equipment, movementType) != null;
  const goNext = (o = {}) => setStep(adjacentWizardStep(step, 1, o.equipment ?? equipment, o.movementType ?? movementType));
  const goBack = () => {
    const prev = adjacentWizardStep(step, -1, equipment, movementType);
    if (prev) setStep(prev);
    else if (isDirty()) setConfirming(true);
    else onClose();
  };
  // Backdrop tap → leave the wizard, warning first if anything was entered.
  const requestExit = () => { if (isDirty()) setConfirming(true); else onClose(); };
  const restLabel = (cat) => {
    const s = store?.settings || {};
    const sec = cat === 'big' ? (s.restBig ?? 180) : cat === 'medium' ? (s.restMedium ?? 120) : (s.restSmall ?? 90);
    return sec % 60 === 0 ? `${sec / 60} min` : sec > 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec}s`;
  };
  // Rich option row: icon chip · label + explainer · (rest badge and/or check).
  const optRow = ({ key, icon, label, sub, active, badge, onClick }) => (
    <button key={key} onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
      padding: '12px 14px', borderRadius: 6, cursor: 'pointer',
      background: active ? 'rgba(var(--accent-rgb),0.10)' : UI.bgInset,
      border: `1px solid ${active ? 'var(--accent)' : UI.hairStrong}`,
      WebkitTapHighlightColor: 'transparent', transition: 'border-color 0.12s, background 0.12s',
    }}>
      <span style={{
        width: 40, height: 40, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? 'rgba(var(--accent-rgb),0.16)' : UI.bgRaised,
        border: `0.5px solid ${active ? 'rgba(var(--accent-rgb),0.4)' : UI.hair}`,
      }}><i className={`fa-solid ${icon}`} style={{ fontSize: 16, color: active ? 'var(--accent)' : UI.inkFaint }} /></span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--accent)' : UI.ink, fontFamily: UI.fontUi }}>{label}</span>
        {sub && <span className="micro" style={{ color: UI.inkFaint, textTransform: 'none', letterSpacing: '0.02em', fontWeight: 400, lineHeight: 1.35 }}>{sub}</span>}
      </span>
      {badge && <span className="num" style={{ flexShrink: 0, fontSize: 11, padding: '3px 7px', borderRadius: 4, color: active ? 'var(--accent)' : UI.inkSoft, background: active ? 'rgba(var(--accent-rgb),0.12)' : UI.bgRaised, border: `0.5px solid ${active ? 'rgba(var(--accent-rgb),0.35)' : UI.hair}` }}>{badge}</span>}
      {!badge && active && <i className="fa-solid fa-circle-check" style={{ flexShrink: 0, fontSize: 17, color: 'var(--accent)' }} />}
    </button>
  );

  let body;
  if (step === 'name') {
    body = <TextInput value={name} onChange={v => setName(v.toUpperCase())} placeholder="e.g. BENCH PRESS" autoFocus />;
  } else if (step === 'muscle') {
    body = <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {MUSCLES.map(m => {
        const on = selectedTags.includes(m);
        return <button key={m} onClick={() => setSelectedTags(on ? selectedTags.filter(x => x !== m) : [...selectedTags, m])}
          style={{ ...pickChipStyle(on), width: '100%', textAlign: 'center', padding: '11px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m}</button>;
      })}
    </div>;
  } else if (step === 'size') {
    body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[['big', 'Big', 'Heavy compounds — squat, deadlift, overhead press'], ['medium', 'Medium', 'Moderate lifts — bench, row, pull-up, lunge'], ['small', 'Small', 'Isolation — curls, lateral raises, extensions']]
        .map(([val, label, sub]) => optRow({ key: val, icon: 'fa-stopwatch', label, sub, active: category === val, badge: restLabel(val) + ' rest', onClick: () => { setCategory(val); goNext(); } }))}
    </div>;
  } else if (step === 'equipment') {
    body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {EQUIPMENT_TYPES.map(({ key, label }) => optRow({ key, icon: WIZARD_EQUIP_META[key].icon, label, sub: WIZARD_EQUIP_META[key].sub, active: equipment === key, onClick: () => { onEquipment(key); goNext({ equipment: key }); } }))}
    </div>;
  } else if (step === 'movement') {
    body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[['bilateral', 'Bilateral', 'fa-arrows-left-right', 'Both sides work together, one number per set'], ['unilateral', 'Unilateral', 'fa-arrow-right-long', 'One arm/leg at a time, logs left & right'], ['assisted', 'Assisted', 'fa-hands-holding', 'A machine or band takes weight off, logged as a negative load'], ['mobility', 'Mobility', 'fa-arrows-rotate', 'Stretch or warm-up, usually no load']]
        .filter(([val]) => val !== 'assisted' || assistedAllowed(equipment) || movementType === 'assisted')
        .map(([val, label, icon, sub]) => optRow({ key: val, icon, label, sub, active: movementType === val, onClick: () => { setMovementType(val); goNext({ movementType: val }); } }))}
    </div>;
  } else if (step === 'logging') {
    // For a bodyweight exercise, picking Weight & Reps reveals the pull-from-Health
    // choice inline (and needs an explicit Next); other picks auto-advance.
    const showPull = equipment === 'bodyweight' && logMode === 'weight';
    const hasLoggedWeight = LB.latestBodyweight(store) != null;
    body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[['checkbox', 'Checkbox only', 'fa-circle-check', 'Just tick each set off — no numbers, 0 volume'], ['reps', 'Reps only', 'fa-rotate', 'Count reps, no weight — adds 0 to volume'], ['time', 'Time', 'fa-stopwatch', 'Countdown per set, no weight, 0 volume'], ['weight', 'Weight & Reps', 'fa-dumbbell', 'Track both — the usual for weighted lifts']]
        .map(([val, label, icon, sub]) => optRow({ key: val, icon, label, sub, active: logMode === val, onClick: () => { pickLogMode(val); if (!(val === 'weight' && equipment === 'bodyweight')) goNext(); } }))}
      {showPull && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
          <span className="micro" style={{ color: UI.inkFaint }}>Starting weight</span>
          {hasLoggedWeight
            ? [['pull', true, 'fa-person', 'Use my bodyweight', 'Pulls your latest weight from the Health tab — tap Log there to record it'], ['manual', false, 'fa-pen', 'Enter manually', 'Type the weight yourself each session']]
                .map(([k, v, icon, label, sub]) => optRow({ key: k, icon, label, sub, active: pullBodyweight === v, onClick: () => setPullBodyweight(v) }))
            : <div className="micro" style={{ color: 'rgba(var(--danger-rgb),0.7)', textTransform: 'none', letterSpacing: '0.02em', fontWeight: 400, lineHeight: 1.5 }}>Log your bodyweight first in the app's Health tab (enable it under Settings) to auto-fill it.</div>}
        </div>
      )}
    </div>;
  }

  const needsNext = step === 'name' || step === 'muscle' || (step === 'logging' && equipment === 'bodyweight' && logMode === 'weight');
  const canNext = step !== 'name' || name.trim();
  const overlayBase = { zIndex: 9998, background: 'rgba(0,0,0,0.74)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 };
  const overlayStyle = vp ? { ...overlayBase, position: 'fixed', left: 0, right: 0, top: vp.top, height: vp.height } : { ...overlayBase, position: 'fixed', inset: 0 };
  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) requestExit(); }}>
      <div style={{ width: '100%', maxWidth: 360, maxHeight: '86vh', overflowY: 'auto', background: UI.bgRaised, border: `1px solid ${UI.hairStrong}`, borderRadius: 8, padding: '20px 20px 22px', display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 32px 80px rgba(0,0,0,0.6)', animation: 'fadeUp 0.3s ease' }}>
        {confirming ? (
          <>
            <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 700, textTransform: 'uppercase' }}>Discard exercise?</div>
            <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>Your new exercise won't be saved.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => setConfirming(false)} style={{ flex: 1 }}>Keep editing</Btn>
              <Btn onClick={onClose} style={{ flex: 1, background: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.6)' }}>Discard</Btn>
            </div>
          </>
        ) : (
          <>
            {/* Segmented progress */}
            <div style={{ display: 'flex', gap: 4 }}>
              {applicable.map((s, i) => (
                <div key={s} style={{ flex: 1, height: 4, borderRadius: 999, background: i <= idx ? 'var(--accent)' : UI.hairStrong, opacity: i <= idx ? 1 : 0.5, transition: 'background 0.2s, opacity 0.2s' }} />
              ))}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontFamily: UI.fontDisplay, fontSize: 23, color: 'var(--accent)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.1 }}>{WIZARD_TITLES[step]}</div>
                <span className="micro" style={{ color: UI.inkGhost, flexShrink: 0 }}>{idx + 1}/{applicable.length}</span>
              </div>
              <div style={{ fontSize: 12.5, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, marginTop: 7 }}>{WIZARD_INTRO[step]}</div>
            </div>
            {body}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={goBack} style={{ background: 'transparent', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, cursor: 'pointer', padding: '8px 4px', WebkitTapHighlightColor: 'transparent' }}>{hasPrev ? '← Back' : 'Cancel'}</button>
              <div style={{ flex: 1 }} />
              {step === 'size' && <button onClick={() => { setCategory(null); goNext(); }} style={{ background: 'transparent', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, cursor: 'pointer', padding: '8px 10px', WebkitTapHighlightColor: 'transparent' }}>Skip</button>}
              {needsNext && <Btn onClick={() => goNext()} disabled={!canNext} style={{ opacity: canNext ? 1 : 0.4 }}>Next</Btn>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ExerciseCreator({ onClose, store, setStore, onCreated, initialName = '', initialTags = [], seed = null }) {
  const [confirmEl, confirm] = useConfirm();
  // `seed` = a system-catalog entry ({ name, tags, equipment, movement, logMode })
  // being duplicated via "Check & Add": every field is pre-filled and the wizard
  // is skipped, dropping straight into the review sheet so the user can tweak
  // anything before committing. A plain "New exercise" has no seed.
  // A fresh new exercise starts blank — EXCEPT the muscle group, which pre-fills
  // from an active Library filter (initialTags) so "filter by Back → create" keeps
  // Back selected (now shown in the muscle step, not silently skipped). Equipment/
  // movement come from no filter, so they start unset. A catalog `seed` pre-fills
  // everything (it IS a specific exercise being reviewed).
  const [name, setName] = useStateL(seed ? (seed.name || '') : initialName);
  const [selectedTags, setSelectedTags] = useStateL(seed ? (seed.tags ? [...seed.tags] : []) : initialTags);
  const [category, setCategory] = useStateL(seed?.category ?? null);
  const [movementType, setMovementType] = useStateL(seed ? (seed.movement || 'bilateral') : null);
  const [logMode, setLogMode] = useStateL(seed ? (seed.logMode || 'weight') : 'weight');
  const [pullBodyweight, setPullBodyweight] = useStateL(false);
  const [logModeTouched, setLogModeTouched] = useStateL(!!seed); // seed pre-sets the mode → don't auto-override
  const pickLogMode = (m) => { setLogModeTouched(true); setLogMode(m); };
  const [equipment, setEquipment] = useStateL(seed ? (seed.equipment || 'no_equipment') : null);
  const [note, setNote] = useStateL('');
  const [notePinned, setNotePinned] = useStateL(false);
  const [youtubeUrl, setYoutubeUrl] = useStateL(''); // no seed field for this: a catalog entry never carries one
  const [showSizeInfo, setShowSizeInfo] = useStateL(false);
  const [showBodyweightHint, setShowBodyweightHint] = useStateL(false);
  // Fresh exercise → the wizard runs the full flow from the name step. A catalog
  // seed skips it (null = review sheet). The wizard forces a pick at each step, so
  // equipment/movement are never left unset by the time the review sheet renders.
  const [wizardStep, setWizardStep] = useStateL(seed ? null : 'name');
  // Wizard equipment pick: activate the Health tab silently — the info sheet is
  // z-100 and would hide behind the z-9998 wizard; the pull toggle in the review
  // form covers the rest.
  const wizardSetEquipment = (key) => {
    setEquipment(key || 'no_equipment');
    if (!assistedAllowed(key || 'no_equipment') && movementType === 'assisted') setMovementType('bilateral');
    if (key === 'bodyweight' && !store?.settings?.showHealthTab) setStore(s => ({ ...s, settings: { ...s.settings, showHealthTab: true } }));
  };
  // When the Logging picker first becomes relevant (no_equipment / bodyweight
  // equipment, or a mobility movement) and the user hasn't chosen a mode yet,
  // pre-select a sensible default — without clobbering a manual pick.
  useEffectL(() => {
    if (logModeTouched || !loggingPickerVisible(equipment, movementType)) return;
    setLogMode(movementType === 'mobility' ? 'checkbox' : equipment === 'bodyweight' ? 'weight' : 'reps');
  }, [equipment, movementType, logModeTouched]);
  const toggleTag = (m) => setSelectedTags(t => t.includes(m) ? t.filter(x => x !== m) : [...t, m]);
  const handleEquipmentChange = (key) => {
    setEquipment(key || 'no_equipment');
    if (!assistedAllowed(key || 'no_equipment') && movementType === 'assisted') setMovementType('bilateral');
    if (key === 'bodyweight' && !store?.settings?.showHealthTab) {
      setStore(s => ({ ...s, settings: { ...s.settings, showHealthTab: true } }));
      setShowBodyweightHint(true);
    }
  };
  const save = () => {
    if (!name.trim()) return;
    const effLogMode = loggingPickerVisible(equipment, movementType) ? logMode : 'weight';
    const ex = { id: LB.uid(), name: name.trim(), tags: selectedTags, category: category || null, unilateral: movementType === 'unilateral', movement_type: movementType, no_weight_reps: effLogMode !== 'weight', log_mode: effLogMode, pull_bodyweight: (equipment === 'bodyweight' && effLogMode === 'weight' ? pullBodyweight : false), equipment: equipment || null, note: note.trim(), note_pinned: note.trim() ? notePinned : false, youtube_url: sanitizeYoutubeUrl(youtubeUrl), progression_reps: null };
    setStore(s => ({ ...s, exercises: [...s.exercises, ex] }));
    onCreated?.(ex.id);
    onClose();
  };
  // Guard against an accidental backdrop tap wiping a half-filled form. Everything
  // starts unset now (equipment/movement null), so "dirty" = the user picked anything.
  const isDirty = () =>
    name.trim() !== initialName.trim() || selectedTags.length > 0 || category != null ||
    movementType != null || logModeTouched || equipment != null || note.trim() !== '' || youtubeUrl.trim() !== '';
  const requestClose = async () => {
    if (isDirty() && !await confirm('Your new exercise will be discarded.', { title: 'Leave without saving?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    onClose();
  };
  return (
    <>
    {wizardStep !== null ? (
      <ExerciseWizard
        step={wizardStep} setStep={setWizardStep} onClose={onClose} isDirty={isDirty} store={store}
        name={name} setName={setName} selectedTags={selectedTags} setSelectedTags={setSelectedTags}
        category={category} setCategory={setCategory}
        equipment={equipment} onEquipment={wizardSetEquipment}
        movementType={movementType} setMovementType={setMovementType}
        logMode={logMode} pickLogMode={pickLogMode}
        pullBodyweight={pullBodyweight} setPullBodyweight={setPullBodyweight}
      />
    ) : (
    <Sheet open={true} onClose={requestClose} title={seed ? 'Review & add' : 'New exercise'}>
      <div onPointerDown={blurKbOnControlTap} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Field label="Name">
          <TextInput value={name} onChange={v => setName(v.toUpperCase())} placeholder="e.g. BENCH PRESS" />
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
            {[['bilateral', 'Bilateral'], ['unilateral', 'Unilateral'], ['assisted', 'Assisted'], ['mobility', 'Mobility']].filter(([val]) => val !== 'assisted' || assistedAllowed(equipment) || movementType === 'assisted').map(([val, label]) => (
              <Chip key={val} on={movementType === val} onClick={() => setMovementType(val)}>{label}</Chip>
            ))}
          </div>
          {movementType === 'assisted' && <AssistedVolumeNote hasLoggedWeight={LB.latestBodyweight(store) != null} />}
        </div>
        <LoggingModeSection
          equipment={equipment} movementType={movementType}
          logMode={logMode} onLogMode={pickLogMode}
          pullBodyweight={pullBodyweight} onPullBodyweight={setPullBodyweight}
          hasLoggedWeight={LB.latestBodyweight(store) != null}
        />
        <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i className="fa-brands fa-youtube" style={{ color: '#FF0000', fontSize: 12 }} />Form video</span>}>
          <TextInput value={youtubeUrl} onChange={setYoutubeUrl} placeholder="YouTube link (optional)" />
        </Field>
        <Field label="Note (optional)">
          <textarea value={note} onChange={e => setNote(e.target.value)}
            placeholder="e.g. Cable pos 4, neutral grip, slow eccentric"
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box', background: 'transparent',
              border: 'none', borderBottom: `0.5px solid ${UI.hairStrong}`,
              padding: '6px 0', color: UI.ink, fontFamily: UI.fontUi, fontSize: 14,
              resize: 'none', outline: 'none',
            }}
          />
        </Field>
        {note.trim() && <PinNoteToggle on={notePinned} onToggle={() => setNotePinned(v => !v)} />}
        <Btn onClick={save} style={{ opacity: name.trim() ? 1 : 0.4 }} disabled={!name.trim()}>{seed ? 'Add to library' : 'Create'}</Btn>
      </div>
    </Sheet>
    )}
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
  const [editLogMode, setEditLogMode] = useStateL(autoEdit ? LB.exerciseLogMode(ex) : 'weight');
  const [editPullBodyweight, setEditPullBodyweight] = useStateL(autoEdit ? !!ex.pull_bodyweight : false);
  const [editEquipment, setEditEquipment] = useStateL(autoEdit ? (ex.equipment || null) : null);
  const [editYoutubeUrl, setEditYoutubeUrl] = useStateL(autoEdit ? (ex.youtube_url || '') : '');
  const [noteVal, setNoteVal] = useStateL(autoEdit ? (ex.note || '') : '');
  const [editNotePinned, setEditNotePinned] = useStateL(autoEdit ? !!ex.note_pinned : false);
  const [showSizeInfoEdit, setShowSizeInfoEdit] = useStateL(false);
  const [showBodyweightHint, setShowBodyweightHint] = useStateL(false);
  const handleEditEquipmentChange = (key) => {
    setEditEquipment(key || null);
    if (!assistedAllowed(key) && editMovementType === 'assisted') setEditMovementType('bilateral');
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

  const startEdit = () => { setEditName(ex.name); setEditTags([...(ex.tags || [])]); setEditCategory(ex.category || null); setEditMovementType(ex.movement_type ?? (ex.unilateral ? 'unilateral' : 'bilateral')); setEditLogMode(LB.exerciseLogMode(ex)); setEditPullBodyweight(!!ex.pull_bodyweight); setEditEquipment(ex.equipment || null); setEditYoutubeUrl(ex.youtube_url || ''); setNoteVal(ex.note || ''); setEditNotePinned(!!ex.note_pinned); setEditMode(true); };
  const cancelEdit = () => { if (autoEdit) advanceQueue(); else setEditMode(false); };
  const saveEdit = () => {
    if (!editName.trim()) return;
    setStore(s => {
      const effLogMode = loggingPickerVisible(editEquipment, editMovementType) ? editLogMode : 'weight';
      const exercises = s.exercises.map(e => e.id === exId
        ? { ...e, name: editName.trim(), tags: editTags, category: editCategory || null, unilateral: editMovementType === 'unilateral', movement_type: editMovementType, no_weight_reps: effLogMode !== 'weight', log_mode: effLogMode, pull_bodyweight: (editEquipment === 'bodyweight' && effLogMode === 'weight' ? editPullBodyweight : false), equipment: editEquipment || null, note: noteVal.trim(), note_pinned: noteVal.trim() ? editNotePinned : false, youtube_url: sanitizeYoutubeUrl(editYoutubeUrl) }
        : e);
      return { ...s, exercises };
    });
    setEditMode(false);
    if (autoEdit) advanceQueue();
  };
  const toggleEditTag = (m) => setEditTags(t => t.includes(m) ? t.filter(x => x !== m) : [...t, m]);

  const deleteExercise = async () => {
    if (!await confirm('Previous sessions will be preserved.', { title: `Delete "${ex.name}"?`, ok: 'Delete', danger: true })) return;
    const stripItems = items => (items || []).filter(item => item.exId !== exId);
    // Also strip plan version snapshots and any 5/3/1 program_data keyed by this
    // exId, mirroring the bulk delete, so no dangling references remain.
    const cleanPd = (pd) => {
      if (!pd || typeof pd !== 'object' || (!pd.mainLifts && !pd.tmHistory)) return pd;
      const drop = obj => { if (!obj || !(exId in obj)) return obj; const { [exId]: _removed, ...rest } = obj; return rest; };
      return { ...pd, ...(pd.mainLifts ? { mainLifts: drop(pd.mainLifts) } : {}), ...(pd.tmHistory ? { tmHistory: drop(pd.tmHistory) } : {}) };
    };
    setStore(s => ({
      ...s,
      exercises: s.exercises.filter(e => e.id !== exId),
      schedules: s.schedules.map(sch => ({
        ...sch,
        days: (sch.days || []).map(day => ({ ...day, items: stripItems(day.items) })),
        versions: (sch.versions || []).map(v => ({ ...v, days: (v.days || []).map(day => ({ ...day, items: stripItems(day.items) })) })),
        ...(sch.program_data ? { program_data: cleanPd(sch.program_data) } : {}),
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

  // Time-based exercise: the chart/PR math tracks the best DURATION per session
  // instead of an estimated 1RM. Assisted exercise: it tracks the best (highest,
  // least-negative) LOAD, since Epley on a negative kg is nonsense and "best" is
  // "least assistance". Both would otherwise leave the chart/PR empty (kg-null or
  // negative estimates get filtered out).
  const isTimeEx = LB.exerciseLogMode(ex) === 'time';
  const isAssistedEx = LB.isAssisted(ex);
  const valForSet = (s) => {
    if (isTimeEx) return (!s.warmup && s.timeSec != null ? s.timeSec : 0);
    if (isAssistedEx) return (!s.warmup && s.kg != null ? s.kg : null);
    return e1rmForSet(s);
  };

  const points = history.map(h => {
    if (isAssistedEx) {
      // Signed load, so a fixed 0 seed would beat every negative set: reduce
      // over the present values only.
      const vals = (h.entry.sets || []).map(valForSet).filter(v => v != null);
      return vals.length ? { date: h.session.date, est: Math.max(...vals) } : null;
    }
    const best = (h.entry.sets || []).reduce((m, s) => Math.max(m, valForSet(s)), 0);
    return { date: h.session.date, est: best };
  }).filter(p => p && (isAssistedEx || p.est > 0)).reverse();

  const pr = points.length ? Math.max(...points.map(p => p.est)) : 0;

  const volPr = history.length ? Math.max(...history.map(h =>
    (h.entry.sets || []).reduce((sum, s) => s.kg == null ? sum : sum + s.kg * (LB.effReps(s) ?? 0), 0)
  )) : 0;

  // Best (longest) logged duration = the PR of a time exercise.
  const bestTime = isTimeEx ? pr : 0;
  // Reps-only exercises have no weight PR: surface their best rep count instead.
  // Checkbox exercises have no numeric stat at all, so they show only Sessions.
  const logModeEx = LB.exerciseLogMode(ex);
  const isRepsOnlyEx = logModeEx === 'reps';
  const isCheckboxEx = logModeEx === 'checkbox';
  const bestReps = isRepsOnlyEx
    ? history.reduce((m, h) => Math.max(m, ...(h.entry.sets || []).filter(s => !s.warmup).map(s => LB.effReps(s) ?? 0), 0), 0)
    : 0;

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
              <button onClick={() => confirm(CARDIO_SYSTEM_MSG, { title: 'You shall not pass 🧙', ok: 'Got it', cancel: null })} style={{
                background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                color: UI.inkFaint, padding: '4px 8px',
              }}>
                <i className="fa-solid fa-lock" style={{ fontSize: 10 }} />
                <span className="micro" style={{ letterSpacing: '0.1em' }}>SYSTEM</span>
              </button>
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

      <div style={{ padding: '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)' }}>
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
                {[['bilateral', 'Bilateral'], ['unilateral', 'Unilateral'], ['assisted', 'Assisted'], ['mobility', 'Mobility']].filter(([val]) => val !== 'assisted' || assistedAllowed(editEquipment) || editMovementType === 'assisted').map(([val, label]) => (
                  <Chip key={val} on={editMovementType === val} onClick={() => setEditMovementType(val)}>{label}</Chip>
                ))}
              </div>
              {editMovementType === 'assisted' && <AssistedVolumeNote hasLoggedWeight={LB.latestBodyweight(store) != null} />}
            </div>
            <LoggingModeSection
              equipment={editEquipment} movementType={editMovementType}
              logMode={editLogMode} onLogMode={setEditLogMode}
              pullBodyweight={editPullBodyweight} onPullBodyweight={setEditPullBodyweight}
              hasLoggedWeight={LB.latestBodyweight(store) != null}
            />
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i className="fa-brands fa-youtube" style={{ color: '#FF0000', fontSize: 12 }} />Form video</span>}>
              <TextInput value={editYoutubeUrl} onChange={setEditYoutubeUrl} placeholder="YouTube link (optional)" />
            </Field>
            <Field label="Note (optional)">
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
            </Field>
            {noteVal.trim() && <PinNoteToggle on={editNotePinned} onToggle={() => setEditNotePinned(v => !v)} />}
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
            {ex.movement_type === 'assisted' && <Pill gold>Assisted</Pill>}
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
        {sanitizeYoutubeUrl(ex.youtube_url) && (
          <a href={sanitizeYoutubeUrl(ex.youtube_url)} target="_blank" rel="noopener noreferrer"
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
          {isTimeEx
            ? <SubDial label="Best Time" value={bestTime ? LB.fmtDuration(bestTime) : '—'} size={90} gold />
            : isAssistedEx
            ? <SubDial label="Best Load" value={points.length ? Math.round(pr) : '—'} sub={UI.unit()} size={90} gold />
            : isRepsOnlyEx
            ? <SubDial label="Best reps" value={bestReps || '—'} size={90} gold />
            : isCheckboxEx
            ? null
            : <SubDial label="1RM PR" value={pr ? Math.round(pr) : '—'} sub={UI.unit()} size={90} gold />}
          <SubDial label="Sessions" value={history.length} size={90} />
          {!isTimeEx && !isAssistedEx && !isRepsOnlyEx && !isCheckboxEx && <SubDial label="Vol PR" value={volPr ? Math.round(volPr) : '—'} sub={UI.unit()} size={90} gold />}
        </div>

        {points.length > 1 && <ProgressChart points={points} title={isTimeEx ? 'BEST TIME · HISTORY' : isAssistedEx ? 'BEST LOAD · HISTORY' : undefined} fmtVal={isTimeEx ? LB.fmtDuration : undefined} />}

        {/* Note — read-only here; edited via the Edit button's form below */}
        <div>
          <Bezel>NOTE{ex.note && ex.note_pinned ? <span style={{ color: 'var(--accent)', marginLeft: 8, letterSpacing: 0 }}><i className="fa-solid fa-thumbtack" style={{ fontSize: 9 }} /> PINNED</span> : ''}</Bezel>
          <div style={{ marginTop: 12 }}>
            <div className="display-it" style={{ fontSize: 16, color: ex.note ? UI.inkSoft : UI.inkFaint, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {ex.note || 'No note yet.'}
            </div>
          </div>
        </div>

        {/* History */}
        <div>
          <Bezel>HISTORY</Bezel>
          <div style={{ marginTop: 8 }}>
            {history.slice(0, 10).map((h, hi) => {
              // Assisted loads are negative, so a 0-seeded reduce would never
              // beat them: max over the present values, and a signed PR compare.
              const sVals = (h.entry.sets || []).map(valForSet).filter(v => v != null);
              const sessionBest = sVals.length ? Math.max(...sVals) : (isAssistedEx ? null : 0);
              const isPR = isAssistedEx
                ? (points.length > 0 && sessionBest != null && Math.abs(sessionBest - pr) < 0.01)
                : (pr > 0 && sessionBest > 0 && Math.abs(sessionBest - pr) < 0.01);
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
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {h.entry.sets.filter(s => (s.kg != null || s.timeSec != null) && !s.warmup).map((s, i) => {
                        const isBest = isAssistedEx
                          ? (sessionBest != null && valForSet(s) != null && Math.abs(valForSet(s) - sessionBest) < 0.01)
                          : (sessionBest > 0 && Math.abs(valForSet(s) - sessionBest) < 0.01);
                        // Per-side L/R only for an actually-unilateral exercise. A
                        // set left with stray L/R data after a swap to a bilateral
                        // exercise collapses to one number (the min, the app-wide
                        // effective-reps convention) instead of rendering as L/R.
                        const exIsUni = ex.movement_type === 'unilateral' || (ex.unilateral && !ex.movement_type);
                        const repsStr = exIsUni
                          ? ((s.repsL != null || s.repsR != null) ? `L${s.repsL ?? '?'}/R${s.repsR ?? '?'}` : s.reps)
                          : (s.reps != null ? s.reps : ((s.repsL != null || s.repsR != null) ? Math.min(s.repsL ?? s.repsR ?? 0, s.repsR ?? s.repsL ?? 0) : s.reps));
                        return (
                          <span key={i} className="num" style={{ fontSize: 13, color: isBest ? UI.gold : UI.ink }}>
                            {s.timeSec != null
                              ? LB.fmtDuration(s.timeSec)
                              : <>{s.kg}<span style={{ color: isBest ? UI.goldSoft : UI.inkFaint }}>×</span>{repsStr}</>}
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

function ProgressChart({ points, title, fmtVal }) {
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
  // Default axis: rounded kg/lbs values (est. 1RM). A time exercise passes
  // fmtVal (fmtDuration) and its own title, the geometry stays identical.
  const axisVal = (v, last) => fmtVal ? fmtVal(Math.round(v)) : (last ? `${Math.round(v)} ${unit}` : Math.round(v));
  return (
    <div style={{ padding: '10px 0', maxWidth: 380 }}>
      <div className="micro" style={{ marginBottom: 8, color: UI.inkFaint }}>{title || 'EST. 1RM · HISTORY'}</div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>
        {gridVals.map((v, i) => (
          <g key={`g${i}`}>
            {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={w - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
            <text x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fill={UI.inkFaint} fontFamily={UI.fontNum}>{axisVal(v, i === 3)}</text>
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
  const du = LB.cardioDistUnit();
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
  const distPoints = filtered.filter(l => l.distanceM != null).map(l => ({ date: l.date, value: du === 'mi' ? l.distanceM / LB.MI_TO_M : l.distanceM / 1000 }));
  const speedPoints = filtered.filter(l => l.distanceM != null && l.durationMinutes > 0).map(l => ({ date: l.date, value: parseFloat(((du === 'mi' ? l.distanceM / LB.MI_TO_M : l.distanceM / 1000) / (l.durationMinutes / 60)).toFixed(2)) }));
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
    totalM > 0 && `${du === 'mi' ? (totalM / LB.MI_TO_M).toFixed(1) : (totalM / 1000).toFixed(1)} ${du} total`,
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
function WorkoutEffortSheet({ dayId, dayName, sessions, exercises, dailyLogs, onClose }) {
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
    .map(s => ({ date: s.date.slice(0, 10), value: LB.totalVolume(s, exercises, dailyLogs) }))
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
  const todayKey = LB.fmtISO(today);

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
  const todayISO = LB.fmtISO(today);
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
        .reduce((sum, s) => sum + LB.totalVolume(s, store.exercises, store.dailyLogs), 0);
      const label = wMon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      weeks.push({ label, vol });
    }
    return weeks;
  }, [sessions, todayKey]);

  // All-time stats
  const totalVol = sessions.reduce((sum, s) => sum + LB.totalVolume(s, store.exercises, store.dailyLogs), 0);
  const avgVol = sessions.length ? Math.round(totalVol / sessions.length) : 0;
  const durations = sessions
    .map(s => s.durationMinutes != null
      ? s.durationMinutes
      : (s.startedAt && s.ended ? Math.round((new Date(s.ended) - new Date(s.startedAt)) / 60000) : null))
    .filter(d => d != null && d > 0);
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const maxDuration = durations.length ? Math.max(...durations) : 0;

  // Best session by volume
  const bestSession = sessions.length ? sessions.reduce((best, s) => LB.totalVolume(s, store.exercises, store.dailyLogs) > LB.totalVolume(best, store.exercises, store.dailyLogs) ? s : best, sessions[0]) : null;

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
    const dateStr = LB.fmtISO(date);
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
      const key = LB.fmtISO(d);
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
        const key = LB.fmtISO(d);
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
      const key = LB.fmtISO(d);
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
          <GoldSectionLabel style={{ marginBottom: 0 }}>
            {isCycleMode ? `CYCLE ${selectedCycleNum + 1} · SETS PER MUSCLE` : 'THIS WEEK · SETS PER MUSCLE'}
          </GoldSectionLabel>
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
        <GoldSectionLabel style={{ marginBottom: 14 }}>WEEKLY VOLUME · LAST 8 WEEKS</GoldSectionLabel>
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
        <GoldSectionLabel style={{ marginBottom: 14 }}>ALL TIME</GoldSectionLabel>
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
        <GoldSectionLabel style={{ marginBottom: 14 }}>CONSISTENCY</GoldSectionLabel>
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
          <GoldSectionLabel style={{ marginBottom: 14 }}>BEST SESSION</GoldSectionLabel>
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
                <div className="num" style={{ fontSize: 22, color: UI.gold }}>{Math.round(LB.totalVolume(bestSession, store.exercises, store.dailyLogs)).toLocaleString('en-US')}</div>
                <div className="micro" style={{ color: UI.inkFaint }}>{UI.unit()}</div>
              </div>
            </div>
          </Frame>
        </div>
      )}

      {/* Top exercises */}
      {topExercises.length > 0 && (
        <div>
          <GoldSectionLabel style={{ marginBottom: 14 }}>TOP EXERCISES</GoldSectionLabel>
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
          const weekNum = Math.floor(Math.round((sDate - startMon) / 86400000) / 7) + 1;
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
          Filter{filterCount > 0 && <span style={{ background: UI.gold, color: 'var(--accent-ink)', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700 }}>{filterCount}</span>}
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
              // Group by the same field the list is sorted on (ended), not the
              // start date, or a session whose start/ended fall in different week
              // buckets flips the header back and emits a duplicate group key.
              const group = getGroup((s.ended || s.date).slice(0, 10));
              const firstInGroup = group !== lastGroup;
              if (firstInGroup) { items.push({ type: 'header', label: group, key: `h-${group}`, isFirst: items.length === 0 }); lastGroup = group; }
              items.push({ type: 'session', session: s, key: s.id, firstInGroup });
            });
            return items.map(item => {
              if (item.type === 'header') {
                return (
                  <GoldSectionLabel key={item.key} style={{ marginTop: item.isFirst ? 6 : 24 }}>
                    {item.label}
                  </GoldSectionLabel>
                );
              }
              const s = item.session;
              const setsLogged = LB.doneSetCount(s);
              const vol = LB.totalVolume(s, store.exercises, store.dailyLogs);
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
                          style={{ fontSize: 21, color: UI.ink, lineHeight: 1.1, marginBottom: 4, display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}
                          onClick={hasCharts ? e => { e.stopPropagation(); setEffortChart({ dayId: s.dayId, dayName: s.dayName }); } : undefined}
                        >
                          {s.dayName}
                          {s.isBonus && <span style={{ fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: UI.gold, background: 'rgba(var(--accent-rgb), 0.12)', border: `0.5px solid rgba(var(--accent-rgb), 0.3)`, borderRadius: 4, padding: '3px 6px' }}>BONUS</span>}
                          {s.isDeload && <span style={{ fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: UI.inkSoft, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '3px 6px' }}>DELOAD</span>}
                          {/* Ran under autoregulation / a mesocycle (mesoRecap captures the mode
                              at the time, so the badge stays right even if the plan changed since). */}
                          {s.mesoRecap && <span style={{ fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: UI.gold, background: 'rgba(var(--accent-rgb), 0.12)', border: `0.5px solid rgba(var(--accent-rgb), 0.3)`, borderRadius: 4, padding: '3px 6px' }}>{s.mesoRecap.meso ? 'MESO' : 'AUTO'}</span>}
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
        const du = LB.cardioDistUnit();
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
                    return <GoldSectionLabel key={item.key} style={{ marginTop: item.isFirst ? 6 : 24 }}>{item.label}</GoldSectionLabel>;
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
                            {l.distanceM != null && <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{LB.mToDisplay(l.distanceM, du)}<span style={{ fontSize: 9 }}>{du}</span></span>}
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
          cursor: 'pointer', outline: 'none', colorScheme: ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark') ? 'light' : 'dark',
        });
        const selWrap = { position: 'relative' };
        const selChevron = { position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 10, color: UI.inkFaint };
        return (
          <Sheet open={true} onClose={() => setFiltersOpen(false)} title="Filter" titleColor="var(--accent)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <GoldSectionLabel style={{ color: UI.gold }}>PLAN</GoldSectionLabel>
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
                  <GoldSectionLabel style={{ color: UI.gold }}>CYCLE / WEEK</GoldSectionLabel>
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
                  <GoldSectionLabel style={{ color: UI.gold }}>DAY</GoldSectionLabel>
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
      {effortChart && <WorkoutEffortSheet dayId={effortChart.dayId} dayName={effortChart.dayName} sessions={sessions} exercises={store.exercises} dailyLogs={store.dailyLogs} onClose={() => setEffortChart(null)} />}
    </Screen>
  );
}

// ─── FEEL ────────────────────────────────────────────────────────────
// color: tuned for a dark canvas. colorLight: same hue, deep enough to stay
// readable on light/paper's near-white surfaces (the bright set drops well
// under WCAG AA there).
const FEEL_LEVELS = [
  { key: 'easy',      label: 'EASY',      color: '#38bdf8', colorLight: '#0369a1' },
  { key: 'good',      label: 'GOOD',      color: '#4ade80', colorLight: '#15803d' },
  { key: 'hard',      label: 'HARD',      color: '#facc15', colorLight: '#a16207' },
  { key: 'very_hard', label: 'VERY HARD', color: '#f97316', colorLight: '#c2410c' },
  { key: 'max',       label: 'MAX',       color: '#ef4444', colorLight: '#b91c1c' },
];

// Generic light-canvas detector (works for 'light', 'paper', or any future
// light theme) — perceived luminance of the live --bg-rgb, no theme-name
// checks to keep in sync.
function isLightCanvasActive() {
  const parts = (getComputedStyle(document.documentElement).getPropertyValue('--bg-rgb') || '').trim().split(',').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  return (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) > 140;
}
function feelColorOf(f) {
  return f ? (isLightCanvasActive() ? f.colorLight : f.color) : UI.inkFaint;
}
function feelColor(key) {
  return feelColorOf(FEEL_LEVELS.find(f => f.key === key));
}
function feelLabel(key) {
  return FEEL_LEVELS.find(f => f.key === key)?.label ?? null;
}

const FEEL_ICONS = {
  easy: 'fa-face-smile',
  good: 'fa-bolt',
  hard: 'fa-fire',
  very_hard: 'fa-skull',
  max: 'fa-trophy',
};

function FeelSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {FEEL_LEVELS.map(f => {
        const active = value === f.key;
        const fc = feelColorOf(f);
        return (
          <button key={f.key} onClick={() => onChange(active ? null : f.key)}
            style={{
              flex: 1, padding: '9px 2px', borderRadius: 4, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              border: `1px solid ${active ? fc : UI.hairStrong}`,
              background: active ? `${fc}22` : 'transparent',
              color: active ? fc : UI.inkSoft,
              fontFamily: UI.fontUi, fontSize: 9, fontWeight: active ? 600 : 400,
              letterSpacing: '0.07em', WebkitTapHighlightColor: 'transparent',
            }}>
            <i className={`fa-solid ${FEEL_ICONS[f.key]}`} style={{ fontSize: 15 }} />
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

// Sessions eligible for comparison against `s`: same dayId, ended, excluding
// itself — newest first. Deload sessions excluded for the same reason as
// prevEntryMap below (artificially light, not a fair comparison baseline).
// Shared by the Compare button (SessionDetailScreen) and the session picker
// (SessionCompareScreen).
function sameDaySessions(sessions, s) {
  return sessions
    .filter(x => x.ended && x.id !== s.id && x.dayId === s.dayId && !x.isDeload)
    .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));
}

// ─── SESSION DETAIL ──────────────────────────────────────────────────
function SessionDetailScreen({ store, setStore, go, sessionId, justFinished, back, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [editing, setEditing] = useStateL(false);
  const [capturing, setCapturing] = useStateL(false);
  const [feelOpen, setFeelOpen] = useStateL(false);
  const [recapOpen, setRecapOpen] = useStateL(false);
  const [recapFbOpen, setRecapFbOpen] = useStateL(false); // "Feedback given" collapsible in the recap sheet
  const [recapGainsOpen, setRecapGainsOpen] = useStateL(false); // "Changes earned" collapsible in the recap sheet
  const [fbEdit, setFbEdit] = useStateL(null); // open meso-feedback edit picker: { type, subject, name, sel, pump, volume }
  const [tplFormOpen, setTplFormOpen] = useStateL(false);
  const [tplName, setTplName] = useStateL('');
  const [tplSaved, setTplSaved] = useStateL(false);
  const captureRef = useRefL(null);
  // Screenshot watermark: VIPs get their home-screen background image instead of the default ZANE mark.
  const _shotLogo = store.settings?.vipBackground || 'icons/zane-logo-2.png';
  const _shotIsCustom = _shotLogo !== 'icons/zane-logo-2.png';
  // Centered, faint, full-page background watermark, the two-column export's own
  // size (its actual size is computed and set in px by captureNodeAsPng's
  // data-shot-fill handling, not by CSS here, see the comment there for why).
  const _shotIsLight = ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark');
  const _shotDefaultStyle = { opacity: _shotIsLight ? 0.10 : 0.06, filter: _shotIsLight ? 'grayscale(1)' : 'grayscale(1) brightness(3)' };
  const _shotCustomStyle = { opacity: 0.13 };
  const _shotIsPaper = (store.settings?.darkMode ?? 'dark') === 'paper';
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
  const vol = LB.totalVolume(s, store.exercises, store.dailyLogs);
  const duration = s.durationMinutes != null
    ? s.durationMinutes
    : (s.ended && (s.startedAt ?? s.date) ? Math.round((new Date(s.ended) - new Date(s.startedAt ?? s.date)) / 60000) : null);

  const setFeel = (feel) => {
    setStore(st => ({ ...st, sessions: st.sessions.map(x => x.id === sessionId ? { ...x, feel } : x) }));
  };

  const saveAsTemplate = () => {
    const name = tplName.trim();
    if (!name) return;
    const exercises = (s.entries || []).map(e => {
      // Time-based entry: derive per-set duration targets from the logged sets
      // so a template built from this session carries the times along (there is
      // no editor UI authoring timeSecPerSet yet, this IS the authoring path).
      const times = (e.sets || []).filter(st => !st.warmup).map(st => st.timeSec ?? null);
      return {
        exId: e.exId, name: e.name,
        sets: e.plannedSets || (e.sets || []).filter(st => !st.warmup).length || 3,
        reps: e.plannedReps ?? null,
        repsPerSet: e.plannedRepsPerSet ?? null,
        repsMax: e.plannedRepsMax ?? null,
        progressionOffset: e.plannedProgressionOffset ?? null,
        supersetGroup: e.supersetGroup ?? null,
        ...(Array.isArray(e.plannedTechniques) && e.plannedTechniques.some(Boolean) ? { plannedTechniques: e.plannedTechniques } : {}),
        ...(times.some(t => t != null) ? { timeSecPerSet: times } : {}),
      };
    });
    const tpl = { id: LB.uid(), name, exercises, createdAt: new Date().toISOString() };
    setStore(st => ({ ...st, workoutTemplates: [tpl, ...(st.workoutTemplates || [])] }));
    setTplFormOpen(false);
    setTplSaved(true);
  };

  const deleteSession = async () => {
    if (!await confirm('This session will be permanently deleted.', { title: 'Delete session?', ok: 'Delete', danger: true })) return;
    // Roll back the meso weight boost / rep-miss counts this session earned, so a
    // re-log (the common "delete, then log again with feedback" flow) doesn't seed
    // on an older, lower weight with that orphaned boost still stacked on top. Both
    // the store copy (DB / cross-device) and the per-plan localStorage cache must
    // move together and be freshly stamped, or getMesoState would keep preferring
    // the stale finished-session copy by updatedAt.
    // Skip the meso rollback while a session for this plan is in progress: it owns
    // the localStorage meso cache and will flush its own state at finish, so a
    // stale rewrite here would corrupt it (mirrors isMesoSessionEditable).
    const liveForPlan = store.sessions.some(x => x && !x.ended && x.scheduleId === s.scheduleId);
    const doMesoRollback = !!(s.scheduleId && !s.isFreestyle && !liveForPlan
      && (store.mesoStates || []).some(m => m.scheduleId === s.scheduleId));
    // A windowed session renders with entries:[] until a lazy fetch resolves;
    // revertMesoSessionBoosts needs the entries to build its exId keys, so load
    // them first (falls through to a harmless no-op rollback if the fetch fails).
    let delSession = s;
    if (doMesoRollback && (s.aggExercises || 0) > 0 && !(s.entries || []).length) {
      try {
        const bySession = await LB.fetchSessionEntries([sessionId]);
        if (bySession && bySession[sessionId] && bySession[sessionId].length) delSession = { ...s, entries: bySession[sessionId] };
      } catch {}
    }
    // Compose the boost-rollback on the FRESHEST row INSIDE the updater: the await above
    // (and any concurrent same-plan sync) can stale the closed-over row, and the old code
    // wrote both localStorage and the store row from that stale copy, silently reverting a
    // concurrent update. Read the fresh row + fresh remaining sessions here. #C
    setStore(st => {
      const base = {
        ...st,
        sessions: st.sessions.filter(x => x.id !== sessionId),
        cardioLogs: (st.cardioLogs || []).filter(l => l.sessionId !== sessionId),
      };
      if (!doMesoRollback) return base;
      const cur = (st.mesoStates || []).find(m => m.scheduleId === s.scheduleId);
      if (!cur) return base;
      const reverted = LB.revertMesoSessionBoosts(cur, delSession, base.sessions);
      if (!reverted || reverted === cur) return base;
      const stamped = { ...reverted, updatedAt: new Date().toISOString() };
      try { localStorage.setItem(MESO_KEY + '-' + s.scheduleId, JSON.stringify(stamped)); } catch {}
      return { ...base, mesoStates: (st.mesoStates || []).map(m => m.id === cur.id ? stamped : m) };
    });
    go({ name: 'hist' });
  };

  // ── Post-hoc meso feedback editing ──
  // Toned option chip, identical to the live capture sheet (screens-train.jsx): calm at
  // rest (neutral ink label + hairline border), the answer's semantic tone reveals only
  // when selected. Keep in sync with the live sheet by hand.
  const TONE_RGB = { ok: '--ok-rgb', warn: '--warn-rgb', danger: '--danger-rgb', accent: '--accent-rgb' };
  const TONE_COL = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', accent: 'var(--accent)' };
  const toneBtn = (tone, sel, extra) => ({
    padding: '12px 8px', borderRadius: 6, cursor: 'pointer', textAlign: 'center', WebkitTapHighlightColor: 'transparent',
    background: sel ? `rgba(var(${TONE_RGB[tone]}),0.14)` : UI.bgInset,
    border: `1px solid ${sel ? `rgba(var(${TONE_RGB[tone]}),0.7)` : UI.hairStrong}`,
    ...(extra || {}),
  });
  const toneLbl = (tone, sel) => ({ fontFamily: UI.fontUi, fontSize: 13, fontWeight: sel ? 700 : 600, color: sel ? TONE_COL[tone] : UI.ink });
  // The meso state for this session's plan (DB-synced copy; no live session can
  // be open when a session is editable, so the localStorage cache and this agree).
  const sessionMeso = s.scheduleId ? (store.mesoStates || []).find(m => m.scheduleId === s.scheduleId) : null;
  const fbRaw = s.mesoRecap && s.mesoRecap.raw ? s.mesoRecap.raw : null;
  const fbEditable = LB.isMesoSessionEditable(s, store.sessions, sessionMeso);
  const fbLoadOnly = !!(s.mesoRecap && s.mesoRecap.loadOnly);
  // Feedback rows built from the durable raw answers (so each row carries its own
  // type + subject/exId to edit), grouped by muscle in this session's workout
  // order. Only used for the editable card; the read-only card keeps the stored
  // display strings. primaryMuscleForExercise is a screens-train.jsx global.
  const fbEditRows = () => {
    if (!fbRaw || !fbRaw.answers) return [];
    const a = fbRaw.answers;
    const muscleOf = (exId) => (typeof primaryMuscleForExercise === 'function'
      ? primaryMuscleForExercise(store.exercises?.find(x => x.id === exId)) : null);
    const order = [], seen = new Set();
    (s.entries || []).forEach(e => {
      if (e.isCardio) return;
      const pm = muscleOf(e.exId);
      if (pm && !seen.has(pm)) { seen.add(pm); order.push(pm); }
    });
    const wLbl = mesoVolumeLbl(true);    // weight-feel labels
    const workLbl = mesoVolumeLbl(false); // workload labels
    const groups = [];
    order.forEach(muscle => {
      const rows = [];
      const sRec = a.soreness && a.soreness[muscle];
      if (sRec && sRec.answer != null) rows.push({ type: 'soreness', subject: muscle, name: 'Soreness', sub: MESO_SORENESS_LBL[sRec.answer] || sRec.answer, sel: sRec.answer });
      (s.entries || []).forEach(e => {
        if (e.isCardio || muscleOf(e.exId) !== muscle) return;
        const jRec = a.joint && a.joint[e.exId];
        if (!jRec || jRec.answer == null) return;
        // Per-exercise feedback: joint + weight-feel + pump, all edited together in the
        // joint sheet (mirrors screens-train.jsx mesoRecapGroups). Old sessions that
        // predate the per-exercise move simply carry no weight/pump here.
        const parts = [MESO_JOINT_LBL[jRec.answer] || jRec.answer];
        if (jRec.weight != null) parts.push(wLbl[jRec.weight] || jRec.weight);
        if (jRec.pump != null) parts.push(MESO_PUMP_LBL[jRec.pump] || jRec.pump);
        if (jRec.affinity != null) parts.push(MESO_AFFINITY_LBL[jRec.affinity] || jRec.affinity);
        rows.push({ type: 'joint', subject: e.exId, name: jRec.exName || e.name, sub: parts.join(' · '), sel: jRec.answer, weight: jRec.weight ?? null, pump: jRec.pump ?? null, affinity: jRec.affinity ?? null });
      });
      const vRec = a.volume && a.volume[muscle];
      // Per-muscle workload row (Volume+Load / non-final Meso weeks); drives set deltas.
      if (vRec && vRec.volume != null) {
        rows.push({ type: 'volume', subject: muscle, name: 'Workload', sub: workLbl[vRec.volume] || vRec.volume, volume: vRec.volume });
      }
      if (rows.length) groups.push({ muscle, rows });
    });
    return groups;
  };
  // Objective per-exercise earn inputs (exId, key, muscle, allHit, increment) for
  // this session, mirroring computeMesoGains' earn loop, so a feedback edit can
  // re-earn weight boosts. Rep-miss cuts are preserved inside the pure helper.
  // Known limitation (autoreg-v2-spec.md 13.2, accepted): this scores the SEALED session
  // while computeMesoGains scored PRE-seal, so a set with reps entered but never marked done
  // (finish() seals it skipped) can flip allHit/earlyMiss here. Rare edge, one increment.
  const fbEarnInputs = () => {
    const unit = store.settings?.unit || 'kg';
    const out = [];
    (s.entries || []).forEach(e => {
      if (e.isCardio || !e.exId) return;
      const ex = store.exercises?.find(x => x.id === e.exId);
      const muscle = typeof primaryMuscleForExercise === 'function' ? primaryMuscleForExercise(ex) : null;
      const workingSets = (e.sets || []).filter(st => !st.warmup && !st.skipped);
      // attempted mirrors computeMesoGains' `!workingSets.some(done) continue` guard:
      // an untouched exercise is neither a hit nor a rep miss and must not move the streak.
      const attempted = workingSets.length > 0 && workingSets.some(st => st.done);
      const outcome = LB.mesoRepOutcome(workingSets, e.plannedReps ?? null, e.plannedRepsPerSet, e.plannedRepsMax ?? null);
      const allHit = attempted && outcome.allHit;
      const earlyMiss = attempted && outcome.earlyMiss; // feeds the rep-miss cut recompute
      const catCfg = ex?.equipment ? (store.settings?.equipmentConfig?.[ex.equipment] ?? {}) : {};
      const increment = catCfg.increment ?? (unit === 'lbs' ? 5 : 2.5);
      out.push({ exId: e.exId, key: e.exId + '_' + s.dayId, muscle, allHit, earlyMiss, attempted, increment, name: e.name });
    });
    return out;
  };
  // Rebuild the display groups (read-only shape { muscle, general[], joint[] }) so
  // the stored recap matches the edited answers on the next render / boot.
  const fbGroupsForStore = (answers) => {
    const muscleOf = (exId) => (typeof primaryMuscleForExercise === 'function'
      ? primaryMuscleForExercise(store.exercises?.find(x => x.id === exId)) : null);
    const order = [], seen = new Set();
    (s.entries || []).forEach(e => { if (e.isCardio) return; const pm = muscleOf(e.exId); if (pm && !seen.has(pm)) { seen.add(pm); order.push(pm); } });
    const wLbl = mesoVolumeLbl(true), workLbl = mesoVolumeLbl(false);
    const groups = [];
    order.forEach(muscle => {
      const general = [], joint = [];
      const sRec = answers.soreness && answers.soreness[muscle];
      if (sRec && sRec.answer != null) general.push({ title: 'Soreness', sub: MESO_SORENESS_LBL[sRec.answer] || sRec.answer });
      (s.entries || []).forEach(e => {
        if (e.isCardio || muscleOf(e.exId) !== muscle) return;
        const jRec = answers.joint && answers.joint[e.exId];
        if (!jRec || jRec.answer == null) return;
        const parts = [MESO_JOINT_LBL[jRec.answer] || jRec.answer];
        if (jRec.weight != null) parts.push(wLbl[jRec.weight] || jRec.weight);
        if (jRec.pump != null) parts.push(MESO_PUMP_LBL[jRec.pump] || jRec.pump);
        if (jRec.affinity != null) parts.push(MESO_AFFINITY_LBL[jRec.affinity] || jRec.affinity);
        joint.push({ title: jRec.exName || e.name, sub: parts.join(' · '), sel: jRec.answer, weight: jRec.weight ?? null, pump: jRec.pump ?? null, affinity: jRec.affinity ?? null });
      });
      const vRec = answers.volume && answers.volume[muscle];
      if (vRec && vRec.volume != null) general.push({ title: 'Workload', sub: workLbl[vRec.volume] || vRec.volume });
      if (general.length || joint.length) groups.push({ muscle, general, joint });
    });
    return groups;
  };
  const saveFeedbackEdit = (edit) => {
    if (!sessionMeso || !fbRaw) { setFbEdit(null); return; }
    // Readiness edit: change the session's readiness + signalWeight, and RESPECT the
    // new signalWeight so it is not cosmetic. A full->discounted edit freezes the
    // rep-miss cut (drops this session's -increment and restores the frozen streak);
    // discounted->full re-enables it. The EARN side stays allowed on discounted, so
    // it is re-earned unchanged from the (untouched) answers. There is no answer-record
    // diff here, so bypass applyMesoFeedbackEdit entirely.
    if (edit.type === 'readiness') {
      const readiness = edit.readiness;
      // Editable sessions are never deload (isMesoSessionEditable excludes it), so the
      // map is rough/reentry -> discounted, else full. Mirrors chooseReadiness.
      // Mirror the live scoring (LB.deriveSignalWeight): a session stamped 'none' whose
      // deload ended mid-session scored 'full' live, so oldSignal must re-derive too,
      // else recomputeMesoRepMissCut would compute the wrong cut flip. Editable sessions
      // are never deload (isMesoSessionEditable excludes them). #D
      const oldSignal = LB.deriveSignalWeight(s, !!s.isDeload);
      const newSignal = (readiness === 'rough' || readiness === 'reentry') ? 'discounted' : 'full';
      const earnInputs = fbEarnInputs();
      const repMissBase = fbRaw.repMissBase || null;
      const groups = fbGroupsForStore(fbRaw.answers);
      // Recompute the CUT + re-earn on the FRESHEST mesoStates row INSIDE the updater:
      // a background multi-device sync may have landed a newer row (e.g. fresh
      // autoregState landmarks) since this sheet opened, and recompute/reearn spread
      // the row through (...meso). Composing on the stale render-closure `sessionMeso`
      // and writing it back wholesale would revert those concurrent fields. #3
      setStore(st => {
        const cur = (st.mesoStates || []).find(m => m.id === sessionMeso.id) || sessionMeso;
        // 1. Recompute the CUT for the signalWeight flip (no-op on a same-side edit).
        const cutMeso = LB.recomputeMesoRepMissCut(cur, earnInputs, repMissBase, oldSignal, newSignal);
        // 2. Re-earn the EARN side from the unchanged answers (discounted still earns);
        //    reearn preserves a re-armed cut and drops a frozen one.
        const newMeso = LB.reearnMesoBoostsFromAnswers(cutMeso, fbRaw.answers, earnInputs, fbLoadOnly);
        const composedMeso = { ...newMeso, updatedAt: new Date().toISOString() };
        const gains = LB.mesoRecapGainsFromEdit(fbRaw.answers, composedMeso.weightBoosts, earnInputs, s.dayId);
        const newRecap = { ...s.mesoRecap, groups, gains, raw: fbRaw };
        // Write the per-plan localStorage cache in lockstep with the row (same fresh
        // updatedAt), INSIDE the updater so it is atomic with the store write and can
        // never be skipped by a deferred updater (mirrors saveMesoState's own in-updater
        // localStorage write). getMesoState then never masks the edit with a stale cache.
        if (typeof MESO_KEY === 'string') {
          try { localStorage.setItem(MESO_KEY + '-' + s.scheduleId, JSON.stringify(composedMeso)); } catch {}
        }
        return {
          ...st,
          mesoStates: (st.mesoStates || []).map(m => m.id === sessionMeso.id ? composedMeso : m),
          sessions: st.sessions.map(x => x.id === sessionId ? { ...x, readiness, signalWeight: newSignal, mesoRecap: newRecap } : x),
        };
      });
      setFbEdit(null);
      return;
    }
    // Autoreg v2 P1 MRV cap: re-run the stateless overreach detector so a post-hoc
    // edit freezes a positive set-add for an at-ceiling muscle exactly like the
    // live session would have (spec 2.2 / 2.3). typeof-guarded: primaryMuscleForExercise
    // is a screens-train.jsx global that may not be loaded in every context.
    const muscleOf = (exId) => (typeof primaryMuscleForExercise === 'function'
      ? primaryMuscleForExercise(store.exercises?.find(x => x.id === exId)) : null);
    const editSch = store.schedules?.find(x => x.id === s.scheduleId) || null;
    // Compute at-ceiling over PRIOR exposures, EXCLUDING the edited session itself. The
    // live session decided its freezes over endedSessions while it was still in-progress
    // (so its OWN hard sets were not yet counted); store.sessions now contains it as an
    // ended session, so including it would flip a muscle to at-ceiling that was NOT
    // capped live and silently strip a set the live session granted. #A
    const priorSessions = (store.sessions || []).filter(x => x.id !== sessionId);
    const overreach = editSch ? LB.detectOverreach(priorSessions, editSch, muscleOf) : {};
    const atCeilingMuscles = new Set(Object.keys(overreach).filter(m => overreach[m] && overreach[m].atCeiling));
    // Autoreg v2 P3 numeric MRV cap: also freeze a muscle whose banked current-
    // microcycle volume has reached its learned MRV (mirror of the live atCeiling
    // helper). Degrades to detector-only when landmarks/mrv is absent.
    const cycleSets = editSch ? LB.microcycleSetsByMuscle(priorSessions, editSch, muscleOf, {
      which: 0, todayStr: LB.todayISO(),
      startDate: sessionMeso?.startDate, startedAt: sessionMeso?.startedAt,
      startCycleIndex: sessionMeso?.startCycleIndex, cycleIndex: store.cycleIndex,
      statusPeriods: store.statusPeriods, cycleStartDate: store.cycleStartDate,
    }) : {};
    const landmarks = sessionMeso?.autoregState?.landmarks || {};
    Object.keys(landmarks).forEach(m => {
      const lm = landmarks[m];
      if (lm && lm.mrv != null && (cycleSets[m] || 0) >= lm.mrv) atCeilingMuscles.add(m);
    });
    const ctx = { dayId: s.dayId, loadOnly: fbLoadOnly, atCeilingMuscles };
    const earnInputs = fbEarnInputs();
    // Apply the edit + re-earn on the FRESHEST mesoStates row INSIDE the updater (same
    // reasoning as the readiness branch above, #3): a background multi-device sync may
    // have landed a newer row since the sheet opened, and applyMesoFeedbackEdit /
    // reearnMesoBoostsFromAnswers spread the row through (...meso). Composing on the
    // stale render-closure `sessionMeso` and writing it back wholesale would revert
    // those concurrent fields. localStorage is written inside so it stays atomic with
    // the store write (mirrors saveMesoState).
    setStore(st => {
      const cur = (st.mesoStates || []).find(m => m.id === sessionMeso.id) || sessionMeso;
      const r1 = LB.applyMesoFeedbackEdit(cur, fbRaw, edit, ctx);
      const newMeso = LB.reearnMesoBoostsFromAnswers(r1.mesoState, r1.raw.answers, earnInputs, fbLoadOnly);
      const stampedMeso = { ...newMeso, updatedAt: new Date().toISOString() };
      const gains = LB.mesoRecapGainsFromEdit(r1.raw.answers, stampedMeso.weightBoosts, earnInputs, s.dayId);
      const groups = fbGroupsForStore(r1.raw.answers);
      const newRecap = { ...s.mesoRecap, groups, gains, raw: r1.raw };
      if (typeof MESO_KEY === 'string') {
        try { localStorage.setItem(MESO_KEY + '-' + s.scheduleId, JSON.stringify(stampedMeso)); } catch {}
      }
      return {
        ...st,
        mesoStates: (st.mesoStates || []).map(m => m.id === sessionMeso.id ? stampedMeso : m),
        sessions: st.sessions.map(x => x.id === sessionId ? { ...x, mesoRecap: newRecap } : x),
      };
    });
    setFbEdit(null);
  };

  // Toggle a single earned weight boost's decline from the recap's "Changes
  // earned" list, after the fact. Only offered while fbEditable (this session
  // is still the plan's top-of-stack session, same gate saveFeedbackEdit
  // already trusts for rewriting weightBoosts wholesale) so a misclick has a
  // way back without needing the mid-session toast again a week later, and so
  // toggling here can never land on a key a later session has already moved
  // on from. Same freshest-row-inside-the-updater pattern as saveFeedbackEdit.
  const toggleGainDecline = (key) => {
    if (!fbEditable || !key) return;
    setStore(st => {
      const cur = (st.mesoStates || []).find(m => m.id === sessionMeso.id) || sessionMeso;
      const prevDeclines = cur.weightBoostDeclines || {};
      const nextDeclines = { ...prevDeclines };
      if (nextDeclines[key]) delete nextDeclines[key]; else nextDeclines[key] = true;
      const composedMeso = { ...cur, weightBoostDeclines: nextDeclines, updatedAt: new Date().toISOString() };
      if (typeof MESO_KEY === 'string') {
        try { localStorage.setItem(MESO_KEY + '-' + s.scheduleId, JSON.stringify(composedMeso)); } catch {}
      }
      return { ...st, mesoStates: (st.mesoStates || []).map(m => m.id === sessionMeso.id ? composedMeso : m) };
    });
  };

  // Toggle a Smart Progression bump's declined flag, recorded on THIS session
  // (session-local, never synced, see store.js sessionToRow) the moment the
  // "PROGRESSION UNLOCKED" toast is answered, either way (Hell yeah or
  // Decline). Bidirectional, same as the Meso "Changes earned" chip: an
  // accepted bump can be declined after the fact and vice versa, any number
  // of times, not just a one-shot undo. Only exposed while it would still
  // matter: no LATER session has already trained the same exercise on this
  // day, since progressionSuggestion only ever consults the MOST RECENT
  // session for a given exId/dayId (recentSessionsForExercise), once a later
  // one exists, this session's flag no longer feeds any seed and toggling it
  // here would be a no-op the user could mistake for a fix.
  const toggleProgressionBump = (key) => {
    setStore(st => ({
      ...st,
      sessions: st.sessions.map(x => {
        if (x.id !== s.id) return x;
        const cur = x.progressionBumps?.[key];
        if (!cur) return x;
        return { ...x, progressionBumps: { ...x.progressionBumps, [key]: { ...cur, declined: !cur.declined } } };
      }),
    }));
  };

  // Deload sessions are deliberately light — comparing against one as "last
  // time" would show every set as a fabricated "improvement" purely because
  // it beats the artificially-reduced deload weights. store.js already
  // excludes deload from lastSessionForExercise/recentSessionsForExercise;
  // this mirrors that exclusion for the same reason.
  const prevEntryMap = {};
  const prevOccSeen = {};
  s.entries.forEach((e, idx) => {
    // The Nth occurrence of an exercise in the day compares against the SAME Nth
    // occurrence of past sessions (audit L3, matching the seed path). Keyed by
    // entry index so a twice-in-a-day exercise's second slot reads its own prev
    // instead of sharing the first slot's.
    const occ = (prevOccSeen[e.exId] = (prevOccSeen[e.exId] == null ? 0 : prevOccSeen[e.exId] + 1));
    const prev = store.sessions
      .filter(x => x.ended && x.id !== s.id && x.ended < s.ended && x.dayId === s.dayId && !x.isDeload)
      .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))
      .find(x => x.entries.filter(en => en.exId === e.exId)[occ]?.sets?.some(st => st.kg != null || st.reps != null));
    prevEntryMap[idx] = prev ? (prev.entries.filter(en => en.exId === e.exId)[occ] ?? null) : null;
  });

  const prevSameDay = store.sessions
    .filter(x => x.ended && x.id !== s.id && x.ended < s.ended && x.dayId === s.dayId && !x.isDeload)
    .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0];
  const volDelta = prevSameDay != null ? vol - LB.totalVolume(prevSameDay, store.exercises, store.dailyLogs) : null;
  const compareCandidates = sameDaySessions(store.sessions, s);

  const exIsUnilateral = (exId) => !!store.exercises.find(x => x.id === exId)?.unilateral;
  const prReps = (st, exId) => exIsUnilateral(exId)
    ? Math.min(st.repsL ?? 0, st.repsR ?? 0)
    : (st.reps ?? 0);
  const prRepsValid = (st, exId) => exIsUnilateral(exId)
    ? (st.repsL != null && st.repsR != null)
    : st.reps != null;

  // e1RM-based comparison (not raw kg-then-reps) so e.g. 100kg×5 correctly
  // loses to a prior 90kg×10 — matches the PR logic used everywhere else
  // (store.js bestE1rmForExercise). Deload sessions are excluded as a PR
  // baseline for the same reason as prevEntryMap above. The `x.ended < s.ended`
  // cutoff is deliberately kept (instead of reusing bestE1rmForExercise, which
  // has no such cutoff) so a session's PR status reflects only what was known
  // at the time it happened, not later sessions bleeding backward into it.
  // Per-exercise "best" ranking value on a per-type scale: weighted → e1RM,
  // assisted → least-negative load (kg is stored negative), reps-only → reps,
  // time → seconds. The maps are keyed by exId, so every value for one exId
  // shares a scale and comparisons stay valid.
  const prValueOf = (st, exId) => {
    if (!st.done) return null;
    const exObj = store.exercises.find(x => x.id === exId);
    if (LB.isAssisted(exObj)) return st.kg != null ? st.kg : null;
    if (LB.exerciseLogMode(exObj) === 'time') return st.timeSec ?? null;
    if (st.kg == null) { const r = LB.effReps(st); return (r != null && r > 0) ? r : null; }
    if (!prRepsValid(st, exId)) return null;
    return LB.e1rm(st.kg, prReps(st, exId));
  };
  const prMap = {};
  store.sessions.filter(x => x.ended && x.id !== s.id && x.ended < s.ended && !x.isDeload).forEach(sess =>
    sess.entries.forEach(e => e.sets.forEach(st => {
      const val = prValueOf(st, e.exId);
      if (val == null || !(val > (prMap[e.exId] ?? -Infinity))) return;
      prMap[e.exId] = val;
    }))
  );
  const sessionBestMap = {};
  s.entries.forEach(e => e.sets.forEach(st => {
    const val = prValueOf(st, e.exId);
    if (val == null || !(val > (sessionBestMap[e.exId] ?? -Infinity))) return;
    sessionBestMap[e.exId] = val;
  }));
  const isPR = (st, exId) => {
    const val = prValueOf(st, exId);
    if (val == null) return false;
    const sessionBest = sessionBestMap[exId];
    if (sessionBest == null || val !== sessionBest) return false;
    const best = prMap[exId];
    // No prior history for this exercise at all, nothing to beat, so the
    // first-ever session with it isn't a PR (matches the two other isPR
    // implementations in this file, which both gate on pr > 0).
    return best != null && val > best;
  };

  const muscleGroups = [...new Set(
    s.entries.flatMap(e => store.exercises.find(x => x.id === e.exId)?.tags || []).filter(Boolean)
  )];

  // A long session switches the export to a two-column grid instead of one very
  // tall column. groupBySuperset is cheap (already called again below for the real
  // render) and gives the true count of vertically-stacked blocks, a superset
  // counts once, not per member. Independent of `capturing`: takeScreenshot below
  // must decide `fitWidth` at CLICK time, while `capturing` is still false (it only
  // flips true inside captureNodeAsPng, after the click already fired), so this
  // can't gate on `capturing` the way `twoCol` (the render-time styling flag) does.
  const willBeTwoCol = LB.groupBySuperset(s.entries).length >= SHOT_TWO_COL_THRESHOLD;
  // Only while actually capturing (never in the live, single-column scrolling view).
  const twoCol = capturing && willBeTwoCol;

  const takeScreenshot = () => captureNodeAsPng(captureRef.current, {
    filename: `${s.dayName}-${s.date.slice(0, 10)}.png`,
    setCapturing,
    // The two-column export is intentionally wider than the phone viewport (see the
    // `twoCol` capture treatment below); without this, html2canvas only captures
    // whatever width fits the current window instead of the full wider layout.
    fitWidth: willBeTwoCol,
    // Single column keeps the small corner watermark (needs dodging so chip rows /
    // knurl dividers don't bleed into it); the wider two-column export switches to a
    // centered full-page mark instead (see the `twoCol` capture treatment below),
    // which is faint enough to need no dodging, matching SessionCompareScreen / the
    // plan poster's own precedent.
    dodgeAvatar: !willBeTwoCol,
  });

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

      <div ref={captureRef} style={{
        padding: capturing ? '20px 22px 24px' : '14px 22px 28px',
        // The CSS grid (--bg-texture) never survives html2canvas — always off
        // while capturing, SvgPaperGrid below draws the paper-theme grid for
        // the export instead (works for html2canvas, unlike the CSS version).
        backgroundColor: UI.bg, backgroundImage: capturing ? 'none' : 'var(--bg-texture)', position: 'relative',
        // Escape #root's phone-shaped max-width (index.html) so the wider two-column
        // export isn't clipped: position:fixed is positioned against the viewport, not
        // any ancestor, as long as no ancestor between here and #root sets a transform/
        // filter/contain (none do). Same technique the plan-poster export uses, just
        // applied to this shared live/capture node directly instead of a separate
        // always-mounted overlay, so twoCol toggling never remounts (and re-refs) this
        // node out from under an in-flight captureNodeAsPng call. Overrides the base
        // position:relative above (still needed as the watermark's anchor when not
        // twoCol; position:fixed is an equally valid anchor for it).
        ...(twoCol ? { position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', width: SHOT_TWO_COL_WIDTH, zIndex: 500 } : {}),
      }}>

        {capturing && _shotIsPaper && <SvgPaperGrid />}

        {/* Two-column only: centered, faint, full-capture watermark (same recipe as
            SessionCompareScreen / the plan poster). Needs its own stacking context
            below the real content, which is why the content right below is wrapped
            in a sibling zIndex:1 div. Single column keeps its small corner mark
            further down instead (near the exercises, see dodgeAvatar above). */}
        {twoCol && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
            <img src={_shotLogo} data-shot-avatar="1" data-shot-fill="1" style={_shotIsCustom ? _shotCustomStyle : _shotDefaultStyle} />
          </div>
        )}

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>

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

        {/* Compare to another session of this same day */}
        {!capturing && compareCandidates.length > 0 && (
          <Btn kind="ghost" onClick={() => go({ name: 'compare', sessionId: s.id, back: { name: 'session', sessionId: s.id, back } })} style={{ width: '100%', marginTop: -8 }}>
            <i className="fa-solid fa-code-compare" style={{ marginRight: 8 }} /> Compare to another session
          </Btn>
        )}

        {/* Autoregulation / mesocycle feedback recap: durable, read straight
            off the session's meso_recap (written at finish). Shows the feedback
            the lifter gave and the weight/set bumps or cuts it earned, so an
            auto / auto-load-only / meso session stays traceable after the fact. */}
        {!capturing && s.mesoRecap && (
          <div style={{ marginTop: -8 }}>
            <Btn kind="ghost" onClick={() => setRecapOpen(true)} style={{ width: '100%' }}>
              <i className="fa-solid fa-clipboard-list" style={{ marginRight: 8 }} /> Feedback recap
              <i className="fa-solid fa-chevron-right" style={{ marginLeft: 8, fontSize: 10 }} />
            </Btn>
          </div>
        )}

        {/* Feedback recap, as a bottom sheet. Structured per muscle group like the
            in-session review: General feedback (Soreness, and Workload in Volume+Load /
            Meso) and Per exercise (joint + weight + pump + affinity, two-line) split with
            knurled dividers, then the changes it earned. On the latest still-editable
            session every answer is a tap-to-fix row. */}
        {!capturing && s.mesoRecap && recapOpen && (() => {
          const editGroups = fbEditable ? fbEditRows() : null;
          const useEdit = !!(editGroups && editGroups.length);
          const groups = useEdit
            ? editGroups.map(g => ({ muscle: g.muscle, general: g.rows.filter(r => r.type !== 'joint'), joint: g.rows.filter(r => r.type === 'joint') }))
            : (s.mesoRecap.groups || []).map(g => ({ muscle: g.muscle, general: (g.general || []).map(r => ({ name: r.title, sub: r.sub })), joint: (g.joint || []).map(r => ({ name: r.title, sub: r.sub, sel: r.sel, weight: r.weight, pump: r.pump, affinity: r.affinity })) }));
          const modeLabel = s.mesoRecap.loadOnly ? 'Autoregulation · load only'
            : s.mesoRecap.meso ? `Mesocycle${s.mesoRecap.week ? ` · Week ${s.mesoRecap.week}` : ''}`
            : 'Autoregulation';
          // Per-exercise answer as a labelled 4-column grid (Pain / Weight / Pump /
          // Verdict) so it's unambiguous which value is which, instead of one
          // squished "None · Hard · Amazing · Love it" line. Missing answers show
          // a dash. Older recaps without structured values fall back to the line.
          const FB_COLS = ['Pain', 'Weight', 'Pump', 'Verdict'];
          const fbGridCells = (r) => [
            MESO_JOINT_LBL[r.sel] ?? null,
            r.weight != null ? (mesoVolumeLbl(true)[r.weight] ?? r.weight) : null,
            r.pump != null ? (MESO_PUMP_LBL[r.pump] ?? r.pump) : null,
            r.affinity != null ? (MESO_AFFINITY_LBL[r.affinity] ?? r.affinity) : null,
          ];
          const fbRow = (r, key, twoLine) => {
            // Per-exercise rows (joint + weight + pump + affinity) get a two-line layout:
            // the exercise name on its own line (no truncation), the labelled grid beneath.
            // Muscle-level rows (Soreness, Workload) stay one-line name/value.
            if (twoLine) {
              const structured = r.sel != null || r.weight != null || r.pump != null || r.affinity != null;
              const body = (<>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  {useEdit && <i className="fa-solid fa-pen" style={{ fontSize: 9, color: 'var(--accent)', flexShrink: 0 }} />}
                </div>
                {structured ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, marginTop: 7 }}>
                    {fbGridCells(r).map((val, i) => (
                      <div key={i}>
                        <div className="micro" style={{ color: UI.inkFaint, marginBottom: 3 }}>{FB_COLS[i]}</div>
                        <div style={{ fontFamily: UI.fontUi, fontSize: 12.5, color: val ? UI.ink : UI.inkGhost, lineHeight: 1.25 }}>{val || '–'}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.inkSoft, marginTop: 3 }}>{r.sub}</div>
                )}
              </>);
              if (useEdit) {
                return (
                  <button key={key} onClick={() => setFbEdit({ type: r.type, subject: r.subject, name: r.name, sel: r.sel ?? null, weight: r.weight ?? null, pump: r.pump ?? null, affinity: r.affinity ?? null, volume: r.volume ?? null })} style={{
                    width: '100%', padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                  }}>{body}</button>
                );
              }
              return <div key={key} style={{ padding: '7px 0' }}>{body}</div>;
            }
            const label = <span style={{ fontFamily: UI.fontUi, fontSize: 12.5, color: UI.inkFaint, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>;
            if (useEdit) {
              return (
                <button key={key} onClick={() => setFbEdit({ type: r.type, subject: r.subject, name: r.name, sel: r.sel ?? null, weight: r.weight ?? null, pump: r.pump ?? null, affinity: r.affinity ?? null, volume: r.volume ?? null })} style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                  padding: '7px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                }}>
                  {label}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontFamily: UI.fontUi, fontSize: 12.5, color: UI.ink, textAlign: 'right' }}>{r.sub}</span>
                    <i className="fa-solid fa-pen" style={{ fontSize: 9, color: 'var(--accent)' }} />
                  </span>
                </button>
              );
            }
            return (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', alignItems: 'baseline' }}>
                {label}
                <span style={{ fontFamily: UI.fontUi, fontSize: 12.5, color: UI.ink, textAlign: 'right', flexShrink: 0 }}>{r.sub}</span>
              </div>
            );
          };
          const deltaChip = pos => ({
            fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700,
            color: pos ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.9)',
            background: pos ? 'rgba(var(--accent-rgb),0.10)' : 'rgba(var(--danger-rgb),0.10)',
            border: `1px solid ${pos ? 'rgba(var(--accent-rgb),0.28)' : 'rgba(var(--danger-rgb),0.28)'}`,
            borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap',
          });
          const gains = s.mesoRecap.gains || [];
          const collapseCard = { background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12 };
          const collapseHead = { width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent' };
          const collapseTitle = { fontSize: 22, letterSpacing: '0.03em', color: UI.ink, lineHeight: 1 };
          const collapseSub = { fontFamily: UI.fontUi, fontSize: 11.5, color: UI.inkSoft, marginTop: 5 };
          const countPill = { fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'rgba(var(--accent-rgb),0.10)', border: '1px solid rgba(var(--accent-rgb),0.28)', borderRadius: 999, padding: '2px 9px', flexShrink: 0 };
          const chevStyle = { fontSize: 14, color: UI.inkFaint, flexShrink: 0 };
          const groupHeader = label => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
              <span style={{ fontFamily: UI.fontDisplay, fontSize: 19, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: UI.ink, lineHeight: 1 }}>{label}</span>
            </div>
          );
          return (
            <Sheet open={recapOpen} onClose={() => setRecapOpen(false)} title="Feedback recap">
              <div className="micro-gold" style={{ marginTop: -6, marginBottom: 16 }}>{modeLabel}</div>

              {groups.length > 0 && (
                <div style={collapseCard}>
                  <button onClick={() => setRecapFbOpen(o => !o)} style={collapseHead}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="display" style={collapseTitle}>Feedback given</div>
                      <div style={collapseSub}>{useEdit ? 'Tap any answer to fix it' : `${groups.length} muscle ${groups.length === 1 ? 'group' : 'groups'}`}</div>
                    </div>
                    <span style={countPill}>{groups.length}</span>
                    <i className={`fa-solid fa-chevron-${recapFbOpen ? 'up' : 'down'}`} style={chevStyle} />
                  </button>
                  {recapFbOpen && (
                    <div style={{ padding: '2px 12px 12px' }}>
                      {/* Session-level readiness row (above the per-muscle groups). Editing
                          it flips signalWeight and re-runs the cut recompute (saveFeedbackEdit),
                          so it is not cosmetic. Tap-to-fix only on the still-editable session. */}
                      {s.readiness != null && (
                        <div style={{ background: 'rgba(var(--knurl-rgb),0.03)', border: `1px solid ${UI.hair}`, borderRadius: 6, padding: '13px 14px 6px', marginBottom: 8 }}>
                          {groupHeader('Session')}
                          {fbRow({ type: 'readiness', subject: sessionId, name: 'Readiness', sub: MESO_READINESS_LBL[s.readiness] || s.readiness, sel: s.readiness }, 'readiness', false)}
                        </div>
                      )}
                      {groups.map((g, gi) => (
                        <div key={gi} style={{ background: 'rgba(var(--knurl-rgb),0.03)', border: `1px solid ${UI.hair}`, borderRadius: 6, padding: '13px 14px 10px', marginBottom: gi < groups.length - 1 ? 8 : 0 }}>
                          {groupHeader(g.muscle)}
                          {g.general.length > 0 && (<>
                            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>General feedback</div>
                            <div className="knurl" style={{ marginBottom: 4 }} />
                            {g.general.map((r, ri) => fbRow(r, 'g' + ri, false))}
                          </>)}
                          {g.joint.length > 0 && (<>
                            <div className="micro" style={{ color: UI.inkFaint, marginTop: g.general.length ? 14 : 0, marginBottom: 6 }}>Per exercise</div>
                            <div className="knurl" style={{ marginBottom: 4 }} />
                            {g.joint.map((r, ri) => fbRow(r, 'j' + ri, true))}
                          </>)}
                        </div>
                      ))}
                      {fbRaw && !fbEditable && (
                        <div style={{ fontFamily: UI.fontUi, fontSize: 10.5, color: UI.inkGhost, margin: '8px 2px 2px', lineHeight: 1.4 }}>
                          Feedback locked. A newer session on this plan has already advanced autoregulation.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={collapseCard}>
                <button onClick={() => setRecapGainsOpen(o => !o)} style={collapseHead}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="display" style={collapseTitle}>Changes earned</div>
                    <div style={collapseSub}>{gains.length ? `${gains.length} ${gains.length === 1 ? 'exercise' : 'exercises'} moved` : 'No changes this session'}</div>
                  </div>
                  {gains.length > 0 && <span style={countPill}>{gains.length}</span>}
                  <i className={`fa-solid fa-chevron-${recapGainsOpen ? 'up' : 'down'}`} style={chevStyle} />
                </button>
                {recapGainsOpen && (
                  <div style={{ padding: '2px 14px 12px' }}>
                    {gains.length > 0 ? gains.map((item, i) => {
                      const up = (item.weightDelta || 0) !== 0 ? item.weightDelta > 0 : item.setDelta > 0;
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < gains.length - 1 ? `1px solid ${UI.hair}` : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: up ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.9)', flexShrink: 0 }} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                              <span style={{ fontFamily: UI.fontUi, fontSize: 13.5, fontWeight: 600, color: UI.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                              {item.weightDelta < 0 && (
                                <span style={{ fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: UI.inkGhost }}>Reps missed, easing load</span>
                              )}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                            {item.setDelta !== 0 && <span style={deltaChip(item.setDelta > 0)}>{item.setDelta > 0 ? '+' : ''}{item.setDelta} set</span>}
                            {item.weightDelta !== 0 && (() => {
                              // Only a positive weightDelta is ever declinable (set deltas and rep-miss
                              // cuts are out of scope), and only while fbEditable, so this can never
                              // toggle a key a later session has already moved past.
                              const declinable = item.weightDelta > 0 && !!item.key;
                              const declined = declinable && !!sessionMeso?.weightBoostDeclines?.[item.key];
                              const label = declined ? 'Declined' : `${item.weightDelta > 0 ? '+' : ''}${item.weightDelta} ${s.mesoRecap.unit || UI.unit()}`;
                              const chipStyle = declined
                                ? { fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: UI.inkFaint, background: 'rgba(var(--knurl-rgb),0.08)', border: `1px solid ${UI.hair}`, borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap', textDecoration: 'line-through' }
                                : deltaChip(item.weightDelta > 0);
                              return declinable && fbEditable ? (
                                <button onClick={() => toggleGainDecline(item.key)} style={{ ...chipStyle, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>{label}</button>
                              ) : (
                                <span style={chipStyle}>{label}</span>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    }) : (
                      <div style={{ fontFamily: UI.fontUi, fontSize: 12.5, color: UI.inkFaint, padding: '4px 0' }}>
                        No weight or set changes earned this session.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Sheet>
          );
        })()}

        {/* Meso feedback edit picker (post-hoc correction of the last session) */}
        {fbEdit && (
          <Sheet open={!!fbEdit} onClose={() => setFbEdit(null)}
            title={fbEdit.type === 'joint' ? (fbEdit.name || 'Feedback') : fbEdit.type === 'volume' ? 'Workload' : fbEdit.type === 'readiness' ? 'Readiness' : 'Soreness check'}
            titleColor="var(--accent)">
            {fbEdit.type === 'readiness' && (<>
              <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.5 }}>
                How you felt sets how much this session counts. A rough day freezes the load cut (your streak pauses), a full day lets it move. Earn always counts.
              </div>
              {[
                { key: 'fresh', label: 'Fresh', sub: 'Feeling strong, counts in full' },
                { key: 'normal', label: 'Normal', sub: 'A regular day, counts in full' },
                { key: 'rough', label: 'Rough', sub: 'Low on energy, the load cut is frozen, earn still counts' },
              ].map(opt => {
                const sel = fbEdit.sel === opt.key || (fbEdit.sel === 'reentry' && opt.key === 'rough');
                return (
                  <button key={opt.key} onClick={() => setFbEdit(e => ({ ...e, sel: opt.key }))} style={{
                    width: '100%', marginBottom: 8, padding: '12px 14px',
                    background: sel ? 'rgba(var(--accent-rgb),0.12)' : UI.bgInset,
                    border: `1px solid ${sel ? 'var(--accent)' : UI.hairStrong}`, borderRadius: 6, cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                  }}>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: sel ? 'var(--accent)' : UI.ink, fontWeight: 600 }}>{opt.label}</div>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 2 }}>{opt.sub}</div>
                  </button>
                );
              })}
              <Btn disabled={!fbEdit.sel} onClick={() => saveFeedbackEdit({ type: 'readiness', readiness: fbEdit.sel })} style={{ width: '100%', marginTop: 12 }}>Save changes</Btn>
            </>)}
            {fbEdit.type === 'soreness' && (<>
              <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.5 }}>
                Soreness carryover from your last <strong style={{ color: UI.ink }}>{fbEdit.subject}</strong> workout?
              </div>
              {MESO_SORENESS_OPTS.map(opt => {
                const sel = fbEdit.sel === opt.key;
                return (
                  <button key={opt.key} onClick={() => setFbEdit(e => ({ ...e, sel: opt.key }))} style={{
                    width: '100%', marginBottom: 8, padding: '12px 14px',
                    background: sel ? 'rgba(var(--accent-rgb),0.12)' : UI.bgInset,
                    border: `1px solid ${sel ? 'var(--accent)' : UI.hairStrong}`, borderRadius: 6, cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                  }}>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: sel ? 'var(--accent)' : UI.ink, fontWeight: 600 }}>{opt.label}</div>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 2 }}>{opt.sub}</div>
                  </button>
                );
              })}
              <Btn disabled={!fbEdit.sel} onClick={() => saveFeedbackEdit({ type: 'soreness', subject: fbEdit.subject, answer: fbEdit.sel })} style={{ width: '100%', marginTop: 12 }}>Save changes</Btn>
            </>)}
            {fbEdit.type === 'joint' && (<>
              {/* Per-exercise feedback: joints, weight feel and pump, mirroring the live
                  sheet in screens-train.jsx. */}
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Joint pain</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                {[{ key: 'none', label: 'None', tone: 'ok' }, { key: 'noticeable', label: 'Noticeable', tone: 'warn' }, { key: 'sharp', label: 'Sharp pain', tone: 'danger' }].map(opt => {
                  const sel = fbEdit.sel === opt.key;
                  return (
                    <button key={opt.key} onClick={() => setFbEdit(e => ({ ...e, sel: opt.key }))} style={toneBtn(opt.tone, sel, { flex: 1 })}>
                      <div style={toneLbl(opt.tone, sel)}>{opt.label}</div>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Weight feel</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
                {[{ key: 'not_enough', tone: 'ok' }, { key: 'just_right', tone: 'accent' }, { key: 'pushed', tone: 'warn' }, { key: 'too_much', tone: 'danger' }].map(opt => {
                  const wsel = fbEdit.weight === opt.key;
                  return (
                    <button key={opt.key} onClick={() => setFbEdit(e => ({ ...e, weight: opt.key }))} style={toneBtn(opt.tone, wsel)}>
                      <div style={toneLbl(opt.tone, wsel)}>{mesoVolumeLbl(true)[opt.key]}</div>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Pump</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                {[{ key: 'low', label: 'Low', tone: 'warn' }, { key: 'moderate', label: 'Moderate', tone: 'accent' }, { key: 'amazing', label: 'Amazing', tone: 'ok' }].map(opt => {
                  const psel = fbEdit.pump === opt.key;
                  return (
                    <button key={opt.key} onClick={() => setFbEdit(e => ({ ...e, pump: opt.key }))} style={toneBtn(opt.tone, psel, { flex: 1 })}>
                      <div style={toneLbl(opt.tone, psel)}>{opt.label}</div>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>This lift{fbEdit.affinity == null ? ' · optional' : ''}</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                {[{ key: 'love', label: 'Love it', tone: 'ok' }, { key: 'ok', label: "It's fine", tone: 'accent' }, { key: 'dislike', label: 'Not my lift', tone: 'warn' }].map(opt => {
                  const asel = fbEdit.affinity === opt.key;
                  return (
                    <button key={opt.key} onClick={() => setFbEdit(e => ({ ...e, affinity: asel ? null : opt.key }))} style={toneBtn(opt.tone, asel, { flex: 1 })}>
                      <div style={toneLbl(opt.tone, asel)}>{opt.label}</div>
                    </button>
                  );
                })}
              </div>
              <Btn disabled={!fbEdit.sel || !fbEdit.weight || !fbEdit.pump} onClick={() => saveFeedbackEdit({ type: 'joint', subject: fbEdit.subject, answer: fbEdit.sel, weight: fbEdit.weight, pump: fbEdit.pump, affinity: fbEdit.affinity })} style={{ width: '100%', marginTop: 12 }}>Save changes</Btn>
            </>)}
            {fbEdit.type === 'volume' && (<>
              {/* Per-muscle workload (Volume+Load / non-final Meso weeks); drives set deltas. */}
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Workload</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {['not_enough', 'just_right', 'pushed', 'too_much'].map(key => {
                  const sel = fbEdit.volume === key;
                  return (
                    <button key={key} onClick={() => setFbEdit(e => ({ ...e, volume: key }))} style={{
                      width: '100%', padding: '10px 14px', background: sel ? 'rgba(var(--accent-rgb),0.12)' : UI.bgInset,
                      border: `1px solid ${sel ? 'var(--accent)' : UI.hairStrong}`, borderRadius: 6, cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                    }}>
                      <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: sel ? 'var(--accent)' : UI.ink, fontWeight: 600 }}>{mesoVolumeLbl(false)[key]}</div>
                    </button>
                  );
                })}
              </div>
              <Btn disabled={!fbEdit.volume} onClick={() => saveFeedbackEdit({ type: 'volume', subject: fbEdit.subject, volume: fbEdit.volume })} style={{ width: '100%' }}>Save changes</Btn>
            </>)}
          </Sheet>
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
          <div style={twoCol
            // alignItems defaults to 'stretch' in a grid: both cards in a row take the
            // ROW's full height (the taller sibling's), giving every row a clean, even
            // bottom edge instead of each card hugging its own content height.
            ? { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 20, rowGap: 14, marginTop: 14 }
            : { display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }
          }>
            {(() => {
              const groups = LB.groupBySuperset(s.entries);

              const showWarmup = store.settings?.showWarmupInSummary ?? true;
              const renderEntry = (e, i) => {
                const prev = prevEntryMap[i];
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
                  const du = LB.cardioDistUnit();
                  const parts = [];
                  if (cd?.type) parts.push(cd.type.charAt(0).toUpperCase() + cd.type.slice(1));
                  if (cd?.durationMinutes) parts.push(`${cd.durationMinutes} min`);
                  if (cd?.distanceM != null) parts.push(LB.fmtDistance(cd.distanceM, du));
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
                // occ mirrors the live write side exactly (session.entries index-based
                // count of prior same-exId entries), so this matches whichever
                // occurrence's toast actually wrote the bump.
                const occ = e.exId ? s.entries.slice(0, i).filter(x => x.exId === e.exId).length : 0;
                const progBumpKey = e.exId ? e.exId + '_' + occ : null;
                const progBump = progBumpKey ? s.progressionBumps?.[progBumpKey] : null;
                const progBumpEditable = !!progBump && !!s.ended &&
                  !LB.laterSessionTrainsExId(store.sessions, e.exId, s.dayId, s.ended, s.id, s.scheduleId);
                // Meso's own earned-weight-bump chip, mirrored out here from the
                // "Changes earned" list below (same source data, same toggle),
                // for the same reason: findable right on the exercise, not
                // buried in a sheet. Meso keys a bump by exId_dayId only, not
                // occurrence, so a repeated exercise's two rows in one session
                // necessarily share the same chip/toggle state, unlike SP's
                // occ-aware progBump above.
                const mesoBumpKey = e.exId ? e.exId + '_' + s.dayId : null;
                const mesoGain = mesoBumpKey ? (s.mesoRecap?.gains || []).find(g => g.key === mesoBumpKey && g.weightDelta > 0) : null;
                const mesoDeclined = !!mesoGain && !!sessionMeso?.weightBoostDeclines?.[mesoBumpKey];
                const mesoBumpEditable = !!mesoGain && fbEditable;
                const anyBump = !!progBump || !!mesoGain;
                return (
                <div key={i}
                  onClick={() => canHistory && go({ name: 'exerciseHistory', exId: e.exId, dayId: s.dayId, exName, back: { name: 'session', sessionId: s.id } })}
                  style={{ cursor: canHistory ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8 }}>
                    <div className="display" style={{ fontSize: 17, color: UI.ink, lineHeight: 1.1, ...(anyBump && !capturing ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}) }}>
                      {exName}{canHistory && <span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 5 }}>›</span>}
                    </div>
                    {progBump && !capturing && (() => {
                      // Hidden (not just made inert) during screenshot capture: it
                      // shows a FORWARD-looking change (what happens next session),
                      // not what this session's own logged sets show, so next to
                      // e.g. three sets all at the same weight it reads as a
                      // labeling error to anyone viewing the shared image without
                      // app context. Same visual language as the Meso "Changes
                      // earned" chip (deltaChip in the recap sheet below) for the
                      // live in-app view: accepted looks like an earned +kg pill,
                      // declined is muted/struck-through. A real toggle either way,
                      // not a one-shot undo.
                      const label = progBump.declined ? 'Declined' : `+${progBump.nextKg - progBump.currentKg} ${UI.unit()}`;
                      const chipStyle = progBump.declined
                        ? { fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: UI.inkFaint, background: 'rgba(var(--knurl-rgb),0.08)', border: `1px solid ${UI.hair}`, borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap', textDecoration: 'line-through', flexShrink: 0 }
                        : { fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'rgba(var(--accent-rgb),0.10)', border: '1px solid rgba(var(--accent-rgb),0.28)', borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap', flexShrink: 0 };
                      return progBumpEditable ? (
                        <button onClick={(ev) => { ev.stopPropagation(); toggleProgressionBump(progBumpKey); }} style={{ ...chipStyle, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>{label}</button>
                      ) : (
                        <span style={chipStyle}>{label}</span>
                      );
                    })()}
                    {mesoGain && !capturing && (() => {
                      // Mirrors the "Changes earned" chip in the Feedback Recap
                      // sheet below exactly: same source data (s.mesoRecap.gains
                      // for the earned amount, sessionMeso.weightBoostDeclines
                      // for live declined state), same toggleGainDecline handler,
                      // same fbEditable gate. Hidden during capture for the same
                      // forward-looking-value reason as the SP chip above.
                      const label = mesoDeclined ? 'Declined' : `+${mesoGain.weightDelta} ${s.mesoRecap.unit || UI.unit()}`;
                      const chipStyle = mesoDeclined
                        ? { fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: UI.inkFaint, background: 'rgba(var(--knurl-rgb),0.08)', border: `1px solid ${UI.hair}`, borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap', textDecoration: 'line-through', flexShrink: 0 }
                        : { fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'rgba(var(--accent-rgb),0.10)', border: '1px solid rgba(var(--accent-rgb),0.28)', borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap', flexShrink: 0 };
                      return mesoBumpEditable ? (
                        <button onClick={(ev) => { ev.stopPropagation(); toggleGainDecline(mesoBumpKey); }} style={{ ...chipStyle, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>{label}</button>
                      ) : (
                        <span style={chipStyle}>{label}</span>
                      );
                    })()}
                  </div>
                  <div data-shot-chips="1" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
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
                        const tr = LB.techniqueRounds(st);
                        const drops = tr.rounds;
                        const chipColor = highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.ink;
                        const chipBorder = highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hairStrong;
                        const chipBg = highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'transparent';
                        return (
                          <div key={j} style={{
                            width: '100%', marginTop: j > 0 ? 5 : 0,
                            borderLeft: `2px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.4)' : 'rgba(var(--accent-rgb),0.35)'}`,
                            paddingLeft: 9,
                          }}>
                            <div data-shot-chips="1" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, overflow: 'hidden' }}>
                              <IntensityBadge label="DROP" highlight={highlight} decline={decline} />
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
                              {pr && <i className="fa-solid fa-dumbbell" style={{ fontSize: 9, color: UI.gold, marginLeft: 2 }} />}
                            </div>
                            <FinisherTags drops={st.drops} labelFor={(di) => di === 0 ? 'top' : 'drop ' + di} />
                          </div>
                        );
                      }

                      // Myo-rep / myo-rep match: badge + activation chip + mini chips
                      if ((st.technique === 'myorep' || st.technique === 'myorep_match') && !isCheckboxOnly) {
                        const tr = LB.techniqueRounds(st);
                        const drops = tr.rounds;
                        const chipColor = highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.ink;
                        const chipBorder = highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hairStrong;
                        const chipBg = highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'transparent';
                        const isMatch = st.technique === 'myorep_match';
                        return (
                          <div key={j} style={{
                            width: '100%', marginTop: j > 0 ? 5 : 0,
                            borderLeft: `2px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.4)' : 'rgba(var(--accent-rgb),0.35)'}`,
                            paddingLeft: 9,
                          }}>
                            <div data-shot-chips="1" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, overflow: 'hidden' }}>
                              <IntensityBadge label={isMatch ? 'MYO+' : 'MYO'} highlight={highlight} decline={decline} />
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
                              {tr.totalReps > 0 && (
                                <span style={{ border: `1px solid var(--accent)`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontNum, fontSize: 12, color: 'var(--accent)', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>Σ {tr.totalReps}</span>
                              )}
                              {pr && <i className="fa-solid fa-dumbbell" style={{ fontSize: 9, color: UI.gold, marginLeft: 2 }} />}
                            </div>
                            <FinisherTags drops={st.drops} labelFor={(di) => di === 0 ? 'act' : 'myo ' + di} />
                          </div>
                        );
                      }

                      // Lengthened Partials: badge + main chip + partials count
                      if (st.technique === 'lengthened_partial' && !isCheckboxOnly) {
                        const partials = LB.techniqueRounds(st).partials;
                        const chipColor = highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.ink;
                        const chipBorder = highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hairStrong;
                        const chipBg = highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'transparent';
                        return (
                          <div key={j} style={{ width: '100%', marginTop: j > 0 ? 5 : 0, borderLeft: `2px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.4)' : 'rgba(var(--accent-rgb),0.35)'}`, paddingLeft: 9 }}>
                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
                              <IntensityBadge label="PARTIALS" highlight={highlight} decline={decline} />
                              <span style={{ background: chipBg, border: `1px solid ${chipBorder}`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontNum, fontSize: 12, color: chipColor }}>
                                {st.kg ?? '—'}<span style={{ color: highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, fontSize: 10 }}>{UI.unit()}</span><span style={{ color: highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, margin: '0 1px' }}>×</span>{st.reps ?? '—'}
                              </span>
                              {partials > 0 && <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi }}>+</span>}
                              {partials > 0 && <span style={{ border: `1px solid rgba(var(--accent-rgb),0.35)`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontNum, fontSize: 12, color: UI.inkSoft }}>{partials}</span>}
                              <StretchChipLib tr={LB.techniqueRounds(st)} />
                              {pr && <i className="fa-solid fa-dumbbell" style={{ fontSize: 9, color: UI.gold, marginLeft: 2 }} />}
                            </div>
                          </div>
                        );
                      }

                      // Weighted Stretch: badge + main chip + the stretch hold
                      if (st.technique === 'weighted_stretch' && !isCheckboxOnly) {
                        const tr = LB.techniqueRounds(st);
                        const chipColor = highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.ink;
                        const chipBorder = highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hairStrong;
                        const chipBg = highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'transparent';
                        return (
                          <div key={j} style={{ width: '100%', marginTop: j > 0 ? 5 : 0, borderLeft: `2px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.4)' : 'rgba(var(--accent-rgb),0.35)'}`, paddingLeft: 9 }}>
                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
                              <IntensityBadge label="STRETCH" highlight={highlight} decline={decline} />
                              <span style={{ background: chipBg, border: `1px solid ${chipBorder}`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontNum, fontSize: 12, color: chipColor }}>
                                {st.kg ?? '—'}<span style={{ color: highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, fontSize: 10 }}>{UI.unit()}</span><span style={{ color: highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint, margin: '0 1px' }}>×</span>{st.reps ?? '—'}
                              </span>
                              <StretchChipLib tr={tr} />
                              {pr && <i className="fa-solid fa-dumbbell" style={{ fontSize: 9, color: UI.gold, marginLeft: 2 }} />}
                            </div>
                          </div>
                        );
                      }

                      // AMRAP Variations: badge + per-round chips, each with its
                      // label above (unless it's just the exercise's own name —
                      // no variation was actually logged for that round).
                      if (st.technique === 'amrap_variations' && !isCheckboxOnly) {
                        const tr = LB.techniqueRounds(st, { exName });
                        const drops = tr.rounds;
                        // Show every round's label once ANY round diverges from
                        // the exercise name — showing only the diverging rounds
                        // would leave the unvaried ones (usually round 1) looking
                        // unlabeled next to their labeled neighbors.
                        const anyVaried = tr.anyVaried;
                        const chipColor = highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.ink;
                        const chipBorder = highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hairStrong;
                        const chipBg = highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'transparent';
                        return (
                          <div key={j} style={{
                            width: '100%', marginTop: j > 0 ? 5 : 0,
                            borderLeft: `2px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.4)' : 'rgba(var(--accent-rgb),0.35)'}`,
                            paddingLeft: 9,
                          }}>
                            <div data-shot-chips="1" style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 5, overflow: 'hidden' }}>
                              <span style={{ alignSelf: 'center' }}><IntensityBadge label="AMRAP" highlight={highlight} decline={decline} /></span>
                              {drops.map((d, di) => (
                                <React.Fragment key={di}>
                                  {di > 0 && (
                                    <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi, alignSelf: 'center' }}>→</span>
                                  )}
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                    {anyVaried && (
                                      <span className="num" style={{ fontSize: 8, color: UI.inkGhost, maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label || exName}</span>
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
                                  </div>
                                </React.Fragment>
                              ))}
                              {pr && <i className="fa-solid fa-dumbbell" style={{ fontSize: 9, color: UI.gold, alignSelf: 'center', marginLeft: 2 }} />}
                            </div>
                            <FinisherTags drops={st.drops} labelFor={(di) => 'round ' + (di + 1)} />
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
                          {st.timeSec != null ? LB.fmtDuration(st.timeSec) : isCheckboxOnly ? (st.done ? '✓' : '○') : (<>
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

              return groups.map((g, gi) => {
                const groupBody = g.type === 'superset' ? (
                  <div style={{ borderLeft: `2px solid ${UI.goldSoft}`, paddingLeft: 12 }}>
                    <div className="micro" style={{ color: UI.gold, marginBottom: 10, letterSpacing: '0.12em' }}>{LB.supersetLabel(g.members.length)}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {g.members.map(({ entry: e, idx: i }) => renderEntry(e, i))}
                    </div>
                  </div>
                ) : renderEntry(g.entry, g.idx);
                // Two-column grid: each block gets its own bordered card instead of a
                // between-block divider, a full-width knurl/hairline only makes sense
                // spanning one column, not the row it visually sits in.
                if (twoCol) {
                  // A lone last card in an odd-count grid would otherwise sit half-width
                  // in an empty row. Span both columns instead of leaving it orphaned.
                  const isLastOdd = gi === groups.length - 1 && groups.length % 2 === 1;
                  return <Frame key={gi} padding={14} style={{ minWidth: 0, ...(isLastOdd ? { gridColumn: '1 / -1' } : {}) }}>{groupBody}</Frame>;
                }
                return (
                  <div key={gi}>
                    {groupBody}
                    {gi < groups.length - 1 && (capturing ? <KnurlCanvas style={{ marginTop: 14 }} /> : <Hairline style={{ marginTop: 14 }} />)}
                  </div>
                );
              });
            })()}
          </div>
          {capturing && !twoCol && (
            <img src={_shotLogo} data-shot-avatar="1" style={{ position: 'absolute', bottom: 2, right: 0, width: 90, opacity: 0.5, zIndex: 1, transform: _shotIsCustom ? 'none' : 'scaleX(-1)' }} />
          )}
          {capturing && <div style={{ height: '0.5px', background: UI.gold, marginTop: 10 }} />}
        </div>
        </div>
      </div>


      {editing && (
        <SessionEditSheet
          session={s}
          duration={duration}
          exercises={store.exercises}
          store={store}
          setStore={setStore}
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

// ─── Technique-aware set editing (History → workout → Edit) ────────────
// Historical companion to the live training screen's technique picker/chain
// sheets (screens-train.jsx): same data model, LB.techniqueRounds, and the
// technique/drops shapes documented in docs/database.md ("drops[0] mirrors
// the top-level kg/reps... only the first drop counts toward volume and
// doneSetCount"), but edits an already-logged, static session instead of
// live input state, so none of the live screen's custom-keypad/rest-timer/
// auto-arm machinery applies; this is plain-input editing throughout.
const CHAIN_TECH_KINDS = ['drop', 'myorep', 'myorep_match', 'amrap_variations'];
const STANDALONE_TECH_KINDS = ['lengthened_partial', 'weighted_stretch'];
const techRoundLabel = (kind, di) =>
  (kind === 'myorep' || kind === 'myorep_match') ? (di === 0 ? 'Activation' : `Myo ${di}`)
  : kind === 'amrap_variations' ? `Round ${di + 1}`
  : (di === 0 ? 'Top' : `Drop ${di}`);

function TechniqueChipRow({ current, onSelect }) {
  const chips = [{ id: null, short: 'NONE' }, ...LB.PLANNABLE_TECHNIQUES];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
      {chips.map(c => {
        const active = (current || null) === c.id;
        return (
          <button key={c.id ?? 'none'} onClick={() => onSelect(c.id)} style={{
            background: active ? UI.goldFaint : 'transparent',
            border: `1px solid ${active ? UI.goldSoft : UI.hairStrong}`,
            borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
            fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            color: active ? UI.gold : UI.inkFaint, WebkitTapHighlightColor: 'transparent',
          }}>{c.short}</button>
        );
      })}
    </div>
  );
}

// A +/- stepper, shared by the two "partials" counters below.
function PartialsStepper({ value, onChange }) {
  const btnStyle = { width: 22, height: 22, borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkSoft, cursor: 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button onClick={() => onChange(Math.max(0, value - 1))} style={btnStyle}>−</button>
      <span className="num" style={{ width: 18, textAlign: 'center', fontSize: 12, color: UI.ink }}>{value}</span>
      <button onClick={() => onChange(value + 1)} style={btnStyle}>+</button>
    </div>
  );
}

// A weighted-stretch kg/timeSec pair, shared by chain-round finishers and the
// two standalone techniques.
function StretchFields({ stretch, onChange }) {
  const numStyle = { width: 52, background: UI.bgRaised, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, color: UI.ink, padding: '7px 6px', textAlign: 'center', fontFamily: UI.fontNum, fontSize: 13, outline: 'none' };
  return (<>
    <input type="text" inputMode="decimal" value={stretch?.kg ?? ''} placeholder={UI.unit()} onFocus={e => e.target.select()}
      onChange={ev => onChange({ kg: ev.target.value === '' ? null : +ev.target.value, timeSec: stretch?.timeSec ?? 30 })}
      style={numStyle} />
    <input type="text" inputMode="numeric" value={stretch?.timeSec ?? ''} placeholder="sec" onFocus={e => e.target.select()}
      onChange={ev => onChange({ kg: stretch?.kg ?? null, timeSec: ev.target.value === '' ? null : +ev.target.value })}
      style={numStyle} />
  </>);
}

// One round of a chain technique (drop/myo/myo-match/AMRAP): kg × reps (+ a
// variation-name field for AMRAP, myo rounds after the activation reuse the
// activation kg so no kg field), plus a collapsible partials/stretch
// finisher, same per-round data Finisher/FinisherStep author live, just
// against plain inputs instead of the custom keypad.
function RoundEditRow({ round, di, kind, onChange, onRemove, canRemove }) {
  const [finisherOpen, setFinisherOpen] = useStateL(!!(round.partials || round.stretch));
  const isMyo = kind === 'myorep' || kind === 'myorep_match';
  const showKg = !(isMyo && di > 0);
  const numStyle = { width: 56, background: UI.bgRaised, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, color: UI.ink, padding: '7px 6px', textAlign: 'center', fontFamily: UI.fontNum, fontSize: 13, outline: 'none', flexShrink: 0 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="micro" style={{ width: 60, flexShrink: 0, color: UI.inkFaint }}>{techRoundLabel(kind, di)}</span>
        {kind === 'amrap_variations' && (
          <input type="text" value={round.label ?? ''} placeholder="Variation" onFocus={e => e.target.select()}
            onChange={ev => onChange({ label: ev.target.value })}
            style={{ flex: 1, minWidth: 70, background: UI.bgRaised, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, color: UI.ink, padding: '7px 8px', fontFamily: UI.fontUi, fontSize: 12, outline: 'none' }} />
        )}
        {showKg && (
          <input type="text" inputMode="decimal" value={round.kg ?? ''} placeholder="—" onFocus={e => e.target.select()}
            onChange={ev => onChange({ kg: ev.target.value === '' ? null : +ev.target.value })} style={numStyle} />
        )}
        {showKg && <span className="num" style={{ color: UI.inkFaint, fontSize: 10 }}>{UI.unit()}</span>}
        <span style={{ color: UI.hair, fontSize: 13, fontFamily: UI.fontDisplay, fontStyle: 'italic' }}>×</span>
        <input type="text" inputMode="numeric" value={round.reps ?? ''} placeholder="—" onFocus={e => e.target.select()}
          onChange={ev => onChange({ reps: ev.target.value === '' ? null : +ev.target.value })} style={numStyle} />
        <span className="num" style={{ color: UI.inkFaint, fontSize: 10 }}>reps</span>
        <button onClick={() => setFinisherOpen(o => !o)} title="Partials / stretch finisher" style={{
          marginLeft: 'auto', flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer',
          color: finisherOpen || round.partials || round.stretch ? UI.gold : UI.inkFaint, fontSize: 13, padding: '4px 6px',
        }}><i className="fa-solid fa-bolt" /></button>
        {canRemove && (
          <button onClick={onRemove} title="Remove round" style={{ flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(var(--danger-rgb),0.7)', fontSize: 12, padding: '4px 4px' }}>
            <i className="fa-solid fa-xmark" />
          </button>
        )}
      </div>
      {finisherOpen && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 66, flexWrap: 'wrap' }}>
          <span className="micro" style={{ color: UI.inkFaint }}>Partials</span>
          <PartialsStepper value={round.partials || 0} onChange={v => onChange({ partials: v })} />
          <span className="micro" style={{ color: UI.inkFaint, marginLeft: 6 }}>Stretch</span>
          <StretchFields stretch={round.stretch} onChange={v => onChange({ stretch: v })} />
        </div>
      )}
    </div>
  );
}

// Full rounds list for a chain technique, with add/remove and a running
// total-reps chip for myo variants (mirrors TechniqueBlock's read display).
function ChainRoundsEditor({ st, kind, onUpdateRound, onAddRound, onRemoveRound }) {
  const drops = Array.isArray(st.drops) ? st.drops : [];
  const isMyo = kind === 'myorep' || kind === 'myorep_match';
  const totalReps = isMyo ? drops.reduce((a, d) => a + (d.reps || 0), 0) : 0;
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10, borderLeft: `2px solid rgba(var(--accent-rgb),0.35)`, paddingLeft: 10 }}>
      {drops.map((d, di) => (
        <RoundEditRow key={di} round={d} di={di} kind={kind}
          onChange={patch => onUpdateRound(di, patch)}
          onRemove={() => onRemoveRound(di)}
          canRemove={drops.length > 1} />
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onAddRound} style={{
          background: 'transparent', border: `1px dashed ${UI.goldSoft}`, borderRadius: 4,
          padding: '5px 10px', cursor: 'pointer', color: UI.gold, fontFamily: UI.fontUi, fontSize: 11,
          WebkitTapHighlightColor: 'transparent',
        }}>+ Add round</button>
        {totalReps > 0 && (
          <span style={{ border: `1px solid var(--accent)`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)' }}>Total {totalReps}</span>
        )}
      </div>
    </div>
  );
}

// Lengthened Partials / Weighted Stretch: no rounds, just the finisher
// fields on top of the set's own (unmirrored) kg/reps row above.
function StandaloneTechEditor({ st, kind, onPatch }) {
  const drops = (st.drops && !Array.isArray(st.drops)) ? st.drops : {};
  return (
    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderLeft: `2px solid rgba(var(--accent-rgb),0.35)`, paddingLeft: 10 }}>
      {kind === 'lengthened_partial' && (<>
        <span className="micro" style={{ color: UI.inkFaint }}>Partials</span>
        <PartialsStepper value={drops.partials || 0} onChange={v => onPatch({ partials: v })} />
      </>)}
      <span className="micro" style={{ color: UI.inkFaint, marginLeft: kind === 'lengthened_partial' ? 6 : 0 }}>Stretch</span>
      <StretchFields stretch={drops.stretch} onChange={v => onPatch({ stretch: v })} />
    </div>
  );
}

function SessionEditSheet({ session, duration, exercises, store, setStore, onClose, onSave }) {
  const [draftDate, setDraftDate] = useStateL(session.date ? session.date.slice(0, 10) : '');
  const [draftDuration, setDraftDuration] = useStateL(duration != null ? String(Math.round(duration / 5) * 5) : '0');
  const [draftEntries, setDraftEntries] = useStateL(() => JSON.parse(JSON.stringify(session.entries)));
  const [openWarmups, setOpenWarmups] = useStateL({}); // eIdx -> bool, collapsed by default
  const [swapEIdx, setSwapEIdx] = useStateL(null); // entry index whose exercise is being corrected via the picker
  const [pendingSwap, setPendingSwap] = useStateL(null); // { eIdx, newExId } queued until the picked exercise resolves
  const [confirmEl, confirm] = useConfirm();
  const origDate = session.date ? session.date.slice(0, 10) : '';
  const origDuration = duration != null ? String(Math.round(duration / 5) * 5) : '0';
  const origEntriesJson = useRefL(JSON.stringify(session.entries));
  const isDirty = draftDate !== origDate || draftDuration !== origDuration || JSON.stringify(draftEntries) !== origEntriesJson.current;
  const requestClose = async () => {
    if (isDirty && !await confirm('Your edits won\'t be saved.', { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    onClose();
  };

  // Correct a mis-logged exercise: point this entry at a different exercise while
  // keeping its logged sets (the numbers were right, the movement was picked
  // wrong, e.g. neutral vs overhand lat pulldown). The picker resolves to a
  // user-owned id; the entry's cached name follows so history / PRs re-attribute.
  const swapExercise = (ids) => {
    const newExId = Array.isArray(ids) ? ids[0] : ids;
    const eIdx = swapEIdx;
    setSwapEIdx(null);
    if (newExId == null || eIdx == null) return;
    // finalizePick may materialize a picked SYSTEM exercise into store.exercises via
    // setStore and then call this synchronously, BEFORE the sheet re-renders with the
    // new `exercises` prop. Resolving the new exercise inline would miss it (undefined
    // name / unilateral flag), silently skipping the L/R reshape this feature exists to
    // do. Queue the swap; the effect below applies it once the exercise resolves. #5
    setPendingSwap({ eIdx, newExId });
  };
  // Apply a queued swap once the picked exercise appears in `exercises` (an already-
  // owned pick resolves on the first pass; a freshly materialized system exercise
  // resolves a render later, when finalizePick's setStore has landed the new row).
  useEffectL(() => {
    if (!pendingSwap) return;
    const { eIdx, newExId } = pendingSwap;
    const newEx = exercises?.find(x => x.id === newExId);
    if (!newEx) return; // wait for the materialized row to arrive
    setDraftEntries(entries => entries.map((en, i) => {
      if (i !== eIdx) return en;
      // If the swap flips unilateral-ness, reshape the kept sets to match the new
      // exercise (per-side L/R vs a single rep count) so a bilateral exercise
      // never inherits stray L/R data and renders as "L13/R13" in history.
      const oldEx = exercises?.find(x => x.id === en.exId);
      const wasUni = !!oldEx?.unilateral, isUni = !!newEx.unilateral;
      const sets = wasUni !== isUni ? LB.reshapeSetsUnilateral(en.sets, isUni) : en.sets;
      return { ...en, exId: newExId, name: newEx.name ?? en.name, sets };
    }));
    setPendingSwap(null);
  }, [pendingSwap, exercises]);

  const updateSet = (eIdx, sIdx, patch) => {
    setDraftEntries(entries => entries.map((e, i) =>
      i !== eIdx ? e : { ...e, sets: e.sets.map((st, k) => k !== sIdx ? st : { ...st, ...patch, skipped: false, done: true }) }
    ));
  };

  // Reopening/clearing a technique set for plain editing must drop technique
  // + drops too, mirrors the live training screen's own reopen behavior
  // (screens-train.jsx updateSet: unchecking a done technique set wipes
  // both). Skipping used to leave a stale `drops` behind here.
  const skipSet = (eIdx, sIdx, skip) => {
    setDraftEntries(entries => entries.map((e, i) =>
      i !== eIdx ? e : { ...e, sets: e.sets.map((st, k) => k !== sIdx ? st : {
        ...st, skipped: skip, done: false, kg: null, reps: null, repsL: null, repsR: null,
        ...(skip ? { technique: null, drops: null } : {}),
      }) }
    ));
  };

  // techId=null clears back to a plain set. Chain techniques keep `drops` as
  // an ARRAY with round 0 mirrored onto the set's own kg/reps (progression /
  // volume / PR code only ever reads the top-level fields, see
  // docs/database.md's zane_sets.drops note); standalone techniques keep
  // `drops` as a plain OBJECT and leave the set's own kg/reps untouched.
  const setTechnique = (eIdx, sIdx, techId, exName) => {
    setDraftEntries(entries => entries.map((e, i) => i !== eIdx ? e : {
      ...e, sets: e.sets.map((st, k) => {
        if (k !== sIdx) return st;
        if (!techId) return { ...st, technique: null, drops: null };
        if (CHAIN_TECH_KINDS.includes(techId)) {
          const priorDrops = Array.isArray(st.drops) && st.drops.length ? st.drops : null;
          // Technique rounds carry a single rep count. On a unilateral set the rep
          // data moves into the rounds (kg x reps), so seed from the set's effective
          // reps (min of L/R) and clear repsL/repsR, matching the shape the live
          // logger writes for a technique'd unilateral set.
          const seedReps = st.reps ?? ((st.repsL != null || st.repsR != null) ? Math.min(st.repsL ?? st.repsR ?? 0, st.repsR ?? st.repsL ?? 0) : null);
          const seedRound = () => ({ kg: st.kg, reps: seedReps, ...(techId === 'amrap_variations' ? { label: exName || '' } : {}) });
          const drops = priorDrops || [seedRound(), seedRound()];
          return { ...st, technique: techId, drops, kg: drops[0].kg, reps: drops[0].reps, repsL: null, repsR: null };
        }
        const prior = (st.drops && !Array.isArray(st.drops)) ? st.drops : {};
        const drops = techId === 'lengthened_partial'
          ? { partials: prior.partials || 0, ...(prior.stretch ? { stretch: prior.stretch } : {}) }
          : { stretch: prior.stretch || { kg: null, timeSec: 30 } };
        return { ...st, technique: techId, drops };
      }),
    }));
  };

  const updateRound = (eIdx, sIdx, roundIdx, patch) => {
    setDraftEntries(entries => entries.map((e, i) => i !== eIdx ? e : {
      ...e, sets: e.sets.map((st, k) => {
        if (k !== sIdx) return st;
        const drops = (st.drops || []).map((d, di) => di !== roundIdx ? d : { ...d, ...patch });
        return { ...st, drops, ...(roundIdx === 0 ? { kg: drops[0].kg, reps: drops[0].reps } : {}) };
      }),
    }));
  };

  const addRound = (eIdx, sIdx, exName) => {
    setDraftEntries(entries => entries.map((e, i) => i !== eIdx ? e : {
      ...e, sets: e.sets.map((st, k) => {
        if (k !== sIdx) return st;
        const drops = st.drops || [];
        const last = drops[drops.length - 1] || { kg: st.kg, reps: st.reps };
        const newRound = { kg: last.kg, reps: last.reps, ...(st.technique === 'amrap_variations' ? { label: exName || '' } : {}) };
        return { ...st, drops: [...drops, newRound] };
      }),
    }));
  };

  const removeRound = (eIdx, sIdx, roundIdx) => {
    setDraftEntries(entries => entries.map((e, i) => i !== eIdx ? e : {
      ...e, sets: e.sets.map((st, k) => {
        if (k !== sIdx || !st.drops || st.drops.length <= 1) return st;
        const drops = st.drops.filter((_, di) => di !== roundIdx);
        return { ...st, drops, kg: drops[0].kg, reps: drops[0].reps };
      }),
    }));
  };

  const patchStandalone = (eIdx, sIdx, patch) => {
    setDraftEntries(entries => entries.map((e, i) => i !== eIdx ? e : {
      ...e, sets: e.sets.map((st, k) => k !== sIdx ? st : { ...st, drops: { ...(st.drops && !Array.isArray(st.drops) ? st.drops : {}), ...patch } }),
    }));
  };

  const save = () => {
    const patch = { entries: draftEntries };
    if (draftDate && draftDate !== session.date?.slice(0, 10)) {
      // Store the picked day as UTC noon so its date part (slice 0,10) equals
      // the chosen day in every timezone. The old new Date()/setFullYear/
      // toISOString dance kept the original's LOCAL time-of-day and, for a
      // UTC-midnight date viewed west of UTC, rolled the day forward by one on
      // re-serialization (Mike's "set today → history shows Jul 6" ticket).
      // `date` is read everywhere as a day via slice/parseDate, never as a
      // wall-clock time — started_at/ended carry the actual times.
      patch.date = draftDate + 'T12:00:00.000Z';
    }
    // Only touch duration when the field was actually changed: it is seeded from
    // round(duration/5)*5, so an untouched save would otherwise snap a true 42
    // min down to 40. Selecting the "—" (0) option clears the duration.
    if (draftDuration !== origDuration) {
      const mins = parseInt(draftDuration, 10);
      patch.durationMinutes = (!isNaN(mins) && mins > 0) ? mins : null;
    }
    // Autoreg v2 swap re-key (#1 / #E): if a swap corrected an entry's exId, the captured
    // meso feedback is keyed by the OLD exId; a later feedback edit / delete / revoke
    // re-derives its keys from the CURRENT entry exId and would miss it. Decide AND apply
    // BOTH the recap re-key and the meso-row re-key TOGETHER inside ONE functional updater
    // reading FRESH state, so the owner/clobber decision and the two moves can never
    // disagree (a concurrent sync between render and commit can't leave raw re-keyed while
    // the row is not). Per swap:
    //   FULL (recap raw + the exId_dayId meso ROW levers move together) when this session
    //   OWNS the levers: no later same-day ended session on the plan retrained the old
    //   exId, and the new exId has no lever of its own to clobber. Then the corrected
    //   exercise inherits the earned boost/cut and delete/edit/revoke all reach it.
    //   IDENTITY-ONLY (move just the joint record, contrib stays under the old key, in
    //   sync with the unremapped deltas) otherwise, which is always safe.
    // Same-index compare: SessionEditSheet only edits sets / swaps exIds, never
    // adds/removes/reorders entries.
    const swaps = [];
    (session.entries || []).forEach((orig, i) => {
      const now = draftEntries[i];
      if (now && orig && !now.isCardio && now.exId !== orig.exId) swaps.push({ oldExId: orig.exId, newExId: now.exId, name: now.name });
    });
    if (swaps.length && session.mesoRecap?.raw?.answers) {
      setStore(st => {
        const row = session.scheduleId ? (st.mesoStates || []).find(m => m.scheduleId === session.scheduleId) : null;
        let raw = session.mesoRecap.raw;
        let nextRow = row;
        swaps.forEach(sw => {
          const owner = !!row
            && !LB.laterSessionTrainsExId(st.sessions, sw.oldExId, session.dayId, session.ended, session.id, session.scheduleId)
            && !LB.mesoRowHasExId(nextRow, sw.newExId, session.dayId);
          if (owner) {
            raw = LB.remapMesoRecapRawForSwap(raw, sw.oldExId, sw.newExId, session.dayId, sw.name);
            nextRow = LB.remapMesoStateExId(nextRow, sw.oldExId, sw.newExId, session.dayId);
          } else {
            const na = LB.remapMesoAnswersExId(raw.answers, sw.oldExId, sw.newExId, sw.name);
            if (na !== raw.answers) raw = { ...raw, answers: na };
          }
        });
        const recapChanged = raw !== session.mesoRecap.raw;
        const rowChanged = !!row && nextRow !== row;
        if (!recapChanged && !rowChanged) return st;
        return {
          ...st,
          sessions: recapChanged
            ? st.sessions.map(x => x.id === session.id ? { ...x, mesoRecap: { ...session.mesoRecap, raw } } : x)
            : st.sessions,
          mesoStates: rowChanged
            ? (st.mesoStates || []).map(m => m === row ? { ...nextRow, updatedAt: new Date().toISOString() } : m)
            : st.mesoStates,
        };
      });
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
    <>
    <Sheet open={true} onClose={requestClose} title="Edit session">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 160 }}>
        <div>
          <span className="label">Date</span>
          <div style={{ width: '100%', overflow: 'hidden', borderRadius: 4, marginTop: 6 }}>
            <input type="date" value={draftDate} max={LB.todayISO()} onChange={e => setDraftDate(e.target.value)} style={{ ...inputStyle, textAlign: 'center', textAlignLast: 'center' }} />
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
            const ex = exercises?.find(x => x.id === e.exId);
            const exName = ex?.name ?? e.name;
            const isUnilateral = !!ex?.unilateral || e.sets.some(st => st.repsL != null || st.repsR != null);
            // Techniques apply to any logged weight/reps set, never warmups or
            // checkbox/time-mode exercises. Unilateral is fine too: the live
            // training screen allows it (its Intensity button only excludes
            // cardio/time/checkbox), and technique rounds carry a single rep count
            // each, so a chain technique on a unilateral set logs its rounds as
            // kg x reps and clears repsL/repsR when it arms (see setTechnique).
            const logMode = LB.exerciseLogMode(ex);
            const techEligible = logMode !== 'checkbox' && logMode !== 'time';
            const warmupOpen = !!openWarmups[eIdx];
            // Split by warmup while keeping each set's real index (sIdx) into
            // e.sets, every mutation fn below is keyed on that index, not on
            // position within either rendered group.
            const warmupSets = e.sets.map((st, sIdx) => ({ st, sIdx })).filter(x => x.st.warmup);
            const workingSets = e.sets.map((st, sIdx) => ({ st, sIdx })).filter(x => !x.st.warmup);

            const renderSetRow = (st, sIdx) => {
              const isEmpty = st.kg == null && st.reps == null && st.repsL == null && st.repsR == null;
              const isChain = CHAIN_TECH_KINDS.includes(st.technique);
              const isStandalone = STANDALONE_TECH_KINDS.includes(st.technique);
              const rowEligible = techEligible && !st.warmup && !st.skipped;
              const warmupNum = st.warmup ? e.sets.slice(0, sIdx + 1).filter(x => x.warmup).length : 0;
              const workingNum = !st.warmup ? e.sets.slice(0, sIdx + 1).filter(x => !x.warmup).length : 0;
              return (
                <div style={{
                  padding: '10px 16px',
                  background: st.technique ? 'rgba(var(--accent-rgb),0.06)' : 'transparent',
                  opacity: st.skipped ? 0.5 : st.warmup ? 0.7 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 4, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: `1px solid ${st.warmup ? UI.hair : UI.hairStrong}`,
                      fontFamily: UI.fontNum, fontSize: st.warmup ? 8 : 11, fontWeight: 500,
                      color: st.warmup ? UI.inkGhost : UI.inkFaint,
                    }}>{st.warmup ? `W${warmupNum}` : workingNum}</div>
                    {st.skipped ? (
                      <>
                        <span className="num" style={{ flex: 1, fontSize: 12, color: UI.inkFaint }}>skipped</span>
                        <button onClick={() => skipSet(eIdx, sIdx, false)} style={{ background: 'rgba(var(--accent-rgb),0.15)', border: `0.5px solid rgba(var(--accent-rgb),0.4)`, borderRadius: 6, padding: '3px 8px', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', fontFamily: UI.fontUi, flexShrink: 0 }}>Undo</button>
                      </>
                    ) : isChain ? (
                      // Round 0 (mirrored onto st.kg/reps) is edited via
                      // the rounds list below, not a flat row here —
                      // showing both would just be two inputs for the
                      // same number.
                      <span className="micro" style={{ color: UI.inkFaint }}>{LB.plannedTechniqueLabel(st.technique)}</span>
                    ) : (
                      <>
                        <input type="text" inputMode="decimal" step="0.5" value={st.kg ?? ''}
                          placeholder="—" onFocus={e => e.target.select()}
                          onChange={ev => updateSet(eIdx, sIdx, { kg: ev.target.value === '' ? null : +ev.target.value })}
                          style={numInputStyle} />
                        <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>{UI.unit()}</span>
                        <span style={{ color: UI.hair, fontSize: 14, margin: '0 2px', fontFamily: UI.fontDisplay, fontStyle: 'italic' }}>×</span>
                        {isUnilateral ? (
                          <>
                            <input type="text" inputMode="numeric" value={st.repsL ?? ''}
                              placeholder="—" onFocus={e => e.target.select()}
                              onChange={ev => updateSet(eIdx, sIdx, { repsL: ev.target.value === '' ? null : +ev.target.value })}
                              style={numInputStyle} />
                            <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>L</span>
                            <input type="text" inputMode="numeric" value={st.repsR ?? ''}
                              placeholder="—" onFocus={e => e.target.select()}
                              onChange={ev => updateSet(eIdx, sIdx, { repsR: ev.target.value === '' ? null : +ev.target.value })}
                              style={numInputStyle} />
                            <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>R</span>
                          </>
                        ) : (
                          <>
                            <input type="text" inputMode="numeric" value={st.reps ?? ''}
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
                  {rowEligible && (
                    <TechniqueChipRow current={st.technique} onSelect={id => setTechnique(eIdx, sIdx, id, exName)} />
                  )}
                  {rowEligible && isChain && (
                    <ChainRoundsEditor st={st} kind={st.technique}
                      onUpdateRound={(di, patch) => updateRound(eIdx, sIdx, di, patch)}
                      onAddRound={() => addRound(eIdx, sIdx, exName)}
                      onRemoveRound={di => removeRound(eIdx, sIdx, di)} />
                  )}
                  {rowEligible && isStandalone && (
                    <StandaloneTechEditor st={st} kind={st.technique} onPatch={patch => patchStandalone(eIdx, sIdx, patch)} />
                  )}
                </div>
              );
            };

            return (
              <div key={eIdx} style={{ position: 'relative', background: UI.bgInset, borderRadius: 8, overflow: 'hidden', border: `1px solid ${UI.hairStrong}` }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'var(--accent)' }} />
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px 12px 18px' }}>
                  <div style={{ flex: 1, minWidth: 0, fontFamily: UI.fontDisplay, fontSize: 18, fontWeight: 700, letterSpacing: '0.01em', textTransform: 'uppercase', color: UI.ink, lineHeight: 1.15 }}>
                    {exName}
                  </div>
                  <button onClick={() => setSwapEIdx(eIdx)} style={{ flexShrink: 0, marginTop: 1, background: 'transparent', border: `1px solid ${UI.hairStrong}`, borderRadius: 4, padding: '5px 10px', cursor: 'pointer', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent' }}>Swap</button>
                </div>

                {warmupSets.length > 0 && (
                  <>
                    <div className="knurl" />
                    <button onClick={() => setOpenWarmups(s => ({ ...s, [eIdx]: !s[eIdx] }))} aria-expanded={warmupOpen} style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '9px 16px 9px 18px', background: 'transparent', border: 'none', cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}>
                      <span className="micro" style={{ flex: 1, textAlign: 'left', color: UI.inkFaint, marginBottom: 0 }}>WARMUP · {warmupSets.length}</span>
                      <i className="fa-solid fa-chevron-down" style={{ fontSize: 10, color: UI.inkFaint, transition: 'transform 0.2s ease', transform: warmupOpen ? 'rotate(180deg)' : 'none' }} />
                    </button>
                    {warmupOpen && (
                      <div>
                        {warmupSets.map(({ st, sIdx }, i) => (
                          <React.Fragment key={sIdx}>
                            {i > 0 && <div className="knurl" />}
                            {renderSetRow(st, sIdx)}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                    <div className="knurl" />
                  </>
                )}

                <div>
                  {workingSets.map(({ st, sIdx }, i) => (
                    <React.Fragment key={sIdx}>
                      {i > 0 && <div className="knurl" />}
                      {renderSetRow(st, sIdx)}
                    </React.Fragment>
                  ))}
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
    {swapEIdx != null && window.Screens?.ExercisePicker && (
      <window.Screens.ExercisePicker store={store} setStore={setStore} onClose={() => setSwapEIdx(null)} onPick={swapExercise} singleSelect />
    )}
    </>
  );
}

// The weighted-stretch holds a set carried, as a compact "20kg·30s / 40s"
// string: per-round holds on a chain (drop/myo/AMRAP with finishers), or the
// single object-form stretch on a standalone weighted-stretch or lengthened
// set. Empty string when the set carried no stretch.
function stretchText(tr) {
  const list = (tr.rounds && tr.rounds.length) ? tr.rounds.filter(r => r.stretch).map(r => r.stretch) : (tr.stretch ? [tr.stretch] : []);
  if (!list.length) return '';
  return list.map(x => (x.kg != null ? String(x.kg).replace('.', ',') + UI.unit() + '·' : '') + x.timeSec + 's').join(' / ');
}

// Accent-bordered "stretch 20kg·30s" chip, matching the partials chip style
// used across the history/compare views. Renders nothing when the set carried
// no weighted stretch. Used for the object-form techniques (standalone
// weighted stretch, lengthened partials); chains use FinisherTags below.
function StretchChipLib({ tr }) {
  const txt = stretchText(tr);
  if (!txt) return null;
  return <span style={{ border: `1px solid rgba(var(--accent-rgb),0.35)`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontNum, fontSize: 12, color: UI.inkSoft, whiteSpace: 'nowrap' }}>stretch {txt}</span>;
}

// Compact inline technique badge for the session-detail set list. It sits at the
// head of the (now single-row) technique set instead of on its own line above,
// which used to make a technique-heavy workout balloon vertically. Gold on a PR /
// improvement, danger on a decline, a muted accent otherwise.
function IntensityBadge({ label, highlight, decline }) {
  return (
    <span style={{
      fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
      color: highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.85)' : 'var(--accent)',
      background: highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'rgba(var(--accent-rgb),0.10)',
      border: `0.5px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : 'rgba(var(--accent-rgb),0.30)'}`,
      borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap', flexShrink: 0,
    }}>{label}</span>
  );
}

// Per-round finisher breakdown for a completed chain set (drop/myo/AMRAP): one
// tag per round that carried partials and/or a weighted stretch, labelled by
// round. Mirrors the live training screen's FinisherSummary exactly so history
// shows EVERY round's finisher, not just the last round's. `drops` is the raw
// per-round array; named FinisherTags (not FinisherSummary) because classic
// scripts share one global scope and train.jsx already owns that name.
function FinisherTags({ drops, labelFor }) {
  const lines = (drops || []).map((d, di) => {
    const p = d.partials || 0, st = d.stretch || null;
    return (p > 0 || st) ? { di, label: labelFor(di), p, st } : null;
  }).filter(Boolean);
  if (!lines.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
      {lines.map(({ di, label, p, st }) => (
        <span key={di} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', border: '1px solid var(--accent)', borderRadius: 4, fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.03em' }}>
          <span style={{ opacity: 0.6, fontSize: 9, textTransform: 'uppercase' }}>{label}</span>
          {p > 0 && <span>+{p} partial{p === 1 ? '' : 's'}</span>}
          {p > 0 && st && <span style={{ opacity: 0.4 }}>|</span>}
          {st && <span>stretch {st.kg != null ? String(st.kg).replace('.', ',') + ' ' + UI.unit() + ' · ' : ''}{st.timeSec}s</span>}
        </span>
      ))}
    </div>
  );
}

// ─── SESSION COMPARE ───────────────────────────────────────────────────
// Set-string formatting for the compact "compared" (right) column — kept
// as plain text (not chips) since the 100px column has no room for chip
// pills; the full drop/myo/partial chain still reads fine as a string.
function fmtCompareSet(st) {
  if (!st) return '—';
  if (st.skipped && !st.done) return 'skipped';
  if (st.timeSec != null) return LB.fmtDuration(st.timeSec);
  const tr = LB.techniqueRounds(st);
  const strTxt = stretchText(tr);
  const strSfx = strTxt ? ` +stretch ${strTxt}` : '';
  if (tr.kind === 'weighted_stretch') {
    const main = `${st.kg != null ? st.kg + UI.unit() : '—'} × ${st.reps ?? '—'}`;
    return `${main}${strSfx}`;
  }
  if (tr.kind === 'lengthened_partial') {
    const main = `${st.kg != null ? st.kg + UI.unit() : '—'} × ${st.reps ?? '—'}`;
    return (tr.partials > 0 ? `${main} +${tr.partials} partials` : main) + strSfx;
  }
  if (tr.kind) {
    const chain = tr.rounds.map((d, di) => (tr.connector === '↺' && di > 0) ? (d.reps ?? '—') : `${d.kg ?? '—'}${UI.unit()}×${d.reps ?? '—'}`).join(` ${tr.connector} `);
    const suffix = tr.totalReps != null ? ` (${tr.totalReps})` : '';
    return (tr.partials > 0 ? `${chain}${suffix} +${tr.partials} partials` : `${chain}${suffix}`) + strSfx;
  }
  // Checkbox / no-numeric completed set: show a tick, not a meaningless '— × —'.
  if (st.done && st.kg == null && st.reps == null && st.repsL == null && st.repsR == null) return '✓';
  const repsStr = (st.repsL != null || st.repsR != null) ? `L${st.repsL ?? '?'}/R${st.repsR ?? '?'}` : (st.reps ?? '—');
  return `${st.kg != null ? st.kg + UI.unit() : '—'} × ${repsStr}`;
}

const isTechniqueSet = (st) => !!st && !!st.technique;

// Badge + connected chips for today's (left column) drop/myo/myo-match/
// lengthened-partial set — same visual language as SessionDetailScreen's
// per-set chip rendering (colored rail, badge tag, bordered chips joined
// by →/↺, Total chip for myo variants). Chips wrap onto their own line
// within the flexible compare column instead of overflowing it.
function TechniqueBlock({ st, highlight = false, decline = false }) {
  if (!st || !st.technique) return null;
  const railColor = highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.4)' : 'rgba(var(--accent-rgb),0.35)';
  const badgeColor = highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.inkFaint;
  const badgeBg = highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'rgba(var(--accent-rgb),0.08)';
  const badgeBorder = highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : 'rgba(var(--accent-rgb),0.25)';
  const chipColor = highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : UI.ink;
  const chipBorder = highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hairStrong;
  const chipBg = highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : 'transparent';
  const unitColor = highlight ? UI.gold : decline ? 'rgba(var(--danger-rgb),0.6)' : UI.inkFaint;

  const tr = LB.techniqueRounds(st);

  if (tr.kind === 'lengthened_partial') {
    return (
      <div style={{ borderLeft: `2px solid ${railColor}`, paddingLeft: 10 }}>
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: badgeColor, background: badgeBg, border: `0.5px solid ${badgeBorder}`, borderRadius: 4, padding: '2px 6px' }}>{tr.badge}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <span style={{ background: chipBg, border: `1px solid ${chipBorder}`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontNum, fontSize: 12, color: chipColor }}>
            {st.kg ?? '—'}<span style={{ color: unitColor, fontSize: 10 }}>{UI.unit()}</span><span style={{ color: unitColor, margin: '0 1px' }}>×</span>{st.reps ?? '—'}
          </span>
          {tr.partials > 0 && <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi }}>+</span>}
          {tr.partials > 0 && <span style={{ border: `1px solid rgba(var(--accent-rgb),0.35)`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontNum, fontSize: 12, color: UI.inkSoft }}>{tr.partials}</span>}
          <StretchChipLib tr={tr} />
        </div>
      </div>
    );
  }

  if (tr.kind === 'weighted_stretch') {
    return (
      <div style={{ borderLeft: `2px solid ${railColor}`, paddingLeft: 10 }}>
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: badgeColor, background: badgeBg, border: `0.5px solid ${badgeBorder}`, borderRadius: 4, padding: '2px 6px' }}>{tr.badge}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <span style={{ background: chipBg, border: `1px solid ${chipBorder}`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontNum, fontSize: 12, color: chipColor }}>
            {st.kg ?? '—'}<span style={{ color: unitColor, fontSize: 10 }}>{UI.unit()}</span><span style={{ color: unitColor, margin: '0 1px' }}>×</span>{st.reps ?? '—'}
          </span>
          <StretchChipLib tr={tr} />
        </div>
      </div>
    );
  }

  const isMyo = tr.connector === '↺';
  const drops = tr.rounds;
  const finLabel = (tr.kind === 'myorep' || tr.kind === 'myorep_match')
    ? (di) => di === 0 ? 'act' : 'myo ' + di
    : tr.kind === 'amrap_variations'
    ? (di) => 'round ' + (di + 1)
    : (di) => di === 0 ? 'top' : 'drop ' + di;

  return (
    <div style={{ borderLeft: `2px solid ${railColor}`, paddingLeft: 10 }}>
      <div style={{ marginBottom: 6 }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: badgeColor, background: badgeBg, border: `0.5px solid ${badgeBorder}`, borderRadius: 4, padding: '2px 6px' }}>{tr.badge}</span>
      </div>
      <div style={{ display: isMyo ? 'inline-flex' : 'flex', flexDirection: isMyo ? 'column' : 'row', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          {drops.map((d, di) => (
            <React.Fragment key={di}>
              {di > 0 && <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi }}>{tr.connector}</span>}
              <span style={{
                background: di === 0 ? chipBg : 'transparent',
                border: `1px solid ${di === 0 || !isMyo ? chipBorder : UI.hair}`,
                borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontNum, fontSize: 12,
                color: di === 0 || !isMyo ? chipColor : UI.inkSoft,
                opacity: di === 0 ? 1 : (isMyo ? 0.7 : 0.75),
              }}>
                {(di === 0 || !isMyo) && <>{d.kg ?? '—'}<span style={{ color: unitColor, fontSize: 10 }}>{UI.unit()}</span><span style={{ color: unitColor, margin: '0 1px' }}>×</span></>}
                {d.reps ?? '—'}
              </span>
            </React.Fragment>
          ))}
        </div>
        {tr.totalReps > 0 && (
          <div style={{ border: `1px solid var(--accent)`, borderRadius: 4, padding: '3px 8px', fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.03em' }}>
            Total {tr.totalReps}
          </div>
        )}
        <FinisherTags drops={st.drops} labelFor={finLabel} />
      </div>
    </div>
  );
}

function SessionCompareScreen({ store, setStore, go, sessionId, compareId, back }) {
  const [pickerOpen, setPickerOpen] = useStateL(false);
  const [capturing, setCapturing] = useStateL(false);
  const captureRef = useRefL(null);
  // Screenshot background: same treatment as the HomeScreen watermark — VIPs
  // get their custom image, everyone else the faint centered ZANE mark.
  const _shotLogo = store.settings?.vipBackground || 'icons/zane-logo.png';
  const _shotIsCustom = _shotLogo !== 'icons/zane-logo.png';
  const _shotIsLight = ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark');
  const _shotDefaultStyle = { width: '85%', maxWidth: 320, opacity: _shotIsLight ? 0.14 : 0.04, filter: _shotIsLight ? 'grayscale(1)' : 'grayscale(1) brightness(3)', objectFit: 'contain' };
  const _shotCustomStyle = { width: '92%', maxWidth: 360, opacity: 0.16, objectFit: 'contain' };
  const _shotIsPaper = (store.settings?.darkMode ?? 'dark') === 'paper';
  const s = store.sessions.find(x => x.id === sessionId);
  const candidates = s ? sameDaySessions(store.sessions, s) : [];
  // Default comparison should look backward in time — comparing an older
  // session against a later one is never the intent when just opening the
  // screen. Only fall back to a later candidate if no earlier one exists.
  const earlierCandidates = s ? candidates.filter(c => (c.ended || '') < (s.ended || '')) : [];
  const cmp = (compareId && store.sessions.find(x => x.id === compareId)) || earlierCandidates[0] || candidates[0] || null;

  useEffectL(() => { if (!s || !cmp) go({ name: 'hist' }); }, [!!s, !!cmp]);

  // Either side may be outside the 70-day boot window (aggregates only, no
  // entries) — lazy-load on demand, same pattern as SessionDetailScreen.
  const needsEntries = (sess) => !!(sess && sess.ended && !(sess.entries || []).length && (sess.aggExercises || 0) > 0);
  useEffectL(() => {
    const need = [s, cmp].filter(needsEntries).map(x => x.id);
    if (!need.length) return;
    let on = true;
    LB.fetchSessionEntries(need)
      .then(bySession => {
        if (!on) return;
        setStore(st => ({
          ...st,
          sessions: st.sessions.map(x => (bySession[x.id] && !(x.entries || []).length) ? { ...x, entries: bySession[x.id] } : x),
        }));
      })
      .catch(() => {});
    return () => { on = false; };
  }, [s?.id, cmp?.id]);

  if (!s || !cmp) return null;

  const volA = LB.totalVolume(s, store.exercises, store.dailyLogs);
  const volB = LB.totalVolume(cmp, store.exercises, store.dailyLogs);
  const bwA = LB.bodyweightForDate(store.dailyLogs, s.date);
  const bwB = LB.bodyweightForDate(store.dailyLogs, cmp.date);
  const volDelta = volA - volB;
  const volDeltaRounded = Math.round(volDelta);
  const fmtDate = (d, opts) => LB.parseDate(d).toLocaleDateString('en-US', opts || { weekday: 'short', day: 'numeric', month: 'short' });
  // isCardio may be missing on entries loaded from DB (not a DB column) — fall
  // back to the exercise's movement_type, matching SessionDetailScreen.
  const isEntryCardio = (e) => !!e.isCardio || store.exercises.find(x => x.id === e.exId)?.movement_type === 'cardio';
  const entries = s.entries.filter(e => !isEntryCardio(e));
  const extraCmpEntries = cmp.entries.filter(e => !isEntryCardio(e) && !s.entries.some(se => se.exId === e.exId));

  const groups = LB.groupBySuperset(entries);

  // Same html2canvas flow as SessionDetailScreen's takeScreenshot. The
  // watermark here is a full-page centered background (HomeScreen-style)
  // rather than a foreground corner mark, so unlike SessionDetailScreen there's
  // no need to dodge it — knurl dividers always draw full width.
  const takeScreenshot = () => captureNodeAsPng(captureRef.current, {
    filename: `${s.dayName}-compare-${s.date.slice(0, 10)}.png`,
    setCapturing,
  });

  return (
    <Screen>
      <TopBar
        title="Compare sessions"
        onBack={() => go(back || { name: 'session', sessionId })}
        right={
          <button onClick={takeScreenshot} disabled={capturing} style={{
            background: 'transparent', border: `1px solid ${UI.hairStrong}`,
            borderRadius: 4, padding: '5px 10px', cursor: capturing ? 'default' : 'pointer',
            color: capturing ? UI.inkGhost : UI.inkSoft, lineHeight: 1,
            WebkitTapHighlightColor: 'transparent',
          }}>
            {capturing ? <span style={{ fontFamily: UI.fontUi, fontSize: 10 }}>…</span> : <i className="fa-solid fa-camera" style={{ fontSize: 11 }} />}
          </button>
        }
      />
      <Hairline />

      <div ref={captureRef} style={{
        padding: capturing ? '20px 22px 24px' : '14px 22px 28px', position: 'relative',
        // See SessionDetailScreen's captureRef div: the CSS grid never
        // survives html2canvas, SvgPaperGrid below replaces it for the export.
        backgroundColor: UI.bg, backgroundImage: capturing ? 'none' : 'var(--bg-texture)',
      }}>

        {capturing && _shotIsPaper && <SvgPaperGrid />}

        {/* Screenshot background watermark — centered, faint, full document (HomeScreen-style) */}
        {capturing && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
            <img src={_shotLogo} data-shot-avatar="1" style={_shotIsCustom ? _shotCustomStyle : _shotDefaultStyle} />
          </div>
        )}

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Screenshot-only header */}
        {capturing && (
          <div style={{ marginBottom: -4 }}>
            <div style={{ height: '0.5px', background: UI.gold, marginBottom: 14 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div className="micro" style={{ color: UI.inkFaint, letterSpacing: '0.12em', marginBottom: 4 }}>SESSION COMPARE</div>
                <div className="display" style={{ fontSize: 26 }}>{s.dayName}</div>
              </div>
              <div className="micro-gold" style={{ letterSpacing: '0.18em', marginTop: 2 }}>ZANE</div>
            </div>
            <div className="knurl" />
          </div>
        )}

        {/* Today / compared-to header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 3 }}>TODAY</div>
            <div className="display" style={{ fontSize: 18, lineHeight: 1.1 }}>{fmtDate(s.date)}</div>
          </div>
          <i className="fa-solid fa-code-compare" style={{ color: UI.inkFaint, fontSize: 13, flexShrink: 0 }} />
          <button onClick={candidates.length > 1 && !capturing ? () => setPickerOpen(true) : undefined} style={{
            flex: 1, minWidth: 0, textAlign: 'right', background: 'none', border: 'none',
            cursor: candidates.length > 1 ? 'pointer' : 'default', padding: 0, WebkitTapHighlightColor: 'transparent',
          }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 3 }}>COMPARED TO</div>
            <div className="display" style={{ fontSize: 18, lineHeight: 1.1, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {fmtDate(cmp.date)}
              {candidates.length > 1 && !capturing && <i className="fa-solid fa-chevron-down" style={{ fontSize: 10 }} />}
            </div>
          </button>
        </div>

        <div className="micro" style={{ textAlign: 'center', marginTop: -8, color: volDeltaRounded > 0 ? UI.gold : volDeltaRounded < 0 ? UI.danger : UI.inkFaint }}>
          {volDeltaRounded > 0 ? '↑' : volDeltaRounded < 0 ? '↓' : '—'} {Math.abs(volDeltaRounded).toLocaleString('en-US')} {UI.unit()} total volume
          {cmp.isDeload && <span style={{ color: UI.inkFaint }}> · compared session was a deload week</span>}
        </div>

        {capturing ? <KnurlCanvas /> : <div className="knurl" />}

        {/* Exercise entries */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(() => {
            const renderEntry = (entry, ei) => {
              const cmpEntry = cmp.entries.find(e => e.exId === entry.exId);
              const sets = (entry.sets || []).filter(st => !st.warmup);
              const cmpSets = (cmpEntry?.sets || []).filter(st => !st.warmup);
              const maxLen = Math.max(sets.length, cmpSets.length);
              // Mirror totalVolume's guard: mobility exercises don't contribute to
              // the header total, so their per-exercise delta must be 0 too (cardio
              // is already filtered out of the compare loop).
              const cmpExObj = store.exercises.find(x => x.id === entry.exId);
              const isMobilityEx = cmpExObj?.movement_type === 'mobility';
              const entryVolA = isMobilityEx ? 0 : LB.entryVolume(entry, true, cmpExObj, bwA);
              const entryVolB = (cmpEntry && !isMobilityEx) ? LB.entryVolume(cmpEntry, true, store.exercises.find(x => x.id === cmpEntry.exId), bwB) : 0;
              const entryDelta = entryVolA - entryVolB;
              const entryDeltaRounded = Math.round(entryDelta);
              return (
                <div key={entry.exId + ei}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 10 }}>
                    <span style={{ fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, letterSpacing: '0.05em', color: UI.ink }}>{entry.name}</span>
                    {cmpEntry ? (
                      <span className="num" style={{ fontSize: 12, color: entryDeltaRounded > 0 ? UI.gold : entryDeltaRounded < 0 ? UI.danger : UI.inkFaint, flexShrink: 0 }}>
                        {entryDeltaRounded > 0 ? '↑' : entryDeltaRounded < 0 ? '↓' : '—'} {Math.abs(entryDeltaRounded).toLocaleString('en-US')} {UI.unit()}
                      </span>
                    ) : (
                      <span className="micro" style={{ color: UI.inkFaint, flexShrink: 0 }}>NOT LOGGED THEN</span>
                    )}
                  </div>
                  {Array.from({ length: maxLen }).map((_, si) => {
                    const curr = sets[si];
                    const prev = cmpSets[si];
                    if (!curr && !prev) return null;
                    const prevDone = prev && !prev.skipped;
                    const improved = isImprovement(curr, prev);
                    const anyImprovementBefore = sets.slice(0, si).some((c, j) => isImprovement(c, cmpSets[j]));
                    const currSkipped = curr?.skipped && !curr?.done;
                    const declined = !anyImprovementBefore && (isDecline(curr, prev) || ((!curr || currSkipped) && prevDone));
                    // A "+" only signals a real improvement (extra set added to an
                    // exercise you already had a baseline for) when cmpEntry exists.
                    // If the whole exercise is new (NOT LOGGED THEN), there's nothing
                    // to have improved on, so every set stays neutral instead of "+".
                    const icon = !curr ? '−' : !prev ? (cmpEntry ? '+' : '—') : currSkipped && prevDone ? '↓' : curr && !currSkipped && prev?.skipped && !prev?.done ? '↑' : improved ? '↑' : declined ? '↓' : '—';
                    const iconColor = (improved || (!prev && cmpEntry && curr && !curr.skipped) || (curr && !curr.skipped && prev?.skipped)) ? 'var(--accent)'
                      : declined ? UI.danger : UI.inkFaint;
                    const isLastSet = si === maxLen - 1;
                    const currIsTechnique = isTechniqueSet(curr);

                    return (
                      <div key={si} style={{
                        display: 'grid', gridTemplateColumns: '20px 1fr 100px 18px',
                        alignItems: currIsTechnique ? 'start' : 'center', gap: 10, padding: '6px 0',
                        borderBottom: !isLastSet ? `0.5px solid ${UI.hair}` : 'none',
                      }}>
                        <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{si + 1}</span>
                        {currIsTechnique ? (
                          <TechniqueBlock st={curr} highlight={improved} decline={declined} />
                        ) : (
                          <span className="num" style={{ fontSize: 14, color: curr && (!curr.skipped || curr.done) ? UI.ink : UI.inkFaint }}>
                            {fmtCompareSet(curr)}
                          </span>
                        )}
                        <span className="num" style={{ fontSize: 13, color: UI.inkFaint, textAlign: 'right', alignSelf: 'center' }}>
                          {fmtCompareSet(prev)}
                        </span>
                        <span style={{ fontSize: 14, color: iconColor, textAlign: 'right', alignSelf: 'center' }}>{icon}</span>
                      </div>
                    );
                  })}
                </div>
              );
            };

            return groups.map((g, gi) => (
              <div key={gi}>
                {g.type === 'superset' ? (
                  <div style={{ borderLeft: `2px solid ${UI.goldSoft}`, paddingLeft: 12 }}>
                    <div className="micro" style={{ color: UI.gold, marginBottom: 10, letterSpacing: '0.12em' }}>{LB.supersetLabel(g.members.length)}</div>
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
        {capturing && <div style={{ height: '0.5px', background: UI.gold, marginTop: -4 }} />}

        {extraCmpEntries.length > 0 && !capturing && (
          <div className="micro" style={{ color: UI.inkFaint, marginTop: -10 }}>
            + {extraCmpEntries.length} exercise(s) only in the compared session
          </div>
        )}
        </div>
      </div>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title={s.dayName}>
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '55vh', overflowY: 'auto' }}>
          {candidates.map(c => {
            const active = c.id === cmp.id;
            return (
              <button key={c.id} onClick={() => { setPickerOpen(false); go({ name: 'compare', sessionId, compareId: c.id, back }); }} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '13px 2px', background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: `0.5px solid ${UI.hair}`, textAlign: 'left', WebkitTapHighlightColor: 'transparent',
              }}>
                <span className="num" style={{ fontSize: 14, color: active ? 'var(--accent)' : UI.ink }}>
                  {fmtDate(c.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                {active && <i className="fa-solid fa-check" style={{ color: 'var(--accent)', fontSize: 12 }} />}
              </button>
            );
          })}
        </div>
      </Sheet>
    </Screen>
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

  const groups = LB.groupBySuperset(entries);

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
        {(() => {
        const renderEntry = (entry, ei) => {
          const lastEntry = lastEntries.find(e => e.exId === entry.exId);
          const sets      = (entry.sets || []).filter(s => !s.warmup);
          const lastSets  = (lastEntry?.sets || []).filter(s => !s.warmup);
          const maxLen    = Math.max(sets.length, lastSets.length);
          const fmtSet = s => {
            if (!s) return '—';
            if (s.skipped && !s.done) return 'skipped';
            if (s.timeSec != null) return LB.fmtDuration(s.timeSec);
            const tr = LB.techniqueRounds(s);
            const strTxt = stretchText(tr);
            const strSfx = strTxt ? ` +stretch ${strTxt}` : '';
            if (tr.kind === 'weighted_stretch') {
              const main = `${s.kg != null ? s.kg + unit : '—'} × ${s.reps ?? '—'}`;
              return `${main}${strSfx}`;
            }
            if (tr.kind === 'lengthened_partial') {
              const main = `${s.kg != null ? s.kg + unit : '—'} × ${s.reps ?? '—'}`;
              return (tr.partials > 0 ? `${main} +${tr.partials} partials` : main) + strSfx;
            }
            if (tr.kind) {
              const chain = tr.rounds.map((d, di) => (tr.connector === '↺' && di > 0) ? (d.reps ?? '—') : `${d.kg ?? '—'}${unit}×${d.reps ?? '—'}`).join(` ${tr.connector} `);
              const suffix = tr.totalReps != null ? ` (${tr.totalReps})` : '';
              return (tr.partials > 0 ? `${chain}${suffix} +${tr.partials} partials` : `${chain}${suffix}`) + strSfx;
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
        };

        return groups.map((g, gi) => (
          <div key={gi}>
            {g.type === 'superset' ? (
              <div style={{ borderLeft: `2px solid ${UI.goldSoft}`, paddingLeft: 12 }}>
                <div className="micro" style={{ color: UI.gold, marginBottom: 10, letterSpacing: '0.12em' }}>{LB.supersetLabel(g.members.length)}</div>
                {g.members.map(({ entry: e, idx: i }) => renderEntry(e, i))}
              </div>
            ) : renderEntry(g.entry, g.idx)}
          </div>
        ));
        })()}
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
            {entry.supersetGroup && (
              <div className="micro" style={{ color: UI.gold, letterSpacing: '0.12em', marginBottom: 4 }}>
                {LB.supersetLabel(entries.filter(e => e.supersetGroup === entry.supersetGroup).length)}
              </div>
            )}
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
              const tr = LB.techniqueRounds(s, { exName: entry.name });
              const drops = tr.rounds;

              // Drop set
              if (tr.kind === 'drop') return (
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
                  <FinisherTags drops={s.drops} labelFor={(di) => di === 0 ? 'top' : 'drop ' + di} />
                </div>
                {i < entry.sets.length - 1 && <div className="knurl" />}
                </React.Fragment>
              );

              // Myo-rep / myo-rep match
              if (tr.kind === 'myorep' || tr.kind === 'myorep_match') {
                const isMatch = tr.kind === 'myorep_match';
                const total = tr.totalReps;
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
                    <FinisherTags drops={s.drops} labelFor={(di) => di === 0 ? 'act' : 'myo ' + di} />
                  </div>
                  {i < entry.sets.length - 1 && <div className="knurl" />}
                  </React.Fragment>
                );
              }

              // AMRAP Variations — show every round's label once ANY round
              // diverges from the exercise name, not just the diverging ones,
              // so the unvaried round (usually round 1) doesn't look unlabeled
              // next to its labeled neighbors.
              if (tr.kind === 'amrap_variations') {
                const anyVaried = tr.anyVaried;
                return (
                <React.Fragment key={i}>
                <div style={{ padding: '12px 0', opacity: done ? 1 : 0.35, transition: 'opacity 0.3s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span className="num" style={{ fontSize: 11, color: done ? UI.gold : UI.inkFaint }}>{i + 1}</span>
                    <span style={{ fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: UI.inkFaint, background: 'rgba(var(--accent-rgb),0.08)', border: `0.5px solid rgba(var(--accent-rgb),0.25)`, borderRadius: 4, padding: '2px 6px' }}>AMRAP</span>
                    <div style={{ marginLeft: 'auto' }}>
                      {done ? <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.8"><path d="M2 6l2.5 2.5L10 3"/></svg>
                             : <div style={{ width: 13, height: 13, borderRadius: '50%', border: `1px solid ${UI.hair}` }} />}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 4 }}>
                    {drops.map((d, di) => (
                      <React.Fragment key={di}>
                        {di > 0 && <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi, alignSelf: 'center' }}>→</span>}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          {anyVaried && (
                            <span className="num" style={{ fontSize: 8, color: UI.inkGhost, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label || entry.name}</span>
                          )}
                          <span className="num" style={{ fontSize: 13, color: UI.ink }}>{d.kg ?? '—'}<span style={{ fontSize: 10, color: UI.inkFaint }}>{unit}</span> × {d.reps ?? '—'}</span>
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                  <FinisherTags drops={s.drops} labelFor={(di) => 'round ' + (di + 1)} />
                </div>
                {i < entry.sets.length - 1 && <div className="knurl" />}
                </React.Fragment>
                );
              }

              // Lengthened partials
              if (tr.kind === 'lengthened_partial') {
                const partials = tr.partials;
                return (
                  <React.Fragment key={i}>
                  <div style={{ padding: '12px 0', opacity: done ? 1 : 0.35, transition: 'opacity 0.3s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span className="num" style={{ fontSize: 11, color: done ? UI.gold : UI.inkFaint }}>{i + 1}</span>
                      <span style={{ fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: UI.inkFaint, background: 'rgba(var(--accent-rgb),0.08)', border: `0.5px solid rgba(var(--accent-rgb),0.25)`, borderRadius: 4, padding: '2px 6px' }}>PARTIALS</span>
                      <div style={{ marginLeft: 'auto' }}>
                        {done ? <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.8"><path d="M2 6l2.5 2.5L10 3"/></svg>
                               : <div style={{ width: 13, height: 13, borderRadius: '50%', border: `1px solid ${UI.hair}` }} />}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                      <span className="num" style={{ fontSize: 13, color: UI.ink }}>{s.kg ?? '—'}<span style={{ fontSize: 10, color: UI.inkFaint }}>{unit}</span> × {s.reps ?? '—'}</span>
                      {partials > 0 && <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi }}>+</span>}
                      {partials > 0 && <span className="num" style={{ fontSize: 13, color: UI.inkSoft }}>{partials}<span style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, marginLeft: 3 }}>partials</span></span>}
                      {stretchText(tr) && <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi }}>+</span>}
                      {stretchText(tr) && <span className="num" style={{ fontSize: 13, color: UI.inkSoft }}>stretch {stretchText(tr)}</span>}
                    </div>
                  </div>
                  {i < entry.sets.length - 1 && <div className="knurl" />}
                  </React.Fragment>
                );
              }

              // Weighted stretch
              if (tr.kind === 'weighted_stretch') {
                return (
                  <React.Fragment key={i}>
                  <div style={{ padding: '12px 0', opacity: done ? 1 : 0.35, transition: 'opacity 0.3s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span className="num" style={{ fontSize: 11, color: done ? UI.gold : UI.inkFaint }}>{i + 1}</span>
                      <span style={{ fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: UI.inkFaint, background: 'rgba(var(--accent-rgb),0.08)', border: `0.5px solid rgba(var(--accent-rgb),0.25)`, borderRadius: 4, padding: '2px 6px' }}>STRETCH</span>
                      <div style={{ marginLeft: 'auto' }}>
                        {done ? <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.8"><path d="M2 6l2.5 2.5L10 3"/></svg>
                               : <div style={{ width: 13, height: 13, borderRadius: '50%', border: `1px solid ${UI.hair}` }} />}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                      <span className="num" style={{ fontSize: 13, color: UI.ink }}>{s.kg ?? '—'}<span style={{ fontSize: 10, color: UI.inkFaint }}>{unit}</span> × {s.reps ?? '—'}</span>
                      {stretchText(tr) && <span style={{ color: UI.inkGhost, fontSize: 10, fontFamily: UI.fontUi }}>+</span>}
                      {stretchText(tr) && <span className="num" style={{ fontSize: 13, color: UI.inkSoft }}>stretch {stretchText(tr)}</span>}
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
                    {/* Time-based set: one duration instead of kg x reps */}
                    <span className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>
                      {s.timeSec != null ? LB.fmtDuration(s.timeSec) : s.kg != null ? s.kg : '—'}
                    </span>
                    {s.timeSec == null && s.kg != null && <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em' }}>{unit}</span>}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    {s.timeSec != null ? null : unilateral ? (
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
            const lastEntry = (session.last_session_entries || []).find(e => e.exId === entry.exId);
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
                            : <><span className="num" style={{ fontSize: 16, color: UI.inkSoft }}>{s.timeSec != null ? LB.fmtDuration(s.timeSec) : s.kg != null ? s.kg : '—'}</span>
                               {s.timeSec == null && s.kg != null && <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{unit}</span>}</>
                          }
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, justifyContent: 'center' }}>
                          {!s.skipped && s.timeSec == null && <>
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
  const ex = store.exercises.find(e => e.id === exId);
  const isUni = !!ex?.unilateral;
  const logModeEx = LB.exerciseLogMode(ex);
  const isTimeEx = logModeEx === 'time';
  const isRepsOnlyEx = logModeEx === 'reps';
  const isAssistedEx = LB.isAssisted(ex);
  // Reps-only exercises have no weight, so open on the reps metric (the kg metric
  // would draw an empty chart).
  const [metric, setMetric] = useStateL(isRepsOnlyEx ? 'reps' : 'kg');
  const [showCount, setShowCount] = useStateL(20);
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
        if (!working.some(st => st.kg != null || st.reps != null || st.repsL != null || st.repsR != null || st.timeSec != null || st.done)) return null;
        return { id: s.id, ended: s.ended, sets: working };
      })
      .filter(Boolean);
    const seen = new Set(local.map(s => s.id));
    const remote = (serverRows || [])
      .filter(r => !seen.has(r.sessionId))
      .map(r => {
        const working = (r.sets || []).filter(st => !st.warmup && !st.skipped);
        if (!working.some(st => st.kg != null || st.reps != null || st.repsL != null || st.repsR != null || st.timeSec != null || st.done)) return null;
        return { id: r.sessionId, ended: r.ended, sets: working };
      })
      .filter(Boolean);
    return [...local, ...remote]
      .sort((a, b) => (Date.parse(a.ended) || 0) - (Date.parse(b.ended) || 0));
  }, [store.sessions, exId, dayId, serverRows]);

  const maxSets = Math.max(...allSessions.map(s => s.sets.length), 1);

  const getValue = (st) => {
    // Sessions of the same exercise don't all have the same working-set
    // count (a set added/removed on some day) — the per-set chart line
    // below reads sess.sets[si] up to the longest session's count, so a
    // shorter session's slot at that index is undefined, not a set with
    // null values.
    if (!st) return null;
    if (isTimeEx) return st.timeSec ?? null;
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
            {isTimeEx ? (
              <span className="micro" style={{ color: UI.gold, letterSpacing: '0.12em' }}>DURATION</span>
            ) : ['kg', 'reps'].map(m => (
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
                    {isTimeEx ? LB.fmtDuration(v) : Math.round(v)}
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
                  {sess.sets.map((st, si) => {
                    // Intensity-technique sets show every round, not just the
                    // first — this compact list used to silently drop the
                    // rest of a drop-set/myo-rep/AMRAP set's data.
                    const tr = LB.techniqueRounds(st);
                    return (
                    <span key={si} style={{
                      border: `1px solid ${UI.hair}`, borderRadius: 4, padding: '2px 7px',
                      fontFamily: UI.fontNum, fontSize: 11, color: UI.ink,
                    }}>
                      {st.timeSec != null ? (
                        LB.fmtDuration(st.timeSec)
                      ) : (tr.kind === 'lengthened_partial' || tr.kind === 'weighted_stretch') ? (
                        <>{st.kg ?? '—'}<span style={{ color: UI.inkFaint, fontSize: 9 }}>{UI.unit()}</span><span style={{ color: UI.inkFaint, margin: '0 1px' }}>×</span>{st.reps ?? '—'}</>
                      ) : tr.kind ? (
                        tr.rounds.map((d, di) => (
                          <React.Fragment key={di}>
                            {di > 0 && <span style={{ color: UI.inkFaint }}> {tr.connector} </span>}
                            {(tr.connector === '→' || di === 0) && <>{d.kg ?? '—'}<span style={{ color: UI.inkFaint, fontSize: 9 }}>{UI.unit()}</span><span style={{ color: UI.inkFaint, margin: '0 1px' }}>×</span></>}
                            {d.reps ?? '—'}
                          </React.Fragment>
                        ))
                      ) : (
                        <>{st.kg ?? '—'}<span style={{ color: UI.inkFaint, fontSize: 9 }}>{UI.unit()}</span><span style={{ color: UI.inkFaint, margin: '0 1px' }}>×</span>{isUni ? `L${st.repsL ?? '?'}/R${st.repsR ?? '?'}` : (st.reps ?? '—')}</>
                      )}
                      {tr.partials > 0 && <span style={{ color: UI.inkFaint }}> +{tr.partials}</span>}
                      {stretchText(tr) && <span style={{ color: UI.inkFaint }}> +stretch {stretchText(tr)}</span>}
                    </span>
                    );
                  })}
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


Object.assign(window.Screens, { LibraryScreen, ExerciseCreator, ExerciseDetailScreen, HistoryScreen, SessionDetailScreen, SessionCompareScreen, SpectatorScreen, ExerciseHistoryScreen });

window.EQUIPMENT_TYPES = EQUIPMENT_TYPES;
