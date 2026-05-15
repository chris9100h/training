/* Hi-fi UI primitives — Haute Horlogerie redesign
   Preserves the original API (UI, Screen, TopBar, TabBar, Btn, Card, Label,
   Input, Stepper, Pill, Sheet, Empty, ChevronRight, icons, useConfirm,
   MUSCLES, btnPrimary/Ghost/Icon) so existing screens keep working — and
   adds new primitives (Frame, BracketFrame, SubDial, CrownButton, Bezel,
   ScreenHead, Hairline, TickRow, NumInput, Field, TextInput).
*/

const UI = {
  bg:       'var(--bg)',
  bgRaised: 'var(--bg-raised)',
  bgInset:  'var(--bg-inset)',
  ink:      'var(--ink)',
  inkSoft:  'var(--ink-soft)',
  inkFaint: 'var(--ink-faint)',
  inkLine:  'var(--hair)',
  hair:     'var(--hair)',
  hairStrong: 'var(--hair-strong)',
  gold:      'var(--gold)',
  goldLight: 'var(--gold-light)',
  goldDeep:  'var(--gold-deep)',
  goldSoft:  'var(--gold-soft)',
  goldFaint: 'var(--gold-faint)',
  danger:    'var(--danger)',
  ok:        'var(--ok)',
  fontUi:      '"Inter", system-ui, sans-serif',
  fontNum:     '"JetBrains Mono", ui-monospace, monospace',
  fontDisplay: '"Cormorant Garamond", Georgia, serif',
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
      borderBottom: `0.5px solid ${UI.hair}`,
      position: 'sticky', top: 0,
      background: 'rgba(7,6,10,0.85)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      zIndex: 5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onBack && (
          <button onClick={onBack} style={{
            width: 32, height: 32, borderRadius: '50%',
            border: `0.5px solid ${UI.hairStrong}`, background: 'transparent',
            color: UI.gold, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1 1 7l6 6"/></svg>
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {sub && (
            <div className="micro" style={{ marginBottom: 2 }}>{typeof sub === 'string' ? sub.toUpperCase() : sub}</div>
          )}
          <div style={{
            fontFamily: UI.fontDisplay, fontSize: 26, fontWeight: 400,
            color: UI.ink, lineHeight: 1.1, letterSpacing: '-0.01em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{title}</div>
        </div>
        {right}
      </div>
    </div>
  );
}

// ─── TabBar — floating dock with gold position indicator ────────────
const TAB_ICONS = {
  home: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5z"/>
    </svg>
  ),
  plan: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="1.5"/>
      <path d="M16 3v4M8 3v4M3 11h18"/>
    </svg>
  ),
  lib: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14H4z"/>
      <path d="M4 19h16M8 8h8M8 12h5"/>
    </svg>
  ),
  hist: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2.5"/>
    </svg>
  ),
};

