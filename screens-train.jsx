/* Training mode — one exercise per screen, swipe through */

const { useState: useStateT, useEffect: useEffectT, useRef: useRefT } = React;

function TrainingScreen({ store, setStore, go, sessionId }) {
  const session = store.sessions.find(s => s.id === sessionId);
  if (!session) { go({ name: 'home' }); return null; }

  const exIdx = session.currentExIdx || 0;
  const entry = session.entries[exIdx];
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
  };

  const addSet = () => {
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx
        ? { ...e, sets: [...e.sets, { kg: e.sets[e.sets.length-1]?.kg ?? null, reps: e.sets[e.sets.length-1]?.reps ?? null, done: false }] }
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

  const abandon = () => {
    if (!confirm('Session abbrechen? Eingaben gehen verloren.')) return;
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

  const [finishOpen, setFinishOpen] = useStateT(false);
  const [noteOpen, setNoteOpen] = useStateT(false);

  if (!entry) {
    return <Screen><Empty title="Diese Session ist leer" action={<Btn onClick={() => go({ name: 'home' })}>Zurück</Btn>} /></Screen>;
  }

  const allSetsDone = entry.sets.every(s => s.done);
  const completed = entry.sets.filter(s => s.done).length;

  return (
    <Screen scroll={false}>
      <TopBar
        title={`${session.dayName} · ${exIdx+1}/${session.entries.length}`}
        sub={'Training läuft'}
        right={<Btn kind="ghost" onClick={abandon} style={{ minHeight: 32, padding: '4px 10px', fontSize: 11, color: UI.danger, borderColor: 'rgba(200,116,105,0.25)' }}>×</Btn>}
      />

      {/* progress dots */}
      <div style={{ display: 'flex', gap: 4, padding: '10px 18px 4px' }}>
        {session.entries.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i < exIdx ? UI.gold : i === exIdx ? UI.gold : UI.inkLine,
            opacity: i === exIdx ? 1 : i < exIdx ? 0.6 : 1,
          }} />
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* exercise heading */}
        <div>
          <div style={{ fontSize: 26, fontWeight: 600 }}>{entry.name}</div>
          <div style={{ fontSize: 12, color: UI.inkFaint, marginTop: 2, fontFamily: UI.fontNum }}>
            Soll: {entry.plannedSets} × {entry.plannedReps}
          </div>
        </div>

        {/* last log card */}
        {last ? (
          <Card style={{ padding: 12, background: UI.bgInset }}>
            <Label style={{ color: UI.gold, marginBottom: 6 }}>
              Letztes Mal · {new Date(last.session.ended || last.session.date).toLocaleDateString('de-DE', { day:'numeric', month:'short' })} ·{' '}
              {Math.round((Date.now() - new Date(last.session.ended || last.session.date)) / 86400000)}d her
            </Label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: UI.fontNum, fontSize: 13, color: UI.ink }}>
              {last.entry.sets.map((s, i) => (
                <span key={i} style={{ opacity: s.kg ? 1 : 0.4 }}>
                  {s.kg || '—'}<span style={{ color: UI.inkFaint }}>×</span>{s.reps || '—'}
                </span>
              ))}
            </div>
            {last.entry.note && (
              <div style={{ fontSize: 11, color: UI.inkFaint, marginTop: 6, fontStyle: 'italic' }}>"{last.entry.note}"</div>
            )}
          </Card>
        ) : (
          <Card style={{ padding: 10, background: UI.bgInset, borderStyle: 'dashed' }}>
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontNum, letterSpacing: '0.1em' }}>
              ERSTE SESSION FÜR DIESE ÜBUNG
            </div>
          </Card>
        )}

        {/* set rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 44px', gap: 8, padding: '0 4px' }}>
            <Label style={{ marginBottom: 0 }}>Set</Label>
            <Label style={{ marginBottom: 0 }}>Gewicht</Label>
            <Label style={{ marginBottom: 0 }}>Reps</Label>
            <span />
          </div>
          {entry.sets.map((s, i) => {
            const current = !s.done && entry.sets.slice(0, i).every(x => x.done);
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '36px 1fr 1fr 44px', gap: 8,
                alignItems: 'center', padding: '8px 8px',
                background: current ? UI.goldFaint : s.done ? UI.bgInset : UI.bgRaised,
                border: `1px solid ${current ? UI.goldSoft : UI.inkLine}`,
                borderRadius: 10,
              }}>
                <div style={{ fontFamily: UI.fontNum, fontSize: 14, color: current ? UI.gold : UI.inkSoft, fontWeight: 600 }}>{i+1}</div>
                <input
                  type="number" inputMode="decimal" step="0.5"
                  value={s.kg ?? ''} placeholder="—"
                  onFocus={e => e.target.select()}
                  onChange={e => updateSet(i, { kg: e.target.value === '' ? null : +e.target.value, done: false })}
                  disabled={s.done}
                  style={setInputStyle(s.done, current)}
                />
                <input
                  type="number" inputMode="numeric"
                  value={s.reps ?? ''} placeholder="—"
                  onFocus={e => e.target.select()}
                  onChange={e => updateSet(i, { reps: e.target.value === '' ? null : +e.target.value, done: false })}
                  disabled={s.done}
                  style={setInputStyle(s.done, current)}
                />
                {s.done ? (
                  <button onClick={() => updateSet(i, { done: false })} style={{
                    background: UI.gold, border: 'none', borderRadius: 8,
                    color: '#0a0a0a', fontSize: 14, fontWeight: 700, cursor: 'pointer', height: 36,
                  }}>✓</button>
                ) : (
                  <button onClick={() => completeSet(i)} disabled={!s.kg || !s.reps} style={{
                    background: current ? UI.gold : 'transparent',
                    border: `1px solid ${current ? UI.gold : UI.inkLine}`,
                    borderRadius: 8, color: current ? '#0a0a0a' : UI.inkFaint,
                    fontSize: 14, fontWeight: 600, cursor: s.kg && s.reps ? 'pointer' : 'not-allowed',
                    height: 36, opacity: !s.kg || !s.reps ? 0.4 : 1,
                  }}>log</button>
                )}
              </div>
            );
          })}
          <button onClick={addSet} style={{
            background: 'transparent', border: `1px dashed ${UI.inkLine}`,
            color: UI.inkSoft, padding: '8px', borderRadius: 8, fontSize: 12,
            cursor: 'pointer', fontFamily: UI.fontUi,
          }}>+ extra Set</button>
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

        {/* note */}
        <button onClick={() => setNoteOpen(true)} style={{
          background: 'transparent', border: `1px dashed ${UI.inkLine}`,
          padding: '10px 14px', borderRadius: 10, color: entry.note ? UI.ink : UI.inkFaint,
          fontSize: 13, textAlign: 'left', cursor: 'pointer', fontFamily: UI.fontUi,
        }}>
          {entry.note ? `📝 ${entry.note}` : '+ Notiz hinzufügen'}
        </button>
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

      {/* note editor */}
      <Sheet open={noteOpen} onClose={() => setNoteOpen(false)} title="Notiz">
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
        <Btn onClick={() => setNoteOpen(false)} style={{ marginTop: 12, width: '100%' }}>Speichern</Btn>
      </Sheet>
    </Screen>
  );
}

function setInputStyle(done, current) {
  return {
    background: 'transparent', border: 'none', outline: 'none',
    color: done ? UI.inkSoft : current ? UI.ink : UI.ink,
    fontFamily: UI.fontNum, fontSize: 18, fontWeight: 500,
    width: '100%', padding: '6px 4px', textAlign: 'center',
  };
}

Object.assign(window.Screens, { TrainingScreen });
