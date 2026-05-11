/* Library + History + Session detail + Settings */

const { useState: useStateL, useMemo: useMemoL } = React;

// ─── LIBRARY ──────────────────────────────────────────────────────────
function LibraryScreen({ store, setStore, go }) {
  const [tab, setTab] = useStateL('recent');
  const [q, setQ] = useStateL('');
  const [creating, setCreating] = useStateL(false);

  const recent = useMemoL(() => {
    const seen = new Map();
    [...store.sessions].filter(s => s.ended).sort((a,b) => (b.ended||'').localeCompare(a.ended||'')).forEach(s => {
      s.entries.forEach(e => { if (!seen.has(e.exId)) seen.set(e.exId, s.ended); });
    });
    return store.exercises
      .filter(e => seen.has(e.id))
      .sort((a,b) => (seen.get(b.id)||'').localeCompare(seen.get(a.id)||''))
      .slice(0, 12)
      .map(e => ({ ex: e, last: seen.get(e.id) }));
  }, [store.exercises, store.sessions]);

  const filtered = useMemoL(() => {
    const ql = q.toLowerCase();
    return store.exercises
      .filter(e => !q || e.name.toLowerCase().includes(ql) || e.tags?.some(t => t.includes(ql)))
      .sort((a,b) => a.name.localeCompare(b.name));
  }, [store.exercises, q]);

  return (
    <Screen>
      <TopBar title="Library"
        right={<Btn kind="icon" onClick={() => setCreating(true)} style={{ color: UI.gold, fontSize: 22, fontWeight: 300 }}>+</Btn>} />
      <div style={{ display: 'flex', padding: '0 18px', gap: 0, borderBottom: `1px solid ${UI.inkLine}` }}>
        {[['recent','Zuletzt'],['all','Alle']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, background: 'transparent', border: 'none',
            padding: '12px 0', cursor: 'pointer',
            color: tab === id ? UI.gold : UI.inkSoft,
            fontFamily: UI.fontUi, fontSize: 14, fontWeight: tab === id ? 600 : 500,
            borderBottom: `2px solid ${tab === id ? UI.gold : 'transparent'}`,
            marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {tab === 'all' && (
          <Input value={q} onChange={setQ} placeholder="Suchen…" />
        )}

        {tab === 'recent' && recent.length === 0 && (
          <Empty title="Noch nichts trainiert" sub="Sobald du Sessions loggst, erscheinen Übungen hier." />
        )}

        {tab === 'recent' && recent.map(({ ex, last }) => {
          const days = Math.round((Date.now() - new Date(last)) / 86400000);
          const lastEntry = LB.lastSessionForExercise(store, ex.id)?.entry;
          const top = lastEntry?.sets?.[0];
          return (
            <Card key={ex.id} onClick={() => go({ name: 'exercise', exId: ex.id })} style={{ cursor: 'pointer', padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{ex.name}</div>
                  <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontNum, marginTop: 2 }}>
                    {days === 0 ? 'heute' : `${days}d her`}
                    {top && ` · letztes Set: ${top.kg}kg × ${top.reps}`}
                  </div>
                </div>
                <span style={{ color: UI.gold, fontSize: 18 }}>›</span>
              </div>
            </Card>
          );
        })}

        {tab === 'all' && filtered.map(e => (
          <Card key={e.id} onClick={() => go({ name: 'exercise', exId: e.id })} style={{ cursor: 'pointer', padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{e.name}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  {e.tags?.map(t => <Pill key={t}>{t}</Pill>)}
                </div>
              </div>
              <span style={{ color: UI.gold, fontSize: 18 }}>›</span>
            </div>
          </Card>
        ))}
        {tab === 'all' && filtered.length === 0 && (
          <Empty title="Keine Übungen" action={<Btn onClick={() => setCreating(true)}>Übung anlegen</Btn>} />
        )}
      </div>
      <TabBar active="lib" onChange={(t) => go({ name: t })} />
      {creating && <ExerciseCreator onClose={() => setCreating(false)} setStore={setStore} />}
    </Screen>
  );
}

function ExerciseCreator({ onClose, setStore, onCreated }) {
  const [name, setName] = useStateL('');
  const [tags, setTags] = useStateL('');
  const save = () => {
    if (!name.trim()) return;
    const ex = { id: LB.uid(), name: name.trim(), tags: tags.split(',').map(t => t.trim()).filter(Boolean) };
    setStore(s => ({ ...s, exercises: [...s.exercises, ex] }));
    onCreated?.(ex.id);
    onClose();
  };
  return (
    <Sheet open={true} onClose={onClose} title="Neue Übung">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input label="Name" value={name} onChange={setName} placeholder="z.B. Front Squat" autoFocus />
        <Input label="Tags (komma-getrennt)" value={tags} onChange={setTags} placeholder="legs, compound, barbell" />
        <Btn onClick={save} style={{ opacity: name.trim() ? 1 : 0.4 }} disabled={!name.trim()}>Anlegen</Btn>
      </div>
    </Sheet>
  );
}

// ─── EXERCISE DETAIL ─────────────────────────────────────────────────
function ExerciseDetailScreen({ store, setStore, go, exId }) {
  const ex = LB.findExercise(store, exId);
  if (!ex) { go({ name: 'lib' }); return null; }

  const history = useMemoL(() => {
    return store.sessions
      .filter(s => s.ended && s.entries.some(e => e.exId === exId))
      .sort((a,b) => (b.ended||'').localeCompare(a.ended||''))
      .map(s => ({ session: s, entry: s.entries.find(e => e.exId === exId) }));
  }, [store.sessions, exId]);

  // 1RM estimate per session (Epley: kg * (1 + reps/30))
  const points = history.map(h => {
    const best = (h.entry.sets || []).filter(s => s.kg && s.reps)
      .reduce((m, s) => Math.max(m, s.kg * (1 + s.reps / 30)), 0);
    return { date: h.session.ended, est: best };
  }).filter(p => p.est > 0).reverse();

  const pr = points.length ? Math.max(...points.map(p => p.est)) : 0;
  const last = points[points.length - 1]?.est;
  const first = points[0]?.est;
  const growth = first && last ? ((last - first) / first) * 100 : 0;

  return (
    <Screen>
      <TopBar title={ex.name} sub={ex.tags?.join(' · ') || ''} onBack={() => go({ name: 'lib' })} />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <Card style={{ padding: 12 }}>
            <Label>PR (1RM)</Label>
            <div style={{ fontFamily: UI.fontNum, fontSize: 22, color: UI.gold }}>{pr ? Math.round(pr) : '—'}</div>
          </Card>
          <Card style={{ padding: 12 }}>
            <Label>Letzte</Label>
            <div style={{ fontFamily: UI.fontNum, fontSize: 22 }}>{last ? Math.round(last) : '—'}</div>
          </Card>
          <Card style={{ padding: 12 }}>
            <Label>Sessions</Label>
            <div style={{ fontFamily: UI.fontNum, fontSize: 22 }}>{history.length}</div>
          </Card>
        </div>

        {points.length > 1 && <ProgressChart points={points} />}

        <div>
          <Label>Verlauf</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.slice(0, 10).map(h => (
              <Card key={h.session.id} style={{ padding: 10 }}
                onClick={() => go({ name: 'session', sessionId: h.session.id })}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontNum, letterSpacing: '0.05em' }}>
                  <span>{new Date(h.session.ended).toLocaleDateString('de-DE', { day:'2-digit', month:'short', year:'2-digit' })}</span>
                  <span>{h.session.dayName}</span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6, fontFamily: UI.fontNum, fontSize: 13 }}>
                  {h.entry.sets.filter(s => s.kg).map((s, i) => (
                    <span key={i}>{s.kg}<span style={{ color: UI.inkFaint }}>×</span>{s.reps}</span>
                  ))}
                </div>
                {h.entry.note && <div style={{ fontSize: 11, color: UI.inkFaint, marginTop: 4, fontStyle: 'italic' }}>"{h.entry.note}"</div>}
              </Card>
            ))}
            {history.length === 0 && <Empty title="Noch nicht trainiert" />}
          </div>
        </div>
      </div>
    </Screen>
  );
}

