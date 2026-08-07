/* Health screen, daily weight / steps / macros logging + dashboard charts.
   Optional tab (settings → showHealthTab). Daily logs live in store.dailyLogs
   and sync through the same diff model as cardio logs (UI mutates via setStore;
   store.js syncStore writes them). Adherence is computed + persisted at save
   time (LB.dailyLogAdherence) so a later macro-target change never rewrites
   history. Shares globals (UI, Screen, Sheet, Btn, WEEKDAYS, LB, React). */

const { useState: useStateH, useEffect: useEffectH, useMemo: useMemoH, useRef: useRefH } = React;

// ─── helpers ────────────────────────────────────────────────────────────────

const HEALTH_TFS = [{ id: '1W', days: 7 }, { id: '1M', days: 30 }, { id: '3M', days: 90 }];
// 1D only makes sense on cards you might log more than once a day (Glucose/
// BP/Body Temp), so it's a separate options list passed just to those, not
// added to HEALTH_TFS itself (every other card shares that one as-is). 1W/1M/
// 3M on those three cards still drive (and follow) the SAME shared tf state
// as every other card; 1D is a local-only overlay on top that never touches
// the shared value, see GlucoseCard/BloodPressureCard/BodyTempCard.
const HEALTH_TFS_TODAY = [{ id: '1D', days: 1 }, ...HEALTH_TFS];

// Whole-day difference between two 'YYYY-MM-DD' dates (b − a), noon-anchored to
// dodge DST/midnight shifts.
function healthDayDiff(a, b) {
  return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
}

// [start, end] ISO bounds for a trailing N-day window ending today.
function healthWindow(days) {
  const end = LB.todayISO();
  return { start: LB.shiftDate(end, -(days - 1)), end };
}

// [start, end] ISO bounds for the Mon-Sun calendar week containing `anchor`.
// Same formula as HealthDateStrip/computeHealthWeekStats use for the top date
// strip and "This Week" card, factored out so the 1W charts below can share
// it instead of quietly using a trailing 7-day window that floats with
// today's weekday and never lines up with the Monday-anchored week above it.
function healthMondayWeekBounds(anchor) {
  const jsDow = new Date(anchor + 'T12:00:00').getDay();
  const monday = LB.shiftDate(anchor, -((jsDow === 0 ? 7 : jsDow) - 1));
  return { start: monday, end: LB.shiftDate(monday, 6) };
}

const healthNum = v => (v === '' || v == null || isNaN(parseFloat(v))) ? null : parseFloat(String(v).replace(',', '.'));
const healthInt = v => (v === '' || v == null || isNaN(parseInt(v, 10))) ? null : parseInt(v, 10);

const caloriesFromMacros = LB.caloriesFromMacros;

// Windowed series builder for the charts, pure, so HealthScreen (dailyLogs)
// and HealthClientLogs (a coach's client logs) can share it instead of
// reimplementing the same ~90 lines against differently-named data.
// `windowOverride` (optional {start,end}) lets a caller replace the default
// trailing N-day window, used to align the 1W charts to the same
// Monday-anchored calendar week as the date strip / "This Week" card above
// them, instead of a rolling window that floats with today's weekday.
function healthSeriesFor(logs, days, pick, windowOverride) {
  const { start, end } = windowOverride || healthWindow(days);
  const data = logs.filter(l => l.date >= start && l.date <= end).map(l => ({ date: l.date, ...pick(l) }));
  const dates = data.map(d => d.date);
  let from = dates.length ? dates.reduce((a, b) => a < b ? a : b) : start;
  let to = dates.length ? dates.reduce((a, b) => a > b ? a : b) : end;
  if (from === to) { from = LB.shiftDate(from, -1); to = LB.shiftDate(to, 1); }
  return { from, to, data };
}

// Weight trend and plateau stats for the Weight card. Pure: takes the already
// windowed series points HealthLineChart plots (present days only), so trend
// and raw share x positions. Returns null below 3 weigh-ins (nothing to
// smooth, a 2-point mean is noise). Trend points are a trailing simple moving
// average over the last up-to-7 logged weigh-ins (partial windows at the
// series start). "Best" is goal-direction aware (goal = settings.macroCalc.goal,
// same field the AI daily summary feeds direction-aware): 'gain' means the
// HIGHEST weight is the best, 'cut' the lowest; 'maintain' or null means no
// direction is known, so no best and no plateau are reported (the app never
// guesses a direction, see store.js's buildDailySummaryPayload comment).
// best10 is the best value inside the trailing 10 calendar days from the last
// weigh-in, falling back to the whole-series best when no weigh-in falls in
// that window (sparse loggers). plateau is true when the series best was set
// 14+ calendar days ago, i.e. no better weigh-in since. Weight values are in
// the display unit, no conversion here.
function healthWeightTrend(pts, goal) {
  const sorted = (pts || []).filter(p => p.value != null).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 3) return null;
  const trendPoints = sorted.map((p, i) => ({
    date: p.date,
    value: sorted.slice(Math.max(0, i - 6), i + 1).reduce((s, q) => s + q.value, 0) / Math.min(7, i + 1),
  }));
  const directional = goal === 'gain' ? 1 : goal === 'cut' ? -1 : 0;
  // Better = (candidate - best) * directional > 0: gain ranks the HIGHEST
  // weight as best, cut the LOWEST. Strict comparison keeps the earliest
  // date on ties (when the best was first hit).
  let best = sorted[0];
  for (const p of sorted) { if ((p.value - best.value) * directional > 0) best = p; }
  const last = sorted[sorted.length - 1];
  const tenStart = LB.shiftDate(last.date, -9);
  const inTen = sorted.filter(p => p.date >= tenStart);
  const best10 = inTen.length ? inTen.reduce((b, p) => ((p.value - b.value) * directional > 0 ? p : b), inTen[0]) : best;
  return {
    trendPoints,
    trend: trendPoints[trendPoints.length - 1].value,
    best10: directional ? { value: best10.value, date: best10.date } : null,
    plateau: directional ? healthDayDiff(best.date, last.date) >= 14 : false,
    plateauDays: healthDayDiff(best.date, last.date),
  };
}

function healthCardioSeries(cardioLogs, days, windowOverride) {
  const { start, end } = windowOverride || healthWindow(days);
  const byDay = {};
  (cardioLogs || []).forEach(l => { if (l.date >= start && l.date <= end) byDay[l.date] = (byDay[l.date] || 0) + (l.durationMinutes || 0); });
  const data = Object.keys(byDay).map(date => ({ date, value: byDay[date] }));
  const dates = data.map(d => d.date);
  let from = dates.length ? dates.reduce((a, b) => a < b ? a : b) : start;
  let to = dates.length ? dates.reduce((a, b) => a > b ? a : b) : end;
  if (from === to) { from = LB.shiftDate(from, -1); to = LB.shiftDate(to, 1); }
  return { from, to, data };
}

// Period overview (Mon-anchored week or rolling 1M/3M window), pure, shared
// by HealthScreen and HealthClientLogs. planningState is whatever
// LB.plannedTrainingDay needs (store, or clientStore || {}).
function computeHealthWeekStats({ logs, sessions, cardioLogs, planningState, tf, today, selectedDate }) {
  const dayOf = s => s.date ? (typeof s.date === 'string' ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10)) : null;
  let from, to, periodDays;
  if (tf === '1W') {
    const anchor = selectedDate;
    const jsDow = new Date(anchor + 'T12:00:00').getDay();
    const monday = LB.shiftDate(anchor, -((jsDow === 0 ? 7 : jsDow) - 1));
    from = monday; to = LB.shiftDate(monday, 6); periodDays = 7;
  } else {
    const days = (HEALTH_TFS.find(t => t.id === tf) || HEALTH_TFS[1]).days;
    to = today; from = LB.shiftDate(today, -(days - 1)); periodDays = days;
  }
  const allDays = Array.from({ length: periodDays }, (_, i) => LB.shiftDate(from, i));
  const inPeriod = logs.filter(l => l.date >= from && l.date <= to);
  const avgK = k => { const vs = inPeriod.map(l => l[k]).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; };
  const sumK = k => { const vs = inPeriod.map(l => l[k]).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) : null; };
  const sessionDatesInPeriod = new Set((sessions || []).filter(s => s.ended).map(s => dayOf(s)).filter(d => d && d >= from && d <= to));
  const trainingsDone = sessionDatesInPeriod.size;
  // A completed session proves that day was a training day, so count done days
  // as planned too. plannedTrainingDay evaluates a past day against the CURRENT
  // plan, so after switching to a plan with fewer weekly training days the
  // sessions done under the old plan would otherwise exceed the new plan's
  // planned count (e.g. "4 / 1"). Flooring planned at done keeps it sane.
  const trainingsPlanned = allDays.filter(d => d <= today && (LB.plannedTrainingDay(planningState, d) || sessionDatesInPeriod.has(d))).length;
  // Training days for macro target avg: future planned days count as training (not yet missed),
  // past planned days only count if a session was actually done (missed = rest day, no earned macros).
  const trainingDaysInPeriod = allDays.filter(d => {
    if (!LB.plannedTrainingDay(planningState, d)) return false;
    if (d < today) return sessionDatesInPeriod.has(d);
    return true;
  }).length;
  const periodCardio = (cardioLogs || []).filter(l => l.date >= from && l.date <= to);
  // Historical target avg from persisted targetsSnap (correct even after target changes).
  // Only used for 1M/3M; 1W falls back to plan-weighted current targets in the card.
  // Only snapshots that actually carry macro numbers: a day-type-only snapshot
  // ({ dayType: 'rest' } with no calories/protein/…) would otherwise average in
  // as 0 and drag the 1M/3M target averages toward zero.
  const withSnap = tf !== '1W' ? inPeriod.filter(l => l.targetsSnap && l.targetsSnap.calories != null) : [];
  const avgSnap = k => withSnap.length ? Math.round(withSnap.reduce((s, l) => s + (l.targetsSnap[k] || 0), 0) / withSnap.length) : null;
  return {
    from, to, periodDays, daysLogged: inPeriod.length,
    mealOfChoice: inPeriod.filter(l => l.mealOfChoice).length,
    trainingsDone, trainingsPlanned, trainingDaysInPeriod,
    cardioMinutes: periodCardio.reduce((s, l) => s + (l.durationMinutes || 0), 0),
    cardioSessions: periodCardio.length,
    weight: avgK('weight'), steps: avgK('steps'),
    stepsSum: tf === '1W' ? sumK('steps') : null,
    calories: avgK('calories'), protein: avgK('protein'), carbs: avgK('carbs'),
    fat: avgK('fat'), water: avgK('waterMl'), adherence: avgK('adherence'),
    snapTgtCal: avgSnap('calories'), snapTgtProt: avgSnap('protein'),
    snapTgtCarb: avgSnap('carbs'), snapTgtFat: avgSnap('fat'),
  };
}

// Adherence → traffic-light colour (green ≥90, amber 75–89, red <75).
function adherenceColor(a) {
  if (a == null) return UI.inkFaint;
  if (a >= 90) return 'var(--ok)';
  if (a >= 75) return UI.warn;
  return 'var(--danger)';
}

// ─── glucose helpers ─────────────────────────────────────────────────────────

const GLUCOSE_FACTOR = 18.0182; // mmol/L → mg/dL
function glucoseDisplay(mmol, unit) {
  if (mmol == null) return null;
  return unit === 'mgdl' ? Math.round(mmol * GLUCOSE_FACTOR) : Math.round(mmol * 10) / 10;
}
function glucoseFromInput(raw, unit) {
  const n = parseFloat(String(raw).replace(',', '.'));
  if (!isFinite(n) || n <= 0) return null;
  return unit === 'mgdl' ? Math.round(n / GLUCOSE_FACTOR * 1000) / 1000 : n;
}
// Edit-form prefill: show the stored reading in the display unit but WITHOUT the
// display rounding, so re-saving an untouched value doesn't clobber the raw mmol.
function glucoseEditValue(mmol, unit) {
  if (mmol == null) return '';
  return String(unit === 'mgdl' ? Math.round(mmol * GLUCOSE_FACTOR) : mmol);
}
const glucoseUnitLabel = unit => unit === 'mgdl' ? 'mg/dL' : 'mmol/L';
const GLUCOSE_CTX_LABELS = { fasted: 'Fasted', fed: 'Fed', other: 'Other' };
// fasting normal range in mmol/L
const GLUCOSE_REF_LOW = 3.9, GLUCOSE_REF_HIGH = 5.6, GLUCOSE_REF_FED = 7.8;

// ─── body temperature helpers ───────────────────────────────────────────────
// Stored always in Celsius; display unit ('c'|'f') is a per-user setting, same
// pattern as glucose's mmol/mgdl. Unlike glucose's factor, C→F has an additive
// offset, not a pure ratio, so this is a small conversion pair, not a constant.

function tempDisplay(c, unit) {
  if (c == null) return null;
  const v = unit === 'f' ? c * 9 / 5 + 32 : c;
  return Math.round(v * 10) / 10;
}
function tempFromInput(raw, unit) {
  const n = parseFloat(String(raw).replace(',', '.'));
  if (!isFinite(n)) return null;
  const c = unit === 'f' ? (n - 32) * 5 / 9 : n;
  return Math.round(c * 100) / 100;
}
// Edit-form prefill: show the stored reading in the display unit but WITHOUT the
// display rounding, so re-saving an untouched value doesn't clobber the raw °C.
// c is stored to 2 decimals (tempFromInput), so c*9/5 needs at most 3 decimals
// to round-trip exactly; round to 4 purely to strip floating-point noise, not
// to lose precision.
function tempEditValue(c, unit) {
  if (c == null) return '';
  return String(unit === 'f' ? Math.round((c * 9 / 5 + 32) * 10000) / 10000 : c);
}
const tempUnitLabel = unit => unit === 'f' ? '°F' : '°C';
// Per-device, per-day dismissal for the fever "Mark today as Sick?" nudge: a
// decline is remembered for the rest of the day so a second elevated reading
// doesn't re-ask (mirrors the intent of the deload nudge's decline-tracking,
// scaled down since this is a low-stakes UI nag, not a synced setting).
const FEVER_NUDGE_DECLINE_KEY = 'logbook-fever-nudge-declined-date';

// "HH:MM" -> minutes since midnight, for the multi-reading-per-day scatter
// charts' todayMode x-axis (time-of-day instead of date). Null on anything
// unparsable rather than throwing, so a malformed/legacy time string degrades
// to "midnight" (start of the axis) instead of breaking the whole chart.
function timeToMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

