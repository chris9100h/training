/* Training mode — Hero Set redesign. All session/persistence logic identical
   to original (Supabase sync, push-over scheduling, plan-diff prompt,
   swap-exercise sheet, rest timer, abandon flow).
*/

const { useState: useStateT, useEffect: useEffectT, useRef: useRefT } = React;

function KgInput({ value, onChange, done, style }) {
  const fmt = v => v != null ? String(v).replace('.', ',') : '';
  const [raw, setRaw] = useStateT(() => fmt(value));
  const focused = useRefT(false);
  useEffectT(() => { if (!focused.current) setRaw(fmt(value)); }, [value]);
  return (
    <input
      type="text" inputMode="decimal"
      value={raw} placeholder="—"
      disabled={done}
      style={style}
      onFocus={e => { focused.current = true; e.target.select(); }}
      onBlur={() => {
        focused.current = false;
        const num = raw === '' ? null : parseFloat(raw.replace(',', '.'));
        setRaw(num != null ? fmt(num) : '');
      }}
      onChange={e => {
        const str = e.target.value;
        setRaw(str);
        const num = str === '' ? null : parseFloat(str.replace(',', '.'));
        if (str === '' || !isNaN(num)) onChange(num ?? null);
      }}
    />
  );
}

function TrainingScreen({ store, setStore, go, sessionId }) {
  const session = store.sessions.find(s => s.id === sessionId);
  if (!session) { go({ name: 'home' }); return null; }

  const _sch = store.schedules?.find(s => s.id === session.scheduleId);
  const isWeekdayMode = _sch ? LB.isWeekdayPlan(_sch) : false;

  const exIdx = session.currentExIdx || 0;
  const entry = session.entries[exIdx];
  const exercise = entry ? LB.findExercise(store, entry.exId) : null;
  const last = entry ? LB.lastSessionForExercise(store, entry.exId, session.dayName) : null;

  const updateSession = (fn) => {
    setStore(s => ({
      ...s,
      sessions: s.sessions.map(x => x.id === session.id ? fn(x) : x),
    }));
  };

  const updateSet = (setIdx, patch) => {
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx
        ? { ...e, sets: e.sets.map((st, k) => k === setIdx ? { ...st, ...patch } : st) }
        : e),
    }));
  };

  const isImprovement = (st, prevSet) => {
    if (!prevSet) return false;
    const kg = st.kg != null && prevSet.kg != null;
    const reps = st.reps != null && prevSet.reps != null;
    if (!kg || !reps) return false;
    return st.kg >= prevSet.kg && st.reps >= prevSet.reps && (st.kg > prevSet.kg || st.reps > prevSet.reps);
  };

  const completeSet = (setIdx) => {
    updateSet(setIdx, { done: true });
    persistRestStart(Date.now());
    setFlashSet(setIdx);
    setTimeout(() => setFlashSet(null), 1400);
    const prevSet = last?.entry?.sets?.[setIdx];
    if (isImprovement(entry.sets[setIdx], prevSet)) {
      setImprovedSet(true);
      setTimeout(() => setImprovedSet(false), 2200);
    }
    const updatedSets = entry.sets.map((st, k) => k === setIdx ? { ...st, done: true } : st);
    if (updatedSets.every(st => st.done)) {
      setTimeout(() => navigate(1), 600);
    }
  };

  const addSet = () => {
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx
        ? { ...e, sets: [...e.sets, { kg: e.sets[e.sets.length-1]?.kg ?? null, reps: e.sets[e.sets.length-1]?.reps ?? null, done: false }] }
        : e),
    }));
  };

  const removeSet = async (setIdx) => {
    if (!await confirm(`Remove set ${setIdx + 1}?`, { ok: 'Remove', danger: true })) return;
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx
        ? { ...e, sets: e.sets.filter((_, k) => k !== setIdx) }
        : e),
    }));
  };

  const setNote = (note) => {
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx ? { ...e, note } : e),
    }));
  };

  const navigate = (dir) => {
    const newIdx = exIdx + dir;
    if (newIdx < 0) return;
    if (newIdx >= session.entries.length) { setFinishOpen(true); return; }
    updateSession(sess => ({ ...sess, currentExIdx: newIdx }));
  };

  const cancelPushover = () => {
    if (localStorage.getItem('logbook-push-enabled') !== 'true') return;
    fetch('https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/pushover', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nonce: `cancel-${Date.now()}`, cancel: true }),
    }).catch(() => {});
  };

  const finish = () => {
    cancelPushover();
    updateSession(sess => ({ ...sess, ended: new Date().toISOString() }));
    setStore(s => ({
      ...s,
      inProgress: null,
      ...(!isWeekdayMode && { cycleIndex: s.cycleIndex + 1 }),
      lastAdvancedDate: LB.todayISO(),
    }));
    go({ name: 'session', sessionId: session.id, justFinished: true });
  };

  const abandon = async () => {
    if (!await confirm('All inputs will be lost.', { title: 'Cancel session?', ok: 'Cancel', cancel: 'Keep training', danger: true })) return;
    cancelPushover();
    setStore(s => ({
      ...s,
      sessions: s.sessions.filter(x => x.id !== session.id),
      inProgress: null,
    }));
    go({ name: 'home' });
  };

  // chip strip scroll
  const chipRowRef = useRefT(null);
  useEffectT(() => {
    const row = chipRowRef.current;
    if (!row) return;
    const chip = row.children[exIdx];
    if (!chip) return;
    const target = chip.offsetLeft - row.offsetWidth / 2 + chip.offsetWidth / 2;
    row.scrollLeft = target;
  }, [exIdx]);

  // rest timer — persisted in session so navigation doesn't kill it
  const [restStart, setRestStart] = useStateT(() => session.restStart ?? null);

  const persistRestStart = (val) => {
    setRestStart(val);
    updateSession(sess => ({ ...sess, restStart: val }));
  };
  const [now, setNow] = useStateT(Date.now());
  useEffectT(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const sessionStart = session.startedAt ? new Date(session.startedAt).getTime() : null;
  const sessionElapsed = sessionStart ? Math.floor((now - sessionStart) / 1000) : 0;
  const _sh = Math.floor(sessionElapsed / 3600);
  const _sm = Math.floor((sessionElapsed % 3600) / 60);
  const _ss = sessionElapsed % 60;
  const sessionTimeStr = _sh > 0
    ? `${_sh}:${String(_sm).padStart(2,'0')}:${String(_ss).padStart(2,'0')}`
    : `${String(_sm).padStart(2,'0')}:${String(_ss).padStart(2,'0')}`;

  const cat = exercise?.category;
  const restDef = cat === 'big'    ? (store.settings?.restBig    || 180)
                : cat === 'medium' ? (store.settings?.restMedium || 120)
                : cat === 'small'  ? (store.settings?.restSmall  || 90)
                :                    (store.settings?.restDefault || 120);
  const restElapsed = restStart ? Math.floor((now - restStart) / 1000) : null;
  const restRemaining = restElapsed != null ? Math.max(0, restDef - restElapsed) : null;
  const restPct = restElapsed != null ? Math.min(100, (restElapsed / restDef) * 100) : 0;

  useEffectT(() => {
    if (!restStart) return;
    if (localStorage.getItem('logbook-push-enabled') !== 'true') return;
    const delaySeconds = Math.round(Math.max(0, restStart + restDef * 1000 - Date.now()) / 1000);
    fetch('https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/pushover', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ delaySeconds, nonce: String(restStart) }),
    }).catch(() => {});
  }, [restStart]);

  // beep + auto-open modal when rest timer hits zero
  const prevRestRemaining = useRefT(null);
  useEffectT(() => {
    const prev = prevRestRemaining.current;
    prevRestRemaining.current = restRemaining;
    if (prev !== null && prev > 0 && restRemaining === 0) {
      setRestModalOpen(true);
      // gold screen flash 3×
      let i = 0;
      const flash = () => {
        if (i >= 3) return;
        setScreenFlash(true);
        setTimeout(() => { setScreenFlash(false); i++; setTimeout(flash, 140); }, 220);
      };
      flash();
      // audio: two beeps + higher tone (blocked by iOS silent switch, but nice to have)
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const beep = (t, freq, dur) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'sine'; osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.35, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
          osc.start(t); osc.stop(t + dur);
        };
        beep(ctx.currentTime,        880, 0.14);
        beep(ctx.currentTime + 0.18, 880, 0.14);
        beep(ctx.currentTime + 0.36, 1320, 0.28);
        setTimeout(() => ctx.close(), 1200);
      } catch (_) {}
    }
  }, [restRemaining]);

  const [flashSet, setFlashSet] = useStateT(null);
  const [improvedSet, setImprovedSet] = useStateT(false);
  const [screenFlash, setScreenFlash] = useStateT(false);
  const [restModalOpen, setRestModalOpen] = useStateT(false);
  const [confirmEl, confirm] = useConfirm();
  const [finishOpen, setFinishOpen] = useStateT(false);
  const [notePicker, setNotePicker] = useStateT(false);
  const [sessionNoteOpen, setSessionNoteOpen] = useStateT(false);
  const [exNoteOpen, setExNoteOpen] = useStateT(false);
  const [exNoteVal, setExNoteVal] = useStateT('');
  const [planDiffOpen, setPlanDiffOpen] = useStateT(false);
  const [planDiff, setPlanDiff] = useStateT([]);
  const [swapOpen, setSwapOpen] = useStateT(false);

  const saveExNote = () => {
    setStore(s => ({ ...s, exercises: s.exercises.map(e => e.id === entry.exId ? { ...e, note: exNoteVal.trim() } : e) }));
    setExNoteOpen(false);
  };

  const swapExercise = async () => {
    if (!await confirm(`Swap "${entry.name}"?`, { ok: 'Swap' })) return;
    setSwapOpen(true);
  };

  const doSwap = (newExId) => {
    const newEx = LB.findExercise(store, newExId);
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i !== exIdx ? e : { ...e, exId: newExId, name: newEx?.name || '?' }),
    }));
    setSwapOpen(false);
  };

  const computePlanDiff = () => {
    const schedule = store.schedules?.find(s => s.id === session.scheduleId);
    const day = schedule?.days?.find(d => d.id === session.dayId);
    if (!day) return [];
    return session.entries.reduce((acc, entry, i) => {
      const planItem = day.items[i];
      if (!planItem) return acc;
      if (entry.exId !== planItem.exId) {
        const oldEx = LB.findExercise(store, planItem.exId);
        acc.push({ type: 'swap', idx: i, oldName: oldEx?.name || '?', newName: entry.name, newExId: entry.exId });
      } else if (entry.sets.length !== planItem.sets) {
        acc.push({ type: 'sets', idx: i, exName: entry.name, oldSets: planItem.sets, newSets: entry.sets.length });
      }
      return acc;
    }, []);
  };

  const tryFinish = () => {
    const diffs = computePlanDiff();
    if (diffs.length > 0) {
      setPlanDiff(diffs);
      setFinishOpen(false);
      setPlanDiffOpen(true);
    } else {
      finish();
    }
  };

  const applyPlanAndFinish = () => {
    const schedule = store.schedules?.find(s => s.id === session.scheduleId);
    const day = schedule?.days?.find(d => d.id === session.dayId);
    if (schedule && day) {
      const newItems = day.items.map((item, i) => {
        const diff = planDiff.find(d => d.idx === i);
        if (!diff) return item;
        if (diff.type === 'swap') return { ...item, exId: session.entries[i].exId };
        if (diff.type === 'sets') return { ...item, sets: session.entries[i].sets.length };
        return item;
      });
      setStore(s => ({
        ...s,
        schedules: s.schedules.map(sch => sch.id === schedule.id ? {
          ...sch,
          days: sch.days.map(d => d.id === day.id ? { ...d, items: newItems } : d),
        } : sch),
      }));
    }
    finish();
  };

  if (!entry) {
    return <Screen><Empty title="Diese Session ist leer" action={<Btn onClick={() => go({ name: 'home' })}>Zurück</Btn>} /></Screen>;
  }

  const completed = entry.sets.filter(s => s.done).length;
  const allDone = completed === entry.sets.length;
  const currentSetIdx = entry.sets.findIndex(s => !s.done);
  const currentSetNum = currentSetIdx >= 0 ? currentSetIdx + 1 : entry.sets.length;
  const heroSet = currentSetIdx >= 0 ? entry.sets[currentSetIdx] : null;
  const prevHeroSet = last?.entry?.sets?.[currentSetIdx >= 0 ? currentSetIdx : 0];

  const anyMissingData = entry.sets.some(st => !st.done && (st.kg == null || !st.reps));

  const checkAllSets = async () => {
    if (allDone || anyMissingData) return;
    if (!await confirm(`Check off all ${entry.sets.length} sets and continue?`, { ok: 'Check all' })) return;
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx
        ? { ...e, sets: e.sets.map(st => ({ ...st, done: true })) }
        : e),
    }));
    persistRestStart(Date.now());
    setTimeout(() => navigate(1), 600);
  };

  return (
    <Screen scroll={false}>
      {/* Gold screen flash overlay */}
      {screenFlash && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: UI.gold, opacity: 0.28, pointerEvents: 'none' }} />
      )}
      {/* Improvement toast */}
      <div style={{
        position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 62px)', left: 0, right: 0,
        display: 'flex', justifyContent: 'center', zIndex: 20, pointerEvents: 'none',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        opacity: improvedSet ? 1 : 0,
        transform: improvedSet ? 'translateY(0)' : 'translateY(-8px)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          background: UI.goldFaint, border: `0.5px solid ${UI.goldSoft}`,
          borderRadius: 999, padding: '6px 14px',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        }}>
          <span style={{ fontSize: 13, color: UI.gold }}>↑</span>
          <span style={{ fontSize: 12, color: UI.gold, fontFamily: UI.fontUi, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Improvement</span>
        </div>
      </div>

      {/* Top: close + session timer */}
      <div style={{ flexShrink: 0, padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 22px 8px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={abandon} style={{
          width: 32, height: 32, borderRadius: '50%',
          boxShadow: `inset 0 0 0 0.5px ${UI.hairStrong}`, background: 'transparent',
          color: UI.danger, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1,
        }}>×</button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          {/* session time */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: UI.gold, animation: 'pulseDot 1.6s ease-in-out infinite' }} />
            <span className="num" style={{ color: UI.gold, fontSize: 14, letterSpacing: '0.16em', fontWeight: 500 }}>{sessionTimeStr}</span>
          </div>
          {/* rest countdown — only when active */}
          {restStart && restRemaining > 0 && (<>
            <div style={{ width: 0.5, height: 14, background: UI.hairStrong, flexShrink: 0 }} />
            <button onClick={() => setRestModalOpen(true)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}>
              <span className="num" style={{
                color: UI.gold, fontSize: 14, letterSpacing: '0.14em', fontWeight: 500,
                animation: 'timerPulse 1.6s ease-in-out infinite',
              }}>
                {Math.floor(restRemaining/60)}:{(restRemaining%60).toString().padStart(2,'0')}
              </span>
              <div style={{ width: 44, height: 2, background: UI.hair, borderRadius: 1, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${restPct}%`, background: UI.gold, transition: 'width 0.25s linear' }} />
              </div>
            </button>
          </>)}
        </div>
        <button onClick={() => go({ name: 'home' })} style={{
          width: 32, height: 32, borderRadius: '50%',
          boxShadow: `inset 0 0 0 0.5px ${UI.hairStrong}`, background: 'transparent',
          color: UI.inkSoft, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
            <path d="M9 21V12h6v9"/>
          </svg>
        </button>
      </div>

      {/* Day name + exercise position */}
      <div style={{ flexShrink: 0, padding: '6px 22px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="micro-gold">{session.dayName}</span>
        <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>
          {String(exIdx + 1).padStart(2, '0')} <span style={{ color: UI.hair }}>/</span> {String(session.entries.length).padStart(2, '0')}
        </span>
      </div>

      {/* Exercise chips */}
      <div ref={chipRowRef} style={{ flexShrink: 0, padding: '0 22px 12px', display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {session.entries.map((e, i) => {
          const done = e.sets.every(s => s.done);
          const active = i === exIdx;
          return (
            <button key={i}
              onClick={() => updateSession(sess => ({ ...sess, currentExIdx: i }))}
              style={{
                flexShrink: 0, maxWidth: 110,
                padding: '5px 11px 4px', borderRadius: 999,
                border: `0.5px solid ${active ? UI.gold : done ? UI.goldSoft : UI.hairStrong}`,
                background: active ? UI.goldFaint : done ? 'rgba(201,169,97,0.05)' : 'transparent',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                transition: 'all 0.15s',
              }}>
              <div style={{
                fontSize: 10, fontFamily: UI.fontUi, letterSpacing: '0.07em',
                color: active ? UI.gold : done ? UI.inkSoft : UI.inkFaint,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {e.name}
              </div>
              <div style={{ height: 3, marginTop: 3, display: 'flex', justifyContent: 'center' }}>
                {done && !active && <div style={{ width: 4, height: 4, borderRadius: '50%', background: UI.gold, marginTop: -1 }} />}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Exercise name */}
        <div style={{ flexShrink: 0 }}>
          <div className="display" style={{
            fontSize: entry.name.length > 28 ? 16 : entry.name.length > 22 ? 20 : entry.name.length > 16 ? 26 : 32,
            color: UI.ink, lineHeight: 1.05, letterSpacing: '-0.01em', fontWeight: 400,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {entry.name}
          </div>
          {(exercise?.tags || []).length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {(exercise?.tags || []).map(t => <Pill key={t}>{t}</Pill>)}
            </div>
          )}
        </div>

        {/* HERO CURRENT SET */}
        {allDone ? (
          <Frame accent style={{ padding: 28, textAlign: 'center' }}>
            <div className="micro-gold" style={{ marginBottom: 10 }}>ALL SETS DONE</div>
            <div className="display" style={{ fontSize: 28, color: UI.gold, fontStyle: 'italic', fontWeight: 300, marginBottom: 6 }}>Done.</div>
            <div style={{ color: UI.inkSoft, fontSize: 13 }}>Next exercise ready.</div>
            <Btn onClick={() => navigate(1)} style={{ marginTop: 18 }}>
              {exIdx === session.entries.length - 1 ? 'Finish session →' : 'Next exercise →'}
            </Btn>
          </Frame>
        ) : heroSet && (
          <BracketFrame gold padding={0}>
            <div style={{ padding: '12px 6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 18px', marginBottom: 8 }}>
                <span className="micro-gold">SET {String(currentSetNum).padStart(2, '0')} / {String(entry.sets.length).padStart(2, '0')}</span>
                {prevHeroSet && prevHeroSet.kg ? (
                  <span className="num" style={{ color: UI.inkFaint, fontSize: 10 }}>
                    LAST TIME <span style={{ color: UI.inkSoft }}>{prevHeroSet.kg}kg × {prevHeroSet.reps}</span>
                  </span>
                ) : <span />}
              </div>

              {/* HUGE inputs */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 14px' }}>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <KgInput
                    value={heroSet.kg}
                    done={false}
                    style={{
                      background: 'transparent', border: 'none', outline: 'none',
                      color: UI.gold,
                      fontFamily: UI.fontNum, fontVariantNumeric: 'tabular-nums',
                      fontSize: 44, fontWeight: 300,
                      letterSpacing: '-0.02em',
                      textAlign: 'center', width: '100%', padding: 0,
                    }}
                    onChange={kg => updateSession(sess => ({
                      ...sess,
                      entries: sess.entries.map((en, ei) => ei !== exIdx ? en : {
                        ...en,
                        sets: en.sets.map((st, si) =>
                          si === currentSetIdx ? { ...st, kg, done: false }
                          : si > currentSetIdx && !st.done ? { ...st, kg }
                          : st
                        ),
                      }),
                    }))}
                  />
                  <div className="micro" style={{ marginTop: 2 }}>KILOGRAMS</div>
                </div>
                <div style={{ fontSize: 32, color: UI.hair, fontFamily: UI.fontDisplay, fontWeight: 200, fontStyle: 'italic', alignSelf: 'flex-start', marginTop: 6 }}>×</div>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <input
                    type="number" inputMode="numeric"
                    value={heroSet.reps ?? ''} placeholder="—"
                    onFocus={e => e.target.select()}
                    onChange={e => updateSet(currentSetIdx, { reps: e.target.value === '' ? null : +e.target.value, done: false })}
                    style={{
                      background: 'transparent', border: 'none', outline: 'none',
                      color: UI.gold,
                      fontFamily: UI.fontNum, fontVariantNumeric: 'tabular-nums',
                      fontSize: 44, fontWeight: 300,
                      letterSpacing: '-0.02em',
                      textAlign: 'center', width: '100%', padding: 0,
                    }}
                  />
                  <div className="micro" style={{ marginTop: 2 }}>REPETITIONS</div>
                </div>
              </div>

              {/* Big confirm button */}
              <div style={{ marginTop: 12, padding: '0 18px' }}>
                <button
                  onClick={() => completeSet(currentSetIdx)}
                  disabled={heroSet.kg == null || !heroSet.reps}
                  style={{
                    width: '100%', minHeight: 44,
                    background: heroSet.kg == null || !heroSet.reps ? 'transparent' : `linear-gradient(180deg, var(--gold-light), var(--gold))`,
                    border: heroSet.kg == null || !heroSet.reps ? `0.5px solid ${UI.hairStrong}` : `0.5px solid var(--gold-deep)`,
                    color: heroSet.kg == null || !heroSet.reps ? UI.inkFaint : '#0a0805',
                    borderRadius: 999,
                    fontFamily: UI.fontUi, fontWeight: 600, fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase',
                    cursor: heroSet.kg == null || !heroSet.reps ? 'default' : 'pointer',
                    boxShadow: heroSet.kg == null || !heroSet.reps ? 'none' : '0 8px 30px rgba(201,169,97,0.30)',
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                  ✓ Check set
                </button>
              </div>
            </div>
          </BracketFrame>
        )}

        {/* All sets list */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <span className="micro">ALL SETS</span>
            <button onClick={checkAllSets} disabled={anyMissingData && !allDone} style={{
              padding: '4px 10px', borderRadius: 999,
              background: allDone ? UI.goldFaint : 'transparent',
              border: `0.5px solid ${allDone ? UI.goldSoft : UI.hair}`,
              color: allDone ? UI.gold : UI.inkFaint,
              fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
              fontFamily: UI.fontUi, fontWeight: 500,
              cursor: anyMissingData && !allDone ? 'default' : 'pointer',
              opacity: anyMissingData && !allDone ? 0.3 : 1,
            }}>{allDone ? '✓ All' : 'All ✓'}</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {entry.sets.map((s, i) => {
              const prevSet = last?.entry?.sets?.[i];
              const isCurrent = i === currentSetIdx;
              return (
                <div key={i} style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 1fr 56px 56px 28px 18px',
                  gap: 8, alignItems: 'center',
                  padding: '10px 4px',
                  borderBottom: i < entry.sets.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
                  opacity: s.done ? 0.4 : 1,
                  animation: flashSet === i ? 'rowFlash 1.4s ease forwards' : 'none',
                }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                    background: isCurrent ? UI.goldFaint : 'transparent',
                    boxShadow: `inset 0 0 0 0.5px ${isCurrent ? UI.gold : s.done ? UI.goldDeep : UI.hairStrong}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: UI.fontNum, fontSize: 10, fontWeight: 500,
                    color: isCurrent ? UI.gold : s.done ? UI.goldDeep : UI.inkFaint,
                  }}>{i + 1}</div>

                  <div className="num" style={{ fontSize: 11, color: UI.inkFaint }}>
                    {prevSet?.kg && prevSet?.reps ? `${prevSet.kg}kg × ${prevSet.reps}` : '—'}
                  </div>

                  <KgInput
                    value={s.kg}
                    done={s.done}
                    style={setInputStyle(s.done, isCurrent)}
                    onChange={kg => updateSession(sess => ({
                      ...sess,
                      entries: sess.entries.map((en, ei) => ei !== exIdx ? en : {
                        ...en,
                        sets: en.sets.map((st, si) =>
                          si === i ? { ...st, kg, done: false }
                          : si > i && !st.done ? { ...st, kg }
                          : st
                        ),
                      }),
                    }))}
                  />

                  <input
                    type="number" inputMode="numeric"
                    value={s.reps ?? ''} placeholder="—"
                    onFocus={e => e.target.select()}
                    onChange={e => updateSet(i, { reps: e.target.value === '' ? null : +e.target.value, done: false })}
                    disabled={s.done}
                    style={setInputStyle(s.done, isCurrent)}
                  />

                  <button onClick={() => s.done ? updateSet(i, { done: false }) : completeSet(i)}
                    disabled={!s.done && (s.kg == null || !s.reps)}
                    style={{
                      width: 26, height: 26, borderRadius: 5, border: 'none', cursor: 'pointer',
                      background: s.done ? UI.gold : 'transparent',
                      outline: `0.5px solid ${s.done ? UI.gold : (s.kg == null || !s.reps) ? UI.hair : isCurrent ? UI.goldSoft : UI.hairStrong}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 700, color: s.done ? '#0a0805' : 'transparent',
                      opacity: !s.done && (s.kg == null || !s.reps) ? 0.35 : 1,
                      flexShrink: 0,
                      WebkitTapHighlightColor: 'transparent',
                    }}>✓</button>

                  {!s.done && entry.sets.length > 1 ? (
                    <button onClick={() => removeSet(i)} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: UI.danger, fontSize: 16, lineHeight: 1, padding: 0, opacity: 0.6,
                    }}>−</button>
                  ) : <span />}
                </div>
              );
            })}
          </div>

          {/* Add set / swap / note */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={addSet} style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'transparent', boxShadow: `inset 0 0 0 0.5px ${UI.hairStrong}`,
              color: UI.inkSoft, fontSize: 18, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>+</button>
            <button onClick={swapExercise} style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'transparent', boxShadow: `inset 0 0 0 0.5px ${UI.hairStrong}`,
              color: UI.inkSoft, fontSize: 14, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>⇄</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setNotePicker(true)} style={{
              background: entry.note ? UI.goldFaint : 'transparent',
              border: `0.5px solid ${entry.note ? UI.goldSoft : UI.hairStrong}`,
              borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
              color: entry.note ? UI.gold : UI.inkFaint, fontSize: 10,
              fontFamily: UI.fontUi, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500,
            }}>
              {entry.note ? 'Note' : '+ Note'}
            </button>
          </div>
        </div>

        {/* Exercise note (permanent, from exercise definition) */}
        {exercise?.note && (
          <Frame style={{ padding: 14 }}>
            <div className="micro" style={{ marginBottom: 6 }}>NOTE · {entry.name.toUpperCase()}</div>
            <div style={{ fontFamily: UI.fontDisplay, fontSize: 16, color: UI.inkSoft, lineHeight: 1.5, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
              {exercise.note}
            </div>
          </Frame>
        )}

      </div>

      {/* Footer nav */}
      <div style={{
        flexShrink: 0,
        padding: `10px 22px calc(env(safe-area-inset-bottom, 8px) + 10px)`,
        borderTop: `0.5px solid ${UI.hair}`,
        display: 'flex', gap: 10,
      }}>
        <button onClick={() => navigate(-1)} disabled={exIdx === 0} style={{
          width: 56, minHeight: 50, borderRadius: 999,
          background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
          color: UI.inkSoft, cursor: exIdx === 0 ? 'default' : 'pointer',
          opacity: exIdx === 0 ? 0.3 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <Btn onClick={() => navigate(1)} style={{ flex: 1 }}>
          {exIdx === session.entries.length - 1 ? 'Finish →' : 'Next exercise →'}
        </Btn>
      </div>

      {/* finish confirmation */}
      <Sheet open={finishOpen} onClose={() => setFinishOpen(false)} title="End session?">
        <div style={{ fontSize: 14, color: UI.inkSoft, marginBottom: 18, lineHeight: 1.6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `0.5px solid ${UI.hair}` }}>
            <span>Sets</span>
            <span className="num" style={{ color: UI.ink }}>
              {session.entries.reduce((c, e) => c + e.sets.filter(s => s.done).length, 0)} / {session.entries.reduce((c, e) => c + e.sets.length, 0)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `0.5px solid ${UI.hair}` }}>
            <span>Volume</span>
            <span className="num" style={{ color: UI.gold }}>
              {Math.round(totalVolume(session)).toLocaleString('en-US')} kg
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
            <span>Duration</span>
            <span className="num" style={{ color: UI.ink }}>{sessionTimeStr}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => setFinishOpen(false)} style={{ flex: 1 }}>Continue</Btn>
          <Btn onClick={tryFinish} style={{ flex: 2 }}>Finish ✓</Btn>
        </div>
      </Sheet>

      {/* note type picker */}
      <Sheet open={notePicker} onClose={() => setNotePicker(false)} title="Which note?">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={() => { setNotePicker(false); setSessionNoteOpen(true); }} style={{
            background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 12,
            padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, marginBottom: 4 }}>Session note</div>
            <div style={{ fontSize: 12, color: UI.inkSoft }}>Only for this workout — e.g. how the set felt.</div>
          </button>
          <button onClick={() => { setNotePicker(false); setExNoteVal(exercise?.note || ''); setExNoteOpen(true); }} style={{
            background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 12,
            padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, marginBottom: 4 }}>Exercise note</div>
            <div style={{ fontSize: 12, color: UI.inkSoft }}>Permanent — shown every session. Settings, technique cues.</div>
          </button>
        </div>
      </Sheet>

      {/* session note editor */}
      <Sheet open={sessionNoteOpen} onClose={() => setSessionNoteOpen(false)} title="Session note">
        <textarea
          value={entry.note || ''}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g. Right knee was acting up, add more warm-up sets next time"
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
            borderRadius: 10, padding: 12, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14,
            resize: 'vertical', outline: 'none',
          }}
        />
        <Btn onClick={() => setSessionNoteOpen(false)} style={{ marginTop: 12, width: '100%' }}>Save</Btn>
      </Sheet>

      {/* exercise note editor */}
      <Sheet open={exNoteOpen} onClose={() => setExNoteOpen(false)} title="Exercise note">
        <textarea
          value={exNoteVal}
          onChange={e => setExNoteVal(e.target.value)}
          placeholder="e.g. Cable pos 4, neutral grip, slow on the way down"
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
            borderRadius: 10, padding: 12, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14,
            resize: 'vertical', outline: 'none',
          }}
        />
        <Btn onClick={saveExNote} style={{ marginTop: 12, width: '100%' }}>Save</Btn>
      </Sheet>

      {/* plan diff */}
      <Sheet open={planDiffOpen} onClose={() => { setPlanDiffOpen(false); finish(); }} title="Update plan?">
        <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 12 }}>Changes vs. plan:</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {planDiff.map((d, i) => (
            <div key={i} style={{
              background: UI.bgInset, borderRadius: 10, padding: '10px 14px',
              fontSize: 13, color: UI.ink, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {d.type === 'swap' ? (
                <>
                  <span style={{ color: UI.goldLight, fontSize: 14 }}>⇄</span>
                  <span><span style={{ color: UI.inkSoft }}>{d.oldName}</span>{' → '}<strong>{d.newName}</strong></span>
                </>
              ) : (
                <>
                  <span style={{ color: UI.goldLight, fontSize: 14 }}>≡</span>
                  <span><strong>{d.exName}</strong>{': '}<span style={{ color: UI.inkSoft }}>{d.oldSets}</span>{' → '}<strong>{d.newSets} sets</strong></span>
                </>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => { setPlanDiffOpen(false); finish(); }} style={{ flex: 1 }}>No</Btn>
          <Btn onClick={() => { setPlanDiffOpen(false); applyPlanAndFinish(); }} style={{ flex: 2 }}>Yes, update</Btn>
        </div>
      </Sheet>

      {/* exercise swap picker */}
      {swapOpen && <window.Screens.ExercisePicker store={store} onClose={() => setSwapOpen(false)} onPick={doSwap} />}

      {/* rest timer modal */}
      <Sheet open={restModalOpen} onClose={() => setRestModalOpen(false)} title="Rest">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, paddingBottom: 8 }}>
          {/* big countdown */}
          <div style={{ textAlign: 'center' }}
            onClick={restRemaining === 0 ? () => { persistRestStart(null); setRestModalOpen(false); } : undefined}
          >
            <div className="num" style={{
              fontSize: 72, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1,
              color: UI.gold,
              animation: restRemaining === 0 ? 'timerPulse 0.8s ease-in-out infinite' : 'none',
              cursor: restRemaining === 0 ? 'pointer' : 'default',
            }}>
              {restRemaining != null
                ? `${Math.floor(restRemaining/60)}:${(restRemaining%60).toString().padStart(2,'0')}`
                : '—'}
            </div>
            {restRemaining === 0 && (
              <div style={{ marginTop: 10, fontSize: 11, letterSpacing: '0.18em', color: UI.gold, fontFamily: UI.fontUi, fontWeight: 600 }}>
                GO
              </div>
            )}
            {/* progress bar */}
            <div style={{ height: 2, background: UI.hair, borderRadius: 1, overflow: 'hidden', marginTop: 18, width: 200 }}>
              <div style={{ height: '100%', width: `${restPct}%`, background: UI.gold, transition: 'width 0.25s linear' }} />
            </div>
          </div>
          {/* controls */}
          <div style={{ display: 'flex', gap: 10, width: '100%' }}>
            <button onClick={() => { persistRestStart(null); setRestModalOpen(false); }} style={{
              flex: 1, padding: '12px 0', background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
              color: UI.inkSoft, borderRadius: 999, cursor: 'pointer',
              fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 500,
            }}>Skip</button>
            <button onClick={() => persistRestStart(restStart - 30000)} style={{
              flex: 1, padding: '12px 0', background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
              color: UI.inkSoft, borderRadius: 999, cursor: 'pointer',
              fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 500,
            }}>−30s</button>
            <button onClick={() => persistRestStart(restStart + 30000)} style={{
              flex: 1, padding: '12px 0', background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
              color: UI.inkSoft, borderRadius: 999, cursor: 'pointer',
              fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 500,
            }}>+30s</button>
          </div>
        </div>
      </Sheet>

      {confirmEl}
    </Screen>
  );
}

function setInputStyle(done, current) {
  return {
    background: done ? 'transparent' : current ? 'rgba(201,169,97,0.06)' : UI.bgInset,
    border: `0.5px solid ${done ? 'transparent' : current ? UI.goldSoft : UI.hair}`,
    borderRadius: 8, outline: 'none',
    color: done ? UI.inkSoft : UI.ink,
    fontFamily: UI.fontNum, fontSize: 15, fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    width: '100%', padding: '8px 4px', textAlign: 'center',
  };
}

Object.assign(window.Screens, { TrainingScreen });
