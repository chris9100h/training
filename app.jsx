/* Main App — auth + routing */

const { useState: useStateA, useEffect: useEffectA, useRef: useRefA, useCallback: useCallbackA } = React;

function UpdateBanner({ onUpdate }) {
  return (
    <div style={{
      flexShrink: 0,
      background: UI.goldFaint, borderBottom: `1px solid ${UI.goldSoft}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 16px', gap: 12,
    }}>
      <span style={{ fontSize: 13, color: UI.gold, fontFamily: UI.fontUi }}>
        Neue Version verfügbar
      </span>
      <button onClick={onUpdate} style={{
        background: UI.gold, color: '#0a0a0a',
        border: 'none', borderRadius: 8,
        padding: '5px 12px', fontSize: 12, fontWeight: 600,
        fontFamily: UI.fontUi, cursor: 'pointer', flexShrink: 0,
      }}>
        Jetzt updaten
      </button>
    </div>
  );
}

function LoadingScreen() {
  return (
    <Screen scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 600, color: UI.gold, letterSpacing: '0.06em', marginBottom: 10 }}>
          LOGBOOK
        </div>
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontNum, letterSpacing: '0.1em' }}>
          Laden…
        </div>
      </div>
    </Screen>
  );
}

function App() {
  const [phase, setPhase]         = useStateA('init'); // 'init' | 'loading' | 'ready' | 'unauthed'
  const [store, setStore]         = useStateA(null);
  const [userId, setUserId]       = useStateA(null);
  const [route, setRoute]         = useStateA({ name: 'home' });
  const [updateAvailable, setUpdateAvailable] = useStateA(false);
  const waitingWorker             = useRefA(null);
  const prevStore                 = useRefA(null);
  const localDirty                = useRefA(false); // true if user changed store after cache load

  useEffectA(() => {
    const THRESHOLD = 30 * 60 * 1000;
    const KEY = 'logbook-bg-ts';

    const onHide = () => localStorage.setItem(KEY, Date.now());
    const onShow = (e) => {
      if (!e.persisted) return;
      const ts = localStorage.getItem(KEY);
      if (ts && Date.now() - Number(ts) > THRESHOLD) window.location.reload();
    };
    // visibilitychange as additional fallback
    const onVisibility = () => {
      if (document.hidden) localStorage.setItem(KEY, Date.now());
      else {
        const ts = localStorage.getItem(KEY);
        if (ts && Date.now() - Number(ts) > THRESHOLD) window.location.reload();
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
      // iOS PWA won't auto-check for SW updates — force it
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
    // location.reload() unreliable in iOS PWA standalone mode
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.href = window.location.href;
    });
  }, []);

  const applyUpdate = useCallbackA(() => {
    waitingWorker.current?.postMessage({ type: 'SKIP_WAITING' });
  }, []);

  const loadData = async (uid) => {
    localDirty.current = false;
    const cached = LB.loadFromLocal(uid);
    if (cached) {
      // Show instantly from cache, then refresh from Supabase in background
      prevStore.current = cached;
      setStore(cached);
      setPhase('ready');
      LB.loadFromSupabase(uid)
        .then(fresh => {
          // Only apply if user hasn't made local changes during the fetch
          if (!localDirty.current) {
            const cur = prevStore.current;
            if (cur) {
              // preserve in-progress session (may not be committed to Supabase yet)
              fresh.inProgress = cur.inProgress ?? fresh.inProgress;
              fresh.sessions = fresh.sessions.map(s => {
                const mem = cur.sessions?.find(x => x.id === s.id);
                return mem ? { ...s, currentExIdx: mem.currentExIdx ?? 0, cyclePos: mem.cyclePos ?? null } : s;
              });
            }
            prevStore.current = fresh;
            setStore(fresh);
          }
        })
        .catch(console.error);
    } else {
      setPhase('loading');
      try {
        const loaded = await LB.loadFromSupabase(uid);
        prevStore.current = loaded;
        setStore(loaded);
        setPhase('ready');
      } catch (e) {
        console.error('loadFromSupabase failed', e);
        setPhase('unauthed');
      }
    }
  };

  useEffectA(() => {
    const { data: { subscription } } = LB.supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (session) { setUserId(session.user.id); loadData(session.user.id); }
        else          { setPhase('unauthed'); }
      } else if (event === 'SIGNED_IN') {
        setUserId(session.user.id);
        loadData(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        LB.clearLocal(userId);
        setStore(null);
        setUserId(null);
        prevStore.current = null;
        localDirty.current = false;
        setRoute({ name: 'home' });
        setPhase('unauthed');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Sync to Supabase + save to localStorage on every store change
  useEffectA(() => {
    if (!store || !userId || phase !== 'ready') return;
    if (prevStore.current !== store) localDirty.current = true;
    LB.syncStore(prevStore.current, store, userId).catch(console.error);
    LB.saveToLocal(store, userId);
    prevStore.current = store;
  }, [store]);

  // helper for in-sheet "+ new exercise"
  window.__createExercise = (name) => {
    const id = LB.uid();
    setStore(s => ({ ...s, exercises: [...s.exercises, { id, name: name.trim(), tags: [] }] }));
    return id;
  };

  if (phase === 'init' || phase === 'loading') return <LoadingScreen />;
  if (phase === 'unauthed') return <window.Screens.LoginScreen />;

  const go    = (r) => setRoute(r);
  const props = { store, setStore, go, userId };
  const tabRoutes = ['home', 'plan', 'lib', 'hist'];
  const showTab = tabRoutes.includes(route.name);

  let screen;
  switch (route.name) {
    case 'home':          screen = <window.Screens.HomeScreen {...props} />; break;
    case 'plan':          screen = <window.Screens.PlanScreen {...props} />; break;
    case 'schedule':      screen = <window.Screens.ScheduleDetailScreen {...props} scheduleId={route.scheduleId} />; break;
    case 'schedule-new':  screen = <window.Screens.ScheduleNewScreen {...props} />; break;
    case 'schedule-edit': screen = <window.Screens.ScheduleEditScreen {...props} scheduleId={route.scheduleId} />; break;
    case 'train':         screen = <window.Screens.TrainingScreen {...props} sessionId={route.sessionId} />; break;
    case 'lib':           screen = <window.Screens.LibraryScreen {...props} />; break;
    case 'exercise':      screen = <window.Screens.ExerciseDetailScreen {...props} exId={route.exId} />; break;
    case 'hist':          screen = <window.Screens.HistoryScreen {...props} />; break;
    case 'session':       screen = <window.Screens.SessionDetailScreen {...props} sessionId={route.sessionId} justFinished={route.justFinished} />; break;
    case 'settings':      screen = <window.Screens.SettingsScreen {...props} />; break;
    default:              screen = <window.Screens.HomeScreen {...props} />; break;
  }

  return (
    <>
      {screen}
      {updateAvailable && <UpdateBanner onUpdate={applyUpdate} />}
      {showTab && <TabBar active={route.name} onChange={(t) => go({ name: t })} />}
    </>
  );
}

function tryMount() {
  if (window.LB && window.Screens?.LoginScreen && window.Screens?.HomeScreen &&
      window.Screens?.LibraryScreen && window.Screens?.TrainingScreen) {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  } else {
    setTimeout(tryMount, 50);
  }
}
tryMount();
