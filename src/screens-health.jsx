/* Health screen — daily weight / steps / macros logging + dashboard charts.
   Optional tab (settings → showHealthTab). Daily logs live in store.dailyLogs
   and sync through the same diff model as cardio logs (UI mutates via setStore;
   store.js syncStore writes them). Adherence is computed + persisted at save
   time (LB.dailyLogAdherence) so a later macro-target change never rewrites
   history. Shares globals (UI, Screen, Sheet, Btn, WEEKDAYS, LB, React). */

const { useState: useStateH, useEffect: useEffectH, useMemo: useMemoH, useRef: useRefH } = React;

// ─── helpers ────────────────────────────────────────────────────────────────

const HEALTH_TFS = [{ id: '1W', days: 7 }, { id: '1M', days: 30 }, { id: '3M', days: 90 }];

// Whole-day difference between two 'YYYY-MM-DD' dates (b − a), noon-anchored to
// dodge DST/midnight shifts.
function healthDayDiff(a, b) {
  return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
}

function healthShiftISO(base, days) {
  const d = new Date(base + 'T12:00:00'); d.setDate(d.getDate() + days);
  return LB.fmtISO(d);
}

// [start, end] ISO bounds for a trailing N-day window ending today.
function healthWindow(days) {
  const end = LB.todayISO();
  return { start: healthShiftISO(end, -(days - 1)), end };
}

// [start, end] ISO bounds for the Mon-Sun calendar week containing `anchor`.
// Same formula as HealthDateStrip/computeHealthWeekStats use for the top date
// strip and "This Week" card, factored out so the 1W charts below can share
// it instead of quietly using a trailing 7-day window that floats with
// today's weekday and never lines up with the Monday-anchored week above it.
function healthMondayWeekBounds(anchor) {
  const jsDow = new Date(anchor + 'T12:00:00').getDay();
  const monday = healthShiftISO(anchor, -((jsDow === 0 ? 7 : jsDow) - 1));
  return { start: monday, end: healthShiftISO(monday, 6) };
}

const healthNum = v => (v === '' || v == null || isNaN(parseFloat(v))) ? null : parseFloat(String(v).replace(',', '.'));
const healthInt = v => (v === '' || v == null || isNaN(parseInt(v, 10))) ? null : parseInt(v, 10);

const caloriesFromMacros = LB.caloriesFromMacros;

function healthFmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', opts);
}

// Windowed series builder for the charts — pure, so HealthScreen (dailyLogs)
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
  if (from === to) { from = healthShiftISO(from, -1); to = healthShiftISO(to, 1); }
  return { from, to, data };
}

function healthCardioSeries(cardioLogs, days, windowOverride) {
  const { start, end } = windowOverride || healthWindow(days);
  const byDay = {};
  (cardioLogs || []).forEach(l => { if (l.date >= start && l.date <= end) byDay[l.date] = (byDay[l.date] || 0) + (l.durationMinutes || 0); });
  const data = Object.keys(byDay).map(date => ({ date, value: byDay[date] }));
  const dates = data.map(d => d.date);
  let from = dates.length ? dates.reduce((a, b) => a < b ? a : b) : start;
  let to = dates.length ? dates.reduce((a, b) => a > b ? a : b) : end;
  if (from === to) { from = healthShiftISO(from, -1); to = healthShiftISO(to, 1); }
  return { from, to, data };
}

// Period overview (Mon-anchored week or rolling 1M/3M window) — pure, shared
// by HealthScreen and HealthClientLogs. planningState is whatever
// LB.plannedTrainingDay needs (store, or clientStore || {}).
function computeHealthWeekStats({ logs, sessions, cardioLogs, planningState, tf, today, selectedDate }) {
  const dayOf = s => s.date ? (typeof s.date === 'string' ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10)) : null;
  let from, to, periodDays;
  if (tf === '1W') {
    const anchor = selectedDate;
    const jsDow = new Date(anchor + 'T12:00:00').getDay();
    const monday = healthShiftISO(anchor, -((jsDow === 0 ? 7 : jsDow) - 1));
    from = monday; to = healthShiftISO(monday, 6); periodDays = 7;
  } else {
    const days = (HEALTH_TFS.find(t => t.id === tf) || HEALTH_TFS[1]).days;
    to = today; from = healthShiftISO(today, -(days - 1)); periodDays = days;
  }
  const allDays = Array.from({ length: periodDays }, (_, i) => healthShiftISO(from, i));
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

