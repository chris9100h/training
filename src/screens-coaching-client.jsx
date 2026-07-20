/* Coaching screens — client view (CoachClientScreen + overview/plan/sessions
   tabs + charts). Shares globals (React aliases, helpers, isImprovement/
   isDecline) with screens-coaching-core.jsx, loaded first. */

function CoachClientScreen({ store, setStore, userId, go, coachingId, clientId, clientName, checkinAt, initialTab, backRoute = 'settings', hideTopBar = false, isSelf = false }) {
  const [tab, setTab] = useStateC(initialTab || 'overview');
  const [selectedSession, setSelectedSession] = useStateC(null);

  const openSession = (session) => { setSelectedSession(session); setTab('sessions'); };

  const handleTabChange = (id) => {
    if (id === 'checkins' && checkinAt) {
      try { localStorage.setItem(`logbook-coach-ci-seen-${coachingId}`, checkinAt); } catch (_) {}
    }
    setTab(id);
  };
  const [clientStore, setClientStore] = useStateC(null);
  const [loadError, setLoadError] = useStateC(null);

  const coachingEntry = store?.coaching?.asCoach?.find(c => c.id === coachingId);
  const [checkinEnabled, setCheckinEnabled] = useStateC(coachingEntry?.checkinEnabled ?? true);
  const [ciToggling, setCiToggling] = useStateC(false);
  const handleToggleCheckin = async () => {
    if (ciToggling) return;
    const next = !checkinEnabled;
    setCheckinEnabled(next);
    setCiToggling(true);
    try {
      await LB.setCheckinEnabled(coachingId, next);
    } catch (_) {
      setCheckinEnabled(!next);
      setCiToggling(false);
      return;
    }
    try {
      const threadId = await LB.getOrCreateCoachingThread(coachingId, 'Weekly Check-in', userId);
      const msg = next
        ? 'Check-ins have been re-enabled. You can submit your weekly check-in again.'
        : 'Check-ins have been paused by your coach.';
      await LB.addCoachingNote(coachingId, 'general', null, null, msg, userId, threadId);
    } catch (_) {}
    finally { setCiToggling(false); }
  };

  useEffectC(() => {
    let on = true;
    // Reset so a switch to another client never flashes the previous client's
    // data, and ignore a resolved response that arrives after we've moved on.
    setClientStore(null);
    setLoadError(null);
    LB.loadClientStore(clientId)
      .then(data => { if (on) setClientStore(data); })
      .catch(e => { if (on) setLoadError(e.message); });
    return () => { on = false; };
  }, [clientId]);

  // The live "TRAINING NOW" banner reads clientStore.inProgress, which is a
  // one-time snapshot from loadClientStore. Poll the lightweight status endpoint
  // (as the client roster does) so the banner appears when the client starts a
  // session and clears when they finish, instead of freezing at entry-time state.
  useEffectC(() => {
    if (isSelf) return;
    let on = true;
    const poll = () => {
      LB.loadCoachClientsStatus()
        .then(rows => {
          if (!on) return;
          const mine = (rows || []).find(r => r.clientId === clientId);
          const live = (mine && mine.inProgressSessionId) || null;
          setClientStore(s => (s && (s.inProgress || null) !== live) ? { ...s, inProgress: live } : s);
        })
        .catch(() => {});
    };
    const iv = setInterval(poll, 5000);
    return () => { on = false; clearInterval(iv); };
  }, [clientId, isSelf]);

  const reloadClient = async () => {
    try {
      const fresh = await LB.loadClientStore(clientId);
      setClientStore(fresh);
    } catch (_) {}
  };

  const TABS = [
    { id: 'overview',   icon: 'fa-chart-bar',         label: 'Overview' },
    { id: 'daily',      icon: 'fa-heart-pulse',        label: 'Daily' },
    { id: 'sessions',   icon: 'fa-dumbbell',           label: 'Sessions' },
    { id: 'setup',      icon: 'fa-sliders',            label: 'Setup' },
    { id: 'notes',      icon: 'fa-comment',            label: 'Notes' },
    { id: 'checkins',   icon: 'fa-clipboard-list',     label: 'Check-ins' },
  ];

  return (
    <Screen scroll={false}>
      {!hideTopBar && (
        isSelf
          ? <TopBar title="Coaching" onBack={backRoute !== 'settings' ? () => go({ name: backRoute }) : undefined} />
          : <TopBar
              title={clientName}
              sub={<span className="micro" style={{ color: 'var(--accent)', letterSpacing: '0.12em' }}>COACHING</span>}
              onBack={() => go({ name: backRoute })}
            />
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: `0.5px solid ${UI.hair}`, background: UI.bg, flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => handleTabChange(t.id)}
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
          {/* Sick / vacation status banner */}
          {clientStore.statusMode && (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--overlay-tint)', borderBottom: `0.5px solid ${UI.hairStrong}` }}>
              <i className={`fa-solid ${clientStore.statusMode === 'sick' ? 'fa-bed-pulse' : clientStore.statusMode === 'deload' ? 'fa-arrow-trend-down' : 'fa-umbrella-beach'}`} style={{ fontSize: 12, color: UI.inkFaint, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, fontFamily: UI.fontUi, color: UI.inkSoft, letterSpacing: '0.08em', fontWeight: 600 }}>
                {clientStore.statusMode === 'sick' ? 'SICK' : clientStore.statusMode === 'deload' ? 'DELOAD' : 'VACATION'}
                {clientStore.statusModeSince && (() => {
                  const since = new Date(clientStore.statusModeSince);
                  const days = Math.floor((Date.now() - since.getTime()) / 86400000) + 1;
                  const dateStr = since.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
                  return ` · SINCE ${dateStr} (${days}d)`;
                })()}
              </span>
            </div>
          )}
          {/* Live training banner (not for self — no point watching yourself) */}
          {clientStore.inProgress && !isSelf && (
            <div
              onClick={() => go({ name: 'spectator', targetUserId: clientId, userName: clientName })}
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: `rgba(var(--accent-rgb), 0.08)`, borderBottom: `0.5px solid rgba(var(--accent-rgb), 0.25)`, cursor: 'pointer' }}
            >
              <div style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', boxShadow: '0 0 6px rgba(var(--accent-rgb),0.8)', animation: 'pulseDot 1.5s ease-in-out infinite', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, fontFamily: UI.fontUi, color: 'var(--accent)', letterSpacing: '0.08em', fontWeight: 600 }}>TRAINING NOW · TAP TO WATCH</span>
              <ChevronRight color={'var(--accent)'} />
            </div>
          )}
          {tab === 'overview'   && <ClientOverviewTab clientStore={clientStore} coachingId={coachingId} userId={userId} onSelectSession={openSession} />}
          {tab === 'sessions'   && <ClientSessionsTab clientStore={clientStore} coachingId={coachingId} userId={userId} clientName={clientName} initialSelected={selectedSession} onClearSelected={() => setSelectedSession(null)} />}
          {tab === 'checkins'   && (isSelf
            ? <ClientCheckInTab coachingId={coachingId} clientId={clientId} userId={userId} store={store} setStore={setStore} isSelf />
            : <ClientCheckInsTab coachingId={coachingId} checkinEnabled={checkinEnabled} onToggle={handleToggleCheckin} toggling={ciToggling} store={store} setStore={setStore} userId={userId} clientUnit={clientStore.settings?.unit} />)}
          {tab === 'setup'      && <ClientSetupTab store={store} setStore={setStore} clientStore={clientStore} setClientStore={setClientStore} clientId={clientId} coachingId={coachingId} userId={userId} go={go} onReload={reloadClient} clientName={clientName} />}
          {tab === 'daily'      && <window.Screens.HealthClientLogs clientStore={clientStore} />}
          {tab === 'notes'      && <ClientNotesTab coachingId={coachingId} userId={userId} clientName={clientName} store={store} setStore={setStore} />}
        </div>
      )}
    </Screen>
  );
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function cyclePosFn(clientStore, date) {
  const activeSch = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId);
  if (!activeSch) return 0;
  // Flex plans advance per logged action, never by calendar date — the position
  // is the action-advanced cycleIndex, independent of `date` (date extrapolation
  // is meaningless for flex and drifts when the client rests).
  if (LB.isFlexPlan(activeSch)) {
    const cycleLen = activeSch.days?.length || 1;
    return (((clientStore.cycleIndex || 0) % cycleLen) + cycleLen) % cycleLen;
  }
  const d = new Date(date); d.setHours(12, 0, 0, 0);
  const dateStr = d.toISOString().slice(0, 10);
  if (activeSch.versions?.length) {
    const pos = LB.getCyclePosForDate(activeSch, dateStr);
    if (pos !== null) return pos;
  }
  const cycleLen = activeSch.days?.length || 1;
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
function localDateKey(d) { return LB.fmtISO(d); }