function TabBar({ active, onChange }) {
  const tabs = [
    { id: 'home', label: 'Heute' },
    { id: 'plan', label: 'Plan' },
    { id: 'lib',  label: 'Archiv' },
    { id: 'hist', label: 'Historie' },
  ];
  const idx = tabs.findIndex(t => t.id === active);

  return (
    <div style={{
      flexShrink: 0,
      padding: `10px 12px calc(env(safe-area-inset-bottom, 8px) + 10px)`,
      background: 'transparent',
      zIndex: 20,
    }}>
      <div style={{
        background: 'rgba(7,6,10,0.88)',
        backdropFilter: 'blur(24px) saturate(140%)',
        WebkitBackdropFilter: 'blur(24px) saturate(140%)',
        border: `0.5px solid ${UI.hair}`,
        borderRadius: 999,
        padding: 6,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(236,228,208,0.05)',
      }}>
        {/* Inner wrapper — position: relative here so 100% = tabs' actual width, not outer padded width */}
        <div style={{ display: 'flex', position: 'relative' }}>
        {/* moving gold indicator pill — left/width now use inner width so centering is exact */}
        {idx >= 0 && (
          <div style={{
            position: 'absolute',
            left: `calc(${(idx * 100) / tabs.length}% + 4px)`,
            top: 0, bottom: 0,
            width: `calc(${100 / tabs.length}% - 8px)`,
            background: 'linear-gradient(180deg, rgba(201,169,97,0.18), rgba(201,169,97,0.06))',
            border: `0.5px solid ${UI.goldSoft}`,
            borderRadius: 999,
            transition: 'left 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: 'none',
          }} />
        )}
        {/* gold dot — centered at tab midpoint; top: -2 peeks above inner wrapper into the 6px outer padding */}
        {idx >= 0 && (
          <div style={{
            position: 'absolute',
            left: `${(idx + 0.5) * 100 / tabs.length}%`,
            top: -2,
            transform: 'translateX(-50%)',
            width: 3, height: 3, borderRadius: 2,
            background: UI.gold,
            boxShadow: `0 0 4px ${UI.gold}`,
            transition: 'left 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
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
              fontWeight: on ? 600 : 400,
              position: 'relative', zIndex: 1,
              transition: 'color 0.3s',
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
  background: `linear-gradient(180deg, var(--gold-light), var(--gold))`,
  color: '#0a0805',
  border: '0.5px solid var(--gold-deep)',
  borderRadius: 999,
  padding: '14px 22px', minHeight: 48,
  fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  cursor: 'pointer',
  boxShadow: '0 8px 24px rgba(201,169,97,0.30)',
  WebkitTapHighlightColor: 'transparent',
};

const btnGhost = {
  background: 'transparent',
  color: UI.ink,
  border: `0.5px solid ${UI.hairStrong}`,
  borderRadius: 999,
  padding: '14px 22px', minHeight: 48,
  fontFamily: UI.fontUi, fontSize: 13, fontWeight: 500,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

const btnIcon = {
  background: 'transparent', border: 'none',
  color: UI.ink, padding: 4, cursor: 'pointer', fontSize: 18,
  WebkitTapHighlightColor: 'transparent',
};

function Btn({ children, kind = 'primary', style = {}, ...rest }) {
  const base = kind === 'primary' ? btnPrimary : kind === 'icon' ? btnIcon : btnGhost;
  return <button style={{ ...base, ...style }} {...rest}>{children}</button>;
}

// ─── Card ───────────────────────────────────────────────────────────
function Card({ children, accent = false, style = {}, ...rest }) {
  return (
    <div style={{
      background: accent
        ? `linear-gradient(180deg, rgba(201,169,97,0.06), rgba(201,169,97,0.01))`
        : 'rgba(236,228,208,0.02)',
      border: `0.5px solid ${accent ? UI.goldSoft : UI.hair}`,
      borderRadius: 14,
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
      color: UI.inkFaint, fontFamily: UI.fontUi, fontWeight: 500,
      marginBottom: 6, ...style,
    }}>{children}</div>
  );
}

// ─── Constants ──────────────────────────────────────────────────────
const MUSCLES = ['Brust','Rücken','Schultern','Bizeps','Trizeps','Bauch','Quads','Hamstrings','Glutes','Waden','Unterarme'];
const WEEKDAYS = ['Mo','Di','Mi','Do','Fr','Sa','So'];
const WEEKDAYS_FULL = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];

// ─── Input ──────────────────────────────────────────────────────────
function Input({ label, value, onChange, type = 'text', placeholder, autoFocus, style = {}, suffix, uppercase }) {
  const doUpper = uppercase !== undefined ? uppercase : type === 'text';
  const [focused, setFocused] = React.useState(false);
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && <Label>{label}</Label>}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 6,
        background: UI.bgInset,
        border: `0.5px solid ${focused ? UI.goldSoft : UI.hair}`,
        borderRadius: 10,
        padding: '12px 14px',
        boxShadow: focused ? `0 0 0 3px rgba(201,169,97,0.08)` : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}>
        <input
          value={value ?? ''}
          onChange={e => onChange(doUpper ? e.target.value.toUpperCase() : e.target.value)}
          type={type} placeholder={placeholder} autoFocus={autoFocus}
          inputMode={type === 'number' ? 'decimal' : undefined}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
            color: UI.ink, fontFamily: type === 'number' ? UI.fontNum : UI.fontUi,
            fontSize: 16, padding: 0,
            textTransform: doUpper ? 'uppercase' : 'none',
            letterSpacing: doUpper ? '0.04em' : 'normal',
          }}
        />
        {suffix && <span style={{ color: UI.inkFaint, fontSize: 12, fontFamily: UI.fontNum }}>{suffix}</span>}
      </div>
    </label>
  );
}

