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
  fontDisplay: '"Barlow Condensed", "Arial Narrow", sans-serif',
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
      padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 22px 14px',
      borderBottom: `1px solid ${UI.hairStrong}`,
      position: 'sticky', top: 0,
      background: 'rgba(var(--bg-rgb),0.92)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      zIndex: 5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
    </div>
  );
}

// ─── TabBar — floating dock with position indicator ──────────────────
const TAB_ICONS = {
  home: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5z"/>
    </svg>
  ),
  plan: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="1.5"/>
      <path d="M16 3v4M8 3v4M3 11h18"/>
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
};

function TabBar({ active, onChange, sidebar = false, currentUser = null }) {
  const tabs = [
    { id: 'home', label: 'Today' },
    { id: 'plan', label: 'Plan' },
    { id: 'lib',  label: 'Library' },
    { id: 'hist', label: 'History' },
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
          <div style={{ display: 'flex', flexDirection: 'column', padding: '0 12px', flex: 1, justifyContent: 'space-evenly' }}>
            {tabs.map(t => {
              const on = t.id === active;
              return (
                <button key={t.id} onClick={() => onChange(t.id)} style={{
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
                  <div style={{ transform: 'scale(1.4)', display: 'inline-flex', margin: '0 0 2px' }}>
                    {TAB_ICONS[t.id]}
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

  return (
    <div style={{
      flexShrink: 0,
      padding: `10px 12px calc(env(safe-area-inset-bottom, 8px) + 10px)`,
      background: 'transparent',
      zIndex: 20,
    }}>
      <div style={{
        background: 'rgba(var(--bg-rgb),0.92)',
        backdropFilter: 'blur(24px) saturate(130%)',
        WebkitBackdropFilter: 'blur(24px) saturate(130%)',
        border: `1px solid ${UI.hairStrong}`,
        borderRadius: 6,
        padding: 6,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', position: 'relative' }}>
        {idx >= 0 && (
          <div style={{
            position: 'absolute',
            left: `calc(${(idx * 100) / tabs.length}% + 4px)`,
            top: 0, bottom: 0,
            width: `calc(${100 / tabs.length}% - 8px)`,
            background: `rgba(var(--accent-rgb),0.15)`,
            border: `1px solid ${UI.goldSoft}`,
            borderRadius: 6,
            transition: 'left 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: 'none',
          }} />
        )}
        {idx >= 0 && (
          <div style={{
            position: 'absolute',
            left: `${(idx + 0.5) * 100 / tabs.length}%`,
            top: -3,
            transform: 'translateX(-50%)',
            width: 20, height: 2, borderRadius: 1,
            background: UI.gold,
            transition: 'left 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: 'none',
            zIndex: 2,
          }} />
        )}
        {tabs.map(t => {
          const on = t.id === active;
          return (
            <button key={t.id} onClick={() => onChange(t.id)} style={{
              flex: 1, background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '10px 6px 8px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              color: on ? UI.gold : UI.inkFaint,
              fontFamily: UI.fontUi,
              fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
              fontWeight: on ? 700 : 500,
              position: 'relative', zIndex: 1,
              transition: 'color 0.25s',
              WebkitTapHighlightColor: 'transparent',
            }}>
              {TAB_ICONS[t.id]}
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
const MUSCLES = ['Chest','Back','Shoulders','Biceps','Triceps','Abs','Quads','Hamstrings','Glutes','Calves','Forearms'];
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
function Sheet({ open, onClose, title, children }) {
  const [kbHeight, setKbHeight] = React.useState(0);
  React.useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKbHeight(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
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
        maxHeight: '88dvh', overflow: 'auto',
      }}>
        <div style={{ width: 36, height: 3, background: UI.hairStrong, borderRadius: 2, margin: '0 auto 16px' }} />
        {title && (
          <div style={{ fontFamily: UI.fontDisplay, fontSize: 28, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: UI.ink, marginBottom: 16 }}>
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
      <div style={{ fontFamily: UI.fontDisplay, fontSize: 26, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: UI.ink, marginBottom: 10 }}>{state.title}</div>
      <div style={{ fontSize: 14, color: UI.inkSoft, marginBottom: 22, lineHeight: 1.5 }}>{state.message}</div>
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

function TextInput({ value, onChange, placeholder, type = 'text', autoFocus }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <div style={{
      borderBottom: `1px solid ${focus ? UI.gold : UI.hairStrong}`,
      transition: 'border-color 0.2s',
      padding: '8px 0',
    }}>
      <input
        value={value} onChange={e => onChange(e.target.value)}
        type={type} placeholder={placeholder} autoFocus={autoFocus}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          width: '100%', background: 'transparent', border: 'none', outline: 'none',
          color: UI.ink, fontFamily: UI.fontUi, fontSize: 16, padding: 0,
        }}
      />
    </div>
  );
}

Object.assign(window, {
  UI, Screen, TopBar, TabBar, Btn, Card, Label, Stepper, Pill, Sheet, Empty,
  ChevronRight, ICON_HISTORY, ICON_BARBELL, ICON_CALENDAR,
  btnPrimary, btnGhost, useConfirm,
  MUSCLES, WEEKDAYS, WEEKDAYS_FULL,
  // primitives
  Hairline, BracketFrame, Frame, SubDial, Bezel, ScreenHead, NumInput, Field, TextInput,
});
