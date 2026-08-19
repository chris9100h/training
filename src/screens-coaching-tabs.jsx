/* Coaching screens, tab router, coach/client tab views, check-in forms,
   and the window.Screens registration. Shares globals with
   screens-coaching-core.jsx (loaded first). */

function CoachingBannerGroup({ store, setStore, userId, go }) {
  const [notesOpen, setNotesOpen] = useStateC(false);
  const notes = LB.unreadCoachingNotes(store);

  const clientIds = new Set((store.coaching?.asCoach || []).filter(c => !c.id?.startsWith('support_')).map(c => c.clientId));
  const fromClient = LB.isNoteFromClient(store, notes);
  const adminSupportUnread = store.adminSupportUnread || 0;
  const userSupportUnread  = store.supportUnread || 0;
  const hasSupportBanner   = adminSupportUnread > 0 || userSupportUnread > 0;

  // Keep mounted while sheet is open so ChatThread isn't destroyed mid-read
  if (!notes.length && !notesOpen && !hasSupportBanner) return null;

  const handleOpen = () => {
    if (fromClient && go) {
      const note = notes.find(n => clientIds.has(n.authorId));
      const client = note && (store.coaching?.asCoach || []).find(c => c.clientId === note.authorId && !c.id?.startsWith('support_'));
      if (client) {
        go({ name: 'coaching-client', coachingId: client.id, clientId: client.clientId, clientName: client.clientName, initialTab: 'notes' });
        return;
      }
      go({ name: 'settings' });
    } else {
      setNotesOpen(true);
    }
  };

  const renderSupportBanner = (count, onClick, label) => (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
      background: 'rgba(var(--accent-rgb),0.12)', border: 'none', borderRadius: 6,
      padding: '10px 14px', cursor: 'pointer', marginBottom: notes.length > 0 ? 8 : 0,
    }}>
      <i className="fa-solid fa-headset" style={{ color: 'var(--accent)', fontSize: 14 }} />
      <span style={{ flex: 1, textAlign: 'left', fontSize: 13, color: UI.ink }}>{label}</span>
      <span style={{
        background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 999,
        fontSize: 11, fontWeight: 700, minWidth: 18, height: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
      }}>{count}</span>
    </button>
  );

  return (
    <div style={{ flexShrink: 0, padding: (notes.length > 0 || hasSupportBanner) ? '10px 22px 10px' : 0 }}>
      {adminSupportUnread > 0 && renderSupportBanner(
        adminSupportUnread,
        () => go?.({ name: 'settings', openSupportInbox: true }),
        `${adminSupportUnread} new support ${adminSupportUnread === 1 ? 'message' : 'messages'}`,
      )}
      {userSupportUnread > 0 && renderSupportBanner(
        userSupportUnread,
        () => go?.({ name: 'settings', openSupportSheet: true }),
        `Support replied to your ${userSupportUnread === 1 ? 'ticket' : 'tickets'}`,
      )}
      {notes.length > 0 && (
        <CoachingUnreadBanner store={store} setStore={setStore} userId={userId} onOpen={handleOpen} />
      )}
      <CoachingNotesSheet open={notesOpen} store={store} setStore={setStore} userId={userId} onClose={() => setNotesOpen(false)} />
    </div>
  );
}

// ─── CoachingTabScreen ────────────────────────────────────────────────────────
// Root screen for the coaching tab, routes to coach or client view.
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
  // A self-coach can invite real clients too, but the invite lives in the
  // clients view. Gating that view on isCoach (>=1 active client) created a
  // catch-22: no invite button until you already had a client. Show the clients
  // view for self-coaches as well so the invite is reachable from the start.
  if (isCoach || isSelf) views.push({ id: 'clients', label: 'My Clients', icon: 'fa-users' });
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

// ─── Coach review queue ──────────────────────────────────────────────────────
// This stays inside My Clients rather than becoming another coaching role.
// Check-in notifications already use a device-local seen marker; the queue
// adds a small local dismissal map for due items so it remains useful without
// introducing a new table before we know how coaches use it.
const COACH_REVIEW_QUEUE_KEY = 'logbook-coach-review-queue';

function readCoachReviewQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COACH_REVIEW_QUEUE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) { return {}; }
}

function writeCoachReviewQueue(value) {
  try {
    const entries = Object.entries(value || {});
    localStorage.setItem(COACH_REVIEW_QUEUE_KEY, JSON.stringify(Object.fromEntries(entries.slice(-200))));
  } catch (_) {}
}

function CoachNeedsAttention({ clients, checkinMap, checkinWeekMap, unreadNotes, go, onRequestCheckin, weekStartDay = 0 }) {
  const [dismissed, setDismissed] = useStateC(readCoachReviewQueue);
  const [expanded, setExpanded] = useStateC(false);
  const [requested, setRequested] = useStateC({});
  const activeClients = (clients || []).filter(c => c.status === 'active');
  const clientById = new Map(activeClients.map(c => [c.clientId, c]));
  const coachWeekStart = LB.checkinWeekStart?.(weekStartDay) || new Date().toISOString().slice(0, 10);
  const items = [];

  const isDismissed = key => !!dismissed[key];
  const clientLabel = c => c.clientName || c.clientEmail || 'Client';

  activeClients.forEach(client => {
    const checkinAt = Object.prototype.hasOwnProperty.call(checkinMap || {}, client.id)
      ? checkinMap[client.id]
      : undefined;
    const submittedSeen = typeof checkinAt === 'string' && (() => {
      try { return localStorage.getItem(`logbook-coach-ci-seen-${client.id}`) === checkinAt; } catch (_) { return false; }
    })();
    if (typeof checkinAt === 'string' && !submittedSeen) {
      items.push({
        key: `submitted:${client.id}:${checkinAt}`,
        type: 'submitted',
        icon: 'fa-clipboard-check',
        label: 'CHECK-IN SUBMITTED',
        detail: `${clientLabel(client)} sent a new weekly check-in`,
        client,
        checkinAt,
        initialTab: 'checkins',
      });
    }

    if (checkinAt === null && client.checkinEnabled !== false) {
      // The RPC resolves the boundary with the client's own setting and
      // timezone. Use that exact server-provided week for the local dismissal
      // key; falling back to the coach's setting keeps old/partial responses
      // compatible while the new column rolls out.
      const weekStart = checkinWeekMap?.[client.id] || coachWeekStart;
      const key = `due:${client.id}:${weekStart}`;
      if (!isDismissed(key)) {
        items.push({
          key,
          type: 'due',
          icon: 'fa-bell',
          label: 'CHECK-IN DUE',
          detail: `${clientLabel(client)} has not submitted this week`,
          client,
          initialTab: 'checkins',
        });
      }
    }
  });

  const notesByClient = new Map();
  (unreadNotes || []).forEach(note => {
    const client = clientById.get(note.authorId);
    if (!client) return;
    const list = notesByClient.get(client.clientId) || [];
    list.push(note);
    notesByClient.set(client.clientId, list);
  });
  notesByClient.forEach((notes, clientId) => {
    const client = clientById.get(clientId);
    const sorted = notes.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const visibleNotes = sorted.filter(note => !isDismissed(`note:${note.id}`));
    if (!visibleNotes.length) return;
    const latest = visibleNotes[0];
    const count = visibleNotes.length;
    items.push({
      key: `notes:${client.id}:${latest.id}`,
      type: 'notes',
      icon: 'fa-comment',
      label: count === 1 ? 'NEW MESSAGE' : `${count} NEW MESSAGES`,
      detail: `${clientLabel(client)}${latest.body ? ` · ${String(latest.body).replace(/\s+/g, ' ').slice(0, 72)}` : ''}`,
      client,
      noteIds: visibleNotes.map(note => note.id),
      initialTab: 'notes',
    });
  });

  const priority = { submitted: 0, notes: 1, due: 2 };
  items.sort((a, b) => (priority[a.type] - priority[b.type]) || String(a.detail).localeCompare(String(b.detail)));
  const visibleItems = expanded ? items : items.slice(0, 3);

  const dismiss = async item => {
    if (item.type === 'submitted' && item.checkinAt) {
      try { localStorage.setItem(`logbook-coach-ci-seen-${item.client.id}`, item.checkinAt); } catch (_) {}
    }
    if (item.type === 'notes' && item.noteIds?.length) {
      try { await LB.markCoachingNotesRead(item.noteIds); }
      catch (_) { UI.alert('Could not mark the message as reviewed.'); return false; }
    }
    const next = { ...dismissed, [item.key]: new Date().toISOString() };
    setDismissed(next);
    writeCoachReviewQueue(next);
    return true;
  };

  const openItem = async item => {
    if (item.type !== 'due') await dismiss(item);
    go({
      name: 'coaching-client',
      coachingId: item.client.id,
      clientId: item.client.clientId,
      clientName: item.client.clientName,
      initialTab: item.initialTab,
      checkinAt: item.checkinAt,
      backRoute: 'coaching',
    });
  };

  const handleRemind = async (event, item) => {
    event.stopPropagation();
    if (requested[item.client.id]) return;
    try {
      await onRequestCheckin(item.client.id);
      setRequested(current => ({ ...current, [item.client.id]: true }));
      setTimeout(() => setRequested(current => ({ ...current, [item.client.id]: false })), 4000);
    } catch (_) {
      UI.alert('Could not send the reminder. Please try again.');
    }
  };

  if (!activeClients.length) return null;

  return (
    <div style={{ margin: '4px 12px 4px', padding: '12px 14px', background: UI.bgInset, border: `var(--hair-width) solid ${items.length ? 'rgba(var(--accent-rgb),0.28)' : UI.hair}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: visibleItems.length ? 10 : 0 }}>
        <i className="fa-solid fa-inbox" style={{ color: 'var(--accent)', fontSize: 13 }} />
        <span style={{ flex: 1, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: UI.inkSoft }}>NEEDS ATTENTION</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: items.length ? 'var(--accent)' : UI.inkFaint }}>{items.length ? items.length : 'ALL CLEAR'}</span>
      </div>
      {visibleItems.map(item => (
        <div
          key={item.key}
          onClick={() => openItem(item)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `var(--hair-width) solid ${UI.hair}`, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
        >
          <i className={`fa-solid ${item.icon}`} style={{ width: 18, textAlign: 'center', color: 'var(--accent)', fontSize: 12, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600 }}>{item.detail}</div>
            <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 9, letterSpacing: '0.07em', marginTop: 2 }}>{item.label}</div>
          </div>
          {item.type === 'due' && (
            <button
              onClick={event => handleRemind(event, item)}
              style={{ background: requested[item.client.id] ? 'rgba(var(--accent-rgb),0.15)' : 'transparent', border: `var(--hair-width) solid ${requested[item.client.id] ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, color: requested[item.client.id] ? 'var(--accent)' : UI.inkFaint, borderRadius: 4, padding: '5px 7px', fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', cursor: requested[item.client.id] ? 'default' : 'pointer', flexShrink: 0 }}
            >{requested[item.client.id] ? 'SENT' : 'REMIND'}</button>
          )}
          <button
            aria-label="Mark reviewed"
            onClick={async event => { event.stopPropagation(); await dismiss(item); }}
            style={{ background: 'transparent', border: 'none', color: UI.inkFaint, padding: '5px 3px', cursor: 'pointer', flexShrink: 0 }}
          ><i className="fa-solid fa-check" style={{ fontSize: 12 }} /></button>
          <ChevronRight />
        </div>
      ))}
      {items.length > 3 && (
        <button
          onClick={() => setExpanded(value => !value)}
          style={{ width: '100%', marginTop: 8, padding: '7px 0 2px', background: 'transparent', border: 'none', borderTop: `var(--hair-width) solid ${UI.hair}`, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer' }}
        >{expanded ? 'SHOW LESS' : `VIEW ALL ${items.length}`}</button>
      )}
    </div>
  );
}

