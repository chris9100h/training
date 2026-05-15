/* Hi-fi UI primitives — Black & Gold */

const UI = {
  bg: '#0a0a0a',
  bgRaised: '#141414',
  bgInset: '#1d1d1d',
  ink: '#f0ece0',
  inkSoft: 'rgba(240,236,224,0.62)',
  inkFaint: 'rgba(240,236,224,0.32)',
  inkLine: 'rgba(240,236,224,0.10)',
  gold: '#d4a437',
  goldLight: '#e8be5a',
  goldSoft: 'rgba(212,164,55,0.40)',
  goldFaint: 'rgba(212,164,55,0.10)',
  danger: '#c87469',
  ok: '#7fb069',
  fontUi: '"Inter", system-ui, sans-serif',
  fontNum: '"JetBrains Mono", ui-monospace, monospace',
};

function Screen({ children, scroll = true, style = {} }) {
  return (
    <div style={{
      width: '100%', flex: 1, minHeight: 0,
      background: UI.bg, color: UI.ink, fontFamily: UI.fontUi,
      display: 'flex', flexDirection: 'column',
      overflow: scroll ? 'auto' : 'hidden',
      animation: 'screenIn 0.22s ease',
      ...style,
    }}>{children}</div>
  );
}

function TopBar({ title, sub, onBack, right }) {
  return (
    <div style={{
      padding: 'calc(14px + env(safe-area-inset-top, 0px)) 18px 12px',
      display: 'flex', alignItems: 'center', gap: 12,
      borderBottom: `1px solid ${UI.inkLine}`,
      position: 'sticky', top: 0,
      background: 'rgba(10,10,10,0.85)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      zIndex: 5,
    }}>
      {onBack && (
        <button onClick={onBack} style={{
          ...btnIcon, padding: '4px 6px 4px 2px',
          display: 'flex', alignItems: 'center', color: UI.gold,
          WebkitTapHighlightColor: 'transparent',
        }}>
          <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8.5 1.5 1.5 9l7 7.5"/>
          </svg>
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0, minHeight: 36, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {sub && <div style={{ fontSize: 10, letterSpacing: '0.12em', color: UI.inkFaint, fontFamily: UI.fontNum, textTransform: 'uppercase' }}>{sub}</div>}
        <div style={{ fontSize: 18, fontWeight: 600, color: UI.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      </div>
      {right}
    </div>
  );
}

const TAB_ICONS = {
  home: (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H15v-5H9v5H4a1 1 0 0 1-1-1V10.5z"/>
    </svg>
  ),
  plan: (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2.5"/>
      <path d="M16 2v4M8 2v4M3 10h18"/>
    </svg>
  ),
  lib: (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14H4z"/>
      <path d="M4 19h16M8 7h8M8 11.5h5"/>
    </svg>
  ),
  hist: (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 7v5l3.5 3"/>
    </svg>
  ),
};

function TabBar({ active, onChange }) {
  const tabs = [
    { id: 'home', label: 'Home' },
    { id: 'plan', label: 'Plan' },
    { id: 'lib',  label: 'Library' },
    { id: 'hist', label: 'History' },
  ];
  return (
    <div style={{
      flexShrink: 0,
      borderTop: `1px solid ${UI.inkLine}`,
      background: 'rgba(12,12,12,0.88)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      padding: '6px 8px calc(env(safe-area-inset-bottom, 8px) + 6px)',
      display: 'flex', justifyContent: 'space-around',
      zIndex: 20,
    }}>
      {tabs.map(t => {
        const on = t.id === active;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            background: 'none', border: 'none', padding: '6px 18px',
            color: on ? UI.gold : UI.inkSoft, fontFamily: UI.fontUi,
            fontSize: 10, letterSpacing: '0.02em', fontWeight: on ? 600 : 400,
            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            WebkitTapHighlightColor: 'transparent',
            transition: 'color 0.15s',
          }}>
            <div style={{
              padding: '4px 14px', borderRadius: 14, marginBottom: 2,
              background: on ? UI.goldFaint : 'transparent',
              border: `1px solid ${on ? 'rgba(212,164,55,0.22)' : 'transparent'}`,
              transition: 'background 0.18s, border-color 0.18s',
            }}>
              {TAB_ICONS[t.id]}
            </div>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const btnPrimary = {
  background: UI.gold, color: '#0a0a0a',
  border: 'none', borderRadius: 12,
  padding: '14px 18px', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 600,
  letterSpacing: '0.01em', cursor: 'pointer', minHeight: 48,
  WebkitTapHighlightColor: 'transparent',
};
const btnGhost = {
  background: 'transparent', color: UI.ink,
  border: `1px solid ${UI.inkLine}`, borderRadius: 12,
  padding: '12px 16px', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 500,
  cursor: 'pointer', minHeight: 48,
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

function Card({ children, accent = false, style = {}, ...rest }) {
  return (
    <div style={{
      background: accent ? `linear-gradient(160deg, rgba(212,164,55,0.12), transparent 60%)` : UI.bgRaised,
      border: `1px solid ${accent ? UI.goldSoft : UI.inkLine}`,
      borderRadius: 16, padding: 16,
      boxShadow: accent
        ? `0 4px 24px rgba(212,164,55,0.1), 0 1px 4px rgba(0,0,0,0.4)`
        : `0 2px 12px rgba(0,0,0,0.35)`,
      ...style,
    }} {...rest}>{children}</div>
  );
}

function Label({ children, style = {} }) {
  return <div style={{
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: UI.inkFaint, fontFamily: UI.fontNum, marginBottom: 4, ...style,
  }}>{children}</div>;
}

const MUSCLES = ['Brust','Rücken','Schultern','Bizeps','Trizeps','Bauch','Quads','Hamstrings','Glutes','Waden','Unterarme'];
const WEEKDAYS = ['Mo','Di','Mi','Do','Fr','Sa','So'];
const WEEKDAYS_FULL = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];

function Input({ label, value, onChange, type = 'text', placeholder, autoFocus, style = {}, suffix, uppercase }) {
  const doUpper = uppercase !== undefined ? uppercase : type === 'text';
  const [focused, setFocused] = React.useState(false);
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      {label && <Label>{label}</Label>}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 6,
        background: UI.bgInset,
        border: `1px solid ${focused ? 'rgba(212,164,55,0.5)' : UI.inkLine}`,
        borderRadius: 10, padding: '12px 14px',
        boxShadow: focused ? '0 0 0 3px rgba(212,164,55,0.08)' : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}>
        <input
          value={value ?? ''}
          onChange={e => onChange(doUpper ? e.target.value.toUpperCase() : e.target.value)}
          type={type}
          placeholder={placeholder}
          autoFocus={autoFocus}
          inputMode={type === 'number' ? 'decimal' : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
            color: UI.ink, fontFamily: type === 'number' ? UI.fontNum : UI.fontUi,
            fontSize: 16, padding: 0,
            textTransform: doUpper ? 'uppercase' : 'none',
          }}
        />
        {suffix && <span style={{ color: UI.inkFaint, fontSize: 12, fontFamily: UI.fontNum }}>{suffix}</span>}
      </div>
    </label>
  );
}

function Stepper({ value, onChange, step = 2.5, min = 0, suffix, big = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
      <button onClick={() => onChange(Math.max(min, +(((+value || 0) - step).toFixed(2))))} style={{
        ...btnGhost, width: big ? 44 : 36, height: big ? 44 : 36, padding: 0,
        borderRadius: '50%', fontSize: big ? 22 : 18, minHeight: 0, fontWeight: 400,
      }}>−</button>
      <div style={{
        flex: 1, textAlign: 'center', fontFamily: UI.fontNum,
        fontSize: big ? 36 : 22, color: UI.ink, minWidth: big ? 100 : 64,
      }}>{value ?? '—'}{suffix && <span style={{ fontSize: big ? 14 : 11, color: UI.inkFaint, marginLeft: 4 }}>{suffix}</span>}</div>
      <button onClick={() => onChange(+(((+value || 0) + step).toFixed(2)))} style={{
        ...btnGhost, width: big ? 44 : 36, height: big ? 44 : 36, padding: 0,
        borderRadius: '50%', fontSize: big ? 22 : 18, minHeight: 0, fontWeight: 400,
      }}>+</button>
    </div>
  );
}

function Pill({ children, gold = false, style = {}, ...rest }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '4px 10px', borderRadius: 999,
      fontSize: 11, letterSpacing: '0.04em',
      fontFamily: UI.fontNum, textTransform: 'uppercase',
      background: gold ? UI.goldFaint : 'transparent',
      color: gold ? UI.gold : UI.inkSoft,
      border: `1px solid ${gold ? UI.goldSoft : UI.inkLine}`,
      ...style,
    }} {...rest}>{children}</span>
  );
}

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
        background: UI.bgRaised, borderRadius: '24px 24px 0 0',
        border: `1px solid ${UI.inkLine}`, borderBottom: 'none',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
        padding: `14px 18px ${kbHeight > 0 ? 18 : 'calc(env(safe-area-inset-bottom, 8px) + 18px)'}`,
        animation: 'sheet-up 0.22s ease',
        maxHeight: '85vh', overflow: 'auto',
      }}>
        <div style={{ width: 40, height: 4, background: 'rgba(240,236,224,0.18)', borderRadius: 4, margin: '0 auto 16px' }} />
        {title && <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

function Empty({ title, sub, action, icon }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: UI.inkSoft }}>
      {icon && <div style={{ marginBottom: 14, color: UI.inkLine, display: 'flex', justifyContent: 'center' }}>{icon}</div>}
      <div style={{ fontSize: 16, color: UI.ink, marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 13 }}>{sub}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