// ─── Stepper ────────────────────────────────────────────────────────
function Stepper({ value, onChange, step = 2.5, min = 0, suffix, big = false }) {
  const round = (v) => Math.round(v * 1000) / 1000;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
      <button onClick={() => onChange(Math.max(min, round((+value || 0) - step)))} style={{
        width: big ? 44 : 36, height: big ? 44 : 36, padding: 0,
        borderRadius: '50%', boxShadow: `inset 0 0 0 0.5px ${UI.hairStrong}`,
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
        borderRadius: '50%', boxShadow: `inset 0 0 0 0.5px ${UI.hairStrong}`,
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
      padding: '3px 9px', borderRadius: 999,
      fontSize: 9, letterSpacing: '0.14em',
      fontFamily: UI.fontUi, fontWeight: 500, textTransform: 'uppercase',
      background: gold ? UI.goldFaint : 'transparent',
      color: gold ? UI.gold : UI.inkSoft,
      border: `0.5px solid ${gold ? UI.goldSoft : UI.hair}`,
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
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      paddingBottom: kbHeight,
      animation: 'sheet-fade 0.18s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 540, boxSizing: 'border-box',
        background: UI.bgRaised,
        borderRadius: '24px 24px 0 0',
        border: `0.5px solid ${UI.hairStrong}`, borderBottom: 'none',
        boxShadow: '0 -20px 60px rgba(0,0,0,0.5)',
        padding: `16px 22px ${kbHeight > 0 ? 18 : 'calc(env(safe-area-inset-bottom, 8px) + 22px)'}`,
        animation: 'sheet-up 0.22s ease',
        maxHeight: '85vh', overflow: 'auto',
      }}>
        <div style={{ width: 40, height: 3, background: UI.hairStrong, borderRadius: 4, margin: '0 auto 16px' }} />
        {title && (
          <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, fontWeight: 400, color: UI.ink, marginBottom: 16 }}>
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
      <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, marginBottom: 6 }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: UI.inkSoft, lineHeight: 1.5 }}>{sub}</div>}
      {action && <div style={{ marginTop: 22 }}>{action}</div>}
    </div>
  );
}

// ─── Chevron ────────────────────────────────────────────────────────
function ChevronRight({ color }) {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="none" stroke={color || UI.gold} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1l6 6-6 6"/>
    </svg>
  );
}

// ─── Icon glyphs ────────────────────────────────────────────────────
const ICON_HISTORY = (
  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 3"/>
  </svg>
);
const ICON_BARBELL = (
  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="12" x2="18" y2="12"/>
    <rect x="1" y="9.5" width="3" height="5" rx="1"/>
    <rect x="20" y="9.5" width="3" height="5" rx="1"/>
    <rect x="4" y="10.5" width="2" height="3" rx="0.5"/>
    <rect x="18" y="10.5" width="2" height="3" rx="0.5"/>
  </svg>
);
const ICON_CALENDAR = (
  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2.5"/>
    <path d="M16 2v4M8 2v4M3 10h18"/>
    <circle cx="8" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/>
  </svg>
);

