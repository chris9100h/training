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

// ─── LOGIN / REGISTER ─────────────────────────────────────────────────────────
function LoginScreen() {
  const [mode, setMode]           = useState('login'); // 'login' | 'register'
  const [name, setName]           = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [unit, setUnit]           = useState('kg'); // 'kg' | 'lbs'
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [swVersion, setSwVersion] = useState('');
  const formRef = useRef(null);

  useEffect(() => {
    if (!('caches' in window)) return;
    caches.keys().then(keys => {
      const k = keys.find(k => k.startsWith('zane-'));
      if (k) setSwVersion(k.replace('zane-', ''));
    });
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

  const switchMode = (m) => { setMode(m); setError(''); setPassword(''); setConfirm(''); };

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

  return (
    <Screen scroll style={{ position: 'relative' }}>
      <div className="guilloche" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }} />

      <div style={{ flexShrink: 0, padding: 'calc(env(safe-area-inset-top, 0px) + 18px) 22px 0', display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 1 }}>
        <span className="micro">ZANE TRAINING</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 32px 24px', position: 'relative', zIndex: 1, marginTop: 'auto', marginBottom: 'auto' }}>
        <img src="icons/zane-logo.png" style={{ width: '92%', maxWidth: 500, objectFit: 'contain', marginBottom: 28 }} />

        {/* Tab switcher */}
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
            <Btn style={{ marginTop: 4, opacity: canLogin && !loading ? 1 : 0.4 }}>
              {loading ? 'Signing in…' : 'Log in'}
            </Btn>
          ) : (
            <Btn disabled={!canRegister || loading} style={{ marginTop: 4, opacity: canRegister && !loading ? 1 : 0.4 }}>
              {loading ? 'Creating account…' : 'Create account'}
            </Btn>
          )}
        </form>
      </div>

      <div style={{ flexShrink: 0, padding: '0 22px calc(env(safe-area-inset-bottom, 8px) + 18px)', display: 'flex', justifyContent: 'flex-end', position: 'relative', zIndex: 1 }}>
        <span className="micro">{swVersion || '…'}</span>
      </div>
    </Screen>
  );
}