function getTodayDay(clientStore) {
  const activeSch = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId);
  if (!activeSch) return null;
  const todayStr = LB.todayISO();
  if (LB.isWeekdayPlan(activeSch)) {
    const todayWd = LB.isoWd(new Date());
    const vDays = LB.getPlanDaysForDate(activeSch, todayStr);
    return vDays.find(d => d.weekday === todayWd) || { id: 'rest-virtual', name: 'REST', items: [] };
  }
  if (activeSch.versions?.length) {
    const pos = LB.getCyclePosForDate(activeSch, todayStr);
    if (pos !== null) {
      const vDays = LB.getPlanDaysForDate(activeSch, todayStr);
      return vDays[pos] || null;
    }
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
  const isFlex = LB.isFlexPlan(activeSch);
  const flexGoal = activeSch.sessions_per_week || null;

  // When versions exist, the oldest entry's validFrom is the plan's true origin date —
  // use it instead of the (potentially reset) cycleStartDate / weekPlanStartDate.
  const oldestVersion = activeSch.versions?.length
    ? activeSch.versions[activeSch.versions.length - 1]
    : null;

  // For weekday plans, exclude sessions before the original plan activation.
  const planActivationStr = isWd
    ? (oldestVersion?.validFrom ?? clientStore.weekPlanStartDate?.slice(0, 10))
    : null;

  const planSessions = (clientStore.sessions || []).filter(s =>
    s.ended &&
    s.scheduleId === activeSch.id &&
    (!planActivationStr || !s.date || s.date.slice(0, 10) >= planActivationStr)
  );

  // Session date set — both stored date field and local-time of ended timestamp.
  const sessionDates = new Set();
  planSessions.forEach(s => {
    if (s.date) sessionDates.add(s.date.slice(0, 10));
    sessionDates.add(localDateKey(new Date(s.ended)));
  });

  // Determine the Monday from which adherence starts — don't penalize weeks before the plan was active.
  // Use weekPlanStartDate / cycleStartDate when set; fall back to earliest session.
  let planStartMonday = null;
  let planStartDateStr = null; // actual plan start date — days before this are ignored even within the first week
  const activationDateStr = oldestVersion?.validFrom
    ?? (isWd ? clientStore.weekPlanStartDate : clientStore.cycleStartDate);
  if (activationDateStr) {
    const d = new Date(activationDateStr); d.setHours(12, 0, 0, 0);
    const wd = LB.isoWd(d);
    planStartMonday = new Date(d);
    planStartMonday.setDate(d.getDate() - wd);
    planStartMonday.setHours(0, 0, 0, 0);
    planStartDateStr = activationDateStr.slice(0, 10);
  } else if (planSessions.length > 0) {
    const earliestMs = Math.min(...planSessions.map(s => new Date(s.ended).getTime()));
    const earliest = new Date(earliestMs); earliest.setHours(12, 0, 0, 0);
    const earliestWd = LB.isoWd(earliest);
    planStartMonday = new Date(earliest);
    planStartMonday.setDate(earliest.getDate() - earliestWd);
    planStartMonday.setHours(0, 0, 0, 0);
    planStartDateStr = localDateKey(planStartMonday);
  }
  if (!planStartMonday) return [];

  const today = new Date(); today.setHours(12, 0, 0, 0);
  const todayWd = LB.isoWd(today); // 0=Mon
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - todayWd);

  return Array.from({ length: weeksBack }, (_, w) => {
    const monday = new Date(thisMonday);
    monday.setDate(thisMonday.getDate() - w * 7);

    // Skip weeks before the plan was in use.
    if (monday < planStartMonday) return null;

    let planned = 0, done = 0;

    // Flex plans have no fixed training days — adherence is sessions trained
    // this week against the weekly frequency goal, regardless of which days.
    if (isFlex) {
      const weekEnd = new Date(monday); weekEnd.setDate(monday.getDate() + 7);
      const mondayKey = localDateKey(monday);
      const weekEndKey = localDateKey(weekEnd);
      // Count each session once (sessionDates can hold two keys per session).
      done = planSessions.filter(s => {
        const k = s.date ? s.date.slice(0, 10) : localDateKey(new Date(s.ended));
        return k >= mondayKey && k < weekEndKey;
      }).length;
      planned = flexGoal || 0;
      const pct = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : null;
      const isoWeek = (() => { const t = new Date(monday); t.setDate(t.getDate() + 4 - (t.getDay() || 7)); return Math.ceil((((t - new Date(t.getFullYear(), 0, 1)) / 86400000) + 1) / 7); })();
      const label = w === 0 ? 'This week' : w === 1 ? 'Last week' : `W${isoWeek}`;
      return { label, planned, done, pct };
    }

    for (let d = 0; d < 7; d++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + d);
      if (date > today) continue;

      const dateStr = localDateKey(date);
      let isTrainingDay = false;

      if (isWd) {
        const wd = LB.isoWd(date);
        const daysForDate = LB.getPlanDaysForDate(activeSch, dateStr);
        isTrainingDay = daysForDate.some(day => day.weekday === wd && day.items?.length > 0);
      } else {
        const daysForDate = LB.getPlanDaysForDate(activeSch, dateStr);
        const versionedPos = LB.getCyclePosForDate(activeSch, dateStr);
        const pos = versionedPos !== null ? versionedPos : cyclePosFn(clientStore, date);
        isTrainingDay = !!(daysForDate[pos]?.items?.length > 0);
      }

      if (isTrainingDay) {
        if (planStartDateStr && dateStr < planStartDateStr) continue;
        // Sick/vacation days don't count against adherence.
        const ts = date.getTime();
        const inStatusPeriod = (clientStore.statusPeriods || []).some(p => {
          const start = new Date(p.startedAt).getTime();
          const end = p.endedAt ? new Date(p.endedAt).getTime() : Date.now();
          return ts >= start && ts <= end;
        });
        if (inStatusPeriod) continue;
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

// ─── Recently-shipped-feature surfacing for the coach's single-client view ────
// These render program/session context the athlete already sees but the coach
// dashboard previously dropped: 5/3/1 cycle/TM progress, mesocycle block status,
// superset grouping, and the per-set rep target. All read-only, all from the
// client's already-loaded clientStore; nothing here mutates.

// Format a plan item's prescribed target: per-set (12/10/8), range (8-12),
// single (8), or time-based durations. Returns null when there's nothing to show.
function fmtRepTarget(item) {
  if (!item) return null;
  if (Array.isArray(item.timeSecPerSet) && item.timeSecPerSet.length) {
    return item.timeSecPerSet.map(t => LB.fmtDuration(t)).join(' / ');
  }
  if (item.repsPerSet && item.repsPerSet.length) return item.repsPerSet.join('/');
  if (item.repsMax != null) return `${item.reps}-${item.repsMax}`;
  return item.reps != null ? String(item.reps) : null;
}

// Resolve the prescribed plan item for a logged session entry, from the schedule
// the session belongs to. The target value reflects the plan's current
// prescription (plans rarely rewrite historical targets); returns null when the
// day/item can't be matched, so a wrong target is never shown.
function planItemForEntry(clientStore, session, exId) {
  if (!exId || !session) return null;
  const sch = (clientStore.schedules || []).find(s => s.id === session.scheduleId);
  if (!sch) return null;
  const day = (sch.days || []).find(d => d.id === session.dayId);
  if (!day) return null;
  return (day.items || []).find(it => it.exId === exId) || null;
}

// Superset/giant-set annotation for the read-only session views: consecutive
// entries sharing a supersetGroup get a header on the first member and a left
// accent rail on every member, so paired work reads differently from straight sets.
function supersetInfo(entries, i) {
  const grp = entries[i] && entries[i].supersetGroup;
  if (!grp) return { member: false, start: false, size: 0 };
  const start = i === 0 || entries[i - 1].supersetGroup !== grp;
  const size = entries.filter(e => e.supersetGroup === grp).length;
  return { member: true, start, size };
}
function SupersetHeader({ size }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px 2px' }}>
      <i className="fa-solid fa-link" style={{ fontSize: 9, color: UI.gold }} />
      <span className="micro" style={{ color: UI.gold, letterSpacing: '0.14em' }}>{LB.supersetLabel(size)}</span>
    </div>
  );
}

// Program status card: 5/3/1 cycle/week + per-lift Training-Max progress, and
// mesocycle block week / RIR target. Both come straight from the client's
// schedule + mesoStates already in the coach's clientStore. Renders nothing for
// a plain plan. mesoCurrentWeek / FiveThreeOneProgress are cross-file globals
// (screens-train / screens-schedule), guarded like the athlete-side callers.
function ClientProgramStatus({ sch, clientStore }) {
  if (!sch) return null;
  const is531 = LB.is531Plan(sch);
  const isMeso = !is531 && !!sch.mesocycle_weeks;
  if (!is531 && !isMeso) return null;

  let mesoBadge = null;
  if (isMeso) {
    const m = (clientStore.mesoStates || []).find(x => x.scheduleId === sch.id) || null;
    const weeks = sch.mesocycle_weeks;
    const mesoNum = (m?.completions ?? 0) + 1;
    const label = `MESO${mesoNum > 1 ? ' ' + mesoNum : ''}`;
    if (clientStore.statusMode === 'deload') {
      mesoBadge = `${label} · DELOAD`;
    } else {
      const week = (m && typeof mesoCurrentWeek === 'function') ? mesoCurrentWeek(m, clientStore) : null;
      const rir = (week != null && LB.mesoRirEnabled(sch) && typeof LB.mesoRirForWeek === 'function')
        ? LB.mesoRirForWeek(week, weeks, sch.mesocycle_start_rir ?? 3, sch.mesocycle_end_rir ?? 0)
        : null;
      const unit = LB.isWeekdayPlan(sch) ? 'W' : 'C';
      mesoBadge = week == null
        ? `${label} · not started`
        : `${label} · ${unit}${week}/${weeks}${rir != null ? ` · ${rir} RIR` : ''}`;
    }
  }

  return (
    <>
      <div className="micro" style={{ color: UI.inkFaint, margin: '0 0 8px', paddingLeft: 2 }}>PROGRAM</div>
      <div style={{ padding: '14px 16px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, marginBottom: 20 }}>
        {isMeso && mesoBadge && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fa-solid fa-layer-group" style={{ fontSize: 12, color: UI.gold }} />
            <span className="num" style={{ fontSize: 13, color: UI.inkSoft, letterSpacing: '0.04em' }}>{mesoBadge}</span>
          </div>
        )}
        {is531 && typeof FiveThreeOneProgress === 'function' && (
          <FiveThreeOneProgress sch={sch} store={clientStore} />
        )}
      </div>
    </>
  );
}

function ClientOverviewTab({ clientStore, coachingId, userId, onSelectSession }) {
  const sessions = clientStore.sessions || [];
  const ended = sessions.filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));
  const [chartOpen, setChartOpen] = useStateC(null);
  const [planOpen, setPlanOpen] = useStateC(false);
  const unit = (clientStore.settings?.unit === 'lbs') ? 'lbs' : 'kg';

  const activeSch = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId);
  const trainingDayCount = activeSch ? (Array.isArray(activeSch.days) ? activeSch.days : []).filter(d => d.items?.length > 0).length : 0;
  const todayDay = useMemoC(() => getTodayDay(clientStore), [clientStore]);
  const todayStr = localDateKey(new Date());
  const todaySession = useMemoC(() =>
    (clientStore.sessions || []).find(s => s.ended && s.date?.slice(0, 10) === todayStr && s.scheduleId === activeSch?.id) || null,
    [clientStore, activeSch]
  );
  const trainedToday = !!todaySession;
  const planStartDate = (() => {
    if (!activeSch) return null;
    if (activeSch.versions?.length)
      return activeSch.versions[activeSch.versions.length - 1].validFrom;
    return (LB.isWeekdayPlan(activeSch) ? clientStore.weekPlanStartDate : clientStore.cycleStartDate) || null;
  })();

  const weeks = useMemoC(() => computeWeeklyAdherence(clientStore, 104), [clientStore]);
  const completedWeeks = weeks.filter(w => w.planned > 0 && w.pct !== null);
  const overallAdherence = completedWeeks.length > 0
    ? Math.round(completedWeeks.reduce((s, w) => s + w.pct, 0) / completedWeeks.length)
    : null;

  const planSessions = useMemoC(() =>
    ended.filter(s => !planStartDate || s.date?.slice(0, 10) >= planStartDate.slice(0, 10)),
    [ended, planStartDate]
  );
  const avgVol = planSessions.length > 0
    ? Math.round(planSessions.reduce((s, x) => s + LB.totalVolume(x, clientStore.exercises, clientStore.dailyLogs), 0) / planSessions.length)
    : null;

  const adherenceLabel = `Adherence (${weeks.length}w)`;
  const chartTitles = { adherence: adherenceLabel, volume: 'Avg Vol / Cycle', sessions: 'Sessions per Week' };

  // Sessions to show: current week (weekday plan) or current cycle window (cycle plan)
  const recentSessions = useMemoC(() => {
    if (!activeSch) return ended.slice(0, 5);
    if (LB.isWeekdayPlan(activeSch)) {
      const today = new Date(); today.setHours(23, 59, 59, 0);
      const todayWd = LB.isoWd(today);
      const monday = new Date(today);
      monday.setDate(today.getDate() - todayWd);
      monday.setHours(0, 0, 0, 0);
      return ended.filter(s => new Date(s.ended) >= monday);
    } else if (LB.isFlexPlan(activeSch)) {
      // Flex advances per action, so a date window drifts when the client rests.
      // Show the current rotation's worth: the most recent cycleLen sessions.
      const cycleLen = activeSch.days?.length || 1;
      return ended.slice(0, cycleLen);
    } else {
      // Start of the *current* cycle run = today minus today's position in the
      // cycle. A rolling cycleLen-day window would wrongly drag in the previous
      // run's sessions (e.g. on day 0 it would still show the whole last cycle).
      const pos = cyclePosFn(clientStore, new Date());
      const cycleStart = new Date(); cycleStart.setHours(0, 0, 0, 0);
      cycleStart.setDate(cycleStart.getDate() - pos);
      return ended.filter(s => new Date(s.ended) >= cycleStart);
    }
  }, [clientStore]);

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '16px 12px 32px' }}>
      {/* Top stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, padding: '0 4px' }}>
        <StatBox label={adherenceLabel} value={overallAdherence != null ? `${overallAdherence}%` : '—'} gold={overallAdherence >= 80} onClick={() => setChartOpen('adherence')} />
        <StatBox label="Avg Vol / Cycle" value={avgVol != null ? `${avgVol.toLocaleString('en-US')}${unit}` : '—'} onClick={() => setChartOpen('volume')} />
        <StatBox label="Sessions" value={planSessions.length} onClick={() => setChartOpen('sessions')} />
      </div>

      <Sheet open={!!chartOpen} onClose={() => setChartOpen(null)} title={chartTitles[chartOpen] || ''}>
        <div style={{ paddingBottom: 8 }}>
          {chartOpen === 'adherence' && <AdherenceChart weeks={weeks} />}
          {chartOpen === 'volume' && <RollingVolumeChart sessions={ended} planStartDate={planStartDate} clientStore={clientStore} />}
          {chartOpen === 'sessions' && <SessionsWeekChart sessions={ended} planStartDate={planStartDate} />}
        </div>
      </Sheet>

      {/* Up Today */}
      {activeSch && (
        <>
          <div className="micro" style={{ color: UI.inkFaint, margin: '0 0 8px', paddingLeft: 2 }}>UP TODAY</div>
          {todayDay?.items?.length > 0 ? (
            <div
              onClick={() => setPlanOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, marginBottom: 20, cursor: 'pointer' }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{todayDay.name}</div>
                <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>
                  {todayDay.items.filter(i => i.exId).length} exercises
                </div>
              </div>
              {trainedToday && (
                <span className="micro" style={{ color: 'var(--success-text)', marginRight: 4 }}>DONE</span>
              )}
              <ChevronRight />
            </div>
          ) : (
            <div style={{ padding: '12px 16px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi }}>Rest day</div>
            </div>
          )}

          <Sheet open={planOpen} onClose={() => setPlanOpen(false)} title={todayDay?.name || 'Today'}>
            {trainedToday && todaySession ? (
              <div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  <StatBox label="Volume" value={`${Math.round(LB.totalVolume(todaySession, clientStore.exercises, clientStore.dailyLogs)).toLocaleString('en-US')}${unit}`} />
                  <StatBox label="Sets" value={LB.doneSetCount(todaySession)} />
                  <StatBox label="Duration" value={todaySession.durationMinutes ? `${todaySession.durationMinutes}m` : '—'} />
                </div>
                {feelLabel(todaySession.feel) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -6, marginBottom: 16 }}>
                    <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Feel</span>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: feelColor(todaySession.feel), flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: feelColor(todaySession.feel), fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.04em' }}>{feelLabel(todaySession.feel)}</span>
                  </div>
                )}
                {(() => {
                  const storeWithoutToday = { ...clientStore, sessions: clientStore.sessions.filter(s => s.ended && s.ended < todaySession.ended) };
                  // Shared with ClientSessionsTab via LB.techniqueRounds — both
                  // used to reimplement this from scratch (comment used to say
                  // "same gap, same fix", i.e. two independent copies to keep
                  // in sync by hand).
                  const fmtSetChip = (s) => {
                    if (s.skipped && !s.done) return 'skipped';
                    if (s.timeSec != null) return LB.fmtDuration(s.timeSec); // time-based set: one duration, no kg x reps
                    const tr = LB.techniqueRounds(s);
                    const strList = tr.rounds.length ? tr.rounds.filter(r => r.stretch).map(r => r.stretch) : (tr.stretch ? [tr.stretch] : []);
                    const strTag = strList.length ? ` +stretch ${strList.map(x => x.timeSec + 's').join('/')}` : '';
                    const main = `${s.kg ?? '—'}${unit} × ${s.reps ?? s.repsL ?? '—'}`;
                    if (tr.kind === 'weighted_stretch') return `${main}${strTag}`;
                    if (tr.kind === 'lengthened_partial') {
                      return (tr.partials > 0 ? `${main} +${tr.partials}` : main) + strTag;
                    }
                    if (tr.kind) {
                      const chain = tr.rounds.map((d, di) => (tr.connector === '↺' && di > 0) ? (d.reps ?? '—') : `${d.kg ?? '—'}${unit}×${d.reps ?? '—'}`).join(` ${tr.connector} `);
                      const suffix = tr.totalReps != null ? ` (${tr.totalReps})` : '';
                      return (tr.partials > 0 ? `${chain}${suffix} +${tr.partials}` : `${chain}${suffix}`) + strTag;
                    }
                    return main;
                  };
                  const techniqueLabel = (s) => LB.techniqueRounds(s).badge;
                  return (todaySession.entries || []).map((e, i) => {
                    const entriesArr = todaySession.entries || [];
                    const ss = supersetInfo(entriesArr, i);
                    const planItem = planItemForEntry(clientStore, todaySession, e.exId);
                    const tgtStr = planItem ? fmtRepTarget(planItem) : null;
                    const lastResult = e.exId ? LB.lastSessionForExercise(storeWithoutToday, e.exId, todaySession.dayId, entriesArr.slice(0, i).filter(x => x.exId === e.exId).length) : null;
                    const lastSets = (lastResult?.entry?.sets || []).filter(s => !s.warmup && (s.kg != null || s.reps != null || s.timeSec != null));
                    // If any set in the row carries a technique badge, every set
                    // needs equal reserved space above its chip — otherwise a
                    // plain set's chip sits noticeably higher than a badged
                    // neighbor's (its chip is pushed down by the badge above).
                    const workingSets = (e.sets || []).filter(s => !s.warmup);
                    const anyLabelInRow = workingSets.some(s => techniqueLabel(s));
                    const amrapLabelsFor = (s) => s.technique === 'amrap_variations' && (s.drops || []).some(d => d.label && d.label !== e.name)
                      ? (s.drops || []).map(d => d.label || e.name).join(' → ')
                      : null;
                    // Both the badge line AND the AMRAP label-chain caption need
                    // reserving on every set in the row once ANY sibling has one
                    // — otherwise that sibling's chip still sits lower than the
                    // others (only the badge row was reserved before).
                    const anyAmrapLabelsInRow = workingSets.some(amrapLabelsFor);
                    const badgeBoxStyle = {
                      fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: UI.gold,
                      background: 'rgba(var(--accent-rgb),0.12)', border: '0.5px solid rgba(var(--accent-rgb),0.35)',
                      borderRadius: 4, padding: '2px 6px',
                    };
                    const amrapLabelStyle = { fontSize: 8, color: UI.inkGhost, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
                    return (
                      <React.Fragment key={i}>
                        {ss.start && <SupersetHeader size={ss.size} />}
                        <div style={{ padding: '10px 0', borderBottom: `0.5px solid ${UI.hair}`, ...(ss.member ? { borderLeft: `2px solid rgba(var(--accent-rgb),0.35)`, paddingLeft: 12 } : {}) }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                          <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{e.name}</div>
                          {tgtStr && (
                            <span className="micro" style={{ color: UI.inkGhost, flexShrink: 0, whiteSpace: 'nowrap' }}>PLAN {planItem.sets ? `${planItem.sets}×` : ''}{tgtStr}{Array.isArray(planItem.plannedTechniques) && planItem.plannedTechniques.some(Boolean) && (<i className="fa-solid fa-fire" title="Planned intensity techniques" style={{ fontSize: 9, opacity: 0.85, color: UI.gold, marginLeft: 4 }} />)}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start', marginBottom: lastSets.length ? 5 : 0 }}>
                          {workingSets.map((s, j) => {
                            const prev = lastSets[j];
                            const anyImpBefore = workingSets.slice(0, j).some((x, k) => isImprovement(x, lastSets[k]));
                            const highlight = isImprovement(s, prev);
                            const decline   = !anyImpBefore && isDecline(s, prev);
                            const label = techniqueLabel(s);
                            const amrapLabels = amrapLabelsFor(s);
                            return (
                              <span key={j} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                                {label
                                  ? <span style={badgeBoxStyle}>{label}</span>
                                  : anyLabelInRow ? <span style={{ ...badgeBoxStyle, visibility: 'hidden' }}>·</span> : null}
                                {amrapLabels
                                  ? <span className="num" style={amrapLabelStyle}>{amrapLabels}</span>
                                  : anyAmrapLabelsInRow ? <span className="num" style={{ ...amrapLabelStyle, visibility: 'hidden' }}>·</span> : null}
                                <span className="num" style={{
                                  fontSize: 12,
                                  color: highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : s.done ? UI.ink : UI.inkFaint,
                                  background: highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : UI.bgInset,
                                  borderRadius: 4, padding: '2px 8px',
                                  border: `0.5px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hair}`,
                                }}>
                                  {fmtSetChip(s)}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                        {lastSets.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                            <span className="micro" style={{ color: UI.inkGhost }}>PREV</span>
                            {lastSets.map((s, j) => (
                              <span key={j} className="num" style={{ fontSize: 11, color: UI.inkGhost, background: 'transparent', borderRadius: 4, padding: '1px 6px', border: `0.5px solid ${UI.hair}` }}>
                                {fmtSetChip(s)}
                              </span>
                            ))}
                            <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>{fmtDate(lastResult.session.date)}</span>
                          </div>
                        )}
                      </div>
                      </React.Fragment>
                    );
                  });
                })()}
              </div>
            ) : (
              <div>
                {(todayDay?.items || []).filter(i => i.exId).map((item, idx, arr) => {
                  const ex = (clientStore.exercises || []).find(e => e.id === item.exId);
                  // Nth appearance of this exercise -> its Nth past occurrence.
                  const occ = arr.slice(0, idx).filter(x => x.exId === item.exId).length;
                  const last = LB.bestRecentEntry(clientStore, item.exId, todayDay.id, 3, occ);
                  const suggestion = LB.progressionSuggestion(clientStore, item.exId, todayDay.id, item.reps, item.repsPerSet || null, undefined, item.repsMax || null, item.progressionOffset ?? null, occ);
                  const bodyweightKg = LB.shouldPullBodyweight(ex) ? LB.latestBodyweight(clientStore) : null;
                  const seeds = LB.buildSeedSets(item, last, suggestion, ex?.unilateral, clientStore, bodyweightKg, clientStore.statusMode === 'deload');
                  // Reps-only / bodyweight / checkbox exercises seed with kg==null
                  // but a real rep prescription; count them as having data so the
                  // sheet shows the seeds instead of "First time, no weight data".
                  const hasWeight = seeds.some(s => s.kg != null || s.timeSec != null || s.reps != null || s.repsL != null || s.repsR != null);
                  return (
                    <div key={idx} style={{ padding: '12px 4px', borderBottom: `0.5px solid ${UI.hair}` }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{ex?.name || item.exId}</div>
                        {(() => {
                          const tgt = fmtRepTarget(item);
                          return item.sets && tgt ? (
                            <span className="micro" style={{ color: UI.inkFaint }}>{item.sets} × {tgt}</span>
                          ) : null;
                        })()}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {hasWeight ? seeds.map((s, j) => (
                          <span key={j} className="num" style={{ fontSize: 12, color: UI.ink, background: UI.bgInset, borderRadius: 4, padding: '3px 8px', border: `0.5px solid ${UI.hairStrong}` }}>
                            {s.timeSec != null ? LB.fmtDuration(s.timeSec) : <>{s.kg != null ? `${s.kg}${unit}` : '—'} × {s.reps ?? s.repsL ?? '—'}</>}
                          </span>
                        )) : (
                          <span style={{ fontSize: 11, color: UI.inkGhost, fontFamily: UI.fontUi }}>First time, no weight data yet</span>
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
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hair}` }}>
                <div style={{ width: 72, flexShrink: 0, fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>{w.label}</div>
                <div style={{ flex: 1, height: 4, background: UI.bgRaised, borderRadius: 4, overflow: 'hidden' }}>
                  {w.planned > 0 && (
                    <div style={{
                      height: '100%', borderRadius: 4,
                      width: `${w.pct ?? 0}%`,
                      background: w.pct >= 80 ? 'var(--success-text)' : w.pct >= 50 ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.7)',
                      transition: 'width 0.3s ease',
                    }} />
                  )}
                </div>
                <div style={{ width: 52, flexShrink: 0, textAlign: 'right' }}>
                  {w.planned === 0 ? (
                    <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>no plan</span>
                  ) : (
                    <span className="num" style={{ fontSize: 12, color: w.pct >= 80 ? 'var(--success-text)' : w.pct >= 50 ? UI.gold : 'rgba(var(--danger-rgb),0.8)' }}>
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
        <div style={{ padding: '12px 16px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, marginBottom: 20 }}>
          <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{activeSch.name}</div>
          <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>{trainingDayCount} training {trainingDayCount === 1 ? 'day' : 'days'}</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, marginBottom: 20, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>No active plan</div>
      )}

      {/* Program status (5/3/1 cycle/TM + mesocycle week/RIR) */}
      {activeSch && <ClientProgramStatus sch={activeSch} clientStore={clientStore} />}

      {/* Recent sessions */}
      <div className="micro" style={{ color: UI.inkFaint, margin: '0 0 8px', paddingLeft: 2 }}>
        {activeSch && LB.isWeekdayPlan(activeSch) ? 'THIS WEEK' : activeSch ? 'THIS CYCLE' : 'RECENT SESSIONS'}
      </div>
      {recentSessions.length === 0
        ? <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: '12px 14px' }}>No sessions yet.</div>
        : recentSessions.map(s => (
          <div key={s.id} onClick={() => onSelectSession?.(s)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, marginBottom: 8, cursor: 'pointer' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{s.dayName}</div>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>{fmtDate(s.date)}</div>
            </div>
            <span className="num" style={{ fontSize: 12, color: UI.gold }}>{Math.round(LB.totalVolume(s, clientStore.exercises, clientStore.dailyLogs)).toLocaleString('en-US')}<span style={{ color: UI.inkFaint, fontSize: 10 }}>{unit}</span></span>
            <ChevronRight />
          </div>
        ))
      }

      {/* Sick & vacation history */}
      {(clientStore.statusPeriods || []).length > 0 && (() => {
        const sorted = [...(clientStore.statusPeriods || [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        return (
          <>
            <div className="micro" style={{ color: UI.inkFaint, margin: '20px 0 8px', paddingLeft: 2 }}>SICK & VACATION</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sorted.map((p, i) => {
                const icon = p.mode === 'sick' ? 'fa-bed-pulse' : p.mode === 'deload' ? 'fa-arrow-trend-down' : 'fa-umbrella-beach';
                const modeLabel = p.mode === 'sick' ? 'Sick' : p.mode === 'deload' ? 'Deload' : 'Vacation';
                const startDate = new Date(p.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                const endDate = p.endedAt ? new Date(p.endedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
                const days = p.endedAt
                  ? Math.round((new Date(p.endedAt) - new Date(p.startedAt)) / 86400000) + 1
                  : Math.floor((Date.now() - new Date(p.startedAt).getTime()) / 86400000) + 1;
                return (
                  <div key={p.id || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hair}` }}>
                    <i className={`fa-solid ${icon}`} style={{ fontSize: 12, color: !p.endedAt ? 'var(--accent)' : UI.inkFaint, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, fontFamily: UI.fontUi, fontWeight: 600, color: !p.endedAt ? UI.ink : UI.inkSoft }}>{modeLabel}</span>
                      <span style={{ fontSize: 11, fontFamily: UI.fontUi, color: UI.inkFaint, marginLeft: 8 }}>
                        {startDate} → {endDate || 'ongoing'}
                      </span>
                    </div>
                    <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{days}d</span>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
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
        const color = w.pct >= 80 ? 'var(--success-text)' : w.pct >= 50 ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.7)';
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

function RollingVolumeChart({ sessions, planStartDate, clientStore }) {
  const [showCount, setShowCount] = useStateC(20);
  const activeSch = clientStore?.schedules?.find(s => s.id === clientStore?.activeScheduleId);
  const isWd = activeSch && LB.isWeekdayPlan(activeSch);
  const cycleLen = (!isWd && activeSch?.days?.length) || 7;
  const cutoff = planStartDate ? planStartDate.slice(0, 10) : null;

  const ended = (sessions || [])
    .filter(s => s.ended && s.date && (!cutoff || s.date.slice(0, 10) >= cutoff))
    .sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)));

  const fmtShort = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;
  };

  const getGroupKey = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    if (isWd) {
      const wd = LB.isoWd(d);
      const mon = new Date(d); mon.setDate(d.getDate() - wd);
      return localDateKey(mon);
    }
    if (activeSch?.versions?.length) {
      const pos = LB.getCyclePosForDate(activeSch, dateStr);
      if (pos !== null) {
        const cycleStart = new Date(d); cycleStart.setDate(d.getDate() - pos);
        return localDateKey(cycleStart);
      }
    }
    const cycleRef = clientStore?.cycleStartDate;
    const ref = cycleRef
      ? new Date(cycleRef.slice(0, 10) + 'T12:00:00')
      : ended.length ? new Date(ended[0].date.slice(0, 10) + 'T12:00:00') : d;
    const daysDiff = Math.round((d.getTime() - ref.getTime()) / 86400000);
    const runIdx = Math.floor(daysDiff / cycleLen);
    const runStart = new Date(ref); runStart.setDate(ref.getDate() + runIdx * cycleLen);
    return localDateKey(runStart);
  };

  const isFlex = activeSch && LB.isFlexPlan(activeSch);
  const byGroup = {};
  ended.forEach((s, i) => {
    // Flex plans advance per logged action, never by calendar date — group by
    // cycleLen-session runs (chronological) so rest days don't drift the grouping.
    // `date` holds the run's first session date for the label; key is zero-padded
    // so the run index sorts lexically.
    const key = isFlex ? String(Math.floor(i / cycleLen)).padStart(4, '0') : getGroupKey(s.date.slice(0, 10));
    if (!byGroup[key]) byGroup[key] = { date: isFlex ? s.date.slice(0, 10) : key, vol: 0, count: 0 };
    byGroup[key].vol += LB.totalVolume(s, clientStore?.exercises, clientStore?.dailyLogs);
    byGroup[key].count++;
  });

  const allGroups = Object.values(byGroup)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(g => ({ ...g, avg: Math.round(g.vol / g.count), label: fmtShort(g.date) }));

  const points = allGroups.slice(-16);

  if (points.length < 2) return (
    <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>
      Not enough {isWd ? 'weeks' : 'cycles'} yet.
    </div>
  );

  const PAD_L = 38, PAD_R = 8, PAD_T = 12, PAD_B = 22, VW = 320, VH = 150;
  const plotW = VW - PAD_L - PAD_R, plotH = VH - PAD_T - PAD_B;
  const n = points.length;
  const maxV = Math.max(...points.map(p => p.avg));
  const minV = Math.min(...points.map(p => p.avg));
  const dom = UI.chartDomain(minV, maxV);
  const px = i => PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const py = v => PAD_T + plotH - ((v - dom.min) / dom.range) * plotH;
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.avg).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${px(n-1).toFixed(1)},${PAD_T + plotH} L${px(0).toFixed(1)},${PAD_T + plotH} Z`;
  const trend = allGroups[allGroups.length - 1].avg - allGroups[0].avg;
  const unit = (clientStore?.settings?.unit === 'lbs') ? 'lbs' : 'kg';
  const periodLabel = isWd ? 'WEEK' : `CYCLE (${cycleLen}d)`;
  const fmtY = v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
  const gridVals = [dom.min, dom.min + dom.range / 2, dom.max];
  const labelIdxs = n <= 5 ? points.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const listGroups = [...allGroups].reverse();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: trend >= 0 ? 'var(--success-text)' : 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>
          <i className={`fa-solid fa-arrow-trend-${trend >= 0 ? 'up' : 'down'}`} style={{ marginRight: 4 }} />
          {trend >= 0 ? '+' : ''}{Math.round(trend).toLocaleString('en-US')}{unit}
          <span style={{ color: UI.inkFaint, marginLeft: 5 }}>since {isWd ? 'week 1' : 'cycle 1'}</span>
        </span>
        <span className="micro" style={{ color: UI.inkFaint }}>AVG SESSION VOL / {periodLabel}</span>
      </div>
      <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ display: 'block', overflow: 'visible', marginBottom: 12 }}>
        <defs>
          <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridVals.map((v, i) => {
          const y = py(v);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={VW - PAD_R} y2={y} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />
              <text x={PAD_L - 4} y={y + 3.5} textAnchor="end" fontSize="8" fontFamily="JetBrains Mono, monospace" fill={UI.inkFaint}>{fmtY(v)}</text>
            </g>
          );
        })}
        <path d={areaPath} fill="url(#volGrad)" />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={px(i).toFixed(1)} cy={py(p.avg).toFixed(1)} r={i === 0 || i === n - 1 ? 3 : 2} fill="var(--accent)" />
        ))}
        {labelIdxs.map(i => (
          <text key={i} x={px(i).toFixed(1)} y={VH - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={7} style={{ fill: UI.inkGhost, fontFamily: UI.fontUi }}>{points[i].label}</text>
        ))}
      </svg>
      {listGroups.slice(0, showCount).map((g, i, arr) => (
        <React.Fragment key={g.date}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 0' }}>
            <span className="num" style={{ fontSize: 11, color: UI.inkSoft, flexShrink: 0, width: 50 }}>{g.label}</span>
            <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ border: `1px solid ${UI.hair}`, borderRadius: 4, padding: '2px 7px', fontFamily: UI.fontNum, fontSize: 11, color: UI.ink }}>
                {g.avg.toLocaleString('en-US')}<span style={{ color: UI.inkFaint, fontSize: 9 }}>{unit}</span>
              </span>
              <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{g.count} session{g.count !== 1 ? 's' : ''}</span>
            </div>
          </div>
          {i < arr.length - 1 && <div className="knurl" />}
        </React.Fragment>
      ))}
      {listGroups.length > showCount && (
        <button onClick={() => setShowCount(c => c + 20)} style={{ width: '100%', marginTop: 8, padding: '8px 0', background: 'transparent', border: `1px solid ${UI.hairStrong}`, color: UI.inkFaint, borderRadius: 4, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent' }}>
          Show more ({listGroups.length - showCount} remaining)
        </button>
      )}
    </div>
  );
}

function SessionsWeekChart({ sessions, planStartDate }) {
  const cutoff = planStartDate ? planStartDate.slice(0, 10) : null;
  const ended = (sessions || []).filter(s => s.ended && (!cutoff || s.date?.slice(0, 10) >= cutoff));
  const byWeek = {};
  ended.forEach(s => {
    const d = new Date(s.ended); d.setHours(12, 0, 0, 0);
    const wd = LB.isoWd(d);
    const mon = new Date(d); mon.setDate(d.getDate() - wd); mon.setHours(0, 0, 0, 0);
    const key = localDateKey(mon);
    byWeek[key] = (byWeek[key] || 0) + 1;
  });
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const todayWd = LB.isoWd(today);
  const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - todayWd); thisMonday.setHours(0, 0, 0, 0);
  let startMonday;
  if (cutoff) {
    const cd = new Date(cutoff + 'T12:00:00');
    const cdWd = LB.isoWd(cd);
    startMonday = new Date(cd); startMonday.setDate(cd.getDate() - cdWd); startMonday.setHours(0, 0, 0, 0);
  } else {
    startMonday = new Date(thisMonday); startMonday.setDate(thisMonday.getDate() - 11 * 7);
  }
  const totalWeeks = Math.round((thisMonday - startMonday) / (7 * 86400000)) + 1;
  const weekCount = Math.min(totalWeeks, 16);
  const offset = totalWeeks - weekCount;
  const weeks = Array.from({ length: weekCount }, (_, i) => {
    const mon = new Date(startMonday); mon.setDate(startMonday.getDate() + (offset + i) * 7);
    const key = localDateKey(mon);
    return { key, count: byWeek[key] || 0, label: mon.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) };
  });

  const n = weeks.length;
  const W = 300, H = 110, gap = 4;
  const barW = Math.max(6, Math.floor((W - gap * (n + 1)) / n));
  const dom = UI.chartDomain(0, Math.max(...weeks.map(w => w.count), 1), { zeroFloor: true });
  const labelIdxs = new Set([0, Math.floor((n - 1) / 2), n - 1]);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} style={{ overflow: 'visible' }}>
      {weeks.map((w, i) => {
        const x = gap + i * (barW + gap);
        const h = (w.count / dom.max) * H;
        return (
          <g key={i}>
            <rect x={x} y={0} width={barW} height={H} rx={2} style={{ fill: UI.bgRaised }} />
            {h > 0 && <rect x={x} y={H - h} width={barW} height={h} rx={2} fill="var(--accent)" />}
            {w.count > 0 && <text x={x + barW / 2} y={H - h - 3} textAnchor="middle" fontSize={7} style={{ fill: 'var(--accent)', fontFamily: UI.fontUi }}>{w.count}</text>}
            {labelIdxs.has(i) && <text x={x + barW / 2} y={H + 13} textAnchor="middle" fontSize={7} style={{ fill: UI.inkGhost, fontFamily: UI.fontUi }}>{w.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function StatBox({ label, value, gold, onClick }) {
  return (
    <div onClick={onClick} style={{ flex: 1, background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, padding: '12px 10px', textAlign: 'center', cursor: onClick ? 'pointer' : 'default' }}>
      <div className="num" style={{ fontSize: 20, color: gold ? UI.gold : UI.ink, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div className="micro" style={{ color: UI.inkFaint }}>{label}</div>
      {onClick && <div style={{ marginTop: 5 }}><i className="fa-solid fa-chart-line" style={{ fontSize: 7, color: UI.inkGhost }} /></div>}
    </div>
  );
}

// ─── Tab: Setup (Plan + Nutrition combined) ───────────────────────────────────

function ClientSetupTab(props) {
  const [sub, setSub] = useStateC('plan');
  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <SubTabBar tabs={[{ id: 'plan', label: 'Plan', icon: 'fa-calendar-days' }, { id: 'nutrition', label: 'Nutrition', icon: 'fa-utensils' }]}
        active={sub} onChange={setSub} />
      {sub === 'plan'      && <ClientPlanTab {...props} />}
      {sub === 'nutrition' && <ClientNutritionTab coachingId={props.coachingId} userId={props.userId} />}
    </div>
  );
}

// ─── Tab: Plan ────────────────────────────────────────────────────────────────

function ClientPlanTab({ store, setStore, clientStore, setClientStore, clientId, coachingId, userId, go, onReload, clientName }) {
  const schedules = (clientStore.schedules || []).filter(s => !s.archived);
  const active = clientStore.activeScheduleId;
  const importRef = useRefC(null);
  const [confirmEl, confirm] = useConfirm();
  const [importChoiceOpen, setImportChoiceOpen] = useStateC(false);
  const [ownPlanPickerOpen, setOwnPlanPickerOpen] = useStateC(false);
  const [ownImportBusy, setOwnImportBusy] = useStateC(false);
  const [ownImportingId, setOwnImportingId] = useStateC(null); // which plan row is mid-import

  // Multi-device autosave (screens-schedule.jsx's ScheduleEditScreen) stores a
  // coach's in-progress edit of a client's plan under the COACH's own account
  // (store.planDrafts), not the client's, so it never touches the client's data
  // and stays invisible to them. Tapping EDIT already resumes it silently; this
  // surfaces it here too, since otherwise a coach browsing this list would have
  // no way to know a draft is waiting without opening the editor first.
  // Same type-to-confirm gate as every other place a resumed draft can be
  // thrown away (the self-edit resume banner, and backing out of the editor
  // after a resume): this is real, saved work, so a single careless tap must
  // never be enough to discard it.
  const discardPendingDraft = async (scheduleId) => {
    if (!await confirm(
      "This throws away your autosaved edits from an earlier session on this plan, and it can't be undone. The last saved version of the plan stays as it is.",
      { title: 'Discard autosave?', ok: 'Discard autosave', danger: true, requireText: "yes i'm sure" }
    )) return;
    setStore(s => {
      if (!s.planDrafts || !(scheduleId in s.planDrafts)) return s;
      const rest = { ...s.planDrafts };
      delete rest[scheduleId];
      return { ...s, planDrafts: rest };
    });
  };

  const activate = async (scheduleId) => {
    // Activation is client-facing and irreversible (it posts a "plan changed"
    // note the client is notified of), so confirm before a mis-tap switches
    // their program, mirroring the confirmed client-side activation flow.
    const planName = clientStore.schedules?.find(s => s.id === scheduleId)?.name || scheduleId;
    if (!await confirm(`Activate "${planName}" for ${name}? They'll be notified of the change.`, { title: 'Activate plan?', ok: 'Activate' })) return;
    try {
      const oldPlanName = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId)?.name;
      // The update resolves with { error } instead of throwing — check it, or a
      // failed activation would still flip the UI and send a misleading note.
      const { error } = await LB.supabase.from('zane_user_settings')
        .update({ active_schedule_id: scheduleId })
        .eq('user_id', clientId);
      if (error) throw error;
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
            // Carry the behavior flags so imported time/cardio/bodyweight
            // exercises keep their logging mode (mirrors the own-side import).
            newExercises.push({ id: newId, name: ex.name, tags: ex.tags || [], note: ex.note || '', category: ex.category || null, unilateral: ex.unilateral || false, equipment: ex.equipment || null, progression_reps: ex.progression_reps || null, movement_type: ex.movement_type || null, log_mode: ex.log_mode || null, no_weight_reps: ex.no_weight_reps || false, pull_bodyweight: ex.pull_bodyweight || false, youtube_url: ex.youtube_url || null });
          }
        });
        const remapDays = (days) => (days || []).map(d => ({
          ...d,
          id: LB.uid(),
          items: (d.items || []).map(it => ({ ...it, exId: idMap[it.exId] || it.exId })),
        }));
        const sch = {
          ...data.schedule,
          id: LB.uid(),
          archived: false,
          days: remapDays(data.schedule.days),
          versions: (data.schedule.versions || []).map(v => ({ ...v, days: remapDays(v.days) })),
        };
        // Remap 5/3/1 program_data (keyed by exId) and reset the cycle-bump gate,
        // exactly like the own-side import.
        if (sch.program_data && typeof sch.program_data === 'object') {
          const remapKeys = (obj) => { const out = {}; for (const k of Object.keys(obj || {})) out[idMap[k] || k] = obj[k]; return out; };
          const pd = { ...sch.program_data };
          if (pd.mainLifts) pd.mainLifts = remapKeys(pd.mainLifts);
          if (pd.tmHistory) pd.tmHistory = remapKeys(pd.tmHistory);
          delete pd.bumpedCycle;
          sch.program_data = pd;
        }
        if (newExercises.length) {
          const { error: exErr } = await LB.supabase.from('zane_exercises').insert(newExercises.map(ex => ({ ...ex, user_id: clientId })));
          if (exErr) { alert(`Import failed: ${exErr.message}`); return; }
        }
        // Insert the FULL schedule (mesocycle_*, program_*, is_flex,
        // sessions_per_week, versions), minus the local-only `mode` field, so the
        // DB row matches the in-memory plan instead of collapsing to a bare day
        // list on the next reload. If this insert fails the new exercises above
        // are left orphaned, but surfacing the error beats a silent partial save.
        // Build the insert row without object-rest (`const {mode, ...schRow}`):
        // Babel compiles object-rest to a per-file `_excluded` array whose global
        // name collides across all classic scripts in the shared precompile scope,
        // and a stray one here corrupted the Btn component's prop filtering
        // app-wide (see the Btn note in ui.jsx). A shallow copy + delete is
        // equivalent and generates no `_excluded`.
        const schRow = { ...sch };
        delete schRow.mode;
        const { error: schErr } = await LB.supabase.from('zane_schedules').insert({ ...schRow, user_id: clientId });
        if (schErr) { alert(`Import failed: ${schErr.message}`); return; }
        setClientStore(s => ({
          ...s,
          exercises: [...(s.exercises || []), ...newExercises],
          schedules: [...(s.schedules || []), sch],
        }));
      } catch (_) { alert('Could not read plan file.'); }
    };
    reader.readAsText(file);
  };

  // Same copy-and-remap as importPlan (dedupe exercises by name against the
  // CLIENT's library, fresh ids, versions dropped, 531 bumpedCycle stripped),
  // just sourced straight from the coach's own plan library instead of a
  // parsed JSON file, no dedicated activate-now prompt, this row-level
  // ACTIVATE button below already covers that, same as NEW PLAN and the JSON
  // import above (both just add; activation is always a separate step here).
  const importFromOwnPlan = async (sourceSch) => {
    setOwnImportBusy(true);
    setOwnImportingId(sourceSch.id);
    let copyName = '';
    try {
      const copy = JSON.parse(JSON.stringify(sourceSch));
      copy.id = LB.uid();
      copy.archived = false;
      // My Plans / Client Templates is a bucket on the coach's own Plan tab;
      // meaningless once the plan lands in the client's account.
      copy.is_template = false;
      delete copy.versions;
      if (copy.program_data) delete copy.program_data.bumpedCycle;
      copyName = copy.name || '';
      const exIds = new Set();
      (copy.days || []).forEach(d => (d.items || []).forEach(it => { if (it.exId) exIds.add(it.exId); }));
      const idMap = {};
      const newExercises = [];
      (store.exercises || []).filter(ex => exIds.has(ex.id)).forEach(ex => {
        const existing = (clientStore.exercises || []).find(x => x.name.trim().toLowerCase() === ex.name.trim().toLowerCase());
        if (existing) { idMap[ex.id] = existing.id; return; }
        const newId = LB.uid();
        idMap[ex.id] = newId;
        newExercises.push({ id: newId, name: ex.name, tags: ex.tags || [], note: ex.note || '', category: ex.category || null, unilateral: ex.unilateral || false, equipment: ex.equipment || null, progression_reps: ex.progression_reps || null, movement_type: ex.movement_type || null, log_mode: ex.log_mode || null, no_weight_reps: ex.no_weight_reps || false, pull_bodyweight: ex.pull_bodyweight || false, youtube_url: ex.youtube_url || null });
      });
      copy.days = (copy.days || []).map(d => ({ ...d, id: LB.uid(), items: (d.items || []).map(it => ({ ...it, exId: idMap[it.exId] || it.exId })) }));
      if (copy.program_data && typeof copy.program_data === 'object') {
        const remapKeys = (obj) => { const out = {}; for (const k of Object.keys(obj || {})) out[idMap[k] || k] = obj[k]; return out; };
        if (copy.program_data.mainLifts) copy.program_data.mainLifts = remapKeys(copy.program_data.mainLifts);
        if (copy.program_data.tmHistory) copy.program_data.tmHistory = remapKeys(copy.program_data.tmHistory);
      }
      if (newExercises.length) {
        const { error: exErr } = await LB.supabase.from('zane_exercises').insert(newExercises.map(ex => ({ ...ex, user_id: clientId })));
        if (exErr) { await confirm(`Could not import "${copyName}". ${exErr.message || ''}`.trim(), { title: 'Import failed', ok: 'OK', cancel: null }); return; }
        // Reflect the inserted exercises locally right away, so a later schedule
        // failure plus a retry dedupes against them instead of inserting a second set.
        setClientStore(s => ({ ...s, exercises: [...(s.exercises || []), ...newExercises] }));
      }
      const schRow = { ...copy };
      delete schRow.mode;
      const { error: schErr } = await LB.supabase.from('zane_schedules').insert({ ...schRow, user_id: clientId });
      if (schErr) { await confirm(`Could not import "${copyName}". ${schErr.message || ''}`.trim(), { title: 'Import failed', ok: 'OK', cancel: null }); return; }
      setClientStore(s => ({ ...s, schedules: [...(s.schedules || []), copy] }));
      setOwnPlanPickerOpen(false);
      await confirm(`Added "${copyName}" to ${clientName}'s plans.`, { title: 'Imported', ok: 'OK', cancel: null });
    } catch (e) {
      await confirm(`Could not import${copyName ? ` "${copyName}"` : ''}. ${e?.message || 'Please try again.'}`.trim(), { title: 'Import failed', ok: 'OK', cancel: null });
    } finally {
      setOwnImportBusy(false);
      setOwnImportingId(null);
    }
  };

  const name = clientName || clientStore.user?.name || '?';

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '16px 12px 32px' }}>
      {/* Actions row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, justifyContent: 'flex-end' }}>
        <button
          onClick={() => go({ name: 'coaching-new-plan', coachingId, clientId, clientName: name })}
          style={{ padding: '7px 14px', borderRadius: 6, border: `0.5px solid rgba(var(--accent-rgb),0.3)`, background: `rgba(var(--accent-rgb),0.13)`, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <i className="fa-solid fa-plus" style={{ fontSize: 9 }} />
          NEW PLAN
        </button>
        <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importPlan} />
        <button
          onClick={() => setImportChoiceOpen(true)}
          style={{ padding: '7px 14px', borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <i className="fa-solid fa-file-import" style={{ fontSize: 9 }} />
          IMPORT
        </button>
      </div>

      {/* Import source picker: a JSON file, or straight from the coach's own
          plan library (skips the export/re-import round trip). */}
      <Sheet open={importChoiceOpen} onClose={() => setImportChoiceOpen(false)} title="Import plan" titleColor="var(--accent)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={() => { setImportChoiceOpen(false); importRef.current?.click(); }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            <i className="fa-solid fa-file-import" style={{ fontSize: 14, color: UI.inkSoft, width: 18, textAlign: 'center' }} />
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>JSON file</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, marginTop: 2, fontFamily: UI.fontUi }}>Import a plan exported from any account</div>
            </div>
            <ChevronRight />
          </button>
          <button
            onClick={() => { setImportChoiceOpen(false); setOwnPlanPickerOpen(true); }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            <i className="fa-solid fa-clone" style={{ fontSize: 14, color: UI.inkSoft, width: 18, textAlign: 'center' }} />
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>From my own plans</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, marginTop: 2, fontFamily: UI.fontUi }}>Copy one of your plans straight into {name}'s account</div>
            </div>
            <ChevronRight />
          </button>
        </div>
      </Sheet>

      {/* Own-plan picker, step 2 of "From my own plans" */}
      <Sheet open={ownPlanPickerOpen} onClose={() => { if (!ownImportBusy) setOwnPlanPickerOpen(false); }} title="Pick a plan" titleColor="var(--accent)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(store.schedules || []).filter(s => !s.archived).length === 0 ? (
            <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: '12px 14px' }}>You have no plans of your own yet.</div>
          ) : (store.schedules || []).filter(s => !s.archived).map(s => (
            <button key={s.id} onClick={() => importFromOwnPlan(s)} disabled={ownImportBusy} style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
              borderRadius: 6, cursor: ownImportBusy ? 'default' : 'pointer', opacity: ownImportBusy ? 0.6 : 1,
              WebkitTapHighlightColor: 'transparent',
            }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>{s.name}</div>
                <div style={{ fontSize: 12, color: ownImportingId === s.id ? 'var(--accent)' : UI.inkFaint, marginTop: 2, fontFamily: UI.fontUi }}>{ownImportingId === s.id ? 'Importing…' : `${(s.days || []).filter(d => (d.items || []).length > 0).length} training days`}</div>
              </div>
              <ChevronRight />
            </button>
          ))}
        </div>
      </Sheet>

      {schedules.length === 0 ? (
        <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: '12px 14px' }}>No plans yet.</div>
      ) : schedules.map(sch => (
        <div key={sch.id} style={{ marginBottom: 10, background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${sch.id === active ? 'rgba(var(--accent-rgb),0.4)' : UI.hair}`, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
            {sch.id === active && (
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{sch.name}</div>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>
                {(sch.days || []).filter(d => d.items?.length > 0).length} training days
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
          {store.planDrafts?.[sch.id] && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 10px', borderTop: `0.5px solid rgba(var(--accent-rgb),0.2)`, background: UI.goldFaint }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="micro-gold">Unsaved edits</div>
                <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, marginTop: 1 }}>
                  You have changes to this plan waiting from an earlier session.
                </div>
              </div>
              <button
                onClick={() => go({ name: 'coaching-edit-plan', coachingId, clientId, scheduleId: sch.id, clientName: name })}
                style={{ background: 'transparent', border: `0.5px solid rgba(var(--accent-rgb),0.5)`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 10, color: 'var(--accent)', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}
              >
                RESUME
              </button>
              <button
                onClick={() => discardPendingDraft(sch.id)}
                style={{ background: 'transparent', border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 10, color: UI.inkSoft, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}
              >
                DISCARD
              </button>
            </div>
          )}
        </div>
      ))}
      {confirmEl}
    </div>
  );
}

// ─── InlineExHistory ──────────────────────────────────────────────────────────
// Standalone component so hooks are never called conditionally.

function InlineExHistory({ exId, dayId, exName, sessions, exercises, onBack, unit = UI.unit() }) {
  const ex = (exercises || []).find(e => e.id === exId);
  const isUni = !!ex?.unilateral;
  const [metric, setMetric] = useStateC('kg');
  const [showCount, setShowCount] = useStateC(20);

  // Sessions outside the boot history window arrive with entries:[] (aggExercises>0).
  // Unlike ClientSessionsTab this chart never lazy-loaded them, so older history
  // silently dropped out of the trend line and axis. Fetch the windowed ones for
  // this day and merge into local state (clientStore is a read-only copy).
  const [loadedEntries, setLoadedEntries] = useStateC({});
  useEffectC(() => {
    const ids = sessions
      .filter(s => s.dayId === dayId && s.aggExercises > 0 && !(s.entries || []).length && !loadedEntries[s.id])
      .map(s => s.id);
    if (!ids.length) return;
    let on = true;
    LB.fetchSessionEntries(ids)
      .then(bySession => { if (on && bySession) setLoadedEntries(prev => ({ ...prev, ...bySession })); })
      .catch(() => {});
    return () => { on = false; };
  }, [sessions, dayId]);

  const exSessions = useMemoC(() =>
    sessions
      .filter(s => s.dayId === dayId)
      .map(s => {
        const entries = (s.entries && s.entries.length) ? s.entries : (loadedEntries[s.id] || []);
        const entry = entries.find(e => e.exId === exId);
        if (!entry) return null;
        const working = (entry.sets || []).filter(st => !st.warmup && !st.skipped);
        if (!working.some(st => st.kg != null || st.reps != null || st.repsL != null || st.repsR != null || st.timeSec != null)) return null;
        return { ended: s.ended, sets: working };
      })
      .filter(Boolean)
      .sort((a, b) => a.ended.localeCompare(b.ended)),
    [sessions, exId, dayId, loadedEntries]
  );

  // Time-based / assisted exercise: detected from the data itself (the coach
  // side has no reliable exercise definition for the client's library). Time
  // plots the durations; assisted (any negative load) plots the load, where a
  // higher (less-negative) kg is less assistance. The kg/reps metric toggle
  // makes no sense for either.
  const isTimeEx = exSessions.some(s => s.sets.some(st => st.timeSec != null));
  const isAssistedEx = !isTimeEx && exSessions.some(s => s.sets.some(st => st.kg != null && st.kg < 0));

  const getValue = (st) => {
    if (!st) return null;
    if (isTimeEx) return st.timeSec ?? null;
    if (isAssistedEx) return st.kg ?? null;
    return metric === 'reps'
      ? (isUni ? (st.repsL != null ? Math.min(st.repsL ?? 0, st.repsR ?? 0) : (st.reps ?? null)) : (st.reps ?? null))
      : (st.kg ?? null);
  };

  const maxSets = Math.max(...exSessions.map(s => s.sets.length), 1);
  const allVals = exSessions.flatMap(s => s.sets.map(getValue)).filter(v => v != null);
  const minVal = allVals.length ? Math.min(...allVals) : 0;
  const rawMax = allVals.length ? Math.max(...allVals) : 10;
  const dom = UI.chartDomain(minVal, rawMax);

  const PAD_L = 36, PAD_R = 12, PAD_T = 14, PAD_B = 26, VW = 320, VH = 170;
  const plotW = VW - PAD_L - PAD_R, plotH = VH - PAD_T - PAD_B, n = exSessions.length;
  const xPos = (i) => PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yPos = (v) => PAD_T + plotH - ((v - dom.min) / dom.range) * plotH;
  const gridVals = Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const setAlphas = [1, 0.55, 0.35, 0.22, 0.14];
  const labelIdxs = (() => {
    if (n <= 5) return exSessions.map((_, i) => i);
    const step = Math.floor((n - 1) / 4);
    const idxs = new Set([0]);
    for (let i = step; i < n; i += step) idxs.add(Math.min(i, n - 1));
    idxs.add(n - 1);
    return [...idxs].sort((a, b) => a - b);
  })();
  const fmtD = (ended) => { const d = new Date(ended); return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`; };
  const listSessions = [...exSessions].reverse();

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `0.5px solid ${UI.hair}`, position: 'sticky', top: 0, background: UI.bg, zIndex: 1 }}>
        <button onClick={onBack} style={{ width: 32, height: 32, borderRadius: 6, border: `0.5px solid ${UI.hair}`, background: UI.bgRaised, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i className="fa-solid fa-chevron-left" style={{ fontSize: 12, color: UI.inkSoft }} />
        </button>
        <div style={{ flex: 1, fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{exName}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {isTimeEx ? (
            <span className="micro" style={{ color: UI.gold, letterSpacing: '0.12em' }}>DURATION</span>
          ) : isAssistedEx ? (
            <span className="micro" style={{ color: UI.gold, letterSpacing: '0.12em' }}>ASSISTED</span>
          ) : ['kg', 'reps'].map(m => (
            <button key={m} onClick={() => setMetric(m)} style={{
              padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${metric === m ? UI.gold : UI.hairStrong}`,
              background: metric === m ? UI.goldFaint : 'transparent',
              color: metric === m ? UI.gold : UI.inkFaint,
              fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
              WebkitTapHighlightColor: 'transparent',
            }}>{m === 'kg' ? unit.toUpperCase() : 'REPS'}</button>
          ))}
        </div>
      </div>
      <div style={{ padding: '16px 16px 32px' }}>
        {exSessions.length === 0 ? (
          <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, textAlign: 'center', padding: 32 }}>No history yet.</div>
        ) : (<>
          <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ display: 'block', overflow: 'visible', marginBottom: 12, maxWidth: 480 }}>
            {gridVals.map((v, i) => { const y = yPos(v); return (
              <g key={i}>
                <line x1={PAD_L} y1={y} x2={VW - PAD_R} y2={y} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />
                <text x={PAD_L - 5} y={y + 3.5} textAnchor="end" fontSize="8" fontFamily="JetBrains Mono, monospace" fill={UI.inkFaint}>{isTimeEx ? LB.fmtDuration(Math.round(v)) : Math.round(v)}</text>
              </g>
            ); })}
            {Array.from({ length: maxSets }, (_, si) => {
              const pts = exSessions.map((sess, xi) => { const v = getValue(sess.sets[si]); return v != null ? { x: xPos(xi), y: yPos(v) } : null; }).filter(Boolean);
              if (!pts.length) return null;
              const a = setAlphas[si] ?? 0.12;
              return (
                <g key={si}>
                  {pts.length > 1 && <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={`rgba(var(--accent-rgb),${a})`} strokeWidth={si === 0 ? 1.5 : 1} strokeLinejoin="round" />}
                  {pts.map((p, pi) => <circle key={pi} cx={p.x} cy={p.y} r={si === 0 ? 2.5 : 1.8} fill={si === 0 ? 'var(--accent)' : `rgba(var(--accent-rgb),${Math.min(a + 0.15, 1)})`} />)}
                </g>
              );
            })}
            {labelIdxs.map(xi => (
              <text key={xi} x={xPos(xi)} y={VH - 4} textAnchor="middle" fontSize="7.5" fontFamily="JetBrains Mono, monospace" fill={UI.inkFaint}>{fmtD(exSessions[xi].ended)}</text>
            ))}
          </svg>
          {listSessions.slice(0, showCount).map((sess, i, arr) => (
            <React.Fragment key={i}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 0' }}>
                <span className="num" style={{ fontSize: 11, color: UI.inkSoft, flexShrink: 0, width: 50 }}>{fmtD(sess.ended)}</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {sess.sets.map((st, si) => (
                    <span key={si} style={{ border: `1px solid ${UI.hair}`, borderRadius: 4, padding: '2px 7px', fontFamily: UI.fontNum, fontSize: 11, color: UI.ink }}>
                      {st.timeSec != null ? LB.fmtDuration(st.timeSec) : (<>
                        {st.kg ?? '—'}<span style={{ color: UI.inkFaint, fontSize: 9 }}>{unit}</span>
                        <span style={{ color: UI.inkFaint, margin: '0 1px' }}>×</span>
                        {isUni ? `L${st.repsL ?? '?'}/R${st.repsR ?? '?'}` : (st.reps ?? '—')}
                      </>)}
                    </span>
                  ))}
                </div>
              </div>
              {i < arr.length - 1 && <div className="knurl" />}
            </React.Fragment>
          ))}
          {listSessions.length > showCount && (
            <button onClick={() => setShowCount(c => c + 20)} style={{ width: '100%', marginTop: 12, padding: '8px 0', background: 'transparent', border: `1px solid ${UI.hairStrong}`, color: UI.inkFaint, borderRadius: 4, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent' }}>
              Show more ({listSessions.length - showCount} remaining)
            </button>
          )}
        </>)}
      </div>
    </div>
  );
}

// ─── Tab: Sessions ────────────────────────────────────────────────────────────

var CARDIO_ACTIVITY_MAP = {
  running:    { label: 'Running',    icon: 'fa-person-running' },
  walking:    { label: 'Walking',    icon: 'fa-person-walking' },
  cycling:    { label: 'Cycling',    icon: 'fa-person-biking' },
  swimming:   { label: 'Swimming',   icon: 'fa-person-swimming' },
  rowing:     { label: 'Rowing',     icon: 'fa-water' },
  elliptical: { label: 'Elliptical', icon: 'fa-circle-dot' },
  hiking:     { label: 'Hiking',     icon: 'fa-mountain-sun' },
};

function ClientSessionsTab({ clientStore, coachingId, userId, clientName, initialSelected, onClearSelected }) {
  const [subTab, setSubTab] = useStateC('workouts');
  const [selected, setSelected] = useStateC(initialSelected || null);
  const unit = (clientStore.settings?.unit === 'lbs') ? 'lbs' : 'kg';
  const [noteOpen, setNoteOpen] = useStateC(false);
  const [noteBody, setNoteBody] = useStateC('');
  const [noteSaving, setNoteSaving] = useStateC(false);
  const [dayFilter, setDayFilter] = useStateC(null);
  const [histEx, setHistEx] = useStateC(null); // { exId, dayId, exName }

  const sessions = (clientStore.sessions || []).filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));

  // Client sessions outside the boot window carry no entries — lazy-load the
  // selected one (clientStore is a read-only copy, so plain local state).
  useEffectC(() => {
    if (!selected || (selected.entries || []).length || !(selected.aggExercises > 0)) return;
    let on = true;
    LB.fetchSessionEntries([selected.id])
      .then(bySession => {
        const entries = bySession[selected.id];
        if (on && entries?.length) setSelected(sel => sel && sel.id === selected.id ? { ...sel, entries } : sel);
      })
      .catch(() => {});
    return () => { on = false; };
  }, [selected?.id]);

  const dayNames = useMemoC(() => {
    const counts = {};
    sessions.forEach(s => { if (s.dayName && s.dayName !== 'REST') counts[s.dayName] = (counts[s.dayName] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }, [sessions]);

  const filteredSessions = dayFilter ? sessions.filter(s => s.dayName === dayFilter) : sessions;

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

  // ── Inline exercise history panel ──────────────────────────────────
  if (histEx) {
    return (
      <InlineExHistory
        exId={histEx.exId}
        dayId={histEx.dayId}
        exName={histEx.exName}
        sessions={sessions}
        exercises={clientStore.exercises || []}
        onBack={() => setHistEx(null)}
        unit={unit}
      />
    );
  }

  // ── Session detail ─────────────────────────────────────────────────
  if (selected) {
    const vol = LB.totalVolume(selected, clientStore.exercises, clientStore.dailyLogs);
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
            <StatBox label="Volume" value={`${Math.round(vol).toLocaleString('en-US')}${unit}`} />
            <StatBox label="Sets" value={LB.doneSetCount(selected)} />
            <StatBox label="Duration" value={selected.durationMinutes ? `${selected.durationMinutes}m` : '—'} />
          </div>
          {feelLabel(selected.feel) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -6, marginBottom: 16 }}>
              <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Feel</span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: feelColor(selected.feel), flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: feelColor(selected.feel), fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.04em' }}>{feelLabel(selected.feel)}</span>
            </div>
          )}
          {(selected.entries || []).map((e, i) => {
            const entriesArr = selected.entries || [];
            const ss = supersetInfo(entriesArr, i);
            const planItem = planItemForEntry(clientStore, selected, e.exId);
            const tgtStr = planItem ? fmtRepTarget(planItem) : null;
            const lastResult = e.exId ? LB.lastSessionForExercise(storeWithoutSelected, e.exId, selected.dayId, entriesArr.slice(0, i).filter(x => x.exId === e.exId).length) : null;
            const lastSets = (lastResult?.entry?.sets || []).filter(s => !s.warmup && (s.kg != null || s.reps != null || s.timeSec != null));
            // This compact coach/self-coaching view had no intensity-technique
            // awareness at all — a drop-set/myo-rep/lengthened-partial set just
            // showed its main kg×reps (drops[0] mirrors the top-level fields)
            // with the rest of the technique's data silently invisible.
            // Shared with ClientOverviewTab via LB.techniqueRounds — see there.
            const fmtSetChip = (s) => {
              if (s.skipped && !s.done) return 'skipped';
              if (s.timeSec != null) return LB.fmtDuration(s.timeSec); // time-based set: one duration, no kg x reps
              const tr = LB.techniqueRounds(s);
              const strList = tr.rounds.length ? tr.rounds.filter(r => r.stretch).map(r => r.stretch) : (tr.stretch ? [tr.stretch] : []);
              const strTag = strList.length ? ` +stretch ${strList.map(x => x.timeSec + 's').join('/')}` : '';
              const main = `${s.kg ?? '—'}${unit} × ${s.reps ?? s.repsL ?? '—'}`;
              if (tr.kind === 'weighted_stretch') return `${main}${strTag}`;
              if (tr.kind === 'lengthened_partial') {
                return (tr.partials > 0 ? `${main} +${tr.partials}` : main) + strTag;
              }
              if (tr.kind) {
                const chain = tr.rounds.map((d, di) => (tr.connector === '↺' && di > 0) ? (d.reps ?? '—') : `${d.kg ?? '—'}${unit}×${d.reps ?? '—'}`).join(` ${tr.connector} `);
                const suffix = tr.totalReps != null ? ` (${tr.totalReps})` : '';
                return (tr.partials > 0 ? `${chain}${suffix} +${tr.partials}` : `${chain}${suffix}`) + strTag;
              }
              return main;
            };
            const techniqueLabel = (s) => LB.techniqueRounds(s).badge;
            // If any set in the row carries a technique badge, every set needs
            // equal reserved space above its chip — otherwise a plain set's
            // chip sits noticeably higher than a badged neighbor's.
            const workingSets = (e.sets || []).filter(s => !s.warmup);
            const anyLabelInRow = workingSets.some(s => techniqueLabel(s));
            const amrapLabelsFor = (s) => s.technique === 'amrap_variations' && (s.drops || []).some(d => d.label && d.label !== e.name)
              ? (s.drops || []).map(d => d.label || e.name).join(' → ')
              : null;
            // Both the badge line AND the AMRAP label-chain caption need
            // reserving on every set in the row once ANY sibling has one —
            // otherwise that sibling's chip still sits lower than the others
            // (only the badge row was reserved before).
            const anyAmrapLabelsInRow = workingSets.some(amrapLabelsFor);
            const badgeBoxStyle = {
              fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', color: UI.gold,
              background: 'rgba(var(--accent-rgb),0.12)', border: '0.5px solid rgba(var(--accent-rgb),0.35)',
              borderRadius: 4, padding: '2px 6px',
            };
            const amrapLabelStyle = { fontSize: 8, color: UI.inkGhost, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
            return (
              <React.Fragment key={i}>
                {ss.start && <SupersetHeader size={ss.size} />}
                <div
                  onClick={() => e.exId && selected.dayId && setHistEx({ exId: e.exId, dayId: selected.dayId, exName: e.name })}
                  style={{ padding: '10px 14px', borderBottom: `0.5px solid ${UI.hair}`, cursor: e.exId ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent', ...(ss.member ? { borderLeft: `2px solid rgba(var(--accent-rgb),0.35)`, paddingLeft: 12 } : {}) }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>
                      {e.name}{e.exId && <span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 5 }}>›</span>}
                    </div>
                    {tgtStr && (
                      <span className="micro" style={{ color: UI.inkGhost, flexShrink: 0, whiteSpace: 'nowrap' }}>PLAN {planItem.sets ? `${planItem.sets}×` : ''}{tgtStr}{Array.isArray(planItem.plannedTechniques) && planItem.plannedTechniques.some(Boolean) && (<i className="fa-solid fa-fire" title="Planned intensity techniques" style={{ fontSize: 9, opacity: 0.85, color: UI.gold, marginLeft: 4 }} />)}</span>
                    )}
                  </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start', marginBottom: lastSets.length ? 5 : 0 }}>
                  {workingSets.map((s, j) => {
                    const prev = lastSets[j];
                    const anyImpBefore = workingSets.slice(0, j).some((x, k) => isImprovement(x, lastSets[k]));
                    const highlight = isImprovement(s, prev);
                    const decline   = !anyImpBefore && isDecline(s, prev);
                    const label = techniqueLabel(s);
                    const amrapLabels = amrapLabelsFor(s);
                    return (
                      <span key={j} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                        {label
                          ? <span style={badgeBoxStyle}>{label}</span>
                          : anyLabelInRow ? <span style={{ ...badgeBoxStyle, visibility: 'hidden' }}>·</span> : null}
                        {amrapLabels
                          ? <span className="num" style={amrapLabelStyle}>{amrapLabels}</span>
                          : anyAmrapLabelsInRow ? <span className="num" style={{ ...amrapLabelStyle, visibility: 'hidden' }}>·</span> : null}
                        <span className="num" style={{
                          fontSize: 12,
                          color: highlight ? UI.goldLight : decline ? 'rgba(var(--danger-rgb),0.85)' : s.done ? UI.ink : UI.inkFaint,
                          background: highlight ? UI.goldFaint : decline ? 'rgba(var(--danger-rgb),0.08)' : UI.bgInset,
                          borderRadius: 4, padding: '2px 8px',
                          border: `0.5px solid ${highlight ? UI.goldSoft : decline ? 'rgba(var(--danger-rgb),0.35)' : UI.hair}`,
                        }}>
                          {fmtSetChip(s)}
                        </span>
                      </span>
                    );
                  })}
                </div>
                {lastSets.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                    <span className="micro" style={{ color: UI.inkGhost }}>PREV</span>
                    {lastSets.map((s, j) => (
                      <span key={j} className="num" style={{ fontSize: 11, color: UI.inkGhost, background: 'transparent', borderRadius: 4, padding: '1px 6px', border: `0.5px solid ${UI.hair}` }}>
                        {fmtSetChip(s)}
                      </span>
                    ))}
                    <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>{fmtDate(lastResult.session.date)}</span>
                  </div>
                )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
        <Sheet open={noteOpen} onClose={() => setNoteOpen(false)} title="Session Note">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} placeholder={`Note for ${selected.dayName}…`} rows={4} style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, outline: 'none', resize: 'none', width: '100%', boxSizing: 'border-box' }} />
            <Btn onClick={saveNote} disabled={noteSaving || !noteBody.trim()}>{noteSaving ? 'Saving…' : 'Save Note'}</Btn>
          </div>
        </Sheet>
      </div>
    );
  }

  // ── Session list / Cardio list ─────────────────────────────────────
  const cardioLogs = (clientStore.cardioLogs || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      <SubTabBar
        tabs={[
          { id: 'workouts', label: 'Workouts', icon: 'fa-dumbbell' },
          { id: 'cardio',   label: 'Cardio',   icon: 'fa-person-running' },
        ]}
        active={subTab}
        onChange={t => { setSubTab(t); setDayFilter(null); }}
        style={{ padding: '10px 12px 2px' }}
      />
      {subTab === 'workouts' ? (
        <>
          {dayNames.length > 1 && (
            <div style={{ flexShrink: 0, padding: '8px 12px 0', display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {dayNames.map(name => {
                const active = dayFilter === name;
                return (
                  <button key={name} onClick={() => setDayFilter(active ? null : name)} style={{
                    flexShrink: 0, padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
                    border: `1px solid ${active ? UI.gold : UI.hairStrong}`,
                    background: active ? UI.goldFaint : 'transparent',
                    color: active ? UI.gold : UI.inkFaint,
                    fontFamily: UI.fontUi, fontSize: 10, fontWeight: active ? 600 : 400,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    WebkitTapHighlightColor: 'transparent',
                  }}>{name}</button>
                );
              })}
            </div>
          )}
          <div style={{ padding: '4px 12px 32px' }}>
            {filteredSessions.length === 0 ? (
              <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: '32px 14px', textAlign: 'center' }}>
                {dayFilter ? `No "${dayFilter}" sessions yet.` : 'No sessions yet.'}
              </div>
            ) : filteredSessions.map(s => {
              const vol = LB.totalVolume(s, clientStore.exercises, clientStore.dailyLogs);
              return (
                <div key={s.id} onClick={() => setSelected(s)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `0.5px solid ${UI.hair}`, cursor: 'pointer' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{s.dayName}</div>
                    <div style={{ fontSize: 11, color: UI.inkFaint }}>{fmtDate(s.date)} · {LB.doneSetCount(s)} sets</div>
                  </div>
                  <span className="num" style={{ fontSize: 12, color: UI.gold }}>{Math.round(vol).toLocaleString('en-US')}<span style={{ color: UI.inkFaint, fontSize: 10 }}>{unit}</span></span>
                  <ChevronRight />
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ padding: '4px 12px 32px' }}>
          {cardioLogs.length === 0 ? (
            <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: '32px 14px', textAlign: 'center' }}>No cardio logs yet.</div>
          ) : cardioLogs.map(log => {
            const act = CARDIO_ACTIVITY_MAP[log.type] || { label: log.type ? log.type.charAt(0).toUpperCase() + log.type.slice(1) : 'Cardio', icon: 'fa-person-running' };
            return (
              <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `0.5px solid ${UI.hair}` }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(var(--accent-rgb),0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className={`fa-solid ${act.icon}`} style={{ fontSize: 13, color: UI.gold }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{act.label}</div>
                  <div style={{ fontSize: 11, color: UI.inkFaint }}>
                    {fmtDate(log.date)}
                    {log.durationMinutes ? ` · ${log.durationMinutes}m` : ''}
                    {log.distanceM ? ` · ${log.distanceM >= 1000 ? (log.distanceM / 1000).toFixed(1) + ' km' : Math.round(log.distanceM) + ' m'}` : ''}
                  </div>
                  {log.note && <div style={{ fontSize: 11, color: UI.inkSoft, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.note}</div>}
                </div>
                {(log.effort != null || log.paceFeeling != null) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, alignItems: 'flex-end' }}>
                    {log.effort != null && <span className="micro" style={{ background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 4, padding: '2px 6px', color: UI.inkSoft }}>E {log.effort}/10</span>}
                    {log.paceFeeling != null && <span className="micro" style={{ background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 4, padding: '2px 6px', color: UI.inkSoft }}>PF {log.paceFeeling}/6</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Check-ins (coach view) ─────────────────────────────────────────────

// ─── LineChartSheet ───────────────────────────────────────────────────────────
