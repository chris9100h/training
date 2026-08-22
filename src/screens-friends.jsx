/* Friends and social preview. The screen is intentionally feature-gated by
   settings.showFriendsTab and only receives the social store slice when that
   gate is on. */

const { useState: useStateF, useEffect: useEffectF, useMemo: useMemoF, useRef: useRefF } = React;

const SOCIAL_INPUT_STYLE = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px',
  borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
  background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi,
  fontSize: 13, outline: 'none', userSelect: 'text', WebkitUserSelect: 'text',
};

const SOCIAL_CHEER_OPTIONS = [
  { text: "Let's go!", emoji: '💥' },
  { text: 'Strong set!', emoji: '💪' },
  { text: 'Finish it!', emoji: '🙌' },
  { text: 'You got this!', emoji: '🚀' },
  { text: 'One more!', emoji: '🔥' },
];

const SOCIAL_METRIC_GROUP_TIMEFRAMES = {
  Activity: 'WEEK TO DATE · ADHERENCE THROUGH YESTERDAY',
  Nutrition: 'WEEKLY AVERAGE · THROUGH YESTERDAY',
  Body: 'LATEST READING',
  Vitals: 'LATEST READING',
};

function socialMetricDefinition(metric) {
  return (window.SocialMetricCatalog || []).find(item => item.key === metric) || { key: metric, label: metric };
}

function socialMetricLabel(metric) {
  const label = socialMetricDefinition(metric).label || metric;
  return label.replace(/^Weekly /, '').replace(/^Average /, '').replace(/^Latest /, '');
}

function socialMetricValue(metric, value, context = {}) {
  if (value == null) return null;
  const number = Number(value);
  if (metric === 'steps') return `${number.toLocaleString()} steps`;
  if (metric === 'workouts') return `${number} workouts`;
  if (metric === 'adherence') return `${number}% adherence`;
  if (metric === 'calories') return `${Math.round(number).toLocaleString()} kcal`;
  if (['protein', 'carbs', 'fat', 'fiber'].includes(metric)) return `${Math.round(number)}g`;
  if (metric === 'water') return `${Math.round(UI.waterToEntry(number)).toLocaleString()} ${UI.waterEntryUnit()}`;
  if (metric === 'cardioMinutes') return `${Math.round(number)} min`;
  if (metric === 'cardioDistance') return LB.fmtDistance(number, context.distanceUnit || LB.cardioDistUnit(), 1);
  if (metric === 'weight') return socialWeight(value, context.weightUnit, UI.unit());
  if (metric === 'bodyFatPct') return `${number.toFixed(1)}%`;
  if (['waistCm', 'hipsCm', 'chestCm', 'armCm', 'thighCm', 'calfCm'].includes(metric)) return `${number.toFixed(1)} cm`;
  if (metric === 'glucose') {
    const unit = context.settings?.glucoseUnit || 'mmol';
    return unit === 'mgdl' ? `${Math.round(number * 18.0182)} mg/dL` : `${number.toFixed(1)} mmol/L`;
  }
  if (metric === 'bloodPressure' && typeof value === 'object') return `${value.systolic}/${value.diastolic} mmHg`;
  if (metric === 'bodyTemp') {
    const unit = context.settings?.tempUnit === 'f' ? 'f' : 'c';
    return unit === 'f' ? `${(number * 9 / 5 + 32).toFixed(1)}°F` : `${number.toFixed(1)}°C`;
  }
  return String(value);
}

function socialFriendShares(friend, metric) {
  if (friend?.metricVisibility && Object.prototype.hasOwnProperty.call(friend.metricVisibility, metric)) return !!friend.metricVisibility[metric];
  return ['steps', 'workouts', 'adherence'].includes(metric) && friend?.[metric] != null;
}

function socialFriendMetricValue(friend, metric) {
  if (friend?.metrics && Object.prototype.hasOwnProperty.call(friend.metrics, metric)) return friend.metrics[metric];
  return friend?.[metric] ?? null;
}

function socialTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function socialDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

function socialWeight(value, fromUnit, toUnit) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  const source = fromUnit === 'lbs' ? 'lbs' : 'kg';
  const target = toUnit === 'lbs' ? 'lbs' : 'kg';
  let amount = Number(value);
  if (source !== target) amount = source === 'kg' ? amount * 2.20462 : amount / 2.20462;
  amount = Math.round(amount * 10) / 10;
  return `${amount} ${target}`;
}

function socialReps(set) {
  if (set.repsL != null || set.repsR != null) {
    const left = set.repsL ?? '—';
    const right = set.repsR ?? '—';
    return left === right ? String(left) : `${left}/${right}`;
  }
  if (set.reps != null) return String(set.reps);
  if (set.timeSec != null) return `${set.timeSec}s`;
  return '—';
}

function socialInitials(name) {
  const parts = String(name || 'Zane athlete').trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map(part => part[0]).join('') || 'Z').toUpperCase();
}

// Shared plans are user-controlled JSON. Keep the import useful while
// bounding its size and copying only fields the local schedule/exercise model
// understands. This prevents a friend share from becoming an unbounded local
// storage write or from smuggling arbitrary schedule properties into state.
const SOCIAL_PLAN_IMPORT_LIMITS = {
  bytes: 250000,
  exercises: 500,
  days: 14,
  itemsPerDay: 100,
  setsPerItem: 30,
  historyPerLift: 64,
};

function socialBoundText(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function socialSanitizeImportedLabel(value, maxLength = 120) {
  if (window.Screens?.sanitizeImportedLabel) return window.Screens.sanitizeImportedLabel(value, maxLength);
  if (typeof value !== 'string') return '';
  const max = Number.isInteger(maxLength) && maxLength > 0 ? maxLength : 120;
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function socialFiniteNumber(value, min = -1000000, max = 1000000) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
}

function socialBoundStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => typeof item === 'string')
    .slice(0, maxItems)
    .map(item => socialSanitizeImportedLabel(item, maxLength))
    .filter(Boolean);
}

const SOCIAL_IMPORTED_PLAN_RECEIPTS_KEY = 'zane.social.imported-plans.v1';

function socialBrowserStorage() {
  try { return window.localStorage; } catch (_) { return null; }
}

function socialReadImportedPlanReceipts(storage, userId) {
  if (!storage || !userId) return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(`${SOCIAL_IMPORTED_PLAN_RECEIPTS_KEY}.${userId}`) || '[]');
    return new Set((Array.isArray(parsed) ? parsed : []).filter(id => typeof id === 'string' && id.length > 0 && id.length <= 200).slice(-500));
  } catch (_) {
    return new Set();
  }
}

function socialRememberImportedPlanReceipt(storage, userId, shareId, receipts) {
  if (!shareId || !receipts) return;
  receipts.add(String(shareId).slice(0, 200));
  if (!storage || !userId) return;
  try {
    storage.setItem(`${SOCIAL_IMPORTED_PLAN_RECEIPTS_KEY}.${userId}`, JSON.stringify([...receipts].slice(-500)));
  } catch (_) {}
}

function socialPlanAlreadyImported(share, receipts) {
  // Server importedAt means another device may already have written the plan;
  // only this device's receipt proves its in-memory store has hydrated it.
  return !!share?.id && !!receipts?.has(share.id);
}

function socialMergeImportedPlan(store, schedule, exercises) {
  if (!store || !schedule?.id) return store;
  const incomingExercises = Array.isArray(exercises) ? exercises.filter(exercise => exercise?.id) : [];
  const incomingExerciseIds = new Set(incomingExercises.map(exercise => exercise.id));
  return {
    ...store,
    exercises: [...(store.exercises || []).filter(exercise => !incomingExerciseIds.has(exercise.id)), ...incomingExercises],
    schedules: [...(store.schedules || []).filter(existing => existing.id !== schedule.id), schedule],
  };
}

function socialSanitizeProgramData(value, idMap) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  if (value.unit === 'kg' || value.unit === 'lbs') result.unit = value.unit;
  if (typeof value.includeDeload === 'boolean') result.includeDeload = value.includeDeload;
  const remapLifts = source => Object.fromEntries(Object.entries(source || {}).slice(0, 500).filter(([key]) => Object.prototype.hasOwnProperty.call(idMap, key) && idMap[key] && source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])).map(([key, raw]) => [idMap[key], {
    ...(socialFiniteNumber(raw.tm, 0, 100000) != null ? { tm: socialFiniteNumber(raw.tm, 0, 100000) } : {}),
    ...(typeof raw.kind === 'string' ? { kind: socialSanitizeImportedLabel(raw.kind, 24) } : {}),
    ...(socialFiniteNumber(raw.stall, 0, 100) != null ? { stall: Math.round(socialFiniteNumber(raw.stall, 0, 100)) } : {}),
  }]));
  const remapHistory = source => Object.fromEntries(Object.entries(source || {}).slice(0, 500).filter(([key]) => Object.prototype.hasOwnProperty.call(idMap, key) && idMap[key] && Array.isArray(source[key])).map(([key, rows]) => [idMap[key], rows.slice(0, SOCIAL_PLAN_IMPORT_LIMITS.historyPerLift).filter(row => row && typeof row === 'object').map(row => ({
    ...(socialFiniteNumber(row.cycle, 0, 100000) != null ? { cycle: Math.round(socialFiniteNumber(row.cycle, 0, 100000)) } : {}),
    ...(socialFiniteNumber(row.tm, 0, 100000) != null ? { tm: socialFiniteNumber(row.tm, 0, 100000) } : {}),
    ...(typeof row.reason === 'string' ? { reason: socialSanitizeImportedLabel(row.reason, 32) } : {}),
  }))]));
  if (value.mainLifts && typeof value.mainLifts === 'object' && !Array.isArray(value.mainLifts)) result.mainLifts = remapLifts(value.mainLifts);
  if (value.tmHistory && typeof value.tmHistory === 'object' && !Array.isArray(value.tmHistory)) result.tmHistory = remapHistory(value.tmHistory);
  if (socialFiniteNumber(value.bumpedCycle, 0, 100000) != null) result.bumpedCycle = Math.round(socialFiniteNumber(value.bumpedCycle, 0, 100000));
  return Object.keys(result).length ? result : null;
}

function socialSanitizePlanItem(item, idMap) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || !Object.prototype.hasOwnProperty.call(idMap, item.exId) || !idMap[item.exId]) return null;
  const result = { exId: idMap[item.exId] };
  const sets = socialFiniteNumber(item.sets, 0, SOCIAL_PLAN_IMPORT_LIMITS.setsPerItem);
  if (sets != null) result.sets = Math.round(sets);
  const reps = socialFiniteNumber(item.reps, 0, 1000);
  if (reps != null) result.reps = Math.round(reps);
  if (Array.isArray(item.repsPerSet)) result.repsPerSet = item.repsPerSet.slice(0, SOCIAL_PLAN_IMPORT_LIMITS.setsPerItem).map(value => socialFiniteNumber(value, 0, 1000)).filter(value => value != null).map(value => Math.round(value));
  const repsMax = socialFiniteNumber(item.repsMax, 0, 1000);
  if (repsMax != null) result.repsMax = Math.round(repsMax);
  const progressionOffset = socialFiniteNumber(item.progressionOffset, -1000, 1000);
  if (progressionOffset != null) result.progressionOffset = Math.round(progressionOffset);
  if (Array.isArray(item.plannedTechniques)) result.plannedTechniques = item.plannedTechniques.slice(0, SOCIAL_PLAN_IMPORT_LIMITS.setsPerItem).map(value => typeof value === 'string' ? socialSanitizeImportedLabel(value, 80) : null);
  if (Array.isArray(item.timeSecPerSet)) result.timeSecPerSet = item.timeSecPerSet.slice(0, SOCIAL_PLAN_IMPORT_LIMITS.setsPerItem).map(value => socialFiniteNumber(value, 0, 86400)).filter(value => value != null).map(value => Math.round(value));
  if (typeof item.supersetGroup === 'string') result.supersetGroup = socialSanitizeImportedLabel(item.supersetGroup, 80);
  return result;
}

function socialSanitizePlanSchedule(raw, idMap) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result = {
    name: socialSanitizeImportedLabel(raw.name, 120) || 'Shared plan',
    days: Array.isArray(raw.days) ? raw.days.slice(0, SOCIAL_PLAN_IMPORT_LIMITS.days).filter(day => day && typeof day === 'object' && !Array.isArray(day)).map(day => ({
      id: LB.uid(),
      name: socialSanitizeImportedLabel(day.name, 80) || 'Training day',
      ...(Number.isInteger(day.weekday) && day.weekday >= 0 && day.weekday <= 6 ? { weekday: day.weekday } : {}),
      items: Array.isArray(day.items) ? day.items.slice(0, SOCIAL_PLAN_IMPORT_LIMITS.itemsPerDay).map(item => socialSanitizePlanItem(item, idMap)).filter(Boolean) : [],
    })) : [],
  };
  if (raw.program_type === '531') result.program_type = '531';
  return result;
}

