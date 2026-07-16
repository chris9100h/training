/* Autoregulation guide (in-app explainer).

   A per-mode, read-only field manual for the mesocycle / autoregulation engine.
   Pick one of the three plan modes at the top and the whole page reshapes to
   show only what applies to it: which questions are asked, how the two dials
   (sets and weight) move, the RIR taper and deloads. Content is native (uses UI
   tokens + the app theme), no external assets.

   Modes: 'A' = Volume+Load (unbounded autoregulate, both), 'B' = Load only
   (autoregulate, weight only), 'C' = Mesocycle (bounded block).

   Shares globals: UI, Screen, TopBar, Card, LB, React. Registered on
   window.Screens; route 'autoreg-guide' in app.jsx; optional `mode` prop
   preselects a mode (deep-linked from the plan editor). */

const { useState: useStateAG, useRef: useRefAG, useEffect: useEffectAG } = React;

// Low-opacity tint of any CSS color, for chip/panel fills that must read on
// both the dark and light themes (color-mix keeps it theme-aware).
function agTint(c, pct) { return `color-mix(in srgb, ${c} ${pct}%, transparent)`; }

const AG_MODES = ['A', 'B', 'C'];
const AG_MODE_META = {
  A: { tag: 'AUTO', nm: 'Volume + Load', short: 'Vol + Load',
       d: 'Open-ended autoregulation. Feedback tunes both your set counts and your weights, forever.',
       pills: ['Sets move', 'Weight moves', 'No RIR taper'] },
  B: { tag: 'AUTO · LOAD', nm: 'Load only', short: 'Load only',
       d: 'Set counts stay exactly as written. Feedback tunes weight only, and soreness becomes a brake on it.',
       pills: ['Sets frozen', 'Weight moves', 'No RIR taper'] },
  C: { tag: 'MESO', nm: 'Mesocycle', short: 'Mesocycle',
       d: 'A fixed 4 to 8 week block. Both dials move, each week ramps closer to failure, then a deload.',
       pills: ['Sets move', 'Weight moves', 'RIR taper + deload'] },
};

// Direction pill. kind: up | down | hold | block | flag.
function AGDir({ kind, children }) {
  const map = {
    up:    { c: UI.ok,       s: '▲' },
    down:  { c: UI.danger,   s: '▼' },
    hold:  { c: UI.inkFaint, s: '●' },
    block: { c: UI.danger,   s: '✕' },
    flag:  { c: UI.gold,     s: '⚑' },
  };
  const m = map[kind] || map.hold;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: UI.fontNum,
      fontSize: 10.5, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase',
      color: m.c, background: agTint(m.c, 13), borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: kind === 'hold' ? 7 : 9 }}>{m.s}</span>{children}
    </span>
  );
}

// Mono answer chip.
function AGChip({ children }) {
  return (
    <span style={{ fontFamily: UI.fontNum, fontSize: 11, fontWeight: 600, color: UI.ink,
      background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4,
      padding: '3px 8px', whiteSpace: 'nowrap' }}>{children}</span>
  );
}

// Small uppercase mono label.
function AGKick({ children, color }) {
  return <div style={{ fontFamily: UI.fontNum, fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: color || UI.inkFaint }}>{children}</div>;
}

