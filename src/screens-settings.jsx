/* Settings screen — appearance, training, data, account, admin */

const { useState: useStateSet, useEffect: useEffectSet, useRef: useRefSet } = React;

// ─── Shared helpers (module-level for stable refs) ────────────────────

const fmtSec = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function SecHead({ label, open, onToggle }) {
  return (
    <button onClick={onToggle} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <div style={{ width: 2.5, height: 12, borderRadius: 999, flexShrink: 0, background: open ? 'var(--accent)' : UI.hairStrong, transition: 'background 0.18s' }} />
        <span style={{ fontSize: 11, letterSpacing: '0.13em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 600, color: open ? 'var(--accent)' : UI.inkSoft, transition: 'color 0.18s' }}>{label}</span>
      </div>
      <svg width="7" height="11" viewBox="0 0 8 12" fill="none" stroke={open ? 'var(--accent)' : UI.inkFaint} strokeWidth="1.3" strokeLinecap="round" style={{ transition: 'transform 0.18s, stroke 0.18s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}>
        <path d="M2 1l5 5-5 5" />
      </svg>
    </button>
  );
}

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

function NavRow({ label, hint, onTap, first = false }) {
  return (
    <>
      {!first && <div className="knurl" />}
      <button onClick={onTap} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', WebkitTapHighlightColor: 'transparent' }}>
        <span style={{ fontSize: 16, color: UI.inkSoft, fontFamily: UI.fontUi }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hint != null && <span style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi }}>{hint}</span>}
          <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.3" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>
        </div>
      </button>
    </>
  );
}

const accentBtn = { background: 'rgba(var(--accent-rgb),0.10)', border: '0.5px solid rgba(var(--accent-rgb),0.22)', color: 'var(--accent)', padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent', flexShrink: 0 };

// ─── Debug panel overlay ─────────────────────────────────────────────
function DebugPanel({ onClose }) {
  const [entries, setEntries] = useStateSet([]);
  useEffectSet(() => {
    const refresh = () => setEntries([...(window._dbg || [])].reverse());
    refresh();
    const id = setInterval(refresh, 400);
    return () => clearInterval(id);
  }, []);

  const buildText = () => {
    const log = window._dbg || [];
    return [...log].reverse().map((e, idx, arr) => {
      const prev = arr[idx + 1];
      const delta = prev ? `+${e.t - prev.t}ms` : '      ';
      const ts = new Date(e.t).toISOString().slice(11, 23);
      return `${ts}  ${delta.padStart(8)}  ${e.msg}`;
    }).join('\n');
  };

  const exportTxt = () => {
    const blob = new Blob([buildText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zane-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyLog = () => navigator.clipboard?.writeText(buildText()).catch(() => {});

  const tbBtn = {
    background: 'none', border: '0.5px solid rgba(255,255,255,0.2)', borderRadius: 4,
    color: '#888', fontSize: 10, padding: '4px 9px', cursor: 'pointer', fontFamily: 'monospace',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9991,
      background: 'rgba(8,6,3,0.97)', display: 'flex', flexDirection: 'column',
      fontFamily: 'monospace', fontSize: 11,
    }}>
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 12px 10px',
        borderBottom: '0.5px solid rgba(255,255,255,0.12)',
      }}>
        <span style={{ flex: 1, color: '#c9a961', fontWeight: 700, fontSize: 11, letterSpacing: '0.10em' }}>DEBUG LOG</span>
        <button onClick={exportTxt} style={tbBtn}>EXPORT .TXT</button>
        <button onClick={copyLog} style={tbBtn}>COPY</button>
        <button onClick={() => { window._dbg = []; setEntries([]); }} style={tbBtn}>CLEAR</button>
        <button onClick={onClose} style={{ ...tbBtn, fontSize: 18, padding: '1px 8px', border: 'none', color: '#aaa' }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 calc(env(safe-area-inset-bottom, 0px) + 8px)' }}>
        {entries.length === 0 && (
          <div style={{ color: '#444', padding: '16px 12px', fontSize: 12 }}>— no entries —</div>
        )}
        {entries.map((e, idx) => {
          const prev = entries[idx + 1];
          const delta = prev ? e.t - prev.t : 0;
          const color = e.msg.startsWith('[ERROR]') ? '#f55'
            : e.msg.startsWith('[WARN]') ? '#f96'
            : e.msg.includes('BLOCK') ? '#e87'
            : e.msg.includes('NULL') ? '#f55'
            : e.msg.includes('complete') || e.msg.includes('UNLOCK') ? '#c9a961'
            : e.msg.startsWith('[NAV]') ? '#7bc'
            : e.msg.startsWith('[LOG]') ? '#777'
            : '#9db';
          return (
            <div key={idx} style={{
              padding: '3px 10px', borderBottom: '0.5px solid rgba(255,255,255,0.04)',
              display: 'flex', gap: 8, alignItems: 'baseline',
            }}>
              <span style={{ color: '#444', flexShrink: 0, width: 54, textAlign: 'right', fontSize: 10 }}>
                {prev ? `+${delta}ms` : ''}
              </span>
              <span style={{ color, wordBreak: 'break-all' }}>{e.msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────
function SettingsScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [nickname, setNickname] = useStateSet(store.user?.name || '');
  const [appearanceOpen, setAppearanceOpen] = useStateSet(false);
  const [dataOpen, setDataOpen] = useStateSet(false);
  const [activeUsersOpen, setActiveUsersOpen] = useStateSet(false);
  const [accountOpen, setAccountOpen] = useStateSet(false);
  const [trainingOpen, setTrainingOpen] = useStateSet(false);
  const [coachingOpen, setCoachingOpen] = useStateSet(false);
  // Training sub-sheets
  const [restSheet, setRestSheet] = useStateSet(false);
  const [paceguardSheet, setPaceguardSheet] = useStateSet(false);
  const [progressionSheet, setProgressionSheet] = useStateSet(false);
  const [progConfigOpen, setProgConfigOpen] = useStateSet(false);
  const [progDisclaimer, setProgDisclaimer] = useStateSet(false);
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
  const [pushEnabled, setPushEnabled] = useStateSet(() => store.settings?.pushEnabled ?? localStorage.getItem('logbook-push-enabled') === 'true');
  const [pushKeyDraft, setPushKeyDraft] = useStateSet('');
  const [pushKeyModalOpen, setPushKeyModalOpen] = useStateSet(false);
  const [testPickerOpen, setTestPickerOpen] = useStateSet(false);
  const [reminderEnabled, setReminderEnabled] = useStateSet(() => store.settings?.reminderEnabled ?? false);
  const [reminderTime, setReminderTime] = useStateSet(() => store.settings?.reminderTime ?? '07:00');
  const [cycleWeekView, setCycleWeekView] = useStateSet(() => store.settings?.cycleWeekView ?? localStorage.getItem('logbook-cycle-week-view') === 'true');
  const [darkMode, setDarkMode] = useStateSet(() => store.settings?.darkMode ?? localStorage.getItem('logbook-dark-mode') ?? 'dark');
  const [showWarmupInSummary, setShowWarmupInSummary] = useStateSet(() => store.settings?.showWarmupInSummary ?? true);
  const isAdmin = store.user?.email === 'office@btc-prime.biz';
  const [debugPanelOpen, setDebugPanelOpen] = useStateSet(false);

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
    loadSessions(); if (isAdmin) loadGrants();
    const iv = setInterval(() => { loadSessions(); setNowS(Date.now()); }, 2000);
    return () => { mounted = false; clearInterval(iv); };
  }, [hasActiveUsersAccess, isAdmin]);

  useEffectSet(() => {
    if (!('caches' in window)) return;
    caches.keys().then(keys => { const name = keys.find(k => k.startsWith('zane-')); if (name) setSwVersion(name.replace('zane-', '')); });
  }, []);

  const addGrant = async () => {
    const email = newGrantEmail.trim().toLowerCase();
    if (!email.includes('@') || activeGrants.includes(email)) return;
    await LB.supabase.rpc('set_active_users_grant', { p_email: email, p_granted: true });
    setActiveGrants(g => [...g, email]); setNewGrantEmail('');
  };
  const removeGrant = async (email) => {
    await LB.supabase.rpc('set_active_users_grant', { p_email: email, p_granted: false });
    setActiveGrants(g => g.filter(x => x !== email));
  };

  const pushStatusTimer = useRefSet(null);
  useEffectSet(() => () => clearTimeout(pushStatusTimer.current), []);
  const togglePush = () => {
    if (!pushEnabled) {
      if (store.settings?.pushoverUserKey) { setPushEnabled(true); localStorage.setItem('logbook-push-enabled', 'true'); setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: true } })); }
      else { setPushKeyDraft(''); setPushKeyModalOpen(true); }
    } else { setPushEnabled(false); localStorage.setItem('logbook-push-enabled', 'false'); setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: false } })); }
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
      const res = await fetch(LB.PUSHOVER_URL, { method: 'POST', headers: { 'Authorization': `Bearer ${LB.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Rest done — keep going! 💪', title: 'Zane Test', delaySeconds, nonce: String(Date.now()), userKey: store.settings?.pushoverUserKey ?? '' }) });
      if (res.status === 202) { setPushStatus(`✓ Scheduled — notification in ~${delaySeconds}s`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), (delaySeconds + 15) * 1000); }
      else { const data = await res.json(); setPushStatus(data.status === 1 ? '✓ Sent' : `Error: ${JSON.stringify(data)}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
    } catch (e) { setPushStatus(`Error: ${e.message}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
  };
  const toggleReminder = () => { const next = !reminderEnabled; setReminderEnabled(next); setStore(s => ({ ...s, settings: { ...s.settings, reminderEnabled: next } })); };
  const updateReminderTime = (val) => { setReminderTime(val); setStore(s => ({ ...s, settings: { ...s.settings, reminderTime: val } })); };
  const saveNickname = () => { const t = nickname.trim(); if (!t || t === store.user?.name) return; setStore(s => ({ ...s, user: { ...s.user, name: t } })); };
  const exportData = (filename) => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename || `zane-${LB.todayISO()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importData = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      let backup; try { backup = JSON.parse(await file.text()); } catch (_) { await confirm('The selected file is not valid JSON.', { title: 'Invalid file', ok: 'OK' }); return; }
      if (!backup.sessions || !backup.exercises || !backup.schedules) { await confirm('This file does not look like a Zane backup.', { title: 'Invalid backup', ok: 'OK' }); return; }
      const latestSession = [...(backup.sessions || [])].filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0];
      const backupDate = latestSession ? new Date(latestSession.ended).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : 'unknown date';
      const ok = await confirm(`This backup contains data up to ${backupDate}. Your current data will be downloaded first, then replaced.`, { title: 'Restore backup?', ok: 'Restore', danger: true });
      if (!ok) return;
      exportData(`zane-before-import-${LB.todayISO()}.json`); setImporting(true);
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

  // Training hints
  const restHint = fmtSec(store.settings?.restDefault ?? 120);
  const paceguardHint = store.settings?.tempoEnabled ? 'On' : 'Off';
  const progressionHint = store.settings?.smartProgression ? 'On' : 'Off';

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

        {/* ─── Active users ─── */}
        {hasActiveUsersAccess && (
          <Frame style={{ padding: '12px 14px' }}>
            {(() => {
              const dismissed = JSON.parse(localStorage.getItem('logbook-dismissed-sessions') || '[]');
              const activeCount = activeSessions.filter(s => !s.is_finished).length;
              const visibleSessions = activeSessions.filter(s => !s.is_finished || !dismissed.includes(s.session_id));
              return (
                <>
                  <button onClick={() => setActiveUsersOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 2.5, height: 12, borderRadius: 999, flexShrink: 0, background: activeUsersOpen ? 'var(--accent)' : UI.hairStrong, transition: 'background 0.18s' }} />
                      <span style={{ fontSize: 11, letterSpacing: '0.13em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 600, color: activeUsersOpen ? 'var(--accent)' : UI.inkSoft, transition: 'color 0.18s' }}>Active users</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {activeCount > 0 && <div style={{ background: 'var(--accent)', color: '#0a0805', borderRadius: 999, minWidth: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, fontFamily: UI.fontUi, padding: '0 5px' }}>{activeCount}</div>}
                      <svg width="7" height="11" viewBox="0 0 8 12" fill="none" stroke={activeUsersOpen ? 'var(--accent)' : UI.inkFaint} strokeWidth="1.3" strokeLinecap="round" style={{ transition: 'transform 0.18s', transform: activeUsersOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}><path d="M2 1l5 5-5 5" /></svg>
                    </div>
                  </button>
                  {activeUsersOpen && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
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
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `0.5px solid ${UI.hair}` }}>
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
                              style={{ flex: 1, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 8, padding: '7px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none' }} />
                            <button onClick={addGrant} disabled={!newGrantEmail.includes('@')} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: newGrantEmail.includes('@') ? UI.gold : UI.bgInset, color: newGrantEmail.includes('@') ? '#0a0805' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>Add</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </Frame>
        )}

        {/* ─── Coaching ─── */}
        <Frame style={{ padding: '12px 14px' }}>
          <SecHead label="Coaching" open={coachingOpen} onToggle={() => setCoachingOpen(v => !v)} />
          {coachingOpen && (
            <div style={{ marginTop: 14 }}>
              <window.Screens.CoachingSettingsSection store={store} setStore={setStore} userId={userId} go={go} />
            </div>
          )}
        </Frame>

        {/* ─── Account ─── */}
        <Frame style={{ padding: '12px 14px' }}>
          <SecHead label="Account" open={accountOpen} onToggle={() => setAccountOpen(v => !v)} />
          {accountOpen && (
            <div style={{ marginTop: 14 }}>
              {isQsUser && (
                <>
                  <div className="micro" style={{ marginBottom: 10 }}>Quick switch</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                    <div style={{ flex: 1, background: `linear-gradient(135deg, rgba(var(--accent-rgb),0.10), rgba(var(--accent-rgb),0.03))`, border: `0.5px solid ${UI.goldSoft}`, borderRadius: 10, padding: '10px 12px' }}>
                      <div className="micro-gold" style={{ marginBottom: 4 }}>Active</div>
                      <div style={{ fontFamily: UI.fontDisplay, fontSize: 18, color: UI.ink, lineHeight: 1.1 }}>{currentName}</div>
                    </div>
                    <button disabled={qsSwitching} onClick={async () => {
                      if (hasQsSession) { setQsSwitching(true); try { await LB.quickSwitch(otherQsEmail); window.location.reload(); } catch (e) { setQsSwitching(false); } }
                      else { const ok = await confirm(`You'll be signed out so ${otherName} can log in.`, { title: 'Set up quick switch?', ok: 'Sign out' }); if (ok) await LB.signOut(); }
                    }} style={{ flex: 1, background: 'transparent', border: `0.5px solid ${hasQsSession ? UI.hair : UI.hairStrong}`, borderRadius: 10, padding: '10px 12px', textAlign: 'left', cursor: qsSwitching ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent', opacity: qsSwitching ? 0.5 : 1 }}>
                      <div className="micro" style={{ marginBottom: 4, color: hasQsSession ? UI.inkFaint : 'rgba(var(--danger-rgb),0.7)' }}>{qsSwitching ? 'Switching…' : hasQsSession ? 'Tap to switch' : 'Log in first'}</div>
                      <div style={{ fontFamily: UI.fontDisplay, fontSize: 18, color: hasQsSession ? UI.inkSoft : UI.inkFaint, lineHeight: 1.1 }}>{otherName}</div>
                    </button>
                  </div>
                  <Hairline style={{ marginBottom: 14 }} />
                </>
              )}

              <div className="micro" style={{ marginBottom: 10 }}>Push notifications</div>
              <Row label="Enabled" first>
                <Toggle on={pushEnabled} onToggle={togglePush} />
              </Row>
              {store.settings?.pushoverUserKey && (
                <Row label="User key">
                  <button onClick={() => { setPushKeyDraft(store.settings.pushoverUserKey); setPushKeyModalOpen(true); }} style={accentBtn}>Change</button>
                </Row>
              )}
              {pushEnabled && (
                <Row label="Test notification">
                  <button onClick={() => setTestPickerOpen(true)} style={accentBtn}>Send</button>
                </Row>
              )}
              {pushStatus && <div className="micro" style={{ color: pushStatus.startsWith('✓') ? 'var(--accent)' : UI.inkSoft, textAlign: 'center', padding: '6px 0' }}>{pushStatus}</div>}

              <Hairline style={{ margin: '14px 0' }} />

              <div className="micro" style={{ marginBottom: 10 }}>Training reminder</div>
              <Row label="Remind on training days" first>
                <Toggle on={reminderEnabled} onToggle={toggleReminder} />
              </Row>
              {reminderEnabled && (
                <>
                  <Row label="Notify at">
                    <input type="time" value={reminderTime} onChange={e => updateReminderTime(e.target.value)}
                      style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 8, padding: '5px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none', colorScheme: 'dark' }} />
                  </Row>
                  {store.nextReminderAt && (() => {
                    const dt = new Date(store.nextReminderAt);
                    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
                    const tomorrowMid = new Date(todayMid); tomorrowMid.setDate(todayMid.getDate() + 1);
                    const remMid = new Date(dt); remMid.setHours(0, 0, 0, 0);
                    const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    const dateStr = remMid.getTime() === todayMid.getTime() ? 'Today' : remMid.getTime() === tomorrowMid.getTime() ? 'Tomorrow' : dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                    return <div className="micro" style={{ color: UI.inkFaint, textAlign: 'right', paddingTop: 6 }}>Next · {dateStr} · {timeStr}</div>;
                  })()}
                </>
              )}
            </div>
          )}
        </Frame>

        {/* ─── Training ─── */}
        <Frame style={{ padding: '12px 14px' }}>
          <SecHead label="Training" open={trainingOpen} onToggle={() => setTrainingOpen(v => !v)} />
          {trainingOpen && (
            <div style={{ marginTop: 4 }}>
              <NavRow label="Rest timers" hint={restHint} onTap={() => setRestSheet(true)} first />
              <NavRow label="Paceguard" hint={paceguardHint} onTap={() => setPaceguardSheet(true)} />
              <NavRow label="Smart progression" hint={progressionHint} onTap={() => setProgressionSheet(true)} />
              <Row label="Warmup sets in summary">
                <Toggle on={showWarmupInSummary} onToggle={() => { const n = !showWarmupInSummary; setShowWarmupInSummary(n); setStore(s => ({ ...s, settings: { ...s.settings, showWarmupInSummary: n } })); }} />
              </Row>
            </div>
          )}
        </Frame>

        {/* ─── Appearance ─── */}
        <Frame style={{ padding: '12px 14px' }}>
          <SecHead label="Appearance" open={appearanceOpen} onToggle={() => setAppearanceOpen(v => !v)} />
          {appearanceOpen && (
            <div style={{ marginTop: 14 }}>
              <div className="micro" style={{ marginBottom: 10 }}>Accent color</div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-end' }}>
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
            </div>
          )}
        </Frame>

        {/* ─── Data ─── */}
        <Frame style={{ padding: '12px 14px' }}>
          <SecHead label="Data" open={dataOpen} onToggle={() => setDataOpen(v => !v)} />
          {dataOpen && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn kind="ghost" onClick={() => exportData()} style={{ flex: 1 }}>Export JSON</Btn>
                <Btn kind="ghost" onClick={importData} disabled={importing} style={{ flex: 1 }}>{importing ? 'Importing…' : 'Import JSON'}</Btn>
              </div>
              <Btn kind="ghost" onClick={handleDeleteAll} style={{ color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.2)' }}>Delete all data</Btn>
            </div>
          )}
        </Frame>

        {/* ─── Admin ─── */}
        {isAdmin && (
          <NavRow label="Debug log" first onTap={() => setDebugPanelOpen(true)} />
        )}

        <Btn kind="ghost" onClick={async () => { if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } window.location.reload(true); }}>Clear cache &amp; reload</Btn>
        <Btn kind="ghost" onClick={handleSignOut} style={{ color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.2)' }}>Sign out</Btn>
        <div className="micro" style={{ textAlign: 'center', marginTop: 4 }}>Zane · {swVersion || '…'} · Data in Supabase</div>

      </div>

      {confirmEl}
      {debugPanelOpen && <DebugPanel onClose={() => setDebugPanelOpen(false)} />}

      {/* ══ Rest timers sheet ══ */}
      <Sheet open={restSheet} onClose={() => setRestSheet(false)} title="Rest timers">
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
        </div>
        <Btn onClick={() => setRestSheet(false)} style={{ marginTop: 8 }}>Done</Btn>
      </Sheet>

      {/* ══ Paceguard sheet ══ */}
      <Sheet open={paceguardSheet} onClose={() => setPaceguardSheet(false)} title="Paceguard">
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
        </div>
        <Btn onClick={() => setPaceguardSheet(false)}>Done</Btn>
      </Sheet>

      {/* ══ Smart progression sheet ══ */}
      <Sheet open={progressionSheet} onClose={() => setProgressionSheet(false)} title="Smart progression">
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
              <Btn onClick={() => { setProgressionSheet(false); setTimeout(() => setProgConfigOpen(true), 300); }}>Configure exercises</Btn>
            </>
          )}
          <Btn onClick={() => setProgressionSheet(false)}>Done</Btn>
        </div>
      </Sheet>

      {/* ══ Equipment config sheet ══ */}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 4, padding: '6px 8px', border: `1px solid ${UI.hair}` }}>
                  <NumInput value={cfg.increment ?? null} placeholder="—" onChange={v => setField('increment', v)} style={{ fontSize: 13, width: '100%' }} />
                  <span className="micro" style={{ flexShrink: 0 }}>kg</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 4, padding: '6px 8px', border: `1px solid ${UI.hair}` }}>
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

      {/* ══ Progression disclaimer sheet ══ */}
      <Sheet open={progDisclaimer} onClose={() => setProgDisclaimer(false)} title="Smart Progression">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, lineHeight: 1.6 }}>The reps shown in your sets are <span style={{ color: UI.gold }}>minimum reps</span> — the floor the algorithm needs to track progression.</div>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>Always train past that number. Push to failure or near-failure on each set. The algo only bumps weight when <em>all</em> sets hit the top of the range — so getting extra reps is how you earn the next weight.</div>
        </div>
        <Btn onClick={() => setProgDisclaimer(false)}>Got it</Btn>
      </Sheet>

      {/* ══ Test picker sheet ══ */}
      <Sheet open={testPickerOpen} onClose={() => setTestPickerOpen(false)} title="Send test notification">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testPushover(0); }}>Now</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testPushover(10); }}>In 10 seconds</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testPushover(30); }}>In 30 seconds</Btn>
        </div>
      </Sheet>

      {/* ══ Pushover key sheet ══ */}
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

    </Screen>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { SettingsScreen });