function SocialCommentsPanel({ detail, live, commentsOpen, setCommentsOpen, comment, setComment, sending, send, error }) {
  const [cheerPickerOpen, setCheerPickerOpen] = useStateF(false);

  const chooseCheer = async cheer => {
    if (sending) return;
    const sent = await send(cheer.text, 'cheer');
    if (sent) setCheerPickerOpen(false);
  };

  return (
    <div>
      <button type="button" onClick={() => setCommentsOpen(open => !open)} aria-expanded={commentsOpen} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 11px', borderRadius: 4, border: `var(--hair-width) solid ${commentsOpen ? UI.goldSoft : UI.hairStrong}`, background: commentsOpen ? UI.goldFaint : 'transparent', color: commentsOpen ? UI.gold : UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
        <span><i className="fa-solid fa-comment" style={{ marginRight: 7 }} /> COMMENTS <span style={{ color: commentsOpen ? UI.goldSoft : UI.inkFaint }}>{'\u00b7'} {detail?.comments?.length || 0}</span></span>
        <i className={`fa-solid fa-chevron-${commentsOpen ? 'up' : 'down'}`} style={{ fontSize: 10 }} />
      </button>
      {commentsOpen && <div style={{ marginTop: 8 }}>
        {live && <>
          <div className="micro" style={{ color: UI.gold, marginBottom: 8 }}>CHEER THEM ON</div>
          <Btn kind="ghost" onClick={() => setCheerPickerOpen(true)} disabled={sending} style={{ width: '100%', padding: '10px 12px', minHeight: 0, color: UI.gold, borderColor: UI.goldSoft }}>
            <span style={{ marginRight: 7 }}>💬</span> Cheer
          </Btn>
          <Sheet open={cheerPickerOpen} onClose={() => setCheerPickerOpen(false)} title="Pick a cheer" titleColor={UI.gold} center accent>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 12 }}>Choose a quick message to send.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {SOCIAL_CHEER_OPTIONS.map(cheer => (
                <button key={cheer.text} type="button" onClick={() => chooseCheer(cheer)} disabled={sending} style={{
                  minWidth: 0, minHeight: 86, padding: '12px 8px', borderRadius: 6,
                  border: `1px solid ${UI.goldSoft}`, background: UI.goldFaint,
                  color: UI.ink, fontFamily: UI.fontUi, cursor: sending ? 'default' : 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7,
                  opacity: sending ? 0.6 : 1, WebkitTapHighlightColor: 'transparent',
                }}>
                  <span aria-hidden="true" style={{ fontSize: 28, lineHeight: 1 }}>{cheer.emoji}</span>
                  <span style={{ fontSize: 11, lineHeight: 1.2, textAlign: 'center' }}>{cheer.text}</span>
                </button>
              ))}
            </div>
            {error && <div style={{ marginTop: 10, color: UI.danger, fontFamily: UI.fontUi, fontSize: 12 }}>{error}</div>}
            <Btn kind="ghost" onClick={() => setCheerPickerOpen(false)} disabled={sending} style={{ width: '100%', marginTop: 12, minHeight: 0, padding: '10px 12px' }}>Cancel</Btn>
          </Sheet>
        </>}
        <div style={{ marginTop: live ? 10 : 0 }}>
          <div className="micro" style={{ color: UI.gold, marginBottom: 8 }}>COMMENTS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 220, overflowY: 'auto', marginBottom: 8 }}>
            {!detail?.comments?.length && <div className="micro" style={{ color: UI.inkFaint }}>Be the first to say something.</div>}
            {(detail?.comments || []).map(item => <div key={item.id} style={{ padding: '8px 10px', borderRadius: 4, background: item.kind === 'cheer' ? UI.goldFaint : UI.bgInset, border: `var(--hair-width) solid ${item.kind === 'cheer' ? UI.goldSoft : UI.hair}`, color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}><strong style={{ color: item.kind === 'cheer' ? UI.gold : UI.ink }}>{item.authorName}</strong><span className="micro" style={{ color: UI.inkGhost }}>{socialTime(item.createdAt)}</span></div>
              <div style={{ marginTop: 3 }}>{item.body}</div>
            </div>)}
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <input value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(comment); } }} maxLength={400} placeholder="Say something" style={{ ...SOCIAL_INPUT_STYLE, flex: 1, padding: '9px 10px' }} />
            <Btn onClick={() => send(comment)} disabled={sending || !comment.trim()} style={{ padding: '9px 11px', minHeight: 0, fontSize: 10 }}>{sending ? '...' : 'Send'}</Btn>
          </div>
        </div>
      </div>}
    </div>
  );
}

