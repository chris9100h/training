/* Coaching screens, coach dashboard + client view + client-side invite handling */

const { useState: useStateC, useEffect: useEffectC, useRef: useRefC, useMemo: useMemoC } = React;

// Check-in load state shared by ClientCheckInsTab (coach view, -detail.jsx)
// and ClientCheckInTab (client/self view, -tabs.jsx), both used to
// hand-roll the identical checkins/loadErr/schema/coachingMacrosHistory
// state + load effect.
function useCoachingCheckins(coachingId) {
  const [checkins, setCheckins] = useStateC(null);
  const [loadErr, setLoadErr] = useStateC(false);
  const [schema, setSchema] = useStateC(null);
  const [coachingMacrosHistory, setCoachingMacrosHistory] = useStateC(null);

  const load = () => LB.loadCheckins(coachingId)
    .then(c => { setCheckins(c); setLoadErr(false); })
    .catch(() => setLoadErr(true));
  useEffectC(() => {
    setLoadErr(false);
    load();
    LB.loadCheckinSchema(coachingId).then(s => setSchema(s)).catch(() => {});
    LB.loadCoachingMacros(coachingId).then(data => setCoachingMacrosHistory(data)).catch(() => {});
  }, [coachingId]);

  return { checkins, loadErr, setLoadErr, schema, setSchema, coachingMacrosHistory, load };
}

// Fixed amber pill shown while a coach's edit to a client's plan failed to
// sync. syncStore now throws on a real write failure, so this surfaces it
// instead of the edit silently not persisting. The next edit retries the diff.
function CoachSyncErrorPill({ show }) {
  if (!show) return null;
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0,
      top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
      display: 'flex', justifyContent: 'center', zIndex: 90, pointerEvents: 'none',
    }}>
      <div style={{
        padding: '6px 12px', borderRadius: 999,
        background: 'rgba(var(--danger-rgb),0.16)', border: `1px solid rgba(var(--danger-rgb),0.5)`,
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        color: UI.danger, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
      }}>
        Change not saved, keep editing to retry
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  // Date-only strings (YYYY-MM-DD, e.g. session.date) parse as UTC midnight via
  // new Date() and render the previous day in negative-UTC zones, parse those
  // at local noon via LB.parseDate. Full timestamps keep new Date().
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? LB.parseDate(iso) : new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtRelative(iso) { return LB.timeAgo(iso); }



// Canonical set-comparison logic lives in store.js (window.LB), no drift.
// NOT redeclared here: screens-lib.jsx (loaded earlier, see index.html's
// SOURCES) already declares isImprovement/isDecline as top-level const at
// module scope. Classic scripts share one global scope, so a same-named
// top-level const in two of them throws "already been declared" and
// silently kills every other declaration in whichever file loads second,
// which would be this one. Used below as the plain global identifiers
// screens-lib.jsx already put in scope.

