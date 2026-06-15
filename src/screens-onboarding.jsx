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
    title: 'The Training Screen',
    body: 'Each exercise shows as a card with set rows. Done sets are highlighted, open sets wait for input. A progress bar tracks completed work sets.',
    visual: 'trainOverview',
  },
  {
    target: null,
    title: 'Warmup Sets',
    body: "Warmup rows are marked with 'W'. They are logged and tracked, but don't count toward your session progress bar or volume stats.",
    visual: 'trainWarmup',
  },
  {
    target: null,
    title: 'Logging a Set',
    body: 'Tap a set row to open the inline inputs. Adjust weight and reps, then tap the checkmark to mark the set done. Completed sets glow.',
    visual: 'trainLogSet',
  },
  {
    target: null,
    title: 'The Quick Keyboard',
    body: 'The custom numpad dials in weight and reps fast. Tap between the KG and REPS fields, long-press +/− to step by small increments.',
    visual: 'trainKeyboard',
  },
  {
    target: null,
    title: 'Plate Calculator',
    body: 'Tap the scale icon in the numpad to see exactly which plates to load on the bar — calculated from your available equipment.',
    visual: 'trainPlates',
  },
  {
    target: null,
    title: 'Add & Remove Sets',
    body: "Tap '+ ADD SET' below the last row to add a set. Swipe any set row left to reveal the delete button and remove it.",
    visual: 'trainSets',
  },
  {
    target: null,
    title: 'Exercise Notes',
    body: 'Tap the note icon in the exercise header to attach a note — tempo cues, substitutions, range of motion reminders. Shown every time you do that exercise.',
    visual: 'trainNotes',
  },
  {
    target: null,
    title: 'Navigate Exercises',
    body: 'Use the exercise tabs at the bottom to jump directly to any exercise. Swipe left or right to step through them in order.',
    visual: 'trainNav',
  },
  {
    target: null,
    title: 'Skip an Exercise',
    body: "Can't do an exercise today? Tap SKIP to log it as skipped and move on. You can optionally leave a reason for your coach or future self.",
    visual: 'trainSkip',
  },
  {
    target: null,
    title: 'End Your Workout',
    body: "When you're done, tap END in the top bar. A summary appears showing sets done, total volume, and session time.",
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

function TourVisualTrainOverview() {
  const sets = [
    { label: 'W', kg: '60', reps: '10', done: true, warmup: true },
    { label: '1', kg: '80', reps: '8', done: true, warmup: false },
    { label: '2', kg: '80', reps: '8', done: false, warmup: false },
    { label: '3', kg: '80', reps: '8', done: false, warmup: false },
  ];
  return (
    <div style={{ background: UI.bgCard, borderRadius: 8, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
      <div style={{ padding: '9px 12px', borderBottom: `0.5px solid ${UI.hair}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: UI.fontDisplay, fontSize: 15, fontWeight: 700, letterSpacing: '0.04em', color: UI.ink, textTransform: 'uppercase', flex: 1 }}>Bench Press</span>
        <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkGhost, letterSpacing: '0.06em' }}>3 × 8</span>
      </div>
      {sets.map((s, i) => (
        <div key={s.label} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
          background: s.done && !s.warmup ? `rgba(var(--accent-rgb),0.06)` : s.warmup ? `rgba(var(--accent-rgb),0.03)` : 'transparent',
          borderBottom: i < sets.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: 4, flexShrink: 0,
            background: s.warmup ? `rgba(var(--accent-rgb),0.12)` : UI.bgInset,
            border: `0.5px solid ${s.warmup ? 'rgba(var(--accent-rgb),0.3)' : UI.hairStrong}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700,
            color: s.warmup ? 'var(--accent)' : UI.inkGhost,
          }}>{s.label}</div>
          <div className="num" style={{ flex: 1, fontSize: 13, color: UI.ink }}>{s.kg} kg</div>
          <div className="num" style={{ fontSize: 13, color: UI.ink, marginRight: 4 }}>{s.reps} reps</div>
          <div style={{
            width: 30, height: 30, borderRadius: 6, flexShrink: 0,
            background: s.done ? 'var(--accent)' : UI.bgInset,
            border: `1px solid ${s.done ? 'var(--accent)' : UI.hairStrong}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {s.done && <i className="fa-solid fa-check" style={{ fontSize: 11, color: '#0a0805' }} />}
          </div>
        </div>
      ))}
    </div>
  );
}

function TourVisualTrainWarmup() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {[['W1', '50', '10'], ['W2', '65', '6']].map(([label, kg, reps]) => (
        <div key={label} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          background: `rgba(var(--accent-rgb),0.06)`,
          border: `0.5px solid rgba(var(--accent-rgb),0.2)`, borderRadius: 6,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 4,
            background: `rgba(var(--accent-rgb),0.15)`,
            border: `0.5px solid rgba(var(--accent-rgb),0.35)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, color: 'var(--accent)',
          }}>{label}</div>
          <span className="num" style={{ flex: 1, fontSize: 13, color: UI.inkSoft }}>{kg} kg</span>
          <span className="num" style={{ fontSize: 13, color: UI.inkSoft, marginRight: 4 }}>{reps} reps</span>
          <div style={{
            width: 30, height: 30, borderRadius: 6,
            background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className="fa-solid fa-check" style={{ fontSize: 11, color: '#0a0805' }} />
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 2px' }}>
        <i className="fa-solid fa-circle-info" style={{ fontSize: 10, color: UI.inkGhost }} />
        <span style={{ fontSize: 11, color: UI.inkGhost, fontFamily: UI.fontUi }}>Warmup sets don't count toward progress or volume</span>
      </div>
    </div>
  );
}

function TourVisualTrainLogSet() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
        background: `rgba(var(--accent-rgb),0.08)`,
        border: `1.5px solid rgba(var(--accent-rgb),0.5)`, borderRadius: 6,
        boxShadow: `0 0 0 3px rgba(var(--accent-rgb),0.1)`,
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 4, background: UI.bgInset,
          border: `0.5px solid ${UI.hairStrong}`, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkGhost,
        }}>2</div>
        <div className="num" style={{ flex: 1, fontSize: 16, color: 'var(--accent)' }}>80.0</div>
        <div className="num" style={{ fontSize: 16, color: 'var(--accent)', marginRight: 6 }}>8</div>
        <div style={{
          width: 32, height: 32, borderRadius: 6, background: UI.bgInset,
          border: `1px solid ${UI.hairStrong}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <i className="fa-solid fa-check" style={{ fontSize: 12, color: UI.inkGhost }} />
        </div>
      </div>
      <div style={{ textAlign: 'center', color: UI.inkGhost }}>
        <i className="fa-solid fa-arrow-down" style={{ fontSize: 11 }} />
        <span style={{ fontSize: 10, fontFamily: UI.fontUi, marginLeft: 5 }}>tap to confirm</span>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '8px 10px', background: UI.bgInset, borderRadius: 6, border: `0.5px solid ${UI.hair}` }}>
        {[['KG', '80.0', true], ['REPS', '8', false]].map(([lbl, val, active]) => (
          <div key={lbl} style={{
            flex: 1, textAlign: 'center', padding: '6px 4px',
            background: UI.bgCard, borderRadius: 4,
            border: `${active ? '1.5px' : '0.5px'} solid ${active ? 'var(--accent)' : UI.hairStrong}`,
          }}>
            <div style={{ fontSize: 8, color: UI.inkGhost, fontFamily: UI.fontUi, marginBottom: 2, letterSpacing: '0.06em' }}>{lbl}</div>
            <div className="num" style={{ fontSize: 17, color: active ? 'var(--accent)' : UI.ink }}>{val}</div>
          </div>
        ))}
        <div style={{
          width: 42, borderRadius: 4, background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <i className="fa-solid fa-check" style={{ fontSize: 13, color: '#0a0805' }} />
        </div>
      </div>
    </div>
  );
}

function TourVisualTrainKeyboard() {
  const numBtns = ['7','8','9','4','5','6','1','2','3'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
        {[['KG', '80.0', true], ['REPS', '8', false]].map(([lbl, val, active]) => (
          <div key={lbl} style={{
            flex: 1, textAlign: 'center', padding: '6px 4px',
            background: UI.bgCard, borderRadius: 4,
            border: `${active ? '1.5px' : '0.5px'} solid ${active ? 'var(--accent)' : UI.hairStrong}`,
          }}>
            <div style={{ fontSize: 8, color: UI.inkGhost, fontFamily: UI.fontUi, marginBottom: 1, letterSpacing: '0.06em' }}>{lbl}</div>
            <div className="num" style={{ fontSize: 18, color: active ? 'var(--accent)' : UI.ink }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {numBtns.map(n => (
          <div key={n} style={{
            padding: '9px 0', borderRadius: 4, textAlign: 'center',
            background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`,
            fontFamily: UI.fontNum, fontSize: 15, color: UI.ink,
          }}>{n}</div>
        ))}
        <div style={{
          padding: '9px 0', borderRadius: 4, textAlign: 'center',
          background: `rgba(var(--accent-rgb),0.1)`, border: `0.5px solid rgba(var(--accent-rgb),0.25)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <i className="fa-solid fa-scale-balanced" style={{ fontSize: 11, color: 'var(--accent)' }} />
        </div>
        <div style={{
          padding: '9px 0', borderRadius: 4, textAlign: 'center',
          background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`,
          fontFamily: UI.fontNum, fontSize: 15, color: UI.ink,
        }}>0</div>
        <div style={{
          padding: '9px 0', borderRadius: 4, textAlign: 'center',
          background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`,
          fontFamily: UI.fontNum, fontSize: 15, color: UI.inkSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>⌫</div>
      </div>
    </div>
  );
}

function TourVisualTrainPlates() {
  const plates = [
    { kg: 20, color: '#2060b0' },
    { kg: 10, color: '#b03030' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
        <span style={{ fontSize: 11, fontFamily: UI.fontUi, color: UI.inkFaint }}>Total weight</span>
        <span className="num" style={{ fontSize: 20, color: 'var(--accent)' }}>80 kg</span>
        <span style={{ fontSize: 11, fontFamily: UI.fontUi, color: UI.inkFaint }}>30 kg / side</span>
      </div>
      <div style={{ position: 'relative', height: 52, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 8, background: UI.inkGhost, borderRadius: 4 }} />
        <div style={{ position: 'absolute', left: '12%', display: 'flex', alignItems: 'center', flexDirection: 'row-reverse' }}>
          {plates.map((p, i) => (
            <div key={i} style={{ width: 10, height: p.kg === 20 ? 42 : 32, background: p.color, borderRadius: 3, marginLeft: 2, opacity: 0.85 }} />
          ))}
        </div>
        <div style={{ position: 'absolute', right: '12%', display: 'flex', alignItems: 'center' }}>
          {plates.map((p, i) => (
            <div key={i} style={{ width: 10, height: p.kg === 20 ? 42 : 32, background: p.color, borderRadius: 3, marginRight: 2, opacity: 0.85 }} />
          ))}
        </div>
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: 22, height: 16, background: UI.bgCard, border: `1px solid ${UI.hairStrong}`, borderRadius: 3, zIndex: 1 }} />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        {plates.map(p => (
          <div key={p.kg} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: p.color, opacity: 0.85 }} />
            <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{p.kg} kg × 2</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourVisualTrainSets() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {['1','2'].map(n => (
        <div key={n} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
          background: UI.bgInset, borderRadius: 4, border: `0.5px solid ${UI.hairStrong}`,
        }}>
          <div style={{
            width: 22, height: 22, borderRadius: 4, background: UI.bgCard,
            border: `0.5px solid ${UI.hairStrong}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkGhost,
          }}>{n}</div>
          <span className="num" style={{ flex: 1, fontSize: 13, color: UI.inkSoft }}>80 kg · 8 reps</span>
        </div>
      ))}
      <div style={{
        position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
        background: UI.bgInset, borderRadius: 4, border: `0.5px solid ${UI.hairStrong}`,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: 4, background: UI.bgCard,
          border: `0.5px solid ${UI.hairStrong}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkGhost,
        }}>3</div>
        <span className="num" style={{ flex: 1, fontSize: 13, color: UI.inkSoft }}>80 kg · 8 reps</span>
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 52,
          background: '#c03030', borderRadius: '0 4px 4px 0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <i className="fa-solid fa-trash" style={{ fontSize: 11, color: '#fff' }} />
        </div>
      </div>
      <button style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '8px 0', borderRadius: 4,
        background: 'transparent', border: `0.5px dashed ${UI.hairStrong}`,
        cursor: 'default', color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      }}>
        <i className="fa-solid fa-plus" style={{ fontSize: 9 }} /> ADD SET
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="fa-solid fa-circle-info" style={{ fontSize: 10, color: UI.inkGhost }} />
        <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>Swipe a row left to delete it</span>
      </div>
    </div>
  );
}

function TourVisualTrainNotes() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`,
      }}>
        <span style={{ fontFamily: UI.fontDisplay, fontSize: 15, fontWeight: 700, color: UI.ink, flex: 1, textTransform: 'uppercase' }}>Bench Press</span>
        <div style={{
          width: 30, height: 30, borderRadius: 4,
          background: `rgba(var(--accent-rgb),0.12)`,
          border: `1px solid rgba(var(--accent-rgb),0.35)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 0 3px rgba(var(--accent-rgb),0.12)`,
        }}>
          <i className="fa-solid fa-note-sticky" style={{ fontSize: 11, color: 'var(--accent)' }} />
        </div>
      </div>
      <div style={{
        padding: '10px 12px', background: UI.bgInset, borderRadius: 6,
        border: `0.5px solid ${UI.hairStrong}`,
      }}>
        <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkGhost, marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Note</div>
        <div style={{ fontSize: 13, fontFamily: UI.fontUi, color: UI.inkSoft, lineHeight: 1.5 }}>
          Elbows at 45° — pause 1s at chest
        </div>
      </div>
    </div>
  );
}

