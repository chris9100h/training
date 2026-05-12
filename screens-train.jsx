/* Training mode — one exercise per screen, swipe through */

const { useState: useStateT, useEffect: useEffectT, useRef: useRefT } = React;

function TrainingScreen({ store, setStore, go, sessionId }) {
  const session = store.sessions.find(s => s.id === sessionId);
  if (!session) { go({ name: 'home' }); return null; }

  const exIdx = session.currentExIdx || 0;
  const entry = session.entries[exIdx];
  const exercise = entry ? LB.findExercise(store, entry.exId) : null;
  const last = entry ? LB.lastSessionForExercise(store, entry.exId) : null;

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

  // ── rest timer ────────────────────────────────────────────
  const [restStart, setRestStart] = useStateT(null);
  const [now, setNow] = useStateT(Date.now());
  useEffectT(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const restDef = store.settings?.restDefault || 120;
  const restElapsed = restStart ? Math.floor((now - restStart) / 1000) : null;
  const restRemaining = restElapsed != null ? Math.max(0, restDef - restElapsed) : null;
  const restPct = restElapsed != null ? Math.min(100, (restElapsed / restDef) * 100) : 0;

  const [confirmEl, confirm] = useConfirm();
  const [finishOpen, setFinishOpen] = useStateT(false);
  const [notePicker, setNotePicker] = useStateT(false);
  const [sessionNoteOpen, setSessionNoteOpen] = useStateT(false);
  const [exNoteOpen, setExNoteOpen] = useStateT(false);
  const [exNoteVal, setExNoteVal] = useStateT('');

  const saveExNote = () => {
    setStore(s => ({ ...s, exercises: s.exercises.map(e => e.id === entry.exId ? { ...e, note: exNoteVal.trim() } : e) }));
    setExNoteOpen(false);
  };

  if (!entry) {
    return <Screen><Empty title="Diese Session ist leer" action={<Btn onClick={() => go({ name: 'home' })}>Zurück</Btn>} /></Screen>;
  }

  const completed = entry.sets.filter(s => s.done).length;
  const currentSetNum = Math.min(completed + 1, entry.sets.length);

  return (
    <Screen scroll={false}>
      <TopBar
        title={`${session.dayName} · ${exIdx+1}/${session.entries.length}`}
        sub="Training läuft"
        right={<Btn kind="ghost" onClick={abandon} style={{ minHeight: 32, padding: '4px 10px', fontSize: 11, color: UI.danger, borderColor: 'rgba(200,116,105,0.25)' }}>×</Btn>}
      />

      {/* progress chips — clickable, horizontally scrollable */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 18px 0', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {session.entries.map((e, i) => {
          const done = e.sets.every(s => s.done);
          const active = i === exIdx;
          return (
            <button key={i} onClick={() => updateSession(sess => ({ ...sess, currentExIdx: i }))}
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

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* heading + session note chip */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>{entry.name}</div>
            <div style={{ fontSize: 14, color: UI.inkSoft, marginTop: 4 }}>
              Set {currentSetNum} of {entry.sets.length}
            </div>
          </div>
          <button onClick={() => setNotePicker(true)} style={{
            background: entry.note ? UI.goldFaint : 'transparent',
            border: `1px solid ${entry.note ? UI.goldSoft : UI.inkLine}`,
            borderRadius: 20, padding: '6px 12px', cursor: 'pointer',
            color: entry.note ? UI.gold : UI.inkFaint, fontSize: 12,
            fontFamily: UI.fontUi, flexShrink: 0, marginTop: 2,
          }}>
            📝 {entry.note ? 'Notiz' : '+ Notiz'}
          </button>
        </div>

        {/* set table */}
        <div>
          {/* table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px 72px 36px 24px', gap: 8, padding: '0 2px 8px', borderBottom: `1px solid ${UI.inkLine}` }}>
            <Label style={{ marginBottom: 0, fontSize: 11 }}>Set</Label>
            <Label style={{ marginBottom: 0, fontSize: 11 }}>Vorherige ↔</Label>
            <Label style={{ marginBottom: 0, fontSize: 11, textAlign: 'center' }}>kg</Label>
            <Label style={{ marginBottom: 0, fontSize: 11, textAlign: 'center' }}>Reps</Label>
            <div style={{ width: 22, height: 22, border: `2px solid ${UI.inkLine}`, borderRadius: 5, alignSelf: 'center', justifySelf: 'center' }} />
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
                <input
                  type="number" inputMode="decimal" step="0.5"
                  value={s.kg ?? ''} placeholder="—"
                  onFocus={e => e.target.select()}
                  onChange={e => updateSet(i, { kg: e.target.value === '' ? null : +e.target.value, done: false })}
                  disabled={s.done}
                  style={setInputStyle(s.done, current)}
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

          {/* add set */}
          <button onClick={addSet} style={{
            marginTop: 10, width: 36, height: 36, borderRadius: '50%',
            background: 'transparent', border: `1px solid ${UI.inkLine}`,
            color: UI.inkSoft, fontSize: 20, lineHeight: 1, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>+</button>
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

      {/* footer nav */}
      <div style={{ borderTop: `1px solid ${UI.inkLine}`, padding: '10px 18px calc(env(safe-area-inset-bottom, 8px) + 12px)', background: UI.bg, display: 'flex', gap: 8 }}>
        <Btn kind="ghost" onClick={() => navigate(-1)} disabled={exIdx === 0} style={{ flex: 1, opacity: exIdx === 0 ? 0.3 : 1 }}>‹ zurück</Btn>
        <Btn onClick={() => navigate(1)} style={{ flex: 2 }}>
          {exIdx === session.entries.length - 1 ? 'Fertig →' : 'Nächste Übung →'}
        </Btn>
      </div>

      {/* finish confirmation */}
      <Sheet open={finishOpen} onClose={() => setFinishOpen(false)} title="Session beenden?">
        <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 14 }}>
          {session.entries.reduce((c, e) => c + e.sets.filter(s => s.done).length, 0)} von{' '}
          {session.entries.reduce((c, e) => c + e.sets.length, 0)} Sets geloggt ·{' '}
          {Math.round(totalVolume(session)).toLocaleString('de-DE')} kg Gesamtvolumen
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => setFinishOpen(false)} style={{ flex: 1 }}>Weiter trainieren</Btn>
          <Btn onClick={finish} style={{ flex: 2 }}>Beenden ✓</Btn>
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
