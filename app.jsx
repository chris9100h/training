/* Main App — auth + routing */

const { useState: useStateA, useEffect: useEffectA, useRef: useRefA } = React;

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
  const [phase, setPhase]   = useStateA('init'); // 'init' | 'loading' | 'ready' | 'unauthed'
  const [store, setStore]   = useStateA(null);
  const [userId, setUserId] = useStateA(null);
  const [route, setRoute]   = useStateA({ name: 'home' });
  const prevStore           = useRefA(null);

  const loadData = async (uid) => {
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
        setStore(null);
        setUserId(null);
        prevStore.current = null;
        setRoute({ name: 'home' });
        setPhase('unauthed');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // background sync on every store change
  useEffectA(() => {
    if (!store || !userId || phase !== 'ready') return;
    LB.syncStore(prevStore.current, store, userId).catch(console.error);
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

  switch (route.name) {
    case 'home':          return <window.Screens.HomeScreen {...props} />;
    case 'plan':          return <window.Screens.PlanScreen {...props} />;
    case 'schedule':      return <window.Screens.ScheduleDetailScreen {...props} scheduleId={route.scheduleId} />;
    case 'schedule-new':  return <window.Screens.ScheduleNewScreen {...props} />;
    case 'schedule-edit': return <window.Screens.ScheduleEditScreen {...props} scheduleId={route.scheduleId} />;
    case 'train':         return <window.Screens.TrainingScreen {...props} sessionId={route.sessionId} />;
    case 'lib':           return <window.Screens.LibraryScreen {...props} />;
    case 'exercise':      return <window.Screens.ExerciseDetailScreen {...props} exId={route.exId} />;
    case 'hist':          return <window.Screens.HistoryScreen {...props} />;
    case 'session':       return <window.Screens.SessionDetailScreen {...props} sessionId={route.sessionId} justFinished={route.justFinished} />;
    case 'settings':      return <window.Screens.SettingsScreen {...props} />;
    default:              return <window.Screens.HomeScreen {...props} />;
  }
}

function tryMount() {
  if (window.LB && window.supabase && window.Screens?.LoginScreen && window.Screens?.HomeScreen) {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  } else {
    setTimeout(tryMount, 50);
  }
}
tryMount();
