/* Coaching screens — charts, check-in summaries, nutrition + plan editors.
   Shares globals with screens-coaching-core.jsx (loaded first). */

function LineChartSheet({ label, icon, entries, format, invertColor, yMin, yMax, onClose }) {
  const W = 300, padX = 20, padTop = 36, padBottom = 26, plotH = 110;
  const H = padTop + plotH + padBottom;
  const plotW = W - 2 * padX;
  const vals = entries.map(e => e.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const dom = UI.chartDomain(minV, maxV, { min: yMin, max: yMax });
  const n = entries.length;
  // Thin out point labels (value + date) so they don't overlap when there are
  // many check-ins — show roughly 5 across, always including the last point.
  const labelStep = Math.max(1, Math.round(n / 5));
  const showLabel = i => i === n - 1 || i % labelStep === 0;

  const xOf = i => padX + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
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
            <line x1={padX} y1={padTop} x2={padX} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
            <line x1={padX} y1={padTop + plotH} x2={W - padX} y2={padTop + plotH} stroke={UI.hair} strokeWidth="0.5" />
            <polygon points={`${xOf(0).toFixed(1)},${base} ${pts} ${xOf(n-1).toFixed(1)},${base}`} fill={`rgba(var(--accent-rgb),0.12)`} />
            <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {entries.map((e, i) => {
              const cx = xOf(i).toFixed(1);
              const cy = yOf(e.value).toFixed(1);
              const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
              const lbl = showLabel(i);
              return (
                <g key={i}>
                  <circle cx={cx} cy={cy} r={lbl ? '4' : '2.5'} fill="var(--accent)" />
                  {lbl && <text x={cx} y={(yOf(e.value) - 9).toFixed(1)} textAnchor="middle" fontSize="9" fontFamily={UI.fontUi} fill={UI.ink}>{format(e.value)}</text>}
                  {lbl && <text x={cx} y={(padTop + plotH + 18).toFixed(1)} textAnchor={anchor} fontSize="8" fontFamily={UI.fontUi} fill={UI.inkFaint}>{fmtD(e.weekStart)}</text>}
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
  const ink       = cs.getPropertyValue('--ink').trim();
  const inkFaint  = cs.getPropertyValue('--ink-faint').trim();
  const bgColor   = cs.getPropertyValue('--bg').trim();
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

  const W = 320, padX = 24, padTop = 32, padBottom = 22, plotH = 90;
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
  const fg = ink || '#f0ebe0';
  const fi = inkFaint || '#8b7d6b';

  let y = 40;
  for (const { label, entries, format } of charts) {
    const n = entries.length;
    const vals = entries.map(e => e.value);
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    const dom = UI.chartDomain(minV, maxV);
    const plotW = W - 2 * padX;
    const xOf = i => padX + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const yOf = v => padTop + (1 - (v - dom.min) / dom.range) * plotH;
    const step = Math.max(1, Math.round(n / 5));
    const showLbl = i => i === n - 1 || i % step === 0;
    const pts = entries.map((e, i) => `${xOf(i).toFixed(1)},${yOf(e.value).toFixed(1)}`).join(' ');
    const base = (padTop + plotH).toFixed(1);

    const nodes = entries.map((e, i) => {
      const cx = xOf(i).toFixed(1), cy = yOf(e.value).toFixed(1);
      const lbl = showLbl(i);
      const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      return `<circle cx="${cx}" cy="${cy}" r="${lbl ? 4 : 2.5}" fill="${a}"/>` +
        (lbl ? `<text x="${cx}" y="${(yOf(e.value) - 9).toFixed(1)}" text-anchor="middle" font-size="9" font-family="Arial,sans-serif" fill="${fg}">${format(e.value)}</text>` : '') +
        (lbl ? `<text x="${cx}" y="${(padTop + plotH + 16).toFixed(1)}" text-anchor="${anchor}" font-size="8" font-family="Arial,sans-serif" fill="${fi}">${fmtD(e.weekStart)}</text>` : '');
    }).join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${chartH}">` +
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

function CheckInTrendCards({ recent }) {
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
          const h = Math.max(3, Math.round(((v - min) / range) * 16) + 3);
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

  const TrainingTrendCard = () => {
    const dtVals = recent.map(c => c.daysTrained);
    const valid = dtVals.filter(v => v != null);
    if (!valid.length) return null;
    const last = valid[valid.length - 1];
    const prev = valid.length > 1 ? valid[valid.length - 2] : null;
    const delta = prev != null ? last - prev : null;
    const lastPerf = [...recent].reverse().find(c => c.performanceVsLastWeek)?.performanceVsLastWeek;
    const perfColor = lastPerf === 'improved' ? 'var(--accent)' : lastPerf === 'worse' ? 'rgba(var(--danger-rgb),0.8)' : UI.inkSoft;
    const perfLabel = lastPerf === 'improved' ? '↑ Better' : lastPerf === 'worse' ? '↓ Worse' : lastPerf === 'same' ? '= Same' : null;
    return (
      <div onClick={() => openChart('Training days', 'fa-dumbbell', dtVals, v => `${v}d`, false)} style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
          <i className="fa-solid fa-dumbbell" style={{ fontSize: 10, color: UI.inkFaint }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Training</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>{last}d</span>
          {delta != null && Math.abs(delta) > 0 && (
            <span style={{ fontSize: 10, color: delta > 0 ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</span>
          )}
          {perfLabel && <span style={{ fontSize: 9, color: perfColor, fontFamily: UI.fontUi, fontWeight: 700 }}>{perfLabel}</span>}
        </div>
        <Sparkline vals={valid} />
      </div>
    );
  };

  const CardioTrendCard = () => {
    const allMins = recent.map(c => c.cardioMinutes);
    const validItems = recent.filter(c => c.cardioMinutes != null);
    if (!validItems.length) return null;
    const last = validItems[validItems.length - 1];
    const prev = validItems.length > 1 ? validItems[validItems.length - 2] : null;
    const delta = prev != null ? last.cardioMinutes - prev.cardioMinutes : null;
    const sub = last.cardioDistanceM != null ? `${(last.cardioDistanceM / 1000).toFixed(1)} km` : null;
    return (
      <div onClick={() => openChart('Cardio', 'fa-person-running', allMins, v => `${v} min`, false)} style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
          <i className="fa-solid fa-person-running" style={{ fontSize: 10, color: UI.inkFaint }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Cardio</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
          <span className="num" style={{ fontSize: 20, color: UI.ink, fontWeight: 300 }}>{last.cardioMinutes} min</span>
          {delta != null && Math.abs(delta) > 0 && (
            <span style={{ fontSize: 10, color: delta > 0 ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.8)', fontFamily: UI.fontUi }}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</span>
          )}
        </div>
        {sub && <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2, textAlign: 'center' }}>{sub}</div>}
        <Sparkline vals={validItems.map(c => c.cardioMinutes)} />
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
      <TrendSection label="WEIGHT">
        <TrendCard label="Avg last week" icon="fa-weight-scale" values={recent.map(c => c.weightAvgLastWeek)} format={v => `${Math.round(v * 100) / 100}${UI.unit()}`} invertColor={false} />
        <TrendCard label="Today" icon="fa-weight-scale" values={recent.map(c => c.weightToday)} format={v => `${Math.round(v * 100) / 100}${UI.unit()}`} invertColor={false} />
      </TrendSection>
      <TrendSection label="MARKERS">
        <TrendCard label="Hunger" icon="fa-bowl-food" values={recent.map(c => c.hunger)} format={v => `${v}`} invertColor={true} yMin={0} yMax={10} />
        <TrendCard label="Sleep" icon="fa-moon" values={recent.map(c => c.sleepQuality)} format={v => `${v}`} invertColor={true} yMin={0} yMax={10} />
        <TrendCard label="Life stress" icon="fa-brain" values={recent.map(c => c.lifeStress)} format={v => `${v}`} invertColor={true} yMin={0} yMax={10} />
        <TrendCard label="Work stress" icon="fa-briefcase" values={recent.map(c => c.workStress)} format={v => `${v}`} invertColor={true} yMin={0} yMax={10} />
        <TrendCard label="Tiredness" icon="fa-battery-half" values={recent.map(c => c.tiredness)} format={v => `${v}`} invertColor={true} yMin={0} yMax={10} />
      </TrendSection>
      <TrendSection label="TRAINING">
        <TrainingTrendCard />
        <TrendCard label="Steps" icon="fa-shoe-prints" values={recent.map(c => c.steps)} format={v => `${Math.round(v / 1000)}k`} invertColor={false} />
      </TrendSection>
      <TrendSection label="CARDIO">
        <CardioTrendCard />
        <TrendCard label="Pace feeling" icon="fa-gauge" values={recent.map(c => c.cardioPaceFeeling)} format={v => `${v}/6`} invertColor={false} yMin={0} yMax={6} />
        <TrendCard label="Effort" icon="fa-fire" values={recent.map(c => c.cardioEffort)} format={v => `${v}/10`} invertColor={true} yMin={0} yMax={10} />
        <TrendCard label="Distance" icon="fa-road" values={recent.map(c => c.cardioDistanceM)} format={v => { const du = (() => { try { return localStorage.getItem('logbook-cardio-dist-unit') || 'km'; } catch(_) { return 'km'; } })(); return du === 'mi' ? `${(v/1609.344).toFixed(1)} mi` : `${(v/1000).toFixed(1)} km`; }} invertColor={false} />
      </TrendSection>
    </>
  );
}

// ─── ClientCheckInsTab (coach view) ───────────────────────────────────────────

function ClientCheckInsTab({ coachingId, checkinEnabled = true, onToggle, toggling = false }) {
  const [checkins, setCheckins] = useStateC(null);

  useEffectC(() => {
    LB.loadCheckins(coachingId).then(setCheckins).catch(() => {});
  }, [coachingId]);

  const toggleRow = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0 }}>
      <div>
        <div style={{ fontSize: 13, fontFamily: UI.fontUi, fontWeight: 600, color: UI.ink }}>Check-ins enabled</div>
        <div style={{ fontSize: 11, fontFamily: UI.fontUi, color: UI.inkSoft, marginTop: 2 }}>Allow client to submit weekly check-ins</div>
      </div>
      <div
        onClick={onToggle}
        style={{ width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0, background: checkinEnabled ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${checkinEnabled ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`, position: 'relative', transition: 'background 0.18s', WebkitTapHighlightColor: 'transparent', opacity: toggling ? 0.6 : 1 }}
      >
        <div style={{ position: 'absolute', top: 3, left: checkinEnabled ? 21 : 3, width: 18, height: 18, borderRadius: 9, background: checkinEnabled ? '#0a0805' : UI.inkFaint, transition: 'left 0.18s' }} />
      </div>
    </div>
  );

  if (checkins === null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {toggleRow}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.1em' }}>LOADING…</div>
        </div>
      </div>
    );
  }

  if (!checkins.length) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {toggleRow}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 }}>
          <i className="fa-solid fa-clipboard-list" style={{ fontSize: 28, color: UI.inkGhost }} />
          <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center' }}>No check-ins yet.</div>
        </div>
      </div>
    );
  }

  const recent = [...checkins].reverse();

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {toggleRow}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ padding: '16px 14px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <CheckInTrendCards recent={recent} />
          <div className="knurl" style={{ margin: '4px 0' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="micro" style={{ color: UI.inkFaint }}>ALL CHECK-INS</div>
            {checkins.map(ci => <CheckInCard key={ci.id} ci={ci} />)}
          </div>
        </div>
      </div>
    </div>
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
