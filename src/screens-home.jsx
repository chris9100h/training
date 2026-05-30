/* App screens — Login, Home — Haute Horlogerie redesign
   Logic identical to original (Supabase auth, cycle/weekday modes,
   in-progress overlay, future-slot retroactive logging).
*/

const { useState, useEffect, useMemo, useRef } = React;

const SKIP_REASONS = ['Tired', 'Sick', 'Stress', 'Forgot', 'Rest day', 'No particular reason'];

// ─── LOGIN ────────────────────────────────────────────────────────────
function LoginScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [swVersion, setSwVersion] = useState('');

  useEffect(() => {
    if (!('caches' in window)) return;
    caches.keys().then(keys => {
      const name = keys.find(k => k.startsWith('zane-'));
      if (name) setSwVersion(name.replace('zane-', ''));
    });
  }, []);

  const canSubmit = email.trim() && password.length >= 6;

  const submit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true); setError('');
    try {
      await LB.signIn(email.trim(), password);
    } catch (e) {
      setError(e.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll={false} style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="guilloche" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

      <div style={{ flexShrink: 0, padding: 'calc(env(safe-area-inset-top, 0px) + 18px) 22px 0', display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 1 }}>
        <span className="micro">ZANE TRAINING</span>
      </div>

      {/* Centered block: logo + title + form */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px', position: 'relative', zIndex: 1 }}>
        <img src="icons/zane-logo.png" style={{ width: '92%', maxWidth: 500, objectFit: 'contain', marginBottom: 28 }} />
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <Field label="Email">
            <TextInput value={email} onChange={setEmail} placeholder="you@example.com" autoFocus />
          </Field>
          <Field label="Password">
            <TextInput value={password} onChange={setPassword} type="password" placeholder="min. 6 characters" />
          </Field>
          {error && (
            <div style={{
              fontSize: 12, color: UI.danger,
              padding: '10px 14px',
              background: 'rgba(var(--danger-rgb),0.06)',
              border: `1px solid rgba(var(--danger-rgb),0.25)`,
              borderRadius: 4,
              fontFamily: UI.fontUi,
            }}>
              {error}
            </div>
          )}
          <Btn onClick={submit} disabled={!canSubmit || loading} style={{ marginTop: 4, opacity: canSubmit && !loading ? 1 : 0.4 }}>
            {loading ? 'Signing in…' : 'Log in'}
          </Btn>
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: '0 22px calc(env(safe-area-inset-bottom, 8px) + 18px)', display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 1 }}>
        <span className="micro">{swVersion || '…'}</span>
      </div>
    </Screen>
  );
}

// ─── Sub-components used by HomeScreen ────────────────────────────────

