/* Feature Map screen (Option A catalog + live publish flow).

   The master content lives in the versioned file src/feature-map-db.js
   (window.FEATURE_MAP). Everyone renders that catalog as the base, then layers
   the published overrides on top. Two DB layers:
     - zane_feature_map            = DRAFT: the admin's private working copy
       (hide / edit / add / reorder), merged over the catalog as a live preview.
     - zane_feature_map_published  = PUBLISHED: what everyone actually sees.
   The admin edits the draft, reviews the diff (unpublished changes), and hits
   Publish (publish_feature_map) to promote draft -> published, live for all with
   no deploy. "Discard all" (discard_feature_map) resets the draft to published.

   Viewers (non-admin + the public page) read the published layer through the
   get_public_feature_map RPC; the admin reads both draft and published directly.
   Occasionally the published layer is baked back into the catalog file by the
   bake workflow (tools/bake-feature-map.cjs) as housekeeping.

   Shares globals: UI, Screen, TopBar, Sheet, Btn, Field, TextInput, LB, React. */

const { useState: useStateFM, useEffect: useEffectFM, useMemo: useMemoFM, useRef: useRefFM } = React;

const FM_ADMIN_EMAIL = 'office@btc-prime.biz';
// Coach accent tint (deliberately distinct from the app accent). Single source
// so it is not hardcoded at each use site.
const FM_COACH_TINT = '#4aab97';
// #4aab97 is tuned for a dark canvas — deep enough on light/paper instead,
// same reasoning as the health charts' DIA_COLOR.
function fmCoachTint() {
  return isLightCanvasActive() ? '#1f7a68' : FM_COACH_TINT;
}

const FM_ROLES = {
  user:  { label: 'Lifter', color: 'var(--accent)' },
  coach: { label: 'Coach',  color: FM_COACH_TINT },
  both:  { label: 'Both',   color: 'var(--accent)' },
};
const FM_ROLE_ORDER = ['user', 'coach', 'both'];

function fmCatalog() { return window.FEATURE_MAP || { categories: [], cards: [] }; }
function fmCatMeta(id) {
  return fmCatalog().categories.find(c => c.id === id) || { id, label: 'Other', icon: 'fa-cube', blurb: '' };
}
function fmSlug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-');
}
// An override row that carries no content, no hide and no order is pointless: drop it.
function fmTrivial(r) {
  return !r.is_custom && !r.hidden && r.sort == null &&
    r.cat == null && r.name == null && r.role == null && r.summary == null && r.actions == null;
}
function fmCleanActions(a) { return (a || []).map(x => (x || '').trim()).filter(Boolean); }

