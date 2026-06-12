/* Coaching screens — charts, check-in summaries, nutrition + plan editors.
   Shares globals with screens-coaching-core.jsx (loaded first). */

function LineChartSheet({ label, icon, entries, format, invertColor, yMin, yMax, onClose }) {
  const W = 300, padL = 44, padR = 14, padTop = 36, padBottom = 26, plotH = 110;
  const H = padTop + plotH + padBottom;
  const plotW = W - padL - padR;
  const vals = entries.map(e => e.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const dom = UI.chartDomain(minV, maxV, { min: yMin, max: yMax });
  const n = entries.length;
  // Thin out the X (date) labels so they don't overlap with many check-ins —
  // show roughly 5 across, always including the last point.
  const labelStep = Math.max(1, Math.round(n / 5));
  const showLabel = i => i === n - 1 || i % labelStep === 0;

  // Four Y gridlines across the padded domain. Round decimal noise off the
  // axis labels (one decimal only for tight ranges like bodyweight).
  const gridVals = Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
  const dec = dom.range >= 4 ? 0 : 1;

  const xOf = i => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;

  const fmtD = s => {
    const d = new Date(s + 'T12:00:00');
    return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;
  };

  const pts = entries.map((e, i) => `${xOf(i).toFixed(1)},${yOf(e.value).toFixed(1)}`).join(' ');
  const base = (padTop + plotH).toFixed(1);

  const content = (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div style={{ background: UI.bg, borderRadius: '6px 6px 0 0', padding: '20px 20px 44px', borderTop: `0.5px solid ${UI.hairStrong}`, width: '100%', maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className={`fa-solid ${icon}`} style={{ fontSize: 13, color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, fontSize: 18, lineHeight: 1 }}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        {n < 2 ? (
          <div style={{ textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, padding: '24px 0' }}>Need at least 2 check-ins for a trend.</div>
        ) : (
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
            {gridVals.map((v, i) => (
              <g key={`g${i}`}>
                {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
                <text x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{format(Number(v.toFixed(dec)))}</text>
              </g>
            ))}
            <line x1={padL} y1={padTop} x2={padL} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
            <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
            <polygon points={`${xOf(0).toFixed(1)},${base} ${pts} ${xOf(n-1).toFixed(1)},${base}`} fill={`rgba(var(--accent-rgb),0.12)`} />
            <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {entries.map((e, i) => {
              const cx = xOf(i).toFixed(1);
              const cy = yOf(e.value).toFixed(1);
              const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
              return (
                <g key={i}>
                  <circle cx={cx} cy={cy} r={i === n - 1 ? '3' : '2'} fill="var(--accent)" />
                  {showLabel(i) && <text x={cx} y={(padTop + plotH + 16).toFixed(1)} textAnchor={anchor} fontSize="8" fontFamily={UI.fontUi} fill={UI.inkFaint}>{fmtD(e.weekStart)}</text>}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
  return ReactDOM.createPortal(content, document.body);
}

// ─── CheckInTrendCards ────────────────────────────────────────────────────────
// Shared trend cards component used by both coach and client check-in views.
// recent = last 6 check-ins sorted oldest → newest.

async function exportCheckinCharts(recent) {
  const cs = getComputedStyle(document.documentElement);
  const accent    = cs.getPropertyValue('--accent').trim();
  const accentRgb = cs.getPropertyValue('--accent-rgb').trim();
  const inkFaint  = cs.getPropertyValue('--ink-faint').trim();
  const bgColor   = cs.getPropertyValue('--bg').trim();
  const hairColor = cs.getPropertyValue('--hair').trim();
  const unit = UI.unit();

  const metrics = [
    { label: 'Weight – avg last week', values: recent.map(c => c.weightAvgLastWeek), format: v => `${Math.round(v * 10) / 10}${unit}` },
    { label: 'Weight – today',         values: recent.map(c => c.weightToday),        format: v => `${Math.round(v * 10) / 10}${unit}` },
    { label: 'Training days',          values: recent.map(c => c.daysTrained),        format: v => `${v}d` },
    { label: 'Steps',                  values: recent.map(c => c.steps),              format: v => `${Math.round(v / 1000)}k` },
    { label: 'Cardio',                 values: recent.map(c => c.cardioMinutes),      format: v => `${v} min` },
    { label: 'Pace feeling',           values: recent.map(c => c.cardioPaceFeeling),  format: v => `${v}/6` },
    { label: 'Cardio effort',          values: recent.map(c => c.cardioEffort),       format: v => `${v}/10` },
    { label: 'Hunger',                 values: recent.map(c => c.hunger),             format: v => `${v}` },
    { label: 'Sleep quality',          values: recent.map(c => c.sleepQuality),       format: v => `${v}` },
    { label: 'Life stress',            values: recent.map(c => c.lifeStress),         format: v => `${v}` },
    { label: 'Work stress',            values: recent.map(c => c.workStress),         format: v => `${v}` },
    { label: 'Tiredness',              values: recent.map(c => c.tiredness),          format: v => `${v}` },
  ];

  const charts = metrics.map(m => {
    const entries = m.values
      .map((v, i) => v != null ? { weekStart: recent[i].weekStart, value: v } : null)
      .filter(Boolean);
    return { ...m, entries };
  }).filter(c => c.entries.length >= 2);

  if (!charts.length) return;

  const W = 320, padL = 46, padR = 18, padTop = 32, padBottom = 22, plotH = 90;
  const chartH = padTop + plotH + padBottom;
  const blockH = 22 + chartH + 20;
  const cW = W + 48;
  const cH = 40 + charts.length * blockH + 24;

  const canvas = document.createElement('canvas');
  canvas.width  = cW * 2;
  canvas.height = cH * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  ctx.fillStyle = bgColor || '#0f0e0b';
  ctx.fillRect(0, 0, cW, cH);

  ctx.fillStyle = inkFaint || '#8b7d6b';
  ctx.font = '700 9px Arial, sans-serif';
  ctx.fillText('CHECK-IN PROGRESS', 24, 22);

  const fmtD = s => {
    const d = new Date(s + 'T12:00:00');
    return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;
  };

  const svgToImg = str => new Promise((resolve, reject) => {
    const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(); };
    img.src = url;
  });

  const a = accent || '#b8902b';
  const aRgb = accentRgb || '184,144,43';
  const fi = inkFaint || '#8b7d6b';
  const hr = hairColor || 'rgba(139,125,107,0.25)';

  let y = 40;
  for (const { label, entries, format } of charts) {
    const n = entries.length;
    const vals = entries.map(e => e.value);
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    const dom = UI.chartDomain(minV, maxV);
    const plotW = W - padL - padR;
    const xOf = i => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
    const step = Math.max(1, Math.round(n / 5));
    const showLbl = i => i === n - 1 || i % step === 0;
    const pts = entries.map((e, i) => `${xOf(i).toFixed(1)},${yOf(e.value).toFixed(1)}`).join(' ');
    const base = (padTop + plotH).toFixed(1);

    const dec = dom.range >= 4 ? 0 : 1;
    const gridVals = Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
    const grid = gridVals.map((v, i) =>
      (i > 0 ? `<line x1="${padL}" y1="${yOf(v).toFixed(1)}" x2="${W - padR}" y2="${yOf(v).toFixed(1)}" stroke="${hr}" stroke-width="0.5" stroke-dasharray="3 3"/>` : '') +
      `<text x="${padL - 5}" y="${(yOf(v) + 3).toFixed(1)}" text-anchor="end" font-size="8" font-family="Arial,sans-serif" fill="${fi}">${format(Number(v.toFixed(dec)))}</text>`
    ).join('') +
      `<line x1="${padL}" y1="${padTop}" x2="${padL}" y2="${padTop + plotH}" stroke="${hr}" stroke-width="0.5"/>` +
      `<line x1="${padL}" y1="${padTop + plotH}" x2="${W - padR}" y2="${padTop + plotH}" stroke="${hr}" stroke-width="0.5"/>`;

    const nodes = entries.map((e, i) => {
      const cx = xOf(i).toFixed(1), cy = yOf(e.value).toFixed(1);
      const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      return `<circle cx="${cx}" cy="${cy}" r="${i === n - 1 ? 3 : 2}" fill="${a}"/>` +
        (showLbl(i) ? `<text x="${cx}" y="${(padTop + plotH + 16).toFixed(1)}" text-anchor="${anchor}" font-size="8" font-family="Arial,sans-serif" fill="${fi}">${fmtD(e.weekStart)}</text>` : '');
    }).join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${chartH}">` +
      grid +
      `<polygon points="${xOf(0).toFixed(1)},${base} ${pts} ${xOf(n-1).toFixed(1)},${base}" fill="rgba(${aRgb},0.15)"/>` +
      `<polyline points="${pts}" fill="none" stroke="${a}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
      nodes + `</svg>`;

    ctx.fillStyle = fi;
    ctx.font = '700 9px Arial, sans-serif';
    ctx.fillText(label.toUpperCase(), 24, y + 14);

    try {
      const img = await svgToImg(svg);
      ctx.drawImage(img, 24, y + 22, W, chartH);
    } catch (_) {}
    y += blockH;
  }

  await new Promise(resolve => canvas.toBlob(async blob => {
    if (!blob) return resolve();
    const file = new File([blob], 'checkin-progress.png', { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Check-in Progress' });
        return resolve();
      }
    } catch (_) {}
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement('a');
    a2.href = url; a2.download = 'checkin-progress.png'; a2.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    resolve();
  }, 'image/png'));
}

function CheckInTrendCards({ recent, schema }) {
  const resolvedSchema = schema || CHECKIN_DEFAULT_SCHEMA;
  const [chartModal, setChartModal] = useStateC(null);
  const [exporting, setExporting] = useStateC(false);
  const n = recent.length;

  const handleExport = () => {
    if (exporting || n < 2) return;
    setExporting(true);
    exportCheckinCharts(recent).catch(() => {}).finally(() => setExporting(false));
  };

  const openChart = (label, icon, values, format, invertColor, yMin, yMax) => {
    const entries = values
      .map((v, i) => v != null ? { weekStart: recent[i].weekStart, value: v } : null)
      .filter(Boolean);
    if (entries.length) setChartModal({ label, icon, entries, format, invertColor, yMin, yMax });
  };

  const Sparkline = ({ vals }) => {
    if (vals.length < 2) return null;
    const min = Math.min(...vals); const max = Math.max(...vals);
    const range = max - min || 1;
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, marginTop: 8, height: 20 }}>
        {vals.map((v, i) => {
          const h = Math.round(((v - min) / range) * 13) + 6;
          return <div key={i} style={{ flex: 1, height: h, borderRadius: 2, background: i === vals.length - 1 ? 'var(--accent)' : `rgba(var(--accent-rgb),0.3)` }} />;
        })}
      </div>
    );
  };

  const cardStyle = { flex: 1, minWidth: 80, background: UI.bgInset, borderRadius: 6, padding: '8px 10px', border: `0.5px solid ${UI.hair}`, display: 'flex', flexDirection: 'column', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };

  const TrendCard = ({ label, icon, values, format, invertColor, sub, yMin, yMax }) => {
    const valid = values.filter(v => v != null);
    if (!valid.length) return null;
    const last = valid[valid.length - 1];
    const prev = valid.length > 1 ? valid[valid.length - 2] : null;
    const delta = prev != null ? last - prev : null;
    const up = delta > 0;
    const arrowColor = delta === 0 || delta == null ? UI.inkFaint
      : invertColor ? (up ? 'rgba(var(--danger-rgb),0.8)' : 'var(--accent)')
      : (up ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.8)');
    return (
      <div onClick={() => openChart(label, icon, values, format, invertColor, yMin, yMax)} style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
          <i className={`fa-solid ${icon}`} style={{ fontSize: 10, color: UI.inkFaint }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
          <span className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>{format(last)}</span>
          {delta != null && Math.abs(delta) > 0.001 && (
            <span style={{ fontSize: 10, color: arrowColor, fontFamily: UI.fontUi }}>{up ? '▲' : '▼'} {format(Math.abs(delta))}</span>
          )}
        </div>
        {sub && <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2, textAlign: 'center' }}>{sub}</div>}
        <Sparkline vals={valid} />
      </div>
    );
  };

  const TrendSection = ({ label, children }) => {
    const hasAny = React.Children.toArray(children).some(Boolean);
    if (!hasAny) return null;
    return (
      <div>
        <div className="micro" style={{ fontWeight: 700, color: UI.inkFaint, marginBottom: 8, borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8 }}>{label}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>{children}</div>
      </div>
    );
  };

  const distUnit = (() => { try { return localStorage.getItem('logbook-cardio-dist-unit') || 'km'; } catch(_) { return 'km'; } })();

  // Keys shown as sub-labels on another card — don't render as standalone
  const SUB_KEYS = new Set(['cardio_distance_m']);

  const getFormat = (field) => {
    if (field.unit === 'weight') return v => `${Math.round(v * 100) / 100}${UI.unit()}`;
    if (field.key === 'steps') return v => `${Math.round(v / 1000)}k`;
    if (field.key === 'days_trained') return v => `${v}d`;
    if (field._distanceField) return v => distUnit === 'mi' ? `${(v/1609.344).toFixed(1)} mi` : `${(v/1000).toFixed(1)} km`;
    if (field.type === 'stepper') return v => `${v}/${field.max || 10}`;
    if (field.type === 'choice' && field.options?.length)
      return v => { const opt = field.options[Math.round(v) - 1]; return opt ? opt.label : `${v}/${field.options.length}`; };
    if (field.unit) return v => `${v} ${field.unit}`;
    return v => String(Math.round(v * 10) / 10);
  };

  const getYRange = (field) => {
    if (field.type === 'stepper') return { yMin: 0, yMax: field.max || 10 };
    if (field.type === 'choice' && field.options?.length) return { yMin: 0, yMax: field.options.length };
    return {};
  };

  // Map a stored choice response to its 1-based rank among the field's options
  // (works for text or numeric values; falls back to a legacy numeric value).
  const choiceRank = (field, resp) => {
    if (resp == null || resp === '') return null;
    const idx = (field.options || []).findIndex(o => String(o.value) === String(resp));
    if (idx >= 0) return idx + 1;
    const n = Number(resp);
    return isNaN(n) ? null : n;
  };

  const renderFieldCard = (field) => {
    if (field.type === 'text') return null;
    if (SUB_KEYS.has(field.key)) return null;

    const vals = field.type === 'choice'
      ? recent.map(c => choiceRank(field, c.responses?.[field.key]))
      : recent.map(c => { const v = c.responses?.[field.key]; return (v != null && v !== '') ? Number(v) : null; });

    if (field.key === 'cardio_minutes') {
      const validItems = recent.filter(c => c.responses?.cardio_minutes != null);
      if (!validItems.length) return null;
      const last = validItems[validItems.length - 1];
      const prev = validItems.length > 1 ? validItems[validItems.length - 2] : null;
      const delta = prev != null ? last.responses.cardio_minutes - prev.responses.cardio_minutes : null;
      const lastDist = last.responses?.cardio_distance_m;
      const sub = lastDist != null ? (distUnit === 'mi' ? `${(lastDist/1609.344).toFixed(1)} mi` : `${(lastDist/1000).toFixed(1)} km`) : null;
      return (
        <div key={field.key} onClick={() => openChart('Cardio', field.icon || 'fa-person-running', vals, v => `${v} min`, false)} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
            <i className={`fa-solid ${field.icon || 'fa-person-running'}`} style={{ fontSize: 10, color: UI.inkFaint }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Cardio</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
            <span className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>{last.responses.cardio_minutes} min</span>
            {delta != null && Math.abs(delta) > 0 && (
              <span style={{ fontSize: 10, color: delta > 0 ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</span>
            )}
          </div>
          {sub && <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2, textAlign: 'center' }}>{sub}</div>}
          <Sparkline vals={validItems.map(c => c.responses.cardio_minutes)} />
        </div>
      );
    }

    const fmt = getFormat(field);
    const { yMin, yMax } = getYRange(field);
    return (
      <TrendCard key={field.key} label={field.label} icon={field.icon || 'fa-circle-dot'} values={vals}
        format={fmt} invertColor={field.direction === 'lower_better'} yMin={yMin} yMax={yMax} />
    );
  };

  return (
    <>
      {chartModal && <LineChartSheet {...chartModal} onClose={() => setChartModal(null)} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="micro" style={{ color: UI.inkFaint }}>TRENDS — {n} CHECK-IN{n !== 1 ? 'S' : ''}</div>
        {n >= 2 && (
          <button onClick={handleExport} disabled={exporting} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: exporting ? UI.inkFaint : UI.gold, fontSize: 13, lineHeight: 1 }}>
            <i className={`fa-solid ${exporting ? 'fa-spinner fa-spin' : 'fa-share-from-square'}`} />
          </button>
        )}
      </div>
      {resolvedSchema.map(section => (
        <TrendSection key={section.id} label={section.label.toUpperCase()}>
          {(section.fields || []).map(field => renderFieldCard(field))}
        </TrendSection>
      ))}
    </>
  );
}

// ─── CheckInSchemaBuilder ──────────────────────────────────────────────────────

function CheckInSchemaBuilder({ coachingId, initial, onSave, onSaveForAll, onClose }) {
  const [draft, setDraft] = useStateC(() => JSON.parse(JSON.stringify(initial || CHECKIN_DEFAULT_SCHEMA)));
  const [view, setView] = useStateC('list');
  const [editCtx, setEditCtx] = useStateC(null);
  const [fieldDraft, setFieldDraft] = useStateC(null);
  const [sectionDraft, setSectionDraft] = useStateC(null);
  const [saving, setSaving] = useStateC(false);
  const [helpTip, setHelpTip] = useStateC(null);
  const [savePicker, setSavePicker] = useStateC(false);

  const HELP = {
    label:         'The display name shown to clients in the check-in form.',
    type:          'How the client fills in this field. Text = free-form notes. Int/Dec = number input. Stepper = tap buttons on a 1–N scale. Choice = pick one from a fixed list.',
    width:         'Full = the field takes the whole row. Half = two fields sit side by side in one row.',
    required:      'When on, the client must fill in this field before they can submit the check-in.',
    direction:     '"Higher better" → green arrow when the value goes up (e.g. steps, training days). "Lower better" → green when it drops (e.g. stress, fatigue).',
    icon:          'Small icon shown next to the field label. Tap to pick from fitness-relevant icons.',
    min:           'Lowest selectable value on the stepper scale.',
    max:           'Highest selectable value on the stepper scale.',
    rows:          'How many lines tall the text area appears in the form (1–8). More rows = more vertical space.',
    options:       'Add one button per option as plain text (e.g. Worse, Same, Improved). The text is shown to the client and saved as-is; its position sets the rank used in trends — order them to match your trend direction.',
    unit:          'Text appended after the value in trend charts. Use "weight" to auto-switch between kg and lbs based on the client\'s setting.',
    hint:          'Small helper text shown below the input to guide the client (e.g. "1 = easy, 10 = max").',
    section_label: 'The heading shown above this group of fields in the check-in form.',
    section_hint:  'Optional grey subtitle below the heading (e.g. "1 = good / low, 10 = bad / high").',
  };

  const ICON_GROUPS = [
    { label: 'Body & Weight',     icons: ['fa-weight-scale', 'fa-dumbbell', 'fa-person', 'fa-ruler', 'fa-percent'] },
    { label: 'Cardio & Training', icons: ['fa-person-running', 'fa-person-walking', 'fa-shoe-prints', 'fa-bicycle', 'fa-stopwatch', 'fa-gauge', 'fa-heart-pulse', 'fa-fire', 'fa-bolt'] },
    { label: 'Nutrition & Water', icons: ['fa-bowl-food', 'fa-utensils', 'fa-droplet', 'fa-glass-water'] },
    { label: 'Wellness & Sleep',  icons: ['fa-brain', 'fa-moon', 'fa-bed', 'fa-battery-half', 'fa-heart', 'fa-sun', 'fa-face-smile'] },
    { label: 'Performance',       icons: ['fa-chart-line', 'fa-chart-bar', 'fa-trophy', 'fa-medal', 'fa-star', 'fa-flag'] },
    { label: 'Stress & Work',     icons: ['fa-briefcase', 'fa-clock', 'fa-hourglass-half', 'fa-building'] },
    { label: 'Notes & General',   icons: ['fa-clipboard-list', 'fa-circle-check', 'fa-circle-dot', 'fa-pen', 'fa-list-check', 'fa-file-lines'] },
  ];

  const renderHelpBtn = (key) => (
    <button onClick={() => setHelpTip(t => t === key ? null : key)}
      style={{ background: 'none', border: 'none', padding: '0 0 0 5px', cursor: 'pointer', color: helpTip === key ? 'var(--accent)' : UI.inkGhost, fontSize: 12, lineHeight: 1, flexShrink: 0 }}>
      <i className="fa-solid fa-circle-question" />
    </button>
  );
  const renderHelp = (key) => helpTip === key ? (
    <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, padding: '7px 10px', background: 'rgba(var(--accent-rgb),0.08)', borderRadius: 6, marginTop: 4, marginBottom: 4 }}>
      {HELP[key]}
    </div>
  ) : null;

  const backToList = () => { setView('list'); setFieldDraft(null); setSectionDraft(null); setEditCtx(null); setHelpTip(null); };

  const openEditField = (sIdx, fIdx) => {
    const f = draft[sIdx].fields[fIdx];
    setFieldDraft({
      key: f.key || '', label: f.label || '', type: f.type || 'integer', width: f.width || 'full',
      required: !!f.required, direction: f.direction || null, icon: f.icon || '', unit: f.unit || '',
      hint: f.hint || '', min: f.min != null ? String(f.min) : '1', max: f.max != null ? String(f.max) : '10',
      rows: f.rows != null ? String(f.rows) : '2',
      options: f.options ? JSON.parse(JSON.stringify(f.options)) : [], labeled: !!f.labeled, isNew: false,
    });
    setEditCtx({ sectionIdx: sIdx, fieldIdx: fIdx });
    setHelpTip(null);
    setView('edit-field');
  };

  const openAddField = (sIdx) => {
    setFieldDraft({ key: '', label: '', type: 'integer', width: 'full', required: false, direction: null, icon: '', unit: '', hint: '', min: '1', max: '10', rows: '2', options: [], labeled: false, isNew: true });
    setEditCtx({ sectionIdx: sIdx, fieldIdx: null });
    setHelpTip(null);
    setView('edit-field');
  };

  const openEditSection = (sIdx) => {
    const s = draft[sIdx];
    setSectionDraft({ label: s.label || '', hint: s.sectionHint || '' });
    setEditCtx({ sectionIdx: sIdx, isNew: false });
    setHelpTip(null);
    setView('edit-section');
  };

  const openAddSection = () => {
    setSectionDraft({ label: '', hint: '' });
    setEditCtx({ isNew: true });
    setHelpTip(null);
    setView('edit-section');
  };

  // Keys are generated automatically from the label (readable slug, made unique
  // within this form) — coaches never type or see them. Generated once at
  // creation and never changed afterwards, so historical responses keep theirs.
  const genFieldKey = (label) => {
    const used = new Set(draft.flatMap(s => (s.fields || []).map(f => f.key)));
    const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'field';
    let key = base;
    while (used.has(key)) key = base + '_' + Math.random().toString(36).slice(2, 6);
    return key;
  };

  const commitField = () => {
    const fd = fieldDraft;
    if (!fd.label.trim()) return;
    const key = fd.isNew ? genFieldKey(fd.label) : fd.key;
    const f = { key, label: fd.label.trim(), type: fd.type, width: fd.width, required: fd.required, direction: fd.direction };
    if (fd.icon.trim()) f.icon = fd.icon.trim();
    if (fd.unit) f.unit = fd.unit;
    if (fd.hint.trim()) f.hint = fd.hint.trim();
    if (fd.type === 'stepper') { f.min = parseInt(fd.min) || 1; f.max = parseInt(fd.max) || 10; }
    if (fd.type === 'text') f.rows = parseInt(fd.rows) || 2;
    if (fd.type === 'choice') {
      // Each option stores its own text as the value; the position gives the
      // rank used for trends (see the direction hint in the editor). Empty
      // options are dropped.
      f.options = fd.options.filter(o => String(o.label ?? '').trim()).map(o => ({ ...o }));
      if (fd.labeled) f.labeled = true;
    }
    setDraft(d => {
      const n = JSON.parse(JSON.stringify(d));
      if (fd.isNew) n[editCtx.sectionIdx].fields.push(f);
      else n[editCtx.sectionIdx].fields[editCtx.fieldIdx] = f;
      return n;
    });
    backToList();
  };

  const commitSection = () => {
    const sd = sectionDraft;
    if (!sd.label.trim()) return;
    setDraft(d => {
      const n = JSON.parse(JSON.stringify(d));
      if (editCtx.isNew) {
        n.push({ id: `s${Date.now()}`, label: sd.label.trim(), ...(sd.hint.trim() ? { sectionHint: sd.hint.trim() } : {}), fields: [] });
      } else {
        n[editCtx.sectionIdx].label = sd.label.trim();
        if (sd.hint.trim()) n[editCtx.sectionIdx].sectionHint = sd.hint.trim();
        else delete n[editCtx.sectionIdx].sectionHint;
      }
      return n;
    });
    backToList();
  };

  const moveSection = (i, dir) => setDraft(s => { const n = JSON.parse(JSON.stringify(s)); const j = i + dir; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const removeSection = (i) => setDraft(s => { const n = JSON.parse(JSON.stringify(s)); n.splice(i, 1); return n; });
  const moveField = (si, fi, dir) => setDraft(s => { const n = JSON.parse(JSON.stringify(s)); const flds = n[si].fields; const j = fi + dir; if (j < 0 || j >= flds.length) return n; [flds[fi], flds[j]] = [flds[j], flds[fi]]; return n; });
  const removeField = (si, fi) => setDraft(s => { const n = JSON.parse(JSON.stringify(s)); n[si].fields.splice(fi, 1); return n; });

  const handleSave = async () => {
    setSaving(true);
    try { await LB.saveCheckinSchema(coachingId, draft); onSave(draft); }
    catch (e) { alert(e.message); setSaving(false); }
  };

  const handleSaveForAll = async () => {
    setSaving(true);
    try { await onSaveForAll(draft); }
    catch (e) { alert(e.message); setSaving(false); }
  };

  const handleReset = () => {
    if (confirm('Reset to the default check-in form? All customizations will be lost.'))
      setDraft(JSON.parse(JSON.stringify(CHECKIN_DEFAULT_SCHEMA)));
  };

  const TYPE_LABEL = { text: 'Text', integer: 'Int', decimal: 'Dec', stepper: 'Steps', choice: 'Choice' };
  const TYPE_COLOR = { text: UI.inkSoft, integer: 'var(--accent)', decimal: 'var(--accent)', stepper: UI.gold, choice: '#7b8cde' };
  const inp = { width: '100%', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '9px 10px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none', boxSizing: 'border-box' };
  const lbl = { fontSize: 10, fontWeight: 700, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' };
  const fieldHeader = (text, helpKey) => (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
      <span style={lbl}>{text}</span>
      {renderHelpBtn(helpKey)}
    </div>
  );
  const segBtn = (active) => ({ flex: 1, padding: '7px 4px', borderRadius: 6, border: `0.5px solid ${active ? 'var(--accent)' : UI.hairStrong}`, background: active ? 'rgba(var(--accent-rgb),0.12)' : UI.bgInset, color: active ? 'var(--accent)' : UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, cursor: 'pointer', fontWeight: active ? 700 : 400 });
  const renderToggle = (on, onToggle) => (
    <div onClick={onToggle} style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0, background: on ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${on ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`, position: 'relative', transition: 'background 0.18s', WebkitTapHighlightColor: 'transparent' }}>
      <div style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: on ? '#0a0805' : UI.inkFaint, transition: 'left 0.18s' }} />
    </div>
  );

  const overlayStyle = { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 350, background: UI.bg, display: 'flex', flexDirection: 'column' };
  const headerStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 16px 14px', borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0 };
  const backBtn = (onClick) => (
    <button onClick={onClick} style={{ background: 'none', border: 'none', padding: '4px 8px 4px 0', cursor: 'pointer', color: UI.inkFaint, fontSize: 18, lineHeight: 1 }}>
      <i className="fa-solid fa-chevron-left" />
    </button>
  );
  const doneBtn = (onClick, disabled) => (
    <button onClick={onClick} disabled={disabled}
      style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '7px 16px', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, color: '#0a0805', cursor: 'pointer', opacity: disabled ? 0.4 : 1 }}>
      Done
    </button>
  );

  // ── ICON PICKER ───────────────────────────────────────────────────────────
  if (view === 'icon-picker' && fieldDraft) {
    return (
      <div style={overlayStyle}>
        <div style={headerStyle}>
          {backBtn(() => { setView('edit-field'); setHelpTip(null); })}
          <span style={{ fontSize: 15, fontWeight: 700, fontFamily: UI.fontUi, color: UI.ink, flex: 1 }}>Choose Icon</span>
          {fieldDraft.icon && (
            <button onClick={() => { setFieldDraft(f => ({ ...f, icon: '' })); setView('edit-field'); }}
              style={{ background: 'none', border: 'none', padding: '4px 8px', cursor: 'pointer', color: UI.inkGhost, fontFamily: UI.fontUi, fontSize: 11 }}>
              Clear
            </button>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 40px' }}>
          {ICON_GROUPS.map(group => (
            <div key={group.label} style={{ marginBottom: 20 }}>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>{group.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {group.icons.map(icon => {
                  const sel = fieldDraft.icon === icon;
                  return (
                    <div key={icon} onClick={() => { setFieldDraft(f => ({ ...f, icon })); setView('edit-field'); }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '12px 4px 8px', borderRadius: 6, cursor: 'pointer', background: sel ? 'rgba(var(--accent-rgb),0.14)' : UI.bgInset, border: `0.5px solid ${sel ? 'rgba(var(--accent-rgb),0.5)' : UI.hair}`, WebkitTapHighlightColor: 'transparent' }}>
                      <i className={`fa-solid ${icon}`} style={{ fontSize: 22, color: sel ? 'var(--accent)' : UI.inkSoft }} />
                      <span style={{ fontSize: 9, color: sel ? 'var(--accent)' : UI.inkGhost, fontFamily: UI.fontUi, textAlign: 'center', lineHeight: 1.2, wordBreak: 'break-word' }}>{icon.replace('fa-', '')}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── FIELD EDITOR ──────────────────────────────────────────────────────────
  if (view === 'edit-field' && fieldDraft) {
    const fd = fieldDraft;
    const set = (k, v) => setFieldDraft(f => ({ ...f, [k]: v }));
    const canSave = fd.label.trim().length > 0;

    return (
      <div style={overlayStyle}>
        <div style={headerStyle}>
          {backBtn(backToList)}
          <span style={{ fontSize: 15, fontWeight: 700, fontFamily: UI.fontUi, color: UI.ink, flex: 1 }}>{fd.isNew ? 'Add Field' : 'Edit Field'}</span>
          {doneBtn(commitField, !canSave)}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            {fieldHeader('Label', 'label')}
            {renderHelp('label')}
            <input value={fd.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Muscle Soreness" style={inp} />
          </div>

          <div>
            {fieldHeader('Type', 'type')}
            {renderHelp('type')}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['text','integer','decimal','stepper','choice'].map(t => (
                <button key={t} onClick={() => set('type', t)} style={segBtn(fd.type === t)}>{TYPE_LABEL[t]}</button>
              ))}
            </div>
          </div>

          <div>
            {fieldHeader('Width', 'width')}
            {renderHelp('width')}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => set('width', 'full')} style={segBtn(fd.width === 'full')}>Full width</button>
              <button onClick={() => set('width', 'half')} style={segBtn(fd.width === 'half')}>Half width</button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <span style={lbl}>Required</span>
                {renderHelpBtn('required')}
              </div>
              {renderHelp('required')}
            </div>
            {renderToggle(fd.required, () => set('required', !fd.required))}
          </div>

          <div>
            {fieldHeader('Trend direction', 'direction')}
            {renderHelp('direction')}
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ v: null, l: 'None' }, { v: 'higher_better', l: '↑ Higher' }, { v: 'lower_better', l: '↓ Lower' }].map(({ v, l }) => (
                <button key={String(v)} onClick={() => set('direction', v)} style={segBtn(fd.direction === v)}>{l}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <span style={lbl}>Icon</span>
              {renderHelpBtn('icon')}
            </div>
            {renderHelp('icon')}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div onClick={() => setView('icon-picker')}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '9px 12px', cursor: 'pointer', minWidth: 0 }}>
                {fd.icon ? (
                  <>
                    <i className={`fa-solid ${fd.icon}`} style={{ fontSize: 18, color: 'var(--accent)', width: 22, textAlign: 'center', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, flex: 1 }}>{fd.icon}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 13, color: UI.inkGhost, fontFamily: UI.fontUi }}>Tap to choose…</span>
                )}
                <i className="fa-solid fa-chevron-right" style={{ fontSize: 11, color: UI.inkGhost, marginLeft: 'auto', flexShrink: 0 }} />
              </div>
              {fd.icon && (
                <button onClick={() => set('icon', '')}
                  style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer', color: 'rgba(var(--danger-rgb),0.7)', fontSize: 16, lineHeight: 1, flexShrink: 0 }}>
                  <i className="fa-solid fa-xmark" />
                </button>
              )}
            </div>
          </div>

          {fd.type === 'stepper' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <span style={lbl}>Scale</span>
                {renderHelpBtn('min')}
              </div>
              {renderHelp('min')}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, marginBottom: 3 }}>MIN</div>
                  <input type="number" value={fd.min} onChange={e => set('min', e.target.value)} style={inp} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, marginBottom: 3 }}>MAX</div>
                  <input type="number" value={fd.max} onChange={e => set('max', e.target.value)} style={inp} />
                </div>
              </div>
            </div>
          )}

          {fd.type === 'text' && (
            <div>
              {fieldHeader('Rows', 'rows')}
              {renderHelp('rows')}
              <input type="number" min="1" max="8" value={fd.rows} onChange={e => set('rows', e.target.value)} style={inp} />
            </div>
          )}

          {fd.type === 'choice' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={lbl}>Options</span>
                  {renderHelpBtn('options')}
                </div>
                <button onClick={() => set('options', [...fd.options, { value: '', label: '' }])}
                  style={{ background: 'var(--accent)', border: 'none', borderRadius: 4, padding: '4px 10px', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, color: '#0a0805', cursor: 'pointer' }}>
                  + ADD
                </button>
              </div>
              {renderHelp('options')}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {fd.options.map((o, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ width: 22, flex: '0 0 22px', textAlign: 'center', fontSize: 12, color: UI.inkGhost, fontFamily: UI.fontUi }}>{i + 1}</div>
                    <input value={o.label} onChange={e => set('options', fd.options.map((x, j) => j === i ? { ...x, value: e.target.value, label: e.target.value } : x))}
                      placeholder="e.g. Improved" style={{ ...inp, flex: 1, fontSize: 13 }} />
                    <button onClick={() => set('options', fd.options.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'rgba(var(--danger-rgb),0.8)', fontSize: 16, lineHeight: 1, flexShrink: 0 }}>
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </div>
                ))}
                {!fd.options.length && <div style={{ fontSize: 12, color: UI.inkGhost, fontFamily: UI.fontUi, textAlign: 'center', padding: '8px 0' }}>No options yet — tap + ADD</div>}
              </div>
              {fd.direction && fd.options.length > 0 && (
                <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, marginTop: 8, padding: '7px 10px', background: 'rgba(var(--accent-rgb),0.08)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <i className={`fa-solid ${fd.direction === 'higher_better' ? 'fa-arrow-up' : 'fa-arrow-down'}`} style={{ color: 'var(--accent)', fontSize: 12, flexShrink: 0 }} />
                  <span>{fd.direction === 'higher_better'
                    ? 'Higher counts as better — order from worst (top) to best (bottom).'
                    : 'Lower counts as better — order from best (top) to worst (bottom).'}</span>
                </div>
              )}
            </div>
          )}

          {(fd.type === 'integer' || fd.type === 'decimal') && (
            <div>
              {fieldHeader('Unit suffix', 'unit')}
              {renderHelp('unit')}
              <input value={fd.unit} onChange={e => set('unit', e.target.value)} placeholder='e.g. ml, kcal — or "weight"' style={inp} />
            </div>
          )}

          {fd.type !== 'text' && fd.type !== 'choice' && (
            <div>
              {fieldHeader('Hint', 'hint')}
              {renderHelp('hint')}
              <input value={fd.hint} onChange={e => set('hint', e.target.value)} placeholder="e.g. 1 = easy, 10 = max" style={inp} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── SECTION EDITOR ────────────────────────────────────────────────────────
  if (view === 'edit-section' && sectionDraft) {
    const sd = sectionDraft;
    const set = (k, v) => setSectionDraft(s => ({ ...s, [k]: v }));
    return (
      <div style={overlayStyle}>
        <div style={headerStyle}>
          {backBtn(backToList)}
          <span style={{ fontSize: 15, fontWeight: 700, fontFamily: UI.fontUi, color: UI.ink, flex: 1 }}>{editCtx?.isNew ? 'Add Section' : 'Edit Section'}</span>
          {doneBtn(commitSection, !sd.label.trim())}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            {fieldHeader('Section label', 'section_label')}
            {renderHelp('section_label')}
            <input value={sd.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Wellness" style={inp} />
          </div>
          <div>
            {fieldHeader('Hint (optional, shown below section title)', 'section_hint')}
            {renderHelp('section_hint')}
            <input value={sd.hint} onChange={e => set('hint', e.target.value)} placeholder="e.g. 1 = good, 10 = bad" style={inp} />
          </div>
        </div>
      </div>
    );
  }

  // ── LIST VIEW ─────────────────────────────────────────────────────────────
  return (
    <div style={overlayStyle}>
      {savePicker && (
        <div onClick={() => setSavePicker(false)}
          style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: UI.bg, borderRadius: '8px 8px 0 0', borderTop: `0.5px solid ${UI.hairStrong}`, padding: '20px 16px', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>Apply changes to</div>
            <button onClick={() => { setSavePicker(false); handleSaveForAll(); }}
              style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '13px 16px', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 700, color: '#0a0805', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%' }}>
              <i className="fa-solid fa-users" style={{ fontSize: 14, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>All clients</span>
              <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.75 }}>New default for everyone</span>
            </button>
            <button onClick={() => { setSavePicker(false); handleSave(); }}
              style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '13px 16px', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, color: UI.ink, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%' }}>
              <i className="fa-solid fa-person" style={{ fontSize: 14, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>This client only</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: UI.inkSoft }}>Override for this client</span>
            </button>
          </div>
        </div>
      )}
      <div style={headerStyle}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', padding: '4px 8px 4px 0', cursor: 'pointer', color: UI.inkFaint, fontSize: 18, lineHeight: 1 }}>
          <i className="fa-solid fa-xmark" />
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, fontFamily: UI.fontUi, color: UI.ink, flex: 1 }}>Customize Check-in</span>
        <button onClick={handleReset}
          style={{ background: 'none', border: 'none', padding: '4px 8px', cursor: 'pointer', color: UI.inkGhost, fontFamily: UI.fontUi, fontSize: 11 }}>
          Reset
        </button>
        <button onClick={() => onSaveForAll ? setSavePicker(true) : handleSave()} disabled={saving}
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '7px 16px', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, color: '#0a0805', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 40px' }}>
        {draft.map((sec, sIdx) => (
          <div key={sec.id || sIdx} style={{ marginBottom: 12, background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', background: UI.bgRaised, borderBottom: `0.5px solid ${UI.hair}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sec.label}</span>
                {sec.sectionHint && <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, marginLeft: 8 }}>{sec.sectionHint}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button onClick={() => moveSection(sIdx, -1)} disabled={sIdx === 0}
                  style={{ background: 'none', border: 'none', padding: '5px 7px', cursor: 'pointer', color: sIdx === 0 ? UI.inkGhost : UI.inkFaint, fontSize: 11 }}>
                  <i className="fa-solid fa-chevron-up" />
                </button>
                <button onClick={() => moveSection(sIdx, 1)} disabled={sIdx === draft.length - 1}
                  style={{ background: 'none', border: 'none', padding: '5px 7px', cursor: 'pointer', color: sIdx === draft.length - 1 ? UI.inkGhost : UI.inkFaint, fontSize: 11 }}>
                  <i className="fa-solid fa-chevron-down" />
                </button>
                <button onClick={() => openEditSection(sIdx)}
                  style={{ background: 'none', border: 'none', padding: '5px 7px', cursor: 'pointer', color: UI.inkFaint, fontSize: 11 }}>
                  <i className="fa-solid fa-pen" />
                </button>
                <button onClick={() => { if (confirm('Remove section "' + sec.label + '" and all its fields?')) removeSection(sIdx); }}
                  style={{ background: 'none', border: 'none', padding: '5px 7px', cursor: 'pointer', color: 'rgba(var(--danger-rgb),0.7)', fontSize: 11 }}>
                  <i className="fa-solid fa-trash" />
                </button>
              </div>
            </div>
            {(sec.fields || []).map((f, fIdx) => (
              <div key={f.key || fIdx} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: `0.5px solid ${UI.hair}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    {f.icon && <i className={`fa-solid ${f.icon}`} style={{ fontSize: 11, color: UI.inkGhost, flexShrink: 0 }} />}
                    <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>{f.label}</span>
                    <span style={{ fontSize: 9, color: TYPE_COLOR[f.type] || UI.inkGhost, fontFamily: UI.fontUi, fontWeight: 700, background: UI.bg, borderRadius: 4, padding: '1px 5px', border: `0.5px solid ${UI.hair}`, flexShrink: 0 }}>{TYPE_LABEL[f.type] || f.type}</span>
                    {f.width === 'half' && <span style={{ fontSize: 9, color: UI.inkGhost, fontFamily: UI.fontUi, background: UI.bg, borderRadius: 4, padding: '1px 5px', border: `0.5px solid ${UI.hair}` }}>½</span>}
                    {f.required && <span style={{ fontSize: 11, color: 'var(--accent)', lineHeight: 1 }}>*</span>}
                  </div>
                  <div style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, marginTop: 2 }}>{f.key}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <button onClick={() => moveField(sIdx, fIdx, -1)} disabled={fIdx === 0}
                    style={{ background: 'none', border: 'none', padding: '5px 6px', cursor: 'pointer', color: fIdx === 0 ? UI.inkGhost : UI.inkFaint, fontSize: 10 }}>
                    <i className="fa-solid fa-chevron-up" />
                  </button>
                  <button onClick={() => moveField(sIdx, fIdx, 1)} disabled={fIdx === (sec.fields?.length ?? 1) - 1}
                    style={{ background: 'none', border: 'none', padding: '5px 6px', cursor: 'pointer', color: fIdx === (sec.fields?.length ?? 1) - 1 ? UI.inkGhost : UI.inkFaint, fontSize: 10 }}>
                    <i className="fa-solid fa-chevron-down" />
                  </button>
                  <button onClick={() => openEditField(sIdx, fIdx)}
                    style={{ background: 'none', border: 'none', padding: '5px 6px', cursor: 'pointer', color: UI.inkFaint, fontSize: 10 }}>
                    <i className="fa-solid fa-pen" />
                  </button>
                  <button onClick={() => { if (confirm('Remove "' + f.label + '"?')) removeField(sIdx, fIdx); }}
                    style={{ background: 'none', border: 'none', padding: '5px 6px', cursor: 'pointer', color: 'rgba(var(--danger-rgb),0.7)', fontSize: 10 }}>
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
              </div>
            ))}
            <button onClick={() => openAddField(sIdx)}
              style={{ width: '100%', padding: '9px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12 }}>
              <i className="fa-solid fa-plus" style={{ fontSize: 10 }} />
              Add field
            </button>
          </div>
        ))}
        <button onClick={openAddSection}
          style={{ width: '100%', padding: '12px', background: 'transparent', borderRadius: 8, border: `0.5px dashed ${UI.hairStrong}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>
          <i className="fa-solid fa-plus" />
          Add section
        </button>
      </div>
    </div>
  );
}

// ─── ClientCheckInsTab (coach view) ───────────────────────────────────────────

function ClientCheckInsTab({ coachingId, checkinEnabled = true, onToggle, toggling = false, store, setStore, userId }) {
  const [checkins, setCheckins] = useStateC(null);
  const [schema, setSchema] = useStateC(null);
  const [builderOpen, setBuilderOpen] = useStateC(false);

  useEffectC(() => {
    LB.loadCheckins(coachingId).then(setCheckins).catch(() => {});
    LB.loadCheckinSchema(coachingId).then(s => setSchema(s)).catch(() => {});
  }, [coachingId]);

  const resolvedSchema = schema || store?.settings?.defaultCheckinSchema || CHECKIN_DEFAULT_SCHEMA;

  const toggleRow = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0 }}>
      <div>
        <div style={{ fontSize: 13, fontFamily: UI.fontUi, fontWeight: 600, color: UI.ink }}>Check-ins enabled</div>
        <div style={{ fontSize: 11, fontFamily: UI.fontUi, color: UI.inkSoft, marginTop: 2 }}>Allow client to submit weekly check-ins</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => setBuilderOpen(true)}
          style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer', color: UI.inkFaint, fontSize: 15, lineHeight: 1 }}>
          <i className="fa-solid fa-sliders" />
        </button>
        <div
          onClick={onToggle}
          style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0, background: checkinEnabled ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${checkinEnabled ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`, position: 'relative', transition: 'background 0.18s', WebkitTapHighlightColor: 'transparent', opacity: toggling ? 0.6 : 1 }}
        >
          <div style={{ position: 'absolute', top: 3, left: checkinEnabled ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: checkinEnabled ? '#0a0805' : UI.inkFaint, transition: 'left 0.18s' }} />
        </div>
      </div>
    </div>
  );

  const builder = builderOpen && (
    <CheckInSchemaBuilder coachingId={coachingId} initial={resolvedSchema}
      onSave={s => { setSchema(s); setBuilderOpen(false); }}
      onSaveForAll={async (s) => {
        await LB.saveDefaultCheckinSchema(s, userId);
        setStore(st => ({ ...st, settings: { ...st.settings, defaultCheckinSchema: s } }));
        setSchema(s);
        setBuilderOpen(false);
      }}
      onClose={() => setBuilderOpen(false)} />
  );

  if (checkins === null) {
    return (
      <>
        {builder}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {toggleRow}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.1em' }}>LOADING…</div>
          </div>
        </div>
      </>
    );
  }

  if (!checkins.length) {
    return (
      <>
        {builder}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {toggleRow}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 }}>
            <i className="fa-solid fa-clipboard-list" style={{ fontSize: 28, color: UI.inkGhost }} />
            <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center' }}>No check-ins yet.</div>
          </div>
        </div>
      </>
    );
  }

  const recent = [...checkins].reverse();

  return (
    <>
      {builder}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {toggleRow}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ padding: '16px 14px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <CheckInTrendCards recent={recent} schema={resolvedSchema} />
            <div className="knurl" style={{ margin: '4px 0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="micro" style={{ color: UI.inkFaint }}>ALL CHECK-INS</div>
              {checkins.map(ci => <CheckInCard key={ci.id} ci={ci} />)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Tab: Notes ───────────────────────────────────────────────────────────────

function ClientNotesTab({ coachingId, userId, clientName, store, setStore }) {
  const unreadNotes = store?.coaching?.unreadNotes || [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <ThreadList coachingId={coachingId} userId={userId} otherName={clientName} unreadNotes={unreadNotes} setStore={setStore} canDelete={true} />
    </div>
  );
}

// ─── Tab: Nutrition ───────────────────────────────────────────────────────────

function ClientNutritionTab({ coachingId, userId }) {
  const [macros, setMacros] = useStateC([]);
  const [loading, setLoading] = useStateC(true);
  const [saving, setSaving] = useStateC(false);
  const [historyOpen, setHistoryOpen] = useStateC(false);
  const emptyForm = { proteinTraining: '', carbsTraining: '', fatTraining: '', proteinRest: '', carbsRest: '', fatRest: '' };
  const [form, setForm] = useStateC(emptyForm);

  // Calories auto-computed: protein*4 + carbs*4 + fat*9
  const calcCals = (pro, car, fat) => {
    const total = (parseInt(pro) || 0) * 4 + (parseInt(car) || 0) * 4 + (parseInt(fat) || 0) * 9;
    return total > 0 ? total : null;
  };
  const calsTraining = calcCals(form.proteinTraining, form.carbsTraining, form.fatTraining);
  const calsRest     = calcCals(form.proteinRest,     form.carbsRest,     form.fatRest);

  const reload = () => {
    setLoading(true);
    LB.loadCoachingMacros(coachingId).then(data => {
      setMacros(data);
      if (data.length > 0) {
        const l = data[0];
        setForm({
          proteinTraining: l.proteinTraining?.toString() ?? '',
          carbsTraining:   l.carbsTraining?.toString()   ?? '',
          fatTraining:     l.fatTraining?.toString()     ?? '',
          proteinRest:     l.proteinRest?.toString()     ?? '',
          carbsRest:       l.carbsRest?.toString()       ?? '',
          fatRest:         l.fatRest?.toString()         ?? '',
        });
      }
    }).finally(() => setLoading(false));
  };

  useEffectC(() => { reload(); }, [coachingId]);

  const save = async () => {
    const macro = {
      caloriesTraining: calsTraining,
      proteinTraining:  form.proteinTraining ? parseInt(form.proteinTraining) : null,
      carbsTraining:    form.carbsTraining   ? parseInt(form.carbsTraining)   : null,
      fatTraining:      form.fatTraining     ? parseInt(form.fatTraining)     : null,
      caloriesRest:     calsRest,
      proteinRest:      form.proteinRest     ? parseInt(form.proteinRest)     : null,
      carbsRest:        form.carbsRest       ? parseInt(form.carbsRest)       : null,
      fatRest:          form.fatRest         ? parseInt(form.fatRest)         : null,
    };
    setSaving(true);
    try {
      await LB.addCoachingMacros(coachingId, macro, userId);
      const fmtDay = (cal, pro, car, fat) => [cal && `${cal} kcal`, pro && `${pro}g protein`, car && `${car}g carbs`, fat && `${fat}g fat`].filter(Boolean).join(' · ');
      const td = fmtDay(macro.caloriesTraining, macro.proteinTraining, macro.carbsTraining, macro.fatTraining);
      const rd = fmtDay(macro.caloriesRest,     macro.proteinRest,     macro.carbsRest,     macro.fatRest);
      const parts = [td && `Training day\n${td}`, rd && `Rest day\n${rd}`].filter(Boolean);
      if (parts.length) {
        const body = `Your macros have been updated.\n\n${parts.join('\n\n')}`;
        const threadId = await LB.getOrCreateCoachingThread(coachingId, 'Nutrition', userId);
        await LB.addCoachingNote(coachingId, 'general', null, null, body, userId, threadId);
      }
      reload();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  // Plain render helpers (not React components) — avoids remount-on-render keyboard bug
  const inputStyle = { width: '100%', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '9px 36px 9px 10px', fontFamily: UI.fontNum, fontSize: 16, color: UI.ink, outline: 'none', boxSizing: 'border-box' };
  const unitStyle  = { position: 'absolute', right: 8, fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, pointerEvents: 'none' };

  const renderInput = (fieldKey, label, unit) => (
    <div style={{ flex: 1 }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>{label}</div>
      <div style={{ position: 'relative' }}>
        <input type="number" inputMode="numeric" value={form[fieldKey]}
          onChange={e => setForm(f => ({ ...f, [fieldKey]: e.target.value }))}
          placeholder="—" style={inputStyle} />
        <span style={unitStyle}>{unit}</span>
      </div>
    </div>
  );

  const renderCals = (cals) => (
    <div style={{ flex: 1 }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>CALORIES</div>
      <div style={{ position: 'relative' }}>
        <div style={{ ...inputStyle, background: UI.bgRaised, border: `0.5px solid ${UI.hair}`, color: cals ? UI.ink : UI.inkGhost, display: 'flex', alignItems: 'center' }}>
          {cals ?? '—'}
        </div>
        <span style={unitStyle}>kcal</span>
      </div>
    </div>
  );

  const renderSection = (prefix, label, cals) => (
    <div style={{ marginBottom: 20 }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>{label}</div>
      <div style={{ background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {renderCals(cals)}
          {renderInput(`protein${prefix}`, 'PROTEIN', 'g')}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {renderInput(`carbs${prefix}`, 'CARBS', 'g')}
          {renderInput(`fat${prefix}`, 'FAT', 'g')}
        </div>
      </div>
    </div>
  );

  if (loading) return <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '16px 12px 32px' }}>
      {renderSection('Training', 'TRAINING DAY', calsTraining)}
      {renderSection('Rest', 'REST DAY', calsRest)}

      <Btn onClick={save} disabled={saving} style={{ marginBottom: 24, width: '100%' }}>
        {saving ? 'Saving…' : 'Save Macros'}
      </Btn>

      {macros.length > 0 && (
        <>
          <button onClick={() => setHistoryOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: 8 }}>
            <span className="micro" style={{ color: UI.inkFaint }}>HISTORY ({macros.length})</span>
            <i className={`fa-solid fa-chevron-${historyOpen ? 'up' : 'down'}`} style={{ fontSize: 8, color: UI.inkGhost }} />
          </button>
          {historyOpen && macros.map(m => {
            const td = [m.caloriesTraining && `${m.caloriesTraining} kcal`, m.proteinTraining && `${m.proteinTraining}g P`, m.carbsTraining && `${m.carbsTraining}g C`, m.fatTraining && `${m.fatTraining}g F`].filter(Boolean).join(' · ');
            const rd = [m.caloriesRest && `${m.caloriesRest} kcal`, m.proteinRest && `${m.proteinRest}g P`, m.carbsRest && `${m.carbsRest}g C`, m.fatRest && `${m.fatRest}g F`].filter(Boolean).join(' · ');
            return (
              <div key={m.id} style={{ padding: '10px 14px', background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hair}`, marginBottom: 8 }}>
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>
                  {fmtDate(m.setAt)} · {new Date(m.setAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </div>
                {td && <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 2 }}>Train: {td}</div>}
                {rd && <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>Rest: {rd}</div>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── CoachPlanEditorScreen ────────────────────────────────────────────────────
// Wraps the existing ScheduleEditScreen with client store + syncing.

function CoachPlanEditorScreen({ store, setStore, go, userId, coachingId, clientId, clientName, scheduleId }) {
  const [clientStore, setClientStoreRaw] = useStateC(null);
  const [syncErr, setSyncErr] = useStateC(false);
  const prevClientStore = useRefC(null);
  const latestClientStore = useRefC(null);  // updated synchronously for diff; prevClientStore only after confirmed sync
  const initialSchedule = useRefC(null);
  const isDirty = useRefC(false);

  useEffectC(() => {
    LB.loadClientStore(clientId).then(data => {
      setClientStoreRaw(data);
      prevClientStore.current = data;
      latestClientStore.current = data;
      const sch = data.schedules?.find(s => s.id === scheduleId);
      initialSchedule.current = sch ? JSON.parse(JSON.stringify(sch)) : null;
    });
  }, [clientId]);

  const setClientStore = useRefC(null);
  if (!setClientStore.current) {
    setClientStore.current = (updater) => {
      setClientStoreRaw(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        isDirty.current = true;
        latestClientStore.current = next;
        LB.syncStore(prevClientStore.current, next, clientId)
          .then(() => { prevClientStore.current = next; setSyncErr(false); })
          .catch(e => { console.error('Coach sync failed', e); setSyncErr(true); });
        return next;
      });
    };
  }

  // Intercept go: notify client via Changes thread if plan was modified, then return to plan tab
  const coachGo = async (route) => {
    if (route.name === 'plan-view' || route.name === 'plan') {
      if (isDirty.current) {
        isDirty.current = false;
        const isActivePlan = scheduleId === latestClientStore.current?.activeScheduleId;
        if (isActivePlan) {
          try {
            const finalSch  = latestClientStore.current?.schedules?.find(s => s.id === scheduleId);
            const schName   = finalSch?.name || scheduleId;
            const exercises = latestClientStore.current?.exercises || [];
            const diff      = LB.diffSchedule(initialSchedule.current, finalSch, exercises);
            const body      = diff
              ? `Updated plan: ${schName}\n\n${diff.split('\n').map(l => `• ${l}`).join('\n')}`
              : `Updated plan: ${schName}`;
            const threadId = await LB.getOrCreateCoachingThread(coachingId, `Changes on ${schName}`, userId);
            await LB.addCoachingNote(coachingId, 'plan', scheduleId, schName, body, userId, threadId);
          } catch (e) { console.error('Failed to send plan change note', e); }
        }
      }
      go({ name: 'coaching-client', coachingId, clientId, clientName, initialTab: 'plan' });
    } else {
      go(route);
    }
  };

  if (!clientStore) {
    return (
      <Screen>
        <TopBar title={clientName} sub={<span className="micro" style={{ color: 'var(--accent)' }}>COACHING</span>} onBack={() => go({ name: 'coaching-client', coachingId, clientId, clientName, initialTab: 'plan' })} />
        <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Loading…</div>
      </Screen>
    );
  }

  return (
    <>
      <window.Screens.ScheduleEditScreen
        store={clientStore}
        setStore={setClientStore.current}
        go={coachGo}
        userId={clientId}
        scheduleId={scheduleId}
      />
      <CoachSyncErrorPill show={syncErr} />
    </>
  );
}

// ─── CoachNewPlanScreen ───────────────────────────────────────────────────────
// Wraps ScheduleNewScreen with client store + syncing so a coach can create
// a brand-new plan for a client.

function CoachNewPlanScreen({ store, setStore, go, userId, coachingId, clientId, clientName }) {
  const [clientStore, setClientStoreRaw] = useStateC(null);
  const [syncErr, setSyncErr] = useStateC(false);
  const prevClientStore = useRefC(null);

  useEffectC(() => {
    LB.loadClientStore(clientId).then(data => {
      setClientStoreRaw(data);
      prevClientStore.current = data;
    });
  }, [clientId]);

  const setClientStore = useRefC(null);
  if (!setClientStore.current) {
    setClientStore.current = (updater) => {
      setClientStoreRaw(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        LB.syncStore(prevClientStore.current, next, clientId)
          .then(() => { prevClientStore.current = next; setSyncErr(false); })
          .catch(e => { console.error('Coach sync failed', e); setSyncErr(true); });
        return next;
      });
    };
  }

  const coachGo = (route) => {
    if (route.name === 'plan') {
      go({ name: 'coaching-client', coachingId, clientId, clientName, initialTab: 'plan' });
    } else if (route.name === 'schedule-edit') {
      go({ name: 'coaching-edit-plan', coachingId, clientId, clientName, scheduleId: route.scheduleId });
    } else {
      go(route);
    }
  };

  if (!clientStore) {
    return (
      <Screen>
        <TopBar title={clientName} sub={<span className="micro" style={{ color: 'var(--accent)' }}>COACHING</span>} onBack={() => go({ name: 'coaching-client', coachingId, clientId, clientName, initialTab: 'plan' })} />
        <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Loading…</div>
      </Screen>
    );
  }

  return (
    <>
      <window.Screens.ScheduleNewScreen
        store={clientStore}
        setStore={setClientStore.current}
        go={coachGo}
      />
      <CoachSyncErrorPill show={syncErr} />
    </>
  );
}

// ─── CoachingBannerGroup ──────────────────────────────────────────────────────
// Renders unread banner + notes sheet; mounted in HomeScreen.
