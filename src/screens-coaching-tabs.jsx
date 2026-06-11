/* Coaching screens — tab router, coach/client tab views, check-in forms,
   and the window.Screens registration. Shares globals with
   screens-coaching-core.jsx (loaded first). */

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
  const isSelf = !!store.settings?.beYourOwnCoach && !!store.coaching?.asSelf;

  const renderView = (id, hideTopBar) => {
    if (id === 'self') return (
      <CoachClientScreen
        store={store} setStore={setStore} userId={userId} go={go}
        coachingId={store.coaching.asSelf.id} clientId={userId}
        clientName={store.user?.name || 'You'} isSelf hideTopBar={hideTopBar}
      />
    );
    if (id === 'clients') return <CoachingTabCoachView store={store} setStore={setStore} userId={userId} go={go} hideTopBar={hideTopBar} />;
    return <CoachingTabClientView store={store} setStore={setStore} userId={userId} go={go} hideTopBar={hideTopBar} />;
  };

  const views = [];
  if (isSelf)   views.push({ id: 'self',    label: 'Myself',     icon: 'fa-chart-line' });
  if (isCoach)  views.push({ id: 'clients', label: 'My Clients', icon: 'fa-users' });
  if (isClient) views.push({ id: 'coach',   label: 'My Coach',   icon: 'fa-person-chalkboard' });

  // No active role → default to the coach view (empty client list + invite).
  if (views.length === 0) return <CoachingTabCoachView store={store} setStore={setStore} userId={userId} go={go} />;
  // Single role → render it directly with its own top bar.
  if (views.length === 1) return renderView(views[0].id, false);
  // Multiple roles → sub-tab bar across the active views.
  return <CoachingMultiView views={views} renderView={renderView} />;
}