function SocialWorkoutSheet({ workout, onClose }) {
  const [detail, setDetail] = useStateF(null);
  const [loading, setLoading] = useStateF(true);
  const [error, setError] = useStateF('');
  const [comment, setComment] = useStateF('');
  const [sending, setSending] = useStateF(false);
  const [commentsOpen, setCommentsOpen] = useStateF(() => !!workout.live);
  const detailRequestRef = useRefF(0);

  const mergeDetail = (current, next) => {
    if (!next) return next;
    const comments = new Map((next.comments || []).filter(item => item?.id).map(item => [item.id, item]));
    (current?.comments || []).forEach(item => {
      if (item?.id && !comments.has(item.id)) comments.set(item.id, item);
    });
    return {
      ...next,
      comments: [...comments.values()].sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || '')),
    };
  };

  const load = async () => {
    const requestId = ++detailRequestRef.current;
    try {
      const next = await LB.loadSocialWorkoutDetail(workout.ownerId, workout.sessionId);
      if (requestId !== detailRequestRef.current) return { ok: false, live: !!workout.live };
      setDetail(current => mergeDetail(current, next));
      setError(next ? '' : 'This workout is no longer available.');
      return { ok: true, live: next ? !next.session?.ended : false };
    } catch (e) {
      if (requestId !== detailRequestRef.current) return { ok: false, live: !!workout.live };
      setError(e.message || 'Could not load workout');
      return { ok: false, live: !!workout.live };
    } finally {
      if (requestId === detailRequestRef.current) setLoading(false);
    }
  };

  useEffectF(() => {
    let live = true;
    let timer = null;
    let failures = 0;
    const run = async () => {
      if (!live) return;
      const result = await load();
      if (!live) return;
      failures = result?.ok ? 0 : failures + 1;
      const failureDelay = [5000, 10000, 30000, 60000][Math.min(Math.max(failures - 1, 0), 3)];
      timer = setTimeout(run, failures ? failureDelay : (result?.live ? 5000 : 15000));
    };
    run();
    return () => { live = false; detailRequestRef.current += 1; clearTimeout(timer); };
  }, [workout.ownerId, workout.sessionId, workout.live]);

  const send = async (body, kind = 'comment') => {
    const text = String(body || '').trim();
    if (!text || sending) return false;
    setSending(true);
    try {
      const next = await LB.sendSocialWorkoutComment(workout.sessionId, text, kind);
      setDetail(current => current ? { ...current, comments: [...(current.comments || []), next] } : current);
      setComment('');
      return true;
    } catch (e) {
      setError(e.message || 'Could not send comment');
      return false;
    } finally {
      setSending(false);
    }
  };

  const session = detail?.session || workout;
  const entries = detail?.entries || [];
  const doneSets = Number(session.setsDone || 0);
  const totalSets = Number(session.setsTotal || 0);
  const progress = totalSets > 0 ? Math.min(1, doneSets / totalSets) : 0;
  const live = !session.ended;
  const viewerUnit = UI.unit();
  const ownerUnit = session.weightUnit || 'kg';

  return (
    <Sheet open onClose={onClose} title={session.ownerName || 'Workout'} titleRight={
      <span className="micro" style={{ color: live ? UI.gold : UI.inkFaint }}>{live ? 'LIVE' : 'FINISHED'}</span>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {live && <SocialCommentsPanel detail={detail} live={live} commentsOpen={commentsOpen} setCommentsOpen={setCommentsOpen} comment={comment} setComment={setComment} sending={sending} send={send} error={error} />}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div className="display" style={{ color: UI.ink, fontSize: 24 }}>{session.dayName || 'Workout'}</div>
          <div className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>{socialDate(session.startedAt || session.date)}</div>
        </div>
        <Card style={{ padding: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
            <span className="micro" style={{ color: UI.inkFaint }}>{live ? 'WORKING THROUGH IT' : 'WORKOUT COMPLETE'}</span>
            <span className="num" style={{ color: UI.gold, fontSize: 13 }}>{doneSets} / {totalSets || '—'} SETS</span>
          </div>
          <div style={{ height: 6, borderRadius: '50%', background: UI.bgInset, overflow: 'hidden', marginTop: 10 }}>
            <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: UI.gold, transition: 'width .25s ease' }} />
          </div>
          {live && <div className="micro" style={{ color: UI.inkFaint, marginTop: 8 }}>Live progress refreshes automatically.</div>}
        </Card>
        {loading && !detail && <div className="micro" style={{ color: UI.inkFaint, textAlign: 'center', padding: 16 }}>LOADING WORKOUT…</div>}
        {error && <div style={{ padding: '9px 11px', borderRadius: 4, background: 'rgba(var(--danger-rgb),0.10)', border: `var(--hair-width) solid rgba(var(--danger-rgb),0.3)`, color: UI.danger, fontFamily: UI.fontUi, fontSize: 12 }}>{error}</div>}
        {entries.length > 0 && <div>
          <div className="micro" style={{ color: UI.gold, marginBottom: 8 }}>EXERCISES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map((entry, index) => {
              const sets = entry.sets || [];
              const done = sets.filter(set => set.done || set.skipped).length;
              const complete = sets.length > 0 && done === sets.length;
              return <Card key={`${entry.name}-${index}`} style={{ padding: 12, background: complete ? 'rgba(var(--accent-rgb),0.08)' : UI.bgRaised }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>{String(index + 1).padStart(2, '0')}</span>
                  <span style={{ flex: 1, color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>{entry.name}</span>
                  <span className="num" style={{ color: complete ? UI.gold : UI.inkFaint, fontSize: 11 }}>{done}/{sets.length || entry.plannedSets || '—'}</span>
                </div>
                <div style={{ display: 'none' }}>
                  {sets.map((set, setIndex) => <span key={setIndex} title={set.skipped ? 'Skipped' : set.done ? 'Done' : 'Planned'} style={{ width: 18, height: 18, borderRadius: 4, display: 'grid', placeItems: 'center', border: `var(--hair-width) solid ${set.done ? UI.gold : set.skipped ? UI.inkGhost : UI.hairStrong}`, background: set.done ? UI.goldFaint : 'transparent', color: set.done ? UI.gold : UI.inkGhost, fontFamily: UI.fontNum, fontSize: 9 }}>{set.skipped ? '—' : set.done ? '✓' : setIndex + 1}</span>)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
                  {sets.map((set, setIndex) => {
                    const reps = socialReps(set);
                    const repsLabel = set.timeSec != null && set.reps == null && set.repsL == null && set.repsR == null
                      ? reps
                      : reps === '—' && entry.plannedReps != null ? `${entry.plannedReps} planned` : `${reps} reps`;
                    const status = set.skipped ? 'SKIPPED' : set.done ? 'DONE' : 'PLANNED';
                    return <div key={`detail-${setIndex}`} style={{ display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr) minmax(0, 1fr) auto', gap: 7, alignItems: 'center', padding: '5px 0', borderTop: setIndex ? `var(--hair-width) solid ${UI.hair}` : 'none' }}>
                      <span className="micro" style={{ color: UI.inkFaint }}>SET {setIndex + 1}</span>
                      <span className="num" style={{ color: set.kg != null ? UI.inkSoft : UI.inkGhost, fontSize: 11 }}>{socialWeight(set.kg, ownerUnit, viewerUnit) || '—'}</span>
                      <span className="num" style={{ color: reps !== '—' ? UI.inkSoft : UI.inkGhost, fontSize: 11 }}>{repsLabel}</span>
                      <span className="micro" style={{ color: set.done ? UI.gold : UI.inkGhost, fontSize: 9 }}>{status}</span>
                    </div>;
                  })}
                </div>
              </Card>;
            })}
          </div>
        </div>}
        {!live && <SocialCommentsPanel detail={detail} live={live} commentsOpen={commentsOpen} setCommentsOpen={setCommentsOpen} comment={comment} setComment={setComment} sending={sending} send={send} error={error} />}
      </div>
    </Sheet>
  );
}

function FriendsScreen({ store, setStore, userId, initialTab = 'circle' }) {
  const [confirmEl, confirm] = useConfirm();
  const validTabs = ['circle', 'activity', 'chats', 'groups', 'plans'];
  const [activeTab, setActiveTab] = useStateF(() => validTabs.includes(initialTab) ? initialTab : 'circle');
  const [query, setQuery] = useStateF('');
  const [searchResult, setSearchResult] = useStateF(null);
  const [searchComplete, setSearchComplete] = useStateF(false);
  const [searching, setSearching] = useStateF(false);
  const [friendRequestBusy, setFriendRequestBusy] = useStateF(false);
  const [loading, setLoading] = useStateF(true);
  const [error, setError] = useStateF('');
  const [selectedChat, setSelectedChat] = useStateF(null);
  const [messageBody, setMessageBody] = useStateF('');
  const [messageFile, setMessageFile] = useStateF(null);
  const [sending, setSending] = useStateF(false);
  const [editingMessageId, setEditingMessageId] = useStateF(null);
  const [editingMessageBody, setEditingMessageBody] = useStateF('');
  const [messageActionBusy, setMessageActionBusy] = useStateF(false);
  const [groupName, setGroupName] = useStateF('');
  const [joinCode, setJoinCode] = useStateF('');
  const [groupBusy, setGroupBusy] = useStateF(false);
  const [copiedGroupId, setCopiedGroupId] = useStateF(null);
  const [copiedOwnCode, setCopiedOwnCode] = useStateF(false);
  const [planRecipientType, setPlanRecipientType] = useStateF('friend');
  const [planRecipientId, setPlanRecipientId] = useStateF('');
  const [planId, setPlanId] = useStateF(store.activeScheduleId || store.schedules?.[0]?.id || '');
  const [planBusy, setPlanBusy] = useStateF(false);
  const [reportTarget, setReportTarget] = useStateF(null);
  const [reportReason, setReportReason] = useStateF('other');
  const [reportDetails, setReportDetails] = useStateF('');
  const [reportBusy, setReportBusy] = useStateF(false);
  const [selectedFriend, setSelectedFriend] = useStateF(null);
  const [selectedFriendMetrics, setSelectedFriendMetrics] = useStateF(null);
  const [selectedFriendMetricsLoading, setSelectedFriendMetricsLoading] = useStateF(false);
  const [selectedFriendMetricsError, setSelectedFriendMetricsError] = useStateF('');
  const [selectedWorkout, setSelectedWorkout] = useStateF(null);
  const [expandedGroupMetric, setExpandedGroupMetric] = useStateF(null);
  const [metricPickerOpen, setMetricPickerOpen] = useStateF(false);
  const [metricSlotsDraft, setMetricSlotsDraft] = useStateF(() => [...(LB.socialDefaultMetricSlots || ['steps', 'workouts', 'adherence'])]);
  const [metricSlotsSaving, setMetricSlotsSaving] = useStateF(false);

  // Keep the last usable snapshot visible while the app reconciles a
  // reconnect or runtime-config transition. The app-level loader can briefly
  // clear its slice, but an open Circle, chat, or plan view must not fall back
  // to a full-screen "Loading Friends" state for that gap.
  const liveFriendsData = store.friends;
  const friendsDataRef = useRefF({ userId, data: null });
  if (friendsDataRef.current.userId !== userId) friendsDataRef.current = { userId, data: null };
  if (liveFriendsData) friendsDataRef.current.data = liveFriendsData;
  const data = liveFriendsData || friendsDataRef.current.data;
  const friends = data?.friends || [];
  const groups = data?.groups || [];
  const messages = data?.messages || [];
  const groupMembers = data?.groupMembers || [];
  const incoming = data?.incoming || [];
  const planShares = data?.planShares || [];
  const liveWorkouts = data?.liveWorkouts || [];
  const workoutHistory = data?.workoutHistory || [];
  const importedPlanReceiptsRef = useRefF({ userId: null, ids: new Set() });
  if (importedPlanReceiptsRef.current.userId !== userId) {
    importedPlanReceiptsRef.current = {
      userId,
      ids: socialReadImportedPlanReceipts(socialBrowserStorage(), userId),
    };
  }
  const importedPlanReceipts = importedPlanReceiptsRef.current.ids;
  const importingPlanIdsRef = useRefF(new Set());

  const socialMetricCatalog = LB.socialMetricCatalog || window.SocialMetricCatalog || [];
  const defaultMetricSlots = LB.socialDefaultMetricSlots || ['steps', 'workouts', 'adherence'];
  const metricSlots = data?.profile?.metricSlots?.length === 3 ? data.profile.metricSlots : defaultMetricSlots;
  const selectedFriendId = selectedFriend?.userId || '';

  useEffectF(() => {
    if (validTabs.includes(initialTab)) setActiveTab(initialTab);
  }, [initialTab]);

  useEffectF(() => {
    setMetricSlotsDraft([...metricSlots]);
  }, [JSON.stringify(metricSlots)]);

  useEffectF(() => {
    let live = true;
    if (!selectedFriendId) {
      setSelectedFriendMetrics(null);
      setSelectedFriendMetricsLoading(false);
      setSelectedFriendMetricsError('');
      return () => { live = false; };
    }
    setSelectedFriendMetrics(null);
    setSelectedFriendMetricsLoading(true);
    setSelectedFriendMetricsError('');
    LB.loadSocialFriendMetrics(selectedFriendId).then(detail => {
      if (!live) return;
      setSelectedFriendMetrics(detail);
    }).catch(error => {
      if (!live) return;
      setSelectedFriendMetricsError(error.message || 'Could not load shared metrics');
    }).finally(() => {
      if (live) setSelectedFriendMetricsLoading(false);
    });
    return () => { live = false; };
  }, [selectedFriendId]);

  const closeFriendDetail = () => {
    setSelectedFriend(null);
    setSelectedFriendMetrics(null);
    setSelectedFriendMetricsError('');
  };

  useEffectF(() => {
    const friendsEnabled = !!store.settings?.showFriendsTab;
    if (!friendsEnabled || !userId) {
      setLoading(!userId);
      return;
    }
    // The app-level social loader normally owns refreshes. If another boot
    // path clears the slice while this screen stays mounted, restart the
    // screen-level recovery load instead of leaving a stale empty fallback.
    const requestedWeekStart = LB.socialWeekStartISO(new Date(), store.settings?.weekStartDay);
    if (data?.loadedAt && data.weekStart === requestedWeekStart) {
      setLoading(false);
      return;
    }
    let live = true;
    let retryTimer = null;
    let attempt = 0;
    setLoading(true);
    const load = () => {
      if (!live) return;
      LB.loadFriendsState(userId, LB.socialWeekStartISO(new Date(), store.settings?.weekStartDay)).then(next => {
        if (!live) return;
        setError('');
        setStore(s => s ? {
          ...s,
          friends: {
            ...next,
            liveWorkouts: s.friends?.liveWorkouts || [],
            workoutHistory: s.friends?.workoutHistory || [],
          },
        } : s);
      }).catch(e => {
        if (!live) return;
        setError(e.message || 'Could not load Friends');
        if (attempt < 2) {
          attempt += 1;
          retryTimer = setTimeout(load, 700 * attempt);
        }
      }).finally(() => { if (live) setLoading(false); });
    };
    load();
    return () => {
      live = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [userId, store.settings?.showFriendsTab, store.settings?.weekStartDay, !data]);

  const reload = async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const next = await LB.loadFriendsState(userId, LB.socialWeekStartISO(new Date(), store.settings?.weekStartDay), { force });
      setStore(s => s ? {
        ...s,
        friends: {
          ...next,
          liveWorkouts: s.friends?.liveWorkouts || [],
          workoutHistory: s.friends?.workoutHistory || [],
        },
      } : s);
      // The core slice is enough to render Circle and Groups. Refresh the
      // activity summaries separately so a slow feed never delays that view.
      LB.loadSocialWorkoutFeed().then(feed => {
        setStore(s => s?.friends ? { ...s, friends: { ...s.friends, ...feed } } : s);
      }).catch(() => {});
    } catch (e) {
      setError(e.message || 'Could not load Friends');
    } finally {
      setLoading(false);
    }
  };

  const patchSocial = (patch) => setStore(s => {
    if (!s) return s;
    const current = s.friends || {};
    const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
    return { ...s, friends: next };
  });

  // If the local import succeeded but marking the server receipt did not,
  // keep the import idempotent and retry only the lightweight receipt write
  // on a later data refresh or mount.
  const pendingPlanReceiptIds = planShares
    .filter(share => !share.importedAt && importedPlanReceipts.has(share.id))
    .map(share => share.id)
    .sort();
  useEffectF(() => {
    if (!pendingPlanReceiptIds.length) return undefined;
    let live = true;
    Promise.all(pendingPlanReceiptIds.map(async id => {
      try {
        await LB.markSocialPlanImported(id);
        return id;
      } catch (_) {
        return null;
      }
    })).then(markedIds => {
      if (!live) return;
      const marked = new Set(markedIds.filter(Boolean));
      if (!marked.size) return;
      const importedAt = new Date().toISOString();
      patchSocial(s => ({ ...s, planShares: (s.planShares || []).map(share => marked.has(share.id) ? { ...share, importedAt } : share) }));
    });
    return () => { live = false; };
  }, [userId, data?.loadedAt, pendingPlanReceiptIds.join('|')]);

  const openMetricPicker = () => {
    setMetricSlotsDraft([...metricSlots]);
    setMetricPickerOpen(true);
  };

  const saveMetricSlots = async () => {
    const slots = [...new Set(metricSlotsDraft)].filter(key => socialMetricCatalog.some(metric => metric.key === key));
    if (slots.length !== 3 || metricSlotsSaving) return;
    setMetricSlotsSaving(true);
    try {
      const profile = await LB.updateSocialMetricPreferences(userId, { metricVisibility: data?.profile?.metricVisibility || {}, metricSlots: slots });
      patchSocial(s => ({ ...s, profile }));
      setMetricPickerOpen(false);
    } catch (e) {
      setError(e.message || 'Could not save metric layout');
    } finally {
      setMetricSlotsSaving(false);
    }
  };

  const displayedFriendMetric = (friend, slotIndex) => {
    const requested = metricSlots[slotIndex] || defaultMetricSlots[slotIndex];
    const fallback = defaultMetricSlots[slotIndex];
    return socialFriendShares(friend, requested) ? requested : fallback;
  };

  const runAction = async (action, successTab = null) => {
    setError('');
    try {
      await action();
      await reload(true);
      if (successTab) setActiveTab(successTab);
      return true;
    } catch (e) {
      setError(e.message || 'Action failed');
      return false;
    }
  };

  const addSearchResultAsFriend = async () => {
    const target = searchResult;
    if (!target?.userId || target.relationship !== 'none' || friendRequestBusy) return;
    const accepted = await confirm(`Add ${target.name || 'this person'} as a friend?`, {
      title: 'Add friend', ok: 'Send request', cancel: 'Cancel',
    });
    if (!accepted) return;
    setFriendRequestBusy(true);
    try {
      const sent = await runAction(() => LB.sendSocialFriendRequest(target.userId));
      if (!sent) return;
      // Keep the result honest even if the reload returns an older snapshot
      // while Broadcast and the dashboard RPC are still catching up.
      setSearchResult(current => current?.userId === target.userId ? { ...current, relationship: 'pending' } : current);
      await confirm(`Request sent to ${target.name || 'this person'}.`, {
        title: 'Request sent', ok: 'OK', cancel: null,
      });
    } finally {
      setFriendRequestBusy(false);
    }
  };

  const search = async () => {
    const value = query.trim();
    if (!value || searching) return;
    setSearching(true);
    setSearchResult(null);
    setSearchComplete(false);
    setError('');
    try {
      setSearchResult(await LB.lookupSocialProfile(value));
    } catch (e) {
      setError(e.message || 'Search failed');
    } finally {
      setSearchComplete(true);
      setSearching(false);
    }
  };

  const ownMetrics = useMemoF(() => {
    const start = data?.weekStart || LB.socialWeekStartISO(new Date(), store.settings?.weekStartDay);
    const end = new Date(`${start}T12:00:00`);
    end.setDate(end.getDate() + 7);
    const fullEndISO = LB.fmtISO(end);
    const todayISO = LB.todayISO();
    const logs = (store.dailyLogs || []).filter(l => l.date >= start && l.date < fullEndISO);
    const sessions = (store.sessions || []).filter(s => {
      const date = String(s.date || '').slice(0, 10);
      return date >= start && date < fullEndISO && s.ended;
    });
    const adherenceValues = logs.filter(l => l.date < todayISO).map(l => Number(l.adherence)).filter(Number.isFinite);
    return {
      steps: logs.some(l => l.steps != null) ? logs.reduce((sum, l) => sum + (Number(l.steps) || 0), 0) : null,
      workouts: sessions.length ? sessions.length : null,
      adherence: adherenceValues.length ? Math.round((adherenceValues.reduce((a, b) => a + b, 0) / adherenceValues.length) * 10) / 10 : null,
    };
  }, [store.dailyLogs, store.sessions, data?.weekStart, store.settings?.weekStartDay, LB.todayISO()]);

  const leaderboard = (metric, groupId = null) => {
    const rows = (groupId
      ? groupMembers.filter(m => m.groupId === groupId).map(m => ({
        userId: m.userId, name: m.userId === userId ? (store.user?.name || 'You') : (m.name || m.handle || 'Group member'),
        value: m.userId === userId ? ownMetrics[metric] : m[metric], own: m.userId === userId,
      }))
      : [
        { userId, name: store.user?.name || 'You', value: ownMetrics[metric], own: true },
        ...friends.map(f => ({ userId: f.userId, name: f.name || f.handle || 'Friend', value: f[metric], own: false })),
      ]).filter(row => row.value != null);
    return rows.sort((a, b) => Number(b.value) - Number(a.value));
  };

  const friendById = id => friends.find(f => f.userId === id) || null;
  const groupById = id => groups.find(g => g.id === id) || null;
  const activeSchedule = (store.schedules || []).find(s => s.id === planId) || store.schedules?.[0] || null;

  const activeChat = selectedChat;
  const activeFriend = activeChat?.type === 'friend' ? friendById(activeChat.id) : null;
  const activeGroup = activeChat?.type === 'group' ? groupById(activeChat.id) : null;
  const chatMessages = activeChat ? messages.filter(m => activeChat.type === 'group'
    ? m.groupId === activeChat.id
    : !m.groupId && ((m.senderId === userId && m.recipientId === activeChat.id) || (m.senderId === activeChat.id && m.recipientId === userId))) : [];
  const unreadForConversation = (type, id) => messages.filter(m => {
    if (m.senderId === userId || (data?.readMessageIds || []).includes(m.id)) return false;
    return type === 'group'
      ? m.groupId === id
      : !m.groupId && ((m.senderId === id && m.recipientId === userId) || (m.senderId === userId && m.recipientId === id));
  }).length;

  const canModifyMessage = message => {
    const createdAt = Date.parse(message?.createdAt || '');
    return Number.isFinite(createdAt) && Date.now() - createdAt <= 60 * 60 * 1000;
  };

  const messageWindowError = 'Messages can only be edited or deleted within 60 minutes of sending.';

  useEffectF(() => {
    if (activeTab !== 'chats' || !activeChat) return;
    const unread = chatMessages.filter(m => m.senderId !== userId && !(data?.readMessageIds || []).includes(m.id));
    if (!unread.length) return;
    LB.markSocialMessagesRead(userId, unread.map(m => m.id)).then(() => {
      patchSocial(s => ({
        ...s,
        readMessageIds: [...new Set([...(s.readMessageIds || []), ...unread.map(m => m.id)])],
        unreadCount: Math.max(0, (s.unreadCount || 0) - unread.length),
      }));
    }).catch(() => {});
  }, [activeTab, activeChat?.type, activeChat?.id, messages.length]);

  const sendMessage = async () => {
    if (!activeChat || sending || (!messageBody.trim() && !messageFile)) return;
    setSending(true);
    const body = messageBody.trim() || '[image]';
    const file = messageFile;
    setMessageBody('');
    setMessageFile(null);
    try {
      const message = await LB.sendSocialMessage({
        senderId: userId,
        recipientId: activeChat.type === 'friend' ? activeChat.id : null,
        groupId: activeChat.type === 'group' ? activeChat.id : null,
        body,
      });
      patchSocial(s => ({ ...s, messages: [...(s.messages || []), message] }));
      if (file) {
        try {
          const attachment = await LB.uploadSocialAttachment(file, userId, message.id);
          patchSocial(s => ({
            ...s,
            messages: (s.messages || []).map(m => m.id === message.id ? { ...m, attachments: [attachment] } : m),
          }));
        } catch (e) {
          try { await LB.deleteSocialMessage(message.id, userId); } catch (_) {}
          patchSocial(s => ({ ...s, messages: (s.messages || []).filter(m => m.id !== message.id) }));
          setError(e.message || 'Image upload failed. The message was removed.');
        }
      }
    } catch (e) {
      setMessageBody(body === '[image]' ? '' : body);
      setMessageFile(file);
      setError(e.message || 'Message failed to send');
    } finally {
      setSending(false);
    }
  };

  const beginEditMessage = message => {
    if (!canModifyMessage(message)) {
      setError(messageWindowError);
      return;
    }
    setEditingMessageId(message.id);
    setEditingMessageBody(message.body === '[image]' ? '' : message.body || '');
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingMessageBody('');
  };

  const saveEditedMessage = async message => {
    if (messageActionBusy || !editingMessageBody.trim()) return;
    if (!canModifyMessage(message)) {
      setError(messageWindowError);
      cancelEditMessage();
      return;
    }
    setMessageActionBusy(true);
    try {
      const updated = await LB.updateSocialMessage(message.id, userId, editingMessageBody);
      patchSocial(s => ({
        ...s,
        messages: (s.messages || []).map(m => m.id === message.id ? {
          ...m,
          ...updated,
          // The update response intentionally contains no attachment rows.
          // Preserve previews already loaded into the local social slice.
          attachments: updated.attachments?.length ? updated.attachments : m.attachments,
        } : m),
      }));
      cancelEditMessage();
    } catch (e) {
      setError(e.message || 'Could not edit message');
    } finally {
      setMessageActionBusy(false);
    }
  };

  const removeMessage = async message => {
    if (messageActionBusy) return;
    if (!canModifyMessage(message)) {
      setError(messageWindowError);
      return;
    }
    if (!await confirm('Delete this message?', { title: 'Delete message', ok: 'Delete', danger: true })) return;
    setMessageActionBusy(true);
    try {
      await LB.deleteSocialMessage(message.id, userId);
      patchSocial(s => ({ ...s, messages: (s.messages || []).filter(m => m.id !== message.id) }));
      if (editingMessageId === message.id) cancelEditMessage();
    } catch (e) {
      setError(e.message || 'Could not delete message');
    } finally {
      setMessageActionBusy(false);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim() || groupBusy) return;
    setGroupBusy(true);
    await runAction(async () => { await LB.createSocialGroup(groupName.trim()); setGroupName(''); }, 'groups');
    setGroupBusy(false);
  };

  const joinGroup = async () => {
    if (!joinCode.trim() || groupBusy) return;
    setGroupBusy(true);
    await runAction(async () => { await LB.joinSocialGroup(joinCode.trim()); setJoinCode(''); }, 'groups');
    setGroupBusy(false);
  };

  const leaveGroup = async group => {
    if (!await confirm(`Leave ${group.name}?`, { title: 'Leave group', ok: 'Leave', danger: true })) return;
    await runAction(() => LB.leaveSocialGroup(group.id), 'groups');
    if (activeChat?.id === group.id) setSelectedChat(null);
  };

  const deleteGroup = async group => {
    if (group.ownerId !== userId || !await confirm(`Delete ${group.name}? This removes its members and messages.`, { title: 'Delete group', ok: 'Delete', danger: true })) return;
    await runAction(() => LB.deleteSocialGroup(group.id), 'groups');
    if (activeChat?.id === group.id) setSelectedChat(null);
  };

  const copyGroupCode = async group => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(group.joinCode);
      } else {
        const input = document.createElement('textarea');
        input.value = group.joinCode;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        try {
          input.select();
          if (!document.execCommand('copy')) throw new Error('Copy unavailable');
        } finally {
          input.remove();
        }
      }
      setCopiedGroupId(group.id);
      window.setTimeout(() => setCopiedGroupId(current => current === group.id ? null : current), 1600);
    } catch (e) {
      setError(`Could not copy the code. Enter it manually: ${group.joinCode}`);
    }
  };

  const copyOwnFriendCode = async () => {
    const code = data?.profile?.friendCode;
    if (!code) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
      else {
        const input = document.createElement('textarea');
        input.value = code;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        try {
          input.select();
          if (!document.execCommand('copy')) throw new Error('Copy unavailable');
        } finally {
          input.remove();
        }
      }
      setCopiedOwnCode(true);
      window.setTimeout(() => setCopiedOwnCode(false), 1600);
    } catch (_) {
      setError('Could not copy your friend code.');
    }
  };

  const sendPlan = async () => {
    if (!planRecipientId || !activeSchedule || planBusy) return;
    setPlanBusy(true);
    try {
      // A schedule only stores exercise ids. Include the referenced exercise
      // rows as part of the immutable share, otherwise a receiver gets days
      // whose items point at an exercise library they do not have.
      const schedule = JSON.parse(JSON.stringify(activeSchedule));
      delete schedule.user_id;
      delete schedule.userId;
      delete schedule.id;
      delete schedule.versions;
      const exerciseIds = new Set();
      (schedule.days || []).forEach(day => (day.items || []).forEach(item => {
        if (item.exId) exerciseIds.add(item.exId);
      }));
      const exercises = (store.exercises || []).filter(ex => exerciseIds.has(ex.id));
      const snapshot = { type: 'zane-plan', version: 1, schedule, exercises };
      const sharedPlanName = socialSanitizeImportedLabel(activeSchedule.name, 120) || 'Shared plan';
      if (planRecipientType === 'group') {
        await LB.createSocialGroupPlanShare(planRecipientId, sharedPlanName, snapshot);
      } else {
        await LB.createSocialPlanShare(planRecipientId, sharedPlanName, snapshot);
      }
      await reload();
      setPlanRecipientId('');
    } catch (e) {
      setError(e.message || 'Plan could not be shared');
    } finally {
      setPlanBusy(false);
    }
  };

  const importPlanOnce = async share => {
    if (!share?.id) {
      setError('This shared plan is missing its receipt id.');
      return;
    }
    if (socialPlanAlreadyImported(share, importedPlanReceipts)) return;
    const source = share.snapshot && typeof share.snapshot === 'object' ? share.snapshot : null;
    if (!source) return;
    let sourceBytes = 0;
    try { sourceBytes = JSON.stringify(source).length; } catch (_) { sourceBytes = SOCIAL_PLAN_IMPORT_LIMITS.bytes + 1; }
    if (sourceBytes > SOCIAL_PLAN_IMPORT_LIMITS.bytes) {
      setError('This shared plan is too large to import.');
      return;
    }
    const sourceSchedule = source.schedule && typeof source.schedule === 'object' && !Array.isArray(source.schedule) ? source.schedule : source;
    const sourceExercises = Array.isArray(source.exercises) ? source.exercises.slice(0, SOCIAL_PLAN_IMPORT_LIMITS.exercises) : [];
    const existingByName = new Map((store.exercises || []).map(ex => [String(ex.name || '').trim().toLowerCase(), ex]));
    const idMap = Object.create(null);
    const newExercises = [];
    sourceExercises.forEach(ex => {
      if (!ex || typeof ex !== 'object' || Array.isArray(ex) || !ex.id || !String(ex.name || '').trim()) return;
      const sourceId = String(ex.id);
      if (sourceId.length > 200 || Object.prototype.hasOwnProperty.call(idMap, sourceId)) return;
      const name = socialSanitizeImportedLabel(String(ex.name), 120);
      if (!name) return;
      const nameKey = name.toLowerCase();
      const existing = existingByName.get(nameKey);
      if (existing) {
        idMap[sourceId] = existing.id;
        return;
      }
      const id = LB.uid();
      idMap[sourceId] = id;
      const importedExercise = {
        id, name,
        tags: socialBoundStringArray(ex.tags, 20, 40),
        note: socialBoundText(ex.note, 2000),
        category: socialSanitizeImportedLabel(ex.category, 80) || null,
        unilateral: !!ex.unilateral,
        equipment: socialSanitizeImportedLabel(ex.equipment, 80) || null,
        progression_reps: socialFiniteNumber(ex.progression_reps, 0, 1000),
        movement_type: socialSanitizeImportedLabel(ex.movement_type, 40) || null,
        log_mode: socialSanitizeImportedLabel(ex.log_mode, 40) || null,
        no_weight_reps: !!ex.no_weight_reps,
        pull_bodyweight: !!ex.pull_bodyweight,
        bodyweight_mode: socialSanitizeImportedLabel(ex.bodyweight_mode, 40) || null,
        youtube_url: LB.sanitizeYoutubeUrl(ex.youtube_url),
        note_pinned: !!ex.note_pinned,
        progression_increment: socialFiniteNumber(ex.progression_increment, 0, 1000),
        horn_labels: socialBoundStringArray(ex.horn_labels, 12, 80),
      };
      newExercises.push(importedExercise);
      existingByName.set(nameKey, importedExercise);
    });
    const safeSchedule = socialSanitizePlanSchedule(sourceSchedule, idMap);
    if (!safeSchedule) {
      setError('This shared plan has an invalid schedule.');
      return;
    }
    const imported = {
      ...safeSchedule,
      id: LB.uid(),
      name: `${socialSanitizeImportedLabel(share.planName, 120) || safeSchedule.name || 'Shared plan'} (shared)`.slice(0, 140),
      archived: false,
      is_template: false,
    };
    imported.program_data = socialSanitizeProgramData(sourceSchedule.program_data, idMap);
    delete imported.versions;
    delete imported.user_id;
    delete imported.userId;
    let importResult;
    try {
      // The server claim and every plan row land in one transaction before the
      // local store changes. A concurrent device therefore either owns the
      // import or receives the exact schedule id that already won.
      importResult = await LB.importSocialPlanShareAtomically(share.id, imported, newExercises);
    } catch (e) {
      setError('Plan could not be imported. Please try again.');
      return;
    }
    let scheduleToStore = imported;
    let exercisesToStore = newExercises;
    if (!importResult.imported) {
      try {
        const persisted = await LB.loadImportedSocialPlan(importResult.scheduleId);
        if (!persisted?.schedule) throw new Error('Imported plan was not found');
        scheduleToStore = persisted.schedule;
        exercisesToStore = persisted.exercises || [];
      } catch (_) {
        setError('This plan was imported on another device. Reload plans to see it here.');
        return;
      }
    }
    const importedAt = new Date().toISOString();
    socialRememberImportedPlanReceipt(socialBrowserStorage(), userId, share.id, importedPlanReceipts);
    patchSocial(s => ({ ...s, planShares: (s.planShares || []).map(planShare => planShare.id === share.id ? { ...planShare, importedAt } : planShare) }));
    setStore(s => socialMergeImportedPlan(s, scheduleToStore, exercisesToStore));
  };

  const importPlan = async share => {
    const shareId = share?.id ? String(share.id) : '';
    if (shareId && importingPlanIdsRef.current.has(shareId)) return;
    if (shareId) importingPlanIdsRef.current.add(shareId);
    try {
      await importPlanOnce(share);
    } finally {
      if (shareId) importingPlanIdsRef.current.delete(shareId);
    }
  };

  const deletePlanShare = async share => {
    const sender = share.senderId === userId;
    const action = sender ? 'Take back' : 'Delete';
    if (!await confirm(`${action} this shared plan?`, { title: `${action} shared plan`, ok: action, danger: true })) return;
    await runAction(() => LB.deleteSocialPlanShare(share.id), 'plans');
  };

  const submitReport = async () => {
    if (!reportTarget || reportBusy) return;
    setReportBusy(true);
    try {
      await LB.reportSocial({ targetUserId: reportTarget.userId, reason: reportReason, details: reportDetails });
      setReportTarget(null); setReportDetails(''); setReportReason('other');
    } catch (e) {
      setError(e.message || 'Report failed');
    } finally {
      setReportBusy(false);
    }
  };

  const blockFriend = async friend => {
    if (!await confirm(`Block ${friend.name || 'this user'}? This also removes the friendship.`, { title: 'Block friend', ok: 'Block', danger: true })) return;
    await runAction(() => LB.blockSocialUser(friend.userId));
    if (activeChat?.id === friend.userId) setSelectedChat(null);
    if (selectedFriend?.userId === friend.userId) setSelectedFriend(null);
  };

  const removeFriend = async friend => {
    if (!await confirm(`Remove ${friend.name || 'this user'} from your circle?`, { title: 'Remove friend', ok: 'Remove', danger: true })) return;
    await runAction(() => LB.removeSocialFriend(friend.userId));
    if (selectedFriend?.userId === friend.userId) setSelectedFriend(null);
  };

  if (!data?.loadedAt) {
    return (
      <Screen scroll={false}>
        <TopBar title="Friends" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 }}>
          <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>{error ? 'Friends could not be loaded.' : 'Loading Friends...'}</div>
          {error && <div style={{ maxWidth: 300, color: UI.danger, fontFamily: UI.fontUi, fontSize: 11, lineHeight: 1.4, textAlign: 'center' }}>{error}</div>}
          {!loading && <Btn kind="ghost" onClick={reload}>Retry</Btn>}
        </div>
      </Screen>
    );
  }

  const renderSearch = () => (
    <Card style={{ marginBottom: 12 }}>
      <div className="micro" style={{ color: UI.gold, marginBottom: 10 }}>ADD A FRIEND</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="friends-add-input" value={query} onChange={e => { setQuery(e.target.value); setSearchResult(null); setSearchComplete(false); setError(''); }} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Handle or friend code" style={{ ...SOCIAL_INPUT_STYLE, flex: 1 }} />
        <Btn onClick={search} disabled={searching || !query.trim()} style={{ padding: '10px 12px', minHeight: 0, fontSize: 10 }}>{searching ? '...' : 'Find'}</Btn>
      </div>
      {searchResult && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 12, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>{searchResult.name}</div>
            <div className="micro" style={{ marginTop: 3 }}>{searchResult.handle ? `@${searchResult.handle.replace(/^@/, '')}` : searchResult.friendCode}</div>
          </div>
          {searchResult.relationship === 'none'
            ? <Btn onClick={addSearchResultAsFriend} disabled={friendRequestBusy} style={{ padding: '9px 12px', minHeight: 0, fontSize: 10 }}>{friendRequestBusy ? '...' : 'Add'}</Btn>
            : <span className="micro" style={{ color: UI.gold }}>{searchResult.relationship}</span>}
        </div>
      )}
      {searchComplete && !searching && !searchResult && !error && (
        <div className="micro" style={{ color: UI.inkFaint, marginTop: 12, paddingTop: 12, borderTop: `var(--hair-width) solid ${UI.hair}` }}>No person found for that handle or code.</div>
      )}
    </Card>
  );

  const renderRequests = () => incoming.length === 0 ? null : (
    <Card style={{ marginBottom: 12 }}>
      <div className="micro" style={{ color: UI.gold, marginBottom: 8 }}>FRIEND REQUESTS</div>
      {incoming.map((request, i) => (
        <div key={request.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: i ? `var(--hair-width) solid ${UI.hair}` : 'none' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 13 }}>{request.name || 'Zane athlete'}</div>
            <div className="micro" style={{ marginTop: 3 }}>{request.handle ? `@${request.handle.replace(/^@/, '')}` : 'wants to connect'}</div>
          </div>
          <button onClick={() => runAction(() => LB.respondToSocialFriendRequest(request.id, false))} style={{ padding: '7px 10px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkFaint, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 10 }}>Decline</button>
          <Btn onClick={() => runAction(() => LB.respondToSocialFriendRequest(request.id, true))} style={{ padding: '7px 10px', minHeight: 0, fontSize: 10 }}>Accept</Btn>
        </div>
      ))}
    </Card>
  );

  const renderFriend = friend => (
    <Card key={friend.userId} style={{ padding: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) repeat(3, minmax(0, 1fr)) 30px', gap: 4, alignItems: 'center' }}>
        <button type="button" onClick={() => setSelectedFriend(friend)} style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: 3, border: 'none', background: 'transparent', color: UI.ink, textAlign: 'left', cursor: 'pointer' }} aria-label={`View shared metrics for ${friend.name || 'friend'}`}>
          <div style={{ width: 30, height: 30, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(var(--accent-rgb),0.15)', border: `var(--hair-width) solid ${UI.hairStrong}`, color: UI.gold, fontFamily: UI.fontUi, fontWeight: 700 }}>{(friend.name || 'Z')[0].toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.ink, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{friend.name || 'Zane athlete'}</div>
            <div className="micro" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{friend.handle ? `@${friend.handle.replace(/^@/, '')}` : friend.friendCode}</div>
          </div>
        </button>
        {metricSlots.map((_, slotIndex) => {
          const metric = displayedFriendMetric(friend, slotIndex);
          const value = socialFriendMetricValue(friend, metric);
          return <div key={`${metric}-${slotIndex}`} style={{ minWidth: 0, padding: '6px 3px', background: UI.bgInset, borderRadius: 4, textAlign: 'center' }}>
            <div className="micro" style={{ color: UI.gold, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{socialMetricLabel(metric)}</div>
            <div style={{ fontFamily: UI.fontNum, fontSize: 10, color: value == null ? UI.inkGhost : UI.inkSoft, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{socialMetricValue(metric, value, { settings: store.settings, weightUnit: friend.weightUnit }) || 'No data'}</div>
          </div>;
        })}
        <button onClick={() => { setSelectedChat({ type: 'friend', id: friend.userId }); setActiveTab('chats'); }} style={{ width: 30, height: 30, borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.gold, cursor: 'pointer' }} aria-label="Message friend"><i className="fa-solid fa-comment" /></button>
      </div>
    </Card>
  );

  const renderWorkoutCard = workout => (
    <Card key={workout.sessionId} style={{ padding: 13, borderColor: workout.live ? UI.goldSoft : UI.hairStrong }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', background: workout.live ? UI.goldFaint : UI.bgInset, border: `var(--hair-width) solid ${workout.live ? UI.goldSoft : UI.hairStrong}`, color: workout.live ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, fontWeight: 700 }}>{(workout.ownerName || 'Z')[0].toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
            <span style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>{workout.ownerName}</span>
            {workout.live && <span className="micro" style={{ color: UI.gold }}>LIVE</span>}
          </div>
          <div className="micro" style={{ marginTop: 3, color: UI.inkFaint }}>{workout.dayName || 'Workout'} · {workout.live ? 'now' : socialDate(workout.ended || workout.date)}</div>
        </div>
        <Btn onClick={() => setSelectedWorkout(workout)} style={{ padding: '8px 10px', minHeight: 0, fontSize: 10 }}>{workout.live ? 'Watch' : 'View'}</Btn>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
        <span className="num" style={{ color: UI.inkSoft, fontSize: 11 }}>{workout.setsDone}/{workout.setsTotal || '—'} sets</span>
        <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>{workout.exerciseCount} exercises</span>
      </div>
    </Card>
  );

  const renderCircle = () => (
    <>
      <div style={{ position: 'relative', overflow: 'hidden', padding: 18, borderRadius: 8, border: `var(--hair-width) solid ${UI.goldSoft}`, background: `linear-gradient(135deg, rgba(var(--accent-rgb),0.18), ${UI.bgRaised} 72%)`, marginBottom: 16 }}>
        <div style={{ position: 'absolute', width: 190, height: 190, borderRadius: '50%', border: `var(--hair-width) solid rgba(var(--accent-rgb),0.18)`, right: -70, top: -84, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', width: 122, height: 122, borderRadius: '50%', border: `var(--hair-width) solid rgba(var(--accent-rgb),0.18)`, right: -28, top: -50, pointerEvents: 'none' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div className="micro" style={{ color: UI.gold, fontWeight: 700 }}>YOUR CIRCLE</div>
          <button onClick={openMetricPicker} style={{ padding: '5px 8px', borderRadius: 4, border: `var(--hair-width) solid ${UI.goldSoft}`, background: 'transparent', color: UI.gold, fontFamily: UI.fontUi, fontSize: 9, letterSpacing: '0.06em', cursor: 'pointer' }}>EDIT METRICS</button>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 9 }}>
          <div>
            <div className="display" style={{ color: UI.ink, fontSize: 31, lineHeight: 1 }}>FRIENDS</div>
            <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.45, marginTop: 9, maxWidth: 250 }}>Train together, keep each other moving.</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="num" style={{ color: UI.gold, fontSize: 28, lineHeight: 1 }}>{friends.length}</div>
            <div className="micro" style={{ color: UI.inkFaint, marginTop: 5 }}>{friends.length === 1 ? 'CONNECTION' : 'CONNECTIONS'}</div>
          </div>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginTop: 17 }}>
          <div style={{ display: 'flex', paddingLeft: 2 }}>
            {friends.slice(0, 6).map((friend, index) => <div key={friend.userId} style={{ width: 30, height: 30, marginLeft: index ? -7 : 0, borderRadius: '50%', display: 'grid', placeItems: 'center', background: index % 2 ? UI.bgRaised : UI.goldFaint, border: `2px solid ${UI.bg}`, color: index % 2 ? UI.inkSoft : UI.gold, fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700 }}>{socialInitials(friend.name)}</div>)}
            {!friends.length && <div className="micro" style={{ color: UI.inkFaint }}>Your circle is waiting.</div>}
          </div>
          {liveWorkouts.length > 0 && <span className="micro" style={{ marginLeft: 'auto', color: UI.gold }}>{liveWorkouts.length} LIVE NOW</span>}
        </div>
        {data?.profile && <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 11, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
          <div style={{ minWidth: 0 }}>
            <div className="micro" style={{ color: UI.inkFaint }}>YOUR FRIEND HANDLE</div>
            <div className="num" style={{ color: data.profile.handle ? UI.inkSoft : UI.inkFaint, fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.profile.handle ? `@${String(data.profile.handle).replace(/^@/, '')}` : 'Not set'}</div>
          </div>
          <div style={{ minWidth: 0, textAlign: 'right' }}>
            <div className="micro" style={{ color: UI.inkFaint }}>YOUR FRIEND CODE</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 3 }}>
              <span className="num" style={{ color: data.profile.friendCode ? UI.inkSoft : UI.inkFaint, fontSize: 11, letterSpacing: '0.08em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.profile.friendCode || 'Not available'}</span>
              {data.profile.friendCode && <button onClick={copyOwnFriendCode} style={{ padding: '4px 7px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.gold, fontFamily: UI.fontUi, fontSize: 9, cursor: 'pointer', flexShrink: 0 }}>{copiedOwnCode ? 'Copied' : 'Copy'}</button>}
            </div>
          </div>
        </div>}
        <div style={{ position: 'relative', display: 'flex', gap: 7, marginTop: 17, flexWrap: 'wrap' }}>
          <Btn onClick={() => document.getElementById('friends-add-input')?.focus()} style={{ padding: '9px 12px', minHeight: 0, fontSize: 10 }}>Find people</Btn>
          <button onClick={() => setActiveTab('activity')} style={{ padding: '8px 11px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>See activity</button>
        </div>
      </div>
      {renderRequests()}
      <div>{renderSearch()}</div>
      <div className="micro" style={{ color: UI.gold, fontWeight: 700, margin: '19px 0 8px' }}>SOCIAL SPACES</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9 }}>
        <button onClick={() => setActiveTab('groups')} style={{ minWidth: 0, textAlign: 'left', padding: 13, borderRadius: 6, border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgRaised, color: UI.ink, cursor: 'pointer' }}>
          <i className="fa-solid fa-users" style={{ color: UI.gold, fontSize: 16 }} />
          <div style={{ fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, marginTop: 10 }}>Groups</div>
          <div className="micro" style={{ marginTop: 4 }}>{groups.length} {groups.length === 1 ? 'space' : 'spaces'}</div>
        </button>
        <button onClick={() => setActiveTab('plans')} style={{ minWidth: 0, textAlign: 'left', padding: 13, borderRadius: 6, border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgRaised, color: UI.ink, cursor: 'pointer' }}>
          <i className="fa-solid fa-share-nodes" style={{ color: UI.gold, fontSize: 16 }} />
          <div style={{ fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, marginTop: 10 }}>Plan swaps</div>
          <div className="micro" style={{ marginTop: 4 }}>{planShares.length} shared</div>
        </button>
      </div>
      <div className="micro" style={{ color: UI.gold, fontWeight: 700, margin: '19px 0 8px' }}>PEOPLE IN YOUR CIRCLE <span style={{ color: UI.inkFaint, fontWeight: 400 }}>· {friends.length}</span></div>
      {friends.length === 0
        ? <Empty title="No friends yet" sub="Search by handle or friend code to start your circle." />
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{friends.map(renderFriend)}</div>}
    </>
  );

  const renderActivity = () => (
    <>
      <div style={{ padding: 17, borderRadius: 8, border: `var(--hair-width) solid ${liveWorkouts.length ? UI.goldSoft : UI.hairStrong}`, background: liveWorkouts.length ? `linear-gradient(135deg, rgba(var(--accent-rgb),0.16), ${UI.bgRaised} 72%)` : UI.bgRaised, marginBottom: 16 }}>
        <div className="micro" style={{ color: UI.gold, fontWeight: 700 }}>CIRCLE ACTIVITY</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 9 }}>
          <div>
            <div className="display" style={{ color: UI.ink, fontSize: 27, lineHeight: 1 }}>IN MOTION</div>
            <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.45, marginTop: 8 }}>See what your people are doing right now and this week.</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}><div className="num" style={{ color: liveWorkouts.length ? UI.gold : UI.inkFaint, fontSize: 26, lineHeight: 1 }}>{liveWorkouts.length}</div><div className="micro" style={{ color: UI.inkFaint, marginTop: 5 }}>LIVE</div></div>
        </div>
      </div>
      <div className="micro" style={{ color: UI.gold, fontWeight: 700, margin: '8px 0' }}>LIVE NOW</div>
      {liveWorkouts.length > 0
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{liveWorkouts.map(renderWorkoutCard)}</div>
        : <Card style={{ padding: 15 }}><div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 13 }}>No one is training live right now.</div><div className="micro" style={{ marginTop: 5 }}>Shared finished workouts appear here from the day the friendship was accepted.</div></Card>}
      <div className="micro" style={{ color: UI.gold, fontWeight: 700, margin: '19px 0 8px' }}>THIS WEEK</div>
      <Card>
        <div style={{ fontSize: 12, color: UI.inkFaint, lineHeight: 1.45, marginBottom: 12, textAlign: 'center' }}>Only metrics explicitly shared by each person appear here. Missing values are never treated as zero.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7 }}>
          {['steps', 'workouts', 'adherence'].map(metric => {
            const top = leaderboard(metric)[0];
            return <div key={metric} style={{ minWidth: 0, padding: '10px 7px', borderRadius: 4, background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, textAlign: 'center' }}>
              <div className="micro" style={{ color: UI.gold, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{socialMetricLabel(metric)}</div>
              <div style={{ color: top ? UI.ink : UI.inkGhost, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, marginTop: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top?.name || 'No data'}</div>
              <div className="num" style={{ color: top ? UI.inkSoft : UI.inkGhost, fontSize: 10, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top ? socialMetricValue(metric, top.value) : '-'}</div>
            </div>;
          })}
        </div>
      </Card>
      {workoutHistory.length > 0 && <>
        <div className="micro" style={{ color: UI.gold, fontWeight: 700, margin: '19px 0 8px' }}>RECENT WORKOUTS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{workoutHistory.slice(0, 12).map(renderWorkoutCard)}</div>
      </>}
    </>
  );

  const conversationButton = (item, type, label, count = 0) => (
    <button key={`${type}-${item}`} onClick={() => setSelectedChat({ type, id: item })} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '10px 9px', borderRadius: 4, border: `var(--hair-width) solid ${activeChat?.type === type && activeChat?.id === item ? UI.gold : UI.hairStrong}`, background: activeChat?.type === type && activeChat?.id === item ? 'rgba(var(--accent-rgb),0.12)' : 'transparent', color: UI.ink, cursor: 'pointer', textAlign: 'left' }}>
      <i className={`fa-solid ${type === 'group' ? 'fa-users' : 'fa-user'}`} style={{ width: 16, color: UI.gold, fontSize: 12 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: UI.fontUi, fontSize: 12 }}>{label}</span>
      {count > 0 && <span style={{ minWidth: 17, height: 17, borderRadius: '50%', display: 'grid', placeItems: 'center', background: UI.gold, color: 'var(--accent-ink)', fontSize: 9, fontWeight: 700 }}>{count}</span>}
    </button>
  );

  const renderChatsRedesigned = () => {
    const conversationList = (
      <>
        <div className="micro" style={{ color: UI.gold, marginBottom: 9 }}>INBOX</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {friends.map(friend => conversationButton(friend.userId, 'friend', friend.name || friend.handle || 'Friend', unreadForConversation('friend', friend.userId)))}
          {groups.map(group => conversationButton(group.id, 'group', group.name, unreadForConversation('group', group.id)))}
        </div>
        {!friends.length && !groups.length && <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.4 }}>Add a friend or create a group to start a conversation.</div>}
      </>
    );

    if (!activeChat) return (
      <>
        <div style={{ padding: 17, borderRadius: 8, border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgRaised, marginBottom: 14 }}>
          <div className="micro" style={{ color: UI.gold }}>MESSAGES</div>
          <div className="display" style={{ color: UI.ink, fontSize: 27, lineHeight: 1, marginTop: 9 }}>STAY IN TOUCH</div>
          <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.45, marginTop: 8 }}>Pick a person or group. Your conversation opens full width so the thread stays readable on mobile.</div>
        </div>
        <Card style={{ padding: 14 }}>{conversationList}</Card>
      </>
    );

    return (
      <>
        <button onClick={() => setSelectedChat(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: 0, margin: '0 0 9px', border: 'none', background: 'none', color: UI.gold, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer' }}><i className="fa-solid fa-arrow-left" /> Conversations</button>
        <Card style={{ padding: 0, overflow: 'hidden', background: UI.bgInset, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', borderBottom: `var(--hair-width) solid ${UI.hair}` }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', display: 'grid', placeItems: 'center', background: activeGroup ? UI.goldFaint : 'rgba(var(--accent-rgb),0.15)', border: `var(--hair-width) solid ${UI.goldSoft}`, color: UI.gold, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700 }}>{socialInitials(activeFriend?.name || activeGroup?.name)}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeFriend?.name || activeGroup?.name || 'Conversation'}</div>
              <div className="micro" style={{ marginTop: 3 }}>{activeGroup ? 'GROUP CHAT' : 'DIRECT MESSAGE'}</div>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!chatMessages.length && <div className="micro" style={{ margin: 'auto', color: UI.inkFaint }}>Start the conversation.</div>}
            {chatMessages.map(message => {
              const own = message.senderId === userId;
              const editing = editingMessageId === message.id;
              const modifiable = own && canModifyMessage(message);
              return <div key={message.id} style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '88%', display: 'flex', flexDirection: 'column', alignItems: own ? 'flex-end' : 'flex-start' }}>
                <div style={{ padding: '9px 11px', borderRadius: 6, background: own ? 'rgba(var(--accent-rgb),0.18)' : UI.bgRaised, border: `var(--hair-width) solid ${own ? UI.goldSoft : UI.hairStrong}`, color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.45 }}>
                  {editing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 190 }}>
                      <textarea value={editingMessageBody} onChange={e => setEditingMessageBody(e.target.value)} rows={3} autoFocus
                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEditedMessage(message); } }}
                        style={{ ...SOCIAL_INPUT_STYLE, width: '100%', minHeight: 68, resize: 'vertical', padding: '7px 8px', fontSize: 12 }} />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 5 }}>
                        <button onClick={cancelEditMessage} disabled={messageActionBusy} style={{ background: 'transparent', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Cancel</button>
                        <Btn onClick={() => saveEditedMessage(message)} disabled={messageActionBusy || !editingMessageBody.trim()} style={{ minHeight: 26, padding: '4px 8px', fontSize: 10 }}>{messageActionBusy ? '...' : 'Save'}</Btn>
                      </div>
                    </div>
                  ) : <>
                    {message.body !== '[image]' && <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.body}</div>}
                    {message.attachments?.map(attachment => attachment.url ? <img key={attachment.id} src={attachment.url} alt={attachment.fileName || 'Attachment'}
                      /* The signed URL expires after five minutes and a thread
                         left open never re-signs, so a remount or a cache miss
                         past that point loads a dead URL. Re-sign once on that
                         failure rather than handing out longer-lived URLs. */
                      onError={e => {
                        const img = e.currentTarget;
                        if (img.dataset.resigned) return;
                        img.dataset.resigned = '1';
                        LB.resignSocialAttachment(attachment.id).then(url => { if (url) img.src = url; }).catch(() => {});
                      }}
                      style={{ display: 'block', maxWidth: 190, maxHeight: 190, borderRadius: 4, marginTop: message.body !== '[image]' ? 6 : 0, objectFit: 'cover' }} /> : <span key={attachment.id}>Image</span>)}
                    {message.body === '[image]' && !message.attachments?.length && <span>Image</span>}
                  </>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                  <span className="micro" style={{ color: UI.inkGhost }}>{socialTime(message.createdAt)}{message.editedAt ? ' · edited' : ''}</span>
                  {modifiable && !editing && <>
                    {message.body !== '[image]' && <button onClick={() => beginEditMessage(message)} disabled={messageActionBusy} style={{ background: 'none', border: 'none', padding: 0, color: UI.gold, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Edit</button>}
                    <button onClick={() => removeMessage(message)} disabled={messageActionBusy} style={{ background: 'none', border: 'none', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Delete</button>
                  </>}
                </div>
              </div>;
            })}
          </div>
          <div style={{ padding: 9, borderTop: `var(--hair-width) solid ${UI.hair}`, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
            {messageFile && <div className="micro" style={{ color: UI.gold }}>Attached: {messageFile.name}</div>}
            <div style={{ display: 'flex', gap: 6 }}>
              <textarea value={messageBody} onChange={e => setMessageBody(e.target.value)} rows={2} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Message" style={{ ...SOCIAL_INPUT_STYLE, flex: 1, minHeight: 34, resize: 'vertical', padding: '8px 10px' }} />
              <label style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, color: UI.inkFaint, cursor: 'pointer', flexShrink: 0 }} aria-label="Attach image"><i className="fa-solid fa-image" /><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => { setMessageFile(e.target.files?.[0] || null); e.target.value = ''; }} style={{ display: 'none' }} /></label>
              <Btn onClick={sendMessage} disabled={sending || (!messageBody.trim() && !messageFile)} style={{ padding: '8px 10px', minHeight: 34, fontSize: 10 }}>{sending ? '...' : 'Send'}</Btn>
            </div>
          </div>
        </Card>
      </>
    );
  };

  const renderGroupsLegacy = () => (
    <>
      <button onClick={() => setActiveTab('circle')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: 0, margin: '0 0 10px', border: 'none', background: 'none', color: UI.gold, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer' }}><i className="fa-solid fa-arrow-left" /> Circle</button>
      <Card style={{ marginBottom: 12 }}>
        <div className="micro" style={{ color: UI.gold, marginBottom: 9 }}>CREATE GROUP</div>
        <div style={{ display: 'flex', gap: 8 }}><input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" style={{ ...SOCIAL_INPUT_STYLE, flex: 1 }} /><Btn onClick={createGroup} disabled={groupBusy || !groupName.trim()} style={{ padding: '10px 11px', minHeight: 0, fontSize: 10 }}>Create</Btn></div>
        <div className="micro" style={{ color: UI.inkFaint, margin: '12px 0 8px' }}>JOIN WITH CODE</div>
        <div style={{ display: 'flex', gap: 8 }}><input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Group code" style={{ ...SOCIAL_INPUT_STYLE, flex: 1 }} /><Btn onClick={joinGroup} disabled={groupBusy || !joinCode.trim()} style={{ padding: '10px 11px', minHeight: 0, fontSize: 10 }}>Join</Btn></div>
      </Card>
      <div className="micro" style={{ color: UI.gold, margin: '8px 0' }}>YOUR GROUPS</div>
      {groups.length === 0 ? <Empty title="No groups yet" sub="Create a private group or join one with a code." /> : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{groups.map(group => {
        const members = groupMembers.filter(m => m.groupId === group.id);
        return <Card key={group.id} style={{ padding: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ flex: 1 }}><div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600 }}>{group.name}</div><div className="micro" style={{ marginTop: 3 }}>{members.length} members · code {group.joinCode}</div></div><button onClick={() => { setSelectedChat({ type: 'group', id: group.id }); setActiveTab('chats'); }} style={{ width: 32, height: 32, borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.gold, cursor: 'pointer' }}><i className="fa-solid fa-comment" /></button></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}><span className="micro" style={{ color: UI.inkFaint }}>GROUP CODE</span><span className="num" style={{ flex: 1, color: UI.inkSoft, fontSize: 11, letterSpacing: '0.08em' }}>{group.joinCode}</span><button onClick={() => copyGroupCode(group)} aria-label={`Copy code for ${group.name}`} style={{ padding: '4px 7px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.gold, fontFamily: UI.fontUi, fontSize: 9, cursor: 'pointer' }}>{copiedGroupId === group.id ? 'Copied' : 'Copy'}</button></div>
            <div style={{ marginTop: 12 }}><div className="micro" style={{ color: UI.inkFaint, marginBottom: 5 }}>WEEKLY LEADERS</div>{['steps', 'workouts', 'adherence'].map(metric => { const rows = leaderboard(metric, group.id); if (!rows.length) return null; const top = rows[0]; return <div key={metric} style={{ display: 'grid', gridTemplateColumns: 'minmax(74px, auto) minmax(0, 1fr) max-content', gap: 8, alignItems: 'center', padding: '4px 0' }}><span className="micro" style={{ whiteSpace: 'nowrap' }}>{socialMetricLabel(metric)}</span><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11 }}>{top.name}</span><span className="num" style={{ whiteSpace: 'nowrap', fontSize: 11, color: UI.gold }}>{socialMetricValue(metric, top.value)}</span></div>; })}</div>
           {group.ownerId === userId ? <button onClick={() => deleteGroup(group)} style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, color: UI.danger, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Delete group</button> : <button onClick={() => leaveGroup(group)} style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, color: UI.danger, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Leave group</button>}
        </Card>;
      })}</div>}
    </>
  );

  const renderGroups = () => {
    const metrics = ['steps', 'workouts', 'adherence'];
    return (
      <>
        <button onClick={() => setActiveTab('circle')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: 0, margin: '0 0 10px', border: 'none', background: 'none', color: UI.gold, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer' }}><i className="fa-solid fa-arrow-left" /> Circle</button>
        <div style={{ position: 'relative', overflow: 'hidden', padding: 18, borderRadius: 8, border: `var(--hair-width) solid ${UI.goldSoft}`, background: `linear-gradient(135deg, rgba(var(--accent-rgb),0.18), ${UI.bgRaised} 72%)`, marginBottom: 16 }}>
          <div style={{ position: 'absolute', width: 150, height: 150, borderRadius: '50%', border: `var(--hair-width) solid rgba(var(--accent-rgb),0.18)`, right: -52, top: -62, pointerEvents: 'none' }} />
          <div className="micro" style={{ color: UI.gold, fontWeight: 700, position: 'relative' }}>GROUP TRAINING</div>
          <div className="display" style={{ color: UI.ink, fontSize: 29, lineHeight: 1, marginTop: 9, position: 'relative' }}>YOUR CREW</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, position: 'relative' }}>
            <span className="num" style={{ color: UI.gold, fontSize: 20 }}>{groups.length}</span>
            <span style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12 }}>{groups.length === 1 ? 'private space' : 'private spaces'} for your people</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9, marginBottom: 18 }}>
          <Card style={{ padding: 13, marginBottom: 0 }}>
            <div className="micro" style={{ color: UI.gold, marginBottom: 9 }}>CREATE GROUP</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}><input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" style={SOCIAL_INPUT_STYLE} /><Btn onClick={createGroup} disabled={groupBusy || !groupName.trim()} style={{ padding: '9px 11px', minHeight: 0, fontSize: 10 }}>Create group</Btn></div>
          </Card>
          <Card style={{ padding: 13, marginBottom: 0 }}>
            <div className="micro" style={{ color: UI.gold, marginBottom: 9 }}>JOIN A GROUP</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}><input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Paste group code" style={SOCIAL_INPUT_STYLE} /><Btn onClick={joinGroup} disabled={groupBusy || !joinCode.trim()} style={{ padding: '9px 11px', minHeight: 0, fontSize: 10 }}>Join group</Btn></div>
          </Card>
        </div>
        <div className="micro" style={{ color: UI.gold, fontWeight: 700, margin: '8px 0' }}>YOUR GROUPS <span style={{ color: UI.inkFaint, fontWeight: 400 }}>· {groups.length}</span></div>
        {groups.length === 0 ? <Empty title="No groups yet" sub="Create a private group or join one with a code." /> : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{groups.map(group => {
          const members = groupMembers.filter(m => m.groupId === group.id);
          const selected = expandedGroupMetric?.groupId === group.id ? expandedGroupMetric.metric : null;
          const selectedRows = selected ? leaderboard(selected, group.id) : [];
          return <Card key={group.id} style={{ padding: 15, background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.09), rgba(0,0,0,0.10))' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{ width: 40, height: 40, borderRadius: 6, display: 'grid', placeItems: 'center', background: UI.goldFaint, border: `var(--hair-width) solid ${UI.goldSoft}`, color: UI.gold, fontSize: 16 }}><i className="fa-solid fa-users" /></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</div><div className="micro" style={{ marginTop: 4 }}>{members.length} {members.length === 1 ? 'member' : 'members'}</div></div>
              <button onClick={() => { setSelectedChat({ type: 'group', id: group.id }); setActiveTab('chats'); }} aria-label={`Open ${group.name} chat`} style={{ width: 36, height: 36, borderRadius: 6, border: `var(--hair-width) solid ${UI.goldSoft}`, background: UI.goldFaint, color: UI.gold, cursor: 'pointer', flexShrink: 0 }}><i className="fa-solid fa-comment" /></button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13, padding: '8px 9px', borderRadius: 4, background: 'rgba(0,0,0,0.13)', border: `var(--hair-width) solid ${UI.hair}` }}>
              <span className="micro" style={{ color: UI.inkFaint }}>GROUP CODE</span><span className="num" style={{ flex: 1, minWidth: 0, color: UI.inkSoft, fontSize: 11, letterSpacing: '0.08em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.joinCode}</span><button onClick={() => copyGroupCode(group)} aria-label={`Copy code for ${group.name}`} style={{ padding: '5px 8px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.gold, fontFamily: UI.fontUi, fontSize: 9, cursor: 'pointer', flexShrink: 0 }}>{copiedGroupId === group.id ? 'Copied' : 'Copy'}</button>
            </div>
            <div className="micro" style={{ color: UI.inkFaint, margin: '15px 0 7px' }}>COMPARE THIS WEEK <span style={{ color: UI.inkGhost }}>· TAP A CATEGORY</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7 }}>
              {metrics.map(metric => {
                const rows = leaderboard(metric, group.id);
                const top = rows[0];
                const active = selected === metric;
                return <button key={metric} onClick={() => setExpandedGroupMetric(active ? null : { groupId: group.id, metric })} disabled={!rows.length} style={{ minWidth: 0, padding: '10px 7px', borderRadius: 4, border: `var(--hair-width) solid ${active ? UI.gold : UI.hairStrong}`, background: active ? UI.goldFaint : UI.bgInset, color: UI.ink, textAlign: 'center', cursor: rows.length ? 'pointer' : 'default', opacity: rows.length ? 1 : 0.62 }}>
                  <div className="micro" style={{ color: UI.gold, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{socialMetricLabel(metric)}</div>
                  <div style={{ color: top ? UI.inkSoft : UI.inkGhost, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top?.name || 'Private'}</div>
                  <div className="num" style={{ color: top ? UI.gold : UI.inkGhost, fontSize: 10, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top ? socialMetricValue(metric, top.value) : 'No shared data'}</div>
                </button>;
              })}
            </div>
            {selected && <div style={{ marginTop: 10, padding: '10px 11px', borderRadius: 4, border: `var(--hair-width) solid ${UI.goldSoft}`, background: 'rgba(var(--accent-rgb),0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}><div className="micro" style={{ color: UI.gold }}>{socialMetricLabel(selected)} LEADERBOARD</div><button onClick={() => setExpandedGroupMetric(null)} aria-label="Close leaderboard" style={{ border: 'none', background: 'none', color: UI.inkFaint, cursor: 'pointer' }}><i className="fa-solid fa-xmark" /></button></div>
              {!selectedRows.length && <div className="micro" style={{ color: UI.inkFaint, padding: '8px 0' }}>No members have shared this category.</div>}
              {selectedRows.map((row, index) => <div key={row.userId} style={{ display: 'grid', gridTemplateColumns: '22px 28px minmax(0, 1fr) max-content', gap: 8, alignItems: 'center', padding: '7px 0', borderTop: index ? `var(--hair-width) solid ${UI.hair}` : 'none' }}>
                <span className="num" style={{ color: index === 0 ? UI.gold : UI.inkFaint, fontSize: 11 }}>{index + 1}</span>
                <span style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', background: row.own ? UI.goldFaint : UI.bgInset, border: `var(--hair-width) solid ${row.own ? UI.goldSoft : UI.hairStrong}`, color: row.own ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700 }}>{socialInitials(row.name)}</span>
                <span style={{ minWidth: 0, color: row.own ? UI.ink : UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}{row.own ? ' · You' : ''}</span>
                <span className="num" style={{ color: index === 0 ? UI.gold : UI.inkSoft, fontSize: 11, whiteSpace: 'nowrap' }}>{socialMetricValue(selected, row.value)}</span>
              </div>)}
            </div>}
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 13, paddingTop: 10, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
              {group.ownerId === userId ? <button onClick={() => deleteGroup(group)} style={{ background: 'none', border: 'none', padding: 0, color: UI.danger, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Delete group</button> : <button onClick={() => leaveGroup(group)} style={{ background: 'none', border: 'none', padding: 0, color: UI.danger, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Leave group</button>}
              <button onClick={() => { setSelectedChat({ type: 'group', id: group.id }); setActiveTab('chats'); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Open chat <i className="fa-solid fa-arrow-right" /></button>
            </div>
          </Card>;
        })}</div>}
      </>
    );
  };

  const renderPlans = () => {
    const receivedShares = planShares.filter(share => share.senderId !== userId && (
      share.recipientId === userId || (share.groupId && groupById(share.groupId))
    ));
    const sentShares = planShares.filter(share => share.senderId === userId);
    const shareSenderName = share => {
      const friend = friendById(share.senderId);
      const member = share.groupId && groupMembers.find(item => item.groupId === share.groupId && item.userId === share.senderId);
      return friend?.name || member?.name || (share.senderId === userId ? 'You' : 'Group member');
    };
    const shareTargetLabel = share => {
      if (share.groupId) return `group ${groupById(share.groupId)?.name || 'group'}`;
      const otherId = share.senderId === userId ? share.recipientId : share.senderId;
      return otherId === userId ? 'You' : (friendById(otherId)?.name || 'Friend');
    };
    return (
      <>
        <button onClick={() => setActiveTab('circle')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: 0, margin: '0 0 10px', border: 'none', background: 'none', color: UI.gold, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer' }}><i className="fa-solid fa-arrow-left" /> Circle</button>
        <Card style={{ marginBottom: 12 }}>
          <div className="micro" style={{ color: UI.gold, marginBottom: 9 }}>SHARE A PLAN SNAPSHOT</div>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.45, marginBottom: 10 }}>Sharing creates an immutable copy. Later edits to your plan do not change the version your friend or group receives.</div>
          <select value={planId} onChange={e => setPlanId(e.target.value)} style={{ ...SOCIAL_INPUT_STYLE, marginBottom: 8 }}>
            {(store.schedules || []).filter(s => !s.archived).map(schedule => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 7, marginBottom: 8 }}>
            {['friend', 'group'].map(type => <button key={type} type="button" onClick={() => { setPlanRecipientType(type); setPlanRecipientId(''); }} style={{ flex: 1, padding: '8px 10px', borderRadius: 4, border: `var(--hair-width) solid ${planRecipientType === type ? UI.goldSoft : UI.hairStrong}`, background: planRecipientType === type ? UI.goldFaint : 'transparent', color: planRecipientType === type ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{type}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={planRecipientId} onChange={e => setPlanRecipientId(e.target.value)} style={{ ...SOCIAL_INPUT_STYLE, flex: 1 }}>
              <option value="">Choose a {planRecipientType}</option>
              {planRecipientType === 'friend'
                ? friends.map(friend => <option key={friend.userId} value={friend.userId}>{friend.name || friend.handle || friend.friendCode}</option>)
                : groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            <Btn onClick={sendPlan} disabled={planBusy || !planRecipientId || !activeSchedule} style={{ padding: '10px 11px', minHeight: 0, fontSize: 10 }}>{planBusy ? '...' : 'Share'}</Btn>
          </div>
        </Card>
        <div className="micro" style={{ color: UI.gold, margin: '8px 0' }}>RECEIVED SNAPSHOTS</div>
        {receivedShares.length === 0 ? <Empty title="No shared plans" sub="Plans your friends or groups send will appear here." /> : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{receivedShares.map(share => {
          const group = share.groupId && groupById(share.groupId);
          return <Card key={share.id} style={{ padding: 13 }}><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><div style={{ flex: 1 }}><div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>{socialSanitizeImportedLabel(share.planName, 120) || 'Shared plan'}</div><div className="micro" style={{ marginTop: 3 }}>{group ? `From ${shareSenderName(share)} in ${group.name}` : `From ${shareSenderName(share)}`} · {socialDate(share.createdAt)}</div></div>{socialPlanAlreadyImported(share, importedPlanReceipts) ? <span className="micro" style={{ color: UI.gold }}>Imported</span> : <Btn onClick={() => importPlan(share)} style={{ padding: '8px 10px', minHeight: 0, fontSize: 10 }}>{share.importedAt ? 'Sync' : 'Import'}</Btn>}</div></Card>;
        })}</div>}
        {sentShares.length > 0 && <div className="micro" style={{ color: UI.inkFaint, marginTop: 14 }}>Sent snapshots remain immutable and are shown here for your record.</div>}
        {planShares.length > 0 && <>
          <div className="micro" style={{ color: UI.gold, margin: '18px 0 8px' }}>MANAGE SHARES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{planShares.map(share => {
            const own = share.senderId === userId;
            const canDelete = own || !share.groupId;
            return <div key={`manage-${share.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 9px', border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 4 }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{socialSanitizeImportedLabel(share.planName, 120) || 'Shared plan'}</div><div className="micro" style={{ marginTop: 2 }}>{own ? 'To' : 'From'} {shareTargetLabel(share)} · {socialDate(share.createdAt)}</div></div>{canDelete && <button onClick={() => deletePlanShare(share)} style={{ padding: '6px 8px', borderRadius: 4, border: `var(--hair-width) solid ${own ? UI.goldSoft : UI.hairStrong}`, background: own ? UI.goldFaint : 'transparent', color: own ? UI.gold : UI.danger, fontFamily: UI.fontUi, fontSize: 9, cursor: 'pointer' }}>{own ? 'Take back' : 'Delete'}</button>}</div>;
          })}</div>
        </>}
      </>
    );
  };

  return (
    <Screen scroll={!activeChat}>
      {confirmEl}
      <TopBar title="Friends" right={<span className="micro" style={{ color: UI.inkFaint }}>{friends.length} friend{friends.length === 1 ? '' : 's'}</span>} />
      <SubTabBar tabs={[{ id: 'circle', label: 'Circle', icon: 'fa-users' }, { id: 'activity', label: 'Activity', icon: 'fa-bolt' }, { id: 'chats', label: 'Chats', icon: 'fa-comment' }, { id: 'groups', label: 'Groups', icon: 'fa-users-rectangle' }, { id: 'plans', label: 'Plans', icon: 'fa-share-nodes' }]} active={activeTab} onChange={setActiveTab} style={{ flexWrap: 'wrap', justifyContent: 'center', paddingBottom: 8 }} itemStyle={{ flex: '0 0 calc((100% - 8px) / 3)' }} />
      <div style={{ padding: '0 18px 28px', ...(activeChat ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } : {}) }}>
        {error && <div style={{ margin: '8px 0 12px', padding: '9px 11px', borderRadius: 4, background: 'rgba(var(--danger-rgb),0.10)', border: `var(--hair-width) solid rgba(var(--danger-rgb),0.3)`, color: UI.danger, fontFamily: UI.fontUi, fontSize: 12 }}>{error}</div>}
        {activeTab === 'circle' && renderCircle()}
        {activeTab === 'activity' && renderActivity()}
        {activeTab === 'chats' && renderChatsRedesigned()}
        {activeTab === 'groups' && renderGroups()}
        {activeTab === 'plans' && renderPlans()}
        <button onClick={() => reload(true)} disabled={loading} style={{ display: 'block', margin: '20px auto 0', background: 'none', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: loading ? 'default' : 'pointer' }}>{loading ? 'Refreshing...' : 'Refresh social data'}</button>
      </div>
      <Sheet open={metricPickerOpen} onClose={() => setMetricPickerOpen(false)} title="Circle metrics">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 13, lineHeight: 1.5 }}>
            Choose the three metrics shown on every friend card. If a friend has not shared your choice, that slot falls back to its standard metric.
          </div>
          {metricSlotsDraft.map((selected, slotIndex) => <label key={`slot-${slotIndex}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="micro" style={{ color: UI.gold }}>SLOT {slotIndex + 1} · FALLBACK {socialMetricLabel(defaultMetricSlots[slotIndex])}</span>
            <select value={selected} onChange={e => setMetricSlotsDraft(current => current.map((item, index) => index === slotIndex ? e.target.value : item))} style={SOCIAL_INPUT_STYLE}>
              {socialMetricCatalog.map(metric => <option key={metric.key} value={metric.key} disabled={metricSlotsDraft.some((item, index) => index !== slotIndex && item === metric.key)}>{metric.label}</option>)}
            </select>
          </label>)}
          <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, lineHeight: 1.45 }}>Your selection is synced to your social profile and applies to all friends.</div>
          <Btn onClick={saveMetricSlots} disabled={metricSlotsSaving}>{metricSlotsSaving ? 'Saving...' : 'Save metric layout'}</Btn>
        </div>
      </Sheet>
      <Sheet open={!!selectedFriend} onClose={closeFriendDetail} title={selectedFriend?.name || 'Friend'}>
        {selectedFriend && (() => {
          const detailFriend = selectedFriendMetrics ? { ...selectedFriend, ...selectedFriendMetrics } : selectedFriend;
          const sharedMetrics = socialMetricCatalog.filter(metric => socialFriendShares(detailFriend, metric.key));
          return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div className="micro" style={{ color: UI.inkFaint }}>{selectedFriend.handle ? `@${selectedFriend.handle.replace(/^@/, '')}` : selectedFriend.friendCode}</div>
              <div style={{ marginTop: 7, color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.45 }}>Everything {selectedFriend.name || 'this friend'} has chosen to share with you.</div>
            </div>
            {selectedFriendMetricsLoading && <div className="micro" style={{ color: UI.inkFaint }}>LOADING SHARED METRICS...</div>}
            {selectedFriendMetricsError && <div style={{ padding: '9px 11px', borderRadius: 4, background: 'rgba(var(--danger-rgb),0.10)', border: `var(--hair-width) solid rgba(var(--danger-rgb),0.3)`, color: UI.danger, fontFamily: UI.fontUi, fontSize: 12 }}>{selectedFriendMetricsError}</div>}
            {sharedMetrics.length === 0
              ? <div style={{ padding: 12, borderRadius: 4, background: UI.bgInset, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12 }}>This friend is not sharing health metrics yet.</div>
              : [...new Set(sharedMetrics.map(metric => metric.group))].map(group => <div key={group}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
                  <div className="micro" style={{ color: UI.gold, fontWeight: 700 }}>{group.toUpperCase()}</div>
                  <div className="micro" style={{ color: UI.inkFaint, textAlign: 'right' }}>{SOCIAL_METRIC_GROUP_TIMEFRAMES[group] || 'CURRENT'}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
                  {sharedMetrics.filter(metric => metric.group === group).map(metric => {
                    const value = socialFriendMetricValue(detailFriend, metric.key);
                    return <div key={metric.key} style={{ minWidth: 0, padding: '9px 10px', borderRadius: 4, background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}` }}>
                      <div className="micro" style={{ color: UI.gold, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{socialMetricLabel(metric.key)}</div>
                      <div className="num" style={{ color: value == null ? UI.inkGhost : UI.inkSoft, fontSize: 12, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{socialMetricValue(metric.key, value, { settings: store.settings, weightUnit: selectedFriend.weightUnit }) || 'No data'}</div>
                    </div>;
                  })}
                </div>
              </div>)}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 4 }}>
              <button onClick={() => { setSelectedChat({ type: 'friend', id: selectedFriend.userId }); closeFriendDetail(); setActiveTab('chats'); }} style={{ background: 'none', border: 'none', padding: 0, color: UI.gold, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Message</button>
              <button onClick={() => { setReportTarget(selectedFriend); closeFriendDetail(); }} style={{ background: 'none', border: 'none', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Report</button>
              <button onClick={() => blockFriend(selectedFriend)} style={{ background: 'none', border: 'none', padding: 0, color: UI.danger, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Block</button>
              <button onClick={() => removeFriend(selectedFriend)} style={{ marginLeft: 'auto', background: 'none', border: 'none', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Remove</button>
            </div>
          </div>;
        })()}
      </Sheet>
      <Sheet open={!!reportTarget} onClose={() => setReportTarget(null)} title="Report user">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 13, lineHeight: 1.5 }}>Report {reportTarget?.name || 'this user'} to the Zane team. Blocking is separate and takes effect immediately.</div>
          <select value={reportReason} onChange={e => setReportReason(e.target.value)} style={SOCIAL_INPUT_STYLE}><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="unsafe">Unsafe content</option><option value="other">Other</option></select>
          <textarea value={reportDetails} onChange={e => setReportDetails(e.target.value)} placeholder="Optional details" maxLength={2000} rows={4} style={{ ...SOCIAL_INPUT_STYLE, resize: 'vertical', userSelect: 'text', WebkitUserSelect: 'text' }} />
          <Btn onClick={submitReport} disabled={reportBusy}>{reportBusy ? 'Sending...' : 'Submit report'}</Btn>
        </div>
      </Sheet>
      {selectedWorkout && <SocialWorkoutSheet workout={selectedWorkout} onClose={() => setSelectedWorkout(null)} />}
    </Screen>
  );
}

function FriendsMaintenanceScreen() {
  return (
    <Screen scroll>
      <TopBar title="Friends" />
      <div style={{ padding: '22px 18px 30px' }}>
        <Card style={{ padding: 20, textAlign: 'center' }}>
          <i className="fa-solid fa-screwdriver-wrench" style={{ color: UI.gold, fontSize: 24 }} />
          <div className="display" style={{ color: UI.ink, fontSize: 24, marginTop: 14 }}>FRIENDS IS PAUSED</div>
          <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 13, lineHeight: 1.55, marginTop: 9 }}>
            Social features are temporarily under maintenance. Training, login and your saved data continue to work normally.
          </div>
        </Card>
      </div>
    </Screen>
  );
}

function FriendRequestBanner({ store, setStore, userId }) {
  const [dismissedId, setDismissedId] = useStateF(null);
  const [loading, setLoading] = useStateF(false);
  const pending = store?.settings?.showFriendsTab && !(
    store.coaching?.asClient?.status === 'pending'
  ) ? (store.friends?.incoming || []).find(item => item.id !== dismissedId) : null;

  if (!pending) return null;

  const respond = async accept => {
    setLoading(true);
    try {
      await LB.respondToSocialFriendRequest(pending.id, accept);
      try {
        const friends = await LB.loadFriendsState(userId, LB.socialWeekStartISO(new Date(), store.settings?.weekStartDay), { force: true });
        setStore(s => s ? {
          ...s,
          friends: {
            ...friends,
            liveWorkouts: s.friends?.liveWorkouts || [],
            workoutHistory: s.friends?.workoutHistory || [],
          },
        } : s);
      } catch (_) {
        // The relationship was answered server-side. Remove this request
        // locally even if the refresh is temporarily unavailable; the next
        // social refresh will reconcile the accepted friendship.
        setStore(s => s?.friends ? {
          ...s,
          friends: { ...s.friends, incoming: (s.friends.incoming || []).filter(item => item.id !== pending.id) },
        } : s);
      }
    } catch (e) {
      UI.alert('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div onClick={() => !loading && setDismissedId(pending.id)} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: UI.bg, backgroundImage: 'var(--bg-texture)', border: `1px solid ${UI.hairStrong}`, borderRadius: 8, padding: 28, maxWidth: 380, width: '100%' }}>
        <div className="micro-gold" style={{ marginBottom: 10, letterSpacing: '0.15em' }}>FRIEND REQUEST</div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 26, fontWeight: 700, color: UI.ink, marginBottom: 6 }}>{pending.name || 'Zane athlete'}</div>
        {pending.handle && <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>@{pending.handle.replace(/^@/, '')}</div>}
        <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 24, lineHeight: 1.5 }}>
          wants to add you as a friend. Accept to connect and see the data you each choose to share.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button disabled={loading} onClick={() => respond(true)} style={{ width: '100%', padding: '14px 0', borderRadius: 6, border: 'none', cursor: loading ? 'default' : 'pointer', background: 'var(--accent)', color: 'var(--accent-ink)', textShadow: 'none', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', opacity: loading ? 0.6 : 1 }}>ACCEPT</button>
          <button disabled={loading} onClick={() => respond(false)} style={{ width: '100%', padding: '14px 0', borderRadius: 6, border: `1px solid ${UI.hairStrong}`, cursor: loading ? 'default' : 'pointer', background: 'transparent', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600, opacity: loading ? 0.6 : 1 }}>DECLINE</button>
          <button disabled={loading} onClick={() => setDismissedId(pending.id)} style={{ width: '100%', padding: '7px 0', border: 'none', background: 'transparent', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, cursor: loading ? 'default' : 'pointer' }}>LATER</button>
        </div>
      </div>
    </div>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { FriendsScreen, FriendsMaintenanceScreen, FriendRequestBanner });