// ─── SET PASSWORD (invite / password-reset flow) ──────────────────────────────
function SetPasswordScreen({ onDone }) {
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
        await LB.supabase.from('zane_profiles').upsert({ id: currentUser.id, name: name.trim() });
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
            <div style={{ fontFamily: UI.fontDisplay, fontSize: 26, color: UI.ink, marginBottom: 6 }}>Welcome to Zane</div>
            <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>Set a password to complete your account.</div>
          </div>
          <Field label="Your name (optional)">
            <TextInput value={name} onChange={setName} placeholder="e.g. Alex" autoFocus />
          </Field>
          <Field label="Password">
            <TextInput value={password} onChange={setPassword} type="password" placeholder="min. 6 characters" />
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
            {loading ? 'Setting up…' : 'Set password & continue'}
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

function RecentBannerDay({ banner, store, setStore, go, sch, userId, onOpenSkipSheet }) {
  const { dateKey, dayName, daysAgo, skip, dayData, date, dayId } = banner;
  // The Log handler awaits a seed fetch — guard against a double tap creating
  // two sessions inside that window.
  const startingRef = useRef(false);
  const dateLabel = daysAgo === 1 ? 'YESTERDAY' : `${daysAgo}D AGO`;
  if (skip) {
    return (
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`, borderRadius: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="micro" style={{ marginBottom: 3 }}>{dayName} · {dateLabel}</div>
          <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, letterSpacing: '0.04em', background: `rgba(var(--bg-rgb),0.5)`, border: `1px solid ${UI.hairStrong}`, borderRadius: 3, padding: '2px 8px', display: 'inline-block' }}>
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
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(var(--danger-rgb),0.05)', border: `0.5px solid rgba(var(--danger-rgb),0.2)`, borderRadius: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="micro" style={{ color: UI.danger, marginBottom: 2 }}>{dayName} · {dateLabel}</div>
        <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>Not logged</div>
      </div>
      <button onClick={async () => {
        if (startingRef.current) return;
        startingRef.current = true;
        // Seeds may live outside the boot window — fetch them before creating
        // the session (resolves instantly when the local window has them).
        const seedRefs = await LB.fetchSeedEntries(store, dayData?.items, dayId, userId);
        const entries = (dayData?.items || []).map(it => {
          const ex = LB.findExercise(store, it.exId);
          if (ex?.movement_type === 'cardio') {
            return { exId: it.exId, name: ex.name, isCardio: true, plannedSets: 0, plannedReps: null, plannedRepsPerSet: null, sets: [], cardioDone: false, cardioData: null, note: '', supersetGroup: it.supersetGroup || null };
          }
          const last = seedRefs[it.exId] ?? LB.bestRecentEntry(store, it.exId, dayId);
          const isUni = ex?.unilateral || false;
          const suggestion = LB.progressionSuggestion(store, it.exId, dayId, it.reps, it.repsPerSet, seedRefs[it.exId]);
          const seedSets = LB.buildSeedSets(it, last, suggestion, isUni, !!store.settings?.smartProgression);
          return { exId: it.exId, name: ex?.name || '?', plannedSets: it.sets, plannedReps: it.reps, plannedRepsPerSet: it.repsPerSet || null, sets: seedSets, note: '', supersetGroup: it.supersetGroup || null };
        });
        const session = { id: LB.uid(), scheduleId: sch.id, dayId, dayName, date: date.toISOString(), startedAt: new Date().toISOString(), ended: null, entries, currentExIdx: 0, cyclePos: null };
        setStore(s => ({ ...s, sessions: [...s.sessions, session], inProgress: session.id }));
        go({ name: 'train', sessionId: session.id });
      }} style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 4, background: 'transparent', border: `1px solid ${UI.hairStrong}`, cursor: 'pointer', fontSize: 11, fontFamily: UI.fontUi, color: UI.inkSoft, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        Log
      </button>
      <button onClick={() => onOpenSkipSheet({ mode: 'dismiss', data: { dateKey, dayId, dayName } })} style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 4, background: 'transparent', border: `1px solid rgba(var(--danger-rgb),0.25)`, cursor: 'pointer', fontSize: 11, fontFamily: UI.fontUi, color: 'rgba(var(--danger-rgb),0.7)', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        Dismiss
      </button>
    </div>
  );
}

// ─── CARDIO QUICK-LOG ─────────────────────────────────────────────────

const CARDIO_DIST_KEY = 'logbook-cardio-dist-unit'; // 'km' | 'mi'
const CARDIO_LIVE_KEY = 'logbook-cardio-live-start'; // epoch ms of a running live cardio, else absent
const MI_TO_M = 1609.344;

function distToM(val, unit) {
  const n = parseFloat(String(val).replace(',', '.'));
  if (isNaN(n)) return null;
  return unit === 'mi' ? Math.round(n * MI_TO_M) : Math.round(n * 1000);
}
function mToDisplay(meters, unit) {
  if (meters == null) return '';
  return unit === 'mi' ? (meters / MI_TO_M).toFixed(2) : (meters / 1000).toFixed(2);
}

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

  const du = (() => { try { return localStorage.getItem(CARDIO_DIST_KEY) || 'km'; } catch (_) { return 'km'; } })();
  const isBest = pr.tier === 'best';
  const fmtPace = (minPerKm) => {
    const perUnit = du === 'mi' ? minPerKm * MI_TO_M / 1000 : minPerKm;
    let mins = Math.floor(perUnit);
    let secs = Math.round((perUnit - mins) * 60);
    if (secs === 60) { mins += 1; secs = 0; }
    return `${mins}:${String(secs).padStart(2, '0')} /${du}`;
  };
  const fmtDist = (m) => du === 'mi' ? `${(m / MI_TO_M).toFixed(2)} mi` : `${(m / 1000).toFixed(2)} km`;
  const META = {
    pace:     { label: 'Fastest Pace',     fmt: fmtPace },
    distance: { label: 'Longest Distance', fmt: fmtDist },
    duration: { label: 'Longest Session',  fmt: v => `${v} min` },
  };

  // Portaled to <body> so the flash covers the whole screen (incl. behind the
  // status bar); inside a <Screen> (overflow:hidden) iOS clips position:fixed.
  return ReactDOM.createPortal(
    <div onClick={onDone} style={{
      position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 200, background: 'rgb(8,6,3)',
      animation: 'improvedFade 3.8s ease forwards',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>
      <div style={{ position: 'absolute', inset: 0, animation: 'improvedBorderPulse 0.7s ease-in-out infinite' }} />
      <span style={{ fontFamily: UI.fontDisplay, fontSize: 72, color: UI.gold, fontWeight: 900, lineHeight: 1, textShadow: '0 0 30px rgba(201,169,97,1), 0 0 70px rgba(201,169,97,0.6)' }}>{isBest ? '★' : '↑'}</span>
      <span style={{ fontFamily: UI.fontUi, fontSize: 28, color: UI.gold, fontWeight: 900, letterSpacing: '0.2em', textShadow: '0 0 15px rgba(201,169,97,1), 0 0 40px rgba(201,169,97,0.8)' }}>{isBest ? 'NEW BEST' : 'IMPROVEMENT'}</span>
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

function CardioQuickLogSheet({ open, onClose, store, setStore, userId, editLog, onPR }) {
  const getDistUnit = () => { try { return localStorage.getItem(CARDIO_DIST_KEY) || 'km'; } catch (_) { return 'km'; } };
  const [distUnit, setDistUnitState] = useState(getDistUnit);
  const setDistUnit = (u) => { try { localStorage.setItem(CARDIO_DIST_KEY, u); } catch (_) {} setDistUnitState(u); };

  const todayStr = LB.todayISO();
  const empty = () => ({ date: todayStr, type: '', duration: '', distance: '', paceFeeling: null, effort: null, note: '' });
  const [form, setForm] = useState(empty);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    if (editLog) {
      const du = getDistUnit();
      setForm({
        date: editLog.date,
        type: editLog.type || '',
        duration: editLog.durationMinutes ? String(editLog.durationMinutes) : '',
        distance: editLog.distanceM != null ? mToDisplay(editLog.distanceM, du) : '',
        paceFeeling: editLog.paceFeeling ?? null,
        effort: editLog.effort ?? null,
        note: editLog.note || '',
      });
    } else {
      setForm(empty());
    }
  }, [open, editLog?.id]);

  // Unique types from history, most-recently-used first
  const typeChips = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const l of (store.cardioLogs || [])) {
      if (l.type && !seen.has(l.type)) { seen.add(l.type); result.push(l.type); }
      if (result.length >= 6) break;
    }
    return result;
  }, [store.cardioLogs]);

  const canSave = form.date && form.duration && Number(form.duration) > 0;

  const save = () => {
    if (!canSave) return;
    if (editLog) {
      const updated = {
        ...editLog,
        date: form.date,
        type: form.type.trim() || null,
        durationMinutes: Math.round(Number(form.duration)),
        distanceM: form.distance ? distToM(form.distance, distUnit) : null,
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
        distanceM: form.distance ? distToM(form.distance, distUnit) : null,
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
    <Sheet open={open} onClose={onClose} title={editLog ? 'EDIT CARDIO' : 'LOG CARDIO'}>
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
  const getDistUnit = () => { try { return localStorage.getItem(CARDIO_DIST_KEY) || 'km'; } catch (_) { return 'km'; } };
  const [distUnit, setDistUnitState] = useState(getDistUnit);
  const setDistUnit = (u) => { try { localStorage.setItem(CARDIO_DIST_KEY, u); } catch (_) {} setDistUnitState(u); };
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ type: '', distance: '', paceFeeling: null, effort: null, note: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setForm({ type: '', distance: '', paceFeeling: null, effort: null, note: '' });
    setDistUnitState(getDistUnit());
  }, [open]);

  const typeChips = useMemo(() => {
    const seen = new Set(); const result = [];
    for (const l of (store.cardioLogs || [])) {
      if (l.type && !seen.has(l.type)) { seen.add(l.type); result.push(l.type); }
      if (result.length >= 6) break;
    }
    return result;
  }, [store.cardioLogs]);

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
      distanceM: form.distance ? distToM(form.distance, distUnit) : null,
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
                <div key={i} style={{ width: i === step - 1 ? 18 : 6, height: 6, borderRadius: 3, transition: 'all 0.2s', background: i === step - 1 ? 'var(--accent)' : i < step - 1 ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong }} />
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

// ─── HOME ─────────────────────────────────────────────────────────────
// Per-user override for the faint background figure on the main screen.
// Keyed by lowercase email → image path (must also be listed in sw.js ASSETS).
const TRAIN_BG_OVERRIDES = {
  'mikeapicelli777@gmail.com': 'icons/IMG_6389.png',
  'mb2489@protonmail.com':     'icons/phoenix.png',
  'test@test.com':             'icons/phoenix.png',
};

function HomeScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const _userEmail = (store.user?.email || '').toLowerCase();
  const _adminPreviewBg = _userEmail === 'office@btc-prime.biz'
    ? ({ mike: 'icons/IMG_6389.png', phoenix: 'icons/phoenix.png' })[localStorage.getItem('logbook-admin-bg-preview')]
    : undefined;
  const trainBg = _adminPreviewBg || TRAIN_BG_OVERRIDES[_userEmail] || 'icons/zane-logo.png';
  const isCustomBg = trainBg !== 'icons/zane-logo.png';
  const today = LB.todaysDay(store);
  const sch = today?.schedule;
  const day = today?.day;
  const dayIdx = today?.idx ?? 0;
  const dayCount = sch?.days?.length || 0;
  const weekdayMode = sch ? LB.isWeekdayPlan(sch) : false;
  const cycleWeekView = !weekdayMode && (store.settings?.cycleWeekView ?? localStorage.getItem('logbook-cycle-week-view') === 'true');

  const jsDay = new Date().getDay();
  const todayWd = jsDay === 0 ? 6 : jsDay - 1;
  // Oldest version = original plan start; null when no versioning
  const oldestVersionStart = sch?.versions?.length
    ? sch.versions[sch.versions.length - 1].validFrom
    : null;

  // Auto-migrate from cycleIndex to cycleStartDate on first load
  useEffect(() => {
    if (!weekdayMode && sch && !store.cycleStartDate) {
      const today = new Date(); today.setHours(12, 0, 0, 0);
      const start = new Date(today.getTime() - (store.cycleIndex || 0) * 86400000);
      setStore(s => s.cycleStartDate ? s : { ...s, cycleStartDate: start.toISOString().slice(0, 10) });
    }
  }, []); // eslint-disable-line


  const todayN = useMemo(() => {
    if (weekdayMode || !store.cycleStartDate) return store.cycleIndex || 0;
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = LB.parseDate(store.cycleStartDate);
    return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000));
  }, [store.cycleStartDate, store.cycleIndex, weekdayMode]);

  const currentCycleNum = dayCount > 0 ? Math.floor(todayN / dayCount) : 0;

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedWd, setSelectedWd] = useState(todayWd);
  const [skipReasonModal, setSkipReasonModal] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(dayIdx);
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

  const minOffset = (() => {
    if (weekdayMode) {
      const startDateStr = oldestVersionStart || store.weekPlanStartDate;
      if (startDateStr) {
        const now = new Date(); now.setHours(12, 0, 0, 0);
        const currentMondayMs = now.getTime() - todayWd * 86400000;
        const start = LB.parseDate(startDateStr);
        const planMondayMs = start.getTime() - ((start.getDay() + 6) % 7) * 86400000;
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
      const startWd = (trueStart.getDay() + 6) % 7;
      const startMondayMs = trueStart.getTime() - startWd * 86400000 - oldestDayCount * 86400000;
      return Math.round((startMondayMs - currentMondayMs) / (7 * 86400000));
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
      else setSelectedSlot(dayIdx);
    } else if (!weekdayMode && !cycleWeekView) {
      setSelectedSlot(dayCount - 1);
    }
  };

  const week = useMemo(() => {
    if (!sch) return [];
    if (weekdayMode) {
      return Array.from({ length: 7 }).map((_, i) => {
        const diff = i - todayWd + weekOffset * 7;
        const date = new Date(); date.setDate(date.getDate() + diff);
        const dateStr = date.toISOString().slice(0, 10);
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
        const dateStr = date.toISOString().slice(0, 10);
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
    return sch.days.map((d, i) => {
      const daysFromToday = weekOffset * dayCount + i - dayIdx;
      const date = new Date(); date.setDate(date.getDate() + daysFromToday);
      return { ...d, slotIdx: i, date, isToday: weekOffset === 0 && i === dayIdx };
    });
  }, [sch, dayIdx, dayCount, weekdayMode, cycleWeekView, todayWd, weekOffset, store.cycleStartDate]);

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
    return sch.days[selectedSlot] ?? sch.days[0];
  }, [weekdayMode, cycleWeekView, sch, selectedWd, selectedSlot, day, week]);

  const sessionDate = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    if (weekdayMode || cycleWeekView) {
      d.setDate(d.getDate() + selectedWd - todayWd + weekOffset * 7);
    } else {
      d.setDate(d.getDate() + weekOffset * dayCount + selectedSlot - dayIdx);
    }
    return d;
  }, [weekdayMode, cycleWeekView, selectedWd, todayWd, weekOffset, selectedSlot, dayIdx, dayCount]);

  const isViewingToday = weekOffset === 0 && ((weekdayMode || cycleWeekView) ? selectedWd === todayWd : selectedSlot === dayIdx);
  const isActiveRest = !activeDay?.items?.length;

  // "DAY X OF Y" denominator: with plan versioning the top-level sch.days holds
  // the newest version (which may only become active in the future), so the
  // day count must come from the version active on the date being viewed.
  const viewedDayCount = useMemo(() => {
    if (!sch?.versions?.length) return dayCount;
    const dStr = sessionDate.toISOString().slice(0, 10);
    return LB.getPlanDaysForDate(sch, dStr)?.length || dayCount;
  }, [sch, sessionDate, dayCount]);
  const isFutureSlot = sessionDate > (() => { const d = new Date(); d.setHours(12,0,0,0); return d; })();

  const periodLabel = useMemo(() => {
    if (weekdayMode) {
      if (store.weekPlanStartDate) {
        const monday = new Date(); monday.setHours(12, 0, 0, 0);
        monday.setDate(monday.getDate() - todayWd + weekOffset * 7);
        const start = LB.parseDate(store.weekPlanStartDate);
        const startMonday = new Date(start);
        startMonday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
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
        return `CYCLE ${LB.getCycleNumForDate(sch, monday.toISOString().slice(0, 10))}`;
      }
      const start = LB.parseDate(store.cycleStartDate);
      const dfs = Math.round((monday - start) / 86400000);
      return `CYCLE ${Math.floor(dfs / dayCount) + 1}`;
    }
    if (sch?.versions?.length) {
      const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + weekOffset * dayCount);
      return `CYCLE ${LB.getCycleNumForDate(sch, d.toISOString().slice(0, 10))}`;
    }
    const cycleNum = currentCycleNum + weekOffset + 1;
    return `CYCLE ${cycleNum}`;
  }, [weekdayMode, cycleWeekView, weekOffset, currentCycleNum, todayWd, store.cycleStartDate, dayCount, sch]);

  const cardLabel = useMemo(() => {
    if (isViewingToday) {
      if (weekdayMode) return `TODAY · ${WEEKDAYS_FULL[selectedWd].toUpperCase()}`;
      if (cycleWeekView) {
        const sel = week.find(d => d.weekday === selectedWd);
        return `TODAY · DAY ${(sel?.slotIdx ?? 0) + 1} OF ${viewedDayCount}`;
      }
      return `TODAY · DAY ${selectedSlot + 1} OF ${viewedDayCount}`;
    }
    const dateStr = sessionDate.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
    if (weekdayMode) return dateStr;
    if (cycleWeekView) {
      const sel = week.find(d => d.weekday === selectedWd);
      return `${dateStr} · DAY ${(sel?.slotIdx ?? 0) + 1} OF ${viewedDayCount}`;
    }
    return `${dateStr} · DAY ${selectedSlot + 1} OF ${viewedDayCount}`;
  }, [isViewingToday, weekdayMode, cycleWeekView, selectedWd, selectedSlot, viewedDayCount, sessionDate, week]);

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
    const dateKey = sessionDate.toISOString().slice(0, 10);
    return [...store.sessions]
      .filter(s => s.ended && s.date.slice(0, 10) === dateKey)
      .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0] ?? null;
  }, [store.sessions, sessionDate]);

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
      // Compare working sets by position, warmups excluded on both sides
      const currWorking = e.sets.filter(st => !st.warmup && !st.skipped);
      const prevWorking = prevEntry.sets.filter(st => !st.warmup);
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
        return LB.getCycleNumForDate(sch, date.toISOString().slice(0, 10));
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
    if (weekdayMode) {
      const key = `${sessionDate.getFullYear()}-${sessionDate.getMonth()}-${sessionDate.getDate()}`;
      return completedDateKeys?.has(key) ?? false;
    }
    if (cycleWeekView) {
      const sel = week.find(d => d.weekday === selectedWd);
      return sel?.daysFromStart != null && (completedCyclePos?.has(sel.daysFromStart) ?? false);
    }
    const pos = (currentCycleNum + weekOffset) * dayCount + selectedSlot;
    return completedCyclePos?.has(pos) ?? false;
  }, [isActiveRest, weekdayMode, cycleWeekView, sessionDate, completedDateKeys, completedCyclePos, week, selectedWd, currentCycleNum, weekOffset, dayCount, selectedSlot]);

  const skipsMap = useMemo(() => {
    const m = new Map();
    (store.skips || []).forEach(s => m.set(s.date.slice(0, 10), s));
    return m;
  }, [store.skips]);

  const selectedDateSkip = useMemo(() => {
    if (isViewingToday || isFutureSlot) return null;
    return skipsMap.get(sessionDate.toISOString().slice(0, 10)) ?? null;
  }, [isViewingToday, isFutureSlot, skipsMap, sessionDate]);

  const selectedDayCardioLogs = useMemo(() => {
    const dateKey = sessionDate.toISOString().slice(0, 10);
    return (store.cardioLogs || []).filter(l => l.date === dateKey);
  }, [store.cardioLogs, sessionDate]);

  const recentBannerDay = useMemo(() => {
    if (!sch) return null;
    const todayD = new Date(); todayD.setHours(12, 0, 0, 0);
    const sessionDates = new Set(store.sessions.filter(s => s.ended).map(s => s.date.slice(0, 10)));
    for (let daysAgo = 1; daysAgo <= 30; daysAgo++) {
      const d = new Date(todayD); d.setDate(todayD.getDate() - daysAgo);
      const dateKey = d.toISOString().slice(0, 10);
      if (sessionDates.has(dateKey)) continue;
      const sk = skipsMap.get(dateKey);
      if (sk) continue; // already actioned — edit via calendar card
      let trainingDay = null;
      if (weekdayMode) {
        if (store.weekPlanStartDate && dateKey < store.weekPlanStartDate) continue;
        const wd = d.getDay() === 0 ? 6 : d.getDay() - 1;
        trainingDay = sch.days.find(day => day.weekday === wd && day.items?.length > 0) || null;
      } else if (store.cycleStartDate) {
        const vDays = LB.getPlanDaysForDate(sch, dateKey);
        if (!vDays.length) continue;
        const cyclePosForDate = LB.getCyclePosForDate(sch, dateKey);
        let idx;
        if (cyclePosForDate !== null) {
          idx = cyclePosForDate;
        } else {
          const start = LB.parseDate(store.cycleStartDate);
          const n = Math.round((d.getTime() - start.getTime()) / 86400000);
          if (n < 0) continue;
          idx = ((n % vDays.length) + vDays.length) % vDays.length;
        }
        const dayData = vDays[idx];
        if (dayData?.items?.length > 0) trainingDay = dayData;
      }
      if (!trainingDay) continue;
      return { date: d, dateKey, dayName: trainingDay.name, dayId: trainingDay.id, daysAgo, skip: sk || null, dayData: trainingDay };
    }
    return null;
  }, [sch, weekdayMode, store.cycleStartDate, store.sessions, store.skips, skipsMap]);

  const startSession = async () => {
    if (!activeDay || isActiveRest) return;
    // Seeds/progression consume the recent history synchronously — when an
    // exercise's last sessions are outside the boot window, fetch them from
    // the server first (fetchSeedEntries resolves instantly when the local
    // window suffices, and never rejects — offline falls back to local data).
    const seedRefs = await LB.fetchSeedEntries(store, activeDay.items, activeDay.id, userId);
    const entries = activeDay.items.map(it => {
      const ex = LB.findExercise(store, it.exId);
      if (ex?.movement_type === 'cardio') {
        return { exId: it.exId, name: ex.name, isCardio: true, plannedSets: 0, plannedReps: null, plannedRepsPerSet: null, sets: [], cardioDone: false, cardioData: null, note: '', supersetGroup: it.supersetGroup || null };
      }
      const last = seedRefs[it.exId] ?? LB.bestRecentEntry(store, it.exId, activeDay.id);
      const isUnilateral = ex?.unilateral || false;
      const suggestion = LB.progressionSuggestion(store, it.exId, activeDay.id, it.reps, undefined, seedRefs[it.exId]);
      const seedSets = LB.buildSeedSets(it, last, suggestion, isUnilateral, !!store.settings?.smartProgression);
      return {
        exId: it.exId, name: ex?.name || '?',
        plannedSets: it.sets, plannedReps: it.reps, plannedRepsPerSet: it.repsPerSet || null,
        sets: seedSets, note: '',
        supersetGroup: it.supersetGroup || null,
      };
    });
    const cyclePos = weekdayMode ? null :
      cycleWeekView
        ? (week.find(d => d.weekday === selectedWd)?.daysFromStart ?? null)
        : (currentCycleNum + weekOffset) * dayCount + selectedSlot;
    const firstWorkingKg = entries[0]?.sets[0]?.kg ?? null;
    setWarmupPromptData({ entries, cyclePos, firstWorkingKg, firstName: entries[0]?.name || '?' });
  };

  const confirmStart = (withWarmup) => {
    const { entries: rawEntries, cyclePos, firstWorkingKg } = warmupPromptData;
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
      id: LB.uid(), scheduleId: sch.id, dayId: activeDay.id, dayName: activeDay.name,
      date: sessionDate.toISOString(), startedAt, ended: null, entries, currentExIdx: 0,
      cyclePos,
    };
    setStore(s => ({ ...s, sessions: [...s.sessions, session], inProgress: session.id }));
    go({ name: 'train', sessionId: session.id });
  };

  // ─── No-plan fallback
  if (!sch) {
    const hasPlans = store.schedules?.length > 0;
    return (
      <Screen>
        <TopBar
          title={<span>HEY, <span style={{ color: UI.gold }}>{(store.user.name || '').toUpperCase()}</span></span>}
          sub={new Date().toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long' })}
          right={<button onClick={() => go({ name: 'settings' })} style={{ background: 'transparent', border: `1px solid ${UI.hairStrong}`, padding: 4, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', fontSize: 20, color: UI.inkSoft, width: 36, height: 36, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⋯</button>}
        />
        <div style={{ padding: 22 }}>
          {hasPlans ? (
            <Empty
              title="No active plan"
              sub="You have plans ready — just pick one to activate."
              action={<Btn onClick={() => go({ name: 'plan' })}>View plans</Btn>}
              icon={ICON_CALENDAR}
            />
          ) : (
            <Empty
              title="No plan yet"
              sub="Create a training plan to get started."
              action={<Btn onClick={() => go({ name: 'schedule-new' })}>Create plan</Btn>}
              icon={ICON_CALENDAR}
            />
          )}
        </div>
        {confirmEl}
      </Screen>
    );
  }

  const cardioBanner = selectedDayCardioLogs.length > 0 ? (() => {
    const du = (() => { try { return localStorage.getItem(CARDIO_DIST_KEY) || 'km'; } catch(_) { return 'km'; } })();
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
              <span className="num" style={{ fontSize: 11, color: UI.inkSoft, flexShrink: 0 }}>{mToDisplay(single.distanceM, du)}<span style={{ fontSize: 8 }}>{du}</span></span>
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
      {/* Background ZANE watermark (per-user override via TRAIN_BG_OVERRIDES) */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <img src={trainBg} style={isCustomBg
          ? { width: '92%', maxWidth: 360, opacity: 0.16, objectFit: 'contain' }
          : { width: '85%', maxWidth: 320, opacity: 0.04, filter: 'grayscale(1) brightness(3)', objectFit: 'contain' }} />
      </div>

      {/* Header */}
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
            <i className="fa-solid fa-dumbbell" style={{ fontSize: 18, color: UI.inkFaint }} />
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

        {/* Period navigation */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
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
          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', color: UI.inkSoft, textTransform: 'uppercase' }}>{periodLabel}</span>
          </div>
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
        </div>

        {/* day strip */}
        <div style={{ flexShrink: 0, display: 'flex', gap: 4 }}>
          {week.map((d, i) => {
            const isSelected = (weekdayMode || cycleWeekView) ? i === selectedWd : i === selectedSlot;
            const r = !d.items?.length;
            const slotLabel = weekdayMode
              ? WEEKDAYS[i]
              : d.date.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' }).replace(/\.$/, '');
            let isCompleted = false;
            if (!r) {
              if (weekdayMode) {
                const slotKey = `${d.date.getFullYear()}-${d.date.getMonth()}-${d.date.getDate()}`;
                isCompleted = completedDateKeys?.has(slotKey) ?? false;
              } else if (cycleWeekView) {
                isCompleted = d.daysFromStart != null && (completedCyclePos?.has(d.daysFromStart) ?? false);
              } else {
                const pos = (currentCycleNum + weekOffset) * dayCount + i;
                isCompleted = completedCyclePos?.has(pos) ?? false;
              }
            }
            const dateKey = d.date.toISOString().slice(0, 10);
            const isPast = !d.isToday && d.date < new Date();
            const planStartStr = oldestVersionStart
              || (weekdayMode ? store.weekPlanStartDate : store.cycleStartDate);
            const isBeforePlanStart = planStartStr ? d.date < LB.parseDate(planStartStr) : false;
            const isMissed = !r && isPast && !isCompleted && !skipsMap.has(dateKey) && !isBeforePlanStart;
            const isSkipped = !r && isPast && !isCompleted && skipsMap.has(dateKey);
            return (
              <div key={d.id ?? i}
                onClick={() => (weekdayMode || cycleWeekView) ? setSelectedWd(i) : setSelectedSlot(i)}
                style={{
                  flex: 1, padding: '10px 4px 8px', textAlign: 'center',
                  background: isSelected ? UI.goldFaint : isCompleted ? UI.goldFaint : isMissed ? 'rgba(var(--danger-rgb),0.08)' : isSkipped ? 'rgba(160,160,160,0.07)' : 'transparent',
                  border: `${isSelected ? '2px' : '0.5px'} solid ${isSelected ? UI.gold : isCompleted ? UI.goldSoft : isMissed ? 'rgba(var(--danger-rgb),0.4)' : isSkipped ? 'rgba(160,160,160,0.3)' : d.isToday ? UI.hairStrong : UI.hair}`,
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
                <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: r ? UI.inkFaint : isSelected ? UI.gold : isMissed ? UI.danger : isSkipped ? UI.inkFaint : UI.ink, letterSpacing: '0.06em' }}>
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
                    ? LB.getCycleNumForDate(sch, selDay.date.toISOString().slice(0, 10))
                    : Math.floor(selDay.daysFromStart / dayCount) + 1)
                : null;
              const isActive = seg.cycleNum === selCycleNum;
              return (
                <div key={i} style={{
                  flex: seg.count, height: 16, borderRadius: 4,
                  background: isActive ? UI.goldFaint : 'rgba(201,169,97,0.06)',
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
              RECOVER.
            </div>
            <div style={{ fontSize: 13, color: UI.inkFaint, marginBottom: 22, maxWidth: 220 }}>
              Recovery is part of the plan.
            </div>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <Btn kind="ghost" onClick={() => go({ name: 'plan-view' })} style={{ flex: 1 }}>View plan</Btn>
            </div>
            <button onClick={() => setCardioPopoverOpen(true)} style={{
              width: '100%', marginTop: 8, padding: '9px 16px',
              background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
              border: '1px solid rgba(var(--accent-rgb),0.6)',
              borderRadius: 8, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              WebkitTapHighlightColor: 'transparent',
            }}>
              <i className="fa-solid fa-person-running" style={{ fontSize: 11, color: 'rgba(10,8,5,0.6)' }} />
              <span style={{ fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(10,8,5,0.75)' }}>CARDIO</span>
            </button>
            {cardioBanner}
          </BracketFrame>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            {/* Fixed: label, name, stats, CTAs */}
            <div style={{ flexShrink: 0, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4 }}>
            <div className="micro-gold" style={{ marginBottom: 6 }}>{cardLabel}</div>
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
                            <span style={{ color: '#7bc47b', fontWeight: 600 }}>↑ {improvementCount}</span>
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
                      <button onClick={() => setSkipReasonModal({ mode: 'edit', skipId: selectedDateSkip.id, currentReason: selectedDateSkip.skipReason, data: { dateKey: sessionDate.toISOString().slice(0, 10), dayId: activeDay?.id, dayName: activeDay?.name } })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: UI.inkFaint, display: 'flex', alignItems: 'center' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button onClick={() => { setStore(s => ({ ...s, skips: (s.skips || []).filter(x => x.id !== selectedDateSkip.id) })); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', color: UI.danger, fontSize: 18, lineHeight: 1, fontFamily: UI.fontUi }}>×</button>
                    </div>
                  </Frame>
                )}
                {!selectedDateSkip && (
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
                        {isViewingToday || isFutureSlot ? 'START WORKOUT' : 'LOG SESSION'}
                      </span>
                    </button>
                    {isViewingToday && (
                      <button onClick={() => setSkipReasonModal({ mode: 'skip', data: { dateKey: sessionDate.toISOString().slice(0, 10), dayId: activeDay?.id, dayName: activeDay?.name } })} style={{
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
                )}
              </div>
            )}

            {cardioBanner}

            </div>{/* end fixed header */}

          </div>
        )}
      </div>

      {!isActiveRest && (
        <div style={{ flexShrink: 0, padding: '6px 22px', paddingBottom: isPad ? 'calc(env(safe-area-inset-bottom, 0px) + 16px)' : 0 }}>
          <button onClick={() => setCardioPopoverOpen(true)} style={{
            width: '100%', padding: '9px 16px',
            background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
            border: '1px solid rgba(var(--accent-rgb),0.6)',
            borderRadius: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <i className="fa-solid fa-person-running" style={{ fontSize: 11, color: 'rgba(10,8,5,0.6)' }} />
            <span style={{ fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(10,8,5,0.75)' }}>CARDIO</span>
          </button>
        </div>
      )}

      {/* Last session + not-logged strip — fixed above tab bar */}
      {(lastSession || (recentBannerDay && !store.inProgress)) && (
        <div style={{ flexShrink: 0, padding: '10px 22px' }}>
          {lastSession && recentBannerDay && !store.inProgress ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Frame onClick={() => go({ name: 'session', sessionId: lastSession.id, back: { name: 'home' } })} style={{ flex: 1, minWidth: 0, padding: '10px 12px', cursor: 'pointer' }}>
                <div className="micro" style={{ marginBottom: 3 }}>LAST SESSION</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span className="display" style={{ fontSize: 15, color: UI.ink, lineHeight: 1 }}>{lastSession.dayName}</span>
                  <span className="num" style={{ color: UI.gold, fontSize: 10 }}>{Math.round(LB.totalVolume(lastSession)).toLocaleString('en-US')}<span style={{ color: UI.inkFaint }}>{UI.unit()}</span></span>
                </div>
              </Frame>
              <Frame onClick={() => setNotLoggedModalOpen(true)} style={{ flex: 1, minWidth: 0, padding: '10px 12px', background: 'rgba(var(--danger-rgb),0.05)', border: '0.5px solid rgba(var(--danger-rgb),0.2)', cursor: 'pointer' }}>
                <div className="micro" style={{ color: UI.danger, marginBottom: 2 }}>
                  {recentBannerDay.dayName} · {recentBannerDay.daysAgo === 1 ? 'YESTERDAY' : `${recentBannerDay.daysAgo}D AGO`}
                </div>
                <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>Not logged</div>
              </Frame>
            </div>
          ) : lastSession ? (
            <LastSessionStrip session={lastSession} onClick={() => go({ name: 'session', sessionId: lastSession.id, back: { name: 'home' } })} exercises={store.exercises} />
          ) : (
            <RecentBannerDay banner={recentBannerDay} store={store} setStore={setStore} go={go} sch={sch} userId={userId} onOpenSkipSheet={setSkipReasonModal} />
          )}
        </div>
      )}


      {/* Cardio history popover */}
      {cardioPopoverOpen && (() => {
        const recentCardio = (store.cardioLogs || []).slice(0, 5);
        const du = (() => { try { return localStorage.getItem(CARDIO_DIST_KEY) || 'km'; } catch (_) { return 'km'; } })();
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
                    {l.distanceM != null && <span className="num" style={{ fontSize: 11, color: UI.inkSoft, flexShrink: 0 }}>{mToDisplay(l.distanceM, du)}<span style={{ fontSize: 8 }}>{du}</span></span>}
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

      <CardioQuickLogSheet open={cardioLogOpen} onClose={() => { setCardioLogOpen(false); setEditingCardioLog(null); }} store={store} setStore={setStore} userId={userId} editLog={editingCardioLog} onPR={setCardioPR} />
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
            <Btn onClick={async () => {
              if (loggingRef.current) return;
              loggingRef.current = true;
              setNotLoggedModalOpen(false);
              const { dayData, dayId, dayName, date } = recentBannerDay;
              const seedRefs = await LB.fetchSeedEntries(store, dayData?.items, dayId, userId);
              const entries = (dayData?.items || []).map(it => {
                const ex = LB.findExercise(store, it.exId);
                if (ex?.movement_type === 'cardio') {
                  return { exId: it.exId, name: ex.name, isCardio: true, plannedSets: 0, plannedReps: null, plannedRepsPerSet: null, sets: [], cardioDone: false, cardioData: null, note: '', supersetGroup: it.supersetGroup || null };
                }
                const last = seedRefs[it.exId] ?? LB.bestRecentEntry(store, it.exId, dayId);
                const isUni = ex?.unilateral || false;
                const suggestion = LB.progressionSuggestion(store, it.exId, dayId, it.reps, it.repsPerSet, seedRefs[it.exId]);
                const seedSets = LB.buildSeedSets(it, last, suggestion, isUni, !!store.settings?.smartProgression);
                return { exId: it.exId, name: ex?.name || '?', plannedSets: it.sets, plannedReps: it.reps, plannedRepsPerSet: it.repsPerSet || null, sets: seedSets, note: '', supersetGroup: it.supersetGroup || null };
              });
              const session = { id: LB.uid(), scheduleId: sch.id, dayId, dayName, date: date.toISOString(), startedAt: new Date().toISOString(), ended: null, entries, currentExIdx: 0, cyclePos: null };
              setStore(s => ({ ...s, sessions: [...s.sessions, session], inProgress: session.id }));
              go({ name: 'train', sessionId: session.id });
            }}>Log session</Btn>
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
    { id: 'kg', label: 'Metric', sub: 'kg / km', icon: 'fa-ruler-combined' },
    { id: 'lbs', label: 'Imperial', sub: 'lbs / mi', icon: 'fa-flag' },
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