// Scatter chart: one point per reading, connected by a thin trend line (unlike
// glucose, temperature has no fasted/fed context split, so its reading-to-
// reading trend is itself the meaningful signal). No reference band: a
// "normal" body temperature varies by measurement method and time of day, so a
// fixed band here would overclaim precision a home reading can't guarantee.
function TempScatterChart({ readings, from, to, unit, todayMode = false }) {
  const pts = (readings || []).filter(r => r.valueC != null && (todayMode ? r.date === to : (r.date >= from && r.date <= to)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  // No separate empty box in todayMode: the card's own "No readings logged
  // today yet" text below the (now also empty) feed list already covers it.
  if (!pts.length) return todayMode ? null : <HealthChartEmpty />;
  const W = 320, padL = 34, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;

  const dispVals = pts.map(p => tempDisplay(p.valueC, unit));
  const dom = UI.chartDomain(Math.min(...dispVals), Math.max(...dispVals));
  const totalDays = Math.max(1, healthDayDiff(from, to));
  // todayMode: one day's worth of readings would all collapse onto the same
  // date-based x position, so the x-axis switches to time-of-day instead.
  const xOf = todayMode
    ? p => padL + ((timeToMinutes(p.time) ?? 0) / 1440) * plotW
    : p => padL + (healthDayDiff(from, p.date) / totalDays) * plotW;
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  const dec = dom.range >= 4 ? 0 : 1;
  const gridVals = dom.gridVals || Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const unitLabel = tempUnitLabel(unit);
  const hoverPoints = pts.map(p => {
    const disp = tempDisplay(p.valueC, unit);
    return { x: xOf(p), y: yOf(disp), date: p.date, rows: [{ value: `${disp}${unitLabel}` }], sub: p.time };
  });

  return (
    <ChartHover W={W} H={H} points={hoverPoints}>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text filter="url(#chart-text-lift)" x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{Number(v.toFixed(dec))}</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {pts.length >= 2 && (
        <polyline points={pts.map(p => `${xOf(p).toFixed(1)},${yOf(tempDisplay(p.valueC, unit)).toFixed(1)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity={isLightCanvasActive() ? 0.8 : 0.5} />
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={xOf(p).toFixed(1)} cy={yOf(tempDisplay(p.valueC, unit)).toFixed(1)} r={3} fill="var(--accent)" opacity={0.85} />
      ))}
    </svg>
    </ChartHover>
  );
}

// ─── blood pressure helpers ─────────────────────────────────────────────────
// mmHg is a universal unit, so unlike glucose/temperature there is no display-
// unit setting or conversion pair here.

// Two-series scatter (systolic + diastolic dots on the same y-axis, mmHg),
// joined by a thin tie-line per reading. Two dashed reference lines mark the
// widely-cited "normal" upper bound (120 systolic / 80 diastolic, AHA/ESC),
// same treatment as glucose's single fed-line marker. Deliberately NOT a full
// color-tiered band: unlike glucose's single well-established fasting range,
// the full blood-pressure classification (elevated / stage 1 / stage 2 / crisis)
// is multi-tier and context-dependent (rest, time of day, measurement
// position), better left to the user's own doctor than baked in here.
const BP_REF_SYS = 120, BP_REF_DIA = 80;
function BpScatterChart({ readings, from, to, todayMode = false }) {
  const pts = (readings || []).filter(r => r.systolic != null && r.diastolic != null && (todayMode ? r.date === to : (r.date >= from && r.date <= to)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  // No separate empty box in todayMode: the card's own "No readings logged
  // today yet" text below the (now also empty) feed list already covers it.
  if (!pts.length) return todayMode ? null : <HealthChartEmpty />;
  const W = 320, padL = 34, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;

  const allVals = pts.flatMap(p => [p.systolic, p.diastolic]);
  const dom = UI.chartDomain(Math.min(...allVals, BP_REF_DIA), Math.max(...allVals, BP_REF_SYS));
  const totalDays = Math.max(1, healthDayDiff(from, to));
  // todayMode: one day's worth of readings would all collapse onto the same
  // date-based x position, so the x-axis switches to time-of-day instead.
  const xOf = todayMode
    ? p => padL + ((timeToMinutes(p.time) ?? 0) / 1440) * plotW
    : p => padL + (healthDayDiff(from, p.date) / totalDays) * plotW;
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  const gridVals = dom.gridVals || Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  // DIA_COLOR was a flat hex tuned for a dark canvas; on light/paper it drops
  // well under WCAG AA, so pick a deeper shade of the same blue there instead.
  const SYS_COLOR = 'var(--accent)', DIA_COLOR = isLightCanvasActive() ? '#0369a1' : '#4a9fe0';
  const hoverPoints = pts.map(p => ({
    x: xOf(p), y: yOf(p.systolic), date: p.date,
    rows: [
      { label: 'SYS', value: `${p.systolic} mmHg`, color: SYS_COLOR },
      { label: 'DIA', value: `${p.diastolic} mmHg`, color: DIA_COLOR },
    ],
    sub: p.time,
  }));

  return (
    <ChartHover W={W} H={H} points={hoverPoints} mode="xy">
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      <line x1={padL} y1={yOf(BP_REF_SYS).toFixed(1)} x2={W - padR} y2={yOf(BP_REF_SYS).toFixed(1)} stroke={SYS_COLOR} strokeWidth="0.75" strokeDasharray="4 3" opacity={isLightCanvasActive() ? 0.75 : 0.5} />
      <line x1={padL} y1={yOf(BP_REF_DIA).toFixed(1)} x2={W - padR} y2={yOf(BP_REF_DIA).toFixed(1)} stroke={DIA_COLOR} strokeWidth="0.75" strokeDasharray="4 3" opacity={isLightCanvasActive() ? 0.75 : 0.5} />
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text filter="url(#chart-text-lift)" x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{Math.round(v)}</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {pts.map((p, i) => (
        <React.Fragment key={i}>
          <line x1={xOf(p).toFixed(1)} y1={yOf(p.systolic).toFixed(1)} x2={xOf(p).toFixed(1)} y2={yOf(p.diastolic).toFixed(1)} stroke={UI.hair} strokeWidth="1" />
          <circle cx={xOf(p).toFixed(1)} cy={yOf(p.systolic).toFixed(1)} r={3} fill={SYS_COLOR} opacity={0.85} />
          <circle cx={xOf(p).toFixed(1)} cy={yOf(p.diastolic).toFixed(1)} r={3} fill={DIA_COLOR} opacity={0.85} />
        </React.Fragment>
      ))}
    </svg>
    </ChartHover>
  );
}

// Scatter chart: one point per reading, coloured by context, with a reference
// band for the fasting normal range (3.9–5.6 mmol/L).
function GlucoseScatterChart({ readings, from, to, unit, todayMode = false }) {
  const pts = (readings || []).filter(r => r.valueMmol != null && (todayMode ? r.date === to : (r.date >= from && r.date <= to)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  // No separate empty box in todayMode: the card's own "No readings logged
  // today yet" text below the (now also empty) feed list already covers it.
  if (!pts.length) return todayMode ? null : <HealthChartEmpty />;
  const W = 320, padL = 42, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;

  const refLow  = unit === 'mgdl' ? Math.round(GLUCOSE_REF_LOW  * GLUCOSE_FACTOR) : GLUCOSE_REF_LOW;
  const refHigh = unit === 'mgdl' ? Math.round(GLUCOSE_REF_HIGH * GLUCOSE_FACTOR) : GLUCOSE_REF_HIGH;
  const refFed  = unit === 'mgdl' ? Math.round(GLUCOSE_REF_FED  * GLUCOSE_FACTOR) : GLUCOSE_REF_FED;
  const dispVals = pts.map(p => glucoseDisplay(p.valueMmol, unit));
  const rawMin = Math.min(...dispVals, refLow);
  const rawMax = Math.max(...dispVals, refFed);
  const dom = UI.chartDomain(rawMin, rawMax);
  const totalDays = Math.max(1, healthDayDiff(from, to));
  // todayMode: one day's worth of readings would all collapse onto the same
  // date-based x position, so the x-axis switches to time-of-day instead.
  const xOf = todayMode
    ? p => padL + ((timeToMinutes(p.time) ?? 0) / 1440) * plotW
    : p => padL + (healthDayDiff(from, p.date) / totalDays) * plotW;
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  const dec = dom.range >= (unit === 'mgdl' ? 40 : 2) ? 0 : 1;
  const gridVals = Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const CTX_COLORS = { fasted: 'var(--accent)', fed: isLightCanvasActive() ? '#0369a1' : '#4a9fe0', other: UI.inkSoft };
  const CTX_LABELS = { fasted: 'Fasted', fed: 'Fed', other: 'Other' };
  const unitLabel = glucoseUnitLabel(unit);
  const fedY = yOf(refFed).toFixed(1);
  const hoverPoints = pts.map(p => {
    const disp = glucoseDisplay(p.valueMmol, unit);
    return {
      x: xOf(p), y: yOf(disp), date: p.date, color: CTX_COLORS[p.context] || UI.inkSoft,
      rows: [{ value: `${disp} ${unitLabel}`, color: CTX_COLORS[p.context] || UI.inkSoft }],
      sub: [CTX_LABELS[p.context] || p.context, p.time].filter(Boolean).join(' · '),
    };
  });

  return (
    <ChartHover W={W} H={H} points={hoverPoints} mode="xy">
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* fasted reference band */}
      <rect x={padL} y={yOf(refHigh).toFixed(1)} width={plotW} height={(yOf(refLow) - yOf(refHigh)).toFixed(1)}
        fill={`rgba(var(--accent-rgb),${isLightCanvasActive() ? 0.16 : 0.07})`} />
      {/* fed upper reference line */}
      <line x1={padL} y1={fedY} x2={W - padR} y2={fedY} stroke={isLightCanvasActive() ? '#0369a1' : '#4a9fe0'} strokeWidth="0.75" strokeDasharray="4 3" opacity="0.5" />
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text filter="url(#chart-text-lift)" x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{Number(v.toFixed(dec))}</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {pts.map((p, i) => {
        const disp = glucoseDisplay(p.valueMmol, unit);
        return <circle key={i} cx={xOf(p).toFixed(1)} cy={yOf(disp).toFixed(1)} r={3}
          fill={CTX_COLORS[p.context] || UI.inkSoft} opacity={0.85} />;
      })}
    </svg>
    </ChartHover>
  );
}

// ─── chart primitives ─────────────────────────────────────────────────────────

function HealthChartEmpty({ label }) {
  return (
    <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11 }}>
      {label || 'No data in this range yet'}
    </div>
  );
}

// Shared hover / touch-scrub tooltip for the health time-series charts. Each
// chart passes its plotted points in viewBox units (x, y) plus an ISO date and
// value rows; this wraps the SVG, follows the pointer (mouse hover or a touch
// drag), highlights the nearest point and floats a date + value box next to it.
// Every health chart uses the same `0 0 W H` viewBox scaled to the container
// width, so pointer→viewBox is one uniform scale (rect.width / W). It is a
// purely presentational overlay that renders nothing until the pointer is over a
// point, so screenshots / exports (no active pointer) stay clean.
//   points: [{ x, y, date:'YYYY-MM-DD', rows:[{label?, value, color?}], sub? }]
//   mode:   'x' (nearest by column, for lines/bars) | 'xy' (2D, for scatter)
const CHART_PLOT_TOP = 10, CHART_PLOT_H = 96; // padTop / plotH, shared by every chart

// Whether the current chart is squeezed into the Health tab's 2-col grid, as
// opposed to shown full-width via a card's expand button. Context instead of
// a prop threaded through every chart component + HealthChartCard: the grid
// and the expand sheet render the exact same card element (the expand sheet
// just clones it, see expandableCards in HealthScreen), and cloneElement is
// shallow, so a prop set on that outer clone never reaches the chart nested
// inside it. The grid wraps itself in Provider value={true}; the expand sheet
// is a sibling of the grid, not a descendant, so it never sees that override
// and stays at the default (false) below, no explicit "expanded" wrap needed.
const ChartCompactContext = React.createContext(false);

function ChartHover({ W, H, points, children, mode = 'x', markerColor = 'var(--accent)', hideHint = false }) {
  const wrapRef = useRefH(null);
  const [active, setActive] = useStateH(null);
  const compact = React.useContext(ChartCompactContext);

  const pick = (clientX, clientY) => {
    const el = wrapRef.current;
    if (!el || !points.length) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const vbX = ((clientX - rect.left) / rect.width) * W;
    const vbY = ((clientY - rect.top) / rect.height) * H;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - vbX, dy = points[i].y - vbY;
      const d = mode === 'xy' ? dx * dx + dy * dy : Math.abs(dx);
      if (d < bestD) { bestD = d; best = i; }
    }
    setActive(best);
  };
  // Activate on pointer MOVE only: mouse hover fires move continuously, a touch
  // scrub fires move while the finger drags. Deliberately not on pointerdown, so
  // a tap never flashes the box and starting a vertical scroll on a chart never
  // flickers one. No pointer capture: touchAction 'pan-y' lets the browser keep
  // vertical list-scrolling while we get horizontal drags.
  const onPoint = e => pick(e.clientX, e.clientY);
  const clear = () => setActive(null);

  // Guard the index: a time-frame switch can shrink `points` while a stale
  // `active` still points past the new end.
  const p = (active != null && points[active]) ? points[active] : null;
  const leftPct = p ? (p.x / W) * 100 : 0;
  const topPct = p ? (p.y / H) * 100 : 0;
  // Flip the box below a near-top point, and anchor it by horizontal thirds so
  // it never runs off either edge of the card.
  const below = p ? p.y < H * 0.42 : false;
  const tx = p ? (p.x < W * 0.28 ? '4px' : p.x > W * 0.72 ? 'calc(-100% - 4px)' : '-50%') : '-50%';
  const ty = below ? '10px' : 'calc(-100% - 10px)';

  return (
    <div ref={wrapRef} data-reorder-ignore="true"
      style={{ position: 'relative', touchAction: 'pan-y', cursor: points.length ? 'crosshair' : 'default' }}
      onPointerMove={onPoint} onPointerUp={clear} onPointerLeave={clear} onPointerCancel={clear}>
      {children}
      {!p && !compact && !hideHint && points.length > 0 && (
        <div style={{ position: 'absolute', top: 2, right: 4, pointerEvents: 'none' }}>
          <span className="micro" style={{ color: UI.inkGhost, letterSpacing: '0.08em' }}>Drag to inspect</span>
        </div>
      )}
      {p && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: leftPct + '%', top: (CHART_PLOT_TOP / H) * 100 + '%', height: (CHART_PLOT_H / H) * 100 + '%', width: 1, background: UI.hairStrong, transform: 'translateX(-0.5px)' }} />
          <div style={{ position: 'absolute', left: leftPct + '%', top: topPct + '%', width: 8, height: 8, borderRadius: '50%', background: p.color || markerColor, border: `2px solid ${UI.bgRaised}`, boxShadow: `0 0 0 1.5px ${p.color || markerColor}`, transform: 'translate(-50%, -50%)' }} />
          <div style={{ position: 'absolute', left: leftPct + '%', top: topPct + '%', transform: `translate(${tx}, ${ty})`, background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, padding: '5px 8px', boxShadow: '0 4px 14px rgba(0,0,0,0.45)', whiteSpace: 'nowrap', zIndex: 5 }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 2 }}>{LB.fmtDayLabel(p.date)}</div>
            {p.rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontFamily: UI.fontNum, fontSize: 12, lineHeight: '16px' }}>
                {r.label != null && <span style={{ fontSize: 9, color: r.color || UI.inkFaint, fontFamily: UI.fontUi, minWidth: 12 }}>{r.label}</span>}
                <span style={{ color: r.color || UI.ink }}>{r.value}</span>
              </div>
            ))}
            {p.sub && <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>{p.sub}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Bigger, bold, accent-colored card header, shared by every card in the
// Health tab (matches the Daily Log's category headers).
const HEALTH_CARD_HEADER_STYLE = { fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' };

// Section wrapper: title + 1W/1M/3M toggle + subtitle. `dragHandle` renders a
// reorder grip at the start of the header when the card is in a reorder list.
function HealthChartCard({ title, icon, tf, setTf, tfOptions = HEALTH_TFS, headline, sub, dragHandle, onExpand, onOpen, headerExtra, children }) {
  return (
    // height:100% so cards sharing a 2-col grid row match the tallest sibling
    // (a card without a headline/sub row, e.g. no data in range, would otherwise
    // end its visible border early since the grid item stretches but a plain
    // block child does not). No-op outside the grid: an undefined containing-
    // block height resolves height:100% back to auto (the expand sheet).
    <Card style={{ padding: 14, borderLeft: `3px solid ${UI.gold}`, height: '100%' }}>
      {/* flexWrap + the toggle's flexShrink:0 let the TF toggle drop to its own
          line instead of clipping when the card is narrow (2-col grid), full-
          width cards stay single-line since everything already fits there. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        {dragHandle}
        {icon && <i className={`fa-solid ${icon}`} style={{ fontSize: 11, color: UI.inkFaint }} />}
        <span style={{ ...HEALTH_CARD_HEADER_STYLE, flex: 1, minWidth: 60 }}>{title}</span>
        {headerExtra}
        {onOpen && (
          <button data-reorder-ignore="true" onClick={onOpen} aria-label="Open tracker" style={{
            background: 'transparent', border: 'none', padding: 2, cursor: 'pointer',
            color: UI.gold, display: 'flex', alignItems: 'center', flexShrink: 0,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <i className="fa-solid fa-arrow-up-right-from-square" style={{ fontSize: 11 }} />
          </button>
        )}
        {onExpand && (
          <button data-reorder-ignore="true" onClick={onExpand} aria-label="Expand" style={{
            background: 'transparent', border: 'none', padding: 2, cursor: 'pointer',
            color: UI.inkFaint, display: 'flex', alignItems: 'center', flexShrink: 0,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <i className="fa-solid fa-expand" style={{ fontSize: 11 }} />
          </button>
        )}
        <div data-reorder-ignore="true" style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, flexShrink: 0 }}>
          {tfOptions.map(t => (
            <button key={t.id} onClick={() => setTf(t.id)} style={{
              padding: '2px 8px', cursor: 'pointer', border: 'none',
              background: tf === t.id ? 'var(--accent)' : 'transparent',
              color: tf === t.id ? 'var(--accent-ink)' : UI.inkFaint,
              textShadow: tf === t.id ? 'none' : 'var(--text-lift)',
              fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
              WebkitTapHighlightColor: 'transparent',
            }}>{t.id}</button>
          ))}
        </div>
      </div>
      {(headline || sub) && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          {headline && <span className="num" style={{ fontSize: 22, color: UI.ink, fontWeight: 300 }}>{headline}</span>}
          {sub && <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>{sub}</span>}
        </div>
      )}
      {children}
    </Card>
  );
}

// Line chart over a date window. series = [{ date, value }] (present days only).
// trend (optional) = [{ date, value }] sharing the series dates, drawn as a
// dashed secondary line (the same treatment WaterDayChart gives its expected
// line); its values join the y-domain so the axis stays honest if the trend
// ever leaves the raw range.
function HealthLineChart({ series, from, to, format, color = 'var(--accent)', yMin, yMax, step, trend }) {
  const pts = (series || []).filter(p => p.value != null).sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return <HealthChartEmpty />;
  const W = 320, padL = 38, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;
  const vals = pts.map(p => p.value);
  const trendVals = (trend || []).filter(p => p.value != null).map(p => p.value);
  const dom = step
    ? UI.niceStepDomain(Math.min(...vals, ...trendVals), Math.max(...vals, ...trendVals), step, { min: yMin, max: yMax })
    : UI.chartDomain(Math.min(...vals, ...trendVals), Math.max(...vals, ...trendVals), { min: yMin, max: yMax });
  const totalDays = Math.max(1, healthDayDiff(from, to));
  const xOf = d => padL + (totalDays ? healthDayDiff(from, d) / totalDays : 0.5) * plotW;
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  // A fractional step (2.5 kg) needs 1 decimal to show the .5; a whole step
  // (5 lb) never produces one, so it can stay the old range-based heuristic.
  const dec = step ? (Number.isInteger(step) ? 0 : 1) : (dom.range >= 4 ? 0 : 1);
  const gridVals = dom.gridVals || Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const line = pts.map(p => `${xOf(p.date).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ');
  // Smoothed overlay: dashed secondary treatment, no points, no hover rows.
  // Trend points share the series dates, so xOf maps identically.
  const trendPts = (trend || []).filter(p => p.value != null);
  const trendLine = trendPts.length >= 2 ? trendPts.map(p => `${xOf(p.date).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ') : null;
  const base = (padTop + plotH).toFixed(1);
  // Hover rows carry the raw value plus, when a trend value exists for the
  // same date, the dashed line's value as a labeled second row.
  const trendByDate = new Map(trendPts.map(p => [p.date, p.value]));
  const hoverPoints = pts.map(p => {
    const rows = [{ value: format(p.value) }];
    const tv = trendByDate.get(p.date);
    // Trend values are computed means and carry float noise (99.9999...),
    // round to 1 decimal like every other weight display.
    if (tv != null) rows.push({ label: 'Trend', value: format(Math.round(tv * 10) / 10) });
    return { x: xOf(p.date), y: yOf(p.value), date: p.date, rows };
  });

  return (
    <ChartHover W={W} H={H} points={hoverPoints} markerColor={color}>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text filter="url(#chart-text-lift)" x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{format(Number(v.toFixed(dec)))}</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {pts.length >= 2 && (
        <>
          <polygon points={`${xOf(pts[0].date).toFixed(1)},${base} ${line} ${xOf(pts[pts.length - 1].date).toFixed(1)},${base}`} fill={`rgba(var(--accent-rgb),0.10)`} />
          {trendLine && <polyline points={trendLine} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.8" />}
          <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={xOf(p.date).toFixed(1)} cy={yOf(p.value).toFixed(1)} r={i === pts.length - 1 ? 3 : 2} fill={color} />
      ))}
    </svg>
    </ChartHover>
  );
}

// Trend / 10d best stat tiles plus the plateau pill, shared by the athlete
// and coach weight cards (each passes its own display unit and the
// goal-aware trend object from healthWeightTrend). Expanded chart only: the
// grid-squeezed cards skip the tiles (ChartCompactContext), the expand
// sheet renders them. Returns nothing when the helper returned null (fewer
// than 3 weigh-ins). With no known direction (goal maintain/null) only the
// Trend tile renders; the app never guesses a best direction. Mirrors the
// FdStatsBody statCard idiom; the row wraps (flex-basis 96) so the tiles
// stack full-width on narrow cards instead of ellipsing the value.
function WeightTrendChips({ trend, unit }) {
  if (!trend) return null;
  if (React.useContext(ChartCompactContext)) return null;
  const w = v => `${Math.round(v * 10) / 10}${unit}`;
  const tileLabel = { fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.inkFaint, fontFamily: UI.fontUi };
  const tileVal = { fontSize: 14, color: UI.ink, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const tile = { flex: '1 1 96px', minWidth: 0, background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, padding: '7px 9px' };
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <div style={tile}>
          <div style={tileLabel}>Trend</div>
          <div className="num" style={tileVal}>{w(trend.trend)}</div>
        </div>
        {trend.best10 && (
          <div style={tile}>
            <div style={tileLabel}>10d best</div>
            <div className="num" style={tileVal}>{w(trend.best10.value)}</div>
            <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 1 }}>{LB.fmtDayLabel(trend.best10.date, { day: 'numeric', month: 'short' })}</div>
          </div>
        )}
      </div>
      {trend.plateau && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start', background: 'rgba(var(--warn-rgb),0.12)', border: `var(--hair-width) solid ${UI.warn}`, borderRadius: 999, padding: '3px 9px', marginTop: 8 }}>
          <i className="fa-solid fa-pause" style={{ fontSize: 8, color: UI.warn }} />
          <span style={{ fontSize: 9, color: UI.warn, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Plateau · no new best in {trend.plateauDays}d</span>
        </div>
      )}
    </>
  );
}

// Body measurements card, shared by the athlete and coach Health tabs. One
// dropdown chip switches the metric (waist/hips/chest/arms/thighs/calves in
// cm, body fat in %, plus a derived BMI segment when a height is set), each
// drawing the line chart with the directionless trend. Only the ACTIVE
// metric's series is built per render, not all eight, and the whole card
// lives once here instead of being copied between the two views.
function BodyStatsCard({ logs, tf, selectedDate, setTf, dragHandle, onExpand, weekWindow, windowDays, heightCm, weightIsLbs }) {
  const [bodyMetric, setBodyMetric] = useStateH('waist');
  const [bmMenuOpen, setBmMenuOpen] = useStateH(false);
  const activeBodyMetric = (bodyMetric === 'bmi' && heightCm == null) ? 'waist' : bodyMetric;
  const bmConfig = {
    waist: { label: 'Waist', unit: 'cm', step: 5 },
    hips: { label: 'Hips', unit: 'cm', step: 5 },
    chest: { label: 'Chest', unit: 'cm', step: 5 },
    arms: { label: 'Arms', unit: 'cm', step: 5 },
    thighs: { label: 'Thighs', unit: 'cm', step: 5 },
    calves: { label: 'Calves', unit: 'cm', step: 5 },
    bodyFat: { label: 'Fat %', unit: '%', step: 5 },
    bmi: { label: 'BMI', unit: '', step: 1 },
  };
  const bmOptions = heightCm != null
    ? ['waist', 'hips', 'chest', 'arms', 'thighs', 'calves', 'bodyFat', 'bmi']
    : ['waist', 'hips', 'chest', 'arms', 'thighs', 'calves', 'bodyFat'];
  // Lazy series: only the active metric is scanned per window change (plus
  // BMI when selected), instead of building all seven plus BMI every time.
  const bmField = { waist: 'waistCm', hips: 'hipsCm', chest: 'chestCm', arms: 'armCm', thighs: 'thighCm', calves: 'calfCm', bodyFat: 'bodyFatPct' };
  const bmSeries = useMemoH(() => {
    if (activeBodyMetric === 'bmi') {
      // Weight is stored in the display unit, BMI always computes in kg
      // (LBS_TO_KG, same factor as the estimator).
      return healthSeriesFor(logs, windowDays, l => ({
        value: (l.weight != null && heightCm != null)
          ? Math.round((weightIsLbs ? l.weight * LBS_TO_KG : l.weight) / Math.pow(heightCm / 100, 2) * 100) / 100
          : null,
      }), weekWindow);
    }
    return healthSeriesFor(logs, windowDays, l => ({ value: l[bmField[activeBodyMetric]] }), weekWindow);
    // Deps on primitives only, like every other series memo in this file:
    // weekWindow/windowDays are derived from (tf, selectedDate), so keying
    // on the fresh object would recompute on every render in the 1W view.
  }, [logs, tf, selectedDate, activeBodyMetric, heightCm, weightIsLbs]);
  const bmTrend = useMemoH(() => healthWeightTrend(bmSeries.data, null), [bmSeries.data]);
  const bmLatest = useMemoH(() => {
    const pts = bmSeries.data.filter(p => p.value != null);
    if (!pts.length) return null;
    return pts.reduce((a, b) => (a.date > b.date ? a : b)).value;
  }, [bmSeries.data]);
  const bmUnit = bmConfig[activeBodyMetric].unit;
  return (
    <HealthChartCard title="Body Stats" icon="fa-ruler" tf={tf} setTf={setTf} dragHandle={dragHandle} onExpand={onExpand}
      headline={bmLatest != null ? `${Math.round(bmLatest * 10) / 10}${bmUnit}` : null} sub={bmLatest != null ? 'latest' : null}>
      {/* Metric switcher: ONE dropdown chip (too many metrics for a
          segmented row). Shows the active metric plus a chevron that flips
          while the anchored menu is open; the floating list follows the
          TabBar reveal-menu idiom, a transparent fixed backdrop closes it
          on any outside tap. */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <button data-reorder-ignore="true" onClick={() => setBmMenuOpen(v => !v)} aria-expanded={bmMenuOpen} aria-label="Choose measurement"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 8px', cursor: 'pointer', border: 'none', borderRadius: 4,
            background: bmMenuOpen ? 'var(--accent)' : 'rgba(var(--accent-rgb),0.12)', color: bmMenuOpen ? 'var(--accent-ink)' : 'var(--accent)',
            textShadow: 'none', fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent' }}>
          {bmConfig[activeBodyMetric].label}
          <i className={`fa-solid fa-chevron-${bmMenuOpen ? 'up' : 'down'}`} style={{ fontSize: 7 }} />
        </button>
        {bmMenuOpen && (
          <>
            <div onClick={() => setBmMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 4, background: 'transparent' }} />
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 5, minWidth: 132, background: 'var(--bg)', border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', padding: 4 }}>
              {bmOptions.map(id => (
                <button key={id} onClick={() => { setBodyMetric(id); setBmMenuOpen(false); }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', padding: '6px 8px', cursor: 'pointer', border: 'none', background: 'transparent', borderRadius: 4,
                    color: activeBodyMetric === id ? 'var(--accent)' : UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, fontWeight: activeBodyMetric === id ? 700 : 400, WebkitTapHighlightColor: 'transparent' }}>
                  {bmConfig[id].label}
                  {activeBodyMetric === id && <i className="fa-solid fa-check" style={{ fontSize: 9 }} />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <HealthLineChart series={bmSeries.data} from={bmSeries.from} to={bmSeries.to} format={v => `${v}${bmUnit}`} step={bmConfig[activeBodyMetric].step} trend={bmTrend?.trendPoints} />
      <WeightTrendChips trend={bmTrend} unit={bmUnit} />
    </HealthChartCard>
  );
}

// Bar chart over a date window. series = [{ date, value }].
function HealthBarChart({ series, from, to, format, target, color = 'var(--accent)', colorSoft = `rgba(var(--accent-rgb),0.35)` }) {
  const pts = (series || []).filter(p => p.value != null && p.value > 0);
  if (!pts.length) return <HealthChartEmpty />;
  const W = 320, padL = 38, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;
  const maxV = Math.max(...pts.map(p => p.value), target || 0);
  const dom = UI.chartDomain(0, maxV, { min: 0 });
  const totalDays = Math.max(1, healthDayDiff(from, to));
  const bw = Math.max(2, Math.min(16, plotW / (totalDays + 1) * 0.7));
  // Inset both ends by half a bar (+gap) so the first/last bars never bleed
  // into the y-axis labels or right edge, matters most in the 1W view.
  const inset = bw / 2 + 3;
  const xOf = d => padL + inset + (totalDays ? healthDayDiff(from, d) / totalDays : 0.5) * (plotW - 2 * inset);
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  const gridVals = Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const hoverPoints = pts.map(p => ({ x: xOf(p.date), y: yOf(p.value), date: p.date, rows: [{ value: format(p.value) }] }));

  return (
    <ChartHover W={W} H={H} points={hoverPoints}>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text filter="url(#chart-text-lift)" x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{format(Math.round(v))}</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {target != null && target > 0 && (
        <line x1={padL} y1={yOf(target).toFixed(1)} x2={W - padR} y2={yOf(target).toFixed(1)} stroke={color} strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
      )}
      {pts.map((p, i) => {
        const x = xOf(p.date) - bw / 2;
        const y = yOf(p.value);
        const h = (padTop + plotH) - y;
        const above = target && p.value >= target;
        return <rect key={i} x={x.toFixed(1)} y={y.toFixed(1)} width={bw.toFixed(1)} height={Math.max(0, h).toFixed(1)} rx="1"
          fill={above ? color : colorSoft} />;
      })}
    </svg>
    </ChartHover>
  );
}

// Stacked macro bars (protein / carbs / fat by calories) + per-day target tick.
// protein uses the fixed --info blue rather than --accent: --accent is
// user-customizable and collides with --ok/--danger the moment someone
// picks green or red as their accent (a red accent made protein and fat
// read as the same color here). Fixed generally, not just for red.
const MACRO_COLORS = { protein: 'var(--info)', carbs: 'var(--ok)', fat: 'var(--danger)' };
function HealthMacroChart({ series, from, to }) {
  // series = [{ date, protein, carbs, fat, calories, targetCal }]
  const pts = (series || []).filter(p => (p.protein != null || p.carbs != null || p.fat != null));
  if (!pts.length) return <HealthChartEmpty />;
  const W = 320, padL = 38, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;
  // Use net carbs (fiber-reduced) so the bar height matches the logged calories
  // on net-carb days; for total-carb days fiber is null → unchanged.
  const calOf = p => caloriesFromMacros(p.protein, p.carbs, p.fat, p.fiber) || 0;
  const maxV = Math.max(...pts.map(p => Math.max(calOf(p), p.targetCal || 0)), 1);
  const dom = UI.chartDomain(0, maxV, { min: 0 });
  const totalDays = Math.max(1, healthDayDiff(from, to));
  const bw = Math.max(2, Math.min(16, plotW / (totalDays + 1) * 0.7));
  // Inset both ends by half a bar (+gap) so the first/last bars never bleed
  // into the y-axis labels or right edge, matters most in the 1W view.
  const inset = bw / 2 + 3;
  const xOf = d => padL + inset + (totalDays ? healthDayDiff(from, d) / totalDays : 0.5) * (plotW - 2 * inset);
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  const gridVals = Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const hoverPoints = pts.map(p => ({
    x: xOf(p.date), y: yOf(calOf(p)), date: p.date,
    rows: [
      { value: `${Math.round(calOf(p))} kcal` },
      { label: 'P', value: `${p.protein ?? 0}g`, color: MACRO_COLORS.protein },
      // Net carbs (fiber-reduced), matching the drawn segment + the kcal above;
      // for total-carb days fiber is null so this equals the logged carbs.
      { label: 'C', value: `${Math.max(0, (p.carbs ?? 0) - (p.fiber ?? 0))}g`, color: MACRO_COLORS.carbs },
      { label: 'F', value: `${p.fat ?? 0}g`, color: MACRO_COLORS.fat },
    ],
  }));

  return (
    <ChartHover W={W} H={H} points={hoverPoints}>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text filter="url(#chart-text-lift)" x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{Math.round(v / 100) / 10}k</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {pts.map((p, i) => {
        const x = xOf(p.date) - bw / 2;
        const segs = [
          { cal: (p.protein || 0) * 4, color: MACRO_COLORS.protein },
          { cal: Math.max(0, (p.carbs || 0) - (p.fiber || 0)) * 4, color: MACRO_COLORS.carbs },
          { cal: (p.fat || 0) * 9, color: MACRO_COLORS.fat },
        ];
        let yCursor = padTop + plotH;
        const rects = segs.map((s, si) => {
          const h = (s.cal / dom.range) * plotH;
          yCursor -= h;
          return <rect key={si} x={x.toFixed(1)} y={yCursor.toFixed(1)} width={bw.toFixed(1)} height={Math.max(0, h).toFixed(1)} fill={s.color} opacity="0.85" />;
        });
        const tick = (p.targetCal != null && p.targetCal > 0) ? (
          <line x1={(x - 1).toFixed(1)} y1={yOf(p.targetCal).toFixed(1)} x2={(x + bw + 1).toFixed(1)} y2={yOf(p.targetCal).toFixed(1)} stroke={UI.ink} strokeWidth="1.2" />
        ) : null;
        return <g key={i}>{rects}{tick}</g>;
      })}
    </svg>
    </ChartHover>
  );
}

function MacroLegend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, rowGap: 6, justifyContent: 'center', marginTop: 10 }}>
      {[['Protein', MACRO_COLORS.protein], ['Carbs', MACRO_COLORS.carbs], ['Fat', MACRO_COLORS.fat], ['Target', UI.ink]].map(([lbl, col]) => (
        <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 4, background: col, display: 'inline-block' }} />
          <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.04em' }}>{lbl}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Daily log screen ─────────────────────────────────────────────────────────

// One card per category: clickable chevron header, optional right-aligned
// extra content (a unit tag, a toggle) that doesn't itself trigger the
// collapse, and its fields below when expanded. Defined at module scope
// (not inside DailyLogScreen) so its function identity is stable across
// renders: an inline definition would make React remount the whole
// subtree (killing input focus/keyboard) on every keystroke.
function CatSection({ label, extra, collapsed, onToggle, children }) {
  return (
    <Card style={{ padding: '12px 14px', marginBottom: 12, borderLeft: `3px solid ${UI.gold}` }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', marginBottom: collapsed ? 0 : 10 }}>
        <i className={`fa-solid fa-chevron-${collapsed ? 'right' : 'down'}`} style={{ fontSize: 9, color: collapsed ? UI.inkGhost : 'var(--accent)', width: 9, flexShrink: 0, transition: 'color 0.15s' }} />
        <span style={{ fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: collapsed ? UI.inkFaint : 'var(--accent)', flex: 1, transition: 'color 0.15s' }}>{label}</span>
        {extra}
      </div>
      {!collapsed && children}
    </Card>
  );
}

function DailyLogScreen({ open, onClose, store, setStore, date, targets, activeCoachingSchema, onSetStatus, userId, glucoseLogs, glucoseUnit, bloodPressureLogs, bodyTempLogs, tempUnit, go }) {
  // Always-current store snapshot: saveTemp's fever nudge awaits a Supabase
  // write and then a user-interaction-gated confirm dialog, both arbitrarily
  // long, so it re-reads statusMode from this ref (not the closed-over
  // `store` prop) right before mutating it, to notice a status change made
  // elsewhere in this same sheet while that wait was in flight.
  const storeRef = useRefH(store);
  storeRef.current = store;
  const existing = useMemoH(() => (store.dailyLogs || []).find(l => l.date === date), [store.dailyLogs, date]);
  // The water tracker owns a day's total once it has any entry for that day:
  // it recomputes and overwrites water_ml on its own every time a drink is
  // logged there, so a manual edit here would silently vanish on the next
  // one. The tracker can now backlog any day (its own day-nav,
  // screens-water.jsx), not just today, so this locks per-date rather than
  // only for today. store.waterLogs loads in full at boot (no history
  // window, unlike store.foodLogs below), so a plain per-date check here is
  // already the true state, no lazy-fetch needed to verify an older date.
  // Locked until the user explicitly opts to override for this session (see
  // requestWaterUnlock below); a day with no tracker entries stays plain.
  const waterHasTrackerEntries = useMemoH(
    () => (store.waterLogs || []).some(l => l.date === date),
    [store.waterLogs, date],
  );
  const [waterUnlocked, setWaterUnlocked] = useStateH(false);
  const waterLocked = waterHasTrackerEntries && !waterUnlocked;
  // The Food Tracker owns protein/carbs/fat/fiber/calories for a day the
  // moment it has any entry for that day, same "tracker owns this field"
  // pattern as water above, but per-date rather than today-only: backdated
  // food logging is in scope, so a past day can lock too.
  const foodHasTrackerEntries = useMemoH(
    () => (store.foodLogs || []).some(l => l.date === date),
    [store.foodLogs, date],
  );
  // store.foodLogs is windowed to LB.FOOD_HISTORY_WINDOW_DAYS days, so a date
  // older than that can have real Food Tracker entries server-side that the
  // check above can never see locally: it would then read a genuinely
  // tracked old day as untracked. Lock those days too (can't verify locally,
  // so don't risk a silent overwrite) instead of trusting an absence that
  // might just be the window, not the truth. Reads the constant off LB
  // rather than declaring its own copy: this file and store.js are both
  // classic scripts sharing one global scope, so a same-named top-level
  // const in both throws "already been declared" and silently kills every
  // other declaration in whichever of the two loads second.
  //
  // Dates outside FOOD_HISTORY_WINDOW_DAYS never arrive from boot, so
  // foodHasTrackerEntries above can't see them yet: lazy-fetch date on demand
  // (mirrors the fetch FoodScreen uses for its own history scrollback) so the
  // lock reflects the true state instead of guessing. foodChecking holds the
  // lock back while that fetch is in flight, rather than briefly flashing
  // "unlocked" for a day that turns out to have entries a moment later.
  const foodHistCutoff = useMemoH(() => LB.historyWindowCutoffISO(new Date(), LB.FOOD_HISTORY_WINDOW_DAYS), []);
  const [foodChecking, setFoodChecking] = useStateH(false);
  useEffectH(() => {
    if (date >= foodHistCutoff) { setFoodChecking(false); return; }
    setFoodChecking(true);
    let on = true;
    LB.fetchFoodLogsForDates(userId, [date]).then(byDate => {
      if (!on) return;
      setFoodChecking(false);
      const entries = byDate[date];
      if (entries && entries.length) {
        setStore(s => (s.foodLogs || []).some(l => l.date === date) ? s : { ...s, foodLogs: [...(s.foodLogs || []), ...entries] });
      }
    }).catch(() => { if (on) setFoodChecking(false); });
    return () => { on = false; };
  }, [date, foodHistCutoff, userId]);
  const [foodUnlocked, setFoodUnlocked] = useStateH(false);
  const foodLocked = (foodHasTrackerEntries || foodChecking) && !foodUnlocked;
  const todayISO = LB.todayISO();
  const dayStatusPeriod = useMemoH(() => {
    const ts = new Date(date + 'T12:00:00').getTime();
    return (store.statusPeriods || []).find(p => {
      const start = new Date(p.startedAt).getTime();
      const end = p.endedAt ? new Date(p.endedAt).getTime() : Date.now();
      return ts >= start && ts <= end;
    }) || null;
  }, [date, store.statusPeriods]);
  const dayMode = date === todayISO ? (store.statusMode ?? null) : (dayStatusPeriod?.mode || null);
  // Flex plans have no programmed rest days: the Training|Rest choice lives on
  // the Health-tab header (HealthDateStrip) and persists to the log's
  // targetsSnap.dayType. Here it only matters so a macro-less save can't wipe an
  // existing override off the day's log.
  const flexActive = useMemoH(
    () => LB.isFlexPlan((store.schedules || []).find(s => s.id === store.activeScheduleId)),
    [store.schedules, store.activeScheduleId]
  );
  const empty = { weight: '', steps: '', waistCm: '', hipsCm: '', chestCm: '', armCm: '', thighCm: '', calfCm: '', bodyFatPct: '', protein: '', carbs: '', fat: '', fiber: '', calories: '', water: '', note: '', offPlanNote: '' };
  const [form, setForm] = useStateH(empty);
  // Net-carb mode: adds a fiber field; calories become (P + C − fiber)×4 + F×9.
  // Defaults to the user's global preference; an existing net-logged day (fiber
  // set) re-opens in net mode regardless, so its fiber value is preserved.
  const [netCarbs, setNetCarbs] = useStateH(!!store.settings?.netCarbs);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const coachFields = useMemoH(() => {
    if (!activeCoachingSchema) return [];
    const numericTypes = new Set(['integer', 'decimal', 'stepper']);
    return activeCoachingSchema.flatMap(s => s.fields || []).filter(f => f.show_in_health_log && numericTypes.has(f.type));
  }, [activeCoachingSchema]);
  const [coachForm, setCoachForm] = useStateH({});
  const setCoachVal = (k, v) => setCoachForm(f => ({ ...f, [k]: v }));
  const [confirmEl, confirm] = useConfirm();

  // The two training overlays in the status picker below. They are not plain
  // status flips like sick/vacation: each owns a whole cycle, carries its own
  // start alignment and coaching note, and a cleanup also reads the stored
  // reduction, so both go through their LB start/end functions rather than
  // onSetStatus. The wording mirrors the Plan tab's own buttons so the two
  // entry points cannot drift apart.
  // Every pick in the status row confirms first: the buttons are icon-only, so
  // a mistap has no label to catch it, and switching away from a status ends
  // whatever was running. Named in prose here so the prompts can say which one.
  const statusName = (m) => m === 'sick' ? 'sick day' : m === 'vacation' ? 'vacation'
    : m === 'deload' ? 'deload week' : m === 'cleanup' ? 'cleanup week' : 'normal training';
  const pickPlainStatus = async (mode) => {
    const backdate = date < todayISO ? date : null;
    const current = dayMode;
    // Leaving an overlay runs its own end function so the coaching thread gets
    // the closing note; that path does its own confirm.
    if (mode === null && (store.statusMode === 'deload' || store.statusMode === 'cleanup') && date === todayISO) { endOverlayStatus(); return; }
    const ends = current ? ` This will end your ${statusName(current)}.` : '';
    const msg = mode === null
      ? `Set status to normal.${ends}`
      : `Mark this day as ${statusName(mode)}.${ends}`;
    if (!await confirm(msg, { title: mode === null ? 'Back to normal' : `Set ${statusName(mode)}`, ok: 'Set' })) return;
    onSetStatus(mode, backdate);
  };

  // Cleanup opens the same sheet the Plan tab uses (CleanupStartBody, ui.jsx),
  // so the reduction can be picked here too rather than silently reusing
  // whatever was chosen last.
  const [cleanupSheet, setCleanupSheet] = useStateH(false);
  const [cleanupDraftPct, setCleanupDraftPct] = useStateH(20);
  const cleanupStartISO = LB.nextCleanupStartISO(store);
  const startOverlayStatus = async (mode) => {
    const lead = store.statusMode ? `This will end your ${statusName(store.statusMode)}. ` : '';
    if (mode === 'cleanup') {
      if (store.statusMode && !await confirm(`${lead}Start a cleanup week instead?`,
        { title: 'Start cleanup', ok: 'Continue' })) return;
      setCleanupDraftPct(Math.min(30, Math.max(10, Math.round(store.settings?.cleanupPercent ?? 20))));
      setCleanupSheet(true);
      return;
    }
    if (!await confirm(`${lead}Train your normal plan at ~50% load for one cycle. Weights pre-fill light and the week is excluded from progression. Start now?`,
      { title: 'Start deload week', ok: 'Start deload' })) return;
    await LB.startDeload(userId, store, setStore);
  };
  const startCleanupWithPct = async () => {
    const pct = Math.min(30, Math.max(10, Math.round(cleanupDraftPct)));
    setCleanupSheet(false);
    setStore(s => ({ ...s, settings: { ...s.settings, cleanupPercent: pct } }));
    // Re-resolved here rather than reusing the render-time value: the sheet can
    // sit open across midnight, which would move the boundary.
    await LB.startCleanup(userId, { ...store, settings: { ...store.settings, cleanupPercent: pct } }, setStore, LB.nextCleanupStartISO(store));
  };
  const endOverlayStatus = async () => {
    const isCleanup = store.statusMode === 'cleanup';
    const running = !isCleanup || LB.cleanupStarted(store);
    const what = isCleanup ? 'cleanup' : 'deload';
    const [msg, ok] = running
      ? [`End the ${what} week and return to normal training?`, `End ${what}`]
      : [`Call off the ${what} week before it starts?`, 'Call it off'];
    if (!await confirm(msg, { title: running ? `End ${what}` : `Cancel ${what}`, ok })) return;
    if (isCleanup) await LB.endCleanup(userId, store, setStore);
    else await LB.endDeload(userId, store, setStore);
  };

  // Snapshot of the form as it was opened, to detect unsaved edits on dismiss.
  const initialSnap = useRefH({ form: empty, coach: {}, net: false });

  // Categories the user has never once filled in start collapsed, so a sheet
  // that's grown to include glucose/BP/temp/etc. doesn't bury the fields
  // someone actually uses under ones they don't. Computed once per open (not
  // live-reactive), so filling one in for the first time doesn't yank the
  // section shut mid-edit; a manual toggle always wins until the sheet
  // re-opens.
  const [collapsedCats, setCollapsedCats] = useStateH(new Set());
  const toggleCat = (key) => setCollapsedCats(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  useEffectH(() => {
    if (!open) return;
    const everUsed = {
      body: (store.dailyLogs || []).some(l => l.weight != null || l.steps != null),
      measurements: (store.dailyLogs || []).some(l => l.waistCm != null || l.hipsCm != null || l.chestCm != null || l.armCm != null || l.thighCm != null || l.calfCm != null || l.bodyFatPct != null),
      nutrition: (store.dailyLogs || []).some(l => l.protein != null || l.carbs != null || l.fat != null || l.calories != null || l.offPlanNote),
      hydration: (store.dailyLogs || []).some(l => l.waterMl != null),
      note: (store.dailyLogs || []).some(l => l.note),
      glucose: (store.glucoseLogs || []).length > 0,
      bloodPressure: (store.bloodPressureLogs || []).length > 0,
      bodyTemp: (store.bodyTempLogs || []).length > 0,
    };
    setCollapsedCats(new Set(Object.keys(everUsed).filter(k => !everUsed[k])));
  }, [open]);

  // ── Glucose readings for this day ──
  const glUnit = glucoseUnit || 'mmol';
  const glucoseForDay = useMemoH(
    () => (glucoseLogs || []).filter(l => l.date === date).sort((a, b) => a.time.localeCompare(b.time)),
    [glucoseLogs, date]
  );
  const emptyGl = { value: '', time: '', context: 'fasted', note: '' };
  const [addingGlucose, setAddingGlucose] = useStateH(false);
  const [glForm, setGlForm] = useStateH(emptyGl);
  const [editingGlucoseId, setEditingGlucoseId] = useStateH(null);
  const [confirmDeleteGlId, setConfirmDeleteGlId] = useStateH(null);
  const setGl = (k, v) => setGlForm(f => ({ ...f, [k]: v }));

  // ── Blood pressure readings for this day ──
  const bpForDay = useMemoH(
    () => (bloodPressureLogs || []).filter(l => l.date === date).sort((a, b) => a.time.localeCompare(b.time)),
    [bloodPressureLogs, date]
  );
  const emptyBp = { systolic: '', diastolic: '', time: '', note: '' };
  const [addingBp, setAddingBp] = useStateH(false);
  const [bpForm, setBpForm] = useStateH(emptyBp);
  const [editingBpId, setEditingBpId] = useStateH(null);
  const [confirmDeleteBpId, setConfirmDeleteBpId] = useStateH(null);
  const [savingBp, setSavingBp] = useStateH(false);
  const setBp = (k, v) => setBpForm(f => ({ ...f, [k]: v }));

  // ── Body temperature readings for this day ──
  const tUnit = tempUnit || 'c';
  const tempForDay = useMemoH(
    () => (bodyTempLogs || []).filter(l => l.date === date).sort((a, b) => a.time.localeCompare(b.time)),
    [bodyTempLogs, date]
  );
  const emptyTemp = { value: '', time: '', note: '' };
  const [addingTemp, setAddingTemp] = useStateH(false);
  const [tempForm, setTempForm] = useStateH(emptyTemp);
  const [editingTempId, setEditingTempId] = useStateH(null);
  const [confirmDeleteTempId, setConfirmDeleteTempId] = useStateH(null);
  const [savingTemp, setSavingTemp] = useStateH(false);
  const setTemp = (k, v) => setTempForm(f => ({ ...f, [k]: v }));

  useEffectH(() => {
    if (!open) {
      setAddingGlucose(false); setGlForm(emptyGl); setEditingGlucoseId(null); setConfirmDeleteGlId(null);
      setAddingBp(false); setBpForm(emptyBp); setEditingBpId(null); setConfirmDeleteBpId(null); setSavingBp(false);
      setAddingTemp(false); setTempForm(emptyTemp); setEditingTempId(null); setConfirmDeleteTempId(null); setSavingTemp(false);
    }
  }, [open]);

  // Normalize a free-text time to zero-padded HH:MM (so entries sort
  // correctly) and fall back to now if it's blank or invalid ("9", "25:99").
  const normEntryTime = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim());
    if (!m) return null;
    const h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return null;
    return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  };

  // Glucose, blood pressure and body temperature are written straight to
  // Supabase and are NOT part of the syncStore diff, so a failed write has no
  // offline retry behind it: the optimistic row is rolled back and the reading
  // is simply gone. Rolling back silently made that look like the entry was
  // never typed. Always say so.
  const warnWriteFailed = async (what) => {
    await confirm(`Could not save your ${what}. Check your connection and enter it again.`, { title: 'Not saved', ok: 'OK', cancel: null });
  };

  const saveBp = async () => {
    if (savingBp) return;
    const sys = parseInt(bpForm.systolic, 10), dia = parseInt(bpForm.diastolic, 10);
    if (!isFinite(sys) || sys <= 0 || !isFinite(dia) || dia <= 0) {
      await confirm('Enter a systolic and diastolic value above 0.', { title: 'Invalid reading', ok: 'OK', cancel: null });
      return;
    }
    setSavingBp(true);
    try {
      const time = normEntryTime(bpForm.time) || new Date().toTimeString().slice(0, 5);
      if (editingBpId) {
        const origEntry = (store.bloodPressureLogs || []).find(l => l.id === editingBpId);
        const updated = { ...origEntry, time, systolic: sys, diastolic: dia, note: bpForm.note.trim() || null };
        setStore(s => ({ ...s, bloodPressureLogs: (s.bloodPressureLogs || []).map(l => l.id === editingBpId ? updated : l) }));
        setEditingBpId(null); setAddingBp(false); setBpForm(emptyBp);
        const { error } = await LB.supabase.from('zane_blood_pressure_logs').update({ time, systolic: sys, diastolic: dia, note: updated.note }).eq('id', editingBpId).eq('user_id', userId);
        if (error) { if (origEntry) setStore(s => ({ ...s, bloodPressureLogs: (s.bloodPressureLogs || []).map(l => l.id === editingBpId ? origEntry : l) })); await warnWriteFailed('blood pressure reading'); }
      } else {
        const entry = { id: LB.uid(), date, time, systolic: sys, diastolic: dia, note: bpForm.note.trim() || null, createdAt: new Date().toISOString() };
        setStore(s => ({ ...s, bloodPressureLogs: [entry, ...(s.bloodPressureLogs || [])] }));
        setAddingBp(false); setBpForm(emptyBp);
        const { error } = await LB.supabase.from('zane_blood_pressure_logs').insert({ id: entry.id, user_id: userId, date: entry.date, time: entry.time, systolic: entry.systolic, diastolic: entry.diastolic, note: entry.note });
        if (error) { setStore(s => ({ ...s, bloodPressureLogs: (s.bloodPressureLogs || []).filter(l => l.id !== entry.id) })); await warnWriteFailed('blood pressure reading'); }
      }
    } finally {
      setSavingBp(false);
    }
  };

  const deleteBp = async (id) => {
    setConfirmDeleteBpId(null);
    const orig = (store.bloodPressureLogs || []).find(l => l.id === id);
    setStore(s => ({ ...s, bloodPressureLogs: (s.bloodPressureLogs || []).filter(l => l.id !== id) }));
    const { error } = await LB.supabase.from('zane_blood_pressure_logs').delete().eq('id', id).eq('user_id', userId);
    if (error) { if (orig) setStore(s => ({ ...s, bloodPressureLogs: [orig, ...(s.bloodPressureLogs || [])] })); await warnWriteFailed('deletion'); }
  };

  const saveTemp = async () => {
    if (savingTemp) return;
    const c = tempFromInput(tempForm.value, tUnit);
    if (c == null) {
      await confirm('Enter a valid temperature.', { title: 'Invalid reading', ok: 'OK', cancel: null });
      return;
    }
    setSavingTemp(true);
    try {
      const time = normEntryTime(tempForm.time) || new Date().toTimeString().slice(0, 5);
      let ok = true;
      if (editingTempId) {
        const origEntry = (store.bodyTempLogs || []).find(l => l.id === editingTempId);
        const updated = { ...origEntry, time, valueC: c, note: tempForm.note.trim() || null };
        setStore(s => ({ ...s, bodyTempLogs: (s.bodyTempLogs || []).map(l => l.id === editingTempId ? updated : l) }));
        setEditingTempId(null); setAddingTemp(false); setTempForm(emptyTemp);
        const { error } = await LB.supabase.from('zane_body_temp_logs').update({ time, value_c: c, note: updated.note }).eq('id', editingTempId).eq('user_id', userId);
        if (error) { ok = false; if (origEntry) setStore(s => ({ ...s, bodyTempLogs: (s.bodyTempLogs || []).map(l => l.id === editingTempId ? origEntry : l) })); await warnWriteFailed('temperature reading'); }
      } else {
        const entry = { id: LB.uid(), date, time, valueC: c, note: tempForm.note.trim() || null, createdAt: new Date().toISOString() };
        setStore(s => ({ ...s, bodyTempLogs: [entry, ...(s.bodyTempLogs || [])] }));
        setAddingTemp(false); setTempForm(emptyTemp);
        const { error } = await LB.supabase.from('zane_body_temp_logs').insert({ id: entry.id, user_id: userId, date: entry.date, time: entry.time, value_c: entry.valueC, note: entry.note });
        if (error) { setStore(s => ({ ...s, bodyTempLogs: (s.bodyTempLogs || []).filter(l => l.id !== entry.id) })); ok = false; await warnWriteFailed('temperature reading'); }
      }
      // Fever nudge: only for a reading logged against TODAY (status is a
      // "right now" concept, see dayMode above), only once (skip if already
      // marked Sick or already declined today), and only after a write that
      // actually stuck.
      let declinedToday = false;
      try { declinedToday = localStorage.getItem(FEVER_NUDGE_DECLINE_KEY) === todayISO; } catch (_) {}
      if (ok && onSetStatus && date === todayISO && !declinedToday && storeRef.current.statusMode !== 'sick' && c >= (store.settings?.feverThresholdC ?? 38)) {
        const disp = tempDisplay(c, tUnit);
        const markSick = await confirm(`You logged ${disp}${tempUnitLabel(tUnit)}. Mark today as Sick?`, { title: 'Fever detected', ok: 'Mark Sick', cancel: 'Not now' });
        // Re-check via the live ref, not the closed-over `store`: status may
        // have changed (e.g. a Sick/Vacation/Normal tap in this same sheet)
        // while the write above or this confirm dialog was pending.
        if (markSick && storeRef.current.statusMode !== 'sick') onSetStatus('sick', null);
        else if (!markSick) { try { localStorage.setItem(FEVER_NUDGE_DECLINE_KEY, todayISO); } catch (_) {} }
      }
    } finally {
      setSavingTemp(false);
    }
  };

  const deleteTemp = async (id) => {
    setConfirmDeleteTempId(null);
    const orig = (store.bodyTempLogs || []).find(l => l.id === id);
    setStore(s => ({ ...s, bodyTempLogs: (s.bodyTempLogs || []).filter(l => l.id !== id) }));
    const { error } = await LB.supabase.from('zane_body_temp_logs').delete().eq('id', id).eq('user_id', userId);
    if (error) { if (orig) setStore(s => ({ ...s, bodyTempLogs: [orig, ...(s.bodyTempLogs || [])] })); await warnWriteFailed('deletion'); }
  };

  const saveGlucose = async () => {
    const mmol = glucoseFromInput(glForm.value, glUnit);
    // Same "Invalid reading" feedback the BP and temperature forms in this very
    // sheet give: a silent return looked like the Save button was dead.
    if (mmol == null) {
      await confirm('Enter a valid glucose value.', { title: 'Invalid reading', ok: 'OK', cancel: null });
      return;
    }
    // Normalize the free-text time to zero-padded HH:MM (so entries sort
    // correctly) and fall back to now if it's blank or invalid ("9", "25:99").
    const normTime = (s) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim());
      if (!m) return null;
      const h = +m[1], min = +m[2];
      if (h > 23 || min > 59) return null;
      return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
    };
    const time = normTime(glForm.time) || new Date().toTimeString().slice(0, 5);
    if (editingGlucoseId) {
      const origEntry = (store.glucoseLogs || []).find(l => l.id === editingGlucoseId);
      const updated = { ...origEntry, time, valueMmol: mmol, context: glForm.context || 'fasted', note: glForm.note.trim() || null };
      setStore(s => ({ ...s, glucoseLogs: (s.glucoseLogs || []).map(l => l.id === editingGlucoseId ? updated : l) }));
      setEditingGlucoseId(null); setAddingGlucose(false); setGlForm(emptyGl);
      const { error } = await LB.supabase.from('zane_glucose_logs').update({ time, value_mmol: mmol, context: updated.context, note: updated.note }).eq('id', editingGlucoseId).eq('user_id', userId);
      if (error) { if (origEntry) setStore(s => ({ ...s, glucoseLogs: (s.glucoseLogs || []).map(l => l.id === editingGlucoseId ? origEntry : l) })); await warnWriteFailed('glucose reading'); }
    } else {
      const entry = { id: LB.uid(), date, time, valueMmol: mmol, context: glForm.context || 'fasted', note: glForm.note.trim() || null, createdAt: new Date().toISOString() };
      setStore(s => ({ ...s, glucoseLogs: [entry, ...(s.glucoseLogs || [])] }));
      setAddingGlucose(false); setGlForm(emptyGl);
      const { error } = await LB.supabase.from('zane_glucose_logs').insert({ id: entry.id, user_id: userId, date: entry.date, time: entry.time, value_mmol: entry.valueMmol, context: entry.context, note: entry.note });
      if (error) { setStore(s => ({ ...s, glucoseLogs: (s.glucoseLogs || []).filter(l => l.id !== entry.id) })); await warnWriteFailed('glucose reading'); }
    }
  };

  const deleteGlucose = async (id) => {
    setConfirmDeleteGlId(null);
    const orig = (store.glucoseLogs || []).find(l => l.id === id);
    setStore(s => ({ ...s, glucoseLogs: (s.glucoseLogs || []).filter(l => l.id !== id) }));
    const { error } = await LB.supabase.from('zane_glucose_logs').delete().eq('id', id).eq('user_id', userId);
    if (error) { if (orig) setStore(s => ({ ...s, glucoseLogs: [orig, ...(s.glucoseLogs || [])] })); await warnWriteFailed('deletion'); }
  };

  useEffectH(() => {
    if (!open) return;
    setWaterUnlocked(false);
    setFoodUnlocked(false);
    const net = existing?.fiber != null ? true : !!store.settings?.netCarbs;
    setNetCarbs(net);
    // Blank the calories field when the saved value matches what the saved
    // macros alone would produce, so it keeps auto-updating live as macros
    // are edited again. A genuine manual override (saved value differs from
    // the macro-derived one) is preserved instead of being silently dropped.
    const existingAutoCals = existing
      ? (net
          ? (existing.protein != null && existing.carbs != null && existing.fat != null && existing.fiber != null
              ? caloriesFromMacros(existing.protein, existing.carbs, existing.fat, existing.fiber)
              : null)
          : caloriesFromMacros(existing.protein, existing.carbs, existing.fat))
      : null;
    const nextForm = existing ? {
      weight: existing.weight != null ? String(existing.weight) : '',
      steps: existing.steps != null ? String(existing.steps) : '',
      waistCm: existing.waistCm != null ? String(existing.waistCm) : '',
      hipsCm: existing.hipsCm != null ? String(existing.hipsCm) : '',
      chestCm: existing.chestCm != null ? String(existing.chestCm) : '',
      armCm: existing.armCm != null ? String(existing.armCm) : '',
      thighCm: existing.thighCm != null ? String(existing.thighCm) : '',
      calfCm: existing.calfCm != null ? String(existing.calfCm) : '',
      bodyFatPct: existing.bodyFatPct != null ? String(existing.bodyFatPct) : '',
      protein: existing.protein != null ? String(existing.protein) : '',
      carbs: existing.carbs != null ? String(existing.carbs) : '',
      fat: existing.fat != null ? String(existing.fat) : '',
      fiber: existing.fiber != null ? String(existing.fiber) : '',
      calories: (existing.calories != null && existing.calories !== existingAutoCals) ? String(existing.calories) : '',
      water: existing.waterMl != null ? String(UI.waterToEntry(existing.waterMl)) : '',
      note: existing.note || '',
      offPlanNote: existing.offPlanNote || '',
    } : empty;
    setForm(nextForm);
    const cf = {};
    coachFields.forEach(f => {
      const v = existing?.coachFields?.[f.key];
      cf[f.key] = f.type === 'stepper' ? (v != null ? v : null) : (v != null ? String(v) : '');
    });
    setCoachForm(cf);
    initialSnap.current = { form: nextForm, coach: cf, net };
  }, [open, date, existing?.id]);

  const daysBack = healthDayDiff(date, LB.todayISO());
  const inFuture = daysBack < 0;
  const tooOld = !existing && daysBack > 14;
  const canSave = open && !inFuture && !tooOld;

  const pVal = healthInt(form.protein), cVal = healthInt(form.carbs), fVal = healthInt(form.fat), fibVal = healthInt(form.fiber);
  const netCarbsVal = (cVal != null && fibVal != null) ? Math.max(0, cVal - fibVal) : null;
  // Net mode only auto-fills calories once protein/carbs/fat/fiber are all present;
  // otherwise the calories field is manual. Total mode keeps the existing behaviour.
  const netAllFilled = pVal != null && cVal != null && fVal != null && fibVal != null;
  const autoCals = netCarbs
    ? (netAllFilled ? caloriesFromMacros(pVal, cVal, fVal, fibVal) : null)
    : caloriesFromMacros(pVal, cVal, fVal);

  // Confirm before a backdrop tap throws away unsaved edits to this day.
  const isDirty = () =>
    JSON.stringify(form) !== JSON.stringify(initialSnap.current.form) ||
    JSON.stringify(coachForm) !== JSON.stringify(initialSnap.current.coach) ||
    netCarbs !== initialSnap.current.net;
  const requestClose = async () => {
    if (isDirty() && !await confirm('Your changes to this day won\'t be saved.', { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    onClose();
  };

  const save = () => {
    if (!canSave) return;
    // Belt and suspenders, same reasoning as waterMl below: the locked fields
    // render no real input while foodLocked (see the NUTRITION section), but
    // save() itself never trusts the form for them either, so nothing can
    // persist an override the user never confirmed through requestFoodUnlock.
    const protein = foodLocked ? (existing?.protein ?? null) : healthInt(form.protein);
    const carbs = foodLocked ? (existing?.carbs ?? null) : healthInt(form.carbs);
    const fat = foodLocked ? (existing?.fat ?? null) : healthInt(form.fat);
    const fiber = foodLocked ? (existing?.fiber ?? null) : (netCarbs ? healthInt(form.fiber) : null);
    const calories = foodLocked ? (existing?.calories ?? null) : (form.calories !== '' ? healthInt(form.calories) : autoCals);
    // Single source of truth for the day type: a logged session wins, then a
    // flex Training|Rest override (set from the header), then cycle/week's
    // planned-day assumption (flex defaults to rest).
    const isTraining = LB.isTrainingDayForDate(store, date);
    // This hands dailyLogAdherence a synthetic literal rather than the row,
    // so the meal-of-choice flag has to be passed in explicitly: it does not
    // ride along the way it does for the callers that pass the real log.
    let { adherence, targetsSnap } = dayMode
      ? { adherence: null, targetsSnap: null }
      : LB.dailyLogAdherence({ protein, carbs, fat, mealOfChoice: existing?.mealOfChoice }, targets, isTraining);
    // Don't let a macro-less save (incomplete macros / no macro targets) wipe an
    // existing flex day-type override off the log.
    if (!dayMode && flexActive && !targetsSnap) {
      const dt = existing?.targetsSnap?.dayType;
      if (dt === 'training' || dt === 'rest') targetsSnap = { dayType: dt };
    }
    const savedCoachFields = {};
    coachFields.forEach(f => {
      const v = toResponse(f, coachForm[f.key]);
      if (v != null) savedCoachFields[f.key] = v;
    });
    const log = {
      id: existing?.id || LB.uid(),
      date,
      weight: healthNum(form.weight),
      steps: healthInt(form.steps),
      waistCm: healthNum(form.waistCm),
      hipsCm: healthNum(form.hipsCm),
      chestCm: healthNum(form.chestCm),
      armCm: healthNum(form.armCm),
      thighCm: healthNum(form.thighCm),
      calfCm: healthNum(form.calfCm),
      bodyFatPct: healthNum(form.bodyFatPct),
      calories, protein, carbs, fat, fiber,
      // Belt and suspenders: the locked field has no real input to type into
      // (see the HYDRATION section below), but save() itself never trusts
      // form.water while locked either, so nothing can persist an override
      // the user never confirmed through requestWaterUnlock.
      waterMl: waterLocked ? (existing?.waterMl ?? null) : (healthInt(form.water) != null ? UI.waterEntryToMl(healthInt(form.water)) : null),
      note: form.note.trim() || null,
      adherence, targetsSnap,
      offPlanNote: form.offPlanNote.trim() || null,
      // Rebuilt from scratch rather than spread from existing, so anything
      // not listed here is dropped: without this line, saving the form on a
      // marked day unmarks it and the day starts being scored again. The hour
      // rides along the same way, or a save from this form would silently
      // reset the food module's timeline slot for the day back to default.
      mealOfChoice: !!existing?.mealOfChoice,
      mealOfChoiceHour: existing?.mealOfChoiceHour ?? null,
      coachFields: Object.keys(savedCoachFields).length ? savedCoachFields : null,
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    // Only carry the carb mode into global settings when the user actively
    // toggled it this session. Otherwise merely opening and saving an old day
    // whose fiber value inferred net mode would silently flip the global default.
    const userToggledMode = !!(initialSnap.current && netCarbs !== initialSnap.current.net);
    setStore(s => ({
      ...s,
      // Remember the carb mode globally so the next day defaults to it.
      settings: (userToggledMode && s.settings?.netCarbs !== netCarbs) ? { ...s.settings, netCarbs } : s.settings,
      dailyLogs: [log, ...(s.dailyLogs || []).filter(l => l.id !== log.id && l.date !== date)],
    }));
    onClose();
  };

  const del = async () => {
    if (!existing) return;
    if (!await confirm("Delete this day's log? Weight, macros, steps and water for this day are removed.", { title: 'Delete day?', ok: 'Delete', danger: true })) return;
    setStore(s => ({ ...s, dailyLogs: (s.dailyLogs || []).filter(l => l.id !== existing.id) }));
    onClose();
  };

  const requestWaterUnlock = async () => {
    const ok = await confirm(
      "This day already has entries in the Water Tracker. Editing it here will be overwritten the next time you log a drink there.",
      { title: 'Overwrite water tracker?', ok: 'Continue', cancel: 'Cancel' }
    );
    if (ok) setWaterUnlocked(true);
  };

  const requestFoodUnlock = async () => {
    const ok = await confirm(
      "This day already has entries in the Food Tracker. Editing it here will be overwritten the next time you log food there.",
      { title: 'Overwrite food tracker?', ok: 'Continue', cancel: 'Cancel' }
    );
    if (ok) setFoodUnlocked(true);
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', background: UI.bgInset,
    border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4,
    padding: '10px 12px', fontFamily: UI.fontNum, fontSize: 15, color: UI.ink, outline: 'none',
  };
  const labelStyle = { fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.07em' };
  const numField = (k, label, unit, locked = false) => (
    <div style={{ flex: 1 }}>
      <div style={labelStyle}>{label}{unit ? ` (${unit})` : ''}</div>
      {locked
        ? <div onClick={requestFoodUnlock} style={{ ...inputStyle, opacity: 0.45, cursor: 'pointer' }}>{form[k] || ''}</div>
        : <input type="text" inputMode="decimal" placeholder="" value={form[k]} onChange={e => set(k, e.target.value)} style={inputStyle} />}
    </div>
  );
  const waterQuickAddTileStyle = { padding: '10px 12px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, whiteSpace: 'nowrap' };

  // Full page (not a Sheet): the form has 15+ fields across several sections
  // plus the glucose/BP/temp add-forms, a bottom sheet's ~88dvh cap made it
  // cramped. position:fixed so it takes over the whole viewport regardless of
  // where it's mounted (HealthScreen or HomeScreen's Quick Actions both render
  // it locally, gated on their own open state, same as the Sheet it replaces,
  // it isn't wired into the app's go()/route system). zIndex:100 matches
  // Sheet's own backdrop convention, so it still sits under the confirm dialog
  // (useConfirm's Sheet, portaled to document.body, same z-index but later in
  // the DOM so it paints on top).
  if (!open) return null;
  return (
    <Screen scroll={false} style={{ position: 'fixed', inset: 0, zIndex: 100, animation: 'sheet-up 0.22s ease' }}>
      <TopBar title={existing ? 'Edit Day' : 'Log Day'} onBack={requestClose} />
      {/* Only this middle section scrolls, so Delete/Save stay pinned to the
          bottom edge (see the footer below): this form is long enough that
          having to scroll all the way down after every single edit was the
          main friction in logging a day. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px 22px' }}>
      {confirmEl}
      <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 14 }}>
        {LB.fmtDayLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>

      {onSetStatus && (
        <div style={{ marginBottom: 18 }}>
          {/* Five states, icon-only: SICK, CLEANUP, NORMAL, DELOAD, VACATION,
              with NORMAL centred so the two training overlays sit either side
              of it and the two away-from-training ones on the outside.
              Sick/vacation are plain status flips and can be backdated; the
              two overlays are not, they own a whole cycle and are started
              through their own functions (alignment, percentage, coaching
              note), so they are today-only and confirm first. */}
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
            {[
              { mode: 'sick', label: 'Sick', icon: 'fa-bed-pulse' },
              { mode: 'cleanup', label: 'Cleanup week', icon: 'fa-broom', overlay: true },
              { mode: null, label: 'Normal', icon: 'fa-circle-check' },
              { mode: 'deload', label: 'Deload week', icon: 'fa-battery-quarter', overlay: true },
              { mode: 'vacation', label: 'Vacation', icon: 'fa-umbrella-beach' },
            ].map(({ mode, label, icon, overlay }, i) => {
              const active = dayMode === mode;
              // An overlay can only be started for today: backdating one would
              // claim a cycle's worth of reduced training that never happened.
              const disabled = !!overlay && date !== todayISO;
              return (
                <button key={String(mode)} aria-label={label} title={disabled ? `${label} can only be started for today` : label}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled || active) return;
                    if (overlay) { startOverlayStatus(mode); return; }
                    pickPlainStatus(mode);
                  }} style={{
                  flex: 1, padding: '14px 4px', cursor: disabled ? 'default' : 'pointer', border: 'none',
                  borderLeft: i > 0 ? `var(--hair-width) solid ${UI.hairStrong}` : 'none',
                  background: active ? 'var(--accent)' : 'transparent',
                  textShadow: active ? 'none' : 'var(--text-lift)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: disabled ? 0.35 : 1,
                  WebkitTapHighlightColor: 'transparent', transition: 'background 0.15s',
                }}>
                  <i className={`fa-solid ${icon}`} style={{ fontSize: 15, color: active ? 'var(--accent-ink)' : UI.inkFaint }} />
                </button>
              );
            })}
          </div>
          {/* A cleanup's start is pinned to the next cycle, so it is shown, not
              edited: the input below caps at today and would render an
              out-of-range value for a start that is still ahead. */}
          {dayMode === 'cleanup' && date === todayISO && store.statusModeSince && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span className="micro" style={{ color: UI.inkGhost }}>{LB.cleanupStarted(store) ? 'SINCE' : 'STARTS'}</span>
              <span className="num" style={{ color: 'var(--accent)', fontSize: 12 }}>
                {new Date(store.statusModeSince).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
              </span>
            </div>
          )}
          {dayMode && dayMode !== 'cleanup' && date === todayISO && (() => {
            const minDate = (() => { const d = new Date(); d.setDate(d.getDate() - 14); return LB.fmtISO(d); })();
            // LB.fmtISO(new Date(...)), not a bare slice: statusModeSince is a
            // UTC timestamp, slicing its first 10 chars gives the UTC date,
            // which is a different calendar day than the local one for any
            // non-UTC viewer around midnight.
            const currentVal = store.statusModeSince ? LB.fmtISO(new Date(store.statusModeSince)) : todayISO;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span className="micro" style={{ color: UI.inkGhost }}>SINCE</span>
                <input type="date" value={currentVal} min={minDate} max={todayISO}
                  onChange={e => e.target.value && onSetStatus(store.statusMode, e.target.value)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontFamily: UI.fontNum, fontSize: 12, cursor: 'pointer', outline: 'none', padding: 0 }} />
              </div>
            );
          })()}
          {dayStatusPeriod && date !== todayISO && (
            <div style={{ marginTop: 8, fontSize: 11, fontFamily: UI.fontUi, color: UI.inkFaint }}>
              {new Date(dayStatusPeriod.startedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
              {' → '}
              {dayStatusPeriod.endedAt
                ? new Date(dayStatusPeriod.endedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
                : 'ongoing'}
            </div>
          )}
        </div>
      )}

      {tooOld && (
        <div style={{ fontSize: 11, color: 'var(--danger)', fontFamily: UI.fontUi, padding: '8px 10px', background: 'rgba(var(--danger-rgb),0.1)', borderRadius: 4, marginBottom: 14 }}>
          You can only create a new entry up to 14 days back.
        </div>
      )}

      <CatSection label="BODY" collapsed={collapsedCats.has('body')} onToggle={() => toggleCat('body')}>
        <div style={{ display: 'flex', gap: 8 }}>
          {numField('weight', 'Weight', UI.unit())}
          {numField('steps', 'Steps')}
        </div>
      </CatSection>

      <CatSection label="NUTRITION" collapsed={collapsedCats.has('nutrition')} onToggle={() => toggleCat('nutrition')} extra={
        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
          {[{ id: false, label: 'Total carbs' }, { id: true, label: 'Net carbs' }].map(o => (
            <button key={String(o.id)} onClick={() => setNetCarbs(o.id)} style={{
              padding: '4px 10px', cursor: 'pointer', border: 'none',
              background: netCarbs === o.id ? 'var(--accent)' : 'transparent',
              color: netCarbs === o.id ? 'var(--accent-ink)' : UI.inkFaint,
              textShadow: netCarbs === o.id ? 'none' : 'var(--text-lift)',
              fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.05em',
              WebkitTapHighlightColor: 'transparent',
            }}>{o.label}</button>
          ))}
        </div>
      }>
        {/* Food is an independently-toggleable tab now: this shortcut only
            makes sense when there's actually a Food tab to land on. */}
        {go && store.settings?.showFoodTab && (
          <button onClick={() => go({ name: 'food', date })} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: '0 0 10px', color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
            Log food <i className="fa-solid fa-arrow-right" style={{ fontSize: 9 }} />
          </button>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {numField('protein', 'Protein', 'g', foodLocked)}
          {numField('carbs', 'Carbs', 'g', foodLocked)}
          {numField('fat', 'Fat', 'g', foodLocked)}
        </div>
        {netCarbs && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {numField('fiber', 'Fiber', 'g', foodLocked)}
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Net carbs (g)</div>
              <div style={{ ...inputStyle, color: netCarbsVal != null ? UI.inkSoft : UI.inkGhost, pointerEvents: 'none', userSelect: 'none' }}>
                {netCarbsVal != null ? netCarbsVal : '—'}
              </div>
            </div>
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Calories (kcal){autoCals != null && form.calories === '' ? (netCarbs ? ' · net carbs' : ' · from macros') : ''}</div>
          {foodLocked
            ? <div onClick={requestFoodUnlock} style={{ ...inputStyle, opacity: 0.45, cursor: 'pointer' }}>{form.calories || ''}</div>
            : <input type="text" inputMode="decimal" placeholder={autoCals != null ? String(autoCals) : ''} value={form.calories} onChange={e => set('calories', e.target.value)} style={inputStyle} />}
        </div>
        {foodChecking ? (
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <i className="fa-solid fa-lock" style={{ fontSize: 9, color: UI.inkGhost }} />
            <span style={{ fontSize: 10, fontFamily: UI.fontUi, color: UI.inkGhost }}>Checking Food Tracker…</span>
          </div>
        ) : foodHasTrackerEntries && !foodUnlocked && (
          <button onClick={requestFoodUnlock} style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
            <i className="fa-solid fa-lock" style={{ fontSize: 9, color: UI.inkGhost }} />
            <span style={{ fontSize: 10, fontFamily: UI.fontUi, color: UI.inkGhost }}>Managed by the Food Tracker, tap to override</span>
          </button>
        )}
        <div>
          <div style={labelStyle}>Off-plan note <span style={{ textTransform: 'none', fontWeight: 400, color: UI.inkFaint }}>(optional · prefills check-in)</span></div>
          <textarea rows={2} placeholder="e.g. Birthday cake, 2 slices" value={form.offPlanNote} onChange={e => set('offPlanNote', e.target.value)} style={{ ...inputStyle, resize: 'none', fontFamily: UI.fontUi, fontSize: 14 }} />
        </div>
      </CatSection>

      <CatSection label="HYDRATION" collapsed={collapsedCats.has('hydration')} onToggle={() => toggleCat('hydration')}>
        {/* Locked renders a plain (non-focusable, non-editable) div in place
            of numField's <input>, not just a greyed-out copy of it: opacity
            and pointerEvents:none only block mouse/touch, keyboard Tab focus
            would still land in a real <input> and let it be typed into and
            saved with no unlock confirmation ever shown. No input element at
            all is the only way that's actually impossible. */}
        {/* Locked: the row itself is clickable (its own tap target, not just the
            hint line below), since none of its children are real inputs/buttons
            while locked (plain divs only), a click on any of them just bubbles up
            here, nothing to lose by letting the whole row respond. */}
        <div onClick={waterLocked ? requestWaterUnlock : undefined} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', opacity: waterLocked ? 0.45 : 1, cursor: waterLocked ? 'pointer' : 'default' }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Water{UI.waterEntryUnit() ? ` (${UI.waterEntryUnit()})` : ''}</div>
            {waterLocked
              ? <div style={inputStyle}>{form.water || '—'}</div>
              : <input type="text" inputMode="decimal" placeholder="—" value={form.water} onChange={e => set('water', e.target.value)} style={inputStyle} />}
          </div>
          {UI.waterQuickAdds().map(inc => waterLocked ? (
            <div key={inc} style={waterQuickAddTileStyle}>+{inc}</div>
          ) : (
            <button key={inc} onClick={() => set('water', String((healthInt(form.water) || 0) + inc))} style={{ ...waterQuickAddTileStyle, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>+{inc}</button>
          ))}
        </div>
        {waterLocked && (
          <button onClick={requestWaterUnlock} style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
            <i className="fa-solid fa-lock" style={{ fontSize: 9, color: UI.inkGhost }} />
            <span style={{ fontSize: 10, fontFamily: UI.fontUi, color: UI.inkGhost }}>Managed by the Water Tracker, tap to override</span>
          </button>
        )}
      </CatSection>

      <CatSection label="NOTE" collapsed={collapsedCats.has('note')} onToggle={() => toggleCat('note')}>
        <textarea rows={2} placeholder="…" value={form.note} onChange={e => set('note', e.target.value)} style={{ ...inputStyle, resize: 'none', fontFamily: UI.fontUi, fontSize: 14 }} />
      </CatSection>

      {/* Body measurements in their own section, grouped with the other
          measurement sections (glucose/BP/temp) below; starts collapsed until
          the first measurement is entered (everUsed below), invisible for
          users who never take them. */}
      <CatSection label="MEASUREMENTS" collapsed={collapsedCats.has('measurements')} onToggle={() => toggleCat('measurements')}>
        <div style={{ display: 'flex', gap: 8 }}>
          {numField('waistCm', 'Waist', 'cm')}
          {numField('hipsCm', 'Hips', 'cm')}
          {numField('chestCm', 'Chest', 'cm')}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {numField('armCm', 'Arms', 'cm')}
          {numField('thighCm', 'Thighs', 'cm')}
          {numField('calfCm', 'Calves', 'cm')}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {numField('bodyFatPct', 'Body Fat', '%')}
        </div>
      </CatSection>

      <CatSection label="GLUCOSE" collapsed={collapsedCats.has('glucose')} onToggle={() => toggleCat('glucose')} extra={
        <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi }}>{glucoseUnitLabel(glUnit)}</span>
      }>
        {glucoseForDay.map(g => {
          const disp = glucoseDisplay(g.valueMmol, glUnit);
          const ctxColor = { fasted: 'var(--accent)', fed: '#4a9fe0', other: UI.inkSoft }[g.context] || UI.inkSoft;
          const isConfirm = confirmDeleteGlId === g.id;
          return (
            <div key={g.id} style={{ background: UI.bgInset, borderRadius: 6, marginBottom: 6, border: `var(--hair-width) solid ${UI.hairStrong}`, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px' }}>
                <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: UI.inkFaint, minWidth: 32, paddingTop: 1 }}>{g.time}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: ctxColor, display: 'inline-block', flexShrink: 0 }} />
                    <span className="num" style={{ fontSize: 15, color: UI.ink }}>{disp}</span>
                  </div>
                  {g.note && <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>{g.note}</div>}
                </div>
                <button onClick={() => { setEditingGlucoseId(g.id); setAddingGlucose(true); setConfirmDeleteGlId(null); setGlForm({ value: glucoseEditValue(g.valueMmol, glUnit), time: g.time, context: g.context, note: g.note || '' }); }} style={{ background: 'none', border: 'none', color: UI.inkGhost, fontSize: 11, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>
                  <i className="fa-solid fa-pencil" />
                </button>
                <button onClick={() => setConfirmDeleteGlId(isConfirm ? null : g.id)} style={{ background: 'none', border: 'none', color: UI.inkGhost, fontSize: 14, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
              </div>
              {isConfirm && (
                <div style={{ display: 'flex', gap: 0, borderTop: `var(--hair-width) solid ${UI.hairStrong}` }}>
                  <button onClick={() => setConfirmDeleteGlId(null)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft }}>Cancel</button>
                  <button onClick={() => deleteGlucose(g.id)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', borderLeft: `var(--hair-width) solid ${UI.hairStrong}`, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, color: UI.danger }}>Delete</button>
                </div>
              )}
            </div>
          );
        })}
        {addingGlucose ? (
          <div style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(() => {
              const glInputSt = { background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4, padding: '7px 10px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' };
              return (
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={labelStyle}>Value ({glucoseUnitLabel(glUnit)})</div>
                    <input type="text" inputMode="decimal" placeholder="—" value={glForm.value} onChange={e => setGl('value', e.target.value)} style={{ ...glInputSt, fontFamily: UI.fontNum }} autoFocus />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={labelStyle}>Time</div>
                    <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5}
                      value={glForm.time}
                      onChange={e => {
                        let v = e.target.value.replace(/[^0-9:]/g, '');
                        if (v.length === 2 && !v.includes(':') && glForm.time.length < 2) v += ':';
                        setGl('time', v);
                      }}
                      style={glInputSt} />
                  </div>
                </div>
              );
            })()}
            <div>
              <div style={labelStyle}>Context</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['fasted', 'fed', 'other'].map(c => (
                  <button key={c} onClick={() => setGl('context', c)} style={{
                    flex: 1, padding: '6px 4px', cursor: 'pointer', borderRadius: 4,
                    border: `var(--hair-width) solid ${glForm.context === c ? 'var(--accent)' : UI.hairStrong}`,
                    background: glForm.context === c ? 'var(--accent)' : 'transparent',
                    color: glForm.context === c ? 'var(--accent-ink)' : UI.inkFaint,
                    textShadow: 'none',
                    fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
                    WebkitTapHighlightColor: 'transparent',
                  }}>{GLUCOSE_CTX_LABELS[c]}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={labelStyle}>Note (optional)</div>
              <input type="text" placeholder="…" value={glForm.note} onChange={e => setGl('note', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => { setAddingGlucose(false); setGlForm(emptyGl); setEditingGlucoseId(null); }} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={saveGlucose} disabled={!glForm.value} style={{ flex: 2 }}>{editingGlucoseId ? 'Update' : 'Add'}</Btn>
            </div>
          </div>
        ) : (
          <button onClick={() => {
            // Pre-filled with now, not left blank: you measure and log in the
            // same breath, so defaulting to "right now" saves a step, still
            // freely editable if you're logging a reading from earlier.
            setGlForm({ ...emptyGl, time: new Date().toTimeString().slice(0, 5) });
            setAddingGlucose(true); setEditingGlucoseId(null);
          }} style={{
            width: '100%', padding: '9px', background: UI.bgInset, border: `var(--hair-width) dashed ${UI.hairStrong}`, borderRadius: 6,
            color: UI.inkFaint, textShadow: 'none', fontFamily: UI.fontUi, fontSize: 12, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>+ Add reading</button>
        )}
      </CatSection>

      <CatSection label="BLOOD PRESSURE" collapsed={collapsedCats.has('bloodPressure')} onToggle={() => toggleCat('bloodPressure')} extra={
        <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi }}>mmHg</span>
      }>
        {bpForDay.map(b => {
          const isConfirm = confirmDeleteBpId === b.id;
          return (
            <div key={b.id} style={{ background: UI.bgInset, borderRadius: 6, marginBottom: 6, border: `var(--hair-width) solid ${UI.hairStrong}`, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px' }}>
                <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: UI.inkFaint, minWidth: 32, paddingTop: 1 }}>{b.time}</span>
                <div style={{ flex: 1 }}>
                  <span className="num" style={{ fontSize: 15, color: UI.ink }}>{b.systolic}/{b.diastolic}</span>
                  {b.note && <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>{b.note}</div>}
                </div>
                <button onClick={() => { setEditingBpId(b.id); setAddingBp(true); setConfirmDeleteBpId(null); setBpForm({ systolic: String(b.systolic), diastolic: String(b.diastolic), time: b.time, note: b.note || '' }); }} style={{ background: 'none', border: 'none', color: UI.inkGhost, fontSize: 11, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>
                  <i className="fa-solid fa-pencil" />
                </button>
                <button onClick={() => setConfirmDeleteBpId(isConfirm ? null : b.id)} style={{ background: 'none', border: 'none', color: UI.inkGhost, fontSize: 14, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
              </div>
              {isConfirm && (
                <div style={{ display: 'flex', gap: 0, borderTop: `var(--hair-width) solid ${UI.hairStrong}` }}>
                  <button onClick={() => setConfirmDeleteBpId(null)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft }}>Cancel</button>
                  <button onClick={() => deleteBp(b.id)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', borderLeft: `var(--hair-width) solid ${UI.hairStrong}`, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, color: UI.danger }}>Delete</button>
                </div>
              )}
            </div>
          );
        })}
        {addingBp ? (
          <div style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(() => {
              const bpInputSt = { background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4, padding: '7px 10px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' };
              return (
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={labelStyle}>Systolic</div>
                    <input type="text" inputMode="numeric" placeholder="—" value={bpForm.systolic} onChange={e => setBp('systolic', e.target.value.replace(/[^0-9]/g, ''))} style={{ ...bpInputSt, fontFamily: UI.fontNum }} autoFocus />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={labelStyle}>Diastolic</div>
                    <input type="text" inputMode="numeric" placeholder="—" value={bpForm.diastolic} onChange={e => setBp('diastolic', e.target.value.replace(/[^0-9]/g, ''))} style={{ ...bpInputSt, fontFamily: UI.fontNum }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={labelStyle}>Time</div>
                    <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5}
                      value={bpForm.time}
                      onChange={e => {
                        let v = e.target.value.replace(/[^0-9:]/g, '');
                        if (v.length === 2 && !v.includes(':') && bpForm.time.length < 2) v += ':';
                        setBp('time', v);
                      }}
                      style={bpInputSt} />
                  </div>
                </div>
              );
            })()}
            <div>
              <div style={labelStyle}>Note (optional)</div>
              <input type="text" placeholder="…" value={bpForm.note} onChange={e => setBp('note', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => { setAddingBp(false); setBpForm(emptyBp); setEditingBpId(null); }} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={saveBp} disabled={!bpForm.systolic || !bpForm.diastolic || savingBp} style={{ flex: 2 }}>{editingBpId ? 'Update' : 'Add'}</Btn>
            </div>
          </div>
        ) : (
          <button onClick={() => {
            // Pre-filled with now, not left blank: you measure and log in the
            // same breath, so defaulting to "right now" saves a step, still
            // freely editable if you're logging a reading from earlier.
            setBpForm({ ...emptyBp, time: new Date().toTimeString().slice(0, 5) });
            setAddingBp(true); setEditingBpId(null);
          }} style={{
            width: '100%', padding: '9px', background: UI.bgInset, border: `var(--hair-width) dashed ${UI.hairStrong}`, borderRadius: 6,
            color: UI.inkFaint, textShadow: 'none', fontFamily: UI.fontUi, fontSize: 12, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>+ Add reading</button>
        )}
      </CatSection>

      <CatSection label="BODY TEMPERATURE" collapsed={collapsedCats.has('bodyTemp')} onToggle={() => toggleCat('bodyTemp')} extra={
        <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi }}>{tempUnitLabel(tUnit)}</span>
      }>
        {tempForDay.map(t => {
          const isConfirm = confirmDeleteTempId === t.id;
          return (
            <div key={t.id} style={{ background: UI.bgInset, borderRadius: 6, marginBottom: 6, border: `var(--hair-width) solid ${UI.hairStrong}`, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px' }}>
                <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: UI.inkFaint, minWidth: 32, paddingTop: 1 }}>{t.time}</span>
                <div style={{ flex: 1 }}>
                  <span className="num" style={{ fontSize: 15, color: UI.ink }}>{tempDisplay(t.valueC, tUnit)}</span>
                  {t.note && <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>{t.note}</div>}
                </div>
                <button onClick={() => { setEditingTempId(t.id); setAddingTemp(true); setConfirmDeleteTempId(null); setTempForm({ value: tempEditValue(t.valueC, tUnit), time: t.time, note: t.note || '' }); }} style={{ background: 'none', border: 'none', color: UI.inkGhost, fontSize: 11, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>
                  <i className="fa-solid fa-pencil" />
                </button>
                <button onClick={() => setConfirmDeleteTempId(isConfirm ? null : t.id)} style={{ background: 'none', border: 'none', color: UI.inkGhost, fontSize: 14, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
              </div>
              {isConfirm && (
                <div style={{ display: 'flex', gap: 0, borderTop: `var(--hair-width) solid ${UI.hairStrong}` }}>
                  <button onClick={() => setConfirmDeleteTempId(null)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft }}>Cancel</button>
                  <button onClick={() => deleteTemp(t.id)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', borderLeft: `var(--hair-width) solid ${UI.hairStrong}`, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, color: UI.danger }}>Delete</button>
                </div>
              )}
            </div>
          );
        })}
        {addingTemp ? (
          <div style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(() => {
              const tInputSt = { background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4, padding: '7px 10px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' };
              return (
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={labelStyle}>Value ({tempUnitLabel(tUnit)})</div>
                    <input type="text" inputMode="decimal" placeholder="—" value={tempForm.value} onChange={e => setTemp('value', e.target.value)} style={{ ...tInputSt, fontFamily: UI.fontNum }} autoFocus />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={labelStyle}>Time</div>
                    <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5}
                      value={tempForm.time}
                      onChange={e => {
                        let v = e.target.value.replace(/[^0-9:]/g, '');
                        if (v.length === 2 && !v.includes(':') && tempForm.time.length < 2) v += ':';
                        setTemp('time', v);
                      }}
                      style={tInputSt} />
                  </div>
                </div>
              );
            })()}
            <div>
              <div style={labelStyle}>Note (optional)</div>
              <input type="text" placeholder="…" value={tempForm.note} onChange={e => setTemp('note', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => { setAddingTemp(false); setTempForm(emptyTemp); setEditingTempId(null); }} style={{ flex: 1 }}>Cancel</Btn>
              <Btn onClick={saveTemp} disabled={!tempForm.value || savingTemp} style={{ flex: 2 }}>{editingTempId ? 'Update' : 'Add'}</Btn>
            </div>
          </div>
        ) : (
          <button onClick={() => {
            // Pre-filled with now, not left blank: you measure and log in the
            // same breath, so defaulting to "right now" saves a step, still
            // freely editable if you're logging a reading from earlier.
            setTempForm({ ...emptyTemp, time: new Date().toTimeString().slice(0, 5) });
            setAddingTemp(true); setEditingTempId(null);
          }} style={{
            width: '100%', padding: '9px', background: UI.bgInset, border: `var(--hair-width) dashed ${UI.hairStrong}`, borderRadius: 6,
            color: UI.inkFaint, textShadow: 'none', fontFamily: UI.fontUi, fontSize: 12, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>+ Add reading</button>
        )}
      </CatSection>

      {coachFields.length > 0 && (
        <div style={{ marginBottom: 18, padding: '14px 14px', borderRadius: 6, background: `rgba(var(--accent-rgb),0.11)`, border: `var(--hair-width) solid rgba(var(--accent-rgb),0.2)` }}>
          <div className="micro-gold" style={{ marginBottom: 12 }}>YOUR COACH WANTS TO KNOW</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {layoutRows(coachFields).map((row, ri) => (
              row.length === 1
                ? <div key={row[0].key}><FieldWidget field={row[0]} value={coachForm[row[0].key]} onChange={v => setCoachVal(row[0].key, v)} distUnit="km" setDistUnit={() => {}} inputStyle={inputStyle} /></div>
                : <div key={ri} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                    {row.map(f => (
                      <div key={f.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <FieldWidget field={f} value={coachForm[f.key]} onChange={v => setCoachVal(f.key, v)} distUnit="km" setDistUnit={() => {}} inputStyle={inputStyle} />
                      </div>
                    ))}
                  </div>
            ))}
          </div>
        </div>
      )}

      </div>

      {/* Pinned action footer, same idiom as the training screen's footer nav */}
      <div className="knurl" />
      <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: `10px 22px calc(env(safe-area-inset-bottom, 8px) + 10px)` }}>
        {existing && (
          <Btn kind="ghost" onClick={del} style={{ flex: 1 }}>Delete</Btn>
        )}
        <Btn onClick={save} disabled={!canSave} style={{ flex: 2 }}>{existing ? 'Save' : 'Log'}</Btn>
      </div>
      {/* Outside the scrolling section on purpose: Sheet positions itself fixed
          and is not portaled, so nesting it inside a scroll container invites
          clipping. zIndex above this screen's own 100, the same bump the other
          sheets stacked on top of a full-page screen use. */}
      <Sheet open={cleanupSheet} onClose={() => setCleanupSheet(false)} title="Cleanup week" titleColor="var(--accent)" zIndex={200}>
        <CleanupStartBody
          percent={cleanupDraftPct}
          onPercent={setCleanupDraftPct}
          startLabel={cleanupStartISO ? new Date(cleanupStartISO).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' }) : null}
          onCancel={() => setCleanupSheet(false)}
          onStart={startCleanupWithPct}
        />
      </Sheet>
    </Screen>
  );
}

// ─── Macro target editor ────────────────────────────────────────────────────────

// ─── Macro target estimator ───────────────────────────────────────────────────
// Every number the adherence system scores against used to have to be guessed:
// a user without a coach had no way to arrive at a protein/carbs/fat target
// beyond looking it up somewhere else. This turns what the app already knows
// (bodyweight from the daily logs, how often they actually train) plus five
// questions into a starting point. Deliberately a PREFILL, not a save: the
// result lands in MacroTargetSheet's own fields and the user still confirms it
// there, so an estimate never silently becomes a target.
const MACRO_ACTIVITY_OPTIONS = [
  { id: 'sedentary', label: 'Desk', hint: 'Desk job, little walking outside training' },
  { id: 'light', label: 'Light', hint: 'On your feet some of the day' },
  { id: 'moderate', label: 'Active', hint: 'Moving most of the day, or lots of steps' },
  { id: 'high', label: 'Hard', hint: 'Physical job, or training twice a day' },
  { id: 'athlete', label: 'Athlete', hint: 'Full-time athlete workload' },
];
const MACRO_GOAL_OPTIONS = [
  { id: 'cut', label: 'Lose' },
  { id: 'maintain', label: 'Maintain' },
  { id: 'gain', label: 'Gain' },
];
// Weekly rate choices in whichever unit the user thinks in. rateKgPerWeek is
// always stored and computed in kg (the equation is metric); a lbs user just
// never sees a kg figure.
const MACRO_RATE_OPTIONS_KG = [0.25, 0.5, 0.75];
const MACRO_RATE_OPTIONS_LBS = [0.5, 1, 1.5];
const LBS_TO_KG = 0.45359237;
// Default cap for the low-fat option, in g of fat per kg of bodyweight. Shown
// converted for lbs users (about 0.27 g per lb) and adjustable either way.
const LOW_FAT_DEFAULT_PER_KG = 0.6;

// Boxed numeric input for the estimator. Two behaviours the plain <input>s here
// were missing, both already the norm elsewhere: the accent-on-focus edge that
// UI.TextInput uses, and select-on-focus so a prefilled number can be typed
// straight over instead of backspaced away (screens-lib, screens-train and
// UI.NumInput all do this). `pinned` paints the same edge in a held state, for
// a macro the user has padlocked.
function EstimatorInput({ pinned, style = {}, ...rest }) {
  const [focus, setFocus] = useStateH(false);
  const edge = focus ? 'var(--accent)' : pinned ? 'var(--hair-accent)' : UI.hairStrong;
  return (
    <input
      type="text" autoComplete="off" spellCheck={false}
      onFocus={e => { setFocus(true); e.target.select(); }}
      onBlur={() => setFocus(false)}
      {...rest}
      style={{
        width: '100%', boxSizing: 'border-box', background: UI.bgInset,
        border: `var(--hair-width) solid ${edge}`, borderRadius: 4,
        padding: '9px 10px', fontFamily: UI.fontNum, fontSize: 15,
        color: UI.ink, outline: 'none', transition: 'border-color 0.2s',
        ...style,
      }}
    />
  );
}

// standalone: opened directly from MacroSourceCard's "Adjust rate, protein &
// fat" rather than nested inside MacroTargetSheet's own "Estimate targets for
// me". Same sheet either way, just clearer copy: nested, this is a preview
// the PARENT sheet's own Save still has to confirm; standalone, this tap IS
// the save, there is no second screen after it.
function MacroEstimatorSheet({ open, onClose, store, setStore, onApply, standalone }) {
  const calc = store.settings?.macroCalc || {};
  const isLbs = UI.unit() === 'lbs';
  // "g of fat per kg" reads as an odd fraction in pounds, so the field is shown
  // in whichever unit the user thinks in and converted on the way in and out.
  // The stored and computed value is always per kg.
  const fatPerToDisplay = (perKg) => Math.round((isLbs ? perKg * LBS_TO_KG : perKg) * 100) / 100;
  const fatPerFromDisplay = (v) => (isLbs ? v / LBS_TO_KG : v);

  // Bodyweight prefers the latest daily log, so for anyone who logs weight the
  // estimate keeps tracking it instead of a number typed once and forgotten.
  // It stays editable regardless, because someone can want targets before they
  // have ever logged a weight, and that used to block the whole sheet.
  const loggedWeight = LB.latestBodyweight(store);

  // How often they actually train, from the last four weeks of real sessions
  // rather than from what a plan says: plans come in weekday, cycle and flex
  // shapes, and the number that matters here is the one that happened.
  const defaultTrainingDays = useMemoH(() => {
    const cutoff = LB.historyWindowCutoffISO(new Date(), 28);
    const days = new Set((store.sessions || []).filter(s => s.date >= cutoff && s.ended).map(s => s.date));
    return days.size ? Math.min(7, Math.max(1, Math.round(days.size / 4))) : 4;
  }, [store.sessions]);

  const [form, setForm] = useStateH({});
  // Hand-edited macros, as strings so typing works, or null while the estimate
  // is untouched. See editMacro.
  const [manual, setManual] = useStateH(null);
  // Macros the user pinned, per day type. A locked macro is left alone when
  // another one is edited, which is the only way to keep a number you typed
  // from being rebalanced away by the next edit.
  const [locks, setLocks] = useStateH({ training: {}, rest: {} });

  useEffectH(() => {
    if (!open) return;
    const storedWeight = calc.weightKg != null
      ? String(Math.round((isLbs ? calc.weightKg / LBS_TO_KG : calc.weightKg) * 10) / 10)
      : '';
    setForm({
      weight: loggedWeight != null ? String(loggedWeight) : storedWeight,
      heightCm: calc.heightCm != null ? String(calc.heightCm) : '',
      birthYear: calc.birthYear != null ? String(calc.birthYear) : '',
      sex: calc.sex ?? null,
      activity: calc.activity ?? 'moderate',
      goal: calc.goal ?? 'maintain',
      rateKgPerWeek: calc.rateKgPerWeek || (isLbs ? 1 * LBS_TO_KG : 0.5),
      trainingDays: calc.trainingDays != null ? calc.trainingDays : defaultTrainingDays,
      proteinFixed: !!calc.proteinFixed,
      proteinGStr: calc.proteinG != null ? String(Math.round(calc.proteinG)) : '',
      lowFat: !!calc.lowFat && !calc.fatFixed,
      fatPerStr: String(fatPerToDisplay(calc.fatPerKg > 0 ? calc.fatPerKg : LOW_FAT_DEFAULT_PER_KG)),
      fatFixed: !!calc.fatFixed,
      fatGStr: calc.fatG != null ? String(Math.round(calc.fatG)) : '',
      // null means "follow the automatic split", so the default keeps tracking
      // the training day count instead of freezing at whatever it was when the
      // sheet was last saved.
      restRatioPct: calc.restRatioPct != null ? calc.restRatioPct : null,
    });
    setManual(null);
    setLocks({ training: {}, rest: {} });
  }, [open]); // eslint-disable-line

  const weightInput = healthNum(form.weight);
  const weightKg = weightInput > 0 ? (isLbs ? weightInput * LBS_TO_KG : weightInput) : null;
  const fatPerInput = healthNum(form.fatPerStr);
  const fatPerKg = (form.lowFat && !form.fatFixed && fatPerInput > 0) ? fatPerFromDisplay(fatPerInput) : null;
  // Fixed grams: the exact same number every day, never derived from
  // bodyweight. Takes priority over the per-kg fields above when both are
  // somehow present (the fat mode picker keeps them mutually exclusive, this
  // is the defensive fallback if that invariant is ever broken).
  const proteinGInput = healthNum(form.proteinGStr);
  const proteinGVal = (form.proteinFixed && proteinGInput > 0) ? proteinGInput : null;
  const fatGInput = healthNum(form.fatGStr);
  const fatGVal = (form.fatFixed && fatGInput > 0) ? fatGInput : null;
  // Auto / Per kg / Fixed grams, the fat section's 3-way mode: derived from
  // the two stored booleans (kept for backward compatibility with rows saved
  // before Fixed existed) rather than a new enum field.
  const fatModeUI = form.fatFixed ? 'fixed' : form.lowFat ? 'perKg' : 'auto';
  // The automatic split never goes under this much fat per kg; asking for less
  // is allowed but worth saying out loud rather than silently overruling.
  const fatBelowFloor = fatPerKg != null && fatPerKg < LB.FAT_FLOOR_PER_KG;

  const trainingDays = Math.min(7, Math.max(0, Math.round(Number(form.trainingDays) || 0)));
  // How hard the week is cycled, as rest day calories in percent of a training
  // day. The automatic split is the hardest one on offer and therefore the
  // slider's floor; 100 feeds both day types the same. Clamped on read rather
  // than in an effect, so changing the training days cannot strand the slider
  // below its own minimum.
  const cyclesDays = trainingDays > 0 && trainingDays < 7;
  const minRestPct = Math.round(LB.minRestRatio(trainingDays) * 100);
  const restPct = form.restRatioPct == null ? minRestPct
    : Math.max(minRestPct, Math.min(100, Math.round(form.restRatioPct)));
  // WebKit paints the filled part of the track from this gradient, and the
  // range starts at the floor rather than at zero, so it is not just restPct.
  // Firefox draws it natively from min/max and ignores the gradient.
  const restFillPct = ((restPct - minRestPct) / Math.max(1, 100 - minRestPct)) * 100;

  const age = form.birthYear ? (new Date().getFullYear() - healthInt(form.birthYear)) : null;
  const est = LB.estimateTdee({ weightKg, heightCm: healthInt(form.heightCm), age, sex: form.sex, activity: form.activity });
  const targets = est && LB.macroTargetsFromGoal({
    tdee: est.tdee, weightKg, goal: form.goal,
    rateKgPerWeek: form.goal === 'maintain' ? 0 : form.rateKgPerWeek,
    trainingDays,
    proteinG: proteinGVal, fatPerKg, fatG: fatGVal,
    // Left at the floor it stays null, so the exact automatic ratio is used
    // rather than the rounded percentage the slider displays.
    restRatio: form.restRatioPct == null ? null : restPct / 100,
  });

  // Any change to an input produces a different estimate, so hand edits made
  // against the previous one are dropped rather than silently carried over
  // onto numbers they were never balanced against.
  //
  // A padlock is the exception. It is a decision about a number, not a scratch
  // value, so a pinned macro keeps what it was set to and the free ones
  // rebalance around it to the new day's calories. Clearing the padlocks here
  // would mean every nudge of the ratio slider quietly undid the pinning, which
  // is backwards: the slider exists precisely to ask "with protein settled,
  // what do the other two do".
  const estKey = JSON.stringify([weightKg, form.heightCm, form.birthYear, form.sex, form.activity, form.goal, form.rateKgPerWeek, form.trainingDays, proteinGVal, fatPerKg, fatGVal, restPct]);

  // Which macros are actually pinned for a day. With low fat on, fat is held by
  // that target and its padlock is hidden, so a pin left over from before the
  // option was switched on must not go on holding the old number and quietly
  // defeat it.
  const pinsFor = (dayType) => Object.keys(locks[dayType] || {})
    .filter(k => locks[dayType][k]
      && !(k === 'fat' && (fatPerKg != null || fatGVal != null))
      && !(k === 'protein' && proteinGVal != null));

  useEffectH(() => {
    setManual(prev => {
      // No estimate to rebuild against (a half-typed input). Hold everything
      // rather than destroying the numbers mid-keystroke.
      if (!targets) return prev;
      const fresh = estimateStrings();
      if (!prev || !fresh) return null;
      let anyPin = false;
      const out = { ...fresh };
      ['training', 'rest'].forEach(d => {
        const pinned = pinsFor(d);
        if (!pinned.length) return;
        anyPin = true;
        let day = {
          protein: healthInt(fresh[d].protein) || 0,
          carbs: healthInt(fresh[d].carbs) || 0,
          fat: healthInt(fresh[d].fat) || 0,
        };
        // One pin at a time, each holding the others, so every pinned macro
        // lands back on its own value and only the free ones absorb the
        // difference. Order does not matter: the last pass restores whatever
        // an earlier one moved.
        pinned.forEach(k => {
          day = LB.rebalanceMacros(day, k, healthInt(prev[d]?.[k]) || 0, {
            targetCalories: d === 'training' ? targets.caloriesTraining : targets.caloriesRest,
            weightKg, proteinG: proteinGVal, fatPerKg, fatG: fatGVal,
            locked: pinned.filter(o => o !== k),
          });
        });
        out[d] = { protein: String(day.protein), carbs: String(day.carbs), fat: String(day.fat) };
      });
      return anyPin ? out : null;
    });
  }, [estKey]); // eslint-disable-line

  const estimateStrings = () => (targets ? {
    training: { protein: String(targets.proteinTraining), carbs: String(targets.carbsTraining), fat: String(targets.fatTraining) },
    rest: { protein: String(targets.proteinRest), carbs: String(targets.carbsRest), fat: String(targets.fatRest) },
  } : null);
  const shown = manual || estimateStrings();

  // Editing one macro holds that day's calorie figure and lets the other two
  // absorb the difference (LB.rebalanceMacros). The edited field keeps the raw
  // string the user typed, so a half-finished number is never overwritten
  // mid-keystroke; the other two are rewritten from the result.
  function editMacro(dayType, key, raw) {
    if (!targets) return;
    const clean = raw.replace(/[^\d]/g, '');
    setManual(prev => {
      const base = prev || estimateStrings();
      if (!base) return prev;
      const cur = {
        protein: healthInt(base[dayType].protein) || 0,
        carbs: healthInt(base[dayType].carbs) || 0,
        fat: healthInt(base[dayType].fat) || 0,
      };
      const next = LB.rebalanceMacros(cur, key, clean === '' ? 0 : parseInt(clean, 10), {
        targetCalories: dayType === 'training' ? targets.caloriesTraining : targets.caloriesRest,
        weightKg, proteinG: proteinGVal, fatPerKg, fatG: fatGVal,
        locked: pinsFor(dayType),
      });
      return {
        ...base,
        [dayType]: { protein: String(next.protein), carbs: String(next.carbs), fat: String(next.fat), [key]: clean },
      };
    });
  }

  const dayCalories = (dayType) => caloriesFromMacros(
    healthInt(shown?.[dayType]?.protein), healthInt(shown?.[dayType]?.carbs), healthInt(shown?.[dayType]?.fat),
  );

  // What the week actually averages out to, and how that sits against
  // maintenance. Two day types with different calories hide the only number
  // that decides whether weight moves, and hand-editing the macros can walk it
  // anywhere without the per-day figures looking wrong. Derived from what is
  // SHOWN, not from the estimate, so an edit is reflected immediately.
  const weekAvgCalories = shown
    ? LB.weeklyAverageCalories(dayCalories('training'), dayCalories('rest'), trainingDays)
    : null;
  const maintenanceDelta = (weekAvgCalories != null && est) ? weekAvgCalories - est.tdee : null;
  // Close enough to call it maintenance, rather than showing "+3 kcal over".
  const MAINTENANCE_TOLERANCE = 40;
  const deltaLabel = maintenanceDelta == null ? ''
    : Math.abs(maintenanceDelta) <= MAINTENANCE_TOLERANCE ? 'right on maintenance'
      : maintenanceDelta > 0 ? `${maintenanceDelta} over maintenance`
        : `${Math.abs(maintenanceDelta)} under maintenance`;
  // Flagged only when the average contradicts the goal that was picked, which
  // is the case an edit can walk into without anything else looking wrong.
  const deltaContradictsGoal = maintenanceDelta != null && (
    (form.goal === 'cut' && maintenanceDelta > MAINTENANCE_TOLERANCE)
    || (form.goal === 'gain' && maintenanceDelta < -MAINTENANCE_TOLERANCE)
    || (form.goal === 'maintain' && Math.abs(maintenanceDelta) > 150)
  );

  const apply = () => {
    if (!shown) return;
    const build = (d) => {
      const p = healthInt(shown[d].protein), c = healthInt(shown[d].carbs), f = healthInt(shown[d].fat);
      return { p, c, f, cal: caloriesFromMacros(p, c, f) };
    };
    const t = build('training'), r = build('rest');
    setStore(s => ({
      ...s,
      settings: {
        ...s.settings,
        macroCalc: {
          ...s.settings.macroCalc,
          birthYear: healthInt(form.birthYear), heightCm: healthInt(form.heightCm),
          sex: form.sex ?? null, activity: form.activity, goal: form.goal,
          rateKgPerWeek: form.goal === 'maintain' ? 0 : form.rateKgPerWeek,
          trainingDays: form.trainingDays,
          // Kept as a fallback for anyone who never logs a bodyweight; a logged
          // one always wins on reopen.
          weightKg: weightKg != null ? Math.round(weightKg * 10) / 10 : null,
          proteinFixed: !!form.proteinFixed,
          proteinG: proteinGVal != null ? Math.round(proteinGVal) : null,
          lowFat: !!form.lowFat,
          fatPerKg: fatPerKg != null ? Math.round(fatPerKg * 1000) / 1000 : null,
          fatFixed: !!form.fatFixed,
          fatG: fatGVal != null ? Math.round(fatGVal) : null,
          restRatioPct: form.restRatioPct == null ? null : restPct,
        },
      },
    }));
    onApply({
      proteinTraining: t.p, carbsTraining: t.c, fatTraining: t.f, caloriesTraining: t.cal,
      proteinRest: r.p, carbsRest: r.c, fatRest: r.f, caloriesRest: r.cal,
    });
    onClose();
  };

  // The app's segmented control: solid accent fill and accent-ink text on the
  // active segment, no divider between them, text-lift on the inactive ones so
  // they stay readable on the paper theme. Same shape as the food module's
  // fdSegBtn and the Health chart timeframe picker.
  const segBtn = (active) => ({
    flex: 1, padding: '7px 4px', border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--accent-ink)' : UI.inkFaint,
    textShadow: active ? 'none' : 'var(--text-lift)',
    fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
    WebkitTapHighlightColor: 'transparent',
  });
  const seg = (options, value, onPick) => (
    <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
      {options.map(o => (
        <button key={String(o.id)} onClick={() => onPick(o.id)} style={segBtn(value === o.id)}>{o.label}</button>
      ))}
    </div>
  );
  const activityHint = MACRO_ACTIVITY_OPTIONS.find(o => o.id === form.activity)?.hint;

  // One shape for every explanatory line in the sheet, so they cannot drift
  // apart in size, colour or spacing. See the whole-pixel line height note at
  // the render below.
  const hint = (children, style) => (
    <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', ...style }}>{children}</div>
  );
  // Label, control, optional explanation. `right` takes a trailing action on
  // the label line (currently the ratio slider's Reset).
  const group = (label, control, below, right) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span className="micro">{label}</span>
        {right}
      </div>
      {control}
      {below ? hint(below, { marginTop: 6 }) : null}
    </div>
  );
  // Matches the Reset beside the watermark slider in Settings.
  const resetBtn = (onClick) => (
    <button onClick={onClick} style={{
      background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
      color: UI.gold, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600,
      letterSpacing: '0.1em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent',
    }}>Reset</button>
  );

  const toggleLock = (dayType, key) => {
    // Locking pins the number that is on screen right now, so the estimate is
    // committed to the editable state first. Without that, a padlock set on an
    // untouched estimate would have no value to hold the next time an input
    // changes, and would behave differently from one set on a typed number.
    if (!locks[dayType]?.[key]) setManual(prev => prev || estimateStrings());
    setLocks(l => ({ ...l, [dayType]: { ...l[dayType], [key]: !l[dayType]?.[key] } }));
  };

  // The label doubles as the lock toggle: a padlock beside each macro, so
  // pinning one is where you already are when you decide to.
  const macroField = (dayType, key, label) => {
    // With a per-kg or fixed fat/protein figure holding the number already,
    // that macro's padlock would be a second switch for the same thing.
    const lockable = !((key === 'fat' && (fatPerKg != null || fatGVal != null)) || (key === 'protein' && proteinGVal != null));
    const locked = lockable && !!locks[dayType]?.[key];
    return (
      <div style={{ flex: 1 }}>
        <button className="micro" disabled={!lockable}
          onClick={() => lockable && toggleLock(dayType, key)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4,
            background: 'none', border: 'none', padding: 0,
            cursor: lockable ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent',
            ...(locked ? { color: 'var(--accent)' } : null),
          }}>
          {label}
          {lockable && <i className={`fa-solid fa-lock${locked ? '' : '-open'}`} style={{ fontSize: 8 }} />}
        </button>
        <EstimatorInput inputMode="numeric" pinned={locked}
          value={shown?.[dayType]?.[key] ?? ''}
          onChange={e => editMacro(dayType, key, e.target.value)}
          style={{ fontSize: 14, padding: '7px 8px' }} />
      </div>
    );
  };
  // Day type on the left, its calories right-aligned on the same baseline, the
  // way the rest of the app pairs a label with its number. kcal in UI.warn is
  // the food module's rule for the same pairing.
  const daySection = (dayType, label) => (
    <div style={{ marginBottom: dayType === 'training' ? 14 : 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span className="micro">
          {label}
          {/* How many of these a week makes, right where the numbers are: it is
              what turns two day targets into the weekly average above. */}
          <span className="num" style={{ color: UI.inkFaint, marginLeft: 6, letterSpacing: 0 }}>
            &times;{dayType === 'training' ? trainingDays : 7 - trainingDays}
          </span>
        </span>
        <span className="num" style={{ fontSize: 13, color: UI.warn }}>{dayCalories(dayType)} kcal</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {macroField(dayType, 'protein', 'Protein g')}
        {macroField(dayType, 'carbs', 'Carbs g')}
        {macroField(dayType, 'fat', 'Fat g')}
      </div>
    </div>
  );
  // The two figures the whole sheet exists to produce, as a headline pair.
  const headlineStat = (label, value, sub, subColor) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="micro" style={{ marginBottom: 3 }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 300, color: UI.ink, lineHeight: '24px' }}>
        {value}<span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 4 }}>kcal</span>
      </div>
      {hint(sub, { marginTop: 2, color: subColor || UI.inkFaint })}
    </div>
  );

  // zIndex above the default 100: this opens on top of MacroTargetSheet, the
  // same nesting idiom the food module's own quantity sheet uses.
  //
  // Every 11px block below sets its line height in whole pixels rather than as
  // a ratio, and that is load-bearing, not a style preference. 11 x 1.4 is
  // 15.39px and 11 x 1.45 is 15.94px, so each line of body copy pushed
  // everything under it onto a fractional offset, and a hairline border at a
  // fractional offset renders inconsistently instead of landing crisply on
  // one device row, which reads as a missing or blurred edge. It moved while
  // typing because the line under "Maintenance about" rewraps as the numbers
  // change width, so every edit reshuffled the sub-pixel phase of the macro
  // inputs right below it. Whole-pixel line heights keep those offsets integral
  // and a rewrap shifts by exactly one line. Keep it that way: 12px copy may
  // use 1.5 (18px exactly), 11px copy may not use a ratio at all.
  return (
    <Sheet open={open} onClose={onClose} title="Estimate targets" zIndex={200}>
      {hint(standalone
        ? 'Rate, protein, fat and training split all live here, whatever you set feeds both this estimate and your weekly automatic check-ins.'
        : 'A starting point, not a prescription. Everything below the estimate is editable, and it is worth revisiting when your weight or training changes.',
        { fontSize: 12, lineHeight: '18px', marginBottom: 18 })}

      <Bezel style={{ marginTop: 8, marginBottom: 12 }}>About you</Bezel>

      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div className="micro" style={{ marginBottom: 6 }}>Weight {UI.unit()}</div>
          <EstimatorInput inputMode="decimal" value={form.weight ?? ''}
            onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="micro" style={{ marginBottom: 6 }}>Height cm</div>
          <EstimatorInput inputMode="numeric" value={form.heightCm ?? ''}
            onChange={e => setForm(f => ({ ...f, heightCm: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="micro" style={{ marginBottom: 6 }}>Born</div>
          <EstimatorInput inputMode="numeric" placeholder="YYYY" value={form.birthYear ?? ''}
            onChange={e => setForm(f => ({ ...f, birthYear: e.target.value }))} />
        </div>
      </div>
      {hint(loggedWeight != null
        ? 'Weight comes from your latest daily log, so this stays current on its own. Change it here to try a different number.'
        : 'No bodyweight logged yet, so type one here. Once you log weight in your daily log, this fills itself in.',
      { marginBottom: 16 })}

      {group('Sex (for the equation)',
        seg([{ id: 'female', label: 'Female' }, { id: 'male', label: 'Male' }], form.sex, v => setForm(f => ({ ...f, sex: v }))))}

      {group('Daily activity outside training',
        seg(MACRO_ACTIVITY_OPTIONS, form.activity, v => setForm(f => ({ ...f, activity: v }))),
        activityHint)}

      <Bezel style={{ marginTop: 8, marginBottom: 12 }}>Your goal</Bezel>

      {group('Goal', (
        <>
          {seg(MACRO_GOAL_OPTIONS, form.goal, v => setForm(f => ({ ...f, goal: v })))}
          {form.goal !== 'maintain' && (
            <div style={{ marginTop: 10 }}>
              <div className="micro" style={{ marginBottom: 6 }}>Per week</div>
              {seg(
                (isLbs ? MACRO_RATE_OPTIONS_LBS : MACRO_RATE_OPTIONS_KG).map(r => ({ id: isLbs ? r * LBS_TO_KG : r, label: `${r} ${UI.unit()}` })),
                form.rateKgPerWeek,
                v => setForm(f => ({ ...f, rateKgPerWeek: v })),
              )}
            </div>
          )}
        </>
      ))}

      {group('Training days per week',
        seg([0, 1, 2, 3, 4, 5, 6, 7].map(n => ({ id: n, label: String(n) })), form.trainingDays, v => setForm(f => ({ ...f, trainingDays: v }))),
        cyclesDays
          ? 'Training days get more carbs, rest days fewer. Set how far apart below.'
          : 'Every day gets the same target, since there is no second day type to cycle against.')}

      {/* How far the two day types are pulled apart. The week's total is fixed
          at every setting, so this only decides where the calories sit inside
          it. The automatic split is the sharpest one on offer and therefore the
          slider's floor, which also makes it the default without pinning a
          value that would then stop following the training day count. */}
      {cyclesDays && group('Rest day calories', (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="range" min={minRestPct} max="100" step="1" value={restPct}
            onChange={e => {
              const v = +e.target.value;
              // Back at the floor it goes to null, so it follows the training
              // day count again instead of pinning the rounded percentage.
              setForm(f => ({ ...f, restRatioPct: v <= minRestPct ? null : v }));
            }}
            style={{ flex: 1, background: `linear-gradient(to right, var(--accent) ${restFillPct}%, var(--range-track) ${restFillPct}%)` }} />
          <span className="num" style={{ fontSize: 13, color: UI.inkSoft, minWidth: 40, textAlign: 'right' }}>{restPct}%</span>
        </div>
      ),
      restPct >= 100
        ? 'Both day types eat the same. No carb cycling at all.'
        : `A rest day is ${restPct}% of a training day. All the way left is the sharpest split, all the way right feeds both the same. The weekly total does not move either way.`,
      form.restRatioPct != null ? resetBtn(() => setForm(f => ({ ...f, restRatioPct: null }))) : null)}

      {/* Protein has no per-kg option, only the app's own 2g/kg default or a
          fixed number: for anyone with a settled protein target, holding it
          exact matters more than tracking a ratio that drifts with the
          scale on a day the number wobbles. */}
      {group('Fixed protein', (
        <>
          {hint('Set protein to an exact number of grams every day, rather than following your bodyweight.')}
          {form.proteinFixed && (
            <div style={{ marginTop: 12 }}>
              <div className="micro" style={{ marginBottom: 6 }}>Protein g / day</div>
              <div style={{ width: 88 }}>
                <EstimatorInput inputMode="numeric" value={form.proteinGStr ?? ''}
                  onChange={e => setForm(f => ({ ...f, proteinGStr: e.target.value }))} />
              </div>
            </div>
          )}
        </>
      ), null, <Toggle on={!!form.proteinFixed} onToggle={() => setForm(f => ({ ...f, proteinFixed: !f.proteinFixed }))} />)}

      {/* Auto: 25% of calories, floored at FAT_FLOOR_PER_KG. Per kg: fat lands
          on a fixed amount per unit of bodyweight and everything it frees
          goes to carbs (below FAT_FLOOR_PER_KG still applies, with a
          warning, the automatic split will not go that low on its own but
          the user may ask for it). Fixed grams: the exact same number every
          day, same reasoning as Fixed protein above. */}
      {group('Fat', (
        <>
          {seg(
            [{ id: 'auto', label: 'Auto' }, { id: 'perKg', label: 'Per ' + UI.unit() }, { id: 'fixed', label: 'Fixed g' }],
            fatModeUI,
            v => setForm(f => ({ ...f, lowFat: v === 'perKg', fatFixed: v === 'fixed' })),
          )}
          {fatModeUI === 'perKg' && (
            <div style={{ marginTop: 12 }}>
              <div className="micro" style={{ marginBottom: 6 }}>Fat g per {UI.unit()}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 88, flexShrink: 0 }}>
                  <EstimatorInput inputMode="decimal" value={form.fatPerStr ?? ''}
                    onChange={e => setForm(f => ({ ...f, fatPerStr: e.target.value }))} />
                </div>
                {hint(weightKg != null && fatPerKg != null
                  ? `About ${Math.round(weightKg * fatPerKg)} g of fat a day at your weight.`
                  : 'Enter a weight above to see what this comes to.', { flex: 1 })}
              </div>
            </div>
          )}
          {fatModeUI === 'fixed' && (
            <div style={{ marginTop: 12 }}>
              <div className="micro" style={{ marginBottom: 6 }}>Fat g / day</div>
              <div style={{ width: 88 }}>
                <EstimatorInput inputMode="numeric" value={form.fatGStr ?? ''}
                  onChange={e => setForm(f => ({ ...f, fatGStr: e.target.value }))} />
              </div>
            </div>
          )}
          {fatBelowFloor && (
            <div style={{
              display: 'flex', gap: 8, marginTop: 10, padding: '8px 10px', borderRadius: 6,
              background: 'rgba(var(--warn-rgb),0.12)', border: `var(--hair-width) solid ${UI.warn}`,
              fontSize: 11, color: UI.ink, fontFamily: UI.fontUi, lineHeight: '16px', textShadow: 'none',
            }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ color: UI.warn, marginTop: 1 }} />
              <span>
                Under {fatPerToDisplay(LB.FAT_FLOOR_PER_KG)} g per {UI.unit()} the automatic split would never go, since fat that low is where hormones start to suffer. Your call, but go in knowing it.
              </span>
            </div>
          )}
        </>
      ))}

      <Bezel style={{ marginTop: 8, marginBottom: 12 }}>The estimate</Bezel>

      {shown ? (
        <Card style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
            {headlineStat('Maintenance', est ? est.tdee : null, 'what you burn')}
            <Hairline vertical style={{ alignSelf: 'stretch' }} />
            {headlineStat('Your week', weekAvgCalories, deltaLabel,
              deltaContradictsGoal ? UI.warn : UI.inkSoft)}
          </div>
          <Hairline style={{ marginBottom: 12 }} />
          {daySection('training', 'Training day')}
          {daySection('rest', 'Rest day')}
          {hint(
            <>
              {"Change any number and the others follow to keep the day's calories. Tap a padlock to pin one: later edits leave it alone, and it holds its value when you change the inputs above."}
              {(fatPerKg != null || fatGVal != null) ? ' Fat stays on your fixed number unless you type over it.' : ''}
              {proteinGVal != null ? ' Protein stays on your fixed number unless you type over it.' : ''}
            </>, { marginTop: 12 })}
          {manual && (
            // The one full reset: drops the hand edits and the padlocks
            // together, since a pin that outlived the numbers it was pinning
            // would only surprise the next edit.
            <button onClick={() => { setManual(null); setLocks({ training: {}, rest: {} }); }} style={{
              marginTop: 10, background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
              color: UI.gold, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600,
              letterSpacing: '0.1em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent',
            }}>Back to the estimate</button>
          )}
        </Card>
      ) : (
        <Card style={{ padding: 14, marginBottom: 16, textAlign: 'center' }}>
          <i className="fa-solid fa-calculator" style={{ fontSize: 16, color: UI.inkGhost }} />
          {hint('Fill in weight, height and year of birth to see an estimate.', { marginTop: 8 })}
        </Card>
      )}

      <Btn onClick={apply} disabled={!shown} style={{ width: '100%' }}>{standalone ? 'Save automation settings' : 'Use these numbers'}</Btn>
    </Sheet>
  );
}

function MacroTargetSheet({ open, onClose, store, setStore, coachingMacros }) {
  // This sheet edits the user's PERSONAL targets, so prefill from their own
  // targets first; fall back to the coach macros only as a convenience when they
  // have none of their own. (effectiveMacroTargets is coach-first for the health
  // display, which is the opposite priority and would show coach values here.)
  const personalTargets = store.settings?.macroTargets;
  const coachHasMacros = LB.hasMacroTargets(coachingMacros);
  const prefillSource = LB.hasMacroTargets(personalTargets) ? personalTargets : coachingMacros;
  const empty = { proteinTraining: '', carbsTraining: '', fatTraining: '', proteinRest: '', carbsRest: '', fatRest: '' };
  const [form, setForm] = useStateH(empty);
  const [confirmEl, confirm] = useConfirm();
  const initialSnap = useRefH(null);
  const [estimatorOpen, setEstimatorOpen] = useStateH(false);

  useEffectH(() => {
    if (!open) return;
    const m = prefillSource || {};
    const next = {
      proteinTraining: m.proteinTraining != null ? String(m.proteinTraining) : '',
      carbsTraining: m.carbsTraining != null ? String(m.carbsTraining) : '',
      fatTraining: m.fatTraining != null ? String(m.fatTraining) : '',
      proteinRest: m.proteinRest != null ? String(m.proteinRest) : '',
      carbsRest: m.carbsRest != null ? String(m.carbsRest) : '',
      fatRest: m.fatRest != null ? String(m.fatRest) : '',
    };
    setForm(next);
    initialSnap.current = next;
  }, [open]);

  const isDirty = initialSnap.current != null && JSON.stringify(form) !== JSON.stringify(initialSnap.current);
  const requestClose = async () => {
    if (isDirty && !await confirm('Your macro targets won\'t be saved.', { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    onClose();
  };

  const calsTraining = caloriesFromMacros(healthInt(form.proteinTraining), healthInt(form.carbsTraining), healthInt(form.fatTraining));
  const calsRest = caloriesFromMacros(healthInt(form.proteinRest), healthInt(form.carbsRest), healthInt(form.fatRest));

  const save = () => {
    const targets = {
      proteinTraining: healthInt(form.proteinTraining), carbsTraining: healthInt(form.carbsTraining), fatTraining: healthInt(form.fatTraining), caloriesTraining: calsTraining,
      proteinRest: healthInt(form.proteinRest), carbsRest: healthInt(form.carbsRest), fatRest: healthInt(form.fatRest), caloriesRest: calsRest,
    };
    setStore(s => ({ ...s, settings: { ...s.settings, macroTargets: targets } }));
    onClose();
  };

  // Same fields, same look and same behaviour as the estimator these numbers
  // usually arrive from: the two sheets sit one tap apart, so a different input
  // treatment in each would read as two different screens.
  const num = (k, lbl) => (
    <div style={{ flex: 1 }}>
      <div className="micro" style={{ marginBottom: 6 }}>{lbl}</div>
      <EstimatorInput inputMode="numeric" value={form[k]}
        onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
    </div>
  );
  const section = (suffix, label, cals) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span className="micro">{label}</span>
        {cals != null && <span className="num" style={{ fontSize: 13, color: UI.warn }}>{cals} kcal</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {num(`protein${suffix}`, 'Protein g')}
        {num(`carbs${suffix}`, 'Carbs g')}
        {num(`fat${suffix}`, 'Fat g')}
      </div>
    </div>
  );

  return (
    <Sheet open={open} onClose={requestClose} title="Macro targets">
      {coachHasMacros && (
        <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: UI.fontUi, padding: '6px 10px', background: `rgba(var(--accent-rgb),0.16)`, borderRadius: 6, border: `var(--hair-width) solid rgba(var(--accent-rgb),0.2)`, marginBottom: 14 }}>
          Your coaching macros are active and take priority. These personal targets apply only if the coaching macros are removed.
        </div>
      )}
      {/* Fills the fields below rather than saving: an estimate is a starting
          point, and the user confirms it with the same Save button they would
          use for hand-typed numbers. */}
      <button onClick={() => setEstimatorOpen(true)} style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginBottom: 18,
        padding: '10px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`,
        borderRadius: 6, color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent', textShadow: 'none',
      }}>
        <i className="fa-solid fa-calculator" style={{ fontSize: 13, color: 'var(--accent)' }} />
        <span style={{ flex: 1, textAlign: 'left' }}>Estimate targets for me</span>
        <i className="fa-solid fa-chevron-right" style={{ fontSize: 11, color: UI.inkFaint }} />
      </button>
      {section('Training', 'Training day', calsTraining)}
      {section('Rest', 'Rest day', calsRest)}
      <Btn onClick={save} style={{ width: '100%' }}>Save targets</Btn>
      <MacroEstimatorSheet open={estimatorOpen} onClose={() => setEstimatorOpen(false)} store={store} setStore={setStore}
        onApply={t => setForm({
          proteinTraining: String(t.proteinTraining), carbsTraining: String(t.carbsTraining), fatTraining: String(t.fatTraining),
          proteinRest: String(t.proteinRest), carbsRest: String(t.carbsRest), fatRest: String(t.fatRest),
        })} />
      {confirmEl}
    </Sheet>
  );
}

// ─── Macro targets (active split + algorithm estimate) ─────────────────────
// One card, not two: the active targets (accent-framed box, the numbers
// actually in effect) and the algorithm's last estimate (plain-framed box
// below it, a reference to compare against, not something live on its own).
// Used to be a separate source/check-in card sitting above a purely-display
// Macro Targets card, merged back together since two accent-bordered cards
// stacked on top of each other read as competing for attention rather than
// one thing. Deliberately kept visually quiet in every automation state
// except "due": that row is the one thing in the lower box that must never
// lose a fight for attention against the coach-info / SET-EDIT clutter.
function MacroSourceCard({ store, setStore, dragHandle, tf, setTf, coachHasMacros, fromCoach, selfCoachedMacros, hasTargets, onSetTarget, onOpenCheckin, onOpenSettings, children }) {
  const calc = store.settings?.macroCalc || {};
  const sourceLabel = !fromCoach ? 'Personal targets' : selfCoachedMacros ? 'Self-coached' : 'From your coach';
  // Offered while coached too now: a coach's numbers still always win (see
  // effectiveMacroTargets, unchanged), Apply below only ever touches the
  // dormant personal target, this is purely a second opinion to weigh
  // against the coach's own numbers, not a way to override them.
  const showAutomation = true;
  // trainingDays is asked in every branch of the full estimator and nowhere
  // else, unlike goal (now also directly settable below, on its own,
  // without ever running the estimator): its presence is what actually
  // tells apart "the estimator has run at least once" from a goal picked
  // standalone, which is what macroTargetsFromGoal needs to produce a real
  // training/rest split instead of silently defaulting to a flat
  // maintain-style number.
  const estimatorConfigured = calc.trainingDays != null;
  const checkinEnabled = showAutomation && estimatorConfigured && !!calc.checkinEnabled;

  // Recomputed from scratch on every relevant store change rather than cached
  // anywhere: cheap (14 days of logs), and a value that decides whether a
  // "ready" CTA appears must never go stale behind a click.
  const adaptive = useMemoH(
    () => checkinEnabled ? LB.estimateAdaptiveTdee(store, LB.todayISO()) : null,
    [checkinEnabled, store.dailyLogs, store.statusMode, store.statusPeriods, store.settings?.unit]
  );

  const enableCheckins = () => {
    setStore(s => ({ ...s, settings: { ...s.settings, macroCalc: { ...s.settings.macroCalc, checkinEnabled: true } } }));
  };
  const isLbs = UI.unit() === 'lbs';
  // Gain/cut with no rate on record yet: macroTargetsFromGoal (store.js)
  // reads a missing rateKgPerWeek as 0, which silently produces MAINTENANCE
  // calories the moment the weekly check-in applies, despite the goal
  // saying otherwise. Rather than picking a rate for the user invisibly,
  // park the goal here and ask (rateModalGoal holds which one is pending),
  // committed together in confirmGoalRate below. Maintain never needs a
  // rate (WeeklyCheckinSheet already forces it to 0), so it always applies
  // immediately. Already has a rate on file (a previous estimator run, or a
  // previous answer here)? Don't ask again, just switch.
  const [rateModalGoal, setRateModalGoal] = useStateH(null);
  // Standalone, independent of the estimator: a user on manual or coached
  // targets who has never run (and may never run) the full estimator can
  // still tell the app cut/maintain/gain directly. Consumed by the AI daily
  // summary (LB.buildDailySummaryPayload) to judge a weight trend's
  // direction correctly instead of defaulting to "down is good", and
  // prefills MacroEstimatorSheet's own goal step if it's ever opened later.
  const setGoal = goal => {
    if (goal !== 'maintain' && !calc.rateKgPerWeek) { setRateModalGoal(goal); return; }
    setStore(s => ({ ...s, settings: { ...s.settings, macroCalc: { ...s.settings.macroCalc, goal } } }));
  };
  const confirmGoalRate = rateKgPerWeek => {
    setStore(s => ({ ...s, settings: { ...s.settings, macroCalc: { ...s.settings.macroCalc, goal: rateModalGoal, rateKgPerWeek } } }));
    setRateModalGoal(null);
  };

  // 'insufficient' | 'waiting' | 'due' | null (automation off or not offered).
  // Never checked in yet is folded straight into 'due' the moment there is
  // enough data: the first check-in shouldn't wait an extra week beyond that.
  let status = null, daysUntil = null;
  if (checkinEnabled) {
    if (!adaptive?.ok) status = 'insufficient';
    else {
      const since = calc.lastCheckinAt ? healthDayDiff(calc.lastCheckinAt, LB.todayISO()) : null;
      if (since == null || since >= 7) status = 'due';
      else { status = 'waiting'; daysUntil = 7 - since; }
    }
  }
  // Plain historical marker, not tied to checkinEnabled: whether the
  // algorithm's numbers are currently active or not (a coach could have
  // taken over since, or automation could since be off), "I did tap Apply on
  // this date" stays true, and that's the thing to confirm here.
  const appliedDaysAgo = calc.lastAppliedAt ? healthDayDiff(calc.lastAppliedAt, LB.todayISO()) : null;

  return (
    <>
    <HealthChartCard title="Targets" icon="fa-list-check" tf={tf} setTf={setTf} dragHandle={dragHandle}
      headerExtra={
        <button data-reorder-ignore="true" onClick={onSetTarget} style={{
          background: 'transparent', border: `var(--hair-width) solid rgba(var(--accent-rgb),0.4)`,
          borderRadius: 4, padding: '3px 12px', color: 'var(--accent)',
          fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent', flexShrink: 0,
        }}>{hasTargets ? 'EDIT' : 'SET'}</button>
      }>
      <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2, marginBottom: 10 }}>{sourceLabel}</div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div className="micro" style={{ color: UI.inkFaint }}>Goal</div>
          {/* setGoal only ever prompts for a rate the FIRST time (see its own
              comment above), so once one is on file there was no way back in
              to change it short of the full estimator sheet. Reuses the exact
              same rateModalGoal/confirmGoalRate plumbing, just triggered
              on demand instead of only on a bare goal. */}
          {calc.goal !== 'maintain' && calc.rateKgPerWeek > 0 && (
            <button data-reorder-ignore="true" onClick={() => setRateModalGoal(calc.goal)} style={{
              display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', padding: 0,
              color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent', textShadow: 'none', minWidth: 0,
            }}>
              <i className="fa-solid fa-gauge" style={{ fontSize: 9, color: 'var(--accent)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {Math.round((isLbs ? calc.rateKgPerWeek / LBS_TO_KG : calc.rateKgPerWeek) * 100) / 100} {UI.unit()}/week · tap to change
              </span>
            </button>
          )}
        </div>
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
          {MACRO_GOAL_OPTIONS.map(o => (
            <button key={o.id} data-reorder-ignore="true" onClick={() => setGoal(o.id)} style={{
              flex: 1, padding: '7px 4px', border: 'none', cursor: 'pointer',
              background: calc.goal === o.id ? 'var(--accent)' : 'transparent',
              color: calc.goal === o.id ? 'var(--accent-ink)' : UI.inkFaint,
              textShadow: calc.goal === o.id ? 'none' : 'var(--text-lift)',
              fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.03em',
              WebkitTapHighlightColor: 'transparent',
            }}>{o.label}</button>
          ))}
        </div>
      </div>
      {children}
      {/* Plain-framed on purpose, unlike the accent-framed box above: this is
          a reference to compare against, not the numbers actually in effect.
          Deliberately reads from the lastAppliedTargets SNAPSHOT, not the
          live macroTargets, so it keeps showing what the algorithm said even
          after a later hand-edit or a coach taking over moves the active
          numbers away from it. */}
      <div style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
          <span className="micro" style={{ color: UI.inkFaint, flex: 1 }}>ALGORITHM ESTIMATE</span>
          {appliedDaysAgo != null && (
            <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>
              {appliedDaysAgo <= 0 ? 'applied today' : appliedDaysAgo === 1 ? 'applied yesterday' : `applied ${appliedDaysAgo}d ago`}
            </span>
          )}
        </div>
        {calc.lastAppliedTargets && ['Training', 'Rest'].map(suffix => (
          <div key={suffix} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0' }}>
            <span style={{ width: 62, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.inkFaint }}>{suffix}</span>
            <span className="num" style={{ fontSize: 16, color: 'var(--accent)', fontWeight: 400 }}>
              {calc.lastAppliedTargets[`calories${suffix}`]}<span style={{ fontSize: 9, color: UI.inkFaint, marginLeft: 2 }}>kcal</span>
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ display: 'flex', gap: 9 }}>
              <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>P</span> {calc.lastAppliedTargets[`protein${suffix}`]}</span>
              <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>C</span> {calc.lastAppliedTargets[`carbs${suffix}`]}</span>
              <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>F</span> {calc.lastAppliedTargets[`fat${suffix}`]}</span>
            </span>
          </div>
        ))}
        {/* Same week-average blend as the Daily Targets box above (see
            targetWeekAvgRow): trainingDays is always on file once the
            estimator has produced lastAppliedTargets at all, both are set
            together by the same apply. */}
        {calc.lastAppliedTargets && calc.trainingDays != null && (() => {
          const weekCal = LB.weeklyAverageCalories(calc.lastAppliedTargets.caloriesTraining, calc.lastAppliedTargets.caloriesRest, calc.trainingDays);
          const weekMacros = LB.weeklyAverageMacros(
            { protein: calc.lastAppliedTargets.proteinTraining, carbs: calc.lastAppliedTargets.carbsTraining, fat: calc.lastAppliedTargets.fatTraining },
            { protein: calc.lastAppliedTargets.proteinRest, carbs: calc.lastAppliedTargets.carbsRest, fat: calc.lastAppliedTargets.fatRest },
            calc.trainingDays,
          );
          return (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0', marginTop: 2, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
              <span style={{ width: 62, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.inkFaint }}>Week avg</span>
              <span className="num" style={{ fontSize: 16, color: UI.inkSoft, fontWeight: 400 }}>
                {weekCal}<span style={{ fontSize: 9, color: UI.inkFaint, marginLeft: 2 }}>kcal</span>
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ display: 'flex', gap: 9 }}>
                <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>P</span> {weekMacros.protein}</span>
                <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>C</span> {weekMacros.carbs}</span>
                <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft }}><span style={{ color: UI.inkGhost, fontSize: 9 }}>F</span> {weekMacros.fat}</span>
              </span>
            </div>
          );
        })()}

        {status === 'insufficient' && (
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', marginTop: 10 }}>
            Building your baseline, log a bit more and check back.
          </div>
        )}
        {status === 'waiting' && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
            <span style={{ flex: 1, fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>
              Next check-in in {daysUntil} day{daysUntil === 1 ? '' : 's'}.
            </span>
            {/* Skipping (or applying) only ever moves the automatic nag by a
                week, it was never meant to also lock the sheet itself behind
                that timer: without this, "Skip for now" had no way back in
                until the week was up. */}
            <button data-reorder-ignore="true" onClick={onOpenCheckin} style={{
              background: 'none', border: 'none', padding: 0, color: 'var(--accent)',
              fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent', textShadow: 'none', flexShrink: 0,
            }}>Check in now</button>
          </div>
        )}
        {status === 'due' && (
          <button data-reorder-ignore="true" onClick={onOpenCheckin} style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 10,
            padding: '10px 12px', background: `rgba(var(--accent-rgb),0.16)`,
            border: `var(--hair-width) solid rgba(var(--accent-rgb),0.4)`, borderRadius: 6,
            color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 700,
            cursor: 'pointer', WebkitTapHighlightColor: 'transparent', textShadow: 'none',
          }}>
            <i className="fa-solid fa-bolt" style={{ fontSize: 13 }} />
            <span style={{ flex: 1, textAlign: 'left' }}>{coachHasMacros ? 'Second opinion ready' : 'Weekly check-in ready'}</span>
            <i className="fa-solid fa-chevron-right" style={{ fontSize: 11 }} />
          </button>
        )}
        {showAutomation && !estimatorConfigured && (
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 10 }}>
            {coachHasMacros ? 'Run the estimator once to see a second opinion.' : 'Run the estimator once to enable weekly check-ins.'}
          </div>
        )}
        {showAutomation && estimatorConfigured && !checkinEnabled && (
          <button data-reorder-ignore="true" onClick={enableCheckins} style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', padding: 0,
            marginTop: 10, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent', textShadow: 'none',
          }}>
            <i className="fa-solid fa-arrows-rotate" style={{ fontSize: 10, color: 'var(--accent)' }} />
            {coachHasMacros ? 'Enable second opinions' : 'Enable weekly check-ins'}
          </button>
        )}
        {/* Rate, protein/fat mode, rest-day closeness: everything the check-in
            itself recalibrates against, without a detour through the estimate's
            own weight/height/age fields to get there. Opens the same estimator
            MacroTargetSheet's own "Estimate targets for me" does, just reached
            directly since this is now where someone actively relying on the
            automation is already standing. */}
        {checkinEnabled && (
          <button data-reorder-ignore="true" onClick={onOpenSettings} style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', padding: 0,
            marginTop: 10, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent', textShadow: 'none',
          }}>
            <i className="fa-solid fa-sliders" style={{ fontSize: 10, color: 'var(--accent)' }} />
            Adjust rate, protein & fat
          </button>
        )}
      </div>
    </HealthChartCard>
    {/* Only reached when gain/cut is picked with no rate on file yet, see
        setGoal above: asks once, up front, rather than silently defaulting
        a number the user never chose. */}
    <Sheet open={!!rateModalGoal} onClose={() => setRateModalGoal(null)} title="How fast?" titleColor="var(--accent)">
      <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: '17px' }}>
        Pick a weekly rate for {rateModalGoal === 'gain' ? 'gaining' : 'losing'}. You can fine-tune this any time from the full estimator.
      </div>
      <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
        {(isLbs ? MACRO_RATE_OPTIONS_LBS : MACRO_RATE_OPTIONS_KG).map(r => (
          <button key={r} onClick={() => confirmGoalRate(isLbs ? r * LBS_TO_KG : r)} style={{
            flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer', background: 'transparent',
            color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, letterSpacing: '0.03em',
            WebkitTapHighlightColor: 'transparent',
          }}>{r} {UI.unit()}</button>
        ))}
      </div>
    </Sheet>
    </>
  );
}

