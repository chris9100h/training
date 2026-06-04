/* Main App — auth + routing */

const { useState: useStateA, useEffect: useEffectA, useRef: useRefA, useCallback: useCallbackA } = React;

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
  const [store, setStore]         = useStateA(null);
  const [userId, setUserId]       = useStateA(null);
  const [route, setRoute]         = useStateA({ name: 'home' });
  const [updateAvailable, setUpdateAvailable] = useStateA(false);
  const waitingWorker             = useRefA(null);
  const intentionalUpdate         = useRefA(false);
  const swReg                     = useRefA(null);
  const lastSeenSWVersion         = useRefA(null);
  const prevStore                 = useRefA(null);
  const syncBase                  = useRefA(null);  // last state confirmed written to Supabase
  const pendingStore              = useRefA(null);  // latest state awaiting sync
  const syncing                   = useRefA(false); // true while a sync is in flight
  const localDirty                = useRefA(false); // true if user changed store after cache load

  useEffectA(() => {
    if (store?.user?.email && store?.user?.name) {
      LB.saveQsName(store.user.email, store.user.name);
    }
  }, [store?.user?.email, store?.user?.name]);

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
    const THRESHOLD = 30 * 60 * 1000;
    const KEY = 'logbook-bg-ts';

    const onHide = () => localStorage.setItem(KEY, Date.now());
    const onShow = (e) => {
      if (!e.persisted) return;
      const ts = localStorage.getItem(KEY);
      if (ts && Date.now() - Number(ts) > THRESHOLD) window.location.reload();
      swReg.current?.update().catch(() => {});
    };
    // visibilitychange as additional fallback
    const onVisibility = () => {
      if (document.hidden) localStorage.setItem(KEY, Date.now());
      else {
        const ts = localStorage.getItem(KEY);
        if (ts && Date.now() - Number(ts) > THRESHOLD) window.location.reload();
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
    if (waitingWorker.current) {
      intentionalUpdate.current = true;
      waitingWorker.current.postMessage({ type: 'SKIP_WAITING' });
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
      .then(() => { syncBase.current = target; LB.saveBase(target, uid); ok = true; })
      .catch(err => console.error('Supabase sync failed, will retry', err))
      .finally(() => {
        syncing.current = false;
        if (ok && pendingStore.current !== syncBase.current) flushSync(uid);
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
          // Skip if the user made local changes while the fetch was in flight
          if (localDirty.current) return;
          const cur = prevStore.current;
          // fresh is the pristine server state — use it as the sync diff base
          syncBase.current = fresh;
          LB.saveBase(fresh, uid);
          let merged = fresh;
          if (cur) {
            const inProgressId = cur.inProgress ?? fresh.inProgress;
            const serverIds = new Set(fresh.sessions.map(s => s.id));
            const sessions = fresh.sessions.map(s => {
              const mem = cur.sessions?.find(x => x.id === s.id);
              if (!mem) return s;
              const isActive = s.id === inProgressId;
              return {
                ...s,
                currentExIdx: mem.currentExIdx ?? 0,
                cyclePos: mem.cyclePos ?? null,
                // for the active session, local entries/restStart are authoritative
                ...(isActive ? { entries: mem.entries, restStart: mem.restStart ?? null } : {}),
              };
            });
            // keep sessions the server hasn't stored yet, but only recent ones —
            // so a session deleted on another device isn't resurrected from a stale
            // cache. The in-progress session is always kept regardless of its date.
            const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 2);
            const cutoffISO = cutoff.toISOString().slice(0, 10);
            // Keep the in-progress session even if it's unended and not yet
            // synced to the server (e.g. app killed right after starting a
            // warmup, before the first sync). Other ended=null sessions are
            // orphans and only ended sessions qualify via the recency window.
            const localOnly = (cur.sessions || []).filter(x =>
              !serverIds.has(x.id) &&
              (x.id === inProgressId || ((x.date || '') >= cutoffISO && x.ended != null))
            );
            // Drop inProgress if the session is gone from the server and not in
            // localOnly (would only survive if it somehow has an ended timestamp).
            const activeExists = inProgressId && (
              serverIds.has(inProgressId) ||
              localOnly.some(s => s.id === inProgressId)
            );
            const serverExIds = new Set(fresh.exercises.map(e => e.id));
            const localOnlyExercises = (cur.exercises || []).filter(x => !serverExIds.has(x.id));
            const curExMap = new Map((cur.exercises || []).map(e => [e.id, e]));
            const serverSchIds = new Set(fresh.schedules.map(s => s.id));
            const localOnlySchedules = (cur.schedules || []).filter(x => !serverSchIds.has(x.id));
            // Scalar state: the local cache is authoritative — it always holds
            // the most recent state on this device, including unsynced offline
            // edits. For items with IDs we use an ID-based merge instead.
            merged = {
              ...fresh,
              settings: { ...fresh.settings, ...cur.settings },
              activeScheduleId: cur.activeScheduleId,
              cycleIndex: cur.cycleIndex,
              cycleStartDate: cur.cycleStartDate,
              lastAdvancedDate: cur.lastAdvancedDate,
              user: cur.user?.name ? { ...fresh.user, name: cur.user.name } : fresh.user,
              inProgress: activeExists ? inProgressId : null,
              sessions: [...localOnly, ...sessions],
              exercises: [...localOnlyExercises, ...fresh.exercises],
              schedules: [...localOnlySchedules, ...fresh.schedules],
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
        setUserId(session.user.id);
        if (isTokenFlow.current) { isTokenFlow.current = false; setPhase('invite'); }
        else loadData(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        // An offline SIGNED_OUT is almost always a failed token refresh, not a
        // real sign-out — never wipe the cache or drop to the login screen.
        if (!navigator.onLine) { setPhase(p => (p === 'ready' ? p : 'error')); return; }
        LB.clearLocal(userId);
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

  // Realtime: coaching invites + messages only. (Cross-device live workout sync
  // was removed — the local store is the single source of truth for a session.)
  useEffectA(() => {
    if (!userId) return;
    return LB.subscribeToChanges(
      userId,
      (note) => {
        setStore(s => {
          if (!s?.coaching) return s;
          if ((s.coaching.unreadNotes || []).some(n => n.id === note.id)) return s;
          return {
            ...s,
            coaching: { ...s.coaching, unreadNotes: [note, ...(s.coaching.unreadNotes || [])] },
          };
        });
      },
      () => {
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
    LB.saveToLocal(store, userId);
    flushSync(userId);
  }, [store]);

  // Global debug logging — DOM events + route changes captured on every screen.
  useEffectA(() => {
    const log = window._log; if (!log) return;
    log(`[NAV] → ${route.name}`);
  }, [route]);

  useEffectA(() => {
    const onPD = e => {
      const log = window._log; if (!log) return;
      log(`[DOM] pointerdown type=${e.pointerType} isPrimary=${e.isPrimary} tag=${e.target.tagName}`);
    };
    const onClick = e => {
      const log = window._log; if (!log) return;
      log(`[DOM] click isTrusted=${e.isTrusted} tag=${e.target.tagName}`);
    };
    document.addEventListener('pointerdown', onPD, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('pointerdown', onPD, true);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  // Check for SW updates on every screen navigation and whenever the app
  // comes back to the foreground (visibilitychange). Fetches sw.js directly
  // from the network (bypassing the SW cache via ?_v=) and compares the CACHE
  // version string. iOS Safari ignores reg.update() when the app is in the
  // foreground, so this is the only reliable detection path.
  const checkSwUpdate = useCallbackA(() => {
    fetch(`/training/sw.js?_v=${Date.now()}`)
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

  // Retry a failed sync as soon as connectivity returns
  useEffectA(() => {
    const onOnline = () => { if (userId) flushSync(userId); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
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
          const pendingCheckinsCount = checkinData.filter(r => !r.hasCheckin).length;
          if (anyLive !== prevAnyLiveRef.current || pendingCheckinsCount !== prevPendingRef.current) {
            prevAnyLiveRef.current = anyLive;
            prevPendingRef.current = pendingCheckinsCount;
            setStore(s => s ? { ...s, coaching: { ...s.coaching, anyClientLive: anyLive, pendingCheckinsCount } } : s);
          }
        })
        .catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [isCoachActive]);

  // helper for in-sheet "+ new exercise"
  window.__createExercise = (name) => {
    const id = LB.uid();
    setStore(s => ({ ...s, exercises: [...s.exercises, { id, name: name.trim(), tags: [] }] }));
    return id;
  };

  if (phase === 'init' || phase === 'loading') return <LoadingScreen />;
  if (phase === 'unauthed') return <window.Screens.LoginScreen />;
  if (phase === 'invite') return <window.Screens.SetPasswordScreen onDone={() => loadData(userId)} />;
  if (phase === 'pending') return <window.Screens.PendingApprovalScreen onSignOut={() => LB.signOut()} />;
  if (phase === 'error') return <ErrorScreen onRetry={() => window.location.reload()} />;

  const go    = (r) => setRoute(r);
  const props = { store, setStore, go, userId };
  const tabRoutes = ['home', 'plan', 'lib', 'hist', 'coaching'];
  const showTab = tabRoutes.includes(route.name);

  const showCoaching = !!(
    store?.settings?.showCoachingTab ||
    (store?.settings?.beYourOwnCoach && store?.coaching?.asSelf) ||
    (store?.coaching?.asCoach || []).filter(c => c.status === 'active').length > 0 ||
    store?.coaching?.asClient?.status === 'active'
  );
  const coachingUnread = (store?.coaching?.unreadNotes || []).length;
  const pendingCheckinsCount = store?.coaching?.pendingCheckinsCount || 0;
  const coachingBadge = showCoaching ? { count: coachingUnread + pendingCheckinsCount, live: !!store?.coaching?.anyClientLive } : null;

  let screen;
  switch (route.name) {
    case 'home':          screen = <window.Screens.HomeScreen {...props} />; break;
    case 'plan':          screen = <window.Screens.PlanScreen {...props} />; break;
    case 'plan-view':     screen = <window.Screens.PlanViewerScreen {...props} scheduleId={route.scheduleId} fromPlan={route.fromPlan} />; break;
    case 'schedule-new':  screen = <window.Screens.ScheduleNewScreen {...props} />; break;
    case 'schedule-edit': screen = <window.Screens.ScheduleEditScreen {...props} scheduleId={route.scheduleId} />; break;
    case 'train':         screen = <window.Screens.TrainingScreen {...props} sessionId={route.sessionId} />; break;
    case 'lib':           screen = <window.Screens.LibraryScreen {...props} />; break;
    case 'exercise':      screen = <window.Screens.ExerciseDetailScreen key={route.exId} {...props} exId={route.exId} back={route.back} editQueue={route.editQueue || []} editQueueTotal={route.editQueueTotal || 0} autoEdit={!!route.autoEdit} />; break;
    case 'hist':          screen = <window.Screens.HistoryScreen {...props} initialTab={route.initialTab} />; break;
    case 'session':       screen = <window.Screens.SessionDetailScreen {...props} sessionId={route.sessionId} justFinished={route.justFinished} back={route.back} />; break;
    case 'settings':          screen = <window.Screens.SettingsScreen {...props} />; break;
    case 'spectator':         screen = <window.Screens.SpectatorScreen {...props} targetUserId={route.targetUserId} userName={route.userName} sessionId={route.sessionId} />; break;
    case 'coaching':            screen = <window.Screens.CoachingTabScreen {...props} />; break;
    case 'coaching-dashboard':  screen = <window.Screens.CoachingDashboard {...props} />; break;
    case 'coaching-client':     screen = <window.Screens.CoachClientScreen {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} initialTab={route.initialTab} backRoute={route.backRoute || 'settings'} />; break;
    case 'coaching-edit-plan':  screen = <window.Screens.CoachPlanEditorScreen {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} scheduleId={route.scheduleId} />; break;
    case 'coaching-new-plan':   screen = <window.Screens.CoachNewPlanScreen {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} />; break;
    default:                  screen = <window.Screens.HomeScreen {...props} />; break;
  }

  if (isPad && showTab) {
    return (
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <TabBar active={route.name} onChange={(t) => go({ name: t })} sidebar currentUser={{ email: store?.user?.email || '', name: store?.user?.name || '' }} showCoaching={showCoaching} coachingBadge={coachingBadge} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ErrorBoundary key={route.name} onGoHome={() => go({ name: 'home' })}>
            {screen}
          </ErrorBoundary>
        </div>
        {updateAvailable && <UpdateBanner onUpdate={applyUpdate} />}
        {store && <window.Screens.CoachingPendingBanner store={store} setStore={setStore} userId={userId} />}
      </div>
    );
  }

  return (
    <>
      <ErrorBoundary key={route.name} onGoHome={() => go({ name: 'home' })}>
        {screen}
      </ErrorBoundary>
      {updateAvailable && <UpdateBanner onUpdate={applyUpdate} />}
      {showTab && <TabBar active={route.name} onChange={(t) => go({ name: t })} showCoaching={showCoaching} coachingBadge={coachingBadge} />}
      {store && <window.Screens.CoachingPendingBanner store={store} setStore={setStore} userId={userId} />}
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
