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
          ? <TopBar title="Coaching" />
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
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'rgba(255,255,255,0.03)', borderBottom: `0.5px solid ${UI.hairStrong}` }}>
              <i className={`fa-solid ${clientStore.statusMode === 'sick' ? 'fa-bed-pulse' : 'fa-umbrella-beach'}`} style={{ fontSize: 12, color: UI.inkFaint, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, fontFamily: UI.fontUi, color: UI.inkSoft, letterSpacing: '0.08em', fontWeight: 600 }}>
                {clientStore.statusMode === 'sick' ? 'SICK' : 'VACATION'}
                {clientStore.statusModeSince && (() => {
                  const since = new Date(clientStore.statusModeSince);
                  const days = Math.floor((Date.now() - since.getTime()) / 86400000);
                  const dateStr = since.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
                  return ` · SINCE ${dateStr}${days > 0 ? ` (${days}d)` : ''}`;
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
              <span style={{ flex: 1, fontSize: 12, fontFamily: UI.fontUi, color: 'var(--accent)', letterSpacing: '0.08em', fontWeight: 600 }}>TRAINING NOW — TAP TO WATCH</span>
              <ChevronRight color={'var(--accent)'} />
            </div>
          )}
          {tab === 'overview'   && <ClientOverviewTab clientStore={clientStore} coachingId={coachingId} userId={userId} onSelectSession={openSession} />}
          {tab === 'sessions'   && <ClientSessionsTab clientStore={clientStore} coachingId={coachingId} userId={userId} clientName={clientName} initialSelected={selectedSession} onClearSelected={() => setSelectedSession(null)} />}
          {tab === 'checkins'   && (isSelf
            ? <ClientCheckInTab coachingId={coachingId} clientId={clientId} userId={userId} store={store} isSelf />
            : <ClientCheckInsTab coachingId={coachingId} checkinEnabled={checkinEnabled} onToggle={handleToggleCheckin} toggling={ciToggling} store={store} setStore={setStore} userId={userId} />)}
          {tab === 'setup'      && <ClientSetupTab clientStore={clientStore} setClientStore={setClientStore} clientId={clientId} coachingId={coachingId} userId={userId} go={go} onReload={reloadClient} clientName={clientName} />}
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
function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTodayDay(clientStore) {
  const activeSch = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId);
  if (!activeSch) return null;
  const todayStr = LB.todayISO();
  if (LB.isWeekdayPlan(activeSch)) {
    const todayWd = (new Date().getDay() + 6) % 7;
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

// Returns the plan days active on a given date — uses versions if present, falls back to schedule.days
function getPlanDaysForDate(schedule, dateStr) {
  const versions = schedule.versions;
  if (!versions?.length) return schedule.days || [];
  for (const v of versions) {
    if (v.validFrom <= dateStr) return v.days || [];
  }
  return schedule.days || [];
}

// Returns cycle position for a date using the version's validFrom as cycle start reference.
// Returns null when no versions exist (caller falls back to cyclePosFn).
function getCyclePosForDate(schedule, dateStr) {
  const versions = schedule.versions;
  if (!versions?.length) return null;
  for (const v of versions) {
    if (v.validFrom <= dateStr) {
      const daysLen = (v.days || []).length;
      if (!daysLen) return 0;
      const start = new Date(v.validFrom + 'T12:00:00');
      const target = new Date(dateStr + 'T12:00:00');
      const daysDiff = Math.round((target - start) / 86400000);
      return ((daysDiff % daysLen) + daysLen) % daysLen;
    }
  }
  return null;
}

function computeWeeklyAdherence(clientStore, weeksBack = 6) {
  const activeSch = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId);
  if (!activeSch) return [];

  const isWd = LB.isWeekdayPlan(activeSch);

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
    const wd = (d.getDay() + 6) % 7;
    planStartMonday = new Date(d);
    planStartMonday.setDate(d.getDate() - wd);
    planStartMonday.setHours(0, 0, 0, 0);
    planStartDateStr = activationDateStr.slice(0, 10);
  } else if (planSessions.length > 0) {
    const earliestMs = Math.min(...planSessions.map(s => new Date(s.ended).getTime()));
    const earliest = new Date(earliestMs); earliest.setHours(12, 0, 0, 0);
    const earliestWd = (earliest.getDay() + 6) % 7;
    planStartMonday = new Date(earliest);
    planStartMonday.setDate(earliest.getDate() - earliestWd);
    planStartMonday.setHours(0, 0, 0, 0);
    planStartDateStr = localDateKey(planStartMonday);
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
        const wd = (date.getDay() + 6) % 7;
        const daysForDate = getPlanDaysForDate(activeSch, dateStr);
        isTrainingDay = daysForDate.some(day => day.weekday === wd && day.items?.length > 0);
      } else {
        const daysForDate = getPlanDaysForDate(activeSch, dateStr);
        const versionedPos = getCyclePosForDate(activeSch, dateStr);
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

function ClientOverviewTab({ clientStore, coachingId, userId, onSelectSession }) {
  const sessions = clientStore.sessions || [];
  const ended = sessions.filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));
  const [chartOpen, setChartOpen] = useStateC(null);
  const [planOpen, setPlanOpen] = useStateC(false);
  const unit = clientStore.settings?.unit || 'kg';

  const activeSch = clientStore.schedules?.find(s => s.id === clientStore.activeScheduleId);
  const trainingDayCount = activeSch ? (activeSch.days || []).filter(d => d.items?.length > 0).length : 0;
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
    ? Math.round(planSessions.reduce((s, x) => s + LB.totalVolume(x, clientStore.exercises), 0) / planSessions.length)
    : null;

  const adherenceLabel = `Adherence (${weeks.length}w)`;
  const chartTitles = { adherence: adherenceLabel, volume: 'Avg Vol / Cycle', sessions: 'Sessions per Week' };

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
                <span className="micro" style={{ color: '#7bc47b', marginRight: 4 }}>DONE</span>
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
                  <StatBox label="Volume" value={`${Math.round(LB.totalVolume(todaySession, clientStore.exercises)).toLocaleString('en-US')}${unit}`} />
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
                                {s.kg ?? '—'}{unit} × {s.reps ?? s.repsL ?? '—'}
                              </span>
                            );
                          })}
                        </div>
                        {lastSets.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                            <span className="micro" style={{ color: UI.inkGhost }}>PREV</span>
                            {lastSets.map((s, j) => (
                              <span key={j} className="num" style={{ fontSize: 11, color: UI.inkGhost, background: 'transparent', borderRadius: 4, padding: '1px 6px', border: `0.5px solid ${UI.hair}` }}>
                                {s.kg ?? '—'}{unit} × {s.reps ?? s.repsL ?? '—'}
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
                  const last = LB.bestRecentEntry(clientStore, item.exId, todayDay.id);
                  const suggestion = LB.progressionSuggestion(clientStore, item.exId, todayDay.id, item.reps);
                  const bodyweightKg = ex?.equipment === 'bodyweight' ? LB.latestBodyweight(clientStore) : null;
                  const seeds = LB.buildSeedSets(item, last, suggestion, ex?.unilateral, clientStore.settings?.smartProgression, bodyweightKg);
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
                            {s.kg ?? '—'}{unit} × {s.reps ?? s.repsL ?? '—'}
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
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hair}` }}>
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
        <div style={{ padding: '12px 16px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, marginBottom: 20 }}>
          <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{activeSch.name}</div>
          <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>{trainingDayCount} training {trainingDayCount === 1 ? 'day' : 'days'}</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, marginBottom: 20, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>No active plan</div>
      )}

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
            <span className="num" style={{ fontSize: 12, color: UI.gold }}>{Math.round(LB.totalVolume(s, clientStore.exercises)).toLocaleString('en-US')}<span style={{ color: UI.inkFaint, fontSize: 10 }}>{unit}</span></span>
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
                const icon = p.mode === 'sick' ? 'fa-bed-pulse' : 'fa-umbrella-beach';
                const modeLabel = p.mode === 'sick' ? 'Sick' : 'Vacation';
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
      const wd = (d.getDay() + 6) % 7;
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

  const byGroup = {};
  ended.forEach(s => {
    const key = getGroupKey(s.date.slice(0, 10));
    if (!byGroup[key]) byGroup[key] = { date: key, vol: 0, count: 0 };
    byGroup[key].vol += LB.totalVolume(s, clientStore?.exercises);
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
  const unit = clientStore?.settings?.unit || 'kg';
  const periodLabel = isWd ? 'WEEK' : `CYCLE (${cycleLen}d)`;
  const fmtY = v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
  const gridVals = [dom.min, dom.min + dom.range / 2, dom.max];
  const labelIdxs = n <= 5 ? points.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const listGroups = [...allGroups].reverse();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: trend >= 0 ? '#7bc47b' : 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>
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
              <span style={{ border: `1px solid ${UI.hair}`, borderRadius: 3, padding: '2px 7px', fontFamily: UI.fontNum, fontSize: 11, color: UI.ink }}>
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
    const wd = (d.getDay() + 6) % 7;
    const mon = new Date(d); mon.setDate(d.getDate() - wd); mon.setHours(0, 0, 0, 0);
    const key = localDateKey(mon);
    byWeek[key] = (byWeek[key] || 0) + 1;
  });
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const todayWd = (today.getDay() + 6) % 7;
  const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - todayWd); thisMonday.setHours(0, 0, 0, 0);
  let startMonday;
  if (cutoff) {
    const cd = new Date(cutoff + 'T12:00:00');
    const cdWd = (cd.getDay() + 6) % 7;
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

function ClientPlanTab({ clientStore, setClientStore, clientId, coachingId, userId, go, onReload, clientName }) {
  const schedules = (clientStore.schedules || []).filter(s => !s.archived);
  const active = clientStore.activeScheduleId;
  const importRef = useRefC(null);

  const activate = async (scheduleId) => {
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
          const { error: exErr } = await LB.supabase.from('zane_exercises').insert(newExercises.map(ex => ({ ...ex, user_id: clientId })));
          if (exErr) { alert(`Import failed: ${exErr.message}`); return; }
        }
        // If this insert fails the new exercises above are left orphaned, but
        // surfacing the error beats silently showing a plan that wasn't saved.
        const { error: schErr } = await LB.supabase.from('zane_schedules').insert({ id: sch.id, user_id: clientId, name: sch.name, days: sch.days, archived: false });
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

  const name = clientName || clientStore.user?.name || '?';

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '16px 12px 32px' }}>
      {/* Actions row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, justifyContent: 'flex-end' }}>
        <button
          onClick={() => go({ name: 'coaching-new-plan', coachingId, clientId, clientName: name })}
          style={{ padding: '7px 14px', borderRadius: 6, border: `0.5px solid rgba(var(--accent-rgb),0.3)`, background: `rgba(var(--accent-rgb),0.06)`, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <i className="fa-solid fa-plus" style={{ fontSize: 9 }} />
          NEW PLAN
        </button>
        <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importPlan} />
        <button
          onClick={() => importRef.current?.click()}
          style={{ padding: '7px 14px', borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <i className="fa-solid fa-file-import" style={{ fontSize: 9 }} />
          IMPORT
        </button>
      </div>

      {schedules.length === 0 ? (
        <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: '12px 14px' }}>No plans yet.</div>
      ) : schedules.map(sch => (
        <div key={sch.id} style={{ marginBottom: 10, background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${sch.id === active ? 'rgba(var(--accent-rgb),0.4)' : UI.hair}`, overflow: 'hidden' }}>
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

// ─── InlineExHistory ──────────────────────────────────────────────────────────
// Standalone component so hooks are never called conditionally.

function InlineExHistory({ exId, dayId, exName, sessions, exercises, onBack, unit = 'kg' }) {
  const ex = (exercises || []).find(e => e.id === exId);
  const isUni = !!ex?.unilateral;
  const [metric, setMetric] = useStateC('kg');
  const [showCount, setShowCount] = useStateC(20);

  const exSessions = useMemoC(() =>
    sessions
      .filter(s => s.dayId === dayId)
      .map(s => {
        const entry = (s.entries || []).find(e => e.exId === exId);
        if (!entry) return null;
        const working = (entry.sets || []).filter(st => !st.warmup && !st.skipped);
        if (!working.some(st => st.kg != null || st.reps != null)) return null;
        return { ended: s.ended, sets: working };
      })
      .filter(Boolean)
      .sort((a, b) => a.ended.localeCompare(b.ended)),
    [sessions, exId, dayId]
  );

  const getValue = (st) => metric === 'reps'
    ? (isUni ? (st.repsL != null ? Math.min(st.repsL ?? 0, st.repsR ?? 0) : (st.reps ?? null)) : (st.reps ?? null))
    : (st.kg ?? null);

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
          {['kg', 'reps'].map(m => (
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
                <text x={PAD_L - 5} y={y + 3.5} textAnchor="end" fontSize="8" fontFamily="JetBrains Mono, monospace" fill={UI.inkFaint}>{Math.round(v)}</text>
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
                    <span key={si} style={{ border: `1px solid ${UI.hair}`, borderRadius: 3, padding: '2px 7px', fontFamily: UI.fontNum, fontSize: 11, color: UI.ink }}>
                      {st.kg ?? '—'}<span style={{ color: UI.inkFaint, fontSize: 9 }}>{unit}</span>
                      <span style={{ color: UI.inkFaint, margin: '0 1px' }}>×</span>
                      {isUni ? `L${st.repsL ?? '?'}/R${st.repsR ?? '?'}` : (st.reps ?? '—')}
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

function ClientSessionsTab({ clientStore, coachingId, userId, clientName, initialSelected, onClearSelected }) {
  const [selected, setSelected] = useStateC(initialSelected || null);
  const unit = clientStore.settings?.unit || 'kg';
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
    const vol = LB.totalVolume(selected, clientStore.exercises);
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
          {(selected.entries || []).map((e, i) => {
            const lastResult = e.exId ? LB.lastSessionForExercise(storeWithoutSelected, e.exId, selected.dayId) : null;
            const lastSets = (lastResult?.entry?.sets || []).filter(s => !s.warmup && (s.kg != null || s.reps != null));
            return (
              <div key={i}
                onClick={() => e.exId && selected.dayId && setHistEx({ exId: e.exId, dayId: selected.dayId, exName: e.name })}
                style={{ padding: '10px 14px', borderBottom: `0.5px solid ${UI.hair}`, cursor: e.exId ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent' }}
              >
                <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 6 }}>
                  {e.name}{e.exId && <span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 5 }}>›</span>}
                </div>
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
                        {s.kg ?? '—'}{unit} × {s.reps ?? s.repsL ?? '—'}
                      </span>
                    );
                  })}
                </div>
                {lastSets.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                    <span className="micro" style={{ color: UI.inkGhost }}>PREV</span>
                    {lastSets.map((s, j) => (
                      <span key={j} className="num" style={{ fontSize: 11, color: UI.inkGhost, background: 'transparent', borderRadius: 4, padding: '1px 6px', border: `0.5px solid ${UI.hair}` }}>
                        {s.kg ?? '—'}{unit} × {s.reps ?? s.repsL ?? '—'}
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
            <textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} placeholder={`Note for ${selected.dayName}…`} rows={4} style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, outline: 'none', resize: 'none', width: '100%', boxSizing: 'border-box' }} />
            <Btn onClick={saveNote} disabled={noteSaving || !noteBody.trim()}>{noteSaving ? 'Saving…' : 'Save Note'}</Btn>
          </div>
        </Sheet>
      </div>
    );
  }

  // ── Session list ───────────────────────────────────────────────────
  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
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
          const vol = LB.totalVolume(s, clientStore.exercises);
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
    </div>
  );
}

// ─── Tab: Check-ins (coach view) ─────────────────────────────────────────────

// ─── LineChartSheet ───────────────────────────────────────────────────────────
