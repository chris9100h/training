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
              style={{ background: UI.gold, color: '#0a0a0a', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, fontFamily: UI.fontUi, cursor: 'pointer' }}
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
  const dateLabel = date ? new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : '';
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
          Your <strong style={{ color: UI.ink }}>{dayName}</strong> session{dateLabel ? ` on ${dateLabel}` : ''} was automatically ended — <strong style={{ color: UI.ink }}>{durationMinutes} min</strong> recorded.
        </div>
        <button onClick={onDismiss} style={{
          marginTop: 10, width: '100%', padding: '14px 0',
          borderRadius: 6, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
          boxShadow: '0 8px 24px rgba(var(--accent-rgb),0.4)',
          color: '#0a0805', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 700,
          letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent',
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
        border: `1px solid ${UI.goldSoft}`,
        borderRadius: 6,
        padding: '32px 28px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 10, textAlign: 'center',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(201,169,97,0.2)',
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
          color: '#0a0805', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 700,
          letterSpacing: '0.06em',
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
        border: `1px solid ${UI.goldSoft}`,
        borderRadius: 6,
        padding: '28px 26px',
        display: 'flex', flexDirection: 'column', gap: 18,
        overflowY: 'auto',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(201,169,97,0.2)',
        animation: 'fadeUp 0.3s ease',
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
          color: '#0a0805', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 700,
          letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent',
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
          fontFamily: UI.fontUi, cursor: 'pointer',
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
  const [autoCloseNotify, setAutoCloseNotify] = useStateA(null);
  const [whatsNew, setWhatsNew] = useStateA(null); // array of unseen changelog entries, or null
  const [syncStatus, setSyncStatus] = useStateA('synced'); // 'synced' | 'pending' | 'error'
  const [storageFull, setStorageFull] = useStateA(false);  // local cache write failed (quota)
  const [onboardingState, setOnboardingState] = useStateA(null); // null | { phase:'prompt' } | { phase:'tour', tourKey }
  const onboardingChecked = useRefA(false);
  const [unitPromptOpen, setUnitPromptOpen] = useStateA(false);
  const unitPicked                = useRefA(false); // user chose a unit this session — silences the reset watcher
  const retryTimer                = useRefA(null);  // one-shot retry after a failed sync
  const waitingWorker             = useRefA(null);
  const intentionalUpdate         = useRefA(false);
  const swReg                     = useRefA(null);
  const lastSeenSWVersion         = useRefA(null);
  const prevStore                 = useRefA(null);
  const syncBase                  = useRefA(null);  // last state confirmed written to Supabase
  const pendingStore              = useRefA(null);  // latest state awaiting sync
  const syncing                   = useRefA(false); // true while a sync is in flight
  const localDirty                = useRefA(false); // true if user changed store after cache load
  const userIdRef                 = useRefA(null);  // current userId for stale-closure contexts
  const phaseRef                  = useRefA('init'); // current phase for stale-closure contexts

  useEffectA(() => { userIdRef.current = userId; }, [userId]);
  useEffectA(() => { phaseRef.current = phase; }, [phase]);

  useEffectA(() => {
    if (store?.user?.email && store?.user?.name) {
      LB.saveQsName(store.user.email, store.user.name);
    }
  }, [store?.user?.email, store?.user?.name]);

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
          const serverDailyIds  = new Set(fresh.dailyLogs.map(l => l.id));
          const serverDailyDates = new Set(fresh.dailyLogs.map(l => l.date));
          const serverCardioIds = new Set(fresh.cardioLogs.map(l => l.id));
          // Daily logs are one-per-date: also drop a local row whose date the
          // server already has (a divergent id from a pre-RPC multi-device write).
          const localOnlyDaily  = (s.dailyLogs  || []).filter(l => !serverDailyIds.has(l.id) && !serverDailyDates.has(l.date));
          const localOnlyCardio = (s.cardioLogs || []).filter(l => !serverCardioIds.has(l.id));
          return { ...s, dailyLogs: [...localOnlyDaily, ...fresh.dailyLogs], cardioLogs: [...localOnlyCardio, ...fresh.cardioLogs] };
        });
      }).catch(() => {});
    };

    const onHide = () => localStorage.setItem(KEY, Date.now());
    const onShow = (e) => {
      if (!e.persisted) return;
      const ts = localStorage.getItem(KEY);
      const elapsed = ts ? Date.now() - Number(ts) : 0;
      if (elapsed > THRESHOLD) { window.location.reload(); return; }
      if (elapsed > SOFT_THRESHOLD) softRefresh();
      swReg.current?.update().catch(() => {});
    };
    // visibilitychange as additional fallback
    const onVisibility = () => {
      if (document.hidden) {
        localStorage.setItem(KEY, Date.now());
      } else {
        const ts = localStorage.getItem(KEY);
        const elapsed = ts ? Date.now() - Number(ts) : 0;
        if (elapsed > THRESHOLD) { window.location.reload(); return; }
        if (elapsed > SOFT_THRESHOLD) softRefresh();
        swReg.current?.update().catch(() => {});
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
    // Only reload when the user explicitly clicked "Update now"
    const onControllerChange = () => {
      if (intentionalUpdate.current) window.location.reload(true);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  const applyUpdate = useCallbackA(async () => {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }

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
      window.location.reload(true);
    }
  }, []);

  // Push pending local changes to Supabase. Serialized; on failure syncBase is
  // left untouched so the next change (or an 'online' event) retries the diff.
  const flushSync = useCallbackA((uid) => {
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
          // fresh is the pristine server state — use it as the sync diff base
          syncBase.current = fresh;
          LB.saveBase(fresh, uid);
          let merged = fresh;
          if (cur) {
            const inProgressId = cur.inProgress ?? fresh.inProgress;
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
            const curExMap = new Map((cur.exercises || []).map(e => [e.id, e]));
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
            // Scalar state: the local cache is authoritative — it always holds
            // the most recent state on this device, including unsynced offline
            // edits. For items with IDs we use an ID-based merge instead.
            merged = {
              ...fresh,
              // Local cache is authoritative for scalar settings (preserves
              // offline edits) — except a server-side unit of null (admin reset
              // / not chosen) must win so the picker re-fires, since the cache
              // still holds the old kg/lbs value.
              settings: { ...fresh.settings, ...cur.settings, ...(fresh.settings.unit == null ? { unit: null } : {}) },
              activeScheduleId: cur.activeScheduleId,
              cycleIndex: cur.cycleIndex,
              cycleStartDate: cur.cycleStartDate,
              lastAdvancedDate: cur.lastAdvancedDate,
              user: cur.user?.name ? { ...fresh.user, name: cur.user.name } : fresh.user,
              inProgress: activeExists ? inProgressId : null,
              sessions,
              exercises: [...localOnlyExercises, ...fresh.exercises.filter(e => !delExIds?.has(e.id))],
              schedules: [...localOnlySchedules, ...fresh.schedules.filter(s => !delSchIds?.has(s.id))],
              skips: [...localOnlySkips, ...(fresh.skips || []).filter(s => !delSkipIds?.has(s.id))],
              dailyLogs: [...localOnlyDailyLogs, ...(fresh.dailyLogs || []).filter(l => !delDailyIds?.has(l.id))],
              cardioLogs: [...localOnlyCardioLogs, ...(fresh.cardioLogs || []).filter(l => !delCardioIds?.has(l.id))],
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
  useEffectA(() => {
    if (!userId) return;
    return LB.subscribeToChanges(
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
    );
  }, [userId]);

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
  const checkSwUpdate = useCallbackA(() => {
    // Resolve sw.js relative to the SW scope (or page URL before registration
    // settles) — works on both github.io/training/ and the zane-wo.com root.
    const swUrl = new URL('sw.js', swReg.current?.scope || window.location.href);
    fetch(`${swUrl}?_v=${Date.now()}`)
      .then(r => r.text())
      .then(text => {
        const m = text.match(/const CACHE = '([^']+)'/);
        if (!m) return;
        const v = m[1];
        if (!lastSeenSWVersion.current) {
          lastSeenSWVersion.current = v;
        } else if (v !== lastSeenSWVersion.current) {
          lastSeenSWVersion.current = v;
          setUpdateAvailable(true);
          swReg.current?.update().catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  useEffectA(() => { checkSwUpdate(); }, [route]);

  useEffectA(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') checkSwUpdate(); };
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

  // Poll live client training status + check-in status so the coaching badge
  // updates even when the tab is closed.
  const isCoachActive = phase === 'ready' && (store?.coaching?.asCoach || []).some(c => c.status === 'active');
  const prevAnyLiveRef = useRefA(false);
  const prevPendingRef = useRefA(0);
  useEffectA(() => {
    if (!isCoachActive) return;
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
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
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
  const onRetrySync = () => { setStorageFull(false); flushSync(userId); };

  const props = { store, setStore, go, userId, syncStatus, storageFull, onRetrySync };
  const tabRoutes = ['home', 'plan', 'lib', 'cardio-plans', 'hist', 'health', 'coaching'];
  const showTab = tabRoutes.includes(route.name);
  // Library and cardio-plans live under the merged "Plan" tab — keep that tab lit.
  const tabActive = (route.name === 'lib' || route.name === 'cardio-plans') ? 'plan' : route.name;

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
    case 'plan':          screen = <window.Screens.PlanScreen {...props} />; break;
    case 'plan-view':     screen = <window.Screens.PlanViewerScreen {...props} scheduleId={route.scheduleId} fromPlan={route.fromPlan} />; break;
    case 'schedule-new':  screen = <window.Screens.ScheduleNewScreen {...props} />; break;
    case 'schedule-edit': screen = <window.Screens.ScheduleEditScreen {...props} scheduleId={route.scheduleId} versionFrom={route.versionFrom} />; break;
    case 'train':         screen = <window.Screens.TrainingScreen {...props} sessionId={route.sessionId} />; break;
    case 'lib':           screen = <window.Screens.LibraryScreen {...props} />; break;
    case 'cardio-plans':  screen = <window.Screens.CardioPlanScreen {...props} />; break;
    case 'exercise':      screen = <window.Screens.ExerciseDetailScreen key={route.exId} {...props} exId={route.exId} back={route.back} editQueue={route.editQueue || []} editQueueTotal={route.editQueueTotal || 0} autoEdit={!!route.autoEdit} />; break;
    case 'hist':          screen = <window.Screens.HistoryScreen {...props} initialTab={route.initialTab} />; break;
    case 'health':        screen = <window.Screens.HealthScreen {...props} />; break;
    case 'session':          screen = <window.Screens.SessionDetailScreen {...props} sessionId={route.sessionId} justFinished={route.justFinished} back={route.back} />; break;
    case 'exerciseHistory':  screen = <window.Screens.ExerciseHistoryScreen {...props} exId={route.exId} dayId={route.dayId} exName={route.exName} back={route.back} />; break;
    case 'settings':          screen = <window.Screens.SettingsScreen {...props} openSupportInbox={route.openSupportInbox} openSupportSheet={route.openSupportSheet} />; break;
    case 'spectator':         screen = <window.Screens.SpectatorScreen {...props} targetUserId={route.targetUserId} userName={route.userName} sessionId={route.sessionId} />; break;
    case 'coaching':            screen = <window.Screens.CoachingTabScreen {...props} initialClientTab={route.initialClientTab} />; break;
    case 'coaching-dashboard':  screen = <window.Screens.CoachingDashboard {...props} />; break;
    case 'coaching-client':     screen = <window.Screens.CoachClientScreen {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} checkinAt={route.checkinAt} initialTab={route.initialTab} backRoute={route.backRoute || 'settings'} isSelf={route.isSelf} />; break;
    case 'coaching-edit-plan':  screen = <window.Screens.CoachPlanEditorScreen {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} scheduleId={route.scheduleId} />; break;
    case 'coaching-new-plan':   screen = <window.Screens.CoachNewPlanScreen {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} />; break;
    default:                  screen = <window.Screens.HomeScreen {...props} />; break;
  }

  // Expose the weight-unit label globally so UI.unit() can read it anywhere
  // (display-only; the stored numbers stay the same).
  window.__UNIT = store?.settings?.unit || 'kg';

  // Two layout variants: the iPad sidebar layout (only on tab routes) and the
  // full-bleed layout (everything else). Navigating between a tab route and a
  // non-tab route (e.g. plan → schedule-new) flips between them on iPad.
  const layout = (isPad && showTab) ? (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <TabBar active={tabActive} onChange={(t) => go({ name: t })} sidebar currentUser={{ email: store?.user?.email || '', name: store?.user?.name || '' }} showCoaching={showCoaching} coachingBadge={coachingBadge} showHealth={showHealth} />
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
      {showTab && <TabBar active={tabActive} onChange={(t) => go({ name: t })} showCoaching={showCoaching} coachingBadge={coachingBadge} showHealth={showHealth} />}
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
      {/* Hold the update banner back while a session is live — never interrupt a workout */}
      {updateAvailable && !store?.inProgress && !onboardingState && <UpdateBanner onUpdate={applyUpdate} />}
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