// The sheet the "Weekly check-in ready" CTA opens. A read-only report (window
// average calories, weight trend, the freshly solved maintenance figure) plus
// the one real decision: apply the recalibrated targets or skip this week.
// Skipping still counts as "handled", same as Apply: lastCheckinAt moves to
// today either way, that is what stops the nag, not whether the numbers
// actually changed. Never applies anything on its own; see MacroEstimatorSheet
// for the same "estimate is a prefill, not a save" philosophy this mirrors.
function WeeklyCheckinSheet({ open, onClose, store, setStore, coachHasMacros, coachingMacros, onOpenSettings }) {
  const calc = store.settings?.macroCalc || {};
  const isLbs = UI.unit() === 'lbs';
  const toKg = w => (isLbs ? Number(w) * LBS_TO_KG : Number(w));
  const fromKg = kg => (isLbs ? kg / LBS_TO_KG : kg);

  const adaptive = useMemoH(
    () => open ? LB.estimateAdaptiveTdee(store, LB.todayISO()) : null,
    [open, store.dailyLogs, store.statusMode, store.statusPeriods, store.settings?.unit]
  );

  // What the ORIGINAL one-time estimate said, for a sense of higher/lower than
  // before. Not itself persisted (only its inputs are, in macroCalc), so
  // recomputed here from those exact inputs via the same formula.
  const originalTdee = useMemoH(() => {
    if (!(calc.heightCm > 0) || !(calc.birthYear > 0) || !calc.sex || !(calc.weightKg > 0)) return null;
    const age = new Date().getFullYear() - calc.birthYear;
    return LB.estimateTdee({ weightKg: calc.weightKg, heightCm: calc.heightCm, age, sex: calc.sex, activity: calc.activity })?.tdee ?? null;
  }, [calc.heightCm, calc.birthYear, calc.sex, calc.weightKg, calc.activity]);

  // Same call MacroEstimatorSheet's own apply() feeds into, just with the
  // freshly solved tdee and the freshest known bodyweight instead of a
  // hand-typed one; every other input is reused verbatim from macroCalc.
  const newTargets = useMemoH(() => {
    if (!adaptive?.ok) return null;
    const loggedWeight = LB.latestBodyweight(store);
    const weightKg = loggedWeight != null ? toKg(loggedWeight) : calc.weightKg;
    if (!(weightKg > 0)) return null;
    return LB.macroTargetsFromGoal({
      tdee: adaptive.tdee, weightKg,
      goal: calc.goal, rateKgPerWeek: calc.goal === 'maintain' ? 0 : calc.rateKgPerWeek,
      trainingDays: calc.trainingDays,
      proteinG: calc.proteinG, fatPerKg: calc.fatPerKg, fatG: calc.fatG,
      restRatio: calc.restRatioPct != null ? calc.restRatioPct / 100 : null,
    });
  }, [adaptive, store.dailyLogs, calc.weightKg, calc.goal, calc.rateKgPerWeek, calc.trainingDays, calc.proteinG, calc.fatPerKg, calc.fatG, calc.restRatioPct, isLbs]);

  const tdeeDelta = (adaptive?.ok && originalTdee != null) ? adaptive.tdee - originalTdee : null;
  // adaptive.weightChangeKg spans adaptive.daySpan days (close to the full
  // ~14-day window, not 7, see estimateAdaptiveTdee), rescaled here to an
  // actual per-week rate: showing the raw span invited reading it as a
  // weekly figure it wasn't, and the check-in itself already runs on a
  // 7-day cadence, so a mismatched timeframe here was exactly backwards.
  const weeklyRateKg = adaptive?.ok ? adaptive.weightChangeKg * 7 / adaptive.daySpan : null;
  const weightDeltaDisplay = weeklyRateKg != null ? Math.round(Math.abs(fromKg(weeklyRateKg)) * 10) / 10 : null;
  const weightDir = weeklyRateKg == null ? null : weeklyRateKg > 0.05 ? 'up' : weeklyRateKg < -0.05 ? 'down' : 'steady';
  // The week-average figure for each target set, the only thing directly
  // comparable to "New maintenance estimate" above: Training/Rest alone
  // don't say anything on their own without knowing how many of each a week
  // actually has (calc.trainingDays), same reasoning weeklyAverageCalories
  // exists for everywhere else in the app.
  const algoAvg = newTargets ? LB.weeklyAverageCalories(newTargets.caloriesTraining, newTargets.caloriesRest, calc.trainingDays) : null;
  const coachAvg = (coachHasMacros && LB.hasMacroTargets(coachingMacros))
    ? LB.weeklyAverageCalories(coachingMacros.caloriesTraining, coachingMacros.caloriesRest, calc.trainingDays)
    : null;

  // Both actions count as "handled this week": only Apply also touches
  // macroTargets, lastCheckinAt moves to today either way. lastAppliedAt is
  // separate and only ever set on an actual Apply, a plain historical marker
  // ("the algorithm's numbers were last accepted on this date") for
  // MacroSourceCard to surface, not something a later Skip should touch or
  // clear.
  const finish = (applyTargets) => {
    setStore(s => ({
      ...s,
      settings: {
        ...s.settings,
        ...(applyTargets && newTargets ? { macroTargets: newTargets } : {}),
        macroCalc: {
          ...s.settings.macroCalc,
          lastCheckinAt: LB.todayISO(),
          // A snapshot, not a pointer at macroTargets: the point is showing
          // what the algorithm actually said next to whatever is active NOW,
          // and macroTargets can drift away from this (a hand-edit, a coach
          // taking over) without this record changing to match it.
          ...(applyTargets && newTargets ? { lastAppliedAt: LB.todayISO(), lastAppliedTargets: newTargets } : {}),
        },
      },
    }));
    onClose();
  };

  const chip = (k, v) => (
    <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft }}>
      <span style={{ color: UI.inkGhost, fontSize: 9 }}>{k}</span> {v}
    </span>
  );
  // targets: whichever target set (the algo's newTargets, or coachingMacros
  // for the comparison block below) to read this row's numbers from.
  // groupKey disambiguates the two Training/Rest row pairs when both render.
  const dayRow = (label, suffix, targets, groupKey) => (
    <div key={`${groupKey}-${suffix}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0' }}>
      <span style={{ width: 62, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.inkFaint }}>{label}</span>
      <span className="num" style={{ fontSize: 16, color: 'var(--accent)', fontWeight: 400 }}>
        {targets[`calories${suffix}`]}<span style={{ fontSize: 9, color: UI.inkFaint, marginLeft: 2 }}>kcal</span>
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ display: 'flex', gap: 9 }}>
        {chip('P', targets[`protein${suffix}`])}
        {chip('C', targets[`carbs${suffix}`])}
        {chip('F', targets[`fat${suffix}`])}
      </span>
    </div>
  );
  const showCoachCompare = coachAvg != null;
  const avgLine = (value) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
      <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Average</span>
      <span className="num" style={{ fontSize: 15, color: UI.ink, fontWeight: 400 }}>
        {value}<span style={{ fontSize: 9, color: UI.inkFaint, marginLeft: 2 }}>kcal</span>
      </span>
    </div>
  );
  // What this whole report is being judged against: without it, "Weekly
  // trend: Up 0.4" reads as good or bad only if you already remember which
  // way you're trying to move, which defeats the point of putting the trend
  // next to a maintenance estimate in the first place.
  const goalLabel = MACRO_GOAL_OPTIONS.find(o => o.id === calc.goal)?.label;
  const goalRateDisplay = (calc.goal !== 'maintain' && calc.rateKgPerWeek > 0)
    ? Math.round(fromKg(calc.rateKgPerWeek) * 100) / 100
    : null;

  return (
    <Sheet open={open} onClose={onClose} title={coachHasMacros ? 'Second opinion' : 'Weekly check-in'}>
      {!adaptive?.ok ? (
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi }}>Not enough data yet.</div>
      ) : (
        <>
          {goalLabel && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span className="micro" style={{ color: UI.inkFaint }}>Goal</span>
              <span style={{ fontSize: 12, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 600 }}>
                {goalLabel}{goalRateDisplay != null && ` · ${goalRateDisplay} ${UI.unit()}/week`}
              </span>
            </div>
          )}
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', marginBottom: 18 }}>
            Based on your last 14 days of logging (sick, vacation and deload days excluded).
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
            <div style={{ flex: 1 }}>
              <div className="micro" style={{ marginBottom: 6 }}>Avg calories</div>
              <div className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>
                {adaptive.avgCalories}<span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 2 }}>kcal</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="micro" style={{ marginBottom: 6 }}>Weekly trend</div>
              <div className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>
                {weightDir === 'steady' ? 'Steady' : `${weightDir === 'up' ? 'Up' : 'Down'} ${weightDeltaDisplay}`}
                {weightDir !== 'steady' && <span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 2 }}>{UI.unit()}/wk</span>}
              </div>
            </div>
          </div>
          <div style={{ marginBottom: 18, padding: '10px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6 }}>
            <div className="micro" style={{ marginBottom: 4 }}>New maintenance estimate</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span className="num" style={{ fontSize: 24, color: 'var(--accent)', fontWeight: 400 }}>
                {adaptive.tdee}<span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 2 }}>kcal</span>
              </span>
              {tdeeDelta != null && Math.abs(tdeeDelta) >= 20 && (
                <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>
                  {tdeeDelta > 0 ? `${tdeeDelta} higher` : `${Math.abs(tdeeDelta)} lower`} than your last estimate
                </span>
              )}
            </div>
          </div>
          {newTargets ? (
            <>
              {showCoachCompare && (
                <>
                  <div className="micro" style={{ color: 'var(--accent)', marginBottom: 4 }}>Your coach</div>
                  {avgLine(coachAvg)}
                  {dayRow('Training', 'Training', coachingMacros, 'coach')}
                  <div style={{ height: 0.5, background: UI.hair }} />
                  {dayRow('Rest', 'Rest', coachingMacros, 'coach')}
                  <div className="micro" style={{ color: UI.inkFaint, margin: '14px 0 4px' }}>The algorithm suggests</div>
                </>
              )}
              {avgLine(algoAvg)}
              {dayRow('Training', 'Training', newTargets, 'algo')}
              <div style={{ height: 0.5, background: UI.hair }} />
              {dayRow('Rest', 'Rest', newTargets, 'algo')}
              {coachHasMacros && (
                <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', marginTop: 12 }}>
                  Applying only updates your personal targets. Your coach's numbers stay active either way.
                </div>
              )}
              {/* The algorithm's own knobs (rate, protein/fat mode, rest-day
                  ratio) live in the estimator, not in this read-only report:
                  without a way out from here, disagreeing with these numbers
                  left no clue where to actually go change the inputs behind
                  them. */}
              <button onClick={onOpenSettings} style={{
                display: 'flex', alignItems: 'flex-start', gap: 6, width: '100%', background: 'transparent', border: 'none', padding: 0,
                marginTop: 12, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, lineHeight: '16px', cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent', textShadow: 'none', textAlign: 'left',
              }}>
                <i className="fa-solid fa-sliders" style={{ fontSize: 10, color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                <span>You can adjust how the algorithm splits these macros anytime in settings.</span>
              </button>
              <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                <Btn kind="ghost" onClick={() => finish(false)} style={{ flex: 1 }}>Skip for now</Btn>
                <Btn onClick={() => finish(true)} style={{ flex: 1 }}>Apply</Btn>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', marginBottom: 14 }}>
                Log a bodyweight to see the recalibrated targets.
              </div>
              <Btn kind="ghost" onClick={() => finish(false)} style={{ width: '100%' }}>Skip for now</Btn>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

// ─── Today / selected-day metrics card ────────────────────────────────────────

function HealthMetricsCard({ log, dateLabel, isToday, onJumpToday, dragHandle, trained, hasCardio, dayTarget, isStatusDay, mealOfChoiceOrdinal, weightUnit }) {
  // Coach view passes the client's unit; athlete view falls back to own unit.
  const wUnit = weightUnit || UI.unit();
  const stat = (label, value, unit) => (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <div className="num health-stat-value" style={{ color: value != null ? UI.ink : UI.inkGhost, fontWeight: 300 }}>
        {value != null ? value : '—'}{value != null && unit ? <span className="health-stat-unit" style={{ color: UI.inkFaint, marginLeft: 3 }}>{unit}</span> : ''}
      </div>
      <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );
  const storedAdh = log?.adherence;
  // A meal-of-choice day is unscored by design, same as sick/vacation: the
  // one meal absorbs whatever was left, so a percentage measures nothing.
  // This also has to suppress the FALLBACK below, not just the stored value,
  // or the card would helpfully re-derive the score the save path discarded.
  const isMealOfChoice = !!log?.mealOfChoice;
  const unscoredDay = isStatusDay || isMealOfChoice;
  // On a sick/vacation day adherence is intentionally nulled at save (no target
  // to hit), so don't recompute it from the raw macros here.
  const adh = (storedAdh != null && !isMealOfChoice)
    ? storedAdh
    : (!unscoredDay && log && dayTarget ? LB.macroAdherence({ protein: log.protein, carbs: log.carbs, fat: log.fat }, dayTarget) : null);
  const showAdh = dayTarget != null || adh != null;
  const isPerfect = adh != null && Math.round(adh) >= 97;
  const verdict = adh == null ? null : Math.round(adh) >= 97 ? 'PERFECT' : Math.round(adh) >= 90 ? 'STRONG' : Math.round(adh) >= 75 ? 'ON TRACK' : 'OFF TRACK';
  const badge = (icon, label, alpha) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, background: `rgba(var(--accent-rgb),${alpha})`, border: `var(--hair-width) solid rgba(var(--accent-rgb),${alpha * 2})`, borderRadius: 4, padding: '3px 7px' }}>
      <i className={`fa-solid ${icon}`} style={{ fontSize: 9, color: 'var(--accent)' }} />
      <span style={{ fontSize: 9, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.06em' }}>{label}</span>
    </span>
  );
  return (
    <Card accent style={{ padding: 16, borderLeft: `3px solid ${UI.gold}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: trained || hasCardio ? 8 : 12 }}>
        {dragHandle}
        <span style={{ flex: 1, fontFamily: UI.fontDisplay, fontSize: 20, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--accent)' }}>
          {dateLabel}
        </span>
        {!isToday && onJumpToday && (
          <button data-reorder-ignore="true" onClick={onJumpToday} style={{ background: 'transparent', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>Today →</button>
        )}
      </div>
      {(trained || hasCardio) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {trained && badge('fa-dumbbell', 'TRAINED', 0.12)}
          {hasCardio && badge('fa-person-running', 'CARDIO', 0.08)}
        </div>
      )}
      {showAdh && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
            <span className={isPerfect ? 'perfect-week-pulse num' : 'num'} style={{ fontSize: 30, color: adh != null ? adherenceColor(adh) : UI.inkGhost, fontWeight: 300, lineHeight: 1 }}>{adh != null ? `${adh}%` : '—'}</span>
            {verdict && <span className={isPerfect ? 'perfect-week-pulse' : ''} style={{ fontSize: 12, color: adherenceColor(adh), fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.08em' }}>{verdict}</span>}
            {isMealOfChoice && (
              <span style={{ fontSize: 12, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.08em' }}>
                MEAL OF CHOICE{mealOfChoiceOrdinal > 1 ? ` #${mealOfChoiceOrdinal}` : ''}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.06em', textTransform: 'uppercase' }}>macro adherence</span>
          </div>
          <div style={{ height: 6, borderRadius: 4, background: UI.bgInset, overflow: 'hidden' }}>
            {adh != null && <div style={{ width: `${Math.min(100, adh)}%`, height: '100%', background: adherenceColor(adh) }} />}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        {stat('Weight', log?.weight != null ? log.weight : null, wUnit)}
        {stat('Steps', log?.steps != null ? log.steps.toLocaleString() : null)}
        {stat('Water', log?.waterMl != null ? UI.waterSummaryValue(log.waterMl, wUnit) : null, UI.waterSummaryUnit(wUnit))}
        {stat('Calories', log?.calories != null ? log.calories : null)}
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        {stat('Protein', log?.protein != null ? log.protein : null, 'g')}
        {stat('Carbs', log?.carbs != null ? log.carbs : null, 'g')}
        {stat('Fat', log?.fat != null ? log.fat : null, 'g')}
      </div>
      {dayTarget && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 12px', marginTop: 6, paddingTop: 6, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
          {[dayTarget.protein, dayTarget.carbs, dayTarget.fat].map((v, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <span className="num" style={{ fontSize: 10, color: UI.inkFaint }}>{v != null ? v : '—'}<span style={{ fontSize: 8 }}>g</span></span>
            </div>
          ))}
        </div>
      )}
      {log?.offPlanNote && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 5 }}>OFF-PLAN</div>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: '20px', whiteSpace: 'pre-wrap' }}>{log.offPlanNote}</div>
        </div>
      )}
      {log?.note && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 5 }}>NOTE</div>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: '20px', whiteSpace: 'pre-wrap' }}>{log.note}</div>
        </div>
      )}
    </Card>
  );
}


