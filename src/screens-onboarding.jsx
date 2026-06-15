/* Onboarding — welcome prompt & guided spotlight tour */

const { useState: useStateOB, useEffect: useEffectOB, useRef: useRefOB } = React;

// ─── Tour data registry ──────────────────────────────────────────────
// Each step: { route?, target?, title, body, visual?, placement? }
// route    — navigate to this route before showing the step (optional)
// target   — data-tour="..." attribute on the DOM element to spotlight (optional)
// visual   — key into TOUR_VISUALS for an inline illustration (optional)
// placement— 'top' | 'bottom' | auto (default)
window.TOURS = {
  createPlan: [
    {
      target: null,
      title: 'Welcome to ZANE',
      body: "Let's take a quick look around — two minutes and you'll know how to build your first training plan.",
    },
    {
      route: 'home',
      target: 'tab-plan',
      title: 'The Plan tab',
      body: 'Your training hub. Plans, training days, exercises, and your exercise library — all in one place.',
      placement: 'top',
    },
    {
      route: 'plan',
      target: 'plan-new-btn',
      title: 'Create a plan',
      body: 'A plan is a collection of training days. Each day gets its own exercises. Tap + to get started.',
      placement: 'bottom',
    },
    {
      route: 'schedule-new',
      target: 'schedule-name',
      title: 'Name your plan',
      body: 'Something memorable — PUSH PULL LEGS, UPPER LOWER, or whatever fits your training style.',
      placement: 'bottom',
    },
    {
      route: 'schedule-new',
      target: 'schedule-mode',
      title: 'Cycle or Weekdays?',
      body: 'Cycle: rotate Day 1 → 2 → 3 → back to 1, regardless of calendar day.\nWeekdays: assign sessions to specific days like Mon, Wed, Fri.',
      placement: 'bottom',
    },
    {
      target: null,
      title: 'Add training days',
      body: 'After creating your plan, use "+ Day" to add training days. Name each one — PUSH, PULL, UPPER, or A / B / C.',
      visual: 'days',
    },
    {
      target: null,
      title: 'Fill each day with exercises',
      body: 'Tap a day to open it, then add exercises. Search your library, create a new one, or pick from recents. Set planned sets and reps for each.',
      visual: 'exercises',
    },
    {
      target: null,
      title: 'Drag to reorder',
      body: 'Long-press any day or exercise to drag it into a new position. Reorder your plan structure at any time.',
      visual: 'drag',
    },
    {
      route: 'home',
      target: 'tab-hist',
      title: 'Your training history',
      body: 'Every session is automatically logged here — sets, reps, volume, and personal records over time.',
      placement: 'top',
    },
    {
      target: null,
      title: "You're all set!",
      body: 'Head to the Plan tab and create your first training plan. You can always come back to this tour in Settings → How to…',
    },
  ],
};

window.TOURS.doWorkout = [
  {
    target: null,
    title: 'Workout Tour',
    body: "Let's walk through a complete training session — from the first warmup set to the well-done screen.",
  },
  {
    target: null,
    title: 'Warmup Sets',
    body: "When you start, a warmup modal slides up first. It shows each warmup set one at a time with the target weight and reps. Tap 'Check warmup set' to log it, or 'Skip' to jump straight to your working sets.",
    visual: 'trainWarmup',
  },
  {
    target: null,
    title: 'The Training Screen',
    body: 'After the warmup you land here. Exercise chips run across the top — tap any to jump to it. Below is the exercise card with your set rows: set number, last-time reference, weight, reps, done button, and a − to remove that set.',
    visual: 'trainOverview',
  },
  {
    target: null,
    title: 'Logging a Set',
    body: 'Tap a set row to activate it — the weight field gets a highlighted underline in your accent color. Enter weight, tap the reps field, enter reps. The keyboard auto-advances between fields and can confirm the set in one tap.',
    visual: 'trainLogSet',
  },
  {
    target: null,
    title: 'The Quick Keyboard',
    body: 'The custom numpad sits at the bottom. ↓ / ↑ step the weight up or down by your equipment increment. The dumbbell icon opens the plate calculator. The tall accent-colored button confirms the set.',
    visual: 'trainKeyboard',
  },
  {
    target: null,
    title: 'Plate Calculator',
    body: 'Opens from the dumbbell key on the keyboard. Shows which plates to load on each side of the bar as colored circles — calculated from your available equipment.',
    visual: 'trainPlates',
  },
  {
    target: null,
    title: 'Add & Remove Sets',
    body: 'The + button below the sets adds a new set (duplicating the last one). Each set row has a − button on the right — tap it to remove that set.',
    visual: 'trainSets',
  },
  {
    target: null,
    title: 'Exercise Notes',
    body: 'The Note button sits to the right of the + button, below the sets. Tap it to add a session note or a permanent exercise note — cues, tempo, substitutions. The note is shown every time you train that exercise.',
    visual: 'trainNotes',
  },
  {
    target: null,
    title: 'Navigate Exercises',
    body: 'The exercise chips at the top of the screen are your navigation. Tap any chip to jump to that exercise. Completed exercises show a small dot below their chip.',
    visual: 'trainNav',
  },
  {
    target: null,
    title: 'Skip Remaining Sets',
    body: "The footer bar at the bottom has a 'Skip remaining sets' button. Tap it to mark all incomplete sets of the current exercise as skipped and move on to the next.",
    visual: 'trainSkip',
  },
  {
    target: null,
    title: 'Finish Your Workout',
    body: "Once you reach the last exercise, a 'Finish →' button appears in the footer. Tap it to end the session — you'll see a summary of sets, volume, and duration.",
    visual: 'trainEnd',
  },
  {
    target: null,
    title: 'Rate Your Session',
    body: 'Pick how the workout felt — Easy to Max Effort. This data powers your training load overview and helps identify fatigue patterns over time.',
    visual: 'trainFeel',
  },
  {
    target: null,
    title: 'Workout Complete!',
    body: 'Your session is saved, PRs are flagged, and your progress is on record. Check the History tab any time to review past sessions.',
    visual: 'trainWellDone',
  },
];

