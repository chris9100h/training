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
      position: 'sticky', top: 0, background: UI.bg, zIndex: 5,
    }}>
      {onBack && (
        <button onClick={onBack} style={{ ...btnIcon, fontSize: 22, lineHeight: 1 }}>‹</button>
      )}
      <div style={{ flex: 1, minWidth: 0, minHeight: 36, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {sub && <div style={{ fontSize: 10, letterSpacing: '0.12em', color: UI.inkFaint, fontFamily: UI.fontNum, textTransform: 'uppercase' }}>{sub}</div>}
        <div style={{ fontSize: 18, fontWeight: 600, color: UI.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      </div>
      {right}
    </div>
  );
}

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
      background: '#0c0c0c',
      padding: '10px 14px calc(env(safe-area-inset-bottom, 8px) + 10px)',
      display: 'flex', justifyContent: 'space-around',
      zIndex: 20,
    }}>
      {tabs.map(t => {
        const on = t.id === active;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            background: 'none', border: 'none', padding: '4px 14px',
            color: on ? UI.gold : UI.inkSoft, fontFamily: UI.fontUi,
            fontSize: 12, letterSpacing: '0.03em', fontWeight: on ? 600 : 500,
            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: 5,
              background: on ? UI.gold : 'transparent',
            }} />
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
};
const btnGhost = {
  background: 'transparent', color: UI.ink,
  border: `1px solid ${UI.inkLine}`, borderRadius: 12,
  padding: '12px 16px', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 500,
  cursor: 'pointer', minHeight: 48,
};
const btnIcon = {
  background: 'transparent', border: 'none',
  color: UI.ink, padding: 4, cursor: 'pointer', fontSize: 18,
};

function Btn({ children, kind = 'primary', style = {}, ...rest }) {
  const base = kind === 'primary' ? btnPrimary : kind === 'icon' ? btnIcon : btnGhost;
  return <button style={{ ...base, ...style }} {...rest}>{children}</button>;
}

function Card({ children, accent = false, style = {}, ...rest }) {
  return (
    <div style={{
      background: accent ? `linear-gradient(180deg, ${UI.goldFaint}, transparent)` : UI.bgRaised,
      border: `1px solid ${accent ? UI.goldSoft : UI.inkLine}`,
      borderRadius: 14, padding: 16,
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
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      {label && <Label>{label}</Label>}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6,
        background: UI.bgInset, border: `1px solid ${UI.inkLine}`,
        borderRadius: 10, padding: '12px 14px',
      }}>
        <input
          value={value ?? ''}
          onChange={e => onChange(doUpper ? e.target.value.toUpperCase() : e.target.value)}
          type={type}
          placeholder={placeholder}
          autoFocus={autoFocus}
          inputMode={type === 'number' ? 'decimal' : undefined}
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
        width: '100%', maxWidth: 540,
        background: UI.bgRaised, borderRadius: '20px 20px 0 0',
        border: `1px solid ${UI.inkLine}`, borderBottom: 'none',
        padding: `14px 18px ${kbHeight > 0 ? 18 : 'calc(env(safe-area-inset-bottom, 8px) + 18px)'}`,
        animation: 'sheet-up 0.22s ease',
        maxHeight: '85vh', overflow: 'auto',
      }}>
        <div style={{ width: 36, height: 4, background: UI.inkLine, borderRadius: 4, margin: '0 auto 12px' }} />
        {title && <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

function Empty({ title, sub, action }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: UI.inkSoft }}>
      <div style={{ fontSize: 16, color: UI.ink, marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 13 }}>{sub}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

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

Object.assign(window, { UI, Screen, TopBar, TabBar, Btn, Card, Label, Input, Stepper, Pill, Sheet, Empty, btnPrimary, btnGhost, btnIcon, useConfirm, MUSCLES });
