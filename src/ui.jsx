/* Bodybuilding redesign — Golden Era aesthetic.
   Exposes: UI, Screen, TopBar, TabBar, Btn, Card, Label, Stepper, Pill,
   Sheet, Empty, ChevronRight, ICON_HISTORY, ICON_BARBELL, ICON_CALENDAR,
   btnPrimary/Ghost, useConfirm, MUSCLES, WEEKDAYS, WEEKDAYS_FULL,
   Hairline, BracketFrame, Frame, SubDial, Bezel, ScreenHead,
   NumInput, Field, TextInput. */

const UI = {
  bg:       'var(--bg)',
  bgRaised: 'var(--bg-raised)',
  bgInset:  'var(--bg-inset)',
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
  fontUi:      '"Inter", system-ui, sans-serif',
  fontNum:     '"JetBrains Mono", ui-monospace, monospace',
  fontDisplay: '"Big Shoulders Display", "Arial Narrow", sans-serif',
};

// ─── Screen ─────────────────────────────────────────────────────────
function Screen({ children, scroll = true, style = {} }) {
  return (
    <div style={{
      width: '100%', flex: 1, minHeight: 0,
      background: UI.bg, color: UI.ink, fontFamily: UI.fontUi,
      display: 'flex', flexDirection: 'column',
      overflow: scroll ? 'auto' : 'hidden',
      ...style,
    }}>{children}</div>
  );
}

