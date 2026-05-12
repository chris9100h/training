/* Library + History + Session detail + Settings */

const {
  useState: useStateL,
  useMemo: useMemoL
} = React;

// ─── LIBRARY ──────────────────────────────────────────────────────────
function LibraryScreen({
  store,
  setStore,
  go
}) {
  const [confirmEl, confirm] = useConfirm();
  const [tab, setTab] = useStateL('recent');
  const [q, setQ] = useStateL('');
  const [creating, setCreating] = useStateL(false);
  const [selecting, setSelecting] = useStateL(false);
  const [selected, setSelected] = useStateL(new Set());
  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggleSelect = id => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const deleteSelected = async () => {
    if (!(await confirm(`Bisherige Sessions bleiben erhalten.`, {
      title: `${selected.size} Übung${selected.size > 1 ? 'en' : ''} löschen?`,
      ok: 'Löschen',
      danger: true
    }))) return;
    setStore(s => ({
      ...s,
      exercises: s.exercises.filter(e => !selected.has(e.id))
    }));
    exitSelect();
  };
  const recent = useMemoL(() => {
    const seen = new Map();
    [...store.sessions].filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || '')).forEach(s => {
      s.entries.forEach(e => {
        if (!seen.has(e.exId)) seen.set(e.exId, s.ended);
      });
    });
    return store.exercises.filter(e => seen.has(e.id)).sort((a, b) => (seen.get(b.id) || '').localeCompare(seen.get(a.id) || '')).slice(0, 12).map(e => ({
      ex: e,
      last: seen.get(e.id)
    }));
  }, [store.exercises, store.sessions]);
  const filtered = useMemoL(() => {
    const ql = q.toLowerCase();
    return store.exercises.filter(e => !q || e.name.toLowerCase().includes(ql) || e.tags?.some(t => t.includes(ql))).sort((a, b) => a.name.localeCompare(b.name));
  }, [store.exercises, q]);
  const topBarRight = selecting ? /*#__PURE__*/React.createElement("button", {
    onClick: exitSelect,
    style: {
      background: 'none',
      border: 'none',
      color: UI.inkSoft,
      fontFamily: UI.fontUi,
      fontSize: 14,
      cursor: 'pointer',
      padding: '4px 8px'
    }
  }, "Abbrechen") : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 4
    }
  }, store.exercises.length > 0 && /*#__PURE__*/React.createElement(Btn, {
    kind: "icon",
    onClick: () => {
      setTab('all');
      setSelecting(true);
    },
    style: {
      color: UI.inkSoft,
      fontSize: 16
    }
  }, "\u2611"), /*#__PURE__*/React.createElement(Btn, {
    kind: "icon",
    onClick: () => setCreating(true),
    style: {
      color: UI.gold,
      fontSize: 22,
      fontWeight: 300
    }
  }, "+"));
  return /*#__PURE__*/React.createElement(Screen, null, /*#__PURE__*/React.createElement(TopBar, {
    title: "Library",
    right: topBarRight
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      padding: '0 18px',
      gap: 0,
      borderBottom: `1px solid ${UI.inkLine}`
    }
  }, [['recent', 'Zuletzt'], ['all', 'Alle']].map(([id, label]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    onClick: () => setTab(id),
    style: {
      flex: 1,
      background: 'transparent',
      border: 'none',
      padding: '12px 0',
      cursor: 'pointer',
      color: tab === id ? UI.gold : UI.inkSoft,
      fontFamily: UI.fontUi,
      fontSize: 14,
      fontWeight: tab === id ? 600 : 500,
      borderBottom: `2px solid ${tab === id ? UI.gold : 'transparent'}`,
      marginBottom: -1
    }
  }, label))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 18,
      paddingBottom: selecting ? 80 : 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, tab === 'all' && /*#__PURE__*/React.createElement(Input, {
    value: q,
    onChange: setQ,
    placeholder: "Suchen\u2026"
  }), tab === 'recent' && recent.length === 0 && /*#__PURE__*/React.createElement(Empty, {
    title: "Noch nichts trainiert",
    sub: "Sobald du Sessions loggst, erscheinen \xDCbungen hier."
  }), tab === 'recent' && recent.map(({
    ex,
    last
  }) => {
    const days = Math.round((Date.now() - new Date(last)) / 86400000);
    const lastEntry = LB.lastSessionForExercise(store, ex.id)?.entry;
    const top = lastEntry?.sets?.[0];
    return /*#__PURE__*/React.createElement(Card, {
      key: ex.id,
      onClick: () => go({
        name: 'exercise',
        exId: ex.id
      }),
      style: {
        cursor: 'pointer',
        padding: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 600
      }
    }, ex.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: UI.inkFaint,
        fontFamily: UI.fontNum,
        marginTop: 2
      }
    }, days === 0 ? 'heute' : `${days}d her`, top && ` · letztes Set: ${top.kg}kg × ${top.reps}`)), /*#__PURE__*/React.createElement("span", {
      style: {
        color: UI.gold,
        fontSize: 18
      }
    }, "\u203A")));
  }), tab === 'all' && filtered.map(e => {
    const isSelected = selected.has(e.id);
    return /*#__PURE__*/React.createElement(Card, {
      key: e.id,
      onClick: () => selecting ? toggleSelect(e.id) : go({
        name: 'exercise',
        exId: e.id
      }),
      style: {
        cursor: 'pointer',
        padding: 14,
        borderColor: isSelected ? UI.danger : undefined,
        background: isSelected ? 'rgba(200,116,105,0.08)' : undefined
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 600
      }
    }, e.name), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 4,
        marginTop: 4,
        flexWrap: 'wrap'
      }
    }, e.tags?.map(t => /*#__PURE__*/React.createElement(Pill, {
      key: t
    }, t)))), selecting ? /*#__PURE__*/React.createElement("div", {
      style: {
        width: 22,
        height: 22,
        borderRadius: 6,
        flexShrink: 0,
        border: `2px solid ${isSelected ? UI.danger : UI.inkLine}`,
        background: isSelected ? UI.danger : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, isSelected && /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#fff',
        fontSize: 13,
        lineHeight: 1
      }
    }, "\u2713")) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: UI.gold,
        fontSize: 18
      }
    }, "\u203A")));
  }), tab === 'all' && filtered.length === 0 && /*#__PURE__*/React.createElement(Empty, {
    title: "Keine \xDCbungen",
    action: /*#__PURE__*/React.createElement(Btn, {
      onClick: () => setCreating(true)
    }, "\xDCbung anlegen")
  })), selecting && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      bottom: 'calc(56px + env(safe-area-inset-bottom, 8px))',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 440,
      padding: '12px 18px',
      background: UI.bgRaised,
      borderTop: `1px solid ${UI.inkLine}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      zIndex: 15
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: UI.inkSoft
    }
  }, selected.size === 0 ? 'Übungen antippen zum Auswählen' : `${selected.size} ausgewählt`), /*#__PURE__*/React.createElement(Btn, {
    kind: "ghost",
    onClick: deleteSelected,
    disabled: selected.size === 0,
    style: {
      color: UI.danger,
      borderColor: 'rgba(200,116,105,0.25)',
      opacity: selected.size === 0 ? 0.4 : 1,
      minHeight: 38,
      padding: '8px 16px',
      fontSize: 13
    }
  }, "L\xF6schen")), /*#__PURE__*/React.createElement(TabBar, {
    active: "lib",
    onChange: t => {
      exitSelect();
      go({
        name: t
      });
    }
  }), creating && /*#__PURE__*/React.createElement(ExerciseCreator, {
    onClose: () => setCreating(false),
    setStore: setStore
  }), confirmEl);
}
function ExerciseCreator({
  onClose,
  setStore,
  onCreated
}) {
  const [name, setName] = useStateL('');
  const [tags, setTags] = useStateL('');
  const [note, setNote] = useStateL('');
  const save = () => {
    if (!name.trim()) return;
    const ex = {
      id: LB.uid(),
      name: name.trim(),
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      note: note.trim()
    };
    setStore(s => ({
      ...s,
      exercises: [...s.exercises, ex]
    }));
    onCreated?.(ex.id);
    onClose();
  };
  return /*#__PURE__*/React.createElement(Sheet, {
    open: true,
    onClose: onClose,
    title: "Neue \xDCbung"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Name",
    value: name,
    onChange: setName,
    placeholder: "z.B. Front Squat",
    autoFocus: true
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Tags (komma-getrennt)",
    value: tags,
    onChange: setTags,
    placeholder: "legs, compound, barbell"
  }), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Notiz (optional)"), /*#__PURE__*/React.createElement("textarea", {
    value: note,
    onChange: e => setNote(e.target.value),
    placeholder: "z.B. Kabelzug Pos 4, Griff neutral, langsam ablassen",
    rows: 3,
    style: {
      background: UI.bgInset,
      border: `1px solid ${UI.inkLine}`,
      borderRadius: 10,
      padding: '10px 12px',
      color: UI.ink,
      fontFamily: UI.fontUi,
      fontSize: 14,
      resize: 'vertical',
      outline: 'none',
      width: '100%',
      boxSizing: 'border-box'
    }
  })), /*#__PURE__*/React.createElement(Btn, {
    onClick: save,
    style: {
      opacity: name.trim() ? 1 : 0.4
    },
    disabled: !name.trim()
  }, "Anlegen")));
}

// ─── EXERCISE DETAIL ─────────────────────────────────────────────────
function ExerciseDetailScreen({
  store,
  setStore,
  go,
  exId
}) {
  const ex = LB.findExercise(store, exId);
  if (!ex) {
    go({
      name: 'lib'
    });
    return null;
  }
  const [confirmEl, confirm] = useConfirm();
  const [editNote, setEditNote] = useStateL(false);
  const [noteVal, setNoteVal] = useStateL(ex.note || '');
  const saveNote = () => {
    setStore(s => ({
      ...s,
      exercises: s.exercises.map(e => e.id === exId ? {
        ...e,
        note: noteVal.trim()
      } : e)
    }));
    setEditNote(false);
  };
  const deleteExercise = async () => {
    if (!(await confirm('Bisherige Sessions bleiben erhalten.', {
      title: `"${ex.name}" löschen?`,
      ok: 'Löschen',
      danger: true
    }))) return;
    setStore(s => ({
      ...s,
      exercises: s.exercises.filter(e => e.id !== exId)
    }));
    go({
      name: 'lib'
    });
  };
  const history = useMemoL(() => {
    return store.sessions.filter(s => s.ended && s.entries.some(e => e.exId === exId)).sort((a, b) => (b.ended || '').localeCompare(a.ended || '')).map(s => ({
      session: s,
      entry: s.entries.find(e => e.exId === exId)
    }));
  }, [store.sessions, exId]);

  // 1RM estimate per session (Epley: kg * (1 + reps/30))
  const points = history.map(h => {
    const best = (h.entry.sets || []).filter(s => s.kg && s.reps).reduce((m, s) => Math.max(m, s.kg * (1 + s.reps / 30)), 0);
    return {
      date: h.session.ended,
      est: best
    };
  }).filter(p => p.est > 0).reverse();
  const pr = points.length ? Math.max(...points.map(p => p.est)) : 0;
  const last = points[points.length - 1]?.est;
  const first = points[0]?.est;
  const growth = first && last ? (last - first) / first * 100 : 0;
  return /*#__PURE__*/React.createElement(Screen, null, /*#__PURE__*/React.createElement(TopBar, {
    title: ex.name,
    sub: ex.tags?.join(' · ') || '',
    onBack: () => go({
      name: 'lib'
    }),
    right: /*#__PURE__*/React.createElement("button", {
      onClick: deleteExercise,
      style: {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: UI.danger,
        fontSize: 20,
        padding: '4px 8px',
        lineHeight: 1
      }
    }, "\uD83D\uDDD1")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "PR (1RM)"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: UI.fontNum,
      fontSize: 22,
      color: UI.gold
    }
  }, pr ? Math.round(pr) : '—')), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Letzte"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: UI.fontNum,
      fontSize: 22
    }
  }, last ? Math.round(last) : '—')), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Sessions"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: UI.fontNum,
      fontSize: 22
    }
  }, history.length))), points.length > 1 && /*#__PURE__*/React.createElement(ProgressChart, {
    points: points
  }), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: editNote ? 10 : ex.note ? 8 : 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, "\uD83D\uDCCC Notiz"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setNoteVal(ex.note || '');
      setEditNote(v => !v);
    },
    style: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: UI.gold,
      fontSize: 13,
      fontFamily: UI.fontUi,
      padding: '2px 0'
    }
  }, editNote ? 'Abbrechen' : 'Bearbeiten')), editNote ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("textarea", {
    value: noteVal,
    onChange: e => setNoteVal(e.target.value),
    placeholder: "z.B. Kabelzug Pos 4, Griff neutral, langsam ablassen",
    rows: 3,
    style: {
      width: '100%',
      boxSizing: 'border-box',
      background: UI.bgInset,
      border: `1px solid ${UI.inkLine}`,
      borderRadius: 10,
      padding: '10px 12px',
      color: UI.ink,
      fontFamily: UI.fontUi,
      fontSize: 14,
      resize: 'vertical',
      outline: 'none'
    }
  }), /*#__PURE__*/React.createElement(Btn, {
    onClick: saveNote,
    style: {
      marginTop: 10,
      width: '100%'
    }
  }, "Speichern")) : /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: ex.note ? UI.inkSoft : UI.inkFaint,
      lineHeight: 1.5,
      whiteSpace: 'pre-wrap',
      fontStyle: ex.note ? 'normal' : 'italic'
    }
  }, ex.note || 'Noch keine Notiz. Tippe Bearbeiten zum Hinzufügen.')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Label, null, "Verlauf"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, history.slice(0, 10).map(h => /*#__PURE__*/React.createElement(Card, {
    key: h.session.id,
    style: {
      padding: 10
    },
    onClick: () => go({
      name: 'session',
      sessionId: h.session.id
    })
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 12,
      color: UI.inkFaint,
      fontFamily: UI.fontNum,
      letterSpacing: '0.05em'
    }
  }, /*#__PURE__*/React.createElement("span", null, new Date(h.session.ended).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'short',
    year: '2-digit'
  })), /*#__PURE__*/React.createElement("span", null, h.session.dayName)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      flexWrap: 'wrap',
      marginTop: 6,
      fontFamily: UI.fontNum,
      fontSize: 13
    }
  }, h.entry.sets.filter(s => s.kg).map((s, i) => /*#__PURE__*/React.createElement("span", {
    key: i
  }, s.kg, /*#__PURE__*/React.createElement("span", {
    style: {
      color: UI.inkFaint
    }
  }, "\xD7"), s.reps))), h.entry.note && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: UI.inkFaint,
      marginTop: 4,
      fontStyle: 'italic'
    }
  }, "\"", h.entry.note, "\""))), history.length === 0 && /*#__PURE__*/React.createElement(Empty, {
    title: "Noch nicht trainiert"
  })))), confirmEl);
}
function ProgressChart({
  points
}) {
  const w = 280,
    h = 110,
    pad = 8;
  const max = Math.max(...points.map(p => p.est));
  const min = Math.min(...points.map(p => p.est));
  const range = max - min || 1;
  const xy = points.map((p, i) => {
    const x = pad + i / Math.max(1, points.length - 1) * (w - pad * 2);
    const y = h - pad - (p.est - min) / range * (h - pad * 2);
    return [x, y];
  });
  const path = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Gesch\xE4tzter 1RM \xB7 Verlauf"), /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${w} ${h}`,
    width: "100%",
    style: {
      display: 'block'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: path,
    fill: "none",
    stroke: UI.gold,
    strokeWidth: "1.5"
  }), xy.map(([x, y], i) => /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: x,
    cy: y,
    r: "2.5",
    fill: UI.gold
  }))));
}

