/* Library + History + Session detail + Settings */

const { useState: useStateL, useMemo: useMemoL } = React;

// ─── LIBRARY ──────────────────────────────────────────────────────────
function LibraryScreen({ store, setStore, go }) {
  const [confirmEl, confirm] = useConfirm();
  const [tab, setTab] = useStateL('recent');
  const [q, setQ] = useStateL('');
  const [creating, setCreating] = useStateL(false);
  const [selecting, setSelecting] = useStateL(false);
  const [selected, setSelected] = useStateL(new Set());
  const [filterTags, setFilterTags] = useStateL([]);
  const toggleFilter = (m) => setFilterTags(t => t.includes(m) ? t.filter(x => x !== m) : [...t, m]);

  const exitSelect = () => { setSelecting(false); setSelected(new Set()); };

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const deleteSelected = async () => {
    if (!await confirm(`Bisherige Sessions bleiben erhalten.`, { title: `${selected.size} Übung${selected.size > 1 ? 'en' : ''} löschen?`, ok: 'Löschen', danger: true })) return;
    setStore(s => ({ ...s, exercises: s.exercises.filter(e => !selected.has(e.id)) }));
    exitSelect();
  };

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
    const ql = q.toUpperCase();
    return store.exercises
      .filter(e => {
        const matchSearch = !q || e.name.toUpperCase().includes(ql) || e.tags?.some(t => t.toUpperCase().includes(ql));
        const matchTags = filterTags.length === 0 || filterTags.some(ft => e.tags?.includes(ft));
        return matchSearch && matchTags;
      })
      .sort((a,b) => a.name.localeCompare(b.name));
  }, [store.exercises, q, filterTags]);

  const topBarRight = selecting ? (
    <button onClick={exitSelect} style={{ background: 'none', border: 'none', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 14, cursor: 'pointer', padding: '4px 8px' }}>
      Abbrechen
    </button>
  ) : (
    <div style={{ display: 'flex', gap: 8 }}>
      {store.exercises.length > 0 && (
        <Btn kind="icon" onClick={() => { setTab('all'); setSelecting(true); }} style={{ color: UI.inkSoft, fontSize: 15, border: `1px solid ${UI.inkLine}`, borderRadius: 999, padding: '6px 14px' }}>☑ Auswählen</Btn>
      )}
      <Btn kind="icon" onClick={() => setCreating(true)} style={{ color: UI.gold, fontSize: 20, fontWeight: 400, background: UI.goldFaint, border: `1px solid ${UI.goldSoft}`, borderRadius: 999, padding: '6px 16px' }}>+</Btn>
    </div>
  );

  return (
    <Screen>
      <TopBar title="Library" right={topBarRight} />
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

      <div style={{ padding: 18, paddingBottom: selecting ? 80 : 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {tab === 'all' && (
          <>
            <Input value={q} onChange={setQ} placeholder="SUCHEN…" />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {MUSCLES.map(m => (
                <Pill key={m} gold={filterTags.includes(m)} onClick={() => toggleFilter(m)}
                  style={{ cursor: 'pointer' }}>{m}</Pill>
              ))}
            </div>
          </>
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

        {tab === 'all' && filtered.map(e => {
          const isSelected = selected.has(e.id);
          return (
            <Card key={e.id}
              onClick={() => selecting ? toggleSelect(e.id) : go({ name: 'exercise', exId: e.id })}
              style={{
                cursor: 'pointer', padding: 14,
                borderColor: isSelected ? UI.danger : undefined,
                background: isSelected ? 'rgba(200,116,105,0.08)' : undefined,
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{e.name}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {e.tags?.map(t => <Pill key={t}>{t}</Pill>)}
                  </div>
                </div>
                {selecting ? (
                  <div style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                    border: `2px solid ${isSelected ? UI.danger : UI.inkLine}`,
                    background: isSelected ? UI.danger : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && <span style={{ color: '#fff', fontSize: 13, lineHeight: 1 }}>✓</span>}
                  </div>
                ) : (
                  <span style={{ color: UI.gold, fontSize: 18 }}>›</span>
                )}
              </div>
            </Card>
          );
        })}
        {tab === 'all' && filtered.length === 0 && (
          <Empty title="Keine Übungen" action={<Btn onClick={() => setCreating(true)}>Übung anlegen</Btn>} />
        )}
      </div>

      {selecting && (
        <div style={{
          position: 'fixed', bottom: 'calc(56px + env(safe-area-inset-bottom, 8px))',
          left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: 440,
          padding: '12px 18px',
          background: UI.bgRaised, borderTop: `1px solid ${UI.inkLine}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          zIndex: 15,
        }}>
          <span style={{ fontSize: 13, color: UI.inkSoft }}>
            {selected.size === 0 ? 'Übungen antippen zum Auswählen' : `${selected.size} ausgewählt`}
          </span>
          <Btn kind="ghost" onClick={deleteSelected}
            disabled={selected.size === 0}
            style={{ color: UI.danger, borderColor: 'rgba(200,116,105,0.25)', opacity: selected.size === 0 ? 0.4 : 1, minHeight: 38, padding: '8px 16px', fontSize: 13 }}>
            Löschen
          </Btn>
        </div>
      )}

      {creating && <ExerciseCreator onClose={() => setCreating(false)} setStore={setStore} />}
      {confirmEl}
    </Screen>
  );
}

function ExerciseCreator({ onClose, setStore, onCreated }) {
  const [name, setName] = useStateL('');
  const [selectedTags, setSelectedTags] = useStateL([]);
  const toggleTag = (m) => setSelectedTags(t => t.includes(m) ? t.filter(x => x !== m) : [...t, m]);
  const save = () => {
    if (!name.trim()) return;
    const ex = { id: LB.uid(), name: name.trim(), tags: selectedTags, note: '' };
    setStore(s => ({ ...s, exercises: [...s.exercises, ex] }));
    onCreated?.(ex.id);
    onClose();
  };
  return (
    <Sheet open={true} onClose={onClose} title="Neue Übung">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input label="Name" value={name} onChange={setName} placeholder="Z.B. BANKDRÜCKEN" autoFocus />
        <div>
          <Label>Muskelgruppe</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {MUSCLES.map(m => (
              <Pill key={m} gold={selectedTags.includes(m)} onClick={() => toggleTag(m)}
                style={{ cursor: 'pointer' }}>{m}</Pill>
            ))}
          </div>
        </div>
        <Btn onClick={save} style={{ opacity: name.trim() ? 1 : 0.4 }} disabled={!name.trim()}>Anlegen</Btn>
      </div>
    </Sheet>
  );
}

// ─── EXERCISE DETAIL ─────────────────────────────────────────────────
function ExerciseDetailScreen({ store, setStore, go, exId }) {
  const ex = LB.findExercise(store, exId);
  if (!ex) { go({ name: 'lib' }); return null; }

  const [confirmEl, confirm] = useConfirm();
  const [editMode, setEditMode] = useStateL(false);
  const [editName, setEditName] = useStateL('');
  const [editTags, setEditTags] = useStateL([]);
  const [editNote, setEditNote] = useStateL(false);
  const [noteVal, setNoteVal] = useStateL(ex.note || '');

  const startEdit = () => { setEditName(ex.name); setEditTags([...(ex.tags || [])]); setEditMode(true); };
  const cancelEdit = () => setEditMode(false);
  const saveEdit = () => {
    if (!editName.trim()) return;
    setStore(s => ({ ...s, exercises: s.exercises.map(e => e.id === exId ? { ...e, name: editName.trim(), tags: editTags } : e) }));
    setEditMode(false);
  };
  const toggleEditTag = (m) => setEditTags(t => t.includes(m) ? t.filter(x => x !== m) : [...t, m]);

  const saveNote = () => {
    setStore(s => ({ ...s, exercises: s.exercises.map(e => e.id === exId ? { ...e, note: noteVal.trim() } : e) }));
    setEditNote(false);
  };

  const deleteExercise = async () => {
    if (!await confirm('Bisherige Sessions bleiben erhalten.', { title: `"${ex.name}" löschen?`, ok: 'Löschen', danger: true })) return;
    setStore(s => ({ ...s, exercises: s.exercises.filter(e => e.id !== exId) }));
    go({ name: 'lib' });
  };

  const history = useMemoL(() => {
    return store.sessions
      .filter(s => s.ended && s.entries.some(e => e.exId === exId))
      .sort((a,b) => (b.ended||'').localeCompare(a.ended||''))
      .map(s => ({ session: s, entry: s.entries.find(e => e.exId === exId) }));
  }, [store.sessions, exId]);

  const points = history.map(h => {
    const best = (h.entry.sets || []).filter(s => s.kg && s.reps)
      .reduce((m, s) => Math.max(m, s.kg * (1 + s.reps / 30)), 0);
    return { date: h.session.ended, est: best };
  }).filter(p => p.est > 0).reverse();

  const pr = points.length ? Math.max(...points.map(p => p.est)) : 0;
  const last = points[points.length - 1]?.est;
  const first = points[0]?.est;

  return (
    <Screen>
      <TopBar title={ex.name} onBack={() => { if (editMode) cancelEdit(); else go({ name: 'lib' }); }}
        right={
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <button onClick={editMode ? saveEdit : startEdit} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: UI.gold, fontSize: 13, fontFamily: UI.fontUi, padding: '4px 8px',
            }}>{editMode ? 'Speichern' : 'Bearbeiten'}</button>
            {!editMode && <button onClick={deleteExercise} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: UI.danger, fontSize: 20, padding: '4px 8px', lineHeight: 1,
            }}>🗑</button>}
          </div>
        }
      />

      {/* tags / edit panel */}
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${UI.inkLine}` }}>
        {editMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input label="Name" value={editName} onChange={setEditName} />
            <div>
              <Label>Muskelgruppe</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {MUSCLES.map(m => (
                  <Pill key={m} gold={editTags.includes(m)} onClick={() => toggleEditTag(m)}
                    style={{ cursor: 'pointer' }}>{m}</Pill>
                ))}
              </div>
            </div>
            <Btn kind="ghost" onClick={cancelEdit} style={{ fontSize: 13 }}>Abbrechen</Btn>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(ex.tags || []).length > 0
              ? ex.tags.map(t => <Pill key={t} gold>{t}</Pill>)
              : <span style={{ fontSize: 12, color: UI.inkFaint, fontStyle: 'italic' }}>Keine Muskelgruppe — Bearbeiten zum Hinzufügen</span>}
          </div>
        )}
      </div>

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

        <Card style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: editNote ? 10 : (ex.note ? 8 : 0) }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>📌 Notiz</div>
            <button onClick={() => { setNoteVal(ex.note || ''); setEditNote(v => !v); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.gold, fontSize: 13, fontFamily: UI.fontUi, padding: '2px 0' }}>
              {editNote ? 'Abbrechen' : 'Bearbeiten'}
            </button>
          </div>
          {editNote ? (
            <>
              <textarea value={noteVal} onChange={e => setNoteVal(e.target.value)}
                placeholder="z.B. Kabelzug Pos 4, Griff neutral, langsam ablassen"
                rows={3}
                style={{ width: '100%', boxSizing: 'border-box', background: UI.bgInset, border: `1px solid ${UI.inkLine}`, borderRadius: 10, padding: '10px 12px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, resize: 'vertical', outline: 'none' }}
              />
              <Btn onClick={saveNote} style={{ marginTop: 10, width: '100%' }}>Speichern</Btn>
            </>
          ) : (
            <div style={{ fontSize: 14, color: ex.note ? UI.inkSoft : UI.inkFaint, lineHeight: 1.5, whiteSpace: 'pre-wrap', fontStyle: ex.note ? 'normal' : 'italic' }}>
              {ex.note || 'Noch keine Notiz. Tippe Bearbeiten zum Hinzufügen.'}
            </div>
          )}
        </Card>

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
      {confirmEl}
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
    </Screen>
  );
}

// ─── SESSION DETAIL ──────────────────────────────────────────────────
function SessionDetailScreen({ store, go, sessionId, justFinished }) {
  const s = store.sessions.find(x => x.id === sessionId);
  if (!s) { go({ name: 'hist' }); return null; }
  const vol = totalVolume(s);
  const duration = s.ended && (s.startedAt ?? s.date) ? Math.round((new Date(s.ended) - new Date(s.startedAt ?? s.date)) / 60000) : null;

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
function SettingsScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [nickname, setNickname] = useStateL(store.user?.name || '');

  const saveNickname = () => {
    const trimmed = nickname.trim();
    if (!trimmed || trimmed === store.user?.name) return;
    setStore(s => ({ ...s, user: { ...s.user, name: trimmed } }));
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `logbook-${LB.todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSignOut = async () => {
    await LB.signOut();
  };

  const handleDeleteAll = async () => {
    if (!await confirm('Diese Aktion ist nicht rückgängig zu machen.', { title: 'Alle Daten löschen?', ok: 'Alles löschen', danger: true })) return;
    await LB.deleteAllData(userId);
    await LB.signOut();
  };

  return (
    <Screen>
      <TopBar title="Einstellungen" onBack={() => go({ name: 'home' })} />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Card>
          <Label>Spitzname</Label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <input
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              onBlur={saveNickname}
              onKeyDown={e => e.key === 'Enter' && (e.target.blur())}
              placeholder="Dein Name"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: UI.ink, fontFamily: UI.fontUi, fontSize: 16, padding: 0,
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: UI.inkFaint, marginTop: 6 }}>
            Eingeloggt als {store.user?.email || userId}
          </div>
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
        <Btn kind="ghost" onClick={async () => {
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
          window.location.reload(true);
        }}>App-Cache leeren & neu laden</Btn>
        <Btn kind="ghost" onClick={handleSignOut} style={{ color: UI.danger, borderColor: 'rgba(200,116,105,0.25)' }}>
          Ausloggen
        </Btn>
        <Btn kind="ghost" onClick={handleDeleteAll} style={{ color: UI.danger, borderColor: 'rgba(200,116,105,0.25)', opacity: 0.6 }}>
          Alle Daten löschen
        </Btn>
        <div style={{ fontSize: 11, color: UI.inkFaint, textAlign: 'center', marginTop: 8 }}>
          Logbook · v1.0 · Daten in Supabase
        </div>
      </div>
      {confirmEl}
    </Screen>
  );
}

Object.assign(window.Screens, { LibraryScreen, ExerciseCreator, ExerciseDetailScreen, HistoryScreen, SessionDetailScreen, SettingsScreen });
