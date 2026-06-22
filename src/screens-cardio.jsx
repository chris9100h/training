/* Cardio plans — list, create/edit, home widget */

const { useState: useStateCard, useEffect: useEffectCard, useMemo: useMemoCard } = React;

const CARDIO_ACTIVITIES = [
  { id: 'running',    label: 'Running',    icon: 'fa-person-running' },
  { id: 'walking',    label: 'Walking',    icon: 'fa-person-walking' },
  { id: 'cycling',    label: 'Cycling',    icon: 'fa-person-biking' },
  { id: 'swimming',   label: 'Swimming',   icon: 'fa-person-swimming' },
  { id: 'rowing',     label: 'Rowing',     icon: 'fa-water' },
  { id: 'elliptical', label: 'Elliptical', icon: 'fa-rotate' },
  { id: 'hiking',     label: 'Hiking',     icon: 'fa-mountain-sun' },
];

const CP_WEEKDAY_KEYS   = ['mon','tue','wed','thu','fri','sat','sun'];
const CP_WEEKDAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const CP_DIST_KEY       = 'logbook-cardio-dist-unit';

function cpActivity(type) {
  return CARDIO_ACTIVITIES.find(a => a.id === type) || { id: type, label: type, icon: 'fa-person-running' };
}

function cpDistUnit() {
  try { return localStorage.getItem(CP_DIST_KEY) || 'km'; } catch (_) { return 'km'; }
}

function cpDistToM(val, du) {
  const n = parseFloat(val);
  if (!n || isNaN(n)) return null;
  return du === 'mi' ? Math.round(n * 1609.344) : Math.round(n * 1000);
}

function cpFmtDist(m, du) {
  if (m == null) return '';
  return du === 'mi'
    ? (m / 1609.344).toFixed(2) + ' mi'
    : (m / 1000).toFixed(1) + ' km';
}

function cpFmtPace(secPerKm, du) {
  if (secPerKm == null) return '';
  const perUnit = du === 'mi' ? secPerKm * 1609.344 / 1000 : secPerKm;
  const mins = Math.floor(perUnit / 60);
  const secs = Math.round(perUnit % 60);
  return `${mins}:${String(secs).padStart(2,'0')}/${du}`;
}