// Build a uniform upsert payload: NOT-NULL columns (hidden, is_custom) always
// present, every nullable column explicit. Uniform shape matters because a
// batched upsert unions the row keys, and any row missing a NOT-NULL column
// would be sent as NULL and rejected.
function fmPayload(row) {
  return {
    card_id: row.card_id,
    hidden: !!row.hidden,
    is_custom: !!row.is_custom,
    cat: row.cat != null ? row.cat : null,
    name: row.name != null ? row.name : null,
    role: row.role != null ? row.role : null,
    summary: row.summary != null ? row.summary : null,
    actions: row.actions != null ? row.actions : null,
    sort: row.sort != null ? row.sort : null,
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

// Merge the catalog with the admin overrides into the effective, ordered list.
function fmMerge(catalog, ov) {
  const perCat = {};
  const out = [];
  for (const c of catalog.cards) {
    const idx = (perCat[c.cat] = (perCat[c.cat] == null ? 0 : perCat[c.cat] + 1));
    const o = ov[c.id];
    const edited = !!(o && (o.name != null || o.summary != null || o.role != null || o.actions != null || o.cat != null));
    out.push({
      id: c.id, isCustom: false,
      cat: (o && o.cat) || c.cat,
      name: (o && o.name != null) ? o.name : c.name,
      role: (o && o.role) || c.role,
      summary: (o && o.summary != null) ? o.summary : c.summary,
      actions: (o && o.actions != null) ? o.actions : c.actions,
      sort: (o && o.sort != null) ? o.sort : idx,
      hidden: o ? !!o.hidden : !!c.hidden, // override wins; else the catalog's own hidden flag
      edited,
    });
  }
  for (const id in ov) {
    const o = ov[id];
    if (!o.is_custom) continue;
    out.push({
      id, isCustom: true,
      cat: o.cat, name: o.name || '', role: o.role || 'user',
      summary: o.summary || '', actions: o.actions || [],
      sort: o.sort != null ? o.sort : 9999, hidden: !!o.hidden, edited: true,
    });
  }
  return out;
}

function FeatureMapScreen({ store, go }) {
  const isAdmin = store?.user?.email === FM_ADMIN_EMAIL;
  const catalog = fmCatalog();

  const [ov, setOv]           = useStateFM(null); // effective overrides rendered: draft (admin) or published (viewer); null = loading
  const [pub, setPub]         = useStateFM(null); // published overrides, admin only, for the unpublished-changes diff
  const [loadErr, setLoadErr] = useStateFM('');
  const [query, setQuery]     = useStateFM('');
  const [roleFilter, setRole] = useStateFM('all');
  const [editing, setEditing] = useStateFM(null);
  const [busy, setBusy]       = useStateFM(false);
  const [showHidden, setShowHidden] = useStateFM(false);
  const [pubSheet, setPubSheet] = useStateFM(false);
  const [catFilter, setCatFilter] = useStateFM('all');
  const [narrow, setNarrow] = useStateFM(typeof window !== 'undefined' ? window.innerWidth < 768 : true);
  const topRef = useRefFM(null);
  const scRef = useRefFM(null);
  const fabRef = useRefFM(null);

  useEffectFM(() => {
    let alive = true;
    (async () => {
      if (isAdmin) {
        // Admin edits the draft (what they see) and needs published for the diff.
        const [d, p] = await Promise.all([
          LB.supabase.from('zane_feature_map').select('*'),
          LB.supabase.from('zane_feature_map_published').select('*'),
        ]);
        if (!alive) return;
        if (d.error) { setLoadErr(d.error.message || 'Could not load your changes.'); setOv({}); setPub({}); return; }
        const dm = {}; (d.data || []).forEach(r => { dm[r.card_id] = r; });
        const pm = {}; (p.data || []).forEach(r => { pm[r.card_id] = r; });
        setOv(dm); setPub(pm);
      } else {
        // Viewers read the published layer through the login-free RPC.
        const { data, error } = await LB.supabase.rpc('get_public_feature_map');
        if (!alive) return;
        const map = {};
        if (!error) (data || []).forEach(r => { map[r.card_id] = r; });
        setOv(map); // fall back to the plain catalog on error (no error shown to viewers)
      }
    })();
    return () => { alive = false; };
  }, [isAdmin]);

  // Back-to-top: the Screen wrapper is the scroll container (its overflow:auto).
  // Grab it from the top sentinel's parent, watch its scroll, toggle the button.
  // The button stays mounted and we flip only its opacity imperatively: driving
  // this through React state would re-render the whole list every time the
  // scroll crosses the threshold, and that mid-swipe DOM churn stalls iOS
  // momentum scrolling right around the first category. Opacity on a fixed,
  // GPU-composited element never touches layout, so the swipe runs to the top.
  useEffectFM(() => {
    const sc = topRef.current && topRef.current.parentElement;
    if (!sc) return;
    scRef.current = sc;
    const onScroll = () => {
      const fab = fabRef.current; if (!fab) return;
      const show = sc.scrollTop > 500;
      fab.style.opacity = show ? '1' : '0';
      fab.style.pointerEvents = show ? 'auto' : 'none';
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => sc.removeEventListener('scroll', onScroll);
  }, []);
  const scrollToTop = () => {
    const sc = scRef.current; if (!sc) return;
    if (sc.scrollTo) sc.scrollTo({ top: 0, behavior: 'smooth' }); else sc.scrollTop = 0;
  };
  // Category filter is a dropdown on narrow screens (the phone frame), chips on wide.
  useEffectFM(() => {
    const onR = () => setNarrow(window.innerWidth < 768);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  const merged = useMemoFM(() => ov ? fmMerge(catalog, ov) : [], [ov, catalog]);
  const mergedPub = useMemoFM(() => (isAdmin && pub) ? fmMerge(catalog, pub) : [], [isAdmin, pub, catalog]);

  // Unpublished changes: diff the admin's draft against the published layer.
  // Content edits (name/summary/role/actions/cat/hidden) surface per card;
  // reordering surfaces once per category (comparing the order of the cards the
  // two layers share, so adding/removing a card does not read as a reorder too).
  const changes = useMemoFM(() => {
    if (!isAdmin || !pub || ov === null) return [];
    const dById = {}; merged.forEach(c => { dById[c.id] = c; });
    const pById = {}; mergedPub.forEach(c => { pById[c.id] = c; });
    const ids = Array.from(new Set([...Object.keys(dById), ...Object.keys(pById)]));
    const out = [];
    for (const id of ids) {
      const d = dById[id], p = pById[id];
      if (d && !p) { out.push({ kind: 'card', id, name: d.name, cat: d.cat, isNew: true, tags: ['New'] }); continue; }
      if (!d && p) { out.push({ kind: 'card', id, name: p.name, cat: p.cat, isRemoved: true, tags: ['Removed'] }); continue; }
      const tags = [];
      if (d.name !== p.name || d.summary !== p.summary || d.role !== p.role || d.cat !== p.cat
          || JSON.stringify(d.actions || []) !== JSON.stringify(p.actions || [])) tags.push('Edited');
      if (!!d.hidden !== !!p.hidden) tags.push(d.hidden ? 'Hidden' : 'Shown');
      if (tags.length) out.push({ kind: 'card', id, name: d.name, cat: d.cat, tags });
    }
    const seq = (list, catId) => list.filter(c => c.cat === catId).slice()
      .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name)).map(c => c.id);
    for (const catId of Array.from(new Set(merged.map(c => c.cat)))) {
      const dAll = seq(merged, catId), pAll = seq(mergedPub, catId);
      const common = new Set(dAll.filter(id => pAll.includes(id)));
      const dSeq = dAll.filter(id => common.has(id)), pSeq = pAll.filter(id => common.has(id));
      if (dSeq.length > 1 && JSON.stringify(dSeq) !== JSON.stringify(pSeq)) {
        out.push({ kind: 'reorder', cat: catId, name: fmCatMeta(catId).label, tags: ['Reordered'] });
      }
    }
    return out;
  }, [isAdmin, pub, ov, merged, mergedPub, catalog]);
  const unpublishedCount = changes.length;

  const grouped = useMemoFM(() => {
    const term = query.trim().toLowerCase();
    const match = (c) => {
      if (roleFilter === 'user'  && !(c.role === 'user'  || c.role === 'both')) return false;
      if (roleFilter === 'coach' && !(c.role === 'coach' || c.role === 'both')) return false;
      if (!term) return true;
      return (c.name + ' ' + c.summary + ' ' + (c.actions || []).join(' ')).toLowerCase().includes(term);
    };
    const byCat = {};
    merged.forEach(c => { (byCat[c.cat] = byCat[c.cat] || []).push(c); });
    const knownIds = catalog.categories.map(c => c.id);
    const order = [...knownIds, ...Object.keys(byCat).filter(id => !knownIds.includes(id))];
    return order.map(id => {
      const all = (byCat[id] || []).slice().sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
      // viewers never see hidden cards; admin sees them only when "show hidden" is on
      const visible = all.filter(c => (!c.hidden || (isAdmin && showHidden)) && match(c));
      return { meta: fmCatMeta(id), all, visible };
    });
  }, [merged, query, roleFilter, isAdmin, showHidden, catalog]);

  const catChips = useMemoFM(() =>
    catalog.categories
      .map(c => ({ id: c.id, label: c.label, count: merged.filter(m => m.cat === c.id && !m.hidden).length }))
      .filter(c => c.count > 0),
    [catalog, merged]);

  const hiddenCount = merged.filter(c => c.hidden).length;
  const visibleTotal = merged.filter(c => !c.hidden).length;
  const shownCount = grouped.reduce((n, g) => n + g.visible.length, 0);

  // ── writes (admin) ─────────────────────────────────────────────────────────
  const writeOverride = async (card_id, patch) => {
    const existing = ov[card_id] || { card_id };
    const row = { ...existing, ...patch, card_id };
    if (fmTrivial(row)) return removeOverride(card_id);
    row.updated_at = new Date().toISOString();
    const payload = fmPayload(row);
    setBusy(true);
    try {
      const { error } = await LB.supabase.from('zane_feature_map').upsert(payload, { onConflict: 'card_id' });
      if (error) throw error;
      setOv(m => ({ ...m, [card_id]: row }));
      return true;
    } catch (e) { alert('Could not save: ' + (e.message || 'unknown error')); return false; }
    finally { setBusy(false); }
  };
  const removeOverride = async (card_id) => {
    if (!ov[card_id]) { setOv(m => { const n = { ...m }; delete n[card_id]; return n; }); return true; }
    setBusy(true);
    try {
      const { error } = await LB.supabase.from('zane_feature_map').delete().eq('card_id', card_id);
      if (error) throw error;
      setOv(m => { const n = { ...m }; delete n[card_id]; return n; });
      return true;
    } catch (e) { alert('Could not save: ' + (e.message || 'unknown error')); return false; }
    finally { setBusy(false); }
  };

  const saveEditor = async (draft) => {
    const content = { cat: draft.cat, name: draft.name.trim(), role: draft.role, summary: draft.summary.trim(), actions: fmCleanActions(draft.actions) };
    let okp;
    if (draft.isCustom) {
      okp = await writeOverride(draft.id, { ...content, is_custom: true, sort: draft._sort != null ? draft._sort : draft.sort });
    } else {
      okp = await writeOverride(draft.id, content); // edit a catalog card (preserves hidden/sort)
    }
    if (okp) setEditing(null);
  };
  const revertEdit = async (card_id) => {
    const ok = await writeOverride(card_id, { cat: null, name: null, role: null, summary: null, actions: null });
    if (ok) setEditing(null);
  };

  const toggleHide = (card) => {
    if (card.isCustom) return; // custom cards are deleted, not hidden
    writeOverride(card.id, { hidden: !card.hidden });
  };
  const deleteCustom = (card) => { removeOverride(card.id); };

  // Catalog default index per card id (position within its category). Used to
  // drop a redundant sort override when a card lands back on its default slot.
  const catalogIdx = useMemoFM(() => {
    const m = {}, per = {};
    for (const c of catalog.cards) { const i = (per[c.cat] = per[c.cat] == null ? 0 : per[c.cat] + 1); m[c.id] = i; }
    return m;
  }, [catalog]);

  // Persist a batch of { card_id, sort } order changes in one round-trip.
  const applyOrder = async (changes) => {
    const upserts = [], deletes = [], next = { ...ov };
    for (const { card_id, sort } of changes) {
      const row = { ...(ov[card_id] || { card_id }), card_id, sort };
      if (fmTrivial(row)) { deletes.push(card_id); delete next[card_id]; }
      else { row.updated_at = new Date().toISOString(); upserts.push(fmPayload(row)); next[card_id] = row; }
    }
    setBusy(true);
    try {
      if (upserts.length) { const { error } = await LB.supabase.from('zane_feature_map').upsert(upserts, { onConflict: 'card_id' }); if (error) throw error; }
      if (deletes.length) { const { error } = await LB.supabase.from('zane_feature_map').delete().in('card_id', deletes); if (error) throw error; }
      setOv(next);
    } catch (e) { alert('Could not save the new order: ' + (e.message || 'unknown error')); }
    finally { setBusy(false); }
  };

  // Drag reorder within one category. from/to are indices into the shown cards
  // (hidden ones keep their relative order after the visible list). visList is
  // the exact rendered list (g.visible), so the indices line up even when a
  // search or role filter is active (audit M3); fall back to the full list.
  const reorderCategory = async (catId, from, to, visList) => {
    const vis = visList || merged.filter(c => c.cat === catId && (!c.hidden || showHidden)).sort((a, b) => a.sort - b.sort);
    if (from < 0 || to < 0 || from >= vis.length || to >= vis.length || from === to) return;
    // Reuse the existing sort "slots" (ascending) and re-assign them to the new
    // order. Only cards in the moved range change; hidden cards keep their sort,
    // and no new numbers are introduced (so no gaps or collisions).
    const slots = vis.map(c => c.sort);
    const arr = vis.slice(); const [moved] = arr.splice(from, 1); arr.splice(to, 0, moved);
    const changes = [];
    arr.forEach((c, i) => {
      const target = slots[i];
      if (c.sort === target) return; // unchanged
      const backToDefault = !c.isCustom && catalogIdx[c.id] === target;
      changes.push({ card_id: c.id, sort: backToDefault ? null : target });
    });
    if (changes.length) await applyOrder(changes);
  };

  const startNew = (catId) => {
    const maxSort = merged.filter(c => c.cat === catId).reduce((m, c) => Math.max(m, c.sort), -1);
    setEditing({ _isNew: true, isCustom: true, id: 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), cat: catId, name: '', role: 'user', summary: '', actions: [''], _sort: maxSort + 1 });
  };

  // Promote the draft to the published layer: live for everyone, no deploy.
  const publishNow = async () => {
    setBusy(true);
    try {
      const { error } = await LB.supabase.rpc('publish_feature_map');
      if (error) throw error;
      setPub({ ...ov }); // published now mirrors the draft -> zero unpublished changes
      setPubSheet(false);
    } catch (e) { alert('Could not publish: ' + (e.message || 'unknown error')); }
    finally { setBusy(false); }
  };
  // Reset the whole draft back to the published state.
  const discardAll = async () => {
    setBusy(true);
    try {
      const { error } = await LB.supabase.rpc('discard_feature_map');
      if (error) throw error;
      setOv({ ...pub }); // draft resets to published
      setPubSheet(false);
    } catch (e) { alert('Could not discard: ' + (e.message || 'unknown error')); }
    finally { setBusy(false); }
  };
  // Revert one card's content + hidden to the published state (keeps its order;
  // order is discarded separately via the per-category reorder entry).
  const revertCardToPublished = (id) => {
    const p = pub[id];
    return p
      ? writeOverride(id, { cat: p.cat, name: p.name, role: p.role, summary: p.summary, actions: p.actions, hidden: !!p.hidden, is_custom: !!p.is_custom })
      : writeOverride(id, { cat: null, name: null, role: null, summary: null, actions: null, hidden: false });
  };
  // Revert one category's order to the published order.
  const discardCategoryOrder = (catId) => {
    const cards = merged.filter(c => c.cat === catId);
    return applyOrder(cards.map(c => ({ card_id: c.id, sort: (pub[c.id] && pub[c.id].sort != null) ? pub[c.id].sort : null })));
  };
  // Discard a single unpublished change from the review sheet.
  const discardChange = (ch) => {
    if (ch.kind === 'reorder') return discardCategoryOrder(ch.cat);
    if (ch.isNew) return removeOverride(ch.id); // custom card added in draft, not published -> delete
    if (ch.isRemoved) { // custom card in published, removed in draft -> restore
      const p = pub[ch.id];
      return writeOverride(ch.id, { cat: p.cat, name: p.name, role: p.role, summary: p.summary, actions: p.actions, hidden: !!p.hidden, is_custom: true, sort: p.sort });
    }
    return revertCardToPublished(ch.id);
  };

  const loading = ov === null;

  return (
    <Screen>
      <div ref={topRef} aria-hidden="true" style={{ height: 0 }} />
      <TopBar
        title="Feature map"
        sub={isAdmin ? 'Admin preview' : 'What the app can do'}
        onBack={() => go({ name: 'settings' })}
        right={isAdmin ? (
          <button onClick={() => startNew(catalog.categories[0]?.id || 'start')} title="Add a card" style={fmIconBtn(true)}>
            <i className="fa-solid fa-plus" />
          </button>
        ) : null}
      />

      <div style={{ padding: '10px 22px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* summary + admin status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="micro" style={{ color: UI.inkFaint }}>
            {loading ? 'Loading…' : `${shownCount === visibleTotal ? visibleTotal : shownCount + ' / ' + visibleTotal} card${visibleTotal === 1 ? '' : 's'} · ${grouped.filter(g => g.all.length).length} areas`}
          </div>

          {isAdmin && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              {unpublishedCount === 0 ? (
                <span style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.inkFaint, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <i className="fa-solid fa-circle-check" style={{ fontSize: 11, color: 'var(--accent)' }} /> Published, nothing pending
                </span>
              ) : (
                <button onClick={() => setPubSheet(true)} style={{ ...fmPill(true), padding: '6px 12px' }}>
                  <i className="fa-solid fa-cloud-arrow-up" style={{ fontSize: 11, marginRight: 6 }} />
                  {unpublishedCount} unpublished change{unpublishedCount === 1 ? '' : 's'} · Review &amp; publish
                </button>
              )}
              {hiddenCount > 0 && (
                <button onClick={() => setShowHidden(v => !v)} style={fmPill(showHidden)}>
                  <i className={`fa-solid ${showHidden ? 'fa-eye' : 'fa-eye-slash'}`} style={{ fontSize: 10, marginRight: 5 }} />
                  {showHidden ? 'Hiding hidden' : `Show hidden (${hiddenCount})`}
                </button>
              )}
            </div>
          )}

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: 12, fontSize: 12, color: UI.inkFaint, pointerEvents: 'none' }} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search features"
              style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 6, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, outline: 'none' }} />
          </div>
          <div style={{ display: 'inline-flex', border: `1px solid ${UI.hairStrong}`, borderRadius: 6, overflow: 'hidden', alignSelf: 'flex-start' }}>
            {[{ id: 'all', label: 'All' }, { id: 'user', label: 'Lifters' }, { id: 'coach', label: 'Coaches' }].map((t, i) => (
              <button key={t.id} onClick={() => setRole(t.id)} style={{
                padding: '7px 14px', border: 'none', borderLeft: i ? `1px solid ${UI.hair}` : 'none', cursor: 'pointer',
                background: roleFilter === t.id ? (t.id === 'coach' ? fmCoachTint() : UI.gold) : 'transparent',
                textShadow: roleFilter === t.id ? 'none' : 'var(--text-lift)',
                color: roleFilter === t.id ? (t.id === 'coach' ? (isLightCanvasActive() ? '#f5f5f5' : '#0a0805') : 'var(--accent-ink)') : UI.inkSoft,
                fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>{t.label}</button>
            ))}
          </div>

          {catChips.length > 1 && (narrow ? (
            <select value={catFilter} onChange={e => { setCatFilter(e.target.value); scrollToTop(); }}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, outline: 'none' }}>
              <option value="all">All categories ({visibleTotal})</option>
              {catChips.map(c => <option key={c.id} value={c.id}>{c.label} ({c.count})</option>)}
            </select>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button onClick={() => { setCatFilter('all'); scrollToTop(); }} style={fmPill(catFilter === 'all')}>All</button>
              {catChips.map(c => (
                <button key={c.id} onClick={() => { setCatFilter(c.id); scrollToTop(); }} style={fmPill(catFilter === c.id)}>
                  {c.label}<span className="num" style={{ marginLeft: 5, opacity: 0.75 }}>{c.count}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {loadErr && (
          <div style={{ fontSize: 13, color: UI.danger, fontFamily: UI.fontUi, padding: '10px 14px', background: 'rgba(var(--danger-rgb),0.06)', border: `1px solid rgba(var(--danger-rgb),0.25)`, borderRadius: 6 }}>{loadErr}</div>
        )}

        {!loading && grouped.map(g => {
          const filtering = query.trim() !== '' || roleFilter !== 'all';
          const inCat = catFilter === 'all' || g.meta.id === catFilter;
          const showSection = inCat && (g.visible.length > 0 || (isAdmin && !filtering));
          if (!showSection) return null;
          return (
            <section key={g.meta.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 6 }}>
                <div style={{ width: 34, height: 34, borderRadius: 6, flexShrink: 0, display: 'grid', placeItems: 'center', border: `1px solid ${UI.hairStrong}`, background: 'rgba(var(--accent-rgb),0.16)', color: 'var(--accent)' }}>
                  <i className={`fa-solid ${g.meta.icon}`} style={{ fontSize: 15 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: UI.fontDisplay, fontSize: 20, fontWeight: 700, color: UI.ink, lineHeight: 1, letterSpacing: '0.02em', textTransform: 'uppercase' }}>{g.meta.label}</div>
                  <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 3 }}>{g.meta.blurb}</div>
                </div>
                <span className="num" style={{ fontSize: 13, color: UI.inkFaint }}>{g.all.filter(c => !c.hidden).length}</span>
              </div>

              {(() => {
                const items = g.visible.map(card => (
                  <FeatureCard key={card.id} card={card} isAdmin={isAdmin}
                    onEdit={() => setEditing({ ...card, actions: (card.actions || []).slice() })}
                    onToggleHide={() => toggleHide(card)} onDelete={() => deleteCustom(card)} />
                ));
                const listStyle = { display: 'flex', flexDirection: 'column', gap: 12 };
                return isAdmin
                  ? <ReorderList onReorder={(f, t) => reorderCategory(g.meta.id, f, t, g.visible)} style={listStyle}>{items}</ReorderList>
                  : <div style={listStyle}>{items}</div>;
              })()}

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
          onSave={() => saveEditor(editing)}
          onRevert={(!editing._isNew && !editing.isCustom && editing.edited) ? () => revertEdit(editing.id) : null} />
      )}

      {isAdmin && pubSheet && (
        <FeaturePublishSheet changes={changes} busy={busy}
          onClose={() => setPubSheet(false)}
          onDiscard={discardChange} onDiscardAll={discardAll} onPublish={publishNow} />
      )}

      <button ref={fabRef} onClick={scrollToTop} aria-label="Back to top" title="Back to top" style={{
        position: 'fixed', zIndex: 60,
        right: 'max(16px, calc(50vw - 204px))',
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        width: 46, height: 46, borderRadius: '50%',
        border: `1px solid ${UI.hairStrong}`, background: UI.bgCard, color: 'var(--accent)',
        textShadow: 'none',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)', WebkitTapHighlightColor: 'transparent',
        opacity: 0, pointerEvents: 'none', transition: 'opacity 0.2s ease',
      }}>
        <i className="fa-solid fa-chevron-up" />
      </button>
    </Screen>
  );
}

function FeatureCard({ card, isAdmin, onEdit, onToggleHide, onDelete }) {
  const [open, setOpen] = useStateFM(false);
  const role = { ...(FM_ROLES[card.role] || FM_ROLES.user) };
  if (card.role === 'coach') role.color = fmCoachTint();
  const muted = card.hidden;
  return (
    <div data-reorder-item="true" style={{ position: 'relative', background: UI.bgCard, border: `1px solid ${UI.hair}`, borderRadius: 8, overflow: 'hidden', opacity: muted ? 0.55 : 1 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: role.color }} />
      <div style={{ display: 'flex', alignItems: 'center', paddingLeft: isAdmin ? 6 : 0 }}>
        {isAdmin && <DragHandle style={{ height: 46 }} />}
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10,
          padding: '13px 14px 13px ' + (isAdmin ? '6px' : '16px'), background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
        }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: UI.fontDisplay, fontSize: 17, fontWeight: 700, color: UI.ink, lineHeight: 1.15, letterSpacing: '0.01em', textTransform: 'uppercase' }}>{card.name}</span>
          {isAdmin && card.hidden && <span style={fmTag(UI.inkFaint)}>Hidden</span>}
          {isAdmin && card.isCustom && <span style={fmTag('var(--accent)')}>Custom</span>}
          {isAdmin && !card.isCustom && card.edited && <span style={fmTag('var(--accent)')}>Edited</span>}
          <i className="fa-solid fa-chevron-down" style={{ flexShrink: 0, fontSize: 12, color: UI.inkFaint, transition: 'transform 0.2s ease', transform: open ? 'rotate(180deg)' : 'none' }} />
        </button>
      </div>
      {open && (
        <div style={{ padding: isAdmin ? '0 14px 14px 34px' : '0 14px 14px 16px' }}>
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
            <div data-reorder-ignore="true" style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: `var(--hair-width) solid ${UI.hair}`, flexWrap: 'wrap' }}>
              <button onClick={onEdit} style={{ ...fmIconBtn(false), width: 'auto', padding: '0 10px' }} title="Edit"><i className="fa-solid fa-pen" /> <span style={{ fontFamily: UI.fontUi, fontSize: 11, marginLeft: 4 }}>Edit</span></button>
              {card.isCustom
                ? <button onClick={onDelete} style={{ ...fmIconBtn(false), width: 'auto', padding: '0 10px', color: UI.danger }} title="Delete custom card"><i className="fa-solid fa-trash" /> <span style={{ fontFamily: UI.fontUi, fontSize: 11, marginLeft: 4 }}>Delete</span></button>
                : <button onClick={onToggleHide} style={{ ...fmIconBtn(false), width: 'auto', padding: '0 10px' }} title={card.hidden ? 'Unhide' : 'Hide'}><i className={`fa-solid ${card.hidden ? 'fa-eye' : 'fa-eye-slash'}`} /> <span style={{ fontFamily: UI.fontUi, fontSize: 11, marginLeft: 4 }}>{card.hidden ? 'Unhide' : 'Hide'}</span></button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FeatureEditor({ draft, busy, onChange, onClose, onSave, onRevert }) {
  const set = (patch) => onChange({ ...draft, ...patch });
  const setAction = (i, val) => set({ actions: draft.actions.map((a, j) => j === i ? val : a) });
  const canSave = draft.name.trim().length > 0 && draft.cat && !busy;
  return (
    <Sheet open={true} onClose={onClose} title={draft._isNew ? 'New card' : 'Edit card'} accent>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Field label="Category">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {fmCatalog().categories.map(c => (
              <button key={c.id} onClick={() => set({ cat: c.id })} style={{
                padding: '6px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11,
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
              const sel = draft.role === r; const col = FM_ROLES[r].color;
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
                <button onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })} title="Remove" style={{ ...fmIconBtn(false), color: UI.danger }}><i className="fa-solid fa-xmark" /></button>
              </div>
            ))}
            <button onClick={() => set({ actions: [...draft.actions, ''] })} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, padding: '2px 0' }}>
              <i className="fa-solid fa-plus" style={{ fontSize: 11 }} /> Add action
            </button>
          </div>
        </Field>

        <Btn onClick={onSave} style={{ opacity: canSave ? 1 : 0.4, pointerEvents: canSave ? 'auto' : 'none' }}>
          {busy ? 'Saving…' : (draft._isNew ? 'Add card' : 'Save changes')}
        </Btn>

        {onRevert && (
          <button onClick={onRevert} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, letterSpacing: '0.04em', padding: '2px 0', alignSelf: 'center' }}>
            Revert this card to the default text
          </button>
        )}
      </div>
    </Sheet>
  );
}

