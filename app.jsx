/* Main App — routing + state glue */

const { useState: useStateA, useEffect: useEffectA } = React;

function App() {
  const [store, setStore] = useStateA(() => LB.loadStore());
  const [route, setRoute] = useStateA({ name: 'home' });

  // persist on every change
  useEffectA(() => { LB.saveStore(store); }, [store]);

  // auto-advance cycle: if user opens app on a new calendar day and didn't open
  // training, we keep the cycleIndex untouched (advance happens on session finish)

  // helper for in-sheet "+ new exercise"
  window.__createExercise = (name) => {
    const id = LB.uid();
    setStore(s => ({ ...s, exercises: [...s.exercises, { id, name: name.trim(), tags: [] }] }));
    return id;
  };

  if (!store.user) {
    return <window.Screens.LoginScreen onLogin={(name) => {
      setStore(s => LB.seedStarter({ ...s, user: { name } }));
    }} />;
  }

  const go = (r) => setRoute(r);
  const props = { store, setStore, go };

  switch (route.name) {
    case 'home':            return <window.Screens.HomeScreen {...props} />;
    case 'plan':            return <window.Screens.PlanScreen {...props} />;
    case 'schedule':        return <window.Screens.ScheduleDetailScreen {...props} scheduleId={route.scheduleId} />;
    case 'schedule-new':    return <window.Screens.ScheduleNewScreen {...props} />;
    case 'schedule-edit':   return <window.Screens.ScheduleEditScreen {...props} scheduleId={route.scheduleId} />;
    case 'train':           return <window.Screens.TrainingScreen {...props} sessionId={route.sessionId} />;
    case 'lib':             return <window.Screens.LibraryScreen {...props} />;
    case 'exercise':        return <window.Screens.ExerciseDetailScreen {...props} exId={route.exId} />;
    case 'hist':            return <window.Screens.HistoryScreen {...props} />;
    case 'session':         return <window.Screens.SessionDetailScreen {...props} sessionId={route.sessionId} justFinished={route.justFinished} />;
    case 'settings':        return <window.Screens.SettingsScreen {...props} />;
    default:                return <window.Screens.HomeScreen {...props} />;
  }
}

function tryMount() {
  if (window.LB && window.Screens?.LoginScreen && window.Screens?.HomeScreen && window.Screens?.TrainingScreen && window.Screens?.LibraryScreen) {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  } else {
    setTimeout(tryMount, 50);
  }
}
tryMount();