// ─── useConfirm ─────────────────────────────────────────────────────
function useConfirm() {
  const [state, setState] = React.useState(null);
  const confirm = (message, { title = 'Bestätigen?', ok = 'OK', cancel = 'Abbrechen', danger = false } = {}) =>
    new Promise(resolve => setState({ message, title, ok, cancel, danger, resolve }));
  const close = (result) => { state?.resolve(result); setState(null); };
  const el = state && (
    <Sheet open={true} onClose={() => close(false)}>
      <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, marginBottom: 10 }}>{state.title}</div>
      <div style={{ fontSize: 14, color: UI.inkSoft, marginBottom: 22, lineHeight: 1.5 }}>{state.message}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn kind="ghost" onClick={() => close(false)} style={{ flex: 1 }}>{state.cancel}</Btn>
        <Btn onClick={() => close(true)} style={{
          flex: 2,
          ...(state.danger ? { background: UI.danger, borderColor: 'rgba(200,116,105,0.6)', boxShadow: '0 8px 24px rgba(200,116,105,0.25)' } : {}),
        }}>{state.ok}</Btn>
      </div>
    </Sheet>
  );
  return [el, confirm];
}

// ─── New primitives — watch-dial elements ───────────────────────────

function Hairline({ vertical = false, color, style = {} }) {
  return <div style={{
    background: color || UI.hair,
    width: vertical ? '0.5px' : '100%',
    height: vertical ? '100%' : '0.5px',
    flexShrink: 0,
    ...style,
  }} />;
}

function TickRow({ count = 12, gold = false, style = {} }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', ...style }}>
      {Array.from({ length: count }).map((_, i) => {
        const major = i === 0 || i === count - 1 || (count >= 11 && i === Math.floor(count / 2));
        return <div key={i} style={{
          width: major ? 1 : 0.5,
          height: major ? 8 : 4,
          background: gold ? UI.gold : UI.hairStrong,
          opacity: gold ? 0.8 : 1,
        }} />;
      })}
    </div>
  );
}

// Frame with corner brackets — watch-case aesthetic
function BracketFrame({ children, gold = false, style = {}, padding = 22, ...rest }) {
  const c = gold ? UI.gold : UI.hairStrong;
  const len = 14;
  const Corner = ({ pos }) => {
    const s = { position: 'absolute', width: len, height: len, pointerEvents: 'none' };
    if (pos === 'tl') return <div style={{ ...s, top: 0, left: 0, borderTop: `0.5px solid ${c}`, borderLeft: `0.5px solid ${c}` }} />;
    if (pos === 'tr') return <div style={{ ...s, top: 0, right: 0, borderTop: `0.5px solid ${c}`, borderRight: `0.5px solid ${c}` }} />;
    if (pos === 'bl') return <div style={{ ...s, bottom: 0, left: 0, borderBottom: `0.5px solid ${c}`, borderLeft: `0.5px solid ${c}` }} />;
    if (pos === 'br') return <div style={{ ...s, bottom: 0, right: 0, borderBottom: `0.5px solid ${c}`, borderRight: `0.5px solid ${c}` }} />;
  };
  return (
    <div style={{ position: 'relative', padding, ...style }} {...rest}>
      <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
      {children}
    </div>
  );
}

// Frame component — light hairline box
function Frame({ children, accent = false, style = {}, padding = 18, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: accent
        ? `linear-gradient(180deg, rgba(201,169,97,0.06), rgba(201,169,97,0.01))`
        : 'rgba(236,228,208,0.02)',
      border: `0.5px solid ${accent ? UI.goldSoft : UI.hair}`,
      borderRadius: 14,
      padding,
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    }}>{children}</div>
  );
}

