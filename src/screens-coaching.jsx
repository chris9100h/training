/* Coaching screens — coach dashboard + client view + client-side invite handling */

const { useState: useStateC, useEffect: useEffectC, useRef: useRefC, useMemo: useMemoC } = React;

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

// ─── diffSchedule ────────────────────────────────────────────────────────────
// Returns a human-readable summary of what changed between two schedule
// snapshots, or null if nothing relevant changed.

function diffSchedule(before, after, exercises) {
  if (!before || !after) return null;
  const lines = [];
  const exName = (exId) => (exercises || []).find(e => e.id === exId)?.name || exId;

  if (before.name !== after.name) lines.push(`Renamed: ${before.name} → ${after.name}`);

  const beforeDays = before.days || [];
  const afterDays  = after.days  || [];
  const beforeById = Object.fromEntries(beforeDays.map(d => [d.id, d]));
  const afterById  = Object.fromEntries(afterDays.map(d  => [d.id, d]));

  const added   = afterDays.filter(d => !beforeById[d.id]);
  const removed = beforeDays.filter(d => !afterById[d.id]);
  const shared  = afterDays.filter(d =>  beforeById[d.id]);

  if (added.length)   lines.push(`Days added: ${added.map(d => d.name).join(', ')}`);
  if (removed.length) lines.push(`Days removed: ${removed.map(d => d.name).join(', ')}`);

  const renamed = shared.filter(d => beforeById[d.id].name !== d.name)
    .map(d => `${beforeById[d.id].name} → ${d.name}`);
  if (renamed.length) lines.push(`Days renamed: ${renamed.join(', ')}`);

  const exAdded = [], exRemoved = [];
  for (const afterDay of shared) {
    const beforeDay = beforeById[afterDay.id];
    const bKeys = new Set((beforeDay.items || []).map(i => i.exId).filter(Boolean));
    const aKeys = new Set((afterDay.items  || []).map(i => i.exId).filter(Boolean));
    (afterDay.items  || []).filter(i => i.exId && !bKeys.has(i.exId)).forEach(i => exAdded.push(`${exName(i.exId)} (${afterDay.name})`));
    (beforeDay.items || []).filter(i => i.exId && !aKeys.has(i.exId)).forEach(i => exRemoved.push(`${exName(i.exId)} (${beforeDay.name})`));
  }
  if (exAdded.length)   lines.push(`Exercises added: ${exAdded.join(', ')}`);
  if (exRemoved.length) lines.push(`Exercises removed: ${exRemoved.join(', ')}`);

  return lines.length > 0 ? lines.join('\n') : null;
}

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
      <div style={{ flexShrink: 0, borderTop: `0.5px solid ${UI.hair}`, background: UI.bg }}>
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
      <div style={{ flexShrink: 0, borderTop: `0.5px solid ${UI.hair}`, background: UI.bg }}>
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

function CoachClientScreen({ store, setStore, userId, go, coachingId, clientId, clientName, initialTab }) {
  const [tab, setTab] = useStateC(initialTab || 'overview');
  const [selectedSession, setSelectedSession] = useStateC(null);

  const openSession = (session) => { setSelectedSession(session); setTab('sessions'); };
  const [clientStore, setClientStore] = useStateC(null);
  const [loadError, setLoadError] = useStateC(null);

  useEffectC(() => {
    LB.loadClientStore(clientId)
      .then(data => setClientStore(data))
      .catch(e => setLoadError(e.message));
  }, [clientId]);

  const reloadClient = async () => {
    try {
      const fresh = await LB.loadClientStore(clientId);
      setClientStore(fresh);
    } catch (_) {}
  };

  const TABS = [
    { id: 'overview',   icon: 'fa-chart-bar',      label: 'Overview' },
    { id: 'plan',       icon: 'fa-calendar-days',   label: 'Plan' },
    { id: 'sessions',   icon: 'fa-dumbbell',        label: 'Sessions' },
    { id: 'nutrition',  icon: 'fa-utensils',        label: 'Nutrition' },
    { id: 'notes',      icon: 'fa-comment',         label: 'Notes' },
  ];

  return (
    <Screen scroll={false}>
      <TopBar
        title={clientName}
        sub={<span className="micro" style={{ color: 'var(--accent)', letterSpacing: '0.12em' }}>COACHING</span>}
        onBack={() => go({ name: 'settings' })}
      />

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: `0.5px solid ${UI.hair}`, background: UI.bg, flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: '10px 4px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent', WebkitTapHighlightColor: 'transparent' }}
          >
            <i className={`fa-solid ${t.icon}`} style={{ fontSize: 14, color: tab === t.id ? 'var(--accent)' : UI.inkFaint }} />
            <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.08em', color: tab === t.id ? 'var(--accent)' : UI.inkFaint, textTransform: 'uppercase' }}>{t.label}</span>
          </button>
        ))}
      </div>

      {loadError ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi, fontSize: 13 }}>
          Failed to load client data: {loadError}
        </div>
      ) : !clientStore ? (
        <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Live training banner */}
          {clientStore.inProgress && (
            <div
              onClick={() => go({ name: 'spectator', targetUserId: clientId, userName: clientName, sessionId: clientStore.inProgress })}
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: `rgba(var(--accent-rgb), 0.08)`, borderBottom: `0.5px solid rgba(var(--accent-rgb), 0.25)`, cursor: 'pointer' }}
            >
              <div style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', boxShadow: '0 0 6px rgba(var(--accent-rgb),0.8)', animation: 'pulseDot 1.5s ease-in-out infinite', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, fontFamily: UI.fontUi, color: 'var(--accent)', letterSpacing: '0.08em', fontWeight: 600 }}>TRAINING NOW — TAP TO WATCH</span>
              <ChevronRight color={'var(--accent)'} />
            </div>
          )}
          {tab === 'overview'   && <ClientOverviewTab clientStore={clientStore} coachingId={coachingId} userId={userId} onSelectSession={openSession} />}
          {tab === 'plan'       && <ClientPlanTab clientStore={clientStore} setClientStore={setClientStore} clientId={clientId} coachingId={coachingId} userId={userId} go={go} onReload={reloadClient} clientName={clientName} />}
          {tab === 'sessions'   && <ClientSessionsTab clientStore={clientStore} coachingId={coachingId} userId={userId} clientName={clientName} initialSelected={selectedSession} onClearSelected={() => setSelectedSession(null)} />}
          {tab === 'nutrition'  && <ClientNutritionTab coachingId={coachingId} userId={userId} />}
          {tab === 'notes'      && <ClientNotesTab coachingId={coachingId} userId={userId} clientName={clientName} store={store} setStore={setStore} />}
        </div>
      )}
    </Screen>
  );
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function cyclePosFn(clientStore, date) {
  const activeSch = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId);
  const cycleLen = activeSch?.days?.length || 1;
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const d = new Date(date); d.setHours(12, 0, 0, 0);
  const daysAgo = Math.round((today - d) / 86400000);
  return (((clientStore.cycleIndex || 0) - daysAgo) % cycleLen + cycleLen) % cycleLen;
}

