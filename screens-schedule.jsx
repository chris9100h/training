/* Schedules — list, detail, edit, create */

const { useState: useStateS, useMemo: useMemoS, useRef: useRefS } = React;

const STANDARD_DAY_TYPES = ['PUSH','PULL','LEGS','UPPER','LOWER','FULL','ARMS','BACK','REST'];

// ─── PlanScreen ────────────────────────────────────────────────────
function PlanScreen({ store, setStore, go }) {
  return (
    <Screen>
      <TopBar
        title="Plan"
        right={<Btn kind="icon" onClick={() => go({ name: 'schedule-new' })} style={{ color: UI.gold, fontSize: 22, fontWeight: 300 }}>+</Btn>}
      />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {store.schedules.length === 0 && (
          <Empty title="Noch keine Pläne"
            sub="Leg einen Trainingsplan an, um Sessions zu starten."
            action={<Btn onClick={() => go({ name: 'schedule-new' })}>Plan anlegen</Btn>} />
        )}
        {store.schedules.map(s => {
          const isActive = s.id === store.activeScheduleId;
          return (
            <Card key={s.id} accent={isActive} onClick={() => go({ name: 'schedule', scheduleId: s.id })} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{s.name}</div>
                {isActive && <Pill gold>aktiv</Pill>}
              </div>
              <div style={{ fontSize: 12, color: UI.inkSoft, marginBottom: 10 }}>
                {s.days.length}-Tage-Zyklus · {s.days.filter(d => d.items.length).length} Trainingstage
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {s.days.map((d) => (
                  <div key={d.id} style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 999,
                    fontFamily: UI.fontNum, letterSpacing: '0.05em',
                    background: d.items.length ? UI.bgInset : 'transparent',
                    color: d.items.length ? UI.ink : UI.inkFaint,
                    border: `1px ${d.items.length ? 'solid' : 'dashed'} ${UI.inkLine}`,
                  }}>{d.name}</div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      <TabBar active="plan" onChange={(t) => go({ name: t })} />
    </Screen>
  );
}

// ─── Detail (read-only) ────────────────────────────────────────────
function ScheduleDetailScreen({ store, setStore, go, scheduleId }) {
  const sch = store.schedules.find(s => s.id === scheduleId);
  const [editingDay, setEditingDay] = useStateS(null);
  if (!sch) return null;

  const updateSch = (fn) => setStore(s => ({ ...s, schedules: s.schedules.map(x => x.id === sch.id ? fn(x) : x) }));
  const setActive = () => setStore(s => ({ ...s, activeScheduleId: sch.id, cycleIndex: 0 }));

  return (
    <Screen>
      <TopBar
        title={sch.name}
        sub={`${sch.days.length}-Tage-Zyklus`}
        onBack={() => go({ name: 'plan' })}
        right={<Btn kind="ghost" style={{ minHeight: 36, padding: '6px 12px', fontSize: 12 }} onClick={() => go({ name: 'schedule-edit', scheduleId: sch.id })}>bearbeiten</Btn>}
      />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sch.id !== store.activeScheduleId && (
          <Btn kind="ghost" onClick={setActive} style={{ marginBottom: 4 }}>Diesen Plan aktivieren</Btn>
        )}
        {sch.days.map((d, i) => {
          const isRest = !d.items.length;
          const isToday = sch.id === store.activeScheduleId && (store.cycleIndex % sch.days.length) === i;
          return (
            <Card key={d.id} accent={isToday}
              onClick={() => setEditingDay(d.id)}
              style={{ cursor: 'pointer', padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isRest ? 0 : 6 }}>
                <div>
                  <Label style={{ marginBottom: 2 }}>Tag {i+1}{isToday ? ' · heute' : ''}</Label>
                  <div style={{ fontSize: 17, fontWeight: 600, color: isRest ? UI.inkSoft : isToday ? UI.gold : UI.ink }}>{d.name}</div>
                </div>
                <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontNum }}>
                  {isRest ? 'REST' : `${d.items.length} ÜB.`}
                </div>
              </div>
              {!isRest && d.items.slice(0, 4).map((it, k) => {
                const ex = LB.findExercise(store, it.exId);
                return (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: UI.inkSoft, padding: '2px 0' }}>
                    <span>{ex?.name || '—'}</span>
                    <span style={{ fontFamily: UI.fontNum, fontSize: 12 }}>{it.sets}×{it.reps}</span>
                  </div>
                );
              })}
              {d.items.length > 4 && (
                <div style={{ fontSize: 11, color: UI.inkFaint, marginTop: 4 }}>+ {d.items.length - 4} weitere</div>
              )}
            </Card>
          );
        })}
      </div>
      {editingDay && (
        <DayEditor
          store={store} setStore={setStore}
          day={sch.days.find(d => d.id === editingDay)}
          onClose={() => setEditingDay(null)}
          onSave={(updated) => {
            updateSch(s => ({ ...s, days: s.days.map(d => d.id === updated.id ? updated : d) }));
            setEditingDay(null);
          }}
        />
      )}
    </Screen>
  );
}

