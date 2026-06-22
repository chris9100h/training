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
  return d.toISOString().slice(0, 10);
}

// [start, end] ISO bounds for a trailing N-day window ending today.
function healthWindow(days) {
  const end = LB.todayISO();
  return { start: healthShiftISO(end, -(days - 1)), end };
}

const healthNum = v => (v === '' || v == null || isNaN(parseFloat(v))) ? null : parseFloat(String(v).replace(',', '.'));
const healthInt = v => (v === '' || v == null || isNaN(parseInt(v, 10))) ? null : parseInt(v, 10);

// Calories from macros: P×4 + C×4 + F×9. With fiber given (net-carb mode),
// carbs contribute (C − fiber)×4. Returns null when no macro is set.
function caloriesFromMacros(p, c, f, fiber) {
  if (p == null && c == null && f == null) return null;
  return (p || 0) * 4 + ((c || 0) - (fiber || 0)) * 4 + (f || 0) * 9;
}

function healthFmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', opts);
}

// Adherence → traffic-light colour (green ≥90, amber 75–89, red <75).
function adherenceColor(a) {
  if (a == null) return UI.inkFaint;
  if (a >= 90) return 'var(--ok)';
  if (a >= 75) return '#d97706';
  return 'var(--danger)';
}

// ─── chart primitives ─────────────────────────────────────────────────────────

function HealthChartEmpty({ label }) {
  return (
    <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11 }}>
      {label || 'No data in this range yet'}
    </div>
  );
}

