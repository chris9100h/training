/* App screens — Login, Home — Haute Horlogerie redesign
   Logic identical to original (Supabase auth, cycle/weekday modes,
   in-progress overlay, skipRest, future-slot retroactive logging).
*/

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
    } catch (e) {
      setError(e.message || 'Fehler beim Anmelden');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll={false} style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="guilloche" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

      <div style={{ flexShrink: 0, padding: 'calc(env(safe-area-inset-top, 0px) + 18px) 22px 0', display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
        <span className="micro">LOGBOOK · CAL. M.01</span>
        <span className="micro">EST. 2024</span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 32px', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          {/* Dial-style logo */}
          <div style={{
            width: 140, height: 140, borderRadius: '50%',
            border: `0.5px solid ${UI.goldSoft}`,
            background: `radial-gradient(circle at 50% 30%, rgba(201,169,97,0.10), transparent 60%), ${UI.bgRaised}`,
            position: 'relative',
            boxShadow: `0 0 0 6px ${UI.bg}, 0 0 0 6.5px ${UI.hair}, 0 0 80px rgba(201,169,97,0.12)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} style={{
                position: 'absolute', top: 5, left: '50%',
                width: i % 3 === 0 ? 1 : 0.5,
                height: i % 3 === 0 ? 9 : 5,
                background: i % 3 === 0 ? UI.gold : UI.hairStrong,
                transform: `translateX(-50%) rotate(${i * 30}deg)`,
                transformOrigin: '50% 65px',
              }} />
            ))}
            <span style={{ fontFamily: UI.fontDisplay, fontSize: 56, color: UI.gold, fontStyle: 'italic', fontWeight: 400, letterSpacing: '-0.04em' }}>L</span>
          </div>
          <div style={{ marginTop: 26, textAlign: 'center' }}>
            <div className="display" style={{ fontSize: 30, color: UI.ink, letterSpacing: '0.18em' }}>LOGBOOK</div>
            <div className="micro" style={{ marginTop: 6 }}>FERRUM · SUDOR · NUMERI</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <Field label="E-Mail">
            <TextInput value={email} onChange={setEmail} placeholder="du@beispiel.de" autoFocus />
          </Field>
          <Field label="Passwort">
            <TextInput value={password} onChange={setPassword} type="password" placeholder="mind. 6 Zeichen" />
          </Field>
          {error && (
            <div style={{
              fontSize: 12, color: UI.danger,
              padding: '10px 14px',
              background: 'rgba(200,116,105,0.06)',
              border: `0.5px solid rgba(200,116,105,0.25)`,
              borderRadius: 10,
              fontFamily: UI.fontUi,
            }}>
              {error}
            </div>
          )}
          <Btn onClick={submit} disabled={!canSubmit || loading} style={{ marginTop: 4, opacity: canSubmit && !loading ? 1 : 0.4 }}>
            {loading ? 'Anmelden…' : 'Einloggen'}
          </Btn>
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: '0 22px calc(env(safe-area-inset-bottom, 8px) + 18px)', display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
        <span className="micro">REF. LB-V2-2026</span>
        <span className="micro">SWISS MADE</span>
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
  const dayCount = sch?.days?.length || 0;
  const weekdayMode = sch ? LB.isWeekdayPlan(sch) : false;

  const jsDay = new Date().getDay();
  const todayWd = jsDay === 0 ? 6 : jsDay - 1;

  // Auto-migrate from cycleIndex to cycleStartDate on first load
  useEffect(() => {
    if (!weekdayMode && sch && !store.cycleStartDate) {
      const today = new Date(); today.setHours(12, 0, 0, 0);
      const start = new Date(today.getTime() - (store.cycleIndex || 0) * 86400000);
      setStore(s => s.cycleStartDate ? s : { ...s, cycleStartDate: start.toISOString().slice(0, 10) });
    }
  }, []); // eslint-disable-line

  const todayN = useMemo(() => {
    if (weekdayMode || !store.cycleStartDate) return store.cycleIndex || 0;
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = new Date(store.cycleStartDate + 'T12:00:00');
    return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000));
  }, [store.cycleStartDate, store.cycleIndex, weekdayMode]);

  const currentCycleNum = dayCount > 0 ? Math.floor(todayN / dayCount) : 0;

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedWd, setSelectedWd] = useState(todayWd);
  const [selectedSlot, setSelectedSlot] = useState(dayIdx);

  const minOffset = weekdayMode ? -8 : -(currentCycleNum + 1);
  const goBack = () => {
    if (weekOffset <= minOffset) return;
    const next = weekOffset - 1;
    setWeekOffset(next);
    if (!weekdayMode) setSelectedSlot(dayCount - 1);
  };
  const goForward = () => {
    if (weekOffset >= 0) return;
    const next = weekOffset + 1;
    setWeekOffset(next);
    if (next === 0) {
      setSelectedSlot(dayIdx);
      setSelectedWd(todayWd);
    } else if (!weekdayMode) {
      setSelectedSlot(dayCount - 1);
    }
  };

  const week = useMemo(() => {
    if (!sch) return [];
    if (weekdayMode) {
      return Array.from({ length: 7 }).map((_, i) => {
        const trainingDay = sch.days.find(d => d.weekday === i);
        const diff = i - todayWd + weekOffset * 7;
        const date = new Date(); date.setDate(date.getDate() + diff);
        return {
          id: `wd-${i}`, weekday: i,
          isToday: i === todayWd && weekOffset === 0,
          name: trainingDay?.name ?? 'REST',
          items: trainingDay?.items ?? [],
          date,
        };
      });
    }
    return sch.days.map((d, i) => {
      const daysFromToday = weekOffset * dayCount + i - dayIdx;
      const date = new Date(); date.setDate(date.getDate() + daysFromToday);
      return { ...d, slotIdx: i, date, isToday: weekOffset === 0 && i === dayIdx };
    });
  }, [sch, dayIdx, dayCount, weekdayMode, todayWd, weekOffset]);

  const activeDay = useMemo(() => {
    if (!sch) return day;
    if (weekdayMode) {
      const found = sch.days.find(d => d.weekday === selectedWd);
      return found ?? { id: 'rest-virtual', name: 'REST', items: [], weekday: selectedWd };
    }
    return sch.days[selectedSlot] ?? sch.days[0];
  }, [weekdayMode, sch, selectedWd, selectedSlot, day]);

  const sessionDate = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    if (weekdayMode) {
      d.setDate(d.getDate() + selectedWd - todayWd + weekOffset * 7);
    } else {
      d.setDate(d.getDate() + weekOffset * dayCount + selectedSlot - dayIdx);
    }
    return d;
  }, [weekdayMode, selectedWd, todayWd, weekOffset, selectedSlot, dayIdx, dayCount]);

  const isViewingToday = weekOffset === 0 && (weekdayMode ? selectedWd === todayWd : selectedSlot === dayIdx);
  const isActiveRest = !activeDay?.items?.length;
  const isFutureSlot = sessionDate > (() => { const d = new Date(); d.setHours(12,0,0,0); return d; })();

  const periodLabel = useMemo(() => {
    if (weekdayMode) {
      if (weekOffset === 0) return 'DIESE WOCHE';
      if (weekOffset === -1) return 'LETZTE WOCHE';
      return `VOR ${-weekOffset} WOCHEN`;
    }
    const cycleNum = currentCycleNum + weekOffset + 1;
    return `ZYKLUS ${cycleNum}`;
  }, [weekdayMode, weekOffset, currentCycleNum]);

  const cardLabel = useMemo(() => {
    if (isViewingToday) {
      return weekdayMode
        ? `HEUTE · ${WEEKDAYS_FULL[selectedWd].toUpperCase()}`
        : `HEUTE · TAG ${selectedSlot + 1} VON ${dayCount}`;
    }
    const dateStr = sessionDate.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
    return weekdayMode ? dateStr : `${dateStr} · TAG ${selectedSlot + 1} VON ${dayCount}`;
  }, [isViewingToday, weekdayMode, selectedWd, selectedSlot, dayCount, sessionDate]);

  const lastSession = useMemo(() => {
    return [...store.sessions].filter(s => s.ended).sort((a,b) => (b.ended||'').localeCompare(a.ended||''))[0];
  }, [store.sessions]);

  const completedCyclePos = useMemo(() => {
    if (weekdayMode || !sch) return null;
    const set = new Set();
    if (store.cycleStartDate) {
      const start = new Date(store.cycleStartDate + 'T12:00:00');
      store.sessions.filter(s => s.ended).forEach(s => {
        const d = new Date(s.date.slice(0, 10) + 'T12:00:00');
        set.add(Math.round((d - start) / 86400000));
      });
    } else {
      store.sessions.filter(s => s.ended && s.cyclePos != null).forEach(s => set.add(s.cyclePos));
    }
    return set;
  }, [store.sessions, weekdayMode, sch, store.cycleStartDate]);

  const completedDateKeys = useMemo(() => {
    if (!weekdayMode) return null;
    const set = new Set();
    store.sessions.filter(s => s.ended).forEach(s => {
      const d = new Date(s.date.slice(0, 10) + 'T12:00:00');
      set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    });
    return set;
  }, [store.sessions, weekdayMode]);

  const isSlotDone = useMemo(() => {
    if (isActiveRest) return false;
    if (weekdayMode) {
      const key = `${sessionDate.getFullYear()}-${sessionDate.getMonth()}-${sessionDate.getDate()}`;
      return completedDateKeys?.has(key) ?? false;
    }
    const pos = (currentCycleNum + weekOffset) * dayCount + selectedSlot;
    return completedCyclePos?.has(pos) ?? false;
  }, [isActiveRest, weekdayMode, sessionDate, completedDateKeys, completedCyclePos, currentCycleNum, weekOffset, dayCount, selectedSlot]);

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
    const nowISO = new Date().toISOString();
    const cyclePos = weekdayMode ? null : (currentCycleNum + weekOffset) * dayCount + selectedSlot;
    const session = {
      id: LB.uid(), scheduleId: sch.id, dayId: activeDay.id, dayName: activeDay.name,
      date: sessionDate.toISOString(), startedAt: nowISO, ended: null, entries, currentExIdx: 0,
      cyclePos,
    };
    setStore(s => ({ ...s, sessions: [...s.sessions, session], inProgress: session.id }));
    go({ name: 'train', sessionId: session.id });
  };

  const skipRest = () => {
    if (store.cycleStartDate) {
      const start = new Date(store.cycleStartDate + 'T12:00:00');
      start.setDate(start.getDate() - 1);
      setStore(s => ({ ...s, cycleStartDate: start.toISOString().slice(0, 10), lastAdvancedDate: LB.todayISO() }));
    } else {
      setStore(s => ({ ...s, cycleIndex: s.cycleIndex + 1, lastAdvancedDate: LB.todayISO() }));
    }
  };

  // ─── No-plan fallback
  if (!sch) {
    return (
      <Screen>
        <TopBar
          title={<span>Hey, <em style={{ fontFamily: UI.fontDisplay, fontStyle: 'italic', fontWeight: 300, color: UI.gold }}>{store.user.name}</em></span>}
          sub={new Date().toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' })}
          right={<button onClick={() => go({ name: 'settings' })} style={{ ...btnIcon, fontSize: 20, color: UI.inkSoft, width: 36, height: 36, borderRadius: '50%', border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⋯</button>}
        />
        <div style={{ padding: 22 }}>
          <Empty
            title="Noch kein Plan"
            sub="Lege einen Trainingsplan an, um loszulegen."
            action={<Btn onClick={() => go({ name: 'schedule-new' })}>Plan anlegen</Btn>}
            icon={ICON_CALENDAR}
          />
        </div>
        {confirmEl}
      </Screen>
    );
  }

  return (
    <Screen scroll={false} style={{ position: 'relative' }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        padding: `calc(env(safe-area-inset-top, 0px) + 16px) 22px 16px`,
        borderBottom: `0.5px solid ${UI.hair}`,
        position: 'sticky', top: 0, zIndex: 5,
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        background: 'rgba(7,6,10,0.85)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="micro">{new Date().toLocaleDateString('de-DE', { weekday:'long', day:'2-digit', month:'long' }).toUpperCase()}</div>
            <div style={{ marginTop: 6, fontFamily: UI.fontDisplay, fontSize: 26, color: UI.ink, fontWeight: 400, lineHeight: 1.1 }}>
              Hey, <em style={{ fontStyle: 'italic', fontWeight: 300, color: UI.gold }}>{store.user.name}</em>
            </div>
          </div>
          <button onClick={() => go({ name: 'settings' })} style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: UI.inkSoft,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* In-progress overlay */}
      {store.inProgress && (() => {
        const activeSession = store.sessions.find(s => s.id === store.inProgress);
        return activeSession ? (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: 'rgba(7,6,10,0.92)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 28,
          }}>
            <BracketFrame gold padding={32} style={{ width: '100%', maxWidth: 360 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: UI.gold, animation: 'pulseDot 1.4s ease-in-out infinite' }} />
                  <span className="micro-gold">TRAINING LÄUFT</span>
                </div>
                <div className="display" style={{ fontSize: 38, color: UI.gold, fontWeight: 300, fontStyle: 'italic', letterSpacing: '0.04em' }}>
                  {activeSession.dayName}
                </div>
                <Btn onClick={() => go({ name: 'train', sessionId: store.inProgress })} style={{ width: '100%', marginTop: 6 }}>
                  Weitermachen →
                </Btn>
                <button onClick={async () => {
                  if (!await confirm('Session wird gelöscht.', { title: 'Training abbrechen?', ok: 'Abbrechen', cancel: 'Zurück', danger: true })) return;
                  setStore(s => ({ ...s, sessions: s.sessions.filter(x => x.id !== store.inProgress), inProgress: null }));
                }} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, padding: '4px 0',
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                }}>Training abbrechen</button>
              </div>
            </BracketFrame>
          </div>
        ) : null;
      })()}

      <div style={{ flex: 1, minHeight: 0, padding: '16px 22px 18px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>

        {/* Period navigation */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={goBack} disabled={weekOffset <= minOffset} style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'transparent',
            border: `0.5px solid ${weekOffset <= minOffset ? 'transparent' : UI.hairStrong}`,
            color: weekOffset <= minOffset ? UI.inkGhost : UI.inkSoft,
            cursor: weekOffset <= minOffset ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M6 1 1 6l5 5"/></svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <span className="micro" style={{ color: UI.inkSoft }}>{periodLabel}</span>
          </div>
          <button onClick={goForward} disabled={weekOffset === 0} style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'transparent',
            border: `0.5px solid ${weekOffset === 0 ? 'transparent' : UI.hairStrong}`,
            color: weekOffset === 0 ? UI.inkGhost : UI.inkSoft,
            cursor: weekOffset === 0 ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M2 1l5 5-5 5"/></svg>
          </button>
        </div>

        {/* day strip */}
        <div style={{ flexShrink: 0, display: 'flex', gap: 4 }}>
          {week.map((d, i) => {
            const isSelected = weekdayMode ? i === selectedWd : i === selectedSlot;
            const r = !d.items?.length;
            const slotLabel = weekdayMode
              ? WEEKDAYS[i]
              : d.date.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' }).replace(/\.$/, '');
            let isCompleted = false;
            if (!r) {
              if (weekdayMode) {
                const slotKey = `${d.date.getFullYear()}-${d.date.getMonth()}-${d.date.getDate()}`;
                isCompleted = completedDateKeys?.has(slotKey) ?? false;
              } else {
                const pos = (currentCycleNum + weekOffset) * dayCount + i;
                isCompleted = completedCyclePos?.has(pos) ?? false;
              }
            }
            return (
              <div key={d.id ?? i}
                onClick={() => weekdayMode ? setSelectedWd(i) : setSelectedSlot(i)}
                style={{
                  flex: 1, padding: '10px 4px 8px', textAlign: 'center',
                  background: isSelected ? UI.goldFaint : 'transparent',
                  border: `0.5px solid ${isSelected ? UI.goldSoft : d.isToday ? UI.hairStrong : UI.hair}`,
                  borderRadius: 8, cursor: 'pointer',
                  minHeight: 56,
                }}>
                <div className="num" style={{ fontSize: 9, color: isSelected ? UI.gold : d.isToday ? UI.inkSoft : UI.inkFaint }}>
                  {slotLabel}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: r ? UI.inkFaint : isSelected ? UI.gold : UI.ink, letterSpacing: '0.06em' }}>
                  {r ? '—' : d.name.slice(0, 4)}
                </div>
                <div style={{ height: 12, marginTop: 2 }}>
                  {isCompleted && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.5" style={{ display: 'block', margin: '0 auto' }}>
                      <path d="M2 6l2.5 2.5L10 3"/>
                    </svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* day card — flex:1 so it fills */}
        {isActiveRest ? (
          <BracketFrame style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 28 }}>
            <div className="micro" style={{ marginBottom: 8 }}>{cardLabel}</div>
            <div className="display-it" style={{ fontSize: 44, color: UI.inkSoft, fontStyle: 'italic', fontWeight: 300, letterSpacing: '0.02em', marginBottom: 6 }}>
              Recover.
            </div>
            <div style={{ fontSize: 13, color: UI.inkFaint, marginBottom: 22, maxWidth: 220 }}>
              Erholung ist Teil des Plans.
            </div>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              {!weekdayMode && isViewingToday && <Btn kind="ghost" onClick={skipRest} style={{ flex: 1 }}>Rest abhaken</Btn>}
              <Btn kind="ghost" onClick={() => go({ name: 'plan' })} style={{ flex: 1 }}>Plan ansehen</Btn>
            </div>
          </BracketFrame>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 0' }}>
            <div className="micro-gold" style={{ marginBottom: 6 }}>{cardLabel}</div>
            <div className="display" style={{
              fontSize: 56, color: UI.gold,
              fontWeight: 300, fontStyle: 'italic',
              letterSpacing: '0.04em', lineHeight: 1, marginBottom: 24,
            }}>
              {activeDay.name}
            </div>

            {/* Complications — 3 SubDials */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
              <SubDial size={80} label="ÜBUNGEN" value={activeDay.items.length} />
              <div style={{ width: '0.5px', height: 36, background: UI.hair }} />
              <SubDial size={80} label="MIN" value={`~${Math.round(activeDay.items.reduce((a,b) => a + b.sets*2 + 3, 0))}`} />
              <div style={{ width: '0.5px', height: 36, background: UI.hair }} />
              <SubDial size={80} label="SÄTZE" value={activeDay.items.reduce((a,b) => a + b.sets, 0)} />
            </div>

            {/* CTAs */}
            {isSlotDone ? (
              <Frame style={{ padding: '14px 18px', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: UI.goldFaint, border: `0.5px solid ${UI.goldSoft}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.5"><path d="M2 6l2.5 2.5L10 3"/></svg>
                  </div>
                  <div>
                    <div className="micro-gold" style={{ marginBottom: 2 }}>TRAINING ERLEDIGT</div>
                    <div style={{ fontSize: 13, color: UI.inkSoft }}>Gut gemacht.</div>
                  </div>
                </div>
              </Frame>
            ) : (
              <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                <CrownButton onClick={startSession} size={140}>
                  <span className="micro" style={{ color: 'rgba(10,8,5,0.65)', letterSpacing: '0.22em', fontWeight: 600 }}>
                    {isFutureSlot && !isViewingToday ? 'PLAN' : isViewingToday ? 'START' : 'LOG'}
                  </span>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="#0a0805" style={{ marginTop: 2 }}>
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  <span className="micro" style={{ color: 'rgba(10,8,5,0.55)', marginTop: 2 }}>
                    {isViewingToday ? 'TRAINING' : 'EINTRAGEN'}
                  </span>
                </CrownButton>
                {!weekdayMode && isViewingToday && (
                  <CrownButton
                    onClick={async () => { if (await confirm('Der aktuelle Tag wird übersprungen.', { title: 'Tag überspringen?', ok: 'Überspringen' })) skipRest(); }}
                    size={110}
                    style={{ animation: 'none', opacity: 0.75 }}
                  >
                    <span className="micro" style={{ color: 'rgba(10,8,5,0.6)', letterSpacing: '0.18em', fontWeight: 600 }}>TAG</span>
                    <span style={{ fontSize: 22, color: 'rgba(10,8,5,0.65)', fontFamily: UI.fontDisplay, fontStyle: 'italic', lineHeight: 1 }}>→</span>
                    <span className="micro" style={{ color: 'rgba(10,8,5,0.45)', marginTop: 1 }}>SKIP</span>
                  </CrownButton>
                )}
              </div>
            )}
          </div>
        )}

        {/* last session strip */}
        {lastSession && (
          <Frame onClick={() => go({ name: 'session', sessionId: lastSession.id })} style={{ flexShrink: 0, padding: '12px 16px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="micro" style={{ marginBottom: 3 }}>LETZTE SESSION</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="display" style={{ fontSize: 18, color: UI.ink, lineHeight: 1 }}>{lastSession.dayName}</span>
                  <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>
                    {new Date(lastSession.date.slice(0, 10) + 'T12:00:00').toLocaleDateString('de-DE', { day:'2-digit', month:'short' }).toUpperCase()}
                  </span>
                  <span className="num" style={{ color: UI.gold, fontSize: 11 }}>
                    {totalVolume(lastSession).toLocaleString('de-DE')}<span style={{ color: UI.inkFaint }}>kg</span>
                  </span>
                </div>
              </div>
              <ChevronRight />
            </div>
          </Frame>
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
