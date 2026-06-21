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

function CoachingTabScreen({ store, setStore, userId, go, initialClientTab }) {
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
    return <CoachingTabClientView store={store} setStore={setStore} userId={userId} go={go} hideTopBar={hideTopBar} initialTab={initialClientTab} />;
  };

  const views = [];
  if (isSelf)   views.push({ id: 'self',    label: 'Myself',     icon: 'fa-chart-line' });
  if (isCoach)  views.push({ id: 'clients', label: 'My Clients', icon: 'fa-users' });
  if (isClient) views.push({ id: 'coach',   label: 'My Coach',   icon: 'fa-person-chalkboard' });

  // No active role → default to the coach view (empty client list + invite).
  if (views.length === 0) return <CoachingTabCoachView store={store} setStore={setStore} userId={userId} go={go} />;
  // Single role → render it directly with its own top bar.
  if (views.length === 1) return renderView(views[0].id, false);
  // Multiple roles → sub-tab bar. If we arrived via a client-facing quick action, start on 'coach' sub-tab.
  const initialView = initialClientTab ? 'coach' : undefined;
  return <CoachingMultiView views={views} renderView={renderView} initialView={initialView} />;
}

// Sub-tab bar shown when a user holds several coaching roles at once
// (e.g. self + real clients). Keeps every view mounted so switching is instant.
function CoachingMultiView({ views, renderView, initialView }) {
  const [active, setActive] = useStateC(initialView && views.some(v => v.id === initialView) ? initialView : views[0].id);
  const activeId = views.some(v => v.id === active) ? active : views[0].id;
  return (
    <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: UI.bg, color: UI.ink }}>
      <TopBar title="Coaching" />
      <SubTabBar tabs={views} active={activeId} onChange={setActive} style={{ paddingBottom: 8 }} />
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
  const [statusMap, setStatusMap] = useStateC({});
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
          const lm = {}, sm = {};
          statusData.forEach(r => { lm[r.clientId] = r.inProgressSessionId; if (r.statusMode) sm[r.clientId] = r.statusMode; });
          setLiveMap(lm);
          setStatusMap(sm);
          const cm = {};
          checkinData.forEach(r => { cm[r.coachingId] = r.checkedInAt; });
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
            const clientStatusMode = statusMap[c.clientId] || null;
            const clientUnread = unreadNotes.filter(n => n.authorId === c.clientId).length;
            const checkinAt = c.id in checkinMap ? checkinMap[c.id] : undefined;
            const checkinDue = c.status === 'active' && (c.checkinEnabled ?? true) && checkinAt === null;
            const checkinNew = c.status === 'active' && typeof checkinAt === 'string' && (() => {
              try { return localStorage.getItem(`logbook-coach-ci-seen-${c.id}`) !== checkinAt; } catch (_) { return false; }
            })();
            return (
              <CoachingTabClientCard
                key={c.id}
                client={c}
                inProgress={inProgress}
                statusMode={clientStatusMode}
                unreadCount={clientUnread}
                checkinDue={checkinDue}
                checkinNew={checkinNew}
                checkinAt={checkinAt}
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

function CoachingTabClientCard({ client, inProgress, statusMode, unreadCount, checkinDue, checkinNew, checkinAt, onRequestCheckin, go }) {
  const isPending = client.status === 'pending';
  const [requested, setRequested] = useStateC(false);
  const [checkinDismissed, setCheckinDismissed] = useStateC(false);

  const handleCardClick = () => {
    if (isPending) return;
    go({ name: 'coaching-client', coachingId: client.id, clientId: client.clientId, clientName: client.clientName, checkinAt, backRoute: 'coaching' });
  };

  const handleRequest = (e) => {
    e.stopPropagation();
    if (requested) return;
    setRequested(true);
    onRequestCheckin();
    setTimeout(() => setRequested(false), 4000);
  };

  const handleDismissCheckin = (e) => {
    e.stopPropagation();
    if (checkinAt) { try { localStorage.setItem(`logbook-coach-ci-seen-${client.id}`, checkinAt); } catch (_) {} }
    setCheckinDismissed(true);
  };

  const showCheckinNew = checkinNew && !checkinDismissed;

  const borderColor = inProgress ? 'rgba(var(--accent-rgb),0.4)' : statusMode ? UI.hairStrong : (showCheckinNew || checkinDue) ? 'rgba(var(--accent-rgb),0.2)' : UI.hair;

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
        {showCheckinNew && !inProgress && (
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, background: 'var(--accent)', border: '2px solid var(--bg)' }} />
        )}
        {statusMode && !inProgress && !showCheckinNew && (
          <div style={{ position: 'absolute', top: 0, right: 0, width: 12, height: 12, borderRadius: 6, background: UI.inkGhost, border: '2px solid var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className={`fa-solid ${statusMode === 'sick' ? 'fa-bed-pulse' : 'fa-umbrella-beach'}`} style={{ fontSize: 5, color: UI.bg }} />
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 2 }}>{client.clientName || client.clientEmail}</div>
        {isPending ? (
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.05em' }}>INVITE PENDING</div>
        ) : inProgress ? (
          <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.06em' }}>TRAINING NOW</div>
        ) : statusMode ? (
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.06em' }}>{statusMode === 'sick' ? 'SICK' : 'VACATION'}</div>
        ) : showCheckinNew ? (
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
      {showCheckinNew && !isPending && (
        <button
          onClick={handleDismissCheckin}
          style={{ background: 'transparent', border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '5px 8px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, WebkitTapHighlightColor: 'transparent' }}
        >
          <i className="fa-solid fa-check" style={{ fontSize: 10, color: UI.inkFaint }} />
          <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.06em', color: UI.inkFaint, textTransform: 'uppercase' }}>Dismiss</span>
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

function CheckInCard({ ci, prevCi, schema, defaultOpen = false, embedded = false, onEdit, onDelete, confirmingDelete = false, coachingMacros = null }) {
  const [open, setOpen] = useStateC(defaultOpen);
  const [exportMode, setExportMode] = useStateC(null); // null | 'pick' | 'exporting'
  const cardRef = useRefC(null);
  const sections = schema || CHECKIN_DEFAULT_SCHEMA;
  const responses = ci.responses || {};
  const has = v => v != null && v !== '';
  const distUnit = (() => { try { return localStorage.getItem('logbook-cardio-dist-unit') || 'km'; } catch (_) { return 'km'; } })();

  // Planned macro avg row — mirrors HealthWeekCard logic.
  // Use days_trained from the check-in as the training-day count for the weighted average.
  const macroResponseKeys = ['calories_avg', 'protein_avg', 'carbs_avg', 'fat_avg'];
  const hasMacroResponse = macroResponseKeys.some(k => has(responses[k]));
  const planTDays = responses.days_trained != null ? (parseInt(responses.days_trained) || 0) : 3;
  const planRDays = 7 - planTDays;
  const planMacro = (tk, rk) => {
    if (!coachingMacros) return null;
    const tv = coachingMacros[tk], rv = coachingMacros[rk];
    if (tv == null && rv == null) return null;
    return Math.round(((tv || 0) * planTDays + (rv || 0) * planRDays) / 7);
  };
  const planCal  = planMacro('caloriesTraining', 'caloriesRest');
  const planProt = planMacro('proteinTraining',  'proteinRest');
  const planCarb = planMacro('carbsTraining',    'carbsRest');
  const planFat  = planMacro('fatTraining',      'fatRest');
  const showPlanRow = hasMacroResponse && (planCal != null || planProt != null || planCarb != null || planFat != null);

  // Format one field's stored value for display (mirrors the trend-card formatter).
  const fmtValue = (f, v) => {
    if (f.unit === 'weight') return `${v} ${UI.unit()}`;
    if (f._distanceField) return distUnit === 'mi' ? `${(v / 1609.344).toFixed(1)} mi` : `${(v / 1000).toFixed(1)} km`;
    if (f.key === 'hydration_ml') return `${(v / 1000).toFixed(1)} L / day`;
    if (f.key === 'steps') return Number(v).toLocaleString();
    if (f.type === 'percent') return `${v}%`;
    if (f.type === 'choice' && f.options?.length) {
      const opt = f.options.find(o => String(o.value) === String(v));
      return opt ? opt.label : String(v);
    }
    if (f.type === 'pace') return String(v);
    if (f.unit) return `${v} ${f.unit}`;
    return String(v);
  };

  // Color a stepper value by where it sits on its scale, respecting direction.
  const stepperColor = (f, v) => {
    const min = f.min ?? 1, max = f.max ?? 10;
    const t = max > min ? (v - min) / (max - min) : 0.5;
    const good = 'var(--accent)', bad = 'rgba(var(--danger-rgb),0.8)';
    if (f.direction === 'lower_better') return t <= 0.25 ? good : t >= 0.65 ? bad : UI.ink;
    if (f.direction === 'higher_better') return t >= 0.65 ? good : t <= 0.25 ? bad : UI.ink;
    return UI.ink;
  };

  const wToday = responses.weight_today, wAvg = responses.weight_avg_last_week;
  // Response keys not in the current schema (e.g. fields the coach later removed)
  // — surfaced in an "Additional" block so submitted data never silently vanishes.
  const schemaKeys = new Set(sections.flatMap(s => (s.fields || []).map(f => f.key)));
  const extraKeys = Object.keys(responses).filter(k => !schemaKeys.has(k) && has(responses[k]));

  const weightDelta = (() => {
    const cur = parseFloat(responses.weight_avg_last_week);
    const prev = parseFloat(prevCi?.responses?.weight_avg_last_week);
    if (isNaN(cur) || isNaN(prev)) return null;
    return Math.round((cur - prev) * 100) / 100;
  })();
  const fmtDelta = d => (d >= 0 ? '+' : '') + d.toFixed(2).replace('.', ',') + ' ' + UI.unit();

  const stepsDelta = (() => {
    const cur = parseFloat(responses.steps), prev = parseFloat(prevCi?.responses?.steps);
    if (isNaN(cur) || isNaN(prev)) return null;
    return Math.round(cur - prev);
  })();
  const cardioMinDelta = (() => {
    const cur = parseFloat(responses.cardio_minutes), prev = parseFloat(prevCi?.responses?.cardio_minutes);
    if (isNaN(cur) || isNaN(prev)) return null;
    return Math.round(cur - prev);
  })();
  const cardioDistDelta = (() => {
    const cur = parseFloat(responses.cardio_distance_m), prev = parseFloat(prevCi?.responses?.cardio_distance_m);
    if (isNaN(cur) || isNaN(prev)) return null;
    return cur - prev;
  })();
  const paceDelta = (() => {
    const parseP = p => { if (!p) return NaN; const [m, s] = String(p).split(':').map(Number); return isNaN(m) || isNaN(s) ? NaN : m * 60 + s; };
    const cur = parseP(responses.cardio_pace), prev = parseP(prevCi?.responses?.cardio_pace);
    if (isNaN(cur) || isNaN(prev)) return null;
    return cur - prev; // negative = faster = better (lower_better)
  })();
  const fmtDistDelta = d => { const v = distUnit === 'mi' ? (d / 1609.344).toFixed(1) : (d / 1000).toFixed(1); return (d > 0 ? '+' : '') + v + ' ' + distUnit; };
  const pillDeltaProps = f => {
    if (f.key === 'weight_avg_last_week') return { delta: weightDelta };
    if (f.key === 'steps') return { delta: stepsDelta, deltaStr: stepsDelta != null ? (stepsDelta > 0 ? '+' : '') + stepsDelta.toLocaleString() : undefined, deltaDir: 'higher_better' };
    if (f.key === 'cardio_minutes') return { delta: cardioMinDelta, deltaStr: cardioMinDelta != null ? (cardioMinDelta > 0 ? '+' : '') + cardioMinDelta + ' min' : undefined, deltaDir: 'higher_better' };
    if (f.key === 'cardio_distance_m') return { delta: cardioDistDelta, deltaStr: cardioDistDelta != null ? fmtDistDelta(cardioDistDelta) : undefined, deltaDir: 'higher_better' };
    if (f.key === 'cardio_pace') return { delta: paceDelta, deltaDir: 'lower_better', arrowOnly: true };
    return {};
  };

  const buildText = () => {
    const fmtTextDelta = key => {
      if (key === 'steps'             && stepsDelta     != null) return ` (${stepsDelta > 0 ? '+' : ''}${stepsDelta.toLocaleString()})`;
      if (key === 'cardio_minutes'    && cardioMinDelta  != null) return ` (${cardioMinDelta > 0 ? '+' : ''}${cardioMinDelta} min)`;
      if (key === 'cardio_distance_m' && cardioDistDelta != null) return ` (${fmtDistDelta(cardioDistDelta)})`;
      if (key === 'cardio_pace'       && paceDelta       != null) return ` (${paceDelta === 0 ? '→' : paceDelta < 0 ? '↑ faster' : '↓ slower'})`;
      return '';
    };
    const lines = [`Week of ${fmtWeek(ci.weekStart)}`];
    sections.forEach(section => {
      const fields = (section.fields || []).filter(f => has(responses[f.key]));
      if (!fields.length) return;
      const headLabel = section.label.toUpperCase() + (section.sectionHint ? ` (${section.sectionHint})` : '');
      lines.push('', headLabel);
      fields.forEach(f => {
        const v = responses[f.key];
        if (f.type === 'stepper') lines.push(`${f.label}: ${v}/${f.max ?? 10}`);
        else if (f.type === 'text') lines.push('', `${f.label.toUpperCase()}`, String(v));
        else {
          const base = `${f.label}: ${fmtValue(f, v)}`;
          const delta = f.key === 'weight_avg_last_week' && weightDelta != null
            ? ` (${fmtDelta(weightDelta)} to previous week)`
            : fmtTextDelta(f.key);
          lines.push(base + delta);
        }
      });
    });
    if (extraKeys.length) {
      lines.push('', 'ADDITIONAL');
      extraKeys.forEach(k => lines.push(`${k.replace(/_/g, ' ')}: ${responses[k]}`));
    }
    return lines.join('\n');
  };

  const doExportText = async () => {
    const text = buildText();
    if (navigator.share) { try { await navigator.share({ text }); } catch (_) {} }
    else { try { await navigator.clipboard.writeText(text); } catch (_) {} }
    setExportMode(null);
  };

  const doExportImage = async () => {
    if (!cardRef.current) return;
    setExportMode('exporting');
    const html2canvas = await window.__ensureHtml2Canvas?.().catch(() => null);
    if (!html2canvas) { setExportMode(null); return; }
    try {
      const el = cardRef.current;
      const canvas = await html2canvas(el, {
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0f0e0b',
        scale: 2, useCORS: true, logging: false,
        height: el.scrollHeight, windowHeight: el.scrollHeight,
      });
      canvas.toBlob(async (blob) => {
        const filename = `checkin-${ci.weekStart}.png`;
        const file = new File([blob], filename, { type: 'image/png' });
        if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && navigator.share && navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file] }); } catch (_) {}
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename; document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }, 'image/png');
    } finally { setExportMode(null); }
  };

  return (
    <div ref={cardRef} style={embedded ? { overflow: 'hidden' } : { background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', gap: 12 }}
      >
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>Week of {fmtWeek(ci.weekStart)}</div>
          {has(wToday) && (
            <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, marginTop: 2 }}>
              {wToday} {UI.unit()}{has(wAvg) ? ` · avg ${wAvg} ${UI.unit()}` : ''}
            </div>
          )}
        </div>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: 11, color: UI.inkFaint }} />
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Schema-driven sections, rendered in schema order. Consecutive
              number/choice fields share a pill row; consecutive steppers stack
              as rows; text fields are their own block. Order always matches the
              form so the coach sees fields where they put them. */}
          {sections.map(section => {
            const fields = (section.fields || []).filter(f => has(responses[f.key]));
            if (!fields.length) return null;
            const headLabel = section.label.toUpperCase() + (section.sectionHint ? ` (${section.sectionHint})` : '');
            const kindOf = f => f.type === 'stepper' ? 'stepper' : f.type === 'text' ? 'text' : 'pill';
            const blocks = [];
            let run = [], runKind = null;
            const flush = () => {
              if (!run.length) return;
              const items = run; run = []; const kind = runKind; runKind = null;
              if (kind === 'pill') {
                blocks.push(
                  <div key={`p-${items[0].key}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                    {items.map(f => <StatPill key={f.key} label={f.label} value={fmtValue(f, responses[f.key])} {...pillDeltaProps(f)} />)}
                  </div>
                );
              } else {
                blocks.push(
                  <div key={`s-${items[0].key}`}>
                    {items.map(f => (
                      <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `0.5px solid ${UI.hair}` }}>
                        <span style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>{f.label}</span>
                        <span className="num" style={{ fontSize: 12, color: stepperColor(f, responses[f.key]) }}>{responses[f.key]}/{f.max ?? 10}</span>
                      </div>
                    ))}
                  </div>
                );
              }
            };
            fields.forEach(f => {
              const kind = kindOf(f);
              if (kind === 'text') {
                flush();
                blocks.push(
                  <div key={`t-${f.key}`}>
                    <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>{f.label.toUpperCase()}</div>
                    <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{responses[f.key]}</div>
                  </div>
                );
                return;
              }
              if (runKind && runKind !== kind) flush();
              runKind = kind;
              run.push(f);
            });
            flush();
            return (
              <div key={section.id}>
                <div className="knurl" style={{ margin: '0 0 6px' }} />
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>{headLabel}</div>
                <div className="knurl" style={{ margin: '0 0 10px' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{blocks}</div>
              </div>
            );
          })}

          {/* Planned macro avg row — shown when coaching macros exist and macro fields were reported */}
          {showPlanRow && (
            <div>
              <div className="knurl" style={{ margin: '0 0 6px' }} />
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>PLANNED AVG</div>
              <div className="knurl" style={{ margin: '0 0 8px' }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0 6px' }}>
                {[{v: planCal, u: 'kcal'}, {v: planProt, u: 'g'}, {v: planCarb, u: 'g'}, {v: planFat, u: 'g'}].map(({v, u}, i) => (
                  <div key={i} style={{ textAlign: 'center' }}>
                    <div className="num" style={{ fontSize: 13, color: v != null ? UI.inkGhost : UI.inkGhost, fontWeight: 300 }}>
                      {v != null ? v : '—'}<span style={{ fontSize: 9, color: UI.inkGhost }}>{u}</span>
                    </div>
                    <div style={{ fontSize: 8, color: UI.inkGhost, fontFamily: UI.fontUi, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 1 }}>
                      {['Cal', 'Protein', 'Carbs', 'Fat'][i]}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Submitted fields no longer in the schema — kept visible, never dropped */}
          {extraKeys.length > 0 && (
            <div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>ADDITIONAL</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {extraKeys.map(k => <StatPill key={k} label={k.replace(/_/g, ' ')} value={String(responses[k])} />)}
              </div>
            </div>
          )}

          {/* Actions row — export always visible, edit/delete when handlers are present */}
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
            {exportMode === 'pick' ? (
              <>
                <button onClick={() => setExportMode(null)}
                  style={{ background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '8px 14px', fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>Cancel</button>
                <button onClick={doExportText}
                  style={{ background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '8px 14px', fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>Text</button>
                <button onClick={doExportImage}
                  style={{ background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '8px 14px', fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>Image</button>
              </>
            ) : (
              <button onClick={() => setExportMode('pick')} disabled={exportMode === 'exporting'}
                style={{ background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '8px 14px', fontSize: 12, color: exportMode === 'exporting' ? UI.inkFaint : UI.ink, fontFamily: UI.fontUi, cursor: exportMode === 'exporting' ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                {exportMode === 'exporting' ? '…' : <i className="fa-solid fa-share-from-square" />}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, delta, deltaStr, deltaDir, arrowOnly }) {
  const deltaColor = (() => {
    if (delta == null || !deltaDir) return UI.inkSoft;
    const good = deltaDir === 'higher_better' ? delta > 0 : delta < 0;
    const bad  = deltaDir === 'higher_better' ? delta < 0 : delta > 0;
    if (good) return 'var(--accent)';
    if (bad)  return 'rgba(var(--danger-rgb),0.8)';
    return UI.inkSoft;
  })();
  const arrow = delta == null ? null : delta === 0 ? '→' : (deltaDir === 'lower_better' ? (delta < 0 ? '↑' : '↓') : (delta > 0 ? '↑' : '↓'));
  return (
    <div style={{ background: UI.bgRaised, borderRadius: 6, padding: '7px 10px', border: `0.5px solid ${UI.hair}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <div className="num" style={{ fontSize: 15, color: UI.ink, fontWeight: 300 }}>{value}</div>
        {delta != null && arrowOnly && <div style={{ fontSize: 11, color: deltaColor }}>{arrow}</div>}
        {delta != null && !arrowOnly && (
          <div className="num" style={{ fontSize: 10, color: deltaColor }}>
            {deltaStr ?? ((delta >= 0 ? '+' : '') + delta.toFixed(2).replace('.', ','))}
          </div>
        )}
      </div>
      <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.07em', marginTop: 1 }}>{label}</div>
    </div>
  );
}

// ─── Check-in form helpers ────────────────────────────────────────────────────

// Group adjacent half-width fields into two-column rows.
function layoutRows(fields) {
  const rows = [];
  let i = 0;
  while (i < fields.length) {
    const f = fields[i];
    if (f.width === 'half' && i + 1 < fields.length && fields[i + 1].width === 'half') {
      rows.push([f, fields[i + 1]]);
      i += 2;
    } else {
      rows.push([f]);
      i++;
    }
  }
  return rows;
}

// Convert a raw form value to a submission-ready response value.
function toResponse(field, raw, distUnit) {
  if (raw === '' || raw == null) return null;
  if (field._distanceField) {
    const n = parseFloat(String(raw).replace(',', '.'));
    if (isNaN(n) || n <= 0) return null;
    return distUnit === 'mi' ? Math.round(n * 1609.344) : Math.round(n * 1000);
  }
  if (field.type === 'integer' || field.type === 'percent') { const n = parseInt(raw, 10); return isNaN(n) ? null : n; }
  if (field.type === 'decimal') { const n = parseFloat(String(raw).replace(',', '.')); return isNaN(n) ? null : n; }
  return raw; // text, stepper, choice
}

// Build initial form state from existing responses + schema.
function initFormState(sections, responses, distUnit) {
  const form = {};
  (sections || []).forEach(sec => (sec.fields || []).forEach(field => {
    const v = responses?.[field.key];
    if (field._distanceField) {
      form[field.key] = v != null ? (distUnit === 'mi' ? (v / 1609.344).toFixed(2) : (v / 1000).toFixed(2)) : '';
    } else if (field.type === 'text') {
      form[field.key] = v != null ? String(v) : '';
    } else if (field.type === 'stepper' || field.type === 'choice') {
      form[field.key] = v != null ? v : null;
    } else {
      form[field.key] = v != null ? String(v) : '';
    }
  }));
  return form;
}

// ─── FieldWidget ──────────────────────────────────────────────────────────────
// Renders the inner content (label + input) for a single form field.
// The row-layout wrapper provides the outer container / flex column.

function FieldWidget({ field, value, onChange, distUnit, setDistUnit, inputStyle }) {
  const req = field.required ? ' *' : '';
  const lbl = (field.unit === 'weight'
    ? `${field.label} (${UI.unit()})`
    : field.unit === 'pace'
      ? `${field.label} (min${UI.unit() === 'lbs' ? '/mi' : '/km'})`
      : field.unit ? `${field.label} (${field.unit})` : field.label) + req;

  // Read-only / computed fields (e.g. macro adherence %). Value is prefilled
  // from the daily logs and shown, not entered.
  if (field.type === 'percent' || field.readOnly) {
    const has = value != null && value !== '';
    return (
      <>
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>{lbl}</div>
        <div style={{ ...inputStyle, background: UI.bgRaised, border: `0.5px solid ${UI.hair}`, color: has ? 'var(--accent)' : UI.inkGhost, fontFamily: UI.fontNum, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{has ? value : '—'}{has && field.type === 'percent' ? '%' : ''}</span>
          <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.06em' }}>FROM LOGS</span>
        </div>
      </>
    );
  }

  if (field.type === 'text') {
    return (
      <>
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>{lbl}</div>
        <textarea placeholder="–" value={value || ''} onChange={e => onChange(e.target.value)}
          rows={field.rows || 2} style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }} />
      </>
    );
  }

  if (field._distanceField) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{field.label + req}</span>
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}` }}>
            {['km', 'mi'].map(u => (
              <button key={u} onClick={() => {
                const n = parseFloat(String(value || '').replace(',', '.'));
                setDistUnit(u);
                if (!isNaN(n) && n > 0) {
                  const m = distUnit === 'mi' ? Math.round(n * 1609.344) : Math.round(n * 1000);
                  onChange(u === 'mi' ? (m / 1609.344).toFixed(2) : (m / 1000).toFixed(2));
                }
              }} style={{ padding: '2px 7px', cursor: 'pointer', border: 'none',
                background: distUnit === u ? 'var(--accent)' : 'transparent',
                color: distUnit === u ? UI.bg : UI.inkFaint,
                fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
                WebkitTapHighlightColor: 'transparent' }}>
              {u}
              </button>
            ))}
          </div>
        </div>
        <input type="number" inputMode="decimal" placeholder="–" value={value || ''} onChange={e => onChange(e.target.value)} style={inputStyle} />
      </>
    );
  }

  if (field.type === 'pace') {
    const raw = value || '';
    const colon = raw.indexOf(':');
    const mins = colon >= 0 ? raw.slice(0, colon) : raw;
    const secs = colon >= 0 ? raw.slice(colon + 1) : '';
    const combine = (m, s) => {
      const mm = m.replace(/\D/g, '').slice(0, 2);
      const ss = s.replace(/\D/g, '').slice(0, 2);
      if (!mm && !ss) { onChange(''); return; }
      onChange(`${mm || '0'}:${(ss || '0').padStart(2, '0')}`);
    };
    return (
      <>
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>{lbl}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="number" inputMode="numeric" min="0" max="99" placeholder="mm"
            value={mins} onChange={e => combine(e.target.value, secs)}
            style={{ ...inputStyle, textAlign: 'center', flex: 1 }} />
          <span style={{ color: UI.inkFaint, fontFamily: UI.fontNum, fontSize: 18, lineHeight: 1, flexShrink: 0 }}>:</span>
          <input type="number" inputMode="numeric" min="0" max="59" placeholder="ss"
            value={secs} onChange={e => combine(mins, e.target.value)}
            style={{ ...inputStyle, textAlign: 'center', flex: 1 }} />
        </div>
      </>
    );
  }

  if (field.type === 'integer' || field.type === 'decimal') {
    return (
      <>
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>{lbl}</div>
        <input type="number" inputMode={field.type === 'decimal' ? 'decimal' : 'numeric'}
          step={field.type === 'decimal' ? '0.1' : '1'} placeholder="–"
          value={value || ''} onChange={e => onChange(e.target.value)} style={inputStyle} />
      </>
    );
  }

  if (field.type === 'stepper') {
    const min = field.min || 1, max = field.max || 10;
    const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    const stepLabel = field.hint ? `${lbl} (${field.hint})` : lbl;
    const dir = field.direction;
    const btnColor = (n) => {
      if (value === n) return '#0a0805';
      if (dir === 'lower_better') return n <= min + Math.floor((max - min) * 0.3) ? 'var(--accent)' : n >= min + Math.ceil((max - min) * 0.7) ? 'rgba(var(--danger-rgb),0.7)' : UI.inkSoft;
      if (dir === 'higher_better') return n >= min + Math.ceil((max - min) * 0.7) ? 'var(--accent)' : n <= min + Math.floor((max - min) * 0.3) ? 'rgba(var(--danger-rgb),0.7)' : UI.inkSoft;
      return n <= min + Math.floor((max - min) * 0.3) ? 'var(--accent)' : n <= min + Math.floor((max - min) * 0.6) ? UI.inkSoft : UI.inkFaint;
    };
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>{stepLabel}</span>
          {value != null && <span className="num" style={{ fontSize: 11, color: 'var(--accent)' }}>{value}/{max}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {nums.map(n => (
            <button key={n} onClick={() => onChange(value === n ? null : n)}
              style={{ flex: 1, padding: '8px 0', borderRadius: 5, border: 'none', cursor: 'pointer',
                background: value === n ? 'var(--accent)' : value != null && n <= value ? `rgba(var(--accent-rgb),0.18)` : UI.bgInset,
                color: btnColor(n),
                fontSize: 10, fontFamily: UI.fontUi, fontWeight: value === n ? 700 : 400, transition: 'background 0.1s' }}>
              {n}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === 'choice') {
    const { options = [], labeled } = field;
    if (labeled) {
      return (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{lbl}</span>
            {value != null && <span className="num" style={{ fontSize: 11, color: 'var(--accent)' }}>{value}/{options.length}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {options.map(opt => (
              <button key={opt.value} onClick={() => onChange(value === opt.value ? null : opt.value)}
                style={{ flex: 1, padding: '7px 2px', borderRadius: 4, cursor: 'pointer',
                  border: `0.5px solid ${value === opt.value ? 'var(--accent)' : UI.hairStrong}`,
                  background: value === opt.value ? `rgba(var(--accent-rgb),0.18)` : UI.bgInset,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span className="num" style={{ fontSize: 13, color: value === opt.value ? 'var(--accent)' : UI.inkSoft }}>{opt.value}</span>
                <span style={{ fontSize: 8, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.04em' }}>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <>
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>{lbl}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {options.map(opt => {
            const sel = value === opt.value;
            const bg = sel ? opt.color === 'accent' ? `rgba(var(--accent-rgb),0.2)` : opt.color === 'danger' ? `rgba(var(--danger-rgb),0.15)` : UI.bgRaised : UI.bgInset;
            const fg = sel ? opt.color === 'accent' ? 'var(--accent)' : opt.color === 'danger' ? 'rgba(var(--danger-rgb),0.85)' : UI.ink : UI.inkFaint;
            return (
              <button key={opt.value} onClick={() => onChange(sel ? null : opt.value)}
                style={{ flex: 1, padding: '9px 4px', borderRadius: 6, cursor: 'pointer', background: bg, color: fg,
                  fontFamily: UI.fontUi, fontSize: 10, fontWeight: sel ? 700 : 400, letterSpacing: '0.04em',
                  border: `0.5px solid ${sel ? 'currentColor' : UI.hairStrong}` }}>
                {opt.label}
              </button>
            );
          })}
        </div>
      </>
    );
  }

  return null;
}

// ─── CheckInForm ──────────────────────────────────────────────────────────────

function CheckInForm({ coachingId, clientId, userId, weekStart, existing, prefill, dailyPrefill, onSaved, schema }) {
  const sections = schema || CHECKIN_DEFAULT_SCHEMA;
  const allFields = sections.flatMap(s => s.fields || []);

  const getDistUnit = () => { try { return localStorage.getItem('logbook-cardio-dist-unit') || 'km'; } catch (_) { return 'km'; } };
  const [distUnit, setDistUnitRaw] = useStateC(getDistUnit);
  const setDistUnit = u => { try { localStorage.setItem('logbook-cardio-dist-unit', u); } catch (_) {} setDistUnitRaw(u); };

  const [form, setForm] = useStateC(() => {
    const du = getDistUnit();
    if (existing) return initFormState(sections, existing.responses || {}, du);
    const base = initFormState(sections, {}, du);
    if (prefill) {
      if (prefill.cardioMinutes != null) base.cardio_minutes = String(prefill.cardioMinutes);
      if (prefill.cardioDistanceM != null) base.cardio_distance_m = du === 'mi' ? (prefill.cardioDistanceM / 1609.344).toFixed(2) : (prefill.cardioDistanceM / 1000).toFixed(2);
      if (prefill.pace != null) base.cardio_pace = prefill.pace;
      if (prefill.paceFeeling != null) base.cardio_pace_feeling = prefill.paceFeeling;
      if (prefill.effort != null) base.cardio_effort = prefill.effort;
    }
    // Daily-log prefill: keys map 1:1 to form field keys (weight_today, steps,
    // protein_avg, macro_adherence, …). Only apply keys the schema actually has.
    if (dailyPrefill) {
      allFields.forEach(f => { if (dailyPrefill[f.key] != null) base[f.key] = String(dailyPrefill[f.key]); });
    }
    return base;
  });

  const [saving, setSaving] = useStateC(false);
  const [error, setError] = useStateC('');

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const missing = allFields.filter(f => f.required).filter(f => { const v = form[f.key]; return v === '' || v == null; }).map(f => f.label);
  const canSubmit = missing.length === 0;

  const handleSubmit = async () => {
    if (!canSubmit) { setError(`Can't submit — please fill in: ${missing.join(', ')}.`); return; }
    setSaving(true); setError('');
    try {
      const responses = {};
      allFields.forEach(field => {
        const val = toResponse(field, form[field.key], distUnit);
        if (val != null) responses[field.key] = val;
      });
      await LB.submitCheckin(coachingId, clientId, responses, userId, weekStart, !!existing, sections);
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none' };

  const renderRow = (row, key) => {
    if (row.length === 1) {
      const f = row[0];
      return <div key={f.key}><FieldWidget field={f} value={form[f.key]} onChange={v => set(f.key, v)} distUnit={distUnit} setDistUnit={setDistUnit} inputStyle={inputStyle} /></div>;
    }
    return (
      <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        {row.map(f => (
          <div key={f.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <FieldWidget field={f} value={form[f.key]} onChange={v => set(f.key, v)} distUnit={distUnit} setDistUnit={setDistUnit} inputStyle={inputStyle} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 14px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {(prefill || dailyPrefill) && !existing && (
        <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: UI.fontUi, padding: '6px 10px', background: `rgba(var(--accent-rgb),0.08)`, borderRadius: 6, border: `0.5px solid rgba(var(--accent-rgb),0.2)` }}>
          {dailyPrefill
            ? `Prefilled from your daily logs${prefill ? ' & cardio' : ''} this week — review before submitting`
            : `Cardio prefilled from ${prefill.count} log${prefill.count !== 1 ? 's' : ''} this week`}
        </div>
      )}
      {sections.map(section => {
        const rows = layoutRows(section.fields || []);
        if (!rows.length) return null;
        const headLabel = section.label.toUpperCase() + (section.sectionHint ? ` (${section.sectionHint})` : '');
        return (
          <div key={section.id}>
            <div className="knurl" style={{ margin: '0 0 6px' }} />
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>{headLabel}</div>
            <div className="knurl" style={{ margin: '0 0 10px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {rows.map((row, ri) => renderRow(row, ri))}
            </div>
          </div>
        );
      })}
      {error && <div style={{ fontSize: 12, color: 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>{error}</div>}
      <Btn onClick={handleSubmit} disabled={saving}>
        {saving ? 'Sending…' : existing ? 'Update Check-in' : 'Submit Check-in'}
      </Btn>
    </div>
  );
}

// ─── ClientCheckInTab ─────────────────────────────────────────────────────────

function ClientCheckInTab({ coachingId, clientId, userId, checkinEnabled = true, store, isSelf = false }) {
  const weekStart = LB.checkinWeekStart();
  // Check-ins cover Mon–Sun. On Sunday the current week isn't over yet — only
  // allow submission from Monday onwards (day 1; Sunday = 0 in JS getDay()).
  const canSubmitToday = new Date().getDay() !== 0;
  // Monday of the current training week (what's accumulating right now for the upcoming check-in)
  const previewWeekStart = (() => {
    const t = new Date(); const d = t.getDay();
    const m = new Date(t); m.setDate(t.getDate() - (d === 0 ? 6 : d - 1));
    return m.toISOString().slice(0, 10);
  })();
  const [checkins, setCheckins] = useStateC(null);
  const [schema, setSchema] = useStateC(null); // null = loading, then resolved or CHECKIN_DEFAULT_SCHEMA
  const [editTarget, setEditTarget] = useStateC(null); // null = overview | 'new' | a check-in object
  const [confirmDelete, setConfirmDelete] = useStateC(null); // id of check-in awaiting delete confirm
  const [deleting, setDeleting] = useStateC(false);
  const [pastOpen, setPastOpen] = useStateC(false);
  const [builderOpen, setBuilderOpen] = useStateC(false);
  const [previewOpen, setPreviewOpen] = useStateC(false);
  const [coachingMacros, setCoachingMacros] = useStateC(null);

  const load = () => LB.loadCheckins(coachingId).then(setCheckins).catch(() => {});
  useEffectC(() => {
    load();
    LB.loadCheckinSchema(coachingId).then(s => setSchema(s)).catch(() => {});
    LB.loadCoachingMacros(coachingId).then(data => setCoachingMacros(data[0] || null)).catch(() => {});
  }, [coachingId]);

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

  const resolvedSchema = schema || store?.settings?.defaultCheckinSchema || CHECKIN_DEFAULT_SCHEMA;

  // Preview: build a fake check-in from the current training week's accumulated data
  const previewDailyPrefill = LB.dailyLogsWeekPrefill(store?.dailyLogs, previewWeekStart, store?.sessions, resolvedSchema);
  const previewCardioPrefill = LB.cardioWeekPrefill(store?.cardioLogs, previewWeekStart, store?.settings?.unit);
  const previewResponses = (() => {
    const r = {};
    if (previewDailyPrefill) Object.entries(previewDailyPrefill).forEach(([k, v]) => { if (v != null && k !== 'count') r[k] = v; });
    if (previewCardioPrefill) {
      if (previewCardioPrefill.cardioMinutes != null) r.cardio_minutes = previewCardioPrefill.cardioMinutes;
      if (previewCardioPrefill.cardioDistanceM != null) r.cardio_distance_m = previewCardioPrefill.cardioDistanceM;
      if (previewCardioPrefill.paceFeeling != null) r.cardio_pace_feeling = previewCardioPrefill.paceFeeling;
      if (previewCardioPrefill.effort != null) r.cardio_effort = previewCardioPrefill.effort;
      if (previewCardioPrefill.pace != null) r.cardio_pace = previewCardioPrefill.pace;
    }
    const perf = LB.weekPerformanceSignal(store, previewWeekStart);
    if (perf != null) r.performance_vs_last_week = perf;
    return Object.keys(r).length ? r : null;
  })();

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
          prefill={!target ? LB.cardioWeekPrefill(store?.cardioLogs, formWeek, store?.settings?.unit) : undefined}
          dailyPrefill={!target ? LB.dailyLogsWeekPrefill(store?.dailyLogs, formWeek, store?.sessions, resolvedSchema) : undefined}
          onSaved={() => { setEditTarget(null); load(); }}
          schema={resolvedSchema}
        />
      </div>
    );
  }

  // ── Overview: every check-in is editable/deletable (edit/delete live inside each card) ──
  const recent = [...checkins].reverse();

  return (
    <>
      {builderOpen && isSelf && (
        <CheckInSchemaBuilder coachingId={coachingId} initial={resolvedSchema}
          onSave={s => { setSchema(s); setBuilderOpen(false); }}
          onClose={() => setBuilderOpen(false)} />
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ padding: '16px 14px 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!thisWeek && checkinEnabled && canSubmitToday && (
            <button onClick={() => setEditTarget('new')}
              style={{ flex: 1, background: `rgba(var(--accent-rgb),0.12)`, border: `0.5px solid rgba(var(--accent-rgb),0.4)`, borderRadius: 6, padding: '12px 14px', cursor: 'pointer', color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>
              Submit this week's check-in
            </button>
          )}
          {!thisWeek && checkinEnabled && !canSubmitToday && previewResponses && (
            <button onClick={() => setPreviewOpen(v => !v)}
              style={{ flex: 1, background: previewOpen ? `rgba(var(--accent-rgb),0.1)` : `rgba(var(--accent-rgb),0.05)`, border: `0.5px solid rgba(var(--accent-rgb),0.25)`, borderRadius: 6, padding: '12px 14px', cursor: 'pointer', color: previewOpen ? 'var(--accent)' : UI.inkSoft, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>
              {previewOpen ? 'Close preview' : 'Preview this week'}
            </button>
          )}
          {previewResponses && canSubmitToday && new Date().getDay() !== 1 && (
            <button onClick={() => setPreviewOpen(v => !v)}
              style={{ background: previewOpen ? `rgba(var(--accent-rgb),0.12)` : UI.bgInset, border: `0.5px solid ${previewOpen ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, borderRadius: 6, padding: '11px 13px', cursor: 'pointer', color: previewOpen ? 'var(--accent)' : UI.inkFaint, fontSize: 15, lineHeight: 1, flexShrink: 0 }}>
              <i className="fa-solid fa-eye" />
            </button>
          )}
          {isSelf && (
            <button onClick={() => setBuilderOpen(true)}
              style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '11px 13px', cursor: 'pointer', color: UI.inkFaint, fontSize: 15, lineHeight: 1, flexShrink: 0 }}>
              <i className="fa-solid fa-sliders" />
            </button>
          )}
        </div>

        {previewOpen && previewResponses && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.07em', textTransform: 'uppercase' }}>In progress — data still accumulating</span>
            </div>
            <CheckInCard
              ci={{ weekStart: previewWeekStart, responses: previewResponses }}
              prevCi={checkins[0]}
              schema={resolvedSchema}
              defaultOpen={true}
              embedded={true}
              coachingMacros={coachingMacros}
            />
          </div>
        )}

        {checkins.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <CheckInTrendCards recent={recent} schema={resolvedSchema} />
          </div>
        )}
        {checkins.length > 0 && <div className="knurl" style={{ margin: '4px 0' }} />}

        {!checkinEnabled && (
          <div style={{ background: UI.bgInset, borderRadius: 8, padding: '11px 14px', border: `0.5px solid ${UI.hair}` }}>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>Check-ins are currently paused by your coach.</div>
          </div>
        )}
        {thisWeek ? (
          <CheckInCard ci={thisWeek} prevCi={past[0]} schema={resolvedSchema} onEdit={checkinEnabled ? () => setEditTarget(thisWeek) : undefined} onDelete={checkinEnabled ? () => handleDelete(thisWeek) : undefined} confirmingDelete={confirmDelete === thisWeek.id} coachingMacros={coachingMacros} />
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
                    <CheckInCard ci={ci} prevCi={past[past.indexOf(ci) + 1]} schema={resolvedSchema} embedded onEdit={() => setEditTarget(ci)} onDelete={() => handleDelete(ci)} confirmingDelete={confirmDelete === ci.id} coachingMacros={coachingMacros} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
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

function CoachingTabClientView({ store, setStore, userId, go, hideTopBar = false, initialTab }) {
  const coaching = store.coaching?.asClient;
  const [tab, setTab] = useStateC(initialTab || 'messages');
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
          <ClientCheckInTab coachingId={coaching.id} clientId={userId} userId={userId} checkinEnabled={coaching.checkinEnabled ?? true} store={store} />
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