// Section wrapper: title + 1W/1M/3M toggle + subtitle. `dragHandle` renders a
// reorder grip at the start of the header when the card is in a reorder list.
function HealthChartCard({ title, icon, tf, setTf, headline, sub, dragHandle, children }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {dragHandle}
        {icon && <i className={`fa-solid ${icon}`} style={{ fontSize: 11, color: UI.inkFaint }} />}
        <span className="micro" style={{ color: UI.inkFaint, flex: 1 }}>{title}</span>
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
function HealthLineChart({ series, from, to, format, color = 'var(--accent)', yMin, yMax }) {
  const pts = (series || []).filter(p => p.value != null).sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return <HealthChartEmpty />;
  const W = 320, padL = 38, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;
  const vals = pts.map(p => p.value);
  const dom = UI.chartDomain(Math.min(...vals), Math.max(...vals), { min: yMin, max: yMax });
  const totalDays = Math.max(1, healthDayDiff(from, to));
  const xOf = d => padL + (totalDays ? healthDayDiff(from, d) / totalDays : 0.5) * plotW;
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
  const dec = dom.range >= 4 ? 0 : 1;
  const gridVals = Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const line = pts.map(p => `${xOf(p.date).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ');
  const base = (padTop + plotH).toFixed(1);

  return (
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
  );
}

// Bar chart over a date window. series = [{ date, value }].
function HealthBarChart({ series, from, to, format, target }) {
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

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{format(Math.round(v))}</text>
        </g>
      ))}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
      {target != null && target > 0 && (
        <line x1={padL} y1={yOf(target).toFixed(1)} x2={W - padR} y2={yOf(target).toFixed(1)} stroke="var(--accent)" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
      )}
      {pts.map((p, i) => {
        const x = xOf(p.date) - bw / 2;
        const y = yOf(p.value);
        const h = (padTop + plotH) - y;
        const above = target && p.value >= target;
        return <rect key={i} x={x.toFixed(1)} y={y.toFixed(1)} width={bw.toFixed(1)} height={Math.max(0, h).toFixed(1)} rx="1"
          fill={above ? 'var(--accent)' : `rgba(var(--accent-rgb),0.35)`} />;
      })}
    </svg>
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
  const calOf = p => caloriesFromMacros(p.protein, p.carbs, p.fat) || 0;
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

  return (
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
          { cal: (p.carbs || 0) * 4, color: MACRO_COLORS.carbs },
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
  );
}

function MacroLegend() {
  return (
    <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 10 }}>
      {[['Protein', MACRO_COLORS.protein], ['Carbs', MACRO_COLORS.carbs], ['Fat', MACRO_COLORS.fat], ['Target', UI.ink]].map(([lbl, col]) => (
        <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: col, display: 'inline-block' }} />
          <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.04em' }}>{lbl}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Daily log sheet ──────────────────────────────────────────────────────────

function DailyLogSheet({ open, onClose, store, setStore, date, targets, activeCoachingSchema, onSetStatus }) {
  const existing = useMemoH(() => (store.dailyLogs || []).find(l => l.date === date), [store.dailyLogs, date]);
  const manualCal = !!store.settings?.manualCalories;
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

  useEffectH(() => {
    if (!open) return;
    setNetCarbs(existing?.fiber != null ? true : !!store.settings?.netCarbs);
    if (existing) {
      setForm({
        weight: existing.weight != null ? String(existing.weight) : '',
        steps: existing.steps != null ? String(existing.steps) : '',
        protein: existing.protein != null ? String(existing.protein) : '',
        carbs: existing.carbs != null ? String(existing.carbs) : '',
        fat: existing.fat != null ? String(existing.fat) : '',
        fiber: existing.fiber != null ? String(existing.fiber) : '',
        calories: existing.calories != null ? String(existing.calories) : '',
        water: existing.waterMl != null ? String(existing.waterMl) : '',
        note: existing.note || '',
        offPlanNote: existing.offPlanNote || '',
      });
    } else setForm(empty);
    const cf = {};
    coachFields.forEach(f => {
      const v = existing?.coachFields?.[f.key];
      cf[f.key] = f.type === 'stepper' ? (v != null ? v : null) : (v != null ? String(v) : '');
    });
    setCoachForm(cf);
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
  const caloriesManual = netCarbs ? !netAllFilled : manualCal;

  const save = () => {
    if (!canSave) return;
    const protein = healthInt(form.protein), carbs = healthInt(form.carbs), fat = healthInt(form.fat);
    const fiber = netCarbs ? healthInt(form.fiber) : null;
    const calories = caloriesManual ? healthInt(form.calories) : autoCals;
    // Today = treat as training if planned (assume the user will train).
    // Past days = only training if a session was actually done.
    const isTraining = date === LB.todayISO()
      ? !!LB.plannedTrainingDay(store, date)
      : LB.isLoggedTrainingDay(store.sessions, date);
    const { adherence, targetsSnap } = dayMode
      ? { adherence: null, targetsSnap: null }
      : LB.dailyLogAdherence({ protein, carbs, fat }, targets, isTraining);
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
      waterMl: healthInt(form.water),
      note: form.note.trim() || null,
      adherence, targetsSnap,
      offPlanNote: form.offPlanNote.trim() || null,
      coachFields: Object.keys(savedCoachFields).length ? savedCoachFields : null,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    setStore(s => ({
      ...s,
      // Remember the carb mode globally so the next day defaults to it.
      settings: s.settings?.netCarbs === netCarbs ? s.settings : { ...s.settings, netCarbs },
      dailyLogs: [log, ...(s.dailyLogs || []).filter(l => l.id !== log.id && l.date !== date)],
    }));
    onClose();
  };

  const del = () => {
    if (!existing) return;
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
      <input type="number" inputMode="decimal" placeholder="—" value={form[k]} onChange={e => set(k, e.target.value)} style={inputStyle} />
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title={existing ? 'Edit Day' : 'Log Day'}>
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

      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>BODY</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {numField('weight', 'Weight', UI.unit())}
        {numField('steps', 'Steps')}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span className="micro" style={{ color: UI.inkFaint, flex: 1 }}>NUTRITION</span>
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}` }}>
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
      </div>
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
      <div style={{ marginBottom: 16 }}>
        <div style={labelStyle}>Calories (kcal){caloriesManual ? '' : (netCarbs ? ' · net carbs' : ' · from macros')}</div>
        {caloriesManual
          ? <input type="number" inputMode="decimal" placeholder="—" value={form.calories} onChange={e => set('calories', e.target.value)} style={inputStyle} />
          : <div style={{ ...inputStyle, color: autoCals != null ? UI.inkSoft : UI.inkGhost, pointerEvents: 'none', userSelect: 'none' }}>
              {autoCals != null ? autoCals : '—'}
            </div>
        }
      </div>

      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>HYDRATION</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-end' }}>
        {numField('water', 'Water', 'ml')}
        {[250, 500].map(ml => (
          <button key={ml} onClick={() => set('water', String((healthInt(form.water) || 0) + ml))} style={{
            padding: '10px 12px', borderRadius: 4, border: `0.5px solid ${UI.hairStrong}`, background: UI.bgInset,
            color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', WebkitTapHighlightColor: 'transparent',
          }}>+{ml}</button>
        ))}
      </div>

      <div style={{ marginTop: 8, marginBottom: 10 }}>
        <div style={labelStyle}>Note (optional)</div>
        <textarea rows={2} placeholder="…" value={form.note} onChange={e => set('note', e.target.value)} style={{ ...inputStyle, resize: 'none', fontFamily: UI.fontUi, fontSize: 14 }} />
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={labelStyle}>Off-plan note <span style={{ textTransform: 'none', fontWeight: 400, color: UI.inkGhost }}>(optional · prefills check-in)</span></div>
        <textarea rows={2} placeholder="e.g. Birthday cake, 2 slices" value={form.offPlanNote} onChange={e => set('offPlanNote', e.target.value)} style={{ ...inputStyle, resize: 'none', fontFamily: UI.fontUi, fontSize: 14 }} />
      </div>

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
  const effective = LB.effectiveMacroTargets(store.settings?.macroTargets, coachingMacros);
  const prefilledFromCoach = !store.settings?.macroTargets && !!effective;
  const empty = { proteinTraining: '', carbsTraining: '', fatTraining: '', proteinRest: '', carbsRest: '', fatRest: '' };
  const [form, setForm] = useStateH(empty);

  useEffectH(() => {
    if (!open) return;
    const m = effective || {};
    setForm({
      proteinTraining: m.proteinTraining != null ? String(m.proteinTraining) : '',
      carbsTraining: m.carbsTraining != null ? String(m.carbsTraining) : '',
      fatTraining: m.fatTraining != null ? String(m.fatTraining) : '',
      proteinRest: m.proteinRest != null ? String(m.proteinRest) : '',
      carbsRest: m.carbsRest != null ? String(m.carbsRest) : '',
      fatRest: m.fatRest != null ? String(m.fatRest) : '',
    });
  }, [open]);

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
      <input type="number" inputMode="numeric" placeholder="—" value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} style={inputStyle} />
    </div>
  );
  const section = (suffix, label, cals) => (
    <div style={{ marginBottom: 18 }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>{label}{cals != null ? ` · ${cals} KCAL` : ''}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {num(`protein${suffix}`, 'Protein g')}
        {num(`carbs${suffix}`, 'Carbs g')}
        {num(`fat${suffix}`, 'Fat g')}
      </div>
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Macro Targets">
      {prefilledFromCoach && (
        <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: UI.fontUi, padding: '6px 10px', background: `rgba(var(--accent-rgb),0.08)`, borderRadius: 6, border: `0.5px solid rgba(var(--accent-rgb),0.2)`, marginBottom: 14 }}>
          Prefilled from your coach — edit to set your own.
        </div>
      )}
      {section('Training', 'TRAINING DAY', calsTraining)}
      {section('Rest', 'REST DAY', calsRest)}
      <Btn onClick={save} style={{ width: '100%' }}>Save Targets</Btn>
    </Sheet>
  );
}