function ProgressChart({ points }) {
  const w = 280, h = 110, pad = 8;
  const max = Math.max(...points.map(p => p.est));
  const min = Math.min(...points.map(p => p.est));
  const range = max - min || 1;
  const xy = points.map((p, i) => {
    const x = pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p.est - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const path = xy.map(([x,y], i) => `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <Card style={{ padding: 12 }}>
      <Label>Geschätzter 1RM · Verlauf</Label>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>
        <path d={path} fill="none" stroke={UI.gold} strokeWidth="1.5" />
        {xy.map(([x,y], i) => (
          <circle key={i} cx={x} cy={y} r="2.5" fill={UI.gold} />
        ))}
      </svg>
    </Card>
  );
}

// ─── HISTORY ─────────────────────────────────────────────────────────
function HistoryScreen({ store, go }) {
  const sessions = useMemoL(() => {
    return [...store.sessions]
      .filter(s => s.ended)
      .sort((a,b) => (b.ended||'').localeCompare(a.ended||''));
  }, [store.sessions]);

  return (
    <Screen>
      <TopBar title="History" />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sessions.length === 0 && (
          <Empty title="Keine Sessions" sub="Logge dein erstes Training, um Verlauf zu sehen." />
        )}
        {sessions.map(s => {
          const setsLogged = s.entries.reduce((c, e) => c + e.sets.filter(x => x.done).length, 0);
          const vol = totalVolume(s);
          const date = new Date(s.ended);
          const days = Math.round((Date.now() - date) / 86400000);
          return (
            <Card key={s.id} onClick={() => go({ name: 'session', sessionId: s.id })} style={{ cursor: 'pointer', padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontNum, letterSpacing: '0.1em' }}>
                  {date.toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' }).toUpperCase()} · {days === 0 ? 'HEUTE' : `${days}D HER`}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{s.dayName}</div>
                <div style={{ fontSize: 12, color: UI.gold, fontFamily: UI.fontNum }}>{vol.toLocaleString('de-DE')} kg</div>
              </div>
              <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 2 }}>
                {s.entries.length} Übungen · {setsLogged} Sets
              </div>
            </Card>
          );
        })}
      </div>
      <TabBar active="hist" onChange={(t) => go({ name: t })} />
    </Screen>
  );
}

// ─── SESSION DETAIL ──────────────────────────────────────────────────
function SessionDetailScreen({ store, go, sessionId, justFinished }) {
  const s = store.sessions.find(x => x.id === sessionId);
  if (!s) { go({ name: 'hist' }); return null; }
  const vol = totalVolume(s);
  const duration = s.ended && s.date ? Math.round((new Date(s.ended) - new Date(s.date)) / 60000) : null;

  return (
    <Screen>
      <TopBar title={s.dayName}
        sub={new Date(s.ended || s.date).toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' })}
        onBack={() => go({ name: justFinished ? 'home' : 'hist' })} />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {justFinished && (
          <Card accent style={{ textAlign: 'center', padding: 18 }}>
            <div style={{ fontSize: 11, color: UI.gold, fontFamily: UI.fontNum, letterSpacing: '0.15em' }}>SESSION KOMPLETT</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: UI.gold, marginTop: 4 }}>Stark gemacht 💪</div>
          </Card>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <Card style={{ padding: 12 }}>
            <Label>Dauer</Label>
            <div style={{ fontFamily: UI.fontNum, fontSize: 20 }}>{duration ?? '—'}<span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 2 }}>min</span></div>
          </Card>
          <Card style={{ padding: 12 }}>
            <Label>Volumen</Label>
            <div style={{ fontFamily: UI.fontNum, fontSize: 20 }}>{Math.round(vol).toLocaleString('de-DE')}<span style={{ fontSize: 11, color: UI.inkFaint, marginLeft: 2 }}>kg</span></div>
          </Card>
          <Card style={{ padding: 12 }}>
            <Label>Sets</Label>
            <div style={{ fontFamily: UI.fontNum, fontSize: 20 }}>{s.entries.reduce((c,e) => c + e.sets.filter(x => x.done).length, 0)}</div>
          </Card>
        </div>
        {s.entries.map((e, i) => (
          <Card key={i} style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{e.name}</div>
              <Pill>{e.sets.filter(x => x.done).length} / {e.sets.length}</Pill>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: UI.fontNum, fontSize: 13 }}>
              {e.sets.map((st, j) => (
                <span key={j} style={{ opacity: st.done ? 1 : 0.35 }}>
                  {st.kg ?? '—'}<span style={{ color: UI.inkFaint }}>×</span>{st.reps ?? '—'}
                </span>
              ))}
            </div>
            {e.note && <div style={{ fontSize: 12, color: UI.inkFaint, marginTop: 6, fontStyle: 'italic' }}>"{e.note}"</div>}
          </Card>
        ))}
      </div>
    </Screen>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────
function SettingsScreen({ store, setStore, go }) {
  const exportData = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `logbook-${LB.todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const reset = () => {
    if (!confirm('Wirklich ALLE Daten löschen? Diese Aktion ist nicht rückgängig zu machen.')) return;
    LB.resetStore();
    location.reload();
  };
  return (
    <Screen>
      <TopBar title="Einstellungen" onBack={() => go({ name: 'home' })} />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Card>
          <Label>User</Label>
          <div style={{ fontSize: 16, fontWeight: 500 }}>{store.user?.name}</div>
        </Card>
        <Card>
          <Label>Pause Default</Label>
          <Stepper
            value={store.settings?.restDefault || 120}
            step={15} min={0} suffix="s"
            onChange={(v) => setStore(s => ({ ...s, settings: { ...s.settings, restDefault: v } }))}
          />
        </Card>
        <Btn kind="ghost" onClick={exportData}>Daten exportieren (JSON)</Btn>
        <Btn kind="ghost" onClick={reset} style={{ color: UI.danger, borderColor: 'rgba(200,116,105,0.25)' }}>Alle Daten löschen</Btn>
        <div style={{ fontSize: 11, color: UI.inkFaint, textAlign: 'center', marginTop: 8 }}>
          Logbook · v1.0 · alles in deinem Browser
        </div>
      </div>
    </Screen>
  );
}

Object.assign(window.Screens, { LibraryScreen, ExerciseCreator, ExerciseDetailScreen, HistoryScreen, SessionDetailScreen, SettingsScreen });