// ─── TopBar ─────────────────────────────────────────────────────────
function TopBar({ title, sub, onBack, right }) {
  return (
    <div style={{
      flexShrink: 0,
      padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 22px 0',
      position: 'sticky', top: 0,
      background: 'rgba(var(--bg-rgb),0.92)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      zIndex: 5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 12 }}>
        {onBack && (
          <button onClick={onBack} style={{
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
          <div style={{
            fontFamily: UI.fontDisplay, fontSize: 30, fontWeight: 700,
            color: UI.ink, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{title}</div>
        </div>
        {right}
      </div>
      <div className="knurl" style={{ marginLeft: -22, marginRight: -22 }} />
    </div>
  );
}

// ─── SubTabBar — segmented control for in-screen sub-navigation ───────
// Used e.g. to switch Plan ⇄ Library inside the merged "Plan" tab.
function SubTabBar({ tabs, active, onChange, style = {} }) {
  return (
    <div style={{ flexShrink: 0, display: 'flex', gap: 4, padding: '10px 22px 2px', ...style }}>
      {tabs.map(t => {
        const on = t.id === active;
        return (
          <button key={t.id} onClick={() => !on && onChange(t.id)} style={{
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

// ─── TabBar — floating dock with position indicator ──────────────────
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
};

function TabBar({ active, onChange, sidebar = false, currentUser = null, showCoaching = false, coachingBadge = null, showHealth = false }) {
  const tabs = [
    { id: 'home', label: 'Train' },
    { id: 'plan', label: 'Plan' },
    { id: 'hist', label: 'History' },
    ...(showHealth ? [{ id: 'health', label: 'Health' }] : []),
    ...(showCoaching ? [{ id: 'coaching', label: 'Coaching' }] : []),
  ];
  const idx = tabs.findIndex(t => t.id === active);
  const [switchModal, setSwitchModal] = React.useState(false);

  if (sidebar) {
    const currentEmail = currentUser?.email || '';
    const currentName  = currentUser?.name  || currentEmail.split('@')[0] || '—';
    const qs           = window.LB || {};
    const qsIcon = (email, size = 26) => {
      if (email === 'office@btc-prime.biz') return <i className="fa-solid fa-dumbbell" style={{ fontSize: size }} />;
      if (email === 'anja.knamm@gmail.com') return <span style={{ fontSize: size + 2, lineHeight: 1 }}>🩷</span>;
      return null;
    };
    const otherEmail   = (qs.QS_EMAILS || []).find(e => e !== currentEmail);
    const isQsUser     = (qs.QS_EMAILS || []).includes(currentEmail);
    const hasOther     = otherEmail ? (qs.hasQuickSwitchSession?.(otherEmail) ?? false) : false;
    const otherName    = otherEmail ? (qs.getQsName?.(otherEmail) || otherEmail.split('@')[0]) : '';

    return (
      <>
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
              const on = t.id === active;
              const badge = t.id === 'coaching' ? coachingBadge : null;
              return (
                <button key={t.id} data-tour={`tab-${t.id}`} onClick={() => onChange(t.id)} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '22px 16px',
                  borderRadius: 6,
                  background: on
                    ? `rgba(var(--accent-rgb),0.12)`
                    : 'rgba(236,228,208,0.025)',
                  border: `1px solid ${on ? UI.goldSoft : UI.hairStrong}`,
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
                    {TAB_ICONS[t.id]}
                    {badge?.live && (
                      <div style={{ position: 'absolute', top: -2, right: -2, width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'pulseDot 1.5s ease-in-out infinite', border: '1.5px solid var(--bg)' }} />
                    )}
                    {!badge?.live && badge?.count > 0 && (
                      <div style={{ position: 'absolute', top: -4, right: -6, minWidth: 14, height: 14, borderRadius: 7, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid var(--bg)' }}>
                        <span style={{ fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, color: '#0a0805', lineHeight: 1 }}>{badge.count > 9 ? '9+' : badge.count}</span>
                      </div>
                    )}
                  </div>
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
          {isQsUser && otherEmail && (
            <div style={{ padding: '0 14px' }}>
              <div className="knurl" style={{ marginBottom: 12 }} />
              <button onClick={() => setSwitchModal(true)} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: '12px 14px', borderRadius: 6,
                background: 'rgba(236,228,208,0.03)',
                border: `1px solid ${UI.hairStrong}`,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 4, flexShrink: 0,
                  background: `rgba(var(--accent-rgb),0.12)`,
                  border: `1px solid ${UI.goldSoft}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: UI.fontDisplay, fontSize: 18, color: UI.gold, fontWeight: 700,
                }}>
                  {qsIcon(currentEmail, 16) ?? currentName[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {currentName}
                  </div>
                  <div className="micro" style={{ marginTop: 2 }}>Switch User</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={UI.inkFaint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M3 8h14M3 8l4-4M3 8l4 4M21 16H7M21 16l-4-4M21 16l-4 4"/>
                </svg>
              </button>
            </div>
          )}
        </div>

        {switchModal && isQsUser && otherEmail && (
          <div onClick={() => setSwitchModal(false)} style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 40,
            animation: 'sheet-fade 0.15s ease',
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              width: '100%', maxWidth: 520,
              background: UI.bgRaised,
              border: `1px solid ${UI.hairStrong}`,
              borderRadius: 4,
              padding: '32px 28px 22px',
              boxShadow: '0 40px 100px rgba(0,0,0,0.8)',
              animation: 'fadeUp 0.22s ease',
            }}>
              <div className="micro" style={{ marginBottom: 8 }}>Accounts</div>
              <div style={{ fontFamily: UI.fontDisplay, fontSize: 32, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: UI.ink, marginBottom: 24 }}>Switch User</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{
                  flex: 1,
                  background: `rgba(var(--accent-rgb),0.10)`,
                  border: `1px solid ${UI.goldSoft}`,
                  borderRadius: 6,
                  padding: '28px 20px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: 4,
                    background: `rgba(var(--accent-rgb),0.15)`,
                    border: `1px solid ${UI.goldSoft}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: UI.fontDisplay, fontSize: 32, color: UI.gold, fontWeight: 700,
                  }}>
                    {qsIcon(currentEmail) ?? currentName[0]?.toUpperCase()}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: UI.fontDisplay, fontSize: 24, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: UI.ink, lineHeight: 1.1, marginBottom: 8 }}>{currentName}</div>
                    <div className="micro-gold">Active</div>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    if (!hasOther) return;
                    setSwitchModal(false);
                    try {
                      await qs.quickSwitch(otherEmail);
                      window.location.reload();
                    } catch (e) {
                      console.error('Quick switch failed', e);
                    }
                  }}
                  style={{
                    flex: 1,
                    background: hasOther ? 'rgba(236,228,208,0.04)' : 'transparent',
                    border: `1px solid ${hasOther ? UI.hairStrong : UI.hair}`,
                    borderRadius: 6,
                    padding: '28px 20px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                    cursor: hasOther ? 'pointer' : 'default',
                    WebkitTapHighlightColor: 'transparent',
                    opacity: hasOther ? 1 : 0.4,
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{
                    width: 64, height: 64, borderRadius: 4,
                    background: 'rgba(236,228,208,0.06)',
                    border: `1px solid ${UI.hairStrong}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: UI.fontDisplay, fontSize: 32, color: UI.inkSoft, fontWeight: 700,
                  }}>
                    {qsIcon(otherEmail) ?? otherName[0]?.toUpperCase()}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: UI.fontDisplay, fontSize: 24, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: hasOther ? UI.inkSoft : UI.inkFaint, lineHeight: 1.1, marginBottom: 8 }}>{otherName}</div>
                    <div className="micro" style={{ color: hasOther ? UI.inkFaint : 'rgba(var(--danger-rgb),0.7)' }}>
                      {hasOther ? 'Tap to switch' : 'Set up in Settings'}
                    </div>
                  </div>
                </button>
              </div>
              <button onClick={() => setSwitchModal(false)} style={{ ...btnPrimary, width: '100%', marginTop: 18 }}>Cancel</button>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Bottom dock — "gold key" active indicator ──────────────────────
  // A floating industrial bar: the active tab reads like a pressed mechanical
  // key — a solid gold plate that slides under the active icon (dark glyph on
  // gold), topped by a thin gold rail. Inactive tabs are faint icon+label.
  const n = tabs.length;
  // Geometry. The gold plate is absolutely positioned (its size doesn't affect
  // the label), while the in-flow ICON_H is kept tight so the label sits right
  // under the glyph. PLATE/PAD_TOP/ICON_H are tuned so the plate stays centred
  // on the glyph and its bottom edge meets (never overlaps) the label.
  const KEY = 30;        // gold plate width/height (square, radius-6 key)
  const KEY_TOP = 5;     // plate offset from the row top
  const PAD_TOP = 4;     // button top padding
  const ICON_H = 22;     // icon-zone height — drives the icon→label gap
  return (
    <div style={{
      flexShrink: 0,
      padding: `10px 12px calc(env(safe-area-inset-bottom, 8px) + 10px)`,
      background: 'transparent',
      zIndex: 20,
    }}>
      <div style={{
        position: 'relative',
        background: 'rgba(var(--bg-rgb),0.92)',
        backdropFilter: 'blur(24px) saturate(130%)',
        WebkitBackdropFilter: 'blur(24px) saturate(130%)',
        border: `1px solid ${UI.hairStrong}`,
        borderRadius: 8,
        padding: '6px 6px 3px',
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
      }}>
        {/* knurled top edge — grip texture, signature of the kit */}
        <div className="knurl" style={{ position: 'absolute', top: 6, left: 14, right: 14 }} />
        <div style={{ display: 'flex', position: 'relative', paddingTop: 5 }}>
          {/* Sliding gold key plate behind the active icon */}
          {idx >= 0 && (
            <div style={{
              position: 'absolute',
              left: `${(idx + 0.5) * 100 / n}%`,
              top: KEY_TOP,
              transform: 'translateX(-50%)',
              width: KEY, height: KEY, borderRadius: 6,
              background: 'linear-gradient(180deg, var(--accent-light), var(--accent))',
              border: '1px solid var(--accent-deep)',
              boxShadow: '0 5px 16px rgba(var(--accent-rgb),0.35), inset 0 1px 0 rgba(255,240,200,0.45)',
              transition: 'left 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              pointerEvents: 'none',
              zIndex: 0,
            }} />
          )}
          {/* Top rail above the active plate — mechanical selector cue */}
          {idx >= 0 && (
            <div style={{
              position: 'absolute',
              left: `${(idx + 0.5) * 100 / n}%`,
              top: KEY_TOP - 5,
              transform: 'translateX(-50%)',
              width: 24, height: 2, borderRadius: 1,
              background: UI.gold,
              transition: 'left 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              pointerEvents: 'none',
              zIndex: 2,
            }} />
          )}
          {tabs.map(t => {
            const on = t.id === active;
            const badge = t.id === 'coaching' ? coachingBadge : null;
            return (
              <button key={t.id} data-tour={`tab-${t.id}`} onClick={() => onChange(t.id)} style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer',
                padding: `${PAD_TOP}px 4px 2px`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                color: on ? UI.gold : UI.inkFaint,
                fontFamily: UI.fontUi,
                fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
                fontWeight: on ? 700 : 500,
                position: 'relative', zIndex: 1,
                transition: 'color 0.25s',
                WebkitTapHighlightColor: 'transparent',
              }}>
                {/* Icon zone — matches the key plate footprint so the glyph
                    sits centred on the gold plate when active. */}
                <div style={{
                  position: 'relative', width: KEY, height: ICON_H,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: on ? '#0a0805' : UI.inkFaint,
                  transform: on ? 'scale(1.08)' : 'scale(1)',
                  transition: 'color 0.2s, transform 0.25s cubic-bezier(0.34,1.4,0.64,1)',
                }}>
                  {TAB_ICONS[t.id]}
                  {badge?.live && (
                    <div style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: on ? '#0a0805' : 'var(--accent)', animation: 'pulseDot 1.5s ease-in-out infinite', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--bg)'}` }} />
                  )}
                  {!badge?.live && badge?.count > 0 && (
                    <div style={{ position: 'absolute', top: 3, right: 1, minWidth: 14, height: 14, borderRadius: 7, background: on ? '#0a0805' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--bg)'}`, padding: '0 3px' }}>
                      <span style={{ fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, color: on ? 'var(--accent)' : '#0a0805', lineHeight: 1 }}>{badge.count > 9 ? '9+' : badge.count}</span>
                    </div>
                  )}
                </div>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Buttons ────────────────────────────────────────────────────────
const btnPrimary = {
  background: `linear-gradient(180deg, var(--accent-light), var(--accent))`,
  color: '#0a0805',
  border: '1px solid var(--accent-deep)',
  borderRadius: 6,
  padding: '14px 24px', minHeight: 48,
  fontFamily: '"Inter", system-ui, sans-serif', fontSize: 13, fontWeight: 700,
  letterSpacing: '0.12em', textTransform: 'uppercase',
  cursor: 'pointer',
  boxShadow: '0 6px 20px rgba(var(--accent-rgb),0.30)',
  WebkitTapHighlightColor: 'transparent',
};

const btnGhost = {
  background: 'transparent',
  color: 'var(--ink)',
  border: `1px solid var(--hair-strong)`,
  borderRadius: 6,
  padding: '14px 22px', minHeight: 48,
  fontFamily: '"Inter", system-ui, sans-serif', fontSize: 13, fontWeight: 600,
  letterSpacing: '0.10em', textTransform: 'uppercase',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

function Btn({ children, kind = 'primary', style = {}, ...rest }) {
  const base = kind === 'primary' ? btnPrimary : btnGhost;
  return <button style={{ ...base, ...style }} {...rest}>{children}</button>;
}

// ─── Card ───────────────────────────────────────────────────────────
function Card({ children, accent = false, style = {}, ...rest }) {
  return (
    <div style={{
      background: accent
        ? `rgba(var(--accent-rgb),0.06)`
        : 'rgba(236,228,208,0.02)',
      border: `1px solid ${accent ? UI.goldSoft : UI.hairStrong}`,
      borderRadius: 6,
      padding: 16,
      ...style,
    }} {...rest}>{children}</div>
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
const MUSCLES = ['Abs','Back','Biceps','Calves','Chest','Forearms','Glutes','Hamstrings','Quads','Shoulders','Triceps'];
const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const WEEKDAYS_FULL = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ─── Stepper ────────────────────────────────────────────────────────
function Stepper({ value, onChange, step = 2.5, min = 0, suffix, big = false }) {
  const round = (v) => Math.round(v * 1000) / 1000;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
      <button onClick={() => onChange(Math.max(min, round((+value || 0) - step)))} style={{
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
      <button onClick={() => onChange(round((+value || 0) + step))} style={{
        width: big ? 44 : 36, height: big ? 44 : 36, padding: 0,
        borderRadius: 4, border: `1px solid ${UI.hairStrong}`,
        background: 'transparent', color: UI.ink, cursor: 'pointer',
        fontSize: big ? 22 : 18, lineHeight: 1, fontWeight: 300,
        WebkitTapHighlightColor: 'transparent',
      }}>+</button>
    </div>
  );
}

// ─── Pill ───────────────────────────────────────────────────────────
function Pill({ children, gold = false, style = {}, ...rest }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 8px', borderRadius: 3,
      fontSize: 9, letterSpacing: '0.14em',
      fontFamily: UI.fontUi, fontWeight: 600, textTransform: 'uppercase',
      background: gold ? UI.goldFaint : 'transparent',
      color: gold ? UI.gold : UI.inkSoft,
      border: `1px solid ${gold ? UI.goldSoft : UI.hairStrong}`,
      ...style,
    }} {...rest}>{children}</span>
  );
}

// ─── Sheet ──────────────────────────────────────────────────────────
function Sheet({ open, onClose, title, titleColor, children }) {
  const [kbHeight, setKbHeight] = React.useState(0);
  const [vvHeight, setVvHeight] = React.useState(window.innerHeight);
  React.useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // Only treat the innerHeight↔visualViewport gap as keyboard height while a
      // field is actually focused. Otherwise a persistent iOS viewport offset
      // (the safe-area shift bug) would be misread as a keyboard, padding a black
      // gap below the sheet.
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      setKbHeight(typing ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0);
      setVvHeight(vv.height);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, [open]);

  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      paddingBottom: kbHeight,
      animation: 'sheet-fade 0.18s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540, boxSizing: 'border-box',
        background: UI.bgRaised,
        borderRadius: '6px 6px 0 0',
        border: `1px solid ${UI.hairStrong}`, borderBottom: 'none',
        boxShadow: '0 -16px 48px rgba(0,0,0,0.6)',
        padding: `16px 22px ${kbHeight > 0 ? 18 : 'calc(env(safe-area-inset-bottom, 8px) + 22px)'}`,
        animation: 'sheet-up 0.22s ease',
        maxHeight: kbHeight > 0 ? `${vvHeight - 32}px` : '88dvh', overflow: 'auto', overscrollBehavior: 'contain',
      }}>
        <div style={{ width: 36, height: 3, background: UI.hairStrong, borderRadius: 2, margin: '0 auto 16px' }} />
        {title && (
          <div style={{ fontFamily: UI.fontDisplay, fontSize: 28, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: titleColor || UI.ink, marginBottom: 16 }}>
            {title}
          </div>
        )}
        {children}
      </div>
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
function useConfirm() {
  const [state, setState] = React.useState(null);
  const confirm = (message, { title = 'Confirm?', ok = 'OK', cancel = 'Cancel', danger = false } = {}) =>
    new Promise(resolve => setState({ message, title, ok, cancel, danger, resolve }));
  const close = (result) => { state?.resolve(result); setState(null); };
  const el = state && (
    <Sheet open={true} onClose={() => close(false)}>
      <div style={{ fontFamily: UI.fontDisplay, fontSize: 26, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: UI.ink, marginBottom: 10, textAlign: 'center' }}>{state.title}</div>
      <div style={{ fontSize: 14, color: UI.inkSoft, marginBottom: 22, lineHeight: 1.5, textAlign: 'center' }}>{state.message}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn kind="ghost" onClick={() => close(false)} style={{ flex: 1 }}>{state.cancel}</Btn>
        <Btn onClick={() => close(true)} style={{
          flex: 2,
          ...(state.danger ? { background: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.6)', boxShadow: '0 6px 20px rgba(var(--danger-rgb),0.25)' } : {}),
        }}>{state.ok}</Btn>
      </div>
    </Sheet>
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

// Heavy corner brackets — industrial equipment aesthetic
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
    <div style={{ position: 'relative', padding, ...style }} {...rest}>
      <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
      {children}
    </div>
  );
}

// Frame — bordered container
function Frame({ children, accent = false, style = {}, padding = 18, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: accent
        ? `rgba(var(--accent-rgb),0.06)`
        : 'rgba(236,228,208,0.02)',
      border: `1px solid ${accent ? UI.goldSoft : UI.hairStrong}`,
      borderRadius: 6,
      padding,
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    }}>{children}</div>
  );
}

// Stat block — replaces circular watch sub-dial with a flat, bold stat display
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
  return (
    <div style={{
      flexShrink: 0, padding: 'calc(env(safe-area-inset-top, 0px) + 18px) 22px 14px',
      position: 'relative', ...style,
    }}>
      {sub && (
        <div style={{ marginBottom: 10 }}>
          <span className="micro" style={{ color: UI.inkFaint }}>{sub}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {onBack && (
          <button onClick={onBack} style={{
            width: 32, height: 32, borderRadius: 4,
            border: `1px solid ${UI.hairStrong}`, background: 'transparent',
            color: UI.gold, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 1 1 7l6 6"/></svg>
          </button>
        )}
        <div style={{ flex: 1, fontFamily: UI.fontDisplay, fontSize: 32, fontWeight: 700, lineHeight: 1, color: UI.ink, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {title}
        </div>
        {right}
      </div>
    </div>
  );
}

function NumInput({ value, onChange, placeholder = '—', disabled, style = {} }) {
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
        const n = raw === '' ? null : parseFloat(raw.replace(',', '.'));
        setRaw(n != null && !isNaN(n) ? String(n).replace('.', ',') : '');
      }}
      onChange={e => {
        setRaw(e.target.value);
        const n = e.target.value === '' ? null : parseFloat(e.target.value.replace(',', '.'));
        if (e.target.value === '' || !isNaN(n)) onChange(n ?? null);
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

function Field({ label, children, style = {} }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', autoFocus, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const inputRef = React.useRef(null);
  const savedSel = React.useRef(null);
  const handleChange = (e) => {
    if (type !== 'password') {
      try { savedSel.current = { start: e.target.selectionStart, end: e.target.selectionEnd }; } catch(_) {}
    }
    onChange(e.target.value);
  };
  React.useLayoutEffect(() => {
    if (type === 'password') return;
    const sel = savedSel.current;
    savedSel.current = null;
    if (sel && sel.start != null && inputRef.current && document.activeElement === inputRef.current) {
      try { inputRef.current.setSelectionRange(sel.start, sel.end); } catch(e) {}
    }
  });
  return (
    <div style={{
      borderBottom: `1px solid ${focus ? UI.gold : UI.hairStrong}`,
      transition: 'border-color 0.2s',
      padding: '8px 0',
    }}>
      <input
        ref={inputRef}
        value={value} onChange={handleChange}
        type={type} placeholder={placeholder} autoFocus={autoFocus}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        {...rest}
        style={{
          width: '100%', background: 'transparent', border: 'none', outline: 'none',
          color: UI.ink, fontFamily: UI.fontUi, fontSize: 16, padding: 0,
        }}
      />
    </div>
  );
}

// Weight unit label ('kg' or 'lbs'). Pure display label — the stored number is
// the same regardless of unit (lbs users enter lbs directly, no conversion).
// Kept in sync with store.settings.unit by app.jsx on every render.
UI.unit = () => (typeof window !== 'undefined' && window.__UNIT) || 'kg';

// Chart Y-axis domain with breathing room. Pads by 5% of the visible value
// SPAN (max − min) — not of the value itself — so a point keeps a consistent
// gap from the edge no matter how far the data sits from zero. (Value-based
// padding fails when the min is small relative to the span: e.g. steps 25k–101k
// gave the 25k point only ~1.5% headroom and it looked glued to the bottom.)
//   • top    = dataMax + 5% of span   (unless a fixed `max` is supplied)
//   • bottom = dataMin − 5% of span, clamped at 0 — every metric here is
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
  else bottom = Math.max(0, dataMin - pad);
  return { min: bottom, max: top, range: (top - bottom) || 1 };
};

// ─── Drag-to-reorder ────────────────────────────────────────────────
// Pointer-based reordering for vertical lists, tuned to feel like the
// fddb_dash drag: long-press to pick up on touch, a small move-threshold
// on mouse, a floating ghost that tracks the finger, and an accent
// drop-line showing where the row will land. Built for the no-build React
// setup — it drives the DOM imperatively for the duration of the drag (no
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
function attachDragReorder(container, getCb, options) {
  const opts = options || {};
  const LONG_PRESS_MS = opts.longPressMs != null ? opts.longPressMs : 220;
  const MOVE_TOLERANCE = opts.moveTolerance != null ? opts.moveTolerance : 8;
  const SCROLL_EDGE = 64;
  let state = null;
  let rafId = null;

  // Reorderable rows that belong to THIS list (closest list ancestor is us —
  // guards against any nested reorder list inside a row).
  const items = () => Array.prototype.slice
    .call(container.querySelectorAll('[data-reorder-item]'))
    .filter(el => el.closest('[data-reorder-list]') === container);

  function scrollParent() {
    let n = container;
    while (n && n !== document.body && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
      n = n.parentElement;
    }
    return null; // fall back to the window
  }

  function placeDropLine(y) {
    if (!state.dropLine) {
      state.dropLine = document.createElement('div');
      state.dropLine.className = 'reorder-drop-line';
      document.body.appendChild(state.dropLine);
    }
    const r = container.getBoundingClientRect();
    state.dropLine.style.left = r.left + 'px';
    state.dropLine.style.width = r.width + 'px';
    state.dropLine.style.top = (y - 1) + 'px';
  }

  function updateTarget(y) {
    const list = items();
    let insertIdx = list.length;
    let lineY = null;
    for (let k = 0; k < list.length; k++) {
      const r = list[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) { insertIdx = k; lineY = r.top - 3; break; }
    }
    if (lineY === null) {
      const last = list[list.length - 1];
      lineY = last ? last.getBoundingClientRect().bottom + 3 : container.getBoundingClientRect().top;
    }
    state.insertIdx = insertIdx;
    placeDropLine(lineY);
  }

  function moveGhost(x, y) {
    if (!state || !state.ghost) return;
    state.ghost.style.transform =
      'translate(' + (x - state.offsetX - state.baseLeft) + 'px,' +
      (y - state.offsetY - state.baseTop) + 'px) scale(1.02)';
  }

  // Edge auto-scroll: nudge the nearest scroll container (or window) when the
  // pointer hovers near its top/bottom edge, so long lists stay reachable.
  function tickScroll() {
    if (!state || !state.started) { rafId = null; return; }
    const y = state.lastY || 0;
    const sp = state.scrollParent;
    const el = sp || document.scrollingElement || document.documentElement;
    const top = sp ? sp.getBoundingClientRect().top : 0;
    const bottom = sp ? sp.getBoundingClientRect().bottom : window.innerHeight;
    const max = el.scrollHeight - el.clientHeight;
    let moved = false;
    if (y < top + SCROLL_EDGE && el.scrollTop > 0) {
      const t = Math.min(1, (top + SCROLL_EDGE - y) / SCROLL_EDGE);
      el.scrollTop = Math.max(0, el.scrollTop - Math.round(2 + t * 18));
      moved = true;
    } else if (y > bottom - SCROLL_EDGE && el.scrollTop < max) {
      const t = Math.min(1, (y - (bottom - SCROLL_EDGE)) / SCROLL_EDGE);
      el.scrollTop = Math.min(max, el.scrollTop + Math.round(2 + t * 18));
      moved = true;
    }
    if (moved) updateTarget(y);
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
    state.started = true;
    document.body.classList.add('reorder-dragging');
    moveGhost(x, y);
    updateTarget(y);
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
      } else if (dist > 12) {
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
    updateTarget(ev.clientY);
  }

  function onUp() {
    if (!state) return;
    if (!state.started) { teardown(); return; }
    const from = state.fromIdx;
    let to = state.insertIdx;
    if (to > from) to -= 1;
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

// Grip affordance for a reorderable row — replaces up/down arrows. The whole
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
// Same architecture as attachDragReorder but works along the X axis.
// Long-press on touch activates; vertical swipe bails immediately so the page
// scroll is never blocked. Drop-line is a vertical accent bar.
function attachDragReorderH(container, getCb, options) {
  const opts = options || {};
  const LONG_PRESS_MS = opts.longPressMs != null ? opts.longPressMs : 220;
  const MOVE_TOLERANCE = opts.moveTolerance != null ? opts.moveTolerance : 8;
  const SCROLL_EDGE = 48;
  let state = null;
  let rafId = null;

  const items = () => Array.prototype.slice
    .call(container.querySelectorAll('[data-reorder-item]'))
    .filter(el => el.closest('[data-reorder-list]') === container);

  function scrollParent() {
    let n = container;
    while (n && n !== document.body && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1) return n;
      n = n.parentElement;
    }
    return null;
  }

  function placeDropLine(x) {
    if (!state.dropLine) {
      state.dropLine = document.createElement('div');
      state.dropLine.className = 'reorder-drop-line-h';
      document.body.appendChild(state.dropLine);
    }
    const r = state.src.getBoundingClientRect();
    state.dropLine.style.top = r.top + 'px';
    state.dropLine.style.height = r.height + 'px';
    state.dropLine.style.left = (x - 1) + 'px';
  }

  function updateTarget(x) {
    const list = items();
    let insertIdx = list.length;
    let lineX = null;
    for (let k = 0; k < list.length; k++) {
      const r = list[k].getBoundingClientRect();
      if (x < r.left + r.width / 2) { insertIdx = k; lineX = r.left - 3; break; }
    }
    if (lineX === null) {
      const last = list[list.length - 1];
      lineX = last ? last.getBoundingClientRect().right + 3 : container.getBoundingClientRect().left;
    }
    state.insertIdx = insertIdx;
    placeDropLine(lineX);
  }

  function moveGhost(x, y) {
    if (!state || !state.ghost) return;
    state.ghost.style.transform =
      'translate(' + (x - state.offsetX - state.baseLeft) + 'px,' +
      (y - state.offsetY - state.baseTop) + 'px) scale(1.02)';
  }

  function tickScroll() {
    if (!state || !state.started) { rafId = null; return; }
    const x = state.lastX || 0;
    const sp = state.scrollParent;
    const el = sp || container;
    const left = sp ? sp.getBoundingClientRect().left : 0;
    const right = sp ? sp.getBoundingClientRect().right : window.innerWidth;
    const max = el.scrollWidth - el.clientWidth;
    let moved = false;
    if (x < left + SCROLL_EDGE && el.scrollLeft > 0) {
      const t = Math.min(1, (left + SCROLL_EDGE - x) / SCROLL_EDGE);
      el.scrollLeft = Math.max(0, el.scrollLeft - Math.round(2 + t * 12));
      moved = true;
    } else if (x > right - SCROLL_EDGE && el.scrollLeft < max) {
      const t = Math.min(1, (x - (right - SCROLL_EDGE)) / SCROLL_EDGE);
      el.scrollLeft = Math.min(max, el.scrollLeft + Math.round(2 + t * 12));
      moved = true;
    }
    if (moved) updateTarget(x);
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
    state.started = true;
    document.body.classList.add('reorder-dragging');
    moveGhost(x, y);
    updateTarget(x);
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
    const dx = Math.abs(ev.clientX - state.startX);
    const dy = Math.abs(ev.clientY - state.startY);
    const dist = Math.hypot(dx, dy);
    if (!state.started) {
      if (state.pointerType === 'mouse') {
        if (dist > MOVE_TOLERANCE) beginDrag(state.startX, state.startY);
      } else if (dist > 8) {
        // Any movement before long-press fires → user is scrolling, cancel.
        // (Previously only cancelled on dy>dx, letting horizontal scroll keep
        //  the timer alive — causing accidental reorders mid-scroll.)
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
    updateTarget(ev.clientX);
  }

  function onUp() {
    if (!state) return;
    if (!state.started) { teardown(); return; }
    const from = state.fromIdx;
    let to = state.insertIdx;
    if (to > from) to -= 1;
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

Object.assign(window, {
  UI, Screen, TopBar, SubTabBar, TabBar, Btn, Card, Label, Stepper, Pill, Sheet, Empty,
  ChevronRight, ICON_HISTORY, ICON_BARBELL, ICON_CALENDAR,
  btnPrimary, btnGhost, useConfirm, DragHandle, ReorderList,
  MUSCLES, WEEKDAYS, WEEKDAYS_FULL,
  // primitives
  Hairline, BracketFrame, Frame, SubDial, Bezel, ScreenHead, NumInput, Field, TextInput,
});
