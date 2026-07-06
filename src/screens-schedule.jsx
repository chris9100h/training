/* Schedules — list, detail, edit, create */

const { useState: useStateS, useMemo: useMemoS, useEffect: useEffectS } = React;

function useIsPadS() {
  const [isPad, setIsPad] = useStateS(() => window.innerWidth >= 768);
  useEffectS(() => {
    const handler = () => setIsPad(window.innerWidth >= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isPad;
}

const STANDARD_DAY_TYPES = ['PUSH','PULL','LEGS','UPPER','LOWER','FULL','ARMS','BACK','REST'];

// Shared chrome for this screen's compact "mini" bottom sheets (a small
// gold-label header + custom content) — distinct from the app-wide `Sheet`
// component (big uppercase display title, keyboard-aware, used for full
// settings/detail panels). These stack on top of each other (versions →
// backups → preview → date-pickers), so `dim` lets an inner sheet skip its
// own backdrop when a parent sheet underneath is already dimming the page.
function MiniSheet({ zIndex = 300, dim = true, onClose, style, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: dim ? 'rgba(0,0,0,0.5)' : 'transparent' }}
      onClick={onClose}>
      <div style={{ background: UI.bg, borderRadius: '8px 8px 0 0', borderTop: `0.5px solid ${UI.hairStrong}`, padding: '22px 22px calc(22px + env(safe-area-inset-bottom, 0px))', ...style }}
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const daysArr = s => Array.isArray(s?.days) ? s.days : [];

// One-line plan summary shown in the plan list and viewer header.
function planDescriptor(s) {
  const trainingDays = daysArr(s).filter(d => d.items.length).length;
  const mesoSuffix = s.mesocycle_weeks ? ` · ${s.mesocycle_weeks}wk meso` : '';
  if (LB.isFlexPlan(s)) {
    const goal = s.sessions_per_week;
    return `Flexible · ${trainingDays} ${trainingDays === 1 ? 'workout' : 'workouts'}${goal ? ` · ${goal}×/week` : ''}${mesoSuffix}`;
  }
  if (LB.isWeekdayPlan(s)) {
    return `${s.days.length} training days · ${[...s.days].sort((a,b)=>a.weekday-b.weekday).map(d=>WEEKDAYS[d.weekday]).join(' · ')}${mesoSuffix}`;
  }
  return `${s.days.length}-day cycle · ${trainingDays} training days${mesoSuffix}`;
}

// ─── PlanScreen ────────────────────────────────────────────────────
function PlanScreen({ store, setStore, go, userId }) {
  const [archivedOpen, setArchivedOpen] = useStateS(false);
  const [confirmEl, confirm] = useConfirm();
  const importRef = React.useRef(null);

  const isDeload = store.statusMode === 'deload';
  const deloadRemaining = isDeload ? LB.deloadDaysRemaining(store) : null;
  const toggleDeload = async (e) => {
    e.stopPropagation();
    if (isDeload) {
      if (!await confirm('End the deload week and return to normal training?', { title: 'End deload', ok: 'End deload' })) return;
      await LB.endDeload(userId, store, setStore);
    } else {
      if (store.statusMode) {
        if (!await confirm(`This will end your ${store.statusMode} status. Start a deload week instead?`, { title: 'Start deload', ok: 'Start deload' })) return;
      } else if (!await confirm('Train your normal plan at ~50% load for one cycle. Weights pre-fill light and this week is excluded from progression. Start now?', { title: 'Start deload week', ok: 'Start deload' })) {
        return;
      }
      await LB.startDeload(userId, store, setStore);
    }
  };

  const importPlan = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.type !== 'zane-plan' || !data.schedule) { alert('Invalid plan file.'); return; }
        const idMap = {};
        const newExercises = [];
        (data.exercises || []).forEach(ex => {
          const existing = store.exercises.find(x => x.name.trim().toLowerCase() === ex.name.trim().toLowerCase());
          if (existing) {
            idMap[ex.id] = existing.id;
          } else {
            const newId = LB.uid();
            idMap[ex.id] = newId;
            newExercises.push({ id: newId, name: ex.name, tags: ex.tags || [], note: ex.note || '', category: ex.category || null, unilateral: ex.unilateral || false, equipment: ex.equipment || null, progression_reps: ex.progression_reps || null });
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
        setStore(s => ({ ...s, exercises: [...s.exercises, ...newExercises], schedules: [...s.schedules, sch] }));
        go({ name: 'plan-view', scheduleId: sch.id, fromPlan: true });
      } catch (_) { alert('Could not read plan file.'); }
    };
    reader.readAsText(file);
  };

  return (
    <Screen>
      <TopBar
        title="Plan"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importPlan} />
            <button onClick={() => importRef.current?.click()} style={{
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              borderRadius: 4, padding: '5px 10px', cursor: 'pointer',
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>Import</button>
            <button data-tour="plan-new-btn" onClick={() => go({ name: 'schedule-new' })} style={{
              width: 32, height: 32, borderRadius: 4,
              border: `1px solid ${UI.goldSoft}`, background: UI.goldFaint,
              color: UI.gold, cursor: 'pointer', fontSize: 20, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>+</button>
          </div>
        }
      />
      <SubTabBar
        tabs={[
          { id: 'plan',   label: 'Workout',   icon: 'fa-dumbbell' },
          { id: 'lib',    label: 'Exercises', icon: 'fa-book' },
          { id: 'cardio', label: 'Cardio',    icon: 'fa-person-running' },
        ]}
        active="plan"
        onChange={id => { if (id === 'lib') go({ name: 'lib' }); else if (id === 'cardio') go({ name: 'cardio-plans' }); }}
      />
      <div style={{ padding: '14px 22px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {store.schedules.length === 0 && (
          <Empty title="No plans yet"
            sub="Create a training plan to start sessions."
            action={<Btn data-tour="plan-new-btn" onClick={() => go({ name: 'schedule-new' })}>Create plan</Btn>}
            icon={ICON_CALENDAR} />
        )}
        {[...store.schedules.filter(s => !s.archived)].sort((a, b) => {
          if (a.id === store.activeScheduleId) return -1;
          if (b.id === store.activeScheduleId) return 1;
          return 0;
        }).map(s => {
          const isActive = s.id === store.activeScheduleId;
          const mesoSt = s.mesocycle_weeks ? (store.mesoStates || []).find(m => m.scheduleId === s.id) : null;
          const mesoCompletions = mesoSt?.completions ?? 0;
          const mesoPending = mesoSt?.startDate && new Date(mesoSt.startDate + 'T12:00:00') > new Date();
          // Current plan revision (newest version = highest number, like the editor's
          // version bar). Only shown once a plan has actually been re-versioned (≥2).
          const verCount = s.versions?.length || 0;
          return isActive ? (
            <BracketFrame key={s.id} gold onClick={() => go({ name: 'plan-view', scheduleId: s.id, fromPlan: true })} style={{ cursor: 'pointer', overflow: 'hidden' }}>
              {s.mesocycle_weeks && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', overflow: 'hidden' }}>
                  <span className="display-it" style={{ fontSize: 52, fontWeight: 900, letterSpacing: '0.18em', color: UI.gold, opacity: mesoPending ? 0.04 : 0.07, transform: 'rotate(-22deg)', whiteSpace: 'nowrap', userSelect: 'none' }}>MESOCYCLE</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="display" style={{ fontSize: 22, color: UI.gold, lineHeight: 1.1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 8 }}>
                  {s.mesocycle_weeks && mesoPending && (() => {
                    const d = new Date(mesoSt.startDate + 'T12:00:00');
                    const startLabel = `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}`;
                    return (
                      <span style={{ fontFamily: UI.fontNum, fontSize: 10, fontWeight: 700, color: UI.inkFaint, background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, padding: '2px 6px', letterSpacing: '0.05em' }}>
                        MESO · starts {startLabel}
                      </span>
                    );
                  })()}
                  {!mesoPending && mesoCompletions > 0 && (
                    <span style={{ fontFamily: UI.fontNum, fontSize: 10, fontWeight: 700, color: UI.gold, background: 'rgba(var(--accent-rgb),0.15)', borderRadius: 4, padding: '2px 6px', letterSpacing: '0.05em' }}>
                      MESO {mesoCompletions + 1}
                    </span>
                  )}
                  {verCount >= 2 && (
                    <span style={{ fontFamily: UI.fontNum, fontSize: 10, fontWeight: 700, color: UI.gold, background: UI.goldFaint, border: `1px solid ${UI.goldSoft}`, borderRadius: 4, padding: '2px 6px', letterSpacing: '0.05em' }}>
                      V{verCount}
                    </span>
                  )}
                  <Pill gold>active</Pill>
                </div>
              </div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>
                {planDescriptor(s)}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {s.days.map((d) => (
                  <Pill key={d.id} gold={!!d.items.length}>{d.name}</Pill>
                ))}
              </div>
              <button onClick={toggleDeload} style={{
                  width: '100%', marginTop: 12, padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  background: isDeload ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                  border: `1px ${isDeload ? 'solid' : 'dashed'} ${isDeload ? UI.goldSoft : UI.hairStrong}`,
                  color: isDeload ? UI.gold : UI.inkSoft,
                  fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                }}>
                  <i className={`fa-solid ${isDeload ? 'fa-arrow-rotate-left' : 'fa-battery-quarter'}`} style={{ fontSize: 12 }} />
                  {isDeload
                    ? (deloadRemaining != null ? `Deload active · ${deloadRemaining}d left · End` : 'Deload active · End')
                    : 'Start deload week'}
                </button>
            </BracketFrame>
          ) : (
            <Frame key={s.id} onClick={() => go({ name: 'plan-view', scheduleId: s.id, fromPlan: true })} style={{ cursor: 'pointer', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div className="display" style={{ fontSize: 20, color: UI.ink, lineHeight: 1.1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 8 }}>
                  {!mesoPending && mesoCompletions > 0 && (
                    <span style={{ fontFamily: UI.fontNum, fontSize: 10, fontWeight: 700, color: UI.inkSoft, background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, padding: '2px 6px', letterSpacing: '0.05em' }}>
                      MESO {mesoCompletions + 1}
                    </span>
                  )}
                  {verCount >= 2 && (
                    <span style={{ fontFamily: UI.fontNum, fontSize: 10, fontWeight: 700, color: UI.inkSoft, background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, padding: '2px 6px', letterSpacing: '0.05em' }}>
                      V{verCount}
                    </span>
                  )}
                </div>
              </div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>
                {planDescriptor(s)}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {s.days.map((d) => (
                  <Pill key={d.id}>{d.name}</Pill>
                ))}
              </div>
            </Frame>
          );
        })}
        {(() => {
          const archived = store.schedules.filter(s => s.archived);
          if (!archived.length) return null;
          return (
            <>
              <button onClick={() => setArchivedOpen(o => !o)} style={{
                display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
                background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 2px',
              }}>
                <span className="micro" style={{ color: UI.inkFaint }}>ARCHIVED</span>
                <span style={{
                  background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
                  borderRadius: 4, padding: '1px 7px',
                  fontSize: 10, fontFamily: UI.fontNum, color: UI.inkFaint, lineHeight: 1.6,
                }}>{archived.length}</span>
                <span style={{ fontSize: 9, color: UI.inkFaint, marginLeft: 2 }}>{archivedOpen ? '▲' : '▼'}</span>
              </button>
              {archivedOpen && archived.map(s => (
                <Frame key={s.id} onClick={() => go({ name: 'plan-view', scheduleId: s.id, fromPlan: true })} style={{ cursor: 'pointer', padding: '14px 16px', opacity: 0.55 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div className="display" style={{ fontSize: 20, color: UI.ink, lineHeight: 1.1 }}>{s.name}</div>
                    <Pill>archived</Pill>
                  </div>
                  <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>
                    {planDescriptor(s)}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {s.days.map((d) => <Pill key={d.id}>{d.name}</Pill>)}
                  </div>
                </Frame>
              ))}
            </>
          );
        })()}
      </div>
      {confirmEl}
    </Screen>
  );
}

// ─── Plan viewer — fully read-only, no edit affordances ───────────────
// Reached from the home rest-day card. Day chips switch between days
// (like the exercise chips in training); each day shows the weights/reps
// that will be prefilled when training, with no controls that change it.
function PlanViewerScreen({ store, setStore, go, scheduleId, fromPlan, userId }) {
  const sch = store.schedules.find(s => s.id === (scheduleId || store.activeScheduleId));
  const isWeekday = sch ? LB.isWeekdayPlan(sch) : false;
  const isFlex = sch ? LB.isFlexPlan(sch) : false;
  const jsDay = new Date().getDay();
  const todayWeekday = jsDay === 0 ? 6 : jsDay - 1;
  const isActivePlan = !!sch && sch.id === store.activeScheduleId;
  const today = LB.todayISO();

  // Versions are stored newest-first. The viewer shows one version at a time and
  // defaults to the one in effect today — so a not-yet-effective future version
  // never hijacks the displayed position (the bug: today showed the new version's
  // day instead of the one actually active today).
  const versions = sch?.versions?.length ? sch.versions : null;
  const activeVerIdx = versions ? LB.getActiveVersionIdx(sch, today) : -1;
  const [verIdx, setVerIdx] = useStateS(() => (activeVerIdx >= 0 ? activeVerIdx : 0));
  const safeVerIdx = versions ? Math.max(0, Math.min(verIdx, versions.length - 1)) : 0;
  const selectedVersion = versions ? versions[safeVerIdx] : null;
  const versionDays = selectedVersion ? (selectedVersion.days || []) : (sch?.days || []);
  const displayDays = sch ? (isWeekday ? [...versionDays].sort((a, b) => a.weekday - b.weekday) : versionDays) : [];

  // True when the version being viewed is the one actually in effect today.
  const viewingActiveVersion = !versions || safeVerIdx === activeVerIdx;

  // TODAY marker — only when this is the active plan AND we're viewing the
  // version in effect today. Position is read straight from the displayed
  // version, so there's no cross-version id translation to get wrong.
  const todayDayId = (isActivePlan && viewingActiveVersion)
    ? (() => {
        if (isWeekday) return displayDays.find(d => d.weekday === todayWeekday)?.id ?? null;
        let pos;
        if (isFlex) {
          pos = ((store.cycleIndex || 0) % sch.days.length + sch.days.length) % sch.days.length;
        } else if (versions) {
          pos = LB.getCyclePosForDate(sch, today);
        } else if (store.cycleStartDate) {
          pos = LB.cyclePosFromStartDate(store.cycleStartDate, sch.days.length, today);
        } else {
          pos = (store.cycleIndex || 0) % sch.days.length;
        }
        return pos == null ? null : (displayDays[pos]?.id ?? null);
      })()
    : null;

  const [selectedDayId, setSelectedDayId] = useStateS(() => todayDayId || displayDays[0]?.id || null);
  const chipRowRef = React.useRef(null);

  // Switching versions moves the selection to today's day (if shown) or the
  // first day of the newly displayed version.
  React.useEffect(() => {
    setSelectedDayId(todayDayId || displayDays[0]?.id || null);
  }, [safeVerIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const [reactivateSheet, setReactivateSheet] = useStateS(false);
  const [reactivateDate, setReactivateDate] = useStateS('');
  const [editingStartDate, setEditingStartDate] = useStateS(false);
  const [editStartDateVal, setEditStartDateVal] = useStateS('');
  const [backupSheet, setBackupSheet] = useStateS(false);
  const [backups, setBackups] = useStateS(null);
  const [restoreFromSheet, setRestoreFromSheet] = useStateS(false);
  const [restoreFromDate, setRestoreFromDate] = useStateS('');
  const [restoreFromDayIdx, setRestoreFromDayIdx] = useStateS(0);
  const [pendingBackup, setPendingBackup] = useStateS(null);
  const [previewBackup, setPreviewBackup] = useStateS(null);
  const [previewDayIdx, setPreviewDayIdx] = useStateS(0);

  const openBackupSheet = async () => {
    setBackupSheet(true);
    if (!sch) return;
    const { data } = await LB.supabase
      .from('zane_schedule_backups')
      .select('id, days, schedule_name, created_at')
      .eq('schedule_id', sch.id)
      .order('created_at', { ascending: false })
      .limit(10);
    setBackups(data || []);
  };

  const restoreBackup = async (backup) => {
    if (!await confirm(
      `Restore the backup from ${new Date(backup.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}?\n\nThis replaces your current training days.`,
      { ok: 'Restore', danger: true }
    )) return;
    if (!(sch?.versions || []).length) {
      // Unversioned plan — just replace days directly
      setBackupSheet(false);
      setStore(s => ({
        ...s,
        schedules: s.schedules.map(x => x.id === sch.id ? { ...x, days: backup.days } : x),
      }));
      return;
    }
    // Versioned plan — ask for effective date (date picker appears on top of backup list)
    setPendingBackup(backup);
    setRestoreFromDate(LB.todayISO());
    setRestoreFromDayIdx(0);
    setRestoreFromSheet(true);
  };

  const doRestoreBackup = (date, dayIdx) => {
    if (!pendingBackup || !date) return;
    const newVer = { validFrom: date, days: pendingBackup.days };
    if (dayIdx > 0) newVer.cycleOffset = dayIdx;
    setStore(s => ({
      ...s,
      schedules: s.schedules.map(x => {
        if (x.id !== sch.id) return x;
        // One version per date, same policy as a normal plan save (doSave /
        // LB.dedupeVersionsByDate): a same-date restore replaces the existing
        // version for that date instead of stacking a duplicate that
        // getActiveVersionIdx could never actually surface anyway.
        const newVersions = LB.dedupeVersionsByDate([newVer, ...(x.versions || [])]);
        return { ...x, days: newVersions[0].days, versions: newVersions };
      }),
    }));
    setRestoreFromSheet(false);
    setBackupSheet(false);
    setPendingBackup(null);
  };

  React.useEffect(() => {
    const row = chipRowRef.current;
    if (!row) return;
    const idx = displayDays.findIndex(d => d.id === selectedDayId);
    const chip = row.children[idx];
    if (!chip) return;
    row.scrollTo({ left: chip.offsetLeft - row.offsetWidth / 2 + chip.offsetWidth / 2, behavior: 'smooth' });
  }, [selectedDayId]);

  // Computed here (before the early returns below) purely so the seedRefs
  // hooks that depend on it always run — every other hook in this component
  // is declared before those returns too; a hook declared after them would
  // violate React's rules of hooks the moment `sch`/`displayDays` changes
  // across renders of this same (unkeyed, long-lived) instance.
  const dayForSeed = displayDays.find(d => d.id === selectedDayId) || displayDays[0] || null;
  // Merge in server history for exercises whose local window is thin (fresh
  // device/reinstall) — same call the real session-start flow awaits, so the
  // weight/progression preview here doesn't disagree with what actually gets
  // seeded once the session starts. Resolves instantly when the local window
  // already suffices; never rejects (falls back silently offline).
  const [seedRefs, setSeedRefs] = useStateS({});
  React.useEffect(() => {
    let cancelled = false;
    if (!dayForSeed?.items?.length) { setSeedRefs({}); return; }
    LB.fetchSeedEntries(store, dayForSeed.items, dayForSeed.id, userId).then(refs => { if (!cancelled) setSeedRefs(refs || {}); });
    return () => { cancelled = true; };
  }, [dayForSeed?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hoisted above the early returns below for the same reason as the seed hooks:
  // hook order must stay constant across renders of this long-lived instance.
  const isPad = useIsPadS();
  const [confirmEl, confirm] = useConfirm();

  if (!sch) {
    return (
      <Screen>
        <TopBar title="Plan" onBack={() => go({ name: 'home' })} />
        <div style={{ padding: 22 }}>
          <Empty title="No active plan" sub="Activate a plan to view it here." icon={ICON_CALENDAR} />
        </div>
      </Screen>
    );
  }

  if (!displayDays.length) {
    return (
      <Screen>
        <TopBar title={sch.name} onBack={() => go({ name: fromPlan ? 'plan' : 'home' })}
          right={fromPlan ? (
            <button onClick={() => go({ name: 'schedule-edit', scheduleId: sch.id, versionFrom: selectedVersion?.validFrom })} style={{
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              borderRadius: 4, padding: '5px 12px', cursor: 'pointer',
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>Edit</button>
          ) : null} />
        <div style={{ padding: 22 }}>
          <Empty title="No days yet" sub={fromPlan ? 'Tap Edit to add days to this plan.' : 'This plan has no days.'} icon={ICON_CALENDAR} />
        </div>
      </Screen>
    );
  }

  const day = dayForSeed;
  const dayIdx = displayDays.findIndex(d => d.id === day.id);
  const isRest = !day.items.length;
  const isTodaySel = day.id === todayDayId;
  const dayLabel = isWeekday ? WEEKDAYS_FULL[day.weekday] : `Day ${dayIdx + 1}`;
  const trainingDayCount = displayDays.filter(d => d.items.length).length;
  // In a non-active version no day is live, so the selected (viewed) day gets a
  // neutral highlight rather than the gold "today/active" accent.
  const selBorder = viewingActiveVersion ? UI.gold : UI.inkFaint;
  const selBg     = viewingActiveVersion ? UI.goldFaint : UI.bgInset;
  const selText   = viewingActiveVersion ? UI.gold : UI.ink;

  const activate = async () => {
    if (!await confirm(`"${sch.name}" will become your active plan and the cycle will reset.`, { title: 'Activate plan?', ok: 'Activate' })) return;
    setStore(s => ({
      ...s,
      activeScheduleId: sch.id,
      cycleIndex: 0,
      // Reset the start date that doesn't apply to this plan type, so a later
      // type switch can't read a stale date left over from a different plan.
      // Flex plans have no date anchor at all — position is the cycleIndex.
      cycleStartDate:    (isWeekday || isFlex) ? null          : LB.todayISO(),
      weekPlanStartDate: isWeekday             ? LB.todayISO() : null,
    }));
  };
  const duplicate = () => {
    const copy = JSON.parse(JSON.stringify(sch));
    copy.id = LB.uid();
    copy.name = copy.name + ' (Copy)';
    copy.days = copy.days.map(d => ({ ...d, id: LB.uid() }));
    copy.archived = false;
    delete copy.versions;
    setStore(s => ({ ...s, schedules: [...s.schedules, copy] }));
    go({ name: 'plan-view', scheduleId: copy.id, fromPlan: true });
  };

  const exportPlan = () => {
    const exIds = new Set();
    versionDays.forEach(d => d.items.forEach(it => { if (it.exId) exIds.add(it.exId); }));
    const exercises = store.exercises.filter(e => exIds.has(e.id));
    const payload = { type: 'zane-plan', version: 1, schedule: { name: sch.name, days: versionDays }, exercises };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sch.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Directly change the validFrom of the selected past version.
  const doEditStartDate = (newDate) => {
    if (!newDate || !selectedVersion) return;
    const newVersions = LB.dedupeVersionsByDate(
      (sch.versions || []).map(v => v.validFrom === selectedVersion.validFrom ? { ...v, validFrom: newDate } : v)
    );
    setStore(s => ({
      ...s,
      schedules: s.schedules.map(x => x.id === sch.id ? { ...x, versions: newVersions } : x),
    }));
    setEditingStartDate(false);
    setEditStartDateVal('');
  };

  // Reactivate the version being viewed: snapshot its days as a new version
  // effective from the chosen date (same model as an "apply from date" save).
  const doReactivate = (date) => {
    if (!selectedVersion || !date) return;
    const newVer = { validFrom: date, days: JSON.parse(JSON.stringify(selectedVersion.days || [])) };
    // One version per date — newVer is first, so it replaces any same-date entry.
    const newVersions = LB.dedupeVersionsByDate([newVer, ...(sch.versions || [])]);
    const newIdx = newVersions.indexOf(newVer);
    setStore(s => ({
      ...s,
      schedules: s.schedules.map(x => x.id === sch.id ? { ...x, days: newVersions[0].days, versions: newVersions } : x),
    }));
    setReactivateSheet(false);
    setReactivateDate('');
    setVerIdx(newIdx >= 0 ? newIdx : 0);
  };

  const planActions = fromPlan && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      {!isActivePlan && <Btn kind="ghost" onClick={activate} style={{ fontSize: 12 }}>Activate</Btn>}
      {isActivePlan && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          border: `1px solid ${UI.goldSoft}`, borderRadius: 4, background: UI.goldFaint,
          padding: '10px 14px', minHeight: 44,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: UI.gold, flexShrink: 0 }} />
          <span className="label" style={{ color: UI.gold, marginBottom: 0 }}>Active</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn kind="ghost" onClick={duplicate} style={{ flex: 1, fontSize: 12 }}>Duplicate</Btn>
        <Btn kind="ghost" onClick={exportPlan} style={{ flex: 1, fontSize: 12 }}>Export</Btn>
        <Btn kind="ghost" onClick={openBackupSheet} style={{ flex: 1, fontSize: 12 }}>Backups</Btn>
      </div>
    </div>
  );

  const dayHeader = (
    <div>
      <div className={isTodaySel ? 'micro-gold' : 'micro'} style={{ marginBottom: 4, color: isTodaySel ? undefined : UI.inkFaint }}>
        {dayLabel.toUpperCase()}{isTodaySel ? ' · TODAY' : ''}
      </div>
      <div className="display" style={{ fontSize: 30, color: isRest ? UI.inkSoft : UI.ink, fontStyle: isRest ? 'italic' : 'normal', lineHeight: 1.05, letterSpacing: '-0.01em' }}>
        {day.name}
      </div>
    </div>
  );

  // Cross-device meso set/weight adjustments — must pass store.mesoStates
  // (the DB-synced source of truth) same as every other call site, otherwise
  // this preview silently falls back to a per-device localStorage cache that
  // may not exist here, showing the un-adjusted baseline plan. Resolved once
  // (it internally reads localStorage) rather than once per item below.
  const resolvedMeso = (typeof getMesoState === 'function') ? getMesoState(sch?.id, store.mesoStates) : null;
  const mesoBoosts = resolvedMeso?.weightBoosts ?? null;

  const exerciseList = isRest ? (
    <BracketFrame style={{ textAlign: 'center', padding: 36 }}>
      <div className="display-it" style={{ fontSize: 38, color: UI.inkSoft, fontStyle: 'italic', fontWeight: 300, marginBottom: 6 }}>Recover.</div>
      <div style={{ fontSize: 13, color: UI.inkFaint }}>Recovery is part of the plan.</div>
    </BracketFrame>
  ) : (
    <>
      {day.items.flatMap((it, k) => {
        const ex = LB.findExercise(store, it.exId);
        const isUni = !!ex?.unilateral;
        // Prefer server-merged history (seedRefs) over the local-only window,
        // same as the real session-start flow, so this preview doesn't
        // disagree with what actually gets seeded on a fresh device/reinstall.
        const seedRef = seedRefs[it.exId];
        const last = seedRef ?? LB.bestRecentEntry(store, it.exId, day.id);
        const suggestion = LB.progressionSuggestion(store, it.exId, day.id, it.reps, it.repsPerSet || null, seedRef, it.repsMax || null, it.progressionOffset ?? null);
        const bodyweightKg = LB.shouldPullBodyweight(ex) ? LB.latestBodyweight(store) : null;
        const itAdj = (typeof applyMesoSetDeltaFromState === 'function') ? applyMesoSetDeltaFromState(it, day.id, resolvedMeso) : it;
        const weightBoost = mesoBoosts?.[it.exId + '_' + day.id] ?? null;
        let suggestionFinal = suggestion;
        if (weightBoost != null && !suggestionFinal && last) {
          const refSet = (last?.entry?.sets || []).filter(s => !s.warmup && !s.skipped).find(s => s.kg != null);
          if (refSet) suggestionFinal = { kg: Math.round((refSet.kg + weightBoost) * 4) / 4, reps: refSet.reps ?? null };
        }
        const seedSets = LB.buildSeedSets(itAdj, last, suggestionFinal, isUni, store, bodyweightKg);
        const nextIt = day.items[k + 1];
        const linkedToNext = it.supersetGroup && it.supersetGroup === nextIt?.supersetGroup;
        const isGiant = it.supersetGroup && day.items.filter(x => x.supersetGroup === it.supersetGroup).length >= 3;
        const frame = (
          <Frame key={k} style={{ padding: '12px 16px', borderColor: it.supersetGroup ? UI.goldSoft : UI.hairStrong }}>
            {it.supersetGroup && (
              <div className="micro" style={{ color: UI.gold, marginBottom: 6, letterSpacing: '0.12em' }}>{isGiant ? 'GIANT SET' : 'SUPERSET'}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, paddingTop: 1 }}>
                {ex?.name || '—'}
                {isUni && <span className="micro" style={{ marginLeft: 6, color: UI.inkFaint }}>UNI</span>}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                {seedSets.map((st, si) => {
                  const kg = st.kg != null ? `${st.kg}${UI.unit()}` : '—';
                  // A null seeded rep count means the training screen would
                  // actually show a blank input for that set — falling back
                  // to the flat plan-level reps here would show a concrete
                  // number that won't actually be pre-filled.
                  const reps = isUni
                    ? `L${st.repsL ?? '—'}/R${st.repsR ?? '—'}`
                    : (st.reps != null ? String(st.reps) : '—');
                  return (
                    <span key={si} className="num" style={{ fontSize: 13, color: suggestionFinal ? UI.gold : UI.inkSoft }}>
                      {kg} · {reps}
                      {suggestionFinal && si === 0 && <i className="fa-solid fa-arrow-up" style={{ fontSize: 9, marginLeft: 4, color: UI.gold }} />}
                    </span>
                  );
                })}
              </div>
            </div>
          </Frame>
        );
        if (linkedToNext) {
          return [frame, <div key={`ss-${k}`} style={{ display: 'flex', justifyContent: 'center', margin: '-6px 0', position: 'relative', zIndex: 1 }}><span style={{ fontSize: 12, color: UI.goldSoft, background: 'var(--bg-body)', padding: '0 8px' }}>⟷</span></div>];
        }
        return [frame];
      })}
      <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5, marginTop: 2, textAlign: 'center' }}>
        {day.items.some(i => LB.progressionEnabled(store, i.repsMax, i.progressionOffset))
          ? <>Prefilled for your next session · <i className="fa-solid fa-arrow-up" style={{ fontSize: 8 }} /> = smart progression bump</>
          : 'Prefilled from your last session'}
      </div>
    </>
  );

  const fmtVDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const versionBar = versions && (() => {
    const vNum = versions.length - safeVerIdx;
    // The version that supersedes the one being viewed (next-newer), if any.
    const newer = safeVerIdx > 0 ? versions[safeVerIdx - 1] : null;
    const status = viewingActiveVersion ? 'ACTIVE' : (selectedVersion.validFrom > today ? 'SCHEDULED' : 'PAST');
    const banner = (() => {
      if (viewingActiveVersion) {
        return newer ? `In effect now · V${vNum + 1} takes over ${fmtVDate(newer.validFrom)}` : null;
      }
      if (status === 'SCHEDULED') return `Scheduled · takes effect ${fmtVDate(selectedVersion.validFrom)}`;
      if (newer) {
        const d = new Date(newer.validFrom + 'T12:00:00'); d.setDate(d.getDate() - 1);
        return `Was active ${fmtVDate(selectedVersion.validFrom)} – ${fmtVDate(d.toISOString().slice(0, 10))}`;
      }
      return null;
    })();
    const stepBtn = (disabled) => ({
      width: 30, height: 30, flexShrink: 0, borderRadius: 4,
      border: `1px solid ${UI.hairStrong}`, background: 'transparent',
      color: disabled ? UI.inkGhost : UI.gold, cursor: disabled ? 'default' : 'pointer',
      fontSize: 17, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      WebkitTapHighlightColor: 'transparent',
    });
    return (
      <div style={{ flexShrink: 0, padding: '12px 22px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${UI.hairStrong}`, borderRadius: 6, padding: 6, background: UI.bgRaised }}>
          <button onClick={() => setVerIdx(safeVerIdx + 1)} disabled={safeVerIdx >= versions.length - 1} style={stepBtn(safeVerIdx >= versions.length - 1)}>‹</button>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, minWidth: 0 }}>
            <span className="num" style={{ fontSize: 12, color: UI.ink }}>V{vNum}</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: UI.hairStrong }} />
            <span className="label" style={{ marginBottom: 0, color: viewingActiveVersion ? UI.gold : UI.inkFaint }}>{status}</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: UI.hairStrong }} />
            <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{fmtVDate(selectedVersion.validFrom)}</span>
          </div>
          <button onClick={() => setVerIdx(safeVerIdx - 1)} disabled={safeVerIdx <= 0} style={stepBtn(safeVerIdx <= 0)}>›</button>
        </div>
        {banner && (
          <div className="micro" style={{ color: viewingActiveVersion ? UI.gold : UI.inkFaint, textAlign: 'center', letterSpacing: '0.08em', lineHeight: 1.5 }}>
            {banner}
          </div>
        )}
        {status === 'PAST' && !editingStartDate && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => setReactivateSheet(true)} style={{
              background: 'transparent', border: `1px solid ${UI.goldSoft}`,
              borderRadius: 4, padding: '6px 14px', cursor: 'pointer', color: UI.gold,
              fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
              WebkitTapHighlightColor: 'transparent',
            }}>Reactivate this version</button>
            <button onClick={() => { setEditStartDateVal(selectedVersion.validFrom); setEditingStartDate(true); }} style={{
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              borderRadius: 4, padding: '6px 14px', cursor: 'pointer', color: UI.inkSoft,
              fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
              WebkitTapHighlightColor: 'transparent',
            }}>Edit start date</button>
          </div>
        )}
        {status === 'PAST' && editingStartDate && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, overflow: 'hidden', borderRadius: 4, border: `1px solid ${editStartDateVal ? UI.goldSoft : UI.hairStrong}` }}>
              <input
                type="date"
                value={editStartDateVal}
                onChange={e => setEditStartDateVal(e.target.value)}
                style={{ background: UI.bgInset, border: 'none', borderRadius: 4, padding: '10px 14px', color: editStartDateVal ? UI.ink : UI.inkFaint, fontFamily: UI.fontNum, fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box', display: 'block', colorScheme: 'dark' }}
              />
            </div>
            <Btn disabled={!editStartDateVal || editStartDateVal === selectedVersion.validFrom} onClick={() => doEditStartDate(editStartDateVal)} style={{ flexShrink: 0 }}>Save</Btn>
            <button onClick={() => { setEditingStartDate(false); setEditStartDateVal(''); }} style={{ background: 'transparent', border: 'none', color: UI.inkFaint, fontSize: 18, cursor: 'pointer', padding: '0 4px', WebkitTapHighlightColor: 'transparent' }}>×</button>
          </div>
        )}
      </div>
    );
  })();

  return (
    <Screen scroll={false}>
      {confirmEl}
      <TopBar
        title={sch.name}
        sub={(() => {
          if (isFlex) return `Flexible · ${trainingDayCount} ${trainingDayCount === 1 ? 'workout' : 'workouts'}${sch.sessions_per_week ? ` · ${sch.sessions_per_week}×/week` : ''}`;
          return isWeekday
            ? displayDays.map(d => WEEKDAYS[d.weekday]).join(' · ')
            : `${displayDays.length}-day cycle · ${trainingDayCount} ${trainingDayCount === 1 ? 'workout' : 'workouts'}`;
        })()}
        onBack={() => go({ name: fromPlan ? 'plan' : 'home' })}
        right={fromPlan ? (
          <button onClick={() => go({ name: 'schedule-edit', scheduleId: sch.id, versionFrom: selectedVersion?.validFrom })} style={{
            background: 'transparent', border: `1px solid ${UI.hairStrong}`,
            borderRadius: 4, padding: '5px 12px', cursor: 'pointer',
            color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>Edit</button>
        ) : null}
      />

      {versionBar}

      {isPad ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          {/* Left sidebar: plan actions + vertical day chips */}
          <div style={{ width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
            {fromPlan && (
              <div style={{ flexShrink: 0, padding: '14px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {planActions}
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 10px 16px', display: 'flex', flexDirection: 'column', gap: 4, scrollbarWidth: 'none' }}>
              {displayDays.map((d, i) => {
                const active = d.id === selectedDayId;
                const isToday = d.id === todayDayId;
                const rest = !d.items.length;
                const sub = isWeekday ? WEEKDAYS[d.weekday] : `Day ${i + 1}`;
                return (
                  <button key={d.id} onClick={() => setSelectedDayId(d.id)} style={{
                    flexShrink: 0, padding: '8px 12px 6px', borderRadius: 4,
                    border: `1px solid ${active ? selBorder : isToday ? UI.goldSoft : UI.hairStrong}`,
                    background: active ? selBg : 'transparent',
                    cursor: 'pointer', WebkitTapHighlightColor: 'transparent', transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11, fontFamily: UI.fontUi, letterSpacing: '0.07em', fontWeight: 600,
                        color: active ? selText : rest ? UI.inkFaint : UI.inkSoft,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{d.name}</div>
                      <div style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.1em', color: active ? selText : UI.inkFaint, marginTop: 1 }}>{sub}</div>
                    </div>
                    {isToday && <div style={{ width: 5, height: 5, borderRadius: '50%', background: UI.gold, flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: day content */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', padding: '20px 32px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {dayHeader}
            {exerciseList}
          </div>
        </div>
      ) : (
        <>
          {fromPlan && (
            <div style={{ flexShrink: 0, padding: '14px 22px 10px', display: 'flex', gap: 8 }}>
              {planActions}
            </div>
          )}

          <div ref={chipRowRef} style={{ flexShrink: 0, padding: '4px 22px 14px', display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {displayDays.map((d, i) => {
              const active = d.id === selectedDayId;
              const isToday = d.id === todayDayId;
              const rest = !d.items.length;
              const sub = isWeekday ? WEEKDAYS[d.weekday] : `Day ${i + 1}`;
              return (
                <button key={d.id} onClick={() => setSelectedDayId(d.id)} style={{
                  flexShrink: 0, maxWidth: 120, padding: '6px 12px 4px', borderRadius: 4,
                  border: `1px solid ${active ? selBorder : isToday ? UI.goldSoft : UI.hairStrong}`,
                  background: active ? selBg : 'transparent',
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent', transition: 'all 0.15s',
                }}>
                  <div style={{
                    fontSize: 10, fontFamily: UI.fontUi, letterSpacing: '0.07em', fontWeight: 600,
                    color: active ? selText : rest ? UI.inkFaint : UI.inkSoft,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{d.name}</div>
                  <div style={{ fontSize: 8, fontFamily: UI.fontUi, letterSpacing: '0.1em', color: active ? selText : UI.inkFaint, marginTop: 1 }}>{sub}</div>
                  <div style={{ height: 3, marginTop: 3, display: 'flex', justifyContent: 'center' }}>
                    {isToday && <div style={{ width: 4, height: 4, borderRadius: '50%', background: UI.gold, marginTop: -1 }} />}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {dayHeader}
            {exerciseList}
          </div>
        </>
      )}

      {reactivateSheet && (
        <MiniSheet onClose={() => setReactivateSheet(false)}>
          <div className="label" style={{ color: UI.inkFaint, marginBottom: 6 }}>REACTIVATE THIS VERSION</div>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 18, lineHeight: 1.5, letterSpacing: '0.06em', textTransform: 'none' }}>
            A copy of this version's days becomes active from the date you pick. Your existing versions stay in the history.
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ flex: 1, overflow: 'hidden', borderRadius: 4, border: `1px solid ${reactivateDate ? UI.goldSoft : UI.hairStrong}` }}>
              <input
                type="date"
                value={reactivateDate}
                onChange={e => setReactivateDate(e.target.value)}
                style={{ background: UI.bgInset, border: 'none', borderRadius: 4, padding: '10px 14px', color: reactivateDate ? UI.ink : UI.inkFaint, fontFamily: UI.fontNum, fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box', display: 'block', colorScheme: 'dark' }}
              />
            </div>
            <Btn disabled={!reactivateDate} onClick={() => doReactivate(reactivateDate)} style={{ flexShrink: 0 }}>
              Apply
            </Btn>
          </div>
        </MiniSheet>
      )}

      {restoreFromSheet && (
        <MiniSheet zIndex={400} dim={false} onClose={() => { setRestoreFromSheet(false); setPendingBackup(null); }}>
          <div className="label" style={{ color: UI.inkFaint, marginBottom: 18 }}>WHEN SHOULD THIS TAKE EFFECT?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ flex: 1, overflow: 'hidden', borderRadius: 4, border: `1px solid ${restoreFromDate ? UI.goldSoft : UI.hairStrong}` }}>
              <input
                type="date"
                value={restoreFromDate}
                onChange={e => setRestoreFromDate(e.target.value)}
                style={{ background: UI.bgInset, border: 'none', borderRadius: 4, padding: '10px 14px', color: restoreFromDate ? UI.ink : UI.inkFaint, fontFamily: UI.fontNum, fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box', display: 'block', colorScheme: 'dark' }}
              />
            </div>
            {!isWeekday && (pendingBackup?.days || []).length > 1 && (
              <div>
                <div className="label" style={{ color: UI.inkFaint, marginBottom: 8 }}>START WITH DAY</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(pendingBackup?.days || []).map((d, realIdx) => {
                    const active = restoreFromDayIdx === realIdx;
                    return (
                      <button key={d.id} onClick={() => setRestoreFromDayIdx(realIdx)} style={{
                        padding: '5px 11px 4px', borderRadius: 4, cursor: 'pointer',
                        border: `1px solid ${active ? UI.goldSoft : UI.hairStrong}`,
                        background: active ? UI.goldFaint : 'transparent',
                        WebkitTapHighlightColor: 'transparent',
                      }}>
                        <div style={{ fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, color: active ? UI.gold : UI.inkSoft }}>{d.name}</div>
                        <div style={{ fontFamily: UI.fontUi, fontSize: 8, color: active ? UI.gold : UI.inkFaint, letterSpacing: '0.08em' }}>Day {realIdx + 1}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <Btn
              disabled={!restoreFromDate}
              onClick={() => { if (!restoreFromDate) return; doRestoreBackup(restoreFromDate, restoreFromDayIdx); }}
            >
              Restore from date
            </Btn>
          </div>
        </MiniSheet>
      )}

      {backupSheet && (
        <MiniSheet onClose={() => setBackupSheet(false)} style={{ maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
          <div className="label" style={{ color: UI.inkFaint, marginBottom: 4, flexShrink: 0 }}>PLAN BACKUPS</div>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 16, lineHeight: 1.5, letterSpacing: '0.06em', textTransform: 'none', flexShrink: 0 }}>
            Automatic snapshots saved whenever you update your training days. Restoring replaces your current days.
          </div>
          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {backups === null && (
              <div style={{ color: UI.inkFaint, fontSize: 13, textAlign: 'center', padding: '16px 0' }}>Loading…</div>
            )}
            {backups !== null && backups.length === 0 && (
              <div style={{ color: UI.inkFaint, fontSize: 13, textAlign: 'center', padding: '16px 0' }}>No backups yet. Backups are saved automatically when you update your plan.</div>
            )}
            {(backups || []).map(b => {
              const date = new Date(b.created_at);
              const dayCount = (b.days || []).filter(d => (d.items || []).length > 0).length;
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 6, border: `1px solid ${UI.hairStrong}`, background: UI.bgRaised }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi }}>
                      {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                    <div className="micro" style={{ color: UI.inkFaint, marginTop: 2, letterSpacing: '0.06em' }}>
                      {date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · {(b.days || []).length} days · {dayCount} training
                    </div>
                  </div>
                  <Btn kind="ghost" onClick={() => { setPreviewBackup(b); setPreviewDayIdx(0); }} style={{ fontSize: 11, flexShrink: 0 }}>Preview</Btn>
                </div>
              );
            })}
          </div>
        </MiniSheet>
      )}

      {previewBackup && (() => {
        const previewDays = previewBackup.days || [];
        const closePreview = () => { setPreviewBackup(null); setPreviewDayIdx(0); };
        return (
          <MiniSheet zIndex={350} dim={false} onClose={closePreview} style={{ padding: 0, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
              {/* Header */}
              <div style={{ padding: '18px 22px 0', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div className="label" style={{ color: UI.inkFaint, marginBottom: 4 }}>BACKUP PREVIEW</div>
                    <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>
                      {new Date(previewBackup.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                    <div className="micro" style={{ color: UI.inkFaint, marginTop: 3, letterSpacing: '0.06em' }}>
                      {new Date(previewBackup.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      {' · '}{previewDays.length} days · {previewDays.filter(d => (d.items || []).length).length} training
                    </div>
                  </div>
                  <button onClick={closePreview} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontSize: 20, lineHeight: 1, padding: '2px 0', flexShrink: 0 }}>×</button>
                </div>
              </div>

              {/* Day chips */}
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '14px 22px 12px', flexShrink: 0, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                {previewDays.map((d, i) => {
                  const active = previewDayIdx === i;
                  const hasItems = (d.items || []).length > 0;
                  return (
                    <button key={d.id || i} onClick={() => setPreviewDayIdx(i)} style={{
                      flexShrink: 0, padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
                      border: `1px solid ${active ? UI.goldSoft : UI.hairStrong}`,
                      background: active ? UI.goldFaint : 'transparent',
                      WebkitTapHighlightColor: 'transparent',
                    }}>
                      <div style={{ fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, color: active ? UI.gold : UI.inkSoft }}>{d.name}</div>
                      <div style={{ fontFamily: UI.fontUi, fontSize: 8, color: active ? UI.gold : UI.inkFaint, letterSpacing: '0.06em', marginTop: 1 }}>
                        {hasItems ? `${(d.items || []).length} ex` : 'REST'}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Exercise list — all days rendered in a CSS grid stack so the
                  sheet height is anchored to the tallest day; non-active days
                  are invisible but still occupy space, preventing resize on switch */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px 12px' }}>
                <div style={{ display: 'grid' }}>
                  {previewDays.map((d, i) => {
                    const items = d.items || [];
                    const isRest = !items.length;
                    const visible = i === previewDayIdx;
                    return (
                      <div key={d.id || i} style={{ gridArea: '1/1', visibility: visible ? 'visible' : 'hidden', pointerEvents: visible ? 'auto' : 'none' }}>
                        {isRest ? (
                          <div style={{ textAlign: 'center', padding: '28px 0' }}>
                            <div className="display-it" style={{ fontSize: 28, color: UI.inkSoft, fontStyle: 'italic', fontWeight: 300, marginBottom: 4 }}>Recover.</div>
                            <div style={{ fontSize: 12, color: UI.inkFaint }}>Rest day</div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {items.map((it, k) => {
                              const ex = LB.findExercise(store, it.exId);
                              const label = it.repsPerSet && it.repsPerSet.length > 1
                                ? it.repsPerSet.join('/')
                                : it.repsMax != null ? `${it.sets}×${it.reps}-${it.repsMax}`
                                : ex?.no_weight_reps ? `${it.sets}×` : `${it.sets}×${it.reps}`;
                              const nextIt = items[k + 1];
                              const prevIt = items[k - 1];
                              const linkedNext = it.supersetGroup && it.supersetGroup === nextIt?.supersetGroup;
                              const linkedPrev = it.supersetGroup && it.supersetGroup === prevIt?.supersetGroup;
                              const inGroup = linkedNext || linkedPrev;
                              return (
                                <div key={k} style={{
                                  display: 'flex', alignItems: 'center', gap: 10,
                                  padding: '9px 12px',
                                  borderRadius: linkedPrev && linkedNext ? 0 : linkedPrev ? '0 0 6px 6px' : linkedNext ? '6px 6px 0 0' : 6,
                                  border: `1px solid ${inGroup ? UI.goldSoft : UI.hairStrong}`,
                                  background: inGroup ? UI.goldFaint : UI.bgRaised,
                                }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi }}>{ex?.name || '—'}</div>
                                  </div>
                                  <span className="num" style={{
                                    fontSize: 12, color: UI.gold, background: UI.goldFaint,
                                    border: `1px solid ${UI.goldSoft}`, borderRadius: 4,
                                    padding: '3px 8px', whiteSpace: 'nowrap', flexShrink: 0,
                                    display: 'flex', alignItems: 'center', gap: 5,
                                  }}>
                                    <span>{label}</span>
                                    {it.progressionOffset === 0 && (
                                      <i className="fa-solid fa-ban" title="Smart Progression off" style={{ fontSize: 9, opacity: 0.7, color: UI.inkFaint }} />
                                    )}
                                    {it.progressionOffset != null && it.progressionOffset > 0 && (
                                      <i className="fa-solid fa-bolt" title={`Smart Progression: +${it.progressionOffset}`} style={{ fontSize: 9, opacity: 0.85 }} />
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Restore button */}
              <div style={{ padding: '12px 22px calc(16px + env(safe-area-inset-bottom, 0px))', borderTop: `0.5px solid ${UI.hairStrong}`, flexShrink: 0 }}>
                <Btn onClick={() => { closePreview(); restoreBackup(previewBackup); }} style={{ width: '100%', textAlign: 'center', justifyContent: 'center' }}>Restore this backup</Btn>
              </div>
          </MiniSheet>
        );
      })()}
    </Screen>
  );
}

// ─── Edit screen — rename, manage pattern ─
function ScheduleEditScreen({ store, setStore, go, userId, scheduleId, versionFrom }) {
  const [confirmEl, confirm] = useConfirm();
  const original = store.schedules.find(s => s.id === scheduleId);
  // Which version is being edited (identified by validFrom). -1 = unversioned
  // or the newest version → default save flow; >0 = an older version, edited
  // in place (its days are replaced directly, no "from date" / new version).
  const editVerIdx = (original?.versions?.length && versionFrom)
    ? original.versions.findIndex(v => v.validFrom === versionFrom)
    : -1;
  const [draft, setDraft] = useStateS(() => {
    if (!original) return null;
    const clone = JSON.parse(JSON.stringify(original));
    if (editVerIdx > 0 && original.versions[editVerIdx]) {
      clone.days = JSON.parse(JSON.stringify(original.versions[editVerIdx].days || []));
    }
    return clone;
  });
  const [pickingType, setPickingType] = useStateS(false);
  const [applyFromSheet, setApplyFromSheet] = useStateS(false);
  const [applyFromDate, setApplyFromDate] = useStateS('');
  const [applyFromDayIdx, setApplyFromDayIdx] = useStateS(0);
  const [editingDay, setEditingDay] = useStateS(null);
  const [mesoInfoOpen, setMesoInfoOpen] = useStateS(false);
  const [modifiersOpen, setModifiersOpen] = useStateS(false);
  // Weekday-mode whole-day import: pick a source day, then a weekday to place it on.
  const [importDayOpen, setImportDayOpen] = useStateS(false);
  const [pendingImportDay, setPendingImportDay] = useStateS(null); // { name, items, migrateId } awaiting a weekday

  const reorderDays = (from, to) => {
    if (from === to) return;
    setDraft(d => {
      const days = [...d.days];
      const [moved] = days.splice(from, 1);
      days.splice(to, 0, moved);
      return { ...d, days };
    });
  };
  const daysListRef = UI.useDragReorder({ onReorder: reorderDays });

  if (!draft) return null;

  const isActive = draft.id === store.activeScheduleId;
  const isWeekday = LB.isWeekdayPlan(draft);
  const isFlex = LB.isFlexPlan(draft);
  // Weekday whole-day import is offered only when there's a source day to pull
  // from and a free weekday slot to place it on (max 7 days).
  const canImportWholeDay = store.schedules.some(s => (s.days || []).some(d => (d.items || []).length > 0)) && draft.days.length < 7;

  const toggleWeekdayEdit = (idx) => {
    setDraft(d => {
      if (d.days.some(day => day.weekday === idx)) return { ...d, days: d.days.filter(day => day.weekday !== idx) };
      return { ...d, days: [...d.days, { id: LB.uid(), name: 'FULL', weekday: idx, items: [] }] };
    });
  };

  const removeDay = async (idx) => {
    if (!await confirm(`Remove "${draft.days[idx].name}" from the cycle?`, { ok: 'Remove', danger: true })) return;
    setDraft(d => ({ ...d, days: d.days.filter((_, i) => i !== idx) }));
  };
  const addDayType = (type) => {
    setDraft(d => ({ ...d, days: [...d.days, { id: LB.uid(), name: type, items: [] }] }));
    setPickingType(false);
  };

  const doSave = async (effectiveFrom, startDayIdx) => {
    let savedDraft = draft;
    if (effectiveFrom) {
      // Snapshot the original plan as a version entry
      const originalDays = original.days;
      // Find the original plan's start date for the snapshot's validFrom
      const isWd = LB.isWeekdayPlan(original);
      const originalStart = isWd
        ? (store.weekPlanStartDate || null)
        : (store.cycleStartDate || null);
      const existingVersions = original.versions || [];
      const newVersionEntry = { validFrom: effectiveFrom, days: draft.days };
      if (startDayIdx && startDayIdx > 0) newVersionEntry.cycleOffset = startDayIdx;
      let versions;
      if (existingVersions.length === 0) {
        // First versioned change — anchor the original plan
        const anchorDate = originalStart || LB.todayISO();
        versions = [newVersionEntry, { validFrom: anchorDate, days: originalDays }];
      } else {
        // Already versioned — prepend new version, keep rest
        versions = [newVersionEntry, ...existingVersions];
      }
      // One version per date — the new entry is first, so it wins for its date
      // (replaces any existing version with the same validFrom instead of duplicating).
      versions = LB.dedupeVersionsByDate(versions);
      savedDraft = { ...draft, versions };
      // Don't touch cycleStartDate / weekPlanStartDate: versions[] encodes
      // when each plan version takes effect; getPlanDaysForDate /
      // getCyclePosForDate derive the correct position for any given date.
      setStore(s => ({ ...s, schedules: s.schedules.map(x => x.id === savedDraft.id ? savedDraft : x) }));
    } else {
      // Non-structural save (e.g. exercise swap) on the newest/unversioned plan.
      // Keep the newest version's days in sync with sch.days so the
      // version-aware viewer reflects the change.
      if (draft.versions?.length) {
        savedDraft = { ...draft, versions: draft.versions.map((v, i) => i === 0 ? { ...v, days: draft.days } : v) };
      }
      setStore(s => ({ ...s, schedules: s.schedules.map(x => x.id === savedDraft.id ? savedDraft : x) }));
    }

    // If mesocycle_weeks changed (activated, deactivated, or weeks count changed),
    // clear any stored meso state for this plan — it belongs to the old config.
    if (original.mesocycle_weeks !== draft.mesocycle_weeks) {
      // Clear localStorage cache (new per-plan key + legacy single key)
      try { localStorage.removeItem('logbook-meso-state-' + draft.id); } catch {}
      try { localStorage.removeItem('logbook-meso-state'); } catch {}
      // Remove from store so syncStore deletes it from DB
      setStore(s => ({ ...s, mesoStates: (s.mesoStates || []).filter(m => m.scheduleId !== draft.id) }));
    }

    // If the flex flag actually changed on the active plan, apply the date-anchor
    // change now (turning flex on clears the anchor so date math stops driving
    // position; turning it off re-anchors to today). Done here — not on toggle —
    // so discarding the draft leaves the active plan's cycle position untouched.
    if (isActive && LB.isFlexPlan(original) !== LB.isFlexPlan(draft)) {
      const turnedOn = LB.isFlexPlan(draft);
      setStore(s => ({ ...s, cycleStartDate: turnedOn ? null : LB.todayISO() }));
    }

    const asClient = store.coaching?.asClient;
    if (store.activeScheduleId === draft.id && asClient?.status === 'active') {
      try {
        const diff = LB.diffSchedule(original, draft, store.exercises);
        if (diff) {
          const threadId = await LB.getOrCreateCoachingThread(asClient.id, `Changes on ${draft.name}`, userId);
          const body = `Modified active plan: ${draft.name}\n\n${diff.split('\n').map(l => `• ${l}`).join('\n')}`;
          await LB.addCoachingNote(asClient.id, 'plan', draft.id, draft.name, body, userId, threadId);
        }
      } catch (e) { console.error('Failed to send plan change note', e); }
    }
    go({ name: 'plan-view', scheduleId: draft.id, fromPlan: true });
  };

  // In-place edit of an older (non-newest) version: replace just that version's
  // days; sch.days stays the newest version (untouched). No "from date" flow.
  const doSaveVersion = async () => {
    const versions = (original.versions || []).map((v, i) =>
      i === editVerIdx ? { ...v, days: draft.days } : v
    );
    const savedDraft = { ...draft, versions, days: versions[0].days };
    setStore(s => ({ ...s, schedules: s.schedules.map(x => x.id === savedDraft.id ? savedDraft : x) }));

    const asClient = store.coaching?.asClient;
    if (store.activeScheduleId === draft.id && asClient?.status === 'active') {
      try {
        const before = { ...original, days: (original.versions[editVerIdx] || {}).days || [] };
        const diff = LB.diffSchedule(before, { ...draft }, store.exercises);
        if (diff) {
          const threadId = await LB.getOrCreateCoachingThread(asClient.id, `Changes on ${draft.name}`, userId);
          const body = `Modified plan: ${draft.name}\n\n${diff.split('\n').map(l => `• ${l}`).join('\n')}`;
          await LB.addCoachingNote(asClient.id, 'plan', draft.id, draft.name, body, userId, threadId);
        }
      } catch (e) { console.error('Failed to send plan change note', e); }
    }
    go({ name: 'plan-view', scheduleId: draft.id, fromPlan: true });
  };

  const save = () => {
    if (editVerIdx > 0) { doSaveVersion(); return; } // older version → update in place, no date prompt
    if (!dirty || store.activeScheduleId !== draft.id) { doSave(null); return; }
    const isWdPlan = LB.isWeekdayPlan(original);
    const structurallyChanged = isWdPlan
      ? JSON.stringify([...(original.days || [])].map(d => d.weekday).sort()) !==
        JSON.stringify([...(draft.days || [])].map(d => d.weekday).sort())
      : draft.days.length !== original.days.length ||
        draft.days.some((d, i) => {
          const orig = original.days[i] || {};
          return d.id !== orig.id || d.name !== orig.name;
        });
    if (!structurallyChanged) { doSave(null); return; }
    setApplyFromDate('');
    setApplyFromDayIdx(0);
    setApplyFromSheet(true);
  };
  const deleteSch = async () => {
    if (!await confirm(`This cannot be undone.`, { title: `Delete "${draft.name}"?`, ok: 'Delete', danger: true })) return;
    setStore(s => ({
      ...s,
      schedules: s.schedules.filter(x => x.id !== draft.id),
      activeScheduleId: s.activeScheduleId === draft.id ? null : s.activeScheduleId,
    }));
    go({ name: 'plan' });
  };
  const toggleArchive = async () => {
    const willArchive = !draft.archived;
    if (willArchive && isActive) {
      if (!await confirm('Archiving will deactivate this plan.', { title: `Archive "${draft.name}"?`, ok: 'Archive' })) return;
    }
    setStore(s => ({
      ...s,
      schedules: s.schedules.map(x => x.id === draft.id ? { ...x, archived: willArchive } : x),
      activeScheduleId: (willArchive && s.activeScheduleId === draft.id) ? null : s.activeScheduleId,
    }));
    go({ name: 'plan' });
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const dateInputStyle = {
    background: UI.bgInset, border: 'none',
    borderRadius: 4, padding: '10px 14px', color: UI.ink,
    fontFamily: UI.fontNum, fontSize: 15, outline: 'none',
    width: '100%', boxSizing: 'border-box', display: 'block', colorScheme: 'dark', textAlign: 'center', WebkitAppearance: 'none',
  };

  const dayActionLabel = (day) => (day.name === 'REST' || !day.items.length) ? 'edit' : `${day.items.length} ex · edit`;

  const switchMode = async () => {
    if (!isWeekday) {
      // Cycle → Weekday wipes the whole day structure (weekday plans start empty).
      const dayCount = draft.days.length;
      const msg = dayCount > 0
        ? `This resets the plan structure: all ${dayCount} ${dayCount === 1 ? 'day' : 'days'} and their order are cleared, and you rebuild the week from scratch. Your exercises stay safe in the exercise library.`
        : 'Switch this plan to weekday mode?';
      if (!await confirm(msg, { title: 'Switch to Weekday mode?', ok: dayCount > 0 ? 'Reset & switch' : 'Switch', danger: dayCount > 0 })) return;
      // Weekday plans can't be flex — clear the modifier on switch.
      setDraft(d => ({ ...d, mode: 'weekday', days: [], is_flex: false }));
    } else {
      // Weekday → Cycle: just strip weekday assignments, keep exercises
      setDraft(d => ({
        ...d,
        mode: undefined,
        days: [...d.days]
          .sort((a, b) => (a.weekday != null ? a.weekday : 0) - (b.weekday != null ? b.weekday : 0))
          .map(function(day) { var nd = Object.assign({}, day); delete nd.weekday; return nd; }),
      }));
    }
  };

  // Flex is a modifier on Cycle mode: ordered days, but the position advances
  // only when you train/skip (never by date). Toggling it on an active plan
  // clears the date anchor so the date-based cycle math stops driving position.
  const toggleFlex = () => {
    const turningOn = !isFlex;
    setDraft(d => {
      const next = { ...d, is_flex: turningOn };
      if (!turningOn) {
        next.sessions_per_week = null;
      }
      return next;
    });
    // The date-anchor change is applied in doSave (gated on the flag actually
    // changing), never here — toggling then discarding must not reset the
    // active plan's cycle position.
  };

  return (
    <Screen>
      <TopBar
        title="Edit plan"
        sub={editVerIdx > 0
          ? `V${original.versions.length - editVerIdx} · from ${new Date(versionFrom + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : null}
        onBack={async () => {
          if (dirty && !await confirm('Unsaved changes will be lost.', { title: 'Discard changes?', ok: 'Discard', danger: true })) return;
          go({ name: 'plan-view', scheduleId: draft.id, fromPlan: true });
        }}
        right={
          <button onClick={save} style={{
            background: dirty ? UI.goldFaint : 'transparent',
            border: `1px solid ${dirty ? UI.goldSoft : UI.hairStrong}`,
            borderRadius: 4, padding: '5px 12px', cursor: 'pointer',
            color: dirty ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>Save</button>
        }
      />
      <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Name">
          <TextInput value={draft.name} onChange={(v) => setDraft(d => ({ ...d, name: v.toUpperCase() }))} />
        </Field>

        <Field label="Mode">
          <div style={{ display: 'flex', gap: 0, background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, padding: 3 }}>
            {[
              { key: 'cycle',   label: 'Cycle',    active: !isWeekday },
              { key: 'weekday', label: 'Weekdays', active: isWeekday  },
            ].map(m => (
              <button key={m.key} onClick={m.active ? undefined : switchMode} style={{
                flex: 1, padding: '8px 0', border: 'none', borderRadius: 4,
                cursor: m.active ? 'default' : 'pointer',
                background: m.active ? UI.bgRaised : 'transparent',
                color: m.active ? UI.ink : UI.inkFaint,
                fontFamily: UI.fontUi, fontSize: 12, fontWeight: m.active ? 600 : 400,
                letterSpacing: '0.06em',
              }}>{m.label}</button>
            ))}
          </div>
        </Field>

        {/* Options row — opens modifiers sheet */}
        {(() => {
          const parts = [];
          if (!isWeekday && isFlex) {
            parts.push('Flex');
            if (draft.sessions_per_week != null) parts.push(`${draft.sessions_per_week}×/wk`);
          }
          const hasMeso = draft.mesocycle_weeks != null;
          const sr = draft.mesocycle_start_rir ?? 3;
          const er = draft.mesocycle_end_rir ?? 0;
          const hellCycle = hasMeso && er < 0; // beyond-failure end → the box smoulders
          if (hasMeso) {
            parts.push(`${draft.mesocycle_weeks}wk meso`);
            parts.push(`${sr}→${er} RIR${er < 0 ? ' 🔥' : ''}`);
          }
          const summary = parts.join(' · ');
          return (
            <button onClick={() => setModifiersOpen(true)} style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
              background: hellCycle ? 'rgba(210,45,0,0.10)' : (summary ? `rgba(var(--accent-rgb),0.06)` : UI.bgRaised),
              border: `1px solid ${hellCycle ? 'rgba(255,120,40,0.6)' : (summary ? UI.goldSoft : UI.hairStrong)}`,
              borderRadius: 6, padding: '13px 16px', cursor: 'pointer', textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
              ...(hellCycle ? { animation: 'hellGlow 2s ease-in-out infinite' } : {}),
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={summary ? UI.gold : UI.inkSoft} strokeWidth="1.8" strokeLinecap="round">
                <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
                <circle cx="9" cy="6" r="2.5" fill={summary ? UI.gold : UI.inkSoft} stroke="none"/>
                <circle cx="15" cy="12" r="2.5" fill={summary ? UI.gold : UI.inkSoft} stroke="none"/>
                <circle cx="9" cy="18" r="2.5" fill={summary ? UI.gold : UI.inkSoft} stroke="none"/>
              </svg>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: summary ? UI.gold : UI.inkSoft, fontWeight: 600, marginBottom: summary ? 3 : 0 }}>Options</div>
                {summary && <div style={{ fontFamily: UI.fontUi, fontSize: 12, color: hellCycle ? 'rgba(255,140,70,1)' : UI.ink, fontWeight: hellCycle ? 600 : 400 }}>{summary}</div>}
              </div>
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke={UI.inkFaint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 2l5 5-5 5"/>
              </svg>
            </button>
          );
        })()}

        {isActive && !isWeekday && !isFlex && (
          <Field label="Cycle start date (Day 1)">
            <div style={{ overflow: 'hidden', borderRadius: 4, width: '100%', border: `1px solid ${UI.hairStrong}` }}>
              <input type="date" value={store.cycleStartDate || ''}
                onChange={e => { if (e.target.value) setStore(s => ({ ...s, cycleStartDate: e.target.value })); }}
                style={dateInputStyle} />
            </div>
            {store.cycleStartDate && draft.days.length > 0 && (() => {
              const idx = LB.cyclePosFromStartDate(store.cycleStartDate, draft.days.length, LB.todayISO());
              return <div className="micro" style={{ marginTop: 8 }}>Today = Day {idx + 1} of {draft.days.length}</div>;
            })()}
          </Field>
        )}
        {isActive && isWeekday && (
          <Field label="Week plan start date (Week 1)">
            <div style={{ overflow: 'hidden', borderRadius: 4, width: '100%', border: `1px solid ${UI.hairStrong}` }}>
              <input type="date" value={store.weekPlanStartDate || ''}
                onChange={e => { if (e.target.value) setStore(s => ({ ...s, weekPlanStartDate: e.target.value })); }}
                style={dateInputStyle} />
            </div>
            {store.weekPlanStartDate && (() => {
              const start = LB.parseDate(store.weekPlanStartDate);
              const today = new Date(); today.setHours(12, 0, 0, 0);
              const weekNum = Math.floor(Math.round((today - start) / 86400000) / 7) + 1;
              return <div className="micro" style={{ marginTop: 8 }}>Today = Week {weekNum}</div>;
            })()}
          </Field>
        )}

        {isWeekday ? (
          <div>
            <span className="label">Training days</span>
            <div style={{ display: 'flex', gap: 6, margin: '10px 0 14px' }}>
              {WEEKDAYS.map((wd, i) => {
                const active = draft.days.some(d => d.weekday === i);
                return (
                  <button key={i} onClick={() => toggleWeekdayEdit(i)} style={{
                    flex: 1, minWidth: 0, height: 44, borderRadius: 6,
                    border: `1px solid ${active ? UI.goldSoft : UI.hairStrong}`,
                    background: active ? UI.goldFaint : 'transparent',
                    color: active ? UI.gold : UI.inkFaint,
                    fontFamily: UI.fontNum, fontSize: 12, cursor: 'pointer', fontWeight: active ? 600 : 400,
                  }}>{wd}</button>
                );
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...draft.days].sort((a,b)=>a.weekday-b.weekday).map(day => (
                <div key={day.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
                  padding: '8px 12px', borderRadius: 4,
                }}>
                  <div className="num" style={{ width: 30, textAlign: 'center', color: UI.inkSoft, fontSize: 12, fontWeight: 600 }}>{WEEKDAYS[day.weekday]}</div>
                  <button onClick={() => setEditingDay(day.id)} style={{
                    flex: 1, background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: '6px 8px', borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    color: day.name === 'REST' ? UI.inkFaint : UI.ink, fontSize: 14, fontWeight: 600, fontFamily: UI.fontUi,
                  }}><span>{day.name}</span><span className="micro" style={{ fontStyle: 'normal' }}>{dayActionLabel(day)}</span></button>
                  <button onClick={() => toggleWeekdayEdit(day.weekday)} style={{ ...dayEditIconBtn, color: UI.danger, fontSize: 18 }}>×</button>
                </div>
              ))}
            </div>
            {canImportWholeDay && (
              <button onClick={() => setImportDayOpen(true)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', marginTop: 10, padding: '12px 14px', borderRadius: 4,
                background: UI.goldFaint, border: `1px solid ${UI.goldSoft}`,
                cursor: 'pointer', color: UI.gold, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
              }}>
                <span>↩ Import day with history</span>
                <span className="micro" style={{ color: UI.gold, opacity: 0.7 }}>exercises + progression →</span>
              </button>
            )}
          </div>
        ) : (
          <div>
            <span className="label">Cycle · {draft.days.length} days</span>
            <div ref={daysListRef} data-reorder-list="true" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {draft.days.map((day, i) => {
                const isRest = day.name === 'REST' || !day.items.length;
                return (
                  <div key={day.id} data-reorder-item="true" style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
                    padding: '8px 12px', borderRadius: 4,
                  }}>
                    <DragHandle />
                    <div className="num" style={{ width: 26, textAlign: 'center', color: UI.inkFaint, fontSize: 11 }}>{i+1}</div>
                    <button onClick={() => setEditingDay(day.id)} style={{
                      flex: 1, background: 'transparent', border: 'none', cursor: 'pointer',
                      padding: '6px 8px', borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      color: isRest ? UI.inkFaint : UI.ink, fontSize: 14, fontWeight: 600, fontFamily: UI.fontUi,
                    }}><span>{day.name}</span><span className="micro" style={{ fontStyle: 'normal' }}>{dayActionLabel(day)}</span></button>
                    <button data-reorder-ignore="true" onClick={() => removeDay(i)} style={{ ...dayEditIconBtn, color: UI.danger, fontSize: 18 }}>×</button>
                  </div>
                );
              })}
              <Btn kind="ghost" onClick={() => setPickingType(true)} style={{ borderStyle: 'dashed', fontSize: 12 }}>
                + Add day
              </Btn>
            </div>
          </div>
        )}

        <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.7 }}>
          Tap a day to edit its type and exercises.
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <Btn kind="ghost" onClick={toggleArchive} style={{ flex: 1, fontSize: 12, color: UI.inkSoft, borderColor: UI.hairStrong }}>
            {draft.archived ? 'Unarchive' : 'Archive plan'}
          </Btn>
          <Btn kind="ghost" onClick={deleteSch} style={{ flex: 1, fontSize: 12, color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.25)' }}>Delete plan</Btn>
        </div>
      </div>

      {editingDay && (
        <DayEditor
          store={store} setStore={setStore}
          day={draft.days.find(d => d.id === editingDay)}
          schedule={draft}
          onClose={() => setEditingDay(null)}
          onSave={(updated) => {
            // Match by editingDay (the id the day currently has in the plan),
            // NOT updated.id: copyItemsFromDay swaps the day's id to the source
            // day's id when importing "from plan" across plans (to carry that
            // day's session history over). updated.id then no longer matches any
            // existing day, so matching on it silently dropped the whole import
            // — the exercises appeared in the editor but never saved.
            setDraft(d => ({ ...d, days: d.days.map(x => x.id === editingDay ? updated : x) }));
            setEditingDay(null);
          }}
        />
      )}
      {pickingType && (
        <DayTypePicker
          store={store} setStore={setStore}
          title="Choose day type"
          hideRest={isFlex}
          onClose={() => setPickingType(false)}
          onPick={addDayType}
          onImport={(day, migrateId) => {
            setDraft(d => ({ ...d, days: [...d.days, { id: migrateId || LB.uid(), name: day.name, items: day.items }] }));
            setPickingType(false);
          }}
        />
      )}
      {/* Weekday whole-day import: pick a source day, then a weekday to place it on. */}
      {importDayOpen && (
        <DayCopyPicker
          store={store}
          schedule={null}
          currentDayId={null}
          multiSelect={false}
          onClose={() => setImportDayOpen(false)}
          onCopy={(sourceDay, migrateId) => {
            // Deep-copy items + remap superset group ids so the new day never
            // shares objects / group ids with the source day.
            const gidMap = {};
            const items = (sourceDay.items || []).map(it => {
              const next = { ...it };
              if (it.supersetGroup) { gidMap[it.supersetGroup] = gidMap[it.supersetGroup] || LB.uid(); next.supersetGroup = gidMap[it.supersetGroup]; }
              return next;
            });
            setPendingImportDay({ name: sourceDay.name, items, migrateId });
            setImportDayOpen(false);
          }}
        />
      )}
      {pendingImportDay && (
        <MiniSheet onClose={() => setPendingImportDay(null)}>
          <div className="label" style={{ color: UI.inkFaint, marginBottom: 14 }}>PLACE "{pendingImportDay.name}" ON</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {WEEKDAYS.map((wd, i) => {
              const taken = draft.days.some(d => d.weekday === i);
              return (
                <button key={i} disabled={taken} onClick={() => {
                  setDraft(d => {
                    // Keep the source day's id (carries its session history) unless
                    // that id already exists in this plan — then use a fresh one.
                    const collides = d.days.some(x => x.id === pendingImportDay.migrateId);
                    const id = (pendingImportDay.migrateId && !collides) ? pendingImportDay.migrateId : LB.uid();
                    return { ...d, days: [...d.days, { id, name: pendingImportDay.name, weekday: i, items: pendingImportDay.items }] };
                  });
                  setPendingImportDay(null);
                }} style={{
                  // Exactly like the "Training days" grid: accent = already has a
                  // day (locked here), grey = free — tap a free one to place.
                  flex: 1, minWidth: 0, height: 44, borderRadius: 6,
                  border: `1px solid ${taken ? UI.goldSoft : UI.hairStrong}`,
                  background: taken ? UI.goldFaint : 'transparent',
                  color: taken ? UI.gold : UI.inkFaint,
                  fontFamily: UI.fontNum, fontSize: 12, fontWeight: taken ? 600 : 400,
                  cursor: taken ? 'not-allowed' : 'pointer',
                }}>{wd}</button>
              );
            })}
          </div>
          <div className="micro" style={{ color: UI.inkFaint, marginTop: 12, lineHeight: 1.6 }}>
            Highlighted weekdays already have a day — tap a free one.
          </div>
        </MiniSheet>
      )}
      {confirmEl}

      {applyFromSheet && (
        <MiniSheet onClose={() => setApplyFromSheet(false)}>
          <div className="label" style={{ color: UI.inkFaint, marginBottom: 18 }}>WHEN SHOULD THIS TAKE EFFECT?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, overflow: 'hidden', borderRadius: 4, border: `1px solid ${applyFromDate ? UI.goldSoft : UI.hairStrong}` }}>
                <input
                  type="date"
                  value={applyFromDate}
                  onChange={e => setApplyFromDate(e.target.value)}
                  style={{ background: UI.bgInset, border: 'none', borderRadius: 4, padding: '10px 14px', color: applyFromDate ? UI.ink : UI.inkFaint, fontFamily: UI.fontNum, fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box', display: 'block', colorScheme: 'dark' }}
                />
              </div>
            </div>
            {!isWeekday && draft.days.length > 1 && (
              <div>
                <div className="label" style={{ color: UI.inkFaint, marginBottom: 8 }}>START WITH DAY</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {draft.days.map((d, realIdx) => {
                    const active = applyFromDayIdx === realIdx;
                    return (
                      <button key={d.id} onClick={() => setApplyFromDayIdx(realIdx)} style={{
                        padding: '5px 11px 4px', borderRadius: 4, cursor: 'pointer',
                        border: `1px solid ${active ? UI.goldSoft : UI.hairStrong}`,
                        background: active ? UI.goldFaint : 'transparent',
                        WebkitTapHighlightColor: 'transparent',
                      }}>
                        <div style={{ fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, color: active ? UI.gold : UI.inkSoft }}>{d.name}</div>
                        <div style={{ fontFamily: UI.fontUi, fontSize: 8, color: active ? UI.gold : UI.inkFaint, letterSpacing: '0.08em' }}>Day {realIdx + 1}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <Btn
              disabled={!applyFromDate}
              onClick={() => { if (!applyFromDate) return; setApplyFromSheet(false); doSave(applyFromDate, applyFromDayIdx); }}
            >
              Apply from date
            </Btn>
          </div>
        </MiniSheet>
      )}

      <Sheet open={modifiersOpen} onClose={() => setModifiersOpen(false)} title="Options">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

          {!isWeekday && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="label">Flexible schedule</span>
              <button onClick={toggleFlex} style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                background: UI.bgInset, border: `1px solid ${isFlex ? UI.goldSoft : UI.hairStrong}`,
                borderRadius: 4, padding: '10px 12px', cursor: 'pointer', textAlign: 'left',
              }}>
                <div style={{ width: 44, height: 26, borderRadius: 13, flexShrink: 0, position: 'relative', background: isFlex ? UI.gold : UI.hairStrong, border: `0.5px solid ${isFlex ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`, transition: 'background 0.15s' }}>
                  <div style={{ position: 'absolute', top: 3, left: isFlex ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: isFlex ? '#0a0805' : '#fff', transition: 'left 0.15s' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.ink, fontWeight: 600 }}>Advance only when I train</div>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, marginTop: 2, lineHeight: 1.4 }}>
                    No fixed days and no rest days — your next workout simply waits until you log it, whenever that is.
                  </div>
                </div>
              </button>
            </div>
          )}

          {isFlex && (() => {
            const hasGoal = draft.sessions_per_week != null;
            const toggle = () => setDraft(d => ({
              ...d,
              sessions_per_week: d.sessions_per_week != null ? null
                : Math.min(7, Math.max(1, (d.days || []).filter(x => x.items?.length > 0).length || 3)),
            }));
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="label">Weekly goal</span>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                  background: UI.bgInset, border: `1px solid ${hasGoal ? UI.goldSoft : UI.hairStrong}`,
                  borderRadius: 4, padding: '10px 12px',
                }}>
                  <button onClick={toggle} style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                    <div style={{ width: 44, height: 26, borderRadius: 13, position: 'relative', background: hasGoal ? UI.gold : UI.hairStrong, border: `0.5px solid ${hasGoal ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`, transition: 'background 0.15s' }}>
                      <div style={{ position: 'absolute', top: 3, left: hasGoal ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: hasGoal ? '#0a0805' : '#fff', transition: 'left 0.15s' }} />
                    </div>
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.ink, fontWeight: 600 }}>
                      {hasGoal ? `${draft.sessions_per_week}× per week` : 'No target'}
                    </div>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, marginTop: 2, lineHeight: 1.4 }}>
                      {hasGoal ? 'Used for your weekly adherence score and deload timing.' : 'Just train whenever — adherence and deload timing won\'t apply.'}
                    </div>
                  </div>
                </div>
                {hasGoal && (() => {
                  const spw = draft.sessions_per_week;
                  const hint = LB.frequencyHint(spw);
                  return (
                    <div style={{ marginTop: 4 }}>
                      <Stepper value={spw} step={1} min={1} max={50}
                        suffix="/ week"
                        onChange={v => setDraft(d => ({ ...d, sessions_per_week: Math.min(50, Math.max(1, Math.round(v))) }))} />
                      {hint && <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 8, textAlign: 'center', lineHeight: 1.4 }}>{hint}</div>}
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {(() => {
            const hasMeso = draft.mesocycle_weeks != null;
            const toggleMeso = () => setDraft(d => ({ ...d, mesocycle_weeks: d.mesocycle_weeks != null ? null : 6 }));
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="label" style={{ flex: 1 }}>Mesocycle</span>
                  <button onClick={() => setMesoInfoOpen(true)} style={{
                    background: 'transparent', border: `1px solid ${UI.hairStrong}`, borderRadius: '50%',
                    width: 22, height: 22, cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi,
                    fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                  }}>ⓘ</button>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                  background: UI.bgInset, border: `1px solid ${hasMeso ? UI.goldSoft : UI.hairStrong}`,
                  borderRadius: 4, padding: '10px 12px',
                }}>
                  <button onClick={toggleMeso} style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                    <div style={{ width: 44, height: 26, borderRadius: 13, position: 'relative', background: hasMeso ? UI.gold : UI.hairStrong, border: `0.5px solid ${hasMeso ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`, transition: 'background 0.15s' }}>
                      <div style={{ position: 'absolute', top: 3, left: hasMeso ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: hasMeso ? '#0a0805' : '#fff', transition: 'left 0.15s' }} />
                    </div>
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.ink, fontWeight: 600 }}>
                      {hasMeso ? `${draft.mesocycle_weeks}-week mesocycle` : 'No mesocycle'}
                    </div>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, marginTop: 2, lineHeight: 1.4 }}>
                      {hasMeso ? 'RIR targets + auto-regulation feedback during training.' : 'Enable for RIR-based progressive overload.'}
                    </div>
                  </div>
                </div>
                {hasMeso && (() => {
                  const mesoCompletions = store.mesoStates?.find(m => m.scheduleId === draft.id)?.completions ?? 0;
                  return (
                    <div style={{ marginTop: 2 }}>
                      <Stepper value={draft.mesocycle_weeks} step={1} min={4} max={8}
                        suffix=" weeks"
                        onChange={v => setDraft(d => ({ ...d, mesocycle_weeks: Math.min(8, Math.max(4, Math.round(v))) }))} />
                      {(() => {
                        const sr = draft.mesocycle_start_rir ?? 3;
                        const er = draft.mesocycle_end_rir ?? 0;
                        return (
                          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                            <div style={{ flex: 1, textAlign: 'center' }}>
                              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>START RIR</div>
                              <Stepper value={sr} step={1} min={0} suffix=" RIR"
                                onChange={v => setDraft(d => ({ ...d, mesocycle_start_rir: Math.min(3, Math.max(0, Math.round(v))) }))} />
                            </div>
                            <div style={{ flex: 1, textAlign: 'center' }}>
                              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>END RIR</div>
                              <Stepper value={er} step={1} min={-3} suffix=" RIR"
                                onChange={v => setDraft(d => ({ ...d, mesocycle_end_rir: Math.min(0, Math.max(-3, Math.round(v))) }))} />
                            </div>
                          </div>
                        );
                      })()}
                      <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 10, textAlign: 'center', lineHeight: 1.5 }}>
                        {LB.mesoTaperPreview(draft.mesocycle_weeks, draft.mesocycle_start_rir ?? 3, draft.mesocycle_end_rir ?? 0)}
                      </div>
                      {mesoCompletions > 0 && (
                        <button onClick={() => setStore(s => ({
                          ...s,
                          mesoStates: (s.mesoStates || []).map(m =>
                            m.scheduleId === draft.id ? { ...m, completions: 0, updatedAt: new Date().toISOString() } : m
                          ),
                        }))} style={{
                          marginTop: 10, width: '100%', background: 'transparent',
                          border: `1px solid ${UI.hairStrong}`, borderRadius: 4,
                          padding: '7px 12px', cursor: 'pointer', fontFamily: UI.fontUi,
                          fontSize: 11, color: UI.inkSoft, textAlign: 'center',
                          WebkitTapHighlightColor: 'transparent',
                        }}>
                          Reset meso history ({mesoCompletions}× completed)
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          <Btn onClick={() => setModifiersOpen(false)} style={{ width: '100%', textAlign: 'center', justifyContent: 'center' }}>Done</Btn>
        </div>
      </Sheet>

      <Sheet open={mesoInfoOpen} onClose={() => setMesoInfoOpen(false)} title="Mesocycle">
        <div style={{ fontSize: 13, color: UI.inkSoft, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0 }}>A <strong style={{ color: UI.ink }}>mesocycle</strong> is a structured training block (4–8 weeks) where effort progressively increases each week, measured by <strong style={{ color: UI.ink }}>Reps in Reserve (RIR)</strong> — how many reps you could still do before failure.</p>
          <p style={{ margin: 0 }}>By default week 1 starts easy (3 RIR) and ramps up to all-out effort (0 RIR) by the final week, then you deload. You can adjust both endpoints — and even set the peak <em>past</em> failure (negative RIR), which auto-adds that many lengthened partials to every set. That last one's for very advanced lifters. 🔥</p>
          <div style={{ background: UI.bgInset, borderRadius: 6, padding: '12px 14px', border: `1px solid ${UI.hairStrong}` }}>
            <div className="label" style={{ marginBottom: 10 }}>What Zane asks during training</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['Before first set of a muscle group', 'Soreness carryover from last session?'],
                ['After last set of each exercise', 'Any joint discomfort?'],
                ['After last exercise of a muscle group', 'Pump quality + volume feel?'],
              ].map(([when, what]) => (
                <div key={when} style={{ fontSize: 12 }}>
                  <div style={{ color: UI.gold, fontWeight: 600, marginBottom: 2 }}>{when}</div>
                  <div style={{ color: UI.ink }}>{what}</div>
                </div>
              ))}
            </div>
          </div>
          <p style={{ margin: 0 }}>Your answers auto-adjust set targets for the next time you run that session — more sets when you need more stimulus, fewer when recovery is lagging.</p>
          <p style={{ margin: 0 }}>Weight increases are earned at session end: if you hit all your reps <em>and</em> the feedback comes back clean — no joint issues, pump was good, volume felt right — Zane banks a load boost for the next time you hit that session. Miss any of those signals and the weight holds. <strong style={{ color: UI.ink }}>Smart Progression</strong> works alongside this: if enabled, it also suggests load steps based on your rep range history. Together they keep the bar moving forward across weeks and into Meso 2.</p>
        </div>
        <Btn onClick={() => setMesoInfoOpen(false)} style={{ width: '100%', marginTop: 20 }}>Got it</Btn>
      </Sheet>
    </Screen>
  );
}

const dayEditIconBtn = {
  width: 22, height: 18, background: 'transparent', border: `1px solid ${UI.hairStrong}`,
  borderRadius: 4, color: UI.inkFaint, cursor: 'pointer', fontSize: 9,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
};

// ─── Day-type picker (sheet) ─────────────────────────────────────────
function DayTypePicker({ store, setStore, title, onClose, onPick, onImport, hideRest = false }) {
  const [confirmEl, confirm] = useConfirm();
  const [creating, setCreating] = useStateS(false);
  const [newName, setNewName] = useStateS('');
  const [importOpen, setImportOpen] = useStateS(false);
  const custom = store.customDayTypes || [];
  const hasImportable = onImport && store.schedules.some(s => s.days.some(d => d.items.length > 0));

  const createCustom = () => {
    const name = newName.trim().toUpperCase();
    if (!name) return;
    if (STANDARD_DAY_TYPES.includes(name) || custom.includes(name)) {
      onPick(name);
      return;
    }
    setStore(s => ({ ...s, customDayTypes: [...(s.customDayTypes || []), name] }));
    onPick(name);
    setNewName('');
  };

  const removeCustom = async (name) => {
    if (!await confirm('Existing plans will remain unchanged.', { title: `Remove "${name}"?`, ok: 'Remove', danger: true })) return;
    setStore(s => ({ ...s, customDayTypes: (s.customDayTypes || []).filter(t => t !== name) }));
  };

  return (
    <Sheet open={true} onClose={onClose} title={title}>
      <span className="label">Standard</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 18px' }}>
        {STANDARD_DAY_TYPES.filter(t => !(hideRest && t === 'REST')).map(t => (
          <button key={t} onClick={() => onPick(t)} style={dayTypeChip(t === 'REST')}>{t}</button>
        ))}
      </div>

      <span className="label">Custom</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 6px' }}>
        {custom.length === 0 && !creating && (
          <div className="micro" style={{ color: UI.inkFaint, padding: '6px 2px', fontStyle: 'italic' }}>
            No custom types yet. E.g. PUSH1 / PUSH2.
          </div>
        )}
        {custom.map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'stretch', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.goldSoft}` }}>
            <button onClick={() => onPick(t)} style={{
              ...dayTypeChip(false),
              border: 'none', borderRadius: 0,
              background: UI.goldFaint, color: UI.gold, fontWeight: 600,
            }}>{t}</button>
            <button onClick={() => removeCustom(t)} title="Remove" style={{
              background: UI.goldFaint, border: 'none', borderLeft: `0.5px solid ${UI.goldSoft}`,
              color: UI.gold, opacity: 0.55, padding: '0 8px', cursor: 'pointer', fontSize: 12,
            }}>×</button>
          </div>
        ))}
        {!creating && (
          <button onClick={() => setCreating(true)} style={{
            ...dayTypeChip(true), color: UI.gold, borderColor: UI.goldSoft,
          }}>+ new</button>
        )}
      </div>

      {creating && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', marginTop: 10,
          padding: 10, background: UI.bgInset, border: `1px dashed ${UI.goldSoft}`, borderRadius: 4,
        }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && createCustom()}
            placeholder="e.g. PUSH1"
            style={{
              flex: 1, background: 'transparent', border: 'none',
              borderBottom: `1px solid ${UI.goldSoft}`,
              color: UI.gold, padding: '8px 0',
              fontFamily: UI.fontNum, fontSize: 14, letterSpacing: '0.08em', outline: 'none',
            }}
          />
          <Btn kind="ghost" onClick={() => { setCreating(false); setNewName(''); }} style={{ minHeight: 36, padding: '4px 10px', fontSize: 11 }}>×</Btn>
          <Btn onClick={createCustom} disabled={!newName.trim()} style={{ minHeight: 36, padding: '4px 12px', fontSize: 11, opacity: newName.trim() ? 1 : 0.4 }}>create</Btn>
        </div>
      )}

      <div className="micro" style={{ marginTop: 18, color: UI.inkFaint, lineHeight: 1.7 }}>
        For plans like PUSH1 / PULL1 / REST / LEGS1, create several custom types.
      </div>

      {hasImportable && (
        <>
          <div style={{ height: 1, background: UI.hair, margin: '18px 0 14px' }} />
          <span className="label">From existing plan</span>
          <button onClick={() => setImportOpen(true)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', marginTop: 8, padding: '12px 14px', borderRadius: 4,
            background: UI.goldFaint, border: `1px solid ${UI.goldSoft}`,
            cursor: 'pointer', color: UI.gold, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
          }}>
            <span>↩ Import day with history</span>
            <span className="micro" style={{ color: UI.gold, opacity: 0.7 }}>exercises + progression →</span>
          </button>
        </>
      )}

      {confirmEl}
      {importOpen && (
        <DayCopyPicker
          store={store}
          schedule={null}
          currentDayId={null}
          onClose={() => setImportOpen(false)}
          onCopy={(selections) => {
            selections.forEach(({ day, migrateId }) => onImport(day, migrateId));
            setImportOpen(false);
          }}
        />
      )}
    </Sheet>
  );
}

function dayTypeChip(dashed) {
  return {
    padding: '7px 12px', borderRadius: 4,
    background: 'transparent',
    border: `1px ${dashed ? 'dashed' : 'solid'} ${UI.hairStrong}`,
    color: UI.inkSoft, fontFamily: UI.fontNum, fontSize: 11, letterSpacing: '0.08em',
    cursor: 'pointer',
  };
}

// ─── Day copy / migrate picker — two-level: plan list → day list ─────
// multiSelect=true (default): day level shows checkboxes + confirm button,
//   onCopy(Array<{day, migrateId}>) called with all selected days.
// multiSelect=false: single-click immediately calls onCopy(day, migrateId).
function DayCopyPicker({ store, schedule, currentDayId, onClose, onCopy, multiSelect = true }) {
  const [selectedPlan, setSelectedPlan] = useStateS(null);
  const [selectedIds, setSelectedIds] = useStateS(new Set());
  const [tab, setTab] = useStateS('plans');

  const plans = store.schedules.filter(s =>
    s.days.some(d => d.items.length > 0 && (s.id !== schedule?.id || d.id !== currentDayId))
  );

  // Templates whose exercises still exist — mapped to a copyable plan day.
  const templates = (store.workoutTemplates || []).filter(t => (t.exercises || []).some(it => LB.findExercise(store, it.exId)));
  const importTemplate = (t) => {
    const items = normalizeSupersets((t.exercises || [])
      .filter(it => LB.findExercise(store, it.exId))
      .map(it => ({ exId: it.exId, sets: it.sets || 3, reps: it.reps ?? 8, ...(it.repsPerSet ? { repsPerSet: it.repsPerSet } : {}), ...(it.repsMax != null ? { repsMax: it.repsMax } : {}), ...(it.progressionOffset != null ? { progressionOffset: it.progressionOffset } : {}), ...(it.supersetGroup ? { supersetGroup: it.supersetGroup } : {}) })));
    const day = { id: LB.uid(), name: t.name, items };
    if (multiSelect) onCopy([{ day, migrateId: undefined }]);
    else onCopy(day, undefined);
  };

  const lastTrainedDate = (s) => {
    const dates = store.sessions
      .filter(sess => sess.scheduleId === s.id && sess.ended)
      .map(sess => sess.date)
      .sort()
      .reverse();
    return dates[0] || null;
  };

  const formatDate = (iso) => {
    if (!iso) return null;
    const d = LB.parseDate(iso);
    const now = new Date(); now.setHours(12,0,0,0);
    const diff = Math.round((now - d) / 86400000);
    return LB.dayLabel(diff, { rollup: true, referenceDate: d });
  };

  const goBack = () => { setSelectedPlan(null); setSelectedIds(new Set()); };

  if (!selectedPlan) {
    return (
      <Sheet open={true} onClose={onClose} title="Import exercises from">
        {templates.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {[['plans', 'Plans'], ['templates', 'Templates']].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                flex: 1, padding: '8px 0', borderRadius: 6, cursor: 'pointer',
                background: tab === key ? UI.goldFaint : UI.bgInset,
                border: `1px solid ${tab === key ? UI.goldSoft : UI.hairStrong}`,
                color: tab === key ? UI.gold : UI.inkSoft,
                fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
              }}>{label}</button>
            ))}
          </div>
        )}
        {tab === 'templates' ? (
          templates.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: UI.inkFaint, fontSize: 13 }}>No templates yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {templates.map(t => (
                <button key={t.id} onClick={() => importTemplate(t)} style={{
                  background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
                  borderRadius: 4, padding: '12px 14px', cursor: 'pointer',
                  textAlign: 'left', color: UI.ink, fontFamily: UI.fontUi, width: '100%',
                }}
                onMouseEnter={ev => ev.currentTarget.style.borderColor = UI.goldSoft}
                onMouseLeave={ev => ev.currentTarget.style.borderColor = UI.hairStrong}>
                  <div className="display" style={{ fontSize: 16 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 4, lineHeight: 1.5 }}>
                    {(t.exercises || []).map(it => LB.findExercise(store, it.exId)?.name || '—').join(' · ')}
                  </div>
                </button>
              ))}
            </div>
          )
        ) : plans.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: UI.inkFaint, fontSize: 13 }}>
            No plans with exercises yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {plans.map(s => {
              const isSame = s.id === schedule?.id;
              const last = lastTrainedDate(s);
              const dayCount = daysArr(s).filter(d => d.items.length > 0 && (isSame ? d.id !== currentDayId : true)).length;
              return (
                <button key={s.id} onClick={() => { setSelectedPlan(s); setSelectedIds(new Set()); }} style={{
                  background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
                  borderRadius: 4, padding: '12px 14px', cursor: 'pointer',
                  textAlign: 'left', color: UI.ink, fontFamily: UI.fontUi, width: '100%',
                }}
                onMouseEnter={ev => ev.currentTarget.style.borderColor = UI.goldSoft}
                onMouseLeave={ev => ev.currentTarget.style.borderColor = UI.hairStrong}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="display" style={{ fontSize: 16 }}>{s.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {s.archived && <span className="micro" style={{ color: UI.inkFaint }}>archived</span>}
                      {!isSame && <span className="micro" style={{ color: UI.gold }}>↩ history</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 5 }}>
                    <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{dayCount} day{dayCount !== 1 ? 's' : ''}</span>
                    {last && <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>last: {formatDate(last)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Sheet>
    );
  }

  // Day list for selected plan
  const isSamePlan = selectedPlan.id === schedule?.id;
  const days = daysArr(selectedPlan).filter(d => d.items.length > 0 && (!isSamePlan || d.id !== currentDayId));

  const confirmMulti = () => {
    const selections = days
      .filter(d => selectedIds.has(d.id))
      .map(d => ({ day: d, migrateId: isSamePlan ? undefined : d.id }));
    if (selections.length) onCopy(selections);
  };

  return (
    <Sheet open={true} onClose={goBack} title={selectedPlan.name}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {days.map(d => {
          const migrateId = isSamePlan ? undefined : d.id;
          const sel = selectedIds.has(d.id);

          if (!multiSelect) {
            return (
              <button key={d.id} onClick={() => onCopy(d, migrateId)} style={{
                background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
                borderRadius: 4, padding: '12px 14px', cursor: 'pointer',
                textAlign: 'left', color: UI.ink, fontFamily: UI.fontUi, width: '100%',
              }}
              onMouseEnter={ev => ev.currentTarget.style.borderColor = UI.goldSoft}
              onMouseLeave={ev => ev.currentTarget.style.borderColor = UI.hairStrong}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div className="display" style={{ fontSize: 16 }}>{d.name}</div>
                  {migrateId && <div className="micro" style={{ color: UI.gold, marginLeft: 8, flexShrink: 0, marginTop: 1 }}>↩ history</div>}
                </div>
                <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 4, lineHeight: 1.5 }}>
                  {d.items.map(it => LB.findExercise(store, it.exId)?.name || '—').join(' · ')}
                </div>
                <div className="num" style={{ fontSize: 10, color: UI.inkFaint, marginTop: 4 }}>
                  {d.items.length} exercise{d.items.length !== 1 ? 's' : ''}
                </div>
              </button>
            );
          }

          return (
            <button key={d.id} onClick={() => setSelectedIds(prev => {
              const next = new Set(prev);
              if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
              return next;
            })} style={{
              background: sel ? UI.goldFaint : UI.bgInset,
              border: `1px solid ${sel ? UI.goldSoft : UI.hairStrong}`,
              borderRadius: 4, padding: '12px 14px', cursor: 'pointer',
              textAlign: 'left', color: UI.ink, fontFamily: UI.fontUi, width: '100%',
              display: 'flex', alignItems: 'flex-start', gap: 12,
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 2,
                border: `1.5px solid ${sel ? UI.gold : UI.hairStrong}`,
                background: sel ? UI.gold : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {sel && <span style={{ color: UI.bg, fontSize: 11, lineHeight: 1, fontWeight: 700 }}>✓</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div className="display" style={{ fontSize: 16 }}>{d.name}</div>
                  {migrateId && <div className="micro" style={{ color: UI.gold, marginLeft: 8, flexShrink: 0, marginTop: 1 }}>↩ history</div>}
                </div>
                <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 4, lineHeight: 1.5 }}>
                  {d.items.map(it => LB.findExercise(store, it.exId)?.name || '—').join(' · ')}
                </div>
                <div className="num" style={{ fontSize: 10, color: UI.inkFaint, marginTop: 4 }}>
                  {d.items.length} exercise{d.items.length !== 1 ? 's' : ''}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {multiSelect && (
        <Btn
          onClick={confirmMulti}
          disabled={selectedIds.size === 0}
          style={{ width: '100%', marginTop: 16, opacity: selectedIds.size ? 1 : 0.4 }}
        >
          {selectedIds.size === 0
            ? 'Select days to import'
            : `Import ${selectedIds.size} day${selectedIds.size !== 1 ? 's' : ''} →`}
        </Btn>
      )}
    </Sheet>
  );
}

// ─── Day editor (exercises within a day) ─────────────────────────────
function ExerciseItemEditor({ item, exName, isCheckboxOnly, queuePos, queueTotal, store, setStore, onClose, onSave }) {
  // The exercise note is global (same record, shared across every plan that
  // uses this exercise) — not part of this day/plan item — so it's read from
  // and written straight back to store.exercises, independent of onSave's
  // item patch (same field the training screen's "Exercise note" edits).
  const exercise = LB.findExercise(store, item.exId);
  const [exNote, setExNote] = useStateS(exercise?.note || '');
  const hasVariable = item.repsPerSet && item.repsPerSet.length > 1;
  const hasRange = !hasVariable && item.repsMax != null;
  const [mode, setMode] = useStateS(hasVariable ? 'variable' : hasRange ? 'range' : 'uniform');
  const [sets, setSetsRaw] = useStateS(item.sets);
  // Doubles as the range floor when mode === 'range'.
  const [uniformReps, setUniformReps] = useStateS(item.reps ?? 8);
  const [rangeMax, setRangeMax] = useStateS(item.repsMax ?? (item.reps ?? 8) + 4);
  const [repsPerSet, setRepsPerSet] = useStateS(
    hasVariable ? item.repsPerSet : Array.from({ length: item.sets }, () => item.reps ?? 8)
  );
  // Independent of `mode` — a per-exercise Smart Progression override, kept
  // across Uniform/Per Set switches. null = inherit the global setting,
  // 0 = explicitly off, N = explicitly on with a +N reps ceiling.
  const [progOverride, setProgOverride] = useStateS(item.progressionOffset ?? null);

  const switchMode = (m) => {
    if (m === 'variable' && mode !== 'variable') {
      setRepsPerSet(Array.from({ length: sets }, () => uniformReps));
    }
    if (mode === 'variable' && m !== 'variable') {
      setUniformReps(repsPerSet[0] ?? 8);
    }
    if (m === 'range' && mode === 'variable') {
      setRangeMax(Math.max(...repsPerSet));
    }
    setMode(m);
  };

  const handleSetsChange = (v) => {
    const n = Math.max(1, Math.round(v));
    setSetsRaw(n);
    if (mode === 'variable') {
      setRepsPerSet(prev => {
        const next = [...prev];
        while (next.length < n) next.push(next[next.length - 1] ?? uniformReps);
        return next.slice(0, n);
      });
    }
  };

  const handleMinChange = (v) => {
    const n = Math.max(1, Math.round(v));
    setUniformReps(n);
    if (rangeMax < n) setRangeMax(n);
  };

  const handleSave = () => {
    const trimmedExNote = exNote.trim();
    if (item.exId && trimmedExNote !== (exercise?.note || '')) {
      setStore(s => ({ ...s, exercises: s.exercises.map(e => e.id === item.exId ? { ...e, note: trimmedExNote } : e) }));
    }
    if (isCheckboxOnly) {
      onSave({ sets, reps: 0, repsPerSet: undefined, repsMax: undefined, progressionOffset: progOverride });
      return;
    }
    if (mode === 'variable') {
      onSave({ sets, reps: repsPerSet[0] ?? uniformReps, repsPerSet, repsMax: undefined, progressionOffset: progOverride });
    } else if (mode === 'range') {
      onSave({ sets, reps: uniformReps, repsPerSet: undefined, repsMax: rangeMax, progressionOffset: progOverride });
    } else {
      onSave({ sets, reps: uniformReps, repsPerSet: undefined, repsMax: undefined, progressionOffset: progOverride });
    }
  };

  const toggleStyle = (active) => ({
    flex: 1, padding: '8px 0', borderRadius: 4, cursor: 'pointer',
    border: `1px solid ${active ? UI.gold : UI.hairStrong}`,
    background: active ? UI.goldFaint : 'transparent',
    color: active ? UI.gold : UI.inkFaint,
    fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600,
    letterSpacing: '0.1em', textTransform: 'uppercase',
    WebkitTapHighlightColor: 'transparent',
  });

  return (
    <Sheet open={true} onClose={onClose} title={exName}>
      {queueTotal > 1 && (
        <div className="micro" style={{ color: UI.inkFaint, marginBottom: 12 }}>Exercise {queuePos} / {queueTotal}</div>
      )}
      {/* Mode toggle — hidden for checkbox-only exercises */}
      {!isCheckboxOnly && <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button style={toggleStyle(mode === 'uniform')} onClick={() => switchMode('uniform')}>Uniform</button>
        <button style={toggleStyle(mode === 'range')} onClick={() => switchMode('range')}>Range</button>
        <button style={toggleStyle(mode === 'variable')} onClick={() => switchMode('variable')}>Per Set</button>
      </div>}

      {/* Sets stepper — always visible */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="label" style={{ width: 36, textAlign: 'right', flexShrink: 0 }}>Sets</span>
          <div style={{ flex: 1 }}>
            <Stepper value={sets} onChange={handleSetsChange} step={1} min={1} />
          </div>
        </div>

        {!isCheckboxOnly && <><div className="knurl" />

        {mode === 'uniform' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="label" style={{ width: 36, textAlign: 'right', flexShrink: 0 }}>Reps</span>
            <div style={{ flex: 1 }}>
              <Stepper value={uniformReps} onChange={v => setUniformReps(Math.max(1, Math.round(v)))} step={1} min={1} />
            </div>
          </div>
        ) : mode === 'range' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="label" style={{ width: 36, textAlign: 'right', flexShrink: 0 }}>Min</span>
              <div style={{ flex: 1 }}>
                <Stepper value={uniformReps} onChange={handleMinChange} step={1} min={1} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="label" style={{ width: 36, textAlign: 'right', flexShrink: 0 }}>Max</span>
              <div style={{ flex: 1 }}>
                <Stepper value={rangeMax} onChange={v => setRangeMax(Math.max(uniformReps, Math.round(v)))} step={1} min={uniformReps} />
              </div>
            </div>
          </>
        ) : (
          repsPerSet.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="num" style={{ fontSize: 11, color: UI.inkFaint, width: 36, textAlign: 'right', flexShrink: 0 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div style={{ flex: 1 }}>
                <Stepper
                  value={r}
                  onChange={v => setRepsPerSet(prev => prev.map((x, j) => j === i ? Math.max(1, Math.round(v)) : x))}
                  step={1} min={1}
                />
              </div>
            </div>
          ))
        )}</>}
      </div>

      {!isCheckboxOnly && (() => {
        if (mode === 'range') {
          // Range's own Max is always the ceiling when on — no separate
          // offset number to configure, just whether progression applies
          // to this exercise at all. progOverride 0 = off, anything else
          // (including a leftover Uniform/Per-Set custom value) = on.
          const isOn = progOverride !== 0;
          return (
            <div style={{ marginBottom: 24 }}>
              <div className="label" style={{ marginBottom: 10 }}>Smart Progression</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button style={toggleStyle(isOn)} onClick={() => setProgOverride(null)}>On</button>
                <button style={toggleStyle(!isOn)} onClick={() => setProgOverride(0)}>Off</button>
              </div>
              <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.4 }}>
                {isOn
                  ? `Hit ${rangeMax} reps on every set and we'll suggest a weight bump next session — works even with Smart Progression off in Settings.`
                  : 'Smart Progression is off for this exercise.'}
              </div>
            </div>
          );
        }
        // When the global setting is off, "inherit" always resolves to off
        // too — showing "Default" as a choice would be misleading, so the
        // toggle reframes as a plain On/Off for this exercise instead. Either
        // way the left button always maps to null (inherit) and the right
        // button to an explicit offset; only the labels (and whether 0 is
        // reachable via the stepper) change.
        const globalOn = !!store?.settings?.smartProgression;
        return (
          <div style={{ marginBottom: 24 }}>
            <div className="label" style={{ marginBottom: 10 }}>Smart Progression</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button style={toggleStyle(progOverride === null)} onClick={() => setProgOverride(null)}>{globalOn ? 'Default' : 'Off'}</button>
              <button style={toggleStyle(progOverride !== null)} onClick={() => setProgOverride(p => p ?? Math.max(globalOn ? 0 : 1, store?.settings?.progressionRangeTop ?? 4))}>{globalOn ? 'Custom' : 'On'}</button>
            </div>
            {progOverride !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <span className="label" style={{ width: 36, textAlign: 'right', flexShrink: 0 }}>Reps</span>
                <div style={{ flex: 1 }}>
                  <Stepper value={progOverride} onChange={v => setProgOverride(Math.max(globalOn ? 0 : 1, Math.round(v)))} step={1} min={globalOn ? 0 : 1} />
                </div>
              </div>
            )}
            <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.4 }}>
              {progOverride === null
                ? (globalOn ? 'Uses the global Smart Progression setting.' : 'Smart Progression is off for this exercise.')
                : progOverride === 0
                  ? 'Smart Progression is off for this exercise.'
                  : `Hit +${progOverride} reps over target on every set and we'll suggest a weight bump — overrides the global Smart Progression setting.`}
            </div>
          </div>
        );
      })()}

      <Field label="Exercise note (optional)">
        <TextInput value={exNote} onChange={setExNote} placeholder="e.g. cable pos 4, slow eccentric…" />
      </Field>
      <div className="micro" style={{ color: UI.inkFaint, marginTop: 6, marginBottom: 20, lineHeight: 1.4 }}>
        Shown every time you train this exercise, in any plan — not specific to this one.
      </div>
      <Btn onClick={handleSave} style={{ width: '100%' }}>Apply</Btn>
    </Sheet>
  );
}

// A superset group is only meaningful as a contiguous run of >= 2 adjacent
// items. After a move/remove/import, drop the group id from any item no
// longer next to a same-group partner so distant rows can't stay silently
// coupled. Shared between DayEditor (local edits) and DayCopyPicker
// (template import), which previously copied supersetGroup ids verbatim
// with no normalization — a template exercise deleted from the library since
// the template was saved could leave its former partner tagged with a stale,
// orphaned group id in the freshly-imported day.
function normalizeSupersets(items) {
  return items.map((it, i) => {
    if (!it.supersetGroup) return it;
    const linked = items[i - 1]?.supersetGroup === it.supersetGroup || items[i + 1]?.supersetGroup === it.supersetGroup;
    return linked ? it : { ...it, supersetGroup: null };
  });
}

function DayEditor({ store, setStore, day, schedule, onClose, onSave }) {
  const [draft, setDraft] = useStateS(day);
  const [addingEx, setAddingEx] = useStateS(false);
  const [copyingFrom, setCopyingFrom] = useStateS(false);
  const [editingItem, setEditingItem] = useStateS(null);
  const [editQueue, setEditQueue] = useStateS(null); // { indices: number[], pos: number } while stepping through newly added exercises
  const [pickingType, setPickingType] = useStateS(false);
  const [confirmEl, confirm] = useConfirm();
  const initialDay = React.useRef(JSON.stringify(day));

  const reorderItems = (from, to) => {
    if (from === to) return;
    setDraft(d => {
      const items = [...d.items];
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return { ...d, items: normalizeSupersets(items) };
    });
  };
  const itemsListRef = UI.useDragReorder({ onReorder: reorderItems });

  if (!draft) return null;

  const isDirty = JSON.stringify(draft) !== initialDay.current;
  const requestClose = async () => {
    if (isDirty && !await confirm('Your changes to this day won\'t be saved.', { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    onClose();
  };

  const updateItem = (idx, patch) => setDraft(d => {
    const item = d.items[idx];
    const gid = item?.supersetGroup;
    // Same guard as toggleSuperset: never copy the set count onto a cardio
    // partner (its `sets` is always 0) in a mixed group.
    const srcIsCardio = LB.findExercise(store, item?.exId)?.movement_type === 'cardio';
    return { ...d, items: d.items.map((it, i) => {
      if (i === idx) return { ...it, ...patch };
      if (gid && it.supersetGroup === gid && patch.sets !== undefined) {
        const canMatchSets = !srcIsCardio && LB.findExercise(store, it.exId)?.movement_type !== 'cardio';
        if (canMatchSets) return { ...it, sets: patch.sets };
      }
      return it;
    })};
  });
  const removeItem = (idx) => setDraft(d => ({ ...d, items: normalizeSupersets(d.items.filter((_, i) => i !== idx)) }));
  // Advances the add-exercise queue to the next item, or ends it once exhausted.
  const advanceEditQueue = () => {
    if (!editQueue) { setEditingItem(null); return; }
    const nextPos = editQueue.pos + 1;
    if (nextPos < editQueue.indices.length) {
      setEditQueue(q => ({ ...q, pos: nextPos }));
      setEditingItem(editQueue.indices[nextPos]);
    } else {
      setEditQueue(null);
      setEditingItem(null);
    }
  };
  const saveEditor = (patch) => { updateItem(editingItem, patch); advanceEditQueue(); };
  const closeEditor = () => advanceEditQueue();
  const addExercise = (exIds) => {
    const ids = Array.isArray(exIds) ? exIds : [exIds];
    const startIdx = draft.items.length;
    const newItems = ids.map(exId => {
      const ex = LB.findExercise(store, exId);
      const isCardioEx = ex?.movement_type === 'cardio';
      const isCheckboxEx = !!ex?.no_weight_reps;
      const defaultReps = ex?.progression_reps ?? 8;
      return {
        exId, sets: isCardioEx ? 0 : 3, reps: isCardioEx ? 0 : defaultReps,
        // Range is the default reps mode for a freshly added exercise.
        ...(!isCardioEx && !isCheckboxEx ? { repsMax: defaultReps + 4 } : {}),
      };
    });
    setDraft(d => ({ ...d, items: [...d.items, ...newItems] }));
    setAddingEx(false);
    // Step through each newly added exercise's sets/reps editor in sequence.
    const indices = ids.map((_, i) => startIdx + i);
    setEditQueue({ indices, pos: 0 });
    setEditingItem(indices[0]);
  };
  const copyItemsFromDay = (sourceDay, migrateId) => {
    // Deep-copy each item and remap superset group ids — a shallow spread
    // would share item objects (and group ids) with the source day.
    const gidMap = {};
    const copied = sourceDay.items.map(it => {
      const next = { ...it };
      if (it.supersetGroup) {
        gidMap[it.supersetGroup] = gidMap[it.supersetGroup] || LB.uid();
        next.supersetGroup = gidMap[it.supersetGroup];
      }
      return next;
    });
    // migrateId: preserve the source day's id so historical sessions for that
    // day carry over to this new plan automatically (sessions reference day_id).
    setDraft(d => ({ ...d, items: copied, ...(migrateId ? { id: migrateId } : {}) }));
    setCopyingFrom(false);
  };

  const toggleSuperset = (idx) => {
    setDraft(d => {
      const items = d.items.map(it => ({ ...it }));
      const a = items[idx], b = items[idx + 1];
      if (!b) return d;
      if (a.supersetGroup && a.supersetGroup === b.supersetGroup) {
        // Unlink just this seam, not the whole run: the part from here
        // backward keeps the original group id, the part from b onward gets
        // a fresh one so it stays linked to itself instead of losing its own
        // pairing — normalizeSupersets then drops the id from either side
        // that ends up without an adjacent same-group neighbor (a lone
        // remaining member). Previously this cleared the id on every item
        // sharing the group, dissolving an entire 3+ member giant set over
        // one click meant to detach a single pair.
        const gid = a.supersetGroup;
        const newGid = LB.uid();
        const split = items.map((it, i) => (i > idx && it.supersetGroup === gid) ? { ...it, supersetGroup: newGid } : it);
        return { ...d, items: normalizeSupersets(split) };
      }

      const exA = LB.findExercise(store, a.exId);
      const exB = LB.findExercise(store, b.exId);
      const canMatchSets = exA?.movement_type !== 'cardio' && exB?.movement_type !== 'cardio';

      if (a.supersetGroup && b.supersetGroup) {
        // Merging two distinct existing groups into one.
        const bGid = b.supersetGroup;
        return { ...d, items: items.map(it => it.supersetGroup === bGid ? { ...it, supersetGroup: a.supersetGroup } : it) };
      }
      if (a.supersetGroup) {
        // Extend a's existing group to include b (the new joiner) — reusing
        // a's id instead of always minting a fresh one, otherwise linking a
        // third item next to an existing pair silently orphans the pair's
        // other member.
        items[idx + 1] = { ...b, supersetGroup: a.supersetGroup, ...(canMatchSets ? { sets: a.sets } : {}) };
        return { ...d, items };
      }
      if (b.supersetGroup) {
        // Symmetric case: extend b's existing group backward to include a.
        items[idx] = { ...a, supersetGroup: b.supersetGroup, ...(canMatchSets ? { sets: b.sets } : {}) };
        return { ...d, items };
      }
      // Brand-new pair. Never copy the set count across a cardio/strength
      // pairing — a cardio item's `sets` (always 0) would silently zero out
      // the strength exercise's planned working sets.
      const gid = LB.uid();
      items[idx] = { ...a, supersetGroup: gid };
      items[idx + 1] = { ...b, supersetGroup: gid, ...(canMatchSets ? { sets: a.sets } : {}) };
      return { ...d, items };
    });
  };

  const canImportFromPlan = store.schedules.some(s =>
    s.days.some(d => d.items.length > 0 && (s.id !== schedule?.id || d.id !== draft.id))
  );

  return (
    <Sheet open={true} onClose={requestClose} title="Edit day">
      <Field label="Day type">
        <button onClick={() => setPickingType(true)} style={{
          width: '100%', textAlign: 'left', background: UI.bgInset,
          border: `1px solid ${UI.hairStrong}`, borderRadius: 4, padding: '10px 14px',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          color: draft.name === 'REST' ? UI.inkFaint : UI.ink, fontSize: 15, fontWeight: 600, fontFamily: UI.fontUi,
        }}>
          <span>{draft.name}</span>
          <span className="micro" style={{ fontStyle: 'normal' }}>change</span>
        </button>
      </Field>
      {draft.name === 'REST' ? (
        <div style={{ marginTop: 18, padding: '18px 14px', textAlign: 'center',
          border: `1px dashed ${UI.hairStrong}`, borderRadius: 4, color: UI.inkFaint }}>
          <div className="display-it" style={{ fontSize: 16, color: UI.inkSoft, marginBottom: 4 }}>Rest day.</div>
          <div className="micro">Change day name to add exercises.</div>
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span className="label" style={{ marginBottom: 0 }}>Exercises</span>
            {canImportFromPlan && (
              <button onClick={() => setCopyingFrom(true)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: UI.gold, fontSize: 10, fontFamily: UI.fontUi, padding: '2px 0',
                letterSpacing: '0.1em', textTransform: 'uppercase',
              }}>Import from plan</button>
            )}
          </div>
          <div ref={itemsListRef} data-reorder-list="true" style={{ display: 'flex', flexDirection: 'column' }}>
            {draft.items.flatMap((it, i) => {
              const ex = LB.findExercise(store, it.exId);
              const nextIt = draft.items[i + 1];
              const prevIt = draft.items[i - 1];
              const linkedToNext = it.supersetGroup && it.supersetGroup === nextIt?.supersetGroup;
              const linkedToPrev = it.supersetGroup && it.supersetGroup === prevIt?.supersetGroup;
              const inGroup = linkedToNext || linkedToPrev;
              const els = [];
              els.push(
                <div key={`item-${i}`} data-reorder-item="true" onClick={() => setEditingItem(i)} style={{
                  display: 'flex', gap: 8, alignItems: 'center',
                  background: inGroup ? UI.goldFaint : UI.bgInset,
                  border: `1px solid ${inGroup ? UI.goldSoft : UI.hairStrong}`,
                  borderRadius: linkedToPrev && linkedToNext ? 0 : linkedToPrev ? '0 0 4px 4px' : linkedToNext ? '4px 4px 0 0' : 4,
                  padding: '10px 12px', cursor: 'pointer', marginBottom: linkedToNext ? 0 : 6,
                }}>
                  <DragHandle />
                  <div style={{ flex: 1 }}>
                    <div className="display" style={{ fontSize: 15, color: UI.ink, lineHeight: 1.1 }}>{ex?.name || '—'}</div>
                  </div>
                  <div className="num" style={{
                    fontSize: 12, color: UI.gold, background: UI.goldFaint,
                    border: `1px solid ${UI.goldSoft}`, borderRadius: 4,
                    padding: '3px 8px', whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    <span>{it.repsPerSet && it.repsPerSet.length > 1 ? it.repsPerSet.join('/') : it.repsMax != null ? `${it.sets}×${it.reps}-${it.repsMax}` : ex?.no_weight_reps ? `${it.sets}×` : `${it.sets}×${it.reps}`}</span>
                    {it.progressionOffset === 0 && (
                      <i className="fa-solid fa-ban" title="Smart Progression off" style={{ fontSize: 9, opacity: 0.7, color: UI.inkFaint }} />
                    )}
                    {it.progressionOffset != null && it.progressionOffset > 0 && (
                      <i className="fa-solid fa-bolt" title={`Smart Progression: +${it.progressionOffset}`} style={{ fontSize: 9, opacity: 0.85 }} />
                    )}
                    <i className="fa fa-pencil" style={{ fontSize: 9, opacity: 0.7 }} />
                  </div>
                  <button data-reorder-ignore="true" onClick={e => { e.stopPropagation(); removeItem(i); }} style={{ ...dayEditIconBtn, color: UI.inkFaint, fontSize: 16 }}>×</button>
                </div>
              );
              if (i < draft.items.length - 1) {
                if (linkedToNext) {
                  els.push(
                    <div key={`conn-${i}`} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', background: UI.goldFaint, borderLeft: `1px solid ${UI.goldSoft}`, borderRight: `1px solid ${UI.goldSoft}`, padding: '1px 12px', marginBottom: 0 }}>
                      <button onClick={e => { e.stopPropagation(); toggleSuperset(i); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.gold, fontSize: 8, fontFamily: UI.fontUi, letterSpacing: '0.12em', padding: '2px 0' }}>SUPERSET ×</button>
                    </div>
                  );
                } else {
                  els.push(
                    <div key={`conn-${i}`} style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                      <button onClick={e => { e.stopPropagation(); toggleSuperset(i); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.1em', padding: '1px 8px' }}>Link ↕</button>
                    </div>
                  );
                }
              }
              return els;
            })}
            <Btn kind="ghost" onClick={() => setAddingEx(true)} style={{ borderStyle: 'dashed', minHeight: 42, fontSize: 12 }}>+ Add exercise</Btn>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <Btn kind="ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
        <Btn onClick={() => onSave(draft)} style={{ flex: 2 }}>Save</Btn>
      </div>

      {editingItem !== null && (
        <ExerciseItemEditor
          key={editingItem}
          item={draft.items[editingItem]}
          exName={LB.findExercise(store, draft.items[editingItem]?.exId)?.name || '—'}
          isCheckboxOnly={!!LB.findExercise(store, draft.items[editingItem]?.exId)?.no_weight_reps}
          queuePos={editQueue ? editQueue.pos + 1 : undefined}
          queueTotal={editQueue ? editQueue.indices.length : undefined}
          store={store}
          setStore={setStore}
          onClose={closeEditor}
          onSave={saveEditor}
        />
      )}
      {addingEx && (
        <ExercisePicker store={store} setStore={setStore} onClose={() => setAddingEx(false)} onPick={addExercise} />
      )}
      {copyingFrom && schedule && (
        <DayCopyPicker
          store={store}
          schedule={schedule}
          currentDayId={draft.id}
          onClose={() => setCopyingFrom(false)}
          multiSelect={false}
          onCopy={copyItemsFromDay}
        />
      )}
      {pickingType && (
        <DayTypePicker
          store={store} setStore={setStore}
          title="Day type"
          onClose={() => setPickingType(false)}
          onPick={(type) => { setDraft(d => ({ ...d, name: type })); setPickingType(false); }}
        />
      )}
      {confirmEl}
    </Sheet>
  );
}

function ExercisePicker({ store, setStore, onClose, onPick, singleSelect = false }) {
  const [q, setQ] = useStateS('');
  const [filterTags, setFilterTags] = useStateS([]);
  const [creatingNew, setCreatingNew] = useStateS(null);
  const [selected, setSelected] = useStateS([]);
  const toggleFilter = (m) => setFilterTags(t => t.includes(m) ? t.filter(x => x !== m) : [...t, m]);
  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const list = useMemoS(() => {
    const ql = q.toUpperCase();
    return store.exercises
      .filter(e => {
        const matchSearch = !q || e.name.toUpperCase().includes(ql) || e.tags?.some(t => t.toUpperCase().includes(ql));
        const matchTags = filterTags.length === 0 || filterTags.some(ft => e.tags?.includes(ft));
        return matchSearch && matchTags;
      })
      .sort((a,b) => a.name.localeCompare(b.name));
  }, [store.exercises, q, filterTags]);

  // System exercise catalog (exercise-db.js), surfaced on demand: only while
  // searching or filtering, so the default quick-add view stays the user's own
  // library. Catalog entries already in the library (by name) are hidden to
  // avoid offering a duplicate.
  const userNamesU = useMemoS(() => new Set(store.exercises.map(e => (e.name || '').toUpperCase())), [store.exercises]);
  const dbActive = !!q || filterTags.length > 0;
  const systemList = useMemoS(() => {
    if (!dbActive) return [];
    const ql = q.toUpperCase();
    return (window.SYSTEM_EXERCISES || [])
      .filter(s => !userNamesU.has((s.name || '').toUpperCase()))
      .filter(s => {
        const matchSearch = !q || s.name.toUpperCase().includes(ql) || s.tags?.some(t => t.toUpperCase().includes(ql));
        const matchTags = filterTags.length === 0 || filterTags.some(ft => s.tags?.includes(ft));
        return matchSearch && matchTags;
      })
      .sort((a,b) => a.name.localeCompare(b.name));
  }, [dbActive, q, filterTags, userNamesU]);

  // Resolve a picked id list to real user-exercise ids: a catalog (sys_) id is
  // duplicated into store.exercises (or mapped to an existing same-named copy)
  // so plans/sessions only ever hold user-owned ids. The new rows are added in
  // one setStore before onPick, and doAdd/doSwap read the exercise from fresh
  // state (functional setStore), so the just-created copy resolves correctly.
  const finalizePick = (ids) => {
    const sysById = new Map((window.SYSTEM_EXERCISES || []).map(s => [s.id, s]));
    const newRows = [];
    const resolved = ids.map(id => {
      const sys = sysById.get(id);
      if (!sys) return id;
      const existing = store.exercises.find(e => (e.name || '').toUpperCase() === sys.name.toUpperCase());
      if (existing) return existing.id;
      const row = LB.systemExerciseToRow(sys);
      newRows.push(row);
      return row.id;
    });
    if (newRows.length) setStore(s => ({ ...s, exercises: [...s.exercises, ...newRows] }));
    onPick(resolved);
  };

  const exactNameExists = !!q && (
    store.exercises.some(e => e.name.toUpperCase() === q.toUpperCase()) ||
    (window.SYSTEM_EXERCISES || []).some(s => s.name.toUpperCase() === q.toUpperCase())
  );

  return (
    <Sheet open={true} onClose={onClose} title="Select exercises">
      <Field label="">
        <TextInput value={q} onChange={v => setQ(v.toUpperCase())} placeholder="Search or type…" />
      </Field>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {MUSCLES.map(m => (
          <Pill key={m} gold={filterTags.includes(m)} onClick={() => toggleFilter(m)}
            style={{ cursor: 'pointer' }}>{m}</Pill>
        ))}
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', maxHeight: 240, overflow: 'auto', overscrollBehavior: 'contain' }}>
        {list.map((e, ei) => {
          const isSel = selected.includes(e.id);
          return (
            <React.Fragment key={e.id}>
            <button onClick={() => singleSelect ? finalizePick([e.id]) : toggleSelect(e.id)} style={{
              background: isSel ? UI.goldFaint : 'transparent', border: 'none', textAlign: 'left',
              padding: '11px 8px', cursor: 'pointer', borderRadius: 4,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              width: '100%', boxSizing: 'border-box',
            }}>
              <span className="display" style={{ fontSize: 17, color: isSel ? UI.gold : UI.ink }}>{e.name}</span>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                {isSel && <i className="fa fa-check-circle" style={{ color: UI.gold, fontSize: 15 }} />}
                {(e.tags || []).map(t => <Pill key={t} gold={isSel}>{t}</Pill>)}
              </div>
            </button>
            {(ei < list.length - 1 || systemList.length > 0) && <div className="knurl" />}
            </React.Fragment>
          );
        })}
        {systemList.length > 0 && (
          <div className="micro" style={{ padding: '8px 8px 4px', color: UI.inkFaint, letterSpacing: '0.12em' }}>DATABASE</div>
        )}
        {systemList.map((s, si) => {
          const isSel = selected.includes(s.id);
          return (
            <React.Fragment key={s.id}>
            <button onClick={() => singleSelect ? finalizePick([s.id]) : toggleSelect(s.id)} style={{
              background: isSel ? UI.goldFaint : 'transparent', border: 'none', textAlign: 'left',
              padding: '11px 8px', cursor: 'pointer', borderRadius: 4,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              width: '100%', boxSizing: 'border-box',
            }}>
              <span className="display" style={{ fontSize: 17, color: isSel ? UI.gold : UI.ink }}>{s.name}</span>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                {isSel && <i className="fa fa-check-circle" style={{ color: UI.gold, fontSize: 15 }} />}
                <Pill style={{ color: UI.inkFaint, borderColor: UI.hair, fontSize: 8 }}>DB</Pill>
                {(s.tags || []).map(t => <Pill key={t} gold={isSel}>{t}</Pill>)}
              </div>
            </button>
            {si < systemList.length - 1 && <div className="knurl" />}
            </React.Fragment>
          );
        })}
        {list.length === 0 && systemList.length === 0 && <div className="micro" style={{ padding: '20px 0', textAlign: 'center', color: UI.inkFaint }}>No exercises found</div>}
        {!dbActive && (window.SYSTEM_EXERCISES || []).length > 0 && (
          <div className="micro" style={{ padding: '12px 8px 2px', textAlign: 'center', color: UI.inkGhost, letterSpacing: '0.04em', textTransform: 'none', fontStyle: 'italic' }}>
            Search or pick a muscle to also add from the exercise database.
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <Btn onClick={() => finalizePick(selected)} style={{ marginTop: 12, width: '100%' }}>
          Add {selected.length} exercise{selected.length !== 1 ? 's' : ''} →
        </Btn>
      )}
      {/* Check against every exercise, not just the tag-filtered `list`: an
          existing user OR catalog exercise with this exact name must suppress
          "+ Create", or picking it creates a duplicate that splits its
          history/progression across two library entries. */}
      {q && !exactNameExists && (
        <button onClick={() => setCreatingNew(q)} style={{
          background: UI.goldFaint, border: `1px dashed ${UI.goldSoft}`,
          padding: '12px 14px', borderRadius: 4, cursor: 'pointer',
          color: UI.gold, fontSize: 13, marginTop: 8, fontFamily: UI.fontUi, textAlign: 'left',
          width: '100%', boxSizing: 'border-box',
        }}>+ Create "{q}"</button>
      )}
      {creatingNew !== null && (
        <window.Screens.ExerciseCreator
          initialName={creatingNew}
          initialTags={filterTags}
          store={store}
          setStore={setStore}
          onCreated={(id) => { onPick([id]); }}
          onClose={() => setCreatingNew(null)}
        />
      )}
    </Sheet>
  );
}

// ─── Plan setup wizard ───────────────────────────────────────────────
// Guided, beginner-friendly scaffold for a new plan: name → type → split (or
// weekdays) → mesocycle, one decision per step with a plain-language explainer.
// Mirrors the exercise-creation wizard's look (overlay card, segmented
// progress, optRow rows). Builds only the skeleton via LB.buildPlanSkeleton,
// then hands off to the editor. The shell is duplicated from ExerciseWizard
// (screens-lib.jsx) on purpose, so the shipped exercise wizard stays untouched
// and this one can grow its own stepper/reveal steps.
const PLAN_TITLES = { name: 'Name your plan', type: 'Plan type', split: 'Training split', weekdays: 'Training days', meso: 'Mesocycle' };
const PLAN_INTRO = {
  name: 'Give your plan a name. It shows up in your planner and history, and you can rename it any time.',
  type: 'How should your plan move forward? This decides when the next day comes up.',
  split: "Pick a split and we'll lay out the days for you. You can rename, reorder, or add days next.",
  weekdays: 'Which days of the week do you train? Tap all that apply.',
  meso: 'A mesocycle runs a fixed number of weeks with a planned intensity ramp (RIR), then a deload. Leave it off for a normal, open-ended plan.',
};
// Ordered wizard steps for the current picks. Split applies to every type
// (weekday maps its rotation onto the chosen days too); the weekday-picker step
// is weekday-only; a Custom cycle/flex split expands into one day-type picker
// per day (day0..dayN-1) so the user sets each day up in its own step.
function computePlanSteps({ type, presetKey, customCount, weekdayCount }) {
  const steps = ['name', 'type'];
  if (type != null) {
    steps.push('split');
    if (type === 'weekday') steps.push('weekdays');
    if (presetKey === 'custom') {
      // One day-type picker per day: cycle/flex use the count stepper, weekday
      // uses however many weekdays were picked (after the weekdays step).
      const n = type === 'weekday' ? (weekdayCount || 0) : Math.max(1, Math.round(customCount || 1));
      for (let i = 0; i < n; i++) steps.push('day' + i);
    }
  }
  steps.push('meso');
  return steps;
}

function PlanWizard({ store, setStore, go }) {
  const [step, setStep] = useStateS('name');
  const [confirming, setConfirming] = useStateS(false);
  const [name, setName] = useStateS('');
  const [type, setType] = useStateS(null);            // 'cycle' | 'weekday' | 'flex'
  const [presetKey, setPresetKey] = useStateS(null);  // SPLIT_PRESETS key | 'custom'
  const [customCount, setCustomCount] = useStateS(3);
  const [customDays, setCustomDays] = useStateS([null, null, null]); // per-day types for a Custom split (null = not picked yet)
  const setCustomN = (n) => { const c = Math.max(1, Math.round(n)); setCustomCount(c); setCustomDays(d => { const a = d.slice(0, c); while (a.length < c) a.push(null); return a; }); };
  const [dayFlash, setDayFlash] = useStateS(false); // brief checkmark when a day type is picked
  const [weekdaysSel, setWeekdaysSel] = useStateS([]); // weekday indices 0..6
  const [mesoOn, setMesoOn] = useStateS(false);
  const [mesoWeeks, setMesoWeeks] = useStateS(6);
  const [mesoStartRir, setMesoStartRir] = useStateS(3);
  const [mesoEndRir, setMesoEndRir] = useStateS(0);
  const [creatingDayType, setCreatingDayType] = useStateS(false); // "+ Custom" name entry on a day-type step
  const [newDayTypeName, setNewDayTypeName] = useStateS('');
  const [deleteTypeArm, setDeleteTypeArm] = useStateS(null); // custom type armed for a two-tap delete
  const [importOpen, setImportOpen] = useStateS(false); // day-import view on a day step
  const [importPlan, setImportPlan] = useStateS(null); // chosen source plan/group (step 2 of the import)
  const [importSel, setImportSel] = useStateS(new Set()); // selected source-day keys to import
  useEffectS(() => { setCreatingDayType(false); setNewDayTypeName(''); setDeleteTypeArm(null); setDayFlash(false); setImportOpen(false); setImportPlan(null); setImportSel(new Set()); }, [step]); // reset on step change

  // Importable sources grouped for a two-step pick (plan → day), so a user with
  // many plans doesn't face one giant flat list. Each group is a plan (its days
  // that have exercises) plus a "Templates" group (saved workout templates).
  const importGroups = useMemoS(() => {
    const groups = [];
    for (const s of store.schedules) {
      const days = (s.days || [])
        .map(d => ({ key: s.id + ':' + d.id, name: d.name, items: (d.items || []).filter(it => LB.findExercise(store, it.exId)) }))
        .filter(d => d.items.length);
      if (days.length) groups.push({ id: s.id, name: s.name, days });
    }
    const tplDays = (store.workoutTemplates || []).map(t => ({
      key: 'tpl:' + t.id, name: t.name,
      items: (t.exercises || []).filter(it => LB.findExercise(store, it.exId))
        .map(it => ({ exId: it.exId, sets: it.sets || 3, reps: it.reps ?? 8, ...(it.repsPerSet ? { repsPerSet: it.repsPerSet } : {}), ...(it.repsMax != null ? { repsMax: it.repsMax } : {}), ...(it.progressionOffset != null ? { progressionOffset: it.progressionOffset } : {}), ...(it.supersetGroup ? { supersetGroup: it.supersetGroup } : {}) })),
    })).filter(t => t.items.length);
    if (tplDays.length) groups.push({ id: '__tpl', name: 'Templates', days: tplDays });
    return groups;
  }, [store.schedules, store.workoutTemplates]);
  // Deep-copy items and give supersets fresh group ids (see DayEditor.copyItemsFromDay).
  const copyImportItems = (items) => {
    const gid = {};
    return normalizeSupersets(items).map(it => {
      const next = { ...it };
      if (it.supersetGroup) { gid[it.supersetGroup] = gid[it.supersetGroup] || LB.uid(); next.supersetGroup = gid[it.supersetGroup]; }
      return next;
    });
  };

  // Keep the card in the VISIBLE viewport so the Name step's input isn't hidden
  // behind the on-screen keyboard (same trick as ExerciseWizard).
  const [vp, setVp] = useStateS(null);
  useEffectS(() => {
    const v = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!v) return;
    const on = () => setVp({ top: v.offsetTop, height: v.height });
    on();
    v.addEventListener('resize', on); v.addEventListener('scroll', on);
    return () => { v.removeEventListener('resize', on); v.removeEventListener('scroll', on); };
  }, []);

  const isDirty = () => !!name.trim() || type !== null || presetKey !== null || weekdaysSel.length > 0 || mesoOn;
  const exit = () => go({ name: 'plan' });
  const stepArgs = { type, presetKey, customCount, weekdayCount: weekdaysSel.length };
  const applicable = computePlanSteps(stepArgs);
  const idx = applicable.indexOf(step);
  const hasPrev = idx > 0;
  // A pick (type / preset) can change which steps exist, so recompute the list
  // with the new value synchronously (state hasn't flushed yet), like the
  // exercise wizard's goNext override.
  const goNext = (o = {}) => {
    const list = computePlanSteps({ ...stepArgs, ...o });
    const i = list.indexOf(step);
    setStep(list[Math.min(i + 1, list.length - 1)]);
  };
  const goBack = () => {
    if (idx > 0) setStep(applicable[idx - 1]);
    else if (isDirty()) setConfirming(true);
    else exit();
  };
  const requestExit = () => { if (isDirty()) setConfirming(true); else exit(); };

  // Weekday guard: a fixed split must map onto EXACTLY its day count, otherwise
  // the rotation doesn't divide evenly (PPL x2 onto 5 days → PUSH PULL LEGS PUSH
  // PULL, i.e. LEGS trained less). Custom (no preset) is unconstrained.
  const weekdayNeed = LB.splitDayCount(presetKey);   // 0 = custom
  const weekdayMismatch = type === 'weekday' && weekdayNeed > 0 && weekdaysSel.length !== weekdayNeed;
  const dayIdx = step.startsWith('day') ? parseInt(step.slice(3), 10) : -1;
  const sortedWeekdays = weekdaysSel.slice().sort((a, b) => a - b);
  const dayLabel = dayIdx < 0 ? null
    : (type === 'weekday' && sortedWeekdays[dayIdx] != null) ? WEEKDAYS[sortedWeekdays[dayIdx]] : `Day ${dayIdx + 1}`;
  const stepTitle = dayIdx >= 0 ? dayLabel : PLAN_TITLES[step];
  const stepIntro = dayIdx >= 0 ? `What's on ${dayLabel}?` : PLAN_INTRO[step];

  // Import the selected source days into this day step and the ones after it,
  // each with its exercises. Cycle/flex grow the plan if the import runs past
  // the end; weekday can't grow (its length is the chosen weekday count), so it
  // fills only the remaining slots. Then jump past the filled days.
  const doImport = () => {
    const chosen = importPlan ? importPlan.days.filter(d => importSel.has(d.key)) : []; // in plan-day order
    if (!chosen.length || dayIdx < 0) return;
    const cap = type === 'weekday' ? Math.max(0, weekdaysSel.length - dayIdx) : chosen.length;
    const use = chosen.slice(0, cap);
    if (!use.length) return;
    setCustomDays(d => { const a = d.slice(); use.forEach((src, k) => { a[dayIdx + k] = { name: src.name, items: copyImportItems(src.items) }; }); return a; });
    const nextIdx = dayIdx + use.length;
    let total;
    if (type === 'weekday') { total = weekdaysSel.length; }
    else { total = Math.max(customCount, nextIdx); if (total !== customCount) setCustomCount(total); }
    setImportOpen(false); setImportSel(new Set());
    setStep(nextIdx < total ? 'day' + nextIdx : 'meso');
  };

  const create = () => {
    const sch = LB.buildPlanSkeleton({
      name, type: type || 'cycle', presetKey, customCount, customDays, weekdays: weekdaysSel,
      mesoWeeks: mesoOn ? mesoWeeks : null,
      mesoStartRir: mesoOn ? mesoStartRir : null,
      mesoEndRir: mesoOn ? mesoEndRir : null,
    });
    setStore(s => ({ ...s, schedules: [...s.schedules, sch] }));
    go({ name: 'schedule-edit', scheduleId: sch.id });
  };
  // Power-user escape: skip the walkthrough and start with an empty cycle plan
  // (identical to the old quick-create), landing straight in the editor.
  const skip = () => {
    const sch = { id: LB.uid(), name: name.trim() || 'My Plan', days: [], archived: false };
    setStore(s => ({ ...s, schedules: [...s.schedules, sch] }));
    go({ name: 'schedule-edit', scheduleId: sch.id });
  };

  // Rich option row: icon chip · label + explainer · (badge and/or check).
  const optRow = ({ key, icon, label, sub, active, badge, onClick }) => (
    <button key={key} onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
      padding: '12px 14px', borderRadius: 6, cursor: 'pointer',
      background: active ? 'rgba(var(--accent-rgb),0.10)' : UI.bgInset,
      border: `1px solid ${active ? 'var(--accent)' : UI.hairStrong}`,
      WebkitTapHighlightColor: 'transparent', transition: 'border-color 0.12s, background 0.12s',
    }}>
      <span style={{
        width: 40, height: 40, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? 'rgba(var(--accent-rgb),0.16)' : UI.bgRaised,
        border: `0.5px solid ${active ? 'rgba(var(--accent-rgb),0.4)' : UI.hair}`,
      }}><i className={`fa-solid ${icon}`} style={{ fontSize: 16, color: active ? 'var(--accent)' : UI.inkFaint }} /></span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--accent)' : UI.ink, fontFamily: UI.fontUi }}>{label}</span>
        {sub && <span className="micro" style={{ color: UI.inkFaint, textTransform: 'none', letterSpacing: '0.02em', fontWeight: 400, lineHeight: 1.35 }}>{sub}</span>}
      </span>
      {badge && <span className="num" style={{ flexShrink: 0, fontSize: 11, padding: '3px 7px', borderRadius: 4, color: active ? 'var(--accent)' : UI.inkSoft, background: active ? 'rgba(var(--accent-rgb),0.12)' : UI.bgRaised, border: `0.5px solid ${active ? 'rgba(var(--accent-rgb),0.35)' : UI.hair}` }}>{badge}</span>}
      {!badge && active && <i className="fa-solid fa-circle-check" style={{ flexShrink: 0, fontSize: 17, color: 'var(--accent)' }} />}
    </button>
  );

  let body;
  if (step === 'name') {
    body = <TextInput value={name} onChange={v => setName(v.toUpperCase())} placeholder="e.g. YEEZUSCREW" autoFocus />;
  } else if (step === 'type') {
    body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[['cycle', 'Cycle', 'fa-repeat', 'A repeating rotation (Day 1, 2, 3...). Advances by date, rest days included.'],
        ['weekday', 'Weekdays', 'fa-calendar-days', 'Fixed days of the week (e.g. Mon/Wed/Fri). Skips the days between.'],
        ['flex', 'Flexible', 'fa-shuffle', 'A rotation that only moves when you actually train or skip, never pushed by the calendar.']]
        .map(([val, label, icon, sub]) => optRow({ key: val, icon, label, sub, active: type === val, onClick: () => { setType(val); goNext({ type: val }); } }))}
    </div>;
  } else if (step === 'split') {
    body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[['full3', 'Full Body', 'fa-user', '3 days', 'Every session trains the whole body. Great for 2 to 4 days a week.'],
        ['ul4', 'Upper / Lower', 'fa-table-columns', '4 days', 'Alternate upper- and lower-body days.'],
        ['ppl3', 'Push / Pull / Legs', 'fa-layer-group', '3 days', 'Push, then pull, then legs. One round per week.'],
        ['ppl6', 'Push / Pull / Legs x2', 'fa-layer-group', '6 days', 'PPL twice through for higher frequency.']]
        .map(([val, label, icon, badge, sub]) => optRow({ key: val, icon, label, sub, badge, active: presetKey === val, onClick: () => { setPresetKey(val); goNext({ presetKey: val }); } }))}
      {optRow({ key: 'custom', icon: 'fa-sliders', label: 'Custom', sub: 'Choose how many days, then set each one up.', active: presetKey === 'custom', onClick: () => { setPresetKey('custom'); if (type === 'weekday') goNext({ presetKey: 'custom' }); } })}
      {presetKey === 'custom' && type !== 'weekday' && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>Days</div>
            <Stepper value={customCount} onChange={setCustomN} step={1} min={1} />
          </div>
          <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, textAlign: 'center', lineHeight: 1.4 }}>{LB.frequencyHint(customCount)}</div>
          {type === 'cycle' && <>
            <div className="knurl" style={{ margin: '4px 0 2px' }} />
            <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, textAlign: 'center', lineHeight: 1.4, fontStyle: 'italic' }}>Tap Next to set each day. Don't forget to include your rest days.</div>
          </>}
        </div>
      )}
    </div>;
  } else if (dayIdx >= 0) {
    // One day-type picker per day of a Custom cycle/flex split (flex has no REST).
    // Offers the standard types, the user's own custom types, and a "+ Custom"
    // name entry that persists to store.customDayTypes (same as DayTypePicker).
    const stdTypes = type === 'flex' ? STANDARD_DAY_TYPES.filter(t => t !== 'REST') : STANDARD_DAY_TYPES;
    const customTypes = store.customDayTypes || [];
    // Pick a day's type, flash a checkmark, then advance, so the day-to-day
    // jump is noticeable. The guard stops a double-tap during the flash from
    // firing two goNext calls (which would skip a day).
    const pickDay = (dt) => {
      if (dayFlash) return;
      setCustomDays(d => { const a = d.slice(); a[dayIdx] = { name: dt, items: [] }; return a; }); // extends for weekday (sized by weekday count, not the stepper)
      setDayFlash(true);
      setTimeout(() => { setDayFlash(false); goNext(); }, 200);
    };
    const createDayType = () => {
      const nm = newDayTypeName.trim().toUpperCase();
      if (!nm) return;
      if (!STANDARD_DAY_TYPES.includes(nm) && !customTypes.includes(nm)) setStore(s => ({ ...s, customDayTypes: [...(s.customDayTypes || []), nm] }));
      pickDay(nm);
    };
    // Two-tap delete (the wizard sits above sheets, so a portaled confirm would
    // hide behind it): first tap arms the ×, second removes. Existing plans keep
    // their day names, only the palette entry is dropped (same as DayTypePicker).
    const removeDayType = (dt) => {
      if (deleteTypeArm !== dt) { setDeleteTypeArm(dt); return; }
      setDeleteTypeArm(null);
      setStore(s => ({ ...s, customDayTypes: (s.customDayTypes || []).filter(t => t !== dt) }));
    };
    const stdChip = (dt) => {
      const on = customDays[dayIdx]?.name === dt;
      return <button key={dt} onClick={() => pickDay(dt)}
        style={{ padding: '13px 6px', borderRadius: 6, cursor: 'pointer', textAlign: 'center', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          background: on ? 'rgba(var(--accent-rgb),0.12)' : UI.bgInset, color: on ? 'var(--accent)' : UI.inkFaint,
          border: `1px solid ${on ? 'var(--accent)' : UI.hairStrong}`, WebkitTapHighlightColor: 'transparent' }}>{dt}</button>;
    };
    const customChip = (dt) => {
      const on = customDays[dayIdx]?.name === dt;
      const armed = deleteTypeArm === dt;
      return <div key={dt} style={{ display: 'flex', alignItems: 'stretch', borderRadius: 6, overflow: 'hidden', border: `1px solid ${armed ? UI.danger : (on ? 'var(--accent)' : UI.goldSoft)}` }}>
        <button onClick={() => pickDay(dt)} style={{ flex: 1, minWidth: 0, padding: '13px 4px', border: 'none', cursor: 'pointer', textAlign: 'center', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          background: on ? 'rgba(var(--accent-rgb),0.12)' : UI.goldFaint, color: on ? 'var(--accent)' : UI.gold, WebkitTapHighlightColor: 'transparent' }}>{dt}</button>
        <button onClick={() => removeDayType(dt)} title={armed ? 'Tap again to remove' : 'Remove'} style={{ flexShrink: 0, background: armed ? 'rgba(var(--danger-rgb),0.15)' : UI.goldFaint, border: 'none', borderLeft: `0.5px solid ${armed ? UI.danger : UI.goldSoft}`, color: armed ? UI.danger : UI.gold, opacity: armed ? 1 : 0.55, padding: '0 9px', cursor: 'pointer', fontSize: 12, WebkitTapHighlightColor: 'transparent' }}>×</button>
      </div>;
    };
    body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {stdTypes.map(stdChip)}
      </div>
      {customTypes.length > 0 && (
        <>
          <div className="knurl" style={{ margin: '2px 0' }} />
          <span className="label" style={{ color: UI.inkFaint }}>Custom days</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {customTypes.map(customChip)}
          </div>
        </>
      )}
      {creatingDayType
        ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10, background: UI.bgInset, border: `1px dashed ${UI.goldSoft}`, borderRadius: 6 }}>
            <input autoFocus value={newDayTypeName} onChange={e => setNewDayTypeName(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && createDayType()} placeholder="e.g. PUSH1"
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', borderBottom: `1px solid ${UI.goldSoft}`, color: UI.gold, padding: '8px 0', fontFamily: UI.fontUi, fontSize: 14, letterSpacing: '0.08em', outline: 'none' }} />
            <Btn kind="ghost" onClick={() => { setCreatingDayType(false); setNewDayTypeName(''); }} style={{ minHeight: 36, padding: '4px 10px', fontSize: 11 }}>×</Btn>
            <Btn onClick={createDayType} disabled={!newDayTypeName.trim()} style={{ minHeight: 36, padding: '4px 12px', fontSize: 11, opacity: newDayTypeName.trim() ? 1 : 0.4 }}>Add</Btn>
          </div>
        : <button onClick={() => setCreatingDayType(true)}
            style={{ padding: '12px 6px', borderRadius: 6, cursor: 'pointer', textAlign: 'center', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
              background: 'transparent', color: UI.inkFaint, border: `1px dashed ${UI.hairStrong}`, WebkitTapHighlightColor: 'transparent' }}>+ Custom day type</button>}
      {!creatingDayType && importGroups.length > 0 && (
        <button onClick={() => { setImportSel(new Set()); setImportPlan(null); setImportOpen(true); }}
          style={{ padding: '12px 6px', borderRadius: 6, cursor: 'pointer', textAlign: 'center', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: UI.bgInset, color: UI.inkSoft, border: `1px solid ${UI.hairStrong}`, WebkitTapHighlightColor: 'transparent' }}>
          <i className="fa-solid fa-file-import" style={{ fontSize: 12 }} /> Import a day from a plan
        </button>
      )}
    </div>;
  } else if (step === 'weekdays') {
    body = <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {WEEKDAYS.map((w, i) => {
          const on = weekdaysSel.includes(i);
          return <button key={w} onClick={() => setWeekdaysSel(on ? weekdaysSel.filter(x => x !== i) : [...weekdaysSel, i])}
            style={{ padding: '12px 6px', borderRadius: 6, cursor: 'pointer', textAlign: 'center', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
              background: on ? 'rgba(var(--accent-rgb),0.12)' : UI.bgInset, color: on ? 'var(--accent)' : UI.inkFaint,
              border: `1px solid ${on ? 'var(--accent)' : UI.hairStrong}`, WebkitTapHighlightColor: 'transparent' }}>{w}</button>;
        })}
      </div>
      {weekdayMismatch
        ? <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: 'rgba(var(--danger-rgb),0.85)', textAlign: 'center', lineHeight: 1.4 }}>
            This split needs exactly {weekdayNeed} training days, so it divides evenly. {weekdaysSel.length < weekdayNeed ? `Pick ${weekdayNeed - weekdaysSel.length} more.` : `Remove ${weekdaysSel.length - weekdayNeed}.`}
          </div>
        : <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, textAlign: 'center', lineHeight: 1.4 }}>
            {presetKey === 'custom' ? "Next you'll set each day's type." : 'Your split fills the days you pick, in order.'}
          </div>}
    </div>;
  } else if (step === 'meso') {
    body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {optRow({ key: 'standard', icon: 'fa-infinity', label: 'Standard plan', sub: 'Open-ended. Train it as long as you like.', active: !mesoOn, onClick: () => setMesoOn(false) })}
      {optRow({ key: 'meso', icon: 'fa-chart-line', label: 'Mesocycle', sub: 'A fixed block with an intensity ramp and a deload at the end.', active: mesoOn, onClick: () => setMesoOn(true) })}
      {mesoOn && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>Weeks</div>
            <Stepper value={mesoWeeks} onChange={v => setMesoWeeks(Math.min(8, Math.max(4, Math.round(v))))} step={1} min={4} />
          </div>
          <div className="knurl" style={{ margin: '2px 0' }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>Start RIR</div>
              <Stepper value={mesoStartRir} onChange={v => setMesoStartRir(Math.min(3, Math.max(0, Math.round(v))))} step={1} min={0} />
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>End RIR</div>
              <Stepper value={mesoEndRir} onChange={v => setMesoEndRir(Math.min(0, Math.max(-3, Math.round(v))))} step={1} min={-3} />
            </div>
          </div>
          <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 2, textAlign: 'center', lineHeight: 1.5 }}>{LB.mesoTaperPreview(mesoWeeks, mesoStartRir, mesoEndRir)}</div>
        </div>
      )}
    </div>;
  }

  const isFinal = step === 'meso';
  // Day-type steps auto-advance on pick, so no Next there.
  const needsNext = step === 'name' || step === 'weekdays' || (step === 'split' && presetKey === 'custom' && type !== 'weekday');
  const canNext = step === 'name' ? !!name.trim() : step === 'weekdays' ? (weekdaysSel.length > 0 && !weekdayMismatch) : true;

  // Wizard-native day-import view (the editor's DayCopyPicker is a z-100 Sheet
  // that would render behind this z-9998 overlay, so it can't be reused). Two
  // steps: pick a plan, then pick day(s) from it (so many plans stay readable).
  const importHeader = (title) => <div style={{ fontFamily: UI.fontDisplay, fontSize: 23, color: 'var(--accent)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.1 }}>{title}</div>;
  const importSub = (txt) => <div style={{ fontSize: 12.5, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>{txt}</div>;
  const importTextBtn = (label, onClick) => <button onClick={onClick} style={{ background: 'transparent', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, cursor: 'pointer', padding: '8px 4px', WebkitTapHighlightColor: 'transparent' }}>{label}</button>;
  const importView = importPlan ? (
    <>
      {importHeader(importPlan.name)}
      {importSub('Pick day(s) to import, their exercises come along. Several fill the next steps in order.')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {importPlan.days.map(d => {
          const sel = importSel.has(d.key);
          return <button key={d.key} onClick={() => setImportSel(s => { const n = new Set(s); if (n.has(d.key)) n.delete(d.key); else n.add(d.key); return n; })}
            style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '11px 12px', borderRadius: 6, cursor: 'pointer',
              background: sel ? 'rgba(var(--accent-rgb),0.10)' : UI.bgInset, border: `1px solid ${sel ? 'var(--accent)' : UI.hairStrong}`, WebkitTapHighlightColor: 'transparent' }}>
            <i className={`fa-solid ${sel ? 'fa-circle-check' : 'fa-circle'}`} style={{ fontSize: 16, color: sel ? 'var(--accent)' : UI.inkFaint, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, color: sel ? 'var(--accent)' : UI.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
              <span className="micro" style={{ color: UI.inkFaint }}>{d.items.length} exercise{d.items.length !== 1 ? 's' : ''}</span>
            </span>
          </button>;
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {importTextBtn('← Plans', () => { setImportPlan(null); setImportSel(new Set()); })}
        <div style={{ flex: 1 }} />
        <Btn onClick={doImport} disabled={importSel.size === 0} style={{ opacity: importSel.size ? 1 : 0.4 }}>{importSel.size ? `Import ${importSel.size} day${importSel.size !== 1 ? 's' : ''} →` : 'Import →'}</Btn>
      </div>
    </>
  ) : (
    <>
      {importHeader('Import days')}
      {importSub('Choose a plan to import a day from.')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {importGroups.map(g => (
          <button key={g.id} onClick={() => { setImportPlan(g); setImportSel(new Set()); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '12px 12px', borderRadius: 6, cursor: 'pointer', background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, WebkitTapHighlightColor: 'transparent' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, color: UI.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
              <span className="micro" style={{ color: UI.inkFaint }}>{g.days.length} day{g.days.length !== 1 ? 's' : ''}</span>
            </span>
            <i className="fa-solid fa-chevron-right" style={{ fontSize: 12, color: UI.inkFaint, flexShrink: 0 }} />
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {importTextBtn('← Cancel', () => { setImportOpen(false); setImportSel(new Set()); })}
      </div>
    </>
  );
  const overlayBase = { zIndex: 9998, background: 'rgba(0,0,0,0.74)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 };
  const overlayStyle = vp ? { ...overlayBase, position: 'fixed', left: 0, right: 0, top: vp.top, height: vp.height } : { ...overlayBase, position: 'fixed', inset: 0 };
  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) requestExit(); }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 360, maxHeight: '86vh', overflowY: 'auto', background: UI.bgRaised, border: `1px solid ${UI.hairStrong}`, borderRadius: 8, padding: '20px 20px 22px', display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 32px 80px rgba(0,0,0,0.6)', animation: 'fadeUp 0.3s ease' }}>
        {confirming ? (
          <>
            <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 700, textTransform: 'uppercase' }}>Discard plan?</div>
            <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>Your new plan won't be created.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => setConfirming(false)} style={{ flex: 1 }}>Keep editing</Btn>
              <Btn onClick={exit} style={{ flex: 1, background: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.6)' }}>Discard</Btn>
            </div>
          </>
        ) : importOpen ? importView : (
          <>
            {/* Segmented progress */}
            <div style={{ display: 'flex', gap: 4 }}>
              {applicable.map((s, i) => (
                <div key={s} style={{ flex: 1, height: 4, borderRadius: 999, background: i <= idx ? 'var(--accent)' : UI.hairStrong, opacity: i <= idx ? 1 : 0.5, transition: 'background 0.2s, opacity 0.2s' }} />
              ))}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontFamily: UI.fontDisplay, fontSize: 23, color: 'var(--accent)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.1 }}>{stepTitle}</div>
                <span className="micro" style={{ color: UI.inkGhost, flexShrink: 0 }}>{idx + 1}/{applicable.length}</span>
              </div>
              <div style={{ fontSize: 12.5, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, marginTop: 7 }}>{stepIntro}</div>
            </div>
            {body}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={goBack} style={{ background: 'transparent', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, cursor: 'pointer', padding: '8px 4px', WebkitTapHighlightColor: 'transparent' }}>{hasPrev ? '← Back' : 'Cancel'}</button>
              <div style={{ flex: 1 }} />
              {(step === 'name' || step === 'type') && <button onClick={skip} style={{ background: 'transparent', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, cursor: 'pointer', padding: '8px 10px', WebkitTapHighlightColor: 'transparent' }}>Skip setup</button>}
              {isFinal
                ? <Btn onClick={create}>Create plan →</Btn>
                : (needsNext && <Btn onClick={() => goNext()} disabled={!canNext} style={{ opacity: canNext ? 1 : 0.4 }}>Next</Btn>)}
            </div>
          </>
        )}
        {dayFlash && (
          <div style={{ position: 'absolute', inset: 0, borderRadius: 8, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ width: 88, height: 88, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
              <i className="fa-solid fa-check" style={{ fontSize: 40, color: '#0a0805' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Create new schedule (hosts the guided plan wizard) ──────────────
function ScheduleNewScreen({ store, setStore, go, userId }) {
  return <PlanWizard store={store} setStore={setStore} go={go} />;
}

Object.assign(window.Screens, { PlanScreen, PlanViewerScreen, ScheduleEditScreen, ScheduleNewScreen, ExercisePicker, DayTypePicker });