// ─── CoachingTabCoachView ─────────────────────────────────────────────────────

function CoachingTabCoachView({ store, setStore, userId, go, hideTopBar = false }) {
  const allClients = store.coaching?.asCoach || [];
  const [liveMap, setLiveMap] = useStateC({});
  const [statusMap, setStatusMap] = useStateC({});
  // Carried alongside the mode because a cleanup week is activated ahead of
  // time and pinned to the client's next cycle start: without the date the
  // card would announce a status the client has not entered yet.
  const [statusSinceMap, setStatusSinceMap] = useStateC({});
  const [checkinMap, setCheckinMap] = useStateC({});
  const [checkinWeekMap, setCheckinWeekMap] = useStateC({});
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
          const lm = {}, sm = {}, ssm = {};
          statusData.forEach(r => {
            lm[r.clientId] = r.inProgressSessionId;
            if (r.statusMode) { sm[r.clientId] = r.statusMode; ssm[r.clientId] = r.statusModeSince ?? null; }
          });
          setLiveMap(lm);
          setStatusMap(sm);
          setStatusSinceMap(ssm);
          const cm = {};
          const cwm = {};
          checkinData.forEach(r => {
            cm[r.coachingId] = r.checkedInAt;
            if (r.reportingWeekStart) cwm[r.coachingId] = r.reportingWeekStart;
          });
          setCheckinMap(cm);
          setCheckinWeekMap(cwm);
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
      if (result?.startsWith('ERROR:rate_limited')) { setInviteError('Too many invites just now. Try again in a little while.'); return; }
      // Any other ERROR:* (rate-limit, permission, a future code) must not fall
      // through to the success path and pretend the invite was sent.
      if (result?.startsWith('ERROR:')) { setInviteError('Could not send invite.'); return; }
      setInviteEmail('');
      setInviteOpen(false);
      const coaching = await LB.reloadCoachingState(userId);
      // reloadCoachingState does not return anyClientLive or
      // pendingCheckinsCount, so replacing the whole object wiped the live
      // dot and the check-in count off the tab. The 60s poll only rewrites
      // them when a value actually changes, so they stayed gone until then.
      // Same preserving merge the pending-invite banner already uses.
      setStore(s => s ? { ...s, coaching: { ...coaching, anyClientLive: s.coaching?.anyClientLive, pendingCheckinsCount: s.coaching?.pendingCheckinsCount } } : s);
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
      // reloadCoachingState does not return anyClientLive or
      // pendingCheckinsCount, so replacing the whole object wiped the live
      // dot and the check-in count off the tab. The 60s poll only rewrites
      // them when a value actually changes, so they stayed gone until then.
      // Same preserving merge the pending-invite banner already uses.
      setStore(s => s ? { ...s, coaching: { ...coaching, anyClientLive: s.coaching?.anyClientLive, pendingCheckinsCount: s.coaching?.pendingCheckinsCount } } : s);
    } catch (e) {
      UI.alert(e.message);
    } finally {
      setEnding(null);
    }
  };

  const handleRequestCheckin = async (coachingId) => {
    // Let failures propagate so the card can surface an error instead of
    // flashing a false "Sent" while the reminder never went out.
    await LB.requestCheckin(coachingId, userId);
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
            style={{ width: '100%', padding: '13px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', textShadow: 'none', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 700, cursor: inviting || !inviteEmail.trim() ? 'not-allowed' : 'pointer', opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }}
          >
            {inviting ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
      </Sheet>

      {/* End / cancel sheet */}
      <Sheet open={endOpen} onClose={() => setEndOpen(false)} title="End Coaching" titleColor="var(--accent)">
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
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: UI.bgInset, borderRadius: 8, border: `var(--hair-width) solid ${UI.hair}`, cursor: ending === c.id ? 'wait' : 'pointer' }}
              >
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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

      <CoachNeedsAttention
        clients={allClients}
        checkinMap={checkinMap}
        checkinWeekMap={checkinWeekMap}
        unreadNotes={unreadNotes.filter(n => !n.coachingId?.startsWith('support_'))}
        go={go}
        onRequestCheckin={handleRequestCheckin}
        weekStartDay={store.settings?.weekStartDay}
      />

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
            const clientStatusSince = statusSinceMap[c.clientId] || null;
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
                statusModeSince={clientStatusSince}
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

