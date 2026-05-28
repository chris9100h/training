/* Settings screen — haute horlogerie */

const { useState: useStateSet, useEffect: useEffectSet, useRef: useRefSet } = React;

// ─── Module-level helpers ─────────────────────────────────────────────

const fmtSec = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function SDiv({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '32px 0 22px' }}>
      <div style={{ width: 16, height: '0.5px', background: UI.hairStrong, flexShrink: 0 }} />
      <span className="display-it" style={{ fontSize: 17, color: UI.inkFaint, whiteSpace: 'nowrap', lineHeight: 1 }}>{label}</span>
      <div style={{ flex: 1, height: '0.5px', background: UI.hair }} />
    </div>
  );
}

function ToggleSwitch({ on, onToggle }) {
  return (
    <div onClick={onToggle} style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0, background: on ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${on ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`, position: 'relative', transition: 'background 0.2s', WebkitTapHighlightColor: 'transparent' }}>
      <div style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: on ? '#0a0805' : UI.inkFaint, transition: 'left 0.2s' }} />
    </div>
  );
}

function TRow({ label, sub, on, onToggle, control, last = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '13px 0', borderBottom: last ? 'none' : `0.5px solid ${UI.hair}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: UI.inkSoft, fontFamily: UI.fontUi }}>{label}</div>
        {sub && <div className="micro" style={{ marginTop: 4 }}>{sub}</div>}
      </div>
      {control ?? <ToggleSwitch on={!!on} onToggle={onToggle} />}
    </div>
  );
}

function SubHead({ children, style = {} }) {
  return <div className="micro-gold" style={{ marginBottom: 14, marginTop: 4, ...style }}>{children}</div>;
}

