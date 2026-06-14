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

// Calories from macros: P×4 + C×4 + F×9. Returns null when no macro is set.
function caloriesFromMacros(p, c, f) {
  if (p == null && c == null && f == null) return null;
  return (p || 0) * 4 + (c || 0) * 4 + (f || 0) * 9;
}

function healthFmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, opts);
}

// Adherence → traffic-light colour (green ≥90, amber 75–89, red <75).
function adherenceColor(a) {
  if (a == null) return UI.inkFaint;
  if (a >= 90) return 'var(--ok)';
  if (a >= 75) return 'var(--accent)';
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

// Section wrapper: title + 1W/1M/3M toggle + subtitle.
function HealthChartCard({ title, icon, tf, setTf, headline, sub, children }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {icon && <i className={`fa-solid ${icon}`} style={{ fontSize: 11, color: UI.inkFaint }} />}
        <span className="micro" style={{ color: UI.inkFaint, flex: 1 }}>{title}</span>
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}` }}>
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

function DailyLogSheet({ open, onClose, store, setStore, date, targets }) {
  const existing = useMemoH(() => (store.dailyLogs || []).find(l => l.date === date), [store.dailyLogs, date]);
  const empty = { weight: '', steps: '', protein: '', carbs: '', fat: '', calories: '', water: '', note: '' };
  const [form, setForm] = useStateH(empty);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffectH(() => {
    if (!open) return;
    if (existing) {
      setForm({
        weight: existing.weight != null ? String(existing.weight) : '',
        steps: existing.steps != null ? String(existing.steps) : '',
        protein: existing.protein != null ? String(existing.protein) : '',
        carbs: existing.carbs != null ? String(existing.carbs) : '',
        fat: existing.fat != null ? String(existing.fat) : '',
        calories: existing.calories != null ? String(existing.calories) : '',
        water: existing.waterMl != null ? String(existing.waterMl) : '',
        note: existing.note || '',
      });
    } else setForm(empty);
  }, [open, date, existing?.id]);

  const daysBack = healthDayDiff(date, LB.todayISO());
  const inFuture = daysBack < 0;
  const tooOld = !existing && daysBack > 14;
  const canSave = open && !inFuture && !tooOld;

  const autoCals = caloriesFromMacros(healthInt(form.protein), healthInt(form.carbs), healthInt(form.fat));

  const save = () => {
    if (!canSave) return;
    const protein = healthInt(form.protein), carbs = healthInt(form.carbs), fat = healthInt(form.fat);
    const calories = form.calories !== '' ? healthInt(form.calories) : caloriesFromMacros(protein, carbs, fat);
    const isTraining = LB.isLoggedTrainingDay(store.sessions, date);
    const { adherence, targetsSnap } = LB.dailyLogAdherence({ protein, carbs, fat }, targets, isTraining);
    const log = {
      id: existing?.id || LB.uid(),
      date,
      weight: healthNum(form.weight),
      steps: healthInt(form.steps),
      calories, protein, carbs, fat,
      waterMl: healthInt(form.water),
      note: form.note.trim() || null,
      adherence, targetsSnap,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    setStore(s => ({ ...s, dailyLogs: [log, ...(s.dailyLogs || []).filter(l => l.id !== log.id && l.date !== date)] }));
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

      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>NUTRITION</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {numField('protein', 'Protein', 'g')}
        {numField('carbs', 'Carbs', 'g')}
        {numField('fat', 'Fat', 'g')}
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={labelStyle}>Calories (kcal)</div>
        <input type="number" inputMode="numeric" placeholder={autoCals != null ? `${autoCals} (from macros)` : '—'} value={form.calories} onChange={e => set('calories', e.target.value)} style={inputStyle} />
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

      <div style={{ marginTop: 8, marginBottom: 18 }}>
        <div style={labelStyle}>Note (optional)</div>
        <textarea rows={2} placeholder="…" value={form.note} onChange={e => set('note', e.target.value)} style={{ ...inputStyle, resize: 'none', fontFamily: UI.fontUi, fontSize: 14 }} />
      </div>

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

function HealthMetricsCard({ log }) {
  const stat = (label, value, unit) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="num" style={{ fontSize: 22, color: value != null ? UI.ink : UI.inkGhost, fontWeight: 300 }}>
        {value != null ? value : '—'}{value != null && unit ? <span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 3 }}>{unit}</span> : ''}
      </div>
      <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );
  const adh = log?.adherence;
  return (
    <Card accent style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        {stat('Weight', log?.weight != null ? log.weight : null, UI.unit())}
        {stat('Steps', log?.steps != null ? log.steps.toLocaleString() : null)}
        {stat('Calories', log?.calories != null ? log.calories : null, 'kcal')}
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: adh != null ? 14 : 0 }}>
        {stat('Protein', log?.protein != null ? log.protein : null, 'g')}
        {stat('Carbs', log?.carbs != null ? log.carbs : null, 'g')}
        {stat('Fat', log?.fat != null ? log.fat : null, 'g')}
      </div>
      {adh != null && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
            <span className="micro" style={{ color: UI.inkFaint }}>MACRO ADHERENCE</span>
            <span className="num" style={{ fontSize: 13, color: adherenceColor(adh) }}>{adh}%</span>
          </div>
          <div style={{ height: 7, borderRadius: 4, background: UI.bgInset, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, adh)}%`, height: '100%', background: adherenceColor(adh), transition: 'width 0.3s' }} />
          </div>
        </div>
      )}
    </Card>
  );
}


