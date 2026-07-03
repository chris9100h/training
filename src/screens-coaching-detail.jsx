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

  // Y gridlines. For a small integer domain (choice ranks 1–3, short stepper
  // scales) place exactly one line per integer level, so axis labels never
  // collapse two gridlines onto the same option (e.g. a 3-option choice was
  // drawing 4 lines → "1, w, w, x"). Otherwise four evenly-spaced lines.
  const levels = dom.max - dom.min + 1;
  const intDomain = Number.isInteger(dom.min) && Number.isInteger(dom.max) && levels >= 2 && levels <= 6;
  const gridVals = intDomain
    ? Array.from({ length: levels }, (_, i) => dom.min + i)
    : Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
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

// ─── Shared check-in field helpers ────────────────────────────────────────────
// Used by both the on-screen trend cards and the PNG export so they always stay
// in lock-step with the (possibly customized) schema — no hardcoded field lists.

// Map a stored choice response to its 1-based rank among the field's options
// (text or numeric value; falls back to a legacy numeric value).
function checkinChoiceRank(field, resp) {
  if (resp == null || resp === '') return null;
  const idx = (field.options || []).findIndex(o => String(o.value) === String(resp));
  if (idx >= 0) return idx + 1;
  const n = Number(resp);
  return isNaN(n) ? null : n;
}

// Y-axis override for discrete fields so the chart starts at the lowest level.
function checkinFieldYRange(field) {
  if (field.type === 'stepper') return { yMin: field.min ?? 1, yMax: field.max || 10 };
  if (field.type === 'choice' && field.options?.length) return { yMin: 1, yMax: field.options.length };
  if (field.type === 'percent') return { yMin: 0, yMax: 100 };
  return {};
}

