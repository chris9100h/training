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

const TOUR_VISUALS = { days: TourVisualDays, exercises: TourVisualExercises, drag: TourVisualDrag };

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

    // Find target in DOM with retries (allows for screen transitions)
    setTargetRect(undefined);
    let attempts = 0;
    const tryFind = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { setTargetRect(r); return; }
      }
      attempts++;
      if (attempts < 30) { retryRef.current = setTimeout(tryFind, 80); }
      else { setTargetRect(null); } // graceful fallback
    };
    requestAnimationFrame(tryFind);

    return () => clearTimeout(retryRef.current);
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