// ─── Inline visual mockups ───────────────────────────────────────────
function TourVisualDays() {
  const rowStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 10px', background: UI.bgInset,
    border: `1px solid ${UI.hairStrong}`, borderRadius: 4,
  };
  const label = { fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, color: UI.inkSoft, letterSpacing: '0.06em' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {['PUSH', 'PULL', 'LEGS'].map(name => (
        <div key={name} style={rowStyle}>
          <span style={label}>{name}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={UI.inkFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 2px' }}>
        <span style={{ color: 'var(--accent)', fontSize: 18, lineHeight: 1, fontWeight: 300 }}>+</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.10em', fontWeight: 600 }}>ADD DAY</span>
      </div>
    </div>
  );
}

function TourVisualExercises() {
  const exercises = ['BENCH PRESS', 'INCLINE DUMBBELL', 'TRICEP PUSHDOWN'];
  return (
    <div style={{ background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ padding: '7px 10px', borderBottom: `1px solid ${UI.hairStrong}` }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 9, letterSpacing: '0.14em', color: UI.inkFaint }}>PUSH DAY</span>
      </div>
      {exercises.map((ex, i) => (
        <div key={ex} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: i < exercises.length - 1 ? `1px solid ${UI.hairStrong}` : 'none' }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft, fontWeight: 500 }}>{ex}</span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px' }}>
        <span style={{ color: 'var(--accent)', fontSize: 16, lineHeight: 1, fontWeight: 300 }}>+</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 10, color: 'var(--accent)', letterSpacing: '0.10em', fontWeight: 600 }}>ADD EXERCISE</span>
      </div>
    </div>
  );
}

function TourVisualDrag() {
  const exercises = ['BENCH PRESS', 'INCLINE DUMBBELL', 'TRICEP PUSHDOWN'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {exercises.map((ex, i) => (
        <div key={ex} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px',
          background: i === 1 ? 'rgba(var(--accent-rgb),0.08)' : UI.bgInset,
          border: `1px solid ${i === 1 ? 'rgba(var(--accent-rgb),0.3)' : UI.hairStrong}`,
          borderRadius: 4, opacity: i === 1 ? 0.6 : 1,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2.5, padding: '0 2px', cursor: 'grab' }}>
            {[0,1,2].map(j => <div key={j} style={{ width: 14, height: 1.5, background: UI.inkGhost, borderRadius: 1 }} />)}
          </div>
          <span style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft, fontWeight: 500 }}>{ex}</span>
          {i === 1 && <span style={{ marginLeft: 'auto', fontFamily: UI.fontUi, fontSize: 9, color: 'var(--accent)', letterSpacing: '0.08em' }}>DRAG</span>}
        </div>
      ))}
    </div>
  );
}