// Scatter chart: one point per reading, connected by a thin trend line (unlike
// glucose, temperature has no fasted/fed context split, so its reading-to-
// reading trend is itself the meaningful signal). No reference band: a
// "normal" body temperature varies by measurement method and time of day, so a
// fixed band here would overclaim precision a home reading can't guarantee.
function TempScatterChart({ readings, from, to, unit }) {
  const pts = (readings || []).filter(r => r.valueC != null && r.date >= from && r.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  if (!pts.length) return <HealthChartEmpty />;
  const W = 320, padL = 34, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;

  const dispVals = pts.map(p => tempDisplay(p.valueC, unit));
  const dom = UI.chartDomain(Math.min(...dispVals), Math.max(...dispVals));
  const totalDays = Math.max(1, healthDayDiff(from, to));
  const xOf = d => padL + (healthDayDiff(from, d) / totalDays) * plotW;
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  const dec = dom.range >= 4 ? 0 : 1;
  const gridVals = dom.gridVals || Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const unitLabel = tempUnitLabel(unit);
  const hoverPoints = pts.map(p => {
    const disp = tempDisplay(p.valueC, unit);
    return { x: xOf(p.date), y: yOf(disp), date: p.date, rows: [{ value: `${disp}${unitLabel}` }], sub: p.time };
  });

  return (
    <ChartHover W={W} H={H} points={hoverPoints}>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{Number(v.toFixed(dec))}</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {pts.length >= 2 && (
        <polyline points={pts.map(p => `${xOf(p.date).toFixed(1)},${yOf(tempDisplay(p.valueC, unit)).toFixed(1)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity="0.5" />
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={xOf(p.date).toFixed(1)} cy={yOf(tempDisplay(p.valueC, unit)).toFixed(1)} r={3} fill="var(--accent)" opacity={0.85} />
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
function BpScatterChart({ readings, from, to }) {
  const pts = (readings || []).filter(r => r.systolic != null && r.diastolic != null && r.date >= from && r.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  if (!pts.length) return <HealthChartEmpty />;
  const W = 320, padL = 34, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;

  const allVals = pts.flatMap(p => [p.systolic, p.diastolic]);
  const dom = UI.chartDomain(Math.min(...allVals, BP_REF_DIA), Math.max(...allVals, BP_REF_SYS));
  const totalDays = Math.max(1, healthDayDiff(from, to));
  const xOf = d => padL + (healthDayDiff(from, d) / totalDays) * plotW;
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  const gridVals = dom.gridVals || Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const SYS_COLOR = 'var(--accent)', DIA_COLOR = '#4a9fe0';
  const hoverPoints = pts.map(p => ({
    x: xOf(p.date), y: yOf(p.systolic), date: p.date,
    rows: [
      { label: 'SYS', value: `${p.systolic} mmHg`, color: SYS_COLOR },
      { label: 'DIA', value: `${p.diastolic} mmHg`, color: DIA_COLOR },
    ],
    sub: p.time,
  }));

  return (
    <ChartHover W={W} H={H} points={hoverPoints} mode="xy">
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      <line x1={padL} y1={yOf(BP_REF_SYS).toFixed(1)} x2={W - padR} y2={yOf(BP_REF_SYS).toFixed(1)} stroke={SYS_COLOR} strokeWidth="0.75" strokeDasharray="4 3" opacity="0.5" />
      <line x1={padL} y1={yOf(BP_REF_DIA).toFixed(1)} x2={W - padR} y2={yOf(BP_REF_DIA).toFixed(1)} stroke={DIA_COLOR} strokeWidth="0.75" strokeDasharray="4 3" opacity="0.5" />
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{Math.round(v)}</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {pts.map((p, i) => (
        <React.Fragment key={i}>
          <line x1={xOf(p.date).toFixed(1)} y1={yOf(p.systolic).toFixed(1)} x2={xOf(p.date).toFixed(1)} y2={yOf(p.diastolic).toFixed(1)} stroke={UI.hair} strokeWidth="1" />
          <circle cx={xOf(p.date).toFixed(1)} cy={yOf(p.systolic).toFixed(1)} r={3} fill={SYS_COLOR} opacity={0.85} />
          <circle cx={xOf(p.date).toFixed(1)} cy={yOf(p.diastolic).toFixed(1)} r={3} fill={DIA_COLOR} opacity={0.85} />
        </React.Fragment>
      ))}
    </svg>
    </ChartHover>
  );
}

// Scatter chart: one point per reading, coloured by context, with a reference
// band for the fasting normal range (3.9–5.6 mmol/L).
function GlucoseScatterChart({ readings, from, to, unit }) {
  const pts = (readings || []).filter(r => r.valueMmol != null && r.date >= from && r.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  if (!pts.length) return <HealthChartEmpty />;
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
  const xOf = d => padL + (healthDayDiff(from, d) / totalDays) * plotW;
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  const dec = dom.range >= (unit === 'mgdl' ? 40 : 2) ? 0 : 1;
  const gridVals = Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const CTX_COLORS = { fasted: 'var(--accent)', fed: '#4a9fe0', other: UI.inkSoft };
  const CTX_LABELS = { fasted: 'Fasted', fed: 'Fed', other: 'Other' };
  const unitLabel = glucoseUnitLabel(unit);
  const fedY = yOf(refFed).toFixed(1);
  const hoverPoints = pts.map(p => {
    const disp = glucoseDisplay(p.valueMmol, unit);
    return {
      x: xOf(p.date), y: yOf(disp), date: p.date, color: CTX_COLORS[p.context] || UI.inkSoft,
      rows: [{ value: `${disp} ${unitLabel}`, color: CTX_COLORS[p.context] || UI.inkSoft }],
      sub: [CTX_LABELS[p.context] || p.context, p.time].filter(Boolean).join(' · '),
    };
  });

  return (
    <ChartHover W={W} H={H} points={hoverPoints} mode="xy">
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* fasted reference band */}
      <rect x={padL} y={yOf(refHigh).toFixed(1)} width={plotW} height={(yOf(refLow) - yOf(refHigh)).toFixed(1)}
        fill="rgba(var(--accent-rgb),0.07)" />
      {/* fed upper reference line */}
      <line x1={padL} y1={fedY} x2={W - padR} y2={fedY} stroke="#4a9fe0" strokeWidth="0.75" strokeDasharray="4 3" opacity="0.5" />
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{Number(v.toFixed(dec))}</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {pts.map((p, i) => {
        const disp = glucoseDisplay(p.valueMmol, unit);
        return <circle key={i} cx={xOf(p.date).toFixed(1)} cy={yOf(disp).toFixed(1)} r={3}
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
function ChartHover({ W, H, points, children, mode = 'x', markerColor = 'var(--accent)' }) {
  const wrapRef = useRefH(null);
  const [active, setActive] = useStateH(null);

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
      {!p && points.length > 0 && (
        <div style={{ position: 'absolute', top: 2, right: 4, pointerEvents: 'none' }}>
          <span className="micro" style={{ color: UI.inkGhost, letterSpacing: '0.08em' }}>Drag to inspect</span>
        </div>
      )}
      {p && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: leftPct + '%', top: (CHART_PLOT_TOP / H) * 100 + '%', height: (CHART_PLOT_H / H) * 100 + '%', width: 1, background: UI.hairStrong, transform: 'translateX(-0.5px)' }} />
          <div style={{ position: 'absolute', left: leftPct + '%', top: topPct + '%', width: 8, height: 8, borderRadius: '50%', background: p.color || markerColor, border: `2px solid ${UI.bgRaised}`, boxShadow: `0 0 0 1.5px ${p.color || markerColor}`, transform: 'translate(-50%, -50%)' }} />
          <div style={{ position: 'absolute', left: leftPct + '%', top: topPct + '%', transform: `translate(${tx}, ${ty})`, background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '5px 8px', boxShadow: '0 4px 14px rgba(0,0,0,0.45)', whiteSpace: 'nowrap', zIndex: 5 }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 2 }}>{healthFmtDate(p.date)}</div>
            {p.rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontFamily: UI.fontNum, fontSize: 12, lineHeight: 1.35 }}>
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
function HealthChartCard({ title, icon, tf, setTf, headline, sub, dragHandle, onExpand, children }) {
  return (
    <Card style={{ padding: 14, borderLeft: `3px solid ${UI.gold}` }}>
      {/* flexWrap + the toggle's flexShrink:0 let the TF toggle drop to its own
          line instead of clipping when the card is narrow (2-col grid) — full-
          width cards stay single-line since everything already fits there. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        {dragHandle}
        {icon && <i className={`fa-solid ${icon}`} style={{ fontSize: 11, color: UI.inkFaint }} />}
        <span style={{ ...HEALTH_CARD_HEADER_STYLE, flex: 1, minWidth: 60 }}>{title}</span>
        {onExpand && (
          <button data-reorder-ignore="true" onClick={onExpand} aria-label="Expand" style={{
            background: 'transparent', border: 'none', padding: 2, cursor: 'pointer',
            color: UI.inkFaint, display: 'flex', alignItems: 'center', flexShrink: 0,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <i className="fa-solid fa-expand" style={{ fontSize: 11 }} />
          </button>
        )}
        <div data-reorder-ignore="true" style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}`, flexShrink: 0 }}>
          {HEALTH_TFS.map(t => (
            <button key={t.id} onClick={() => setTf(t.id)} style={{
              padding: '2px 8px', cursor: 'pointer', border: 'none',
              background: tf === t.id ? 'var(--accent)' : 'transparent',
              color: tf === t.id ? '#0a0805' : UI.inkFaint,
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
function HealthLineChart({ series, from, to, format, color = 'var(--accent)', yMin, yMax, step }) {
  const pts = (series || []).filter(p => p.value != null).sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return <HealthChartEmpty />;
  const W = 320, padL = 38, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;
  const vals = pts.map(p => p.value);
  const dom = step
    ? UI.niceStepDomain(Math.min(...vals), Math.max(...vals), step, { min: yMin, max: yMax })
    : UI.chartDomain(Math.min(...vals), Math.max(...vals), { min: yMin, max: yMax });
  const totalDays = Math.max(1, healthDayDiff(from, to));
  const xOf = d => padL + (totalDays ? healthDayDiff(from, d) / totalDays : 0.5) * plotW;
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  // A fractional step (2.5 kg) needs 1 decimal to show the .5; a whole step
  // (5 lb) never produces one, so it can stay the old range-based heuristic.
  const dec = step ? (Number.isInteger(step) ? 0 : 1) : (dom.range >= 4 ? 0 : 1);
  const gridVals = dom.gridVals || Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const line = pts.map(p => `${xOf(p.date).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ');
  const base = (padTop + plotH).toFixed(1);
  const hoverPoints = pts.map(p => ({ x: xOf(p.date), y: yOf(p.value), date: p.date, rows: [{ value: format(p.value) }] }));

  return (
    <ChartHover W={W} H={H} points={hoverPoints} markerColor={color}>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{format(Number(v.toFixed(dec)))}</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {pts.length >= 2 && (
        <>
          <polygon points={`${xOf(pts[0].date).toFixed(1)},${base} ${line} ${xOf(pts[pts.length - 1].date).toFixed(1)},${base}`} fill={`rgba(var(--accent-rgb),0.10)`} />
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
  // into the y-axis labels or right edge — matters most in the 1W view.
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
          <text x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{format(Math.round(v))}</text>
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
const MACRO_COLORS = { protein: 'var(--accent)', carbs: 'var(--ok)', fat: 'var(--danger)' };
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
  // into the y-axis labels or right edge — matters most in the 1W view.
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
          <text x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{Math.round(v / 100) / 10}k</text>
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

// ─── Daily log sheet ──────────────────────────────────────────────────────────

// One card per category: clickable chevron header, optional right-aligned
// extra content (a unit tag, a toggle) that doesn't itself trigger the
// collapse, and its fields below when expanded. Defined at module scope
// (not inside DailyLogSheet) so its function identity is stable across
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

function DailyLogSheet({ open, onClose, store, setStore, date, targets, activeCoachingSchema, onSetStatus, userId, glucoseLogs, glucoseUnit, bloodPressureLogs, bodyTempLogs, tempUnit }) {
  // Always-current store snapshot: saveTemp's fever nudge awaits a Supabase
  // write and then a user-interaction-gated confirm dialog, both arbitrarily
  // long, so it re-reads statusMode from this ref (not the closed-over
  // `store` prop) right before mutating it, to notice a status change made
  // elsewhere in this same sheet while that wait was in flight.
  const storeRef = useRefH(store);
  storeRef.current = store;
  const existing = useMemoH(() => (store.dailyLogs || []).find(l => l.date === date), [store.dailyLogs, date]);
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
  const empty = { weight: '', steps: '', protein: '', carbs: '', fat: '', fiber: '', calories: '', water: '', note: '', offPlanNote: '' };
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
        if (error && origEntry) setStore(s => ({ ...s, bloodPressureLogs: (s.bloodPressureLogs || []).map(l => l.id === editingBpId ? origEntry : l) }));
      } else {
        const entry = { id: LB.uid(), date, time, systolic: sys, diastolic: dia, note: bpForm.note.trim() || null, createdAt: new Date().toISOString() };
        setStore(s => ({ ...s, bloodPressureLogs: [entry, ...(s.bloodPressureLogs || [])] }));
        setAddingBp(false); setBpForm(emptyBp);
        const { error } = await LB.supabase.from('zane_blood_pressure_logs').insert({ id: entry.id, user_id: userId, date: entry.date, time: entry.time, systolic: entry.systolic, diastolic: entry.diastolic, note: entry.note });
        if (error) setStore(s => ({ ...s, bloodPressureLogs: (s.bloodPressureLogs || []).filter(l => l.id !== entry.id) }));
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
    if (error && orig) setStore(s => ({ ...s, bloodPressureLogs: [orig, ...(s.bloodPressureLogs || [])] }));
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
        if (error) { ok = false; if (origEntry) setStore(s => ({ ...s, bodyTempLogs: (s.bodyTempLogs || []).map(l => l.id === editingTempId ? origEntry : l) })); }
      } else {
        const entry = { id: LB.uid(), date, time, valueC: c, note: tempForm.note.trim() || null, createdAt: new Date().toISOString() };
        setStore(s => ({ ...s, bodyTempLogs: [entry, ...(s.bodyTempLogs || [])] }));
        setAddingTemp(false); setTempForm(emptyTemp);
        const { error } = await LB.supabase.from('zane_body_temp_logs').insert({ id: entry.id, user_id: userId, date: entry.date, time: entry.time, value_c: entry.valueC, note: entry.note });
        if (error) { setStore(s => ({ ...s, bodyTempLogs: (s.bodyTempLogs || []).filter(l => l.id !== entry.id) })); ok = false; }
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
    if (error && orig) setStore(s => ({ ...s, bodyTempLogs: [orig, ...(s.bodyTempLogs || [])] }));
  };

  const saveGlucose = async () => {
    const mmol = glucoseFromInput(glForm.value, glUnit);
    if (mmol == null) return;
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
      if (error && origEntry) setStore(s => ({ ...s, glucoseLogs: (s.glucoseLogs || []).map(l => l.id === editingGlucoseId ? origEntry : l) }));
    } else {
      const entry = { id: LB.uid(), date, time, valueMmol: mmol, context: glForm.context || 'fasted', note: glForm.note.trim() || null, createdAt: new Date().toISOString() };
      setStore(s => ({ ...s, glucoseLogs: [entry, ...(s.glucoseLogs || [])] }));
      setAddingGlucose(false); setGlForm(emptyGl);
      const { error } = await LB.supabase.from('zane_glucose_logs').insert({ id: entry.id, user_id: userId, date: entry.date, time: entry.time, value_mmol: entry.valueMmol, context: entry.context, note: entry.note });
      if (error) setStore(s => ({ ...s, glucoseLogs: (s.glucoseLogs || []).filter(l => l.id !== entry.id) }));
    }
  };

  const deleteGlucose = async (id) => {
    setConfirmDeleteGlId(null);
    const orig = (store.glucoseLogs || []).find(l => l.id === id);
    setStore(s => ({ ...s, glucoseLogs: (s.glucoseLogs || []).filter(l => l.id !== id) }));
    const { error } = await LB.supabase.from('zane_glucose_logs').delete().eq('id', id).eq('user_id', userId);
    if (error && orig) setStore(s => ({ ...s, glucoseLogs: [orig, ...(s.glucoseLogs || [])] }));
  };

  useEffectH(() => {
    if (!open) return;
    const net = existing?.fiber != null ? true : !!store.settings?.netCarbs;
    setNetCarbs(net);
    // Blank the calories field when the saved value matches what the saved
    // macros alone would produce — so it keeps auto-updating live as macros
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
    const protein = healthInt(form.protein), carbs = healthInt(form.carbs), fat = healthInt(form.fat);
    const fiber = netCarbs ? healthInt(form.fiber) : null;
    const calories = form.calories !== '' ? healthInt(form.calories) : autoCals;
    // Single source of truth for the day type: a logged session wins, then a
    // flex Training|Rest override (set from the header), then cycle/week's
    // planned-day assumption (flex defaults to rest).
    const isTraining = LB.isTrainingDayForDate(store, date);
    let { adherence, targetsSnap } = dayMode
      ? { adherence: null, targetsSnap: null }
      : LB.dailyLogAdherence({ protein, carbs, fat }, targets, isTraining);
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
      calories, protein, carbs, fat, fiber,
      waterMl: healthInt(form.water) != null ? UI.waterEntryToMl(healthInt(form.water)) : null,
      note: form.note.trim() || null,
      adherence, targetsSnap,
      offPlanNote: form.offPlanNote.trim() || null,
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

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', background: UI.bgInset,
    border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4,
    padding: '10px 12px', fontFamily: UI.fontNum, fontSize: 15, color: UI.ink, outline: 'none',
  };
  const labelStyle = { fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.07em' };
  const numField = (k, label, unit) => (
    <div style={{ flex: 1 }}>
      <div style={labelStyle}>{label}{unit ? ` (${unit})` : ''}</div>
      <input type="text" inputMode="decimal" placeholder="—" value={form[k]} onChange={e => set(k, e.target.value)} style={inputStyle} />
    </div>
  );

  return (
    <Sheet open={open} onClose={requestClose} title={existing ? 'Edit Day' : 'Log Day'}>
      {confirmEl}
      <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 14 }}>
        {healthFmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>

      {onSetStatus && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}` }}>
            {[{ mode: 'sick', label: 'Sick', icon: 'fa-bed-pulse' }, { mode: null, label: 'Normal', icon: null }, { mode: 'vacation', label: 'Vacation', icon: 'fa-umbrella-beach' }].map(({ mode, label, icon }, i) => {
              const active = dayMode === mode;
              return (
                <button key={String(mode)} onClick={() => onSetStatus(mode, date < todayISO ? date : null)} style={{
                  flex: 1, padding: '12px 4px', cursor: 'pointer', border: 'none',
                  borderLeft: i > 0 ? `0.5px solid ${UI.hairStrong}` : 'none',
                  background: active ? 'var(--accent)' : 'transparent',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                  WebkitTapHighlightColor: 'transparent', transition: 'background 0.15s',
                }}>
                  {icon && <i className={`fa-solid ${icon}`} style={{ fontSize: 13, color: active ? '#0a0805' : UI.inkFaint }} />}
                  {!icon && <i className="fa-solid fa-circle-check" style={{ fontSize: 13, color: active ? '#0a0805' : UI.inkFaint }} />}
                  <span style={{ fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: active ? '#0a0805' : UI.inkFaint }}>{label}</span>
                </button>
              );
            })}
          </div>
          {dayMode && date === todayISO && (() => {
            const minDate = (() => { const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().slice(0, 10); })();
            const currentVal = store.statusModeSince ? store.statusModeSince.slice(0, 10) : todayISO;
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
        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}` }}>
          {[{ id: false, label: 'Total carbs' }, { id: true, label: 'Net carbs' }].map(o => (
            <button key={String(o.id)} onClick={() => setNetCarbs(o.id)} style={{
              padding: '4px 10px', cursor: 'pointer', border: 'none',
              background: netCarbs === o.id ? 'var(--accent)' : 'transparent',
              color: netCarbs === o.id ? '#0a0805' : UI.inkFaint,
              fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.05em',
              WebkitTapHighlightColor: 'transparent',
            }}>{o.label}</button>
          ))}
        </div>
      }>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {numField('protein', 'Protein', 'g')}
          {numField('carbs', 'Carbs', 'g')}
          {numField('fat', 'Fat', 'g')}
        </div>
        {netCarbs && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {numField('fiber', 'Fiber', 'g')}
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
          <input type="text" inputMode="decimal" placeholder={autoCals != null ? String(autoCals) : '—'} value={form.calories} onChange={e => set('calories', e.target.value)} style={inputStyle} />
        </div>
        <div>
          <div style={labelStyle}>Off-plan note <span style={{ textTransform: 'none', fontWeight: 400, color: UI.inkGhost }}>(optional · prefills check-in)</span></div>
          <textarea rows={2} placeholder="e.g. Birthday cake, 2 slices" value={form.offPlanNote} onChange={e => set('offPlanNote', e.target.value)} style={{ ...inputStyle, resize: 'none', fontFamily: UI.fontUi, fontSize: 14 }} />
        </div>
      </CatSection>

      <CatSection label="HYDRATION" collapsed={collapsedCats.has('hydration')} onToggle={() => toggleCat('hydration')}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          {numField('water', 'Water', UI.waterEntryUnit())}
          {UI.waterQuickAdds().map(inc => (
            <button key={inc} onClick={() => set('water', String((healthInt(form.water) || 0) + inc))} style={{
              padding: '10px 12px', borderRadius: 4, border: `0.5px solid ${UI.hairStrong}`, background: UI.bgInset,
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', WebkitTapHighlightColor: 'transparent',
            }}>+{inc}</button>
          ))}
        </div>
      </CatSection>

      <CatSection label="NOTE" collapsed={collapsedCats.has('note')} onToggle={() => toggleCat('note')}>
        <textarea rows={2} placeholder="…" value={form.note} onChange={e => set('note', e.target.value)} style={{ ...inputStyle, resize: 'none', fontFamily: UI.fontUi, fontSize: 14 }} />
      </CatSection>

      <CatSection label="GLUCOSE" collapsed={collapsedCats.has('glucose')} onToggle={() => toggleCat('glucose')} extra={
        <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi }}>{glucoseUnitLabel(glUnit)}</span>
      }>
        {glucoseForDay.map(g => {
          const disp = glucoseDisplay(g.valueMmol, glUnit);
          const ctxColor = { fasted: 'var(--accent)', fed: '#4a9fe0', other: UI.inkSoft }[g.context] || UI.inkSoft;
          const isConfirm = confirmDeleteGlId === g.id;
          return (
            <div key={g.id} style={{ background: UI.bgInset, borderRadius: 6, marginBottom: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
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
                <div style={{ display: 'flex', gap: 0, borderTop: `0.5px solid ${UI.hairStrong}` }}>
                  <button onClick={() => setConfirmDeleteGlId(null)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft }}>Cancel</button>
                  <button onClick={() => deleteGlucose(g.id)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', borderLeft: `0.5px solid ${UI.hairStrong}`, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, color: UI.danger }}>Delete</button>
                </div>
              )}
            </div>
          );
        })}
        {addingGlucose ? (
          <div style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(() => {
              const glInputSt = { background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '7px 10px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' };
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
                    border: `0.5px solid ${glForm.context === c ? 'var(--accent)' : UI.hairStrong}`,
                    background: glForm.context === c ? 'var(--accent)' : 'transparent',
                    color: glForm.context === c ? '#0a0805' : UI.inkFaint,
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
          <button onClick={() => { setAddingGlucose(true); setEditingGlucoseId(null); }} style={{
            width: '100%', padding: '9px', background: UI.bgInset, border: `0.5px dashed ${UI.hairStrong}`, borderRadius: 6,
            color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>+ Add reading</button>
        )}
      </CatSection>

      <CatSection label="BLOOD PRESSURE" collapsed={collapsedCats.has('bloodPressure')} onToggle={() => toggleCat('bloodPressure')} extra={
        <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi }}>mmHg</span>
      }>
        {bpForDay.map(b => {
          const isConfirm = confirmDeleteBpId === b.id;
          return (
            <div key={b.id} style={{ background: UI.bgInset, borderRadius: 6, marginBottom: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
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
                <div style={{ display: 'flex', gap: 0, borderTop: `0.5px solid ${UI.hairStrong}` }}>
                  <button onClick={() => setConfirmDeleteBpId(null)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft }}>Cancel</button>
                  <button onClick={() => deleteBp(b.id)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', borderLeft: `0.5px solid ${UI.hairStrong}`, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, color: UI.danger }}>Delete</button>
                </div>
              )}
            </div>
          );
        })}
        {addingBp ? (
          <div style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(() => {
              const bpInputSt = { background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '7px 10px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' };
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
          <button onClick={() => { setAddingBp(true); setEditingBpId(null); }} style={{
            width: '100%', padding: '9px', background: UI.bgInset, border: `0.5px dashed ${UI.hairStrong}`, borderRadius: 6,
            color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>+ Add reading</button>
        )}
      </CatSection>

      <CatSection label="BODY TEMPERATURE" collapsed={collapsedCats.has('bodyTemp')} onToggle={() => toggleCat('bodyTemp')} extra={
        <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi }}>{tempUnitLabel(tUnit)}</span>
      }>
        {tempForDay.map(t => {
          const isConfirm = confirmDeleteTempId === t.id;
          return (
            <div key={t.id} style={{ background: UI.bgInset, borderRadius: 6, marginBottom: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
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
                <div style={{ display: 'flex', gap: 0, borderTop: `0.5px solid ${UI.hairStrong}` }}>
                  <button onClick={() => setConfirmDeleteTempId(null)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft }}>Cancel</button>
                  <button onClick={() => deleteTemp(t.id)} style={{ flex: 1, padding: '7px', background: 'none', border: 'none', borderLeft: `0.5px solid ${UI.hairStrong}`, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, color: UI.danger }}>Delete</button>
                </div>
              )}
            </div>
          );
        })}
        {addingTemp ? (
          <div style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(() => {
              const tInputSt = { background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '7px 10px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' };
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
          <button onClick={() => { setAddingTemp(true); setEditingTempId(null); }} style={{
            width: '100%', padding: '9px', background: UI.bgInset, border: `0.5px dashed ${UI.hairStrong}`, borderRadius: 6,
            color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>+ Add reading</button>
        )}
      </CatSection>

      {coachFields.length > 0 && (
        <div style={{ marginBottom: 18, padding: '14px 14px', borderRadius: 6, background: `rgba(var(--accent-rgb),0.05)`, border: `0.5px solid rgba(var(--accent-rgb),0.2)` }}>
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

      <div style={{ display: 'flex', gap: 8 }}>
        {existing && (
          <Btn kind="ghost" onClick={del} style={{ flex: 1 }}>Delete</Btn>
        )}
        <Btn onClick={save} disabled={!canSave} style={{ flex: 2 }}>{existing ? 'Save' : 'Log'}</Btn>
      </div>
    </Sheet>
  );
}

// ─── Macro target editor ────────────────────────────────────────────────────────

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

  const inputStyle = { width: '100%', boxSizing: 'border-box', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '9px 10px', fontFamily: UI.fontNum, fontSize: 15, color: UI.ink, outline: 'none' };
  const num = (k, lbl) => (
    <div style={{ flex: 1 }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>{lbl}</div>
      <input type="text" inputMode="numeric" placeholder="—" value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} style={inputStyle} />
    </div>
  );
  const section = (suffix, label, cals) => (
    <div style={{ marginBottom: 18 }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>{label}{cals != null ? ` · ${cals} kcal` : ''}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {num(`protein${suffix}`, 'Protein g')}
        {num(`carbs${suffix}`, 'Carbs g')}
        {num(`fat${suffix}`, 'Fat g')}
      </div>
    </div>
  );

  return (
    <Sheet open={open} onClose={requestClose} title="Macro Targets">
      {coachHasMacros && (
        <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: UI.fontUi, padding: '6px 10px', background: `rgba(var(--accent-rgb),0.08)`, borderRadius: 6, border: `0.5px solid rgba(var(--accent-rgb),0.2)`, marginBottom: 14 }}>
          Your coaching macros are active and take priority. These personal targets apply only if the coaching macros are removed.
        </div>
      )}
      {section('Training', 'TRAINING DAY', calsTraining)}
      {section('Rest', 'REST DAY', calsRest)}
      <Btn onClick={save} style={{ width: '100%' }}>Save Targets</Btn>
      {confirmEl}
    </Sheet>
  );
}

// ─── Today / selected-day metrics card ────────────────────────────────────────

function HealthMetricsCard({ log, dateLabel, isToday, onJumpToday, dragHandle, trained, hasCardio, dayTarget, isStatusDay, weightUnit }) {
  // Coach view passes the client's unit; athlete view falls back to own unit.
  const wUnit = weightUnit || UI.unit();
  const stat = (label, value, unit) => (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <div className="num" style={{ fontSize: 22, color: value != null ? UI.ink : UI.inkGhost, fontWeight: 300 }}>
        {value != null ? value : '—'}{value != null && unit ? <span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 3 }}>{unit}</span> : ''}
      </div>
      <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );
  const storedAdh = log?.adherence;
  // On a sick/vacation day adherence is intentionally nulled at save (no target
  // to hit), so don't recompute it from the raw macros here.
  const adh = storedAdh != null
    ? storedAdh
    : (!isStatusDay && log && dayTarget ? LB.macroAdherence({ protein: log.protein, carbs: log.carbs, fat: log.fat }, dayTarget) : null);
  const showAdh = dayTarget != null || adh != null;
  const isPerfect = adh != null && Math.round(adh) >= 97;
  const verdict = adh == null ? null : Math.round(adh) >= 97 ? 'PERFECT' : Math.round(adh) >= 90 ? 'STRONG' : Math.round(adh) >= 75 ? 'ON TRACK' : 'OFF TRACK';
  const badge = (icon, label, alpha) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, background: `rgba(var(--accent-rgb),${alpha})`, border: `0.5px solid rgba(var(--accent-rgb),${alpha * 2})`, borderRadius: 4, padding: '3px 7px' }}>
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
        {stat('Water', log?.waterMl != null ? UI.waterSummaryValue(log.waterMl) : null, UI.waterSummaryUnit())}
        {stat('Calories', log?.calories != null ? log.calories : null)}
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        {stat('Protein', log?.protein != null ? log.protein : null, 'g')}
        {stat('Carbs', log?.carbs != null ? log.carbs : null, 'g')}
        {stat('Fat', log?.fat != null ? log.fat : null, 'g')}
      </div>
      {dayTarget && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 12px', marginTop: 6, paddingTop: 6, borderTop: `0.5px solid ${UI.hair}` }}>
          {[dayTarget.protein, dayTarget.carbs, dayTarget.fat].map((v, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <span className="num" style={{ fontSize: 10, color: UI.inkGhost }}>{v != null ? v : '—'}<span style={{ fontSize: 8 }}>g</span></span>
            </div>
          ))}
        </div>
      )}
      {log?.offPlanNote && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `0.5px solid ${UI.hair}` }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 5 }}>OFF-PLAN</div>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{log.offPlanNote}</div>
        </div>
      )}
      {log?.note && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `0.5px solid ${UI.hair}` }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 5 }}>NOTE</div>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{log.note}</div>
        </div>
      )}
    </Card>
  );
}


// ─── This-week overview card (Mon–Sun averages + verdict) ─────────────────────

function HealthWeekCard({ stats, dragHandle, targets, tf, setTf, weightUnit }) {
  // Coach view passes the client's unit; athlete view falls back to own unit.
  const wUnit = weightUnit || UI.unit();
  const { from, to, periodDays, daysLogged, trainingsDone, trainingsPlanned, trainingDaysInPeriod, cardioMinutes, cardioSessions,
    weight, steps, stepsSum, calories, protein, carbs, fat, water, adherence,
    snapTgtCal, snapTgtProt, snapTgtCarb, snapTgtFat } = stats;
  const r = v => v == null ? null : Math.round(v);
  const range = `${healthFmtDate(from, { day: 'numeric', month: 'short' })} – ${healthFmtDate(to, { day: 'numeric', month: 'short' })}`;
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
      <div className="num" style={{ fontSize: 16, color: value != null ? UI.ink : UI.inkGhost, fontWeight: 300, whiteSpace: 'nowrap' }}>
        {value != null ? value : '—'}{value != null && unit ? <span style={{ fontSize: 9, color: UI.inkFaint, marginLeft: 2 }}>{unit}</span> : ''}
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
    <div data-reorder-ignore="true" style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}` }}>
      {HEALTH_TFS.map(t => (
        <button key={t.id} onClick={() => setTf(t.id)} style={{
          padding: '2px 8px', cursor: 'pointer', border: 'none',
          background: tf === t.id ? 'var(--accent)' : 'transparent',
          color: tf === t.id ? '#0a0805' : UI.inkFaint,
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
        {cell('Water', water != null ? UI.waterSummaryValue(water) : null, UI.waterSummaryUnit())}
        {cell('Calories', r(calories))}
        {cell('Protein', r(protein), 'g')}
        {cell('Carbs', r(carbs), 'g')}
        {cell('Fat', r(fat), 'g')}
      </div>
      {tgtCal != null && (
        <>
          <div style={{ height: '0.5px', background: UI.hairStrong, margin: '6px 0' }} />
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
  const monday = healthShiftISO(anchor, -((jsDow === 0 ? 7 : jsDow) - 1));
  const days = Array.from({ length: 7 }, (_, i) => healthShiftISO(monday, i));
  // A day counts as "logged" (gold marker) only if it carries real content — a
  // flex day-type-only override log (just targetsSnap.dayType) must not light up.
  const hasLogContent = l => l && (
    l.weight != null || l.steps != null || l.protein != null || l.carbs != null ||
    l.fat != null || l.fiber != null || l.waterMl != null || l.calories != null ||
    (l.note && l.note.trim()) || (l.offPlanNote && l.offPlanNote.trim()) ||
    (l.coachFields && Object.keys(l.coachFields).length)
  );
  const loggedSet = new Set((store.dailyLogs || []).filter(hasLogContent).map(l => l.date));

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
    const adherence = (dayTarget && hasMacros)
      ? LB.macroAdherence({ protein: existing.protein, carbs: existing.carbs, fat: existing.fat }, dayTarget) : null;
    const targetsSnap = dayTarget ? { ...dayTarget, dayType: type } : { dayType: type };
    const now = new Date().toISOString();
    const log = existing
      ? { ...existing, adherence, targetsSnap, updatedAt: now }
      : { id: LB.uid(), date: selectedDate, weight: null, steps: null, calories: null, protein: null, carbs: null, fat: null, fiber: null, waterMl: null, note: null, offPlanNote: null, coachFields: null, adherence, targetsSnap, updatedAt: now, createdAt: now };
    setStore(s => ({ ...s, dailyLogs: [log, ...(s.dailyLogs || []).filter(l => l.date !== selectedDate)] }));
  };
  const sunday = days[6];
  // Month label for the week — spans two months at a boundary (e.g. "MAY – JUN").
  const mLabel = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { month: 'short' }).toUpperCase();
  const monthLabel = mLabel(monday) === mLabel(sunday)
    ? `${mLabel(monday)} ${new Date(sunday + 'T12:00:00').getFullYear()}`
    : `${mLabel(monday)} – ${mLabel(sunday)}`;

  return (
    <div style={{ flexShrink: 0, padding: '4px 16px 12px' }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6, paddingLeft: 2 }}>{monthLabel}</div>
      {/* Day cells — same card style as the home screen day strip */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {days.map((d, i) => {
          const sel = d === selectedDate;
          const has = loggedSet.has(d);
          const trained = LB.isTrainingDayForDate(store, d);
          const isToday = d === today;
          const future = d > today;
          return (
            <div key={d} onClick={() => !future && onSelect(d)}
              style={{
                flex: 1, padding: '10px 4px 8px', textAlign: 'center',
                background: sel ? UI.goldFaint : has ? UI.goldFaint : 'transparent',
                border: `${sel ? '2px' : '0.5px'} solid ${sel ? UI.gold : has ? UI.goldSoft : isToday ? UI.hairStrong : UI.hair}`,
                borderRadius: 4, cursor: future ? 'default' : 'pointer',
                opacity: future ? 0.35 : 1, minHeight: 56,
                WebkitTapHighlightColor: 'transparent',
              }}>
              <div className="num" style={{ fontSize: 9, color: sel ? UI.gold : isToday ? UI.inkSoft : UI.inkFaint }}>
                {WEEKDAYS[i]}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, letterSpacing: '0.06em',
                color: sel ? UI.gold : has ? UI.ink : UI.inkFaint }}>
                {new Date(d + 'T12:00:00').getDate()}
              </div>
              {/* Day-type indicator — ALWAYS shown: dumbbell = training, dot = rest.
                 Logged status is conveyed by the gold cell bg/border + the small
                 check below. */}
              <div style={{ height: 13, marginTop: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                {trained ? (
                  <i className="fa-solid fa-dumbbell" style={{ fontSize: 9, color: 'var(--accent)' }} />
                ) : (
                  <span style={{ width: 5, height: 5, borderRadius: '50%', border: `1px solid ${sel || has ? UI.goldSoft : UI.hairStrong}`, background: 'transparent', display: 'inline-block' }} />
                )}
                {has && (
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="2">
                    <path d="M2 6l2.5 2.5L10 3"/>
                  </svg>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* Calendar picker + LOG button — calendar is an overlaid <input> for iOS compat */}
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
          <input type="date" value={selectedDate} max={LB.todayISO()}
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
                  color: active ? '#0a0805' : UI.inkFaint, cursor: 'pointer',
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
        {onLog && <button data-tour="health-log-btn" onClick={onLog} style={{
          height: 34, borderRadius: 4, border: 'none',
          background: 'linear-gradient(180deg, var(--accent-light), var(--accent))',
          color: '#0a0805', cursor: 'pointer', padding: '0 14px',
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

function GlucoseCard({ glucoseLogs, unit, tf, setTf, dragHandle, onExpand, compact = false }) {
  const today = LB.todayISO();
  const tfDays = id => (HEALTH_TFS.find(t => t.id === id) || HEALTH_TFS[0]).days;
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
  const CTX_COLORS = { fasted: 'var(--accent)', fed: '#4a9fe0', other: UI.inkSoft };

  return (
    <HealthChartCard title="Glucose" icon="fa-droplet" tf={tf} setTf={setTf}
      headline={latestDisp != null ? String(latestDisp) : null} sub={latestDisp != null ? unitLabel : null} dragHandle={dragHandle} onExpand={onExpand}>
      {!inWindow.length ? (
        <HealthChartEmpty label="No glucose readings in this range" />
      ) : (
        <>
          <GlucoseScatterChart readings={inWindow} from={start} to={end} unit={unit} />
          {/* Reference legend + readings feed only in the full (expanded) view —
              compact (2-col grid) shows just the chart, so this card's height
              matches its plain-chart neighbours instead of towering over them. */}
          {!compact && (
          <>
          {/* Wraps on the narrow 2-col card width instead of clipping — the 3
              context dots are separate flex items with no text of their own
              to fall back on for reflow. */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, rowGap: 4, marginTop: 4 }}>
            <div style={{ height: 8, width: 28, background: 'rgba(var(--accent-rgb),0.15)', borderRadius: 4, flexShrink: 0 }} />
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
              <div style={{ height: '0.5px', background: UI.hair, margin: '8px 0' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sortedReadings.map(n => (
                  <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: CTX_COLORS[n.context] || UI.inkSoft, display: 'inline-block', flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkGhost }}>{healthFmtDate(n.date, { day: 'numeric', month: 'short' })} · {n.time}</div>
                      {n.note && <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.4, marginTop: 1 }}>{n.note}</div>}
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

function BloodPressureCard({ bpLogs, tf, setTf, dragHandle, onExpand, compact = false }) {
  const today = LB.todayISO();
  const tfDays = id => (HEALTH_TFS.find(t => t.id === id) || HEALTH_TFS[0]).days;
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
    <HealthChartCard title="Blood Pressure" icon="fa-heart-pulse" tf={tf} setTf={setTf}
      headline={latest ? `${latest.systolic}/${latest.diastolic}` : null} sub={latest ? 'mmHg' : null} dragHandle={dragHandle} onExpand={onExpand}>
      {!inWindow.length ? (
        <HealthChartEmpty label="No blood pressure readings in this range" />
      ) : (
        <>
          <BpScatterChart readings={inWindow} from={start} to={end} />
          {/* Legend + readings feed only in the full (expanded) view — compact
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
            <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkGhost }}>· dashed = 120/80 normal</span>
          </div>
          {sortedReadings.length > 0 && (
            <>
              <div style={{ height: '0.5px', background: UI.hair, margin: '8px 0' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sortedReadings.map(n => (
                  <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkGhost }}>{healthFmtDate(n.date, { day: 'numeric', month: 'short' })} · {n.time}</div>
                      {n.note && <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.4, marginTop: 1 }}>{n.note}</div>}
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

function BodyTempCard({ tempLogs, unit, tf, setTf, dragHandle, onExpand, compact = false }) {
  const today = LB.todayISO();
  const tfDays = id => (HEALTH_TFS.find(t => t.id === id) || HEALTH_TFS[0]).days;
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
    <HealthChartCard title="Body Temperature" icon="fa-temperature-half" tf={tf} setTf={setTf}
      headline={latestDisp != null ? String(latestDisp) : null} sub={latestDisp != null ? unitLabel : null} dragHandle={dragHandle} onExpand={onExpand}>
      {!inWindow.length ? (
        <HealthChartEmpty label="No temperature readings in this range" />
      ) : (
        <>
          <TempScatterChart readings={inWindow} from={start} to={end} unit={unit} />
          {/* Readings feed only in the full (expanded) view — compact (2-col
              grid) shows just the chart, matching plain-chart neighbours. */}
          {!compact && sortedReadings.length > 0 && (
            <>
              <div style={{ height: '0.5px', background: UI.hair, margin: '8px 0' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sortedReadings.map(n => (
                  <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkGhost }}>{healthFmtDate(n.date, { day: 'numeric', month: 'short' })} · {n.time}</div>
                      {n.note && <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.4, marginTop: 1 }}>{n.note}</div>}
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

// ─── HealthScreen ─────────────────────────────────────────────────────────────

function HealthScreen({ store, setStore, go, userId }) {
  const today = LB.todayISO();
  const [selectedDate, setSelectedDate] = useStateH(today);
  const [logOpen, setLogOpen] = useStateH(false);
  const [targetOpen, setTargetOpen] = useStateH(false);
  const [coachingMacros, setCoachingMacros] = useStateH(null);
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

  const handleSetStatus = async (mode, startDateStr = null) => {
    const current = store.statusMode ?? null;
    const startedAt = startDateStr
      ? new Date(startDateStr + 'T12:00:00').toISOString()
      : new Date().toISOString();
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
      alert('Could not update your status. Please try again.');
      return;
    }
    if (coachingId && modeChanged) {
      try {
        const body = mode === 'sick'     ? 'Status: Sick — taking a break from training.'
                   : mode === 'vacation' ? 'Status: Vacation — back soon!'
                   : `Status: Back to normal (was ${current === 'sick' ? 'sick' : 'on vacation'}).`;
        const threadId = await LB.getOrCreateCoachingThread(coachingId, 'Status Updates', userId);
        await LB.addCoachingNote(coachingId, 'general', null, null, body, userId, threadId);
      } catch (_) {}
    }
  };

  useEffectH(() => {
    if (!coachingId) { setCoachingMacros(null); return; }
    let cancelled = false;
    LB.loadCoachingMacros(coachingId).then(data => { if (!cancelled) setCoachingMacros(data[0] || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [coachingId]);

  // Load the check-in schema for the active coaching relationship (real coach
  // or self-coaching) so DailyLogSheet can show coach-configured daily fields.
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
    if (targets === null && cachedTargets !== null) return; // don't overwrite a good cache with a transient null
    try { localStorage.setItem(targetsCacheKey, JSON.stringify(targets)); } catch {}
    if (targets !== cachedTargets) setCachedTargets(targets);
  }, [targets]);

  // Two-sided retroactive heal for a past day's saved day type:
  //  • DOWNGRADE training → rest: a training-tagged day with NO logged session
  //    was never earned. For cycle/week that's a planned training day skipped
  //    ("earn it"); for flex it's a proactive Training that wasn't trained.
  //  • UPGRADE rest → training (all modes): a rest-tagged day that DID get a
  //    logged session (incl. a freestyle session on a rest day) is really a
  //    training day, so its target/adherence should follow.
  // The two sets are disjoint (training+no-session vs rest+session), so a rewrite
  // always flips the day out of both conditions — no oscillation. Adherence is
  // recomputed against the new target; the dayType is corrected even when macro
  // targets are absent (keeps the health strip/indicator honest).
  const flexActive = useMemoH(
    () => LB.isFlexPlan((store.schedules || []).find(s => s.id === store.activeScheduleId)),
    [store.schedules, store.activeScheduleId]
  );
  useEffectH(() => {
    const today = LB.todayISO();
    const dayOf = s => s.date ? s.date.slice(0, 10) : null;
    const sessionDates = new Set((store.sessions || []).filter(s => s.ended).map(dayOf).filter(Boolean));
    const trainingTarget = LB.dayTargetFromMacros(effectiveTargets, true);
    const restTarget = LB.dayTargetFromMacros(effectiveTargets, false);
    let changed = false;
    const nextLogs = (store.dailyLogs || []).map(l => {
      if (l.date >= today) return l;
      const dt = l.targetsSnap?.dayType;
      const hasSession = sessionDates.has(l.date);
      let newType = null;
      if (dt === 'training' && !hasSession && (flexActive || !!LB.plannedTrainingDay(store, l.date))) newType = 'rest';
      else if (dt === 'rest' && hasSession) newType = 'training';
      if (!newType) return l;
      const target = newType === 'training' ? trainingTarget : restTarget;
      const adherence = target ? LB.macroAdherence({ protein: l.protein, carbs: l.carbs, fat: l.fat }, target) : null;
      const targetsSnap = target ? { ...target, dayType: newType } : { dayType: newType };
      changed = true;
      return { ...l, adherence, targetsSnap, updatedAt: new Date().toISOString() };
    });
    if (!changed) return;
    setStore(s => ({ ...s, dailyLogs: nextLogs }));
  }, [store.sessions, store.dailyLogs, effectiveTargets, flexActive]);

  // Windowed series builder for the charts. The x-range is tightened to the
  // actual logged days inside the window (not the full timeframe) so a sparse
  // window doesn't leave most of the chart empty — 80 of 90 days fills the chart.
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

  // Cardio chart series — minutes summed per day from store.cardioLogs.
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
  const stepsAvg = avg(stepsSeries.data, 'value');
  const waterAvg = avg(waterSeries.data, 'value');
  const adhAvg = avg(adhSeries.data, 'value');
  const cardioTotal = cardioSeries.data.reduce((s, d) => s + (d.value || 0), 0);

  // Reorderable card order, persisted per device. Missing ids (e.g. after a new
  // card ships) are inserted at their default position, not appended at the end.
  const CARD_ORDER_KEY = 'logbook-health-card-order';
  // Macros/Adherence/Targets move, hide, and show as one unit — id 'macroGroup',
  // see its cardEls entry below — since hiding just one of the three orphans the
  // others (e.g. an adherence chart with no targets to compare against).
  const DEFAULT_CARD_ORDER = ['week', 'today', 'macroGroup', 'weight', 'cardio', 'steps', 'water', 'glucose', 'bloodPressure', 'bodyTemp'];
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
      const next = [...moved, ...prev.filter(id => !visible.includes(id))];
      try { localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  // Period overview — adapts to tf: 1W = current Mon–Sun, 1M/3M = rolling window.
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
  const targetLabel = macroTargetAvg
    ? `AVG TARGET · ${tf === '1M' ? 'LAST 30 DAYS' : 'LAST 3 MONTHS'}`
    : `DAILY TARGETS${fromCoach ? (selfCoachedMacros ? ' · FROM YOUR PLAN' : ' · FROM COACH') : ''}`;
  const targetRow = (
    <div style={{ background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: effectiveTargets ? 2 : 0 }}>
        <span className="micro" style={{ color: UI.inkFaint, flex: 1 }}>{targetLabel}</span>
        <button data-reorder-ignore="true" onClick={() => setTargetOpen(true)} style={{
          background: 'transparent', border: `0.5px solid rgba(var(--accent-rgb),0.4)`,
          borderRadius: 4, padding: '3px 12px', color: 'var(--accent)',
          fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent', flexShrink: 0,
        }}>{effectiveTargets ? 'EDIT' : 'SET'}</button>
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
          </>
        )
      ) : (
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 4 }}>
          Set protein / carbs / fat goals to track macro adherence.
        </div>
      )}
      {coachHasMacros && (
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.4, marginTop: 8, paddingTop: 8, borderTop: `0.5px solid ${UI.hair}` }}>
          {selfCoachedMacros
            ? 'These come from your active plan and take priority. Personal targets you set apply only without them.'
            : 'These come from your coaching plan and take priority. Personal targets you set apply only without coaching macros.'}
        </div>
      )}
    </div>
  );

  const handle = <DragHandle style={{ width: 20, height: 22, marginLeft: -4, cursor: 'grab' }} />;
  const dayLabel = selectedDate === today ? 'Today' : healthFmtDate(selectedDate, { weekday: 'short', day: 'numeric', month: 'short' });
  const trainedSelected = LB.isLoggedTrainingDay(store.sessions, selectedDate);
  const cardioSelected = (store.cardioLogs || []).some(l => l.date === selectedDate);
  // Honors a flex plan's explicit Training|Rest override (via targetsSnap.dayType).
  const dayIsTraining = LB.isTrainingDayForDate(store, selectedDate);
  const selectedDayTarget = LB.dayTargetFromMacros(effectiveTargets, dayIsTraining);
  // Whether the selected day fell inside a sick/vacation status period (drives
  // adherence suppression). parseDate returns a Date; compare on getTime().
  const selectedIsStatusDay = (() => {
    const sd = LB.parseDate(selectedDate);
    const t = sd ? sd.getTime() : null;
    if (t == null) return false;
    return (store.statusPeriods || []).some(p => {
      const start = new Date(p.startedAt).getTime();
      const end = p.endedAt ? new Date(p.endedAt).getTime() : Date.now();
      return t >= start && t <= end;
    });
  })();
  // Opens a chart full-width in a sheet — offered only on charts the 2-col grid
  // below actually squeezes to half-width (see the onExpand wiring per card and
  // expandableCards further down, which the sheet renders from by this id).
  const expandBtn = id => () => setExpandedCardId(id);

  // The 3 macro cards live together in the macroGroup composite below (target
  // kcal/P/C/F, adherence trend, macro breakdown) so hide/move/reorder always
  // treats them as one unit — leaving one behind orphans the other two (an
  // adherence trend with no targets to compare against isn't useful alone).
  const macroTargetsCard = (
    <HealthChartCard title="Macro Targets" icon="fa-list-check" tf={tf} setTf={setTf} dragHandle={handle}>
      {targetRow}
    </HealthChartCard>
  );
  const macroAdherenceCard = (
    <HealthChartCard title="Macro Adherence" icon="fa-bullseye" tf={tf} setTf={setTf} onExpand={expandBtn('macroAdherence')}
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
    today: <HealthMetricsCard log={selectedLog} dateLabel={dayLabel} isToday={selectedDate === today} onJumpToday={() => setSelectedDate(today)} dragHandle={handle} trained={trainedSelected} hasCardio={cardioSelected} dayTarget={selectedDayTarget} isStatusDay={selectedIsStatusDay} />,
    // Targets on top (full width, needs the room for the P/C/F chip row), then
    // Adherence + the macro breakdown paired below it — always pinned full-width
    // as a whole, see PINNED_FULL_WIDTH_CARDS.
    macroGroup: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {macroTargetsCard}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
          {macroAdherenceCard}
          {macrosCard}
        </div>
      </div>
    ),
    weight: (
      <HealthChartCard title="Weight" icon="fa-weight-scale" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('weight')}
        headline={weightAvg != null ? `${weightAvg}${UI.unit()}` : null} sub={weightAvg != null ? 'avg' : null}>
        <HealthLineChart series={weightSeries.data} from={weightSeries.from} to={weightSeries.to} format={v => `${v}${UI.unit()}`} step={UI.unit() === 'lbs' ? 5 : 2.5} />
      </HealthChartCard>
    ),
    steps: (
      <HealthChartCard title="Steps" icon="fa-shoe-prints" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('steps')}
        headline={stepsAvg != null ? Math.round(stepsAvg).toLocaleString() : null} sub={stepsAvg != null ? 'avg / day' : null}>
        <HealthBarChart series={stepsSeries.data} from={stepsSeries.from} to={stepsSeries.to} format={v => v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`} />
      </HealthChartCard>
    ),
    water: (
      <HealthChartCard title="Water" icon="fa-glass-water" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('water')}
        headline={waterAvg != null ? `${UI.waterSummaryValue(waterAvg)}${UI.waterSummaryUnit()}` : null} sub={waterAvg != null ? 'avg / day' : null}>
        <HealthBarChart series={waterSeries.data} from={waterSeries.from} to={waterSeries.to} format={v => `${UI.waterSummaryValue(v)}${UI.waterSummaryUnit()}`} color="#4a9fe0" colorSoft="rgba(74,159,224,0.35)" />
      </HealthChartCard>
    ),
    cardio: (
      <HealthChartCard title="Cardio" icon="fa-person-running" tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('cardio')}
        headline={cardioTotal ? cardioTotal : null} sub={cardioTotal ? 'min total' : null}>
        <HealthBarChart series={cardioSeries.data} from={cardioSeries.from} to={cardioSeries.to} format={v => `${Math.round(v)}`} />
      </HealthChartCard>
    ),
    // compact: hides the reference legend + readings feed so these match the
    // plain-chart cards' height in the grid — full detail is one expand tap away.
    glucose: (store.glucoseLogs || []).length > 0
      ? <GlucoseCard glucoseLogs={store.glucoseLogs} unit={store.settings?.glucoseUnit ?? 'mmol'} tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('glucose')} compact />
      : null,
    bloodPressure: (store.bloodPressureLogs || []).length > 0
      ? <BloodPressureCard bpLogs={store.bloodPressureLogs} tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('bloodPressure')} compact />
      : null,
    bodyTemp: (store.bodyTempLogs || []).length > 0
      ? <BodyTempCard tempLogs={store.bodyTempLogs} unit={LB.defaultTempUnit(store.settings)} tf={tf} setTf={setTf} dragHandle={handle} onExpand={expandBtn('bodyTemp')} compact />
      : null,
  };

  // Sheet lookup for expandedCardId — every id any onExpand above can set.
  // Cloned with dragHandle/onExpand stripped: the expand sheet isn't inside a
  // reorder list (grip would be inert) and re-expanding itself is meaningless.
  const expandableCards = { weight: cardEls.weight, steps: cardEls.steps, water: cardEls.water, cardio: cardEls.cardio,
    macroAdherence: macroAdherenceCard, macros: macrosCard,
    glucose: cardEls.glucose, bloodPressure: cardEls.bloodPressure, bodyTemp: cardEls.bodyTemp };

  // Week/Today/the macro group always render full width; every other visible
  // card pairs up into the 2-col grid below. A trailing odd card in a run of
  // non-pinned cards also spans full width, so a reorder can never leave a
  // dangling empty half.
  const PINNED_FULL_WIDTH_CARDS = new Set(['week', 'today', 'macroGroup']);
  const fullWidthCardIds = (() => {
    const span = new Set(PINNED_FULL_WIDTH_CARDS);
    let run = [];
    const flushRun = () => { if (run.length % 2 === 1) span.add(run[run.length - 1]); run = []; };
    cardOrder.filter(isCardVisible).forEach(id => {
      if (PINNED_FULL_WIDTH_CARDS.has(id)) flushRun();
      else run.push(id);
    });
    flushRun();
    return span;
  })();

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
          background: 'rgba(var(--accent-rgb), 0.08)',
          border: `0.5px solid rgba(var(--accent-rgb), 0.3)`,
          borderRadius: 6,
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}>
          <i className={`fa-solid ${store.statusMode === 'sick' ? 'fa-bed-pulse' : store.statusMode === 'deload' ? 'fa-battery-quarter' : 'fa-umbrella-beach'}`} style={{ fontSize: 14, color: 'var(--accent)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              {store.statusMode === 'sick' ? 'Sick' : store.statusMode === 'deload' ? 'Deload' : 'Vacation'}
              {store.statusModeSince ? ` · Since ${new Date(store.statusModeSince).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
            </div>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Tap to manage or deactivate</div>
          </div>
          <i className="fa-solid fa-chevron-right" style={{ fontSize: 9, color: UI.inkFaint }} />
        </div>
      )}
      <div ref={captureRef}>
        <HealthDateStrip store={store} setStore={setStore} selectedDate={selectedDate} onSelect={setSelectedDate} onLog={() => setLogOpen(true)} targets={effectiveTargets} />

        {/* max-width cap so charts don't blow up on iPad. Reorderable cards —
           drag the grip to reorder; order persists per device. Week/Today span
           both columns; the rest sit in a 2-col grid (fullWidthCardIds above). */}
        <div style={{ padding: capturing ? '8px 16px 16px' : '8px 16px env(safe-area-inset-bottom, 8px)', maxWidth: 680, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
          {cardOrder.every(id => !isCardVisible(id)) ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 16px', textAlign: 'center' }}>
              <i className="fa-solid fa-eye-slash" style={{ fontSize: 24, color: UI.inkGhost }} />
              <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5 }}>All Health cards are hidden.</div>
              <button onClick={() => go({ name: 'settings' })} style={{
                background: 'transparent', border: `0.5px solid rgba(var(--accent-rgb),0.4)`,
                borderRadius: 4, padding: '5px 14px', color: 'var(--accent)', marginTop: 4,
                fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}>Settings → Health → Cards</button>
            </div>
          ) : (
            <ReorderList onReorder={reorderCards} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
              {cardOrder.map(id => isCardVisible(id) ? (
                <div key={id} data-reorder-item="true" data-tour={`health-card-${id}`} style={fullWidthCardIds.has(id) ? { gridColumn: '1 / -1' } : undefined}>{cardEls[id]}</div>
              ) : null)}
            </ReorderList>
          )}
        </div>
      </div>

      <Sheet open={!!expandedCardId} onClose={() => setExpandedCardId(null)}>
        {expandedCardId && expandableCards[expandedCardId] &&
          React.cloneElement(expandableCards[expandedCardId], { dragHandle: null, onExpand: null, compact: false })}
      </Sheet>

      <DailyLogSheet open={logOpen} onClose={() => setLogOpen(false)} store={store} setStore={setStore} date={selectedDate} targets={effectiveTargets} activeCoachingSchema={activeCoachingSchema} onSetStatus={handleSetStatus} userId={userId} glucoseLogs={store.glucoseLogs || []} glucoseUnit={store.settings?.glucoseUnit ?? 'mmol'} bloodPressureLogs={store.bloodPressureLogs || []} bodyTempLogs={store.bodyTempLogs || []} tempUnit={LB.defaultTempUnit(store.settings)} />
      <MacroTargetSheet open={targetOpen} onClose={() => setTargetOpen(false)} store={store} setStore={setStore} coachingMacros={coachingMacros} />
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} store={store} />
    </Screen>
  );
}

// ─── Coach read-only view (rendered inside CoachClientScreen's "Daily" tab) ─────

function HealthClientLogs({ clientStore }) {
  const logs = clientStore?.dailyLogs || [];
  const cardioLogs = clientStore?.cardioLogs || [];
  const glucoseLogs = clientStore?.glucoseLogs || [];
  const glucoseUnit = clientStore?.settings?.glucoseUnit ?? 'mmol';
  const bloodPressureLogs = clientStore?.bloodPressureLogs || [];
  const bodyTempLogs = clientStore?.bodyTempLogs || [];
  const clientTempUnit = LB.defaultTempUnit(clientStore?.settings);
  // The coach may run a different weight unit than the client; always label the
  // client's weights in the client's own unit (no conversion, display-only).
  const clientUnit = clientStore?.settings?.unit === 'lbs' ? 'lbs' : 'kg';
  const [tf, setTf] = useStateH('1W');

  const COACH_ORDER_KEY = 'logbook-coach-health-card-order';
  const DEFAULT_COACH_ORDER = ['week', 'today', 'weight', 'steps', 'water', 'macros', 'cardio', 'adherence', 'glucose', 'bloodPressure', 'bodyTemp', 'weekly'];
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
      // rendered, not the full order array — glucose/weekly are routinely
      // absent for new coaching clients, so splicing prev directly (as this
      // used to) reordered the wrong card whenever any card was hidden.
      const visible = prev.filter(isCardVisible);
      const moved = [...visible];
      const [m] = moved.splice(from, 1);
      moved.splice(to, 0, m);
      const next = [...moved, ...prev.filter(id => !visible.includes(id))];
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
  const dayLabel = selectedDate === today ? 'Today' : healthFmtDate(selectedDate, { weekday: 'short', day: 'numeric', month: 'short' });

  const handle = <DragHandle style={{ width: 20, height: 22, marginLeft: -4, cursor: 'grab' }} />;
  const cardEls = {
    week: <HealthWeekCard stats={weekStats} dragHandle={handle} targets={null} tf={tf} setTf={setTf} weightUnit={clientUnit} />,
    today: (
      <HealthMetricsCard log={selectedLog} dateLabel={dayLabel} isToday={selectedDate === today} onJumpToday={() => setSelectedDate(today)}
        dragHandle={handle} trained={trainedSelected} hasCardio={cardioSelected} dayTarget={null} weightUnit={clientUnit} />
    ),
    weight: (
      <HealthChartCard title="Weight" icon="fa-weight-scale" tf={tf} setTf={setTf} dragHandle={handle}
        headline={weightAvg != null ? `${weightAvg}${clientUnit}` : null} sub={weightAvg != null ? 'avg' : null}>
        <HealthLineChart series={weightSeries.data} from={weightSeries.from} to={weightSeries.to} format={v => `${v}${clientUnit}`} step={clientUnit === 'lbs' ? 5 : 2.5} />
      </HealthChartCard>
    ),
    steps: (
      <HealthChartCard title="Steps" icon="fa-shoe-prints" tf={tf} setTf={setTf} dragHandle={handle}
        headline={stepsAvg != null ? stepsAvg.toLocaleString() : null} sub={stepsAvg != null ? 'avg / day' : null}>
        <HealthBarChart series={stepsSeries.data} from={stepsSeries.from} to={stepsSeries.to} format={v => v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`} />
      </HealthChartCard>
    ),
    water: (
      <HealthChartCard title="Water" icon="fa-glass-water" tf={tf} setTf={setTf} dragHandle={handle}
        headline={waterAvg != null ? `${UI.waterSummaryValue(waterAvg)}${UI.waterSummaryUnit()}` : null} sub={waterAvg != null ? 'avg / day' : null}>
        <HealthBarChart series={waterSeries.data} from={waterSeries.from} to={waterSeries.to} format={v => `${UI.waterSummaryValue(v)}${UI.waterSummaryUnit()}`} color="#4a9fe0" colorSoft="rgba(74,159,224,0.35)" />
      </HealthChartCard>
    ),
    macros: (
      <HealthChartCard title="Macros" icon="fa-utensils" tf={tf} setTf={setTf} dragHandle={handle}>
        <HealthMacroChart series={macroSeries.data} from={macroSeries.from} to={macroSeries.to} />
        <MacroLegend />
      </HealthChartCard>
    ),
    cardio: (
      <HealthChartCard title="Cardio" icon="fa-person-running" tf={tf} setTf={setTf} dragHandle={handle}
        headline={cardioTotal || null} sub={cardioTotal ? 'min total' : null}>
        <HealthBarChart series={cardioSeries.data} from={cardioSeries.from} to={cardioSeries.to} format={v => `${Math.round(v)}`} />
      </HealthChartCard>
    ),
    adherence: (
      <HealthChartCard title="Macro Adherence" icon="fa-bullseye" tf={tf} setTf={setTf} dragHandle={handle}
        headline={adhAvg != null ? `${adhAvg}%` : null} sub={adhAvg != null ? 'avg' : null}>
        <HealthLineChart series={adhSeries.data} from={adhSeries.from} to={adhSeries.to} format={v => `${Math.round(v)}%`} yMin={0} yMax={100} />
      </HealthChartCard>
    ),
    glucose: glucoseLogs.length > 0
      ? <GlucoseCard glucoseLogs={glucoseLogs} unit={glucoseUnit} tf={tf} setTf={setTf} dragHandle={handle} />
      : null,
    bloodPressure: bloodPressureLogs.length > 0
      ? <BloodPressureCard bpLogs={bloodPressureLogs} tf={tf} setTf={setTf} dragHandle={handle} />
      : null,
    bodyTemp: bodyTempLogs.length > 0
      ? <BodyTempCard tempLogs={bodyTempLogs} unit={clientTempUnit} tf={tf} setTf={setTf} dragHandle={handle} />
      : null,
    weekly: weeks.length ? (
      <Card style={{ padding: 14, borderLeft: `3px solid ${UI.gold}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {handle}
          <span style={HEALTH_CARD_HEADER_STYLE}>WEEKLY AVERAGES</span>
        </div>
        <div style={{ background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
          {weeks.map((w, i) => (
            <div key={w.ws} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: i ? `0.5px solid ${UI.hair}` : 'none' }}>
              <div style={{ width: 58, flexShrink: 0, fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>{healthFmtDate(w.ws, { day: 'numeric', month: 'short' })}</div>
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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <HealthDateStrip store={clientStore} selectedDate={selectedDate} onSelect={setSelectedDate} onLog={null} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 32px', maxWidth: 680, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
        {cardOrder.every(id => !isCardVisible(id)) ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 16px', textAlign: 'center' }}>
            <i className="fa-solid fa-eye-slash" style={{ fontSize: 24, color: UI.inkGhost }} />
            <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5 }}>Your client has hidden all their Health cards.</div>
          </div>
        ) : (
          <ReorderList onReorder={reorderCards} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {cardOrder.map(id => isCardVisible(id) ? (
              <div key={id} data-reorder-item="true">{cardEls[id]}</div>
            ) : null)}
          </ReorderList>
        )}
      </div>
    </div>
  );
}

// ─── Export sheet ─────────────────────────────────────────────────────────────

function ExportSheet({ open, onClose, store }) {
  const today = LB.todayISO();
  const [from, setFrom] = useStateH(() => healthShiftISO(today, -29));
  const [to, setTo] = useStateH(today);
  const [exporting, setExporting] = useStateH(null); // 'csv' | 'pdf' | null

  const applyPreset = (days) => {
    setFrom(healthShiftISO(today, -(days - 1)));
    setTo(today);
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
      const dates = logs.map(l => l.date);
      const byDate = {};
      logs.forEach(l => { byDate[l.date] = l; });

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
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c9a961';
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
          const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
            `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,0.06);border:0.5px solid rgba(255,255,255,0.12);font-size:9px;letter-spacing:0.07em;text-transform:uppercase;color:${inkSoft}">
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
            ${l.note || l.offPlanNote ? `<div style="margin-top:10px;padding-top:10px;border-top:0.5px solid ${hairDiv};font-size:11px;color:${inkSoft};line-height:1.5">${[l.note, l.offPlanNote].filter(Boolean).join(' · ')}</div>` : ''}
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
                flex: 1, padding: '7px 4px', borderRadius: 4, border: `0.5px solid ${UI.hairStrong}`,
                background: from === healthShiftISO(today, -(p.days - 1)) && to === today ? 'var(--accent)' : UI.bgInset,
                color: from === healthShiftISO(today, -(p.days - 1)) && to === today ? '#0a0805' : UI.inkSoft,
                fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}>{p.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div className="label" style={{ color: UI.inkFaint, marginBottom: 4 }}>FROM</div>
              <input type="date" value={from} max={to}
                onChange={e => e.target.value && setFrom(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: `0.5px solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontNum, fontSize: 13, outline: 'none' }} />
            </div>
            <div style={{ color: UI.inkFaint, fontSize: 11, paddingTop: 16 }}>→</div>
            <div style={{ flex: 1 }}>
              <div className="label" style={{ color: UI.inkFaint, marginBottom: 4 }}>TO</div>
              <input type="date" value={to} min={from} max={today}
                onChange={e => e.target.value && setTo(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: `0.5px solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontNum, fontSize: 13, outline: 'none' }} />
            </div>
          </div>
          {(() => {
            const count = (store.dailyLogs || []).filter(l => l.date >= from && l.date <= to).length;
            return <div style={{ marginTop: 8, fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>{count} day{count !== 1 ? 's' : ''} logged in this range</div>;
          })()}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={doExportCSV} disabled={!!exporting} style={{
            width: '100%', padding: '13px 0', borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`,
            background: UI.bgInset, color: exporting ? UI.inkGhost : UI.ink,
            fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, cursor: exporting ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <i className="fa-solid fa-file-csv" style={{ fontSize: 13 }} />
            {exporting === 'csv' ? 'Exporting…' : 'Export as CSV'}
          </button>
          <button onClick={doExportPDF} disabled={!!exporting} style={{
            width: '100%', padding: '13px 0', borderRadius: 6, border: 'none',
            background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
            boxShadow: '0 6px 20px rgba(var(--accent-rgb),0.35)',
            color: '#0a0805', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 700, cursor: exporting ? 'default' : 'pointer',
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
