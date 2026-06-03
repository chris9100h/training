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



function isImprovement(curr, prev) {
  if (!prev || !curr || !curr.done || curr.skipped || curr.kg == null || prev.kg == null) return false;
  const rA = LB.effReps(curr); const rB = LB.effReps(prev);
  if (rA == null || rB == null) return false;
  return (curr.kg > prev.kg && rA >= rB - 2) || (curr.kg >= prev.kg && rA > rB);
}
function isDecline(curr, prev) {
  if (!prev || !curr || curr.skipped) return false;
  if (prev.skipped) return false;
  if (!curr.done || curr.kg == null || prev.kg == null) return false;
  const rA = LB.effReps(curr); const rB = LB.effReps(prev);
  if (rA == null || rB == null) return false;
  return (curr.kg < prev.kg && rA <= rB) || (curr.kg === prev.kg && rA < rB);
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

function CoachClientScreen({ store, setStore, userId, go, coachingId, clientId, clientName, initialTab, backRoute = 'settings' }) {
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
    { id: 'overview',   icon: 'fa-chart-bar',         label: 'Overview' },
    { id: 'plan',       icon: 'fa-calendar-days',      label: 'Plan' },
    { id: 'sessions',   icon: 'fa-dumbbell',           label: 'Sessions' },
    { id: 'checkins',   icon: 'fa-clipboard-list',     label: 'Check-ins' },
    { id: 'nutrition',  icon: 'fa-utensils',           label: 'Nutrition' },
    { id: 'notes',      icon: 'fa-comment',            label: 'Notes' },
  ];

  return (
    <Screen scroll={false}>
      <TopBar
        title={clientName}
        sub={<span className="micro" style={{ color: 'var(--accent)', letterSpacing: '0.12em' }}>COACHING</span>}
        onBack={() => go({ name: backRoute })}
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
              onClick={() => go({ name: 'spectator', targetUserId: clientId, userName: clientName })}
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
          {tab === 'checkins'   && <ClientCheckInsTab coachingId={coachingId} />}
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
  const d = new Date(date); d.setHours(12, 0, 0, 0);
  if (clientStore.cycleStartDate) {
    const start = LB.parseDate(clientStore.cycleStartDate);
    const n = Math.round((d.getTime() - start.getTime()) / 86400000);
    return ((n % cycleLen) + cycleLen) % cycleLen;
  }
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const daysAgo = Math.round((today - d) / 86400000);
  return (((clientStore.cycleIndex || 0) - daysAgo) % cycleLen + cycleLen) % cycleLen;
}

// Format a Date to "YYYY-MM-DD" using local time — avoids UTC off-by-one issues.
function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTodayDay(clientStore) {
  const activeSch = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId);
  if (!activeSch) return null;
  if (LB.isWeekdayPlan(activeSch)) {
    const todayWd = (new Date().getDay() + 6) % 7;
    return (activeSch.days || []).find(d => d.weekday === todayWd) || { id: 'rest-virtual', name: 'REST', items: [] };
  }
  let idx;
  if (clientStore.cycleStartDate) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = LB.parseDate(clientStore.cycleStartDate);
    const n = Math.round((today.getTime() - start.getTime()) / 86400000);
    idx = ((n % activeSch.days.length) + activeSch.days.length) % activeSch.days.length;
  } else {
    idx = (clientStore.cycleIndex || 0) % activeSch.days.length;
  }
  return (activeSch.days || [])[idx] || null;
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
  const [planOpen, setPlanOpen] = useStateC(false);

  const activeSch = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId);
  const trainingDayCount = activeSch ? (activeSch.days || []).filter(d => d.items?.length > 0).length : 0;
  const todayDay = useMemoC(() => getTodayDay(clientStore), [clientStore]);
  const todayStr = localDateKey(new Date());
  const todaySession = useMemoC(() =>
    (clientStore.sessions || []).find(s => s.ended && s.date?.slice(0, 10) === todayStr && s.scheduleId === activeSch?.id) || null,
    [clientStore, activeSch]
  );
  const trainedToday = !!todaySession;
  const planStartDate = activeSch
    ? (LB.isWeekdayPlan(activeSch) ? clientStore.weekPlanStartDate : clientStore.cycleStartDate) || null
    : null;

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
          {chartOpen === 'volume' && <RollingVolumeChart sessions={ended} planStartDate={planStartDate} />}
          {chartOpen === 'sessions' && <SessionsWeekChart sessions={ended} />}
        </div>
      </Sheet>

      {/* Up Today */}
      {activeSch && (
        <>
          <div className="micro" style={{ color: UI.inkFaint, margin: '0 0 8px', paddingLeft: 2 }}>UP TODAY</div>
          {todayDay?.items?.length > 0 ? (
            <div
              onClick={() => setPlanOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: UI.bgInset, borderRadius: 12, border: `0.5px solid ${UI.hair}`, marginBottom: 20, cursor: 'pointer' }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{todayDay.name}</div>
                <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>
                  {todayDay.items.filter(i => i.exId).length} exercises
                </div>
              </div>
              {trainedToday && (
                <span className="micro" style={{ color: '#7bc47b', marginRight: 4 }}>DONE</span>
              )}
              <ChevronRight />
            </div>
          ) : (
            <div style={{ padding: '12px 16px', background: UI.bgInset, borderRadius: 12, border: `0.5px solid ${UI.hair}`, marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi }}>Rest day</div>
            </div>
          )}

          <Sheet open={planOpen} onClose={() => setPlanOpen(false)} title={todayDay?.name || 'Today'}>
            {trainedToday && todaySession ? (
              <div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  <StatBox label="Volume" value={`${Math.round(LB.totalVolume(todaySession)).toLocaleString('en-US')}kg`} />
                  <StatBox label="Sets" value={LB.doneSetCount(todaySession)} />
                  <StatBox label="Duration" value={todaySession.durationMinutes ? `${todaySession.durationMinutes}m` : '—'} />
                </div>
                {(() => {
                  const storeWithoutToday = { ...clientStore, sessions: clientStore.sessions.filter(s => s.ended && s.ended < todaySession.ended) };
                  return (todaySession.entries || []).map((e, i) => {
                    const lastResult = e.exId ? LB.lastSessionForExercise(storeWithoutToday, e.exId, todaySession.dayId) : null;
                    const lastSets = (lastResult?.entry?.sets || []).filter(s => !s.warmup && (s.kg != null || s.reps != null));
                    return (
                      <div key={i} style={{ padding: '10px 0', borderBottom: `0.5px solid ${UI.hair}` }}>
                        <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 6 }}>{e.name}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: lastSets.length ? 5 : 0 }}>
                          {(e.sets || []).filter(s => !s.warmup).map((s, j) => {
                            const prev = lastSets[j];
                            const anyImpBefore = (e.sets || []).filter(x => !x.warmup).slice(0, j).some((x, k) => isImprovement(x, lastSets[k]));
                            const highlight = isImprovement(s, prev);
                            const decline   = !anyImpBefore && isDecline(s, prev);
                            return (
                              <span key={j} className="num" style={{
                                fontSize: 12,
                                color: highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : s.done ? UI.ink : UI.inkFaint,
                                background: highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : UI.bgInset,
                                borderRadius: 4, padding: '2px 8px',
                                border: `0.5px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hair}`,
                              }}>
                                {s.kg ?? '—'}kg × {s.reps ?? s.repsL ?? '—'}
                              </span>
                            );
                          })}
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
                  });
                })()}
              </div>
            ) : (
              <div>
                {(todayDay?.items || []).filter(i => i.exId).map((item, idx) => {
                  const ex = (clientStore.exercises || []).find(e => e.id === item.exId);
                  const last = LB.lastSessionForExercise(clientStore, item.exId, todayDay.id);
                  const suggestion = LB.progressionSuggestion(clientStore, item.exId, todayDay.id, item.reps);
                  const seeds = LB.buildSeedSets(item, last, suggestion, ex?.unilateral, clientStore.settings?.smartProgression);
                  const hasWeight = seeds.some(s => s.kg != null);
                  return (
                    <div key={idx} style={{ padding: '12px 4px', borderBottom: `0.5px solid ${UI.hair}` }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{ex?.name || item.exId}</div>
                        {item.sets && item.reps && (
                          <span className="micro" style={{ color: UI.inkFaint }}>{item.sets} × {item.reps}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {hasWeight ? seeds.map((s, j) => (
                          <span key={j} className="num" style={{ fontSize: 12, color: UI.ink, background: UI.bgInset, borderRadius: 4, padding: '3px 8px', border: `0.5px solid ${UI.hairStrong}` }}>
                            {s.kg ?? '—'}kg × {s.reps ?? s.repsL ?? '—'}
                          </span>
                        )) : (
                          <span style={{ fontSize: 11, color: UI.inkGhost, fontFamily: UI.fontUi }}>First time — no weight data yet</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Sheet>
        </>
      )}

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
  const data = weeks.filter(w => w.planned > 0).slice().reverse();
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

function RollingVolumeChart({ sessions, planStartDate }) {
  const cutoff = planStartDate ? planStartDate.slice(0, 10) : null;
  const ended = (sessions || []).filter(s => s.ended && s.date && (!cutoff || s.date.slice(0, 10) >= cutoff)).sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)));
  const allPoints = ended.map(s => {
    const dateKey = s.date.slice(0, 10);
    const d = new Date(dateKey + 'T12:00:00');
    const from = new Date(d); from.setDate(from.getDate() - 30);
    const win = ended.filter(x => { const xd = new Date(x.date.slice(0, 10) + 'T12:00:00'); return xd >= from && xd <= d; });
    return { avg: win.length ? Math.round(win.reduce((sum, x) => sum + LB.totalVolume(x), 0) / win.length) : 0, date: dateKey };
  });
  const points = allPoints.slice(-40);

  if (points.length < 2) return <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Not enough sessions yet.</div>;

  const W = 300, H = 110;
  const maxV = Math.max(...points.map(p => p.avg));
  const minV = Math.min(...points.map(p => p.avg));
  const vRange = maxV - minV || 1;
  const px = i => (i / (points.length - 1)) * W;
  const py = v => H - 8 - ((v - minV) / vRange) * (H - 16);
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.avg).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;
  const trend = allPoints[allPoints.length - 1].avg - allPoints[0].avg;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: trend >= 0 ? '#7bc47b' : 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>
          <i className={`fa-solid fa-arrow-trend-${trend >= 0 ? 'up' : 'down'}`} style={{ marginRight: 4 }} />
          {trend >= 0 ? '+' : ''}{Math.round(trend).toLocaleString('en-US')}kg since plan start
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
      const oldPlanName = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId)?.name;
      await LB.supabase.from('zane_user_settings')
        .update({ active_schedule_id: scheduleId })
        .eq('user_id', clientId);
      setClientStore(s => ({ ...s, activeScheduleId: scheduleId }));
      const planName = clientStore.schedules?.find(s => s.id === scheduleId)?.name || scheduleId;
      const threadName = oldPlanName ? `Plan changed from ${oldPlanName} to ${planName}` : `Plan changed to ${planName}`;
      const body = oldPlanName
        ? `Your plan has been changed from "${oldPlanName}" to "${planName}". If you have any questions, feel free to ask.`
        : `Your plan has been set to "${planName}". If you have any questions, feel free to ask.`;
      const threadId = await LB.getOrCreateCoachingThread(coachingId, threadName, userId);
      await LB.addCoachingNote(coachingId, 'plan', scheduleId, planName, body, userId, threadId);
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
                  {(e.sets || []).filter(s => !s.warmup).map((s, j) => {
                    const prev = lastSets[j];
                    const anyImpBefore = (e.sets || []).filter(x => !x.warmup).slice(0, j).some((x, k) => isImprovement(x, lastSets[k]));
                    const highlight = isImprovement(s, prev);
                    const decline   = !anyImpBefore && isDecline(s, prev);
                    return (
                      <span key={j} className="num" style={{
                        fontSize: 12,
                        color: highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : s.done ? UI.ink : UI.inkFaint,
                        background: highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : UI.bgInset,
                        borderRadius: 4, padding: '2px 8px',
                        border: `0.5px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hair}`,
                      }}>
                        {s.kg ?? '—'}kg × {s.reps ?? s.repsL ?? '—'}
                      </span>
                    );
                  })}
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

// ─── Tab: Check-ins (coach view) ─────────────────────────────────────────────

// ─── LineChartSheet ───────────────────────────────────────────────────────────

function LineChartSheet({ label, icon, entries, format, invertColor, onClose }) {
  const W = 300, padX = 20, padTop = 36, padBottom = 26, plotH = 110;
  const H = padTop + plotH + padBottom;
  const plotW = W - 2 * padX;
  const vals = entries.map(e => e.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const n = entries.length;

  const xOf = i => padX + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yOf = v => padTop + (1 - (v - minV) / range) * plotH;

  const fmtD = s => {
    const d = new Date(s + 'T12:00:00');
    return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;
  };

  const pts = entries.map((e, i) => `${xOf(i).toFixed(1)},${yOf(e.value).toFixed(1)}`).join(' ');
  const base = (padTop + plotH).toFixed(1);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div style={{ background: UI.bg, borderRadius: '16px 16px 0 0', padding: '20px 20px 44px', borderTop: `0.5px solid ${UI.hairStrong}` }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className={`fa-solid ${icon}`} style={{ fontSize: 13, color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, fontSize: 18, lineHeight: 1 }}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        {n < 2 ? (
          <div style={{ textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, padding: '24px 0' }}>Need at least 2 check-ins for a trend.</div>
        ) : (
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
            <polygon points={`${xOf(0).toFixed(1)},${base} ${pts} ${xOf(n-1).toFixed(1)},${base}`} fill={`rgba(var(--accent-rgb),0.12)`} />
            <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {entries.map((e, i) => {
              const cx = xOf(i).toFixed(1);
              const cy = yOf(e.value).toFixed(1);
              const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
              return (
                <g key={i}>
                  <circle cx={cx} cy={cy} r="4" fill="var(--accent)" />
                  <text x={cx} y={(yOf(e.value) - 9).toFixed(1)} textAnchor="middle" fontSize="9" fontFamily={UI.fontUi} fill={UI.ink}>{format(e.value)}</text>
                  <text x={cx} y={(padTop + plotH + 18).toFixed(1)} textAnchor={anchor} fontSize="8" fontFamily={UI.fontUi} fill={UI.inkFaint}>{fmtD(e.weekStart)}</text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

// ─── CheckInTrendCards ────────────────────────────────────────────────────────
// Shared trend cards component used by both coach and client check-in views.
// recent = last 6 check-ins sorted oldest → newest.

function CheckInTrendCards({ recent }) {
  const [chartModal, setChartModal] = useStateC(null);
  const n = Math.min(recent.length, 6);

  const openChart = (label, icon, values, format, invertColor) => {
    const entries = values
      .map((v, i) => v != null ? { weekStart: recent[i].weekStart, value: v } : null)
      .filter(Boolean);
    if (entries.length) setChartModal({ label, icon, entries, format, invertColor });
  };

  const Sparkline = ({ vals }) => {
    if (vals.length < 2) return null;
    const min = Math.min(...vals); const max = Math.max(...vals);
    const range = max - min || 1;
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, marginTop: 8, height: 20 }}>
        {vals.map((v, i) => {
          const h = Math.max(3, Math.round(((v - min) / range) * 16) + 3);
          return <div key={i} style={{ flex: 1, height: h, borderRadius: 2, background: i === vals.length - 1 ? 'var(--accent)' : `rgba(var(--accent-rgb),0.3)` }} />;
        })}
      </div>
    );
  };

  const cardStyle = { flex: 1, minWidth: 80, background: UI.bgInset, borderRadius: 10, padding: '8px 10px', border: `0.5px solid ${UI.hair}`, display: 'flex', flexDirection: 'column', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };

  const TrendCard = ({ label, icon, values, format, invertColor, sub }) => {
    const valid = values.filter(v => v != null);
    if (!valid.length) return null;
    const last = valid[valid.length - 1];
    const prev = valid.length > 1 ? valid[valid.length - 2] : null;
    const delta = prev != null ? last - prev : null;
    const up = delta > 0;
    const arrowColor = delta === 0 || delta == null ? UI.inkFaint
      : invertColor ? (up ? 'rgba(var(--danger-rgb),0.8)' : 'var(--accent)')
      : (up ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.8)');
    return (
      <div onClick={() => openChart(label, icon, values, format, invertColor)} style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
          <i className={`fa-solid ${icon}`} style={{ fontSize: 10, color: UI.inkFaint }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
          <span className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>{format(last)}</span>
          {delta != null && Math.abs(delta) > 0.001 && (
            <span style={{ fontSize: 10, color: arrowColor, fontFamily: UI.fontUi }}>{up ? '▲' : '▼'} {format(Math.abs(delta))}</span>
          )}
        </div>
        {sub && <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2, textAlign: 'center' }}>{sub}</div>}
        <Sparkline vals={valid} />
      </div>
    );
  };

  const TrainingTrendCard = () => {
    const dtVals = recent.map(c => c.daysTrained);
    const valid = dtVals.filter(v => v != null);
    if (!valid.length) return null;
    const last = valid[valid.length - 1];
    const prev = valid.length > 1 ? valid[valid.length - 2] : null;
    const delta = prev != null ? last - prev : null;
    const lastPerf = [...recent].reverse().find(c => c.performanceVsLastWeek)?.performanceVsLastWeek;
    const perfColor = lastPerf === 'improved' ? 'var(--accent)' : lastPerf === 'worse' ? 'rgba(var(--danger-rgb),0.8)' : UI.inkSoft;
    const perfLabel = lastPerf === 'improved' ? '↑ Better' : lastPerf === 'worse' ? '↓ Worse' : lastPerf === 'same' ? '= Same' : null;
    return (
      <div onClick={() => openChart('Training days', 'fa-dumbbell', dtVals, v => `${v}d`, false)} style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
          <i className="fa-solid fa-dumbbell" style={{ fontSize: 10, color: UI.inkFaint }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Training</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>{last}d</span>
          {delta != null && Math.abs(delta) > 0 && (
            <span style={{ fontSize: 10, color: delta > 0 ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</span>
          )}
          {perfLabel && <span style={{ fontSize: 9, color: perfColor, fontFamily: UI.fontUi, fontWeight: 700 }}>{perfLabel}</span>}
        </div>
        <Sparkline vals={valid} />
      </div>
    );
  };

  const CardioTrendCard = () => {
    const allMins = recent.map(c => c.cardioMinutes);
    const validItems = recent.filter(c => c.cardioMinutes != null);
    if (!validItems.length) return null;
    const last = validItems[validItems.length - 1];
    const prev = validItems.length > 1 ? validItems[validItems.length - 2] : null;
    const delta = prev != null ? last.cardioMinutes - prev.cardioMinutes : null;
    const sub = last.cardioDistanceM != null ? `${(last.cardioDistanceM / 1000).toFixed(1)} km` : null;
    return (
      <div onClick={() => openChart('Cardio', 'fa-person-running', allMins, v => `${v}m`, false)} style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
          <i className="fa-solid fa-person-running" style={{ fontSize: 10, color: UI.inkFaint }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Cardio</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
          <span className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>{last.cardioMinutes}m</span>
          {delta != null && Math.abs(delta) > 0 && (
            <span style={{ fontSize: 10, color: delta > 0 ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</span>
          )}
        </div>
        {sub && <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2, textAlign: 'center' }}>{sub}</div>}
        <Sparkline vals={validItems.map(c => c.cardioMinutes)} />
      </div>
    );
  };

  const TrendSection = ({ label, children }) => {
    const hasAny = React.Children.toArray(children).some(Boolean);
    if (!hasAny) return null;
    return (
      <div>
        <div className="micro" style={{ fontWeight: 700, color: UI.inkFaint, marginBottom: 8, borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8 }}>{label}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>{children}</div>
      </div>
    );
  };

  return (
    <>
      {chartModal && <LineChartSheet {...chartModal} onClose={() => setChartModal(null)} />}
      <div className="micro" style={{ color: UI.inkFaint }}>TRENDS — LAST {n} CHECK-IN{n !== 1 ? 'S' : ''}</div>
      <TrendSection label="WEIGHT">
        <TrendCard label="Avg last week" icon="fa-weight-scale" values={recent.map(c => c.weightAvgLastWeek)} format={v => `${v}kg`} invertColor={false} />
        <TrendCard label="Today" icon="fa-weight-scale" values={recent.map(c => c.weightToday)} format={v => `${v}kg`} invertColor={false} />
      </TrendSection>
      <TrendSection label="MARKERS">
        <TrendCard label="Hunger" icon="fa-bowl-food" values={recent.map(c => c.hunger)} format={v => `${v}`} invertColor={true} />
        <TrendCard label="Sleep" icon="fa-moon" values={recent.map(c => c.sleepQuality)} format={v => `${v}`} invertColor={true} />
        <TrendCard label="Life stress" icon="fa-brain" values={recent.map(c => c.lifeStress)} format={v => `${v}`} invertColor={true} />
        <TrendCard label="Work stress" icon="fa-briefcase" values={recent.map(c => c.workStress)} format={v => `${v}`} invertColor={true} />
        <TrendCard label="Tiredness" icon="fa-battery-half" values={recent.map(c => c.tiredness)} format={v => `${v}`} invertColor={true} />
      </TrendSection>
      <TrendSection label="TRAINING">
        <TrainingTrendCard />
        <TrendCard label="Steps" icon="fa-shoe-prints" values={recent.map(c => c.steps)} format={v => `${Math.round(v / 1000)}k`} invertColor={false} />
      </TrendSection>
      <TrendSection label="CARDIO">
        <CardioTrendCard />
        <TrendCard label="Pace feeling" icon="fa-gauge" values={recent.map(c => c.cardioPaceFeeling)} format={v => `${v}/6`} invertColor={false} />
        <TrendCard label="Effort" icon="fa-fire" values={recent.map(c => c.cardioEffort)} format={v => `${v}/10`} invertColor={true} />
      </TrendSection>
    </>
  );
}

// ─── ClientCheckInsTab (coach view) ───────────────────────────────────────────

function ClientCheckInsTab({ coachingId }) {
  const [checkins, setCheckins] = useStateC(null);

  useEffectC(() => {
    LB.loadCheckins(coachingId).then(setCheckins).catch(() => {});
  }, [coachingId]);

  if (checkins === null) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.1em' }}>LOADING…</div></div>;
  }

  if (!checkins.length) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 }}>
        <i className="fa-solid fa-clipboard-list" style={{ fontSize: 28, color: UI.inkGhost }} />
        <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center' }}>No check-ins yet.</div>
      </div>
    );
  }

  const recent = [...checkins].slice(0, 6).reverse();

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 14px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="micro" style={{ color: UI.inkFaint }}>ALL CHECK-INS</div>
        {checkins.map(ci => <CheckInCard key={ci.id} ci={ci} />)}
      </div>
      <CheckInTrendCards recent={recent} />
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
        const isActivePlan = scheduleId === latestClientStore.current?.activeScheduleId;
        if (isActivePlan) {
          try {
            const finalSch  = latestClientStore.current?.schedules?.find(s => s.id === scheduleId);
            const schName   = finalSch?.name || scheduleId;
            const exercises = latestClientStore.current?.exercises || [];
            const diff      = LB.diffSchedule(initialSchedule.current, finalSch, exercises);
            const body      = diff
              ? `Updated plan: ${schName}\n\n${diff.split('\n').map(l => `• ${l}`).join('\n')}`
              : `Updated plan: ${schName}`;
            const threadId = await LB.getOrCreateCoachingThread(coachingId, `Changes on ${schName}`, userId);
            await LB.addCoachingNote(coachingId, 'plan', scheduleId, schName, body, userId, threadId);
          } catch (e) { console.error('Failed to send plan change note', e); }
        }
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

// ─── CoachingTabScreen ────────────────────────────────────────────────────────
// Root screen for the coaching tab — routes to coach or client view.
// When the user is both coach and client, shows a two-tab layout.

function CoachingTabScreen({ store, setStore, userId, go }) {
  const isCoach = (store.coaching?.asCoach || []).filter(c => c.status === 'active').length > 0;
  const isClient = store.coaching?.asClient?.status === 'active';
  const [tab, setTab] = useStateC('clients');

  if (isCoach && isClient) {
    const tabs = [
      { id: 'clients', label: 'My Clients', icon: 'fa-users' },
      { id: 'coach',   label: 'My Coach',   icon: 'fa-person-chalkboard' },
    ];
    return (
      <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: UI.bg, color: UI.ink }}>
        <div style={{ display: 'flex', borderBottom: `0.5px solid ${UI.hair}`, background: UI.bg, flexShrink: 0, paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '10px 4px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent', WebkitTapHighlightColor: 'transparent' }}>
              <i className={`fa-solid ${t.icon}`} style={{ fontSize: 14, color: tab === t.id ? 'var(--accent)' : UI.inkFaint }} />
              <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.08em', color: tab === t.id ? 'var(--accent)' : UI.inkFaint, textTransform: 'uppercase' }}>{t.label}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: tab === 'clients' ? 'flex' : 'none', flexDirection: 'column' }}>
          <CoachingTabCoachView store={store} setStore={setStore} userId={userId} go={go} hideTopBar />
        </div>
        <div style={{ flex: 1, minHeight: 0, display: tab === 'coach' ? 'flex' : 'none', flexDirection: 'column' }}>
          <CoachingTabClientView store={store} setStore={setStore} userId={userId} go={go} hideTopBar />
        </div>
      </div>
    );
  }

  if (isClient) return <CoachingTabClientView store={store} setStore={setStore} userId={userId} go={go} />;
  return <CoachingTabCoachView store={store} setStore={setStore} userId={userId} go={go} />;
}

// ─── CoachingTabCoachView ─────────────────────────────────────────────────────

function CoachingTabCoachView({ store, setStore, userId, go, hideTopBar = false }) {
  const allClients = store.coaching?.asCoach || [];
  const [liveMap, setLiveMap] = useStateC({});
  const [checkinMap, setCheckinMap] = useStateC({});
  const [inviteOpen, setInviteOpen] = useStateC(false);
  const [inviteEmail, setInviteEmail] = useStateC('');
  const [inviting, setInviting] = useStateC(false);
  const [inviteError, setInviteError] = useStateC('');
  const [endOpen, setEndOpen] = useStateC(false);
  const [ending, setEnding] = useStateC(null);
  const [confirmEl, confirm] = useConfirm();
  const unreadNotes = store.coaching?.unreadNotes || [];

  useEffectC(() => {
    const poll = () => {
      Promise.all([LB.loadCoachClientsStatus(), LB.loadCoachCheckinStatus()])
        .then(([statusData, checkinData]) => {
          const lm = {};
          statusData.forEach(r => { lm[r.clientId] = r.inProgressSessionId; });
          setLiveMap(lm);
          const cm = {};
          checkinData.forEach(r => { cm[r.coachingId] = r.hasCheckin; });
          setCheckinMap(cm);
        })
        .catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, []);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError('');
    try {
      const result = await LB.inviteClient(inviteEmail.trim());
      if (result?.startsWith('ERROR:not_found')) { setInviteError('No user found with that email.'); return; }
      if (result?.startsWith('ERROR:self')) { setInviteError('Cannot coach yourself.'); return; }
      if (result?.startsWith('ERROR:exists')) { setInviteError('Invite already sent or coaching already active.'); return; }
      if (result?.startsWith('ERROR:already_coached')) { setInviteError('This person already has an active coach.'); return; }
      setInviteEmail('');
      setInviteOpen(false);
      const coaching = await LB.reloadCoachingState(userId);
      setStore(s => s ? { ...s, coaching } : s);
    } catch (e) {
      setInviteError(e.message);
    } finally {
      setInviting(false);
    }
  };

  const handleEnd = async (client) => {
    setEndOpen(false);
    const isPending = client.status === 'pending';
    const msg = isPending
      ? `Cancel the invite sent to ${client.clientName || client.clientEmail}?`
      : `End coaching with ${client.clientName || client.clientEmail}? This will immediately revoke access to training data.`;
    const title = isPending ? 'Cancel invite?' : 'End coaching?';
    const ok = isPending ? 'Cancel invite' : 'End';
    if (!await confirm(msg, { title, ok, danger: true })) return;
    setEnding(client.id);
    try {
      await LB.endCoaching(client.id);
      const coaching = await LB.reloadCoachingState(userId);
      setStore(s => s ? { ...s, coaching } : s);
    } catch (e) {
      alert(e.message);
    } finally {
      setEnding(null);
    }
  };

  const handleRequestCheckin = async (coachingId) => {
    try { await LB.requestCheckin(coachingId, userId); } catch (e) { console.error(e); }
  };

  const AddIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>
    </svg>
  );

  const RemoveIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <line x1="22" y1="11" x2="16" y2="11"/>
    </svg>
  );

  const actionButtons = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {allClients.length > 0 && (
        <button onClick={() => setEndOpen(true)} style={{ background: 'transparent', border: 'none', padding: '4px 6px', cursor: 'pointer', color: UI.inkSoft, display: 'flex', alignItems: 'center' }}>
          <RemoveIcon />
        </button>
      )}
      <button onClick={() => { setInviteEmail(''); setInviteError(''); setInviteOpen(true); }} style={{ background: 'transparent', border: 'none', padding: '4px 6px', cursor: 'pointer', color: 'var(--accent)', display: 'flex', alignItems: 'center' }}>
        <AddIcon />
      </button>
    </div>
  );

  return (
    <Screen scroll>
      {confirmEl}
      {hideTopBar
        ? <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 10px 0', flexShrink: 0 }}>{actionButtons}</div>
        : <TopBar title="Coaching" right={actionButtons} />
      }

      {/* Invite sheet */}
      <Sheet open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite Client">
        <div style={{ padding: '8px 0 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
            The user must already have an account. They'll see the invite next time the app is opened.
          </div>
          <input
            type="email"
            placeholder="client@email.com"
            value={inviteEmail}
            onChange={e => { setInviteEmail(e.target.value); setInviteError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleInvite(); }}
            autoFocus
            style={{ width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 10, border: `1px solid ${inviteError ? 'rgba(var(--danger-rgb),0.6)' : UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, outline: 'none' }}
          />
          {inviteError && (
            <div style={{ fontSize: 12, color: 'rgba(var(--danger-rgb),0.85)', fontFamily: UI.fontUi }}>{inviteError}</div>
          )}
          <button
            onClick={handleInvite}
            disabled={inviting || !inviteEmail.trim()}
            style={{ width: '100%', padding: '13px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#0a0805', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 700, cursor: inviting || !inviteEmail.trim() ? 'not-allowed' : 'pointer', opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }}
          >
            {inviting ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
      </Sheet>

      {/* End / cancel sheet */}
      <Sheet open={endOpen} onClose={() => setEndOpen(false)} title="End Coaching">
        <div style={{ padding: '4px 0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 6, lineHeight: 1.5 }}>
            Select a client to end the relationship or cancel a pending invite.
          </div>
          {allClients.map(c => {
            const isPending = c.status === 'pending';
            return (
              <div
                key={c.id}
                onClick={() => handleEnd(c)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: UI.bgInset, borderRadius: 10, border: `0.5px solid ${UI.hair}`, cursor: ending === c.id ? 'wait' : 'pointer' }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 18, background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontFamily: UI.fontUi, fontSize: 15, color: UI.inkSoft, fontWeight: 700 }}>{(c.clientName || c.clientEmail || '?')[0].toUpperCase()}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{c.clientName || c.clientEmail}</div>
                  {isPending
                    ? <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 1 }}>INVITE PENDING</div>
                    : <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 1 }}>{c.clientEmail}</div>
                  }
                </div>
                <div style={{ fontSize: 11, fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.04em', color: 'rgba(var(--danger-rgb),0.7)' }}>
                  {isPending ? 'CANCEL' : 'END'}
                </div>
              </div>
            );
          })}
        </div>
      </Sheet>

      {allClients.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>
          No clients yet.<br />
          <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => { setInviteEmail(''); setInviteError(''); setInviteOpen(true); }}>Invite someone →</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 12px 24px' }}>
          {allClients.map(c => {
            const inProgress = liveMap[c.clientId];
            const clientUnread = unreadNotes.filter(n => n.authorId === c.clientId).length;
            const checkinDue = c.status === 'active' && checkinMap[c.id] === false;
            return (
              <CoachingTabClientCard
                key={c.id}
                client={c}
                inProgress={inProgress}
                unreadCount={clientUnread}
                checkinDue={checkinDue}
                onRequestCheckin={() => handleRequestCheckin(c.id)}
                go={go}
              />
            );
          })}
        </div>
      )}
    </Screen>
  );
}

function CoachingTabClientCard({ client, inProgress, unreadCount, checkinDue, onRequestCheckin, go }) {
  const isPending = client.status === 'pending';
  const [requested, setRequested] = useStateC(false);

  const handleCardClick = () => {
    if (isPending) return;
    go({ name: 'coaching-client', coachingId: client.id, clientId: client.clientId, clientName: client.clientName, backRoute: 'coaching' });
  };

  const handleRequest = (e) => {
    e.stopPropagation();
    if (requested) return;
    setRequested(true);
    onRequestCheckin();
    setTimeout(() => setRequested(false), 4000);
  };

  const borderColor = inProgress ? 'rgba(var(--accent-rgb),0.4)' : checkinDue ? 'rgba(var(--accent-rgb),0.2)' : UI.hair;

  return (
    <div
      onClick={handleCardClick}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: UI.bgInset, borderRadius: 12, border: `0.5px solid ${borderColor}`, cursor: isPending ? 'default' : 'pointer', position: 'relative', overflow: 'hidden', opacity: isPending ? 0.75 : 1 }}
    >
      {inProgress && (
        <div style={{ position: 'absolute', inset: 0, background: `rgba(var(--accent-rgb),0.04)`, pointerEvents: 'none' }} />
      )}
      <div style={{ width: 44, height: 44, borderRadius: 22, background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 18, color: UI.inkSoft, fontWeight: 700 }}>{(client.clientName || client.clientEmail || '?')[0].toUpperCase()}</span>
        {inProgress && (
          <div style={{ position: 'absolute', top: 0, right: 0, width: 12, height: 12, borderRadius: 6, background: 'var(--accent)', border: '2px solid var(--bg)', animation: 'pulseDot 1.5s ease-in-out infinite' }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 2 }}>{client.clientName || client.clientEmail}</div>
        {isPending ? (
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.05em' }}>INVITE PENDING</div>
        ) : inProgress ? (
          <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.06em' }}>TRAINING NOW</div>
        ) : checkinDue ? (
          <div style={{ fontSize: 11, color: `rgba(var(--accent-rgb),0.7)`, fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.06em' }}>CHECK-IN DUE</div>
        ) : (
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>{client.clientEmail}</div>
        )}
      </div>
      {checkinDue && !isPending && (
        <button
          onClick={handleRequest}
          style={{ background: requested ? `rgba(var(--accent-rgb),0.15)` : 'transparent', border: `0.5px solid ${requested ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, borderRadius: 7, padding: '5px 8px', cursor: requested ? 'default' : 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <i className="fa-solid fa-bell" style={{ fontSize: 10, color: requested ? 'var(--accent)' : UI.inkFaint }} />
          <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.06em', color: requested ? 'var(--accent)' : UI.inkFaint, textTransform: 'uppercase' }}>{requested ? 'Sent' : 'Remind'}</span>
        </button>
      )}
      {!isPending && unreadCount > 0 && (
        <div style={{ minWidth: 20, height: 20, borderRadius: 10, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontFamily: UI.fontUi, fontWeight: 700, color: '#0a0805' }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        </div>
      )}
      {!isPending && <ChevronRight />}
    </div>
  );
}

// ─── CheckIn helpers ─────────────────────────────────────────────────────────

function fmtWeek(weekStart) {
  if (!weekStart) return '';
  const d = new Date(weekStart + 'T12:00:00');
  const end = new Date(d); end.setDate(d.getDate() + 6);
  const fmt = (dt) => dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  return `${fmt(d)} – ${fmt(end)}`;
}

function MarkerRow({ label, value, onChange, readOnly }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>{label}</span>
        {value != null && <span className="num" style={{ fontSize: 11, color: 'var(--accent)' }}>{value}/10</span>}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {[1,2,3,4,5,6,7,8,9,10].map(n => (
          <button
            key={n}
            onClick={() => !readOnly && onChange(n)}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 5, border: 'none', cursor: readOnly ? 'default' : 'pointer',
              background: value === n ? 'var(--accent)' : value != null && n <= value ? `rgba(var(--accent-rgb),0.18)` : UI.bgInset,
              color: value === n ? '#0a0805' : n <= 3 ? 'var(--accent)' : n <= 6 ? UI.inkSoft : UI.inkFaint,
              fontSize: 10, fontFamily: UI.fontUi, fontWeight: value === n ? 700 : 400,
              transition: 'background 0.1s',
            }}
          >{n}</button>
        ))}
      </div>
    </div>
  );
}

function CheckInCard({ ci, defaultOpen = false }) {
  const [open, setOpen] = useStateC(defaultOpen);
  const hasActivity = ci.daysTrained != null || ci.steps != null || ci.cardioMinutes != null || ci.performanceVsLastWeek != null;
  const hasMarkers = ci.hunger != null || ci.sleepQuality != null || ci.lifeStress != null || ci.workStress != null || ci.tiredness != null;

  return (
    <div style={{ background: UI.bgInset, borderRadius: 12, border: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', gap: 12 }}
      >
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>Week of {fmtWeek(ci.weekStart)}</div>
          {ci.weightToday != null && (
            <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, marginTop: 2 }}>
              {ci.weightToday} kg{ci.weightAvgLastWeek != null ? ` · avg ${ci.weightAvgLastWeek} kg` : ''}
            </div>
          )}
        </div>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: 11, color: UI.inkFaint }} />
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Markers */}
          {hasMarkers && (
            <div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>MARKERS (1=good/low, 10=bad/high)</div>
              {[['Hunger', ci.hunger], ['Sleep', ci.sleepQuality], ['Life Stress', ci.lifeStress], ['Work Stress', ci.workStress], ['Tiredness', ci.tiredness]].filter(([, v]) => v != null).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `0.5px solid ${UI.hair}` }}>
                  <span style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>{label}</span>
                  <span className="num" style={{ fontSize: 12, color: value <= 3 ? 'var(--accent)' : value >= 7 ? 'rgba(var(--danger-rgb),0.8)' : UI.ink }}>{value}/10</span>
                </div>
              ))}
            </div>
          )}

          {/* Activity */}
          {hasActivity && (
            <div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>ACTIVITY</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {ci.daysTrained != null && <StatPill label="Days trained" value={ci.daysTrained} />}
                {ci.performanceVsLastWeek && (
                  <StatPill label="Performance"
                    value={ci.performanceVsLastWeek === 'improved' ? '↑ Better' : ci.performanceVsLastWeek === 'worse' ? '↓ Worse' : '= Same'}
                  />
                )}
                {ci.steps != null && <StatPill label="Steps" value={Number(ci.steps).toLocaleString()} />}
                {ci.cardioMinutes != null && <StatPill label="Cardio" value={`${ci.cardioMinutes} min`} />}
                {ci.cardioDistanceM != null && <StatPill label="Distance" value={`${(ci.cardioDistanceM / 1000).toFixed(1)} km`} />}
                {ci.cardioPaceFeeling != null && <StatPill label="Pace feeling" value={`${ci.cardioPaceFeeling}/6`} />}
                {ci.cardioEffort != null && <StatPill label="Effort" value={`${ci.cardioEffort}/10`} />}
              </div>
            </div>
          )}

          {/* Weight detail */}
          {ci.weightToday != null && (
            <div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>WEIGHT</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <StatPill label="Today" value={`${ci.weightToday} kg`} />
                {ci.weightAvgLastWeek != null && <StatPill label="Last week avg" value={`${ci.weightAvgLastWeek} kg`} />}
              </div>
            </div>
          )}

          {/* Hydration */}
          {ci.hydrationMl != null && (
            <div><div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>HYDRATION</div>
              <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>{(ci.hydrationMl / 1000).toFixed(1)} L / day</div>
            </div>
          )}

          {/* Off-plan */}
          {ci.offPlanNotes && (
            <div><div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>OFF-PLAN</div>
              <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ci.offPlanNotes}</div>
            </div>
          )}

          {/* Goal */}
          {ci.goalNote && (
            <div><div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>GOAL</div>
              <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>{ci.goalNote}</div>
            </div>
          )}

          {/* Issues */}
          {ci.issuesNotes && (
            <div><div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>ISSUES / TO ADDRESS</div>
              <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ci.issuesNotes}</div>
            </div>
          )}

          {/* General note */}
          {ci.generalNote && (
            <div><div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>NOTE</div>
              <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ci.generalNote}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value }) {
  return (
    <div style={{ background: UI.bgRaised, borderRadius: 8, padding: '7px 10px', border: `0.5px solid ${UI.hair}` }}>
      <div className="num" style={{ fontSize: 15, color: UI.ink, fontWeight: 300 }}>{value}</div>
      <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.07em', marginTop: 1 }}>{label}</div>
    </div>
  );
}

