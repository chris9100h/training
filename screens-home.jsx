/* App screens — Login, Home, Schedules, Library, History */

const { useState, useEffect, useMemo, useRef } = React;

// ─── LOGIN ────────────────────────────────────────────────────────────
function LoginScreen() {
  const [mode, setMode]         = useState('login');  // 'login' | 'register'
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [info, setInfo]         = useState('');

  const canSubmit = email.trim() && password.length >= 6 && (mode === 'login' || name.trim());

  const submit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true); setError(''); setInfo('');
    try {
      if (mode === 'login') {
        await LB.signIn(email.trim(), password);
        // SIGNED_IN event → App loads data automatically
      } else {
        const { session } = (await LB.signUp(email.trim(), password, name.trim()));
        if (!session) {
          setInfo('Fast fertig! Bestätige deine E-Mail-Adresse und logge dich dann ein.');
          setMode('login');
        }
        // if session exists → SIGNED_IN fires automatically
      }
    } catch (e) {
      setError(e.message || 'Fehler beim Anmelden');
    } finally {
      setLoading(false);
    }
  };

  const logo = (
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
  );

  const tabs = (
    <div style={{ display: 'flex', borderBottom: `1px solid ${UI.inkLine}` }}>
      {[['login','Einloggen'],['register','Registrieren']].map(([id, label]) => (
        <button key={id} onClick={() => { setMode(id); setError(''); setInfo(''); }} style={{
          flex: 1, background: 'none', border: 'none', cursor: 'pointer',
          padding: '10px 0', fontFamily: UI.fontUi, fontSize: 14,
          fontWeight: mode === id ? 600 : 500,
          color: mode === id ? UI.gold : UI.inkSoft,
          borderBottom: `2px solid ${mode === id ? UI.gold : 'transparent'}`,
          marginBottom: -1,
        }}>{label}</button>
      ))}
    </div>
  );

  return (
    <Screen scroll={false} style={{ justifyContent: 'center' }}>
      <div style={{ padding: '24px 24px', display: 'flex', flexDirection: 'column', gap: 20, justifyContent: 'center', flex: 1 }}>
        {logo}
        <div style={{ background: UI.bgRaised, border: `1px solid ${UI.inkLine}`, borderRadius: 16, overflow: 'hidden', marginTop: 8 }}>
          {tabs}
          <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mode === 'register' && (
              <Input label="Name" value={name} onChange={setName} placeholder="Dein Name" autoFocus={mode === 'register'} />
            )}
            <Input label="E-Mail" value={email} onChange={setEmail} placeholder="du@beispiel.de" autoFocus={mode === 'login'} />
            <Input label="Passwort" value={password} onChange={setPassword} type="password" placeholder="mind. 6 Zeichen" />
            {error && (
              <div style={{ fontSize: 12, color: UI.danger, padding: '8px 12px', background: 'rgba(200,116,105,0.08)', borderRadius: 8 }}>
                {error}
              </div>
            )}
            {info && (
              <div style={{ fontSize: 12, color: UI.ok, padding: '8px 12px', background: 'rgba(127,176,105,0.08)', borderRadius: 8 }}>
                {info}
              </div>
            )}
            <Btn
              onClick={submit}
              disabled={!canSubmit || loading}
              style={{ opacity: canSubmit && !loading ? 1 : 0.4, marginTop: 4 }}
            >
              {loading ? 'Bitte warten…' : mode === 'login' ? 'Einloggen →' : 'Konto erstellen →'}
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
  const week = useMemo(() => {
    if (!sch) return [];
    return Array.from({ length: 7 }).map((_, i) => {
      const idx = (dayIdx + i) % dayCount;
      return { ...sch.days[idx], offset: i };
    });
  }, [sch, dayIdx, dayCount]);

  const lastSession = useMemo(() => {
    return [...store.sessions].filter(s => s.ended).sort((a,b) => (b.ended||'').localeCompare(a.ended||''))[0];
  }, [store.sessions]);

  const startSession = () => {
    if (!day || isRest) return;
    const entries = day.items.map(it => {
      const ex = LB.findExercise(store, it.exId);
      const last = LB.lastSessionForExercise(store, it.exId);
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
      id: LB.uid(), scheduleId: sch.id, dayId: day.id, dayName: day.name,
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
        <TabBar active="home" onChange={(t) => go({ name: t })} />
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
            const isToday = i === 0;
            const r = !d.items?.length;
            return (
              <div key={i} style={{
                flex: 1, padding: '8px 4px', textAlign: 'center',
                background: isToday ? UI.goldFaint : UI.bgRaised,
                border: `1px solid ${isToday ? UI.goldSoft : UI.inkLine}`,
                borderRadius: 10,
              }}>
                <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontNum }}>
                  {i === 0 ? 'HEUTE' : `+${i}`}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 3, color: r ? UI.inkSoft : isToday ? UI.gold : UI.ink }}>
                  {r ? '—' : d.name.slice(0, 4)}
                </div>
              </div>
            );
          })}
        </div>

        {/* today's card */}
        {isRest ? (
          <Card>
            <Label>Heute · Tag {dayIdx+1} von {dayCount}</Label>
            <div style={{ fontSize: 28, fontWeight: 600, marginBottom: 4 }}>Rest Day</div>
            <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 14 }}>
              Erholung ist Teil des Plans. Tomorrow is leg day.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={skipRest} style={{ flex: 1 }}>Rest abhaken →</Btn>
              <Btn kind="ghost" onClick={() => go({ name: 'plan' })} style={{ flex: 1 }}>Plan ansehen</Btn>
            </div>
          </Card>
        ) : (
          <Card accent>
            <Label style={{ color: UI.gold }}>Heute · Tag {dayIdx+1} von {dayCount}</Label>
            <div style={{ fontSize: 28, fontWeight: 600, color: UI.gold, marginBottom: 4 }}>{day.name}</div>
            <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 12 }}>
              {day.items.length} Übungen · ~{Math.round(day.items.reduce((a,b) => a + b.sets*2 + 3, 0))} min
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {day.items.map((it, i) => {
                const ex = LB.findExercise(store, it.exId);
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '6px 0', borderBottom: i < day.items.length - 1 ? `1px dashed ${UI.goldSoft}` : 'none' }}>
                    <span style={{ color: UI.ink }}>{ex?.name || '—'}</span>
                    <span style={{ color: UI.gold, fontFamily: UI.fontNum, fontSize: 13 }}>{it.sets} × {it.reps}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Btn onClick={startSession} style={{ width: '100%' }}>Training starten →</Btn>
              <Btn kind="ghost" onClick={async () => { if (await confirm('Der aktuelle Tag wird übersprungen.', { title: 'Tag überspringen?', ok: 'Überspringen' })) skipRest(); }} style={{ width: '100%', fontSize: 13, opacity: 0.6 }}>Tag überspringen</Btn>
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
      <TabBar active="home" onChange={(t) => go({ name: t })} />
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