// Formats one check-in field's stored value for display — shared by the
// trend chart (via checkinFieldFormat below) and the check-in detail card,
// so the same stored number never shows two different values in two views.
// weightUnit/distUnit describe the CLIENT's units; numbers are never
// converted, only the label. `chart` only changes the handful of fields
// where an axis label genuinely needs different precision than a readable
// card row (steps, stepper fraction, choice fallback, pace value shape) —
// everything else renders identically either way.
function checkinFieldValue(field, v, { distUnit, weightUnit, chart = false } = {}) {
  if (field.unit === 'weight') return `${Math.round(v * 100) / 100}${weightUnit || UI.unit()}`;
  if (field.key === 'steps') return chart ? `${Math.round(v / 1000)}k` : Number(v).toLocaleString();
  if (field.key === 'days_trained') return `${v}d`;
  if (field.key === 'cardio_minutes') return `${v} min`;
  if (field.key === 'hydration_ml') return `${(v / 1000).toFixed(1)} L / day`;
  if (field._distanceField) return LB.fmtDistance(v, distUnit, 1);
  if (field.type === 'pace') {
    if (!chart) return String(v);
    const m = Math.floor(v / 60); const s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  if (field.type === 'percent') return `${Math.round(v)}%`;
  if (field.type === 'stepper') return chart ? `${v}/${field.max || 10}` : String(v);
  if (field.type === 'choice' && field.options?.length) {
    if (chart) { const opt = field.options[Math.round(v) - 1]; return opt ? opt.label : `${v}/${field.options.length}`; }
    const opt = field.options.find(o => String(o.value) === String(v));
    return opt ? opt.label : String(v);
  }
  if (field.unit) return `${v} ${field.unit}`;
  return chart ? String(Math.round(v * 10) / 10) : String(v);
}

// Chart-axis wrapper — curried so checkinChartMetrics can attach it as each
// metric's `format` function.
function checkinFieldFormat(field, distUnit, weightUnit) {
  return v => checkinFieldValue(field, v, { distUnit, weightUnit, chart: true });
}

// Build the per-field chart series for a set of check-ins, in schema order.
// Skips text fields; choice fields are charted by option rank.
function checkinChartMetrics(recent, schema, distUnit, weightUnit) {
  const metrics = [];
  (schema || CHECKIN_DEFAULT_SCHEMA).forEach(section => (section.fields || []).forEach(field => {
    if (field.type === 'text') return;
    const paceToSec = v => { if (!v) return null; const [m, s] = String(v).split(':'); const t = parseInt(m, 10) * 60 + parseInt(s, 10); return isNaN(t) ? null : t; };
    const values = field.type === 'choice'
      ? recent.map(c => checkinChoiceRank(field, c.responses?.[field.key]))
      : field.type === 'pace'
        ? recent.map(c => paceToSec(c.responses?.[field.key]))
        : recent.map(c => { const v = c.responses?.[field.key]; return (v != null && v !== '') ? Number(v) : null; });
    metrics.push({ label: field.label, values, format: checkinFieldFormat(field, distUnit, weightUnit), ...checkinFieldYRange(field) });
  }));
  return metrics;
}

// Escape text before embedding it in hand-built SVG markup — coach-editable
// labels/units/option names may contain & < > " ' which would otherwise break
// the XML and silently drop the chart from the PNG.
function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function exportCheckinCharts(recent, schema, weightUnit) {
  const cs = getComputedStyle(document.documentElement);
  const accent    = cs.getPropertyValue('--accent').trim();
  const accentRgb = cs.getPropertyValue('--accent-rgb').trim();
  const inkFaint  = cs.getPropertyValue('--ink-faint').trim();
  const bgColor   = cs.getPropertyValue('--bg').trim();
  const hairColor = cs.getPropertyValue('--hair').trim();
  const distUnit = LB.cardioDistUnit();

  const metrics = checkinChartMetrics(recent, schema, distUnit, weightUnit);

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
  for (const { label, entries, format, yMin, yMax } of charts) {
    const n = entries.length;
    const vals = entries.map(e => e.value);
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    const dom = UI.chartDomain(minV, maxV, { min: yMin, max: yMax });
    const plotW = W - padL - padR;
    const xOf = i => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
    const step = Math.max(1, Math.round(n / 5));
    const showLbl = i => i === n - 1 || i % step === 0;
    const pts = entries.map((e, i) => `${xOf(i).toFixed(1)},${yOf(e.value).toFixed(1)}`).join(' ');
    const base = (padTop + plotH).toFixed(1);

    const dec = dom.range >= 4 ? 0 : 1;
    const levels = dom.max - dom.min + 1;
    const intDomain = Number.isInteger(dom.min) && Number.isInteger(dom.max) && levels >= 2 && levels <= 6;
    const gridVals = intDomain
      ? Array.from({ length: levels }, (_, i) => dom.min + i)
      : Array.from({ length: 4 }, (_, i) => dom.min + (dom.range / 3) * i);
    const grid = gridVals.map((v, i) =>
      (i > 0 ? `<line x1="${padL}" y1="${yOf(v).toFixed(1)}" x2="${W - padR}" y2="${yOf(v).toFixed(1)}" stroke="${hr}" stroke-width="0.5" stroke-dasharray="3 3"/>` : '') +
      `<text x="${padL - 5}" y="${(yOf(v) + 3).toFixed(1)}" text-anchor="end" font-size="8" font-family="Arial,sans-serif" fill="${fi}">${escapeXml(format(Number(v.toFixed(dec))))}</text>`
    ).join('') +
      `<line x1="${padL}" y1="${padTop}" x2="${padL}" y2="${padTop + plotH}" stroke="${hr}" stroke-width="0.5"/>` +
      `<line x1="${padL}" y1="${padTop + plotH}" x2="${W - padR}" y2="${padTop + plotH}" stroke="${hr}" stroke-width="0.5"/>`;

    const nodes = entries.map((e, i) => {
      const cx = xOf(i).toFixed(1), cy = yOf(e.value).toFixed(1);
      const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      return `<circle cx="${cx}" cy="${cy}" r="${i === n - 1 ? 3 : 2}" fill="${a}"/>` +
        (showLbl(i) ? `<text x="${cx}" y="${(padTop + plotH + 16).toFixed(1)}" text-anchor="${anchor}" font-size="8" font-family="Arial,sans-serif" fill="${fi}">${escapeXml(fmtD(e.weekStart))}</text>` : '');
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

function CheckInTrendCards({ recent, schema, clientUnit }) {
  const resolvedSchema = schema || CHECKIN_DEFAULT_SCHEMA;
  const [chartModal, setChartModal] = useStateC(null);
  const [exporting, setExporting] = useStateC(false);
  const n = recent.length;

  const handleExport = () => {
    if (exporting || n < 2) return;
    setExporting(true);
    exportCheckinCharts(recent, resolvedSchema, clientUnit).catch(() => {}).finally(() => setExporting(false));
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
          return <div key={i} style={{ flex: 1, height: h, borderRadius: 4, background: i === vals.length - 1 ? 'var(--accent)' : `rgba(var(--accent-rgb),0.3)` }} />;
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
            <span style={{ fontSize: 10, color: arrowColor, fontFamily: UI.fontUi }}>{up ? '↑' : '↓'} {format(Math.abs(delta))}</span>
          )}
        </div>
        {sub && <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2, textAlign: 'center' }}>{sub}</div>}
        <div style={{ flex: 1 }} />
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

  const distUnit = LB.cardioDistUnit();

  // Keys shown as sub-labels on another card — don't render as standalone
  const SUB_KEYS = new Set();

  // Field chart helpers are shared module-level (also used by the PNG export).
  const getFormat = (field) => checkinFieldFormat(field, distUnit, clientUnit);
  const getYRange = checkinFieldYRange;
  const choiceRank = checkinChoiceRank;

  const renderFieldCard = (field) => {
    if (field.type === 'text') return null;
    if (SUB_KEYS.has(field.key)) return null;

    const paceToSec = v => { if (!v) return null; const [m, s] = String(v).split(':'); const t = parseInt(m, 10) * 60 + parseInt(s, 10); return isNaN(t) ? null : t; };
    const vals = field.type === 'choice'
      ? recent.map(c => choiceRank(field, c.responses?.[field.key]))
      : field.type === 'pace'
        ? recent.map(c => paceToSec(c.responses?.[field.key]))
        : recent.map(c => { const v = c.responses?.[field.key]; return (v != null && v !== '') ? Number(v) : null; });

    if (field.key === 'cardio_minutes') {
      const validItems = recent.filter(c => c.responses?.cardio_minutes != null);
      if (!validItems.length) return null;
      const last = validItems[validItems.length - 1];
      const prev = validItems.length > 1 ? validItems[validItems.length - 2] : null;
      const delta = prev != null ? last.responses.cardio_minutes - prev.responses.cardio_minutes : null;
      return (
        <div key={field.key} onClick={() => openChart('Cardio', field.icon || 'fa-person-running', vals, v => `${v} min`, false)} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
            <i className={`fa-solid ${field.icon || 'fa-person-running'}`} style={{ fontSize: 10, color: UI.inkFaint }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Cardio</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
            <span className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>{last.responses.cardio_minutes} min</span>
            {delta != null && Math.abs(delta) > 0 && (
              <span style={{ fontSize: 10, color: delta > 0 ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>{delta > 0 ? '↑' : '↓'} {Math.abs(delta)}</span>
            )}
          </div>
          <div style={{ flex: 1 }} />
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {resolvedSchema.map(section => (
          <TrendSection key={section.id} label={section.label.toUpperCase()}>
            {(section.fields || []).map(field => renderFieldCard(field))}
          </TrendSection>
        ))}
      </div>
    </>
  );
}

// ─── Preview data generator ──────────────────────────────────────────────────
// Generates 20 weeks of synthetic check-in data for the schema preview.
// Fixed seed (xorshift32) → same schema always produces the same chart.

function generatePreviewData(schema) {
  let s = 0xdeadbeef;
  const rand = () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; };

  const now = new Date();
  const dow = now.getDay() || 7;
  const mon = new Date(now); mon.setDate(now.getDate() - dow + 1); mon.setHours(0, 0, 0, 0);

  const flat = (schema || []).flatMap(sec => sec.fields || []);
  const allFields = flat.filter(f => f.type !== 'text');
  const textFields = flat.filter(f => f.type === 'text');
  const SAMPLE_NOTES = [
    'Felt strong this week, hit all my sessions and stuck to the plan.',
    'A couple of social meals on the weekend, otherwise on track.',
    'Sleep was a little off midweek but energy held up well.',
    'Right knee felt a bit tight on squats — kept the weight conservative.',
  ];

  const baseOf = f => {
    if (f.type === 'stepper') return { base: (f.min + f.max) * 0.6, range: (f.max - f.min) * 0.25 };
    if (f.type === 'choice')  return { base: 0, range: (f.options || []).length };
    if (f.type === 'percent') return { base: 85, range: 10 };
    const k = f.key || '';
    if (f.unit === 'weight')                         return { base: 82.5, range: 1.5 };
    if (k.includes('step'))                          return { base: 7500, range: 2500 };
    if (k.includes('hydration'))                     return { base: 2200, range: 400 };
    if ((k.includes('days') || k.includes('trained')) && !k.includes('off')) return { base: 4, range: 2 };
    if (k.includes('cardio') && k.includes('min'))   return { base: 45, range: 20 };
    if (k.includes('calorie'))                       return { base: 2000, range: 300 };
    if (k.includes('protein'))                       return { base: 160, range: 20 };
    return { base: 50, range: 20 };
  };

  const W = 20;
  return Array.from({ length: W }, (_, wk) => {
    const t = wk / (W - 1);
    const d = new Date(mon); d.setDate(mon.getDate() - (W - 1 - wk) * 7);
    const weekStart = LB.fmtISO(d);
    const responses = {};

    allFields.forEach(f => {
      const { base, range } = baseOf(f);
      const noise  = (rand() - 0.5) * 2 * range;
      const slope  = f.direction === 'higher_better' ?  range * 0.4 * t
                   : f.direction === 'lower_better'  ? -range * 0.4 * t : 0;

      if (f.type === 'stepper') {
        responses[f.key] = Math.max(f.min, Math.min(f.max, Math.round(base + slope + noise)));
      } else if (f.type === 'choice' && (f.options || []).length) {
        const n = f.options.length;
        const ideal = f.direction === 'higher_better' ? Math.round(t * (n - 1))
                    : f.direction === 'lower_better'  ? Math.round((1 - t) * (n - 1))
                    : Math.floor(n / 2);
        const idx = Math.max(0, Math.min(n - 1, ideal + Math.round((rand() - 0.5) * 1.2)));
        responses[f.key] = f.options[idx].value;
      } else if (f.type === 'percent') {
        responses[f.key] = Math.max(0, Math.min(100, Math.round(base + slope + noise)));
      } else if (f.type === 'integer') {
        responses[f.key] = Math.max(0, Math.round(base + slope + noise));
      } else if (f.type === 'decimal') {
        responses[f.key] = Math.max(0, Math.round((base + slope + noise) * 10) / 10);
      }
    });

    // Text fields: deterministic placeholder so the sample card shows their layout.
    textFields.forEach((f, ti) => { responses[f.key] = SAMPLE_NOTES[(ti + wk) % SAMPLE_NOTES.length]; });

    return { weekStart, responses };
  });
}

// ─── PreviewSection ───────────────────────────────────────────────────────────
function PreviewSection({ title, subtitle, children }) {
  const [open, setOpen] = useStateC(false);
  return (
    <div style={{ background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', gap: 10, WebkitTapHighlightColor: 'transparent' }}>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi }}>{title}</div>
          <div style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, marginTop: 1 }}>{subtitle}</div>
        </div>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: 11, color: UI.inkFaint }} />
      </button>
      {open && <div style={{ padding: '0 14px 14px' }}>{children}</div>}
    </div>
  );
}

// ─── CheckInFormPreview ────────────────────────────────────────────────────────
// Renders the exact same layout as CheckInForm but with no state or network calls.
// Uses the real FieldWidget + layoutRows so the coach sees a pixel-perfect preview.
function CheckInFormPreview({ schema }) {
  const sections = schema || CHECKIN_DEFAULT_SCHEMA;
  const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none' };
  const renderRow = (row, key) => {
    if (row.length === 2) {
      return (
        <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          {row.map(f => (
            <div key={f.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <FieldWidget field={f} value={null} onChange={() => {}} distUnit="km" setDistUnit={() => {}} inputStyle={inputStyle} />
            </div>
          ))}
        </div>
      );
    }
    const f = row[0];
    return <div key={key}><FieldWidget field={f} value={null} onChange={() => {}} distUnit="km" setDistUnit={() => {}} inputStyle={inputStyle} /></div>;
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, pointerEvents: 'none', userSelect: 'none' }}>
      {sections.map(section => {
        const rows = layoutRows(section.fields || []);
        if (!rows.length) return null;
        const headLabel = section.label.toUpperCase() + (section.sectionHint ? ` (${section.sectionHint})` : '');
        return (
          <div key={section.id}>
            <div className="knurl" style={{ margin: '0 0 6px' }} />
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>{headLabel}</div>
            <div className="knurl" style={{ margin: '0 0 10px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {rows.map((row, ri) => renderRow(row, ri))}
            </div>
          </div>
        );
      })}
      <Btn style={{ opacity: 0.5, marginTop: 4 }}>Submit Check-in</Btn>
    </div>
  );
}

// ─── CheckInSchemaBuilder ──────────────────────────────────────────────────────

// These four fields are always shown/removed as a group — the coach always wants all or none.
var MACRO_GROUP_KEYS = new Set(['calories_avg', 'protein_avg', 'carbs_avg', 'fat_avg']);

// Build a flat view for ReorderList where the 4 macro fields collapse into 1 group item.
// Each item: { isMacroGroup: true, arrayIdx } | { isMacroGroup: false, arrayIdx }
function buildFieldView(fields) {
  const view = [];
  let macroSeen = false;
  (fields || []).forEach((f, i) => {
    if (MACRO_GROUP_KEYS.has(f.key)) {
      if (!macroSeen) { view.push({ isMacroGroup: true, arrayIdx: i }); macroSeen = true; }
    } else {
      view.push({ isMacroGroup: false, arrayIdx: i });
    }
  });
  return view;
}

function CheckInSchemaBuilder({ coachingId, initial, onSave, onSaveForAll, onClose }) {
  const [draft, setDraft] = useStateC(() => JSON.parse(JSON.stringify(initial || CHECKIN_DEFAULT_SCHEMA)));
  const [view, setView] = useStateC('list');
  const [editCtx, setEditCtx] = useStateC(null);
  const [fieldDraft, setFieldDraft] = useStateC(null);
  const [sectionDraft, setSectionDraft] = useStateC(null);
  const [saving, setSaving] = useStateC(false);
  const [helpTip, setHelpTip] = useStateC(null);
  const [savePicker, setSavePicker] = useStateC(false);
  const previewData = useMemoC(() => generatePreviewData(draft), [draft]);
  const [confirmEl, confirm] = useConfirm();

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
      show_in_health_log: !!f.show_in_health_log, health_log_agg: f.health_log_agg || 'avg',
    });
    setEditCtx({ sectionIdx: sIdx, fieldIdx: fIdx });
    setHelpTip(null);
    setView('edit-field');
  };

  const openAddField = (sIdx) => {
    setFieldDraft({ key: '', label: '', type: 'integer', width: 'full', required: false, direction: null, icon: '', unit: '', hint: '', min: '1', max: '10', rows: '2', options: [], labeled: false, isNew: true, show_in_health_log: false, health_log_agg: 'avg' });
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
    if (['integer', 'decimal', 'stepper'].includes(fd.type) && fd.show_in_health_log) {
      f.show_in_health_log = true;
      f.health_log_agg = fd.health_log_agg || 'avg';
    }
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

  const reorderSections = (from, to) => { if (from === to) return; setDraft(s => { const n = JSON.parse(JSON.stringify(s)); const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; }); };
  const removeSection = (i) => setDraft(s => { const n = JSON.parse(JSON.stringify(s)); n.splice(i, 1); return n; });
  const reorderFields = (si, from, to) => { if (from === to) return; setDraft(s => { const n = JSON.parse(JSON.stringify(s)); const flds = n[si].fields; const [m] = flds.splice(from, 1); flds.splice(to, 0, m); return n; }); };
  // View-aware reorder: moves the macro group as a unit; non-macro fields move individually.
  const reorderByView = (si, fromV, toV) => {
    if (fromV === toV) return;
    setDraft(s => {
      const n = JSON.parse(JSON.stringify(s));
      const flds = n[si].fields;
      const view = buildFieldView(flds);
      const macroFields = flds.filter(f => MACRO_GROUP_KEYS.has(f.key));
      // Apply the move on the view level, then reconstruct the fields array
      // by looking up each view item's ORIGINAL field via its arrayIdx — not
      // by re-consuming non-macro fields in their old order, which silently
      // discarded every reorder (the moved item's new position was applied
      // to the view array, but the fields it mapped back to were still
      // handed out in original order, so the rebuilt array never changed).
      const newView = [...view];
      const [moved] = newView.splice(fromV, 1);
      newView.splice(toV, 0, moved);
      n[si].fields = newView.map(item =>
        item.isMacroGroup ? macroFields : [flds[item.arrayIdx]]
      ).flat();
      return n;
    });
  };
  const removeField = (si, fi) => setDraft(s => { const n = JSON.parse(JSON.stringify(s)); n[si].fields.splice(fi, 1); return n; });
  const removeMacroGroup = (si) => setDraft(s => { const n = JSON.parse(JSON.stringify(s)); n[si].fields = n[si].fields.filter(f => !MACRO_GROUP_KEYS.has(f.key)); return n; });
  const addMacroGroup = (defSection) => {
    const macroDefFields = (defSection.fields || []).filter(f => MACRO_GROUP_KEYS.has(f.key));
    macroDefFields.forEach(f => addDefaultField(defSection, f));
  };

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

  const handleReset = async () => {
    if (await confirm('Reset to the default check-in form? All customizations will be lost.', { ok: 'Reset', danger: true }))
      setDraft(JSON.parse(JSON.stringify(CHECKIN_DEFAULT_SCHEMA)));
  };

  // Default fields the coach has removed, grouped by their original section —
  // lets them add individual defaults back (e.g. the cardio fields the prefill
  // depends on) without a full reset that wipes their customizations.
  const missingDefaultsBySection = () => {
    const keys = new Set(draft.flatMap(s => (s.fields || []).map(f => f.key)));
    return CHECKIN_DEFAULT_SCHEMA
      .map(sec => ({ section: sec, fields: (sec.fields || []).filter(f => !keys.has(f.key)) }))
      .filter(g => g.fields.length);
  };

  const addDefaultField = (defSection, defField) => {
    setDraft(d => {
      const n = JSON.parse(JSON.stringify(d));
      let target = n.find(s => s.id === defSection.id)
        || n.find(s => (s.label || '').toLowerCase() === (defSection.label || '').toLowerCase());
      if (!target) {
        target = { id: defSection.id, label: defSection.label, ...(defSection.sectionHint ? { sectionHint: defSection.sectionHint } : {}), fields: [] };
        n.push(target);
      }
      target.fields.push(JSON.parse(JSON.stringify(defField)));
      return n;
    });
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
  const renderToggle = (on, onToggle) => <Toggle on={on} onToggle={onToggle} />;

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

          {['integer', 'decimal', 'stepper'].includes(fd.type) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px', borderRadius: 6, background: fd.show_in_health_log ? `rgba(var(--accent-rgb),0.06)` : UI.bgInset, border: `0.5px solid ${fd.show_in_health_log ? `rgba(var(--accent-rgb),0.25)` : UI.hair}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ ...lbl, marginBottom: 3 }}>Track daily in health log</div>
                  <div style={{ fontSize: 11, color: UI.inkGhost, fontFamily: UI.fontUi, lineHeight: 1.4 }}>
                    Client logs this field daily — weekly aggregate prefills the check-in
                  </div>
                </div>
                {renderToggle(fd.show_in_health_log, () => set('show_in_health_log', !fd.show_in_health_log))}
              </div>
              {fd.show_in_health_log && (
                <div>
                  <div style={{ ...lbl, marginBottom: 6 }}>Aggregate as</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => set('health_log_agg', 'avg')} style={segBtn(fd.health_log_agg === 'avg')}>Average</button>
                    <button onClick={() => set('health_log_agg', 'sum')} style={segBtn(fd.health_log_agg === 'sum')}>Sum</button>
                  </div>
                </div>
              )}
            </div>
          )}

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

  // ── PREVIEW VIEW ─────────────────────────────────────────────────────────
  if (view === 'preview') {
    const allFields = (draft || []).flatMap(s => s.fields || []);
    const hasChartableFields = allFields.some(f => f.type !== 'text');
    const sample = previewData[previewData.length - 1];
    return (
      <div style={overlayStyle}>
        <div style={headerStyle}>
          {backBtn(() => setView('list'))}
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, fontFamily: UI.fontUi, color: UI.ink }}>Preview</span>
            <div style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, marginTop: 1 }}>Tap a section to expand</div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '12px 14px 40px' }}>
          {allFields.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PreviewSection title="Client form" subtitle="what the client fills in">
                <div style={{ background: UI.bg, borderRadius: 8, border: `0.5px solid ${UI.hair}`, padding: '16px 14px' }}>
                  <CheckInFormPreview schema={draft} />
                </div>
              </PreviewSection>
              <PreviewSection title="Weekly check-in" subtitle="what the coach receives">
                <CheckInCard ci={sample} schema={draft} defaultOpen embedded />
              </PreviewSection>
              {hasChartableFields && (
                <PreviewSection title="Trends" subtitle="20-week charts">
                  <CheckInTrendCards recent={previewData} schema={draft} />
                </PreviewSection>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>
              Add fields to see a preview.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── ADD DEFAULT FIELDS VIEW ───────────────────────────────────────────────
  if (view === 'add-defaults') {
    const groups = missingDefaultsBySection();
    return (
      <div style={overlayStyle}>
        <div style={headerStyle}>
          {backBtn(() => setView('list'))}
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, fontFamily: UI.fontUi, color: UI.ink }}>Add Default Fields</span>
            <div style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, marginTop: 1 }}>Tap to add a removed field back</div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '12px 14px 40px' }}>
          {groups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 24px', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>
              All default fields are already in your form.
            </div>
          ) : groups.map(({ section, fields }) => {
            const macroFields = fields.filter(f => MACRO_GROUP_KEYS.has(f.key));
            const nonMacroFields = fields.filter(f => !MACRO_GROUP_KEYS.has(f.key));
            return (
              <div key={section.id} style={{ marginBottom: 18 }}>
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>{section.label}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {nonMacroFields.map(f => (
                    <button key={f.key} onClick={() => addDefaultField(section, f)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hair}`, cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}>
                      {f.icon && <i className={`fa-solid ${f.icon}`} style={{ fontSize: 13, color: UI.inkGhost, flexShrink: 0, width: 16, textAlign: 'center' }} />}
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>{f.label}</span>
                      <span style={{ fontSize: 9, color: TYPE_COLOR[f.type] || UI.inkGhost, fontFamily: UI.fontUi, fontWeight: 700, background: UI.bg, borderRadius: 4, padding: '1px 5px', border: `0.5px solid ${UI.hair}`, flexShrink: 0 }}>{TYPE_LABEL[f.type] || f.type}</span>
                      <i className="fa-solid fa-plus" style={{ fontSize: 12, color: 'var(--accent)', flexShrink: 0 }} />
                    </button>
                  ))}
                  {macroFields.length > 0 && (
                    <button onClick={() => addMacroGroup(section)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hair}`, cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}>
                      <i className="fa-solid fa-fire" style={{ fontSize: 13, color: UI.inkGhost, flexShrink: 0, width: 16, textAlign: 'center' }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>Macros (Cal · Protein · Carbs · Fat)</span>
                      <i className="fa-solid fa-plus" style={{ fontSize: 12, color: 'var(--accent)', flexShrink: 0 }} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── LIST VIEW ─────────────────────────────────────────────────────────────
  const hasMissingDefaults = missingDefaultsBySection().length > 0;
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
        <button onClick={() => setView('preview')}
          style={{ background: 'none', border: 'none', padding: '4px 8px', cursor: 'pointer', color: UI.inkFaint, fontSize: 14, lineHeight: 1 }} title="Preview">
          <i className="fa-solid fa-eye" />
        </button>
        {hasMissingDefaults && (
          <button onClick={() => setView('add-defaults')}
            style={{ background: 'none', border: 'none', padding: '4px 6px', cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }} title="Add default fields">
            <i className="fa-solid fa-plus" style={{ fontSize: 10 }} />
            Defaults
          </button>
        )}
        <button onClick={handleReset}
          style={{ background: 'none', border: 'none', padding: '4px 8px', cursor: 'pointer', color: UI.inkGhost, fontFamily: UI.fontUi, fontSize: 11 }}>
          Reset
        </button>
        <button onClick={() => onSaveForAll ? setSavePicker(true) : handleSave()} disabled={saving}
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '7px 16px', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, color: '#0a0805', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <ReorderList onReorder={reorderSections} style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 40px' }}>
        {draft.map((sec, sIdx) => (
          <div key={sec.id || sIdx} data-reorder-item="true" style={{ marginBottom: 12, background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '8px 6px 8px 8px', background: UI.bgRaised, borderBottom: `0.5px solid ${UI.hair}` }}>
              <DragHandle style={{ height: 22, width: 18, marginRight: 4 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sec.label}</span>
                {sec.sectionHint && <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, marginLeft: 8 }}>{sec.sectionHint}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button data-reorder-ignore="true" onClick={() => openEditSection(sIdx)}
                  style={{ background: 'none', border: 'none', padding: '5px 7px', cursor: 'pointer', color: UI.inkFaint, fontSize: 11 }}>
                  <i className="fa-solid fa-pen" />
                </button>
                <button data-reorder-ignore="true" onClick={async () => { if (await confirm('Remove section "' + sec.label + '" and all its fields?', { ok: 'Remove', danger: true })) removeSection(sIdx); }}
                  style={{ background: 'none', border: 'none', padding: '5px 7px', cursor: 'pointer', color: 'rgba(var(--danger-rgb),0.7)', fontSize: 11 }}>
                  <i className="fa-solid fa-trash" />
                </button>
              </div>
            </div>
            <ReorderList onReorder={(fromV, toV) => reorderByView(sIdx, fromV, toV)}>
              {buildFieldView(sec.fields).map((item, viewIdx) => {
                if (item.isMacroGroup) {
                  const presentMacros = (sec.fields || []).filter(f => MACRO_GROUP_KEYS.has(f.key));
                  return (
                    <div key="macro-group" data-reorder-item="true" style={{ display: 'flex', alignItems: 'center', padding: '8px 12px 8px 6px', borderBottom: `0.5px solid ${UI.hair}` }}>
                      <DragHandle style={{ height: 22, width: 18, marginRight: 4 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                          <i className="fa-solid fa-fire" style={{ fontSize: 11, color: UI.inkGhost, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>Macros</span>
                          <span style={{ fontSize: 9, color: UI.inkGhost, fontFamily: UI.fontUi, background: UI.bg, borderRadius: 4, padding: '1px 5px', border: `0.5px solid ${UI.hair}` }}>Cal · Protein · Carbs · Fat</span>
                        </div>
                        <div style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, marginTop: 2 }}>{presentMacros.length} fields bundled</div>
                      </div>
                      <button data-reorder-ignore="true" onClick={async () => { if (await confirm('Remove macro fields (Cal / Protein / Carbs / Fat)?', { ok: 'Remove', danger: true })) removeMacroGroup(sIdx); }}
                        style={{ background: 'none', border: 'none', padding: '5px 6px', cursor: 'pointer', color: 'rgba(var(--danger-rgb),0.7)', fontSize: 10 }}>
                        <i className="fa-solid fa-xmark" />
                      </button>
                    </div>
                  );
                }
                const f = (sec.fields || [])[item.arrayIdx];
                const fIdx = item.arrayIdx;
                return (
                  <div key={f.key || fIdx} data-reorder-item="true" style={{ display: 'flex', alignItems: 'center', padding: '8px 12px 8px 6px', borderBottom: `0.5px solid ${UI.hair}` }}>
                    <DragHandle style={{ height: 22, width: 18, marginRight: 4 }} />
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
                      <button data-reorder-ignore="true" onClick={() => openEditField(sIdx, fIdx)}
                        style={{ background: 'none', border: 'none', padding: '5px 6px', cursor: 'pointer', color: UI.inkFaint, fontSize: 10 }}>
                        <i className="fa-solid fa-pen" />
                      </button>
                      <button data-reorder-ignore="true" onClick={async () => { if (await confirm('Remove "' + f.label + '"?', { ok: 'Remove', danger: true })) removeField(sIdx, fIdx); }}
                        style={{ background: 'none', border: 'none', padding: '5px 6px', cursor: 'pointer', color: 'rgba(var(--danger-rgb),0.7)', fontSize: 10 }}>
                        <i className="fa-solid fa-xmark" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </ReorderList>
            <button data-reorder-ignore="true" onClick={() => openAddField(sIdx)}
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
      </ReorderList>
      {confirmEl}
    </div>
  );
}

// ─── ClientCheckInsTab (coach view) ───────────────────────────────────────────

function ClientCheckInsTab({ coachingId, checkinEnabled = true, onToggle, toggling = false, store, setStore, userId, clientUnit }) {
  const { checkins, loadErr, setLoadErr, schema, setSchema, coachingMacrosHistory, load } = useCoachingCheckins(coachingId);
  const [builderOpen, setBuilderOpen] = useStateC(false);

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
        <div style={{ opacity: toggling ? 0.6 : 1 }}>
          <Toggle on={checkinEnabled} onToggle={onToggle} />
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

  if (checkins === null && loadErr) {
    return (
      <>
        {builder}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {toggleRow}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
            <div style={{ fontSize: 13, color: 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi, textAlign: 'center' }}>Couldn't load check-ins.</div>
            <button onClick={() => { setLoadErr(false); load(); }} style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '8px 16px', cursor: 'pointer', color: UI.ink, fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600 }}>Retry</button>
          </div>
        </div>
      </>
    );
  }

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
            <CheckInTrendCards recent={recent} schema={resolvedSchema} clientUnit={clientUnit} />
            <div className="knurl" style={{ margin: '4px 0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="micro" style={{ color: UI.inkFaint }}>ALL CHECK-INS</div>
              {checkins.map((ci, i) => <CheckInCard key={ci.id} ci={ci} prevCi={checkins[i + 1]} schema={resolvedSchema} coachingMacrosHistory={coachingMacrosHistory} clientUnit={clientUnit} />)}
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

  // Calories auto-computed via the shared formula (no fiber — this form has
  // no net-carb concept); 0 is treated as "nothing entered yet", not a real value.
  const calcCals = (pro, car, fat) => {
    const total = LB.caloriesFromMacros(parseInt(pro) || 0, parseInt(car) || 0, parseInt(fat) || 0);
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

// Loads a client's store, keeping it in sync via LB.syncStore on every write.
// Shared by CoachPlanEditorScreen and CoachNewPlanScreen. `scheduleId` (editor
// only) additionally snapshots the initial schedule for diffing and tracks
// isDirty/latestClientStore so the caller can send a "what changed" note.
function useCoachClientSync(clientId, scheduleId) {
  const [clientStore, setClientStoreRaw] = useStateC(null);
  const [loadError, setLoadError] = useStateC(null);
  const [syncErr, setSyncErr] = useStateC(false);
  const prevClientStore = useRefC(null);
  const latestClientStore = useRefC(null);  // updated synchronously for diff; prevClientStore only after confirmed sync
  const initialSchedule = useRefC(null);
  const isDirty = useRefC(false);

  useEffectC(() => {
    let on = true;
    setClientStoreRaw(null);
    setLoadError(null);
    LB.loadClientStore(clientId).then(data => {
      if (!on) return;
      setClientStoreRaw(data);
      prevClientStore.current = data;
      latestClientStore.current = data;
      if (scheduleId) {
        const sch = data.schedules?.find(s => s.id === scheduleId);
        initialSchedule.current = sch ? JSON.parse(JSON.stringify(sch)) : null;
      }
    }).catch(e => { if (on) setLoadError(e.message); });
    return () => { on = false; };
  }, [clientId]);

  const setClientStoreRef = useRefC(null);
  if (!setClientStoreRef.current) {
    setClientStoreRef.current = (updater) => {
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

  return { clientStore, loadError, syncErr, setClientStore: setClientStoreRef.current, latestClientStore, initialSchedule, isDirty };
}

// Loading/error placeholder shown by both plan-editor wrapper screens while
// the client's store is being fetched (or failed to load).
function CoachClientLoadGate({ clientName, coachingId, clientId, go, loadError }) {
  return (
    <Screen>
      <TopBar title={clientName} sub={<span className="micro" style={{ color: 'var(--accent)' }}>COACHING</span>} onBack={() => go({ name: 'coaching-client', coachingId, clientId, clientName, initialTab: 'plan' })} />
      {loadError ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi, fontSize: 13 }}>Failed to load client data: {loadError}</div>
      ) : (
        <div style={{ padding: 32, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>Loading…</div>
      )}
    </Screen>
  );
}

// ─── CoachPlanEditorScreen ────────────────────────────────────────────────────
// Wraps the existing ScheduleEditScreen with client store + syncing.

function CoachPlanEditorScreen({ store, setStore, go, userId, coachingId, clientId, clientName, scheduleId }) {
  const { clientStore, loadError, syncErr, setClientStore, latestClientStore, initialSchedule, isDirty } = useCoachClientSync(clientId, scheduleId);

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

  if (loadError || !clientStore) {
    return <CoachClientLoadGate clientName={clientName} coachingId={coachingId} clientId={clientId} go={go} loadError={loadError} />;
  }

  return (
    <>
      <window.Screens.ScheduleEditScreen
        store={clientStore}
        setStore={setClientStore}
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
  const { clientStore, loadError, syncErr, setClientStore } = useCoachClientSync(clientId);

  const coachGo = (route) => {
    if (route.name === 'plan') {
      go({ name: 'coaching-client', coachingId, clientId, clientName, initialTab: 'plan' });
    } else if (route.name === 'schedule-edit') {
      go({ name: 'coaching-edit-plan', coachingId, clientId, clientName, scheduleId: route.scheduleId });
    } else {
      go(route);
    }
  };

  if (loadError || !clientStore) {
    return <CoachClientLoadGate clientName={clientName} coachingId={coachingId} clientId={clientId} go={go} loadError={loadError} />;
  }

  return (
    <>
      <window.Screens.ScheduleNewScreen
        store={clientStore}
        setStore={setClientStore}
        go={coachGo}
      />
      <CoachSyncErrorPill show={syncErr} />
    </>
  );
}

// ─── CoachingBannerGroup ──────────────────────────────────────────────────────
// Renders unread banner + notes sheet; mounted in HomeScreen.