// ─── Edit screen — rename, manage pattern (reorder/add/remove days) ─
function ScheduleEditScreen({ store, setStore, go, scheduleId }) {
  const original = store.schedules.find(s => s.id === scheduleId);
  const [draft, setDraft] = useStateS(original ? JSON.parse(JSON.stringify(original)) : null);
  const [pickingType, setPickingType] = useStateS(null); // { afterIdx } or { replaceIdx }
  if (!draft) return null;

  const moveDay = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= draft.days.length) return;
    setDraft(d => {
      const days = [...d.days];
      [days[idx], days[j]] = [days[j], days[idx]];
      return { ...d, days };
    });
  };
  const removeDay = (idx) => {
    if (!confirm(`Tag "${draft.days[idx].name}" aus dem Zyklus entfernen?`)) return;
    setDraft(d => ({ ...d, days: d.days.filter((_, i) => i !== idx) }));
  };
  const addDayType = (type, atIdx = null) => {
    const newDay = { id: LB.uid(), name: type, items: [] };
    setDraft(d => {
      const days = [...d.days];
      if (atIdx == null) days.push(newDay);
      else days.splice(atIdx, 0, newDay);
      return { ...d, days };
    });
    setPickingType(null);
  };
  const replaceDayType = (idx, type) => {
    setDraft(d => ({ ...d, days: d.days.map((day, i) => i === idx ? { ...day, name: type } : day) }));
    setPickingType(null);
  };

  const save = () => {
    setStore(s => ({ ...s, schedules: s.schedules.map(x => x.id === draft.id ? draft : x) }));
    go({ name: 'schedule', scheduleId: draft.id });
  };
  const deleteSch = () => {
    if (!confirm(`"${draft.name}" wirklich löschen?`)) return;
    setStore(s => ({
      ...s,
      schedules: s.schedules.filter(x => x.id !== draft.id),
      activeScheduleId: s.activeScheduleId === draft.id ? null : s.activeScheduleId,
    }));
    go({ name: 'plan' });
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(original);

  return (
    <Screen>
      <TopBar
        title="Plan bearbeiten"
        onBack={() => {
          if (dirty && !confirm('Änderungen verwerfen?')) return;
          go({ name: 'schedule', scheduleId: draft.id });
        }}
        right={<Btn kind="ghost" onClick={save} style={{ minHeight: 36, padding: '6px 12px', fontSize: 12, color: dirty ? UI.gold : UI.inkSoft, borderColor: dirty ? UI.goldSoft : UI.inkLine }}>speichern</Btn>}
      />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Input label="Name" value={draft.name} onChange={(v) => setDraft(d => ({ ...d, name: v }))} />

        <div>
          <Label>Zyklus · {draft.days.length} Tage</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {draft.days.map((day, i) => {
              const isRest = day.name === 'REST' || !day.items.length;
              return (
                <div key={day.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: UI.bgInset, border: `1px solid ${UI.inkLine}`,
                  padding: '8px 10px', borderRadius: 10,
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button onClick={() => moveDay(i, -1)} disabled={i === 0} style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                    <button onClick={() => moveDay(i, 1)} disabled={i === draft.days.length - 1} style={{ ...iconBtn, opacity: i === draft.days.length - 1 ? 0.3 : 1 }}>▼</button>
                  </div>
                  <div style={{ width: 26, textAlign: 'center', color: UI.inkFaint, fontFamily: UI.fontNum, fontSize: 11 }}>{i+1}</div>
                  <button onClick={() => setPickingType({ replaceIdx: i })} style={{
                    flex: 1, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: '8px 10px', borderRadius: 8,
                    color: isRest ? UI.inkSoft : UI.ink, fontSize: 15, fontWeight: 600,
                    fontFamily: UI.fontUi,
                  }}>{day.name}<span style={{ marginLeft: 8, color: UI.inkFaint, fontSize: 10, fontFamily: UI.fontNum, fontWeight: 400 }}>tippen zum ändern</span></button>
                  <button onClick={() => removeDay(i)} style={{ ...iconBtn, color: UI.danger, fontSize: 18 }}>×</button>
                </div>
              );
            })}
            <Btn kind="ghost" onClick={() => setPickingType({ append: true })} style={{ borderStyle: 'dashed' }}>
              + Tag hinzufügen
            </Btn>
          </div>
        </div>

        <div style={{ fontSize: 11, color: UI.inkFaint, lineHeight: 1.5 }}>
          Übungen pro Tag werden im Plan-Detail bearbeitet.<br/>
          Eigene Tag-Typen kannst du beim Hinzufügen anlegen — perfekt für Splits wie PUSH1 / PUSH2.
        </div>

        <Btn kind="ghost" onClick={deleteSch} style={{ marginTop: 4, color: UI.danger, borderColor: 'rgba(200,116,105,0.25)' }}>Plan löschen</Btn>
      </div>

      {pickingType && (
        <DayTypePicker
          store={store} setStore={setStore}
          title={pickingType.replaceIdx != null ? `Tag ${pickingType.replaceIdx + 1} ändern` : 'Tag-Typ wählen'}
          onClose={() => setPickingType(null)}
          onPick={(type) => {
            if (pickingType.replaceIdx != null) replaceDayType(pickingType.replaceIdx, type);
            else addDayType(type);
          }}
        />
      )}
    </Screen>
  );
}

const iconBtn = {
  width: 22, height: 18, background: 'transparent', border: `1px solid ${UI.inkLine}`,
  borderRadius: 4, color: UI.inkSoft, cursor: 'pointer', fontSize: 9,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
};

// ─── Day-type picker (sheet) — standard + custom + create new ─────────
function DayTypePicker({ store, setStore, title, onClose, onPick }) {
  const [creating, setCreating] = useStateS(false);
  const [newName, setNewName] = useStateS('');
  const custom = store.customDayTypes || [];

  const createCustom = () => {
    const name = newName.trim().toUpperCase();
    if (!name) return;
    if (STANDARD_DAY_TYPES.includes(name) || custom.includes(name)) {
      onPick(name);
      return;
    }
    setStore(s => ({ ...s, customDayTypes: [...(s.customDayTypes || []), name] }));
    onPick(name);
  };

  const removeCustom = (name) => {
    if (!confirm(`"${name}" aus eigenen Tag-Typen entfernen? (Bestehende Pläne bleiben unverändert.)`)) return;
    setStore(s => ({ ...s, customDayTypes: (s.customDayTypes || []).filter(t => t !== name) }));
  };

  return (
    <Sheet open={true} onClose={onClose} title={title}>
      <Label>Standard</Label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
        {STANDARD_DAY_TYPES.map(t => (
          <button key={t} onClick={() => onPick(t)} style={chipStyle(t === 'REST')}>{t}</button>
        ))}
      </div>

      <Label>Eigene</Label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {custom.length === 0 && !creating && (
          <div style={{ color: UI.inkFaint, fontSize: 12, padding: '6px 2px' }}>
            Noch keine eigenen Typen. Leg z.B. <span style={{ fontFamily: UI.fontNum, color: UI.inkSoft }}>PUSH1 / PUSH2</span> an für Variations-Splits.
          </div>
        )}
        {custom.map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'stretch', borderRadius: 999, overflow: 'hidden', border: `1px solid ${UI.goldSoft}` }}>
            <button onClick={() => onPick(t)} style={{
              ...chipStyle(false),
              border: 'none', borderRadius: 0,
              background: UI.goldFaint, color: UI.gold,
              fontWeight: 600,
            }}>{t}</button>
            <button onClick={() => removeCustom(t)} title="entfernen" style={{
              background: UI.goldFaint, border: 'none', borderLeft: `1px solid ${UI.goldSoft}`,
              color: UI.gold, opacity: 0.55, padding: '0 8px', cursor: 'pointer', fontSize: 12,
            }}>×</button>
          </div>
        ))}
        {!creating && (
          <button onClick={() => setCreating(true)} style={{
            ...chipStyle(true),
            color: UI.gold, borderColor: UI.goldSoft,
          }}>+ neuer Typ</button>
        )}
      </div>

      {creating && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', marginTop: 10,
          padding: 10, background: UI.bgInset, border: `1px dashed ${UI.goldSoft}`, borderRadius: 10,
        }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value.toUpperCase().slice(0, 12))}
            onKeyDown={(e) => e.key === 'Enter' && createCustom()}
            placeholder="z.B. PUSH1"
            style={{
              flex: 1, background: '#0a0a0a', border: `1px solid ${UI.inkLine}`,
              borderRadius: 8, color: UI.gold, padding: '10px 12px',
              fontFamily: UI.fontNum, fontSize: 14, letterSpacing: '0.08em', outline: 'none',
            }}
          />
          <Btn kind="ghost" onClick={() => { setCreating(false); setNewName(''); }} style={{ minHeight: 38, padding: '6px 10px', fontSize: 12 }}>×</Btn>
          <Btn onClick={createCustom} disabled={!newName.trim()} style={{ minHeight: 38, padding: '6px 14px', fontSize: 12, opacity: newName.trim() ? 1 : 0.4 }}>anlegen & wählen</Btn>
        </div>
      )}

      <div style={{ marginTop: 18, fontSize: 11, color: UI.inkFaint, lineHeight: 1.5 }}>
        Tipp: Für Pläne wie <span style={{ fontFamily: UI.fontNum, color: UI.inkSoft }}>PUSH1 / PULL1 / REST / LEGS1 / PUSH2 / REST / PULL2 / LEGS2 / REST</span> einfach mehrere eigene Typen anlegen.
      </div>
    </Sheet>
  );
}

