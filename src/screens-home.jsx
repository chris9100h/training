/* App screens — Login, Home — Haute Horlogerie redesign
   Logic identical to original (Supabase auth, cycle/weekday modes,
   in-progress overlay, future-slot retroactive logging).
*/

const { useState, useEffect, useMemo, useRef } = React;

const SKIP_REASONS = ['Tired', 'Sick', 'Stress', 'Forgot', 'Rest day', 'No particular reason'];

// Renders text on a single line, scaling the font size down so it always fits
// the parent's width (used for the hero day name, which varies in length).
function FitText({ text, max, min, style }) {
  const ref = useRef(null);
  const [fs, setFs] = useState(max);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf, lastW = -1;
    // Measure the text at max size and scale down to fit the parent's width.
    // `force` bypasses the width-equality guard (used when only the font, not
    // the width, changed — e.g. after web fonts load).
    const measure = (force) => {
      const parent = el.parentElement;
      if (!parent) return;
      const avail = parent.clientWidth;
      if (avail <= 0) return;            // not laid out yet — observer re-fires later
      if (!force && avail === lastW) return; // width unchanged — nothing to do
      lastW = avail;
      el.style.fontSize = max + 'px';
      const natural = el.scrollWidth;
      setFs(natural > avail ? Math.max(min, Math.floor(max * avail / natural)) : max);
    };
    // Defer measuring to a frame so a ResizeObserver callback never mutates
    // layout synchronously (which would trigger the "ResizeObserver loop"
    // notification). Coalesce bursts into one measure.
    const schedule = (force) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => measure(force)); };
    schedule(true);
    // Re-fit when web fonts load — the first measurement may run against the
    // fallback font (different metrics), yielding a wrong size.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => schedule(true));
    // Observe the parent so we re-fit when its width becomes known (covers
    // remounts where layout isn't ready yet) or changes (orientation/resize).
    let ro, onResize;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => schedule(false));
      ro.observe(el.parentElement);
    } else {
      onResize = () => schedule(false);
      window.addEventListener('resize', onResize);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      if (onResize) window.removeEventListener('resize', onResize);
    };
  }, [text, max, min]);
  return (
    <div ref={ref} style={{ ...style, fontSize: fs, whiteSpace: 'nowrap' }}>{text}</div>
  );
}

// ─── PASSKEY LOGIN BUTTON ─────────────────────────────────────────────────────
function PasskeyLoginButton({ loading, setLoading, setError }) {
  const handlePasskey = async () => {
    if (loading) return;
    setLoading(true); setError('');
    try {
      await LB.signInWithPasskey();
    } catch (e) {
      setError(e.message || 'Passkey sign-in failed');
      setLoading(false);
    }
  };

  return (
    <button type="button" onClick={handlePasskey} disabled={loading} style={{
      width: '100%', padding: '12px 0', borderRadius: 6,
      background: 'transparent', border: `1px solid ${UI.hairStrong}`,
      color: loading ? UI.inkFaint : UI.ink,
      fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
      cursor: loading ? 'default' : 'pointer',
      WebkitTapHighlightColor: 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
      transition: 'border-color 0.15s, color 0.15s',
    }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 11c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2z"/><path d="M14 2C9.6 2 6 5.6 6 10c0 2.8 1.4 5.3 3.5 6.8L8 22h6l-.5-2H17l-.5-2H19l-1.2-3.5C19.2 15 20 12.6 20 10c0-4.4-2.7-8-6-8z"/>
      </svg>
      {loading ? '…' : 'Passkey'}
    </button>
  );
}

// ─── LOGIN / REGISTER ─────────────────────────────────────────────────────────
function LoginScreen() {
  const [mode, setMode]           = useState('login'); // 'login' | 'register' | 'forgot'
  const [name, setName]           = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [unit, setUnit]           = useState('kg'); // 'kg' | 'lbs'
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [swVersion, setSwVersion] = useState('');
  const formRef = useRef(null);

  useEffect(() => {
    LB.detectCacheVersion().then(version => { if (version) setSwVersion(version); });
  }, []);

  // Safari autofill fires native DOM input events but not React synthetic ones.
  // Sync autofilled values to React state so canLogin is correct when tapping the button.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const handler = (e) => {
      if (e.target.name === 'email') setEmail(e.target.value);
      if (e.target.name === 'password') setPassword(e.target.value);
    };
    form.addEventListener('input', handler);
    return () => form.removeEventListener('input', handler);
  }, []);

  const switchMode = (m) => { setMode(m); setError(''); setPassword(''); setConfirm(''); setResetSent(false); };

  const pwMatch = password === confirm;
  const canLogin    = email.trim() && password.length >= 6;
  const canRegister = name.trim() && email.trim() && password.length >= 6 && pwMatch;

  const submitLogin = async (emailVal, passwordVal) => {
    const e2 = (emailVal || email).trim();
    const p2 = passwordVal || password;
    if (!e2 || p2.length < 6 || loading) return;
    setLoading(true); setError('');
    try {
      await LB.signIn(e2, p2);
    } catch (e) {
      setError(e.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const submitRegister = async () => {
    if (!canRegister || loading) return;
    if (!pwMatch) { setError('Passwords do not match'); return; }
    setLoading(true); setError('');
    try {
      await LB.signUp(email.trim(), password, name.trim(), unit);
      localStorage.setItem('logbook-unit-prompted', '1');
    } catch (e) {
      setError(e.message || 'Registration failed');
      setLoading(false);
    }
  };

  const isLogin = mode === 'login';
  const isForgot = mode === 'forgot';

  const submitReset = async () => {
    const e2 = email.trim();
    if (!e2 || loading) return;
    setLoading(true); setError('');
    try {
      await LB.resetPassword(e2, 'https://zane-wo.com/');
      setResetSent(true);
    } catch (e) {
      setError(e.message || 'Failed to send reset link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll style={{ position: 'relative' }}>
      <div className="guilloche" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }} />

      <div style={{ flexShrink: 0, padding: 'calc(env(safe-area-inset-top, 0px) + 18px) 22px 0', display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 1 }}>
        <span className="micro">ZANE TRAINING</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 32px 24px', position: 'relative', zIndex: 1, marginTop: 'auto', marginBottom: 'auto' }}>
        <img src="icons/zane-logo.png" style={{ width: '92%', maxWidth: 500, objectFit: 'contain', marginBottom: 28 }} />

        {/* Tab switcher — hidden in forgot mode */}
        {!isForgot ? (
          <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', marginBottom: 24, borderRadius: 6, overflow: 'hidden', border: `1px solid ${UI.hairStrong}` }}>
            {['login', 'register'].map(m => (
              <button key={m} onClick={() => switchMode(m)} style={{
                padding: '10px 0',
                background: mode === m ? UI.goldFaint : 'transparent',
                border: 'none',
                borderRight: m === 'login' ? `1px solid ${UI.hairStrong}` : 'none',
                color: mode === m ? UI.gold : UI.inkFaint,
                fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                transition: 'background 0.15s, color 0.15s',
              }}>
                {m === 'login' ? 'Login' : 'Register'}
              </button>
            ))}
          </div>
        ) : (
          <button onClick={() => switchMode('login')} style={{
            alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer',
            color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, letterSpacing: '0.04em',
            padding: '0 0 18px', display: 'flex', alignItems: 'center', gap: 6,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 1L1 5l4 4" /></svg>
            Back to login
          </button>
        )}

        {!isForgot && (
          <form ref={formRef} onSubmit={e => {
              e.preventDefault();
              if (isLogin) {
                const els = e.target.elements;
                submitLogin(els.namedItem('email')?.value, els.namedItem('password')?.value);
              } else {
                submitRegister();
              }
            }}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 22 }}>
            {!isLogin && (
              <Field label="Nickname">
                <TextInput value={name} onChange={setName} placeholder="Your nickname" autoFocus={!isLogin} autoComplete="nickname" name="name" />
              </Field>
            )}
            <Field label="Email">
              <TextInput value={email} onChange={setEmail} placeholder="you@example.com" autoFocus={isLogin} autoComplete="email" name="email" type="email" />
            </Field>
            <Field label="Password">
              <TextInput value={password} onChange={setPassword} type="password" placeholder="min. 6 characters"
                autoComplete={isLogin ? 'current-password' : 'new-password'} name="password" />
            </Field>
            {!isLogin && (
              <Field label="Repeat password">
                <TextInput value={confirm} onChange={setConfirm} type="password" placeholder="repeat password"
                  autoComplete="new-password" />
              </Field>
            )}

            {!isLogin && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="label" style={{ color: UI.inkFaint }}>Units</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[{ id: 'kg', label: 'Metric', sub: 'kg / km' }, { id: 'lbs', label: 'Imperial', sub: 'lbs / mi' }].map(opt => (
                    <button key={opt.id} type="button" onClick={() => setUnit(opt.id)} style={{
                      padding: '10px 0', borderRadius: 4, cursor: 'pointer',
                      background: unit === opt.id ? UI.goldFaint : 'transparent',
                      border: `1px solid ${unit === opt.id ? UI.gold : UI.hairStrong}`,
                      color: unit === opt.id ? UI.gold : UI.inkFaint,
                      fontFamily: UI.fontUi, textAlign: 'center',
                      WebkitTapHighlightColor: 'transparent',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
                      <div style={{ fontSize: 10, marginTop: 2, opacity: 0.7 }}>{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!isLogin && confirm.length > 0 && !pwMatch && (
              <div style={{ fontSize: 12, color: UI.danger, fontFamily: UI.fontUi, marginTop: -10 }}>
                Passwords do not match
              </div>
            )}

            {error && (
              <div style={{ fontSize: 12, color: UI.danger, padding: '10px 14px', background: 'rgba(var(--danger-rgb),0.06)', border: `1px solid rgba(var(--danger-rgb),0.25)`, borderRadius: 4, fontFamily: UI.fontUi }}>
                {error}
              </div>
            )}

            {isLogin ? (
              typeof window !== 'undefined' && window.PublicKeyCredential ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                  <PasskeyLoginButton loading={loading} setLoading={setLoading} setError={setError} />
                  <Btn style={{ opacity: canLogin && !loading ? 1 : 0.4 }}>
                    {loading ? 'Signing in…' : 'Log in'}
                  </Btn>
                </div>
              ) : (
                <Btn style={{ marginTop: 4, opacity: canLogin && !loading ? 1 : 0.4 }}>
                  {loading ? 'Signing in…' : 'Log in'}
                </Btn>
              )
            ) : (
              <Btn disabled={!canRegister || loading} style={{ marginTop: 4, opacity: canRegister && !loading ? 1 : 0.4 }}>
                {loading ? 'Creating account…' : 'Create account'}
              </Btn>
            )}

            {isLogin && (
              <button type="button" onClick={() => switchMode('forgot')} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11,
                letterSpacing: '0.04em', padding: '2px 0', alignSelf: 'center',
                WebkitTapHighlightColor: 'transparent',
              }}>
                Forgot password?
              </button>
            )}
          </form>
        )}

        {isForgot && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ fontFamily: UI.fontDisplay, fontSize: 26, color: UI.ink, marginBottom: 6 }}>Reset password</div>
              <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
                {resetSent
                  ? `A reset link was sent to ${email.trim()}. Check your inbox.`
                  : 'Enter your email and we\'ll send you a link to set a new password.'}
              </div>
            </div>
            {!resetSent && (
              <>
                <Field label="Email">
                  <TextInput value={email} onChange={setEmail} placeholder="you@example.com" autoFocus autoComplete="email" type="email"
                    onKeyDown={e => e.key === 'Enter' && submitReset()} />
                </Field>
                {error && (
                  <div style={{ fontSize: 12, color: UI.danger, padding: '10px 14px', background: 'rgba(var(--danger-rgb),0.06)', border: `1px solid rgba(var(--danger-rgb),0.25)`, borderRadius: 4, fontFamily: UI.fontUi }}>
                    {error}
                  </div>
                )}
                <Btn onClick={submitReset} style={{ marginTop: 4, opacity: email.trim() && !loading ? 1 : 0.4 }}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </Btn>
              </>
            )}
            {resetSent && (
              <Btn onClick={() => switchMode('login')} style={{ marginTop: 4 }}>
                Back to login
              </Btn>
            )}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, padding: '0 22px calc(env(safe-area-inset-bottom, 8px) + 18px)', display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 1 }}>
        <span className="micro">{swVersion || '…'}</span>
      </div>
    </Screen>
  );
}

// ─── SET PASSWORD (invite / password-reset flow) ──────────────────────────────
function SetPasswordScreen({ onDone, isRecovery }) {
  const [name, setName]         = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const canSubmit = password.length >= 6 && password === confirm;

  const submit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError('');
    try {
      // Grab email from the current invite session before updating
      const { data: { user: currentUser } } = await LB.supabase.auth.getUser();
      const email = currentUser?.email;

      const updates = { password };
      if (name.trim()) updates.data = { name: name.trim() };
      const { error: updateErr } = await LB.supabase.auth.updateUser(updates);
      if (updateErr) throw updateErr;

      if (name.trim() && currentUser?.id) {
        const { error } = await LB.supabase.from('zane_profiles').upsert({ id: currentUser.id, name: name.trim() });
        if (error) { console.error(error); }
      }

      if (email) {
        // Re-authenticate with the new password — verifies it was saved correctly
        // and replaces the one-time invite session with a permanent one.
        // The SIGNED_IN event in app.jsx will then call loadData().
        const { error: signInErr } = await LB.supabase.auth.signInWithPassword({ email, password });
        if (signInErr) throw new Error('Password saved but login failed — please try logging in manually.');
        // Don't call setLoading(false): phase will switch and unmount this screen
      } else {
        onDone();
      }
    } catch (e) {
      setError(e.message || 'Failed to set password');
      setLoading(false);
    }
  };

  return (
    <Screen scroll style={{ position: 'relative' }}>
      <div className="guilloche" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 32px 48px', position: 'relative', zIndex: 1 }}>
        <img src="icons/zane-logo.png" style={{ width: '92%', maxWidth: 500, objectFit: 'contain', marginBottom: 28 }} />
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ textAlign: 'center', marginBottom: 4 }}>
            <div style={{ fontFamily: UI.fontDisplay, fontSize: 26, color: UI.ink, marginBottom: 6 }}>
              {isRecovery ? 'Reset your password' : 'Welcome to Zane'}
            </div>
            <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
              {isRecovery ? 'Enter your new password below.' : 'Set a password to complete your account.'}
            </div>
          </div>
          {!isRecovery && (
            <Field label="Your name (optional)">
              <TextInput value={name} onChange={setName} placeholder="e.g. Alex" autoFocus={!isRecovery} />
            </Field>
          )}
          <Field label="Password">
            <TextInput value={password} onChange={setPassword} type="password" placeholder="min. 6 characters" autoFocus={isRecovery} />
          </Field>
          <Field label="Confirm password">
            <TextInput value={confirm} onChange={setConfirm} type="password" placeholder="repeat password"
              onKeyDown={e => e.key === 'Enter' && submit()} />
          </Field>
          {password.length > 0 && confirm.length > 0 && password !== confirm && (
            <div style={{ fontSize: 12, color: UI.danger, fontFamily: UI.fontUi }}>Passwords don't match.</div>
          )}
          {error && (
            <div style={{ fontSize: 12, color: UI.danger, padding: '10px 14px', background: 'rgba(var(--danger-rgb),0.06)', border: `1px solid rgba(var(--danger-rgb),0.25)`, borderRadius: 4, fontFamily: UI.fontUi }}>
              {error}
            </div>
          )}
          <Btn onClick={submit} disabled={!canSubmit || loading} style={{ marginTop: 4, opacity: canSubmit && !loading ? 1 : 0.4 }}>
            {loading
              ? (isRecovery ? 'Resetting…' : 'Setting up…')
              : (isRecovery ? 'Reset password' : 'Set password & continue')}
          </Btn>
        </div>
      </div>
    </Screen>
  );
}

// ─── Sub-components used by HomeScreen ────────────────────────────────

