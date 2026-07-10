/* Feature Map screen — an admin-curated catalog of what the app can do, shown
   inside the app. Admin-only entry point for now (Settings), but the data is
   world-readable so it can be opened to all users later with no code change.

   Data lives in zane_feature_map (one row per card). Reads are plain selects;
   the admin does authenticated INSERT/UPDATE/DELETE that RLS restricts to the
   admin email. Non-admins get a read-only view (no edit controls; RLS blocks
   writes anyway). Shares globals: UI, Screen, TopBar, Sheet, Btn, LB, React. */

const { useState: useStateFM, useEffect: useEffectFM, useMemo: useMemoFM } = React;

const FM_ADMIN_EMAIL = 'office@btc-prime.biz';

// Display order + metadata for the categories. Card rows reference a category
// by its id in the `cat` column; a card whose cat is not listed here still
// shows under a fallback "Other" group so nothing is ever hidden by mistake.
const FM_CATEGORIES = [
  { id: 'start',       label: 'Getting started',        icon: 'fa-flag-checkered', blurb: 'Create your account and get set up.' },
  { id: 'home',        label: 'Home & dashboard',       icon: 'fa-house',          blurb: 'What you see every time you open the app.' },
  { id: 'plans',       label: 'Training plans',         icon: 'fa-calendar-days',  blurb: 'Build the split you run week to week.' },
  { id: 'logging',     label: 'Logging a workout',      icon: 'fa-dumbbell',       blurb: 'Run and record the session itself.' },
  { id: 'library',     label: 'Exercise library',       icon: 'fa-list',           blurb: 'Your catalog of movements.' },
  { id: 'progress',    label: 'Progress & records',     icon: 'fa-chart-line',     blurb: 'See how the numbers are moving.' },
  { id: 'health',      label: 'Health & nutrition',     icon: 'fa-heart-pulse',    blurb: 'Track the stuff around training.' },
  { id: 'cardio',      label: 'Cardio',                 icon: 'fa-person-running', blurb: 'Plan and log conditioning work.' },
  { id: 'coachClient', label: 'Coaching (as a lifter)', icon: 'fa-user',           blurb: 'Work with a coach inside the app.' },
  { id: 'coachCoach',  label: 'Coaching (as a coach)',  icon: 'fa-user-tie',       blurb: 'Tools for running your roster.' },
  { id: 'settings',    label: 'Personalize & data',     icon: 'fa-gear',           blurb: 'Make it yours and keep it safe.' },
];

const FM_ROLES = {
  user:  { label: 'Lifter', color: 'var(--accent)' },
  coach: { label: 'Coach',  color: '#4aab97' },
  both:  { label: 'Both',   color: 'var(--accent)' },
};
const FM_ROLE_ORDER = ['user', 'coach', 'both'];

function fmCatMeta(id) {
  return FM_CATEGORIES.find(c => c.id === id) || { id, label: 'Other', icon: 'fa-cube', blurb: '' };
}