function CoachingTabClientCard({ client, inProgress, statusMode, statusModeSince, unreadCount, checkinDue, checkinNew, checkinAt, onRequestCheckin, go }) {
  // A cleanup week is queued at activation but only begins on the client's next
  // cycle start, so until that day it must read as upcoming, not as the status
  // they are currently in. Only cleanup: the other modes all start immediately.
  const statusPending = statusMode === 'cleanup' && !LB.cleanupStarted({ statusMode, statusModeSince });
  const statusLabel = statusMode === 'sick' ? 'SICK'
    : statusMode === 'deload' ? 'DELOAD'
    : statusMode === 'cleanup' ? 'CLEANUP'
    : 'VACATION';
  const statusSinceDay = statusModeSince
    ? new Date(statusModeSince).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }).toUpperCase()
    : null;
  const isPending = client.status === 'pending';
  const [requested, setRequested] = useStateC(false);
  const [checkinDismissed, setCheckinDismissed] = useStateC(false);

  const handleCardClick = () => {
    if (isPending) return;
    go({ name: 'coaching-client', coachingId: client.id, clientId: client.clientId, clientName: client.clientName, checkinAt, backRoute: 'coaching' });
  };

  const handleRequest = async (e) => {
    e.stopPropagation();
    if (requested) return;
    // Only flip to "Sent" once the request actually succeeded; surface failures
    // instead of silently swallowing them and pretending the client was nudged.
    try {
      await onRequestCheckin();
      setRequested(true);
      setTimeout(() => setRequested(false), 4000);
    } catch (_) {
      UI.alert('Could not send the reminder. Please try again.');
    }
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
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: UI.bgInset, borderRadius: 8, border: `var(--hair-width) solid ${borderColor}`, cursor: isPending ? 'default' : 'pointer', position: 'relative', overflow: 'hidden', opacity: isPending ? 0.75 : 1 }}
    >
      {inProgress && (
        <div style={{ position: 'absolute', inset: 0, background: `rgba(var(--accent-rgb),0.10)`, pointerEvents: 'none' }} />
      )}
      <div style={{ width: 44, height: 44, borderRadius: '50%', background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 18, color: UI.inkSoft, fontWeight: 700 }}>{(client.clientName || client.clientEmail || '?')[0].toUpperCase()}</span>
        {inProgress && (
          <div style={{ position: 'absolute', top: 0, right: 0, width: 12, height: 12, borderRadius: 6, background: 'var(--accent)', border: '2px solid var(--bg)', animation: 'pulseDot 1.5s ease-in-out infinite' }} />
        )}
        {showCheckinNew && !inProgress && (
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, background: 'var(--accent)', border: '2px solid var(--bg)' }} />
        )}
        {statusMode && !inProgress && !showCheckinNew && (
          <div style={{ position: 'absolute', top: 0, right: 0, width: 12, height: 12, borderRadius: 6, background: UI.inkGhost, border: '2px solid var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className={`fa-solid ${statusMode === 'sick' ? 'fa-bed-pulse' : statusMode === 'deload' ? 'fa-arrow-trend-down' : statusMode === 'cleanup' ? 'fa-broom' : 'fa-umbrella-beach'}`} style={{ fontSize: 5, color: UI.bg }} />
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
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.06em' }}>
            {statusPending && statusSinceDay ? `${statusLabel} → ${statusSinceDay}` : statusLabel}
          </div>
        ) : showCheckinNew ? (
          <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.06em' }}>CHECK-IN SUBMITTED</div>
        ) : checkinDue ? (
          <div style={{ fontSize: 11, color: `rgba(var(--accent-rgb),0.7)`, fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.06em' }}>CHECK-IN DUE</div>
        ) : null}
      </div>
      {checkinDue && !isPending && (
        <button
          onClick={handleRequest}
          style={{ background: requested ? `rgba(var(--accent-rgb),0.15)` : 'transparent', border: `var(--hair-width) solid ${requested ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, borderRadius: 4, padding: '5px 8px', cursor: requested ? 'default' : 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <i className="fa-solid fa-bell" style={{ fontSize: 10, color: requested ? 'var(--accent)' : UI.inkFaint }} />
          <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.06em', color: requested ? 'var(--accent)' : UI.inkFaint, textTransform: 'uppercase' }}>{requested ? 'Sent' : 'Remind'}</span>
        </button>
      )}
      {showCheckinNew && !isPending && (
        <button
          onClick={handleDismissCheckin}
          style={{ background: 'transparent', border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4, padding: '5px 8px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, WebkitTapHighlightColor: 'transparent' }}
        >
          <i className="fa-solid fa-check" style={{ fontSize: 10, color: UI.inkFaint }} />
          <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.06em', color: UI.inkFaint, textTransform: 'uppercase' }}>Dismiss</span>
        </button>
      )}
      {!isPending && unreadCount > 0 && (
        <div style={{ minWidth: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontFamily: UI.fontUi, fontWeight: 700, color: 'var(--accent-ink)' }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
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
  const fmt = (dt) => dt.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
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
              flex: 1, padding: '6px 0', borderRadius: 4, cursor: readOnly ? 'default' : 'pointer',
              border: `1px solid ${value != null && n <= value && value !== n ? 'rgba(var(--accent-rgb),0.5)' : 'transparent'}`,
              background: value === n ? 'var(--accent)' : value != null && n <= value ? `rgba(var(--accent-rgb),0.3)` : UI.bgInset,
              color: value === n ? 'var(--accent-ink)' : n <= 3 ? 'var(--accent)' : n <= 6 ? UI.inkSoft : UI.inkFaint,
              textShadow: 'none',
              fontSize: 10, fontFamily: UI.fontUi, fontWeight: value === n ? 700 : 400,
              transition: 'background 0.1s',
            }}
          >{n}</button>
        ))}
      </div>
    </div>
  );
}

// Weight trend alone doesn't reliably say which phase a client is in (it's
// noisy, and can point the "wrong" way even mid-phase), and there is no
// stored goal/phase field anywhere in the data model. Asked fresh at
// generation time instead: shared by CheckInCard's own inline block and
// CheckInAiOpinionBanner, both of which otherwise duplicate this exact row.
const CHECKIN_PHASE_OPTIONS = [
  { value: 'cut', label: 'Cut' },
  { value: 'maintain', label: 'Maintain' },
  { value: 'bulk', label: 'Bulk' },
];

function CheckInPhasePicker({ onPick, busy }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 6 }}>Which phase are you in?</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {CHECKIN_PHASE_OPTIONS.map(p => (
          <button key={p.value} onClick={() => onPick(p.value)} disabled={busy}
            style={{ flex: 1, padding: '8px 4px', borderRadius: 6, cursor: busy ? 'default' : 'pointer',
              background: 'rgba(var(--accent-rgb),0.12)', border: 'var(--hair-width) solid rgba(var(--accent-rgb),0.4)',
              color: busy ? UI.inkFaint : 'var(--accent)', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600,
              WebkitTapHighlightColor: 'transparent' }}>
            {busy ? '…' : p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CheckInCard({ ci, prevCi, schema, defaultOpen = false, embedded = false, onEdit, onDelete, confirmingDelete = false, coachingMacrosHistory = null, clientUnit, onGenerated, isAdmin = false, busy, onGenerateStart, onGenerateError }) {
  const [open, setOpen] = useStateC(defaultOpen);
  const [exportMode, setExportMode] = useStateC(null); // null | 'pick' | 'exporting'
  const [ownOpinionBusy, setOwnOpinionBusy] = useStateC(false);
  const [opinionError, setOpinionError] = useStateC(null);
  const [opinionRetryOpen, setOpinionRetryOpen] = useStateC(false);
  // onGenerated is only passed at the two REAL check-in call sites (this
  // week's own card, past check-ins), never the schema-builder's fake sample
  // or the in-progress week's live preview (ci.id doesn't exist there
  // either): there's nothing real to generate an opinion about in either case.
  const showAiOpinion = !!ci.id && !!onGenerated;
  // Only this week's card is wired up with onGenerateStart (see the
  // ClientCheckInTab call site): it renders right below
  // CheckInAiOpinionBanner for the SAME check-in, so both need to share one
  // in-flight flag, otherwise a user can tap Generate on the banner, expand
  // the card before that request resolves, and fire a second concurrent
  // generateCheckinOpinion call. Every other render site (past check-ins,
  // the coach's full check-in list, the schema builder's sample) has no
  // banner sibling to race against and keeps tracking busy locally, exactly
  // as before.
  const hasSharedBusy = typeof onGenerateStart === 'function';
  const opinionBusy = hasSharedBusy ? busy : ownOpinionBusy;
  async function generateOpinion(phase) {
    if (hasSharedBusy) onGenerateStart(); else setOwnOpinionBusy(true);
    setOpinionError(null);
    const res = await LB.generateCheckinOpinion(ci.id, phase);
    if (!hasSharedBusy) setOwnOpinionBusy(false);
    if (!res.ok) {
      setOpinionError(res.error || 'Could not generate. Try again.');
      if (hasSharedBusy) onGenerateError();
      return;
    }
    onGenerated();
  }
  const { headline: opinionHeadline, body: opinionBody } = LB.splitHeadlineBody(ci.aiOpinion || '');
  const cardRef = useRefC(null);
  const sections = schema || CHECKIN_DEFAULT_SCHEMA;
  const responses = ci.responses || {};
  const has = v => v != null && v !== '';
  const distUnit = LB.cardioDistUnit();
  // The CLIENT's weight-unit label (numbers are never converted). Falls back to
  // the viewer's unit for self-coaching / previews where no client unit is passed.
  const wUnit = clientUnit || UI.unit();

  // Planned macro avg row, mirrors HealthWeekCard logic.
  // Resolve the macro entry that was active at the END of this check-in week
  // (Sunday = weekStart + 6 days) so past check-ins use the targets from that time.
  const activeMacros = (() => {
    if (!coachingMacrosHistory?.length) return null;
    const weekEnd = LB.weekEnd(ci.weekStart);
    // History is sorted newest-first; first entry whose set_at date ≤ Sunday of this week.
    return coachingMacrosHistory.find(m => m.setAt.slice(0, 10) <= weekEnd) || null;
  })();
  // Use days_trained from the check-in as the training/rest split for the weighted average.
  const macroResponseKeys = ['calories_avg', 'protein_avg', 'carbs_avg', 'fat_avg'];
  const hasMacroResponse = macroResponseKeys.some(k => has(responses[k]));
  const planTDays = responses.days_trained != null ? (parseInt(responses.days_trained) || 0) : 3;
  const planRDays = 7 - planTDays;
  const planMacro = (tk, rk) => {
    if (!activeMacros) return null;
    const tv = activeMacros[tk], rv = activeMacros[rk];
    if (tv == null && rv == null) return null;
    return Math.round(((tv || 0) * planTDays + (rv || 0) * planRDays) / 7);
  };
  const planCal  = planMacro('caloriesTraining', 'caloriesRest');
  const planProt = planMacro('proteinTraining',  'proteinRest');
  const planCarb = planMacro('carbsTraining',    'carbsRest');
  const planFat  = planMacro('fatTraining',      'fatRest');
  const showPlanRow = hasMacroResponse && (planCal != null || planProt != null || planCarb != null || planFat != null);

  // Format one field's stored value for display, shared with the trend-card
  // formatter (checkinFieldValue in screens-coaching-detail.jsx) so a field
  // never shows a different number here than it does on the chart.
  const fmtValue = (f, v) => checkinFieldValue(f, v, { distUnit, weightUnit: wUnit });

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
  //, surfaced in an "Additional" block so submitted data never silently vanishes.
  const schemaKeys = new Set(sections.flatMap(s => (s.fields || []).map(f => f.key)));
  const extraKeys = Object.keys(responses).filter(k => !schemaKeys.has(k) && has(responses[k]));

  const weightDelta = (() => {
    const cur = parseFloat(responses.weight_avg_last_week);
    const prev = parseFloat(prevCi?.responses?.weight_avg_last_week);
    if (isNaN(cur) || isNaN(prev)) return null;
    return Math.round((cur - prev) * 100) / 100;
  })();
  const fmtDelta = d => (d >= 0 ? '+' : '') + d.toFixed(2).replace('.', ',') + ' ' + wUnit;

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
  const fmtDistDelta = d => (d > 0 ? '+' : '') + LB.mToDisplay(d, distUnit, 1) + ' ' + distUnit;
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
    const macroFieldKeys = new Set(['calories_avg', 'protein_avg', 'carbs_avg', 'fat_avg']);
    const lines = [`Week of ${fmtWeek(ci.weekStart)}`];
    sections.forEach(section => {
      const fields = (section.fields || []).filter(f => has(responses[f.key]));
      if (!fields.length) return;
      const headLabel = `// ${section.label.toUpperCase()}${section.sectionHint ? ` (${section.sectionHint})` : ''} //`;
      lines.push('', headLabel);
      let planRowInserted = false;
      fields.forEach((f, fi) => {
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
        // Insert planned avg right after the last macro field in this section
        if (!planRowInserted && macroFieldKeys.has(f.key) && showPlanRow) {
          const nextIsMacro = fi + 1 < fields.length && macroFieldKeys.has(fields[fi + 1].key);
          if (!nextIsMacro) {
            const parts = [];
            if (planCal  != null) parts.push(`Cal: ${planCal} kcal`);
            if (planProt != null) parts.push(`Protein: ${planProt} g`);
            if (planCarb != null) parts.push(`Carbs: ${planCarb} g`);
            if (planFat  != null) parts.push(`Fat: ${planFat} g`);
            if (parts.length) lines.push('', `Planned avg: ${parts.join(' · ')}`);
            planRowInserted = true;
          }
        }
      });
    });
    if (extraKeys.length) {
      lines.push('', '// ADDITIONAL //');
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
    <div ref={cardRef} style={embedded ? { overflow: 'hidden' } : { background: UI.bgInset, borderRadius: 8, border: `var(--hair-width) solid ${UI.hair}`, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', gap: 12 }}
      >
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>Week of {fmtWeek(ci.weekStart)}</div>
          {has(wToday) && (
            <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, marginTop: 2 }}>
              {wToday} {wUnit}{has(wAvg) ? ` · avg ${wAvg} ${wUnit}` : ''}{ci.photos?.length ? ` · ${ci.photos.length} photo${ci.photos.length === 1 ? '' : 's'}` : ''}
            </div>
          )}
          {!has(wToday) && ci.photos?.length > 0 && (
            <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, marginTop: 2 }}>
              {ci.photos.length} photo{ci.photos.length === 1 ? '' : 's'} attached
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
            let lastMacroPillBlockIdx = -1;
            const flush = () => {
              if (!run.length) return;
              const items = run; run = []; const kind = runKind; runKind = null;
              if (kind === 'pill') {
                if (items.some(f => macroResponseKeys.includes(f.key))) lastMacroPillBlockIdx = blocks.length;
                blocks.push(
                  <div key={`p-${items[0].key}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                    {items.map(f => <StatPill key={f.key} label={f.label} value={fmtValue(f, responses[f.key])} {...pillDeltaProps(f)} />)}
                  </div>
                );
              } else {
                blocks.push(
                  <div key={`s-${items[0].key}`}>
                    {items.map(f => (
                      <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `var(--hair-width) solid ${UI.hair}` }}>
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
            // Insert planned avg card right after the last macro pill block (before any text fields).
            if (showPlanRow && lastMacroPillBlockIdx >= 0) {
              const planRow = (
                <div key="plan-row" style={{ background: UI.bgRaised, borderRadius: 6, border: `var(--hair-width) solid ${UI.hair}`, padding: '8px 10px' }}>
                  <div style={{ fontSize: 9, color: 'var(--accent)', fontFamily: UI.fontUi, letterSpacing: '0.07em', textTransform: 'uppercase', fontWeight: 700, textAlign: 'center', marginBottom: 6 }}>Planned avg</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0 6px' }}>
                    {[{v: planCal, u: 'kcal'}, {v: planProt, u: 'g'}, {v: planCarb, u: 'g'}, {v: planFat, u: 'g'}].map(({v, u}, i) => (
                      <div key={i} style={{ textAlign: 'center' }}>
                        <div className="num" style={{ fontSize: 15, color: UI.inkSoft, fontWeight: 300 }}>
                          {v != null ? v : '—'}
                        </div>
                        <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.07em', marginTop: 1 }}>
                          {['Cal', 'Protein', 'Carbs', 'Fat'][i]} {u}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
              blocks.splice(lastMacroPillBlockIdx + 1, 0, planRow);
            }
            return (
              <div key={section.id}>
                <div className="knurl" style={{ margin: '0 0 6px' }} />
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>{headLabel}</div>
                <div className="knurl" style={{ margin: '0 0 10px' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{blocks}</div>
              </div>
            );
          })}

          {/* Submitted fields no longer in the schema, kept visible, never dropped */}
          {extraKeys.length > 0 && (
            <div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>ADDITIONAL</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {extraKeys.map(k => <StatPill key={k} label={k.replace(/_/g, ' ')} value={String(responses[k])} />)}
              </div>
            </div>
          )}

          {Array.isArray(ci.photos) && ci.photos.length > 0 && (
            <div>
              <div className="knurl" style={{ margin: '0 0 6px' }} />
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>
                PHOTOS · {ci.photos.length}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {ci.photos.map(photo => (
                  photo.previewUrl ? (
                    <a key={photo.id} href={photo.previewUrl} target="_blank" rel="noreferrer"
                      style={{ display: 'block', background: UI.bgRaised, borderRadius: 6, border: `var(--hair-width) solid ${UI.hair}`, overflow: 'hidden' }}>
                      <img src={photo.previewUrl} alt={photo.fileName || 'Check-in photo'}
                        style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' }} />
                    </a>
                  ) : photo.driveUrl ? (
                    <a key={photo.id} href={photo.driveUrl} target="_blank" rel="noreferrer"
                      style={{ minWidth: 0, minHeight: 82, padding: '12px 10px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: UI.bgRaised, borderRadius: 6, border: `var(--hair-width) solid ${UI.hairStrong}`, color: UI.inkSoft, textDecoration: 'none', fontFamily: UI.fontUi, textAlign: 'center' }}>
                      <i className="fa-brands fa-google-drive" style={{ color: 'var(--accent)', fontSize: 18 }} />
                      <span style={{ width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{photo.fileName || 'Photo'}</span>
                      <span style={{ fontSize: 9, color: UI.inkFaint, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Open in Drive</span>
                    </a>
                  ) : (
                    <div key={photo.id}
                      style={{ minWidth: 0, minHeight: 82, padding: '12px 10px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: UI.bgRaised, borderRadius: 6, border: `var(--hair-width) solid ${UI.hair}`, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center' }}>
                      <i className="fa-solid fa-cloud-arrow-up" style={{ fontSize: 17 }} />
                      <span style={{ width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{photo.fileName || 'Photo'}</span>
                      <span style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Uploading</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}

          {/* AI Coach opinion: same block, same data, for whichever side (client
              or coach) is looking at this exact card, since this component is
              the one shared render both already use. */}
          {showAiOpinion && (
            <div>
              <div className="knurl" style={{ margin: '0 0 6px' }} />
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>AI COACH</div>
              {ci.aiOpinionGeneratedAt ? (
                <div>
                  {opinionHeadline && <div style={{ fontSize: 13, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi, marginBottom: 4 }}>{opinionHeadline}</div>}
                  <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: '18px', whiteSpace: 'pre-wrap' }}>{opinionBody}</div>
                  {isAdmin && (
                    <div style={{ marginTop: 8 }}>
                      {opinionRetryOpen ? (
                        <CheckInPhasePicker onPick={(p) => { setOpinionRetryOpen(false); generateOpinion(p); }} busy={opinionBusy} />
                      ) : (
                        <button onClick={() => setOpinionRetryOpen(true)} style={{ background: 'transparent', border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                          <i className="fa-solid fa-rotate-right" />Retry
                        </button>
                      )}
                      {opinionError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginTop: 6, lineHeight: '16px' }}>{opinionError}</div>}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <CheckInPhasePicker onPick={generateOpinion} busy={opinionBusy} />
                  {opinionError && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginTop: 6, lineHeight: '16px' }}>{opinionError}</div>}
                </div>
              )}
            </div>
          )}

          {/* Actions row, export always visible, edit/delete when handlers are present */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
            {onDelete && (
              <button onClick={onDelete}
                style={{ background: confirmingDelete ? 'rgba(var(--danger-rgb),0.12)' : UI.bgRaised, border: `var(--hair-width) solid ${confirmingDelete ? 'rgba(var(--danger-rgb),0.5)' : UI.hairStrong}`, borderRadius: 6, textShadow: 'none', padding: '8px 16px', fontSize: 12, color: confirmingDelete ? 'rgba(var(--danger-rgb),0.9)' : UI.inkFaint, fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                {confirmingDelete ? 'Confirm?' : 'Delete'}
              </button>
            )}
            {onEdit && (
              <button onClick={onEdit}
                style={{ background: 'rgba(var(--accent-rgb),0.12)', border: 'var(--hair-width) solid rgba(var(--accent-rgb),0.4)', borderRadius: 6, padding: '8px 18px', fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>Edit</button>
            )}
            {exportMode === 'pick' ? (
              <>
                <button onClick={() => setExportMode(null)}
                  style={{ background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, textShadow: 'none', padding: '8px 14px', fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>Cancel</button>
                <button onClick={doExportText}
                  style={{ background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, textShadow: 'none', padding: '8px 14px', fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>Text</button>
                <button onClick={doExportImage}
                  style={{ background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, textShadow: 'none', padding: '8px 14px', fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>Image</button>
              </>
            ) : (
              <button onClick={() => setExportMode('pick')} disabled={exportMode === 'exporting'}
                style={{ background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, textShadow: 'none', padding: '8px 14px', fontSize: 12, color: exportMode === 'exporting' ? UI.inkFaint : UI.ink, fontFamily: UI.fontUi, cursor: exportMode === 'exporting' ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                {exportMode === 'exporting' ? '…' : <i className="fa-solid fa-share-from-square" />}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Same AI opinion data as the block inside CheckInCard, surfaced again right
// at the top of the tab: that block only renders once thisWeek's own card is
// expanded, which buried it too deep for users to ever find or use.
function CheckInAiOpinionBanner({ ci, busy, onGenerateStart, onGenerateError, onGenerated, isAdmin = false }) {
  const [error, setError] = useStateC(null);
  const [retryOpen, setRetryOpen] = useStateC(false);
  // busy is owned by ClientCheckInTab and shared with this week's CheckInCard,
  // the only other affordance for this exact check-in's opinion, so the two
  // can never both have a generateCheckinOpinion call in flight at once (see
  // CheckInCard's hasSharedBusy comment for the full picture).
  const generate = async (phase) => {
    onGenerateStart();
    setError(null);
    const res = await LB.generateCheckinOpinion(ci.id, phase);
    if (!res.ok) {
      setError(res.error || 'Could not generate. Try again.');
      onGenerateError();
      return;
    }
    onGenerated();
  };
  const { headline, body } = LB.splitHeadlineBody(ci.aiOpinion || '');
  return (
    <div style={{ background: UI.bgInset, borderRadius: 8, border: `var(--hair-width) solid ${UI.hair}`, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <i className="fa-solid fa-wand-magic-sparkles" style={{ fontSize: 12, color: UI.inkFaint }} />
        <span className="micro" style={{ color: UI.inkFaint }}>AI COACH · THIS WEEK</span>
      </div>
      {ci.aiOpinionGeneratedAt ? (
        <div>
          {headline && <div style={{ fontSize: 14, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi, marginBottom: 5 }}>{headline}</div>}
          <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: '18px', whiteSpace: 'pre-wrap' }}>{body}</div>
          {isAdmin && (
            <div style={{ marginTop: 8 }}>
              {retryOpen ? (
                <CheckInPhasePicker onPick={(p) => { setRetryOpen(false); generate(p); }} busy={busy} />
              ) : (
                <button onClick={() => setRetryOpen(true)} style={{ background: 'transparent', border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                  <i className="fa-solid fa-rotate-right" />Retry
                </button>
              )}
              {error && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginTop: 6, lineHeight: '16px' }}>{error}</div>}
            </div>
          )}
        </div>
      ) : (
        <div>
          <CheckInPhasePicker onPick={generate} busy={busy} />
          {error && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginTop: 6, lineHeight: '16px' }}>{error}</div>}
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
    <div style={{ background: UI.bgRaised, borderRadius: 6, padding: '7px 10px', border: `var(--hair-width) solid ${UI.hair}` }}>
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
    return LB.distToM(raw, distUnit);
  }
  // Hydration is entered in the viewer's water unit (fl oz for lbs, else ml)
  // and stored canonically in ml, like distance stores meters.
  if (field.key === 'hydration_ml') { const n = parseInt(raw, 10); return isNaN(n) ? null : UI.waterEntryToMl(n); }
  if (field.type === 'pace') {
    // Pace is edited as two text inputs, so the form can briefly contain a
    // half-entered value such as `:00` or `6:`. Do not submit those states;
    // once both sides are present, store one canonical min:ss string.
    const match = String(raw).match(/^(\d{1,2}):(\d{1,2})$/);
    if (!match) return null;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || minutes > 99 || seconds > 59) return null;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
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
      form[field.key] = v != null ? LB.mToDisplay(v, distUnit) : '';
    } else if (field.key === 'hydration_ml') {
      form[field.key] = v != null ? String(UI.waterToEntry(v)) : '';
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
  const lbl = (field.key === 'hydration_ml'
    ? `${field.label} (${UI.waterEntryUnit()})`
    : field.unit === 'weight'
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
        <div style={{ ...inputStyle, background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hair}`, color: has ? 'var(--accent)' : UI.inkGhost, fontFamily: UI.fontNum, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
          rows={field.rows || 2} maxLength={2000} style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }} />
      </>
    );
  }

  if (field._distanceField) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{field.label + req}</span>
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
            {['km', 'mi'].map(u => (
              <button key={u} onClick={() => {
                const n = parseFloat(String(value || '').replace(',', '.'));
                setDistUnit(u);
                if (!isNaN(n) && n > 0) {
                  const m = LB.distToM(value, distUnit);
                  onChange(LB.mToDisplay(m, u));
                }
              }} style={{ padding: '2px 7px', cursor: 'pointer', border: 'none',
                background: distUnit === u ? 'var(--accent)' : 'transparent',
                color: distUnit === u ? UI.bg : UI.inkFaint,
                textShadow: 'none',
                fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
                WebkitTapHighlightColor: 'transparent' }}>
              {u}
              </button>
            ))}
          </div>
        </div>
        <input type="text" inputMode="decimal" placeholder="–" value={value || ''} onChange={e => onChange(e.target.value)} style={inputStyle} />
      </>
    );
  }

  if (field.type === 'pace') {
    const raw = value || '';
    const colon = raw.indexOf(':');
    const mins = colon >= 0 ? raw.slice(0, colon) : raw;
    const secs = colon >= 0 ? raw.slice(colon + 1) : '';
    // Keep the empty intermediate value while a user replaces one side of
    // the pace. The old implementation immediately turned a cleared minute
    // field into `0:00`, so iOS never gave the user a chance to type the new
    // minutes. The canonical value is validated/normalised in toResponse at
    // submit time; while editing, `:00` and `6:` are intentional states.
    const combine = (part, next) => {
      const clean = v => String(v ?? '').replace(/\D/g, '').slice(0, 2);
      const mm = clean(part === 'minutes' ? next : mins);
      const ss = clean(part === 'seconds' ? next : secs);
      if (!mm && !ss) { onChange(''); return; }
      onChange(`${mm}:${ss}`);
    };
    return (
      <>
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>{lbl}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="text" inputMode="numeric" min="0" max="99" placeholder="mm"
            value={mins} onChange={e => combine('minutes', e.target.value)}
            style={{ ...inputStyle, textAlign: 'center', flex: 1 }} />
          <span style={{ color: UI.inkFaint, fontFamily: UI.fontNum, fontSize: 18, lineHeight: 1, flexShrink: 0 }}>:</span>
          <input type="text" inputMode="numeric" min="0" max="59" placeholder="ss"
            value={secs} onChange={e => combine('seconds', e.target.value)}
            style={{ ...inputStyle, textAlign: 'center', flex: 1 }} />
        </div>
      </>
    );
  }

  if (field.type === 'integer' || field.type === 'decimal') {
    return (
      <>
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4 }}>{lbl}</div>
        <input type="text" inputMode={field.type === 'decimal' ? 'decimal' : 'numeric'}
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
      if (value === n) return 'var(--accent-ink)';
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
              style={{ flex: 1, padding: '8px 0', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${value != null && n <= value && value !== n ? 'rgba(var(--accent-rgb),0.5)' : 'transparent'}`,
                background: value === n ? 'var(--accent)' : value != null && n <= value ? `rgba(var(--accent-rgb),0.3)` : UI.bgInset,
                color: btnColor(n),
                textShadow: 'none',
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
                  border: `${value === opt.value ? '1.5px' : 'var(--hair-width)'} solid ${value === opt.value ? 'var(--accent)' : UI.hairStrong}`,
                  background: value === opt.value ? `rgba(var(--accent-rgb),0.24)` : UI.bgInset,
                  textShadow: 'none',
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
            const bg = sel ? opt.color === 'accent' ? `rgba(var(--accent-rgb),0.28)` : opt.color === 'danger' ? `rgba(var(--danger-rgb),0.22)` : UI.bgRaised : UI.bgInset;
            const fg = sel ? opt.color === 'accent' ? 'var(--accent)' : opt.color === 'danger' ? 'rgba(var(--danger-rgb),0.85)' : UI.ink : UI.inkFaint;
            return (
              <button key={opt.value} onClick={() => onChange(sel ? null : opt.value)}
                style={{ flex: 1, padding: '9px 4px', borderRadius: 6, cursor: 'pointer', background: bg, color: fg,
                  textShadow: 'none',
                  fontFamily: UI.fontUi, fontSize: 10, fontWeight: sel ? 700 : 400, letterSpacing: '0.04em',
                  border: `${sel ? '1.5px' : 'var(--hair-width)'} solid ${sel ? 'currentColor' : UI.hairStrong}` }}>
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

function CheckInForm({ coachingId, clientId, userId, weekStart, existing, prefill, dailyPrefill, perfPrefill, onSaved, schema, photosEnabled = false }) {
  const sections = schema || CHECKIN_DEFAULT_SCHEMA;
  const allFields = sections.flatMap(s => s.fields || []);

  const [distUnit, setDistUnitRaw] = useStateC(LB.cardioDistUnit);
  const setDistUnit = u => { LB.setCardioDistUnit(u); setDistUnitRaw(u); };

  const [form, setForm] = useStateC(() => {
    const du = LB.cardioDistUnit();
    if (existing) return initFormState(sections, existing.responses || {}, du);
    const base = initFormState(sections, {}, du);
    if (prefill) {
      if (prefill.cardioMinutes != null) base.cardio_minutes = String(prefill.cardioMinutes);
      if (prefill.cardioDistanceM != null) base.cardio_distance_m = LB.mToDisplay(prefill.cardioDistanceM, du);
      if (prefill.pace != null) base.cardio_pace = prefill.pace;
      if (prefill.paceFeeling != null) base.cardio_pace_feeling = prefill.paceFeeling;
      if (prefill.effort != null) base.cardio_effort = prefill.effort;
    }
    // Daily-log prefill: keys map 1:1 to form field keys (weight_today, steps,
    // protein_avg, macro_adherence, …). Only apply keys the schema actually has.
    if (dailyPrefill) {
      allFields.forEach(f => { if (dailyPrefill[f.key] != null) base[f.key] = f.key === 'hydration_ml' ? String(UI.waterToEntry(dailyPrefill[f.key])) : String(dailyPrefill[f.key]); });
    }
    // Performance-vs-last-week is derived from logged sessions (the same source
    // the live preview uses), not from daily/cardio logs, apply it on top.
    if (perfPrefill != null && allFields.some(f => f.key === 'performance_vs_last_week')) {
      base.performance_vs_last_week = perfPrefill;
    }
    return base;
  });

  const [saving, setSaving] = useStateC(false);
  const [error, setError] = useStateC('');
  const [photos, setPhotos] = useStateC([]);
  const photoInputRef = useRefC(null);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // Validate against the PARSED value (what actually gets submitted), not the
  // raw string: letters in a required number field or '0' in a required distance
  // field parse to null in toResponse and would otherwise submit silently absent.
  const missing = allFields.filter(f => f.required).filter(f => toResponse(f, form[f.key], distUnit) == null).map(f => f.label);
  const canSubmit = missing.length === 0;

  const handleSubmit = async () => {
    if (!canSubmit) { setError(`Can't submit, please fill in: ${missing.join(', ')}.`); return; }
    setSaving(true); setError('');
    try {
      const responses = {};
      allFields.forEach(field => {
        const val = toResponse(field, form[field.key], distUnit);
        if (val != null) responses[field.key] = val;
      });
      // Preserve answers to fields the coach has since removed from the
      // schema: submitCheckin upserts the whole responses jsonb with no
      // merge, and this form only ever knows about CURRENT schema fields
      // (allFields), so without this an edit + resave would silently delete
      // them from the DB even though CheckInCard still shows them (its own
      // extraKeys block, "Submitted fields no longer in the schema, kept
      // visible, never dropped"). Same schemaKeys/has() logic as that block.
      if (existing?.responses) {
        const schemaKeys = new Set(allFields.map(f => f.key));
        Object.keys(existing.responses).forEach(k => {
          const v = existing.responses[k];
          if (!schemaKeys.has(k) && v != null && v !== '') responses[k] = v;
        });
      }
      // existing?.id, not !!existing: re-saving a check-in must keep the row's
      // primary key, see the comment on submitCheckin.
      const checkinId = await LB.submitCheckin(coachingId, clientId, responses, userId, weekStart, existing?.id, sections);
      if (photos.length) {
        // Keep staging inside the app's write-pressure budget. The database
        // trigger still serializes the eight-photo cap, but sequential uploads
        // avoid eight concurrent Storage + metadata writes on mobile.
        const results = [];
        for (const file of photos) {
          try { await LB.stageCoachingCheckinPhoto(file, coachingId, checkinId, userId); results.push({ status: 'fulfilled' }); }
          catch (reason) { results.push({ status: 'rejected', reason }); }
        }
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed) setTimeout(() => UI.alert(`Check-in saved. ${failed} photo${failed === 1 ? '' : 's'} could not be staged and can be added again later.`), 0);
      }
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
      {(prefill || dailyPrefill || perfPrefill != null) && !existing && (
        <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: UI.fontUi, padding: '6px 10px', background: `rgba(var(--accent-rgb),0.16)`, borderRadius: 6, border: `var(--hair-width) solid rgba(var(--accent-rgb),0.2)` }}>
          {dailyPrefill
            ? `Prefilled from your daily logs${prefill ? ' & cardio' : ''} this week, review before submitting`
            : prefill
              ? `Cardio prefilled from ${prefill.count} log${prefill.count !== 1 ? 's' : ''} this week`
              : `Prefilled from this week's training, review before submitting`}
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
      {photosEnabled && <div style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 7, padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <i className="fa-solid fa-camera" style={{ color: 'var(--accent)', fontSize: 13 }} />
          <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Photos for your coach</span>
        </div>
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.45, marginBottom: 9 }}>Optional. Up to 8 JPG, PNG or WebP images, 8 MB each.</div>
        <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={saving} onChange={e => {
          const next = Array.from(e.target.files || []).slice(0, Math.max(0, 8 - photos.length));
          setPhotos(prev => [...prev, ...next]); e.target.value = '';
        }} style={{ display: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Btn kind="ghost" type="button" onClick={() => photoInputRef.current?.click()} disabled={saving || photos.length >= 8}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 14px', minHeight: 42, fontSize: 11 }}>
            <i className="fa-solid fa-folder-open" aria-hidden="true" />
            Choose photos
          </Btn>
          <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>
            {photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'} selected` : 'No photos selected'}
          </span>
        </div>
        {photos.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
          {photos.map((file, i) => <div key={`${file.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
            <button type="button" disabled={saving} aria-label={`Remove ${file.name}`} onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))} style={{ width: 28, height: 28, borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkFaint, opacity: saving ? 0.45 : 1, cursor: saving ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, lineHeight: 1, WebkitTapHighlightColor: 'transparent' }}>×</button>
          </div>)}
        </div>}
      </div>}
      {error && <div style={{ fontSize: 12, color: 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>{error}</div>}
      <Btn onClick={handleSubmit} disabled={saving}>
        {saving ? 'Sending…' : existing ? 'Update Check-in' : 'Submit Check-in'}
      </Btn>
    </div>
  );
}

// ─── ClientCheckInTab ─────────────────────────────────────────────────────────

function ClientCheckInTab({ coachingId, clientId, userId, checkinEnabled = true, store, setStore, isSelf = false }) {
  // Gates the AI-opinion Retry affordance below; server-side (ai-checkin-opinion)
  // independently enforces the same bypass, this only keeps the button itself
  // from ever showing to someone it would 409 for.
  const isAdmin = store?.user?.email === 'office@btc-prime.biz';
  // Local, synchronous store mutations (mirrors workoutTemplates and the coach
  // view's identical handlers: syncStore's diff persists them on the next
  // flush, no dedicated RPC). Only reachable via the self-coaching builder
  // below (a real, non-self client never opens CheckInSchemaBuilder here).
  // existingId overwrites that template's name/schema in place instead of
  // creating a new one (used by the per-row "Update" action).
  const saveCheckinTemplate = (name, schemaToSave, existingId = null) => {
    if (existingId) {
      setStore(s => ({ ...s, checkinSchemaTemplates: (s.checkinSchemaTemplates || []).map(t =>
        t.id === existingId ? { ...t, name, schema: schemaToSave } : t) }));
      return;
    }
    const tpl = { id: LB.uid(), name, schema: schemaToSave, createdAt: new Date().toISOString() };
    setStore(s => ({ ...s, checkinSchemaTemplates: [tpl, ...(s.checkinSchemaTemplates || [])] }));
  };
  const deleteCheckinTemplate = (id) => {
    setStore(s => ({ ...s, checkinSchemaTemplates: (s.checkinSchemaTemplates || []).filter(t => t.id !== id) }));
  };
  const weekStartDay = LB.normalizeWeekStartDay(store?.settings?.weekStartDay);
  const weekStart = LB.checkinWeekStart(weekStartDay);
  // The configured last day is still part of the current week, so the form
  // opens from the boundary day onward. On that boundary day the preview shows
  // the newly started week while the submitted form covers the previous one.
  const canSubmitToday = !LB.reportingWeekEndsToday(new Date(), weekStartDay);
  const previewWeekStart = LB.reportingWeekStartISO(new Date(), weekStartDay);
  const reportingWeekLabel = (() => {
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return `${names[weekStartDay]}–${names[(weekStartDay + 6) % 7]}`;
  })();
  const { checkins, loadErr, setLoadErr, schema, setSchema, coachingMacrosHistory, load } = useCoachingCheckins(coachingId);
  const [photosEnabled, setPhotosEnabled] = useStateC(false);
  useEffectC(() => {
    let alive = true;
    setPhotosEnabled(false);
    // Self-coaching uses the same Drive archive as a coached client. The
    // earlier self guard made the photo picker unreachable even when the user
    // had enabled both archive switches for their own Drive.
    LB.getCoachingDrivePhotoStatus(coachingId)
      .then(result => { if (alive) setPhotosEnabled(result?.enabled === true); })
      .catch(() => { if (alive) setPhotosEnabled(false); });
    return () => { alive = false; };
  }, [coachingId, isSelf, userId]);
  const [editTarget, setEditTarget] = useStateC(null); // null = overview | 'new' | a check-in object
  const [confirmDelete, setConfirmDelete] = useStateC(null); // id of check-in awaiting delete confirm
  const [deleting, setDeleting] = useStateC(false);
  const [pastOpen, setPastOpen] = useStateC(false);
  const [builderOpen, setBuilderOpen] = useStateC(false);
  const [previewOpen, setPreviewOpen] = useStateC(false);
  // Check-in id with an AI-opinion generate request currently in flight.
  // Shared between CheckInAiOpinionBanner and this week's own CheckInCard
  // below: they're two independent "Generate" affordances for the SAME
  // check-in, and used to each track busy privately, letting a user fire
  // both concurrently (tap the banner, expand the card before it resolves,
  // tap again). One shared flag makes that impossible.
  const [generatingCheckinId, setGeneratingCheckinId] = useStateC(null);

  const thisWeek = (checkins || []).find(c => c.weekStart === weekStart);
  const past = (checkins || []).filter(c => c.weekStart !== weekStart);

  const handleDelete = async (ci) => {
    if (confirmDelete !== ci.id) {
      setConfirmDelete(ci.id);
      setTimeout(() => setConfirmDelete(c => c === ci.id ? null : c), 3000);
      return;
    }
    // `deleting` was set and never read, so a second tap on the confirm state
    // fired a second delete while the first was still in flight.
    if (deleting) return;
    setDeleting(true);
    try { await LB.deleteCheckin(ci.id, userId); await load(); }
    catch (e) { UI.alert(e.message || 'Could not delete check-in.'); }
    finally { setDeleting(false); setConfirmDelete(null); }
  };

  if (checkins === null && loadErr) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
        <div style={{ fontSize: 13, color: 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi, textAlign: 'center' }}>Couldn't load check-ins.</div>
        <button onClick={() => { setLoadErr(false); load(); }} style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, padding: '8px 16px', cursor: 'pointer', color: UI.ink, fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600 }}>Retry</button>
      </div>
    );
  }
  if (checkins === null) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.1em' }}>LOADING…</div></div>;
  }

  // A real coached client must never fall back to their OWN default schema (the
  // coach can't see it, so the two sides would diverge). The coach's default is
  // stamped onto the coaching row when set, so a null row means the built-in
  // default on both sides. Only self-coaching legitimately uses the own default
  // (self rows are excluded from the coach-side stamping).
  const resolvedSchema = schema || (isSelf ? store?.settings?.defaultCheckinSchema : null) || CHECKIN_DEFAULT_SCHEMA;

  // Preview: build a fake check-in from the current training week's accumulated data
  const previewDailyPrefill = LB.dailyLogsWeekPrefill(store?.dailyLogs, previewWeekStart, store?.sessions, resolvedSchema);
  const previewCardioPrefill = LB.cardioWeekPrefill(store?.cardioLogs, previewWeekStart);
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
              ? <>Week of <strong>{fmtWeek(formWeek)}</strong>. Covers {reportingWeekLabel} of last week.</>
              : <>Editing <strong>week of {fmtWeek(formWeek)}</strong>. The change is logged to your coach.</>}
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
          dailyPrefill={!target ? LB.dailyLogsWeekPrefill(store?.dailyLogs, formWeek, store?.sessions, resolvedSchema) : undefined}
          perfPrefill={!target ? LB.weekPerformanceSignal(store, formWeek) : undefined}
          onSaved={() => { setEditTarget(null); load(); }}
          schema={resolvedSchema}
          photosEnabled={photosEnabled}
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
          onClose={() => setBuilderOpen(false)}
          templates={store.checkinSchemaTemplates}
          onSaveTemplate={saveCheckinTemplate}
          onDeleteTemplate={deleteCheckinTemplate} />
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ padding: '16px 14px 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!thisWeek && checkinEnabled && canSubmitToday && (
            <button onClick={() => setEditTarget('new')}
              style={{ flex: 1, background: `rgba(var(--accent-rgb),0.12)`, border: `var(--hair-width) solid rgba(var(--accent-rgb),0.4)`, borderRadius: 6, padding: '12px 14px', cursor: 'pointer', color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>
              Submit this week's check-in
            </button>
          )}
          {/* The reporting week's last day only (!canSubmitToday). The preview
              shows previewWeekStart, the CURRENT in-progress week, which is
              independent of weekStart's submission status, so it must NOT be
              gated on !thisWeek. */}
          {checkinEnabled && !canSubmitToday && previewResponses && (
            <button onClick={() => setPreviewOpen(v => !v)}
              style={{ flex: 1, background: previewOpen ? `rgba(var(--accent-rgb),0.18)` : `rgba(var(--accent-rgb),0.11)`, border: `var(--hair-width) solid rgba(var(--accent-rgb),0.25)`, borderRadius: 6, textShadow: 'none', padding: '12px 14px', cursor: 'pointer', color: previewOpen ? 'var(--accent)' : UI.inkSoft, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>
              {previewOpen ? 'Close preview' : 'Preview this week'}
            </button>
          )}
          {previewResponses && canSubmitToday && LB.isoWd(new Date()) !== weekStartDay && (
            <button onClick={() => setPreviewOpen(v => !v)}
              style={{ background: previewOpen ? `rgba(var(--accent-rgb),0.22)` : UI.bgInset, border: `${previewOpen ? '1.5px' : 'var(--hair-width)'} solid ${previewOpen ? 'var(--accent)' : UI.hairStrong}`, borderRadius: 6, textShadow: 'none', padding: '11px 13px', cursor: 'pointer', color: previewOpen ? 'var(--accent)' : UI.inkFaint, fontSize: 15, lineHeight: 1, flexShrink: 0 }}>
              <i className="fa-solid fa-eye" />
            </button>
          )}
          {isSelf && (
            <button onClick={() => setBuilderOpen(true)}
              style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, textShadow: 'none', padding: '11px 13px', cursor: 'pointer', color: UI.inkFaint, fontSize: 15, lineHeight: 1, flexShrink: 0 }}>
              <i className="fa-solid fa-sliders" />
            </button>
          )}
        </div>

        {thisWeek && (
          <CheckInAiOpinionBanner
            ci={thisWeek}
            busy={generatingCheckinId === thisWeek.id}
            onGenerateStart={() => setGeneratingCheckinId(thisWeek.id)}
            onGenerateError={() => setGeneratingCheckinId(null)}
            onGenerated={() => { setGeneratingCheckinId(null); load(); }}
            isAdmin={isAdmin}
          />
        )}

        {previewOpen && previewResponses && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.07em', textTransform: 'uppercase' }}>In progress, data still accumulating</span>
            </div>
            <CheckInCard
              ci={{ weekStart: previewWeekStart, responses: previewResponses }}
              prevCi={checkins[0]}
              schema={resolvedSchema}
              defaultOpen={true}
              embedded={true}
              coachingMacrosHistory={coachingMacrosHistory}
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
          <div style={{ background: UI.bgInset, borderRadius: 8, padding: '11px 14px', border: `var(--hair-width) solid ${UI.hair}` }}>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>Check-ins are currently paused by your coach.</div>
          </div>
        )}
        {thisWeek ? (
          <CheckInCard
            ci={thisWeek} prevCi={past[0]} schema={resolvedSchema}
            onEdit={checkinEnabled ? () => setEditTarget(thisWeek) : undefined}
            onDelete={checkinEnabled && !deleting ? () => handleDelete(thisWeek) : undefined}
            confirmingDelete={confirmDelete === thisWeek.id}
            coachingMacrosHistory={coachingMacrosHistory}
            busy={generatingCheckinId === thisWeek.id}
            onGenerateStart={() => setGeneratingCheckinId(thisWeek.id)}
            onGenerateError={() => setGeneratingCheckinId(null)}
            onGenerated={() => { setGeneratingCheckinId(null); load(); }}
            isAdmin={isAdmin}
          />
        ) : null}

        {past.length > 0 && (
          <div style={{ background: UI.bgInset, borderRadius: 8, border: `var(--hair-width) solid ${UI.hair}`, overflow: 'hidden' }}>
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
                  <div key={ci.id} style={{ borderTop: `var(--hair-width) solid ${UI.hair}` }}>
                    <CheckInCard ci={ci} prevCi={past[past.indexOf(ci) + 1]} schema={resolvedSchema} embedded onEdit={checkinEnabled ? () => setEditTarget(ci) : undefined} onDelete={checkinEnabled && !deleting ? () => handleDelete(ci) : undefined} confirmingDelete={confirmDelete === ci.id} coachingMacrosHistory={coachingMacrosHistory} onGenerated={load} isAdmin={isAdmin} />
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
  const todayStr = LB.todayISO();
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
      position: localViewportLayerPosition(), top: 0, right: 0, bottom: 0, left: 0,
      zIndex: 9000, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: UI.bg, backgroundImage: 'var(--bg-texture)', border: `1px solid ${UI.hairStrong}`,
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
            borderRadius: 6, textShadow: 'none', fontSize: 15, fontWeight: 700, color: 'var(--accent-ink)',
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
// Client's coaching tab, messages + nutrition + check-in.

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
    // Same split as CoachingPendingBanner.respond (screens-coaching-core.jsx):
    // once endCoaching succeeds the relationship is over server-side, and a
    // failed refresh must not leave this tab rendering the ended coach as
    // active with their data still on screen.
    try {
      await LB.endCoaching(coaching.id);
    } catch (e) {
      UI.alert(e.message);
      setEnding(false);
      return;
    }
    try {
      const newCoaching = await LB.reloadCoachingState(userId);
      setStore(s => s ? { ...s, coaching: { ...newCoaching, anyClientLive: s.coaching?.anyClientLive, pendingCheckinsCount: s.coaching?.pendingCheckinsCount } } : s);
    } catch (_) {
      setStore(s => s ? { ...s, coaching: { ...(s.coaching || {}), asClient: null } } : s);
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
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', background: UI.bgInset, borderBottom: `var(--hair-width) solid ${UI.hair}`, flexShrink: 0 }}>
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
      <div style={{ display: 'flex', borderBottom: `var(--hair-width) solid ${UI.hair}`, background: UI.bg, flexShrink: 0 }}>
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
          <ClientCheckInTab coachingId={coaching.id} clientId={userId} userId={userId} checkinEnabled={coaching.checkinEnabled ?? true} store={store} setStore={setStore} />
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
  const [loadErr, setLoadErr] = useStateC(false);

  const load = () => {
    setLoading(true); setLoadErr(false);
    LB.loadCoachingMacros(coachingId)
      .then(data => setMacros(data[0] || null))
      .catch(() => setLoadErr(true))
      .finally(() => setLoading(false));
  };
  useEffectC(() => { load(); }, [coachingId]);

  if (loading) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.1em' }}>LOADING…</div></div>;
  }

  // Distinguish a failed load from a genuine "coach set nothing": the empty
  // state below asserts the coach hasn't added targets, which is wrong on error.
  if (loadErr) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
        <i className="fa-solid fa-utensils" style={{ fontSize: 28, color: UI.inkGhost }} />
        <div style={{ fontSize: 13, color: 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi, textAlign: 'center' }}>Couldn't load macro targets.</div>
        <button onClick={load} style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, textShadow: 'none', padding: '8px 16px', cursor: 'pointer', color: UI.ink, fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600 }}>Retry</button>
      </div>
    );
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
    <div style={{ background: UI.bgInset, borderRadius: 8, padding: '16px 18px', border: `var(--hair-width) solid ${UI.hair}` }}>
      <div className="micro-gold" style={{ marginBottom: 12 }}>{label}</div>
      {calories != null && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 14 }}>
          <span className="num" style={{ fontSize: 32, color: UI.ink, fontWeight: 300 }}>{calories}</span>
          <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>kcal</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        {[{ label: 'Protein', value: protein }, { label: 'Carbs', value: carbs }, { label: 'Fat', value: fat }].map(m => (
          <div key={m.label} style={{ flex: 1, background: UI.bgRaised, borderRadius: 6, padding: '10px 8px', textAlign: 'center', border: `var(--hair-width) solid ${UI.hair}` }}>
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
  CoachClientScreen,
  CoachPlanEditorScreen,
  CoachNewPlanScreen,
  CoachingTabScreen,
});