// A zane_daily_logs row counts as "logged" only if it carries real content,
// not merely by existing: a flex day-type-only override (just
// targetsSnap.dayType) must not light up as logged, and neither should the
// phantom row AiSummaryCard.generate() below can leave behind (a day with
// only training/cardio logged, nothing in zane_daily_logs itself, still gets
// a row here once an AI summary is generated for it, id/date/aiSummary only,
// see its own comment). Module-level so both HealthDateStrip and
// ExportSheet's "N days logged" count (L8, audit-2026-08: that counter used
// to be a bare row-count, which a phantom AI-summary-only row inflated)
// agree on the same definition instead of drifting.
function hlHasLogContent(l) {
  return !!l && (
    l.weight != null || l.steps != null || l.protein != null || l.carbs != null ||
    l.fat != null || l.fiber != null || l.waterMl != null || l.calories != null ||
    (l.note && l.note.trim()) || (l.offPlanNote && l.offPlanNote.trim()) ||
    // A meal-of-choice marker is content in its own right. Without this,
    // HealthDateStrip's setFlexDayType DELETES an otherwise-empty row when
    // the day is set to Rest, silently unmarking it.
    l.mealOfChoice ||
    (l.coachFields && Object.keys(l.coachFields).length)
  );
}

// ─── AI Daily Summary card ──────────────────────────────────────────────────
// User-triggered (button, never automatic) AI read on a tracked day, for
// whichever day is selected in the Health tab's date-strip (selectedDate),
// not hardcoded to yesterday: browsing the strip now browses summaries too.
// The server (ai-daily-summary) independently caps how far back a request
// can go (its own "today" +/- 3 days), daysAgo's [1,3] range below mirrors
// that with a little slack for timezone skew between client and server.
// readOnly (the coach view) renders no button at all: a coach's own tap
// would resolve server-side to the COACH's own identity, not the client's,
// and silently write into the wrong account's row rather than erroring
// loudly, so the affordance simply must not exist there.
// key={selectedDate} at both call sites remounts this on every date-strip
// navigation, so busy/error (below) always start fresh for whichever day is
// now showing instead of carrying a stale spinner or error over from a day
// the user has since browsed away from. A request still in flight at that
// point keeps running (setStore below is the parent's, unaffected by this
// component unmounting) and still saves correctly if it succeeds; its own
// setBusy/setError calls land on the now-discarded instance and are dropped,
// same as any React 18 state update on an unmounted component.
//
// aiSummaryInFlightDates: module-level, NOT component state, exactly because
// of that remount. A plain useState(false) busy flag has no memory across a
// fresh mount, so navigating away mid-request and back to the SAME date
// before it resolves showed an idle, clickable button again, letting a
// second generate() fire for that date. For a regular user the server's own
// atomic claim (ai-daily-summary) still stops any real double-write, just
// surfaces a spurious "Already generated" error; for admin, the claim AND
// quota check are both intentionally skipped, so a double-fire meant two
// real model calls racing the final upsert. Read at render (inFlight below)
// so a remounted instance immediately shows the correct state instead of
// only the instance that actually started the request knowing about it.
const aiSummaryInFlightDates = new Set();
function AiSummaryCard({ dragHandle, store, setStore, userId, selectedDate, readOnly = false }) {
  const [busy, setBusy] = useStateH(false);
  const [error, setError] = useStateH(null);
  // Same admin identity as Settings/Feature Map: gates the Retry button below,
  // the server independently enforces the same bypass (ai-daily-summary), this
  // is purely so a non-admin never even sees an affordance that would 409.
  const isAdmin = store.user?.email === 'office@btc-prime.biz';
  const today = LB.todayISO();
  // Always the day BEFORE whichever day the strip is on, uniformly, not the
  // strip's own day: the strip selects "which vantage point", the card is
  // always that vantage point's own "yesterday". Strip on today -> real
  // yesterday (the original one-tap flow, unchanged). Strip on yesterday ->
  // the day before that. And so on, however far back the strip goes.
  const date = LB.shiftDate(selectedDate, -1);
  const daysAgo = Math.round((new Date(today + 'T12:00:00') - new Date(date + 'T12:00:00')) / 86400000);
  const label = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : LB.fmtDayLabel(date, { weekday: 'short', day: 'numeric', month: 'short' });
  const log = (store.dailyLogs || []).find(l => l.date === date) || null;
  const isEmpty = LB.dailySummaryDayIsEmpty(store, date);
  const { headline, body } = LB.splitHeadlineBody(log?.aiSummary || '');
  // See aiSummaryInFlightDates above: local busy still drives the instant
  // disable/label on the tap that actually started the request, this only
  // adds the cross-remount case on top of it.
  const inFlight = busy || aiSummaryInFlightDates.has(date);

  async function generate() {
    if (aiSummaryInFlightDates.has(date)) return;
    aiSummaryInFlightDates.add(date);
    setBusy(true);
    setError(null);
    const res = await LB.generateDailySummary(LB.buildDailySummaryPayload(store, date));
    aiSummaryInFlightDates.delete(date);
    setBusy(false);
    if (!res.ok) { setError(res.error || 'Could not generate summary. Try again.'); return; }
    setStore(s => {
      const exists = (s.dailyLogs || []).some(l => l.date === date);
      return {
        ...s,
        dailyLogs: exists
          ? s.dailyLogs.map(l => l.date === date ? { ...l, aiSummary: res.summary, aiSummaryGeneratedAt: res.generatedAt } : l)
          : [...(s.dailyLogs || []), { id: LB.uid(), date, aiSummary: res.summary, aiSummaryGeneratedAt: res.generatedAt }],
      };
    });
  }

  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {dragHandle}
        <span style={{ ...HEALTH_CARD_HEADER_STYLE, flex: 1 }}>{label}'s Summary</span>
        <i className="fa-solid fa-wand-magic-sparkles" style={{ fontSize: 12, color: UI.inkFaint }} />
      </div>
      {log?.aiSummaryGeneratedAt ? (
        <div>
          {headline && <div style={{ fontSize: 15, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi, marginBottom: 6 }}>{headline}</div>}
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: '20px', whiteSpace: 'pre-wrap' }}>{body}</div>
          {isAdmin && !readOnly && daysAgo >= 1 && daysAgo <= 3 && (
            <div style={{ marginTop: 10 }}>
              <Btn kind="ghost" onClick={generate} disabled={inFlight} style={{ padding: '6px 14px', fontSize: 11 }}>
                <i className="fa-solid fa-rotate-right" style={{ marginRight: 6 }} />{inFlight ? 'Retrying…' : 'Retry'}
              </Btn>
              {error && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginTop: 8, lineHeight: '16px' }}>{error}</div>}
            </div>
          )}
        </div>
      ) : daysAgo < 0 ? (
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '18px' }}>Nothing to summarize yet.</div>
      ) : daysAgo === 0 ? (
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '18px' }}>That day isn't over yet, check back tomorrow.</div>
      ) : daysAgo > 3 ? (
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '18px' }}>Summaries are only available for the last few days.</div>
      ) : readOnly ? (
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '18px' }}>Not generated yet.</div>
      ) : isEmpty ? (
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '18px' }}>Nothing logged that day.</div>
      ) : (
        <div>
          <Btn onClick={generate} disabled={inFlight} style={{ width: '100%' }}>
            {inFlight ? 'Generating…' : `Get ${daysAgo === 1 ? 'yesterday' : label}'s AI summary`}
          </Btn>
          {error && <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginTop: 8, lineHeight: '16px' }}>{error}</div>}
        </div>
      )}
    </Card>
  );
}

