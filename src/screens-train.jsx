/* Training mode — Hero Set redesign. All session/persistence logic identical
   to original (Supabase sync, push-over scheduling, plan-diff prompt,
   swap-exercise sheet, rest timer, abandon flow).
*/

const { useState: useStateT, useEffect: useEffectT, useRef: useRefT, useMemo: useMemoT, useLayoutEffect: useLayoutEffectT } = React;


// ─── Mesocycle helpers ─────────────────────────────────────────────────────────
const MESO_KEY = 'logbook-meso-state';
const MESO_MUSCLE_PRIORITY = ['Back','Quads','Chest','Glutes','Hamstrings','Shoulders','Calves','Abs','Triceps','Biceps','Forearms'];

function primaryMuscleForExercise(ex) {
  if (!ex?.tags?.length) return null;
  for (const m of MESO_MUSCLE_PRIORITY) {
    if (ex.tags.includes(m)) return m;
  }
  return ex.tags[0] || null;
}
// Read meso state: compares the store (DB-loaded, cross-device) copy against
// the per-plan localStorage cache (in-session writes that haven't been
// flushed to the store yet — see saveMesoState) and returns whichever is
// actually newer by updatedAt. A store entry can be stale relative to
// localStorage right after an app reload/crash mid-session, before the
// session's feedback answers were ever flushed — always trusting the store
// would silently discard those answers.
function getMesoState(scheduleId, mesoStates) {
  if (!scheduleId) return null;
  const fromStore = mesoStates?.length ? (mesoStates.find(m => m.scheduleId === scheduleId) || null) : null;
  let fromStorage = null;
  try {
    const r = localStorage.getItem(MESO_KEY + '-' + scheduleId)
           || localStorage.getItem(MESO_KEY); // old single-key format
    if (r) {
      const parsed = JSON.parse(r);
      // Old single-key format check
      if (parsed && !parsed.scheduleId && parsed.planId) parsed.scheduleId = parsed.planId;
      if (parsed?.scheduleId === scheduleId) fromStorage = parsed;
    }
  } catch {}
  if (!fromStore) return fromStorage;
  if (!fromStorage) return fromStore;
  const storeT = fromStore.updatedAt ? new Date(fromStore.updatedAt).getTime() : 0;
  const storageT = fromStorage.updatedAt ? new Date(fromStorage.updatedAt).getTime() : 0;
  const chosen = storageT > storeT ? fromStorage : fromStore;
  const other = chosen === fromStore ? fromStorage : fromStore;
  // startedAt is client-only (not round-tripped through the DB), so a DB-loaded
  // store copy can lack it while the localStorage cache still has it — carry it
  // over so the flex meso-week anchor survives a reload on the same device.
  if (chosen.startedAt == null && other?.startedAt != null) return { ...chosen, startedAt: other.startedAt };
  return chosen;
}
// Write meso state to per-plan localStorage key (in-session fast cache).
// The store (DB) is updated via setStore at session end.
function saveMesoStateToStorage(s) {
  if (!s?.scheduleId) return;
  try { localStorage.setItem(MESO_KEY + '-' + s.scheduleId, JSON.stringify(s)); } catch {}
}
// Which soreness/joint/volume prompts have already been answered THIS
// session, keyed by session id so a resumed session (app reload/crash mid-
// session) doesn't re-ask a question that was already answered — the
// in-memory Set trackers reset on every component mount, but a resumed
// session reuses the same session.id. Also carries the session's gain
// summary (mesoSessionSetGainsRef) so the post-session "Next session" sheet
// still reflects feedback given before a reload, even though the underlying
// mesoState.deltas were already safe via getMesoState/saveMesoState.
const MESO_ASKED_KEY = 'logbook-meso-asked-';
function loadMesoAskedSets(sessionId) {
  // `answers` (per question type, keyed by muscle/exId) and `negOwner` (key ->
  // question type) make answers editable for the rest of the session: they
  // record enough to reopen a sheet prefilled and to re-diff its contribution
  // to mesoState.deltas when the answer changes. See commitContrib below.
  const empty = { soreness: new Set(), joint: new Set(), volume: new Set(), gains: {},
    answers: { soreness: {}, joint: {}, volume: {} }, negOwner: {} };
  if (!sessionId) return empty;
  try {
    const r = localStorage.getItem(MESO_ASKED_KEY + sessionId);
    if (!r) return empty;
    const p = JSON.parse(r);
    return {
      soreness: new Set(p.soreness || []),
      joint: new Set(p.joint || []),
      volume: new Set(p.volume || []),
      gains: p.gains || {},
      answers: {
        soreness: p.answers?.soreness || {},
        joint: p.answers?.joint || {},
        volume: p.answers?.volume || {},
      },
      negOwner: p.negOwner || {},
    };
  } catch { return empty; }
}
function saveMesoAskedSets(sessionId, asked) {
  if (!sessionId) return;
  try {
    localStorage.setItem(MESO_ASKED_KEY + sessionId, JSON.stringify({
      soreness: [...asked.soreness], joint: [...asked.joint], volume: [...asked.volume],
      gains: asked.gains || {},
      answers: asked.answers || { soreness: {}, joint: {}, volume: {} },
      negOwner: asked.negOwner || {},
    }));
  } catch {}
}
function mesoCurrentWeek(mesoState, store) {
  if (!mesoState?.startDate) return 1;
  const sch = store?.schedules?.find(s => s.id === (mesoState.scheduleId ?? mesoState.planId));
  // Flex plans: "which rotation slot are we on" still uses cycleIndex (it also
  // advances on a skip, which is correct for plan position). But the meso
  // week/RIR target represents accumulated training fatigue, so it must only
  // advance on actually-trained sessions — counting raw cycleIndex deltas
  // would let a run of skips fast-forward the RIR target with zero training.
  if (sch && sch.days?.length > 0 && LB.isFlexPlan(sch)) {
    const startIdx = mesoState.startCycleIndex ?? 0;
    const currentIdx = store.cycleIndex || 0;
    if (currentIdx < startIdx) return null; // pending — waiting for next rotation start
    // Count trained sessions since the block began. Prefer the precise
    // startedAt timestamp over the date-only startDate: without it, sessions
    // from a PREVIOUS block logged earlier the SAME day the new block starts
    // (e.g. finishing Meso 1 then starting Meso 2 the same day) leak into the
    // new block's count and fast-forward its week. Falls back to the date
    // comparison for older mesos that predate startedAt.
    const startedTs = mesoState.startedAt ? new Date(mesoState.startedAt).getTime() : null;
    const trainedCount = (store?.sessions || []).filter(s =>
      s.ended && !s.isDeload && s.scheduleId === mesoState.scheduleId &&
      (startedTs != null ? new Date(s.ended).getTime() > startedTs : (s.date || '') >= mesoState.startDate)
    ).length;
    const rotations = Math.floor(trainedCount / sch.days.length);
    return Math.min(Math.max(1, rotations + 1), mesoState.weeks);
  }
  // Weekday and date-based cycle plans: date arithmetic.
  // Cycle plans: one meso "week" = one full rotation (daysLen days).
  // Weekday plans: one meso "week" = 7 calendar days.
  const start = LB.parseDate(mesoState.startDate);
  const today = new Date(); today.setHours(12, 0, 0, 0);
  if (today < start) return null; // pending
  const rawDays = Math.round((today - start) / 86400000);
  // Subtract pure-recovery time (deload/sick, plus idle vacation days) so a
  // break can't fast-forward the meso week / RIR target the way raw calendar
  // arithmetic would — mirrors the flex path's "only training advances the
  // meso" principle. Trained vacation days still count (they're not paused).
  const trainedDates = new Set(
    (store?.sessions || [])
      .filter(s => s.ended && !s.isDeload && s.scheduleId === mesoState.scheduleId && s.date)
      .map(s => s.date.slice(0, 10))
  );
  const paused = LB.mesoPausedDays(store?.statusPeriods, trainedDates, mesoState.startDate, LB.fmtISO(today));
  const days = Math.max(0, rawDays - paused);
  const cycleLen = (sch && !LB.isWeekdayPlan(sch) && sch.days?.length > 0) ? sch.days.length : 7;
  return Math.min(Math.max(1, Math.floor(days / cycleLen) + 1), mesoState.weeks);
}
// mesoRirForWeek lives in store.js (LB.mesoRirForWeek) so it's unit-testable —
// linear RIR taper from startRir (week 1) to endRir (final week), endRir may be
// negative (beyond failure → auto lengthened partials, see mesoPartials).
// Apply an already-resolved meso state's set-delta to a plan item before
// building seed sets. Returns a shallow copy with adjusted .sets, clamped to
// [1, baseline+4] so repeated "not enough volume" answers across a mesocycle
// can't balloon a lift's set count without bound; no-ops if no meso or no
// delta. Split out from applyMesoSetDelta so callers resolving meso state for
// every item in a plan (session start, plan viewer) can call getMesoState
// once instead of once per item (each call touches localStorage).
function applyMesoSetDeltaFromState(it, dayId, mesoState) {
  if (!dayId || !mesoState) return it;
  const delta = (mesoState.deltas || {})[it.exId + '_' + dayId];
  if (!delta) return it;
  const base = it.sets || 1;
  return { ...it, sets: Math.min(base + LB.MESO_GROWTH_CEILING_DELTA, Math.max(1, base + delta)) };
}
function applyMesoSetDelta(it, dayId, scheduleId, mesoStates) {
  if (!dayId || !scheduleId) return it;
  return applyMesoSetDeltaFromState(it, dayId, getMesoState(scheduleId, mesoStates));
}
// Returns stored meso weight boosts map (exId_dayId → kg increment) for a schedule.
// Called at session start; boosts are overwritten at next session end by computeMesoGains.
function getMesoWeightBoosts(scheduleId, mesoStates) {
  const m = getMesoState(scheduleId, mesoStates);
  if (!m || !m.weightBoosts) return null;
  return m.weightBoosts;
}

// ──────────────────────────────────────────────────────────────────────────────

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

// Optional "+ Partials" finisher on the last round of a Drop Set / Myo-Rep /
// Myo-Rep Match / AMRAP Variations chain — collapsed by default (0 = no-op,
// nothing written), tap to reveal the same stepper Lengthened Partials uses.
function FinisherPartials({ count, onChange }) {
  const [open, setOpen] = useStateT(count > 0);
  if (!open) return (
    <button onClick={() => setOpen(true)} style={{
      background: 'none', border: 'none', color: UI.inkFaint,
      fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      padding: '4px 4px 8px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
    }}>+ PARTIALS</button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 8px' }}>
      <span className="micro" style={{ color: UI.inkFaint }}>Partials</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => onChange(Math.max(0, count - 1))} style={{ width: 28, height: 28, borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkFaint, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>−</button>
        <span className="num" style={{ fontSize: 16, minWidth: 14, textAlign: 'center', color: count > 0 ? UI.gold : UI.inkFaint }}>{count}</span>
        <button onClick={() => onChange(count + 1)} style={{ width: 28, height: 28, borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkFaint, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>+</button>
      </div>
    </div>
  );
}

// Drop Set / Myo-Rep(-Match) / AMRAP Variations chains edit inside their own
// sheet (IntensityChainSheet, see the Sheet rendered near the Intensity
// picker below) rather than inline in the exercise list. The sheet's header
// is a plain flex item (not position:sticky — see IntensityChainSheet) sitting
// outside the rows' own scrollbox, so bringing the row actually being typed
// into into view is just a plain scrollIntoView within that small, bounded
// scrollbox — no margin needed, since there's no overlapping sticky header
// in this scroll context to hide behind.
function scrollChainRowIntoView(rowAttr, idx) {
  const row = document.querySelector(`[${rowAttr}="${idx}"]`);
  if (row) row.scrollIntoView({ behavior: 'auto', block: 'nearest' });
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
function CustomKeyboard({ visible, field, onType, onBackspace, onAdjust, onConfirm, onDismiss, onPlateCalc, confirmDisabled }) {
  if (!visible) return null;
  const isKg = field === 'kg';
  const H = 40;
  const base = {
    background: 'var(--bg-raised)', border: `0.5px solid var(--hair)`, borderRadius: 6,
    color: 'var(--ink)', fontFamily: UI.fontNum, fontSize: 18, fontWeight: 500,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent', userSelect: 'none', padding: 0,
  };
  const act = { ...base, background: 'var(--bg-inset)', color: 'var(--ink-soft)', fontSize: 13, fontFamily: UI.fontUi };

  return (
    <div data-keyboard
      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }}
      onTouchStart={e => { e.preventDefault(); e.stopPropagation(); }}
      style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 95,
      background: 'var(--bg)',
      padding: `5px 8px calc(env(safe-area-inset-bottom, 0px) + 5px)`,
    }}>
      {/* knurled top edge — same grip-texture seam the rest of the kit uses,
          in place of a flat hairline, so the keypad reads as a distinct
          physical piece instead of just fading into the screen above it. */}
      <div className="knurl" style={{ position: 'absolute', top: 0, left: 0, right: 0 }} />
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gridTemplateRows: `repeat(5, ${H}px)`, gap: 4 }}>
        {/* Row 1: ↓ 🏋 ↑ | ✓ (spans rows 1-4) */}
        <button style={act} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onAdjust(-1); }}>↓</button>
        <button style={act} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onPlateCalc(); }}><i className="fa-solid fa-dumbbell" style={{ fontSize: 11 }} /></button>
        <button style={act} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onAdjust(1); }}>↑</button>
        <button
          onPointerDown={e => { e.preventDefault(); e.stopPropagation(); if (!confirmDisabled) onConfirm(); }}
          style={{
            ...base, gridColumn: 4, gridRow: '1 / span 4', fontSize: 20, fontWeight: 700,
            ...(confirmDisabled
              ? { background: 'var(--bg-inset)', color: 'var(--ink-faint)', borderColor: 'var(--hair)', cursor: 'default' }
              : { background: 'linear-gradient(180deg, var(--accent-light), var(--accent))', color: '#0a0805', borderColor: 'var(--accent-deep)' }),
          }}
        >✓</button>

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

// Moves the entry at `from` to sit at post-removal index `to` (Array.splice
// semantics: `to` is interpreted against the array with `from` already
// removed) and re-maps currentExIdx so the view stays on the same entry.
// Shared by the chip drag-reorder and the mid-session superset-link flow.
function reorderSessionEntries(entries, currentIdx, from, to) {
  const next = [...entries];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  let idx = currentIdx;
  if (idx === from) idx = to;
  else if (from < to && idx > from && idx <= to) idx--;
  else if (from > to && idx >= to && idx < from) idx++;
  return { entries: next, currentExIdx: idx };
}

// A superset/giant-set's members must stay array-adjacent — the "⟷"
// connector and finishSetNavigation's round-matching both assume it. Used to
// reject a chip drag that would split an existing group apart (linking a NEW
// group, e.g. linkExistingSuperset, calls reorderSessionEntries directly and
// is exempt — it's establishing the very grouping this checks for).
function groupsContiguous(entries) {
  const seen = new Set();
  let i = 0;
  while (i < entries.length) {
    const g = entries[i].supersetGroup;
    if (!g) { i++; continue; }
    if (seen.has(g)) return false;
    seen.add(g);
    while (i < entries.length && entries[i].supersetGroup === g) i++;
  }
  return true;
}

// Live session clock, isolated into its own 1s-ticking leaf so removing the
// parent's 250ms `now` poll doesn't freeze the elapsed time. Sekunden-Anzeige
// braucht keine 250ms.
function SessionClock({ startedAt, style }) {
  const [, tick] = useStateT(0);
  useEffectT(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, []);
  const start = startedAt ? new Date(startedAt).getTime() : null;
  const el = start ? Math.floor((Date.now() - start) / 1000) : 0;
  const h = Math.floor(el / 3600), m = Math.floor((el % 3600) / 60), s = el % 60;
  const str = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return <span className="num" style={style}>{str}</span>;
}

