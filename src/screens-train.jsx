/* Training mode — Hero Set redesign. All session/persistence logic identical
   to original (Supabase sync, push-over scheduling, plan-diff prompt,
   swap-exercise sheet, rest timer, abandon flow).
*/

const { useState: useStateT, useEffect: useEffectT, useRef: useRefT, useMemo: useMemoT } = React;

const CARDIO_DIST_KEY_T = 'logbook-cardio-dist-unit';
const MI_TO_M_T = 1609.344;
function mToDisplayT(m, unit) { return m == null ? '' : unit === 'mi' ? (m / MI_TO_M_T).toFixed(2) : (m / 1000).toFixed(2); }
function distToMT(val, unit) { const n = parseFloat(val); return isNaN(n) ? null : unit === 'mi' ? Math.round(n * MI_TO_M_T) : Math.round(n * 1000); }

// ── Debug log (disabled) ──────────────────────────────────────────────────────
// NOTE: a previous debugging session monkey-patched window.fetch, window.WebSocket
// and console here. The WebSocket wrapper dropped the static WebSocket.OPEN/
// CONNECTING/… constants that Supabase Realtime reads to track socket state,
// which could drive a reconnect loop that floods and kills the renderer
// ("Render process gone"). All of that is removed; _log is now a no-op so the
// scattered _log(...) calls below stay harmless.
const _log = () => {};
window._log = _log;
// ─────────────────────────────────────────────────────────────────────────────

