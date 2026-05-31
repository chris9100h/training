/* Training mode — Hero Set redesign. All session/persistence logic identical
   to original (Supabase sync, push-over scheduling, plan-diff prompt,
   swap-exercise sheet, rest timer, abandon flow).
*/

const { useState: useStateT, useEffect: useEffectT, useRef: useRefT } = React;

// ── Debug log ────────────────────────────────────────────────────────────────
window._dbg = window._dbg || [];
window._log = window._log || ((msg) => {
  const entry = { t: Date.now(), msg };
  window._dbg.push(entry);
  if (window._dbg.length > 1000) window._dbg.shift();
});
const _log = window._log;
// ─────────────────────────────────────────────────────────────────────────────

function KgInput({ value, onChange, done, style, onActivate, kbRaw, isKbActive }) {
  const fmt = v => v != null ? String(v).replace('.', ',') : '';
  const [raw, setRaw] = useStateT(() => fmt(value));
  const focused = useRefT(false);
  useEffectT(() => { if (!focused.current && !isKbActive) setRaw(fmt(value)); }, [value, isKbActive]);

  if (onActivate !== undefined) {
    return (
      <input
        type="text" readOnly inputMode="none"
        autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
        value={isKbActive ? kbRaw : fmt(value)}
        placeholder="—"
        disabled={done}
        style={{ ...style, caretColor: 'transparent', userSelect: 'none', ...(isKbActive ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }}
        onPointerDown={e => { e.preventDefault(); e.stopPropagation(); if (!done) onActivate(); }}
      />
    );
  }
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

// ─── Plate Calculator ────────────────────────────────────────────────
const PLATES_KG = [20, 10, 5, 2.5, 1.25, 0.75, 0.5, 0.25];
const PLATE_COLORS = { 20:'#2471a3', 10:'#1a1a1a', 5:'#1e8449', 2.5:'#ca6f1e', 1.25:'#148f77', 0.75:'#808b96', 0.5:'#808b96', 0.25:'#808b96' };
const PLATE_TEXT   = { 20:'#fff',    10:'#ccc',  5:'#fff',    2.5:'#fff',    1.25:'#fff',   0.75:'#fff',   0.5:'#fff',   0.25:'#fff'  };
const PLATE_SIZE   = { 20: 64,       10: 56,     5: 48,       2.5: 42,       1.25: 36,      0.75: 30,      0.5: 30,      0.25: 30     };

function calcPlates(weight) {
  const result = [];
  let rem = Math.round(weight * 1000) / 1000;
  for (const p of PLATES_KG) {
    const n = Math.floor(rem / p + 1e-9);
    if (n > 0) { result.push({ p, n }); rem = Math.round((rem - p * n) * 1000) / 1000; }
  }
  return { plates: result, remainder: rem };
}

function PlateCalcSheet({ open, onClose, initialWeight }) {
  const [tab, setTab] = useStateT(0);
  const [raw, setRaw] = useStateT('');
  const [fresh, setFresh] = useStateT(false);
  const prevOpen = useRefT(false);
  useEffectT(() => {
    if (open && !prevOpen.current) {
      setRaw(initialWeight != null ? String(initialWeight).replace('.', ',') : '');
      setFresh(initialWeight != null);
    }
    prevOpen.current = open;
  }, [open, initialWeight]);

  const target = parseFloat(raw.replace(',', '.')) || 0;
  const perSide = tab === 0 ? target / 2 : target;
  const { plates, remainder } = calcPlates(perSide);

  // round up per-side to next achievable multiple of smallest plate
  const sides = tab === 0 ? 2 : 1;
  const correctedTotal = remainder > 0.01 ? (() => {
    const smallest = PLATES_KG[PLATES_KG.length - 1]; // 0.25
    const units = Math.round(smallest * 1000);
    const newPerSide = Math.ceil(Math.round(perSide * 1000) / units) * units / 1000;
    return Math.round(newPerSide * sides * 1000) / 1000;
  })() : null;
  const correctionDelta = correctedTotal !== null
    ? Math.round((correctedTotal - target) * 1000) / 1000
    : null;

  return (
    <Sheet open={open} onClose={onClose} title="Plate Calculator">
      {/* Segmented control */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 24, background: UI.bgInset, borderRadius: 4, padding: 3 }}>
        {['Dual side', 'Single'].map((l, i) => (
          <button key={i} onClick={() => setTab(i)} style={{
            flex: 1, padding: '8px 0', borderRadius: 4, border: 'none', cursor: 'pointer',
            background: tab === i ? 'var(--accent)' : 'transparent',
            color: tab === i ? '#0a0805' : UI.inkFaint,
            fontFamily: UI.fontUi, fontSize: 12, letterSpacing: '0.06em',
            fontWeight: tab === i ? 600 : 400,
            boxShadow: 'none',
            transition: 'all 0.15s',
          }}>{l}</button>
        ))}
      </div>

      {/* Weight input — large, centered */}
      <div style={{ position: 'relative', textAlign: 'center', marginBottom: 6 }}>
        <input
          type="text" inputMode="none" readOnly
          value={raw} placeholder="0"
          onPointerDown={e => e.preventDefault()}
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: UI.ink, fontFamily: UI.fontNum, fontSize: 48, fontWeight: 300,
            letterSpacing: '-0.03em', textAlign: 'center',
            width: '100%', boxSizing: 'border-box',
            paddingBottom: 8,
            caretColor: 'transparent', userSelect: 'none',
          }}
        />
        <span style={{
          position: 'absolute', right: 6, bottom: 14,
          fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, letterSpacing: '0.1em',
        }}>KG</span>
      </div>
      <div className="knurl" style={{ marginBottom: 10 }} />

      {/* Per-side hint */}
      <div style={{ minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        {tab === 0 && target > 0 && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: UI.fontNum, fontSize: 20, fontWeight: 300, color: UI.gold, letterSpacing: '-0.02em' }}>{perSide}</span>
            <span style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, letterSpacing: '0.14em' }}>KG PER SIDE</span>
          </div>
        )}
      </div>

      {/* Plate circles */}
      {target > 0 && (
        plates.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center', alignItems: 'flex-end', paddingBottom: 4 }}>
            {plates.map(({ p, n }) => {
              const size = PLATE_SIZE[p] || 32;
              const hole = Math.round(size * 0.3);
              return (
                <div key={p} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 72 }}>
                  <div style={{
                    width: size, height: size, borderRadius: '50%', flexShrink: 0,
                    background: PLATE_COLORS[p] || UI.bgInset,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative',
                    boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 0 1.5px rgba(255,255,255,0.18)`,
                  }}>
                    <div style={{
                      position: 'absolute',
                      width: hole, height: hole, borderRadius: '50%',
                      background: 'var(--bg)',
                      boxShadow: '0 0 0 1.5px rgba(255,255,255,0.18)',
                    }} />
                  </div>
                  <span style={{ fontFamily: UI.fontNum, fontSize: 12, color: UI.inkSoft, letterSpacing: '0.02em' }}>{p} × {n}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, letterSpacing: '0.12em', paddingBottom: 8 }}>
            NO PLATES NEEDED
          </div>
        )
      )}
      {correctionDelta !== null && (
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.danger, letterSpacing: '0.1em' }}>
            CAN'T REACH EXACTLY — {correctionDelta} KG MISSING
          </span>
          <button onClick={() => setRaw(String(correctedTotal).replace('.', ','))} style={{
            padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
            background: 'linear-gradient(180deg, var(--accent-light), var(--accent))',
            border: `0.5px solid var(--accent-deep)`,
            color: '#0a0805', fontFamily: UI.fontNum, fontSize: 10, letterSpacing: '0.06em',
            fontWeight: 700, boxShadow: '0 2px 8px rgba(var(--accent-rgb),0.45)',
          }}>
            +{correctionDelta} kg
          </button>
        </div>
      )}

      {/* Inline numpad — avoids native keyboard / floating cursor */}
      <div className="knurl" style={{ marginTop: 20 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 16 }}>
        {['7','8','9','4','5','6','1','2','3',',','0','⌫'].map(k => (
          <button key={k} onPointerDown={e => {
            e.preventDefault();
            if (k === '⌫') { setRaw(fresh ? '' : r => r.slice(0, -1)); setFresh(false); return; }
            if (k === ',' && !fresh && raw.includes(',')) return;
            setRaw(fresh ? k : r => r + k);
            setFresh(false);
          }} style={{
            height: 46, borderRadius: 4, border: 'none', cursor: 'pointer',
            background: 'var(--bg-raised)', boxShadow: `0 0 0 0.5px var(--hair)`,
            color: k === '⌫' ? UI.inkSoft : UI.ink,
            fontFamily: UI.fontNum, fontSize: 20, fontWeight: 400,
            WebkitTapHighlightColor: 'transparent', userSelect: 'none',
          }}>{k}</button>
        ))}
      </div>
    </Sheet>
  );
}

// ─── Custom Keyboard ──────────────────────────────────────────────────
function CustomKeyboard({ visible, field, onType, onBackspace, onAdjust, onConfirm, onDismiss, onPlateCalc }) {
  if (!visible) return null;
  const isKg = field === 'kg';
  const H = 40;
  const base = {
    background: 'var(--bg-raised)', border: `0.5px solid var(--hair)`, borderRadius: 8,
    color: 'var(--ink)', fontFamily: '"JetBrains Mono", monospace', fontSize: 18, fontWeight: 500,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent', userSelect: 'none', padding: 0,
  };
  const act = { ...base, background: 'var(--bg-inset)', color: 'var(--ink-soft)', fontSize: 13, fontFamily: '"Inter", sans-serif' };

  return (
    <div data-keyboard
      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }}
      onTouchStart={e => { e.preventDefault(); e.stopPropagation(); }}
      style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 95,
      background: 'var(--bg)', borderTop: `0.5px solid var(--hair)`,
      padding: `5px 8px calc(env(safe-area-inset-bottom, 0px) + 5px)`,
    }}>
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gridTemplateRows: `repeat(5, ${H}px)`, gap: 4 }}>
        {/* Row 1: ↓ 🏋 ↑ | ✓ (spans rows 1-4) */}
        <button style={act} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onAdjust(-1); }}>↓</button>
        <button style={act} onClick={onPlateCalc}><i className="fa-solid fa-dumbbell" style={{ fontSize: 11 }} /></button>
        <button style={act} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onAdjust(1); }}>↑</button>
        <button onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onConfirm(); }} style={{ ...base, gridColumn: 4, gridRow: '1 / span 4', background: 'linear-gradient(180deg, var(--accent-light), var(--accent))', color: '#0a0805', fontSize: 20, fontWeight: 700, borderColor: 'var(--accent-deep)' }}>✓</button>

        {/* Row 2: 1 2 3 */}
        {[1,2,3].map(n => <button key={n} style={base} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onType(String(n)); }}>{n}</button>)}
        {/* Row 3: 4 5 6 */}
        {[4,5,6].map(n => <button key={n} style={base} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onType(String(n)); }}>{n}</button>)}
        {/* Row 4: 7 8 9 */}
        {[7,8,9].map(n => <button key={n} style={base} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onType(String(n)); }}>{n}</button>)}

        {/* Row 5: , 0 ⌫ | ⌄ */}
        <button style={{ ...base, color: isKg ? 'var(--ink)' : 'var(--ink-faint)' }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); if (isKg) onType(','); }}>{isKg ? ',' : ''}</button>
        <button style={base} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onType('0'); }}>0</button>
        <button style={act} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onBackspace(); }}>⌫</button>
        <button style={act} onClick={onDismiss}>⌄</button>
      </div>
    </div>
  );
}

function TrainingScreen(props) {
  const session = props.store.sessions.find(s => s.id === props.sessionId);
  // Redirect from an effect — never call go() during render, and never return
  // before the hooks below. The inner component mounts only when the session
  // exists, so its hook order stays stable even if the session disappears
  // mid-workout (abandon, delete, cross-device sync).
  useEffectT(() => { if (!session) props.go({ name: 'home' }); }, [!!session]);
  if (!session) return null;
  return <TrainingScreenInner {...props} session={session} />;
}

function TrainingScreenInner({ store, setStore, go, sessionId, userId, session }) {
  useEffectT(() => {
    if (!('wakeLock' in navigator)) return;
    let lock = null;
    const acquire = async () => {
      try { lock = await navigator.wakeLock.request('screen'); } catch {}
    };
    const onVisibility = () => { if (!document.hidden) acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      lock?.release();
    };
  }, []);

  const _sch = store.schedules?.find(s => s.id === session.scheduleId);
  const isWeekdayMode = _sch ? LB.isWeekdayPlan(_sch) : false;

  const exIdx = session.currentExIdx || 0;
  const entry = session.entries[exIdx];
  const exercise = entry ? LB.findExercise(store, entry.exId) : null;
  const last = entry ? LB.lastSessionForExercise(store, entry.exId, session.dayId) : null;
  const isUnilateral = !!exercise?.unilateral;
  const progressionTarget = (() => {
    if (!store.settings?.smartProgression) return null;
    const base = (exercise?.progression_reps ?? entry?.plannedReps) ?? 0;
    const target = base + (store.settings?.progressionRangeTop ?? 4);
    return target > 0 ? target : null;
  })();

  // Keep the reducer pure — no logging or Error().stack side effects inside
  // setStore (React may invoke updaters more than once). fn only runs for the
  // matching session, so a vanished session is a safe no-op.
  const updateSession = (fn) => {
    setStore(s => ({
      ...s,
      sessions: s.sessions.map(x => x.id === session.id ? fn(x) : x),
    }));
  };

  const updateSet = (setIdx, patch) => {
    if ('done' in patch) _log(`updateSet(${setIdx}, done=${patch.done})`);
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx
        ? { ...e, sets: e.sets.map((st, k) => k === setIdx ? { ...st, ...patch } : st) }
        : e),
    }));
  };

  const isImprovement = (st, prevSet) => {
    if (!prevSet || st.kg == null || prevSet.kg == null) return false;
    const repsA = LB.effReps(st); const repsB = LB.effReps(prevSet);
    if (repsA == null || repsB == null) return false;
    return (st.kg > prevSet.kg && repsA >= repsB - 2) || (st.kg >= prevSet.kg && repsA > repsB);
  };
  const isDecline = (st, prevSet) => {
    if (!prevSet || !st || st.skipped || prevSet.skipped) return false;
    if (st.kg == null || prevSet.kg == null) return false;
    const rA = LB.effReps(st); const rB = LB.effReps(prevSet);
    if (rA == null || rB == null) return false;
    return st.kg < prevSet.kg || (st.kg === prevSet.kg && rA < rB);
  };

  const completeSet = (setIdx) => {
    const isLastWarmupSet = !!entry.sets[setIdx]?.warmup &&
      !entry.sets.slice(setIdx + 1).some(s => s.warmup);
    const kb = kbFieldRef.current;
    const rawRef = kbRawRef.current;
    _log(`completeSet(${setIdx}) kb=${kb?.field ?? 'none'} raw='${rawRef}'`);
    kbFieldRef.current = null; kbRawRef.current = ''; kbFreshRef.current = false;
    setKbField(null); setKbRaw(''); setKbFresh(false);
    armKbShield();
    recentCompleteRef.current[setIdx] = Date.now();
    lastCompleteRef.current = Date.now();
    _log(`completeSet(${setIdx}) → lastCompleteRef stamped`);

    // Build the done patch inside the functional updater so we can read the
    // latest queued session state and take the max of ref value vs. session
    // value. This wins regardless of which kbApply calls have flushed yet.
    updateSession(sess => {
      const currSet = sess.entries[exIdx]?.sets[setIdx];
      if (!currSet) return sess;
      const patch = { done: true };
      if (kb && kb.setIdx === setIdx && kb.field !== 'kg') {
        const fromRef = parseInt(rawRef, 10);
        const fromSess = currSet[kb.field] || 0;
        const best = Math.max(isNaN(fromRef) ? 0 : fromRef, fromSess);
        if (best > 0) patch[kb.field] = best;
      }
      return {
        ...sess,
        entries: sess.entries.map((en, ei) => ei !== exIdx ? en : {
          ...en,
          sets: en.sets.map((st, si) => si !== setIdx ? st : { ...st, ...patch }),
        }),
      };
    });
    setFlashSet(setIdx);
    setTimeout(() => setFlashSet(null), 1400);
    // Match the current set to the same working-set position in the previous
    // session. Either session may carry a different number of warm-up sets, so
    // compare by working-set index (warm-ups excluded), never the raw index.
    const prevWorkingSets = (last?.entry?.sets || []).filter(s => !s.warmup);
    const prevWorkingSetFor = (idx) => {
      if (entry.sets[idx]?.warmup) return undefined;
      const wIdx = entry.sets.slice(0, idx + 1).filter(s => !s.warmup).length - 1;
      return wIdx >= 0 ? prevWorkingSets[wIdx] : undefined;
    };
    const prevSet = prevWorkingSetFor(setIdx);
    const updatedSets = entry.sets.map((st, k) => k === setIdx ? { ...st, done: true } : st);

    const progressionResult = (() => {
      if (!store.settings?.smartProgression) return null;
      if (!updatedSets.filter(s => !s.warmup).every(s => s.done || s.skipped)) return null;
      const catCfg = exercise?.equipment ? (store.settings?.equipmentConfig?.[exercise.equipment] ?? {}) : {};
      const increment = catCfg.increment ?? null;
      if (!increment) return null;
      const baseReps = exercise?.progression_reps ?? entry.plannedReps;
      const targetRepsTop = (baseReps ?? 0) + (store.settings?.progressionRangeTop ?? 4);
      const doneSets = updatedSets.filter(s => s.done && !s.skipped && !s.warmup && s.kg != null);
      if (!doneSets.length) return null;
      const allHitTop = doneSets.every(s => {
        const reps = s.repsL != null ? Math.min(s.repsL ?? 0, s.repsR ?? 0) : (s.reps ?? 0);
        return reps >= targetRepsTop;
      });
      if (!allHitTop) return null;
      const refKg = doneSets[0].kg;
      const newKg = Math.round((refKg + increment) * 100) / 100;
      const nextKg = catCfg.maxKg ? Math.min(newKg, catCfg.maxKg) : newKg;
      return nextKg > refKg ? { exName: entry.name, currentKg: refKg, nextKg } : null;
    })();

    if (!entry.sets[setIdx]?.warmup && !progressionResult) {
      if (isImprovement(entry.sets[setIdx], prevSet)) {
        setImprovedSet(true);
        setTimeout(() => setImprovedSet(false), 2500);
      } else {
        const anyImprovementBefore = entry.sets.slice(0, setIdx).some((s, k) => isImprovement(s, prevWorkingSetFor(k)));
        if (!anyImprovementBefore && isDecline(entry.sets[setIdx], prevSet)) {
          setRegressionSet(true);
          setTimeout(() => setRegressionSet(false), 2500);
        }
      }
    }

    if (progressionResult) {
      pendingNavRef.current = true;
      setTimeout(() => {
        setProgressionUnlocked(progressionResult);
        setTimeout(() => {
          setProgressionUnlocked(null);
          if (pendingNavRef.current) { pendingNavRef.current = false; navigate(1); }
        }, 4000);
      }, 800);
    }
    const group = entry.supersetGroup;
    if (group) {
      const newDoneCount = updatedSets.filter(s => s.done).length;
      const partners = session.entries.map((e, i) => ({ e, i })).filter(({ e, i }) => e.supersetGroup === group && i !== exIdx);
      const nextPartner = partners.find(({ e }) => e.sets.filter(s => s.done).length < newDoneCount);
      if (nextPartner) {
        // Mid-round: jump to partner, no rest
        setTimeout(() => updateSession(sess => ({ ...sess, currentExIdx: nextPartner.i })), 300);
      } else {
        // Round complete: start rest
        persistRestStart(Date.now(), restDef);
        const allGroupDone = updatedSets.every(s => s.done) && partners.every(({ e }) => e.sets.every(s => s.done));
        if (allGroupDone) {
          const lastGroupIdx = Math.max(...session.entries.map((e, i) => e.supersetGroup === group ? i : -1));
          setTimeout(() => {
            if (lastGroupIdx + 1 >= session.entries.length) setFinishOpen(true);
            else updateSession(sess => ({ ...sess, currentExIdx: lastGroupIdx + 1 }));
          }, 600);
        } else {
          const allGroup = session.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.supersetGroup === group);
          const firstIncomplete = allGroup.find(({ e, i }) =>
            i === exIdx ? !updatedSets.every(s => s.done) : e.sets.some(s => !s.done)
          );
          if (firstIncomplete) setTimeout(() => updateSession(sess => ({ ...sess, currentExIdx: firstIncomplete.i })), 600);
        }
      }
    } else {
      if (!entry.sets[setIdx]?.warmup) {
        persistRestStart(Date.now(), restDef);
      }
      if (updatedSets.every(st => st.done)) {
        if (!progressionResult) setTimeout(() => navigate(1), 600);
      }
    }
    // Last warmup set done → start 3-min rest, workout timer begins when rest expires
    if (isLastWarmupSet && !session.startedAt) {
      persistRestStart(Date.now(), 180);
    }
  };

  const addSet = () => {
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => {
        if (i !== exIdx) return e;
        const last = e.sets[e.sets.length - 1];
        const newSet = isUnilateral
          ? { kg: last?.kg ?? null, repsL: last?.repsL ?? null, repsR: last?.repsR ?? null, done: false }
          : { kg: last?.kg ?? null, reps: last?.reps ?? null, done: false };
        return { ...e, sets: [...e.sets, newSet] };
      }),
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

  const skipSet = () => {
    const idx = entry.sets.findIndex(s => !s.done && !s.skipped);
    if (idx < 0) return;
    updateSet(idx, { skipped: true });
    const willBeAllDone = entry.sets.every((s, i) => i === idx || s.done || s.skipped);
    if (willBeAllDone) navigate(1);
  };

  const skipExercise = () => {
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx
        ? { ...e, sets: e.sets.map(st => st.done ? st : { ...st, skipped: true }) }
        : e),
    }));
    navigate(1);
  };

  const cancelPushover = () => LB.cancelPushover(store.settings, userId);

  const playBeep = (phase, count = 1, scheduledTime = null) => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const freq = phase === 'ecc' ? 330 : 880;
      const beepDur = 0.07;
      const gap = 0.06;
      const startAt = scheduledTime ?? ctx.currentTime;
      for (let i = 0; i < count; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = startAt + i * (beepDur + gap);
        gain.gain.setValueAtTime(0.9, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + beepDur);
        osc.start(t);
        osc.stop(t + beepDur);
      }
    } catch (e) {}
  };

  const stopTempo = () => {
    if (tempoTimerRef.current) { clearTimeout(tempoTimerRef.current); tempoTimerRef.current = null; }
    setTempoActive(false);
  };

  const startTempo = () => {
    stopTempo();
    setTempoActive(true);
    const eccSecs = store.settings?.tempoEccentric ?? 4;
    const conSecs = store.settings?.tempoConcentric ?? 1;
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const runPhase = (phase, phaseStart) => {
      const phaseDur = phase === 'ecc' ? eccSecs : conSecs;
      const n = Math.max(1, Math.floor(phaseDur));
      const beatInterval = phaseDur / n;
      for (let i = 0; i < n; i++) {
        playBeep(phase, i + 1, phaseStart + i * beatInterval);
      }
      const nextStart = phaseStart + phaseDur;
      const delay = Math.max(0, (nextStart - ctx.currentTime) * 1000);
      tempoTimerRef.current = setTimeout(() => runPhase(phase === 'ecc' ? 'con' : 'ecc', nextStart), delay);
    };
    runPhase('ecc', ctx.currentTime);
  };

  const finish = () => {
    cancelPushover();
    updateSession(sess => {
      const now = new Date();
      const mins = sess.startedAt ? Math.round((now - new Date(sess.startedAt)) / 60000) : null;
      // Seal all non-warmup sets that have recorded values as done — guards
      // against a sync race where kbApply (done:false) lands in Supabase
      // after completeSet (done:true) but before the session is ended.
      const entries = sess.entries.map(e => ({
        ...e,
        sets: e.sets.map(st => {
          if (st.done || st.warmup || st.skipped) return st;
          const hasValue = st.kg != null || st.reps != null || st.repsL != null || st.repsR != null;
          return hasValue ? { ...st, done: true } : st;
        }),
      }));
      return { ...sess, entries, ended: now.toISOString(), ...(mins != null && { durationMinutes: mins }) };
    });
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
    LB.broadcastSessionNav('cancel', session.id);
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
  const [restDuration, setRestDuration] = useStateT(() => session.restDuration ?? null);

  const persistRestStart = (val, dur) => {
    setRestStart(val);
    const newDur = val !== null ? (dur ?? null) : null;
    setRestDuration(newDur);
    updateSession(sess => ({ ...sess, restStart: val, restDuration: newDur }));
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
  // Use the duration snapshotted when the timer started, not the current exercise's category
  const activeRestDef = (restStart !== null && restDuration !== null) ? restDuration : restDef;
  const restElapsed = restStart ? Math.floor((now - restStart) / 1000) : null;
  const restRemaining = restElapsed != null ? Math.max(0, activeRestDef - restElapsed) : null;
  const restPct = restElapsed != null ? Math.max(0, Math.min(100, (restElapsed / activeRestDef) * 100)) : 0;

  useEffectT(() => {
    if (!restStart) return;
    if (!store.settings?.pushEnabled) return;
    const delaySeconds = Math.round(Math.max(0, restStart + activeRestDef * 1000 - Date.now()) / 1000);
    fetch(LB.PUSHOVER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LB.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ delaySeconds, nonce: String(restStart) + '-' + Math.random().toString(36).slice(2, 8), userKey: store.settings?.pushoverUserKey ?? '', userId, priority: 1 }),
    }).catch(() => {});
  }, [restStart]);

  // beep + auto-open modal when rest timer hits zero
  const prevRestRemaining = useRefT(null);
  useEffectT(() => {
    const prev = prevRestRemaining.current;
    prevRestRemaining.current = restRemaining;
    if (prev !== null && prev > 0 && restRemaining === 0) {
      const wasPostWarmup = !session.startedAt;
      if (wasPostWarmup) {
        updateSession(sess => sess.startedAt ? sess : { ...sess, startedAt: new Date().toISOString() });
      } else {
        setRestModalOpen(true);
      }
      // gold screen flash 3×
      let i = 0;
      const flash = () => {
        if (i >= 3) return;
        setScreenFlash(true);
        setTimeout(() => { setScreenFlash(false); i++; setTimeout(flash, 140); }, 220);
      };
      flash();
      // audio: two beeps + higher tone (blocked by iOS silent switch, but nice to have)
      // Reuse the shared AudioContext created during a prior user gesture — creating
      // a new one here (timer tick, no gesture) causes iOS to suspend it immediately
      // and resume() silently fails, so the sound never plays.
      try {
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = audioCtxRef.current;
        const play = () => {
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
        };
        ctx.state === 'suspended' ? ctx.resume().then(play) : play();
      } catch (_) {}
    }
  }, [restRemaining]);

  const [flashSet, setFlashSet] = useStateT(null);
  const [improvedSet, setImprovedSet] = useStateT(false);
  const [regressionSet, setRegressionSet] = useStateT(false);
  const [progressionUnlocked, setProgressionUnlocked] = useStateT(null);
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
  const [avgStats, setAvgStats] = useStateT(null);
  const [tempoActive, setTempoActive] = useStateT(false);
  const tempoTimerRef = useRefT(null);
  const audioCtxRef = useRefT(null);
  const [kbField, setKbField] = useStateT(null); // { setIdx, field }
  const [kbRaw, setKbRaw] = useStateT('');
  const [kbFresh, setKbFresh] = useStateT(false);
  const kbFieldRef = useRefT(null);
  const kbRawRef = useRefT('');
  const kbFreshRef = useRefT(false);
  const [kbShield, setKbShield] = useStateT(false);
  const kbShieldTimerRef = useRefT(null);
  // After keyboard dismissal (completeSet or ⌄), briefly keep a touch-blocking
  // shield at the keyboard's screen position so iOS ghost clicks (fired 200-300ms
  // after the touch that closed the keyboard) don't land on revealed content.
  const armKbShield = () => {
    setKbShield(true);
    clearTimeout(kbShieldTimerRef.current);
    kbShieldTimerRef.current = setTimeout(() => setKbShield(false), 400);
  };
  const [plateCalcOpen, setPlateCalcOpen] = useStateT(false);
  const pendingNavRef = useRefT(false);
  // Records when a set was last completed via the checkbox; used to ignore
  // iOS ghost-clicks that fire 200-400ms after completion and would otherwise
  // re-enter the onClick handler with s.done=true and undo the completion.
  const recentCompleteRef = useRefT({});
  // Global timestamp of the most-recent completion across all sets — catches
  // ghost-clicks that land on a *different* row than the one just completed
  // (e.g. the keyboard ✓ is over an older row at the time iOS fires the ghost).
  const lastCompleteRef = useRefT(0);

  useEffectT(() => { kbFieldRef.current = null; kbRawRef.current = ''; kbFreshRef.current = false; setKbField(null); setKbRaw(''); setKbFresh(false); }, [exIdx, sessionId]);
  useEffectT(() => () => stopTempo(), []);
  useEffectT(() => { if (userId && sessionId) LB.broadcastExIdx(sessionId, exIdx); }, [exIdx]);

  // Log ALL document pointer/click events — captures ghost-clicks and shows where they land.
  useEffectT(() => {
    const onPD = e => {
      const isKb = !!e.target.closest('[data-keyboard]');
      const isComplete = !!e.target.closest('[data-complete-btn]');
      _log(`[DOM] pointerdown type=${e.pointerType} isPrimary=${e.isPrimary} kb=${isKb} completebtn=${isComplete} tag=${e.target.tagName}`);
    };
    const onClick = e => {
      const isKb = !!e.target.closest('[data-keyboard]');
      const isComplete = !!e.target.closest('[data-complete-btn]');
      _log(`[DOM] click isTrusted=${e.isTrusted} kb=${isKb} completebtn=${isComplete} tag=${e.target.tagName}`);
    };
    document.addEventListener('pointerdown', onPD, true);
    document.addEventListener('click', onClick, true);
    return () => { document.removeEventListener('pointerdown', onPD, true); document.removeEventListener('click', onClick, true); };
  }, []);

  useEffectT(() => {
    if (!session?.dayId || !session?.id || !userId) return;
    LB.supabase
      .from('zane_sessions')
      .select('started_at, ended, entries, duration_minutes')
      .eq('user_id', userId)
      .eq('day_id', session.dayId)
      .not('ended', 'is', null)
      .neq('id', session.id)
      .then(({ data }) => {
        if (!data?.length) return;
        const valid = data.filter(s => {
          const durSec = s.duration_minutes != null
            ? s.duration_minutes * 60
            : (s.started_at ? (new Date(s.ended) - new Date(s.started_at)) / 1000 : null);
          return durSec != null && durSec > 0;
        });
        if (!valid.length) return;
        const avgDurSec = valid.reduce((sum, s) => {
          const sec = s.duration_minutes != null
            ? s.duration_minutes * 60
            : (new Date(s.ended) - new Date(s.started_at)) / 1000;
          return sum + sec;
        }, 0) / valid.length;
        const avgSetsTotal = valid.reduce((sum, s) => sum + (s.entries || []).reduce((t, e) => t + (e.sets?.filter(st => st.done).length || 0), 0), 0) / valid.length;
        setAvgStats({ avgDurSec, avgSetsTotal });
      });
  }, [session?.id]);

  // No document-level dismiss: the auto-dismiss fired during digit presses (iOS
  // multi-touch / accidental palm) and cleared kbFieldRef synchronously, causing
  // kbTypeChar to return early on the next digit and "swallowing" it. The keyboard
  // now stays open until the user taps ⌄ explicitly or navigates away.

  const activateKb = (setIdx, field) => {
    _log(`activateKb(set${setIdx} ${field})`);
    const s = (store.sessions.find(x => x.id === sessionId)?.entries[exIdx]?.sets[setIdx]);
    const val = field === 'kg'
      ? (s?.kg != null ? String(s.kg).replace('.', ',') : '')
      : (s?.[field] != null ? String(s[field]) : '');
    kbFieldRef.current = { setIdx, field };
    kbRawRef.current = val;
    kbFreshRef.current = true;
    setKbField({ setIdx, field });
    setKbRaw(val);
    setKbFresh(true);
    setTimeout(() => {
      const el = document.querySelector(`[data-kb-row="${setIdx}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  };

  const kbApply = (newRaw, field, setIdx) => {
    _log(`kbApply(set${setIdx} ${field} '${newRaw}')`);
    if (field === 'kg') {
      const num = newRaw === '' ? null : parseFloat(newRaw.replace(',', '.'));
      if (newRaw === '' || !isNaN(num)) {
        updateSession(sess => ({
          ...sess,
          entries: sess.entries.map((en, ei) => ei !== exIdx ? en : {
            ...en,
            sets: en.sets.map((st, si) =>
              si === setIdx ? { ...st, kg: num ?? null, done: false }
              : si > setIdx && !st.done ? { ...st, kg: num ?? null }
              : st
            ),
          }),
        }));
      }
    } else {
      const num = newRaw === '' ? null : parseInt(newRaw, 10);
      if (newRaw === '' || !isNaN(num)) updateSet(setIdx, { [field]: num ?? null, done: false });
    }
  };

  const kbTypeChar = (char) => {
    if (!kbFieldRef.current) { _log(`TYPE '${char}' → NULL kbField (swallowed!)`); return; }
    const { setIdx, field } = kbFieldRef.current;
    const base = kbFreshRef.current ? '' : kbRawRef.current;
    if (char === ',' && (field !== 'kg' || base.includes(','))) return;
    const newRaw = base + char;
    kbRawRef.current = newRaw;
    kbFreshRef.current = false;
    setKbRaw(newRaw);
    setKbFresh(false);
    _log(`TYPE '${char}' → '${newRaw}' (set${setIdx} ${field})`);
    kbApply(newRaw, field, setIdx);
  };

  const kbBackspace = () => {
    if (!kbFieldRef.current) return;
    const { setIdx, field } = kbFieldRef.current;
    const newRaw = kbFreshRef.current ? '' : kbRawRef.current.slice(0, -1);
    kbRawRef.current = newRaw;
    kbFreshRef.current = false;
    setKbRaw(newRaw);
    setKbFresh(false);
    kbApply(newRaw, field, setIdx);
  };

  const kbAdjust = (dir) => {
    if (!kbFieldRef.current) return;
    const { setIdx, field } = kbFieldRef.current;
    if (field === 'kg') {
      const cur = parseFloat(kbRawRef.current.replace(',', '.')) || 0;
      const next = Math.max(0, Math.round((cur + dir * 1.25) * 100) / 100);
      const newRaw = String(next).replace('.', ',');
      kbRawRef.current = newRaw;
      setKbRaw(newRaw);
      updateSession(sess => ({
        ...sess,
        entries: sess.entries.map((en, ei) => ei !== exIdx ? en : {
          ...en,
          sets: en.sets.map((st, si) =>
            si === setIdx ? { ...st, kg: next, done: false }
            : si > setIdx && !st.done ? { ...st, kg: next }
            : st
          ),
        }),
      }));
    } else {
      const cur = parseInt(kbRawRef.current, 10) || 0;
      const next = Math.max(0, cur + dir);
      kbRawRef.current = String(next);
      setKbRaw(String(next));
      updateSet(setIdx, { [field]: next, done: false });
    }
  };

  const kbConfirm = () => {
    if (!kbFieldRef.current) { _log('kbConfirm: NULL kbField (ignored)'); return; }
    const { setIdx, field } = kbFieldRef.current;
    _log(`kbConfirm: set${setIdx} field=${field} raw='${kbRawRef.current}'`);
    kbApply(kbRawRef.current, field, setIdx);
    if (field === 'kg') {
      _log(`kbConfirm: kg→${isUnilateral ? 'repsL' : 'reps'}`);
      activateKb(setIdx, isUnilateral ? 'repsL' : 'reps');
    } else if (field === 'repsL') {
      _log('kbConfirm: repsL→repsR');
      activateKb(setIdx, 'repsR');
    } else {
      _log(`kbConfirm: ${field}→completeSet(${setIdx})`);
      completeSet(setIdx);
      const nextIdx = entry.sets.findIndex((s, i) => i > setIdx && !s.done);
      if (nextIdx !== -1) setTimeout(() => activateKb(nextIdx, isUnilateral ? 'repsL' : 'reps'), 350);
    }
  };

  const saveExNote = () => {
    setStore(s => ({ ...s, exercises: s.exercises.map(e => e.id === entry.exId ? { ...e, note: exNoteVal.trim() } : e) }));
    setExNoteOpen(false);
  };

  const swapExercise = async () => {
    if (!await confirm(`Swap "${entry.name}"?`, { ok: 'Swap' })) return;
    setSwapOpen(true);
  };

  const doSwap = (newExId) => {
    // resolve the name from fresh state — a just-created exercise isn't in the
    // closed-over `store` yet (its setStore hasn't re-rendered the screen)
    setStore(s => {
      const newEx = LB.findExercise(s, newExId);
      return {
        ...s,
        sessions: s.sessions.map(x => x.id !== session.id ? x : {
          ...x,
          entries: x.entries.map((e, i) => i !== exIdx ? e : { ...e, exId: newExId, name: newEx?.name || e.name }),
        }),
      };
    });
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
      } else if (entry.sets.filter(s => !s.warmup).length !== planItem.sets) {
        acc.push({ type: 'sets', idx: i, exName: entry.name, oldSets: planItem.sets, newSets: entry.sets.filter(s => !s.warmup).length });
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
        if (diff.type === 'sets') return { ...item, sets: session.entries[i].sets.filter(s => !s.warmup).length };
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
    return <Screen><Empty title="This session is empty" action={<Btn onClick={() => go({ name: 'home' })}>Back</Btn>} /></Screen>;
  }

  const completed = entry.sets.filter(s => s.done).length;
  const allDone = completed === entry.sets.length;
  const currentSetIdx = entry.sets.findIndex(s => !s.done);
  const warmupCount = entry.sets.filter(s => s.warmup).length;
  const isCurrentWarmup = warmupCount > 0 && currentSetIdx >= 0 && !!entry.sets[currentSetIdx]?.warmup;
  const warmupSetsRemaining = warmupCount > 0 && entry.sets.filter(s => s.warmup).some(s => !s.done);
  const allWarmupDone = warmupCount > 0 && entry.sets.filter(s => s.warmup).every(s => s.done);
  const postWarmupRest = allWarmupDone && !session.startedAt;
  const warmupActive = warmupCount > 0 && !session.startedAt;
  const currentSetNum = currentSetIdx >= 0 ? currentSetIdx + 1 : entry.sets.length;
  // While the warmup overlay is showing, the background displays the first working set (not the warmup set)
  const bgSetIdx = warmupSetsRemaining
    ? entry.sets.findIndex(s => !s.warmup)
    : currentSetIdx;
  const heroSet = bgSetIdx >= 0 ? entry.sets[bgSetIdx] : null;
  // For warmup sets there's no meaningful "last session" comparison
  const prevHeroSet = isCurrentWarmup ? null : (last?.entry?.sets || []).filter(s => !s.warmup)[bgSetIdx >= 0 ? bgSetIdx - warmupCount : 0];

  const workingSetsArr = entry.sets.filter(s => !s.warmup);
  const allWorkingDone = workingSetsArr.length > 0 && workingSetsArr.every(s => s.done || s.skipped);
  const anyMissingData = workingSetsArr.some(st => !st.done && !st.skipped && (st.kg == null || (isUnilateral ? (!st.repsL || !st.repsR) : !st.reps)));

  const checkAllSets = async () => {
    if (allWorkingDone || anyMissingData) return;
    if (!await confirm(`Check off all ${workingSetsArr.length} sets and continue?`, { ok: 'Check all' })) return;
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx
        ? { ...e, sets: e.sets.map(st => st.warmup ? st : { ...st, done: true }) }
        : e),
    }));
    persistRestStart(Date.now(), restDef);
    setTimeout(() => navigate(1), 600);
  };

  const skipWarmup = () => {
    updateSession(sess => ({
      ...sess,
      startedAt: new Date().toISOString(),
      entries: sess.entries.map((e, i) => i === 0
        ? { ...e, sets: e.sets.map(st => st.warmup ? { ...st, done: true } : st) }
        : e
      ),
    }));
    persistRestStart(null);
  };

  const startNow = () => {
    updateSession(sess => sess.startedAt ? sess : { ...sess, startedAt: new Date().toISOString() });
    persistRestStart(null);
  };

  // Derive warmup overlay vars here so they're available inside the main return
  const warmupOverlayGlobalIdx = warmupSetsRemaining ? entry.sets.findIndex(s => s.warmup && !s.done) : -1;
  const warmupOverlaySets = entry.sets.filter(s => s.warmup);
  const warmupOverlaySet = warmupOverlayGlobalIdx >= 0 ? entry.sets[warmupOverlayGlobalIdx] : null;
  const warmupOverlayNum = warmupOverlaySets.findIndex(s => !s.done) + 1;
  const warmupOverlayHasKg = warmupOverlaySet?.kg != null;

  return (
    <Screen scroll={false}>
      {/* Gold screen flash overlay */}
      {screenFlash && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: UI.gold, opacity: 0.28, pointerEvents: 'none' }} />
      )}
      {/* Improvement overlay */}
      {/* Block keyboard and content interaction while any overlay is visible */}
      {(improvedSet || regressionSet || !!progressionUnlocked) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100 }} />
      )}

      {improvedSet && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 150, pointerEvents: 'none',
          background: 'rgb(8,6,3)',
          animation: 'improvedFade 2.5s ease forwards',
          animationFillMode: 'forwards',
        }}>
          {/* pulsing border ring */}
          <div style={{
            position: 'absolute', inset: 0,
            animation: 'improvedBorderPulse 0.65s ease-in-out infinite',
            borderRadius: 0,
          }} />
          {/* centered label */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 6,
          }}>
            <span style={{ fontFamily: UI.fontDisplay, fontSize: 72, color: UI.gold, fontWeight: 900, lineHeight: 1, textShadow: '0 0 30px rgba(201,169,97,0.9), 0 0 70px rgba(201,169,97,0.5)' }}>↑</span>
            <span style={{ fontFamily: UI.fontUi, fontSize: 28, color: UI.gold, fontWeight: 900, letterSpacing: '0.2em', textShadow: '0 0 15px rgba(201,169,97,1), 0 0 40px rgba(201,169,97,0.8), 0 0 80px rgba(201,169,97,0.4)' }}>IMPROVEMENT</span>
          </div>
        </div>
      )}
      {/* Regression overlay */}
      {regressionSet && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 150, pointerEvents: 'none',
          background: 'rgb(8,6,3)',
          animation: 'improvedFade 2.5s ease forwards',
          animationFillMode: 'forwards',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            animation: 'regressionBorderPulse 0.65s ease-in-out infinite',
            borderRadius: 0,
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 6,
          }}>
            <span style={{ fontFamily: UI.fontDisplay, fontSize: 72, color: UI.danger, fontWeight: 900, lineHeight: 1, textShadow: '0 0 30px rgba(var(--danger-rgb),0.9), 0 0 70px rgba(var(--danger-rgb),0.5)' }}>↓</span>
            <span style={{ fontFamily: UI.fontUi, fontSize: 28, color: UI.danger, fontWeight: 900, letterSpacing: '0.2em', textShadow: '0 0 15px rgba(var(--danger-rgb),1), 0 0 40px rgba(var(--danger-rgb),0.8), 0 0 80px rgba(var(--danger-rgb),0.4)' }}>REGRESSION</span>
          </div>
        </div>
      )}

      {/* Progression unlocked overlay */}
      {progressionUnlocked && (
        <div onClick={() => { setProgressionUnlocked(null); if (pendingNavRef.current) { pendingNavRef.current = false; navigate(1); } }} style={{
          position: 'fixed', inset: 0, zIndex: 160,
          background: 'rgb(8,6,3)',
          animation: 'improvedFade 4s ease forwards',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8,
        }}>
          <div style={{ animation: 'improvedBorderPulse 0.8s ease-in-out infinite', position: 'absolute', inset: 0 }} />
          <span style={{ fontFamily: UI.fontDisplay, fontSize: 64, color: UI.gold, fontWeight: 900, lineHeight: 1, textShadow: '0 0 30px rgba(201,169,97,0.9), 0 0 70px rgba(201,169,97,0.5)' }}>↑</span>
          <span style={{ fontFamily: UI.fontUi, fontSize: 18, color: UI.gold, fontWeight: 900, letterSpacing: '0.22em', textShadow: '0 0 15px rgba(201,169,97,1), 0 0 40px rgba(201,169,97,0.8)' }}>PROGRESSION UNLOCKED</span>
          <span style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 700, marginTop: 4 }}>You've earned the next load.</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <span className="num" style={{ fontSize: 22, color: UI.inkSoft }}>{progressionUnlocked.currentKg}kg</span>
            <span style={{ color: UI.gold, fontSize: 20, lineHeight: 1 }}>→</span>
            <span className="num" style={{ fontSize: 28, color: UI.gold, fontWeight: 700, textShadow: '0 0 20px rgba(201,169,97,0.8)' }}>{progressionUnlocked.nextKg}kg</span>
          </div>
          <span className="micro" style={{ color: UI.inkFaint, marginTop: 6, letterSpacing: '0.12em' }}>{progressionUnlocked.exName}</span>
        </div>
      )}

      {/* Top: close + session timer */}
      <div style={{ flexShrink: 0, padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 22px 8px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={abandon} style={{
          width: 32, height: 32, borderRadius: 4,
          border: `1px solid ${UI.hairStrong}`, background: 'transparent',
          color: UI.danger, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1,
        }}>×</button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          {/* session time / warmup indicator */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: UI.gold, animation: 'pulseDot 1.6s ease-in-out infinite' }} />
            {warmupActive
              ? <span className="num" style={{ color: UI.gold, fontSize: 14, letterSpacing: '0.16em', fontWeight: 500, animation: 'timerPulse 1.6s ease-in-out infinite' }}>WARMUP</span>
              : <span className="num" style={{ color: UI.gold, fontSize: 14, letterSpacing: '0.16em', fontWeight: 500 }}>{sessionTimeStr}</span>
            }
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
          width: 32, height: 32, borderRadius: 4,
          border: `1px solid ${UI.hairStrong}`, background: 'transparent',
          color: UI.inkSoft, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
            <path d="M9 21V12h6v9"/>
          </svg>
        </button>
      </div>

      {/* Pace bar — only when historical avg is available */}
      {avgStats && (() => {
        const totalSetsDone  = session.entries.reduce((s, e) => s + (e.sets?.filter(x => x.done && !x.warmup).length || 0), 0);
        const totalSetsTotal = session.entries.reduce((s, e) => s + (e.sets?.filter(x => !x.skipped && !x.warmup).length || 0), 0);
        const avgDurSec = avgStats.avgDurSec;
        const avgSetsTotal = avgStats.avgSetsTotal;
        if (!avgDurSec || !session.startedAt) return null;
        const elapsedSec = (now - new Date(session.startedAt).getTime()) / 1000;
        const remainingSets = Math.max(0, totalSetsTotal - totalSetsDone);
        const histPace = avgSetsTotal > 0 ? avgDurSec / avgSetsTotal : null;
        const currPace = totalSetsDone >= 2 ? elapsedSec / totalSetsDone : null;
        let remainingSec;
        if (!histPace || totalSetsTotal === 0) {
          remainingSec = Math.max(0, avgDurSec - elapsedSec);
        } else if (!currPace) {
          remainingSec = Math.max(0, avgDurSec - elapsedSec);
        } else {
          const w = Math.min(totalSetsDone / 8, 0.7);
          remainingSec = Math.max(0, (w * currPace + (1 - w) * histPace) * remainingSets);
        }
        const remMin = Math.round(remainingSec / 60);
        const avgDurMin = avgDurSec / 60;
        const elapsedMin = elapsedSec / 60;
        if (totalSetsDone < 2) return null;
        if (remainingSets === 0) return null;
        const diffMin = Math.round(elapsedMin + remMin - avgDurMin);
        if (Math.abs(diffMin) < 2) return null;
        const ahead = diffMin < 0;
        const pct = Math.min(Math.abs(diffMin) / 20 * 50, 50);
        return (
          <div style={{ flexShrink: 0, padding: '0 22px 8px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <span className="num" style={{ fontSize: 10, color: ahead ? 'var(--accent)' : UI.inkFaint }}>
                {ahead ? `${Math.abs(diffMin)}m ahead` : `+${diffMin}m behind`}
              </span>
            </div>
            <div style={{ position: 'relative', height: 3 }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: 999, background: UI.hairStrong }} />
              <div style={{
                position: 'absolute', top: 0, height: '100%',
                left:  ahead ? '50%' : `${50 - pct}%`,
                width: `${pct}%`,
                background: ahead ? 'var(--accent)' : UI.inkFaint,
                borderRadius: ahead ? '0 999px 999px 0' : '999px 0 0 999px',
                transition: 'left 2s linear, width 2s linear',
              }} />
              <div style={{ position: 'absolute', left: '50%', top: -1, width: 1.5, height: 5, background: UI.inkSoft, transform: 'translateX(-50%)' }} />
            </div>
          </div>
        );
      })()}

      {/* Day name + exercise position */}
      <div style={{ flexShrink: 0, padding: '6px 22px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="micro-gold">{session.dayName}</span>
        <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>
          {String(exIdx + 1).padStart(2, '0')} <span style={{ color: UI.hair }}>/</span> {String(session.entries.length).padStart(2, '0')}
        </span>
      </div>

      {/* Exercise chips */}
      <div ref={chipRowRef} style={{ flexShrink: 0, padding: '0 22px 12px', display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {session.entries.flatMap((e, i) => {
          const done = e.sets.every(s => s.done || s.skipped);
          const active = i === exIdx;
          const nextE = session.entries[i + 1];
          const linkedToNext = e.supersetGroup && e.supersetGroup === nextE?.supersetGroup;
          const chip = (
            <button key={`chip-${i}`}
              onClick={() => updateSession(sess => ({ ...sess, currentExIdx: i }))}
              style={{
                flexShrink: 0, maxWidth: 110,
                padding: '5px 11px 4px', borderRadius: 4,
                border: `1px solid ${active ? UI.gold : done ? UI.goldSoft : UI.hairStrong}`,
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
          if (linkedToNext) {
            return [chip, <span key={`ss-${i}`} style={{ flexShrink: 0, alignSelf: 'center', fontSize: 10, color: UI.goldSoft, lineHeight: 1 }}>⟷</span>];
          }
          return [chip];
        })}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Exercise name */}
        <div style={{ flexShrink: 0 }}>
          <div className="display" style={{
            fontSize: entry.name.length > 28 ? 16 : entry.name.length > 22 ? 20 : entry.name.length > 16 ? 26 : 32,
            color: UI.ink, lineHeight: 1.05, letterSpacing: '0.02em', fontWeight: 700,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {entry.name}
          </div>
          {(exercise?.category || exercise?.equipment || (exercise?.tags || []).length > 0) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {exercise?.category && <Pill gold>{exercise.category}</Pill>}
              {exercise?.equipment && <Pill>{(window.EQUIPMENT_TYPES||[]).find(t=>t.key===exercise.equipment)?.label ?? exercise.equipment}</Pill>}
              {(exercise?.tags || []).map(t => <Pill key={t}>{t}</Pill>)}
            </div>
          )}
        </div>

        {/* HERO CURRENT SET */}
        {allDone ? (
          <Frame accent style={{ padding: 28, textAlign: 'center' }}>
            <div className="micro-gold" style={{ marginBottom: 10 }}>ALL SETS</div>
            <div className="display" style={{ fontSize: 28, color: UI.gold, fontWeight: 900, marginBottom: 6 }}>Done.</div>
            <div style={{ color: UI.inkSoft, fontSize: 13 }}>Next exercise ready.</div>
            <Btn onClick={() => navigate(1)} style={{ marginTop: 18 }}>
              {exIdx === session.entries.length - 1 ? 'Finish session →' : 'Next exercise →'}
            </Btn>
          </Frame>
        ) : heroSet && (
          <BracketFrame gold padding={0}>
            <div style={{ padding: '12px 6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0 18px', marginBottom: 8 }}>
                <span className="micro-gold">
                  {(!warmupSetsRemaining && isCurrentWarmup)
                    ? `WARMUP ${String(entry.sets.slice(0,currentSetIdx+1).filter(s=>s.warmup).length).padStart(2,'0')} / ${String(warmupCount).padStart(2,'0')}`
                    : `SET ${String(entry.sets.slice(0,bgSetIdx+1).filter(s=>!s.warmup).length).padStart(2,'0')} / ${String(workingSetsArr.length).padStart(2,'0')}`
                  }
                </span>
                <div style={{ textAlign: 'right' }}>
                  {prevHeroSet && prevHeroSet.kg ? (
                    <span className="num" style={{ color: UI.inkFaint, fontSize: 10 }}>
                      LAST TIME <span style={{ color: UI.inkSoft }}>{prevHeroSet.kg}kg × {(prevHeroSet.repsL != null || prevHeroSet.repsR != null) ? `L${prevHeroSet.repsL ?? '?'}/R${prevHeroSet.repsR ?? '?'}` : prevHeroSet.reps}</span>
                    </span>
                  ) : null}
                  {progressionTarget && (
                    <div className="micro" style={{ color: UI.gold, opacity: 0.65, marginTop: 3 }}>≥{progressionTarget} reps · next weight</div>
                  )}
                </div>
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
                    onActivate={() => activateKb(bgSetIdx, 'kg')}
                    kbRaw={kbRaw}
                    isKbActive={kbField?.setIdx === bgSetIdx && kbField?.field === 'kg'}
                    onChange={kg => updateSession(sess => ({
                      ...sess,
                      entries: sess.entries.map((en, ei) => ei !== exIdx ? en : {
                        ...en,
                        sets: en.sets.map((st, si) =>
                          si === bgSetIdx ? { ...st, kg, done: false }
                          : si > bgSetIdx && !st.done && !st.warmup ? { ...st, kg }
                          : st
                        ),
                      }),
                    }))}
                  />
                  <div className="micro" style={{ marginTop: 2 }}>KILOGRAMS</div>
                </div>
                <div style={{ fontSize: 32, color: UI.hair, fontFamily: UI.fontDisplay, fontWeight: 700, alignSelf: 'flex-start', marginTop: 6 }}>×</div>
                {isUnilateral ? (
                  <div style={{ flex: 1, display: 'flex', gap: 4 }}>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <input readOnly type="text" inputMode="none"
                        autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
                        value={kbField?.setIdx === bgSetIdx && kbField?.field === 'repsL' ? kbRaw : (heroSet.repsL ?? '')}
                        placeholder="—"
                        style={{ background: 'transparent', outline: 'none', color: UI.gold, fontFamily: UI.fontNum, fontVariantNumeric: 'tabular-nums', fontSize: 44, fontWeight: 300, letterSpacing: '-0.02em', textAlign: 'center', width: '100%', padding: 0, caretColor: 'transparent', border: 'none', ...(kbField?.setIdx === bgSetIdx && kbField?.field === 'repsL' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }}
                        onPointerDown={e => { e.preventDefault(); e.stopPropagation(); activateKb(bgSetIdx, 'repsL'); }}
                      />
                      <div className="micro" style={{ marginTop: 2 }}>LEFT</div>
                    </div>
                    <div style={{ fontSize: 22, color: UI.hair, fontFamily: UI.fontDisplay, fontWeight: 200, alignSelf: 'flex-start', marginTop: 10 }}>/</div>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <input readOnly type="text" inputMode="none"
                        autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
                        value={kbField?.setIdx === bgSetIdx && kbField?.field === 'repsR' ? kbRaw : (heroSet.repsR ?? '')}
                        placeholder="—"
                        style={{ background: 'transparent', outline: 'none', color: UI.gold, fontFamily: UI.fontNum, fontVariantNumeric: 'tabular-nums', fontSize: 44, fontWeight: 300, letterSpacing: '-0.02em', textAlign: 'center', width: '100%', padding: 0, caretColor: 'transparent', border: 'none', ...(kbField?.setIdx === bgSetIdx && kbField?.field === 'repsR' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }}
                        onPointerDown={e => { e.preventDefault(); e.stopPropagation(); activateKb(bgSetIdx, 'repsR'); }}
                      />
                      <div className="micro" style={{ marginTop: 2 }}>RIGHT</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <input readOnly type="text" inputMode="none"
                      autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
                      value={kbField?.setIdx === bgSetIdx && kbField?.field === 'reps' ? kbRaw : (heroSet.reps ?? '')}
                      placeholder="—"
                      style={{ background: 'transparent', outline: 'none', color: UI.gold, fontFamily: UI.fontNum, fontVariantNumeric: 'tabular-nums', fontSize: 44, fontWeight: 300, letterSpacing: '-0.02em', textAlign: 'center', width: '100%', padding: 0, caretColor: 'transparent', border: 'none', ...(kbField?.setIdx === bgSetIdx && kbField?.field === 'reps' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }}
                      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); activateKb(bgSetIdx, 'reps'); }}
                    />
                    <div className="micro" style={{ marginTop: 2 }}>REPETITIONS</div>
                  </div>
                )}
              </div>

              {/* Big confirm button */}
              <div style={{ marginTop: 12, padding: '0 18px' }}>
                <button
                  data-complete-btn
                  onPointerDown={e => { e.stopPropagation(); }}
                  onClick={() => {
                    if (currentSetIdx < 0) return;
                    completeSet(currentSetIdx);
                  }}
                  disabled={warmupSetsRemaining || postWarmupRest || heroSet.kg == null || (!(kbField?.setIdx === bgSetIdx && kbField?.field !== 'kg') && (isUnilateral ? (!heroSet.repsL || !heroSet.repsR) : !heroSet.reps))}
                  style={{
                    width: '100%', minHeight: 44,
                    background: heroSet.kg == null || (isUnilateral ? (!heroSet.repsL || !heroSet.repsR) : !heroSet.reps) ? 'transparent' : `linear-gradient(180deg, var(--accent-light), var(--accent))`,
                    border: heroSet.kg == null || (isUnilateral ? (!heroSet.repsL || !heroSet.repsR) : !heroSet.reps) ? `1px solid ${UI.hairStrong}` : `1px solid var(--accent-deep)`,
                    color: heroSet.kg == null || (isUnilateral ? (!heroSet.repsL || !heroSet.repsR) : !heroSet.reps) ? UI.inkFaint : '#0a0805',
                    borderRadius: 6,
                    fontFamily: UI.fontUi, fontWeight: 600, fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase',
                    cursor: heroSet.kg == null || (isUnilateral ? (!heroSet.repsL || !heroSet.repsR) : !heroSet.reps) ? 'default' : 'pointer',
                    boxShadow: heroSet.kg == null || (isUnilateral ? (!heroSet.repsL || !heroSet.repsR) : !heroSet.reps) ? 'none' : '0 8px 30px rgba(var(--accent-rgb),0.30)',
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
            <span className="micro">{warmupCount > 0 && warmupActive ? 'WARMUP' : 'ALL SETS'}</span>
            <button onClick={checkAllSets} disabled={anyMissingData && !allWorkingDone} style={{
              padding: '4px 10px', borderRadius: 4,
              background: allWorkingDone ? UI.goldFaint : 'transparent',
              border: `1px solid ${allWorkingDone ? UI.goldSoft : UI.hair}`,
              color: allWorkingDone ? UI.gold : UI.inkFaint,
              fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
              fontFamily: UI.fontUi, fontWeight: 500,
              cursor: anyMissingData && !allWorkingDone ? 'default' : 'pointer',
              opacity: anyMissingData && !allWorkingDone ? 0.3 : 1,
            }}>{allWorkingDone ? '✓ All' : 'All ✓'}</button>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isUnilateral ? '28px 1fr 72px 44px 44px 28px 18px' : '28px 1fr 72px 56px 28px 18px',
            gap: 8, alignItems: 'baseline',
            padding: '0 4px 6px',
          }}>
            <div />
            <span className="micro" style={{ color: UI.inkFaint }}>Last time</span>
            <span className="micro" style={{ color: UI.inkFaint, textAlign: 'center' }}>kg</span>
            {isUnilateral ? (
              <>
                <span className="micro" style={{ color: UI.inkFaint, textAlign: 'center' }}>L</span>
                <span className="micro" style={{ color: UI.inkFaint, textAlign: 'center' }}>R</span>
              </>
            ) : (
              <span className="micro" style={{ color: UI.inkFaint, textAlign: 'center' }}>{store.settings?.smartProgression ? 'Reps (min)' : 'Reps'}</span>
            )}
            <div /><div />
          </div>
          <div className="knurl" style={{ marginBottom: 2 }} />

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {entry.sets.map((s, i) => {
              const isWarmupRow = !!s.warmup;
              // Hide warmup rows once training has started — they're done and tapping them would re-trigger the overlay
              if (isWarmupRow && !warmupActive) return null;
              // Working sets offset index by warmupCount so prev-session lookup is correct
              const prevSet = isWarmupRow ? null : (last?.entry?.sets || []).filter(s => !s.warmup)[i - warmupCount];
              const isCurrent = i === currentSetIdx;
              const showWorkingSep = !isWarmupRow && i === warmupCount && warmupCount > 0 && warmupActive;
              const warmupRowNum = isWarmupRow ? entry.sets.slice(0, i + 1).filter(x => x.warmup).length : 0;
              const workingRowNum = !isWarmupRow ? entry.sets.slice(0, i + 1).filter(x => !x.warmup).length : 0;
              return (
                <React.Fragment key={i}>
                  {showWorkingSep && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px 4px' }}>
                        <span className="micro" style={{ color: UI.inkFaint }}>WORKING SETS</span>
                      </div>
                      <div className="knurl" style={{ marginBottom: 2 }} />
                    </>
                  )}
                  <div data-kb-row={i} style={{
                    display: 'grid',
                    gridTemplateColumns: isUnilateral ? '28px 1fr 72px 44px 44px 28px 18px' : '28px 1fr 72px 56px 28px 18px',
                    gap: 8, alignItems: 'center',
                    padding: '10px 4px',
                    opacity: s.done || s.skipped ? (isWarmupRow ? 0.3 : 0.4) : 1,
                    animation: flashSet === i ? 'rowFlash 1.4s ease forwards' : 'none',
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 3, flexShrink: 0,
                      background: isCurrent ? UI.goldFaint : 'transparent',
                      outline: `1px solid ${isCurrent ? UI.gold : s.done ? UI.goldDeep : isWarmupRow ? UI.hair : UI.hairStrong}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: UI.fontNum, fontSize: isWarmupRow ? 8 : 10, fontWeight: 500,
                      color: isCurrent ? UI.gold : s.done ? UI.goldDeep : UI.inkFaint,
                    }}>{isWarmupRow ? `W${warmupRowNum}` : workingRowNum}</div>

                    <div className="num" style={{ fontSize: 11, color: UI.inkFaint }}>
                      {isWarmupRow
                        ? <span style={{ color: UI.inkGhost }}>{s.warmupPct}%</span>
                        : prevSet?.kg != null && (prevSet.reps != null || prevSet.repsL != null || prevSet.repsR != null) ? `${prevSet.kg}kg × ${(prevSet.repsL != null || prevSet.repsR != null) ? `L${prevSet.repsL ?? '?'}/R${prevSet.repsR ?? '?'}` : prevSet.reps}` : '—'
                      }
                    </div>

                    <KgInput
                      value={s.kg}
                      done={s.done || s.skipped}
                      style={setInputStyle(s.done || s.skipped, isCurrent)}
                      onActivate={() => activateKb(i, 'kg')}
                      kbRaw={kbRaw}
                      isKbActive={kbField?.setIdx === i && kbField?.field === 'kg'}
                      onChange={kg => updateSession(sess => ({
                        ...sess,
                        entries: sess.entries.map((en, ei) => ei !== exIdx ? en : {
                          ...en,
                          sets: en.sets.map((st, si) =>
                            si === i ? { ...st, kg, done: false }
                            : si > i && !st.done && !st.warmup ? { ...st, kg }
                            : st
                          ),
                        }),
                      }))}
                    />

                    {isUnilateral ? (
                      <>
                        <input readOnly type="text" inputMode="none" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={kbField?.setIdx === i && kbField?.field === 'repsL' ? kbRaw : (s.repsL ?? '')} placeholder="L" disabled={s.done || s.skipped} style={{ ...setInputStyle(s.done || s.skipped, isCurrent), caretColor: 'transparent', ...(kbField?.setIdx === i && kbField?.field === 'repsL' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); if (!s.done && !s.skipped) activateKb(i, 'repsL'); }} />
                        <input readOnly type="text" inputMode="none" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={kbField?.setIdx === i && kbField?.field === 'repsR' ? kbRaw : (s.repsR ?? '')} placeholder="R" disabled={s.done || s.skipped} style={{ ...setInputStyle(s.done || s.skipped, isCurrent), caretColor: 'transparent', ...(kbField?.setIdx === i && kbField?.field === 'repsR' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); if (!s.done && !s.skipped) activateKb(i, 'repsR'); }} />
                      </>
                    ) : (
                      <input readOnly type="text" inputMode="none" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={kbField?.setIdx === i && kbField?.field === 'reps' ? kbRaw : (s.reps ?? '')} placeholder="—" disabled={s.done || s.skipped} style={{ ...setInputStyle(s.done || s.skipped, isCurrent), caretColor: 'transparent', ...(kbField?.setIdx === i && kbField?.field === 'reps' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); if (!s.done && !s.skipped) activateKb(i, 'reps'); }} />
                    )}

                    <button
                      data-complete-btn
                      onPointerDown={e => { _log(`row${i} pointerdown done=${s.done}`); e.stopPropagation(); }}
                      onClick={() => {
                        const now = Date.now();
                        _log(`row${i} click done=${s.done} skipped=${s.skipped}`);
                        if (s.skipped) { updateSet(i, { skipped: false }); return; }
                        if (s.done) {
                          const globalDelta = now - (lastCompleteRef.current || 0);
                          const rowDelta = now - (recentCompleteRef.current[i] || 0);
                          _log(`row${i} uncheck? globalΔ=${globalDelta}ms rowΔ=${rowDelta}ms`);
                          if (globalDelta < 2000) { _log(`row${i} BLOCKED by global guard (${globalDelta}ms)`); return; }
                          if (rowDelta < 3000) { _log(`row${i} BLOCKED by row guard (${rowDelta}ms)`); return; }
                          _log(`row${i} UNCHECK → updateSet done:false`);
                          updateSet(i, { done: false });
                          return;
                        }
                        if (s.kg == null) return;
                        _log(`row${i} → completeSet`);
                        completeSet(i);
                      }}
                      disabled={!s.done && !s.skipped && (s.kg == null || (!(kbField?.setIdx === i && kbField?.field !== 'kg') && (isUnilateral ? (!s.repsL || !s.repsR) : !s.reps)))}
                      style={{
                        width: 26, height: 26, borderRadius: 3, border: `1px solid ${s.skipped ? UI.inkFaint : s.done ? UI.gold : (s.kg == null || (isUnilateral ? (!s.repsL || !s.repsR) : !s.reps)) ? UI.hair : isCurrent ? UI.goldSoft : UI.hairStrong}`, cursor: 'pointer',
                        background: s.done ? UI.gold : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: s.skipped ? 12 : 14, fontWeight: 700,
                        color: s.skipped ? UI.inkFaint : s.done ? '#0a0805' : 'transparent',
                        opacity: !s.done && !s.skipped && (s.kg == null || (isUnilateral ? (!s.repsL || !s.repsR) : !s.reps)) ? 0.35 : 1,
                        flexShrink: 0,
                        WebkitTapHighlightColor: 'transparent',
                      }}>{s.skipped ? '×' : '✓'}</button>

                    {!s.warmup && !s.done && entry.sets.length > 1 ? (
                      <button onClick={() => removeSet(i)} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: UI.danger, fontSize: 16, lineHeight: 1, padding: 0, opacity: 0.6,
                      }}>−</button>
                    ) : <span />}
                  </div>
                  {i < entry.sets.length - 1 && !(i === warmupCount - 1 && warmupCount > 0) && <div className="knurl" />}
                </React.Fragment>
              );
            })}
          </div>

          {/* Add set / swap / note */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={addSet} style={{
              width: 32, height: 32, borderRadius: 4,
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              color: UI.inkSoft, fontSize: 18, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>+</button>
            <button onClick={swapExercise} style={{
              width: 32, height: 32, borderRadius: 4,
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              color: UI.inkSoft, fontSize: 14, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>⇄</button>
            {store.settings?.tempoEnabled && (
              <button onClick={() => tempoActive ? stopTempo() : startTempo()} style={{
                borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
                background: tempoActive ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                border: `1px solid ${tempoActive ? 'var(--accent)' : UI.hairStrong}`,
                color: tempoActive ? 'var(--accent)' : UI.inkFaint,
                fontSize: 10, fontFamily: UI.fontUi, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500,
              }}>
                {tempoActive ? 'Stop' : 'Paceguard'}
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => entry.note ? setSessionNoteOpen(true) : setNotePicker(true)} style={{
              background: entry.note ? UI.goldFaint : 'transparent',
              border: `1px solid ${entry.note ? UI.goldSoft : UI.hairStrong}`,
              borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
              color: entry.note ? UI.gold : UI.inkFaint, fontSize: 10,
              fontFamily: UI.fontUi, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500,
            }}>
              {entry.note ? 'Note' : '+ Note'}
            </button>
          </div>

          {/* Session note display — tap to edit */}
          {entry.note ? (
            <button onClick={() => setSessionNoteOpen(true)} style={{
              marginTop: 10, width: '100%', textAlign: 'left',
              background: UI.goldFaint, border: `1px solid ${UI.goldSoft}`,
              borderRadius: 6, padding: '10px 12px', cursor: 'pointer',
              fontFamily: UI.fontDisplay, fontSize: 15, color: UI.gold,
              lineHeight: 1.5, whiteSpace: 'pre-wrap',
              WebkitTapHighlightColor: 'transparent',
            }}>
              {entry.note}
            </button>
          ) : null}
        </div>

        {/* Exercise note (permanent, from exercise definition) */}
        {exercise?.note && (
          <Frame style={{ padding: 14 }} onClick={() => { setExNoteVal(exercise?.note || ''); setExNoteOpen(true); }}>
            <div className="micro" style={{ marginBottom: 6 }}>NOTE · {entry.name.toUpperCase()}</div>
            <div style={{ fontFamily: UI.fontDisplay, fontSize: 16, color: UI.inkSoft, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {exercise.note}
            </div>
          </Frame>
        )}

      </div>

      {/* Footer nav */}
      <div className="knurl" />
      <div style={{
        flexShrink: 0,
        padding: `10px 22px calc(env(safe-area-inset-bottom, 8px) + 10px)`,
        display: 'flex', gap: 10,
      }}>
        <button onClick={() => navigate(-1)} disabled={exIdx === 0} style={{
          width: 56, minHeight: 50, borderRadius: 6,
          background: 'transparent', border: `1px solid ${UI.hairStrong}`,
          color: UI.inkSoft, cursor: exIdx === 0 ? 'default' : 'pointer',
          opacity: exIdx === 0 ? 0.3 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        {allDone ? (
          <Btn onClick={() => navigate(1)} style={{ flex: 1 }}>
            {exIdx === session.entries.length - 1 ? 'Finish →' : 'Next exercise →'}
          </Btn>
        ) : (<>
          <Btn onClick={skipSet} style={{ flex: 1 }}>Skip set</Btn>
          <Btn onClick={skipExercise} style={{ flex: 1 }}>Skip exercise</Btn>
          {exIdx === session.entries.length - 1 && (
            <Btn onClick={() => navigate(1)} style={{ flex: 1 }}>Finish →</Btn>
          )}
        </>)}
      </div>

      {/* finish confirmation */}
      <Sheet open={finishOpen} onClose={() => setFinishOpen(false)} title="End session?">
        <div style={{ fontSize: 14, color: UI.inkSoft, marginBottom: 18, lineHeight: 1.6 }}>
          {(() => {
            const incomplete = session.entries
              .map(e => ({ name: e.name, remaining: e.sets.filter(s => !s.done && !s.skipped).length }))
              .filter(e => e.remaining > 0);
            if (!incomplete.length) return null;
            return (
              <div style={{ background: 'rgba(var(--accent-rgb),0.08)', border: `1px solid rgba(var(--accent-rgb),0.3)`, borderRadius: 6, padding: '10px 12px', marginBottom: 14 }}>
                <div className="label" style={{ color: 'var(--accent)', marginBottom: 8 }}>Incomplete sets</div>
                {incomplete.map(e => (
                  <div key={e.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 4 }}>
                    <span style={{ color: UI.inkSoft }}>{e.name}</span>
                    <span className="num" style={{ color: 'var(--accent)' }}>{e.remaining} left</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
            <span>Sets</span>
            <span className="num" style={{ color: UI.ink }}>
              {session.entries.reduce((c, e) => c + e.sets.filter(s => s.done).length, 0)} / {session.entries.reduce((c, e) => c + e.sets.length, 0)}
            </span>
          </div>
          <div className="knurl" />
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
            <span>Volume</span>
            <span className="num" style={{ color: UI.gold }}>
              {Math.round(LB.totalVolume(session)).toLocaleString('en-US')} kg
            </span>
          </div>
          <div className="knurl" />
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
            background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6,
            padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, marginBottom: 4 }}>Session note</div>
            <div style={{ fontSize: 12, color: UI.inkSoft }}>Only for this workout — e.g. how the set felt.</div>
          </button>
          <button onClick={() => { setNotePicker(false); setExNoteVal(exercise?.note || ''); setExNoteOpen(true); }} style={{
            background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6,
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
            background: UI.bgInset, border: `1px solid ${UI.hair}`,
            borderRadius: 6, padding: 12, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14,
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
            background: UI.bgInset, border: `1px solid ${UI.hair}`,
            borderRadius: 6, padding: 12, color: UI.ink, fontFamily: UI.fontUi, fontSize: 14,
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
              background: UI.bgInset, borderRadius: 4, padding: '10px 14px', border: `1px solid ${UI.hair}`,
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
      {swapOpen && <window.Screens.ExercisePicker store={store} setStore={setStore} onClose={() => setSwapOpen(false)} onPick={doSwap} />}

      {/* rest timer modal */}
      <Sheet open={restModalOpen} onClose={() => setRestModalOpen(false)} title="Rest">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, paddingBottom: 8 }}>
          {/* big countdown */}
          <div style={{ textAlign: 'center' }}
            onClick={restRemaining === 0 ? () => { cancelPushover(); persistRestStart(null); setRestModalOpen(false); } : undefined}
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
            <button onClick={() => { cancelPushover(); persistRestStart(null); setRestModalOpen(false); }} style={{
              flex: 1, padding: '12px 0', background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              color: UI.inkSoft, borderRadius: 6, cursor: 'pointer',
              fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 500,
            }}>Skip</button>
            <button onClick={() => persistRestStart(restStart - 30000, activeRestDef)} style={{
              flex: 1, padding: '12px 0', background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              color: UI.inkSoft, borderRadius: 6, cursor: 'pointer',
              fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 500,
            }}>−30s</button>
            <button onClick={() => persistRestStart(restStart + 30000, activeRestDef)} style={{
              flex: 1, padding: '12px 0', background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              color: UI.inkSoft, borderRadius: 6, cursor: 'pointer',
              fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 500,
            }}>+30s</button>
          </div>
        </div>
      </Sheet>

      {kbField && <div style={{ height: 225 }} />}

      {/* ── Warmup overlay ──────────────────────────────────────────────────── */}
      {warmupSetsRemaining && warmupOverlaySet && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(8,6,3,0.82)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }} />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 61,
            background: 'var(--bg, #080603)',
            borderRadius: '8px 8px 0 0',
            boxShadow: `0 -1px 0 ${UI.hairStrong}, 0 -24px 60px rgba(0,0,0,0.7)`,
            padding: `18px 22px calc(env(safe-area-inset-bottom, 0px) + 24px)`,
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: UI.gold, animation: 'pulseDot 1.6s ease-in-out infinite' }} />
                <span className="num" style={{ color: UI.gold, fontSize: 14, letterSpacing: '0.16em', fontWeight: 500, animation: 'timerPulse 1.6s ease-in-out infinite' }}>WARMUP</span>
              </div>
              <button onClick={skipWarmup} style={{
                padding: '6px 14px', borderRadius: 4,
                background: 'transparent', border: `1px solid ${UI.hairStrong}`,
                color: UI.inkSoft, cursor: 'pointer',
                fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500,
              }}>Skip</button>
            </div>

            {/* BracketFrame hero */}
            <BracketFrame gold padding={0}>
              <div style={{ padding: '12px 6px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0 18px', marginBottom: 8 }}>
                  <span className="micro-gold">
                    WARMUP {String(warmupOverlayNum).padStart(2, '0')} / {String(warmupCount).padStart(2, '0')}
                  </span>
                  <span className="num" style={{ color: UI.goldSoft, fontSize: 11, letterSpacing: '0.1em' }}>
                    {warmupOverlaySet.warmupPct}% of working weight
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 14px' }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    {warmupOverlayHasKg
                      ? <div className="num" style={{ fontSize: 52, fontWeight: 300, color: UI.gold, letterSpacing: '-0.02em', lineHeight: 1 }}>{warmupOverlaySet.kg}</div>
                      : <div className="num" style={{ fontSize: 44, fontWeight: 300, color: UI.inkSoft, letterSpacing: '-0.02em', lineHeight: 1 }}>{warmupOverlaySet.warmupPct}%</div>
                    }
                    <div className="micro" style={{ marginTop: 4 }}>{warmupOverlayHasKg ? 'KILOGRAMS' : 'NO SEED WEIGHT'}</div>
                  </div>
                  <div style={{ fontSize: 28, color: UI.hair, fontFamily: UI.fontDisplay, fontWeight: 700, alignSelf: 'flex-start', marginTop: 4 }}>×</div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div className="num" style={{ fontSize: 52, fontWeight: 300, color: UI.gold, letterSpacing: '-0.02em', lineHeight: 1 }}>{warmupOverlaySet.reps}</div>
                    <div className="micro" style={{ marginTop: 4 }}>REPETITIONS</div>
                  </div>
                </div>
                <div style={{ marginTop: 14, padding: '0 18px' }}>
                  <button
                    data-complete-btn
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => completeSet(warmupOverlayGlobalIdx)}
                    style={{
                      width: '100%', minHeight: 46,
                      background: `linear-gradient(180deg, var(--accent-light), var(--accent))`,
                      border: `1px solid var(--accent-deep)`,
                      color: '#0a0805', borderRadius: 6,
                      fontFamily: UI.fontUi, fontWeight: 700, fontSize: 13, letterSpacing: '0.14em',
                      cursor: 'pointer', boxShadow: '0 8px 30px rgba(var(--accent-rgb),0.30)',
                      WebkitTapHighlightColor: 'transparent',
                    }}>✓  Check warmup set</button>
                </div>
              </div>
            </BracketFrame>

            {/* Progress W1 / W2 / W3 */}
            <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
              {warmupOverlaySets.map((ws, wi) => (
                <div key={wi} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div style={{
                    height: 3, width: '100%', borderRadius: 2,
                    background: ws.done ? UI.gold : wi === warmupOverlayNum - 1 ? UI.goldSoft : UI.hair,
                    boxShadow: wi === warmupOverlayNum - 1 ? `0 0 6px rgba(var(--accent-rgb),0.5)` : 'none',
                    transition: 'background 0.3s',
                  }} />
                  <span className="num" style={{
                    fontSize: 9, letterSpacing: '0.1em',
                    color: ws.done ? UI.gold : wi === warmupOverlayNum - 1 ? UI.goldSoft : UI.inkFaint,
                  }}>W{wi + 1} · {ws.warmupPct}%</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Post-warmup rest overlay — full-screen dramatic countdown ────────── */}
      {postWarmupRest && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 61,
          background: 'rgb(8,6,3)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '0 32px',
        }}>
          {/* Pulsing gold border ring — same as improvement overlay */}
          <div style={{ position: 'absolute', inset: 0, animation: 'improvedBorderPulse 1.4s ease-in-out infinite', pointerEvents: 'none' }} />

          {/* Label */}
          <span className="micro-gold" style={{
            letterSpacing: '0.22em', marginBottom: 24,
            animation: 'timerPulse 2s ease-in-out infinite',
          }}>WARMUP COMPLETE</span>

          {/* Exercise name */}
          <div className="display-it" style={{
            fontSize: session.entries[0]?.name.length > 22 ? 22 : 30,
            color: UI.ink, lineHeight: 1.05,
            textAlign: 'center', marginBottom: 48,
          }}>{session.entries[0]?.name}</div>

          {/* Big countdown */}
          <div className="num" style={{
            fontSize: 88, fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1,
            color: UI.gold,
            textShadow: '0 0 40px rgba(var(--accent-rgb),0.55), 0 0 80px rgba(var(--accent-rgb),0.25)',
            animation: 'timerPulse 1.6s ease-in-out infinite',
          }}>
            {restRemaining != null
              ? `${Math.floor(restRemaining / 60)}:${(restRemaining % 60).toString().padStart(2, '0')}`
              : '—'}
          </div>

          {/* Progress bar */}
          <div style={{ height: 2, background: UI.hair, borderRadius: 1, overflow: 'hidden', marginTop: 22, width: 180 }}>
            <div style={{ height: '100%', width: `${restPct}%`, background: UI.gold, transition: 'width 0.25s linear' }} />
          </div>

          {/* Start now */}
          <button onClick={startNow} style={{
            marginTop: 52,
            padding: '18px 56px',
            background: `linear-gradient(180deg, var(--accent-light), var(--accent))`,
            border: `1px solid var(--accent-deep)`,
            color: '#0a0805', borderRadius: 6,
            fontFamily: UI.fontUi, fontWeight: 700, fontSize: 13, letterSpacing: '0.14em',
            cursor: 'pointer',
            boxShadow: '0 8px 40px rgba(var(--accent-rgb),0.40)',
            animation: 'pulseGold 2.2s ease-in-out infinite',
            WebkitTapHighlightColor: 'transparent',
          }}>Start now →</button>
        </div>
      )}

      {confirmEl}

      {/* Post-dismiss shield: blocks ghost clicks that land on revealed content
          after the keyboard disappears (iOS fires a synthetic click ~300ms after
          the touch that closed the keyboard). Stays for 400ms after dismissal. */}
      {kbShield && !kbField && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 260, zIndex: 96, touchAction: 'none' }}
             onPointerDown={e => e.preventDefault()}
             onTouchStart={e => e.preventDefault()} />
      )}

      <CustomKeyboard
        visible={!!kbField}
        field={kbField?.field}
        kbRaw={kbRaw}
        onType={kbTypeChar}
        onBackspace={kbBackspace}
        onAdjust={kbAdjust}
        onConfirm={kbConfirm}
        onDismiss={() => { kbFieldRef.current = null; kbRawRef.current = ''; kbFreshRef.current = false; setKbField(null); setKbRaw(''); setKbFresh(false); armKbShield(); }}
        onPlateCalc={() => setPlateCalcOpen(true)}
      />

      <PlateCalcSheet
        open={plateCalcOpen}
        onClose={() => setPlateCalcOpen(false)}
        initialWeight={kbField?.field === 'kg'
          ? (parseFloat(kbRaw.replace(',', '.')) || null)
          : (session.entries[exIdx]?.sets[kbField?.setIdx]?.kg ?? null)}
      />

    </Screen>
  );
}

function setInputStyle(done, current) {
  return {
    background: done ? 'transparent' : current ? 'rgba(201,169,97,0.06)' : UI.bgInset,
    border: `1px solid ${done ? 'transparent' : current ? UI.goldSoft : UI.hair}`,
    borderRadius: 3, outline: 'none',
    color: done ? UI.inkSoft : UI.ink,
    fontFamily: UI.fontNum, fontSize: 15, fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    width: '100%', padding: '8px 4px', textAlign: 'center',
  };
}

Object.assign(window.Screens, { TrainingScreen });