// Rest countdown display, isolated into its own 250ms-ticking leaf. The three
// call sites (header chip, rest modal, warmup overlay) render a differently
// styled number + progress bar of the SAME rest state; `variant` selects the
// look. The parent owns the interactive wrappers and the expiry LOGIC
// (restExpired via setTimeout) — this leaf is display only.
function RestGauge({ restStart, restDef, variant }) {
  const [, tick] = useStateT(0);
  useEffectT(() => { const t = setInterval(() => tick(n => n + 1), 250); return () => clearInterval(t); }, []);
  const active = restStart != null && restDef != null;
  const el = active ? Math.floor((Date.now() - restStart) / 1000) : 0;
  const remaining = active ? Math.max(0, restDef - el) : null;
  const pct = active ? Math.max(0, Math.min(100, (el / restDef) * 100)) : 0;
  const mmss = remaining != null ? `${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, '0')}` : '—';
  const done = remaining === 0;
  if (variant === 'header') {
    return (<>
      <span className="num" style={{ color: UI.gold, fontSize: 14, letterSpacing: '0.14em', fontWeight: 500, animation: 'timerPulse 1.6s ease-in-out infinite' }}>{mmss}</span>
      <div style={{ width: 44, height: 2, background: UI.hair, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: UI.gold, transition: 'width 0.25s linear' }} />
      </div>
    </>);
  }
  if (variant === 'modal') {
    return (<>
      <div className="num" style={{ fontSize: 72, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1, color: UI.gold, animation: done ? 'timerPulse 0.8s ease-in-out infinite' : 'none', cursor: done ? 'pointer' : 'default' }}>{mmss}</div>
      {done && <div style={{ marginTop: 10, fontSize: 11, letterSpacing: '0.18em', color: UI.gold, fontFamily: UI.fontUi, fontWeight: 600 }}>GO</div>}
      <div style={{ height: 2, background: UI.hair, borderRadius: 4, overflow: 'hidden', marginTop: 18, width: 200 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: UI.gold, transition: 'width 0.25s linear' }} />
      </div>
    </>);
  }
  // warmup overlay
  return (<>
    <div className="num" style={{ fontSize: 88, fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1, color: UI.gold, textShadow: '0 0 40px rgba(var(--accent-rgb),0.55), 0 0 80px rgba(var(--accent-rgb),0.25)', animation: 'timerPulse 1.6s ease-in-out infinite' }}>{mmss}</div>
    <div style={{ height: 2, background: UI.hair, borderRadius: 4, overflow: 'hidden', marginTop: 22, width: 180 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: UI.gold, transition: 'width 0.25s linear' }} />
    </div>
  </>);
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

  // Auto-start a mesocycle when the session's plan has mesocycle_weeks set
  // and there's no active meso for this plan yet.
  useEffectT(() => {
    if (!_sch?.mesocycle_weeks || !session.scheduleId) return;
    const schId = session.scheduleId;
    // Compute the new meso object PURELY (outside setStore) so it's guaranteed
    // available for the localStorage / component-state writes below — a
    // functional updater may run lazily, so we can't rely on it having assigned
    // an outer variable by the time we read it. The effect runs once on mount,
    // so the `store` closure is the freshest snapshot we need.
    const freshSch = store.schedules.find(x => x.id === schId);
    if (!freshSch?.mesocycle_weeks) return;
    const existing = getMesoState(schId, store.mesoStates);
    // Keep existing meso only if weeks match the current config.
    // A mismatch (changed week count) always starts fresh.
    if (existing && existing.weeks === freshSch.mesocycle_weeks) return;
    // Align meso start to a clean boundary so week 1 is always a full rotation/week.
    // Weekday: next Monday (or today). Flex: next D1 via cycleIndex. Cycle: next D1 via date.
    const _isWeekday = LB.isWeekdayPlan(freshSch);
    const _isFlex = LB.isFlexPlan(freshSch);
    const _daysLen = freshSch.days.length || 1;
    const _ci = store.cycleIndex || 0;
    let alignedStartDate, alignedStartIdx;
    if (_isWeekday) {
      alignedStartDate = LB.nextMondayISO();
      alignedStartIdx = _ci;
    } else if (_isFlex) {
      alignedStartIdx = _ci % _daysLen === 0 ? _ci : Math.ceil(_ci / _daysLen) * _daysLen;
      alignedStartDate = LB.todayISO();
    } else {
      // Date-based cycle plan: use version-aware D1 so the meso aligns with how
      // the date strip renders (getCyclePosForDate respects version boundaries).
      alignedStartDate = LB.nextCycleD1ISOFromSchedule(freshSch, store.cycleStartDate);
      alignedStartIdx = 0;
    }
    const newMeso = {
      id: userId + '_' + schId,
      scheduleId: schId,
      weeks: freshSch.mesocycle_weeks,
      startDate: alignedStartDate,
      startCycleIndex: alignedStartIdx,
      deltas: {},
      jointFlags: {},
      pumpLowCounts: {},
      weightBoosts: {},
      growthCounts: {},
      completions: existing?.completions ?? 0,
      // Precise block-start anchor for the flex week count (see
      // mesoCurrentWeek) — client-side, mirrored to the localStorage cache;
      // absent mesos fall back to the date comparison.
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setStore(s => {
      const others = (s.mesoStates || []).filter(m => m.scheduleId !== schId);
      return { ...s, mesoStates: [...others, newMeso] };
    });
    // Immediately mirror the new meso state to the local cache / component
    // state too, so it's synced to DB without waiting for session end (covers
    // the case where user exits without finishing) and is available offline.
    saveMesoStateToStorage(newMeso);
    setMesoStateLocal(newMeso);
  }, []);

  const exIdx = session.currentExIdx || 0;
  const entry = session.entries[exIdx];
  // Memoized on the slices findExercise actually reads (exercises + exId) so the
  // 250ms `now` tick below no longer re-runs a linear scan of the whole library
  // on every render — it only recomputes when the library or current exId change.
  const exercise = useMemoT(() => (entry ? LB.findExercise(store, entry.exId) : null), [store.exercises, entry?.exId]);

  // "Last time" reference + remote best e1RM for this day type.
  // Matches LB.bestRecentEntry (best set at the current working weight across
  // the last 3 sessions, not merely the single most recent one) — the same
  // reference buildSeedSets/progressionSuggestion use to seed this session's
  // targets at start, so the live outlier check and "Last time" display never
  // disagree with what was actually seeded.
  // The local window covers recently trained exercises; when an exercise has
  // no local history (last logged before the boot window), fetch its recent
  // sessions from the server once. limit=20 covers both the windowed "last
  // time" reference and a broad enough window for the day-specific best-e1RM
  // comparison (for NEW BEST).
  const [remoteLast, setRemoteLast] = useStateT({});
  const remoteBestE1rmRef = useRefT({}); // exId → best day-specific e1RM from server
  // Memoized on sessions (+ exId/dayId): bestRecentEntry filters and O(n log n)
  // sorts the ENTIRE session history, which previously reran on every 250ms tick.
  // The current (ended:null) session never affects it, so `entry` set logs don't
  // need to invalidate — only a change to past sessions does.
  const localLast = useMemoT(() => (entry ? LB.bestRecentEntry(store, entry.exId, session.dayId) : null), [store.sessions, entry?.exId, session.dayId]);
  useEffectT(() => {
    const exId = entry?.exId;
    if (!exId || remoteLast[exId] !== undefined) return;
    let on = true;
    LB.fetchExerciseHistory(exId, session.dayId, 20, userId)
      .then(rows => {
        if (!on) return;
        // The server RPC doesn't know about is_deload and may return ~50%
        // deload sessions — exclude them (same guard as fetchSeedEntries) so a
        // deload load never becomes the "last time"/best/comparison baseline.
        const deloadIds = new Set((store.sessions || []).filter(s => s.isDeload).map(s => s.id));
        const filtered = (rows || []).filter(r => r.sessionId !== session.id && !deloadIds.has(r.sessionId));
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
        // Keep skipped sets in place (only warm-ups stripped) so working-set
        // position stays aligned across sessions — see bestRecentEntry.
        const ref = LB.bestEntryFromSetLists(filtered.slice(0, 3).map(r => (r.sets || []).filter(s => !s.warmup)));
        setRemoteLast(m => ({ ...m, [exId]: ref }));
      })
      .catch(() => { if (on) setRemoteLast(m => ({ ...m, [exId]: null })); });
    return () => { on = false; };
  }, [entry?.exId]);
  const last = localLast ?? (entry ? remoteLast[entry.exId] : null) ?? null;

  // Cross-day history for the tapped exercise name. The in-training "last time"
  // above is day-slot specific (bestRecentEntry / fetchExerciseHistory both key
  // on session.dayId), so an exercise pushed harder on another day reads as
  // stale here. This sheet pulls the exercise's real recent history across ALL
  // days straight from the server (get_exercise_history, not the 70-day local
  // window), local-first with a server overlay so it also works offline.
  const [historyOpen, setHistoryOpen] = useStateT(false);
  const [historyRows, setHistoryRows] = useStateT(null); // server rows; null until fetched (falls back to localHistory)
  const [historyLoading, setHistoryLoading] = useStateT(false);
  const historyDayNames = useMemoT(() => {
    const m = {};
    for (const s of (store.sessions || [])) if (s.id) m[s.id] = s.dayName;
    return m;
  }, [store.sessions]);
  const localHistory = useMemoT(() => {
    if (!entry?.exId) return [];
    const rows = [];
    for (const s of (store.sessions || [])) {
      if (!s.ended || s.isDeload || s.id === session.id) continue;
      const e = (s.entries || []).find(en => en.exId === entry.exId);
      if (!e || !(e.sets || []).some(st => !st.warmup && !st.skipped)) continue;
      rows.push({ sessionId: s.id, date: s.date, dayName: s.dayName, sets: e.sets });
    }
    rows.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
    return rows;
  }, [store.sessions, entry?.exId, session.id]);
  useEffectT(() => {
    if (!historyOpen || !entry?.exId) return;
    const exId = entry.exId;
    let on = true;
    setHistoryRows(null); // drop the previous exercise's rows; localHistory shows meanwhile
    setHistoryLoading(true);
    LB.fetchExerciseHistory(exId, null, 15, userId)
      .then(rows => {
        if (!on) return;
        const deloadIds = new Set((store.sessions || []).filter(s => s.isDeload).map(s => s.id));
        const mapped = (rows || [])
          .filter(r => r.sessionId !== session.id && !deloadIds.has(r.sessionId))
          .map(r => ({ sessionId: r.sessionId, date: r.date, dayName: historyDayNames[r.sessionId] || '', sets: r.sets || [] }));
        setHistoryRows(mapped);
        setHistoryLoading(false);
      })
      .catch(() => { if (on) setHistoryLoading(false); }); // keep null so the local fallback stays visible offline
    return () => { on = false; };
  }, [historyOpen, entry?.exId]);

  const isCardio = !!entry?.isCardio;
  const isUnilateral = !isCardio && (exercise?.movement_type ?? (exercise?.unilateral ? 'unilateral' : 'bilateral')) === 'unilateral';
  const logMode = !isCardio ? LB.exerciseLogMode(exercise) : 'weight';
  const isCheckbox = logMode === 'checkbox';   // tick only, no numbers
  const isRepsOnly = logMode === 'reps';       // reps cell, no weight
  const isNoWeightReps = isCheckbox || isRepsOnly; // "no weight column" — keeps all existing kg/header/hero gates
  const isBodyweight = !isCardio && exercise?.equipment === 'bodyweight';
  const progressionTargetForSet = (workingSetIdx) => {
    if (!LB.progressionEnabled(store, entry?.plannedRepsMax, entry?.plannedProgressionOffset)) return null;
    // Progression itself is suppressed during deload (see completeSet's
    // isDeloadSession guard) — showing the "≥X reps · next weight" hint
    // anyway would promise an unlock that can never actually fire.
    if (store.statusMode === 'deload' || session.isDeload) return null;
    const perSet = entry?.plannedRepsPerSet;
    const perSetVal = perSet && perSet.length > 1
      ? (perSet[workingSetIdx] ?? perSet[perSet.length - 1])
      : null;
    const base = (perSetVal ?? entry?.plannedReps) ?? 0;
    const target = LB.progressionCeilingFor(store, base, perSetVal ? null : entry?.plannedRepsMax, entry?.plannedProgressionOffset);
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
        ? { ...e, sets: e.sets.map((st, k) => {
            if (k !== setIdx) return st;
            // Unchecking (or editing a value on) a set that was completed via
            // an intensity technique (drop-set/myo-rep/lengthened partials)
            // reopens it for editing — clear the stale technique/drops so a
            // later plain re-check doesn't carry forward data that no longer
            // matches what's actually on the set.
            const clearsTechnique = patch.done === false && st.technique && !('technique' in patch);
            return { ...st, ...patch, ...(clearsTechnique ? { technique: null, drops: null } : {}) };
          }) }
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

  // First undone/unskipped WORKING set of a (typically different) entry, with
  // the field its exercise type wants focused first. Warmups never match here:
  // they're seeded onto at most one exercise for the whole session, unrelated
  // to superset rounds, so a cross-exercise focus jump should skip straight to
  // real working sets.
  const firstOpenWorkingFocus = (e, skipWeightIfFilled) => {
    if (!e || e.isCardio) return null;
    const idx = (e.sets || []).findIndex(s => !s.warmup && !s.done && !s.skipped);
    if (idx < 0) return null;
    const ex = store.exercises?.find(x => x.id === e.exId);
    const noWeight = !!ex?.no_weight_reps;
    const uni = (ex?.movement_type ?? (ex?.unilateral ? 'unilateral' : 'bilateral')) === 'unilateral';
    const repsField = uni ? 'repsL' : 'reps';
    // Same "don't re-enter an already-correct weight" skip as nextOwnFocus,
    // applied across an exercise/superset-partner switch too.
    if (!noWeight && skipWeightIfFilled && e.sets[idx]?.kg != null) {
      return { setIdx: idx, field: repsField };
    }
    return { setIdx: idx, field: noWeight ? repsField : 'kg' };
  };
  // Next undone/unskipped set of THIS SAME exercise (any type, including a
  // following warmup) — used when navigation stays put, so the field type
  // mirrors this entry's own kg/reps shape rather than re-deriving it.
  const nextOwnFocus = (setsArr, afterIdx) => {
    const idx = setsArr.findIndex((s, i) => i > afterIdx && !s.done && !s.skipped);
    if (idx < 0) return null;
    const repsField = isUnilateral ? 'repsL' : 'reps';
    // Skip the next set's weight field when it's pointless to re-enter: no
    // intensity technique on the set just finished (a drop/myo/lengthened
    // set already routes through its own dedicated flow, not this one) and
    // the next set's weight is already filled in (pre-seeded from
    // progression/last-time). Jump straight to reps instead of back to kg.
    if (!isNoWeightReps && !setsArr[afterIdx]?.technique && setsArr[idx]?.kg != null) {
      return { setIdx: idx, field: repsField };
    }
    return { setIdx: idx, field: isNoWeightReps ? repsField : 'kg' };
  };

  // Single source of truth for "where does the screen go, and where does the
  // keyboard focus land next" after ANY set is marked done — checkbox,
  // keyboard confirm, drop-set, myo-rep or lengthened partial all funnel
  // through this. Previously drop-set/myo-rep had no superset awareness at
  // all (a bare navigate(1) once their own sets were done, never a mid-round
  // partner jump), and the checkbox/keyboard paths each carried their own
  // separate, non-superset-aware "next field" guess computed eagerly — which
  // could fire (via its own timer) after this function had already moved the
  // screen to a different exercise, focusing the wrong row there instead.
  // Routing every completion through here and only computing the focus
  // target for whichever entry THIS function actually navigates to closes
  // that race for good.
  const finishSetNavigation = (setIdx, updatedSets, overlayHoldMs, advanceFocus) => {
    const group = entry.supersetGroup;
    // A skipped set is resolved (nothing left to log there) just like a done
    // one — only "not done and not skipped" is still pending. Checking
    // `.done === false` alone would treat a partner's skipped set as still
    // pending, jumping to it mid-round for no reason and blocking the
    // round/group from ever reading as complete.
    const resolved = (s) => !!s && (s.done || s.skipped);
    const noTechnique = !entry.sets[setIdx]?.technique;
    if (group && !entry.sets[setIdx]?.warmup) {
      const workingIdx = entry.sets.slice(0, setIdx + 1).filter(s => !s.warmup).length - 1;
      const partnerWorkingSets = (e) => (e.sets || []).filter(s => !s.warmup);
      const partners = session.entries.map((e, i) => ({ e, i })).filter(({ e, i }) => e.supersetGroup === group && i !== exIdx);
      const nextPartner = partners.find(({ e }) => !resolved(partnerWorkingSets(e)[workingIdx]));
      if (nextPartner) {
        // Mid-round: jump to partner, no rest
        if (advanceFocus) pendingFocusRef.current = firstOpenWorkingFocus(nextPartner.e, noTechnique);
        setTimeout(() => updateSession(sess => ({ ...sess, currentExIdx: nextPartner.i })), 300);
      } else {
        // Round complete: start rest
        persistRestStart(Date.now(), restDef);
        const allGroupDone = updatedSets.every(resolved) && partners.every(({ e }) => partnerWorkingSets(e).every(resolved));
        if (allGroupDone) {
          const lastGroupIdx = Math.max(...session.entries.map((e, i) => e.supersetGroup === group ? i : -1));
          const nextAfterGroup = lastGroupIdx + 1 < session.entries.length ? session.entries[lastGroupIdx + 1] : null;
          if (advanceFocus && nextAfterGroup) pendingFocusRef.current = firstOpenWorkingFocus(nextAfterGroup, noTechnique);
          setTimeout(() => {
            if (lastGroupIdx + 1 >= session.entries.length) setFinishOpen(true);
            else updateSession(sess => ({ ...sess, currentExIdx: lastGroupIdx + 1 }));
          }, Math.max(600, overlayHoldMs));
        } else {
          const allGroup = session.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.supersetGroup === group);
          const firstIncomplete = allGroup.find(({ e, i }) =>
            i === exIdx ? !updatedSets.every(resolved) : partnerWorkingSets(e).some(s => !resolved(s))
          );
          if (firstIncomplete) {
            if (advanceFocus) pendingFocusRef.current = firstOpenWorkingFocus(firstIncomplete.i === exIdx ? { ...entry, sets: updatedSets } : firstIncomplete.e, noTechnique);
            setTimeout(() => updateSession(sess => ({ ...sess, currentExIdx: firstIncomplete.i })), 600);
          }
        }
      }
    } else {
      if (!entry.sets[setIdx]?.warmup) {
        persistRestStart(Date.now(), restDef);
      }
      if (updatedSets.every(resolved)) {
        const nextEntry = session.entries[exIdx + 1];
        if (advanceFocus && nextEntry) pendingFocusRef.current = firstOpenWorkingFocus(nextEntry, noTechnique);
        setTimeout(() => navigate(1), Math.max(600, overlayHoldMs));
      } else if (advanceFocus) {
        const focus = nextOwnFocus(updatedSets, setIdx);
        if (focus) setTimeout(() => activateKb(focus.setIdx, focus.field), 400);
      }
    }
  };

  // How long after a completed set we swap to the next exercise (or open the
  // finish sheet) while a NEW BEST / IMPROVEMENT / REGRESSION flash is showing.
  // That flash is fully opaque from ~200ms to ~1800ms (improvedFade over its
  // 2.5s life) before fading out. Swapping at 700ms happens completely hidden
  // behind it, so as the flash fades the next exercise is already rendered
  // underneath: a smooth reveal instead of the old abrupt jump that only fired
  // once the flash had fully cleared at 2500ms. The flash keeps its own full
  // 2.5s hide timers; only the navigation moved earlier. The flash sits above
  // the finish sheet (z 150+ vs 100), so the last-set case reveals cleanly too.
  const FLASH_NAV_DELAY_MS = 700;

  // PROGRESSION UNLOCKED works the same way but appears 800ms later (it waits
  // out that delay before showing) and lives 4s, opaque from ~1120ms to
  // ~3680ms. Swapping at 1600ms lands well inside that opaque window, so the
  // next exercise is already on screen by the time it fades out at 4800ms.
  const PROGRESSION_NAV_DELAY_MS = 1600;

  // A 5/3/1 built-in deload week (week 4, 40/50/60% off the TM) is a normal
  // logged session (not an app deload via statusMode, not session.isDeload),
  // but its loads are intentionally light. So it must count as a deload for the
  // regression flash and the low-weight outlier guard, or both fire falsely.
  const is531DeloadSession = (() => {
    const s531 = store.schedules?.find(x => x.id === session.scheduleId);
    return LB.is531Plan(s531) && LB.current531Week(s531, store.sessions) === 4;
  })();

  const completeSet = (setIdx, bypassOutlierCheck = false, advanceFocus = false, extraPatch = null) => {
    // Lengthened partials only ever completes via finishLengthenedPartial,
    // which supplies extraPatch with the chosen partials count — every other
    // entry point (checkbox is hidden for this row, "Check set", keyboard
    // confirm, bulk check-all) is guarded to redirect or skip this set
    // instead of reaching here bare, but this is the backstop.
    if (lpTarget?.exIdx === exIdx && lpTarget?.setIdx === setIdx && !extraPatch) return;
    // Drop-set/myo-rep/AMRAP Variations only ever complete via their own
    // finish*Set function (which builds the whole patch itself and never
    // calls completeSet) — a bare completeSet on their target set would mark
    // it done with none of that data, so refuse outright rather than
    // silently corrupting it.
    if (dropSetIdx === setIdx || myoSetIdx === setIdx || avSetIdx === setIdx) return;
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
    const _isDeloadSet = store.statusMode === 'deload' || session.isDeload || is531DeloadSession;
    if (!bypassOutlierCheck && !entry.sets[setIdx]?.warmup && !_isDeloadSet) {
      const wIdx = entry.sets.slice(0, setIdx + 1).filter(s => !s.warmup).length - 1;
      const prevWorkingSets = (last?.entry?.sets || []).filter(s => !s.warmup);
      const prevSet = wIdx >= 0 ? prevWorkingSets[wIdx] : undefined;
      // Mirror buildSeedSets exactly
      const suggestion = LB.progressionSuggestion(store, entry.exId, session.dayId, entry.plannedReps, entry.plannedRepsPerSet, last, entry.plannedRepsMax, entry.plannedProgressionOffset ?? null);
      const lastReps = prevSet ? LB.effReps(prevSet) : null;
      const refReps = suggestion
        ? (suggestion.reps ?? null)
        : lastReps != null
          ? (LB.progressionEnabled(store, entry?.plannedRepsMax, entry?.plannedProgressionOffset) ? lastReps + 1 : lastReps)
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
    recentCompleteRef.current[setIdx] = Date.now();
    lastCompleteRef.current = Date.now();
    if (extraPatch) { setLpTarget(null); setLpCount(0); }
    _log(`completeSet(${setIdx}) → lastCompleteRef stamped`);

    // Build the done patch inside the functional updater so we can read the
    // latest queued session state and take the max of ref value vs. session
    // value. This wins regardless of which kbApply calls have flushed yet.
    updateSession(sess => {
      const currSet = sess.entries[exIdx]?.sets[setIdx];
      if (!currSet) return sess;
      const patch = { done: true, ...extraPatch };
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
    // never reads as a jump or a decline. Includes the 5/3/1 built-in week 4.
    const isDeloadSession = store.statusMode === 'deload' || session.isDeload || is531DeloadSession;

    const progressionResult = (() => {
      if (isDeloadSession) return null;
      if (!LB.progressionEnabled(store, entry?.plannedRepsMax, entry?.plannedProgressionOffset)) return null;
      if (!updatedSets.filter(s => !s.warmup).every(s => s.done || s.skipped)) return null;
      const catCfg = exercise?.equipment ? (store.settings?.equipmentConfig?.[exercise.equipment] ?? {}) : {};
      // Mirror progressionSuggestion's fallback (store.js) — that's what actually
      // seeds next session's weight, so the toast must fire under the same
      // condition, not silently stay quiet just because no increment was configured.
      const increment = catCfg.increment ?? 2.5;
      // Index by true working-set position (warm-ups stripped, nothing else)
      // so progressionTargetForSet(i) lines up correctly — filtering skipped/
      // no-kg sets out before indexing (as this used to) shifts every later
      // set's target one slot whenever an earlier set was skipped, mirroring
      // the same bug store.js's progressionSuggestion had.
      const workingSets = updatedSets.filter(s => !s.warmup);
      if (!workingSets.some(s => !s.skipped && s.kg != null)) return null;
      const allHitTop = workingSets.every((s, i) => {
        if (s.skipped || s.kg == null) return true; // no data at this position — neither confirms nor blocks progression
        const reps = s.repsL != null ? Math.min(s.repsL ?? 0, s.repsR ?? 0) : (s.reps ?? 0);
        return reps >= (progressionTargetForSet(i) ?? 0);
      });
      if (!allHitTop) return null;
      const refKg = workingSets.find(s => !s.skipped && s.kg != null)?.kg;
      if (refKg == null) return null;
      const newKg = Math.round((refKg + increment) * 100) / 100;
      const nextKg = catCfg.maxKg ? Math.min(newKg, catCfg.maxKg) : newKg;
      return nextKg > refKg ? { exName: entry.name, currentKg: refKg, nextKg } : null;
    })();

    // Overlay precedence (one per completed set): PROGRESSION UNLOCKED > NEW
    // BEST > IMPROVEMENT > REGRESSION. NEW BEST fires when the set beats the
    // all-time e1RM record for this exercise — independent of smart
    // progression, max once per exercise. A first-ever set (no record yet) and
    // bodyweight sets (no kg) never count as a new best.
    // overlayHoldMs is the delay before the shared navigation below swaps to
    // the next exercise. We pull it well under each overlay's display time
    // (FLASH_NAV_DELAY_MS for the three flashes, PROGRESSION_NAV_DELAY_MS for
    // the longer progression toast) so the swap happens hidden behind the
    // still-opaque overlay and the next exercise is already there as it fades,
    // instead of jumping in only once the overlay fully clears. Every overlay
    // only ever schedules its own show/hide timers here; the navigation
    // decision happens exactly once, further down, in the superset-aware code
    // shared by every completion. (Previously PROGRESSION UNLOCKED ran a
    // separate, non-superset-aware navigate(1) on its own 4.8s timer that
    // could override wherever the superset flow had already moved the user
    // on to.)
    let overlayHoldMs = 0;
    if (progressionResult) {
      overlayHoldMs = PROGRESSION_NAV_DELAY_MS; // swap mid-overlay; the show/hide timers below keep their own 800ms + 4000ms
      setTimeout(() => {
        setProgressionUnlocked(progressionResult);
        setTimeout(() => setProgressionUnlocked(null), 4000);
      }, 800);
    } else if (!entry.sets[setIdx]?.warmup && !isDeloadSession) {
      const completed = entry.sets[setIdx];
      const cReps = LB.effReps(completed);
      const cE1rm = (completed?.kg != null && cReps != null && cReps > 0) ? LB.e1rm(completed.kg, cReps) : 0;
      const localBest = LB.bestE1rmForExercise(store, entry.exId, session.id);
      const priorBest = Math.max(localBest, remoteBestE1rmRef.current[entry.exId] || 0);
      const isNewBest = cE1rm > 0 && priorBest > 0 && cE1rm > priorBest && !newBestShownRef.current[entry.exId];
      if (isNewBest) {
        newBestShownRef.current[entry.exId] = true;
        setNewBestSet(true);
        overlayHoldMs = FLASH_NAV_DELAY_MS;
        setTimeout(() => setNewBestSet(false), 2500);
      } else if (isImprovement(completed, prevSet)) {
        setImprovedSet(true);
        overlayHoldMs = FLASH_NAV_DELAY_MS;
        setTimeout(() => setImprovedSet(false), 2500);
      } else {
        const anyImprovementBefore = entry.sets.slice(0, setIdx).some((s, k) => isImprovement(s, prevWorkingSetFor(k)));
        if (!anyImprovementBefore && isDecline(completed, prevSet) && store.settings?.showRegression !== false) {
          setRegressionSet(true);
          overlayHoldMs = FLASH_NAV_DELAY_MS;
          setTimeout(() => setRegressionSet(false), 2500);
        }
      }
    }
    finishSetNavigation(setIdx, updatedSets, overlayHoldMs, advanceFocus);
    // Last warmup set done → start 3-min rest, workout timer begins when rest expires
    if (isLastWarmupSet && !session.startedAt) {
      persistRestStart(Date.now(), 180);
    }
  };

  // Improvement / regression / new-best overlay — shared by finishDropSet,
  // finishMyoSet, and finishAv (three byte-identical copies before this).
  // completeSet keeps its own version since it additionally handles
  // PROGRESSION UNLOCKED precedence, which the technique finishers don't need.
  // firstSet is the technique's first/committed round ({kg, reps, ...}),
  // passed through as-is (not reconstructed) so isImprovement/isDecline see
  // exactly what they always did. Returns overlayHoldMs for finishSetNavigation.
  const flashOverlayForCompletedSet = (targetIdx, firstSet) => {
    const isDeloadSession = store.statusMode === 'deload' || session.isDeload || is531DeloadSession;
    let overlayHoldMs = 0;
    if (!entry.sets[targetIdx]?.warmup && !isDeloadSession && firstSet.kg != null && firstSet.reps > 0) {
      const prevWS = (last?.entry?.sets || []).filter(s => !s.warmup);
      const wIdx = entry.sets.slice(0, targetIdx + 1).filter(s => !s.warmup).length - 1;
      const prevSet = wIdx >= 0 ? prevWS[wIdx] : undefined;
      const cE1rm = LB.e1rm(firstSet.kg, firstSet.reps);
      const localBest = LB.bestE1rmForExercise(store, entry.exId, session.id);
      const priorBest = Math.max(localBest, remoteBestE1rmRef.current[entry.exId] || 0);
      const isNewBest = cE1rm > 0 && priorBest > 0 && cE1rm > priorBest && !newBestShownRef.current[entry.exId];
      if (isNewBest) {
        newBestShownRef.current[entry.exId] = true;
        setNewBestSet(true); overlayHoldMs = FLASH_NAV_DELAY_MS; setTimeout(() => setNewBestSet(false), 2500);
      } else if (isImprovement(firstSet, prevSet)) {
        setImprovedSet(true); overlayHoldMs = FLASH_NAV_DELAY_MS; setTimeout(() => setImprovedSet(false), 2500);
      } else {
        const anyImpBefore = entry.sets.slice(0, targetIdx).some((s, k) => {
          if (s.warmup) return false;
          const wk = entry.sets.slice(0, k + 1).filter(x => !x.warmup).length - 1;
          return isImprovement(s, wk >= 0 ? prevWS[wk] : undefined);
        });
        if (!anyImpBefore && isDecline(firstSet, prevSet) && store.settings?.showRegression !== false) {
          setRegressionSet(true); overlayHoldMs = FLASH_NAV_DELAY_MS; setTimeout(() => setRegressionSet(false), 2500);
        }
      }
    }
    return overlayHoldMs;
  };

  const finishDropSet = async (rawDrops) => {
    // Silently drop any incomplete row (missing reps, or missing kg unless
    // no-weight-reps/bodyweight) instead of saving it — e.g. an ADD DROP
    // row added by accident and never filled in. Centralized here (not
    // just at the Sheet's own FINISH button) since checkSet() below can
    // also reach this directly.
    const drops = rawDrops.filter(d => !!d.reps && (isNoWeightReps || isBodyweight || d.kg != null));
    if (dropSetIdx == null) return;
    // A "drop set" with no actual drop beyond the top set isn't a drop set
    // — the FINISH button stays tappable (not disabled) specifically so
    // this explains why instead of just doing nothing.
    if (drops.length < 2) {
      await confirm("You did a Drop Set... without a drop? Bold strategy. Add one, or just log this as a normal set.", { title: 'No Drop, No Drop Set', ok: 'Got it', cancel: null });
      return;
    }
    // Optional finisher: partials tacked onto the last drop's failure point.
    const finalDrops = finisherPartials > 0
      ? drops.map((d, i) => i === drops.length - 1 ? { ...d, partials: finisherPartials } : d)
      : drops;
    const first = finalDrops[0];
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
          drops: finalDrops,
        }),
      }),
    }));
    setFlashSet(dropSetIdx);
    setTimeout(() => setFlashSet(null), 1400);
    kbFieldRef.current = null; kbRawRef.current = ''; setKbField(null); setKbRaw('');
    // Stamp the same ghost-click guards completeSet uses — without these, an
    // iOS ghost-click landing 200-400ms after this drop-set finished would
    // read as an intentional uncheck (no recent-completion timestamp to
    // block it against) and undo the set.
    armKbShield();
    recentCompleteRef.current[dropSetIdx] = Date.now();
    lastCompleteRef.current = Date.now();
    const targetIdx = dropSetIdx;
    setDropSetIdx(null);
    setFinisherPartials(0);
    const overlayHoldMs = flashOverlayForCompletedSet(targetIdx, first);
    // Rest timer + navigation — same superset-aware logic as completeSet, so
    // a drop-set finishing a round correctly jumps to the partner instead of
    // the plain navigate(1) this used to do regardless of grouping.
    const updatedSets = entry.sets.map((st, k) => k === targetIdx ? { ...st, done: true } : st);
    finishSetNavigation(targetIdx, updatedSets, overlayHoldMs, true);
  };

  const cancelMyo = () => {
    setMyoSetIdx(null); setMyoDrops([]); setMyoTechnique(null); setMyoTarget(null); setFinisherPartials(0);
    kbFieldRef.current = null; kbRawRef.current = ''; kbFreshRef.current = false;
    setKbField(null); setKbRaw(''); setKbFresh(false);
  };

  const finishMyoSet = async (rawDrops, technique) => {
    // Silently drop any incomplete mini-set instead of saving it (see
    // finishDropSet) — still needs the activation plus at least one
    // completed mini-set to count as an actual myo-reps set. FINISH stays
    // tappable (not disabled) specifically so this can explain why instead
    // of just doing nothing.
    const drops = rawDrops.filter(d => d.reps != null && (isNoWeightReps || isBodyweight || d.kg != null));
    if (myoSetIdx == null) return;
    if (drops.length < 2) {
      const label = technique === 'myorep_match' ? 'Myo Rep Match' : 'Myo-Reps';
      await confirm(`${label} without any myo sets? That's just a regular set. Add one, or just log it normally.`, { title: 'No Myo, No Myo-Reps', ok: 'Got it', cancel: null });
      return;
    }
    // Optional finisher: partials tacked onto the last mini's failure point.
    const finalDrops = finisherPartials > 0
      ? drops.map((d, i) => i === drops.length - 1 ? { ...d, partials: finisherPartials } : d)
      : drops;
    const first = finalDrops[0];
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
          drops: finalDrops,
        }),
      }),
    }));
    setFlashSet(myoSetIdx);
    setTimeout(() => setFlashSet(null), 1400);
    kbFieldRef.current = null; kbRawRef.current = ''; setKbField(null); setKbRaw('');
    // Stamp the same ghost-click guards completeSet uses (see finishDropSet).
    armKbShield();
    recentCompleteRef.current[myoSetIdx] = Date.now();
    lastCompleteRef.current = Date.now();
    const targetIdx = myoSetIdx;
    setMyoSetIdx(null); setMyoTechnique(null); setMyoDrops([]); setMyoTarget(null); setFinisherPartials(0);
    const overlayHoldMs = flashOverlayForCompletedSet(targetIdx, first);
    // Same superset-aware navigation as completeSet/finishDropSet — a myo-rep
    // finishing a round jumps to the partner instead of a plain navigate(1).
    const updatedSets = entry.sets.map((st, k) => k === targetIdx ? { ...st, done: true } : st);
    finishSetNavigation(targetIdx, updatedSets, overlayHoldMs, true);
  };

  // Commits the set exactly like completeSet, plus the technique/partials
  // count chosen via the stepper — both land in the same session update, so
  // there's no window (crash, background, navigation) where the set is done
  // but the chosen partials count wasn't recorded yet.
  const finishLengthenedPartial = async (setIdx) => {
    // Lengthened Partials with zero partials isn't lengthened partials — it's
    // just the set. FINISH stays tappable even at 0 (see finishDropSet) so
    // this can explain why instead of silently tagging the set with a
    // technique nothing was actually done for.
    if (lpCount === 0) {
      await confirm("Lengthened Partials with zero partials? That's just a regular set. Add some, or cancel and check it off normally.", { title: 'No Partials, No Lengthened Partials', ok: 'Got it', cancel: null });
      return;
    }
    completeSet(setIdx, false, true, { technique: 'lengthened_partial', drops: { partials: lpCount } });
  };

  const finishAv = async (rawDrops) => {
    // Silently drop any incomplete round instead of saving it (see
    // finishDropSet).
    const drops = rawDrops.filter(d => !!d.reps && (isNoWeightReps || isBodyweight || d.kg != null));
    if (avSetIdx == null) return;
    // AMRAP Variations with only the first round isn't a variation — FINISH
    // stays tappable (not disabled) specifically so this can explain why.
    if (drops.length < 2) {
      await confirm("AMRAP Variations with just one round? That's just an AMRAP. Add a variation, or log it as one.", { title: 'No Variation, No Variations', ok: 'Got it', cancel: null });
      return;
    }
    // Optional finisher: partials tacked onto the last round's failure point.
    const finalDrops = finisherPartials > 0
      ? drops.map((d, i) => i === drops.length - 1 ? { ...d, partials: finisherPartials } : d)
      : drops;
    const first = finalDrops[0];
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((en, ei) => ei !== exIdx ? en : {
        ...en,
        sets: en.sets.map((st, si) => si !== avSetIdx ? st : {
          ...st,
          kg: first.kg,
          reps: first.reps,
          done: true,
          technique: 'amrap_variations',
          drops: finalDrops,
        }),
      }),
    }));
    setFlashSet(avSetIdx);
    setTimeout(() => setFlashSet(null), 1400);
    kbFieldRef.current = null; kbRawRef.current = ''; setKbField(null); setKbRaw('');
    // Stamp the same ghost-click guards completeSet uses (see finishDropSet).
    armKbShield();
    recentCompleteRef.current[avSetIdx] = Date.now();
    lastCompleteRef.current = Date.now();
    const targetIdx = avSetIdx;
    setAvSetIdx(null); setAvDrops([]); setFinisherPartials(0);
    const overlayHoldMs = flashOverlayForCompletedSet(targetIdx, first);
    // Same superset-aware navigation as completeSet/finishDropSet/finishMyoSet.
    const updatedSets = entry.sets.map((st, k) => k === targetIdx ? { ...st, done: true } : st);
    finishSetNavigation(targetIdx, updatedSets, overlayHoldMs, true);
  };

  // Drop Set / Myo-Rep(-Match) / AMRAP Variations share one editing sheet
  // (IntensityChainSheet, rendered near the Intensity picker below) — at most
  // one is ever open at a time. "Dirty" means losing it on discard would
  // actually lose real work: more than the starting round, or a partials
  // count already set. A single un-added activation kg/reps tweak doesn't
  // count — canceling never touches the underlying set's own kg/reps/done
  // (those are only written by finishDropSet/finishMyoSet/finishAv), so that
  // alone is always a lossless cancel.
  const activeChainDirty = () => {
    if (dropSetIdx != null) return dropDrops.length > 1 || finisherPartials > 0;
    if (myoSetIdx != null) return myoDrops.length > 1 || finisherPartials > 0;
    if (avSetIdx != null) return avDrops.length > 1 || finisherPartials > 0;
    return false;
  };
  const confirmDiscardChain = async () => {
    if (!activeChainDirty()) return true;
    return await confirm('Your progress on this set won\'t be saved.', { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true });
  };
  const closeChainSheet = () => {
    if (dropSetIdx != null) { setDropSetIdx(null); setDropDrops([]); setFinisherPartials(0); }
    else if (myoSetIdx != null) { cancelMyo(); return; }
    else if (avSetIdx != null) { setAvSetIdx(null); setAvDrops([]); setFinisherPartials(0); }
    kbFieldRef.current = null; kbRawRef.current = ''; setKbField(null); setKbRaw('');
  };
  const requestCloseChainSheet = async () => {
    if (!await confirmDiscardChain()) return;
    closeChainSheet();
  };
  // Guards the training header's home button — otherwise it navigates away
  // unconditionally, silently discarding an in-progress chain sheet along
  // with the rest of the (unmounted) training screen.
  const requestGoHome = async () => {
    if (!await confirmDiscardChain()) return;
    closeChainSheet();
    go({ name: 'home' });
  };

  const addSet = () => {
    updateSession(sess => {
      const group = sess.entries[exIdx]?.supersetGroup;
      return {
        ...sess,
        // Superset/giant-set partners must keep matching working-set counts
        // — finishSetNavigation's round-matching indexes every member's
        // working sets by position — so add to every member, not just the
        // one the user is looking at.
        entries: sess.entries.map((e, i) => {
          if (i !== exIdx && !(group && e.supersetGroup === group)) return e;
          const ex = LB.findExercise(store, e.exId);
          const uni = (ex?.movement_type ?? (ex?.unilateral ? 'unilateral' : 'bilateral')) === 'unilateral';
          const bwKg = LB.shouldPullBodyweight(ex) ? LB.latestBodyweight(store) : null;
          const last = e.sets[e.sets.length - 1];
          const newSet = uni
            ? { kg: last?.kg ?? bwKg ?? null, repsL: last?.repsL ?? null, repsR: last?.repsR ?? null, done: false }
            : { kg: last?.kg ?? bwKg ?? null, reps: last?.reps ?? null, done: false };
          return { ...e, sets: [...e.sets, newSet] };
        }),
      };
    });
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
    const group = entry.supersetGroup;
    const members = group ? session.entries.filter(e => e.supersetGroup === group) : [entry];
    // Superset/giant-set partners must keep matching working-set counts (see
    // addSet) — refuse if any member is already down to its last working
    // set, rather than let counts diverge.
    if (members.some(e => e.sets.filter(s => !s.warmup).length <= 1)) return;
    if (!await confirm(`Remove set ${workingSets.length}?`, { ok: 'Remove', danger: true })) return;
    updateSession(sess => {
      const grp = sess.entries[exIdx]?.supersetGroup;
      return {
        ...sess,
        entries: sess.entries.map((e, i) => {
          if (i !== exIdx && !(grp && e.supersetGroup === grp)) return e;
          const eWorkingSets = e.sets.map((s, k) => ({ s, k })).filter(({ s }) => !s.warmup);
          const lastWorking = eWorkingSets[eWorkingSets.length - 1];
          return lastWorking ? { ...e, sets: e.sets.filter((_, k) => k !== lastWorking.k) } : e;
        }),
      };
    });
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

  // Shared by cardio (log/skip) and "Check all sets" — both complete an
  // entire entry in one shot rather than set-by-set like completeSet/
  // finishSetNavigation, so there's no per-round index to match against a
  // superset/giant-set partner. Jump to whichever partner still has open
  // work instead of blindly advancing past the whole group (schedule-defined
  // supersets can include cardio — only mid-session linking excludes it).
  // Returns false (does nothing) when the entry isn't grouped, so callers
  // keep their own standalone navigation/rest timing.
  const advanceIntoGroupOrPartner = (jumpDelayMs) => {
    const group = entry.supersetGroup;
    if (!group) return false;
    const isDone = (e) => e.isCardio ? e.cardioDone : (e.sets || []).filter(s => !s.warmup).every(s => s.done || s.skipped);
    const partners = session.entries.map((e, i) => ({ e, i })).filter(({ e, i }) => e.supersetGroup === group && i !== exIdx);
    const nextPartner = partners.find(({ e }) => !isDone(e));
    if (nextPartner) {
      setTimeout(() => updateSession(sess => ({ ...sess, currentExIdx: nextPartner.i })), jumpDelayMs);
      return true;
    }
    persistRestStart(Date.now(), restDef);
    const lastGroupIdx = Math.max(...session.entries.map((e, i) => e.supersetGroup === group ? i : -1));
    setTimeout(() => {
      if (lastGroupIdx + 1 >= session.entries.length) setFinishOpen(true);
      else updateSession(sess => ({ ...sess, currentExIdx: lastGroupIdx + 1 }));
    }, 600);
    return true;
  };

  const checkSet = () => {
    const idx = entry.sets.findIndex(s => !s.done && !s.skipped);
    if (idx < 0) return;
    if (dropSetIdx === idx) { finishDropSet(dropDropsRef.current); return; }
    if (myoSetIdx === idx) { finishMyoSet(myoDropsRef.current, myoTechnique); return; }
    if (lpTarget?.exIdx === exIdx && lpTarget?.setIdx === idx) { finishLengthenedPartial(idx); return; }
    if (avSetIdx === idx) { finishAv(avDropsRef.current); return; }
    completeSet(idx, false, true);
  };

  const logCardio = () => {
    const dur = parseInt(cardioForm.duration, 10);
    if (!dur || dur <= 0) return;
    const distM = cardioForm.distance ? LB.distToM(cardioForm.distance, cardioForm.distUnit) : null;
    const data = { type: cardioForm.type.trim() || null, durationMinutes: dur, distanceM: distM, paceFeeling: cardioForm.paceFeeling, effort: cardioForm.effort };
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx ? { ...e, cardioDone: true, cardioData: data } : e),
    }));
    // cardioLogs rows are only materialized at session finish (see `finish`),
    // but PRs read the same shape early so the flash fires the moment the
    // activity is actually logged, matching the home-tab quick-log/finish-flow
    // cardio PR overlay instead of never checking at all.
    const pr = LB.detectCardioPRs({ id: '__pending__', date: session.date, ...data }, store.cardioLogs);
    if (pr) setCardioPR(pr);
    if (!advanceIntoGroupOrPartner(300)) setTimeout(() => navigate(1), 300);
  };

  const skipCardio = () => {
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx ? { ...e, cardioDone: true, cardioData: null } : e),
    }));
    if (!advanceIntoGroupOrPartner(300)) navigate(1);
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
    // Unlike playBeep's own try/catch, construction here was unguarded — a
    // browser without AudioContext support (or one that throws on resume)
    // would leave tempoActive stuck true with no audio/visual cadence ever
    // starting.
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    } catch (_) {
      setTempoActive(false);
      return;
    }
    const ctx = audioCtxRef.current;
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
    // Skip the whole meso completion/gains flow for a deload session — a deload
    // is recovery, not a meso week. The meso week counter is frozen at the peak
    // (>= weeks) throughout the deload, so without this guard every deload
    // session finish would re-fire "Mesocycle complete!" and re-increment
    // completions. The meso state was already flushed by the session that
    // actually completed the block.
    if (mesoState && !isMesoDeloadSession) {
      const isComplete = mesoWeek != null && mesoState?.weeks != null && mesoWeek >= mesoState.weeks;
      // Number of the NEXT block to offer, captured here where mesoState is
      // reliably the just-completed block (completions not yet incremented):
      // completions is the count of blocks BEFORE this one, so the block that
      // just finished is completions+1 and the next is completions+2. Read from
      // a ref by handleMesoComplete, which is reached from two paths (direct and
      // via the gain sheet's onClose) whose mesoState freshness differs.
      if (isComplete) mesoNextNumRef.current = (mesoState.completions ?? 0) + 2;
      const gains = computeMesoGains(isComplete); // also flushes final meso state to store
      if (gains.length > 0) {
        mesoGainNavRef.current = session.id;
        setMesoGainItems(gains);
        mesoJustCompletedRef.current = isComplete;
        setMesoGainSheetOpen(true);
        return;
      }
      if (isComplete) {
        mesoJustCompletedRef.current = false;
        handleMesoComplete();
        return;
      }
    }
    go({ name: 'session', sessionId: session.id, justFinished: true });
  };

  const abandon = async () => {
    if (!await confirm('All inputs will be lost.', { title: 'Cancel session?', ok: 'Cancel', cancel: 'Keep training', danger: true })) return;
    cancelPushover();
    try { localStorage.removeItem(MESO_ASKED_KEY + session.id); } catch {}
    // Discard this session's in-progress meso feedback too. Every feedback answer
    // writes a GROWING delta into the MESO_KEY localStorage cache (commitContrib
    // adds on top of the inherited value), and getMesoState prefers that cache
    // over the store whenever its updatedAt is newer. The store copy is only ever
    // written by flushMesoStateToStore (clean finish), never during a session, so
    // it still holds the correct pre-session delta. Without clearing the cache an
    // abandoned session's delta survives and compounds on every cancel+restart
    // (base+1 -> base+2 -> ...). Mirror the exact cleanup a clean finish does.
    if (session.scheduleId) {
      try { localStorage.removeItem(MESO_KEY + '-' + session.scheduleId); } catch {}
      try { localStorage.removeItem(MESO_KEY); } catch {} // old single-key format
    }
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
    // Superset connectors ("⟷") are interspersed as siblings between grouped
    // chips, so :nth-child(exIdx+1) drifted from the real chip position as
    // soon as any connector rendered before it — data-ex-idx addresses the
    // chip directly regardless of how many connectors sit in between.
    const chip = row.querySelector(`[data-ex-idx="${exIdx}"]`);
    if (!chip) return;
    const target = chip.offsetLeft - row.offsetWidth / 2 + chip.offsetWidth / 2;
    row.scrollLeft = target;
  }, [exIdx]);

  // chip drag-to-reorder — uses the shared horizontal drag hook from ui.jsx
  const chipDragReorderRef = UI.useDragReorderH({ longPressMs: 600,
    onReorder: (from, to) => {
      updateSession(sess => {
        const result = reorderSessionEntries(sess.entries, sess.currentExIdx || 0, from, to);
        // Reject rather than silently corrupt: a drag that would split an
        // existing superset/giant-set apart is simply ignored.
        if (!groupsContiguous(result.entries)) return sess;
        return { ...sess, ...result };
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
        // Both push edge functions clamp delaySeconds to 3600 (MAX_DELAY)
        // server-side — matching it here so a very long rest (repeated +30s
        // extensions can add up) doesn't fire early against the server's
        // silent truncation while the client still thinks the full delay
        // was scheduled.
        const delaySeconds = Math.min(3600, Math.round(Math.max(0, val + def * 1000 - Date.now()) / 1000));
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
  // The 250ms `now` poll that re-rendered this whole screen 4x/second is gone.
  // The session clock ticks inside the <SessionClock> leaf; the rest countdown
  // inside <RestGauge>; the rest-expiry side effect runs off a setTimeout (see
  // the restExpired block further below). Only three things read the old poll:
  // the clock, the rest displays, and the pace bar (now Date.now()).
  const cat = exercise?.category;
  const restDef = cat === 'big'    ? (store.settings?.restBig    || 180)
                : cat === 'medium' ? (store.settings?.restMedium || 120)
                : cat === 'small'  ? (store.settings?.restSmall  || 90)
                :                    (store.settings?.restDefault || 120);
  // Use the duration snapshotted when the timer started, not the current exercise's category
  const activeRestDef = (restStart !== null && restDuration !== null) ? restDuration : restDef;
  // restElapsed/restRemaining/restPct moved into the <RestGauge> leaf; the
  // beep/auto-open side effect moved to the restExpired setTimeout below.

  const [flashSet, setFlashSet] = useStateT(null);
  const [improvedSet, setImprovedSet] = useStateT(false);
  const [regressionSet, setRegressionSet] = useStateT(false);
  const [newBestSet, setNewBestSet] = useStateT(false);
  const newBestShownRef = useRefT({}); // exId → true once a NEW BEST flashed (max once per exercise per session)
  const [cardioPR, setCardioPR] = useStateT(null);
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
  const [lpTarget, setLpTarget] = useStateT(null); // { exIdx, setIdx } | null — set is NOT done yet, replaces its checkbox with a stepper + FINISH button
  const [lpCount, setLpCount] = useStateT(0); // in-progress partials count for lpTarget, committed to the set only on Finish
  const [avSetIdx, setAvSetIdx] = useStateT(null);
  const [avDrops, setAvDrops] = useStateT([]); // [{ kg, reps, label }, ...] — AMRAP Variations rounds
  const [avLabelFocusDi, setAvLabelFocusDi] = useStateT(null); // which round's variation-name box is focused (native text input, accent underline)
  const avDropsRef = useRefT([]);
  avDropsRef.current = avDrops;
  // Shared across Drop Set / Myo-Rep / Myo-Rep Match / AMRAP Variations — only
  // one of those is ever in flight at a time, so one counter suffices. Applied
  // to the last round's drops entry on Finish; 0 = no-op, nothing written.
  const [finisherPartials, setFinisherPartials] = useStateT(0);
  // Which (exIdx_setIdx) working sets the beyond-failure meso auto-armed the
  // Lengthened Partials stepper on, so it arms each set exactly once — a user
  // who cancels the auto-prescribed partials on a set isn't re-nagged by a
  // re-firing effect.
  const mesoLpArmedRef = useRefT(new Set());
  // Persist intensity state so a background/resume on iOS doesn't wipe mid-set
  // progress. This effect runs before the restore effect below on every fresh
  // mount (declaration order), so on mount state is still all-null — without
  // skipFirstClearRef, that first run would always wipe localStorage via the
  // else branch a split second before the restore effect gets to read it,
  // permanently defeating restoration across any navigate-away-and-back.
  const skipFirstClearRef = useRefT(true);
  useEffectT(() => {
    if (dropSetIdx != null || myoSetIdx != null || lpTarget != null || avSetIdx != null) {
      try {
        localStorage.setItem('logbook-intensity-state', JSON.stringify({
          sessionId, exIdx,
          dropSetIdx, dropDrops,
          myoSetIdx, myoDrops, myoTechnique, myoTarget,
          lpSetIdx: lpTarget?.setIdx ?? null, lpCount,
          avSetIdx, avDrops,
          finisherPartials,
        }));
      } catch {}
    } else if (!skipFirstClearRef.current) {
      localStorage.removeItem('logbook-intensity-state');
    }
    skipFirstClearRef.current = false;
  }, [dropSetIdx, dropDrops, myoSetIdx, myoDrops, myoTechnique, myoTarget, lpTarget, lpCount, avSetIdx, avDrops, finisherPartials, sessionId, exIdx]);
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
        setFinisherPartials(st.finisherPartials || 0);
      }
      if (st.myoSetIdx != null && !targetEntry?.sets[st.myoSetIdx]?.done) {
        setMyoSetIdx(st.myoSetIdx);
        const md = st.myoDrops || [];
        setMyoDrops(md); myoDropsRef.current = md;
        setMyoTechnique(st.myoTechnique || null);
        setMyoTarget(st.myoTarget ?? null);
        setFinisherPartials(st.finisherPartials || 0);
      }
      // The set only ever gets marked done via the dedicated FINISH button
      // (which commits technique+drops in the same update), so — like
      // drop/myo — there is nothing left to resume once the set is done.
      if (st.lpSetIdx != null && !targetEntry?.sets[st.lpSetIdx]?.done) {
        setLpTarget({ exIdx, setIdx: st.lpSetIdx });
        setLpCount(st.lpCount || 0);
      }
      if (st.avSetIdx != null && !targetEntry?.sets[st.avSetIdx]?.done) {
        setAvSetIdx(st.avSetIdx);
        const ad = st.avDrops || [];
        setAvDrops(ad); avDropsRef.current = ad;
        setFinisherPartials(st.finisherPartials || 0);
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
  const addAndJumpRef = useRefT(false); // set to true when adding via the finish-dialog button
  const [supersetLinkData, setSupersetLinkData] = useStateT(null); // null | {} | { picking: true } — mirrors addSupersetData's shape
  const [supersetNewPickerOpen, setSupersetNewPickerOpen] = useStateT(false);
  const [avgStats, setAvgStats] = useStateT(null);
  const [tempoActive, setTempoActive] = useStateT(false);
  const [outlierConfirm, setOutlierConfirm] = useStateT(null);

  // ── Mesocycle state ─────────────────────────────────────────────────────────
  // Init from store (DB-loaded, cross-device) with localStorage fallback for
  // in-progress sessions. Old format (planId field) is handled by getMesoState.
  const [mesoState, setMesoStateLocal] = useStateT(() =>
    getMesoState(session.scheduleId, store.mesoStates)
  );
  // Write meso state: localStorage for instant in-session persistence, store sync
  // happens at session end via flushMesoStateToStore().
  const saveMesoState = (updater) => {
    setMesoStateLocal(prev => {
      const applied = typeof updater === 'function' ? updater(prev) : updater;
      // Stamp updatedAt on every in-session write — getMesoState's "pick the
      // newer of store vs localStorage" comparison (and the sync RPC's
      // staleness guard) only works if the localStorage copy's updatedAt
      // actually advances past whatever it inherited at session start.
      const next = applied ? { ...applied, updatedAt: new Date().toISOString() } : applied;
      if (next) saveMesoStateToStorage(next);
      return next;
    });
  };
  // Flush final meso state to the store (triggers DB sync via syncStore).
  // Called at session end so cross-device sync happens once per session, not per answer.
  const flushMesoStateToStore = (finalState) => {
    if (!finalState?.scheduleId) return;
    const stamped = { ...finalState, updatedAt: new Date().toISOString() };
    setStore(s => {
      const others = (s.mesoStates || []).filter(m => m.scheduleId !== stamped.scheduleId);
      return { ...s, mesoStates: [...others, stamped] };
    });
    // Clean up old localStorage keys after successful flush
    try { localStorage.removeItem(MESO_KEY + '-' + finalState.scheduleId); } catch {}
    try { localStorage.removeItem(MESO_KEY); } catch {} // old single-key format
    try { localStorage.removeItem(MESO_ASKED_KEY + session.id); } catch {}
  };
  // Memoized on everything mesoCurrentWeek reads (it filters all sessions twice
  // for meso plans) plus a per-day token so the date-based week still advances at
  // midnight — without this it recomputed on every 250ms tick for meso users.
  const mesoWeek = useMemoT(() => (mesoState ? mesoCurrentWeek(mesoState, store) : null), [mesoState, store.schedules, store.cycleIndex, store.sessions, store.statusPeriods, LB.todayISO()]);
  const mesoSch = mesoState ? store.schedules?.find(s => s.id === mesoState.scheduleId) : null;
  const mesoStartRir = mesoSch?.mesocycle_start_rir ?? 3;
  const mesoEndRir = mesoSch?.mesocycle_end_rir ?? 0;
  // RIR taper can be switched off per plan — then there's no weekly RIR target
  // (null), which also suppresses the negative-RIR partials prescription below.
  const mesoRirVal = (mesoWeek != null && mesoState?.weeks != null && LB.mesoRirEnabled(mesoSch)) ? LB.mesoRirForWeek(mesoWeek, mesoState.weeks, mesoStartRir, mesoEndRir) : null;
  // Final meso week: set-count deltas (and the growth/decline rotation feeding
  // them) are frozen. A set change written now can never reach a later session
  // in this block AND is wiped by the Meso-2 baseline reset anyway, so
  // collecting it is pure waste. Weight boosts still accrue (they carry into
  // Meso 2), so the joint + pump/volume questions stay — they gate the boost —
  // while the soreness question (pure set-delta, no weight gate) is skipped.
  const mesoLastWeek = mesoState != null && mesoWeek != null && mesoState.weeks != null && mesoWeek >= mesoState.weeks;
  // Beyond-failure block: a negative RIR target prescribes |RIR| lengthened
  // partials on every working set this session (RIR -3 → 3 partials). Auto-
  // attached at set completion / seeded into the intensity-chain finisher.
  // (isMesoDeloadSession is declared further down, so inline the deload check
  // here to avoid a temporal-dead-zone reference.)
  const mesoPartials = (mesoRirVal != null && !(store.statusMode === 'deload' || session.isDeload)) ? Math.max(0, -mesoRirVal) : 0;
  const [mesoGainSheetOpen, setMesoGainSheetOpen] = useStateT(false);
  const [mesoGainItems, setMesoGainItems] = useStateT([]);
  const mesoGainNavRef = useRefT(null);
  const mesoJustCompletedRef = useRefT(false); // set when last meso week finished
  const mesoNextNumRef = useRefT(2); // number of the next block to offer ("Start Meso N")

  const startMeso2ForSchedule = (scheduleId) => {
    const existing = (store.mesoStates || []).find(m => m.scheduleId === scheduleId);
    if (!existing) return;
    const sch2 = store.schedules?.find(sc => sc.id === scheduleId);
    const isWd = sch2 ? LB.isWeekdayPlan(sch2) : false;
    const isFlex2 = sch2 ? LB.isFlexPlan(sch2) : false;
    const daysLen2 = sch2?.days?.length || 1;
    const ci = store.cycleIndex || 0;
    let startDate2, startCycleIndex2;
    if (isWd) {
      startDate2 = LB.nextMondayISO();
      startCycleIndex2 = existing.startCycleIndex ?? 0;
    } else if (isFlex2) {
      startCycleIndex2 = ci % daysLen2 === 0 ? ci : Math.ceil(ci / daysLen2) * daysLen2;
      startDate2 = LB.todayISO();
    } else {
      startDate2 = LB.nextCycleD1ISOFromSchedule(sch2, store.cycleStartDate);
      startCycleIndex2 = 0;
    }
    const newMeso = {
      ...existing,
      startDate: startDate2,
      startCycleIndex: startCycleIndex2,
      deltas: {},
      jointFlags: {},
      pumpLowCounts: {},
      growthCounts: {},
      pendingMeso2: false,
      // weightBoosts carries over to meso 2
      startedAt: new Date().toISOString(), // fresh block-start anchor (flex week count)
      updatedAt: new Date().toISOString(),
    };
    // Keep the per-plan localStorage cache in sync with the store (getMesoState
    // picks the newer of the two by updatedAt) so the stale Meso-1 cache can't
    // keep winning on the home strip after Meso 2 starts.
    saveMesoStateToStorage(newMeso);
    setMesoStateLocal(newMeso);
    setStore(s => ({ ...s, mesoStates: [...(s.mesoStates || []).filter(m => m.scheduleId !== scheduleId), newMeso] }));
  };

  const continueAsCycle = (scheduleId) => {
    setStore(s => ({
      ...s,
      schedules: s.schedules.map(sc =>
        sc.id === scheduleId ? { ...sc, mesocycle_weeks: null } : sc
      ),
      mesoStates: (s.mesoStates || []).map(m =>
        m.scheduleId === scheduleId ? { ...m, pendingMeso2: false, updatedAt: new Date().toISOString() } : m
      ),
    }));
  };

  const deactivatePlanForMeso = (scheduleId) => {
    setStore(s => ({
      ...s,
      activeScheduleId: null,
      schedules: s.schedules.map(sc =>
        sc.id === scheduleId ? { ...sc, mesocycle_weeks: null } : sc
      ),
      mesoStates: (s.mesoStates || []).map(m =>
        m.scheduleId === scheduleId ? { ...m, pendingMeso2: false, updatedAt: new Date().toISOString() } : m
      ),
    }));
  };

  const handleMesoComplete = async () => {
    const scheduleId = session.scheduleId;
    const wantDeload = await confirm(
      'You crushed it — that\'s one full mesocycle done! A deload now helps you recover and come back even stronger. Want to start one?',
      { title: 'Mesocycle complete! 🎉', ok: 'Start deload', cancel: 'Skip deload', preventBackdropClose: true },
    );
    if (wantDeload) {
      await LB.startDeload(userId, store, setStore);
      // pendingMeso2 flag already set; home screen picks it up after deload ends.
      go({ name: 'session', sessionId: session.id, justFinished: true });
      return;
    }
    const nextNum = mesoNextNumRef.current;
    const wantMeso2 = await confirm(
      `Start Meso ${nextNum} with the same plan? Your earned weight boosts carry over — set counts reset to baseline so week 1 feels fresh again.`,
      { title: `Start Meso ${nextNum}?`, ok: `Start Meso ${nextNum}`, cancel: 'Skip', preventBackdropClose: true },
    );
    if (wantMeso2) {
      startMeso2ForSchedule(scheduleId);
      go({ name: 'session', sessionId: session.id, justFinished: true });
      return;
    }
    const keepActive = await confirm(
      'Keep the plan active as a regular cycle (no meso), or deactivate it?',
      { title: 'What\'s next?', ok: 'Continue as cycle', cancel: 'Deactivate plan', preventBackdropClose: true },
    );
    if (keepActive) {
      continueAsCycle(scheduleId);
    } else {
      deactivatePlanForMeso(scheduleId);
    }
    go({ name: 'session', sessionId: session.id, justFinished: true });
  };

  // Per-session meso feedback tracking
  const [mesoSorenessOpen, setMesoSorenessOpen] = useStateT(false);
  const [mesoSorenessMusc, setMesoSorenessMusc] = useStateT(null); // muscle group being asked
  const [mesoJointOpen, setMesoJointOpen] = useStateT(false);
  const [mesoJointExId, setMesoJointExId] = useStateT(null);
  const [mesoJointExName, setMesoJointExName] = useStateT(null);
  const [mesoJointPendingNav, setMesoJointPendingNav] = useStateT(false);
  const [mesoJointMuscle, setMesoJointMuscle] = useStateT(null);
  const mesoJointExIdxRef = useRefT(null);
  const [mesoVolumeOpen, setMesoVolumeOpen] = useStateT(false);
  const [mesoVolumeMusc, setMesoVolumeMusc] = useStateT(null);
  const [mesoVolumeExIds, setMesoVolumeExIds] = useStateT([]); // exId+dayId pairs for delta
  const [mesoPumpAnswer, setMesoPumpAnswer] = useStateT(null);
  const [mesoVolumeAnswer, setMesoVolumeAnswer] = useStateT(null);
  // Soreness/joint use a select-then-confirm step (like volume already did)
  // so a single mistap only highlights an option instead of committing it.
  const [mesoSorenessSel, setMesoSorenessSel] = useStateT(null);
  const [mesoJointSel, setMesoJointSel] = useStateT(null);
  // Editing an already-answered question reopens the same sheet prefilled;
  // these track which subject (muscle/exId) is currently being re-answered
  // vs. freshly asked for the first time (both paths call the same commit
  // handler — see handleSorenessAnswer/handleJointAnswer/handleVolumeAnswer).
  const mesoEditingRef = useRefT({ soreness: null, joint: null, volume: null });
  const [mesoRecapOpen, setMesoRecapOpen] = useStateT(false);
  // Session feedback is two levels: the top sheet lists one button per
  // muscle ("Chest feedback"); tapping it opens this detail sheet with the
  // muscle's individual answers (Soreness, each exercise's Joint, Pump &
  // Volume) to actually revise.
  const [mesoRecapDetailMuscle, setMesoRecapDetailMuscle] = useStateT(null);
  const mesoAskedInitRef = useRefT(null);
  if (mesoAskedInitRef.current === null) mesoAskedInitRef.current = loadMesoAskedSets(session.id);
  const askedSorenessRef = useRefT(mesoAskedInitRef.current.soreness);
  const askedJointRef = useRefT(mesoAskedInitRef.current.joint);
  const askedVolumeRef = useRefT(mesoAskedInitRef.current.volume);
  // Answer records for recap + editing, keyed by muscle (soreness/volume) or
  // exId (joint). Each record carries display metadata plus `contrib` (this
  // question's current per-key contribution to mesoState.deltas), so editing
  // an answer can diff old-vs-new instead of re-incrementing.
  const mesoAnswersRef = useRefT(mesoAskedInitRef.current.answers);
  const persistMesoAsked = () => saveMesoAskedSets(session.id, {
    soreness: askedSorenessRef.current, joint: askedJointRef.current, volume: askedVolumeRef.current,
    gains: mesoSessionSetGainsRef.current,
    answers: mesoAnswersRef.current,
    negOwner: mesoNegativeDeltaKeysRef.current,
  });
  // Per-session quality tracking for weight progression
  const mesoJointFineRef = useRefT(new Set());    // exIds where joint was 'fine'
  const mesoPumpOkRef = useRefT(new Set());        // muscles where pump was moderate/amazing
  const mesoVolumeOkRef = useRefT(new Set());      // muscles where volume was just_right/not_enough
  const mesoSessionSetGainsRef = useRefT(mesoAskedInitRef.current.gains); // key → { exId, name, delta } for set changes this session
  // Which question type currently "owns" the negative set-delta slot for a
  // key (exId_dayId) this session — key -> 'soreness'|'joint'|'volume'. Two
  // independent negative signals on the same key never stack past -1; the
  // owner releases the slot if its own answer is edited away from negative,
  // letting another question claim it. See commitContrib.
  const mesoNegativeDeltaKeysRef = useRefT(mesoAskedInitRef.current.negOwner);
  const isMesoDeloadSession = store.statusMode === 'deload' || session.isDeload;

  // Apply `newContrib` (key -> desired delta) as this question's current
  // contribution to mesoState.deltas, replacing whatever it contributed last
  // time (tracked in `record.contrib`) via a diff — so an edited answer never
  // compounds with its own earlier answer. Negative amounts additionally
  // respect mesoNegativeDeltaKeysRef ownership (suppressed to 0 if another
  // question type already owns that key's negative slot this session).
  // `namesByKey` supplies { name } for the "Next session" recap ledger.
  const commitContrib = (record, questionType, newContrib, namesByKey) => {
    // Frozen in the final week — no set delta is written and none is recorded
    // for the recap (weight boosts, handled separately in computeMesoGains,
    // still accrue). All three feedback questions funnel through here, so this
    // one guard freezes the whole set-delta system for the last week.
    if (mesoLastWeek) return;
    const prevContrib = record.contrib || {};
    const keys = new Set([...Object.keys(prevContrib), ...Object.keys(newContrib)]);
    const deltaPatch = {};
    const finalContrib = {};
    keys.forEach(key => {
      let want = newContrib[key] || 0;
      const owners = mesoNegativeDeltaKeysRef.current;
      if (want < 0) {
        const owner = owners[key];
        if (owner && owner !== questionType) want = 0; // another question owns this key's negative slot
        else owners[key] = questionType;
      }
      if (want >= 0 && owners[key] === questionType) delete owners[key];
      const diff = want - (prevContrib[key] || 0);
      if (diff !== 0) deltaPatch[key] = diff;
      finalContrib[key] = want;
    });
    if (Object.keys(deltaPatch).length) {
      saveMesoState(m => {
        const nd = { ...(m.deltas || {}) };
        Object.entries(deltaPatch).forEach(([key, diff]) => { nd[key] = ((m.deltas || {})[key] || 0) + diff; });
        return { ...m, deltas: nd };
      });
      Object.entries(deltaPatch).forEach(([key, diff]) => {
        const prevGain = mesoSessionSetGainsRef.current[key];
        const name = namesByKey?.[key] ?? prevGain?.name ?? record.exName ?? record.muscle;
        mesoSessionSetGainsRef.current[key] = { name, delta: (prevGain?.delta ?? 0) + diff };
      });
    }
    record.contrib = finalContrib;
  };
  // ────────────────────────────────────────────────────────────────────────────

  // ── Meso feedback handlers ─────────────────────────────────────────────────
  // Soreness, joint, and volume answers are all editable for the rest of the
  // session (see the "Session feedback" recap sheet below): each handler is
  // safe to call more than once for the same subject (muscle/exId) — the
  // second call is an edit, not a fresh answer, and commitContrib() reconciles
  // the difference instead of stacking a second contribution.
  const handleSorenessAnswer = (answer, muscle) => {
    setMesoSorenessOpen(false);
    setMesoSorenessSel(null);
    mesoEditingRef.current.soreness = null;
    if (!mesoState || !muscle) return;
    const record = mesoAnswersRef.current.soreness[muscle] || { muscle };
    // Resolve the target previous session ONCE — an edit reuses the exact
    // same candidate exercises rather than re-resolving (which could in
    // theory match a different session if training history changed).
    if (!record.resolved) {
      record.resolved = true;
      record.targets = [];
      const mesoStart = mesoState.startDate;
      const matchSessions = (store.sessions || [])
        .filter(s => s.ended && s.date >= mesoStart && s.scheduleId === session.scheduleId && s.id !== session.id)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      for (const prev of matchSessions) {
        const muscleEntries = (prev.entries || []).filter(e => {
          const ex2 = store.exercises?.find(x => x.id === e.exId);
          return primaryMuscleForExercise(ex2) === muscle;
        });
        if (!muscleEntries.length) continue;
        record.targets = muscleEntries.map(e => ({ exId: e.exId, name: e.name, key: e.exId + '_' + prev.dayId }));
        break;
      }
    }
    record.answer = answer;
    const namesByKey = {};
    const keys = [];
    record.targets.forEach(t => { namesByKey[t.key] = t.name; keys.push(t.key); });

    // Soreness carryover is a recovery signal, so it moves volume BOTH ways —
    // symmetric with the pump/volume question, not a one-directional "reduce"
    // check (too little soreness is just as much an off-MRV signal as too much):
    //   • never / healed a while ago → recovered easily = probably training
    //     below MRV → grant +1 set, rotated across the muscle group with the
    //     SAME LB.pickGrowthRecipient / growthCounts machinery the volume
    //     "not enough" grant uses. Sharing the pool keeps soreness- and
    //     volume-driven grants fair to each other and, since soreness is asked
    //     first, makes a second grant the same session (e.g. also "not enough")
    //     spread to a different exercise instead of piling +2 onto the main lift.
    //   • healed just in time → optimal recovery window → hold (no delta).
    //   • still sore → clear over-reach → shave a set off the currently
    //     MOST-grown exercise of the group (LB.pickDeclineRecipient, the same
    //     rotation-aware target the volume "pushed" signal uses, so decline
    //     never drains only the main lift into the floor). commitContrib's
    //     negative-slot ownership still stops it from double-stacking with a
    //     "pushed"/"too much" -1 on the same key.
    const adds = answer === 'never' || answer === 'healed_long';
    const prevGrantedTo = Object.keys(record.contrib || {}).find(k => record.contrib[k] === 1) ?? null;
    let recipientKey = null;
    if (adds && keys.length) {
      recipientKey = LB.pickGrowthRecipient(keys, mesoState.deltas, mesoState.growthCounts, prevGrantedTo).recipientKey;
      saveMesoState(m => ({ ...m, growthCounts: LB.pickGrowthRecipient(keys, m.deltas, m.growthCounts, prevGrantedTo).growthCounts }));
    } else if (prevGrantedTo) {
      // Edited away from an adding answer this session → undo the prior grant.
      saveMesoState(m => ({ ...m, growthCounts: LB.retractGrowthGrant(m.growthCounts, prevGrantedTo) }));
    }

    // "Still sore" trims the most-grown target (record.contrib = this record's
    // prior contribution, undone first so an edit re-decides cleanly).
    const declineKey = answer === 'still_sore'
      ? LB.pickDeclineRecipient(keys, mesoState.deltas, record.contrib)
      : null;

    const newContrib = {};
    record.targets.forEach((t) => {
      let want = 0;
      if (t.key === recipientKey) want = 1;
      else if (t.key === declineKey) want = -1;
      newContrib[t.key] = want;
    });
    commitContrib(record, 'soreness', newContrib, namesByKey);
    mesoAnswersRef.current.soreness[muscle] = record;
    persistMesoAsked();
  };

  const handleJointAnswer = (answer) => {
    setMesoJointOpen(false);
    setMesoJointSel(null);
    mesoEditingRef.current.joint = null;
    const exId = mesoJointExId;
    const muscle = mesoJointMuscle;
    if (!mesoState || !exId) return;

    if (answer === 'none') mesoJointFineRef.current.add(exId); else mesoJointFineRef.current.delete(exId);

    const record = mesoAnswersRef.current.joint[exId] || { exId };
    record.answer = answer;
    record.exName = mesoJointExName;
    record.muscle = muscle;
    // jointFlags is a persistent "causes joint pain" marker (survives across
    // sessions) — flagBaseline captures whatever it already was BEFORE this
    // session touched it, captured once, so editing back and forth within
    // this session never erases a flag some earlier session legitimately set.
    if (record.flagBaseline === undefined) record.flagBaseline = !!mesoState.jointFlags?.[exId];

    const key = exId + '_' + session.dayId;
    commitContrib(record, 'joint', { [key]: (answer === 'noticeable' || answer === 'sharp') ? -1 : 0 }, { [key]: mesoJointExName });

    const flagNow = record.flagBaseline || answer === 'sharp';
    saveMesoState(m => {
      const curFlag = !!(m.jointFlags || {})[exId];
      if (curFlag === flagNow) return m;
      return { ...m, jointFlags: { ...(m.jointFlags || {}), [exId]: flagNow } };
    });
    mesoAnswersRef.current.joint[exId] = record;
    persistMesoAsked();

    // Check if this was the last exercise for this muscle group → open pump/volume.
    // Unchanged from a fresh ask: if the muscle's volume sheet already fired
    // (askedVolumeRef), editing an earlier exercise's joint answer here just
    // returns without re-triggering it.
    if (!muscle || askedVolumeRef.current.has(muscle)) return;
    const idx = session.entries.findIndex(e => e.exId === exId);
    // exId no longer exists in this session (swapped out / removed via
    // doSwap/removeExercise since the original answer) — an edit reached via
    // the recap for a since-vanished exercise can't reason about "is this the
    // last exercise of the muscle group" from a position that no longer
    // exists, so skip the cascade entirely rather than falling back to
    // whatever exIdx the user happens to be viewing right now (that produced
    // a wrong, premature, and — since askedVolumeRef is one-shot —
    // irreversible trigger of the volume sheet for the wrong exercise set).
    if (idx < 0) return;
    mesoJointExIdxRef.current = idx;
    const currentIdx = idx;
    const isLastOfMuscle = !session.entries.slice(currentIdx + 1).some(e => {
      const ex2 = store.exercises?.find(x => x.id === e.exId);
      return primaryMuscleForExercise(ex2) === muscle;
    });
    if (!isLastOfMuscle) return;
    askedVolumeRef.current.add(muscle);
    persistMesoAsked();
    // Collect all exIds for this muscle group in this session
    const muscleExIds = session.entries
      .slice(0, currentIdx + 1)
      .filter(e => {
        const ex2 = store.exercises?.find(x => x.id === e.exId);
        return primaryMuscleForExercise(ex2) === muscle;
      })
      .map(e => e.exId);
    setMesoVolumeMusc(muscle);
    setMesoVolumeExIds(muscleExIds);
    setMesoPumpAnswer(null);
    setMesoVolumeAnswer(null);
    mesoEditingRef.current.volume = null;
    setMesoVolumeOpen(true);
  };

  const handleVolumeAnswer = (pump, volume) => {
    setMesoVolumeOpen(false);
    mesoEditingRef.current.volume = null;
    if (!mesoState || !mesoVolumeExIds.length) return;
    const muscle = mesoVolumeMusc;
    if (pump === 'moderate' || pump === 'amazing') mesoPumpOkRef.current.add(muscle); else mesoPumpOkRef.current.delete(muscle);
    if (volume === 'just_right' || volume === 'not_enough') mesoVolumeOkRef.current.add(muscle); else mesoVolumeOkRef.current.delete(muscle);

    const record = mesoAnswersRef.current.volume[muscle] || { muscle, exIds: mesoVolumeExIds };
    record.pump = pump;
    record.volume = volume;
    record.exIds = mesoVolumeExIds;

    // "Not enough" → rotates a +1 among the muscle group's exercises (see
    // LB.pickGrowthRecipient); "Pushed my limits" → -1 on the currently
    // MOST-grown exercise (LB.pickDeclineRecipient — mirror of the growth
    // rotation, so decline follows growth instead of always draining the main
    // lift into the floor); "Too much" → -1 on every exercise of the group.
    const mainExId = mesoVolumeExIds[0];
    const namesByKey = {};
    const keys = [];
    mesoVolumeExIds.forEach(exId => {
      const key = exId + '_' + session.dayId;
      keys.push(key);
      namesByKey[key] = session.entries.find(e => e.exId === exId)?.name || '';
    });

    // Growth rotation for "not_enough": whichever exercise still below its
    // own per-exercise ceiling (base+4, enforced separately by
    // applyMesoSetDeltaFromState) has the fewest growth grants so far this
    // meso wins (ties toward the main lift) — see LB.pickGrowthRecipient for
    // the full rule, including how a mid-meso exercise swap-in is seeded so
    // it can't cut ahead of an established lift. With only one exercise this
    // still always picks it — same outcome as before this feature existed —
    // except growth now correctly stops once that exercise hits its own
    // ceiling instead of letting the underlying counter climb unboundedly
    // past it forever (harmless before since only the clamped value was ever
    // applied, but this also means a later shrink is no longer silently
    // swallowed once the counter has drifted arbitrarily far past the cap).
    // growthCounts is kept separate from deltas specifically so an unrelated
    // shrink (soreness/joint) never distorts turn fairness; it is not frozen
    // by "too_much" shrinking deltas back down — that exercise simply becomes
    // eligible again once its delta drops back under the ceiling.
    // LB.pickGrowthRecipient is called twice on purpose: once here (using
    // `mesoState`) to decide `recipientKey` for the newContrib built below,
    // and again inside the saveMesoState updater (using the fresh `m`
    // parameter) for the actual write — so a rare double-invocation of this
    // handler before React re-renders can never silently lose a prior grant
    // by persisting a value computed from stale state. It's a pure,
    // deterministic function, so calling it twice with the same inputs is
    // cheap and safe.
    //
    // prevGrantedTo (which key, if any, this record's own last answer granted
    // a set to) is derived from record.contrib rather than a separately
    // tracked field — commitContrib already guarantees exactly one key ever
    // holds a contrib of 1 for this question type, so there's nothing to keep
    // in sync by hand.
    // Skip the whole growth/decline rotation in the final week — commitContrib
    // is frozen there, so bumping growthCounts would only drift the counter
    // (harmless since it resets at Meso 2, but pointless) with no delta to show
    // for it.
    const prevGrantedTo = Object.keys(record.contrib || {}).find(k => record.contrib[k] === 1) ?? null;
    let recipientKey = null;
    if (mesoLastWeek) {
      // frozen: no rotation, no grant
    } else if (volume === 'not_enough') {
      recipientKey = LB.pickGrowthRecipient(keys, mesoState.deltas, mesoState.growthCounts, prevGrantedTo).recipientKey;
      saveMesoState(m => ({ ...m, growthCounts: LB.pickGrowthRecipient(keys, m.deltas, m.growthCounts, prevGrantedTo).growthCounts }));
    } else if (prevGrantedTo) {
      // Answer changed away from not_enough this session — undo the previous grant.
      saveMesoState(m => ({ ...m, growthCounts: LB.retractGrowthGrant(m.growthCounts, prevGrantedTo) }));
    }

    // "Pushed" trims the most-grown exercise of the group. record.contrib is
    // this record's PRIOR contribution (commitContrib rewrites it below), so
    // pickDeclineRecipient undoes it first and an edit re-decides from the
    // true pre-answer deltas.
    const declineKey = volume === 'pushed'
      ? LB.pickDeclineRecipient(keys, mesoState.deltas, record.contrib)
      : null;

    const newContrib = {};
    keys.forEach((key) => {
      let want = 0;
      if (volume === 'too_much') want = -1;
      else if (key === recipientKey) want = 1;
      else if (key === declineKey) want = -1;
      newContrib[key] = want;
    });
    commitContrib(record, 'volume', newContrib, namesByKey);

    // Pump: if low on "just right" volume, track for swap suggestion — a
    // counter (not a flag), so an edit applies just the ±1 its own current
    // answer is responsible for, same idempotent-diff pattern as commitContrib.
    const pumpLowApplied = pump === 'low' && volume === 'just_right';
    const pumpLowDiff = (pumpLowApplied ? 1 : 0) - (record.pumpLowApplied ? 1 : 0);
    record.pumpLowApplied = pumpLowApplied;
    if (pumpLowDiff !== 0 && mainExId) {
      saveMesoState(m => ({
        ...m,
        pumpLowCounts: { ...(m.pumpLowCounts || {}), [mainExId]: Math.max(0, ((m.pumpLowCounts || {})[mainExId] || 0) + pumpLowDiff) },
      }));
    }
    mesoAnswersRef.current.volume[muscle] = record;
    persistMesoAsked();
  };

  // Reopen an already-answered sheet prefilled with the current answer so the
  // user can revise it — a mistap is no longer permanent. Only reachable from
  // the recap sheet (see mesoRecapGroups / the footer nav button below).
  const openSorenessEdit = (muscle) => {
    const record = mesoAnswersRef.current.soreness[muscle];
    if (!record) return;
    setMesoSorenessMusc(muscle);
    setMesoSorenessSel(record.answer);
    mesoEditingRef.current.soreness = muscle;
    setMesoRecapOpen(false);
    setMesoRecapDetailMuscle(null);
    setMesoSorenessOpen(true);
  };
  const openJointEdit = (exId) => {
    const record = mesoAnswersRef.current.joint[exId];
    if (!record) return;
    setMesoJointExId(exId);
    setMesoJointExName(record.exName);
    setMesoJointMuscle(record.muscle);
    setMesoJointSel(record.answer);
    mesoEditingRef.current.joint = exId;
    setMesoRecapOpen(false);
    setMesoRecapDetailMuscle(null);
    setMesoJointOpen(true);
  };
  const openVolumeEdit = (muscle) => {
    const record = mesoAnswersRef.current.volume[muscle];
    if (!record) return;
    // Drop any exId the exercise roster no longer has (swapped/removed since
    // the original answer) so an edit can't reapply a delta to a slot that
    // no longer means anything for this muscle group this session.
    const liveExIds = (record.exIds || []).filter(exId => session.entries.some(e => e.exId === exId));
    setMesoVolumeMusc(muscle);
    setMesoVolumeExIds(liveExIds);
    setMesoPumpAnswer(record.pump);
    setMesoVolumeAnswer(record.volume);
    mesoEditingRef.current.volume = muscle;
    setMesoRecapDetailMuscle(null);
    setMesoRecapOpen(false);
    setMesoVolumeOpen(true);
  };
  const SORENESS_LABELS = { never: 'Never sore', healed_long: 'Healed a while ago', healed_just: 'Healed just in time', still_sore: 'Still sore', very_sore: 'Very sore' };
  const JOINT_LABELS = { none: 'None', noticeable: 'Noticeable', sharp: 'Sharp pain' };
  const PUMP_LABELS = { low: 'Low', moderate: 'Moderate', amazing: 'Amazing' };
  const VOLUME_LABELS = { not_enough: 'Not enough', just_right: 'Just right', pushed: 'Pushed my limits', too_much: 'Too much' };
  // Every answered question this session, grouped by muscle in workout order
  // (the order questions are actually asked within a muscle group: Soreness
  // first, then each exercise's Joint check, then Pump & Volume last) — for
  // the recap sheet. Deriving joint rows straight from session.entries (not
  // from mesoAnswersRef directly) automatically excludes an exercise that was
  // swapped out or removed since — it's simply no longer in session.entries,
  // so there's nothing left to reason a stale index against.
  const mesoRecapGroups = () => {
    const muscleOrder = [];
    const seenMuscles = new Set();
    session.entries.forEach(e => {
      if (e.isCardio) return;
      const pm = primaryMuscleForExercise(store.exercises?.find(x => x.id === e.exId));
      if (pm && !seenMuscles.has(pm)) { seenMuscles.add(pm); muscleOrder.push(pm); }
    });
    const groups = [];
    muscleOrder.forEach(muscle => {
      const sRec = mesoAnswersRef.current.soreness[muscle];
      const vRec = mesoAnswersRef.current.volume[muscle];
      // Joint feedback (per exercise) vs. General feedback (muscle-group-wide:
      // Soreness carryover + Pump & Volume) — split into two sections in the
      // detail sheet so it's clear which answer applies to what.
      const jointRows = [];
      session.entries.forEach(e => {
        if (e.isCardio) return;
        if (primaryMuscleForExercise(store.exercises?.find(x => x.id === e.exId)) !== muscle) return;
        const r = mesoAnswersRef.current.joint[e.exId];
        if (!r || r.answer == null) return;
        jointRows.push({ key: 'joint-' + e.exId, title: r.exName, sub: JOINT_LABELS[r.answer] || r.answer, onEdit: () => openJointEdit(e.exId) });
      });
      const generalRows = [];
      if (sRec?.answer != null) {
        generalRows.push({ key: 'soreness-' + muscle, title: 'Soreness', sub: SORENESS_LABELS[sRec.answer] || sRec.answer, onEdit: () => openSorenessEdit(muscle) });
      }
      if (vRec?.pump != null && vRec?.volume != null) {
        generalRows.push({ key: 'volume-' + muscle, title: 'Pump & Volume', sub: `${PUMP_LABELS[vRec.pump] || vRec.pump} pump · ${VOLUME_LABELS[vRec.volume] || vRec.volume}`, onEdit: () => openVolumeEdit(muscle) });
      }
      if (jointRows.length || generalRows.length) groups.push({ muscle, jointRows, generalRows });
    });
    return groups;
  };

  // Compute per-exercise weight boosts earned this session and return gain items for
  // the post-session screen. Also merges set-gain info from mesoSessionSetGainsRef.
  const computeMesoGains = (isComplete = false) => {
    if (!mesoState) return [];
    const unit = store.settings?.unit || 'kg';
    const weightBoostMap = {};
    const gainMap = {}; // key → { name, setDelta, weightDelta }

    // Set changes recorded during feedback (positive = gain, negative = reduction)
    for (const [key, { name, delta }] of Object.entries(mesoSessionSetGainsRef.current)) {
      if (!gainMap[key]) gainMap[key] = { name, setDelta: 0, weightDelta: 0 };
      gainMap[key].setDelta += (delta ?? 1);
    }

    // Weight boosts: joint fine + pump ok + volume ok + all reps hit
    for (const e of session.entries) {
      if (e.isCardio) continue;
      const exId = e.exId;
      const ex = store.exercises?.find(x => x.id === exId);
      const muscle = primaryMuscleForExercise(ex);

      if (!mesoJointFineRef.current.has(exId)) continue;
      if (muscle && !mesoPumpOkRef.current.has(muscle)) continue;
      if (muscle && !mesoVolumeOkRef.current.has(muscle)) continue;

      const workingSets = e.sets.filter(s => !s.warmup && !s.skipped);
      if (!workingSets.length) continue;
      const plannedReps = e.plannedReps ?? null;
      const allHit = workingSets.every(s => {
        if (!s.done) return false;
        if (plannedReps == null) return true;
        const reps = LB.effReps(s);
        return reps != null && reps >= plannedReps;
      });
      if (!allHit) continue;

      const catCfg = ex?.equipment ? (store.settings?.equipmentConfig?.[ex.equipment] ?? {}) : {};
      const increment = catCfg.increment ?? (unit === 'lbs' ? 5 : 2.5);
      const key = exId + '_' + session.dayId;
      weightBoostMap[key] = increment;
      if (!gainMap[key]) gainMap[key] = { name: e.name, setDelta: 0, weightDelta: 0 };
      gainMap[key].weightDelta = increment;
    }

    // Weight boosts must be re-earned every session (min reps + joint fine +
    // pump ok + volume ok, all re-confirmed this session). Replace this
    // session's exercise keys wholesale — earned ones set, un-earned ones
    // dropped — leaving other training days' boosts untouched. A deload
    // session collects no feedback, so it must NOT wipe boosts earned before
    // it: skip the recompute entirely and leave the map as-is.
    // mesoState here is the React state — already contains all feedback deltas from this session.
    const newWeightBoosts = isMesoDeloadSession
      ? (mesoState.weightBoosts || {})
      : LB.reearnMesoWeightBoosts(
          mesoState.weightBoosts,
          session.entries.filter(e => !e.isCardio).map(e => e.exId + '_' + session.dayId),
          weightBoostMap,
        );
    const withBoosts = { ...mesoState, weightBoosts: newWeightBoosts };
    // If the last meso week just finished: bump completions + set pendingMeso2 so the
    // home screen can offer Meso 2 after a deload (or immediately). isComplete is
    // true for EVERY session of the final week, and this runs per session-end, so
    // guard on pendingMeso2 to increment completions exactly once per block — else
    // a second peak-week session (or a force-quit re-run) double-counts and the
    // offer misreads "Meso 3" instead of "Meso 2" (audit C2). pendingMeso2 clears
    // only when the user answers the offer, i.e. when the next block begins.
    const finalMeso = (isComplete && !withBoosts.pendingMeso2)
      ? { ...withBoosts, completions: (withBoosts.completions ?? 0) + 1, pendingMeso2: true }
      : withBoosts;
    if (finalMeso) {
      setMesoStateLocal(finalMeso);
      saveMesoStateToStorage(finalMeso);
      flushMesoStateToStore(finalMeso);
    }

    return Object.values(gainMap).filter(g => g.setDelta !== 0 || g.weightDelta !== 0);
  };
  // ──────────────────────────────────────────────────────────────────────────

  // Soreness trigger: fires when exIdx changes to first exercise of a new muscle group
  useEffectT(() => {
    if (!mesoState || !entry || isCardio || isMesoDeloadSession) return;
    if (mesoWeek == null) return; // pending period — meso not yet started
    if (mesoWeek === 1) return; // week 1: no previous meso session to be sore from
    if (mesoLastWeek) return; // final week: set deltas frozen, and soreness only drives deltas
    const ex = entry ? store.exercises?.find(e => e.id === entry.exId) : null;
    const pm = primaryMuscleForExercise(ex);
    if (!pm || askedSorenessRef.current.has(pm)) return;
    const isFirst = !session.entries.slice(0, exIdx).some(e => {
      const ex2 = store.exercises?.find(x => x.id === e.exId);
      return primaryMuscleForExercise(ex2) === pm;
    });
    if (!isFirst) return;
    askedSorenessRef.current.add(pm);
    persistMesoAsked();
    setMesoSorenessMusc(pm);
    setMesoSorenessSel(null);
    mesoEditingRef.current.soreness = null;
    setMesoSorenessOpen(true);
  }, [exIdx, !!mesoState]);

  // Joint + pump/volume trigger: when all working sets of an exercise are done,
  // ask joint feedback. Fires whenever the current entry's sets change.
  useEffectT(() => {
    if (!mesoState || !entry || isCardio || isMesoDeloadSession) return;
    if (mesoWeek == null) return; // pending period — meso not yet started
    const exId = entry.exId;
    if (askedJointRef.current.has(exId)) return;
    const workingSets = entry.sets.filter(s => !s.warmup);
    if (workingSets.length === 0) return;
    if (!workingSets.every(s => s.done || s.skipped)) return;
    const ex = store.exercises?.find(e => e.id === exId);
    const pm = primaryMuscleForExercise(ex);
    askedJointRef.current.add(exId);
    persistMesoAsked();
    mesoJointExIdxRef.current = exIdx;
    setMesoJointExId(exId);
    setMesoJointExName(entry.name);
    setMesoJointMuscle(pm);
    setMesoJointSel(null);
    mesoEditingRef.current.joint = null;
    setMesoJointOpen(true);
  }, [exIdx, entry?.sets?.map(s => s.done ? 1 : 0).join(','), !!mesoState]);

  const tempoTimerRef = useRefT(null);
  const audioCtxRef = useRefT(null);

  // ── Rest-timer expiry (replaces the old 250ms restRemaining poll) ──────────
  // The rest displays tick inside <RestGauge>; only the expiry SIDE EFFECT
  // (beep + auto-open modal + post-warmup startedAt) still runs in the parent,
  // driven by a setTimeout armed at the rest's known finish time. restExpired
  // replaces every `restRemaining === 0` / `> 0` gate in the JSX and flips only
  // twice per rest period instead of 4x/second.
  const sessionRef = useRefT(session); sessionRef.current = session;
  const restStartRef = useRefT(restStart); restStartRef.current = restStart;
  const restFiredRef = useRefT(false); // synchronous guard: fire the expiry effect at most once per rest
  const fireRestDone = () => {
    if (restFiredRef.current) return;
    restFiredRef.current = true;
    const wasPostWarmup = !sessionRef.current.startedAt;
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
    // audio: two beeps + higher tone. Reuse the shared AudioContext created
    // during a prior user gesture — a new one on a timer tick gets suspended by
    // iOS and never plays.
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
      // iOS only resumes a suspended AudioContext on a user gesture. On a resume
      // (app was backgrounded) resume().then(play) would queue a STALE beep that
      // fires on the user's NEXT tap (the "beep only when I check the next set"
      // bug). Play only when the context is already running; otherwise best-effort
      // resume for next time and skip this beep — the modal + gold flash already
      // signal the rest is over, and a push fired while the app was backgrounded.
      if (ctx.state === 'running') play();
      else ctx.resume().catch(() => {});
    } catch (_) {}
  };
  const [restExpired, setRestExpired] = useStateT(() => {
    const rs = session.restStart ?? null, rd = session.restDuration ?? null;
    return !!(rs && rd && Date.now() >= rs + rd * 1000);
  });
  const restExpiredRef = useRefT(restExpired); restExpiredRef.current = restExpired;
  // Reset the once-per-rest fire guard whenever a NEW rest begins (restStart /
  // restDuration change) — deliberately NOT on resume, so a rest that already
  // beeped can't beep again when the app is foregrounded later.
  useEffectT(() => { restFiredRef.current = false; }, [restStart, restDuration]);
  // iOS discards a setTimeout that was pending in a backgrounded WebView and
  // never restores it — so after any background→foreground cycle the armed rest
  // timer is simply dead (even with minutes left). Bump a nonce on every resume
  // so the arm effect below re-runs and re-arms with the correct remaining time
  // (or fires immediately if the rest finished while backgrounded). The old
  // 250ms poll survived this implicitly by just ticking again; this restores
  // that robustness. Gated on an active rest so idle resumes don't re-render.
  const [resumeNonce, setResumeNonce] = useStateT(0);
  useEffectT(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && restStartRef.current != null) setResumeNonce(n => n + 1); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  useEffectT(() => {
    if (restStart == null) { setRestExpired(false); return; }
    const ms = restStart + activeRestDef * 1000 - Date.now();
    if (ms <= 0) {
      // Past finish time when (re)armed — a genuine active→expired tap (−30s to
      // 0) or a rest that elapsed while backgrounded. fireRestDone's
      // restFiredRef guard makes this idempotent, so a session that MOUNTS
      // already-expired (restExpired init true) or a second resume won't re-beep.
      if (!restExpiredRef.current) { setRestExpired(true); fireRestDone(); }
      return;
    }
    setRestExpired(false);
    const t = setTimeout(() => { setRestExpired(true); fireRestDone(); }, ms);
    return () => clearTimeout(t);
  }, [restStart, restDuration, resumeNonce]); // + resumeNonce: re-arm after iOS kills the bg timer
  const [kbField, setKbField] = useStateT(null); // { setIdx, field }
  // IntensityChainSheet needs the keyboard's actual rendered height (not a
  // guessed constant — CustomKeyboard's real height varies with
  // env(safe-area-inset-bottom), so a hardcoded number was off by exactly
  // that amount and left the sheet overlapping the keyboard's top row).
  // useLayoutEffect (not useEffect) measures synchronously before paint, so
  // the sheet renders at the right height on the very first frame — no
  // visible jump once the keyboard mounts.
  const [customKbHeight, setCustomKbHeight] = useStateT(0);
  useLayoutEffectT(() => {
    if (!kbField) return;
    const el = document.querySelector('[data-keyboard]');
    if (el) setCustomKbHeight(el.getBoundingClientRect().height);
  }, [kbField]);
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
  const [cardioForm, setCardioForm] = useStateT({ type: '', duration: '', distance: '', paceFeeling: null, effort: null, distUnit: LB.cardioDistUnit() });
  const cardioTypeChips = useMemoT(() => LB.recentCardioTypes(store.cardioLogs), [store.cardioLogs]);
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
    const du = LB.cardioDistUnit();
    const cd = entry.cardioData;
    setCardioForm(cd ? { type: cd.type || '', duration: cd.durationMinutes ? String(cd.durationMinutes) : '', distance: cd.distanceM != null ? LB.mToDisplay(cd.distanceM, du) : '', paceFeeling: cd.paceFeeling ?? null, effort: cd.effort ?? null, distUnit: du } : { type: '', duration: '', distance: '', paceFeeling: null, effort: null, distUnit: du });
  }, [exIdx, sessionId]);
  // Intentionally NOT keyed on exIdx/entry — Paceguard (tempo) is meant to
  // keep running across exercise navigation once started, stopping only on
  // an explicit "Stop" tap or when the whole training screen unmounts
  // (session finished/abandoned). Do not add exIdx to these deps; that would
  // silently stop the metronome on every exercise change, which is the
  // opposite of what this feature is for.
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
    setTimeout(() => scrollChainRowIntoView('data-drop-row', dropIdx), 80);
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
    setTimeout(() => scrollChainRowIntoView('data-myo-row', dropIdx), 80);
  };

  const activateAvKb = (dropIdx, field) => {
    const d = avDropsRef.current[dropIdx];
    const val = field === 'kg'
      ? (d?.kg != null ? String(d.kg).replace('.', ',') : '')
      : (d?.reps != null ? String(d.reps) : '');
    kbFieldRef.current = { setIdx: 'av', dropIdx, field };
    kbRawRef.current = val;
    kbFreshRef.current = true;
    setKbField({ setIdx: 'av', dropIdx, field });
    setKbRaw(val);
    setKbFresh(true);
    setTimeout(() => scrollChainRowIntoView('data-av-row', dropIdx), 80);
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
    if (setIdx === 'av') {
      const dropIdx = kbFieldRef.current?.dropIdx;
      if (typeof dropIdx !== 'number') return;
      if (field === 'kg') {
        const num = newRaw === '' ? null : parseFloat(newRaw.replace(',', '.'));
        if (newRaw === '' || !isNaN(num)) setAvDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, kg: num ?? null } : d));
      } else {
        const num = newRaw === '' ? null : parseInt(newRaw, 10);
        if (newRaw === '' || !isNaN(num)) setAvDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, reps: num ?? null } : d));
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
            // Editing the weight of an already-committed intensity-technique
            // set (drop-set/myo-rep/lengthened partials) reopens it for
            // editing — clear the stale technique/drops so it doesn't carry
            // forward data that no longer matches what's being typed.
            sets: en.sets.map((st, si) =>
              si === setIdx ? { ...st, kg: num ?? null, done: false, ...(st.technique ? { technique: null, drops: null } : {}) }
              : store.settings?.weightFillDown !== false && si > setIdx && !st.done && !st.warmup ? { ...st, kg: num ?? null }
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
    if (setIdx === 'av') {
      const { dropIdx } = kbFieldRef.current;
      if (field === 'kg') {
        const cur = parseFloat(kbRawRef.current.replace(',', '.')) || 0;
        const step = (exercise?.equipment && store.settings?.equipmentConfig?.[exercise.equipment]?.increment) || 1.25;
        const next = Math.max(0, Math.round((cur + dir * step) * 100) / 100);
        const newRaw = String(next).replace('.', ',');
        kbRawRef.current = newRaw;
        setKbRaw(newRaw);
        setAvDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, kg: next } : d));
      } else {
        const cur = parseInt(kbRawRef.current, 10) || 0;
        const next = Math.max(0, cur + dir);
        kbRawRef.current = String(next);
        setKbRaw(String(next));
        setAvDrops(prev => prev.map((d, i) => i === dropIdx ? { ...d, reps: next } : d));
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
            si === setIdx ? { ...st, kg: next, done: false, ...(st.technique ? { technique: null, drops: null } : {}) }
            : store.settings?.weightFillDown !== false && si > setIdx && !st.done && !st.warmup ? { ...st, kg: next }
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
    if (setIdx === 'av') {
      const { dropIdx } = kbFieldRef.current;
      kbApply(kbRawRef.current, field, setIdx);
      if (field === 'kg') {
        activateAvKb(dropIdx, 'reps');
      } else {
        const drops = avDropsRef.current;
        if (dropIdx + 1 < drops.length) {
          setTimeout(() => activateAvKb(dropIdx + 1, 'kg'), 50);
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
      if (dropSetIdx === setIdx || myoSetIdx === setIdx || avSetIdx === setIdx) return;
      if (lpTarget?.exIdx === exIdx && lpTarget?.setIdx === setIdx) return;
      completeSet(setIdx, false, true);
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
    const jump = addAndJumpRef.current;
    setAddOpen(false);
    if (session.entries.length === 0) {
      // First exercise in an empty session — skip the superset prompt and insert directly.
      let isNewCardio = false;
      setStore(s => {
        const sess = s.sessions.find(x => x.id === session.id);
        if (!sess) return s;
        const newEx = LB.findExercise(s, newExId);
        isNewCardio = newEx?.movement_type === 'cardio';
        let newEntry;
        if (isNewCardio) {
          newEntry = { exId: newExId, name: newEx?.name || newExId, isCardio: true, plannedSets: 0, plannedReps: null, plannedRepsPerSet: null, sets: [], cardioDone: false, cardioData: null, note: '', supersetGroup: null, addedDuringSession: true };
        } else {
          const isUni = newEx?.movement_type === 'unilateral';
          const bwKg = LB.shouldPullBodyweight(newEx) ? LB.latestBodyweight(s) ?? null : null;
          const last = LB.bestRecentEntry(s, newExId, session.dayId);
          const suggestion = LB.progressionSuggestion(s, newExId, session.dayId, null, null, last);
          const seedSets = LB.buildSeedSets({ sets: 3, repsPerSet: null }, last, suggestion, isUni, s, bwKg);
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
      if (jump && !isNewCardio) {
        addAndJumpRef.current = false;
        const ff = firstFieldForExercise(LB.findExercise(store, newExId));
        if (ff) setTimeout(() => activateKb(0, ff), 200);
      }
    } else if (addSupersetCandidates.length === 0) {
      // Nothing eligible to pair with — skip the superset prompt entirely
      // rather than show an empty picker.
      if (jump) addAndJumpRef.current = false;
      linkNewExercise(null, newExId, jump);
    } else {
      // Defer insertion until the user picks a superset (or solo) —
      // that choice determines where the new exercise is placed.
      setAddSupersetData({ newExId });
    }
  };

  // First field to jump the keyboard to for a freshly-added exercise — 'kg' for
  // weight mode, the first rendered reps cell for reps mode, and null for
  // checkbox mode (nothing to type, so no keyboard).
  const firstFieldForExercise = (ex) => {
    const m = LB.exerciseLogMode(ex);
    if (m === 'weight') return 'kg';
    if (m === 'checkbox') return null;
    return ex?.movement_type === 'unilateral' ? 'repsL' : 'reps';
  };

  // targetIdx = null → solo (insert after current), targetIdx = i → link with
  // entry i and insert right after it. Shared by the add-exercise superset
  // modal (confirmAdd below) and the Intensity-sheet "Superset → new
  // exercise" flow (doLinkNewExerciseSuperset), which always links to the
  // currently open exercise.
  const linkNewExercise = (targetIdx, newExId, jump) => {
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
        const bwKg = LB.shouldPullBodyweight(newEx) ? LB.latestBodyweight(s) ?? null : null;
        const last = LB.bestRecentEntry(s, newExId, session.dayId);
        const suggestion = LB.progressionSuggestion(s, newExId, session.dayId, null, null, last);
        const mother = targetIdx !== null ? sess.entries[targetIdx] : null;
        const setCount = mother ? (mother.plannedSets ?? mother.sets?.length ?? 3) : 3;
        const seedSets = LB.buildSeedSets({ sets: setCount, repsPerSet: null }, last, suggestion, isUni, s, bwKg);
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
      // Jump: go to the new exercise; otherwise keep the user on the same exercise
      const newCurrentIdx = jump ? insertIdx : (insertIdx <= currentIdx ? currentIdx + 1 : currentIdx);
      return {
        ...s,
        sessions: s.sessions.map(x => x.id !== session.id ? x : {
          ...x,
          entries: finalEntries,
          currentExIdx: newCurrentIdx,
        }),
      };
    });
    if (jump) {
      const newEx = store.exercises?.find(e => e.id === newExId);
      const ff = newEx?.movement_type !== 'cardio' ? firstFieldForExercise(newEx) : null;
      if (ff) setTimeout(() => activateKb(0, ff), 200);
    }
  };

  // Called from the superset modal opened by the "Add exercise" button.
  const confirmAdd = (targetIdx) => {
    const { newExId } = addSupersetData;
    const jump = addAndJumpRef.current;
    if (jump) addAndJumpRef.current = false;
    setAddSupersetData(null);
    linkNewExercise(targetIdx, newExId, jump);
  };

  // Intensity sheet → Superset → "New exercise": always links the freshly
  // picked/created exercise to the currently open one, no solo/link question
  // (unlike confirmAdd, whose caller doesn't yet know which entry is "mother").
  const doLinkNewExerciseSuperset = (ids) => {
    const newExId = Array.isArray(ids) ? ids[0] : ids;
    setSupersetNewPickerOpen(false);
    linkNewExercise(exIdx, newExId, false);
  };

  // Intensity sheet → Superset → "Existing exercise": links the current
  // exercise with an already-in-session entry (only offered when that entry
  // has no completed/skipped working sets yet, see supersetCandidates) by
  // moving it to sit right after the current exercise and giving both the
  // same supersetGroup. Reuses reorderSessionEntries (the chip drag-reorder's
  // splice+currentExIdx math) since this is the same "move an existing entry"
  // operation, just triggered from the Intensity sheet instead of a drag.
  const linkExistingSuperset = (targetIdx) => {
    setSupersetLinkData(null);
    updateSession(sess => {
      const motherIdx = sess.currentExIdx || 0;
      const mother = sess.entries[motherIdx];
      const target = sess.entries[targetIdx];
      if (!mother || !target || targetIdx === motherIdx) return sess;
      const group = mother.supersetGroup || LB.uid();
      // Match the target's working-set count to the mother's — trim from the
      // end (working sets are always seeded after any warmups) or pad by
      // cloning the last working set as a starting suggestion.
      const motherWorkingCount = mother.sets.filter(s => !s.warmup).length;
      const targetWorking = target.sets.filter(s => !s.warmup);
      let sets = target.sets;
      if (targetWorking.length > motherWorkingCount) {
        sets = target.sets.slice(0, target.sets.length - (targetWorking.length - motherWorkingCount));
      } else if (targetWorking.length < motherWorkingCount) {
        const templateSet = targetWorking[targetWorking.length - 1] || { kg: null, reps: null };
        const extra = Array.from({ length: motherWorkingCount - targetWorking.length }, () => ({
          ...templateSet, done: false, skipped: false, technique: null, drops: null,
        }));
        sets = [...target.sets, ...extra];
      }
      const linkedEntries = sess.entries.map((e, i) => {
        if (i === targetIdx) return { ...target, supersetGroup: group, sets, plannedSets: sets.filter(s => !s.warmup).length };
        if (i === motherIdx) return e.supersetGroup === group ? e : { ...e, supersetGroup: group };
        return e;
      });
      const to = targetIdx < motherIdx ? motherIdx : motherIdx + 1;
      const { entries, currentExIdx } = reorderSessionEntries(linkedEntries, motherIdx, targetIdx, to);
      return { ...sess, entries, currentExIdx };
    });
  };

  const removeExercise = async () => {
    if (session.entries.length <= 1) return;
    if (!await confirm(`Remove "${entry.name}" from this session?`, { ok: 'Remove', danger: true })) return;
    updateSession(sess => {
      const removedGroup = sess.entries[exIdx]?.supersetGroup || null;
      let newEntries = sess.entries.filter((_, i) => i !== exIdx);
      // Removing one member can drop a superset/giant-set down to a single
      // remaining exercise — a "group" of one is meaningless, so clear it
      // rather than leave a stale supersetGroup nothing else shares.
      if (removedGroup) {
        const stillGrouped = newEntries.filter(e => e.supersetGroup === removedGroup);
        if (stillGrouped.length === 1) {
          newEntries = newEntries.map(e => e.supersetGroup === removedGroup ? { ...e, supersetGroup: null } : e);
        }
      }
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

    // Set count changes for matched exercises.
    // Compare against plannedSets (meso-adjusted at session start) not item.sets (raw plan),
    // so meso-induced deltas never appear as user-driven changes in this diff.
    planItems.forEach(({ item, originalIdx }, i) => {
      if (!matched[i]) return;
      const entry = matched[i];
      const newSets = entry.sets.filter(s => !s.warmup).length;
      const mesoAdjustedPlan = entry.plannedSets ?? item.sets;
      if (newSets !== mesoAdjustedPlan) {
        diffs.push({ type: 'sets', idx: originalIdx, exName: entry.name, oldSets: item.sets, newSets, mesoAdjustedPlanSets: mesoAdjustedPlan });
      }
    });

    // Superset link/unlink on matched (already-in-plan) exercises. Needed as
    // its own diff type because linking two exercises that were already
    // plan-adjacent produces no swap/sets/reorder diff by itself — without
    // this, computePlanDiff() would return [] and confirmWithFeel's
    // `diffs.length > 0` check would skip the "Update plan?" step entirely,
    // silently dropping the new supersetGroup (the session's own entries
    // keep it, but the plan the NEXT session seeds from would not).
    planItems.forEach(({ item, originalIdx }, i) => {
      if (!matched[i]) return;
      const entry = matched[i];
      const planGroup = item.supersetGroup || null;
      const entryGroup = entry.supersetGroup || null;
      if (planGroup === entryGroup) return;
      const partner = entryGroup ? session.entries.find(e => e !== entry && e.supersetGroup === entryGroup) : null;
      diffs.push({ type: 'superset', idx: originalIdx, exName: entry.name, partnerName: partner?.name || null, linked: !!entryGroup });
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
        // Persist only the user-driven delta on top of the base plan — newSets
        // includes the meso set-delta, which applyMesoSetDelta re-adds next
        // session; writing newSets directly would compound it (base+2 → base+3).
        // Clamp to ≥1: mesoAdjustedPlanSets is the clamped count, so a deep cut
        // during a ballooned meso could otherwise drive the stored base below 1.
        if (diff.type === 'sets') return { ...item, sets: Math.max(1, item.sets + (diff.newSets - (diff.mesoAdjustedPlanSets ?? item.sets))) };
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

  // Beyond-failure meso: auto-arm the Lengthened Partials stepper (pre-filled to
  // the prescribed count) on the current plain working set, so the partials are
  // visible up front instead of silently attached on check-off. Armed once per
  // set (mesoLpArmedRef) so cancelling on a set doesn't re-nag. Chains carry
  // their own partials via the finisher seed, so skip while one is in flight.
  // MUST sit above the `if (!entry)` early return (empty freestyle/bonus
  // session): a hook after that return changes the hook count when the first
  // exercise is added (entry null → set), which is React error #310. Derives
  // the current set locally since currentSetIdx/isCurrentWarmup come later.
  useEffectT(() => {
    if (!entry || isCardio) return;
    const sets = entry.sets || [];
    const curIdx = sets.findIndex(s => !s.done);
    const wCount = sets.filter(s => s.warmup).length;
    const curWarmup = wCount > 0 && curIdx >= 0 && !!sets[curIdx]?.warmup;
    if (mesoPartials <= 0 || curIdx < 0 || curWarmup) return;
    if (dropSetIdx != null || myoSetIdx != null || avSetIdx != null || lpTarget != null) return;
    const key = exIdx + '_' + curIdx;
    if (mesoLpArmedRef.current.has(key)) return;
    mesoLpArmedRef.current.add(key);
    setLpTarget({ exIdx, setIdx: curIdx });
    setLpCount(mesoPartials);
  }, [entry, isCardio, exIdx, mesoPartials, dropSetIdx, myoSetIdx, avSetIdx, lpTarget]);

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
  // Computed once per render and reused by the footer's feedback button, the
  // "Check set" shrink/compact logic, and the recap sheet itself.
  const mesoFeedbackGroups = mesoState ? mesoRecapGroups() : [];
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
  // 5/3/1: the week-3 top set (95% × 1+, the heaviest single of the whole cycle)
  // is peak intensity, so the hero card catches fire (same hellGlow as a
  // beyond-failure meso set) while you grind that AMRAP. Working sets only.
  const heroHell531 = (() => {
    if (!heroSet?.amrap || isCurrentWarmup || store.statusMode === 'deload') return false;
    const sch531 = store.schedules?.find(x => x.id === session.scheduleId);
    if (!LB.is531Plan(sch531)) return false;
    return (LB.current531Week(sch531, store.sessions) || 1) === 3;
  })();
  // Warmups are seeded only onto whichever entry the session-start builder
  // picked (screens-home.jsx), normally entries[0] — but mid-session superset
  // linking can now move that entry away from position 0, so the WARMUP
  // COMPLETE screen below looks it up by content instead of assuming index 0.
  const warmupEntry = session.entries.find(e => (e.sets || []).some(s => s.warmup)) || session.entries[0];
  // For warmup sets there's no meaningful "last session" comparison
  const prevHeroSet = isCurrentWarmup ? null : (last?.entry?.sets || []).filter(s => !s.warmup)[bgSetIdx >= 0 ? bgSetIdx - warmupCount : 0];
  const progressionTarget = progressionTargetForSet(Math.max(0, bgSetIdx - warmupCount));

  const workingSetsArr = entry.sets.filter(s => !s.warmup);
  const allWorkingDone = workingSetsArr.length > 0 && workingSetsArr.every(s => s.done || s.skipped);
  const anyMissingData = !isNoWeightReps && workingSetsArr.some(st => !st.done && !st.skipped && ((!isBodyweight && st.kg == null) || (isUnilateral ? (st.repsL == null || st.repsR == null) : st.reps == null)));

  // (The Lengthened-Partials auto-arm effect lives above the `if (!entry)`
  // early return to keep the hook order stable; see the note there.)

  // Superset linking (Intensity sheet) is only offered before any working set
  // in the CURRENT group has started — retroactively linking a partially-run
  // superset would insert the new exercise's round 0 after rounds the
  // existing pair already logged, confusing the round-index matching. Not
  // ungrouped entries: [entry] itself (linking makes a first pair). Two
  // members: 'giant' (add a third — either mother or the 1st daughter can
  // initiate, both see this since the check is symmetric). Three members:
  // capped, button hidden entirely.
  const supersetGroupMembers = entry.supersetGroup
    ? session.entries.filter(e => e.supersetGroup === entry.supersetGroup)
    : [entry];
  const supersetGroupNotStarted = supersetGroupMembers.every(e => (e.sets || []).filter(s => !s.warmup).every(s => !s.done && !s.skipped));
  const supersetMode = supersetGroupMembers.length >= 3 ? null : supersetGroupMembers.length === 2 ? 'giant' : 'pair';
  const supersetEligible = supersetMode != null && supersetGroupNotStarted;
  const supersetCandidates = session.entries
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => i !== exIdx && !e.isCardio && !e.supersetGroup
      && (e.sets || []).filter(s => !s.warmup).every(s => !s.done && !s.skipped));

  // "Add exercise" flow's link-target list: entries eligible to accept the
  // brand-new exercise as a groupmate. Unlike supersetCandidates above
  // (which only offers ungrouped entries — growing the CURRENT entry's own
  // group is handled separately there), a target here may already be paired,
  // since picking one of an existing pair's members is the only way this
  // flow can grow it into a giant set. Still excludes cardio, an
  // already-full (3-member) group, and any group where a member has already
  // started (retroactively linking would insert the new exercise's round 0
  // after rounds already logged).
  const addSupersetCandidates = session.entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => {
      if (e.isCardio) return false;
      const groupMembers = e.supersetGroup ? session.entries.filter(x => x.supersetGroup === e.supersetGroup) : [e];
      if (groupMembers.length >= 3) return false;
      return groupMembers.every(m => (m.sets || []).filter(s => !s.warmup).every(s => !s.done && !s.skipped));
    });

  const checkAllSets = async () => {
    if (allWorkingDone || anyMissingData) return;
    if (!await confirm(`Check off all ${workingSetsArr.length} sets and continue?`, { ok: 'Check all' })) return;
    // Every intensity technique (drop-set, myo-rep, lengthened partials) only
    // ever completes via its own dedicated FINISH button, which commits data
    // bulk-check has no way to supply (drop weights, myo minis, partials
    // count) — leave that one set for the user to finish individually rather
    // than silently marking it done with none of that data recorded.
    const skipIdx = lpTarget?.exIdx === exIdx ? lpTarget.setIdx : (dropSetIdx ?? myoSetIdx ?? avSetIdx ?? -1);
    updateSession(sess => ({
      ...sess,
      entries: sess.entries.map((e, i) => i === exIdx
        ? { ...e, sets: e.sets.map((st, si) => (st.warmup || si === skipIdx) ? st : { ...st, done: true }) }
        : e),
    }));
    if (skipIdx >= 0) { persistRestStart(Date.now(), restDef); return; }
    // Superset/giant-set aware: jump to whichever partner still has open
    // sets instead of blindly advancing past the whole group.
    if (!advanceIntoGroupOrPartner(300)) {
      persistRestStart(Date.now(), restDef);
      setTimeout(() => navigate(1), 600);
    }
  };

  const skipWarmup = () => {
    updateSession(sess => {
      // The warmup-carrying entry isn't necessarily at index 0 — superset
      // linking / reorder can move it. Find it by content, like warmupEntry.
      const wIdx = sess.entries.findIndex(e => (e.sets || []).some(s => s.warmup));
      return {
        ...sess,
        startedAt: new Date().toISOString(),
        entries: sess.entries.map((e, i) => i === wIdx
          ? { ...e, sets: e.sets.map(st => st.warmup ? { ...st, done: true } : st) }
          : e
        ),
      };
    });
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

      <CardioPROverlay pr={cardioPR} onDone={() => setCardioPR(null)} />

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
        <div onClick={() => setProgressionUnlocked(null)} style={{
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
                const lpExtra = (lpTarget?.exIdx === exIdx && lpTarget?.setIdx === s)
                  ? { technique: 'lengthened_partial', drops: { partials: lpCount } }
                  : null;
                completeSet(s, true, true, lpExtra);
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
              : <SessionClock startedAt={session.startedAt} style={{ color: UI.gold, fontSize: 14, letterSpacing: '0.16em', fontWeight: 500 }} />
            }
          </div>
          {/* rest countdown — only when active */}
          {restStart && !restExpired && (<>
            <div style={{ width: 0.5, height: 14, background: UI.hairStrong, flexShrink: 0 }} />
            <button onClick={() => setRestModalOpen(true)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}>
              <RestGauge variant="header" restStart={restStart} restDef={activeRestDef} />
            </button>
          </>)}
        </div>
        <button onClick={requestGoHome} style={{
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
        const elapsedSec = (Date.now() - new Date(session.startedAt).getTime()) / 1000;
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
          {mesoState && mesoWeek != null && (
            <span style={{ fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.12em', color: UI.inkSoft, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '1px 6px' }}>
              {isWeekdayMode ? 'W' : 'C'}{mesoWeek}/{mesoState.weeks}
            </span>
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
              data-ex-idx={i}
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

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {entry ? (<>

        {/* Exercise name */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isCardio ? (
              <div className="display" style={{
                flex: 1, minWidth: 0,
                fontSize: entry.name.length > 28 ? 16 : entry.name.length > 22 ? 20 : entry.name.length > 16 ? 26 : 32,
                color: UI.ink, lineHeight: 1.05, letterSpacing: '0.02em', fontWeight: 700,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {entry.name}
              </div>
            ) : (
              <button onClick={() => setHistoryOpen(true)} aria-label="Show exercise history" style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9,
                background: 'transparent', border: 'none', padding: 0, margin: 0,
                cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
              }}>
                <span className="display" style={{
                  minWidth: 0, flexShrink: 1,
                  fontSize: entry.name.length > 28 ? 16 : entry.name.length > 22 ? 20 : entry.name.length > 16 ? 26 : 32,
                  color: UI.ink, lineHeight: 1.05, letterSpacing: '0.02em', fontWeight: 700,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {entry.name}
                </span>
                <i className="fa-solid fa-clock-rotate-left" style={{ flexShrink: 0, fontSize: 13, color: UI.inkFaint }} />
              </button>
            )}
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
          {(exercise?.category || exercise?.equipment || (exercise?.tags || []).length > 0 || entry.plannedRepsMax != null || (entry.plannedRepsPerSet && entry.plannedRepsPerSet.length > 1) || (!isCardio && !isNoWeightReps && entry.plannedReps)) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {entry.plannedRepsMax != null && <Pill gold>Range {entry.plannedReps}–{entry.plannedRepsMax}</Pill>}
              {entry.plannedRepsMax == null && entry.plannedRepsPerSet && entry.plannedRepsPerSet.length > 1 && <Pill gold>Per Set {entry.plannedRepsPerSet.join('/')}</Pill>}
              {entry.plannedRepsMax == null && !(entry.plannedRepsPerSet && entry.plannedRepsPerSet.length > 1) && !isCardio && !isNoWeightReps && entry.plannedReps && <Pill gold>{entry.plannedReps} reps</Pill>}
              {exercise?.category && <Pill gold>{exercise.category}</Pill>}
              {exercise?.equipment && <Pill>{(window.EQUIPMENT_TYPES||[]).find(t=>t.key===exercise.equipment)?.label ?? exercise.equipment}</Pill>}
              {(exercise?.tags || []).map(t => <Pill key={t}>{t}</Pill>)}
            </div>
          )}
          {/* 5/3/1 wave for this main lift: the prescribed sets off the Training
              Max for the current week, top set an AMRAP (+). */}
          {(() => {
            const s531 = store.schedules?.find(x => x.id === session.scheduleId);
            if (!LB.is531Plan(s531) || !entry) return null;
            const main = s531.program_data?.mainLifts?.[entry.exId];
            if (!main || main.tm == null) return null;
            const deloadActive = store.statusMode === 'deload';
            const week = deloadActive ? 4 : (LB.current531Week(s531, store.sessions) || 1);
            const u = s531.program_data.unit || 'kg';
            const wave = LB.fiveThreeOneSets(main.tm, week, u);
            // Once the AMRAP top set is logged, estimate the 1RM it implies and,
            // if that points to a meaningfully higher Training Max, nudge.
            const topDone = (entry.sets || []).find(s => s.amrap && s.done && s.kg != null && s.reps != null);
            const est = topDone ? LB.e1rm(topDone.kg, topDone.reps) : null;
            const sugg = est ? LB.suggest531Tm(est, main.tm, main.kind, u) : null;
            return (
              <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(var(--accent-rgb),0.06)', border: `1px solid ${UI.goldSoft}`, borderRadius: 6 }}>
                <div className="micro-gold" style={{ marginBottom: 7 }}>5/3/1 · {deloadActive ? 'DELOAD' : `WEEK ${week}${week === 4 ? ' · DELOAD' : ''}`} · TM {main.tm}{u}</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {wave.map((ws, i) => (
                    <span key={i} className="num" style={{ fontSize: 14, color: ws.amrap ? UI.gold : UI.inkSoft }}>
                      {ws.kg}<span style={{ color: UI.inkFaint }}>×</span>{ws.reps}{ws.amrap ? '+' : ''}
                    </span>
                  ))}
                </div>
                {est != null && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${UI.hairStrong}` }}>
                    <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>
                      Top set {topDone.kg}<span style={{ color: UI.inkFaint }}>×</span>{topDone.reps} → est. 1RM <span style={{ color: UI.gold }}>~{LB.round531(est, u)}{u}</span>
                    </div>
                    {sugg?.higher && (
                      <div className="micro-gold" style={{ marginTop: 5, letterSpacing: '0.04em', lineHeight: 1.45 }}>
                        That points to a Training Max near {sugg.tm}{u}, you're stronger than this cycle assumes.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          {/* Meso swap suggestions */}
          {mesoState && exercise && (() => {
            const flags = [];
            if (mesoState.jointFlags?.[exercise.id]) {
              flags.push({ icon: '⚠️', msg: 'Caused sharp joint pain last session — consider swapping this exercise.' });
            }
            const pumpLow = mesoState.pumpLowCounts?.[exercise.id] || 0;
            if (pumpLow >= 3) {
              flags.push({ icon: '💡', msg: `Low pump ${pumpLow} sessions in a row — a different variation might work better for you.` });
            }
            if (!flags.length) return null;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {flags.map((f, i) => (
                  <div key={i} style={{ background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 6, padding: '8px 12px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{f.icon}</span>
                    <span style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>{f.msg}</span>
                  </div>
                ))}
              </div>
            );
          })()}
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
                  {entry.cardioData.distanceM != null && ` · ${LB.mToDisplay(entry.cardioData.distanceM, cardioForm.distUnit)} ${cardioForm.distUnit}`}
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
                        <button key={u} onClick={() => { LB.setCardioDistUnit(u); setCardioForm(f => ({ ...f, distUnit: u })); }} style={{ padding: '2px 8px', borderRadius: 4, border: `1px solid ${cardioForm.distUnit === u ? UI.gold : UI.hairStrong}`, background: cardioForm.distUnit === u ? UI.goldFaint : 'transparent', color: cardioForm.distUnit === u ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 9, letterSpacing: '0.1em', cursor: 'pointer' }}>{u}</button>
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
          // Hell-cycle glow: the hero card smoulders (same hellGlow the meso
          // Options box uses) once the meso RIR target hits 0 or goes negative
          // (beyond failure), matching the red/ember RIR watermark. Working sets
          // only, not warm-ups or deload. Also fires on the 5/3/1 week-3 top
          // single (heroHell531), the heaviest, most intense rep of the cycle.
          <BracketFrame gold padding={0} style={((mesoState && mesoRirVal != null && mesoRirVal <= 0 && !isCurrentWarmup && !isMesoDeloadSession) || heroHell531) ? { animation: 'hellGlow 2s ease-in-out infinite' } : undefined}>
            {mesoState && mesoRirVal != null && !isCurrentWarmup && !isMesoDeloadSession && (() => {
              // Escalate the RIR watermark as the block gets crazier: gold above
              // failure, red at 0 RIR, then a hotter, faster ember-flicker the
              // further past failure (negative RIR) it goes — at -3 it's fully
              // ablaze. neg = how many partials are prescribed (0..3).
              const neg = mesoRirVal < 0 ? -mesoRirVal : 0;
              const fire = neg > 0;
              // Escalating ember: hotter (orange→amber), bigger glow, higher
              // opacity and a slower flicker the further past failure it goes,
              // so −1 and −3 look clearly different (−3 is fully ablaze). Two-
              // layer warm palette via CSS custom props (see @keyframes
              // meso-ember). animationDuration overridden per intensity.
              const emberVars = fire ? {
                '--ember-op': (0.52 + neg * 0.08).toFixed(2),
                '--ember-blur': `${8 + neg * 15}px`,
                '--ember-glow1': `rgba(255,${120 + neg * 22},${25 + neg * 8},0.92)`,
                '--ember-glow2': `rgba(255,${Math.max(0, 60 - neg * 14)},0,${(0.4 + neg * 0.08).toFixed(2)})`,
                animationDuration: `${(2.9 - neg * 0.28).toFixed(2)}s`,
              } : {};
              const coreColor = fire ? ['#ff6a2a', '#ff801a', '#ffa510'][neg - 1] : (mesoRirVal === 0 ? 'rgba(220,53,69,1)' : UI.gold);
              return (
                <>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', overflow: 'hidden', zIndex: 3 }}>
                  {/* RIR + partials gloss rotate together as ONE unit around the
                      card's centre (not each span on its own) so the long
                      "(0 RIR + N partials)" line stays centred under the number
                      instead of clipping off the bottom-left edge. Beyond
                      failure shows the raw negative RIR as the compact headline
                      with the plain-language gloss below, so it can't be
                      misread as "negative reps in reserve". */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: 'rotate(-22deg)' }}>
                    {/* Fire mode adds the gloss line below, so the number is
                        smaller there — rotating a full 72px headline + gloss
                        overflows this short hero card and clips the gloss. The
                        plain single-line watermark keeps its bigger size. */}
                    <span className={`display-it${fire ? ' meso-ember' : ''}`} style={{
                      fontSize: fire ? 52 : 72, fontWeight: 900, letterSpacing: fire ? '0.12em' : '0.18em', whiteSpace: 'nowrap', userSelect: 'none', lineHeight: 1,
                      color: coreColor,
                      ...(fire ? emberVars : { opacity: mesoRirVal === 0 ? 0.13 : 0.09 }),
                    }}>{mesoRirVal} RIR</span>
                    {fire && (
                      <span className="meso-ember" style={{
                        fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: coreColor,
                        marginTop: 5, userSelect: 'none', whiteSpace: 'nowrap',
                        ...emberVars, '--ember-blur': `${5 + neg * 5}px`,
                      }}>(0 RIR + {neg} PARTIAL{neg === 1 ? '' : 'S'})</span>
                    )}
                  </div>
                </div>
                {/* Scrim: a bg-toned radial veil BETWEEN the (now background)
                    weight/reps and the ember. z-order is content(1) < scrim(2) <
                    ember(3), so in a beyond-failure week the RIR is the hero of
                    the card and the numbers recede behind it (still fully shown,
                    and editable, in the set list below). The radial center knocks
                    the big numbers back while the card edges stay ablaze. Fire
                    mode only. */}
                {fire && <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
                  background: 'radial-gradient(ellipse 82% 76% at 50% 56%, rgba(var(--bg-rgb),0.72) 0%, rgba(var(--bg-rgb),0.5) 44%, rgba(var(--bg-rgb),0) 80%)' }} />}
                </>
              );
            })()}
            <div style={{ padding: '12px 6px', position: 'relative', zIndex: 1 }}>
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
                  {/* Range's own configured span is shown as a permanent badge next to the
                      exercise name instead (doesn't vary per set, so no need to repeat it here). */}
                  {entry.plannedRepsMax == null && entry.plannedRepsPerSet && entry.plannedRepsPerSet.length > 1 && (() => {
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
                          si === bgSetIdx ? { ...st, kg, done: false, ...(st.technique ? { technique: null, drops: null } : {}) }
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
                <span className="micro" style={{ color: UI.inkFaint, textAlign: 'center' }}>{LB.progressionEnabled(store, entry?.plannedRepsMax, entry?.plannedProgressionOffset) ? 'Reps (min)' : 'Reps'}</span>
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
              // 5/3/1 AMRAP: the top "+" set only ignites once every working set above it is logged.
              const priorWorkingDone = entry.sets.every((st, si) => si >= i || st.warmup || st.done || st.skipped);
              const amrapArmed = s.amrap && !s.done && !s.skipped && priorWorkingDone;
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
                  <div style={{ position: 'relative' }}>
                  {amrapArmed && (
                    <div aria-hidden="true" style={{
                      // Fill the money zone with fire and let it breathe out softly on
                      // every side. The radial fades to transparent at the left/right
                      // edges; a 5px blur feathers the top/bottom and rounds the corners
                      // off (with the 8px radius) so nothing reads as a hard-cut rectangle.
                      // Reaches a little past the boxes top and just under the caption.
                      position: 'absolute', top: 5, bottom: -4, left: 0, right: 0, zIndex: 0,
                      pointerEvents: 'none',
                      borderRadius: 8,
                      background: 'radial-gradient(52% 135% at 50% 50%, rgba(255,120,40,0.34), rgba(210,45,0,0.18) 52%, transparent 100%)',
                      filter: 'blur(5px)',
                      animation: 'hellPulse 2s ease-in-out infinite',
                    }} />
                  )}
                  {(() => {
                    const isDropActive = dropSetIdx === i && !s.done;
                    const isMyoActive = myoSetIdx === i && !s.done;
                    const isLpActive = lpTarget?.exIdx === exIdx && lpTarget?.setIdx === i && !s.done;
                    const isAvActive = avSetIdx === i && !s.done;
                    const isIntensityActive = isDropActive || isMyoActive || isAvActive;
                    return (
                    <div data-kb-row={i} style={{
                      display: 'grid',
                      gridTemplateColumns: isIntensityActive ? '28px 1fr' : (isCheckbox ? '28px 1fr 28px' : isRepsOnly ? (isUnilateral ? '28px 1fr 44px 44px 28px' : '28px 1fr 56px 28px') : (isUnilateral ? '28px 1fr 72px 44px 44px 28px' : '28px 1fr 72px 56px 28px')),
                      gap: 8, alignItems: 'center',
                      padding: '10px 6px',
                      position: 'relative', zIndex: 1,
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

                      {isIntensityActive ? null : isCheckbox ? <div /> : (
                        (s.technique === 'drop' || s.technique === 'myorep' || s.technique === 'myorep_match' || s.technique === 'lengthened_partial' || s.technique === 'amrap_variations') && s.done
                          ? <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                              <span style={{
                                display: 'inline-block', fontFamily: UI.fontUi, fontSize: 8,
                                fontWeight: 700, letterSpacing: '0.12em', color: UI.gold,
                                background: 'rgba(var(--accent-rgb),0.12)',
                                border: '0.5px solid rgba(var(--accent-rgb),0.35)',
                                borderRadius: 4, padding: '2px 6px',
                              }}>{LB.techniqueRounds(s, { exName: entry.name }).badge}</span>
                              {LB.techniqueRounds(s, { exName: entry.name }).anyVaried && (
                                <span className="num" style={{ fontSize: 9, color: UI.inkGhost }}>{s.drops[0]?.label || entry.name}</span>
                              )}
                            </div>
                          : <div className="num" style={{ fontSize: 11, color: UI.inkFaint }}>
                              {isWarmupRow
                                ? <span style={{ color: UI.inkGhost }}>{s.warmupPct}%</span>
                                : isRepsOnly
                                  ? (prevSet && (prevSet.reps != null || prevSet.repsL != null || prevSet.repsR != null) ? `${(prevSet.repsL != null || prevSet.repsR != null) ? `L${prevSet.repsL ?? '?'}/R${prevSet.repsR ?? '?'}` : prevSet.reps} reps` : '—')
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
                              si === i ? { ...st, kg, done: false, ...(st.technique ? { technique: null, drops: null } : {}) }
                              : store.settings?.weightFillDown !== false && si > i && !st.done && !st.warmup ? { ...st, kg }
                              : st
                            ),
                          }),
                        }))}
                      />}

                      {!isIntensityActive && !isCheckbox && (isUnilateral ? (
                        <>
                          <KbCell text={kbField?.setIdx === i && kbField?.field === 'repsL' ? kbRaw : (s.repsL ?? '')} placeholder="L" disabled={s.done || s.skipped} onActivate={() => activateKb(i, 'repsL')} style={{ ...setInputStyle(s.done || s.skipped, isCurrent), ...(kbField?.setIdx === i && kbField?.field === 'repsL' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }} />
                          <KbCell text={kbField?.setIdx === i && kbField?.field === 'repsR' ? kbRaw : (s.repsR ?? '')} placeholder="R" disabled={s.done || s.skipped} onActivate={() => activateKb(i, 'repsR')} style={{ ...setInputStyle(s.done || s.skipped, isCurrent), ...(kbField?.setIdx === i && kbField?.field === 'repsR' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }} />
                        </>
                      ) : (
                        <KbCell text={kbField?.setIdx === i && kbField?.field === 'reps' ? kbRaw : (s.reps ?? '')} placeholder={repPlaceholder} disabled={s.done || s.skipped} onActivate={() => activateKb(i, 'reps')} style={{ ...setInputStyle(s.done || s.skipped, isCurrent), ...(kbField?.setIdx === i && kbField?.field === 'reps' ? { boxShadow: `inset 0 -2px 0 var(--accent)` } : {}) }} />
                      ))}

                      {!isIntensityActive && !isLpActive && <button
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
                            // These windows exist only to swallow iOS ghost-clicks, which land
                            // 200-400ms after the real one (see recentCompleteRef/lastCompleteRef
                            // above) — 2000/3000ms was several seconds wider than that, so a
                            // genuine, deliberate uncheck right after completing a set silently
                            // did nothing for up to 3 full seconds.
                            if (globalDelta < 400) { _log(`row${i} BLOCKED by global guard (${globalDelta}ms)`); return; }
                            if (rowDelta < 600) { _log(`row${i} BLOCKED by row guard (${rowDelta}ms)`); return; }
                            _log(`row${i} UNCHECK → updateSet done:false`);
                            updateSet(i, { done: false });
                            return;
                          }
                          if (dropSetIdx === i || myoSetIdx === i || avSetIdx === i) return;
                          if (!isNoWeightReps && !isBodyweight && s.kg == null) return;
                          _log(`row${i} → completeSet`);
                          completeSet(i, false, true);
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
                  {amrapArmed && (
                    <div className="micro-gold" style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '0 6px 8px', letterSpacing: '0.14em', lineHeight: 1.4 }}>
                      GO ALL OUT, as many reps as you can
                    </div>
                  )}
                  </div>
                  {lpTarget?.exIdx === exIdx && lpTarget?.setIdx === i && !s.done && (() => {
                    const missingData = !isNoWeightReps && ((!isBodyweight && s.kg == null) || (!(kbField?.setIdx === i && kbField?.field !== 'kg') && (isUnilateral ? (s.repsL == null || s.repsR == null) : s.reps == null)));
                    return (
                      <div style={{ marginLeft: 36, paddingLeft: 10, borderLeft: `2px solid rgba(var(--accent-rgb),0.3)` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px 2px' }}>
                          <span className="micro-gold">LENGTHENED PARTIALS</span>
                          <button onClick={() => { setLpTarget(null); setLpCount(0); }} style={{ background: 'none', border: 'none', color: UI.inkFaint, fontSize: 10, fontFamily: UI.fontUi, cursor: 'pointer', padding: '2px 4px', letterSpacing: '0.08em' }}>CANCEL</button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 10px' }}>
                          <span className="micro" style={{ color: UI.inkFaint }}>Partials</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <button onClick={() => setLpCount(c => Math.max(0, c - 1))} style={{ width: 32, height: 32, borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkFaint, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>−</button>
                            <span className="num" style={{ fontSize: 18, minWidth: 16, textAlign: 'center', color: lpCount > 0 ? UI.gold : UI.inkFaint }}>{lpCount}</span>
                            <button onClick={() => setLpCount(c => c + 1)} style={{ width: 32, height: 32, borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkFaint, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>+</button>
                          </div>
                        </div>
                        <div style={{ padding: '0 4px 10px' }}>
                          {/* missingData is a hard block (the underlying set
                              itself has no kg/reps yet — nothing to finish
                              regardless of partials); lpCount === 0 only
                              dims it — still tappable, so finishLengthenedPartial
                              can explain why instead of silently completing
                              a "lengthened partial" that had none. */}
                          <button onClick={() => finishLengthenedPartial(i)}
                            disabled={missingData}
                            style={{
                              width: '100%', padding: '8px 0',
                              background: !missingData && lpCount > 0 ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                              border: `1px solid ${!missingData && lpCount > 0 ? 'rgba(var(--accent-rgb),0.5)' : UI.hair}`,
                              borderRadius: 6, color: !missingData && lpCount > 0 ? 'var(--accent)' : UI.inkGhost,
                              fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                              cursor: missingData ? 'default' : 'pointer',
                              WebkitTapHighlightColor: 'transparent',
                            }}>✓ FINISH</button>
                        </div>
                      </div>
                    );
                  })()}
                  {s.technique === 'drop' && s.done && ((s.drops || []).length > 1 || (s.drops?.[s.drops.length - 1]?.partials || 0) > 0) && (
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
                      {(() => { const p = s.drops?.[s.drops.length - 1]?.partials || 0; return p > 0 && (
                        <div style={{ display: 'inline-block', marginTop: 4, padding: '3px 8px', border: '1px solid var(--accent)', borderRadius: 4, fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.03em' }}>
                          +{p} partial{p === 1 ? '' : 's'}
                        </div>
                      ); })()}
                    </div>
                  )}
                  {s.technique === 'amrap_variations' && s.done && ((s.drops || []).length > 1 || (s.drops?.[s.drops.length - 1]?.partials || 0) > 0) && (() => {
                    const anyVaried = (s.drops || []).some(d => d.label && d.label !== entry.name);
                    return (
                    <div style={{ marginLeft: 36, paddingLeft: 10, paddingBottom: 8, borderLeft: `2px solid rgba(var(--accent-rgb),0.2)` }}>
                      {(s.drops || []).slice(1).map((d, di) => (
                        <div key={di} style={{ padding: '4px 4px', opacity: 0.5 }}>
                          {anyVaried && (
                            <div className="num" style={{ fontSize: 9, color: UI.inkGhost, marginBottom: 2 }}>{d.label || entry.name}</div>
                          )}
                          <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 72px 56px', gap: 8, alignItems: 'center' }}>
                            <div style={{
                              width: 24, height: 24, borderRadius: 4,
                              outline: `1px solid rgba(var(--accent-rgb),0.2)`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: UI.goldSoft,
                            }}><i className="fa-solid fa-shuffle" style={{ fontSize: 9 }} /></div>
                            <div />
                            <div style={{ ...setInputStyle(true, false), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span className="num" style={{ fontSize: 15, color: UI.inkSoft }}>{d.kg != null ? String(d.kg).replace('.', ',') : '—'}</span>
                            </div>
                            <div style={{ ...setInputStyle(true, false), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span className="num" style={{ fontSize: 15, color: UI.inkSoft }}>{d.reps ?? '—'}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      {(() => { const p = s.drops?.[s.drops.length - 1]?.partials || 0; return p > 0 && (
                        <div style={{ display: 'inline-block', marginTop: 4, padding: '3px 8px', border: '1px solid var(--accent)', borderRadius: 4, fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.03em' }}>
                          +{p} partial{p === 1 ? '' : 's'}
                        </div>
                      ); })()}
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
                      {(() => { const p = s.drops?.[s.drops.length - 1]?.partials || 0; return p > 0 && (
                        <div style={{ display: 'inline-block', marginTop: 4, marginLeft: 6, padding: '3px 8px', border: '1px solid var(--accent)', borderRadius: 4, fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.03em' }}>
                          +{p} partial{p === 1 ? '' : 's'}
                        </div>
                      ); })()}
                    </div>
                  )}
                  {/* Committed lengthened-partial count — read-only, like the myo-rep total tag below */}
                  {s.technique === 'lengthened_partial' && s.done && !s.warmup && (s.drops?.partials || 0) > 0 && (
                    <div style={{ marginLeft: 36, paddingLeft: 10, paddingBottom: 8 }}>
                      <div style={{ display: 'inline-block', padding: '3px 8px', border: '1px solid var(--accent)', borderRadius: 4, fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.03em' }}>
                        {s.drops.partials} partial{s.drops.partials === 1 ? '' : 's'}
                      </div>
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
        {/* Session feedback — only takes a footer slot once there's something
            to revisit; Check set shrinks (and its label compacts) to make
            room rather than the row growing past its usual button count. */}
        {mesoFeedbackGroups.length > 0 && (
          <button onClick={() => setMesoRecapOpen(true)} style={{
            width: 44, minHeight: 44, borderRadius: 6,
            background: UI.bgRaised, border: `1px solid ${UI.hairStrong}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }} aria-label="Session feedback">
            <i className="fa-solid fa-list-check" style={{ fontSize: 15, color: UI.gold }} />
          </button>
        )}
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
            const hasFeedback = mesoFeedbackGroups.length > 0;
            return (
              <Btn onClick={checkSet} disabled={!hasVal} style={{ flex: hasFeedback ? 1 : 2, minHeight: 44, padding: hasFeedback ? '10px 4px' : '10px 16px' }}>
                {hasFeedback ? (<><i className="fa-solid fa-check" style={{ marginRight: 5 }} />Set</>) : 'Check set'}
              </Btn>
            );
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
              <SessionClock startedAt={session.startedAt} style={{ color: UI.ink }} />
            </div>
          </div>
          {session.isFreestyle && (() => {
            const elapsedMin = session.startedAt ? Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 60000) : 0;
            const msg = elapsedMin < 10
              ? "Really done already? The barbell's barely warm — how about one more exercise?"
              : elapsedMin < 20
              ? "A bit thin. One more exercise to round it out?"
              : elapsedMin < 30
              ? "Short session. Got time for one more?"
              : elapsedMin < 45
              ? "Getting there. Another exercise or calling it here?"
              : elapsedMin < 60
              ? "Solid session going. One more exercise or is this it?"
              : elapsedMin < 75
              ? "Good work. Ready to wrap it up?"
              : elapsedMin < 90
              ? "Nice session. Almost at the 90-minute mark — finish strong?"
              : "Now THAT's a workout. You've earned this finish.";
            return <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, marginBottom: 10 }}>{msg}</div>;
          })()}
          {(() => {
            const onAddEx = () => { addAndJumpRef.current = true; setFinishOpen(false); setAddOpen(true); };
            if (session.isFreestyle) {
              const elapsedMin = session.startedAt ? Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 60000) : 0;
              if (elapsedMin < 20) {
                return <Btn className="intensity-glow" onClick={onAddEx} style={{ width: '100%', marginBottom: 8 }}>+ Add another exercise</Btn>;
              } else if (elapsedMin < 45) {
                return <Btn kind="ghost" onClick={onAddEx} style={{ width: '100%', marginBottom: 8, border: '1px solid rgba(var(--accent-rgb),0.6)', background: 'rgba(var(--accent-rgb),0.07)' }}>+ Add another exercise</Btn>;
              }
            }
            return <Btn kind="ghost" onClick={onAddEx} style={{ width: '100%', marginBottom: 8 }}>+ Add another exercise</Btn>;
          })()}
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
          // Exactly one intensity technique can be "in flight" at a time —
          // picking one always clears any other left unfinished (e.g. the
          // user opened Intensity, picked Drop Set, then reopened Intensity
          // on the same still-unfinished set and picked Myo-Rep instead).
          // Without this, both sub-panels could end up targeting the same
          // row simultaneously.
          const clearDrop = () => { setDropSetIdx(null); setDropDrops([]); setFinisherPartials(0); };
          const clearMyo = () => { setMyoSetIdx(null); setMyoDrops([]); setMyoTechnique(null); setMyoTarget(null); setFinisherPartials(0); };
          const clearLp = () => { setLpTarget(null); setLpCount(0); };
          const clearAv = () => { setAvSetIdx(null); setAvDrops([]); setFinisherPartials(0); };
          const startDrop = () => {
            const target = currentSetIdx >= 0
              ? currentSetIdx
              : entry.sets.reduce((last, s, i) => !s.warmup ? i : last, -1);
            if (target < 0) return;
            clearMyo(); clearLp(); clearAv();
            setFinisherPartials(mesoPartials); // beyond-failure meso: pre-seed prescribed partials
            const s = entry.sets[target];
            const initDrops = [{ kg: s?.kg ?? null, reps: s?.reps ?? null }];
            setDropDrops(initDrops);
            dropDropsRef.current = initDrops;
            setDropSetIdx(target);
            setIntensityOpen(false);
            setTimeout(() => activateDropKb(0, 'kg'), 150);
          };
          const startAv = () => {
            const target = currentSetIdx >= 0
              ? currentSetIdx
              : entry.sets.reduce((last, s, i) => !s.warmup ? i : last, -1);
            if (target < 0) return;
            clearDrop(); clearMyo(); clearLp();
            setFinisherPartials(mesoPartials); // beyond-failure meso: pre-seed prescribed partials
            const s = entry.sets[target];
            const initDrops = [{ kg: s?.kg ?? null, reps: s?.reps ?? null, label: entry.name }];
            setAvDrops(initDrops);
            avDropsRef.current = initDrops;
            setAvSetIdx(target);
            setIntensityOpen(false);
            setTimeout(() => activateAvKb(0, 'kg'), 150);
          };
          const startMyo = (technique) => {
            const target = currentSetIdx >= 0
              ? currentSetIdx
              : entry.sets.reduce((last, s, i) => !s.warmup ? i : last, -1);
            if (target < 0) return;
            clearDrop(); clearLp(); clearAv();
            setFinisherPartials(mesoPartials); // beyond-failure meso: pre-seed prescribed partials
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
              {/* Superset / Giant Set — structural (links this exercise with
                  another), not a set-completion technique like the three
                  below, so it's only offered before the whole current group
                  has started. Listed first: the most recognized technique. */}
              {supersetEligible && (
                <button onClick={() => {
                  setIntensityOpen(false);
                  if (supersetCandidates.length === 0) setSupersetNewPickerOpen(true);
                  else setSupersetLinkData({});
                }} style={btnBase(true)}>
                  <i className="fa-solid fa-link" style={{ fontSize: 18, color: 'var(--accent)', width: 20, textAlign: 'center', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)' }}>{supersetMode === 'giant' ? 'GIANT SET' : 'SUPERSET'}</div>
                    <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft, marginTop: 2 }}>{supersetMode === 'giant' ? 'Add a third exercise to the rotation, no rest between' : 'Pair with another exercise, no rest between'}</div>
                  </div>
                </button>
              )}
              {/* Drop Set */}
              <button onClick={startDrop} style={btnBase(true)}>
                <i className="fa-solid fa-angles-down" style={{ fontSize: 18, color: 'var(--accent)', width: 20, textAlign: 'center', flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)' }}>DROP SET</div>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft, marginTop: 2 }}>Descend the weight, keep the reps coming</div>
                </div>
              </button>
              {/* AMRAP Variations — grip/variation swap is entirely optional
                  (the label input pre-fills with the exercise's own name), the
                  point is chasing reps back-to-back with no rest. */}
              <button onClick={startAv} style={btnBase(true)}>
                <i className="fa-solid fa-shuffle" style={{ fontSize: 18, color: 'var(--accent)', width: 20, textAlign: 'center', flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)' }}>AMRAP VARIATIONS</div>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft, marginTop: 2 }}>AMRAP each round, swap the grip — no rest, no mercy</div>
                </div>
              </button>
              {/* Lengthened Partials */}
              <button onClick={() => {
                const target = currentSetIdx >= 0
                  ? currentSetIdx
                  : entry.sets.reduce((last, s, i) => !s.warmup ? i : last, -1);
                if (target < 0) return;
                clearDrop(); clearMyo(); clearAv();
                setLpTarget({ exIdx, setIdx: target });
                setLpCount(0);
                setIntensityOpen(false);
              }} style={btnBase(true)}>
                <i className="fa-solid fa-arrow-down-long" style={{ fontSize: 18, color: 'var(--accent)', width: 20, textAlign: 'center', flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)' }}>LENGTHENED PARTIALS</div>
                  <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft, marginTop: 2 }}>Full reps, then partials in the stretch</div>
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

      {/* Drop Set / Myo-Rep(-Match) / AMRAP Variations editing sheet — exactly
          one chain is ever in flight (drop/myo/av start* clear the other
          two). Edited in its own sheet instead of inline in the set row so
          the header, the active weight/rep row, and the action buttons are
          always on screen together regardless of scroll position or chain
          length — inline rendering inside the (potentially very long)
          exercise list made that impossible to guarantee reliably.
          keyboardHeight tells Sheet this app's custom numeric keypad is open
          — it focuses no real <input>, so Sheet's own visualViewport-based
          auto-detection never fires for it — so Sheet shrinks/scrolls itself
          to sit above it, exactly like it already does for native inputs.
          Each chain's own content below is a flex column (maxHeight:'inherit'
          takes the Sheet panel's own computed max-height) — header and
          actions as flexShrink:0, rows as the flex:1-equivalent scrollable
          middle (overflowY:'auto', minHeight:0). Deliberately NOT
          position:sticky: a sticky header inside this panel's overflow:auto
          box reproduced a Safari/WebKit bug where it briefly rendered
          edge-to-edge (ignoring the panel's own padding) on a sheet's very
          first open. The flex layout sidesteps that bug class entirely —
          the header is a genuinely separate, non-scrolling box, not
          scroll-positioned relative to anything. */}
      <Sheet
        open={dropSetIdx != null || myoSetIdx != null || avSetIdx != null}
        onClose={requestCloseChainSheet}
        keyboardHeight={kbField ? customKbHeight : 0}
        accent
      >
        {dropSetIdx != null && (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px 8px' }}>
              <span style={chainTitleStyle}>DROP SET</span>
              <button onClick={requestCloseChainSheet} style={{ background: 'none', border: 'none', color: UI.inkFaint, fontSize: 10, fontFamily: UI.fontUi, cursor: 'pointer', padding: '2px 4px', letterSpacing: '0.08em' }}>CANCEL</button>
            </div>
            <div style={{ overflowY: 'auto', minHeight: 0 }}>
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
            </div>
            {/* Partials belong to the action bar: pin them (flexShrink:0) below
                the scrolling row list so they stay visible above the keypad. */}
            <div style={{ flexShrink: 0 }}>
              <FinisherPartials count={finisherPartials} onChange={setFinisherPartials} />
            </div>
            {(() => {
              // finishDropSet itself both silently drops any incomplete row
              // (accidentally added via ADD DROP, never filled in) and
              // requires at least one actual drop beyond the top set — not
              // disabling FINISH here on purpose, so tapping it while
              // "not ready" explains why via a warning instead of just
              // doing nothing.
              const canFinishDrop = dropDrops.filter(d => !!d.reps && (isNoWeightReps || isBodyweight || d.kg != null)).length >= 2;
              return (
                <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: '4px 4px 10px' }}>
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
                    style={{
                      flex: 2, padding: '8px 0',
                      background: canFinishDrop ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                      border: `1px solid ${canFinishDrop ? 'rgba(var(--accent-rgb),0.5)' : UI.hair}`,
                      borderRadius: 6, color: canFinishDrop ? 'var(--accent)' : UI.inkGhost,
                      fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}>✓ FINISH</button>
                </div>
              );
            })()}
          </div>
        )}

        {avSetIdx != null && (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px 8px' }}>
              <span style={chainTitleStyle}>AMRAP VARIATIONS</span>
              <button onClick={requestCloseChainSheet} style={{ background: 'none', border: 'none', color: UI.inkFaint, fontSize: 10, fontFamily: UI.fontUi, cursor: 'pointer', padding: '2px 4px', letterSpacing: '0.08em' }}>CANCEL</button>
            </div>
            <div style={{ overflowY: 'auto', minHeight: 0 }}>
              {avDrops.map((d, di) => {
                const isKgA = kbField?.setIdx === 'av' && kbField?.dropIdx === di && kbField?.field === 'kg';
                const isRepsA = kbField?.setIdx === 'av' && kbField?.dropIdx === di && kbField?.field === 'reps';
                return (
                  <div key={di} data-av-row={di} style={{ padding: '6px 4px', borderBottom: di < avDrops.length - 1 ? `0.5px solid ${UI.hair}` : 'none' }}>
                    <input
                      type="text"
                      value={d.label ?? ''}
                      onFocus={e => { e.target.select(); setAvLabelFocusDi(di); }}
                      onBlur={() => setAvLabelFocusDi(cur => cur === di ? null : cur)}
                      onChange={e => { const val = e.target.value; setAvDrops(prev => prev.map((dd, idx) => idx === di ? { ...dd, label: val } : dd)); }}
                      placeholder={entry.name}
                      style={{
                        width: '100%', boxSizing: 'border-box', background: UI.bgInset,
                        border: `1px solid ${UI.hair}`,
                        borderBottom: `2px solid ${avLabelFocusDi === di ? 'var(--accent)' : UI.hair}`,
                        borderRadius: 4,
                        color: UI.ink, fontFamily: UI.fontUi, fontSize: 12, padding: '6px 8px',
                        marginBottom: 6, outline: 'none', WebkitTapHighlightColor: 'transparent',
                      }}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 72px 56px 28px', gap: 8, alignItems: 'center' }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: 4, flexShrink: 0,
                        background: 'rgba(var(--accent-rgb),0.08)',
                        outline: `1px solid rgba(var(--accent-rgb),0.3)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: UI.gold,
                      }}><i className="fa-solid fa-shuffle" style={{ fontSize: 10 }} /></div>
                      <div className="num" style={{ fontSize: 10, color: UI.inkGhost }}>round {di + 1}</div>
                      <KbCell
                        text={isKgA ? kbRaw : (d.kg != null ? String(d.kg).replace('.', ',') : '')}
                        placeholder="—"
                        onActivate={() => activateAvKb(di, 'kg')}
                        style={{ ...setInputStyle(false, isKgA), ...(isKgA ? { boxShadow: 'inset 0 -2px 0 var(--accent)' } : {}) }}
                      />
                      <KbCell
                        text={isRepsA ? kbRaw : (d.reps != null ? String(d.reps) : '')}
                        placeholder="—"
                        onActivate={() => activateAvKb(di, 'reps')}
                        style={{ ...setInputStyle(false, isRepsA), ...(isRepsA ? { boxShadow: 'inset 0 -2px 0 var(--accent)' } : {}) }}
                      />
                      <button onClick={() => avDrops.length > 1 && setAvDrops(prev => prev.filter((_, idx) => idx !== di))}
                        disabled={avDrops.length <= 1}
                        style={{
                          width: 26, height: 26, borderRadius: 4, border: `1px solid ${UI.hair}`,
                          background: 'transparent', color: UI.inkFaint, fontSize: 14,
                          cursor: avDrops.length <= 1 ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          opacity: avDrops.length <= 1 ? 0.2 : 1, flexShrink: 0,
                          WebkitTapHighlightColor: 'transparent',
                        }}>×</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ flexShrink: 0 }}>
              <FinisherPartials count={finisherPartials} onChange={setFinisherPartials} />
            </div>
            {(() => {
              // finishAv itself both silently drops any incomplete round
              // (accidentally added via ADD ROUND, never filled in) and
              // requires at least one actual variation round beyond the
              // first — not disabling FINISH here on purpose, so tapping
              // it while "not ready" explains why via a warning instead of
              // just doing nothing.
              const canFinishAv = avDrops.filter(d => !!d.reps && (isNoWeightReps || isBodyweight || d.kg != null)).length >= 2;
              return (
                <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: '4px 4px 10px' }}>
                  <button onClick={() => {
                    const newIdx = avDropsRef.current.length;
                    const prevKg = avDropsRef.current[avDropsRef.current.length - 1]?.kg ?? null;
                    setAvDrops(prev => [...prev, { kg: prevKg, reps: null, label: entry.name }]);
                    setTimeout(() => activateAvKb(newIdx, 'kg'), 80);
                  }} style={{
                    flex: 1, padding: '8px 0', background: 'transparent',
                    border: `1px solid ${UI.hairStrong}`, borderRadius: 6,
                    color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.1em', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                  }}>+ ADD ROUND</button>
                  <button onClick={() => finishAv(avDropsRef.current)}
                    style={{
                      flex: 2, padding: '8px 0',
                      background: canFinishAv ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                      border: `1px solid ${canFinishAv ? 'rgba(var(--accent-rgb),0.5)' : UI.hair}`,
                      borderRadius: 6, color: canFinishAv ? 'var(--accent)' : UI.inkGhost,
                      fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}>✓ FINISH</button>
                </div>
              );
            })()}
          </div>
        )}

        {myoSetIdx != null && (() => {
          const myoTotalReps = myoDrops.reduce((acc, d) => acc + (d.reps || 0), 0);
          const myoProgress = myoTarget ? Math.min(1, myoTotalReps / myoTarget) : 0;
          // finishMyoSet silently drops any incomplete mini-set itself
          // (accidentally added via ADD MYO, never filled in) rather than
          // blocking FINISH on it — still needs the activation plus at
          // least one completed mini-set to count as an actual myo-reps
          // set, not just a plain activation, so FINISH is disabled below
          // that.
          const canFinish = myoDrops.filter(d => d.reps != null && (isNoWeightReps || isBodyweight || d.kg != null)).length >= 2;
          const activationDone = myoDrops[0]?.reps != null;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px 8px' }}>
                  <span style={chainTitleStyle}>{myoTechnique === 'myorep_match' ? 'MYO REP MATCH' : 'MYO-REPS'}</span>
                  <button onClick={requestCloseChainSheet} style={{ background: 'none', border: 'none', color: UI.inkFaint, fontSize: 10, fontFamily: UI.fontUi, cursor: 'pointer', padding: '2px 4px', letterSpacing: '0.08em' }}>CANCEL</button>
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
                        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      }} />
                      {/* Glow as a separate, fixed-blur layer whose opacity fades in with
                          progress — only what the compositor can move for free (opacity,
                          like the width bar's transform-free width) changes per render.
                          The old version recomputed the box-shadow's blur/spread radius
                          from myoProgress on every render, so its very first paint (this
                          technique's own progress can already be non-zero on mount, e.g.
                          activation reps carried over) had a genuinely different blur
                          value than every later re-render — the one concrete difference
                          between this content and Drop Set/AMRAP Variations/plain
                          Myo-Reps, none of which have any animated/blurred element. A
                          constant blur here removes that per-render recompute. */}
                      <div style={{
                        position: 'absolute', left: 0, top: 0, height: '100%',
                        width: `${Math.min(1, myoProgress) * 100}%`,
                        minWidth: myoProgress > 0 ? 8 : 0,
                        borderRadius: 999,
                        boxShadow: '0 0 14px 8px rgba(var(--accent-rgb),0.6)',
                        opacity: myoProgress > 0 ? Math.min(1, 0.3 + myoProgress * 0.5) : 0,
                        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
                        pointerEvents: 'none',
                      }} />
                    </div>
                  </div>
                )}
              </div>
              <div style={{ overflowY: 'auto', minHeight: 0 }}>
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
              </div>
              <div style={{ flexShrink: 0 }}>
                <FinisherPartials count={finisherPartials} onChange={setFinisherPartials} />
              </div>
              <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: '4px 4px 10px' }}>
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
                  style={{
                    flex: 2, padding: '8px 0',
                    background: canFinish ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                    border: `1px solid ${canFinish ? 'rgba(var(--accent-rgb),0.5)' : UI.hair}`,
                    borderRadius: 6, color: canFinish ? 'var(--accent)' : UI.inkGhost,
                    fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}>✓ FINISH</button>
              </div>
            </div>
          );
        })()}
      </Sheet>

      {/* superset-link modal (from Intensity): step 1 existing-vs-new, step 2 pick existing */}
      {supersetLinkData && (
        <Sheet open={true} onClose={() => setSupersetLinkData(null)} title={supersetMode === 'giant' ? 'Giant Set' : 'Superset'}>
          {!supersetLinkData.picking ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontFamily: UI.fontUi, fontSize: 14, color: UI.inkSoft, lineHeight: 1.5 }}>
                Link "{entry.name}" with an existing exercise, or add a new one?
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn kind="ghost" onClick={() => setSupersetLinkData(d => ({ ...d, picking: true }))} style={{ flex: 1 }}>Existing</Btn>
                <Btn onClick={() => { setSupersetLinkData(null); setSupersetNewPickerOpen(true); }} style={{ flex: 1 }}>New</Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {supersetCandidates.map(({ e, i }) => (
                <button key={i} onClick={() => linkExistingSuperset(i)} style={{
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

      {supersetNewPickerOpen && <window.Screens.ExercisePicker store={store} setStore={setStore} onClose={() => setSupersetNewPickerOpen(false)} onPick={doLinkNewExerciseSuperset} singleSelect />}

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

      {/* Exercise history, opened by tapping the exercise name. Cross-day and
          straight from the server, so a "last time" that reads stale for this
          day slot can be checked without leaving the session. */}
      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="History">
        {(() => {
          const rows = historyRows ?? localHistory;
          const pr = entry ? LB.bestE1rmForExercise(store, entry.exId) : 0;
          const e1rmForSet = (s) => { const r = LB.effReps(s); return (s.kg != null && r > 0) ? LB.e1rm(s.kg, r) : 0; };
          if (!rows.length) {
            return (
              <div className="micro" style={{ color: UI.inkFaint, textAlign: 'center', padding: '20px 0' }}>
                {historyLoading ? 'Loading…' : 'No history yet'}
              </div>
            );
          }
          const shown = rows.slice(0, 12);
          return (
            <div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>
                {entry?.name}{historyLoading ? ' · updating…' : ''}
              </div>
              {shown.map((h, hi) => {
                const working = (h.sets || []).filter(s => !s.warmup && !s.skipped && (s.kg != null || s.reps != null));
                if (!working.length) return null;
                const sessionBest = working.reduce((m, s) => Math.max(m, e1rmForSet(s)), 0);
                const isPR = pr > 0 && sessionBest > 0 && Math.abs(sessionBest - pr) < 0.01;
                return (
                  <React.Fragment key={h.sessionId || hi}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '11px 0', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                          <span className="num" style={{ fontSize: 10, color: isPR ? UI.gold : UI.inkFaint, letterSpacing: '0.05em' }}>
                            {LB.parseDate(h.date).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' })}
                          </span>
                          {isPR && <span style={{ fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.1em', color: UI.gold, background: UI.goldFaint, border: `0.5px solid ${UI.goldSoft}`, borderRadius: 4, padding: '1px 5px' }}>PR</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {working.map((s, i) => {
                            const isBest = sessionBest > 0 && Math.abs(e1rmForSet(s) - sessionBest) < 0.01;
                            const repsStr = (s.repsL != null || s.repsR != null) ? `L${s.repsL ?? '?'}/R${s.repsR ?? '?'}` : s.reps;
                            return (
                              <span key={i} className="num" style={{ fontSize: 13, color: isBest ? UI.gold : UI.ink }}>
                                {s.kg != null ? <>{s.kg}<span style={{ color: isBest ? UI.goldSoft : UI.inkFaint }}>×</span>{repsStr}</> : repsStr}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      {h.dayName && <span className="micro" style={{ color: UI.inkFaint, flexShrink: 0 }}>{h.dayName}</span>}
                    </div>
                    {hi < shown.length - 1 && <div className="knurl" />}
                  </React.Fragment>
                );
              })}
            </div>
          );
        })()}
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
              ) : d.type === 'superset' ? (
                <>
                  <span style={{ color: UI.goldLight, fontSize: 14 }}>⟷</span>
                  <span style={{ color: UI.inkSoft }}>
                    <strong style={{ color: UI.ink }}>{d.exName}</strong>
                    {d.linked
                      ? <>{' · superset with '}<strong style={{ color: UI.ink }}>{d.partnerName}</strong></>
                      : ' · superset removed'}
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
              {addSupersetCandidates.map(({ e, i }) => (
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
            onClick={restExpired ? () => { cancelPushover(); persistRestStart(null); setRestModalOpen(false); } : undefined}
          >
            <RestGauge variant="modal" restStart={restStart} restDef={activeRestDef} />
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
            fontSize: warmupEntry?.name.length > 22 ? 22 : 30,
            color: UI.ink, lineHeight: 1.05,
            textAlign: 'center', marginBottom: 48,
          }}>{warmupEntry?.name}</div>

          {/* Big countdown + progress bar (own 250ms leaf) */}
          <RestGauge variant="warmup" restStart={restStart} restDef={activeRestDef} />

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
        confirmDisabled={
          ((kbField?.setIdx === 'drop' || kbField?.setIdx === 'myo' || kbField?.setIdx === 'av') && kbField?.field === 'reps') ||
          (lpTarget?.exIdx === exIdx && lpTarget?.setIdx === kbField?.setIdx && (kbField?.field === 'reps' || kbField?.field === 'repsR'))
        }
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

      {/* ── Meso feedback sheets ─────────────────────────────────────────────── */}

      {/* Soreness */}
      <Sheet open={mesoSorenessOpen} onClose={() => {}} title="Soreness check">
        <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 20, lineHeight: 1.5 }}>
          Any soreness carryover from your last <strong style={{ color: UI.ink }}>{mesoSorenessMusc}</strong> workout?
        </div>
        {[
          { key: 'never', label: 'Never sore', sub: 'No soreness from previous sessions' },
          { key: 'healed_long', label: 'Healed a while ago', sub: 'Fully recovered well before this session' },
          { key: 'healed_just', label: 'Healed just in time', sub: 'Recovered right around this session' },
          { key: 'still_sore', label: 'Still sore', sub: 'Still feeling last session in this muscle' },
        ].map(opt => {
          const sel = mesoSorenessSel === opt.key;
          return (
            <button key={opt.key} onClick={() => setMesoSorenessSel(opt.key)} style={{
              width: '100%', marginBottom: 8, padding: '12px 14px',
              background: sel ? `rgba(var(--accent-rgb),0.12)` : UI.bgInset,
              border: `1px solid ${sel ? 'var(--accent)' : UI.hairStrong}`,
              borderRadius: 6, cursor: 'pointer', textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
            }}>
              <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: sel ? 'var(--accent)' : UI.ink, fontWeight: 600 }}>{opt.label}</div>
              <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 2 }}>{opt.sub}</div>
            </button>
          );
        })}
        <Btn
          disabled={!mesoSorenessSel}
          onClick={() => handleSorenessAnswer(mesoSorenessSel, mesoSorenessMusc)}
          style={{ width: '100%', marginTop: 12 }}
        >
          {mesoEditingRef.current.soreness ? 'Save changes' : 'Confirm'}
        </Btn>
      </Sheet>

      {/* Joint discomfort */}
      <Sheet open={mesoJointOpen} onClose={() => {}} title="Joint check">
        <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 20, lineHeight: 1.5 }}>
          Any joint discomfort during <strong style={{ color: UI.ink }}>{mesoJointExName}</strong>?
        </div>
        {[
          { key: 'none', label: 'None', sub: 'All good — joints felt fine' },
          { key: 'noticeable', label: 'Noticeable', sub: 'Some discomfort but manageable' },
          { key: 'sharp', label: 'Sharp pain', sub: 'Clear pain — this exercise gets flagged' },
        ].map(opt => {
          const sel = mesoJointSel === opt.key;
          return (
            <button key={opt.key} onClick={() => setMesoJointSel(opt.key)} style={{
              width: '100%', marginBottom: 8, padding: '12px 14px',
              background: sel ? (opt.key === 'sharp' ? 'rgba(var(--danger-rgb),0.12)' : `rgba(var(--accent-rgb),0.12)`) : UI.bgInset,
              border: `1px solid ${sel ? (opt.key === 'sharp' ? 'rgba(var(--danger-rgb),0.6)' : 'var(--accent)') : (opt.key === 'sharp' ? 'rgba(var(--danger-rgb),0.4)' : UI.hairStrong)}`,
              borderRadius: 6, cursor: 'pointer', textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
            }}>
              <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: opt.key === 'sharp' ? UI.danger : (sel ? 'var(--accent)' : UI.ink), fontWeight: 600 }}>{opt.label}</div>
              <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 2 }}>{opt.sub}</div>
            </button>
          );
        })}
        <Btn
          disabled={!mesoJointSel}
          onClick={() => handleJointAnswer(mesoJointSel)}
          style={{ width: '100%', marginTop: 12 }}
        >
          {mesoEditingRef.current.joint ? 'Save changes' : 'Confirm'}
        </Btn>
      </Sheet>

      {/* Pump + Volume */}
      <Sheet open={mesoVolumeOpen} onClose={() => {}} title={mesoVolumeMusc ? `${mesoVolumeMusc} feedback` : 'Session feedback'}>
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 16, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Pump</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {[
            { key: 'low', label: 'Low', sub: 'Barely felt it' },
            { key: 'moderate', label: 'Moderate', sub: 'Decent pump' },
            { key: 'amazing', label: 'Amazing', sub: 'Skin-splitting' },
          ].map(opt => (
            <button key={opt.key} onClick={() => setMesoPumpAnswer(opt.key)} style={{
              flex: 1, padding: '10px 8px',
              background: mesoPumpAnswer === opt.key ? `rgba(var(--accent-rgb),0.12)` : UI.bgInset,
              border: `1px solid ${mesoPumpAnswer === opt.key ? 'var(--accent)' : UI.hairStrong}`,
              borderRadius: 6, cursor: 'pointer', textAlign: 'center',
              WebkitTapHighlightColor: 'transparent',
            }}>
              <div style={{ fontFamily: UI.fontUi, fontSize: 12, color: mesoPumpAnswer === opt.key ? 'var(--accent)' : UI.ink, fontWeight: 600 }}>{opt.label}</div>
              <div style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, marginTop: 2 }}>{opt.sub}</div>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Volume</div>
        <div style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.inkSoft, marginBottom: 14, lineHeight: 1.5 }}>Overall, how did the {mesoVolumeMusc ? mesoVolumeMusc.toLowerCase() + ' ' : ''}workload sit with you today?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {['not_enough', 'just_right', 'pushed', 'too_much'].map(key => {
            const label = key === 'not_enough' ? 'Not enough' : key === 'just_right' ? 'Just right' : key === 'pushed' ? 'Pushed my limits' : 'Too much';
            const sel = mesoVolumeAnswer === key;
            return (
              <button key={key} onClick={() => setMesoVolumeAnswer(key)} style={{
                width: '100%', padding: '10px 14px',
                background: sel ? `rgba(var(--accent-rgb),0.12)` : UI.bgInset,
                border: `1px solid ${sel ? 'var(--accent)' : UI.hairStrong}`,
                borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                WebkitTapHighlightColor: 'transparent',
              }}>
                <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: sel ? 'var(--accent)' : UI.ink, fontWeight: 600 }}>{label}</div>
              </button>
            );
          })}
        </div>
        <Btn
          disabled={!mesoPumpAnswer || !mesoVolumeAnswer}
          onClick={() => handleVolumeAnswer(mesoPumpAnswer, mesoVolumeAnswer)}
          style={{ width: '100%' }}
        >
          {mesoEditingRef.current.volume ? 'Save changes' : 'Save feedback'}
        </Btn>
      </Sheet>

      {/* Session feedback recap — two levels. This top sheet lists one button
          per muscle ("Chest feedback"); tapping it opens the detail sheet
          below with that muscle's individual answers (Soreness, each
          exercise's Joint check, Pump & Volume) to actually revise. Opened
          from the small square button in the footer nav (see "Footer nav"
          below). */}
      <Sheet open={mesoRecapOpen} onClose={() => setMesoRecapOpen(false)} title="Session feedback">
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.5 }}>
          Tap a muscle group to review and change its feedback — everything stays editable until you finish the session.
        </div>
        {mesoFeedbackGroups.map(group => (
          <button key={group.muscle} onClick={() => { setMesoRecapOpen(false); setMesoRecapDetailMuscle(group.muscle); }} style={{
            width: '100%', marginBottom: 8, padding: '12px 14px',
            background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
            borderRadius: 6, cursor: 'pointer', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <span style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, fontWeight: 600 }}>{group.muscle} feedback</span>
            <i className="fa-solid fa-chevron-right" style={{ fontSize: 11, color: UI.inkFaint, flexShrink: 0 }} />
          </button>
        ))}
      </Sheet>

      {/* Detail sheet for one muscle group's feedback, opened from the list
          above. Split into two sections so it's clear which answer applies to
          what: Joint feedback is per exercise, General feedback (Soreness +
          Pump & Volume) applies to the whole muscle group. */}
      {(() => {
        const detailGroup = mesoFeedbackGroups.find(g => g.muscle === mesoRecapDetailMuscle);
        const feedbackRow = row => (
          <button key={row.key} onClick={row.onEdit} style={{
            width: '100%', marginBottom: 8, padding: '12px 14px',
            background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
            borderRadius: 6, cursor: 'pointer', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.title}</div>
              <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 2 }}>{row.sub}</div>
            </div>
            <i className="fa-solid fa-chevron-right" style={{ fontSize: 11, color: UI.inkFaint, flexShrink: 0 }} />
          </button>
        );
        return (
          <Sheet open={!!mesoRecapDetailMuscle} onClose={() => setMesoRecapDetailMuscle(null)} title={mesoRecapDetailMuscle ? `${mesoRecapDetailMuscle} feedback` : 'Feedback'}>
            {!!detailGroup?.jointRows.length && (<>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>JOINT FEEDBACK</div>
              <div className="knurl" style={{ marginBottom: 10 }} />
              {detailGroup.jointRows.map(feedbackRow)}
            </>)}
            {!!detailGroup?.generalRows.length && (<>
              <div className="micro" style={{ color: UI.inkFaint, marginTop: detailGroup?.jointRows.length ? 16 : 0, marginBottom: 6 }}>GENERAL FEEDBACK</div>
              <div className="knurl" style={{ marginBottom: 10 }} />
              {detailGroup.generalRows.map(feedbackRow)}
            </>)}
          </Sheet>
        );
      })()}

      {/* Meso changes — post-session set/weight adjustment summary */}
      {mesoGainSheetOpen && (
        <Sheet open={mesoGainSheetOpen} onClose={() => {
          setMesoGainSheetOpen(false);
          go({ name: 'session', sessionId: mesoGainNavRef.current, justFinished: true });
        }} title="Next session">
          <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.inkSoft, marginBottom: 20, lineHeight: 1.5 }}>
            Based on your feedback, here's what changes next time:
          </div>
          {mesoGainItems.map((item, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 0',
              borderBottom: i < mesoGainItems.length - 1 ? `1px solid ${UI.hair}` : 'none',
            }}>
              <span style={{ fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600, color: UI.ink }}>{item.name}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {item.setDelta !== 0 && (
                  <span style={{ fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: item.setDelta > 0 ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.9)' }}>
                    {item.setDelta > 0 ? '+' : ''}{item.setDelta} set
                  </span>
                )}
                {item.weightDelta > 0 && (
                  <span style={{ fontFamily: UI.fontNum, fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>+{item.weightDelta} {UI.unit()}</span>
                )}
              </div>
            </div>
          ))}
          <Btn onClick={() => {
            setMesoGainSheetOpen(false);
            if (mesoJustCompletedRef.current) {
              mesoJustCompletedRef.current = false;
              handleMesoComplete();
            } else {
              go({ name: 'session', sessionId: mesoGainNavRef.current, justFinished: true });
            }
          }} style={{ width: '100%', marginTop: 20 }}>Got it</Btn>
        </Sheet>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}

    </Screen>
  );
}

// Shared title style for the Drop Set/Myo-Reps/AMRAP Variations chain
// sheet's header — matches the app's standard sheet-title treatment (same
// font/weight as Sheet's own `title` prop) instead of the tiny micro-gold
// label the header used before, so it reads as a real heading next to the
// deliberately quiet CANCEL button beside it.
const chainTitleStyle = { fontFamily: UI.fontDisplay, fontSize: 22, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--accent)' };

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