function chipStyle(dashed) {
  return {
    padding: '8px 14px', borderRadius: 999,
    background: 'transparent',
    border: `1px ${dashed ? 'dashed' : 'solid'} ${UI.inkLine}`,
    color: UI.ink, fontFamily: UI.fontNum, fontSize: 12, letterSpacing: '0.06em',
    cursor: 'pointer',
  };
}

// ─── Day editor (exercises within a day) ─────────────────────────────
function DayEditor({ store, setStore, day, onClose, onSave }) {
  const [draft, setDraft] = useStateS(day);
  const [addingEx, setAddingEx] = useStateS(false);
  if (!draft) return null;

  const updateItem = (idx, patch) => setDraft(d => ({ ...d, items: d.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }));
  const removeItem = (idx) => setDraft(d => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));
  const addExercise = (exId) => {
    setDraft(d => ({ ...d, items: [...d.items, { exId, sets: 3, reps: 8 }] }));
    setAddingEx(false);
  };
  const moveItem = (idx, dir) => {
    const j = idx + dir;
    setDraft(d => {
      if (j < 0 || j >= d.items.length) return d;
      const items = [...d.items];
      [items[idx], items[j]] = [items[j], items[idx]];
      return { ...d, items };
    });
  };

  return (
    <Sheet open={true} onClose={onClose} title="Tag bearbeiten">
      <Input label="Tagesname" value={draft.name} onChange={(v) => setDraft(d => ({ ...d, name: v.toUpperCase() }))} />
      {draft.name === 'REST' ? (
        <div style={{ marginTop: 14, padding: '20px 14px', textAlign: 'center',
          border: `1px dashed ${UI.inkLine}`, borderRadius: 10, color: UI.inkFaint }}>
          <div style={{ fontSize: 13, color: UI.inkSoft, marginBottom: 4 }}>Ruhetag</div>
          <div style={{ fontSize: 11 }}>Keine Übungen an einem REST-Tag.<br/>Tagesname ändern, um Übungen anzulegen.</div>
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <Label>Übungen</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {draft.items.map((it, i) => {
              const ex = LB.findExercise(store, it.exId);
              return (
                <div key={i} style={{
                  display: 'flex', gap: 6, alignItems: 'center',
                  background: UI.bgInset, border: `1px solid ${UI.inkLine}`,
                  padding: '8px 10px', borderRadius: 10,
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button onClick={() => moveItem(i, -1)} disabled={i === 0} style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                    <button onClick={() => moveItem(i, 1)} disabled={i === draft.items.length - 1} style={{ ...iconBtn, opacity: i === draft.items.length - 1 ? 0.3 : 1 }}>▼</button>
                  </div>
                  <div style={{ flex: 1, fontSize: 14 }}>{ex?.name || '—'}</div>
                  <input type="number" inputMode="numeric" value={it.sets} onFocus={e => e.target.select()} onChange={e => updateItem(i, { sets: +e.target.value || 1 })} style={inlineNumStyle} />
                  <span style={{ color: UI.inkFaint, fontSize: 12 }}>×</span>
                  <input type="number" inputMode="numeric" value={it.reps} onFocus={e => e.target.select()} onChange={e => updateItem(i, { reps: +e.target.value || 1 })} style={inlineNumStyle} />
                  <button onClick={() => removeItem(i)} style={{ ...iconBtn, color: UI.inkFaint, fontSize: 16 }}>×</button>
                </div>
              );
            })}
            <Btn kind="ghost" onClick={() => setAddingEx(true)} style={{ borderStyle: 'dashed', minHeight: 44 }}>+ Übung hinzufügen</Btn>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <Btn kind="ghost" onClick={onClose} style={{ flex: 1 }}>Abbrechen</Btn>
        <Btn onClick={() => onSave(draft)} style={{ flex: 2 }}>Speichern</Btn>
      </div>

      {addingEx && (
        <ExercisePicker store={store} onClose={() => setAddingEx(false)} onPick={addExercise} />
      )}
    </Sheet>
  );
}

const inlineNumStyle = {
  width: 36, background: '#0a0a0a', border: `1px solid ${UI.inkLine}`,
  borderRadius: 6, color: UI.ink, padding: '6px 4px', textAlign: 'center',
  fontFamily: UI.fontNum, fontSize: 14, outline: 'none',
};

function ExercisePicker({ store, onClose, onPick }) {
  const [q, setQ] = useStateS('');
  const list = useMemoS(() => {
    const ql = q.toLowerCase();
    return store.exercises
      .filter(e => !q || e.name.toLowerCase().includes(ql) || e.tags?.some(t => t.includes(ql)))
      .sort((a,b) => a.name.localeCompare(b.name));
  }, [store.exercises, q]);

  return (
    <Sheet open={true} onClose={onClose} title="Übung wählen">
      <Input value={q} onChange={setQ} placeholder="Suchen oder neue tippen…" autoFocus />
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflow: 'auto' }}>
        {list.map(e => (
          <button key={e.id} onClick={() => onPick(e.id)} style={{
            background: 'transparent', border: 'none', textAlign: 'left',
            padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
            color: UI.ink, fontSize: 15, fontFamily: UI.fontUi,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
          onMouseEnter={ev => ev.currentTarget.style.background = UI.bgInset}
          onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
            <span>{e.name}</span>
            <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontNum }}>{e.tags?.[0]}</span>
          </button>
        ))}
        {q && !list.find(e => e.name.toLowerCase() === q.toLowerCase()) && (
          <button onClick={() => {
            if (window.__createExercise) {
              const newId = window.__createExercise(q);
              onPick(newId);
            }
          }} style={{
            background: UI.goldFaint, border: `1px dashed ${UI.goldSoft}`,
            padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
            color: UI.gold, fontSize: 14, marginTop: 8,
          }}>+ "{q}" anlegen</button>
        )}
      </div>
    </Sheet>
  );
}

// ─── Create new schedule ─────────────────────────────────────────────
function ScheduleNewScreen({ store, setStore, go }) {
  const [step, setStep] = useStateS(0);
  const [name, setName] = useStateS('');
  const [pattern, setPattern] = useStateS(['PUSH','PULL','REST']);
  const [pickingType, setPickingType] = useStateS(false);

  const presets = [
    { label: 'Push · Pull · Rest', val: ['PUSH','PULL','REST'] },
    { label: '2 on 1 off · PPL', val: ['PUSH','PULL','REST','LEGS','PUSH','REST'] },
    { label: 'Upper · Lower', val: ['UPPER','LOWER','REST'] },
    { label: 'Variations-PPL (9d)', val: ['PUSH1','PULL1','REST','LEGS1','PUSH2','REST','PULL2','LEGS2','REST'] },
  ];

  const ensureCustomTypes = (s, types) => {
    const std = new Set(STANDARD_DAY_TYPES);
    const cur = new Set(s.customDayTypes || []);
    const add = types.filter(t => !std.has(t) && !cur.has(t));
    return add.length ? { ...s, customDayTypes: [...(s.customDayTypes || []), ...add] } : s;
  };

  const finish = () => {
    const newSch = {
      id: LB.uid(),
      name: name.trim() || 'Mein Plan',
      days: pattern.map(p => ({ id: LB.uid(), name: p, items: [] })),
    };
    setStore(s => {
      const withTypes = ensureCustomTypes(s, pattern);
      return {
        ...withTypes,
        schedules: [...withTypes.schedules, newSch],
        activeScheduleId: newSch.id,
        cycleIndex: 0,
      };
    });
    go({ name: 'schedule', scheduleId: newSch.id });
  };

  return (
    <Screen>
      <TopBar title="Neuer Plan" onBack={() => step > 0 ? setStep(step - 1) : go({ name: 'plan' })} />
      <div style={{ padding: '6px 18px 18px' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
          {[0,1].map(i => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? UI.gold : UI.inkLine }} />
          ))}
        </div>
        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Wie heißt dein Plan?</div>
              <div style={{ fontSize: 13, color: UI.inkSoft }}>Du kannst das später ändern.</div>
            </div>
            <Input value={name} onChange={setName} placeholder="z.B. 2 on 1 off PPL" autoFocus />
            <Btn onClick={() => setStep(1)} style={{ width: '100%', opacity: name.trim() ? 1 : 0.4 }} disabled={!name.trim()}>Weiter →</Btn>
          </div>
        )}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Zyklus zusammenstellen</div>
              <div style={{ fontSize: 13, color: UI.inkSoft }}>Tag-Typen anhängen — Zyklus wiederholt sich endlos. Brauchst du PUSH1/PUSH2? Leg eigene Typen an.</div>
            </div>

            <div>
              <Label>Dein Zyklus · {pattern.length} Tage</Label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: 12, background: UI.bgInset, border: `1px solid ${UI.inkLine}`, borderRadius: 10, minHeight: 60 }}>
                {pattern.map((p, i) => {
                  const isStandard = STANDARD_DAY_TYPES.includes(p);
                  return (
                    <button key={i} onClick={() => setPattern(pat => pat.filter((_, j) => j !== i))} style={{
                      padding: '6px 10px', borderRadius: 8,
                      background: p === 'REST' ? 'transparent' : UI.goldFaint,
                      border: `1px ${p === 'REST' ? 'dashed' : 'solid'} ${p === 'REST' ? UI.inkLine : UI.goldSoft}`,
                      color: p === 'REST' ? UI.inkSoft : UI.gold,
                      fontSize: 12, fontFamily: UI.fontNum, letterSpacing: '0.06em', cursor: 'pointer',
                      fontWeight: isStandard ? 400 : 600,
                    }} title="Tippen zum Entfernen">{p} ×</button>
                  );
                })}
                {pattern.length === 0 && <div style={{ color: UI.inkFaint, fontSize: 12 }}>leer — tippe „Tag hinzufügen"</div>}
              </div>
            </div>

            <Btn kind="ghost" onClick={() => setPickingType(true)} style={{ borderStyle: 'dashed' }}>+ Tag hinzufügen</Btn>

            <div>
              <Label>Schnellauswahl</Label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {presets.map(p => (
                  <button key={p.label} onClick={() => setPattern(p.val)} style={{
                    background: UI.bgRaised, border: `1px solid ${UI.inkLine}`,
                    padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                    color: UI.ink, textAlign: 'left', fontFamily: UI.fontUi, fontSize: 13,
                    display: 'flex', justifyContent: 'space-between',
                  }}>
                    <span>{p.label}</span>
                    <span style={{ color: UI.inkFaint, fontSize: 11, fontFamily: UI.fontNum }}>{p.val.length}d</span>
                  </button>
                ))}
              </div>
            </div>

            <Btn onClick={finish} style={{ opacity: pattern.length ? 1 : 0.4 }} disabled={!pattern.length}>Plan erstellen →</Btn>
            <div style={{ fontSize: 11, color: UI.inkFaint, textAlign: 'center', marginTop: -8 }}>
              Übungen kannst du gleich danach in jeden Tag eintragen.
            </div>
          </div>
        )}
      </div>

      {pickingType && (
        <DayTypePicker
          store={store} setStore={setStore}
          title="Tag-Typ wählen"
          onClose={() => setPickingType(false)}
          onPick={(t) => { setPattern(pat => [...pat, t]); setPickingType(false); }}
        />
      )}
    </Screen>
  );
}

Object.assign(window.Screens, { PlanScreen, ScheduleDetailScreen, ScheduleEditScreen, ScheduleNewScreen, ExercisePicker, DayTypePicker });
