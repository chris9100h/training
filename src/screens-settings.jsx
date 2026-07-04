/* Settings screen — appearance, training, data, account, admin */

const { useState: useStateSet, useEffect: useEffectSet, useRef: useRefSet } = React;

// ─── Shared helpers ────────────────────────────────────────────────────

const fmtSec = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Short "time since" label for the admin sign-up feed.
const fmtAgo = (iso) => LB.timeAgo(iso, { capDays: 7 });

// Boxed input look shared by the settings sheets' plain text/password/email/
// select inputs (password/email change, OTP, admin tools, ...). Spread and
// override for a sheet's specific padding/fontSize/etc.
const SETTINGS_INPUT_STYLE = {
  background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4,
  padding: '10px 14px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink,
  outline: 'none', width: '100%', boxSizing: 'border-box',
};
// Same look, larger radius, for the multi-line support-ticket textareas.
const SETTINGS_TEXTAREA_STYLE = {
  width: '100%', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`,
  borderRadius: 6, padding: '10px 12px', color: UI.ink, fontFamily: UI.fontUi,
  fontSize: 14, outline: 'none', resize: 'none', boxSizing: 'border-box', lineHeight: 1.5,
};

// Admin support-inbox ticket row — active and archived are the same shape,
// the archived variant just mutes it (dimmed colors/opacity, smaller text,
// no unread dot / "no messages yet" placeholder / timestamp).
function AdminTicketRow({ t, archived = false, catLabel, onClick }) {
  const statusColor = { open: UI.danger, in_progress: UI.gold, resolved: UI.inkFaint };
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        background: archived ? UI.bgInset : UI.bgRaised,
        border: `0.5px solid ${UI.hair}`,
        borderLeft: `3px solid ${archived ? UI.inkGhost : (statusColor[t.support_status] || UI.hairStrong)}`,
        borderRadius: 8, cursor: 'pointer', textAlign: 'left', padding: '12px 14px', marginBottom: 8,
        WebkitTapHighlightColor: 'transparent', display: 'flex', flexDirection: 'column',
        gap: archived ? 4 : 5, opacity: archived ? 0.7 : 1,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: archived ? 13 : 14, fontWeight: 600, color: archived ? UI.inkSoft : UI.ink, fontFamily: UI.fontUi, flex: 1 }}>{t.client_name || t.client_email}</span>
        {!archived && Number(t.unread_count) > 0 && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', flexShrink: 0, animation: 'pulseDot 1.5s ease-in-out infinite' }} />}
        <span className="micro" style={{ color: archived ? UI.inkGhost : (statusColor[t.support_status] || UI.inkFaint) }}>{(t.support_status || (archived ? 'resolved' : 'open')).replace('_', ' ').toUpperCase()}</span>
        {t.support_category && <span className="micro" style={{ color: archived ? UI.inkGhost : UI.inkFaint }}>{catLabel}</span>}
      </div>
      {t.last_message_body ? (
        <div style={{ fontSize: archived ? 11 : 12, color: archived ? UI.inkGhost : UI.inkSoft, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.last_message_body}</div>
      ) : (
        !archived && <div style={{ fontSize: 12, color: UI.inkGhost, fontFamily: UI.fontUi, fontStyle: 'italic' }}>No messages yet</div>
      )}
      {!archived && t.last_message_at && (
        <div className="micro" style={{ color: UI.inkGhost }}>{new Date(t.last_message_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {new Date(t.last_message_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
      )}
    </button>
  );
}

function UserArchivedSection({ tickets, renderTicket }) {
  const [open, setOpen] = useStateSet(false);
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent' }}>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: 9 }} />
        Archived ({tickets.length})
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>{tickets.map(renderTicket)}</div>}
    </div>
  );
}

function Row({ label, children, first = false }) {
  return (
    <>
      {!first && <div className="knurl" />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 0' }}>
        <span style={{ fontSize: 16, color: UI.inkSoft, fontFamily: UI.fontUi }}>{label}</span>
        {children}
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

const accentBtn = { background: 'rgba(var(--accent-rgb),0.10)', border: '0.5px solid rgba(var(--accent-rgb),0.22)', color: 'var(--accent)', padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent', flexShrink: 0 };

const isIosDevice = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

// Every settings sheet renders its title in the accent color.
function SettingsSheet(props) {
  return <Sheet titleColor="var(--accent)" {...props} />;
}

function FullSheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: UI.bg, display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0, background: UI.bgRaised }}>
        <div style={{ flex: 1, fontFamily: UI.fontDisplay, fontSize: 22, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>{title}</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, color: UI.inkFaint, WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', boxSizing: 'border-box', maxWidth: 540, width: '100%', alignSelf: 'center' }}>
        {children}
      </div>
    </div>
  );
}

// ─── HOW TO SHEET ────────────────────────────────────────────────────
function HowToSheet({ open, onClose }) {
  const [osPickerOpen, setOsPickerOpen] = useStateSet(false);
  const handleClose = () => { onClose(); setOsPickerOpen(false); };
  const btnStyle = {
    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '14px 0', WebkitTapHighlightColor: 'transparent',
  };
  const chevron = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={UI.inkFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>;
  return (
    <>
      <SettingsSheet open={open} onClose={handleClose} title="How to…">
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
          <button onClick={() => { onClose(); window.__startTour?.('createPlan'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Create a plan &amp; exercise</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Guided tour of plan creation and the training loop</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('doWorkout'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Do a workout</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Logging sets, keyboard, plate calc, navigation and ending a session</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('quickActions'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Use Quick Actions</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Swipe down on Home for fast-access logging shortcuts</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('healthTab'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Use the Health tab</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Daily logging, macro targets, cardio tracking, and week overview</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('cardioPlans'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Build a cardio plan</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Manual weekly targets, or a progressive plan toward a goal</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('statusModes'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Deload, sick &amp; vacation</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Take it easier without losing progress or skewing your stats</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('customize'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Customize the app</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Appearance, rest timers, equipment, progression &amp; tempo</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('coaching'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Be a coach / client</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Invites, weekly check-ins, macros and notes — coach and client side</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => setOsPickerOpen(true)} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Install as app</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Add Zane to your home screen — works on iPhone and Android</div>
            </div>
            {chevron}
          </button>
        </div>
      </SettingsSheet>
      <SettingsSheet open={osPickerOpen && open} onClose={() => setOsPickerOpen(false)} title="Install as app">
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
          <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5, padding: '4px 0 12px' }}>
            Which device are you installing on?
          </div>
          <button onClick={() => { setOsPickerOpen(false); onClose(); window.__startTour?.('installPwaIos'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>iPhone / iPad</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Safari → Share button → Add to Home Screen</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { setOsPickerOpen(false); onClose(); window.__startTour?.('installPwaAndroid'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Android</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Chrome → three-dot menu → Add to Home screen</div>
            </div>
            {chevron}
          </button>
        </div>
      </SettingsSheet>
    </>
  );
}

// ─── CHANGELOG SHEET ─────────────────────────────────────────────────
function ChangelogSheet({ open, onClose }) {
  const [selected, setSelected] = useStateSet(null);
  const handleClose = () => { onClose(); setSelected(null); };
  return (
    <>
      <SettingsSheet open={open} onClose={handleClose} title="Changelog">
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
          {(window.WHATS_NEW || []).map((entry, i) => (
            <div key={entry.id}>
              <button onClick={() => setSelected(entry)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', WebkitTapHighlightColor: 'transparent' }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span className="micro" style={{ color: UI.inkFaint }}>{entry.id}</span>
                  <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.3" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>
                </div>
              </button>
              {i < (window.WHATS_NEW || []).length - 1 && <div className="knurl" />}
            </div>
          ))}
        </div>
      </SettingsSheet>
      <SettingsSheet open={!!selected} onClose={() => setSelected(null)} title={selected?.title || ''}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8 }}>
          {(selected?.items || []).map((item, j) => (
            <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--accent)', fontSize: 11, marginTop: 3, flexShrink: 0 }}>•</span>
              <span style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.55 }}>{item}</span>
            </div>
          ))}
        </div>
      </SettingsSheet>
    </>
  );
}

// ─── PASSKEY SHEET ───────────────────────────────────────────────────
function PasskeySheet({ open, onClose }) {
  const [confirmEl, confirm] = useConfirm();
  const [passkeys, setPasskeys] = useStateSet([]);
  const [loadingList, setLoadingList] = useStateSet(false);
  const [adding, setAdding] = useStateSet(false);
  const [deletingId, setDeletingId] = useStateSet(null);
  const [error, setError] = useStateSet('');
  const [successMsg, setSuccessMsg] = useStateSet('');

  const flash = (msg, isError = false) => {
    if (isError) setError(msg); else setSuccessMsg(msg);
    setTimeout(() => { setError(''); setSuccessMsg(''); }, 3500);
  };

  const loadPasskeys = async () => {
    setLoadingList(true);
    try {
      const list = await LB.listPasskeys();
      setPasskeys(list);
    } catch (e) {
      flash(e.message || 'Failed to load passkeys', true);
    } finally {
      setLoadingList(false);
    }
  };

  useEffectSet(() => {
    if (open) loadPasskeys();
    else { setPasskeys([]); setError(''); setSuccessMsg(''); }
  }, [open]);

  const handleAdd = async () => {
    if (adding) return;
    setAdding(true); setError('');
    try {
      await LB.registerPasskey();
      flash('Passkey added!');
      loadPasskeys();
    } catch (e) {
      flash(e.message || 'Failed to add passkey', true);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (deletingId) return;
    const ok = await confirm(`Remove "${name || 'Passkey'}"? You won't be able to sign in with it anymore.`, { ok: 'Remove', danger: true });
    if (!ok) return;
    setDeletingId(id);
    try {
      await LB.deletePasskey(id);
      setPasskeys(prev => prev.filter(p => p.id !== id));
      flash('Passkey removed');
    } catch (e) {
      flash(e.message || 'Failed to remove passkey', true);
    } finally {
      setDeletingId(null);
    }
  };

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <SettingsSheet open={open} onClose={onClose} title="Passkeys">
      {confirmEl}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <button onClick={handleAdd} disabled={adding} style={{
          width: '100%', padding: '12px 0', borderRadius: 6,
          background: 'rgba(var(--accent-rgb),0.10)', border: '0.5px solid rgba(var(--accent-rgb),0.25)',
          color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
          cursor: adding ? 'default' : 'pointer', opacity: adding ? 0.6 : 1,
          WebkitTapHighlightColor: 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {adding ? 'Adding…' : 'Add passkey for this device'}
        </button>

        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 8, marginBottom: 20, lineHeight: 1.5 }}>
          Each device needs its own passkey — Face ID, Touch ID or device PIN.
        </div>

        {(error || successMsg) && (
          <div style={{ fontSize: 12, color: error ? UI.danger : UI.gold, fontFamily: UI.fontUi, marginBottom: 12, padding: '8px 12px', background: error ? 'rgba(var(--danger-rgb),0.06)' : 'rgba(var(--accent-rgb),0.08)', borderRadius: 6 }}>
            {error || successMsg}
          </div>
        )}

        {loadingList ? (
          <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '16px 0' }}>Loading…</div>
        ) : passkeys.length === 0 ? (
          <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '16px 0' }}>No passkeys registered yet</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>Registered passkeys</div>
            {passkeys.map((pk, i) => (
              <React.Fragment key={pk.id}>
                {i > 0 && <div className="knurl" />}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
                  <div>
                    <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 500 }}>
                      {pk.friendly_name || 'Passkey'}
                    </div>
                    <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>
                      Added {fmtDate(pk.created_at)}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(pk.id, pk.friendly_name)} disabled={!!deletingId} style={{
                    background: 'rgba(var(--danger-rgb),0.08)', border: '0.5px solid rgba(var(--danger-rgb),0.2)',
                    color: UI.danger, borderRadius: 6, padding: '5px 12px',
                    fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                    cursor: deletingId ? 'default' : 'pointer', opacity: deletingId === pk.id ? 0.5 : 1,
                    WebkitTapHighlightColor: 'transparent', flexShrink: 0,
                  }}>
                    {deletingId === pk.id ? '…' : 'Remove'}
                  </button>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </SettingsSheet>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────