// Review sheet for the admin: lists the unpublished changes (draft vs published),
// each discardable, plus Discard all and Publish.
function FeaturePublishSheet({ changes, busy, onClose, onDiscard, onDiscardAll, onPublish }) {
  const [confirmAll, setConfirmAll] = useStateFM(false);
  const [confirmPub, setConfirmPub] = useStateFM(false);
  const tagColor = (t) => (t === 'Removed' || t === 'Hidden') ? UI.danger : (t === 'Reordered') ? fmCoachTint() : 'var(--accent)';
  const n = changes.length;
  return (
    <Sheet open={true} onClose={onClose} title={'Review & publish'} accent>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
          {n === 0
            ? 'You are all caught up. Nothing is waiting to be published.'
            : 'These changes are only visible to you. Publishing makes them live for everyone, in the app and on the public page.'}
        </div>

        {n > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {changes.map(ch => (
              <div key={ch.kind === 'reorder' ? 'reorder-' + ch.cat : 'card-' + ch.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ch.kind === 'reorder' ? 'Reordered: ' + ch.name : ch.name}
                  </div>
                  <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                    {ch.tags.map(t => <span key={t} style={fmTag(tagColor(t))}>{t}</span>)}
                  </div>
                </div>
                <button onClick={() => onDiscard(ch)} disabled={busy} title="Discard this change"
                  style={{ ...fmIconBtn(false), width: 'auto', padding: '0 10px', color: UI.inkFaint }}>
                  <i className="fa-solid fa-rotate-left" /> <span style={{ fontFamily: UI.fontUi, fontSize: 11, marginLeft: 4 }}>Discard</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {n === 0 ? (
          <Btn kind="ghost" onClick={onClose}>Done</Btn>
        ) : (
          <React.Fragment>
            <Btn onClick={() => (confirmPub ? onPublish() : setConfirmPub(true))} style={{ opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
              <i className="fa-solid fa-cloud-arrow-up" style={{ marginRight: 8 }} />
              {busy ? 'Working…' : confirmPub ? `Publish ${n} change${n === 1 ? '' : 's'} now` : 'Publish'}
            </Btn>
            {confirmAll ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirmAll(false)} style={{ ...fmPill(false), flex: 1, justifyContent: 'center', padding: '10px 0' }}>Cancel</button>
                <button onClick={onDiscardAll} disabled={busy} style={{ ...fmPill(false), flex: 1, justifyContent: 'center', padding: '10px 0', color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.4)' }}>Discard all changes</button>
              </div>
            ) : (
              <button onClick={() => setConfirmAll(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, letterSpacing: '0.04em', padding: '2px 0', alignSelf: 'center' }}>
                Discard all unpublished changes
              </button>
            )}
          </React.Fragment>
        )}
      </div>
    </Sheet>
  );
}

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
function fmPill(active) {
  return {
    display: 'inline-flex', alignItems: 'center', padding: '5px 10px', borderRadius: 4, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--accent)' : UI.hairStrong}`,
    background: active ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
    color: active ? 'var(--accent)' : UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600,
    WebkitTapHighlightColor: 'transparent',
  };
}
function fmTag(color) {
  return { flexShrink: 0, fontFamily: UI.fontNum, fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '2px 5px', borderRadius: 4, border: `1px solid ${color}`, color, whiteSpace: 'nowrap' };
}

Object.assign(window.Screens, { FeatureMapScreen });