// ─── CheckInForm ──────────────────────────────────────────────────────────────

function CheckInForm({ coachingId, clientId, userId, weekStart, existing, onSaved }) {
  const REQUIRED = ['hunger', 'sleepQuality', 'lifeStress', 'workStress', 'tiredness', 'weightToday'];

  const empty = {
    weightToday: '', weightAvgLastWeek: '',
    offPlanNotes: '', hydrationMl: '',
    daysTrained: '', performanceVsLastWeek: null,
    steps: '', cardioMinutes: '', cardioDistanceM: '',
    cardioPaceFeeling: null, cardioEffort: null,
    goalNote: '',
    hunger: null, sleepQuality: null, lifeStress: null, workStress: null, tiredness: null,
    issuesNotes: '', generalNote: '',
  };

  const [form, setForm] = useStateC(() => existing ? {
    weightToday: existing.weightToday ?? '',
    weightAvgLastWeek: existing.weightAvgLastWeek ?? '',
    offPlanNotes: existing.offPlanNotes ?? '',
    hydrationMl: existing.hydrationMl ?? '',
    daysTrained: existing.daysTrained ?? '',
    performanceVsLastWeek: existing.performanceVsLastWeek ?? null,
    steps: existing.steps ?? '',
    cardioMinutes: existing.cardioMinutes ?? '',
    cardioDistanceM: existing.cardioDistanceM ?? '',
    cardioPaceFeeling: existing.cardioPaceFeeling ?? null,
    cardioEffort: existing.cardioEffort ?? null,
    goalNote: existing.goalNote ?? '',
    hunger: existing.hunger ?? null,
    sleepQuality: existing.sleepQuality ?? null,
    lifeStress: existing.lifeStress ?? null,
    workStress: existing.workStress ?? null,
    tiredness: existing.tiredness ?? null,
    issuesNotes: existing.issuesNotes ?? '',
    generalNote: existing.generalNote ?? '',
  } : empty);

  const [saving, setSaving] = useStateC(false);
  const [error, setError] = useStateC('');

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const num = (v) => v === '' || v == null ? null : Number(v);

  const canSubmit = form.weightToday !== '' && form.weightToday != null &&
    form.hunger != null && form.sleepQuality != null &&
    form.lifeStress != null && form.workStress != null && form.tiredness != null;

  const handleSubmit = async () => {
    if (!canSubmit) { setError('Please fill in weight and all markers.'); return; }
    setSaving(true); setError('');
    try {
      await LB.submitCheckin(coachingId, clientId, {
        weightToday: num(form.weightToday),
        weightAvgLastWeek: num(form.weightAvgLastWeek),
        offPlanNotes: form.offPlanNotes || null,
        hydrationMl: num(form.hydrationMl),
        daysTrained: num(form.daysTrained),
        steps: num(form.steps),
        cardioMinutes: num(form.cardioMinutes),
        cardioDistanceM: num(form.cardioDistanceM),
        cardioPaceFeeling: form.cardioPaceFeeling,
        cardioEffort: form.cardioEffort,
        performanceVsLastWeek: form.performanceVsLastWeek || null,
        goalNote: form.goalNote || null,
        hunger: form.hunger,
        sleepQuality: form.sleepQuality,
        lifeStress: form.lifeStress,
        workStress: form.workStress,
        tiredness: form.tiredness,
        issuesNotes: form.issuesNotes || null,
        generalNote: form.generalNote || null,
      }, userId);
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none' };
  const SectionHead = ({ label }) => <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10, marginTop: 4 }}>{label}</div>;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 14px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Weight */}
      <div>
        <SectionHead label="WEIGHT *" />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Today (kg)</div>
            <input type="number" step="0.1" placeholder="–" value={form.weightToday} onChange={e => set('weightToday', e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Last week avg (kg)</div>
            <input type="number" step="0.1" placeholder="–" value={form.weightAvgLastWeek} onChange={e => set('weightAvgLastWeek', e.target.value)} style={inputStyle} />
          </div>
        </div>
      </div>

      {/* Markers */}
      <div>
        <SectionHead label="MARKERS * (1 = good/low, 10 = bad/high)" />
        <MarkerRow label="Hunger" value={form.hunger} onChange={v => set('hunger', v)} />
        <MarkerRow label="Sleep" value={form.sleepQuality} onChange={v => set('sleepQuality', v)} />
        <MarkerRow label="Life Stress" value={form.lifeStress} onChange={v => set('lifeStress', v)} />
        <MarkerRow label="Work Stress" value={form.workStress} onChange={v => set('workStress', v)} />
        <MarkerRow label="Tiredness" value={form.tiredness} onChange={v => set('tiredness', v)} />
      </div>

      {/* Activity */}
      <div>
        <SectionHead label="ACTIVITY" />

        {/* Days trained + performance vs last week */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Days trained</div>
            <input type="number" min="0" max="7" placeholder="–" value={form.daysTrained} onChange={e => set('daysTrained', e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 2 }}>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Performance vs last week</div>
            <div style={{ display: 'flex', gap: 5 }}>
              {[['worse', 'Worse'], ['same', 'Same'], ['improved', 'Improved']].map(([val, label]) => (
                <button key={val} onClick={() => set('performanceVsLastWeek', form.performanceVsLastWeek === val ? null : val)}
                  style={{ flex: 1, padding: '9px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: form.performanceVsLastWeek === val
                      ? val === 'improved' ? `rgba(var(--accent-rgb),0.2)` : val === 'worse' ? `rgba(var(--danger-rgb),0.15)` : UI.bgRaised
                      : UI.bgInset,
                    color: form.performanceVsLastWeek === val
                      ? val === 'improved' ? 'var(--accent)' : val === 'worse' ? 'rgba(var(--danger-rgb),0.85)' : UI.ink
                      : UI.inkFaint,
                    fontFamily: UI.fontUi, fontSize: 10, fontWeight: form.performanceVsLastWeek === val ? 700 : 400,
                    letterSpacing: '0.04em', border: `0.5px solid ${form.performanceVsLastWeek === val ? 'currentColor' : UI.hairStrong}`,
                  }}
                >{label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Steps */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Steps</div>
          <input type="number" placeholder="–" value={form.steps} onChange={e => set('steps', e.target.value)} style={inputStyle} />
        </div>

        {/* Cardio */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Cardio (min)</div>
            <input type="number" placeholder="–" value={form.cardioMinutes} onChange={e => set('cardioMinutes', e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Distance (m)</div>
            <input type="number" placeholder="–" value={form.cardioDistanceM} onChange={e => set('cardioDistanceM', e.target.value)} style={inputStyle} />
          </div>
        </div>

        {/* Pace feeling 1–6 */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Pace feeling</span>
            {form.cardioPaceFeeling != null && <span className="num" style={{ fontSize: 11, color: 'var(--accent)' }}>{form.cardioPaceFeeling}/6</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['1','Stroll'],['2','Walk'],['3','Brisk'],['4','Power'],['5','Jog'],['6','Run']].map(([n, lbl]) => (
              <button key={n} onClick={() => set('cardioPaceFeeling', form.cardioPaceFeeling === Number(n) ? null : Number(n))}
                style={{ flex: 1, padding: '7px 2px', borderRadius: 8, border: `0.5px solid ${form.cardioPaceFeeling === Number(n) ? 'var(--accent)' : UI.hairStrong}`,
                  background: form.cardioPaceFeeling === Number(n) ? `rgba(var(--accent-rgb),0.18)` : UI.bgInset,
                  cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
              >
                <span className="num" style={{ fontSize: 13, color: form.cardioPaceFeeling === Number(n) ? 'var(--accent)' : UI.inkSoft }}>{n}</span>
                <span style={{ fontSize: 8, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.04em' }}>{lbl}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Cardio effort 1–10 */}
        <MarkerRow label="Cardio effort (1 = easy, 10 = max)" value={form.cardioEffort} onChange={v => set('cardioEffort', v)} />
      </div>

      {/* Nutrition */}
      <div>
        <SectionHead label="NUTRITION" />
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Off-plan days / notes</div>
          <textarea placeholder="–" value={form.offPlanNotes} onChange={e => set('offPlanNotes', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }} />
        </div>
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Avg hydration / day (ml)</div>
        <input type="number" placeholder="–" value={form.hydrationMl} onChange={e => set('hydrationMl', e.target.value)} style={inputStyle} />
      </div>

      {/* Goals */}
      <div>
        <SectionHead label="GOALS / NOTES" />
        <textarea placeholder="–" value={form.goalNote} onChange={e => set('goalNote', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'none', lineHeight: 1.5, marginBottom: 8 }} />
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Issues / things to address</div>
        <textarea placeholder="–" value={form.issuesNotes} onChange={e => set('issuesNotes', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'none', lineHeight: 1.5, marginBottom: 8 }} />
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>General note</div>
        <textarea placeholder="–" value={form.generalNote} onChange={e => set('generalNote', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }} />
      </div>

      {error && <div style={{ fontSize: 12, color: 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>{error}</div>}

      <Btn onClick={handleSubmit} disabled={saving || !canSubmit}>
        {saving ? 'Sending…' : existing ? 'Update Check-in' : 'Submit Check-in'}
      </Btn>
    </div>
  );
}

// ─── ClientCheckInTab ─────────────────────────────────────────────────────────

function ClientCheckInTab({ coachingId, clientId, userId }) {
  const weekStart = LB.checkinWeekStart();
  const [checkins, setCheckins] = useStateC(null);
  const [editing, setEditing] = useStateC(false);

  const load = () => LB.loadCheckins(coachingId).then(setCheckins).catch(() => {});
  useEffectC(() => { load(); }, [coachingId]);

  const thisWeek = (checkins || []).find(c => c.weekStart === weekStart);
  const past = (checkins || []).filter(c => c.weekStart !== weekStart);

  const d = new Date(weekStart + 'T12:00:00');
  const end = new Date(d); end.setDate(d.getDate() + 6);

  if (checkins === null) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.1em' }}>LOADING…</div></div>;
  }

  if ((thisWeek && !editing)) {
    const recent = [...checkins].slice(0, 6).reverse();
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 14px 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>This week submitted ✓</div>
          <button onClick={() => setEditing(true)} style={{ background: 'transparent', border: 'none', fontSize: 11, color: 'var(--accent)', fontFamily: UI.fontUi, cursor: 'pointer', padding: '4px 0' }}>Edit</button>
        </div>
        <CheckInCard ci={thisWeek} defaultOpen={true} />
        {checkins.length >= 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 4 }}>
            <CheckInTrendCards recent={recent} />
          </div>
        )}
        {past.length > 0 && (
          <>
            <div className="micro" style={{ color: UI.inkFaint, marginTop: 8 }}>PREVIOUS CHECK-INS</div>
            {past.map(ci => <CheckInCard key={ci.id} ci={ci} />)}
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div style={{ padding: '10px 14px 0', flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
          Week of <strong>{fmtWeek(weekStart)}</strong> — covers Mon–Sun of last week.
        </div>
        {editing && <button onClick={() => setEditing(false)} style={{ background: 'transparent', border: 'none', fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, cursor: 'pointer', padding: '4px 0' }}>← Cancel</button>}
      </div>
      <CheckInForm
        coachingId={coachingId}
        clientId={clientId}
        userId={userId}
        weekStart={weekStart}
        existing={editing ? thisWeek : null}
        onSaved={() => { setEditing(false); load(); }}
      />
    </>
  );
}

// ─── CoachingTabClientView ────────────────────────────────────────────────────
// Client's coaching tab — messages + nutrition + check-in.

function CoachingTabClientView({ store, setStore, userId, go, hideTopBar = false }) {
  const coaching = store.coaching?.asClient;
  const [tab, setTab] = useStateC('messages');
  const [confirmEl, confirm] = useConfirm();
  const [ending, setEnding] = useStateC(false);

  const handleEnd = async () => {
    if (!await confirm(
      `End coaching with ${coaching?.coachName}? Your coach will lose access to your training data.`,
      { title: 'End coaching?', ok: 'End', danger: true }
    )) return;
    setEnding(true);
    try {
      await LB.endCoaching(coaching.id);
      const newCoaching = await LB.reloadCoachingState(userId);
      setStore(s => s ? { ...s, coaching: newCoaching } : s);
    } catch (e) {
      alert(e.message);
    } finally {
      setEnding(false);
    }
  };

  const EndIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <line x1="22" y1="11" x2="16" y2="11"/>
    </svg>
  );

  if (!coaching || coaching.status !== 'active') {
    return (
      <Screen scroll>
        {!hideTopBar && <TopBar title="Coaching" />}
        <div style={{ textAlign: 'center', padding: '60px 24px', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>
          No active coaching relationship.
        </div>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      {confirmEl}
      {!hideTopBar && <TopBar title="Coaching" />}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', background: UI.bgInset, borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0 }}>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: `rgba(var(--accent-rgb),0.15)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="fa-solid fa-dumbbell" style={{ fontSize: 16, color: 'var(--accent)' }} />
          </div>
          <div style={{ fontSize: 14, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.08em' }}>{(coaching.coachName || '').toUpperCase()}</div>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleEnd}
            disabled={ending}
            style={{ background: 'transparent', border: 'none', padding: '4px 2px', cursor: 'pointer', color: UI.inkSoft, display: 'flex', alignItems: 'center', opacity: ending ? 0.4 : 1 }}
          >
            <EndIcon />
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', borderBottom: `0.5px solid ${UI.hair}`, background: UI.bg, flexShrink: 0 }}>
        {[{ id: 'messages', label: 'Messages', icon: 'fa-comment' }, { id: 'nutrition', label: 'Nutrition', icon: 'fa-utensils' }, { id: 'checkin', label: 'Check-in', icon: 'fa-clipboard-list' }].map(t => (
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
      {tab === 'messages' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <ThreadList
            coachingId={coaching.id}
            userId={userId}
            otherName={coaching.coachName}
            unreadNotes={store.coaching?.unreadNotes || []}
            setStore={setStore}
          />
        </div>
      )}
      {tab === 'nutrition' && <ClientNutritionReadView coachingId={coaching.id} />}
      {tab === 'checkin' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <ClientCheckInTab coachingId={coaching.id} clientId={userId} userId={userId} />
        </div>
      )}
    </Screen>
  );
}

// ─── ClientNutritionReadView ──────────────────────────────────────────────────
// Read-only macro view for clients.

function ClientNutritionReadView({ coachingId }) {
  const [macros, setMacros] = useStateC(null);
  const [loading, setLoading] = useStateC(true);

  useEffectC(() => {
    LB.loadCoachingMacros(coachingId)
      .then(data => setMacros(data[0] || null))
      .finally(() => setLoading(false));
  }, [coachingId]);

  if (loading) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.1em' }}>LOADING…</div></div>;
  }

  if (!macros) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 }}>
        <i className="fa-solid fa-utensils" style={{ fontSize: 28, color: UI.inkGhost }} />
        <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center' }}>No macro targets set yet.<br />Your coach will add them here.</div>
      </div>
    );
  }

  const MacroDay = ({ label, calories, protein, carbs, fat }) => (
    <div style={{ background: UI.bgInset, borderRadius: 12, padding: '16px 18px', border: `0.5px solid ${UI.hair}` }}>
      <div className="micro-gold" style={{ marginBottom: 12 }}>{label}</div>
      {calories != null && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 14 }}>
          <span className="num" style={{ fontSize: 32, color: UI.ink, fontWeight: 300 }}>{calories}</span>
          <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>kcal</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        {[{ label: 'Protein', value: protein }, { label: 'Carbs', value: carbs }, { label: 'Fat', value: fat }].map(m => (
          <div key={m.label} style={{ flex: 1, background: UI.bgRaised, borderRadius: 8, padding: '10px 8px', textAlign: 'center', border: `0.5px solid ${UI.hair}` }}>
            <div className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>{m.value != null ? m.value : '—'}</div>
            <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', marginTop: 2 }}>g {m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const hasTraining = macros.caloriesTraining != null || macros.proteinTraining != null;
  const hasRest = macros.caloriesRest != null || macros.proteinRest != null;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, padding: '0 2px 4px' }}>
        Last updated {fmtRelative(macros.setAt)}
      </div>
      {hasTraining && (
        <MacroDay
          label="TRAINING DAY"
          calories={macros.caloriesTraining}
          protein={macros.proteinTraining}
          carbs={macros.carbsTraining}
          fat={macros.fatTraining}
        />
      )}
      {hasRest && (
        <MacroDay
          label="REST DAY"
          calories={macros.caloriesRest}
          protein={macros.proteinRest}
          carbs={macros.carbsRest}
          fat={macros.fatRest}
        />
      )}
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
  CoachingTabScreen,
});