function SkipReasonSheet({ modal, onClose, setStore, userId }) {
  return (
    <Sheet open={!!modal} onClose={onClose}>
      {modal && (
        <>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: UI.fontUi, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center', color: UI.ink, marginBottom: 4 }}>{modal.mode === 'edit' ? 'Edit Reason' : 'Why Did You Skip?'}</div>
          <div className="micro" style={{ marginBottom: 18, color: UI.inkFaint, textAlign: 'center' }}>{modal.data?.dayName}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SKIP_REASONS.map(reason => {
              const isActive = modal.currentReason === reason;
              return (
                <button key={reason} onClick={() => {
                  const { mode, skipId, data } = modal;
                  if (mode === 'edit') {
                    setStore(s => ({ ...s, skips: (s.skips || []).map(x => x.id === skipId ? { ...x, skipReason: reason } : x) }));
                  } else {
                    const id = LB.uid();
                    setStore(s => ({ ...s, skips: [...(s.skips || []), { id, date: data.dateKey, dayId: data.dayId, dayName: data.dayName, skipReason: reason, skippedAt: new Date().toISOString() }] }));
                  }
                  onClose();
                }} style={{ background: isActive ? UI.goldFaint : UI.bgInset, border: `0.5px solid ${isActive ? UI.goldSoft : UI.hairStrong}`, borderRadius: 4, padding: '13px 16px', fontFamily: UI.fontUi, fontSize: 14, color: isActive ? UI.gold : UI.ink, textAlign: 'center', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                  {reason}
                </button>
              );
            })}
          </div>
          <Btn onClick={onClose} style={{ marginTop: 14, width: '100%' }}>Cancel</Btn>
        </>
      )}
    </Sheet>
  );
}

function LastSessionStrip({ session, onClick, exercises }) {
  return (
    <Frame onClick={onClick} style={{ flexShrink: 0, padding: '12px 16px', cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="micro" style={{ marginBottom: 3 }}>LAST SESSION</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="display" style={{ fontSize: 18, color: UI.ink, lineHeight: 1 }}>{session.dayName}</span>
            <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>
              {LB.parseDate(session.date).toLocaleDateString('en-US', { day:'2-digit', month:'short' }).toUpperCase()}
            </span>
            <span className="num" style={{ color: UI.gold, fontSize: 11 }}>
              {Math.round(LB.totalVolume(session, exercises)).toLocaleString('en-US')}<span style={{ color: UI.inkFaint }}>{UI.unit()}</span>
            </span>
          </div>
        </div>
        <ChevronRight />
      </div>
    </Frame>
  );
}

function RecentBannerDay({ banner, setStore, onOpenSkipSheet, onLog }) {
  const { dateKey, dayName, daysAgo, skip, dayId } = banner;
  const dateLabel = daysAgo === 1 ? 'YESTERDAY' : `${daysAgo}D AGO`;
  if (skip) {
    return (
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="micro" style={{ marginBottom: 3 }}>{dayName} · {dateLabel}</div>
          <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, letterSpacing: '0.04em', background: `rgba(var(--bg-rgb),0.5)`, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, padding: '2px 8px', display: 'inline-block' }}>
            {skip.skipReason}
          </span>
        </div>
        <button onClick={() => onOpenSkipSheet({ mode: 'edit', skipId: skip.id, currentReason: skip.skipReason, data: { dateKey, dayId: skip.dayId, dayName } })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: UI.inkFaint, display: 'flex', alignItems: 'center' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button onClick={() => { setStore(s => ({ ...s, skips: (s.skips || []).filter(x => x.id !== skip.id) })); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', color: UI.danger, fontSize: 18, lineHeight: 1, fontFamily: UI.fontUi }}>×</button>
      </div>
    );
  }
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(var(--danger-rgb),0.05)', border: `0.5px solid rgba(var(--danger-rgb),0.2)`, borderRadius: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="micro" style={{ color: UI.danger, marginBottom: 2 }}>{dayName} · {dateLabel}</div>
        <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>Not logged</div>
      </div>
      <button onClick={() => onLog(banner)} style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 4, background: 'transparent', border: `1px solid ${UI.hairStrong}`, cursor: 'pointer', fontSize: 11, fontFamily: UI.fontUi, color: UI.inkSoft, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        Log
      </button>
      <button onClick={() => onOpenSkipSheet({ mode: 'dismiss', data: { dateKey, dayId, dayName } })} style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 4, background: 'transparent', border: `1px solid rgba(var(--danger-rgb),0.25)`, cursor: 'pointer', fontSize: 11, fontFamily: UI.fontUi, color: 'rgba(var(--danger-rgb),0.7)', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        Dismiss
      </button>
    </div>
  );
}

// ─── CARDIO QUICK-LOG ─────────────────────────────────────────────────

const CARDIO_LIVE_KEY = 'logbook-cardio-live-start'; // epoch ms of a running live cardio, else absent

// Full-screen celebratory flash when a freshly logged cardio session beats a
// personal best (★ NEW BEST) or the last same-type session (↑ IMPROVEMENT).
// Mirrors the strength-training overlays (same animations + gold treatment).
function CardioPROverlay({ pr, onDone }) {
  useEffect(() => {
    if (!pr) return;
    const t = setTimeout(onDone, 3800);
    return () => clearTimeout(t);
  }, [pr]);
  if (!pr) return null;

  const du = LB.cardioDistUnit();
  const isBest = pr.tier === 'best';
  // detectCardioPRs' pace is decimal minutes/km (not seconds/km, which is
  // LB.fmtPace's contract) — kept local rather than forced into that shape.
  const fmtPace = (minPerKm) => {
    const perUnit = du === 'mi' ? minPerKm * LB.MI_TO_M / 1000 : minPerKm;
    let mins = Math.floor(perUnit);
    let secs = Math.round((perUnit - mins) * 60);
    if (secs === 60) { mins += 1; secs = 0; }
    return `${mins}:${String(secs).padStart(2, '0')} /${du}`;
  };
  const fmtDist = (m) => LB.fmtDistance(m, du);
  const META = {
    pace:     { label: 'Fastest Pace',     fmt: fmtPace },
    distance: { label: 'Longest Distance', fmt: fmtDist },
    duration: { label: 'Longest Session',  fmt: v => `${v} min` },
  };

  // Portaled to <body> so the flash covers the whole screen (incl. behind the
  // status bar); inside a <Screen> (overflow:hidden) iOS clips position:fixed.
  return ReactDOM.createPortal(
    <div onClick={onDone} style={{
      position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 200, background: 'var(--bg-body)',
      animation: 'improvedFade 3.8s ease forwards',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>
      <div style={{ position: 'absolute', inset: 0, animation: 'improvedBorderPulse 0.7s ease-in-out infinite' }} />
      <span style={{ fontFamily: UI.fontDisplay, fontSize: 72, color: UI.gold, fontWeight: 900, lineHeight: 1, textShadow: '0 0 30px rgba(var(--accent-rgb),1), 0 0 70px rgba(var(--accent-rgb),0.6)' }}>{isBest ? '★' : '↑'}</span>
      <span style={{ fontFamily: UI.fontUi, fontSize: 28, color: UI.gold, fontWeight: 900, letterSpacing: '0.2em', textShadow: '0 0 15px rgba(var(--accent-rgb),1), 0 0 40px rgba(var(--accent-rgb),0.8)' }}>{isBest ? 'NEW BEST' : 'IMPROVEMENT'}</span>
      {pr.type && <span style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft, fontWeight: 700, letterSpacing: '0.28em', textTransform: 'uppercase' }}>{pr.type}</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20, minWidth: 220 }}>
        {pr.items.map(it => {
          const meta = META[it.metric];
          if (!meta) return null;
          const itemBest = it.tier === 'best';
          return (
            <div key={it.metric} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 14, color: itemBest ? UI.gold : UI.inkSoft, width: 14, textAlign: 'center', flexShrink: 0 }}>{itemBest ? '★' : '↑'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="micro" style={{ color: itemBest ? UI.gold : UI.inkFaint, letterSpacing: '0.14em' }}>{meta.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="num" style={{ fontSize: 22, color: UI.ink, fontWeight: 300 }}>{meta.fmt(it.value)}</span>
                  <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>prev {meta.fmt(it.prev)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

function CardioQuickLogSheet({ open, onClose, store, setStore, userId, editLog, onPR, prefill, logDate }) {
  const [distUnit, setDistUnitState] = useState(LB.cardioDistUnit);
  const setDistUnit = (u) => { LB.setCardioDistUnit(u); setDistUnitState(u); };

  const todayStr = LB.todayISO();
  // Defaults to the day the caller has selected (e.g. the home strip's
  // currently-browsed day), not always today — otherwise navigating back to
  // log a missed day's cardio would silently save it under today's date.
  const empty = () => ({ date: logDate || todayStr, type: '', duration: '', distance: '', paceFeeling: null, effort: null, note: '' });
  const [form, setForm] = useState(empty);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [confirmEl, confirm] = useConfirm();
  const initialSnap = useRef(null);

  useEffect(() => {
    if (!open) return;
    const du = LB.cardioDistUnit();
    const next = editLog ? {
      date: editLog.date,
      type: editLog.type || '',
      duration: editLog.durationMinutes ? String(editLog.durationMinutes) : '',
      distance: editLog.distanceM != null ? LB.mToDisplay(editLog.distanceM, du) : '',
      paceFeeling: editLog.paceFeeling ?? null,
      effort: editLog.effort ?? null,
      note: editLog.note || '',
    } : {
      ...empty(),
      type: prefill?.type || '',
      duration: prefill?.durationMinutes ? String(prefill.durationMinutes) : '',
      distance: prefill?.distanceM != null ? LB.mToDisplay(prefill.distanceM, du) : '',
    };
    setForm(next);
    initialSnap.current = next;
  }, [open, editLog?.id]);

  const isDirty = initialSnap.current != null && JSON.stringify(form) !== JSON.stringify(initialSnap.current);
  const requestClose = async () => {
    if (isDirty && !await confirm('Your cardio entry won\'t be saved.', { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    onClose();
  };

  const typeChips = useMemo(() => LB.recentCardioTypes(store.cardioLogs), [store.cardioLogs]);

  const canSave = form.date && form.duration && Number(form.duration) > 0;

  const save = () => {
    if (!canSave) return;
    if (editLog) {
      const updated = {
        ...editLog,
        date: form.date,
        type: form.type.trim() || null,
        durationMinutes: Math.round(Number(form.duration)),
        distanceM: form.distance ? LB.distToM(form.distance, distUnit) : null,
        paceFeeling: form.paceFeeling,
        effort: form.effort,
        note: form.note.trim() || null,
      };
      setStore(s => ({ ...s, cardioLogs: (s.cardioLogs || []).map(l => l.id === editLog.id ? updated : l) }));
    } else {
      const log = {
        id: LB.uid(),
        date: form.date,
        type: form.type.trim() || null,
        durationMinutes: Math.round(Number(form.duration)),
        distanceM: form.distance ? LB.distToM(form.distance, distUnit) : null,
        paceFeeling: form.paceFeeling,
        effort: form.effort,
        note: form.note.trim() || null,
        createdAt: new Date().toISOString(),
      };
      setStore(s => ({ ...s, cardioLogs: [log, ...(s.cardioLogs || [])] }));
      const pr = LB.detectCardioPRs(log, store.cardioLogs);
      if (pr && onPR) onPR(pr);
    }
    onClose();
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', background: UI.bgInset,
    border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4,
    padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 14,
    color: UI.ink, outline: 'none',
  };

  return (
    <Sheet open={open} onClose={requestClose} title={editLog ? 'EDIT CARDIO' : 'LOG CARDIO'}>
      {/* Date */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Date</div>
        <div style={{ display: 'flex' }}>
          <input type="date" value={form.date} max={todayStr} onChange={e => set('date', e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0, colorScheme: 'dark' }} />
        </div>
      </div>

      {/* Type */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Activity type</div>
        <input
          type="text" placeholder="e.g. Running, Cycling…"
          value={form.type} onChange={e => set('type', e.target.value)}
          style={inputStyle}
        />
        {typeChips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {typeChips.map(t => (
              <button key={t} onClick={() => set('type', t)} style={{
                padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${form.type === t ? 'var(--accent)' : UI.hairStrong}`,
                background: form.type === t ? `rgba(var(--accent-rgb),0.12)` : 'transparent',
                color: form.type === t ? 'var(--accent)' : UI.inkFaint,
                fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.04em',
                WebkitTapHighlightColor: 'transparent',
              }}>{t}</button>
            ))}
          </div>
        )}
      </div>

      {/* Duration + Distance */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Duration (min)</div>
          <input type="number" inputMode="numeric" placeholder="—" value={form.duration} onChange={e => set('duration', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Distance</span>
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}` }}>
              {['km', 'mi'].map(u => (
                <button key={u} onClick={() => setDistUnit(u)} style={{
                  padding: '2px 7px', cursor: 'pointer', border: 'none',
                  background: distUnit === u ? 'var(--accent)' : 'transparent',
                  color: distUnit === u ? UI.bg : UI.inkFaint,
                  fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
                  WebkitTapHighlightColor: 'transparent',
                }}>{u}</button>
              ))}
            </div>
          </div>
          <input type="number" inputMode="decimal" placeholder="—" value={form.distance} onChange={e => set('distance', e.target.value)} style={inputStyle} />
        </div>
      </div>

      {/* Pace feeling */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Pace feeling</span>
          {form.paceFeeling != null && <span className="num" style={{ fontSize: 11, color: 'var(--accent)' }}>{form.paceFeeling}/6</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['1','Easy'],['2','Light'],['3','Steady'],['4','Solid'],['5','Hard'],['6','Max']].map(([n, lbl]) => (
            <button key={n} onClick={() => set('paceFeeling', form.paceFeeling === Number(n) ? null : Number(n))} style={{
              flex: 1, padding: '7px 2px', borderRadius: 8, cursor: 'pointer',
              border: `0.5px solid ${form.paceFeeling === Number(n) ? 'var(--accent)' : UI.hairStrong}`,
              background: form.paceFeeling === Number(n) ? `rgba(var(--accent-rgb),0.18)` : UI.bgInset,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              WebkitTapHighlightColor: 'transparent',
            }}>
              <span className="num" style={{ fontSize: 13, color: form.paceFeeling === Number(n) ? 'var(--accent)' : UI.inkSoft }}>{n}</span>
              <span style={{ fontSize: 8, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.04em' }}>{lbl}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Effort 1–10 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Effort</span>
          {form.effort != null && <span className="num" style={{ fontSize: 11, color: 'var(--accent)' }}>{form.effort}/10</span>}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[1,2,3,4,5,6,7,8,9,10].map(n => (
            <button key={n} onClick={() => set('effort', form.effort === n ? null : n)} style={{
              flex: 1, padding: '7px 0', borderRadius: 6, cursor: 'pointer',
              border: `0.5px solid ${form.effort === n ? 'var(--accent)' : UI.hairStrong}`,
              background: form.effort === n ? `rgba(var(--accent-rgb),0.18)` : UI.bgInset,
              WebkitTapHighlightColor: 'transparent',
            }}>
              <span className="num" style={{ fontSize: 11, color: form.effort === n ? 'var(--accent)' : UI.inkSoft }}>{n}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Note */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Note (optional)</div>
        <textarea rows={2} placeholder="…" value={form.note} onChange={e => set('note', e.target.value)} style={{ ...inputStyle, resize: 'none' }} />
      </div>

      <Btn onClick={save} disabled={!canSave} style={{ width: '100%' }}>SAVE</Btn>
      {confirmEl}
    </Sheet>
  );
}

// ─── LIVE CARDIO ──────────────────────────────────────────────────────

function fmtCardioClock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Live cardio stopwatch. The start time lives in localStorage so the count
// survives a phone lock, a reload, or navigating away — elapsed is always
// derived from (now − start), never an incrementing counter.
function CardioLiveSheet({ open, onFinish, onCancel }) {
  const [now, setNow] = useState(Date.now());
  const startRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    let start;
    try { start = Number(localStorage.getItem(CARDIO_LIVE_KEY)); } catch (_) { start = 0; }
    if (!start) { start = Date.now(); try { localStorage.setItem(CARDIO_LIVE_KEY, String(start)); } catch (_) {} }
    startRef.current = start;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;
  const elapsedSec = Math.max(0, Math.floor((now - (startRef.current || now)) / 1000));
  const clearStart = () => { try { localStorage.removeItem(CARDIO_LIVE_KEY); } catch (_) {} };
  const finish = () => { clearStart(); onFinish(Math.max(1, Math.round(elapsedSec / 60))); };
  const cancel = () => { clearStart(); onCancel(); };

  return (
    <Sheet open={open} onClose={() => {}} title="LIVE CARDIO" titleColor="var(--accent)">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '8px 0 28px' }}>
        <i className="fa-solid fa-person-running" style={{ fontSize: 22, color: UI.inkFaint }} />
        <div className="num" style={{ fontSize: 56, color: 'var(--accent)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{fmtCardioClock(elapsedSec)}</div>
        <div className="micro" style={{ color: UI.inkFaint }}>Recording…</div>
      </div>
      <Btn onClick={finish} style={{ width: '100%', marginBottom: 8 }}>Finish &amp; log</Btn>
      <Btn kind="ghost" onClick={cancel} style={{ width: '100%', color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.2)' }}>Cancel</Btn>
    </Sheet>
  );
}

// Guided post-live flow: a "well done" moment, then one metric per step.
// Saves the same shape as the manual log, so cardio PR detection still fires.
function CardioFinishFlow({ open, durationMin, store, setStore, onClose, onPR }) {
  const [distUnit, setDistUnitState] = useState(LB.cardioDistUnit);
  const setDistUnit = (u) => { LB.setCardioDistUnit(u); setDistUnitState(u); };
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ type: '', distance: '', paceFeeling: null, effort: null, note: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setForm({ type: '', distance: '', paceFeeling: null, effort: null, note: '' });
    setDistUnitState(LB.cardioDistUnit());
  }, [open]);

  const typeChips = useMemo(() => LB.recentCardioTypes(store.cardioLogs), [store.cardioLogs]);

  const METRICS = 5;
  const next = () => setStep(s => s + 1);
  const back = () => setStep(s => Math.max(0, s - 1));
  const pick = (k, v) => { set(k, v); setTimeout(() => setStep(s => s + 1), 200); };

  const save = () => {
    const log = {
      id: LB.uid(),
      date: LB.todayISO(),
      type: form.type.trim() || null,
      durationMinutes: durationMin,
      distanceM: form.distance ? LB.distToM(form.distance, distUnit) : null,
      paceFeeling: form.paceFeeling,
      effort: form.effort,
      note: form.note.trim() || null,
      createdAt: new Date().toISOString(),
    };
    setStore(s => ({ ...s, cardioLogs: [log, ...(s.cardioLogs || [])] }));
    const pr = LB.detectCardioPRs(log, store.cardioLogs);
    onClose();
    if (pr && onPR) onPR(pr);
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', background: UI.bgInset,
    border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4,
    padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none',
  };

  const titles = { 1: 'What did you do?', 2: 'How far did you go?', 3: 'How did the pace feel?', 4: 'How hard was it?', 5: 'Any notes?' };
  const hasValue = step === 1 ? !!form.type.trim() : step === 2 ? !!form.distance
    : step === 3 ? form.paceFeeling != null : step === 4 ? form.effort != null : true;

  const stepInput = () => {
    if (step === 1) return (
      <>
        <input type="text" placeholder="e.g. Running, Cycling…" value={form.type} onChange={e => set('type', e.target.value)} style={inputStyle} />
        {typeChips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {typeChips.map(t => (
              <button key={t} onClick={() => set('type', t)} style={{
                padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${form.type === t ? 'var(--accent)' : UI.hairStrong}`,
                background: form.type === t ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                color: form.type === t ? 'var(--accent)' : UI.inkFaint,
                fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.04em', WebkitTapHighlightColor: 'transparent',
              }}>{t}</button>
            ))}
          </div>
        )}
      </>
    );
    if (step === 2) return (
      <>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}` }}>
            {['km', 'mi'].map(u => (
              <button key={u} onClick={() => setDistUnit(u)} style={{
                padding: '2px 9px', cursor: 'pointer', border: 'none',
                background: distUnit === u ? 'var(--accent)' : 'transparent',
                color: distUnit === u ? UI.bg : UI.inkFaint,
                fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent',
              }}>{u}</button>
            ))}
          </div>
        </div>
        <input type="number" inputMode="decimal" placeholder="—" value={form.distance} onChange={e => set('distance', e.target.value)} style={inputStyle} />
      </>
    );
    if (step === 3) return (
      <div style={{ display: 'flex', gap: 6 }}>
        {[['1', 'Easy'], ['2', 'Light'], ['3', 'Steady'], ['4', 'Solid'], ['5', 'Hard'], ['6', 'Max']].map(([n, lbl]) => (
          <button key={n} onClick={() => pick('paceFeeling', Number(n))} style={{
            flex: 1, padding: '10px 2px', borderRadius: 8, cursor: 'pointer',
            border: `0.5px solid ${form.paceFeeling === Number(n) ? 'var(--accent)' : UI.hairStrong}`,
            background: form.paceFeeling === Number(n) ? 'rgba(var(--accent-rgb),0.18)' : UI.bgInset,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, WebkitTapHighlightColor: 'transparent',
          }}>
            <span className="num" style={{ fontSize: 14, color: form.paceFeeling === Number(n) ? 'var(--accent)' : UI.inkSoft }}>{n}</span>
            <span style={{ fontSize: 8, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.04em' }}>{lbl}</span>
          </button>
        ))}
      </div>
    );
    if (step === 4) return (
      <div style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
          <button key={n} onClick={() => pick('effort', n)} style={{
            flex: 1, padding: '10px 0', borderRadius: 6, cursor: 'pointer',
            border: `0.5px solid ${form.effort === n ? 'var(--accent)' : UI.hairStrong}`,
            background: form.effort === n ? 'rgba(var(--accent-rgb),0.18)' : UI.bgInset, WebkitTapHighlightColor: 'transparent',
          }}>
            <span className="num" style={{ fontSize: 12, color: form.effort === n ? 'var(--accent)' : UI.inkSoft }}>{n}</span>
          </button>
        ))}
      </div>
    );
    return <textarea rows={3} placeholder="…" value={form.note} onChange={e => set('note', e.target.value)} style={{ ...inputStyle, resize: 'none' }} />;
  };

  return (
    <Sheet open={open} onClose={() => {}}>
      {step === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, padding: '4px 0 4px' }}>
          <i className="fa-solid fa-circle-check" style={{ fontSize: 40, color: 'var(--accent)' }} />
          <div className="display" style={{ fontSize: 34, color: UI.ink, letterSpacing: '0.04em' }}>WELL DONE</div>
          <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.inkSoft }}>You moved for</div>
          <div className="num" style={{ fontSize: 48, color: 'var(--accent)', lineHeight: 1 }}>{durationMin}<span style={{ fontSize: 16, color: UI.inkFaint }}> min</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 18 }}>
            <Btn onClick={next} style={{ width: '100%' }}>Add details</Btn>
            <Btn kind="ghost" onClick={save} style={{ width: '100%' }}>Save now</Btn>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, padding: 6, WebkitTapHighlightColor: 'transparent' }}>Discard</button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <button onClick={back} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: UI.inkFaint, display: 'flex', alignItems: 'center', WebkitTapHighlightColor: 'transparent' }}>
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 1L1 6l5 5" /></svg>
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              {Array.from({ length: METRICS }).map((_, i) => (
                <div key={i} style={{ width: i === step - 1 ? 18 : 6, height: 6, borderRadius: 4, transition: 'all 0.2s', background: i === step - 1 ? 'var(--accent)' : i < step - 1 ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong }} />
              ))}
            </div>
            <button onClick={save} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent' }}>Save</button>
          </div>
          <div className="display" style={{ fontSize: 24, color: UI.ink, textAlign: 'center', marginBottom: 18, letterSpacing: '0.02em' }}>{titles[step]}</div>
          <div style={{ marginBottom: 22 }}>{stepInput()}</div>
          <Btn onClick={step < METRICS ? next : save} style={{ width: '100%' }}>{step < METRICS ? (hasValue ? 'Next' : 'Skip') : 'Finish'}</Btn>
        </div>
      )}
    </Sheet>
  );
}

// Given a 1-indexed cycle number, returns the start Date of that cycle for a
// Moved to store.js as LB.getCycleStartForNum — kept as thin wrapper for the
// one caller below until we can update the call site.
const getCycleStartForNum = LB.getCycleStartForNum;

// Walk backward from yesterday looking for planned training days with no
// logged session — shared core for HomeScreen's recentBannerDay (single
// most-recent candidate; any skip record at all excludes a day) and
// allMissedDays (full list further back; a '—' "soft skip" placeholder still
// counts as missed). isSkipped lets each caller apply its own inclusion rule.
function findMissedTrainingDays(sch, { weekdayMode, cycleStartDate, weekPlanStartDate, sessions, skipsMap, maxDaysAgo, isSkipped }) {
  if (!sch) return [];
  const todayD = new Date(); todayD.setHours(12, 0, 0, 0);
  const sessionDates = new Set(sessions.filter(s => s.ended).map(s => s.date.slice(0, 10)));
  const results = [];
  for (let daysAgo = 1; daysAgo <= maxDaysAgo; daysAgo++) {
    const d = new Date(todayD); d.setDate(todayD.getDate() - daysAgo);
    const dateKey = LB.fmtISO(d);
    if (sessionDates.has(dateKey)) continue;
    const sk = skipsMap.get(dateKey);
    if (isSkipped(sk)) continue;
    let trainingDay = null;
    if (weekdayMode) {
      if (weekPlanStartDate && dateKey < weekPlanStartDate) continue;
      const wd = LB.isoWd(d);
      trainingDay = sch.days.find(day => day.weekday === wd && day.items?.length > 0) || null;
    } else if (cycleStartDate) {
      const vDays = LB.getPlanDaysForDate(sch, dateKey);
      if (!vDays.length) continue;
      const cyclePosForDate = LB.getCyclePosForDate(sch, dateKey);
      let idx;
      if (cyclePosForDate !== null) {
        const start = LB.parseDate(cycleStartDate);
        if (Math.round((d.getTime() - start.getTime()) / 86400000) < 0) continue;
        idx = cyclePosForDate;
      } else {
        const start = LB.parseDate(cycleStartDate);
        const n = Math.round((d.getTime() - start.getTime()) / 86400000);
        if (n < 0) continue;
        idx = ((n % vDays.length) + vDays.length) % vDays.length;
      }
      const dayData = vDays[idx];
      if (dayData?.items?.length > 0) trainingDay = dayData;
    }
    if (!trainingDay) continue;
    results.push({ date: d, dateKey, dayName: trainingDay.name, dayId: trainingDay.id, daysAgo, skip: sk || null, dayData: trainingDay });
  }
  return results;
}

// Pull-to-open-Quick-Actions affordance, shown right below the home header.
// A bold, accent-colored chevron stays visible at rest (pullDelta === 0) so
// the gesture is discoverable without ever pulling — a returning user
// reported never finding Quick Actions at all since this used to collapse
// to zero height/opacity when idle. It's also directly tappable (not just
// a hint), growing into the full "QUICK ACTIONS"/"RELEASE" label once the
// user actually starts pulling.
function PullHintChevron({ pullDelta, onOpen }) {
  return (
    <div style={{
      flexShrink: 0,
      height: Math.max(16, Math.min(pullDelta * 0.4, 28)),
      overflow: 'hidden',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      transition: pullDelta === 0 ? 'height 0.25s ease' : 'none',
    }}>
      <button onClick={onOpen} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 14px',
        background: 'none', border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        color: pullDelta >= 65 ? UI.gold : 'var(--accent)',
        transition: pullDelta === 0 ? 'color 0.15s ease' : 'color 0.1s ease',
      }}>
        <svg width="17" height="10" viewBox="0 0 12 7" fill="none" style={{ opacity: Math.max(0.9, Math.min(1, pullDelta / 50)) }}>
          <path d="M1 1l5 4.5L11 1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {pullDelta > 0 && (
          <>
            <span style={{ fontFamily: UI.fontUi, fontSize: 9, letterSpacing: '0.18em', fontWeight: 600, opacity: Math.min(1, pullDelta / 50) }}>
              {pullDelta >= 65 ? 'RELEASE' : 'QUICK ACTIONS'}
            </span>
            <svg width="17" height="10" viewBox="0 0 12 7" fill="none" style={{ opacity: Math.min(1, pullDelta / 50) }}>
              <path d="M1 1l5 4.5L11 1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </>
        )}
      </button>
    </div>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────
function HomeScreen({ store, setStore, go, userId, syncStatus, storageFull, onRetrySync }) {
  const [confirmEl, confirm] = useConfirm();
  const trainBg = store.settings?.vipBackground || 'icons/zane-logo.png';
  const isCustomBg = trainBg !== 'icons/zane-logo.png';
  const isLightMode = (store.settings?.darkMode ?? 'dark') === 'light';
  const defaultLogoStyle = { width: '85%', maxWidth: 320, opacity: isLightMode ? 0.14 : 0.04, filter: isLightMode ? 'grayscale(1)' : 'grayscale(1) brightness(3)', objectFit: 'contain' };
  const today = LB.todaysDay(store);
  const sch = today?.schedule;
  const hasPlans = (store.schedules?.length || 0) > 0;
  const day = today?.day;
  const dayIdx = today?.idx ?? 0;
  const dayCount = sch?.days?.length || 0;
  const weekdayMode = sch ? LB.isWeekdayPlan(sch) : false;
  const isFlex = sch ? LB.isFlexPlan(sch) : false;
  // Flex plans have no calendar week — the strip is the rotation itself, so the
  // Mon–Sun cycle-week overlay never applies.
  const cycleWeekView = !weekdayMode && !isFlex && (store.settings?.cycleWeekView ?? localStorage.getItem('logbook-cycle-week-view') === 'true');

  const jsDay = new Date().getDay();
  const todayWd = jsDay === 0 ? 6 : jsDay - 1;
  // Oldest version = original plan start; null when no versioning
  const oldestVersionStart = sch?.versions?.length
    ? sch.versions[sch.versions.length - 1].validFrom
    : null;

  // Auto-migrate from cycleIndex to cycleStartDate on first load
  useEffect(() => {
    if (!weekdayMode && !isFlex && sch && !store.cycleStartDate) {
      const today = new Date(); today.setHours(12, 0, 0, 0);
      const start = new Date(today.getTime() - (store.cycleIndex || 0) * 86400000);
      setStore(s => s.cycleStartDate ? s : { ...s, cycleStartDate: LB.fmtISO(start) });
    }
  }, []); // eslint-disable-line


  const todayN = useMemo(() => {
    if (weekdayMode || !store.cycleStartDate) return store.cycleIndex || 0;
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = LB.parseDate(store.cycleStartDate);
    return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000));
  }, [store.cycleStartDate, store.cycleIndex, weekdayMode]);

  const currentCycleNum = dayCount > 0 ? Math.floor(todayN / dayCount) : 0;

  // For versioned cycle plans with cycleOffset, "today's array index" in the strip
  // differs from dayIdx (plan position). Without offset they're always equal.
  const todayStripIdx = (() => {
    if (!sch?.versions?.length || weekdayMode || isFlex) return dayIdx;
    const todayISO = LB.todayISO();
    const cn = LB.getCycleNumForDate(sch, todayISO);
    if (!cn || cn <= 0) return dayIdx;
    const cs = LB.getCycleStartForNum(sch, cn);
    if (!cs) return dayIdx;
    cs.setHours(12, 0, 0, 0);
    const csStr = LB.fmtISO(cs);
    const activeV = sch.versions.find(v => v.validFrom <= csStr) || sch.versions[sch.versions.length - 1];
    const vOffset = activeV?.cycleOffset || 0;
    const daysFromCycleStart = Math.round((new Date(todayISO + 'T12:00:00') - cs) / 86400000);
    return Math.max(0, Math.min(daysFromCycleStart + vOffset, (sch.days?.length || 1) - 1));
  })();

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedWd, setSelectedWd] = useState(todayWd);
  const [skipReasonModal, setSkipReasonModal] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(todayStripIdx);
  const [warmupPromptData, setWarmupPromptData] = useState(null);
  const [notLoggedModalOpen, setNotLoggedModalOpen] = useState(false);
  const [cardioLogOpen, setCardioLogOpen] = useState(false);
  const [cardioPopoverOpen, setCardioPopoverOpen] = useState(false);
  const [editingCardioLog, setEditingCardioLog] = useState(null);
  const [cardioPR, setCardioPR] = useState(null);
  // Resume a live cardio that was running before a reload / app restart.
  const [cardioLiveOpen, setCardioLiveOpen] = useState(() => {
    try { return !!localStorage.getItem(CARDIO_LIVE_KEY); } catch (_) { return false; }
  });
  const [cardioFinishOpen, setCardioFinishOpen] = useState(false);
  const [cardioFinishDuration, setCardioFinishDuration] = useState(null);
  const isPad = useIsPad();
  // The not-logged Log handler awaits a seed fetch — guard against a double
  // tap creating two sessions inside that window.
  const loggingRef = useRef(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [dailyLogOpen, setDailyLogOpen] = useState(false);
  const [checkinDue, setCheckinDue] = useState(false);
  const [backlogPickerOpen, setBacklogPickerOpen] = useState(false);
  const [workoutSubOpen, setWorkoutSubOpen] = useState(false);
  const [bonusDayPickerOpen, setBonusDayPickerOpen] = useState(false);
  const [freestyleSubOpen, setFreestyleSubOpen] = useState(false);
  const [checkinPickerOpen, setCheckinPickerOpen] = useState(false);
  const [pullDelta, setPullDelta] = useState(0);
  const [coachingSchema, setCoachingSchema] = useState(null);
  const [coachingMacros, setCoachingMacros] = useState(null);
  const swipeRef = useRef({ y: null, x: null });

  const minOffset = (() => {
    if (weekdayMode) {
      const startDateStr = oldestVersionStart || store.weekPlanStartDate;
      if (startDateStr) {
        const now = new Date(); now.setHours(12, 0, 0, 0);
        const currentMondayMs = now.getTime() - todayWd * 86400000;
        const start = LB.parseDate(startDateStr);
        const planMondayMs = start.getTime() - LB.isoWd(start) * 86400000;
        const week0MondayMs = planMondayMs - 7 * 86400000;
        return Math.round((week0MondayMs - currentMondayMs) / (7 * 86400000));
      }
      return -8;
    }
    if (cycleWeekView && store.cycleStartDate && dayCount > 0) {
      const now = new Date(); now.setHours(12, 0, 0, 0);
      const currentMondayMs = now.getTime() - todayWd * 86400000;
      const trueStart = oldestVersionStart
        ? LB.parseDate(oldestVersionStart)
        : new Date(LB.parseDate(store.cycleStartDate).getTime() - dayCount * 86400000);
      const oldestDayCount = oldestVersionStart
        ? (sch.versions[sch.versions.length - 1]?.days?.length || dayCount)
        : dayCount;
      const startWd = LB.isoWd(trueStart);
      const startMondayMs = trueStart.getTime() - startWd * 86400000 - oldestDayCount * 86400000;
      return Math.round((startMondayMs - currentMondayMs) / (7 * 86400000));
    }
    if (sch?.versions?.length && store.cycleStartDate) {
      return -(LB.getCycleNumForDate(sch, LB.todayISO()));
    }
    return -(currentCycleNum + 1);
  })();
  const goBack = () => {
    if (weekOffset <= minOffset) return;
    setWeekOffset(weekOffset - 1);
    if (!weekdayMode && !cycleWeekView) setSelectedSlot(dayCount - 1);
  };
  const goForward = () => {
    if (weekOffset >= 0) return;
    const next = weekOffset + 1;
    setWeekOffset(next);
    if (next === 0) {
      if (weekdayMode || cycleWeekView) setSelectedWd(todayWd);
      else setSelectedSlot(todayStripIdx);
    } else if (!weekdayMode && !cycleWeekView) {
      setSelectedSlot(dayCount - 1);
    }
  };

  const week = useMemo(() => {
    if (!sch) return [];
    if (weekdayMode) {
      return Array.from({ length: 7 }).map((_, i) => {
        const diff = i - todayWd + weekOffset * 7;
        const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + diff);
        const dateStr = LB.fmtISO(date);
        const vDays = LB.getPlanDaysForDate(sch, dateStr);
        const trainingDay = vDays.find(d => d.weekday === i) || null;
        return {
          id: `wd-${i}`, weekday: i,
          isToday: i === todayWd && weekOffset === 0,
          name: trainingDay?.name ?? 'REST',
          items: trainingDay?.items ?? [],
          date, _dayData: trainingDay,
        };
      });
    }
    if (cycleWeekView && store.cycleStartDate && dayCount > 0) {
      const start = LB.parseDate(store.cycleStartDate);
      const monday = new Date(); monday.setHours(12, 0, 0, 0);
      monday.setDate(monday.getDate() - todayWd + weekOffset * 7);
      return Array.from({ length: 7 }).map((_, i) => {
        const date = new Date(monday); date.setDate(monday.getDate() + i);
        const dateStr = LB.fmtISO(date);
        const daysFromStart = Math.round((date - start) / 86400000);
        const vDays = LB.getPlanDaysForDate(sch, dateStr);
        const cyclePosForDate = LB.getCyclePosForDate(sch, dateStr);
        const slotIdx = cyclePosForDate !== null
          ? cyclePosForDate
          : ((daysFromStart % dayCount) + dayCount) % dayCount;
        const dayData = vDays[slotIdx] || null;
        return {
          id: `cwv-${i}`, weekday: i,
          isToday: i === todayWd && weekOffset === 0,
          name: dayData?.name ?? 'REST',
          items: dayData?.items ?? [],
          date, slotIdx, daysFromStart, _dayData: dayData,
        };
      });
    }
    // Versioned classic cycle view: each weekOffset step = one version-aware cycle.
    if (sch.versions?.length && store.cycleStartDate) {
      const todayISO = LB.todayISO();
      const currentCN = LB.getCycleNumForDate(sch, todayISO);
      const targetCN = currentCN + weekOffset;
      // targetCN <= 0 → pre-plan buffer: show oldest version's days shifted back
      if (targetCN <= 0) {
        const sorted = [...sch.versions].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
        const oldest = sorted[0];
        const oldestDays = oldest?.days || sch.days;
        const oldestLen = oldestDays.length || 1;
        const planStart = new Date(oldest.validFrom + 'T12:00:00');
        const bufferStart = new Date(planStart.getTime() + (targetCN - 1) * oldestLen * 86400000);
        const anchor = LB.parseDate(store.cycleStartDate);
        return oldestDays.map((d, i) => {
          const date = new Date(bufferStart.getTime() + i * 86400000);
          const daysFromStart = Math.round((date - anchor) / 86400000);
          return { ...d, slotIdx: i, date, daysFromStart, isToday: false };
        });
      }
      const cycleStart = getCycleStartForNum(sch, targetCN);
      if (!cycleStart) return [];
      cycleStart.setHours(12, 0, 0, 0);
      const csStr = LB.fmtISO(cycleStart);
      const activeV = sch.versions.find(v => v.validFrom <= csStr) || sch.versions[sch.versions.length - 1];
      const vOffset = activeV?.cycleOffset || 0;
      const logicalStart = new Date(cycleStart.getTime() - vOffset * 86400000);
      logicalStart.setHours(12, 0, 0, 0);
      const targetDays = LB.getPlanDaysForDate(sch, csStr);
      const anchor = LB.parseDate(store.cycleStartDate);
      return targetDays.map((d, i) => {
        const date = new Date(logicalStart.getTime() + i * 86400000);
        const daysFromStart = Math.round((date - anchor) / 86400000);
        return { ...d, slotIdx: i, planPos: i, date, daysFromStart, isToday: weekOffset === 0 && i === todayStripIdx };
      });
    }
    return sch.days.map((d, i) => {
      const daysFromToday = weekOffset * dayCount + i - dayIdx;
      const date = new Date(); date.setDate(date.getDate() + daysFromToday);
      return { ...d, slotIdx: i, date, isToday: weekOffset === 0 && i === dayIdx };
    });
  }, [sch, dayIdx, todayStripIdx, dayCount, weekdayMode, cycleWeekView, todayWd, weekOffset, store.cycleStartDate]);

  const activeDay = useMemo(() => {
    if (!sch) return day;
    if (weekdayMode) {
      const sel = week.find(d => d.weekday === selectedWd);
      return sel?._dayData ?? { id: 'rest-virtual', name: 'REST', items: [], weekday: selectedWd };
    }
    if (cycleWeekView) {
      const sel = week.find(d => d.weekday === selectedWd);
      return sel?._dayData ?? { id: 'rest-virtual', name: 'REST', items: [] };
    }
    if (sch.versions?.length && week.length) {
      const clampedSlot = Math.min(selectedSlot, week.length - 1);
      return week[clampedSlot] ?? sch.days[0];
    }
    return sch.days[selectedSlot] ?? sch.days[0];
  }, [weekdayMode, cycleWeekView, sch, selectedWd, selectedSlot, day, week]);

  const sessionDate = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    if (weekdayMode || cycleWeekView) {
      d.setDate(d.getDate() + selectedWd - todayWd + weekOffset * 7);
    } else if (week.length && week[0]?.daysFromStart != null) {
      // Versioned classic cycle view: use the slot's actual calendar date.
      const clampedSlot = Math.min(selectedSlot, week.length - 1);
      return week[clampedSlot]?.date ?? d;
    } else {
      d.setDate(d.getDate() + weekOffset * dayCount + selectedSlot - dayIdx);
    }
    return d;
  }, [weekdayMode, cycleWeekView, selectedWd, todayWd, weekOffset, selectedSlot, dayIdx, dayCount, week]);

  const isViewingToday = weekOffset === 0 && ((weekdayMode || cycleWeekView) ? selectedWd === todayWd : selectedSlot === todayStripIdx);
  const isActiveRest = !activeDay?.items?.length;

  // "DAY X OF Y" denominator: with plan versioning the top-level sch.days holds
  // the newest version (which may only become active in the future), so the
  // day count must come from the version active on the date being viewed.
  const viewedDayCount = useMemo(() => {
    if (!sch?.versions?.length) return dayCount;
    const dStr = LB.fmtISO(sessionDate);
    return LB.getPlanDaysForDate(sch, dStr)?.length || dayCount;
  }, [sch, sessionDate, dayCount]);
  const isFutureSlot = sessionDate > (() => { const d = new Date(); d.setHours(12,0,0,0); return d; })();

  const periodLabel = useMemo(() => {
    if (store.statusMode === 'deload' && weekOffset === 0) return 'DELOAD';
    if (isFlex) return 'FLEXIBLE';
    if (weekdayMode) {
      if (store.weekPlanStartDate) {
        const monday = new Date(); monday.setHours(12, 0, 0, 0);
        monday.setDate(monday.getDate() - todayWd + weekOffset * 7);
        const start = LB.parseDate(store.weekPlanStartDate);
        const startMonday = new Date(start);
        startMonday.setDate(start.getDate() - LB.isoWd(start));
        startMonday.setHours(12, 0, 0, 0);
        const weekNum = Math.floor(Math.round((monday - startMonday) / 86400000) / 7) + 1;
        if (weekNum >= 0) return `WEEK ${weekNum}`;
      }
      if (weekOffset === 0) return 'THIS WEEK';
      if (weekOffset === -1) return 'LAST WEEK';
      return `${-weekOffset} WEEKS AGO`;
    }
    if (cycleWeekView && store.cycleStartDate && dayCount > 0) {
      const monday = new Date(); monday.setHours(12, 0, 0, 0);
      monday.setDate(monday.getDate() - todayWd + weekOffset * 7);
      if (sch?.versions?.length) {
        return `CYCLE ${LB.getCycleNumForDate(sch, LB.fmtISO(monday))}`;
      }
      const start = LB.parseDate(store.cycleStartDate);
      const dfs = Math.round((monday - start) / 86400000);
      return `CYCLE ${Math.floor(dfs / dayCount) + 1}`;
    }
    if (sch?.versions?.length && store.cycleStartDate) {
      const currentCN = LB.getCycleNumForDate(sch, LB.todayISO());
      return `CYCLE ${Math.max(0, currentCN + weekOffset)}`;
    }
    const cycleNum = currentCycleNum + weekOffset + 1;
    return `CYCLE ${cycleNum}`;
  }, [isFlex, weekdayMode, cycleWeekView, weekOffset, currentCycleNum, todayWd, store.cycleStartDate, dayCount, sch, store.statusMode]);

  const cardLabel = useMemo(() => {
    // During a deload, today's label reads DELOAD instead of TODAY/NEXT UP so
    // the strip clearly signals the light week. Reverts automatically on end.
    const todayWord = (isViewingToday && store.statusMode === 'deload') ? 'DELOAD' : 'TODAY';
    if (isFlex) {
      return `${isViewingToday ? (store.statusMode === 'deload' ? 'DELOAD · ' : 'NEXT UP · ') : ''}DAY ${selectedSlot + 1} OF ${viewedDayCount}`;
    }
    // For versioned cycle plans with cycleOffset, planPos is the plan day index;
    // for all other cycle plans planPos is absent and selectedSlot equals plan position.
    const dayNum = (week[selectedSlot]?.planPos ?? selectedSlot) + 1;
    if (isViewingToday) {
      if (weekdayMode) return `${todayWord} · ${WEEKDAYS_FULL[selectedWd].toUpperCase()}`;
      if (cycleWeekView) {
        const sel = week.find(d => d.weekday === selectedWd);
        return `${todayWord} · DAY ${(sel?.slotIdx ?? 0) + 1} OF ${viewedDayCount}`;
      }
      return `${todayWord} · DAY ${dayNum} OF ${viewedDayCount}`;
    }
    const dateStr = sessionDate.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
    if (weekdayMode) return dateStr;
    if (cycleWeekView) {
      const sel = week.find(d => d.weekday === selectedWd);
      return `${dateStr} · DAY ${(sel?.slotIdx ?? 0) + 1} OF ${viewedDayCount}`;
    }
    return `${dateStr} · DAY ${dayNum} OF ${viewedDayCount}`;
  }, [isFlex, isViewingToday, weekdayMode, cycleWeekView, selectedWd, selectedSlot, viewedDayCount, sessionDate, week, store.statusMode]);

  const avgDayDuration = useMemo(() => {
    if (!activeDay?.id) return null;
    const past = store.sessions.filter(s => s.dayId === activeDay.id && s.ended);
    if (!past.length) return null;
    const mins = past.map(s => s.durationMinutes != null
      ? s.durationMinutes
      : (s.startedAt && s.ended ? Math.round((new Date(s.ended) - new Date(s.startedAt)) / 60000) : null)
    ).filter(d => d != null && d > 0);
    if (!mins.length) return null;
    return Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
  }, [store.sessions, activeDay?.id]);

  const lastSession = useMemo(() => {
    return [...store.sessions].filter(s => s.ended).sort((a,b) => (b.ended||'').localeCompare(a.ended||''))[0];
  }, [store.sessions]);

  const doneSession = useMemo(() => {
    // Flex slots carry no calendar date — a past rotation slot maps back to the
    // most recent session logged for that day so "going back" shows the workout.
    if (isFlex) {
      if (selectedSlot >= dayIdx || !activeDay?.id) return null;
      // Bound to the current rotation pass: match the session logged at this
      // slot's absolute rotation position (cyclePos), not any months-old
      // session for the same day from a previous pass.
      const rotStart = (store.cycleIndex || 0) - dayIdx;
      const targetPos = rotStart + selectedSlot;
      return [...store.sessions]
        .filter(s => s.ended && s.dayId === activeDay.id && s.cyclePos === targetPos)
        .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0] ?? null;
    }
    const dateKey = LB.fmtISO(sessionDate);
    return [...store.sessions]
      .filter(s => s.ended && s.date.slice(0, 10) === dateKey)
      .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0] ?? null;
  }, [isFlex, selectedSlot, dayIdx, activeDay?.id, store.sessions, store.cycleIndex, sessionDate]);

  const { improvementCount, regressionCount } = useMemo(() => {
    if (!doneSession) return { improvementCount: 0, regressionCount: 0 };
    const cmp = (st, prevSet, better) => {
      if (!prevSet || !st.done || st.kg == null || prevSet.kg == null) return false;
      const repsA = LB.effReps(st); const repsB = LB.effReps(prevSet);
      if (repsA == null || repsB == null) return false;
      return better
        ? (st.kg > prevSet.kg && repsA >= repsB - 2) || (st.kg >= prevSet.kg && repsA > repsB)
        : (st.kg < prevSet.kg && repsA <= repsB) || (st.kg === prevSet.kg && repsA < repsB);
    };
    let improvements = 0, regressions = 0;
    doneSession.entries.forEach(e => {
      const prev = [...store.sessions]
        .filter(x => x.ended && x.id !== doneSession.id && x.dayId === doneSession.dayId && x.ended < doneSession.ended)
        .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))
        .find(x => x.entries.some(en => en.exId === e.exId && en.sets.some(st => st.kg != null || st.reps != null)));
      const prevEntry = prev?.entries.find(en => en.exId === e.exId);
      if (!prevEntry) return;
      // Compare working sets by position, warmups AND skipped sets excluded on
      // both sides so set N always lines up against set N.
      const currWorking = e.sets.filter(st => !st.warmup && !st.skipped);
      const prevWorking = prevEntry.sets.filter(st => !st.warmup && !st.skipped);
      const improved = currWorking.some((st, j) => cmp(st, prevWorking[j], true));
      if (improved) { improvements++; return; }
      const regressed = currWorking.some((st, j) => cmp(st, prevWorking[j], false));
      if (regressed) regressions++;
    });
    return { improvementCount: improvements, regressionCount: regressions };
  }, [doneSession, store.sessions]);

  const completedCyclePos = useMemo(() => {
    if (weekdayMode || !sch) return null;
    const set = new Set();
    if (store.cycleStartDate) {
      const start = LB.parseDate(store.cycleStartDate);
      store.sessions.filter(s => s.ended).forEach(s => {
        const d = LB.parseDate(s.date);
        set.add(Math.round((d - start) / 86400000));
      });
    } else {
      store.sessions.filter(s => s.ended && s.cyclePos != null).forEach(s => set.add(s.cyclePos));
    }
    return set;
  }, [store.sessions, weekdayMode, sch, store.cycleStartDate]);

  const completedDateKeys = useMemo(() => {
    if (!weekdayMode) return null;
    const set = new Set();
    store.sessions.filter(s => s.ended).forEach(s => {
      const d = LB.parseDate(s.date);
      set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    });
    return set;
  }, [store.sessions, weekdayMode]);

  const cycleBarSegments = useMemo(() => {
    if (!cycleWeekView || weekdayMode || !store.cycleStartDate || !sch || dayCount === 0) return null;
    const start = LB.parseDate(store.cycleStartDate);
    const monday = new Date(); monday.setHours(12, 0, 0, 0);
    monday.setDate(monday.getDate() - todayWd + weekOffset * 7);
    const cycleNums = Array.from({ length: 7 }).map((_, i) => {
      const date = new Date(monday); date.setDate(monday.getDate() + i);
      if (sch?.versions?.length) {
        return LB.getCycleNumForDate(sch, LB.fmtISO(date));
      }
      const dfs = Math.round((date - start) / 86400000);
      return Math.floor(dfs / dayCount) + 1;
    });
    const segments = [];
    let cur = { cycleNum: cycleNums[0], count: 1 };
    for (let i = 1; i < cycleNums.length; i++) {
      if (cycleNums[i] === cur.cycleNum) { cur.count++; }
      else { segments.push(cur); cur = { cycleNum: cycleNums[i], count: 1 }; }
    }
    segments.push(cur);
    return segments;
  }, [cycleWeekView, weekdayMode, store.cycleStartDate, sch, dayCount, todayWd, weekOffset]);

  const isSlotDone = useMemo(() => {
    if (isActiveRest) return false;
    // Flex: the next-up day is never "done", but earlier slots in the current
    // rotation pass are — show their completed session when scrolling back.
    if (isFlex) return selectedSlot < dayIdx && !!doneSession;
    if (weekdayMode) {
      const key = `${sessionDate.getFullYear()}-${sessionDate.getMonth()}-${sessionDate.getDate()}`;
      return completedDateKeys?.has(key) ?? false;
    }
    if (cycleWeekView) {
      const sel = week.find(d => d.weekday === selectedWd);
      return sel?.daysFromStart != null && (completedCyclePos?.has(sel.daysFromStart) ?? false);
    }
    const sel = week[Math.min(selectedSlot, week.length - 1)];
    if (sel?.daysFromStart != null) return completedCyclePos?.has(sel.daysFromStart) ?? false;
    const pos = (currentCycleNum + weekOffset) * dayCount + selectedSlot;
    return completedCyclePos?.has(pos) ?? false;
  }, [isActiveRest, isFlex, dayIdx, doneSession, weekdayMode, cycleWeekView, sessionDate, completedDateKeys, completedCyclePos, week, selectedWd, currentCycleNum, weekOffset, dayCount, selectedSlot]);

  const skipsMap = useMemo(() => {
    const m = new Map();
    (store.skips || []).forEach(s => m.set(s.date.slice(0, 10), s));
    return m;
  }, [store.skips]);

  const statusPeriodModeFor = useMemo(() => {
    const periods = store.statusPeriods || [];
    return (date) => {
      const ts = date.getTime();
      const p = periods.find(p => {
        const start = new Date(p.startedAt).getTime();
        const end = p.endedAt ? new Date(p.endedAt).getTime() : Date.now();
        return ts >= start && ts <= end;
      });
      return p ? p.mode : null;
    };
  }, [store.statusPeriods]);

  const selectedDateSkip = useMemo(() => {
    if (isFlex || isViewingToday || isFutureSlot) return null;
    return skipsMap.get(LB.fmtISO(sessionDate)) ?? null;
  }, [isFlex, isViewingToday, isFutureSlot, skipsMap, sessionDate]);

  const selectedDayStatusMode = useMemo(() => {
    if (isFutureSlot) return null;
    if (isViewingToday) return store.statusMode ?? null;
    return statusPeriodModeFor(sessionDate);
  }, [isViewingToday, isFutureSlot, store.statusMode, statusPeriodModeFor, sessionDate]);

  const handleClearStatus = () => LB.clearStatusMode(userId, store, setStore);

  // After training while Sick mode is on, offer to end it — catches the common
  // "forgot to toggle it off" case. Covers both strength and cardio sessions,
  // sick only (training on vacation is normal). Asks at most once per day,
  // whichever way the user answers.
  const sickPromptShown = useRef(false);
  useEffect(() => {
    if (store?.statusMode !== 'sick' || sickPromptShown.current) return;
    const today = LB.todayISO();
    let dismissed = false;
    try { dismissed = localStorage.getItem('logbook-sick-recover-prompt') === today; } catch (_) {}
    if (dismissed) return;
    const trainedToday = (store.sessions || []).some(s => s.ended && s.ended.slice(0, 10) === today)
      || (store.cardioLogs || []).some(l => l.date === today);
    if (!trainedToday) return;
    sickPromptShown.current = true;
    (async () => {
      const yes = await confirm(
        'You logged a session while Sick mode is on. Feeling better and ready to end it?',
        { title: 'End sick mode?', ok: 'End sick mode', cancel: 'Stay in sick mode' },
      );
      try { localStorage.setItem('logbook-sick-recover-prompt', today); } catch (_) {}
      if (yes) await LB.clearStatusMode(userId, store, setStore);
    })();
  }, [store?.statusMode, store?.sessions, store?.cardioLogs]);

  // Eagerly create the meso state as soon as a plan with mesocycle_weeks is
  // detected but has no corresponding state yet. This ensures the pending chip
  // appears immediately after enabling meso — not only after the first training
  // session opens. The useEffectT in screens-train still handles the live
  // training case and re-creates if the week count changes.
  useEffect(() => {
    if (!sch?.mesocycle_weeks || !sch?.id || !userId) return;
    const schId = sch.id;
    // Recompute everything from the freshest store snapshot (`s`, inside the
    // functional setStore updater) instead of the `sch`/`store` closed over
    // above. A plan edit that both changes the day structure (new version +
    // cycleOffset) AND flips mesocycle_weeks on commits via two back-to-back
    // setStore calls in doSave() — aligning against the closure risks reading
    // a schedule snapshot that predates one of those commits, which silently
    // drops the cycleOffset and computes "today" instead of the true next D1.
    setStore(s => {
      const freshSch = s.schedules.find(x => x.id === schId);
      if (!freshSch?.mesocycle_weeks) return s;
      const existing = (s.mesoStates || []).find(m => m.scheduleId === schId);
      // Keep existing meso only if weeks match the current config — mirrors the
      // recreate guard in screens-train.jsx's session auto-start effect, so a
      // changed week count always starts fresh regardless of which effect runs
      // first.
      if (existing && existing.weeks === freshSch.mesocycle_weeks) return s;
      const _daysLen = freshSch.days.length || 1;
      const _isWeekday = LB.isWeekdayPlan(freshSch);
      const _isFlex = LB.isFlexPlan(freshSch);
      const _ci = s.cycleIndex || 0;
      let alignedStartDate, alignedStartIdx;
      if (_isWeekday) {
        alignedStartDate = LB.nextMondayISO();
        alignedStartIdx = _ci;
      } else if (_isFlex) {
        alignedStartIdx = _ci % _daysLen === 0 ? _ci : Math.ceil(_ci / _daysLen) * _daysLen;
        alignedStartDate = LB.todayISO();
      } else {
        alignedStartDate = LB.nextCycleD1ISOFromSchedule(freshSch, s.cycleStartDate);
        alignedStartIdx = 0;
      }
      const newMeso = {
        id: userId + '_' + schId,
        scheduleId: schId,
        weeks: freshSch.mesocycle_weeks,
        startDate: alignedStartDate,
        startCycleIndex: alignedStartIdx,
        deltas: {}, jointFlags: {}, pumpLowCounts: {}, weightBoosts: {}, growthCounts: {},
        completions: existing?.completions ?? 0,
        updatedAt: new Date().toISOString(),
      };
      const others = (s.mesoStates || []).filter(m => m.scheduleId !== schId);
      return { ...s, mesoStates: [...others, newMeso] };
    });
  }, [sch?.id, sch?.mesocycle_weeks, store?.mesoStates, userId]); // eslint-disable-line

  // Auto-end a deload once it has run its course (one cycle / week elapsed, or
  // the flex session goal of deload sessions logged). Runs on mount and when the
  // relevant inputs change; endDeload no-ops if already off.
  const deloadEndChecked = useRef(false);
  useEffect(() => {
    if (store?.statusMode !== 'deload') { deloadEndChecked.current = false; return; }
    if (deloadEndChecked.current) return;
    if (LB.deloadElapsed(store)) {
      deloadEndChecked.current = true;
      LB.endDeload(userId, store, setStore);
    }
  }, [store?.statusMode, store?.statusModeSince, store?.sessions]);

  // After a meso-triggered deload ends (or if pendingMeso2 is set without an active deload),
  // offer to start Meso 2, continue as a regular cycle, or deactivate the plan.
  const pendingMeso2Checked = useRef(false);
  useEffect(() => {
    if (store?.statusMode === 'deload') { pendingMeso2Checked.current = false; return; }
    if (pendingMeso2Checked.current) return;
    if (store?.inProgress) return;
    if (!sch) return;
    const mesoSt = (store?.mesoStates || []).find(m => m.scheduleId === sch.id);
    if (!mesoSt?.pendingMeso2) return;
    pendingMeso2Checked.current = true;
    (async () => {
      const scheduleId = sch.id;
      const nextNum = (mesoSt.completions ?? 0) + 1; // the block being offered
      const wantMeso2 = await confirm(
        `Your deload is done — nice recovery! Ready to kick off Meso ${nextNum}? Your earned weight boosts carry over and set counts reset to baseline.`,
        { title: `Start Meso ${nextNum}?`, ok: `Start Meso ${nextNum}`, cancel: 'Skip', preventBackdropClose: true },
      );
      if (wantMeso2) {
        const existing = (store.mesoStates || []).find(m => m.scheduleId === scheduleId);
        if (existing) {
          const sc2 = store.schedules?.find(sc => sc.id === scheduleId);
          const isWd = sc2 ? LB.isWeekdayPlan(sc2) : false;
          const isFlex2 = sc2 ? LB.isFlexPlan(sc2) : false;
          const daysLen2 = sc2?.days?.length || 1;
          const ci = store.cycleIndex || 0;
          let startDate2, startCycleIndex2;
          if (isWd) {
            startDate2 = LB.nextMondayISO();
            startCycleIndex2 = existing.startCycleIndex ?? 0;
          } else if (isFlex2) {
            startCycleIndex2 = ci % daysLen2 === 0 ? ci : Math.ceil(ci / daysLen2) * daysLen2;
            startDate2 = LB.todayISO();
          } else {
            startDate2 = LB.nextCycleD1ISOFromSchedule(sc2, store.cycleStartDate);
            startCycleIndex2 = 0;
          }
          const newMeso = {
            ...existing,
            startDate: startDate2,
            startCycleIndex: startCycleIndex2,
            deltas: {},
            jointFlags: {},
            pumpLowCounts: {},
            growthCounts: {},
            pendingMeso2: false,
            startedAt: new Date().toISOString(), // fresh block-start anchor (flex week count)
            updatedAt: new Date().toISOString(),
          };
          // Overwrite the per-plan localStorage cache too — getMesoState returns
          // whichever of {store, cache} is newer by updatedAt, so leaving the
          // stale Meso-1 cache in place would keep winning and the home strip /
          // training screen would still show the old (completed) block.
          if (typeof saveMesoStateToStorage === 'function') saveMesoStateToStorage(newMeso);
          setStore(s => ({ ...s, mesoStates: [...(s.mesoStates || []).filter(m => m.scheduleId !== scheduleId), newMeso] }));
        }
        return;
      }
      const keepActive = await confirm(
        'Keep the plan active as a regular cycle (no meso), or deactivate it?',
        { title: 'What\'s next?', ok: 'Continue as cycle', cancel: 'Deactivate plan', preventBackdropClose: true },
      );
      if (keepActive) {
        setStore(s => ({
          ...s,
          schedules: s.schedules.map(sc =>
            sc.id === scheduleId ? { ...sc, mesocycle_weeks: null } : sc
          ),
          mesoStates: (s.mesoStates || []).map(m =>
            m.scheduleId === scheduleId ? { ...m, pendingMeso2: false, updatedAt: new Date().toISOString() } : m
          ),
        }));
      } else {
        setStore(s => ({
          ...s,
          activeScheduleId: null,
          schedules: s.schedules.map(sc =>
            sc.id === scheduleId ? { ...sc, mesocycle_weeks: null } : sc
          ),
          mesoStates: (s.mesoStates || []).map(m =>
            m.scheduleId === scheduleId ? { ...m, pendingMeso2: false, updatedAt: new Date().toISOString() } : m
          ),
        }));
      }
    })();
  }, [store?.statusMode, store?.mesoStates, sch?.id, store?.inProgress]);

  // After every 8 completed cycles (cycle plans), 8 complete weeks (weekday plans),
  // or 8×sessions_per_week sessions (flex plans), congratulate the user and offer a
  // deload. Fires only when a non-deload session is completed on the last training
  // day of that block. Anchor resets on each dismissal so the next prompt is 8 more
  // cycles/weeks/sessions away.
  const deloadNudgeShown = useRef(false);
  useEffect(() => {
    if (deloadNudgeShown.current) return;
    if (store?.statusMode || store?.inProgress) return;
    if (!sch) return;
    // A mesocycle is never interrupted by a deload — the deload comes AFTER the
    // meso finishes (handleMesoComplete). While a meso is active on this plan,
    // suppress the generic 8-week auto-deload nudge so it can't fire mid-meso.
    if (sch.mesocycle_weeks) return;

    const todayStr = LB.todayISO();
    const justFinished = (store?.sessions || []).some(
      s => s.ended && s.date?.slice(0, 10) === todayStr && !s.isDeload,
    );
    if (!justFinished) return;

    const todayD = new Date(todayStr + 'T12:00:00');
    let shouldPrompt = false;
    let deloadCycleInfo = null; // { cyclePos, cycleLen } for next-cycle-start alignment
    let title = '8 cycles done! 🎉';
    let body = "You've completed 8 full training cycles — that's serious dedication. A deload week now means you come back stronger. Want to start one?";

    if (LB.isFlexPlan(sch)) {
      const anchorTS = store?.deloadPromptDismissedAt ? new Date(store.deloadPromptDismissedAt) : new Date(0);
      const spw = sch.sessions_per_week || 3;
      const goal = spw * 8;
      const count = (store.sessions || []).filter(
        s => s.ended && !s.isDeload && new Date(s.ended) >= anchorTS,
      ).length;
      if (count > 0 && count % goal === 0) {
        shouldPrompt = true;
        title = `${goal} sessions done! 🎉`;
        body = `You've logged ${goal} training sessions — solid work. A deload week now means you come back stronger. Want to start one?`;
      }
    } else if (LB.isWeekdayPlan(sch)) {
      const firstSession = (store?.sessions || []).filter(s => s.ended && s.date).map(s => s.date.slice(0, 10)).sort()[0] || null;
      const anchorStr = store?.deloadPromptDismissedAt || store?.weekPlanStartDate || firstSession;
      if (anchorStr) {
        const anchorD = new Date(anchorStr.slice(0, 10) + 'T12:00:00');
        const daysElapsed = Math.round((todayD - anchorD) / 86400000);
        const weekFromAnchor = Math.floor(daysElapsed / 7);
        if (weekFromAnchor >= 7 && weekFromAnchor % 8 === 7) {
          const vDays = LB.getPlanDaysForDate(sch, todayStr);
          const trainingWds = vDays.filter(d => d.weekday != null && (d.items || []).length > 0).map(d => d.weekday);
          const lastWd = trainingWds.length ? Math.max(...trainingWds) : -1;
          if (lastWd >= 0 && LB.isoWd(todayD) === lastWd) {
            shouldPrompt = true;
            title = '8 weeks done! 🎉';
            body = "You've completed 8 solid weeks of training — impressive consistency. A deload week now means you'll come back even stronger. Want to start one?";
          }
        }
      }
    } else if (sch.versions?.length) {
      const cycleNum = LB.getCycleNumForDate(sch, todayStr);
      if (cycleNum > 0) {
        const cyclePos = LB.getCyclePosForDate(sch, todayStr);
        const days = LB.getPlanDaysForDate(sch, todayStr);
        const lastTrainingIdx = days.reduce((last, d, i) => ((d.items || []).length > 0 ? i : last), -1);
        if (cyclePos !== null && lastTrainingIdx >= 0 && cyclePos === lastTrainingIdx) {
          const anchorStr = store?.deloadPromptDismissedAt;
          let eligible;
          if (anchorStr) {
            const anchorCycleNum = LB.getCycleNumForDate(sch, anchorStr.slice(0, 10));
            const diff = anchorCycleNum ? cycleNum - anchorCycleNum : 0;
            eligible = diff > 0 && diff % 8 === 0;
          } else {
            eligible = cycleNum % 8 === 0;
          }
          if (eligible) {
            shouldPrompt = true;
            deloadCycleInfo = { cyclePos, cycleLen: days.length };
          }
        }
      }
    } else {
      // Unversioned cycle plan: fall back to store.cycleStartDate for position.
      const cycleLen = (sch.days || []).length;
      const cycleStartStr = store?.cycleStartDate;
      if (cycleLen && cycleStartStr) {
        const cycleStartD = new Date(cycleStartStr + 'T12:00:00');
        const daysFromStart = Math.round((todayD - cycleStartD) / 86400000);
        if (daysFromStart >= 0) {
          const cycleNum = Math.floor(daysFromStart / cycleLen) + 1;
          const cyclePos = daysFromStart % cycleLen;
          const lastTrainingIdx = (sch.days || []).reduce((last, d, i) => ((d.items || []).length > 0 ? i : last), -1);
          if (lastTrainingIdx >= 0 && cyclePos === lastTrainingIdx) {
            const anchorStr = store?.deloadPromptDismissedAt;
            let eligible;
            if (anchorStr) {
              const anchorD2 = new Date(anchorStr.slice(0, 10) + 'T12:00:00');
              const anchorDaysFromStart = Math.round((anchorD2 - cycleStartD) / 86400000);
              const anchorCycleNum = anchorDaysFromStart >= 0 ? Math.floor(anchorDaysFromStart / cycleLen) + 1 : 0;
              const diff = cycleNum - anchorCycleNum;
              eligible = diff > 0 && diff % 8 === 0;
            } else {
              eligible = cycleNum % 8 === 0;
            }
            if (eligible) {
              shouldPrompt = true;
              deloadCycleInfo = { cyclePos, cycleLen };
            }
          }
        }
      }
    }

    if (!shouldPrompt) return;
    deloadNudgeShown.current = true;
    (async () => {
      const yes = await confirm(body, { title, ok: 'Start deload', cancel: 'Not now', preventBackdropClose: true });
      const stamp = new Date().toISOString();
      setStore(s => ({ ...s, deloadPromptDismissedAt: stamp }));
      if (yes) {
        // Align deload window to next cycle start so rest days at end of cycle don't
        // shorten the deload. Works for both versioned and unversioned cycle plans.
        let sinceISO = null;
        if (!LB.isFlexPlan(sch) && !LB.isWeekdayPlan(sch) && deloadCycleInfo) {
          const { cyclePos, cycleLen } = deloadCycleInfo;
          if (cyclePos !== null && cycleLen > 0) {
            const nextCycleStart = new Date(todayStr + 'T00:00:00');
            nextCycleStart.setDate(nextCycleStart.getDate() + (cycleLen - cyclePos));
            sinceISO = nextCycleStart.toISOString();
          }
        }
        await LB.startDeload(userId, { ...store, deloadPromptDismissedAt: stamp }, setStore, sinceISO);
      }
    })();
  }, [store?.statusMode, store?.inProgress, store?.deloadPromptDismissedAt, store?.sessions, sch]);

  const selectedDayCardioLogs = useMemo(() => {
    const dateKey = LB.fmtISO(sessionDate);
    return (store.cardioLogs || []).filter(l => l.date === dateKey);
  }, [store.cardioLogs, sessionDate]);

  // Pre-fill for CardioQuickLogSheet: first active plan with a target on the selected date
  const cardioPlanPrefill = useMemo(() => {
    const activePlanId = store.activeCardioPlanId;
    const plans = (store.cardioPlans || []).filter(p => !p.archived && p.id === activePlanId);
    if (!plans.length) return null;
    const dateISO = LB.fmtISO(sessionDate);
    const dow = sessionDate.getDay();
    const wkKeys = ['mon','tue','wed','thu','fri','sat','sun'];
    const wk = wkKeys[dow === 0 ? 6 : dow - 1];
    for (const plan of plans) {
      if (plan.planStartDate && dateISO < plan.planStartDate) continue;
      if (!plan.days[wk]) continue;
      if (plan.mode === 'manual') {
        const t = plan.manualTargets?.[wk];
        if (t && (t.distance_m || t.duration_minutes)) {
          return { type: plan.activityType, distanceM: t.distance_m ?? null, durationMinutes: t.duration_minutes ?? null };
        }
      } else if (plan.mode === 'goal') {
        return { type: plan.activityType };
      }
    }
    return null;
  }, [store.cardioPlans, store.activeCardioPlanId, sessionDate]);

  const recentBannerDay = useMemo(() => {
    const [first] = findMissedTrainingDays(sch, {
      weekdayMode, cycleStartDate: store.cycleStartDate, weekPlanStartDate: store.weekPlanStartDate,
      sessions: store.sessions, skipsMap, maxDaysAgo: 30,
      isSkipped: sk => !!sk, // any skip record at all — already actioned, edit via calendar card
    });
    return first || null;
  }, [sch, weekdayMode, store.cycleStartDate, store.sessions, store.skips, skipsMap]);

  const allMissedDays = useMemo(() => findMissedTrainingDays(sch, {
    weekdayMode, cycleStartDate: store.cycleStartDate, weekPlanStartDate: store.weekPlanStartDate,
    sessions: store.sessions, skipsMap, maxDaysAgo: 14,
    isSkipped: sk => sk && sk.skipReason !== '—',
  }), [sch, weekdayMode, store.cycleStartDate, store.sessions, store.skips, skipsMap]);

  useEffect(() => {
    const coaching = store.coaching;
    if (!coaching) return;
    const asClient = coaching.asClient;
    const asSelf = coaching.asSelf;
    const hasCoaching = (asClient?.status === 'active' && (asClient?.checkinEnabled ?? true)) || !!asSelf;
    if (!hasCoaching) { setCheckinDue(false); return; }
    const coachingId = asClient?.id || asSelf?.id;
    if (!coachingId) { setCheckinDue(false); return; }
    LB.loadCheckins(coachingId).then(rows => {
      const weekStart = LB.checkinWeekStart();
      const thisWeek = rows.find(r => r.weekStart === weekStart);
      setCheckinDue(!thisWeek);
    }).catch(() => setCheckinDue(false));
  }, [store.coaching]);

  useEffect(() => {
    const coachingId = store.coaching?.asClient?.id || store.coaching?.asSelf?.id;
    if (!coachingId) { setCoachingSchema(null); return; }
    let cancelled = false;
    LB.loadCheckinSchema(coachingId).then(schema => {
      if (!cancelled) setCoachingSchema(schema || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [store.coaching?.asClient?.id, store.coaching?.asSelf?.id]);

  useEffect(() => {
    const coachingId = store.coaching?.asClient?.id || store.coaching?.asSelf?.id;
    if (!coachingId) { setCoachingMacros(null); return; }
    let cancelled = false;
    LB.loadCoachingMacros(coachingId).then(data => { if (!cancelled) setCoachingMacros(data[0] || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [store.coaching?.asClient?.id, store.coaching?.asSelf?.id]);

  // Seeded, meso-adjusted, server-history-merged entries for a set of plan
  // items — the one seeding pipeline every session-start path (normal,
  // bonus, backlog, recent-banner "Log", not-logged-modal "Log session")
  // shares, so none of them can silently diverge from the others (a missed
  // meso adjustment, or progression math that drifts out of sync).
  const buildSessionEntries = async (items, dayId) => {
    // Seeds/progression consume the recent history synchronously — when an
    // exercise's last sessions are outside the boot window, fetch them from
    // the server first (fetchSeedEntries resolves instantly when the local
    // window suffices, and never rejects — offline falls back to local data).
    const seedRefs = await LB.fetchSeedEntries(store, items, dayId, userId);
    // Resolve meso state once (it internally reads localStorage) instead of
    // once per item below.
    const resolvedMeso = (typeof getMesoState === 'function') ? getMesoState(sch?.id, store.mesoStates) : null;
    const mesoBoosts = resolvedMeso?.weightBoosts ?? null;
    return (items || []).map(it => {
      const ex = LB.findExercise(store, it.exId);
      if (ex?.movement_type === 'cardio') {
        return { exId: it.exId, name: ex.name, isCardio: true, plannedSets: 0, plannedReps: null, plannedRepsPerSet: null, sets: [], cardioDone: false, cardioData: null, note: '', supersetGroup: it.supersetGroup || null };
      }
      const last = seedRefs[it.exId] ?? LB.bestRecentEntry(store, it.exId, dayId);
      const isUnilateral = ex?.unilateral || false;
      const suggestion = LB.progressionSuggestion(store, it.exId, dayId, it.reps, it.repsPerSet || null, seedRefs[it.exId], it.repsMax || null, it.progressionOffset ?? null);
      const bodyweightKg = ex?.equipment === 'bodyweight' ? LB.latestBodyweight(store) : null;
      const itAdj = (typeof applyMesoSetDeltaFromState === 'function') ? applyMesoSetDeltaFromState(it, dayId, resolvedMeso) : it;
      const weightBoost = mesoBoosts?.[it.exId + '_' + dayId] ?? null;
      let suggestionFinal = suggestion;
      if (weightBoost != null && !suggestionFinal && last) {
        const refSet = (last?.entry?.sets || []).filter(s => !s.warmup && !s.skipped).find(s => s.kg != null);
        if (refSet) suggestionFinal = { kg: Math.round((refSet.kg + weightBoost) * 4) / 4, reps: refSet.reps ?? null };
      }
      const seedSets = LB.buildSeedSets(itAdj, last, suggestionFinal, isUnilateral, store, bodyweightKg);
      return {
        exId: it.exId, name: ex?.name || '?',
        plannedSets: itAdj.sets, plannedReps: it.reps, plannedRepsPerSet: it.repsPerSet || null,
        plannedRepsMax: it.repsMax || null,
        plannedProgressionOffset: it.progressionOffset ?? null,
        sets: seedSets, note: '',
        supersetGroup: it.supersetGroup || null,
      };
    });
  };

  const startSession = async () => {
    if (!activeDay || isActiveRest) return;
    // buildSessionEntries awaits a seed fetch — guard against a double tap
    // creating two sessions inside that window (same as the backlog/bonus starts).
    if (loggingRef.current) return;
    loggingRef.current = true;
    const entries = await buildSessionEntries(activeDay.items, activeDay.id);
    const cyclePos = weekdayMode ? null :
      cycleWeekView
        ? (week.find(d => d.weekday === selectedWd)?.daysFromStart ?? null)
        : (currentCycleNum + weekOffset) * dayCount + selectedSlot;
    const firstEx = LB.findExercise(store, activeDay.items[0]?.exId);
    // Flex sessions are always logged "now" — the selected slot is just a
    // rotation position, never a calendar date (catch-ups date to today too).
    const sessionDateISO = isFlex ? LB.todayISO() : LB.fmtISO(sessionDate);
    loggingRef.current = false;
    // No warmup ramp for bodyweight (no meaningful load to ramp) or cardio
    // (not a weighted movement at all) — offering "3 sets · Treadmill" with
    // every preview weight blank made no sense.
    if (firstEx?.equipment === 'bodyweight' || firstEx?.movement_type === 'cardio') {
      const session = {
        id: LB.uid(), scheduleId: sch.id, dayId: activeDay.id, dayName: activeDay.name,
        date: sessionDateISO, startedAt: new Date().toISOString(), entries, currentExIdx: 0, cyclePos,
      };
      setStore(s => ({ ...s, sessions: [...s.sessions, session], inProgress: session.id }));
      go({ name: 'train', sessionId: session.id });
      return;
    }
    setWarmupPromptData({
      entries, cyclePos, firstWorkingKg: entries[0]?.sets[0]?.kg ?? null, firstName: entries[0]?.name || '?',
      scheduleId: sch.id, dayId: activeDay.id, dayName: activeDay.name, dateISO: sessionDateISO,
    });
  };

  // Flex: skip the current next-up day — advance the rotation by one without
  // logging anything (no dated skip row; flex has no calendar to mark).
  const flexSkip = () => {
    if (!dayCount) return;
    setStore(s => ({ ...s, cycleIndex: (s.cycleIndex || 0) + 1, lastAdvancedDate: LB.todayISO() }));
    setSelectedSlot((((dayIdx + 1) % dayCount) + dayCount) % dayCount);
  };

  // Shared by every session-start path: the ones with a weighted first
  // exercise route through here (via setWarmupPromptData) instead of each
  // reimplementing the warmup ramp — previously bonus/backlog/catch-up
  // session starts each skipped this prompt entirely, so those sessions
  // never got the 30/60/100% warmup ramp a normal session gets.
  const confirmStart = (withWarmup) => {
    const { entries: rawEntries, cyclePos, firstWorkingKg, scheduleId, dayId, dayName, dateISO, extra, autoSkipId } = warmupPromptData;
    setWarmupPromptData(null);
    let entries = rawEntries;
    let startedAt = new Date().toISOString();
    if (withWarmup) {
      const ft10 = kg => Math.round(kg / 10) * 10;
      const wKg = firstWorkingKg;
      const warmupSets = [
        { kg: wKg != null ? (ft10(wKg * 0.30) || null) : null, reps: 12, done: false, warmup: true, warmupPct: 30 },
        { kg: wKg != null ? (ft10(wKg * 0.60) || null) : null, reps: 8,  done: false, warmup: true, warmupPct: 60 },
        { kg: wKg != null ? wKg : null,                          reps: 4,  done: false, warmup: true, warmupPct: 100 },
      ];
      entries = entries.map((e, i) => i === 0 ? { ...e, sets: [...warmupSets, ...e.sets] } : e);
      startedAt = null; // timer starts when last warmup set is completed
    }
    const session = {
      id: LB.uid(), scheduleId, dayId, dayName,
      date: dateISO, startedAt, ended: null, entries, currentExIdx: 0,
      cyclePos, ...(extra || {}),
    };
    setStore(s => ({
      ...s,
      sessions: [...s.sessions, session],
      inProgress: session.id,
      ...(autoSkipId ? { skips: (s.skips || []).filter(x => x.id !== autoSkipId) } : {}),
    }));
    go({ name: 'train', sessionId: session.id });
  };

  const onTouchStart = (e) => {
    if (quickActionsOpen) return;
    swipeRef.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
  };
  const onTouchMove = (e) => {
    const start = swipeRef.current;
    if (!start.y) return;
    const dy = e.touches[0].clientY - start.y;
    const dx = Math.abs(e.touches[0].clientX - start.x);
    if (dy > 0 && dy > dx * 0.5) setPullDelta(dy);
    else setPullDelta(0);
  };
  const onTouchEnd = (e) => {
    const start = swipeRef.current;
    if (!start.y) return;
    const dy = e.changedTouches[0].clientY - start.y;
    const dx = Math.abs(e.changedTouches[0].clientX - start.x);
    swipeRef.current = { y: null, x: null };
    setPullDelta(0);
    if (dy > 65 && dy > dx * 1.5) setQuickActionsOpen(true);
  };
  const onTouchCancel = () => { swipeRef.current = { y: null, x: null }; setPullDelta(0); };
  // Pointer-event equivalents for mouse/trackpad (desktop + iPad with Magic Keyboard).
  // Skip touch pointers — those are already handled by the Touch events above.
  const onPointerDownPull = (e) => {
    if (e.pointerType === 'touch' || quickActionsOpen) return;
    swipeRef.current = { y: e.clientY, x: e.clientX };
  };
  const onPointerMovePull = (e) => {
    if (e.pointerType === 'touch' || !e.buttons) return;
    const start = swipeRef.current;
    if (!start.y) return;
    const dy = e.clientY - start.y;
    const dx = Math.abs(e.clientX - start.x);
    if (dy > 0 && dy > dx * 0.5) setPullDelta(dy);
    else setPullDelta(0);
  };
  const onPointerUpPull = (e) => {
    if (e.pointerType === 'touch') return;
    const start = swipeRef.current;
    if (!start.y) return;
    const dy = e.clientY - start.y;
    const dx = Math.abs(e.clientX - start.x);
    swipeRef.current = { y: null, x: null };
    setPullDelta(0);
    if (dy > 65 && dy > dx * 1.5) setQuickActionsOpen(true);
  };
  const onPointerCancelPull = (e) => {
    if (e.pointerType === 'touch') return;
    swipeRef.current = { y: null, x: null };
    setPullDelta(0);
  };

  const handleSetStatus = async (mode, startDateStr = null) => {
    const current = store.statusMode ?? null;
    const coachingId = store.coaching?.asClient?.id || store.coaching?.asSelf?.id || null;
    const startedAt = startDateStr
      ? new Date(startDateStr + 'T12:00:00').toISOString()
      : new Date().toISOString();
    const closedAt = mode === null
      ? (() => { const d = new Date((startDateStr || LB.todayISO()) + 'T12:00:00'); d.setDate(d.getDate() - 1); return d.toISOString(); })()
      : startedAt;
    const openPeriod = mode === null ? (store.statusPeriods || []).find(p => !p.endedAt) : null;
    const shouldDelete = !!openPeriod && closedAt < openPeriod.startedAt;
    const modeChanged = mode !== current;
    if (!modeChanged && !startDateStr) return;
    const since = mode ? startedAt : null;
    setStore(s => {
      const updatedPeriods = mode
        ? modeChanged
          ? [{ id: '_pending', mode, startedAt, endedAt: null }, ...(s.statusPeriods || []).map(p => p.endedAt ? p : { ...p, endedAt: new Date().toISOString() })]
          : (s.statusPeriods || []).map(p => !p.endedAt ? { ...p, startedAt } : p)
        : shouldDelete
          ? (s.statusPeriods || []).filter(p => !!p.endedAt)
          : (s.statusPeriods || []).map(p => !p.endedAt ? { ...p, endedAt: closedAt } : p);
      return { ...s, statusMode: mode, statusModeSince: since, statusPeriods: updatedPeriods };
    });
    try {
      if (modeChanged) {
        if (mode) await LB.openStatusPeriod(userId, mode, startedAt);
        else if (shouldDelete) { const r = await LB.supabase.from('zane_status_periods').delete().eq('user_id', userId).is('ended_at', null); if (r.error) throw r.error; }
        else      await LB.closeStatusPeriod(userId, closedAt);
      } else {
        await LB.updateStatusPeriodStart(userId, startedAt);
      }
    } catch (e) { console.error('status period write failed', e); }
    if (coachingId && modeChanged) {
      try {
        const body = mode === 'sick'     ? 'Status: Sick — taking a break from training.'
                   : mode === 'vacation' ? 'Status: Vacation — back soon!'
                   : `Status: Back to normal (was ${current === 'sick' ? 'sick' : 'on vacation'}).`;
        const threadId = await LB.getOrCreateCoachingThread(coachingId, 'Status Updates', userId);
        await LB.addCoachingNote(coachingId, 'general', null, null, body, userId, threadId);
      } catch (_) {}
    }
  };

  const startFreestyleSession = () => {
    setWorkoutSubOpen(false);
    setFreestyleSubOpen(false);
    setQuickActionsOpen(false);
    const session = {
      id: LB.uid(), scheduleId: null, dayId: null, dayName: 'Freestyle',
      date: LB.todayISO(), startedAt: new Date().toISOString(),
      ended: null, entries: [], currentExIdx: 0, cyclePos: null, isFreestyle: true, isBonus: true,
    };
    setStore(s => ({ ...s, sessions: [...s.sessions, session], inProgress: session.id }));
    go({ name: 'train', sessionId: session.id });
  };

  const startFreestyleFromTemplate = async (template) => {
    if (loggingRef.current) return;
    loggingRef.current = true;
    setWorkoutSubOpen(false);
    setFreestyleSubOpen(false);
    setQuickActionsOpen(false);
    const items = (template.exercises || []).filter(it => LB.findExercise(store, it.exId));
    const seedRefs = await LB.fetchSeedEntries(store, items, null, userId);
    const entries = items.map(it => {
      const ex = LB.findExercise(store, it.exId);
      if (ex?.movement_type === 'cardio') {
        return { exId: it.exId, name: ex.name, isCardio: true, plannedSets: 0, plannedReps: null, plannedRepsPerSet: null, sets: [], cardioDone: false, cardioData: null, note: '', supersetGroup: it.supersetGroup || null };
      }
      const last = seedRefs[it.exId] ?? LB.bestRecentEntry(store, it.exId, null);
      const isUni = ex?.unilateral || false;
      const suggestion = LB.progressionSuggestion(store, it.exId, null, it.reps, it.repsPerSet, seedRefs[it.exId], it.repsMax || null, it.progressionOffset ?? null);
      const bodyweightKg = ex?.equipment === 'bodyweight' ? LB.latestBodyweight(store) : null;
      const seedSets = LB.buildSeedSets(it, last, suggestion, isUni, store, bodyweightKg);
      return { exId: it.exId, name: ex?.name || '?', plannedSets: it.sets, plannedReps: it.reps, plannedRepsPerSet: it.repsPerSet || null, plannedRepsMax: it.repsMax || null, plannedProgressionOffset: it.progressionOffset ?? null, sets: seedSets, note: '', supersetGroup: it.supersetGroup || null };
    });
    const session = {
      id: LB.uid(), scheduleId: null, dayId: null, dayName: 'Freestyle',
      date: LB.todayISO(), startedAt: new Date().toISOString(),
      ended: null, entries, currentExIdx: 0, cyclePos: null, isFreestyle: true, isBonus: true,
    };
    setStore(s => ({ ...s, sessions: [...s.sessions, session], inProgress: session.id }));
    loggingRef.current = false;
    go({ name: 'train', sessionId: session.id });
  };

  const startBonusSession = async (day) => {
    if (loggingRef.current) return;
    loggingRef.current = true;
    setBonusDayPickerOpen(false);
    setWorkoutSubOpen(false);
    setQuickActionsOpen(false);
    const entries = await buildSessionEntries(day.items, day.id);
    // Treat as normal (cycle advances) only when this is today's scheduled day
    // AND it hasn't been trained yet today. If already done, it's always bonus.
    const todayStr = LB.todayISO();
    const isTodaysDay = LB.todaysDay(store)?.day?.id === day.id;
    const alreadyDoneToday = isTodaysDay && store.sessions.some(
      s => s.ended && s.dayId === day.id && s.date?.slice(0, 10) === todayStr
    );
    const extra = (!isTodaysDay || alreadyDoneToday) ? { isBonus: true } : {};
    const firstEx = LB.findExercise(store, day.items?.[0]?.exId);
    loggingRef.current = false;
    if (firstEx?.equipment === 'bodyweight' || firstEx?.movement_type === 'cardio') {
      const session = {
        id: LB.uid(), scheduleId: sch?.id, dayId: day.id, dayName: day.name,
        date: LB.todayISO(), startedAt: new Date().toISOString(),
        ended: null, entries, currentExIdx: 0, cyclePos: null, ...extra,
      };
      setStore(s => ({ ...s, sessions: [...s.sessions, session], inProgress: session.id }));
      go({ name: 'train', sessionId: session.id });
      return;
    }
    setWarmupPromptData({
      entries, cyclePos: null, firstWorkingKg: entries[0]?.sets[0]?.kg ?? null, firstName: entries[0]?.name || '?',
      scheduleId: sch?.id, dayId: day.id, dayName: day.name, dateISO: LB.todayISO(), extra,
    });
  };

  const startBacklogSession = async (missed) => {
    if (loggingRef.current) return;
    loggingRef.current = true;
    setQuickActionsOpen(false);
    setBacklogPickerOpen(false);
    const { dayData, dayId, dayName, date } = missed;
    const entries = await buildSessionEntries(dayData?.items, dayId);
    const autoSkip = skipsMap.get(missed.dateKey);
    const autoSkipId = autoSkip?.skipReason === '—' ? autoSkip.id : null;
    const firstEx = LB.findExercise(store, dayData?.items?.[0]?.exId);
    loggingRef.current = false;
    if (firstEx?.equipment === 'bodyweight' || firstEx?.movement_type === 'cardio') {
      const session = { id: LB.uid(), scheduleId: sch?.id, dayId, dayName, date: LB.fmtISO(date), startedAt: new Date().toISOString(), ended: null, entries, currentExIdx: 0, cyclePos: null };
      setStore(s => ({
        ...s,
        sessions: [...s.sessions, session],
        inProgress: session.id,
        ...(autoSkipId ? { skips: (s.skips || []).filter(x => x.id !== autoSkipId) } : {}),
      }));
      go({ name: 'train', sessionId: session.id });
      return;
    }
    setWarmupPromptData({
      entries, cyclePos: null, firstWorkingKg: entries[0]?.sets[0]?.kg ?? null, firstName: entries[0]?.name || '?',
      scheduleId: sch?.id, dayId, dayName, dateISO: LB.fmtISO(date), autoSkipId,
    });
  };


  const cardioBanner = selectedDayCardioLogs.length > 0 ? (() => {
    const du = LB.cardioDistUnit();
    const totalMins = selectedDayCardioLogs.reduce((s, l) => s + (l.durationMinutes || 0), 0);
    const single = selectedDayCardioLogs.length === 1 ? selectedDayCardioLogs[0] : null;
    const typeLabel = (() => {
      const unique = [...new Set(selectedDayCardioLogs.map(l => l.type || 'Activity'))];
      if (unique.length <= 2) return unique.join(', ');
      return `${unique[0]}, ${unique[1]} +${unique.length - 2}`;
    })();
    return (
      <Frame onClick={() => setCardioPopoverOpen(true)} style={{ marginTop: 8, padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, width: '100%', boxSizing: 'border-box', textAlign: 'left' }}>
        <i className="fa-solid fa-person-running" style={{ fontSize: 11, color: UI.inkFaint, flexShrink: 0, width: 12 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 2 }}>CARDIO</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{typeLabel}</span>
            <span className="num" style={{ fontSize: 12, color: UI.gold, flexShrink: 0 }}>
              {totalMins}<span style={{ fontSize: 9, color: UI.inkFaint }}>{selectedDayCardioLogs.length > 1 ? 'min total' : 'min'}</span>
            </span>
            {single?.distanceM != null && (
              <span className="num" style={{ fontSize: 11, color: UI.inkSoft, flexShrink: 0 }}>{LB.mToDisplay(single.distanceM, du)}<span style={{ fontSize: 8 }}>{du}</span></span>
            )}
            {single?.effort != null && (
              <span className="num" style={{ fontSize: 11, color: UI.inkFaint, flexShrink: 0 }}>{single.effort}/10</span>
            )}
          </div>
        </div>
        <ChevronRight />
      </Frame>
    );
  })() : null;

  return (
    <Screen scroll={false} style={{ position: 'relative' }}>
      <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchCancel} onPointerDown={onPointerDownPull} onPointerMove={onPointerMovePull} onPointerUp={onPointerUpPull} onPointerCancel={onPointerCancelPull} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Background watermark — VIP image from store.settings.vipBackground or default ZANE logo */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <img src={trainBg} style={isCustomBg
          ? { width: '92%', maxWidth: 360, opacity: 0.16, objectFit: 'contain' }
          : defaultLogoStyle} />
      </div>

      {/* No-plan fallback — rendered inline so all sheets below stay mounted */}
      {!sch && (
        <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <TopBar
            title={<span>HEY, <span style={{ color: UI.gold }}>{(store.user.name || '').toUpperCase()}</span></span>}
            sub={new Date().toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long' })}
            right={<button onClick={() => go({ name: 'settings' })} style={{ background: 'transparent', border: `1px solid ${UI.hairStrong}`, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', color: UI.inkSoft, width: 36, height: 36, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>}
          />
          <PullHintChevron pullDelta={pullDelta} onOpen={() => setQuickActionsOpen(true)} />
          <div style={{ padding: 22 }}>
            {hasPlans
              ? <Empty title="No active plan" sub="You have plans ready — just pick one to activate." action={<Btn onClick={() => go({ name: 'plan' })}>View plans</Btn>} icon={ICON_CALENDAR} />
              : <Empty title="No plan yet" sub="Create a training plan to get started." action={<Btn onClick={() => go({ name: 'schedule-new' })}>Create plan</Btn>} icon={ICON_CALENDAR} />}
          </div>
        </div>
      )}

      {/* Plan content — header + body, only when a plan is active */}
      {sch && <>
      <div style={{
        flexShrink: 0,
        padding: `calc(env(safe-area-inset-top, 0px) + 12px) 22px 0`,
        position: 'sticky', top: 0, zIndex: 5,
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        background: 'rgba(var(--bg-rgb),0.92)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: UI.fontDisplay, fontSize: 34, fontWeight: 900, letterSpacing: '0.10em', color: UI.gold, lineHeight: 1 }}>ZANE</span>
            {(() => {
              const isProblem = storageFull || syncStatus === 'error';
              const isSaving  = syncStatus === 'pending' && !storageFull;
              const color = isProblem ? UI.danger : isSaving ? UI.warn : UI.ok;
              const pulse = isProblem ? 'pulseDot 1.4s ease-in-out infinite' : 'none';
              return (
                <i
                  className="fa-solid fa-dumbbell"
                  onClick={isProblem ? onRetrySync : undefined}
                  title={isProblem ? 'Not synced — tap to retry' : isSaving ? 'Saving…' : 'Connected'}
                  style={{ fontSize: 18, color, animation: pulse, cursor: isProblem ? 'pointer' : 'default' }}
                />
              );
            })()}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ textAlign: 'right', minWidth: 0 }}>
              <div className="micro" style={{ marginBottom: 3 }}>{new Date().toLocaleDateString('en-US', { weekday:'long', day:'2-digit', month:'long' }).toUpperCase()}</div>
              {(() => {
                const greetLen = ('HEY, ' + (store.user.name || '')).length;
                const fs = greetLen > 16 ? 14 : greetLen > 13 ? 17 : greetLen > 10 ? 20 : 22;
                return (
                  <div style={{ fontFamily: UI.fontDisplay, fontSize: fs, fontWeight: 900, letterSpacing: '0.06em', color: UI.ink, lineHeight: 1, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    HEY, <span style={{ color: UI.gold }}>{(store.user.name || '').toUpperCase()}</span>
                  </div>
                );
              })()}
            </div>
            <button onClick={() => go({ name: 'settings' })} style={{
              width: 34, height: 34, borderRadius: 4, flexShrink: 0,
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: UI.inkSoft,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="knurl" style={{ marginLeft: -22, marginRight: -22 }} />
      </div>

      {/* Pull-down indicator — right below plan header */}
      <PullHintChevron pullDelta={pullDelta} onOpen={() => setQuickActionsOpen(true)} />

      {/* In-progress banner */}
      {store.inProgress && (() => {
        const activeSession = store.sessions.find(s => s.id === store.inProgress);
        return activeSession ? (
          <div style={{
            flexShrink: 0,
            padding: '10px 16px',
            background: UI.goldFaint,
            borderBottom: `0.5px solid ${UI.goldSoft}`,
            display: 'flex', alignItems: 'center', gap: 10,
            position: 'relative', zIndex: 1,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: UI.gold, flexShrink: 0, animation: 'pulseDot 1.4s ease-in-out infinite' }} />
            <span style={{ flex: 1, fontSize: 13, color: UI.gold, fontFamily: UI.fontUi, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeSession.dayName}
            </span>
            <button onClick={async () => {
              // Capture the id before awaiting — a cross-device sync could swap
              // the in-progress session while the confirm dialog is open.
              const cancelId = store.inProgress;
              if (!await confirm('The session will be deleted.', { title: 'Cancel training?', ok: 'Cancel', cancel: 'Back', danger: true })) return;
              LB.cancelPushover(store.settings, userId);
              setStore(s => s.inProgress !== cancelId ? s : { ...s, sessions: s.sessions.filter(x => x.id !== cancelId), inProgress: null });
            }} style={{
              background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
              fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, padding: '4px 0',
              letterSpacing: '0.10em', textTransform: 'uppercase',
            }}>Cancel</button>
            <button onClick={() => go({ name: 'train', sessionId: store.inProgress })} style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 4,
              background: UI.gold, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, fontFamily: UI.fontUi, color: '#0a0805',
              letterSpacing: '0.08em',
            }}>Continue →</button>
          </div>
        ) : null;
      })()}

      <div style={{ flex: 1, minHeight: 0, padding: '16px 22px 0', display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', zIndex: 1 }}>

        {/* Period navigation — flex has no calendar weeks, just a static label */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          {!isFlex && (
            <button onClick={goBack} disabled={weekOffset <= minOffset} style={{
              width: 30, height: 30, borderRadius: 4,
              background: 'transparent',
              border: `1px solid ${weekOffset <= minOffset ? 'transparent' : UI.hairStrong}`,
              color: weekOffset <= minOffset ? UI.inkGhost : UI.inkSoft,
              cursor: weekOffset <= minOffset ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M6 1 1 6l5 5"/></svg>
            </button>
          )}
          <div style={{ flex: 1, textAlign: 'center' }}>
            {sch.mesocycle_weeks ? (() => {
              // A deload following the meso is a recovery week — show DELOAD, not
              // the (now-frozen, possibly beyond-failure) meso RIR target.
              if (isViewingToday && store.statusMode === 'deload') {
                return (
                  <span style={{ fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: UI.gold, background: 'rgba(var(--accent-rgb),0.1)', border: `0.5px solid rgba(var(--accent-rgb),0.4)`, borderRadius: 4, padding: '2px 8px' }}>
                    MESO · DELOAD
                  </span>
                );
              }
              const m = (typeof getMesoState === 'function') ? getMesoState(sch.id, store.mesoStates) : null;
              const weeks = sch.mesocycle_weeks;
              // completions = how many blocks finished, so the block currently
              // running is number completions+1. Shown from Meso 2 on.
              const mesoNum = (m?.completions ?? 0) + 1;
              const mesoLabel = `MESO${mesoNum > 1 ? ' ' + mesoNum : ''}`;
              const week = (m && typeof mesoCurrentWeek === 'function') ? mesoCurrentWeek(m, store) : null;
              if (week == null) {
                // Pending — meso hasn't started yet; show start date if known
                const startLabel = m?.startDate
                  ? (() => { const d = new Date(m.startDate + 'T12:00:00'); return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}`; })()
                  : 'D1';
                return (
                  <span style={{ fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: UI.inkFaint, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '2px 8px' }}>
                    {mesoLabel} · starts {startLabel}
                  </span>
                );
              }
              const rir = (typeof mesoRirForWeek === 'function') ? mesoRirForWeek(week, weeks, sch.mesocycle_start_rir ?? 3, sch.mesocycle_end_rir ?? 0) : null;
              if (rir == null) return null;
              const unit = weekdayMode ? 'W' : 'C';
              return (
                <span style={{ fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: UI.inkSoft, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, padding: '2px 8px' }}>
                  {mesoLabel} {unit}{week}/{weeks} · {rir} RIR
                </span>
              );
            })() : (
              <span style={{ fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', color: UI.inkSoft, textTransform: 'uppercase' }}>{periodLabel}</span>
            )}
          </div>
          {!isFlex && (
            <button onClick={goForward} disabled={weekOffset === 0} style={{
              width: 30, height: 30, borderRadius: 4,
              background: 'transparent',
              border: `1px solid ${weekOffset === 0 ? 'transparent' : UI.hairStrong}`,
              color: weekOffset === 0 ? UI.inkGhost : UI.inkSoft,
              cursor: weekOffset === 0 ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M2 1l5 5-5 5"/></svg>
            </button>
          )}
        </div>

        {/* day strip */}
        <div style={{ flexShrink: 0, display: 'flex', gap: 4 }}>
          {week.map((d, i) => {
            const clampedSlot = Math.min(selectedSlot, week.length - 1);
            const isSelected = (weekdayMode || cycleWeekView) ? i === selectedWd : i === clampedSlot;
            const r = !d.items?.length;
            const slotLabel = weekdayMode
              ? WEEKDAYS[i]
              : isFlex
                ? `D${(d.slotIdx ?? i) + 1}`
                : d.date.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' }).replace(/\.$/, '');
            let isCompleted = false;
            if (!r && isFlex) {
              // Earlier slots in the current rotation pass that have a session,
              // bounded to this pass by absolute rotation position (cyclePos) so a
              // previous rotation's session can't mark a skipped slot done.
              const slot = d.slotIdx ?? i;
              const rotStart = (store.cycleIndex || 0) - dayIdx;
              isCompleted = slot < dayIdx && (completedCyclePos?.has(rotStart + slot) ?? false);
            } else if (!r && !isFlex) {
              if (weekdayMode) {
                const slotKey = `${d.date.getFullYear()}-${d.date.getMonth()}-${d.date.getDate()}`;
                isCompleted = completedDateKeys?.has(slotKey) ?? false;
              } else {
                // daysFromStart is set for both cycleWeekView and versioned classic cycle view.
                const dfs = d.daysFromStart != null
                  ? d.daysFromStart
                  : store.cycleStartDate
                    ? Math.round((d.date - LB.parseDate(store.cycleStartDate)) / 86400000)
                    : (currentCycleNum + weekOffset) * dayCount + i;
                isCompleted = completedCyclePos?.has(dfs) ?? false;
              }
            }
            const dateKey = LB.fmtISO(d.date);
            // Flex slots carry no real calendar date, so none of the date-derived
            // markers (missed / skipped / status / completed) apply.
            const isPast = !isFlex && !d.isToday && d.date < new Date();
            const planStartStr = oldestVersionStart
              || (weekdayMode ? store.weekPlanStartDate : store.cycleStartDate);
            const isBeforePlanStart = planStartStr ? d.date < LB.parseDate(planStartStr) : false;
            const statusDayMode = isPast ? statusPeriodModeFor(d.date) : null;
            const isMissed = !r && isPast && !isCompleted && !skipsMap.has(dateKey) && !isBeforePlanStart && !statusDayMode;
            const isSkipped = !r && isPast && !isCompleted && skipsMap.has(dateKey);
            const isStatusDay = !r && isPast && !!statusDayMode && !isCompleted;
            return (
              <div key={d.id ?? i}
                onClick={() => (weekdayMode || cycleWeekView) ? setSelectedWd(i) : setSelectedSlot(i)}
                style={{
                  flex: 1, padding: '10px 4px 8px', textAlign: 'center',
                  background: isSelected ? UI.goldFaint : isCompleted ? UI.goldFaint : isMissed ? 'rgba(var(--danger-rgb),0.08)' : isStatusDay ? 'rgba(var(--accent-rgb),0.06)' : isSkipped ? 'var(--neutral-tint)' : 'transparent',
                  border: `${isSelected ? '2px' : '0.5px'} solid ${isSelected ? UI.gold : isCompleted ? UI.goldSoft : isMissed ? 'rgba(var(--danger-rgb),0.4)' : isStatusDay ? 'rgba(var(--accent-rgb),0.25)' : isSkipped ? 'var(--neutral-border-sm)' : d.isToday ? UI.hairStrong : UI.hair}`,
                  borderRadius: 4, cursor: 'pointer',
                  minHeight: 56,
                }}>
                <div className="num" style={{ fontSize: 9, color: isSelected ? UI.gold : d.isToday ? UI.inkSoft : UI.inkFaint }}>
                  {cycleWeekView && !weekdayMode ? (
                    <>
                      <div>{WEEKDAYS[d.weekday]}</div>
                      <div style={{ fontSize: 7, marginTop: 1, opacity: 0.75 }}>
                        {d.date.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' }).replace(/\.$/, '')}
                      </div>
                    </>
                  ) : slotLabel}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: r ? UI.inkFaint : isSelected ? UI.gold : isMissed ? UI.danger : isStatusDay ? 'var(--accent)' : isSkipped ? UI.inkFaint : UI.ink, letterSpacing: '0.06em' }}>
                  {r ? '—' : d.name.slice(0, 4)}
                </div>
                <div style={{ height: 12, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isCompleted && !isSelected && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.5" style={{ display: 'block' }}>
                      <path d="M2 6l2.5 2.5L10 3"/>
                    </svg>
                  )}
                  {isMissed && !isSelected && <div style={{ width: 4, height: 4, borderRadius: '50%', background: UI.danger }} />}
                  {isSkipped && !isSelected && <span style={{ fontSize: 8, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1 }}>—</span>}
                  {isStatusDay && !isSelected && <i className={`fa-solid ${statusDayMode === 'sick' ? 'fa-bed-pulse' : 'fa-umbrella-beach'}`} style={{ fontSize: 7, color: 'var(--accent)', opacity: 0.7 }} />}
                  {isSelected && <div style={{ width: 4, height: 4, borderRadius: '50%', background: UI.gold }} />}
                </div>
              </div>
            );
          })}
        </div>

        {/* cycle week view — indicator bar showing cycle boundaries */}
        {cycleBarSegments && (
          <div style={{ flexShrink: 0, display: 'flex', gap: 4, marginTop: -4 }}>
            {cycleBarSegments.map((seg, i) => {
              const selDay = week.find(d => d.weekday === selectedWd);
              const selCycleNum = selDay
                ? (sch?.versions?.length
                    ? LB.getCycleNumForDate(sch, LB.fmtISO(selDay.date))
                    : Math.floor(selDay.daysFromStart / dayCount) + 1)
                : null;
              const isActive = seg.cycleNum === selCycleNum;
              return (
                <div key={i} style={{
                  flex: seg.count, height: 16, borderRadius: 4,
                  background: isActive ? UI.goldFaint : 'rgba(var(--accent-rgb),0.06)',
                  border: `0.5px solid ${isActive ? UI.goldSoft : UI.hair}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {seg.count >= 2 && (
                    <span style={{ fontSize: 7, color: isActive ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.12em', fontWeight: 600 }}>
                      C{seg.cycleNum}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* day card — flex:1 so it fills */}
        {isActiveRest ? (
          <BracketFrame style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 28 }}>
            <div className="micro" style={{ marginBottom: 12 }}>{cardLabel}</div>
            <div style={{ fontFamily: UI.fontDisplay, fontSize: 56, fontWeight: 900, letterSpacing: '0.04em', textTransform: 'uppercase', color: UI.inkSoft, lineHeight: 0.9, marginBottom: 14 }}>
              {selectedDayStatusMode === 'sick' ? 'SICK.' : selectedDayStatusMode === 'vacation' ? 'AWAY.' : 'RECOVER.'}
            </div>
            <div style={{ fontSize: 13, color: UI.inkFaint, marginBottom: 22, maxWidth: 220 }}>
              {selectedDayStatusMode === 'sick' ? 'Rest up. Training can still be logged.' : selectedDayStatusMode === 'vacation' ? 'Enjoy it. Training can still be logged.' : 'Recovery is part of the plan.'}
            </div>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <Btn kind="ghost" onClick={() => go({ name: 'plan-view' })} style={{ flex: 1 }}>View plan</Btn>
              {isViewingToday && selectedDayStatusMode && (
                <Btn kind="ghost" onClick={handleClearStatus} style={{ flex: 1 }}>Back to normal</Btn>
              )}
            </div>
            {!cardioPlanPrefill && cardioBanner}
          </BracketFrame>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            {/* Fixed: label, name, stats, CTAs */}
            <div style={{ flexShrink: 0, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4 }}>
            <div className="micro-gold" style={{ marginBottom: selectedDayStatusMode ? 2 : 6 }}>{cardLabel}</div>
            {selectedDayStatusMode && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className="micro" style={{ color: UI.inkFaint }}>
                  {selectedDayStatusMode === 'sick' ? 'Sick mode active' : selectedDayStatusMode === 'deload' ? 'Deload mode active' : 'Vacation mode active'}
                </span>
                {isViewingToday && (
                  <button onClick={handleClearStatus} style={{
                    background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
                    borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                    fontFamily: UI.fontUi, fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
                    color: UI.inkFaint, WebkitTapHighlightColor: 'transparent',
                  }}>CLEAR</button>
                )}
              </div>
            )}
            <FitText
              text={(activeDay.name || '').toUpperCase()}
              max={72} min={28}
              style={{
                fontFamily: UI.fontDisplay, fontWeight: 900,
                letterSpacing: '0.04em',
                color: UI.gold, lineHeight: 0.9, marginBottom: 20,
                maxWidth: '100%',
              }}
            />

            {/* Stats */}
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 20, marginBottom: 18, width: '100%', justifyContent: 'center' }}>
              <SubDial size={80} label="EXERCISES" value={activeDay.items.length} />
              <div style={{ width: 1, background: UI.hairStrong, alignSelf: 'stretch' }} />
              <SubDial size={80} label="MIN" value={avgDayDuration != null ? `~${avgDayDuration}` : `~${Math.round(activeDay.items.reduce((a,b) => a + b.sets*2 + 3, 0))}`} />
              <div style={{ width: 1, background: UI.hairStrong, alignSelf: 'stretch' }} />
              <SubDial size={80} label="SETS" value={activeDay.items.reduce((a,b) => a + b.sets, 0)} />
            </div>

            {/* Exercise name strip */}
            {activeDay.items.length > 0 && (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', width: '100%', marginBottom: 16, scrollbarWidth: 'none' }}>
                {activeDay.items.map((it, i) => {
                  const ex = LB.findExercise(store, it.exId);
                  return (
                    <span key={i} style={{
                      flexShrink: 0, fontSize: 10, fontFamily: UI.fontUi, color: UI.inkFaint,
                      background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
                      borderRadius: 4, padding: '3px 7px', whiteSpace: 'nowrap',
                    }}>
                      {(ex?.name || '?').toUpperCase()}
                    </span>
                  );
                })}
              </div>
            )}

            {/* CTAs — above exercise list so the action is always immediately visible */}
            {isSlotDone ? (
              <Frame
                onClick={doneSession ? () => go({ name: 'session', sessionId: doneSession.id, back: { name: 'home' } }) : undefined}
                style={{ padding: '14px 18px', width: '100%', cursor: doneSession ? 'pointer' : 'default' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 4, background: UI.goldFaint, border: `1px solid ${UI.goldSoft}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={UI.gold} strokeWidth="1.5"><path d="M2 6l2.5 2.5L10 3"/></svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="micro-gold" style={{ marginBottom: 2 }}>WORKOUT COMPLETE</div>
                    <div style={{ fontSize: 13, color: UI.inkSoft, display: 'flex', alignItems: 'center', gap: 10 }}>
                      {doneSession?.ended && (() => {
                        const d = new Date(doneSession.ended);
                        const dd = d.getDate().toString().padStart(2,'0');
                        const mm = (d.getMonth()+1).toString().padStart(2,'0');
                        const hh = d.getHours().toString().padStart(2,'0');
                        const min = d.getMinutes().toString().padStart(2,'0');
                        return <span style={{ color: UI.inkFaint }} className="num">{dd}.{mm}.{d.getFullYear()} {hh}:{min}</span>;
                      })()}
                      {improvementCount === 0 && regressionCount === 0 ? null : (
                        <>
                          {improvementCount > 0 && (
                            <span style={{ color: 'var(--success-text)', fontWeight: 600 }}>↑ {improvementCount}</span>
                          )}
                          {regressionCount > 0 && (
                            <span style={{ color: UI.danger, fontWeight: 600 }}>↓ {regressionCount}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {doneSession && <ChevronRight />}
                </div>
              </Frame>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                {selectedDateSkip && (
                  <Frame style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 4, background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ color: UI.inkFaint, fontSize: 14, lineHeight: 1 }}>—</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="micro" style={{ marginBottom: 2, color: UI.inkFaint }}>ARCHIVED</div>
                        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi }}>
                          {selectedDateSkip.skipReason === '—' ? 'Not logged in time · delete to log' : selectedDateSkip.skipReason}
                        </div>
                      </div>
                      <button onClick={() => setSkipReasonModal({ mode: 'edit', skipId: selectedDateSkip.id, currentReason: selectedDateSkip.skipReason, data: { dateKey: LB.fmtISO(sessionDate), dayId: activeDay?.id, dayName: activeDay?.name } })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: UI.inkFaint, display: 'flex', alignItems: 'center' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button onClick={() => { setStore(s => ({ ...s, skips: (s.skips || []).filter(x => x.id !== selectedDateSkip.id) })); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', color: UI.danger, fontSize: 18, lineHeight: 1, fontFamily: UI.fontUi }}>×</button>
                    </div>
                  </Frame>
                )}
                {!selectedDateSkip && (isFlex && selectedSlot > dayIdx ? (
                  <div style={{ padding: '12px 16px', borderRadius: 6, border: `1px dashed ${UI.hairStrong}`, textAlign: 'center' }}>
                    <span className="micro" style={{ color: UI.inkFaint }}>UPCOMING · START THIS FROM THE NEXT-UP DAY</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
                    <button onClick={startSession} disabled={!!store.inProgress} style={{
                      opacity: store.inProgress ? 0.35 : 1,
                      flex: 1, minHeight: 48, borderRadius: 6, border: '1px solid rgba(var(--accent-rgb),0.6)', cursor: 'pointer',
                      background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
                      boxShadow: '0 8px 28px rgba(var(--accent-rgb),0.35)',
                      animation: 'pulseGold 3.5s ease-out infinite',
                      display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                      WebkitTapHighlightColor: 'transparent',
                    }}>
                      <i className="fa-solid fa-dumbbell" style={{ fontSize: 13, color: 'rgba(10,8,5,0.55)' }} />
                      <span style={{ color: 'rgba(10,8,5,0.75)', letterSpacing: '0.18em', fontWeight: 700, fontSize: 13, fontFamily: UI.fontUi }}>
                        {isFlex && !isViewingToday ? 'CATCH UP' : (isFlex || isViewingToday || isFutureSlot ? 'START WORKOUT' : 'LOG SESSION')}
                      </span>
                    </button>
                    {isViewingToday && (
                      <button onClick={isFlex ? flexSkip : () => setSkipReasonModal({ mode: 'skip', data: { dateKey: LB.fmtISO(sessionDate), dayId: activeDay?.id, dayName: activeDay?.name } })} style={{
                        flexShrink: 0, width: 80, minHeight: 48, borderRadius: 6, cursor: 'pointer',
                        background: 'transparent',
                        border: `1px solid ${UI.hairStrong}`,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                        WebkitTapHighlightColor: 'transparent',
                      }}>
                        <span style={{ fontSize: 16, color: UI.inkSoft, fontFamily: UI.fontDisplay, fontWeight: 700, lineHeight: 1 }}>→</span>
                        <span className="micro" style={{ color: UI.inkFaint }}>SKIP</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!cardioPlanPrefill && cardioBanner}

            </div>{/* end fixed header */}

          </div>
        )}
      </div>


      {/* Last session + not-logged strip */}
      {(lastSession || (recentBannerDay && !store.inProgress && !store.statusMode)) && (
        <div style={{ flexShrink: 0, padding: '10px 22px' }}>
          {lastSession && recentBannerDay && !store.inProgress && !store.statusMode ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Frame onClick={() => go({ name: 'session', sessionId: lastSession.id, back: { name: 'home' } })} style={{ flex: 1, minWidth: 0, padding: '10px 12px', cursor: 'pointer' }}>
                <div className="micro" style={{ marginBottom: 3 }}>LAST SESSION</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span className="display" style={{ fontSize: 15, color: UI.ink, lineHeight: 1 }}>{lastSession.dayName}</span>
                  <span className="num" style={{ color: UI.gold, fontSize: 10 }}>{Math.round(LB.totalVolume(lastSession)).toLocaleString('en-US')}<span style={{ color: UI.inkFaint }}>{UI.unit()}</span></span>
                </div>
              </Frame>
              <Frame onClick={() => setNotLoggedModalOpen(true)} style={{ flex: 1, minWidth: 0, padding: '10px 12px', background: 'rgba(var(--danger-rgb),0.15)', border: '0.5px solid rgba(var(--danger-rgb),0.40)', cursor: 'pointer' }}>
                <div className="micro" style={{ color: UI.danger, marginBottom: 2 }}>
                  {recentBannerDay.dayName} · {recentBannerDay.daysAgo === 1 ? 'YESTERDAY' : `${recentBannerDay.daysAgo}D AGO`}
                </div>
                <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>Not logged</div>
              </Frame>
            </div>
          ) : lastSession ? (
            <LastSessionStrip session={lastSession} onClick={() => go({ name: 'session', sessionId: lastSession.id, back: { name: 'home' } })} exercises={store.exercises} />
          ) : (
            <RecentBannerDay banner={recentBannerDay} store={store} setStore={setStore} go={go} sch={sch} userId={userId} onOpenSkipSheet={setSkipReasonModal} onLog={startBacklogSession} />
          )}
        </div>
      )}

      {/* Cardio plan widget — targets for the selected day in the strip */}
      {window.Screens?.TodayCardioWidget && (
        <window.Screens.TodayCardioWidget
          store={store}
          setStore={setStore}
          todayISO={LB.fmtISO(sessionDate)}
          userId={userId}
          onPR={setCardioPR}
        />
      )}


      {/* Cardio history popover */}
      {cardioPopoverOpen && (() => {
        const recentCardio = (store.cardioLogs || []).slice(0, 5);
        const du = LB.cardioDistUnit();
        return (
          <Sheet open={true} onClose={() => setCardioPopoverOpen(false)}>
            <div style={{ fontFamily: UI.fontUi, fontSize: 15, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: UI.inkSoft, textAlign: 'center', marginBottom: recentCardio.length ? 16 : 10 }}>RECENT CARDIO</div>
            {recentCardio.length === 0 ? (
              <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, textAlign: 'center', marginBottom: 20 }}>No cardio logged yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                {recentCardio.map(l => (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}` }}>
                    <i className="fa-solid fa-person-running" style={{ fontSize: 11, color: UI.inkFaint, width: 12 }} />
                    <span style={{ flex: 1, fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.type || '—'}</span>
                    <span className="num" style={{ fontSize: 12, color: UI.gold, flexShrink: 0 }}>{l.durationMinutes}<span style={{ color: UI.inkFaint, fontSize: 9 }}>min</span></span>
                    {l.distanceM != null && <span className="num" style={{ fontSize: 11, color: UI.inkSoft, flexShrink: 0 }}>{LB.mToDisplay(l.distanceM, du)}<span style={{ fontSize: 8 }}>{du}</span></span>}
                    <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, flexShrink: 0 }}>{l.date.slice(5).replace('-', '/')}</span>
                    <button onClick={() => { setEditingCardioLog(l); setCardioPopoverOpen(false); setCardioLogOpen(true); }} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: UI.inkFaint, display: 'flex', alignItems: 'center' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button onClick={async () => {
                      if (!await confirm('Delete this cardio log?', { ok: 'Delete', danger: true })) return;
                      setStore(s => ({ ...s, cardioLogs: (s.cardioLogs||[]).filter(x => x.id !== l.id) }));
                    }} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 2px', color: UI.danger, fontSize: 16, lineHeight: 1, fontFamily: UI.fontUi }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Btn onClick={() => { setCardioPopoverOpen(false); setCardioLiveOpen(true); }} style={{ width: '100%' }}>
                <i className="fa-solid fa-stopwatch" style={{ marginRight: 8, fontSize: 12 }} />Start live
              </Btn>
              <Btn kind="ghost" onClick={() => { setCardioPopoverOpen(false); setCardioLogOpen(true); }} style={{ width: '100%' }}>Log manually</Btn>
            </div>
          </Sheet>
        );
      })()}

      <CardioLiveSheet
        open={cardioLiveOpen}
        onFinish={(min) => { setCardioLiveOpen(false); setCardioFinishDuration(min); setCardioFinishOpen(true); }}
        onCancel={() => setCardioLiveOpen(false)}
      />

      <CardioFinishFlow open={cardioFinishOpen} durationMin={cardioFinishDuration} store={store} setStore={setStore} onClose={() => setCardioFinishOpen(false)} onPR={setCardioPR} />

      <CardioQuickLogSheet open={cardioLogOpen} onClose={() => { setCardioLogOpen(false); setEditingCardioLog(null); }} store={store} setStore={setStore} userId={userId} editLog={editingCardioLog} onPR={setCardioPR} prefill={editingCardioLog ? null : cardioPlanPrefill} logDate={LB.fmtISO(sessionDate)} />
      <CardioPROverlay pr={cardioPR} onDone={() => setCardioPR(null)} />

      {/* Coach message banner */}
      <window.Screens.CoachingBannerGroup store={store} setStore={setStore} userId={userId} go={go} />

      <SkipReasonSheet
        modal={skipReasonModal}
        onClose={() => setSkipReasonModal(null)}
        setStore={setStore}
        userId={userId}
      />
      {notLoggedModalOpen && recentBannerDay && (
        <Sheet open={true} onClose={() => setNotLoggedModalOpen(false)}>
          <div className="micro" style={{ color: UI.danger, textAlign: 'center', marginBottom: 4 }}>
            {recentBannerDay.dayName} · {recentBannerDay.daysAgo === 1 ? 'YESTERDAY' : `${recentBannerDay.daysAgo}D AGO`}
          </div>
          <div style={{ fontSize: 18, fontFamily: UI.fontDisplay, fontWeight: 700, textTransform: 'uppercase', textAlign: 'center', color: UI.ink, marginBottom: 20 }}>Not logged</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Btn onClick={() => { setNotLoggedModalOpen(false); startBacklogSession(recentBannerDay); }}>Log session</Btn>
            <Btn kind="ghost" onClick={() => {
              setNotLoggedModalOpen(false);
              setSkipReasonModal({ mode: 'dismiss', data: { dateKey: recentBannerDay.dateKey, dayId: recentBannerDay.dayId, dayName: recentBannerDay.dayName } });
            }}>Dismiss</Btn>
          </div>
        </Sheet>
      )}
      {warmupPromptData && (() => {
        const { firstWorkingKg, firstName } = warmupPromptData;
        const ft10 = kg => Math.round(kg / 10) * 10;
        const preview = [
          { pct: 30, kg: firstWorkingKg != null ? (ft10(firstWorkingKg * 0.30) || null) : null, reps: 12 },
          { pct: 60, kg: firstWorkingKg != null ? (ft10(firstWorkingKg * 0.60) || null) : null, reps: 8 },
          { pct: 100, kg: firstWorkingKg, reps: 4 },
        ];
        return (
          <Sheet open={true} onClose={() => setWarmupPromptData(null)} title="Warmup?">
            <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.7, marginBottom: 14 }}>
              3 sets · <span style={{ color: UI.inkSoft }}>{firstName}</span> · timer starts after last warmup set
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22 }}>
              {preview.map(({ pct, kg, reps }) => (
                <div key={pct} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 14px', background: UI.bgInset, borderRadius: 4, border: `1px solid ${UI.hairStrong}` }}>
                  <span className="micro" style={{ color: UI.inkFaint }}>{pct}%</span>
                  <span className="num" style={{ fontSize: 14, color: kg != null ? UI.inkSoft : UI.inkFaint }}>
                    {kg != null ? `${kg}${UI.unit()}` : '—'} · {reps}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn kind="ghost" onClick={() => confirmStart(false)} style={{ flex: 1, fontSize: 12 }}>Skip</Btn>
              <Btn onClick={() => confirmStart(true)} style={{ flex: 2, fontSize: 12 }}>Start with warmup</Btn>
            </div>
          </Sheet>
        );
      })()}
      {confirmEl}
      </>}{/* end {sch && ...} plan content */}

      {/* Quick actions sheet — triggered by swipe-down */}
      <Sheet open={quickActionsOpen} onClose={() => setQuickActionsOpen(false)} title="Quick actions" titleColor="var(--accent)">
        {(() => {
          const actionBtn = (onClick, icon, label, sub) => (
            <button onClick={onClick} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
              borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              marginBottom: 8,
            }}>
              <i className={`fa-solid ${icon}`} style={{ fontSize: 20, color: 'var(--accent)', width: 22, textAlign: 'center', flexShrink: 0 }} />
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: UI.fontUi }}>{label}</div>
                <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 2, fontFamily: UI.fontUi }}>{sub}</div>
              </div>
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l5 5-5 5"/></svg>
            </button>
          );
          const asClient = store.coaching?.asClient;
          const asSelf = store.coaching?.asSelf;
          return (
            <div>
              {actionBtn(() => { setQuickActionsOpen(false); setDailyLogOpen(true); }, 'fa-calendar-day', 'Daily Log', 'Weight, macros, water & steps')}
              {actionBtn(() => { setQuickActionsOpen(false); setWorkoutSubOpen(true); }, 'fa-dumbbell', 'Workout', sch ? 'From plan or freestyle' : 'Open training — add exercises on the fly')}
              {allMissedDays.length > 0 && actionBtn(
                () => {
                  setQuickActionsOpen(false);
                  if (allMissedDays.length === 1) { startBacklogSession(allMissedDays[0]); }
                  else setBacklogPickerOpen(true);
                },
                'fa-clock-rotate-left',
                'Backlog Session',
                allMissedDays.length === 1
                  ? `Log ${allMissedDays[0].dayName} (${LB.dayLabel(allMissedDays[0].daysAgo)})`
                  : `${allMissedDays.length} unlogged sessions`,
              )}
              {actionBtn(() => { setQuickActionsOpen(false); setCardioPopoverOpen(true); }, 'fa-person-running', 'Cardio', 'Start live or log manually')}
              {checkinDue && (asClient?.status === 'active' || asSelf) && actionBtn(
                () => {
                  setQuickActionsOpen(false);
                  const bothActive = asClient?.status === 'active' && asSelf;
                  if (bothActive) { setCheckinPickerOpen(true); return; }
                  if (asSelf) {
                    go({ name: 'coaching-client', coachingId: asSelf.id, clientId: userId, clientName: store.user.name, initialTab: 'checkins', isSelf: true, backRoute: 'home' });
                  } else {
                    go({ name: 'coaching', initialClientTab: 'checkin' });
                  }
                },
                'fa-clipboard-check',
                'Check-in',
                'This week\'s check-in is due',
              )}
              {asClient?.status === 'active' && actionBtn(
                () => {
                  setQuickActionsOpen(false);
                  go({ name: 'coaching', initialClientTab: 'messages' });
                },
                'fa-message',
                'Message Coach',
                'Send a note to your coach',
              )}
              <button onClick={async () => {
                setQuickActionsOpen(false);
                await LB.clearCachesAndReload();
              }} style={{
                width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
                borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="fa-solid fa-arrows-rotate" style={{ fontSize: 16, color: 'var(--accent)' }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: UI.fontUi }}>Reload App</span>
                </div>
                <span style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>Clear cache & refetch everything</span>
              </button>
            </div>
          );
        })()}
      </Sheet>

      {/* Check-in picker: real coach vs. self-coaching */}
      {(() => {
        const asClient = store.coaching?.asClient;
        const asSelf   = store.coaching?.asSelf;
        const navCheckinSelf = () =>
          go({ name: 'coaching-client', coachingId: asSelf.id, clientId: userId, clientName: store.user.name, initialTab: 'checkins', isSelf: true, backRoute: 'home' });
        const navCheckinCoach = () =>
          go({ name: 'coaching', initialClientTab: 'checkin' });
        const btnStyle = { width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };
        return (
          <Sheet open={checkinPickerOpen} onClose={() => setCheckinPickerOpen(false)} title="Which check-in?">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {asClient?.status === 'active' && (
                <button onClick={() => { setCheckinPickerOpen(false); navCheckinCoach(); }} style={btnStyle}>
                  <i className="fa-solid fa-user-tie" style={{ width: 20, textAlign: 'center', color: 'var(--accent)', fontSize: 16 }} />
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: UI.fontUi }}>Coach check-in</div>
                    <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 2, fontFamily: UI.fontUi }}>{asClient.coachName || 'Your coach'}</div>
                  </div>
                  <svg width="7" height="12" viewBox="0 0 7 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l5 5-5 5"/></svg>
                </button>
              )}
              {asSelf && (
                <button onClick={() => { setCheckinPickerOpen(false); navCheckinSelf(); }} style={btnStyle}>
                  <i className="fa-solid fa-user" style={{ width: 20, textAlign: 'center', color: 'var(--accent)', fontSize: 16 }} />
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: UI.fontUi }}>Self check-in</div>
                    <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 2, fontFamily: UI.fontUi }}>Your own coaching dashboard</div>
                  </div>
                  <svg width="7" height="12" viewBox="0 0 7 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l5 5-5 5"/></svg>
                </button>
              )}
            </div>
          </Sheet>
        );
      })()}

      {/* Workout sub-picker: From plan | Freestyle */}
      <Sheet open={workoutSubOpen} onClose={() => setWorkoutSubOpen(false)} title="Start workout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sch && (
            <button onClick={() => { setWorkoutSubOpen(false); setBonusDayPickerOpen(true); }} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
              borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>From plan</div>
                <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 2, fontFamily: UI.fontUi }}>Pick a day from your schedule — you choose at the end whether it counts</div>
              </div>
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l5 5-5 5"/></svg>
            </button>
          )}
          <button onClick={() => { setWorkoutSubOpen(false); setFreestyleSubOpen(true); }} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
            borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>Freestyle</div>
              <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 2, fontFamily: UI.fontUi }}>Open session — empty or from a template</div>
            </div>
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l5 5-5 5"/></svg>
          </button>
        </div>
      </Sheet>

      {/* Freestyle sub-picker: Empty | From template */}
      <Sheet open={freestyleSubOpen} onClose={() => setFreestyleSubOpen(false)} title="Freestyle">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={startFreestyleSession} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
            borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>Empty session</div>
              <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 2, fontFamily: UI.fontUi }}>Start blank — add exercises on the fly</div>
            </div>
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l5 5-5 5"/></svg>
          </button>
          {(store.workoutTemplates || []).length > 0 && (
            <>
              <div className="label" style={{ marginTop: 8, marginBottom: 2, color: UI.inkFaint }}>From template</div>
              {(store.workoutTemplates || []).map(t => (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'stretch', gap: 0,
                  background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 6, overflow: 'hidden',
                }}>
                  <button onClick={() => startFreestyleFromTemplate(t)} style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '12px 14px', background: 'transparent', border: 'none',
                    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    <span className="micro" style={{ color: UI.inkFaint, flexShrink: 0 }}>{(t.exercises || []).length} ex</span>
                  </button>
                  <button onClick={async () => {
                    if (!await confirm(`Delete template "${t.name}"?`, { title: 'Delete template', ok: 'Delete', danger: true })) return;
                    setStore(s => ({ ...s, workoutTemplates: (s.workoutTemplates || []).filter(x => x.id !== t.id) }));
                  }} aria-label="Delete template" style={{
                    flexShrink: 0, width: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: 'none', borderLeft: `0.5px solid ${UI.hair}`,
                    color: 'rgba(var(--danger-rgb),0.7)', cursor: 'pointer',
                  }}>
                    <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </Sheet>

      {/* Bonus day picker — training days from the active schedule */}
      <Sheet open={bonusDayPickerOpen} onClose={() => setBonusDayPickerOpen(false)} title="Pick a day">
        <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, marginBottom: 14 }}>
          You choose at the end whether this replaces a scheduled day or counts as extra.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(sch?.days || []).filter(d => d.items?.length > 0).map(d => (
            <button key={d.id} onClick={() => startBonusSession(d)} style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
              borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>{d.name}</span>
              <span className="micro" style={{ color: UI.inkFaint }}>{d.items.length} exercise{d.items.length !== 1 ? 's' : ''}</span>
            </button>
          ))}
        </div>
      </Sheet>

      {/* Backlog day picker when multiple missed sessions */}
      <Sheet open={backlogPickerOpen} onClose={() => setBacklogPickerOpen(false)} title="Which session?">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {allMissedDays.map(m => (
            <button key={m.dateKey} onClick={() => startBacklogSession(m)} style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
              borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>{m.dayName}</span>
              <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>
                {LB.dayLabel(m.daysAgo)}
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      {/* Daily log sheet */}
      <DailyLogSheet
        open={dailyLogOpen}
        onClose={() => setDailyLogOpen(false)}
        store={store}
        setStore={setStore}
        date={LB.todayISO()}
        targets={LB.effectiveMacroTargets(store.settings?.macroTargets, coachingMacros)}
        activeCoachingSchema={coachingSchema}
        onSetStatus={handleSetStatus}
      />

      </div>{/* end swipe wrapper */}
    </Screen>
  );
}

// ─── PENDING APPROVAL ────────────────────────────────────────────────────────
function PendingApprovalScreen({ onSignOut }) {
  return (
    <Screen scroll={false} style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="guilloche" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div style={{ flexShrink: 0, padding: 'calc(env(safe-area-inset-top, 0px) + 18px) 22px 0', display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 1 }}>
        <span className="micro">ZANE TRAINING</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px', position: 'relative', zIndex: 1, gap: 16 }}>
        <img src="icons/zane-logo.png" style={{ width: '70%', maxWidth: 380, objectFit: 'contain', marginBottom: 8 }} />
        <div className="display" style={{ fontSize: 22, color: UI.ink, fontWeight: 400, textAlign: 'center' }}>
          Waiting for approval
        </div>
        <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, textAlign: 'center', lineHeight: 1.6, maxWidth: 280 }}>
          Your account has been created. The admin will review and approve your access shortly.
        </div>
        <button onClick={onSignOut} style={{
          marginTop: 8, padding: '10px 20px', borderRadius: 4,
          background: 'transparent', border: `1px solid ${UI.hairStrong}`,
          color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11,
          letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
        }}>
          Sign out
        </button>
      </div>
    </Screen>
  );
}

// ─── UNIT PROMPT (existing users) ────────────────────────────────────────────
function UnitPromptModal({ onDone }) {
  const opts = [
    { id: 'kg',    label: 'Metric',   sub: 'kg / km', icon: 'fa-ruler-combined' },
    { id: 'lbs',   label: 'Imperial', sub: 'lbs / mi', icon: 'fa-flag' },
    { id: 'mixed', label: 'Mixed',    sub: 'kg / mi',  icon: 'fa-scale-unbalanced' },
  ];
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
        border: `1px solid ${UI.hairStrong}`,
        borderRadius: 6,
        padding: '28px 24px',
        display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
        animation: 'fadeUp 0.3s ease',
      }}>
        <div>
          <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: 'var(--accent)', fontWeight: 400, marginBottom: 8, textTransform: 'uppercase' }}>Units &amp; system</div>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
            Which unit system do you use? This can be changed later in Settings.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {opts.map(opt => (
            <button key={opt.id} onClick={() => onDone(opt.id)} style={{
              flex: 1, padding: '14px 0', borderRadius: 6, cursor: 'pointer',
              background: UI.bgInset,
              border: `1px solid ${UI.hairStrong}`,
              color: UI.inkSoft,
              fontFamily: UI.fontUi, textAlign: 'center',
              WebkitTapHighlightColor: 'transparent',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}>
              <i className={`fa-solid ${opt.icon}`} style={{ fontSize: 20, color: UI.inkFaint }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: UI.ink }}>{opt.label}</div>
                <div style={{ fontSize: 10, color: UI.inkFaint, marginTop: 2 }}>{opt.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { LoginScreen, HomeScreen, SetPasswordScreen, PendingApprovalScreen, CardioQuickLogSheet, UnitPromptModal });
