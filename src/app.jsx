/* Main App — auth + routing */

const { useState: useStateA, useEffect: useEffectA, useRef: useRefA, useCallback: useCallbackA } = React;

// What's New — changelog entries live in src/whatsnew.js (window.WHATS_NEW, an
// array, newest first). On 'ready' after an update we show every entry the user
// hasn't seen yet, bundled into one card. Tracked per device by the newest id.
const WHATS_NEW_KEY = 'logbook-whatsnew-seen';

// Entries newer than the last-seen id. New users / first run after the feature
// shipped (no stored id) get just the latest, not the whole back catalogue.
function unseenWhatsNew() {
  const all = window.WHATS_NEW || [];
  if (!all.length) return [];
  let seen = null;
  try { seen = localStorage.getItem(WHATS_NEW_KEY); } catch (_) {}
  if (!seen) return [all[0]];
  const idx = all.findIndex(e => e.id === seen);
  return idx === -1 ? [all[0]] : all.slice(0, idx); // newest-first: before the seen entry = unseen
}

// Recipe-share deep link (…/?share=<token>, see RecipeShareSheet in
// screens-food.jsx): stash the token BEFORE anything else runs, so it survives
// the login (or even signup + approval) roundtrip a logged-out recipient goes
// through, then scrub it from the URL so a later reload doesn't re-trigger.
// Consumed by the RecipeShareSheet overlay once the app is ready (store loaded);
// kept in localStorage until then and cleared only on actual consumption (sheet
// close), so a reload/kill during the logged-out recipient's sign-up + approval
// roundtrip re-reads the still-present token instead of losing the recipe. Worst
// case a share the user never closed re-offers on the next launch, harmless (the
// same account-agnostic recipe), which is the accepted cost of not losing it.
const PENDING_SHARE_KEY = 'logbook-pending-share';
try {
  const _shareToken = new URLSearchParams(window.location.search).get('share');
  if (_shareToken && /^[a-f0-9]{16,64}$/i.test(_shareToken)) {
    localStorage.setItem(PENDING_SHARE_KEY, _shareToken);
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }
} catch (_) {}

function useIsPad() {
  const [isPad, setIsPad] = useStateA(() => window.innerWidth >= 768);
  useEffectA(() => {
    const handler = () => setIsPad(window.innerWidth >= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isPad;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <Screen scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ textAlign: 'center', padding: 32, animation: 'fadeUp 0.4s ease' }}>
            <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 6 }}>
              Something went wrong
            </div>
            <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 20 }}>
              {this.state.error?.message || 'Unexpected error'}
            </div>
            <button
              onClick={() => { this.setState({ error: null }); this.props.onGoHome?.(); }}
              style={{ background: UI.gold, color: '#0a0a0a', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, fontFamily: UI.fontUi, cursor: 'pointer', textShadow: 'none' }}
            >
              Back to home
            </button>
          </div>
        </Screen>
      );
    }
    return this.props.children;
  }
}

function AutoCloseBanner({ notify, onDismiss }) {
  const { dayName, date, durationMinutes } = notify;
  const dateLabel = date ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : '';
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
        backgroundImage: 'var(--bg-texture)',
        border: `1px solid ${UI.hairStrong}`,
        borderRadius: 6,
        padding: '32px 28px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 10, textAlign: 'center',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
        animation: 'fadeUp 0.3s ease',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 6,
          background: UI.bgInset,
          border: `1px solid ${UI.hairStrong}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 6,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={UI.inkFaint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 400 }}>
          Session auto-ended
        </div>
        <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>
          Your <strong style={{ color: UI.ink }}>{dayName}</strong> session{dateLabel ? ` on ${dateLabel}` : ''} was automatically ended{durationMinutes != null ? <> — <strong style={{ color: UI.ink }}>{durationMinutes} min</strong> recorded</> : ''}.
        </div>
        <button onClick={onDismiss} style={{
          marginTop: 10, width: '100%', padding: '14px 0',
          borderRadius: 6, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
          boxShadow: '0 8px 24px rgba(var(--accent-rgb),0.4)',
          color: 'var(--accent-ink)', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 700,
          letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent', textShadow: 'none',
        }}>
          GOT IT
        </button>
      </div>
    </div>
  );
}

function UpdateBanner({ onUpdate }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.72)',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{
        width: '100%', maxWidth: 320,
        background: UI.bgRaised,
        backgroundImage: 'var(--bg-texture)',
        border: `1px solid ${UI.goldSoft}`,
        borderRadius: 6,
        padding: '32px 28px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 10, textAlign: 'center',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(var(--accent-rgb),0.2)',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 6,
          background: UI.goldFaint,
          border: `1px solid ${UI.goldSoft}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 6,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={UI.gold} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v10m0 0l-3-3m3 3l3-3"/><path d="M3 17v1a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-1"/>
          </svg>
        </div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 400 }}>
          New version available
        </div>
        <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
          A fresh update is ready to install. This only takes a second.
        </div>
        <button onClick={onUpdate} style={{
          marginTop: 10, width: '100%', padding: '14px 0',
          borderRadius: 6, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
          boxShadow: '0 8px 24px rgba(var(--accent-rgb),0.4)',
          color: 'var(--accent-ink)', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 700,
          letterSpacing: '0.06em', textShadow: 'none',
        }}>
          UPDATE NOW
        </button>
      </div>
    </div>
  );
}

function WhatsNewModal({ entries, onDismiss }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9997,
      background: 'rgba(0,0,0,0.72)',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{
        width: '100%', maxWidth: 340, maxHeight: '82vh',
        background: UI.bgRaised,
        backgroundImage: 'var(--bg-texture)',
        border: `1px solid ${UI.goldSoft}`,
        borderRadius: 6,
        padding: '28px 26px',
        display: 'flex', flexDirection: 'column', gap: 18,
        overflowY: 'auto',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(var(--accent-rgb),0.2)',
        animation: 'fadeUp 0.3s ease',
        // This panel draws the same paper grid Card/Sheet do (bg-texture
        // above), so it needs the same lift or the grid cuts straight
        // through the title/item text. 'none' outside paper, a no-op there.
        textShadow: 'var(--text-lift)',
      }}>
        <div className="micro-gold">WHAT'S NEW</div>
        {entries.map((entry, ei) => (
          <div key={entry.id} style={{
            display: 'flex', flexDirection: 'column', gap: 12,
            ...(ei > 0 ? { paddingTop: 18, borderTop: `1px solid ${UI.hair}` } : null),
          }}>
            <div style={{ fontFamily: UI.fontDisplay, fontSize: 23, color: UI.ink, fontWeight: 400, lineHeight: 1.1 }}>
              {entry.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {(entry.items || []).map((it, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: UI.gold, marginTop: 7, flexShrink: 0 }} />
                  <div style={{ fontSize: 13.5, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>{it}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <button onClick={onDismiss} style={{
          marginTop: 4, width: '100%', padding: '14px 0', flexShrink: 0,
          borderRadius: 6, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
          boxShadow: '0 8px 24px rgba(var(--accent-rgb),0.4)',
          color: 'var(--accent-ink)', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 700,
          letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent', textShadow: 'none',
        }}>
          GOT IT
        </button>
      </div>
    </div>
  );
}


function LoadingScreen() {
  return (
    <Screen scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', animation: 'fadeUp 0.4s ease' }}>
        <div style={{
          width: 220, height: 220, margin: '0 auto 24px',
          animation: 'logoPulse 2.4s ease-in-out infinite',
        }}>
          <img src="icons/zane-logo.png" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: UI.ink, letterSpacing: '0.14em' }}>ZANE</div>
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontNum, letterSpacing: '0.1em', marginTop: 10, animation: 'timerPulse 1.6s ease-in-out infinite' }}>
          Loading…
        </div>
      </div>
    </Screen>
  );
}

function ErrorScreen({ onRetry }) {
  return (
    <Screen scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', padding: 32, animation: 'fadeUp 0.4s ease' }}>
        <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 6 }}>
          Couldn't load your data
        </div>
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 20 }}>
          Check your connection and try again.
        </div>
        <button onClick={onRetry} style={{
          background: UI.gold, color: '#0a0a0a',
          border: 'none', borderRadius: 4,
          padding: '8px 18px', fontSize: 13, fontWeight: 600,
          fontFamily: UI.fontUi, cursor: 'pointer', textShadow: 'none',
        }}>
          Retry
        </button>
      </div>
    </Screen>
  );
}