function ChevronRight({ color }) {
  return (
    <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke={color || UI.gold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 1.5 8.5 9l-7 7.5"/>
    </svg>
  );
}

const ICON_HISTORY = (
  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 3"/>
  </svg>
);
const ICON_BARBELL = (
  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="12" x2="18" y2="12"/>
    <rect x="1" y="9.5" width="3" height="5" rx="1"/>
    <rect x="20" y="9.5" width="3" height="5" rx="1"/>
    <rect x="4" y="10.5" width="2" height="3" rx="0.5"/>
    <rect x="18" y="10.5" width="2" height="3" rx="0.5"/>
  </svg>
);
const ICON_CALENDAR = (
  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2.5"/>
    <path d="M16 2v4M8 2v4M3 10h18"/>
    <circle cx="8" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/>
  </svg>
);

function useConfirm() {
  const [state, setState] = React.useState(null);

  const confirm = (message, { title = 'Bestätigen?', ok = 'OK', cancel = 'Abbrechen', danger = false } = {}) =>
    new Promise(resolve => setState({ message, title, ok, cancel, danger, resolve }));

  const close = (result) => { state?.resolve(result); setState(null); };

  const el = state && (
    <Sheet open={true} onClose={() => close(false)}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{state.title}</div>
      <div style={{ fontSize: 14, color: UI.inkSoft, marginBottom: 18, lineHeight: 1.5 }}>{state.message}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn kind="ghost" onClick={() => close(false)} style={{ flex: 1 }}>{state.cancel}</Btn>
        <Btn onClick={() => close(true)} style={{ flex: 2, ...(state.danger ? { background: UI.danger, borderColor: UI.danger } : {}) }}>{state.ok}</Btn>
      </div>
    </Sheet>
  );

  return [el, confirm];
}

Object.assign(window, { UI, Screen, TopBar, TabBar, Btn, Card, Label, Input, Stepper, Pill, Sheet, Empty, ChevronRight, ICON_HISTORY, ICON_BARBELL, ICON_CALENDAR, btnPrimary, btnGhost, btnIcon, useConfirm, MUSCLES });