function TourVisualTrainNav() {
  const exs = ['BENCH PRESS', 'INCLINE DB', 'TRICEP DIP'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint }}>Exercise</span>
        <span className="num" style={{ fontSize: 13, color: 'var(--accent)' }}>2</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint }}>of {exs.length}</span>
        <div style={{ flex: 1, height: 3, background: UI.bgInset, borderRadius: 2, marginLeft: 4, overflow: 'hidden' }}>
          <div style={{ width: '66%', height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
        </div>
      </div>
      <div style={{
        display: 'flex', background: UI.bgInset, borderRadius: 6,
        border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden',
      }}>
        {exs.map((ex, i) => (
          <div key={ex} style={{
            flex: 1, padding: '8px 2px', textAlign: 'center',
            background: i === 1 ? 'var(--accent)' : 'transparent',
            color: i === 1 ? '#0a0805' : UI.inkFaint,
            fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700, letterSpacing: '0.05em',
            borderRight: i < exs.length - 1 ? `0.5px solid ${UI.hairStrong}` : 'none',
            lineHeight: 1.3,
          }}>{ex}</div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="fa-solid fa-circle-info" style={{ fontSize: 10, color: UI.inkGhost }} />
        <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>Swipe left / right to step through exercises</span>
      </div>
    </div>
  );
}

function TourVisualTrainSkip() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`,
      }}>
        <span style={{ fontFamily: UI.fontDisplay, fontSize: 15, fontWeight: 700, color: UI.ink, flex: 1, textTransform: 'uppercase' }}>Leg Press</span>
        <button style={{
          padding: '5px 11px', borderRadius: 4, border: `0.5px solid rgba(var(--accent-rgb),0.3)`,
          background: `rgba(var(--accent-rgb),0.08)`, cursor: 'default',
          color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          boxShadow: `0 0 0 3px rgba(var(--accent-rgb),0.1)`,
        }}>SKIP</button>
      </div>
      <div style={{
        padding: '10px 12px', background: UI.bgInset, borderRadius: 6,
        border: `0.5px solid ${UI.hairStrong}`,
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        <i className="fa-solid fa-forward-step" style={{ fontSize: 13, color: UI.inkFaint, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 12, fontFamily: UI.fontUi, color: UI.inkSoft, fontWeight: 500, marginBottom: 3 }}>Skip exercise</div>
          <div style={{ fontSize: 11, fontFamily: UI.fontUi, color: UI.inkFaint, lineHeight: 1.4 }}>
            Logged as skipped — you can leave an optional reason before moving to the next exercise.
          </div>
        </div>
      </div>
    </div>
  );
}

function TourVisualTrainEnd() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', padding: '10px 12px',
        background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`,
      }}>
        <span style={{ flex: 1, fontFamily: UI.fontDisplay, fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', color: UI.ink }}>TRAINING</span>
        <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkFaint, marginRight: 10 }}>42:18</span>
        <button style={{
          padding: '6px 12px', borderRadius: 4, border: 'none', cursor: 'default',
          background: 'linear-gradient(160deg, var(--accent-light), var(--accent))',
          color: '#0a0805', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          boxShadow: `0 0 0 3px rgba(var(--accent-rgb),0.25)`,
        }}>END</button>
      </div>
      <div style={{
        padding: '10px 12px', background: UI.bgInset, borderRadius: 6,
        border: `0.5px solid ${UI.hairStrong}`,
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
      }}>
        {[['SETS', '18'], ['VOLUME', '6.2k'], ['TIME', '42m']].map(([lbl, val]) => (
          <div key={lbl} style={{ textAlign: 'center' }}>
            <div className="num" style={{ fontSize: 18, color: UI.ink, fontWeight: 300 }}>{val}</div>
            <div style={{ fontSize: 8, fontFamily: UI.fontUi, color: UI.inkGhost, letterSpacing: '0.08em', marginTop: 2 }}>{lbl}</div>
          </div>
        ))}
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

  if (!step) return null;

  // Shared button row
  const BtnRow = ({ compact }) => (
    <div style={{ display: 'flex', gap: 8, marginTop: compact ? 0 : 4 }}>
      <button onClick={onDone} style={{
        flex: 1, padding: compact ? '9px 0' : '11px 0', borderRadius: compact ? 4 : 6,
        border: `1px solid ${UI.hairStrong}`, cursor: 'pointer',
        background: 'transparent',
        color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: compact ? 10 : 11, fontWeight: 600,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        WebkitTapHighlightColor: 'transparent',
      }}>Skip</button>
      <button onClick={advance} style={{
        flex: 2, padding: compact ? '9px 0' : '11px 0', borderRadius: compact ? 4 : 6,
        border: 'none', cursor: 'pointer',
        background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
        boxShadow: `0 ${compact ? 4 : 6}px ${compact ? 14 : 20}px rgba(var(--accent-rgb),0.4)`,
        color: '#0a0805', fontFamily: UI.fontUi, fontSize: compact ? 11 : 13, fontWeight: 700,
        letterSpacing: '0.08em', WebkitTapHighlightColor: 'transparent',
      }}>{isLast ? 'DONE' : 'NEXT →'}</button>
    </div>
  );

  const VisualComp = step.visual ? TOUR_VISUALS[step.visual] : null;

  // ── Centered modal (no target / fallback) ──
  if (targetRect === null) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(0,0,0,0.82)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, overflowY: 'auto',
      }}>
        <div style={{
          width: '100%', maxWidth: 340,
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
          <BtnRow compact={false} />
        </div>
      </div>
    );
  }

  // ── Brief loading state while navigating / searching ──
  if (targetRect === undefined) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9994,
        background: 'rgba(0,0,0,0.35)',
        pointerEvents: 'none',
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
      {/* Intercept all background clicks */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 9995, pointerEvents: 'auto' }} onClick={e => e.stopPropagation()} />

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
        <BtnRow compact={true} />
      </div>
    </>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { OnboardingPrompt, OnboardingTour });