function cpTodayKey(todayISO) {
  const d = new Date(todayISO + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun
  return CP_WEEKDAY_KEYS[dow === 0 ? 6 : dow - 1];
}

function cpWeeksUntil(goalDueDate, planStartDate) {
  const s = new Date(planStartDate + 'T12:00:00');
  const e = new Date(goalDueDate  + 'T12:00:00');
  return Math.max(2, Math.ceil((e - s) / (7 * 86400000)));
}

// Returns per-session targets (one entry per training day from start to due date)
function cpGenerateWeeks(goal, startFitness, goalDueDate, planStartDate, planDays) {
  if (!goal || !planDays) return [];
  const start = new Date(planStartDate + 'T12:00:00');
  const end   = new Date(goalDueDate   + 'T12:00:00');
  if (end <= start) return [];

  // Enumerate all training session dates
  const sessDates = [];
  const iter = new Date(start);
  while (iter <= end) {
    const dow = iter.getDay();
    const dk  = CP_WEEKDAY_KEYS[dow === 0 ? 6 : dow - 1];
    if (planDays[dk]) sessDates.push(new Date(iter));
    iter.setDate(iter.getDate() + 1);
  }
  if (!sessDates.length) return [];
  const total = sessDates.length;

  // Pre-compute deload flags (every 4th calendar week, but never the last 2 sessions)
  const deloadFlags = sessDates.map((d, si) => {
    const weekOfPlan = Math.floor((d - start) / (7 * 86400000));
    return (weekOfPlan + 1) % 4 === 0 && si < total - 2;
  });
  // nActive = sessions where cur advances; rate uses nActive-1 steps so
  // first session = startValue and last non-deload session = targetValue
  const nActive = deloadFlags.filter(x => !x).length;

  // Cap per-session rate to ≤10% per week equivalent
  const daysActive = CP_WEEKDAY_KEYS.filter(k => planDays[k]).length;
  const maxSessRate = Math.pow(1.10, 1 / Math.max(1, daysActive));

  if (goal.type === 'duration') {
    if (!goal.target_duration_minutes) return [];
    const startDur  = Math.max(5, startFitness.duration_minutes || 10);
    const targetDur = goal.target_duration_minutes;
    const rate      = Math.min(Math.pow(targetDur / startDur, 1 / Math.max(1, nActive - 1)), maxSessRate);
    let cur = startDur;
    return sessDates.map((d, si) => {
      const isDeload = deloadFlags[si];
      const val = Math.round(isDeload ? cur * 0.88 : cur);
      if (!isDeload) cur = Math.min(targetDur, cur * rate);
      return { distance_m: null, duration_minutes: val, pace_s_per_km: null };
    });
  }

  if (!goal.target_distance_m) return [];
  const startDist  = Math.max(100, startFitness.distance_m || 500);
  const targetDist = goal.target_distance_m;
  const rate       = Math.min(Math.pow(targetDist / startDist, 1 / Math.max(1, nActive - 1)), maxSessRate);
  let cur = startDist;
  return sessDates.map((d, si) => {
    const isDeload = deloadFlags[si];
    const distM = Math.round(isDeload ? cur * 0.88 : cur);
    let pace = null;
    if (goal.type === 'pace' && startFitness.pace_s_per_km && goal.target_duration_minutes) {
      const tgtPace = (goal.target_duration_minutes * 60) / (targetDist / 1000);
      const t = nActive <= 1 ? 1 : (deloadFlags.slice(0, si).filter(x => !x).length) / (nActive - 1);
      pace = Math.max(tgtPace, Math.round(startFitness.pace_s_per_km + t * (tgtPace - startFitness.pace_s_per_km)));
    }
    if (!isDeload) cur = Math.min(targetDist, cur * rate);
    return { distance_m: distM, duration_minutes: null, pace_s_per_km: pace };
  });
}

// How many training sessions have happened since plan start (up to but not including today)
function cpSessionIndex(planStartDate, planDays, todayISO) {
  if (!planStartDate || !planDays) return 0;
  const start = new Date(planStartDate + 'T12:00:00');
  const today = new Date(todayISO     + 'T12:00:00');
  let count = 0;
  const iter = new Date(start);
  while (iter < today) {
    const dow = iter.getDay();
    const dk  = CP_WEEKDAY_KEYS[dow === 0 ? 6 : dow - 1];
    if (planDays[dk]) count++;
    iter.setDate(iter.getDate() + 1);
  }
  return count;
}

function cpTodayTarget(plan, todayISO) {
  if (plan.planStartDate && todayISO < plan.planStartDate) return null;
  const wk = cpTodayKey(todayISO);
  if (!plan.days[wk]) return null;
  if (plan.mode === 'manual') {
    const t = plan.manualTargets?.[wk];
    if (!t || (!t.distance_m && !t.duration_minutes)) {
      return { distanceM: null, durationMinutes: null, paceSecPerKm: null, freeSession: true };
    }
    return { distanceM: t.distance_m ?? null, durationMinutes: t.duration_minutes ?? null, paceSecPerKm: null };
  }
  if (plan.mode === 'goal') {
    const ws = plan.generatedWeeks || [];
    if (!ws.length) return null;
    const idx = Math.min(cpSessionIndex(plan.planStartDate, plan.days, todayISO), ws.length - 1);
    const w = ws[idx];
    return { distanceM: w.distance_m ?? null, durationMinutes: w.duration_minutes ?? null, paceSecPerKm: w.pace_s_per_km ?? null };
  }
  return null;
}

function cpTodayLog(plan, cardioLogs, todayISO) {
  return (cardioLogs || []).find(l => l.date === todayISO && l.type === plan.activityType) || null;
}

// ─── CardioPlanDetailSheet ─────────────────────────────────────────────────
function CardioPlanDetailSheet({ plan, store, todayISO, distUnit, onClose, onEdit, onArchive, onUnarchive, onDelete }) {
  const [confirmEl, confirm] = useConfirm();
  const act        = cpActivity(plan.activityType);
  const target     = cpTodayTarget(plan, todayISO);
  const doneLog    = target ? cpTodayLog(plan, store.cardioLogs, todayISO) : null;
  const daysActive = CP_WEEKDAY_KEYS.filter(k => plan.days[k]);

  let weekNum = null, totalWeeks = null;
  if (plan.mode === 'goal' && plan.generatedWeeks?.length) {
    weekNum    = Math.min(cpSessionIndex(plan.planStartDate, plan.days, todayISO) + 1, plan.generatedWeeks.length);
    totalWeeks = plan.generatedWeeks.length;
  }

  return (
    <Sheet open={true} onClose={onClose} title={plan.name}>
      {confirmEl}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ padding: '7px 14px', background: 'rgba(var(--accent-rgb),0.08)', border: '0.5px solid rgba(var(--accent-rgb),0.25)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className={`fa-solid ${act.icon}`} style={{ fontSize: 13, color: 'var(--accent)' }} />
            <span style={{ fontSize: 12, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 600 }}>{act.label}</span>
          </div>
          <div style={{ padding: '7px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6 }}>
            <span className="micro" style={{ color: UI.inkFaint }}>{plan.mode === 'goal' ? 'GOAL PLAN' : 'MANUAL PLAN'}</span>
          </div>
          {plan.archived && (
            <div style={{ padding: '7px 14px', background: 'rgba(255,100,50,0.08)', border: '0.5px solid rgba(255,100,50,0.25)', borderRadius: 6 }}>
              <span className="micro" style={{ color: UI.danger }}>ARCHIVED</span>
            </div>
          )}
        </div>

        {/* Days row */}
        <div>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>TRAINING DAYS</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {CP_WEEKDAY_KEYS.map((k, i) => (
              <div key={k} style={{
                flex: 1, paddingTop: '6px', paddingBottom: '6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 4, border: `0.5px solid ${plan.days[k] ? 'rgba(var(--accent-rgb),0.5)' : UI.hair}`,
                background: plan.days[k] ? 'rgba(var(--accent-rgb),0.1)' : UI.bgInset,
              }}>
                <span style={{ fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.06em', color: plan.days[k] ? 'var(--accent)' : UI.inkGhost }}>
                  {CP_WEEKDAY_LABELS[i].slice(0,2).toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Today's target */}
        {target && !target.freeSession && (
          <div style={{ padding: '12px 14px', background: doneLog ? 'rgba(123,196,123,0.06)' : 'rgba(var(--accent-rgb),0.05)', border: `0.5px solid ${doneLog ? 'rgba(123,196,123,0.3)' : 'rgba(var(--accent-rgb),0.2)'}`, borderRadius: 6 }}>
            <div className="micro" style={{ color: doneLog ? UI.ok : 'var(--accent)', marginBottom: 4 }}>{doneLog ? '✓ TODAY DONE' : "TODAY'S TARGET"}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              {target.distanceM   != null && <span className="num" style={{ fontSize: 18, color: UI.ink }}>{cpFmtDist(target.distanceM, distUnit)}</span>}
              {target.durationMinutes != null && <span className="num" style={{ fontSize: 18, color: UI.ink }}>{target.durationMinutes} min</span>}
              {target.paceSecPerKm != null && <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>@ {cpFmtPace(target.paceSecPerKm, distUnit)}</span>}
            </div>
            {doneLog && (
              <div style={{ marginTop: 4, fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>
                {doneLog.durationMinutes} min logged{doneLog.distanceM ? ` · ${cpFmtDist(doneLog.distanceM, distUnit)}` : ''}
              </div>
            )}
          </div>
        )}
        {target?.freeSession && (
          <div style={{ padding: '12px 14px', background: doneLog ? 'rgba(123,196,123,0.06)' : 'rgba(var(--accent-rgb),0.05)', border: `0.5px solid ${doneLog ? 'rgba(123,196,123,0.3)' : 'rgba(var(--accent-rgb),0.2)'}`, borderRadius: 6 }}>
            <div className="micro" style={{ color: doneLog ? UI.ok : 'var(--accent)', marginBottom: 4 }}>{doneLog ? '✓ TODAY DONE' : 'SCHEDULED TODAY'}</div>
            {doneLog ? (
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>
                {doneLog.durationMinutes} min logged{doneLog.distanceM ? ` · ${cpFmtDist(doneLog.distanceM, distUnit)}` : ''}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>Free session — no specific target</div>
            )}
          </div>
        )}

        {/* Goal summary */}
        {plan.mode === 'goal' && plan.goal && (
          <div>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>GOAL</div>
            <div style={{ padding: '10px 14px', background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hair}` }}>
              <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>
                {plan.goal.type === 'duration'
                  ? `${plan.goal.target_duration_minutes} min`
                  : cpFmtDist(plan.goal.target_distance_m, distUnit) + (plan.goal.type === 'pace' && plan.goal.target_duration_minutes ? ` in ${plan.goal.target_duration_minutes} min` : '')
                }
              </div>
              {plan.goalDueDate && (
                <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 3 }}>
                  Due {plan.goalDueDate}
                  {weekNum != null ? ` · Session ${weekNum}/${totalWeeks}` : ''}
                </div>
              )}
              {plan.goal.type === 'pace' && plan.goal.target_duration_minutes && plan.goal.target_distance_m && (
                <div className="num" style={{ fontSize: 11, color: UI.inkFaint, marginTop: 2 }}>
                  Target pace: {cpFmtPace((plan.goal.target_duration_minutes * 60) / (plan.goal.target_distance_m / 1000), distUnit)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Manual daily targets */}
        {plan.mode === 'manual' && daysActive.length > 0 && (
          <div>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>DAILY TARGETS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {CP_WEEKDAY_KEYS.filter(k => plan.days[k]).map(k => {
                const t = plan.manualTargets?.[k];
                if (!t) return null;
                return (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: UI.bgInset, borderRadius: 4, border: `0.5px solid ${UI.hair}` }}>
                    <span style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>{CP_WEEKDAY_LABELS[CP_WEEKDAY_KEYS.indexOf(k)]}</span>
                    <span className="num" style={{ fontSize: 13, color: UI.ink }}>
                      {t.distance_m ? cpFmtDist(t.distance_m, distUnit) : `${t.duration_minutes} min`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <Btn kind="ghost" onClick={onEdit} style={{ flex: 1 }}>Edit</Btn>
          {plan.archived
            ? <Btn kind="ghost" onClick={onUnarchive} style={{ flex: 1 }}>Restore</Btn>
            : <Btn kind="ghost" onClick={onArchive} style={{ flex: 1 }}>Archive</Btn>
          }
        </div>
        <button onClick={async () => {
          if (!await confirm('Delete this cardio plan?', { ok: 'Delete', danger: true })) return;
          onDelete();
        }} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
          fontFamily: UI.fontUi, fontSize: 11, color: UI.danger, letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>Delete plan</button>
      </div>
    </Sheet>
  );
}

// ─── CardioPlanCreateSheet ──────────────────────────────────────────────────
function CardioPlanCreateSheet({ open, onClose, store, setStore, editPlan }) {
  const [step,          setStep]          = useStateCard(0);
  const [activityType,  setActivityType]  = useStateCard('');
  const [mode,          setMode]          = useStateCard('');
  const [days,          setDays]          = useStateCard({});
  const [manualTargets, setManualTargets] = useStateCard({});
  const [goal,          setGoal]          = useStateCard({ type: 'distance', dist: '', dur: '' });
  const [goalDue,       setGoalDue]       = useStateCard('');
  const [fitness,       setFitness]       = useStateCard({ dist: '', dur: '' });
  const [planName,      setPlanName]      = useStateCard('');
  const [preview,       setPreview]       = useStateCard(null);
  const [showCustom,    setShowCustom]    = useStateCard(false);
  const [useTargets,    setUseTargets]    = useStateCard(true);

  const du = cpDistUnit();

  useEffectCard(() => {
    if (!open) return;
    if (editPlan) {
      setActivityType(editPlan.activityType);
      setMode(editPlan.mode);
      setDays(editPlan.days || {});
      setManualTargets(editPlan.manualTargets || {});
      const g = editPlan.goal;
      setGoal({
        type: g?.type || 'distance',
        dist: g?.target_distance_m ? (du === 'mi' ? (g.target_distance_m / 1609.344).toFixed(2) : (g.target_distance_m / 1000).toFixed(1)) : '',
        dur:  g?.target_duration_minutes ? String(g.target_duration_minutes) : '',
      });
      setGoalDue(editPlan.goalDueDate || '');
      const sf = editPlan.startFitness;
      setFitness({
        dist: sf?.distance_m ? (du === 'mi' ? (sf.distance_m / 1609.344).toFixed(2) : (sf.distance_m / 1000).toFixed(1)) : '',
        dur:  sf?.duration_minutes ? String(sf.duration_minutes) : '',
      });
      setPlanName(editPlan.name);
      setPreview(null);
      setShowCustom(false);
      setUseTargets(editPlan.mode !== 'manual' || Object.keys(editPlan.manualTargets || {}).length > 0);
      setStep(1);
    } else {
      setActivityType(''); setMode(''); setDays({}); setManualTargets({});
      setGoal({ type: 'distance', dist: '', dur: '' });
      setGoalDue(''); setFitness({ dist: '', dur: '' }); setPlanName(''); setPreview(null);
      setShowCustom(false); setUseTargets(true);
      setStep(0);
    }
  }, [open]);

  useEffectCard(() => {
    if (activityType && !planName) setPlanName(cpActivity(activityType).label + ' Plan');
  }, [activityType]);

  const goalDistM   = goal.type === 'duration' ? null : cpDistToM(goal.dist, du);
  const goalDurMin  = parseInt(goal.dur) || null;
  const fitDistM    = cpDistToM(fitness.dist, du);
  const fitDurMin   = parseInt(fitness.dur) || null;
  const fitPaceSec  = (fitDistM && fitDurMin) ? Math.round((fitDurMin * 60) / (fitDistM / 1000)) : null;

  const customTypes = useMemoCard(() => {
    const known = new Set(CARDIO_ACTIVITIES.map(a => a.id));
    const seen = [], seenSet = new Set();
    for (const log of (store.cardioLogs || [])) {
      const t = log.type;
      if (t && !known.has(t) && !seenSet.has(t)) { seen.push(t); seenSet.add(t); }
    }
    return seen;
  }, [store.cardioLogs]);

  const totalSteps = mode === 'goal' ? 5 : (useTargets ? 4 : 3);

  const canNext = () => {
    if (step === 0) return !!activityType;
    if (step === 1) return !!mode;
    if (mode === 'manual') {
      if (step === 2) return CP_WEEKDAY_KEYS.some(k => days[k]);
      if (step === 3) return CP_WEEKDAY_KEYS.filter(k => days[k]).every(k => {
        const t = manualTargets[k];
        return t && (t.distance_m || t.duration_minutes);
      });
      if (step === 4) return !!planName.trim();
    }
    if (mode === 'goal') {
      if (step === 2) return !!(goalDue && CP_WEEKDAY_KEYS.some(k => days[k]) && (goal.type === 'duration' ? goalDurMin : goalDistM));
      if (step === 3) return goal.type === 'duration' ? !!fitDurMin : !!fitDistM;
      if (step === 4) return true;
      if (step === 5) return !!planName.trim();
    }
    return true;
  };

  const isLast = mode === 'manual' ? step === 4 : step === 5;

  const buildPreview = () => {
    const todayISO = LB.todayISO();
    const gObj = { type: goal.type, target_distance_m: goalDistM, target_duration_minutes: goalDurMin };
    const sfObj = {
      distance_m: fitDistM || Math.round((goalDistM || 5000) * 0.3),
      duration_minutes: fitDurMin || Math.round((goalDurMin || 30) * 0.3),
      pace_s_per_km: fitPaceSec,
    };
    const ws = cpGenerateWeeks(gObj, sfObj, goalDue, todayISO, days);
    const warnings = [];
    const daysActive = CP_WEEKDAY_KEYS.filter(k => days[k]).length;
    const maxSessRate = Math.pow(1.10, 1 / Math.max(1, daysActive));
    if (goal.type !== 'duration' && ws.length && goalDistM && sfObj.distance_m) {
      const raw = Math.pow(goalDistM / sfObj.distance_m, 1 / ws.length);
      if (raw > maxSessRate) warnings.push(`Maximum progression applied — you may not fully reach ${cpFmtDist(goalDistM, du)} by the due date. Consider extending the timeline.`);
    }
    if (goal.type === 'duration' && ws.length && goalDurMin && sfObj.duration_minutes) {
      const raw = Math.pow(goalDurMin / sfObj.duration_minutes, 1 / ws.length);
      if (raw > maxSessRate) warnings.push(`Maximum progression applied — you may not reach ${goalDurMin} min by the due date. Consider extending the timeline.`);
    }
    setPreview({ weeks: ws, warnings });
  };

  const next = () => {
    if (mode === 'goal' && step === 3) buildPreview();
    if (mode === 'manual' && step === 2 && !useTargets) { setStep(4); return; }
    setStep(s => s + 1);
  };

  const back = () => {
    if (mode === 'manual' && step === 4 && !useTargets) { setStep(2); return; }
    setStep(s => s - 1);
  };

  const save = () => {
    const todayISO = LB.todayISO();
    let genWeeks = editPlan?.generatedWeeks || [];
    let startFit = editPlan?.startFitness || null;
    let startDate = editPlan?.planStartDate || null;

    if (mode === 'goal') {
      const gObj  = { type: goal.type, target_distance_m: goalDistM, target_duration_minutes: goalDurMin };
      const sfObj = {
        distance_m: fitDistM || Math.round((goalDistM || 5000) * 0.3),
        duration_minutes: fitDurMin || Math.round((goalDurMin || 30) * 0.3),
        pace_s_per_km: fitPaceSec,
      };
      genWeeks  = cpGenerateWeeks(gObj, sfObj, goalDue, todayISO, days);
      startFit  = { distance_m: fitDistM, duration_minutes: fitDurMin, pace_s_per_km: fitPaceSec };
      startDate = editPlan?.planStartDate || todayISO;
    }

    const cleanTargets = {};
    if (mode === 'manual') {
      CP_WEEKDAY_KEYS.forEach(k => { if (days[k] && manualTargets[k]) cleanTargets[k] = manualTargets[k]; });
    }

    const plan = {
      id:             editPlan?.id || LB.uid(),
      name:           planName.trim(),
      activityType,
      archived:       editPlan?.archived ?? false,
      mode,
      days,
      manualTargets:  mode === 'manual' ? cleanTargets : {},
      goal:           mode === 'goal' ? { type: goal.type, target_distance_m: goalDistM, target_duration_minutes: goalDurMin } : null,
      goalDueDate:    mode === 'goal' ? goalDue : null,
      startFitness:   startFit,
      generatedWeeks: genWeeks,
      planStartDate:  startDate,
      createdAt:      editPlan?.createdAt || new Date().toISOString(),
    };

    if (editPlan) {
      setStore(s => ({ ...s, cardioPlans: (s.cardioPlans || []).map(p => p.id === editPlan.id ? plan : p) }));
    } else {
      setStore(s => ({ ...s, cardioPlans: [plan, ...(s.cardioPlans || [])] }));
    }
    onClose();
  };

  const stepTitles = ['Choose activity', 'Plan type',
    ...(mode === 'goal' ? ['Set your goal', 'Current fitness', 'Plan preview', 'Name your plan']
                        : ['Training days',  'Daily targets',  'Name your plan'])];
  const sheetTitle = editPlan ? 'Edit plan' : (stepTitles[step] || 'New cardio plan');

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
    background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4,
    fontFamily: UI.fontUi, fontSize: 15, color: UI.ink, outline: 'none',
  };

  const renderStep = () => {
    /* Step 0 — activity */
    if (step === 0) {
      const isCustomSel = !!activityType && !CARDIO_ACTIVITIES.find(a => a.id === activityType);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {CARDIO_ACTIVITIES.map(a => (
              <button key={a.id} onClick={() => { setActivityType(a.id); setShowCustom(false); }} style={{
                padding: '14px 10px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${activityType === a.id ? 'var(--accent)' : UI.hairStrong}`,
                background: activityType === a.id ? 'rgba(var(--accent-rgb),0.1)' : UI.bgInset,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                WebkitTapHighlightColor: 'transparent',
              }}>
                <i className={`fa-solid ${a.icon}`} style={{ fontSize: 22, color: activityType === a.id ? 'var(--accent)' : UI.inkSoft }} />
                <span style={{ fontSize: 10, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.08em', color: activityType === a.id ? 'var(--accent)' : UI.inkSoft }}>{a.label.toUpperCase()}</span>
              </button>
            ))}
            <button onClick={() => setShowCustom(v => !v)} style={{
              padding: '14px 10px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${(showCustom || isCustomSel) ? 'var(--accent)' : UI.hairStrong}`,
              background: (showCustom || isCustomSel) ? 'rgba(var(--accent-rgb),0.1)' : UI.bgInset,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              WebkitTapHighlightColor: 'transparent',
            }}>
              <i className="fa-solid fa-ellipsis" style={{ fontSize: 22, color: (showCustom || isCustomSel) ? 'var(--accent)' : UI.inkSoft }} />
              <span style={{ fontSize: 10, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.08em', color: (showCustom || isCustomSel) ? 'var(--accent)' : UI.inkSoft }}>
                {isCustomSel ? activityType.toUpperCase() : 'CUSTOM'}
              </span>
            </button>
          </div>
          {showCustom && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
              {customTypes.length === 0 ? (
                <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '10px 0' }}>
                  No custom types in your cardio history yet.
                </div>
              ) : (
                customTypes.map(t => (
                  <button key={t} onClick={() => { setActivityType(t); setShowCustom(false); }} style={{
                    padding: '10px 14px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                    border: `1px solid ${activityType === t ? 'var(--accent)' : UI.hairStrong}`,
                    background: activityType === t ? 'rgba(var(--accent-rgb),0.1)' : UI.bgInset,
                    fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
                    color: activityType === t ? 'var(--accent)' : UI.ink,
                    WebkitTapHighlightColor: 'transparent',
                  }}>{t}</button>
                ))
              )}
            </div>
          )}
        </div>
      );
    }

    /* Step 1 — mode */
    if (step === 1) return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          { id: 'manual', icon: 'fa-calendar-days', label: 'Manual plan',
            sub: 'Fixed weekly targets per day — you choose the distance or duration for each session.' },
          { id: 'goal',   icon: 'fa-bullseye',      label: 'Goal plan',
            sub: 'Set a target and a due date. The app builds a progressive plan to get you there.' },
        ].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} style={{
            padding: '14px 16px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
            border: `1px solid ${mode === m.id ? 'var(--accent)' : UI.hairStrong}`,
            background: mode === m.id ? 'rgba(var(--accent-rgb),0.08)' : UI.bgInset,
            display: 'flex', gap: 14, alignItems: 'flex-start',
            WebkitTapHighlightColor: 'transparent',
          }}>
            <i className={`fa-solid ${m.icon}`} style={{ fontSize: 20, color: mode === m.id ? 'var(--accent)' : UI.inkFaint, marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: mode === m.id ? 'var(--accent)' : UI.ink, fontFamily: UI.fontUi, marginBottom: 5 }}>{m.label}</div>
              <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>{m.sub}</div>
            </div>
          </button>
        ))}
      </div>
    );

    /* Manual step 2 — days */
    if (mode === 'manual' && step === 2) {
      const allSel = CP_WEEKDAY_KEYS.every(k => days[k]);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="micro" style={{ color: UI.inkFaint }}>WHICH DAYS?</div>
            <button onClick={() => {
              if (allSel) { setDays({}); setManualTargets({}); }
              else setDays(Object.fromEntries(CP_WEEKDAY_KEYS.map(k => [k, true])));
            }} style={{
              background: 'none', border: `0.5px solid ${allSel ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`,
              borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
              fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              color: allSel ? 'var(--accent)' : UI.inkFaint, WebkitTapHighlightColor: 'transparent',
            }}>ALL</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {CP_WEEKDAY_KEYS.map((k, i) => (
              <button key={k} onClick={() => {
                const next = { ...days, [k]: !days[k] };
                setDays(next);
                if (!next[k]) { const mt = { ...manualTargets }; delete mt[k]; setManualTargets(mt); }
              }} style={{
                flex: 1, paddingTop: 10, paddingBottom: 10, borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${days[k] ? 'var(--accent)' : UI.hairStrong}`,
                background: days[k] ? 'rgba(var(--accent-rgb),0.12)' : UI.bgInset,
                fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                color: days[k] ? 'var(--accent)' : UI.inkSoft,
                WebkitTapHighlightColor: 'transparent',
              }}>{CP_WEEKDAY_LABELS[i].slice(0,2).toUpperCase()}</button>
            ))}
          </div>
          <button onClick={() => setUseTargets(v => !v)} style={{
            padding: '12px 14px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
            border: `1px solid ${useTargets ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`,
            background: useTargets ? 'rgba(var(--accent-rgb),0.07)' : UI.bgInset,
            display: 'flex', alignItems: 'center', gap: 12,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <div style={{
              width: 18, height: 18, borderRadius: 4, flexShrink: 0,
              border: `1.5px solid ${useTargets ? 'var(--accent)' : UI.hairStrong}`,
              background: useTargets ? 'var(--accent)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {useTargets && <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.8"><path d="M1.5 5l2.5 2.5L8.5 2"/></svg>}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: UI.fontUi, color: UI.ink }}>Daily targets</div>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>
                {useTargets ? 'Set distance or duration goals per day' : 'Just show up — no specific targets'}
              </div>
            </div>
          </button>
        </div>
      );
    }

    /* Manual step 3 — targets */
    if (mode === 'manual' && step === 3) {
      const activeDays = CP_WEEKDAY_KEYS.filter(k => days[k]);
      const fillAll = (src) => {
        const filled = {};
        activeDays.forEach(k => { filled[k] = { ...src }; });
        setManualTargets(filled);
      };
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="micro" style={{ color: UI.inkFaint }}>SET DAILY TARGETS</div>
          {activeDays.map(k => {
            const t = manualTargets[k] || { target_type: 'distance' };
            const isDist = t.target_type !== 'duration';
            const upd = (v) => setManualTargets(prev => ({ ...prev, [k]: { ...t, ...v } }));
            const dispDist = t.distance_m ? (du === 'mi' ? (t.distance_m / 1609.344).toFixed(2) : (t.distance_m / 1000).toFixed(1)) : '';
            return (
              <div key={k} style={{ padding: 12, background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hair}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: UI.inkSoft, fontFamily: UI.fontUi }}>{CP_WEEKDAY_LABELS[CP_WEEKDAY_KEYS.indexOf(k)]}</span>
                    {(t.distance_m || t.duration_minutes) && (
                      <button onClick={() => fillAll({ ...t })} style={{
                        background: 'none', border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4,
                        padding: '1px 6px', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 8,
                        fontWeight: 700, letterSpacing: '0.06em', color: UI.inkFaint,
                        WebkitTapHighlightColor: 'transparent',
                      }} title="Apply to all days">→ ALL</button>
                    )}
                  </div>
                  <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}` }}>
                    {['distance','duration'].map(tt => {
                      const active = isDist ? tt === 'distance' : tt === 'duration';
                      return (
                        <button key={tt} onClick={() => upd({ target_type: tt })} style={{
                          padding: '4px 12px', cursor: 'pointer', border: 'none',
                          background: active ? UI.inkFaint : 'transparent',
                          fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                          color: active ? UI.bg : UI.inkFaint, WebkitTapHighlightColor: 'transparent',
                        }}>{tt === 'distance' ? du.toUpperCase() : 'MIN'}</button>
                      );
                    })}
                  </div>
                </div>
                {isDist ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="text" inputMode="decimal" defaultValue={dispDist}
                      key={`${k}-dist-${t.distance_m ?? 'x'}`}
                      onBlur={e => upd({ distance_m: cpDistToM(e.target.value, du), duration_minutes: null })}
                      placeholder={du === 'mi' ? '3.1' : '5'} style={{ ...inputStyle, flex: 1 }} />
                    <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, flexShrink: 0 }}>{du}</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="text" inputMode="numeric" defaultValue={t.duration_minutes || ''}
                      key={`${k}-dur-${t.duration_minutes ?? 'x'}`}
                      onBlur={e => upd({ duration_minutes: parseInt(e.target.value) || null, distance_m: null })}
                      placeholder="30" style={{ ...inputStyle, flex: 1 }} />
                    <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, flexShrink: 0 }}>min</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    /* Goal step 2 — goal details + days */
    if (mode === 'goal' && step === 2) {
      const allGoalDays = CP_WEEKDAY_KEYS.every(k => days[k]);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>GOAL TYPE</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { id: 'distance', label: 'Distance',        sub: 'Cover the distance' },
                { id: 'pace',     label: 'Distance + pace', sub: 'Hit a specific speed' },
                { id: 'duration', label: 'Duration',        sub: 'Run for X minutes' },
              ].map(gt => (
                <button key={gt.id} onClick={() => setGoal(g => ({ ...g, type: gt.id }))} style={{
                  flex: 1, padding: '10px 8px', borderRadius: 6, cursor: 'pointer', textAlign: 'center',
                  border: `1px solid ${goal.type === gt.id ? 'var(--accent)' : UI.hairStrong}`,
                  background: goal.type === gt.id ? 'rgba(var(--accent-rgb),0.1)' : UI.bgInset,
                  WebkitTapHighlightColor: 'transparent',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: goal.type === gt.id ? 'var(--accent)' : UI.ink, fontFamily: UI.fontUi }}>{gt.label}</div>
                  <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 3 }}>{gt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {goal.type === 'duration' ? (
            <div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>TARGET DURATION</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="text" inputMode="numeric" value={goal.dur}
                  onChange={e => setGoal(g => ({ ...g, dur: e.target.value }))}
                  placeholder="30" style={{ ...inputStyle, flex: 1 }} />
                <span style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, flexShrink: 0 }}>min</span>
              </div>
            </div>
          ) : (
            <div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>TARGET DISTANCE</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="text" inputMode="decimal" value={goal.dist}
                  onChange={e => setGoal(g => ({ ...g, dist: e.target.value }))}
                  placeholder={du === 'mi' ? '6.2' : '10'} style={{ ...inputStyle, flex: 1 }} />
                <span style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, flexShrink: 0 }}>{du}</span>
              </div>
            </div>
          )}

          {goal.type === 'pace' && (
            <div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>TARGET TIME</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="text" inputMode="numeric" value={goal.dur}
                  onChange={e => setGoal(g => ({ ...g, dur: e.target.value }))}
                  placeholder="60" style={{ ...inputStyle, flex: 1 }} />
                <span style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, flexShrink: 0 }}>min</span>
              </div>
              {goalDistM && goalDurMin && (
                <div className="num" style={{ fontSize: 11, color: UI.inkFaint, marginTop: 6 }}>
                  Target pace: {cpFmtPace((goalDurMin * 60) / (goalDistM / 1000), du)}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>DUE DATE</div>
            <div style={{ width: '100%', overflow: 'hidden', borderRadius: 4 }}>
              <input type="date" value={goalDue} min={LB.todayISO()} onChange={e => setGoalDue(e.target.value)}
                style={{ ...inputStyle, colorScheme: 'dark' }} />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="micro" style={{ color: UI.inkFaint }}>TRAINING DAYS</div>
              <button onClick={() => setDays(allGoalDays ? {} : Object.fromEntries(CP_WEEKDAY_KEYS.map(k => [k, true])))} style={{
                background: 'none', border: `0.5px solid ${allGoalDays ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`,
                borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                color: allGoalDays ? 'var(--accent)' : UI.inkFaint, WebkitTapHighlightColor: 'transparent',
              }}>ALL</button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {CP_WEEKDAY_KEYS.map((k, i) => (
                <button key={k} onClick={() => setDays(d => ({ ...d, [k]: !d[k] }))} style={{
                  flex: 1, paddingTop: 10, paddingBottom: 10, borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${days[k] ? 'var(--accent)' : UI.hairStrong}`,
                  background: days[k] ? 'rgba(var(--accent-rgb),0.12)' : UI.bgInset,
                  fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                  color: days[k] ? 'var(--accent)' : UI.inkSoft,
                  WebkitTapHighlightColor: 'transparent',
                }}>{CP_WEEKDAY_LABELS[i].slice(0,2).toUpperCase()}</button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    /* Goal step 3 — current fitness */
    if (mode === 'goal' && step === 3) {
      const actLabel = cpActivity(activityType).label.toLowerCase();
      if (goal.type === 'duration') return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>
            To build your progressive plan, we need a baseline. A rough estimate is fine.
          </div>
          <div>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>HOW LONG CAN YOU {actLabel.toUpperCase()} COMFORTABLY NOW?</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="text" inputMode="numeric" value={fitness.dur}
                onChange={e => setFitness(f => ({ ...f, dur: e.target.value }))}
                placeholder="10" style={{ ...inputStyle, flex: 1 }} />
              <span style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, flexShrink: 0 }}>min</span>
            </div>
          </div>
        </div>
      );
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>
            To build your progressive plan, we need a baseline. A rough estimate is fine.
          </div>
          <div>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>HOW FAR CAN YOU {actLabel.toUpperCase()} COMFORTABLY NOW?</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="text" inputMode="decimal" value={fitness.dist}
                onChange={e => setFitness(f => ({ ...f, dist: e.target.value }))}
                placeholder={du === 'mi' ? '1.5' : '2.5'} style={{ ...inputStyle, flex: 1 }} />
              <span style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, flexShrink: 0 }}>{du}</span>
            </div>
          </div>
          <div>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>HOW LONG DOES THAT TAKE? {goal.type === 'distance' ? '(OPTIONAL)' : ''}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="text" inputMode="numeric" value={fitness.dur}
                onChange={e => setFitness(f => ({ ...f, dur: e.target.value }))}
                placeholder="25" style={{ ...inputStyle, flex: 1 }} />
              <span style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, flexShrink: 0 }}>min</span>
            </div>
            {fitDistM && fitDurMin && (
              <div className="num" style={{ fontSize: 11, color: UI.inkFaint, marginTop: 6 }}>
                Current pace: {cpFmtPace(fitPaceSec, du)}
              </div>
            )}
          </div>
        </div>
      );
    }

    /* Goal step 4 — preview */
    if (mode === 'goal' && step === 4) {
      const ws = preview?.weeks || [];
      const total = ws.length;
      const isDur = goal.type === 'duration';
      const totalWeeksPreview = cpWeeksUntil(goalDue, LB.todayISO());
      const picks = total <= 6
        ? ws.map((w, i) => ({ w, i }))
        : [0, Math.floor(total*0.2), Math.floor(total*0.4), Math.floor(total*0.6), Math.floor(total*0.8), total-1]
            .filter((v,idx,a) => a.indexOf(v) === idx)
            .map(i => ({ w: ws[i], i }));
      const actLabel = cpActivity(activityType).label;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ padding: '10px 14px', background: 'rgba(var(--accent-rgb),0.05)', border: '0.5px solid rgba(var(--accent-rgb),0.2)', borderRadius: 6 }}>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>
              Your <strong style={{ color: UI.ink }}>{actLabel}</strong> plan: <strong style={{ color: UI.ink }}>{total} sessions</strong> over <strong style={{ color: UI.ink }}>{totalWeeksPreview} weeks</strong>. Each session progresses slightly. Every 4th calendar week is a lighter recovery week.
            </div>
          </div>
          {preview?.warnings?.map((msg, i) => (
            <div key={i} style={{ padding: '8px 12px', background: 'rgba(240,168,48,0.08)', border: '0.5px solid rgba(240,168,48,0.3)', borderRadius: 6 }}>
              <span style={{ fontSize: 11, color: '#f0a830', fontFamily: UI.fontUi, lineHeight: 1.5 }}>⚠ {msg}</span>
            </div>
          ))}
          {picks.map(({ w, i }) => {
            const isDeload = (i + 1) % 4 === 0 && i < total - 2;
            const isGoal   = i === total - 1;
            if (isDeload) return null;
            return (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', borderRadius: 6,
                background: isGoal ? 'rgba(var(--accent-rgb),0.08)' : UI.bgInset,
                border: `0.5px solid ${isGoal ? 'rgba(var(--accent-rgb),0.3)' : UI.hair}`,
              }}>
                <div>
                  <span style={{ fontSize: 12, color: isGoal ? 'var(--accent)' : UI.inkSoft, fontFamily: UI.fontUi, fontWeight: 600 }}>
                    Session {i+1}
                  </span>
                  {isGoal && (
                    <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: UI.fontUi, marginLeft: 6 }}>
                      · Goal
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  {isDur
                    ? <span className="num" style={{ fontSize: 15, color: isGoal ? 'var(--accent)' : UI.ink }}>{w.duration_minutes} min</span>
                    : <span className="num" style={{ fontSize: 15, color: isGoal ? 'var(--accent)' : UI.ink }}>{cpFmtDist(w.distance_m, du)}</span>
                  }
                  {w.pace_s_per_km && <span className="num" style={{ fontSize: 10, color: UI.inkFaint }}>@ {cpFmtPace(w.pace_s_per_km, du)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    /* Last step — name */
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="micro" style={{ color: UI.inkFaint }}>PLAN NAME</div>
        <input type="text" value={planName} onChange={e => setPlanName(e.target.value)}
          placeholder="e.g. Running Plan" autoFocus
          style={{ ...inputStyle, fontSize: 16, padding: '12px 14px' }} />
      </div>
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={sheetTitle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {step > 0 && mode && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: 3, borderRadius: 999, background: i < step ? 'var(--accent)' : UI.hairStrong, transition: 'background 0.3s' }} />
            ))}
          </div>
        )}
        <div style={{ minHeight: 180 }}>{renderStep()}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
          {step > 0 && <Btn kind="ghost" onClick={back} style={{ flex: 1 }}>Back</Btn>}
          {isLast
            ? <Btn onClick={save} disabled={!canNext()} style={{ flex: step > 0 ? 2 : 1 }}>{editPlan ? 'Save changes' : 'Create plan'}</Btn>
            : <Btn onClick={next} disabled={!canNext()} style={{ flex: step > 0 ? 2 : 1 }}>Next →</Btn>
          }
        </div>
      </div>
    </Sheet>
  );
}

// ─── CardioPlanScreen ───────────────────────────────────────────────────────
function CardioPlanScreen({ store, setStore, go }) {
  const [createOpen,  setCreateOpen]  = useStateCard(false);
  const [editPlan,    setEditPlan]    = useStateCard(null);
  const [detailPlan,  setDetailPlan]  = useStateCard(null);
  const [archivedOpen,setArchivedOpen]= useStateCard(false);

  const todayISO   = LB.todayISO();
  const distUnit   = cpDistUnit();
  const plans      = store.cardioPlans || [];
  const active     = plans.filter(p => !p.archived);
  const archived   = plans.filter(p =>  p.archived);

  const openCreate = (ep) => { setEditPlan(ep || null); setCreateOpen(true); };

  const doArchive   = (p) => { setDetailPlan(null); setStore(s => ({ ...s, cardioPlans: (s.cardioPlans||[]).map(x => x.id===p.id ? {...x, archived:true}  : x) })); };
  const doUnarchive = (p) => { setDetailPlan(null); setStore(s => ({ ...s, cardioPlans: (s.cardioPlans||[]).map(x => x.id===p.id ? {...x, archived:false} : x) })); };
  const doDelete    = (p) => { setDetailPlan(null); setStore(s => ({ ...s, cardioPlans: (s.cardioPlans||[]).filter(x => x.id !== p.id) })); };

  function PlanCard({ plan }) {
    const act    = cpActivity(plan.activityType);
    const target = cpTodayTarget(plan, todayISO);
    const done   = target ? cpTodayLog(plan, store.cardioLogs, todayISO) : null;
    const today  = !!target;

    let weekLabel = null;
    if (plan.mode === 'goal' && plan.generatedWeeks?.length) {
      const si  = Math.min(cpSessionIndex(plan.planStartDate, plan.days, todayISO) + 1, plan.generatedWeeks.length);
      const tot = plan.generatedWeeks.length;
      weekLabel = `Session ${si}/${tot}`;
    }

    return (
      <div onClick={() => setDetailPlan(plan)} style={{
        padding: '12px 14px', background: UI.bgInset,
        border: `0.5px solid ${today ? 'rgba(var(--accent-rgb),0.3)' : UI.hair}`,
        borderRadius: 6, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 6, flexShrink: 0,
          background: today ? 'rgba(var(--accent-rgb),0.12)' : UI.bg,
          border: `0.5px solid ${today ? 'rgba(var(--accent-rgb),0.3)' : UI.hairStrong}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <i className={`fa-solid ${act.icon}`} style={{ fontSize: 15, color: today ? 'var(--accent)' : UI.inkFaint }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.name}</div>
          <div className="micro" style={{ color: UI.inkFaint, marginTop: 2 }}>
            {CP_WEEKDAY_KEYS.filter(k => plan.days[k]).map(k => CP_WEEKDAY_LABELS[CP_WEEKDAY_KEYS.indexOf(k)].slice(0,2)).join(' · ')}
            {weekLabel ? ` · ${weekLabel}` : ''}
          </div>
        </div>
        {today && target && (
          done ? (
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke={UI.ok} strokeWidth="1.8"><path d="M2 6l2.5 2.5L10 3"/></svg>
          ) : (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {target.distanceM    != null && <div className="num" style={{ fontSize: 13, color: 'var(--accent)', lineHeight: 1.2 }}>{cpFmtDist(target.distanceM, distUnit)}</div>}
              {target.durationMinutes != null && <div className="num" style={{ fontSize: 13, color: 'var(--accent)', lineHeight: 1.2 }}>{target.durationMinutes} min</div>}
            </div>
          )
        )}
        <ChevronRight />
      </div>
    );
  }

  return (
    <Screen>
      <TopBar title="Plan" right={
        <button onClick={() => openCreate(null)} style={{
          width: 32, height: 32, borderRadius: 4,
          border: `1px solid ${UI.goldSoft}`, background: UI.goldFaint,
          color: UI.gold, cursor: 'pointer', fontSize: 20, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>+</button>
      } />
      <SubTabBar
        tabs={[
          { id: 'plan',   label: 'Workout',   icon: 'fa-dumbbell' },
          { id: 'lib',    label: 'Exercises', icon: 'fa-book' },
          { id: 'cardio', label: 'Cardio',    icon: 'fa-person-running' },
        ]}
        active="cardio"
        onChange={id => { if (id === 'plan') go({ name: 'plan' }); else if (id === 'lib') go({ name: 'lib' }); }}
      />

      <div style={{ padding: '14px 22px 80px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {active.length === 0 ? (
          <Empty
            title="No cardio plans"
            sub="Create a manual weekly plan or let the app build a progressive goal plan for you."
            action={<Btn onClick={() => openCreate(null)}>New plan</Btn>}
          />
        ) : (
          active.map(p => <PlanCard key={p.id} plan={p} />)
        )}

        {archived.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setArchivedOpen(v => !v)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
              WebkitTapHighlightColor: 'transparent',
            }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill={UI.inkFaint}
                style={{ transform: archivedOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                <polygon points="2,1 8,5 2,9" />
              </svg>
              <span className="micro" style={{ color: UI.inkFaint }}>ARCHIVED ({archived.length})</span>
            </button>
            {archivedOpen && archived.map(p => <PlanCard key={p.id} plan={p} />)}
          </div>
        )}
      </div>

      {detailPlan && (
        <CardioPlanDetailSheet
          plan={detailPlan}
          store={store}
          todayISO={todayISO}
          distUnit={distUnit}
          onClose={() => setDetailPlan(null)}
          onEdit={() => { setDetailPlan(null); openCreate(detailPlan); }}
          onArchive={() => doArchive(detailPlan)}
          onUnarchive={() => doUnarchive(detailPlan)}
          onDelete={() => doDelete(detailPlan)}
        />
      )}

      <CardioPlanCreateSheet
        open={createOpen}
        onClose={() => { setCreateOpen(false); setEditPlan(null); }}
        store={store}
        setStore={setStore}
        editPlan={editPlan}
      />
    </Screen>
  );
}

// ─── TodayCardioWidget — rendered on HomeScreen ─────────────────────────────
function TodayCardioWidget({ store, setStore, todayISO, userId, onPR }) {
  const [logOpen,   setLogOpen]   = useStateCard(false);
  const [logPrefill,setLogPrefill]= useStateCard(null);
  const du = cpDistUnit();

  const slots = useMemoCard(() => {
    return (store.cardioPlans || [])
      .filter(p => !p.archived)
      .map(plan => {
        const target = cpTodayTarget(plan, todayISO);
        if (!target) return null;
        const doneLog = cpTodayLog(plan, store.cardioLogs, todayISO);
        return { plan, target, doneLog };
      })
      .filter(Boolean);
  }, [store.cardioPlans, store.cardioLogs, todayISO]);

  if (!slots.length) return null;

  return (
    <div style={{ padding: '2px 22px 0' }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>CARDIO PLAN</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {slots.map(({ plan, target, doneLog }) => {
          const act = cpActivity(plan.activityType);
          return (
            <div key={plan.id} style={{
              padding: '10px 14px',
              background: doneLog ? 'rgba(123,196,123,0.05)' : UI.bgInset,
              border: `0.5px solid ${doneLog ? 'rgba(123,196,123,0.25)' : UI.hairStrong}`,
              borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <i className={`fa-solid ${act.icon}`} style={{ fontSize: 14, color: doneLog ? UI.ok : 'var(--accent)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.name}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 1 }}>
                  {doneLog ? (
                    <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>
                      {doneLog.durationMinutes} min logged{doneLog.distanceM ? ` · ${cpFmtDist(doneLog.distanceM, du)}` : ''}
                    </span>
                  ) : target.freeSession ? (
                    <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>Free session</span>
                  ) : (
                    <>
                      {target.distanceM    != null && <span className="num" style={{ fontSize: 13, color: UI.inkSoft }}>{cpFmtDist(target.distanceM, du)}</span>}
                      {target.durationMinutes != null && <span className="num" style={{ fontSize: 13, color: UI.inkSoft }}>{target.durationMinutes} min</span>}
                      {target.paceSecPerKm != null && <span className="num" style={{ fontSize: 10, color: UI.inkFaint }}>@ {cpFmtPace(target.paceSecPerKm, du)}</span>}
                    </>
                  )}
                </div>
              </div>
              {doneLog ? (
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke={UI.ok} strokeWidth="1.8" flexShrink="0"><path d="M2 6l2.5 2.5L10 3"/></svg>
              ) : (
                <button onClick={() => { setLogPrefill({ type: plan.activityType, distanceM: target.distanceM, durationMinutes: target.durationMinutes }); setLogOpen(true); }} style={{
                  flexShrink: 0, padding: '5px 12px', borderRadius: 4,
                  background: 'rgba(var(--accent-rgb),0.12)',
                  border: '0.5px solid rgba(var(--accent-rgb),0.3)',
                  fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                  color: 'var(--accent)', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}>LOG</button>
              )}
            </div>
          );
        })}
      </div>

      {logOpen && window.Screens?.CardioQuickLogSheet && (
        <window.Screens.CardioQuickLogSheet
          open={logOpen}
          onClose={() => { setLogOpen(false); setLogPrefill(null); }}
          store={store}
          setStore={setStore}
          userId={userId}
          editLog={null}
          prefill={logPrefill}
          onPR={onPR || (() => {})}
        />
      )}
    </div>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { CardioPlanScreen, TodayCardioWidget });