// ─── This-week overview card (Mon–Sun averages + verdict) ─────────────────────

function HealthWeekCard({ stats }) {
  const { from, to, daysLogged, daysTrained, weight, steps, calories, protein, carbs, fat, water, adherence } = stats;
  const r = v => v == null ? null : Math.round(v);
  const range = `${healthFmtDate(from, { day: 'numeric', month: 'short' })} – ${healthFmtDate(to, { day: 'numeric', month: 'short' })}`;
  const verdict = adherence == null ? null : adherence >= 90 ? 'Strong week' : adherence >= 75 ? 'On track' : 'Off track';

  const cell = (label, value, unit) => (
    <div style={{ minWidth: 0 }}>
      <div className="num" style={{ fontSize: 16, color: value != null ? UI.ink : UI.inkGhost, fontWeight: 300, whiteSpace: 'nowrap' }}>
        {value != null ? value : '—'}{value != null && unit ? <span style={{ fontSize: 9, color: UI.inkFaint, marginLeft: 2 }}>{unit}</span> : ''}
      </div>
      <div style={{ fontSize: 8.5, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.07em', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );

  if (!daysLogged) {
    return (
      <Card style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 8 }}>
          <span className="micro" style={{ color: UI.inkFaint, flex: 1 }}>THIS WEEK</span>
          <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{range}</span>
        </div>
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi }}>Nothing logged yet this week.</div>
      </Card>
    );
  }

  return (
    <Card accent style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: adherence != null ? 12 : 14 }}>
        <span className="micro" style={{ color: UI.inkFaint, flex: 1 }}>THIS WEEK</span>
        <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{range}</span>
      </div>

      {adherence != null && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <span className="num" style={{ fontSize: 30, color: adherenceColor(adherence), fontWeight: 300, lineHeight: 1 }}>{r(adherence)}%</span>
            <span style={{ fontSize: 12, color: adherenceColor(adherence), fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.04em' }}>{verdict}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.06em', textTransform: 'uppercase' }}>avg adherence</span>
          </div>
          <div style={{ height: 6, borderRadius: 4, background: UI.bgInset, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, adherence)}%`, height: '100%', background: adherenceColor(adherence) }} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px 8px' }}>
        {cell('Weight', weight != null ? Math.round(weight * 10) / 10 : null, UI.unit())}
        {cell('Steps', steps != null ? r(steps).toLocaleString() : null)}
        {cell('Calories', r(calories), 'kcal')}
        {cell('Water', water != null ? (Math.round(water / 100) / 10) : null, 'L')}
        {cell('Protein', r(protein), 'g')}
        {cell('Carbs', r(carbs), 'g')}
        {cell('Fat', r(fat), 'g')}
        {cell('Logged', `${daysLogged}/7`, daysTrained ? `· ${daysTrained} tr` : '')}
      </div>
    </Card>
  );
}

// ─── Date strip (current week Mon–Sun) ────────────────────────────────────────

function HealthDateStrip({ store, selectedDate, onSelect, onLog }) {
  const today = LB.todayISO();
  const now = new Date(today + 'T12:00:00');
  const jsDow = now.getDay();
  const monday = healthShiftISO(today, -((jsDow === 0 ? 7 : jsDow) - 1));
  const days = Array.from({ length: 7 }, (_, i) => healthShiftISO(monday, i));
  const loggedSet = new Set((store.dailyLogs || []).map(l => l.date));
  const trainedSet = new Set(
    (store.sessions || []).filter(s => s.ended).map(s => {
      const d = s.date; if (!d) return null;
      return typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
    }).filter(Boolean)
  );

  return (
    <div style={{
      flexShrink: 0, padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 16px 10px',
      position: 'sticky', top: 0, zIndex: 5,
      background: 'rgba(var(--bg-rgb),0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
    }}>
      {/* Day cells — same card style as the home screen day strip */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {days.map((d, i) => {
          const sel = d === selectedDate;
          const has = loggedSet.has(d);
          const trained = trainedSet.has(d);
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
                  <i className="fa-solid fa-dumbbell" style={{ fontSize: 9, color: sel || has ? 'var(--accent)' : UI.inkFaint }} />
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
        <button onClick={onLog} style={{
          height: 34, borderRadius: 4, border: 'none',
          background: 'linear-gradient(180deg, var(--accent-light), var(--accent))',
          color: '#0a0805', cursor: 'pointer', padding: '0 14px',
          fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
          WebkitTapHighlightColor: 'transparent',
        }}>
          <i className="fa-solid fa-plus" style={{ fontSize: 11 }} /> LOG
        </button>
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
  const [tf, setTf] = useStateH('1M');

  // Load coach-assigned macros (used to prefill targets + power adherence when
  // the user hasn't set personal targets). asClient or self-coaching row.
  const coachingId = store.coaching?.asClient?.id || store.coaching?.asSelf?.id || null;
  useEffectH(() => {
    if (!coachingId) { setCoachingMacros(null); return; }
    let cancelled = false;
    LB.loadCoachingMacros(coachingId).then(data => { if (!cancelled) setCoachingMacros(data[0] || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [coachingId]);

  const targets = LB.effectiveMacroTargets(store.settings?.macroTargets, coachingMacros);
  const fromCoach = !store.settings?.macroTargets && !!targets;
  const dailyLogs = store.dailyLogs || [];
  const selectedLog = dailyLogs.find(l => l.date === selectedDate) || null;

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

  const avg = (arr, key) => { const vs = arr.map(d => d[key]).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; };
  const wVals = weightSeries.data.map(d => d.value).filter(v => v != null);
  const weightHeadline = wVals.length ? `${(wVals[wVals.length - 1])}${UI.unit()}` : null;
  const stepsAvg = avg(stepsSeries.data, 'value');
  const adhAvg = avg(adhSeries.data, 'value');

  // Current week (Mon–Sun) averages for the overview card.
  const weekStats = useMemoH(() => {
    const now = new Date(today + 'T12:00:00');
    const jsDow = now.getDay();
    const monday = healthShiftISO(today, -((jsDow === 0 ? 7 : jsDow) - 1));
    const sunday = healthShiftISO(monday, 6);
    const inWeek = dailyLogs.filter(l => l.date >= monday && l.date <= sunday);
    const avgK = k => { const vs = inWeek.map(l => l[k]).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; };
    const trained = (store.sessions || []).filter(s => s.ended).filter(s => {
      const d = s.date ? (typeof s.date === 'string' ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10)) : null;
      return d && d >= monday && d <= sunday;
    }).length;
    return {
      from: monday, to: sunday, daysLogged: inWeek.length, daysTrained: trained,
      weight: avgK('weight'), steps: avgK('steps'), calories: avgK('calories'),
      protein: avgK('protein'), carbs: avgK('carbs'), fat: avgK('fat'), water: avgK('waterMl'),
      adherence: avgK('adherence'),
    };
  }, [dailyLogs, store.sessions, today]);

  const targetDayRow = (label, suffix) => {
    const p = targets[`protein${suffix}`], c = targets[`carbs${suffix}`], f = targets[`fat${suffix}`], cal = targets[`calories${suffix}`];
    if (p == null && c == null && f == null) return null;
    const chip = (k, v) => (
      <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft }}>
        <span style={{ color: UI.inkGhost, fontSize: 9 }}>{k}</span> {v}
      </span>
    );
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

  const targetRow = (
    <div style={{ background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: targets ? 2 : 0 }}>
        <span className="micro" style={{ color: UI.inkFaint, flex: 1 }}>DAILY TARGETS{fromCoach ? ' · FROM COACH' : ''}</span>
        <button onClick={() => setTargetOpen(true)} style={{
          background: 'transparent', border: `0.5px solid rgba(var(--accent-rgb),0.4)`,
          borderRadius: 4, padding: '3px 12px', color: 'var(--accent)',
          fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent', flexShrink: 0,
        }}>{targets ? 'EDIT' : 'SET'}</button>
      </div>
      {targets ? (
        <>
          {targetDayRow('Training', 'Training')}
          <div style={{ height: 0.5, background: UI.hair }} />
          {targetDayRow('Rest', 'Rest')}
        </>
      ) : (
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 4 }}>
          Set protein / carbs / fat goals to track macro adherence.
        </div>
      )}
    </div>
  );

  return (
    <Screen>
      <HealthDateStrip store={store} selectedDate={selectedDate} onSelect={setSelectedDate} onLog={() => setLogOpen(true)} />

      {/* max-width cap so charts don't blow up on iPad */}
      <div style={{ padding: '8px 16px calc(env(safe-area-inset-bottom, 0px) + 100px)', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 680, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 2px' }}>
          <span style={{ fontFamily: UI.fontDisplay, fontSize: 26, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: UI.ink }}>
            {selectedDate === today ? 'Today' : healthFmtDate(selectedDate, { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          {selectedDate !== today && (
            <button onClick={() => setSelectedDate(today)} style={{ background: 'transparent', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer' }}>Jump to today →</button>
          )}
        </div>

        <HealthMetricsCard log={selectedLog} />

        <HealthWeekCard stats={weekStats} />

        <HealthChartCard title="Weight" icon="fa-weight-scale" tf={tf} setTf={setTf}
          headline={weightHeadline} sub={weightHeadline ? 'latest' : null}>
          <HealthLineChart series={weightSeries.data} from={weightSeries.from} to={weightSeries.to} format={v => `${v}`} />
        </HealthChartCard>

        <HealthChartCard title="Steps" icon="fa-shoe-prints" tf={tf} setTf={setTf}
          headline={stepsAvg != null ? Math.round(stepsAvg).toLocaleString() : null} sub={stepsAvg != null ? 'avg / day' : null}>
          <HealthBarChart series={stepsSeries.data} from={stepsSeries.from} to={stepsSeries.to} format={v => v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`} />
        </HealthChartCard>

        <HealthChartCard title="Macros" icon="fa-utensils" tf={tf} setTf={setTf}>
          {targetRow}
          <HealthMacroChart series={macroSeries.data} from={macroSeries.from} to={macroSeries.to} />
          <MacroLegend />
        </HealthChartCard>

        {targets && (
          <HealthChartCard title="Macro Adherence" icon="fa-bullseye" tf={tf} setTf={setTf}
            headline={adhAvg != null ? `${Math.round(adhAvg)}%` : null} sub={adhAvg != null ? 'avg' : null}>
            <HealthLineChart series={adhSeries.data} from={adhSeries.from} to={adhSeries.to} format={v => `${Math.round(v)}%`} yMin={0} yMax={100} />
          </HealthChartCard>
        )}
      </div>

      <DailyLogSheet open={logOpen} onClose={() => setLogOpen(false)} store={store} setStore={setStore} date={selectedDate} targets={targets} />
      <MacroTargetSheet open={targetOpen} onClose={() => setTargetOpen(false)} store={store} setStore={setStore} coachingMacros={coachingMacros} />
    </Screen>
  );
}

