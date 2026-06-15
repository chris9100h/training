/* Onboarding — welcome prompt & guided spotlight tour */

const { useState: useStateOB, useEffect: useEffectOB, useRef: useRefOB } = React;

// ─── Tour data registry ──────────────────────────────────────────────
// Each step: { route?, target?, title, body, placement? }
// route    — navigate to this route before showing the step (optional)
// target   — data-tour="..." attribute on the DOM element to spotlight (optional)
// placement— 'top' | 'bottom' | auto (default)
window.TOURS = {
  createPlan: [
    {
      target: null,
      title: 'Welcome to ZANE',
      body: "Let's take a quick look around — this takes less than a minute.",
    },
    {
      route: 'home',
      target: 'tab-plan',
      title: 'Your Training Plan',
      body: 'The Plan tab is where you build your training schedule and manage your exercises.',
      placement: 'top',
    },
    {
      route: 'plan',
      target: 'plan-new-btn',
      title: 'Create your first plan',
      body: 'Define which days you train and which exercises you do each session.',
      placement: 'bottom',
    },
    {
      target: 'tab-hist',
      title: 'Training History',
      body: 'Every session is automatically logged here — sets, reps, volume and PRs over time.',
      placement: 'top',
    },
    {
      target: null,
      title: "You're all set!",
      body: 'Start by creating your first training plan. You can always revisit this tour in Settings → How to…',
    },
  ],
};

// ─── OnboardingPrompt ────────────────────────────────────────────────
function OnboardingPrompt({ onStart, onSkip }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9997,
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
      if (attempts < 25) { retryRef.current = setTimeout(tryFind, 80); }
      else { setTargetRect(null); } // graceful fallback
    };
    requestAnimationFrame(tryFind);

    return () => clearTimeout(retryRef.current);
  }, [stepIdx, route.name]);

  const advance = () => {
    if (isLast) { onDone(); } else { setStepIdx(i => i + 1); }
  };

  if (!step) return null;

  // ── Centered modal (no target / fallback) ──
  if (targetRect === null) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9993,
        background: 'rgba(0,0,0,0.80)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 32,
      }}>
        <div style={{
          width: '100%', maxWidth: 320,
          background: UI.bgRaised,
          border: `1px solid ${UI.goldSoft}`,
          borderRadius: 6,
          padding: '28px 24px',
          display: 'flex', flexDirection: 'column', gap: 14,
          boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          animation: 'fadeUp 0.25s ease',
        }}>
          <div className="micro-gold">{stepIdx + 1} / {steps.length}</div>
          <div style={{ fontFamily: UI.fontDisplay, fontSize: 28, color: UI.ink, fontWeight: 400, lineHeight: 1.1 }}>
            {step.title}
          </div>
          <div style={{ fontSize: 13.5, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.55 }}>
            {step.body}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={onDone} style={{
              flex: 1, padding: '11px 0', borderRadius: 6,
              border: `1px solid ${UI.hairStrong}`, cursor: 'pointer',
              background: 'transparent',
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              WebkitTapHighlightColor: 'transparent',
            }}>Skip</button>
            <button onClick={advance} style={{
              flex: 2, padding: '11px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
              boxShadow: '0 6px 20px rgba(var(--accent-rgb),0.4)',
              color: '#0a0805', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 700,
              letterSpacing: '0.08em', WebkitTapHighlightColor: 'transparent',
            }}>{isLast ? 'DONE' : 'NEXT →'}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Brief loading state while navigating / searching ──
  if (targetRect === undefined) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9989,
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
    // Sidebar mode: tooltip to the right of the spotlight
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
      {/* Intercept background clicks */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 9989 }} onClick={e => e.stopPropagation()} />

      {/* Dark overlay via box-shadow (spotlight "hole") */}
      <div style={{
        position: 'fixed',
        left: sx, top: sy, width: sw, height: sh,
        borderRadius: 8,
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.78)',
        zIndex: 9990,
        pointerEvents: 'none',
      }} />

      {/* Pulsing accent ring */}
      <div style={{
        position: 'fixed',
        left: sx, top: sy, width: sw, height: sh,
        borderRadius: 8,
        border: '2px solid var(--accent)',
        animation: 'tourRingPulse 1.8s ease-in-out infinite',
        zIndex: 9991,
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
        zIndex: 9992,
        animation: 'fadeUp 0.2s ease',
      }}>
        <div className="micro-gold">{stepIdx + 1} / {steps.length}</div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 400, lineHeight: 1.1 }}>
          {step.title}
        </div>
        <div style={{ fontSize: 12.5, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.55 }}>
          {step.body}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onDone} style={{
            flex: 1, padding: '9px 0', borderRadius: 4,
            border: `1px solid ${UI.hairStrong}`, cursor: 'pointer',
            background: 'transparent',
            color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600,
            letterSpacing: '0.10em', textTransform: 'uppercase',
            WebkitTapHighlightColor: 'transparent',
          }}>Skip</button>
          <button onClick={advance} style={{
            flex: 2, padding: '9px 0', borderRadius: 4, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
            boxShadow: '0 4px 14px rgba(var(--accent-rgb),0.4)',
            color: '#0a0805', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700,
            letterSpacing: '0.10em', WebkitTapHighlightColor: 'transparent',
          }}>{isLast ? 'DONE' : 'NEXT →'}</button>
        </div>
      </div>
    </>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { OnboardingPrompt, OnboardingTour });
