/* Bodybuilding redesign, Golden Era aesthetic.
   Exposes: UI, Screen, TopBar, TabBar, Btn, Card, Label, Stepper, Pill,
   Sheet, Empty, ChevronRight, ICON_HISTORY, ICON_BARBELL, ICON_CALENDAR,
   btnPrimary/Ghost, useConfirm, MUSCLES, WEEKDAYS, WEEKDAYS_FULL,
   Hairline, BracketFrame, Frame, SubDial, Bezel, ScreenHead,
   NumInput, Field, TextInput, isLightCanvasActive. */

const UI = {
  bg:       'var(--bg)',
  bgRaised: 'var(--bg-raised)',
  bgInset:  'var(--bg-inset)',
  // Aliases for the raised card surface, kept so existing UI.bgCard /
  // UI.bgElevated call sites resolve to a real value instead of `undefined`
  // (which rendered a transparent background).
  bgCard:     'var(--bg-raised)',
  bgElevated: 'var(--bg-raised)',
  ink:      'var(--ink)',
  inkSoft:  'var(--ink-soft)',
  inkFaint: 'var(--ink-faint)',
  inkGhost: 'var(--ink-ghost)',
  inkLine:  'var(--hair)',
  hair:     'var(--hair)',
  hairStrong: 'var(--hair-strong)',
  gold:      'var(--accent)',
  goldLight: 'var(--accent-light)',
  goldDeep:  'var(--accent-deep)',
  goldSoft:  'var(--accent-soft)',
  goldFaint: 'var(--accent-faint)',
  danger:    'var(--danger)',
  ok:        'var(--ok)',
  warn:      'var(--warn)',
  info:      'var(--info)',
  fontUi:      '"Inter", system-ui, sans-serif',
  fontNum:     '"JetBrains Mono", ui-monospace, monospace',
  fontDisplay: '"Big Shoulders Display", "Arial Narrow", sans-serif',
};

// Generic light-canvas detector (works for 'light', 'paper', or any future
// light theme): perceived luminance of the live --bg-rgb, no theme-name
// checks to keep in sync. This lives in the critical UI module because lazy
// screens use it before the library module has necessarily loaded.
function isLightCanvasActive() {
  const parts = (getComputedStyle(document.documentElement).getPropertyValue('--bg-rgb') || '').trim().split(',').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  return (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) > 140;
}

// ─── Screen ─────────────────────────────────────────────────────────
function Screen({ children, scroll = true, style = {} }) {
  return (
    <div style={{
      width: '100%', flex: 1, minHeight: 0,
      backgroundColor: UI.bg, backgroundImage: 'var(--bg-texture)', color: UI.ink, fontFamily: UI.fontUi,
      display: 'flex', flexDirection: 'column',
      overflow: scroll ? 'auto' : 'hidden',
      // Inherits to every descendant (text-shadow is an inherited CSS
      // property) except where a surface with its own background, like Card,
      // Sheet, or a solid-fill Btn, resets it back to 'none'. 'none' outside
      // paper, so this is a no-op everywhere else.
      textShadow: 'var(--text-lift)',
      ...style,
    }}>{children}</div>
  );
}

// Long-press (500ms) on a screen title jumps home, a fast way out of deep
// screens (Settings sub-views, Coaching, History, ...) without repeated
// back-taps. window.__goHome is wired once in app.jsx's root component so
// this shared component doesn't need `go` threaded through every screen.
// Cancels if the finger moves (scroll) or lifts early.
function useLongPressHome() {
  const [pressing, setPressing] = React.useState(false);
  const timerRef = React.useRef(null);
  const startPos = React.useRef(null);
  const clear = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setPressing(false);
  };
  const onPointerDown = (e) => {
    if (!window.__goHome) return;
    startPos.current = { x: e.clientX, y: e.clientY };
    clear();
    setPressing(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setPressing(false);
      window.__goHome?.();
    }, 500);
  };
  const onPointerMove = (e) => {
    if (!timerRef.current || !startPos.current) return;
    if (Math.hypot(e.clientX - startPos.current.x, e.clientY - startPos.current.y) > 10) clear();
  };
  return { pressing, handlers: { onPointerDown, onPointerMove, onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear } };
}

// ─── TopBar ─────────────────────────────────────────────────────────
function TopBar({ title, sub, onBack, right }) {
  const { pressing, handlers } = useLongPressHome();
  return (
    <div style={{
      flexShrink: 0,
      // Keep header content inside the system safe area. Extra top padding and
      // backdrop blur can make the iOS status-bar readout appear blurry.
      padding: 'env(safe-area-inset-top, 0px) 22px 0',
      position: 'sticky', top: 0,
      background: 'rgba(var(--bg-rgb),0.97)',
      zIndex: 5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 12 }}>
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back" style={{
            width: 32, height: 32, borderRadius: 4,
            border: `1px solid ${UI.hairStrong}`, background: 'transparent',
            color: UI.gold, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1 1 7l6 6"/></svg>
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {sub && (
            <div className="micro" style={{ marginBottom: 2 }}>{typeof sub === 'string' ? sub.toUpperCase() : sub}</div>
          )}
          <div {...handlers} style={{
            fontFamily: UI.fontDisplay, fontSize: 30, fontWeight: 700,
            color: UI.ink, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            opacity: pressing ? 0.5 : 1, transition: 'opacity 0.15s',
            WebkitTapHighlightColor: 'transparent', userSelect: 'none', touchAction: 'manipulation',
          }}>{title}</div>
        </div>
        {right}
      </div>
      <div className="knurl" style={{ marginLeft: -22, marginRight: -22 }} />
    </div>
  );
}

// ─── SubTabBar, segmented control for in-screen sub-navigation ───────
// Used e.g. to switch Plan ⇄ Library inside the merged "Plan" tab.
function SubTabBar({ tabs, active, onChange, style = {} }) {
  return (
    <div style={{ flexShrink: 0, display: 'flex', gap: 4, padding: '10px 22px 2px', ...style }}>
      {tabs.map(t => {
        const on = t.id === active;
        return (
          <button key={t.id} onClick={() => !on && onChange(t.id)} aria-current={on ? 'page' : undefined} style={{
            flex: 1, padding: '9px 8px', borderRadius: 6, cursor: on ? 'default' : 'pointer',
            background: on ? UI.goldFaint : 'transparent',
            border: `1px solid ${on ? UI.goldSoft : UI.hairStrong}`,
            color: on ? UI.gold : UI.inkSoft,
            fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            WebkitTapHighlightColor: 'transparent', transition: 'background 0.15s, color 0.15s, border-color 0.15s',
          }}>
            {t.icon && <i className={`fa-solid ${t.icon}`} style={{ fontSize: 12 }} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── TabBar, floating dock with position indicator ──────────────────
const TAB_ICONS = {
  coaching: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      <path d="M17 11l1.5 1.5L21 10"/>
    </svg>
  ),
  home: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>
    </svg>
  ),
  plan: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <path d="M3 10h18M8 2v4M16 2v4"/>
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>
    </svg>
  ),
  lib: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14H4z"/>
      <path d="M4 19h16M8 8h8M8 12h5"/>
    </svg>
  ),
  hist: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2.5"/>
    </svg>
  ),
  health: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h3l2-5 3 10 2.5-7L18 12h3"/>
    </svg>
  ),
  water: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c3.5 4.2 6 8.1 6 11a6 6 0 1 1-12 0c0-2.9 2.5-6.8 6-11z"/>
    </svg>
  ),
  food: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 2v6M9 2v6M7 8a2 2 0 0 0 2 2v12"/>
      <path d="M15 2c0 3-1 5-1 5a2 2 0 0 0 2 2v13"/>
    </svg>
  ),
  medications: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="9" width="16" height="6" rx="3" transform="rotate(45 12 12)"/>
      <line x1="12" y1="9" x2="12" y2="15" transform="rotate(45 12 12)"/>
    </svg>
  ),
};