// ─── Coach read-only view (rendered inside CoachClientScreen's "Daily" tab) ─────

function HealthClientLogs({ clientStore }) {
  const logs = clientStore?.dailyLogs || [];
  const [weightTf, setWeightTf] = useStateH('3M');
  const [adhTf, setAdhTf] = useStateH('3M');

  const tfDays = id => (HEALTH_TFS.find(t => t.id === id) || HEALTH_TFS[1]).days;
  const seriesFor = (days, pick) => {
    const { start, end } = healthWindow(days);
    const data = logs.filter(l => l.date >= start && l.date <= end).map(l => ({ date: l.date, value: pick(l) }));
    const dates = data.map(d => d.date);
    let from = dates.length ? dates.reduce((a, b) => a < b ? a : b) : start;
    let to = dates.length ? dates.reduce((a, b) => a > b ? a : b) : end;
    if (from === to) { from = healthShiftISO(from, -1); to = healthShiftISO(to, 1); }
    return { from, to, data };
  };
  const weightSeries = seriesFor(tfDays(weightTf), l => l.weight);
  const adhSeries = seriesFor(tfDays(adhTf), l => l.adherence);

  // Weekly summary (Mon-anchored) for the last 8 weeks with any data.
  const weeks = useMemoH(() => {
    const byWeek = {};
    for (const l of logs) {
      const d = new Date(l.date + 'T12:00:00');
      const dow = d.getDay(); const mon = new Date(d); mon.setDate(d.getDate() - ((dow === 0 ? 7 : dow) - 1));
      const ws = mon.toISOString().slice(0, 10);
      (byWeek[ws] = byWeek[ws] || []).push(l);
    }
    const avg = (arr, k) => { const vs = arr.map(x => x[k]).filter(v => v != null); return vs.length ? Math.round(vs.reduce((s, v) => s + v, 0) / vs.length) : null; };
    return Object.keys(byWeek).sort((a, b) => b.localeCompare(a)).slice(0, 8).map(ws => ({
      ws, steps: avg(byWeek[ws], 'steps'), calories: avg(byWeek[ws], 'calories'),
      protein: avg(byWeek[ws], 'protein'), carbs: avg(byWeek[ws], 'carbs'), fat: avg(byWeek[ws], 'fat'),
      adherence: avg(byWeek[ws], 'adherence'),
    }));
  }, [logs]);

  if (!logs.length) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 }}>
        <i className="fa-solid fa-heart-pulse" style={{ fontSize: 28, color: UI.inkGhost }} />
        <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center' }}>No daily logs yet.<br />Your client hasn't tracked health metrics.</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 32px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 680, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
      <HealthChartCard title="Weight" icon="fa-weight-scale" tf={weightTf} setTf={setWeightTf}>
        <HealthLineChart series={weightSeries.data} from={weightSeries.from} to={weightSeries.to} format={v => `${v}`} />
      </HealthChartCard>
      <HealthChartCard title="Macro Adherence" icon="fa-bullseye" tf={adhTf} setTf={setAdhTf}>
        <HealthLineChart series={adhSeries.data} from={adhSeries.from} to={adhSeries.to} format={v => `${Math.round(v)}%`} yMin={0} yMax={100} />
      </HealthChartCard>

      <div>
        <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>WEEKLY AVERAGES</div>
        <div style={{ background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
          {weeks.map((w, i) => (
            <div key={w.ws} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: i ? `0.5px solid ${UI.hair}` : 'none' }}>
              <div style={{ width: 58, flexShrink: 0, fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>{healthFmtDate(w.ws, { day: 'numeric', month: 'short' })}</div>
              <div style={{ flex: 1, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {w.steps != null && <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>{w.steps.toLocaleString()} st</span>}
                {w.calories != null && <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>{w.calories} kcal</span>}
                {(w.protein != null || w.carbs != null || w.fat != null) && (
                  <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>
                    {[w.protein != null && `P${w.protein}`, w.carbs != null && `C${w.carbs}`, w.fat != null && `F${w.fat}`].filter(Boolean).join(' ')}
                  </span>
                )}
              </div>
              {w.adherence != null && <span className="num" style={{ fontSize: 13, color: adherenceColor(w.adherence), flexShrink: 0 }}>{w.adherence}%</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Register ─────────────────────────────────────────────────────────────────

window.Screens = window.Screens || {};
Object.assign(window.Screens, { HealthScreen, HealthClientLogs });
