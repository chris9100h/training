/* Training mode — one exercise per screen, swipe through */

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

  const completeSet = (setIdx) => {
    updateSet(setIdx, { done: true });
    setRestStart(Date.now());
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
    if (!await confirm(`Satz ${setIdx + 1} entfernen?`, { ok: 'Entfernen', danger: true })) return;
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

  const finish = () => {
    updateSession(sess => ({ ...sess, ended: new Date().toISOString() }));
    setStore(s => ({
      ...s,
      inProgress: null,
      cycleIndex: s.cycleIndex + 1,
      lastAdvancedDate: LB.todayISO(),
    }));
    go({ name: 'session', sessionId: session.id, justFinished: true });
  };

  const abandon = async () => {
    if (!await confirm('Eingaben gehen verloren.', { title: 'Session abbrechen?', ok: 'Abbrechen', cancel: 'Weiter trainieren', danger: true })) return;
    setStore(s => ({
      ...s,
      sessions: s.sessions.filter(x => x.id !== session.id),
      inProgress: null,
    }));
    go({ name: 'home' });
  };

  // ── chip strip scroll ─────────────────────────────────────
  const chipRowRef = useRefT(null);
  useEffectT(() => {
    const row = chipRowRef.current;
    if (!row) return;
    const chip = row.children[exIdx];
    if (!chip) return;
    const target = chip.offsetLeft - row.offsetWidth / 2 + chip.offsetWidth / 2;
    row.scrollLeft = target;
  }, [exIdx]);

  // ── rest timer ────────────────────────────────────────────
  const [restStart, setRestStart] = useStateT(null);
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

  const restDef = store.settings?.restDefault || 120;
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
      body: JSON.stringify({ delaySeconds }),
    }).catch(() => {});
  }, [restStart]);

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
    if (!await confirm(`"${entry.name}" austauschen?`, { ok: 'Austauschen' })) return;
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
  const currentSetNum = Math.min(completed + 1, entry.sets.length);

  const anyMissingData = entry.sets.some(st => !st.done && (!st.kg || !st.reps));

  const checkAllSets = async () => {
    if (allDone || anyMissingData) return;
    if (!await confirm(`Alle ${entry.sets.length} Sätze abhaken und weiter?`, { ok: 'Alle abhaken' })) return;
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx
        ? { ...e, sets: e.sets.map(st => ({ ...st, done: true })) }
        : e),
    }));
    setRestStart(Date.now());
    setTimeout(() => navigate(1), 600);
  };

  return (
    <Screen scroll={false}>
      <TopBar
        title={`${session.dayName} · ${exIdx+1}/${session.entries.length}`}
        sub="Training läuft"
        right={<Btn kind="ghost" onClick={abandon} style={{ minHeight: 32, padding: '4px 10px', fontSize: 11, color: UI.danger, borderColor: 'rgba(200,116,105,0.25)' }}>×</Btn>}
      />

      {/* session timer pill */}
      <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', padding: '10px 18px 0' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          height: 34, width: '100%', borderRadius: 999,
          background: UI.goldFaint, border: `1px solid ${UI.goldSoft}`,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: 3,
            background: UI.gold,
            animation: 'timerPulse 2s ease-in-out infinite',
          }} />
          <span style={{
            fontFamily: UI.fontNum, fontSize: 13,
            color: UI.gold, letterSpacing: '0.14em', fontWeight: 500,
          }}>{sessionTimeStr}</span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* progress chips — clickable, horizontally scrollable */}
        <div ref={chipRowRef} style={{ display: 'flex', gap: 6, margin: '-4px -18px 0', padding: '0 18px', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {session.entries.map((e, i) => {
            const done = e.sets.every(s => s.done);
            const active = i === exIdx;
            return (
              <button key={i}
                onClick={() => updateSession(sess => ({ ...sess, currentExIdx: i }))}
                style={{
                  flexShrink: 0, padding: '4px 10px', borderRadius: 20, border: 'none', cursor: 'pointer',
                  background: active ? UI.gold : done ? 'rgba(212,164,55,0.15)' : UI.bgRaised,
                  color: active ? '#0a0a0a' : done ? UI.gold : UI.inkSoft,
                  fontSize: 11, fontFamily: UI.fontUi, fontWeight: active ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}>
                {i + 1}. {e.name}
              </button>
            );
          })}
        </div>

        {/* heading */}
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>{entry.name}</div>
          <div style={{ fontSize: 14, color: UI.inkSoft, marginTop: 4 }}>
            Set {currentSetNum} of {entry.sets.length}
          </div>
        </div>

        {/* set table */}
        <div>
          {/* table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px 72px 36px 24px', gap: 8, padding: '0 2px 8px', borderBottom: `1px solid ${UI.inkLine}` }}>
            <Label style={{ marginBottom: 0, fontSize: 11 }}>Set</Label>
            <Label style={{ marginBottom: 0, fontSize: 11 }}>Vorherige ↔</Label>
            <Label style={{ marginBottom: 0, fontSize: 11, textAlign: 'center' }}>kg</Label>
            <Label style={{ marginBottom: 0, fontSize: 11, textAlign: 'center' }}>Reps</Label>
            <button onClick={checkAllSets} disabled={anyMissingData && !allDone} style={{
              width: 28, height: 28, border: 'none', borderRadius: 6,
              cursor: anyMissingData && !allDone ? 'default' : 'pointer',
              background: allDone ? UI.gold : 'transparent',
              outline: `2px solid ${allDone ? UI.gold : UI.inkLine}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: allDone ? '#0a0a0a' : 'transparent',
              opacity: anyMissingData && !allDone ? 0.3 : 1,
            }}>✓</button>
            <span />
          </div>

          {/* set rows */}
          {entry.sets.map((s, i) => {
            const prevSet = last?.entry?.sets?.[i];
            const current = !s.done && entry.sets.slice(0, i).every(x => x.done);
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '36px 1fr 72px 72px 36px 24px', gap: 8,
                alignItems: 'center', padding: '10px 2px',
                borderBottom: `1px solid ${UI.inkLine}`,
                opacity: s.done ? 0.45 : 1,
              }}>
                {/* set number circle */}
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: current ? UI.goldFaint : 'transparent',
                  border: `2px solid ${current ? UI.gold : UI.inkLine}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: UI.fontNum, fontSize: 13, fontWeight: 600,
                  color: current ? UI.gold : UI.inkSoft,
                }}>
                  {i + 1}
                </div>

                {/* previous */}
                <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontNum }}>
                  {prevSet?.kg && prevSet?.reps ? `${prevSet.kg} kg × ${prevSet.reps}` : '—'}
                </div>

                {/* kg */}
                <KgInput
                  value={s.kg}
                  done={s.done}
                  style={setInputStyle(s.done, current)}
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

                {/* reps */}
                <input
                  type="number" inputMode="numeric"
                  value={s.reps ?? ''} placeholder="—"
                  onFocus={e => e.target.select()}
                  onChange={e => updateSet(i, { reps: e.target.value === '' ? null : +e.target.value, done: false })}
                  disabled={s.done}
                  style={setInputStyle(s.done, current)}
                />

                {/* checkbox */}
                <button onClick={() => s.done ? updateSet(i, { done: false }) : completeSet(i)}
                  disabled={!s.done && (!s.kg || !s.reps)}
                  style={{
                    width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: s.done ? UI.gold : 'transparent',
                    outline: `2px solid ${s.done ? UI.gold : (!s.kg || !s.reps) ? UI.inkLine : UI.inkSoft}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, color: s.done ? '#0a0a0a' : 'transparent',
                    opacity: !s.done && (!s.kg || !s.reps) ? 0.35 : 1,
                    flexShrink: 0,
                  }}>
                  ✓
                </button>

                {/* remove set */}
                {!s.done && entry.sets.length > 1 ? (
                  <button onClick={() => removeSet(i)} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: UI.danger, fontSize: 18, lineHeight: 1, padding: 0, opacity: 0.6,
                  }}>−</button>
                ) : <span />}
              </div>
            );
          })}

          {/* add set + swap exercise + note */}
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={addSet} style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'transparent', border: `1px solid ${UI.inkLine}`,
              color: UI.inkSoft, fontSize: 20, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>+</button>
            <button onClick={swapExercise} style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'transparent', border: `1px solid ${UI.inkLine}`,
              color: UI.inkSoft, fontSize: 16, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>⇄</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setNotePicker(true)} style={{
              background: entry.note ? UI.goldFaint : 'transparent',
              border: `1px solid ${entry.note ? UI.goldSoft : UI.inkLine}`,
              borderRadius: 20, padding: '6px 12px', cursor: 'pointer',
              color: entry.note ? UI.gold : UI.inkFaint, fontSize: 12,
              fontFamily: UI.fontUi, flexShrink: 0,
            }}>
              📝 {entry.note ? 'Notiz' : '+ Notiz'}
            </button>
          </div>
        </div>

        {/* rest timer */}
        {restStart && restRemaining > 0 && (
          <Card style={{ padding: 12, background: UI.bgInset }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <Label style={{ marginBottom: 0 }}>Pause</Label>
              <div style={{ fontFamily: UI.fontNum, fontSize: 22, color: UI.gold, fontWeight: 500 }}>
                {Math.floor(restRemaining/60)}:{(restRemaining%60).toString().padStart(2,'0')}
              </div>
            </div>
            <div style={{ height: 3, background: UI.inkLine, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${restPct}%`, background: UI.gold, transition: 'width 0.25s linear' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Btn kind="ghost" onClick={() => setRestStart(null)} style={{ flex: 1, minHeight: 36, fontSize: 12 }}>Überspringen</Btn>
              <Btn kind="ghost" onClick={() => setRestStart(Date.now() - (restElapsed - 30) * 1000)} style={{ flex: 1, minHeight: 36, fontSize: 12 }}>+30s</Btn>
            </div>
          </Card>
        )}

        {/* exercise note (permanent, from exercise definition) */}
        {exercise?.note && (
          <Card style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: UI.ink }}>Exercise Note</div>
              <span style={{ fontSize: 16 }}>📌</span>
            </div>
            <div style={{ fontSize: 14, color: UI.inkSoft, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {exercise.note}
            </div>
          </Card>
        )}
      </div>

      {/* session timer bar — directly above footer nav */}
      {/* footer nav — fixed to bottom like TabBar */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 440,
        borderTop: `1px solid ${UI.inkLine}`,
        padding: `10px 18px calc(env(safe-area-inset-bottom, 8px) + 10px)`,
        background: UI.bg, display: 'flex', gap: 8, zIndex: 10,
      }}>
        <Btn kind="ghost" onClick={() => navigate(-1)} disabled={exIdx === 0} style={{ flex: 1, opacity: exIdx === 0 ? 0.3 : 1 }}>‹ zurück</Btn>
        <Btn onClick={() => navigate(1)} style={{ flex: 2 }}>
          {exIdx === session.entries.length - 1 ? 'Fertig →' : 'Nächste Übung →'}
        </Btn>
      </div>
      <div style={{ flexShrink: 0, height: 'calc(64px + env(safe-area-inset-bottom, 8px))' }} />

      {/* finish confirmation */}
      <Sheet open={finishOpen} onClose={() => setFinishOpen(false)} title="Session beenden?">
        <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 14 }}>
          {session.entries.reduce((c, e) => c + e.sets.filter(s => s.done).length, 0)} von{' '}
          {session.entries.reduce((c, e) => c + e.sets.length, 0)} Sets geloggt ·{' '}
          {Math.round(totalVolume(session)).toLocaleString('de-DE')} kg Gesamtvolumen
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => setFinishOpen(false)} style={{ flex: 1 }}>Weiter trainieren</Btn>
          <Btn onClick={tryFinish} style={{ flex: 2 }}>Beenden ✓</Btn>
        </div>
      </Sheet>

      {/* note type picker */}
      <Sheet open={notePicker} onClose={() => setNotePicker(false)} title="Welche Notiz?">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={() => { setNotePicker(false); setSessionNoteOpen(true); }} style={{
            background: UI.bgInset, border: `1px solid ${UI.inkLine}`, borderRadius: 12,
            padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, marginBottom: 4 }}>📝 Session-Notiz</div>
            <div style={{ fontSize: 12, color: UI.inkSoft }}>Nur für dieses Training sichtbar — z.B. wie sich der Satz angefühlt hat.</div>
          </button>
          <button onClick={() => { setNotePicker(false); setExNoteVal(exercise?.note || ''); setExNoteOpen(true); }} style={{
            background: UI.bgInset, border: `1px solid ${UI.inkLine}`, borderRadius: 12,
            padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, marginBottom: 4 }}>📌 Übungs-Notiz</div>
            <div style={{ fontSize: 12, color: UI.inkSoft }}>Dauerhaft gespeichert — wird bei jeder Session angezeigt. z.B. Einstellungen, Technikhinweise.</div>
          </button>
        </div>
      </Sheet>

      {/* session note editor */}
      <Sheet open={sessionNoteOpen} onClose={() => setSessionNoteOpen(false)} title="Session-Notiz">
        <textarea
          value={entry.note || ''}
          onChange={e => setNote(e.target.value)}
          placeholder="z.B. Knie hat gezwickt, nächstes Mal Aufwärmsatz mehr"
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: UI.bgInset, border: `1px solid ${UI.inkLine}`,
            borderRadius: 10, padding: 12, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14,
            resize: 'vertical', outline: 'none',
          }}
        />
        <Btn onClick={() => setSessionNoteOpen(false)} style={{ marginTop: 12, width: '100%' }}>Speichern</Btn>
      </Sheet>

      {/* plan diff — update plan? */}
      <Sheet open={planDiffOpen} onClose={() => { setPlanDiffOpen(false); finish(); }} title="Plan updaten?">
        <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 12 }}>
          Änderungen gegenüber Plan:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {planDiff.map((d, i) => (
            <div key={i} style={{
              background: UI.bgInset, borderRadius: 10, padding: '10px 14px',
              fontSize: 13, color: UI.ink, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {d.type === 'swap' ? (
                <>
                  <span style={{ color: UI.goldLight, fontSize: 15 }}>⇄</span>
                  <span><span style={{ color: UI.inkSoft }}>{d.oldName}</span>{' → '}<strong>{d.newName}</strong></span>
                </>
              ) : (
                <>
                  <span style={{ color: UI.goldLight, fontSize: 15 }}>≡</span>
                  <span><strong>{d.exName}</strong>{': '}
                    <span style={{ color: UI.inkSoft }}>{d.oldSets} Sätze</span>{' → '}<strong>{d.newSets} Sätze</strong>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => { setPlanDiffOpen(false); finish(); }} style={{ flex: 1 }}>Nein</Btn>
          <Btn onClick={() => { setPlanDiffOpen(false); applyPlanAndFinish(); }} style={{ flex: 2 }}>Ja, updaten</Btn>
        </div>
      </Sheet>

      {/* exercise swap picker */}
      {swapOpen && <window.Screens.ExercisePicker store={store} onClose={() => setSwapOpen(false)} onPick={doSwap} />}

      {confirmEl}

      {/* exercise note editor */}
      <Sheet open={exNoteOpen} onClose={() => setExNoteOpen(false)} title="Übungs-Notiz">
        <textarea
          value={exNoteVal}
          onChange={e => setExNoteVal(e.target.value)}
          placeholder="z.B. Kabelzug Pos 4, Griff neutral, langsam ablassen"
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: UI.bgInset, border: `1px solid ${UI.inkLine}`,
            borderRadius: 10, padding: 12, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14,
            resize: 'vertical', outline: 'none',
          }}
        />
        <Btn onClick={saveExNote} style={{ marginTop: 12, width: '100%' }}>Speichern</Btn>
      </Sheet>
    </Screen>
  );
}

function setInputStyle(done, current) {
  return {
    background: done ? 'transparent' : UI.bgInset,
    border: `1px solid ${done ? 'transparent' : current ? UI.goldSoft : UI.inkLine}`,
    borderRadius: 8, outline: 'none',
    color: done ? UI.inkSoft : UI.ink,
    fontFamily: UI.fontNum, fontSize: 16, fontWeight: 500,
    width: '100%', padding: '7px 4px', textAlign: 'center',
  };
}

Object.assign(window.Screens, { TrainingScreen });
