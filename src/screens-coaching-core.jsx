/* Coaching screens — coach dashboard + client view + client-side invite handling */

const { useState: useStateC, useEffect: useEffectC, useRef: useRefC, useMemo: useMemoC } = React;

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
        Change not saved — keep editing to retry
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}



// Canonical set-comparison logic lives in store.js (window.LB) — no drift.
const isImprovement = LB.isImprovement;
const isDecline = LB.isDecline;

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
      { key: 'cardio_pace_feeling', label: 'Pace feeling', type: 'choice',
        options: [{ value: 1, label: 'Easy' }, { value: 2, label: 'Light' }, { value: 3, label: 'Steady' }, { value: 4, label: 'Solid' }, { value: 5, label: 'Hard' }, { value: 6, label: 'Max' }],
        labeled: true, width: 'full', required: false, direction: null, icon: 'fa-gauge' },
      { key: 'cardio_effort', label: 'Cardio effort', type: 'stepper', min: 1, max: 10, width: 'full', required: false, direction: null, hint: '1 = easy, 10 = max', icon: 'fa-fire' },
    ],
  },
  {
    id: 'nutrition', label: 'Nutrition',
    fields: [
      { key: 'off_plan_notes', label: 'Off-plan days / notes', type: 'text', rows: 3, width: 'full', required: false },
      { key: 'hydration_ml', label: 'Avg hydration / day (ml)', type: 'integer', width: 'full', required: false, direction: 'higher_better', icon: 'fa-droplet' },
    ],
  },
  {
    id: 'goals', label: 'Goals / Notes',
    fields: [
      { key: 'goal_note', label: 'Goals / Notes', type: 'text', rows: 2, width: 'full', required: false },
      { key: 'issues_notes', label: 'Issues / things to address', type: 'text', rows: 3, width: 'full', required: false },
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
    try {
      await LB.respondToCoachingInvite(pending.id, accept);
      const fresh = await LB.loadFromSupabase(userId);
      setStore(s => ({ ...s, ...fresh }));
    } catch (e) {
      alert('Error: ' + e.message);
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
        background: UI.bg, border: `1px solid ${UI.hairStrong}`, borderRadius: 16,
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
            style={{ width: '100%', padding: '14px 0', borderRadius: 10, border: 'none', cursor: loading ? 'default' : 'pointer', background: 'var(--accent)', color: '#0a0805', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', opacity: loading ? 0.6 : 1 }}
          >
            ACCEPT
          </button>
          <button
            disabled={loading}
            onClick={() => respond(false)}
            style={{ width: '100%', padding: '14px 0', borderRadius: 10, border: `1px solid ${UI.hairStrong}`, cursor: loading ? 'default' : 'pointer', background: 'transparent', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600, opacity: loading ? 0.6 : 1 }}
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
  const notes = store.coaching?.unreadNotes || [];
  if (!notes.length) return null;

  // Determine direction: are these messages from a client (user is coach) or from a coach (user is client)?
  const clientIds = new Set((store.coaching?.asCoach || []).map(c => c.clientId));
  const fromClient = notes.some(n => clientIds.has(n.authorId));
  const label = fromClient ? 'NEW MESSAGE FROM CLIENT' : 'NEW MESSAGE FROM COACH';
  const labelPlural = fromClient ? 'NEW MESSAGES FROM CLIENTS' : 'NEW MESSAGES FROM COACH';

  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: `rgba(var(--accent-rgb), 0.08)`,
        border: `0.5px solid rgba(var(--accent-rgb), 0.35)`,
        borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
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
          {notes[0].body}
        </div>
      </div>
      <ChevronRight />
    </div>
  );
}

// ─── ChatThread ───────────────────────────────────────────────────────────────
// Single named thread — message bubbles + compose input.

function ChatThread({ thread, coachingId, userId, otherName, unreadNotes, onBack, setStore }) {
  const [notes, setNotes] = useStateC([]);
  const [loading, setLoading] = useStateC(true);
  const [body, setBody] = useStateC('');
  const [sending, setSending] = useStateC(false);
  const bottomRef = useRefC(null);

  const reload = () => {
    setLoading(true);
    LB.loadCoachingNotes(coachingId, thread.id)
      .then(data => setNotes([...data].reverse()))
      .finally(() => setLoading(false));
  };

  useEffectC(() => {
    reload();
    const unreadIds = (unreadNotes || []).filter(n => n.threadId === thread.id).map(n => n.id);
    if (unreadIds.length) {
      LB.markCoachingNotesRead(unreadIds).then(() => {
        if (setStore) setStore(s => ({
          ...s,
          coaching: {
            ...s.coaching,
            unreadNotes: (s.coaching?.unreadNotes || []).filter(n => !unreadIds.includes(n.id)),
          },
        }));
      });
    }
  }, [coachingId, thread.id]);

  useEffectC(() => {
    if (notes.length && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'auto' });
  }, [notes]);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await LB.addCoachingNote(coachingId, 'general', null, null, body.trim(), userId, thread.id);
      setBody('');
      reload();
    } catch (e) { alert(e.message); } finally { setSending(false); }
  };

  return (
    <>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 8px', borderBottom: `0.5px solid ${UI.hair}` }}>
        <button onClick={onBack} style={{ width: 32, height: 32, borderRadius: 6, border: `0.5px solid ${UI.hair}`, background: UI.bgRaised, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
          return (
            <div key={n.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '80%', background: isMe ? 'var(--accent)' : UI.bgElevated, borderRadius: isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px', padding: '9px 12px', border: isMe ? 'none' : `0.5px solid ${UI.hairStrong}` }}>
                <div style={{ fontSize: 13, color: isMe ? '#0a0805' : UI.ink, fontFamily: UI.fontUi, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{n.body}</div>
              </div>
              <div style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, margin: '3px 4px 0' }}>
                {isMe ? 'You' : otherName} · {fmtRelative(n.createdAt)}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div style={{ flexShrink: 0, borderTop: `0.5px solid ${UI.hair}`, background: 'transparent' }}>
        <div style={{ padding: '10px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Message…"
            style={{ flex: 1, background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6, padding: '10px 16px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none' }}
          />
          <button onClick={send} disabled={sending || !body.trim()} style={{ width: 40, height: 40, borderRadius: 6, border: body.trim() && !sending ? 'none' : `0.5px solid ${UI.hair}`, background: body.trim() && !sending ? 'var(--accent)' : 'transparent', color: body.trim() && !sending ? '#0a0805' : UI.inkFaint, cursor: sending || !body.trim() ? 'default' : 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s, color 0.2s, border 0.2s' }}>
            {sending ? <span style={{ fontFamily: UI.fontUi, fontSize: 14 }}>…</span> : <i className="fa-solid fa-arrow-up" style={{ fontSize: 15 }} />}
          </button>
        </div>
        <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
      </div>
    </>
  );
}

// ─── ThreadList ────────────────────────────────────────────────────────────────
// Thread list + inline create — used in both coach Notes tab and client sheet.

function ThreadList({ coachingId, userId, otherName, unreadNotes, setStore, canDelete }) {
  const [threads, setThreads] = useStateC([]);
  const [loading, setLoading] = useStateC(true);
  const [selected, setSelected] = useStateC(null);
  const [creating, setCreating] = useStateC(false);
  const [newName, setNewName] = useStateC('');
  const [saving, setSaving] = useStateC(false);
  const [confirmEl, confirm] = useConfirm();

  const reload = () => {
    setLoading(true);
    LB.loadCoachingThreads(coachingId).then(loaded => {
      setThreads(loaded);
      if (setStore && (unreadNotes || []).length) {
        const validThreadIds = new Set(loaded.map(t => t.id));
        // Stale = threadless (no UI to show them) OR referencing a deleted thread
        const orphanedIds = (unreadNotes || [])
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
    }).finally(() => setLoading(false));
  };

  useEffectC(() => { reload(); }, [coachingId]);

  const deleteThread = async (t, e) => {
    e.stopPropagation();
    if (!await confirm(`Delete "${t.name}" and all its messages?`, { title: 'Delete thread', ok: 'Delete', danger: true })) return;
    try {
      await LB.deleteCoachingThread(t.id);
      reload();
    } catch (err) { alert(err.message); }
  };

  const create = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await LB.createCoachingThread(coachingId, newName, userId);
      setNewName('');
      setCreating(false);
      reload();
    } catch (e) { alert(e.message); } finally { setSaving(false); }
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
        ) : threads.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>No threads yet.</div>
        ) : threads.map(t => {
          const unread = unreadByThread[t.id] || 0;
          return (
            <div key={t.id} onClick={() => setSelected(t)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: `0.5px solid ${UI.hair}`, cursor: 'pointer' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `rgba(var(--accent-rgb),0.08)`, border: `0.5px solid rgba(var(--accent-rgb),0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="fa-solid fa-comment" style={{ fontSize: 14, color: 'var(--accent)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{t.name}</div>
              </div>
              {unread > 0 && (
                <div style={{ background: 'var(--accent)', color: '#0a0805', borderRadius: 10, fontSize: 10, fontFamily: UI.fontUi, fontWeight: 700, padding: '2px 7px', minWidth: 18, textAlign: 'center', flexShrink: 0 }}>
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
      <div style={{ flexShrink: 0, borderTop: `0.5px solid ${UI.hair}`, background: 'transparent' }}>
        <div style={{ padding: '10px 16px' }}>
          {creating ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
                placeholder="Thread name (e.g. Nutrition, Goals…)"
                style={{ flex: 1, background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6, padding: '10px 16px', fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, outline: 'none' }}
              />
              <button onClick={create} disabled={saving || !newName.trim()} style={{ padding: '10px 18px', borderRadius: 6, border: newName.trim() && !saving ? 'none' : `0.5px solid ${UI.hair}`, background: newName.trim() && !saving ? 'var(--accent)' : 'transparent', color: newName.trim() && !saving ? '#0a0805' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', cursor: saving || !newName.trim() ? 'default' : 'pointer', flexShrink: 0, transition: 'background 0.2s, color 0.2s, border 0.2s' }}>
                {saving ? '…' : 'CREATE'}
              </button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} style={{ width: '100%', padding: '11px 0', borderRadius: 6, border: `0.5px solid rgba(var(--accent-rgb), 0.3)`, background: `rgba(var(--accent-rgb), 0.06)`, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
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
// Thread list sheet for clients — opens from home unread banner or settings.

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

// ─── CoachingSettingsSection ──────────────────────────────────────────────────
// Section rendered inside SettingsScreen under "Coaching".

function CoachingSettingsSection({ store, setStore, userId, go }) {
  const asClient = store.coaching?.asClient;
  const asCoach = store.coaching?.asCoach || [];
  const [inviteEmail, setInviteEmail] = useStateC('');
  const [inviting, setInviting] = useStateC(false);
  const [inviteError, setInviteError] = useStateC('');
  const [ending, setEnding] = useStateC(false);
  const [threadOpen, setThreadOpen] = useStateC(false);
  const [confirmEl, confirm] = useConfirm();

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError('');
    try {
      const result = await LB.inviteClient(inviteEmail.trim());
      if (result?.startsWith('ERROR:not_found')) { setInviteError('No user found with that email.'); return; }
      if (result?.startsWith('ERROR:self')) { setInviteError('You cannot coach yourself.'); return; }
      if (result?.startsWith('ERROR:exists')) { setInviteError('Invite already sent or coaching already active.'); return; }
      setInviteEmail('');
      const fresh = await LB.loadFromSupabase(userId);
      setStore(s => ({ ...s, ...fresh }));
    } catch (e) {
      setInviteError(e.message);
    } finally {
      setInviting(false);
    }
  };

  const handleEndCoaching = async (coachingId) => {
    if (!await confirm('This will immediately revoke access to training data.', { title: 'End coaching?', ok: 'End', danger: true })) return;
    setEnding(true);
    try {
      await LB.endCoaching(coachingId);
      const fresh = await LB.loadFromSupabase(userId);
      setStore(s => ({ ...s, ...fresh }));
    } catch (e) {
      alert(e.message);
    } finally {
      setEnding(false);
    }
  };

  return (
    <>
    {confirmEl}
    <CoachingNotesSheet open={threadOpen} store={store} setStore={setStore} userId={userId} onClose={() => setThreadOpen(false)} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* As client */}
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8, marginTop: 4 }}>MY COACH</div>
      {asClient ? (
        <div style={{ background: UI.bgInset, borderRadius: 10, border: `0.5px solid ${UI.hair}`, marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
            <div style={{ width: 36, height: 36, borderRadius: 18, background: `rgba(var(--accent-rgb),0.15)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <i className="fa-solid fa-user" style={{ fontSize: 14, color: 'var(--accent)' }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{asClient.coachName}</div>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>{asClient.coachEmail}</div>
              {asClient.status === 'pending' && <div className="micro" style={{ color: 'var(--accent)', marginTop: 2 }}>PENDING YOUR RESPONSE</div>}
            </div>
            <button onClick={() => handleEndCoaching(asClient.id)} disabled={ending} style={{ background: 'transparent', border: `1px solid rgba(var(--danger-rgb),0.4)`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', color: 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi, fontSize: 11 }}>
              END
            </button>
          </div>
          {asClient.status === 'active' && (
            <div
              onClick={() => setThreadOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: `0.5px solid ${UI.hair}`, cursor: 'pointer' }}
            >
              <i className="fa-solid fa-comment" style={{ fontSize: 12, color: 'var(--accent)' }} />
              <span style={{ flex: 1, fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>Messages</span>
              {(store.coaching?.unreadNotes?.length > 0) && (
                <div style={{ background: 'var(--accent)', color: '#0a0805', borderRadius: 10, fontSize: 10, fontFamily: UI.fontUi, fontWeight: 700, padding: '1px 7px', minWidth: 18, textAlign: 'center' }}>
                  {store.coaching.unreadNotes.length}
                </div>
              )}
              <ChevronRight />
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '12px 14px', background: UI.bgInset, borderRadius: 10, border: `0.5px solid ${UI.hair}`, marginBottom: 14, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>
          No coach assigned.
        </div>
      )}

      {/* As coach */}
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>MY CLIENTS</div>

      {asCoach.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {asCoach.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: UI.bgInset, borderRadius: 10, border: `0.5px solid ${UI.hair}`, cursor: c.status === 'active' ? 'pointer' : 'default' }}
              onClick={() => c.status === 'active' && go({ name: 'coaching-client', coachingId: c.id, clientId: c.clientId, clientName: c.clientName })}
            >
              <div style={{ width: 32, height: 32, borderRadius: 16, background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.inkSoft, fontWeight: 700 }}>{(c.clientName || '?')[0].toUpperCase()}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{c.clientName}</div>
                {c.status === 'pending' && <div className="micro" style={{ color: UI.inkFaint, marginTop: 1 }}>PENDING ACCEPTANCE</div>}
              </div>
              {c.status === 'active' && <ChevronRight />}
              <button onClick={e => { e.stopPropagation(); handleEndCoaching(c.id); }} disabled={ending} style={{ background: 'transparent', border: `1px solid rgba(var(--danger-rgb),0.4)`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', color: 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi, fontSize: 11 }}>
                END
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Invite new client */}
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>INVITE CLIENT</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={inviteEmail}
          onChange={e => { setInviteEmail(e.target.value); setInviteError(''); }}
          onKeyDown={e => e.key === 'Enter' && handleInvite()}
          placeholder="client@email.com"
          type="email"
          autoCapitalize="none"
          autoCorrect="off"
          style={{ flex: 1, background: UI.bgInset, border: `0.5px solid ${inviteError ? 'rgba(var(--danger-rgb),0.5)' : UI.hairStrong}`, borderRadius: 8, padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, outline: 'none' }}
        />
        <button
          onClick={handleInvite}
          disabled={inviting || !inviteEmail.trim()}
          style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#0a0805', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, cursor: inviting || !inviteEmail.trim() ? 'default' : 'pointer', opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }}
        >
          {inviting ? '…' : 'INVITE'}
        </button>
      </div>
      {inviteError && <div style={{ fontSize: 11, color: 'rgba(var(--danger-rgb),0.85)', fontFamily: UI.fontUi, marginTop: 5 }}>{inviteError}</div>}
    </div>
    </>
  );
}

// ─── CoachingDashboard ────────────────────────────────────────────────────────

function CoachingDashboard({ store, setStore, userId, go }) {
  const clients = (store.coaching?.asCoach || []).filter(c => c.status === 'active');

  return (
    <Screen scroll>
      <TopBar title="Clients" onBack={() => go({ name: 'settings' })} />
      {clients.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>
          No active clients yet.<br />Invite clients from Settings → Coaching.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 12px 24px' }}>
          {clients.map(c => (
            <ClientCard key={c.id} client={c} go={go} />
          ))}
        </div>
      )}
    </Screen>
  );
}

function ClientCard({ client, go }) {
  return (
    <div
      onClick={() => go({ name: 'coaching-client', coachingId: client.id, clientId: client.clientId, clientName: client.clientName })}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: UI.bgInset, borderRadius: 12, border: `0.5px solid ${UI.hair}`, cursor: 'pointer' }}
    >
      <div style={{ width: 44, height: 44, borderRadius: 22, background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 18, color: UI.inkSoft, fontWeight: 700 }}>{(client.clientName || '?')[0].toUpperCase()}</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 2 }}>{client.clientName}</div>
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>{client.clientEmail}</div>
      </div>
      <ChevronRight />
    </div>
  );
}

// ─── CoachClientScreen ────────────────────────────────────────────────────────
// Full coach view for a single client — 4 tabs: Overview, Plan, Sessions, Notes.