function TrainChips({ states }) {
  // states: 'active' | 'done' | 'pending'
  const labels = ['BENCH', 'INCLINE', 'TRICEP'];
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {labels.map((c, i) => {
        const st = states[i];
        return (
          <div key={c} style={{
            padding: '5px 11px 4px', borderRadius: 4,
            border: `1px solid ${st === 'active' ? 'var(--accent)' : st === 'done' ? UI.goldSoft : UI.hairStrong}`,
            background: st === 'active' ? `rgba(var(--accent-rgb),0.08)` : st === 'done' ? `rgba(var(--accent-rgb),0.05)` : 'transparent',
          }}>
            <div style={{ fontSize: 10, fontFamily: UI.fontUi, letterSpacing: '0.07em', color: st === 'active' ? 'var(--accent)' : st === 'done' ? UI.inkSoft : UI.inkFaint }}>{c}</div>
            <div style={{ height: 3, marginTop: 3, display: 'flex', justifyContent: 'center' }}>
              {st === 'done' && <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TourVisualTrainOverview() {
  const sets = [
    { label: '1', done: true },
    { label: '2', done: false, active: true },
    { label: '3', done: false },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <TrainChips states={['active', 'done', 'pending']} />
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        <div style={{ padding: '7px 10px', borderBottom: `0.5px solid ${UI.hair}`, display: 'flex', alignItems: 'center' }}>
          <span style={{ fontFamily: UI.fontDisplay, fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: UI.ink, textTransform: 'uppercase', flex: 1 }}>Bench Press</span>
          <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkGhost }}>3 × 8</span>
        </div>
        {sets.map((s, i) => (
          <div key={s.label} style={{
            display: 'grid', gridTemplateColumns: '22px 1fr auto 28px 22px', alignItems: 'center', gap: 6, padding: '6px 10px',
            background: s.active ? `rgba(var(--accent-rgb),0.07)` : s.done ? `rgba(var(--accent-rgb),0.04)` : 'transparent',
            borderBottom: i < sets.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
          }}>
            <div style={{ width: 20, height: 20, borderRadius: 3, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkGhost }}>{s.label}</div>
            <div className="num" style={{ fontSize: 12, color: s.active ? 'var(--accent)' : UI.ink }}>80 kg</div>
            <div className="num" style={{ fontSize: 12, color: s.active ? 'var(--accent)' : UI.inkSoft }}>8</div>
            <div style={{ width: 26, height: 26, borderRadius: 4, background: s.done ? 'var(--accent)' : s.active ? `rgba(var(--accent-rgb),0.12)` : UI.bgInset, border: `1.5px solid ${(s.done || s.active) ? 'var(--accent)' : UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: s.active ? `0 0 0 3px rgba(var(--accent-rgb),0.15)` : 'none' }}>
              {s.done && <i className="fa-solid fa-check" style={{ fontSize: 9, color: '#0a0805' }} />}
            </div>
            <div style={{ width: 20, height: 20, borderRadius: 3, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UI.inkFaint, fontSize: 14, lineHeight: 1 }}>−</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourVisualTrainWarmup() {
  return (
    <div style={{ background: UI.bgRaised, borderRadius: 8, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden', paddingBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 8 }}>
        <div style={{ width: 32, height: 3, borderRadius: 2, background: UI.inkGhost }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px 12px', gap: 8 }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--accent)' }}>WARMUP</span>
        <div style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)', opacity: 0.7 }} />
        <div style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 4, background: 'transparent', border: `0.5px solid ${UI.hairStrong}`, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.07em' }}>SKIP</div>
      </div>
      <div style={{ textAlign: 'center', padding: '0 16px 14px' }}>
        <div className="num" style={{ fontSize: 36, color: UI.ink, fontWeight: 300 }}>40 kg</div>
        <div className="num" style={{ fontSize: 15, color: UI.inkSoft, marginTop: 2 }}>× 10 reps</div>
      </div>
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ padding: '12px', borderRadius: 6, textAlign: 'center', background: 'linear-gradient(160deg, var(--accent-light), var(--accent))', color: '#0a0805', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>✓ CHECK WARMUP SET</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 24, height: 24, borderRadius: 12, background: i === 0 ? 'var(--accent)' : i === 1 ? `rgba(var(--accent-rgb),0.2)` : UI.bgInset, border: `1.5px solid ${i === 0 ? 'var(--accent)' : i === 1 ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {i === 0 && <i className="fa-solid fa-check" style={{ fontSize: 8, color: '#0a0805' }} />}
            </div>
            <span style={{ fontSize: 7, fontFamily: UI.fontUi, color: i === 0 ? 'var(--accent)' : UI.inkGhost, fontWeight: 700 }}>W{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourVisualTrainLogSet() {
  const sets = [
    { label: '1', done: true },
    { label: '2', done: false, active: true },
    { label: '3', done: false },
  ];
  return (
    <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
      <div style={{ padding: '7px 10px', borderBottom: `0.5px solid ${UI.hair}`, display: 'flex', alignItems: 'center' }}>
        <span style={{ fontFamily: UI.fontDisplay, fontSize: 13, fontWeight: 700, color: UI.ink, textTransform: 'uppercase', flex: 1 }}>Bench Press</span>
      </div>
      {sets.map((s, i) => (
        <div key={s.label} style={{
          display: 'grid', gridTemplateColumns: '22px 1fr auto 30px 22px', alignItems: 'center', gap: 6, padding: '7px 10px',
          background: s.active ? `rgba(var(--accent-rgb),0.08)` : s.done ? `rgba(var(--accent-rgb),0.04)` : 'transparent',
          borderBottom: i < sets.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
        }}>
          <div style={{ width: 20, height: 20, borderRadius: 3, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkGhost }}>{s.label}</div>
          <div className="num" style={{ fontSize: 13, color: s.active ? 'var(--accent)' : UI.ink }}>80.0</div>
          <div className="num" style={{ fontSize: 13, color: s.active ? 'var(--accent)' : UI.inkSoft }}>8</div>
          <div style={{ width: 28, height: 28, borderRadius: 4, background: s.done ? 'var(--accent)' : s.active ? `rgba(var(--accent-rgb),0.12)` : UI.bgInset, border: `1.5px solid ${(s.done || s.active) ? 'var(--accent)' : UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: s.active ? `0 0 0 3px rgba(var(--accent-rgb),0.15)` : 'none' }}>
            {s.done ? <i className="fa-solid fa-check" style={{ fontSize: 10, color: '#0a0805' }} /> : s.active ? <i className="fa-solid fa-check" style={{ fontSize: 10, color: 'var(--accent)' }} /> : null}
          </div>
          <div style={{ width: 20, height: 20, borderRadius: 3, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UI.inkFaint, fontSize: 14, lineHeight: 1 }}>−</div>
        </div>
      ))}
      <div style={{ padding: '5px 10px 7px', display: 'flex', alignItems: 'center', gap: 5 }}>
        <i className="fa-solid fa-arrow-up" style={{ fontSize: 9, color: UI.inkGhost }} />
        <span style={{ fontSize: 10, fontFamily: UI.fontUi, color: UI.inkGhost }}>Tap the ✓ on the active row to confirm the set</span>
      </div>
    </div>
  );
}

function TourVisualTrainKeyboard() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', gap: 5, marginBottom: 2 }}>
        {[['KG', '80.0', true], ['REPS', '8', false]].map(([lbl, val, active]) => (
          <div key={lbl} style={{
            flex: 1, textAlign: 'center', padding: '5px 4px',
            background: UI.bgCard, borderRadius: 4,
            border: `0.5px solid ${active ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`,
            borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
          }}>
            <div style={{ fontSize: 8, color: UI.inkGhost, fontFamily: UI.fontUi, marginBottom: 1, letterSpacing: '0.06em' }}>{lbl}</div>
            <div className="num" style={{ fontSize: 17, color: active ? 'var(--accent)' : UI.inkSoft }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 50px', gridTemplateRows: 'repeat(5, 32px)', gap: 3 }}>
        {['↓', null, '↑'].map((k, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 3, fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontNum }}>
            {k === null ? <i className="fa-solid fa-dumbbell" style={{ fontSize: 11, color: UI.inkSoft }} /> : k}
          </div>
        ))}
        {/* CONFIRM — tall accent button spanning rows 1–4, column 4 */}
        <div style={{ gridRow: '1 / 5', gridColumn: 4, background: 'var(--accent)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="fa-solid fa-check" style={{ fontSize: 15, color: '#0a0805' }} />
        </div>
        {/* Rows 2–4: 1 2 3 / 4 5 6 / 7 8 9 */}
        {['1','2','3','4','5','6','7','8','9'].map(n => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 3, fontFamily: UI.fontNum, fontSize: 14, color: UI.ink }}>{n}</div>
        ))}
        {/* Row 5: blank / 0 / ⌫ / ⌄ */}
        <div style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 3 }} />
        {['0','⌫','⌄'].map(k => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 3, fontFamily: UI.fontNum, fontSize: 13, color: k === '⌫' ? UI.inkSoft : UI.ink }}>{k}</div>
        ))}
      </div>
    </div>
  );
}

function TourVisualTrainPlates() {
  // Per side for 90 kg dual = 45 → 25×1 + 20×1 (greedy, like the real calc)
  const plates = [
    { kg: 25, n: 1, color: '#c0392b', size: 50 },
    { kg: 20, n: 1, color: '#2471a3', size: 46 },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 3, background: UI.bgInset, borderRadius: 4, padding: 3 }}>
        {['Dual side', 'Single'].map((t, i) => (
          <div key={t} style={{ flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 4, background: i === 0 ? 'var(--accent)' : 'transparent', color: i === 0 ? '#0a0805' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, fontWeight: i === 0 ? 600 : 400, letterSpacing: '0.06em' }}>{t}</div>
        ))}
      </div>
      <div style={{ textAlign: 'center', position: 'relative' }}>
        <span className="num" style={{ fontSize: 40, color: UI.ink, fontWeight: 300, letterSpacing: '-0.03em' }}>90</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, letterSpacing: '0.1em', marginLeft: 4 }}>{UI.unit().toUpperCase()}</span>
      </div>
      <div className="knurl" />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'center' }}>
        <span className="num" style={{ fontSize: 18, fontWeight: 300, color: 'var(--accent)' }}>45</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: UI.inkFaint, letterSpacing: '0.12em' }}>{UI.unit().toUpperCase()} PER SIDE</span>
      </div>
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center', alignItems: 'flex-end', paddingTop: 2 }}>
        {plates.map(p => {
          const hole = Math.round(p.size * 0.3);
          return (
            <div key={p.kg} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ width: p.size, height: p.size, borderRadius: '50%', background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 0 1.5px rgba(255,255,255,0.18)` }}>
                <div style={{ position: 'absolute', width: hole, height: hole, borderRadius: '50%', background: 'var(--bg)', boxShadow: '0 0 0 1.5px rgba(255,255,255,0.18)' }} />
              </div>
              <span className="num" style={{ fontSize: 11, color: UI.inkSoft }}>{p.kg} × {p.n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TourVisualTrainSets() {
  const sets = [
    { label: '1', done: true },
    { label: '2', done: true },
    { label: '3', done: false },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        {sets.map((s, i) => (
          <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto 28px 22px', alignItems: 'center', gap: 6, padding: '6px 10px', background: s.done ? `rgba(var(--accent-rgb),0.04)` : 'transparent', borderBottom: i < sets.length - 1 ? `0.5px solid ${UI.hair}` : 'none' }}>
            <div style={{ width: 20, height: 20, borderRadius: 3, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkGhost }}>{s.label}</div>
            <div className="num" style={{ fontSize: 12, color: UI.ink }}>80 kg</div>
            <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>8</div>
            <div style={{ width: 26, height: 26, borderRadius: 4, background: s.done ? 'var(--accent)' : UI.bgInset, border: `1px solid ${s.done ? 'var(--accent)' : UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {s.done && <i className="fa-solid fa-check" style={{ fontSize: 9, color: '#0a0805' }} />}
            </div>
            <div style={{ width: 20, height: 20, borderRadius: 3, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UI.inkFaint, fontSize: 14, lineHeight: 1 }}>−</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 0', borderRadius: 4, background: 'transparent', border: `0.5px dashed ${UI.hairStrong}`, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>
          <i className="fa-solid fa-plus" style={{ fontSize: 9 }} /> ADD SET
        </div>
        <div style={{ padding: '8px 12px', borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', gap: 5, color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>
          <i className="fa-solid fa-note-sticky" style={{ fontSize: 9 }} /> NOTE
        </div>
      </div>
    </div>
  );
}

function TourVisualTrainNotes() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        {[1, 2].map((n, i) => (
          <div key={n} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto 28px 22px', alignItems: 'center', gap: 6, padding: '6px 10px', background: `rgba(var(--accent-rgb),0.04)`, borderBottom: i === 0 ? `0.5px solid ${UI.hair}` : 'none' }}>
            <div style={{ width: 20, height: 20, borderRadius: 3, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkGhost }}>{n}</div>
            <div className="num" style={{ fontSize: 12, color: UI.ink }}>80 kg</div>
            <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>8</div>
            <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--accent)', border: `1px solid var(--accent)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fa-solid fa-check" style={{ fontSize: 9, color: '#0a0805' }} />
            </div>
            <div style={{ width: 20, height: 20, borderRadius: 3, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UI.inkFaint, fontSize: 14, lineHeight: 1 }}>−</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 0', borderRadius: 4, background: 'transparent', border: `0.5px dashed ${UI.hairStrong}`, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>
          <i className="fa-solid fa-plus" style={{ fontSize: 9 }} /> ADD SET
        </div>
        <div style={{ padding: '8px 12px', borderRadius: 4, background: `rgba(var(--accent-rgb),0.12)`, border: `1px solid rgba(var(--accent-rgb),0.4)`, boxShadow: `0 0 0 3px rgba(var(--accent-rgb),0.1)`, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>
          <i className="fa-solid fa-note-sticky" style={{ fontSize: 9 }} /> NOTE
        </div>
      </div>
      <div style={{ padding: '10px 12px', background: `rgba(var(--accent-rgb),0.06)`, borderRadius: 6, border: `0.5px solid rgba(var(--accent-rgb),0.2)` }}>
        <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: 'var(--accent)', marginBottom: 5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Note</div>
        <div style={{ fontSize: 12, fontFamily: UI.fontUi, color: UI.inkSoft, lineHeight: 1.5 }}>Elbows at 45° — pause 1s at chest</div>
      </div>
    </div>
  );
}

function TourVisualTrainNav() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <TrainChips states={['done', 'active', 'pending']} />
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '8px 10px', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontFamily: UI.fontDisplay, fontSize: 13, fontWeight: 700, color: UI.ink, textTransform: 'uppercase', flex: 1 }}>Incline DB</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: UI.inkGhost }}>0 / 3 done</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="fa-solid fa-circle-info" style={{ fontSize: 10, color: UI.inkGhost }} />
        <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>Tap a chip to jump to that exercise; done ones show a dot below the name</span>
      </div>
    </div>
  );
}

function TourVisualTrainSkip() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '9px 10px' }}>
        <span style={{ fontFamily: UI.fontDisplay, fontSize: 13, fontWeight: 700, color: UI.ink, textTransform: 'uppercase' }}>Leg Press</span>
        <div className="num" style={{ fontSize: 11, color: UI.inkFaint, marginTop: 2 }}>0 / 3 sets done</div>
      </div>
      <div style={{ background: UI.bgRaised, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '9px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}` }}>
          <i className="fa-solid fa-list" style={{ fontSize: 9, color: UI.inkFaint }} />
          <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: UI.inkFaint, fontWeight: 700, letterSpacing: '0.07em' }}>EXERCISES</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 4, background: `rgba(var(--accent-rgb),0.1)`, border: `0.5px solid rgba(var(--accent-rgb),0.3)`, boxShadow: `0 0 0 3px rgba(var(--accent-rgb),0.08)` }}>
          <i className="fa-solid fa-forward-step" style={{ fontSize: 9, color: 'var(--accent)' }} />
          <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.07em' }}>SKIP REMAINING</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="fa-solid fa-circle-info" style={{ fontSize: 10, color: UI.inkGhost }} />
        <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>Marks unchecked sets as skipped and moves to the next exercise</span>
      </div>
    </div>
  );
}

function TourVisualTrainEnd() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '9px 10px' }}>
        <span style={{ fontFamily: UI.fontDisplay, fontSize: 13, fontWeight: 700, color: UI.ink, textTransform: 'uppercase' }}>Tricep Dip</span>
        <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: 'var(--accent)', marginTop: 2, letterSpacing: '0.06em' }}>Last exercise</div>
      </div>
      <div style={{ background: UI.bgRaised, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '9px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}` }}>
          <i className="fa-solid fa-list" style={{ fontSize: 9, color: UI.inkFaint }} />
          <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: UI.inkFaint, fontWeight: 700, letterSpacing: '0.07em' }}>EXERCISES</span>
        </div>
        <div className="num" style={{ flex: 1, fontSize: 12, color: UI.inkGhost, textAlign: 'center' }}>44:22</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 4, background: 'linear-gradient(160deg, var(--accent-light), var(--accent))', boxShadow: `0 4px 14px rgba(var(--accent-rgb),0.4)` }}>
          <span style={{ fontFamily: UI.fontUi, fontSize: 10, color: '#0a0805', fontWeight: 700, letterSpacing: '0.07em' }}>FINISH →</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="fa-solid fa-circle-info" style={{ fontSize: 10, color: UI.inkGhost }} />
        <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>Also auto-finishes when every set is checked off</span>
      </div>
    </div>
  );
}

function TourVisualTrainFeel() {
  const opts = [
    { key: 'easy', label: 'Easy', icon: 'fa-face-smile' },
    { key: 'good', label: 'Good', icon: 'fa-bolt' },
    { key: 'hard', label: 'Hard', icon: 'fa-fire' },
    { key: 'very_hard', label: 'Very Hard', icon: 'fa-skull' },
    { key: 'max', label: 'Max', icon: 'fa-trophy' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ textAlign: 'center', fontFamily: UI.fontUi, fontSize: 12, color: UI.inkSoft }}>How did it feel?</div>
      <div style={{ display: 'flex', gap: 5 }}>
        {opts.map((o, i) => (
          <div key={o.key} style={{
            flex: 1, padding: '8px 2px', borderRadius: 6, textAlign: 'center',
            background: i === 1 ? 'var(--accent)' : UI.bgInset,
            border: `0.5px solid ${i === 1 ? 'var(--accent)' : UI.hairStrong}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
          }}>
            <i className={`fa-solid ${o.icon}`} style={{ fontSize: 13, color: i === 1 ? '#0a0805' : UI.inkFaint }} />
            <span style={{ fontSize: 7, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.04em', color: i === 1 ? '#0a0805' : UI.inkFaint, lineHeight: 1.2 }}>{o.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourVisualTrainWellDone() {
  return (
    <div style={{
      padding: '14px 12px', background: `rgba(var(--accent-rgb),0.06)`,
      border: `0.5px solid rgba(var(--accent-rgb),0.2)`,
      borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    }}>
      <i className="fa-solid fa-trophy" style={{ fontSize: 28, color: 'var(--accent)' }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 20, color: UI.ink, fontWeight: 700, letterSpacing: '0.04em' }}>PUSH DAY</div>
        <div style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, marginTop: 2 }}>Mon, 15 Jun · 44 min</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, width: '100%' }}>
        {[['SETS', '18'], ['VOLUME', '6.2k'], ['PRs', '2']].map(([lbl, val]) => (
          <div key={lbl} style={{ textAlign: 'center', padding: '8px 4px', background: UI.bgCard, borderRadius: 4 }}>
            <div className="num" style={{ fontSize: 17, color: 'var(--accent)', fontWeight: 300 }}>{val}</div>
            <div style={{ fontSize: 8, fontFamily: UI.fontUi, color: UI.inkGhost, letterSpacing: '0.08em', marginTop: 2 }}>{lbl}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="fa-solid fa-star" style={{ fontSize: 10, color: 'var(--accent)' }} />
        <span style={{ fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>2 new personal records</span>
      </div>
    </div>
  );
}

const TOUR_VISUALS = {
  days: TourVisualDays, exercises: TourVisualExercises, drag: TourVisualDrag,
  trainOverview: TourVisualTrainOverview, trainWarmup: TourVisualTrainWarmup,
  trainLogSet: TourVisualTrainLogSet, trainKeyboard: TourVisualTrainKeyboard,
  trainPlates: TourVisualTrainPlates, trainSets: TourVisualTrainSets,
  trainNotes: TourVisualTrainNotes, trainNav: TourVisualTrainNav,
  trainSkip: TourVisualTrainSkip, trainEnd: TourVisualTrainEnd,
  trainFeel: TourVisualTrainFeel, trainWellDone: TourVisualTrainWellDone,
};

// ─── OnboardingPrompt ────────────────────────────────────────────────
function OnboardingPrompt({ onStart, onSkip }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(0,0,0,0.72)',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{
        width: '100%', maxWidth: 320,
        background: UI.bgRaised,
        border: `1px solid ${UI.goldSoft}`,
        borderRadius: 6,
        padding: '32px 28px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 12, textAlign: 'center',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(201,169,97,0.2)',
        animation: 'fadeUp 0.3s ease',
      }}>
        <div style={{ width: 80, height: 80, marginBottom: 4, animation: 'logoPulse 2.4s ease-in-out infinite' }}>
          <img src="icons/zane-logo.png" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 28, color: UI.ink, fontWeight: 400, lineHeight: 1.1 }}>
          Welcome to ZANE
        </div>
        <div style={{ fontSize: 13.5, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.55 }}>
          Would you like a quick tour of the app?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 6 }}>
          <button onClick={onStart} style={{
            width: '100%', padding: '14px 0', borderRadius: 6,
            border: 'none', cursor: 'pointer',
            background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
            boxShadow: '0 8px 24px rgba(var(--accent-rgb),0.4)',
            color: '#0a0805', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 700,
            letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent',
          }}>
            SHOW ME AROUND
          </button>
          <button onClick={onSkip} style={{
            width: '100%', padding: '12px 0', borderRadius: 6,
            border: `1px solid ${UI.hairStrong}`, cursor: 'pointer',
            background: 'transparent',
            color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 500,
            WebkitTapHighlightColor: 'transparent',
          }}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── OnboardingTour ──────────────────────────────────────────────────
function OnboardingTour({ tourKey, go, route, onDone }) {
  const steps = (window.TOURS || {})[tourKey] || [];
  const [stepIdx, setStepIdx] = useStateOB(0);
  // undefined = searching, null = no target (centered modal), DOMRect = found
  const [targetRect, setTargetRect] = useStateOB(undefined);
  const retryRef = useRefOB(null);

  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;

  useEffectOB(() => {
    clearTimeout(retryRef.current);
    if (!step) return;

    // Navigate if needed — wait for next effect run with updated route
    if (step.route && route.name !== step.route) {
      go({ name: step.route });
      setTargetRect(undefined);
      return;
    }

    // No spotlight target → centered modal
    if (!step.target) {
      setTargetRect(null);
      return;
    }

    // Find target in DOM with retries (allows for screen transitions).
    // `cancelled` + `cancelAnimationFrame` prevent a stale rAF callback from
    // firing after this effect re-runs (e.g. when the user advances to the next
    // step), which would overwrite the fresh targetRect with the old element's
    // rect and lock the tour in spotlight mode with no working buttons.
    setTargetRect(undefined);
    let cancelled = false;
    let rafId = null;
    let attempts = 0;
    const tryFind = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { setTargetRect(r); return; }
      }
      attempts++;
      if (attempts < 30) { retryRef.current = setTimeout(tryFind, 80); }
      else { setTargetRect(null); }
    };
    rafId = requestAnimationFrame(tryFind);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      clearTimeout(retryRef.current);
    };
  }, [stepIdx, route.name]);

  const advance = () => {
    if (isLast) { onDone(); } else { setStepIdx(i => i + 1); }
  };
  const goBack = () => { if (stepIdx > 0) setStepIdx(i => i - 1); };

  if (!step) return null;

  // Shared button row. IMPORTANT: this is a render *helper* called as a plain
  // function — never render it as <BtnRow/>. A component defined inside render
  // gets a new identity every render, so React would unmount/remount the button
  // subtree on each parent re-render (store sync, sync-status, realtime, …). A
  // tap whose pointerdown→click straddles such a remount is silently dropped —
  // that was the "visible buttons don't respond, must kill the app" bug.
  const renderBtnRow = (compact) => (
    <div style={{ display: 'flex', gap: 8, marginTop: compact ? 0 : 4 }}>
      {stepIdx > 0 && (
        <button onClick={goBack} style={{
          flex: '0 0 auto', padding: compact ? '9px 13px' : '11px 15px', borderRadius: compact ? 4 : 6,
          border: `1px solid ${UI.hairStrong}`, cursor: 'pointer',
          background: 'transparent',
          color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: compact ? 12 : 14, fontWeight: 600,
          WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
        }} aria-label="Back">←</button>
      )}
      <button onClick={onDone} style={{
        flex: 1, padding: compact ? '9px 0' : '11px 0', borderRadius: compact ? 4 : 6,
        border: `1px solid ${UI.hairStrong}`, cursor: 'pointer',
        background: 'transparent',
        color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: compact ? 10 : 11, fontWeight: 600,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
      }}>Skip</button>
      <button onClick={advance} style={{
        flex: 2, padding: compact ? '9px 0' : '11px 0', borderRadius: compact ? 4 : 6,
        border: 'none', cursor: 'pointer',
        background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
        boxShadow: `0 ${compact ? 4 : 6}px ${compact ? 14 : 20}px rgba(var(--accent-rgb),0.4)`,
        color: '#0a0805', fontFamily: UI.fontUi, fontSize: compact ? 11 : 13, fontWeight: 700,
        letterSpacing: '0.08em', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
      }}>{isLast ? 'DONE' : 'NEXT →'}</button>
    </div>
  );

  const VisualComp = step.visual ? TOUR_VISUALS[step.visual] : null;

  // ── Centered modal (no target / fallback) ──
  // Structure is intentionally identical to WhatsNewModal (a modal that works
  // reliably in this app): a backdrop directly on the outer element, ONE
  // scrolling card, buttons inside that card, plain onClick. The outer element
  // is a tap-to-dismiss escape hatch; the card stops propagation so taps inside
  // it never dismiss. No nested scroll regions / compositing layers / pointer
  // hacks — those were what broke the buttons.
  if (!step.target || targetRect === null) {
    return (
      <div onClick={onDone} style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.82)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, overflowY: 'auto',
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: '100%', maxWidth: 340, maxHeight: '88vh', overflowY: 'auto',
          background: UI.bgRaised,
          border: `1px solid ${UI.goldSoft}`,
          borderRadius: 6,
          padding: '24px 22px',
          display: 'flex', flexDirection: 'column', gap: 12,
          boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          animation: 'fadeUp 0.25s ease',
        }}>
          <div className="micro-gold">{stepIdx + 1} / {steps.length}</div>
          <div style={{ fontFamily: UI.fontDisplay, fontSize: 26, color: UI.ink, fontWeight: 400, lineHeight: 1.1 }}>
            {step.title}
          </div>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
            {step.body}
          </div>
          {VisualComp && (
            <div style={{ marginTop: 2 }}>
              <VisualComp />
            </div>
          )}
          {renderBtnRow(false)}
        </div>
      </div>
    );
  }

  // ── Brief loading state while navigating / searching ──
  // Tap-to-dismiss so a search that never resolves can't trap the user.
  if (targetRect === undefined) {
    return (
      <div onClick={onDone} style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.35)',
      }} />
    );
  }

  // ── Spotlight mode ──
  const PAD = 10;
  const sx = Math.round(targetRect.left - PAD);
  const sy = Math.round(targetRect.top - PAD);
  const sw = Math.round(targetRect.width + PAD * 2);
  const sh = Math.round(targetRect.height + PAD * 2);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const TW = Math.min(300, vw - 32);
  const TOOLTIP_H = 178;
  const TIP_GAP = 14;

  // Tooltip X: center over spotlight, clamped to viewport
  // Exception: if spotlight is on the far left (sidebar), place tooltip to the right
  const nearLeft = sx + sw < vw * 0.3;
  let tipX, tipY;

  if (nearLeft) {
    tipX = Math.min(sx + sw + TIP_GAP, vw - TW - 8);
    tipY = Math.max(8, Math.min(sy + sh / 2 - TOOLTIP_H / 2, vh - TOOLTIP_H - 16));
  } else {
    tipX = Math.max(16, Math.min(sx + sw / 2 - TW / 2, vw - TW - 16));
    const canBelow = sy + sh + TIP_GAP + TOOLTIP_H < vh - 16;
    const forceTop = step.placement === 'top' || (!canBelow && sy > TOOLTIP_H + TIP_GAP + 8);
    if (forceTop) {
      tipY = Math.max(8, sy - TIP_GAP - TOOLTIP_H);
    } else {
      tipY = sy + sh + TIP_GAP;
      if (tipY + TOOLTIP_H > vh - 8) tipY = Math.max(8, vh - TOOLTIP_H - 8);
    }
  }

  return (
    <>
      {/* Tap the dimmed background to dismiss — guaranteed escape on every step */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 9995, pointerEvents: 'auto' }} onClick={onDone} />

      {/* Dark overlay via box-shadow (spotlight "hole") */}
      <div style={{
        position: 'fixed',
        left: sx, top: sy, width: sw, height: sh,
        borderRadius: 8,
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.78)',
        zIndex: 9996,
        pointerEvents: 'none',
      }} />

      {/* Pulsing accent ring */}
      <div style={{
        position: 'fixed',
        left: sx, top: sy, width: sw, height: sh,
        borderRadius: 8,
        border: '2px solid var(--accent)',
        animation: 'tourRingPulse 1.8s ease-in-out infinite',
        zIndex: 9997,
        pointerEvents: 'none',
      }} />

      {/* Tooltip card */}
      <div style={{
        position: 'fixed',
        left: tipX, top: tipY, width: TW,
        background: UI.bgRaised,
        border: `1px solid ${UI.goldSoft}`,
        borderRadius: 6,
        padding: '16px 18px',
        display: 'flex', flexDirection: 'column', gap: 10,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(201,169,97,0.15)',
        zIndex: 9998,
        animation: 'fadeUp 0.2s ease',
      }}>
        <div className="micro-gold">{stepIdx + 1} / {steps.length}</div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 400, lineHeight: 1.1 }}>
          {step.title}
        </div>
        <div style={{ fontSize: 12.5, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.55, whiteSpace: 'pre-line' }}>
          {step.body}
        </div>
        {renderBtnRow(true)}
      </div>
    </>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { OnboardingPrompt, OnboardingTour });
