/* Settings screen — appearance, training, data, account, admin */

const { useState: useStateSet, useMemo: useMemoSet, useEffect: useEffectSet, useRef: useRefSet } = React;

// ─── SETTINGS ────────────────────────────────────────────────────────
function SettingsScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [nickname, setNickname] = useStateSet(store.user?.name || '');
  const [appearanceOpen, setAppearanceOpen] = useStateSet(false);
  const [dataOpen, setDataOpen] = useStateSet(false);
  const [activeUsersOpen, setActiveUsersOpen] = useStateSet(false);
  const [accountOpen, setAccountOpen] = useStateSet(false);
  const [trainingOpen, setTrainingOpen] = useStateSet(false);
  const [progConfigOpen, setProgConfigOpen] = React.useState(false);
  const [progDisclaimer, setProgDisclaimer] = React.useState(false);
  const [activeSessions, setActiveSessions] = useStateSet([]);
  const [qsSwitching, setQsSwitching] = useStateSet(false);
  const [qsOpen, setQsOpen] = useStateSet(false);
  const [activeGrants, setActiveGrants] = useStateSet([]);
  const [newGrantEmail, setNewGrantEmail] = useStateSet('');
  const [hasActiveUsersAccess, setHasActiveUsersAccess] = useStateSet(
    () => localStorage.getItem('logbook-active-users-access') === 'true'
  );
  const [nowS, setNowS] = useStateSet(Date.now());
  const [importing, setImporting] = useStateSet(false);
  const [swVersion, setSwVersion] = useStateSet('');
  const [pushStatus, setPushStatus] = useStateSet(null);
  const [pushEnabled, setPushEnabled] = useStateSet(() => store.settings?.pushEnabled ?? localStorage.getItem('logbook-push-enabled') === 'true');
  const [pushKeyDraft, setPushKeyDraft] = useStateSet('');
  const [pushKeyModalOpen, setPushKeyModalOpen] = useStateSet(false);
  const [testPickerOpen, setTestPickerOpen] = useStateSet(false);
  const [reminderEnabled, setReminderEnabled] = useStateSet(() => store.settings?.reminderEnabled ?? false);
  const [reminderTime, setReminderTime] = useStateSet(() => store.settings?.reminderTime ?? '07:00');
  const [cycleWeekView, setCycleWeekView] = useStateSet(() => store.settings?.cycleWeekView ?? localStorage.getItem('logbook-cycle-week-view') === 'true');
  const [darkMode, setDarkMode] = useStateSet(() => store.settings?.darkMode ?? localStorage.getItem('logbook-dark-mode') ?? 'dark');
  const isAdmin = store.user?.email === 'office@btc-prime.biz';
  const [debugPanel, setDebugPanel] = useStateSet(() => localStorage.getItem('logbook-debug-panel') === 'true');

  useEffectSet(() => {
    let mounted = true;
    LB.supabase.rpc('check_active_users_access')
      .then(({ data }) => {
        const val = !!data;
        localStorage.setItem('logbook-active-users-access', val);
        if (mounted) setHasActiveUsersAccess(val);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffectSet(() => {
    if (!hasActiveUsersAccess) return;
    let mounted = true;
    const loadSessions = () => LB.supabase.rpc('get_active_sessions_overview')
      .then(({ data }) => { if (mounted) setActiveSessions(data || []); })
      .catch(() => {});
    const loadGrants = () => LB.supabase.rpc('get_active_users_grants')
      .then(({ data }) => { if (mounted) setActiveGrants((data || []).map(r => r.email)); })
      .catch(() => {});
    loadSessions();
    if (isAdmin) loadGrants();
    const iv = setInterval(() => { loadSessions(); setNowS(Date.now()); }, 2000);
    return () => { mounted = false; clearInterval(iv); };
  }, [hasActiveUsersAccess, isAdmin]);

  const addGrant = async () => {
    const email = newGrantEmail.trim().toLowerCase();
    if (!email.includes('@') || activeGrants.includes(email)) return;
    await LB.supabase.rpc('set_active_users_grant', { p_email: email, p_granted: true });
    setActiveGrants(g => [...g, email]);
    setNewGrantEmail('');
  };

  const removeGrant = async (email) => {
    await LB.supabase.rpc('set_active_users_grant', { p_email: email, p_granted: false });
    setActiveGrants(g => g.filter(x => x !== email));
  };

  const pushStatusTimer = React.useRef(null);
  useEffectSet(() => {
    if (!('caches' in window)) return;
    caches.keys().then(keys => {
      const name = keys.find(k => k.startsWith('zane-'));
      if (name) setSwVersion(name.replace('zane-', ''));
    });
  }, []);

  const togglePush = () => {
    if (!pushEnabled) {
      const existingKey = store.settings?.pushoverUserKey;
      if (existingKey) {
        setPushEnabled(true);
        localStorage.setItem('logbook-push-enabled', 'true');
        setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: true } }));
      } else {
        setPushKeyDraft('');
        setPushKeyModalOpen(true);
      }
    } else {
      setPushEnabled(false);
      localStorage.setItem('logbook-push-enabled', 'false');
      setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: false } }));
    }
  };

  const pushKeyValid = /^[a-zA-Z0-9]{30}$/.test(pushKeyDraft.trim());

  const confirmPushKey = () => {
    const key = pushKeyDraft.trim();
    if (!pushKeyValid) return;
    setPushEnabled(true);
    localStorage.setItem('logbook-push-enabled', 'true');
    setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: true, pushoverUserKey: key } }));
    setPushKeyModalOpen(false);
  };

  const testPushover = async (delaySeconds = 0) => {
    clearTimeout(pushStatusTimer.current);
    setPushStatus(delaySeconds > 0 ? `Sending… Lock screen now!` : 'Sending…');
    try {
      const res = await fetch(LB.PUSHOVER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LB.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'Rest done — keep going! 💪', title: 'Zane Test', delaySeconds, nonce: String(Date.now()), userKey: store.settings?.pushoverUserKey ?? '' }),
      });
      if (res.status === 202) {
        setPushStatus(`✓ Scheduled — notification in ~${delaySeconds}s`);
        pushStatusTimer.current = setTimeout(() => setPushStatus(null), (delaySeconds + 15) * 1000);
      } else {
        const data = await res.json();
        setPushStatus(data.status === 1 ? '✓ Sent' : `Error: ${JSON.stringify(data)}`);
        pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
      }
    } catch (e) {
      setPushStatus(`Error: ${e.message}`);
      pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
    }
  };

  const toggleReminder = () => {
    const next = !reminderEnabled;
    setReminderEnabled(next);
    setStore(s => ({ ...s, settings: { ...s.settings, reminderEnabled: next } }));
  };

  const updateReminderTime = (val) => {
    setReminderTime(val);
    setStore(s => ({ ...s, settings: { ...s.settings, reminderTime: val } }));
  };

  const saveNickname = () => {
    const trimmed = nickname.trim();
    if (!trimmed || trimmed === store.user?.name) return;
    setStore(s => ({ ...s, user: { ...s.user, name: trimmed } }));
  };

  const exportData = (filename) => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || `zane-${LB.todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importData = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      let backup;
      try {
        backup = JSON.parse(await file.text());
      } catch (_) {
        await confirm('The selected file is not valid JSON.', { title: 'Invalid file', ok: 'OK' });
        return;
      }
      if (!backup.sessions || !backup.exercises || !backup.schedules) {
        await confirm('This file does not look like a Zane backup.', { title: 'Invalid backup', ok: 'OK' });
        return;
      }
      const latestSession = [...(backup.sessions || [])].filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0];
      const backupDate = latestSession ? new Date(latestSession.ended).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : 'unknown date';
      const ok = await confirm(
        `This backup contains data up to ${backupDate}. Your current data will be downloaded first, then replaced.`,
        { title: 'Restore backup?', ok: 'Restore', danger: true }
      );
      if (!ok) return;
      exportData(`zane-before-import-${LB.todayISO()}.json`);
      setImporting(true);
      try {
        await LB.importFromBackup(backup, userId);
        LB.clearLocal(userId);
        window.location.reload();
      } catch (err) {
        setImporting(false);
        await confirm(`Import failed: ${err.message || 'Unknown error'}`, { title: 'Error', ok: 'OK' });
      }
    };
    input.click();
  };

  const handleSignOut = async () => {
    await LB.signOut();
  };

  const handleDeleteAll = async () => {
    if (!await confirm('This action cannot be undone.', { title: 'Delete all data?', ok: 'Delete all', danger: true })) return;
    await LB.deleteAllData(userId);
    await LB.signOut();
  };

  const chevron = (open) => (
    <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round" style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}>
      <path d="M2 1l5 5-5 5"/>
    </svg>
  );

  return (
    <Screen>
      <TopBar title="Settings" onBack={() => go({ name: 'home' })} />
      <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Nickname */}
        <Frame style={{ padding: '14px 16px' }}>
          <span className="label">Nickname</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <input
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              onBlur={saveNickname}
              onKeyDown={e => e.key === 'Enter' && (e.target.blur())}
              placeholder="Your name"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: UI.ink, fontFamily: UI.fontUi, fontSize: 16, padding: 0,
              }}
            />
          </div>
          <div className="micro" style={{ marginTop: 8 }}>
            Logged in as {store.user?.email || userId}
          </div>
        </Frame>

        {/* Active users — visible to admin + granted users */}
        {hasActiveUsersAccess && (
          <Frame style={{ padding: '14px 16px' }}>
            {(() => {
              const dismissed = JSON.parse(localStorage.getItem('logbook-dismissed-sessions') || '[]');
              const activeCount = activeSessions.filter(s => !s.is_finished).length;
              const visibleSessions = activeSessions.filter(s => !s.is_finished || !dismissed.includes(s.session_id));
              return (
                <button onClick={() => setActiveUsersOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}>
                  <span className="label" style={{ marginBottom: 0 }}>Active users</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {activeCount > 0 && (
                      <div style={{
                        background: 'var(--accent)', color: '#0a0805',
                        borderRadius: 999, minWidth: 18, height: 18,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, fontFamily: UI.fontUi, padding: '0 5px',
                      }}>
                        {activeCount}
                      </div>
                    )}
                    <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round" style={{ transition: 'transform 0.2s', transform: activeUsersOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                      <path d="M2 1l5 5-5 5"/>
                    </svg>
                  </div>
                </button>
              );
            })()}
            {activeUsersOpen && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
                {(() => {
                  const dismissed = JSON.parse(localStorage.getItem('logbook-dismissed-sessions') || '[]');
                  const visibleSessions = activeSessions.filter(s => !s.is_finished || !dismissed.includes(s.session_id));
                  if (visibleSessions.length === 0) return (
                    <div className="micro" style={{ color: UI.inkFaint, padding: '6px 0' }}>Nobody training right now.</div>
                  );
                  return visibleSessions.map((s, i) => {
                    const isFinished = s.is_finished;
                    if (isFinished) {
                      const finishedMin = s.ended ? Math.round((nowS - new Date(s.ended).getTime()) / 60000) : null;
                      const finishedStr = finishedMin != null ? (finishedMin < 60 ? `${finishedMin}m ago` : `${Math.round(finishedMin/60)}h ago`) : 'done';
                      return (
                        <div key={s.session_id}
                          onClick={() => go({ name: 'spectator', targetUserId: s.user_id, userName: s.user_name, sessionId: s.session_id })}
                          style={{ display: 'grid', gridTemplateColumns: '14px 1fr 1fr 1fr', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: UI.inkFaint }} />
                          <span style={{ fontSize: 14, color: UI.inkSoft, fontWeight: 500, fontFamily: UI.fontUi }}>{s.user_name}</span>
                          <span className="display-it" style={{ fontSize: 14, color: UI.inkFaint, textAlign: 'center' }}>{s.day_name}</span>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                            <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{finishedStr}</span>
                            <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round"><path d="M1 1l4 4-4 4"/></svg>
                          </div>
                        </div>
                      );
                    }
                    const blended  = LB.calcBlended(s.started_at, s.avg_duration_seconds, s.avg_sets_total, s.sets_done, s.sets_total, nowS);
                    const remMin   = blended?.remainingMin ?? null;
                    const ratio    = blended?.progress ?? null;
                    const finishing = remMin === 0;
                    return (
                      <div key={s.session_id || i}
                        onClick={() => go({ name: 'spectator', targetUserId: s.user_id, userName: s.user_name })}
                        style={{ display: 'grid', gridTemplateColumns: '14px 1fr 1fr 1fr', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'pulseDot 1.4s ease-in-out infinite' }} />
                        <span style={{ fontSize: 14, color: UI.ink, fontWeight: 500, fontFamily: UI.fontUi }}>{s.user_name}</span>
                        <span className="display-it" style={{ fontSize: 14, color: UI.inkSoft, textAlign: 'center' }}>{s.day_name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                          {ratio !== null ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                              <span className="num" style={{ fontSize: 11, color: finishing ? 'var(--accent-light)' : 'var(--accent)' }}>
                                {finishing ? 'soon' : `~${remMin}m`}
                              </span>
                              <div style={{ width: 44, height: 2, borderRadius: 999, background: UI.hairStrong, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${ratio * 100}%`, background: finishing ? 'var(--accent-light)' : 'var(--accent)', borderRadius: 999 }} />
                              </div>
                            </div>
                          ) : (
                            <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{s.sets_done}/{s.sets_total}</span>
                          )}
                          <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round"><path d="M1 1l4 4-4 4"/></svg>
                        </div>
                      </div>
                    );
                  });
                })()}

                {/* Access management — admin only */}
                {isAdmin && <div style={{ marginTop: 14, paddingTop: 14, borderTop: `0.5px solid ${UI.hair}` }}>
                  <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>ACCESS</div>
                  {activeGrants.length === 0 && (
                    <div className="micro" style={{ color: UI.inkGhost, marginBottom: 8 }}>No other users have access yet.</div>
                  )}
                  {activeGrants.map(email => (
                    <div key={email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `0.5px solid ${UI.hair}` }}>
                      <span style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi }}>{email}</span>
                      <button onClick={() => removeGrant(email)} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: UI.danger, fontSize: 16, lineHeight: 1, padding: '0 2px',
                        fontFamily: UI.fontUi,
                      }}>×</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                    <input
                      value={newGrantEmail}
                      onChange={e => setNewGrantEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addGrant()}
                      placeholder="email@example.com"
                      style={{
                        flex: 1, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`,
                        borderRadius: 8, padding: '7px 10px', color: UI.ink,
                        fontFamily: UI.fontUi, fontSize: 13, outline: 'none',
                      }}
                    />
                    <button onClick={addGrant} disabled={!newGrantEmail.includes('@')} style={{
                      padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: newGrantEmail.includes('@') ? UI.gold : UI.bgInset,
                      color: newGrantEmail.includes('@') ? '#0a0805' : UI.inkFaint,
                      fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
                      transition: 'background 0.15s',
                    }}>Add</button>
                  </div>
                </div>}
              </div>
            )}
          </Frame>
        )}

        <Hairline style={{ margin: '4px 0' }} />

        {/* Account */}
        {(() => {
          const currentEmail = store.user?.email || '';
          const otherEmail = LB.QS_EMAILS.find(e => e !== currentEmail);
          const isQsUser = LB.QS_EMAILS.includes(currentEmail) && !!otherEmail;
          const hasSession = isQsUser ? LB.hasQuickSwitchSession(otherEmail) : false;
          const currentName = store.user?.name || currentEmail.split('@')[0];
          const otherName = isQsUser ? (LB.getQsName(otherEmail) || otherEmail.split('@')[0]) : '';
          return (
            <Frame style={{ padding: '14px 16px' }}>
              <button onClick={() => setAccountOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}>
                <span className="label" style={{ marginBottom: 0 }}>Account</span>
                {chevron(accountOpen)}
              </button>
              {accountOpen && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {isQsUser && (<>
                    <div className="micro">QUICK SWITCH</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1, background: `linear-gradient(135deg, rgba(var(--accent-rgb),0.10), rgba(var(--accent-rgb),0.04))`, border: `0.5px solid ${UI.goldSoft}`, borderRadius: 10, padding: '10px 12px' }}>
                        <div className="micro-gold" style={{ marginBottom: 5 }}>Active</div>
                        <div style={{ fontFamily: UI.fontDisplay, fontSize: 18, color: UI.ink, lineHeight: 1.1 }}>{currentName}</div>
                      </div>
                      <button disabled={qsSwitching} onClick={async () => {
                        if (hasSession) {
                          setQsSwitching(true);
                          try { await LB.quickSwitch(otherEmail); window.location.reload(); }
                          catch (e) { setQsSwitching(false); console.error('Quick switch failed', e); }
                        } else {
                          const ok = await confirm(`You'll be signed out so ${otherName} can log in. Their session will be saved for future quick switches.`, { title: 'Set up quick switch?', ok: 'Sign out', cancel: 'Cancel' });
                          if (ok) await LB.signOut();
                        }
                      }} style={{ flex: 1, background: hasSession ? 'rgba(236,228,208,0.02)' : 'transparent', border: `0.5px solid ${hasSession ? UI.hair : UI.hairStrong}`, borderRadius: 10, padding: '10px 12px', textAlign: 'left', cursor: qsSwitching ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent', opacity: qsSwitching ? 0.5 : 1 }}>
                        <div className="micro" style={{ marginBottom: 5, color: hasSession ? UI.inkFaint : 'rgba(var(--danger-rgb),0.7)' }}>{qsSwitching ? 'Switching…' : (hasSession ? 'Tap to switch' : 'Log in first')}</div>
                        <div style={{ fontFamily: UI.fontDisplay, fontSize: 18, color: hasSession ? UI.inkSoft : UI.inkFaint, lineHeight: 1.1 }}>{otherName}</div>
                      </button>
                    </div>
                    <Hairline style={{ margin: '2px 0' }} />
                  </>)}
                  <div className="micro">PUSH NOTIFICATIONS</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="micro" style={{ color: UI.inkSoft }}>Enabled</span>
                    <div onClick={togglePush} style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', background: pushEnabled ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${pushEnabled ? UI.goldSoft : UI.hairStrong}`, position: 'relative', transition: 'background 0.2s' }}>
                      <div style={{ position: 'absolute', top: 3, left: pushEnabled ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: pushEnabled ? '#0a0805' : UI.inkFaint, transition: 'left 0.2s' }} />
                    </div>
                  </div>
                  {store.settings?.pushoverUserKey && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span className="micro" style={{ color: UI.inkFaint }}>User key</span>
                      <button onClick={() => { setPushKeyDraft(store.settings.pushoverUserKey); setPushKeyModalOpen(true); }} style={{ background: 'rgba(var(--accent-rgb),0.12)', border: '0.5px solid rgba(var(--accent-rgb),0.25)', color: 'var(--accent)', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent' }}>
                        Change
                      </button>
                    </div>
                  )}
                  {pushEnabled && (<>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span className="micro" style={{ color: UI.inkFaint }}>Test notifications</span>
                      <button onClick={() => setTestPickerOpen(true)} style={{ background: 'rgba(var(--accent-rgb),0.12)', border: '0.5px solid rgba(var(--accent-rgb),0.25)', color: 'var(--accent)', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent' }}>
                        Test
                      </button>
                    </div>
                    {pushStatus && (
                      <div className="micro" style={{ color: pushStatus.startsWith('✓') ? UI.gold : UI.inkSoft, textAlign: 'center' }}>
                        {pushStatus}
                      </div>
                    )}
                  </>)}
                  <Hairline style={{ margin: '4px 0' }} />
                  <div className="micro">TRAINING REMINDER</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="micro" style={{ color: UI.inkSoft }}>Remind me on training days</span>
                    <div onClick={toggleReminder} style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', background: reminderEnabled ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${reminderEnabled ? UI.goldSoft : UI.hairStrong}`, position: 'relative', transition: 'background 0.2s' }}>
                      <div style={{ position: 'absolute', top: 3, left: reminderEnabled ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: reminderEnabled ? '#0a0805' : UI.inkFaint, transition: 'left 0.2s' }} />
                    </div>
                  </div>
                  {reminderEnabled && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span className="micro" style={{ color: UI.inkFaint }}>Notify at</span>
                      <input
                        type="time"
                        value={reminderTime}
                        onChange={e => updateReminderTime(e.target.value)}
                        style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 8, padding: '5px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none', colorScheme: 'dark' }}
                      />
                    </div>
                  )}
            </div>
          )}
        </Frame>
          );
        })()}

        {/* Appearance */}
        <Frame style={{ padding: '14px 16px' }}>
          <button onClick={() => setAppearanceOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}>
            <span className="label" style={{ marginBottom: 0 }}>Appearance</span>
            {chevron(appearanceOpen)}
          </button>
          {appearanceOpen && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div className="micro" style={{ marginBottom: 8 }}>ACCENT COLOR</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {Object.entries(window.ACCENT_PALETTE).map(([key, c]) => {
                    const active = (store.settings?.accentColor ?? 'copper') === key;
                    return (
                      <button key={key} onClick={() => {
                        window.applyAccentColor(key);
                        localStorage.setItem('logbook-accent-color', key);
                        setStore(s => ({ ...s, settings: { ...s.settings, accentColor: key } }));
                      }} title={c.label} style={{
                        width: 28, height: 28, borderRadius: '50%', background: c.hex,
                        border: active ? `2.5px solid ${UI.ink}` : '2.5px solid transparent',
                        boxShadow: active ? `0 0 0 1px ${c.hex}` : 'none',
                        cursor: 'pointer', padding: 0, flexShrink: 0,
                        WebkitTapHighlightColor: 'transparent',
                      }} />
                    );
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: `0.5px solid ${UI.hair}` }}>
                <div>
                  <span className="label" style={{ marginBottom: 0 }}>Week view in cycle mode</span>
                  <div className="micro" style={{ marginTop: 4, maxWidth: 220 }}>Show Mon–Sun instead of cycle days in the date strip</div>
                </div>
                <div onClick={() => { const next = !cycleWeekView; setCycleWeekView(next); localStorage.setItem('logbook-cycle-week-view', String(next)); setStore(s => ({ ...s, settings: { ...s.settings, cycleWeekView: next } })); }} style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0, background: cycleWeekView ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${cycleWeekView ? UI.goldSoft : UI.hairStrong}`, position: 'relative', transition: 'background 0.2s' }}>
                  <div style={{ position: 'absolute', top: 3, left: cycleWeekView ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: cycleWeekView ? '#0a0805' : UI.inkFaint, transition: 'left 0.2s' }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: `0.5px solid ${UI.hair}` }}>
                <div>
                  <span className="label" style={{ marginBottom: 0 }}>Pure black background</span>
                  <div className="micro" style={{ marginTop: 4, maxWidth: 220 }}>Use OLED black instead of dark gray</div>
                </div>
                <div onClick={() => { const next = darkMode === 'black' ? 'dark' : 'black'; setDarkMode(next); localStorage.setItem('logbook-dark-mode', next); setStore(s => ({ ...s, settings: { ...s.settings, darkMode: next } })); }} style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0, background: darkMode === 'black' ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${darkMode === 'black' ? UI.goldSoft : UI.hairStrong}`, position: 'relative', transition: 'background 0.2s' }}>
                  <div style={{ position: 'absolute', top: 3, left: darkMode === 'black' ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: darkMode === 'black' ? '#0a0805' : UI.inkFaint, transition: 'left 0.2s' }} />
                </div>
              </div>
            </div>
          )}
        </Frame>

        {/* Data */}
        <Frame style={{ padding: '14px 16px' }}>
          <button onClick={() => setDataOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}>
            <span className="label" style={{ marginBottom: 0 }}>Data</span>
            {chevron(dataOpen)}
          </button>
          {dataOpen && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Btn kind="ghost" onClick={() => exportData()} style={{ fontSize: 12 }}>Export data (JSON)</Btn>
              <Btn kind="ghost" onClick={importData} disabled={importing} style={{ fontSize: 12 }}>{importing ? 'Importing…' : 'Import data (JSON)'}</Btn>
              <Hairline style={{ margin: '4px 0' }} />
              <Btn kind="ghost" onClick={handleDeleteAll} style={{ color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.25)', opacity: 0.7, fontSize: 12 }}>Delete all data</Btn>
            </div>
          )}
        </Frame>

        {/* Training */}
        <Frame style={{ padding: '14px 16px' }}>
          <button onClick={() => setTrainingOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0 }}>
            <span className="label" style={{ marginBottom: 0 }}>Training</span>
            {chevron(trainingOpen)}
          </button>
          {trainingOpen && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="micro">REST TIMERS</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {[
                  ['Default', 'restDefault', 120],
                  ['Big',     'restBig',     180],
                  ['Medium',  'restMedium',  120],
                  ['Small',   'restSmall',   90],
                ].map(([label, key, def]) => (
                  <div key={key}>
                    <div className="micro" style={{ marginBottom: 6, textAlign: 'center' }}>{label.toUpperCase()}</div>
                    <Stepper value={store.settings?.[key] || def} step={15} min={0} suffix="s"
                      onChange={(v) => setStore(s => ({ ...s, settings: { ...s.settings, [key]: v } }))} />
                  </div>
                ))}
              </div>
              <Hairline style={{ margin: '2px 0' }} />
              <div className="micro">PACEGUARD</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="micro" style={{ color: UI.inkSoft }}>Enabled</span>
                <div onClick={() => setStore(s => ({ ...s, settings: { ...s.settings, tempoEnabled: !s.settings?.tempoEnabled } }))} style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', background: store.settings?.tempoEnabled ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${store.settings?.tempoEnabled ? UI.goldSoft : UI.hairStrong}`, position: 'relative', transition: 'background 0.2s' }}>
                  <div style={{ position: 'absolute', top: 3, left: store.settings?.tempoEnabled ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: store.settings?.tempoEnabled ? '#0a0805' : UI.inkFaint, transition: 'left 0.2s' }} />
                </div>
              </div>
              {store.settings?.tempoEnabled && (<>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <div className="micro" style={{ marginBottom: 6, textAlign: 'center' }}>ECCENTRIC (DOWN)</div>
                    <Stepper value={store.settings?.tempoEccentric ?? 4} step={0.5} min={0.5} max={10} suffix="s"
                      onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, tempoEccentric: v } }))} />
                  </div>
                  <div>
                    <div className="micro" style={{ marginBottom: 6, textAlign: 'center' }}>CONCENTRIC (UP)</div>
                    <Stepper value={store.settings?.tempoConcentric ?? 1} step={0.5} min={0.5} max={10} suffix="s"
                      onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, tempoConcentric: v } }))} />
                  </div>
                </div>
                <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>
                  Beeps subdivide each phase evenly · count increases each beat
                </div>
              </>)}
              <Hairline style={{ margin: '2px 0' }} />
              <div className="micro">SMART PROGRESSION</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="micro" style={{ color: UI.inkSoft }}>Enabled</span>
                <div onClick={() => { const turningOn = !store.settings?.smartProgression; setStore(s => ({ ...s, settings: { ...s.settings, smartProgression: turningOn } })); if (turningOn) setProgDisclaimer(true); }} style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', background: store.settings?.smartProgression ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${store.settings?.smartProgression ? UI.goldSoft : UI.hairStrong}`, position: 'relative', transition: 'background 0.2s' }}>
                  <div style={{ position: 'absolute', top: 3, left: store.settings?.smartProgression ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: store.settings?.smartProgression ? '#0a0805' : UI.inkFaint, transition: 'left 0.2s' }} />
                </div>
              </div>
              {store.settings?.smartProgression && (<>
                <div>
                  <div className="micro" style={{ marginBottom: 6 }}>REP RANGE TOP (+reps above target)</div>
                  <Stepper value={store.settings?.progressionRangeTop ?? 4} step={1} min={1} max={10} suffix=" reps"
                    onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, progressionRangeTop: v } }))} />
                </div>
                <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>
                  If target is 8 reps and range top is +4, weight increases only when all sets reach 12 reps.
                </div>
                <Btn onClick={() => setProgConfigOpen(true)}>Configure exercises</Btn>
              </>)}
            </div>
          )}
        </Frame>

        {/* Equipment config sheet — increment + max per category */}
        <Sheet open={progConfigOpen} onClose={() => setProgConfigOpen(false)} title="Equipment increments">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 72px', gap: 8, padding: '0 4px 8px', borderBottom: `0.5px solid ${UI.hair}` }}>
              <span className="micro" style={{ color: UI.inkFaint }}>Equipment</span>
              <span className="micro" style={{ color: UI.inkFaint, textAlign: 'center' }}>Increment</span>
              <span className="micro" style={{ color: UI.inkFaint, textAlign: 'center' }}>Max kg</span>
            </div>
            {(window.EQUIPMENT_TYPES || []).map(({ key, label }) => {
              const cfg = store.settings?.equipmentConfig?.[key] ?? {};
              const setField = (field, val) => setStore(s => ({
                ...s,
                settings: {
                  ...s.settings,
                  equipmentConfig: { ...s.settings?.equipmentConfig, [key]: { ...(s.settings?.equipmentConfig?.[key] ?? {}), [field]: val } },
                },
              }));
              return (
                <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 72px', gap: 8, alignItems: 'center', padding: '10px 4px', borderBottom: `0.5px solid ${UI.hair}` }}>
                  <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>{label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 8, padding: '6px 8px' }}>
                    <NumInput value={cfg.increment ?? null} placeholder="—" onChange={v => setField('increment', v)} style={{ fontSize: 13, width: '100%' }} />
                    <span className="micro" style={{ color: UI.inkFaint, flexShrink: 0 }}>kg</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 8, padding: '6px 8px' }}>
                    <NumInput value={cfg.maxKg ?? null} placeholder="—" onChange={v => setField('maxKg', v)} style={{ fontSize: 13, width: '100%' }} />
                    <span className="micro" style={{ color: UI.inkFaint, flexShrink: 0 }}>kg</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.6, marginBottom: 16 }}>
            Set equipment categories on exercises in the Library. Individual overrides can be set per exercise.
          </div>
          <Btn onClick={() => setProgConfigOpen(false)}>Done</Btn>
        </Sheet>

        <Sheet open={progDisclaimer} onClose={() => setProgDisclaimer(false)} title="Smart Progression">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
            <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, lineHeight: 1.6 }}>
              The reps shown in your sets are <span style={{ color: UI.gold }}>minimum reps</span> — the floor the algorithm needs to track progression.
            </div>
            <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>
              Always train past that number. Push to failure or near-failure on each set. The algo only bumps weight when <em>all</em> sets hit the top of the range — so getting extra reps is how you earn the next weight.
            </div>
          </div>
          <Btn onClick={() => setProgDisclaimer(false)}>Got it</Btn>
        </Sheet>

        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderTop: `0.5px solid ${UI.hair}` }}>
            <span style={{ fontSize: 13, color: UI.inkSoft }}>Debug panel</span>
            <div onClick={() => { const next = !debugPanel; setDebugPanel(next); localStorage.setItem('logbook-debug-panel', String(next)); }} style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0, background: debugPanel ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${debugPanel ? UI.goldSoft : UI.hairStrong}`, position: 'relative', transition: 'background 0.2s' }}>
              <div style={{ position: 'absolute', top: 3, left: debugPanel ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: debugPanel ? '#0a0805' : UI.inkFaint, transition: 'left 0.2s' }} />
            </div>
          </div>
        )}
        <Btn kind="ghost" onClick={async () => {
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
          window.location.reload(true);
        }} style={{ fontSize: 12 }}>Clear app cache &amp; reload</Btn>
        <Btn kind="ghost" onClick={handleSignOut} style={{ color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.25)', fontSize: 12 }}>
          Sign out
        </Btn>
        <div className="micro" style={{ textAlign: 'center', marginTop: 8 }}>
          Zane · {swVersion || '…'} · Data in Supabase
        </div>
      </div>
      {confirmEl}
      <Sheet open={testPickerOpen} onClose={() => setTestPickerOpen(false)} title="Send test notification">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testPushover(0); }} style={{ fontSize: 13 }}>Now</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testPushover(10); }} style={{ fontSize: 13 }}>In 10 seconds</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testPushover(30); }} style={{ fontSize: 13 }}>In 30 seconds</Btn>
        </div>
      </Sheet>
      <Sheet open={pushKeyModalOpen} onClose={() => setPushKeyModalOpen(false)} title="Pushover User Key">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, color: UI.inkSoft, lineHeight: 1.5 }}>
            Enter your Pushover user key. Find it at pushover.net after logging in.
          </div>
          <input
            value={pushKeyDraft}
            onChange={e => setPushKeyDraft(e.target.value)}
            placeholder="uXXXXXXXXXXXXXXXXXXXX"
            style={{
              background: UI.bgInset, border: `0.5px solid ${pushKeyDraft && !pushKeyValid ? 'rgba(var(--danger-rgb),0.5)' : UI.hairStrong}`,
              borderRadius: 10, padding: '10px 14px',
              fontFamily: UI.fontUi, fontSize: 13, color: UI.ink,
              outline: 'none', width: '100%', boxSizing: 'border-box',
            }}
            autoCorrect="off" autoCapitalize="none" spellCheck={false}
          />
          {pushKeyDraft && !pushKeyValid && (
            <div className="micro" style={{ color: 'rgba(var(--danger-rgb),0.85)' }}>Invalid key — must be 30 alphanumeric characters</div>
          )}
          <Btn onClick={confirmPushKey} disabled={!pushKeyValid}>Enable notifications</Btn>
        </div>
      </Sheet>
    </Screen>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { SettingsScreen });
