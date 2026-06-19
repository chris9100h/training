/* Settings screen — appearance, training, data, account, admin */

const { useState: useStateSet, useEffect: useEffectSet, useRef: useRefSet } = React;

// ─── Shared helpers ────────────────────────────────────────────────────

const fmtSec = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Short "time since" label for the admin sign-up feed.
const fmtAgo = (iso) => {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

function Toggle({ on, onToggle }) {
  return (
    <div onClick={onToggle} style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0, background: on ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${on ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`, position: 'relative', transition: 'background 0.18s', WebkitTapHighlightColor: 'transparent' }}>
      <div style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: on ? '#0a0805' : UI.inkFaint, transition: 'left 0.18s' }} />
    </div>
  );
}

function Row({ label, children, first = false }) {
  return (
    <>
      {!first && <div className="knurl" />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 0' }}>
        <span style={{ fontSize: 16, color: UI.inkSoft, fontFamily: UI.fontUi }}>{label}</span>
        {children}
      </div>
    </>
  );
}

function NavRow({ label, hint, onTap, first = false, accent = false }) {
  return (
    <>
      {!first && <div className="knurl" />}
      <button onClick={onTap} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', WebkitTapHighlightColor: 'transparent' }}>
        <span style={{ fontSize: 16, color: accent ? 'var(--accent)' : UI.inkSoft, fontFamily: UI.fontUi, fontWeight: accent ? 600 : 400 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hint != null && <span style={{ fontSize: 13, color: accent ? 'var(--accent)' : UI.inkFaint, fontFamily: UI.fontUi }}>{hint}</span>}
          <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={accent ? 'var(--accent)' : UI.inkFaint} strokeWidth="1.3" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>
        </div>
      </button>
    </>
  );
}

const accentBtn = { background: 'rgba(var(--accent-rgb),0.10)', border: '0.5px solid rgba(var(--accent-rgb),0.22)', color: 'var(--accent)', padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent', flexShrink: 0 };

// Every settings sheet renders its title in the accent color.
function SettingsSheet(props) {
  return <Sheet titleColor="var(--accent)" {...props} />;
}

// ─── HOW TO SHEET ────────────────────────────────────────────────────
function HowToSheet({ open, onClose }) {
  return (
    <SettingsSheet open={open} onClose={onClose} title="How to…">
      <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
        <button onClick={() => { onClose(); window.__startTour?.('createPlan'); }} style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 0', WebkitTapHighlightColor: 'transparent',
        }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Create a plan &amp; exercise</div>
            <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Guided tour of plan creation and the training loop</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={UI.inkFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div className="knurl" />
        <button onClick={() => { onClose(); window.__startTour?.('doWorkout'); }} style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 0', WebkitTapHighlightColor: 'transparent',
        }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Do a workout</div>
            <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Logging sets, keyboard, plate calc, navigation and ending a session</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={UI.inkFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div className="knurl" />
        <button onClick={() => { onClose(); window.__startTour?.('healthTab'); }} style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 0', WebkitTapHighlightColor: 'transparent',
        }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Use the Health tab</div>
            <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Daily logging, macro targets, cardio tracking, and week overview</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={UI.inkFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div className="knurl" />
        <button onClick={() => { onClose(); window.__startTour?.('coaching'); }} style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 0', WebkitTapHighlightColor: 'transparent',
        }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Be a coach / client</div>
            <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Invites, weekly check-ins, macros and notes — coach and client side</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={UI.inkFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </SettingsSheet>
  );
}

// ─── CHANGELOG SHEET ─────────────────────────────────────────────────
function ChangelogSheet({ open, onClose }) {
  const [selected, setSelected] = useStateSet(null);
  const handleClose = () => { onClose(); setSelected(null); };
  return (
    <>
      <SettingsSheet open={open} onClose={handleClose} title="Changelog">
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
          {(window.WHATS_NEW || []).map((entry, i) => (
            <div key={entry.id}>
              <button onClick={() => setSelected(entry)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', WebkitTapHighlightColor: 'transparent' }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span className="micro" style={{ color: UI.inkFaint }}>{entry.id}</span>
                  <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.3" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>
                </div>
              </button>
              {i < (window.WHATS_NEW || []).length - 1 && <div className="knurl" />}
            </div>
          ))}
        </div>
      </SettingsSheet>
      <SettingsSheet open={!!selected} onClose={() => setSelected(null)} title={selected?.title || ''}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8 }}>
          {(selected?.items || []).map((item, j) => (
            <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--accent)', fontSize: 11, marginTop: 3, flexShrink: 0 }}>•</span>
              <span style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.55 }}>{item}</span>
            </div>
          ))}
        </div>
      </SettingsSheet>
    </>
  );
}

// ─── PASSKEY SHEET ───────────────────────────────────────────────────
function PasskeySheet({ open, onClose }) {
  const [confirmEl, confirm] = useConfirm();
  const [passkeys, setPasskeys] = useStateSet([]);
  const [loadingList, setLoadingList] = useStateSet(false);
  const [adding, setAdding] = useStateSet(false);
  const [deletingId, setDeletingId] = useStateSet(null);
  const [error, setError] = useStateSet('');
  const [successMsg, setSuccessMsg] = useStateSet('');

  const flash = (msg, isError = false) => {
    if (isError) setError(msg); else setSuccessMsg(msg);
    setTimeout(() => { setError(''); setSuccessMsg(''); }, 3500);
  };

  const loadPasskeys = async () => {
    setLoadingList(true);
    try {
      const list = await LB.listPasskeys();
      setPasskeys(list);
    } catch (e) {
      flash(e.message || 'Failed to load passkeys', true);
    } finally {
      setLoadingList(false);
    }
  };

  useEffectSet(() => {
    if (open) loadPasskeys();
    else { setPasskeys([]); setError(''); setSuccessMsg(''); }
  }, [open]);

  const handleAdd = async () => {
    if (adding) return;
    setAdding(true); setError('');
    try {
      await LB.registerPasskey();
      flash('Passkey added!');
      loadPasskeys();
    } catch (e) {
      flash(e.message || 'Failed to add passkey', true);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (deletingId) return;
    const ok = await confirm(`Remove "${name || 'Passkey'}"? You won't be able to sign in with it anymore.`, { ok: 'Remove', danger: true });
    if (!ok) return;
    setDeletingId(id);
    try {
      await LB.deletePasskey(id);
      setPasskeys(prev => prev.filter(p => p.id !== id));
      flash('Passkey removed');
    } catch (e) {
      flash(e.message || 'Failed to remove passkey', true);
    } finally {
      setDeletingId(null);
    }
  };

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <SettingsSheet open={open} onClose={onClose} title="Passkeys">
      {confirmEl}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <button onClick={handleAdd} disabled={adding} style={{
          width: '100%', padding: '12px 0', borderRadius: 6,
          background: 'rgba(var(--accent-rgb),0.10)', border: '0.5px solid rgba(var(--accent-rgb),0.25)',
          color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
          cursor: adding ? 'default' : 'pointer', opacity: adding ? 0.6 : 1,
          WebkitTapHighlightColor: 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {adding ? 'Adding…' : 'Add passkey for this device'}
        </button>

        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 8, marginBottom: 20, lineHeight: 1.5 }}>
          Each device needs its own passkey — Face ID, Touch ID or device PIN.
        </div>

        {(error || successMsg) && (
          <div style={{ fontSize: 12, color: error ? UI.danger : UI.gold, fontFamily: UI.fontUi, marginBottom: 12, padding: '8px 12px', background: error ? 'rgba(var(--danger-rgb),0.06)' : 'rgba(var(--accent-rgb),0.08)', borderRadius: 6 }}>
            {error || successMsg}
          </div>
        )}

        {loadingList ? (
          <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '16px 0' }}>Loading…</div>
        ) : passkeys.length === 0 ? (
          <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '16px 0' }}>No passkeys registered yet</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>Registered passkeys</div>
            {passkeys.map((pk, i) => (
              <React.Fragment key={pk.id}>
                {i > 0 && <div className="knurl" />}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
                  <div>
                    <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 500 }}>
                      {pk.friendly_name || 'Passkey'}
                    </div>
                    <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>
                      Added {fmtDate(pk.created_at)}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(pk.id, pk.friendly_name)} disabled={!!deletingId} style={{
                    background: 'rgba(var(--danger-rgb),0.08)', border: '0.5px solid rgba(var(--danger-rgb),0.2)',
                    color: UI.danger, borderRadius: 6, padding: '5px 12px',
                    fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                    cursor: deletingId ? 'default' : 'pointer', opacity: deletingId === pk.id ? 0.5 : 1,
                    WebkitTapHighlightColor: 'transparent', flexShrink: 0,
                  }}>
                    {deletingId === pk.id ? '…' : 'Remove'}
                  </button>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </SettingsSheet>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────
function SettingsScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [nickname, setNickname] = useStateSet(store.user?.name || '');

  // Category sheets
  const [coachingSheet, setCoachingSheet] = useStateSet(false);
  const [healthSheet, setHealthSheet] = useStateSet(false);
  const [accountSheet, setAccountSheet] = useStateSet(false);
  const [trainingSheet, setTrainingSheet] = useStateSet(false);
  const [appearanceSheet, setAppearanceSheet] = useStateSet(false);
  const [dataSheet, setDataSheet] = useStateSet(false);
  const [changelogSheet, setChangelogSheet] = useStateSet(false);
  const [activeUsersSheet, setActiveUsersSheet] = useStateSet(false);
  const [howToSheet, setHowToSheet] = useStateSet(false);

  // Training sub-sheets
  const [restSheet, setRestSheet] = useStateSet(false);
  const [timeoutSheet, setTimeoutSheet] = useStateSet(false);
  const [paceguardSheet, setPaceguardSheet] = useStateSet(false);
  const [progressionSheet, setProgressionSheet] = useStateSet(false);
  const [progConfigOpen, setProgConfigOpen] = useStateSet(false);
  const [plateInventoryOpen, setPlateInventoryOpen] = useStateSet(false);
  const [plateInvTab, setPlateInvTab] = useStateSet(() => UI.unit() === 'lbs' ? 1 : 0);
  const [progDisclaimer, setProgDisclaimer] = useStateSet(false);
  const [activeSessions, setActiveSessions] = useStateSet([]);
  const [qsSwitching, setQsSwitching] = useStateSet(false);
  const [activeGrants, setActiveGrants] = useStateSet([]);
  const [newGrantEmail, setNewGrantEmail] = useStateSet('');
  const [pendingUsers, setPendingUsers] = useStateSet([]);
  const [approvingId, setApprovingId] = useStateSet(null);
  const [decliningId, setDecliningId] = useStateSet(null);
  const [hasActiveUsersAccess, setHasActiveUsersAccess] = useStateSet(
    () => localStorage.getItem('logbook-active-users-access') === 'true'
  );
  const [signupApproval, setSignupApproval] = useStateSet(null); // null = loading, bool = current
  const [autoApproveLeft, setAutoApproveLeft] = useStateSet(null); // null = no batch budget, int = remaining
  const [budgetSheet, setBudgetSheet] = useStateSet(false);
  const [budgetDraft, setBudgetDraft] = useStateSet(20);
  const [recentSignups, setRecentSignups] = useStateSet([]);
  const [signupsSheet, setSignupsSheet] = useStateSet(false);
  const [seenSignups, setSeenSignups] = useStateSet(() => {
    try { return new Set(JSON.parse(localStorage.getItem('logbook-seen-signups') || '[]')); } catch (_) { return new Set(); }
  });
  const [nowS, setNowS] = useStateSet(Date.now());
  const [importing, setImporting] = useStateSet(false);
  const [swVersion, setSwVersion] = useStateSet('');
  const [pushStatus, setPushStatus] = useStateSet(null);
  const [pushEnabled, setPushEnabled] = useStateSet(() => store.settings?.pushEnabled ?? localStorage.getItem('logbook-push-enabled') === 'true');
  const [pushKeyDraft, setPushKeyDraft] = useStateSet('');
  const [testPickerOpen, setTestPickerOpen] = useStateSet(false);
  const [advancedPushSheet, setAdvancedPushSheet] = useStateSet(false);
  const [pushoverStep, setPushoverStep] = useStateSet('idle'); // 'idle'|'entering-key'|'code-sent'
  const [pendingCode, setPendingCode] = useStateSet('');
  const [codeInput, setCodeInput] = useStateSet('');
  const [verifyLoading, setVerifyLoading] = useStateSet(false);
  const [pushSheet, setPushSheet] = useStateSet(false);
  const [webPushSub, setWebPushSub] = useStateSet(null);
  const [webPushLoading, setWebPushLoading] = useStateSet(false);
  const [reminderSheet, setReminderSheet] = useStateSet(false);
  const [passkeySheet, setPasskeySheet] = useStateSet(false);
  const [reminderEnabled, setReminderEnabled] = useStateSet(() => store.settings?.reminderEnabled ?? false);
  const [reminderTime, setReminderTime] = useStateSet(() => store.settings?.reminderTime ?? '07:00');
  const [cycleWeekView, setCycleWeekView] = useStateSet(() => store.settings?.cycleWeekView ?? localStorage.getItem('logbook-cycle-week-view') === 'true');
  const [darkMode, setDarkMode] = useStateSet(() => store.settings?.darkMode ?? localStorage.getItem('logbook-dark-mode') ?? 'dark');
  const [showWarmupInSummary, setShowWarmupInSummary] = useStateSet(() => store.settings?.showWarmupInSummary ?? true);
  const [unitPickerOpen, setUnitPickerOpen] = useStateSet(false);
  const [adminBgPreview, setAdminBgPreview] = useStateSet(
    () => localStorage.getItem('logbook-admin-bg-preview') || 'standard'
  );
  const [bgPreviewSheet, setBgPreviewSheet] = useStateSet(false);
  const [adminSheet, setAdminSheet] = useStateSet(false);
  const isAdmin = store.user?.email === 'office@btc-prime.biz';

  useEffectSet(() => {
    let mounted = true;
    LB.supabase.rpc('check_active_users_access')
      .then(({ data }) => { const val = !!data; localStorage.setItem('logbook-active-users-access', String(val)); if (mounted) setHasActiveUsersAccess(val); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffectSet(() => {
    if (!hasActiveUsersAccess) return;
    let mounted = true;
    const loadSessions = () => LB.supabase.rpc('get_active_sessions_overview').then(({ data }) => { if (mounted) setActiveSessions(data || []); }).catch(() => {});
    const loadGrants = () => LB.supabase.rpc('get_active_users_grants').then(({ data }) => { if (mounted) setActiveGrants((data || []).map(r => r.email)); }).catch(() => {});
    const loadPending = () => LB.supabase.rpc('get_pending_users').then(({ data }) => { if (mounted) setPendingUsers(data || []); }).catch(() => {});
    loadSessions(); if (isAdmin) { loadGrants(); loadPending(); }
    const iv = setInterval(() => { loadSessions(); setNowS(Date.now()); }, 2000);
    return () => { mounted = false; clearInterval(iv); };
  }, [hasActiveUsersAccess, isAdmin]);

  useEffectSet(() => {
    if (!('caches' in window)) return;
    caches.keys().then(keys => { const name = keys.find(k => k.startsWith('zane-')); if (name) setSwVersion(name.replace('zane-', '')); });
  }, []);

  useEffectSet(() => {
    if (!pushSheet) return;
    LB.getWebPushSubscription().then(sub => setWebPushSub(sub)).catch(() => {});
  }, [pushSheet]);

  // Admin-only: current global "signups need approval" setting.
  useEffectSet(() => {
    if (!isAdmin) return;
    let mounted = true;
    LB.supabase.rpc('get_signup_config').then(({ data, error }) => {
      if (!mounted || error) return;
      const row = Array.isArray(data) ? data[0] : data;
      setSignupApproval(row ? row.requires_approval !== false : true);
      setAutoApproveLeft(row ? (row.auto_approve_remaining ?? null) : null);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [isAdmin, accountSheet]);

  // Admin-only: recent sign-ups feed. Reloaded each time the Account sheet opens.
  useEffectSet(() => {
    if (!isAdmin || !accountSheet) return;
    let mounted = true;
    LB.supabase.rpc('get_recent_signups', { p_limit: 50 }).then(({ data, error }) => { if (mounted && !error) setRecentSignups(data || []); }).catch(() => {});
    return () => { mounted = false; };
  }, [isAdmin, accountSheet]);

  const markSignupSeen = (uid) => {
    setSeenSignups(prev => {
      const next = new Set(prev); next.add(uid);
      try { localStorage.setItem('logbook-seen-signups', JSON.stringify([...next])); } catch (_) {}
      return next;
    });
  };

  const toggleSignupApproval = async () => {
    const next = !signupApproval;
    setSignupApproval(next);
    setAutoApproveLeft(null); // manual toggle clears any batch budget
    const { error } = await LB.supabase.rpc('set_signup_requires_approval', { p_value: next });
    if (error) { setSignupApproval(!next); await confirm(error.message || 'Could not update this setting.', { title: 'Update failed', ok: 'OK' }); }
  };

  const saveBudget = async () => {
    const n = budgetDraft;
    setBudgetSheet(false);
    setSignupApproval(n <= 0);            // n>0 → open for a batch; n<=0 → re-lock now
    setAutoApproveLeft(n > 0 ? n : null);
    const { error } = await LB.supabase.rpc('set_auto_approve_budget', { p_count: n });
    if (error) await confirm(error.message || 'Could not update this setting.', { title: 'Update failed', ok: 'OK' });
  };

  const approveUser = async (uid) => {
    setApprovingId(uid);
    try {
      const { error } = await LB.supabase.rpc('approve_user', { p_user_id: uid });
      if (error) { await confirm(error.message || 'Could not approve this user.', { title: 'Approve failed', ok: 'OK' }); return; }
      setPendingUsers(u => u.filter(x => x.user_id !== uid));
    } finally {
      setApprovingId(null);
    }
  };

  const declineUser = async (uid) => {
    setDecliningId(uid);
    try {
      const { error } = await LB.supabase.rpc('decline_user', { p_user_id: uid });
      if (error) { await confirm(error.message || 'Could not decline this user.', { title: 'Decline failed', ok: 'OK' }); return; }
      setPendingUsers(u => u.filter(x => x.user_id !== uid));
    } finally {
      setDecliningId(null);
    }
  };

  const addGrant = async () => {
    const email = newGrantEmail.trim().toLowerCase();
    if (!email.includes('@') || activeGrants.includes(email)) return;
    const { error } = await LB.supabase.rpc('set_active_users_grant', { p_email: email, p_granted: true });
    if (error) { await confirm(error.message || 'Could not add this grant.', { title: 'Grant failed', ok: 'OK' }); return; }
    setActiveGrants(g => [...g, email]); setNewGrantEmail('');
  };
  const removeGrant = async (email) => {
    const { error } = await LB.supabase.rpc('set_active_users_grant', { p_email: email, p_granted: false });
    if (error) { await confirm(error.message || 'Could not remove this grant.', { title: 'Grant failed', ok: 'OK' }); return; }
    setActiveGrants(g => g.filter(x => x !== email));
  };

  const pushStatusTimer = useRefSet(null);
  useEffectSet(() => () => clearTimeout(pushStatusTimer.current), []);
  const togglePush = async () => {
    if (webPushLoading) return;
    setWebPushLoading(true);
    try {
      if (!pushEnabled) {
        const sub = await LB.subscribeWebPush(userId);
        setWebPushSub(sub);
        setPushEnabled(true); localStorage.setItem('logbook-push-enabled', 'true');
        setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: true } }));
      } else {
        await LB.unsubscribeWebPush(userId);
        setWebPushSub(null);
        setPushEnabled(false); localStorage.setItem('logbook-push-enabled', 'false');
        setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: false } }));
      }
    } catch (e) {
      clearTimeout(pushStatusTimer.current);
      const msg = e.message?.toLowerCase() ?? '';
      setPushStatus(msg.includes('denied') || msg.includes('permission')
        ? 'Permission denied — enable notifications in browser settings'
        : `Error: ${e.message}`);
      pushStatusTimer.current = setTimeout(() => setPushStatus(null), 7000);
    } finally {
      setWebPushLoading(false);
    }
  };
  const PUSHOVER_VERIFY_URL = `${LB.SUPABASE_URL}/functions/v1/pushover-verify`;
  const closeAdvanced = () => { setAdvancedPushSheet(false); setPushoverStep('idle'); setPushKeyDraft(''); setCodeInput(''); setPendingCode(''); };
  const sendVerificationCode = async () => {
    setVerifyLoading(true);
    clearTimeout(pushStatusTimer.current);
    try {
      const res = await LB.fnFetch(PUSHOVER_VERIFY_URL, { userKey: pushKeyDraft.trim() });
      if (!res?.ok) { const d = await res?.json().catch(() => ({})); setPushStatus(`Error: ${d?.error || 'send failed'}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
      const { code } = await res.json();
      setPendingCode(code);
      setPushoverStep('code-sent');
    } catch (e) { setPushStatus(`Error: ${e.message}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
    finally { setVerifyLoading(false); }
  };
  const verifyCode = () => {
    if (codeInput.trim() !== pendingCode) { setPushStatus('Incorrect code — check the Pushover notification'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
    setStore(s => ({ ...s, settings: { ...s.settings, pushoverUserKey: pushKeyDraft.trim(), usePushover: true } }));
    setPushoverStep('idle'); setPendingCode(''); setCodeInput(''); setPushKeyDraft('');
    setPushStatus('✓ Pushover active'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 4000);
  };
  const disablePushover = () => {
    setStore(s => ({ ...s, settings: { ...s.settings, pushoverUserKey: null, usePushover: false } }));
    setPushoverStep('idle');
  };
  const testWebPush = async () => {
    clearTimeout(pushStatusTimer.current);
    setPushStatus('Sending…');
    try {
      const res = await LB.fnFetch(LB.WEB_PUSH_URL, { title: 'Zane Test', message: 'Notifications are working! 💪' });
      if (!res) { setPushStatus('Error: not signed in'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
      const data = await res.json().catch(() => ({}));
      if (res.status === 202 || data.scheduled) { setPushStatus('✓ Sent'); }
      else if (data.skipped) { setPushStatus('No subscription found — try toggling push off and on'); }
      else { setPushStatus(`Error: ${JSON.stringify(data)}`); }
    } catch (e) { setPushStatus(`Error: ${e.message}`); }
    pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
  };
  const testRestTimer = async (delaySeconds = 0) => {
    clearTimeout(pushStatusTimer.current);
    setPushStatus(delaySeconds > 0 ? 'Sending… Lock screen now!' : 'Sending…');
    const nonce = String(Date.now());
    const title = 'Zane Test';
    const message = 'Rest done — keep going! 💪';
    const usesPushover = !!(store.settings?.pushoverUserKey && store.settings?.usePushover);
    try {
      if (usesPushover) {
        const res = await LB.fnFetch(LB.PUSHOVER_URL, { message, title, delaySeconds, nonce, ttl: 10 });
        if (!res) { setPushStatus('Error: not signed in'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
        if (res.status === 202) { setPushStatus(`✓ Scheduled — notification in ~${delaySeconds}s`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), (delaySeconds + 15) * 1000); }
        else { const data = await res.json().catch(() => ({})); setPushStatus(data.skipped ? 'Key not synced yet — try again' : `Error: ${JSON.stringify(data)}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
      } else {
        const res = await LB.fnFetch(LB.WEB_PUSH_URL, { title, message, delaySeconds, nonce });
        if (!res) { setPushStatus('Error: not signed in'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
        if (res.status === 202) { setPushStatus(`✓ Scheduled — notification in ~${delaySeconds}s`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), (delaySeconds + 15) * 1000); }
        else { const data = await res.json().catch(() => ({})); setPushStatus(`Error: ${JSON.stringify(data)}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
      }
    } catch (e) { setPushStatus(`Error: ${e.message}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
  };
  const toggleReminder = () => { const next = !reminderEnabled; setReminderEnabled(next); setStore(s => ({ ...s, settings: { ...s.settings, reminderEnabled: next } })); };
  const updateReminderTime = (val) => { setReminderTime(val); setStore(s => ({ ...s, settings: { ...s.settings, reminderTime: val } })); };
  const saveNickname = () => { const t = nickname.trim(); if (!t || t === store.user?.name) return; setStore(s => ({ ...s, user: { ...s.user, name: t } })); };
  const exportData = async (filename) => {
    const backup = await LB.exportBackup(store, userId);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename || `zane-${LB.todayISO()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importData = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      let backup; try { backup = JSON.parse(await file.text()); } catch (_) { await confirm('The selected file is not valid JSON.', { title: 'Invalid file', ok: 'OK' }); return; }
      const invalid = LB.validateBackup(backup);
      if (invalid) { await confirm(invalid, { title: 'Invalid backup', ok: 'OK' }); return; }
      const latestSession = [...(backup.sessions || [])].filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0];
      const backupDate = latestSession ? new Date(latestSession.ended).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : 'unknown date';
      const ok = await confirm(`This backup contains data up to ${backupDate}. Your current data will be downloaded first, then replaced.`, { title: 'Restore backup?', ok: 'Restore', danger: true });
      if (!ok) return;
      await exportData(`zane-before-import-${LB.todayISO()}.json`); setImporting(true);
      try { await LB.importFromBackup(backup, userId); LB.clearLocal(userId); window.location.reload(); }
      catch (err) { setImporting(false); await confirm(`Import failed: ${err.message || 'Unknown error'}`, { title: 'Error', ok: 'OK' }); }
    }; input.click();
  };
  const handleSignOut = async () => { await LB.signOut(); };
  const handleDeleteAll = async () => {
    if (!await confirm('This action cannot be undone.', { title: 'Delete all data?', ok: 'Delete all', danger: true })) return;
    await LB.deleteAllData(userId); await LB.signOut();
  };

  // QS
  const currentEmail = store.user?.email || '';
  const otherQsEmail = LB.QS_EMAILS.find(e => e !== currentEmail);
  const isQsUser = LB.QS_EMAILS.includes(currentEmail) && !!otherQsEmail;
  const hasQsSession = isQsUser ? LB.hasQuickSwitchSession(otherQsEmail) : false;
  const currentName = store.user?.name || currentEmail.split('@')[0];
  const otherName = isQsUser ? (LB.getQsName(otherQsEmail) || otherQsEmail.split('@')[0]) : '';

  // Coaching derived values
  const hasCoaching = !!((store.coaching?.asCoach || []).filter(c => c.status === 'active').length > 0 || store.coaching?.asClient?.status === 'active');
  const selfOn = !!store.settings?.beYourOwnCoach;
  const coachingTabOn = !!(store.settings?.showCoachingTab || hasCoaching || selfOn);

  const toggleTab = () => {
    const turningOff = coachingTabOn;
    setStore(s => ({ ...s, settings: { ...s.settings, showCoachingTab: !coachingTabOn, ...(turningOff ? { beYourOwnCoach: false } : {}) } }));
  };
  const toggleSelf = async () => {
    const next = !selfOn;
    setStore(s => ({ ...s, settings: { ...s.settings, beYourOwnCoach: next } }));
    if (next) {
      try {
        await LB.enableSelfCoaching();
        const cs = await LB.reloadCoachingState(userId);
        setStore(s => s ? { ...s, coaching: cs } : s);
      } catch (e) {
        setStore(s => ({ ...s, settings: { ...s.settings, beYourOwnCoach: false } }));
      }
    } else {
      const selfId = store.coaching?.asSelf?.id;
      if (selfId) {
        try {
          await LB.endCoaching(selfId);
          const cs = await LB.reloadCoachingState(userId);
          setStore(s => s ? { ...s, coaching: cs } : s);
        } catch (e) {
          setStore(s => ({ ...s, settings: { ...s.settings, beYourOwnCoach: true } }));
        }
      }
    }
  };

  const activeCount = activeSessions.filter(s => !s.is_finished).length;

  return (
    <Screen>
      <TopBar title="Settings" onBack={() => go({ name: 'home' })} />
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* ─── User ─── */}
        <Frame style={{ padding: '12px 14px' }}>
          <div className="micro" style={{ marginBottom: 6 }}>Nickname</div>
          <input value={nickname} onChange={e => setNickname(e.target.value)} onBlur={saveNickname} onKeyDown={e => e.key === 'Enter' && e.target.blur()} placeholder="Your name"
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: UI.ink, fontFamily: UI.fontUi, fontSize: 15, fontWeight: 500, padding: '0 0 2px', boxSizing: 'border-box' }} />
          <div className="micro" style={{ marginTop: 4 }}>{store.user?.email || userId}</div>
        </Frame>

        {/* ─── Category navigation ─── */}
        <Frame style={{ padding: '0 14px' }}>
          <NavRow label="Changelog" hint={(window.WHATS_NEW || [])[0]?.id} onTap={() => setChangelogSheet(true)} accent first />
          <NavRow label="How to…" onTap={() => setHowToSheet(true)} />
          {hasActiveUsersAccess && (
            <NavRow label="Active users" hint={activeCount > 0 ? `${activeCount} active` : null} onTap={() => setActiveUsersSheet(true)} />
          )}
          <NavRow label="Coaching" onTap={() => setCoachingSheet(true)} />
          <NavRow label="Health" onTap={() => setHealthSheet(true)} />
          <NavRow label="Account" onTap={() => setAccountSheet(true)} />
          <NavRow label="Training" onTap={() => setTrainingSheet(true)} />
          <NavRow label="Appearance" onTap={() => setAppearanceSheet(true)} />
          <NavRow label="Data" onTap={() => setDataSheet(true)} />
        </Frame>

        {/* ─── Admin: pending registrations ─── */}
        {isAdmin && pendingUsers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div className="label" style={{ color: UI.inkFaint, marginBottom: 8 }}>Pending registrations</div>
            <Frame style={{ padding: '0 16px' }}>
              {pendingUsers.map((u, i) => (
                <React.Fragment key={u.user_id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || '—'}</div>
                      <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                    </div>
                    <button onClick={() => approveUser(u.user_id)} disabled={!!approvingId || !!decliningId} style={{
                      padding: '6px 12px', borderRadius: 4,
                      background: approvingId === u.user_id ? UI.goldFaint : 'rgba(var(--accent-rgb),0.12)',
                      border: `1px solid rgba(var(--accent-rgb),0.3)`,
                      color: UI.gold, fontFamily: UI.fontUi, fontSize: 10,
                      letterSpacing: '0.1em', textTransform: 'uppercase',
                      cursor: approvingId === u.user_id ? 'default' : 'pointer', flexShrink: 0,
                    }}>
                      {approvingId === u.user_id ? '…' : 'Approve'}
                    </button>
                    <button onClick={() => declineUser(u.user_id)} disabled={!!approvingId || !!decliningId} style={{
                      padding: '6px 12px', borderRadius: 4,
                      background: 'transparent',
                      border: `1px solid rgba(var(--danger-rgb),0.25)`,
                      color: 'rgba(var(--danger-rgb),0.7)', fontFamily: UI.fontUi, fontSize: 10,
                      letterSpacing: '0.1em', textTransform: 'uppercase',
                      cursor: decliningId === u.user_id ? 'default' : 'pointer', flexShrink: 0,
                    }}>
                      {decliningId === u.user_id ? '…' : 'Decline'}
                    </button>
                  </div>
                  {i < pendingUsers.length - 1 && <div className="knurl" />}
                </React.Fragment>
              ))}
            </Frame>
          </div>
        )}
        <Btn kind="ghost" onClick={async () => { if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } window.location.reload(true); }}>Clear cache &amp; reload</Btn>
        <Btn kind="ghost" onClick={handleSignOut} style={{ color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.2)' }}>Sign out</Btn>
        <div className="micro" style={{ textAlign: 'center', marginTop: 4 }}>Zane · {swVersion || '…'} · Data in Supabase</div>

      </div>

      {confirmEl}

      {/* ══ Active Users Sheet ══ */}
      <SettingsSheet open={activeUsersSheet} onClose={() => setActiveUsersSheet(false)} title="Active users">
        {(() => {
          const dismissed = JSON.parse(localStorage.getItem('logbook-dismissed-sessions') || '[]');
          const visibleSessions = activeSessions.filter(s => !s.is_finished || !dismissed.includes(s.session_id));
          return (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {visibleSessions.length === 0
                ? <div className="micro" style={{ color: UI.inkFaint, padding: '4px 0' }}>Nobody training right now.</div>
                : visibleSessions.map((s, i) => {
                  const isFinished = s.is_finished;
                  if (isFinished) {
                    const finishedMin = s.ended ? Math.round((nowS - new Date(s.ended).getTime()) / 60000) : null;
                    const finishedStr = finishedMin != null ? (finishedMin < 60 ? `${finishedMin}m ago` : `${Math.round(finishedMin / 60)}h ago`) : 'done';
                    return (
                      <div key={s.session_id} onClick={() => go({ name: 'spectator', targetUserId: s.user_id, userName: s.user_name, sessionId: s.session_id })}
                        style={{ display: 'grid', gridTemplateColumns: '12px 1fr 1fr 1fr', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: UI.inkFaint }} />
                        <span style={{ fontSize: 13, color: UI.inkSoft, fontWeight: 500, fontFamily: UI.fontUi }}>{s.user_name}</span>
                        <span className="display-it" style={{ fontSize: 13, color: UI.inkFaint, textAlign: 'center' }}>{s.day_name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{finishedStr}</span>
                          <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>
                        </div>
                      </div>
                    );
                  }
                  const blended = LB.calcBlended(s.started_at, s.avg_duration_seconds, s.avg_sets_total, s.sets_done, s.sets_total, nowS);
                  const remMin = blended?.remainingMin ?? null; const ratio = blended?.progress ?? null; const finishing = remMin === 0;
                  return (
                    <div key={s.session_id || i} onClick={() => go({ name: 'spectator', targetUserId: s.user_id, userName: s.user_name })}
                      style={{ display: 'grid', gridTemplateColumns: '12px 1fr 1fr 1fr', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: 'pulseDot 1.4s ease-in-out infinite' }} />
                      <span style={{ fontSize: 13, color: UI.ink, fontWeight: 500, fontFamily: UI.fontUi }}>{s.user_name}</span>
                      <span className="display-it" style={{ fontSize: 13, color: UI.inkSoft, textAlign: 'center' }}>{s.day_name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                        {ratio !== null ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                            <span className="num" style={{ fontSize: 11, color: finishing ? 'var(--accent-light)' : 'var(--accent)' }}>{finishing ? 'soon' : `~${remMin}m`}</span>
                            <div style={{ width: 40, height: 2, borderRadius: 999, background: UI.hairStrong, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${ratio * 100}%`, background: 'var(--accent)', borderRadius: 999 }} />
                            </div>
                          </div>
                        ) : <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{s.sets_done}/{s.sets_total}</span>}
                        <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>
                      </div>
                    </div>
                  );
                })
              }
              {isAdmin && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: `0.5px solid ${UI.hair}` }}>
                  <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>ACCESS</div>
                  {activeGrants.length === 0 && <div className="micro" style={{ color: UI.inkGhost, marginBottom: 8 }}>No other users have access yet.</div>}
                  {activeGrants.map(email => (
                    <div key={email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `0.5px solid ${UI.hair}` }}>
                      <span style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi }}>{email}</span>
                      <button onClick={() => removeGrant(email)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.danger, fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input value={newGrantEmail} onChange={e => setNewGrantEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addGrant()} placeholder="email@example.com"
                      style={{ flex: 1, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '7px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none' }} />
                    <button onClick={addGrant} disabled={!newGrantEmail.includes('@')} style={{ padding: '7px 14px', borderRadius: 4, border: 'none', cursor: 'pointer', background: newGrantEmail.includes('@') ? UI.gold : UI.bgInset, color: newGrantEmail.includes('@') ? '#0a0805' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>Add</button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Coaching Sheet ══ */}
      <SettingsSheet open={coachingSheet} onClose={() => setCoachingSheet(false)} title="Coaching">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Coaching tab" first>
            <Toggle on={coachingTabOn} onToggle={toggleTab} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Pin the coaching tab to the nav bar. Shows automatically when a coaching relationship is active.
          </div>
          {coachingTabOn && (
            <div style={{ marginTop: 12 }}>
              <Row label="Be your own coach">
                <Toggle on={selfOn} onToggle={toggleSelf} />
              </Row>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
                Track your own training like a coach would — stats, nutrition, check-ins & notes, just for you.
              </div>
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setCoachingSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health Sheet ══ */}
      <SettingsSheet open={healthSheet} onClose={() => setHealthSheet(false)} title="Health">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Health tab" first>
            <Toggle on={!!store.settings?.showHealthTab} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, showHealthTab: !s.settings?.showHealthTab } }))} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Pin a Health tab to the nav bar to log daily weight, steps & macros and see your trends. These daily logs also prefill your weekly coach check-in.
          </div>
          <div style={{ marginTop: 16 }}>
            <Row label="Manual calorie entry">
              <Toggle on={!!store.settings?.manualCalories} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, manualCalories: !s.settings?.manualCalories } }))} />
            </Row>
          </div>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            By default calories are calculated from macros (P×4 + C×4 + F×9). Enable this to enter calories directly — useful for net-carb tracking.
          </div>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setHealthSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Account Sheet ══ */}
      <SettingsSheet open={accountSheet} onClose={() => setAccountSheet(false)} title="Account">
        <div>
          {isQsUser && (
            <>
              <div className="micro" style={{ marginBottom: 10 }}>Quick switch</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <div style={{ flex: 1, background: `linear-gradient(135deg, rgba(var(--accent-rgb),0.10), rgba(var(--accent-rgb),0.03))`, border: `0.5px solid ${UI.goldSoft}`, borderRadius: 6, padding: '10px 12px' }}>
                  <div className="micro-gold" style={{ marginBottom: 4 }}>Active</div>
                  <div style={{ fontFamily: UI.fontDisplay, fontSize: 18, color: UI.ink, lineHeight: 1.1 }}>{currentName}</div>
                </div>
                <button disabled={qsSwitching} onClick={async () => {
                  if (hasQsSession) { setQsSwitching(true); try { await LB.quickSwitch(otherQsEmail); window.location.reload(); } catch (e) { setQsSwitching(false); } }
                  else { const ok = await confirm(`You'll be signed out so ${otherName} can log in.`, { title: 'Set up quick switch?', ok: 'Sign out' }); if (ok) await LB.signOut(); }
                }} style={{ flex: 1, background: 'transparent', border: `0.5px solid ${hasQsSession ? UI.hair : UI.hairStrong}`, borderRadius: 6, padding: '10px 12px', textAlign: 'left', cursor: qsSwitching ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent', opacity: qsSwitching ? 0.5 : 1 }}>
                  <div className="micro" style={{ marginBottom: 4, color: hasQsSession ? UI.inkFaint : 'rgba(var(--danger-rgb),0.7)' }}>{qsSwitching ? 'Switching…' : hasQsSession ? 'Tap to switch' : 'Log in first'}</div>
                  <div style={{ fontFamily: UI.fontDisplay, fontSize: 18, color: hasQsSession ? UI.inkSoft : UI.inkFaint, lineHeight: 1.1 }}>{otherName}</div>
                </button>
              </div>
              <Hairline style={{ marginBottom: 14 }} />
            </>
          )}
          {isAdmin && (() => {
            const unseenCount = recentSignups.filter(u => !seenSignups.has(u.user_id)).length;
            return (
              <>
                <NavRow label="Admin" hint={unseenCount > 0 ? `${unseenCount} new` : undefined} onTap={() => setAdminSheet(true)} first />
                <Hairline style={{ margin: '14px 0' }} />
              </>
            );
          })()}
          <Row label="Push notifications" first>
            <button style={accentBtn} onClick={() => setPushSheet(true)}>Configure</button>
          </Row>
          <Hairline style={{ margin: '14px 0' }} />
          {typeof window !== 'undefined' && window.PublicKeyCredential && (
            <>
              <NavRow label="Passkeys" onTap={() => setPasskeySheet(true)} first />
              <Hairline style={{ margin: '14px 0' }} />
            </>
          )}
          <Row label="Remind on training days" first>
            {reminderEnabled
              ? <button style={accentBtn} onClick={() => setReminderSheet(true)}>{store.settings?.reminderTime || 'Change'}</button>
              : <Toggle on={false} onToggle={toggleReminder} />
            }
          </Row>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setAccountSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Passkey Sheet ══ */}
      <PasskeySheet open={passkeySheet} onClose={() => setPasskeySheet(false)} />

      {/* ══ Admin Sheet ══ */}
      <SettingsSheet open={adminSheet} onClose={() => setAdminSheet(false)} title="Admin">
        <div>
          <Row label="Registrations need approval" first>
            <Toggle on={signupApproval !== false} onToggle={toggleSignupApproval} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            When on, new sign-ups land on a waiting screen until you approve them here. When off, new accounts are activated immediately. Existing pending users are unaffected.
          </div>
          <Hairline style={{ margin: '14px 0' }} />
          <Row label="Auto-approve batch" first>
            <button style={accentBtn} onClick={() => { setBudgetDraft(autoApproveLeft || 20); setBudgetSheet(true); }}>
              {autoApproveLeft != null ? `${autoApproveLeft} left` : 'Off'}
            </button>
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Open registration for a set number of sign-ups — they're auto-approved until the batch is used up, then approval turns itself back on.
          </div>
          {(() => {
            const unseenCount = recentSignups.filter(u => !seenSignups.has(u.user_id)).length;
            return (
              <>
                <Hairline style={{ margin: '14px 0' }} />
                <Row label="Recent sign-ups" first>
                  <button style={accentBtn} onClick={() => setSignupsSheet(true)}>{unseenCount > 0 ? `${unseenCount} new` : 'View'}</button>
                </Row>
              </>
            );
          })()}
          <Hairline style={{ margin: '14px 0' }} />
          <Row label="Background" first>
            <button style={accentBtn} onClick={() => setBgPreviewSheet(true)}>
              {{ standard: 'Standard', mike: 'Mike', phoenix: 'Phoenix' }[adminBgPreview] || 'Change'}
            </button>
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Preview VIP background images on your home screen before notifying users.
          </div>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setAdminSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Training Sheet ══ */}
      <SettingsSheet open={trainingSheet} onClose={() => setTrainingSheet(false)} title="Training">
        <div>
          <Row label="Rest timers" first>
            <button style={accentBtn} onClick={() => setRestSheet(true)}>Change</button>
          </Row>
          <Row label="Auto-end session">
            <button style={accentBtn} onClick={() => setTimeoutSheet(true)}>
              {(store.settings?.sessionTimeoutMinutes ?? 90) !== 90 ? `${store.settings.sessionTimeoutMinutes} min` : 'Change'}
            </button>
          </Row>
          <Row label="Paceguard">
            {store.settings?.tempoEnabled
              ? <button style={accentBtn} onClick={() => setPaceguardSheet(true)}>Change</button>
              : <Toggle on={false} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, tempoEnabled: true } }))} />
            }
          </Row>
          <Row label="Smart progression">
            {store.settings?.smartProgression
              ? <button style={accentBtn} onClick={() => setProgressionSheet(true)}>Change</button>
              : <Toggle on={false} onToggle={() => { setStore(s => ({ ...s, settings: { ...s.settings, smartProgression: true } })); setProgDisclaimer(true); }} />
            }
          </Row>
          <Row label="Fill weight down">
            <Toggle on={store.settings?.weightFillDown !== false} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, weightFillDown: s.settings?.weightFillDown === false } }))} />
          </Row>
          <Row label="Equipment setup">
            <button style={accentBtn} onClick={() => setProgConfigOpen(true)}>Change</button>
          </Row>
          <Row label="Plate inventory">
            <button style={accentBtn} onClick={() => setPlateInventoryOpen(true)}>Change</button>
          </Row>
          <Row label="Warmup sets in summary">
            <Toggle on={showWarmupInSummary} onToggle={() => { const n = !showWarmupInSummary; setShowWarmupInSummary(n); setStore(s => ({ ...s, settings: { ...s.settings, showWarmupInSummary: n } })); }} />
          </Row>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setTrainingSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Appearance Sheet ══ */}
      <SettingsSheet open={appearanceSheet} onClose={() => setAppearanceSheet(false)} title="Appearance">
        <div>
          <div className="micro" style={{ marginBottom: 10 }}>Accent color</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px 0', marginBottom: 14 }}>
            {Object.entries(window.ACCENT_PALETTE).map(([key, c]) => {
              const active = (store.settings?.accentColor ?? 'copper') === key;
              return (
                <button key={key} onClick={() => { window.applyAccentColor(key); localStorage.setItem('logbook-accent-color', key); setStore(s => ({ ...s, settings: { ...s.settings, accentColor: key } })); }}
                  title={c.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
                  <div style={{ width: active ? 32 : 26, height: active ? 32 : 26, borderRadius: '50%', background: c.hex, border: active ? `2.5px solid ${UI.ink}` : '2px solid transparent', boxShadow: active ? `0 0 0 1.5px ${c.hex}` : 'none', transition: 'all 0.18s' }} />
                  {active && <span style={{ fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 600, color: 'var(--accent)' }}>{c.label}</span>}
                </button>
              );
            })}
          </div>
          <Row label="Week view in cycle mode" first>
            <Toggle on={cycleWeekView} onToggle={() => { const n = !cycleWeekView; setCycleWeekView(n); localStorage.setItem('logbook-cycle-week-view', String(n)); setStore(s => ({ ...s, settings: { ...s.settings, cycleWeekView: n } })); }} />
          </Row>
          <Row label="OLED black background">
            <Toggle on={darkMode === 'black'} onToggle={() => { const n = darkMode === 'black' ? 'dark' : 'black'; setDarkMode(n); localStorage.setItem('logbook-dark-mode', n); setStore(s => ({ ...s, settings: { ...s.settings, darkMode: n } })); }} />
          </Row>
          <Row label="Unit preference">
            <button style={accentBtn} onClick={() => setUnitPickerOpen(true)}>
              {store.settings?.unit === 'lbs' ? 'Imperial' : 'Metric'}
            </button>
          </Row>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setAppearanceSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Data Sheet ══ */}
      <SettingsSheet open={dataSheet} onClose={() => setDataSheet(false)} title="Data">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" onClick={() => exportData()} style={{ flex: 1 }}>Export JSON</Btn>
            <Btn kind="ghost" onClick={importData} disabled={importing} style={{ flex: 1 }}>{importing ? 'Importing…' : 'Import JSON'}</Btn>
          </div>
          <Btn kind="ghost" onClick={handleDeleteAll} style={{ color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.2)' }}>Delete all data</Btn>
        </div>
      </SettingsSheet>

      {/* ══ How To Sheet ══ */}
      <HowToSheet open={howToSheet} onClose={() => setHowToSheet(false)} />

      {/* ══ Changelog Sheet ══ */}
      <ChangelogSheet open={changelogSheet} onClose={() => setChangelogSheet(false)} />

      {/* ══ Unit picker modal ══ */}
      {unitPickerOpen && window.Screens?.UnitPromptModal && (
        <window.Screens.UnitPromptModal
          onDone={(chosenUnit) => {
            setUnitPickerOpen(false);
            localStorage.setItem('logbook-unit-prompted', '1');
            setStore(s => s ? { ...s, settings: { ...s.settings, unit: chosenUnit } } : s);
          }}
        />
      )}

      {/* ══ Auto-end session sheet ══ */}
      <SettingsSheet open={timeoutSheet} onClose={() => setTimeoutSheet(false)} title="Auto-end session">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 8 }}>
          <div>
            <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>INACTIVITY TIMEOUT</div>
            <Stepper value={store.settings?.sessionTimeoutMinutes ?? 90} step={15} min={15} max={480} suffix=" min"
              onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, sessionTimeoutMinutes: v } }))} />
          </div>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>
            Open sessions with no new sets for this long are automatically ended. Sessions with no sets at all are silently deleted.
          </div>
          <Btn onClick={() => setTimeoutSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Rest timers sheet ══ */}
      <SettingsSheet open={restSheet} onClose={() => setRestSheet(false)} title="Rest timers">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {[['Default', 'restDefault', 120], ['Big', 'restBig', 180], ['Medium', 'restMedium', 120], ['Small', 'restSmall', 90]].map(([label, key, def]) => (
              <div key={key}>
                <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>{label.toUpperCase()}</div>
                <Stepper value={store.settings?.[key] ?? def} step={15} min={0} suffix="s"
                  onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, [key]: v } }))} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', background: UI.bgRaised, borderRadius: 6, border: `1px solid ${UI.hairStrong}` }}>
            {[['BIG', 'Heavy compounds — squat, deadlift, overhead press'], ['MEDIUM', 'Moderate compounds — bench, pull-up, lunge'], ['SMALL', 'Isolation — bicep curl, lateral raise, tricep extension']].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span className="micro" style={{ color: UI.gold, flexShrink: 0, minWidth: 46 }}>{k}</span>
                <span className="micro" style={{ color: UI.inkSoft, letterSpacing: '0.04em', textTransform: 'none', fontWeight: 400 }}>{v}</span>
              </div>
            ))}
            <div style={{ marginTop: 4, borderTop: `1px solid ${UI.hair}`, paddingTop: 6 }}>
              <span className="micro" style={{ color: UI.inkFaint, letterSpacing: '0.04em', textTransform: 'none', fontWeight: 400, lineHeight: 1.5 }}>
                BIG / MEDIUM / SMALL only apply when the exercise has its size set. Default is used otherwise.
              </span>
            </div>
          </div>
          <Btn onClick={() => setRestSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Paceguard sheet ══ */}
      <SettingsSheet open={paceguardSheet} onClose={() => setPaceguardSheet(false)} title="Paceguard">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <Row label="Enabled" first>
            <Toggle on={!!store.settings?.tempoEnabled} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, tempoEnabled: !s.settings?.tempoEnabled } }))} />
          </Row>
          {store.settings?.tempoEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, paddingTop: 4 }}>
              <div>
                <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>ECCENTRIC (DOWN)</div>
                <Stepper value={store.settings?.tempoEccentric ?? 4} step={0.5} min={0.5} max={10} suffix="s" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, tempoEccentric: v } }))} />
              </div>
              <div>
                <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>CONCENTRIC (UP)</div>
                <Stepper value={store.settings?.tempoConcentric ?? 1} step={0.5} min={0.5} max={10} suffix="s" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, tempoConcentric: v } }))} />
              </div>
            </div>
          )}
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>Beeps subdivide each phase evenly · count increases each beat</div>
          <Btn onClick={() => setPaceguardSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Smart progression sheet ══ */}
      <SettingsSheet open={progressionSheet} onClose={() => setProgressionSheet(false)} title="Smart progression">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <Row label="Enabled" first>
            <Toggle on={!!store.settings?.smartProgression} onToggle={() => { const t = !store.settings?.smartProgression; setStore(s => ({ ...s, settings: { ...s.settings, smartProgression: t } })); if (t) setProgDisclaimer(true); }} />
          </Row>
          {store.settings?.smartProgression && (
            <>
              <div>
                <div className="micro" style={{ marginBottom: 8 }}>REP RANGE TOP (+reps above target)</div>
                <Stepper value={store.settings?.progressionRangeTop ?? 4} step={1} min={1} max={10} suffix=" reps" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, progressionRangeTop: v } }))} />
              </div>
              <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>If target is 8 reps and range top is +4, weight increases only when all sets reach 12 reps.</div>
            </>
          )}
          <Btn onClick={() => setProgressionSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Equipment config sheet ══ */}
      <SettingsSheet open={progConfigOpen} onClose={() => setProgConfigOpen(false)} title="Equipment setup">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 72px', gap: 8, padding: '0 4px 8px', borderBottom: `0.5px solid ${UI.hair}` }}>
            <span className="micro">Equipment</span>
            <span className="micro" style={{ textAlign: 'center' }}>Increment</span>
            <span className="micro" style={{ textAlign: 'center' }}>Max {UI.unit()}</span>
          </div>
          {(window.EQUIPMENT_TYPES || []).map(({ key, label }) => {
            const cfg = store.settings?.equipmentConfig?.[key] ?? {};
            const setField = (field, val) => setStore(s => ({ ...s, settings: { ...s.settings, equipmentConfig: { ...s.settings?.equipmentConfig, [key]: { ...(s.settings?.equipmentConfig?.[key] ?? {}), [field]: val } } } }));
            return (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 72px', gap: 8, alignItems: 'center', padding: '10px 4px', borderBottom: `0.5px solid ${UI.hair}` }}>
                <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 4, padding: '6px 8px', border: `1px solid ${UI.hair}` }}>
                  <NumInput value={cfg.increment ?? null} placeholder="—" onChange={v => setField('increment', v)} style={{ fontSize: 13, width: '100%' }} />
                  <span className="micro" style={{ flexShrink: 0 }}>{UI.unit()}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 4, padding: '6px 8px', border: `1px solid ${UI.hair}` }}>
                  <NumInput value={cfg.maxKg ?? null} placeholder="—" onChange={v => setField('maxKg', v)} style={{ fontSize: 13, width: '100%' }} />
                  <span className="micro" style={{ flexShrink: 0 }}>{UI.unit()}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.6, marginBottom: 16 }}>Set equipment categories on exercises in the exercise library. Individual overrides can be set per exercise.</div>
        <Btn style={{ width: '100%' }} onClick={() => setProgConfigOpen(false)}>Done</Btn>
      </SettingsSheet>

      {/* ══ Plate inventory sheet ══ */}
      <SettingsSheet open={plateInventoryOpen} onClose={() => setPlateInventoryOpen(false)} title="Plate inventory">
        <div style={{ display: 'flex', gap: 3, marginBottom: 28, background: UI.bgInset, borderRadius: 4, padding: 3 }}>
          {['kg', 'lbs'].map((u, i) => (
            <button key={u} onClick={() => setPlateInvTab(i)} style={{
              flex: 1, padding: '8px 0', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: plateInvTab === i ? 'var(--accent)' : 'transparent',
              color: plateInvTab === i ? '#0a0805' : UI.inkFaint,
              fontFamily: UI.fontUi, fontSize: 12, letterSpacing: '0.06em',
              fontWeight: plateInvTab === i ? 600 : 400, transition: 'all 0.15s',
            }}>{u.toUpperCase()}</button>
          ))}
        </div>
        {(() => {
          const isLbs = plateInvTab === 1;
          const invKey = isLbs ? 'plateInventoryLbs' : 'plateInventoryKg';
          const allPlates = isLbs ? PLATES_LBS : PLATES_KG;
          const plateColors = isLbs ? PLATE_COLORS_LBS : PLATE_COLORS_KG;
          const plateSizes  = isLbs ? PLATE_SIZE_LBS   : PLATE_SIZE_KG;
          const current = store.settings?.equipmentConfig?.[invKey] ?? allPlates;
          const toggle = (p) => {
            const newInv = current.includes(p)
              ? current.filter(x => x !== p)
              : [...current, p].sort((a, b) => b - a);
            setStore(s => ({ ...s, settings: { ...s.settings, equipmentConfig: { ...s.settings?.equipmentConfig, [invKey]: newInv } } }));
          };
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center', alignItems: 'flex-end', padding: '4px 0 24px' }}>
              {allPlates.map(p => {
                const has = current.includes(p);
                const size = Math.round((plateSizes[p] || 32) * 0.75);
                const hole = Math.round(size * 0.3);
                const color = plateColors[p] || '#808b96';
                return (
                  <div key={p} onClick={() => toggle(p)} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    cursor: 'pointer', opacity: has ? 1 : 0.22, transition: 'opacity 0.18s',
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                    <div style={{
                      width: size, height: size, borderRadius: '50%',
                      background: color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      position: 'relative',
                      boxShadow: has ? `0 4px 14px rgba(0,0,0,0.45), 0 0 0 1.5px rgba(255,255,255,0.15)` : 'none',
                    }}>
                      <div style={{
                        position: 'absolute',
                        width: hole, height: hole, borderRadius: '50%',
                        background: 'var(--bg)',
                      }} />
                    </div>
                    <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft, letterSpacing: '0.02em' }}>{p}</span>
                  </div>
                );
              })}
            </div>
          );
        })()}
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', lineHeight: 1.6, marginBottom: 20 }}>
          Tap a plate to toggle. Dimmed plates are not in your inventory and won't be suggested by the plate calculator.
        </div>
        <Btn style={{ width: '100%' }} onClick={() => setPlateInventoryOpen(false)}>Done</Btn>
      </SettingsSheet>

      {/* ══ Progression disclaimer sheet ══ */}
      <SettingsSheet open={progDisclaimer} onClose={() => setProgDisclaimer(false)} title="Smart Progression">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, lineHeight: 1.6 }}>The reps shown in your sets are <span style={{ color: UI.gold }}>minimum reps</span> — the floor the algorithm needs to track progression.</div>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>Always train past that number. Push to failure or near-failure on each set. The algo only bumps weight when <em>all</em> sets hit the top of the range — so getting extra reps is how you earn the next weight.</div>
        </div>
        <Btn onClick={() => setProgDisclaimer(false)}>Got it</Btn>
      </SettingsSheet>

      {/* ══ Auto-approve batch sheet (admin) ══ */}
      <SettingsSheet open={budgetSheet} onClose={() => setBudgetSheet(false)} title="Auto-approve batch">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <div>
            <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>SIGN-UPS TO AUTO-APPROVE</div>
            <Stepper value={budgetDraft} step={5} min={0} max={500} suffix=" sign-ups" onChange={setBudgetDraft} />
          </div>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>
            The next {budgetDraft > 0 ? budgetDraft : '—'} new accounts skip the waiting screen. Once that many have joined, “Registrations need approval” switches back on automatically. Set to 0 to re-lock now.
          </div>
          <Btn onClick={saveBudget}>{budgetDraft > 0 ? `Open for ${budgetDraft}` : 'Re-lock now'}</Btn>
        </div>
      </SettingsSheet>

      {/* ══ VIP background preview sheet (admin) ══ */}
      <SettingsSheet open={bgPreviewSheet} onClose={() => setBgPreviewSheet(false)} title="Background">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { key: 'standard', label: 'Standard', sub: 'Zane logo watermark' },
            { key: 'mike',     label: 'Mike',     sub: 'mikeapicelli777' },
            { key: 'phoenix',  label: 'Phoenix',  sub: 'mb2489' },
          ].map(({ key, label, sub }) => {
            const active = adminBgPreview === key;
            return (
              <button key={key} onClick={() => {
                setAdminBgPreview(key);
                if (key === 'standard') localStorage.removeItem('logbook-admin-bg-preview');
                else localStorage.setItem('logbook-admin-bg-preview', key);
              }} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: 6,
                border: active ? `1.5px solid var(--accent)` : `0.5px solid ${UI.hairStrong}`,
                background: active ? `rgba(var(--accent-rgb), 0.1)` : UI.bgInset,
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent', textAlign: 'left',
              }}>
                <div>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600, color: active ? 'var(--accent)' : UI.ink }}>{label}</div>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 2 }}>{sub}</div>
                </div>
                {active && <svg width="14" height="11" viewBox="0 0 14 11" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 5.5L5 9.5L13 1.5" /></svg>}
              </button>
            );
          })}
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5, marginTop: 4 }}>
            Previews on your own home screen only — device-local, nothing is synced or shown to users.
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Recent sign-ups sheet (admin) ══ */}
      <SettingsSheet open={signupsSheet} onClose={() => setSignupsSheet(false)} title="Recent sign-ups">
        {(() => {
          const unseen = recentSignups.filter(u => !seenSignups.has(u.user_id));
          if (unseen.length === 0) {
            return <div className="micro" style={{ color: UI.inkGhost, padding: '4px 0 12px' }}>Nothing new — you're all caught up.</div>;
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
              {unseen.map((u, i) => (
                <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 17, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontFamily: UI.fontUi, fontSize: 14, fontWeight: 700, color: UI.inkSoft }}>{(u.name || u.email || '?')[0].toUpperCase()}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || '—'}</span>
                      <span className="micro" style={{ flexShrink: 0, color: u.approved ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.75)' }}>{u.approved ? 'ACTIVE' : 'PENDING'}</span>
                    </div>
                    <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email} · {fmtAgo(u.created_at)}</div>
                  </div>
                  <button onClick={() => markSignupSeen(u.user_id)} style={{ ...accentBtn, padding: '5px 10px' }}>Got it</button>
                </div>
              ))}
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Push notifications sheet ══ */}
      <SettingsSheet open={pushSheet} onClose={() => setPushSheet(false)} title="Push notifications">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <Row label="This device" first>
            {webPushLoading
              ? <span style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.inkFaint }}>…</span>
              : <Toggle on={pushEnabled} onToggle={togglePush} />}
          </Row>
          {pushEnabled && (
            <div className="micro" style={{ color: UI.inkGhost, paddingLeft: 2 }}>
              {store.settings?.usePushover && store.settings?.pushoverUserKey
                ? 'Active via Pushover — see Advanced'
                : webPushSub ? `Subscribed · endpoint …${webPushSub.endpoint.split('/').pop()?.slice(-10)}` : null}
            </div>
          )}
          {pushEnabled && (
            <Row label="Test notification">
              <button onClick={testWebPush} style={accentBtn}>Send</button>
            </Row>
          )}
          {pushStatus && <div className="micro" style={{ color: pushStatus.startsWith('✓') ? 'var(--accent)' : UI.inkSoft, textAlign: 'center', padding: '6px 0' }}>{pushStatus}</div>}
          {pushEnabled && (
            <Row label="Advanced">
              <button onClick={() => setAdvancedPushSheet(true)} style={accentBtn}>Open</button>
            </Row>
          )}
          <Btn onClick={() => setPushSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Advanced push sheet ══ */}
      <SettingsSheet open={advancedPushSheet} onClose={closeAdvanced} title="Advanced">
        {(() => {
          const isVerified = !!(store.settings?.usePushover && store.settings?.pushoverUserKey);
          const inputStyle = { background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '10px 14px', fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
              <Row label="Use Pushover" first>
                <Toggle
                  on={isVerified || pushoverStep !== 'idle'}
                  onToggle={() => {
                    if (isVerified) { disablePushover(); }
                    else if (pushoverStep !== 'idle') { setPushoverStep('idle'); setPushKeyDraft(''); setCodeInput(''); setPendingCode(''); }
                    else { setPushoverStep('entering-key'); }
                  }}
                />
              </Row>
              <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>
                Uses the Pushover app instead of browser push for rest timer notifications. Delivers even without the PWA installed.
              </div>

              {!isVerified && pushoverStep === 'entering-key' && (
                <>
                  <input value={pushKeyDraft} onChange={e => setPushKeyDraft(e.target.value)}
                    placeholder="Pushover user key (from pushover.net)"
                    style={inputStyle} autoCorrect="off" autoCapitalize="none" spellCheck={false} />
                  <Btn onClick={sendVerificationCode} disabled={pushKeyDraft.trim().length < 10 || verifyLoading}>
                    {verifyLoading ? 'Sending…' : 'Send verification code'}
                  </Btn>
                </>
              )}

              {!isVerified && pushoverStep === 'code-sent' && (
                <>
                  <div className="micro" style={{ color: UI.inkFaint }}>Enter the 6-digit code from your Pushover notification</div>
                  <input value={codeInput} onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456" inputMode="numeric" style={inputStyle} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn kind="ghost" onClick={() => { setPushoverStep('entering-key'); setCodeInput(''); setPendingCode(''); }}>Back</Btn>
                    <Btn onClick={verifyCode} disabled={codeInput.length !== 6} style={{ flex: 1 }}>Verify</Btn>
                  </div>
                </>
              )}

              {isVerified && (
                <>
                  <div className="micro" style={{ color: UI.inkFaint }}>Active · key …{store.settings.pushoverUserKey.slice(-8)}</div>
                  <Row label="Test rest timer">
                    <button onClick={() => setTestPickerOpen(true)} style={accentBtn}>Send</button>
                  </Row>
                </>
              )}

              {pushStatus && <div className="micro" style={{ color: pushStatus.startsWith('✓') ? 'var(--accent)' : UI.inkSoft, textAlign: 'center', padding: '6px 0' }}>{pushStatus}</div>}
              <Btn onClick={closeAdvanced}>Done</Btn>
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Reminder sheet ══ */}
      <SettingsSheet open={reminderSheet} onClose={() => setReminderSheet(false)} title="Training reminder">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <Row label="Enabled" first>
            <Toggle on={reminderEnabled} onToggle={() => { toggleReminder(); if (reminderEnabled) setReminderSheet(false); }} />
          </Row>
          {reminderEnabled && (
            <Row label="Notify at">
              <input type="time" value={reminderTime} onChange={e => updateReminderTime(e.target.value)}
                style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '5px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none', colorScheme: 'dark' }} />
            </Row>
          )}
          {reminderEnabled && store.nextReminderAt && (() => {
            const dt = new Date(store.nextReminderAt);
            const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
            const tomorrowMid = new Date(todayMid); tomorrowMid.setDate(todayMid.getDate() + 1);
            const remMid = new Date(dt); remMid.setHours(0, 0, 0, 0);
            const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const dateStr = remMid.getTime() === todayMid.getTime() ? 'Today' : remMid.getTime() === tomorrowMid.getTime() ? 'Tomorrow' : dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            return <div className="micro" style={{ color: UI.inkFaint, textAlign: 'right', paddingTop: 6 }}>Next · {dateStr} · {timeStr}</div>;
          })()}
          <Btn onClick={() => setReminderSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Test picker sheet (used from Advanced) ══ */}
      <SettingsSheet open={testPickerOpen} onClose={() => setTestPickerOpen(false)} title="Test rest timer">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testRestTimer(0); }}>Now</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testRestTimer(10); }}>In 10 seconds</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testRestTimer(30); }}>In 30 seconds</Btn>
        </div>
      </SettingsSheet>

    </Screen>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { SettingsScreen });
