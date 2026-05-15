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
            width: 80, height: 80, margin: '0 auto 18px', borderRadius: '50%',
            border: `1.5px solid ${UI.gold}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: UI.gold, fontSize: 36, fontWeight: 700, fontFamily: UI.fontNum,
            boxShadow: `0 0 40px rgba(212,164,55,0.15)`,
            animation: 'logoPulse 3s ease-in-out infinite',
          }}>L</div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '0.1em', color: UI.ink }}>LOGBOOK</div>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontNum, letterSpacing: '0.14em', marginTop: 5 }}>
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

  // Total days elapsed since cycle start (falls back to cycleIndex for legacy data)
  const todayN = useMemo(() => {
    if (weekdayMode || !store.cycleStartDate) return store.cycleIndex || 0;
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = new Date(store.cycleStartDate + 'T12:00:00');
    return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000));
  }, [store.cycleStartDate, store.cycleIndex, weekdayMode]);

  // How many full cycles have been completed (0-indexed: 0 = first cycle still running)
  const currentCycleNum = dayCount > 0 ? Math.floor(todayN / dayCount) : 0;

  // weekOffset: weeks back (weekday mode) or cycles back (cycle mode). 0 = current.
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedWd, setSelectedWd] = useState(todayWd);        // weekday mode
  const [selectedSlot, setSelectedSlot] = useState(dayIdx);     // cycle mode

  const minOffset = weekdayMode ? -8 : -(currentCycleNum + 1);
  const goBack = () => {
    if (weekOffset <= minOffset) return;
    const next = weekOffset - 1;
    setWeekOffset(next);
    // default to last slot of the previous cycle (most recent past day)
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
    // Cycle mode: show exactly dayCount slots (the full cycle), not a fixed 7
    return sch.days.map((d, i) => {
      // days from today: cycleOffset * dayCount + i - dayIdx
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
    d.setHours(12, 0, 0, 0); // noon local time avoids UTC day boundary issues
    if (weekdayMode) {
      d.setDate(d.getDate() + selectedWd - todayWd + weekOffset * 7);
    } else {
      // days from today for slot selectedSlot in cycle weekOffset
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
    const cycleNum = currentCycleNum + weekOffset + 1; // 1-indexed
    return `ZYKLUS ${cycleNum}`;
  }, [weekdayMode, weekOffset, currentCycleNum]);

  const cardLabel = useMemo(() => {
    if (isViewingToday) {
      return weekdayMode
        ? `Heute · ${WEEKDAYS_FULL[selectedWd]}`
        : `Heute · Tag ${selectedSlot + 1} von ${dayCount}`;
    }
    const dateStr = sessionDate.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
    return weekdayMode
      ? dateStr
      : `${dateStr} · Tag ${selectedSlot + 1} von ${dayCount}`;
  }, [isViewingToday, weekdayMode, selectedWd, selectedSlot, dayCount, sessionDate]);

  const lastSession = useMemo(() => {
    return [...store.sessions].filter(s => s.ended).sort((a,b) => (b.ended||'').localeCompare(a.ended||''))[0];
  }, [store.sessions]);

  // cycle mode: set of absolute day-numbers (days since cycleStartDate) for completed sessions
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

  // weekday mode: plain date-key set
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

  const navBtn = (disabled) => ({
    background: 'transparent', border: 'none', cursor: disabled ? 'default' : 'pointer',
    color: disabled ? UI.inkLine : UI.inkSoft, fontSize: 16, padding: '0 4px', lineHeight: 1,
  });

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
            icon={ICON_CALENDAR}
          />
        </div>
        {confirmEl}
      </Screen>
    );
  }

  return (
    <Screen scroll={false} style={{ position: 'relative' }}>
      {/* Custom dramatic home header */}
      <div style={{
        flexShrink: 0,
        padding: `calc(22px + env(safe-area-inset-top, 0px)) 20px 18px`,
        borderBottom: `1px solid rgba(212,164,55,0.12)`,
        position: 'sticky', top: 0, zIndex: 5,
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        background: 'rgba(10,10,10,0.92)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontNum, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 5 }}>
              {new Date().toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' })}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: UI.ink, lineHeight: 1.1 }}>
              Hey, <span style={{ color: UI.gold }}>{store.user.name}</span>
            </div>
          </div>
          <button onClick={() => go({ name: 'settings' })} style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(240,236,224,0.05)', border: `1px solid ${UI.inkLine}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: UI.inkSoft, fontSize: 20,
            WebkitTapHighlightColor: 'transparent',
          }}>⋯</button>
        </div>
        {sch && weekOffset === 0 && (() => {
          let label, progress, total;
          if (weekdayMode) {
            const training = week.filter(d => d.items.length > 0);
            if (!training.length) return null;
            const done = training.filter(d => {
              const key = `${d.date.getFullYear()}-${d.date.getMonth()}-${d.date.getDate()}`;
              return completedDateKeys?.has(key);
            }).length;
            label = 'DIESE WOCHE'; progress = done; total = training.length;
          } else {
            if (!dayCount) return null;
            label = `ZYKLUS ${currentCycleNum + 1}`; progress = dayIdx + 1; total = dayCount;
          }
          return (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontNum, letterSpacing: '0.1em', marginBottom: 5 }}>
                <span>{label}</span>
                <span style={{ color: UI.gold }}>{progress} / {total}</span>
              </div>
              <div style={{ height: 3, background: UI.inkLine, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.round((progress / total) * 100)}%`,
                  background: `linear-gradient(90deg, ${UI.gold}, ${UI.goldLight})`,
                  borderRadius: 2,
                }} />
              </div>
            </div>
          );
        })()}
      </div>

      {store.inProgress && (() => {
        const activeSession = store.sessions.find(s => s.id === store.inProgress);
        return activeSession ? (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: 'rgba(212,164,55,0.08)',
            backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              background: UI.bgRaised, border: `1px solid ${UI.goldSoft}`,
              borderRadius: 20, padding: '28px 32px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              boxShadow: `0 0 40px rgba(212,164,55,0.15)`,
            }}>
              <div style={{ fontSize: 11, color: UI.gold, fontFamily: UI.fontNum, letterSpacing: '0.15em' }}>TRAINING LÄUFT</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: UI.ink }}>{activeSession.dayName}</div>
              <button onClick={() => go({ name: 'train', sessionId: store.inProgress })} style={{
                marginTop: 4, background: UI.gold, color: '#0a0a0a',
                border: 'none', borderRadius: 12, padding: '13px 28px',
                fontSize: 15, fontWeight: 600, fontFamily: UI.fontUi, cursor: 'pointer', width: '100%',
                boxShadow: '0 4px 20px rgba(212,164,55,0.4)',
                WebkitTapHighlightColor: 'transparent',
              }}>Weitermachen →</button>
              <button onClick={async () => {
                if (!await confirm('Session wird gelöscht.', { title: 'Training abbrechen?', ok: 'Abbrechen', cancel: 'Zurück', danger: true })) return;
                setStore(s => ({ ...s, sessions: s.sessions.filter(x => x.id !== store.inProgress), inProgress: null }));
              }} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: UI.danger, fontFamily: UI.fontUi, padding: '4px 0',
              }}>Training abbrechen</button>
            </div>
          </div>
        ) : null;
      })()}

      <div style={{ flex: 1, minHeight: 0, padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* period navigation */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={goBack} style={{
            ...navBtn(weekOffset <= minOffset),
            width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: weekOffset <= minOffset ? 'transparent' : 'rgba(240,236,224,0.05)',
            border: `1px solid ${weekOffset <= minOffset ? 'transparent' : UI.inkLine}`,
            fontSize: 18,
          }}>‹</button>
          <div style={{ flex: 1, textAlign: 'center', fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontNum, letterSpacing: '0.1em', fontWeight: 500 }}>
            {periodLabel}
          </div>
          <button onClick={goForward} disabled={weekOffset === 0} style={{
            ...navBtn(weekOffset === 0),
            width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: weekOffset === 0 ? 'transparent' : 'rgba(240,236,224,0.05)',
            border: `1px solid ${weekOffset === 0 ? 'transparent' : UI.inkLine}`,
            fontSize: 18,
          }}>›</button>
        </div>

        {/* day strip */}
        <div style={{ flexShrink: 0, display: 'flex', gap: 5 }}>
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
                  flex: 1, padding: '10px 3px 8px', textAlign: 'center',
                  background: isSelected ? UI.goldFaint : UI.bgRaised,
                  border: `1px solid ${isSelected ? UI.goldSoft : d.isToday ? UI.inkSoft : UI.inkLine}`,
                  borderRadius: 10, cursor: 'pointer',
                  boxShadow: isSelected ? '0 2px 8px rgba(212,164,55,0.15)' : 'none',
                }}>
                <div style={{ fontSize: 9, color: isSelected ? UI.gold : d.isToday ? UI.inkSoft : UI.inkFaint, fontFamily: UI.fontNum }}>
                  {slotLabel}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 3, color: r ? UI.inkSoft : isSelected ? UI.gold : UI.ink }}>
                  {r ? '—' : d.name.slice(0, 4)}
                </div>
                {isCompleted && (
                  <div style={{ fontSize: 11, color: UI.gold, marginTop: 2, lineHeight: 1 }}>✓</div>
                )}
              </div>
            );
          })}
        </div>

        {/* day card — flex:1 so it fills all remaining vertical space */}
        {isActiveRest ? (
          <Card style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Label>{cardLabel}</Label>
            <div style={{ fontSize: 28, fontWeight: 600, marginBottom: 4 }}>Rest Day</div>
            <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 14 }}>
              Erholung ist Teil des Plans.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {!weekdayMode && isViewingToday && <Btn kind="ghost" onClick={skipRest} style={{ flex: 1 }}>Rest abhaken →</Btn>}
              <Btn kind="ghost" onClick={() => go({ name: 'plan' })} style={{ flex: 1 }}>Plan ansehen</Btn>
            </div>
          </Card>
        ) : (
          <Card accent style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Label style={{ color: UI.gold, flexShrink: 0 }}>{cardLabel}</Label>
            <div style={{ fontSize: 34, fontWeight: 700, color: UI.gold, marginBottom: 4, letterSpacing: '0.01em', flexShrink: 0 }}>{activeDay.name}</div>
            <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 8, flexShrink: 0 }}>
              {activeDay.items.length} Übungen · ~{Math.round(activeDay.items.reduce((a,b) => a + b.sets*2 + 3, 0))} min
            </div>
            {/* exercise list — grows to fill space, clips gracefully */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', marginBottom: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {activeDay.items.map((it, i) => {
                  const ex = LB.findExercise(store, it.exId);
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '5px 0', borderBottom: i < activeDay.items.length - 1 ? `1px dashed ${UI.goldSoft}` : 'none' }}>
                      <span style={{ color: UI.ink }}>{ex?.name || '—'}</span>
                      <span style={{ color: UI.gold, fontFamily: UI.fontNum, fontSize: 13 }}>{it.sets} × {it.reps}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* CTA — always visible at the bottom */}
            <div style={{ flexShrink: 0 }}>
              {isSlotDone ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(127,176,105,0.08)', border: `1px solid rgba(127,176,105,0.2)`, borderRadius: 12, color: UI.ok }}>
                  <span style={{ fontSize: 22, lineHeight: 1 }}>✓</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Training erledigt</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>Gut gemacht!</div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Btn onClick={startSession} style={{ width: '100%', boxShadow: '0 4px 24px rgba(212,164,55,0.35)' }}>
                    {(isViewingToday || isFutureSlot) ? 'Training starten →' : 'Training nacherfassen →'}
                  </Btn>
                  {!weekdayMode && isViewingToday && (
                    <Btn kind="ghost" onClick={async () => { if (await confirm('Der aktuelle Tag wird übersprungen.', { title: 'Tag überspringen?', ok: 'Überspringen' })) skipRest(); }} style={{ width: '100%', fontSize: 13, opacity: 0.6 }}>
                      Tag überspringen
                    </Btn>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* last session preview — compact fixed-height strip */}
        {lastSession && (
          <Card style={{ flexShrink: 0, padding: '10px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontNum, letterSpacing: '0.1em', marginBottom: 2 }}>LETZTE SESSION</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{lastSession.dayName}
                  <span style={{ color: UI.inkFaint, fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
                    {new Date(lastSession.date.slice(0, 10) + 'T12:00:00').toLocaleDateString('de-DE', { day:'numeric', month:'short' })} · {totalVolume(lastSession).toLocaleString('de-DE')} kg
                  </span>
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