// ─── HISTORY ─────────────────────────────────────────────────────────
function HistoryScreen({
  store,
  go
}) {
  const sessions = useMemoL(() => {
    return [...store.sessions].filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));
  }, [store.sessions]);
  return /*#__PURE__*/React.createElement(Screen, null, /*#__PURE__*/React.createElement(TopBar, {
    title: "History"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, sessions.length === 0 && /*#__PURE__*/React.createElement(Empty, {
    title: "Keine Sessions",
    sub: "Logge dein erstes Training, um Verlauf zu sehen."
  }), sessions.map(s => {
    const setsLogged = s.entries.reduce((c, e) => c + e.sets.filter(x => x.done).length, 0);
    const vol = totalVolume(s);
    const date = new Date(s.ended);
    const days = Math.round((Date.now() - date) / 86400000);
    return /*#__PURE__*/React.createElement(Card, {
      key: s.id,
      onClick: () => go({
        name: 'session',
        sessionId: s.id
      }),
      style: {
        cursor: 'pointer',
        padding: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: UI.inkFaint,
        fontFamily: UI.fontNum,
        letterSpacing: '0.1em'
      }
    }, date.toLocaleDateString('de-DE', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    }).toUpperCase(), " \xB7 ", days === 0 ? 'HEUTE' : `${days}D HER`)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginTop: 4
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 17,
        fontWeight: 600
      }
    }, s.dayName), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: UI.gold,
        fontFamily: UI.fontNum
      }
    }, vol.toLocaleString('de-DE'), " kg")), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: UI.inkSoft,
        marginTop: 2
      }
    }, s.entries.length, " \xDCbungen \xB7 ", setsLogged, " Sets"));
  })), /*#__PURE__*/React.createElement(TabBar, {
    active: "hist",
    onChange: t => go({
      name: t
    })
  }));
}