function FeatureMapScreen({ store, go }) {
  const isAdmin = store?.user?.email === FM_ADMIN_EMAIL;

  const [rows, setRows]       = useStateFM(null);   // null = loading
  const [loadErr, setLoadErr] = useStateFM('');
  const [query, setQuery]     = useStateFM('');
  const [roleFilter, setRole] = useStateFM('all');  // all | user | coach
  const [editing, setEditing] = useStateFM(null);   // card draft (with _isNew) or null
  const [busy, setBusy]       = useStateFM(false);

  useEffectFM(() => {
    let alive = true;
    (async () => {
      const { data, error } = await LB.supabase
        .from('zane_feature_map')
        .select('*')
        .order('cat', { ascending: true })
        .order('sort', { ascending: true });
      if (!alive) return;
      if (error) { setLoadErr(error.message || 'Could not load the feature map.'); setRows([]); return; }
      setRows(data || []);
    })();
    return () => { alive = false; };
  }, []);

  // Group + filter for rendering. Keep category order from FM_CATEGORIES, then
  // any unknown categories after, so a stray cat never disappears.
  const grouped = useMemoFM(() => {
    if (!rows) return [];
    const term = query.trim().toLowerCase();
    const match = (c) => {
      if (roleFilter === 'user'  && !(c.role === 'user'  || c.role === 'both')) return false;
      if (roleFilter === 'coach' && !(c.role === 'coach' || c.role === 'both')) return false;
      if (!term) return true;
      const hay = (c.name + ' ' + c.summary + ' ' + (c.actions || []).join(' ')).toLowerCase();
      return hay.includes(term);
    };
    const byCat = {};
    rows.forEach(c => { (byCat[c.cat] = byCat[c.cat] || []).push(c); });
    const knownIds = FM_CATEGORIES.map(c => c.id);
    const order = [...knownIds, ...Object.keys(byCat).filter(id => !knownIds.includes(id))];
    return order.map(id => {
      const all = (byCat[id] || []).slice().sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
      return { meta: fmCatMeta(id), all, shown: all.filter(match) };
    });
  }, [rows, query, roleFilter]);

  const total = rows ? rows.length : 0;
  const shownCount = grouped.reduce((n, g) => n + g.shown.length, 0);

  // ── writes ────────────────────────────────────────────────────────────────
  const persistSave = async (draft) => {
    setBusy(true);
    try {
      if (draft._isNew) {
        const maxSort = rows.filter(r => r.cat === draft.cat).reduce((m, r) => Math.max(m, r.sort), -1);
        const payload = { cat: draft.cat, name: draft.name.trim(), role: draft.role, summary: draft.summary.trim(), actions: cleanActions(draft.actions), sort: maxSort + 1 };
        const { data, error } = await LB.supabase.from('zane_feature_map').insert(payload).select().single();
        if (error) throw error;
        setRows(rs => [...rs, data]);
      } else {
        const patch = { cat: draft.cat, name: draft.name.trim(), role: draft.role, summary: draft.summary.trim(), actions: cleanActions(draft.actions), updated_at: new Date().toISOString() };
        const { error } = await LB.supabase.from('zane_feature_map').update(patch).eq('id', draft.id);
        if (error) throw error;
        setRows(rs => rs.map(r => r.id === draft.id ? { ...r, ...patch } : r));
      }
      setEditing(null);
    } catch (e) {
      alert('Could not save this card: ' + (e.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  };

  const persistDelete = async (id) => {
    setBusy(true);
    try {
      const { error } = await LB.supabase.from('zane_feature_map').delete().eq('id', id);
      if (error) throw error;
      setRows(rs => rs.filter(r => r.id !== id));
      setEditing(null);
    } catch (e) {
      alert('Could not delete this card: ' + (e.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  };

  // Swap sort with the previous/next card in the same category and persist both.
  const move = async (card, dir) => {
    const siblings = rows.filter(r => r.cat === card.cat).sort((a, b) => a.sort - b.sort);
    const idx = siblings.findIndex(r => r.id === card.id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    const a = { id: card.id, sort: swap.sort };
    const b = { id: swap.id, sort: card.sort };
    setRows(rs => rs.map(r => r.id === a.id ? { ...r, sort: a.sort } : r.id === b.id ? { ...r, sort: b.sort } : r));
    const r1 = await LB.supabase.from('zane_feature_map').update({ sort: a.sort }).eq('id', a.id);
    const r2 = await LB.supabase.from('zane_feature_map').update({ sort: b.sort }).eq('id', b.id);
    if (r1.error || r2.error) alert('Could not reorder, please reload.');
  };

  const startNew = (catId) => setEditing({ _isNew: true, cat: catId, name: '', role: 'user', summary: '', actions: [''] });

  return (
    <Screen>
      <TopBar
        title="Feature map"
        sub={isAdmin ? 'Admin' : 'What the app can do'}
        onBack={() => go({ name: 'settings' })}
        right={isAdmin ? (
          <button onClick={() => startNew(FM_CATEGORIES[0].id)} title="Add a card" style={fmIconBtn(true)}>
            <i className="fa-solid fa-plus" />
          </button>
        ) : null}
      />

      <div style={{ padding: '10px 22px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* summary + controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="micro" style={{ color: UI.inkFaint }}>
            {rows == null ? 'Loading…' : `${shownCount === total ? total : shownCount + ' / ' + total} card${total === 1 ? '' : 's'} · ${grouped.filter(g => g.all.length).length} areas`}
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: 12, fontSize: 12, color: UI.inkFaint, pointerEvents: 'none' }} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search features"
              style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 6, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, outline: 'none' }} />
          </div>
          <div style={{ display: 'inline-flex', border: `1px solid ${UI.hairStrong}`, borderRadius: 6, overflow: 'hidden', alignSelf: 'flex-start' }}>
            {[{ id: 'all', label: 'All' }, { id: 'user', label: 'Lifters' }, { id: 'coach', label: 'Coaches' }].map((t, i) => (
              <button key={t.id} onClick={() => setRole(t.id)} style={{
                padding: '7px 14px', border: 'none', borderLeft: i ? `1px solid ${UI.hair}` : 'none', cursor: 'pointer',
                background: roleFilter === t.id ? (t.id === 'coach' ? '#4aab97' : UI.gold) : 'transparent',
                color: roleFilter === t.id ? '#0a0805' : UI.inkSoft,
                fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        {loadErr && (
          <div style={{ fontSize: 13, color: UI.danger, fontFamily: UI.fontUi, padding: '10px 14px', background: 'rgba(var(--danger-rgb),0.06)', border: `1px solid rgba(var(--danger-rgb),0.25)`, borderRadius: 6 }}>{loadErr}</div>
        )}

        {rows != null && grouped.map(g => {
          // Show a section when it has cards under the current filter. When not
          // filtering, admins also see empty categories so they can add to any.
          const filtering = query.trim() !== '' || roleFilter !== 'all';
          const showSection = g.shown.length > 0 || (isAdmin && !filtering);
          if (!showSection) return null;
          return (
            <section key={g.meta.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 6 }}>
                <div style={{ width: 34, height: 34, borderRadius: 6, flexShrink: 0, display: 'grid', placeItems: 'center', border: `1px solid ${UI.hairStrong}`, background: 'rgba(var(--accent-rgb),0.08)', color: 'var(--accent)' }}>
                  <i className={`fa-solid ${g.meta.icon}`} style={{ fontSize: 15 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: UI.fontDisplay, fontSize: 20, fontWeight: 700, color: UI.ink, lineHeight: 1, letterSpacing: '0.02em', textTransform: 'uppercase' }}>{g.meta.label}</div>
                  <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 3 }}>{g.meta.blurb}</div>
                </div>
                <span className="num" style={{ fontSize: 13, color: UI.inkFaint }}>{g.all.length}</span>
              </div>

              {g.shown.map(card => (
                <FeatureCard key={card.id} card={card} isAdmin={isAdmin}
                  onEdit={() => setEditing({ ...card, actions: (card.actions || []).slice() })}
                  onUp={() => move(card, -1)} onDown={() => move(card, +1)} />
              ))}

              {isAdmin && (
                <button onClick={() => startNew(g.meta.id)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '9px 0', borderRadius: 6, cursor: 'pointer',
                  border: `1px dashed ${UI.hairStrong}`, background: 'transparent', color: UI.inkFaint,
                  fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
                }}>
                  <i className="fa-solid fa-plus" style={{ fontSize: 11 }} /> Add card to {g.meta.label}
                </button>
              )}
            </section>
          );
        })}
      </div>

      {editing && (
        <FeatureEditor draft={editing} busy={busy}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => persistSave(editing)}
          onDelete={editing._isNew ? null : () => persistDelete(editing.id)} />
      )}
    </Screen>
  );
}

function FeatureCard({ card, isAdmin, onEdit, onUp, onDown }) {
  const [open, setOpen] = useStateFM(false);
  const role = FM_ROLES[card.role] || FM_ROLES.user;
  return (
    <div style={{ position: 'relative', background: UI.bgCard, border: `1px solid ${UI.hair}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: role.color }} />
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        padding: '13px 14px 13px 16px', background: 'transparent', border: 'none',
        cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
      }}>
        <span style={{ flex: 1, minWidth: 0, fontFamily: UI.fontDisplay, fontSize: 17, fontWeight: 700, color: UI.ink, lineHeight: 1.15, letterSpacing: '0.01em', textTransform: 'uppercase' }}>{card.name}</span>
        <i className="fa-solid fa-chevron-down" style={{ flexShrink: 0, fontSize: 12, color: UI.inkFaint, transition: 'transform 0.2s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px 16px' }}>
          <span style={{ display: 'inline-block', fontFamily: UI.fontNum, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '3px 6px', borderRadius: 4, border: `1px solid ${role.color}`, color: role.color, background: `color-mix(in srgb, ${role.color} 12%, transparent)` }}>{role.label}</span>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, marginTop: 10 }}>{card.summary}</div>
          {(card.actions || []).length > 0 && (
            <ul style={{ listStyle: 'none', margin: '11px 0 0', padding: '10px 0 0', borderTop: `1px dashed ${UI.hair}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {card.actions.map((a, i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 16, fontSize: 12.5, color: UI.ink, fontFamily: UI.fontUi, lineHeight: 1.4 }}>
                  <i className="fa-solid fa-angle-right" style={{ position: 'absolute', left: 0, top: 3, fontSize: 10, color: 'var(--accent)' }} />
                  {a}
                </li>
              ))}
            </ul>
          )}
          {isAdmin && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: `0.5px solid ${UI.hair}` }}>
              <button onClick={onEdit} style={fmIconBtn(false)} title="Edit"><i className="fa-solid fa-pen" /></button>
              <button onClick={onUp} style={fmIconBtn(false)} title="Move up"><i className="fa-solid fa-arrow-up" /></button>
              <button onClick={onDown} style={fmIconBtn(false)} title="Move down"><i className="fa-solid fa-arrow-down" /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FeatureEditor({ draft, busy, onChange, onClose, onSave, onDelete }) {
  const [confirmDel, setConfirmDel] = useStateFM(false);
  const set = (patch) => onChange({ ...draft, ...patch });
  const setAction = (i, val) => set({ actions: draft.actions.map((a, j) => j === i ? val : a) });
  const addAction = () => set({ actions: [...draft.actions, ''] });
  const removeAction = (i) => set({ actions: draft.actions.filter((_, j) => j !== i) });
  const canSave = draft.name.trim().length > 0 && draft.cat && !busy;

  return (
    <Sheet open={true} onClose={onClose} title={draft._isNew ? 'New card' : 'Edit card'} accent>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Field label="Category">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {FM_CATEGORIES.map(c => (
              <button key={c.id} onClick={() => set({ cat: c.id })} style={{
                padding: '6px 10px', borderRadius: 999, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11,
                border: `1px solid ${draft.cat === c.id ? 'var(--accent)' : UI.hairStrong}`,
                background: draft.cat === c.id ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                color: draft.cat === c.id ? 'var(--accent)' : UI.inkSoft,
              }}>{c.label}</button>
            ))}
          </div>
        </Field>

        <Field label="Name">
          <TextInput value={draft.name} onChange={v => set({ name: v })} placeholder="Short feature name" autoFocus={draft._isNew} />
        </Field>

        <Field label="Who it is for">
          <div style={{ display: 'flex', gap: 8 }}>
            {FM_ROLE_ORDER.map(r => {
              const sel = draft.role === r;
              const col = FM_ROLES[r].color;
              return (
                <button key={r} onClick={() => set({ role: r })} style={{
                  flex: 1, padding: '9px 0', borderRadius: 4, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${sel ? col : UI.hairStrong}`,
                  background: sel ? `color-mix(in srgb, ${col} 16%, transparent)` : 'transparent',
                  color: sel ? col : UI.inkFaint,
                }}>{FM_ROLES[r].label}</button>
              );
            })}
          </div>
        </Field>

        <Field label="Summary">
          <textarea value={draft.summary} onChange={e => set({ summary: e.target.value })} rows={3} placeholder="One clear sentence about what it does."
            style={{ width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 6, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, lineHeight: 1.5, outline: 'none' }} />
        </Field>

        <Field label="What you can do">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {draft.actions.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={a} onChange={e => setAction(i, e.target.value)} placeholder={`Action ${i + 1}`}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none' }} />
                <button onClick={() => removeAction(i)} title="Remove" style={{ ...fmIconBtn(false), color: UI.danger }}><i className="fa-solid fa-xmark" /></button>
              </div>
            ))}
            <button onClick={addAction} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, padding: '2px 0' }}>
              <i className="fa-solid fa-plus" style={{ fontSize: 11 }} /> Add action
            </button>
          </div>
        </Field>

        <Btn onClick={onSave} style={{ opacity: canSave ? 1 : 0.4, pointerEvents: canSave ? 'auto' : 'none' }}>
          {busy ? 'Saving…' : (draft._isNew ? 'Add card' : 'Save changes')}
        </Btn>

        {onDelete && (
          confirmDel ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => setConfirmDel(false)} style={{ flex: 1 }}>Cancel</Btn>
              <Btn kind="ghost" onClick={onDelete} style={{ flex: 1, color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.3)' }}>Delete card</Btn>
            </div>
          ) : (
            <button onClick={() => setConfirmDel(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.danger, fontFamily: UI.fontUi, fontSize: 12, letterSpacing: '0.04em', padding: '2px 0', alignSelf: 'center' }}>
              Delete this card
            </button>
          )
        )}
      </div>
    </Sheet>
  );
}

// small square icon button used for admin card controls + header add
function fmIconBtn(accent) {
  return {
    width: 30, height: 30, borderRadius: 4, flexShrink: 0,
    border: `1px solid ${accent ? 'var(--accent)' : UI.hairStrong}`,
    background: accent ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
    color: accent ? 'var(--accent)' : UI.inkSoft,
    cursor: 'pointer', fontSize: 12,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  };
}

function cleanActions(actions) {
  return (actions || []).map(a => (a || '').trim()).filter(Boolean);
}

Object.assign(window.Screens, { FeatureMapScreen });