function App() {
  const isPad = useIsPad();
  const [phase, setPhase]         = useStateA('init'); // 'init' | 'loading' | 'ready' | 'unauthed' | 'error' | 'invite' | 'pending'
  // Detect invite/password-reset link before Supabase clears the hash
  const isTokenFlow = useRefA(
    window.location.hash.includes('type=invite') || window.location.hash.includes('type=recovery')
  );
  const isRecoveryFlow = useRefA(window.location.hash.includes('type=recovery'));
  const recoveryInProgress = useRefA(false); // set by PASSWORD_RECOVERY event; guards loadData from overriding the reset screen
  const [store, setStore]         = useStateA(null);
  const [userId, setUserId]       = useStateA(null);
  const [route, setRoute]         = useStateA({ name: 'home' });
  const [updateAvailable, setUpdateAvailable] = useStateA(false);
  const [forceShowUpdateBanner, setForceShowUpdateBanner] = useStateA(false); // Settings "Test update banner" bypasses the in-progress/onboarding hold-backs below
  const [autoCloseNotify, setAutoCloseNotify] = useStateA(null);
  const [whatsNew, setWhatsNew] = useStateA(null); // array of unseen changelog entries, or null
  const [syncStatus, setSyncStatus] = useStateA('synced'); // 'synced' | 'pending' | 'error'
  const [storageFull, setStorageFull] = useStateA(false);  // local cache write failed (quota)
  const [onboardingState, setOnboardingState] = useStateA(null); // null | { phase:'prompt' } | { phase:'tour', tourKey }
  const onboardingChecked = useRefA(false);
  const [unitPromptOpen, setUnitPromptOpen] = useStateA(false);
  const [pendingShare, setPendingShare] = useStateA(() => {   // ?share=<token> stashed by the module-scope block above
    try {
      // Read but do NOT remove here: the sheet only opens once `store` is ready
      // (see below), which for a logged-out recipient is after sign-up +
      // approval. Removing on first mount stranded the token in React state
      // only, so any reload/kill during that roundtrip (the common relaunch-
      // after-approval path) lost the recipe. Keeping it in localStorage lets a
      // fresh mount re-read it; it's cleared on actual consumption (sheet close).
      return localStorage.getItem(PENDING_SHARE_KEY);
    } catch (_) { return null; }
  });
  const unitPicked                = useRefA(false); // user chose a unit this session — silences the reset watcher
  const retryTimer                = useRefA(null);  // one-shot retry after a failed sync
  const waitingWorker             = useRefA(null);
  const intentionalUpdate         = useRefA(false);
  const swReg                     = useRefA(null);
  const prevStore                 = useRefA(null);
  const syncBase                  = useRefA(null);  // last state confirmed written to Supabase
  const pendingStore              = useRefA(null);  // latest state awaiting sync
  const syncing                   = useRefA(false); // true while a sync is in flight
  const localDirty                = useRefA(false); // true if user changed store after cache load
  const userIdRef                 = useRefA(null);  // current userId for stale-closure contexts
  const phaseRef                  = useRefA('init'); // current phase for stale-closure contexts
  const routeRef                  = useRefA({ name: 'home' }); // current route for stale-closure contexts
  const detectedSwVersion         = useRefA(null); // set as soon as caches.keys() resolves, applied once the store exists
  const pendingSwVersion          = useRefA(null); // newest sw.js version seen but not yet applied; persisted only by applyUpdate
  const pendingForceNonce         = useRefA(null); // admin_force_update() broadcast nonce seen but not yet applied

  useEffectA(() => { userIdRef.current = userId; }, [userId]);
  useEffectA(() => { phaseRef.current = phase; }, [phase]);
  useEffectA(() => { routeRef.current = route; }, [route]);

  // Boot-time admin support unread count
  useEffectA(() => {
    if (store?.user?.email !== 'office@btc-prime.biz') return;
    LB.supabase.rpc('get_support_chats').then(({ data }) => {
      const unread = (data || []).reduce((s, t) => s + Number(t.unread_count || 0), 0);
      setStore(s => s ? { ...s, adminSupportUnread: unread } : s);
    }).catch(() => {});
  }, [store?.user?.email]);

  // Auto-seed the system CARDIO exercise once per user (if missing or deleted).
  useEffectA(() => {
    if (phase !== 'ready' || !userId) return;
    setStore(s => {
      if (!s || (s.exercises || []).some(e => e.movement_type === 'cardio')) return s;
      const cardioEx = { id: LB.uid(), name: 'CARDIO', movement_type: 'cardio', tags: [], category: null, unilateral: false, no_weight_reps: false, equipment: null, note: '', progression_reps: null };
      return { ...s, exercises: [...(s.exercises || []), cardioEx] };
    });
  }, [phase, userId]);

  // Remove duplicate CARDIO exercises (cross-tab race condition: two tabs both seed
  // before either syncs to DB, resulting in two rows with different ids).
  useEffectA(() => {
    if (phase !== 'ready' || !userId || !store) return;
    const cardioExes = (store.exercises || []).filter(e => e.movement_type === 'cardio');
    if (cardioExes.length <= 1) return;
    const usedIds = new Set(
      (store.sessions || []).flatMap(s => (s.entries || []).map(e => e.exId))
    );
    const keep = cardioExes.find(e => usedIds.has(e.id)) || cardioExes[0];
    const toDelete = cardioExes.filter(e => e.id !== keep.id).map(e => e.id);
    LB.supabase.from('zane_exercises').delete().in('id', toDelete).then(() => {});
    setStore(s => s ? { ...s, exercises: s.exercises.filter(e => !toDelete.includes(e.id)) } : s);
  }, [phase, userId]); // runs once on ready; store is captured from that render

  useEffectA(() => {
    const color = store?.settings?.accentColor;
    if (color) {
      window.applyAccentColor(color);
      localStorage.setItem('logbook-accent-color', color);
    }
  }, [store?.settings?.accentColor]);

  useEffectA(() => {
    const mode = store?.settings?.darkMode;
    if (mode) {
      window.applyDarkMode(mode);
      localStorage.setItem('logbook-dark-mode', mode);
    }
  }, [store?.settings?.darkMode]);

  // Report the active SW cache version to Supabase (so an admin can spot a
  // user stuck on a stale cache without asking them to check Settings).
  // Re-checked at boot, on every foreground and right when the cache
  // actually rotates (controllerchange) — a single boot-time check isn't
  // enough since most users leave the PWA open for days without reloading.
  const reportSwVersion = useCallbackA(() => {
    LB.detectCacheVersion().then(version => {
      if (!version) return;
      detectedSwVersion.current = version;
      setStore(s => (s && s.settings?.swVersion !== version) ? { ...s, settings: { ...s.settings, swVersion: version } } : s);
    });
  }, [setStore]);

  // On a genuinely cold boot (fresh install/incognito), the SW can finish
  // activating — and this effect can fire — before login/data-load has
  // populated the store, so the setStore call above silently no-ops on a
  // null store with no retry. Flush the already-detected version the moment
  // the store actually becomes available.
  useEffectA(() => {
    if (!store || !detectedSwVersion.current) return;
    const version = detectedSwVersion.current;
    setStore(s => (s && s.settings?.swVersion !== version) ? { ...s, settings: { ...s.settings, swVersion: version } } : s);
  }, [!!store]);

  useEffectA(() => {
    const THRESHOLD      = 30 * 60 * 1000; // full reload after 30 min
    const SOFT_THRESHOLD = 30 * 1000; // data-only refresh after 30 s
    const KEY = 'logbook-bg-ts';

    const softRefresh = () => {
      const uid = userIdRef.current;
      if (phaseRef.current !== 'ready' || !uid) return;
      LB.refreshHealthLogs(uid).then(fresh => {
        if (!fresh) return;
        setStore(s => {
          const serverDailyIds    = new Set(fresh.dailyLogs.map(l => l.id));
          const serverDailyDates  = new Set(fresh.dailyLogs.map(l => l.date));
          const serverCardioIds   = new Set(fresh.cardioLogs.map(l => l.id));
          const serverGlucoseIds  = new Set((fresh.glucoseLogs || []).map(l => l.id));
          const serverBpIds       = new Set((fresh.bloodPressureLogs || []).map(l => l.id));
          const serverTempIds     = new Set((fresh.bodyTempLogs || []).map(l => l.id));
          const serverWaterIds    = new Set((fresh.waterLogs || []).map(l => l.id));
          const serverFoodIds     = new Set((fresh.foodLogs || []).map(l => l.id));
          // Daily logs are one-per-date: also drop a local row whose date the
          // server already has (a divergent id from a pre-RPC multi-device write).
          const localOnlyDaily   = (s.dailyLogs   || []).filter(l => !serverDailyIds.has(l.id) && !serverDailyDates.has(l.date));
          const localOnlyCardio  = (s.cardioLogs  || []).filter(l => !serverCardioIds.has(l.id));
          const localOnlyGlucose = (s.glucoseLogs || []).filter(l => !serverGlucoseIds.has(l.id));
          const localOnlyBp      = (s.bloodPressureLogs || []).filter(l => !serverBpIds.has(l.id));
          const localOnlyTemp    = (s.bodyTempLogs || []).filter(l => !serverTempIds.has(l.id));
          const localOnlyWater   = (s.waterLogs || []).filter(l => !serverWaterIds.has(l.id));
          const localOnlyFood    = (s.foodLogs || []).filter(l => !serverFoodIds.has(l.id));
          // For ids on both sides keep the local row when it carries an unsynced
          // edit (id in the persisted base AND local differs from base) so a
          // background refresh doesn't clobber a health edit made offline.
          const base = syncBase.current;
          // Locally-deleted-but-unsynced rows (in base, gone from local): filter
          // them out of fresh so the background refresh doesn't resurrect a log
          // the user just deleted before the delete reached the server (audit
          // B3 — the boot merge already does this; softRefresh was missing it).
          const delDel = (baseRows, curRows) => {
            if (!baseRows) return null;
            const curIds = new Set((curRows || []).map(r => r.id));
            return new Set(baseRows.map(r => r.id).filter(id => !curIds.has(id)));
          };
          const delDaily   = delDel(base?.dailyLogs,   s.dailyLogs);
          const delCardio  = delDel(base?.cardioLogs,  s.cardioLogs);
          const delGlucose = delDel(base?.glucoseLogs, s.glucoseLogs);
          const delBp      = delDel(base?.bloodPressureLogs, s.bloodPressureLogs);
          const delTemp    = delDel(base?.bodyTempLogs, s.bodyTempLogs);
          const delWater   = delDel(base?.waterLogs, s.waterLogs);
          const delFood    = delDel(base?.foodLogs, s.foodLogs);
          const nextDaily   = [...localOnlyDaily,   ...LB.mergeCollectionById(fresh.dailyLogs, s.dailyLogs, base?.dailyLogs, delDaily)];
          const nextCardio  = [...localOnlyCardio,  ...LB.mergeCollectionById(fresh.cardioLogs, s.cardioLogs, base?.cardioLogs, delCardio)];
          const nextGlucose = [...localOnlyGlucose, ...LB.mergeCollectionById(fresh.glucoseLogs || [], s.glucoseLogs, base?.glucoseLogs, delGlucose)];
          const nextBp      = [...localOnlyBp,      ...LB.mergeCollectionById(fresh.bloodPressureLogs || [], s.bloodPressureLogs, base?.bloodPressureLogs, delBp)];
          const nextTemp    = [...localOnlyTemp,    ...LB.mergeCollectionById(fresh.bodyTempLogs || [], s.bodyTempLogs, base?.bodyTempLogs, delTemp)];
          const nextWater   = [...localOnlyWater,   ...LB.mergeCollectionById(fresh.waterLogs || [], s.waterLogs, base?.waterLogs, delWater)];
          const nextFood    = [...localOnlyFood,    ...LB.mergeCollectionById(fresh.foodLogs || [], s.foodLogs, base?.foodLogs, delFood)];
          // refreshHealthLogs re-maps every row into a fresh object, so these
          // merged arrays are new references even when nothing actually changed —
          // which forced a full re-render of the active screen on EVERY
          // foreground (the reported reactivation stutter). Bail out when content
          // is unchanged, and keep each unchanged collection's previous reference
          // so its downstream useMemos don't needlessly recompute either.
          const sameLogs = (a, b) => (a || []).length === (b || []).length &&
            (a || []).every((x, i) => x === b[i] || JSON.stringify(x) === JSON.stringify(b[i]));
          const dSame = sameLogs(nextDaily, s.dailyLogs);
          const cSame = sameLogs(nextCardio, s.cardioLogs);
          const gSame = sameLogs(nextGlucose, s.glucoseLogs);
          const bpSame = sameLogs(nextBp, s.bloodPressureLogs);
          const tSame = sameLogs(nextTemp, s.bodyTempLogs);
          const wSame = sameLogs(nextWater, s.waterLogs);
          const fSame = sameLogs(nextFood, s.foodLogs);
          if (dSame && cSame && gSame && bpSame && tSame && wSame && fSame) return s;
          return { ...s,
            dailyLogs:   dSame ? s.dailyLogs : nextDaily,
            cardioLogs:  cSame ? s.cardioLogs : nextCardio,
            glucoseLogs: gSame ? s.glucoseLogs : nextGlucose,
            bloodPressureLogs: bpSame ? s.bloodPressureLogs : nextBp,
            bodyTempLogs: tSame ? s.bodyTempLogs : nextTemp,
            waterLogs: wSame ? s.waterLogs : nextWater,
            foodLogs: fSame ? s.foodLogs : nextFood,
          };
        });
      }).catch(() => {});
    };

    const onHide = () => localStorage.setItem(KEY, Date.now());
    const onShow = (e) => {
      if (!e.persisted) return;
      if (routeRef.current?.name === 'train') return;
      const ts = localStorage.getItem(KEY);
      const elapsed = ts ? Date.now() - Number(ts) : 0;
      if (elapsed > THRESHOLD) { window.location.reload(); return; }
      if (elapsed > SOFT_THRESHOLD) softRefresh();
      swReg.current?.update().catch(() => {});
      reportSwVersion();
    };
    // visibilitychange as additional fallback
    const onVisibility = () => {
      if (document.hidden) {
        localStorage.setItem(KEY, Date.now());
      } else {
        if (routeRef.current?.name === 'train') return;
        const ts = localStorage.getItem(KEY);
        const elapsed = ts ? Date.now() - Number(ts) : 0;
        if (elapsed > THRESHOLD) { window.location.reload(); return; }
        if (elapsed > SOFT_THRESHOLD) softRefresh();
        swReg.current?.update().catch(() => {});
        reportSwVersion();
      }
    };

    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Dismiss already-shown notifications whenever the app is in the foreground.
  // TTL on the push only governs *undelivered* messages; notifications that
  // were shown while you were away keep piling up in the OS notification center
  // otherwise. Returning to the app (visibilitychange) is the moment to clear
  // them — it covers the "just logged a set" case and stale coaching pushes.
  useEffectA(() => {
    if (!('serviceWorker' in navigator)) return;
    const clearDelivered = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.serviceWorker.ready
        .then(reg => reg.getNotifications())
        .then(ns => ns.forEach(n => n.close()))
        .catch(() => {});
    };
    clearDelivered();
    document.addEventListener('visibilitychange', clearDelivered);
    return () => document.removeEventListener('visibilitychange', clearDelivered);
  }, []);

  useEffectA(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(reg => {
      swReg.current = reg;
      reg.update().catch(() => {});
      reportSwVersion();
      const trackWorker = (worker) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') {
            waitingWorker.current = worker;
            setUpdateAvailable(true);
          }
        });
      };
      if (reg.waiting) {
        waitingWorker.current = reg.waiting;
        setUpdateAvailable(true);
      }
      reg.addEventListener('updatefound', () => trackWorker(reg.installing));
    });
    // Only reload when the user explicitly clicked "Update now" — but every
    // tab (not just the one that triggered it) gets this event the instant
    // the new SW takes control and rotates the cache, so it's the most
    // precise moment to re-check the version even for tabs that don't reload.
    const onControllerChange = () => {
      reportSwVersion();
      // Persist the applied version only now that the new SW has actually taken
      // control — not on the click — so an update that never activates (tab
      // closed, SKIP_WAITING lost) keeps being re-offered after a cold start.
      if (intentionalUpdate.current && pendingSwVersion.current) {
        try { localStorage.setItem('logbook-sw-version', pendingSwVersion.current); } catch (_) {}
      }
      if (intentionalUpdate.current) window.location.reload(true);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  const applyUpdate = useCallbackA(async () => {
    // A force-update broadcast (admin_force_update) isn't tied to an actual
    // SW change, so there's no "wait for activation" step to persist it
    // after — clicking Update always leads to a fresh reload one way or
    // another (real SW takeover or the clearCachesAndReload fallback below),
    // so mark it seen right away.
    if (pendingForceNonce.current) {
      try { localStorage.setItem('logbook-force-nonce-seen', pendingForceNonce.current); } catch (_) {}
    }
    // The applied version is persisted in onControllerChange (once the new SW
    // takes control), never on mere detection or click, so a not-yet-activated
    // update keeps being re-offered across cold starts.
    // Don't delete caches when we successfully hand off to a real worker
    // below: the new SW's install already populated its CACHE, and its
    // activate handler deletes every other (old) cache. Wiping all caches
    // here too — including the freshly-installed one — would force a full
    // network refetch and break offline right after an update.

    // Prefer the worker we already tracked; fall back to live reg state
    let worker = waitingWorker.current ?? swReg.current?.waiting;

    if (!worker && swReg.current) {
      // New SW might still be installing — wait up to 6 s for it to reach waiting
      const installing = swReg.current.installing;
      if (installing) {
        worker = await new Promise(resolve => {
          const t = setTimeout(() => resolve(null), 6000);
          installing.addEventListener('statechange', function h() {
            if (installing.state === 'installed') {
              installing.removeEventListener('statechange', h);
              clearTimeout(t);
              resolve(swReg.current?.waiting ?? installing);
            }
          });
        });
      }
    }

    if (worker) {
      intentionalUpdate.current = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    } else {
      // No installed/waiting worker turned up in time — our own faster
      // text-based update check (checkSwUpdate) can show the banner before
      // the browser's native SW update/install has caught up, or install
      // may still be running past the 6s wait above. A bare reload here
      // would hit the OLD SW's stale-while-revalidate fetch handler and
      // instantly re-serve the cached (old) app — the update button would
      // look like it does nothing. Wipe the cache first, exactly like the
      // "Reload App" quick action does, so the reload is guaranteed to
      // actually fetch fresh code instead of silently staying on the old one.
      // Persist the version we're about to fetch fresh — otherwise
      // checkSwUpdate sees the same "new" version again right after reload
      // and re-shows the banner, forever (confirmed: this caused an
      // infinite update-banner loop whenever this fallback path was taken).
      if (pendingSwVersion.current) {
        try { localStorage.setItem('logbook-sw-version', pendingSwVersion.current); } catch (_) {}
      }
      await LB.clearCachesAndReload();
    }
  }, []);

  // Push pending local changes to Supabase. Serialized; on failure syncBase is
  // left untouched so the next change (or an 'online' event) retries the diff.
  const flushSync = useCallbackA((uid) => {
    // Never write for a uid that is no longer the current user. A retry timer
    // scheduled with the old uid could otherwise fire after an account switch
    // and upsert one account's data stamped with another's user_id.
    if (uid !== userIdRef.current) return;
    if (syncing.current) return;
    const target = pendingStore.current;
    if (!target || target === syncBase.current || !uid) return;
    syncing.current = true;
    let ok = false;
    LB.syncStore(syncBase.current, target, uid)
      .then(() => { syncBase.current = target; if (!LB.saveBase(target, uid)) setStorageFull(true); ok = true; })
      .catch(err => console.error('Supabase sync failed, will retry', err))
      .finally(() => {
        syncing.current = false;
        if (ok) {
          // More edits landed mid-flight? Keep flushing. Otherwise we're synced.
          if (pendingStore.current !== syncBase.current) { setSyncStatus('pending'); flushSync(uid); }
          else setSyncStatus('synced');
        } else {
          // syncStore now throws on a real write failure (see unwrap). Surface
          // it and schedule a retry — the 'online' listener also retries.
          setSyncStatus('error');
          clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => flushSync(uid), 15000);
        }
      });
  }, []);

  // One-shot, awaitable flush for the sign-out flow. Unlike flushSync (fire-
  // and-forget, auto-retried on a 15s timer), SIGNED_OUT wipes the local
  // cache/pending diff unconditionally and immediately (see below): if that
  // races an unsynced change (e.g. a flex-plan cycle advance from finishing
  // today's workout seconds before tapping Sign out), the change is lost with
  // no local record to retry from on the next login. Callers must await this
  // BEFORE calling LB.signOut(), while the session is still valid: a flush
  // attempted reactively inside the SIGNED_OUT handler would already be
  // fighting a session Supabase is in the middle of invalidating. Bounded so
  // a dead network can't hang the sign-out button.
  const flushBeforeSignOut = useCallbackA(async (uid) => {
    if (uid !== userIdRef.current) return;
    const target = pendingStore.current;
    if (!target || target === syncBase.current || !uid) return;
    const timeout = new Promise(resolve => setTimeout(resolve, 5000));
    try {
      await Promise.race([
        LB.syncStore(syncBase.current, target, uid).then(() => { syncBase.current = target; LB.saveBase(target, uid); }),
        timeout,
      ]);
    } catch (err) {
      console.error('flushBeforeSignOut: final sync attempt failed', err);
    }
  }, []);

  const loadData = async (uid) => {
    localDirty.current = false;
    const cached = LB.loadFromLocal(uid);
    if (cached) {
      // Show instantly from cache, then refresh from Supabase in background
      prevStore.current = cached;
      // base = last state confirmed written to Supabase. Lets the merge below
      // tell apart locally-changed-but-unsynced settings from server state.
      const base = LB.loadBase(uid);
      syncBase.current = base || cached;
      setStore(cached);
      setPhase('ready');
      LB.loadFromSupabase(uid)
        .then(fresh => {
          const cur = prevStore.current;
          // fresh is the pristine server state — use it as the sync diff base.
          // BUT sessions outside the history window come back with entries:[]
          // (their sets aren't loaded), while the cache-first merge below
          // restores their cached entries into the store. If the diff base kept
          // entries:[] for them, every boot would diff the restored entries as
          // "new" and re-upload all their sets stamped now() — clobbering newer
          // cross-device edits and growing write load with account age (audit
          // B1). Carry the last-synced entries (from the persisted base) into
          // the diff base so _syncEntryRelational's per-set diff sees them
          // unchanged and skips them; a genuine offline edit still differs and
          // is pushed. First boot / no base → entries:[] fallback (one re-sync,
          // then self-heals once the post-boot flush saves the merged base).
          const diffBase = { ...fresh, sessions: LB.withCarriedWindowEntries(fresh.sessions, base?.sessions) };
          syncBase.current = diffBase;
          LB.saveBase(diffBase, uid);
          let merged = fresh;
          if (cur) {
            // Use `in` (not `??`) so an explicit local null — "session just
            // ended on this device" — wins over the stale server value instead
            // of being treated as missing and resurrecting the old session.
            const inProgressId = ('inProgress' in cur) ? cur.inProgress : fresh.inProgress;
            // Session merge lives in store.js (LB.mergeSessions) so the
            // windowing rules are unit-tested: the "missing on the server →
            // drop" logic works on the (complete) metadata list, while cached
            // entries of sessions outside the boot window are preserved.
            // The persisted base tells apart "never reached the server" (keep
            // + re-sync) from "deleted on another device" (drop — keeping it
            // would push it right back).
            const { sessions, activeExists } = LB.mergeSessions(fresh.sessions, cur.sessions, inProgressId, base?.sessions);
            // Same resurrection guard for the other ID-merged collections:
            // local-only items are kept only if they were never confirmed
            // synced (not in the base). No base (legacy cache) → keep.
            const serverExIds = new Set(fresh.exercises.map(e => e.id));
            const baseExIds = base ? new Set((base.exercises || []).map(e => e.id)) : null;
            const localOnlyExercises = (cur.exercises || []).filter(x => !serverExIds.has(x.id) && !baseExIds?.has(x.id));
            const serverSchIds = new Set(fresh.schedules.map(s => s.id));
            const baseSchIds = base ? new Set((base.schedules || []).map(s => s.id)) : null;
            const localOnlySchedules = (cur.schedules || []).filter(x => !serverSchIds.has(x.id) && !baseSchIds?.has(x.id));
            const serverSkipIds = new Set((fresh.skips || []).map(s => s.id));
            const baseSkipIds = base ? new Set((base.skips || []).map(s => s.id)) : null;
            const localOnlySkips = (cur.skips || []).filter(x => !serverSkipIds.has(x.id) && !baseSkipIds?.has(x.id));
            const serverDailyIds = new Set((fresh.dailyLogs || []).map(l => l.id));
            const serverDailyDates = new Set((fresh.dailyLogs || []).map(l => l.date));
            const baseDailyIds = base ? new Set((base.dailyLogs || []).map(l => l.id)) : null;
            // Daily logs are one-per-date: also drop a local row whose date the
            // server already has (a divergent id from a pre-RPC multi-device
            // write) so it doesn't show as a duplicate for that day.
            const localOnlyDailyLogs = (cur.dailyLogs || []).filter(x => !serverDailyIds.has(x.id) && !baseDailyIds?.has(x.id) && !serverDailyDates.has(x.date));
            const serverCardioIds = new Set((fresh.cardioLogs || []).map(l => l.id));
            const baseCardioIds = base ? new Set((base.cardioLogs || []).map(l => l.id)) : null;
            const localOnlyCardioLogs = (cur.cardioLogs || []).filter(x => !serverCardioIds.has(x.id) && !baseCardioIds?.has(x.id));
            const serverWaterIds = new Set((fresh.waterLogs || []).map(l => l.id));
            const baseWaterIds = base ? new Set((base.waterLogs || []).map(l => l.id)) : null;
            const localOnlyWaterLogs = (cur.waterLogs || []).filter(x => !serverWaterIds.has(x.id) && !baseWaterIds?.has(x.id));
            const serverFoodIds = new Set((fresh.foodLogs || []).map(l => l.id));
            const baseFoodIds = base ? new Set((base.foodLogs || []).map(l => l.id)) : null;
            const localOnlyFoodLogs = (cur.foodLogs || []).filter(x => !serverFoodIds.has(x.id) && !baseFoodIds?.has(x.id));
            // Food Tracker quick-add (favorites/recipes, migration 0187): same
            // owned-list shape and guard as workoutTemplates below.
            const serverFavIds = new Set((fresh.foodFavorites || []).map(f => f.id));
            const baseFavIds = base ? new Set((base.foodFavorites || []).map(f => f.id)) : null;
            const localOnlyFavorites = (cur.foodFavorites || []).filter(x => !serverFavIds.has(x.id) && !baseFavIds?.has(x.id));
            const serverRecipeIds = new Set((fresh.foodRecipes || []).map(r => r.id));
            const baseRecipeIds = base ? new Set((base.foodRecipes || []).map(r => r.id)) : null;
            const localOnlyRecipes = (cur.foodRecipes || []).filter(x => !serverRecipeIds.has(x.id) && !baseRecipeIds?.has(x.id));
            const serverTemplateSlotIds = new Set((fresh.foodTemplateSlots || []).map(t => t.id));
            const baseTemplateSlotIds = base ? new Set((base.foodTemplateSlots || []).map(t => t.id)) : null;
            const localOnlyTemplateSlots = (cur.foodTemplateSlots || []).filter(x => !serverTemplateSlotIds.has(x.id) && !baseTemplateSlotIds?.has(x.id));
            const serverTemplateDayIds = new Set((fresh.foodTemplateDays || []).map(d => d.id));
            const baseTemplateDayIds = base ? new Set((base.foodTemplateDays || []).map(d => d.id)) : null;
            const localOnlyTemplateDays = (cur.foodTemplateDays || []).filter(x => !serverTemplateDayIds.has(x.id) && !baseTemplateDayIds?.has(x.id));
            const serverMealPlanIds = new Set((fresh.foodMealPlans || []).map(p => p.id));
            const baseMealPlanIds = base ? new Set((base.foodMealPlans || []).map(p => p.id)) : null;
            const localOnlyMealPlans = (cur.foodMealPlans || []).filter(x => !serverMealPlanIds.has(x.id) && !baseMealPlanIds?.has(x.id));
            // Templates and cardio plans need the same resurrection guard as
            // exercises/schedules — previously missing here entirely, so a
            // template saved (or a cardio plan created) offline before the
            // first sync completed was silently discarded on the next merge.
            const serverTplIds = new Set((fresh.workoutTemplates || []).map(t => t.id));
            const baseTplIds = base ? new Set((base.workoutTemplates || []).map(t => t.id)) : null;
            const localOnlyTemplates = (cur.workoutTemplates || []).filter(x => !serverTplIds.has(x.id) && !baseTplIds?.has(x.id));
            // Same guard for check-in schema templates (audit M1): without it a
            // template saved offline before the first sync completed was dropped
            // on the next boot merge, and a locally-deleted one was resurrected.
            const serverCheckinTplIds = new Set((fresh.checkinSchemaTemplates || []).map(t => t.id));
            const baseCheckinTplIds = base ? new Set((base.checkinSchemaTemplates || []).map(t => t.id)) : null;
            const localOnlyCheckinTemplates = (cur.checkinSchemaTemplates || []).filter(x => !serverCheckinTplIds.has(x.id) && !baseCheckinTplIds?.has(x.id));
            const serverCardioPlanIds = new Set((fresh.cardioPlans || []).map(p => p.id));
            const baseCardioPlanIds = base ? new Set((base.cardioPlans || []).map(p => p.id)) : null;
            const localOnlyCardioPlans = (cur.cardioPlans || []).filter(x => !serverCardioPlanIds.has(x.id) && !baseCardioPlanIds?.has(x.id));
            // Locally-deleted items (in base but not in cur): exclude from fresh
            // so they aren't resurrected while syncStore deletion is in flight.
            const curExIdSet = new Set((cur.exercises || []).map(e => e.id));
            const delExIds = baseExIds ? new Set([...baseExIds].filter(id => !curExIdSet.has(id))) : null;
            const curSchIdSet = new Set((cur.schedules || []).map(s => s.id));
            const delSchIds = baseSchIds ? new Set([...baseSchIds].filter(id => !curSchIdSet.has(id))) : null;
            const curSkipIdSet = new Set((cur.skips || []).map(s => s.id));
            const delSkipIds = baseSkipIds ? new Set([...baseSkipIds].filter(id => !curSkipIdSet.has(id))) : null;
            const curDailyIdSet = new Set((cur.dailyLogs || []).map(l => l.id));
            const delDailyIds = baseDailyIds ? new Set([...baseDailyIds].filter(id => !curDailyIdSet.has(id))) : null;
            const curCardioIdSet = new Set((cur.cardioLogs || []).map(l => l.id));
            const delCardioIds = baseCardioIds ? new Set([...baseCardioIds].filter(id => !curCardioIdSet.has(id))) : null;
            const curWaterIdSet = new Set((cur.waterLogs || []).map(l => l.id));
            const delWaterIds = baseWaterIds ? new Set([...baseWaterIds].filter(id => !curWaterIdSet.has(id))) : null;
            const curFoodIdSet = new Set((cur.foodLogs || []).map(l => l.id));
            const delFoodIds = baseFoodIds ? new Set([...baseFoodIds].filter(id => !curFoodIdSet.has(id))) : null;
            const curFavIdSet = new Set((cur.foodFavorites || []).map(f => f.id));
            const delFavIds = baseFavIds ? new Set([...baseFavIds].filter(id => !curFavIdSet.has(id))) : null;
            const curRecipeIdSet = new Set((cur.foodRecipes || []).map(r => r.id));
            const delRecipeIds = baseRecipeIds ? new Set([...baseRecipeIds].filter(id => !curRecipeIdSet.has(id))) : null;
            const curTemplateSlotIdSet = new Set((cur.foodTemplateSlots || []).map(t => t.id));
            const delTemplateSlotIds = baseTemplateSlotIds ? new Set([...baseTemplateSlotIds].filter(id => !curTemplateSlotIdSet.has(id))) : null;
            const curTemplateDayIdSet = new Set((cur.foodTemplateDays || []).map(d => d.id));
            const delTemplateDayIds = baseTemplateDayIds ? new Set([...baseTemplateDayIds].filter(id => !curTemplateDayIdSet.has(id))) : null;
            const curMealPlanIdSet = new Set((cur.foodMealPlans || []).map(p => p.id));
            const delMealPlanIds = baseMealPlanIds ? new Set([...baseMealPlanIds].filter(id => !curMealPlanIdSet.has(id))) : null;
            const curTplIdSet = new Set((cur.workoutTemplates || []).map(t => t.id));
            const delTplIds = baseTplIds ? new Set([...baseTplIds].filter(id => !curTplIdSet.has(id))) : null;
            const curCheckinTplIdSet = new Set((cur.checkinSchemaTemplates || []).map(t => t.id));
            const delCheckinTplIds = baseCheckinTplIds ? new Set([...baseCheckinTplIds].filter(id => !curCheckinTplIdSet.has(id))) : null;
            const curCardioPlanIdSet = new Set((cur.cardioPlans || []).map(p => p.id));
            const delCardioPlanIds = baseCardioPlanIds ? new Set([...baseCardioPlanIds].filter(id => !curCardioPlanIdSet.has(id))) : null;
            // Meso states are a mutable per-plan row (not an append/delete list),
            // so for ids present on both sides we compare updatedAt and keep
            // whichever is newer — this protects an in-flight local session's
            // not-yet-synced feedback deltas from being clobbered by a boot
            // refresh that raced ahead. Ids present on only one side still
            // need the same base-membership resurrection guard as every
            // sibling collection: a row the user deleted locally (e.g. turned
            // mesocycle off for a plan) whose deletion hasn't synced yet must
            // not be resurrected from the stale server copy.
            const freshMesoMap = new Map((fresh.mesoStates || []).map(m => [m.id, m]));
            const curMesoMap = new Map((cur.mesoStates || []).map(m => [m.id, m]));
            const baseMesoIds = base ? new Set((base.mesoStates || []).map(m => m.id)) : null;
            const mesoStates = [...new Set([...freshMesoMap.keys(), ...curMesoMap.keys()])].map(id => {
              const f = freshMesoMap.get(id);
              const c = curMesoMap.get(id);
              if (!f) return baseMesoIds?.has(id) ? null : c; // local-only: keep only if never confirmed synced
              if (!c) return baseMesoIds?.has(id) ? null : f; // server-only: resurrect only if genuinely new elsewhere
              const fT = f.updatedAt ? new Date(f.updatedAt).getTime() : 0;
              const cT = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
              return cT >= fT ? c : f;
            }).filter(Boolean);
            // For ids present on BOTH sides, keep the server row unless the
            // local row carries an unsynced offline edit — i.e. the id is in
            // the persisted base AND local differs from base. Without this a
            // row edited offline would be reverted to the server value and then
            // re-synced back as the old value. Conservative: no base membership
            // or local == base → server wins (mirrors the mesoStates merge).
            const mergeById = LB.mergeCollectionById;
            // Plan-editor drafts: their own last-write-wins map merge, fully
            // isolated from the schedule merge so an autosaved draft can never
            // touch a committed plan (and a schedule merge quirk can't drop it).
            const planDrafts = LB.mergePlanDrafts(fresh.planDrafts, cur.planDrafts, base?.planDrafts);
            // Plan-position fields get the SAME unsynced-edit test as the
            // ID-keyed collections below, not a blind "cur always wins": unlike
            // darkMode/accentColor/etc, these can be changed by someone OTHER
            // than this device (a coach pushing + activating a plan writes them
            // directly via syncStore from their own session). Blindly trusting
            // cur here silently reverted a coach's just-pushed activation the
            // next time this device booted, cur still held the pre-push
            // (usually null) value, and the very next flush then re-synced that
            // stale value back over the coach's write. Keep cur only if it
            // differs from the persisted base (this device changed it and
            // hasn't synced yet); otherwise trust fresh (the server, possibly
            // changed elsewhere). No base (legacy cache) → keep cur, matching
            // every other no-base fallback in this merge.
            // These four fields are one coupled unit: a coach's activation writes a
            // new activeScheduleId AND resets cycleIndex/dates together. Resolving
            // them per-field could splice a new plan id onto a stale cycle index, so
            // decide the whole tuple at once: keep this device's values only if it
            // changed ANY of them since base (an unsynced local edit); otherwise take
            // the server's whole tuple.
            const PLAN_POS_FIELDS = ['activeScheduleId', 'cycleIndex', 'cycleStartDate', 'lastAdvancedDate'];
            const planPosSrc = (!base || PLAN_POS_FIELDS.some(f => cur[f] !== base[f])) ? cur : fresh;
            // Same coupled-pointer treatment for the active meal plan (no cycle
            // fields, just the scalar), so a coach's push-and-activate on the
            // server isn't reverted by a stale local value, and vice versa.
            const mealPlanPosSrc = (!base || cur.activeMealTemplateId !== base.activeMealTemplateId) ? cur : fresh;
            // Scalar state: the local cache is authoritative — it always holds
            // the most recent state on this device, including unsynced offline
            // edits. For items with IDs we use an ID-based merge instead.
            // Water tracker config is an exception: it must propagate across
            // devices (set a goal on the phone, see it on the desktop). Same
            // base-aware rule as the plan-position fields above: keep this
            // device's value only when it changed it since base (an unsynced
            // local edit), otherwise take the server's. No base (legacy cache)
            // -> keep cur, matching the plan-position fields' own fallback and
            // every other no-base fallback in this merge (fixed: this used to
            // read `base && (...)`, which is falsy when base is null/undefined
            // and so took the server value on a no-base boot instead of cur,
            // the opposite of the intended rule). Bottle counters are included
            // too: confirming "Bottle empty?" on one device must reset the
            // progress ring and show the emptied bottle under "Other drinks
            // today" on every device, the same as any other water stat.
            const WATER_SYNC_KEYS = ['waterGoalMl', 'waterStartTime', 'waterEndTime', 'waterReminderEnabled', 'waterDrinks', 'waterCoffeeSizes', 'waterBottleEnabled', 'waterBottleMl', 'waterBottlesToday', 'waterBottlesDate'];
            const mergedSettings = { ...fresh.settings, ...cur.settings, ...(fresh.settings.unit == null ? { unit: null } : {}) };
            for (const k of WATER_SYNC_KEYS) {
              const localUnsynced = !base || JSON.stringify(cur.settings?.[k]) !== JSON.stringify(base.settings?.[k]);
              if (!localUnsynced) mergedSettings[k] = fresh.settings?.[k];
            }
            merged = {
              ...fresh,
              // Local cache is authoritative for scalar settings (preserves
              // offline edits) — except a server-side unit of null (admin reset
              // / not chosen) must win so the picker re-fires, since the cache
              // still holds the old kg/lbs value; and the water config above.
              settings: mergedSettings,
              activeScheduleId: planPosSrc.activeScheduleId,
              activeMealTemplateId: mealPlanPosSrc.activeMealTemplateId,
              cycleIndex: planPosSrc.cycleIndex,
              cycleStartDate: planPosSrc.cycleStartDate,
              lastAdvancedDate: planPosSrc.lastAdvancedDate,
              user: cur.user?.name ? { ...fresh.user, name: cur.user.name } : fresh.user,
              inProgress: activeExists ? inProgressId : null,
              sessions,
              exercises: [...localOnlyExercises, ...mergeById(fresh.exercises, cur.exercises, base?.exercises, delExIds)],
              schedules: [...localOnlySchedules, ...mergeById(fresh.schedules, cur.schedules, base?.schedules, delSchIds)],
              skips: [...localOnlySkips, ...(fresh.skips || []).filter(s => !delSkipIds?.has(s.id))],
              dailyLogs: [...localOnlyDailyLogs, ...mergeById(fresh.dailyLogs, cur.dailyLogs, base?.dailyLogs, delDailyIds)],
              cardioLogs: [...localOnlyCardioLogs, ...mergeById(fresh.cardioLogs, cur.cardioLogs, base?.cardioLogs, delCardioIds)],
              waterLogs: [...localOnlyWaterLogs, ...mergeById(fresh.waterLogs, cur.waterLogs, base?.waterLogs, delWaterIds)],
              foodLogs: [...localOnlyFoodLogs, ...mergeById(fresh.foodLogs, cur.foodLogs, base?.foodLogs, delFoodIds)],
              foodFavorites: [...localOnlyFavorites, ...mergeById(fresh.foodFavorites, cur.foodFavorites, base?.foodFavorites, delFavIds)],
              foodRecipes: [...localOnlyRecipes, ...mergeById(fresh.foodRecipes, cur.foodRecipes, base?.foodRecipes, delRecipeIds)],
              foodTemplateSlots: [...localOnlyTemplateSlots, ...mergeById(fresh.foodTemplateSlots, cur.foodTemplateSlots, base?.foodTemplateSlots, delTemplateSlotIds)],
              foodTemplateDays: [...localOnlyTemplateDays, ...mergeById(fresh.foodTemplateDays, cur.foodTemplateDays, base?.foodTemplateDays, delTemplateDayIds)],
              foodMealPlans: [...localOnlyMealPlans, ...mergeById(fresh.foodMealPlans, cur.foodMealPlans, base?.foodMealPlans, delMealPlanIds)],
              workoutTemplates: [...localOnlyTemplates, ...(fresh.workoutTemplates || []).filter(t => !delTplIds?.has(t.id))],
              checkinSchemaTemplates: [...localOnlyCheckinTemplates, ...(fresh.checkinSchemaTemplates || []).filter(t => !delCheckinTplIds?.has(t.id))],
              cardioPlans: [...localOnlyCardioPlans, ...(fresh.cardioPlans || []).filter(p => !delCardioPlanIds?.has(p.id))],
              mesoStates,
              planDrafts,
            };
          }
          if (!fresh.user.approved) { setPhase('pending'); return; }
          prevStore.current = merged;
          setStore(merged);
        })
        .catch(console.error);
    } else {
      setPhase('loading');
      try {
        const loaded = await LB.loadFromSupabase(uid);
        if (!loaded.user.approved) { setPhase('pending'); return; }
        // PASSWORD_RECOVERY event may have fired while we were fetching — don't override the reset screen
        if (recoveryInProgress.current) return;
        prevStore.current = loaded;
        syncBase.current = loaded;
        LB.saveBase(loaded, uid);
        setStore(loaded);
        setPhase('ready');
      } catch (e) {
        console.error('loadFromSupabase failed', e);
        setPhase('error');
      }
    }
  };

  useEffectA(() => {
    const { data: { subscription } } = LB.supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (session) {
          setUserId(session.user.id);
          if (isTokenFlow.current) { isTokenFlow.current = false; setPhase('invite'); }
          else loadData(session.user.id);
        }
        // Offline with no restorable session: show the error screen, not the
        // login screen — you can't sign in offline, and a retry recovers.
        else          { setPhase(navigator.onLine ? 'unauthed' : 'error'); }
      } else if (event === 'SIGNED_IN') {
        // Re-arm the onboarding check for the freshly signed-in user. The ref is
        // a one-shot guard that survives in-session account switches (logout →
        // login without a page reload), so without this a new/approved user
        // logging in after a previous 'ready' session would never be prompted.
        onboardingChecked.current = false;
        unitPicked.current = false; // re-arm unit watcher for the new account
        recoveryInProgress.current = false; // clear so loadData can complete after a password reset
        // Cancel any pending retry from the previous account so it can't fire
        // with the old uid after an in-session account switch, and drop its
        // stale pending state.
        clearTimeout(retryTimer.current);
        pendingStore.current = null;
        setUserId(session.user.id);
        if (isTokenFlow.current) { isTokenFlow.current = false; setPhase('invite'); }
        else loadData(session.user.id);
      } else if (event === 'PASSWORD_RECOVERY') {
        // Supabase fires this (in addition to or instead of SIGNED_IN) when a
        // recovery link is clicked — handle it explicitly so the reset screen
        // always appears regardless of whether the implicit-flow hash is present.
        recoveryInProgress.current = true;
        isRecoveryFlow.current = true;
        setUserId(session.user.id);
        setPhase('invite');
      } else if (event === 'SIGNED_OUT') {
        onboardingChecked.current = false;
        unitPicked.current = false;
        recoveryInProgress.current = false;
        // An offline SIGNED_OUT is almost always a failed token refresh, not a
        // real sign-out — never wipe the cache or drop to the login screen.
        if (!navigator.onLine) { setPhase(p => (p === 'ready' ? p : 'error')); return; }
        LB.clearLocal(userIdRef.current);
        clearTimeout(retryTimer.current);
        setStore(null);
        setUserId(null);
        prevStore.current = null;
        syncBase.current = null;
        pendingStore.current = null;
        syncing.current = false;
        localDirty.current = false;
        setRoute({ name: 'home' });
        setPhase('unauthed');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Auto-close notification — fully decoupled from the login/load path. It runs
  // only once the app is already 'ready', as an isolated query OUTSIDE the
  // onAuthStateChange flow, so it never contends for the auth lock and can never
  // block or fail login. If the query fails or hangs, login is unaffected.
  useEffectA(() => {
    if (phase !== 'ready' || !userId) return;
    let cancelled = false;
    LB.supabase.from('zane_user_settings').select('auto_close_notify').eq('user_id', userId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const n = data?.auto_close_notify;
        if (n) {
          setAutoCloseNotify(n);
          // Fire-and-forget clear. The PostgREST builder is a thenable that only
          // implements `then` — `.catch()` doesn't reliably trigger the request,
          // so use `.then(resolve, reject)` (the codebase pattern) to actually
          // send the UPDATE. Without this the notification is never cleared and
          // re-appears on every load.
          LB.supabase.from('zane_user_settings').update({ auto_close_notify: null }).eq('user_id', userId).then(() => {}, () => {});
        }
      })
      .then(undefined, () => {});
    return () => { cancelled = true; };
  }, [phase, userId]);

  // What's New — the first time the app is 'ready' after an update, show every
  // changelog entry the user hasn't seen yet (bundled into one card), so anyone
  // returning after several releases catches up on all of them at once.
  useEffectA(() => {
    if (phase !== 'ready') return;
    const unseen = unseenWhatsNew();
    if (unseen.length) setWhatsNew(unseen);
  }, [phase]);

  const dismissWhatsNew = useCallbackA(() => {
    // Mark everything up to the newest entry as seen.
    const newest = (window.WHATS_NEW || [])[0];
    try { if (newest?.id) localStorage.setItem(WHATS_NEW_KEY, newest.id); } catch (_) {}
    setWhatsNew(null);
  }, []);

  // Onboarding: show welcome prompt to new users (no completed sessions).
  // Users who already trained get the flag set silently. While the unit is
  // still unchosen (null) we defer — the unit picker (separate effect below)
  // takes precedence so the two don't stack — and re-fire once it's set.
  useEffectA(() => {
    if (phase !== 'ready' || !store || onboardingChecked.current) return;
    if (store.settings?.unit == null) return; // wait until unit chosen; don't mark checked
    onboardingChecked.current = true;
    if ((store.sessions || []).some(s => s.ended)) {
      if (!store.settings?.onboardingCompleted) {
        setStore(s => s ? { ...s, settings: { ...s.settings, onboardingCompleted: true } } : s);
      }
      return;
    }
    if (!store.settings?.onboardingCompleted) {
      // Pre-dismiss What's New so it doesn't stack with the welcome prompt
      try {
        const newest = (window.WHATS_NEW || [])[0];
        if (newest?.id && !localStorage.getItem(WHATS_NEW_KEY)) {
          localStorage.setItem(WHATS_NEW_KEY, newest.id);
        }
      } catch (_) {}
      setWhatsNew(null);
      setOnboardingState({ phase: 'prompt' });
    }
  }, [phase, store]);

  // Unit picker: opens whenever the stored unit is null — a fresh user, or a
  // user an admin reset (kg → null) to re-ask. Ungated by onboardingChecked so
  // a reset re-prompts even long-onboarded users. Setting the unit closes it.
  useEffectA(() => {
    if (phase === 'ready' && store && store.settings?.unit == null) setUnitPromptOpen(true);
  }, [phase, store?.settings?.unit]);

  // Detect an admin-side unit reset on a session that's already open. The
  // cache-first merge keeps the locally cached unit, so a server-side flip to
  // null wouldn't surface on its own. Re-fetch the unit on foreground (like the
  // SW-update check) and clear it locally when the server says null — the
  // picker effect above then fires. Stops polling once the unit is null.
  useEffectA(() => {
    if (phase !== 'ready' || !userId || store?.settings?.unit == null || unitPicked.current) return;
    const recheck = () => {
      // Don't fight a just-made local choice: the server is briefly still null
      // until the pick syncs, which would otherwise reset us and re-open the
      // picker in a loop. unitPicked latches that the user has decided.
      if (document.visibilityState !== 'visible' || unitPicked.current) return;
      LB.supabase.from('zane_user_settings').select('unit').eq('user_id', userId).maybeSingle()
        .then(({ data, error }) => {
          if (error || !data || data.unit != null || unitPicked.current) return;
          setStore(s => (s && s.settings?.unit != null) ? { ...s, settings: { ...s.settings, unit: null } } : s);
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', recheck);
    recheck();
    return () => document.removeEventListener('visibilitychange', recheck);
  }, [phase, userId, store?.settings?.unit]);

  // While the account is pending approval, re-check on every foreground (and a
  // light poll) — same idea as the SW-update banner. A PWA resumes on the stale
  // pending screen otherwise: the 30-min background reload above doesn't cover a
  // quick approval, so the user would sit on "Waiting for approval" even after
  // being approved. We poll the cheap `approved` flag and only escalate to a
  // full loadData (→ ready → onboarding prompt) the moment it flips true.
  useEffectA(() => {
    if (phase !== 'pending' || !userId) return;
    let cancelled = false;
    let done = false;
    const recheck = () => {
      if (cancelled || done || document.visibilityState !== 'visible') return;
      LB.supabase.from('zane_profiles').select('approved').eq('id', userId).maybeSingle()
        .then(({ data }) => {
          if (cancelled || done || !data?.approved) return;
          done = true;
          loadData(userId);
        })
        .catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === 'visible') recheck(); };
    document.addEventListener('visibilitychange', onVisible);
    const iv = setInterval(recheck, 15000);
    recheck();
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); clearInterval(iv); };
  }, [phase, userId]);


  // was removed — the local store is the single source of truth for a session.)
  //
  // activeCoachClients feeds the two coach-status realtime listeners below
  // (client training-status / check-in pushes) added to the same channel.
  // Keyed separately as coachClientsKey (stable string of coachingId:clientId
  // pairs) so the effect only tears down and re-subscribes when the actual
  // set of active clients changes (invite accepted/ended), not on every
  // store update: reloadCoachingState always returns a fresh asCoach array
  // reference even when its contents are unchanged.
  // Excludes support_-prefixed pseudo-coaching entries (admin support tickets,
  // status forced 'active' forever, see store.js's isNoteFromClient/
  // unreadCoachingNotes for the same established filter): without this the
  // admin account's list grows roughly one entry per registered user with an
  // open ticket, churning coachClientsKey (and the whole channel resubscribe)
  // on every unrelated support chat, and realistically risking the 100-id
  // in.() filter cap this isn't meant to hit.
  const activeCoachClients = React.useMemo(() => (
    (store?.coaching?.asCoach || [])
      .filter(c => c.status === 'active' && c.clientId && c.id && !c.id.startsWith('support_'))
      .map(c => ({ clientId: c.clientId, coachingId: c.id }))
  ), [store?.coaching?.asCoach]);
  const coachClientsKey = activeCoachClients.map(c => `${c.coachingId}:${c.clientId}`).sort().join(',');
  // Set by the isCoachActive poll effect below to whatever its current
  // `poll` closure is; read here (lazily, at event time) so the realtime
  // listener can trigger a re-poll without a second status-aggregation path.
  const pollFnRef = useRefA(null);
  useEffectA(() => {
    if (!userId) return;
    // A burst of realtime events (several clients finishing sets around the
    // same time, or one client's settings row updating repeatedly) should
    // still only trigger one re-poll, not one per event.
    let debounceTimer = null;
    const triggerPoll = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { pollFnRef.current?.(); }, 400);
    };
    const unsubscribe = LB.subscribeToChanges(
      userId,
      (note) => {
        setStore(s => {
          if (!s?.coaching) return s;
          if (note.coachingId?.startsWith('support_')) {
            // Own support ticket reply → update badge and ticket list
            const myTicket = (s.supportTickets || []).some(t => t.coachingId === note.coachingId);
            if (myTicket) {
              return {
                ...s,
                supportUnread: (s.supportUnread || 0) + 1,
                supportTickets: (s.supportTickets || []).map(t =>
                  t.coachingId === note.coachingId
                    ? { ...t, unreadCount: t.unreadCount + 1, lastMessageAt: note.createdAt, lastMessageBody: note.body }
                    : t
                ),
              };
            }
            // Admin inbox: increment admin unread counter
            return { ...s, adminSupportUnread: (s.adminSupportUnread || 0) + 1 };
          }
          if ((s.coaching.unreadNotes || []).some(n => n.id === note.id)) return s;
          return {
            ...s,
            coaching: { ...s.coaching, unreadNotes: [note, ...(s.coaching.unreadNotes || [])] },
          };
        });
      },
      (eventType, coachingId, newRow) => {
        if (eventType === 'DELETE' && coachingId?.startsWith('support_')) {
          setStore(s => s ? {
            ...s,
            supportTickets: (s.supportTickets || []).filter(t => t.coachingId !== coachingId),
            supportUnread: Math.max(0, (s.supportUnread || 0) - ((s.supportTickets || []).find(t => t.coachingId === coachingId)?.unreadCount || 0)),
          } : s);
          return;
        }
        if (eventType === 'UPDATE' && coachingId?.startsWith('support_') && newRow?.support_status) {
          setStore(s => s ? {
            ...s,
            supportTickets: (s.supportTickets || []).map(t =>
              t.coachingId === coachingId ? { ...t, status: newRow.support_status } : t
            ),
          } : s);
          return;
        }
        LB.reloadCoachingState(userId).then(coaching => {
          setStore(s => s ? { ...s, coaching } : s);
        }).catch(() => {});
      },
      activeCoachClients,
      triggerPoll,
    );
    return () => { clearTimeout(debounceTimer); unsubscribe(); };
  }, [userId, coachClientsKey]);

  // Sync to Supabase + save to localStorage on every store change.
  // A failed sync leaves syncBase unchanged so the pending diff is retried later.
  useEffectA(() => {
    if (!store || !userId || phase !== 'ready') return;
    if (prevStore.current !== store) localDirty.current = true;
    prevStore.current = store;
    pendingStore.current = store;
    if (!LB.saveToLocal(store, userId)) setStorageFull(true);
    if (store !== syncBase.current) setSyncStatus('pending');
    flushSync(userId);
  }, [store]);

  // Check for SW updates on every screen navigation and whenever the app
  // comes back to the foreground (visibilitychange). Fetches sw.js directly
  // from the network (bypassing the SW cache via ?_v=) and compares the CACHE
  // version string. iOS Safari ignores reg.update() when the app is in the
  // foreground, so this is the only reliable detection path.
  // Skipped entirely while on the training screen — never risk nudging
  // someone mid-workout, even indirectly (a background swReg.update() can
  // still be surprising). This means a user who lives almost entirely on
  // 'train' can go a long time without a successful check; that tradeoff is
  // deliberate. The admin-triggered force-update path (checkForceUpdate
  // below) intentionally does NOT have this guard, so a manual broadcast can
  // still reach everyone promptly.
  const checkSwUpdate = useCallbackA(() => {
    if (routeRef.current?.name === 'train') return;
    // Resolve sw.js relative to the SW scope (or page URL before registration
    // settles) — works on both github.io/training/ and the zane-wo.com root.
    const swUrl = new URL('sw.js', swReg.current?.scope || window.location.href);
    fetch(`${swUrl}?_v=${Date.now()}`)
      .then(r => r.text())
      .then(text => {
        const m = text.match(/const CACHE = '([^']+)'/);
        if (!m) return;
        const v = m[1];
        // Persist the last-seen version to localStorage so cold starts (iOS
        // terminates PWA, clears in-memory state) still detect stale caches.
        // An in-memory ref would always start null after a cold start, making
        // the first fetch a no-op that "consumes" the update without showing
        // the banner — the user would never see it.
        let stored = null;
        try { stored = localStorage.getItem('logbook-sw-version'); } catch (_) {}
        if (!stored) {
          // First sighting: record the running version as the baseline so a
          // later, newer sw.js is recognised as an update. Nothing to compare
          // against yet, so no banner.
          try { localStorage.setItem('logbook-sw-version', v); } catch (_) {}
          return;
        }
        if (v !== stored) {
          // An update is available. Do NOT advance the stored version here —
          // only applyUpdate persists it. Otherwise after an iOS cold start
          // (in-memory state wiped) stored would already equal v and the
          // update would never be re-offered.
          pendingSwVersion.current = v;
          setUpdateAvailable(true);
          swReg.current?.update().catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // Lets the admin push the update banner to everyone without an sw.js cache
  // bump (see admin_force_update). Same "first sighting = baseline, no
  // banner" pattern as checkSwUpdate above — a brand-new device must never
  // see a false "update available" for a nonce it's never seen before.
  // Deliberately runs regardless of route (including 'train') — this is the
  // one deliberate, admin-triggered broadcast, so it's allowed to reach a
  // training user promptly. checkSwUpdate above keeps the route guard so
  // routine version bumps never even risk nudging someone mid-workout.
  const checkForceUpdate = useCallbackA(() => {
    LB.supabase.rpc('get_force_update_nonce').then(({ data, error }) => {
      if (error || !data) return;
      let stored = null;
      try { stored = localStorage.getItem('logbook-force-nonce-seen'); } catch (_) {}
      if (!stored) {
        try { localStorage.setItem('logbook-force-nonce-seen', data); } catch (_) {}
        return;
      }
      if (data !== stored) {
        pendingForceNonce.current = data;
        setUpdateAvailable(true);
      }
    }).catch(() => {});
  }, []);

  useEffectA(() => { checkSwUpdate(); checkForceUpdate(); }, [route]);

  useEffectA(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') { checkSwUpdate(); checkForceUpdate(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Connectivity tracking: offline → red immediately, online → retry or clear
  useEffectA(() => {
    const onOffline = () => setSyncStatus('error');
    const onOnline  = () => {
      if (!userId) return;
      if (pendingStore.current !== syncBase.current) flushSync(userId);
      else setSyncStatus('synced');
    };
    if (!navigator.onLine) setSyncStatus('error');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online',  onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online',  onOnline);
    };
  }, [userId, flushSync]);

  // Keep nextReminderAt in sync whenever reminder settings or schedule state changes.
  useEffectA(() => {
    if (!store || phase !== 'ready') return;
    if (!store.settings?.reminderEnabled) {
      if (store.nextReminderAt != null) setStore(s => ({ ...s, nextReminderAt: null }));
      return;
    }
    const computed = LB.computeNextReminderAt(store);
    if (computed !== (store.nextReminderAt ?? null)) {
      setStore(s => ({ ...s, nextReminderAt: computed }));
    }
  }, [
    store?.settings?.reminderEnabled,
    store?.settings?.reminderTime,
    store?.activeScheduleId,
    store?.cycleStartDate,
    store?.lastAdvancedDate,
    store?.inProgress,
  ]);

  // Live client training status + check-in status, driving the coaching
  // badge. Primary updates come from the realtime listeners wired into the
  // subscribeToChanges effect above (via pollFnRef/triggerPoll); this
  // interval is only the fallback for a dropped/reconnecting channel, so it
  // can be slow, it's a safety net.
  const isCoachActive = phase === 'ready' && (store?.coaching?.asCoach || []).some(c => c.status === 'active');
  const prevAnyLiveRef = useRefA(false);
  const prevPendingRef = useRefA(0);
  useEffectA(() => {
    if (!isCoachActive) { pollFnRef.current = null; return; }
    const poll = () => {
      Promise.all([LB.loadCoachClientsStatus(), LB.loadCoachCheckinStatus()])
        .then(([statusData, checkinData]) => {
          const anyLive = statusData.some(r => r.inProgressSessionId);
          setStore(s => {
            if (!s) return s;
            const asCoach = s.coaching?.asCoach || [];
            const pendingCheckinsCount = checkinData.filter(r => {
              if (r.checkedInAt !== null) return false;
              const client = asCoach.find(c => c.id === r.coachingId);
              return client?.checkinEnabled ?? true;
            }).length;
            if (anyLive === prevAnyLiveRef.current && pendingCheckinsCount === prevPendingRef.current) return s;
            prevAnyLiveRef.current = anyLive;
            prevPendingRef.current = pendingCheckinsCount;
            return { ...s, coaching: { ...s.coaching, anyClientLive: anyLive, pendingCheckinsCount } };
          });
        })
        .catch(() => {});
    };
    pollFnRef.current = poll;
    poll();
    const iv = setInterval(poll, 60000);
    return () => { clearInterval(iv); pollFnRef.current = null; };
  }, [isCoachActive]);

  // Exposed globally so Settings → How to… can launch any tour.
  // Also clears WhatsNew so it doesn't block the tour overlay (z-index).
  window.__startTour = (tourKey) => { setWhatsNew(null); setOnboardingState({ phase: 'tour', tourKey }); };

  // helper for in-sheet "+ new exercise"
  window.__createExercise = (name) => {
    const id = LB.uid();
    setStore(s => ({ ...s, exercises: [...s.exercises, { id, name: name.trim(), tags: [] }] }));
    return id;
  };

  if (phase === 'init' || phase === 'loading') return <LoadingScreen />;
  if (phase === 'unauthed') return <window.Screens.LoginScreen />;
  if (phase === 'invite') return <window.Screens.SetPasswordScreen isRecovery={isRecoveryFlow.current} onDone={() => loadData(userId)} />;
  if (phase === 'pending') return <window.Screens.PendingApprovalScreen onSignOut={() => LB.signOut()} />;
  if (phase === 'error') return <ErrorScreen onRetry={() => window.location.reload()} />;

  const go    = (r) => setRoute(r);
  // Global hook so shared components (TopBar/ScreenHead long-press-to-home)
  // can jump home without threading `go` through every screen that renders them.
  window.__goHome = () => go({ name: 'home' });
  const onRetrySync = () => { setStorageFull(false); flushSync(userId); };

  const props = { store, setStore, go, userId, syncStatus, storageFull, onRetrySync, flushBeforeSignOut };
  const tabRoutes = ['home', 'plan', 'lib', 'cardio-plans', 'hist', 'health', 'water', 'food', 'coaching'];
  const showTab = tabRoutes.includes(route.name);
  // Library and cardio-plans live under the merged "Plan" tab; the water and
  // food trackers live under the Health tab: keep the right tab lit for each.
  const tabActive = (route.name === 'lib' || route.name === 'cardio-plans') ? 'plan'
    : (route.name === 'water' || route.name === 'food') ? 'health'
    : route.name;

  const showCoaching = !!(
    store?.settings?.showCoachingTab ||
    (store?.settings?.beYourOwnCoach && store?.coaching?.asSelf) ||
    (store?.coaching?.asCoach || []).filter(c => c.status === 'active').length > 0 ||
    store?.coaching?.asClient?.status === 'active'
  );
  const showHealth = !!store?.settings?.showHealthTab;
  const coachingUnread = (store?.coaching?.unreadNotes || []).length;
  const pendingCheckinsCount = store?.coaching?.pendingCheckinsCount || 0;
  const coachingBadge = showCoaching ? { count: coachingUnread + pendingCheckinsCount, live: !!store?.coaching?.anyClientLive } : null;

  let screen;
  switch (route.name) {
    case 'home':          screen = <window.Screens.HomeScreen {...props} />; break;
    case 'plan':          screen = <window.Screens.PlanScreen {...props} openNewPlan={route.openNewPlan} />; break;
    case 'plan-view':     screen = <window.Screens.PlanViewerScreen {...props} scheduleId={route.scheduleId} fromPlan={route.fromPlan} />; break;
    case 'schedule-new':  screen = <window.Screens.ScheduleNewScreen {...props} />; break;
    case 'schedule-programs': screen = <window.Screens.StructuredProgramsScreen {...props} />; break;
    case 'schedule-templates': screen = <window.Screens.ProgramTemplatesScreen {...props} />; break;
    case 'schedule-531':  screen = <window.Screens.FiveThreeOneSetupScreen {...props} />; break;
    case 'plan-preview':  screen = <window.Screens.ProgramPreviewScreen {...props} programId={route.programId} />; break;
    case 'schedule-edit': screen = <window.Screens.ScheduleEditScreen {...props} scheduleId={route.scheduleId} versionFrom={route.versionFrom} openDayId={route.openDayId} />; break;
    case 'train':         screen = <window.Screens.TrainingScreen {...props} sessionId={route.sessionId} />; break;
    case 'lib':           screen = <window.Screens.LibraryScreen {...props} />; break;
    case 'cardio-plans':  screen = <window.Screens.CardioPlanScreen {...props} />; break;
    case 'exercise':      screen = <window.Screens.ExerciseDetailScreen key={route.exId} {...props} exId={route.exId} back={route.back} editQueue={route.editQueue || []} editQueueTotal={route.editQueueTotal || 0} autoEdit={!!route.autoEdit} />; break;
    case 'hist':          screen = <window.Screens.HistoryScreen {...props} initialTab={route.initialTab} />; break;
    case 'health':        screen = <window.Screens.HealthScreen {...props} />; break;
    case 'water':         screen = <window.Screens.WaterScreen {...props} />; break;
    case 'food':          screen = <window.Screens.FoodScreen {...props} date={route.date} />; break;
    case 'session':          screen = <window.Screens.SessionDetailScreen {...props} sessionId={route.sessionId} justFinished={route.justFinished} back={route.back} />; break;
    case 'compare':          screen = <window.Screens.SessionCompareScreen {...props} sessionId={route.sessionId} compareId={route.compareId} back={route.back} />; break;
    case 'exerciseHistory':  screen = <window.Screens.ExerciseHistoryScreen {...props} exId={route.exId} dayId={route.dayId} exName={route.exName} back={route.back} />; break;
    case 'settings':          screen = <window.Screens.SettingsScreen {...props} openSupportInbox={route.openSupportInbox} openSupportSheet={route.openSupportSheet} onTestUpdateBanner={() => setForceShowUpdateBanner(true)} />; break;
    case 'featuremap':        screen = <window.Screens.FeatureMapScreen {...props} />; break;
    case 'autoreg-guide':     screen = <window.Screens.AutoregGuideScreen {...props} mode={route.mode} back={route.back} />; break;
    case 'spectator':         screen = <window.Screens.SpectatorScreen {...props} targetUserId={route.targetUserId} userName={route.userName} sessionId={route.sessionId} />; break;
    case 'coaching':            screen = <window.Screens.CoachingTabScreen {...props} initialClientTab={route.initialClientTab} />; break;
    case 'coaching-dashboard':  screen = <window.Screens.CoachingDashboard {...props} />; break;
    case 'coaching-client':     screen = <window.Screens.CoachClientScreen key={route.coachingId} {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} checkinAt={route.checkinAt} initialTab={route.initialTab} backRoute={route.backRoute || 'settings'} isSelf={route.isSelf} />; break;
    case 'coaching-edit-plan':  screen = <window.Screens.CoachPlanEditorScreen {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} scheduleId={route.scheduleId} />; break;
    case 'coaching-new-plan':   screen = <window.Screens.CoachNewPlanScreen {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} />; break;
    default:                  screen = <window.Screens.HomeScreen {...props} />; break;
  }

  // Expose the weight-unit label globally so UI.unit() can read it anywhere
  // (display-only; the stored numbers stay the same).
  // 'mixed' = kg weight + mi distance; __UNIT only covers the weight side.
  // Keep logbook-cardio-dist-unit in sync so all cardio screens pick up the
  // correct distance unit on boot (not just when the picker is used).
  const _u = store?.settings?.unit;
  window.__UNIT = (_u === 'lbs') ? 'lbs' : 'kg';
  if (_u === 'mixed' || _u === 'lbs') LB.setCardioDistUnit('mi');
  else if (_u === 'kg') LB.setCardioDistUnit('km');

  // Deload overlay flag — buildSeedSets reads this to pre-fill loads at ~50%.
  window.__DELOAD = store?.statusMode === 'deload';

  // Two layout variants: the iPad sidebar layout (only on tab routes) and the
  // full-bleed layout (everything else). Navigating between a tab route and a
  // non-tab route (e.g. plan → schedule-new) flips between them on iPad.
  const layout = (isPad && showTab) ? (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <TabBar active={tabActive} routeName={route.name} onChange={(t) => go({ name: t })} sidebar showCoaching={showCoaching} coachingBadge={coachingBadge} showHealth={showHealth} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ErrorBoundary key={route.name} onGoHome={() => go({ name: 'home' })}>
          {screen}
        </ErrorBoundary>
      </div>
    </div>
  ) : (
    <>
      <ErrorBoundary key={route.name} onGoHome={() => go({ name: 'home' })}>
        {screen}
      </ErrorBoundary>
      {showTab && <TabBar active={tabActive} routeName={route.name} onChange={(t) => go({ name: t })} showCoaching={showCoaching} coachingBadge={coachingBadge} showHealth={showHealth} />}
    </>
  );

  // Overlays live OUTSIDE the layout variants at a stable tree position so they
  // never remount when navigation flips the layout on iPad. Remounting
  // OnboardingTour mid-tour would reset its step counter — that was the
  // "3/10 → 4/10 → snaps back to 1/10" bug when the tour navigated from the
  // plan tab (sidebar layout) to schedule-new (full-bleed layout).
  return (
    <>
      {layout}
      {/* Hold the update banner back while a session is live (never interrupt a
          workout), and also across the just-finished "Well done" summary, which
          runs after inProgress has already cleared. Otherwise the banner pops the
          moment a session ends and updating skips the summary (and its share
          image). It shows once the user leaves that screen (justFinished clears).
          route.name !== 'train' additionally covers the gap in between: finish()
          clears inProgress synchronously but can stay on route 'train' for a
          while longer (the meso gains sheet, mesocycle-complete confirms, etc.)
          before it navigates to the justFinished session route, and neither of
          the two checks above sees that in-between window on its own.
          forceShowUpdateBanner (Settings "Test update banner") deliberately bypasses this. */}
      {(forceShowUpdateBanner || (updateAvailable && !store?.inProgress && route?.name !== 'train' && !(route?.name === 'session' && route?.justFinished) && !onboardingState)) && <UpdateBanner onUpdate={applyUpdate} />}
      {autoCloseNotify && <AutoCloseBanner notify={autoCloseNotify} onDismiss={() => setAutoCloseNotify(null)} />}
      {whatsNew && <WhatsNewModal entries={whatsNew} onDismiss={dismissWhatsNew} />}
      {store && <window.Screens.CoachingPendingBanner store={store} setStore={setStore} userId={userId} />}
      {onboardingState?.phase === 'prompt' && (
        <window.Screens.OnboardingPrompt
          onStart={() => setOnboardingState({ phase: 'tour', tourKey: 'createPlan' })}
          onSkip={() => { setOnboardingState(null); setStore(s => s ? { ...s, settings: { ...s.settings, onboardingCompleted: true } } : s); }}
        />
      )}
      {onboardingState?.phase === 'tour' && (
        <window.Screens.OnboardingTour
          tourKey={onboardingState.tourKey}
          go={go}
          route={route}
          onDone={() => { setOnboardingState(null); go({ name: 'home' }); setStore(s => s ? { ...s, settings: { ...s.settings, onboardingCompleted: true } } : s); }}
        />
      )}
      {unitPromptOpen && window.Screens?.UnitPromptModal && (
        <window.Screens.UnitPromptModal
          onDone={(chosenUnit) => {
            unitPicked.current = true; // latch before setStore so the reset watcher won't re-null
            setUnitPromptOpen(false);
            setStore(s => s ? { ...s, settings: { ...s.settings, unit: chosenUnit } } : s);
          }}
        />
      )}
      {pendingShare && store && window.Screens?.RecipeShareSheet && (
        <window.Screens.RecipeShareSheet
          store={store} setStore={setStore} token={pendingShare}
          onClose={() => {
            try { localStorage.removeItem(PENDING_SHARE_KEY); } catch (_) {}
            setPendingShare(null);
          }}
        />
      )}
    </>
  );
}

function tryMount() {
  if (window.LB && window.Screens?.LoginScreen && window.Screens?.HomeScreen &&
      window.Screens?.LibraryScreen && window.Screens?.TrainingScreen &&
      window.Screens?.SettingsScreen) {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  } else {
    setTimeout(tryMount, 50);
  }
}
tryMount();