// ─── SESSION DETAIL ──────────────────────────────────────────────────
function SessionDetailScreen({
  store,
  go,
  sessionId,
  justFinished
}) {
  const s = store.sessions.find(x => x.id === sessionId);
  if (!s) {
    go({
      name: 'hist'
    });
    return null;
  }
  const vol = totalVolume(s);
  const duration = s.ended && s.date ? Math.round((new Date(s.ended) - new Date(s.date)) / 60000) : null;
  return /*#__PURE__*/React.createElement(Screen, null, /*#__PURE__*/React.createElement(TopBar, {
    title: s.dayName,
    sub: new Date(s.ended || s.date).toLocaleDateString('de-DE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }),
    onBack: () => go({
      name: justFinished ? 'home' : 'hist'
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, justFinished && /*#__PURE__*/React.createElement(Card, {
    accent: true,
    style: {
      textAlign: 'center',
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: UI.gold,
      fontFamily: UI.fontNum,
      letterSpacing: '0.15em'
    }
  }, "SESSION KOMPLETT"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 22,
      fontWeight: 600,
      color: UI.gold,
      marginTop: 4
    }
  }, "Stark gemacht \uD83D\uDCAA")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Dauer"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: UI.fontNum,
      fontSize: 20
    }
  }, duration ?? '—', /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: UI.inkFaint,
      marginLeft: 2
    }
  }, "min"))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Volumen"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: UI.fontNum,
      fontSize: 20
    }
  }, Math.round(vol).toLocaleString('de-DE'), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: UI.inkFaint,
      marginLeft: 2
    }
  }, "kg"))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Sets"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: UI.fontNum,
      fontSize: 20
    }
  }, s.entries.reduce((c, e) => c + e.sets.filter(x => x.done).length, 0)))), s.entries.map((e, i) => /*#__PURE__*/React.createElement(Card, {
    key: i,
    style: {
      padding: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 600
    }
  }, e.name), /*#__PURE__*/React.createElement(Pill, null, e.sets.filter(x => x.done).length, " / ", e.sets.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      flexWrap: 'wrap',
      fontFamily: UI.fontNum,
      fontSize: 13
    }
  }, e.sets.map((st, j) => /*#__PURE__*/React.createElement("span", {
    key: j,
    style: {
      opacity: st.done ? 1 : 0.35
    }
  }, st.kg ?? '—', /*#__PURE__*/React.createElement("span", {
    style: {
      color: UI.inkFaint
    }
  }, "\xD7"), st.reps ?? '—'))), e.note && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: UI.inkFaint,
      marginTop: 6,
      fontStyle: 'italic'
    }
  }, "\"", e.note, "\"")))));
}