// Chronograph sub-dial — circular metric
function SubDial({ label, value, sub, size = 110, gold = false, style = {} }) {
  const borderColor = gold ? UI.goldSoft : UI.hairStrong;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      boxShadow: `inset 0 0 0 0.5px ${borderColor}`,
      background: 'radial-gradient(circle at 50% 30%, rgba(236,228,208,0.04), transparent 65%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: size * 0.05,
      flexShrink: 0, boxSizing: 'border-box',
      ...style,
    }} className="guilloche">
      <span className="micro" style={{ fontSize: Math.max(7, size * 0.09), color: gold ? UI.gold : UI.inkFaint, lineHeight: 1 }}>{label}</span>
      <span className="num" style={{ fontSize: String(value).length > 5 ? size * 0.17 : String(value).length > 3 ? size * 0.22 : size * 0.28, color: gold ? UI.gold : UI.ink, fontWeight: 500, lineHeight: 1 }}>{value}</span>
      {sub && <span className="micro" style={{ fontSize: Math.max(7, size * 0.08), lineHeight: 1 }}>{sub}</span>}
    </div>
  );
}

// Big gold "Crown" button — primary CTA, concentric like a watch crown
function CrownButton({ children, onClick, size = 180, disabled, style = {} }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: size, height: size, borderRadius: '50%',
      border: 'none', cursor: disabled ? 'default' : 'pointer',
      background: `radial-gradient(circle at 50% 35%, var(--gold-light) 0%, var(--gold) 35%, var(--gold-deep) 100%)`,
      color: '#0a0805', position: 'relative',
      boxShadow: '0 20px 60px rgba(201,169,97,0.30), 0 0 0 0.5px rgba(201,169,97,0.6), inset 0 1px 0 rgba(255,240,200,0.4), inset 0 -8px 24px rgba(0,0,0,0.25)',
      opacity: disabled ? 0.3 : 1,
      animation: disabled ? 'none' : 'pulseGold 3.5s ease-out infinite',
      WebkitTapHighlightColor: 'transparent',
      ...style,
    }}>
      <div style={{ position: 'absolute', inset: 8, borderRadius: '50%', boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.18)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 16, borderRadius: '50%', boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.12)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        {children}
      </div>
    </button>
  );
}

// "Bezel" — section divider with hairlines and label
function Bezel({ children, style = {} }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px', ...style }}>
      <div style={{ flex: 1, height: '0.5px', background: UI.hair }} />
      <span className="micro" style={{ color: UI.inkFaint, whiteSpace: 'nowrap' }}>{children}</span>
      <div style={{ flex: 1, height: '0.5px', background: UI.hair }} />
    </div>
  );
}

// Engraved screen header with REF tag — used by detail views
function ScreenHead({ ref_, title, sub, right, onBack, style = {} }) {
  return (
    <div style={{
      flexShrink: 0, padding: 'calc(env(safe-area-inset-top, 0px) + 18px) 22px 14px',
      position: 'relative', ...style,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        {ref_ && <span className="micro" style={{ color: UI.inkFaint }}>{ref_}</span>}
        {sub && <span className="micro" style={{ color: UI.inkFaint }}>{sub}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {onBack && (
          <button onClick={onBack} style={{
            width: 32, height: 32, borderRadius: '50%',
            border: `0.5px solid ${UI.hairStrong}`, background: 'transparent',
            color: UI.gold, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M7 1 1 7l6 6"/></svg>
          </button>
        )}
        <div style={{ flex: 1, fontFamily: UI.fontDisplay, fontSize: 30, fontWeight: 400, lineHeight: 1.05, color: UI.ink, letterSpacing: '-0.01em' }}>
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
      borderBottom: `0.5px solid ${focus ? UI.gold : UI.hairStrong}`,
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
  UI, Screen, TopBar, TabBar, Btn, Card, Label, Input, Stepper, Pill, Sheet, Empty,
  ChevronRight, ICON_HISTORY, ICON_BARBELL, ICON_CALENDAR,
  btnPrimary, btnGhost, btnIcon, useConfirm,
  MUSCLES, WEEKDAYS, WEEKDAYS_FULL,
  // new primitives
  Hairline, TickRow, BracketFrame, Frame, SubDial, CrownButton, Bezel, ScreenHead, NumInput, Field, TextInput,
});