// ─── Today / selected-day metrics card ────────────────────────────────────────

function HealthMetricsCard({ log, dateLabel, isToday, onJumpToday, dragHandle, trained, hasCardio, dayTarget }) {
  const stat = (label, value, unit) => (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <div className="num" style={{ fontSize: 22, color: value != null ? UI.ink : UI.inkGhost, fontWeight: 300 }}>
        {value != null ? value : '—'}{value != null && unit ? <span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 3 }}>{unit}</span> : ''}
      </div>
      <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );
  const storedAdh = log?.adherence;
  const adh = storedAdh != null
    ? storedAdh
    : (log && dayTarget ? LB.macroAdherence({ protein: log.protein, carbs: log.carbs, fat: log.fat }, dayTarget) : null);
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
    <Card accent style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: trained || hasCardio ? 8 : 12 }}>
        {dragHandle}
        <span style={{ flex: 1, fontFamily: UI.fontDisplay, fontSize: 20, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: UI.ink }}>
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
        {stat('Weight', log?.weight != null ? log.weight : null, UI.unit())}
        {stat('Steps', log?.steps != null ? log.steps.toLocaleString() : null)}
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
    </Card>
  );
}


// ─── This-week overview card (Mon–Sun averages + verdict) ─────────────────────

function HealthWeekCard({ stats, dragHandle, targets, tf, setTf }) {
  const { from, to, periodDays, daysLogged, trainingsDone, trainingsPlanned, trainingDaysInPeriod, cardioMinutes, cardioSessions,
    weight, steps, stepsSum, calories, protein, carbs, fat, water, adherence,
    snapTgtCal, snapTgtProt, snapTgtCarb, snapTgtFat } = stats;
  const r = v => v == null ? null : Math.round(v);
  const range = `${healthFmtDate(from, { day: 'numeric', month: 'short' })} – ${healthFmtDate(to, { day: 'numeric', month: 'short' })}`;
  const periodLabel = tf === '1W' ? 'THIS WEEK' : tf === '1M' ? 'LAST 30 DAYS' : 'LAST 3 MONTHS';
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
      <Card style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {dragHandle}
          <span className="micro" style={{ color: UI.inkFaint, flex: 1 }}>{periodLabel}</span>
          {tfToggle}  {/* toggle on right even in empty state */}
        </div>
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi }}>Nothing logged yet.</div>
      </Card>
    );
  }

  return (
    <Card accent style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {dragHandle}
        <span className="micro" style={{ color: UI.inkFaint, flex: 1 }}>{periodLabel}</span>
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
        {cell('Weight', weight != null ? Math.round(weight * 10) / 10 : null, UI.unit())}
        {tf === '1W'
          ? cell('Steps (sum)', stepsSum != null ? r(stepsSum).toLocaleString() : null)
          : cell('Steps (avg)', steps != null ? r(steps).toLocaleString() : null)}
        {cell(cardioSessions ? `Cardio (${cardioSessions}×)` : 'Cardio', cardioMinutes ? cardioMinutes : null, 'min')}
        {cell('Water', water != null ? (Math.round(water / 100) / 10) : null, 'L')}
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

function HealthDateStrip({ store, selectedDate, onSelect, onLog }) {
  const today = LB.todayISO();
  const anchor = selectedDate || today;
  const anchorDate = new Date(anchor + 'T12:00:00');
  const jsDow = anchorDate.getDay();
  const monday = healthShiftISO(anchor, -((jsDow === 0 ? 7 : jsDow) - 1));
  const days = Array.from({ length: 7 }, (_, i) => healthShiftISO(monday, i));
  const loggedSet = new Set((store.dailyLogs || []).map(l => l.date));
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
          <input type="date" value={selectedDate}
            onChange={e => e.target.value && onSelect(e.target.value)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
          />
        </div>
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
        else if (shouldDelete) await LB.supabase.from('zane_status_periods').delete().eq('user_id', userId).is('ended_at', null);
        else      await LB.closeStatusPeriod(userId, closedAt);
      } else {
        await LB.updateStatusPeriodStart(userId, startedAt);
      }
    } catch (_) {}
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
  const fromCoach = !store.settings?.macroTargets && !!targets;
  const dailyLogs = store.dailyLogs || [];
  const selectedLog = dailyLogs.find(l => l.date === selectedDate) || null;

  // Cache targets in localStorage so the adherence bar and macro target row
  // are at their final height on the very first render (no jump when settings load).
  const [cachedTargets, setCachedTargets] = useStateH(() => {
    try { return JSON.parse(localStorage.getItem('logbook-health-targets') || 'null'); } catch { return null; }
  });
  // targets is null until coachingMacros loads (async). Use cached value from the
  // previous visit so adherence bar + target rows are visible on the first render.
  const effectiveTargets = targets ?? cachedTargets;
  useEffectH(() => {
    if (targets === null && cachedTargets !== null) return; // don't overwrite a good cache with a transient null
    try { localStorage.setItem('logbook-health-targets', JSON.stringify(targets)); } catch {}
    if (targets !== cachedTargets) setCachedTargets(targets);
  }, [targets]);

  // Retroactive heal: if a past planned training day has no session, its daily log
  // was saved with training targets but those macros were never earned — correct to rest.
  useEffectH(() => {
    if (!effectiveTargets) return;
    const today = LB.todayISO();
    const dayOf = s => s.date ? s.date.slice(0, 10) : null;
    const sessionDates = new Set((store.sessions || []).filter(s => s.ended).map(dayOf).filter(Boolean));
    const restTarget = LB.dayTargetFromMacros(effectiveTargets, false);
    if (!restTarget) return;
    const toHeal = (store.dailyLogs || []).filter(l =>
      l.date < today &&
      l.targetsSnap?.dayType === 'training' &&
      !sessionDates.has(l.date) &&
      !!LB.plannedTrainingDay(store, l.date)
    );
    if (!toHeal.length) return;
    const healDates = new Set(toHeal.map(l => l.date));
    const restSnap = { ...restTarget, dayType: 'rest' };
    setStore(s => ({
      ...s,
      dailyLogs: s.dailyLogs.map(l => {
        if (!healDates.has(l.date)) return l;
        const adherence = LB.macroAdherence({ protein: l.protein, carbs: l.carbs, fat: l.fat }, restTarget);
        return adherence != null ? { ...l, adherence, targetsSnap: restSnap } : l;
      }),
    }));
  }, [store.sessions, store.dailyLogs, effectiveTargets]);

  // Windowed series builder for the charts. The x-range is tightened to the
  // actual logged days inside the window (not the full timeframe) so a sparse
  // window doesn't leave most of the chart empty — 80 of 90 days fills the chart.
  const tfDays = id => (HEALTH_TFS.find(t => t.id === id) || HEALTH_TFS[1]).days;
  const seriesFor = (days, pick) => {
    const { start, end } = healthWindow(days);
    const data = dailyLogs.filter(l => l.date >= start && l.date <= end).map(l => ({ date: l.date, ...pick(l) }));
    const dates = data.map(d => d.date);
    let from = dates.length ? dates.reduce((a, b) => a < b ? a : b) : start;
    let to = dates.length ? dates.reduce((a, b) => a > b ? a : b) : end;
    if (from === to) { from = healthShiftISO(from, -1); to = healthShiftISO(to, 1); }
    return { from, to, data };
  };

  const windowDays = tfDays(tf);
  const weightSeries = useMemoH(() => seriesFor(windowDays, l => ({ value: l.weight })), [dailyLogs, tf]);
  const stepsSeries = useMemoH(() => seriesFor(windowDays, l => ({ value: l.steps })), [dailyLogs, tf]);
  const macroSeries = useMemoH(() => seriesFor(windowDays, l => ({ protein: l.protein, carbs: l.carbs, fat: l.fat, calories: l.calories, targetCal: l.targetsSnap?.calories ?? null })), [dailyLogs, tf]);
  const adhSeries = useMemoH(() => seriesFor(windowDays, l => ({ value: l.adherence })), [dailyLogs, tf]);

  // Cardio chart series — minutes summed per day from store.cardioLogs.
  const cardioSeries = useMemoH(() => {
    const { start, end } = healthWindow(windowDays);
    const byDay = {};
    (store.cardioLogs || []).forEach(l => { if (l.date >= start && l.date <= end) byDay[l.date] = (byDay[l.date] || 0) + (l.durationMinutes || 0); });
    const data = Object.keys(byDay).map(date => ({ date, value: byDay[date] }));
    const dates = data.map(d => d.date);
    let from = dates.length ? dates.reduce((a, b) => a < b ? a : b) : start;
    let to = dates.length ? dates.reduce((a, b) => a > b ? a : b) : end;
    if (from === to) { from = healthShiftISO(from, -1); to = healthShiftISO(to, 1); }
    return { from, to, data };
  }, [store.cardioLogs, tf]);

  // Historical avg macro target for the chart window (from persisted targetsSnap).
  // For 1M/3M this replaces the current training/rest split in the Macro card target row.
  const macroTargetAvg = useMemoH(() => {
    if (tf === '1W') return null;
    const { start, end } = healthWindow(windowDays);
    const withSnap = dailyLogs.filter(l => l.date >= start && l.date <= end && l.targetsSnap);
    if (!withSnap.length) return null;
    const avg = k => Math.round(withSnap.reduce((s, l) => s + (l.targetsSnap[k] || 0), 0) / withSnap.length);
    return { calories: avg('calories'), protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat') };
  }, [dailyLogs, tf]);

  const avg = (arr, key) => { const vs = arr.map(d => d[key]).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; };
  const weightAvgRaw = avg(weightSeries.data, 'value');
  const weightAvg = weightAvgRaw != null ? Math.round(weightAvgRaw * 10) / 10 : null;
  const stepsAvg = avg(stepsSeries.data, 'value');
  const adhAvg = avg(adhSeries.data, 'value');
  const cardioTotal = cardioSeries.data.reduce((s, d) => s + (d.value || 0), 0);

  // Reorderable card order, persisted per device. Missing ids (e.g. after a new
  // card ships) are inserted at their default position, not appended at the end.
  const CARD_ORDER_KEY = 'logbook-health-card-order';
  const DEFAULT_CARD_ORDER = ['week', 'today', 'macros', 'adherence', 'weight', 'cardio', 'steps'];
  const [cardOrder, setCardOrder] = useStateH(() => {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(CARD_ORDER_KEY) || '[]'); } catch (_) {}
    const result = (Array.isArray(saved) ? saved : []).filter(id => DEFAULT_CARD_ORDER.includes(id));
    DEFAULT_CARD_ORDER.forEach((id, i) => { if (!result.includes(id)) result.splice(Math.min(i, result.length), 0, id); });
    return result;
  });
  const reorderCards = (from, to) => {
    if (from === to) return;
    setCardOrder(prev => {
      const visible = prev.filter(id => cardEls[id]);
      const moved = [...visible];
      const [m] = moved.splice(from, 1);
      moved.splice(to, 0, m);
      const next = [...moved, ...prev.filter(id => !visible.includes(id))];
      try { localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  // Period overview — adapts to tf: 1W = current Mon–Sun, 1M/3M = rolling window.
  const weekStats = useMemoH(() => {
    const dayOf = s => s.date ? (typeof s.date === 'string' ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10)) : null;
    let from, to, periodDays;
    if (tf === '1W') {
      const anchor = selectedDate;
      const jsDow = new Date(anchor + 'T12:00:00').getDay();
      const monday = healthShiftISO(anchor, -((jsDow === 0 ? 7 : jsDow) - 1));
      from = monday; to = healthShiftISO(monday, 6); periodDays = 7;
    } else {
      const days = tfDays(tf);
      to = today; from = healthShiftISO(today, -(days - 1)); periodDays = days;
    }
    const allDays = Array.from({ length: periodDays }, (_, i) => healthShiftISO(from, i));
    const inPeriod = dailyLogs.filter(l => l.date >= from && l.date <= to);
    const avgK = k => { const vs = inPeriod.map(l => l[k]).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; };
    const sumK = k => { const vs = inPeriod.map(l => l[k]).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) : null; };
    const sessionDatesInPeriod = new Set((store.sessions || []).filter(s => s.ended).map(s => dayOf(s)).filter(d => d && d >= from && d <= to));
    const trainingsDone = sessionDatesInPeriod.size;
    const trainingsPlanned = allDays.filter(d => d <= today && LB.plannedTrainingDay(store, d)).length;
    // Training days for macro target avg: future planned days count as training (not yet missed),
    // past planned days only count if a session was actually done (missed = rest day, no earned macros).
    const trainingDaysInPeriod = allDays.filter(d => {
      if (!LB.plannedTrainingDay(store, d)) return false;
      if (d < today) return sessionDatesInPeriod.has(d);
      return true;
    }).length;
    const periodCardio = (store.cardioLogs || []).filter(l => l.date >= from && l.date <= to);
    // Historical target avg from persisted targetsSnap (correct even after target changes).
    // Only used for 1M/3M; 1W falls back to plan-weighted current targets in the card.
    const withSnap = tf !== '1W' ? inPeriod.filter(l => l.targetsSnap) : [];
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
  }, [dailyLogs, store.sessions, store.cardioLogs, store.schedules, store.activeScheduleId, store.cycleStartDate, store.weekPlanStartDate, today, selectedDate, tf]);

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
    : `DAILY TARGETS${fromCoach ? ' · FROM COACH' : ''}`;
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
    </div>
  );

  const handle = <DragHandle style={{ width: 20, height: 22, marginLeft: -4, cursor: 'grab' }} />;
  const dayLabel = selectedDate === today ? 'Today' : healthFmtDate(selectedDate, { weekday: 'short', day: 'numeric', month: 'short' });
  const trainedSelected = LB.isLoggedTrainingDay(store.sessions, selectedDate);
  const cardioSelected = (store.cardioLogs || []).some(l => l.date === selectedDate);
  const dayIsTraining = trainedSelected || (selectedDate >= today && !!LB.plannedTrainingDay(store, selectedDate));
  const selectedDayTarget = LB.dayTargetFromMacros(effectiveTargets, dayIsTraining);
  const cardEls = {
    week: <HealthWeekCard stats={weekStats} dragHandle={handle} targets={effectiveTargets} tf={tf} setTf={setTf} />,
    today: <HealthMetricsCard log={selectedLog} dateLabel={dayLabel} isToday={selectedDate === today} onJumpToday={() => setSelectedDate(today)} dragHandle={handle} trained={trainedSelected} hasCardio={cardioSelected} dayTarget={selectedDayTarget} />,
    weight: (
      <HealthChartCard title="Weight" icon="fa-weight-scale" tf={tf} setTf={setTf} dragHandle={handle}
        headline={weightAvg != null ? `${weightAvg}${UI.unit()}` : null} sub={weightAvg != null ? 'avg' : null}>
        <HealthLineChart series={weightSeries.data} from={weightSeries.from} to={weightSeries.to} format={v => `${v}`} />
      </HealthChartCard>
    ),
    steps: (
      <HealthChartCard title="Steps" icon="fa-shoe-prints" tf={tf} setTf={setTf} dragHandle={handle}
        headline={stepsAvg != null ? Math.round(stepsAvg).toLocaleString() : null} sub={stepsAvg != null ? 'avg / day' : null}>
        <HealthBarChart series={stepsSeries.data} from={stepsSeries.from} to={stepsSeries.to} format={v => v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`} />
      </HealthChartCard>
    ),
    macros: (
      <HealthChartCard title="Macros" icon="fa-utensils" tf={tf} setTf={setTf} dragHandle={handle}>
        {targetRow}
        <HealthMacroChart series={macroSeries.data} from={macroSeries.from} to={macroSeries.to} />
        <MacroLegend />
      </HealthChartCard>
    ),
    cardio: (
      <HealthChartCard title="Cardio" icon="fa-person-running" tf={tf} setTf={setTf} dragHandle={handle}
        headline={cardioTotal ? cardioTotal : null} sub={cardioTotal ? 'min total' : null}>
        <HealthBarChart series={cardioSeries.data} from={cardioSeries.from} to={cardioSeries.to} format={v => `${Math.round(v)}`} />
      </HealthChartCard>
    ),
    adherence: effectiveTargets ? (
      <HealthChartCard title="Macro Adherence" icon="fa-bullseye" tf={tf} setTf={setTf} dragHandle={handle}
        headline={adhAvg != null ? `${Math.round(adhAvg)}%` : null} sub={adhAvg != null ? 'avg' : null}>
        <HealthLineChart series={adhSeries.data} from={adhSeries.from} to={adhSeries.to} format={v => `${Math.round(v)}%`} yMin={0} yMax={100} />
      </HealthChartCard>
    ) : null,
  };

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
          <i className={`fa-solid ${store.statusMode === 'sick' ? 'fa-bed-pulse' : 'fa-umbrella-beach'}`} style={{ fontSize: 14, color: 'var(--accent)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              {store.statusMode === 'sick' ? 'Sick' : 'Vacation'}
              {store.statusModeSince ? ` · Since ${new Date(store.statusModeSince).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
            </div>
            <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Tap to manage or deactivate</div>
          </div>
          <i className="fa-solid fa-chevron-right" style={{ fontSize: 9, color: UI.inkFaint }} />
        </div>
      )}
      <div ref={captureRef}>
        <HealthDateStrip store={store} selectedDate={selectedDate} onSelect={setSelectedDate} onLog={() => setLogOpen(true)} />

        {/* max-width cap so charts don't blow up on iPad. Reorderable cards —
           drag the grip to reorder; order persists per device. */}
        <div style={{ padding: capturing ? '8px 16px 16px' : '8px 16px calc(env(safe-area-inset-bottom, 0px) + 100px)', maxWidth: 680, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
          <ReorderList onReorder={reorderCards} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {cardOrder.map(id => cardEls[id] ? (
              <div key={id} data-reorder-item="true" data-tour={`health-card-${id}`}>{cardEls[id]}</div>
            ) : null)}
          </ReorderList>
        </div>
      </div>

      <DailyLogSheet open={logOpen} onClose={() => setLogOpen(false)} store={store} setStore={setStore} date={selectedDate} targets={targets} activeCoachingSchema={activeCoachingSchema} onSetStatus={handleSetStatus} />
      <MacroTargetSheet open={targetOpen} onClose={() => setTargetOpen(false)} store={store} setStore={setStore} coachingMacros={coachingMacros} />
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} store={store} />
    </Screen>
  );
}

// ─── Coach read-only view (rendered inside CoachClientScreen's "Daily" tab) ─────

function HealthClientLogs({ clientStore }) {
  const logs = clientStore?.dailyLogs || [];
  const cardioLogs = clientStore?.cardioLogs || [];
  const [tf, setTf] = useStateH('1W');

  const COACH_ORDER_KEY = 'logbook-coach-health-card-order';
  const DEFAULT_COACH_ORDER = ['week', 'today', 'weight', 'steps', 'macros', 'cardio', 'adherence', 'weekly'];
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
      const moved = [...prev];
      const [m] = moved.splice(from, 1);
      moved.splice(to, 0, m);
      try { localStorage.setItem(COACH_ORDER_KEY, JSON.stringify(moved)); } catch (_) {}
      return moved;
    });
  };

  const [selectedDate, setSelectedDate] = useStateH(() => LB.todayISO());

  const tfDays = id => (HEALTH_TFS.find(t => t.id === id) || HEALTH_TFS[1]).days;
  const windowDays = tfDays(tf);

  const seriesFor = (days, pick) => {
    const { start, end } = healthWindow(days);
    const data = logs.filter(l => l.date >= start && l.date <= end).map(l => ({ date: l.date, ...pick(l) }));
    const dates = data.map(d => d.date);
    let from = dates.length ? dates.reduce((a, b) => a < b ? a : b) : start;
    let to = dates.length ? dates.reduce((a, b) => a > b ? a : b) : end;
    if (from === to) { from = healthShiftISO(from, -1); to = healthShiftISO(to, 1); }
    return { from, to, data };
  };

  const weightSeries = useMemoH(() => seriesFor(windowDays, l => ({ value: l.weight })), [logs, tf]);
  const stepsSeries  = useMemoH(() => seriesFor(windowDays, l => ({ value: l.steps })), [logs, tf]);
  const macroSeries  = useMemoH(() => seriesFor(windowDays, l => ({ protein: l.protein, carbs: l.carbs, fat: l.fat, calories: l.calories, targetCal: l.targetsSnap?.calories ?? null })), [logs, tf]);
  const adhSeries    = useMemoH(() => seriesFor(windowDays, l => ({ value: l.adherence })), [logs, tf]);
  const cardioSeries = useMemoH(() => {
    const { start, end } = healthWindow(windowDays);
    const byDay = {};
    cardioLogs.forEach(l => { if (l.date >= start && l.date <= end) byDay[l.date] = (byDay[l.date] || 0) + (l.durationMinutes || 0); });
    const data = Object.keys(byDay).map(date => ({ date, value: byDay[date] }));
    const dates = data.map(d => d.date);
    let from = dates.length ? dates.reduce((a, b) => a < b ? a : b) : start;
    let to = dates.length ? dates.reduce((a, b) => a > b ? a : b) : end;
    if (from === to) { from = healthShiftISO(from, -1); to = healthShiftISO(to, 1); }
    return { from, to, data };
  }, [cardioLogs, tf]);

  const numAvg = series => { const vs = series.data.map(d => d.value).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; };
  const weightAvg = useMemoH(() => { const a = numAvg(weightSeries); return a != null ? Math.round(a * 10) / 10 : null; }, [weightSeries]);
  const stepsAvg  = useMemoH(() => { const a = numAvg(stepsSeries);  return a != null ? Math.round(a) : null; }, [stepsSeries]);
  const adhAvg    = useMemoH(() => { const a = numAvg(adhSeries);    return a != null ? Math.round(a) : null; }, [adhSeries]);
  const cardioTotal = cardioSeries.data.reduce((s, d) => s + (d.value || 0), 0);

  // Weekly summary (Mon-anchored) for the last 8 weeks with any data.
  const weeks = useMemoH(() => {
    const byWeek = {};
    for (const l of logs) {
      const d = new Date(l.date + 'T12:00:00');
      const dow = d.getDay(); const mon = new Date(d); mon.setDate(d.getDate() - ((dow === 0 ? 7 : dow) - 1));
      const ws = mon.toISOString().slice(0, 10);
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

  const weekStats = useMemoH(() => {
    const dayOf = s => s.date ? (typeof s.date === 'string' ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10)) : null;
    let from, to, periodDays;
    if (tf === '1W') {
      const anchor = selectedDate;
      const jsDow = new Date(anchor + 'T12:00:00').getDay();
      const monday = healthShiftISO(anchor, -((jsDow === 0 ? 7 : jsDow) - 1));
      from = monday; to = healthShiftISO(monday, 6); periodDays = 7;
    } else {
      const days = tfDays(tf);
      to = today; from = healthShiftISO(today, -(days - 1)); periodDays = days;
    }
    const allDays = Array.from({ length: periodDays }, (_, i) => healthShiftISO(from, i));
    const inPeriod = logs.filter(l => l.date >= from && l.date <= to);
    const avgK = k => { const vs = inPeriod.map(l => l[k]).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; };
    const sumK = k => { const vs = inPeriod.map(l => l[k]).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) : null; };
    const sessionDatesInPeriod = new Set((clientStore?.sessions || []).filter(s => s.ended).map(s => dayOf(s)).filter(d => d && d >= from && d <= to));
    const trainingsDone = sessionDatesInPeriod.size;
    const trainingsPlanned = allDays.filter(d => d <= today && LB.plannedTrainingDay(clientStore || {}, d)).length;
    const trainingDaysInPeriod = allDays.filter(d => {
      if (!LB.plannedTrainingDay(clientStore || {}, d)) return false;
      if (d < today) return sessionDatesInPeriod.has(d);
      return true;
    }).length;
    const periodCardio = (clientStore?.cardioLogs || []).filter(l => l.date >= from && l.date <= to);
    const withSnap = tf !== '1W' ? inPeriod.filter(l => l.targetsSnap) : [];
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
  }, [logs, clientStore?.sessions, clientStore?.cardioLogs, clientStore?.schedules, clientStore?.activeScheduleId, clientStore?.cycleStartDate, clientStore?.weekPlanStartDate, today, selectedDate, tf]);

  if (!logs.length && !cardioLogs.length) {
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
    week: <HealthWeekCard stats={weekStats} dragHandle={handle} targets={null} tf={tf} setTf={setTf} />,
    today: (
      <HealthMetricsCard log={selectedLog} dateLabel={dayLabel} isToday={selectedDate === today} onJumpToday={() => setSelectedDate(today)}
        dragHandle={handle} trained={trainedSelected} hasCardio={cardioSelected} dayTarget={null} />
    ),
    weight: (
      <HealthChartCard title="Weight" icon="fa-weight-scale" tf={tf} setTf={setTf} dragHandle={handle}
        headline={weightAvg != null ? `${weightAvg}` : null} sub={weightAvg != null ? 'avg' : null}>
        <HealthLineChart series={weightSeries.data} from={weightSeries.from} to={weightSeries.to} format={v => `${v}`} />
      </HealthChartCard>
    ),
    steps: (
      <HealthChartCard title="Steps" icon="fa-shoe-prints" tf={tf} setTf={setTf} dragHandle={handle}
        headline={stepsAvg != null ? stepsAvg.toLocaleString() : null} sub={stepsAvg != null ? 'avg / day' : null}>
        <HealthBarChart series={stepsSeries.data} from={stepsSeries.from} to={stepsSeries.to} format={v => v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`} />
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
    weekly: weeks.length ? (
      <Card style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {handle}
          <span className="micro" style={{ color: UI.inkFaint }}>WEEKLY AVERAGES</span>
        </div>
        <div style={{ background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
          {weeks.map((w, i) => (
            <div key={w.ws} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: i ? `0.5px solid ${UI.hair}` : 'none' }}>
              <div style={{ width: 58, flexShrink: 0, fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>{healthFmtDate(w.ws, { day: 'numeric', month: 'short' })}</div>
              <div style={{ flex: 1, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {w.weight != null && <span className="num" style={{ fontSize: 11, color: UI.inkSoft }}>{w.weight} {UI.unit()}</span>}
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
        <ReorderList onReorder={reorderCards} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {cardOrder.map(id => cardEls[id] ? (
            <div key={id} data-reorder-item="true">{cardEls[id]}</div>
          ) : null)}
        </ReorderList>
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
    (store.sessions || []).filter(s => s.ended && s.date >= from && s.date <= to).forEach(s => {
      const d = typeof s.date === 'string' ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10);
      if (!m[d]) m[d] = [];
      m[d].push(s);
    });
    return m;
  };

  const doExportCSV = () => {
    setExporting('csv');
    try {
      const unit = store.settings?.unit || 'kg';
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
      const unit = store.settings?.unit || 'kg';
      const cs = getComputedStyle(document.documentElement);
      const v = k => cs.getPropertyValue(k).trim();
      const bg        = v('--bg')         || '#1a1820';
      const bgCard    = v('--bg-raised')   || '#201e2c';
      const accent    = v('--accent')      || '#c9a961';
      const hairStrong= v('--hair-strong') || '#3d3a4e';
      const inkSoft   = v('--ink-soft')    || '#9b97a8';
      const inkFaint  = v('--ink-faint')   || '#5c5969';
      const hair      = v('--hair')        || '#2e2b3d';
      const ok        = v('--ok')          || '#22c55e';
      const danger    = v('--danger')      || '#ef4444';

      const adhColor = adh => adh == null ? inkFaint : adh >= 90 ? ok : adh >= 75 ? '#d97706' : danger;

      const cardsHtml = logs.length === 0
        ? `<div style="color:${inkFaint};font-size:14px;text-align:center;padding:40px">No data in this range.</div>`
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
                 <div style="font-size:18px;font-weight:300;color:#e5e2ef;font-family:monospace">${value}${unit ? `<span style="font-size:9px;color:${inkFaint};margin-left:2px">${unit}</span>` : ''}</div>
                 <div style="font-size:8px;text-transform:uppercase;letter-spacing:0.08em;color:${inkFaint};margin-top:2px">${label}</div>
               </div>`
            : '';

          const badge = (icon, label) =>
            `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,0.06);border:0.5px solid rgba(255,255,255,0.08);font-size:9px;letter-spacing:0.07em;text-transform:uppercase;color:${inkSoft}">
               <span>${icon}</span>${label}
             </span>`;

          const adhBar = adh != null
            ? `<div style="margin-bottom:12px">
                 <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
                   <div style="height:4px;flex:1;background:rgba(255,255,255,0.07);border-radius:999px;overflow:hidden">
                     <div style="height:100%;width:${Math.min(100, adh)}%;background:${ac};border-radius:999px"></div>
                   </div>
                   <span style="font-size:10px;color:${ac};font-weight:700;font-family:monospace;flex-shrink:0">${adh}%</span>
                 </div>
               </div>`
            : '';

          const sessionNames = daySessions.map(s => s.dayName || s.day_name || '').filter(Boolean).join(', ');
          const sessionDur = daySessions.reduce((sum, s) => sum + (s.durationMinutes || s.duration_minutes || 0), 0);

          return `<div style="background:${bgCard};border:1px solid ${hairStrong};border-radius:8px;padding:16px;margin-bottom:12px;page-break-inside:avoid">
            <div style="font-size:13px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#e5e2ef;margin-bottom:${(trained || hasCardio) ? 8 : 12}px">${dateLabel}</div>
            ${(trained || hasCardio) ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:${sessionNames ? 6 : 10}px">${trained ? badge('🏋', sessionNames ? `${sessionNames}${sessionDur ? ` · ${sessionDur} min` : ''}` : 'Trained') : ''}${hasCardio ? badge('🏃', 'Cardio') : ''}</div>` : ''}
            ${adhBar}
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px 6px">
              ${stat(`Weight (${unit})`, l.weight)}
              ${stat('Steps', l.steps != null ? l.steps.toLocaleString() : null)}
              ${stat('Cardio', cardioMin || null, 'min')}
              ${stat('Water', l.waterMl != null ? (Math.round(l.waterMl / 100) / 10).toFixed(1) : null, 'L')}
              ${stat('Calories', l.calories, 'kcal')}
              ${stat('Protein', l.protein, 'g')}
              ${stat('Carbs', l.carbs, 'g')}
              ${stat('Fat', l.fat, 'g')}
            </div>
            ${l.note || l.offPlanNote ? `<div style="margin-top:10px;padding-top:10px;border-top:0.5px solid ${hair};font-size:11px;color:${inkSoft};line-height:1.5">${[l.note, l.offPlanNote].filter(Boolean).join(' · ')}</div>` : ''}
          </div>`;
        }).join('');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <title>Health Export ${from} – ${to}</title>
        <style>
          *,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
          @page{margin:15mm 0}
          html,body{background:${bg}!important}
          body{color:#e5e2ef;font-family:system-ui,-apple-system,sans-serif;padding:16px 20px;max-width:600px;margin:0 auto}
          .toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
          .toolbar button{background:rgba(255,255,255,0.08);border:0.5px solid rgba(255,255,255,0.15);border-radius:6px;color:#e5e2ef;font-family:system-ui,sans-serif;font-size:12px;font-weight:600;padding:8px 14px;cursor:pointer}
          .ios-hint{display:none;font-size:11px;color:rgba(229,226,239,0.5);margin-bottom:12px;line-height:1.5}
          h1{font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};font-weight:600}
          @media print{.toolbar{display:none}.ios-hint{display:none}}
        </style>
      </head><body>
        <div class="toolbar">
          <h1>Health &middot; ${from} &ndash; ${to}</h1>
          <div style="display:flex;gap:8px">
            <button id="pdf-btn" onclick="window.print()">Save as PDF</button>
            <button onclick="window.close()">← Close</button>
          </div>
        </div>
        <div class="ios-hint" id="ios-hint">To save as PDF: tap the Share button ↑ → Print (then pinch out on the preview)</div>
        ${cardsHtml}
        <script>
          var isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent)&&!window.MSStream;
          if(isIOS){document.getElementById('pdf-btn').style.display='none';document.getElementById('ios-hint').style.display='block';}
          else{window.onload=function(){window.print()};}
        <\/script>
      </body></html>`;

      const w = window.open('', '_blank', 'width=680,height=900');
      if (w) { w.document.write(html); w.document.close(); }
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