function KgInput({ value, onChange, done, style, onActivate, kbRaw, isKbActive }) {
  const fmt = v => v != null ? String(v).replace('.', ',') : '';
  const [raw, setRaw] = useStateT(() => fmt(value));
  const focused = useRefT(false);
  useEffectT(() => { if (!focused.current && !isKbActive) setRaw(fmt(value)); }, [value, isKbActive]);

  if (onActivate !== undefined) {
    return (
      <KbCell
        text={isKbActive ? kbRaw : fmt(value)}
        placeholder="—"
        disabled={done}
        onActivate={onActivate}
        style={{ ...style, ...(isKbActive ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }}
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

// Read-only value cell fed by the in-app keypad. Rendered as a <div>, never an
// <input>, so iOS never attaches its AutoFill / QuickType accessory bar — these
// fields take no native text entry (tapping opens the custom keyboard), so a
// native control is never needed and only invites the autofill suggestion pill.
function KbCell({ text, placeholder, style, disabled, onActivate }) {
  const empty = text == null || text === '';
  return (
    <div
      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); if (!disabled) onActivate?.(); }}
      style={{
        ...style,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        userSelect: 'none', WebkitUserSelect: 'none',
        cursor: disabled || !onActivate ? 'default' : 'pointer',
      }}
    >
      {empty ? <span style={{ color: UI.inkGhost }}>{placeholder}</span> : text}
    </div>
  );
}

// ─── Plate Calculator ────────────────────────────────────────────────
const PLATES_KG  = [25, 20, 15, 10, 5, 2.5, 1.25, 0.75, 0.5, 0.25];
const PLATES_LBS = [55, 45, 35, 25, 10, 5, 2.5, 1.25];

const PLATE_COLORS_KG  = { 25:'#c0392b', 20:'#2471a3', 15:'#d4ac0d', 10:'#1a1a1a', 5:'#1e8449', 2.5:'#ca6f1e', 1.25:'#148f77', 0.75:'#808b96', 0.5:'#808b96', 0.25:'#808b96' };
const PLATE_SIZE_KG    = { 25: 70,       20: 64,       15: 60,       10: 56,       5: 48,       2.5: 42,       1.25: 36,      0.75: 30,      0.5: 30,      0.25: 30      };

const PLATE_COLORS_LBS = { 55:'#c0392b', 45:'#2471a3', 35:'#b7950b', 25:'#1e8449', 10:'#808b96', 5:'#1a1a1a', 2.5:'#ca6f1e', 1.25:'#808b96' };
const PLATE_SIZE_LBS   = { 55: 70,       45: 64,       35: 56,       25: 48,       10: 42,       5: 36,        2.5: 30,       1.25: 28      };

function calcPlates(weight, plateSet) {
  const result = [];
  let rem = Math.round(weight * 1000) / 1000;
  for (const p of plateSet) {
    const n = Math.floor(rem / p + 1e-9);
    if (n > 0) { result.push({ p, n }); rem = Math.round((rem - p * n) * 1000) / 1000; }
  }
  return { plates: result, remainder: rem };
}

function PlateCalcSheet({ open, onClose, initialWeight, availablePlates }) {
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

  const isLbs = UI.unit() === 'lbs';
  const plateColors = isLbs ? PLATE_COLORS_LBS : PLATE_COLORS_KG;
  const plateSizes  = isLbs ? PLATE_SIZE_LBS   : PLATE_SIZE_KG;
  const plateSet = availablePlates ?? (isLbs ? PLATES_LBS : PLATES_KG);

  const target = parseFloat(raw.replace(',', '.')) || 0;
  const perSide = tab === 0 ? target / 2 : target;
  const { plates, remainder } = calcPlates(perSide, plateSet);

  // round up per-side to next achievable multiple of smallest plate
  const sides = tab === 0 ? 2 : 1;
  const correctedTotal = remainder > 0.01 ? (() => {
    const smallest = plateSet[plateSet.length - 1];
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
        <KbCell
          text={raw}
          placeholder="0"
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: UI.ink, fontFamily: UI.fontNum, fontSize: 48, fontWeight: 300,
            letterSpacing: '-0.03em', textAlign: 'center',
            width: '100%',
            paddingBottom: 8,
          }}
        />
        <span style={{
          position: 'absolute', right: 6, bottom: 14,
          fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, letterSpacing: '0.1em',
        }}>{UI.unit().toUpperCase()}</span>
      </div>
      <div className="knurl" style={{ marginBottom: 10 }} />

      {/* Per-side hint */}
      <div style={{ minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        {tab === 0 && target > 0 && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: UI.fontNum, fontSize: 20, fontWeight: 300, color: UI.gold, letterSpacing: '-0.02em' }}>{perSide}</span>
            <span style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, letterSpacing: '0.14em' }}>{UI.unit().toUpperCase()} PER SIDE</span>
          </div>
        )}
      </div>

      {/* Plate circles */}
      {target > 0 && (
        plates.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center', alignItems: 'flex-end', paddingBottom: 4 }}>
            {plates.map(({ p, n }) => {
              const size = plateSizes[p] || 32;
              const hole = Math.round(size * 0.3);
              return (
                <div key={p} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 72 }}>
                  <div style={{
                    width: size, height: size, borderRadius: '50%', flexShrink: 0,
                    background: plateColors[p] || UI.bgInset,
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
            CAN'T REACH EXACTLY — {correctionDelta} {UI.unit().toUpperCase()} MISSING
          </span>
          <button onClick={() => setRaw(String(correctedTotal).replace('.', ','))} style={{
            padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
            background: 'linear-gradient(180deg, var(--accent-light), var(--accent))',
            border: `0.5px solid var(--accent-deep)`,
            color: '#0a0805', fontFamily: UI.fontNum, fontSize: 10, letterSpacing: '0.06em',
            fontWeight: 700, boxShadow: '0 2px 8px rgba(var(--accent-rgb),0.45)',
          }}>
            +{correctionDelta} {UI.unit()}
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
        <button style={act} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onPlateCalc(); }}><i className="fa-solid fa-dumbbell" style={{ fontSize: 11 }} /></button>
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
        <button style={act} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}>⌄</button>
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

function TrainingScreenInner({ store, setStore, go, sessionId, userId, session, syncStatus, storageFull, onRetrySync }) {
  // Refresh the all-time best-e1RM aggregate once per training mount so the
  // "NEW BEST" overlay compares against an up-to-date baseline (covers
  // sessions finished on other devices since boot). Offline keeps the cached
  // map — bestE1rmForExercise also folds in locally windowed sessions.
  useEffectT(() => {
    let on = true;
    LB.refreshExerciseBests(userId).then(bests => {
      if (!on || !bests) return;
      setStore(s => {
        if (!s || JSON.stringify(s.exerciseBests || {}) === JSON.stringify(bests)) return s;
        return { ...s, exerciseBests: bests };
      });
    });
    return () => { on = false; };
  }, []);

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

  // "Last time" reference + remote best e1RM for this day type.
  // The local window covers recently trained exercises; when an exercise has
  // no local history (last logged before the boot window), fetch its recent
  // sessions from the server once. limit=20 covers both the "last session"
  // (for improve/regress) and a broad enough window for the day-specific
  // best-e1RM comparison (for NEW BEST).
  const [remoteLast, setRemoteLast] = useStateT({});
  const remoteBestE1rmRef = useRefT({}); // exId → best day-specific e1RM from server
  const localLast = entry ? LB.lastSessionForExercise(store, entry.exId, session.dayId) : null;
  useEffectT(() => {
    const exId = entry?.exId;
    if (!exId || remoteLast[exId] !== undefined) return;
    let on = true;
    LB.fetchExerciseHistory(exId, session.dayId, 20, userId)
      .then(rows => {
        if (!on) return;
        const filtered = (rows || []).filter(r => r.sessionId !== session.id);
        // best e1RM across all fetched sessions for this day type
        let best = 0;
        for (const r of filtered) {
          for (const st of (r.sets || [])) {
            if (st.warmup || st.skipped || st.kg == null) continue;
            const reps = LB.effReps(st);
            if (reps > 0) { const v = LB.e1rm(st.kg, reps); if (v > best) best = v; }
          }
        }
        remoteBestE1rmRef.current[exId] = best;
        const row = filtered[0];
        setRemoteLast(m => ({ ...m, [exId]: row ? { entry: { sets: row.sets } } : null }));
      })
      .catch(() => { if (on) setRemoteLast(m => ({ ...m, [exId]: null })); });
    return () => { on = false; };
  }, [entry?.exId]);
  const last = localLast ?? (entry ? remoteLast[entry.exId] : null) ?? null;
  const isCardio = !!entry?.isCardio;
  const isUnilateral = !isCardio && (exercise?.movement_type ?? (exercise?.unilateral ? 'unilateral' : 'bilateral')) === 'unilateral';
  const isNoWeightReps = !isCardio && !!exercise?.no_weight_reps;
  const isBodyweight = !isCardio && exercise?.equipment === 'bodyweight';
  const progressionTargetForSet = (workingSetIdx) => {
    if (!store.settings?.smartProgression) return null;
    const perSet = entry?.plannedRepsPerSet;
    const perSetVal = perSet && perSet.length > 1
      ? (perSet[workingSetIdx] ?? perSet[perSet.length - 1])
      : null;
    const base = (perSetVal ?? exercise?.progression_reps ?? entry?.plannedReps) ?? 0;
    const target = base + (store.settings?.progressionRangeTop ?? 4);
    return target > 0 ? target : null;
  };

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
    return (st.kg < prevSet.kg && rA <= rB) || (st.kg === prevSet.kg && rA < rB);
  };

  const completeSet = (setIdx, bypassOutlierCheck = false, afterSuccess = null) => {
    // Unlock AudioContext on this user gesture so the rest-timer beep works on iOS
    // even when the tempo feature is disabled (only other init path).
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    } catch (_) {}
    const isLastWarmupSet = !!entry.sets[setIdx]?.warmup &&
      !entry.sets.slice(setIdx + 1).some(s => s.warmup);
    const kb = kbFieldRef.current;
    const rawRef = kbRawRef.current;
    _log(`completeSet(${setIdx}) kb=${kb?.field ?? 'none'} raw='${rawRef}'`);

    // ── Outlier checks (reps + weight) ──────────────────────────────────────
    // Reps: implausibly low/high vs pre-filled reference.
    // Weight: increment-based (calibrated per equipment config).
    // When both are off we show a combined message.
    // Skipped during deload — loads are intentionally reduced, comparisons
    // against the pre-deload reference would always fire as "too low".
    const _isDeloadSet = store.statusMode === 'deload' || session.isDeload;
    if (!bypassOutlierCheck && !entry.sets[setIdx]?.warmup && !_isDeloadSet) {
      const wIdx = entry.sets.slice(0, setIdx + 1).filter(s => !s.warmup).length - 1;
      const prevWorkingSets = (last?.entry?.sets || []).filter(s => !s.warmup);
      const prevSet = wIdx >= 0 ? prevWorkingSets[wIdx] : undefined;
      // Mirror buildSeedSets exactly
      const suggestion = LB.progressionSuggestion(store, entry.exId, session.dayId, entry.plannedReps, entry.plannedRepsPerSet, last);
      const lastReps = prevSet ? LB.effReps(prevSet) : null;
      const refReps = suggestion
        ? (suggestion.reps ?? null)
        : lastReps != null
          ? (store.settings?.smartProgression ? lastReps + 1 : lastReps)
          : null;

      // Compute logged values (respect pending KB input)
      let loggedReps;
      if (isUnilateral) {
        const lVal = (kb?.field === 'repsL' && kb?.setIdx === setIdx)
          ? Math.max(parseInt(rawRef, 10) || 0, session.entries[exIdx]?.sets[setIdx]?.repsL || 0)
          : (session.entries[exIdx]?.sets[setIdx]?.repsL || 0);
        const rVal = (kb?.field === 'repsR' && kb?.setIdx === setIdx)
          ? Math.max(parseInt(rawRef, 10) || 0, session.entries[exIdx]?.sets[setIdx]?.repsR || 0)
          : (session.entries[exIdx]?.sets[setIdx]?.repsR || 0);
        loggedReps = (lVal > 0 && rVal > 0) ? Math.min(lVal, rVal) : (lVal || rVal);
      } else {
        loggedReps = (kb?.field === 'reps' && kb?.setIdx === setIdx)
          ? Math.max(parseInt(rawRef, 10) || 0, session.entries[exIdx]?.sets[setIdx]?.reps || 0)
          : (session.entries[exIdx]?.sets[setIdx]?.reps || 0);
      }

      let loggedKg = null;
      let refKg = null;
      let increment = 2.5;
      if (!isNoWeightReps) {
        refKg = suggestion ? (suggestion.kg ?? null) : (prevSet ? prevSet.kg : null);
        if (refKg != null && refKg > 0) {
          const catCfg = exercise?.equipment ? (store.settings?.equipmentConfig?.[exercise.equipment] ?? {}) : {};
          increment = catCfg.increment ?? 2.5;
          loggedKg = session.entries[exIdx]?.sets[setIdx]?.kg ?? null;
          if (kb?.field === 'kg' && kb?.setIdx === setIdx) {
            const num = parseFloat((rawRef || '').replace(',', '.'));
            if (!isNaN(num) && num > 0) loggedKg = num;
          }
        }
      }

      // Determine violations
      let weightBad = false, weightHigh = false;
      if (refKg != null && refKg > 0 && loggedKg != null && loggedKg > 0) {
        const tooLow  = loggedKg < refKg - increment * 5;
        const tooHigh = loggedKg > refKg * 1.5;
        if (tooLow || tooHigh) { weightBad = true; weightHigh = tooHigh; }
      }

      let repsBad = false, repsHigh = false;
      if (refReps != null && refReps >= 4 && loggedReps != null && loggedReps > 0) {
        if (loggedReps < refReps / 3) { repsBad = true; repsHigh = false; }
        else if (loggedReps > refReps * 3 || loggedReps > refReps + 10) { repsBad = true; repsHigh = true; }
      }

      if (weightBad || repsBad) {
        kbFieldRef.current = null; kbRawRef.current = ''; kbFreshRef.current = false;
        setKbField(null); setKbRaw(''); setKbFresh(false);
        if (weightBad && repsBad) {
          setOutlierConfirm({ setIdx, kind: 'both', loggedKg, loggedReps, refKg, refReps });
        } else if (weightBad) {
          setOutlierConfirm({ setIdx, kind: 'kg', logged: loggedKg, ref: refKg, high: weightHigh });
        } else {
          setOutlierConfirm({ setIdx, kind: 'reps', logged: loggedReps, ref: refReps, high: repsHigh });
        }
        return;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    kbFieldRef.current = null; kbRawRef.current = ''; kbFreshRef.current = false;
    setKbField(null); setKbRaw(''); setKbFresh(false);
    armKbShield();
    if (afterSuccess) afterSuccess();
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

    // During a deload the loads are deliberately light — suppress all
    // progression/PR/improvement/regression overlays so a planned easy week
    // never reads as a jump or a decline.
    const isDeloadSession = store.statusMode === 'deload' || session.isDeload;

    const progressionResult = (() => {
      if (isDeloadSession) return null;
      if (!store.settings?.smartProgression) return null;
      if (!updatedSets.filter(s => !s.warmup).every(s => s.done || s.skipped)) return null;
      const catCfg = exercise?.equipment ? (store.settings?.equipmentConfig?.[exercise.equipment] ?? {}) : {};
      const increment = catCfg.increment ?? null;
      if (!increment) return null;
      const range = store.settings?.progressionRangeTop ?? 4;
      const doneSets = updatedSets.filter(s => s.done && !s.skipped && !s.warmup && s.kg != null);
      if (!doneSets.length) return null;
      const allHitTop = doneSets.every((s, i) => {
        const reps = s.repsL != null ? Math.min(s.repsL ?? 0, s.repsR ?? 0) : (s.reps ?? 0);
        return reps >= (progressionTargetForSet(i) ?? 0);
      });
      if (!allHitTop) return null;
      const refKg = doneSets[0].kg;
      const newKg = Math.round((refKg + increment) * 100) / 100;
      const nextKg = catCfg.maxKg ? Math.min(newKg, catCfg.maxKg) : newKg;
      return nextKg > refKg ? { exName: entry.name, currentKg: refKg, nextKg } : null;
    })();

    // Overlay precedence (one per completed set): PROGRESSION UNLOCKED (handled
    // below) > NEW BEST > IMPROVEMENT > REGRESSION. NEW BEST fires when the set
    // beats the all-time e1RM record for this exercise — independent of smart
    // progression, max once per exercise. A first-ever set (no record yet) and
    // bodyweight sets (no kg) never count as a new best.
    if (!entry.sets[setIdx]?.warmup && !progressionResult && !isDeloadSession) {
      const completed = entry.sets[setIdx];
      const cReps = LB.effReps(completed);
      const cE1rm = (completed?.kg != null && cReps != null && cReps > 0) ? LB.e1rm(completed.kg, cReps) : 0;
      const localBest = LB.bestE1rmForExercise(store, entry.exId, session.id, session.dayId);
      const priorBest = Math.max(localBest, remoteBestE1rmRef.current[entry.exId] || 0);
      const isNewBest = cE1rm > 0 && priorBest > 0 && cE1rm > priorBest && !newBestShownRef.current[entry.exId];
      if (isNewBest) {
        newBestShownRef.current[entry.exId] = true;
        setNewBestSet(true);
        setTimeout(() => setNewBestSet(false), 2500);
      } else if (isImprovement(completed, prevSet)) {
        setImprovedSet(true);
        setTimeout(() => setImprovedSet(false), 2500);
      } else {
        const anyImprovementBefore = entry.sets.slice(0, setIdx).some((s, k) => isImprovement(s, prevWorkingSetFor(k)));
        if (!anyImprovementBefore && isDecline(completed, prevSet) && store.settings?.showRegression !== false) {
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
      const partners = session.entries.map((e, i) => ({ e, i })).filter(({ e, i }) => e.supersetGroup === group && i !== exIdx);
      const nextPartner = partners.find(({ e }) => e.sets[setIdx]?.done === false);
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

  const finishDropSet = (drops) => {
    if (!drops.length || dropSetIdx == null) return;
    const first = drops[0];
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((en, ei) => ei !== exIdx ? en : {
        ...en,
        sets: en.sets.map((st, si) => si !== dropSetIdx ? st : {
          ...st,
          kg: first.kg,
          reps: first.reps,
          done: true,
          technique: 'drop',
          drops,
        }),
      }),
    }));
    setFlashSet(dropSetIdx);
    setTimeout(() => setFlashSet(null), 1400);
    kbFieldRef.current = null; kbRawRef.current = ''; setKbField(null); setKbRaw('');
    const targetIdx = dropSetIdx;
    setDropSetIdx(null);
    // Improvement / regression / new best overlays (same logic as completeSet)
    const isDeloadSession = store.statusMode === 'deload' || session.isDeload;
    if (!entry.sets[targetIdx]?.warmup && !isDeloadSession && first.kg != null && first.reps > 0) {
      const prevWS = (last?.entry?.sets || []).filter(s => !s.warmup);
      const wIdx = entry.sets.slice(0, targetIdx + 1).filter(s => !s.warmup).length - 1;
      const prevSet = wIdx >= 0 ? prevWS[wIdx] : undefined;
      const cE1rm = LB.e1rm(first.kg, first.reps);
      const localBest = LB.bestE1rmForExercise(store, entry.exId, session.id, session.dayId);
      const priorBest = Math.max(localBest, remoteBestE1rmRef.current[entry.exId] || 0);
      const isNewBest = cE1rm > 0 && priorBest > 0 && cE1rm > priorBest && !newBestShownRef.current[entry.exId];
      if (isNewBest) {
        newBestShownRef.current[entry.exId] = true;
        setNewBestSet(true); setTimeout(() => setNewBestSet(false), 2500);
      } else if (isImprovement(first, prevSet)) {
        setImprovedSet(true); setTimeout(() => setImprovedSet(false), 2500);
      } else {
        const anyImpBefore = entry.sets.slice(0, targetIdx).some((s, k) => {
          if (s.warmup) return false;
          const wk = entry.sets.slice(0, k + 1).filter(x => !x.warmup).length - 1;
          return isImprovement(s, wk >= 0 ? prevWS[wk] : undefined);
        });
        if (!anyImpBefore && isDecline(first, prevSet) && store.settings?.showRegression !== false) {
          setRegressionSet(true); setTimeout(() => setRegressionSet(false), 2500);
        }
      }
    }
    // Rest timer + navigation
    const updatedSets = entry.sets.map((st, k) => k === targetIdx ? { ...st, done: true } : st);
    if (!entry.sets[targetIdx]?.warmup) persistRestStart(Date.now(), restDef);
    if (updatedSets.every(st => st.done)) setTimeout(() => navigate(1), 600);
  };

  const cancelMyo = () => {
    setMyoSetIdx(null); setMyoDrops([]); setMyoTechnique(null); setMyoTarget(null);
    kbFieldRef.current = null; kbRawRef.current = ''; kbFreshRef.current = false;
    setKbField(null); setKbRaw(''); setKbFresh(false);
  };

  const finishMyoSet = (drops, technique) => {
    if (!drops.length || myoSetIdx == null) return;
    const first = drops[0];
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((en, ei) => ei !== exIdx ? en : {
        ...en,
        sets: en.sets.map((st, si) => si !== myoSetIdx ? st : {
          ...st,
          kg: first.kg,
          reps: first.reps,
          done: true,
          technique,
          drops,
        }),
      }),
    }));
    setFlashSet(myoSetIdx);
    setTimeout(() => setFlashSet(null), 1400);
    kbFieldRef.current = null; kbRawRef.current = ''; setKbField(null); setKbRaw('');
    const targetIdx = myoSetIdx;
    setMyoSetIdx(null); setMyoTechnique(null); setMyoDrops([]); setMyoTarget(null);
    // Improvement / regression / new best overlays
    const isDeloadSession = store.statusMode === 'deload' || session.isDeload;
    if (!entry.sets[targetIdx]?.warmup && !isDeloadSession && first.kg != null && first.reps > 0) {
      const prevWS = (last?.entry?.sets || []).filter(s => !s.warmup);
      const wIdx = entry.sets.slice(0, targetIdx + 1).filter(s => !s.warmup).length - 1;
      const prevSet = wIdx >= 0 ? prevWS[wIdx] : undefined;
      const cE1rm = LB.e1rm(first.kg, first.reps);
      const localBest = LB.bestE1rmForExercise(store, entry.exId, session.id, session.dayId);
      const priorBest = Math.max(localBest, remoteBestE1rmRef.current[entry.exId] || 0);
      const isNewBest = cE1rm > 0 && priorBest > 0 && cE1rm > priorBest && !newBestShownRef.current[entry.exId];
      if (isNewBest) {
        newBestShownRef.current[entry.exId] = true;
        setNewBestSet(true); setTimeout(() => setNewBestSet(false), 2500);
      } else if (isImprovement(first, prevSet)) {
        setImprovedSet(true); setTimeout(() => setImprovedSet(false), 2500);
      } else {
        const anyImpBefore = entry.sets.slice(0, targetIdx).some((s, k) => {
          if (s.warmup) return false;
          const wk = entry.sets.slice(0, k + 1).filter(x => !x.warmup).length - 1;
          return isImprovement(s, wk >= 0 ? prevWS[wk] : undefined);
        });
        if (!anyImpBefore && isDecline(first, prevSet) && store.settings?.showRegression !== false) {
          setRegressionSet(true); setTimeout(() => setRegressionSet(false), 2500);
        }
      }
    }
    if (!entry.sets[targetIdx]?.warmup) persistRestStart(Date.now(), restDef);
    const updatedSets = entry.sets.map((st, k) => k === targetIdx ? { ...st, done: true } : st);
    if (updatedSets.every(st => st.done)) setTimeout(() => navigate(1), 600);
  };

  const addSet = () => {
    const bwKg = exercise?.equipment === 'bodyweight' ? LB.latestBodyweight(store) : null;
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => {
        if (i !== exIdx) return e;
        const last = e.sets[e.sets.length - 1];
        const newSet = isUnilateral
          ? { kg: last?.kg ?? bwKg ?? null, repsL: last?.repsL ?? null, repsR: last?.repsR ?? null, done: false }
          : { kg: last?.kg ?? bwKg ?? null, reps: last?.reps ?? null, done: false };
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

  const removeLastSet = async () => {
    const workingSets = entry.sets.map((s, i) => ({ s, i })).filter(({ s }) => !s.warmup);
    if (workingSets.length <= 1) return;
    const last = workingSets[workingSets.length - 1];
    if (!await confirm(`Remove set ${workingSets.length}?`, { ok: 'Remove', danger: true })) return;
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx
        ? { ...e, sets: e.sets.filter((_, k) => k !== last.i) }
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

  const jumpToNextSet = (completedIdx) => {
    const nextIdx = entry.sets.findIndex((s, i) => i > completedIdx && !s.done && !s.skipped);
    if (nextIdx !== -1) {
      const field = isNoWeightReps ? (isUnilateral ? 'repsL' : 'reps') : 'kg';
      setTimeout(() => activateKb(nextIdx, field), 400);
    } else {
      const nextEntry = session.entries[exIdx + 1];
      if (nextEntry && !nextEntry.isCardio) {
        const nextSetIdx = nextEntry.sets.findIndex(s => !s.done && !s.skipped);
        if (nextSetIdx !== -1) {
          const nextEx = store.exercises?.find(e => e.id === nextEntry.exId);
          const nextIsNoWeight = !!nextEx?.no_weight_reps;
          const nextIsUni = (nextEx?.movement_type ?? (nextEx?.unilateral ? 'unilateral' : 'bilateral')) === 'unilateral';
          pendingFocusRef.current = { setIdx: nextSetIdx, field: nextIsNoWeight ? (nextIsUni ? 'repsL' : 'reps') : 'kg' };
        }
      }
    }
  };

  const checkSet = () => {
    const idx = entry.sets.findIndex(s => !s.done && !s.skipped);
    if (idx < 0) return;
    if (dropSetIdx === idx) { finishDropSet(dropDropsRef.current); return; }
    if (myoSetIdx === idx) { finishMyoSet(myoDropsRef.current, myoTechnique); return; }
    completeSet(idx, false, () => jumpToNextSet(idx));
  };

  const logCardio = () => {
    const dur = parseInt(cardioForm.duration, 10);
    if (!dur || dur <= 0) return;
    const distM = cardioForm.distance ? distToMT(cardioForm.distance, cardioForm.distUnit) : null;
    const data = { type: cardioForm.type.trim() || null, durationMinutes: dur, distanceM: distM, paceFeeling: cardioForm.paceFeeling, effort: cardioForm.effort };
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx ? { ...e, cardioDone: true, cardioData: data } : e),
    }));
    setTimeout(() => navigate(1), 300);
  };

  const skipCardio = () => {
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx ? { ...e, cardioDone: true, cardioData: null } : e),
    }));
    navigate(1);
  };

  const skipExercise = () => {
    if (isCardio) { skipCardio(); return; }
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

  const finish = (feel = null) => {
    cancelPushover();
    const sessionDate = session.date.slice(0, 10);
    const newCardioLogs = session.entries
      .filter(e => e.isCardio && e.cardioDone && e.cardioData)
      .map(e => ({ id: LB.uid(), date: sessionDate, type: e.cardioData.type || e.name, durationMinutes: e.cardioData.durationMinutes, distanceM: e.cardioData.distanceM ?? null, paceFeeling: e.cardioData.paceFeeling ?? null, effort: e.cardioData.effort ?? null, note: null, sessionId: session.id }));
    updateSession(sess => {
      const now = new Date();
      const mins = sess.startedAt ? Math.round((now - new Date(sess.startedAt)) / 60000) : null;
      // Seal non-warmup sets that have values as done — guards against a sync
      // race where kbApply (done:false) lands in Supabase after completeSet
      // (done:true). Only seal exercises where at least one set is done; if no
      // set was ever confirmed the exercise was skipped/not started.
      const entries = sess.entries.map(e => {
        const hasDone = e.sets.some(st => st.done);
        return {
          ...e,
          sets: e.sets.map(st => {
            if (st.done || st.warmup || st.skipped) return st;
            if (!hasDone) return { ...st, skipped: true };
            const hasValue = st.kg != null || st.reps != null || st.repsL != null || st.repsR != null;
            return hasValue ? { ...st, done: true } : st;
          }),
        };
      });
      return { ...sess, entries, ended: now.toISOString(), ...(mins != null && { durationMinutes: mins }), ...(feel != null && { feel }), ...(store.statusMode === 'deload' ? { isDeload: true } : {}), ...(session.isFreestyle && freestyleName.trim() && { dayName: freestyleName.trim() }), ...(session.isBonus && advanceCycle && { isBonus: false }) };
    });
    const shouldAdvance = session.isBonus ? advanceCycle : true;
    setStore(s => {
      // Compute from fresh state `s` to avoid stale-closure reads off the outer `store`.
      // For freestyle sessions scheduleId is null so isWeekdayMode is always false —
      // check the active plan too so weekday-mode users don't get a stale cycleIndex bump.
      const activeSch = LB.todaysDay(s)?.schedule;
      const activeIsWeekday = LB.isWeekdayPlan(activeSch);
      // On a flex plan cycleIndex IS the live position, so it only advances when
      // the finished session is the current next-up day. A freestyle workout, a
      // session from another plan, or a catch-up of an earlier (skipped) rotation
      // day must leave the next-up pointer where it is.
      // Exception: if the user explicitly chose "continue from picked day", we honour
      // that intent and let the cycleIndex jump even on a flex plan.
      const flexBlocks = LB.isFlexPlan(activeSch) && !cycleFromPickedDay &&
        (session.isFreestyle || session.scheduleId !== activeSch?.id || session.dayId !== LB.todaysDay(s)?.day?.id);
      // If user chose "continue from picked day", jump cycle to that day's index + 1.
      const pickedSch = s.schedules?.find(sch2 => sch2.id === session.scheduleId);
      // Look up the day in the *current version's* days, not the original base array —
      // after a prior rotation the original order no longer matches baseDays.
      const pickedBaseDays = (() => {
        if (!cycleFromPickedDay || !pickedSch) return null;
        if (!LB.isFlexPlan(activeSch) && pickedSch.versions?.length)
          return LB.getPlanDaysForDate(pickedSch, LB.todayISO());
        return pickedSch.days;
      })();
      const pickedDayIdx = cycleFromPickedDay ? (pickedBaseDays?.findIndex(d => d.id === session.dayId) ?? -1) : -1;
      // For date-driven plans: insert a schedule version starting today with days rotated
      // so pickedDayIdx is position 0 → today = picked day, tomorrow = day after, no gaps.
      // Flex plans use cycleIndex directly, so skip version logic there.
      let schedulesUpdate = s.schedules;
      if (pickedDayIdx >= 0 && !LB.isFlexPlan(activeSch)) {
        const curSch = s.schedules.find(sch2 => sch2.id === session.scheduleId);
        if (curSch) {
          const todayStr = LB.todayISO();
          const baseDays = pickedBaseDays ?? (curSch.versions?.length
            ? LB.getPlanDaysForDate(curSch, todayStr)
            : curSch.days);
          const rotated = [...baseDays.slice(pickedDayIdx), ...baseDays.slice(0, pickedDayIdx)];
          let newVersions;
          if (curSch.versions?.length) {
            newVersions = LB.dedupeVersionsByDate([{ validFrom: todayStr, days: rotated }, ...curSch.versions]);
          } else {
            // Anchor history so past dates stay on the original day order.
            const genesis = s.cycleStartDate || todayStr;
            newVersions = LB.dedupeVersionsByDate([
              { validFrom: todayStr, days: rotated },
              { validFrom: genesis, days: curSch.days },
            ]);
          }
          schedulesUpdate = s.schedules.map(sch2 => sch2.id === curSch.id ? { ...sch2, versions: newVersions } : sch2);
        }
      }
      return {
        ...s,
        schedules: schedulesUpdate,
        inProgress: null,
        ...(shouldAdvance && !isWeekdayMode && !activeIsWeekday && !flexBlocks && {
          cycleIndex: pickedDayIdx >= 0 ? pickedDayIdx + 1 : s.cycleIndex + 1,
        }),
        lastAdvancedDate: LB.todayISO(),
        ...(newCardioLogs.length ? { cardioLogs: [...(s.cardioLogs || []), ...newCardioLogs] } : {}),
      };
    });
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
    const chip = row.querySelector(`[data-reorder-item]:nth-child(${exIdx + 1})`);
    if (!chip) return;
    const target = chip.offsetLeft - row.offsetWidth / 2 + chip.offsetWidth / 2;
    row.scrollLeft = target;
  }, [exIdx]);

  // chip drag-to-reorder — uses the shared horizontal drag hook from ui.jsx
  const chipDragReorderRef = UI.useDragReorderH({ longPressMs: 600,
    onReorder: (from, to) => {
      updateSession(sess => {
        const entries = [...sess.entries];
        const [moved] = entries.splice(from, 1);
        entries.splice(to, 0, moved);
        let idx = sess.currentExIdx || 0;
        if (idx === from) idx = to;
        else if (from < to && idx > from && idx <= to) idx--;
        else if (from > to && idx >= to && idx < from) idx++;
        return { ...sess, entries, currentExIdx: idx };
      });
    },
  });
  const chipRowSetRef = React.useCallback(node => {
    chipRowRef.current = node;
    chipDragReorderRef(node);
  }, [chipDragReorderRef]);

  // rest timer — persisted in session so navigation doesn't kill it
  const [restStart, setRestStart] = useStateT(() => session.restStart ?? null);
  const [restDuration, setRestDuration] = useStateT(() => session.restDuration ?? null);

  const persistRestStart = (val, dur) => {
    setRestStart(val);
    const newDur = val !== null ? (dur ?? null) : null;
    setRestDuration(newDur);
    updateSession(sess => ({ ...sess, restStart: val, restDuration: newDur }));
    if (val !== null) {
      if (store.settings?.pushEnabled) {
        const def = newDur ?? restDef;
        const delaySeconds = Math.round(Math.max(0, val + def * 1000 - Date.now()) / 1000);
        const nonce = String(val);
        if (store.settings?.pushoverUserKey && store.settings?.usePushover) {
          LB.fnFetch(LB.PUSHOVER_URL, { delaySeconds, nonce, priority: 1 });
        } else {
          LB.fnFetch(LB.WEB_PUSH_URL, { delaySeconds, nonce, title: 'Zane · Rest done', message: 'Time to start your next set! 💪' });
        }
      }
    } else {
      cancelPushover();
    }
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
  const [newBestSet, setNewBestSet] = useStateT(false);
  const newBestShownRef = useRefT({}); // exId → true once a NEW BEST flashed (max once per exercise per session)
  const [progressionUnlocked, setProgressionUnlocked] = useStateT(null);
  const [screenFlash, setScreenFlash] = useStateT(false);
  const [restModalOpen, setRestModalOpen] = useStateT(() => {
    const rs = session.restStart ?? null;
    const rd = session.restDuration ?? null;
    return !!(rs && rd && Date.now() >= rs + rd * 1000);
  });
  const [confirmEl, confirm] = useConfirm();
  const [finishOpen, setFinishOpen] = useStateT(false);
  const [finishStep, setFinishStep] = useStateT('confirm');
  const [pendingFeel, setPendingFeel] = useStateT(null);
  const [freestyleName, setFreestyleName] = useStateT('');
  const [showCycleStep, setShowCycleStep] = useStateT(false);
  const [advanceCycle, setAdvanceCycle] = useStateT(false);
  const [cycleFromPickedDay, setCycleFromPickedDay] = useStateT(false);
  const [intensityOpen, setIntensityOpen] = useStateT(false);
  const [dropSetIdx, setDropSetIdx] = useStateT(null);
  const [dropDrops, setDropDrops] = useStateT([]);
  const dropDropsRef = useRefT([]);
  dropDropsRef.current = dropDrops;
  const [myoSetIdx, setMyoSetIdx] = useStateT(null);
  const [myoTechnique, setMyoTechnique] = useStateT(null);
  const [myoDrops, setMyoDrops] = useStateT([]);
  const myoDropsRef = useRefT([]);
  myoDropsRef.current = myoDrops;
  const [myoTarget, setMyoTarget] = useStateT(null);
  // Persist intensity state so a background/resume on iOS doesn't wipe mid-set progress
  useEffectT(() => {
    if (dropSetIdx != null || myoSetIdx != null) {
      try {
        localStorage.setItem('logbook-intensity-state', JSON.stringify({
          sessionId, exIdx,
          dropSetIdx, dropDrops,
          myoSetIdx, myoDrops, myoTechnique, myoTarget,
        }));
      } catch {}
    } else {
      localStorage.removeItem('logbook-intensity-state');
    }
  }, [dropSetIdx, dropDrops, myoSetIdx, myoDrops, myoTechnique, myoTarget, sessionId, exIdx]);
  useEffectT(() => {
    try {
      const raw = localStorage.getItem('logbook-intensity-state');
      if (!raw) return;
      const st = JSON.parse(raw);
      if (st.sessionId !== sessionId || st.exIdx !== exIdx) return;
      const targetEntry = session?.entries[exIdx];
      if (st.dropSetIdx != null && !targetEntry?.sets[st.dropSetIdx]?.done) {
        setDropSetIdx(st.dropSetIdx);
        const dd = st.dropDrops || [];
        setDropDrops(dd); dropDropsRef.current = dd;
      }
      if (st.myoSetIdx != null && !targetEntry?.sets[st.myoSetIdx]?.done) {
        setMyoSetIdx(st.myoSetIdx);
        const md = st.myoDrops || [];
        setMyoDrops(md); myoDropsRef.current = md;
        setMyoTechnique(st.myoTechnique || null);
        setMyoTarget(st.myoTarget ?? null);
      }
    } catch {}
  }, [sessionId, exIdx]);
  const [notePicker, setNotePicker] = useStateT(false);
  const [sessionNoteOpen, setSessionNoteOpen] = useStateT(false);
  const [exNoteOpen, setExNoteOpen] = useStateT(false);
  const [exNoteVal, setExNoteVal] = useStateT('');
  const [planDiffOpen, setPlanDiffOpen] = useStateT(false);
  const [planDiff, setPlanDiff] = useStateT([]);
  const [swapOpen, setSwapOpen] = useStateT(false);
  const [addOpen, setAddOpen] = useStateT(() => !!(session.isFreestyle && session.entries.length === 0));
  const [addSupersetData, setAddSupersetData] = useStateT(null); // { newIdx } | null
  const [avgStats, setAvgStats] = useStateT(null);
  const [tempoActive, setTempoActive] = useStateT(false);
  const [outlierConfirm, setOutlierConfirm] = useStateT(null);
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
  const [cardioForm, setCardioForm] = useStateT({ type: '', duration: '', distance: '', paceFeeling: null, effort: null, distUnit: localStorage.getItem(CARDIO_DIST_KEY_T) || 'km' });
  const cardioTypeChips = useMemoT(() => {
    const seen = new Set(); const result = [];
    for (const l of (store.cardioLogs || [])) {
      if (l.type && !seen.has(l.type)) { seen.add(l.type); result.push(l.type); }
      if (result.length >= 6) break;
    }
    return result;
  }, [store.cardioLogs]);
  const pendingNavRef = useRefT(false);
  const pendingFocusRef = useRefT(null);
  // Records when a set was last completed via the checkbox; used to ignore
  // iOS ghost-clicks that fire 200-400ms after completion and would otherwise
  // re-enter the onClick handler with s.done=true and undo the completion.
  const recentCompleteRef = useRefT({});
  // Global timestamp of the most-recent completion across all sets — catches
  // ghost-clicks that land on a *different* row than the one just completed
  // (e.g. the keyboard ✓ is over an older row at the time iOS fires the ghost).
  const lastCompleteRef = useRefT(0);

  useEffectT(() => { kbFieldRef.current = null; kbRawRef.current = ''; kbFreshRef.current = false; setKbField(null); setKbRaw(''); setKbFresh(false); }, [exIdx, sessionId]);
  useEffectT(() => {
    const pf = pendingFocusRef.current;
    if (!pf) return;
    pendingFocusRef.current = null;
    setTimeout(() => activateKb(pf.setIdx, pf.field), 150);
  }, [exIdx]);
  useEffectT(() => {
    if (!entry?.isCardio) return;
    const du = localStorage.getItem(CARDIO_DIST_KEY_T) || 'km';
    const cd = entry.cardioData;
    setCardioForm(cd ? { type: cd.type || '', duration: cd.durationMinutes ? String(cd.durationMinutes) : '', distance: cd.distanceM != null ? mToDisplayT(cd.distanceM, du) : '', paceFeeling: cd.paceFeeling ?? null, effort: cd.effort ?? null, distUnit: du } : { type: '', duration: '', distance: '', paceFeeling: null, effort: null, distUnit: du });
  }, [exIdx, sessionId]);
  useEffectT(() => () => stopTempo(), []);

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
    (async () => {
      const { data: prevSessions } = await LB.supabase
        .from('zane_sessions')
        .select('id, started_at, ended, duration_minutes')
        .eq('user_id', userId)
        .eq('day_id', session.dayId)
        .not('ended', 'is', null)
        .neq('id', session.id)
        .order('ended', { ascending: false })
        .limit(5);
      if (!prevSessions?.length) return;

      const valid = prevSessions.filter(s => {
        const dur = s.duration_minutes != null
          ? s.duration_minutes * 60
          : (s.started_at ? (new Date(s.ended) - new Date(s.started_at)) / 1000 : null);
        return dur != null && dur > 0;
      });
      const avgDurSec = valid.length
        ? valid.reduce((sum, s) => {
            const sec = s.duration_minutes != null
              ? s.duration_minutes * 60
              : (new Date(s.ended) - new Date(s.started_at)) / 1000;
            return sum + sec;
          }, 0) / valid.length
        : null;

      // Build positional timeline from the most recent session that has started_at
      const lastSess = prevSessions.find(s => s.started_at);
      let timeline = null;
      if (lastSess) {
        const { data: entries } = await LB.supabase
          .from('zane_session_entries')
          .select('entry_idx, sets:zane_sets(set_idx, updated_at, done, warmup, skipped)')
          .eq('session_id', lastSess.id)
          .order('entry_idx');
        if (entries?.length) {
          const t0 = new Date(lastSess.started_at).getTime();
          timeline = entries
            .flatMap(e => (e.sets || [])
              .filter(s => s.done && !s.warmup && !s.skipped)
              .sort((a, b) => a.set_idx - b.set_idx)
              .map(s => (new Date(s.updated_at).getTime() - t0) / 1000)
            )
            .filter(t => t > 0);
          // Repair bulk-entry gaps: any gap < 45s between consecutive set completions
          // indicates the set was logged retroactively rather than in real time.
          // Replace those gaps with restDefault + 60s so the pace bar stays meaningful.
          if (timeline.length > 1) {
            const syntheticGap = (store.settings?.restDefault || 120) + 60;
            const gaps = timeline.map((t, i) => i === 0 ? t : t - timeline[i - 1]);
            const repaired = gaps.map(g => g < 45 ? syntheticGap : g);
            timeline = repaired.reduce((acc, g, i) => { acc.push(i === 0 ? g : acc[i - 1] + g); return acc; }, []);
          }
          if (!timeline.length) timeline = null;
        }
      }

      setAvgStats({ avgDurSec, timeline });
    })();
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

  const activateDropKb = (dropIdx, field) => {
    const d = dropDropsRef.current[dropIdx];
    const val = field === 'kg'
      ? (d?.kg != null ? String(d.kg).replace('.', ',') : '')
      : (d?.reps != null ? String(d.reps) : '');
    kbFieldRef.current = { setIdx: 'drop', dropIdx, field };
    kbRawRef.current = val;
    kbFreshRef.current = true;
    setKbField({ setIdx: 'drop', dropIdx, field });
    setKbRaw(val);
    setKbFresh(true);
    setTimeout(() => {
      const el = document.querySelector('[data-drop-actions]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  };

  const activateMyo = (dropIdx, field) => {
    const d = myoDropsRef.current[dropIdx];
    const val = field === 'kg'
      ? (d?.kg != null ? String(d.kg).replace('.', ',') : '')
      : (d?.reps != null ? String(d.reps) : '');
    kbFieldRef.current = { setIdx: 'myo', dropIdx, field };
    kbRawRef.current = val;
    kbFreshRef.current = true;
    setKbField({ setIdx: 'myo', dropIdx, field });
    setKbRaw(val);
    setKbFresh(true);
    setTimeout(() => {
      const el = document.querySelector('[data-myo-actions]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  };

  const kbApply = (newRaw, field, setIdx) => {
    if (setIdx === 'drop') {
      const dropIdx = kbFieldRef.current?.dropIdx;
      if (typeof dropIdx !== 'number') return;
      if (field === 'kg') {
        const num = newRaw === '' ? null : parseFloat(newRaw.replace(',', '.'));
        if (newRaw === '' || !isNaN(num)) setDropDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, kg: num ?? null } : d));
      } else {
        const num = newRaw === '' ? null : parseInt(newRaw, 10);
        if (newRaw === '' || !isNaN(num)) setDropDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, reps: num ?? null } : d));
      }
      return;
    }
    if (setIdx === 'myo') {
      const dropIdx = kbFieldRef.current?.dropIdx;
      if (typeof dropIdx !== 'number') return;
      if (field === 'kg') {
        const num = newRaw === '' ? null : parseFloat(newRaw.replace(',', '.'));
        if (newRaw === '' || !isNaN(num)) setMyoDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, kg: num ?? null } : d));
      } else {
        const num = newRaw === '' ? null : parseInt(newRaw, 10);
        if (newRaw === '' || !isNaN(num)) setMyoDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, reps: num ?? null } : d));
      }
      return;
    }
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
              : store.settings?.weightFillDown !== false && si > setIdx && !st.done ? { ...st, kg: num ?? null }
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
    if (setIdx === 'drop') {
      const { dropIdx } = kbFieldRef.current;
      if (field === 'kg') {
        const cur = parseFloat(kbRawRef.current.replace(',', '.')) || 0;
        const step = (exercise?.equipment && store.settings?.equipmentConfig?.[exercise.equipment]?.increment) || 1.25;
        const next = Math.max(0, Math.round((cur + dir * step) * 100) / 100);
        const newRaw = String(next).replace('.', ',');
        kbRawRef.current = newRaw;
        setKbRaw(newRaw);
        setDropDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, kg: next } : d));
      } else {
        const cur = parseInt(kbRawRef.current, 10) || 0;
        const next = Math.max(0, cur + dir);
        kbRawRef.current = String(next);
        setKbRaw(String(next));
        setDropDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, reps: next } : d));
      }
      return;
    }
    if (setIdx === 'myo') {
      const { dropIdx } = kbFieldRef.current;
      if (field === 'kg') {
        const cur = parseFloat(kbRawRef.current.replace(',', '.')) || 0;
        const step = (exercise?.equipment && store.settings?.equipmentConfig?.[exercise.equipment]?.increment) || 1.25;
        const next = Math.max(0, Math.round((cur + dir * step) * 100) / 100);
        const newRaw = String(next).replace('.', ',');
        kbRawRef.current = newRaw;
        setKbRaw(newRaw);
        setMyoDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, kg: next } : d));
      } else {
        const cur = parseInt(kbRawRef.current, 10) || 0;
        const next = Math.max(0, cur + dir);
        kbRawRef.current = String(next);
        setKbRaw(String(next));
        setMyoDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, reps: next } : d));
      }
      return;
    }
    if (field === 'kg') {
      const cur = parseFloat(kbRawRef.current.replace(',', '.')) || 0;
      const step = (exercise?.equipment && store.settings?.equipmentConfig?.[exercise.equipment]?.increment) || 1.25;
      const next = Math.max(0, Math.round((cur + dir * step) * 100) / 100);
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
    if (setIdx === 'drop') {
      const { dropIdx } = kbFieldRef.current;
      kbApply(kbRawRef.current, field, setIdx);
      if (field === 'kg') {
        activateDropKb(dropIdx, 'reps');
      } else {
        const drops = dropDropsRef.current;
        if (dropIdx + 1 < drops.length) {
          setTimeout(() => activateDropKb(dropIdx + 1, 'kg'), 50);
        } else {
          kbFieldRef.current = null; kbRawRef.current = ''; kbFreshRef.current = false;
          setKbField(null); setKbRaw(''); setKbFresh(false);
          armKbShield();
        }
      }
      return;
    }
    if (setIdx === 'myo') {
      const { dropIdx } = kbFieldRef.current;
      kbApply(kbRawRef.current, field, setIdx);
      if (field === 'kg') {
        activateMyo(dropIdx, 'reps');
      } else {
        if (dropIdx === 0) {
          // Activation reps confirmed → auto-add first mini
          const activKg = myoDropsRef.current[0]?.kg ?? null;
          const newIdx = myoDropsRef.current.length;
          setMyoDrops(prev => [...prev, { kg: activKg, reps: null }]);
          setTimeout(() => activateMyo(newIdx, 'reps'), 80);
        } else {
          kbFieldRef.current = null; kbRawRef.current = ''; kbFreshRef.current = false;
          setKbField(null); setKbRaw(''); setKbFresh(false);
          armKbShield();
        }
      }
      return;
    }
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
      if (dropSetIdx === setIdx || myoSetIdx === setIdx) return;
      completeSet(setIdx);
      const nextIdx = entry.sets.findIndex((s, i) => i > setIdx && !s.done);
      if (nextIdx !== -1) setTimeout(() => activateKb(nextIdx, isUnilateral ? 'repsL' : 'reps'), 350);
    }
  };

  const saveExNote = () => {
    setStore(s => ({ ...s, exercises: s.exercises.map(e => e.id === entry.exId ? { ...e, note: exNoteVal.trim() } : e) }));
    setExNoteOpen(false);
  };
  const requestCloseExNote = async () => {
    const dirty = exNoteVal !== (exercise?.note || '');
    if (dirty && !await confirm('Your exercise note won\'t be saved.', { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    setExNoteOpen(false);
  };

  const swapExercise = async () => {
    if (!await confirm(`Swap "${entry.name}"?`, { ok: 'Swap' })) return;
    setSwapOpen(true);
  };

  const doSwap = (ids) => {
    const newExId = Array.isArray(ids) ? ids[0] : ids;
    // resolve the name from fresh state — a just-created exercise isn't in the
    // closed-over `store` yet (its setStore hasn't re-rendered the screen)
    setStore(s => {
      const newEx = LB.findExercise(s, newExId);
      const isNewCardio = newEx?.movement_type === 'cardio';
      return {
        ...s,
        sessions: s.sessions.map(x => x.id !== session.id ? x : {
          ...x,
          entries: x.entries.map((e, i) => {
            if (i !== exIdx) return e;
            if (isNewCardio) {
              return { ...e, exId: newExId, name: newEx?.name || e.name, isCardio: true, plannedSets: 0, sets: [], cardioDone: false, cardioData: null };
            }
            return { ...e, exId: newExId, name: newEx?.name || e.name };
          }),
        }),
      };
    });
    setSwapOpen(false);
  };

  const doAdd = (ids) => {
    const newExId = Array.isArray(ids) ? ids[0] : ids;
    setAddOpen(false);
    if (session.entries.length === 0) {
      // First exercise in an empty session — skip the superset prompt and insert directly.
      setStore(s => {
        const sess = s.sessions.find(x => x.id === session.id);
        if (!sess) return s;
        const newEx = LB.findExercise(s, newExId);
        const isNewCardio = newEx?.movement_type === 'cardio';
        let newEntry;
        if (isNewCardio) {
          newEntry = { exId: newExId, name: newEx?.name || newExId, isCardio: true, plannedSets: 0, plannedReps: null, plannedRepsPerSet: null, sets: [], cardioDone: false, cardioData: null, note: '', supersetGroup: null, addedDuringSession: true };
        } else {
          const isUni = newEx?.movement_type === 'unilateral';
          const bwKg = newEx?.equipment === 'bodyweight' ? LB.latestBodyweight(s) ?? null : null;
          const last = LB.bestRecentEntry(s, newExId, session.dayId);
          const suggestion = LB.progressionSuggestion(s, newExId, session.dayId, null, null, last);
          const seedSets = LB.buildSeedSets({ sets: 3, repsPerSet: null }, last, suggestion, isUni, !!s.settings?.smartProgression, bwKg);
          newEntry = { exId: newExId, name: newEx?.name || newExId, plannedSets: 3, plannedReps: null, plannedRepsPerSet: null, sets: seedSets, note: '', supersetGroup: null, addedDuringSession: true };
        }
        return {
          ...s,
          sessions: s.sessions.map(x => x.id !== session.id ? x : {
            ...x,
            entries: [newEntry],
            currentExIdx: 0,
          }),
        };
      });
    } else {
      // Defer insertion until the user picks a superset (or solo) —
      // that choice determines where the new exercise is placed.
      setAddSupersetData({ newExId });
    }
  };

  // Called from the superset modal: targetIdx = null → solo (insert after current),
  // targetIdx = i → link with entry i and insert right after it.
  const confirmAdd = (targetIdx) => {
    const { newExId } = addSupersetData;
    setAddSupersetData(null);
    setStore(s => {
      const sess = s.sessions.find(x => x.id === session.id);
      if (!sess) return s;
      const newEx = LB.findExercise(s, newExId);
      const isNewCardio = newEx?.movement_type === 'cardio';
      const currentIdx = sess.currentExIdx || 0;
      const insertIdx = targetIdx !== null ? targetIdx + 1 : currentIdx + 1;
      const group = targetIdx !== null
        ? (sess.entries[targetIdx]?.supersetGroup || LB.uid())
        : null;
      let newEntry;
      if (isNewCardio) {
        newEntry = { exId: newExId, name: newEx?.name || newExId, isCardio: true, plannedSets: 0, plannedReps: null, plannedRepsPerSet: null, sets: [], cardioDone: false, cardioData: null, note: '', supersetGroup: group, addedDuringSession: true };
      } else {
        const isUni = newEx?.movement_type === 'unilateral';
        const bwKg = newEx?.equipment === 'bodyweight' ? LB.latestBodyweight(s) ?? null : null;
        const last = LB.bestRecentEntry(s, newExId, session.dayId);
        const suggestion = LB.progressionSuggestion(s, newExId, session.dayId, null, null, last);
        const mother = targetIdx !== null ? sess.entries[targetIdx] : null;
        const setCount = mother ? (mother.plannedSets ?? mother.sets?.length ?? 3) : 3;
        const seedSets = LB.buildSeedSets({ sets: setCount, repsPerSet: null }, last, suggestion, isUni, !!s.settings?.smartProgression, bwKg);
        newEntry = { exId: newExId, name: newEx?.name || newExId, plannedSets: setCount, plannedReps: null, plannedRepsPerSet: null, sets: seedSets, note: '', supersetGroup: group, addedDuringSession: true };
      }
      const withNew = [
        ...sess.entries.slice(0, insertIdx),
        newEntry,
        ...sess.entries.slice(insertIdx),
      ];
      // If linking, propagate the group to the target entry too
      const finalEntries = targetIdx !== null
        ? withNew.map((e, i) => i === targetIdx ? { ...e, supersetGroup: group } : e)
        : withNew;
      // Keep the user on the same exercise — only adjust index if insertion shifts it
      const newCurrentIdx = insertIdx <= currentIdx ? currentIdx + 1 : currentIdx;
      return {
        ...s,
        sessions: s.sessions.map(x => x.id !== session.id ? x : {
          ...x,
          entries: finalEntries,
          currentExIdx: newCurrentIdx,
        }),
      };
    });
  };

  const removeExercise = async () => {
    if (session.entries.length <= 1) return;
    if (!await confirm(`Remove "${entry.name}" from this session?`, { ok: 'Remove', danger: true })) return;
    updateSession(sess => {
      const newEntries = sess.entries.filter((_, i) => i !== exIdx);
      const newIdx = exIdx >= newEntries.length ? newEntries.length - 1 : exIdx;
      return { ...sess, entries: newEntries, currentExIdx: Math.max(0, newIdx) };
    });
  };

  const computePlanDiff = () => {
    const schedule = store.schedules?.find(s => s.id === session.scheduleId);
    const day = schedule?.days?.find(d => d.id === session.dayId);
    if (!day) return [];

    // Non-cardio plan items, keeping the original day.items index for applyPlanAndFinish
    const planItems = (day.items || [])
      .map((item, originalIdx) => ({ item, originalIdx }))
      .filter(({ item }) => LB.findExercise(store, item.exId)?.movement_type !== 'cardio');

    // Session entries that correspond to the original plan (no ad-hoc additions, no cardio)
    const sessionPlanEntries = session.entries.filter(e => !e.isCardio && !e.addedDuringSession);
    const addedEntries = session.entries.filter(e => e.addedDuringSession);

    // Greedy match plan items to session entries by exId (preserves correct pairing
    // even when exercises were inserted or removed, shifting indices)
    const usedJ = new Set();
    const matched = new Array(planItems.length).fill(null); // planItems[i] → sessionEntry | null
    for (let i = 0; i < planItems.length; i++) {
      for (let j = 0; j < sessionPlanEntries.length; j++) {
        if (!usedJ.has(j) && sessionPlanEntries[j].exId === planItems[i].item.exId) {
          matched[i] = sessionPlanEntries[j];
          usedJ.add(j);
          break;
        }
      }
    }
    const unmatchedPlanItems = planItems.filter((_, i) => !matched[i]);
    const unmatchedSessionEntries = sessionPlanEntries.filter((_, j) => !usedJ.has(j));

    const diffs = [];

    // Ad-hoc additions — store position context so applyPlanAndFinish can insert them
    session.entries.forEach((e, sessionIdx) => {
      if (!e.addedDuringSession) return;
      // Find the nearest non-cardio entry before this one to use as insertion anchor
      let insertAfterExId = null;
      for (let k = sessionIdx - 1; k >= 0; k--) {
        if (!session.entries[k].isCardio) { insertAfterExId = session.entries[k].exId; break; }
      }
      // Find the superset partner name (if linked)
      let supersetWithName = null;
      if (e.supersetGroup) {
        const partner = session.entries.find((se, j) => j !== sessionIdx && se.supersetGroup === e.supersetGroup);
        if (partner) supersetWithName = partner.name;
      }
      diffs.push({
        type: 'added', name: e.name, exId: e.exId,
        insertAfterExId,
        sets: e.sets.filter(s => !s.warmup).length,
        supersetGroup: e.supersetGroup || null,
        supersetWithName,
      });
    });

    // Set count changes for matched exercises
    planItems.forEach(({ item, originalIdx }, i) => {
      if (!matched[i]) return;
      const newSets = matched[i].sets.filter(s => !s.warmup).length;
      if (newSets !== item.sets) {
        diffs.push({ type: 'sets', idx: originalIdx, exName: matched[i].name, oldSets: item.sets, newSets });
      }
    });

    // Swaps: pair each unmatched plan item with the unmatched session entry at the same relative position
    const swapCount = Math.min(unmatchedPlanItems.length, unmatchedSessionEntries.length);
    for (let k = 0; k < swapCount; k++) {
      const { item, originalIdx } = unmatchedPlanItems[k];
      const entry = unmatchedSessionEntries[k];
      const oldEx = LB.findExercise(store, item.exId);
      diffs.push({ type: 'swap', idx: originalIdx, oldName: oldEx?.name || '?', newName: entry.name, newExId: entry.exId });
    }

    // Removed: plan items with no session counterpart and no swap partner
    for (let k = swapCount; k < unmatchedPlanItems.length; k++) {
      const { item, originalIdx } = unmatchedPlanItems[k];
      const oldEx = LB.findExercise(store, item.exId);
      diffs.push({ type: 'removed', name: oldEx?.name || '?', exId: item.exId, originalIdx });
    }

    // Reorder: detect exercises that were intentionally moved (not just shifted by
    // a neighbour's drag). Strategy: find the Longest Increasing Subsequence of
    // session positions — those exercises kept their relative order and were NOT
    // dragged. Everything outside the LIS was explicitly moved by the user.
    const matchedPairs = planItems
      .map((_, i) => matched[i] ? { planIdx: i, sessPos: sessionPlanEntries.indexOf(matched[i]) } : null)
      .filter(Boolean);
    if (matchedPairs.some((p, k) => k > 0 && p.sessPos < matchedPairs[k - 1].sessPos)) {
      // O(n²) LIS with parent-tracking — fine for typical plan sizes (<20 items)
      const sp = matchedPairs.map(p => p.sessPos);
      const dp = new Array(sp.length).fill(1);
      const parent = new Array(sp.length).fill(-1);
      let maxLen = 1, maxEnd = 0;
      for (let i = 1; i < sp.length; i++) {
        for (let j = 0; j < i; j++) {
          if (sp[j] < sp[i] && dp[j] + 1 > dp[i]) { dp[i] = dp[j] + 1; parent[i] = j; }
        }
        if (dp[i] > maxLen) { maxLen = dp[i]; maxEnd = i; }
      }
      const lisSet = new Set();
      for (let cur = maxEnd; cur !== -1; cur = parent[cur]) lisSet.add(cur);
      const moves = matchedPairs
        .map((p, k) => lisSet.has(k) ? null : {
          name: matched[p.planIdx].name,
          from: p.planIdx + 1,
          to: p.sessPos + 1,
        })
        .filter(Boolean);
      if (moves.length) diffs.push({ type: 'reorder', moves });
    }

    return diffs;
  };

  const tryFinish = () => {
    if (session.isBonus) {
      // Determine whether to show the "replace today's workout?" step.
      // Only relevant in cycle mode when today has training that isn't done yet.
      const todayData = LB.todaysDay(store);
      const activeSchedule = todayData?.schedule;
      const todayDayId = todayData?.day?.id;
      const alreadyDoneToday = !!todayDayId && store.sessions.some(
        s => s.ended && s.dayId === todayDayId && s.date?.slice(0, 10) === LB.todayISO()
      );
      const hasTodayTraining = (todayData?.day?.items?.length ?? 0) > 0 && !alreadyDoneToday;
      setShowCycleStep(hasTodayTraining);
      setAdvanceCycle(false);
      setCycleFromPickedDay(false);
      if (session.isFreestyle) {
        setFreestyleName('');
        setFinishStep('name');
      } else {
        setFinishStep(hasTodayTraining ? 'cycle' : 'feel');
      }
    } else {
      setShowCycleStep(false);
      setFinishStep('feel');
    }
    setPendingFeel(null);
  };

  const confirmWithFeel = (feel) => {
    const diffs = computePlanDiff();
    if (diffs.length > 0) {
      setPendingFeel(feel);
      setPlanDiff(diffs);
      setFinishOpen(false);
      setFinishStep('confirm');
      setPlanDiffOpen(true);
    } else {
      setFinishOpen(false);
      setFinishStep('confirm');
      finish(feel);
    }
  };

  const applyPlanAndFinish = () => {
    const schedule = store.schedules?.find(s => s.id === session.scheduleId);
    const day = schedule?.days?.find(d => d.id === session.dayId);
    if (schedule && day) {
      // 1. Apply swaps and set-count changes (positional, by originalIdx)
      let newItems = day.items.map((item, i) => {
        const diff = planDiff.find(d => (d.type === 'swap' || d.type === 'sets') && d.idx === i);
        if (!diff) return item;
        if (diff.type === 'swap') return { ...item, exId: diff.newExId };
        if (diff.type === 'sets') return { ...item, sets: diff.newSets };
        return item;
      });
      // 2. Remove exercises skipped during training
      const removedExIds = new Set(planDiff.filter(d => d.type === 'removed').map(d => d.exId));
      newItems = newItems.filter(item => !removedExIds.has(item.exId));
      // 3. Reorder remaining plan items to match session order
      if (planDiff.some(d => d.type === 'reorder')) {
        const sessionOrder = session.entries
          .filter(e => !e.isCardio && !e.addedDuringSession)
          .map(e => e.exId);
        newItems.sort((a, b) => {
          const ai = sessionOrder.indexOf(a.exId);
          const bi = sessionOrder.indexOf(b.exId);
          if (ai === -1 && bi === -1) return 0;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      }
      // 4. Insert ad-hoc exercises (process in session order so chained insertions work)
      for (const diff of planDiff.filter(d => d.type === 'added')) {
        const newItem = { exId: diff.exId, sets: diff.sets, reps: null, repsPerSet: null, supersetGroup: diff.supersetGroup };
        const afterIdx = diff.insertAfterExId
          ? newItems.findIndex(it => it.exId === diff.insertAfterExId)
          : -1;
        const insertAt = afterIdx >= 0 ? afterIdx + 1 : newItems.length;
        newItems = [...newItems.slice(0, insertAt), newItem, ...newItems.slice(insertAt)];
      }
      // 5. Sync supersetGroup for plan exercises that got linked to a new exercise
      const sessionGroups = new Map();
      session.entries.filter(e => !e.isCardio && !e.addedDuringSession)
        .forEach(e => sessionGroups.set(e.exId, e.supersetGroup || null));
      newItems = newItems.map(it => {
        if (!sessionGroups.has(it.exId)) return it;
        const sg = sessionGroups.get(it.exId);
        return sg !== (it.supersetGroup || null) ? { ...it, supersetGroup: sg } : it;
      });
      setStore(s => ({
        ...s,
        schedules: s.schedules.map(sch => sch.id === schedule.id ? {
          ...sch,
          days: sch.days.map(d => d.id === day.id ? { ...d, items: newItems } : d),
        } : sch),
      }));
    }
    finish(pendingFeel);
    setPendingFeel(null);
  };

  // Pace-bar base: the parts that DON'T depend on `now`. The 250 ms `now` tick
  // re-renders this component 4×/s; memoizing the set scans here keeps only the
  // elapsed-time math in the per-tick path. Returns null when the bar is hidden.
  // MUST be before any early return (React rules of hooks).
  const paceBase = useMemoT(() => {
    const timeline = avgStats?.timeline;
    if (!timeline || !session.startedAt) return null;
    const totalSetsDone = session.entries.reduce((s, e) => s + (e.sets?.filter(x => x.done && !x.warmup).length || 0), 0);
    if (totalSetsDone < 2) return null;
    const remainingSets = session.entries.reduce((s, e) => s + (e.sets?.filter(x => !x.done && !x.skipped && !x.warmup).length || 0), 0);
    if (remainingSets === 0) return null;
    const expectedSec = timeline[totalSetsDone - 1];
    if (expectedSec == null) return null;
    return { totalSetsDone, expectedSec };
  }, [avgStats, session.entries, session.startedAt]);

  if (!entry) {
    if (!session.isBonus) {
      return <Screen><Empty title="This session is empty" action={<Btn onClick={() => go({ name: 'home' })}>Back</Btn>} /></Screen>;
    }
    // Empty freestyle/bonus session — show exercise picker immediately
    return (
      <Screen scroll={false}>
        <div style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 22px 0', display: 'flex' }}>
          <button onClick={abandon} style={{ width: 32, height: 32, borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: 'transparent', color: UI.danger, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>×</button>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
          <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.inkSoft, textAlign: 'center' }}>Add an exercise to get started.</div>
          <Btn onClick={() => setAddOpen(true)}>Add exercise</Btn>
        </div>
        {addOpen && <window.Screens.ExercisePicker store={store} setStore={setStore} onClose={() => setAddOpen(false)} onPick={doAdd} />}
        {confirmEl}
      </Screen>
    );
  }

  const entrySets = entry?.sets || [];
  const completed = isCardio ? (entry?.cardioDone ? 1 : 0) : entrySets.filter(s => s.done).length;
  const allDone = !entry || (isCardio ? !!entry.cardioDone : (completed === entrySets.length));
  const currentSetIdx = entrySets.findIndex(s => !s.done);
  const warmupCount = entrySets.filter(s => s.warmup).length;
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
  const progressionTarget = progressionTargetForSet(Math.max(0, bgSetIdx - warmupCount));

  const workingSetsArr = entry.sets.filter(s => !s.warmup);
  const allWorkingDone = workingSetsArr.length > 0 && workingSetsArr.every(s => s.done || s.skipped);
  const anyMissingData = !isNoWeightReps && workingSetsArr.some(st => !st.done && !st.skipped && ((!isBodyweight && st.kg == null) || (isUnilateral ? (st.repsL == null || st.repsR == null) : st.reps == null)));

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
      {/* Gold screen flash overlay. NOTE: these full-screen flashes are portaled
          to <body> so they cover the WHOLE screen (incl. behind the status bar).
          Inside <Screen> (overflow:hidden), iOS WebKit clips position:fixed
          children to the screen box, capping the flash at the clock. */}
      {screenFlash && ReactDOM.createPortal(
        <div style={{ position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 200, background: UI.gold, opacity: 0.28, pointerEvents: 'none' }} />,
        document.body
      )}
      {/* Block keyboard and content interaction while any overlay is visible */}
      {(improvedSet || regressionSet || newBestSet || !!progressionUnlocked) && ReactDOM.createPortal(
        <div style={{ position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 100 }} />,
        document.body
      )}

      {/* New best (personal record) overlay */}
      {newBestSet && ReactDOM.createPortal(
        <div style={{
          position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 155, pointerEvents: 'none',
          background: 'var(--bg-body)',
          animation: 'improvedFade 2.5s ease forwards',
          animationFillMode: 'forwards',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            animation: 'improvedBorderPulse 0.5s ease-in-out infinite',
            borderRadius: 0,
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 8,
          }}>
            <span style={{ fontFamily: UI.fontDisplay, fontSize: 80, color: UI.gold, fontWeight: 900, lineHeight: 1, textShadow: '0 0 35px rgba(var(--accent-rgb),1), 0 0 80px rgba(var(--accent-rgb),0.6)' }}>★</span>
            <span style={{ fontFamily: UI.fontUi, fontSize: 30, color: UI.gold, fontWeight: 900, letterSpacing: '0.22em', textShadow: '0 0 18px rgba(var(--accent-rgb),1), 0 0 45px rgba(var(--accent-rgb),0.8), 0 0 90px rgba(var(--accent-rgb),0.4)' }}>NEW BEST</span>
            <span style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.inkSoft, fontWeight: 700, letterSpacing: '0.28em' }}>PERSONAL RECORD</span>
          </div>
        </div>,
        document.body
      )}

      {improvedSet && ReactDOM.createPortal(
        <div style={{
          position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 150, pointerEvents: 'none',
          background: 'var(--bg-body)',
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
            <span style={{ fontFamily: UI.fontDisplay, fontSize: 72, color: UI.gold, fontWeight: 900, lineHeight: 1, textShadow: '0 0 30px rgba(var(--accent-rgb),0.9), 0 0 70px rgba(var(--accent-rgb),0.5)' }}>↑</span>
            <span style={{ fontFamily: UI.fontUi, fontSize: 28, color: UI.gold, fontWeight: 900, letterSpacing: '0.2em', textShadow: '0 0 15px rgba(var(--accent-rgb),1), 0 0 40px rgba(var(--accent-rgb),0.8), 0 0 80px rgba(var(--accent-rgb),0.4)' }}>IMPROVEMENT</span>
          </div>
        </div>,
        document.body
      )}
      {/* Regression overlay */}
      {regressionSet && ReactDOM.createPortal(
        <div style={{
          position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 150, pointerEvents: 'none',
          background: 'var(--bg-body)',
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
        </div>,
        document.body
      )}

      {/* Progression unlocked overlay */}
      {progressionUnlocked && ReactDOM.createPortal(
        <div onClick={() => { setProgressionUnlocked(null); if (pendingNavRef.current) { pendingNavRef.current = false; navigate(1); } }} style={{
          position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 160,
          background: 'var(--bg-body)',
          animation: 'improvedFade 4s ease forwards',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8,
        }}>
          <div style={{ animation: 'improvedBorderPulse 0.8s ease-in-out infinite', position: 'absolute', inset: 0 }} />
          <span style={{ fontFamily: UI.fontDisplay, fontSize: 64, color: UI.gold, fontWeight: 900, lineHeight: 1, textShadow: '0 0 30px rgba(var(--accent-rgb),0.9), 0 0 70px rgba(var(--accent-rgb),0.5)' }}>↑</span>
          <span style={{ fontFamily: UI.fontUi, fontSize: 18, color: UI.gold, fontWeight: 900, letterSpacing: '0.22em', textShadow: '0 0 15px rgba(var(--accent-rgb),1), 0 0 40px rgba(var(--accent-rgb),0.8)' }}>PROGRESSION UNLOCKED</span>
          <span style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 700, marginTop: 4 }}>You've earned the next load.</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <span className="num" style={{ fontSize: 22, color: UI.inkSoft }}>{progressionUnlocked.currentKg}{UI.unit()}</span>
            <span style={{ color: UI.gold, fontSize: 20, lineHeight: 1 }}>→</span>
            <span className="num" style={{ fontSize: 28, color: UI.gold, fontWeight: 700, textShadow: '0 0 20px rgba(var(--accent-rgb),0.8)' }}>{progressionUnlocked.nextKg}{UI.unit()}</span>
          </div>
          <span className="micro" style={{ color: UI.inkFaint, marginTop: 6, letterSpacing: '0.12em' }}>{progressionUnlocked.exName}</span>
        </div>,
        document.body
      )}

      {/* Outlier confirmation (reps / kg / both) */}
      {outlierConfirm && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', background: 'rgba(0,0,0,0.55)' }}>
          <div style={{ background: UI.bg, borderRadius: '6px 6px 0 0', borderTop: `0.5px solid ${UI.hairStrong}`, width: '100%', maxWidth: 480, padding: '20px 20px 44px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ color: UI.gold, fontSize: 14 }} />
              <span style={{ fontWeight: 700, fontFamily: UI.fontUi, fontSize: 14, color: UI.ink }}>{(() => {
                const oc = outlierConfirm;
                if (oc.kind === 'both') return "That doesn't look right?";
                const isKg = oc.kind === 'kg';
                const val = oc.logged;
                const unit = isKg ? ` ${UI.unit()}` : (val === 1 ? ' rep' : ' reps');
                return oc.high ? `${val}${unit}?` : `Only ${val}${unit}?`;
              })()}</span>
            </div>
            <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 22 }}>
              {(() => {
                const oc = outlierConfirm;
                if (oc.kind === 'both') {
                  const u = UI.unit();
                  return `Expected ${oc.refKg}${u} × ${oc.refReps}, you logged ${oc.loggedKg}${u} × ${oc.loggedReps}`;
                }
                const isKg = oc.kind === 'kg';
                const u = isKg ? UI.unit() : '';
                return `${entry.name} — ${oc.logged}${u} logged, ${oc.ref}${u} expected`;
              })()}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn kind="ghost" style={{ flex: 1 }} onClick={() => {
                const s = outlierConfirm.setIdx;
                const kind = outlierConfirm.kind;
                setOutlierConfirm(null);
                activateKb(s, kind === 'both' ? 'kg' : kind === 'kg' ? 'kg' : (isUnilateral ? 'repsL' : 'reps'));
              }}>No, fix it</Btn>
              <Btn style={{ flex: 1 }} onClick={() => {
                const s = outlierConfirm.setIdx;
                setOutlierConfirm(null);
                completeSet(s, true);
              }}>{(() => {
                const oc = outlierConfirm;
                if (oc.kind === 'both') return 'Yes, log it anyway';
                const isKg = oc.kind === 'kg';
                const val = oc.logged;
                const unit = isKg ? UI.unit() : (val === 1 ? ' rep' : ' reps');
                return `Yes, ${val}${isKg ? ` ${unit}` : unit}`;
              })()}</Btn>
            </div>
          </div>
        </div>,
        document.body
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
            {(() => {
              const isProblem = storageFull || syncStatus === 'error';
              const isSaving  = syncStatus === 'pending' && !storageFull;
              const dotColor  = isProblem ? UI.danger : isSaving ? '#e8a838' : UI.ok;
              const pulse     = 'pulseDot 1.6s ease-in-out infinite';
              return <div onClick={isProblem ? onRetrySync : undefined} style={{ width: 6, height: 6, borderRadius: 4, background: dotColor, animation: pulse, cursor: isProblem ? 'pointer' : 'default', flexShrink: 0 }} />;
            })()}
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
              <div style={{ width: 44, height: 2, background: UI.hair, borderRadius: 4, overflow: 'hidden' }}>
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

      {/* Pace bar — positional comparison vs same point in last session */}
      {paceBase && (() => {
        const { totalSetsDone, expectedSec } = paceBase;
        const elapsedSec = (now - new Date(session.startedAt).getTime()) / 1000;
        const diffMin = Math.round((elapsedSec - expectedSec) / 60);
        if (Math.abs(diffMin) < 2) return null;
        const ahead = diffMin < 0;
        const pct = Math.min(Math.abs(diffMin) / 20 * 50, 50);
        return (
          <div style={{ flexShrink: 0, padding: '0 22px 8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <span className="micro" style={{ color: UI.inkFaint }}>VS LAST {session.dayName} · SET {totalSetsDone}</span>
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

      {/* Day name + exercise position — sync status floats centered between them
          (the global top-center overlay would cover the timers above). */}
      <div style={{ flexShrink: 0, padding: '6px 22px 10px', position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="micro-gold">{session.dayName}</span>
          {(store.statusMode === 'deload' || session.isDeload) && (
            <span style={{ fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)', background: 'rgba(var(--accent-rgb),0.12)', border: `0.5px solid ${UI.goldSoft}`, borderRadius: 4, padding: '1px 6px' }}>DELOAD · 50%</span>
          )}
        </span>
        <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>
          {String(exIdx + 1).padStart(2, '0')} <span style={{ color: UI.hair }}>/</span> {String(session.entries.length).padStart(2, '0')}
        </span>
      </div>

      {/* Exercise chips — long-press to drag-reorder via UI.useDragReorderH */}
      <div ref={chipRowSetRef} data-reorder-list="true" style={{ flexShrink: 0, padding: '0 22px 12px', display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {session.entries.flatMap((e, i) => {
          const done = e.isCardio ? !!e.cardioDone : e.sets.every(s => s.done || s.skipped);
          const active = i === exIdx;
          const nextE = session.entries[i + 1];
          const linkedToNext = e.supersetGroup && e.supersetGroup === nextE?.supersetGroup;
          const chip = (
            <button key={`chip-${i}`}
              data-reorder-item="true"
              onClick={() => updateSession(sess => ({ ...sess, currentExIdx: i }))}
              style={{
                flexShrink: 0, maxWidth: 110,
                padding: '5px 11px 4px', borderRadius: 4,
                border: `1px solid ${active ? UI.gold : done ? UI.goldSoft : UI.hairStrong}`,
                background: active ? UI.goldFaint : done ? 'rgba(var(--accent-rgb),0.05)' : 'transparent',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
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

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: `0 22px ${kbField ? 240 : 20}px`, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {entry ? (<>

        {/* Exercise name */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="display" style={{
              flex: 1, minWidth: 0,
              fontSize: entry.name.length > 28 ? 16 : entry.name.length > 22 ? 20 : entry.name.length > 16 ? 26 : 32,
              color: UI.ink, lineHeight: 1.05, letterSpacing: '0.02em', fontWeight: 700,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {entry.name}
            </div>
            {exercise?.youtube_url && (
              <a href={exercise.youtube_url} target="_blank" rel="noopener noreferrer"
                aria-label="Watch form video"
                style={{
                  flexShrink: 0, width: 38, height: 38, borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `0.5px solid ${UI.hairStrong}`, background: UI.bgRaised,
                  color: '#FF0000', textDecoration: 'none',
                }}>
                <i className="fa-brands fa-youtube" style={{ fontSize: 18 }} />
              </a>
            )}
          </div>
          {(exercise?.category || exercise?.equipment || (exercise?.tags || []).length > 0) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {exercise?.category && <Pill gold>{exercise.category}</Pill>}
              {exercise?.equipment && <Pill>{(window.EQUIPMENT_TYPES||[]).find(t=>t.key===exercise.equipment)?.label ?? exercise.equipment}</Pill>}
              {(exercise?.tags || []).map(t => <Pill key={t}>{t}</Pill>)}
            </div>
          )}
        </div>

        {/* HERO CURRENT SET — or CARDIO FORM */}
        {isCardio ? (
          entry.cardioDone ? (
            <Frame accent style={{ padding: 24, textAlign: 'center' }}>
              <i className="fa-solid fa-person-running" style={{ fontSize: 18, color: UI.gold, marginBottom: 8, display: 'block' }} />
              <div className="display" style={{ fontSize: 26, color: UI.gold, fontWeight: 900, marginBottom: 4 }}>
                {entry.cardioData?.type || 'Cardio'} logged.
              </div>
              {entry.cardioData && (
                <div className="num" style={{ fontSize: 12, color: UI.inkSoft, marginBottom: 16 }}>
                  {entry.cardioData.durationMinutes}min
                  {entry.cardioData.distanceM != null && ` · ${mToDisplayT(entry.cardioData.distanceM, cardioForm.distUnit)} ${cardioForm.distUnit}`}
                  {entry.cardioData.effort != null && ` · effort ${entry.cardioData.effort}/10`}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn kind="ghost" onClick={() => updateSession(sess => ({ ...sess, entries: sess.entries.map((e, i) => i === exIdx ? { ...e, cardioDone: false } : e) }))} style={{ flex: 1 }}>Edit</Btn>
                <Btn onClick={() => navigate(1)} style={{ flex: 2 }}>
                  {exIdx === session.entries.length - 1 ? 'Finish session →' : 'Next →'}
                </Btn>
              </div>
            </Frame>
          ) : (
            <BracketFrame gold padding={0}>
              <div style={{ padding: '18px 20px 20px' }}>
                <div className="micro-gold" style={{ marginBottom: 14 }}>LOG CARDIO</div>

                {/* Activity type */}
                <div style={{ marginBottom: 14 }}>
                  <div className="label" style={{ marginBottom: 8 }}>Activity</div>
                  <input
                    type="text" value={cardioForm.type}
                    onChange={e => setCardioForm(f => ({ ...f, type: e.target.value }))}
                    placeholder="e.g. Running, Cycling…"
                    style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', borderBottom: `0.5px solid ${UI.hairStrong}`, padding: '6px 0', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none' }}
                  />
                  {cardioTypeChips.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {cardioTypeChips.map(t => (
                        <button key={t} onClick={() => setCardioForm(f => ({ ...f, type: t }))} style={{
                          padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                          border: `1px solid ${cardioForm.type === t ? 'var(--accent)' : UI.hairStrong}`,
                          background: cardioForm.type === t ? `rgba(var(--accent-rgb),0.12)` : 'transparent',
                          color: cardioForm.type === t ? 'var(--accent)' : UI.inkFaint,
                          fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.04em',
                          WebkitTapHighlightColor: 'transparent',
                        }}>{t}</button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Duration */}
                <div style={{ marginBottom: 14 }}>
                  <div className="label" style={{ marginBottom: 6 }}>Duration (min)</div>
                  <input
                    type="number" inputMode="numeric" value={cardioForm.duration}
                    onChange={e => setCardioForm(f => ({ ...f, duration: e.target.value }))}
                    placeholder="e.g. 30"
                    style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', borderBottom: `0.5px solid ${UI.hairStrong}`, padding: '6px 0', color: UI.ink, fontFamily: UI.fontNum, fontSize: 22, outline: 'none' }}
                  />
                </div>

                {/* Distance */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span className="label">Distance</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['km','mi'].map(u => (
                        <button key={u} onClick={() => { localStorage.setItem(CARDIO_DIST_KEY_T, u); setCardioForm(f => ({ ...f, distUnit: u })); }} style={{ padding: '2px 8px', borderRadius: 4, border: `1px solid ${cardioForm.distUnit === u ? UI.gold : UI.hairStrong}`, background: cardioForm.distUnit === u ? UI.goldFaint : 'transparent', color: cardioForm.distUnit === u ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 9, letterSpacing: '0.1em', cursor: 'pointer' }}>{u}</button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="number" inputMode="decimal" value={cardioForm.distance}
                    onChange={e => setCardioForm(f => ({ ...f, distance: e.target.value }))}
                    placeholder={`0.00 ${cardioForm.distUnit}`}
                    style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', borderBottom: `0.5px solid ${UI.hairStrong}`, padding: '6px 0', color: UI.ink, fontFamily: UI.fontNum, fontSize: 22, outline: 'none' }}
                  />
                </div>

                {/* Pace feeling */}
                <div style={{ marginBottom: 14 }}>
                  <div className="label" style={{ marginBottom: 8 }}>Pace feeling</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[['1','Easy'],['2','Light'],['3','Steady'],['4','Solid'],['5','Hard'],['6','Max']].map(([v, l]) => (
                      <Pill key={v} gold={cardioForm.paceFeeling === Number(v)}
                        onClick={() => setCardioForm(f => ({ ...f, paceFeeling: f.paceFeeling === Number(v) ? null : Number(v) }))}
                        style={{ cursor: 'pointer' }}>{l}</Pill>
                    ))}
                  </div>
                </div>

                {/* Effort */}
                <div style={{ marginBottom: 18 }}>
                  <div className="label" style={{ marginBottom: 8 }}>Effort 1–10</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {[1,2,3,4,5,6,7,8,9,10].map(v => (
                      <button key={v} onClick={() => setCardioForm(f => ({ ...f, effort: f.effort === v ? null : v }))} style={{ width: 30, height: 30, borderRadius: 4, border: `1px solid ${cardioForm.effort === v ? UI.gold : UI.hairStrong}`, background: cardioForm.effort === v ? UI.goldFaint : 'transparent', color: cardioForm.effort === v ? UI.gold : UI.inkFaint, fontFamily: UI.fontNum, fontSize: 12, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>{v}</button>
                    ))}
                  </div>
                </div>

                <Btn onClick={logCardio} disabled={!cardioForm.duration || parseInt(cardioForm.duration) <= 0} style={{ width: '100%', opacity: (!cardioForm.duration || parseInt(cardioForm.duration) <= 0) ? 0.4 : 1 }}>
                  <i className="fa-solid fa-person-running" style={{ marginRight: 8 }} />Log cardio
                </Btn>
              </div>
            </BracketFrame>
          )
        ) : allDone ? (
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
                      LAST TIME <span style={{ color: UI.inkSoft }}>{prevHeroSet.kg}{UI.unit()} × {(prevHeroSet.repsL != null || prevHeroSet.repsR != null) ? `L${prevHeroSet.repsL ?? '?'}/R${prevHeroSet.repsR ?? '?'}` : prevHeroSet.reps}</span>
                    </span>
                  ) : null}
                  {progressionTarget && (
                    <div className="micro" style={{ color: UI.gold, opacity: 0.65, marginTop: 3 }}>≥{progressionTarget} reps · next weight</div>
                  )}
                  {!progressionTarget && entry.plannedRepsPerSet && entry.plannedRepsPerSet.length > 1 && (() => {
                    const workingIdx = bgSetIdx - warmupCount;
                    const target = entry.plannedRepsPerSet[workingIdx] ?? entry.plannedRepsPerSet[entry.plannedRepsPerSet.length - 1];
                    return <div className="micro" style={{ color: UI.inkFaint, marginTop: 3 }}>Target: {target} reps</div>;
                  })()}
                </div>
              </div>

              {/* HUGE inputs — hidden for checkbox-only mobility exercises */}
              {!isNoWeightReps && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 14px' }}>
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
                          : store.settings?.weightFillDown !== false && si > bgSetIdx && !st.done && !st.warmup ? { ...st, kg }
                          : st
                        ),
                      }),
                    }))}
                  />
                  <div className="micro" style={{ marginTop: 2 }}>{UI.unit() === 'lbs' ? 'POUNDS' : 'KILOGRAMS'}</div>
                </div>
                <div style={{ fontSize: 32, color: UI.hair, fontFamily: UI.fontDisplay, fontWeight: 700, alignSelf: 'flex-start', marginTop: 6 }}>×</div>
                {isUnilateral ? (
                  <div style={{ flex: 1, display: 'flex', gap: 4 }}>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <KbCell
                        text={kbField?.setIdx === bgSetIdx && kbField?.field === 'repsL' ? kbRaw : (heroSet.repsL ?? '')}
                        placeholder="—"
                        onActivate={() => activateKb(bgSetIdx, 'repsL')}
                        style={{ background: 'transparent', outline: 'none', color: UI.gold, fontFamily: UI.fontNum, fontVariantNumeric: 'tabular-nums', fontSize: 44, fontWeight: 300, letterSpacing: '-0.02em', textAlign: 'center', width: '100%', padding: 0, border: 'none', ...(kbField?.setIdx === bgSetIdx && kbField?.field === 'repsL' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }}
                      />
                      <div className="micro" style={{ marginTop: 2 }}>LEFT</div>
                    </div>
                    <div style={{ fontSize: 22, color: UI.hair, fontFamily: UI.fontDisplay, fontWeight: 200, alignSelf: 'flex-start', marginTop: 10 }}>/</div>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <KbCell
                        text={kbField?.setIdx === bgSetIdx && kbField?.field === 'repsR' ? kbRaw : (heroSet.repsR ?? '')}
                        placeholder="—"
                        onActivate={() => activateKb(bgSetIdx, 'repsR')}
                        style={{ background: 'transparent', outline: 'none', color: UI.gold, fontFamily: UI.fontNum, fontVariantNumeric: 'tabular-nums', fontSize: 44, fontWeight: 300, letterSpacing: '-0.02em', textAlign: 'center', width: '100%', padding: 0, border: 'none', ...(kbField?.setIdx === bgSetIdx && kbField?.field === 'repsR' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }}
                      />
                      <div className="micro" style={{ marginTop: 2 }}>RIGHT</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <KbCell
                      text={kbField?.setIdx === bgSetIdx && kbField?.field === 'reps' ? kbRaw : (heroSet.reps ?? '')}
                      placeholder="—"
                      onActivate={() => activateKb(bgSetIdx, 'reps')}
                      style={{ background: 'transparent', outline: 'none', color: UI.gold, fontFamily: UI.fontNum, fontVariantNumeric: 'tabular-nums', fontSize: 44, fontWeight: 300, letterSpacing: '-0.02em', textAlign: 'center', width: '100%', padding: 0, border: 'none', ...(kbField?.setIdx === bgSetIdx && kbField?.field === 'reps' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }}
                    />
                    <div className="micro" style={{ marginTop: 2 }}>REPETITIONS</div>
                  </div>
                )}
              </div>}

            </div>
          </BracketFrame>
        )}

        {/* All sets list — hidden for cardio */}
        {!isCardio && <div style={{ paddingTop: 12 }}>
          {isNoWeightReps ? (
            <div style={{ height: 6 }} />
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isUnilateral ? '28px 1fr 72px 44px 44px 28px' : '28px 1fr 72px 56px 28px',
              gap: 8, alignItems: 'baseline',
              padding: '0 4px 6px',
            }}>
              <div />
              <span className="micro" style={{ color: UI.inkFaint }}>Last time</span>
              <span className="micro" style={{ color: UI.inkFaint, textAlign: 'center' }}>{UI.unit()}</span>
              {isUnilateral ? (
                <>
                  <span className="micro" style={{ color: UI.inkFaint, textAlign: 'center' }}>L</span>
                  <span className="micro" style={{ color: UI.inkFaint, textAlign: 'center' }}>R</span>
                </>
              ) : (
                <span className="micro" style={{ color: UI.inkFaint, textAlign: 'center' }}>{store.settings?.smartProgression ? 'Reps (min)' : 'Reps'}</span>
              )}
              <div />
            </div>
          )}
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
              const rpsTargets = entry.plannedRepsPerSet;
              const repPlaceholder = rpsTargets && rpsTargets.length > 1
                ? String(rpsTargets[workingRowNum - 1] ?? rpsTargets[rpsTargets.length - 1])
                : '—';
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
                  {(() => {
                    const isDropActive = dropSetIdx === i && !s.done;
                    const isMyoActive = myoSetIdx === i && !s.done;
                    const isIntensityActive = isDropActive || isMyoActive;
                    return (
                    <div data-kb-row={i} style={{
                      display: 'grid',
                      gridTemplateColumns: isIntensityActive ? '28px 1fr' : (isNoWeightReps ? '28px 1fr 28px' : (isUnilateral ? '28px 1fr 72px 44px 44px 28px' : '28px 1fr 72px 56px 28px')),
                      gap: 8, alignItems: 'center',
                      padding: '10px 4px',
                      opacity: s.done || s.skipped ? (isWarmupRow ? 0.3 : 0.4) : 1,
                      animation: flashSet === i ? 'rowFlash 1.4s ease forwards' : 'none',
                    }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: 4, flexShrink: 0,
                        background: isCurrent ? UI.goldFaint : 'transparent',
                        outline: `1px solid ${isCurrent ? UI.gold : s.done ? UI.goldDeep : isWarmupRow ? UI.hair : UI.hairStrong}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: UI.fontNum, fontSize: isWarmupRow ? 8 : 10, fontWeight: 500,
                        color: isCurrent ? UI.gold : s.done ? UI.goldDeep : UI.inkFaint,
                      }}>{isWarmupRow ? `W${warmupRowNum}` : workingRowNum}</div>

                      {isIntensityActive ? null : isNoWeightReps ? <div /> : (
                        (s.technique === 'drop' || s.technique === 'myorep' || s.technique === 'myorep_match') && s.done
                          ? <span style={{
                              display: 'inline-block', fontFamily: UI.fontUi, fontSize: 8,
                              fontWeight: 700, letterSpacing: '0.12em', color: UI.gold,
                              background: 'rgba(var(--accent-rgb),0.12)',
                              border: '0.5px solid rgba(var(--accent-rgb),0.35)',
                              borderRadius: 4, padding: '2px 6px',
                            }}>{s.technique === 'drop' ? 'DS' : s.technique === 'myorep_match' ? 'MM' : 'MR'}</span>
                          : <div className="num" style={{ fontSize: 11, color: UI.inkFaint }}>
                              {isWarmupRow
                                ? <span style={{ color: UI.inkGhost }}>{s.warmupPct}%</span>
                                : prevSet?.kg != null && (prevSet.reps != null || prevSet.repsL != null || prevSet.repsR != null) ? `${prevSet.kg}${UI.unit()} × ${(prevSet.repsL != null || prevSet.repsR != null) ? `L${prevSet.repsL ?? '?'}/R${prevSet.repsR ?? '?'}` : prevSet.reps}` : '—'
                              }
                            </div>
                      )}

                      {!isIntensityActive && !isNoWeightReps && <KgInput
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
                              : store.settings?.weightFillDown !== false && si > i && !st.done && !st.warmup ? { ...st, kg }
                              : st
                            ),
                          }),
                        }))}
                      />}

                      {!isIntensityActive && !isNoWeightReps && (isUnilateral ? (
                        <>
                          <KbCell text={kbField?.setIdx === i && kbField?.field === 'repsL' ? kbRaw : (s.repsL ?? '')} placeholder="L" disabled={s.done || s.skipped} onActivate={() => activateKb(i, 'repsL')} style={{ ...setInputStyle(s.done || s.skipped, isCurrent), ...(kbField?.setIdx === i && kbField?.field === 'repsL' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }} />
                          <KbCell text={kbField?.setIdx === i && kbField?.field === 'repsR' ? kbRaw : (s.repsR ?? '')} placeholder="R" disabled={s.done || s.skipped} onActivate={() => activateKb(i, 'repsR')} style={{ ...setInputStyle(s.done || s.skipped, isCurrent), ...(kbField?.setIdx === i && kbField?.field === 'repsR' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }} />
                        </>
                      ) : (
                        <KbCell text={kbField?.setIdx === i && kbField?.field === 'reps' ? kbRaw : (s.reps ?? '')} placeholder={repPlaceholder} disabled={s.done || s.skipped} onActivate={() => activateKb(i, 'reps')} style={{ ...setInputStyle(s.done || s.skipped, isCurrent), ...(kbField?.setIdx === i && kbField?.field === 'reps' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }} />
                      ))}

                      {!isIntensityActive && <button
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
                          if (dropSetIdx === i || myoSetIdx === i) return;
                          if (!isNoWeightReps && !isBodyweight && s.kg == null) return;
                          _log(`row${i} → completeSet`);
                          completeSet(i);
                        }}
                        disabled={!s.done && !s.skipped && !isNoWeightReps && ((!isBodyweight && s.kg == null) || (!(kbField?.setIdx === i && kbField?.field !== 'kg') && (isUnilateral ? (s.repsL == null || s.repsR == null) : s.reps == null)))}
                        style={{
                          width: 26, height: 26, borderRadius: 4, border: `1px solid ${s.skipped ? UI.inkFaint : s.done ? UI.gold : (!isNoWeightReps && ((!isBodyweight && s.kg == null) || (isUnilateral ? (s.repsL == null || s.repsR == null) : s.reps == null))) ? UI.hair : isCurrent ? UI.goldSoft : UI.hairStrong}`, cursor: 'pointer',
                          background: s.done ? UI.gold : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: s.skipped ? 12 : 14, fontWeight: 700,
                          color: s.skipped ? UI.inkFaint : s.done ? '#0a0805' : 'transparent',
                          opacity: !s.done && !s.skipped && !isNoWeightReps && ((!isBodyweight && s.kg == null) || (isUnilateral ? (s.repsL == null || s.repsR == null) : s.reps == null)) ? 0.35 : 1,
                          flexShrink: 0, justifySelf: 'center',
                          WebkitTapHighlightColor: 'transparent',
                        }}>{s.skipped ? '×' : '✓'}</button>}

                    </div>
                    );
                  })()}
                  {dropSetIdx === i && !s.done && (
                    <div style={{ marginLeft: 36, paddingLeft: 10, borderLeft: `2px solid rgba(var(--accent-rgb),0.3)` }}>
                      <div style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1, paddingBottom: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px 2px' }}>
                          <span className="micro-gold">DROP SET</span>
                          <button onClick={() => {
                            setDropSetIdx(null); setDropDrops([]);
                            kbFieldRef.current = null; kbRawRef.current = ''; setKbField(null); setKbRaw('');
                          }} style={{ background: 'none', border: 'none', color: UI.inkFaint, fontSize: 10, fontFamily: UI.fontUi, cursor: 'pointer', padding: '2px 4px', letterSpacing: '0.08em' }}>CANCEL</button>
                        </div>
                      </div>
                      {dropDrops.map((d, di) => {
                        const isKgA = kbField?.setIdx === 'drop' && kbField?.dropIdx === di && kbField?.field === 'kg';
                        const isRepsA = kbField?.setIdx === 'drop' && kbField?.dropIdx === di && kbField?.field === 'reps';
                        return (
                          <div key={di} data-drop-row={di} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 72px 56px 28px', gap: 8, alignItems: 'center', padding: '5px 4px' }}>
                            <div style={{
                              width: 24, height: 24, borderRadius: 4, flexShrink: 0,
                              background: 'rgba(var(--accent-rgb),0.08)',
                              outline: `1px solid rgba(var(--accent-rgb),0.3)`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, color: UI.gold,
                            }}>↓</div>
                            <div className="num" style={{ fontSize: 10, color: UI.inkGhost }}>
                              {di === 0 ? 'top' : `drop ${di + 1}`}
                            </div>
                            <KbCell
                              text={isKgA ? kbRaw : (d.kg != null ? String(d.kg).replace('.', ',') : '')}
                              placeholder="—"
                              onActivate={() => activateDropKb(di, 'kg')}
                              style={{ ...setInputStyle(false, isKgA), ...(isKgA ? { boxShadow: 'inset 0 -2px 0 var(--accent)' } : {}) }}
                            />
                            <KbCell
                              text={isRepsA ? kbRaw : (d.reps != null ? String(d.reps) : '')}
                              placeholder="—"
                              onActivate={() => activateDropKb(di, 'reps')}
                              style={{ ...setInputStyle(false, isRepsA), ...(isRepsA ? { boxShadow: 'inset 0 -2px 0 var(--accent)' } : {}) }}
                            />
                            <button onClick={() => dropDrops.length > 1 && setDropDrops(prev => prev.filter((_, idx) => idx !== di))}
                              disabled={dropDrops.length <= 1}
                              style={{
                                width: 26, height: 26, borderRadius: 4, border: `1px solid ${UI.hair}`,
                                background: 'transparent', color: UI.inkFaint, fontSize: 14,
                                cursor: dropDrops.length <= 1 ? 'default' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                opacity: dropDrops.length <= 1 ? 0.2 : 1, flexShrink: 0,
                                WebkitTapHighlightColor: 'transparent',
                              }}>×</button>
                          </div>
                        );
                      })}
                      <div data-drop-actions style={{ display: 'flex', gap: 8, padding: '4px 4px 10px', scrollMarginBottom: 260 }}>
                        <button onClick={() => {
                          const newIdx = dropDropsRef.current.length;
                          setDropDrops(prev => [...prev, { kg: null, reps: null }]);
                          setTimeout(() => activateDropKb(newIdx, 'kg'), 80);
                        }} style={{
                          flex: 1, padding: '8px 0', background: 'transparent',
                          border: `1px solid ${UI.hairStrong}`, borderRadius: 6,
                          color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700,
                          letterSpacing: '0.1em', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                        }}>↓ ADD DROP</button>
                        <button onClick={() => finishDropSet(dropDropsRef.current)}
                          disabled={!dropDrops[0]?.reps}
                          style={{
                            flex: 2, padding: '8px 0',
                            background: dropDrops[0]?.reps ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                            border: `1px solid ${dropDrops[0]?.reps ? 'rgba(var(--accent-rgb),0.5)' : UI.hair}`,
                            borderRadius: 6, color: dropDrops[0]?.reps ? 'var(--accent)' : UI.inkGhost,
                            fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                            cursor: dropDrops[0]?.reps ? 'pointer' : 'default',
                            WebkitTapHighlightColor: 'transparent',
                          }}>✓ FINISH</button>
                      </div>
                    </div>
                  )}
                  {s.technique === 'drop' && s.done && (s.drops || []).length > 1 && (
                    <div style={{ marginLeft: 36, paddingLeft: 10, paddingBottom: 8, borderLeft: `2px solid rgba(var(--accent-rgb),0.2)` }}>
                      {(s.drops || []).slice(1).map((d, di) => (
                        <div key={di} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 72px 56px', gap: 8, alignItems: 'center', padding: '4px 4px', opacity: 0.5 }}>
                          <div style={{
                            width: 24, height: 24, borderRadius: 4,
                            outline: `1px solid rgba(var(--accent-rgb),0.2)`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, color: UI.goldSoft,
                          }}>↓</div>
                          <div />
                          <div style={{ ...setInputStyle(true, false), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="num" style={{ fontSize: 15, color: UI.inkSoft }}>{d.kg != null ? String(d.kg).replace('.', ',') : '—'}</span>
                          </div>
                          <div style={{ ...setInputStyle(true, false), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="num" style={{ fontSize: 15, color: UI.inkSoft }}>{d.reps ?? '—'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Myo-Rep active inline rows */}
                  {myoSetIdx === i && !s.done && (() => {
                    const myoTotalReps = myoDrops.reduce((acc, d) => acc + (d.reps || 0), 0);
                    const myoProgress = myoTarget ? Math.min(1, myoTotalReps / myoTarget) : 0;
                    const canFinish = myoDrops.length >= 2 && myoDrops[0]?.reps != null;
                    const activationDone = myoDrops[0]?.reps != null;
                    return (
                      <div style={{ marginLeft: 36, paddingLeft: 10, borderLeft: `2px solid rgba(var(--accent-rgb),0.3)` }}>
                          <div style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1, paddingBottom: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px 2px' }}>
                            <span className="micro-gold">{myoTechnique === 'myorep_match' ? 'MYO REP MATCH' : 'MYO-REPS'}</span>
                            <button onClick={cancelMyo} style={{ background: 'none', border: 'none', color: UI.inkFaint, fontSize: 10, fontFamily: UI.fontUi, cursor: 'pointer', padding: '2px 4px', letterSpacing: '0.08em' }}>CANCEL</button>
                          </div>
                          {/* Match progress counter */}
                          {myoTechnique === 'myorep_match' && myoTarget != null && (
                            <div style={{ padding: '6px 4px 4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                                <span className="micro" style={{ color: UI.inkSoft, letterSpacing: '0.1em' }}>MATCH</span>
                                <div>
                                  <span className="num" style={{ fontSize: 20, fontWeight: 700, color: myoProgress >= 1 ? UI.gold : UI.ink, transition: 'color 0.3s ease' }}>{myoTotalReps}</span>
                                  <span className="num" style={{ fontSize: 12, color: UI.inkGhost }}> / {myoTarget}</span>
                                </div>
                              </div>
                              <div style={{ position: 'relative', height: 6, borderRadius: 999, background: 'rgba(var(--accent-rgb),0.12)', margin: '0 0 4px' }}>
                                <div style={{
                                  position: 'absolute', left: 0, top: 0, height: '100%',
                                  width: `${Math.min(1, myoProgress) * 100}%`,
                                  minWidth: myoProgress > 0 ? 8 : 0,
                                  borderRadius: 999,
                                  background: myoProgress >= 1 ? 'var(--accent)' : 'rgba(var(--accent-rgb),0.75)',
                                  boxShadow: myoProgress > 0 ? `0 0 ${Math.round(4 + myoProgress * 10)}px ${Math.round(2 + myoProgress * 6)}px rgba(var(--accent-rgb),${(0.3 + myoProgress * 0.5).toFixed(2)})` : 'none',
                                  transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease',
                                }} />
                              </div>
                            </div>
                          )}
                        </div>
                        {myoDrops.map((d, di) => {
                          const isActiv = di === 0;
                          const isKgA = kbField?.setIdx === 'myo' && kbField?.dropIdx === di && kbField?.field === 'kg';
                          const isRepsA = kbField?.setIdx === 'myo' && kbField?.dropIdx === di && kbField?.field === 'reps';
                          return (
                            <div key={di} data-myo-row={di} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 72px 56px 28px', gap: 8, alignItems: 'center', padding: '5px 4px' }}>
                              <div style={{
                                width: 24, height: 24, borderRadius: 4, flexShrink: 0,
                                background: 'rgba(var(--accent-rgb),0.08)',
                                outline: `1px solid rgba(var(--accent-rgb),0.3)`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontFamily: UI.fontUi, fontSize: isActiv ? 9 : 10, fontWeight: 700, color: UI.gold,
                              }}>{isActiv ? 'ACT' : '↺'}</div>
                              <div className="num" style={{ fontSize: 10, color: UI.inkGhost }}>{isActiv ? 'activation' : `myo ${di}`}</div>
                              {/* kg — editable for activation (myo only), read-only for match activation + all minis */}
                              {isActiv && myoTechnique === 'myorep' ? (
                                <KbCell
                                  text={isKgA ? kbRaw : (d.kg != null ? String(d.kg).replace('.', ',') : '')}
                                  placeholder="—"
                                  onActivate={() => activateMyo(di, 'kg')}
                                  style={{ ...setInputStyle(false, isKgA), ...(isKgA ? { boxShadow: 'inset 0 -2px 0 var(--accent)' } : {}) }}
                                />
                              ) : (
                                <div style={{ ...setInputStyle(true, false), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <span className="num" style={{ fontSize: 15, color: UI.inkGhost }}>{d.kg != null ? String(d.kg).replace('.', ',') : '—'}</span>
                                </div>
                              )}
                              <KbCell
                                text={isRepsA ? kbRaw : (d.reps != null ? String(d.reps) : '')}
                                placeholder="—"
                                onActivate={() => activateMyo(di, 'reps')}
                                style={{ ...setInputStyle(false, isRepsA), ...(isRepsA ? { boxShadow: 'inset 0 -2px 0 var(--accent)' } : {}) }}
                              />
                              {isActiv ? (
                                <div />
                              ) : (
                                <button onClick={() => myoDrops.length > 2 && setMyoDrops(prev => prev.filter((_, idx) => idx !== di))}
                                  disabled={myoDrops.length <= 2}
                                  style={{
                                    width: 26, height: 26, borderRadius: 4, border: `1px solid ${UI.hair}`,
                                    background: 'transparent', color: UI.inkFaint, fontSize: 14,
                                    cursor: myoDrops.length <= 2 ? 'default' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    opacity: myoDrops.length <= 2 ? 0.2 : 1, flexShrink: 0,
                                    WebkitTapHighlightColor: 'transparent',
                                  }}>×</button>
                              )}
                            </div>
                          );
                        })}
                        <div data-myo-actions style={{ display: 'flex', gap: 8, padding: '4px 4px 10px', scrollMarginBottom: 260 }}>
                          {activationDone && (
                            <button onClick={() => {
                              const newIdx = myoDropsRef.current.length;
                              const activKg = myoDropsRef.current[0]?.kg ?? null;
                              setMyoDrops(prev => [...prev, { kg: activKg, reps: null }]);
                              setTimeout(() => activateMyo(newIdx, 'reps'), 80);
                            }} style={{
                              flex: 1, padding: '8px 0', background: 'transparent',
                              border: `1px solid ${UI.hairStrong}`, borderRadius: 6,
                              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700,
                              letterSpacing: '0.1em', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                            }}>↺ ADD MYO</button>
                          )}
                          <button onClick={() => finishMyoSet(myoDropsRef.current, myoTechnique)}
                            disabled={!canFinish}
                            style={{
                              flex: 2, padding: '8px 0',
                              background: canFinish ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                              border: `1px solid ${canFinish ? 'rgba(var(--accent-rgb),0.5)' : UI.hair}`,
                              borderRadius: 6, color: canFinish ? 'var(--accent)' : UI.inkGhost,
                              fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                              cursor: canFinish ? 'pointer' : 'default',
                              WebkitTapHighlightColor: 'transparent',
                            }}>✓ FINISH</button>
                        </div>
                      </div>
                    );
                  })()}
                  {/* Completed myo rows */}
                  {(s.technique === 'myorep' || s.technique === 'myorep_match') && s.done && (s.drops || []).length > 1 && (
                    <div style={{ marginLeft: 36, paddingLeft: 10, paddingBottom: 8, borderLeft: `2px solid rgba(var(--accent-rgb),0.2)` }}>
                      {(s.drops || []).slice(1).map((d, di) => (
                        <div key={di} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 72px 56px', gap: 8, alignItems: 'center', padding: '4px 4px', opacity: 0.5 }}>
                          <div style={{
                            width: 24, height: 24, borderRadius: 4,
                            outline: `1px solid rgba(var(--accent-rgb),0.2)`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, color: UI.goldSoft,
                          }}>↺</div>
                          <div className="num" style={{ fontSize: 10, color: UI.inkGhost }}>myo {di + 1}</div>
                          <div style={{ ...setInputStyle(true, false), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="num" style={{ fontSize: 15, color: UI.inkSoft }}>{d.kg != null ? String(d.kg).replace('.', ',') : '—'}</span>
                          </div>
                          <div style={{ ...setInputStyle(true, false), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="num" style={{ fontSize: 15, color: UI.inkSoft }}>{d.reps ?? '—'}</span>
                          </div>
                        </div>
                      ))}
                      {(() => { const t = (s.drops || []).reduce((a, d) => a + (d.reps || 0), 0); return t > 0 ? <div style={{ marginTop: 4, padding: '3px 8px', border: '1px solid var(--accent)', borderRadius: 4, fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.03em', textAlign: 'center' }}>Total {t}</div> : null; })()}
                    </div>
                  )}
                  {i < entry.sets.length - 1 && !(i === warmupCount - 1 && warmupCount > 0) && <div className="knurl" />}
                </React.Fragment>
              );
            })}
          </div>

          {!isCardio && (
            <button className="intensity-glow" onClick={() => setIntensityOpen(true)} style={{
              width: '100%', marginTop: 6, padding: '8px 0',
              background: 'rgba(var(--accent-rgb),0.08)',
              border: '1px solid rgba(var(--accent-rgb),0.5)',
              borderRadius: 6, cursor: 'pointer',
              color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700,
              letterSpacing: '0.14em', WebkitTapHighlightColor: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <i className="fa fa-bolt" style={{ fontSize: 10 }} />
              INTENSITY
            </button>
          )}

          {!isCardio && (
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button onClick={addSet} style={{
                flex: 1, padding: '9px 0', background: 'transparent',
                border: '1px solid var(--accent)', borderRadius: 6,
                color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700,
                letterSpacing: '0.1em', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}>+ ADD SET</button>
              {entry.sets.filter(s => !s.warmup).length > 1 && (
                <button onClick={removeLastSet} style={{
                  flex: 1, padding: '9px 0', background: 'transparent',
                  border: `1px solid ${UI.danger}`, borderRadius: 6,
                  color: UI.danger, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.1em', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}>− REMOVE SET</button>
              )}
              <button
                onClick={checkAllSets}
                disabled={allWorkingDone || (anyMissingData && !allWorkingDone)}
                style={{
                  flex: 1, padding: '9px 0', background: allWorkingDone ? UI.goldFaint : 'transparent',
                  border: `1px solid ${allWorkingDone ? UI.goldSoft : anyMissingData ? UI.hair : UI.hairStrong}`, borderRadius: 6,
                  color: allWorkingDone ? UI.gold : anyMissingData ? UI.inkGhost : UI.inkFaint,
                  fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.1em', cursor: allWorkingDone || anyMissingData ? 'default' : 'pointer',
                  opacity: anyMissingData && !allWorkingDone ? 0.35 : 1,
                  WebkitTapHighlightColor: 'transparent',
                }}>✓ ALL</button>
            </div>
          )}

        </div>}

          {/* swap / add exercise / remove exercise / tempo / note */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            {!isCardio && <button onClick={swapExercise} style={{
              width: 32, height: 32, borderRadius: 4,
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              color: UI.inkSoft, fontSize: 14, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>⇄</button>}
            {!isCardio && <button onClick={() => setAddOpen(true)} style={{
              width: 32, height: 32, borderRadius: 4,
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              color: UI.inkSoft, fontSize: 14, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>⊕</button>}
            {session.entries.length > 1 && <button onClick={removeExercise} style={{
              width: 32, height: 32, borderRadius: 4,
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              color: UI.inkSoft, fontSize: 14, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>}
            {!isCardio && store.settings?.tempoEnabled && (
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

        {/* Exercise note (permanent, from exercise definition) */}
        {exercise?.note && (
          <Frame style={{ padding: 14 }} onClick={() => { setExNoteVal(exercise?.note || ''); setExNoteOpen(true); }}>
            <div className="micro" style={{ marginBottom: 6 }}>NOTE · {entry.name.toUpperCase()}</div>
            <div style={{ fontFamily: UI.fontDisplay, fontSize: 16, color: UI.inkSoft, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {exercise.note}
            </div>
          </Frame>
        )}

      </>) : null}
      </div>

      {/* Footer nav */}
      <div className="knurl" />
      <div style={{
        flexShrink: 0,
        padding: `10px 22px calc(env(safe-area-inset-bottom, 8px) + 10px)`,
        display: 'flex', gap: 10,
      }}>
        <button onClick={() => navigate(-1)} disabled={exIdx === 0} style={{
          width: 44, minHeight: 44, borderRadius: 6,
          background: 'transparent', border: `1px solid ${UI.hairStrong}`,
          color: UI.inkSoft, cursor: exIdx === 0 ? 'default' : 'pointer',
          opacity: exIdx === 0 ? 0.3 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        {allDone ? (
          <Btn onClick={() => navigate(1)} style={{ flex: 1, minHeight: 44, padding: '10px 16px' }}>
            {(session.entries.length === 0 || exIdx === session.entries.length - 1) ? 'Finish →' : 'Next exercise →'}
          </Btn>
        ) : isCardio ? (<>
          <Btn kind="ghost" onClick={skipCardio} style={{ flex: 1, minHeight: 44 }}>Skip</Btn>
          {exIdx === session.entries.length - 1 && (
            <Btn onClick={() => navigate(1)} style={{ flex: 1, minHeight: 44 }}>Finish →</Btn>
          )}
        </>) : (<>
          {(() => {
            const pending = entrySets.find(s => !s.done && !s.skipped);
            const hasVal = pending && (pending.kg != null || pending.reps != null || pending.repsL != null || pending.repsR != null);
            return <Btn onClick={checkSet} disabled={!hasVal} style={{ flex: 2, minHeight: 44, padding: '10px 16px' }}>Check set</Btn>;
          })()}
          <Btn onClick={skipExercise} style={{ flex: 1, minHeight: 44, padding: '6px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
            <span>Skip</span>
            <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.6, textTransform: 'none', letterSpacing: 0 }}>remaining sets</span>
          </Btn>
          {exIdx === session.entries.length - 1 && (
            <Btn onClick={() => navigate(1)} style={{ flex: 1, minHeight: 44, padding: '10px 8px' }}>Finish →</Btn>
          )}
        </>)}
      </div>

      {/* finish confirmation */}
      <Sheet open={finishOpen} onClose={() => { setFinishOpen(false); setFinishStep('confirm'); setPendingFeel(null); }} title={finishStep === 'confirm' ? "End session?" : finishStep === 'name' ? "Name this workout" : finishStep === 'cycle' ? "Wrap up" : "Rate workout effort"}>
        {finishStep === 'confirm' ? (<>
          <div style={{ fontSize: 14, color: UI.inkSoft, marginBottom: 18, lineHeight: 1.6 }}>
            {(() => {
              const incomplete = session.entries
                .map(e => e.isCardio
                  ? { name: e.name, remaining: e.cardioDone ? 0 : 1, isCardio: true }
                  : { name: e.name, remaining: e.sets.filter(s => !s.done && !s.skipped).length })
                .filter(e => e.remaining > 0);
              if (!incomplete.length) return null;
              return (
                <div style={{ background: 'rgba(var(--accent-rgb),0.08)', border: `1px solid rgba(var(--accent-rgb),0.3)`, borderRadius: 6, padding: '10px 12px', marginBottom: 14 }}>
                  <div className="label" style={{ color: 'var(--accent)', marginBottom: 8 }}>Incomplete sets</div>
                  {incomplete.map(e => (
                    <div key={e.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 4 }}>
                      <span style={{ color: UI.inkSoft }}>{e.name}</span>
                      <span className="num" style={{ color: 'var(--accent)' }}>{e.isCardio ? 'not logged' : `${e.remaining} left`}</span>
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
                {Math.round(LB.totalVolume(session, store.exercises)).toLocaleString('en-US')} {UI.unit()}
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
        </>) : finishStep === 'name' ? (<>
          <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 14, fontFamily: UI.fontUi }}>
            Give this freestyle workout a name, or skip to keep "Freestyle".
          </div>
          <input
            value={freestyleName}
            onChange={e => setFreestyleName(e.target.value)}
            placeholder="e.g. Push day, Arms & shoulders…"
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box',
              background: UI.bgInset, border: `1px solid ${UI.hair}`,
              borderRadius: 4, padding: '12px 14px', color: UI.ink,
              fontFamily: UI.fontUi, fontSize: 15, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Btn kind="ghost" onClick={() => { setFinishStep(showCycleStep ? 'cycle' : 'feel'); setPendingFeel(null); }} style={{ flex: 1 }}>Skip</Btn>
            <Btn onClick={() => { setFinishStep(showCycleStep ? 'cycle' : 'feel'); setPendingFeel(null); }} style={{ flex: 2 }}>Next →</Btn>
          </div>
        </>) : finishStep === 'cycle' ? (<>
          <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, marginBottom: 8 }}>Replace today's workout?</div>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, marginBottom: 20 }}>
            {(() => { const n = LB.todaysDay(store)?.day?.name; return n ? `Today is ${n} day. Did this session replace it, or was it extra?` : 'Today is a scheduled training day. Did this session replace it, or was it extra?'; })()}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Btn onClick={() => { setAdvanceCycle(true); setCycleFromPickedDay(true); setFinishStep('feel'); setPendingFeel(null); }} style={{ width: '100%' }}>
              Replaces it — continue from {session.dayName}
            </Btn>
            <Btn kind="ghost" onClick={() => { setAdvanceCycle(true); setCycleFromPickedDay(false); setFinishStep('feel'); setPendingFeel(null); }} style={{ width: '100%' }}>
              Replaces it — keep cycle on track
            </Btn>
            <Btn kind="ghost" onClick={() => { setAdvanceCycle(false); setCycleFromPickedDay(false); setFinishStep('feel'); setPendingFeel(null); }} style={{ width: '100%' }}>
              Extra session — keep as bonus
            </Btn>
          </div>
        </>) : (<>
          <FeelSelector value={pendingFeel} onChange={setPendingFeel} />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Btn kind="ghost" onClick={() => confirmWithFeel(null)} style={{ flex: 1 }}>Skip</Btn>
            <Btn onClick={() => confirmWithFeel(pendingFeel)} style={{ flex: 2 }}>Done ✓</Btn>
          </div>
        </>)}
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

      {/* intensity technique picker */}
      <Sheet open={intensityOpen} onClose={() => setIntensityOpen(false)} title="Intensity">
        {(() => {
          const startDrop = () => {
            const target = currentSetIdx >= 0
              ? currentSetIdx
              : entry.sets.reduce((last, s, i) => !s.warmup ? i : last, -1);
            if (target < 0) return;
            const s = entry.sets[target];
            const initDrops = [{ kg: s?.kg ?? null, reps: s?.reps ?? null }];
            setDropDrops(initDrops);
            dropDropsRef.current = initDrops;
            setDropSetIdx(target);
            setIntensityOpen(false);
            setTimeout(() => activateDropKb(0, 'kg'), 150);
          };
          const startMyo = (technique) => {
            const target = currentSetIdx >= 0
              ? currentSetIdx
              : entry.sets.reduce((last, s, i) => !s.warmup ? i : last, -1);
            if (target < 0) return;
            const s = entry.sets[target];
            const anchor = entry.sets.find(st => st.technique === 'myorep' && st.done && st.drops?.[0]?.reps != null);
            // For match: activation kg locked to the preceding myo set's activation kg
            const initKg = technique === 'myorep_match' ? (anchor?.drops?.[0]?.kg ?? s?.kg ?? null) : (s?.kg ?? null);
            const initDrops = [{ kg: initKg, reps: s?.reps ?? null }];
            setMyoDrops(initDrops);
            myoDropsRef.current = initDrops;
            setMyoSetIdx(target);
            setMyoTechnique(technique);
            if (technique === 'myorep_match') {
              setMyoTarget(anchor ? anchor.drops.reduce((sum, d) => sum + (d.reps || 0), 0) : null);
            }
            setIntensityOpen(false);
            // Match: kg is read-only, start straight at reps; Myo: start at kg
            setTimeout(() => activateMyo(0, technique === 'myorep_match' ? 'reps' : 'kg'), 150);
          };
          const myoMatchTarget = entry.sets.find(st => st.technique === 'myorep' && st.done && st.drops?.[0]?.reps != null);
          const btnBase = (active) => ({
            width: '100%', textAlign: 'left', cursor: active ? 'pointer' : 'default',
            background: active ? 'rgba(var(--accent-rgb),0.07)' : UI.bgInset,
            border: `1px solid ${active ? 'rgba(var(--accent-rgb),0.35)' : UI.hair}`,
            borderRadius: 6, padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 14,
            opacity: active ? 1 : 0.45,
            WebkitTapHighlightColor: 'transparent',
          });
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Drop Set */}
              <button onClick={startDrop} style={btnBase(true)}>
                <i className="fa-solid fa-angles-down" style={{ fontSize: 18, color: 'var(--accent)', width: 20, textAlign: 'center', flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)' }}>DROP SET</div>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft, marginTop: 2 }}>Descend the weight, keep the reps coming</div>
                </div>
              </button>
              {/* Myo-Rep row: two compact buttons matching DROP style */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button onClick={() => startMyo('myorep')} style={btnBase(true)}>
                  <i className="fa-solid fa-rotate" style={{ fontSize: 18, color: 'var(--accent)', width: 20, textAlign: 'center', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)' }}>MYO REP</div>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkSoft, marginTop: 2 }}>Activation + minis to failure</div>
                  </div>
                </button>
                <button onClick={() => startMyo('myorep_match')} disabled={!myoMatchTarget} style={btnBase(!!myoMatchTarget)}>
                  <i className="fa-solid fa-bullseye" style={{ fontSize: 18, color: myoMatchTarget ? 'var(--accent)' : UI.inkFaint, width: 20, textAlign: 'center', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', color: myoMatchTarget ? 'var(--accent)' : UI.inkFaint }}>MYO MATCH</div>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkSoft, marginTop: 2 }}>
                      {myoMatchTarget
                        ? `Target: ${myoMatchTarget.drops.reduce((s, d) => s + (d.reps || 0), 0)} reps`
                        : 'Do a Myo Rep set first'}
                    </div>
                  </div>
                </button>
              </div>
            </div>
          );
        })()}
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
      <Sheet open={exNoteOpen} onClose={requestCloseExNote} title="Exercise note">
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
      <Sheet open={planDiffOpen} onClose={() => { setPlanDiffOpen(false); finish(pendingFeel); setPendingFeel(null); }} title="Session changes">
        <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 12 }}>vs. plan:</div>
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
              ) : d.type === 'sets' ? (
                <>
                  <span style={{ color: UI.goldLight, fontSize: 14 }}>≡</span>
                  <span><strong>{d.exName}</strong>{': '}<span style={{ color: UI.inkSoft }}>{d.oldSets}</span>{' → '}<strong>{d.newSets} sets</strong></span>
                </>
              ) : d.type === 'added' ? (
                <>
                  <span style={{ color: UI.inkFaint, fontSize: 14 }}>＋</span>
                  <span style={{ color: UI.inkSoft }}>
                    <strong style={{ color: UI.ink }}>{d.name}</strong>{' added'}
                    {d.supersetWithName && <span>{' · superset with '}<strong style={{ color: UI.ink }}>{d.supersetWithName}</strong></span>}
                  </span>
                </>
              ) : d.type === 'reorder' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
                  {d.moves.map((m, mi) => (
                    <div key={mi} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: UI.goldLight, fontSize: 14 }}>⇅</span>
                      <span style={{ color: UI.inkSoft }}>
                        <strong style={{ color: UI.ink }}>{m.name}</strong>
                        {` · ${m.from} → ${m.to}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <span style={{ color: UI.inkFaint, fontSize: 14 }}>−</span>
                  <span style={{ color: UI.inkSoft }}><strong style={{ color: UI.ink }}>{d.name}</strong>{' removed'}</span>
                </>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => { setPlanDiffOpen(false); finish(pendingFeel); setPendingFeel(null); }} style={{ flex: 1 }}>Leave plan</Btn>
          <Btn onClick={() => { setPlanDiffOpen(false); applyPlanAndFinish(); }} style={{ flex: 2 }}>Update plan</Btn>
        </div>
      </Sheet>

      {/* exercise swap picker */}
      {swapOpen && <window.Screens.ExercisePicker store={store} setStore={setStore} onClose={() => setSwapOpen(false)} onPick={doSwap} singleSelect />}

      {/* exercise add picker */}
      {addOpen && <window.Screens.ExercisePicker store={store} setStore={setStore} onClose={() => setAddOpen(false)} onPick={doAdd} singleSelect />}

      {/* superset modal — step 1: ask yes/no; step 2: pick exercise to link */}
      {addSupersetData && (
        <Sheet open={true} onClose={() => confirmAdd(null)} title="Add exercise">
          {!addSupersetData.picking ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontFamily: UI.fontUi, fontSize: 14, color: UI.inkSoft, lineHeight: 1.5 }}>
                Add as part of a superset?
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn kind="ghost" onClick={() => confirmAdd(null)} style={{ flex: 1 }}>Solo</Btn>
                <Btn onClick={() => setAddSupersetData(d => ({ ...d, picking: true }))} style={{ flex: 1 }}>Superset</Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {session.entries.map((e, i) => (
                <button key={i} onClick={() => confirmAdd(i)} style={{
                  padding: '14px 0', textAlign: 'left', background: 'none', border: 'none',
                  borderBottom: `1px solid ${UI.hair}`, cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}>
                  <span className="micro" style={{ display: 'block', marginBottom: 3, color: UI.inkFaint }}>EX {String(i + 1).padStart(2, '0')}</span>
                  <span style={{ fontFamily: UI.fontDisplay, fontSize: 15, color: UI.ink }}>{e.name}</span>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}

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
            <div style={{ height: 2, background: UI.hair, borderRadius: 4, overflow: 'hidden', marginTop: 18, width: 200 }}>
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
                {(() => {
                  const isProblem = storageFull || syncStatus === 'error';
                  const isSaving  = syncStatus === 'pending' && !storageFull;
                  const dotColor  = isProblem ? UI.danger : isSaving ? '#e8a838' : UI.ok;
                  const pulse     = 'pulseDot 1.6s ease-in-out infinite';
                  return <div onClick={isProblem ? onRetrySync : undefined} style={{ width: 6, height: 6, borderRadius: 4, background: dotColor, animation: pulse, cursor: isProblem ? 'pointer' : 'default', flexShrink: 0 }} />;
                })()}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0 18px', marginBottom: 6 }}>
                  <span className="micro-gold">
                    WARMUP {String(warmupOverlayNum).padStart(2, '0')} / {String(warmupCount).padStart(2, '0')}
                  </span>
                  <span className="num" style={{ color: UI.goldSoft, fontSize: 11, letterSpacing: '0.1em' }}>
                    {warmupOverlaySet.warmupPct}% of working weight
                  </span>
                </div>
                <div style={{ textAlign: 'center', padding: '0 18px', marginBottom: 10 }}>
                  <span style={{ fontFamily: UI.fontDisplay, fontWeight: 700, fontSize: 18, color: UI.inkSoft, letterSpacing: '0.01em' }}>{entry.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 14px' }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    {warmupOverlayHasKg
                      ? <div className="num" style={{ fontSize: 52, fontWeight: 300, color: UI.gold, letterSpacing: '-0.02em', lineHeight: 1 }}>{warmupOverlaySet.kg}</div>
                      : <div className="num" style={{ fontSize: 44, fontWeight: 300, color: UI.inkSoft, letterSpacing: '-0.02em', lineHeight: 1 }}>{warmupOverlaySet.warmupPct}%</div>
                    }
                    <div className="micro" style={{ marginTop: 4 }}>{warmupOverlayHasKg ? (UI.unit() === 'lbs' ? 'POUNDS' : 'KILOGRAMS') : 'NO SEED WEIGHT'}</div>
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
                    height: 3, width: '100%', borderRadius: 4,
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
            {entry.note ? (
              <div style={{ marginTop: 12, padding: '10px 14px', background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}` }}>
                <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5 }}>{entry.note}</div>
              </div>
            ) : null}
          </div>
        </>
      )}

      {/* ── Post-warmup rest overlay — full-screen dramatic countdown ────────── */}
      {postWarmupRest && (
        <div style={{
          position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 61,
          background: 'var(--bg-body)',
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
          <div style={{ height: 2, background: UI.hair, borderRadius: 4, overflow: 'hidden', marginTop: 22, width: 180 }}>
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
        availablePlates={UI.unit() === 'lbs'
          ? (store.settings?.equipmentConfig?.plateInventoryLbs ?? PLATES_LBS)
          : (store.settings?.equipmentConfig?.plateInventoryKg ?? PLATES_KG)}
      />

    </Screen>
  );
}

function setInputStyle(done, current) {
  return {
    background: done ? 'transparent' : current ? 'rgba(var(--accent-rgb),0.06)' : UI.bgInset,
    border: `1px solid ${done ? 'transparent' : current ? UI.goldSoft : UI.hair}`,
    borderRadius: 4, outline: 'none',
    color: done ? UI.inkSoft : UI.ink,
    fontFamily: UI.fontNum, fontSize: 15, fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    width: '100%', padding: '8px 4px', textAlign: 'center',
  };
}

Object.assign(window.Screens, { TrainingScreen });