// ─── SETTINGS ────────────────────────────────────────────────────────
function SettingsScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [nickname, setNickname] = useStateSet(store.user?.name || '');
  const [activeUsersOpen, setActiveUsersOpen] = useStateSet(false);
  const [activeSessions, setActiveSessions] = useStateSet([]);
  const [qsSwitching, setQsSwitching] = useStateSet(false);
  const [activeGrants, setActiveGrants] = useStateSet([]);
  const [newGrantEmail, setNewGrantEmail] = useStateSet('');
  const [hasActiveUsersAccess, setHasActiveUsersAccess] = useStateSet(
    () => localStorage.getItem('logbook-active-users-access') === 'true'
  );
  const [nowS, setNowS] = useStateSet(Date.now());
  const [importing, setImporting] = useStateSet(false);
  const [swVersion, setSwVersion] = useStateSet('');
  const [pushStatus, setPushStatus] = useStateSet(null);
  const [pushEnabled, setPushEnabled] = useStateSet(
    () => store.settings?.pushEnabled ?? localStorage.getItem('logbook-push-enabled') === 'true'
  );
  const [pushKeyDraft, setPushKeyDraft] = useStateSet('');
  const [pushKeyModalOpen, setPushKeyModalOpen] = useStateSet(false);
  const [testPickerOpen, setTestPickerOpen] = useStateSet(false);
  const [reminderEnabled, setReminderEnabled] = useStateSet(() => store.settings?.reminderEnabled ?? false);
  const [reminderTime, setReminderTime] = useStateSet(() => store.settings?.reminderTime ?? '07:00');
  const [cycleWeekView, setCycleWeekView] = useStateSet(
    () => store.settings?.cycleWeekView ?? localStorage.getItem('logbook-cycle-week-view') === 'true'
  );
  const [darkMode, setDarkMode] = useStateSet(
    () => store.settings?.darkMode ?? localStorage.getItem('logbook-dark-mode') ?? 'dark'
  );
  const isAdmin = store.user?.email === 'office@btc-prime.biz';
  const [debugPanel, setDebugPanel] = useStateSet(() => localStorage.getItem('logbook-debug-panel') === 'true');
  const [progConfigOpen, setProgConfigOpen] = useStateSet(false);
  const [progDisclaimer, setProgDisclaimer] = useStateSet(false);
  const [timerEdit, setTimerEdit] = useStateSet(null);

  useEffectSet(() => {
    let mounted = true;
    LB.supabase.rpc('check_active_users_access')
      .then(({ data }) => {
        const val = !!data;
        localStorage.setItem('logbook-active-users-access', val);
        if (mounted) setHasActiveUsersAccess(val);
      }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffectSet(() => {
    if (!hasActiveUsersAccess) return;
    let mounted = true;
    const loadSessions = () => LB.supabase.rpc('get_active_sessions_overview')
      .then(({ data }) => { if (mounted) setActiveSessions(data || []); }).catch(() => {});
    const loadGrants = () => LB.supabase.rpc('get_active_users_grants')
      .then(({ data }) => { if (mounted) setActiveGrants((data || []).map(r => r.email)); }).catch(() => {});
    loadSessions();
    if (isAdmin) loadGrants();
    const iv = setInterval(() => { loadSessions(); setNowS(Date.now()); }, 2000);
    return () => { mounted = false; clearInterval(iv); };
  }, [hasActiveUsersAccess, isAdmin]);

  useEffectSet(() => {
    if (!('caches' in window)) return;
    caches.keys().then(keys => {
      const name = keys.find(k => k.startsWith('zane-'));
      if (name) setSwVersion(name.replace('zane-', ''));
    });
  }, []);

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

  const pushStatusTimer = useRefSet(null);
  const togglePush = () => {
    if (!pushEnabled) {
      if (store.settings?.pushoverUserKey) {
        setPushEnabled(true); localStorage.setItem('logbook-push-enabled', 'true');
        setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: true } }));
      } else { setPushKeyDraft(''); setPushKeyModalOpen(true); }
    } else {
      setPushEnabled(false); localStorage.setItem('logbook-push-enabled', 'false');
      setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: false } }));
    }
  };
  const pushKeyValid = /^[a-zA-Z0-9]{30}$/.test(pushKeyDraft.trim());
  const confirmPushKey = () => {
    if (!pushKeyValid) return;
    const key = pushKeyDraft.trim();
    setPushEnabled(true); localStorage.setItem('logbook-push-enabled', 'true');
    setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: true, pushoverUserKey: key } }));
    setPushKeyModalOpen(false);
  };
  const testPushover = async (delaySeconds = 0) => {
    clearTimeout(pushStatusTimer.current);
    setPushStatus(delaySeconds > 0 ? 'Sending… Lock screen now!' : 'Sending…');
    try {
      const res = await fetch(LB.PUSHOVER_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${LB.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
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
    const next = !reminderEnabled; setReminderEnabled(next);
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
    const a = document.createElement('a'); a.href = url; a.download = filename || `zane-${LB.todayISO()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importData = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      let backup;
      try { backup = JSON.parse(await file.text()); }
      catch (_) { await confirm('The selected file is not valid JSON.', { title: 'Invalid file', ok: 'OK' }); return; }
      if (!backup.sessions || !backup.exercises || !backup.schedules) {
        await confirm('This file does not look like a Zane backup.', { title: 'Invalid backup', ok: 'OK' }); return;
      }
      const latestSession = [...(backup.sessions || [])].filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0];
      const backupDate = latestSession ? new Date(latestSession.ended).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : 'unknown date';
      const ok = await confirm(`This backup contains data up to ${backupDate}. Your current data will be downloaded first, then replaced.`, { title: 'Restore backup?', ok: 'Restore', danger: true });
      if (!ok) return;
      exportData(`zane-before-import-${LB.todayISO()}.json`);
      setImporting(true);
      try { await LB.importFromBackup(backup, userId); LB.clearLocal(userId); window.location.reload(); }
      catch (err) { setImporting(false); await confirm(`Import failed: ${err.message || 'Unknown error'}`, { title: 'Error', ok: 'OK' }); }
    };
    input.click();
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

  const accentBtn = { background: 'rgba(var(--accent-rgb),0.10)', border: '0.5px solid rgba(var(--accent-rgb),0.25)', color: 'var(--accent)', padding: '6px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent' };

  const REST_TIMERS = [
    { key: 'restDefault', label: 'Default', short: 'DEF', def: 120 },
    { key: 'restBig',     label: 'Big',     short: 'BIG', def: 180 },
    { key: 'restMedium',  label: 'Medium',  short: 'MED', def: 120 },
    { key: 'restSmall',   label: 'Small',   short: 'SML', def: 90  },
  ];

  return (
    <Screen>
      <style>{`
        .s-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 3px; border-radius: 999px; cursor: pointer; outline: none; border: none; display: block; }
        .s-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); border: none; box-shadow: 0 2px 12px rgba(var(--accent-rgb),0.5), 0 0 0 3px rgba(var(--accent-rgb),0.15); cursor: pointer; }
        .s-slider::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: var(--accent); border: none; cursor: pointer; }
        .s-dial { transition: opacity 0.15s; }
        .s-dial:active { opacity: 0.7; }
      `}</style>

      {/* ─── Header ─── */}
      <ScreenHead
        ref_="REF. ZANE"
        sub={swVersion || '…'}
        title="Settings"
        onBack={() => go({ name: 'home' })}
      />

      <div style={{ padding: '0 22px 48px' }}>

        {/* ─── Profile ─── */}
        <div style={{ marginBottom: 6 }}>
          <div className="micro" style={{ marginBottom: 10 }}>Name</div>
          <input
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            onBlur={saveNickname}
            onKeyDown={e => e.key === 'Enter' && e.target.blur()}
            placeholder="Your name"
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontFamily: UI.fontDisplay, fontSize: 28, color: UI.ink, fontWeight: 400, padding: '0 0 8px', letterSpacing: '-0.01em', borderBottom: `0.5px solid ${UI.hairStrong}`, boxSizing: 'border-box' }}
          />
          <div className="micro" style={{ marginTop: 8 }}>{store.user?.email || userId}</div>
        </div>

        {/* ─── Active users ─── */}
        {hasActiveUsersAccess && (() => {
          const dismissed = JSON.parse(localStorage.getItem('logbook-dismissed-sessions') || '[]');
          const activeCount = activeSessions.filter(s => !s.is_finished).length;
          const visibleSessions = activeSessions.filter(s => !s.is_finished || !dismissed.includes(s.session_id));
          return (
            <div style={{ margin: '24px 0 0' }}>
              <button onClick={() => setActiveUsersOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', WebkitTapHighlightColor: 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="micro-gold">Active users</span>
                  {activeCount > 0 && <div style={{ background: 'var(--accent)', color: '#0a0805', borderRadius: 999, minWidth: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, fontFamily: UI.fontUi, padding: '0 5px' }}>{activeCount}</div>}
                </div>
                <svg width="7" height="11" viewBox="0 0 8 12" fill="none" stroke={activeUsersOpen ? 'var(--accent)' : UI.inkFaint} strokeWidth="1.3" strokeLinecap="round" style={{ transition: 'transform 0.2s', transform: activeUsersOpen ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}>
                  <path d="M2 1l5 5-5 5" />
                </svg>
              </button>
              {activeUsersOpen && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', paddingLeft: 2 }}>
                  {visibleSessions.length === 0
                    ? <div className="micro" style={{ color: UI.inkFaint, padding: '4px 0 8px' }}>Nobody training right now.</div>
                    : visibleSessions.map((s, i) => {
                      const isFinished = s.is_finished;
                      if (isFinished) {
                        const finishedMin = s.ended ? Math.round((nowS - new Date(s.ended).getTime()) / 60000) : null;
                        const finishedStr = finishedMin != null ? (finishedMin < 60 ? `${finishedMin}m ago` : `${Math.round(finishedMin / 60)}h ago`) : 'done';
                        return (
                          <div key={s.session_id} onClick={() => go({ name: 'spectator', targetUserId: s.user_id, userName: s.user_name, sessionId: s.session_id })}
                            style={{ display: 'grid', gridTemplateColumns: '12px 1fr 1fr auto', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: UI.inkFaint }} />
                            <span style={{ fontSize: 14, color: UI.inkSoft, fontWeight: 500, fontFamily: UI.fontUi }}>{s.user_name}</span>
                            <span className="display-it" style={{ fontSize: 13, color: UI.inkFaint }}>{s.day_name}</span>
                            <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{finishedStr}</span>
                          </div>
                        );
                      }
                      const blended = LB.calcBlended(s.started_at, s.avg_duration_seconds, s.avg_sets_total, s.sets_done, s.sets_total, nowS);
                      const remMin = blended?.remainingMin ?? null;
                      const ratio = blended?.progress ?? null;
                      const finishing = remMin === 0;
                      return (
                        <div key={s.session_id || i} onClick={() => go({ name: 'spectator', targetUserId: s.user_id, userName: s.user_name })}
                          style={{ display: 'grid', gridTemplateColumns: '12px 1fr 1fr auto', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: 'pulseDot 1.4s ease-in-out infinite' }} />
                          <span style={{ fontSize: 14, color: UI.ink, fontWeight: 500, fontFamily: UI.fontUi }}>{s.user_name}</span>
                          <span className="display-it" style={{ fontSize: 13, color: UI.inkSoft }}>{s.day_name}</span>
                          {ratio !== null ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                              <span className="num" style={{ fontSize: 11, color: finishing ? 'var(--accent-light)' : 'var(--accent)' }}>{finishing ? 'soon' : `~${remMin}m`}</span>
                              <div style={{ width: 40, height: 2, borderRadius: 999, background: UI.hairStrong, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${ratio * 100}%`, background: 'var(--accent)', borderRadius: 999 }} />
                              </div>
                            </div>
                          ) : <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{s.sets_done}/{s.sets_total}</span>}
                        </div>
                      );
                    })
                  }
                  {isAdmin && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `0.5px solid ${UI.hair}` }}>
                      <SubHead>Access</SubHead>
                      {activeGrants.length === 0 && <div className="micro" style={{ color: UI.inkGhost, marginBottom: 8 }}>No other users have access.</div>}
                      {activeGrants.map(email => (
                        <div key={email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `0.5px solid ${UI.hair}` }}>
                          <span style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi }}>{email}</span>
                          <button onClick={() => removeGrant(email)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.danger, fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <input value={newGrantEmail} onChange={e => setNewGrantEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addGrant()} placeholder="email@example.com"
                          style={{ flex: 1, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 8, padding: '7px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none' }} />
                        <button onClick={addGrant} disabled={!newGrantEmail.includes('@')} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: newGrantEmail.includes('@') ? UI.gold : UI.bgInset, color: newGrantEmail.includes('@') ? '#0a0805' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>Add</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ══════════════════ LOOK ══════════════════ */}
        <SDiv label="Look" />

        {/* Accent palette */}
        <SubHead>Accent color</SubHead>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 22 }}>
          {Object.entries(window.ACCENT_PALETTE).map(([key, c]) => {
            const active = (store.settings?.accentColor ?? 'copper') === key;
            return (
              <button key={key}
                onClick={() => { window.applyAccentColor(key); localStorage.setItem('logbook-accent-color', key); setStore(s => ({ ...s, settings: { ...s.settings, accentColor: key } })); }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
                <div style={{
                  width: active ? 38 : 26, height: active ? 38 : 26, borderRadius: '50%',
                  background: c.hex,
                  border: active ? `2.5px solid ${UI.ink}` : '2px solid transparent',
                  boxShadow: active ? `0 0 0 2px ${c.hex}, 0 6px 20px rgba(0,0,0,0.45)` : 'none',
                  transition: 'all 0.2s cubic-bezier(0.34,1.56,0.64,1)',
                }} />
                <span style={{ fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 700, color: active ? 'var(--accent)' : 'transparent', transition: 'color 0.2s', lineHeight: 1 }}>{c.label}</span>
              </button>
            );
          })}
        </div>

        {/* Appearance toggles */}
        <TRow label="Week view in cycle mode" sub="Show Mon–Sun instead of cycle days" on={cycleWeekView}
          onToggle={() => { const n = !cycleWeekView; setCycleWeekView(n); localStorage.setItem('logbook-cycle-week-view', String(n)); setStore(s => ({ ...s, settings: { ...s.settings, cycleWeekView: n } })); }} />
        <TRow label="OLED black background" sub="Pure black instead of dark gray" last on={darkMode === 'black'}
          onToggle={() => { const n = darkMode === 'black' ? 'dark' : 'black'; setDarkMode(n); localStorage.setItem('logbook-dark-mode', n); setStore(s => ({ ...s, settings: { ...s.settings, darkMode: n } })); }} />

        {/* ══════════════════ TRAINING ══════════════════ */}
        <SDiv label="Training" />

        {/* Rest timers — 4 SubDials */}
        <SubHead>Rest timers</SubHead>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 28 }}>
          {REST_TIMERS.map(({ key, label, short, def }) => {
            const val = store.settings?.[key] ?? def;
            return (
              <div key={key} className="s-dial"
                onClick={() => setTimerEdit({ key, label, def })}
                style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, WebkitTapHighlightColor: 'transparent' }}>
                <SubDial label={short} value={fmtSec(val)} size={76} gold />
              </div>
            );
          })}
        </div>

        {/* Paceguard */}
        <div style={{ paddingTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: store.settings?.tempoEnabled ? 16 : 0 }}>
            <div>
              <SubHead style={{ marginBottom: 3 }}>Paceguard</SubHead>
              <div className="micro" style={{ color: UI.inkFaint }}>Controlled rep tempo</div>
            </div>
            <ToggleSwitch on={!!store.settings?.tempoEnabled} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, tempoEnabled: !s.settings?.tempoEnabled } }))} />
          </div>
          {store.settings?.tempoEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 4 }}>
              <div>
                <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>Eccentric (down)</div>
                <Stepper value={store.settings?.tempoEccentric ?? 4} step={0.5} min={0.5} max={10} suffix="s" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, tempoEccentric: v } }))} />
              </div>
              <div>
                <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>Concentric (up)</div>
                <Stepper value={store.settings?.tempoConcentric ?? 1} step={0.5} min={0.5} max={10} suffix="s" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, tempoConcentric: v } }))} />
              </div>
            </div>
          )}
        </div>

        {/* Smart Progression */}
        <div style={{ marginTop: 22, paddingTop: 22, borderTop: `0.5px solid ${UI.hair}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: store.settings?.smartProgression ? 16 : 0 }}>
            <div>
              <SubHead style={{ marginBottom: 3 }}>Smart Progression</SubHead>
              <div className="micro" style={{ color: UI.inkFaint }}>Auto weight increase</div>
            </div>
            <ToggleSwitch on={!!store.settings?.smartProgression}
              onToggle={() => { const t = !store.settings?.smartProgression; setStore(s => ({ ...s, settings: { ...s.settings, smartProgression: t } })); if (t) setProgDisclaimer(true); }} />
          </div>
          {store.settings?.smartProgression && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div className="micro" style={{ marginBottom: 8 }}>Rep range top (+reps above target)</div>
                <Stepper value={store.settings?.progressionRangeTop ?? 4} step={1} min={1} max={10} suffix=" reps" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, progressionRangeTop: v } }))} />
              </div>
              <Btn onClick={() => setProgConfigOpen(true)}>Configure exercises</Btn>
            </div>
          )}
        </div>

        {/* ══════════════════ ACCOUNT ══════════════════ */}
        <SDiv label="Account" />

        {/* Quick switch */}
        {isQsUser && (
          <div style={{ marginBottom: 24 }}>
            <SubHead>Quick switch</SubHead>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, background: `linear-gradient(135deg, rgba(var(--accent-rgb),0.10), rgba(var(--accent-rgb),0.03))`, border: `0.5px solid ${UI.goldSoft}`, borderRadius: 12, padding: '12px 14px' }}>
                <div className="micro-gold" style={{ marginBottom: 6 }}>Active</div>
                <div style={{ fontFamily: UI.fontDisplay, fontSize: 20, color: UI.ink, lineHeight: 1.1 }}>{currentName}</div>
              </div>
              <button disabled={qsSwitching} onClick={async () => {
                if (hasQsSession) {
                  setQsSwitching(true);
                  try { await LB.quickSwitch(otherQsEmail); window.location.reload(); }
                  catch (e) { setQsSwitching(false); console.error('Quick switch failed', e); }
                } else {
                  const ok = await confirm(`You'll be signed out so ${otherName} can log in.`, { title: 'Set up quick switch?', ok: 'Sign out' });
                  if (ok) await LB.signOut();
                }
              }} style={{ flex: 1, background: 'transparent', border: `0.5px solid ${hasQsSession ? UI.hair : UI.hairStrong}`, borderRadius: 12, padding: '12px 14px', textAlign: 'left', cursor: qsSwitching ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent', opacity: qsSwitching ? 0.5 : 1 }}>
                <div className="micro" style={{ marginBottom: 6, color: hasQsSession ? UI.inkFaint : 'rgba(var(--danger-rgb),0.7)' }}>{qsSwitching ? 'Switching…' : hasQsSession ? 'Tap to switch' : 'Log in first'}</div>
                <div style={{ fontFamily: UI.fontDisplay, fontSize: 20, color: hasQsSession ? UI.inkSoft : UI.inkFaint, lineHeight: 1.1 }}>{otherName}</div>
              </button>
            </div>
          </div>
        )}

        {/* Push notifications */}
        <SubHead>Push notifications</SubHead>
        <TRow label="Enabled" on={pushEnabled} onToggle={togglePush} />
        {store.settings?.pushoverUserKey && (
          <TRow label="User key" control={<button onClick={() => { setPushKeyDraft(store.settings.pushoverUserKey); setPushKeyModalOpen(true); }} style={accentBtn}>Change</button>} />
        )}
        {pushEnabled && (
          <TRow label="Test" last control={<button onClick={() => setTestPickerOpen(true)} style={accentBtn}>Send</button>} />
        )}
        {!pushEnabled && !store.settings?.pushoverUserKey && <div style={{ height: 4 }} />}
        {pushStatus && <div className="micro" style={{ color: pushStatus.startsWith('✓') ? 'var(--accent)' : UI.inkSoft, textAlign: 'center', padding: '8px 0' }}>{pushStatus}</div>}

        {/* Training reminder */}
        <div style={{ marginTop: 22, paddingTop: 22, borderTop: `0.5px solid ${UI.hair}` }}>
          <SubHead>Training reminder</SubHead>
          <TRow label="Remind on training days" on={reminderEnabled} onToggle={toggleReminder} last={!reminderEnabled} />
          {reminderEnabled && (
            <>
              <TRow label="Notify at" last={!store.nextReminderAt}
                control={<input type="time" value={reminderTime} onChange={e => updateReminderTime(e.target.value)}
                  style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 8, padding: '6px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none', colorScheme: 'dark' }} />}
              />
              {store.nextReminderAt && (() => {
                const dt = new Date(store.nextReminderAt);
                const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
                const tomorrowMid = new Date(todayMid); tomorrowMid.setDate(todayMid.getDate() + 1);
                const remMid = new Date(dt); remMid.setHours(0, 0, 0, 0);
                const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const dateStr = remMid.getTime() === todayMid.getTime() ? 'Today'
                  : remMid.getTime() === tomorrowMid.getTime() ? 'Tomorrow'
                  : dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                return <div className="micro" style={{ color: UI.inkFaint, textAlign: 'right', padding: '8px 0' }}>Next · {dateStr} · {timeStr}</div>;
              })()}
            </>
          )}
        </div>

        {/* ══════════════════ DATA ══════════════════ */}
        <SDiv label="Data" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <Btn kind="ghost" onClick={() => exportData()} style={{ fontSize: 12 }}>Export JSON</Btn>
          <Btn kind="ghost" onClick={importData} disabled={importing} style={{ fontSize: 12 }}>{importing ? 'Importing…' : 'Import JSON'}</Btn>
        </div>
        <Btn kind="ghost" onClick={handleDeleteAll} style={{ color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.2)', fontSize: 12 }}>Delete all data</Btn>

        {/* ══════════════════ SYSTEM ══════════════════ */}
        <SDiv label="System" />

        {isAdmin && (
          <TRow label="Debug panel" last on={debugPanel} onToggle={() => { const n = !debugPanel; setDebugPanel(n); localStorage.setItem('logbook-debug-panel', String(n)); }} />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: isAdmin ? 16 : 0 }}>
          <Btn kind="ghost" onClick={async () => {
            if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
            window.location.reload(true);
          }} style={{ fontSize: 12 }}>Clear cache &amp; reload</Btn>
          <Btn kind="ghost" onClick={handleSignOut} style={{ color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.2)', fontSize: 12 }}>Sign out</Btn>
        </div>

      </div>

      {confirmEl}

      {/* ─── Rest timer adjustment sheet ─── */}
      <Sheet open={!!timerEdit} onClose={() => setTimerEdit(null)} title={timerEdit?.label ?? ''}>
        {timerEdit && (() => {
          const { key, def } = timerEdit;
          const val = store.settings?.[key] ?? def;
          const pct = Math.min(100, (val / 600) * 100);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
              <div style={{ textAlign: 'center' }}>
                <div className="num" style={{ fontSize: 80, color: 'var(--accent)', fontWeight: 300, lineHeight: 1, letterSpacing: '-0.03em' }}>{fmtSec(val)}</div>
                <div className="micro" style={{ marginTop: 12, color: UI.inkFaint }}>0 seconds — 10 minutes</div>
              </div>
              <input type="range" min={0} max={600} step={15} value={val}
                onChange={e => setStore(s => ({ ...s, settings: { ...s.settings, [key]: +e.target.value } }))}
                className="s-slider"
                style={{ background: `linear-gradient(to right, var(--accent) ${pct}%, ${UI.hairStrong} ${pct}%)` }}
              />
              <Btn onClick={() => setTimerEdit(null)}>Done</Btn>
            </div>
          );
        })()}
      </Sheet>

      <Sheet open={testPickerOpen} onClose={() => setTestPickerOpen(false)} title="Test notification">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testPushover(0); }}>Now</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testPushover(10); }}>In 10 seconds</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testPushover(30); }}>In 30 seconds</Btn>
        </div>
      </Sheet>

      <Sheet open={pushKeyModalOpen} onClose={() => setPushKeyModalOpen(false)} title="Pushover User Key">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, color: UI.inkSoft, lineHeight: 1.5 }}>Enter your Pushover user key. Find it at pushover.net after logging in.</div>
          <input value={pushKeyDraft} onChange={e => setPushKeyDraft(e.target.value)} placeholder="uXXXXXXXXXXXXXXXXXXXX"
            style={{ background: UI.bgInset, border: `0.5px solid ${pushKeyDraft && !pushKeyValid ? 'rgba(var(--danger-rgb),0.5)' : UI.hairStrong}`, borderRadius: 10, padding: '10px 14px', fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' }}
            autoCorrect="off" autoCapitalize="none" spellCheck={false} />
          {pushKeyDraft && !pushKeyValid && <div className="micro" style={{ color: 'rgba(var(--danger-rgb),0.85)' }}>Invalid key — must be 30 alphanumeric characters</div>}
          <Btn onClick={confirmPushKey} disabled={!pushKeyValid}>Enable notifications</Btn>
        </div>
      </Sheet>

      <Sheet open={progConfigOpen} onClose={() => setProgConfigOpen(false)} title="Equipment increments">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 72px', gap: 8, padding: '0 4px 8px', borderBottom: `0.5px solid ${UI.hair}` }}>
            <span className="micro">Equipment</span>
            <span className="micro" style={{ textAlign: 'center' }}>Increment</span>
            <span className="micro" style={{ textAlign: 'center' }}>Max kg</span>
          </div>
          {(window.EQUIPMENT_TYPES || []).map(({ key, label }) => {
            const cfg = store.settings?.equipmentConfig?.[key] ?? {};
            const setField = (field, val) => setStore(s => ({ ...s, settings: { ...s.settings, equipmentConfig: { ...s.settings?.equipmentConfig, [key]: { ...(s.settings?.equipmentConfig?.[key] ?? {}), [field]: val } } } }));
            return (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 72px', gap: 8, alignItems: 'center', padding: '10px 4px', borderBottom: `0.5px solid ${UI.hair}` }}>
                <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 8, padding: '6px 8px' }}>
                  <NumInput value={cfg.increment ?? null} placeholder="—" onChange={v => setField('increment', v)} style={{ fontSize: 13, width: '100%' }} />
                  <span className="micro" style={{ flexShrink: 0 }}>kg</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 8, padding: '6px 8px' }}>
                  <NumInput value={cfg.maxKg ?? null} placeholder="—" onChange={v => setField('maxKg', v)} style={{ fontSize: 13, width: '100%' }} />
                  <span className="micro" style={{ flexShrink: 0 }}>kg</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.6, marginBottom: 16 }}>Set equipment categories on exercises in the Library. Individual overrides can be set per exercise.</div>
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

    </Screen>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { SettingsScreen });