// Format a Date to "YYYY-MM-DD" using local time — avoids UTC off-by-one issues.
function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeWeeklyAdherence(clientStore, weeksBack = 6) {
  const activeSch = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId);
  if (!activeSch) return [];

  const isWd = LB.isWeekdayPlan(activeSch);

  // Only count sessions for the active plan — ignore old plan sessions.
  const planSessions = (clientStore.sessions || []).filter(s => s.ended && s.scheduleId === activeSch.id);

  // Session date set — both stored date field and local-time of ended timestamp.
  const sessionDates = new Set();
  planSessions.forEach(s => {
    if (s.date) sessionDates.add(s.date.slice(0, 10));
    sessionDates.add(localDateKey(new Date(s.ended)));
  });

  // Determine the Monday from which adherence starts — don't penalize weeks before the plan was active.
  // Weekday plans: weekPlanStartDate is set when the plan was activated → most accurate.
  // Cycle plans / fallback: earliest session for this plan.
  let planStartMonday = null;
  if (isWd && clientStore.weekPlanStartDate) {
    const d = new Date(clientStore.weekPlanStartDate); d.setHours(12, 0, 0, 0);
    const wd = (d.getDay() + 6) % 7;
    planStartMonday = new Date(d);
    planStartMonday.setDate(d.getDate() - wd);
    planStartMonday.setHours(0, 0, 0, 0);
  } else if (planSessions.length > 0) {
    const earliestMs = Math.min(...planSessions.map(s => new Date(s.ended).getTime()));
    const earliest = new Date(earliestMs); earliest.setHours(12, 0, 0, 0);
    const earliestWd = (earliest.getDay() + 6) % 7;
    planStartMonday = new Date(earliest);
    planStartMonday.setDate(earliest.getDate() - earliestWd);
    planStartMonday.setHours(0, 0, 0, 0);
  }
  if (!planStartMonday) return [];

  const today = new Date(); today.setHours(12, 0, 0, 0);
  const todayWd = (today.getDay() + 6) % 7; // 0=Mon
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - todayWd);

  return Array.from({ length: weeksBack }, (_, w) => {
    const monday = new Date(thisMonday);
    monday.setDate(thisMonday.getDate() - w * 7);

    // Skip weeks before the plan was in use.
    if (monday < planStartMonday) return null;

    let planned = 0, done = 0;
    for (let d = 0; d < 7; d++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + d);
      if (date > today) continue;

      const dateStr = localDateKey(date);
      let isTrainingDay = false;

      if (isWd) {
        // App stores weekdays as 0=Mon … 6=Sun; convert from JS 0=Sun.
        const wd = (date.getDay() + 6) % 7;
        isTrainingDay = (activeSch.days || []).some(day => day.weekday === wd && day.items?.length > 0);
      } else {
        const pos = cyclePosFn(clientStore, date);
        isTrainingDay = !!(activeSch.days?.[pos]?.items?.length > 0);
      }

      if (isTrainingDay) {
        planned++;
        if (sessionDates.has(dateStr)) done++;
      }
    }

    const pct = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : null;
    const isoWeek = (() => { const t = new Date(monday); t.setDate(t.getDate() + 4 - (t.getDay() || 7)); return Math.ceil((((t - new Date(t.getFullYear(), 0, 1)) / 86400000) + 1) / 7); })();
    const label = w === 0 ? 'This week' : w === 1 ? 'Last week' : `W${isoWeek}`;
    return { label, planned, done, pct };
  }).filter(Boolean);
}