// A panel with a titled header row (for the four questions).
function AGPanel({ idx, title, when, children }) {
  return (
    <div style={{ background: UI.bgRaised, border: `0.5px solid ${UI.hair}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 16px', borderBottom: `0.5px solid ${UI.hair}`, background: agTint(UI.gold, 5) }}>
        {idx != null && <span style={{ fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: UI.bg, background: UI.gold, width: 24, height: 24, borderRadius: 6, display: 'grid', placeItems: 'center', flex: 'none' }}>{idx}</span>}
        <span className="display" style={{ fontSize: 19, letterSpacing: '.01em' }}>{title}</span>
        {when && <span style={{ marginLeft: 'auto', fontFamily: UI.fontNum, fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: UI.inkFaint, textAlign: 'right', lineHeight: 1.35 }}>{when}</span>}
      </div>
      <div style={{ padding: '4px 16px 14px' }}>{children}</div>
    </div>
  );
}

// One answer row inside a panel. Two shapes, same content:
//  - default: a divided list row ([chip] [dir pills], explanation below). Used
//    where a panel has only a handful of options that read best as a column.
//  - cell: a self-contained inset card, for the feedback grids in section 03
//    where the options tile into a responsive 2-up grid to keep the (long)
//    question list from running mega-tall. Grid rows stretch, so a short cell
//    matches its taller neighbour instead of drifting.
function AGOpt({ chip, dirs, children, cell }) {
  if (cell) {
    return (
      <div style={{ background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6, padding: '10px 12px', height: '100%' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginBottom: 6 }}>
          <AGChip>{chip}</AGChip>
          {dirs}
        </div>
        <div style={{ fontSize: 12.5, color: UI.inkSoft, lineHeight: 1.45 }}>{children}</div>
      </div>
    );
  }
  return (
    <div style={{ padding: '12px 0', borderTop: `0.5px solid ${UI.hair}` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <AGChip>{chip}</AGChip>
        {dirs}
      </div>
      <div style={{ fontSize: 13, color: UI.inkSoft, lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

// The section 03 feedback options tile via the global .ag-opt-grid class
// (index.html): a fixed two columns on a phone, three on a wide screen. A
// media query, not auto-fit, so a narrow phone still gets two columns instead
// of collapsing to one once panel padding eats into the width.

function AGStat({ k, v, vColor, s }) {
  return (
    <div style={{ background: UI.bgRaised, border: `0.5px solid ${UI.hair}`, borderRadius: 8, padding: '14px 15px' }}>
      <AGKick>{k}</AGKick>
      <div className="display" style={{ fontSize: 20, marginTop: 4, color: vColor || UI.ink, lineHeight: 1.05 }}>{v}</div>
      <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 5, lineHeight: 1.4 }}>{s}</div>
    </div>
  );
}

function AGSecHead({ n, title, sub, chip }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontFamily: UI.fontNum, fontSize: 11, letterSpacing: '.14em', color: UI.gold }}>{n}</div>
      <h2 className="display" style={{ fontSize: 'clamp(23px,5vw,32px)', margin: '7px 0 0', letterSpacing: '-.01em', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        {title}
        {chip && <span style={{ fontFamily: UI.fontNum, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: UI.gold, border: `0.5px solid ${agTint(UI.gold, 45)}`, background: agTint(UI.gold, 8), borderRadius: 999, padding: '3px 10px' }}>{chip}</span>}
      </h2>
      {sub && <p style={{ color: UI.inkSoft, margin: '11px 0 0', fontSize: 14.5, maxWidth: '62ch' }}>{sub}</p>}
    </div>
  );
}

// Signal map rows: how each answer moves each dial, resolved per mode.
function agSignals(mode) {
  const up = (l) => <AGDir kind="up">{l}</AGDir>;
  const dn = (l) => <AGDir kind="down">{l}</AGDir>;
  const ho = (l) => <AGDir kind="hold">{l}</AGDir>;
  const bl = (l) => <AGDir kind="block">{l}</AGDir>;
  const B = mode === 'B';
  // Per-exercise signals (joint, pump, weight-feel) gate the weight in every mode.
  // The per-muscle workload signal drives the set deltas only (Volume+Load / Meso),
  // never the weight, and is not asked in Load only.
  const rows = [
    { sig: 'Reps all hit the earn ladder', sets: ho('no direct effect'), wt: up('bump, if gates green') },
    { sig: 'Early set misses the floor (x2)', sets: ho('none'), wt: dn('cut, overrides all') },
    { sig: 'Soreness: none / healed early', sets: B ? ho('frozen') : up('+1 set'), wt: ho('no effect') },
    { sig: 'Soreness: still sore', sets: B ? ho('frozen') : dn('-1 set'), wt: B ? bl('holds weight') : ho('no effect') },
    { sig: 'Joint: noticeable / sharp', sets: B ? ho('frozen') : dn('-1 set'), wt: bl('blocks bump') },
    { sig: 'Pump: low', sets: ho('none, tracks swap'), wt: bl('blocks bump') },
    { sig: 'Weight feel: too light / hard', sets: ho('no effect'), wt: up('earns bump') },
    { sig: 'Weight feel: too heavy', sets: ho('no effect'), wt: bl('blocks bump') },
  ];
  if (!B) {
    rows.push({ sig: 'Workload: not enough', sets: up('+1 set'), wt: ho('no effect') });
    rows.push({ sig: 'Workload: pushed / too much', sets: dn('-1 set'), wt: ho('no effect') });
  }
  return rows;
}

function AutoregGuideScreen({ store, go, mode: modeProp, back }) {
  const [mode, setMode] = useStateAG(AG_MODES.indexOf(modeProp) >= 0 ? modeProp : 'A');
  const topRef = useRefAG(null);
  // "Back to top" affordance. The Screen scrolls in its own container (topRef's
  // parent), not the window, so the listener and the scroll target are that.
  const [showTop, setShowTop] = useStateAG(false);
  useEffectAG(() => {
    const sc = topRef.current && topRef.current.parentElement;
    if (!sc) return;
    const onScroll = () => setShowTop(sc.scrollTop > 480);
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => sc.removeEventListener('scroll', onScroll);
  }, []);
  const scrollToTop = () => {
    const sc = topRef.current && topRef.current.parentElement;
    if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const M = mode;
  const isC = M === 'C', isB = M === 'B', isA = M === 'A';
  const backTo = () => go(back && back.name ? back : { name: 'settings' });

  const cardStyle = { background: UI.bgRaised, border: `0.5px solid ${UI.hair}`, borderRadius: 8, padding: 18 };
  const h3 = { fontSize: 18, marginBottom: 7 };

  // shared: section wrapper
  const Section = ({ children, style }) => (
    <div style={{ padding: '30px 0', borderTop: `0.5px solid ${UI.hair}`, ...style }}>
      <div style={{ maxWidth: 940, margin: '0 auto', padding: '0 4px' }}>{children}</div>
    </div>
  );

  return (
    <Screen>
      <div ref={topRef} aria-hidden="true" style={{ height: 0 }} />
      <TopBar title="Autoregulation" sub="How the plan adapts to you" onBack={backTo} />

      <div style={{ padding: '6px 18px 44px' }}>
        <div style={{ maxWidth: 940, margin: '0 auto' }}>

          {/* ── mode selector ── */}
          <div style={{ fontFamily: UI.fontNum, fontSize: 10.5, letterSpacing: '.18em', textTransform: 'uppercase', color: UI.inkFaint, margin: '10px 0 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            Select your plan mode<span style={{ flex: 1, height: 1, background: UI.hair }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {AG_MODES.map(k => {
              const meta = AG_MODE_META[k]; const on = k === M;
              return (
                <button key={k} onClick={() => { setMode(k); if (topRef.current) topRef.current.scrollIntoView({ block: 'start' }); }}
                  aria-pressed={on}
                  style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: UI.ink, position: 'relative', overflow: 'hidden',
                    background: UI.bgRaised, border: `1px solid ${on ? UI.gold : UI.hair}`, borderRadius: 8, padding: '16px 16px 14px',
                    boxShadow: on ? `0 0 0 1px ${UI.gold}` : 'none', transition: 'border-color .15s' }}>
                  <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: UI.gold, opacity: on ? 1 : 0 }} />
                  <div style={{ position: 'absolute', top: 13, right: 13, width: 16, height: 16, borderRadius: '50%', border: `2px solid ${on ? UI.gold : UI.hairStrong}`, background: on ? `radial-gradient(circle, ${UI.gold} 0 40%, transparent 46%)` : 'transparent' }} />
                  <div style={{ fontFamily: UI.fontNum, fontSize: 9.5, letterSpacing: '.13em', textTransform: 'uppercase', color: UI.inkFaint }}>{meta.tag}</div>
                  <div className="display" style={{ fontSize: 21, margin: '4px 0 8px', color: on ? UI.gold : UI.ink, lineHeight: 1 }}>{meta.nm}</div>
                  <div style={{ fontSize: 12.5, color: UI.inkSoft, lineHeight: 1.42 }}>{meta.d}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 11 }}>
                    {meta.pills.map(p => <span key={p} style={{ fontFamily: UI.fontNum, fontSize: 9, letterSpacing: '.04em', textTransform: 'uppercase', color: UI.inkSoft, background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 4, padding: '3px 6px' }}>{p}</span>)}
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── 01 overview ── */}
          <Section style={{ borderTop: 'none', marginTop: 14 }}>
            <AGSecHead n="01 / Overview" title={isB ? 'What Load only turns' : isC ? 'What a Mesocycle turns' : 'What Volume + Load turns'}
              sub={isA ? 'The full engine with no fixed end. Both dials move from your feedback, and it just keeps running.'
                : isB ? 'Your programmed set counts stay untouched. The feedback engine points entirely at the weight on the bar.'
                : 'The full both-dials engine wrapped in a bounded block: a weekly intensity ramp in RIR, ending in a deload.'} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 11 }}>
              <AGStat k="Dial 1 · Sets" v={isB ? 'Frozen' : 'Move'} vColor={isB ? UI.inkFaint : UI.ok}
                s={isB ? 'Stay exactly as authored, every session.' : isC ? 'Feedback rotates sets, frozen only in the final week.' : 'Feedback rotates sets across each muscle group.'} />
              <AGStat k="Dial 2 · Weight" v="Feedback owned" vColor={UI.gold} s="Reps earn it, recovery gates it, a cut overrides it. Same in every mode." />
              <AGStat k="RIR taper" v={isC ? 'Weekly ramp' : 'None'} vColor={isC ? UI.gold : UI.inkFaint}
                s={isC ? 'From an easy start down to failure in the last week.' : 'Open-ended plans carry no weekly RIR target.'} />
              <AGStat k="Deloads" v="2 routes" s={isC ? 'A planned end-of-block deload, plus manual anytime.' : 'A generic 8 week nudge, plus manual anytime.'} />
            </div>
            <div style={{ ...cardStyle, borderLeft: `3px solid ${UI.gold}`, marginTop: 16 }}>
              <AGKick color={UI.gold}>The one rule, every mode</AGKick>
              <div style={{ marginTop: 6, fontSize: 13.5, color: UI.inkSoft }}>
                <b style={{ color: UI.ink }}>Your feedback owns the direction of the weight.</b> A cut from missed reps overrides any increase. A withheld bump holds the weight. It only climbs when every recovery light is green. Classic Smart Progression still runs quietly underneath, but on these plans it never fires the "Progression unlocked" celebration on its own.
              </div>
            </div>
          </Section>

          {/* ── 02 roadmap ── */}
          <Section>
            <AGSecHead n="02 / Roadmap" title="How your feedback plays out"
              sub="One session in, one re-seeded session out. The pipeline is always the same; the difference between modes is only which dial each signal moves." />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 18 }}>
              {[
                ['Stage 1', 'You train', 'Log your real reps. Answer up to 4 quick questions per muscle group.'],
                ['Stage 2', 'Two signals', isB ? 'Objective: did the reps land. Subjective: soreness, joints, pump, weight feel.' : 'Objective: did the reps land. Subjective: soreness, joints, pump, weight feel, workload.'],
                ['Stage 3', 'Two dials', isB ? 'Sets stay put, weight earns or cuts.' : 'Sets rotate, weight earns or cuts.'],
                ['Stage 4', 'Next session', 'Seeded automatically: new set counts, new weight, reps reset on a jump.'],
              ].map(([n, h, l]) => (
                <div key={n} style={{ background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 8, padding: '12px 13px' }}>
                  <div style={{ fontFamily: UI.fontNum, fontSize: 9, letterSpacing: '.13em', textTransform: 'uppercase', color: UI.gold }}>{n}</div>
                  <div className="display" style={{ fontSize: 15, margin: '3px 0 6px' }}>{h}</div>
                  <div style={{ fontSize: 12, color: UI.inkSoft, lineHeight: 1.4 }}>{l}</div>
                </div>
              ))}
            </div>
            <AGKick>Signal map: which dial each answer moves</AGKick>
            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
              {agSignals(M).map((row, i) => (
                <div key={i} style={{ background: UI.bgRaised, border: `0.5px solid ${UI.hair}`, borderRadius: 8, padding: '12px 13px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: UI.ink, marginBottom: 10 }}>{row.sig}</div>
                  {[['Sets', row.sets], ['Weight', row.wt]].map(([lab, el]) => (
                    <div key={lab} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: lab === 'Weight' ? 7 : 0 }}>
                      <span style={{ fontFamily: UI.fontNum, fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: UI.inkFaint, width: 46, flexShrink: 0 }}>{lab}</span>
                      {el}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {isB && <div style={{ fontSize: 12.5, color: UI.inkSoft, marginTop: 12 }}>In Load only the sets column is inert: every set answer is frozen, so the questions exist purely to gate the weight. Soreness is repurposed as a recovery brake that holds the weight instead of cutting a set.</div>}
          </Section>

          {/* ── 03 the four questions ── */}
          <Section>
            <AGSecHead n="03 / Feedback" title="The questions and every answer"
              sub={isB ? 'Asked per muscle group: soreness first, then per exercise the joint, weight and pump check.' : 'Asked per muscle group: soreness first, then per exercise the joint, weight and pump check, then the muscle workload last.'} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '9px 14px', marginBottom: 18 }}>
              <AGDir kind="up">set up</AGDir><AGDir kind="down">set down</AGDir><AGDir kind="hold">nothing</AGDir><AGDir kind="block">blocks weight bump</AGDir><AGDir kind="flag">warning</AGDir>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* soreness */}
              <AGPanel idx="1" title="Soreness" when={<>per muscle<br />at start</>}>
                <p style={{ fontSize: 13.5, color: UI.inkSoft, margin: '11px 0' }}>
                  {isB ? 'In Load only, sets are frozen, so soreness is repurposed: it becomes a recovery brake on the weight. A still-sore muscle simply holds its weight this session.'
                    : isC ? 'A recovery signal that points both ways. It moves the sets. It is not asked in the final week (sets are frozen there), nor in week 1 of a fresh plan.'
                    : 'A recovery signal that points both ways. Too little is as much an off-target signal as too much. It moves the sets.'}
                </p>
                <div className="ag-opt-grid">
                  <AGOpt cell chip="Never sore" dirs={isB ? <AGDir kind="hold">weight not braked</AGDir> : <AGDir kind="up">+1 set</AGDir>}>
                    {isB ? 'Clears any weight brake on this muscle.' : 'Recovered easily, likely below target volume. +1 set to the least-grown exercise.'}
                  </AGOpt>
                  <AGOpt cell chip="Healed a while ago" dirs={isB ? <AGDir kind="hold">weight not braked</AGDir> : <AGDir kind="up">+1 set</AGDir>}>Same as "Never sore".</AGOpt>
                  <AGOpt cell chip="Healed just in time" dirs={<AGDir kind="hold">hold</AGDir>}>The optimal window. No change.</AGOpt>
                  <AGOpt cell chip="Still sore" dirs={isB ? <AGDir kind="block">holds weight</AGDir> : <AGDir kind="down">-1 set</AGDir>}>
                    {isB ? 'Brakes the weight: no bump for this muscle this session.' : 'Over-reach. -1 set from the most-grown exercise.'}
                  </AGOpt>
                </div>
              </AGPanel>

              {/* per exercise: joint + weight feel + pump */}
              <AGPanel idx="2" title="Per exercise" when={<>per exercise<br />after last set</>}>
                <p style={{ fontSize: 13.5, color: UI.inkSoft, margin: '11px 0' }}>
                  Asked for every exercise, every mode. Joint comfort, how the weight felt, and the pump: together these three gate the weight bump for this exercise{isB ? '.' : '. In Volume+Load and Meso, joint pain also shaves a set off this exercise.'}
                </p>
                <AGKick>Joint</AGKick>
                <div className="ag-opt-grid" style={{ marginTop: 8 }}>
                  <AGOpt cell chip="None" dirs={<AGDir kind="hold">gate green</AGDir>}>Joints fine. This exercise can earn its bump.</AGOpt>
                  <AGOpt cell chip="Noticeable" dirs={<>{!isB && <AGDir kind="down">-1 set</AGDir>}<AGDir kind="block">bump</AGDir></>}>
                    Discomfort. Blocks the bump{isB ? '.' : ', and shaves a set off this exercise.'}
                  </AGOpt>
                  <AGOpt cell chip="Sharp pain" dirs={<>{!isB && <AGDir kind="down">-1 set</AGDir>}<AGDir kind="block">bump</AGDir><AGDir kind="flag">warning</AGDir></>}>
                    Real pain. As above, plus a durable warning on the exercise ("caused sharp joint pain, consider swapping it").
                  </AGOpt>
                </div>
                <div style={{ marginTop: 14 }}><AGKick>Weight feel</AGKick></div>
                <div className="ag-opt-grid" style={{ marginTop: 8 }}>
                  <AGOpt cell chip="Too light" dirs={<AGDir kind="up">earns bump</AGDir>}>Weight can climb on this exercise.</AGOpt>
                  <AGOpt cell chip="Just right" dirs={<AGDir kind="hold">hold</AGDir>}>On point, gate green.</AGOpt>
                  <AGOpt cell chip="Hard" dirs={<AGDir kind="up">still earns bump</AGDir>}>Training should be hard. "Hard" still lets the weight climb. It self-corrects.</AGOpt>
                  <AGOpt cell chip="Too heavy" dirs={<AGDir kind="block">holds weight</AGDir>}>The only weight answer that holds. Everything lighter lets it climb.</AGOpt>
                </div>
                <div style={{ marginTop: 14 }}><AGKick>Pump</AGKick></div>
                <div className="ag-opt-grid" style={{ marginTop: 8 }}>
                  <AGOpt cell chip="Low" dirs={<><AGDir kind="block">bump</AGDir><AGDir kind="flag">swap</AGDir></>}>Barely felt it. Blocks the bump. Low pump on 3 sessions running suggests swapping this exercise, not forcing it.</AGOpt>
                  <AGOpt cell chip="Moderate" dirs={<AGDir kind="hold">gate green</AGDir>}>Decent stimulus. Weight can climb.</AGOpt>
                  <AGOpt cell chip="Amazing" dirs={<AGDir kind="hold">gate green</AGDir>}>Great stimulus.</AGOpt>
                </div>
                <div style={{ marginTop: 14 }}><AGKick>This lift (optional)</AGKick></div>
                <div className="ag-opt-grid" style={{ marginTop: 8 }}>
                  <AGOpt cell chip="Love it" dirs={<AGDir kind="hold">no dial</AGDir>}>A keeper. Pre-filled next time, so it costs no taps unless it changes.</AGOpt>
                  <AGOpt cell chip="It's fine" dirs={<AGDir kind="hold">no dial</AGDir>}>No strong feelings. Neutral.</AGOpt>
                  <AGOpt cell chip="Not my lift" dirs={<AGDir kind="flag">swap</AGDir>}>Marking this two sessions running suggests a variation you enjoy, so you actually stick with it. It gates nothing: a lift you dislike but that works still earns its weight.</AGOpt>
                </div>
              </AGPanel>

              {/* per-muscle workload (Volume+Load / Meso only) */}
              {!isB && (
                <AGPanel idx="3" title="Workload" when={<>per muscle<br />after last exercise</>}>
                  <p style={{ fontSize: 13.5, color: UI.inkSoft, margin: '11px 0' }}>
                    One question per muscle group: how much total work it got. This drives the set dial only. It no longer touches the weight, the per-exercise weight-feel question owns that now.
                  </p>
                  <div className="ag-opt-grid">
                    <AGOpt cell chip="Not enough" dirs={<AGDir kind="up">+1 set</AGDir>}>Too little. +1 set to the least-grown exercise.</AGOpt>
                    <AGOpt cell chip="Just right" dirs={<AGDir kind="hold">hold</AGDir>}>On point.</AGOpt>
                    <AGOpt cell chip="Pushed my limits" dirs={<AGDir kind="down">-1 set</AGDir>}>To the limit. Cuts a set off the most-grown exercise.</AGOpt>
                    <AGOpt cell chip="Too much" dirs={<AGDir kind="down">-1 every exercise</AGDir>}>Clearly too much. Cuts a set off every exercise of the group.</AGOpt>
                  </div>
                </AGPanel>
              )}
            </div>

            <div style={{ ...cardStyle, borderLeft: `3px solid ${UI.gold}`, marginTop: 16 }}>
              <AGKick color={UI.gold}>No double-stacking</AGKick>
              <div style={{ marginTop: 6, fontSize: 13.5, color: UI.inkSoft }}>
                {isB ? 'Every set effect above is frozen in Load only, so the questions only ever open or close the weight gate. You can still fix any answer until the session ends, it re-computes cleanly.'
                  : 'Two negative answers on the same exercise never stack to -2: the first one to cut it owns that cut for the session, a later -1 just drops. You can fix any answer until the session ends, it re-computes cleanly.'}
              </div>
            </div>
          </Section>

          {/* ── 04 volume dial ── */}
          <Section>
            <AGSecHead n="04 / Dial 1" title={isB ? 'The volume dial, and why it is off here' : 'The volume dial'}
              sub={isB ? 'In Load only the set dial is deliberately locked. Your programmed set counts never change, so the rotation system does not run. The questions that would move sets instead only gate the weight.'
                : isC ? 'Each exercise carries a hidden set delta per training day. Next session: sets = max(1, planned + delta). Never below 1, no cap above. Frozen in the final week.'
                : 'Each exercise carries a hidden set delta per training day. Next session: sets = max(1, planned + delta). Never below 1, no cap above.'} />
            {isB ? (
              <div style={{ ...cardStyle, borderLeft: `3px solid ${UI.gold}` }}>
                <AGKick color={UI.gold}>Sets frozen</AGKick>
                <div style={{ marginTop: 6, fontSize: 13.5, color: UI.inkSoft }}>
                  <b style={{ color: UI.ink }}>Your set counts stay exactly as you wrote them.</b> Load only points the entire feedback engine at the weight. If you want the app to also add and remove sets, switch to Volume + Load or a Mesocycle in the plan editor.
                </div>
              </div>
            ) : (
              <>
                <AGPanel title="Fair rotation: who gets the +1">
                  <p style={{ fontSize: 13.5, color: UI.inkSoft, margin: '11px 0' }}>A grant goes to the exercise in the group with the fewest grants so far. Ties go to the main lift. The cut mirrors it: it hits the most-grown exercise, ties to the main lift. So the group drifts to its target together instead of one lift ballooning.</p>
                  <AGKick>Chest day, empty start. Four grants in a row: Soreness "Never", then 3x "Not enough"</AGKick>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 9, marginTop: 10 }}>
                    {[['Bench Press', 'Main lift', 2, 5], ['Incline DB', 'Accessory', 1, 4], ['Cable Fly', 'Accessory', 1, 4]].map(([nm, tp, g, s]) => (
                      <div key={nm} style={{ background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6, padding: '12px 13px' }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{nm}</div>
                        <div style={{ fontFamily: UI.fontNum, fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: UI.gold }}>{tp}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, fontFamily: UI.fontNum, fontSize: 12, color: UI.inkSoft }}><span>Grants</span><span style={{ color: UI.ink, fontWeight: 600 }}>{g}</span></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontFamily: UI.fontNum, fontSize: 12, color: UI.inkSoft }}><span>Sets 3 &#8594;</span><span style={{ color: UI.ok, fontWeight: 600 }}>{s}</span></div>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 12.5, color: UI.inkSoft, margin: '12px 0 0' }}><b style={{ color: UI.ink }}>1.</b> Never at a tie &#8594; Bench. <b style={{ color: UI.ink }}>2.</b> Not enough &#8594; Incline. <b style={{ color: UI.ink }}>3.</b> &#8594; Fly. <b style={{ color: UI.ink }}>4.</b> All tied &#8594; back to Bench. Result 2, 1, 1: spread, not +4 on one lift.</p>
                </AGPanel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 12, marginTop: 14 }}>
                  <div style={cardStyle}><h3 className="display" style={{ ...h3, color: UI.ok }}>The MRV idea</h3><p style={{ fontSize: 14, color: UI.inkSoft, margin: 0 }}>No soreness plus a weak pump reads as too little, so add. Still sore plus "pushed" reads as too much, so cut. "Just right" is the productive window: hold. It hunts your maximum recoverable volume.</p></div>
                  <div style={cardStyle}><h3 className="display" style={h3}>Floors and caps</h3><p style={{ fontSize: 14, color: UI.inkSoft, margin: 0 }}>A set count never seeds below 1, and there is no cap above. An over-grown lift is only pulled back by the cut signals, never by a hard ceiling.</p></div>
                </div>
              </>
            )}
          </Section>

          {/* ── 05 weight dial ── */}
          <Section>
            <AGSecHead n="05 / Dial 2" title="The weight dial"
              sub="Two independent halves, both driven by your real reps: the earn ladder (up) and the rep-miss streak (down). Example: range 8 to 12, step 2.5 kg / 5 lbs." />
            {/* earn ladder */}
            <div style={cardStyle}>
              <AGKick>The staggered earn ladder (per set target)</AGKick>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, padding: '26px 4px 4px' }}>
                {[[118, 12, 'Set 1'], [94, 10, 'Set 2'], [70, 8, 'Set 3']].map(([h, v, l]) => (
                  <div key={l} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: '100%', maxWidth: 58, height: h, borderRadius: '4px 4px 0 0', background: `linear-gradient(180deg, ${UI.gold}, ${UI.goldDeep})`, border: `0.5px solid ${agTint(UI.gold, 50)}`, borderBottom: 'none', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: -22, left: 0, right: 0, textAlign: 'center', fontFamily: UI.fontNum, fontWeight: 700, fontSize: 13, color: UI.ink }}>{v}</div>
                    </div>
                    <div style={{ fontFamily: UI.fontNum, fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase', color: UI.inkFaint }}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: UI.fontNum, fontSize: 10, color: UI.inkFaint, marginTop: 6 }}><span>top = 12</span><span>bottom = 8</span></div>
              <p style={{ fontSize: 12.5, color: UI.inkSoft, margin: '10px 0 0' }}>Set 1 must reach the top, the last only the bottom, staggered in between. A strong first set with fading later sets still qualifies. Not "all at the top". A single set has to hit the range midpoint (10), and it is not exempt from the miss check below.</p>
            </div>

            {/* bump gate */}
            <div style={{ marginTop: 14 }}>
              <AGPanel title={`Bump: ${isB ? 'five' : 'four'} green lights`}>
                <p style={{ fontSize: 13.5, color: UI.inkSoft, margin: '11px 0' }}>A weight bump (+2.5 kg / 5 lbs, equipment dependent) needs all of these, re-earned every session. On a jump the reps reset to the range floor.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 9 }}>
                  {[
                    ['1 · Reps', 'Every set clears its staggered ladder target.'],
                    ['2 · Joint', 'Answer was "None".'],
                    ['3 · Pump', '"Moderate" or "Amazing".'],
                    ['4 · Weight feel', 'Anything but "Too heavy" ("Hard" still counts).'],
                    ...(isB ? [['5 · Soreness', 'Muscle is not "Still sore".']] : []),
                  ].map(([t, d]) => (
                    <div key={t} style={{ background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6, padding: '12px 13px' }}>
                      <div style={{ fontFamily: UI.fontNum, fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: UI.ok, marginBottom: 5 }}>{t}</div>
                      <div style={{ fontSize: 12.5, color: UI.inkSoft }}>{d}</div>
                    </div>
                  ))}
                </div>
                {isB && <p style={{ fontSize: 12.5, color: UI.inkSoft, margin: '12px 0 0' }}>Reps, Joint, Pump and Weight feel are all judged <b style={{ color: UI.ink }}>per exercise</b>, so each lift earns or holds its own weight. Soreness applies to the whole <b style={{ color: UI.ink }}>muscle group</b>.</p>}
                {!isB && <p style={{ fontSize: 12.5, color: UI.inkSoft, margin: '12px 0 0' }}>All four are judged <b style={{ color: UI.ink }}>per exercise</b>. Soreness is not among them here: in this mode it moves your <b style={{ color: UI.ink }}>sets</b> instead (still sore = one set off the most-grown lift). It only holds the weight in Load only.</p>}
              </AGPanel>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 12, marginTop: 14 }}>
              <div style={cardStyle}><h3 className="display" style={h3}>Between jumps: +1 rep</h3><p style={{ fontSize: 14, color: UI.inkSoft, margin: 0 }}>With no jump due, the app seeds the rep target +1 higher each session, capped at the range top, same weight. That is the rep climb you feel.</p></div>
              <div style={cardStyle}><h3 className="display" style={{ ...h3, color: UI.danger }}>Cut: two failed sessions</h3><p style={{ fontSize: 14, color: UI.inkSoft, margin: 0 }}>An early set below the range floor starts a streak (the last set is exempt when there are 2+ sets; a single set counts directly). Two in a row cut the weight one increment (2.5 kg / 5 lbs).</p></div>
            </div>

            <div style={{ ...cardStyle, borderLeft: `3px solid ${UI.gold}`, marginTop: 14 }}>
              <AGKick color={UI.gold}>How it seeds next time</AGKick>
              <div style={{ marginTop: 6, fontSize: 13.5, color: UI.inkSoft }}>
                <b style={{ color: UI.ink }}>Cut</b> overrides an increase. <b style={{ color: UI.ink }}>Bump granted</b> means up, reps back to the floor. <b style={{ color: UI.ink }}>Bump withheld</b> (a light red) holds the weight while the reps keep climbing. {isC ? 'The only exception is the very first week of your first block: no feedback exists yet, so Smart Progression is allowed through until week 2.' : 'The only exception is the very first week after enabling it: no feedback exists yet, so Smart Progression is allowed through until the first feedback session lands.'}
              </div>
            </div>
          </Section>

          {/* ── 06 mesocycle structure (C only) ── */}
          {isC && (
            <Section>
              <AGSecHead n="06 / Block" title="The mesocycle structure" chip="Mesocycle only"
                sub="What a fixed block adds on top of the both-dials engine: a weekly intensity ramp, a frozen final week, a completion offer, and carryover into the next block." />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: 12, alignItems: 'start' }}>
                <div style={cardStyle}>
                  <AGKick>RIR taper: 5 week block, 3 &#8594; 0</AGKick>
                  <svg viewBox="0 0 360 200" style={{ display: 'block', width: '100%', height: 'auto', marginTop: 6 }} role="img" aria-label="RIR taper line chart from 3 down to 0">
                    {[40, 80, 120].map(y => <line key={y} x1="40" y1={y} x2="330" y2={y} stroke={UI.hair} strokeWidth="1" />)}
                    <line x1="40" y1="160" x2="330" y2="160" stroke={UI.hairStrong} strokeWidth="1" />
                    <line x1="40" y1="30" x2="40" y2="160" stroke={UI.hairStrong} strokeWidth="1" />
                    <polygon points="55,45 120,85 185,85 250,125 315,160 315,160 55,160" fill={agTint(UI.gold, 14)} />
                    <polyline points="55,45 120,85 185,85 250,125 315,160" fill="none" stroke={UI.gold} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                    {[[55, 45, 3], [120, 85, 2], [185, 85, 2], [250, 125, 1], [315, 160, 0]].map(([x, y, v]) => (
                      <g key={x}><circle cx={x} cy={y} r="4.5" fill={UI.gold} stroke={UI.bg} strokeWidth="2" />
                        <text x={x} y={y - 10} textAnchor="middle" fill={UI.ink} style={{ fontFamily: UI.fontNum, fontSize: 11, fontWeight: 700 }}>{v}</text></g>
                    ))}
                    {['W1', 'W2', 'W3', 'W4', 'W5'].map((w, i) => <text key={w} x={55 + i * 65} y="176" textAnchor="middle" fill={UI.inkFaint} style={{ fontFamily: UI.fontNum, fontSize: 10 }}>{w}</text>)}
                    <text x="4" y="45" fill={UI.inkFaint} style={{ fontFamily: UI.fontNum, fontSize: 10 }}>easy</text>
                    <text x="2" y="160" fill={UI.inkFaint} style={{ fontFamily: UI.fontNum, fontSize: 10 }}>fail</text>
                  </svg>
                  <p style={{ fontSize: 12, color: UI.inkSoft, margin: '8px 0 0' }}>RIR is reps in reserve. The target drops linearly and rounds to whole numbers (so weeks 2 and 3 can share a value). A negative end value prescribes lengthened partials past failure.</p>
                </div>
                <div style={{ display: 'grid', gap: 11 }}>
                  <AGStat k="Final week" v="Sets freeze" vColor={UI.gold} s="Soreness is not asked; joint and pump/volume still are, because the weight keeps moving into the next block." />
                  <AGStat k="On completion" v="Deload offer" s="Finishing the last week offers a deload, then the next block (weights carry, sets reset)." />
                  <AGStat k="Badge" v="MESO C3/5 · 2 RIR" s="Block number, week in block, and this week’s RIR target, on the plan card." />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: 12, marginTop: 14 }}>
                <div style={cardStyle}><h3 className="display" style={h3}>How the week advances</h3><p style={{ fontSize: 14, color: UI.inkSoft, margin: 0 }}>The week tracks fatigue, so the rule depends on your plan type. <b style={{ color: UI.ink }}>Flex plans</b> count your trained, non-deload sessions (skipping does not advance). <b style={{ color: UI.ink }}>Date and weekday plans</b> count calendar time minus paused recovery days, so an ordinary rest day still moves the clock. Sick and deload days always freeze it; a vacation day freezes it only if you did not train.</p></div>
                <div style={cardStyle}><h3 className="display" style={h3}>Carryover into the next block</h3><p style={{ fontSize: 14, color: UI.inkSoft, margin: 0 }}><b style={{ color: UI.ink }}>Carries:</b> your earned weights and the rep-miss streak. <b style={{ color: UI.ink }}>Resets:</b> all set counts, the joint and low-pump flags, the rotation counters, and the RIR taper. So block two starts at the weights you earned but your original set counts.</p></div>
              </div>
              <div style={{ ...cardStyle, borderLeft: `3px solid ${UI.gold}`, marginTop: 14 }}>
                <AGKick color={UI.gold}>Completion offer chain</AGKick>
                <div style={{ marginTop: 6, fontSize: 13.5, color: UI.inkSoft }}><b style={{ color: UI.ink }}>1.</b> "Start deload?" (or skip). <b style={{ color: UI.ink }}>2.</b> "Start the next block? Weights carry over, sets reset." <b style={{ color: UI.ink }}>3.</b> Or keep the plan running as a plain cycle, or deactivate it.</div>
              </div>
            </Section>
          )}

          {/* ── 07 deloads ── */}
          <Section>
            <AGSecHead n="07 / Deloads" title="Deloads in this mode"
              sub={isC ? 'A bounded block ends in its own planned deload offer. It does not get the generic 8 week nudge (it has its own end), but you can still start a manual deload anytime.'
                : 'Open-ended plans have no built-in end, so their automatic deload is a generic nudge after roughly 8 weeks of training, plus a manual deload you can start anytime.'} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 12, marginBottom: 14 }}>
              <div style={{ ...cardStyle, borderLeft: `3px solid ${UI.gold}` }}>
                <h3 className="display" style={h3}>{isC ? '1 · Planned end-of-block' : '1 · The 8 week nudge'}</h3>
                <p style={{ fontSize: 14, color: UI.inkSoft, margin: 0 }}>{isC ? 'Finishing the final week pops "Mesocycle complete! Start deload?". Taking it runs one light week, then offers the next block. Unique to bounded blocks.' : 'After about 8 weeks of training since your last deload (counted by sessions, weeks, or cycles depending on plan type), the app offers "Start deload". Take it or dismiss it.'}</p>
              </div>
              <div style={{ ...cardStyle, borderLeft: `3px solid ${UI.inkFaint}` }}>
                <h3 className="display" style={h3}>2 · Manual, anytime</h3>
                <p style={{ fontSize: 14, color: UI.inkSoft, margin: 0 }}>The active plan card has a Deload button in every mode. It runs your normal plan at ~50% load for one cycle, then auto-ends.</p>
              </div>
            </div>
            <div style={cardStyle}>
              <h3 className="display" style={h3}>What a deload week actually does</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: '8px 16px', marginTop: 6 }}>
                {[
                  ['Loads halved', 'to about 50% (rounded to 2.5). Reps are not reduced. Bodyweight and assisted lifts are not halved.'],
                  ['No RIR, no PR, no progression', 'overlays. It is deliberately light, so no jumps and no regression flags.'],
                  ['No feedback collected.', 'Soreness, joints and pump/volume are all skipped for the week.'],
                  ['Progress preserved.', 'Earned weights and the rep-miss streak carry through, and deload sessions never seed or skew later weeks.'],
                ].map(([b, t]) => <p key={b} style={{ fontSize: 13.5, color: UI.inkSoft, margin: 0 }}><b style={{ color: UI.ink }}>{b}</b> {t}</p>)}
              </div>
            </div>
            {!isC && (
              <div style={{ ...cardStyle, borderLeft: `3px solid ${UI.danger}`, marginTop: 14 }}>
                <AGKick color={UI.danger}>Heads up on the copy</AGKick>
                <div style={{ marginTop: 6, fontSize: 13.5, color: UI.inkSoft }}>The plan editor labels Autoregulate as "Open-ended, no deload". That means no <b style={{ color: UI.ink }}>planned</b> block-end deload. You do still get the automatic 8 week nudge and the manual button, so you are not without a deload.</div>
              </div>
            )}
          </Section>

          {/* ── 08 setup ── */}
          <Section>
            <AGSecHead n="08 / Setup" title="Turning it on for a plan"
              sub="Autoregulate and Mesocycle are two mutually exclusive switches in the plan editor (hidden for 5/3/1 plans, which run their own wave)." />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 12 }}>
              <div style={cardStyle}><AGKick color={UI.gold}>Enable this mode</AGKick><p style={{ fontSize: 14, color: UI.inkSoft, margin: '7px 0 0' }}>{isC ? 'Turn on Mesocycle, set the length (4 to 8 weeks) and the RIR ramp (start and end).' : `Turn on Autoregulate, then pick ${isB ? 'Load only' : 'Volume + Load'} in the sub-picker.`}</p></div>
              <div style={cardStyle}><AGKick>Switching resets state</AGKick><p style={{ fontSize: 14, color: UI.inkSoft, margin: '7px 0 0' }}>Toggling autoregulation, or changing the week count, clears that plan’s saved state. It restarts cleanly, aligned to your next cycle or Monday.</p></div>
              <div style={cardStyle}><AGKick>Enabling mid-plan</AGKick><p style={{ fontSize: 14, color: UI.inkSoft, margin: '7px 0 0' }}>Switch it on over a plan you already trained, and week 1 soreness is asked only for muscles you actually trained before, never one with no history.</p></div>
            </div>
          </Section>

          {/* ── 09 cheat sheet ── */}
          <Section>
            <AGSecHead n="09 / Reference" title="Cheat sheet" sub="Range 8 to 12, 3 sets, step 2.5 kg / 5 lbs. What you log, what comes out." />
            <div style={{ overflowX: 'auto', border: `0.5px solid ${UI.hair}`, borderRadius: 8 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460, fontSize: 13 }}>
                <thead><tr>{['What happens', 'Reps 1/2/3', 'Result', 'Next seed'].map(h => <th key={h} style={{ textAlign: 'left', padding: '10px 13px', borderBottom: `0.5px solid ${UI.hair}`, background: UI.bgInset, fontFamily: UI.fontNum, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: UI.inkFaint, fontWeight: 600 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {[
                    ['Fully earned', '12 / 10 / 8', ['bump +2.5, lights green', UI.ok], 'weight +2.5, reps → 8'],
                    ['Feedback blocks', '12 / 10 / 8', ['no bump (e.g. pump low)', UI.inkFaint], 'weight holds'],
                    ['One early miss', '7 / 10 / 8', ['miss streak = 1', UI.danger], 'weight holds, reps +1'],
                    ['Second miss in a row', '7 / 9 / 8', ['streak = 2 → cut -2.5', UI.danger], 'weight -2.5, reps → 8'],
                    ['Only the last set fails', '12 / 10 / 6', ['last set exempt, no bump', UI.inkFaint], 'weight + reps hold'],
                  ].map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: '10px 13px', borderBottom: `0.5px solid ${UI.hair}`, color: UI.inkSoft }}>{r[0]}</td>
                      <td style={{ padding: '10px 13px', borderBottom: `0.5px solid ${UI.hair}`, fontFamily: UI.fontNum, color: UI.ink, whiteSpace: 'nowrap' }}>{r[1]}</td>
                      <td style={{ padding: '10px 13px', borderBottom: `0.5px solid ${UI.hair}`, color: r[2][1], fontWeight: 600 }}>{r[2][0]}</td>
                      <td style={{ padding: '10px 13px', borderBottom: `0.5px solid ${UI.hair}`, fontFamily: UI.fontNum, color: UI.inkSoft, whiteSpace: 'nowrap' }}>{r[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 12, marginTop: 14 }}>
              <div style={cardStyle}><h3 className="display" style={h3}>Weight, one line</h3><p style={{ fontSize: 13.5, color: UI.inkSoft, margin: 0 }}>Feedback owns the direction. Cut wins. Red holds. Only all-green climbs. Step is one increment (2.5 kg / 5 lbs).</p></div>
              <div style={cardStyle}><h3 className="display" style={h3}>Volume, one line</h3><p style={{ fontSize: 13.5, color: UI.inkSoft, margin: 0 }}>{isB ? 'Frozen. Your set counts never change in Load only. The per-exercise weight-feel question only opens or holds the weight gate.' : isC ? 'Recovered or too little adds a set to the least-grown lift. Sore or too much cuts from the most-grown. Frozen in the final week.' : 'Recovered or too little adds a set to the least-grown lift. Sore or too much cuts from the most-grown. Never below 1, no cap.'}</p></div>
              <div style={cardStyle}><h3 className="display" style={h3}>Warnings, one line</h3><p style={{ fontSize: 13.5, color: UI.inkSoft, margin: 0 }}>Sharp joint pain sets a durable swap warning. Low pump 3 sessions running, or "not my lift" 2 sessions running, suggests swapping the exercise.</p></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 12, marginTop: 12 }}>
              <div style={cardStyle}><AGKick>Editing</AGKick><p style={{ fontSize: 13.5, color: UI.inkSoft, margin: '6px 0 0' }}>Any answer is editable until the session ends. Afterward, only your single most recent session of a plan can be corrected.</p></div>
              <div style={cardStyle}><AGKick>Edge cases</AGKick><p style={{ fontSize: 13.5, color: UI.inkSoft, margin: '6px 0 0' }}>Skipped sets count as neither hit nor miss. Unilateral uses the weaker side. Bodyweight is not halved in a deload.</p></div>
              <div style={cardStyle}><AGKick>Not this engine</AGKick><p style={{ fontSize: 13.5, color: UI.inkSoft, margin: '6px 0 0' }}>5/3/1 main lifts climb on their Training Max wave and have their own week 4 deload, separate from all of the above.</p></div>
            </div>
          </Section>

        </div>
      </div>

      <button onClick={scrollToTop} aria-label="Back to top" title="Back to top" style={{
        position: 'fixed', right: 16, bottom: 'calc(env(safe-area-inset-bottom, 10px) + 18px)', zIndex: 40,
        width: 44, height: 44, borderRadius: '50%', border: `0.5px solid ${UI.hairStrong}`,
        background: UI.bgRaised, color: UI.gold, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        boxShadow: '0 8px 22px -8px rgba(0,0,0,0.65)', display: 'grid', placeItems: 'center',
        opacity: showTop ? 1 : 0, transform: showTop ? 'translateY(0)' : 'translateY(8px)',
        pointerEvents: showTop ? 'auto' : 'none', transition: 'opacity .2s ease, transform .2s ease',
      }}>
        <i className="fa-solid fa-arrow-up" style={{ fontSize: 15 }} />
      </button>
    </Screen>
  );
}

Object.assign(window.Screens, { AutoregGuideScreen });
