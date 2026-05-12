function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Main App — auth + routing */

const {
  useState: useStateA,
  useEffect: useEffectA,
  useRef: useRefA
} = React;
function LoadingScreen() {
  return /*#__PURE__*/React.createElement(Screen, {
    scroll: false,
    style: {
      justifyContent: 'center',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      fontWeight: 600,
      color: UI.gold,
      letterSpacing: '0.06em',
      marginBottom: 10
    }
  }, "LOGBOOK"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: UI.inkFaint,
      fontFamily: UI.fontNum,
      letterSpacing: '0.1em'
    }
  }, "Laden\u2026")));
}
function App() {
  const [phase, setPhase] = useStateA('init'); // 'init' | 'loading' | 'ready' | 'unauthed'
  const [store, setStore] = useStateA(null);
  const [userId, setUserId] = useStateA(null);
  const [route, setRoute] = useStateA({
    name: 'home'
  });
  const prevStore = useRefA(null);
  const loadData = async uid => {
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
    const {
      data: {
        subscription
      }
    } = LB.supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (session) {
          setUserId(session.user.id);
          loadData(session.user.id);
        } else {
          setPhase('unauthed');
        }
      } else if (event === 'SIGNED_IN') {
        setUserId(session.user.id);
        loadData(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        setStore(null);
        setUserId(null);
        prevStore.current = null;
        setRoute({
          name: 'home'
        });
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
  window.__createExercise = name => {
    const id = LB.uid();
    setStore(s => ({
      ...s,
      exercises: [...s.exercises, {
        id,
        name: name.trim(),
        tags: []
      }]
    }));
    return id;
  };
  if (phase === 'init' || phase === 'loading') return /*#__PURE__*/React.createElement(LoadingScreen, null);
  if (phase === 'unauthed') return /*#__PURE__*/React.createElement(window.Screens.LoginScreen, null);
  const go = r => setRoute(r);
  const props = {
    store,
    setStore,
    go,
    userId
  };
  switch (route.name) {
    case 'home':
      return /*#__PURE__*/React.createElement(window.Screens.HomeScreen, props);
    case 'plan':
      return /*#__PURE__*/React.createElement(window.Screens.PlanScreen, props);
    case 'schedule':
      return /*#__PURE__*/React.createElement(window.Screens.ScheduleDetailScreen, _extends({}, props, {
        scheduleId: route.scheduleId
      }));
    case 'schedule-new':
      return /*#__PURE__*/React.createElement(window.Screens.ScheduleNewScreen, props);
    case 'schedule-edit':
      return /*#__PURE__*/React.createElement(window.Screens.ScheduleEditScreen, _extends({}, props, {
        scheduleId: route.scheduleId
      }));
    case 'train':
      return /*#__PURE__*/React.createElement(window.Screens.TrainingScreen, _extends({}, props, {
        sessionId: route.sessionId
      }));
    case 'lib':
      return /*#__PURE__*/React.createElement(window.Screens.LibraryScreen, props);
    case 'exercise':
      return /*#__PURE__*/React.createElement(window.Screens.ExerciseDetailScreen, _extends({}, props, {
        exId: route.exId
      }));
    case 'hist':
      return /*#__PURE__*/React.createElement(window.Screens.HistoryScreen, props);
    case 'session':
      return /*#__PURE__*/React.createElement(window.Screens.SessionDetailScreen, _extends({}, props, {
        sessionId: route.sessionId,
        justFinished: route.justFinished
      }));
    case 'settings':
      return /*#__PURE__*/React.createElement(window.Screens.SettingsScreen, props);
    default:
      return /*#__PURE__*/React.createElement(window.Screens.HomeScreen, props);
  }
}
function tryMount() {
  if (window.LB && window.Screens?.LoginScreen && window.Screens?.HomeScreen && window.Screens?.LibraryScreen && window.Screens?.TrainingScreen) {
    ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
  } else {
    setTimeout(tryMount, 50);
  }
}
tryMount();