function ClientOverviewTab({ clientStore, coachingId, userId, onSelectSession }) {
  const sessions = clientStore.sessions || [];
  const ended = sessions.filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));
  const [chartOpen, setChartOpen] = useStateC(null);

  const activeSch = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId);
  const trainingDayCount = activeSch ? (activeSch.days || []).filter(d => d.items?.length > 0).length : 0;

  const weeks = useMemoC(() => computeWeeklyAdherence(clientStore), [clientStore]);
  const completedWeeks = weeks.filter(w => w.planned > 0 && w.pct !== null);
  const overallAdherence = completedWeeks.length > 0
    ? Math.round(completedWeeks.reduce((s, w) => s + w.pct, 0) / completedWeeks.length)
    : null;

  const last30 = ended.filter(s => (Date.now() - new Date(s.ended).getTime()) < 30 * 86400000);
  const avgVol = last30.length > 0
    ? Math.round(last30.reduce((s, x) => s + LB.totalVolume(x), 0) / last30.length)
    : null;

  const chartTitles = { adherence: 'Adherence (6w)', volume: 'Avg Volume Trend', sessions: 'Sessions per Week' };

  // Sessions to show: current week (weekday plan) or current cycle window (cycle plan)
  const recentSessions = useMemoC(() => {
    if (!activeSch) return ended.slice(0, 5);
    if (LB.isWeekdayPlan(activeSch)) {
      const today = new Date(); today.setHours(23, 59, 59, 0);
      const todayWd = (today.getDay() + 6) % 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - todayWd);
      monday.setHours(0, 0, 0, 0);
      return ended.filter(s => new Date(s.ended) >= monday);
    } else {
      const cycleLen = activeSch.days?.length || 7;
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - cycleLen);
      return ended.filter(s => new Date(s.ended) >= cutoff);
    }
  }, [clientStore]);

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '16px 12px 32px' }}>
      {/* Top stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, padding: '0 4px' }}>
        <StatBox label="Adherence (6w)" value={overallAdherence != null ? `${overallAdherence}%` : '—'} gold={overallAdherence >= 80} onClick={() => setChartOpen('adherence')} />
        <StatBox label="Avg Volume" value={avgVol != null ? `${avgVol.toLocaleString('en-US')}kg` : '—'} onClick={() => setChartOpen('volume')} />
        <StatBox label="Sessions (30d)" value={last30.length} onClick={() => setChartOpen('sessions')} />
      </div>

      <Sheet open={!!chartOpen} onClose={() => setChartOpen(null)} title={chartTitles[chartOpen] || ''}>
        <div style={{ paddingBottom: 8 }}>
          {chartOpen === 'adherence' && <AdherenceChart weeks={weeks} />}
          {chartOpen === 'volume' && <RollingVolumeChart sessions={ended} />}
          {chartOpen === 'sessions' && <SessionsWeekChart sessions={ended} />}
        </div>
      </Sheet>

      {/* Weekly adherence table */}
      {weeks.length > 0 && (
        <>
          <div className="micro" style={{ color: UI.inkFaint, margin: '0 0 8px', paddingLeft: 2 }}>WEEKLY ADHERENCE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
            {weeks.map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}` }}>
                <div style={{ width: 72, flexShrink: 0, fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>{w.label}</div>
                <div style={{ flex: 1, height: 4, background: UI.bgRaised, borderRadius: 2, overflow: 'hidden' }}>
                  {w.planned > 0 && (
                    <div style={{
                      height: '100%', borderRadius: 2,
                      width: `${w.pct ?? 0}%`,
                      background: w.pct >= 80 ? '#7bc47b' : w.pct >= 50 ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.7)',
                      transition: 'width 0.3s ease',
                    }} />
                  )}
                </div>
                <div style={{ width: 52, flexShrink: 0, textAlign: 'right' }}>
                  {w.planned === 0 ? (
                    <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>no plan</span>
                  ) : (
                    <span className="num" style={{ fontSize: 12, color: w.pct >= 80 ? '#7bc47b' : w.pct >= 50 ? UI.gold : 'rgba(var(--danger-rgb),0.8)' }}>
                      {w.done}/{w.planned}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Active plan */}
      <div className="micro" style={{ color: UI.inkFaint, margin: '0 0 8px', paddingLeft: 2 }}>ACTIVE PLAN</div>
      {activeSch ? (
        <div style={{ padding: '12px 16px', background: UI.bgInset, borderRadius: 10, border: `0.5px solid ${UI.hair}`, marginBottom: 20 }}>
          <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{activeSch.name}</div>
          <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>{trainingDayCount} training {trainingDayCount === 1 ? 'day' : 'days'}</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', background: UI.bgInset, borderRadius: 10, border: `0.5px solid ${UI.hair}`, marginBottom: 20, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>No active plan</div>
      )}

      {/* Recent sessions */}
      <div className="micro" style={{ color: UI.inkFaint, margin: '0 0 8px', paddingLeft: 2 }}>
        {activeSch && LB.isWeekdayPlan(activeSch) ? 'THIS WEEK' : activeSch ? 'THIS CYCLE' : 'RECENT SESSIONS'}
      </div>
      {recentSessions.length === 0
        ? <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: '12px 14px' }}>No sessions yet.</div>
        : recentSessions.map(s => (
          <div key={s.id} onClick={() => onSelectSession?.(s)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: UI.bgInset, borderRadius: 10, border: `0.5px solid ${UI.hair}`, marginBottom: 8, cursor: 'pointer' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{s.dayName}</div>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>{fmtDate(s.date)}</div>
            </div>
            <span className="num" style={{ fontSize: 12, color: UI.gold }}>{Math.round(LB.totalVolume(s)).toLocaleString('en-US')}<span style={{ color: UI.inkFaint, fontSize: 10 }}>kg</span></span>
            <ChevronRight />
          </div>
        ))
      }
    </div>
  );
}

// ─── Metric charts ────────────────────────────────────────────────────────────

function AdherenceChart({ weeks }) {
  const data = weeks.filter(w => w.planned > 0);
  if (!data.length) return <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>No adherence data yet.</div>;
  const W = 300, H = 110, gap = 4;
  const barW = Math.max(6, Math.floor((W - gap * (data.length + 1)) / data.length));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} style={{ overflow: 'visible' }}>
      {data.map((w, i) => {
        const x = gap + i * (barW + gap);
        const h = w.pct > 0 ? Math.max(2, (w.pct / 100) * H) : 0;
        const color = w.pct >= 80 ? '#7bc47b' : w.pct >= 50 ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.7)';
        const labelText = w.label.length > 8 ? w.label.slice(0, 6) : w.label;
        return (
          <g key={i}>
            <rect x={x} y={0} width={barW} height={H} rx={2} style={{ fill: UI.bgRaised }} />
            {h > 0 && <rect x={x} y={H - h} width={barW} height={h} rx={2} fill={color} />}
            {w.pct > 0 && <text x={x + barW / 2} y={H - h - 3} textAnchor="middle" fontSize={7} style={{ fill: color, fontFamily: UI.fontUi }}>{w.pct}%</text>}
            <text x={x + barW / 2} y={H + 13} textAnchor="middle" fontSize={7} style={{ fill: UI.inkGhost, fontFamily: UI.fontUi }}>{labelText}</text>
          </g>
        );
      })}
    </svg>
  );
}

function RollingVolumeChart({ sessions }) {
  const ended = (sessions || []).filter(s => s.ended).sort((a, b) => a.ended.localeCompare(b.ended));
  const points = ended.map(s => {
    const d = new Date(s.ended);
    const from = new Date(d); from.setDate(from.getDate() - 30);
    const win = ended.filter(x => { const xd = new Date(x.ended); return xd >= from && xd <= d; });
    return { avg: win.length ? Math.round(win.reduce((sum, x) => sum + LB.totalVolume(x), 0) / win.length) : 0, date: s.ended.slice(0, 10) };
  }).slice(-40);

  if (points.length < 2) return <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Not enough sessions yet.</div>;

  const W = 300, H = 110;
  const maxV = Math.max(...points.map(p => p.avg));
  const minV = Math.min(...points.map(p => p.avg));
  const vRange = maxV - minV || 1;
  const px = i => (i / (points.length - 1)) * W;
  const py = v => H - 8 - ((v - minV) / vRange) * (H - 16);
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.avg).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;
  const trend = points[points.length - 1].avg - points[0].avg;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: trend >= 0 ? '#7bc47b' : 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>
          <i className={`fa-solid fa-arrow-trend-${trend >= 0 ? 'up' : 'down'}`} style={{ marginRight: 4 }} />
          {trend >= 0 ? '+' : ''}{Math.round(trend).toLocaleString('en-US')}kg since first session
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`}>
        <defs>
          <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#volGrad)" />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={px(0)} cy={py(points[0].avg)} r={3} fill="var(--accent)" />
        <circle cx={px(points.length - 1)} cy={py(points[points.length - 1].avg)} r={3} fill="var(--accent)" />
        <text x={0} y={H + 14} fontSize={7} style={{ fill: UI.inkGhost, fontFamily: UI.fontUi }}>{fmtDate(points[0].date)}</text>
        <text x={W} y={H + 14} textAnchor="end" fontSize={7} style={{ fill: UI.inkGhost, fontFamily: UI.fontUi }}>{fmtDate(points[points.length - 1].date)}</text>
        <text x={W - 2} y={Math.max(py(maxV) - 3, 8)} textAnchor="end" fontSize={7} style={{ fill: UI.inkGhost, fontFamily: UI.fontUi }}>{maxV.toLocaleString('en-US')}kg</text>
        <text x={W - 2} y={Math.min(py(minV) + 10, H - 2)} textAnchor="end" fontSize={7} style={{ fill: UI.inkGhost, fontFamily: UI.fontUi }}>{minV.toLocaleString('en-US')}kg</text>
      </svg>
    </div>
  );
}