// Fixed display order for the shared Health/Water/Food/Medications tab
// slot. Each of the four is independently toggleable in Settings, so the
// set of enabled ones can be any subset of this order, never a fixed count.
const HEALTH_SLOT_ORDER = ['health', 'water', 'food', 'medications'];
function TabBar({ active, routeName, onChange, sidebar = false, showCoaching = false, coachingBadge = null, showHealth = false, showWater = false, showFood = false, showMeds = false }) {
  const slotOn = { health: showHealth, water: showWater, food: showFood, medications: showMeds };
  const enabledSlots = HEALTH_SLOT_ORDER.filter(id => slotOn[id]);
  const tabs = [
    { id: 'home', label: 'Train' },
    { id: 'plan', label: 'Plan' },
    { id: 'hist', label: 'History' },
    ...(enabledSlots.length ? [{ id: 'health', label: 'Health' }] : []),
    ...(showCoaching ? [{ id: 'coaching', label: 'Coaching' }] : []),
  ].map(t => {
    const healthSlot = t.id === 'health' ? (enabledSlots.includes(routeName) ? routeName : enabledSlots[0]) : null;
    const slotLabel = { health: 'Health', water: 'Water', food: 'Food', medications: 'Meds' }[healthSlot] || t.label;
    return { ...t, healthSlot, iconKey: healthSlot || t.id, label: slotLabel };
  });
  const [visualActive, setVisualActive] = React.useState(active);
  React.useEffect(() => setVisualActive(active), [active]);
  const routeForTab = id => {
    if (id === 'health' && enabledSlots.length) {
      const curIdx = enabledSlots.indexOf(routeName);
      return enabledSlots[(curIdx + 1) % enabledSlots.length];
    }
    return id;
  };
  const moduleForRoute = { plan: 'schedule', hist: 'lib', health: 'health', water: 'water', food: 'food', medications: 'medications', coaching: 'coaching' };
  const prefetchTab = id => {
    const moduleName = moduleForRoute[routeForTab(id)];
    if (moduleName) window.__prefetchScreen?.(moduleName);
  };
  const navigateTab = id => {
    const nextRoute = routeForTab(id);
    setVisualActive(id);
    const result = onChange(nextRoute);
    if (result?.then) result.then(ok => {
      if (ok === false) setVisualActive(current => current === id ? active : current);
    });
  };
  const idx = tabs.findIndex(t => t.id === visualActive);
  // Health, its water tracker, food tracker and medications tracker share one
  // tab slot (routeName being any of the four still lights up 'health', see
  // tabActive in app.jsx), each independently shown or hidden in Settings.
  // Tapping the slot steps forward through whichever of the four are
  // currently enabled, in HEALTH_SLOT_ORDER, wrapping back to the first once
  // it reaches the end; landing on the first enabled one if routeName isn't
  // one of them at all (e.g. arriving from Home, or the current one having
  // just been disabled). All four enabled reproduces the original fixed
  // Health → Water → Food → Medications cycle unchanged.
  const handleTabClick = (id) => navigateTab(id);
  // Three-dot "there's more here" indicator, shown under the Health slot's
  // label at all times (not just once you've found water/food): a lit dot
  // for the side you're currently viewing, a faint ring for the other two,
  // matching how a pagination dot row reads elsewhere. This sits below the
  // gold key plate (which only spans the icon), on the same plain bar
  // background the label itself sits on, so it takes the label's own on/off
  // contrast (gold and glowing when this tab is the active one, muted
  // otherwise) rather than the icon's dark-on-gold-plate treatment. Every tab
  // reserves the same slot height (see the height:4 placeholder at both call
  // sites) so only Health's growing dots never shifts the bar's height.
  const healthDots = (on, healthSlot, slots) => {
    const lit = on ? UI.gold : UI.inkFaint;
    const dim = on ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong;
    const glow = on ? '0 0 4px rgba(var(--accent-rgb),0.7)' : 'none';
    const dotStyle = filled => ({ width: 3, height: 3, borderRadius: '50%', boxSizing: 'border-box', background: filled ? lit : 'transparent', border: filled ? 'none' : `1px solid ${dim}`, boxShadow: filled ? glow : 'none' });
    return (
      <div style={{ display: 'flex', gap: 3 }}>
        {slots.map(id => <span key={id} style={dotStyle(healthSlot === id)} />)}
      </div>
    );
  };

  // Long-press on the Health slot (whichever of Health/Water/Food it's
  // currently showing, from any tab) reveals the two OTHER slots just above
  // the dock; drag onto one while still holding and release there to jump
  // straight to it. A plain short tap is untouched, still runs the cycle
  // above via handleTabClick. Bottom-dock only, the sidebar has no reach
  // problem to solve and keeps the plain click-cycle.
  const [reveal, setReveal] = React.useState(null); // { anchorX, bottom, hoverId } | null
  const barRef = React.useRef(null);
  const pressTimerRef = React.useRef(null);
  const pressStartRef = React.useRef(null);
  const suppressClickRef = React.useRef(false);
  const activeListenersRef = React.useRef(null);
  const healthIdx = tabs.findIndex(t => t.id === 'health');
  const currentHealthSlot = tabs.find(t => t.id === 'health')?.healthSlot || 'health';
  const cancelPressTimer = () => { if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; } };
  const resolveHealthOption = (x, y) => document.elementFromPoint(x, y)?.closest?.('[data-health-option]')?.getAttribute('data-health-option') || null;
  React.useEffect(() => () => {
    cancelPressTimer();
    if (activeListenersRef.current) {
      document.removeEventListener('pointermove', activeListenersRef.current.onMove);
      document.removeEventListener('pointerup', activeListenersRef.current.onUp);
      document.removeEventListener('pointercancel', activeListenersRef.current.onUp);
      activeListenersRef.current = null;
    }
  }, []);
  const healthOnPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (enabledSlots.length <= 1) return; // nothing else to reveal
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    const buttonEl = e.currentTarget;
    cancelPressTimer();
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      const r = barRef.current?.getBoundingClientRect();
      if (!r) return;
      suppressClickRef.current = true;
      // Clamped so the two-or-three-chip popup (roughly 180-300px wide) can't clip off
      // a narrow phone's edge when Health sits in an outer tab slot.
      const rawX = r.left + (healthIdx + 0.5) * r.width / tabs.length;
      const anchorX = Math.min(Math.max(rawX, 110), window.innerWidth - 110);
      setReveal({ anchorX, bottom: window.innerHeight - r.top + 8, hoverId: null });
      const onMove = (ev) => setReveal(rv => rv && { ...rv, hoverId: resolveHealthOption(ev.clientX, ev.clientY) });
      const onUp = (ev) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        activeListenersRef.current = null;
        setReveal(null);
        const pick = resolveHealthOption(ev.clientX, ev.clientY);
        if (pick) {
          navigateTab(pick);
          // Release landed on a popup chip, a sibling of this button, so no
          // native click will ever follow to consume suppressClickRef itself
          // (a click only fires when press and release resolve to the same
          // element): clear it now, or the next ordinary tap on this button
          // would be silently swallowed by healthOnClick below.
          suppressClickRef.current = false;
        } else if (!buttonEl.contains(document.elementFromPoint(ev.clientX, ev.clientY))) {
          // Released somewhere that is neither a popup chip nor the button
          // itself (e.g. the backdrop): same reasoning, no trailing click is
          // coming to reset the flag, so reset it here instead of leaving it
          // stuck for whatever ordinary tap happens to land next.
          suppressClickRef.current = false;
        }
      };
      activeListenersRef.current = { onMove, onUp };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    }, 200);
  };
  const healthOnPointerMove = (e) => {
    if (!pressTimerRef.current || !pressStartRef.current) return;
    if (Math.hypot(e.clientX - pressStartRef.current.x, e.clientY - pressStartRef.current.y) > 10) cancelPressTimer();
  };
  const healthOnPointerUp = cancelPressTimer;
  const healthOnClick = (id) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    handleTabClick(id);
  };

  if (sidebar) {
    return (
      <div style={{
          width: 220,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: `1px solid ${UI.goldSoft}`,
          background: UI.bg,
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 28px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          zIndex: 10,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '0 22px 6px', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <img src="icons/zane-logo.png" style={{ width: 180, height: 180, objectFit: 'contain', opacity: 0.9 }} />
          </div>
          <div className="knurl" style={{ margin: '0 14px 8px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', padding: '0 12px', flex: 1, justifyContent: 'space-evenly' }}>
            {tabs.map(t => {
              const on = t.id === visualActive;
              const badge = t.id === 'coaching' ? coachingBadge : null;
              const { healthSlot, iconKey, label } = t;
              return (
                <button key={t.id} data-tour={`tab-${t.id}`} onClick={() => handleTabClick(t.id)} onPointerDown={() => prefetchTab(t.id)} onPointerEnter={e => { if (e.pointerType === 'mouse') prefetchTab(t.id); }} aria-current={on ? 'page' : undefined} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '22px 16px',
                  borderRadius: 6,
                  background: on
                    ? `rgba(var(--accent-rgb),0.22)`
                    : 'var(--surface-tint-sm)',
                  // Full-strength accent border (not the 30%-alpha goldSoft) so
                  // the active tab still reads as more prominent than an
                  // inactive one on paper, where --accent is a mid-dark grey
                  // rather than a vivid color and would otherwise lose to
                  // hairStrong/inkSoft's own darkness.
                  border: `1px solid ${on ? UI.gold : UI.hairStrong}`,
                  color: on ? UI.gold : UI.inkSoft,
                  fontFamily: UI.fontDisplay,
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                  WebkitTapHighlightColor: 'transparent',
                }}>
                  <div style={{ position: 'relative', transform: 'scale(1.4)', display: 'inline-flex', margin: '0 0 2px' }}>
                    {TAB_ICONS[iconKey]}
                    {badge?.live && (
                      <div style={{ position: 'absolute', top: -2, right: -2, width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'pulseDot 1.5s ease-in-out infinite', border: '1.5px solid var(--bg)' }} />
                    )}
                    {!badge?.live && badge?.count > 0 && (
                      <div style={{ position: 'absolute', top: -4, right: -6, minWidth: 14, height: 14, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid var(--bg)' }}>
                        <span style={{ fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, color: 'var(--accent-ink)', lineHeight: 1 }}>{badge.count > 9 ? '9+' : badge.count}</span>
                      </div>
                    )}
                  </div>
                  <span>{label}</span>
                  <div style={{ height: 4, display: 'flex', alignItems: 'center' }}>{t.id === 'health' && healthDots(on, healthSlot, enabledSlots)}</div>
                </button>
              );
            })}
          </div>
        </div>
    );
  }

  // ── Bottom dock, "gold key" active indicator ──────────────────────
  // A floating industrial bar: the active tab reads like a pressed mechanical
  // key, a solid gold plate that slides under the active icon (dark glyph on
  // gold), topped by a thin gold rail. Inactive tabs are faint icon+label.
  const n = tabs.length;
  // Geometry. The gold plate is absolutely positioned (its size doesn't affect
  // the label), while the in-flow ICON_H is kept tight so the label sits right
  // under the glyph. PLATE/PAD_TOP/ICON_H are tuned so the plate stays centred
  // on the glyph and its bottom edge meets (never overlaps) the label.
  const KEY = 36;        // gold plate width/height (square, radius-6 key)
  const KEY_TOP = 6;     // plate offset from the row top
  const PAD_TOP = 5;     // button top padding
  const ICON_H = 26;     // icon-zone height, drives the icon→label gap
  const ICON_SZ = 24;    // glyph size in the bottom dock (sidebar untouched)
  return (
    <>
    <div style={{
      flexShrink: 0,
      padding: `10px 12px calc(env(safe-area-inset-bottom, 8px) + 10px)`,
      background: 'transparent',
      zIndex: 20,
    }}>
      <div ref={barRef} style={{
        position: 'relative',
        background: 'rgba(var(--bg-rgb),0.97)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: `1px solid ${UI.hairStrong}`,
        borderRadius: 8,
        padding: '7px 6px 4px',
        boxShadow: '0 10px 24px rgba(0,0,0,0.5)',
      }}>
        {/* knurled top edge, grip texture, signature of the kit */}
        <div className="knurl" style={{ position: 'absolute', top: 7, left: 14, right: 14 }} />
        <div style={{ display: 'flex', position: 'relative', paddingTop: 6 }}>
          {/* Sliding gold key plate behind the active icon */}
          {idx >= 0 && (
            <div style={{
              position: 'absolute', left: 0,
              top: KEY_TOP,
              width: `${100 / n}%`, height: KEY,
              transform: `translate3d(${idx * 100}%, 0, 0)`,
              transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              willChange: 'transform', pointerEvents: 'none',
              zIndex: 0,
            }}>
              <div style={{
                width: KEY, height: KEY, margin: '0 auto', borderRadius: 6,
                background: 'linear-gradient(180deg, var(--accent-light), var(--accent))',
                border: '1px solid var(--accent-deep)',
                // Neutral white highlight, not tinted warm-cream: that read as a
                // yellow smudge once paper mutes --accent to grey. White reads
                // as a plausible glossy sheen on every accent color, muted or not.
                boxShadow: '0 5px 16px rgba(var(--accent-rgb),0.35), inset 0 1px 0 rgba(255,255,255,0.45)',
              }} />
            </div>
          )}
          {/* Top rail above the active plate, mechanical selector cue */}
          {idx >= 0 && (
            <div style={{
              position: 'absolute', left: 0,
              top: KEY_TOP - 5,
              width: `${100 / n}%`, height: 2,
              transform: `translate3d(${idx * 100}%, 0, 0)`,
              transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              willChange: 'transform', pointerEvents: 'none',
              zIndex: 2,
            }}>
              <div style={{ width: 28, height: 2, margin: '0 auto', borderRadius: 4, background: UI.gold }} />
            </div>
          )}
          {tabs.map(t => {
            const on = t.id === visualActive;
            const badge = t.id === 'coaching' ? coachingBadge : null;
            const { healthSlot, iconKey, label } = t;
            const isHealthTab = t.id === 'health';
            return (
              <button key={t.id} data-tour={`tab-${t.id}`}
                onClick={() => isHealthTab ? healthOnClick(t.id) : handleTabClick(t.id)}
                aria-current={on ? 'page' : undefined}
                onPointerDown={e => { prefetchTab(t.id); if (isHealthTab) healthOnPointerDown(e); }}
                onPointerEnter={e => { if (e.pointerType === 'mouse') prefetchTab(t.id); }}
                onPointerMove={isHealthTab ? healthOnPointerMove : undefined}
                onPointerUp={isHealthTab ? healthOnPointerUp : undefined}
                onPointerCancel={isHealthTab ? healthOnPointerUp : undefined}
                onContextMenu={isHealthTab ? (e) => e.preventDefault() : undefined}
                style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer',
                padding: `${PAD_TOP}px 4px 2px`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                color: on ? UI.gold : UI.inkFaint,
                fontFamily: UI.fontUi,
                fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                fontWeight: on ? 700 : 500,
                position: 'relative', zIndex: 1,
                transition: 'color 0.25s',
                WebkitTapHighlightColor: 'transparent',
                ...(isHealthTab ? { userSelect: 'none', touchAction: 'manipulation' } : null),
              }}>
                {/* Icon zone, matches the key plate footprint so the glyph
                    sits centred on the gold plate when active. */}
                <div style={{
                  position: 'relative', width: KEY, height: ICON_H,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: on ? 'var(--accent-ink)' : UI.inkFaint,
                  transform: on ? 'scale(1.2)' : 'scale(1)',
                  // Delay the darkening so the glyph only turns near-black once
                  // the gold plate has slid underneath it (plate is 0.35s),
                  // otherwise a dark icon sits on the dark bar mid-slide and
                  // looks like it vanishes. Lightening on deselect is immediate.
                  transition: on
                    ? 'color 0.12s ease 0.25s, transform 0.25s cubic-bezier(0.34,1.4,0.64,1)'
                    : 'color 0.15s, transform 0.25s cubic-bezier(0.34,1.4,0.64,1)',
                }}>
                  {React.cloneElement(TAB_ICONS[iconKey], { width: ICON_SZ, height: ICON_SZ })}
                  {badge?.live && (
                    <div style={{ position: 'absolute', top: 5, right: 4, width: 8, height: 8, borderRadius: '50%', background: on ? 'var(--accent-ink)' : 'var(--accent)', animation: 'pulseDot 1.5s ease-in-out infinite', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--bg)'}` }} />
                  )}
                  {!badge?.live && badge?.count > 0 && (
                    <div style={{ position: 'absolute', top: 1, right: -2, minWidth: 16, height: 16, borderRadius: '50%', background: on ? 'var(--accent-ink)' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--bg)'}`, padding: '0 3px' }}>
                      <span style={{ fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, color: on ? 'var(--accent)' : 'var(--accent-ink)', lineHeight: 1 }}>{badge.count > 9 ? '9+' : badge.count}</span>
                    </div>
                  )}
                </div>
                {/* -0.14em cancels the trailing letter-spacing after the last
                    glyph so the visible text is pixel-centred under the plate. */}
                <span style={{ marginRight: '-0.14em' }}>{label}</span>
                <div style={{ height: 4, display: 'flex', alignItems: 'center' }}>{t.id === 'health' && healthDots(on, healthSlot, enabledSlots)}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
    {reveal && (
      <div style={{
        position: 'fixed', left: reveal.anchorX, bottom: reveal.bottom, transform: 'translateX(-50%)',
        transformOrigin: 'bottom center',
        display: 'flex', gap: 8, padding: 8,
        background: 'rgba(var(--bg-rgb),0.97)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: `1px solid ${UI.hairStrong}`,
        borderRadius: 8,
        boxShadow: '0 10px 24px rgba(0,0,0,0.5)',
        animation: 'tabPopIn 0.2s cubic-bezier(0.34,1.4,0.64,1)',
        zIndex: 30,
      }}>
        {enabledSlots.filter(id => id !== currentHealthSlot).map(id => {
          const hovered = reveal.hoverId === id;
          return (
            <div key={id} data-health-option={id} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '10px 18px', borderRadius: 6,
              background: hovered ? 'rgba(var(--accent-rgb),0.22)' : 'transparent',
              border: `1px solid ${hovered ? UI.gold : UI.hairStrong}`,
              color: hovered ? UI.gold : UI.inkSoft,
            }}>
              {React.cloneElement(TAB_ICONS[id], { width: 22, height: 22 })}
              <span style={{ fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {{ health: 'Health', water: 'Water', food: 'Food', medications: 'Meds' }[id]}
              </span>
            </div>
          );
        })}
      </div>
    )}
    </>
  );
}

// ─── Buttons ────────────────────────────────────────────────────────
const btnPrimary = {
  background: `linear-gradient(180deg, var(--accent-light), var(--accent))`,
  color: 'var(--accent-ink)',
  border: '1px solid var(--accent-deep)',
  borderRadius: 6,
  padding: '14px 24px', minHeight: 48,
  fontFamily: UI.fontUi, fontSize: 13, fontWeight: 700,
  letterSpacing: '0.12em', textTransform: 'uppercase',
  cursor: 'pointer',
  boxShadow: '0 6px 20px rgba(var(--accent-rgb),0.30)',
  WebkitTapHighlightColor: 'transparent',
  // Solid fill of its own: the inherited grid-lift (paper only) would
  // muddy already-high-contrast accent-ink text on top of it.
  textShadow: 'none',
};

const btnGhost = {
  background: 'transparent',
  color: 'var(--ink)',
  border: `1px solid var(--hair-strong)`,
  borderRadius: 6,
  padding: '14px 22px', minHeight: 48,
  fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
  letterSpacing: '0.10em', textTransform: 'uppercase',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

function Btn({ children, kind = 'primary', style = {}, ...rest }) {
  const base = kind === 'primary' ? btnPrimary : btnGhost;
  // {...rest} must come BEFORE style so the merged base+style always wins. The
  // precompile loader runs every file as a classic script in one shared global
  // scope, and Babel emits a per-file `_excluded` array for each object-rest
  // (`...rest`) that all collide on the same global name (last-loaded wins). If
  // another file's `_excluded` (e.g. one that doesn't list "style") overwrites
  // this component's, `style` leaks into `rest`; spreading rest last would then
  // let the raw style prop clobber our base styling. Ordering rest first makes
  // Btn immune regardless of which `_excluded` wins.
  return <button {...rest} style={{ ...base, ...style }}>{children}</button>;
}

// ─── Card ───────────────────────────────────────────────────────────
function Card({ children, accent = false, style = {}, ...rest }) {
  return (
    <div {...rest} style={{
      background: accent
        ? `rgba(var(--accent-rgb),0.13)`
        : 'var(--surface-tint)',
      border: `1px solid ${accent ? UI.goldSoft : UI.hairStrong}`,
      borderRadius: 6,
      padding: 16,
      // Card's own fill is translucent (surface-tint / accent-tint, both
      // low-alpha), so a parent Screen's paper grid still shows through it
      // (verified directly) and plain text on top still needs the same lift
      // Screen gives its own children. 'none' outside paper, so this is a
      // no-op on every other theme.
      textShadow: 'var(--text-lift)',
      ...style,
    }}>{children}</div>
  );
}

// ─── Label ──────────────────────────────────────────────────────────
function Label({ children, style = {} }) {
  return (
    <div style={{
      fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
      color: UI.inkFaint, fontFamily: UI.fontUi, fontWeight: 600,
      marginBottom: 6, ...style,
    }}>{children}</div>
  );
}

// ─── Constants ──────────────────────────────────────────────────────
const MUSCLES = ['Abs','Ab/Adductors','Back','Biceps','Calves','Chest','Forearms','Glutes','Hamstrings','Quads','Shoulders','Triceps'];
const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const WEEKDAYS_FULL = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ─── Stepper ────────────────────────────────────────────────────────
// `max` was accepted by five call sites and never implemented, so those
// steppers had no upper bound at all.
function Stepper({ value, onChange, step = 2.5, min = 0, max = null, suffix, big = false }) {
  const round = (v) => Math.round(v * 1000) / 1000;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
      <button type="button" aria-label="Decrease" onClick={() => onChange(Math.max(min, round((+value || 0) - step)))} style={{
        width: big ? 44 : 36, height: big ? 44 : 36, padding: 0,
        borderRadius: 4, border: `1px solid ${UI.hairStrong}`,
        background: 'transparent', color: UI.ink, cursor: 'pointer',
        fontSize: big ? 22 : 18, lineHeight: 1, fontWeight: 300,
        WebkitTapHighlightColor: 'transparent',
      }}>−</button>
      <div style={{
        flex: 1, textAlign: 'center', fontFamily: UI.fontNum,
        fontSize: big ? 36 : 22, color: UI.ink, minWidth: big ? 100 : 64,
        fontVariantNumeric: 'tabular-nums',
      }}>{value ?? '—'}{suffix && <span style={{ fontSize: big ? 14 : 11, color: UI.inkFaint, marginLeft: 4 }}>{suffix}</span>}</div>
      <button type="button" aria-label="Increase" onClick={() => onChange(max != null ? Math.min(max, round((+value || 0) + step)) : round((+value || 0) + step))} style={{
        width: big ? 44 : 36, height: big ? 44 : 36, padding: 0,
        borderRadius: 4, border: `1px solid ${UI.hairStrong}`,
        background: 'transparent', color: UI.ink, cursor: 'pointer',
        fontSize: big ? 22 : 18, lineHeight: 1, fontWeight: 300,
        WebkitTapHighlightColor: 'transparent',
        opacity: (max != null && (+value || 0) >= max) ? 0.4 : 1,
      }}>+</button>
    </div>
  );
}

// ─── CleanupStartBody ───────────────────────────────────────────────
// Contents of the "start a cleanup week" prompt, shared by the Plan tab and
// the day log so the two entry points cannot describe the same feature
// differently. Rendered INSIDE whichever sheet the calling screen already
// uses (MiniSheet there, Sheet here), rather than bringing its own, so
// neither screen's existing sheet behaviour changes.
// Presentational on purpose: the caller owns the percentage state, resolves
// the start day and performs the start, which keeps this file free of store
// and LB logic like the rest of ui.jsx.
function CleanupStartBody({ percent, onPercent, startLabel, onCancel, onStart }) {
  const stepBtn = (delta, disabled, label, glyph) => (
    <button onClick={() => onPercent(Math.min(30, Math.max(10, percent + delta)))}
      disabled={disabled} aria-label={label}
      style={{
        width: 34, height: 34, borderRadius: 4, cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${UI.hairStrong}`, background: 'transparent',
        color: disabled ? UI.hairStrong : UI.inkSoft, fontSize: 16, lineHeight: 1,
      }}>{glyph}</button>
  );
  return (
    <>
      <div style={{ fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.5, color: UI.inkSoft, marginBottom: 12 }}>
        Train your normal plan with lighter weights for one full cycle, so you can rebuild clean technique. Unlike a deload, the reduced weights carry forward: the cycle after builds back up from them. You can put any single exercise back on full load while training.
      </div>
      {/* The single most surprising thing about this, so it gets its own line
          rather than a clause buried in the paragraph above: it does NOT start
          today. A cleanup covers a whole cycle, so it waits for the next one to
          begin and leaves the rest of this one at full load. */}
      <div style={{
        fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.5, color: UI.gold, marginBottom: 18,
        background: 'rgba(var(--accent-rgb),0.08)', border: `var(--hair-width) solid ${UI.goldSoft}`,
        borderRadius: 6, padding: '8px 10px',
      }}>
        <i className="fa-solid fa-calendar-day" style={{ marginRight: 7 }} />
        {startLabel
          ? <>Starts <strong>{startLabel}</strong>, the first day of your next cycle. The rest of this one still trains at full load.</>
          : <>Starts right away and runs for one full rotation.</>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <span className="label" style={{ color: UI.inkFaint }}>Reduce by</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {stepBtn(-5, percent <= 10, 'Less reduction', '−')}
          <span className="num" style={{ fontSize: 22, color: UI.gold, minWidth: 58, textAlign: 'center' }}>{percent}%</span>
          {stepBtn(5, percent >= 30, 'More reduction', '+')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn kind="ghost" onClick={onCancel} style={{ flex: 1 }}>Cancel</Btn>
        <Btn onClick={onStart} style={{ flex: 1 }}>Start</Btn>
      </div>
    </>
  );
}

// ─── Pill ───────────────────────────────────────────────────────────
// Always 9px (the border-radius scale's own micro-badge threshold, see
// CLAUDE.md), so the radius itself follows that scale's "interactive or
// not" line: 4 only when this Pill owns its own tap handler (onClick in
// ...rest), 2 otherwise. At 9px tall a 4px corner eats most of the edge
// and reads as a pill instead of a badge, the same reasoning TierChip's
// own radius-2 override already documents.
function Pill({ children, gold = false, style = {}, ...rest }) {
  return (
    <span {...rest} style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 8px', borderRadius: rest.onClick ? 4 : 2,
      fontSize: 9, letterSpacing: '0.14em',
      fontFamily: UI.fontUi, fontWeight: 600, textTransform: 'uppercase',
      background: gold ? UI.goldFaint : 'transparent',
      color: gold ? UI.gold : UI.inkSoft,
      border: `1px solid ${gold ? UI.goldSoft : UI.hairStrong}`,
      ...style,
    }}>{children}</span>
  );
}

// ─── Toggle ─────────────────────────────────────────────────────────
// disabled: for a switch whose state is dictated by something else (e.g. the
// coaching tab while a relationship is active). Renders muted and stops
// tapping, instead of springing back and looking broken.
//
// A real <button role="switch">, not a div with an onClick. The div version
// was unreachable by keyboard and invisible to assistive tech: no focus, no
// Space/Enter, and nothing announcing that it was a control or which way it
// was set. The element brings all of that for free, so there is no key
// handler here on purpose.
//
// label names the control. Every switch in this app sits next to its text in
// a row, and that text is not associated with anything, so without a name a
// screen reader reads "switch, on" and nothing else. The settings Row injects
// its own label automatically (see there); pass it by hand anywhere else.
//
// Buttons come with their own padding, font, background and border, so those
// are reset explicitly rather than inherited from the UA. display: block
// keeps the box identical to the div this replaced, so no caller's layout
// shifts. The 13px track radius is the one documented exception to the radius
// scale (CLAUDE.md), the switch is deliberately pill-shaped at 44x26.
function Toggle({ on, onToggle, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={label || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onToggle}
      style={{ display: 'block', padding: 0, margin: 0, font: 'inherit', appearance: 'none', WebkitAppearance: 'none', width: 44, height: 26, borderRadius: 13, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, flexShrink: 0, background: on ? 'var(--accent)' : UI.bgInset, border: `var(--hair-width) solid ${on ? 'var(--hair-accent)' : UI.hairStrong}`, position: 'relative', transition: 'background 0.18s', WebkitTapHighlightColor: 'transparent' }}
    >
      <div style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: on ? 'var(--accent-ink)' : UI.inkFaint, transition: 'left 0.18s' }} />
    </button>
  );
}

// Every currently open Sheet registers its own token here in mount order, so
// a stacked Escape press (e.g. a zIndex:200 child opened over its still-open
// zIndex:100 parent, a real pattern in this app) closes only the TOPMOST
// sheet. A plain per-Sheet `document.addEventListener('keydown', ...)` with
// only stopPropagation() cannot do this alone: stopPropagation blocks
// bubbling to ancestor DOM nodes, not sibling listeners registered on the
// same document node, so both sheets' handlers still fire from one keypress.
// Also gates the Tab focus trap below the same way: only the topmost sheet
// should constrain Tab, a background parent doing the same would fight it.
const _openSheetStack = [];

// Standard interactive-element selector for a lightweight focus trap.
// offsetParent === null filters out display:none descendants (a collapsed
// accordion section, a hidden tab panel) without pulling in a full
// visibility library for what is deliberately a minimal trap.
function focusableIn(container) {
  if (!container) return [];
  const nodes = container.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
  return Array.prototype.filter.call(nodes, el => el.offsetParent !== null || el === document.activeElement);
}

// ─── Sheet ──────────────────────────────────────────────────────────
// keyboardHeight: lets a caller report a non-native on-screen keyboard (e.g.
// this app's custom numeric keypad, which focuses no real <input> so the
// visualViewport-based auto-detection below never fires for it) is open, at
// a known height, combined with the auto-detected kbHeight via Math.max so
// existing callers (default 0) are unaffected.
// accent: swaps the neutral hairline border/drag-handle for an accent-toned
// edge plus an ambient glow, reserved for sheets that represent something
// deliberately intense (currently just the Drop Set/Myo-Reps/AMRAP
// Variations chain sheet), not a general-purpose "make it gold" switch.
// zIndex: lets a caller override the default stacking tier (100) when it
// must guarantee winning against a specific known overlay, e.g. sitting
// above its own parent's opaque z-9998 wizard, or beating an ordinary Sheet
// from underneath a still-open admin Sheet. Not a general-purpose knob:
// only reach for it when there's a concrete overlay this Sheet must clear.
// panelRef (optional): forwarded onto the actual panel div (not the
// full-screen backdrop), so a caller can measure it. Only reason this
// exists: the Food Tracker's staged-chip flight (screens-food.jsx) measures
// whichever of its Log it/Plan it sheets is currently open as the flight's
// source rect when it stages an entry, so it needs a real handle on the
// panel node itself.
function Sheet({ open, onClose, title, titleColor, titleRight, children, renderContent, keyboardHeight = 0, accent = false, center = false, zIndex = 100, panelRef }) {
  const [kbHeight, setKbHeight] = React.useState(0);
  const [vvHeight, setVvHeight] = React.useState(window.innerHeight);
  const panelNodeRef = React.useRef(null);
  const previousFocusRef = React.useRef(null);
  const titleIdRef = React.useRef(`sheet-title-${Math.random().toString(36).slice(2)}`);
  const setPanelRef = (node) => {
    panelNodeRef.current = node;
    if (typeof panelRef === 'function') panelRef(node);
    else if (panelRef) panelRef.current = node;
  };
  // Every sheet opens with the keyboard down, full stop: a field left
  // focused from wherever the user was before (a background screen, or a
  // sheet this one replaces/covers) would otherwise keep the OS keyboard
  // open for no reason, and an autoFocus field of THIS sheet's own would
  // pop it open fresh. Both read the same way from the user's side ("the
  // keyboard jumps up when I open a sheet"), so both are unconditionally
  // blurred here, not just the former: an autoFocus prop stops doing
  // anything at all once this runs, the field is exactly as unfocused as
  // one without it, tapping it is the only way in either case now.
  // useLayoutEffect (not useEffect) runs synchronously right after this
  // sheet's own DOM, including that autoFocus child, has already
  // committed, so there's no visible flash of focus before it's dropped.
  React.useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    previousFocusRef.current = active;
    if (active && active !== document.body && active.blur) active.blur();
    // Focus the dialog container, never a child input. This gives screen
    // readers a stable entry point while preserving the deliberate
    // "keyboard stays down until the user taps a field" behaviour.
    panelNodeRef.current?.focus?.({ preventScroll: true });
    return () => {
      const previous = previousFocusRef.current;
      const current = document.activeElement;
      const isTextEntry = previous && (previous.tagName === 'INPUT' || previous.tagName === 'TEXTAREA' || previous.isContentEditable);
      if (previous && !isTextEntry && document.contains(previous) && (current === document.body || panelNodeRef.current?.contains?.(current))) {
        try { previous.focus({ preventScroll: true }); } catch (_) { previous.focus(); }
      }
    };
  }, [open]);
  const stackTokenRef = React.useRef({});
  // onClose is read through a ref, and is deliberately NOT a dependency of the
  // stack effect below. Practically every call site passes a fresh closure each
  // render (a bare `function` in the component body, or an inline arrow), so
  // depending on it made the effect tear down and re-push on EVERY render:
  // React flushes passive effects destroy-all-then-create-all in tree order, so
  // the stack re-sorted itself into JSX declaration order instead of the order
  // the sheets actually opened. Any sheet that opens ON TOP of one declared
  // earlier in the same component then lost Escape (and the Tab trap) to the
  // sheet behind it, e.g. the Food Tracker's quantity sheet over its still-open
  // "Review meal" list, or useConfirm's portal dialog in any screen that
  // renders {confirmEl} above its own sheets. Depending on [open] alone makes
  // the push order exactly the open order again.
  // Synced in an effect, not during render: a concurrent render React discards
  // must not leave a handler the app never committed sitting in the ref. The
  // useRef initializer covers the very first render, and the ref is only ever
  // read from a DOM event, which cannot fire before a commit.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => { onCloseRef.current = onClose; });
  React.useEffect(() => {
    if (!open) return;
    const token = stackTokenRef.current;
    _openSheetStack.push(token);
    const isTopmost = () => _openSheetStack[_openSheetStack.length - 1] === token;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        const close = onCloseRef.current;
        if (!close || !isTopmost()) return;
        event.stopPropagation();
        close();
        return;
      }
      // Trap Tab within this sheet's own focusable elements while it's the
      // topmost open one, same "keyboard stays down until the user taps a
      // field" spirit as the blur-on-open effect above: the initial focus
      // sits on the panel container itself (not a child), so the first Tab
      // must still land on the sheet's first real control instead of
      // escaping straight to whatever the background screen would be next
      // in document order.
      if (event.key === 'Tab' && isTopmost()) {
        const focusable = focusableIn(panelNodeRef.current);
        if (!focusable.length) { event.preventDefault(); panelNodeRef.current?.focus?.(); return; }
        const first = focusable[0], last = focusable[focusable.length - 1];
        const current = document.activeElement;
        const onPanel = current === panelNodeRef.current;
        const outside = !panelNodeRef.current?.contains(current);
        if (event.shiftKey) {
          if (onPanel || outside || current === first) { event.preventDefault(); last.focus(); }
        } else {
          if (onPanel || outside || current === last) { event.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const idx = _openSheetStack.indexOf(token);
      if (idx !== -1) _openSheetStack.splice(idx, 1);
    };
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let prevKb = 0, scrollTimer = null;
    const update = () => {
      // Only treat the innerHeight↔visualViewport gap as keyboard height while a
      // field is actually focused. Otherwise a persistent iOS viewport offset
      // (the safe-area shift bug) would be misread as a keyboard, padding a black
      // gap below the sheet.
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      const kb = typing ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      setKbHeight(kb);
      setVvHeight(vv.height);
      // When the native keyboard opens, the panel shrinks around it but nothing
      // re-scrolls the focused field, so a native <input> low in the panel (e.g.
      // the AMRAP variation-name box on round 2+) ends up hidden behind the
      // keyboard. Pull it back into view once the viewport settles, and only on
      // the open transition (kb grows) so manual scrolling afterwards is left
      // alone: a plain vv 'scroll' keeps kb steady and never triggers this.
      if (typing && kb > prevKb + 8) {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          const el = document.activeElement;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          }
        }, 120);
      }
      prevKb = kb;
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); clearTimeout(scrollTimer); };
  }, [open]);

  if (!open) return null;
  // renderContent is the lazy equivalent of children for sheets whose body
  // contains large lists or expensive derived JSX. Existing children remain
  // fully supported, so callers opt in without changing Sheet semantics.
  const content = typeof renderContent === 'function' ? renderContent() : children;
  const effectiveKbHeight = Math.max(kbHeight, keyboardHeight);
  // Above a real keyboard (native or this app's custom one), the panel no
  // longer sits flush against the physical bottom edge, it floats above
  // it, so it reads as its own card: full rounding + bottom border instead
  // of the bottom-sheet's "attached to the screen edge" look, plus a small
  // gap off the keyboard instead of sitting flush on top of it.
  const floating = effectiveKbHeight > 0;
  // `center` renders the panel as a card floated in the middle of the screen
  // (not a bottom sheet): same full rounding, all-round border and elevated
  // shadow the keyboard-floating variant already uses, so it reads exactly like
  // the intensity chain sheets, just vertically centered. Opt-in, so no other
  // sheet changes.
  const cardLike = floating || center;
  const edgeColor = accent ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong;
  const shadowLayers = [cardLike ? '0 4px 18px rgba(0,0,0,0.4)' : '0 -10px 28px rgba(0,0,0,0.5)'];
  if (cardLike) shadowLayers.push(`0 1px 0 ${edgeColor}`);
  return (
    // The backdrop only shrinks (bottom: keyboardHeight) for the caller-
    // declared custom keyboard, not the auto-detected native one: a custom
    // keyboard is a real DOM sibling (e.g. this app's on-screen numeric
    // keypad) with its own z-index, and a full-height backdrop on top of it
    // would swallow every tap meant for its keys as a backdrop-dismiss
    // instead. A native on-screen keyboard isn't part of this page's DOM at
    // all (a separate OS/browser compositing layer), so there's nothing
    // underneath for the backdrop to block, it keeps its full extent
    // (bottom: 0) and reserves the gap via paddingBottom exactly as before.
    <div onClick={onClose} aria-hidden={false} style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: keyboardHeight,
      background: 'rgba(0,0,0,0.7)', zIndex,
      display: 'flex', alignItems: center ? 'center' : 'flex-end', justifyContent: 'center',
      paddingBottom: (effectiveKbHeight - keyboardHeight) + (floating ? 10 : 0),
      animation: 'sheet-fade 0.18s ease',
    }}>
      {/* accent: inset a few px off the screen edges so the glow has room
          to actually render there instead of bleeding straight off-screen
         , a plain width:100% sheet runs edge-to-edge, leaving nowhere for
          an outward glow on the sides to be visible. */}
      <div style={{ position: 'relative', width: (accent || center) ? 'calc(100% - 32px)' : '100%', maxWidth: 540 }}>
        {/* Same breathing glow as the Intensity button (.intensity-glow /
            @keyframes intensityGlow in index.html), a sibling of the
            panel, not a child of it: the panel has overflow:'auto' for its
            scrollable content, which clips any child's box-shadow the
            instant it bleeds past the panel's own edge, so an ambient glow
            rendered from inside it is invisible no matter its z-index. This
            wrapper has no overflow clipping of its own, so the glow's
            shadow escapes freely. Its own box-shadow (not the panel's,
            which needs a separate static one for elevation) also avoids
            fighting over the same property while animating. */}
        {accent && <div className="intensity-glow-raw" style={{ position: 'absolute', inset: 0, borderRadius: cardLike ? 6 : '6px 6px 0 0', pointerEvents: 'none' }} />}
        <div ref={setPanelRef} role="dialog" aria-modal="true" aria-labelledby={title ? titleIdRef.current : undefined} aria-label={title ? undefined : 'Dialog'} tabIndex={-1} onClick={e => e.stopPropagation()} style={{
          width: '100%', boxSizing: 'border-box',
          backgroundColor: UI.bgRaised, backgroundImage: 'var(--bg-texture)',
          borderRadius: cardLike ? 6 : '6px 6px 0 0',
          border: `1px solid ${edgeColor}`,
          // The dialog container receives programmatic focus to keep the
          // keyboard down when a sheet opens. iOS otherwise paints its
          // native blue focus ring around the whole panel.
          outline: 'none',
          // The panel draws the same paper grid as Screen does (bg-texture
          // above), so plain text sitting on it needs the same lift Screen
          // gives its own children (verified directly: without this, the
          // grid's ruled lines cut straight through the glyphs). 'none'
          // outside paper, so this is a no-op on every other theme.
          textShadow: 'var(--text-lift)',
          ...(!cardLike && { borderBottom: 'none' }),
          // Floating above the keyboard, every edge needs to read as a real
          // boundary on its own, the bottom-sheet variant gets that for free
          // from the drag handle and the darker screen behind it, but a
          // floating card has nothing else anchoring its bottom edge, so the
          // same 1px hairline there can vanish against the dark backdrop. A
          // second, crisp shadow line in the same tone doubles up the border
          // right where it needs it, without touching the other three sides.
          boxShadow: shadowLayers.join(', '),
          // The 3rd value here used to be the bare number 18 instead of '18px'
          //, React silently drops the *entire* padding declaration (not just
          // that one component) when a shorthand's value contains a unitless
          // non-zero number, no warning either. That only ever showed up with
          // the keyboardHeight prop in play (effectiveKbHeight > 0), i.e. only
          // on the drop/myo/AMRAP chain sheets whenever this app's on-screen
          // keypad was open, exactly the "content goes edge to edge" bug
          // reported repeatedly, confirmed via an isolated minimal React
          // repro. Every other Sheet in the app never sets keyboardHeight, so
          // effectiveKbHeight stays 0 and always took the (valid) calc()
          // branch, which is why "all other sheets work fine" was true.
          padding: `16px 22px ${center ? '22px' : (floating ? '18px' : 'calc(env(safe-area-inset-bottom, 8px) + 22px)')}`,
          animation: 'sheet-up 0.22s ease',
          // With a custom keypad open, become a flex column so the content
          // child is bounded to the panel's OWN content box and shrinks to fit
          // (its inner list scrolls), which keeps the child's header + action
          // row pinned above the keypad. As a plain block, the child's
          // maxHeight:'inherit' resolved to the panel's border-box height, so
          // it overran the content box by the panel's padding + drag handle and
          // pushed the actions out of view no matter how the maxHeight was
          // tuned. Only the chain sheet passes keyboardHeight, so no other
          // sheet is touched.
          ...(keyboardHeight > 0 && { display: 'flex', flexDirection: 'column' }),
          // Subtract keyboardHeight (the caller-declared custom keypad; 0 for
          // every native-keyboard sheet, whose vvHeight already shrank on its
          // own). Without it the panel could grow to the full viewport minus 32
          // even though only the space ABOVE the custom keypad is usable, so a
          // long drop/myo/AMRAP chain overflowed its bottom (the active input
          // row + action buttons) down behind the keypad once the list got tall
          // enough. Clamp at 0 so a mis-measured keypad can't force it negative.
          // Also subtract env(safe-area-inset-top) so the panel's top stops at
          // the iPhone status-bar/clock line instead of sliding up behind it.
          maxHeight: center ? '82dvh' : (floating ? `calc(${Math.max(0, vvHeight - keyboardHeight)}px - env(safe-area-inset-top, 0px) - 32px)` : '88dvh'), overflow: 'auto', overscrollBehavior: 'contain',
        }}>
          <div style={{ width: 36, height: 3, background: accent ? 'var(--accent)' : UI.hairStrong, borderRadius: 4, margin: '0 auto 16px' }} />
          {title && (titleRight ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
              <div id={titleIdRef.current} style={{ fontFamily: UI.fontDisplay, fontSize: 28, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: titleColor || UI.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </div>
              <div style={{ flexShrink: 0 }}>{titleRight}</div>
            </div>
          ) : (
            <div id={titleIdRef.current} style={{ fontFamily: UI.fontDisplay, fontSize: 28, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: titleColor || UI.ink, marginBottom: 16 }}>
              {title}
            </div>
          ))}
          {content}
        </div>
      </div>
    </div>
  );
}

// ─── ImageLightbox ──────────────────────────────────────────────────
// Full-screen viewer for a tapped chat/attachment image. Tap anywhere (or
// the close button) to dismiss. src is nullable, render unconditionally
// and pass the tapped image's URL, or null to keep it closed.
function ImageLightbox({ src, onClose }) {
  React.useEffect(() => {
    if (!src) return;
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [src, onClose]);
  if (!src) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Image preview" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'zoom-out', animation: 'sheet-fade 0.18s ease',
    }}>
      <img src={src} alt="" style={{ maxWidth: '92%', maxHeight: '88vh', objectFit: 'contain', borderRadius: 4 }} />
      <button type="button" onClick={onClose} aria-label="Close image preview" style={{
        position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 14px)', right: 16,
        width: 36, height: 36, borderRadius: '50%', border: 'none',
        background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 20, lineHeight: 1,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        WebkitTapHighlightColor: 'transparent',
      }}>×</button>
    </div>
  );
}

// ─── Empty ──────────────────────────────────────────────────────────
function Empty({ title, sub, action, icon }) {
  return (
    <div style={{ padding: '60px 28px', textAlign: 'center', color: UI.inkSoft }}>
      {icon && <div style={{ marginBottom: 18, color: UI.hairStrong, display: 'flex', justifyContent: 'center' }}>{icon}</div>}
      <div style={{ fontFamily: UI.fontDisplay, fontSize: 34, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: UI.ink, marginBottom: 8, lineHeight: 1 }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: UI.inkSoft, lineHeight: 1.5, marginTop: 6 }}>{sub}</div>}
      {action && <div style={{ marginTop: 24 }}>{action}</div>}
    </div>
  );
}

// ─── Chevron ────────────────────────────────────────────────────────
function ChevronRight({ color }) {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="none" stroke={color || UI.gold} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1l6 6-6 6"/>
    </svg>
  );
}

// ─── Icon glyphs ────────────────────────────────────────────────────
const ICON_HISTORY = (
  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 3"/>
  </svg>
);
const ICON_BARBELL = (
  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="12" x2="18" y2="12"/>
    <rect x="1" y="9.5" width="3" height="5" rx="0.5"/>
    <rect x="20" y="9.5" width="3" height="5" rx="0.5"/>
    <rect x="4" y="10.5" width="2" height="3" rx="0.5"/>
    <rect x="18" y="10.5" width="2" height="3" rx="0.5"/>
  </svg>
);
const ICON_CALENDAR = (
  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2.5"/>
    <path d="M16 2v4M8 2v4M3 10h18"/>
    <circle cx="8" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/>
  </svg>
);

// ─── useConfirm ─────────────────────────────────────────────────────
// zIndex: lets a caller whose own UI already sits above the ordinary z-100
// tier (e.g. a wizard's z-9998 overlay) keep its confirm dialog on top of
// itself too: otherwise this hook's Sheet (portaled to document.body, but
// still z-100) can render hidden behind the caller's own higher overlay.
function useConfirm(zIndex = 100) {
  const [state, setState] = React.useState(null);
  // requireText: when set, the user must type this phrase (case-insensitive) to
  // unlock the confirm button, a deliberate friction gate for irreversible,
  // account-wide actions (e.g. Delete all data).
  const [typed, setTyped] = React.useState('');
  const confirm = (message, { title = 'Confirm?', ok = 'OK', cancel = 'Cancel', danger = false, preventBackdropClose = false, requireText = null } = {}) =>
    new Promise(resolve => { setTyped(''); setState({ message, title, ok, cancel, danger, preventBackdropClose, requireText, resolve }); });
  const close = (result) => { state?.resolve(result); setState(null); setTyped(''); };
  // Normalize the phrase before comparing so a type-to-confirm gate can't be
  // defeated by iOS smart punctuation (curly vs straight apostrophe) or a
  // dropped apostrophe. Without this a phrase like "yes i'm sure" could lock the
  // user out on mobile. Strips straight and curly apostrophes on both sides.
  const normConfirmText = (s) => (s || '').trim().toLowerCase().replace(/[‘’ʼ']/g, '');
  const okLocked = !!state?.requireText && normConfirmText(typed) !== normConfirmText(state.requireText);
  // Portal into document.body so the confirm sheet always sits above any other
  // Sheet (both zIndex: 100) regardless of where confirmEl is placed in the tree.
  const el = state && ReactDOM.createPortal(
    <Sheet open={true} onClose={state.preventBackdropClose ? null : () => close(false)} zIndex={zIndex}>
      <div style={{ fontFamily: UI.fontDisplay, fontSize: 26, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: UI.ink, marginBottom: 10, textAlign: 'center' }}>{state.title}</div>
      <div style={{ fontSize: 14, color: UI.inkSoft, marginBottom: state.requireText ? 16 : 22, lineHeight: 1.5, textAlign: 'center' }}>{state.message}</div>
      {state.requireText && (
        <div style={{ marginBottom: 22 }}>
          <div className="micro" style={{ color: UI.inkFaint, textTransform: 'none', letterSpacing: '0.02em', lineHeight: 1.5, marginBottom: 6, textAlign: 'center' }}>
            Type <b style={{ color: UI.ink }}>{state.requireText}</b> to confirm
          </div>
          <TextInput value={typed} onChange={setTyped} placeholder={state.requireText} autoFocus />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {/* cancel: null → single-button alert mode (nothing to actually
            confirm/deny, just an explanation to acknowledge). */}
        {state.cancel && <Btn kind="ghost" onClick={() => close(false)} style={{ flex: 1 }}>{state.cancel}</Btn>}
        <Btn onClick={() => close(true)} disabled={okLocked} style={{
          flex: state.cancel ? 2 : 1,
          ...(state.danger ? { background: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.6)', boxShadow: '0 6px 20px rgba(var(--danger-rgb),0.25)' } : {}),
          ...(okLocked ? { opacity: 0.4, cursor: 'not-allowed', boxShadow: 'none' } : {}),
        }}>{state.ok}</Btn>
      </div>
    </Sheet>,
    document.body
  );
  return [el, confirm];
}

// ─── Primitives ─────────────────────────────────────────────────────

function Hairline({ vertical = false, color, style = {} }) {
  if (vertical) {
    return <div style={{ background: color || UI.hairStrong, width: '1px', height: '100%', flexShrink: 0, ...style }} />;
  }
  return <div className="knurl" style={{ flexShrink: 0, ...style }} />;
}

// Heavy corner brackets, industrial equipment aesthetic
function BracketFrame({ children, gold = false, style = {}, padding = 22, ...rest }) {
  const c = gold ? UI.gold : UI.hairStrong;
  const len = 20;
  const thick = '3px';
  const Corner = ({ pos }) => {
    const s = { position: 'absolute', width: len, height: len, pointerEvents: 'none' };
    if (pos === 'tl') return <div style={{ ...s, top: 0, left: 0, borderTop: `${thick} solid ${c}`, borderLeft: `${thick} solid ${c}` }} />;
    if (pos === 'tr') return <div style={{ ...s, top: 0, right: 0, borderTop: `${thick} solid ${c}`, borderRight: `${thick} solid ${c}` }} />;
    if (pos === 'bl') return <div style={{ ...s, bottom: 0, left: 0, borderBottom: `${thick} solid ${c}`, borderLeft: `${thick} solid ${c}` }} />;
    if (pos === 'br') return <div style={{ ...s, bottom: 0, right: 0, borderBottom: `${thick} solid ${c}`, borderRight: `${thick} solid ${c}` }} />;
  };
  return (
    <div {...rest} style={{ position: 'relative', padding, ...style }}>
      <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
      {children}
    </div>
  );
}

// Frame, bordered container
function Frame({ children, accent = false, style = {}, padding = 18, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: accent
        ? `rgba(var(--accent-rgb),0.13)`
        : 'var(--surface-tint)',
      border: `1px solid ${accent ? UI.goldSoft : UI.hairStrong}`,
      borderRadius: 6,
      padding,
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    }}>{children}</div>
  );
}

// Stat block, replaces circular watch sub-dial with a flat, bold stat display
function SubDial({ label, value, sub, size = 110, gold = false, style = {} }) {
  const numSize = String(value).length > 5
    ? size * 0.17
    : String(value).length > 3
      ? size * 0.22
      : size * 0.30;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
      gap: 4,
      minWidth: size * 0.72,
      flexShrink: 0,
      paddingTop: 10,
      borderTop: `3px solid ${gold ? UI.gold : UI.hairStrong}`,
      ...style,
    }}>
      <span style={{
        fontFamily: UI.fontNum,
        fontSize: numSize,
        color: gold ? UI.gold : UI.ink,
        fontWeight: 600,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
      {sub && <span style={{
        fontFamily: UI.fontUi, fontSize: 8,
        color: gold ? UI.gold : UI.inkFaint,
        letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1,
      }}>{sub}</span>}
      <span style={{
        fontFamily: UI.fontUi,
        fontSize: Math.max(7, size * 0.09),
        color: gold ? UI.gold : UI.inkFaint,
        letterSpacing: '0.18em', textTransform: 'uppercase', lineHeight: 1,
      }}>{label}</span>
    </div>
  );
}

// Heavy rule section divider
function Bezel({ children, style = {} }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px', ...style }}>
      <div className="knurl" style={{ flex: 1 }} />
      <span style={{
        fontFamily: UI.fontUi, fontSize: 10,
        letterSpacing: '0.20em', color: UI.inkFaint,
        textTransform: 'uppercase', fontWeight: 700, whiteSpace: 'nowrap',
      }}>{children}</span>
      <div className="knurl" style={{ flex: 1 }} />
    </div>
  );
}

// Screen header for detail views
function ScreenHead({ ref_, title, sub, right, onBack, style = {} }) {
  const { pressing, handlers } = useLongPressHome();
  return (
    <div style={{
      flexShrink: 0, padding: 'env(safe-area-inset-top, 0px) 22px 14px',
      position: 'relative', ...style,
    }}>
      {sub && (
        <div style={{ marginBottom: 10 }}>
          <span className="micro" style={{ color: UI.inkFaint }}>{sub}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back" style={{
            width: 32, height: 32, borderRadius: 4,
            border: `1px solid ${UI.hairStrong}`, background: 'transparent',
            color: UI.gold, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 1 1 7l6 6"/></svg>
          </button>
        )}
        <div {...handlers} style={{
          flex: 1, fontFamily: UI.fontDisplay, fontSize: 32, fontWeight: 700, lineHeight: 1, color: UI.ink, letterSpacing: '0.04em', textTransform: 'uppercase',
          opacity: pressing ? 0.5 : 1, transition: 'opacity 0.15s',
          WebkitTapHighlightColor: 'transparent', userSelect: 'none', touchAction: 'manipulation',
        }}>
          {title}
        </div>
        {right}
      </div>
    </div>
  );
}

function NumInput({ value, onChange, placeholder = 'Default', disabled, style = {}, positiveOnly }) {
  const [raw, setRaw] = React.useState(value != null ? String(value).replace('.', ',') : '');
  const focused = React.useRef(false);
  React.useEffect(() => { if (!focused.current) setRaw(value != null ? String(value).replace('.', ',') : ''); }, [value]);
  return (
    <input
      value={raw} placeholder={placeholder} disabled={disabled}
      type="text" inputMode="decimal"
      onFocus={e => { focused.current = true; e.target.select(); }}
      onBlur={() => {
        focused.current = false;
        // Re-derive raw from the committed value, not from a fresh parse of
        // raw itself: onChange below only ever commits accepted input, so
        // this guarantees the display can never show something (blank, a
        // rejected in-progress edit) other than what's actually stored.
        setRaw(value != null ? String(value).replace('.', ',') : '');
      }}
      onChange={e => {
        setRaw(e.target.value);
        const n = e.target.value === '' ? null : parseFloat(e.target.value.replace(',', '.'));
        const accepted = e.target.value === '' || (!isNaN(n) && (!positiveOnly || n > 0));
        if (accepted) onChange(n ?? null);
      }}
      style={{
        background: 'transparent', border: 'none', outline: 'none',
        color: disabled ? UI.inkSoft : UI.ink,
        fontFamily: UI.fontNum, fontVariantNumeric: 'tabular-nums',
        textAlign: 'center', width: '100%', padding: 0,
        ...style,
      }}
    />
  );
}

// accent: opt-in per call site (default off, every existing Field keeps its
// plain faint label unchanged), swaps in .label-gold instead of .label for
// a sheet/section that wants its field labels to read as accent-colored
// headings rather than muted captions.
function Field({ label, children, style = {}, accent = false }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <span className={accent ? 'label-gold' : 'label'}>{label}</span>
      {children}
    </label>
  );
}

// Pass `onToggleReveal` (and the controlled `reveal` boolean) to render a
// password show/hide eye on the right. The caller owns the reveal state and
// drives `type` from it, so a single toggle can reveal a whole group of fields
// (e.g. password + repeat) by sharing one state across them.
function TextInput({ value, onChange, placeholder, type = 'text', autoFocus, reveal, onToggleReveal, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const inputRef = React.useRef(null);
  const savedSel = React.useRef(null);

  React.useLayoutEffect(() => {
    if (type === 'password') return;
    const el = inputRef.current;
    if (!el || document.activeElement !== el) return;
    const sel = savedSel.current;
    savedSel.current = null;
    if (sel?.start != null) {
      try { el.setSelectionRange(sel.start, sel.end); } catch (_) {}
    }
  });

  const handleChange = (e) => {
    if (type !== 'password') {
      try { savedSel.current = { start: e.target.selectionStart, end: e.target.selectionEnd }; } catch (_) {}
    }
    onChange(e.target.value);
  };

  return (
    <div style={{
      borderBottom: `1px solid ${focus ? UI.gold : UI.hairStrong}`,
      transition: 'border-color 0.2s',
      padding: '8px 0',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        autoCorrect="off"
        spellCheck={false}
        type={type} placeholder={placeholder} autoFocus={autoFocus}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        {...rest}
        style={{
          flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
          color: UI.ink, fontFamily: UI.fontUi, fontSize: 16, padding: 0,
        }}
      />
      {onToggleReveal && (
        <button
          type="button"
          onClick={onToggleReveal}
          aria-label={reveal ? 'Hide password' : 'Show password'}
          style={{
            flexShrink: 0, background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer',
            color: reveal ? UI.gold : UI.inkFaint, display: 'flex', alignItems: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <i className={reveal ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'} style={{ fontSize: 14 }} />
        </button>
      )}
    </div>
  );
}

// Weight unit label ('kg' or 'lbs'). Pure display label, the stored number is
// the same regardless of unit (lbs users enter lbs directly, no conversion).
// Kept in sync with store.settings.unit by app.jsx on every render.
UI.unit = () => (typeof window !== 'undefined' && window.__UNIT) || 'kg';

// Water/hydration is stored canonically in ml. Imperial (lbs) users see US
// fluid ounces (1 fl oz = 29.5735 ml); metric (kg) and mixed (kg/mi, the UK
// profile) stay ml/L: the UK measures water in ml, not oz, and UK vs US fl oz
// even differ. UI.unit() is the VIEWER's unit, so a coach reviewing a client's
// hydration sees it in the coach's own unit, no client-unit plumbing needed.
UI.FLOZ_ML = 29.5735;
// The optional `u` overrides the viewer's own unit. A coach reading a client's
// day must see the CLIENT's units (weight and temperature already do this via
// explicit props); water used to fall through to window.__UNIT and relabel the
// client's litres as fl oz.
UI.waterInFloz = (u) => (u || UI.unit()) === 'lbs';
UI.mlToFloz = (ml) => ml / UI.FLOZ_ML;
UI.flozToMl = (oz) => oz * UI.FLOZ_ML;
// Label for the raw water-entry field (whole units the user types).
UI.waterEntryUnit = () => UI.waterInFloz() ? 'fl oz' : 'ml';
// Stored ml -> the integer entry value shown in the field, in the viewer's unit.
UI.waterToEntry = (ml) => UI.waterInFloz() ? Math.round(UI.mlToFloz(ml)) : Math.round(ml);
// Integer entry value (viewer's unit) -> canonical ml for storage.
UI.waterEntryToMl = (v) => UI.waterInFloz() ? Math.round(UI.flozToMl(v)) : Math.round(v);
// Quick-add increments in the viewer's unit (a glass / a bottle vs 250/500 ml).
UI.waterQuickAdds = () => UI.waterInFloz() ? [8, 16] : [250, 500];
// Summary tile display: imperial shows whole fl oz, else litres (1 decimal).
UI.waterSummaryUnit = (u) => UI.waterInFloz(u) ? 'fl oz' : 'L';
UI.waterSummaryValue = (ml, u) => UI.waterInFloz(u) ? Math.round(UI.mlToFloz(ml)) : Math.round(ml / 100) / 10;

// Food masses (portions, ingredients, cooked weights, shopping quantities) are
// stored canonically in grams; imperial (lbs) users see ounces and pounds. Same
// split as the water block above, and for the same reason: the DB never learns
// about the viewer's unit. The arithmetic and the rounding grids live in
// store.js (LB.formatMassG / LB.roundShoppingQty) so the tests can reach them,
// these are only the wrappers that supply the viewer's unit. ui.jsx runs first
// in the loader's SOURCES, ahead of every screen, but these are the file's only
// LB references and they all sit inside function bodies: store.js is a plain
// <script> in index.html and has long since set window.LB by the time any of
// them is actually called, so the ordering never comes into it.
//
// MACROS ARE NOT MASSES here: protein/carbs/fat/fibre/sugar/sat fat stay grams
// and sodium stays mg for everyone. A US nutrition label prints grams too, so
// converting those would be wrong rather than helpful. Never route a macro
// field through these.
//
// No `u` override (unlike water): nothing in the app renders someone else's
// food masses. Coaches only read meal-plan NAMES and write macro targets, so
// there is no client-unit path to plumb. Add the parameter when one appears,
// not before. A shared recipe opened by a signed-out viewer has no settings at
// all and falls back to grams, which is the right answer for an unknown viewer.
// A per-module opt-out lives on top of the global unit: an imperial user can
// still keep the food tracker specifically in grams (settings.foodForceGrams,
// mirrored to window.__FOOD_FORCE_GRAMS by app.jsx same as __UNIT itself).
// US nutrition labels are printed in grams too, so staying metric here is a
// legitimate choice independent of preferring lbs for bodyweight/water.
UI.massInOz = () => UI.unit() === 'lbs' && !(typeof window !== 'undefined' && window.__FOOD_FORCE_GRAMS);
UI.massEntryUnit = () => UI.massInOz() ? 'oz' : 'g';
// Stored grams -> the value shown in an entry field, in the viewer's unit.
// Two decimals in oz, one in grams: 0.1 oz is a 2.8 g step, which would put
// spice-sized amounts out of reach (see fdDecimalFilter's own cap).
UI.massToEntry = (g) => g == null ? '' : String(UI.massInOz()
  ? Math.round(LB.gToOz(g) * 100) / 100
  : Math.round(g * 10) / 10);
// Entry value (viewer's unit) -> canonical grams, rounded to the one decimal
// the food module works in throughout.
UI.massEntryToG = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (n == null || isNaN(n)) return null;
  return Math.round((UI.massInOz() ? LB.ozToG(n) : n) * 10) / 10;
};
UI.formatMass = (g) => LB.formatMassG(g, UI.massInOz());

// Styled stand-in for window.alert(). The app has useConfirm() for anything
// that asks a question, but a plain "this failed" message forced a component
// to be async and to render confirmEl, so ~40 error paths reached for the raw
// browser dialog instead: the same failure was reported two completely
// different ways depending on which code path hit it, and on iOS the native
// dialog also steals focus and can interrupt a sheet mid-animation.
// Imperative on purpose (own DOM, no React state), so it can be called from
// anywhere, including a catch inside a non-async handler.
// Returns a Promise that resolves when it's dismissed.
UI.alert = (message, { title = null, ok = 'OK' } = {}) => new Promise(resolve => {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:12000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,0.6);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)';
  const box = document.createElement('div');
  box.style.cssText = `max-width:340px;width:100%;background:${UI.bg};border:1px solid ${UI.hairStrong};border-radius:8px;padding:22px;box-shadow:0 18px 50px rgba(0,0,0,0.45)`;
  if (title) {
    const h = document.createElement('div');
    h.style.cssText = `font-family:${UI.fontDisplay};font-size:22px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${UI.ink};margin-bottom:10px`;
    h.textContent = title;
    box.appendChild(h);
  }
  const p = document.createElement('div');
  p.style.cssText = `font-family:${UI.fontUi};font-size:13px;line-height:1.55;color:${UI.inkSoft};margin-bottom:18px;white-space:pre-wrap`;
  p.textContent = String(message == null ? '' : message);
  box.appendChild(p);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = ok;
  btn.style.cssText = `width:100%;padding:11px 0;border:none;border-radius:6px;background:var(--accent);color:var(--accent-ink);font-family:${UI.fontUi};font-size:13px;font-weight:600;cursor:pointer;text-shadow:none`;
  box.appendChild(btn);
  wrap.appendChild(box);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    resolve();
  };
  const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
  btn.addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  btn.focus();
});

// True when the app runs inside a third-party app's in-app browser (X,
// Instagram, Facebook, TikTok, ...) rather than a real browser. Those WKWebView
// or custom-tab environments frequently block cross-origin fetches to Supabase
// (ITP, content blockers, request abort on backgrounding), which surfaces as a
// bare "Load failed" on sign up or login. Heuristic, not exhaustive: it matches
// the common UA tokens plus iOS WebViews that are neither Safari, nor a known
// browser, nor an installed PWA.
UI.isInAppBrowser = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/FBAN|FBAV|FB_IAB|Instagram|Twitter|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|Pinterest|LinkedInApp|GSA\//i.test(ua)) return true;
  const isIOS = /iPhone|iPod|iPad/i.test(ua) && !window.MSStream;
  if (isIOS) {
    const isSafari = /Safari/i.test(ua) && /Version\//i.test(ua);
    const isKnownBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
    const isStandalone = window.navigator.standalone === true;
    if (!isSafari && !isKnownBrowser && !isStandalone) return true;
  }
  return false;
};

// Turn an auth or network error into a user-facing message. WebKit reports a
// failed fetch as "Load failed" (Chromium says "Failed to fetch") with no HTTP
// response, most common inside in-app browsers, so translate those into an
// actionable hint instead of leaking the raw string. Also softens the
// "already registered" case into a nudge to log in.
UI.authErrorMessage = (e, fallback = 'Something went wrong') => {
  const msg = (e && e.message) || '';
  if (/load failed|failed to fetch|networkerror|network request failed|the network connection was lost/i.test(msg)) {
    return 'Network error. Check your connection. If you opened this from another app like X or Instagram, open it in Safari or Chrome and try again.';
  }
  if (/already registered|already exists|already been registered/i.test(msg)) {
    return 'This email is already registered. Try logging in instead.';
  }
  return msg || fallback;
};

// Chart Y-axis domain with breathing room. Pads by 5% of the visible value
// SPAN (max − min), not of the value itself, so a point keeps a consistent
// gap from the edge no matter how far the data sits from zero. (Value-based
// padding fails when the min is small relative to the span: e.g. steps 25k–101k
// gave the 25k point only ~1.5% headroom and it looked glued to the bottom.)
//   • top    = dataMax + 5% of span   (unless a fixed `max` is supplied)
//   • bottom = dataMin − 5% of span, clamped at 0, every metric here is
//     non-negative and 0 stays a hard floor (unless a fixed `min` is supplied,
//     or `zeroFloor` pins it to 0 for bar / area-from-baseline charts).
// A flat series (span 0) falls back to 5% of the value so it still centres.
// Returns { min, max, range } for a linear scale; range is never 0.
UI.chartDomain = (dataMin, dataMax, opts) => {
  opts = opts || {};
  const pad = 0.05 * ((dataMax - dataMin) || Math.abs(dataMax) || 1);
  const top = opts.max != null ? opts.max : dataMax + pad;
  let bottom;
  if (opts.min != null) bottom = opts.min;
  else if (opts.zeroFloor) bottom = 0;
  // Ground non-negative data at 0, but let negative data (e.g. assisted loads,
  // stored as negative kg) span below 0 instead of collapsing to a 0..negative
  // range that inverts the axis.
  else bottom = dataMin < 0 ? (dataMin - pad) : Math.max(0, dataMin - pad);
  return { min: bottom, max: top, range: (top - bottom) || 1 };
};

// Same padded domain as chartDomain, but snapped to a clean grid in units of
// `step` (5 lb / 2.5 kg for a weight axis): every gridline is a whole
// multiple of `step`, so the axis always reads 90/95/100/105 instead of
// wherever the padded data happened to start (91/96/101). The per-gridline
// increment is `step` times the smallest value off a 1-2-5 ladder that keeps
// the count near 4 (every other health chart's fixed gridline count), a
// plain "always exactly `step` apart" would work for a normal few-lb swing
// but explode into a dozen+ cramped lines for a wide (e.g. bulk/cut, "all
// time") range; escalating to 2×/5×/10×step etc. keeps it readable while
// every label stays a clean multiple of the base unit.
UI.niceStepDomain = (dataMin, dataMax, step, opts) => {
  const dom = UI.chartDomain(dataMin, dataMax, opts);
  const LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const target = (dom.max - dom.min) / 3 || step;
  const mult = LADDER.find(m => m * step >= target) || LADDER[LADDER.length - 1];
  const inc = mult * step;
  let min = Math.floor(dom.min / inc) * inc;
  let max = Math.ceil(dom.max / inc) * inc;
  while (Math.round((max - min) / inc) < 3) { min -= inc; max += inc; }
  const n = Math.round((max - min) / inc);
  return { min, max, range: max - min, gridVals: Array.from({ length: n + 1 }, (_, i) => min + inc * i) };
};

// ─── Drag-to-reorder ────────────────────────────────────────────────
// Pointer-based reordering for vertical lists, tuned to feel like the
// fddb_dash drag: long-press to pick up on touch, a small move-threshold
// on mouse, a floating ghost that tracks the finger, and an accent
// drop-line showing where the row will land. Built for the no-build React
// setup, it drives the DOM imperatively for the duration of the drag (no
// state churn) and only commits the new order via onReorder on drop.
//
// Usage:
//   const listRef = UI.useDragReorder({ onReorder: (from, to) => {...} });
//   <div ref={listRef} data-reorder-list="true">
//     {rows.map(... <div data-reorder-item="true">…<DragHandle/>…</div>)}
//   </div>
// from/to are indices into the data-reorder-item set (DOM order). Mark any
// descendant that must NOT start a drag (e.g. a delete button) with
// data-reorder-ignore="true". The callback is a no-op when from === to.
// Pass { fixedSlots: true } when the items themselves never actually move
// (e.g. one per fixed hour/category) and dragging instead reassigns which
// slot an item's data belongs to: to is then the raw drop-line index
// (no "assume the source was removed" shift), so a real move into the very
// next slot still fires instead of reading as a same-position no-op.
// One pointer-driven engine shared by the vertical (attachDragReorder) and
// horizontal (attachDragReorderH) reorder flavors, parameterized by axis.
// Per-axis constants preserve each list type's existing feel: vertical lists
// fall back to scrolling the whole page and tolerate more pre-drag jitter
// (12px) before treating it as a page scroll; horizontal chip strips scroll
// themselves and cancel sooner (8px) since sideways finger movement is much
// more often an intentional scroll, these two thresholds already drifted
// apart once (see the historical dy>dx bug fix this replaced), which is
// exactly the kind of drift a shared engine prevents going forward.
const DRAG_AXIS = {
  v: { scrollEdge: 64, scrollSpeedMax: 18, touchCancelDist: 12, dropLineClass: 'reorder-drop-line' },
  h: { scrollEdge: 48, scrollSpeedMax: 12, touchCancelDist: 8, dropLineClass: 'reorder-drop-line-h' },
};

function attachDragReorderAxis(axis, container, getCb, options) {
  const cfg = DRAG_AXIS[axis];
  const opts = options || {};
  const LONG_PRESS_MS = opts.longPressMs != null ? opts.longPressMs : 220;
  const MOVE_TOLERANCE = opts.moveTolerance != null ? opts.moveTolerance : 8;
  const SCROLL_EDGE = cfg.scrollEdge;
  let state = null;
  let rafId = null;

  // Reorderable rows that belong to THIS list (closest list ancestor is us,
  // guards against any nested reorder list inside a row).
  const items = () => Array.prototype.slice
    .call(container.querySelectorAll('[data-reorder-item]'))
    .filter(el => el.closest('[data-reorder-list]') === container);

  function scrollParent() {
    let n = container;
    while (n && n !== document.body && n !== document.documentElement) {
      const s = getComputedStyle(n);
      const scrolls = axis === 'v'
        ? (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1)
        : (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1);
      if (scrolls) return n;
      n = n.parentElement;
    }
    return null; // fall back to the window (v) / the container itself (h)
  }

  // v: a horizontal line spanning the full container width, positioned by y.
  // h: a vertical line spanning the dragged item's height, positioned by x.
  function placeDropLine(pos) {
    if (!state.dropLine) {
      state.dropLine = document.createElement('div');
      state.dropLine.className = cfg.dropLineClass;
      document.body.appendChild(state.dropLine);
    }
    if (axis === 'v') {
      const r = container.getBoundingClientRect();
      state.dropLine.style.left = r.left + 'px';
      state.dropLine.style.width = r.width + 'px';
      state.dropLine.style.top = (pos - 1) + 'px';
    } else {
      const r = state.src.getBoundingClientRect();
      state.dropLine.style.top = r.top + 'px';
      state.dropLine.style.height = r.height + 'px';
      state.dropLine.style.left = (pos - 1) + 'px';
    }
  }

  function updateTarget(pos) {
    const list = items();
    let insertIdx, line;
    // Hit-test against the DRAGGED GHOST CARD's own visual center, not the
    // raw pointer. The ghost is offset from the pointer by wherever within
    // the source row the user actually grabbed it (state.offsetX/Y from
    // beginDrag): a grab near the row's own bottom makes the ghost visibly
    // track well behind the raw pointer, so hit-testing on the pointer
    // directly needed MORE drag distance than what the card visually
    // showed, mismatched by up to about the grabbed row's own height.
    // Hit-testing on the ghost's own center instead ties the result to
    // what's actually on screen, regardless of where in the row the drag
    // started.
    const grabOffset = axis === 'v' ? state.offsetY : state.offsetX;
    const cardCenter = pos - grabOffset + state.srcSize / 2;
    if (opts.fixedSlots) {
      // Direct hit-test: whichever slot's own rect is under the card
      // center, not the reorder scan below's "insert boundary" (compares
      // against each item's MIDPOINT, including the dragged item's own
      // still-present rect as one of those boundaries).
      insertIdx = list.length - 1;
      for (let k = 0; k < list.length; k++) {
        const r = list[k].getBoundingClientRect();
        const start = axis === 'v' ? r.top : r.left;
        const size = axis === 'v' ? r.height : r.width;
        if (cardCenter < start + size) { insertIdx = k; break; }
      }
      insertIdx = Math.max(0, insertIdx);
      const hit = list[insertIdx];
      const r = hit ? hit.getBoundingClientRect() : container.getBoundingClientRect();
      line = (axis === 'v' ? r.top : r.left) - 3;
    } else {
      insertIdx = list.length;
      line = null;
      // Cross-axis center of the ghost, so a multi-COLUMN layout can be hit
      // tested at all. With the main axis alone every item in the same grid
      // row shares one midpoint, so the second column was unreachable by drag
      // (confirmed in the 2-col Health card grid).
      const crossPos = axis === 'v' ? (state.lastX ?? state.startX) : (state.lastY ?? state.startY);
      const crossGrab = axis === 'v' ? state.offsetX : state.offsetY;
      const crossCenter = crossPos - crossGrab + (state.srcCrossSize || 0) / 2;
      // Whether this is actually a multi-column layout (items sit at more
      // than one distinct cross-axis start), not just a single-column list
      // whose items all happen to share one. The "single-column lists never
      // take the cross branch" comment below was aspirational, not actually
      // true: for a true single column, crossStart+crossSize/2 is identical
      // on every row, so ordinary pointer jitter left/right of the grab
      // point during a purely vertical drag was enough to flip the OR below
      // on whichever row the ghost currently overlapped, moving the drop
      // target by one row on drift alone. Gating the whole cross-axis term
      // on a genuine column difference fixes that without touching the
      // multi-column case (Health's 2-col grid) this branch exists for.
      let isMultiColumn = false;
      let firstCrossStart = null;
      for (let k = 0; k < list.length; k++) {
        const r = list[k].getBoundingClientRect();
        const crossStart = axis === 'v' ? r.left : r.top;
        if (firstCrossStart == null) firstCrossStart = crossStart;
        else if (Math.abs(crossStart - firstCrossStart) > 1) { isMultiColumn = true; break; }
      }
      for (let k = 0; k < list.length; k++) {
        const r = list[k].getBoundingClientRect();
        const start = axis === 'v' ? r.top : r.left;
        const size = axis === 'v' ? r.height : r.width;
        const crossStart = axis === 'v' ? r.left : r.top;
        const crossSize = axis === 'v' ? r.width : r.height;
        // Same row/column as the ghost? Then the cross axis decides, otherwise
        // the main axis does. Single-column lists never take the cross branch
        // (isMultiColumn gates it), so their behavior is unchanged.
        const sameLine = Math.abs((start + size / 2) - cardCenter) < size / 2;
        const isAfter = sameLine
          ? cardCenter < start + size / 2 || (isMultiColumn && crossCenter < crossStart + crossSize / 2)
          : cardCenter < start + size / 2;
        if (isAfter) { insertIdx = k; line = start - 3; break; }
      }
      if (line === null) {
        const last = list[list.length - 1];
        if (last) {
          const r = last.getBoundingClientRect();
          line = (axis === 'v' ? r.bottom : r.right) + 3;
        } else {
          const r = container.getBoundingClientRect();
          line = axis === 'v' ? r.top : r.left;
        }
      }
    }
    state.insertIdx = insertIdx;
    placeDropLine(line);
  }

  function moveGhost(x, y) {
    if (!state || !state.ghost) return;
    state.ghost.style.transform =
      'translate(' + (x - state.offsetX - state.baseLeft) + 'px,' +
      (y - state.offsetY - state.baseTop) + 'px) scale(1.02)';
  }

  // Edge auto-scroll: nudge the nearest scroll container (or window/self)
  // when the pointer hovers near its leading/trailing edge, so long lists
  // stay reachable.
  function tickScroll() {
    if (!state || !state.started) { rafId = null; return; }
    const pos = axis === 'v' ? (state.lastY || 0) : (state.lastX || 0);
    const sp = state.scrollParent;
    const el = sp || (axis === 'v' ? (document.scrollingElement || document.documentElement) : container);
    const spRect = sp ? sp.getBoundingClientRect() : null;
    const edgeStart = spRect ? (axis === 'v' ? spRect.top : spRect.left) : 0;
    const edgeEnd = spRect
      ? (axis === 'v' ? spRect.bottom : spRect.right)
      : (axis === 'v' ? window.innerHeight : window.innerWidth);
    const scrollProp = axis === 'v' ? 'scrollTop' : 'scrollLeft';
    const max = el[axis === 'v' ? 'scrollHeight' : 'scrollWidth'] - el[axis === 'v' ? 'clientHeight' : 'clientWidth'];
    let moved = false;
    if (pos < edgeStart + SCROLL_EDGE && el[scrollProp] > 0) {
      const t = Math.min(1, (edgeStart + SCROLL_EDGE - pos) / SCROLL_EDGE);
      el[scrollProp] = Math.max(0, el[scrollProp] - Math.round(2 + t * cfg.scrollSpeedMax));
      moved = true;
    } else if (pos > edgeEnd - SCROLL_EDGE && el[scrollProp] < max) {
      const t = Math.min(1, (pos - (edgeEnd - SCROLL_EDGE)) / SCROLL_EDGE);
      el[scrollProp] = Math.min(max, el[scrollProp] + Math.round(2 + t * cfg.scrollSpeedMax));
      moved = true;
    }
    if (moved) updateTarget(pos);
    rafId = requestAnimationFrame(tickScroll);
  }

  function beginDrag(x, y) {
    const src = state.src;
    const rect = src.getBoundingClientRect();
    const ghost = src.cloneNode(true);
    ghost.classList.add('reorder-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    document.body.appendChild(ghost);
    src.classList.add('reorder-source');
    state.ghost = ghost;
    state.baseLeft = rect.left;
    state.baseTop = rect.top;
    state.offsetX = x - rect.left;
    state.offsetY = y - rect.top;
    state.srcSize = axis === 'v' ? rect.height : rect.width;
    state.srcCrossSize = axis === 'v' ? rect.width : rect.height;
    state.lastX = x;
    state.lastY = y;
    state.started = true;
    document.body.classList.add('reorder-dragging');
    moveGhost(x, y);
    updateTarget(axis === 'v' ? y : x);
    rafId = requestAnimationFrame(tickScroll);
  }

  function teardown() {
    if (!state) return;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    document.removeEventListener('pointermove', onMove, { passive: false });
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    clearTimeout(state.pressTimer);
    if (state.dropLine) state.dropLine.remove();
    if (state.src) state.src.classList.remove('reorder-source');
    const ghost = state.ghost;
    document.body.classList.remove('reorder-dragging');
    state = null;
    if (ghost) { ghost.style.opacity = '0'; setTimeout(() => ghost.remove(), 160); }
  }

  function onDown(ev) {
    if (state) return;
    if (ev.button != null && ev.button !== 0) return;
    if (!ev.target || !ev.target.closest) return;
    if (ev.target.closest('[data-reorder-ignore]')) return;
    const src = ev.target.closest('[data-reorder-item]');
    if (!src) return;
    const fromIdx = items().indexOf(src);
    if (fromIdx === -1) return;
    state = {
      src, fromIdx, insertIdx: fromIdx,
      startX: ev.clientX, startY: ev.clientY,
      lastX: ev.clientX, lastY: ev.clientY,
      pointerType: ev.pointerType || 'mouse',
      started: false, pressTimer: null, ghost: null, dropLine: null,
      scrollParent: scrollParent(),
    };
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    if (state.pointerType !== 'mouse') {
      state.pressTimer = setTimeout(() => {
        if (state && !state.started) beginDrag(state.startX, state.startY);
      }, LONG_PRESS_MS);
    }
  }

  function onMove(ev) {
    if (!state) return;
    const dist = Math.hypot(ev.clientX - state.startX, ev.clientY - state.startY);
    if (!state.started) {
      if (state.pointerType === 'mouse') {
        if (dist > MOVE_TOLERANCE) beginDrag(state.startX, state.startY);
      } else if (dist > cfg.touchCancelDist) {
        // Moved before the long-press fired → treat as a scroll, bail out.
        clearTimeout(state.pressTimer);
        teardown();
        return;
      }
    }
    if (!state || !state.started) return;
    ev.preventDefault();
    state.lastX = ev.clientX;
    state.lastY = ev.clientY;
    moveGhost(ev.clientX, ev.clientY);
    updateTarget(axis === 'v' ? ev.clientY : ev.clientX);
  }

  function onUp() {
    if (!state) return;
    if (!state.started) { teardown(); return; }
    const from = state.fromIdx;
    let to = state.insertIdx;
    // fixedSlots: the items occupy immovable positions (e.g. hour rows) and
    // dragging reassigns which slot an item's DATA belongs to, rather than
    // permuting the items' own order. The standard "assume the source item
    // is removed, so every later index shifts down by one" adjustment below
    // makes dropping into the very NEXT slot collapse to "to === from" (a
    // real, one-slot move reads identical to a true no-op drop), silently
    // swallowing it before the callback ever fires. Skip the adjustment and
    // hand back the raw drop-line index instead, so the caller sees exactly
    // which slot the pointer landed on.
    if (!opts.fixedSlots && to > from) to -= 1;
    // Swallow the click the pointerup synthesizes, so a drag doesn't also fire
    // the row's tap handler (open editor).
    const swallow = e => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 120);
    teardown();
    if (to !== from && to >= 0) {
      const cb = getCb();
      if (cb) cb(from, to);
    }
  }

  function touchBlocker(ev) { if (state && state.started) ev.preventDefault(); }

  container.addEventListener('pointerdown', onDown);
  document.addEventListener('touchmove', touchBlocker, { passive: false });

  return function cleanup() {
    container.removeEventListener('pointerdown', onDown);
    document.removeEventListener('touchmove', touchBlocker, { passive: false });
    teardown();
  };
}

function attachDragReorder(container, getCb, options) {
  return attachDragReorderAxis('v', container, getCb, options);
}

// Hook wrapper: returns a callback ref to attach to the list container. Re-binds
// cleanly when the container mounts/unmounts (handles conditional lists), and
// always commits with the latest onReorder.
UI.useDragReorder = function (options) {
  const cbRef = React.useRef(null);
  cbRef.current = options && options.onReorder;
  const cleanupRef = React.useRef(null);
  const setRef = React.useCallback((node) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (node) cleanupRef.current = attachDragReorder(node, () => cbRef.current, options);
  }, []);
  React.useEffect(() => () => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
  }, []);
  return setRef;
};

// Grip affordance for a reorderable row, replaces up/down arrows. The whole
// row is draggable; this is the visual cue. Pass `style` to tweak per use.
function DragHandle({ style } = {}) {
  return (
    <div aria-hidden="true" style={{
      flexShrink: 0, width: 22, height: 30,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: UI.inkFaint, cursor: 'grab', ...style,
    }}>
      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
        <circle cx="2" cy="3" r="1.3" /><circle cx="8" cy="3" r="1.3" />
        <circle cx="2" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" />
        <circle cx="2" cy="13" r="1.3" /><circle cx="8" cy="13" r="1.3" />
      </svg>
    </div>
  );
}

// ─── Horizontal drag-to-reorder (chip strips) ───────────────────────────────
// Same engine as attachDragReorder, along the X axis. Long-press on touch
// activates; a stray move before that fires bails immediately (any direction)
// so the page/strip scroll is never blocked. Drop-line is a vertical bar.
function attachDragReorderH(container, getCb, options) {
  return attachDragReorderAxis('h', container, getCb, options);
}

UI.useDragReorderH = function(options) {
  const cbRef = React.useRef(null);
  cbRef.current = options && options.onReorder;
  const cleanupRef = React.useRef(null);
  const setRef = React.useCallback((node) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (node) cleanupRef.current = attachDragReorderH(node, () => cbRef.current, options);
  }, []);
  React.useEffect(() => () => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
  }, []);
  return setRef;
};

// Container component that wires UI.useDragReorder to a list in one shot. Use
// when the list count is dynamic (one per .map iteration) so each instance owns
// its own hook. Mark children rows with data-reorder-item="true".
function ReorderList({ onReorder, longPressMs, moveTolerance, style, className, children }) {
  const ref = UI.useDragReorder({ onReorder, longPressMs, moveTolerance });
  return <div ref={ref} data-reorder-list="true" style={style} className={className}>{children}</div>;
}

// Shared drill-in row used by Settings and the Water tracker. Keeping it in
// the common UI layer avoids a lazy-module cycle between those screens.
function Row({ label, children, first = false }) {
  // The row's text is the switch's name, but nothing associates the two: a
  // screen reader on a bare Toggle reads "switch, on" with no idea of what.
  // Hand the label down rather than repeating it at every call site. Only
  // for a Toggle that has none of its own, so an explicit label always wins.
  const named = React.Children.map(children, c => (
    (React.isValidElement(c) && c.type === Toggle && !c.props.label && typeof label === 'string')
      ? React.cloneElement(c, { label })
      : c
  ));
  return (
    <>
      {!first && <div className="knurl" />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 0' }}>
        <span style={{ fontSize: 16, color: UI.inkSoft, fontFamily: UI.fontUi }}>{label}</span>
        {named}
      </div>
    </>
  );
}

function NavRow({ label, hint, onTap, first = false, accent = false }) {
  return (
    <>
      {!first && <div className="knurl" />}
      <button onClick={onTap} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', WebkitTapHighlightColor: 'transparent' }}>
        <span style={{ fontSize: 16, color: accent ? 'var(--accent)' : UI.inkSoft, fontFamily: UI.fontUi, fontWeight: accent ? 600 : 400 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hint != null && <span style={{ fontSize: 13, color: accent ? 'var(--accent)' : UI.inkFaint, fontFamily: UI.fontUi }}>{hint}</span>}
          <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={accent ? 'var(--accent)' : UI.inkFaint} strokeWidth="1.3" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>
        </div>
      </button>
    </>
  );
}

// Plate inventory data is shared by the lazy Train calculator and the lazy
// Settings inventory sheet. Keep it in the critical UI layer so either screen
// can open without depending on the other module.
const PLATES_KG  = [25, 20, 15, 10, 5, 2.5, 1.25, 0.75, 0.5, 0.25];
const PLATES_LBS = [55, 45, 35, 25, 10, 5, 2.5, 1.25];
const PLATE_COLORS_KG = { 25:'#c0392b', 20:'#2471a3', 15:'#d4ac0d', 10:'#1a1a1a', 5:'#1e8449', 2.5:'#ca6f1e', 1.25:'#148f77', 0.75:'#808b96', 0.5:'#808b96', 0.25:'#808b96' };
const PLATE_SIZE_KG = { 25: 70, 20: 64, 15: 60, 10: 56, 5: 48, 2.5: 42, 1.25: 36, 0.75: 30, 0.5: 30, 0.25: 30 };
const PLATE_COLORS_LBS = { 55:'#c0392b', 45:'#2471a3', 35:'#b7950b', 25:'#1e8449', 10:'#808b96', 5:'#1a1a1a', 2.5:'#ca6f1e', 1.25:'#808b96' };
const PLATE_SIZE_LBS = { 55: 70, 45: 64, 35: 56, 25: 48, 10: 42, 5: 36, 2.5: 30, 1.25: 28 };

// Shared block recap used by Home, Training and Library confirmation sheets.
function BlockRecap({ recap, evidence = null, escalation = 0 }) {
  const u = UI.unit();
  const tile = (k, v) => (
    <div style={{ background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 6, padding: '10px 12px' }}>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>{k}</div>
      <div style={{ fontFamily: UI.fontNum, fontSize: 20, fontWeight: 700, color: UI.ink }}>{v}</div>
    </div>
  );
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8, marginBottom: 16 }}>
        {tile('Weight PRs', recap.prCount)}
        {tile('Sessions', recap.sessionCount)}
      </div>
      {recap.loadPRs.length > 0 && (<>
        <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>WHAT YOU BUILT</div>
        <div className="knurl" style={{ marginBottom: 10 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {recap.loadPRs.map((g, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6 }}>
              <span style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
              <span style={{ fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: 'var(--accent)', flexShrink: 0, marginLeft: 10 }}>+{g.weightDelta} {u}</span>
            </div>
          ))}
        </div>
      </>)}
      {recap.setGains.some(g => g.setDelta > 0) && (<>
        <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>MORE SETS</div>
        <div className="knurl" style={{ marginBottom: 10 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {recap.setGains.filter(g => g.setDelta > 0).map((g, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6 }}>
              <span style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
              <span style={{ fontFamily: UI.fontNum, fontSize: 12, fontWeight: 700, color: 'var(--accent)', flexShrink: 0, marginLeft: 10 }}>+{g.setDelta} set{g.setDelta > 1 ? 's' : ''}</span>
            </div>
          ))}
        </div>
      </>)}
      {evidence && evidence.length > 0 && (<>
        <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>{escalation > 0 ? 'THE FATIGUE, STILL CLIMBING' : 'THE FATIGUE'}</div>
        <div className="knurl" style={{ marginBottom: 10 }} />
        <div>{evidence.map((e, i) => <div key={i} style={{ fontFamily: UI.fontUi, fontSize: 12.5, color: UI.inkSoft, lineHeight: 1.45, marginBottom: 6 }}>{e}</div>)}</div>
      </>)}
    </div>
  );
}

// Screenshot-only grid and divider primitives shared by every module that
// can export a poster. They must be available before any lazy screen runs.
function SvgGrid({ style }) {
  const knurlRgb = getComputedStyle(document.documentElement).getPropertyValue('--knurl-rgb').trim() || '236,228,208';
  const gridAlpha = getComputedStyle(document.documentElement).getPropertyValue('--grid-alpha').trim() || '0.16';
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none', ...style }}>
      <defs><pattern id="paperGridPattern" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M 22 0 L 0 0 0 22" fill="none" stroke={`rgba(${knurlRgb},${gridAlpha})`} strokeWidth="1" /></pattern></defs>
      <rect width="100%" height="100%" fill="url(#paperGridPattern)" />
    </svg>
  );
}

function KnurlCanvas({ style }) {
  return <canvas data-knurl="1" style={{ display: 'block', width: '100%', height: 3, ...style }} />;
}

const FEEL_LEVELS = [
  { key: 'easy', label: 'EASY', color: '#38bdf8', colorLight: '#0369a1' },
  { key: 'good', label: 'GOOD', color: '#4ade80', colorLight: '#15803d' },
  { key: 'hard', label: 'HARD', color: '#facc15', colorLight: '#a16207' },
  { key: 'very_hard', label: 'VERY HARD', color: '#f97316', colorLight: '#c2410c' },
  { key: 'max', label: 'MAX', color: '#ef4444', colorLight: '#b91c1c' },
];
function feelColorOf(f) { return f ? (isLightCanvasActive() ? f.colorLight : f.color) : UI.inkFaint; }
function feelColor(key) { return feelColorOf(FEEL_LEVELS.find(f => f.key === key)); }
function feelLabel(key) { return FEEL_LEVELS.find(f => f.key === key)?.label ?? null; }
const FEEL_ICONS = { easy: 'fa-face-smile', good: 'fa-bolt', hard: 'fa-fire', very_hard: 'fa-skull', max: 'fa-trophy' };
function FeelSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {FEEL_LEVELS.map(f => {
        const active = value === f.key;
        const fc = feelColorOf(f);
        return <button key={f.key} onClick={() => onChange(active ? null : f.key)} style={{
          flex: 1, padding: '9px 2px', borderRadius: 4, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
          border: `1px solid ${active ? fc : UI.hairStrong}`, background: active ? `${fc}22` : 'transparent', color: active ? fc : UI.inkSoft,
          fontFamily: UI.fontUi, fontSize: 9, fontWeight: active ? 600 : 400, letterSpacing: '0.07em', WebkitTapHighlightColor: 'transparent',
        }}><i className={`fa-solid ${FEEL_ICONS[f.key]}`} style={{ fontSize: 15 }} />{f.label}</button>;
      })}
    </div>
  );
}

// Shared comparison aliases. Keeping them in the critical UI layer avoids a
// coaching screen depending on the Library module for two pure store helpers.
const isImprovement = LB.isImprovement;
const isDecline = LB.isDecline;

Object.assign(window, {
  UI, Screen, TopBar, SubTabBar, TabBar, Btn, Card, Label, Stepper, Pill, Sheet, Empty, ImageLightbox,
  ChevronRight, ICON_HISTORY, ICON_BARBELL, ICON_CALENDAR,
  btnPrimary, btnGhost, useConfirm, DragHandle, ReorderList, Row, NavRow,
  PLATES_KG, PLATES_LBS, PLATE_COLORS_KG, PLATE_SIZE_KG, PLATE_COLORS_LBS, PLATE_SIZE_LBS,
  BlockRecap, SvgGrid, KnurlCanvas, FeelSelector, feelColor, feelLabel,
  FEEL_LEVELS, FEEL_ICONS, feelColorOf, isImprovement, isDecline,
  MUSCLES, WEEKDAYS, WEEKDAYS_FULL,
  // primitives
  Hairline, BracketFrame, Frame, SubDial, Bezel, ScreenHead, NumInput, Field, TextInput,
});
