/* Schedules — list, detail, edit, create */

const { useState: useStateS, useMemo: useMemoS, useEffect: useEffectS } = React;

function useIsPadS() {
  const [isPad, setIsPad] = useStateS(() => window.innerWidth >= 768);
  useEffectS(() => {
    const handler = () => setIsPad(window.innerWidth >= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isPad;
}

const STANDARD_DAY_TYPES = ['PUSH','PULL','LEGS','UPPER','LOWER','FULL','ARMS','BACK','REST'];

// ─── PlanScreen ────────────────────────────────────────────────────
function PlanScreen({ store, setStore, go }) {
  return (
    <Screen>
      <TopBar
        title="Plan"
        right={
          <button onClick={() => go({ name: 'schedule-new' })} style={{
            width: 32, height: 32, borderRadius: 4,
            border: `1px solid ${UI.goldSoft}`, background: UI.goldFaint,
            color: UI.gold, cursor: 'pointer', fontSize: 20, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>+</button>
        }
      />
      <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {store.schedules.length === 0 && (
          <Empty title="No plans yet"
            sub="Create a training plan to start sessions."
            action={<Btn onClick={() => go({ name: 'schedule-new' })}>Create plan</Btn>}
            icon={ICON_CALENDAR} />
        )}
        {store.schedules.filter(s => !s.archived).map(s => {
          const isActive = s.id === store.activeScheduleId;
          return isActive ? (
            <BracketFrame key={s.id} gold onClick={() => go({ name: 'plan-view', scheduleId: s.id, fromPlan: true })} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="display" style={{ fontSize: 22, color: UI.gold, lineHeight: 1.1 }}>{s.name}</div>
                <Pill gold>active</Pill>
              </div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>
                {LB.isWeekdayPlan(s)
                  ? `${s.days.length} training days · ${[...s.days].sort((a,b)=>a.weekday-b.weekday).map(d=>WEEKDAYS[d.weekday]).join(' · ')}`
                  : `${s.days.length}-day cycle · ${s.days.filter(d => d.items.length).length} training days`}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {s.days.map((d) => (
                  <Pill key={d.id} gold={!!d.items.length}>{d.name}</Pill>
                ))}
              </div>
            </BracketFrame>
          ) : (
            <Frame key={s.id} onClick={() => go({ name: 'plan-view', scheduleId: s.id, fromPlan: true })} style={{ cursor: 'pointer', padding: '14px 16px' }}>
              <div className="display" style={{ fontSize: 20, color: UI.ink, lineHeight: 1.1, marginBottom: 6 }}>{s.name}</div>
              <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>
                {LB.isWeekdayPlan(s)
                  ? `${s.days.length} training days · ${[...s.days].sort((a,b)=>a.weekday-b.weekday).map(d=>WEEKDAYS[d.weekday]).join(' · ')}`
                  : `${s.days.length}-day cycle · ${s.days.filter(d => d.items.length).length} training days`}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {s.days.map((d) => (
                  <Pill key={d.id}>{d.name}</Pill>
                ))}
              </div>
            </Frame>
          );
        })}
        {store.schedules.some(s => s.archived) && (
          <>
            <div className="micro" style={{ marginTop: 8, paddingLeft: 2 }}>ARCHIVED</div>
            {store.schedules.filter(s => s.archived).map(s => (
              <Frame key={s.id} onClick={() => go({ name: 'plan-view', scheduleId: s.id, fromPlan: true })} style={{ cursor: 'pointer', padding: '14px 16px', opacity: 0.55 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div className="display" style={{ fontSize: 20, color: UI.ink, lineHeight: 1.1 }}>{s.name}</div>
                  <Pill>archived</Pill>
                </div>
                <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>
                  {LB.isWeekdayPlan(s)
                    ? `${s.days.length} training days · ${[...s.days].sort((a,b)=>a.weekday-b.weekday).map(d=>WEEKDAYS[d.weekday]).join(' · ')}`
                    : `${s.days.length}-day cycle · ${s.days.filter(d => d.items.length).length} training days`}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {s.days.map((d) => (
                    <Pill key={d.id}>{d.name}</Pill>
                  ))}
                </div>
              </Frame>
            ))}
          </>
        )}
      </div>
    </Screen>
  );
}

// ─── Plan viewer — fully read-only, no edit affordances ───────────────
// Reached from the home rest-day card. Day chips switch between days
// (like the exercise chips in training); each day shows the weights/reps
// that will be prefilled when training, with no controls that change it.
function PlanViewerScreen({ store, setStore, go, scheduleId, fromPlan }) {
  const sch = store.schedules.find(s => s.id === (scheduleId || store.activeScheduleId));
  const isWeekday = sch ? LB.isWeekdayPlan(sch) : false;
  const jsDay = new Date().getDay();
  const todayWeekday = jsDay === 0 ? 6 : jsDay - 1;
  const displayDays = sch ? (isWeekday ? [...sch.days].sort((a, b) => a.weekday - b.weekday) : sch.days) : [];
  const isActivePlan = !!sch && sch.id === store.activeScheduleId;

  const activeCycleDayIdx = isActivePlan && !isWeekday
    ? (store.cycleStartDate
        ? (() => { const t = new Date(); t.setHours(12, 0, 0, 0); const st = LB.parseDate(store.cycleStartDate); return ((Math.round((t - st) / 86400000) % sch.days.length) + sch.days.length) % sch.days.length; })()
        : (store.cycleIndex || 0) % sch.days.length)
    : -1;

  const todayDayId = isActivePlan
    ? (isWeekday ? (displayDays.find(d => d.weekday === todayWeekday)?.id ?? null) : (displayDays[activeCycleDayIdx]?.id ?? null))
    : null;

  const [selectedDayId, setSelectedDayId] = useStateS(() => todayDayId || displayDays[0]?.id || null);
  const chipRowRef = React.useRef(null);

  React.useEffect(() => {
    const row = chipRowRef.current;
    if (!row) return;
    const idx = displayDays.findIndex(d => d.id === selectedDayId);
    const chip = row.children[idx];
    if (!chip) return;
    row.scrollTo({ left: chip.offsetLeft - row.offsetWidth / 2 + chip.offsetWidth / 2, behavior: 'smooth' });
  }, [selectedDayId]);

  if (!sch) {
    return (
      <Screen>
        <TopBar title="Plan" onBack={() => go({ name: 'home' })} />
        <div style={{ padding: 22 }}>
          <Empty title="No active plan" sub="Activate a plan to view it here." icon={ICON_CALENDAR} />
        </div>
      </Screen>
    );
  }

  if (!displayDays.length) {
    return (
      <Screen>
        <TopBar title={sch.name} onBack={() => go({ name: fromPlan ? 'plan' : 'home' })}
          right={fromPlan ? (
            <button onClick={() => go({ name: 'schedule-edit', scheduleId: sch.id })} style={{
              background: 'transparent', border: `1px solid ${UI.hairStrong}`,
              borderRadius: 4, padding: '5px 12px', cursor: 'pointer',
              color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>Edit</button>
          ) : null} />
        <div style={{ padding: 22 }}>
          <Empty title="No days yet" sub={fromPlan ? 'Tap Edit to add days to this plan.' : 'This plan has no days.'} icon={ICON_CALENDAR} />
        </div>
      </Screen>
    );
  }

  const day = displayDays.find(d => d.id === selectedDayId) || displayDays[0];
  const dayIdx = displayDays.findIndex(d => d.id === day.id);
  const isRest = !day.items.length;
  const isTodaySel = day.id === todayDayId;
  const dayLabel = isWeekday ? WEEKDAYS_FULL[day.weekday] : `Day ${dayIdx + 1}`;
  const trainingDayCount = sch.days.filter(d => d.items.length).length;

  const isPad = useIsPadS();
  const [confirmEl, confirm] = useConfirm();
  const activate = async () => {
    if (!await confirm(`"${sch.name}" will become your active plan and the cycle will reset.`, { title: 'Activate plan?', ok: 'Activate' })) return;
    setStore(s => ({
      ...s,
      activeScheduleId: sch.id,
      cycleIndex: 0,
      // Reset the start date that doesn't apply to this plan type, so a later
      // type switch can't read a stale date left over from a different plan.
      cycleStartDate:    isWeekday ? null          : LB.todayISO(),
      weekPlanStartDate: isWeekday ? LB.todayISO() : null,
    }));
  };
  const duplicate = () => {
    const copy = JSON.parse(JSON.stringify(sch));
    copy.id = LB.uid();
    copy.name = copy.name + ' (Copy)';
    copy.days = copy.days.map(d => ({ ...d, id: LB.uid() }));
    copy.archived = false;
    setStore(s => ({ ...s, schedules: [...s.schedules, copy] }));
    go({ name: 'plan-view', scheduleId: copy.id, fromPlan: true });
  };

  const planActions = fromPlan && (
    <>
      {!isActivePlan && <Btn kind="ghost" onClick={activate} style={{ flex: 1, fontSize: 12 }}>Activate</Btn>}
      {isActivePlan && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Pill gold>active</Pill></div>}
      <Btn kind="ghost" onClick={duplicate} style={{ flex: 1, fontSize: 12 }}>Duplicate</Btn>
    </>
  );

  const dayHeader = (
    <div>
      <div className={isTodaySel ? 'micro-gold' : 'micro'} style={{ marginBottom: 4, color: isTodaySel ? undefined : UI.inkFaint }}>
        {dayLabel.toUpperCase()}{isTodaySel ? ' · TODAY' : ''}
      </div>
      <div className="display" style={{ fontSize: 30, color: isRest ? UI.inkSoft : UI.ink, fontStyle: isRest ? 'italic' : 'normal', lineHeight: 1.05, letterSpacing: '-0.01em' }}>
        {day.name}
      </div>
    </div>
  );

  const exerciseList = isRest ? (
    <BracketFrame style={{ textAlign: 'center', padding: 36 }}>
      <div className="display-it" style={{ fontSize: 38, color: UI.inkSoft, fontStyle: 'italic', fontWeight: 300, marginBottom: 6 }}>Recover.</div>
      <div style={{ fontSize: 13, color: UI.inkFaint }}>Recovery is part of the plan.</div>
    </BracketFrame>
  ) : (
    <>
      {day.items.map((it, k) => {
        const ex = LB.findExercise(store, it.exId);
        const isUni = !!ex?.unilateral;
        const last = LB.lastSessionForExercise(store, it.exId, day.id);
        const suggestion = LB.progressionSuggestion(store, it.exId, day.id, it.reps);
        const seedSets = LB.buildSeedSets(it, last, suggestion, isUni, !!store.settings?.smartProgression);
        return (
          <Frame key={k} style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, paddingTop: 1 }}>
                {ex?.name || '—'}
                {isUni && <span className="micro" style={{ marginLeft: 6, color: UI.inkFaint }}>UNI</span>}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                {seedSets.map((st, si) => {
                  const kg = st.kg != null ? `${st.kg}kg` : '—';
                  const reps = isUni
                    ? `L${st.repsL ?? it.reps}/R${st.repsR ?? it.reps}`
                    : `${st.reps ?? it.reps}`;
                  return (
                    <span key={si} className="num" style={{ fontSize: 13, color: suggestion ? UI.gold : UI.inkSoft }}>
                      {kg} · {reps}
                      {suggestion && si === 0 && <i className="fa-solid fa-arrow-up" style={{ fontSize: 9, marginLeft: 4, color: UI.gold }} />}
                    </span>
                  );
                })}
              </div>
            </div>
          </Frame>
        );
      })}
      <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5, marginTop: 2, textAlign: 'center' }}>
        {store.settings?.smartProgression
          ? <>Prefilled for your next session · <i className="fa-solid fa-arrow-up" style={{ fontSize: 8 }} /> = smart progression bump</>
          : 'Prefilled from your last session'}
      </div>
    </>
  );

  return (
    <Screen scroll={false}>
      {confirmEl}
      <TopBar
        title={sch.name}
        sub={isWeekday
          ? displayDays.map(d => WEEKDAYS[d.weekday]).join(' · ')
          : `${sch.days.length}-day cycle · ${trainingDayCount} ${trainingDayCount === 1 ? 'workout' : 'workouts'}`}
        onBack={() => go({ name: fromPlan ? 'plan' : 'home' })}
        right={fromPlan ? (
          <button onClick={() => go({ name: 'schedule-edit', scheduleId: sch.id })} style={{
            background: 'transparent', border: `1px solid ${UI.hairStrong}`,
            borderRadius: 4, padding: '5px 12px', cursor: 'pointer',
            color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>Edit</button>
        ) : null}
      />

      {isPad ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          {/* Left sidebar: plan actions + vertical day chips */}
          <div style={{ width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `0.5px solid ${UI.hair}`, overflow: 'hidden' }}>
            {fromPlan && (
              <div style={{ flexShrink: 0, padding: '14px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {planActions}
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 10px 16px', display: 'flex', flexDirection: 'column', gap: 4, scrollbarWidth: 'none' }}>
              {displayDays.map((d, i) => {
                const active = d.id === selectedDayId;
                const isToday = d.id === todayDayId;
                const rest = !d.items.length;
                const sub = isWeekday ? WEEKDAYS[d.weekday] : `Day ${i + 1}`;
                return (
                  <button key={d.id} onClick={() => setSelectedDayId(d.id)} style={{
                    flexShrink: 0, padding: '8px 12px 6px', borderRadius: 4,
                    border: `1px solid ${active ? UI.gold : isToday ? UI.goldSoft : UI.hairStrong}`,
                    background: active ? UI.goldFaint : 'transparent',
                    cursor: 'pointer', WebkitTapHighlightColor: 'transparent', transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11, fontFamily: UI.fontUi, letterSpacing: '0.07em', fontWeight: 600,
                        color: active ? UI.gold : rest ? UI.inkFaint : UI.inkSoft,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{d.name}</div>
                      <div style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.1em', color: active ? UI.gold : UI.inkFaint, marginTop: 1 }}>{sub}</div>
                    </div>
                    {isToday && <div style={{ width: 5, height: 5, borderRadius: '50%', background: UI.gold, flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: day content */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', padding: '20px 32px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {dayHeader}
            {exerciseList}
          </div>
        </div>
      ) : (
        <>
          {fromPlan && (
            <div style={{ flexShrink: 0, padding: '14px 22px 10px', display: 'flex', gap: 8 }}>
              {planActions}
            </div>
          )}

          <div ref={chipRowRef} style={{ flexShrink: 0, padding: '4px 22px 14px', display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {displayDays.map((d, i) => {
              const active = d.id === selectedDayId;
              const isToday = d.id === todayDayId;
              const rest = !d.items.length;
              const sub = isWeekday ? WEEKDAYS[d.weekday] : `Day ${i + 1}`;
              return (
                <button key={d.id} onClick={() => setSelectedDayId(d.id)} style={{
                  flexShrink: 0, maxWidth: 120, padding: '6px 12px 4px', borderRadius: 4,
                  border: `1px solid ${active ? UI.gold : isToday ? UI.goldSoft : UI.hairStrong}`,
                  background: active ? UI.goldFaint : 'transparent',
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent', transition: 'all 0.15s',
                }}>
                  <div style={{
                    fontSize: 10, fontFamily: UI.fontUi, letterSpacing: '0.07em', fontWeight: 600,
                    color: active ? UI.gold : rest ? UI.inkFaint : UI.inkSoft,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{d.name}</div>
                  <div style={{ fontSize: 8, fontFamily: UI.fontUi, letterSpacing: '0.1em', color: active ? UI.gold : UI.inkFaint, marginTop: 1 }}>{sub}</div>
                  <div style={{ height: 3, marginTop: 3, display: 'flex', justifyContent: 'center' }}>
                    {isToday && <div style={{ width: 4, height: 4, borderRadius: '50%', background: UI.gold, marginTop: -1 }} />}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {dayHeader}
            {exerciseList}
          </div>
        </>
      )}
    </Screen>
  );
}

// ─── Edit screen — rename, manage pattern ─
function ScheduleEditScreen({ store, setStore, go, scheduleId }) {
  const [confirmEl, confirm] = useConfirm();
  const original = store.schedules.find(s => s.id === scheduleId);
  const [draft, setDraft] = useStateS(original ? JSON.parse(JSON.stringify(original)) : null);
  const [pickingType, setPickingType] = useStateS(false);
  const [editingDay, setEditingDay] = useStateS(null);
  if (!draft) return null;

  const isActive = draft.id === store.activeScheduleId;
  const isWeekday = LB.isWeekdayPlan(draft);

  const toggleWeekdayEdit = (idx) => {
    setDraft(d => {
      if (d.days.some(day => day.weekday === idx)) return { ...d, days: d.days.filter(day => day.weekday !== idx) };
      return { ...d, days: [...d.days, { id: LB.uid(), name: 'FULL', weekday: idx, items: [] }] };
    });
  };

  const moveDay = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= draft.days.length) return;
    setDraft(d => {
      const days = [...d.days];
      [days[idx], days[j]] = [days[j], days[idx]];
      return { ...d, days };
    });
  };
  const removeDay = async (idx) => {
    if (!await confirm(`Remove "${draft.days[idx].name}" from the cycle?`, { ok: 'Remove', danger: true })) return;
    setDraft(d => ({ ...d, days: d.days.filter((_, i) => i !== idx) }));
  };
  const addDayType = (type) => {
    setDraft(d => ({ ...d, days: [...d.days, { id: LB.uid(), name: type, items: [] }] }));
    setPickingType(false);
  };

  const save = () => {
    setStore(s => ({ ...s, schedules: s.schedules.map(x => x.id === draft.id ? draft : x) }));
    go({ name: 'plan-view', scheduleId: draft.id, fromPlan: true });
  };
  const deleteSch = async () => {
    if (!await confirm(`This cannot be undone.`, { title: `Delete "${draft.name}"?`, ok: 'Delete', danger: true })) return;
    setStore(s => ({
      ...s,
      schedules: s.schedules.filter(x => x.id !== draft.id),
      activeScheduleId: s.activeScheduleId === draft.id ? null : s.activeScheduleId,
    }));
    go({ name: 'plan' });
  };
  const toggleArchive = async () => {
    const willArchive = !draft.archived;
    if (willArchive && isActive) {
      if (!await confirm('Archiving will deactivate this plan.', { title: `Archive "${draft.name}"?`, ok: 'Archive' })) return;
    }
    setStore(s => ({
      ...s,
      schedules: s.schedules.map(x => x.id === draft.id ? { ...x, archived: willArchive } : x),
      activeScheduleId: (willArchive && s.activeScheduleId === draft.id) ? null : s.activeScheduleId,
    }));
    go({ name: 'plan' });
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const dateInputStyle = {
    background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
    borderRadius: 4, padding: '10px 14px', color: UI.ink,
    fontFamily: UI.fontNum, fontSize: 15, outline: 'none',
    width: '100%', boxSizing: 'border-box', display: 'block', colorScheme: 'dark',
  };

  const dayActionLabel = (day) => (day.name === 'REST' || !day.items.length) ? 'edit' : `${day.items.length} ex · edit`;

  return (
    <Screen>
      <TopBar
        title="Edit plan"
        onBack={async () => {
          if (dirty && !await confirm('Unsaved changes will be lost.', { title: 'Discard changes?', ok: 'Discard', danger: true })) return;
          go({ name: 'plan-view', scheduleId: draft.id, fromPlan: true });
        }}
        right={
          <button onClick={save} style={{
            background: dirty ? UI.goldFaint : 'transparent',
            border: `1px solid ${dirty ? UI.goldSoft : UI.hairStrong}`,
            borderRadius: 4, padding: '5px 12px', cursor: 'pointer',
            color: dirty ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>Save</button>
        }
      />
      <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Name">
          <TextInput value={draft.name} onChange={(v) => setDraft(d => ({ ...d, name: v.toUpperCase() }))} />
        </Field>

        {isActive && !isWeekday && (
          <Field label="Cycle start date (Day 1)">
            <div style={{ overflow: 'hidden', borderRadius: 4, width: '100%' }}>
              <input type="date" value={store.cycleStartDate || ''}
                onChange={e => { if (e.target.value) setStore(s => ({ ...s, cycleStartDate: e.target.value })); }}
                style={dateInputStyle} />
            </div>
            {store.cycleStartDate && draft.days.length > 0 && (() => {
              const t = new Date(); t.setHours(12, 0, 0, 0);
              const st = LB.parseDate(store.cycleStartDate);
              const idx = ((Math.round((t - st) / 86400000) % draft.days.length) + draft.days.length) % draft.days.length;
              return <div className="micro" style={{ marginTop: 8 }}>Today = Day {idx + 1} of {draft.days.length}</div>;
            })()}
          </Field>
        )}
        {isActive && isWeekday && (
          <Field label="Week plan start date (Week 1)">
            <div style={{ overflow: 'hidden', borderRadius: 4, width: '100%' }}>
              <input type="date" value={store.weekPlanStartDate || ''}
                onChange={e => { if (e.target.value) setStore(s => ({ ...s, weekPlanStartDate: e.target.value })); }}
                style={dateInputStyle} />
            </div>
            {store.weekPlanStartDate && (() => {
              const start = LB.parseDate(store.weekPlanStartDate);
              const today = new Date(); today.setHours(12, 0, 0, 0);
              const weekNum = Math.floor(Math.round((today - start) / 86400000) / 7) + 1;
              return <div className="micro" style={{ marginTop: 8 }}>Today = Week {weekNum}</div>;
            })()}
          </Field>
        )}

        {isWeekday ? (
          <div>
            <span className="label">Training days</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
              {WEEKDAYS.map((wd, i) => {
                const active = draft.days.some(d => d.weekday === i);
                return (
                  <button key={i} onClick={() => toggleWeekdayEdit(i)} style={{
                    width: 44, height: 44, borderRadius: 6,
                    border: `1px solid ${active ? UI.goldSoft : UI.hairStrong}`,
                    background: active ? UI.goldFaint : 'transparent',
                    color: active ? UI.gold : UI.inkFaint,
                    fontFamily: UI.fontNum, fontSize: 12, cursor: 'pointer', fontWeight: active ? 600 : 400,
                  }}>{wd}</button>
                );
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...draft.days].sort((a,b)=>a.weekday-b.weekday).map(day => (
                <div key={day.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
                  padding: '8px 12px', borderRadius: 4,
                }}>
                  <div className="num" style={{ width: 30, textAlign: 'center', color: UI.inkSoft, fontSize: 12, fontWeight: 600 }}>{WEEKDAYS[day.weekday]}</div>
                  <button onClick={() => setEditingDay(day.id)} style={{
                    flex: 1, background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: '6px 8px', borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    color: day.name === 'REST' ? UI.inkFaint : UI.ink, fontSize: 14, fontWeight: 600, fontFamily: UI.fontUi,
                  }}><span>{day.name}</span><span className="micro" style={{ fontStyle: 'normal' }}>{dayActionLabel(day)}</span></button>
                  <button onClick={() => toggleWeekdayEdit(day.weekday)} style={{ ...dayEditIconBtn, color: UI.danger, fontSize: 18 }}>×</button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <span className="label">Cycle · {draft.days.length} days</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {draft.days.map((day, i) => {
                const isRest = day.name === 'REST' || !day.items.length;
                return (
                  <div key={day.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
                    padding: '8px 12px', borderRadius: 4,
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button onClick={() => moveDay(i, -1)} disabled={i === 0} style={{ ...dayEditIconBtn, opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                      <button onClick={() => moveDay(i, 1)} disabled={i === draft.days.length - 1} style={{ ...dayEditIconBtn, opacity: i === draft.days.length - 1 ? 0.3 : 1 }}>▼</button>
                    </div>
                    <div className="num" style={{ width: 26, textAlign: 'center', color: UI.inkFaint, fontSize: 11 }}>{i+1}</div>
                    <button onClick={() => setEditingDay(day.id)} style={{
                      flex: 1, background: 'transparent', border: 'none', cursor: 'pointer',
                      padding: '6px 8px', borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      color: isRest ? UI.inkFaint : UI.ink, fontSize: 14, fontWeight: 600, fontFamily: UI.fontUi,
                    }}><span>{day.name}</span><span className="micro" style={{ fontStyle: 'normal' }}>{dayActionLabel(day)}</span></button>
                    <button onClick={() => removeDay(i)} style={{ ...dayEditIconBtn, color: UI.danger, fontSize: 18 }}>×</button>
                  </div>
                );
              })}
              <Btn kind="ghost" onClick={() => setPickingType(true)} style={{ borderStyle: 'dashed', fontSize: 12 }}>
                + Add day
              </Btn>
            </div>
          </div>
        )}

        <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.7 }}>
          Tap a day to edit its type and exercises.
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <Btn kind="ghost" onClick={toggleArchive} style={{ flex: 1, fontSize: 12, color: UI.inkSoft, borderColor: UI.hairStrong }}>
            {draft.archived ? 'Unarchive' : 'Archive plan'}
          </Btn>
          <Btn kind="ghost" onClick={deleteSch} style={{ flex: 1, fontSize: 12, color: UI.danger, borderColor: 'rgba(var(--danger-rgb),0.25)' }}>Delete plan</Btn>
        </div>
      </div>

      {editingDay && (
        <DayEditor
          store={store} setStore={setStore}
          day={draft.days.find(d => d.id === editingDay)}
          schedule={draft}
          onClose={() => setEditingDay(null)}
          onSave={(updated) => {
            setDraft(d => ({ ...d, days: d.days.map(x => x.id === updated.id ? updated : x) }));
            setEditingDay(null);
          }}
        />
      )}
      {pickingType && (
        <DayTypePicker
          store={store} setStore={setStore}
          title="Choose day type"
          onClose={() => setPickingType(false)}
          onPick={addDayType}
        />
      )}
      {confirmEl}
    </Screen>
  );
}

const dayEditIconBtn = {
  width: 22, height: 18, background: 'transparent', border: `1px solid ${UI.hairStrong}`,
  borderRadius: 4, color: UI.inkFaint, cursor: 'pointer', fontSize: 9,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
};

// ─── Day-type picker (sheet) ─────────────────────────────────────────
function DayTypePicker({ store, setStore, title, onClose, onPick }) {
  const [confirmEl, confirm] = useConfirm();
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
    setNewName('');
  };

  const removeCustom = async (name) => {
    if (!await confirm('Existing plans will remain unchanged.', { title: `Remove "${name}"?`, ok: 'Remove', danger: true })) return;
    setStore(s => ({ ...s, customDayTypes: (s.customDayTypes || []).filter(t => t !== name) }));
  };

  return (
    <Sheet open={true} onClose={onClose} title={title}>
      <span className="label">Standard</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 18px' }}>
        {STANDARD_DAY_TYPES.map(t => (
          <button key={t} onClick={() => onPick(t)} style={dayTypeChip(t === 'REST')}>{t}</button>
        ))}
      </div>

      <span className="label">Custom</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 6px' }}>
        {custom.length === 0 && !creating && (
          <div className="micro" style={{ color: UI.inkFaint, padding: '6px 2px', fontStyle: 'italic' }}>
            No custom types yet. E.g. PUSH1 / PUSH2.
          </div>
        )}
        {custom.map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'stretch', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.goldSoft}` }}>
            <button onClick={() => onPick(t)} style={{
              ...dayTypeChip(false),
              border: 'none', borderRadius: 0,
              background: UI.goldFaint, color: UI.gold, fontWeight: 600,
            }}>{t}</button>
            <button onClick={() => removeCustom(t)} title="Remove" style={{
              background: UI.goldFaint, border: 'none', borderLeft: `0.5px solid ${UI.goldSoft}`,
              color: UI.gold, opacity: 0.55, padding: '0 8px', cursor: 'pointer', fontSize: 12,
            }}>×</button>
          </div>
        ))}
        {!creating && (
          <button onClick={() => setCreating(true)} style={{
            ...dayTypeChip(true), color: UI.gold, borderColor: UI.goldSoft,
          }}>+ new</button>
        )}
      </div>

      {creating && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', marginTop: 10,
          padding: 10, background: UI.bgInset, border: `1px dashed ${UI.goldSoft}`, borderRadius: 4,
        }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value.toUpperCase().slice(0, 12))}
            onKeyDown={(e) => e.key === 'Enter' && createCustom()}
            placeholder="e.g. PUSH1"
            style={{
              flex: 1, background: 'transparent', border: 'none',
              borderBottom: `1px solid ${UI.goldSoft}`,
              color: UI.gold, padding: '8px 0',
              fontFamily: UI.fontNum, fontSize: 14, letterSpacing: '0.08em', outline: 'none',
            }}
          />
          <Btn kind="ghost" onClick={() => { setCreating(false); setNewName(''); }} style={{ minHeight: 36, padding: '4px 10px', fontSize: 11 }}>×</Btn>
          <Btn onClick={createCustom} disabled={!newName.trim()} style={{ minHeight: 36, padding: '4px 12px', fontSize: 11, opacity: newName.trim() ? 1 : 0.4 }}>create</Btn>
        </div>
      )}

      <div className="micro" style={{ marginTop: 18, color: UI.inkFaint, lineHeight: 1.7 }}>
        For plans like PUSH1 / PULL1 / REST / LEGS1, create several custom types.
      </div>
      {confirmEl}
    </Sheet>
  );
}

function dayTypeChip(dashed) {
  return {
    padding: '7px 12px', borderRadius: 4,
    background: 'transparent',
    border: `1px ${dashed ? 'dashed' : 'solid'} ${UI.hairStrong}`,
    color: UI.inkSoft, fontFamily: UI.fontNum, fontSize: 11, letterSpacing: '0.08em',
    cursor: 'pointer',
  };
}

// ─── Day copy / migrate picker ───────────────────────────────────────
// onCopy(items, migrateId?) — migrateId is the source day's id when
// copying from another plan; passing it preserves the day id so all
// historical sessions automatically carry over to the new plan.
function DayCopyPicker({ store, schedule, currentDayId, onClose, onCopy }) {
  const thisScheduleDays = (schedule?.days || []).filter(d => d.id !== currentDayId && d.items.length > 0);
  const otherSchedules = store.schedules.filter(s => schedule ? s.id !== schedule.id : true);

  const DayBtn = ({ d, migrateId }) => (
    <button key={d.id} onClick={() => onCopy(d, migrateId)} style={{
      background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
      borderRadius: 4, padding: '12px 14px', cursor: 'pointer',
      textAlign: 'left', color: UI.ink, fontFamily: UI.fontUi, width: '100%',
    }}
    onMouseEnter={ev => ev.currentTarget.style.borderColor = UI.goldSoft}
    onMouseLeave={ev => ev.currentTarget.style.borderColor = UI.hairStrong}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="display" style={{ fontSize: 16 }}>{d.name}</div>
        {migrateId && (
          <div className="micro" style={{ color: UI.gold, marginLeft: 8, flexShrink: 0, marginTop: 1 }}>↩ history</div>
        )}
      </div>
      <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 4 }}>
        {d.items.map(it => LB.findExercise(store, it.exId)?.name || '—').join(' · ')}
      </div>
      <div className="num" style={{ fontSize: 10, color: UI.inkFaint, marginTop: 4 }}>
        {d.items.length} exercise{d.items.length !== 1 ? 's' : ''}
      </div>
    </button>
  );

  const hasAny = thisScheduleDays.length > 0 || otherSchedules.some(s => s.days.some(d => d.items.length > 0));

  return (
    <Sheet open={true} onClose={onClose} title="Import exercises from">
      {!hasAny ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: UI.inkFaint, fontSize: 13 }}>
          No days with exercises available.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {thisScheduleDays.length > 0 && (
            <>
              <div className="micro" style={{ paddingLeft: 2, marginBottom: 2 }}>THIS PLAN</div>
              {thisScheduleDays.map(d => <DayBtn key={d.id} d={d} migrateId={undefined} />)}
            </>
          )}
          {otherSchedules.map(s => {
            const days = s.days.filter(d => d.items.length > 0);
            if (!days.length) return null;
            return (
              <React.Fragment key={s.id}>
                <div className="micro" style={{ paddingLeft: 2, marginTop: thisScheduleDays.length > 0 ? 8 : 2, marginBottom: 2 }}>
                  {s.name}{s.archived ? ' · ARCHIVED' : ''}
                </div>
                {days.map(d => <DayBtn key={d.id} d={d} migrateId={d.id} />)}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

// ─── Day editor (exercises within a day) ─────────────────────────────
function ExerciseItemEditor({ item, exName, onClose, onSave }) {
  const [sets, setSets] = useStateS(item.sets);
  const [reps, setReps] = useStateS(item.reps);
  const [note, setNote] = useStateS(item.note || '');

  return (
    <Sheet open={true} onClose={onClose} title={exName}>
      <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 24 }}>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <span className="label" style={{ display: 'block', textAlign: 'center' }}>Sets</span>
          <div style={{ marginTop: 8 }}>
            <Stepper value={sets} onChange={v => setSets(Math.max(1, Math.round(v)))} step={1} min={1} />
          </div>
        </div>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <span className="label" style={{ display: 'block', textAlign: 'center' }}>Reps</span>
          <div style={{ marginTop: 8 }}>
            <Stepper value={reps} onChange={v => setReps(Math.max(1, Math.round(v)))} step={1} min={1} />
          </div>
        </div>
      </div>
      <Field label="Note (optional)">
        <TextInput value={note} onChange={setNote} placeholder="e.g. cable pos 4, slow eccentric…" />
      </Field>
      <Btn onClick={() => onSave({ sets, reps, note })} style={{ width: '100%', marginTop: 20 }}>Apply</Btn>
    </Sheet>
  );
}

function DayEditor({ store, setStore, day, schedule, onClose, onSave }) {
  const [draft, setDraft] = useStateS(day);
  const [addingEx, setAddingEx] = useStateS(false);
  const [copyingFrom, setCopyingFrom] = useStateS(false);
  const [editingItem, setEditingItem] = useStateS(null);
  const [pickingType, setPickingType] = useStateS(false);

  if (!draft) return null;

  const updateItem = (idx, patch) => setDraft(d => {
    const item = d.items[idx];
    const gid = item?.supersetGroup;
    return { ...d, items: d.items.map((it, i) => {
      if (i === idx) return { ...it, ...patch };
      if (gid && it.supersetGroup === gid && patch.sets !== undefined) return { ...it, sets: patch.sets };
      return it;
    })};
  });
  // A superset group is only meaningful as a contiguous run of >= 2 adjacent
  // items. After a move/remove, drop the group id from any item no longer next
  // to a same-group partner so distant rows can't stay silently coupled.
  const normalizeSupersets = (items) => items.map((it, i) => {
    if (!it.supersetGroup) return it;
    const linked = items[i - 1]?.supersetGroup === it.supersetGroup || items[i + 1]?.supersetGroup === it.supersetGroup;
    return linked ? it : { ...it, supersetGroup: null };
  });
  const removeItem = (idx) => setDraft(d => ({ ...d, items: normalizeSupersets(d.items.filter((_, i) => i !== idx)) }));
  const addExercise = (exId) => {
    const ex = LB.findExercise(store, exId);
    const defaultReps = ex?.progression_reps ?? 8;
    setDraft(d => ({ ...d, items: [...d.items, { exId, sets: 3, reps: defaultReps }] }));
    setAddingEx(false);
  };
  const moveItem = (idx, dir) => {
    const j = idx + dir;
    setDraft(d => {
      if (j < 0 || j >= d.items.length) return d;
      const items = [...d.items];
      [items[idx], items[j]] = [items[j], items[idx]];
      return { ...d, items: normalizeSupersets(items) };
    });
  };
  const copyItemsFromDay = (sourceDay, migrateId) => {
    // Deep-copy each item and remap superset group ids — a shallow spread
    // would share item objects (and group ids) with the source day.
    const gidMap = {};
    const copied = sourceDay.items.map(it => {
      const next = { ...it };
      if (it.supersetGroup) {
        gidMap[it.supersetGroup] = gidMap[it.supersetGroup] || LB.uid();
        next.supersetGroup = gidMap[it.supersetGroup];
      }
      return next;
    });
    // migrateId: preserve the source day's id so historical sessions for that
    // day carry over to this new plan automatically (sessions reference day_id).
    setDraft(d => ({ ...d, items: copied, ...(migrateId ? { id: migrateId } : {}) }));
    setCopyingFrom(false);
  };

  const toggleSuperset = (idx) => {
    setDraft(d => {
      const items = d.items.map(it => ({ ...it }));
      const a = items[idx], b = items[idx + 1];
      if (!b) return d;
      if (a.supersetGroup && a.supersetGroup === b.supersetGroup) {
        const gid = a.supersetGroup;
        return { ...d, items: items.map(it => it.supersetGroup === gid ? { ...it, supersetGroup: null } : it) };
      }
      const gid = LB.uid();
      items[idx] = { ...a, supersetGroup: gid };
      items[idx + 1] = { ...b, supersetGroup: gid, sets: a.sets };
      return { ...d, items };
    });
  };

  const canImportFromPlan = store.schedules.some(s =>
    s.days.some(d => d.items.length > 0 && (s.id !== schedule?.id || d.id !== draft.id))
  );

  return (
    <Sheet open={true} onClose={onClose} title="Edit day">
      <Field label="Day type">
        <button onClick={() => setPickingType(true)} style={{
          width: '100%', textAlign: 'left', background: UI.bgInset,
          border: `1px solid ${UI.hairStrong}`, borderRadius: 4, padding: '10px 14px',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          color: draft.name === 'REST' ? UI.inkFaint : UI.ink, fontSize: 15, fontWeight: 600, fontFamily: UI.fontUi,
        }}>
          <span>{draft.name}</span>
          <span className="micro" style={{ fontStyle: 'normal' }}>change</span>
        </button>
      </Field>
      {draft.name === 'REST' ? (
        <div style={{ marginTop: 18, padding: '18px 14px', textAlign: 'center',
          border: `1px dashed ${UI.hairStrong}`, borderRadius: 4, color: UI.inkFaint }}>
          <div className="display-it" style={{ fontSize: 16, color: UI.inkSoft, marginBottom: 4 }}>Rest day.</div>
          <div className="micro">Change day name to add exercises.</div>
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span className="label" style={{ marginBottom: 0 }}>Exercises</span>
            {canImportFromPlan && (
              <button onClick={() => setCopyingFrom(true)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: UI.gold, fontSize: 10, fontFamily: UI.fontUi, padding: '2px 0',
                letterSpacing: '0.1em', textTransform: 'uppercase',
              }}>Import from plan</button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {draft.items.flatMap((it, i) => {
              const ex = LB.findExercise(store, it.exId);
              const nextIt = draft.items[i + 1];
              const prevIt = draft.items[i - 1];
              const linkedToNext = it.supersetGroup && it.supersetGroup === nextIt?.supersetGroup;
              const linkedToPrev = it.supersetGroup && it.supersetGroup === prevIt?.supersetGroup;
              const inGroup = linkedToNext || linkedToPrev;
              const els = [];
              els.push(
                <div key={`item-${i}`} onClick={() => setEditingItem(i)} style={{
                  display: 'flex', gap: 8, alignItems: 'center',
                  background: inGroup ? UI.goldFaint : UI.bgInset,
                  border: `1px solid ${inGroup ? UI.goldSoft : UI.hairStrong}`,
                  borderRadius: linkedToPrev && linkedToNext ? 0 : linkedToPrev ? '0 0 4px 4px' : linkedToNext ? '4px 4px 0 0' : 4,
                  padding: '10px 12px', cursor: 'pointer', marginBottom: linkedToNext ? 0 : 6,
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button onClick={e => { e.stopPropagation(); moveItem(i, -1); }} disabled={i === 0} style={{ ...dayEditIconBtn, opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                    <button onClick={e => { e.stopPropagation(); moveItem(i, 1); }} disabled={i === draft.items.length - 1} style={{ ...dayEditIconBtn, opacity: i === draft.items.length - 1 ? 0.3 : 1 }}>▼</button>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="display" style={{ fontSize: 15, color: UI.ink, lineHeight: 1.1 }}>{ex?.name || '—'}</div>
                    {it.note ? <div className="micro" style={{ color: UI.inkFaint, marginTop: 2, fontStyle: 'italic' }}>{it.note}</div> : null}
                  </div>
                  <div className="num" style={{
                    fontSize: 12, color: UI.gold, background: UI.goldFaint,
                    border: `1px solid ${UI.goldSoft}`, borderRadius: 4,
                    padding: '3px 8px', whiteSpace: 'nowrap',
                  }}>{it.sets}×{it.reps}</div>
                  <button onClick={e => { e.stopPropagation(); removeItem(i); }} style={{ ...dayEditIconBtn, color: UI.inkFaint, fontSize: 16 }}>×</button>
                </div>
              );
              if (i < draft.items.length - 1) {
                if (linkedToNext) {
                  els.push(
                    <div key={`conn-${i}`} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', background: UI.goldFaint, borderLeft: `1px solid ${UI.goldSoft}`, borderRight: `1px solid ${UI.goldSoft}`, padding: '1px 12px', marginBottom: 0 }}>
                      <button onClick={e => { e.stopPropagation(); toggleSuperset(i); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.gold, fontSize: 8, fontFamily: UI.fontUi, letterSpacing: '0.12em', padding: '2px 0' }}>SUPERSET ×</button>
                    </div>
                  );
                } else {
                  els.push(
                    <div key={`conn-${i}`} style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                      <button onClick={e => { e.stopPropagation(); toggleSuperset(i); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.1em', padding: '1px 8px' }}>Link ↕</button>
                    </div>
                  );
                }
              }
              return els;
            })}
            <Btn kind="ghost" onClick={() => setAddingEx(true)} style={{ borderStyle: 'dashed', minHeight: 42, fontSize: 12 }}>+ Add exercise</Btn>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <Btn kind="ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
        <Btn onClick={() => onSave(draft)} style={{ flex: 2 }}>Save</Btn>
      </div>

      {editingItem !== null && (
        <ExerciseItemEditor
          item={draft.items[editingItem]}
          exName={LB.findExercise(store, draft.items[editingItem]?.exId)?.name || '—'}
          onClose={() => setEditingItem(null)}
          onSave={(patch) => { updateItem(editingItem, patch); setEditingItem(null); }}
        />
      )}
      {addingEx && (
        <ExercisePicker store={store} setStore={setStore} onClose={() => setAddingEx(false)} onPick={addExercise} />
      )}
      {copyingFrom && schedule && (
        <DayCopyPicker
          store={store}
          schedule={schedule}
          currentDayId={draft.id}
          onClose={() => setCopyingFrom(false)}
          onCopy={copyItemsFromDay}
        />
      )}
      {pickingType && (
        <DayTypePicker
          store={store} setStore={setStore}
          title="Day type"
          onClose={() => setPickingType(false)}
          onPick={(type) => { setDraft(d => ({ ...d, name: type })); setPickingType(false); }}
        />
      )}
    </Sheet>
  );
}

function ExercisePicker({ store, setStore, onClose, onPick }) {
  const [q, setQ] = useStateS('');
  const [filterTags, setFilterTags] = useStateS([]);
  const [creatingNew, setCreatingNew] = useStateS(null);
  const toggleFilter = (m) => setFilterTags(t => t.includes(m) ? t.filter(x => x !== m) : [...t, m]);

  const list = useMemoS(() => {
    const ql = q.toUpperCase();
    return store.exercises
      .filter(e => {
        const matchSearch = !q || e.name.toUpperCase().includes(ql) || e.tags?.some(t => t.toUpperCase().includes(ql));
        const matchTags = filterTags.length === 0 || filterTags.some(ft => e.tags?.includes(ft));
        return matchSearch && matchTags;
      })
      .sort((a,b) => a.name.localeCompare(b.name));
  }, [store.exercises, q, filterTags]);

  return (
    <Sheet open={true} onClose={onClose} title="Select exercise">
      <Field label="">
        <TextInput value={q} onChange={v => setQ(v.toUpperCase())} placeholder="Search or type…" />
      </Field>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {MUSCLES.map(m => (
          <Pill key={m} gold={filterTags.includes(m)} onClick={() => toggleFilter(m)}
            style={{ cursor: 'pointer' }}>{m}</Pill>
        ))}
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', maxHeight: 240, overflow: 'auto' }}>
        {list.map((e, ei) => (
          <React.Fragment key={e.id}>
          <button onClick={() => onPick(e.id)} style={{
            background: 'transparent', border: 'none', textAlign: 'left',
            padding: '11px 0', cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
            width: '100%',
          }}>
            <span className="display" style={{ fontSize: 17, color: UI.ink }}>{e.name}</span>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {(e.tags || []).map(t => <Pill key={t} gold>{t}</Pill>)}
            </div>
          </button>
          {ei < list.length - 1 && <div className="knurl" />}
          </React.Fragment>
        ))}
        {list.length === 0 && <div className="micro" style={{ padding: '20px 0', textAlign: 'center', color: UI.inkFaint }}>No exercises found</div>}
      </div>
      {q && !list.find(e => e.name.toUpperCase() === q.toUpperCase()) && (
        <button onClick={() => setCreatingNew(q)} style={{
          background: UI.goldFaint, border: `1px dashed ${UI.goldSoft}`,
          padding: '12px 14px', borderRadius: 4, cursor: 'pointer',
          color: UI.gold, fontSize: 13, marginTop: 8, fontFamily: UI.fontUi, textAlign: 'left',
          width: '100%', boxSizing: 'border-box',
        }}>+ Create "{q}"</button>
      )}
      {creatingNew !== null && (
        <window.Screens.ExerciseCreator
          initialName={creatingNew}
          setStore={setStore}
          onCreated={(id) => { onPick(id); }}
          onClose={() => setCreatingNew(null)}
        />
      )}
    </Sheet>
  );
}

// ─── Create new schedule ─────────────────────────────────────────────
function ScheduleNewScreen({ store, setStore, go }) {
  const [step, setStep] = useStateS(0);
  const [name, setName] = useStateS('');
  const [mode, setMode] = useStateS('cycle');
  // pattern: Array<string | { id, name, items }> — strings are empty new days,
  // objects are days imported from existing plans (id preserved for history).
  const [pattern, setPattern] = useStateS(['PUSH','PULL','REST']);
  const [weekdayDays, setWeekdayDays] = useStateS([]);
  const [pickingType, setPickingType] = useStateS(false);
  const [pickingWeekday, setPickingWeekday] = useStateS(null);
  const [importingFromPlan, setImportingFromPlan] = useStateS(false);

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
      name: name.trim() || 'My Plan',
      days: pattern.map(p =>
        typeof p === 'object'
          ? { id: p.id, name: p.name, items: p.items }   // imported: keep id + exercises
          : { id: LB.uid(), name: p, items: [] }          // new: fresh id
      ),
      archived: false,
    };
    setStore(s => {
      const typeNames = pattern.map(p => typeof p === 'object' ? p.name : p);
      const withTypes = ensureCustomTypes(s, typeNames);
      return { ...withTypes, schedules: [...withTypes.schedules, newSch] };
    });
    go({ name: 'schedule-edit', scheduleId: newSch.id });
  };

  const toggleWeekday = (idx) => {
    setWeekdayDays(days => {
      if (days.some(d => d.weekday === idx)) return days.filter(d => d.weekday !== idx);
      return [...days, { weekday: idx, name: 'FULL' }];
    });
  };

  const finishWeekday = () => {
    const sorted = [...weekdayDays].sort((a,b) => a.weekday - b.weekday);
    const newSch = {
      id: LB.uid(),
      name: name.trim() || 'My Plan',
      mode: 'weekday',
      days: sorted.map(d => ({ id: LB.uid(), name: d.name, weekday: d.weekday, items: [] })),
      archived: false,
    };
    setStore(s => {
      const withTypes = ensureCustomTypes(s, sorted.map(d => d.name));
      return { ...withTypes, schedules: [...withTypes.schedules, newSch] };
    });
    go({ name: 'schedule-edit', scheduleId: newSch.id });
  };

  return (
    <Screen>
      <TopBar title="New plan" onBack={() => step > 0 ? setStep(step - 1) : go({ name: 'plan' })} />
      <div style={{ padding: '14px 22px 22px' }}>

        {/* Step progress bars */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
          {[0,1].map(i => (
            <div key={i} style={{ flex: 1, height: 2, borderRadius: 1, background: i <= step ? UI.gold : UI.hair, transition: 'background 0.3s' }} />
          ))}
        </div>

        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div>
              <div className="display" style={{ fontSize: 26, color: UI.ink, lineHeight: 1.1, marginBottom: 6 }}>What's your plan called?</div>
              <div style={{ fontSize: 13, color: UI.inkSoft }}>You can change this later.</div>
            </div>
            <Field label="Plan name">
              <TextInput value={name} onChange={v => setName(v.toUpperCase())} placeholder="e.g. 2 ON 1 OFF PPL" autoFocus />
            </Field>
            <Btn onClick={() => setStep(1)} style={{ opacity: name.trim() ? 1 : 0.4 }} disabled={!name.trim()}>Next →</Btn>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: 0, background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, padding: 3 }}>
              {[{key:'cycle',label:'Cycle'},{key:'weekday',label:'Weekdays'}].map(m => (
                <button key={m.key} onClick={() => setMode(m.key)} style={{
                  flex: 1, padding: '8px 0', border: 'none', borderRadius: 4, cursor: 'pointer',
                  background: mode === m.key ? UI.bgRaised : 'transparent',
                  color: mode === m.key ? UI.ink : UI.inkFaint,
                  fontFamily: UI.fontUi, fontSize: 12, fontWeight: mode === m.key ? 600 : 400,
                  letterSpacing: '0.06em',
                }}>{m.label}</button>
              ))}
            </div>

            {mode === 'cycle' && (
              <>
                <div>
                  <div className="display" style={{ fontSize: 22, color: UI.ink, lineHeight: 1.1, marginBottom: 4 }}>Build your cycle</div>
                  <div style={{ fontSize: 12, color: UI.inkSoft }}>Append day types — cycle repeats endlessly.</div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="label">Your cycle · {pattern.length} days</span>
                    {pattern.length > 0 && (
                      <button onClick={() => setPattern([])} style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: UI.danger, fontSize: 10, fontFamily: UI.fontUi, padding: '2px 0',
                        letterSpacing: '0.1em', textTransform: 'uppercase',
                      }}>Clear all</button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: 12, background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, minHeight: 54, marginTop: 8 }}>
                    {pattern.map((p, i) => {
                      const isObj = typeof p === 'object';
                      const label = isObj ? p.name : p;
                      const isRest = label === 'REST';
                      return (
                        <button key={i} onClick={() => setPattern(pat => pat.filter((_,j) => j !== i))} style={{
                          padding: '5px 10px', borderRadius: 4,
                          background: isRest ? 'transparent' : UI.goldFaint,
                          border: `1px ${isRest ? 'dashed' : 'solid'} ${isRest ? UI.hairStrong : UI.goldSoft}`,
                          color: isRest ? UI.inkFaint : UI.gold,
                          fontSize: 11, fontFamily: UI.fontNum, letterSpacing: '0.06em', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }} title="Tap to remove">
                          {isObj && <span style={{ opacity: 0.7, fontSize: 10 }}>↩</span>}
                          {label} ×
                        </button>
                      );
                    })}
                    {pattern.length === 0 && <div className="micro" style={{ color: UI.inkFaint, alignSelf: 'center' }}>empty — add a day</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn kind="ghost" onClick={() => setPickingType(true)} style={{ flex: 1, borderStyle: 'dashed', fontSize: 12 }}>+ Add day</Btn>
                  {store.schedules.some(s => s.days.some(d => d.items.length > 0)) && (
                    <Btn kind="ghost" onClick={() => setImportingFromPlan(true)} style={{ flex: 1, borderStyle: 'dashed', fontSize: 12, color: UI.gold, borderColor: UI.goldSoft }}>↩ From plan</Btn>
                  )}
                </div>
                <div>
                  <span className="label">Quick select</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {presets.map(p => (
                      <button key={p.label} onClick={() => setPattern(p.val)} style={{
                        background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
                        padding: '10px 14px', borderRadius: 4, cursor: 'pointer',
                        color: UI.ink, textAlign: 'left', fontFamily: UI.fontUi, fontSize: 13,
                        display: 'flex', justifyContent: 'space-between',
                      }}>
                        <span>{p.label}</span>
                        <span className="num" style={{ color: UI.inkFaint, fontSize: 10 }}>{p.val.length}d</span>
                      </button>
                    ))}
                  </div>
                </div>
                <Btn onClick={finish} style={{ opacity: pattern.length ? 1 : 0.4 }} disabled={!pattern.length}>Create plan →</Btn>
                <div className="micro" style={{ textAlign: 'center', marginTop: -8 }}>
                  You can add exercises to each day right after.
                </div>
              </>
            )}

            {mode === 'weekday' && (
              <>
                <div>
                  <div className="display" style={{ fontSize: 22, color: UI.ink, lineHeight: 1.1, marginBottom: 4 }}>Select training days</div>
                  <div style={{ fontSize: 12, color: UI.inkSoft }}>Which days of the week do you train?</div>
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                  {WEEKDAYS.map((wd, i) => {
                    const sel = weekdayDays.some(d => d.weekday === i);
                    return (
                      <button key={i} onClick={() => toggleWeekday(i)} style={{
                        width: 42, height: 42, borderRadius: 6,
                        border: `1px solid ${sel ? UI.goldSoft : UI.hairStrong}`,
                        background: sel ? UI.goldFaint : 'transparent',
                        color: sel ? UI.gold : UI.inkFaint,
                        fontFamily: UI.fontNum, fontSize: 12, cursor: 'pointer', fontWeight: sel ? 600 : 400,
                      }}>{wd}</button>
                    );
                  })}
                </div>
                {weekdayDays.length > 0 && (
                  <div>
                    <span className="label">Type per day</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {[...weekdayDays].sort((a,b)=>a.weekday-b.weekday).map(d => (
                        <div key={d.weekday} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          background: UI.bgInset, border: `1px solid ${UI.hairStrong}`,
                          padding: '8px 12px', borderRadius: 4,
                        }}>
                          <div className="num" style={{ width: 30, color: UI.inkFaint, fontSize: 12, fontWeight: 600 }}>{WEEKDAYS[d.weekday]}</div>
                          <button onClick={() => setPickingWeekday(d.weekday)} style={{
                            flex: 1, textAlign: 'left', background: 'transparent', border: 'none',
                            cursor: 'pointer', color: d.name === 'REST' ? UI.inkFaint : UI.gold,
                            fontSize: 13, fontWeight: 600, fontFamily: UI.fontUi, padding: 0,
                          }}>
                            {d.name} <span className="micro" style={{ fontStyle: 'normal' }}>change</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <Btn onClick={finishWeekday} disabled={weekdayDays.length === 0} style={{ opacity: weekdayDays.length ? 1 : 0.4 }}>
                  Create plan →
                </Btn>
                <div className="micro" style={{ textAlign: 'center', marginTop: -8 }}>
                  You can add exercises to each day right after.
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {pickingType && (
        <DayTypePicker
          store={store} setStore={setStore}
          title="Choose day type"
          onClose={() => setPickingType(false)}
          onPick={(t) => { setPattern(pat => [...pat, t]); }}
        />
      )}
      {pickingWeekday != null && (
        <DayTypePicker
          store={store} setStore={setStore}
          title={`${WEEKDAYS_FULL[pickingWeekday]} — choose type`}
          onClose={() => setPickingWeekday(null)}
          onPick={(t) => {
            setWeekdayDays(days => days.map(d => d.weekday === pickingWeekday ? { ...d, name: t } : d));
            setPickingWeekday(null);
          }}
        />
      )}
      {importingFromPlan && (
        <DayCopyPicker
          store={store}
          schedule={null}
          currentDayId={null}
          onClose={() => setImportingFromPlan(false)}
          onCopy={(day, migrateId) => {
            setPattern(pat => [...pat, { id: migrateId || LB.uid(), name: day.name, items: day.items }]);
            setImportingFromPlan(false);
          }}
        />
      )}
    </Screen>
  );
}

Object.assign(window.Screens, { PlanScreen, PlanViewerScreen, ScheduleEditScreen, ScheduleNewScreen, ExercisePicker, DayTypePicker });