function SessionsWeekChart({ sessions }) {
  const ended = (sessions || []).filter(s => s.ended);
  const byWeek = {};
  ended.forEach(s => {
    const d = new Date(s.ended); d.setHours(12, 0, 0, 0);
    const wd = (d.getDay() + 6) % 7;
    const mon = new Date(d); mon.setDate(d.getDate() - wd); mon.setHours(0, 0, 0, 0);
    const key = localDateKey(mon);
    byWeek[key] = (byWeek[key] || 0) + 1;
  });
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const todayWd = (today.getDay() + 6) % 7;
  const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - todayWd); thisMonday.setHours(0, 0, 0, 0);
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const mon = new Date(thisMonday); mon.setDate(thisMonday.getDate() - (11 - i) * 7);
    const key = localDateKey(mon);
    return { key, count: byWeek[key] || 0, label: mon.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) };
  });

  const W = 300, H = 110, gap = 3;
  const barW = Math.floor((W - gap * 13) / 12);
  const maxCount = Math.max(...weeks.map(w => w.count), 1);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`}>
      {weeks.map((w, i) => {
        const x = gap + i * (barW + gap);
        const h = (w.count / maxCount) * H;
        const showLabel = i === 0 || i === 5 || i === 11;
        return (
          <g key={i}>
            <rect x={x} y={0} width={barW} height={H} rx={2} style={{ fill: UI.bgRaised }} />
            {h > 0 && <rect x={x} y={H - h} width={barW} height={h} rx={2} fill="var(--accent)" />}
            {w.count > 0 && <text x={x + barW / 2} y={H - h - 3} textAnchor="middle" fontSize={7} style={{ fill: 'var(--accent)', fontFamily: UI.fontUi }}>{w.count}</text>}
            {showLabel && <text x={x + barW / 2} y={H + 13} textAnchor="middle" fontSize={7} style={{ fill: UI.inkGhost, fontFamily: UI.fontUi }}>{w.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function StatBox({ label, value, gold, onClick }) {
  return (
    <div onClick={onClick} style={{ flex: 1, background: UI.bgInset, borderRadius: 10, border: `0.5px solid ${UI.hair}`, padding: '12px 10px', textAlign: 'center', cursor: onClick ? 'pointer' : 'default' }}>
      <div className="num" style={{ fontSize: 20, color: gold ? UI.gold : UI.ink, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div className="micro" style={{ color: UI.inkFaint }}>{label}</div>
      {onClick && <div style={{ marginTop: 5 }}><i className="fa-solid fa-chart-line" style={{ fontSize: 7, color: UI.inkGhost }} /></div>}
    </div>
  );
}

// ─── Tab: Plan ────────────────────────────────────────────────────────────────

function ClientPlanTab({ clientStore, setClientStore, clientId, coachingId, userId, go, onReload, clientName }) {
  const schedules = (clientStore.schedules || []).filter(s => !s.archived);
  const active = clientStore.activeScheduleId;
  const importRef = useRefC(null);

  const activate = async (scheduleId) => {
    try {
      await LB.supabase.from('zane_user_settings')
        .update({ active_schedule_id: scheduleId })
        .eq('user_id', clientId);
      setClientStore(s => ({ ...s, activeScheduleId: scheduleId }));
      const planName = clientStore.schedules?.find(s => s.id === scheduleId)?.name || scheduleId;
      const threadId = await LB.getOrCreateCoachingThread(coachingId, 'Changes', userId);
      await LB.addCoachingNote(coachingId, 'plan', scheduleId, planName,
        `Activated plan\n${planName}`, userId, threadId);
    } catch (e) { alert(e.message); }
  };

  const exportPlan = (sch) => {
    const exIds = new Set();
    (sch.days || []).forEach(d => (d.items || []).forEach(it => { if (it.exId) exIds.add(it.exId); }));
    const exercises = (clientStore.exercises || []).filter(e => exIds.has(e.id));
    const payload = { type: 'zane-plan', version: 1, schedule: sch, exercises };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sch.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importPlan = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.type !== 'zane-plan' || !data.schedule) { alert('Invalid plan file.'); return; }
        const idMap = {};
        const newExercises = [];
        (data.exercises || []).forEach(ex => {
          const existing = (clientStore.exercises || []).find(x => x.name.trim().toLowerCase() === ex.name.trim().toLowerCase());
          if (existing) {
            idMap[ex.id] = existing.id;
          } else {
            const newId = LB.uid();
            idMap[ex.id] = newId;
            newExercises.push({ id: newId, name: ex.name, tags: ex.tags || [], note: ex.note || '', category: ex.category || null, unilateral: ex.unilateral || false, equipment: ex.equipment || null, progression_reps: ex.progression_reps || null });
          }
        });
        const sch = {
          ...data.schedule,
          id: LB.uid(),
          archived: false,
          days: (data.schedule.days || []).map(d => ({
            ...d,
            id: LB.uid(),
            items: (d.items || []).map(it => ({ ...it, exId: idMap[it.exId] || it.exId })),
          })),
        };
        if (newExercises.length) {
          await LB.supabase.from('zane_exercises').insert(newExercises.map(ex => ({ ...ex, user_id: clientId })));
        }
        await LB.supabase.from('zane_schedules').insert({ id: sch.id, user_id: clientId, name: sch.name, days: sch.days, archived: false });
        setClientStore(s => ({
          ...s,
          exercises: [...(s.exercises || []), ...newExercises],
          schedules: [...(s.schedules || []), sch],
        }));
      } catch (_) { alert('Could not read plan file.'); }
    };
    reader.readAsText(file);
  };

  const name = clientName || clientStore.user?.name || '?';

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '16px 12px 32px' }}>
      {/* Actions row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => go({ name: 'coaching-new-plan', coachingId, clientId, clientName: name })}
          style={{ flex: 1, padding: '10px 0', borderRadius: 6, border: `0.5px solid rgba(var(--accent-rgb),0.3)`, background: `rgba(var(--accent-rgb),0.06)`, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <i className="fa-solid fa-plus" style={{ fontSize: 10 }} />
          NEW PLAN
        </button>
        <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importPlan} />
        <button
          onClick={() => importRef.current?.click()}
          style={{ flex: 1, padding: '10px 0', borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <i className="fa-solid fa-file-import" style={{ fontSize: 10 }} />
          IMPORT
        </button>
      </div>

      {schedules.length === 0 ? (
        <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: '12px 14px' }}>No plans yet.</div>
      ) : schedules.map(sch => (
        <div key={sch.id} style={{ marginBottom: 10, background: UI.bgInset, borderRadius: 12, border: `0.5px solid ${sch.id === active ? 'rgba(var(--accent-rgb),0.4)' : UI.hair}`, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
            {sch.id === active && (
              <div style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)', flexShrink: 0 }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{sch.name}</div>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>
                {(sch.days || []).filter(d => d.items?.length > 0).length} workout days
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {sch.id !== active && (
                <button onClick={() => activate(sch.id)} style={{ background: 'transparent', border: `0.5px solid rgba(var(--accent-rgb),0.5)`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 10, color: 'var(--accent)', letterSpacing: '0.08em' }}>
                  ACTIVATE
                </button>
              )}
              <button
                onClick={() => go({ name: 'coaching-edit-plan', coachingId, clientId, scheduleId: sch.id, clientName: name })}
                style={{ background: 'transparent', border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 10, color: UI.inkSoft, letterSpacing: '0.08em' }}
              >
                EDIT
              </button>
              <button
                onClick={() => exportPlan(sch)}
                style={{ width: 30, height: 30, background: 'transparent', border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                title="Export plan"
              >
                <i className="fa-solid fa-share-from-square" style={{ fontSize: 10, color: UI.inkSoft }} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tab: Sessions ────────────────────────────────────────────────────────────

function ClientSessionsTab({ clientStore, coachingId, userId, clientName, initialSelected, onClearSelected }) {
  const [selected, setSelected] = useStateC(initialSelected || null);
  const [noteOpen, setNoteOpen] = useStateC(false);
  const [noteBody, setNoteBody] = useStateC('');
  const [noteSaving, setNoteSaving] = useStateC(false);
  const sessions = (clientStore.sessions || []).filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));

  const saveNote = async () => {
    if (!noteBody.trim() || !selected) return;
    setNoteSaving(true);
    try {
      const threadName = `Notes for ${selected.dayName} on ${fmtDate(selected.date)}`;
      const threadId = await LB.getOrCreateCoachingThread(coachingId, threadName, userId);
      await LB.addCoachingNote(coachingId, 'session', selected.id, selected.dayName, noteBody.trim(), userId, threadId);
      setNoteBody('');
      setNoteOpen(false);
    } catch (e) { alert(e.message); } finally { setNoteSaving(false); }
  };

  if (selected) {
    const vol = LB.totalVolume(selected);
    // Only sessions that ended strictly before the selected session — prev must be in the past.
    const storeWithoutSelected = { ...clientStore, sessions: clientStore.sessions.filter(s => s.ended && s.ended < selected.ended) };
    return (
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `0.5px solid ${UI.hair}`, position: 'sticky', top: 0, background: UI.bg, zIndex: 1 }}>
          <button onClick={() => { setSelected(null); onClearSelected?.(); }} style={{ width: 32, height: 32, borderRadius: 6, border: `0.5px solid ${UI.hair}`, background: UI.bgRaised, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="fa-solid fa-chevron-left" style={{ fontSize: 12, color: UI.inkSoft }} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{selected.dayName}</div>
            <div style={{ fontSize: 11, color: UI.inkFaint }}>{fmtDate(selected.date)}</div>
          </div>
          <button onClick={() => setNoteOpen(true)} style={{ background: 'transparent', border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft }}>+ NOTE</button>
        </div>
        <div style={{ padding: '12px 12px 32px' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <StatBox label="Volume" value={`${Math.round(vol).toLocaleString('en-US')}kg`} />
            <StatBox label="Sets" value={LB.doneSetCount(selected)} />
            <StatBox label="Duration" value={selected.durationMinutes ? `${selected.durationMinutes}m` : '—'} />
          </div>
          {(selected.entries || []).map((e, i) => {
            const lastResult = e.exId
              ? LB.lastSessionForExercise(storeWithoutSelected, e.exId, selected.dayId)
              : null;
            const lastSets = (lastResult?.entry?.sets || []).filter(s => !s.warmup && (s.kg != null || s.reps != null));
            return (
              <div key={i} style={{ padding: '10px 14px', borderBottom: `0.5px solid ${UI.hair}` }}>
                <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 6 }}>{e.name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: lastSets.length ? 5 : 0 }}>
                  {(e.sets || []).filter(s => !s.warmup).map((s, j) => (
                    <span key={j} className="num" style={{ fontSize: 12, color: s.done ? UI.ink : UI.inkFaint, background: UI.bgInset, borderRadius: 4, padding: '2px 8px', border: `0.5px solid ${UI.hair}` }}>
                      {s.kg ?? '—'}kg × {s.reps ?? s.repsL ?? '—'}
                    </span>
                  ))}
                </div>
                {lastSets.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                    <span className="micro" style={{ color: UI.inkGhost }}>PREV</span>
                    {lastSets.map((s, j) => (
                      <span key={j} className="num" style={{ fontSize: 11, color: UI.inkGhost, background: 'transparent', borderRadius: 4, padding: '1px 6px', border: `0.5px solid ${UI.hair}` }}>
                        {s.kg ?? '—'}kg × {s.reps ?? s.repsL ?? '—'}
                      </span>
                    ))}
                    <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>{fmtDate(lastResult.session.date)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Sheet open={noteOpen} onClose={() => setNoteOpen(false)} title="Session Note">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} placeholder={`Note for ${selected.dayName}…`} rows={4} style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 8, padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, outline: 'none', resize: 'none', width: '100%', boxSizing: 'border-box' }} />
            <Btn onClick={saveNote} disabled={noteSaving || !noteBody.trim()}>{noteSaving ? 'Saving…' : 'Save Note'}</Btn>
          </div>
        </Sheet>
      </div>
    );
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px 32px' }}>
      {sessions.length === 0 ? (
        <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: '32px 14px', textAlign: 'center' }}>No sessions yet.</div>
      ) : sessions.map(s => {
        const vol = LB.totalVolume(s);
        return (
          <div key={s.id} onClick={() => setSelected(s)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `0.5px solid ${UI.hair}`, cursor: 'pointer' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{s.dayName}</div>
              <div style={{ fontSize: 11, color: UI.inkFaint }}>{fmtDate(s.date)} · {LB.doneSetCount(s)} sets</div>
            </div>
            <span className="num" style={{ fontSize: 12, color: UI.gold }}>{Math.round(vol).toLocaleString('en-US')}<span style={{ color: UI.inkFaint, fontSize: 10 }}>kg</span></span>
            <ChevronRight />
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: Notes ───────────────────────────────────────────────────────────────

function ClientNotesTab({ coachingId, userId, clientName, store, setStore }) {
  const unreadNotes = store?.coaching?.unreadNotes || [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <ThreadList coachingId={coachingId} userId={userId} otherName={clientName} unreadNotes={unreadNotes} setStore={setStore} canDelete={true} />
    </div>
  );
}

// ─── Tab: Nutrition ───────────────────────────────────────────────────────────

function ClientNutritionTab({ coachingId, userId }) {
  const [macros, setMacros] = useStateC([]);
  const [loading, setLoading] = useStateC(true);
  const [saving, setSaving] = useStateC(false);
  const [historyOpen, setHistoryOpen] = useStateC(false);
  const emptyForm = { proteinTraining: '', carbsTraining: '', fatTraining: '', proteinRest: '', carbsRest: '', fatRest: '' };
  const [form, setForm] = useStateC(emptyForm);

  // Calories auto-computed: protein*4 + carbs*4 + fat*9
  const calcCals = (pro, car, fat) => {
    const total = (parseInt(pro) || 0) * 4 + (parseInt(car) || 0) * 4 + (parseInt(fat) || 0) * 9;
    return total > 0 ? total : null;
  };
  const calsTraining = calcCals(form.proteinTraining, form.carbsTraining, form.fatTraining);
  const calsRest     = calcCals(form.proteinRest,     form.carbsRest,     form.fatRest);

  const reload = () => {
    setLoading(true);
    LB.loadCoachingMacros(coachingId).then(data => {
      setMacros(data);
      if (data.length > 0) {
        const l = data[0];
        setForm({
          proteinTraining: l.proteinTraining?.toString() ?? '',
          carbsTraining:   l.carbsTraining?.toString()   ?? '',
          fatTraining:     l.fatTraining?.toString()     ?? '',
          proteinRest:     l.proteinRest?.toString()     ?? '',
          carbsRest:       l.carbsRest?.toString()       ?? '',
          fatRest:         l.fatRest?.toString()         ?? '',
        });
      }
    }).finally(() => setLoading(false));
  };

  useEffectC(() => { reload(); }, [coachingId]);

  const save = async () => {
    const macro = {
      caloriesTraining: calsTraining,
      proteinTraining:  form.proteinTraining ? parseInt(form.proteinTraining) : null,
      carbsTraining:    form.carbsTraining   ? parseInt(form.carbsTraining)   : null,
      fatTraining:      form.fatTraining     ? parseInt(form.fatTraining)     : null,
      caloriesRest:     calsRest,
      proteinRest:      form.proteinRest     ? parseInt(form.proteinRest)     : null,
      carbsRest:        form.carbsRest       ? parseInt(form.carbsRest)       : null,
      fatRest:          form.fatRest         ? parseInt(form.fatRest)         : null,
    };
    setSaving(true);
    try {
      await LB.addCoachingMacros(coachingId, macro, userId);
      const fmtDay = (cal, pro, car, fat) => [cal && `${cal} kcal`, pro && `${pro}g protein`, car && `${car}g carbs`, fat && `${fat}g fat`].filter(Boolean).join(' · ');
      const td = fmtDay(macro.caloriesTraining, macro.proteinTraining, macro.carbsTraining, macro.fatTraining);
      const rd = fmtDay(macro.caloriesRest,     macro.proteinRest,     macro.carbsRest,     macro.fatRest);
      const parts = [td && `Training day\n${td}`, rd && `Rest day\n${rd}`].filter(Boolean);
      if (parts.length) {
        const body = `Your macros have been updated.\n\n${parts.join('\n\n')}`;
        const threadId = await LB.getOrCreateCoachingThread(coachingId, 'Nutrition', userId);
        await LB.addCoachingNote(coachingId, 'general', null, null, body, userId, threadId);
      }
      reload();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  // Plain render helpers (not React components) — avoids remount-on-render keyboard bug
  const inputStyle = { width: '100%', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '9px 36px 9px 10px', fontFamily: UI.fontNum, fontSize: 16, color: UI.ink, outline: 'none', boxSizing: 'border-box' };
  const unitStyle  = { position: 'absolute', right: 8, fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, pointerEvents: 'none' };

  const renderInput = (fieldKey, label, unit) => (
    <div style={{ flex: 1 }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>{label}</div>
      <div style={{ position: 'relative' }}>
        <input type="number" inputMode="numeric" value={form[fieldKey]}
          onChange={e => setForm(f => ({ ...f, [fieldKey]: e.target.value }))}
          placeholder="—" style={inputStyle} />
        <span style={unitStyle}>{unit}</span>
      </div>
    </div>
  );

  const renderCals = (cals) => (
    <div style={{ flex: 1 }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>CALORIES</div>
      <div style={{ position: 'relative' }}>
        <div style={{ ...inputStyle, background: UI.bgRaised, border: `0.5px solid ${UI.hair}`, color: cals ? UI.ink : UI.inkGhost, display: 'flex', alignItems: 'center' }}>
          {cals ?? '—'}
        </div>
        <span style={unitStyle}>kcal</span>
      </div>
    </div>
  );

  const renderSection = (prefix, label, cals) => (
    <div style={{ marginBottom: 20 }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>{label}</div>
      <div style={{ background: UI.bgInset, borderRadius: 12, border: `0.5px solid ${UI.hair}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {renderCals(cals)}
          {renderInput(`protein${prefix}`, 'PROTEIN', 'g')}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {renderInput(`carbs${prefix}`, 'CARBS', 'g')}
          {renderInput(`fat${prefix}`, 'FAT', 'g')}
        </div>
      </div>
    </div>
  );

  if (loading) return <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '16px 12px 32px' }}>
      {renderSection('Training', 'TRAINING DAY', calsTraining)}
      {renderSection('Rest', 'REST DAY', calsRest)}

      <Btn onClick={save} disabled={saving} style={{ marginBottom: 24, width: '100%' }}>
        {saving ? 'Saving…' : 'Save Macros'}
      </Btn>

      {macros.length > 0 && (
        <>
          <button onClick={() => setHistoryOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: 8 }}>
            <span className="micro" style={{ color: UI.inkFaint }}>HISTORY ({macros.length})</span>
            <i className={`fa-solid fa-chevron-${historyOpen ? 'up' : 'down'}`} style={{ fontSize: 8, color: UI.inkGhost }} />
          </button>
          {historyOpen && macros.map(m => {
            const td = [m.caloriesTraining && `${m.caloriesTraining} kcal`, m.proteinTraining && `${m.proteinTraining}g P`, m.carbsTraining && `${m.carbsTraining}g C`, m.fatTraining && `${m.fatTraining}g F`].filter(Boolean).join(' · ');
            const rd = [m.caloriesRest && `${m.caloriesRest} kcal`, m.proteinRest && `${m.proteinRest}g P`, m.carbsRest && `${m.carbsRest}g C`, m.fatRest && `${m.fatRest}g F`].filter(Boolean).join(' · ');
            return (
              <div key={m.id} style={{ padding: '10px 14px', background: UI.bgInset, borderRadius: 10, border: `0.5px solid ${UI.hair}`, marginBottom: 8 }}>
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>
                  {fmtDate(m.setAt)} · {new Date(m.setAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </div>
                {td && <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 2 }}>Train: {td}</div>}
                {rd && <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>Rest: {rd}</div>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── CoachPlanEditorScreen ────────────────────────────────────────────────────
// Wraps the existing ScheduleEditScreen with client store + syncing.

function CoachPlanEditorScreen({ store, setStore, go, userId, coachingId, clientId, clientName, scheduleId }) {
  const [clientStore, setClientStoreRaw] = useStateC(null);
  const prevClientStore = useRefC(null);
  const latestClientStore = useRefC(null);  // updated synchronously for diff; prevClientStore only after confirmed sync
  const initialSchedule = useRefC(null);
  const isDirty = useRefC(false);

  useEffectC(() => {
    LB.loadClientStore(clientId).then(data => {
      setClientStoreRaw(data);
      prevClientStore.current = data;
      latestClientStore.current = data;
      const sch = data.schedules?.find(s => s.id === scheduleId);
      initialSchedule.current = sch ? JSON.parse(JSON.stringify(sch)) : null;
    });
  }, [clientId]);

  const setClientStore = useRefC(null);
  if (!setClientStore.current) {
    setClientStore.current = (updater) => {
      setClientStoreRaw(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        isDirty.current = true;
        latestClientStore.current = next;
        LB.syncStore(prevClientStore.current, next, clientId)
          .then(() => { prevClientStore.current = next; })
          .catch(e => console.error('Coach sync failed', e));
        return next;
      });
    };
  }

  // Intercept go: notify client via Changes thread if plan was modified, then return to plan tab
  const coachGo = async (route) => {
    if (route.name === 'plan-view' || route.name === 'plan') {
      if (isDirty.current) {
        isDirty.current = false;
        try {
          const finalSch  = latestClientStore.current?.schedules?.find(s => s.id === scheduleId);
          const schName   = finalSch?.name || scheduleId;
          const exercises = latestClientStore.current?.exercises || [];
          const diff      = diffSchedule(initialSchedule.current, finalSch, exercises);
          const body      = diff
            ? `Updated plan: ${schName}\n\n${diff.split('\n').map(l => `• ${l}`).join('\n')}`
            : `Updated plan: ${schName}`;
          const threadId = await LB.getOrCreateCoachingThread(coachingId, `Changes on ${schName}`, userId);
          await LB.addCoachingNote(coachingId, 'plan', scheduleId, schName, body, userId, threadId);
        } catch (e) { console.error('Failed to send plan change note', e); }
      }
      go({ name: 'coaching-client', coachingId, clientId, clientName, initialTab: 'plan' });
    } else {
      go(route);
    }
  };

  if (!clientStore) {
    return (
      <Screen>
        <TopBar title={clientName} sub={<span className="micro" style={{ color: 'var(--accent)' }}>COACHING</span>} onBack={() => go({ name: 'coaching-client', coachingId, clientId, clientName, initialTab: 'plan' })} />
        <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Loading…</div>
      </Screen>
    );
  }

  return (
    <window.Screens.ScheduleEditScreen
      store={clientStore}
      setStore={setClientStore.current}
      go={coachGo}
      userId={clientId}
      scheduleId={scheduleId}
    />
  );
}

// ─── CoachNewPlanScreen ───────────────────────────────────────────────────────
// Wraps ScheduleNewScreen with client store + syncing so a coach can create
// a brand-new plan for a client.

function CoachNewPlanScreen({ store, setStore, go, userId, coachingId, clientId, clientName }) {
  const [clientStore, setClientStoreRaw] = useStateC(null);
  const prevClientStore = useRefC(null);

  useEffectC(() => {
    LB.loadClientStore(clientId).then(data => {
      setClientStoreRaw(data);
      prevClientStore.current = data;
    });
  }, [clientId]);

  const setClientStore = useRefC(null);
  if (!setClientStore.current) {
    setClientStore.current = (updater) => {
      setClientStoreRaw(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        LB.syncStore(prevClientStore.current, next, clientId)
          .then(() => { prevClientStore.current = next; })
          .catch(e => console.error('Coach sync failed', e));
        return next;
      });
    };
  }

  const coachGo = (route) => {
    if (route.name === 'plan') {
      go({ name: 'coaching-client', coachingId, clientId, clientName, initialTab: 'plan' });
    } else if (route.name === 'schedule-edit') {
      go({ name: 'coaching-edit-plan', coachingId, clientId, clientName, scheduleId: route.scheduleId });
    } else {
      go(route);
    }
  };

  if (!clientStore) {
    return (
      <Screen>
        <TopBar title={clientName} sub={<span className="micro" style={{ color: 'var(--accent)' }}>COACHING</span>} onBack={() => go({ name: 'coaching-client', coachingId, clientId, clientName, initialTab: 'plan' })} />
        <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Loading…</div>
      </Screen>
    );
  }

  return (
    <window.Screens.ScheduleNewScreen
      store={clientStore}
      setStore={setClientStore.current}
      go={coachGo}
    />
  );
}

// ─── CoachingBannerGroup ──────────────────────────────────────────────────────
// Renders unread banner + notes sheet; mounted in HomeScreen.

function CoachingBannerGroup({ store, setStore, userId, go }) {
  const [notesOpen, setNotesOpen] = useStateC(false);
  const notes = store.coaching?.unreadNotes || [];

  const clientIds = new Set((store.coaching?.asCoach || []).map(c => c.clientId));
  const fromClient = notes.some(n => clientIds.has(n.authorId));

  // Keep mounted while sheet is open so ChatThread isn't destroyed mid-read
  if (!notes.length && !notesOpen) return null;

  const handleOpen = () => {
    if (fromClient && go) {
      const note = notes.find(n => clientIds.has(n.authorId));
      const client = note && (store.coaching?.asCoach || []).find(c => c.clientId === note.authorId);
      if (client) {
        go({ name: 'coaching-client', coachingId: client.id, clientId: client.clientId, clientName: client.clientName, initialTab: 'notes' });
        return;
      }
      go({ name: 'settings' });
    } else {
      setNotesOpen(true);
    }
  };

  return (
    <div style={{ flexShrink: 0, padding: notes.length > 0 ? '0 22px 10px' : 0 }}>
      {notes.length > 0 && (
        <CoachingUnreadBanner store={store} setStore={setStore} userId={userId} onOpen={handleOpen} />
      )}
      <CoachingNotesSheet open={notesOpen} store={store} setStore={setStore} userId={userId} onClose={() => setNotesOpen(false)} />
    </div>
  );
}

// ─── Register ─────────────────────────────────────────────────────────────────

window.Screens = window.Screens || {};
Object.assign(window.Screens, {
  CoachingPendingBanner,
  CoachingUnreadBanner,
  CoachingNotesSheet,
  CoachingBannerGroup,
  CoachingSettingsSection,
  CoachingDashboard,
  CoachClientScreen,
  CoachPlanEditorScreen,
  CoachNewPlanScreen,
});