// ─── Default check-in form schema ────────────────────────────────────────────
// Mirrors the current fixed fields. A coach can replace this per coaching
// relationship by saving a custom checkin_schema to zane_coaching.
const CHECKIN_DEFAULT_SCHEMA = [
  {
    id: 'weight', label: 'Weight',
    fields: [
      { key: 'weight_today', label: 'Today', type: 'decimal', width: 'half', unit: 'weight', required: true, direction: null, icon: 'fa-weight-scale' },
      { key: 'weight_avg_last_week', label: 'Last week avg', type: 'decimal', width: 'half', unit: 'weight', required: false, direction: null, icon: 'fa-weight-scale' },
    ],
  },
  {
    id: 'markers', label: 'Markers', sectionHint: '1 = good/low, 10 = bad/high',
    fields: [
      { key: 'hunger', label: 'Hunger', type: 'stepper', min: 1, max: 10, width: 'full', required: true, direction: 'lower_better', icon: 'fa-bowl-food' },
      { key: 'sleep_quality', label: 'Sleep', type: 'stepper', min: 1, max: 10, width: 'full', required: true, direction: 'lower_better', icon: 'fa-moon' },
      { key: 'life_stress', label: 'Life Stress', type: 'stepper', min: 1, max: 10, width: 'full', required: true, direction: 'lower_better', icon: 'fa-brain' },
      { key: 'work_stress', label: 'Work Stress', type: 'stepper', min: 1, max: 10, width: 'full', required: true, direction: 'lower_better', icon: 'fa-briefcase' },
      { key: 'tiredness', label: 'Tiredness', type: 'stepper', min: 1, max: 10, width: 'full', required: true, direction: 'lower_better', icon: 'fa-battery-half' },
    ],
  },
  {
    id: 'activity', label: 'Activity',
    fields: [
      { key: 'days_trained', label: 'Days trained', type: 'integer', width: 'half', required: false, direction: null, icon: 'fa-dumbbell' },
      { key: 'performance_vs_last_week', label: 'Performance vs last week', type: 'choice',
        options: [{ value: 'worse', label: 'Worse', color: 'danger' }, { value: 'same', label: 'Same', color: null }, { value: 'improved', label: 'Improved', color: 'accent' }],
        width: 'full', required: false, direction: 'higher_better', icon: 'fa-chart-line' },
      { key: 'steps', label: 'Steps', type: 'integer', width: 'full', required: false, direction: 'higher_better', icon: 'fa-shoe-prints' },
      { key: 'cardio_minutes', label: 'Cardio (min)', type: 'integer', width: 'half', required: false, direction: null, icon: 'fa-person-running' },
      { key: 'cardio_distance_m', label: 'Distance', type: 'decimal', width: 'half', required: false, direction: null, _distanceField: true },
      { key: 'cardio_pace', label: 'Avg pace', type: 'pace', unit: 'pace', width: 'half', required: false, direction: 'lower_better', icon: 'fa-stopwatch' },
      { key: 'cardio_pace_feeling', label: 'Pace feeling', type: 'choice',
        options: [{ value: 1, label: 'Easy' }, { value: 2, label: 'Light' }, { value: 3, label: 'Steady' }, { value: 4, label: 'Solid' }, { value: 5, label: 'Hard' }, { value: 6, label: 'Max' }],
        labeled: true, width: 'full', required: false, direction: null, icon: 'fa-gauge' },
      { key: 'cardio_effort', label: 'Cardio effort', type: 'stepper', min: 1, max: 10, width: 'full', required: false, direction: null, hint: '1 = easy, 10 = max', icon: 'fa-fire' },
    ],
  },
  {
    id: 'nutrition', label: 'Nutrition',
    fields: [
      { key: 'off_plan_days', label: 'Off-plan days', type: 'integer', width: 'half', required: false, direction: null },
      { key: 'hydration_ml', label: 'Avg hydration / day', type: 'integer', width: 'half', required: false, direction: 'higher_better', icon: 'fa-droplet' },
      { key: 'calories_avg', label: 'Avg calories / day', type: 'integer', width: 'half', required: false, direction: null, icon: 'fa-fire' },
      { key: 'protein_avg', label: 'Avg protein / day (g)', type: 'integer', width: 'half', required: false, direction: 'higher_better', icon: 'fa-drumstick-bite' },
      { key: 'carbs_avg', label: 'Avg carbs / day (g)', type: 'integer', width: 'half', required: false, direction: null, icon: 'fa-wheat-awn' },
      { key: 'fat_avg', label: 'Avg fat / day (g)', type: 'integer', width: 'half', required: false, direction: null, icon: 'fa-bacon' },
      { key: 'macro_adherence', label: 'Macro adherence', type: 'percent', width: 'full', required: false, direction: 'higher_better', readOnly: true, icon: 'fa-bullseye' },
      { key: 'off_plan_notes', label: 'Off-plan notes', type: 'text', rows: 2, width: 'full', required: false },
    ],
  },
  {
    id: 'goals', label: 'Goals / Notes',
    fields: [
      { key: 'goal_note', label: 'Goals', type: 'text', rows: 2, width: 'full', required: false },
      { key: 'issues_notes', label: 'Issues', type: 'text', rows: 3, width: 'full', required: false },
      { key: 'general_note', label: 'General note', type: 'text', rows: 2, width: 'full', required: false },
    ],
  },
];

