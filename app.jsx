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
