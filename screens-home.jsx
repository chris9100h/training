/* App screens — Login, Home, Schedules, Library, History */

const { useState, useEffect, useMemo, useRef } = React;

// ─── LOGIN ────────────────────────────────────────────────────────────
function LoginScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const canSubmit = email.trim() && password.length >= 6;

  const submit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true); setError('');
    try {
      await LB.signIn(email.trim(), password);
      // SIGNED_IN event → App loads data automatically
    } catch (e) {
      setError(e.message || 'Fehler beim Anmelden');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll={false} style={{ justifyContent: 'center' }}>
      <div style={{ padding: '24px 24px', display: 'flex', flexDirection: 'column', gap: 20, justifyContent: 'center', flex: 1 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, margin: '0 auto 14px', borderRadius: '50%',
            border: `1.5px solid ${UI.gold}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: UI.gold, fontSize: 28, fontWeight: 700,
          }}>L</div>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '0.04em', color: UI.gold }}>LOGBOOK</div>
          <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontNum, letterSpacing: '0.1em', marginTop: 4 }}>
            iron · sweat · numbers
          </div>
        </div>
        <div style={{ background: UI.bgRaised, border: `1px solid ${UI.inkLine}`, borderRadius: 16, overflow: 'hidden', marginTop: 8 }}>
          <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input label="E-Mail" value={email} onChange={setEmail} placeholder="du@beispiel.de" autoFocus uppercase={false} />
            <Input label="Passwort" value={password} onChange={setPassword} type="password" placeholder="mind. 6 Zeichen" />
            {error && (
              <div style={{ fontSize: 12, color: UI.danger, padding: '8px 12px', background: 'rgba(200,116,105,0.08)', borderRadius: 8 }}>
                {error}
              </div>
            )}
            <Btn
              onClick={submit}
              disabled={!canSubmit || loading}
              style={{ opacity: canSubmit && !loading ? 1 : 0.4, marginTop: 4 }}
            >
              {loading ? 'Bitte warten…' : 'Einloggen →'}
            </Btn>
          </div>
        </div>
      </div>
    </Screen>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────
function HomeScreen({ store, setStore, go }) {
  const [confirmEl, confirm] = useConfirm();
  const today = LB.todaysDay(store);
  const sch = today?.schedule;
  const day = today?.day;
  const dayIdx = today?.idx ?? 0;
  const isRest = day && (!day.items || day.items.length === 0);
  const dayCount = sch?.days?.length || 0;
  const weekdayMode = sch ? LB.isWeekdayPlan(sch) : false;

  const jsDay = new Date().getDay();
  const todayWd = jsDay === 0 ? 6 : jsDay - 1;
  const [selectedWd, setSelectedWd] = useState(todayWd);

  const week = useMemo(() => {
    if (!sch) return [];
    if (weekdayMode) {
      return Array.from({ length: 7 }).map((_, i) => {
        const trainingDay = sch.days.find(d => d.weekday === i);
        return {
          id: `wd-${i}`, weekday: i, isToday: i === todayWd,
          name: trainingDay?.name ?? 'REST',
          items: trainingDay?.items ?? [],
        };
      });
    }
    return Array.from({ length: 7 }).map((_, i) => {
      const idx = (dayIdx + i) % dayCount;
      return { ...sch.days[idx], offset: i };
    });
  }, [sch, dayIdx, dayCount, weekdayMode, todayWd]);

  const activeDay = useMemo(() => {
    if (!weekdayMode || !sch) return day;
    const found = sch.days.find(d => d.weekday === selectedWd);
    return found ?? { id: 'rest-virtual', name: 'REST', items: [], weekday: selectedWd };
  }, [weekdayMode, sch, selectedWd, day]);

  const isActiveRest = activeDay && (!activeDay.items || activeDay.items.length === 0);
  const isViewingToday = !weekdayMode || selectedWd === todayWd;

  const lastSession = useMemo(() => {
    return [...store.sessions].filter(s => s.ended).sort((a,b) => (b.ended||'').localeCompare(a.ended||''))[0];
  }, [store.sessions]);

  const startSession = () => {
    if (!activeDay || isActiveRest) return;
    const entries = activeDay.items.map(it => {
      const ex = LB.findExercise(store, it.exId);
      const last = LB.lastSessionForExercise(store, it.exId, activeDay.name);
      const seedSets = Array.from({ length: it.sets }).map((_, i) => {
        const prev = last?.entry?.sets?.[i];
        return { kg: prev?.kg ?? null, reps: prev?.reps ?? null, done: false };
      });
      return {
        exId: it.exId, name: ex?.name || '?',
        plannedSets: it.sets, plannedReps: it.reps,
        sets: seedSets, note: '',
      };
    });
    const session = {
      id: LB.uid(), scheduleId: sch.id, dayId: activeDay.id, dayName: activeDay.name,
      date: new Date().toISOString(), ended: null, entries, currentExIdx: 0,
    };
    setStore(s => ({
      ...s,
      sessions: [...s.sessions, session],
      inProgress: session.id,
    }));
    go({ name: 'train', sessionId: session.id });
  };

  const skipRest = () => {
    setStore(s => ({ ...s, cycleIndex: s.cycleIndex + 1, lastAdvancedDate: LB.todayISO() }));
  };

  if (!sch) {
    return (
      <Screen>
        <TopBar title={`Hey ${store.user.name}`} sub={new Date().toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' })}
          right={<Btn kind="icon" onClick={() => go({ name: 'settings' })} style={{ fontSize: 20 }}>⋯</Btn>}
        />
        <div style={{ padding: 18 }}>
          <Empty
            title="Noch kein Plan"
            sub="Lege einen Trainingsplan an, um loszulegen."
            action={<Btn onClick={() => go({ name: 'schedule-new' })}>Plan anlegen</Btn>}
          />
        </div>
        {confirmEl}
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar
        title={`Hey ${store.user.name}`}
        sub={new Date().toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' })}
        right={<Btn kind="icon" onClick={() => go({ name: 'settings' })} style={{ fontSize: 20 }}>⋯</Btn>}
      />

      <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* week strip */}
        <div style={{ display: 'flex', gap: 6 }}>
          {week.map((d, i) => {
            const isToday = weekdayMode ? d.isToday : i === 0;
            const isSelected = weekdayMode ? i === selectedWd : i === 0;
            const r = !d.items?.length;
            return (
              <div key={d.id ?? i}
                onClick={weekdayMode ? () => setSelectedWd(i) : undefined}
                style={{
                  flex: 1, padding: '8px 4px', textAlign: 'center',
                  background: isSelected ? UI.goldFaint : UI.bgRaised,
                  border: `1px solid ${isSelected ? UI.goldSoft : isToday ? UI.inkSoft : UI.inkLine}`,
                  borderRadius: 10,
                  cursor: weekdayMode ? 'pointer' : 'default',
                }}>
                <div style={{ fontSize: 9, color: isSelected ? UI.gold : isToday ? UI.inkSoft : UI.inkFaint, fontFamily: UI.fontNum }}>
                  {weekdayMode ? WEEKDAYS[i] : (i === 0 ? 'HEUTE' : `+${i}`)}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 3, color: r ? UI.inkSoft : isSelected ? UI.gold : UI.ink }}>
                  {r ? '—' : d.name.slice(0, 4)}
                </div>
              </div>
            );
          })}
        </div>

        {/* day card */}
        {isActiveRest ? (
          <Card>
            <Label>
              {weekdayMode
                ? (isViewingToday ? `Heute · ${WEEKDAYS_FULL[selectedWd]}` : WEEKDAYS_FULL[selectedWd])
                : `Heute · Tag ${dayIdx+1} von ${dayCount}`}
            </Label>
            <div style={{ fontSize: 28, fontWeight: 600, marginBottom: 4 }}>Rest Day</div>
            <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 14 }}>
              Erholung ist Teil des Plans. Tomorrow is leg day.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {!weekdayMode && <Btn kind="ghost" onClick={skipRest} style={{ flex: 1 }}>Rest abhaken →</Btn>}
              <Btn kind="ghost" onClick={() => go({ name: 'plan' })} style={{ flex: 1 }}>Plan ansehen</Btn>
            </div>
          </Card>
        ) : (
          <Card accent>
            <Label style={{ color: UI.gold }}>
              {weekdayMode
                ? (isViewingToday ? `Heute · ${WEEKDAYS_FULL[selectedWd]}` : WEEKDAYS_FULL[selectedWd])
                : `Heute · Tag ${dayIdx+1} von ${dayCount}`}
            </Label>
            <div style={{ fontSize: 28, fontWeight: 600, color: UI.gold, marginBottom: 4 }}>{activeDay.name}</div>
            <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 12 }}>
              {activeDay.items.length} Übungen · ~{Math.round(activeDay.items.reduce((a,b) => a + b.sets*2 + 3, 0))} min
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {activeDay.items.map((it, i) => {
                const ex = LB.findExercise(store, it.exId);
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '6px 0', borderBottom: i < activeDay.items.length - 1 ? `1px dashed ${UI.goldSoft}` : 'none' }}>
                    <span style={{ color: UI.ink }}>{ex?.name || '—'}</span>
                    <span style={{ color: UI.gold, fontFamily: UI.fontNum, fontSize: 13 }}>{it.sets} × {it.reps}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Btn onClick={startSession} style={{ width: '100%' }}>Training starten →</Btn>
              {!weekdayMode && <Btn kind="ghost" onClick={async () => { if (await confirm('Der aktuelle Tag wird übersprungen.', { title: 'Tag überspringen?', ok: 'Überspringen' })) skipRest(); }} style={{ width: '100%', fontSize: 13, opacity: 0.6 }}>Tag überspringen</Btn>}
            </div>
          </Card>
        )}

        {/* last session preview */}
        {lastSession && (
          <Card style={{ padding: 14 }}>
            <Label>Letzte Session</Label>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{lastSession.dayName}</div>
                <div style={{ fontSize: 12, color: UI.inkFaint }}>
                  {new Date(lastSession.ended).toLocaleDateString('de-DE', { day:'numeric', month:'short' })} ·{' '}
                  {totalVolume(lastSession).toLocaleString('de-DE')} kg
                </div>
              </div>
              <Btn kind="icon" onClick={() => go({ name: 'session', sessionId: lastSession.id })} style={{ color: UI.gold, fontSize: 18 }}>→</Btn>
            </div>
          </Card>
        )}
      </div>
      {confirmEl}
    </Screen>
  );
}

function totalVolume(session) {
  return session.entries.reduce((sum, ex) =>
    sum + (ex.sets || []).reduce((s, st) => s + (+st.kg || 0) * (+st.reps || 0), 0), 0
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { LoginScreen, HomeScreen });
window.totalVolume = totalVolume;