// ─── CoachingPendingBanner ────────────────────────────────────────────────────
// Shown on app boot when the user has a pending coaching invite.

function CoachingPendingBanner({ store, setStore, userId }) {
  const pending = store.coaching?.asClient?.status === 'pending' ? store.coaching.asClient : null;
  const [loading, setLoading] = useStateC(false);

  if (!pending) return null;

  const respond = async (accept) => {
    setLoading(true);
    // Split in two on purpose. Only the FIRST call decides whether the invite
    // was answered; the second is a refresh, and a refresh must never be able
    // to keep this overlay up. It is fixed at inset 0 / zIndex 9000 with no
    // close button, and the only thing that dismisses it is asClient.status
    // ceasing to be 'pending', so once reloadCoachingState started throwing
    // (it used to resolve to empty relationships) a dropped request on a flaky
    // connection left the whole app behind a blocking modal until a force-quit.
    try {
      await LB.respondToCoachingInvite(pending.id, accept);
    } catch (e) {
      UI.alert('Error: ' + e.message);
      setLoading(false);
      return;
    }
    try {
      // Only the coaching slice, via reloadCoachingState. This used to splat a
      // raw loadFromSupabase snapshot over the whole store, bypassing the
      // entire merge pipeline in app.jsx: anything created offline and not yet
      // synced (a finished workout, a health entry) was replaced by the server
      // state and gone.
      const coaching = await LB.reloadCoachingState(userId);
      setStore(s => ({ ...s, coaching: { ...coaching, anyClientLive: s.coaching?.anyClientLive, pendingCheckinsCount: s.coaching?.pendingCheckinsCount } }));
    } catch (_) {
      // The invite IS answered server-side by now, so reflect that locally
      // rather than leaving the user staring at a modal for a decision they
      // already made. Accepting leaves an active relationship, declining
      // leaves none; the next boot reloads whatever the server really holds.
      setStore(s => ({
        ...s,
        coaching: { ...(s.coaching || {}), asClient: accept ? { ...pending, status: 'active' } : null },
      }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: UI.bg, backgroundImage: 'var(--bg-texture)', border: `1px solid ${UI.hairStrong}`, borderRadius: 8,
        padding: 28, maxWidth: 380, width: '100%',
      }}>
        <div className="micro-gold" style={{ marginBottom: 10, letterSpacing: '0.15em' }}>COACHING REQUEST</div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 26, fontWeight: 700, color: UI.ink, marginBottom: 6 }}>
          {pending.coachName}
        </div>
        <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 24, lineHeight: 1.5 }}>
          wants to coach you. They will be able to view your training data,
          sessions and plans, and make adjustments on your behalf.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            disabled={loading}
            onClick={() => respond(true)}
            style={{ width: '100%', padding: '14px 0', borderRadius: 6, border: 'none', cursor: loading ? 'default' : 'pointer', background: 'var(--accent)', color: 'var(--accent-ink)', textShadow: 'none', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', opacity: loading ? 0.6 : 1 }}
          >
            ACCEPT
          </button>
          <button
            disabled={loading}
            onClick={() => respond(false)}
            style={{ width: '100%', padding: '14px 0', borderRadius: 6, border: `1px solid ${UI.hairStrong}`, cursor: loading ? 'default' : 'pointer', background: 'transparent', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600, opacity: loading ? 0.6 : 1 }}
          >
            DECLINE
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CoachingUnreadBanner ─────────────────────────────────────────────────────
// Small banner on home screen when there are unread coach notes.

function CoachingUnreadBanner({ store, userId, onOpen }) {
  // Same filtered source CoachingBannerGroup uses to decide whether to render
  // this at all, recomputing independently is exactly how this banner ended
  // up showing an unfiltered count/preview that disagreed with its own parent.
  const notes = LB.unreadCoachingNotes(store);
  if (!notes.length) return null;

  const fromClient = LB.isNoteFromClient(store, notes);
  const label = fromClient ? 'NEW MESSAGE FROM CLIENT' : 'NEW MESSAGE FROM COACH';
  const labelPlural = fromClient ? 'NEW MESSAGES FROM CLIENTS' : 'NEW MESSAGES FROM COACH';

  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: `rgba(var(--accent-rgb), 0.16)`,
        border: `var(--hair-width) solid rgba(var(--accent-rgb), 0.35)`,
        borderRadius: 6, padding: '10px 14px', cursor: 'pointer',
      }}
    >
      <div style={{ width: 28, height: 28, borderRadius: 6, background: `rgba(var(--accent-rgb), 0.15)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <i className="fa-solid fa-comment" style={{ fontSize: 12, color: 'var(--accent)' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="micro-gold" style={{ marginBottom: 1 }}>
          {notes.length === 1 ? label : `${notes.length} ${labelPlural}`}
        </div>
        <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {notes[0].body || ((notes[0].attachments || []).length ? '📷 Image' : '')}
        </div>
      </div>
      <ChevronRight />
    </div>
  );
}

// ─── ChatThread ───────────────────────────────────────────────────────────────
// Single named thread, message bubbles + compose input.

function ChatThread({ thread, coachingId, userId, otherName, unreadNotes, onBack, setStore }) {
  const [confirmEl, confirm] = useConfirm();
  const [notes, setNotes] = useStateC([]);
  const [loading, setLoading] = useStateC(true);
  const [loadErr, setLoadErr] = useStateC(false);
  const [body, setBody] = useStateC('');
  const [sending, setSending] = useStateC(false);
  const [imageFile, setImageFile] = useStateC(null);
  const [imagePreview, setImagePreview] = useStateC(null);
  const [lightboxSrc, setLightboxSrc] = useStateC(null);
  const [editingNoteId, setEditingNoteId] = useStateC(null);
  const [editingNoteBody, setEditingNoteBody] = useStateC('');
  const [noteActionBusy, setNoteActionBusy] = useStateC(false);
  const bottomRef = useRefC(null);

  const canModifyNote = note => {
    const createdAt = Date.parse(note?.createdAt || '');
    return Number.isFinite(createdAt) && Date.now() - createdAt <= 60 * 60 * 1000;
  };

  const noteWindowError = 'Messages can only be edited or deleted within 60 minutes of sending.';

  const attachImageFile = (file) => {
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = ev => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };
  const pickImage = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    attachImageFile(file);
  };
  // Paste an image straight from the clipboard (screenshot, copied photo…)
  // into the message box, same as picking a file.
  const onPasteMessage = (e) => {
    const item = Array.from(e.clipboardData?.items || []).find(it => it.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    attachImageFile(item.getAsFile());
  };

  // A failed reload right after send() (L14, audit-2026-08) must not blank
  // out notes that loaded fine a moment ago, addCoachingNote already
  // persisted the new message server-side either way, so this only shows a
  // small stale-view hint (below, near the composer) instead of an error
  // state replacing the message list.
  const reload = () => {
    setLoading(true);
    LB.loadCoachingNotes(coachingId, thread.id)
      .then(data => { setNotes([...data].reverse()); setLoadErr(false); })
      .catch(e => { console.error('coaching notes reload failed:', e); setLoadErr(true); })
      .finally(() => setLoading(false));
  };

  // A private Broadcast invalidation reloads unread notes authoritatively, so
  // a message from the other party arrives via this prop without carrying the
  // message itself over Realtime.
  // Keying on the thread's unread ids (not just coachingId/thread.id) re-runs
  // this on a live message so the open thread shows it and marks it read,
  // instead of the message lingering in the badge until the thread is reopened.
  const threadUnreadIds = (unreadNotes || []).filter(n => n.threadId === thread.id).map(n => n.id);
  const threadUnreadKey = threadUnreadIds.join(',');
  useEffectC(() => {
    reload();
    if (threadUnreadIds.length) {
      // markCoachingNotesRead throws on a failed write (unwrap, see
      // CLAUDE.md), so a rejection here correctly leaves the local badge
      // alone, the DB row genuinely is still unread. Just log it: L13
      // (audit-2026-08) flagged the missing path, silently swallowing the
      // error either way.
      LB.markCoachingNotesRead(threadUnreadIds).then(() => {
        if (setStore) setStore(s => ({
          ...s,
          coaching: {
            ...s.coaching,
            unreadNotes: (s.coaching?.unreadNotes || []).filter(n => !threadUnreadIds.includes(n.id)),
          },
        }));
      }).catch(e => console.error('markCoachingNotesRead failed:', e));
    }
  }, [coachingId, thread.id, threadUnreadKey]);

  useEffectC(() => {
    const refresh = () => LB.loadCoachingNotes(coachingId, thread.id)
      .then(data => { setNotes([...data].reverse()); setLoadErr(false); })
      .catch(e => { console.error('coaching notes refresh failed:', e); setLoadErr(true); });
    const onInvalidate = event => {
      const resource = event?.detail?.resource;
      if (resource === 'notes' || resource === 'authoritative') refresh();
    };
    window.addEventListener('zane-coaching-invalidate', onInvalidate);
    const timer = setInterval(refresh, 60000);
    return () => {
      window.removeEventListener('zane-coaching-invalidate', onInvalidate);
      clearInterval(timer);
    };
  }, [coachingId, thread.id]);

  useEffectC(() => {
    if (notes.length && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'auto' });
  }, [notes]);

  const send = async () => {
    if (sending) return;
    if (!body.trim() && !imageFile) return;
    setSending(true);
    const imgFile = imageFile;
    const sentBody = body.trim();
    try {
      let attachments = null;
      if (imgFile) {
        const url = await LB.uploadChatImage(imgFile, userId);
        attachments = [{ url, name: imgFile.name, type: imgFile.type }];
      }
      const id = await LB.addCoachingNote(coachingId, 'general', null, null, sentBody, userId, thread.id, attachments);
      // Optimistic append (L14-Rest, audit-2026-08 verification): the write
      // above already succeeded, addCoachingNote persisted it server-side,
      // but reload() below is a separate fetch that can still fail on its
      // own (a network blip right after send). Without this, that failure
      // left the message the user just sent invisible until the next
      // successful reload even though it was never actually lost. Same
      // shape loadCoachingNotes returns, so a later successful reload's full
      // server list just supersedes this local copy (same id, no dupe).
      setNotes(prev => [...prev, {
        id, coachingId, authorId: userId, threadId: thread.id,
        type: 'general', entityId: null, entityName: null,
        body: sentBody, createdAt: new Date().toISOString(), readAt: null,
        attachments,
      }]);
      setBody('');
      setImageFile(null);
      setImagePreview(null);
      reload();
    } catch (e) { UI.alert(e.message); } finally { setSending(false); }
  };

  const beginEditNote = note => {
    if (!canModifyNote(note)) {
      UI.alert(noteWindowError);
      return;
    }
    setEditingNoteId(note.id);
    setEditingNoteBody(note.body || '');
  };

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setEditingNoteBody('');
  };

  const saveEditedNote = async note => {
    if (noteActionBusy || !editingNoteBody.trim()) return;
    if (!canModifyNote(note)) {
      UI.alert(noteWindowError);
      cancelEditNote();
      return;
    }
    setNoteActionBusy(true);
    try {
      const updated = await LB.updateCoachingNote(note.id, userId, editingNoteBody);
      setNotes(prev => prev.map(item => item.id === note.id ? { ...item, ...updated } : item));
      cancelEditNote();
    } catch (e) {
      UI.alert(e.message || 'Could not edit message');
    } finally {
      setNoteActionBusy(false);
    }
  };

  const removeNote = async note => {
    if (noteActionBusy) return;
    if (!canModifyNote(note)) {
      UI.alert(noteWindowError);
      return;
    }
    if (!await confirm('Delete this message?', { title: 'Delete message', ok: 'Delete', danger: true })) return;
    setNoteActionBusy(true);
    try {
      await LB.deleteCoachingNote(note.id, userId);
      setNotes(prev => prev.filter(item => item.id !== note.id));
      if (editingNoteId === note.id) cancelEditNote();
    } catch (e) {
      UI.alert(e.message || 'Could not delete message');
    } finally {
      setNoteActionBusy(false);
    }
  };

  return (
    <>
      {confirmEl}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 8px', borderBottom: `var(--hair-width) solid ${UI.hair}` }}>
        <button onClick={onBack} style={{ width: 32, height: 32, borderRadius: 6, border: `var(--hair-width) solid ${UI.hair}`, background: UI.bgRaised, textShadow: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i className="fa-solid fa-chevron-left" style={{ fontSize: 12, color: UI.inkSoft }} />
        </button>
        <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{thread.name}</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Loading…</div>
        ) : notes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>No messages yet.</div>
        ) : notes.map(n => {
          const isMe = n.authorId === userId;
          const editing = editingNoteId === n.id;
          const modifiable = isMe && canModifyNote(n);
          return (
            <div key={n.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '80%', background: isMe ? 'var(--accent)' : UI.bgElevated, borderRadius: isMe ? '8px 8px 4px 8px' : '8px 8px 8px 4px', padding: '9px 12px', border: isMe ? 'none' : `var(--hair-width) solid ${UI.hairStrong}`, textShadow: 'none' }}>
                {editing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 190 }}>
                    <textarea value={editingNoteBody} onChange={e => setEditingNoteBody(e.target.value)} rows={3} autoFocus
                      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEditedNote(n); } }}
                      style={{ width: '100%', minHeight: 68, resize: 'vertical', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 4, padding: '7px 8px', fontFamily: UI.fontUi, fontSize: 12, color: UI.ink, outline: 'none' }} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 5 }}>
                      <button onClick={cancelEditNote} disabled={noteActionBusy} style={{ background: 'transparent', border: 'none', color: isMe ? 'rgba(0,0,0,0.65)' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={() => saveEditedNote(n)} disabled={noteActionBusy || !editingNoteBody.trim()} style={{ background: isMe ? 'rgba(0,0,0,0.18)' : 'var(--accent)', border: 'none', borderRadius: 4, padding: '4px 8px', color: 'var(--accent-ink)', fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>{noteActionBusy ? '...' : 'Save'}</button>
                    </div>
                  </div>
                ) : <>
                  {(n.attachments || []).map((a, ai) => (
                    <img key={ai} src={a.url} alt={a.name || 'image'} onClick={() => setLightboxSrc(a.url)}
                      style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 4, display: 'block', marginBottom: n.body ? 8 : 0, cursor: 'pointer' }} />
                  ))}
                  {n.body && <div style={{ fontSize: 13, color: isMe ? 'var(--accent-ink)' : UI.ink, fontFamily: UI.fontUi, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.body}</div>}
                </>}
              </div>
              <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, margin: '3px 4px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                {isMe ? 'You' : otherName} · {fmtRelative(n.createdAt)}{n.editedAt ? ' · edited' : ''}
              </div>
              {modifiable && !editing && <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                {n.body && <button onClick={() => beginEditNote(n)} disabled={noteActionBusy} style={{ background: 'none', border: 'none', padding: 0, color: UI.gold, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Edit</button>}
                <button onClick={() => removeNote(n)} disabled={noteActionBusy} style={{ background: 'none', border: 'none', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Delete</button>
              </div>}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div style={{ flexShrink: 0, borderTop: `var(--hair-width) solid ${UI.hair}`, background: 'transparent' }}>
        {loadErr && (
          <div style={{ padding: '6px 16px 0', display: 'flex', alignItems: 'center', gap: 5 }}>
            <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: 10, color: UI.inkFaint }} />
            <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>Couldn't refresh, messages above may be out of date</span>
          </div>
        )}
        {imagePreview && (
          <div style={{ padding: '10px 16px 0', display: 'flex' }}>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img src={imagePreview} alt="preview" style={{ maxHeight: 80, maxWidth: 120, borderRadius: 4, display: 'block', border: `var(--hair-width) solid ${UI.hairStrong}` }} />
              <button onClick={() => { setImageFile(null); setImagePreview(null); }} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: UI.danger, color: '#fff', textShadow: 'none', cursor: 'pointer', fontSize: 12, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
          </div>
        )}
        <div style={{ padding: '10px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ width: 40, height: 40, borderRadius: 6, border: `var(--hair-width) solid ${UI.hair}`, background: UI.bgInset, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UI.inkSoft }}>
            <i className="fa-solid fa-image" style={{ fontSize: 15 }} />
            <input type="file" accept="image/*" onChange={pickImage} style={{ display: 'none' }} />
          </label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            onPaste={onPasteMessage}
            placeholder="Message…"
            style={{ flex: 1, minHeight: 40, resize: 'vertical', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, padding: '10px 16px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none' }}
          />
          <button onClick={send} disabled={sending || (!body.trim() && !imageFile)} style={{ width: 40, height: 40, borderRadius: 6, border: (body.trim() || imageFile) && !sending ? 'none' : `var(--hair-width) solid ${UI.hair}`, background: (body.trim() || imageFile) && !sending ? 'var(--accent)' : 'transparent', color: (body.trim() || imageFile) && !sending ? 'var(--accent-ink)' : UI.inkFaint, textShadow: 'none', cursor: sending || (!body.trim() && !imageFile) ? 'default' : 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s, color 0.2s, border 0.2s' }}>
            {sending ? <span style={{ fontFamily: UI.fontUi, fontSize: 14 }}>…</span> : <i className="fa-solid fa-arrow-up" style={{ fontSize: 15 }} />}
          </button>
        </div>
        <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
      </div>
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  );
}

// ─── ThreadList ────────────────────────────────────────────────────────────────
// Thread list + inline create, used in both coach Notes tab and client sheet.

function ThreadList({ coachingId, userId, otherName, unreadNotes, setStore, canDelete }) {
  const [threads, setThreads] = useStateC([]);
  const [loading, setLoading] = useStateC(true);
  const [loadErr, setLoadErr] = useStateC(false);
  const [selected, setSelected] = useStateC(null);
  const [creating, setCreating] = useStateC(false);
  const [newName, setNewName] = useStateC('');
  const [saving, setSaving] = useStateC(false);
  const [confirmEl, confirm] = useConfirm();

  const reload = () => {
    setLoading(true);
    setLoadErr(false);
    LB.loadCoachingThreads(coachingId).then(loaded => {
      setThreads(loaded);
      if (setStore && (unreadNotes || []).length) {
        const validThreadIds = new Set(loaded.map(t => t.id));
        // Only this coaching's notes, callers pass the global unread list, which
        // also holds other relationships' notes and support_ tickets. Never mark
        // those read here.
        // Stale = threadless (no UI to show them) OR referencing a deleted thread
        const orphanedIds = (unreadNotes || [])
          .filter(n => n.coachingId === coachingId)
          .filter(n => !n.threadId || !validThreadIds.has(n.threadId))
          .map(n => n.id);
        if (orphanedIds.length) {
          setStore(s => ({
            ...s,
            coaching: {
              ...s.coaching,
              unreadNotes: (s.coaching?.unreadNotes || []).filter(n => !orphanedIds.includes(n.id)),
            },
          }));
          LB.markCoachingNotesRead(orphanedIds).catch(() => {});
        }
      }
    }).catch(e => { console.error('coaching threads reload failed:', e); setLoadErr(true); })
      .finally(() => setLoading(false));
  };

  useEffectC(() => { reload(); }, [coachingId]);

  const deleteThread = async (t, e) => {
    e.stopPropagation();
    if (!await confirm(`Delete "${t.name}" and all its messages?`, { title: 'Delete thread', ok: 'Delete', danger: true })) return;
    try {
      await LB.deleteCoachingThread(t.id);
      reload();
    } catch (err) { UI.alert(err.message); }
  };

  const create = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await LB.createCoachingThread(coachingId, newName, userId);
      setNewName('');
      setCreating(false);
      reload();
    } catch (e) { UI.alert(e.message); } finally { setSaving(false); }
  };

  // unread count per thread
  const unreadByThread = {};
  (unreadNotes || []).forEach(n => {
    if (n.threadId) unreadByThread[n.threadId] = (unreadByThread[n.threadId] || 0) + 1;
  });

  if (selected) {
    return (
      <ChatThread
        thread={selected}
        coachingId={coachingId}
        userId={userId}
        otherName={otherName}
        unreadNotes={unreadNotes}
        setStore={setStore}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <>
      {confirmEl}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Loading…</div>
        ) : loadErr ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 }}>
            <div style={{ fontSize: 13, color: 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi, textAlign: 'center' }}>Couldn't load threads.</div>
            <button onClick={reload} style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, padding: '8px 16px', cursor: 'pointer', color: UI.ink, fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600 }}>Retry</button>
          </div>
        ) : threads.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>No threads yet.</div>
        ) : threads.map(t => {
          const unread = unreadByThread[t.id] || 0;
          return (
            <div key={t.id} onClick={() => setSelected(t)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: `var(--hair-width) solid ${UI.hair}`, cursor: 'pointer' }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: `rgba(var(--accent-rgb),0.16)`, border: `var(--hair-width) solid rgba(var(--accent-rgb),0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="fa-solid fa-comment" style={{ fontSize: 14, color: 'var(--accent)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{t.name}</div>
              </div>
              {unread > 0 && (
                <div style={{ background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 6, fontSize: 10, fontFamily: UI.fontUi, fontWeight: 700, padding: '2px 7px', minWidth: 18, textAlign: 'center', flexShrink: 0 }}>
                  {unread}
                </div>
              )}
              {canDelete ? (
                <button
                  onClick={e => deleteThread(t, e)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 6px', color: UI.inkGhost, fontSize: 16, lineHeight: 1, flexShrink: 0 }}
                >×</button>
              ) : (
                <ChevronRight />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ flexShrink: 0, borderTop: `var(--hair-width) solid ${UI.hair}`, background: 'transparent' }}>
        <div style={{ padding: '10px 16px' }}>
          {creating ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
                placeholder="Thread name (e.g. Nutrition, Goals…)"
                style={{ flex: 1, background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, padding: '10px 16px', fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, outline: 'none' }}
              />
              <button onClick={create} disabled={saving || !newName.trim()} style={{ padding: '10px 18px', borderRadius: 6, border: newName.trim() && !saving ? 'none' : `var(--hair-width) solid ${UI.hair}`, background: newName.trim() && !saving ? 'var(--accent)' : 'transparent', color: newName.trim() && !saving ? 'var(--accent-ink)' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', cursor: saving || !newName.trim() ? 'default' : 'pointer', flexShrink: 0, transition: 'background 0.2s, color 0.2s, border 0.2s' }}>
                {saving ? '…' : 'CREATE'}
              </button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} style={{ width: '100%', padding: '11px 0', borderRadius: 6, border: `var(--hair-width) solid rgba(var(--accent-rgb), 0.3)`, background: `rgba(var(--accent-rgb), 0.13)`, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <i className="fa-solid fa-plus" style={{ fontSize: 11 }} />
              New Thread
            </button>
          )}
        </div>
        <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
      </div>
    </>
  );
}

// ─── CoachingNotesSheet ───────────────────────────────────────────────────────
// Thread list sheet for clients, opens from home unread banner or settings.

function CoachingNotesSheet({ open, store, setStore, userId, onClose }) {
  const coachingId = store.coaching?.asClient?.id;
  const coachName = store.coaching?.asClient?.coachName || 'Coach';
  const unreadNotes = store.coaching?.unreadNotes || [];

  return (
    <Sheet open={open} onClose={onClose} title="Messages">
      {coachingId && (
        <div style={{ display: 'flex', flexDirection: 'column', height: '65vh' }}>
          <ThreadList
            coachingId={coachingId}
            userId={userId}
            otherName={coachName}
            unreadNotes={unreadNotes}
            setStore={setStore}
            canDelete={false}
          />
        </div>
      )}
    </Sheet>
  );
}


// ─── CoachClientScreen ────────────────────────────────────────────────────────
// Full coach view for a single client, 4 tabs: Overview, Plan, Sessions, Notes.