// ─── This-week overview card (Mon–Sun averages + verdict) ─────────────────────

function HealthWeekCard({ stats, dragHandle, targets, tf, setTf, weightUnit }) {
  // Coach view passes the client's unit; athlete view falls back to own unit.
  const wUnit = weightUnit || UI.unit();
  const { from, to, periodDays, daysLogged, mealOfChoice: mealOfChoiceDays, trainingsDone, trainingsPlanned, trainingDaysInPeriod, cardioMinutes, cardioSessions,
    weight, steps, stepsSum, calories, protein, carbs, fat, water, adherence,
    snapTgtCal, snapTgtProt, snapTgtCarb, snapTgtFat } = stats;
  const r = v => v == null ? null : Math.round(v);
  const range = `${LB.fmtDayLabel(from, { day: 'numeric', month: 'short' })} – ${LB.fmtDayLabel(to, { day: 'numeric', month: 'short' })}`;
  // The 1W window anchors on the selected day, so it can be a past week: only
  // call it "THIS WEEK" when the window still includes today.
  const periodLabel = tf === '1W' ? (to >= LB.todayISO() ? 'THIS WEEK' : 'WEEK') : tf === '1M' ? 'LAST 30 DAYS' : 'LAST 3 MONTHS';
  const verdict = adherence == null ? null : Math.round(adherence) >= 97 ? 'PERFECT' : Math.round(adherence) >= 90 ? 'STRONG' : Math.round(adherence) >= 75 ? 'ON TRACK' : 'OFF TRACK';
  const isPerfect = adherence != null && Math.round(adherence) >= 97;
  const trainingPct = trainingsPlanned > 0 ? Math.min(100, (trainingsDone / trainingsPlanned) * 100) : (trainingsDone > 0 ? 100 : 0);

  // 1W: plan-weighted current targets (full week incl. future days). 1M/3M: persisted targetsSnap avg.
  const totalDays = periodDays || 7;
  const tDays = trainingDaysInPeriod || 0, rDays = totalDays - tDays;
  const planTgt = (tk, rk) => targets ? Math.round(((targets[tk] || 0) * tDays + (targets[rk] || 0) * rDays) / totalDays) : null;
  const tgtCal  = tf !== '1W' ? snapTgtCal  : planTgt('caloriesTraining', 'caloriesRest');
  const tgtProt = tf !== '1W' ? snapTgtProt : planTgt('proteinTraining',  'proteinRest');
  const tgtCarb = tf !== '1W' ? snapTgtCarb : planTgt('carbsTraining',    'carbsRest');
  const tgtFat  = tf !== '1W' ? snapTgtFat  : planTgt('fatTraining',      'fatRest');

  const cell = (label, value, unit) => (
    <div style={{ minWidth: 0, textAlign: 'center' }}>
      <div className="num health-cell-value" style={{ color: value != null ? UI.ink : UI.inkGhost, fontWeight: 300, whiteSpace: 'nowrap' }}>
        {value != null ? value : '—'}{value != null && unit ? <span className="health-cell-unit" style={{ color: UI.inkFaint, marginLeft: 2 }}>{unit}</span> : ''}
      </div>
      <div style={{ fontSize: 8.5, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.07em', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );

  const miniBar = (label, headEl, pct, color, sub) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
        {headEl}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{sub}</span>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: UI.bgInset, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
    </div>
  );

  const tfToggle = setTf ? (
    <div data-reorder-ignore="true" style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
      {HEALTH_TFS.map(t => (
        <button key={t.id} onClick={() => setTf(t.id)} style={{
          padding: '2px 8px', cursor: 'pointer', border: 'none',
          background: tf === t.id ? 'var(--accent)' : 'transparent',
          color: tf === t.id ? 'var(--accent-ink)' : UI.inkFaint,
          textShadow: 'none',
          fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
          WebkitTapHighlightColor: 'transparent',
        }}>{t.id}</button>
      ))}
    </div>
  ) : null;

  if (!daysLogged && !trainingsDone && !trainingsPlanned && !cardioMinutes) {
    return (
      <Card style={{ padding: 16, borderLeft: `3px solid ${UI.gold}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {dragHandle}
          <span style={{ ...HEALTH_CARD_HEADER_STYLE, flex: 1 }}>{periodLabel}</span>
          {tfToggle}  {/* toggle on right even in empty state */}
        </div>
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi }}>Nothing logged yet.</div>
      </Card>
    );
  }

  return (
    <Card accent style={{ padding: 16, borderLeft: `3px solid ${UI.gold}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {dragHandle}
        <span style={{ ...HEALTH_CARD_HEADER_STYLE, flex: 1 }}>{periodLabel}</span>
        <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{range}</span>
        {tfToggle}
      </div>

      {adherence != null && miniBar('adherence',
        <>
          <span className={isPerfect ? 'perfect-week-pulse num' : 'num'} style={{ fontSize: 30, color: adherenceColor(adherence), fontWeight: 300, lineHeight: 1 }}>{r(adherence)}%</span>
          <span className={isPerfect ? 'perfect-week-pulse' : ''} style={{ fontSize: 12, color: adherenceColor(adherence), fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.08em' }}>{verdict}</span>
        </>,
        Math.min(100, adherence), adherenceColor(adherence), 'avg adherence')}

      {(trainingsPlanned > 0 || trainingsDone > 0) && miniBar('workouts',
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="num" style={{ fontSize: 18, color: 'var(--accent)', fontWeight: 300, lineHeight: 1 }}>
            {trainingsDone}<span style={{ fontSize: 12, color: UI.inkFaint }}> / {trainingsPlanned || trainingsDone}</span>
          </span>
          <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Workouts</span>
        </span>,
        trainingPct, 'var(--accent)', 'planned vs done')}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px 8px', marginTop: 4 }}>
        {cell('Weight', weight != null ? Math.round(weight * 10) / 10 : null, wUnit)}
        {tf === '1W'
          ? cell('Steps (sum)', stepsSum != null ? r(stepsSum).toLocaleString() : null)
          : cell('Steps (avg)', steps != null ? r(steps).toLocaleString() : null)}
        {cell(cardioSessions ? `Cardio (${cardioSessions}×)` : 'Cardio', cardioMinutes ? cardioMinutes : null, 'min')}
        {cell('Water', water != null ? UI.waterSummaryValue(water, wUnit) : null, UI.waterSummaryUnit(wUnit))}
        {cell('Calories', r(calories))}
        {cell('Protein', r(protein), 'g')}
        {cell('Carbs', r(carbs), 'g')}
        {cell('Fat', r(fat), 'g')}
      </div>
      {mealOfChoiceDays > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
          <i className="fa-solid fa-utensils" style={{ fontSize: 10, color: 'var(--accent)' }} />
          <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>
            <span className="num" style={{ color: 'var(--accent)' }}>{mealOfChoiceDays}</span>
            {` meal of choice day${mealOfChoiceDays === 1 ? '' : 's'}, not scored`}
          </span>
        </div>
      )}
      {tgtCal != null && (
        <>
          <div style={{ height: 'var(--hair-width)', background: UI.hairStrong, margin: '6px 0' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0 8px' }}>
            {[{v: tgtCal, u: 'kcal'}, {v: tgtProt, u: 'g'}, {v: tgtCarb, u: 'g'}, {v: tgtFat, u: 'g'}].map(({v, u}, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <span className="num" style={{ fontSize: 10, color: UI.inkGhost }}>
                  {v != null ? v : '—'}<span style={{ fontSize: 8 }}>{u}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ─── Date strip (current week Mon–Sun) ────────────────────────────────────────

function HealthDateStrip({ store, setStore, selectedDate, onSelect, onLog, targets }) {
  const today = LB.todayISO();
  const anchor = selectedDate || today;
  const anchorDate = new Date(anchor + 'T12:00:00');
  const jsDow = anchorDate.getDay();
  const monday = LB.shiftDate(anchor, -((jsDow === 0 ? 7 : jsDow) - 1));
  const days = Array.from({ length: 7 }, (_, i) => LB.shiftDate(monday, i));
  // A day counts as "logged" (gold marker) only if it carries real content,
  // not merely by row existence, see hlHasLogContent above (a flex day-type-
  // only override log, just targetsSnap.dayType, must not light up either).
  const hasLogContent = hlHasLogContent;
  const loggedSet = new Set((store.dailyLogs || []).filter(hasLogContent).map(l => l.date));
  // Navigation itself is unbounded forward (a flex plan's Training|Rest
  // override needs to reach future dates, same reasoning as the food
  // logger), but manually logging weight/steps/water/notes for a day that
  // hasn't happened doesn't make sense, so the LOG button stays gated.
  const selectedIsFuture = selectedDate > today;

  // Flex Training|Rest override for the selected day (header slider). Only in the
  // user's own tab (setStore present, not the read-only coach view), only for a
  // flex plan, and hidden when the day is under a status mode or already has a
  // logged session (training is then settled).
  const flexActive = LB.isFlexPlan((store.schedules || []).find(s => s.id === store.activeScheduleId));
  const selDayStatus = flexActive ? (selectedDate === today
    ? (store.statusMode ?? null)
    : ((store.statusPeriods || []).find(p => {
        const ts = new Date(selectedDate + 'T12:00:00').getTime();
        const start = new Date(p.startedAt).getTime();
        const end = p.endedAt ? new Date(p.endedAt).getTime() : Date.now();
        return ts >= start && ts <= end;
      })?.mode || null)) : null;
  const showDayType = !!setStore && flexActive && !selDayStatus && !LB.isLoggedTrainingDay(store.sessions, selectedDate);
  const selDayType = LB.isTrainingDayForDate(store, selectedDate) ? 'training' : 'rest';
  const setFlexDayType = (type) => {
    const existing = (store.dailyLogs || []).find(l => l.date === selectedDate);
    // Rest is the flex default: a content-less override log is just dropped.
    if (type === 'rest' && (!existing || !hasLogContent(existing))) {
      if (existing) setStore(s => ({ ...s, dailyLogs: (s.dailyLogs || []).filter(l => l.date !== selectedDate) }));
      return;
    }
    const isTraining = type === 'training';
    const dayTarget = LB.dayTargetFromMacros(targets, isTraining);
    const hasMacros = existing && existing.protein != null && existing.carbs != null && existing.fat != null;
    // Was calling macroAdherence directly and so honoured no gate at all:
    // flipping the day type wrote a fresh score onto a day that is meant to
    // carry none. Route it through dailyLogAdherence, which owns the
    // meal-of-choice rule, and ask for status separately (status is not on
    // the row, so it stays a caller concern). targetsSnap is still built
    // below on purpose: unlike dailyLogAdherence this site persists a
    // snapshot even for a day with no macros yet, because the dayType has
    // to survive regardless. That asymmetry is this call site's whole job.
    const unscored = !!LB.statusModeForDate(store, selectedDate);
    const adherence = (dayTarget && hasMacros && !unscored)
      ? LB.dailyLogAdherence(existing, targets, isTraining).adherence : null;
    const targetsSnap = dayTarget ? { ...dayTarget, dayType: type } : { dayType: type };
    const now = new Date().toISOString();
    const log = existing
      ? { ...existing, adherence, targetsSnap, updatedAt: now }
      : { id: LB.uid(), date: selectedDate, weight: null, steps: null, calories: null, protein: null, carbs: null, fat: null, fiber: null, waterMl: null, note: null, offPlanNote: null, coachFields: null, adherence, targetsSnap, updatedAt: now, createdAt: now };
    setStore(s => ({ ...s, dailyLogs: [log, ...(s.dailyLogs || []).filter(l => l.date !== selectedDate)] }));
  };
  const sunday = days[6];
  // Month label for the week, spans two months at a boundary (e.g. "MAY – JUN").
  const mLabel = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const monthLabel = mLabel(monday) === mLabel(sunday)
    ? `${mLabel(monday)} ${new Date(sunday + 'T12:00:00').getFullYear()}`
    : `${mLabel(monday)} – ${mLabel(sunday)}`;

  return (
    <div style={{ flexShrink: 0, padding: '4px 16px 12px' }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6, paddingLeft: 2 }}>{monthLabel}</div>
      {/* Day cells, same card style as the home screen day strip */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {days.map((d, i) => {
          const sel = d === selectedDate;
          const has = loggedSet.has(d);
          const trained = LB.isTrainingDayForDate(store, d);
          const isToday = d === today;
          return (
            <div key={d} onClick={() => onSelect(d)}
              style={{
                flex: 1, padding: '10px 4px 8px', textAlign: 'center',
                background: sel ? UI.goldFaint : has ? UI.goldFaint : 'transparent',
                border: `${sel ? '2px' : 'var(--hair-width)'} solid ${sel ? UI.gold : has ? UI.goldSoft : isToday ? UI.hairStrong : UI.hair}`,
                borderRadius: 4, cursor: 'pointer',
                minHeight: 56,
                WebkitTapHighlightColor: 'transparent',
              }}>
              <div className="num" style={{ fontSize: 9, color: sel ? UI.gold : isToday ? UI.inkSoft : UI.inkFaint, textShadow: 'var(--text-lift)' }}>
                {WEEKDAYS[i]}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, letterSpacing: '0.06em',
                color: sel ? UI.gold : has ? UI.ink : UI.inkFaint, textShadow: 'var(--text-lift)' }}>
                {new Date(d + 'T12:00:00').getDate()}
              </div>
              {/* Day-type indicator, ALWAYS shown: dumbbell = training, dot = rest.
                 Logged status is conveyed by the gold cell bg/border + the small
                 check below. */}
              <div style={{ height: 13, marginTop: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                {trained ? (
                  <i className="fa-solid fa-dumbbell" style={{ fontSize: 9, color: 'var(--accent)' }} />
                ) : (
                  <span style={{ width: 5, height: 5, borderRadius: '50%', border: `1px solid ${sel || has ? UI.goldSoft : UI.hairStrong}`, background: 'transparent', display: 'inline-block' }} />
                )}
                {has && (
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="2" filter="url(#chart-text-lift)">
                    <path d="M2 6l2.5 2.5L10 3"/>
                  </svg>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* Calendar picker + LOG button, calendar is an overlaid <input> for iOS compat */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ position: 'relative', width: 34, height: 34, flexShrink: 0 }}>
          <button style={{
            width: '100%', height: '100%', borderRadius: 4, border: `1px solid ${UI.hairStrong}`,
            background: 'transparent', color: UI.inkSoft, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}>
            <i className="fa-solid fa-calendar-day" style={{ fontSize: 14 }} />
          </button>
          <input type="date" value={selectedDate}
            onChange={e => e.target.value && onSelect(e.target.value)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
          />
        </div>
        <div style={{ flex: 1 }} />
        {showDayType && (
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, height: 34, flexShrink: 0 }}>
            {[{ type: 'training', icon: 'fa-dumbbell', label: 'Training day' }, { type: 'rest', icon: 'fa-bed', label: 'Rest day' }].map(({ type, icon, label }, i) => {
              const active = selDayType === type;
              return (
                <button key={type} onClick={() => setFlexDayType(type)} title={label} style={{
                  padding: '0 14px', border: 'none', borderLeft: i > 0 ? `1px solid ${UI.hairStrong}` : 'none',
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? 'var(--accent-ink)' : UI.inkFaint, cursor: 'pointer',
                  textShadow: active ? 'none' : 'var(--text-lift)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  WebkitTapHighlightColor: 'transparent', transition: 'background 0.15s',
                }}>
                  <i className={`fa-solid ${icon}`} style={{ fontSize: 13 }} />
                </button>
              );
            })}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {onLog && !selectedIsFuture && <button data-tour="health-log-btn" onClick={onLog} style={{
          height: 34, borderRadius: 4, border: 'none',
          background: 'linear-gradient(180deg, var(--accent-light), var(--accent))',
          color: 'var(--accent-ink)', cursor: 'pointer', padding: '0 14px',
          textShadow: 'none',
          fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
          WebkitTapHighlightColor: 'transparent',
        }}>
          <i className="fa-solid fa-plus" style={{ fontSize: 11 }} /> LOG
        </button>}
      </div>
    </div>
  );
}

// ─── Glucose card ─────────────────────────────────────────────────────────────

function GlucoseCard({ glucoseLogs, unit, tf: sharedTf, setTf: setSharedTf, dragHandle, onExpand, compact = false }) {
  const today = LB.todayISO();
  // 1D is a local-only overlay on top of the shared tf every card (including
  // this one for 1W/1M/3M) participates in: picking 1D here never touches
  // the shared value, so the other cards stay put; picking 1W/1M/3M here
  // both clears the overlay and drives the shared value, same as any other
  // card's tf buttons always have.
  const [showToday, setShowToday] = useStateH(false);
  const tf = showToday ? '1D' : sharedTf;
  const setTf = id => {
    if (id === '1D') { setShowToday(true); return; }
    setShowToday(false);
    setSharedTf(id);
  };
  const tfDays = id => (HEALTH_TFS_TODAY.find(t => t.id === id) || HEALTH_TFS_TODAY[0]).days;
  const { start, end } = healthWindow(tfDays(tf));
  const unitLabel = glucoseUnitLabel(unit);
  const refLow  = unit === 'mgdl' ? Math.round(GLUCOSE_REF_LOW  * GLUCOSE_FACTOR) : GLUCOSE_REF_LOW;
  const refHigh = unit === 'mgdl' ? Math.round(GLUCOSE_REF_HIGH * GLUCOSE_FACTOR) : GLUCOSE_REF_HIGH;
  const dec = unit === 'mgdl' ? 0 : 1;

  const inWindow = useMemoH(
    () => (glucoseLogs || []).filter(l => l.date >= start && l.date <= end),
    [glucoseLogs, tf, today]
  );

  // Latest reading as headline
  const latest = inWindow.length
    ? inWindow.reduce((a, b) => (a.date > b.date || (a.date === b.date && a.time > b.time)) ? a : b)
    : null;
  const latestDisp = latest ? glucoseDisplay(latest.valueMmol, unit) : null;

  // Notes feed: readings with a note, newest first, max 20
  const sortedReadings = useMemoH(() =>
    [...inWindow].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).slice(0, 30),
    [inWindow]
  );
  const CTX_COLORS = { fasted: 'var(--accent)', fed: isLightCanvasActive() ? '#0369a1' : '#4a9fe0', other: UI.inkSoft };

  return (
    <HealthChartCard title="Glucose" icon="fa-droplet" tf={tf} setTf={setTf} tfOptions={HEALTH_TFS_TODAY}
      headline={latestDisp != null ? String(latestDisp) : null} sub={latestDisp != null ? unitLabel : null} dragHandle={dragHandle} onExpand={onExpand}>
      {!inWindow.length ? (
        <HealthChartEmpty label={tf === '1D' ? 'No glucose readings logged today yet' : 'No glucose readings in this range'} />
      ) : (
        <>
          <GlucoseScatterChart readings={inWindow} from={start} to={end} unit={unit} todayMode={tf === '1D'} />
          {/* Reference legend + readings feed only in the full (expanded) view,
              compact (2-col grid) shows just the chart, so this card's height
              matches its plain-chart neighbours instead of towering over them. */}
          {!compact && (
          <>
          {/* Wraps on the narrow 2-col card width instead of clipping: the 3
              context dots are separate flex items with no text of their own
              to fall back on for reflow. */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, rowGap: 4, marginTop: 4 }}>
            <div style={{ height: 8, width: 28, background: `rgba(var(--accent-rgb),${isLightCanvasActive() ? 0.3 : 0.15})`, borderRadius: 4, flexShrink: 0 }} />
            <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkFaint }}>
              Normal fasting {refLow.toFixed(dec)}–{refHigh.toFixed(dec)} {unitLabel}
            </span>
            <span style={{ flex: 1 }} />
            {['fasted', 'fed', 'other'].map(c => (
              <span key={c} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: CTX_COLORS[c], display: 'inline-block' }} />
                <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkFaint }}>{GLUCOSE_CTX_LABELS[c]}</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 2 }}>
            <div style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              <div style={{ width: '100%', borderTop: '1.5px dashed #4a9fe0', opacity: 0.5 }} />
            </div>
            <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkFaint }}>
              Normal postprandial &lt;{(unit === 'mgdl' ? Math.round(GLUCOSE_REF_FED * GLUCOSE_FACTOR) : GLUCOSE_REF_FED).toFixed(dec)} {unitLabel} (2h after meal)
            </span>
          </div>
          {sortedReadings.length > 0 && (
            <>
              <div style={{ height: 'var(--hair-width)', background: UI.hair, margin: '8px 0' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sortedReadings.map(n => (
                  <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: CTX_COLORS[n.context] || UI.inkSoft, display: 'inline-block', flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.ink }}>{LB.fmtDayLabel(n.date, { day: 'numeric', month: 'short' })} · {n.time}</div>
                      {n.note && <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: '16px', marginTop: 1 }}>{n.note}</div>}
                    </div>
                    <span className="num" style={{ flexShrink: 0, fontSize: 11, color: UI.inkFaint }}>{glucoseDisplay(n.valueMmol, unit)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          </>
          )}
        </>
      )}
    </HealthChartCard>
  );
}

// ─── Blood pressure card ────────────────────────────────────────────────────

function BloodPressureCard({ bpLogs, tf: sharedTf, setTf: setSharedTf, dragHandle, onExpand, compact = false }) {
  const today = LB.todayISO();
  // 1D is a local-only overlay on top of the shared tf every card (including
  // this one for 1W/1M/3M) participates in: picking 1D here never touches
  // the shared value, so the other cards stay put; picking 1W/1M/3M here
  // both clears the overlay and drives the shared value, same as any other
  // card's tf buttons always have.
  const [showToday, setShowToday] = useStateH(false);
  const tf = showToday ? '1D' : sharedTf;
  const setTf = id => {
    if (id === '1D') { setShowToday(true); return; }
    setShowToday(false);
    setSharedTf(id);
  };
  const tfDays = id => (HEALTH_TFS_TODAY.find(t => t.id === id) || HEALTH_TFS_TODAY[0]).days;
  const { start, end } = healthWindow(tfDays(tf));

  const inWindow = useMemoH(
    () => (bpLogs || []).filter(l => l.date >= start && l.date <= end),
    [bpLogs, tf, today]
  );

  const latest = inWindow.length
    ? inWindow.reduce((a, b) => (a.date > b.date || (a.date === b.date && a.time > b.time)) ? a : b)
    : null;

  const sortedReadings = useMemoH(() =>
    [...inWindow].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).slice(0, 30),
    [inWindow]
  );

  return (
    <HealthChartCard title="BP" icon="fa-heart-pulse" tf={tf} setTf={setTf} tfOptions={HEALTH_TFS_TODAY}
      headline={latest ? `${latest.systolic}/${latest.diastolic}` : null} sub={latest ? 'mmHg' : null} dragHandle={dragHandle} onExpand={onExpand}>
      {!inWindow.length ? (
        <HealthChartEmpty label={tf === '1D' ? 'No blood pressure readings logged today yet' : 'No blood pressure readings in this range'} />
      ) : (
        <>
          <BpScatterChart readings={inWindow} from={start} to={end} todayMode={tf === '1D'} />
          {/* Legend + readings feed only in the full (expanded) view, compact
              (2-col grid) shows just the chart, matching plain-chart neighbours. */}
          {!compact && (
          <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
              <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkFaint }}>Systolic</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4a9fe0', display: 'inline-block' }} />
              <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkFaint }}>Diastolic</span>
            </span>
            <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.ink }}>· dashed = 120/80 normal</span>
          </div>
          {sortedReadings.length > 0 && (
            <>
              <div style={{ height: 'var(--hair-width)', background: UI.hair, margin: '8px 0' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sortedReadings.map(n => (
                  <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.ink }}>{LB.fmtDayLabel(n.date, { day: 'numeric', month: 'short' })} · {n.time}</div>
                      {n.note && <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: '16px', marginTop: 1 }}>{n.note}</div>}
                    </div>
                    <span className="num" style={{ flexShrink: 0, fontSize: 11, color: UI.inkFaint }}>{n.systolic}/{n.diastolic}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          </>
          )}
        </>
      )}
    </HealthChartCard>
  );
}

// ─── Body temperature card ──────────────────────────────────────────────────

function BodyTempCard({ tempLogs, unit, tf: sharedTf, setTf: setSharedTf, dragHandle, onExpand, compact = false }) {
  const today = LB.todayISO();
  // 1D is a local-only overlay on top of the shared tf every card (including
  // this one for 1W/1M/3M) participates in: picking 1D here never touches
  // the shared value, so the other cards stay put; picking 1W/1M/3M here
  // both clears the overlay and drives the shared value, same as any other
  // card's tf buttons always have.
  const [showToday, setShowToday] = useStateH(false);
  const tf = showToday ? '1D' : sharedTf;
  const setTf = id => {
    if (id === '1D') { setShowToday(true); return; }
    setShowToday(false);
    setSharedTf(id);
  };
  const tfDays = id => (HEALTH_TFS_TODAY.find(t => t.id === id) || HEALTH_TFS_TODAY[0]).days;
  const { start, end } = healthWindow(tfDays(tf));
  const unitLabel = tempUnitLabel(unit);

  const inWindow = useMemoH(
    () => (tempLogs || []).filter(l => l.date >= start && l.date <= end),
    [tempLogs, tf, today]
  );

  const latest = inWindow.length
    ? inWindow.reduce((a, b) => (a.date > b.date || (a.date === b.date && a.time > b.time)) ? a : b)
    : null;
  const latestDisp = latest ? tempDisplay(latest.valueC, unit) : null;

  const sortedReadings = useMemoH(() =>
    [...inWindow].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).slice(0, 30),
    [inWindow]
  );

  return (
    <HealthChartCard title="Body Temp" icon="fa-temperature-half" tf={tf} setTf={setTf} tfOptions={HEALTH_TFS_TODAY}
      headline={latestDisp != null ? String(latestDisp) : null} sub={latestDisp != null ? unitLabel : null} dragHandle={dragHandle} onExpand={onExpand}>
      {!inWindow.length ? (
        <HealthChartEmpty label={tf === '1D' ? 'No temperature readings logged today yet' : 'No temperature readings in this range'} />
      ) : (
        <>
          <TempScatterChart readings={inWindow} from={start} to={end} unit={unit} todayMode={tf === '1D'} />
          {/* Readings feed only in the full (expanded) view, compact (2-col
              grid) shows just the chart, matching plain-chart neighbours. */}
          {!compact && sortedReadings.length > 0 && (
            <>
              <div style={{ height: 'var(--hair-width)', background: UI.hair, margin: '8px 0' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sortedReadings.map(n => (
                  <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.ink }}>{LB.fmtDayLabel(n.date, { day: 'numeric', month: 'short' })} · {n.time}</div>
                      {n.note && <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: '16px', marginTop: 1 }}>{n.note}</div>}
                    </div>
                    <span className="num" style={{ flexShrink: 0, fontSize: 11, color: UI.inkFaint }}>{tempDisplay(n.valueC, unit)}{unitLabel}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </HealthChartCard>
  );
}

// ─── Water card ─────────────────────────────────────────────────────────────
// Only the 1D (today) view needs per-entry detail (multiple drinks a day is
// the whole point of the tracker); 1W/1M/3M stay the existing daily-total bar
// chart fed by dailyLogs.waterMl, unchanged.

function WaterEntryChart({ entries }) {
  // Bucketed by hour, not one bar per raw entry: a few drinks logged close
  // together would otherwise draw overlapping or near-touching bars, which
  // reads as noise rather than a timeline. One bar per hour, height = that
  // hour's total; the feed list right below still shows every entry.
  const byHour = new Map();
  (entries || []).forEach(e => {
    const h = Math.floor((timeToMinutes(e.time) ?? 0) / 60);
    const cur = byHour.get(h) || { h, amountMl: 0, count: 0, date: e.date };
    cur.amountMl += e.amountMl || 0;
    cur.count += 1;
    byHour.set(h, cur);
  });
  const pts = [...byHour.values()].sort((a, b) => a.h - b.h);
  if (!pts.length) return null;
  const W = 320, padL = 38, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;
  const dom = UI.chartDomain(0, Math.max(...pts.map(p => p.amountMl)), { min: 0 });
  const bw = 10;
  const xOf = p => padL + ((p.h + 0.5) / 24) * plotW;
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  const gridVals = Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const hoverPoints = pts.map(p => {
    const hourLabel = `${String(p.h).padStart(2, '0')}:00`;
    return {
      x: xOf(p), y: yOf(p.amountMl), date: p.date,
      rows: [{ value: `${UI.waterToEntry(p.amountMl)} ${UI.waterEntryUnit()}` }],
      sub: p.count > 1 ? `${hourLabel} · ${p.count} drinks` : hourLabel,
    };
  });

  return (
    <ChartHover W={W} H={H} points={hoverPoints} markerColor="#4a9fe0">
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text filter="url(#chart-text-lift)" x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{UI.waterToEntry(v)}</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {pts.map((p, i) => {
        const y = yOf(p.amountMl);
        const h = (padTop + plotH) - y;
        return <rect key={i} x={(xOf(p) - bw / 2).toFixed(1)} y={y.toFixed(1)} width={bw} height={Math.max(0, h).toFixed(1)} rx="1" fill="#4a9fe0" />;
      })}
    </svg>
    </ChartHover>
  );
}

function WaterCard({ waterSeries, waterAvg, waterLogs, tf: sharedTf, setTf: setSharedTf, dragHandle, onExpand, onOpen, compact = false }) {
  const today = LB.todayISO();
  // 1D is a local-only overlay on top of the shared tf every card (including
  // this one for 1W/1M/3M) participates in, same pattern as Glucose/BP/Temp.
  const [showToday, setShowToday] = useStateH(false);
  const tf = showToday ? '1D' : sharedTf;
  const setTf = id => {
    if (id === '1D') { setShowToday(true); return; }
    setShowToday(false);
    setSharedTf(id);
  };

  const todayEntries = useMemoH(
    () => (waterLogs || []).filter(l => l.date === today).sort((a, b) => b.time.localeCompare(a.time)),
    [waterLogs, today]
  );
  const todayTotal = todayEntries.reduce((s, l) => s + (l.amountMl || 0), 0);

  const headline = tf === '1D'
    ? (todayEntries.length ? `${UI.waterSummaryValue(todayTotal)}${UI.waterSummaryUnit()}` : null)
    : (waterAvg != null ? `${UI.waterSummaryValue(waterAvg)}${UI.waterSummaryUnit()}` : null);
  const sub = tf === '1D' ? (todayEntries.length ? 'today' : null) : (waterAvg != null ? 'avg / day' : null);

  return (
    <HealthChartCard title="Water" icon="fa-glass-water" tf={tf} setTf={setTf} tfOptions={HEALTH_TFS_TODAY}
      headline={headline} sub={sub} dragHandle={dragHandle} onExpand={onExpand} onOpen={onOpen}>
      {tf === '1D' ? (
        !todayEntries.length ? (
          <HealthChartEmpty label="No water logged today yet" />
        ) : (
          <>
            <WaterEntryChart entries={todayEntries} />
            {/* Readings feed only in the full (expanded) view, compact (2-col
                grid) shows just the chart, matching Glucose/BP/Temp. */}
            {!compact && (
              <>
                <div style={{ height: 'var(--hair-width)', background: UI.hair, margin: '8px 0' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {todayEntries.map(n => (
                    <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkFaint }}>{n.time}</div>
                        {n.name && <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: '16px', marginTop: 1 }}>{n.name}</div>}
                      </div>
                      <span className="num" style={{ flexShrink: 0, fontSize: 11, color: UI.inkFaint }}>{UI.waterToEntry(n.amountMl)} {UI.waterEntryUnit()}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )
      ) : (
        <HealthBarChart series={waterSeries.data} from={waterSeries.from} to={waterSeries.to} format={v => `${UI.waterSummaryValue(v)}${UI.waterSummaryUnit()}`} color={isLightCanvasActive() ? '#0369a1' : '#4a9fe0'} colorSoft={isLightCanvasActive() ? 'rgba(3,105,161,0.35)' : 'rgba(74,159,224,0.35)'} />
      )}
    </HealthChartCard>
  );
}

// ─── HealthScreen ─────────────────────────────────────────────────────────────

function HealthScreen({ store, setStore, go, userId, openMacroTargets }) {
  const today = LB.todayISO();
  const [selectedDate, setSelectedDate] = useStateH(today);
  const [logOpen, setLogOpen] = useStateH(false);
  const [targetOpen, setTargetOpen] = useStateH(false);
  const [checkinOpen, setCheckinOpen] = useStateH(false);
  // Reached directly from MacroSourceCard's "Adjust automation settings",
  // skipping the manual-numbers MacroTargetSheet layer: apply() below commits
  // straight to macroTargets the same way that sheet's own Save does, so this
  // is a complete one-step edit, not a prefill waiting on a second screen.
  const [automationSettingsOpen, setAutomationSettingsOpen] = useStateH(false);
  // The Food tab sends users here when their day has no macro target to score
  // against (go({ name: 'health', openMacroTargets: true })): opening the sheet
  // straight away is the whole point of that trip, arriving on the Health tab
  // with nothing open would just make them hunt for the card.
  useEffectH(() => { if (openMacroTargets) setTargetOpen(true); }, [openMacroTargets]);
  const [coachingMacros, setCoachingMacros] = useStateH(null);
  // Whether the async coach-macros load has settled. Lets the targets cache
  // tell a transient load-null (protect the cache) from a genuine no/removed-
  // targets null (clear the cache). True immediately when there's no coach.
  const [coachingMacrosLoaded, setCoachingMacrosLoaded] = useStateH(false);
  const [tf, setTf] = useStateH('1W');
  const [capturing, setCapturing] = useStateH(false);
  const [exportOpen, setExportOpen] = useStateH(false);
  // Which card is blown up in the expand sheet (id into expandableCards below),
  // null when closed. Only charts squeezed by the 2-col grid offer this.
  const [expandedCardId, setExpandedCardId] = useStateH(null);
  const captureRef = useRefH(null);

  const takeScreenshot = async () => {
    if (!captureRef.current) return;
    const html2canvas = await window.__ensureHtml2Canvas?.().catch(() => null);
    if (!html2canvas) return;
    setCapturing(true);
    const scrollParent = captureRef.current.parentElement;
    const saved = { overflow: scrollParent.style.overflow, height: scrollParent.style.height, minHeight: scrollParent.style.minHeight };
    scrollParent.style.overflow = 'visible';
    scrollParent.style.height = 'auto';
    scrollParent.style.minHeight = 'auto';
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const el = captureRef.current;
      const canvas = await html2canvas(el, {
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#1a1820',
        scale: 2, useCORS: true, logging: false,
        height: el.scrollHeight, windowHeight: el.scrollHeight,
      });
      canvas.toBlob(async (blob) => {
        const filename = `health-${selectedDate}.png`;
        const file = new File([blob], filename, { type: 'image/png' });
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file] }); } catch (_) {}
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename; document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }, 'image/png');
    } finally {
      scrollParent.style.overflow = saved.overflow;
      scrollParent.style.height = saved.height;
      scrollParent.style.minHeight = saved.minHeight;
      setCapturing(false);
    }
  };

  // Load coach-assigned macros (used to prefill targets + power adherence when
  // the user hasn't set personal targets). asClient or self-coaching row.
  const coachingId = store.coaching?.asClient?.id || store.coaching?.asSelf?.id || null;

  // Edits a period that is already closed, i.e. history. Never touches
  // statusMode/statusModeSince (those describe TODAY) and never touches the
  // open period. mode null on the first day of the period deletes it, on a
  // later day it shortens it to end the day before; a different mode rewrites
  // the period's mode.
  const editHistoricStatusPeriod = async (period, mode, dayStr) => {
    const prevPeriods = store.statusPeriods;
    const firstDay = (period.startedAt || '').slice(0, 10);
    const removes = mode === null && dayStr <= firstDay;
    const newEndedAt = (() => {
      const d = new Date(dayStr + 'T12:00:00'); d.setDate(d.getDate() - 1); return d.toISOString();
    })();
    setStore(s => ({
      ...s,
      statusPeriods: removes
        ? (s.statusPeriods || []).filter(p => p.id !== period.id)
        : (s.statusPeriods || []).map(p => p.id !== period.id ? p : (mode === null ? { ...p, endedAt: newEndedAt } : { ...p, mode })),
    }));
    try {
      if (removes) await LB.deleteStatusPeriodById(userId, period.id);
      else if (mode === null) await LB.closeStatusPeriodById(userId, period.id, newEndedAt);
      else await LB.updateStatusPeriodMode(userId, period.id, mode);
    } catch (e) {
      console.error('historic status period write failed', e);
      setStore(s => ({ ...s, statusPeriods: prevPeriods }));
      UI.alert('Could not update that day. Please try again.');
    }
  };

  const handleSetStatus = async (mode, startDateStr = null) => {
    const current = store.statusMode ?? null;
    const startedAt = startDateStr
      ? new Date(startDateStr + 'T12:00:00').toISOString()
      : new Date().toISOString();
    // Editing a PAST day is a different operation from changing today's
    // status. Every write below addresses "the period that is currently open",
    // so tapping Normal on a day that belongs to an already closed period used
    // to delete or shorten the RUNNING Sick/Vacation period instead, silently
    // and without an undo. Route a past day to the period that actually covers
    // it, addressed by id, and leave statusMode alone unless that period is
    // the open one.
    const todayStr = LB.todayISO();
    if (startDateStr && startDateStr < todayStr) {
      const covering = (store.statusPeriods || []).find(p => {
        const from = (p.startedAt || '').slice(0, 10);
        const to = p.endedAt ? p.endedAt.slice(0, 10) : null;
        return from <= startDateStr && (!to || startDateStr <= to);
      });
      const isOpen = !!covering && !covering.endedAt;
      // Inside the open period the existing "since / normal from" semantics are
      // exactly right, so only the historical case needs the new path.
      if (covering && !isOpen) {
        await editHistoricStatusPeriod(covering, mode, startDateStr);
        return;
      }
      if (!covering && mode && (store.statusPeriods || []).some(p => !p.endedAt)) {
        UI.alert('You already have an open status period. End that one first, then mark this day.');
        return;
      }
    }
    // "Normal from day X" = the period ended the day BEFORE X (X is the first normal day).
    // Applies whether X is a past day or today.
    const closedAt = mode === null
      ? (() => { const d = new Date((startDateStr || LB.todayISO()) + 'T12:00:00'); d.setDate(d.getDate() - 1); return d.toISOString(); })()
      : startedAt;
    // If closedAt < the open period's startedAt (e.g. activated and closed the same day),
    // delete the period entirely instead of creating an invalid start > end record.
    const openPeriod = mode === null ? (store.statusPeriods || []).find(p => !p.endedAt) : null;
    const shouldDelete = !!openPeriod && closedAt < openPeriod.startedAt;
    const modeChanged = mode !== current;
    if (!modeChanged && !startDateStr) return;
    const since = mode ? startedAt : null;
    // Snapshot for rollback: setStore below applies optimistically before the
    // write, so a failed write must restore the prior status (a swallowed error
    // otherwise leaves the UI showing a status change that never persisted).
    const prevStatus = { statusMode: store.statusMode, statusModeSince: store.statusModeSince, statusPeriods: store.statusPeriods };
    setStore(s => {
      const updatedPeriods = mode
        ? modeChanged
          ? [{ id: '_pending', mode, startedAt, endedAt: null }, ...(s.statusPeriods || []).map(p => p.endedAt ? p : { ...p, endedAt: new Date().toISOString() })]
          : (s.statusPeriods || []).map(p => !p.endedAt ? { ...p, startedAt } : p)
        : shouldDelete
          ? (s.statusPeriods || []).filter(p => !!p.endedAt)
          : (s.statusPeriods || []).map(p => !p.endedAt ? { ...p, endedAt: closedAt } : p);
      return { ...s, statusMode: mode, statusModeSince: since, statusPeriods: updatedPeriods };
    });
    try {
      if (modeChanged) {
        if (mode) await LB.openStatusPeriod(userId, mode, startedAt);
        else if (shouldDelete) { const r = await LB.supabase.from('zane_status_periods').delete().eq('user_id', userId).is('ended_at', null); if (r.error) throw r.error; }
        else      await LB.closeStatusPeriod(userId, closedAt);
      } else {
        await LB.updateStatusPeriodStart(userId, startedAt);
      }
    } catch (e) {
      console.error('status period write failed', e);
      setStore(s => ({ ...s, ...prevStatus }));
      UI.alert('Could not update your status. Please try again.');
      return;
    }
    if (coachingId && modeChanged) {
      try {
        const body = mode === 'sick'     ? 'Status: Sick, taking a break from training.'
                   : mode === 'vacation' ? 'Status: Vacation, back soon!'
                   : `Status: Back to normal (was ${current === 'sick' ? 'sick' : 'on vacation'}).`;
        const threadId = await LB.getOrCreateCoachingThread(coachingId, 'Status Updates', userId);
        await LB.addCoachingNote(coachingId, 'general', null, null, body, userId, threadId);
      } catch (_) {}
    }
  };

  useEffectH(() => {
    if (!coachingId) { setCoachingMacros(null); setCoachingMacrosLoaded(true); return; }
    let cancelled = false;
    setCoachingMacrosLoaded(false);
    LB.loadCoachingMacros(coachingId)
      .then(data => { if (!cancelled) { setCoachingMacros(data[0] || null); setCoachingMacrosLoaded(true); } })
      // Left at false on failure, not flipped to true: the reconcilers below
      // gate on this specifically to avoid scoring against the personal
      // target while the real coaching target is still unknown. Marking a
      // failed fetch "loaded" released them anyway, reintroducing that same
      // race on every offline/network-error load; leaving it pending just
      // means today's reconciliation waits for the next successful fetch
      // (this effect reruns on every mount) instead of freezing a wrong
      // score into a day's targets_snap.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [coachingId]);

  // Load the check-in schema for the active coaching relationship (real coach
  // or self-coaching) so DailyLogScreen can show coach-configured daily fields.
  const [activeCoachingSchema, setActiveCoachingSchema] = useStateH(null);
  const activeClientCoachingId =
    (store.coaching?.asClient?.status === 'active' ? store.coaching?.asClient?.id : null)
    || store.coaching?.asSelf?.id || null;
  useEffectH(() => {
    if (!activeClientCoachingId) { setActiveCoachingSchema(null); return; }
    let cancelled = false;
    LB.loadCheckinSchema(activeClientCoachingId).then(schema => {
      if (!cancelled) setActiveCoachingSchema(schema || store.settings?.defaultCheckinSchema || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeClientCoachingId]);

  const targets = LB.effectiveMacroTargets(store.settings?.macroTargets, coachingMacros);
  // Coach macros always win when present (see effectiveMacroTargets), so the
  // shown targets are the coach's exactly when coach macros exist.
  const coachHasMacros = LB.hasMacroTargets(coachingMacros);
  const fromCoach = coachHasMacros;
  // The macros load from asClient (a real external coach) if there is one, else
  // from asSelf (self-coaching). Softening the label/disclaimer for the self case
  // avoids telling a solo user their own macros come "FROM COACH".
  const selfCoachedMacros = fromCoach && !store.coaching?.asClient?.id;
  const dailyLogs = store.dailyLogs || [];
  const selectedLog = dailyLogs.find(l => l.date === selectedDate) || null;

  // Cache targets in localStorage so the adherence bar and macro target row
  // are at their final height on the very first render (no jump when settings load).
  // Key is scoped per user so switching accounts never bleeds a stale cache.
  const targetsCacheKey = 'logbook-health-targets-' + userId;
  const [cachedTargets, setCachedTargets] = useStateH(() => {
    try { return JSON.parse(localStorage.getItem(targetsCacheKey) || 'null'); } catch { return null; }
  });
  // targets is null until coachingMacros loads (async). Use cached value from the
  // previous visit so adherence bar + target rows are visible on the first render.
  const effectiveTargets = targets ?? cachedTargets;
  useEffectH(() => {
    // Only protect the cache from a null while coach macros are still loading
    // (a real target may be about to arrive). Once the load has settled (or
    // there's no coach), a null is genuine, no or just-removed targets, and MUST
    // clear the cache, otherwise removed targets keep displaying and scoring
    // adherence forever (the guard used to key off cachedTargets !== null, which
    // could never tell a transient load-null from a real cleared-null).
    const macrosSettled = !coachingId || coachingMacrosLoaded;
    if (targets === null && cachedTargets !== null && !macrosSettled) return;
    try { localStorage.setItem(targetsCacheKey, JSON.stringify(targets)); } catch {}
    if (targets !== cachedTargets) setCachedTargets(targets);
  }, [targets, coachingMacrosLoaded]);

  // The Food Tracker's rollup (screens-food.jsx) writes calories/protein/
  // carbs/fat straight into a day's log but doesn't know about targets or
  // adherence, the same division of labor DailyLogScreen.save() already has
  // for the manual form. Reconciles adherence/targetsSnap for any date
  // store.foodLogs touched, the exact same computation save() does
  // (including the flex day-type override guard), whenever a food entry
  // changes.
  const foodTouchedDates = useMemoH(() => {
    const set = new Set();
    (store.foodLogs || []).forEach(l => set.add(l.date));
    return set;
  }, [store.foodLogs]);
  useEffectH(() => {
    // Root cause of a real bug: coachingId is known the moment store.coaching
    // loads at boot, but coachingMacros itself is a separate fetch this
    // screen fires afterward (coachingId's own useEffectH above) and takes a
    // moment to resolve. Running this reconciler in that window computed
    // effectiveTargets with coachingMacros still null, i.e. exactly like no
    // coach/self-coaching macros existed, so the personal target (e.g. a
    // just-applied weekly check-in estimate) won by default and got scored
    // and frozen into targetsSnap, permanently for a day already in the
    // past, even though the real coaching macros arrived correct and
    // unchanged moments later. Waiting for the fetch to settle first means
    // this only ever scores against a target that's actually final.
    if (coachingId && !coachingMacrosLoaded) return;
    if (!foodTouchedDates.size || !effectiveTargets) return;
    const flexActive = LB.isFlexPlan((store.schedules || []).find(s => s.id === store.activeScheduleId));
    setStore(s => {
      const touchedLogs = (s.dailyLogs || []).filter(log => foodTouchedDates.has(log.date));
      if (!touchedLogs.length) return s;
      const reconciled = new Map();
      touchedLogs.forEach(log => {
        const dayMode = log.date === today ? (s.statusMode ?? null) : (() => {
          const ts = new Date(log.date + 'T12:00:00').getTime();
          const period = (s.statusPeriods || []).find(p => {
            const start = new Date(p.startedAt).getTime();
            const end = p.endedAt ? new Date(p.endedAt).getTime() : Date.now();
            return ts >= start && ts <= end;
          });
          return period?.mode || null;
        })();
        const isTraining = LB.isTrainingDayForDate(s, log.date);
        // A day that was already scored keeps the target it was scored
        // against: targetsSnap is a save-time snapshot by contract. Without
        // this, editing the macro targets today re-scored the whole logged
        // history against the new numbers, so past adherence (and every coach
        // view and check-in built on it) changed retroactively.
        // Today is excluded from that override on purpose: it isn't history
        // yet, and must keep tracking effectiveTargets live for as long as
        // the day is still in progress (e.g. self-coached macros configured
        // after already logging food earlier today). Without this exclusion,
        // whichever write scored today FIRST froze it for the rest of the
        // day, effectiveTargets changing again later just no-ops here since
        // dayTargetOverride always wins once a snap exists, screens-food.jsx's
        // own dayTarget memo makes the exact same assumption for today.
        const snap = log.date !== today ? log.targetsSnap : null;
        const storedTarget = snap && (snap.protein != null || snap.carbs != null || snap.fat != null) ? snap : null;
        let { adherence, targetsSnap } = dayMode
          ? { adherence: null, targetsSnap: null }
          : LB.dailyLogAdherence(log, effectiveTargets, isTraining, storedTarget);
        if (!dayMode && flexActive && !targetsSnap) {
          const dt = log.targetsSnap?.dayType;
          if (dt === 'training' || dt === 'rest') targetsSnap = { dayType: dt };
        }
        if (log.adherence === adherence && JSON.stringify(log.targetsSnap) === JSON.stringify(targetsSnap)) return;
        // Bump updatedAt so sync_daily_logs_batch's `updated_at < EXCLUDED`
        // staleness guard accepts this write. The Food-Tracker rollup already
        // persisted this row with its own timestamp; re-sending the reconciled
        // adherence with that SAME timestamp would be silently dropped server-
        // side, leaving the coach/check-in with null/stale adherence forever.
        reconciled.set(log.date, { ...log, adherence, targetsSnap, updatedAt: new Date().toISOString() });
      });
      if (!reconciled.size) return s;
      const nextLogs = s.dailyLogs.map(log => reconciled.has(log.date) ? reconciled.get(log.date) : log);
      return { ...s, dailyLogs: nextLogs };
    });
  }, [foodTouchedDates, effectiveTargets, store.schedules, store.activeScheduleId, coachingId, coachingMacrosLoaded]);

  // Two-sided retroactive heal for a past day's saved day type:
  //  • DOWNGRADE training → rest: a training-tagged day with NO logged session
  //    was never earned. For cycle/week that's a planned training day skipped
  //    ("earn it"); for flex it's a proactive Training that wasn't trained.
  //  • UPGRADE rest → training (all modes): a rest-tagged day that DID get a
  //    logged session (incl. a freestyle session on a rest day) is really a
  //    training day, so its target/adherence should follow.
  // The two sets are disjoint (training+no-session vs rest+session), so a rewrite
  // always flips the day out of both conditions, no oscillation. Adherence is
  // recomputed against the new target; the dayType is corrected even when macro
  // targets are absent (keeps the health strip/indicator honest).
  const flexActive = useMemoH(
    () => LB.isFlexPlan((store.schedules || []).find(s => s.id === store.activeScheduleId)),
    [store.schedules, store.activeScheduleId]
  );
  useEffectH(() => {
    // Same coachingMacros-still-loading race as the food reconciler above:
    // this heal also freezes targetsSnap for past days off effectiveTargets,
    // so it must wait for the same settle before trusting it.
    if (coachingId && !coachingMacrosLoaded) return;
    const today = LB.todayISO();
    const dayOf = s => s.date ? s.date.slice(0, 10) : null;
    const sessionDates = new Set((store.sessions || []).filter(s => s.ended).map(dayOf).filter(Boolean));
    const trainingTarget = LB.dayTargetFromMacros(effectiveTargets, true);
    const restTarget = LB.dayTargetFromMacros(effectiveTargets, false);
    // Built inside the updater, not from the render closure: this used to map
    // over the `store.dailyLogs` captured at render and hand the result to
    // setStore wholesale, which threw away any dailyLogs update queued in the
    // same commit (the food reconciler above queues exactly that).
    setStore(s => {
      let changed = false;
      const nextLogs = (s.dailyLogs || []).map(l => {
        if (l.date >= today) return l;
        const dt = l.targetsSnap?.dayType;
        const hasSession = sessionDates.has(l.date);
        let newType = null;
        if (dt === 'training' && !hasSession && (flexActive || !!LB.plannedTrainingDay(s, l.date))) newType = 'rest';
        else if (dt === 'rest' && hasSession) newType = 'training';
        if (!newType) return l;
        const target = newType === 'training' ? trainingTarget : restTarget;
        // Same hole as setFlexDayType: this rewrote a score onto days that
        // must not carry one. The flag is on the row so dailyLogAdherence
        // sees it; status has to be asked for.
        const unscored = l.mealOfChoice || !!LB.statusModeForDate(s, l.date);
        // Unlike the food reconciler this genuinely needs the CURRENT targets:
        // the day type itself changed, and the old snapshot only holds the
        // target for the type that turned out to be wrong.
        const adherence = (target && !unscored)
          ? LB.dailyLogAdherence(l, effectiveTargets, newType === 'training').adherence : null;
        const targetsSnap = target ? { ...target, dayType: newType } : { dayType: newType };
        changed = true;
        return { ...l, adherence, targetsSnap, updatedAt: new Date().toISOString() };
      });
      return changed ? { ...s, dailyLogs: nextLogs } : s;
    });
  }, [store.sessions, store.dailyLogs, effectiveTargets, flexActive, coachingId, coachingMacrosLoaded]);

  // Windowed series builder for the charts. The x-range is tightened to the
  // actual logged days inside the window (not the full timeframe) so a sparse
  // window doesn't leave most of the chart empty, 80 of 90 days fills the chart.
  const tfDays = id => (HEALTH_TFS.find(t => t.id === id) || HEALTH_TFS[1]).days;

  const windowDays = tfDays(tf);
  // 1W aligns to the same Monday-anchored calendar week as the date strip /
  // "This Week" card above (re-anchoring to whichever day is selected, same
  // as that card); 1M/3M stay a rolling trailing window (a calendar-week
  // boundary wouldn't mean much over a month+ anyway).
  const weekWindow = tf === '1W' ? healthMondayWeekBounds(selectedDate || today) : null;
  const weightSeries = useMemoH(() => healthSeriesFor(dailyLogs, windowDays, l => ({ value: l.weight }), weekWindow), [dailyLogs, tf, selectedDate]);
  const stepsSeries = useMemoH(() => healthSeriesFor(dailyLogs, windowDays, l => ({ value: l.steps }), weekWindow), [dailyLogs, tf, selectedDate]);
  const waterSeries = useMemoH(() => healthSeriesFor(dailyLogs, windowDays, l => ({ value: l.waterMl }), weekWindow), [dailyLogs, tf, selectedDate]);
  const macroSeries = useMemoH(() => healthSeriesFor(dailyLogs, windowDays, l => ({ protein: l.protein, carbs: l.carbs, fat: l.fat, fiber: l.fiber, calories: l.calories, targetCal: l.targetsSnap?.calories ?? null }), weekWindow), [dailyLogs, tf, selectedDate]);
  const adhSeries = useMemoH(() => healthSeriesFor(dailyLogs, windowDays, l => ({ value: l.adherence }), weekWindow), [dailyLogs, tf, selectedDate]);

  // Cardio chart series, minutes summed per day from store.cardioLogs.
  const cardioSeries = useMemoH(() => healthCardioSeries(store.cardioLogs, windowDays, weekWindow), [store.cardioLogs, tf, selectedDate]);

  // Historical avg macro target for the chart window (from persisted targetsSnap).
  // For 1M/3M this replaces the current training/rest split in the Macro card target row.
  const macroTargetAvg = useMemoH(() => {
    if (tf === '1W') return null;
    const { start, end } = healthWindow(windowDays);
    const withSnap = dailyLogs.filter(l => l.date >= start && l.date <= end && l.targetsSnap && l.targetsSnap.calories != null);
    if (!withSnap.length) return null;
    const avg = k => Math.round(withSnap.reduce((s, l) => s + (l.targetsSnap[k] || 0), 0) / withSnap.length);
    return { calories: avg('calories'), protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat') };
  }, [dailyLogs, tf]);

  const avg = (arr, key) => { const vs = arr.map(d => d[key]).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; };
  const weightAvgRaw = avg(weightSeries.data, 'value');
  const weightAvg = weightAvgRaw != null ? Math.round(weightAvgRaw * 10) / 10 : null;
  // Goal-direction-aware trend stats (best/plateau semantics depend on
  // settings.macroCalc.goal, see healthWeightTrend).
  const weightTrend = useMemoH(() => healthWeightTrend(weightSeries.data, store.settings?.macroCalc?.goal), [weightSeries.data, store.settings?.macroCalc?.goal]);
  const stepsAvg = avg(stepsSeries.data, 'value');
  const waterAvg = avg(waterSeries.data, 'value');
  const adhAvg = avg(adhSeries.data, 'value');
  const cardioTotal = cardioSeries.data.reduce((s, d) => s + (d.value || 0), 0);

  // Reorderable card order, persisted per device. Missing ids (e.g. after a new
  // card ships) are inserted at their default position, not appended at the end.
  const CARD_ORDER_KEY = 'logbook-health-card-order';
  // Macros/Adherence/Targets move, hide, and show as one unit, id 'macroGroup',
  // see its cardEls entry below, since hiding just one of the three orphans the
  // others (e.g. an adherence chart with no targets to compare against).
  const DEFAULT_CARD_ORDER = ['week', 'today', 'aiSummary', 'macroGroup', 'weight', 'cardio', 'steps', 'water', 'glucose', 'bloodPressure', 'bodyTemp', 'bodyMeasurements'];
  const [cardOrder, setCardOrder] = useStateH(() => {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(CARD_ORDER_KEY) || '[]'); } catch (_) {}
    const result = (Array.isArray(saved) ? saved : []).filter(id => DEFAULT_CARD_ORDER.includes(id));
    DEFAULT_CARD_ORDER.forEach((id, i) => { if (!result.includes(id)) result.splice(Math.min(i, result.length), 0, id); });
    return result;
  });
  // Cross-device preference (settings), separate from the per-device drag
  // order above: which cards the user never wants to see, regardless of data.
  const hiddenCards = new Set(store.settings?.hiddenHealthCards || []);
  const isCardVisible = id => cardEls[id] && !hiddenCards.has(id);
  const reorderCards = (from, to) => {
    if (from === to) return;
    setCardOrder(prev => {
      const visible = prev.filter(isCardVisible);
      const moved = [...visible];
      const [m] = moved.splice(from, 1);
      moved.splice(to, 0, m);
      // Refill the visible slots in place instead of appending the invisible
      // ids at the end. Flushing them to the back permanently reordered every
      // card that merely had no data yet (or was hidden in settings), so
      // showing it again put it at the bottom rather than where it was.
      let vi = 0;
      const next = prev.map(id => (isCardVisible(id) ? moved[vi++] : id));
      try { localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  // Period overview, adapts to tf: 1W = current Mon–Sun, 1M/3M = rolling window.
  const weekStats = useMemoH(() => computeHealthWeekStats({
    logs: dailyLogs, sessions: store.sessions, cardioLogs: store.cardioLogs,
    planningState: store, tf, today, selectedDate,
  }), [dailyLogs, store.sessions, store.cardioLogs, store.schedules, store.activeScheduleId, store.cycleStartDate, store.weekPlanStartDate, today, selectedDate, tf]);

  const targetDayRow = (label, suffix) => {
    const t = effectiveTargets || {};
    const p = t[`protein${suffix}`], c = t[`carbs${suffix}`], f = t[`fat${suffix}`], cal = t[`calories${suffix}`];
    if (p == null && c == null && f == null) return null;
    return (
      <div key={suffix} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0' }}>
        <span style={{ width: 62, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.inkFaint }}>{label}</span>
        {cal != null && (
          <span className="num" style={{ fontSize: 16, color: 'var(--accent)', fontWeight: 400 }}>
            {cal}<span style={{ fontSize: 9, color: UI.inkFaint, marginLeft: 2 }}>kcal</span>
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', gap: 9 }}>
          {p != null && chip('P', p)}
          {c != null && chip('C', c)}
          {f != null && chip('F', f)}
        </span>
      </div>
    );
  };

  const chip = (k, v) => (
    <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft }}>
      <span style={{ color: UI.inkGhost, fontSize: 9 }}>{k}</span> {v}
    </span>
  );
  // What the Training/Rest split below actually averages to across a real
  // week, blended by how many of those 7 days are training days (same
  // weeklyAverageCalories the estimator sheet already uses to answer this).
  // Only meaningful next to the split itself, not macroTargetAvg's own
  // historical-average row (1M/3M), which has no Training/Rest split to blend.
  const targetWeekAvgRow = (() => {
    const t = effectiveTargets || {};
    const d = store.settings?.macroCalc?.trainingDays;
    if (d == null || t.caloriesTraining == null || t.caloriesRest == null) return null;
    const weekCal = LB.weeklyAverageCalories(t.caloriesTraining, t.caloriesRest, d);
    const weekMacros = LB.weeklyAverageMacros(
      { protein: t.proteinTraining, carbs: t.carbsTraining, fat: t.fatTraining },
      { protein: t.proteinRest, carbs: t.carbsRest, fat: t.fatRest },
      d,
    );
    return (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0', marginTop: 2, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
        <span style={{ width: 62, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: UI.inkFaint }}>Week avg</span>
        <span className="num" style={{ fontSize: 16, color: UI.ink, fontWeight: 400 }}>
          {weekCal}<span style={{ fontSize: 9, color: UI.inkFaint, marginLeft: 2 }}>kcal</span>
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', gap: 9 }}>
          {chip('P', weekMacros.protein)}
          {chip('C', weekMacros.carbs)}
          {chip('F', weekMacros.fat)}
        </span>
      </div>
    );
  })();
  const targetLabel = macroTargetAvg
    ? `AVG TARGET · ${tf === '1M' ? 'LAST 30 DAYS' : 'LAST 3 MONTHS'}`
    : 'DAILY TARGETS';
  // Accent-framed on purpose: these are the numbers actually in effect, the
  // one thing in the merged Targets card that must read as authoritative
  // next to the plain-framed algorithm-estimate box below it (source line
  // right above already says whose targets these are, no need to repeat it
  // in the label here too).
  const targetRow = (
    <div style={{ background: UI.bgInset, border: `2px solid rgba(var(--accent-rgb),0.35)`, borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: effectiveTargets ? 2 : 0 }}>
        <span className="micro" style={{ color: UI.inkFaint, flex: 1 }}>{targetLabel}</span>
      </div>
      {effectiveTargets ? (
        macroTargetAvg ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0' }}>
            <span className="num" style={{ fontSize: 16, color: 'var(--accent)', fontWeight: 400 }}>
              {macroTargetAvg.calories}<span style={{ fontSize: 9, color: UI.inkFaint, marginLeft: 2 }}>kcal</span>
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ display: 'flex', gap: 9 }}>
              {chip('P', macroTargetAvg.protein)}
              {chip('C', macroTargetAvg.carbs)}
              {chip('F', macroTargetAvg.fat)}
            </span>
          </div>
        ) : (
          <>
            {targetDayRow('Training', 'Training')}
            <div style={{ height: 0.5, background: UI.hair }} />
            {targetDayRow('Rest', 'Rest')}
            {targetWeekAvgRow}
          </>
        )
      ) : (
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 4 }}>
          Set protein / carbs / fat goals to track macro adherence.
        </div>
      )}
      {coachHasMacros && (
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px', marginTop: 8, paddingTop: 8, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
          {selfCoachedMacros
            ? 'These come from your active plan and take priority. Personal targets you set apply only without them.'
            : 'These come from your coaching plan and take priority. Personal targets you set apply only without coaching macros.'}
        </div>
      )}
    </div>
  );

  const handle = <DragHandle style={{ width: 20, height: 22, marginLeft: -4, cursor: 'grab' }} />;
  const dayLabel = selectedDate === today ? 'Today' : LB.fmtDayLabel(selectedDate, { weekday: 'short', day: 'numeric', month: 'short' });
  const trainedSelected = LB.isLoggedTrainingDay(store.sessions, selectedDate);
  const cardioSelected = (store.cardioLogs || []).some(l => l.date === selectedDate);
  // Honors a flex plan's explicit Training|Rest override (via targetsSnap.dayType).
  const dayIsTraining = LB.isTrainingDayForDate(store, selectedDate);
  const selectedDayTarget = LB.dayTargetFromMacros(effectiveTargets, dayIsTraining);
  // Whether the selected day fell inside a sick/vacation status period (drives
  // adherence suppression). Shared predicate, not an inline scan: selectedDate
  // can be today (see dayLabel above), and today has to answer from the live
  // statusMode cache rather than scanning statusPeriods, since a just-started
  // period may not have landed there yet.
  const selectedIsStatusDay = !!LB.statusModeForDate(store, selectedDate);
  // Opens a chart full-width in a sheet, offered only on charts the 2-col grid
  // below actually squeezes to half-width (see the onExpand wiring per card and
  // expandableCards further down, which the sheet renders from by this id).
  const expandBtn = id => () => setExpandedCardId(id);

  // The 3 macro cards live together in the macroGroup composite below
  // (targets + algorithm estimate, adherence trend, macro breakdown) so hide/
  // move/reorder always treats them as one unit, leaving one behind orphans
  // the others (an adherence trend with no targets to compare against isn't
  // useful alone).
  const macroSourceCard = (
    <MacroSourceCard store={store} setStore={setStore} dragHandle={handle} tf={tf} setTf={setTf}
      coachHasMacros={coachHasMacros} fromCoach={fromCoach} selfCoachedMacros={selfCoachedMacros}
      hasTargets={!!effectiveTargets} onSetTarget={() => setTargetOpen(true)} onOpenCheckin={() => setCheckinOpen(true)}
      onOpenSettings={() => setAutomationSettingsOpen(true)}>
      {targetRow}
    </MacroSourceCard>
  );
  const macroAdherenceCard = (
    <HealthChartCard title="Adherence" icon="fa-bullseye" tf={tf} setTf={setTf} onExpand={expandBtn('macroAdherence')}
      headline={adhAvg != null ? `${Math.round(adhAvg)}%` : null} sub={adhAvg != null ? 'avg' : null}>
      <HealthLineChart series={adhSeries.data} from={adhSeries.from} to={adhSeries.to} format={v => `${Math.round(v)}%`} yMin={0} yMax={100} />
    </HealthChartCard>
  );
  const macrosCard = (
    <HealthChartCard title="Macros" icon="fa-utensils" tf={tf} setTf={setTf} onExpand={expandBtn('macros')}>
      <HealthMacroChart series={macroSeries.data} from={macroSeries.from} to={macroSeries.to} />
      <MacroLegend />
    </HealthChartCard>
  );

  const cardEls = {
    week: <HealthWeekCard stats={weekStats} dragHandle={handle} targets={effectiveTargets} tf={tf} setTf={setTf} />,
    today: <HealthMetricsCard log={selectedLog} dateLabel={dayLabel} isToday={selectedDate === today} onJumpToday={() => setSelectedDate(today)} dragHandle={handle} trained={trainedSelected} hasCardio={cardioSelected} dayTarget={selectedDayTarget} isStatusDay={selectedIsStatusDay}
      mealOfChoiceOrdinal={LB.mealOfChoiceWeekCount(store.dailyLogs, selectedDate).ordinal} />,
    aiSummary: <AiSummaryCard key={selectedDate} dragHandle={handle} store={store} setStore={setStore} userId={userId} selectedDate={selectedDate} />,
    // Targets first (full width, needs the room for the P/C/F chip rows),
    // then Adherence + the macro breakdown paired below it, always full-width
    // as a whole, see fullWidthCardIds.
    macroGroup: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {macroSourceCard}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
          {macroAdherenceCard}
          {macrosCard}
        </div>
      </div>
    ),
    weight: (
      <HealthChartCard title="Weight" icon="fa-weight-scale" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('weight')}
        headline={weightAvg != null ? `${weightAvg}${UI.unit()}` : null} sub={weightAvg != null ? 'avg' : null}>
        <HealthLineChart series={weightSeries.data} from={weightSeries.from} to={weightSeries.to} format={v => `${v}${UI.unit()}`} step={UI.unit() === 'lbs' ? 5 : 2.5} trend={weightTrend?.trendPoints} />
        <WeightTrendChips trend={weightTrend} unit={UI.unit()} />
      </HealthChartCard>
    ),
    steps: (
      <HealthChartCard title="Steps" icon="fa-shoe-prints" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('steps')}
        headline={stepsAvg != null ? Math.round(stepsAvg).toLocaleString() : null} sub={stepsAvg != null ? 'avg / day' : null}>
        <HealthBarChart series={stepsSeries.data} from={stepsSeries.from} to={stepsSeries.to} format={v => v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`} />
      </HealthChartCard>
    ),
    // Water is an independently-toggleable tab now: this card is just a
    // shortcut into it, so treat a disabled tab the same as the
    // no-data-yet cases below (glucose/bloodPressure/bodyTemp), null hides
    // it via isCardVisible without needing a separate empty state.
    water: store.settings?.showWaterTab ? (
      <WaterCard waterSeries={waterSeries} waterAvg={waterAvg} waterLogs={store.waterLogs} tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('water')} onOpen={() => go({ name: 'water' })} compact />
    ) : null,
    cardio: (
      <HealthChartCard title="Cardio" icon="fa-person-running" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('cardio')}
        headline={cardioTotal ? cardioTotal : null} sub={cardioTotal ? 'min total' : null}>
        <HealthBarChart series={cardioSeries.data} from={cardioSeries.from} to={cardioSeries.to} format={v => `${Math.round(v)}`} />
      </HealthChartCard>
    ),
    // compact: hides the reference legend + readings feed so these match the
    // plain-chart cards' height in the grid, full detail is one expand tap away.
    glucose: (store.glucoseLogs || []).length > 0
      ? <GlucoseCard glucoseLogs={store.glucoseLogs} unit={store.settings?.glucoseUnit ?? 'mmol'} tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('glucose')} compact />
      : null,
    bloodPressure: (store.bloodPressureLogs || []).length > 0
      ? <BloodPressureCard bpLogs={store.bloodPressureLogs} tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('bloodPressure')} compact />
      : null,
    bodyTemp: (store.bodyTempLogs || []).length > 0
      ? <BodyTempCard tempLogs={store.bodyTempLogs} unit={LB.defaultTempUnit(store.settings)} tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('bodyTemp')} compact />
      : null,
    // Data-gated like glucose/BP/temp: no card until any day has any
    // measurement. The card itself is the shared BodyStatsCard (dropdown
    // metric switcher, lazy active-only series), so athlete and coach views
    // cannot drift apart.
    bodyMeasurements: (store.dailyLogs || []).some(l => l.waistCm != null || l.hipsCm != null || l.chestCm != null || l.armCm != null || l.thighCm != null || l.calfCm != null || l.bodyFatPct != null) ? (
      <BodyStatsCard logs={dailyLogs} tf={tf} selectedDate={selectedDate} setTf={setTf} dragHandle={handle} onExpand={expandBtn('bodyMeasurements')}
        weekWindow={weekWindow} windowDays={windowDays} heightCm={store.settings?.macroCalc?.heightCm ?? null}
        weightIsLbs={LB.weightAxisUnit(store.settings?.unit) === 'lbs'} />
    ) : null,
  };

  // Sheet lookup for expandedCardId, every id any onExpand above can set.
  // Cloned with dragHandle/onExpand stripped: the expand sheet isn't inside a
  // reorder list (grip would be inert) and re-expanding itself is meaningless.
  const expandableCards = { weight: cardEls.weight, steps: cardEls.steps, water: cardEls.water, cardio: cardEls.cardio,
    macroAdherence: macroAdherenceCard, macros: macrosCard,
    glucose: cardEls.glucose, bloodPressure: cardEls.bloodPressure, bodyTemp: cardEls.bodyTemp, bodyMeasurements: cardEls.bodyMeasurements };

  // Only Week/Today/the macro group ever span full width. Everything else
  // stays in the 2-col grid no matter what, a card left alone at the end of
  // an odd run just leaves the other half of its row empty instead of
  // stretching to fill it.
  const fullWidthCardIds = new Set(['week', 'today', 'aiSummary', 'macroGroup']);

  return (
    <Screen>
      <TopBar title="HEALTH" right={
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setExportOpen(true)} style={{
            background: 'transparent', border: `1px solid ${UI.hairStrong}`,
            borderRadius: 4, padding: '5px 10px', cursor: 'pointer',
            color: UI.inkSoft, lineHeight: 1,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <i className="fa-solid fa-file-export" style={{ fontSize: 11 }} />
          </button>
          <button onClick={takeScreenshot} disabled={capturing} style={{
            background: 'transparent', border: `1px solid ${UI.hairStrong}`,
            borderRadius: 4, padding: '5px 10px', cursor: capturing ? 'default' : 'pointer',
            color: capturing ? UI.inkGhost : UI.inkSoft, lineHeight: 1,
            WebkitTapHighlightColor: 'transparent',
          }}>
            {capturing ? <span style={{ fontFamily: UI.fontUi, fontSize: 10 }}>…</span> : <i className="fa-solid fa-camera" style={{ fontSize: 11 }} />}
          </button>
        </div>
      } />
      {store.statusMode && !capturing && (
        <div onClick={() => { setSelectedDate(today); setLogOpen(true); }} style={{
          margin: '0 16px 12px',
          padding: '10px 14px',
          background: 'rgba(var(--accent-rgb), 0.16)',
          border: `var(--hair-width) solid rgba(var(--accent-rgb), 0.3)`,
          borderRadius: 6,
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}>
          <i className={`fa-solid ${store.statusMode === 'sick' ? 'fa-bed-pulse' : store.statusMode === 'deload' ? 'fa-battery-quarter' : store.statusMode === 'cleanup' ? 'fa-broom' : 'fa-umbrella-beach'}`} style={{ fontSize: 14, color: 'var(--accent)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              {store.statusMode === 'sick' ? 'Sick' : store.statusMode === 'deload' ? 'Deload' : store.statusMode === 'cleanup' ? 'Cleanup' : 'Vacation'}
              {/* "Since" only once it has actually begun. A cleanup week is
                  activated ahead of time and pinned to the next cycle start, so
                  on the days before it starts this used to read "Since 8 Aug"
                  on the 7th, dating a status that had not begun. */}
              {store.statusModeSince ? (
                store.statusMode === 'cleanup' && !LB.cleanupStarted(store)
                  ? ` → ${new Date(store.statusModeSince).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`
                  : ` · Since ${new Date(store.statusModeSince).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`
              ) : ''}
            </div>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Tap to manage or deactivate</div>
          </div>
          <i className="fa-solid fa-chevron-right" style={{ fontSize: 9, color: UI.inkFaint }} />
        </div>
      )}
      <div ref={captureRef}>
        <HealthDateStrip store={store} setStore={setStore} selectedDate={selectedDate} onSelect={setSelectedDate} onLog={() => setLogOpen(true)} targets={effectiveTargets} />

        {/* max-width cap so charts don't blow up on iPad. Reorderable cards,
           drag the grip to reorder; order persists per device. Week/Today span
           both columns; the rest sit in a 2-col grid (fullWidthCardIds above). */}
        <div style={{ padding: capturing ? '8px 16px 16px' : '8px 16px env(safe-area-inset-bottom, 8px)', maxWidth: 680, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
          {cardOrder.every(id => !isCardVisible(id)) ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 16px', textAlign: 'center' }}>
              <i className="fa-solid fa-eye-slash" style={{ fontSize: 24, color: UI.inkGhost }} />
              <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '20px' }}>All Health cards are hidden.</div>
              {/* Breadcrumb follows the current nested path: Health lives inside
                  the Health & Nutrition hub now, one level deeper than before. */}
              <button onClick={() => go({ name: 'settings' })} style={{
                background: 'transparent', border: `var(--hair-width) solid rgba(var(--accent-rgb),0.4)`,
                borderRadius: 4, padding: '5px 14px', color: 'var(--accent)', marginTop: 4,
                fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}>Settings → Health & Nutrition → Health → Cards</button>
            </div>
          ) : (
            // Grid-squeezed charts hide their "Drag to inspect" hint (ChartCompactContext);
            // the expand sheet below isn't a descendant of this provider, so it keeps showing it.
            <ChartCompactContext.Provider value={true}>
              <ReorderList onReorder={reorderCards} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
                {cardOrder.map(id => isCardVisible(id) ? (
                  <div key={id} data-reorder-item="true" data-tour={`health-card-${id}`} style={fullWidthCardIds.has(id) ? { gridColumn: '1 / -1' } : undefined}>{cardEls[id]}</div>
                ) : null)}
              </ReorderList>
            </ChartCompactContext.Provider>
          )}
        </div>
      </div>

      <Sheet open={!!expandedCardId} onClose={() => setExpandedCardId(null)}>
        {expandedCardId && expandableCards[expandedCardId] &&
          React.cloneElement(expandableCards[expandedCardId], { dragHandle: null, onExpand: null, compact: false })}
      </Sheet>

      <DailyLogScreen open={logOpen} onClose={() => setLogOpen(false)} store={store} setStore={setStore} date={selectedDate} targets={effectiveTargets} activeCoachingSchema={activeCoachingSchema} onSetStatus={handleSetStatus} userId={userId} glucoseLogs={store.glucoseLogs || []} glucoseUnit={store.settings?.glucoseUnit ?? 'mmol'} bloodPressureLogs={store.bloodPressureLogs || []} bodyTempLogs={store.bodyTempLogs || []} tempUnit={LB.defaultTempUnit(store.settings)} go={go} />
      <MacroTargetSheet open={targetOpen} onClose={() => setTargetOpen(false)} store={store} setStore={setStore} coachingMacros={coachingMacros} />
      <WeeklyCheckinSheet open={checkinOpen} onClose={() => setCheckinOpen(false)} store={store} setStore={setStore} coachHasMacros={coachHasMacros} coachingMacros={coachingMacros}
        onOpenSettings={() => { setCheckinOpen(false); setAutomationSettingsOpen(true); }} />
      <MacroEstimatorSheet open={automationSettingsOpen} onClose={() => setAutomationSettingsOpen(false)} store={store} setStore={setStore} standalone
        onApply={t => setStore(s => ({ ...s, settings: { ...s.settings, macroTargets: t } }))} />
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} store={store} userId={userId} />
    </Screen>
  );
}

// ─── Coach read-only view (rendered inside CoachClientScreen's "Daily" tab) ─────

function HealthClientLogs({ clientStore }) {
  const logs = clientStore?.dailyLogs || [];
  const cardioLogs = clientStore?.cardioLogs || [];
  const waterLogs = clientStore?.waterLogs || [];
  const glucoseLogs = clientStore?.glucoseLogs || [];
  const glucoseUnit = clientStore?.settings?.glucoseUnit ?? 'mmol';
  const bloodPressureLogs = clientStore?.bloodPressureLogs || [];
  const bodyTempLogs = clientStore?.bodyTempLogs || [];
  const clientTempUnit = LB.defaultTempUnit(clientStore?.settings);
  // The coach may run a different weight unit than the client; always label the
  // client's weights in the client's own unit (no conversion, display-only).
  const clientUnit = clientStore?.settings?.unit === 'lbs' ? 'lbs' : 'kg';
  const [tf, setTf] = useStateH('1W');
  // Which card is blown up in the expand sheet (id into expandableCards below),
  // null when closed. Only charts squeezed by the 2-col grid offer this.
  const [expandedCardId, setExpandedCardId] = useStateH(null);

  const COACH_ORDER_KEY = 'logbook-coach-health-card-order';
  // Macros/Adherence move, hide, and show as one unit, id 'macroGroup', see its
  // cardEls entry below, same grouping as the client's own Health tab, and
  // required for hiddenHealthCards (client setting) to hide it correctly here too.
  const DEFAULT_COACH_ORDER = ['week', 'today', 'aiSummary', 'macroGroup', 'weight', 'cardio', 'steps', 'water', 'glucose', 'bloodPressure', 'bodyTemp', 'bodyMeasurements', 'weekly'];
  const [cardOrder, setCardOrder] = useStateH(() => {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(COACH_ORDER_KEY) || '[]'); } catch (_) {}
    const result = (Array.isArray(saved) ? saved : []).filter(id => DEFAULT_COACH_ORDER.includes(id));
    DEFAULT_COACH_ORDER.forEach((id, i) => { if (!result.includes(id)) result.splice(Math.min(i, result.length), 0, id); });
    return result;
  });
  const reorderCards = (from, to) => {
    if (from === to) return;
    setCardOrder(prev => {
      // ReorderList reports from/to as indices into the VISIBLE cards it
      // rendered, not the full order array, glucose/weekly are routinely
      // absent for new coaching clients, so splicing prev directly (as this
      // used to) reordered the wrong card whenever any card was hidden.
      const visible = prev.filter(isCardVisible);
      const moved = [...visible];
      const [m] = moved.splice(from, 1);
      moved.splice(to, 0, m);
      // Refill the visible slots in place, see the client-side twin: appending
      // the invisible ids permanently pushed every temporarily empty card to
      // the bottom.
      let vi = 0;
      const next = prev.map(id => (isCardVisible(id) ? moved[vi++] : id));
      try { localStorage.setItem(COACH_ORDER_KEY, JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };
  // Respect the CLIENT's own card-visibility preference (synced setting), not
  // the coach's: a card the client chose to hide stays hidden in their coach's
  // read-only view too.
  const hiddenCards = new Set(clientStore?.settings?.hiddenHealthCards || []);
  const isCardVisible = id => cardEls[id] && !hiddenCards.has(id);

  const [selectedDate, setSelectedDate] = useStateH(() => LB.todayISO());

  const tfDays = id => (HEALTH_TFS.find(t => t.id === id) || HEALTH_TFS[1]).days;
  const windowDays = tfDays(tf);

  // 1W aligns to the same Monday-anchored calendar week as the date strip /
  // "This Week" card above (see HealthScreen's identical weekWindow for why).
  const weekWindow = tf === '1W' ? healthMondayWeekBounds(selectedDate) : null;
  const weightSeries = useMemoH(() => healthSeriesFor(logs, windowDays, l => ({ value: l.weight }), weekWindow), [logs, tf, selectedDate]);
  const stepsSeries  = useMemoH(() => healthSeriesFor(logs, windowDays, l => ({ value: l.steps }), weekWindow), [logs, tf, selectedDate]);
  const waterSeries  = useMemoH(() => healthSeriesFor(logs, windowDays, l => ({ value: l.waterMl }), weekWindow), [logs, tf, selectedDate]);
  const macroSeries  = useMemoH(() => healthSeriesFor(logs, windowDays, l => ({ protein: l.protein, carbs: l.carbs, fat: l.fat, fiber: l.fiber, calories: l.calories, targetCal: l.targetsSnap?.calories ?? null }), weekWindow), [logs, tf, selectedDate]);
  const adhSeries    = useMemoH(() => healthSeriesFor(logs, windowDays, l => ({ value: l.adherence }), weekWindow), [logs, tf, selectedDate]);
  const cardioSeries = useMemoH(() => healthCardioSeries(cardioLogs, windowDays, weekWindow), [cardioLogs, tf, selectedDate]);

  const numAvg = series => { const vs = series.data.map(d => d.value).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; };
  const weightAvg = useMemoH(() => { const a = numAvg(weightSeries); return a != null ? Math.round(a * 10) / 10 : null; }, [weightSeries]);
  // Same goal-direction-aware trend stats as the athlete card, read from the
  // CLIENT's own macro goal.
  const weightTrend = useMemoH(() => healthWeightTrend(weightSeries.data, clientStore?.settings?.macroCalc?.goal), [weightSeries.data, clientStore?.settings?.macroCalc?.goal]);
  const stepsAvg  = useMemoH(() => { const a = numAvg(stepsSeries);  return a != null ? Math.round(a) : null; }, [stepsSeries]);
  const waterAvg  = useMemoH(() => numAvg(waterSeries), [waterSeries]);
  const adhAvg    = useMemoH(() => { const a = numAvg(adhSeries);    return a != null ? Math.round(a) : null; }, [adhSeries]);
  const cardioTotal = cardioSeries.data.reduce((s, d) => s + (d.value || 0), 0);

  // Weekly summary (Mon-anchored) for the last 8 weeks with any data.
  const weeks = useMemoH(() => {
    const byWeek = {};
    for (const l of logs) {
      const d = new Date(l.date + 'T12:00:00');
      const dow = d.getDay(); const mon = new Date(d); mon.setDate(d.getDate() - ((dow === 0 ? 7 : dow) - 1));
      const ws = LB.fmtISO(mon);
      (byWeek[ws] = byWeek[ws] || []).push(l);
    }
    const avg = (arr, k) => { const vs = arr.map(x => x[k]).filter(v => v != null); return vs.length ? Math.round(vs.reduce((s, v) => s + v, 0) / vs.length * 10) / 10 : null; };
    return Object.keys(byWeek).sort((a, b) => b.localeCompare(a)).slice(0, 8).map(ws => ({
      ws,
      weight: avg(byWeek[ws], 'weight'),
      steps: avg(byWeek[ws], 'steps'),
      calories: avg(byWeek[ws], 'calories'),
      protein: avg(byWeek[ws], 'protein'),
      carbs: avg(byWeek[ws], 'carbs'),
      fat: avg(byWeek[ws], 'fat'),
      adherence: avg(byWeek[ws], 'adherence'),
    }));
  }, [logs]);

  const today = LB.todayISO();

  const weekStats = useMemoH(() => computeHealthWeekStats({
    logs, sessions: clientStore?.sessions, cardioLogs: clientStore?.cardioLogs,
    planningState: clientStore || {}, tf, today, selectedDate,
  }), [logs, clientStore?.sessions, clientStore?.cardioLogs, clientStore?.schedules, clientStore?.activeScheduleId, clientStore?.cycleStartDate, clientStore?.weekPlanStartDate, today, selectedDate, tf]);

  if (!logs.length && !cardioLogs.length && !glucoseLogs.length && !bloodPressureLogs.length && !bodyTempLogs.length) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 }}>
        <i className="fa-solid fa-heart-pulse" style={{ fontSize: 28, color: UI.inkGhost }} />
        <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center' }}>No daily logs yet.<br />Your client hasn't tracked health metrics.</div>
      </div>
    );
  }

  const selectedLog = logs.find(l => l.date === selectedDate) || null;
  const trainedSelected = LB.isLoggedTrainingDay(clientStore?.sessions, selectedDate);
  const cardioSelected = cardioLogs.some(l => l.date === selectedDate);
  const dayLabel = selectedDate === today ? 'Today' : LB.fmtDayLabel(selectedDate, { weekday: 'short', day: 'numeric', month: 'short' });

  const handle = <DragHandle style={{ width: 20, height: 22, marginLeft: -4, cursor: 'grab' }} />;
  // Opens a chart full-width in a sheet, offered only on charts the 2-col grid
  // below actually squeezes to half-width (see expandableCards further down).
  const expandBtn = id => () => setExpandedCardId(id);

  // Macros + Adherence live together in the macroGroup composite below so
  // hide/move/reorder always treats them as one unit (mirrors the client's own
  // Health tab). No Targets sub-card: this read-only view never fetches macro
  // targets (that lives in the coach's separate Nutrition tab).
  const macrosCard = (
    <HealthChartCard title="Macros" icon="fa-utensils" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('macros')}>
      <HealthMacroChart series={macroSeries.data} from={macroSeries.from} to={macroSeries.to} />
      <MacroLegend />
    </HealthChartCard>
  );
  const adherenceCard = (
    <HealthChartCard title="Adherence" icon="fa-bullseye" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('adherence')}
      headline={adhAvg != null ? `${adhAvg}%` : null} sub={adhAvg != null ? 'avg' : null}>
      <HealthLineChart series={adhSeries.data} from={adhSeries.from} to={adhSeries.to} format={v => `${Math.round(v)}%`} yMin={0} yMax={100} />
    </HealthChartCard>
  );

  const cardEls = {
    week: <HealthWeekCard stats={weekStats} dragHandle={handle} targets={null} tf={tf} setTf={setTf} weightUnit={clientUnit} />,
    today: (
      <HealthMetricsCard log={selectedLog} dateLabel={dayLabel} isToday={selectedDate === today} onJumpToday={() => setSelectedDate(today)}
        dragHandle={handle} trained={trainedSelected} hasCardio={cardioSelected} dayTarget={null} weightUnit={clientUnit}
        mealOfChoiceOrdinal={LB.mealOfChoiceWeekCount(logs, selectedDate).ordinal} />
    ),
    // Read-only: no Generate button here at all, a coach's own tap would
    // resolve server-side to the COACH's own identity, not the client's, see
    // AiSummaryCard's own comment.
    aiSummary: <AiSummaryCard key={selectedDate} dragHandle={handle} store={clientStore || {}} selectedDate={selectedDate} readOnly />,
    macroGroup: (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
        {adherenceCard}
        {macrosCard}
      </div>
    ),
    weight: (
      <HealthChartCard title="Weight" icon="fa-weight-scale" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('weight')}
        headline={weightAvg != null ? `${weightAvg}${clientUnit}` : null} sub={weightAvg != null ? 'avg' : null}>
        <HealthLineChart series={weightSeries.data} from={weightSeries.from} to={weightSeries.to} format={v => `${v}${clientUnit}`} step={clientUnit === 'lbs' ? 5 : 2.5} trend={weightTrend?.trendPoints} />
        <WeightTrendChips trend={weightTrend} unit={clientUnit} />
      </HealthChartCard>
    ),
    steps: (
      <HealthChartCard title="Steps" icon="fa-shoe-prints" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('steps')}
        headline={stepsAvg != null ? stepsAvg.toLocaleString() : null} sub={stepsAvg != null ? 'avg / day' : null}>
        <HealthBarChart series={stepsSeries.data} from={stepsSeries.from} to={stepsSeries.to} format={v => v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`} />
      </HealthChartCard>
    ),
    water: (
      <WaterCard waterSeries={waterSeries} waterAvg={waterAvg} waterLogs={waterLogs} tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('water')} compact />
    ),
    cardio: (
      <HealthChartCard title="Cardio" icon="fa-person-running" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('cardio')}
        headline={cardioTotal || null} sub={cardioTotal ? 'min total' : null}>
        <HealthBarChart series={cardioSeries.data} from={cardioSeries.from} to={cardioSeries.to} format={v => `${Math.round(v)}`} />
      </HealthChartCard>
    ),
    // compact: hides the reference legend + readings feed so these match the
    // plain-chart cards' height in the grid, full detail is one expand tap away.
    glucose: glucoseLogs.length > 0
      ? <GlucoseCard glucoseLogs={glucoseLogs} unit={glucoseUnit} tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('glucose')} compact />
      : null,
    bloodPressure: bloodPressureLogs.length > 0
      ? <BloodPressureCard bpLogs={bloodPressureLogs} tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('bloodPressure')} compact />
      : null,
    bodyTemp: bodyTempLogs.length > 0
      ? <BodyTempCard tempLogs={bodyTempLogs} unit={clientTempUnit} tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('bodyTemp')} compact />
      : null,
    // Data-gated mirror of the athlete card (see HealthScreen's cardEls).
    bodyMeasurements: logs.some(l => l.waistCm != null || l.hipsCm != null || l.chestCm != null || l.armCm != null || l.thighCm != null || l.calfCm != null || l.bodyFatPct != null) ? (
      <BodyStatsCard logs={logs} tf={tf} selectedDate={selectedDate} setTf={setTf} dragHandle={handle} onExpand={expandBtn('bodyMeasurements')}
        weekWindow={weekWindow} windowDays={windowDays} heightCm={clientStore?.settings?.macroCalc?.heightCm ?? null}
        weightIsLbs={clientUnit === 'lbs'} />
    ) : null,
    // Dense table, doesn't fit the 2-col grid, always full width (fullWidthCardIds).
    weekly: weeks.length ? (
      <Card style={{ padding: 14, borderLeft: `3px solid ${UI.gold}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {handle}
          <span style={HEALTH_CARD_HEADER_STYLE}>WEEKLY AVERAGES</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {weeks.map((w, i) => (
            <div key={w.ws} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6 }}>
              <div style={{ width: 58, flexShrink: 0, fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>{LB.fmtDayLabel(w.ws, { day: 'numeric', month: 'short' })}</div>
              <div style={{ flex: 1, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {w.weight != null && <span className="num" style={{ fontSize: 11, color: UI.inkSoft }}>{w.weight} {clientUnit}</span>}
                {w.steps != null && <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>{Math.round(w.steps).toLocaleString()} st</span>}
                {w.calories != null && <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>{Math.round(w.calories)} kcal</span>}
                {(w.protein != null || w.carbs != null || w.fat != null) && (
                  <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>
                    {[w.protein != null && `P${Math.round(w.protein)}`, w.carbs != null && `C${Math.round(w.carbs)}`, w.fat != null && `F${Math.round(w.fat)}`].filter(Boolean).join(' ')}
                  </span>
                )}
              </div>
              {w.adherence != null && <span className="num" style={{ fontSize: 13, color: adherenceColor(w.adherence), flexShrink: 0 }}>{Math.round(w.adherence)}%</span>}
            </div>
          ))}
        </div>
      </Card>
    ) : null,
  };

  // Sheet lookup for expandedCardId, every id any onExpand above can set.
  // Cloned with dragHandle/onExpand stripped: the expand sheet isn't inside a
  // reorder list (grip would be inert) and re-expanding itself is meaningless.
  const expandableCards = { weight: cardEls.weight, steps: cardEls.steps, water: cardEls.water, cardio: cardEls.cardio,
    adherence: adherenceCard, macros: macrosCard,
    glucose: cardEls.glucose, bloodPressure: cardEls.bloodPressure, bodyTemp: cardEls.bodyTemp, bodyMeasurements: cardEls.bodyMeasurements };

  // Only Week/Today/the macro group/Weekly Averages ever span full width.
  // Everything else stays in the 2-col grid no matter what, matches the
  // client's own Health tab exactly (see HealthScreen's fullWidthCardIds).
  const fullWidthCardIds = new Set(['week', 'today', 'aiSummary', 'macroGroup', 'weekly']);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <HealthDateStrip store={clientStore} selectedDate={selectedDate} onSelect={setSelectedDate} onLog={null} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 32px', maxWidth: 680, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
        {cardOrder.every(id => !isCardVisible(id)) ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 16px', textAlign: 'center' }}>
            <i className="fa-solid fa-eye-slash" style={{ fontSize: 24, color: UI.inkGhost }} />
            <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '20px' }}>Your client has hidden all their Health cards.</div>
          </div>
        ) : (
          // Grid-squeezed charts hide their "Drag to inspect" hint (ChartCompactContext);
          // the expand sheet below isn't a descendant of this provider, so it keeps showing it.
          <ChartCompactContext.Provider value={true}>
            <ReorderList onReorder={reorderCards} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
              {cardOrder.map(id => isCardVisible(id) ? (
                <div key={id} data-reorder-item="true" style={fullWidthCardIds.has(id) ? { gridColumn: '1 / -1' } : undefined}>{cardEls[id]}</div>
              ) : null)}
            </ReorderList>
          </ChartCompactContext.Provider>
        )}
      </div>

      <Sheet open={!!expandedCardId} onClose={() => setExpandedCardId(null)}>
        {expandedCardId && expandableCards[expandedCardId] &&
          React.cloneElement(expandableCards[expandedCardId], { dragHandle: null, onExpand: null, compact: false })}
      </Sheet>
    </div>
  );
}

// ─── Export sheet ─────────────────────────────────────────────────────────────

function ExportSheet({ open, onClose, store, userId }) {
  const today = LB.todayISO();
  const [from, setFrom] = useStateH(() => LB.shiftDate(today, -29));
  const [to, setTo] = useStateH(today);
  const [exporting, setExporting] = useStateH(null); // 'csv' | 'pdf' | 'food' | null

  const applyPreset = (days) => {
    setFrom(LB.shiftDate(today, -(days - 1)));
    setTo(today);
  };

  // See the FROM/TO row below for why each of these is here.
  const dateInputStyle = {
    width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none',
    colorScheme: ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark') ? 'light' : 'dark',
    padding: '8px 10px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
    background: UI.bgInset, color: UI.ink, fontFamily: UI.fontNum, fontSize: 13, outline: 'none',
  };

  const logsInRange = () =>
    (store.dailyLogs || []).filter(l => l.date >= from && l.date <= to).sort((a, b) => a.date < b.date ? -1 : 1);

  const cardioByDay = () => {
    const m = {};
    (store.cardioLogs || []).filter(l => l.date >= from && l.date <= to).forEach(l => {
      if (!m[l.date]) m[l.date] = { min: 0, distM: null };
      m[l.date].min += (l.durationMinutes || 0);
      if (l.distanceM != null) m[l.date].distM = (m[l.date].distM || 0) + l.distanceM;
    });
    return m;
  };

  const sessionsByDay = () => {
    const m = {};
    (store.sessions || []).filter(s => s.ended && (s.date || '').slice(0, 10) >= from && (s.date || '').slice(0, 10) <= to).forEach(s => {
      const d = typeof s.date === 'string' ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10);
      if (!m[d]) m[d] = [];
      m[d].push(s);
    });
    return m;
  };

  // Per-ENTRY food export, next to the two day-level exports above. Those roll
  // a day up into one row of totals, which answers "how much" but never "of
  // what": the actual foods are the first thing anyone reviewing a week wants
  // to see, and until now they could not leave the app at all.
  // store.foodLogs only holds the boot window, so anything older in the chosen
  // range is fetched on demand (same helper the Food screen uses to browse back
  // past that window) rather than silently exporting a short range.
  const doExportFoodCSV = async () => {
    setExporting('food');
    try {
      const dates = [];
      for (let d = from; d <= to; d = LB.shiftDate(d, 1)) dates.push(d);
      const have = new Set((store.foodLogs || []).map(l => l.date));
      const missing = dates.filter(d => !have.has(d));
      let extra = [];
      if (missing.length) {
        // A failed fetch here used to be swallowed into {}, so a spotty
        // connection produced a CSV that looked complete but silently
        // dropped whatever was outside the boot window. Abort instead: no
        // file is a more honest outcome than a wrong one for an export.
        let byDate;
        try {
          byDate = await LB.fetchFoodLogsForDates(userId, missing);
        } catch (e) {
          UI.alert('Could not load the full date range. Please try again.');
          return;
        }
        extra = Object.values(byDate || {}).flat();
      }
      const rows = [...(store.foodLogs || []), ...extra]
        .filter(l => l.date >= from && l.date <= to)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

      const esc = v => {
        if (v == null || v === '') return '';
        const s = String(v);
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ['Date', 'Time', 'Food', 'Brand', 'Source', 'Amount (g)', 'Unit', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Fiber (g)', 'Sugar (g)', 'Sat. fat (g)', 'Sodium (mg)', 'Planned'];
      const body = rows.map(l => [
        l.date, l.time, l.foodName, l.brand, l.source, l.quantityG,
        l.loggedUnit ? `${l.loggedUnit.label} (${l.loggedUnit.grams}g)` : '',
        l.calories, l.protein, l.carbs, l.fat, l.fiber, l.sugar, l.satFat, l.sodiumMg,
        l.planned ? 'yes' : 'no',
      ].map(esc).join(','));

      const csv = [header.map(esc).join(','), ...body].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `food-log-${from}-${to}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onClose();
    } finally {
      setExporting(null);
    }
  };

  const doExportCSV = () => {
    setExporting('csv');
    try {
      const unit = (store.settings?.unit === 'lbs') ? 'lbs' : 'kg';
      const logs = logsInRange();
      const cardio = cardioByDay();
      const sessions = sessionsByDay();
      const netCarbs = store.settings?.netCarbs;

      const esc = v => {
        if (v == null || v === '') return '';
        const s = String(v);
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      // Transposed: column A = metric label, columns B… = one per date (ascending).
      // Row 1 = date header row (A1 empty).
      // The date axis is the union of daily logs, cardio and sessions, not the
      // daily logs alone: a day with a workout or a run but no daily-log row
      // (nothing weighed, no macros typed) used to vanish from the export
      // entirely, so the training and cardio columns silently under-reported.
      const byDate = {};
      logs.forEach(l => { byDate[l.date] = l; });
      const dates = [...new Set([
        ...logs.map(l => l.date),
        ...Object.keys(cardio).filter(d => d >= from && d <= to),
        ...Object.keys(sessions).filter(d => d >= from && d <= to),
      ])].sort();
      // Metric fns read l.<field>, so days without a daily log need a stub row
      // rather than undefined.
      dates.forEach(d => { if (!byDate[d]) byDate[d] = { date: d }; });

      const metrics = [
        { label: `Weight (${unit})`, fn: l => l.weight },
        { label: 'Steps',            fn: l => l.steps },
        { label: 'Calories (kcal)',  fn: l => l.calories },
        { label: 'Protein (g)',      fn: l => l.protein },
        { label: 'Carbs (g)',        fn: l => l.carbs },
        netCarbs ? { label: 'Fiber (g)', fn: l => l.fiber } : null,
        { label: 'Fat (g)',          fn: l => l.fat },
        { label: 'Water (ml)',        fn: l => l.waterMl != null ? l.waterMl : null },
        { label: 'Adherence (%)',    fn: l => l.adherence != null ? Math.round(l.adherence) : null },
        { label: 'Cardio (min)',     fn: l => cardio[l.date]?.min || null },
        { label: 'Cardio dist (m)',
          fn: l => cardio[l.date]?.distM != null ? Math.round(cardio[l.date].distM) : null },
        { label: 'Training',         fn: l => (sessions[l.date] || []).map(s => s.dayName || s.day_name || '').filter(Boolean).join(', ') || 'REST' },
        { label: 'Training (min)',   fn: l => (sessions[l.date] || []).reduce((sum, s) => sum + (s.durationMinutes || s.duration_minutes || 0), 0) || null },
        { label: 'Note',             fn: l => l.note || null },
        { label: 'Off-plan note',    fn: l => l.offPlanNote || null },
      ].filter(Boolean);

      const headerRow = ['', ...dates].map(esc).join(',');
      const metricRows = metrics.map(m =>
        [m.label, ...dates.map(d => m.fn(byDate[d]))].map(esc).join(',')
      );

      const csv = [headerRow, ...metricRows].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `health-${from}-${to}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onClose();
    } finally {
      setExporting(null);
    }
  };

  const doExportPDF = () => {
    setExporting('pdf');
    try {
      const logs = logsInRange();
      const cardio = cardioByDay();
      const sessions = sessionsByDay();
      const unit = (store.settings?.unit === 'lbs') ? 'lbs' : 'kg';
      // This export builds its own fixed dark card design regardless of the
      // live app theme (cardBg/inkText/etc below are all hardcoded too), so
      // it needs the user's raw accent color, not paper's muted grey which
      // would go low-contrast against this always-dark card.
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-raw').trim() || '#c9a961';
      const cardBg  = '#201e2c';
      const inkText = '#e5e2ef';
      const inkSoft = '#9b97a8';
      const inkFaint= '#5c5969';
      const hairDiv = '#3d3a4e';
      const adhColor = adh => adh == null ? inkFaint : adh >= 90 ? '#22c55e' : adh >= 75 ? '#d97706' : '#ef4444';

      const cardsHtml = logs.length === 0
        ? `<p style="color:${inkFaint};font-size:14px;text-align:center;padding:40px">No data in this range.</p>`
        : logs.map(l => {
          const date = new Date(l.date + 'T12:00:00');
          const dateLabel = date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
          const cardioMin = cardio[l.date]?.min;
          const adh = l.adherence != null ? Math.round(l.adherence) : null;
          const daySessions = sessions[l.date] || [];
          const trained = daySessions.length > 0;
          const hasCardio = !!cardioMin;
          const ac = adhColor(adh);

          const stat = (label, value, unit) => value != null
            ? `<div style="text-align:center;min-width:0">
                 <div style="font-size:17px;font-weight:300;color:${inkText};font-family:monospace">${value}${unit ? `<span style="font-size:9px;color:${inkFaint};margin-left:2px">${unit}</span>` : ''}</div>
                 <div style="font-size:8px;text-transform:uppercase;letter-spacing:0.08em;color:${inkFaint};margin-top:2px">${label}</div>
               </div>`
            : '';

          const badge = (icon, label) =>
            `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);font-size:9px;letter-spacing:0.07em;text-transform:uppercase;color:${inkSoft}">
               <span>${icon}</span>${label}
             </span>`;

          const adhBar = adh != null
            ? `<div style="margin-bottom:12px">
                 <div style="display:flex;align-items:center;gap:8px">
                   <div style="height:4px;flex:1;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact">
                     <div style="height:100%;width:${Math.min(100, adh)}%;background:${ac};border-radius:999px"></div>
                   </div>
                   <span style="font-size:10px;color:${ac};font-weight:700;font-family:monospace;flex-shrink:0">${adh}%</span>
                 </div>
               </div>`
            : '';

          const sessionNames = daySessions.map(s => s.dayName || s.day_name || '').filter(Boolean).join(', ');
          const sessionDur = daySessions.reduce((sum, s) => sum + (s.durationMinutes || s.duration_minutes || 0), 0);

          return `<div style="background:${cardBg};border:1px solid ${hairDiv};border-radius:8px;padding:14px 16px;margin-bottom:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${inkText};margin-bottom:${(trained || hasCardio) ? 8 : 12}px">${dateLabel}</div>
            ${(trained || hasCardio) ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:${sessionNames ? 6 : 10}px">${trained ? badge('🏋', sessionNames ? `${sessionNames}${sessionDur ? ` · ${sessionDur} min` : ''}` : 'Trained') : ''}${hasCardio ? badge('🏃', 'Cardio') : ''}</div>` : ''}
            ${adhBar}
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px 6px">
              ${stat(`Weight (${unit})`, l.weight)}
              ${stat('Steps', l.steps != null ? l.steps.toLocaleString() : null)}
              ${stat('Cardio', cardioMin || null, 'min')}
              ${stat('Water', l.waterMl != null ? (UI.waterInFloz() ? String(UI.waterSummaryValue(l.waterMl)) : (Math.round(l.waterMl / 100) / 10).toFixed(1)) : null, UI.waterSummaryUnit())}
              ${stat('Calories', l.calories, 'kcal')}
              ${stat('Protein', l.protein, 'g')}
              ${stat('Carbs', l.carbs, 'g')}
              ${stat('Fat', l.fat, 'g')}
            </div>
            ${l.note || l.offPlanNote ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid ${hairDiv};font-size:11px;color:${inkSoft};line-height:1.5">${[l.note, l.offPlanNote].filter(Boolean).join(' · ')}</div>` : ''}
          </div>`;
        }).join('');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <title>Health Export ${from} – ${to}</title>
        <style>
          *{margin:0;padding:0;box-sizing:border-box}
          @page{margin:12mm}
          body{font-family:system-ui,-apple-system,sans-serif;background:#fff;padding:0;max-width:600px;margin:0 auto}
        </style>
      </head><body>
        <div style="background:${cardBg};border:1px solid ${hairDiv};border-radius:6px;padding:8px 20px;margin-bottom:14px;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact">
          <span style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};font-weight:700">Health &middot; ${from} &ndash; ${to}</span>
        </div>
        ${cardsHtml}
        <script>
          var isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent)&&!window.MSStream;
          if(!isIOS){window.onload=function(){window.print()};}
        <\/script>
      </body></html>`;

      const blob = new Blob([html], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
      onClose();
    } finally {
      setExporting(null);
    }
  };

  const presets = [
    { label: '7 days',  days: 7 },
    { label: '30 days', days: 30 },
    { label: '90 days', days: 90 },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Export">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        <div>
          <div className="label" style={{ color: UI.inkFaint, marginBottom: 8 }}>TIME RANGE</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {presets.map(p => (
              <button key={p.days} onClick={() => applyPreset(p.days)} style={{
                flex: 1, padding: '7px 4px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
                background: from === LB.shiftDate(today, -(p.days - 1)) && to === today ? 'var(--accent)' : UI.bgInset,
                color: from === LB.shiftDate(today, -(p.days - 1)) && to === today ? 'var(--accent-ink)' : UI.inkSoft,
                textShadow: 'none',
                fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}>{p.label}</button>
            ))}
          </div>
          {/* Two native date inputs in one row, which needs both halves of the
              same fix the rest of the app already applies to them:

              WebkitAppearance none, because iOS keeps a date input at the
              intrinsic width of its own shadow DOM while the native appearance
              is on, no matter what width you give it. That is what pushed the
              TO field out past every other control in this sheet. Water's
              wtInput and the plan editor's dateInputStyle both carry it, which
              is why their date rows never had the problem.

              minWidth 0, because a flex item defaults to min-width auto and
              cannot shrink below its content either way. The arrow keeps its
              own width rather than absorbing the squeeze.

              colorScheme so the native picker matches the theme, same
              expression the water screen uses. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="label" style={{ color: UI.inkFaint, marginBottom: 4 }}>FROM</div>
              <input type="date" value={from} max={to}
                onChange={e => e.target.value && setFrom(e.target.value)}
                style={dateInputStyle} />
            </div>
            <div style={{ color: UI.inkFaint, fontSize: 11, paddingTop: 16, flexShrink: 0 }}>→</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="label" style={{ color: UI.inkFaint, marginBottom: 4 }}>TO</div>
              <input type="date" value={to} min={from} max={today}
                onChange={e => e.target.value && setTo(e.target.value)}
                style={dateInputStyle} />
            </div>
          </div>
          {(() => {
            // Field content, not row existence (L8, audit-2026-08): a bare
            // row count double-counted a day whose only zane_daily_logs row
            // is the phantom one AiSummaryCard.generate() leaves behind for
            // a training/cardio-only day (id/date/aiSummary, nothing else).
            const count = logsInRange().filter(hlHasLogContent).length;
            return <div style={{ marginTop: 8, fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>{count} day{count !== 1 ? 's' : ''} logged in this range</div>;
          })()}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={doExportCSV} disabled={!!exporting} style={{
            width: '100%', padding: '13px 0', borderRadius: 6, border: `var(--hair-width) solid ${UI.hairStrong}`,
            background: UI.bgInset, color: exporting ? UI.inkGhost : UI.ink,
            textShadow: 'none',
            fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, cursor: exporting ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <i className="fa-solid fa-file-csv" style={{ fontSize: 13 }} />
            {exporting === 'csv' ? 'Exporting…' : 'Export as CSV'}
          </button>
          {/* Only offered once there is a food log to export: for a user who
              only ever types macros into the daily log this button would be a
              permanently empty file. */}
          {(store.foodLogs || []).length > 0 && (
            <button onClick={doExportFoodCSV} disabled={!!exporting} style={{
              width: '100%', padding: '13px 0', borderRadius: 6, border: `var(--hair-width) solid ${UI.hairStrong}`,
              background: UI.bgInset, color: exporting ? UI.inkGhost : UI.ink,
              textShadow: 'none',
              fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, cursor: exporting ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              WebkitTapHighlightColor: 'transparent',
            }}>
              <i className="fa-solid fa-utensils" style={{ fontSize: 13 }} />
              {exporting === 'food' ? 'Exporting…' : 'Export food log as CSV'}
            </button>
          )}
          <button onClick={doExportPDF} disabled={!!exporting} style={{
            width: '100%', padding: '13px 0', borderRadius: 6, border: 'none',
            background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
            boxShadow: '0 6px 20px rgba(var(--accent-rgb),0.35)',
            color: 'var(--accent-ink)', textShadow: 'none',
            fontFamily: UI.fontUi, fontSize: 13, fontWeight: 700, cursor: exporting ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            WebkitTapHighlightColor: 'transparent',
            opacity: exporting ? 0.6 : 1,
          }}>
            <i className="fa-solid fa-file-pdf" style={{ fontSize: 13 }} />
            {exporting === 'pdf' ? 'Opening…' : 'Export as PDF'}
          </button>
        </div>

      </div>
    </Sheet>
  );
}

// ─── Register ─────────────────────────────────────────────────────────────────

window.Screens = window.Screens || {};
Object.assign(window.Screens, { HealthScreen, HealthClientLogs });