function SettingsScreen({ store, setStore, go, userId, openSupportInbox, openSupportSheet }) {
  const [confirmEl, confirm] = useConfirm();
  const [nickname, setNickname] = useStateSet(store.user?.name || '');

  // Category sheets
  const [coachingSheet, setCoachingSheet] = useStateSet(false);
  const [healthSheet, setHealthSheet] = useStateSet(false);
  const [accountSheet, setAccountSheet] = useStateSet(false);
  const [trainingSheet, setTrainingSheet] = useStateSet(false);
  const [appearanceSheet, setAppearanceSheet] = useStateSet(false);
  const [dataSheet, setDataSheet] = useStateSet(false);
  const [changelogSheet, setChangelogSheet] = useStateSet(false);
  const [activeUsersSheet, setActiveUsersSheet] = useStateSet(false);
  const [howToSheet, setHowToSheet] = useStateSet(false);

  // Training sub-sheets
  const [sessionBehaviourSheet, setSessionBehaviourSheet] = useStateSet(false);
  const [weightsProgressionSheet, setWeightsProgressionSheet] = useStateSet(false);
  const [notificationsGroupSheet, setNotificationsGroupSheet] = useStateSet(false);
  const [restSheet, setRestSheet] = useStateSet(false);
  const [timeoutSheet, setTimeoutSheet] = useStateSet(false);
  const [paceguardSheet, setPaceguardSheet] = useStateSet(false);
  const [progressionSheet, setProgressionSheet] = useStateSet(false);
  const [progConfigOpen, setProgConfigOpen] = useStateSet(false);
  const [plateInventoryOpen, setPlateInventoryOpen] = useStateSet(false);
  const [plateInvTab, setPlateInvTab] = useStateSet(() => UI.unit() === 'lbs' ? 1 : 0);
  const [progDisclaimer, setProgDisclaimer] = useStateSet(false);
  const [activeSessions, setActiveSessions] = useStateSet([]);
  const [qsSwitching, setQsSwitching] = useStateSet(false);
  const [activeGrants, setActiveGrants] = useStateSet([]);
  const [newGrantEmail, setNewGrantEmail] = useStateSet('');
  const [pendingUsers, setPendingUsers] = useStateSet([]);
  const [approvingId, setApprovingId] = useStateSet(null);
  const [decliningId, setDecliningId] = useStateSet(null);
  const [hasActiveUsersAccess, setHasActiveUsersAccess] = useStateSet(
    () => localStorage.getItem('logbook-active-users-access') === 'true'
  );
  const [signupApproval, setSignupApproval] = useStateSet(null); // null = loading, bool = current
  const [autoApproveLeft, setAutoApproveLeft] = useStateSet(null); // null = no batch budget, int = remaining
  const [periodsSheet, setPeriodsSheet] = useStateSet(false);
  const [showAllPeriods, setShowAllPeriods] = useStateSet(false);
  const [confirmDeletePeriodId, setConfirmDeletePeriodId] = useStateSet(null);
  const [budgetSheet, setBudgetSheet] = useStateSet(false);
  const [budgetDraft, setBudgetDraft] = useStateSet(20);
  const [allUsers, setAllUsers] = useStateSet([]);
  const [allUsersSheet, setAllUsersSheet] = useStateSet(false);
  const [allUsersSearch, setAllUsersSearch] = useStateSet('');
  const [allUsersNewOnly, setAllUsersNewOnly] = useStateSet(false);
  const [allUsersOnboardedOnly, setAllUsersOnboardedOnly] = useStateSet(false);
  const [allUsersOutdatedOnly, setAllUsersOutdatedOnly] = useStateSet(false);
  const [adminUserDetail, setAdminUserDetail] = useStateSet(null); // { userId, name, plans }
  const [adminUserDetailLoading, setAdminUserDetailLoading] = useStateSet(false);
  const [adminUserDetailSheet, setAdminUserDetailSheet] = useStateSet(false);
  const [adminPlanDetail, setAdminPlanDetail] = useStateSet(null); // plan object with days
  const [adminPlanDetailSheet, setAdminPlanDetailSheet] = useStateSet(false);
  const [adminPlanSelectedDayId, setAdminPlanSelectedDayId] = useStateSet(null);
  useEffectSet(() => {
    setAdminPlanSelectedDayId(adminPlanDetail?.days?.[0]?.id || null);
  }, [adminPlanDetail]);
  const [seenSignups, setSeenSignups] = useStateSet(() => {
    try { return new Set(JSON.parse(localStorage.getItem('logbook-seen-signups') || '[]')); } catch (_) { return new Set(); }
  });
  const [nowS, setNowS] = useStateSet(Date.now());
  const [importing, setImporting] = useStateSet(false);
  const [importSheet, setImportSheet] = useStateSet(false);
  const [importProgress, setImportProgress] = useStateSet({ pct: 0, phase: '' });
  const [importSourceUnit, _setImportSourceUnit] = useStateSet(store.settings?.unit || 'kg');
  const importSourceUnitRef = useRefSet(store.settings?.unit || 'kg');
  const setImportSourceUnit = v => { importSourceUnitRef.current = v; _setImportSourceUnit(v); };
  const [pushStatus, setPushStatus] = useStateSet(null);
  const [pushEnabled, setPushEnabled] = useStateSet(() => store.settings?.pushEnabled ?? localStorage.getItem('logbook-push-enabled') === 'true');
  const [pushKeyDraft, setPushKeyDraft] = useStateSet('');
  const [testPickerOpen, setTestPickerOpen] = useStateSet(false);
  const [advancedPushSheet, setAdvancedPushSheet] = useStateSet(false);
  const [pushoverStep, setPushoverStep] = useStateSet('idle'); // 'idle'|'entering-key'|'code-sent'
  const [pendingCode, setPendingCode] = useStateSet('');
  const [codeInput, setCodeInput] = useStateSet('');
  const [verifyLoading, setVerifyLoading] = useStateSet(false);
  const [pushSheet, setPushSheet] = useStateSet(false);
  const [webPushSub, setWebPushSub] = useStateSet(null);
  const [webPushLoading, setWebPushLoading] = useStateSet(false);
  const [webPushPending, setWebPushPending] = useStateSet(false);
  const [webPushVerified, setWebPushVerified] = useStateSet(() => localStorage.getItem('logbook-push-verified') === 'true');
  const [iosDisclaimerSeen, setIosDisclaimerSeen] = useStateSet(() => localStorage.getItem('logbook-push-ios-hint-seen') === 'true');
  const [webPushStep, setWebPushStep] = useStateSet('idle'); // 'idle'|'code-sent'
  const [webPushCode, setWebPushCode] = useStateSet('');
  const [reminderSheet, setReminderSheet] = useStateSet(false);
  const [passkeySheet, setPasskeySheet] = useStateSet(false);
  const [supportSheet, setSupportSheet] = useStateSet(false);
  const [supportView, setSupportView] = useStateSet('list'); // 'list' | 'thread' | 'new'
  const [supportActiveTicketId, setSupportActiveTicketId] = useStateSet(null);
  const [supportActiveNotes, setSupportActiveNotes] = useStateSet([]);
  const [supportActiveLoading, setSupportActiveLoading] = useStateSet(false);
  const [supportDraft, setSupportDraft] = useStateSet('');
  const [supportSending, setSupportSending] = useStateSet(false);
  const [supportImageFile, setSupportImageFile] = useStateSet(null);
  const [supportImagePreview, setSupportImagePreview] = useStateSet(null);
  const [supportCategoryDraft, setSupportCategoryDraft] = useStateSet('question');
  const [supportCatFilter, setSupportCatFilter] = useStateSet('all');
  const [supportInboxSheet, setSupportInboxSheet] = useStateSet(false);
  const [supportInbox, setSupportInbox] = useStateSet([]);
  const [supportInboxLoading, setSupportInboxLoading] = useStateSet(false);
  const [supportTicket, setSupportTicket] = useStateSet(null);
  const [supportTicketNotes, setSupportTicketNotes] = useStateSet([]);
  const [lightboxSrc, setLightboxSrc] = useStateSet(null); // chat/support attachment tapped for fullscreen view
  const [supportTicketLoading, setSupportTicketLoading] = useStateSet(false);
  const [supportAdminDraft, setSupportAdminDraft] = useStateSet('');
  const [supportAdminSending, setSupportAdminSending] = useStateSet(false);
  const [adminImageFile, setAdminImageFile] = useStateSet(null);
  const [adminImagePreview, setAdminImagePreview] = useStateSet(null);
  const [archivedInbox, setArchivedInbox] = useStateSet([]);
  const [showArchived, setShowArchived] = useStateSet(false);
  const [archivedLoading, setArchivedLoading] = useStateSet(false);
  const [changePasswordSheet, setChangePasswordSheet] = useStateSet(false);
  const [pwCurrent, setPwCurrent] = useStateSet('');
  const [pwNew, setPwNew] = useStateSet('');
  const [pwConfirm, setPwConfirm] = useStateSet('');
  const [pwLoading, setPwLoading] = useStateSet(false);
  const [pwMsg, setPwMsg] = useStateSet(null);
  const [changeEmailSheet, setChangeEmailSheet] = useStateSet(false);
  const [emailNew, setEmailNew] = useStateSet('');
  const [emailLoading, setEmailLoading] = useStateSet(false);
  const [emailMsg, setEmailMsg] = useStateSet(null);
  const [reminderEnabled, setReminderEnabled] = useStateSet(() => store.settings?.reminderEnabled ?? false);
  const [reminderTime, setReminderTime] = useStateSet(() => store.settings?.reminderTime ?? '07:00');
  const [cycleWeekView, setCycleWeekView] = useStateSet(() => store.settings?.cycleWeekView ?? localStorage.getItem('logbook-cycle-week-view') === 'true');
  const [darkMode, setDarkMode] = useStateSet(() => store.settings?.darkMode ?? localStorage.getItem('logbook-dark-mode') ?? 'dark');
  const [showWarmupInSummary, setShowWarmupInSummary] = useStateSet(() => store.settings?.showWarmupInSummary ?? true);
  const [unitPickerOpen, setUnitPickerOpen] = useStateSet(false);
const [adminSheet, setAdminSheet] = useStateSet(false);
  const [vipBgSheet, setVipBgSheet] = useStateSet(false);
  const [vipBgListSheet, setVipBgListSheet] = useStateSet(false);
  const [vipBgList, setVipBgList] = useStateSet([]);
  const [vipBgOptions, setVipBgOptions] = useStateSet(null);
  const [vipBgEmail, setVipBgEmail] = useStateSet('');
  const [vipBgKey, setVipBgKey] = useStateSet('');
  const [vipBgSaving, setVipBgSaving] = useStateSet(false);
  const [vipBgMsg, setVipBgMsg] = useStateSet(null);
  const [broadcastSheet, setBroadcastSheet] = useStateSet(false);
  const [broadcastBody, setBroadcastBody] = useStateSet('');
  const [broadcastSending, setBroadcastSending] = useStateSet(false);
  const [broadcastMsg, setBroadcastMsg] = useStateSet(null);
  const [adminEmailSubject, setAdminEmailSubject] = useStateSet('');
  const [adminEmailBody, setAdminEmailBody] = useStateSet('');
  const [adminEmailSending, setAdminEmailSending] = useStateSet(false);
  const [adminEmailMsg, setAdminEmailMsg] = useStateSet(null);
  const isAdmin = store.user?.email === 'office@btc-prime.biz';
  // Detected/reported in app.jsx (boot, foreground, controllerchange) — this
  // screen only reads it for display, so it stays fresh even if Settings is
  // never opened.
  const swVersion = store.settings?.swVersion || '';

  useEffectSet(() => {
    if (openSupportInbox && isAdmin) setSupportInboxSheet(true);
    if (openSupportSheet && !isAdmin) setSupportSheet(true);
  }, []);

  useEffectSet(() => {
    let mounted = true;
    LB.supabase.rpc('check_active_users_access')
      .then(({ data }) => { const val = !!data; localStorage.setItem('logbook-active-users-access', String(val)); if (mounted) setHasActiveUsersAccess(val); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffectSet(() => {
    if (!hasActiveUsersAccess) return;
    let mounted = true;
    const loadSessions = () => LB.supabase.rpc('get_active_sessions_overview').then(({ data }) => { if (mounted) setActiveSessions(data || []); }).catch(() => {});
    const loadGrants = () => LB.supabase.rpc('get_active_users_grants').then(({ data }) => { if (mounted) setActiveGrants((data || []).map(r => r.email)); }).catch(() => {});
    const loadPending = () => LB.supabase.rpc('get_pending_users').then(({ data }) => { if (mounted) setPendingUsers(data || []); }).catch(() => {});
    loadSessions(); if (isAdmin) { loadGrants(); loadPending(); }
    const iv = setInterval(() => { loadSessions(); setNowS(Date.now()); }, 2000);
    return () => { mounted = false; clearInterval(iv); };
  }, [hasActiveUsersAccess, isAdmin]);

  useEffectSet(() => {
    if (!pushSheet) return;
    LB.getWebPushSubscription().then(sub => {
      setWebPushSub(sub);
      // Auto-restore verified state: if the browser's PushManager has an active
      // subscription and push is already confirmed in DB, restore local verified flag
      // without requiring re-verification (cache clear, PWA reinstall, etc.).
      if (sub && store.settings?.pushEnabled && localStorage.getItem('logbook-push-verified') !== 'true') {
        setWebPushVerified(true);
        localStorage.setItem('logbook-push-verified', 'true');
      }
    }).catch(() => {});
  }, [pushSheet]);

  // Reset support navigation when sheet closes; clear unread badge when opened
  useEffectSet(() => {
    if (!supportSheet) {
      setSupportView('list');
      setSupportActiveTicketId(null);
      setSupportActiveNotes([]);
      setSupportDraft('');
    } else {
      setStore(s => s ? { ...s, supportUnread: 0 } : s);
    }
  }, [supportSheet]);

  // Load notes + mark read when user opens a ticket thread
  useEffectSet(() => {
    if (!supportActiveTicketId) { setSupportActiveNotes([]); return; }
    let mounted = true;
    setSupportActiveLoading(true);
    LB.supabase.from('zane_coaching_notes')
      .select('id, author_id, body, created_at, read_at, attachments')
      .eq('coaching_id', supportActiveTicketId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!mounted) return;
        setSupportActiveNotes(data || []);
        setSupportActiveLoading(false);
        LB.supabase.from('zane_coaching_notes')
          .update({ read_at: new Date().toISOString() })
          .eq('coaching_id', supportActiveTicketId)
          .neq('author_id', userId)
          .is('read_at', null)
          .then(() => { if (!mounted) return; setStore(s => {
            const ticket = (s.supportTickets || []).find(t => t.coachingId === supportActiveTicketId);
            const delta = ticket ? ticket.unreadCount : 0;
            return {
              ...s,
              supportUnread: Math.max(0, (s.supportUnread || 0) - delta),
              supportTickets: (s.supportTickets || []).map(t =>
                t.coachingId === supportActiveTicketId ? { ...t, unreadCount: 0 } : t
              ),
            };
          }); });
      });
    // Poll for read_at updates on our own sent messages (seen indicator)
    const poll = setInterval(() => {
      if (!mounted) return;
      LB.supabase.from('zane_coaching_notes')
        .select('id, read_at')
        .eq('coaching_id', supportActiveTicketId)
        .eq('author_id', userId)
        .not('read_at', 'is', null)
        .then(({ data }) => {
          if (!mounted || !data) return;
          setSupportActiveNotes(prev => prev.map(n => {
            const u = data.find(d => d.id === n.id);
            return u && !n.read_at ? { ...n, read_at: u.read_at } : n;
          }));
        });
    }, 12000);
    return () => { mounted = false; clearInterval(poll); };
  }, [supportActiveTicketId]);

  // Load admin ticket notes + mark user messages read
  useEffectSet(() => {
    if (!supportTicket) { setSupportTicketNotes([]); return; }
    let mounted = true;
    setSupportTicketLoading(true);
    LB.supabase.from('zane_coaching_notes')
      .select('id, author_id, body, created_at, read_at, attachments')
      .eq('coaching_id', supportTicket.coachingId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!mounted) return; setSupportTicketNotes(data || []); setSupportTicketLoading(false); });
    LB.supabase.from('zane_coaching_notes')
      .update({ read_at: new Date().toISOString() })
      .eq('coaching_id', supportTicket.coachingId)
      .neq('author_id', userId)
      .is('read_at', null)
      .then(() => { if (!mounted) return; setSupportInbox(prev => prev.map(t => t.coaching_id === supportTicket.coachingId ? { ...t, unread_count: 0 } : t)); });
    // Poll for read_at updates on admin's sent messages (seen indicator)
    const poll = setInterval(() => {
      if (!mounted) return;
      LB.supabase.from('zane_coaching_notes')
        .select('id, read_at')
        .eq('coaching_id', supportTicket.coachingId)
        .eq('author_id', userId)
        .not('read_at', 'is', null)
        .then(({ data }) => {
          if (!mounted || !data) return;
          setSupportTicketNotes(prev => prev.map(n => {
            const u = data.find(d => d.id === n.id);
            return u && !n.read_at ? { ...n, read_at: u.read_at } : n;
          }));
        });
    }, 12000);
    return () => { mounted = false; clearInterval(poll); };
  }, [supportTicket]);

  // Admin-only: load all admin state on mount (signup config, support inbox).
  useEffectSet(() => {
    if (!isAdmin) return;
    let mounted = true;
    LB.supabase.rpc('get_signup_config').then(({ data, error }) => {
      if (!mounted || error) return;
      const row = Array.isArray(data) ? data[0] : data;
      setSignupApproval(row ? row.requires_approval !== false : true);
      setAutoApproveLeft(row ? (row.auto_approve_remaining ?? null) : null);
    }).catch(() => {});
    LB.supabase.rpc('get_support_chats').then(({ data }) => { if (mounted) setSupportInbox(data || []); }).catch(() => {});
    return () => { mounted = false; };
  }, [isAdmin]);

  // Admin-only: support inbox. Reloaded each time Account or Admin sheet opens.
  useEffectSet(() => {
    if (!isAdmin || (!accountSheet && !adminSheet)) return;
    let mounted = true;
    LB.supabase.rpc('get_support_chats').then(({ data }) => { if (mounted) setSupportInbox(data || []); }).catch(() => {});
    return () => { mounted = false; };
  }, [isAdmin, accountSheet, adminSheet]);

  // Admin-only: full user list (name/email/last-known SW version/plan count)
  // — the single source for the unseen-signup badge (computed from it) and
  // the All-users sheet, which folds in what used to be the separate Recent
  // Sign-ups/Onboarded views as client-side filters. Loaded on mount and
  // refreshed whenever Account/Admin opens, so the badge stays current.
  useEffectSet(() => {
    if (!isAdmin) return;
    let mounted = true;
    LB.supabase.rpc('get_all_users_admin').then(({ data, error }) => { if (mounted && !error) setAllUsers(data || []); }).catch(() => {});
    return () => { mounted = false; };
  }, [isAdmin, accountSheet, adminSheet]);

  // Admin-only: re-fetch every time the All-users sheet itself is opened, so
  // it never shows a stale snapshot from whenever the badge last refreshed.
  useEffectSet(() => {
    if (!isAdmin || !allUsersSheet) return;
    let mounted = true;
    LB.supabase.rpc('get_all_users_admin').then(({ data, error }) => { if (mounted && !error) setAllUsers(data || []); }).catch(() => {});
    return () => { mounted = false; };
  }, [isAdmin, allUsersSheet]);

  useEffectSet(() => {
    if (!isAdmin || !vipBgSheet) return;
    let mounted = true;
    LB.supabase.rpc('get_user_vip_backgrounds').then(({ data }) => { if (mounted) setVipBgList(data || []); }).catch(() => {});
    fetch('Background/index.json?_v=' + Date.now()).then(r => r.json()).then(data => { if (mounted) setVipBgOptions(data); }).catch(() => { if (mounted) setVipBgOptions([]); });
    return () => { mounted = false; };
  }, [isAdmin, vipBgSheet]);

  useEffectSet(() => {
    if (!supportInboxSheet || !isAdmin) return;
    setSupportInboxLoading(true);
    setStore(s => s ? { ...s, adminSupportUnread: 0 } : s);
    LB.supabase.rpc('get_support_chats').then(({ data }) => { setSupportInbox(data || []); setSupportInboxLoading(false); }).catch(() => setSupportInboxLoading(false));
  }, [supportInboxSheet]);

  useEffectSet(() => {
    supportBottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [supportActiveNotes]);

  useEffectSet(() => {
    adminBottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [supportTicketNotes]);

  const markSignupSeen = (uid) => {
    setSeenSignups(prev => {
      const next = new Set(prev); next.add(uid);
      try { localStorage.setItem('logbook-seen-signups', JSON.stringify([...next])); } catch (_) {}
      return next;
    });
  };

  const markAllSignupsSeen = (uids) => {
    if (!uids.length) return;
    setSeenSignups(prev => {
      const next = new Set(prev);
      uids.forEach(id => next.add(id));
      try { localStorage.setItem('logbook-seen-signups', JSON.stringify([...next])); } catch (_) {}
      return next;
    });
  };

  // A sign-up counts as "new" only if it's both unseen on this device AND
  // registered recently — otherwise a fresh admin device would flag every
  // existing user as new.
  const NEW_SIGNUP_DAYS = 14;
  const isNewSignup = (u) => {
    if (seenSignups.has(u.user_id)) return false;
    if (!u.created_at) return false;
    return (Date.now() - new Date(u.created_at).getTime()) < NEW_SIGNUP_DAYS * 24 * 60 * 60 * 1000;
  };

  const toggleSignupApproval = async () => {
    const next = !signupApproval;
    setSignupApproval(next);
    setAutoApproveLeft(null); // manual toggle clears any batch budget
    const { error } = await LB.supabase.rpc('set_signup_requires_approval', { p_value: next });
    if (error) { setSignupApproval(!next); await confirm(error.message || 'Could not update this setting.', { title: 'Update failed', ok: 'OK' }); }
  };

  const saveBudget = async () => {
    const n = budgetDraft;
    setBudgetSheet(false);
    const prevApproval = signupApproval;
    const prevLeft = autoApproveLeft;
    setSignupApproval(n <= 0);            // n>0 → open for a batch; n<=0 → re-lock now
    setAutoApproveLeft(n > 0 ? n : null);
    const { error } = await LB.supabase.rpc('set_auto_approve_budget', { p_count: n });
    if (error) {
      setSignupApproval(prevApproval);
      setAutoApproveLeft(prevLeft);
      await confirm(error.message || 'Could not update this setting.', { title: 'Update failed', ok: 'OK' });
    }
  };

  const approveUser = async (uid) => {
    setApprovingId(uid);
    try {
      const { error } = await LB.supabase.rpc('approve_user', { p_user_id: uid });
      if (error) { await confirm(error.message || 'Could not approve this user.', { title: 'Approve failed', ok: 'OK' }); return; }
      setPendingUsers(u => u.filter(x => x.user_id !== uid));
    } finally {
      setApprovingId(null);
    }
  };

  const declineUser = async (uid) => {
    setDecliningId(uid);
    try {
      const { error } = await LB.supabase.rpc('decline_user', { p_user_id: uid });
      if (error) { await confirm(error.message || 'Could not decline this user.', { title: 'Decline failed', ok: 'OK' }); return; }
      setPendingUsers(u => u.filter(x => x.user_id !== uid));
    } finally {
      setDecliningId(null);
    }
  };

  const addGrant = async () => {
    const email = newGrantEmail.trim().toLowerCase();
    if (!email.includes('@') || activeGrants.includes(email)) return;
    const { error } = await LB.supabase.rpc('set_active_users_grant', { p_email: email, p_granted: true });
    if (error) { await confirm(error.message || 'Could not add this grant.', { title: 'Grant failed', ok: 'OK' }); return; }
    setActiveGrants(g => [...g, email]); setNewGrantEmail('');
  };
  const removeGrant = async (email) => {
    const { error } = await LB.supabase.rpc('set_active_users_grant', { p_email: email, p_granted: false });
    if (error) { await confirm(error.message || 'Could not remove this grant.', { title: 'Grant failed', ok: 'OK' }); return; }
    setActiveGrants(g => g.filter(x => x !== email));
  };

  const pushStatusTimer = useRefSet(null);
  const pendingTimeoutRef = useRefSet(null);
  const countdownIntervalRef = useRefSet(null);
  const supportBottomRef = useRefSet(null);
  const adminBottomRef = useRefSet(null);
  const [pendingCountdown, setPendingCountdown] = useStateSet(120);
  useEffectSet(() => () => { clearTimeout(pushStatusTimer.current); clearTimeout(pendingTimeoutRef.current); clearInterval(countdownIntervalRef.current); }, []);

  const cancelPendingPush = async () => {
    clearTimeout(pendingTimeoutRef.current);
    clearInterval(countdownIntervalRef.current);
    setPendingCountdown(120);
    await LB.unsubscribeWebPush(userId).catch(() => {});
    setWebPushSub(null);
    setPushEnabled(false); localStorage.setItem('logbook-push-enabled', 'false');
    setWebPushVerified(false); localStorage.removeItem('logbook-push-verified');
    setWebPushPending(false);
    setWebPushStep('idle'); setWebPushCode(''); setCodeInput('');
  };

  // Cancel pending verification when the push sheet is closed without verifying
  useEffectSet(() => {
    if (!pushSheet && webPushPending) cancelPendingPush();
  }, [pushSheet]);

  const togglePush = async () => {
    if (webPushLoading) return;
    if (webPushPending) { await cancelPendingPush(); return; }
    setWebPushLoading(true);
    try {
      if (!pushEnabled) {
        const sub = await LB.subscribeWebPush(userId);
        setWebPushSub(sub);
        setWebPushVerified(false); localStorage.removeItem('logbook-push-verified');
        setWebPushPending(true);
        setPendingCountdown(120);
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = setInterval(() => setPendingCountdown(n => Math.max(0, n - 1)), 1000);
        // 2-minute window to enter the verification code; cancels subscription on timeout
        pendingTimeoutRef.current = setTimeout(async () => {
          await cancelPendingPush();
          clearTimeout(pushStatusTimer.current);
          setPushStatus('Verification timed out — push not enabled');
          pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
        }, 2 * 60 * 1000);
        sendWebPushCode();
      } else {
        await LB.unsubscribeWebPush(userId);
        setWebPushSub(null);
        setPushEnabled(false); localStorage.setItem('logbook-push-enabled', 'false');
        setWebPushVerified(false); localStorage.removeItem('logbook-push-verified');
        setWebPushStep('idle'); setWebPushCode(''); setCodeInput('');
        setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: false } }));
      }
    } catch (e) {
      clearTimeout(pushStatusTimer.current);
      const msg = e.message?.toLowerCase() ?? '';
      setPushStatus(msg.includes('denied') || msg.includes('permission')
        ? 'Permission denied — enable notifications in browser settings'
        : `Error: ${e.message}`);
      pushStatusTimer.current = setTimeout(() => setPushStatus(null), 7000);
    } finally {
      setWebPushLoading(false);
    }
  };
  const sendWebPushCode = () => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setWebPushCode(code); setCodeInput(''); setWebPushStep('code-sent');
    LB.fnFetch(LB.WEB_PUSH_URL, { title: 'Zane · verification', message: `Your code: ${code}`, verify: true }).catch(() => {});
  };
  const verifyWebPushCode = () => {
    if (codeInput.trim() !== webPushCode) {
      clearTimeout(pushStatusTimer.current);
      setPushStatus('Wrong code — check the notification');
      pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
      return;
    }
    clearTimeout(pendingTimeoutRef.current);
    clearInterval(countdownIntervalRef.current);
    setPendingCountdown(120);
    setPushEnabled(true); localStorage.setItem('logbook-push-enabled', 'true');
    setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: true } }));
    setWebPushVerified(true); localStorage.setItem('logbook-push-verified', 'true');
    setWebPushPending(false);
    setWebPushStep('idle'); setWebPushCode(''); setCodeInput('');
    clearTimeout(pushStatusTimer.current);
    setPushStatus('✓ Verified'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 3000);
  };
  const PUSHOVER_VERIFY_URL = `${LB.SUPABASE_URL}/functions/v1/pushover-verify`;
  const closeAdvanced = () => { setAdvancedPushSheet(false); setPushoverStep('idle'); setPushKeyDraft(''); setCodeInput(''); setPendingCode(''); };
  const sendVerificationCode = async () => {
    setVerifyLoading(true);
    clearTimeout(pushStatusTimer.current);
    try {
      const res = await LB.fnFetch(PUSHOVER_VERIFY_URL, { userKey: pushKeyDraft.trim() });
      if (!res?.ok) { const d = await res?.json().catch(() => ({})); setPushStatus(`Error: ${d?.error || 'send failed'}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
      const { code } = await res.json();
      setPendingCode(code);
      setPushoverStep('code-sent');
    } catch (e) { setPushStatus(`Error: ${e.message}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
    finally { setVerifyLoading(false); }
  };
  const verifyCode = () => {
    if (codeInput.trim() !== pendingCode) { setPushStatus('Incorrect code — check the Pushover notification'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
    setStore(s => ({ ...s, settings: { ...s.settings, pushoverUserKey: pushKeyDraft.trim(), usePushover: true } }));
    setPushoverStep('idle'); setPendingCode(''); setCodeInput(''); setPushKeyDraft('');
    setPushStatus('✓ Pushover active'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 4000);
  };
  const disablePushover = () => {
    setStore(s => ({ ...s, settings: { ...s.settings, pushoverUserKey: null, usePushover: false } }));
    setPushoverStep('idle');
  };
  const testWebPush = async () => {
    clearTimeout(pushStatusTimer.current);
    setPushStatus('Sending…');
    try {
      const res = await LB.fnFetch(LB.WEB_PUSH_URL, { title: 'Zane Test', message: 'Notifications are working! 💪' });
      if (!res) { setPushStatus('Error: not signed in'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
      const data = await res.json().catch(() => ({}));
      if (res.status === 202 || data.scheduled) { setPushStatus('✓ Sent'); }
      else if (data.skipped) { setPushStatus('No subscription found — try toggling push off and on'); }
      else { setPushStatus(`Error: ${JSON.stringify(data)}`); }
    } catch (e) { setPushStatus(`Error: ${e.message}`); }
    pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
  };
  const testRestTimer = async (delaySeconds = 0) => {
    clearTimeout(pushStatusTimer.current);
    setPushStatus(delaySeconds > 0 ? 'Sending… Lock screen now!' : 'Sending…');
    const nonce = String(Date.now());
    const title = 'Zane Test';
    const message = 'Rest done — keep going! 💪';
    const usesPushover = !!(store.settings?.pushoverUserKey && store.settings?.usePushover);
    try {
      if (usesPushover) {
        const res = await LB.fnFetch(LB.PUSHOVER_URL, { message, title, delaySeconds, nonce, ttl: 10 });
        if (!res) { setPushStatus('Error: not signed in'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
        if (res.status === 202) { setPushStatus(`✓ Scheduled — notification in ~${delaySeconds}s`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), (delaySeconds + 15) * 1000); }
        else { const data = await res.json().catch(() => ({})); setPushStatus(data.skipped ? 'Key not synced yet — try again' : `Error: ${JSON.stringify(data)}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
      } else {
        const res = await LB.fnFetch(LB.WEB_PUSH_URL, { title, message, delaySeconds, nonce });
        if (!res) { setPushStatus('Error: not signed in'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
        if (res.status === 202) { setPushStatus(`✓ Scheduled — notification in ~${delaySeconds}s`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), (delaySeconds + 15) * 1000); }
        else { const data = await res.json().catch(() => ({})); setPushStatus(`Error: ${JSON.stringify(data)}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
      }
    } catch (e) { setPushStatus(`Error: ${e.message}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
  };
  const toggleReminder = () => {
    const next = !reminderEnabled;
    if (next && !pushEnabled) {
      // Push not active — open push sheet instead of enabling reminder
      setTrainingSheet(false);
      setPushSheet(true);
      return;
    }
    setReminderEnabled(next);
    setStore(s => ({ ...s, settings: { ...s.settings, reminderEnabled: next } }));
  };
  const updateReminderTime = (val) => { setReminderTime(val); setStore(s => ({ ...s, settings: { ...s.settings, reminderTime: val } })); };
  const saveNickname = () => { const t = nickname.trim(); if (!t || t === store.user?.name) return; setStore(s => ({ ...s, user: { ...s.user, name: t } })); };
  const exportData = async (filename) => {
    const backup = await LB.exportBackup(store, userId);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename || `zane-${LB.todayISO()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const runImport = () => {
    // input.click() must be synchronous in the user-gesture handler (iOS Safari).
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      let backup; try { backup = JSON.parse(await file.text()); } catch (_) { await confirm('The selected file is not valid JSON.', { title: 'Invalid file', ok: 'OK' }); return; }
      const invalid = LB.validateBackup(backup);
      if (invalid) { await confirm(invalid, { title: 'Invalid backup', ok: 'OK' }); return; }

      // Auto-detect source unit from backup; update toggle + ref so the user sees it.
      const detectedUnit = backup.settings?.unit;
      if (detectedUnit === 'kg' || detectedUnit === 'lbs') setImportSourceUnit(detectedUnit);

      const latestSession = [...(backup.sessions || [])].filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0];
      const backupDate = latestSession ? new Date(latestSession.ended).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : 'unknown date';
      const userUnit = store.settings?.unit || 'kg';
      const srcUnit = importSourceUnitRef.current;
      const unitMismatch = srcUnit !== userUnit;
      const unitNote = unitMismatch ? ` Weights will be converted from ${srcUnit.toUpperCase()} to ${userUnit.toUpperCase()}.` : '';
      const ok = await confirm(`This backup contains data up to ${backupDate}. Your current data will be permanently replaced.${unitNote}`, { title: 'Replace data?', ok: 'Replace', danger: true });
      if (!ok) return;
      const unitConvert = unitMismatch
        ? { multiplier: srcUnit === 'kg' ? 2.20462 : 1 / 2.20462, targetUnit: userUnit }
        : null;
      setImporting(true);
      setImportProgress({ pct: 0, phase: 'Starting…' });
      try {
        await LB.importFromBackup(backup, userId, (pct, phase) => setImportProgress({ pct, phase }), unitConvert);
        LB.clearLocal(userId); window.location.reload();
      }
      catch (err) { setImporting(false); await confirm(`Import failed: ${err.message || 'Unknown error'}`, { title: 'Error', ok: 'OK' }); }
    }; input.click();
  };
  const handleSignOut = async () => { await LB.signOut(); };

  const handleImagePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSupportImageFile(file);
    const reader = new FileReader();
    reader.onload = ev => setSupportImagePreview(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAdminImagePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAdminImageFile(file);
    const reader = new FileReader();
    reader.onload = ev => setAdminImagePreview(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSupportSend = async () => {
    if ((!supportDraft.trim() && !supportImageFile) || supportSending || !supportActiveTicketId) return;
    setSupportSending(true);
    const body = supportDraft.trim();
    const imgFile = supportImageFile;
    setSupportDraft('');
    setSupportImageFile(null);
    setSupportImagePreview(null);
    try {
      let attachments = null;
      if (imgFile) {
        const url = await LB.uploadChatImage(imgFile, userId);
        attachments = [{ url, name: imgFile.name, type: imgFile.type }];
      }
      const { data: note, error } = await LB.supabase.from('zane_coaching_notes').insert({
        id: LB.uid(), coaching_id: supportActiveTicketId, author_id: userId, type: 'general',
        body: body || '', ...(attachments ? { attachments } : {}),
      }).select('id, author_id, body, created_at, read_at, attachments').single();
      if (!error && note) {
        setSupportActiveNotes(prev => [...prev, note]);
        const preview = attachments ? (body || '📷 Image') : body;
        setStore(s => ({ ...s, supportTickets: (s.supportTickets || []).map(t =>
          t.coachingId === supportActiveTicketId
            ? { ...t, lastMessageAt: note.created_at, lastMessageBody: preview }
            : t
        )}));
        LB.fnFetch(`${LB.SUPABASE_URL}/functions/v1/zane_coaching-notify`, { coachingId: supportActiveTicketId, preview });
      }
    } finally { setSupportSending(false); }
  };

  const handleCreateTicket = async () => {
    if ((!supportDraft.trim() && !supportImageFile) || supportSending) return;
    setSupportSending(true);
    const body = supportDraft.trim();
    const imgFile = supportImageFile;
    setSupportDraft('');
    setSupportImageFile(null);
    setSupportImagePreview(null);
    try {
      const { data: coachingId, error: ticketErr } = await LB.supabase.rpc('open_support_chat', { p_category: supportCategoryDraft });
      if (ticketErr || !coachingId) return;
      let attachments = null;
      if (imgFile) {
        const url = await LB.uploadChatImage(imgFile, userId);
        attachments = [{ url, name: imgFile.name, type: imgFile.type }];
      }
      const { data: note, error: noteErr } = await LB.supabase.from('zane_coaching_notes').insert({
        id: LB.uid(), coaching_id: coachingId, author_id: userId, type: 'general',
        body: body || '', ...(attachments ? { attachments } : {}),
      }).select('id, author_id, body, created_at, read_at, attachments').single();
      if (!noteErr && note) {
        const preview = attachments ? (body || '📷 Image') : body;
        const newTicket = {
          coachingId, status: 'open', category: supportCategoryDraft,
          createdAt: new Date().toISOString(), lastMessageAt: note.created_at,
          lastMessageBody: preview, unreadCount: 0,
        };
        setStore(s => ({ ...s, supportTickets: [newTicket, ...(s.supportTickets || [])] }));
        setSupportCategoryDraft('question');
        setSupportActiveTicketId(coachingId);
        setSupportActiveNotes([note]);
        setSupportView('thread');
        LB.fnFetch(`${LB.SUPABASE_URL}/functions/v1/zane_coaching-notify`, { coachingId, preview });
      }
    } finally { setSupportSending(false); }
  };

  const handleAdminReply = async () => {
    if ((!supportAdminDraft.trim() && !adminImageFile) || supportAdminSending || !supportTicket) return;
    setSupportAdminSending(true);
    const body = supportAdminDraft.trim();
    const imgFile = adminImageFile;
    setSupportAdminDraft('');
    setAdminImageFile(null);
    setAdminImagePreview(null);
    try {
      let attachments = null;
      if (imgFile) {
        const url = await LB.uploadChatImage(imgFile, userId);
        attachments = [{ url, name: imgFile.name, type: imgFile.type }];
      }
      const { data: note, error } = await LB.supabase.from('zane_coaching_notes').insert({
        id: LB.uid(), coaching_id: supportTicket.coachingId, author_id: userId, type: 'general',
        body: body || '', ...(attachments ? { attachments } : {}),
      }).select('id, author_id, body, created_at, read_at, attachments').single();
      if (!error && note) {
        setSupportTicketNotes(prev => [...prev, note]);
        const preview = attachments ? (body || '📷 Image') : body;
        LB.fnFetch(`${LB.SUPABASE_URL}/functions/v1/zane_coaching-notify`, { coachingId: supportTicket.coachingId, preview });
      }
    } finally { setSupportAdminSending(false); }
  };

  const sendBroadcast = async () => {
    const body = broadcastBody.trim();
    if (!body || broadcastSending) return;
    setBroadcastSending(true);
    setBroadcastMsg(null);
    try {
      const { data, error } = await LB.supabase.rpc('admin_broadcast_message', { p_body: body });
      if (error) { setBroadcastMsg({ ok: false, text: error.message }); return; }
      setBroadcastMsg({ ok: true, text: `Sent to ${data} user${data === 1 ? '' : 's'}.` });
      setBroadcastBody('');
    } finally { setBroadcastSending(false); }
  };

  const sendAdminEmail = async () => {
    const subject = adminEmailSubject.trim();
    const body = adminEmailBody.trim();
    if (!subject || !body || adminEmailSending || !adminUserDetail?.email) return;
    setAdminEmailSending(true);
    setAdminEmailMsg(null);
    try {
      const res = await LB.adminSendEmail(adminUserDetail.email, subject, body);
      if (!res.ok) { setAdminEmailMsg({ ok: false, text: res.error }); return; }
      setAdminEmailMsg({ ok: true, text: `Sent to ${adminUserDetail.email}.` });
      setAdminEmailSubject('');
      setAdminEmailBody('');
    } finally { setAdminEmailSending(false); }
  };

  const saveVipBg = async () => {
    const email = vipBgEmail.trim().toLowerCase();
    if (!email || vipBgSaving) return;
    setVipBgSaving(true);
    setVipBgMsg(null);
    try {
      const { data, error } = await LB.supabase.rpc('set_user_vip_background', { p_email: email, p_bg_key: vipBgKey });
      if (error) { setVipBgMsg({ ok: false, text: error.message }); return; }
      if (data === 'ERROR:not_found') { setVipBgMsg({ ok: false, text: `No account found for ${email}` }); return; }
      setVipBgMsg({ ok: true, text: vipBgKey ? `Background set for ${email}` : `Background cleared for ${email}` });
      setVipBgEmail('');
      setVipBgKey('');
      LB.supabase.rpc('get_user_vip_backgrounds').then(({ data: list }) => { setVipBgList(list || []); }).catch(() => {});
    } finally { setVipBgSaving(false); }
  };

  const handleSetSupportStatus = async (coachingId, newStatus) => {
    const { error } = await LB.supabase.rpc('set_support_status', { p_coaching_id: coachingId, p_status: newStatus });
    if (error) { console.error(error); return; }
    setSupportInbox(prev => prev.map(t => t.coaching_id === coachingId ? { ...t, support_status: newStatus } : t));
    setSupportTicket(t => t ? { ...t, status: newStatus } : t);
    setStore(s => ({ ...s, supportTickets: (s.supportTickets || []).map(t =>
      t.coachingId === coachingId ? { ...t, status: newStatus } : t
    )}));
  };

  const handleArchiveTicket = async () => {
    if (!supportTicket) return;
    const coachingId = supportTicket.coachingId;
    await LB.supabase.rpc('archive_support_ticket', { p_coaching_id: coachingId });
    setSupportInbox(prev => prev.filter(t => t.coaching_id !== coachingId));
    setSupportTicket(null);
    setSupportAdminDraft('');
  };

  const [deletingTicket, setDeletingTicket] = useStateSet(false);
  const [confirmDeleteTicket, setConfirmDeleteTicket] = useStateSet(false);

  const handleDeleteTicket = async () => {
    if (!supportTicket) return;
    const coachingId = supportTicket.coachingId;
    setDeletingTicket(true);
    try {
      // Notify user BEFORE deleting (coaching row must still exist)
      const { data: { session } } = await LB.supabase.auth.getSession();
      if (session?.access_token) {
        await fetch(`${LB.SUPABASE_URL}/functions/v1/zane_coaching-notify`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ coachingId, preview: 'Your support ticket has been removed by support.' }),
        }).catch(() => {});
      }
      // Delete storage attachments for all notes in this ticket
      const { data: notesWithAttachments } = await LB.supabase
        .from('zane_coaching_notes')
        .select('attachments')
        .eq('coaching_id', coachingId)
        .not('attachments', 'is', null);
      const storagePrefix = `${LB.SUPABASE_URL}/storage/v1/object/public/chat-attachments/`;
      const paths = (notesWithAttachments || []).flatMap(n =>
        (n.attachments || []).map(a => a.url?.startsWith(storagePrefix) ? a.url.slice(storagePrefix.length) : null).filter(Boolean)
      );
      if (paths.length > 0) {
        await LB.supabase.storage.from('chat-attachments').remove(paths).catch(() => {});
      }
      await LB.supabase.rpc('delete_support_ticket', { p_coaching_id: coachingId });
      setSupportInbox(prev => prev.filter(t => t.coaching_id !== coachingId));
      setSupportTicket(null);
      setSupportAdminDraft('');
      setConfirmDeleteTicket(false);
    } finally {
      setDeletingTicket(false);
    }
  };

  const handleChangePassword = async () => {
    if (pwLoading) return;
    if (pwNew.length < 6) { setPwMsg({ text: 'Password must be at least 6 characters', ok: false }); return; }
    if (pwNew !== pwConfirm) return;
    setPwLoading(true); setPwMsg(null);
    try {
      const { error: signInErr } = await LB.supabase.auth.signInWithPassword({ email: store.user?.email || '', password: pwCurrent });
      if (signInErr) { setPwMsg({ text: 'Current password is incorrect', ok: false }); return; }
      const { error: updateErr } = await LB.supabase.auth.updateUser({ password: pwNew });
      if (updateErr) { setPwMsg({ text: updateErr.message || 'Failed to update password', ok: false }); }
      else { setPwMsg({ text: 'Password updated successfully', ok: true }); setPwCurrent(''); setPwNew(''); setPwConfirm(''); }
    } catch (e) {
      setPwMsg({ text: e.message || 'Something went wrong', ok: false });
    } finally {
      setPwLoading(false);
    }
  };

  const handleChangeEmail = async () => {
    if (emailLoading) return;
    const trimmed = emailNew.trim().toLowerCase();
    if (!trimmed.includes('@') || !trimmed.includes('.')) { setEmailMsg({ text: 'Please enter a valid email address', ok: false }); return; }
    if (trimmed === (store.user?.email || '').toLowerCase()) { setEmailMsg({ text: 'This is already your current email address', ok: false }); return; }
    setEmailLoading(true); setEmailMsg(null);
    try {
      const { error } = await LB.supabase.auth.updateUser({ email: trimmed });
      if (error) { setEmailMsg({ text: error.message || 'Failed to update email', ok: false }); }
      else { setEmailMsg({ text: `Confirmation link sent to ${trimmed} — click the link in your new inbox to complete the change`, ok: true }); }
    } catch (e) {
      setEmailMsg({ text: e.message || 'Something went wrong', ok: false });
    } finally {
      setEmailLoading(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!await confirm('This action cannot be undone.', { title: 'Delete all data?', ok: 'Delete all', danger: true })) return;
    await LB.deleteAllData(userId); await LB.signOut();
  };

  // QS
  const currentEmail = store.user?.email || '';
  const otherQsEmail = LB.QS_EMAILS.find(e => e !== currentEmail);
  const isQsUser = LB.QS_EMAILS.includes(currentEmail) && !!otherQsEmail;
  const hasQsSession = isQsUser ? LB.hasQuickSwitchSession(otherQsEmail) : false;
  const currentName = store.user?.name || currentEmail.split('@')[0];
  const otherName = isQsUser ? (LB.getQsName(otherQsEmail) || otherQsEmail.split('@')[0]) : '';

  // Coaching derived values
  const hasCoaching = !!((store.coaching?.asCoach || []).filter(c => c.status === 'active').length > 0 || store.coaching?.asClient?.status === 'active');
  const selfOn = !!store.settings?.beYourOwnCoach;
  const coachingTabOn = !!(store.settings?.showCoachingTab || hasCoaching || selfOn);

  const toggleTab = () => {
    const turningOff = coachingTabOn;
    setStore(s => ({ ...s, settings: { ...s.settings, showCoachingTab: !coachingTabOn, ...(turningOff ? { beYourOwnCoach: false } : {}) } }));
  };
  const toggleSelf = async () => {
    const next = !selfOn;
    setStore(s => ({ ...s, settings: { ...s.settings, beYourOwnCoach: next } }));
    if (next) {
      try {
        await LB.enableSelfCoaching();
        const cs = await LB.reloadCoachingState(userId);
        setStore(s => s ? { ...s, coaching: cs } : s);
      } catch (e) {
        setStore(s => ({ ...s, settings: { ...s.settings, beYourOwnCoach: false } }));
      }
    } else {
      const selfId = store.coaching?.asSelf?.id;
      if (selfId) {
        try {
          await LB.endCoaching(selfId);
          const cs = await LB.reloadCoachingState(userId);
          setStore(s => s ? { ...s, coaching: cs } : s);
        } catch (e) {
          setStore(s => ({ ...s, settings: { ...s.settings, beYourOwnCoach: true } }));
        }
      }
    }
  };

  const activeCount = activeSessions.filter(s => !s.is_finished).length;

  return (
    <Screen scroll={false}>
      <TopBar title="Settings" onBack={() => go({ name: 'home' })} />
      <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* ─── User ─── */}
        <Frame style={{ padding: '12px 14px' }}>
          <div className="micro" style={{ marginBottom: 6 }}>Nickname</div>
          <input value={nickname} onChange={e => setNickname(e.target.value)} onBlur={saveNickname} onKeyDown={e => e.key === 'Enter' && e.target.blur()} placeholder="Your name"
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: UI.ink, fontFamily: UI.fontUi, fontSize: 15, fontWeight: 500, padding: '0 0 2px', boxSizing: 'border-box' }} />
          <div className="micro" style={{ marginTop: 4 }}>{store.user?.email || userId}</div>
        </Frame>

        {/* ─── Category navigation ─── */}
        <Frame style={{ padding: '0 14px' }}>
          <NavRow label="Changelog" hint={(window.WHATS_NEW || [])[0]?.id} onTap={() => setChangelogSheet(true)} accent first />
          <NavRow label="How to…" onTap={() => setHowToSheet(true)} />
          {hasActiveUsersAccess && (
            <NavRow label="Active users" hint={activeCount > 0 ? `${activeCount} active` : null} onTap={() => setActiveUsersSheet(true)} />
          )}
          <NavRow label="Coaching" onTap={() => setCoachingSheet(true)} />
          <NavRow label="Health" onTap={() => setHealthSheet(true)} />
          <NavRow label="Account" onTap={() => setAccountSheet(true)} />
          <NavRow label="Training" onTap={() => setTrainingSheet(true)} />
          <NavRow label="Appearance" onTap={() => setAppearanceSheet(true)} />
          <NavRow label="Data" onTap={() => setDataSheet(true)} />
        </Frame>

        {/* ─── Admin: pending registrations ─── */}
        {isAdmin && pendingUsers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div className="label" style={{ color: UI.inkFaint, marginBottom: 8 }}>Pending registrations</div>
            <Frame style={{ padding: '0 16px' }}>
              {pendingUsers.map((u, i) => (
                <React.Fragment key={u.user_id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || '—'}</div>
                      <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                    </div>
                    <button onClick={() => approveUser(u.user_id)} disabled={!!approvingId || !!decliningId} style={{
                      padding: '6px 12px', borderRadius: 4,
                      background: approvingId === u.user_id ? UI.goldFaint : 'rgba(var(--accent-rgb),0.12)',
                      border: `1px solid rgba(var(--accent-rgb),0.3)`,
                      color: UI.gold, fontFamily: UI.fontUi, fontSize: 10,
                      letterSpacing: '0.1em', textTransform: 'uppercase',
                      cursor: approvingId === u.user_id ? 'default' : 'pointer', flexShrink: 0,
                    }}>
                      {approvingId === u.user_id ? '…' : 'Approve'}
                    </button>
                    <button onClick={() => declineUser(u.user_id)} disabled={!!approvingId || !!decliningId} style={{
                      padding: '6px 12px', borderRadius: 4,
                      background: 'transparent',
                      border: `1px solid rgba(var(--danger-rgb),0.25)`,
                      color: 'rgba(var(--danger-rgb),0.7)', fontFamily: UI.fontUi, fontSize: 10,
                      letterSpacing: '0.1em', textTransform: 'uppercase',
                      cursor: decliningId === u.user_id ? 'default' : 'pointer', flexShrink: 0,
                    }}>
                      {decliningId === u.user_id ? '…' : 'Decline'}
                    </button>
                  </div>
                  {i < pendingUsers.length - 1 && <div className="knurl" />}
                </React.Fragment>
              ))}
            </Frame>
          </div>
        )}
      </div>
      </div>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 20px', paddingBottom: 'calc(env(safe-area-inset-bottom, 8px) + 16px)', borderTop: `0.5px solid ${UI.hair}`, background: UI.bg }}>
        <Btn kind="ghost" onClick={async () => { await LB.clearPrecompileCaches(); window.location.reload(true); }}>Clear cache &amp; reload</Btn>
        {isAdmin ? (() => {
          const unseenCount = allUsers.filter(isNewSignup).length;
          const adminUnread = supportInbox.reduce((sum, t) => sum + Number(t.unread_count || 0), 0);
          const hasBadge = unseenCount > 0 || adminUnread > 0;
          return (
            <Btn kind="ghost" onClick={() => setAdminSheet(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              Admin
              {hasBadge && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, animation: 'pulseDot 1.5s ease-in-out infinite' }} />}
            </Btn>
          );
        })() : (
          <Btn kind="ghost" onClick={() => setSupportSheet(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            Support Center
            {store.supportUnread > 0 && (
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, animation: 'pulseDot 1.5s ease-in-out infinite' }} />
            )}
          </Btn>
        )}
        <Btn kind="ghost" onClick={handleSignOut} style={{ color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.2)' }}>Sign out</Btn>
        <div className="micro" style={{ textAlign: 'center', marginTop: 4 }}>Zane · {swVersion || '…'} · Data in Supabase</div>
      </div>

      {confirmEl}

      {/* ══ Active Users Sheet ══ */}
      <SettingsSheet open={activeUsersSheet} onClose={() => setActiveUsersSheet(false)} title="Active users">
        {(() => {
          const dismissed = JSON.parse(localStorage.getItem('logbook-dismissed-sessions') || '[]');
          const hiddenCount = activeSessions.filter(s => s.is_finished && dismissed.includes(s.session_id)).length;
          const visibleSessions = activeSessions.filter(s => !s.is_finished || !dismissed.includes(s.session_id));
          const sortedSessions = [...visibleSessions].sort((a, b) =>
            new Date(b.ended ?? b.started_at) - new Date(a.ended ?? a.started_at)
          );
          return (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {hiddenCount > 0 && (
                <button onClick={() => { localStorage.removeItem('logbook-dismissed-sessions'); setActiveSessions(s => [...s]); }} style={{
                  alignSelf: 'flex-end', background: 'none', border: 'none', cursor: 'pointer',
                  color: UI.gold, fontFamily: UI.fontUi, fontSize: 10,
                  letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 0 10px',
                }}>Show all ({hiddenCount} hidden)</button>
              )}
              {sortedSessions.length === 0
                ? <div className="micro" style={{ color: UI.inkFaint, padding: '4px 0' }}>Nobody training right now.</div>
                : sortedSessions.map((s, i) => {
                  const isFinished = s.is_finished;
                  if (isFinished) {
                    const finishedMin = s.ended ? Math.round((nowS - new Date(s.ended).getTime()) / 60000) : null;
                    const finishedStr = finishedMin != null ? (finishedMin < 60 ? `${finishedMin}m ago` : `${Math.round(finishedMin / 60)}h ago`) : 'done';
                    return (
                      <div key={s.session_id} onClick={() => go({ name: 'spectator', targetUserId: s.user_id, userName: s.user_name, sessionId: s.session_id })}
                        style={{ display: 'grid', gridTemplateColumns: '12px 1fr 1fr 1fr', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: UI.inkFaint }} />
                        <span style={{ fontSize: 13, color: UI.inkSoft, fontWeight: 500, fontFamily: UI.fontUi }}>{s.user_name}</span>
                        <span className="display-it" style={{ fontSize: 13, color: UI.inkFaint, textAlign: 'center' }}>{s.day_name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{finishedStr}</span>
                          <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>
                        </div>
                      </div>
                    );
                  }
                  const blended = LB.calcBlended(s.started_at, s.avg_duration_seconds, s.avg_sets_total, s.sets_done, s.sets_total, nowS);
                  const remMin = blended?.remainingMin ?? null; const ratio = blended?.progress ?? null; const finishing = remMin === 0;
                  return (
                    <div key={s.session_id || i} onClick={() => go({ name: 'spectator', targetUserId: s.user_id, userName: s.user_name })}
                      style={{ display: 'grid', gridTemplateColumns: '12px 1fr 1fr 1fr', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: 'pulseDot 1.4s ease-in-out infinite' }} />
                      <span style={{ fontSize: 13, color: UI.ink, fontWeight: 500, fontFamily: UI.fontUi }}>{s.user_name}</span>
                      <span className="display-it" style={{ fontSize: 13, color: UI.inkSoft, textAlign: 'center' }}>{s.day_name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                        {ratio !== null ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                            <span className="num" style={{ fontSize: 11, color: finishing ? 'var(--accent-light)' : 'var(--accent)' }}>{finishing ? 'soon' : `~${remMin}m`}</span>
                            <div style={{ width: 40, height: 2, borderRadius: 999, background: UI.hairStrong, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${ratio * 100}%`, background: 'var(--accent)', borderRadius: 999 }} />
                            </div>
                          </div>
                        ) : <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{s.sets_done}/{s.sets_total}</span>}
                        <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>
                      </div>
                    </div>
                  );
                })
              }
              {isAdmin && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: `0.5px solid ${UI.hair}` }}>
                  <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>ACCESS</div>
                  {activeGrants.length === 0 && <div className="micro" style={{ color: UI.inkGhost, marginBottom: 8 }}>No other users have access yet.</div>}
                  {activeGrants.map(email => (
                    <div key={email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `0.5px solid ${UI.hair}` }}>
                      <span style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi }}>{email}</span>
                      <button onClick={() => removeGrant(email)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.danger, fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input value={newGrantEmail} onChange={e => setNewGrantEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addGrant()} placeholder="email@example.com"
                      style={{ flex: 1, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '7px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none' }} />
                    <button onClick={addGrant} disabled={!newGrantEmail.includes('@')} style={{ padding: '7px 14px', borderRadius: 4, border: 'none', cursor: 'pointer', background: newGrantEmail.includes('@') ? UI.gold : UI.bgInset, color: newGrantEmail.includes('@') ? '#0a0805' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>Add</button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Coaching Sheet ══ */}
      <SettingsSheet open={coachingSheet} onClose={() => setCoachingSheet(false)} title="Coaching">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Coaching tab" first>
            <Toggle on={coachingTabOn} onToggle={toggleTab} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Pin the coaching tab to the nav bar. Shows automatically when a coaching relationship is active.
          </div>
          {coachingTabOn && (
            <div style={{ marginTop: 12 }}>
              <Row label="Be your own coach">
                <Toggle on={selfOn} onToggle={toggleSelf} />
              </Row>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
                Track your own training like a coach would — stats, nutrition, check-ins & notes, just for you.
              </div>
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setCoachingSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health Sheet ══ */}
      <SettingsSheet open={healthSheet} onClose={() => setHealthSheet(false)} title="Health">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Health tab" first>
            <Toggle on={!!store.settings?.showHealthTab} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, showHealthTab: !s.settings?.showHealthTab } }))} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Pin a Health tab to the nav bar to log daily weight, steps & macros and see your trends. These daily logs also prefill your weekly coach check-in.
          </div>

          <div className="micro" style={{ color: UI.inkFaint, margin: '20px 0 8px' }}>GLUCOSE</div>
          <Row label="Blood glucose unit" first last>
            <div style={{ display: 'flex', gap: 0, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, overflow: 'hidden' }}>
              {['mmol', 'mgdl'].map(u => (
                <button key={u} onClick={() => setStore(s => ({ ...s, settings: { ...s.settings, glucoseUnit: u } }))}
                  style={{ padding: '5px 12px', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600,
                    background: (store.settings?.glucoseUnit ?? 'mmol') === u ? 'var(--accent)' : 'transparent',
                    color: (store.settings?.glucoseUnit ?? 'mmol') === u ? '#0a0805' : UI.inkSoft,
                    border: 'none', cursor: 'pointer', transition: 'background 0.15s' }}>
                  {u === 'mmol' ? 'mmol/L' : 'mg/dL'}
                </button>
              ))}
            </div>
          </Row>

          {(store.statusPeriods || []).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <NavRow label="Sick & Vacation periods" hint={`${(store.statusPeriods || []).length}`} onTap={() => { setShowAllPeriods(false); setPeriodsSheet(true); }} />
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setHealthSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Sick & Vacation Periods Sheet ══ */}
      <SettingsSheet open={periodsSheet} onClose={() => setPeriodsSheet(false)} title="Sick & Vacation periods">
        {(() => {
          const allPeriods = (store.statusPeriods || []);
          const PREVIEW = 5;
          const visible = showAllPeriods ? allPeriods : allPeriods.slice(0, PREVIEW);
          const todayStr = LB.todayISO();
          const updatePeriod = async (id, patch) => {
            let prev = null;
            setStore(s => { prev = s.statusPeriods || []; return { ...s, statusPeriods: (s.statusPeriods || []).map(p => p.id === id ? { ...p, ...patch } : p) }; });
            const { error } = await LB.supabase.from('zane_status_periods').update(
              Object.fromEntries(Object.entries(patch).map(([k, v]) => [k === 'startedAt' ? 'started_at' : k === 'endedAt' ? 'ended_at' : k, v]))
            ).eq('id', id);
            if (error) {
              if (prev) setStore(s => ({ ...s, statusPeriods: prev }));
              await confirm(error.message || 'Could not update this period.', { title: 'Update failed', ok: 'OK' });
            }
          };
          const deletePeriod = async (id) => {
            setConfirmDeletePeriodId(null);
            let prev = null;
            setStore(s => { prev = s.statusPeriods || []; return { ...s, statusPeriods: (s.statusPeriods || []).filter(p => p.id !== id) }; });
            const { error } = await LB.supabase.from('zane_status_periods').delete().eq('id', id);
            if (error) {
              if (prev) setStore(s => ({ ...s, statusPeriods: prev }));
              await confirm(error.message || 'Could not delete this period.', { title: 'Delete failed', ok: 'OK' });
            }
          };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {visible.map((p, i) => {
                const isActive = !p.endedAt;
                const icon = p.mode === 'sick' ? 'fa-bed-pulse' : p.mode === 'deload' ? 'fa-arrow-trend-down' : 'fa-umbrella-beach';
                const label = p.mode === 'sick' ? 'SICK' : p.mode === 'deload' ? 'DELOAD' : 'VACATION';
                return (
                  <div key={p.id}>
                    {i > 0 && <div className="knurl" />}
                    <div style={{ padding: '12px 0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <i className={`fa-solid ${icon}`} style={{ fontSize: 13, color: 'var(--accent)', marginTop: 2, width: 16, textAlign: 'center', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="micro" style={{ color: 'var(--accent)', marginBottom: 6 }}>{label}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input type="date" value={p.startedAt.slice(0, 10)} max={p.endedAt ? p.endedAt.slice(0, 10) : todayStr}
                            onChange={e => e.target.value && updatePeriod(p.id, { startedAt: LB.parseDate(e.target.value).toISOString() })}
                            style={{ background: 'transparent', border: 'none', color: UI.inkSoft, fontFamily: UI.fontNum, fontSize: 12, cursor: 'pointer', outline: 'none', padding: 0 }} />
                          <span style={{ color: UI.inkFaint, fontSize: 11, fontFamily: UI.fontUi }}>→</span>
                          {isActive
                            ? <span style={{ fontSize: 12, fontFamily: UI.fontUi, color: 'var(--accent)', fontStyle: 'italic' }}>ongoing</span>
                            : <input type="date" value={p.endedAt.slice(0, 10)} min={p.startedAt.slice(0, 10)} max={todayStr}
                                onChange={e => e.target.value && updatePeriod(p.id, { endedAt: LB.parseDate(e.target.value).toISOString() })}
                                style={{ background: 'transparent', border: 'none', color: UI.inkSoft, fontFamily: UI.fontNum, fontSize: 12, cursor: 'pointer', outline: 'none', padding: 0 }} />
                          }
                        </div>
                      </div>
                      {confirmDeletePeriodId !== p.id && (
                        <button onClick={() => setConfirmDeletePeriodId(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: UI.inkFaint, WebkitTapHighlightColor: 'transparent', flexShrink: 0 }}>
                          <i className="fa-solid fa-trash-can" style={{ fontSize: 12 }} />
                        </button>
                      )}
                    </div>
                    {confirmDeletePeriodId === p.id && (
                      <div style={{ display: 'flex', gap: 8, paddingBottom: 14 }}>
                        <button onClick={() => setConfirmDeletePeriodId(null)} style={{ flex: 1, padding: '11px', background: UI.bgRaised, border: `0.5px solid ${UI.hair}`, borderRadius: 6, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, color: UI.inkFaint, WebkitTapHighlightColor: 'transparent' }}>Cancel</button>
                        <button onClick={() => deletePeriod(p.id)} style={{ flex: 1, padding: '11px', background: 'rgba(var(--danger-rgb),0.12)', border: '0.5px solid rgba(var(--danger-rgb),0.4)', borderRadius: 6, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, color: UI.danger, WebkitTapHighlightColor: 'transparent' }}>Delete</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {!showAllPeriods && allPeriods.length > PREVIEW && (
                <button onClick={() => setShowAllPeriods(true)} style={{ width: '100%', marginTop: 8, padding: '7px 0', background: 'none', border: `0.5px solid ${UI.hair}`, borderRadius: 4, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', letterSpacing: '0.04em' }}>
                  Show all ({allPeriods.length})
                </button>
              )}
              {allPeriods.length === 0 && (
                <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No periods recorded yet.</div>
              )}
              <div style={{ marginTop: 24 }}>
                <Btn style={{ width: '100%' }} onClick={() => setPeriodsSheet(false)}>Done</Btn>
              </div>
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Account Sheet ══ */}
      <SettingsSheet open={accountSheet} onClose={() => setAccountSheet(false)} title="Account">
        <div>
          {isQsUser && (
            <>
              <div className="micro" style={{ marginBottom: 10 }}>Quick switch</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <div style={{ flex: 1, background: `linear-gradient(135deg, rgba(var(--accent-rgb),0.10), rgba(var(--accent-rgb),0.03))`, border: `0.5px solid ${UI.goldSoft}`, borderRadius: 6, padding: '10px 12px' }}>
                  <div className="micro-gold" style={{ marginBottom: 4 }}>Active</div>
                  <div style={{ fontFamily: UI.fontDisplay, fontSize: 18, color: UI.ink, lineHeight: 1.1 }}>{currentName}</div>
                </div>
                <button disabled={qsSwitching} onClick={async () => {
                  if (hasQsSession) { setQsSwitching(true); try { await LB.quickSwitch(otherQsEmail); window.location.reload(); } catch (e) { setQsSwitching(false); } }
                  else { const ok = await confirm(`You'll be signed out so ${otherName} can log in.`, { title: 'Set up quick switch?', ok: 'Sign out' }); if (ok) await LB.signOut(); }
                }} style={{ flex: 1, background: 'transparent', border: `0.5px solid ${hasQsSession ? UI.hair : UI.hairStrong}`, borderRadius: 6, padding: '10px 12px', textAlign: 'left', cursor: qsSwitching ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent', opacity: qsSwitching ? 0.5 : 1 }}>
                  <div className="micro" style={{ marginBottom: 4, color: hasQsSession ? UI.inkFaint : 'rgba(var(--danger-rgb),0.7)' }}>{qsSwitching ? 'Switching…' : hasQsSession ? 'Tap to switch' : 'Log in first'}</div>
                  <div style={{ fontFamily: UI.fontDisplay, fontSize: 18, color: hasQsSession ? UI.inkSoft : UI.inkFaint, lineHeight: 1.1 }}>{otherName}</div>
                </button>
              </div>
              <Hairline style={{ marginBottom: 14 }} />
            </>
          )}
          {''}
          <Row label="Push notifications" first>
            <button style={accentBtn} onClick={() => setPushSheet(true)}>Configure</button>
          </Row>
          <Hairline style={{ margin: '14px 0' }} />
          {typeof window !== 'undefined' && window.PublicKeyCredential && (
            <>
              <NavRow label="Passkeys" onTap={() => setPasskeySheet(true)} first />
              <Hairline style={{ margin: '14px 0' }} />
            </>
          )}
          <NavRow label="Change password" onTap={() => { setPwMsg(null); setPwCurrent(''); setPwNew(''); setPwConfirm(''); setChangePasswordSheet(true); }} first />
          <Hairline style={{ margin: '14px 0' }} />
          <NavRow label="Change email" onTap={() => { setEmailMsg(null); setEmailNew(''); setChangeEmailSheet(true); }} first />
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setAccountSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Passkey Sheet ══ */}
      <PasskeySheet open={passkeySheet} onClose={() => setPasskeySheet(false)} />

      {/* ══ Change Password Sheet ══ */}
      <SettingsSheet open={changePasswordSheet} onClose={() => { setChangePasswordSheet(false); setPwCurrent(''); setPwNew(''); setPwConfirm(''); setPwMsg(null); }} title="Change password">
        {(() => {
          const iStyle = SETTINGS_INPUT_STYLE;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 8 }}>
              <div>
                <div className="micro" style={{ marginBottom: 6 }}>CURRENT PASSWORD</div>
                <input type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} placeholder="Current password" style={iStyle} autoComplete="current-password" />
              </div>
              <div>
                <div className="micro" style={{ marginBottom: 6 }}>NEW PASSWORD</div>
                <input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="Min. 6 characters" style={iStyle} autoComplete="new-password" />
              </div>
              <div>
                <div className="micro" style={{ marginBottom: 6 }}>CONFIRM NEW PASSWORD</div>
                <input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChangePassword()} placeholder="Repeat new password" style={iStyle} autoComplete="new-password" />
                {pwConfirm.length > 0 && pwNew !== pwConfirm && (
                  <div style={{ fontSize: 12, color: UI.danger, fontFamily: UI.fontUi, marginTop: 6 }}>Passwords do not match</div>
                )}
              </div>
              {pwMsg && (
                <div style={{ fontSize: 12, color: pwMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi, padding: '8px 12px', background: pwMsg.ok ? 'rgba(var(--accent-rgb),0.08)' : 'rgba(var(--danger-rgb),0.08)', borderRadius: 6 }}>
                  {pwMsg.text}
                </div>
              )}
              {!pwMsg?.ok
                ? <Btn onClick={handleChangePassword} disabled={!pwCurrent || !pwNew || !pwConfirm || pwNew !== pwConfirm || pwLoading}>{pwLoading ? 'Updating…' : 'Update password'}</Btn>
                : <Btn kind="ghost" onClick={() => { setChangePasswordSheet(false); setPwMsg(null); }}>Done</Btn>
              }
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Change Email Sheet ══ */}
      <SettingsSheet open={changeEmailSheet} onClose={() => { setChangeEmailSheet(false); setEmailNew(''); setEmailMsg(null); }} title="Change email">
        {(() => {
          const iStyle = SETTINGS_INPUT_STYLE;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 8 }}>
              <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.6 }}>
                Current: <span style={{ color: UI.inkSoft }}>{store.user?.email || ''}</span>
              </div>
              <div>
                <div className="micro" style={{ marginBottom: 6 }}>NEW EMAIL ADDRESS</div>
                <input type="email" value={emailNew} onChange={e => setEmailNew(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChangeEmail()} placeholder="new@example.com" style={iStyle} autoComplete="email" autoCapitalize="none" spellCheck={false} />
              </div>
              {emailMsg && (
                <div style={{ fontSize: 12, color: emailMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi, padding: '8px 12px', background: emailMsg.ok ? 'rgba(var(--accent-rgb),0.08)' : 'rgba(var(--danger-rgb),0.08)', borderRadius: 6, lineHeight: 1.55 }}>
                  {emailMsg.text}
                </div>
              )}
              {!emailMsg?.ok
                ? <Btn onClick={handleChangeEmail} disabled={!emailNew.trim() || emailLoading}>{emailLoading ? 'Sending…' : 'Send confirmation'}</Btn>
                : <Btn kind="ghost" onClick={() => { setChangeEmailSheet(false); setEmailNew(''); setEmailMsg(null); }}>Done</Btn>
              }
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Training Sheet ══ */}
      <SettingsSheet open={trainingSheet} onClose={() => setTrainingSheet(false)} title="Training">
        <div>
          <NavRow label="Session" first onTap={() => setSessionBehaviourSheet(true)} />
          <NavRow label="Weights & Progression" onTap={() => setWeightsProgressionSheet(true)} />
          <NavRow label="Notifications" onTap={() => setNotificationsGroupSheet(true)} />
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setTrainingSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Training › Session ══ */}
      <SettingsSheet open={sessionBehaviourSheet} onClose={() => setSessionBehaviourSheet(false)} title="Session">
        <div>
          <Row label="Rest timers" first>
            <button style={accentBtn} onClick={() => setRestSheet(true)}>Change</button>
          </Row>
          <Row label="Auto-end session">
            <button style={accentBtn} onClick={() => setTimeoutSheet(true)}>
              {(store.settings?.sessionTimeoutMinutes ?? 90) !== 90 ? `${store.settings.sessionTimeoutMinutes} min` : 'Change'}
            </button>
          </Row>
          <Row label="Paceguard">
            {store.settings?.tempoEnabled
              ? <button style={accentBtn} onClick={() => setPaceguardSheet(true)}>Change</button>
              : <Toggle on={false} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, tempoEnabled: true } }))} />
            }
          </Row>
          <Row label="Warmup sets in summary">
            <Toggle on={showWarmupInSummary} onToggle={() => { const n = !showWarmupInSummary; setShowWarmupInSummary(n); setStore(s => ({ ...s, settings: { ...s.settings, showWarmupInSummary: n } })); }} />
          </Row>
          <Row label="Regression indicator">
            <Toggle on={store.settings?.showRegression !== false} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, showRegression: s.settings?.showRegression === false } }))} />
          </Row>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setSessionBehaviourSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Training › Weights & Progression ══ */}
      <SettingsSheet open={weightsProgressionSheet} onClose={() => setWeightsProgressionSheet(false)} title="Weights & Progression">
        <div>
          <Row label="Smart progression" first>
            {store.settings?.smartProgression
              ? <button style={accentBtn} onClick={() => setProgressionSheet(true)}>Change</button>
              : <Toggle on={false} onToggle={() => { setStore(s => ({ ...s, settings: { ...s.settings, smartProgression: true } })); setProgDisclaimer(true); }} />
            }
          </Row>
          <Row label="Equipment setup">
            <button style={accentBtn} onClick={() => setProgConfigOpen(true)}>Change</button>
          </Row>
          <Row label="Plate inventory">
            <button style={accentBtn} onClick={() => setPlateInventoryOpen(true)}>Change</button>
          </Row>
          <Row label="Fill weight down">
            <Toggle on={store.settings?.weightFillDown !== false} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, weightFillDown: s.settings?.weightFillDown === false } }))} />
          </Row>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setWeightsProgressionSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Training › Notifications ══ */}
      <SettingsSheet open={notificationsGroupSheet} onClose={() => setNotificationsGroupSheet(false)} title="Notifications">
        <div>
          <Row label="Remind on training days" first>
            {reminderEnabled
              ? <button style={accentBtn} onClick={() => setReminderSheet(true)}>{store.settings?.reminderTime || 'Change'}</button>
              : <Toggle on={false} onToggle={toggleReminder} />
            }
          </Row>
          {!pushEnabled && (
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
              Requires push notifications — toggling will open the push setup.
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setNotificationsGroupSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Appearance Sheet ══ */}
      <SettingsSheet open={appearanceSheet} onClose={() => setAppearanceSheet(false)} title="Appearance">
        <div>
          <div className="micro" style={{ marginBottom: 10 }}>Accent color</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px 0', marginBottom: 14 }}>
            {Object.entries(window.ACCENT_PALETTE).map(([key, c]) => {
              const active = (store.settings?.accentColor ?? 'copper') === key;
              return (
                <button key={key} onClick={() => { window.applyAccentColor(key); localStorage.setItem('logbook-accent-color', key); setStore(s => ({ ...s, settings: { ...s.settings, accentColor: key } })); }}
                  title={c.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
                  <div style={{ width: active ? 32 : 26, height: active ? 32 : 26, borderRadius: '50%', background: c.hex, border: active ? `2.5px solid ${UI.ink}` : '2px solid transparent', boxShadow: active ? `0 0 0 1.5px ${c.hex}` : 'none', transition: 'all 0.18s' }} />
                  {active && <span style={{ fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 600, color: 'var(--accent)' }}>{c.label}</span>}
                </button>
              );
            })}
          </div>
          <Row label="Week view in cycle mode" first>
            <Toggle on={cycleWeekView} onToggle={() => { const n = !cycleWeekView; setCycleWeekView(n); localStorage.setItem('logbook-cycle-week-view', String(n)); setStore(s => ({ ...s, settings: { ...s.settings, cycleWeekView: n } })); }} />
          </Row>
          <Row label="Theme">
            <div style={{ display: 'flex', gap: 4 }}>
              {[['dark', 'Dark'], ['black', 'OLED'], ['light', 'Light']].map(([key, label]) => (
                <button key={key} onClick={() => { setDarkMode(key); localStorage.setItem('logbook-dark-mode', key); window.applyDarkMode(key); setStore(s => ({ ...s, settings: { ...s.settings, darkMode: key } })); }} style={{
                  padding: '6px 11px', borderRadius: 4, cursor: 'pointer',
                  background: darkMode === key ? UI.goldFaint : UI.bgInset,
                  border: `1px solid ${darkMode === key ? UI.goldSoft : UI.hairStrong}`,
                  color: darkMode === key ? UI.gold : UI.inkSoft,
                  fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>{label}</button>
              ))}
            </div>
          </Row>
          <Row label="Unit preference">
            <button style={accentBtn} onClick={() => setUnitPickerOpen(true)}>
              {store.settings?.unit === 'lbs' ? 'Imperial' : store.settings?.unit === 'mixed' ? 'Mixed' : 'Metric'}
            </button>
          </Row>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setAppearanceSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Data Sheet ══ */}
      <SettingsSheet open={dataSheet} onClose={() => setDataSheet(false)} title="Data">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" onClick={() => exportData()} style={{ flex: 1 }}>Export JSON</Btn>
            <Btn kind="ghost" onClick={() => setImportSheet(true)} disabled={importing} style={{ flex: 1 }}>{importing ? 'Importing…' : 'Import JSON'}</Btn>
          </div>
          <Btn kind="ghost" onClick={handleDeleteAll} style={{ color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.2)' }}>Delete all data</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Import Sheet ══ */}
      <SettingsSheet open={importSheet} onClose={importing ? () => {} : () => setImportSheet(false)} title="Restore backup">
        {importing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: UI.inkSoft, minHeight: 20 }}>{importProgress.phase}</div>
            <div style={{ background: UI.bgInset, borderRadius: 999, height: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 999, background: 'var(--accent)', width: `${importProgress.pct}%`, transition: 'width 0.4s ease' }} />
            </div>
            <div className="num" style={{ fontSize: 11, color: UI.inkFaint, textAlign: 'right' }}>{importProgress.pct}%</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: UI.bgInset, borderRadius: 6, padding: '12px 14px', lineHeight: 1.55, fontSize: 13, color: UI.inkSoft }}>
              <span style={{ color: UI.ink, fontWeight: 600 }}>Step 1:</span> Download a backup of your current data first.{' '}
              <span style={{ color: UI.ink, fontWeight: 600 }}>Step 2:</span> Then pick the file you want to restore.
            </div>
            <Btn kind="ghost" onClick={() => exportData(`zane-before-import-${LB.todayISO()}.json`)}>1 · Backup current data</Btn>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
              <span style={{ fontSize: 12, color: UI.inkSoft }}>Source weight unit</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {['kg', 'lbs'].map(u => (
                  <button key={u} onClick={() => setImportSourceUnit(u)} style={{
                    padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: importSourceUnit === u ? 'var(--accent)' : UI.bgInset,
                    color: importSourceUnit === u ? '#0a0805' : UI.inkSoft,
                  }}>{u.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <Btn kind="ghost" onClick={runImport}>2 · Select file and import</Btn>
          </div>
        )}
      </SettingsSheet>

      {/* ══ How To Sheet ══ */}
      <HowToSheet open={howToSheet} onClose={() => setHowToSheet(false)} />

      {/* ══ Changelog Sheet ══ */}
      <ChangelogSheet open={changelogSheet} onClose={() => setChangelogSheet(false)} />

      {/* ══ Unit picker modal ══ */}
      {unitPickerOpen && window.Screens?.UnitPromptModal && (
        <window.Screens.UnitPromptModal
          onDone={(chosenUnit) => {
            setUnitPickerOpen(false);
            localStorage.setItem('logbook-unit-prompted', '1');
            // Mixed = kg weight + mi distance; sync the cardio dist key so
            // all cardio screens immediately reflect the chosen distance unit.
            const distUnit = chosenUnit === 'lbs' ? 'mi' : chosenUnit === 'mixed' ? 'mi' : 'km';
            LB.setCardioDistUnit(distUnit);
            setStore(s => s ? { ...s, settings: { ...s.settings, unit: chosenUnit } } : s);
          }}
        />
      )}

      {/* ══ Auto-end session sheet ══ */}
      <SettingsSheet open={timeoutSheet} onClose={() => setTimeoutSheet(false)} title="Auto-end session">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 8 }}>
          <div>
            <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>INACTIVITY TIMEOUT</div>
            <Stepper value={store.settings?.sessionTimeoutMinutes ?? 90} step={15} min={15} max={480} suffix=" min"
              onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, sessionTimeoutMinutes: v } }))} />
          </div>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>
            Open sessions with no new sets for this long are automatically ended. Sessions with no sets at all are silently deleted.
          </div>
          <Btn onClick={() => setTimeoutSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Rest timers sheet ══ */}
      <SettingsSheet open={restSheet} onClose={() => setRestSheet(false)} title="Rest timers">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {[['Default', 'restDefault', 120], ['Big', 'restBig', 180], ['Medium', 'restMedium', 120], ['Small', 'restSmall', 90]].map(([label, key, def]) => (
              <div key={key}>
                <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>{label.toUpperCase()}</div>
                <Stepper value={store.settings?.[key] ?? def} step={15} min={0} suffix="s"
                  onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, [key]: v } }))} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', background: UI.bgRaised, borderRadius: 6, border: `1px solid ${UI.hairStrong}` }}>
            {[['BIG', 'Heavy compounds — squat, deadlift, overhead press'], ['MEDIUM', 'Moderate compounds — bench, pull-up, lunge'], ['SMALL', 'Isolation — bicep curl, lateral raise, tricep extension']].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span className="micro" style={{ color: UI.gold, flexShrink: 0, minWidth: 46 }}>{k}</span>
                <span className="micro" style={{ color: UI.inkSoft, letterSpacing: '0.04em', textTransform: 'none', fontWeight: 400 }}>{v}</span>
              </div>
            ))}
            <div style={{ marginTop: 4, borderTop: `1px solid ${UI.hair}`, paddingTop: 6 }}>
              <span className="micro" style={{ color: UI.inkFaint, letterSpacing: '0.04em', textTransform: 'none', fontWeight: 400, lineHeight: 1.5 }}>
                BIG / MEDIUM / SMALL only apply when the exercise has its size set. Default is used otherwise.
              </span>
            </div>
          </div>
          <Btn onClick={() => setRestSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Paceguard sheet ══ */}
      <SettingsSheet open={paceguardSheet} onClose={() => setPaceguardSheet(false)} title="Paceguard">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <Row label="Enabled" first>
            <Toggle on={!!store.settings?.tempoEnabled} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, tempoEnabled: !s.settings?.tempoEnabled } }))} />
          </Row>
          {store.settings?.tempoEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, paddingTop: 4 }}>
              <div>
                <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>ECCENTRIC (DOWN)</div>
                <Stepper value={store.settings?.tempoEccentric ?? 4} step={0.5} min={0.5} max={10} suffix="s" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, tempoEccentric: v } }))} />
              </div>
              <div>
                <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>CONCENTRIC (UP)</div>
                <Stepper value={store.settings?.tempoConcentric ?? 1} step={0.5} min={0.5} max={10} suffix="s" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, tempoConcentric: v } }))} />
              </div>
            </div>
          )}
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>Beeps subdivide each phase evenly · count increases each beat</div>
          <Btn onClick={() => setPaceguardSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Smart progression sheet ══ */}
      <SettingsSheet open={progressionSheet} onClose={() => setProgressionSheet(false)} title="Smart progression">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <Row label="Enabled" first>
            <Toggle on={!!store.settings?.smartProgression} onToggle={() => { const t = !store.settings?.smartProgression; setStore(s => ({ ...s, settings: { ...s.settings, smartProgression: t } })); if (t) setProgDisclaimer(true); }} />
          </Row>
          {store.settings?.smartProgression && (
            <>
              <div>
                <div className="micro" style={{ marginBottom: 8 }}>REP RANGE TOP (+reps above target)</div>
                <Stepper value={store.settings?.progressionRangeTop ?? 4} step={1} min={1} max={10} suffix=" reps" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, progressionRangeTop: v } }))} />
              </div>
              <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>If target is 8 reps and range top is +4, weight increases only when all sets reach 12 reps. Works the same with per-set rep targets — each set uses its own threshold.</div>
            </>
          )}
          <Btn onClick={() => setProgressionSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Equipment config sheet ══ */}
      <SettingsSheet open={progConfigOpen} onClose={() => setProgConfigOpen(false)} title="Equipment setup">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 72px', gap: 8, padding: '0 4px 8px', borderBottom: `0.5px solid ${UI.hair}` }}>
            <span className="micro">Equipment</span>
            <span className="micro" style={{ textAlign: 'center' }}>Increment</span>
            <span className="micro" style={{ textAlign: 'center' }}>Max {UI.unit()}</span>
          </div>
          {(window.EQUIPMENT_TYPES || []).filter(({ key }) => key !== 'no_equipment' && key !== 'bodyweight').map(({ key, label }) => {
            const cfg = store.settings?.equipmentConfig?.[key] ?? {};
            const setField = (field, val) => setStore(s => ({ ...s, settings: { ...s.settings, equipmentConfig: { ...s.settings?.equipmentConfig, [key]: { ...(s.settings?.equipmentConfig?.[key] ?? {}), [field]: val } } } }));
            return (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 72px', gap: 8, alignItems: 'center', padding: '10px 4px', borderBottom: `0.5px solid ${UI.hair}` }}>
                <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 4, padding: '6px 8px', border: `1px solid ${UI.hair}` }}>
                  <NumInput value={cfg.increment ?? null} placeholder="—" onChange={v => setField('increment', v)} style={{ fontSize: 13, width: '100%' }} />
                  <span className="micro" style={{ flexShrink: 0 }}>{UI.unit()}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 4, padding: '6px 8px', border: `1px solid ${UI.hair}` }}>
                  <NumInput value={cfg.maxKg ?? null} placeholder="—" onChange={v => setField('maxKg', v)} style={{ fontSize: 13, width: '100%' }} />
                  <span className="micro" style={{ flexShrink: 0 }}>{UI.unit()}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.6, marginBottom: 16 }}>Set equipment categories on exercises in the exercise library. Individual overrides can be set per exercise.</div>
        <Btn style={{ width: '100%' }} onClick={() => setProgConfigOpen(false)}>Done</Btn>
      </SettingsSheet>

      {/* ══ Plate inventory sheet ══ */}
      <SettingsSheet open={plateInventoryOpen} onClose={() => setPlateInventoryOpen(false)} title="Plate inventory">
        <div style={{ display: 'flex', gap: 3, marginBottom: 28, background: UI.bgInset, borderRadius: 4, padding: 3 }}>
          {['kg', 'lbs'].map((u, i) => (
            <button key={u} onClick={() => setPlateInvTab(i)} style={{
              flex: 1, padding: '8px 0', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: plateInvTab === i ? 'var(--accent)' : 'transparent',
              color: plateInvTab === i ? '#0a0805' : UI.inkFaint,
              fontFamily: UI.fontUi, fontSize: 12, letterSpacing: '0.06em',
              fontWeight: plateInvTab === i ? 600 : 400, transition: 'all 0.15s',
            }}>{u.toUpperCase()}</button>
          ))}
        </div>
        {(() => {
          const isLbs = plateInvTab === 1;
          const invKey = isLbs ? 'plateInventoryLbs' : 'plateInventoryKg';
          const allPlates = isLbs ? PLATES_LBS : PLATES_KG;
          const plateColors = isLbs ? PLATE_COLORS_LBS : PLATE_COLORS_KG;
          const plateSizes  = isLbs ? PLATE_SIZE_LBS   : PLATE_SIZE_KG;
          const current = store.settings?.equipmentConfig?.[invKey] ?? allPlates;
          const toggle = (p) => {
            // The plate calculator's correction math indexes the smallest
            // available plate (plateSet[plateSet.length - 1]) — an empty
            // inventory turns that into NaN throughout. Refuse to deselect
            // the last remaining plate instead of allowing an empty set.
            if (current.includes(p) && current.length <= 1) return;
            const newInv = current.includes(p)
              ? current.filter(x => x !== p)
              : [...current, p].sort((a, b) => b - a);
            setStore(s => ({ ...s, settings: { ...s.settings, equipmentConfig: { ...s.settings?.equipmentConfig, [invKey]: newInv } } }));
          };
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center', alignItems: 'flex-end', padding: '4px 0 24px' }}>
              {allPlates.map(p => {
                const has = current.includes(p);
                const size = Math.round((plateSizes[p] || 32) * 0.75);
                const hole = Math.round(size * 0.3);
                const color = plateColors[p] || '#808b96';
                return (
                  <div key={p} onClick={() => toggle(p)} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    cursor: 'pointer', opacity: has ? 1 : 0.22, transition: 'opacity 0.18s',
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                    <div style={{
                      width: size, height: size, borderRadius: '50%',
                      background: color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      position: 'relative',
                      boxShadow: has ? `0 4px 14px rgba(0,0,0,0.45), 0 0 0 1.5px rgba(255,255,255,0.15)` : 'none',
                    }}>
                      <div style={{
                        position: 'absolute',
                        width: hole, height: hole, borderRadius: '50%',
                        background: 'var(--bg)',
                      }} />
                    </div>
                    <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft, letterSpacing: '0.02em' }}>{p}</span>
                  </div>
                );
              })}
            </div>
          );
        })()}
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', lineHeight: 1.6, marginBottom: 20 }}>
          Tap a plate to toggle. Dimmed plates are not in your inventory and won't be suggested by the plate calculator.
        </div>
        <Btn style={{ width: '100%' }} onClick={() => setPlateInventoryOpen(false)}>Done</Btn>
      </SettingsSheet>

      {/* ══ Progression disclaimer sheet ══ */}
      <SettingsSheet open={progDisclaimer} onClose={() => setProgDisclaimer(false)} title="Smart Progression">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, lineHeight: 1.6 }}>The reps shown in your sets are <span style={{ color: UI.gold }}>minimum reps</span> — the floor the algorithm needs to track progression.</div>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>Always train past that number. Push to failure or near-failure on each set. The algo only bumps weight when <em>all</em> sets hit the top of the range — so getting extra reps is how you earn the next weight.</div>
        </div>
        <Btn style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setProgDisclaimer(false); setProgressionSheet(true); }}>Got it</Btn>
      </SettingsSheet>

      {/* ══ Admin sheet ══ */}
      <SettingsSheet open={adminSheet} onClose={() => setAdminSheet(false)} title={'Admin'}>
        {(() => {
          const unseenCount = allUsers.filter(isNewSignup).length;
          const adminUnread = supportInbox.reduce((sum, t) => sum + Number(t.unread_count || 0), 0);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Frame style={{ padding: '0 14px' }}>
                <Row label="Registrations need approval" first>
                  <Toggle on={signupApproval !== false} onToggle={toggleSignupApproval} />
                </Row>
                <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 4, lineHeight: 1.5, paddingBottom: 8 }}>
                  When on, new sign-ups wait for approval. When off, accounts activate immediately.
                </div>
                <Row label="Auto-approve batch">
                  <button style={accentBtn} onClick={() => { setBudgetDraft(autoApproveLeft || 20); setBudgetSheet(true); }}>
                    {autoApproveLeft != null ? `${autoApproveLeft} left` : 'Off'}
                  </button>
                </Row>
                <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 4, lineHeight: 1.5, paddingBottom: 8 }}>
                  Open registration for a batch — auto-approved until used up, then turns back on.
                </div>
                <NavRow label="All users" hint={unseenCount > 0 ? `${unseenCount} new` : (allUsers.length ? `${allUsers.length}` : undefined)} onTap={() => setAllUsersSheet(true)} />
                <NavRow label="VIP backgrounds" hint={vipBgList.length > 0 ? `${vipBgList.length} assigned` : 'None'} onTap={() => { setVipBgMsg(null); setVipBgSheet(true); }} />
                <NavRow label="Message all users" onTap={() => { setBroadcastMsg(null); setBroadcastSheet(true); }} />
              </Frame>
              <div style={{ borderTop: `0.5px solid ${UI.hair}`, paddingTop: 16 }}>
                <Btn onClick={() => setSupportInboxSheet(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', fontSize: 15, padding: '14px 16px' }}>
                  Support inbox
                  {adminUnread > 0 && (
                    <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>{adminUnread}</span>
                  )}
                </Btn>
              </div>
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Message all users (admin) ══ */}
      <SettingsSheet open={broadcastSheet} onClose={() => setBroadcastSheet(false)} title="Message All Users">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
            Sends a message into every user's support ticket (creating one first if they don't have one yet) — the same inbox they already use to reach support, so it shows up even on an older app version.
          </div>
          <textarea
            value={broadcastBody}
            onChange={e => setBroadcastBody(e.target.value)}
            placeholder="Message to send to every user…"
            rows={5}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4,
              padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none',
            }}
          />
          {broadcastMsg && (
            <div style={{ fontSize: 12, color: broadcastMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi, padding: '8px 12px', background: broadcastMsg.ok ? 'rgba(var(--accent-rgb),0.08)' : 'rgba(var(--danger-rgb),0.08)', borderRadius: 6 }}>
              {broadcastMsg.text}
            </div>
          )}
          <Btn onClick={sendBroadcast} disabled={!broadcastBody.trim() || broadcastSending}>
            {broadcastSending ? 'Sending…' : 'Send to all users'}
          </Btn>
        </div>
      </SettingsSheet>

      {/* ══ VIP backgrounds sheet (admin) ══ */}
      <SettingsSheet open={vipBgSheet} onClose={() => setVipBgSheet(false)} title="VIP Backgrounds">
        {(() => {
          const opts = vipBgOptions;
          const iStyle = { ...SETTINGS_INPUT_STYLE, padding: '10px 12px' };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="micro" style={{ color: UI.inkFaint }}>EMAIL</div>
                <input
                  type="email"
                  value={vipBgEmail}
                  onChange={e => setVipBgEmail(e.target.value)}
                  placeholder="user@example.com"
                  style={iStyle}
                />
                <div className="micro" style={{ color: UI.inkFaint, marginTop: 4 }}>BACKGROUND</div>
                <select
                  value={vipBgKey}
                  onChange={e => setVipBgKey(e.target.value)}
                  style={{ ...iStyle, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' }}
                  disabled={!opts}
                >
                  <option value="">{opts ? '— None (clear) —' : 'Loading…'}</option>
                  {(opts || []).map(o => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                {vipBgMsg && (
                  <div style={{ fontSize: 12, color: vipBgMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi, padding: '8px 12px', background: vipBgMsg.ok ? 'rgba(var(--accent-rgb),0.08)' : 'rgba(var(--danger-rgb),0.08)', borderRadius: 6 }}>
                    {vipBgMsg.text}
                  </div>
                )}
                <Btn onClick={saveVipBg} disabled={!vipBgEmail.trim() || vipBgSaving}>
                  {vipBgSaving ? 'Saving…' : vipBgKey ? 'Assign background' : 'Clear background'}
                </Btn>
              </div>
              <Frame style={{ padding: '0 14px' }}>
                <NavRow label="Current assignments" hint={vipBgList.length > 0 ? `${vipBgList.length}` : 'None'} first onTap={() => setVipBgListSheet(true)} />
              </Frame>
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ VIP backgrounds — current assignments sub-sheet ══ */}
      <SettingsSheet open={vipBgListSheet} onClose={() => setVipBgListSheet(false)} title="Current Assignments">
        {(() => {
          const opts = vipBgOptions || [];
          if (vipBgList.length === 0) {
            return <div className="micro" style={{ color: UI.inkGhost, padding: '4px 0 12px' }}>No backgrounds assigned yet.</div>;
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
              {vipBgList.map((row, i) => {
                const opt = opts.find(o => o.key === row.bg_key);
                return (
                  <div key={row.email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.email}</div>
                      <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 1 }}>{opt?.label || row.bg_key}</div>
                    </div>
                    <button onClick={() => { setVipBgEmail(row.email); setVipBgKey(''); setVipBgMsg(null); setVipBgListSheet(false); }} style={{ background: 'none', border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '4px 10px', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer', flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
                      Clear
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Auto-approve batch sheet (admin) — rendered after adminSheet so it sits on top ══ */}
      <SettingsSheet open={budgetSheet} onClose={() => setBudgetSheet(false)} title="Auto-approve batch">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <div>
            <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>SIGN-UPS TO AUTO-APPROVE</div>
            <Stepper value={budgetDraft} step={5} min={0} max={500} suffix=" sign-ups" onChange={setBudgetDraft} />
          </div>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>
            The next {budgetDraft > 0 ? budgetDraft : '—'} new accounts skip the waiting screen. Once that many have joined, "Registrations need approval" switches back on automatically. Set to 0 to re-lock now.
          </div>
          <Btn onClick={saveBudget}>{budgetDraft > 0 ? `Open for ${budgetDraft}` : 'Re-lock now'}</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Support Center full-screen sheet (user) ══ */}
      <FullSheet
        open={supportSheet}
        onClose={
          supportView === 'thread'
            ? () => { setSupportView('list'); setSupportActiveTicketId(null); setSupportDraft(''); }
            : supportView === 'new'
            ? () => setSupportView('list')
            : () => setSupportSheet(false)
        }
        title="Support Center"
      >
        {(() => {
          const CATS = [
            { key: 'feature_request', label: 'Feature request', icon: 'fa-lightbulb' },
            { key: 'bug',             label: 'Bug',             icon: 'fa-bug' },
            { key: 'question',        label: 'General question', icon: 'fa-circle-question' },
          ];
          const statusColor = { open: 'var(--accent)', in_progress: UI.gold, resolved: UI.inkFaint };
          const statusLabel = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };
          const tickets = store.supportTickets || [];
          const iStyle = SETTINGS_TEXTAREA_STYLE;

          // ── NEW TICKET VIEW ──────────────────────────────────────────
          if (supportView === 'new') {
            return (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {/* scrollable top section */}
                <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px' }}>
                  <button onClick={() => setSupportView('list')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, textAlign: 'left', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
                    ← Back
                  </button>
                  <div>
                    <div className="micro" style={{ marginBottom: 8 }}>TOPIC</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {CATS.map(c => (
                        <button key={c.key} onClick={() => setSupportCategoryDraft(c.key)} style={{
                          flex: 1, padding: '8px 4px', borderRadius: 6, cursor: 'pointer',
                          border: `0.5px solid ${supportCategoryDraft === c.key ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`,
                          background: supportCategoryDraft === c.key ? 'rgba(var(--accent-rgb),0.1)' : UI.bgInset,
                          color: supportCategoryDraft === c.key ? 'var(--accent)' : UI.inkFaint,
                          fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                          WebkitTapHighlightColor: 'transparent', textAlign: 'center',
                        }}>
                          <i className={`fa-solid ${c.icon}`} style={{ display: 'block', fontSize: 14, marginBottom: 4 }} />
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {/* sticky compose at bottom */}
                <div style={{ flexShrink: 0, borderTop: `0.5px solid ${UI.hair}`, padding: '14px 20px', paddingBottom: 'calc(env(safe-area-inset-bottom, 8px) + 14px)', display: 'flex', flexDirection: 'column', gap: 8, background: UI.bgRaised }}>
                  {supportImagePreview && (
                    <div style={{ position: 'relative', display: 'inline-block', alignSelf: 'flex-start' }}>
                      <img src={supportImagePreview} alt="" style={{ maxHeight: 100, maxWidth: 160, borderRadius: 6, display: 'block', objectFit: 'cover' }} />
                      <button onClick={() => { setSupportImageFile(null); setSupportImagePreview(null); }} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: UI.inkSoft, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11 }}>×</button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea value={supportDraft} onChange={e => setSupportDraft(e.target.value)}
                      placeholder="Describe your request…" rows={4} style={{ ...iStyle, flex: 1 }} />
                    <label style={{ cursor: 'pointer', flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: supportImageFile ? 'rgba(var(--accent-rgb),0.15)' : UI.bgInset, border: `0.5px solid ${supportImageFile ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, color: supportImageFile ? 'var(--accent)' : UI.inkFaint }}>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImagePick} />
                      <i className="fa-solid fa-image" style={{ fontSize: 15 }} />
                    </label>
                  </div>
                  <Btn onClick={handleCreateTicket} disabled={(!supportDraft.trim() && !supportImageFile) || supportSending}>
                    {supportSending ? 'Creating…' : 'Create ticket'}
                  </Btn>
                </div>
              </div>
            );
          }

          // ── THREAD VIEW ──────────────────────────────────────────────
          if (supportView === 'thread') {
            const activeTicket = tickets.find(t => t.coachingId === supportActiveTicketId);
            const statusDot = { open: UI.danger, in_progress: UI.gold, resolved: UI.inkFaint };
            return (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0 }}>
                  <button onClick={() => { setSupportView('list'); setSupportActiveTicketId(null); setSupportDraft(''); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: 0, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
                    ← Back
                  </button>
                  {activeTicket && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot[activeTicket.status] || UI.inkFaint, display: 'inline-block', flexShrink: 0 }} />
                      <span className="micro" style={{ color: UI.inkSoft }}>{statusLabel[activeTicket.status] || activeTicket.status}</span>
                      <span className="micro" style={{ color: UI.inkFaint }}>· {CATS.find(c => c.key === activeTicket.category)?.label}</span>
                    </div>
                  )}
                </div>
                {/* Messages — scrollable */}
                <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 20px', minHeight: 0 }}>
                  {supportActiveLoading && <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '12px 0' }}>Loading…</div>}
                  {!supportActiveLoading && supportActiveNotes.length === 0 && (
                    <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '24px 0' }}>No messages yet.</div>
                  )}
                  {(() => {
                    const myNotes = supportActiveNotes.filter(n => n.author_id === userId);
                    const lastReadId = [...myNotes].reverse().find(n => n.read_at)?.id;
                    return supportActiveNotes.map(n => {
                      const isMe = n.author_id === userId;
                      const hasImg = Array.isArray(n.attachments) && n.attachments.length > 0;
                      return (
                        <div key={n.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                          <div style={{ maxWidth: '80%', padding: hasImg ? '6px' : '9px 13px', borderRadius: isMe ? '8px 8px 4px 8px' : '8px 8px 8px 4px', background: isMe ? 'rgba(var(--accent-rgb),0.15)' : UI.bgRaised, border: `0.5px solid ${isMe ? 'rgba(var(--accent-rgb),0.25)' : UI.hair}`, overflow: 'hidden' }}>
                            {hasImg && n.attachments.map((a, i) => (
                              <img key={i} src={a.url} alt="" onClick={() => setLightboxSrc(a.url)} style={{ display: 'block', maxWidth: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 4, marginBottom: n.body ? 4 : 0, cursor: 'pointer' }} />
                            ))}
                            {n.body ? <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, lineHeight: 1.55, padding: hasImg ? '0 6px 4px' : 0 }}>{n.body}</div> : null}
                          </div>
                          <div className="micro" style={{ color: UI.inkGhost, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{isMe ? 'You' : 'Support'} · {new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {new Date(n.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                            {isMe && n.id === lastReadId && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Seen</span>}
                          </div>
                        </div>
                      );
                    });
                  })()}
                  <div ref={supportBottomRef} />
                </div>
                {/* Compose — sticks to bottom */}
                {activeTicket?.status !== 'resolved' ? (
                  <div style={{ flexShrink: 0, borderTop: `0.5px solid ${UI.hair}`, padding: '14px 20px', paddingBottom: 'calc(env(safe-area-inset-bottom, 8px) + 14px)', display: 'flex', flexDirection: 'column', gap: 8, background: UI.bgRaised }}>
                    {supportImagePreview && (
                      <div style={{ position: 'relative', display: 'inline-block', alignSelf: 'flex-start' }}>
                        <img src={supportImagePreview} alt="" style={{ maxHeight: 100, maxWidth: 160, borderRadius: 6, display: 'block', objectFit: 'cover' }} />
                        <button onClick={() => { setSupportImageFile(null); setSupportImagePreview(null); }} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: UI.inkSoft, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11 }}>×</button>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                      <textarea value={supportDraft} onChange={e => setSupportDraft(e.target.value)}
                        placeholder="Write a message…" rows={3} style={{ ...iStyle, flex: 1 }}
                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSupportSend(); }} />
                      <label style={{ cursor: 'pointer', flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: supportImageFile ? 'rgba(var(--accent-rgb),0.15)' : UI.bgInset, border: `0.5px solid ${supportImageFile ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, color: supportImageFile ? 'var(--accent)' : UI.inkFaint }}>
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImagePick} />
                        <i className="fa-solid fa-image" style={{ fontSize: 15 }} />
                      </label>
                    </div>
                    <Btn onClick={handleSupportSend} disabled={(!supportDraft.trim() && !supportImageFile) || supportSending}>
                      {supportSending ? 'Sending…' : 'Send'}
                    </Btn>
                  </div>
                ) : (
                  <div style={{ flexShrink: 0, borderTop: `0.5px solid ${UI.hair}`, padding: '14px 20px', fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', lineHeight: 1.5 }}>
                    This ticket is resolved. Go back to open a new one.
                  </div>
                )}
              </div>
            );
          }

          // ── LIST VIEW (default) ──────────────────────────────────────
          const statusBorder = { open: UI.danger, in_progress: UI.gold, resolved: UI.inkFaint };
          const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const isUserArchived = t => t.archived && t.status === 'resolved' && t.archivedAt && new Date(t.archivedAt).getTime() <= sevenDaysAgo;
          const activeTickets   = tickets.filter(t => !isUserArchived(t));
          const archivedTickets = tickets.filter(t =>  isUserArchived(t));
          const renderTicket = t => (
            <button key={t.coachingId}
              onClick={() => { setSupportActiveTicketId(t.coachingId); setSupportView('thread'); }}
              style={{ width: '100%', background: UI.bgRaised, border: `0.5px solid ${UI.hair}`, borderLeft: `3px solid ${statusBorder[t.status] || UI.hairStrong}`, borderRadius: 8, padding: '11px 14px', textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="micro" style={{ color: statusBorder[t.status] || UI.inkFaint }}>{statusLabel[t.status] || t.status}</span>
                  <span className="micro" style={{ color: UI.inkFaint }}>· {CATS.find(c => c.key === t.category)?.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t.unreadCount > 0 && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, animation: 'pulseDot 1.5s ease-in-out infinite' }} />}
                  <span className="micro" style={{ color: UI.inkGhost }}>{fmtAgo(t.lastMessageAt || t.createdAt)}</span>
                </div>
              </div>
              {t.lastMessageBody ? (
                <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.lastMessageBody}</div>
              ) : (
                <div style={{ fontSize: 12, color: UI.inkGhost, fontFamily: UI.fontUi, fontStyle: 'italic' }}>No messages yet</div>
              )}
            </button>
          );
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 20px', flex: 1 }}>
              {activeTickets.length === 0 && archivedTickets.length === 0 && (
                <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '24px 0' }}>
                  No tickets yet. Tap "+ New ticket" if you need help.
                </div>
              )}
              {activeTickets.map(renderTicket)}
              {archivedTickets.length > 0 && (
                <UserArchivedSection tickets={archivedTickets} renderTicket={renderTicket} />
              )}
              <div style={{ flexGrow: 1 }} />
              <Btn onClick={() => { setSupportView('new'); setSupportDraft(''); setSupportCategoryDraft('question'); }} style={{ width: '100%', marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>+ New ticket</Btn>
            </div>
          );
        })()}
      </FullSheet>

      {/* ══ Support inbox full-screen sheet (admin) — inbox list + ticket detail in one ══ */}
      <FullSheet
        open={supportInboxSheet}
        onClose={supportTicket
          ? () => { setSupportTicket(null); setSupportAdminDraft(''); }
          : () => { setSupportInboxSheet(false); setSupportCatFilter('all'); setShowArchived(false); }
        }
        title={supportTicket ? (supportTicket.clientName || supportTicket.clientEmail) : 'Support inbox'}
      >
        {(() => {
          const CATS = { feature_request: 'Feature', bug: 'Bug', question: 'Question' };
          const iStyle = SETTINGS_TEXTAREA_STYLE;

          // ── TICKET DETAIL VIEW ─────────────────────────────────────────
          if (supportTicket) {
            const STATUSES = [
              { key: 'open',        label: 'Open' },
              { key: 'in_progress', label: 'In progress' },
              { key: 'resolved',    label: 'Resolved' },
            ];
            const sColor = { open: UI.danger, in_progress: UI.inkFaint, resolved: 'var(--accent)' };
            const sBg    = { open: 'rgba(var(--danger-rgb),0.12)', in_progress: UI.bgInset, resolved: 'rgba(var(--accent-rgb),0.1)' };
            const currentStatus = supportInbox.find(t => t.coaching_id === supportTicket.coachingId)?.support_status || supportTicket.status || 'open';
            return (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {/* Back + meta */}
                <div style={{ padding: '12px 20px', borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => { setSupportTicket(null); setSupportAdminDraft(''); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: 0, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
                    ← Back
                  </button>
                  <span className="micro" style={{ color: UI.inkFaint }}>{supportTicket.clientEmail}</span>
                  {supportTicket.category && <span className="micro" style={{ color: UI.inkFaint }}>· {CATS[supportTicket.category] || supportTicket.category}</span>}
                </div>
                {/* Status picker */}
                <div style={{ display: 'flex', gap: 6, padding: '12px 20px', flexShrink: 0, borderBottom: `0.5px solid ${UI.hair}` }}>
                  {STATUSES.map(s => (
                    <button key={s.key} onClick={() => handleSetSupportStatus(supportTicket.coachingId, s.key)} style={{
                      flex: 1, padding: '7px 4px', borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                      border: `0.5px solid ${currentStatus === s.key ? sColor[s.key] : UI.hairStrong}`,
                      background: currentStatus === s.key ? sBg[s.key] : 'transparent',
                      color: currentStatus === s.key ? sColor[s.key] : UI.inkFaint,
                      fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                    }}>{s.label}</button>
                  ))}
                </div>
                {/* Thread — scrollable, takes remaining height */}
                <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 20px', minHeight: 0 }}>
                  {supportTicketLoading && <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '12px 0' }}>Loading…</div>}
                  {!supportTicketLoading && supportTicketNotes.length === 0 && (
                    <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '24px 0' }}>No messages yet.</div>
                  )}
                  {(() => {
                    const myNotes = supportTicketNotes.filter(n => n.author_id === userId);
                    const lastReadId = [...myNotes].reverse().find(n => n.read_at)?.id;
                    return supportTicketNotes.map(n => {
                      const isAdminMsg = n.author_id === userId;
                      const hasImg = Array.isArray(n.attachments) && n.attachments.length > 0;
                      return (
                        <div key={n.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isAdminMsg ? 'flex-end' : 'flex-start' }}>
                          <div style={{
                            maxWidth: '80%', padding: hasImg ? '6px' : '9px 13px', borderRadius: isAdminMsg ? '8px 8px 4px 8px' : '8px 8px 8px 4px',
                            background: isAdminMsg ? 'rgba(var(--accent-rgb),0.15)' : UI.bgRaised,
                            border: `0.5px solid ${isAdminMsg ? 'rgba(var(--accent-rgb),0.25)' : UI.hair}`,
                            overflow: 'hidden',
                          }}>
                            {hasImg && n.attachments.map((a, i) => (
                              <img key={i} src={a.url} alt="" onClick={() => setLightboxSrc(a.url)} style={{ display: 'block', maxWidth: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 4, marginBottom: n.body ? 4 : 0, cursor: 'pointer' }} />
                            ))}
                            {n.body ? <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, lineHeight: 1.55, padding: hasImg ? '0 6px 4px' : 0 }}>{n.body}</div> : null}
                          </div>
                          <div className="micro" style={{ color: UI.inkGhost, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{isAdminMsg ? 'You' : supportTicket.clientName} · {new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {new Date(n.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                            {isAdminMsg && n.id === lastReadId && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Seen</span>}
                          </div>
                        </div>
                      );
                    });
                  })()}
                  <div ref={adminBottomRef} />
                </div>
                {/* Compose — sticks to bottom */}
                <div style={{ flexShrink: 0, borderTop: `0.5px solid ${UI.hair}`, padding: '14px 20px', paddingBottom: 'calc(env(safe-area-inset-bottom, 8px) + 14px)', display: 'flex', flexDirection: 'column', gap: 8, background: UI.bgRaised }}>
                  {adminImagePreview && (
                    <div style={{ position: 'relative', display: 'inline-block', alignSelf: 'flex-start' }}>
                      <img src={adminImagePreview} alt="" style={{ maxHeight: 100, maxWidth: 160, borderRadius: 6, display: 'block', objectFit: 'cover' }} />
                      <button onClick={() => { setAdminImageFile(null); setAdminImagePreview(null); }} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: UI.inkSoft, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11 }}>×</button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea value={supportAdminDraft} onChange={e => setSupportAdminDraft(e.target.value)}
                      placeholder="Reply…" rows={3} style={{ ...iStyle, flex: 1 }}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdminReply(); }}
                    />
                    <label style={{ cursor: 'pointer', flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: adminImageFile ? 'rgba(var(--accent-rgb),0.15)' : UI.bgInset, border: `0.5px solid ${adminImageFile ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, color: adminImageFile ? 'var(--accent)' : UI.inkFaint }}>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAdminImagePick} />
                      <i className="fa-solid fa-image" style={{ fontSize: 15 }} />
                    </label>
                  </div>
                  <Btn onClick={handleAdminReply} disabled={(!supportAdminDraft.trim() && !adminImageFile) || supportAdminSending}>
                    {supportAdminSending ? 'Sending…' : 'Send reply'}
                  </Btn>
                  {currentStatus === 'resolved' && (
                    <Btn kind="ghost" onClick={handleArchiveTicket} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, color: UI.inkFaint, borderColor: UI.hairStrong }}>
                      <i className="fa-solid fa-box-archive" style={{ fontSize: 12 }} /> Archive ticket
                    </Btn>
                  )}
                  {confirmDeleteTicket ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn kind="ghost" onClick={() => setConfirmDeleteTicket(false)} style={{ flex: 1, color: UI.inkFaint, borderColor: UI.hairStrong }}>Cancel</Btn>
                      <Btn onClick={handleDeleteTicket} disabled={deletingTicket} style={{ flex: 1, background: 'rgba(var(--danger-rgb),0.15)', color: 'rgba(var(--danger-rgb),1)', border: '0.5px solid rgba(var(--danger-rgb),0.3)' }}>
                        {deletingTicket ? 'Deleting…' : 'Confirm delete'}
                      </Btn>
                    </div>
                  ) : (
                    <Btn kind="ghost" onClick={() => setConfirmDeleteTicket(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, color: 'rgba(var(--danger-rgb),0.7)', borderColor: 'rgba(var(--danger-rgb),0.25)' }}>
                      <i className="fa-solid fa-trash" style={{ fontSize: 12 }} /> Delete ticket
                    </Btn>
                  )}
                </div>
              </div>
            );
          }

          // ── INBOX LIST VIEW ────────────────────────────────────────────
          const filterDefs = [
            { key: 'all', label: 'All' },
            { key: 'feature_request', label: 'Feature' },
            { key: 'bug', label: 'Bug' },
            { key: 'question', label: 'Question' },
          ];
          const filtered = supportCatFilter === 'all' ? supportInbox : supportInbox.filter(t => t.support_category === supportCatFilter);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '16px 20px' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {filterDefs.map(f => (
                  <button key={f.key} onClick={() => setSupportCatFilter(f.key)} style={{
                    padding: '5px 14px', borderRadius: 999, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                    border: `0.5px solid ${supportCatFilter === f.key ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`,
                    background: supportCatFilter === f.key ? 'rgba(var(--accent-rgb),0.1)' : 'transparent',
                    color: supportCatFilter === f.key ? 'var(--accent)' : UI.inkFaint,
                    fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600,
                  }}>{f.label}</button>
                ))}
              </div>
              {supportInboxLoading && <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '16px 0' }}>Loading…</div>}
              {!supportInboxLoading && filtered.length === 0 && (
                <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '24px 0' }}>
                  {supportInbox.length === 0 ? 'No support tickets yet.' : 'No tickets in this category.'}
                </div>
              )}
              {filtered.map(t => (
                <AdminTicketRow key={t.coaching_id} t={t} catLabel={CATS[t.support_category] || t.support_category}
                  onClick={() => setSupportTicket({ coachingId: t.coaching_id, clientName: t.client_name, clientEmail: t.client_email, category: t.support_category, status: t.support_status })} />
              ))}
              {/* ── Archived section ── */}
              <div style={{ borderTop: `0.5px solid ${UI.hair}`, marginTop: 4, paddingTop: 12 }}>
                <button onClick={async () => {
                  if (showArchived) { setShowArchived(false); return; }
                  setShowArchived(true);
                  setArchivedLoading(true);
                  const { data } = await LB.supabase.rpc('get_archived_support_chats');
                  setArchivedInbox(data || []);
                  setArchivedLoading(false);
                }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, letterSpacing: '0.04em', WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center', gap: 6, marginBottom: showArchived ? 12 : 0 }}>
                  <i className={`fa-solid fa-chevron-${showArchived ? 'up' : 'down'}`} style={{ fontSize: 9 }} />
                  Archived
                </button>
                {showArchived && (
                  archivedLoading
                    ? <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, padding: '8px 0' }}>Loading…</div>
                    : archivedInbox.length === 0
                    ? <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, fontStyle: 'italic', padding: '8px 0' }}>No archived tickets.</div>
                    : archivedInbox.map(t => (
                      <AdminTicketRow key={t.coaching_id} t={t} archived catLabel={CATS[t.support_category] || t.support_category}
                        onClick={() => setSupportTicket({ coachingId: t.coaching_id, clientName: t.client_name, clientEmail: t.client_email, category: t.support_category, status: t.support_status })} />
                    ))
                )}
              </div>
            </div>
          );
        })()}
      </FullSheet>


      {/* ══ All users sheet (admin) ══ — folds in what used to be separate
          Recent sign-ups (New sign-ups only filter) and Onboarded (Onboarded
          only filter) sheets, plus the SW-version lookup. */}
      <SettingsSheet open={allUsersSheet} onClose={() => setAllUsersSheet(false)} title="All users">
        {(() => {
          const q = allUsersSearch.trim().toLowerCase();
          const filtered = allUsers.filter(u => {
            if (allUsersNewOnly && !isNewSignup(u)) return false;
            if (allUsersOnboardedOnly && !(u.plan_count > 0)) return false;
            if (allUsersOutdatedOnly && swVersion && u.sw_version === swVersion) return false;
            if (!q) return true;
            return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
          });
          const openUserDetail = (u) => {
            setAdminUserDetail({ userId: u.user_id, name: u.name, email: u.email, plans: null, exercises: null });
            setAdminUserDetailLoading(true);
            setAdminUserDetailSheet(true);
            setAdminEmailSubject('');
            setAdminEmailBody('');
            setAdminEmailMsg(null);
            LB.supabase.rpc('get_user_detail_admin', { p_user_id: u.user_id })
              .then(({ data, error }) => {
                if (error || !data) { setAdminUserDetailLoading(false); return; }
                setAdminUserDetail({ userId: u.user_id, name: u.name, email: u.email, activeScheduleId: data.active_schedule_id || null, plans: data.plans || [] });
                setAdminUserDetailLoading(false);
              }).catch(() => setAdminUserDetailLoading(false));
          };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input
                value={allUsersSearch}
                onChange={e => setAllUsersSearch(e.target.value)}
                placeholder="Search by name or email…"
                style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' }}
              />
              <Frame style={{ padding: '0 14px' }}>
                <Row label="New sign-ups only" first>
                  <Toggle on={allUsersNewOnly} onToggle={() => setAllUsersNewOnly(v => !v)} />
                </Row>
                <Row label="Onboarded only">
                  <Toggle on={allUsersOnboardedOnly} onToggle={() => setAllUsersOnboardedOnly(v => !v)} />
                </Row>
                <Row label="Outdated version only">
                  <Toggle on={allUsersOutdatedOnly} onToggle={() => setAllUsersOutdatedOnly(v => !v)} />
                </Row>
              </Frame>
              {allUsersOutdatedOnly && !swVersion && (
                <div className="micro" style={{ color: UI.inkFaint }}>Your own version isn't known yet — this device hasn't reported one.</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div className="micro" style={{ color: UI.inkGhost }}>{filtered.length} of {allUsers.length}{swVersion ? ` · you're on ${swVersion}` : ''}</div>
                {filtered.some(u => !seenSignups.has(u.user_id)) && (
                  <button
                    onClick={() => markAllSignupsSeen(filtered.filter(u => !seenSignups.has(u.user_id)).map(u => u.user_id))}
                    style={{ ...accentBtn, padding: '3px 8px', fontSize: 9 }}
                  >
                    Mark all seen
                  </button>
                )}
              </div>
              {filtered.length === 0 ? (
                <div className="micro" style={{ color: UI.inkGhost, padding: '4px 0 12px' }}>No matching users.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
                  {filtered.map((u, i) => {
                    const isCurrent = swVersion && u.sw_version === swVersion;
                    const isNew = !seenSignups.has(u.user_id);
                    return (
                      <div key={u.user_id} onClick={() => openUserDetail(u)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontFamily: UI.fontUi, fontSize: 14, fontWeight: 700, color: UI.inkSoft }}>{(u.name || u.email || '?')[0].toUpperCase()}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || '—'}</span>
                            <span className="micro" style={{ flexShrink: 0, color: u.approved ? 'var(--accent)' : 'rgba(var(--danger-rgb),0.75)' }}>{u.approved ? 'ACTIVE' : 'PENDING'}</span>
                            {isNew && <span className="micro" style={{ flexShrink: 0, color: UI.gold }}>NEW</span>}
                          </div>
                          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.email} · joined {fmtAgo(u.created_at)} · {u.plan_count} {u.plan_count === 1 ? 'plan' : 'plans'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                          <span className="num" style={{ fontSize: 11, color: !u.sw_version ? UI.inkGhost : isCurrent ? UI.inkFaint : UI.gold }}>
                            {u.sw_version || '—'}
                          </span>
                          {isNew && (
                            <button onClick={e => { e.stopPropagation(); markSignupSeen(u.user_id); }} style={{ ...accentBtn, padding: '3px 8px', fontSize: 9 }}>Got it</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ User detail sheet (admin — plans list) ══ */}
      <SettingsSheet open={adminUserDetailSheet} onClose={() => setAdminUserDetailSheet(false)} title={adminUserDetail?.name || adminUserDetail?.email || 'User'}>
        {adminUserDetailLoading
          ? <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, padding: '8px 0' }}>Loading…</div>
          : adminUserDetail && (
            <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
              <div className="micro" style={{ color: UI.inkGhost, paddingBottom: 8 }}>SEND EMAIL</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi }}>To {adminUserDetail.email}</div>
                <input
                  value={adminEmailSubject}
                  onChange={e => setAdminEmailSubject(e.target.value)}
                  placeholder="Subject"
                  style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' }}
                />
                <textarea
                  value={adminEmailBody}
                  onChange={e => setAdminEmailBody(e.target.value)}
                  placeholder="Message…"
                  rows={5}
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical',
                    background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4,
                    padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none',
                  }}
                />
                {adminEmailMsg && (
                  <div style={{ fontSize: 12, color: adminEmailMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi, padding: '8px 12px', background: adminEmailMsg.ok ? 'rgba(var(--accent-rgb),0.08)' : 'rgba(var(--danger-rgb),0.08)', borderRadius: 6 }}>
                    {adminEmailMsg.text}
                  </div>
                )}
                <Btn onClick={sendAdminEmail} disabled={!adminEmailSubject.trim() || !adminEmailBody.trim() || adminEmailSending}>
                  {adminEmailSending ? 'Sending…' : 'Send email'}
                </Btn>
              </div>
              <Hairline style={{ marginBottom: 16 }} />
              <div className="micro" style={{ color: UI.inkGhost, paddingBottom: 8 }}>PLANS</div>
              {(adminUserDetail.plans || []).length === 0
                ? <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, fontStyle: 'italic' }}>No plans.</div>
                : (adminUserDetail.plans || []).map((p, i) => {
                    const isActive = p.id === adminUserDetail.activeScheduleId;
                    return (
                      <button key={p.id} onClick={() => { setAdminPlanDetail(p); setAdminPlanDetailSheet(true); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderTop: i > 0 ? `0.5px solid ${UI.hair}` : 'none', background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 13, color: p.archived ? UI.inkFaint : UI.ink, fontFamily: UI.fontUi, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                            {isActive && <span className="micro" style={{ color: 'var(--accent)', flexShrink: 0 }}>ACTIVE</span>}
                          </div>
                          <div style={{ fontSize: 11, color: UI.inkGhost, fontFamily: UI.fontUi, marginTop: 2 }}>
                            {p.is_flex ? 'flex' : (p.days || []).some(d => d.weekday != null) ? 'weekday' : 'cycle'}
                            {' · '}{p.day_count} {p.day_count === 1 ? 'day' : 'days'}
                            {p.sessions_per_week ? ` · ${p.sessions_per_week}×/week` : ''}
                          </div>
                        </div>
                        {p.archived
                          ? <span className="micro" style={{ color: UI.inkGhost, flexShrink: 0 }}>ARCHIVED</span>
                          : <i className="fa-solid fa-chevron-right" style={{ fontSize: 10, color: UI.inkGhost }} />
                        }
                      </button>
                    );
                  })
              }
            </div>
          )
        }
      </SettingsSheet>

      {/* ══ Plan detail sheet (admin — day chips + exercise cards) ══ */}
      <SettingsSheet open={adminPlanDetailSheet} onClose={() => setAdminPlanDetailSheet(false)} title={adminPlanDetail?.name || 'Plan'}>
        {adminPlanDetail && (() => {
          const days = adminPlanDetail.days || [];
          const day = days.find(d => d.id === adminPlanSelectedDayId) || days[0];
          const dayIdx = days.findIndex(d => d.id === (day?.id));
          const isRest = !day || !(day.items || []).length || day.name === 'REST';
          const planType = adminPlanDetail.is_flex ? 'flex' : days.some(d => d.weekday != null) ? 'weekday' : 'cycle';
          const trainingDays = days.filter(d => (d.items || []).length && d.name !== 'REST').length;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, margin: '0 -16px' }}>
              {/* plan type */}
              <div className="micro" style={{ color: UI.inkGhost, padding: '0 16px 10px' }}>
                {planType.toUpperCase()} · {trainingDays} {trainingDays === 1 ? 'workout' : 'workouts'}
                {adminPlanDetail.sessions_per_week ? ` · ${adminPlanDetail.sessions_per_week}×/week` : ''}
              </div>
              {/* chip row */}
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', padding: '0 16px 14px' }}>
                {days.map((d, i) => {
                  const active = d.id === (day?.id);
                  const rest = !d.items?.length || d.name === 'REST';
                  return (
                    <button key={d.id || i} onClick={() => setAdminPlanSelectedDayId(d.id)} style={{
                      flexShrink: 0, maxWidth: 120, padding: '6px 12px 4px', borderRadius: 4,
                      border: `1px solid ${active ? UI.gold : UI.hairStrong}`,
                      background: active ? UI.goldFaint : 'transparent',
                      cursor: 'pointer', WebkitTapHighlightColor: 'transparent', transition: 'all 0.15s',
                    }}>
                      <div style={{ fontSize: 10, fontFamily: UI.fontUi, letterSpacing: '0.07em', fontWeight: 600, color: active ? UI.gold : rest ? UI.inkFaint : UI.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                      <div style={{ fontSize: 8, fontFamily: UI.fontUi, letterSpacing: '0.1em', color: active ? UI.gold : UI.inkFaint, marginTop: 1 }}>Day {i + 1}</div>
                    </button>
                  );
                })}
              </div>
              {/* day content */}
              {day && (
                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
                  <div>
                    <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>DAY {dayIdx + 1}</div>
                    <div className="display" style={{ fontSize: 30, color: isRest ? UI.inkSoft : UI.ink, fontStyle: isRest ? 'italic' : 'normal', lineHeight: 1.05, letterSpacing: '-0.01em' }}>{day.name}</div>
                  </div>
                  {isRest ? (
                    <div style={{ background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: 36, textAlign: 'center' }}>
                      <div className="display-it" style={{ fontSize: 32, color: UI.inkSoft, fontWeight: 300, marginBottom: 6 }}>Recover.</div>
                      <div style={{ fontSize: 13, color: UI.inkFaint }}>Recovery is part of the plan.</div>
                    </div>
                  ) : (day.items || []).map((it, k) => {
                    const isUni = it.unilateral || it.movement_type === 'unilateral';
                    const isMob = it.movement_type === 'mobility';
                    return (
                      <div key={it.exId || k} style={{ background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '12px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi }}>
                              {it.name || '—'}
                              {isUni && <span className="micro" style={{ marginLeft: 6, color: UI.inkFaint }}>UNI</span>}
                              {isMob && <span className="micro" style={{ marginLeft: 6, color: UI.inkFaint }}>MOB</span>}
                            </span>
                          </div>
                          <span className="num" style={{ fontSize: 13, color: UI.inkSoft, flexShrink: 0 }}>
                            {it.sets} × {it.reps || '—'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Push notifications sheet ══ */}
      <SettingsSheet open={pushSheet} onClose={() => setPushSheet(false)} title="Push notifications">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          {isIosDevice && !pushEnabled && !iosDisclaimerSeen && (
            <div style={{ background: 'rgba(var(--accent-rgb),0.07)', border: '0.5px solid rgba(var(--accent-rgb),0.2)', borderRadius: 6, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.55 }}>
                Push notifications on iPhone and iPad require Zane to be installed as an app on your home screen. For instructions, see <span style={{ color: 'var(--accent)' }}>How to… → Install as app</span>.
              </div>
              <button onClick={() => { setIosDisclaimerSeen(true); localStorage.setItem('logbook-push-ios-hint-seen', 'true'); }} style={{ ...accentBtn, alignSelf: 'flex-start' }}>Got it</button>
            </div>
          )}
          <Row label="This device" first>
            {webPushLoading
              ? <span style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.inkFaint }}>…</span>
              : <Toggle on={pushEnabled || webPushPending} onToggle={togglePush} />}
          </Row>
          {pushEnabled && store.settings?.usePushover && store.settings?.pushoverUserKey && (
            <div className="micro" style={{ color: UI.inkGhost, paddingLeft: 2 }}>Active via Pushover — see Advanced</div>
          )}
          {(pushEnabled || webPushPending) && !store.settings?.usePushover && webPushSub && (() => {
            const iStyle = { ...SETTINGS_INPUT_STYLE, fontSize: 20, letterSpacing: '0.3em', textAlign: 'center' };
            if (webPushStep === 'code-sent') {
              const pct = pendingCountdown / 120;
              const urgent = pendingCountdown <= 30;
              const barColor = urgent ? UI.warn : 'var(--accent)';
              const mins = Math.floor(pendingCountdown / 60);
              const secs = pendingCountdown % 60;
              const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="micro" style={{ color: UI.inkSoft }}>Enter the 6-digit code from the notification</div>
                    <div className="num" style={{ fontSize: 11, color: urgent ? UI.warn : UI.inkFaint, minWidth: 28, textAlign: 'right' }}>{timeStr}</div>
                  </div>
                  <div style={{ height: 2, background: UI.hairStrong, borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct * 100}%`, background: barColor, borderRadius: 999, transition: 'width 1s linear, background 0.5s' }} />
                  </div>
                  <input type="text" inputMode="numeric" maxLength={6} value={codeInput}
                    onChange={e => setCodeInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000" style={iStyle} autoFocus />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn kind="ghost" onClick={sendWebPushCode}>Resend</Btn>
                    <Btn onClick={verifyWebPushCode} disabled={codeInput.length !== 6} style={{ flex: 1 }}>Verify</Btn>
                  </div>
                </div>
              );
            }
            if (webPushVerified) return (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'rgba(var(--accent-rgb), 0.08)', border: '0.5px solid rgba(var(--accent-rgb), 0.25)', borderRadius: 6, padding: '8px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 5px rgba(var(--accent-rgb),0.7)', animation: 'pulseDot 1.5s ease-in-out infinite', flexShrink: 0 }} />
                  <span className="micro" style={{ color: 'var(--accent)' }}>ACTIVE</span>
                </div>
                <div style={{ width: 0.5, height: 10, background: 'rgba(var(--accent-rgb), 0.35)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="fa-solid fa-circle-check" style={{ fontSize: 10, color: 'var(--accent)' }} />
                  <span className="micro" style={{ color: 'var(--accent)' }}>VERIFIED</span>
                </div>
              </div>
            );
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="micro" style={{ color: UI.inkGhost, paddingLeft: 2 }}>Active — not yet verified</div>
                <button onClick={sendWebPushCode} style={accentBtn}>Send verification code</button>
              </div>
            );
          })()}
          {pushStatus && <div className="micro" style={{ color: pushStatus.startsWith('✓') ? 'var(--accent)' : UI.inkSoft, textAlign: 'center', padding: '6px 0' }}>{pushStatus}</div>}
          {pushEnabled && (
            <Row label="Advanced">
              <button onClick={() => setAdvancedPushSheet(true)} style={accentBtn}>Open</button>
            </Row>
          )}
          <Btn onClick={() => setPushSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Advanced push sheet ══ */}
      <SettingsSheet open={advancedPushSheet} onClose={closeAdvanced} title="Advanced">
        {(() => {
          const isVerified = !!(store.settings?.usePushover && store.settings?.pushoverUserKey);
          const inputStyle = { ...SETTINGS_INPUT_STYLE, fontSize: 13 };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
              <Row label="Use Pushover" first>
                <Toggle
                  on={isVerified || pushoverStep !== 'idle'}
                  onToggle={() => {
                    if (isVerified) { disablePushover(); }
                    else if (pushoverStep !== 'idle') { setPushoverStep('idle'); setPushKeyDraft(''); setCodeInput(''); setPendingCode(''); }
                    else { setPushoverStep('entering-key'); }
                  }}
                />
              </Row>
              <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>
                Uses the Pushover app instead of browser push for rest timer notifications. Delivers even without the PWA installed.
              </div>

              {!isVerified && pushoverStep === 'entering-key' && (
                <>
                  <input value={pushKeyDraft} onChange={e => setPushKeyDraft(e.target.value)}
                    placeholder="Pushover user key (from pushover.net)"
                    style={inputStyle} autoCorrect="off" autoCapitalize="none" spellCheck={false} />
                  <Btn onClick={sendVerificationCode} disabled={pushKeyDraft.trim().length < 10 || verifyLoading}>
                    {verifyLoading ? 'Sending…' : 'Send verification code'}
                  </Btn>
                </>
              )}

              {!isVerified && pushoverStep === 'code-sent' && (
                <>
                  <div className="micro" style={{ color: UI.inkFaint }}>Enter the 6-digit code from your Pushover notification</div>
                  <input value={codeInput} onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000" inputMode="numeric" maxLength={6} autoFocus
                    style={{ ...inputStyle, fontSize: 20, letterSpacing: '0.3em', textAlign: 'center' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn kind="ghost" onClick={() => { setCodeInput(''); setPendingCode(''); sendVerificationCode(); }}>Resend</Btn>
                    <Btn onClick={verifyCode} disabled={codeInput.length !== 6} style={{ flex: 1 }}>Verify</Btn>
                  </div>
                </>
              )}

              {isVerified && (
                <>
                  <div className="micro" style={{ color: UI.inkFaint }}>Active · key …{store.settings.pushoverUserKey.slice(-8)}</div>
                  <Row label="Test rest timer">
                    <button onClick={() => setTestPickerOpen(true)} style={accentBtn}>Send</button>
                  </Row>
                </>
              )}

              {pushStatus && <div className="micro" style={{ color: pushStatus.startsWith('✓') ? 'var(--accent)' : UI.inkSoft, textAlign: 'center', padding: '6px 0' }}>{pushStatus}</div>}
              <Btn onClick={closeAdvanced}>Done</Btn>
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Reminder sheet ══ */}
      <SettingsSheet open={reminderSheet} onClose={() => setReminderSheet(false)} title="Training reminder">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <Row label="Enabled" first>
            <Toggle on={reminderEnabled} onToggle={() => { toggleReminder(); if (reminderEnabled) setReminderSheet(false); }} />
          </Row>
          {reminderEnabled && (
            <Row label="Notify at">
              <input type="time" value={reminderTime} onChange={e => updateReminderTime(e.target.value)}
                style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '5px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none', colorScheme: 'dark' }} />
            </Row>
          )}
          {reminderEnabled && store.nextReminderAt && (() => {
            const dt = new Date(store.nextReminderAt);
            const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
            const tomorrowMid = new Date(todayMid); tomorrowMid.setDate(todayMid.getDate() + 1);
            const remMid = new Date(dt); remMid.setHours(0, 0, 0, 0);
            const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const dateStr = remMid.getTime() === todayMid.getTime() ? 'Today' : remMid.getTime() === tomorrowMid.getTime() ? 'Tomorrow' : dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            return <div className="micro" style={{ color: UI.inkFaint, textAlign: 'right', paddingTop: 6 }}>Next · {dateStr} · {timeStr}</div>;
          })()}
          <Btn onClick={() => setReminderSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Test picker sheet (used from Advanced) ══ */}
      <SettingsSheet open={testPickerOpen} onClose={() => setTestPickerOpen(false)} title="Test rest timer">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testRestTimer(0); }}>Now</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testRestTimer(10); }}>In 10 seconds</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testRestTimer(30); }}>In 30 seconds</Btn>
        </div>
      </SettingsSheet>

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

    </Screen>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { SettingsScreen });