// ─── SETTINGS ────────────────────────────────────────────────────────
function SettingsScreen({
  store,
  setStore,
  go,
  userId
}) {
  const [confirmEl, confirm] = useConfirm();
  const [nickname, setNickname] = useStateL(store.user?.name || '');
  const saveNickname = () => {
    const trimmed = nickname.trim();
    if (!trimmed || trimmed === store.user?.name) return;
    setStore(s => ({
      ...s,
      user: {
        ...s.user,
        name: trimmed
      }
    }));
  };
  const exportData = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logbook-${LB.todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const handleSignOut = async () => {
    await LB.signOut();
  };
  const handleDeleteAll = async () => {
    if (!(await confirm('Diese Aktion ist nicht rückgängig zu machen.', {
      title: 'Alle Daten löschen?',
      ok: 'Alles löschen',
      danger: true
    }))) return;
    await LB.deleteAllData(userId);
    await LB.signOut();
  };
  return /*#__PURE__*/React.createElement(Screen, null, /*#__PURE__*/React.createElement(TopBar, {
    title: "Einstellungen",
    onBack: () => go({
      name: 'home'
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(Label, null, "Spitzname"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: nickname,
    onChange: e => setNickname(e.target.value),
    onBlur: saveNickname,
    onKeyDown: e => e.key === 'Enter' && e.target.blur(),
    placeholder: "Dein Name",
    style: {
      flex: 1,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: UI.ink,
      fontFamily: UI.fontUi,
      fontSize: 16,
      padding: 0
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: UI.inkFaint,
      marginTop: 6
    }
  }, "Eingeloggt als ", store.user?.email || userId)), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(Label, null, "Pause Default"), /*#__PURE__*/React.createElement(Stepper, {
    value: store.settings?.restDefault || 120,
    step: 15,
    min: 0,
    suffix: "s",
    onChange: v => setStore(s => ({
      ...s,
      settings: {
        ...s.settings,
        restDefault: v
      }
    }))
  })), /*#__PURE__*/React.createElement(Btn, {
    kind: "ghost",
    onClick: exportData
  }, "Daten exportieren (JSON)"), /*#__PURE__*/React.createElement(Btn, {
    kind: "ghost",
    onClick: handleSignOut,
    style: {
      color: UI.danger,
      borderColor: 'rgba(200,116,105,0.25)'
    }
  }, "Ausloggen"), /*#__PURE__*/React.createElement(Btn, {
    kind: "ghost",
    onClick: handleDeleteAll,
    style: {
      color: UI.danger,
      borderColor: 'rgba(200,116,105,0.25)',
      opacity: 0.6
    }
  }, "Alle Daten l\xF6schen"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: UI.inkFaint,
      textAlign: 'center',
      marginTop: 8
    }
  }, "Logbook \xB7 v1.0 \xB7 Daten in Supabase")), confirmEl);
}
Object.assign(window.Screens, {
  LibraryScreen,
  ExerciseCreator,
  ExerciseDetailScreen,
  HistoryScreen,
  SessionDetailScreen,
  SettingsScreen
});
