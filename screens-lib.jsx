/* Library + History + Session detail + Settings */

const { useState: useStateL, useMemo: useMemoL, useRef: useRefL, useEffect: useEffectL } = React;

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
    const sortedSessions = [...store.sessions].filter(s => s.ended).sort((a,b) => (b.ended||'').localeCompare(a.ended||''));
    const lastTwo = new Map();
    const seenFirst = new Map();
    sortedSessions.forEach(s => {
      s.entries.forEach(e => {
        const arr = lastTwo.get(e.exId) || [];
        if (arr.length < 2) {
          lastTwo.set(e.exId, [...arr, s]);
          if (arr.length === 0) seenFirst.set(e.exId, s.ended);
        }
      });
    });
    const e1rm = (entry) => entry
      ? Math.max(0, ...(entry.sets || []).filter(s => s.kg && s.reps).map(s => s.kg * (1 + s.reps / 30)), 0)
      : 0;
    return store.exercises
      .filter(e => seenFirst.has(e.id))
      .sort((a,b) => (seenFirst.get(b.id)||'').localeCompare(seenFirst.get(a.id)||''))
      .slice(0, 12)
      .map(e => {
        const [sess0, sess1] = lastTwo.get(e.id) || [];
        const lastEntry = sess0?.entries.find(en => en.exId === e.id);
        const prevEntry = sess1?.entries.find(en => en.exId === e.id);
        const cur = e1rm(lastEntry), prev = e1rm(prevEntry);
        const trend = cur > 0 && prev > 0
          ? cur > prev * 1.005 ? 'up' : cur < prev * 0.995 ? 'down' : 'same'
          : null;
        return { ex: e, last: seenFirst.get(e.id), lastEntry, trend };
      });
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
    <button onClick={exitSelect} style={{ background: 'none', border: 'none', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', padding: '4px 8px' }}>
      Abbrechen
    </button>
  ) : (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {store.exercises.length > 0 && (
        <button onClick={() => { setTab('all'); setSelecting(true); }} style={{
          background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
          borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
          color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>Auswählen</button>
      )}
      <button onClick={() => setCreating(true)} style={{
        width: 32, height: 32, borderRadius: '50%',
        border: `0.5px solid ${UI.goldSoft}`, background: UI.goldFaint,
        color: UI.gold, cursor: 'pointer', fontSize: 20, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>+</button>
    </div>
  );

  return (
    <Screen>
      <TopBar title="Archiv" right={topBarRight} />

      {/* Tab strip */}
      <div style={{ display: 'flex', padding: '0 22px', borderBottom: `0.5px solid ${UI.hair}`, flexShrink: 0 }}>
        {[['recent','Zuletzt'],['all','Alle']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, background: 'transparent', border: 'none',
            padding: '11px 0', cursor: 'pointer',
            color: tab === id ? UI.gold : UI.inkFaint,
            fontFamily: UI.fontUi, fontSize: 10, fontWeight: tab === id ? 600 : 400,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            borderBottom: `0.5px solid ${tab === id ? UI.gold : 'transparent'}`,
            marginBottom: -0.5,
            transition: 'color 0.2s',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: '18px 22px', paddingBottom: selecting ? 80 : 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tab === 'all' && (
          <>
            <div style={{ marginBottom: 4 }}>
              <Field label="">
                <TextInput value={q} onChange={setQ} placeholder="Suchen…" />
              </Field>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              {MUSCLES.map(m => (
                <Pill key={m} gold={filterTags.includes(m)} onClick={() => toggleFilter(m)}
                  style={{ cursor: 'pointer' }}>{m}</Pill>
              ))}
            </div>
          </>
        )}

        {tab === 'recent' && recent.length === 0 && (
          <Empty title="Noch nichts trainiert" sub="Sobald du Sessions loggst, erscheinen Übungen hier." icon={ICON_BARBELL} />
        )}

        {tab === 'recent' && recent.map(({ ex, last, lastEntry, trend }, ri) => {
          const days = Math.round((Date.now() - new Date(last)) / 86400000);
          const top = lastEntry?.sets?.find(s => s.kg);
          const trendColor = trend === 'up' ? UI.ok : trend === 'down' ? UI.danger : UI.inkFaint;
          const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : trend === 'same' ? '→' : null;
          return (
            <div key={ex.id}
              onClick={() => go({ name: 'exercise', exId: ex.id })}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '13px 0',
                borderBottom: ri < recent.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
                cursor: 'pointer',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 19, color: UI.ink, lineHeight: 1.1, marginBottom: 3 }}>{ex.name}</div>
                <div className="num" style={{ fontSize: 10, color: UI.inkFaint, letterSpacing: '0.05em' }}>
                  {days === 0 ? 'heute' : `${days}d her`}
                  {top && ` · ${top.kg}kg × ${top.reps}`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {trendIcon && (
                  <span className="num" style={{ color: trendColor, fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{trendIcon}</span>
                )}
                <ChevronRight />
              </div>
            </div>
          );
        })}

        {tab === 'all' && filtered.map((e, fi) => {
          const isSelected = selected.has(e.id);
          return (
            <div key={e.id}
              onClick={() => selecting ? toggleSelect(e.id) : go({ name: 'exercise', exId: e.id })}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '13px 0',
                borderBottom: fi < filtered.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
                cursor: 'pointer',
                background: isSelected ? 'rgba(200,116,105,0.04)' : 'transparent',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 19, color: isSelected ? UI.danger : UI.ink, lineHeight: 1.1 }}>{e.name}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  {e.tags?.map(t => <Pill key={t}>{t}</Pill>)}
                </div>
              </div>
              {selecting ? (
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  border: `0.5px solid ${isSelected ? UI.danger : UI.hairStrong}`,
                  background: isSelected ? UI.danger : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSelected && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                </div>
              ) : (
                <ChevronRight />
              )}
            </div>
          );
        })}
        {tab === 'all' && filtered.length === 0 && (
          <Empty title="Keine Übungen" action={<Btn onClick={() => setCreating(true)}>Übung anlegen</Btn>} icon={ICON_BARBELL} />
        )}
      </div>

      {selecting && (
        <div style={{
          position: 'fixed', bottom: 'calc(76px + env(safe-area-inset-bottom, 8px))',
          left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: 440,
          padding: '12px 22px',
          background: 'rgba(7,6,10,0.92)', borderTop: `0.5px solid ${UI.hair}`,
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          zIndex: 15,
        }}>
          <span className="micro" style={{ color: UI.inkSoft }}>
            {selected.size === 0 ? 'Übungen antippen zum Auswählen' : `${selected.size} ausgewählt`}
          </span>
          <Btn kind="ghost" onClick={deleteSelected}
            disabled={selected.size === 0}
            style={{ color: UI.danger, borderColor: 'rgba(200,116,105,0.25)', opacity: selected.size === 0 ? 0.4 : 1, minHeight: 36, padding: '6px 14px', fontSize: 11 }}>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Field label="Name">
          <TextInput value={name} onChange={setName} placeholder="z.B. Bankdrücken" autoFocus />
        </Field>
        <div>
          <span className="label">Muskelgruppe</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
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

  return (
    <Screen>
      <ScreenHead
        ref_="ÜBUNG"
        title={editMode ? editName || ex.name : ex.name}
        onBack={() => { if (editMode) cancelEdit(); else go({ name: 'lib' }); }}
        right={
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={editMode ? saveEdit : startEdit} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: UI.gold, fontSize: 11, fontFamily: UI.fontUi, padding: '4px 8px',
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>{editMode ? 'Speichern' : 'Bearbeiten'}</button>
            {!editMode && <button onClick={deleteExercise} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              width: 30, height: 30, borderRadius: '50%',
              border: `0.5px solid rgba(200,116,105,0.3)`,
              color: UI.danger, fontSize: 16, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>}
          </div>
        }
      />
      <Hairline />

      <div style={{ padding: '14px 22px 0' }}>
        {editMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Name">
              <TextInput value={editName} onChange={setEditName} />
            </Field>
            <div>
              <span className="label">Muskelgruppe</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {MUSCLES.map(m => (
                  <Pill key={m} gold={editTags.includes(m)} onClick={() => toggleEditTag(m)}
                    style={{ cursor: 'pointer' }}>{m}</Pill>
                ))}
              </div>
            </div>
            <Btn kind="ghost" onClick={cancelEdit} style={{ fontSize: 11 }}>Abbrechen</Btn>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(ex.tags || []).length > 0
              ? ex.tags.map(t => <Pill key={t} gold>{t}</Pill>)
              : <span className="micro" style={{ fontStyle: 'italic', color: UI.inkFaint }}>Keine Muskelgruppe — Bearbeiten</span>}
          </div>
        )}
      </div>

      <div style={{ padding: '18px 22px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Stats — SubDials */}
        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '6px 0' }}>
          <SubDial label="1RM PR" value={pr ? Math.round(pr) : '—'} sub="kg" size={90} gold />
          <SubDial label="Letzte" value={last ? Math.round(last) : '—'} sub="kg" size={90} />
          <SubDial label="Sessions" value={history.length} size={90} />
        </div>

        {points.length > 1 && <ProgressChart points={points} />}

        {/* Note */}
        <div>
          <Bezel>NOTIZ</Bezel>
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span />
              <button onClick={() => { setNoteVal(ex.note || ''); setEditNote(v => !v); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.gold, fontSize: 10, fontFamily: UI.fontUi, padding: 0, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {editNote ? 'Abbrechen' : 'Bearbeiten'}
              </button>
            </div>
            {editNote ? (
              <div>
                <textarea value={noteVal} onChange={e => setNoteVal(e.target.value)}
                  placeholder="z.B. Kabelzug Pos 4, Griff neutral, langsam ablassen"
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box', background: 'transparent',
                    border: 'none', borderBottom: `0.5px solid ${UI.hairStrong}`,
                    padding: '6px 0', color: UI.ink, fontFamily: UI.fontUi, fontSize: 14,
                    resize: 'none', outline: 'none',
                  }}
                />
                <Btn onClick={saveNote} style={{ marginTop: 12, width: '100%' }}>Speichern</Btn>
              </div>
            ) : (
              <div className="display-it" style={{ fontSize: 16, color: ex.note ? UI.inkSoft : UI.inkFaint, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {ex.note || 'Noch keine Notiz.'}
              </div>
            )}
          </div>
        </div>

        {/* History */}
        <div>
          <Bezel>VERLAUF</Bezel>
          <div style={{ marginTop: 8 }}>
            {history.slice(0, 10).map((h, hi) => (
              <div key={h.session.id}
                onClick={() => go({ name: 'session', sessionId: h.session.id })}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  padding: '12px 0',
                  borderBottom: hi < Math.min(history.length, 10) - 1 ? `0.5px solid ${UI.hair}` : 'none',
                  cursor: 'pointer',
                }}>
                <div>
                  <div className="num" style={{ fontSize: 10, color: UI.inkFaint, letterSpacing: '0.05em', marginBottom: 5 }}>
                    {new Date(h.session.ended).toLocaleDateString('de-DE', { day:'2-digit', month:'short', year:'2-digit' })}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexFamily: UI.fontNum, fontSize: 13 }}>
                    {h.entry.sets.filter(s => s.kg).map((s, i) => (
                      <span key={i} className="num" style={{ fontSize: 13 }}>
                        {s.kg}<span style={{ color: UI.inkFaint }}>×</span>{s.reps}
                      </span>
                    ))}
                  </div>
                  {h.entry.note && <div className="micro" style={{ color: UI.inkFaint, marginTop: 4, fontStyle: 'italic' }}>"{h.entry.note}"</div>}
                </div>
                <span className="micro" style={{ color: UI.inkFaint }}>{h.session.dayName}</span>
              </div>
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
  const w = 280, h = 90, pad = 8;
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
    <div style={{ padding: '10px 0' }}>
      <div className="micro" style={{ marginBottom: 8, color: UI.inkFaint }}>GESCHÄTZTER 1RM · VERLAUF</div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>
        <path d={path} fill="none" stroke={UI.gold} strokeWidth="1" opacity="0.6" />
        {xy.map(([x,y], i) => (
          <circle key={i} cx={x} cy={y} r="2" fill={UI.gold} />
        ))}
      </svg>
    </div>
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
      <TopBar title="Historie" />
      <div style={{ padding: '6px 22px 22px', display: 'flex', flexDirection: 'column' }}>
        {sessions.length === 0 && (
          <Empty title="Keine Sessions" sub="Logge dein erstes Training, um Verlauf zu sehen." icon={ICON_HISTORY} />
        )}
        {sessions.map((s, si) => {
          const setsLogged = s.entries.reduce((c, e) => c + e.sets.filter(x => x.done).length, 0);
          const vol = totalVolume(s);
          const date = new Date(s.date.slice(0, 10) + 'T12:00:00');
          const days = Math.round((Date.now() - date) / 86400000);
          return (
            <div key={s.id}
              onClick={() => go({ name: 'session', sessionId: s.id })}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '16px 0',
                borderBottom: si < sessions.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
                cursor: 'pointer',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 5 }}>
                  {date.toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' }).toUpperCase()} · {days === 0 ? 'HEUTE' : `${days}D HER`}
                </div>
                <div className="display" style={{ fontSize: 21, color: UI.ink, lineHeight: 1.1, marginBottom: 4 }}>{s.dayName}</div>
                <div className="micro" style={{ color: UI.inkFaint }}>
                  {s.entries.length} Übungen · {setsLogged} Sets
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="num" style={{ fontSize: 21, color: UI.gold, lineHeight: 1 }}>
                  {vol.toLocaleString('de-DE')}
                </div>
                <div className="micro" style={{ color: UI.inkFaint, marginTop: 3 }}>kg</div>
              </div>
            </div>
          );
        })}
      </div>
    </Screen>
  );
}

// ─── SESSION DETAIL ──────────────────────────────────────────────────
function SessionDetailScreen({ store, setStore, go, sessionId, justFinished }) {
  const [confirmEl, confirm] = useConfirm();
  const [editing, setEditing] = useStateL(false);
  const [capturing, setCapturing] = useStateL(false);
  const captureRef = useRefL(null);
  const s = store.sessions.find(x => x.id === sessionId);
  if (!s) { go({ name: 'hist' }); return null; }
  const vol = totalVolume(s);
  const duration = s.ended && (s.startedAt ?? s.date) ? Math.round((new Date(s.ended) - new Date(s.startedAt ?? s.date)) / 60000) : null;

  const deleteSession = async () => {
    if (!await confirm('Diese Session wird dauerhaft gelöscht.', { title: 'Session löschen?', ok: 'Löschen', danger: true })) return;
    setStore(s => ({ ...s, sessions: s.sessions.filter(x => x.id !== sessionId) }));
    go({ name: 'hist' });
  };

  const prevEntryMap = {};
  s.entries.forEach(e => {
    const prev = store.sessions
      .filter(x => x.ended && x.id !== s.id && x.dayName === s.dayName)
      .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))
      .find(x => x.entries.some(en => en.exId === e.exId && en.sets.some(st => st.kg != null || st.reps != null)));
    prevEntryMap[e.exId] = prev?.entries.find(en => en.exId === e.exId) ?? null;
  });

  const takeScreenshot = async () => {
    if (!captureRef.current || !window.html2canvas) return;
    setCapturing(true);
    try {
      const canvas = await window.html2canvas(captureRef.current, {
        backgroundColor: '#07060a', scale: 2, useCORS: true, logging: false,
      });
      canvas.toBlob(async (blob) => {
        const filename = `${s.dayName}-${s.date.slice(0,10)}.png`;
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file] }); } catch(_) {}
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename;
          document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }, 'image/png');
    } finally {
      setCapturing(false);
    }
  };

  const isImprovement = (st, prevSet) => {
    if (!prevSet || !st.done) return false;
    if (st.kg != null && prevSet.kg != null && st.kg > prevSet.kg) return true;
    if (st.kg === prevSet.kg && st.reps != null && prevSet.reps != null && st.reps > prevSet.reps) return true;
    return false;
  };

  return (
    <Screen>
      <ScreenHead
        ref_={new Date(s.date.slice(0, 10) + 'T12:00:00').toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long' }).toUpperCase()}
        title={s.dayName}
        onBack={() => go({ name: justFinished ? 'home' : 'hist' })}
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={takeScreenshot} disabled={capturing} style={{
              background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
              borderRadius: 999, padding: '5px 10px', cursor: 'pointer',
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>{capturing ? '…' : '↓'}</button>
            <button onClick={() => setEditing(true)} style={{
              background: 'transparent', border: `0.5px solid ${UI.hairStrong}`,
              borderRadius: 999, padding: '5px 10px', cursor: 'pointer',
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>Bearbeiten</button>
            <button onClick={deleteSession} style={{
              width: 28, height: 28, borderRadius: '50%',
              border: `0.5px solid rgba(200,116,105,0.25)`, background: 'transparent',
              color: UI.danger, cursor: 'pointer', fontSize: 16, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>
          </div>
        }
      />
      <Hairline />

      <div style={{ padding: '14px 22px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Celebration banner */}
        {justFinished && (() => {
          return (
            <BracketFrame gold style={{ marginBottom: 4 }}>
              <div style={{ textAlign: 'center', padding: '6px 0 10px' }}>
                <div className="micro-gold" style={{ letterSpacing: '0.24em', marginBottom: 16 }}>SESSION KOMPLETT</div>
                <div className="display-it" style={{ fontSize: 28, color: UI.gold, marginBottom: 18 }}>Stark gemacht.</div>
                <div style={{ display: 'flex', borderTop: `0.5px solid ${UI.hair}`, paddingTop: 16, gap: 0 }}>
                  {[
                    { label: 'Volumen', value: `${Math.round(vol).toLocaleString('de-DE')} kg`, gold: true },
                    ...(duration ? [{ label: 'Dauer', value: `${duration} min`, gold: false }] : []),
                    { label: 'Sets', value: String(s.entries.reduce((c,e) => c + e.sets.filter(x => x.done).length, 0)), gold: false },
                  ].map((st, k, arr) => (
                    <div key={st.label} style={{
                      flex: 1,
                      borderRight: k < arr.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
                      padding: '0 4px',
                    }}>
                      <div className="num" style={{ fontSize: 18, color: st.gold ? UI.gold : UI.ink, lineHeight: 1 }}>{st.value}</div>
                      <div className="micro" style={{ marginTop: 6 }}>{st.label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
              </div>
            </BracketFrame>
          );
        })()}

        {/* Stats row */}
        {!justFinished && (
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            <SubDial label="Dauer" value={duration ?? '—'} sub={duration ? 'min' : ''} size={90} />
            <SubDial label="Volumen" value={Math.round(vol).toLocaleString('de-DE')} sub="kg" size={90} gold />
            <SubDial label="Sets" value={s.entries.reduce((c,e) => c + e.sets.filter(x => x.done).length, 0)} size={90} />
          </div>
        )}

        {/* Exercise entries */}
        <div>
          <Bezel>ÜBUNGEN</Bezel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
            {s.entries.map((e, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <div className="display" style={{ fontSize: 17, color: UI.ink, lineHeight: 1.1 }}>{e.name}</div>
                  <Pill>{e.sets.filter(x => x.done).length} / {e.sets.length}</Pill>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {e.sets.map((st, j) => {
                    const prev = prevEntryMap[e.exId];
                    const gold = isImprovement(st, prev?.sets?.[j]);
                    return (
                      <span key={j} style={{
                        opacity: st.done ? 1 : 0.3,
                        background: gold ? UI.goldFaint : 'transparent',
                        border: `0.5px solid ${gold ? UI.goldSoft : UI.hair}`,
                        borderRadius: 6, padding: '3px 8px',
                        fontFamily: UI.fontNum, fontSize: 12,
                        color: gold ? UI.goldLight : UI.ink,
                      }}>
                        {st.kg ?? '—'}<span style={{ color: UI.inkFaint, fontSize: 10 }}>kg</span><span style={{ color: gold ? UI.goldSoft : UI.inkFaint, margin: '0 1px' }}>×</span>{st.reps ?? '—'}
                      </span>
                    );
                  })}
                </div>
                {e.note && <div className="micro" style={{ color: UI.inkFaint, marginTop: 6, fontStyle: 'italic' }}>"{e.note}"</div>}
                {i < s.entries.length - 1 && <Hairline style={{ marginTop: 14 }} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* off-screen capture target */}
      <div ref={captureRef} style={{
        position: 'fixed', top: 0, left: '-9999px', width: 390,
        background: '#07060a', padding: '20px 18px 24px',
        fontFamily: UI.fontUi, color: UI.ink,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div className="micro" style={{ color: UI.inkFaint, letterSpacing: '0.12em', marginBottom: 4 }}>
              {new Date(s.date.slice(0,10) + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long' }).toUpperCase()}
            </div>
            <div className="display" style={{ fontSize: 22 }}>{s.dayName}</div>
          </div>
          <div className="micro-gold" style={{ marginTop: 2 }}>LOGBOOK</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
          {[['DURATION', duration != null ? `${duration} min` : '—'], ['VOLUME', `${Math.round(vol).toLocaleString('en-US')} kg`], ['SETS', s.entries.reduce((c,e) => c + e.sets.filter(x => x.done).length, 0)]].map(([label, value]) => (
            <div key={label} style={{ background: UI.bgRaised, borderRadius: 10, padding: '8px 12px' }}>
              <div className="micro" style={{ marginBottom: 3 }}>{label}</div>
              <div className="num" style={{ fontSize: 16 }}>{value}</div>
            </div>
          ))}
        </div>
        {s.entries.map((e, i) => (
          <div key={i} style={{ background: UI.bgRaised, borderRadius: 10, padding: '7px 12px', marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{e.name}</div>
              <div className="num" style={{ fontSize: 11, color: UI.inkSoft }}>{e.sets.filter(x => x.done).length}/{e.sets.length}</div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {e.sets.map((st, j) => {
                const prev = prevEntryMap[e.exId];
                const gold = isImprovement(st, prev?.sets?.[j]);
                return (
                  <span key={j} style={{
                    opacity: st.done ? 1 : 0.35,
                    background: gold ? UI.goldFaint : UI.bgInset,
                    border: `0.5px solid ${gold ? UI.goldSoft : 'transparent'}`,
                    borderRadius: 6, padding: '2px 7px',
                    fontFamily: UI.fontNum, fontSize: 11,
                    color: gold ? UI.goldLight : UI.ink,
                  }}>
                    {st.kg ?? '—'}<span style={{ color: UI.inkFaint, fontSize: 10 }}>kg</span><span style={{ color: gold ? UI.goldSoft : UI.inkFaint, margin: '0 1px' }}>×</span>{st.reps ?? '—'}
                  </span>
                );
              })}
            </div>
            {e.note && <div className="micro" style={{ color: UI.inkFaint, marginTop: 4, fontStyle: 'italic' }}>"{e.note}"</div>}
          </div>
        ))}
      </div>

      {editing && (
        <SessionEditSheet
          session={s}
          duration={duration}
          onClose={() => setEditing(false)}
          onSave={(patch) => {
            setStore(st => ({ ...st, sessions: st.sessions.map(x => x.id === s.id ? { ...x, ...patch } : x) }));
            setEditing(false);
          }}
        />
      )}
      {confirmEl}
    </Screen>
  );
}

function SessionEditSheet({ session, duration, onClose, onSave }) {
  const [draftDate, setDraftDate] = useStateL(session.date ? session.date.slice(0, 10) : '');
  const [draftDuration, setDraftDuration] = useStateL(duration != null ? String(Math.round(duration / 5) * 5) : '0');
  const [draftEntries, setDraftEntries] = useStateL(() => JSON.parse(JSON.stringify(session.entries)));

  const updateSet = (eIdx, sIdx, patch) => {
    setDraftEntries(entries => entries.map((e, i) =>
      i !== eIdx ? e : { ...e, sets: e.sets.map((st, k) => k !== sIdx ? st : { ...st, ...patch }) }
    ));
  };

  const save = () => {
    const patch = { entries: draftEntries };
    if (draftDate && draftDate !== session.date?.slice(0, 10)) {
      const original = new Date(session.date);
      const [y, m, d] = draftDate.split('-').map(Number);
      original.setFullYear(y, m - 1, d);
      patch.date = original.toISOString();
    }
    const mins = parseInt(draftDuration, 10);
    if (!isNaN(mins) && mins > 0 && session.ended) {
      patch.startedAt = new Date(new Date(session.ended) - mins * 60000).toISOString();
    }
    onSave(patch);
  };

  const inputStyle = {
    background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`,
    borderRadius: 10, padding: '11px 14px', color: UI.ink,
    fontFamily: UI.fontNum, fontSize: 16, outline: 'none',
    width: '100%', boxSizing: 'border-box', display: 'block',
  };
  const numInputStyle = {
    width: 64, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`,
    borderRadius: 8, color: UI.ink, padding: '9px 6px', textAlign: 'center',
    fontFamily: UI.fontNum, fontSize: 15, outline: 'none', flexShrink: 0,
  };

  return (
    <Sheet open={true} onClose={onClose} title="Session bearbeiten">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 160 }}>
        <div>
          <span className="label">Datum</span>
          <div style={{ width: '100%', overflow: 'hidden', borderRadius: 10, marginTop: 6 }}>
            <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)} style={{ ...inputStyle, textAlign: 'center', textAlignLast: 'center' }} />
          </div>
        </div>
        <div>
          <span className="label">Dauer</span>
          <select value={draftDuration} onChange={e => setDraftDuration(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', textAlignLast: 'center', marginTop: 6 }}>
            {Array.from({ length: 37 }, (_, i) => i * 5).map(m => (
              <option key={m} value={String(m)}>{m === 0 ? '—' : `${m} min`}</option>
            ))}
          </select>
        </div>
        <div style={{ borderTop: `0.5px solid ${UI.hair}`, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {draftEntries.map((e, eIdx) => (
            <div key={eIdx}>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>{e.name.toUpperCase()}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {e.sets.map((st, sIdx) => (
                  <div key={sIdx} style={{ display: 'flex', alignItems: 'center', gap: 10, background: UI.bgInset, borderRadius: 10, padding: '8px 12px' }}>
                    <span className="num" style={{ width: 20, fontSize: 11, color: UI.inkFaint, flexShrink: 0 }}>{sIdx + 1}</span>
                    <input type="number" inputMode="decimal" step="0.5" value={st.kg ?? ''}
                      placeholder="—" onFocus={e => e.target.select()}
                      onChange={ev => updateSet(eIdx, sIdx, { kg: ev.target.value === '' ? null : +ev.target.value })}
                      style={numInputStyle} />
                    <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>kg</span>
                    <span style={{ color: UI.hair, fontSize: 14, margin: '0 2px', fontFamily: UI.fontDisplay, fontStyle: 'italic' }}>×</span>
                    <input type="number" inputMode="numeric" value={st.reps ?? ''}
                      placeholder="—" onFocus={e => e.target.select()}
                      onChange={ev => updateSet(eIdx, sIdx, { reps: ev.target.value === '' ? null : +ev.target.value })}
                      style={numInputStyle} />
                    <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>reps</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={onClose} style={{ flex: 1 }}>Abbrechen</Btn>
          <Btn onClick={save} style={{ flex: 2 }}>Speichern</Btn>
        </div>
      </div>
    </Sheet>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────
function SettingsScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [nickname, setNickname] = useStateL(store.user?.name || '');
  const [swVersion, setSwVersion] = useStateL('');
  const [pushStatus, setPushStatus] = useStateL(null);
  const [pushEnabled, setPushEnabled] = useStateL(() => localStorage.getItem('logbook-push-enabled') === 'true');
  const pushStatusTimer = React.useRef(null);
  useEffectL(() => {
    if (!('caches' in window)) return;
    caches.keys().then(keys => {
      const name = keys.find(k => k.startsWith('logbook-'));
      if (name) setSwVersion(name.replace('logbook-', ''));
    });
  }, []);

  const togglePush = () => {
    const next = !pushEnabled;
    setPushEnabled(next);
    localStorage.setItem('logbook-push-enabled', String(next));
  };

  const testPushover = async (delaySeconds = 0) => {
    clearTimeout(pushStatusTimer.current);
    setPushStatus(delaySeconds > 0 ? `Sende… Screen jetzt sperren!` : 'Sende…');
    try {
      const res = await fetch('https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/pushover', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'Pause vorbei — weiter gehts! 💪', title: 'Logbook Test', delaySeconds, nonce: String(Date.now()) }),
      });
      if (res.status === 202) {
        setPushStatus(`✓ Geplant — Notification in ~${delaySeconds}s`);
        pushStatusTimer.current = setTimeout(() => setPushStatus(null), (delaySeconds + 15) * 1000);
      } else {
        const data = await res.json();
        setPushStatus(data.status === 1 ? '✓ Gesendet' : `Fehler: ${JSON.stringify(data)}`);
        pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
      }
    } catch (e) {
      setPushStatus(`Fehler: ${e.message}`);
      pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
    }
  };

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
      <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Account */}
        <Frame style={{ padding: '14px 16px' }}>
          <span className="label">Spitzname</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
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
          <div className="micro" style={{ marginTop: 8 }}>
            Eingeloggt als {store.user?.email || userId}
          </div>
        </Frame>

        {/* Pause Default */}
        <Frame style={{ padding: '14px 16px' }}>
          <span className="label">Pause Default</span>
          <div style={{ marginTop: 8 }}>
            <Stepper
              value={store.settings?.restDefault || 120}
              step={15} min={0} suffix="s"
              onChange={(v) => setStore(s => ({ ...s, settings: { ...s.settings, restDefault: v } }))}
            />
          </div>
        </Frame>

        {/* Push notifications */}
        <Frame style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="label" style={{ marginBottom: 0 }}>Push-Benachrichtigungen</span>
            <div
              onClick={togglePush}
              style={{
                width: 44, height: 26, borderRadius: 13, cursor: 'pointer',
                background: pushEnabled ? 'var(--gold)' : UI.bgInset,
                border: `0.5px solid ${pushEnabled ? UI.goldSoft : UI.hairStrong}`,
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: 3, left: pushEnabled ? 21 : 3,
                width: 18, height: 18, borderRadius: 9,
                background: pushEnabled ? '#0a0805' : UI.inkFaint,
                transition: 'left 0.2s',
              }} />
            </div>
          </div>
          {pushEnabled && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn kind="ghost" onClick={() => testPushover(0)} style={{ flex: 1, fontSize: 11, minHeight: 36 }}>Sofort</Btn>
                <Btn kind="ghost" onClick={() => testPushover(10)} style={{ flex: 1, fontSize: 11, minHeight: 36 }}>10s</Btn>
                <Btn kind="ghost" onClick={() => testPushover(30)} style={{ flex: 1, fontSize: 11, minHeight: 36 }}>30s</Btn>
              </div>
              {pushStatus && (
                <div className="micro" style={{ color: pushStatus.startsWith('✓') ? UI.gold : UI.inkSoft, textAlign: 'center' }}>
                  {pushStatus}
                </div>
              )}
            </div>
          )}
        </Frame>

        <Bezel>DATEN</Bezel>

        <Btn kind="ghost" onClick={exportData} style={{ fontSize: 12 }}>Daten exportieren (JSON)</Btn>
        <Btn kind="ghost" onClick={async () => {
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
          window.location.reload(true);
        }} style={{ fontSize: 12 }}>App-Cache leeren & neu laden</Btn>
        <Btn kind="ghost" onClick={handleSignOut} style={{ color: UI.danger, borderColor: 'rgba(200,116,105,0.25)', fontSize: 12 }}>
          Ausloggen
        </Btn>
        <Btn kind="ghost" onClick={handleDeleteAll} style={{ color: UI.danger, borderColor: 'rgba(200,116,105,0.25)', opacity: 0.6, fontSize: 12 }}>
          Alle Daten löschen
        </Btn>
        <div className="micro" style={{ textAlign: 'center', marginTop: 8 }}>
          Logbook · {swVersion || '…'} · Daten in Supabase
        </div>
      </div>
      {confirmEl}
    </Screen>
  );
}

Object.assign(window.Screens, { LibraryScreen, ExerciseCreator, ExerciseDetailScreen, HistoryScreen, SessionDetailScreen, SettingsScreen });