function SkipReasonSheet({ modal, onClose, setStore, userId }) {
  return (
    <Sheet open={!!modal} onClose={onClose}>
      {modal && (
        <>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: UI.fontUi, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center', color: UI.ink, marginBottom: 4 }}>{modal.mode === 'edit' ? 'Edit Reason' : 'Why Did You Skip?'}</div>
          <div className="micro" style={{ marginBottom: 18, color: UI.inkFaint, textAlign: 'center' }}>{modal.data?.dayName}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SKIP_REASONS.map(reason => {
              const isActive = modal.currentReason === reason;
              return (
                <button key={reason} onClick={() => {
                  const { mode, skipId, data } = modal;
                  if (mode === 'edit') {
                    LB.updateSkipReason(skipId, reason).catch(() => {});
                    setStore(s => ({ ...s, skips: (s.skips || []).map(x => x.id === skipId ? { ...x, skipReason: reason } : x) }));
                  } else {
                    const id = LB.uid();
                    LB.createSkip(userId, { id, date: data.dateKey, dayId: data.dayId, dayName: data.dayName, skipReason: reason }).catch(() => {});
                    setStore(s => ({ ...s, skips: [...(s.skips || []), { id, date: data.dateKey, dayId: data.dayId, dayName: data.dayName, skipReason: reason, skippedAt: new Date().toISOString() }] }));
                  }
                  onClose();
                }} style={{ background: isActive ? UI.goldFaint : UI.bgInset, border: `0.5px solid ${isActive ? UI.goldSoft : UI.hairStrong}`, borderRadius: 10, padding: '13px 16px', fontFamily: UI.fontUi, fontSize: 14, color: isActive ? UI.gold : UI.ink, textAlign: 'center', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                  {reason}
                </button>
              );
            })}
          </div>
          <Btn onClick={onClose} style={{ marginTop: 14, width: '100%' }}>Cancel</Btn>
        </>
      )}
    </Sheet>
  );
}

function LastSessionStrip({ session, onClick }) {
  return (
    <Frame onClick={onClick} style={{ flexShrink: 0, padding: '12px 16px', cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="micro" style={{ marginBottom: 3 }}>LAST SESSION</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="display" style={{ fontSize: 18, color: UI.ink, lineHeight: 1 }}>{session.dayName}</span>
            <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>
              {LB.parseDate(session.date).toLocaleDateString('en-US', { day:'2-digit', month:'short' }).toUpperCase()}
            </span>
            <span className="num" style={{ color: UI.gold, fontSize: 11 }}>
              {LB.totalVolume(session).toLocaleString('en-US')}<span style={{ color: UI.inkFaint }}>kg</span>
            </span>
          </div>
        </div>
        <ChevronRight />
      </div>
    </Frame>
  );
}

function RecentBannerDay({ banner, store, setStore, go, sch, onOpenSkipSheet }) {
  const { dateKey, dayName, daysAgo, skip, dayData, date, dayId } = banner;
  const dateLabel = daysAgo === 1 ? 'YESTERDAY' : `${daysAgo}D AGO`;
  if (skip) {
    return (
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="micro" style={{ marginBottom: 3 }}>{dayName} · {dateLabel}</div>
          <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, letterSpacing: '0.04em', background: `rgba(var(--bg-rgb),0.5)`, border: `1px solid ${UI.hairStrong}`, borderRadius: 3, padding: '2px 8px', display: 'inline-block' }}>
            {skip.skipReason}
          </span>
        </div>
        <button onClick={() => onOpenSkipSheet({ mode: 'edit', skipId: skip.id, currentReason: skip.skipReason, data: { dateKey, dayId: skip.dayId, dayName } })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: UI.inkFaint, display: 'flex', alignItems: 'center' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button onClick={() => { LB.deleteSkip(skip.id).catch(() => {}); setStore(s => ({ ...s, skips: (s.skips || []).filter(x => x.id !== skip.id) })); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', color: UI.danger, fontSize: 18, lineHeight: 1, fontFamily: UI.fontUi }}>×</button>
      </div>
    );
  }
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(var(--danger-rgb),0.05)', border: `0.5px solid rgba(var(--danger-rgb),0.2)`, borderRadius: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="micro" style={{ color: UI.danger, marginBottom: 2 }}>{dayName} · {dateLabel}</div>
        <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>Not logged</div>
      </div>
      <button onClick={() => {
        const entries = (dayData?.items || []).map(it => {
          const ex = LB.findExercise(store, it.exId);
          const last = LB.lastSessionForExercise(store, it.exId, dayId);
          const isUni = ex?.unilateral || false;
          const suggestion = LB.progressionSuggestion(store, it.exId, dayId, it.reps);
          const seedSets = LB.buildSeedSets(it, last, suggestion, isUni, !!store.settings?.smartProgression);
          return { exId: it.exId, name: ex?.name || '?', plannedSets: it.sets, plannedReps: it.reps, sets: seedSets, note: '', supersetGroup: it.supersetGroup || null };
        });
        const session = { id: LB.uid(), scheduleId: sch.id, dayId, dayName, date: date.toISOString(), startedAt: new Date().toISOString(), ended: null, entries, currentExIdx: 0, cyclePos: null };
        setStore(s => ({ ...s, sessions: [...s.sessions, session], inProgress: session.id }));
        LB.broadcastSessionNav('start', session.id);
        go({ name: 'train', sessionId: session.id });
      }} style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 4, background: 'transparent', border: `1px solid ${UI.hairStrong}`, cursor: 'pointer', fontSize: 11, fontFamily: UI.fontUi, color: UI.inkSoft, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        Log
      </button>
      <button onClick={() => onOpenSkipSheet({ mode: 'dismiss', data: { dateKey, dayId, dayName } })} style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 4, background: 'transparent', border: `1px solid rgba(var(--danger-rgb),0.25)`, cursor: 'pointer', fontSize: 11, fontFamily: UI.fontUi, color: 'rgba(var(--danger-rgb),0.7)', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        Dismiss
      </button>
    </div>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────
function HomeScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const today = LB.todaysDay(store);
  const sch = today?.schedule;
  const day = today?.day;
  const dayIdx = today?.idx ?? 0;
  const dayCount = sch?.days?.length || 0;
  const weekdayMode = sch ? LB.isWeekdayPlan(sch) : false;
  const cycleWeekView = !weekdayMode && (store.settings?.cycleWeekView ?? localStorage.getItem('logbook-cycle-week-view') === 'true');

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
    const start = LB.parseDate(store.cycleStartDate);
    return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000));
  }, [store.cycleStartDate, store.cycleIndex, weekdayMode]);

  const currentCycleNum = dayCount > 0 ? Math.floor(todayN / dayCount) : 0;

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedWd, setSelectedWd] = useState(todayWd);
  const [skipReasonModal, setSkipReasonModal] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(dayIdx);
  const [warmupPromptData, setWarmupPromptData] = useState(null);

  const minOffset = (() => {
    if (weekdayMode) {
      if (store.weekPlanStartDate) {
        const now = new Date(); now.setHours(12, 0, 0, 0);
        const currentMondayMs = now.getTime() - todayWd * 86400000;
        const start = LB.parseDate(store.weekPlanStartDate);
        const planMondayMs = start.getTime() - ((start.getDay() + 6) % 7) * 86400000;
        const week0MondayMs = planMondayMs - 7 * 86400000;
        return Math.round((week0MondayMs - currentMondayMs) / (7 * 86400000));
      }
      return -8;
    }
    if (cycleWeekView && store.cycleStartDate && dayCount > 0) {
      const now = new Date(); now.setHours(12, 0, 0, 0);
      const currentMondayMs = now.getTime() - todayWd * 86400000;
      const cycle0StartMs = LB.parseDate(store.cycleStartDate).getTime() - dayCount * 86400000;
      const cycle0Wd = (new Date(cycle0StartMs).getDay() + 6) % 7;
      const cycle0MondayMs = cycle0StartMs - cycle0Wd * 86400000;
      return Math.round((cycle0MondayMs - currentMondayMs) / (7 * 86400000));
    }
    return -(currentCycleNum + 1);
  })();
  const goBack = () => {
    if (weekOffset <= minOffset) return;
    setWeekOffset(weekOffset - 1);
    if (!weekdayMode && !cycleWeekView) setSelectedSlot(dayCount - 1);
  };
  const goForward = () => {
    if (weekOffset >= 0) return;
    const next = weekOffset + 1;
    setWeekOffset(next);
    if (next === 0) {
      if (weekdayMode || cycleWeekView) setSelectedWd(todayWd);
      else setSelectedSlot(dayIdx);
    } else if (!weekdayMode && !cycleWeekView) {
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
    if (cycleWeekView && store.cycleStartDate && dayCount > 0) {
      const start = LB.parseDate(store.cycleStartDate);
      const monday = new Date(); monday.setHours(12, 0, 0, 0);
      monday.setDate(monday.getDate() - todayWd + weekOffset * 7);
      return Array.from({ length: 7 }).map((_, i) => {
        const date = new Date(monday); date.setDate(monday.getDate() + i);
        const daysFromStart = Math.round((date - start) / 86400000);
        const slotIdx = ((daysFromStart % dayCount) + dayCount) % dayCount;
        const dayData = sch.days[slotIdx];
        return {
          id: `cwv-${i}`, weekday: i,
          isToday: i === todayWd && weekOffset === 0,
          name: dayData?.name ?? 'REST',
          items: dayData?.items ?? [],
          date, slotIdx, daysFromStart,
        };
      });
    }
    return sch.days.map((d, i) => {
      const daysFromToday = weekOffset * dayCount + i - dayIdx;
      const date = new Date(); date.setDate(date.getDate() + daysFromToday);
      return { ...d, slotIdx: i, date, isToday: weekOffset === 0 && i === dayIdx };
    });
  }, [sch, dayIdx, dayCount, weekdayMode, cycleWeekView, todayWd, weekOffset, store.cycleStartDate]);

  const activeDay = useMemo(() => {
    if (!sch) return day;
    if (weekdayMode) {
      const found = sch.days.find(d => d.weekday === selectedWd);
      return found ?? { id: 'rest-virtual', name: 'REST', items: [], weekday: selectedWd };
    }
    if (cycleWeekView) {
      const sel = week.find(d => d.weekday === selectedWd);
      if (sel?.slotIdx != null) return sch.days[sel.slotIdx];
      return { id: 'rest-virtual', name: 'REST', items: [] };
    }
    return sch.days[selectedSlot] ?? sch.days[0];
  }, [weekdayMode, cycleWeekView, sch, selectedWd, selectedSlot, day, week]);

  const sessionDate = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    if (weekdayMode || cycleWeekView) {
      d.setDate(d.getDate() + selectedWd - todayWd + weekOffset * 7);
    } else {
      d.setDate(d.getDate() + weekOffset * dayCount + selectedSlot - dayIdx);
    }
    return d;
  }, [weekdayMode, cycleWeekView, selectedWd, todayWd, weekOffset, selectedSlot, dayIdx, dayCount]);

  const isViewingToday = weekOffset === 0 && ((weekdayMode || cycleWeekView) ? selectedWd === todayWd : selectedSlot === dayIdx);
  const isActiveRest = !activeDay?.items?.length;
  const isFutureSlot = sessionDate > (() => { const d = new Date(); d.setHours(12,0,0,0); return d; })();

  const periodLabel = useMemo(() => {
    if (weekdayMode) {
      if (store.weekPlanStartDate) {
        const monday = new Date(); monday.setHours(12, 0, 0, 0);
        monday.setDate(monday.getDate() - todayWd + weekOffset * 7);
        const start = LB.parseDate(store.weekPlanStartDate);
        const startMonday = new Date(start);
        startMonday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        startMonday.setHours(12, 0, 0, 0);
        const weekNum = Math.floor(Math.round((monday - startMonday) / 86400000) / 7) + 1;
        if (weekNum >= 0) return `WEEK ${weekNum}`;
      }
      if (weekOffset === 0) return 'THIS WEEK';
      if (weekOffset === -1) return 'LAST WEEK';
      return `${-weekOffset} WEEKS AGO`;
    }
    if (cycleWeekView && store.cycleStartDate && dayCount > 0) {
      const monday = new Date(); monday.setHours(12, 0, 0, 0);
      monday.setDate(monday.getDate() - todayWd + weekOffset * 7);
      const start = LB.parseDate(store.cycleStartDate);
      const dfs = Math.round((monday - start) / 86400000);
      return `CYCLE ${Math.floor(dfs / dayCount) + 1}`;
    }
    const cycleNum = currentCycleNum + weekOffset + 1;
    return `CYCLE ${cycleNum}`;
  }, [weekdayMode, cycleWeekView, weekOffset, currentCycleNum, todayWd, store.cycleStartDate, dayCount]);

  const cardLabel = useMemo(() => {
    if (isViewingToday) {
      if (weekdayMode) return `TODAY · ${WEEKDAYS_FULL[selectedWd].toUpperCase()}`;
      if (cycleWeekView) {
        const sel = week.find(d => d.weekday === selectedWd);
        return `TODAY · DAY ${(sel?.slotIdx ?? 0) + 1} OF ${dayCount}`;
      }
      return `TODAY · DAY ${selectedSlot + 1} OF ${dayCount}`;
    }
    const dateStr = sessionDate.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
    if (weekdayMode) return dateStr;
    if (cycleWeekView) {
      const sel = week.find(d => d.weekday === selectedWd);
      return `${dateStr} · DAY ${(sel?.slotIdx ?? 0) + 1} OF ${dayCount}`;
    }
    return `${dateStr} · DAY ${selectedSlot + 1} OF ${dayCount}`;
  }, [isViewingToday, weekdayMode, cycleWeekView, selectedWd, selectedSlot, dayCount, sessionDate, week]);

  const avgDayDuration = useMemo(() => {
    if (!activeDay?.id) return null;
    const past = store.sessions.filter(s => s.dayId === activeDay.id && s.ended);
    if (!past.length) return null;
    const mins = past.map(s => s.durationMinutes != null
      ? s.durationMinutes
      : (s.startedAt && s.ended ? Math.round((new Date(s.ended) - new Date(s.startedAt)) / 60000) : null)
    ).filter(d => d != null && d > 0);
    if (!mins.length) return null;
    return Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
  }, [store.sessions, activeDay?.id]);

  const lastSession = useMemo(() => {
    return [...store.sessions].filter(s => s.ended).sort((a,b) => (b.ended||'').localeCompare(a.ended||''))[0];
  }, [store.sessions]);

  const doneSession = useMemo(() => {
    const dateKey = sessionDate.toISOString().slice(0, 10);
    return [...store.sessions]
      .filter(s => s.ended && s.date.slice(0, 10) === dateKey)
      .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0] ?? null;
  }, [store.sessions, sessionDate]);

  const { improvementCount, regressionCount } = useMemo(() => {
    if (!doneSession) return { improvementCount: 0, regressionCount: 0 };
    const cmp = (st, prevSet, better) => {
      if (!prevSet || !st.done || st.kg == null || prevSet.kg == null) return false;
      const repsA = LB.effReps(st); const repsB = LB.effReps(prevSet);
      if (repsA == null || repsB == null) return false;
      return better
        ? (st.kg > prevSet.kg && repsA >= repsB - 2) || (st.kg >= prevSet.kg && repsA > repsB)
        : st.kg < prevSet.kg || (st.kg === prevSet.kg && repsA < repsB);
    };
    let improvements = 0, regressions = 0;
    doneSession.entries.forEach(e => {
      const prev = [...store.sessions]
        .filter(x => x.ended && x.id !== doneSession.id && x.dayId === doneSession.dayId && x.ended < doneSession.ended)
        .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))
        .find(x => x.entries.some(en => en.exId === e.exId && en.sets.some(st => st.kg != null || st.reps != null)));
      const prevEntry = prev?.entries.find(en => en.exId === e.exId);
      if (!prevEntry) return;
      // Compare working sets by position, warmups excluded on both sides
      const currWorking = e.sets.filter(st => !st.warmup && !st.skipped);
      const prevWorking = prevEntry.sets.filter(st => !st.warmup);
      const improved = currWorking.some((st, j) => cmp(st, prevWorking[j], true));
      if (improved) { improvements++; return; }
      const regressed = currWorking.some((st, j) => cmp(st, prevWorking[j], false));
      if (regressed) regressions++;
    });
    return { improvementCount: improvements, regressionCount: regressions };
  }, [doneSession, store.sessions]);

  const completedCyclePos = useMemo(() => {
    if (weekdayMode || !sch) return null;
    const set = new Set();
    if (store.cycleStartDate) {
      const start = LB.parseDate(store.cycleStartDate);
      store.sessions.filter(s => s.ended).forEach(s => {
        const d = LB.parseDate(s.date);
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
      const d = LB.parseDate(s.date);
      set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    });
    return set;
  }, [store.sessions, weekdayMode]);

  const cycleBarSegments = useMemo(() => {
    if (!cycleWeekView || weekdayMode || !store.cycleStartDate || !sch || dayCount === 0) return null;
    const start = LB.parseDate(store.cycleStartDate);
    const monday = new Date(); monday.setHours(12, 0, 0, 0);
    monday.setDate(monday.getDate() - todayWd + weekOffset * 7);
    const cycleNums = Array.from({ length: 7 }).map((_, i) => {
      const date = new Date(monday); date.setDate(monday.getDate() + i);
      const dfs = Math.round((date - start) / 86400000);
      return Math.floor(dfs / dayCount) + 1;
    });
    const segments = [];
    let cur = { cycleNum: cycleNums[0], count: 1 };
    for (let i = 1; i < cycleNums.length; i++) {
      if (cycleNums[i] === cur.cycleNum) { cur.count++; }
      else { segments.push(cur); cur = { cycleNum: cycleNums[i], count: 1 }; }
    }
    segments.push(cur);
    return segments;
  }, [cycleWeekView, weekdayMode, store.cycleStartDate, sch, dayCount, todayWd, weekOffset]);

  const isSlotDone = useMemo(() => {
    if (isActiveRest) return false;
    if (weekdayMode) {
      const key = `${sessionDate.getFullYear()}-${sessionDate.getMonth()}-${sessionDate.getDate()}`;
      return completedDateKeys?.has(key) ?? false;
    }
    if (cycleWeekView) {
      const sel = week.find(d => d.weekday === selectedWd);
      return sel?.daysFromStart != null && (completedCyclePos?.has(sel.daysFromStart) ?? false);
    }
    const pos = (currentCycleNum + weekOffset) * dayCount + selectedSlot;
    return completedCyclePos?.has(pos) ?? false;
  }, [isActiveRest, weekdayMode, cycleWeekView, sessionDate, completedDateKeys, completedCyclePos, week, selectedWd, currentCycleNum, weekOffset, dayCount, selectedSlot]);

  const skipsMap = useMemo(() => {
    const m = new Map();
    (store.skips || []).forEach(s => m.set(s.date.slice(0, 10), s));
    return m;
  }, [store.skips]);

  const selectedDateSkip = useMemo(() => {
    if (isViewingToday || isFutureSlot) return null;
    return skipsMap.get(sessionDate.toISOString().slice(0, 10)) ?? null;
  }, [isViewingToday, isFutureSlot, skipsMap, sessionDate]);

  const recentBannerDay = useMemo(() => {
    if (!sch) return null;
    const todayD = new Date(); todayD.setHours(12, 0, 0, 0);
    const sessionDates = new Set(store.sessions.filter(s => s.ended).map(s => s.date.slice(0, 10)));
    for (let daysAgo = 1; daysAgo <= 30; daysAgo++) {
      const d = new Date(todayD); d.setDate(todayD.getDate() - daysAgo);
      const dateKey = d.toISOString().slice(0, 10);
      if (sessionDates.has(dateKey)) continue;
      const sk = skipsMap.get(dateKey);
      if (sk) continue; // already actioned — edit via calendar card
      let trainingDay = null;
      if (weekdayMode) {
        if (store.weekPlanStartDate && dateKey < store.weekPlanStartDate) continue;
        const wd = d.getDay() === 0 ? 6 : d.getDay() - 1;
        trainingDay = sch.days.find(day => day.weekday === wd && day.items?.length > 0) || null;
      } else if (store.cycleStartDate) {
        const start = LB.parseDate(store.cycleStartDate);
        const n = Math.round((d.getTime() - start.getTime()) / 86400000);
        if (n < 0) continue;
        const idx = ((n % sch.days.length) + sch.days.length) % sch.days.length;
        const dayData = sch.days[idx];
        if (dayData?.items?.length > 0) trainingDay = dayData;
      }
      if (!trainingDay) continue;
      return { date: d, dateKey, dayName: trainingDay.name, dayId: trainingDay.id, daysAgo, skip: sk || null, dayData: trainingDay };
    }
    return null;
  }, [sch, weekdayMode, store.cycleStartDate, store.sessions, store.skips, skipsMap]);

  const startSession = () => {
    if (!activeDay || isActiveRest) return;
    const entries = activeDay.items.map(it => {
      const ex = LB.findExercise(store, it.exId);
      const last = LB.lastSessionForExercise(store, it.exId, activeDay.id);
      const isUnilateral = ex?.unilateral || false;
      const suggestion = LB.progressionSuggestion(store, it.exId, activeDay.id, it.reps);
      const seedSets = LB.buildSeedSets(it, last, suggestion, isUnilateral, !!store.settings?.smartProgression);
      return {
        exId: it.exId, name: ex?.name || '?',
        plannedSets: it.sets, plannedReps: it.reps,
        sets: seedSets, note: '',
        supersetGroup: it.supersetGroup || null,
      };
    });
    const cyclePos = weekdayMode ? null :
      cycleWeekView
        ? (week.find(d => d.weekday === selectedWd)?.daysFromStart ?? null)
        : (currentCycleNum + weekOffset) * dayCount + selectedSlot;
    const firstWorkingKg = entries[0]?.sets[0]?.kg ?? null;
    setWarmupPromptData({ entries, cyclePos, firstWorkingKg, firstName: entries[0]?.name || '?' });
  };

  const confirmStart = (withWarmup) => {
    const { entries: rawEntries, cyclePos, firstWorkingKg } = warmupPromptData;
    setWarmupPromptData(null);
    let entries = rawEntries;
    let startedAt = new Date().toISOString();
    if (withWarmup) {
      const ft10 = kg => Math.round(kg / 10) * 10;
      const wKg = firstWorkingKg;
      const warmupSets = [
        { kg: wKg != null ? (ft10(wKg * 0.30) || null) : null, reps: 12, done: false, warmup: true, warmupPct: 30 },
        { kg: wKg != null ? (ft10(wKg * 0.60) || null) : null, reps: 8,  done: false, warmup: true, warmupPct: 60 },
        { kg: wKg != null ? wKg : null,                          reps: 4,  done: false, warmup: true, warmupPct: 100 },
      ];
      entries = entries.map((e, i) => i === 0 ? { ...e, sets: [...warmupSets, ...e.sets] } : e);
      startedAt = null; // timer starts when last warmup set is completed
    }
    const session = {
      id: LB.uid(), scheduleId: sch.id, dayId: activeDay.id, dayName: activeDay.name,
      date: sessionDate.toISOString(), startedAt, ended: null, entries, currentExIdx: 0,
      cyclePos,
    };
    setStore(s => ({ ...s, sessions: [...s.sessions, session], inProgress: session.id }));
    LB.broadcastSessionNav('start', session.id);
    go({ name: 'train', sessionId: session.id });
  };

  // ─── No-plan fallback
  if (!sch) {
    const hasPlans = store.schedules?.length > 0;
    return (
      <Screen>
        <TopBar
          title={<span>HEY, <span style={{ color: UI.gold }}>{(store.user.name || '').toUpperCase()}</span></span>}
          sub={new Date().toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long' })}
          right={<button onClick={() => go({ name: 'settings' })} style={{ background: 'transparent', border: `1px solid ${UI.hairStrong}`, padding: 4, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', fontSize: 20, color: UI.inkSoft, width: 36, height: 36, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⋯</button>}
        />
        <div style={{ padding: 22 }}>
          {hasPlans ? (
            <Empty
              title="No active plan"
              sub="You have plans ready — just pick one to activate."
              action={<Btn onClick={() => go({ name: 'plan' })}>View plans</Btn>}
              icon={ICON_CALENDAR}
            />
          ) : (
            <Empty
              title="No plan yet"
              sub="Create a training plan to get started."
              action={<Btn onClick={() => go({ name: 'schedule-new' })}>Create plan</Btn>}
              icon={ICON_CALENDAR}
            />
          )}
        </div>
        {confirmEl}
      </Screen>
    );
  }

  return (
    <Screen scroll={false} style={{ position: 'relative' }}>
      {/* Background ZANE watermark */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <img src="icons/zane-logo.png" style={{ width: '85%', maxWidth: 320, opacity: 0.04, filter: 'grayscale(1) brightness(3)', objectFit: 'contain' }} />
      </div>

      {/* Header */}
      <div style={{
        flexShrink: 0,
        padding: `calc(env(safe-area-inset-top, 0px) + 12px) 22px 12px`,
        borderBottom: `1px solid ${UI.hair}`,
        position: 'sticky', top: 0, zIndex: 5,
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        background: 'rgba(var(--bg-rgb),0.92)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: UI.fontDisplay, fontSize: 28, fontWeight: 900, letterSpacing: '0.10em', color: UI.gold, lineHeight: 1 }}>ZANE</span>
              <i className="fa-solid fa-dumbbell" style={{ fontSize: 13, color: UI.inkFaint }} />
            </div>
            <div className="micro" style={{ marginTop: 3, letterSpacing: '0.18em' }}>BARBELL CLUB · MEMBER</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div className="micro" style={{ marginBottom: 3 }}>{new Date().toLocaleDateString('en-US', { weekday:'long', day:'2-digit', month:'long' }).toUpperCase()}</div>
              <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, fontWeight: 900, letterSpacing: '0.06em', color: UI.ink, lineHeight: 1, textTransform: 'uppercase' }}>
                HEY, <span style={{ color: UI.gold }}>{(store.user.name || '').toUpperCase()}</span>
              </div>
            </div>
            <button onClick={() => go({ name: 'settings' })} style={{
              width: 34, height: 34, borderRadius: 4, flexShrink: 0,
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: UI.inkSoft,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* In-progress banner */}
      {store.inProgress && (() => {
        const activeSession = store.sessions.find(s => s.id === store.inProgress);
        return activeSession ? (
          <div style={{
            flexShrink: 0,
            padding: '10px 16px',
            background: UI.goldFaint,
            borderBottom: `0.5px solid ${UI.goldSoft}`,
            display: 'flex', alignItems: 'center', gap: 10,
            position: 'relative', zIndex: 1,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: UI.gold, flexShrink: 0, animation: 'pulseDot 1.4s ease-in-out infinite' }} />
            <span style={{ flex: 1, fontSize: 13, color: UI.gold, fontFamily: UI.fontUi, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeSession.dayName}
            </span>
            <button onClick={async () => {
              // Capture the id before awaiting — a cross-device sync could swap
              // the in-progress session while the confirm dialog is open.
              const cancelId = store.inProgress;
              if (!await confirm('The session will be deleted.', { title: 'Cancel training?', ok: 'Cancel', cancel: 'Back', danger: true })) return;
              LB.cancelPushover(store.settings, userId);
              setStore(s => s.inProgress !== cancelId ? s : { ...s, sessions: s.sessions.filter(x => x.id !== cancelId), inProgress: null });
            }} style={{
              background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
              fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, padding: '4px 0',
              letterSpacing: '0.10em', textTransform: 'uppercase',
            }}>Cancel</button>
            <button onClick={() => go({ name: 'train', sessionId: store.inProgress })} style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 4,
              background: UI.gold, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, fontFamily: UI.fontUi, color: '#0a0805',
              letterSpacing: '0.08em',
            }}>Continue →</button>
          </div>
        ) : null;
      })()}

      <div style={{ flex: 1, minHeight: 0, padding: '16px 22px 18px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', position: 'relative', zIndex: 1 }}>

        {/* Period navigation */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={goBack} disabled={weekOffset <= minOffset} style={{
            width: 30, height: 30, borderRadius: 4,
            background: 'transparent',
            border: `1px solid ${weekOffset <= minOffset ? 'transparent' : UI.hairStrong}`,
            color: weekOffset <= minOffset ? UI.inkGhost : UI.inkSoft,
            cursor: weekOffset <= minOffset ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M6 1 1 6l5 5"/></svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', color: UI.inkSoft, textTransform: 'uppercase' }}>{periodLabel}</span>
          </div>
          <button onClick={goForward} disabled={weekOffset === 0} style={{
            width: 30, height: 30, borderRadius: 4,
            background: 'transparent',
            border: `1px solid ${weekOffset === 0 ? 'transparent' : UI.hairStrong}`,
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
            const isSelected = (weekdayMode || cycleWeekView) ? i === selectedWd : i === selectedSlot;
            const r = !d.items?.length;
            const slotLabel = weekdayMode
              ? WEEKDAYS[i]
              : d.date.toLocaleDateString('en-US', { day: 'numeric', month: 'numeric' }).replace(/\.$/, '');
            let isCompleted = false;
            if (!r) {
              if (weekdayMode) {
                const slotKey = `${d.date.getFullYear()}-${d.date.getMonth()}-${d.date.getDate()}`;
                isCompleted = completedDateKeys?.has(slotKey) ?? false;
              } else if (cycleWeekView) {
                isCompleted = d.daysFromStart != null && (completedCyclePos?.has(d.daysFromStart) ?? false);
              } else {
                const pos = (currentCycleNum + weekOffset) * dayCount + i;
                isCompleted = completedCyclePos?.has(pos) ?? false;
              }
            }
            const dateKey = d.date.toISOString().slice(0, 10);
            const isPast = !d.isToday && d.date < new Date();
            const isBeforePlanStart = weekdayMode
              ? (store.weekPlanStartDate ? d.date < LB.parseDate(store.weekPlanStartDate) : false)
              : (store.cycleStartDate ? d.date < LB.parseDate(store.cycleStartDate) : false);
            const isMissed = !r && isPast && !isCompleted && !skipsMap.has(dateKey) && !isBeforePlanStart;
            const isSkipped = !r && isPast && !isCompleted && skipsMap.has(dateKey);
            return (
              <div key={d.id ?? i}
                onClick={() => (weekdayMode || cycleWeekView) ? setSelectedWd(i) : setSelectedSlot(i)}
                style={{
                  flex: 1, padding: '10px 4px 8px', textAlign: 'center',
                  background: isSelected ? UI.goldFaint : isCompleted ? UI.goldFaint : isMissed ? 'rgba(var(--danger-rgb),0.08)' : isSkipped ? 'rgba(160,160,160,0.07)' : 'transparent',
                  border: `${isSelected ? '2px' : '0.5px'} solid ${isSelected ? UI.gold : isCompleted ? UI.goldSoft : isMissed ? 'rgba(var(--danger-rgb),0.4)' : isSkipped ? 'rgba(160,160,160,0.3)' : d.isToday ? UI.hairStrong : UI.hair}`,
                  borderRadius: 4, cursor: 'pointer',
                  minHeight: 56,
                }}>
                <div className="num" style={{ fontSize: 9, color: isSelected ? UI.gold : d.isToday ? UI.inkSoft : UI.inkFaint }}>
                  {cycleWeekView && !weekdayMode ? (
                    <>
                      <div>{WEEKDAYS[d.weekday]}</div>
                      <div style={{ fontSize: 7, marginTop: 1, opacity: 0.75 }}>
                        {d.date.toLocaleDateString('en-US', { day: 'numeric', month: 'numeric' }).replace(/\.$/, '')}
                      </div>
                    </>
                  ) : slotLabel}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: r ? UI.inkFaint : isSelected ? UI.gold : isMissed ? UI.danger : isSkipped ? UI.inkFaint : UI.ink, letterSpacing: '0.06em' }}>
                  {r ? '—' : d.name.slice(0, 4)}
                </div>
                <div style={{ height: 12, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isCompleted && !isSelected && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.5" style={{ display: 'block' }}>
                      <path d="M2 6l2.5 2.5L10 3"/>
                    </svg>
                  )}
                  {isMissed && !isSelected && <div style={{ width: 4, height: 4, borderRadius: '50%', background: UI.danger }} />}
                  {isSkipped && !isSelected && <span style={{ fontSize: 8, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1 }}>—</span>}
                  {isSelected && <div style={{ width: 4, height: 4, borderRadius: '50%', background: UI.gold }} />}
                </div>
              </div>
            );
          })}
        </div>

        {/* cycle week view — indicator bar showing cycle boundaries */}
        {cycleBarSegments && (
          <div style={{ flexShrink: 0, display: 'flex', gap: 4, marginTop: -4 }}>
            {cycleBarSegments.map((seg, i) => {
              const selDay = week.find(d => d.weekday === selectedWd);
              const selCycleNum = selDay ? Math.floor(selDay.daysFromStart / dayCount) + 1 : null;
              const isActive = seg.cycleNum === selCycleNum;
              return (
                <div key={i} style={{
                  flex: seg.count, height: 16, borderRadius: 4,
                  background: isActive ? UI.goldFaint : 'rgba(201,169,97,0.06)',
                  border: `0.5px solid ${isActive ? UI.goldSoft : UI.hair}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {seg.count >= 2 && (
                    <span style={{ fontSize: 7, color: isActive ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.12em', fontWeight: 600 }}>
                      C{seg.cycleNum}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* day card — flex:1 so it fills */}
        {isActiveRest ? (
          <BracketFrame style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 28 }}>
            <div className="micro" style={{ marginBottom: 12 }}>{cardLabel}</div>
            <div style={{ fontFamily: UI.fontDisplay, fontSize: 56, fontWeight: 900, letterSpacing: '0.04em', textTransform: 'uppercase', color: UI.inkSoft, lineHeight: 0.9, marginBottom: 14 }}>
              RECOVER.
            </div>
            <div style={{ fontSize: 13, color: UI.inkFaint, marginBottom: 22, maxWidth: 220 }}>
              Recovery is part of the plan.
            </div>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <Btn kind="ghost" onClick={() => go({ name: 'plan-view' })} style={{ flex: 1 }}>View plan</Btn>
            </div>
          </BracketFrame>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', padding: '4px 0' }}>
            <div className="micro-gold" style={{ marginBottom: 6 }}>{cardLabel}</div>
            <div style={{
              fontFamily: UI.fontDisplay, fontSize: 72, fontWeight: 900,
              textTransform: 'uppercase', letterSpacing: '0.04em',
              color: UI.gold, lineHeight: 0.9, marginBottom: 20,
            }}>
              {activeDay.name}
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 20, marginBottom: 18, width: '100%', justifyContent: 'center' }}>
              <SubDial size={80} label="EXERCISES" value={activeDay.items.length} />
              <div style={{ width: 1, background: UI.hairStrong, alignSelf: 'stretch' }} />
              <SubDial size={80} label="MIN" value={avgDayDuration != null ? `~${avgDayDuration}` : `~${Math.round(activeDay.items.reduce((a,b) => a + b.sets*2 + 3, 0))}`} />
              <div style={{ width: 1, background: UI.hairStrong, alignSelf: 'stretch' }} />
              <SubDial size={80} label="SETS" value={activeDay.items.reduce((a,b) => a + b.sets, 0)} />
            </div>

            {/* CTAs — above exercise list so the action is always immediately visible */}
            {isSlotDone ? (
              <Frame
                onClick={doneSession ? () => go({ name: 'session', sessionId: doneSession.id, back: { name: 'home' } }) : undefined}
                style={{ padding: '14px 18px', width: '100%', cursor: doneSession ? 'pointer' : 'default' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 4, background: UI.goldFaint, border: `1px solid ${UI.goldSoft}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.5"><path d="M2 6l2.5 2.5L10 3"/></svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="micro-gold" style={{ marginBottom: 2 }}>WORKOUT COMPLETE</div>
                    <div style={{ fontSize: 13, color: UI.inkSoft, display: 'flex', alignItems: 'center', gap: 10 }}>
                      {doneSession?.ended && (() => {
                        const d = new Date(doneSession.ended);
                        const dd = d.getDate().toString().padStart(2,'0');
                        const mm = (d.getMonth()+1).toString().padStart(2,'0');
                        const hh = d.getHours().toString().padStart(2,'0');
                        const min = d.getMinutes().toString().padStart(2,'0');
                        return <span style={{ color: UI.inkFaint }} className="num">{dd}.{mm}.{d.getFullYear()} {hh}:{min}</span>;
                      })()}
                      {improvementCount === 0 && regressionCount === 0 ? null : (
                        <>
                          {improvementCount > 0 && (
                            <span style={{ color: '#7bc47b', fontWeight: 600 }}>↑ {improvementCount}</span>
                          )}
                          {regressionCount > 0 && (
                            <span style={{ color: UI.danger, fontWeight: 600 }}>↓ {regressionCount}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {doneSession && <ChevronRight />}
                </div>
              </Frame>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                {selectedDateSkip && (
                  <Frame style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 4, background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ color: UI.inkFaint, fontSize: 14, lineHeight: 1 }}>—</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="micro" style={{ marginBottom: 2, color: UI.inkFaint }}>ARCHIVED</div>
                        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi }}>
                          {selectedDateSkip.skipReason === '—' ? 'Not logged in time · delete to log' : selectedDateSkip.skipReason}
                        </div>
                      </div>
                      <button onClick={() => setSkipReasonModal({ mode: 'edit', skipId: selectedDateSkip.id, currentReason: selectedDateSkip.skipReason, data: { dateKey: sessionDate.toISOString().slice(0, 10), dayId: activeDay?.id, dayName: activeDay?.name } })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: UI.inkFaint, display: 'flex', alignItems: 'center' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button onClick={() => { LB.deleteSkip(selectedDateSkip.id).catch(() => {}); setStore(s => ({ ...s, skips: (s.skips || []).filter(x => x.id !== selectedDateSkip.id) })); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', color: UI.danger, fontSize: 18, lineHeight: 1, fontFamily: UI.fontUi }}>×</button>
                    </div>
                  </Frame>
                )}
                {!selectedDateSkip && (
                  <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
                    <button onClick={startSession} disabled={!!store.inProgress} style={{
                      opacity: store.inProgress ? 0.35 : 1,
                      flex: 1, minHeight: 90, borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
                      boxShadow: '0 12px 40px rgba(var(--accent-rgb),0.35), 0 0 0 1px rgba(var(--accent-rgb),0.6)',
                      animation: 'pulseGold 3.5s ease-out infinite',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
                      WebkitTapHighlightColor: 'transparent',
                    }}>
                      <span style={{ color: 'rgba(10,8,5,0.75)', letterSpacing: '0.18em', fontWeight: 700, fontSize: 15, fontFamily: UI.fontUi }}>
                        {isViewingToday || isFutureSlot ? 'START WORKOUT' : 'LOG SESSION'}
                      </span>
                      <i className="fa-solid fa-dumbbell" style={{ fontSize: 22, color: 'rgba(10,8,5,0.55)' }} />
                    </button>
                    {!weekdayMode && isViewingToday && (
                      <button onClick={() => setSkipReasonModal({ mode: 'skip', data: { dateKey: sessionDate.toISOString().slice(0, 10), dayId: activeDay?.id, dayName: activeDay?.name } })} style={{
                        flex: 1, minHeight: 90, borderRadius: 6, cursor: 'pointer',
                        background: 'transparent',
                        border: `1px solid ${UI.hairStrong}`,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
                        WebkitTapHighlightColor: 'transparent',
                      }}>
                        <span className="micro" style={{ color: UI.inkFaint, letterSpacing: '0.22em', fontWeight: 600 }}>DAY</span>
                        <span style={{ fontSize: 28, color: UI.inkSoft, fontFamily: UI.fontDisplay, fontWeight: 700, lineHeight: 1 }}>→</span>
                        <span className="micro" style={{ color: UI.inkFaint }}>SKIP</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* THE WORK divider + exercise list */}
            {activeDay.items.length > 0 && (
              <div style={{ width: '100%', marginTop: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1, height: 1, background: UI.hair }} />
                  <span style={{ fontFamily: UI.fontDisplay, fontSize: 10, fontWeight: 700, letterSpacing: '0.30em', color: UI.inkFaint }}>THE WORK</span>
                  <div style={{ flex: 1, height: 1, background: UI.hair }} />
                </div>
                {activeDay.items.map((item, i) => {
                  const ex = LB.findExercise(store, item.exId);
                  let setsText, repsText, isActual = false, maxKg = null;

                  if (isSlotDone && doneSession) {
                    const entry = doneSession.entries.find(e => e.exId === item.exId);
                    if (entry) {
                      const doneSets = entry.sets.filter(s => !s.warmup && s.done && !s.skipped);
                      setsText = String(doneSets.length);
                      const repsArr = doneSets.map(s => s.reps).filter(r => r != null);
                      repsText = repsArr.length > 0 ? repsArr[0] : item.reps;
                      const kgs = doneSets.map(s => s.kg).filter(k => k != null);
                      maxKg = kgs.length > 0 ? Math.max(...kgs) : null;
                      isActual = true;
                    }
                  }

                  if (!isActual) {
                    setsText = item.sets;
                    const suggestion = LB.progressionSuggestion(store, item.exId, activeDay.id, item.reps);
                    const last = LB.lastSessionForExercise(store, item.exId, activeDay.id);
                    const prev = last?.entry?.sets?.find(s => !s.warmup);
                    const smart = !!store.settings?.smartProgression;
                    if (suggestion) {
                      repsText = suggestion.reps; maxKg = suggestion.kg;
                    } else if (smart && prev) {
                      repsText = prev.reps != null ? prev.reps + 1 : item.reps; maxKg = prev.kg ?? null;
                    } else if (prev) {
                      repsText = prev.reps ?? item.reps; maxKg = prev.kg ?? null;
                    } else {
                      repsText = item.reps;
                    }
                  }
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${UI.hair}` }}>
                      <span className="num" style={{ fontSize: 10, color: UI.inkGhost, minWidth: 20, textAlign: 'right', flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
                      <span style={{ flex: 1, fontSize: 13, fontFamily: UI.fontUi, color: isActual ? UI.ink : UI.inkSoft, fontWeight: isActual ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex?.name || '?'}</span>
                      {maxKg != null && <span className="num" style={{ fontSize: 11, color: UI.inkFaint, flexShrink: 0 }}>{maxKg}kg</span>}
                      <span className="micro" style={{ color: isActual ? UI.gold : UI.inkFaint, letterSpacing: '0.10em', flexShrink: 0 }}>{setsText}×{repsText}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Missed / skipped banner */}
        {recentBannerDay && !store.inProgress && (
          <RecentBannerDay
            banner={recentBannerDay}
            store={store} setStore={setStore} go={go} sch={sch}
            onOpenSkipSheet={setSkipReasonModal}
          />
        )}

        {/* last session strip */}
        {lastSession && (
          <LastSessionStrip session={lastSession} onClick={() => go({ name: 'session', sessionId: lastSession.id })} />
        )}
      </div>
      <SkipReasonSheet
        modal={skipReasonModal}
        onClose={() => setSkipReasonModal(null)}
        setStore={setStore}
        userId={userId}
      />
      {warmupPromptData && (() => {
        const { firstWorkingKg, firstName } = warmupPromptData;
        const ft10 = kg => Math.round(kg / 10) * 10;
        const preview = [
          { pct: 30, kg: firstWorkingKg != null ? (ft10(firstWorkingKg * 0.30) || null) : null, reps: 12 },
          { pct: 60, kg: firstWorkingKg != null ? (ft10(firstWorkingKg * 0.60) || null) : null, reps: 8 },
          { pct: 100, kg: firstWorkingKg, reps: 4 },
        ];
        return (
          <Sheet open={true} onClose={() => setWarmupPromptData(null)} title="Warmup?">
            <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.7, marginBottom: 14 }}>
              3 sets · <span style={{ color: UI.inkSoft }}>{firstName}</span> · timer starts after last warmup set
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22 }}>
              {preview.map(({ pct, kg, reps }) => (
                <div key={pct} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 14px', background: UI.bgInset, borderRadius: 4, border: `1px solid ${UI.hairStrong}` }}>
                  <span className="micro" style={{ color: UI.inkFaint }}>{pct}%</span>
                  <span className="num" style={{ fontSize: 14, color: kg != null ? UI.inkSoft : UI.inkFaint }}>
                    {kg != null ? `${kg}kg` : '—'} · {reps}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => confirmStart(false)} style={{ flex: 1, fontSize: 12 }}>Skip</Btn>
              <Btn onClick={() => confirmStart(true)} style={{ flex: 2, fontSize: 12 }}>Start with warmup</Btn>
            </div>
          </Sheet>
        );
      })()}
      {confirmEl}
    </Screen>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { LoginScreen, HomeScreen });