// Sub-tab bar shown when a user holds several coaching roles at once
// (e.g. self + real clients). Keeps every view mounted so switching is instant.
function CoachingMultiView({ views, renderView }) {
  const [active, setActive] = useStateC(views[0].id);
  const activeId = views.some(v => v.id === active) ? active : views[0].id;
  return (
    <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: UI.bg, color: UI.ink }}>
      <div style={{ display: 'flex', borderBottom: `0.5px solid ${UI.hair}`, background: UI.bg, flexShrink: 0, paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {views.map(t => (
          <button key={t.id} onClick={() => setActive(t.id)} style={{ flex: 1, padding: '10px 4px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, borderBottom: activeId === t.id ? '2px solid var(--accent)' : '2px solid transparent', WebkitTapHighlightColor: 'transparent' }}>
            <i className={`fa-solid ${t.icon}`} style={{ fontSize: 14, color: activeId === t.id ? 'var(--accent)' : UI.inkFaint }} />
            <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.08em', color: activeId === t.id ? 'var(--accent)' : UI.inkFaint, textTransform: 'uppercase' }}>{t.label}</span>
          </button>
        ))}
      </div>
      {views.map(v => (
        <div key={v.id} style={{ flex: 1, overflow: 'hidden', display: activeId === v.id ? 'flex' : 'none', flexDirection: 'column' }}>
          {renderView(v.id, true)}
        </div>
      ))}
    </div>
  );
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
            style={{ width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 4, border: `1px solid ${inviteError ? 'rgba(var(--danger-rgb),0.6)' : UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, outline: 'none' }}
          />
          {inviteError && (
            <div style={{ fontSize: 12, color: 'rgba(var(--danger-rgb),0.85)', fontFamily: UI.fontUi }}>{inviteError}</div>
          )}
          <button
            onClick={handleInvite}
            disabled={inviting || !inviteEmail.trim()}
            style={{ width: '100%', padding: '13px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#0a0805', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 700, cursor: inviting || !inviteEmail.trim() ? 'not-allowed' : 'pointer', opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }}
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
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, cursor: ending === c.id ? 'wait' : 'pointer' }}
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
            const checkinDue = c.status === 'active' && (c.checkinEnabled ?? true) && checkinMap[c.id] === false;
            const weekStart = LB.checkinWeekStart();
            const checkinNew = c.status === 'active' && checkinMap[c.id] === true && (() => {
              try { return localStorage.getItem(`logbook-coach-ci-seen-${c.id}`) !== weekStart; } catch (_) { return false; }
            })();
            return (
              <CoachingTabClientCard
                key={c.id}
                client={c}
                inProgress={inProgress}
                unreadCount={clientUnread}
                checkinDue={checkinDue}
                checkinNew={checkinNew}
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

function CoachingTabClientCard({ client, inProgress, unreadCount, checkinDue, checkinNew, onRequestCheckin, go }) {
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

  const borderColor = inProgress ? 'rgba(var(--accent-rgb),0.4)' : (checkinNew || checkinDue) ? 'rgba(var(--accent-rgb),0.2)' : UI.hair;

  return (
    <div
      onClick={handleCardClick}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${borderColor}`, cursor: isPending ? 'default' : 'pointer', position: 'relative', overflow: 'hidden', opacity: isPending ? 0.75 : 1 }}
    >
      {inProgress && (
        <div style={{ position: 'absolute', inset: 0, background: `rgba(var(--accent-rgb),0.04)`, pointerEvents: 'none' }} />
      )}
      <div style={{ width: 44, height: 44, borderRadius: 22, background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 18, color: UI.inkSoft, fontWeight: 700 }}>{(client.clientName || client.clientEmail || '?')[0].toUpperCase()}</span>
        {inProgress && (
          <div style={{ position: 'absolute', top: 0, right: 0, width: 12, height: 12, borderRadius: 6, background: 'var(--accent)', border: '2px solid var(--bg)', animation: 'pulseDot 1.5s ease-in-out infinite' }} />
        )}
        {checkinNew && !inProgress && (
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, background: 'var(--accent)', border: '2px solid var(--bg)' }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 2 }}>{client.clientName || client.clientEmail}</div>
        {isPending ? (
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.05em' }}>INVITE PENDING</div>
        ) : inProgress ? (
          <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.06em' }}>TRAINING NOW</div>
        ) : checkinNew ? (
          <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.06em' }}>CHECK-IN SUBMITTED</div>
        ) : checkinDue ? (
          <div style={{ fontSize: 11, color: `rgba(var(--accent-rgb),0.7)`, fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.06em' }}>CHECK-IN DUE</div>
        ) : null}
      </div>
      {checkinDue && !isPending && (
        <button
          onClick={handleRequest}
          style={{ background: requested ? `rgba(var(--accent-rgb),0.15)` : 'transparent', border: `0.5px solid ${requested ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, borderRadius: 4, padding: '5px 8px', cursor: requested ? 'default' : 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <i className="fa-solid fa-bell" style={{ fontSize: 10, color: requested ? 'var(--accent)' : UI.inkFaint }} />
          <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.06em', color: requested ? 'var(--accent)' : UI.inkFaint, textTransform: 'uppercase' }}>{requested ? 'Sent' : 'Remind'}</span>
        </button>
      )}
      {checkinNew && !isPending && (
        <div style={{ width: 28, height: 28, borderRadius: 14, background: `rgba(var(--accent-rgb),0.12)`, border: `0.5px solid rgba(var(--accent-rgb),0.35)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i className="fa-solid fa-clipboard-check" style={{ fontSize: 11, color: 'var(--accent)' }} />
        </div>
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

function CheckInCard({ ci, defaultOpen = false, embedded = false, onEdit, onDelete, confirmingDelete = false }) {
  const [open, setOpen] = useStateC(defaultOpen);
  const hasActivity = ci.daysTrained != null || ci.steps != null || ci.cardioMinutes != null || ci.performanceVsLastWeek != null;
  const hasMarkers = ci.hunger != null || ci.sleepQuality != null || ci.lifeStress != null || ci.workStress != null || ci.tiredness != null;

  return (
    <div style={embedded ? { overflow: 'hidden' } : { background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', gap: 12 }}
      >
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>Week of {fmtWeek(ci.weekStart)}</div>
          {ci.weightToday != null && (
            <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, marginTop: 2 }}>
              {ci.weightToday} {UI.unit()}{ci.weightAvgLastWeek != null ? ` · avg ${ci.weightAvgLastWeek} ${UI.unit()}` : ''}
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
                {ci.cardioDistanceM != null && <StatPill label="Distance" value={(() => { try { const u = localStorage.getItem('logbook-cardio-dist-unit') || 'km'; return u === 'mi' ? `${(ci.cardioDistanceM / 1609.344).toFixed(1)} mi` : `${(ci.cardioDistanceM / 1000).toFixed(1)} km`; } catch (_) { return `${(ci.cardioDistanceM / 1000).toFixed(1)} km`; } })()} />}
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
                <StatPill label="Today" value={`${ci.weightToday} ${UI.unit()}`} />
                {ci.weightAvgLastWeek != null && <StatPill label="Last week avg" value={`${ci.weightAvgLastWeek} ${UI.unit()}`} />}
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

          {/* Edit / delete (only in the client/self view, which passes the handlers) */}
          {(onEdit || onDelete) && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: `0.5px solid ${UI.hair}` }}>
              {onDelete && (
                <button onClick={onDelete}
                  style={{ background: confirmingDelete ? 'rgba(var(--danger-rgb),0.12)' : UI.bgRaised, border: `0.5px solid ${confirmingDelete ? 'rgba(var(--danger-rgb),0.5)' : UI.hairStrong}`, borderRadius: 6, padding: '8px 16px', fontSize: 12, color: confirmingDelete ? 'rgba(var(--danger-rgb),0.9)' : UI.inkFaint, fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                  {confirmingDelete ? 'Confirm?' : 'Delete'}
                </button>
              )}
              {onEdit && (
                <button onClick={onEdit}
                  style={{ background: 'rgba(var(--accent-rgb),0.12)', border: '0.5px solid rgba(var(--accent-rgb),0.4)', borderRadius: 6, padding: '8px 18px', fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>Edit</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value }) {
  return (
    <div style={{ background: UI.bgRaised, borderRadius: 6, padding: '7px 10px', border: `0.5px solid ${UI.hair}` }}>
      <div className="num" style={{ fontSize: 15, color: UI.ink, fontWeight: 300 }}>{value}</div>
      <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.07em', marginTop: 1 }}>{label}</div>
    </div>
  );
}

// ─── CheckInForm ──────────────────────────────────────────────────────────────

function CheckInForm({ coachingId, clientId, userId, weekStart, existing, prefill, onSaved }) {
  const REQUIRED_LABELS = {
    weightToday: 'Weight (today)', hunger: 'Hunger', sleepQuality: 'Sleep',
    lifeStress: 'Life Stress', workStress: 'Work Stress', tiredness: 'Tiredness',
  };

  const getDistUnit = () => { try { return localStorage.getItem('logbook-cardio-dist-unit') || 'km'; } catch (_) { return 'km'; } };
  const [distUnit, setDistUnitRaw] = useStateC(getDistUnit);
  const setDistUnit = (u) => { try { localStorage.setItem('logbook-cardio-dist-unit', u); } catch (_) {} setDistUnitRaw(u); };

  const distToM = (val) => { const n = parseFloat(String(val).replace(',', '.')); if (isNaN(n)) return null; return distUnit === 'mi' ? Math.round(n * 1609.344) : Math.round(n * 1000); };
  const mToDisplay = (meters) => { if (meters == null || meters === '') return ''; return distUnit === 'mi' ? (meters / 1609.344).toFixed(2) : (meters / 1000).toFixed(2); };

  const empty = {
    weightToday: '', weightAvgLastWeek: '',
    offPlanNotes: '', hydrationMl: '',
    daysTrained: '', performanceVsLastWeek: null,
    steps: '', cardioMinutes: '', cardioDistanceDisplay: '',
    cardioPaceFeeling: null, cardioEffort: null,
    goalNote: '',
    hunger: null, sleepQuality: null, lifeStress: null, workStress: null, tiredness: null,
    issuesNotes: '', generalNote: '',
  };

  const [form, setForm] = useStateC(() => {
    if (existing) return {
      weightToday: existing.weightToday ?? '',
      weightAvgLastWeek: existing.weightAvgLastWeek ?? '',
      offPlanNotes: existing.offPlanNotes ?? '',
      hydrationMl: existing.hydrationMl ?? '',
      daysTrained: existing.daysTrained ?? '',
      performanceVsLastWeek: existing.performanceVsLastWeek ?? null,
      steps: existing.steps ?? '',
      cardioMinutes: existing.cardioMinutes ?? '',
      cardioDistanceDisplay: existing.cardioDistanceM != null ? mToDisplay(existing.cardioDistanceM) : '',
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
    };
    if (prefill) return {
      ...empty,
      cardioMinutes: prefill.cardioMinutes ?? '',
      cardioDistanceDisplay: prefill.cardioDistanceM != null ? mToDisplay(prefill.cardioDistanceM) : '',
      cardioPaceFeeling: prefill.paceFeeling ?? null,
      cardioEffort: prefill.effort ?? null,
    };
    return empty;
  });

  const [saving, setSaving] = useStateC(false);
  const [error, setError] = useStateC('');

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const num = (v) => v === '' || v == null ? null : Number(v);

  const missing = Object.entries(REQUIRED_LABELS)
    .filter(([k]) => form[k] === '' || form[k] == null)
    .map(([, label]) => label);
  const canSubmit = missing.length === 0;

  const handleSubmit = async () => {
    if (!canSubmit) { setError(`Can't submit — please fill in: ${missing.join(', ')}.`); return; }
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
        cardioDistanceM: form.cardioDistanceDisplay ? distToM(form.cardioDistanceDisplay) : null,
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
      }, userId, weekStart, !!existing);
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none' };
  const SectionHead = ({ label }) => <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10, marginTop: 4 }}>{label}</div>;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 14px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Weight */}
      <div>
        <SectionHead label="WEIGHT *" />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Today ({UI.unit()})</div>
            <input type="number" inputMode="decimal" step="0.1" placeholder="–" value={form.weightToday} onChange={e => set('weightToday', e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Last week avg ({UI.unit()})</div>
            <input type="number" inputMode="decimal" step="0.1" placeholder="–" value={form.weightAvgLastWeek} onChange={e => set('weightAvgLastWeek', e.target.value)} style={inputStyle} />
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
                  style={{ flex: 1, padding: '9px 4px', borderRadius: 6, border: 'none', cursor: 'pointer',
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
          <input type="number" inputMode="numeric" placeholder="–" value={form.steps} onChange={e => set('steps', e.target.value)} style={inputStyle} />
        </div>

        {/* Cardio */}
        {prefill && !existing && (
          <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: UI.fontUi, marginBottom: 10, padding: '6px 10px', background: `rgba(var(--accent-rgb),0.08)`, borderRadius: 6, border: `0.5px solid rgba(var(--accent-rgb),0.2)` }}>
            Prefilled from {prefill.count} cardio log{prefill.count !== 1 ? 's' : ''} this week
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>Cardio (min)</div>
            <input type="number" inputMode="numeric" placeholder="–" value={form.cardioMinutes} onChange={e => set('cardioMinutes', e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>Distance</span>
              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}` }}>
                {['km', 'mi'].map(u => (
                  <button key={u} onClick={() => {
                    const curM = form.cardioDistanceDisplay ? distToM(form.cardioDistanceDisplay) : null;
                    setDistUnit(u);
                    if (curM != null) {
                      const newDisp = u === 'mi' ? (curM / 1609.344).toFixed(2) : (curM / 1000).toFixed(2);
                      set('cardioDistanceDisplay', newDisp);
                    }
                  }} style={{
                    padding: '2px 7px', cursor: 'pointer', border: 'none',
                    background: distUnit === u ? 'var(--accent)' : 'transparent',
                    color: distUnit === u ? UI.bg : UI.inkFaint,
                    fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
                    WebkitTapHighlightColor: 'transparent',
                  }}>{u}</button>
                ))}
              </div>
            </div>
            <input type="number" inputMode="decimal" placeholder="–" value={form.cardioDistanceDisplay} onChange={e => set('cardioDistanceDisplay', e.target.value)} style={inputStyle} />
          </div>
        </div>

        {/* Pace feeling 1–6 */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Pace feeling</span>
            {form.cardioPaceFeeling != null && <span className="num" style={{ fontSize: 11, color: 'var(--accent)' }}>{form.cardioPaceFeeling}/6</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['1','Easy'],['2','Light'],['3','Steady'],['4','Power'],['5','Hard'],['6','Max']].map(([n, lbl]) => (
              <button key={n} onClick={() => set('cardioPaceFeeling', form.cardioPaceFeeling === Number(n) ? null : Number(n))}
                style={{ flex: 1, padding: '7px 2px', borderRadius: 4, border: `0.5px solid ${form.cardioPaceFeeling === Number(n) ? 'var(--accent)' : UI.hairStrong}`,
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

      <Btn onClick={handleSubmit} disabled={saving}>
        {saving ? 'Sending…' : existing ? 'Update Check-in' : 'Submit Check-in'}
      </Btn>
    </div>
  );
}

// ─── ClientCheckInTab ─────────────────────────────────────────────────────────

function ClientCheckInTab({ coachingId, clientId, userId, checkinEnabled = true, store }) {
  const weekStart = LB.checkinWeekStart();
  const [checkins, setCheckins] = useStateC(null);
  const [editTarget, setEditTarget] = useStateC(null); // null = overview | 'new' | a check-in object
  const [confirmDelete, setConfirmDelete] = useStateC(null); // id of check-in awaiting delete confirm
  const [deleting, setDeleting] = useStateC(false);
  const [pastOpen, setPastOpen] = useStateC(false);

  const load = () => LB.loadCheckins(coachingId).then(setCheckins).catch(() => {});
  useEffectC(() => { load(); }, [coachingId]);

  const thisWeek = (checkins || []).find(c => c.weekStart === weekStart);
  const past = (checkins || []).filter(c => c.weekStart !== weekStart);

  const handleDelete = async (ci) => {
    if (confirmDelete !== ci.id) {
      setConfirmDelete(ci.id);
      setTimeout(() => setConfirmDelete(c => c === ci.id ? null : c), 3000);
      return;
    }
    setDeleting(true);
    try { await LB.deleteCheckin(ci.id, userId); await load(); }
    catch (e) {} finally { setDeleting(false); setConfirmDelete(null); }
  };

  if (checkins === null) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.1em' }}>LOADING…</div></div>;
  }

  // ── Form: new check-in or editing any existing one ──
  if (editTarget) {
    const isNew = editTarget === 'new';
    const target = isNew ? null : editTarget;
    const formWeek = isNew ? weekStart : target.weekStart;
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 14px 0', flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
            {isNew
              ? <>Week of <strong>{fmtWeek(formWeek)}</strong> — covers Mon–Sun of last week.</>
              : <>Editing <strong>week of {fmtWeek(formWeek)}</strong> — the change is logged to your coach.</>}
          </div>
          <button onClick={() => setEditTarget(null)} style={{ background: 'transparent', border: 'none', fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, cursor: 'pointer', padding: '4px 0' }}>← Cancel</button>
        </div>
        <CheckInForm
          coachingId={coachingId}
          clientId={clientId}
          userId={userId}
          weekStart={formWeek}
          existing={target}
          prefill={!target ? LB.cardioWeekPrefill(store?.cardioLogs, formWeek) : undefined}
          onSaved={() => { setEditTarget(null); load(); }}
        />
      </div>
    );
  }

  // ── Overview: every check-in is editable/deletable (edit/delete live inside each card) ──
  const recent = [...checkins].reverse();

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ padding: '16px 14px 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!thisWeek && checkinEnabled && (
          <button onClick={() => setEditTarget('new')}
            style={{ background: `rgba(var(--accent-rgb),0.12)`, border: `0.5px solid rgba(var(--accent-rgb),0.4)`, borderRadius: 6, padding: '12px 14px', cursor: 'pointer', color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>
            Submit this week's check-in
          </button>
        )}

        {checkins.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <CheckInTrendCards recent={recent} />
          </div>
        )}
        {checkins.length > 0 && <div className="knurl" style={{ margin: '4px 0' }} />}

        {!checkinEnabled && (
          <div style={{ background: UI.bgInset, borderRadius: 8, padding: '11px 14px', border: `0.5px solid ${UI.hair}` }}>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>Check-ins are currently paused by your coach.</div>
          </div>
        )}
        {thisWeek ? (
          <CheckInCard ci={thisWeek} onEdit={checkinEnabled ? () => setEditTarget(thisWeek) : undefined} onDelete={checkinEnabled ? () => handleDelete(thisWeek) : undefined} confirmingDelete={confirmDelete === thisWeek.id} />
        ) : null}

        {past.length > 0 && (
          <div style={{ background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
            <button
              onClick={() => setPastOpen(o => !o)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', gap: 12 }}
            >
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>Previous Check-ins ({past.length})</div>
                <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, marginTop: 2 }}>
                  {fmtWeek(past[past.length - 1].weekStart)} – {fmtWeek(past[0].weekStart)}
                </div>
              </div>
              <i className={`fa-solid fa-chevron-${pastOpen ? 'up' : 'down'}`} style={{ fontSize: 11, color: UI.inkFaint }} />
            </button>
            {pastOpen && (
              <div style={{ paddingLeft: 16 }}>
                {past.map(ci => (
                  <div key={ci.id} style={{ borderTop: `0.5px solid ${UI.hair}` }}>
                    <CheckInCard ci={ci} embedded onEdit={() => setEditTarget(ci)} onDelete={() => handleDelete(ci)} confirmingDelete={confirmDelete === ci.id} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CheckInRequestModal ──────────────────────────────────────────────────────
// Shown when the coach has requested a weekly check-in and the client hasn't
// dismissed it yet today. Dismisses until midnight via localStorage.

function CheckInRequestModal({ coaching }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const dismissKey = `logbook-checkin-dismiss-${coaching.id}`;

  const [dismissed, setDismissed] = useStateC(() => {
    try { return localStorage.getItem(dismissKey); } catch (_) { return null; }
  });

  const visible = !!coaching.checkinRequestedAt && dismissed !== todayStr;
  if (!visible) return null;

  const handleOk = () => {
    try { localStorage.setItem(dismissKey, todayStr); } catch (_) {}
    setDismissed(todayStr);
  };

  return ReactDOM.createPortal(
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, left: 0,
      zIndex: 9000, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: UI.bg, border: `1px solid ${UI.hairStrong}`,
        borderRadius: 8, padding: 28, maxWidth: 380, width: '100%',
      }}>
        <div className="micro-gold" style={{ marginBottom: 10, letterSpacing: '0.15em' }}>WEEKLY CHECK-IN</div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 26, fontWeight: 700, color: UI.ink, marginBottom: 6 }}>
          {coaching.coachName}
        </div>
        <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 24, lineHeight: 1.5 }}>
          is requesting your weekly check-in. Head to the Check-in tab and fill in your weekly report when you get a chance.
        </div>
        <button
          onClick={handleOk}
          style={{
            width: '100%', padding: 14, background: 'var(--accent)', border: 'none',
            borderRadius: 6, fontSize: 15, fontWeight: 700, color: '#fff',
            fontFamily: UI.fontUi, cursor: 'pointer', letterSpacing: '0.05em',
          }}
        >
          OK
        </button>
      </div>
    </div>,
    document.body
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
      <CheckInRequestModal coaching={coaching} />
      {!hideTopBar && <TopBar title="Coaching" />}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', background: UI.bgInset, borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0 }}>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 6, background: `rgba(var(--accent-rgb),0.15)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ClientCheckInTab coachingId={coaching.id} clientId={userId} userId={userId} checkinEnabled={coaching.checkinEnabled ?? true} />
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
    <div style={{ background: UI.bgInset, borderRadius: 8, padding: '16px 18px', border: `0.5px solid ${UI.hair}` }}>
      <div className="micro-gold" style={{ marginBottom: 12 }}>{label}</div>
      {calories != null && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 14 }}>
          <span className="num" style={{ fontSize: 32, color: UI.ink, fontWeight: 300 }}>{calories}</span>
          <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>kcal</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        {[{ label: 'Protein', value: protein }, { label: 'Carbs', value: carbs }, { label: 'Fat', value: fat }].map(m => (
          <div key={m.label} style={{ flex: 1, background: UI.bgRaised, borderRadius: 6, padding: '10px 8px', textAlign: 'center', border: `0.5px solid ${UI.hair}` }}>
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
